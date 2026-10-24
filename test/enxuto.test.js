'use strict';
// D553/D554 (0.9.0, plano 090 Tarefa 3): o bloco "menos codigo" sai na abertura de toda sessao, depois do de
// qualidade de resposta, no molde do bloco de paralelismo. Ideia do ponytail (escada antes de escrever codigo),
// texto proprio. O formato do comentario de atalho e o da D554 (rotulos, nao virgula).
const test = require('node:test');
const assert = require('node:assert');
const e = require('../scripts/lib/enxuto.js');
const projetoLib = require('../scripts/lib/projeto.js');

test('enxuto: o bloco traz a escada de 7 degraus, na ordem, e manda parar no primeiro que resolve', () => {
  const b = e.BLOCO;
  assert.ok(/^# sworn - menos codigo/.test(b), 'titulo');
  assert.ok(/pare no primeiro degrau que resolve/.test(b), 'parar no primeiro degrau');
  const degraus = [/^1\. Precisa existir\?/m, /^2\. Ja existe no projeto\?.*arquivo:linha/m, /^3\. A linguagem ja faz/m,
    /^4\. A plataforma ja faz/m, /^5\. Uma dependencia ja instalada faz\?/m, /^6\. Cabe em uma linha\?/m,
    /^7\. So entao, o minimo que funciona/m];
  let antes = -1;
  for (const d of degraus) {
    const m = b.match(d);
    assert.ok(m, 'falta o degrau ' + d);
    assert.ok(m.index > antes, 'degrau fora de ordem: ' + d);
    antes = m.index;
  }
  assert.ok(!/^8\./m.test(b), 'a escada tem 7 degraus');
});

test('enxuto: o que nunca se corta, o formato do atalho (D554) e o alcance (codigo, nao documento)', () => {
  const b = e.BLOCO;
  const linha = b.split('\n').filter((l) => /^Nunca se corta:/.test(l))[0];
  assert.ok(linha, 'falta a linha do que nunca se corta');
  for (const t of ['validacao na fronteira', 'perda de dados', 'seguranca', 'acessibilidade']) {
    assert.ok(linha.includes(t), 'nunca se corta sem: ' + t);
  }
  assert.ok(b.includes('atalho: <o que>. limite: <ate onde vale>. trocar quando: <gatilho>.'), 'formato da D554');
  assert.ok(/Vale para codigo; texto de documento fica fora\./.test(b), 'alcance');
});

test('enxuto: ASCII puro (texto de hook) e dentro do teto de tamanho', () => {
  assert.ok(/^[\x20-\x7E\n]+$/.test(e.BLOCO), 'caractere fora de ASCII no bloco');
  assert.ok(e.BLOCO.length <= e.TETO, 'bloco com ' + e.BLOCO.length + ' caracteres, teto ' + e.TETO);
  assert.strictEqual(e.TETO, 800);
});

test('enxuto: ligado sem projeto, chave ausente, true ou tipo errado; so o booleano false desliga', () => {
  for (const v of [null, undefined, {}, { menosCodigo: true }, { menosCodigo: 'false' }, { menosCodigo: 0 }, [], 'x']) {
    assert.strictEqual(e.bloco(v), e.BLOCO, JSON.stringify(v));
  }
  assert.strictEqual(e.bloco({ menosCodigo: false }), null);
  assert.strictEqual(e.CHAVE, 'menosCodigo');
  const linha = e.BLOCO.split('\n').filter((l) => /^Desligar/.test(l))[0];
  assert.ok(linha && linha.includes('"' + e.CHAVE + '": false'), 'a linha de desligar cita a chave que o codigo le');
});

test('enxuto: a chave e de liga/desliga do projeto.json (aviso de tipo, nao ignorada)', () => {
  assert.ok(projetoLib.CHAVES_LIGA_DESLIGA.indexOf('menosCodigo') !== -1);
  assert.ok(projetoLib.avisosDeTipo({ menosCodigo: 'false' }).indexOf('menosCodigo tem de ser true ou false') !== -1);
  assert.deepStrictEqual(projetoLib.avisosDeTipo({ menosCodigo: false }), []);
});
