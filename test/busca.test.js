'use strict';
const test = require('node:test');
const assert = require('node:assert');
const busca = require('../scripts/lib/busca.js');

/**
 * C9 - "eu prefiro criar arquivo novo a entender o que ja existe".
 * A autoavaliacao exigia "busca citada antes de arquivo novo"; ate aqui isso era
 * so uma regra de texto em modelos/regras.md.
 */

test('busca: Grep e Glob contam como ter procurado', () => {
  assert.strictEqual(busca.ehBusca('Grep', {}), true);
  assert.strictEqual(busca.ehBusca('Glob', {}), true);
});

test('busca: o nome da ferramenta nao diferencia caixa', () => {
  assert.strictEqual(busca.ehBusca('grep', {}), true);
  assert.strictEqual(busca.ehBusca('GREP', {}), true);
});

test('busca: Write e Edit NAO sao busca (controle)', () => {
  assert.strictEqual(busca.ehBusca('Write', { file_path: 'a.js' }), false);
  assert.strictEqual(busca.ehBusca('Edit', { file_path: 'a.js' }), false);
});

test('busca: Bash conta pelo COMANDO, nao pelo nome da ferramenta', () => {
  assert.strictEqual(busca.ehBusca('Bash', { command: 'grep -rn foo src/' }), true);
  assert.strictEqual(busca.ehBusca('Bash', { command: 'rg --files' }), true);
  assert.strictEqual(busca.ehBusca('Bash', { command: 'git ls-files' }), true);
});

test('busca: Bash destrutivo NAO conta como busca (controle)', () => {
  assert.strictEqual(busca.ehBusca('Bash', { command: 'rm -rf build' }), false);
  assert.strictEqual(busca.ehBusca('Bash', { command: 'npm install' }), false);
});

test('busca: Bash sem comando nenhum nao conta (controle)', () => {
  assert.strictEqual(busca.ehBusca('Bash', {}), false);
  assert.strictEqual(busca.ehBusca('Bash', null), false);
});

test('busca: o comando tem de comecar palavra - "regrep" nao e grep (controle)', () => {
  assert.strictEqual(busca.ehBusca('Bash', { command: 'regrep foo' }), false);
  assert.strictEqual(busca.ehBusca('Bash', { command: 'meufind .' }), false);
});

test('busca: grep depois de cano ou ; conta', () => {
  assert.strictEqual(busca.ehBusca('Bash', { command: 'cat a | grep b' }), true);
  assert.strictEqual(busca.ehBusca('Bash', { command: 'cd x; find . -name "*.js"' }), true);
});

test('busca: ferramenta desconhecida nao conta (controle)', () => {
  assert.strictEqual(busca.ehBusca('WebFetch', { url: 'x' }), false);
  assert.strictEqual(busca.ehBusca(null, null), false);
});

test('busca: motivo diz que editar existente NAO exige busca', () => {
  const m = busca.motivo('src/novo.js');
  assert.ok(m.includes('src/novo.js'));
  assert.ok(/quem edita ja achou/i.test(m), 'a recusa tem de dizer o que NAO e barrado');
  // A falha de origem vai em palavras: o codigo da autoavaliacao nao vai a publico,
  // e quem le a recusa nao teria onde procura-lo (ronda 1 do Passo 8b).
  assert.ok(/criar arquivo novo em vez de entender o que ja existe/.test(m), 'a recusa cita a falha de origem');
  assert.ok(!/"eu prefiro/.test(m), 'F1-H08: a frase em primeira pessoa e do catalogo de falhas, nao da recusa');
});

// A4-30 (pedido 12, microcopy): a recusa diz o motivo e o passo sem o jargao do projeto.
test('A4-30: a recusa de arquivo novo diz o motivo e o passo sem "falha de origem" nem "portao"', () => {
  const m = busca.motivo('src/novo.js');
  assert.ok(!/falha de origem|portao/i.test(m), m);
  assert.ok(m.includes('Por que: o risco e criar arquivo novo em vez de entender o que ja existe.'), m);
  assert.ok(m.includes('crie: depois de uma busca neste turno, criar arquivo novo fica liberado.'), m);
});

// ── regressao: furo achado na auditoria de 2026-09-02 ───────────────────────

test('busca REGRESSAO: comando que ESCREVE nao e passe para criar', () => {
  // `sed -i` altera arquivo. Aceitar um comando de escrita como "ja procurei"
  // seria o portao se abrindo com a propria chave.
  assert.strictEqual(busca.ehBusca('Bash', { command: 'sed -i s/x/y/ a.js' }), false);
  assert.strictEqual(busca.ehBusca('Bash', { command: 'awk "{print}" a.js' }), false);
  // e o que so le continua contando
  assert.strictEqual(busca.ehBusca('Bash', { command: 'cat a.js' }), true);
  assert.strictEqual(busca.ehBusca('Bash', { command: 'tail -20 a.js' }), true);
});

// F1-C11: 'search' e 'ls' nao sao ferramentas que nenhum hook entregue (hooks.json so escuta
// Write|Edit|Bash|PowerShell|Grep|Glob|Read): contavam como busca sem poder ser chamadas.
test('busca: FERRAMENTAS so lista o que o hook entrega (Grep, Glob, Read)', () => {
  assert.deepStrictEqual(busca.FERRAMENTAS, ['grep', 'glob', 'read']);
  assert.strictEqual(busca.ehBusca('Search', {}), false);
  assert.strictEqual(busca.ehBusca('LS', {}), false);
  assert.strictEqual(busca.ehBusca('Read', {}), true, 'controle: o que fica continua contando');
});

// A4-bus-1 (pedido 12, seguranca): `find` com -delete/-exec/-execdir/-ok/-okdir (e `fd -x/-X/--exec`) altera ou roda
// comando por si e contava como busca - o portao de arquivo novo abria com o mesmo tipo de chave que o `sed -i`.
test('A4-bus-1: find que apaga ou executa NAO e passe para criar; find que so lista segue contando', () => {
  [
    'find . -name "*.tmp" -delete',
    'find . -type f -exec rm {} \;',
    'find src -execdir touch novo.js \;',
    'find . -ok rm {} \;',
    'find . -okdir rm {} \;',
    'ls && find . -delete',
    'fd tmp -x rm',
    'fd tmp -X rm',
    'fd tmp --exec rm',
    'fd tmp --exec-batch rm'
  ].forEach((c) => assert.strictEqual(busca.ehBusca('Bash', { command: c }), false, c));
  assert.strictEqual(busca.ehBusca('PowerShell', { command: 'find . -delete' }), false);
  ['find . -name "*.js"', 'fd busca src', 'find . -name x | grep -c y', 'find . -executable'].forEach((c) =>
    assert.strictEqual(busca.ehBusca('Bash', { command: c }), true, c));
});
