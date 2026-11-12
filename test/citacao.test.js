'use strict';
// D826 (D4): a conferencia de citacao "arquivo:linha + texto" sai do apurar-ronda.js (D821) para uma lib com as
// raizes como argumento: o apurar confere a prova da refutacao no projeto, o /sworn:diagnose confere o achado do
// analista no projeto e na pasta das transcricoes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const citacao = require('../scripts/lib/citacao.js');

function pasta(prefixo) { return fs.mkdtempSync(path.join(os.tmpdir(), prefixo)); }

test('D826: a citacao confere na linha citada e ate n vizinhas, com os espacos normalizados', () => {
  const raiz = pasta('sworn-cit-');
  try {
    fs.writeFileSync(path.join(raiz, 'a.js'), '﻿um\ndois   tres\nquatro\ncinco\nseis\n', 'utf8');
    assert.strictEqual(citacao.citacaoConfere(raiz, 'a.js', 2, 'dois tres', 0), true);
    assert.strictEqual(citacao.citacaoConfere(raiz, 'a.js', 1, 'um', 0), true, 'o BOM nao entra no texto');
    assert.strictEqual(citacao.citacaoConfere(raiz, 'a.js', 4, 'dois tres', 2), true);
    assert.strictEqual(citacao.citacaoConfere(raiz, 'a.js', 5, 'dois tres', 2), false, 'fora da janela');
    assert.strictEqual(citacao.citacaoConfere(raiz, 'a.js', 4, 'dois tres', 0), false, 'sem vizinhas, so a linha');
    assert.strictEqual(citacao.citacaoConfere(raiz, 'a.js', 5, 'seis', 0), true);
    // a quebra final nao e uma linha a mais: a linha 6 nao existe, nem pelas vizinhas
    assert.strictEqual(citacao.citacaoConfere(raiz, 'a.js', 6, 'seis', 2), false);
    assert.strictEqual(citacao.citacaoConfere(raiz, 'a.js', 7, 'seis', 2), false);
    for (const vazio of ['', '   ', null]) {
      assert.strictEqual(citacao.citacaoConfere(raiz, 'a.js', 1, vazio, 0), false, 'texto vazio nao confere: ' + vazio);
    }
    for (const ruim of [0, -1, 7, 2.5, '2', null]) {
      assert.strictEqual(citacao.citacaoConfere(raiz, 'a.js', ruim, 'dois', 0), false, 'linha ' + ruim);
    }
    assert.strictEqual(citacao.citacaoConfere(raiz, 'nao-existe.js', 1, 'um', 0), false);
    fs.mkdirSync(path.join(raiz, 'pasta.js'));
    assert.strictEqual(citacao.citacaoConfere(raiz, 'pasta.js', 1, 'um', 0), false, 'pasta nao se le');
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('D826: so vale arquivo dentro de uma das raizes, tambem pelo caminho real', (t) => {
  const raiz = pasta('sworn-cit-raiz-');
  const outra = pasta('sworn-cit-outra-');
  const fora = pasta('sworn-cit-fora-');
  try {
    fs.writeFileSync(path.join(raiz, 'a.js'), 'na raiz\n', 'utf8');
    fs.writeFileSync(path.join(outra, 'sessao.jsonl'), '{"x":1}\n{"texto":"o dono pediu"}\n', 'utf8');
    fs.writeFileSync(path.join(fora, 'segredo.txt'), 'fora\n', 'utf8');
    const raizes = [raiz, outra];
    assert.strictEqual(citacao.citacaoConfere(raizes, 'a.js', 1, 'na raiz', 0), true, 'relativo vai pela 1a raiz');
    assert.strictEqual(citacao.citacaoConfere(raizes, path.join(outra, 'sessao.jsonl'), 2, '"texto":"o dono pediu"', 0),
      true, 'a 2a raiz vale por caminho absoluto');
    assert.strictEqual(citacao.citacaoConfere(raizes, path.join(fora, 'segredo.txt'), 1, 'fora', 0), false);
    assert.strictEqual(citacao.citacaoConfere(raizes, '../' + path.basename(fora) + '/segredo.txt', 1, 'fora', 0), false);
    assert.strictEqual(citacao.citacaoConfere(raiz, path.join(outra, 'sessao.jsonl'), 2, 'o dono', 0), false,
      'sem a 2a raiz, a transcricao nao vale');
    assert.strictEqual(citacao.citacaoConfere(raizes, raiz, 1, 'na raiz', 0), false, 'a raiz em si nao e arquivo');
    let linkFeito = false;
    try { fs.symlinkSync(fora, path.join(raiz, 'atalho'), 'junction'); linkFeito = true; } catch (e) { /* sem permissao */ }
    // sem permissao para o atalho, o caso nao roda, e o relatorio do teste diz isso em vez de calar
    if (!linkFeito) t.diagnostic('atalho nao criado (sem permissao): o caso do caminho real que sai da raiz nao rodou');
    if (linkFeito) {
      assert.strictEqual(citacao.citacaoConfere(raizes, 'atalho/segredo.txt', 1, 'fora', 0), false,
        'o atalho dentro da raiz que aponta para fora nao vale');
    }
  } finally {
    for (const p of [raiz, outra, fora]) fs.rmSync(p, { recursive: true, force: true });
  }
});

test('D826: le em blocos: linha maior que o bloco, CRLF, e raiz invalida da false sem lancar', () => {
  const raiz = pasta('sworn-cit-bloco-');
  try {
    // a linha 2 passa de 1 MB (o bloco de leitura) e a marca fica no fim dela, depois da fronteira do bloco
    fs.writeFileSync(path.join(raiz, 'grande.jsonl'), 'um\n' + 'x'.repeat(1536 * 1024) + 'MARCA\nfim', 'utf8');
    assert.strictEqual(citacao.citacaoConfere(raiz, 'grande.jsonl', 2, 'xxMARCA', 0), true);
    assert.strictEqual(citacao.citacaoConfere(raiz, 'grande.jsonl', 3, 'fim', 0), true, 'a ultima linha, sem quebra');
    assert.strictEqual(citacao.citacaoConfere(raiz, 'grande.jsonl', 1, 'MARCA', 0), false);
    assert.strictEqual(citacao.citacaoConfere(raiz, 'grande.jsonl', 4, 'fim', 1), false);
    fs.writeFileSync(path.join(raiz, 'crlf.txt'), 'a\r\nb c\r\n', 'utf8');
    assert.strictEqual(citacao.citacaoConfere(raiz, 'crlf.txt', 2, 'b c', 0), true);
    assert.strictEqual(citacao.citacaoConfere(raiz, 'crlf.txt', 3, 'b c', 1), false, 'a quebra final nao abre linha');
    for (const ruim of [undefined, null, [], [null], [''], 42]) {
      assert.strictEqual(citacao.citacaoConfere(ruim, 'crlf.txt', 1, 'a', 0), false, 'raizes ' + JSON.stringify(ruim));
    }
    assert.strictEqual(citacao.citacaoConfere([null, raiz], 'crlf.txt', 1, 'a', 0), true, 'a raiz valida da lista vale');
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('D826: dentroDe separa o filho do vizinho e do pai', () => {
  const raiz = path.resolve('/tmp/proj');
  assert.strictEqual(citacao.dentroDe(raiz, path.join(raiz, 'a', 'b.js')), true);
  assert.strictEqual(citacao.dentroDe(raiz, path.join(raiz, '..notas.md')), true, '"..notas.md" e um arquivo dentro');
  assert.strictEqual(citacao.dentroDe(raiz, raiz), false);
  assert.strictEqual(citacao.dentroDe(raiz, path.resolve('/tmp/proj-2/a.js')), false);
  assert.strictEqual(citacao.dentroDe(raiz, path.resolve('/tmp')), false);
});
