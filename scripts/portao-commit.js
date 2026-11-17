#!/usr/bin/env node
'use strict';
const path = require('node:path');
const io = require('./lib/io.js');
const estado = require('./lib/estado.js');
const config = require('./lib/config.js');
const commit = require('./lib/commit.js');
const ordens = require('./lib/ordens.js');
const push = require('./lib/push.js');

/**
 * F1d (D828.4): com `"provaPorArquivoTocado": true`, o turno se prova pelos testes dos arquivos mexidos, e a suite
 * inteira (a provaDePronto) e cobrada aqui, antes do commit: rodou depois da ultima edicao de codigo da sessao, terminou
 * e passou. Vale tambem com a marca de commit sem revisao (ela dispensa a revisao, nao a suite). Devolve o motivo da
 * negacao (ASCII) ou null. Sem prova declarada ou sem transcript legivel, null: o portao nao inventa pendencia.
 */
function suiteAntesDoCommit(e, projeto, raiz) {
  const prova = typeof projeto.provaDePronto === 'string' ? projeto.provaDePronto.trim() : '';
  if (!prova || !e.transcript_path) return null;
  const saude = require('./lib/saude.js');
  const t = saude.testesDoTranscript(e.transcript_path, saude.provasEquivalentes(prova, raiz), false, { raiz: raiz });
  if (!t) return null;
  let estadoDaSuite = null;
  if (t.provaRodando) estadoDaSuite = 'A suite inteira ainda roda (foi lancada em segundo plano e nao terminou).';
  else if (t.provaPendente) estadoDaSuite = 'A suite inteira nao rodou depois da ultima edicao de codigo.';
  else if (t.provaVermelha) estadoDaSuite = 'A ultima rodada da suite inteira falhou.';
  if (!estadoDaSuite) return null;
  return [
    'sworn - portao de commit (a suite inteira antes do commit).',
    '',
    'Com "provaPorArquivoTocado": true, cada turno se prova com os testes dos arquivos mexidos, e a suite',
    'inteira roda antes do commit:',
    '  ' + require('./lib/escopo.js').ascii(prova),
    estadoDaSuite,
    '',
    'Rode-a (pode ser em segundo plano), espere o fim verde e repita o commit.'
  ].join('\n');
}

/**
 * V4 (D846): o cartao antes do push, ou null. So com projeto.json lido e sem `"portaoCommit": false` (a chave desliga
 * o portao de commit e o cartao do push juntos); o push com a marca "# sworn: push-visto" passa. O que o git nao
 * responde sai no cartao como nao conferido.
 */
function cartaoDoPush(comando, cwd, raiz, projeto) {
  if (!projeto || projeto.portaoCommit === false) return null;
  if (push.visto(comando)) return null;
  const pasta = push.pastaDoPush(comando);
  let r;
  try {
    let classes = null;
    try { classes = require('./lib/sanitacao.js').classes(raiz); } catch (err) { /* segue sem */ } // fail-open: sem as classes, o cartao diz que a sanitacao nao foi conferida
    r = push.levantar(pasta ? path.resolve(cwd, pasta) : cwd, comando, classes);
  } catch (err) { // fail-closed: o levantamento que lanca ainda nega, com o cartao que diz o erro
    let avisos = [];
    try { avisos = push.ler(comando).avisos; } catch (e2) { /* sem avisos */ } // fail-closed: o cartao sai igual, sem a lista de avisos
    r = { remoto: null, url: null, ramo: null, avisos: avisos, commits: null,
      porQue: 'o levantamento falhou: ' + String(err && err.message || err).slice(0, 200) };
  }
  return push.cartao(r);
}

// Plano 091 (#1, D558, D559): PreToolUse em Bash|PowerShell. So o comando que roda `git commit` ou `git push` paga o
// git; o resto passa direto. So com projeto.json lido e sem `"portaoCommit": false`; a marca de commit sem revisao passa
// o commit, e a do push visto, o push.
io.blindar(function () {
  io.lerEntrada(function (e) {
    const comando = (e.tool_input || {}).command;
    const ehCommit = commit.ehCommit(comando);
    const ehPush = push.ehPush(comando);
    if (!ehCommit && !ehPush) return io.permitir();
    const cwd = e.cwd || process.cwd();
    const raiz = config.raizDoProjeto(cwd);
    const projeto = config.carregarProjeto(raiz);
    if (ehCommit) {
      const motivo = portaoDoCommit(e, comando, cwd, raiz, projeto);
      if (motivo) return io.negarFerramenta(motivo);
    }
    const cartao = ehPush ? cartaoDoPush(comando, cwd, raiz, projeto) : null;
    if (cartao) return io.negarFerramenta(cartao);
    io.permitir();
  });
});

/** O portao do commit: o motivo da negacao, ou null quando o commit passa. Grava no estado da sessao: a recusa da
 *  ordem de revisar (marca sem-revisao), o contador commit_sem_revisao e a ordem dada; chamar duas vezes conta duas. */
function portaoDoCommit(e, comando, cwd, raiz, projeto) {
  // `"portaoCommit": false` desliga o portao inteiro (a cobranca da suite e o cartao do push tambem).
  if (projeto && projeto.portaoCommit !== false && projeto.provaPorArquivoTocado === true) {
    const falta = suiteAntesDoCommit(e, projeto, raiz);
    if (falta) return falta;
  }
  if (commit.semRevisao(comando)) {
    // Plano 091 T6: a marca depois de um commit negado e a recusa do dono (so conta com a ordem pendente).
    try { estado.alterar(e.session_id, function (s) { s.ordensPendentes = ordens.marcarRecusada(s, 'revisar'); return s; }); } catch (err) { /* passa igual */ }
    return null;
  }
  if (!projeto || projeto.portaoCommit === false) return null;
  const s = estado.ler(e.session_id);
  const pasta = commit.pastaDoComando(comando);
  const design = require('./lib/design.js');
  const lista = commit.pendentes(s.arquivosTocados, s.revisadosAprovados, raiz,
    commit.topo(pasta ? path.resolve(cwd, pasta) : cwd),
    function (rel) { return design.ehArquivoDeEstilo(rel, projeto); },
    require('./lib/atalhos.js').marcas(projeto), s.revisadosNoTeto);
  if (!lista.length) return null;
  // D844: o git que nao respondeu no prazo nega com o motivo dele; nao e commit sem revisao nem ordem de revisar.
  if (lista.some(function (p) { return p.semResposta === true; })) return commit.motivoSemResposta(lista);
  try { estado.incrementar(e.session_id, 'commit_sem_revisao'); } catch (err) { /* nega do mesmo jeito */ }
  // F2a (D828.3): com todos os pendentes fechados no teto, o motivo manda o commit com a marca, e nao ha ordem de
  // revisar a cumprir; com um sem revisao que seja, a ordem conta como sempre.
  if (lista.some(function (p) { return p.teto !== true; })) {
    try { estado.alterar(e.session_id, function (s) { s.ordensPendentes = ordens.marcarDada(s, 'revisar'); return s; }); } catch (err) { /* idem */ }
  }
  return commit.motivo(lista);
}
