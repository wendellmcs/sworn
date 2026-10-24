'use strict';
const regraLib = require('./regra.js');

/** Abaixo de dois nomes o portao de custo nao opina (o `permitido` do custo.js). Um degrau
 *  sozinho nao e escada: nao ha "mais caro" em relacao a coisa nenhuma. */
const MINIMO = 2;

/** O mesmo formato que o Claude Code aceita como nome de agente.
 *  `{0,39}` e nao `{1,39}`: o quantificador vem DEPOIS da primeira letra, entao
 *  `{1,39}` exigiria duas letras e recusaria um agente chamado `a`. Medido. */
const NOME = /^[a-z][a-z0-9-]{0,39}$/;

function texto(v) { return typeof v === 'string' ? v.trim() : ''; }

/**
 * Aceita tres formas, porque a entrevista e conversa e nao formulario:
 *   'arquiteto'        -> apelido vazio, e o validador reclama
 *   {agente, apelido}  -> a forma canonica
 *   {nome, model}      -> como o frontmatter de um agente ja existente chama
 *                         essas mesmas duas coisas
 * Devolve sempre a forma canonica, NA ORDEM EM QUE VEIO: a ordem e o dado, e
 * e dela que o `nivelDoAgente` do custo.js tira o nivel de cada agente.
 */
function normalizar(lista) {
  if (!Array.isArray(lista)) return [];
  return lista.map(function (d) {
    if (typeof d === 'string') return { agente: texto(d), apelido: '' };
    const o = (d && typeof d === 'object') ? d : {};
    return { agente: texto(o.agente || o.nome), apelido: texto(o.apelido || o.model) };
  }).filter(function (d) { return d.agente !== ''; });
}

/** Apelido e METODO; id de modelo e RESULTADO, e resultado apodrece (spec §3). */
function ehNomeDeModelo(apelido) {
  for (const vol of regraLib.VOLATEIS) {
    if (vol.tipo === 'nome de modelo' && vol.re.test(apelido)) return true;
  }
  return false;
}

function validar(lista) {
  const erros = [];
  const d = normalizar(lista);
  // Projeto sem escada de agentes e caso normal: o portao de custo se cala e
  // nada mais depende disto. Recusar aqui obrigaria a inventar uma escada.
  if (d.length === 0) return { ok: true, erros: erros };
  if (d.length < MINIMO) {
    erros.push('escada com ' + d.length + ' degrau: com menos de ' + MINIMO +
      ' o portao de custo nao opina, e a configuracao parece proteger sem proteger');
  }
  const vistos = Object.create(null);
  for (const item of d) {
    if (!NOME.test(item.agente)) {
      erros.push('nome de agente invalido: "' + item.agente + '" (minusculas, digitos e hifen)');
    }
    if (vistos[item.agente]) erros.push('agente repetido na escada: ' + item.agente);
    vistos[item.agente] = true;
    if (item.apelido === '') {
      erros.push('degrau "' + item.agente + '" sem apelido: o gatilho 3 nao tem contra o que comparar');
    } else if (ehNomeDeModelo(item.apelido)) {
      erros.push('degrau "' + item.agente + '": "' + item.apelido +
        '" e id de modelo, nao apelido - id apodrece e o apelido nao');
    }
  }
  return { ok: erros.length === 0, erros: erros };
}

/** Os dois lados, no mesmo ato e na mesma ordem - spec §7, aceite da entrega B. */
function paraProjeto(lista) {
  const d = normalizar(lista);
  return { escada: d.map(function (x) { return x.agente; }), degraus: d };
}

/**
 * A falha que nao avisa: escada e degraus gravados fora de sincronia. Quem le a
 * escada (custo.js) e quem le os apelidos (o gatilho 3) passam a falar de
 * projetos diferentes, e nenhum dos dois tem como perceber sozinho.
 *
 * `degraus` ausente NAO e desalinho: e configuracao anterior a esta tarefa, e
 * ela continua valendo. O contrario - degraus sem escada - e, porque ai o
 * portao de custo fica mudo enquanto o arquivo aparenta ter escada configurada.
 */
function desalinhados(agentes) {
  const a = (agentes && typeof agentes === 'object') ? agentes : {};
  const escada = Array.isArray(a.escada) ? a.escada : null;
  const degraus = Array.isArray(a.degraus) ? a.degraus : null;
  if (degraus === null) return [];
  if (escada === null) return ['ha degraus gravados e nenhuma escada: o portao de custo fica mudo'];

  const problemas = [];
  if (escada.length !== degraus.length) {
    problemas.push('a escada tem ' + escada.length + ' nome(s) e os degraus, ' + degraus.length);
  }
  const n = Math.min(escada.length, degraus.length);
  for (let i = 0; i < n; i++) {
    const nome = degraus[i] && degraus[i].agente;
    if (escada[i] !== nome) {
      problemas.push('posicao ' + (i + 1) + ': a escada diz "' + escada[i] +
        '" e os degraus dizem "' + nome + '"');
    }
  }
  return problemas;
}

function motivoDesalinhado(problemas) {
  return [
    'sworn: a escada e os degraus deste projeto nao contam a mesma historia.',
    '',
    problemas.map(function (p) { return '  - ' + p; }).join('\n'),
    '',
    'Os dois se gravam no mesmo ato e na mesma ordem. Enquanto divergirem, o portao',
    'de custo julga por uma lista e a conferencia de apelidos, por outra - e nenhum',
    'dos dois tem como perceber.',
    '',
    'Conserto: rode a entrevista de novo e responda os degraus uma vez so.'
  ].join('\n');
}

module.exports = {
  MINIMO, NOME, normalizar, ehNomeDeModelo, validar, paraProjeto,
  desalinhados, motivoDesalinhado
};
