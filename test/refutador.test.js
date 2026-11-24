'use strict';
// H6e2 (15.0, D898): a lib do refutador independente dos P0/P1 (RA7: o inconclusivo deixa o achado).
const test = require('node:test');
const assert = require('node:assert');
const refutador = require('../scripts/lib/refutador.js');

const ACHADO = { ronda: 2, lente: 'correcao', arquivo: 'B.txt', linha: 40, severidade: 'P0' };
const RESPOSTA = Object.assign({ refutacoes: '.claude/sworn/revisao/src__a.js/refutacoes', veredito: 'refutado',
  prova: 'src/a.js:12 guarda o null', porQue: 'a guarda vem antes' }, ACHADO);

test('H6e2: nomeDoArquivo sai dos campos do achado, com -p2 na 2a passada; fora da forma, null', () => {
  assert.strictEqual(refutador.nomeDoArquivo(ACHADO), 'r2-correcao-B-40-P0.json');
  assert.strictEqual(refutador.nomeDoArquivo(Object.assign({}, ACHADO, { passada: 2 })), 'r2-correcao-B-40-P0-p2.json');
  assert.strictEqual(refutador.nomeDoArquivo(Object.assign({}, ACHADO, { passada: 1 })), 'r2-correcao-B-40-P0.json');
  assert.strictEqual(refutador.nomeDoArquivo(Object.assign({}, ACHADO, { arquivo: 'A.txt', severidade: 'P1' })),
    'r2-correcao-A-40-P1.json');
  for (const torto of [{ ronda: 0 }, { ronda: 1.5 }, { ronda: '2' }, { linha: 0 }, { linha: '40' }, { severidade: 'P2' },
    { severidade: 'p0' }, { arquivo: 'C.txt' }, { arquivo: 'src/a.js' }, { lente: 'inventada' }, { passada: 3 },
    { passada: '2' }]) {
    assert.strictEqual(refutador.nomeDoArquivo(Object.assign({}, ACHADO, torto)), null, JSON.stringify(torto));
  }
  for (const nada of [null, undefined, 7, 'x', []]) assert.strictEqual(refutador.nomeDoArquivo(nada), null);
});

test('H6e2: errosDaResposta pede a pasta, o veredito da lista, a prova e, no refutado, o arquivo:linha', () => {
  assert.deepStrictEqual(refutador.errosDaResposta(RESPOSTA), []);
  for (const v of ['confirmado', 'inconclusivo']) {
    assert.deepStrictEqual(refutador.errosDaResposta(Object.assign({}, RESPOSTA, { veredito: v, prova: 'nao sei dizer' })),
      [], v + ' nao precisa citar linha');
  }
  const um = (extra, re) => {
    const erros = refutador.errosDaResposta(Object.assign({}, RESPOSTA, extra));
    assert.strictEqual(erros.length, 1, JSON.stringify(extra) + ': ' + erros.join(' | '));
    assert.match(erros[0], re);
  };
  um({ refutacoes: ' ' }, /falta "refutacoes"/);
  um({ refutacoes: 7 }, /falta "refutacoes"/);
  um({ veredito: 'Refutado' }, /"veredito" tem de ser/);
  um({ prova: '' }, /falta "prova"/);
  um({ prova: 'a guarda vem antes' }, /precisa citar na "prova" o arquivo:linha .+\(por exemplo, src\/a\.js:12\)/);
  // hora e rotulo com dois-pontos nao sao citacao; arquivo com extensao ou caminho com pasta sao
  for (const p of ['corrigido as 10:30', 'nota:1 diz que nao', 'linha:40', 'versao v1.2:3', 'ver 10.30:5', 'e/:7']) {
    um({ prova: p }, /precisa citar na "prova"/);
  }
  for (const p of ['B.txt:43 guarda o null', 'src/a.js:12', 'src/Makefile:3 tem o alvo', 'scripts\\lib\\x.js:9',
    'C:/repo/x.js:10', '(ver a.js:12)', '/repo/Makefile:3']) {
    assert.deepStrictEqual(refutador.errosDaResposta(Object.assign({}, RESPOSTA, { prova: p })), [], p);
  }
  um({ linha: 'x' }, /o achado nao esta na forma: .+"passada" 1, 2 ou fora do objeto/);
  assert.deepStrictEqual(refutador.errosDaResposta([]), ['a resposta nao e um objeto JSON']);
  assert.deepStrictEqual(refutador.errosDaResposta(null), ['a resposta nao e um objeto JSON']);
});

test('H6e2: faltas so cobra P0/P1 de achado que o apurar exige, e so aceita a resposta "refutado" do mesmo achado', () => {
  const sempre = () => true;
  const nomes = [];
  const de = (mapa) => (nome) => { nomes.push(nome); return Object.prototype.hasOwnProperty.call(mapa, nome) ? mapa[nome] : null; };
  // lacuna, P2, entrada torta e a que o apurar nao exige ficam fora, sem ler nada
  const fora = [Object.assign({}, ACHADO, { lacuna: true }), Object.assign({}, ACHADO, { severidade: 'P2' }), null, 'x',
    Object.assign({}, ACHADO, { linha: 0 })];
  assert.deepStrictEqual(refutador.faltas(fora, sempre, de({})), []);
  assert.deepStrictEqual(refutador.faltas([ACHADO], () => false, de({})), []);
  assert.deepStrictEqual(nomes, [], 'leu resposta de entrada que nao exige');
  assert.deepStrictEqual(refutador.faltas('nao e lista', sempre, de({})), []);
  // sem resposta
  let m = refutador.faltas([ACHADO], sempre, de({}));
  assert.strictEqual(m.length, 1);
  assert.match(m[0], /^a refutacao do P0 da ronda 2, lente correcao, B\.txt:40 nao tem a resposta do refutador \(refutacoes\/r2-correcao-B-40-P0\.json\)/);
  // refutado do mesmo achado: vale
  assert.deepStrictEqual(refutador.faltas([ACHADO], sempre, de({ 'r2-correcao-B-40-P0.json': RESPOSTA })), []);
  // a 2a passada procura o -p2, e a resposta sem passada nao serve para ela
  m = refutador.faltas([Object.assign({}, ACHADO, { passada: 2 })], sempre, de({ 'r2-correcao-B-40-P0.json': RESPOSTA }));
  assert.match(m[0], /\(2a passada\) nao tem a resposta do refutador \(refutacoes\/r2-correcao-B-40-P0-p2\.json\)/);
  // inconclusivo e confirmado ficam (RA7)
  for (const v of ['inconclusivo', 'confirmado']) {
    m = refutador.faltas([ACHADO], sempre, de({ 'r2-correcao-B-40-P0.json': Object.assign({}, RESPOSTA, { veredito: v }) }));
    assert.strictEqual(m.length, 1);
    assert.match(m[0], new RegExp('o refutador respondeu "' + v + '" .+: o achado fica \\(RA7\\)'));
  }
  // resposta de outro achado no nome deste
  m = refutador.faltas([ACHADO], sempre, de({ 'r2-correcao-B-40-P0.json': Object.assign({}, RESPOSTA, { linha: 41 }) }));
  assert.match(m[0], /e de outro achado \(ela diz r2-correcao-B-41-P0\.json\)\. Mova o arquivo para fora de refutacoes\//);
  // resposta fora da forma e arquivo que nao se le
  m = refutador.faltas([ACHADO], sempre, de({ 'r2-correcao-B-40-P0.json': Object.assign({}, RESPOSTA, { prova: '' }) }));
  assert.match(m[0], /esta fora da forma \(falta "prova".*\)\. Mova o arquivo para fora de refutacoes\//);
  m = refutador.faltas([ACHADO], sempre, () => { throw new Error('JSON torto'); });
  assert.match(m[0], /nao se le \(Error: JSON torto\)\. Mova o arquivo para fora de refutacoes\//);
  // a causa vem traduzida pelo codigo do Node, e o que nao e Error (throw de texto) nao vira "undefined"
  m = refutador.faltas([ACHADO], sempre, () => { throw Object.assign(new Error('x'), { code: 'EBUSY' }); });
  assert.match(m[0], /nao se le \(em uso \(EBUSY\)\)/);
  m = refutador.faltas([ACHADO], sempre, () => { throw 'quebrou'; });
  assert.match(m[0], /nao se le \(quebrou\)/);
  // a prova longa sai cortada em 120 caracteres (code point, sem partir emoji) com "..."; a curta, inteira
  const longa = '😀'.repeat(119) + 'ab' + 'z'.repeat(50);
  m = refutador.faltas([ACHADO], sempre, de({ 'r2-correcao-B-40-P0.json': Object.assign({}, RESPOSTA,
    { veredito: 'inconclusivo', prova: longa }) }));
  assert.ok(m[0].includes('(' + '😀'.repeat(119) + 'a...)'), m[0]);
  m = refutador.faltas([ACHADO], sempre, de({ 'r2-correcao-B-40-P0.json': Object.assign({}, RESPOSTA,
    { veredito: 'confirmado', prova: 'curta' }) }));
  assert.ok(m[0].includes('(curta): o achado fica'), m[0]);
  // uma mensagem por refutacao
  assert.strictEqual(refutador.faltas([ACHADO, Object.assign({}, ACHADO, { linha: 7 })], sempre, de({})).length, 2);
});
