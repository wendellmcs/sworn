'use strict';
const fs = require('node:fs');
const path = require('node:path');

const VOLATEIS = (function () {
  try {
    const bruto = fs.readFileSync(path.join(__dirname, '..', '..', 'modelos', 'volateis.json'), 'utf8');
    return (JSON.parse(bruto).volateis || []).map(function (v) {
      // D656 (T3): "sensivel" = maiuscula conta - o evento Stop e PascalCase, "stop" e a palavra inglesa.
      return { re: new RegExp(v.padrao, v.sensivel === true ? '' : 'i'), tipo: v.tipo };
    });
  } catch (e) {
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
    erros.push('regra sem gatilho: escreva na forma "<gatilho> -> <acao>"');
    return { ok: false, erros: erros };
  }
  if (!p.gatilho) erros.push('gatilho vazio antes da seta');
  if (!p.acao) erros.push('acao vazia depois da seta');
  // D10: nenhum fato volatil cravado em prosa.
  for (const v of VOLATEIS) {
    if (v.re.test(bruta)) erros.push('fato volatil cravado (' + v.tipo + '): leia da fonte viva ou diga que nao verificou');
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

module.exports = { VOLATEIS, SETA, parseRegras, validarRegra, validarArquivo };
