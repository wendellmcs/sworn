'use strict';
// Pedido 32 (plano dos pedidos 30-32, Tarefa 4; D519, D522): a identidade visual do sworn - um acento so, o ambar
// dos banners, sobre os neutros do tema. Na faixa: a chave de tema `warning` no terminal e no Desktop (D519); a cor
// crua no VS Code, onde a chave nao pinta (D522, sonda da s53). Fonte unica: o mod (que nao le Node) repete as duas
// cores, e este teste confere a copia.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const identidade = require('../scripts/lib/identidade.js');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

function maisFrequente(svg) {
  const conta = {};
  for (const c of svg.match(/#[0-9A-Fa-f]{6}\b/g) || []) conta[c.toUpperCase()] = (conta[c.toUpperCase()] || 0) + 1;
  return Object.keys(conta).sort(function (a, b) { return conta[b] - conta[a]; })[0];
}

test('identidade: o acento e a cor mais usada de cada banner (escuro e claro)', () => {
  assert.strictEqual(identidade.ACENTO.escuro, maisFrequente(ler('assets/banner-escuro.svg')));
  assert.strictEqual(identidade.ACENTO.claro, maisFrequente(ler('assets/banner-claro.svg')));
});

test('identidade: cor do acento por tela - cru no vscode (D522), chave de tema no resto (D519)', () => {
  assert.strictEqual(identidade.corDoAcento('vscode'), '#F59E0B');
  for (const tela of ['terminal', 'desktop', 'mobile', undefined, 'outra']) {
    assert.strictEqual(identidade.corDoAcento(tela), 'warning', String(tela));
  }
});

// Plano 082, Tarefa 6 (p8-15): so 'vscode' exato pintava cru; outra grafia do mesmo editor caia na chave calada.
test('082 T6 (p8-15): a tela do VS Code em outra grafia (caixa, espaco) tambem pinta cru', () => {
  for (const tela of ['VSCode', ' vscode ', 'VS Code', 'vs code']) {
    assert.strictEqual(identidade.corDoAcento(tela), '#F59E0B', JSON.stringify(tela));
  }
  assert.strictEqual(identidade.corDoAcento('vscodex'), 'warning');
});

test('identidade: o mod repete as duas cores da lib (fonte unica conferida)', () => {
  const mod = ler('hooks/mods.tsx');
  assert.ok(mod.indexOf("const ACENTO_CRU = '" + identidade.ACENTO.escuro + "'") !== -1, 'ACENTO_CRU no mods.tsx');
  assert.ok(mod.indexOf("const ACENTO_TEMA = '" + identidade.TEMA + "'") !== -1, 'ACENTO_TEMA no mods.tsx');
  // um acento so: nenhuma outra cor crua no mod
  const cruas = (mod.match(/#[0-9A-Fa-f]{6}\b/g) || []).filter(function (c) { return c.toUpperCase() !== identidade.ACENTO.escuro; });
  assert.deepStrictEqual(cruas, []);
});

// Plano 083 (p1-19): o texto com acento que o mod mostra (D532: faixa, status e resposta de comando desenham acento
// inteiro). Cada um em NFC (o "a" + til combinante sai quebrado em terminal), sem mojibake e sem BOM, e cada um fixado
// por igualdade em hooks/mods.test.ts, que roda contra o motor (claude plugin test).
test('083 T5 (p1-19): as strings acentuadas do mod sao NFC, sem mojibake, e cada uma tem teste exato no mods.test.ts', () => {
  const mod = ler('hooks/mods.tsx');
  const testes = ler('hooks/mods.test.ts');
  assert.ok(mod.charCodeAt(0) !== 0xfeff, 'mods.tsx sem BOM');
  assert.strictEqual(mod, mod.normalize('NFC'), 'mods.tsx em NFC');
  assert.doesNotMatch(mod, /Ã|Â|�/, 'mojibake no mods.tsx');
  const literais = [];
  for (const m of mod.matchAll(/'([^'\n]*)'/g)) if (/[^\x00-\x7F]/.test(m[1])) literais.push(m[1]);
  assert.deepStrictEqual(literais, [
    'medidor parado: o Node.js não respondeu. Rode node -v num terminal para conferir.',
    'Medidor parado: o Node.js não respondeu. Rode **node -v** num terminal para conferir.',
    'Painel do plano parado: o Node.js não respondeu. Rode **node -v** num terminal para conferir.',
    'Não consegui escrever no prompt. Digite '
  ]);
  for (const l of literais) assert.ok(testes.indexOf(l) !== -1, 'sem teste exato no mods.test.ts: ' + l);
});

test('identidade: o README tem a secao "Aparencia" com as duas cores e a regra por tela', () => {
  const readme = ler('GUIA.md');
  const i = readme.indexOf('### Aparência');
  assert.ok(i !== -1, 'secao ### Aparencia');
  const secao = readme.slice(i, readme.indexOf('\n#', i + 5) === -1 ? undefined : readme.indexOf('\n#', i + 5));
  for (const t of [identidade.ACENTO.escuro, identidade.ACENTO.claro, '`warning`', 'VS Code']) {
    assert.ok(secao.indexOf(t) !== -1, t + ' na secao: ' + secao);
  }
});
