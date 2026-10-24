'use strict';
const test = require('node:test');
const assert = require('node:assert');
const ev = require('../scripts/lib/evidencia.js');

test('evidencia: alegacao sem bloco e sem ressalva bloqueia', () => {
  assert.strictEqual(ev.deveBloquear('Pronto, os testes passaram.'), true);
  assert.strictEqual(ev.deveBloquear('Corrigido e funcionando.'), true);
  assert.strictEqual(ev.deveBloquear('All tests pass now.'), true);
});

test('evidencia: alegacao COM bloco de saida passa', () => {
  const texto = 'Os testes passaram.\n\n```\n$ npm test\n# pass 12\n# fail 0\n```';
  assert.strictEqual(ev.deveBloquear(texto), false);
});

test('evidencia: alegacao COM declaracao de nao-rodado passa', () => {
  assert.strictEqual(ev.deveBloquear('Implementado. Nao rodei os testes: nao ha runner neste repo.'), false);
  assert.strictEqual(ev.deveBloquear('Corrigido, mas nao testei em Windows.'), false);
});

test('evidencia: conversa sem alegacao passa', () => {
  assert.strictEqual(ev.deveBloquear('O arquivo de rotas fica em src/rotas.js.'), false);
  assert.strictEqual(ev.deveBloquear(''), false);
  assert.strictEqual(ev.deveBloquear(undefined), false);
});

test('evidencia: alegacao DENTRO de bloco de codigo nao conta como alegacao', () => {
  const texto = 'Ajustei o texto do botao.\n\n```js\nconst msg = "pronto";\n```';
  const a = ev.analisar(texto);
  assert.strictEqual(a.alegaSucesso, false, 'a palavra estava dentro do bloco');
  assert.strictEqual(ev.deveBloquear(texto), false);
});

test('evidencia: analisar separa os tres sinais', () => {
  const a = ev.analisar('Passou.');
  assert.deepStrictEqual(a, { alegaSucesso: true, temBloco: false, declaraNaoRodou: false });
});

test('evidencia: MOTIVO e ASCII puro (R5) e diz o que fazer', () => {
  assert.ok(/^[\x20-\x7E\n]+$/.test(ev.MOTIVO), 'MOTIVO tem caractere fora de ASCII');
  assert.ok(ev.MOTIVO.includes('declare'));
  assert.ok(ev.MOTIVO.includes('```') || ev.MOTIVO.includes('bloco'));
});

// D31: a trava para de aceitar qualquer par de crases.

test('evidencia D31: bloco vazio de crases nao conta como evidencia (burla fechada)', () => {
  const texto = 'Pronto, os testes passaram.\n\n```\n```';
  assert.strictEqual(ev.deveBloquear(texto), true);
});

test('evidencia D31: bloco de codigo-fonte nao conta como evidencia (burla fechada)', () => {
  const texto = 'Pronto, os testes passaram.\n\n```js\nconsole.log("ok");\n```';
  assert.strictEqual(ev.deveBloquear(texto), true);
});

test('evidencia D31: "sem teste" solto nao conta mais como ressalva honesta (burla fechada)', () => {
  const texto = 'Pronto, sem teste.';
  assert.strictEqual(ev.deveBloquear(texto), true);
});

// D634 (7a): o bloco que mostra falha nao prova sucesso.

test('evidencia D634: alegacao com so blocos que mostram falha -> deveBloquearPorFalha', () => {
  const falhas = ['# tests 5\n# pass 2\n# fail 3', '  2 failing', 'ok 1 - a\nnot ok 2 - b', '$ npm test\nExit code 1',
    'npm ERR! Test failed.', 'Command timed out after 2m', '1 test failed', 'tempo esgotado', 'failures: 4'];
  for (const f of falhas) {
    const texto = 'Pronto, os testes passaram.\n\n```\n' + f + '\n```';
    assert.strictEqual(ev.deveBloquearPorFalha(texto), true, 'devia ver falha em: ' + JSON.stringify(f));
    assert.strictEqual(ev.deveBloquear(texto), false, 'o bloco existe: a trava de sem-evidencia nao muda');
  }
});

test('evidencia D634: "fail 0", TODO do tap e saida limpa nao sao falha', () => {
  for (const b of ['# pass 12\n# fail 0', 'tests 12 | pass 12 | fail 0', '0 failed, 10 passed', 'not ok 3 - x # TODO depois\nok 4 - y', 'exit code 0']) {
    assert.strictEqual(ev.deveBloquearPorFalha('Pronto, passou.\n```\n' + b + '\n```'), false, 'falso positivo em: ' + JSON.stringify(b));
  }
});

test('evidencia D634: um bloco que passa ao lado do que falhou libera ("o erro era X, agora passa")', () => {
  const texto = 'O erro era o caminho; corrigido, agora os testes passaram.\n```\n# fail 2\n```\n\n```\n# pass 5\n# fail 0\n```';
  assert.strictEqual(ev.deveBloquearPorFalha(texto), false);
  assert.strictEqual(ev.deveBloquearPorFalha(texto.replace('# pass 5\n# fail 0', '# fail 1')), true, 'controle: com os dois falhando, barra');
});

test('evidencia D634: declaraRessalva le a prosa (nao-rodou ou falha que segue), nunca o bloco', () => {
  assert.strictEqual(ev.declaraRessalva('Pronto, mas o teste de datas ainda falha.'), true);
  assert.strictEqual(ev.declaraRessalva('Pronto. Nao rodei a suite.'), true);
  assert.strictEqual(ev.declaraRessalva('Pronto.\n```\nnao rodei\n```'), false, 'a frase dentro do bloco nao e ressalva');
  assert.strictEqual(ev.declaraRessalva('Pronto, os testes passaram.'), false);
});

test('evidencia D634: os motivos do 7b e do 8 citam o comando em ASCII (R5) e curto', () => {
  const vermelho = ev.motivoTesteVermelho('npm test -- ação');
  assert.ok(/^[\n\x20-\x7E]*$/.test(vermelho), 'ASCII (R5): ' + vermelho);
  // R5: o motivo e ASCII puro, entao citado() troca cada caractere fora de ASCII do comando por '?' ("ação" -> "a??o").
  assert.ok(vermelho.indexOf('npm test -- a??o') !== -1, 'cada caractere fora de ASCII vira "?": ' + vermelho);
  const longo = ev.motivoTesteVermelho('npm test ' + 'x'.repeat(300));
  assert.ok(longo.split('\n').every((l) => l.length <= 124) && /\.\.\.$/m.test(longo), longo);
  const prova = ev.motivoProvaNaoRodou('npm test');
  assert.ok(/prova de pronto/.test(prova) && prova.indexOf('  npm test') !== -1, prova);
});

test('evidencia D634: quem declara que ainda falha ou que nao rodou nao e barrado', () => {
  const bloco = '\n```\n# fail 1\n```';
  assert.strictEqual(ev.deveBloquearPorFalha('Corrigido o parser, mas o teste de datas ainda falha.' + bloco), false);
  assert.strictEqual(ev.deveBloquearPorFalha('Implementado; o teste continua falhando no Windows.' + bloco), false);
  assert.strictEqual(ev.deveBloquearPorFalha('Implementado. Nao rodei a suite inteira.' + bloco), false);
  assert.strictEqual(ev.deveBloquearPorFalha('Segue a saida do teste.' + bloco), false, 'sem alegacao nao ha o que barrar');
});

test('evidencia D634: textoMostraFalha olha um texto solto (a saida de um comando)', () => {
  assert.strictEqual(ev.textoMostraFalha('# pass 3\n# fail 2'), true);
  assert.strictEqual(ev.textoMostraFalha('# pass 3\n# fail 0'), false);
  assert.strictEqual(ev.textoMostraFalha(undefined), false);
});

test('evidencia D634: nome de teste com "timed out" ou "ERR!" numa saida com "fail 0" nao e falha', () => {
  for (const b of ['ok 3 - devolve erro quando o pedido timed out\n# pass 3\n# fail 0',
    'ok 1 - mostra npm ERR! ao usuario\n# fail 0', 'ok 2 - tempo esgotado vira aviso\n0 failed, 2 passed']) {
    assert.strictEqual(ev.textoMostraFalha(b), false, 'falso positivo em: ' + JSON.stringify(b));
    assert.strictEqual(ev.deveBloquearPorFalha('Pronto, os testes passaram.\n```\n' + b + '\n```'), false, JSON.stringify(b));
  }
  // controle: sem o resumo que zera, a palavra solta segue sendo falha; e "fail 0" nao apaga uma contagem que falhou
  assert.strictEqual(ev.textoMostraFalha('Command timed out after 2m'), true);
  assert.strictEqual(ev.textoMostraFalha('# fail 0\nExit code 1'), true);
  assert.strictEqual(ev.textoMostraFalha('# fail 0\nnot ok 4 - b'), true);
});

test('evidencia D639: "nao passa" nao e ressalva, nem falando de teste; "ainda falhava" e a causa contada', () => {
  const bloco = '\n```\n# fail 1\n```';
  // a regex nao separa "o GET nao passa pelo filtro nos testes" de "o teste nao passa": as duas barram uma vez
  assert.strictEqual(ev.deveBloquearPorFalha('Pronto, o GET nao passa pelo filtro, como esperado.' + bloco), true);
  assert.strictEqual(ev.deveBloquearPorFalha('Pronto. O GET nao passa pelo filtro nos testes.' + bloco), true);
  assert.strictEqual(ev.deveBloquearPorFalha('Pronto, funciona. Os testes garantem o GET nao passa pelo filtro.' + bloco), true);
  assert.strictEqual(ev.deveBloquearPorFalha('Implementado, mas o teste de datas nao passa.' + bloco), true);
  assert.strictEqual(ev.deveBloquearPorFalha('Implementado, mas nao passou na suite do Windows.' + bloco), true);
  assert.strictEqual(ev.deveBloquearPorFalha('Corrigido: o teste ainda falhava por causa do caminho.' + bloco), true);
  // controle: a frase que o motivo ensina libera
  assert.ok(/ainda falha/.test(ev.MOTIVO_FALHA), 'o motivo ensina a frase que libera');
  assert.strictEqual(ev.deveBloquearPorFalha('Implementado, mas o teste de datas ainda falha.' + bloco), false);
  assert.strictEqual(ev.deveBloquearPorFalha('Pronto, mas os testes continuam falhando.' + bloco), false);
  assert.strictEqual(ev.declaraRessalva('Pronto, mas os testes ainda falham no Linux.'), true);
});

test('evidencia D634: MOTIVO_FALHA e ASCII (R5), diz o que fazer e traz a regra do teste instavel', () => {
  assert.ok(/^[\x20-\x7E\n]+$/.test(ev.MOTIVO_FALHA), 'MOTIVO_FALHA tem caractere fora de ASCII');
  assert.ok(/mostra falha/.test(ev.MOTIVO_FALHA));
  assert.ok(/instavel/.test(ev.MOTIVO_FALHA));
});
