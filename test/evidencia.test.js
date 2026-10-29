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

// A3-10 (pedido 12): citado() fazia String(null) e o motivo trazia "null", onde semBlocos e analisar dao ''.
test('evidencia A3-10: comando ausente nao vira "null" nem "undefined" no motivo', () => {
  for (const v of [null, undefined]) {
    for (const m of [ev.motivoTesteVermelho(v), ev.motivoProvaNaoRodou(v)]) assert.ok(!/null|undefined/.test(m), m);
  }
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

// D656 (camada 1): quem responde em ingles alega, ressalva e admite falha em ingles. O corpus de falso positivo
// vem nos dois idiomas: o padrao novo nao pode pegar o que o antigo deixava passar.

test('evidencia D656: alegacao em ingles e reconhecida, como a em portugues', () => {
  for (const t of ['Done.', 'Fixed the parser.', 'All tests pass.', 'The tests passed.', 'The suite passes now.',
    'It works now.', 'It works.', 'The hook is working.', 'Implemented the new gate.', 'Resolved the conflict.',
    'Completed the migration.', 'All set.', 'It worked.', 'No errors left.', 'Ran without errors.', 'CI is green.',
    'Everything is green.', 'The PR is ready.', 'All good.', 'It’s working now.', 'It’s ready.',
    'I implemented the gate.', 'We resolved the conflict.', 'The issue is resolved.', 'Completed and pushed.',
    'The parser is implemented now.', 'Step 2: completed.', 'It’s ready, and the docs too.',
    'The build is ready and tested.', 'The bug is resolved\nNext: the docs.', 'The PR is ready\r\nNext: the docs.',
    'We have resolved the conflict.', 'I’ve completed the migration.', 'Summary\nImplemented the gate.',
    'The issue is resolved', '- Implemented the gate', '**Implemented** the gate.', '1) Resolved the conflict',
    'I successfully implemented the gate.', 'I have fully implemented it.']) {
    assert.strictEqual(ev.analisar(t).alegaSucesso, true, 'devia alegar: ' + t);
    assert.strictEqual(ev.deveBloquear(t), true, 'sem bloco e sem ressalva, barra: ' + t);
  }
});

test('evidencia D656: o que nao alega segue sem alegar, em portugues e em ingles (falso positivo)', () => {
  for (const t of ['The routes file lives in src/routes.js.', 'I passed the flag --strict to the linter.',
    'The value passed to the function is a string.', 'Here is how it works: the hook reads stdin.',
    'Is the build ready for review?', 'The green button opens the panel.', 'If there are no errors, the hook stays silent.',
    'This resolves to the plugin folder.', 'Pending: the parser and the docs.', 'Which option do you prefer?',
    'The test checks that the flag is passed through.', 'Once the work is complete, I will run the suite.',
    // D659: "is ready", "completed", "implemented" e "resolved" que seguem descrevendo nao alegam.
    'The server is ready to accept connections once you set the env var.', 'The loader completed in 2s by design.',
    'The ticket was resolved by the DNS team last week.', 'The feature is implemented in the old module, not here.',
    'Requests are ready for retry after 5 seconds.', 'Implementedness is a made-up word.',
    'O arquivo de rotas fica em src/rotas.js.', 'Abri o arquivo e li a funcao.', 'Segui para o proximo passo.',
    'Qual opcao voce prefere?', 'Falta decidir o nome.', 'O valor passado para a funcao e texto.']) {
    assert.strictEqual(ev.analisar(t).alegaSucesso, false, 'falso positivo: ' + t);
  }
});

test('evidencia D659: os padroes com lookbehind rodam em tempo linear (o gancho le texto do modelo)', () => {
  for (const t of [' '.repeat(50000) + 'completed x', '.' + ' '.repeat(50000) + 'x', 'is ready' + ' '.repeat(50000) + 'x',
    'completed' + ' '.repeat(50000) + 'x', '\n'.repeat(50000) + 'implemented x']) {
    const t0 = Date.now();
    ev.analisar(t);
    assert.ok(Date.now() - t0 < 200, 'lento: ' + JSON.stringify(t.slice(0, 12)));
  }
});

test('evidencia D656: "nao rodei" em ingles libera a alegacao, como em portugues', () => {
  for (const t of ['Implemented. I didn\'t run the tests: no runner here.', 'Fixed, but I did not test it on Windows.',
    'Done; the suite has not been run yet.', 'Fixed. I haven\'t run the suite.', 'Implemented; untested on Linux.',
    'Done, but I couldn\'t reproduce the bug.', 'Fixed. I was not able to run the e2e tests.',
    'Implemented; the docs still need to be tested.', 'Done; the migration is yet to be verified.',
    'Fixed. I didn’t run the suite.']) {
    assert.strictEqual(ev.analisar(t).declaraNaoRodou, true, 'devia ser ressalva: ' + t);
    assert.strictEqual(ev.deveBloquear(t), false, t);
  }
  // controle: instrucao ao usuario e saida limpa nao sao ressalva - seguem barrando
  for (const t of ['Done. You need to run npm install first.', 'Fixed. Run the suite with npm test.', 'Done; nothing failed.',
    'Pronto. Rode a suite com npm test.']) {
    assert.strictEqual(ev.deveBloquear(t), true, 'ressalva falsa: ' + t);
  }
});

test('evidencia D656: "ainda falha" em ingles libera; "was still failing" e a causa contada e barra', () => {
  const bloco = '\n```\n# fail 1\n```';
  for (const t of ['Fixed the parser, but the date test keeps failing.', 'Implemented; the test continues to fail on Windows.',
    'Done, but CI is still red.', 'Implemented, but the date test still fails.', 'Done; two tests are still failing.']) {
    assert.strictEqual(ev.declaraRessalva(t), true, 'devia ser ressalva: ' + t);
    assert.strictEqual(ev.deveBloquearPorFalha(t + bloco), false, t);
  }
  for (const t of ['Fixed: the test was still failing because of the path.', 'Done. The tests were still failing before the fix.']) {
    assert.strictEqual(ev.declaraRessalva(t), false, 'a causa contada nao e ressalva: ' + t);
    assert.strictEqual(ev.deveBloquearPorFalha(t + bloco), true, t);
  }
});

test('evidencia D656: o motivo ensina tambem a frase em ingles que libera', () => {
  const bloco = '\n```\n# fail 1\n```';
  assert.ok(/"still fails"/.test(ev.MOTIVO_FALHA) && /"did not run"/.test(ev.MOTIVO_FALHA), ev.MOTIVO_FALHA);
  assert.strictEqual(ev.deveBloquearPorFalha('Implemented, but the date test still fails.' + bloco), false);
  assert.strictEqual(ev.deveBloquearPorFalha('Implemented. I did not run the full suite.' + bloco), false);
  assert.ok(/"still fails"/.test(ev.motivoTesteVermelho('npm test')), 'o motivo do teste vermelho usa a mesma pergunta');
});

test('evidencia D634: MOTIVO_FALHA e ASCII (R5), diz o que fazer e traz a regra do teste instavel', () => {
  assert.ok(/^[\x20-\x7E\n]+$/.test(ev.MOTIVO_FALHA), 'MOTIVO_FALHA tem caractere fora de ASCII');
  assert.ok(/mostra falha/.test(ev.MOTIVO_FALHA));
  assert.ok(/instavel/.test(ev.MOTIVO_FALHA));
});
