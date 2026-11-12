'use strict';
// C3 (D769 (b), D808): executor barato, juiz caro. O inspetor da revisao cega roda um degrau acima do modelo que
// responde a sessao (Haiku -> Sonnet, Sonnet -> Opus; Opus e Fable ficam), pelo apelido que o parametro `model` do
// Agent aceita. Sonda s369 (Claude Code 2.1.318): o `updatedInput` do PreToolUse do Agent troca o modelo do subagente,
// sem `permissionDecision`.
const fs = require('node:fs');
const { apelidoDoId } = require('./efetivo.js');

const ACIMA = { haiku: 'sonnet', sonnet: 'opus', opus: 'opus', fable: 'fable' };
// a ordem dos degraus: o despacho que ja pede um modelo igual ou mais forte fica como veio
const ORDEM = ['haiku', 'sonnet', 'opus', 'fable'];
// so o fim da transcricao interessa (o modelo que respondeu por ultimo): ler o arquivo inteiro custaria na conversa longa
const CAUDA = 512 * 1024;

function cauda(arquivo) {
  const fd = fs.openSync(arquivo, 'r');
  try {
    const tamanho = fs.fstatSync(fd).size;
    const n = Math.min(tamanho, CAUDA);
    const buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, tamanho - n);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * O apelido do modelo que respondeu por ultimo na transcricao da sessao, ou '' quando nao se sabe (sem arquivo, sem
 * resposta, o id sem apelido conhecido). A 1a linha da cauda pode vir cortada: o JSON que nao fecha fica de fora.
 */
function modeloDaSessao(transcricao) {
  let texto;
  try {
    texto = cauda(transcricao);
  } catch (e) {
    return '';
  }
  const linhas = texto.split('\n');
  for (let i = linhas.length - 1; i >= 0; i--) {
    if (linhas[i].indexOf('"assistant"') === -1) continue;
    let r;
    try { r = JSON.parse(linhas[i]); } catch (e) { continue; }
    const modelo = r && r.type === 'assistant' && r.message ? r.message.model : null;
    // `<synthetic>` e a resposta que o proprio Claude Code escreve, nao um modelo
    if (typeof modelo !== 'string' || !modelo || modelo === '<synthetic>') continue;
    return apelidoDoId(modelo);
  }
  return '';
}

/** O modelo do juiz para o executor: o degrau acima, ou null quando o executor e desconhecido (fica o do agente). */
function juizDe(apelido) {
  return Object.prototype.hasOwnProperty.call(ACIMA, apelido) ? ACIMA[apelido] : null;
}

/**
 * O despacho ja pede um modelo igual ou mais forte que o juiz: nao se troca. O pedido vale pelo apelido (`Opus`, o id
 * `claude-opus-4-1`); o pedido que nao se entende (um id sem apelido) fica como veio, porque troca-lo podia rebaixar um
 * modelo mais forte. Sem pedido, ou com `inherit` (o modelo da sessao, que e o executor), o juiz entra.
 */
function jaBasta(pedido, juiz) {
  const p = String(pedido || '');
  if (!p || p.toLowerCase() === 'inherit') return false;
  const degrau = ORDEM.indexOf(apelidoDoId(p));
  return degrau === -1 || degrau >= ORDEM.indexOf(juiz);
}

// D829: as rondas 2 e 3 da revisao cega so conferem o conserto e rodam um degrau abaixo do juiz da ronda 1 (sessao
// Opus: Opus na ronda 1, Sonnet nas rondas 2 e 3). O Haiku e o degrau de baixo: abaixo dele, ele mesmo.
const ABAIXO = { haiku: 'haiku', sonnet: 'haiku', opus: 'sonnet', fable: 'opus' };

/** O modelo das rondas 2 e 3 para o juiz da ronda 1, ou null quando o juiz e desconhecido. */
function conferenteDe(juiz) {
  return Object.prototype.hasOwnProperty.call(ABAIXO, juiz) ? ABAIXO[juiz] : null;
}

/**
 * D829: a ronda da revisao cega pelo caminho da pasta de vereditos que o briefing traz
 * (`.../revisao/<base>/<n>/vereditos`, ou `.../<n>/invertida/vereditos` na 2a passada), com barra de qualquer
 * sistema; 0 quando o texto nao traz o caminho (o despacho conta como ronda 1).
 */
function rondaDoBriefing(texto) {
  const m = /[\\/]revisao[\\/][^\\/\s`'"]+[\\/](\d+)[\\/](?:invertida[\\/])?vereditos(?![\w-])/.exec(String(texto || ''));
  return m ? Number(m[1]) : 0;
}

/**
 * O modelo que o despacho do inspetor deve levar, ou null para deixar como veio. Ronda 1: o juiz (o degrau acima da
 * sessao), salvo pedido igual ou mais forte (jaBasta). Rondas 2 e 3: o degrau abaixo do juiz, mesmo com pedido mais
 * forte ou mais fraco (D829). Sem o modelo da sessao, null.
 */
function alvoDoDespacho(sessao, pedido) {
  const juiz = juizDe(sessao);
  if (!juiz) return null;
  const p = pedido || {};
  if (rondaDoBriefing(p.prompt) >= 2) {
    const alvo = conferenteDe(juiz);
    return apelidoDoId(String(p.model || '')) === alvo ? null : alvo;
  }
  return jaBasta(p.model, juiz) ? null : juiz;
}

module.exports = { modeloDaSessao, juizDe, jaBasta, ACIMA, ABAIXO, conferenteDe, rondaDoBriefing, alvoDoDespacho };
