'use strict';
const { PRECOS } = require('./calibracao.js');
const { milhar, centavos } = require('./medidor.js');

// V2 (D847): o cronometro do cache na faixa. O cache do chat dura 1 h depois da ultima chamada (D547); vencido, a
// proxima mensagem regrava a conversa inteira pelo preco da escrita de 1 h. A faixa avisa nos ultimos AVISO_MS, com
// o tempo e o custo. O sessao.js devolve { ate, avisoMs, frase } e o mod (hooks/mods.tsx) desenha `linha`; a copia
// dela no mod (linhaDoCacheEm) e conferida contra esta por test/cache-faixa.test.js.

const VIDA_MS = 60 * 60 * 1000;
const AVISO_MS = 10 * 60 * 1000;
const MINUTO_MS = 60 * 1000;
// Abaixo disto a regravacao custa centavos: a faixa nao avisa.
const CONTEXTO_MINIMO = 50000;
// indice da escrita de 1 h na tabela de precos (calibracao.js: entrada, saida, leitura, escrita 5 min, escrita 1 h)
const ESCRITA_1H = 4;

/** O preco por token da escrita de 1 h do modelo, ou null (modelo fora da tabela ou nao texto). */
function precoDaEscrita(modelo) {
  if (typeof modelo !== 'string' || !Object.hasOwn(PRECOS, modelo)) return null;
  const p = PRECOS[modelo][ESCRITA_1H];
  return Number.isFinite(p) ? p / 1e6 : null;
}

/** "184 mil tokens" ate 999 mil; dali para cima, "1,25 milhão de tokens" / "2,5 milhões de tokens". */
function tokens(n) {
  const mil = Math.round(n / 1000);
  if (mil < 1000) return milhar(mil) + ' mil tokens';
  const m = Math.round(n / 1e4) / 100;
  return String(m).replace('.', ',') + (m < 2 ? ' milhão de tokens' : ' milhões de tokens');
}

/**
 * `ultimaVez` = quando o ultimo turno do agente principal terminou (ms), `contexto` = tokens do chat, `modelo` = o id
 * do modelo. Devolve { ate, avisoMs, frase }, ou null quando `ultimaVez` nao e um numero finito >= 0, quando
 * `contexto` nao e um numero finito ou quando fica abaixo de CONTEXTO_MINIMO. Sem preco do modelo, a frase sai sem
 * o custo.
 */
function doCache(e) {
  if (!e || !(Number.isFinite(e.ultimaVez) && e.ultimaVez >= 0) || !Number.isFinite(e.contexto) ||
    e.contexto < CONTEXTO_MINIMO) return null;
  const p = precoDaEscrita(e.modelo);
  const custo = p === null ? '' : ' (≈ US$ ' + centavos(e.contexto * p) + ')';
  return {
    ate: e.ultimaVez + VIDA_MS,
    avisoMs: AVISO_MS,
    frase: 'depois disso a próxima mensagem regrava ' + tokens(e.contexto) + custo +
      '. Mande uma mensagem antes disso para poupar.'
  };
}

/**
 * A linha da faixa em `agora` (ms), ou '': fora dos ultimos `avisoMs` antes de `ate` (ou depois dele), ou sem frase
 * de verdade. Quebra de linha e espaco repetido na frase viram um espaco (senao a linha partiria em duas).
 */
function linha(c, agora) {
  if (!c || !Number.isFinite(c.ate) || !Number.isFinite(c.avisoMs) || typeof c.frase !== 'string' ||
    !Number.isFinite(agora)) return '';
  const frase = c.frase.replace(/\s+/g, ' ').trim();
  if (!frase) return '';
  const resta = c.ate - agora;
  if (!(resta > 0) || resta > c.avisoMs) return '';
  return 'cache esfria em ' + Math.ceil(resta / MINUTO_MS) + ' min; ' + frase;
}

module.exports = { VIDA_MS, AVISO_MS, CONTEXTO_MINIMO, doCache, linha };
