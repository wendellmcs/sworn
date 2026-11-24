'use strict';
// H6a2 (D892, defeito 1): a reabertura da compactacao cabe no que o harness mostra. Acima de 10 mil caracteres o Claude
// Code guarda a saida do SessionStart num arquivo e mostra so os 2 mil primeiros (D786): as regras e o fim (o aviso do
// dono do plano, a qualidade de resposta) sumiam. Na compactacao, a abertura junta o stdout aqui (juntar); no fim
// (soltar), o texto que passa do teto vai inteiro para .sworn/reabertura/<sessao>.md e o stdout leva a previa: as
// ordens do compact (reler ou gravar o handoff, a escalada pendente), o caminho do arquivo e as linhas que couberem.
const fs = require('node:fs');
const path = require('node:path');
const retomar = require('./retomar.js');

// A mesma margem do CARACTERES_REINJETADOS (reinjecao.js) abaixo dos 10 mil do harness, em bytes, que nunca sao menos
// que os caracteres.
const TETO_DA_SAIDA = 9000;
const PASTA = path.join('.sworn', 'reabertura');
const TETO_DE_ARQUIVOS = 10;
// O nome que o sworn da ao arquivo (o session_id saneado, como no estado.js): so este a poda apaga.
const NOME_DO_SWORN = /^[a-zA-Z0-9_-]+\.md$/;

function bytes(t) { return Buffer.byteLength(t, 'utf8'); }

function nomeDoArquivo(sessao) {
  return String(sessao || 'sem-sessao').replace(/[^a-zA-Z0-9_-]/g, '-') + '.md';
}

/** Os arquivos do sworn alem dos TETO_DE_ARQUIVOS mais novos saem; o que tem outro nome na pasta fica. */
function podar(pasta) {
  try {
    const nomes = fs.readdirSync(pasta).filter(function (n) { return NOME_DO_SWORN.test(n); })
      .map(function (n) { return { n: n, t: fs.statSync(path.join(pasta, n)).mtimeMs }; })
      .sort(function (a, b) { return b.t - a.t; });
    for (const x of nomes.slice(TETO_DE_ARQUIVOS)) fs.rmSync(path.join(pasta, x.n), { force: true });
  } catch (e) { /* a poda falha sozinha: a proxima gravacao tenta de novo */ }
}

/** Grava o texto inteiro e devolve o caminho; o disco que nao grava, null (e o texto sai inteiro, como antes). */
function gravar(raiz, sessao, texto) {
  try {
    const pasta = path.join(raiz, PASTA);
    fs.mkdirSync(pasta, { recursive: true });
    retomar.protegerPasta(pasta);
    const arquivo = path.join(pasta, nomeDoArquivo(sessao));
    fs.writeFileSync(arquivo, texto, 'utf8');
    podar(pasta);
    return arquivo;
  } catch (e) {
    return null;
  }
}

/** O texto sem as ordens (que vao na frente), sem as quebras do comeco. */
function semAsOrdens(texto, ordens) {
  const i = ordens ? texto.indexOf(ordens) : -1;
  return (i === -1 ? texto : texto.slice(0, i) + texto.slice(i + ordens.length)).replace(/^\n+/, '');
}

/** As linhas inteiras das ordens que cabem em `cabe` bytes; a que nao cabe sai com a marca do corte. */
function ordensNoTeto(ordens, cabe) {
  const inteiras = ordens.replace(/\s*$/, '') + '\n';
  if (bytes(inteiras) <= cabe) return inteiras;
  const corte = '[sworn: ordens cortadas no teto; inteiras no arquivo abaixo]\n';
  let saida = '';
  for (const linha of inteiras.split('\n')) {
    if (bytes(saida) + bytes(linha + '\n') + bytes(corte) > cabe) break;
    saida += linha + '\n';
  }
  return saida + corte;
}

/** A previa: as ordens, o ponteiro para o arquivo, as linhas inteiras do resto que couberem no teto e a marca do fim. */
function previa(texto, ordens, caminho) {
  const mostrar = String(caminho).replace(/\\/g, '/');
  const ponteiro = 'sworn: a reabertura inteira tem ' + bytes(texto) + ' bytes, acima do teto de ' + TETO_DA_SAIDA +
    ' que o sworn deixa abaixo dos 10 mil caracteres que o Claude Code mostra: regras, estado e avisos estao em ' + mostrar +
    '. Leia esse arquivo inteiro logo depois do handoff, antes de editar.\n';
  const fim = '[sworn: fim da previa; o resto esta em ' + mostrar + ']\n';
  // as ordens primeiro, mas nunca empurrando o ponteiro e a marca do fim para fora do teto
  let saida = (ordens ? ordensNoTeto(ordens, TETO_DA_SAIDA - bytes(ponteiro) - bytes(fim)) : '') + ponteiro;
  for (const linha of semAsOrdens(texto, ordens).split('\n')) {
    const mais = linha + '\n';
    if (bytes(saida) + bytes(mais) + bytes(fim) > TETO_DA_SAIDA) break;
    saida += mais;
  }
  return saida + fim;
}

let escreverOriginal = null;
let juntado = null;

/** Passa a guardar o que se escreve no stdout, ate o soltar. */
function juntar() {
  if (escreverOriginal) return;
  escreverOriginal = process.stdout.write;
  juntado = [];
  process.stdout.write = function (pedaco, codificacao, depois) {
    if (typeof codificacao === 'function') { depois = codificacao; codificacao = undefined; }
    // em Buffer, decodificado so no soltar: a letra com acento partida em dois write sai inteira
    juntado.push(typeof pedaco === 'string' ? Buffer.from(pedaco, codificacao || 'utf8') : Buffer.from(pedaco));
    // quem espera o write terminar para seguir segue, como no stdout de verdade
    if (typeof depois === 'function') process.nextTick(depois);
    return true;
  };
}

/** Devolve o stdout e escreve o guardado: inteiro ate o teto; acima dele, o arquivo e a previa. Uma vez so. */
function soltar(raiz, sessao, ordens) {
  if (!escreverOriginal) return;
  const texto = Buffer.concat(juntado).toString('utf8');
  process.stdout.write = escreverOriginal;
  escreverOriginal = null;
  juntado = null;
  if (!texto) return;
  if (bytes(texto) <= TETO_DA_SAIDA) { process.stdout.write(texto); return; }
  const caminho = gravar(raiz, sessao, texto);
  if (caminho) { process.stdout.write(previa(texto, ordens, caminho)); return; }
  // o disco nao gravou: sai tudo (o harness guarda o que passa dos 10 mil num arquivo dele), mas com as ordens e o
  // aviso na frente, que e o que a previa de 2 mil do harness mostra
  process.stdout.write((ordens ? ordens.replace(/\s*$/, '') + '\n' : '') + AVISO_SEM_ARQUIVO + semAsOrdens(texto, ordens));
}

// vale nos dois casos: entre o teto (9000 bytes) e os 10 mil o Claude Code mostra tudo e nao cita arquivo; acima, cita
const AVISO_SEM_ARQUIVO = 'sworn: nao gravei a reabertura em .sworn/reabertura/ (o disco recusou), entao ela vai inteira ' +
  'abaixo. Se o Claude Code mostrar so o comeco e citar um arquivo com o resto, leia esse arquivo inteiro antes de editar.\n';

module.exports = { TETO_DA_SAIDA, previa, juntar, soltar };
