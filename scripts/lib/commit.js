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

/**
 * O que esta entre aspas (mensagem, caminho) vira Q do mesmo tamanho, com as aspas das pontas: nao e comando, e o
 * `-C "pasta"` segue com um argumento sem espaco. As posicoes seguem as do comando (o pastaDoComando le o valor nele).
 */
function semAspas(comando) {
  return String(comando).replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, function (m) {
    return m[0] + 'Q'.repeat(m.length - 2) + m[m.length - 1];
  });
}

/**
 * A2-30: o `git commit` numa fonte so, para o ehCommit e o pastaDoComando, sobre o texto do semAspas: opcoes globais
 * antes (-C/-c/--no-pager/--git-dir=), depois de cd, encadeado, ou com o executavel por caminho ou .exe. O grupo 1 sao
 * as opcoes; a flag d da a posicao delas.
 */
const GIT_COMMIT = /(?:^|[\s;&|(/\\])git(?:\.exe)?((?:\s+(?:-[cC]\s+\S+|--?[A-Za-z][\w-]*(?:=\S+)?))*)\s+commit(?![\w-])/d;

/** O comando roda um `git commit`? Entre aspas nao conta. */
function ehCommit(comando) {
  if (typeof comando !== 'string' || !comando) return false;
  return GIT_COMMIT.test(semAspas(comando));
}

/** A marca de commit sem revisao, fora de aspas. */
function semRevisao(comando) {
  return typeof comando === 'string' && /#\s*sworn:\s*sem-revisao\b/.test(semAspas(comando));
}

/**
 * A pasta onde o commit roda: o `git -C <pasta>`, ou o ultimo `cd <pasta>` antes do commit; sem nenhum, null.
 * `padrao` (V4) troca o subcomando: o push.js passa o dele, com as opcoes globais no grupo 1 e a flag d.
 */
function pastaDoComando(comando, padrao) {
  const c = String(comando || '');
  // A2-01: o -C que vale e o das opcoes do proprio `git ... commit`; o de um `git -C <outro> status` antes dele media o
  // outro repositorio. Pelo semAspas, `echo "git commit"` nao e o commit e `-c user.name="a b"` e uma opcao so.
  const limpo = semAspas(c);
  const gc = (padrao || GIT_COMMIT).exec(limpo);
  const fim = gc ? gc.index : -1;
  const opcoes = gc ? c.slice(gc.indices[1][0], gc.indices[1][1]) : '';
  const comC = gc && /(?:^|\s)-C\s+(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(opcoes);
  if (comC) return comC[1] !== undefined ? comC[1] : (comC[2] !== undefined ? comC[2] : comC[3]);
  // O `cd` tambem se procura fora de aspas (`echo "x; cd /outro"` nao muda a pasta); o semAspas guarda o tamanho, e o
  // valor sai do comando original na mesma posicao.
  const ate = fim === -1 ? limpo : limpo.slice(0, fim);
  const re = /(?:^|[\s;&|(])cd\s+("([^"]*)"|'([^']*)'|([^\s;&|)]+))/gd;
  let m;
  let ultima = null;
  while ((m = re.exec(ate)) !== null) {
    const g = m.indices[2] || m.indices[3] || m.indices[4];
    ultima = c.slice(g[0], g[1]);
  }
  return ultima;
}

/** Quantos inspetores a faixa pede: a das faixas pequenas, ou a familia inteira na completa (estilo = tela, com a
 *  lente do pedido, D825). */
function inspetores(faixa, estilo) {
  const lentes = veredito.lentesDaFaixa(faixa);
  if (lentes) return lentes.length;
  return estilo ? veredito.lentesSoTela().length : veredito.LENTES.length;
}

const chave = function (p) { return path.resolve(String(p)).toLowerCase(); };

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

/**
 * F1h (0.45.0): a raiz do repositorio de `abs` e o blob dele no HEAD num git so, `rev-parse --show-toplevel
 * HEAD:./<nome>`. { topo, blob }, com blob '' quando o HEAD nao tem o arquivo (o git sai 128 e a raiz ja saiu no
 * stdout; tambem no repositorio sem commit); null fora de repositorio (128 com o stdout vazio). O git que nao respondeu
 * (prazo, spawn, sinal) devolve undefined e quem chama pergunta como antes: o prazo nunca vira "fora do repositorio".
 */
function raizEBlob(abs) {
  const r = git.rodar(path.dirname(abs), ['rev-parse', '--show-toplevel', 'HEAD:./' + path.basename(abs)],
    { timeout: git.prazoDoCorrer(), maxBuffer: 1024 * 1024 });
  if (!r || r.error || typeof r.status !== 'number' || typeof r.stdout !== 'string') return undefined;
  const linhas = r.stdout.split(/\r?\n/);
  const raiz = linhas[0].trim();
  if (r.status === 0) return raiz && linhas[1] && linhas[1].trim() ? { topo: raiz, blob: linhas[1].trim() } : undefined;
  return raiz ? { topo: raiz, blob: '' } : null;
}

/**
 * Um arquivo tocado: { faixa, inspetores } se e codigo, existe e difere do HEAD (ou e novo e o git nao o ignora); senao
 * null. Fora de repositorio ele mediria "novo": quem chama confere o repositorio antes (`pendentes`, D575). `estilo` vem do chamador (regra do design.js, relativa a raiz do projeto).
 * `blob` (F1h): o do `raizEBlob` ('' = o HEAD nao tem); sem ele, o `cat-file -e` pergunta.
 */
function medir(abs, estilo, blob) {
  if (ehTexto(abs) || !fs.existsSync(abs)) return null;
  const pasta = path.dirname(abs);
  const nome = path.basename(abs);
  const novo = typeof blob === 'string' ? blob === '' : git.correr(pasta, ['cat-file', '-e', 'HEAD:./' + nome]) === null;
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
 * D844: o arquivo cujo repositorio o git nao disse no prazo (o de raiz e blob e o da reserva estouraram) entra como
 * { rel, semResposta: true }: sem saber o repositorio, o portao nao libera.
 */
function pendentes(arquivos, aprovados, raiz, topoDoCommit, ehEstilo, marcas, tetos) {
  if (!Array.isArray(arquivos)) return [];
  const lista = [];
  // F1g (s372): no caminho de reserva, um git por pasta; o memo vive so nesta chamada (o repositorio nao muda nela).
  const topos = new Map();
  for (const a of arquivos) {
    if (typeof a !== 'string' || aprovado(aprovados, a)) continue;
    const abs = path.resolve(raiz, a);
    // F1h: texto e arquivo que nao existe o medir nunca conta, entao nao gastam git
    if (ehTexto(abs) || !fs.existsSync(abs)) continue;
    const rel = require('./glob.js').normalizar(path.relative(raiz, abs));
    // D575: fora de qualquer repositorio (instrumento do scratchpad) nunca conta, mesmo com topoDoCommit null (`cd "$D"`).
    // F1h: a raiz e o blob num git so; o git que nao respondeu cai no caminho de antes (topo, cat-file, blob do teto).
    const rb = raizEBlob(abs);
    let t;
    if (rb === undefined) {
      const pasta = path.dirname(abs);
      if (!topos.has(pasta)) {
        const falha = {};
        const raizDoGit = topo(pasta, falha);
        topos.set(pasta, { raiz: raizDoGit, lento: falha.timeout === true });
      }
      if (topos.get(pasta).lento) { lista.push({ rel: rel, semResposta: true }); continue; }
      t = topos.get(pasta).raiz;
    } else {
      t = rb && rb.topo;
    }
    if (!t || (topoDoCommit && chave(t) !== chave(topoDoCommit))) continue;
    const blob = rb ? rb.blob : undefined;
    const m = medir(abs, typeof ehEstilo === 'function' && ehEstilo(rel) === true, blob);
    if (m) lista.push({ rel: rel, faixa: m.faixa, inspetores: m.inspetores,
      atalhos: Array.isArray(marcas) && marcas.length ? atalhosNovos(abs, m.novas, marcas) : [],
      teto: noTeto(tetos, abs, blob) });
  }
  return lista;
}

/** Ate MAX_CITADOS itens, cada um numa linha `  - <item>`, e a linha `  - e mais N` com o que passou. */
function citar(itens) {
  const linhas = itens.slice(0, MAX_CITADOS).map(function (i) { return '  - ' + i; });
  if (itens.length > MAX_CITADOS) linhas.push('  - e mais ' + (itens.length - MAX_CITADOS));
  return linhas;
}

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

module.exports = { MARCA, ehCommit, semRevisao, pastaDoComando, inspetores, topo, pendentes, motivo, motivoSemResposta, semAprovado,
  comAprovado, ehTexto, aprovado, comTeto, semTeto, noTeto, semAspas };
