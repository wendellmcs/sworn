'use strict';
// G4a, G4b e G4d (pedido 262, D928): o roteador diz o tipo da tarefa (a mensagem do dono e a edicao) e da, uma vez por
// sessao e por tipo, a linha com a peca do sworn; a skill local com "padrao" no nome nao toma o lugar da rota de tela;
// e o uso de cada skill do sworn vira contador, que a auditoria mostra. G4c: a rota de tela carrega a skill design, e o
// playbook (o manual) nao a cala mais. G4h (pedido 263): a rota de defeito; G4i: a rota de teste, cada uma cumprida pelo
// teste visto vermelho.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const comum = require('./lib/comum.js');
const roteador = require('../scripts/lib/roteador.js');
const ordens = require('../scripts/lib/ordens.js');

const RAIZ = path.join(__dirname, '..');
const ASCII = /^[\x0a\x20-\x7e]*$/;

test('roteador: os tipos e a skill de cada um', () => {
  assert.deepStrictEqual(roteador.TIPOS, ['tela', 'plano', 'etapa', 'diagnosticar', 'aaa', 'bug', 'teste']);
  for (const tipo of roteador.TIPOS) assert.ok(ordens.TIPOS_DE_ORDEM.indexOf(tipo) !== -1, tipo + ' nao e ordem');
  assert.deepStrictEqual(roteador.TIPOS.map(function (t) { return ordens.SKILL_DA_ORDEM[t]; }),
    ['design', 'review-plan', 'drift', 'diagnose', 'effort-high', undefined, undefined]);
  // cada skill nomeada existe no plugin; a rota sem skill (a de defeito e a de teste) e cumprida pelo teste visto vermelho
  for (const tipo of roteador.TIPOS) {
    if (!ordens.SKILL_DA_ORDEM[tipo]) {
      assert.ok(ordens.CUMPRE_O_VERMELHO.indexOf(tipo) !== -1, tipo + ' sem skill e sem o vermelho que a cumpre');
      continue;
    }
    assert.ok(fs.existsSync(path.join(RAIZ, 'skills', ordens.SKILL_DA_ORDEM[tipo], 'SKILL.md')), tipo);
  }
  // toda rota tem o seu rotulo na auditoria, em ASCII
  for (const tipo of roteador.TIPOS) assert.ok(typeof ordens.ROTULO[tipo] === 'string' && ASCII.test(ordens.ROTULO[tipo]), tipo);
});

test('roteador: doPedido acha o "por que deu errado" e o "siga o plano"', () => {
  for (const [frase, esperado] of [
    ['por que voce ignorou o plano?', ['diagnosticar']],
    ['Por que a sessão demorou tanto ontem?', ['diagnosticar']],
    ['pq o sworn ficou disparando o mesmo portao?', ['diagnosticar']],
    ['o que aconteceu nessa sessao', ['diagnosticar']],
    ['why did the agent fail at this?', ['diagnosticar']],
    ['what went wrong in that session', ['diagnosticar']],
    ['siga o plano em docs/x.md', ['plano']],
    ['Execute este plano, por favor', ['plano']],
    ['please implement the plan below', ['plano']],
    ['leia o PLAN.md e comece', ['plano']],
    ['por que voce nao seguiu o plano? siga o plano agora', ['diagnosticar', 'plano']],
    ['porque voce travou?', ['diagnosticar']],
    ['abra o plano.md e siga', ['plano']]
  ]) {
    assert.deepStrictEqual(roteador.doPedido(frase), esperado, frase);
  }
  // sem o que deu errado, e pergunta comum; e o "por que" vale na frase dele, nao no texto inteiro
  for (const frase of ['por que voce escolheu o node?', 'Voce rodou a suite. Por que o teste falhou?',
    'por que o teste falhou?', 'planeje a tela de login', 'leia a explanation.md',
    'o plano esta bom?', 'why is the sky blue', 'faca o commit', '', '   ',
    // "porque" e "pq" fora da pergunta sao "because"; o plano.md sem verbo de ler ou seguir nao e o pedido de seguir
    'o teste falhou porque o hook travou, corrija o teste', 'falhou pq o gancho travou',
    'crie um plano.md para a migracao', 'nao mexa no plan.md']) {
    assert.deepStrictEqual(roteador.doPedido(frase), [], frase);
  }
  for (const torto of [null, undefined, 5, {}, ['por que voce errou']]) assert.deepStrictEqual(roteador.doPedido(torto), []);
});

// O dono escreve "n" por "nao" ("pq vc n seguiu?"): o "n" sozinho conta como o "nao", so antes dos mesmos verbos.
test('roteador: doPedido le o "n" abreviado como o "nao" do que deu errado', () => {
  for (const frase of ['pq vc n seguiu o plano?', 'por que vc n leu o handoff', 'por que o claude n rodou os testes',
    'por que a sessao n funcionou']) {
    assert.deepStrictEqual(roteador.doPedido(frase), ['diagnosticar'], frase);
  }
  // o presente e pedido de fazer, nao de diagnosticar; e o "n" fora dos verbos e so uma letra
  for (const frase of ['pq vc n faz o push?', 'por que vc escolheu n = 5?', 'por que voce n?']) {
    assert.deepStrictEqual(roteador.doPedido(frase), [], frase);
  }
});

// G4h (pedido 263): a rota de defeito. A frase que fala de erro, bug ou quebra, ou a pilha de erro colada, traz a ordem
// de reproduzir com teste vermelho antes do conserto; a frase do "por que voce falhou" segue so da rota diagnosticar.
test('roteador G4h: doPedido acha o defeito pela palavra e pela pilha colada, fora do "por que deu errado"', () => {
  for (const [frase, esperado] of [
    ['o login quebrou', ['bug']],
    ['deu erro no build', ['bug']],
    ['Tem um bug no export do relatório', ['bug']],
    ['o botão não funciona no celular', ['bug']],
    ['o filtro nao esta funcionando', ['bug']],
    ['o upload n funciona', ['bug']],
    ['os testes quebraram depois do merge', ['bug']],
    ['o export parou de funcionar', ['bug']],
    ['o app crashou na abertura', ['bug']],
    ['the build is broken', ['bug']],
    ['the upload is not working', ['bug']],
    ['it doesn\'t work on Windows', ['bug']],
    ['it doesn’t work on Windows', ['bug']],
    ['fix the error on the settings page', ['bug']],
    // cada forma de pilha sozinha, sem palavra de defeito fora dela
    ['TypeError: x is not a function\n    at f (src/a.js:1:2)', ['bug']],
    ['Uncaught ReferenceError: foo is not defined', ['bug']],
    ['olha isso:\n\tat com.exemplo.Fila.tirar(Fila.java:42)', ['bug']],
    ['    at Object.<anonymous> (C:\\proj\\a.js:3:9)', ['bug']],
    ['Traceback (most recent call last):', ['bug']],
    ['  File "app.py", line 3, in <module>', ['bug']],
    ['panic: assignment to entry in nil map', ['bug']],
    ['goroutine 1 [running]:\nmain.main()', ['bug']],
    // o "Exception: " no comeco da linha e a saida de erro colada, sem o nome do erro na frente
    ['rodei e saiu isto:\nException: valor invalido no campo idade', ['bug']],
    // a frase do "por que voce falhou" e da rota diagnosticar; a outra frase, com o defeito, traz a de defeito
    ['por que voce nao seguiu o plano? o build quebrou', ['diagnosticar', 'bug']],
    ['o build quebrou. siga o plano', ['bug', 'plano']],
    ['por que voce quebrou o teste?', ['diagnosticar']],
    // o "no" que nega e o ingles ("no errors", "no bugs"); o "no erro", o "no bug" e o "no crash" sao o "em o" do portugues
    ['olha o que aparece no erro abaixo', ['bug']],
    ['o problema esta no bug do login', ['bug']],
    ['Corrija o travamento no crash do app', ['bug']],
    ['apareceram dois bugs no relatorio', ['bug']],
    // o "error: " no meio da frase e prosa, nao pilha: a frase do "por que" segue so da diagnosticar
    ['por que voce ignorou o campo error: string?', ['diagnosticar']]
  ]) {
    assert.deepStrictEqual(roteador.doPedido(frase), esperado, frase);
  }
  // o "sem erro" e o "nenhum erro" dizem que deu certo; "quebra de linha", "debug" e o "at" de uma frase nao sao defeito
  for (const frase of ['passou sem erro', 'rodou sem erros, pode commitar', 'nenhum erro no log', 'nao deu erro',
    'no errors found', 'it shipped with no bugs', 'adicione uma quebra de linha no titulo', 'rode o debug do servidor', 'at least 3:1',
    // o espaco dobrado, o "nunca", o "nao vi" e o "erro nenhum" tambem dizem que deu certo
    'passou sem  erro', 'isso nunca deu erro, so quero renomear', 'nao vi erro nenhum', 'nao vi erro no log', 'o log nao mostra erro algum',
    // o "exception: " no meio da frase e o nome de um campo; a linha "at" sem ponto nem barra e uma hora, nao um caminho
    'adicione o campo exception: string ao tipo Resposta', 'marque a reuniao\nat 10:30']) {
    assert.deepStrictEqual(roteador.doPedido(frase), [], frase);
  }
});

// O roteador so le os primeiros 20 mil caracteres do pedido (o TETO_DO_PEDIDO): o "erro" que termina no caractere 20 mil
// conta, o que comeca depois dele nao. Se o teto mudar, este teste reprova, e o de tempo abaixo tem de mudar junto.
test('roteador G4h: doPedido corta o pedido nos 20 mil caracteres', () => {
  assert.deepStrictEqual(roteador.doPedido(' '.repeat(19995) + ' erro'), ['bug'], 'o erro dentro do teto');
  assert.deepStrictEqual(roteador.doPedido(' '.repeat(20000) + 'erro'), [], 'o erro depois do teto');
});

// G4i (pedido 263): a rota de teste. O pedido de escrever testes (o verbo de escrever, criar ou adicionar, ate um
// artigo ou adjetivo, e "teste") traz a ordem do teste vermelho primeiro e da mutacao; rodar, corrigir ou contar que
// escreveu nao e o pedido, e a negacao na frente cala, tambem com ate 3 palavras de ligacao entre ela e o verbo ("nao
// quero que voce escreva"); a 4a ja nao cala.
test('roteador G4i: doPedido acha o pedido de escrever testes, nao o de rodar nem o negado', () => {
  for (const [frase, esperado] of [
    ['escreva os testes do parser', ['teste']],
    ['Crie testes para o login', ['teste']],
    ['adicione um teste para o export', ['teste']],
    ['acrescente testes novos no relatório', ['teste']],
    ['escreva mais testes', ['teste']],
    ['gere os testes unitários', ['teste']],
    ['write the tests for the parser', ['teste']],
    ['add unit tests for the cache', ['teste']],
    ['please create some new tests', ['teste']],
    ['write a test', ['teste']],
    // o defeito e o pedido de teste na mesma mensagem: as duas rotas, na ordem
    ['o login quebrou, escreva um teste que reproduza', ['bug', 'teste']],
    ['escreva os testes e siga o plano', ['teste', 'plano']],
    // a negacao de uma frase nao cala o pedido da outra
    ['Nao. Escreva os testes primeiro', ['teste']],
    // palavra que nao e de ligacao entre a negacao e o verbo, ou a 4a de ligacao: a negacao nao alcanca o verbo
    ['nunca vi isso escreva os testes', ['teste']],
    ["don't you ever want to add tests?", ['teste']],
    // a negacao logo depois do "why"/"por que" (com o "voce" no meio ou nao) e sugestao, nao recusa
    ["why don't you add unit tests for the parser?", ['teste']],
    ['por que você não cria os testes?', ['teste']],
    ['por que nao escreve testes pro login?', ['teste']],
    ['why not add tests?', ['teste']]
  ]) {
    assert.deepStrictEqual(roteador.doPedido(frase), esperado, frase);
  }
  for (const frase of ['rode os testes', 'corrija o teste', 'nao escreva testes agora', 'sem escrever testes, so o codigo',
    'não precisa escrever testes', 'nunca crie testes aqui', "don't write tests", 'don’t add tests', 'do not add tests',
    'os testes passaram', 'escrevi os testes', 'teste o login', 'crie o arquivo teste.js', 'descreva os testes',
    'adicione a coluna testada', 'write the testing guide', 'nao quero que voce escreva testes', "please don't ever add tests",
    "i don't want you to add tests", 'nao precisa de escrever testes',
    // o "why"/"por que" separado da negacao por pontuacao ou outra palavra nao a desfaz
    "why? don't add tests", 'nao sei por que, mas nao escreva testes']) {
    assert.deepStrictEqual(roteador.doPedido(frase), [], frase);
  }
});

// A pilha se procura no texto inteiro (ate o teto, 20 mil): a colagem longa de linhas em branco, ou uma linha "at" com um
// token longo sem o ":linha", nao pode custar o quadrado do tamanho. Os 20 mil espacos sao uma frase so, e cada posicao
// dela passa pela negacao do DEFEITO (o "sem +erro"). O tempo e o menor de 3 voltas, depois de uma chamada de
// aquecimento: o linear fica abaixo de 1 ms e o quadrado passa de 200 ms, e a pausa da maquina carregada cai numa volta so.
// G4i: o pedido de testes tambem: o verbo seguido de artigos ou espacos sem o "teste", e a negacao com as palavras de
// ligacao, que tem teto de 3 para cada posicao nao rever o texto inteiro para tras.
test('roteador G4h e G4i: doPedido le 20 mil linhas em branco, uma linha "at" longa ou o verbo de testes em tempo linear', () => {
  const textos = ['\n', ' \n', '\t\n', ' '].map(function (branco) {
    return [JSON.stringify(branco), branco.repeat(Math.floor(20000 / branco.length) - 1) + 'x'];
  });
  textos.push(['at + pontos', 'at ' + '.'.repeat(19997)], ['at + barras', 'at ' + '/'.repeat(19997)]);
  // G4i: o verbo seguido de 10 mil artigos, ou de 20 mil espacos, sem o "teste" no fim
  textos.push(['escreva + artigos', 'escreva' + ' o'.repeat(9996)], ['add + espacos', 'add' + ' '.repeat(19996) + 'x'],
    ['nao + que', 'nao' + ' que'.repeat(4999)]);
  roteador.doPedido('aquecimento: at x.js:1\nsem erro');
  for (const [nome, texto] of textos) {
    let menor = Infinity;
    for (let volta = 0; volta < 3; volta++) {
      const inicio = process.hrtime.bigint();
      assert.deepStrictEqual(roteador.doPedido(texto), [], nome);
      menor = Math.min(menor, Number(process.hrtime.bigint() - inicio) / 1e6);
    }
    assert.ok(menor < 100, nome + ': ' + menor.toFixed(0) + ' ms');
  }
});

test('roteador G4h: a linha de defeito pede o vermelho antes do conserto e a causa raiz; o teste vermelho a cumpre', () => {
  const s = {};
  const r = roteador.dar(s, ['bug'], {});
  assert.strictEqual(r.textos.length, 1);
  const t = r.textos[0];
  for (const pedaco of ['teste que falha', 'antes do conserto', 'o erro inteiro', 'o que mudou', 'cada fronteira',
    'uma hipotese por vez', 'Se o conserto falhar, desfaca-o']) {
    assert.ok(t.indexOf(pedaco) !== -1, 'falta ' + pedaco + ' em: ' + t);
  }
  assert.ok(ASCII.test(t) && t.indexOf('undefined') === -1, t);
  assert.deepStrictEqual(r.pendentes, ['bug']);
  assert.strictEqual(s.contadores.ordem_bug_dada, 1);
  // nenhuma skill cumpre a de defeito, nem cala a rota dela
  for (const nome of ['sworn:playbook', 'sworn:diagnose', 'padrao-aaa', 'sworn:review', 'bug']) {
    assert.strictEqual(roteador.jaEntrou({}, nome).indexOf('bug'), -1, nome);
    assert.deepStrictEqual(ordens.marcarCumprida({ ordensPendentes: ['bug'] }, nome), ['bug'], nome);
  }
  // o teste visto vermelho cumpre a de defeito, uma vez, e nenhuma outra
  const p = { ordensPendentes: ['bug', 'tela', 'revisar'] };
  assert.deepStrictEqual(ordens.vermelhoVisto(p), ['tela', 'revisar']);
  assert.deepStrictEqual(p.ordensPendentes, ['tela', 'revisar']);
  assert.strictEqual(p.contadores.ordem_bug_cumprida, 1);
  assert.deepStrictEqual(ordens.vermelhoVisto(p), ['tela', 'revisar']);
  assert.strictEqual(p.contadores.ordem_bug_cumprida, 1);
  assert.deepStrictEqual(ordens.vermelhoVisto(null), []);
  // a lista torta ou vazia vira vazia, sem contar cumprida
  for (const torta of [{ ordensPendentes: 7 }, { ordensPendentes: [] }]) {
    assert.deepStrictEqual(ordens.vermelhoVisto(torta), []);
    assert.strictEqual(torta.contadores, undefined);
  }
  // a auditoria conta a rota com o rotulo dela, em dadas/cumpridas/recusadas ("-": recusa que o sworn nao ve)
  assert.ok(ordens.linhasDasOrdens(null, { ordem_bug_dada: 2, ordem_bug_cumprida: 1 }, 7)
    .join('\n').indexOf('reproduzir o defeito 2/1/-') !== -1);
});

test('roteador G4i: a linha de teste pede o vermelho primeiro e a mutacao, e aponta o playbook; o vermelho a cumpre', () => {
  const s = {};
  const r = roteador.dar(s, ['teste'], { alvo: 'test/a.test.js' });
  assert.strictEqual(r.textos.length, 1);
  const t = r.textos[0];
  for (const pedaco of ['"test/a.test.js" e um arquivo de teste', 'falha primeiro', 'vermelho pelo motivo certo',
    'a mutacao', 'desfaca a quebra', 'nao todas', 'secao 2 de references/04-verificacao.md', 'skill playbook']) {
    assert.ok(t.indexOf(pedaco) !== -1, 'falta ' + pedaco + ' em: ' + t);
  }
  assert.ok(ASCII.test(t) && t.indexOf('undefined') === -1, t);
  assert.deepStrictEqual(r.dadas, ['teste']);
  assert.deepStrictEqual(r.pendentes, ['teste']);
  assert.strictEqual(s.contadores.ordem_teste_dada, 1);
  // sem o arquivo (o pedido "escreva os testes"), a linha diz o pedido
  const semAlvo = roteador.dar({}, ['teste'], {}).textos[0];
  assert.ok(semAlvo.indexOf('o pedido e escrever testes') !== -1 && semAlvo.indexOf('undefined') === -1, semAlvo);
  // uma vez por sessao
  s.rotasDadas = r.dadas;
  assert.deepStrictEqual(roteador.dar(s, ['teste'], { alvo: 'test/b.test.js' }).textos, []);
  // nenhuma skill a cumpre nem a cala (o playbook, que ela aponta, tambem nao: ele entra antes de qualquer teste)
  for (const nome of ['sworn:playbook', 'playbook', 'padrao-aaa', 'sworn:review', 'teste']) {
    assert.strictEqual(roteador.jaEntrou({}, nome).indexOf('teste'), -1, nome);
    assert.deepStrictEqual(ordens.marcarCumprida({ ordensPendentes: ['teste'] }, nome), ['teste'], nome);
  }
  // o teste visto vermelho cumpre a de teste e a de defeito juntas, e nenhuma outra
  const p = { ordensPendentes: ['teste', 'tela', 'bug'] };
  assert.deepStrictEqual(ordens.vermelhoVisto(p), ['tela']);
  assert.strictEqual(p.contadores.ordem_teste_cumprida, 1);
  assert.strictEqual(p.contadores.ordem_bug_cumprida, 1);
  assert.ok(ordens.linhasDasOrdens(null, { ordem_teste_dada: 2, ordem_teste_cumprida: 1 }, 7)
    .join('\n').indexOf('teste vermelho primeiro 2/1/-') !== -1);
});

test('roteador: daEdicao acha tela, teste, plano, etapa e AAA pelo arquivo e pela edicao', () => {
  const W = function (texto) { return { content: texto }; };
  const E = function (velho, novo) { return { old_string: velho, new_string: novo }; };
  const aaa = { marchas: { aaa: ['**/auth/**'], rapida: ['docs/**'] } };
  for (const [alvo, entrada, projeto, esperado] of [
    ['src/app.css', W('a{}'), null, ['tela']],
    ['web/Botao.tsx', E('a', 'b'), null, ['tela']],
    ['index.html', W('<p>'), null, ['tela']],
    ['src/App.vue', W('x'), null, ['tela']],
    ['tema/cores.json', W('{}'), { design: { caminhosDeEstilo: ['tema/**'] } }, ['tela']],
    ['src/a.js', W('x'), null, []],
    ['.context/plans/2026-11-25-x.md', W('# plano'), null, ['plano']],
    ['docs/PLAN.md', W('# p'), null, ['plano']],
    ['docs/plano-migracao.md', W('# p'), null, ['plano']],
    ['docs/feature-plan.md', W('# p'), null, ['plano']],
    ['docs/planning.md', W('# p'), null, []],
    ['docs/explanation.md', W('# p'), null, []],
    ['docs/PLAN.md', E('- [ ] a', '- [x] a'), null, ['etapa']],
    ['docs/PLAN.md', E('1. [ ] a', '1. [X] a (feito)'), null, ['etapa']],
    ['plans/fase.md', E('| **P2** | a |', '| **P2** [FEITO] | a |'), null, ['etapa']],
    ['docs/PLAN.md', E('- [ ] a', '- [ ] a\n- [ ] b'), null, []],
    ['docs/PLAN.md', E('- [x] a', '- [ ] a'), null, []],
    ['docs/notas.md', E('- [ ] a', '- [x] a'), null, []],
    ['src/auth/login.js', E('a', 'b'), aaa, ['aaa']],
    ['src/auth/Login.tsx', W('x'), aaa, ['tela', 'aaa']],
    ['src/auth/login.js', E('a', 'b'), null, []],
    ['src\\auth\\Login.tsx', W('x'), aaa, ['tela', 'aaa']],
    // G4i: o arquivo com nome de teste, de qualquer linguagem; o teste de componente e teste, nao tela
    ['test/a.test.js', W('x'), null, ['teste']],
    ['web/Botao.test.tsx', E('a', 'b'), null, ['teste']],
    ['web/Botao.spec.jsx', W('x'), null, ['teste']],
    ['tests/test_api.py', W('x'), null, ['teste']],
    ['pkg/fila_test.go', W('x'), null, ['teste']],
    ['spec/fila_spec.rb', W('x'), null, ['teste']],
    ['src\\util.spec.ts', W('x'), null, ['teste']],
    ['src/auth/login.test.js', E('a', 'b'), aaa, ['teste', 'aaa']],
    ['src/testes.js', W('x'), null, []],
    ['test/fixtures/pagina.html', W('<p>'), null, ['tela']],
    ['docs/test-plan.md', W('# p'), null, ['plano']]
  ]) {
    assert.deepStrictEqual(roteador.daEdicao(alvo, entrada, projeto), esperado, alvo + ' ' + JSON.stringify(entrada));
  }
  // entrada torta nunca lanca
  assert.deepStrictEqual(roteador.daEdicao(null, null, null), []);
  assert.deepStrictEqual(roteador.daEdicao('', {}, null), []);
  assert.deepStrictEqual(roteador.daEdicao('a.css', 'x', 5), ['tela']);
  assert.deepStrictEqual(roteador.daEdicao('docs/PLAN.md', { old_string: 5, new_string: null }, null), []);
  assert.deepStrictEqual(roteador.daEdicao('src/a.js', {}, { marchas: 'lixo' }), []);
  // MultiEdit: a caixa marcada em qualquer troca conta
  assert.deepStrictEqual(roteador.daEdicao('docs/PLAN.md', { edits: [E('x', 'y'), E('- [ ] b', '- [x] b'), 'lixo'] }, null),
    ['etapa']);
  assert.deepStrictEqual(roteador.daEdicao('docs/PLAN.md', { edits: [E('- [x] b', '- [ ] b'), E('- [ ] c', '- [x] c')] },
    null), []);
});

test('roteador: dar entrega a linha uma vez por sessao e por tipo, conta "dada" e fala ASCII', () => {
  const s = {};
  const r = roteador.dar(s, ['tela'], { alvo: 'web/app.css', temDesign: true });
  assert.strictEqual(r.textos.length, 1);
  const t = r.textos[0];
  for (const pedaco of ['web/app.css', 'sworn:design', 'pressionado', 'pior caso', 'prefers-reduced-motion', '24 x 24 px',
    '.claude/sworn/design.json', '--tela-depois', '"padrao"']) {
    assert.ok(t.indexOf(pedaco) !== -1, 'falta ' + pedaco + ' em: ' + t);
  }
  // a rota de tela nao manda mais carregar o manual: o playbook entra pela ordem do manual, nao por esta
  assert.strictEqual(t.indexOf('sworn:playbook'), -1, t);
  assert.ok(ASCII.test(t), t);
  assert.deepStrictEqual(r.dadas, ['tela']);
  assert.deepStrictEqual(r.pendentes, ['tela']);
  assert.strictEqual(s.contadores.ordem_tela_dada, 1);
  // a segunda vez na mesma sessao cala e nao conta
  s.rotasDadas = r.dadas;
  s.ordensPendentes = r.pendentes;
  const r2 = roteador.dar(s, ['tela'], { alvo: 'web/b.css', temDesign: true });
  assert.deepStrictEqual(r2.textos, []);
  assert.strictEqual(s.contadores.ordem_tela_dada, 1);
  // sem design.json, a linha nao o cita
  assert.strictEqual(roteador.dar({}, ['tela'], { alvo: 'a.css' }).textos[0].indexOf('design.json'), -1);
  // cada tipo nomeia a sua skill, em ASCII, com o arquivo quando ha
  for (const [tipo, skill] of [['plano', 'sworn:review-plan'], ['etapa', 'sworn:drift'],
    ['diagnosticar', 'sworn:diagnose'], ['aaa', 'sworn:effort-high']]) {
    const x = roteador.dar({}, [tipo], { alvo: 'docs/PLAN.md' }).textos;
    assert.strictEqual(x.length, 1, tipo);
    assert.ok(x[0].indexOf(skill) !== -1 && ASCII.test(x[0]), tipo + ': ' + x[0]);
    const semAlvo = roteador.dar({}, [tipo], {}).textos[0];
    assert.ok(semAlvo.indexOf(skill) !== -1 && semAlvo.indexOf('undefined') === -1, tipo + ' sem alvo: ' + semAlvo);
  }
  // o arquivo com caractere fora do ASCII sai em ASCII
  assert.ok(ASCII.test(roteador.dar({}, ['tela'], { alvo: 'web/botão.css' }).textos[0]));
  // o caminho comprido sai cortado em 200 caracteres
  const comprido = 'web/' + 'a'.repeat(400) + '.css';
  const cortado = roteador.dar({}, ['tela'], { alvo: comprido }).textos[0];
  assert.ok(cortado.indexOf('"' + comprido.slice(0, 200) + '..."') !== -1 && cortado.indexOf(comprido) === -1, cortado);
  // a aspa do caminho vira apostrofo: so a do texto abre e fecha o nome
  const aspa = roteador.dar({}, ['tela'], { alvo: 'web/a"b.css' }).textos[0];
  assert.ok(aspa.indexOf('"web/a\'b.css"') !== -1 && aspa.indexOf('a"b') === -1, aspa);
  // dois tipos de uma vez, na ordem dada; tipo repetido ou desconhecido nao entra
  const dois = roteador.dar({}, ['tela', 'aaa', 'tela', 'xpto'], { alvo: 'src/auth/Login.tsx' });
  assert.deepStrictEqual(dois.dadas, ['tela', 'aaa']);
  assert.strictEqual(dois.textos.length, 2);
  // estado torto nunca lanca
  assert.deepStrictEqual(roteador.dar(null, ['tela'], {}), { dadas: [], pendentes: [], textos: [] });
  const torto = { rotasDadas: 'lixo', ordensPendentes: 7 };
  assert.deepStrictEqual(roteador.dar(torto, ['plano'], null).dadas, ['plano']);
  assert.deepStrictEqual(roteador.dar({ rotasDadas: [null, 3, 'plano'] }, ['plano'], {}).textos, []);
  // a lista gravada torta sai limpa: sem repetido e sem tipo desconhecido
  assert.deepStrictEqual(roteador.dar({ rotasDadas: ['tela', 'tela', 'xpto', null] }, ['aaa'], {}).dadas, ['tela', 'aaa']);
  assert.deepStrictEqual(roteador.dar({}, 'tela', {}).textos, []);
});

test('roteador G4b: a skill do sworn que ja entrou cala a rota dela; a local com "padrao" no nome e o playbook, nao', () => {
  for (const [nome, tipo] of [['sworn:design', 'tela'], ['design', 'tela'], ['sworn:review-plan', 'plano'],
    ['sworn:drift', 'etapa'], ['sworn:diagnose', 'diagnosticar'], ['sworn:effort-high', 'aaa']]) {
    const s = {};
    s.rotasDadas = roteador.jaEntrou(s, nome);
    assert.deepStrictEqual(s.rotasDadas, [tipo], nome);
    assert.deepStrictEqual(roteador.dar(s, [tipo], {}).textos, [], nome);
  }
  for (const manual of ['padrao-aaa', 'sworn:playbook', 'playbook']) {
    const s = {};
    s.rotasDadas = roteador.jaEntrou(s, manual);
    assert.deepStrictEqual(s.rotasDadas, [], manual);
    assert.strictEqual(roteador.dar(s, ['tela'], { alvo: 'a.css' }).textos.length, 1, manual);
  }
  // o manual (o do projeto ou o playbook) cumpre a ordem do manual, nunca a da tela; a design cumpre a da tela
  const p = { ordensPendentes: ['manual', 'tela'] };
  assert.deepStrictEqual(ordens.marcarCumprida(p, 'padrao-aaa'), ['tela']);
  assert.deepStrictEqual(ordens.marcarCumprida(p, 'sworn:playbook'), ['tela']);
  assert.strictEqual((p.contadores || {}).ordem_tela_cumprida, undefined);
  assert.deepStrictEqual(ordens.marcarCumprida(p, 'sworn:design'), []);
  assert.strictEqual(p.contadores.ordem_tela_cumprida, 1);
  assert.deepStrictEqual(ordens.marcarCumprida({ ordensPendentes: ['manual', 'tela'] }, 'sworn:playbook'), ['tela']);
  // a skill de cada rota cumpre a ordem dela
  const q = { ordensPendentes: ['plano', 'etapa', 'diagnosticar', 'aaa'] };
  for (const nome of ['sworn:review-plan', 'sworn:drift', 'sworn:diagnose', 'sworn:effort-high']) ordens.marcarCumprida(q, nome);
  assert.deepStrictEqual(q.ordensPendentes, []);
  // nome torto devolve a lista que ja havia
  assert.deepStrictEqual(roteador.jaEntrou({ rotasDadas: ['plano'] }, null), ['plano']);
  assert.deepStrictEqual(roteador.jaEntrou(null, 'sworn:playbook'), []);
});

test('ordens G4d: o uso de cada skill do sworn e do manual do projeto vira contador', () => {
  const s = {};
  assert.strictEqual(ordens.marcarUso(s, 'sworn:review').uso_skill_review, 1);
  ordens.marcarUso(s, 'sworn:review');
  ordens.marcarUso(s, 'padrao-aaa');
  ordens.marcarUso(s, 'sworn:playbook');
  assert.deepStrictEqual(s.contadores, { uso_skill_review: 2, uso_skill_manual_do_projeto: 1, uso_skill_playbook: 1 });
  // o que nao e skill do sworn nem manual do projeto nao conta
  // (o "playbook" sem o prefixo cumpre a ordem do manual, mas nao e o uso do manual do projeto)
  // (a skill de outro plugin com "padrao" no nome tambem nao: o manual do projeto vem sem prefixo)
  for (const nome of ['sworn:nao-existe', 'outro:review', 'review', 'playbook', 'sworn:', 'sworn:../x', 'outro:padrao-x',
    null, 7]) {
    const t = {};
    assert.strictEqual(ordens.marcarUso(t, nome), null, String(nome));
    assert.strictEqual(t.contadores, undefined, String(nome));
  }
  assert.strictEqual(ordens.marcarUso(null, 'sworn:review'), null);
});

test('ordens G4d: as linhas do uso na auditoria - as chamadas, as nunca chamadas e o manual do projeto', () => {
  const skills = ordens.skillsDoPlugin();
  assert.ok(skills.length >= 15 && skills.indexOf('review') !== -1 && skills.indexOf('playbook') !== -1, skills.join());
  const antes = { uso_skill_review: 1 };
  const agora = { uso_skill_review: 4, uso_skill_handoff: 5, uso_skill_manual_do_projeto: 9, ordem_revisar_dada: 3 };
  const l = ordens.linhasDoUso(antes, agora, 7);
  assert.strictEqual(l[0], '- skills do sworn que o Claude chamou nos ultimos 7 dias: handoff 5, review 3');
  const nunca = skills.filter(function (n) { return n !== 'review' && n !== 'handoff'; });
  assert.strictEqual(l[1], '  nunca chamadas: ' + nunca.join(', '));
  assert.ok(/skill do projeto com "padrao" no nome foi chamada 9 vezes; o sworn:playbook, 0 vezes\. A do projeto cumpre so a ordem do manual: na edicao de tela, o sworn ainda pede o sworn:design\.$/.test(l[2]), l[2]);
  assert.strictEqual(l[l.length - 1], '  Skill do sworn nunca chamada e assunto do sworn, nao deste projeto: ou ele nao a ' +
    'ofereceu na hora certa, ou o projeto nao precisou dela. Diga isso ao dono numa linha, sem pedir decisao.');
  l.forEach(function (x) { assert.ok(ASCII.test(x), x); });
  // toda skill chamada: sem a lista das nunca chamadas e sem o pedido de relatar
  const todas = {};
  skills.forEach(function (n) { todas['uso_skill_' + n] = 1; });
  const cheia = ordens.linhasDoUso(null, todas, 7);
  assert.strictEqual(cheia.length, 1, cheia.join('\n'));
  assert.ok(cheia.every(function (x) { return x.indexOf('nunca chamada') === -1; }), cheia.join('\n'));
  // sem nenhum contador de uso (nada medido ainda): silencio
  assert.deepStrictEqual(ordens.linhasDoUso(null, { ordem_revisar_dada: 3 }, 7), []);
  assert.deepStrictEqual(ordens.linhasDoUso(null, null, null), []);
  // sem o manual do projeto, sem a linha dele
  assert.ok(ordens.linhasDoUso(null, { uso_skill_review: 1 }, null).every(function (x) { return x.indexOf('padrao') === -1; }));
  assert.strictEqual(ordens.linhasDoUso(null, { uso_skill_review: 1 }, null)[0],
    '- skills do sworn que o Claude chamou desde o comeco: review 1');
  // os totais do projeto trazem os contadores de uso junto com os de ordem
  const dir = comum.temporaria('sworn-uso-');
  try {
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'contadores.json'),
      JSON.stringify({ uso_skill_review: 2, uso_skill_x: 'lixo', ordem_tela_dada: 1, fecho_sem_evidencia: 4 }), 'utf8');
    assert.deepStrictEqual(ordens.totaisDasOrdens(dir), { uso_skill_review: 2, ordem_tela_dada: 1 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- os ganchos: abrir-turno (a mensagem), portao-escopo (a edicao) e marcar-trabalho (a skill que entrou) ----

function sessoesEm(dir) {
  const sessoes = path.join(dir, '_sessoes');
  fs.mkdirSync(path.join(sessoes, 'sworn'), { recursive: true });
  return sessoes;
}
function lerEstado(dir, id) {
  return JSON.parse(fs.readFileSync(path.join(dir, '_sessoes', 'sworn', id + '.json'), 'utf8'));
}
/** O estado da sessao, ou {} quando o gancho nao gravou nenhum; o arquivo torto lanca e reprova o teste. */
function estadoSeHouver(dir, id) {
  return fs.existsSync(path.join(dir, '_sessoes', 'sworn', id + '.json')) ? lerEstado(dir, id) : {};
}
function processo(dir, script, entrada) {
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', script)], {
    cwd: dir, encoding: 'utf8', input: JSON.stringify(entrada), timeout: comum.PRAZO,
    env: Object.assign({}, process.env, { SWORN_TMP: sessoesEm(dir) })
  });
  assert.strictEqual(r.status, 0, script + ': ' + r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}
function contexto(saida) {
  return saida && saida.hookSpecificOutput ? saida.hookSpecificOutput.additionalContext || '' : '';
}
function editar(dir, id, rel, extra) {
  const alvo = path.join(dir, rel);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  const r = comum.ganchoComoProcesso('scripts/portao-escopo.js', Object.assign({ session_id: id, cwd: dir,
    hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: alvo, content: 'a{}' } }, extra || {}),
    { env: Object.assign({}, process.env, { SWORN_TMP: sessoesEm(dir) }) });
  // o gancho que quebra (ou falha e libera) sai sem o contexto: sem este status, o "sem rota" passaria por acaso
  assert.strictEqual(r.status, 0, rel + ': ' + r.stderr);
  return r;
}
function skill(dir, id, nome) {
  return processo(dir, 'marcar-trabalho.js', { session_id: id, cwd: dir, hook_event_name: 'PostToolUse',
    tool_name: 'Skill', tool_input: { skill: nome } });
}

test('rota no abrir-turno: o "por que deu errado" e o "siga o plano" chegam uma vez por sessao', () => {
  const dir = comum.temporaria('sworn-rota-turno-');
  try {
    const turno = function (id, prompt) {
      return processo(dir, 'abrir-turno.js', { session_id: id, cwd: dir, hook_event_name: 'UserPromptSubmit', prompt: prompt });
    };
    assert.ok(contexto(turno('d1', 'por que voce ignorou o plano?')).indexOf('sworn:diagnose') !== -1);
    assert.deepStrictEqual(lerEstado(dir, 'd1').rotasDadas, ['diagnosticar']);
    assert.strictEqual(lerEstado(dir, 'd1').contadores.ordem_diagnosticar_dada, 1);
    assert.strictEqual(contexto(turno('d1', 'por que voce ignorou o plano de novo?')).indexOf('sworn:diagnose'), -1);
    assert.ok(contexto(turno('d1', 'siga o plano docs/PLAN.md')).indexOf('sworn:review-plan') !== -1);
    assert.strictEqual(contexto(turno('d2', 'faca o commit')).indexOf('sworn:'), -1);
    // o subagente nao recebe rota nem gasta a do principal
    const sub = processo(dir, 'abrir-turno.js', { session_id: 'd3', cwd: dir, agent_id: 'a1',
      hook_event_name: 'UserPromptSubmit', prompt: 'por que voce ignorou o plano?' });
    assert.strictEqual(contexto(sub).indexOf('sworn:diagnose'), -1);
    assert.strictEqual(lerEstado(dir, 'd3').rotasDadas, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('rota G4h no abrir-turno: o "quebrou" traz a de defeito; o teste visto vermelho a cumpre, o verde nao', () => {
  const dir = comum.temporaria('sworn-rota-bug-');
  try {
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'),
      JSON.stringify({ versaoConfig: 1, marchaPadrao: 'padrao' }), 'utf8');
    fs.writeFileSync(path.join(dir, 'test', 'a.test.js'), '', 'utf8');
    const turno = function (id, prompt) {
      return processo(dir, 'abrir-turno.js', { session_id: id, cwd: dir, hook_event_name: 'UserPromptSubmit', prompt: prompt });
    };
    const rodou = function (id, evento, extra) {
      return processo(dir, 'recibo-da-prova.js', Object.assign({ session_id: id, cwd: dir, hook_event_name: evento,
        tool_name: 'Bash', tool_input: { command: 'node --test test/a.test.js' } }, extra));
    };
    const ctx = contexto(turno('b1', 'o login quebrou depois do merge'));
    assert.ok(ctx.indexOf('teste que falha') !== -1 && ctx.indexOf('uma hipotese por vez') !== -1, ctx);
    assert.deepStrictEqual(lerEstado(dir, 'b1').ordensPendentes, ['bug']);
    // o verde nao cumpre: o defeito nao foi reproduzido
    rodou('b1', 'PostToolUse', { tool_response: { stdout: 'ℹ tests 1\nℹ pass 1\nℹ fail 0', stderr: '', interrupted: false } });
    assert.deepStrictEqual(lerEstado(dir, 'b1').ordensPendentes, ['bug']);
    // a falha interrompida tambem nao: nao e vermelho
    rodou('b1', 'PostToolUseFailure', { error: 'Exit code 130', is_interrupt: true });
    assert.deepStrictEqual(lerEstado(dir, 'b1').ordensPendentes, ['bug']);
    // o vermelho, sim, uma vez
    rodou('b1', 'PostToolUseFailure', { error: 'Exit code 1\nfail 1', is_interrupt: false });
    assert.deepStrictEqual(lerEstado(dir, 'b1').ordensPendentes, []);
    assert.strictEqual(lerEstado(dir, 'b1').contadores.ordem_bug_cumprida, 1);
    // a rota nao volta na mesma sessao
    assert.strictEqual(contexto(turno('b1', 'o export quebrou tambem')).indexOf('teste que falha'), -1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('rota G4i: a 1a edicao de teste da sessao e o "escreva os testes" trazem a de teste, uma vez; o vermelho a cumpre', () => {
  const dir = comum.temporaria('sworn-rota-teste-');
  try {
    const r = editar(dir, 't1', 'test/fila.test.js');
    assert.ok(contexto(r.json).indexOf('"test/fila.test.js" e um arquivo de teste') !== -1, JSON.stringify(r.json));
    assert.strictEqual((r.json.hookSpecificOutput || {}).permissionDecision, undefined, JSON.stringify(r.json));
    assert.deepStrictEqual(lerEstado(dir, 't1').rotasDadas, ['teste']);
    assert.deepStrictEqual(lerEstado(dir, 't1').ordensPendentes, ['teste']);
    // a 2a edicao de teste e o pedido de testes na mesma sessao calam
    assert.strictEqual(contexto(editar(dir, 't1', 'test/pilha.test.js').json), '');
    const turno = function (id, prompt) {
      return processo(dir, 'abrir-turno.js', { session_id: id, cwd: dir, hook_event_name: 'UserPromptSubmit', prompt: prompt });
    };
    assert.strictEqual(contexto(turno('t1', 'escreva mais testes')).indexOf('falha primeiro'), -1);
    // o pedido abre a rota na sessao nova, sem o arquivo
    assert.ok(contexto(turno('t2', 'escreva os testes do parser')).indexOf('o pedido e escrever testes') !== -1);
    // o teste de componente nao traz a de tela
    const componente = contexto(editar(dir, 't3', 'web/Botao.test.tsx').json);
    assert.ok(componente.indexOf('arquivo de teste') !== -1 && componente.indexOf('sworn:design') === -1, componente);
    // o teste visto vermelho a cumpre (o recibo le o projeto e o arquivo do teste, como no da rota de defeito)
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'),
      JSON.stringify({ versaoConfig: 1, marchaPadrao: 'padrao' }), 'utf8');
    fs.writeFileSync(path.join(dir, 'test', 'fila.test.js'), '', 'utf8');
    // a sessao e sempre a t1: so o evento e o resultado mudam
    const rodouNaT1 = function (evento, extra) {
      return processo(dir, 'recibo-da-prova.js', Object.assign({ session_id: 't1', cwd: dir, hook_event_name: evento,
        tool_name: 'Bash', tool_input: { command: 'node --test test/fila.test.js' } }, extra));
    };
    // o verde nao cumpre: o teste nao foi visto falhando
    rodouNaT1('PostToolUse', { tool_response: { stdout: 'ℹ tests 1\nℹ pass 1\nℹ fail 0', stderr: '', interrupted: false } });
    assert.deepStrictEqual(lerEstado(dir, 't1').ordensPendentes, ['teste']);
    // a falha interrompida tambem nao: nao e vermelho
    rodouNaT1('PostToolUseFailure', { error: 'Exit code 130', is_interrupt: true });
    assert.deepStrictEqual(lerEstado(dir, 't1').ordensPendentes, ['teste']);
    rodouNaT1('PostToolUseFailure', { error: 'Exit code 1\nfail 1', is_interrupt: false });
    assert.deepStrictEqual(lerEstado(dir, 't1').ordensPendentes, []);
    assert.strictEqual(lerEstado(dir, 't1').contadores.ordem_teste_cumprida, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('rota no portao-escopo: a 1a edicao de tela da sessao traz a rubrica, sem projeto.json, e so ela', () => {
  const dir = comum.temporaria('sworn-rota-edicao-');
  try {
    const r = editar(dir, 'e1', 'web/app.css');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(contexto(r.json).indexOf('sworn:design') !== -1, JSON.stringify(r.json));
    assert.strictEqual(r.json.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.strictEqual(r.json.hookSpecificOutput.permissionDecision, undefined);
    // o aviso do projeto sem projeto.json segue junto
    assert.ok(/sworn\/init|projeto\.json/.test(r.json.systemMessage || ''), JSON.stringify(r.json));
    assert.deepStrictEqual(lerEstado(dir, 'e1').rotasDadas, ['tela']);
    const r2 = editar(dir, 'e1', 'web/b.css');
    assert.strictEqual(contexto(r2.json), '');
    // a skill da rota cumpre a ordem
    skill(dir, 'e1', 'sworn:design');
    assert.strictEqual(lerEstado(dir, 'e1').contadores.ordem_tela_cumprida, 1);
    // o subagente nao recebe a rota
    assert.strictEqual(contexto(editar(dir, 'e2', 'web/app.css', { agent_id: 'a1' }).json), '');
    // arquivo de logica, sem rota
    assert.strictEqual(contexto(editar(dir, 'e3', 'src/a.js').json), '');
    // o aviso do projeto sem projeto.json ja saiu nesta sessao: a 1a tela leva a rota mesmo assim
    const depoisDoAviso = editar(dir, 'e3', 'web/c.css');
    assert.strictEqual(depoisDoAviso.json.systemMessage, undefined, JSON.stringify(depoisDoAviso.json));
    assert.ok(contexto(depoisDoAviso.json).indexOf('sworn:design') !== -1, JSON.stringify(depoisDoAviso.json));
    // o apagar do Codex (Write com apagar) nao e edicao de tela: sem rota e sem gastar a da sessao
    const apagou = editar(dir, 'e4', 'web/app.css', { tool_input: { file_path: path.join(dir, 'web', 'app.css'), apagar: true } });
    assert.strictEqual(contexto(apagou.json), '');
    assert.strictEqual(estadoSeHouver(dir, 'e4').rotasDadas, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('rota no portao-escopo: a edicao negada nao leva rota', () => {
  const dir = comum.temporaria('sworn-rota-negada-');
  try {
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify({ versaoConfig: 1,
      marchaPadrao: 'padrao', intocaveis: ['segredos/**'], marchas: { rapida: ['docs/**'] } }), 'utf8');
    const r = editar(dir, 'n1', 'segredos/a.css');
    assert.strictEqual(r.json.hookSpecificOutput.permissionDecision, 'deny');
    assert.strictEqual(contexto(r.json).indexOf('sworn:design'), -1);
    assert.strictEqual(estadoSeHouver(dir, 'n1').rotasDadas, undefined);
    // a marcha rapida passa e leva a rota
    const semDesign = contexto(editar(dir, 'n1', 'docs/pagina.html').json);
    assert.ok(semDesign.indexOf('sworn:design') !== -1, semDesign);
    assert.strictEqual(semDesign.indexOf('design.json'), -1, semDesign);
    // com o design.json do projeto, a rota de tela manda usar so os valores dele
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'design.json'), '{}', 'utf8');
    assert.ok(contexto(editar(dir, 'n2', 'docs/b.css').json).indexOf('.claude/sworn/design.json') !== -1);
    // a marcha padrao, com escopo declarado e o arquivo ja no disco, passa pelo fim do portao e leva a rota
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'escopo.md'), '# Escopo\n**Objetivo:** a rota no fim do portao\n' +
      '## Dentro\n- `web/**`\n## Fora de escopo\n- `segredos/**`\n', 'utf8');
    fs.mkdirSync(path.join(dir, 'web'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'web', 'a.css'), 'b{}', 'utf8');
    const padrao = editar(dir, 'n3', 'web/a.css');
    assert.strictEqual((padrao.json.hookSpecificOutput || {}).permissionDecision, undefined, JSON.stringify(padrao.json));
    assert.ok(contexto(padrao.json).indexOf('sworn:design') !== -1, JSON.stringify(padrao.json));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('G4b no gancho: com a skill local "padrao-aaa" ou o playbook carregado, a rota de tela entra; com a design, nao', () => {
  const dir = comum.temporaria('sworn-rota-g4b-');
  try {
    skill(dir, 'b1', 'padrao-aaa');
    assert.strictEqual(lerEstado(dir, 'b1').manualCarregado, true);
    assert.strictEqual(lerEstado(dir, 'b1').contadores.uso_skill_manual_do_projeto, 1);
    assert.ok(contexto(editar(dir, 'b1', 'web/app.css').json).indexOf('sworn:design') !== -1);
    skill(dir, 'b2', 'sworn:design');
    assert.strictEqual(lerEstado(dir, 'b2').contadores.uso_skill_design, 1);
    assert.strictEqual(contexto(editar(dir, 'b2', 'web/app.css').json), '');
    // o playbook e o manual: carregado, ele nao cala a rota de tela
    skill(dir, 'b4', 'sworn:playbook');
    assert.strictEqual(lerEstado(dir, 'b4').contadores.uso_skill_playbook, 1);
    assert.ok(contexto(editar(dir, 'b4', 'web/app.css').json).indexOf('sworn:design') !== -1);
    // o subagente que chama uma skill nao conta uso nem cala a rota do principal
    processo(dir, 'marcar-trabalho.js', { session_id: 'b3', cwd: dir, agent_id: 'a1', hook_event_name: 'PostToolUse',
      tool_name: 'Skill', tool_input: { skill: 'sworn:design' } });
    assert.ok(contexto(editar(dir, 'b3', 'web/app.css').json).indexOf('sworn:design') !== -1);
    assert.strictEqual((lerEstado(dir, 'b3').contadores || {}).uso_skill_design, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('roteador pela ponte: a linha manda ler o SKILL.md inteiro, e a rota AAA nao sai', () => {
  const antes = process.env.SWORN_PONTE;
  try {
    process.env.SWORN_PONTE = '1';
    for (const tipo of ['tela', 'plano', 'etapa', 'diagnosticar']) {
      const nome = ordens.SKILL_DA_ORDEM[tipo];
      const t = roteador.dar({}, [tipo], { alvo: 'docs/PLAN.md' }).textos[0];
      assert.strictEqual(t.indexOf('ferramenta Skill'), -1, tipo + ': ' + t);
      assert.ok(t.indexOf('leia inteiro o SKILL.md') !== -1, tipo + ': ' + t);
      assert.ok(t.indexOf('.agents/skills/sworn-' + nome + '/SKILL.md') !== -1, tipo + ': ' + t);
      assert.ok(t.indexOf(' skills/' + nome + '/SKILL.md') !== -1, tipo + ': ' + t);
      assert.ok(ASCII.test(t), tipo + ': ' + t);
    }
    // o effort-high so existe no Claude Code (o instalador nao o copia): a rota AAA nao sai nem vira ordem
    const s = {};
    const r = roteador.dar(s, ['tela', 'aaa'], { alvo: 'src/auth/Login.tsx' });
    assert.deepStrictEqual(r.dadas, ['tela']);
    assert.deepStrictEqual(r.pendentes, ['tela']);
    assert.strictEqual(r.textos.length, 1);
    assert.strictEqual(r.textos[0].indexOf('effort-high'), -1, r.textos[0]);
    assert.deepStrictEqual(roteador.dar({}, ['aaa'], {}), { dadas: [], pendentes: [], textos: [] });
    // a de defeito nao carrega skill: sai igual pela ponte
    const bug = roteador.dar({}, ['bug'], {});
    assert.deepStrictEqual(bug.dadas, ['bug']);
    assert.ok(bug.textos[0].indexOf('teste que falha') !== -1 && bug.textos[0].indexOf('SKILL.md') === -1, bug.textos[0]);
    // a de teste aponta o roteiro do playbook pelas duas pastas da copia, sem a ferramenta Skill
    const teste = roteador.dar({}, ['teste'], { alvo: 'test/a.test.js' });
    assert.deepStrictEqual(teste.dadas, ['teste']);
    for (const pedaco of ['falha primeiro', '.agents/skills/sworn-playbook/references/04-verificacao.md',
      ' skills/playbook/references/04-verificacao.md']) {
      assert.ok(teste.textos[0].indexOf(pedaco) !== -1, pedaco + ': ' + teste.textos[0]);
    }
    assert.strictEqual(teste.textos[0].indexOf('ferramenta Skill'), -1, teste.textos[0]);
    assert.ok(ASCII.test(teste.textos[0]), teste.textos[0]);
    // sem a ponte, a rota AAA segue saindo, e a de teste aponta a skill pelo nome
    process.env.SWORN_PONTE = '0';
    assert.deepStrictEqual(roteador.dar({}, ['aaa'], {}).dadas, ['aaa']);
    const semPonte = roteador.dar({}, ['teste'], {}).textos[0];
    assert.ok(semPonte.indexOf('na skill playbook do sworn') !== -1 && semPonte.indexOf('.agents/') === -1, semPonte);
  } finally {
    if (antes === undefined) delete process.env.SWORN_PONTE; else process.env.SWORN_PONTE = antes;
  }
});
