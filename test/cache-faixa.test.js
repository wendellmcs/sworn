'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cf = require('../scripts/lib/cache-faixa.js');

const HORA = 60 * 60 * 1000;
const MIN = 60 * 1000;
const FIM = '. Mande uma mensagem antes disso para poupar.';

test('cache-faixa: o cache vale 1 h do fim do ultimo turno e a frase diz o contexto e o custo da regravacao', () => {
  const c = cf.doCache({ ultimaVez: 1000, contexto: 184321, modelo: 'claude-opus-5-5' });
  assert.strictEqual(c.ate, 1000 + HORA);
  assert.strictEqual(c.avisoMs, 10 * MIN);
  // 184.321 tokens x US$ 8 por milhao (escrita de 1 h do Opus 5.5) = US$ 1,47
  assert.strictEqual(c.frase, 'depois disso a próxima mensagem regrava 184 mil tokens (≈ US$ 1,47)' + FIM);
});

test('cache-faixa: sem preco do modelo a frase sai sem o custo; o milhar tem ponto; de 1 milhao para cima, milhao', () => {
  const tok = (n) => cf.doCache({ ultimaVez: 0, contexto: n, modelo: 'modelo-novo' }).frase;
  assert.strictEqual(tok(999400), 'depois disso a próxima mensagem regrava 999 mil tokens' + FIM);
  // 999.600 arredonda para 1.000 mil: ja sai em milhao
  assert.strictEqual(tok(999600), 'depois disso a próxima mensagem regrava 1 milhão de tokens' + FIM);
  assert.strictEqual(tok(1250000), 'depois disso a próxima mensagem regrava 1,25 milhão de tokens' + FIM);
  assert.strictEqual(tok(2500000), 'depois disso a próxima mensagem regrava 2,5 milhões de tokens' + FIM);
  // chave herdada nao e preco
  assert.ok(!/US\$/.test(cf.doCache({ ultimaVez: 0, contexto: 60000, modelo: 'constructor' }).frase));
  assert.ok(!/US\$/.test(cf.doCache({ ultimaVez: 0, contexto: 60000, modelo: undefined }).frase));
});

test('cache-faixa: sem horario, sem contexto de verdade ou abaixo de 50 mil, nao avisa', () => {
  assert.strictEqual(cf.doCache(null), null);
  assert.strictEqual(cf.doCache({ contexto: 90000 }), null);
  assert.strictEqual(cf.doCache({ ultimaVez: null, contexto: 90000 }), null);
  assert.strictEqual(cf.doCache({ ultimaVez: '5', contexto: 90000 }), null);
  assert.strictEqual(cf.doCache({ ultimaVez: -1, contexto: 90000 }), null);
  assert.strictEqual(cf.doCache({ ultimaVez: Infinity, contexto: 90000 }), null);
  assert.strictEqual(cf.doCache({ ultimaVez: 5, contexto: NaN }), null);
  assert.strictEqual(cf.doCache({ ultimaVez: 5, contexto: Infinity }), null);
  assert.strictEqual(cf.doCache({ ultimaVez: 5, contexto: '90000' }), null);
  assert.strictEqual(cf.doCache({ ultimaVez: 5, contexto: 49999 }), null);
  assert.notStrictEqual(cf.doCache({ ultimaVez: 5, contexto: 50000 }), null);
});

test('cache-faixa: a linha so aparece nos ultimos 10 minutos, com os minutos arredondados para cima', () => {
  const c = cf.doCache({ ultimaVez: 0, contexto: 100000, modelo: 'claude-sonnet-5-5' });
  assert.strictEqual(cf.linha(c, HORA - 10 * MIN - 1), '');
  // 100 mil tokens x US$ 4 por milhao (escrita de 1 h do Sonnet 5.5) = US$ 0,40
  assert.strictEqual(cf.linha(c, HORA - 10 * MIN),
    'cache esfria em 10 min; depois disso a próxima mensagem regrava 100 mil tokens (≈ US$ 0,40)' + FIM);
  assert.ok(cf.linha(c, HORA - 61 * 1000).startsWith('cache esfria em 2 min; '));
  assert.ok(cf.linha(c, HORA - 1).startsWith('cache esfria em 1 min; '));
  assert.strictEqual(cf.linha(c, HORA), '');
  assert.strictEqual(cf.linha(c, HORA + 5), '');
  assert.strictEqual(cf.linha(null, 0), '');
  assert.strictEqual(cf.linha(c, NaN), '');
  // dentro da janela pelo horario, mas sem a frase: nao ha o que dizer
  assert.strictEqual(cf.linha({ ate: 10, avisoMs: 20 }, 5), '');
  assert.strictEqual(cf.linha({ ate: 10, avisoMs: 20, frase: ' \n ' }, 5), '');
  // a quebra de linha da frase vira espaco (senao a linha da faixa partiria em duas)
  assert.strictEqual(cf.linha({ ate: 10, avisoMs: 20, frase: 'a\n  b ' }, 5), 'cache esfria em 1 min; a b');
});

// A copia da conta no mod (hooks/mods.tsx, linhaDoCacheEm) roda aqui e tem de dar o mesmo que a linha() da lib.
test('cache-faixa: a copia da linha no mod da o mesmo que a da lib', () => {
  const mod = fs.readFileSync(path.join(__dirname, '..', 'hooks', 'mods.tsx'), 'utf8');
  const m = /function linhaDoCacheEm\([^)]*\): string \{\n([\s\S]*?)\n\}\n/.exec(mod);
  assert.ok(m, 'linhaDoCacheEm nao achada em hooks/mods.tsx');
  const minuto = /const MINUTO_MS = (\d+)\n/.exec(mod);
  assert.ok(minuto, 'MINUTO_MS nao achado em hooks/mods.tsx');
  // eslint-disable-next-line no-new-func
  const doMod = new Function('c', 't', 'MINUTO_MS', m[1]);
  const c = cf.doCache({ ultimaVez: 0, contexto: 100000, modelo: 'claude-sonnet-5-5' });
  const caches = [c, null, { ate: 10, avisoMs: 20 }, { ate: 10, avisoMs: 20, frase: 'a\n  b ' },
    { ate: 10, avisoMs: 20, frase: '  ' }, { ate: '10', avisoMs: 20, frase: 'x' }, { ate: 10, avisoMs: NaN, frase: 'x' }];
  const tempos = [null, NaN, 0, 5, 10, 11, HORA - 10 * MIN - 1, HORA - 10 * MIN, HORA - 61 * 1000, HORA - 60 * 1000,
    HORA - 59 * 1000, HORA - 1, HORA, HORA + 5];
  for (const cache of caches) {
    for (const t of tempos) {
      const daLib = cf.linha(cache, t);
      assert.strictEqual(doMod(cache, t, Number(minuto[1])), daLib, JSON.stringify({ cache, t }));
    }
  }
});
