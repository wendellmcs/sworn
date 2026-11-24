'use strict';
// H6e4 (15.0, docs/revisao-automatica.md §5.6): o aproveitamento por lente da revisao cega.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const apr = require('../scripts/lib/aproveitamento.js');
const aud = require('../scripts/lib/auditoria.js');
const comum = require('./lib/comum.js');

const ZERO = { corrigidos: 0, refutados: 0, descartados: 0, abertos: 0 };
function c(x) { return Object.assign({}, ZERO, x); }

test('H6e4: aprovada, todo achado que segurou ronda conta como corrigido da lente dele', () => {
  const r = { ronda: 2, seguraram: [{ lente: 'correcao', ronda: 1 }, { lente: 'correcao', ronda: 1 }, { lente: 'borda', ronda: 1 }] };
  assert.deepStrictEqual(apr.daApuracao(r, true), { correcao: c({ corrigidos: 2 }), borda: c({ corrigidos: 1 }) });
});

test('H6e4: no teto sem aprovar, o novo da ultima ronda e o que voltou igual nela ficam abertos; o resto foi corrigido', () => {
  const r = { ronda: 3,
    seguraram: [{ lente: 'correcao', ronda: 1 }, { lente: 'correcao', ronda: 2 }, { lente: 'correcao', ronda: 3 },
      { lente: 'borda', ronda: 1 }],
    achadosAindaAbertos: [{ lente: 'correcao', ronda: 3 }] };
  assert.deepStrictEqual(apr.daApuracao(r, false), { correcao: c({ corrigidos: 1, abertos: 2 }), borda: c({ corrigidos: 1 }) });
});

test('H6e4: na conferencia, os que seguem ficam abertos e os outros que seguraram ronda foram corrigidos', () => {
  const seguraram = [{ lente: 'correcao', ronda: 1 }, { lente: 'correcao', ronda: 3 }, { lente: 'borda', ronda: 3 }];
  const r = { ronda: 4, seguraram: seguraram, conferencia: { aprovado: false, corrigidos: 2, seguem: [{ id: 3, lente: 'borda' }] },
    achadosAindaAbertos: [] };
  assert.deepStrictEqual(apr.daApuracao(r, false), { correcao: c({ corrigidos: 2 }), borda: c({ abertos: 1 }) });
  // aprovada pela conferencia: nada segue, tudo corrigido (a ronda 4 nao tem achado novo de lente)
  const ok = Object.assign({}, r, { conferencia: { aprovado: true, corrigidos: 3, seguem: [] } });
  assert.deepStrictEqual(apr.daApuracao(ok, true), { correcao: c({ corrigidos: 2 }), borda: c({ corrigidos: 1 }) });
  // o que segue de uma lente que nao esta entre os que seguraram ainda conta como aberto, sem corrigido negativo
  const torta = Object.assign({}, r, { conferencia: { aprovado: false, corrigidos: 0, seguem: [{ id: 9, lente: 'estados' }] } });
  assert.deepStrictEqual(apr.daApuracao(torta, false),
    { correcao: c({ corrigidos: 2 }), borda: c({ corrigidos: 1 }), estados: c({ abertos: 1 }) });
});

test('H6e4: refutado e descartado antes contam na lente (pela chave, mesmo pelo titulo); lacuna e melhoria nao', () => {
  const r = { ronda: 2, seguraram: [],
    refutados: [{ lente: 'Correcao e regressao', ronda: 1 }, { lente: 'borda', ronda: 1 }, { lente: 'borda', ronda: 1, lacuna: true }],
    registros: [{ lente: 'estados', registro: 'descartado antes' }, { lente: 'estados', registro: 'melhoria' },
      { lente: 'estados', registro: 'linha nova' }] };
  assert.deepStrictEqual(apr.daApuracao(r, true),
    { correcao: c({ refutados: 1 }), borda: c({ refutados: 1 }), estados: c({ descartados: 1 }) });
  assert.deepStrictEqual(apr.daApuracao({}, true), {});
});

function fecho(dir, conteudo) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'fechada.json'), typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo), 'utf8');
}

test('H6e4: somar junta a revisao aberta e as arquivadas, com a conta da §5.6; sem medida e ilegivel ficam fora', () => {
  const raiz = comum.pasta('aproveitamento-somar');
  try {
    const s = path.join(raiz, '.claude', 'sworn');
    fecho(path.join(s, 'revisao', 'src__a.js'), { ronda: 2, aprovado: true,
      porLente: { correcao: c({ corrigidos: 3, refutados: 1 }), borda: c({ refutados: 2 }) } });
    fecho(path.join(s, 'revisao-fechada', 'src__a.js', '2026-11-01T00-00-00'), { ronda: 3, aprovado: false,
      porLente: { correcao: c({ corrigidos: 1, descartados: 1, abertos: 2 }), estados: c({ abertos: 1 }) } });
    fecho(path.join(s, 'revisao-fechada', 'src__b.js', '2026-10-01T00-00-00'), { ronda: 2, aprovado: true });
    fecho(path.join(s, 'revisao-fechada', 'src__b.js', '2026-10-02T00-00-00'), '{ "ronda": ');
    fecho(path.join(s, 'revisao-fechada', 'src__c.js', 'x'), { ronda: 2, porLente: { correcao: c({ corrigidos: -1 }) } });
    fs.mkdirSync(path.join(s, 'revisao', 'sem-fecho', '1'), { recursive: true });
    const t = apr.somar(raiz);
    assert.strictEqual(t.revisoes, 2, JSON.stringify(t));
    assert.strictEqual(t.semMedida, 1);
    assert.strictEqual(t.ilegiveis, 2, 'o JSON quebrado e a contagem negativa');
    assert.deepStrictEqual(t.porLente, {
      borda: { corrigidos: 0, refutados: 2, descartados: 0, abertos: 0, aproveitamento: 0 },
      correcao: { corrigidos: 4, refutados: 1, descartados: 1, abertos: 2, aproveitamento: 0.67 },
      estados: { corrigidos: 0, refutados: 0, descartados: 0, abertos: 1, aproveitamento: null }
    });
    // o /sworn:audit (opcoes.aproveitamento) mostra o mesmo numero; a rodada automatica nao mede
    assert.deepStrictEqual(aud.auditar(raiz, {}, { aproveitamento: true }).aproveitamento, t);
    assert.strictEqual(aud.auditar(raiz, {}).aproveitamento.medido, false);
    assert.strictEqual(aud.auditar(raiz, {}, { aproveitamento: 'sim' }).aproveitamento.medido, false);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('H6e4: lente com nome de propriedade do Object (constructor, __proto__) conta como as outras e nao toca o prototipo', () => {
  const r = { ronda: 2, seguraram: [{ lente: 'constructor', ronda: 1 }, { lente: '__proto__', ronda: 1 }],
    refutados: [{ lente: 'toString', ronda: 1 }] };
  const pl = apr.daApuracao(r, true);
  assert.deepStrictEqual(Object.keys(pl).sort(), ['__proto__', 'constructor', 'toString']);
  assert.deepStrictEqual(pl.constructor, c({ corrigidos: 1 }));
  assert.deepStrictEqual(Object.getOwnPropertyDescriptor(pl, '__proto__').value, c({ corrigidos: 1 }));
  assert.deepStrictEqual(pl.toString, c({ refutados: 1 }));
  assert.strictEqual(Object.getPrototypeOf(pl), Object.prototype);
  assert.strictEqual(Object.prototype.corrigidos, undefined, 'nada vazou no Object.prototype');
  // o no teto sem aprovar soma aberto pela mesma via
  const teto = apr.daApuracao({ ronda: 3, seguraram: [{ lente: 'constructor', ronda: 3 }], achadosAindaAbertos: [] }, false);
  assert.deepStrictEqual(teto.constructor, c({ abertos: 1 }));

  const raiz = comum.pasta('aproveitamento-proto');
  try {
    fecho(path.join(raiz, '.claude', 'sworn', 'revisao', 'src__a.js'),
      '{"ronda":2,"porLente":{"constructor":{"corrigidos":1,"refutados":1,"descartados":0,"abertos":0},' +
      '"__proto__":{"corrigidos":2,"refutados":0,"descartados":0,"abertos":0}}}');
    const t = apr.somar(raiz);
    assert.strictEqual(t.revisoes, 1, JSON.stringify(t));
    assert.deepStrictEqual(Object.keys(t.porLente).sort(), ['__proto__', 'constructor']);
    assert.strictEqual(t.porLente.constructor.aproveitamento, 0.5);
    assert.strictEqual(Object.getOwnPropertyDescriptor(t.porLente, '__proto__').value.corrigidos, 2);
    assert.strictEqual(Object.getPrototypeOf(t.porLente), Object.prototype);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('H6e4: item que nao e objeto nas listas da apuracao e pulado, sem derrubar o fecho', () => {
  const r = { ronda: 3, seguraram: [null, 5, { lente: 'correcao', ronda: 1 }, { lente: 'borda', ronda: 3 }],
    achadosAindaAbertos: [null], refutados: [null, 'x'], registros: [null] };
  assert.deepStrictEqual(apr.daApuracao(r, false), { correcao: c({ corrigidos: 1 }), borda: c({ abertos: 1 }) });
  const conf = { ronda: 4, seguraram: [{ lente: 'borda', ronda: 3 }], conferencia: { seguem: [null, { lente: 'borda' }] } };
  assert.deepStrictEqual(apr.daApuracao(conf, false), { borda: c({ abertos: 1 }) });
});

test('H6e4: a pasta de revisao que existe e nao se le conta em ilegiveis, nunca como zero revisoes', () => {
  const raiz = comum.pasta('aproveitamento-ilegivel');
  try {
    const s = path.join(raiz, '.claude', 'sworn');
    fs.mkdirSync(s, { recursive: true });
    fs.writeFileSync(path.join(s, 'revisao'), 'nao e pasta', 'utf8');
    fecho(path.join(s, 'revisao-fechada', 'src__a.js', 'x'), { ronda: 2, porLente: { correcao: c({ corrigidos: 1 }) } });
    const t = apr.somar(raiz);
    assert.strictEqual(t.ilegiveis, 1, JSON.stringify(t));
    assert.strictEqual(t.revisoes, 1, 'a outra pasta ainda soma');
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('H6e4: projeto sem revisao nenhuma soma zero, sem erro', () => {
  const raiz = comum.pasta('aproveitamento-vazio');
  try {
    assert.deepStrictEqual(apr.somar(raiz), { revisoes: 0, semMedida: 0, ilegiveis: 0, porLente: {} });
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});
