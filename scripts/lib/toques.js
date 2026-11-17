'use strict';
// V3 (colheita lote 5, D846): a trava 5b (arquivo de outra frente) olhava so a foto do git status da abertura; o que
// outra sessao mudava DEPOIS passava. Cada sessao do sworn registra aqui o arquivo que acabou de escrever (PostToolUse,
// marcar-trabalho.js), num registro por projeto; o portao-escopo.js consulta o registro antes do Write/Edit.
// So o que uma sessao do sworn escreveu entra: a edicao que o dono faz fora do chat nao vira "de outra frente".
const crypto = require('node:crypto');
const path = require('node:path');
const estado = require('./estado.js');

// O registro guarda so o ultimo toque de cada arquivo, como { s: id da sessao que escreveu, em: hora em ms }. O toque
// mais velho que a idade da limpeza do estado (estado.IDADE_LIMPEZA_MS) sai, e o teto de entradas segura o arquivo
// pequeno num projeto com muito arquivo tocado.
const TETO_DE_ARQUIVOS = 2000;
// O toque com hora adiante do relogio mais que isto (registro torto, relogio mexido) nao vale e sai na gravacao
// seguinte: sem a folga, ele ficaria "depois da abertura" de toda sessao ate a hora chegar. A folga cobre dois processos
// que leem o relogio quase juntos.
const FOLGA_DO_RELOGIO_MS = 60 * 1000;
// D45: o Windows nao diferencia a caixa no nome do arquivo, e o macOS, no padrao, tambem nao; o Linux diferencia, e la
// Leia.md e leia.md sao dois arquivos.
const SEM_CAIXA = process.platform === 'win32' || process.platform === 'darwin';

/** O caminho absoluto como chave: resolvido, com barra normal e, onde o sistema nao diferencia caixa, sem caixa. */
function chave(abs) {
  const k = path.resolve(String(abs)).replace(/\\/g, '/');
  return SEM_CAIXA ? k.toLowerCase() : k;
}

/** O id do registro de um projeto: um arquivo da pasta de estado, que a limpeza do estado tambem alcanca. */
function idDoProjeto(raiz) {
  return 'toques-' + crypto.createHash('sha1').update(chave(raiz)).digest('hex').slice(0, 16);
}

function mapaDe(t) {
  const m = t && t.mapa;
  return m !== null && typeof m === 'object' && !Array.isArray(m) ? m : {};
}

function toqueValido(v, agora) {
  return v !== null && typeof v === 'object' && typeof v.s === 'string' && Number.isFinite(v.em) &&
    v.em <= agora + FOLGA_DO_RELOGIO_MS;
}

function sessaoValida(sessionId) {
  return typeof sessionId === 'string' && sessionId !== '';
}

/**
 * Grava que `sessionId` escreveu `abs` em `agora`. Sem id de sessao nao grava: dois disparos sem id seriam a mesma
 * "sessao" e um esconderia o toque do outro. Lanca se o estado nao grava: quem chama decide.
 */
function registrar(raiz, abs, sessionId, agora) {
  if (!sessaoValida(sessionId)) return;
  const quando = Number.isFinite(agora) ? agora : Date.now();
  const nova = chave(abs);
  estado.alterar(idDoProjeto(raiz), function (t) {
    const antes = mapaDe(t);
    const vivos = Object.keys(antes).filter(function (k) {
      return k !== nova && toqueValido(antes[k], quando) && quando - antes[k].em <= estado.IDADE_LIMPEZA_MS;
    }).sort(function (a, b) { return antes[b].em - antes[a].em; }).slice(0, TETO_DE_ARQUIVOS - 1);
    const mapa = {};
    mapa[nova] = { s: sessionId, em: quando };
    for (const k of vivos) mapa[k] = antes[k];
    return { mapa: mapa };
  });
}

/**
 * O ultimo toque em `abs`, como { em }, quando ele e de OUTRA sessao e veio depois de `desdeMs` (a abertura desta);
 * senao null. O registro so guarda o ultimo toque: se esta sessao escreveu por ultimo, o da outra nao conta mais. Sem a
 * hora da abertura (estado de antes da V3) ou sem o id desta sessao, null: sem eles nao ha como separar o depois do
 * antes, nem o proprio toque do alheio. `agora` existe para o teste.
 */
function deOutraSessao(raiz, abs, sessionId, desdeMs, agora) {
  if (!Number.isFinite(desdeMs) || !sessaoValida(sessionId)) return null;
  const v = mapaDe(estado.ler(idDoProjeto(raiz)))[chave(abs)];
  if (!toqueValido(v, Number.isFinite(agora) ? agora : Date.now()) || v.s === sessionId || v.em <= desdeMs) return null;
  return { em: v.em };
}

module.exports = { registrar, deOutraSessao, idDoProjeto, chave, TETO_DE_ARQUIVOS, FOLGA_DO_RELOGIO_MS };
