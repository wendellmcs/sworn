'use strict';

/**
 * Plano 091 (#1, D558, D559): o portao do commit. Commit com arquivo de codigo mudado na sessao (Write/Edit, o
 * `arquivosTocados` do estado) que ainda difere do HEAD e nao tem revisao aprovada (`revisadosAprovados`, gravado pelo
 * apurar-ronda.js no "aprovado") e negado com a lista, a faixa de cada um (D485, a mesma do preparar-revisao.js) e a
 * ordem de rodar o /sworn:review. Texto (.md, .txt) fica fora. A saida de emergencia e visivel: a marca
 * "# sworn: sem-revisao" no comando, so depois do sim do dono. Texto do motivo em ASCII (D532), o do mock.
 */
const fs = require('node:fs');
const path = require('node:path');
const git = require('./git.js');
const veredito = require('./veredito.js');

const MAX_CITADOS = 5;
const MARCA = '# sworn: sem-revisao';

/** O que esta entre aspas (mensagem, caminho) vira um marcador: nao e comando, e o `-C "pasta"` segue com argumento. */
function semAspas(comando) {
  return String(comando).replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, 'Q');
}

/**
 * O comando roda um `git commit` (com opcoes globais antes, como -C/-c/--no-pager/--git-dir=, depois de cd,
 * encadeado, ou com o executavel por caminho ou .exe)? Entre aspas nao conta.
 */
function ehCommit(comando) {
  if (typeof comando !== 'string' || !comando) return false;
  return /(?:^|[\s;&|(/\\])git(?:\.exe)?(?:\s+(?:-[cC]\s+\S+|--?[A-Za-z][\w-]*(?:=\S+)?))*\s+commit(?![\w-])/
    .test(semAspas(comando));
}

/** A marca de commit sem revisao, fora de aspas. */
function semRevisao(comando) {
  return typeof comando === 'string' && /#\s*sworn:\s*sem-revisao\b/.test(semAspas(comando));
}

/** A pasta onde o commit roda: o `git -C <pasta>`, ou o ultimo `cd <pasta>` antes do commit; sem nenhum, null. */
function pastaDoComando(comando) {
  const c = String(comando || '');
  const valor = function (m) { return m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4]); };
  // A2-01: o -C que vale e o das opcoes do proprio `git ... commit` (a forma do ehCommit, com o valor entre aspas); o de
  // um `git -C <outro> status` antes dele media o outro repositorio.
  // O conteudo entre aspas vira Q do mesmo tamanho (as posicoes seguem as de `c`): `echo "git commit"` nao e o commit,
  // e `-c user.name="a b"` e uma opcao so.
  const mascara = c.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, function (m) { return m[0] + 'Q'.repeat(m.length - 2) + m[m.length - 1]; });
  const gc = /\bgit(?:\.exe)?((?:\s+(?:-[cC]\s+(?:"[^"]*"|'[^']*'|\S+)|--?[A-Za-z][\w-]*(?:=\S+)?))*)\s+commit(?![\w-])/.exec(mascara);
  const fim = gc ? gc.index : -1;
  const opcoes = gc ? c.substr(gc.index + /^git(?:\.exe)?/.exec(gc[0])[0].length, gc[1].length) : '';
  const comC = gc && /(?:^|\s)-C\s+(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(opcoes);
  if (comC) return comC[1] !== undefined ? comC[1] : (comC[2] !== undefined ? comC[2] : comC[3]);
  const ate = fim === -1 ? c : c.slice(0, fim);
  const re = /(?:^|[\s;&|(])cd\s+("([^"]*)"|'([^']*)'|([^\s;&|)]+))/g;
  let m;
  let ultima = null;
  while ((m = re.exec(ate)) !== null) ultima = valor(m);
  return ultima;
}

/** Quantos inspetores a faixa pede: a das faixas pequenas, ou a familia inteira na completa (estilo = tela). */
function inspetores(faixa, estilo) {
  const lentes = veredito.lentesDaFaixa(faixa);
  if (lentes) return lentes.length;
  return estilo ? veredito.LENTES_UI.length : veredito.LENTES.length;
}

const chave = function (p) { return path.resolve(String(p)).toLowerCase(); };

/** Texto fica fora do portao (do commit e, D655, do fecho da marcha AAA). */
function ehTexto(p) { return /\.(md|markdown|txt)$/i.test(String(p)); }

/** D655: `arquivo` esta na lista de aprovados (a mesma comparacao do `pendentes`). Lista torta = nenhum. */
function aprovado(aprovados, arquivo) {
  const k = chave(arquivo);
  return (Array.isArray(aprovados) ? aprovados : []).some(function (a) { return typeof a === 'string' && chave(a) === k; });
}

/** A raiz do repositorio git de `pasta`, ou null fora de repositorio. */
function topo(pasta) {
  const s = git.correr(pasta, ['rev-parse', '--show-toplevel']);
  return s === null ? null : s.trim();
}

/**
 * Um arquivo tocado: { faixa, inspetores } se e codigo, existe e difere do HEAD (ou e novo e o git nao o ignora); senao
 * null. Fora de repositorio ele mediria "novo": quem chama confere o repositorio antes (`pendentes`, D575). `estilo` vem do chamador (regra do design.js, relativa a raiz do projeto).
 */
function medir(abs, estilo) {
  if (ehTexto(abs) || !fs.existsSync(abs)) return null;
  const pasta = path.dirname(abs);
  const nome = path.basename(abs);
  const novo = git.correr(pasta, ['cat-file', '-e', 'HEAD:./' + nome]) === null;
  let faixa;
  // Plano 091 #8: as linhas acrescentadas contra o HEAD (null = todas: arquivo novo, ou diff que nao se mediu).
  let novas = null;
  if (novo) {
    if (git.correr(pasta, ['check-ignore', '-q', '--', nome]) !== null) return null;
    faixa = 'completa';
  } else {
    const diff = git.diffContraHead(pasta, nome);
    if (diff && diff.blocos.length === 0) return null;
    faixa = veredito.faixaDaMudanca({ linhasMudadas: diff ? Math.max(diff.removidas, diff.acrescentadas) : null,
      estilo: estilo });
    if (diff) {
      novas = new Set();
      for (const b of diff.blocos) for (let n = b.novoIni; n < b.novoIni + b.novoQtd; n++) novas.add(n);
    }
  }
  return { faixa: faixa, inspetores: inspetores(faixa, estilo), novas: novas };
}

/** Plano 091 #8: as linhas dos atalhos sem gatilho que a mudanca acrescentou em `abs`. */
function atalhosNovos(abs, novas, marcas) {
  const atalhos = require('./atalhos.js');
  return atalhos.varrer([abs], atalhos.lerArquivo, marcas)
    .filter(function (a) { return !a.gatilho && (novas === null || novas.has(a.linha)); })
    .map(function (a) { return a.linha; });
}

/**
 * Os arquivos que barram o commit, na ordem em que foram tocados: [{ rel, faixa, inspetores, atalhos }]. So os do
 * repositorio do commit (`topoDoCommit`; null = todos) e fora dos `aprovados`. `ehEstilo(rel)` diz se o arquivo e de
 * tela. `marcas` (lista do atalhos.js; sem ela, nenhuma) da as linhas dos atalhos novos sem gatilho em `atalhos`.
 */
function pendentes(arquivos, aprovados, raiz, topoDoCommit, ehEstilo, marcas) {
  if (!Array.isArray(arquivos)) return [];
  const ok = new Set((Array.isArray(aprovados) ? aprovados : []).map(chave));
  const lista = [];
  for (const a of arquivos) {
    if (typeof a !== 'string' || ok.has(chave(a))) continue;
    const abs = path.resolve(raiz, a);
    const rel = require('./glob.js').normalizar(path.relative(raiz, abs));
    // D575: fora de qualquer repositorio (instrumento do scratchpad) nunca conta, mesmo com topoDoCommit null (`cd "$D"`).
    const t = topo(path.dirname(abs));
    if (!t || (topoDoCommit && chave(t) !== chave(topoDoCommit))) continue;
    const m = medir(abs, typeof ehEstilo === 'function' && ehEstilo(rel) === true);
    if (m) lista.push({ rel: rel, faixa: m.faixa, inspetores: m.inspetores,
      atalhos: Array.isArray(marcas) && marcas.length ? atalhosNovos(abs, m.novas, marcas) : [] });
  }
  return lista;
}

/** O motivo da negacao, no texto do mock: nomes alinhados, faixa e inspetores de cada um; os atalhos novos sem gatilho. */
function motivo(lista) {
  const ascii = require('./escopo.js').ascii;
  const citados = lista.slice(0, MAX_CITADOS).map(function (p) { return { nome: '"' + ascii(p.rel) + '"', p: p }; });
  const largura = citados.reduce(function (n, c) { return Math.max(n, c.nome.length); }, 0) + 3;
  const linhas = citados.map(function (c) {
    return '  - ' + c.nome.padEnd(largura) + 'faixa ' + c.p.faixa + ', ' + c.p.inspetores +
      (c.p.inspetores === 1 ? ' inspetor' : ' inspetores');
  });
  if (lista.length > MAX_CITADOS) linhas.push('  - e mais ' + (lista.length - MAX_CITADOS));
  const atalhos = [];
  for (const p of lista) for (const n of (Array.isArray(p.atalhos) ? p.atalhos : [])) atalhos.push('"' + ascii(p.rel) + ':' + n + '"');
  const passos = ['  1. rode /sworn:review "<arquivo>" para cada um, ate sair "aprovado";'];
  if (atalhos.length) {
    linhas.push('Atalho novo sem gatilho:');
    for (const a of atalhos.slice(0, MAX_CITADOS)) linhas.push('  - ' + a);
    if (atalhos.length > MAX_CITADOS) linhas.push('  - e mais ' + (atalhos.length - MAX_CITADOS));
    passos.push('  2. escreva "trocar quando: ..." no atalho sem gatilho;');
  }
  passos.push('  ' + (passos.length + 1) + '. rode o commit de novo.');
  return [
    'sworn - commit parado: falta a revisao antes do commit.',
    '',
    'Arquivos de codigo mudados nesta sessao sem revisao aprovada:'
  ].concat(linhas, [
    '',
    'Faca agora:'
  ], passos, [
    'Se o usuario quer este commit sem revisao, pergunte em 3 opcoes; com o sim,',
    'repita o commit com "' + MARCA + '" no fim do comando.',
    'Desligar neste projeto: "portaoCommit": false em .claude/sworn/projeto.json.'
  ]).join('\n');
}

/** A lista de aprovados sem `arquivo` (editado de novo: volta a cobrar). Lista torta = vazia. */
function semAprovado(aprovados, arquivo) {
  const k = chave(arquivo);
  return (Array.isArray(aprovados) ? aprovados : []).filter(function (a) { return chave(a) !== k; });
}

/** A lista de aprovados com `arquivo` (absoluto), sem repetir. */
function comAprovado(aprovados, arquivo) {
  return semAprovado(aprovados, arquivo).concat([path.resolve(String(arquivo))]);
}

module.exports = { MARCA, ehCommit, semRevisao, pastaDoComando, inspetores, topo, pendentes, motivo, semAprovado,
  comAprovado, ehTexto, aprovado };
