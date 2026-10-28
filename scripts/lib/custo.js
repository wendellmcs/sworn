'use strict';
const marchaLib = require('./marcha.js');
const degraus = require('./degraus.js');
const { entreAspas } = require('./texto.js');

// Vazia por padrao: sem escada configurada, o portao nao opina.
// A entrevista pergunta a escada deste projeto e grava em projeto.json:agentes.escada.
const ESCADA_PADRAO = [];
const FORK = 'fork';

function escada(projeto) {
  const e = projeto && projeto.agentes && projeto.agentes.escada;
  return Array.isArray(e) ? e : ESCADA_PADRAO;
}

/** 0 = fora da escada, e portanto fora do julgamento deste portao. */
function nivelDoAgente(tipo, projeto) {
  const lista = escada(projeto);
  const i = lista.indexOf(String(tipo || ''));
  // A12-01: o `fork` (Claude Code 2.1.302) roda no modelo do agente principal e nunca esta na escada.
  // atalho: fork = topo da escada. limite: com o principal num modelo barato, o fork tambem e barrado.
  // trocar quando: o gancho receber o modelo do agente principal.
  if (i === -1 && tipo === FORK) return lista.length;
  return i === -1 ? 0 : i + 1;
}

/** A marcha mais alta entre os caminhos do escopo declarado. Sem escopo, nao ha teto. */
function marchaMaximaDoEscopo(esc, projeto) {
  if (!esc || !Array.isArray(esc.dentro) || esc.dentro.length === 0) return 'aaa';
  let maxima = 'rapida';
  for (const caminho of esc.dentro) {
    const m = marchaLib.resolverMarcha(caminho, projeto);
    if (marchaLib.NIVEL[m] > marchaLib.NIVEL[maxima]) maxima = m;
  }
  return maxima;
}

/**
 * F18: agente do topo da escada em trabalho que so toca caminho de marcha rapida
 * e desproporcao mensuravel. Nas outras marchas o portao nao opina:
 * rigor e eixo independente do custo, e modelo barato pode passar por portao rigoroso.
 */
function permitido(tipo, marchaMax, projeto) {
  const lista = escada(projeto);
  // Ronda 1 do 8c.5: o mesmo limite que o relatorio de cobertura acusa, e nao um 2 cru.
  if (lista.length < degraus.MINIMO) return { ok: true, motivo: null };
  if (marchaMax !== 'rapida') return { ok: true, motivo: null };

  const nivel = nivelDoAgente(tipo, projeto);
  if (nivel === 0) return { ok: true, motivo: null };
  const metade = Math.ceil(lista.length / 2);
  if (nivel <= metade) return { ok: true, motivo: null };

  return {
    ok: false,
    // Plano 082, Tarefa 5 (mock S10): a forma unica dos avisos. "topo" era meia verdade: barra a metade cara.
    motivo: [
      'sworn - agente caro demais para um trabalho simples.',
      '',
      'Voce despachou ' + entreAspas(tipo) + ', da metade mais cara da escada deste projeto, mas o escopo',
      'declarado so toca caminho de marcha rapida (o nivel de rigor mais leve do projeto.json).',
    ].concat(tipo === FORK && lista.indexOf(FORK) === -1
      ? ['O "fork" roda no modelo do agente principal e conta como o topo da escada.'] : [], [
      'Escada deste projeto, do mais barato ao mais caro:',
      lista.map(function (a) { return '  - ' + entreAspas(a); }).join('\n'),
      '',
      'Faca uma destas:',
      '  1. despache um agente mais barato da escada: ele escala sozinho se a tarefa passar do alcance dele;',
      '  2. se o trabalho exige mesmo este agente, acrescente ao escopo o caminho de marcha padrao ou AAA',
      '     que justifica a escolha - e a escolha fica visivel.'
    ]).join('\n')
  };
}

/**
 * D678 T2: agente dos `degraus` chamado com `model` ou `effort` diferente da tabela do projeto. O que a chamada passa
 * vence o frontmatter do agente (sonda d2/run8): sem esta conferencia a tabela nao valeria. Campo que a chamada nao
 * traz e "nao sei" (binario velho sem `effort`; o arquivo do agente decide) e passa; degrau sem apelido ou sem
 * esforco gravado nao compara esse campo.
 */
function chamadaDaTabela(tipo, entrada, projeto) {
  const lista = degraus.normalizar(projeto && projeto.agentes && projeto.agentes.degraus);
  const i = lista.findIndex(function (d) { return d.agente === tipo; });
  if (i === -1) return { ok: true, motivo: null };
  const tabela = [['model', lista[i].apelido], ['effort', lista[i].esforco]]
    .filter(function (c) { return typeof c[1] === 'string' && c[1] !== ''; });
  const chamada = entrada || {};
  const errados = tabela.filter(function (c) {
    const v = chamada[c[0]];
    return v !== undefined && v !== null && v !== '' && v !== c[1];
  });
  if (errados.length === 0) return { ok: true, motivo: null };

  // Valor que nao e texto sai em JSON: o String() cru lancava com {"toString": 1}, e o `io.blindar` do portao liberava.
  const campo = function (c, v) { return c[0] + ' ' + entreAspas(typeof v === 'string' ? v : JSON.stringify(v)); };
  const acima = lista[i + 1];
  return {
    ok: false,
    motivo: [
      'sworn - chamada fora da tabela da escada.',
      '',
      'Voce chamou ' + entreAspas(tipo) + ' com ' +
        errados.map(function (c) { return campo(c, chamada[c[0]]); }).join(' e ') + ',',
      'e a escada deste projeto (agentes.degraus no projeto.json) diz ' +
        tabela.map(function (c) { return campo(c, c[1]); }).join(' e ') + '.',
      'O que a chamada passa vence o que o arquivo do agente declara.',
      '',
      'Faca uma destas:',
      '  1. chame de novo como a tabela diz:',
      '     Agent({ subagent_type: ' + entreAspas(tipo) + ', ' +
        tabela.map(function (c) { return c[0] + ': ' + entreAspas(c[1]); }).join(', ') + ', ... })',
      '     ou sem model e effort, e o agente usa o que o arquivo dele declara;'
    ].concat(acima ? ['  2. se a tarefa pede mais que este degrau, chame o de cima da escada: ' +
      entreAspas(acima.agente) + ';'] : [], [
      '  ' + (acima ? 3 : 2) + '. se a tabela esta errada, corrija agentes.degraus no projeto.json.'
    ]).join('\n')
  };
}

module.exports = { ESCADA_PADRAO, nivelDoAgente, marchaMaximaDoEscopo, permitido, chamadaDaTabela };
