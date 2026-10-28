'use strict';
// Colheita 10-20, item 10 (D674): o gancho de entrada grava os pedidos do dono numa lista numerada por frente, e o
// /sworn:handoff le a lista. Nada que o dono pediu se perde entre chats; hoje depende de o agente lembrar.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const pedidos = require('../scripts/lib/pedidos.js');
const retomar = require('../scripts/lib/retomar.js');
const projeto = require('../scripts/lib/projeto.js');

const RAIZ = path.join(__dirname, '..');
// hora local, como o resumo da volta (retomar.js, dia/hora)
const AGORA = new Date(2026, 9, 25, 13, 5).getTime();
const CHAVE = 'sk-' + 'ant-api03-' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4';

function pasta(comSworn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-pedidos-'));
  if (comSworn) fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
  return { dir: dir, fim: function () { fs.rmSync(dir, { recursive: true, force: true }); } };
}
function lista(dir, nome) {
  return fs.readFileSync(path.join(dir, '.claude', 'sworn', 'pedidos', nome + '.md'), 'utf8');
}

test('item 10: registrar numera os pedidos por frente, com data e hora', () => {
  const t = pasta(true);
  try {
    assert.strictEqual(pedidos.registrar(t.dir, 'minha-frente', 'publica a versao', AGORA),
      '.claude/sworn/pedidos/minha-frente.md');
    pedidos.registrar(t.dir, 'minha-frente', 'e manda o resumo', AGORA + 60000);
    const texto = lista(t.dir, 'minha-frente');
    assert.match(texto, /^# Pedidos do dono - minha-frente\n/);
    assert.match(texto, /^1\. 2026-10-25 13:05 - publica a versao$/m);
    assert.match(texto, /^2\. 2026-10-25 13:06 - e manda o resumo$/m);
    assert.strictEqual(pedidos.ler(t.dir, 'minha-frente'), texto);
  } finally { t.fim(); }
});

// Revisao cega do lote 2 (s157): lista que existe e nao se le nao e lista nova.
test('item 10: lista que existe e nao se le lanca, sem recomecar do 1 nem repetir o cabecalho', () => {
  const t = pasta(true);
  const ler = fs.readFileSync;
  try {
    pedidos.registrar(t.dir, 'f', 'primeiro', AGORA);
    const arq = path.join(t.dir, '.claude', 'sworn', 'pedidos', 'f.md');
    fs.readFileSync = function (p) {
      if (path.resolve(String(p)) === path.resolve(arq)) { const e = new Error('ocupado'); e.code = 'EBUSY'; throw e; }
      return ler.apply(fs, arguments);
    };
    assert.throws(function () { pedidos.registrar(t.dir, 'f', 'segundo', AGORA); }, /ocupado/);
    fs.readFileSync = ler;
    assert.strictEqual(lista(t.dir, 'f').split('# Pedidos do dono').length - 1, 1, 'cabecalho uma vez so');
    assert.ok(!/^1\. .* - segundo$/m.test(lista(t.dir, 'f')), 'nada gravado com o numero 1 de novo');
  } finally { fs.readFileSync = ler; t.fim(); }
});

test('item 10: sem .claude/sworn/ nada se grava (projeto sem sworn nao e poluido)', () => {
  const t = pasta(false);
  try {
    assert.strictEqual(pedidos.registrar(t.dir, 'f', 'oi', AGORA), null);
    assert.strictEqual(fs.existsSync(path.join(t.dir, '.claude')), false);
    assert.strictEqual(pedidos.ler(t.dir, 'f'), null);
  } finally { t.fim(); }
});

test('item 10: o texto sai limpo, mascarado e cortado; vazio nao vira pedido', () => {
  const t = pasta(true);
  try {
    pedidos.registrar(t.dir, 'f', '<system-reminder>lembrete do harness</system-reminder> usa ' + CHAVE + ' aqui', AGORA);
    pedidos.registrar(t.dir, 'f', 'x'.repeat(900), AGORA);
    assert.strictEqual(pedidos.registrar(t.dir, 'f', '<system-reminder>so isto</system-reminder>  ', AGORA), null);
    assert.strictEqual(pedidos.registrar(t.dir, 'f', 42, AGORA), null);
    const texto = lista(t.dir, 'f');
    assert.match(texto, /^1\. 2026-10-25 13:05 - usa \[segredo omitido\] aqui$/m);
    assert.ok(texto.indexOf('lembrete do harness') === -1 && texto.indexOf(CHAVE) === -1);
    const dois = texto.split('\n').filter(function (l) { return /^2\. /.test(l); })[0];
    assert.strictEqual(dois.length, '2. 2026-10-25 13:05 - '.length + 600);
    assert.ok(/\.\.\.$/.test(dois));
    assert.strictEqual(texto.split('\n').filter(function (l) { return /^\d+\. /.test(l); }).length, 2);
  } finally { t.fim(); }
});

test('item 10: sem frente, ou com nome que nao serve de arquivo, vai para sem-frente', () => {
  const t = pasta(true);
  try {
    assert.strictEqual(pedidos.registrar(t.dir, null, 'um', AGORA), '.claude/sworn/pedidos/sem-frente.md');
    assert.strictEqual(pedidos.registrar(t.dir, '../fora', 'dois', AGORA), '.claude/sworn/pedidos/sem-frente.md');
    assert.match(lista(t.dir, 'sem-frente'), /^2\. 2026-10-25 13:05 - dois$/m);
    assert.strictEqual(fs.existsSync(path.join(t.dir, '.claude', 'fora.md')), false);
  } finally { t.fim(); }
});

test('item 10: chave pedidos - ligada por padrao, so o booleano false desliga', () => {
  assert.ok(projeto.CHAVES_LIGA_DESLIGA.indexOf('pedidos') !== -1);
  assert.strictEqual(pedidos.ligada(null), true);
  assert.strictEqual(pedidos.ligada({}), true);
  assert.strictEqual(pedidos.ligada({ pedidos: 'false' }), true, 'texto nao desliga (D388)');
  assert.strictEqual(pedidos.ligada({ pedidos: false }), false);
});

test('item 10: o retomar.js exporta o limpar e o mascarar que a lista reusa', () => {
  assert.strictEqual(typeof retomar.limpar, 'function');
  assert.strictEqual(typeof retomar.mascarar, 'function');
});

function abrir(dir, sessoes, id, prompt) {
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'abrir-turno.js')], {
    cwd: dir, encoding: 'utf8',
    input: JSON.stringify({ session_id: id, cwd: dir, hook_event_name: 'UserPromptSubmit', prompt: prompt }),
    env: Object.assign({}, process.env, { SWORN_TMP: sessoes })
  });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

test('item 10: o abrir-turno grava o pedido na lista da frente vinculada; a chave false desliga', () => {
  const t = pasta(true);
  const sessoes = path.join(t.dir, 'sessoes');
  const antes = process.env.SWORN_TMP;
  try {
    process.env.SWORN_TMP = sessoes;
    require('../scripts/lib/estado.js').gravar('p1', { frente: 'frente-a' });
    const saida = abrir(t.dir, sessoes, 'p1', 'corrige o rodape');
    assert.strictEqual(saida, null, 'a lista nao muda a saida do gancho: ' + JSON.stringify(saida));
    assert.match(lista(t.dir, 'frente-a'), /^1\. \d{4}-\d\d-\d\d \d\d:\d\d - corrige o rodape$/m);
    abrir(t.dir, sessoes, 'p2', 'sem vinculo');
    assert.match(lista(t.dir, 'sem-frente'), /^1\. .* - sem vinculo$/m);
    fs.writeFileSync(path.join(t.dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify({ pedidos: false }));
    abrir(t.dir, sessoes, 'p1', 'nao grava');
    assert.ok(lista(t.dir, 'frente-a').indexOf('nao grava') === -1);
  } finally {
    if (antes === undefined) delete process.env.SWORN_TMP; else process.env.SWORN_TMP = antes;
    t.fim();
  }
});
