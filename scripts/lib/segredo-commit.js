'use strict';

/**
 * H6c (15.4, D895): o segredo no commit. Antes, so o cartao do push (push.js) via o segredo, e o commit ja o tinha
 * gravado no historico local. Aqui o portao de commit passa pela classe `segredo` da sanitacao.js (sk-, gh?_, AKIA,
 * JWT, Bearer, chave privada...) o que o commit vai levar: as linhas acrescentadas do diff staged; com `git add` no
 * mesmo comando, ou com `git commit -a`/`--all`/caminho, tambem as do diff nao staged dos rastreados; com `git add`,
 * tambem os nao rastreados fora do .gitignore. O gancho roda antes do comando, entao o `git add x && git commit` ainda
 * nao pos x no indice: por isso o comando conta. O motivo cita arquivo:linha e a classe, nunca o trecho (o motivo vai
 * para a conversa). A saida e a marca "# sworn: segredo-visto" no comando (falso positivo, isca de teste).
 *
 * atalho: o `git add <caminho>` leva a varredura de todos os mudados e nao rastreados, e nao so os do caminho.
 * limite: o segredo num arquivo que o add nao pega nega do mesmo jeito (a marca passa).
 * trocar quando: um falso positivo assim aparecer no uso real (ler os caminhos do add).
 */
const fs = require('node:fs');
const path = require('node:path');
const git = require('./git.js');
const commit = require('./commit.js');
const sanitacao = require('./sanitacao.js');
const escopo = require('./escopo.js');

const MARCA = '# sworn: segredo-visto';
const MAX_CITADOS = 5;
// Cada git com prazo e saida proprios, e todos juntos ate ORCAMENTO_MS: o portao-shell da 40 s ao conjunto de portoes.
const PRAZO_MS = 10000;
const ORCAMENTO_MS = 15000;
const SAIDA_MAX = 32 * 1024 * 1024;
// limite: o nao rastreado acima de 1 MiB, o binario, o que nao e arquivo comum (link, dispositivo), o que passa do
// 2000o e o que passa de 32 MiB lidos somados nao se leem, sem aviso; o cartao do push varre de novo, com todas as
// classes, antes de publicar. O teto somado guarda os 40 s do gancho para os outros portoes (a revisao).
const ARQUIVO_MAX = 1024 * 1024;
const NAO_RASTREADOS_MAX = 2000;
const LIDOS_MAX = 32 * 1024 * 1024;

// As opcoes do git commit que levam o valor na palavra seguinte (`-m x`, `--author X`); com `=`, o valor vem colado.
const COMMIT_COM_VALOR = new Set(['--message', '--file', '--reuse-message', '--reedit-message', '--template',
  '--author', '--date', '--cleanup', '--fixup', '--squash', '--trailer']);
// As letras curtas que levam valor: colado no resto do grupo (`-mx`) ou, no fim dele, na palavra seguinte. `u` e `S`
// so levam o valor colado.
const CURTAS_COM_VALOR = 'mFCct';
const CURTAS_SO_COLADO = 'uS';

/** O `git commit` leva o que nao esta no indice? `-a`, `--all`, `-p`/`--patch`/`--interactive` (o trecho escolhido
 *  vem do disco), ou um caminho (pathspec) nos argumentos. */
function levaONaoStaged(args) {
  const a = args.map(function (x) { return x.t; });
  for (let i = 0; i < a.length; i++) {
    const t = a[i];
    if (t === '--') return i + 1 < a.length;
    if (t === '--all' || t === '--patch' || t === '--interactive' || /^--pathspec-from-file(=|$)/.test(t)) return true;
    if (/^--/.test(t)) { if (t.indexOf('=') === -1 && COMMIT_COM_VALOR.has(t)) i++; continue; }
    if (/^-./.test(t)) {
      for (let k = 1; k < t.length; k++) {
        const ch = t[k];
        if (ch === 'a' || ch === 'p') return true;
        if (CURTAS_COM_VALOR.indexOf(ch) !== -1) { if (k === t.length - 1) i++; break; }
        if (CURTAS_SO_COLADO.indexOf(ch) !== -1) break;
      }
      continue;
    }
    return true;
  }
  return false;
}

/** O caminho do cabecalho `+++ b/x` (com aspas e escapes em C quando o git o citou), ou null em /dev/null. O git
 *  poe um TAB no fim do cabecalho quando o caminho tem espaco: ele sai junto do `\r`. */
function caminhoDoCabecalho(bruto) {
  let s = bruto.replace(/\r$/, '').replace(/\t$/, '');
  if (s === '/dev/null') return null;
  if (s.length > 1 && s[0] === '"' && s[s.length - 1] === '"') {
    const bytes = [];
    // por ponto de codigo, nao por unidade UTF-16: o emoji (par substituto) vira os 4 bytes dele, nao dois U+FFFD
    const corpo = Array.from(s.slice(1, -1));
    for (let i = 0; i < corpo.length; i++) {
      if (corpo[i] !== '\\' || i + 1 >= corpo.length) { bytes.push.apply(bytes, Array.from(Buffer.from(corpo[i], 'utf8'))); continue; }
      const oct = /^[0-7]{3}/.exec(corpo.slice(i + 1, i + 4).join(''));
      if (oct) { bytes.push(parseInt(oct[0], 8)); i += 3; continue; }
      const c = corpo[++i];
      bytes.push(({ t: 9, n: 10, r: 13, a: 7, b: 8, f: 12, v: 11 })[c] || c.charCodeAt(0));
    }
    s = Buffer.from(bytes).toString('utf8');
  }
  return s.replace(/^b\//, '');
}

/**
 * As linhas acrescentadas de um diff unificado: [{ arquivo, linha, texto }], com a linha no arquivo novo. Le pelo
 * estado (cabecalho ate o `@@`, trecho depois), para a linha acrescentada que comeca com `++` nao virar cabecalho.
 * limite: o diff combinado (`@@@`, conflito de merge) nao se le.
 */
function linhasDoDiff(diff) {
  const saida = [];
  let arquivo = null;
  let linha = 0;
  let noTrecho = false;
  for (const l of String(diff == null ? '' : diff).split('\n')) {
    if (l.startsWith('diff --git ')) { arquivo = null; noTrecho = false; continue; }
    if (l.startsWith('@@')) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
      noTrecho = !!m && arquivo !== null;
      if (noTrecho) linha = Number(m[1]);
      continue;
    }
    if (!noTrecho) { if (l.startsWith('+++ ')) arquivo = caminhoDoCabecalho(l.slice(4)); continue; }
    if (l[0] === '+') { saida.push({ arquivo: arquivo, linha: linha, texto: l.slice(1).replace(/\r$/, '') }); linha++; }
    else if (l[0] === ' ') linha++;
  }
  return saida;
}

/** O diff (staged com `cached`) com os prefixos e o formato fixos, contra a config da maquina; null se o git falhou.
 *  limite: o git que falha, passa do `prazo` ou de SAIDA_MAX da null, e o `prazo` ja gasto (orcamento acabou) nem
 *  roda: esse diff nao se le, sem aviso (fail-open, D895: o cartao do push varre de novo antes de publicar). */
function diff(topo, cached, prazo) {
  if (!(prazo > 0)) return null;
  const args = ['-c', 'core.quotepath=false', 'diff'];
  if (cached) args.push('--cached');
  args.push('--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--src-prefix=a/', '--dst-prefix=b/',
    '-U0', '--diff-filter=d');
  const r = git.rodar(topo, args, { timeout: prazo, maxBuffer: SAIDA_MAX });
  return git.ok(r) ? r.stdout : null;
}

/** Os achados da classe `segredo` no que o commit do `comando` vai levar, ou [] (fora de repositorio, git que falhou). */
function levantar(comando, ferramenta, cwd) {
  const fim = Date.now() + ORCAMENTO_MS;
  // o prazo do proximo git: o menor entre PRAZO_MS e o que resta do orcamento (0 ou menos: nao roda)
  function prazo() { return Math.min(PRAZO_MS, fim - Date.now()); }
  const classes = sanitacao.CLASSES_GENERICAS.filter(function (c) { return c.chave === 'segredo'; });
  const g = commit.chamadaGit(comando, ferramenta, 'commit');
  if (!g) return [];
  const topo = commit.topo(g.pasta ? path.resolve(cwd, g.pasta) : cwd);
  if (!topo) return [];
  const comAdd = commit.chamadaGit(comando, ferramenta, 'add') !== null;
  const achados = [];
  function varrer(texto, arquivo, linha) {
    sanitacao.varrerTexto(texto, arquivo, classes).forEach(function (a) {
      achados.push({ nome: a.nome, arquivo: a.arquivo, linha: linha === undefined ? a.linha : linha });
    });
  }
  const textos = [diff(topo, true, prazo())];
  if (comAdd || levaONaoStaged(g.args)) textos.push(diff(topo, false, prazo()));
  textos.forEach(function (d) {
    linhasDoDiff(d).forEach(function (l) { varrer(l.texto, l.arquivo, l.linha); });
  });
  if (comAdd) {
    const p = prazo();
    const r = p > 0 ? git.rodar(topo, ['ls-files', '--others', '--exclude-standard', '-z'], { timeout: p, maxBuffer: SAIDA_MAX }) : null;
    // fail-open: o ls-files que falha ou que o orcamento nao deixou rodar deixa a lista vazia (o limite do topo do arquivo)
    const rels = r && git.ok(r) ?r.stdout.split('\0').filter(Boolean).slice(0, NAO_RASTREADOS_MAX) : [];
    let lidos = 0;
    rels.forEach(function (rel) {
      let buf;
      try {
        const abs = path.join(topo, rel);
        // lstat: o link nao se segue (o git guarda o destino dele, nao o conteudo), e o dispositivo nao se le
        const st = fs.lstatSync(abs);
        if (!st.isFile() || st.size > ARQUIVO_MAX || lidos + st.size > LIDOS_MAX) return;
        lidos += st.size;
        buf = fs.readFileSync(abs);
      } catch (e) { return; } // fail-open: o que nao se le aqui, o cartao do push le antes de publicar
      if (buf.indexOf(0) !== -1) return;
      varrer(buf.toString('utf8'), rel);
    });
  }
  const vistos = new Set();
  return achados.filter(function (a) {
    const k = a.arquivo + ':' + a.linha;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

/** O texto da negacao (ASCII, D532): arquivo:linha e a classe de cada achado, sem o trecho. */
function texto(achados) {
  const citados = achados.slice(0, MAX_CITADOS).map(function (a) {
    return '  ' + escopo.asciiEmUmaLinha(a.arquivo) + ':' + a.linha + ' (' + escopo.ascii(a.nome) + ')';
  });
  if (achados.length > MAX_CITADOS) citados.push('  (e mais ' + (achados.length - MAX_CITADOS) + ')');
  return [
    'sworn - commit parado: segredo no que o commit vai levar.',
    '',
    'O detector da sanitizacao achou (o trecho fica fora desta mensagem, de proposito):'
  ].concat(citados, [
    '',
    'Tire o segredo do arquivo (variavel de ambiente, cofre, arquivo no .gitignore) e repita o commit.',
    'Falso positivo (exemplo, isca de teste): repita com a marca no comando: ' + MARCA,
    'So o dono desliga esta parada neste projeto: "segredoNoCommit": false em .claude/sworn/projeto.json.'
  ]).join('\n');
}

/** O motivo da negacao, ou null: a marca no comando passa, e o levantamento que lanca tambem (o push varre de novo). */
function motivo(comando, ferramenta, cwd) {
  if (commit.temMarca(comando, ferramenta, /^#\s*sworn:\s*segredo-visto\b/)) return null;
  let achados;
  try { achados = levantar(comando, ferramenta, cwd); } catch (e) { return null; } // fail-open: o cartao do push varre de novo antes de publicar
  return achados.length ? texto(achados) : null;
}

module.exports = { MARCA, motivo, levantar, linhasDoDiff, levaONaoStaged, caminhoDoCabecalho };
