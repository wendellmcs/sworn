'use strict';
const fs = require('node:fs');
const path = require('node:path');
const texto = require('./texto.js');

// A4-reg-1 (pedido 12), estados: volateis.json ausente, quebrado ou com regex invalida virava [] calado, e a checagem
// D10 passava tudo (falha aberta). A causa fica em ERRO_VOLATEIS e o validarRegra acusa; nada lanca no require, que
// a abertura (abertura.js) faz em toda sessao.
// A4-70: o valor se fixa no carregamento do modulo: a funcao abaixo roda uma vez, no primeiro require, e o export
// copia ERRO_VOLATEIS daquele momento. Um volateis.json mudado depois so vale num processo novo.
let ERRO_VOLATEIS = null;
const VOLATEIS = (function () {
  let lista;
  try {
    const bruto = fs.readFileSync(path.join(__dirname, '..', '..', 'modelos', 'volateis.json'), 'utf8');
    const json = JSON.parse(bruto);
    lista = json && typeof json === 'object' ? json.volateis : undefined;
  } catch (e) {
    ERRO_VOLATEIS = texto.causaDoErro(e);
    return [];
  }
  // a chave ausente (ou com outro nome) tambem acusa: virar [] calado desligaria a checagem sem aviso
  if (!Array.isArray(lista)) {
    ERRO_VOLATEIS = lista === undefined ? 'falta a chave "volateis"' : 'a chave "volateis" nao e uma lista';
    return [];
  }
  // A4-69: cada padrao compila sozinho. Um invalido fica fora, com a causa em ERRO_VOLATEIS, e os outros seguem
  // valendo (antes um so derrubava a lista inteira).
  const validos = [];
  const ruins = [];
  lista.forEach(function (v, i) {
    // padrao ausente ou vazio viraria /(?:)/, que casa com tudo e recusaria toda regra
    if (!v || typeof v.padrao !== 'string' || !v.padrao) {
      ruins.push('padrao ' + (i + 1) + ': sem o campo "padrao" (um texto nao vazio)');
      return;
    }
    try {
      // D656 (T3): "sensivel" = maiuscula conta - o evento Stop e PascalCase, "stop" e a palavra inglesa.
      validos.push({ re: new RegExp(v.padrao, v.sensivel === true ? '' : 'i'), tipo: v.tipo });
    } catch (e) {
      ruins.push('padrao ' + (i + 1) + ': ' + texto.causaDoErro(e));
    }
  });
  if (ruins.length) ERRO_VOLATEIS = ruins.join('; ');
  return validos;
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
  // A4-101 (pedido 12, enxuto): os ramos de gatilho e acao vazios sairam; o partir() nunca os deixa vazios.
  // D10: nenhum fato volatil cravado em prosa.
  if (ERRO_VOLATEIS && !VOLATEIS.length) {
    erros.push('a lista de fatos volateis (modelos/volateis.json) nao carregou (' + ERRO_VOLATEIS + '): a checagem de' +
      ' fato volatil nao rodou; reinstale o plugin e rode de novo');
  } else if (ERRO_VOLATEIS) {
    erros.push('a lista de fatos volateis (modelos/volateis.json) carregou em parte (' + ERRO_VOLATEIS + '): a' +
      ' checagem de fato volatil rodou so com os padroes validos; reinstale o plugin e rode de novo');
  }
  // A4-25 (pedido 12, microcopy): o trecho que casou e o que reescrever, sem jargao.
  // A4-24: o teste ve a linha bruta, com o marcador de lista ("- "), e nao o texto do partir(); nenhum padrao de
  // volateis.json casa com o marcador, entao o resultado e o mesmo, e o trecho citado vem da linha que o dono escreveu.
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
  // A4-19: o UTF-16 (o Bloco de Notas antigo, o Out-File do PowerShell 5.1) chega com um byte nulo entre as letras;
  // nenhuma linha casa e o arquivo dava OK com 0 regras, sem nenhuma valer
  if (/\u0000/.test(String(texto == null ? '' : texto))) {
    erros.push('o arquivo tem byte nulo (U+0000): nao e texto UTF-8, talvez UTF-16; grave de novo em UTF-8 e ' +
      'rode de novo');
  }
  for (const r of regras) {
    const v = validarRegra(r.bruta);
    if (!v.ok) for (const e of v.erros) erros.push('linha ' + r.linha + ': ' + e);
  }
  return { ok: erros.length === 0, erros: erros, total: regras.length };
}

// O texto que o SessionStart reinjeta (contexto e nucleo) mora no reinjecao.js, o unico que
// o usa (D221, ronda 1 do 8c.5). Aqui fica so a forma da regra.

module.exports = { VOLATEIS, ERRO_VOLATEIS, SETA, parseRegras, validarRegra, validarArquivo };
