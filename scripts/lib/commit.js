'use strict';

/**
 * Plano 091 (#1, D558, D559): o portao do commit. Commit com arquivo de codigo mudado na sessao (Write/Edit, o
 * `arquivosTocados` do estado) que ainda difere do HEAD e nao tem revisao aprovada (`revisadosAprovados`, gravado pelo
 * apurar-ronda.js no "aprovado") e negado com a lista, a faixa de cada um (D485, a mesma do preparar-revisao.js) e a
 * ordem de rodar o /sworn:review. Texto (.md, .txt) fica fora, e o JS ou TS que so mudou comentario ou espaco tambem
 * (H1-custo, so-comentario.js). A saida de emergencia e visivel: a marca
 * "# sworn: sem-revisao" no comando, so depois do sim do dono. Texto do motivo em ASCII (D532), o do mock.
 */
const fs = require('node:fs');
const path = require('node:path');
const git = require('./git.js');
const veredito = require('./veredito.js');

const MAX_CITADOS = 5;
const MARCA = '# sworn: sem-revisao';

/*
 * A2-10/A2-20 (H1): o comando se le pelo leitor de shell do estilo-shell.js (aspas, escape, heredoc, continuacao de
 * linha e o de dentro de bash -c, eval, cmd /c e powershell -Command), e nao mais por regex sobre o texto com as aspas
 * mascaradas. O idioma vem da ferramenta: 'PowerShell' le como PowerShell (`-C "C:\x\"` fecha a aspa, L2-s103-08),
 * 'Bash' como bash; sem ferramenta, o ehCommit le dos dois jeitos e basta um achar o commit (o portao nao libera
 * por ter lido no idioma errado). Sem ferramenta, a marca sai da leitura do bash, e a pasta da primeira leitura que
 * acha a chamada (a do bash, se ela acha).
 * atalho: o apelido do git (`git ci`, alias.ci = commit) nao se le. limite: o commit por apelido passa sem o portao.
 * trocar quando: um apelido de commit aparecer no uso real (ler `git config --get alias.<sub>` so para o subcomando
 * que o git nao tem).
 */
const shell = require('./estilo-shell.js');

// As opcoes globais do git que levam o valor na palavra seguinte (`--git-dir X`); as outras, ou ficam sozinhas
// (--no-pager, -p), ou levam o valor colado (`--git-dir=X`).
const GLOBAL_COM_VALOR = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);
// Os programas que trocam a pasta do shell; o PowerShell tem os dele (Set-Location e o apelido sl).
const TROCA_PASTA = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl']);

/** As leituras do comando: [true] (PowerShell), [false] (bash) ou, sem ferramenta, as duas, a do bash primeiro. */
function idiomas(ferramenta) {
  if (ferramenta === 'PowerShell') return [true];
  if (ferramenta === 'Bash') return [false];
  return [false, true];
}

/** Um comando simples que roda o git: { sub, args, pastas } (as pastas dos -C, na ordem) ou null. */
function lerGit(cmd) {
  const prog = shell.programa(cmd);
  if (!prog || prog.nome !== 'git') return null;
  const a = prog.args;
  const pastas = [];
  let i = 0;
  while (i < a.length && /^-/.test(a[i].t)) {
    if (!GLOBAL_COM_VALOR.has(a[i].t)) { i++; continue; }
    if (a[i].t === '-C' && i + 1 < a.length) pastas.push(a[i + 1].t);
    i += 2;
  }
  return i < a.length ? { sub: a[i].t, args: a.slice(i + 1), pastas: pastas } : null;
}

/** A pasta `p` vista de `base` (null = a do shell): a absoluta fica, a relativa se junta a base. */
function juntar(base, p) {
  if (base === null || /^(?:[A-Za-z]:|[\\/~])/.test(p)) return p;
  return base.replace(/[\\/]+$/, '') + '/' + p;
}

/**
 * O alvo de um `cd`: a primeira palavra que nao e opcao (no PowerShell, tambem o valor de -Path/-LiteralPath); `-`
 * sozinho e a volta a pasta de antes, e fica '-'.
 */
function alvoDoCd(args, ps) {
  for (let i = 0; i < args.length; i++) {
    const t = args[i].t;
    if (t === '-') return '-';
    if (ps && /^-(?:literal)?path$/i.test(t)) return i + 1 < args.length ? args[i + 1].t : null;
    if (!/^-/.test(t) && t !== '') return t;
  }
  // sem pasta, o cd do bash vai para o HOME ('~', que fica sem expandir: o portao nao acha repositorio ali e cobra
  // os de todos); o Set-Location sozinho do PowerShell 5.1 nao muda a pasta
  return ps ? null : '~';
}

/**
 * A primeira chamada `git <sub>` do comando, lido no idioma `ps`, e a pasta onde ela roda: { sub, args, pastas, pasta }
 * ou null. A pasta e a do ultimo `cd` antes dela, com os `-C` dela por cima, na ordem (A2-01: o -C de outro git antes
 * nao conta; L2-s103-10: `-C a -C b` e a/b; L2-s103-09: `-C ""` nao muda a pasta, como no git); sem nenhum, null.
 * `cd -` volta: no bash, a pasta do cd anterior (dois `cd -` voltam ao ponto); no PowerShell, um passo atras na
 * historia (dois `cd -` voltam dois passos). Sem cd anterior no comando, a pasta de antes e a do shell (null).
 * limite: o shell guarda a pasta de antes entre comandos; aqui ela comeca na do shell a cada comando.
 */
function chamadaNoIdioma(comando, ps, sub) {
  let cd = null;
  const historia = []; // as pastas de antes, a mais recente no fim; o bash so olha a ultima
  for (const cmd of shell.comandosSimples(comando, ps)) {
    const prog = shell.programa(cmd);
    if (!prog) continue;
    if (TROCA_PASTA.has(prog.nome)) {
      const alvo = alvoDoCd(prog.args, cmd.ps);
      if (alvo === '-') {
        const volta = historia.length ? historia.pop() : null;
        if (!cmd.ps) historia.push(cd); // no bash, a de agora vira a de antes (OLDPWD)
        cd = volta;
      } else if (alvo !== null) { historia.push(cd); cd = juntar(cd, alvo); }
      continue;
    }
    const g = lerGit(cmd);
    if (!g || g.sub !== sub) continue;
    let pasta = cd;
    for (const p of g.pastas) if (p !== '') pasta = juntar(pasta, p);
    g.pasta = pasta;
    return g;
  }
  return null;
}

/** A primeira chamada `git <sub>` em alguma das leituras da `ferramenta` (a primeira leitura que acha), ou null. */
function chamadaGit(comando, ferramenta, sub) {
  if (typeof comando !== 'string' || !comando) return null;
  for (const ps of idiomas(ferramenta)) {
    const g = chamadaNoIdioma(comando, ps, sub);
    if (g) return g;
  }
  return null;
}

/** O comando roda um `git commit`? Entre aspas, em heredoc ou em comentario nao conta. */
function ehCommit(comando, ferramenta) {
  return chamadaGit(comando, ferramenta, 'commit') !== null;
}

/** Algum comentario do comando (do primeiro nivel, lido no idioma da ferramenta) tem a marca `re`? */
function temMarca(comando, ferramenta, re) {
  if (typeof comando !== 'string' || !comando) return false;
  const ps = idiomas(ferramenta)[0];
  return shell.lerShell(comando, ps).comentarios.some(function (c) { return re.test(c); });
}

/** A marca de commit sem revisao, num comentario do comando (entre aspas ou num heredoc nao vale). */
function semRevisao(comando, ferramenta) {
  return temMarca(comando, ferramenta, /^#\s*sworn:\s*sem-revisao\b/);
}

/**
 * A pasta onde o `git <sub>` roda (`sub` = 'commit' sem ele; o push.js passa 'push'): os -C dele sobre o ultimo cd
 * antes; sem nenhum, ou sem a chamada, null.
 */
function pastaDoComando(comando, ferramenta, sub) {
  const g = chamadaGit(comando, ferramenta, sub || 'commit');
  return g ? g.pasta : null;
}

/** Quantos inspetores a faixa pede: a das faixas pequenas, ou a familia inteira na completa (estilo = tela, com a
 *  lente do pedido, D825). */
function inspetores(faixa, estilo) {
  const lentes = veredito.lentesDaFaixa(faixa);
  if (lentes) return lentes.length;
  return estilo ? veredito.lentesSoTela().length : veredito.LENTES.length;
}

/**
 * A chave de comparacao de um caminho: o absoluto, sem caixa so no Windows (A2-21), onde o disco nao a distingue. Nos
 * outros sistemas a caixa conta: o caminho de outra caixa nao vale pelo aprovado, e o portao cobra de novo em vez de
 * liberar a mais. `plataforma` existe para o teste; sem ela, a do processo.
 */
function chave(p, plataforma) {
  return semCaixa(path.resolve(String(p)), plataforma);
}

/** O texto `t` sem caixa so no Windows (a `plataforma`; sem ela, a do processo): a regra da `chave` e do lote. */
function semCaixa(t, plataforma) {
  return (plataforma || process.platform) === 'win32' ? t.toLowerCase() : t;
}

/** Texto fica fora do portao (do commit e, D655, do fecho da marcha AAA). */
function ehTexto(p) { return /\.(md|markdown|txt)$/i.test(String(p)); }

/** D655: `arquivo` esta na lista de aprovados (o `pendentes` usa esta, A2-31). Lista torta = nenhum. */
function aprovado(aprovados, arquivo) {
  const k = chave(arquivo);
  return (Array.isArray(aprovados) ? aprovados : []).some(function (a) { return typeof a === 'string' && chave(a) === k; });
}

/**
 * A raiz do repositorio git de `pasta`, ou null fora de repositorio. `falha` (opcional, um objeto) recebe
 * `timeout: true` quando o null e do git que nao respondeu no prazo (D844), e nao de "fora do repositorio".
 */
function topo(pasta, falha) {
  const s = git.correr(pasta, ['rev-parse', '--show-toplevel'], falha ? { falha: falha } : undefined);
  return s === null ? null : s.trim();
}

/** As linhas acrescentadas de um diff do diffContraHead, ou null sem diff (todas contam). */
function linhasNovas(diff) {
  if (!diff) return null;
  const novas = new Set();
  for (const b of diff.blocos) for (let n = b.novoIni; n < b.novoIni + b.novoQtd; n++) novas.add(n);
  return novas;
}

/**
 * Um arquivo tocado: { faixa, inspetores, novas } se e codigo, existe e difere do HEAD (ou e novo e o git nao o ignora);
 * senao null. Fora de repositorio ele mediria "novo": quem chama confere o repositorio antes (`pendentes`, D575).
 * `estilo` vem do chamador (regra do design.js, relativa a raiz do projeto). `blob`: o do HEAD ('' = o HEAD nao tem);
 * sem ele, o `cat-file -e` pergunta. `doLote` (A2-12): o que o lote do git ja disse, { ignorado } no novo ou { conta } no
 * do HEAD (conta null = igual ao HEAD; { linhas } com linhas null no binario); sem ele, um git deste arquivo pergunta.
 * `novas` (Plano 091 #8): a funcao que da as linhas acrescentadas contra o HEAD (null = todas: arquivo novo, ou diff
 * que nao se mediu); no do lote ela so roda o diff do arquivo quando e chamada, isto e, quando ha atalho a conferir.
 */
function medir(abs, estilo, blob, doLote) {
  if (ehTexto(abs) || !fs.existsSync(abs)) return null;
  const pasta = path.dirname(abs);
  const nome = path.basename(abs);
  const lote = doLote || {};
  const novo = typeof blob === 'string' ? blob === '' : git.correr(pasta, ['cat-file', '-e', 'HEAD:./' + nome]) === null;
  let faixa;
  let novas;
  if (novo) {
    const ignorado = typeof lote.ignorado === 'boolean' ? lote.ignorado
      : git.correr(pasta, ['check-ignore', '-q', '--', nome]) !== null;
    if (ignorado) return null;
    faixa = 'completa';
    novas = function () { return null; };
  } else if (lote.conta !== undefined) {
    if (lote.conta === null) return null;
    faixa = veredito.faixaDaMudanca({ linhasMudadas: lote.conta.linhas, estilo: estilo });
    novas = function () { return linhasNovas(git.diffContraHead(pasta, nome)); };
  } else {
    const diff = git.diffContraHead(pasta, nome);
    if (diff && diff.blocos.length === 0) return null;
    faixa = veredito.faixaDaMudanca({ linhasMudadas: diff ? Math.max(diff.removidas, diff.acrescentadas) : null,
      estilo: estilo });
    const jaLidas = linhasNovas(diff);
    novas = function () { return jaLidas; };
  }
  return { faixa: faixa, inspetores: inspetores(faixa, estilo), novas: novas };
}

/** Plano 091 #8: as linhas dos atalhos sem gatilho que a mudanca acrescentou em `abs` (`novas`: a do `medir`). */
function atalhosNovos(abs, novas, marcas) {
  const atalhos = require('./atalhos.js');
  const semGatilho = atalhos.varrer([abs], atalhos.lerArquivo, marcas).filter(function (a) { return !a.gatilho; });
  if (!semGatilho.length) return [];
  const linhas = novas();
  return semGatilho.filter(function (a) { return linhas === null || linhas.has(a.linha); }).map(function (a) { return a.linha; });
}

// A2-12 (H1): quantos caminhos vao num git so do lote; a linha de comando do Windows tem tamanho fixo.
const CAMINHOS_POR_GIT = 100;
const SAIDA_DO_LOTE = 16 * 1024 * 1024;

/** A chave de um caminho relativo dentro do lote: sem caixa so no Windows, como a `chave`. */
function chaveRel(rel) { return semCaixa(rel); }

/** Os campos de uma saida `-z` do git, sem os vazios. */
function porNulo(s) { return s.split('\0').filter(function (c) { return c !== ''; }); }

/** Roda `args` + cada pedaco de `rels` (com `prefixo` em cada caminho) e junta as saidas; null se um git falhar. */
function emPedacos(topoAbs, args, rels, prefixo) {
  let saida = '';
  for (let i = 0; i < rels.length; i += CAMINHOS_POR_GIT) {
    const pedaco = rels.slice(i, i + CAMINHOS_POR_GIT).map(function (r) { return prefixo + r; });
    const s = git.correr(topoAbs, args.concat(pedaco), { maxBuffer: SAIDA_DO_LOTE });
    if (s === null) return null;
    saida += s;
  }
  return saida;
}

/**
 * A2-12 (H1): o que o git diz dos arquivos `rels` (relativos a raiz `topoAbs`) em ate tres gits por pedaco, em vez de
 * dois por arquivo: `blobs` (rel -> blob do HEAD, so os que o HEAD tem), `vistos` (os novos que o git nao ignora) e
 * `contas` (rel -> { linhas }, so os que diferem do HEAD; linhas null no binario). Chaves pela `chaveRel`. Sem o HEAD
 * (repositorio sem commit) ou com o git falhando nos blobs, null; `vistos` ou `contas` que falham ficam null. Em todo
 * null, quem chama mede aquele arquivo um a um, como antes.
 */
function lote(topoAbs, rels) {
  const arvore = emPedacos(topoAbs, ['ls-tree', '-z', 'HEAD', '--'], rels, '');
  if (arvore === null) return null;
  const blobs = new Map();
  for (const l of porNulo(arvore)) {
    const m = /^\d+ blob ([0-9a-f]+)\t([\s\S]+)$/.exec(l);
    if (m) blobs.set(chaveRel(m[2]), m[1]);
  }
  const novos = [];
  const velhos = [];
  for (const r of rels) (blobs.has(chaveRel(r)) ? velhos : novos).push(r);
  let vistos = new Set();
  if (novos.length) {
    const s = emPedacos(topoAbs, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--'], novos, ':(literal)');
    vistos = s === null ? null : new Set(porNulo(s).map(chaveRel));
  }
  let contas = new Map();
  if (velhos.length) {
    const s = emPedacos(topoAbs, ['diff', '--numstat', '-z', '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv',
      '--ignore-cr-at-eol', 'HEAD', '--'], velhos, ':(literal)');
    if (s === null) contas = null;
    else {
      for (const l of porNulo(s)) {
        const m = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(l);
        if (!m) continue;
        const binario = m[1] === '-' || m[2] === '-';
        // so modo ou so fim de linha mudou: igual ao HEAD, como o diff sem bloco
        if (!binario && Number(m[1]) + Number(m[2]) === 0) continue;
        contas.set(chaveRel(m[3]), { linhas: binario ? null : Math.max(Number(m[1]), Number(m[2])) });
      }
    }
  }
  return { blobs: blobs, vistos: vistos, contas: contas };
}

/** O caminho de `abs` relativo a raiz `topoAbs`, pelo caminho real (o nome curto do Windows, WENDEL~1, vira o longo);
 *  null quando ele nao fica dentro da raiz (quem chama mede um a um). */
function dentroDoTopo(topoAbs, abs) {
  let real = abs;
  try { real = fs.realpathSync.native(abs); } catch (e) { /* fica o caminho dado */ } // fail-open: sem o real, o relativo pode sair com ".." e o arquivo cai no caminho de um a um
  const rel = path.relative(topoAbs, real);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

/** O blob de `abs` no HEAD do repositorio dele; '' no arquivo que o HEAD nao tem (novo) e fora de repositorio. */
function blobNoHead(abs) {
  const s = git.correr(path.dirname(abs), ['rev-parse', 'HEAD:./' + path.basename(abs)]);
  return s === null ? '' : s.trim();
}

const ehMapa = function (v) { return Boolean(v) && typeof v === 'object' && !Array.isArray(v); };

/** F2a (D828.3): as marcas de teto ({ caminho: blob no HEAD }) sem a de `arquivo`. Entrada torta = sem marca nenhuma. */
function semTeto(tetos, arquivo) {
  const k = chave(arquivo);
  const novo = {};
  for (const c of Object.keys(ehMapa(tetos) ? tetos : {})) if (chave(c) !== k) novo[c] = tetos[c];
  return novo;
}

/** As marcas de teto com a de `arquivo` (absoluto): a revisao dele fechou no teto com o HEAD de agora. */
function comTeto(tetos, arquivo) {
  const novo = semTeto(tetos, arquivo);
  const abs = path.resolve(String(arquivo));
  novo[abs] = blobNoHead(abs);
  return novo;
}

/**
 * A revisao de `abs` fechou no teto e o HEAD dele ainda e o daquela hora? Editar o arquivo nao tira a marca (o conserto
 * depois do teto e esperado); o commit feito a vence, porque o blob do HEAD muda. Marca que nao e texto nao vale.
 */
function noTeto(tetos, abs, blob) {
  if (!ehMapa(tetos)) return false;
  const k = chave(abs);
  const c = Object.keys(tetos).find(function (x) { return chave(x) === k; });
  // F1h: o blob que o pendentes ja leu vale; sem ele, pergunta ao git
  return c !== undefined && tetos[c] === (typeof blob === 'string' ? blob : blobNoHead(abs));
}

/**
 * Os arquivos que barram o commit, na ordem em que foram tocados: [{ rel, faixa, inspetores, atalhos, teto }]. So os do
 * repositorio do commit (`topoDoCommit`; null = todos) e fora dos `aprovados`. `ehEstilo(rel)` diz se o arquivo e de
 * tela. `marcas` (lista do atalhos.js; sem ela, nenhuma) da as linhas dos atalhos novos sem gatilho em `atalhos`.
 * `tetos` (o `revisadosNoTeto` do estado; sem ele, nenhum) diz em `teto` se a revisao do arquivo fechou no teto.
 * D844: o arquivo cujo repositorio o git nao disse no prazo entra como { rel, semResposta: true }: sem saber o
 * repositorio, o portao nao libera.
 * A2-12 (H1): um git de raiz por pasta (F1g) e, por repositorio, o `lote` (blob, ignorado e tamanho da mudanca de
 * todos os arquivos dele de uma vez); o que o lote nao respondeu se mede um a um, como antes.
 * H1-custo (D868): o JS ou TS que difere do HEAD so em comentario ou espaco (soComentarioNoLote) fica fora, salvo com
 * atalho novo sem gatilho.
 */
function pendentes(arquivos, aprovados, raiz, topoDoCommit, ehEstilo, marcas, tetos) {
  if (!Array.isArray(arquivos)) return [];
  const glob = require('./glob.js');
  const itens = [];
  // o memo vive so nesta chamada (o repositorio nao muda nela)
  const topos = new Map();
  for (const a of arquivos) {
    if (typeof a !== 'string' || aprovado(aprovados, a)) continue;
    const abs = path.resolve(raiz, a);
    // F1h: texto e arquivo que nao existe o medir nunca conta, entao nao gastam git
    if (ehTexto(abs) || !fs.existsSync(abs)) continue;
    const rel = glob.normalizar(path.relative(raiz, abs));
    const pasta = path.dirname(abs);
    if (!topos.has(pasta)) {
      const falha = {};
      const raizDoGit = topo(pasta, falha);
      topos.set(pasta, { raiz: raizDoGit, lento: falha.timeout === true });
    }
    const t = topos.get(pasta);
    if (t.lento) { itens.push({ rel: rel, semResposta: true }); continue; }
    // D575: fora de qualquer repositorio (instrumento do scratchpad) nunca conta, mesmo com topoDoCommit null (`cd "$D"`).
    if (!t.raiz || (topoDoCommit && chave(t.raiz) !== chave(topoDoCommit))) continue;
    itens.push({ rel: rel, abs: abs, topo: t.raiz, doTopo: dentroDoTopo(t.raiz, abs) });
  }
  // os relativos de cada repositorio, numa passada; depois um lote por repositorio
  const porTopo = new Map();
  for (const it of itens) {
    if (it.semResposta || it.doTopo === null) continue;
    const k = chave(it.topo);
    if (!porTopo.has(k)) porTopo.set(k, { topo: it.topo, rels: [] });
    porTopo.get(k).rels.push(it.doTopo);
  }
  const lotes = new Map();
  // por repositorio, os arquivos cuja mudanca contra o HEAD e so comentario ou espaco
  const soDeComentario = new Map();
  for (const [k, g] of porTopo) {
    const l = lote(g.topo, g.rels);
    lotes.set(k, l);
    let conjunto;
    try { conjunto = soComentarioNoLote(g.topo, l, g.rels); } catch (e) { conjunto = new Set(); } // fail-closed: o erro do leitor deixa todos pendentes
    soDeComentario.set(k, conjunto);
  }
  const lista = [];
  for (const it of itens) {
    if (it.semResposta) { lista.push({ rel: it.rel, semResposta: true }); continue; }
    const l = it.doTopo === null ? null : lotes.get(chave(it.topo));
    const soComentario = it.doTopo !== null && soDeComentario.get(chave(it.topo)).has(chaveRel(it.doTopo));
    let blob;
    let doLote;
    if (l) {
      const k = chaveRel(it.doTopo);
      blob = l.blobs.has(k) ? l.blobs.get(k) : '';
      if (blob === '' && l.vistos) doLote = { ignorado: !l.vistos.has(k) };
      else if (blob !== '' && l.contas) doLote = { conta: l.contas.has(k) ? l.contas.get(k) : null };
    }
    const m = medir(it.abs, typeof ehEstilo === 'function' && ehEstilo(it.rel) === true, blob, doLote);
    if (!m) continue;
    const atalhos = Array.isArray(marcas) && marcas.length ? atalhosNovos(it.abs, m.novas, marcas) : [];
    // H1-custo (D868): o diff so de comentario ou espaco nao pede revisao, salvo o atalho novo sem gatilho
    if (soComentario && !atalhos.length) continue;
    lista.push({ rel: it.rel, faixa: m.faixa, inspetores: m.inspetores, atalhos: atalhos, teto: noTeto(tetos, it.abs, blob) });
  }
  return lista;
}

// H1-custo: acima disto o arquivo nao se le para a conta do so-comentario (segue pendente, como antes)
const TAMANHO_DO_SO_COMENTARIO = 2 * 1024 * 1024;

/**
 * H1-custo (D868): as chaves (chaveRel) dos arquivos JS ou TS de `rels` que diferem do HEAD so em comentario ou espaco
 * (so-comentario.js). O texto do HEAD de todos vem num `git grep` por pedaco, e nao num git por arquivo.
 * Fail-closed: lote null, git que falha, arquivo binario, grande ou que nao se le, e o leitor em duvida deixam o
 * arquivo fora do conjunto, e ele segue pendente como antes.
 */
function soComentarioNoLote(topoAbs, l, rels) {
  const conjunto = new Set();
  if (!l || !l.contas) return conjunto;
  const sc = require('./so-comentario.js');
  const candidatos = rels.filter(function (r) {
    const k = chaveRel(r);
    const conta = l.contas.get(k);
    // o nome com quebra de linha fica fora: a saida do grep se corta por linha, e ele forjaria o texto de outro arquivo
    return sc.EXTENSOES.test(r) && !/[\r\n]/.test(r) && !!conta && conta.linhas !== null;
  });
  if (!candidatos.length) return conjunto;
  // -e '' casa toda linha; -z separa o nome e o numero da linha por NUL; as flags explicitas vencem a config grep.*
  const saida = emPedacos(topoAbs, ['grep', '-n', '-z', '--full-name', '--no-color', '--no-column', '-I',
    '--basic-regexp', '-e', '', 'HEAD', '--'], candidatos, ':(literal)');
  if (saida === null) return conjunto;
  const doHead = new Map();
  for (const linha of saida.split('\n')) {
    const a = linha.indexOf('\0');
    const b = a === -1 ? -1 : linha.indexOf('\0', a + 1);
    if (b === -1 || !linha.startsWith('HEAD:')) continue;
    const k = chaveRel(linha.slice(5, a));
    if (!doHead.has(k)) doHead.set(k, []);
    doHead.get(k).push(linha.slice(b + 1));
  }
  for (const r of candidatos) {
    const k = chaveRel(r);
    if (!doHead.has(k)) continue;
    let atual;
    try {
      const abs = path.join(topoAbs, r);
      if (fs.statSync(abs).size > TAMANHO_DO_SO_COMENTARIO) continue;
      atual = fs.readFileSync(abs, 'utf8');
    } catch (e) { continue; } // fail-closed: o arquivo que nao se le segue pendente
    if (sc.soComentario(doHead.get(k).join('\n'), atual)) conjunto.add(k);
  }
  return conjunto;
}

/** Ate MAX_CITADOS itens, cada um numa linha `  - <item>`, e a linha `  - e mais N` com o que passou. */
function citar(itens) {
  const linhas = itens.slice(0, MAX_CITADOS).map(function (i) { return '  - ' + i; });
  if (itens.length > MAX_CITADOS) linhas.push('  - e mais ' + (itens.length - MAX_CITADOS));
  return linhas;
}

// A11-09 (H1): o portao so para o commit com o projeto.json lido, entao o arquivo existe quando este texto aparece.
const DESLIGAR = 'So o dono desliga esta parada do commit neste projeto: "portaoCommit": false em .claude/sworn/projeto.json.';

/**
 * O motivo da negacao, no texto do mock: nomes alinhados, faixa e inspetores de cada um; os atalhos novos sem gatilho.
 * F2a (D828.3): o arquivo com a revisao fechada no teto nao se revisa de novo; com todos nesse caso, o texto manda
 * conferir a mutacao, rodar a suite, registrar o que ficou aberto e commitar com a marca, sem perguntar.
 */
function motivo(lista) {
  const ascii = require('./escopo.js').ascii;
  const nome = function (p) { return '"' + ascii(p.rel) + '"'; };
  const noTetoDaLista = lista.filter(function (p) { return p.teto === true; });
  const semRevisaoFeita = lista.filter(function (p) { return p.teto !== true; });
  const atalhos = [];
  for (const p of lista) for (const n of (Array.isArray(p.atalhos) ? p.atalhos : [])) atalhos.push('"' + ascii(p.rel) + ':' + n + '"');
  const blocoDosAtalhos = atalhos.length
    ? ['Atalho novo (simplificacao marcada no codigo) sem o "trocar quando:":'].concat(citar(atalhos)) : [];
  const passoDoAtalho = function (n) { return '  ' + n + '. escreva "trocar quando: ..." em cada atalho listado;'; };
  const teto = 'teto de ' + veredito.TETO + ' rondas';
  if (!semRevisaoFeita.length) {
    return [
      'sworn - commit parado: a revisao destes arquivos fechou no ' + teto + ', sem aprovar.',
      '',
      'Arquivos de codigo com a revisao fechada no teto:'
    ].concat(citar(noTetoDaLista.map(nome)), blocoDosAtalhos, [
      '',
      'Nao pergunte ao usuario. Faca agora:',
      '  1. confira que cada conserto feito depois do teto tem um teste que reprova quando o codigo e',
      '     estragado de proposito;',
      '  2. rode a suite inteira e espere o verde;',
      '  3. registre no plano o que a revisao deixou aberto;'
    ], atalhos.length ? [passoDoAtalho(4)] : [], [
      '  ' + (atalhos.length ? 5 : 4) + '. repita o commit com "' + MARCA + '" no fim do comando.',
      DESLIGAR
    ]).join('\n');
  }
  const citados = semRevisaoFeita.slice(0, MAX_CITADOS).map(function (p) { return { nome: nome(p), p: p }; });
  const largura = citados.reduce(function (n, c) { return Math.max(n, c.nome.length); }, 0) + 3;
  const linhas = citados.map(function (c) {
    return '  - ' + c.nome.padEnd(largura) + 'faixa ' + c.p.faixa + ', ' + c.p.inspetores +
      (c.p.inspetores === 1 ? ' inspetor' : ' inspetores');
  });
  if (semRevisaoFeita.length > MAX_CITADOS) linhas.push('  - e mais ' + (semRevisaoFeita.length - MAX_CITADOS));
  if (noTetoDaLista.length) {
    linhas.push('Com a revisao fechada no ' + teto + ' (nao se revisam de novo):');
    for (const l of citar(noTetoDaLista.map(nome))) linhas.push(l);
  }
  const passos = [noTetoDaLista.length
    ? '  1. rode /sworn:review "<arquivo>" so nos arquivos sem revisao aprovada (os do teto nao), ate sair "aprovado";'
    : '  1. rode /sworn:review "<arquivo>" para cada um, ate sair "aprovado";'];
  for (const l of blocoDosAtalhos) linhas.push(l);
  if (atalhos.length) passos.push(passoDoAtalho(2));
  // com arquivo no teto, o commit seguinte cai no ramo de cima, que da os passos deles
  passos.push('  ' + (passos.length + 1) + '. rode o commit de novo' +
    (noTetoDaLista.length ? ': ele para mais uma vez e diz o que fazer com os do teto.' : '.'));
  // A2-33: faixa, inspetor e atalho explicados na 1a vez; a chave de desligar diz o que desliga.
  return [
    'sworn - commit parado: falta a revisao antes do commit.',
    '',
    'Arquivos de codigo mudados nesta sessao sem revisao aprovada',
    '(faixa: o tamanho da revisao; inspetores: quantos revisores ela chama):'
  ].concat(linhas, [
    '',
    'Faca agora:'
  ], passos, [
    'Se o usuario quer este commit sem revisao, pergunte em 3 opcoes; com o sim,',
    'repita o commit com "' + MARCA + '" no fim do comando.',
    DESLIGAR
  ]).join('\n');
}

/**
 * D844: o motivo da negacao quando o git nao respondeu no prazo ao conferir o repositorio de algum arquivo. Nao e falta
 * de revisao: o portao nao soube se o arquivo e deste repositorio e nao libera sem saber.
 */
function motivoSemResposta(lista) {
  const ascii = require('./escopo.js').ascii;
  const ms = git.prazoDoCorrer();
  const prazo = ms % 1000 === 0 ? (ms / 1000) + ' s' : ms + ' ms';
  const lentos = (Array.isArray(lista) ? lista : []).filter(function (p) { return p && p.semResposta === true; });
  return [
    'sworn - commit parado: o git nao respondeu em ' + prazo + ' ao conferir de que repositorio sao estes arquivos:'
  ].concat(citar(lentos.map(function (p) { return '"' + ascii(p.rel) + '"'; })), [
    'Nao e falta de revisao: sem a resposta do git, o portao nao sabe se o arquivo e deste repositorio.',
    '',
    'Faca agora:',
    '  1. repita o commit;',
    '  2. se ele parar de novo com este aviso, o git esta lento nesta maquina: ponha SWORN_GIT_PRAZO_MS',
    '     (um prazo maior, em milissegundos, por exemplo "30000") no bloco "env" do settings.json do Claude',
    '     Code, abra o Claude Code de novo e repita (o export num comando do shell nao chega ao portao).',
    DESLIGAR
  ]).join('\n');
}

/** A lista de aprovados sem `arquivo` (editado de novo: volta a cobrar). Lista torta = vazia. */
function semAprovado(aprovados, arquivo) {
  const k = chave(arquivo);
  return (Array.isArray(aprovados) ? aprovados : []).filter(function (a) { return typeof a === 'string' && chave(a) !== k; });
}

/** A lista de aprovados com `arquivo` (absoluto), sem repetir. */
function comAprovado(aprovados, arquivo) {
  return semAprovado(aprovados, arquivo).concat([path.resolve(String(arquivo))]);
}

module.exports = { MARCA, ehCommit, semRevisao, pastaDoComando, chamadaGit, temMarca, inspetores, topo, pendentes, motivo,
  motivoSemResposta, semAprovado, comAprovado, ehTexto, aprovado, comTeto, semTeto, noTeto, chave, soComentarioNoLote };
