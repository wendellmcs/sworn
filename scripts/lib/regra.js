'use strict';
const fs = require('node:fs');
const path = require('node:path');
const texto = require('./texto.js');

// A4-reg-1 (pedido 12), estados: volateis.json ausente, quebrado ou com regex invalida virava [] calado, e a checagem
// D10 passava tudo (falha aberta). A causa fica em ERRO_VOLATEIS e o validarRegra acusa; nada lanca no require, que
// a abertura (abertura.js) faz em toda sessao.
let ERRO_VOLATEIS = null;
const VOLATEIS = (function () {
  try {
    const bruto = fs.readFileSync(path.join(__dirname, '..', '..', 'modelos', 'volateis.json'), 'utf8');
    return (JSON.parse(bruto).volateis || []).map(function (v) {
      // D656 (T3): "sensivel" = maiuscula conta - o evento Stop e PascalCase, "stop" e a palavra inglesa.
      return { re: new RegExp(v.padrao, v.sensivel === true ? '' : 'i'), tipo: v.tipo };
    });
  } catch (e) {
    ERRO_VOLATEIS = texto.causaDoErro(e);
    return [];
  }
})();

const SETA = /\s(?:->|=>|→)\s/;
// D115: regra e ITEM DE LISTA com seta - as duas coisas. Prosa com seta continua
// prosa. Sem esta guarda, a propria frase que explica o formato (ela tem uma seta,
// por definicao) era lida como regra e reinjetada como se fosse uma - R-T11-01,
// medido no modelo do plugin: 11 regras lidas onde havia 10.
const ITEM = /^\s*[-*+]\s+/;

function partir(bruta) {
  const t = String(bruta == null ? '' : bruta).replace(ITEM, '').trim();
  const m = t.split(SETA);
  if (m.length < 2) return null;
  return { gatilho: m[0].trim(), acao: m.slice(1).join(' -> ').trim() };
}

/** A1: regra sem gatilho e proibicao solta, e proibicao solta decai com contexto longo. */
function validarRegra(bruta) {
  const erros = [];
  const p = partir(bruta);
  if (!p) {
    // A4-26 (pedido 12, microcopy): a forma com exemplo; gatilho ou acao vazios tambem caem aqui (trim e a SETA).
    erros.push('regra fora da forma gatilho -> acao: escreva quando ela vale, a seta -> com espaco dos dois lados e' +
      ' o que fazer, como em "ao editar arquivo -> rodar os testes"');
    return { ok: false, erros: erros };
  }
  if (!p.gatilho) erros.push('gatilho vazio antes da seta');
  if (!p.acao) erros.push('acao vazia depois da seta');
  // D10: nenhum fato volatil cravado em prosa.
  if (ERRO_VOLATEIS) {
    erros.push('a lista de fatos volateis (modelos/volateis.json) nao carregou (' + ERRO_VOLATEIS + '): a checagem de' +
      ' fato volatil nao rodou; reinstale o plugin e rode de novo');
  }
  // A4-25 (pedido 12, microcopy): o trecho que casou e o que reescrever, sem jargao.
  for (const v of VOLATEIS) {
    const m = String(bruta).match(v.re);
    if (m) erros.push('valor que muda com o tempo (' + v.tipo + ': "' + m[0].trim() + '"): tire o valor da regra, ou' +
      ' troque-o por onde le-lo na hora (o arquivo ou o comando que o traz)');
  }
  return { ok: erros.length === 0, erros: erros };
}

function parseRegras(texto) {
  const regras = [];
  const linhas = String(texto == null ? '' : texto).split(/\r?\n/);
  linhas.forEach(function (linha, i) {
    if (!ITEM.test(linha) || !SETA.test(linha)) return;
    const p = partir(linha);
    if (!p) return;
    regras.push({ linha: i + 1, gatilho: p.gatilho, acao: p.acao, bruta: linha.trim() });
  });
  return regras;
}

function validarArquivo(texto) {
  const regras = parseRegras(texto);
  const erros = [];
  for (const r of regras) {
    const v = validarRegra(r.bruta);
    if (!v.ok) for (const e of v.erros) erros.push('linha ' + r.linha + ': ' + e);
  }
  return { ok: erros.length === 0, erros: erros, total: regras.length };
}

// O texto que o SessionStart reinjeta (contexto e nucleo) mora no reinjecao.js, o unico que
// o usa (D221, ronda 1 do 8c.5). Aqui fica so a forma da regra.

module.exports = { VOLATEIS, ERRO_VOLATEIS, SETA, parseRegras, validarRegra, validarArquivo };
