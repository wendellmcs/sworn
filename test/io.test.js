'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
// T2 (D623): sem cwd na entrada a abertura usa a pasta do processo. Na do repositorio ela subia ate o projeto real
// (e migrava a pasta dele) e ligava o vigia da home real; aqui roda numa pasta vazia, com sessoes e vigia dentro dela.
const VAZIA = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-io-'));
test.after(() => fs.rmSync(VAZIA, { recursive: true, force: true }));

function rodar(script, entrada) {
  return spawnSync(process.execPath, [path.join(RAIZ, 'scripts', script)], {
    cwd: VAZIA,
    input: typeof entrada === 'string' ? entrada : JSON.stringify(entrada),
    encoding: 'utf8',
    env: Object.assign({}, process.env, { SWORN_TMP: path.join(VAZIA, '_sessoes'), SWORN_VIGIA: path.join(VAZIA, '_vigia') })
  });
}

function rodarArquivo(caminhoRelativo, entrada) {
  return spawnSync(process.execPath, [path.join(RAIZ, caminhoRelativo)], {
    input: typeof entrada === 'string' ? entrada : JSON.stringify(entrada),
    encoding: 'utf8'
  });
}

test('io: exporta os cinco nomes que os portoes usam', () => {
  const io = require('../scripts/lib/io.js');
  for (const nome of ['lerEntrada', 'permitir', 'negarFerramenta', 'bloquearFecho', 'blindar']) {
    assert.strictEqual(typeof io[nome], 'function', 'falta ' + nome);
  }
});

test('io: blindar engole excecao e sai com 0', () => {
  const io = require('../scripts/lib/io.js');
  const saidaOriginal = process.exitCode;
  let saiu = null;
  const exitOriginal = process.exit;
  process.exit = (c) => { saiu = c; throw new Error('__parar__'); };
  try {
    io.blindar(() => { throw new Error('estourou de proposito'); });
  } catch (e) {
    if (e.message !== '__parar__') throw e;
  } finally {
    process.exit = exitOriginal;
    process.exitCode = saidaOriginal;
  }
  assert.strictEqual(saiu, 0);
});

// A5-27/A5-29 (D735): valor lancado que nao e Error (texto, null) saia "undefined" no log; e sem quebra de linha.
test('A5-29: blindar poe no stderr a causa de qualquer valor lancado, com quebra de linha final', () => {
  const io = path.join(__dirname, '..', 'scripts', 'lib', 'io.js');
  for (const [lancado, causa] of [["'texto solto'", 'texto solto'], ['null', 'null'],
    ["new Error('de proposito')", 'Error: de proposito'], ['Object.create(null)', 'valor lancado sem texto legivel']]) {
    const r = spawnSync(process.execPath, ['-e', 'require(' + JSON.stringify(io) + ').blindar(() => { throw ' +
      lancado + '; });'], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stderr, 'sworn: portao falhou e liberou por seguranca: ' + causa + '\n', lancado);
  }
});

test('abertura: hook responde 0 mesmo com stdin vazio', () => {
  const r = rodar('abertura.js', '');
  assert.strictEqual(r.status, 0, 'stderr: ' + r.stderr);
});

test('abertura: hook responde 0 com JSON invalido', () => {
  const r = rodar('abertura.js', '{isso nao e json');
  assert.strictEqual(r.status, 0, 'stderr: ' + r.stderr);
});

test('io: blindar cobre excecao lancada dentro do callback assincrono de lerEntrada', () => {
  const r = rodarArquivo('test/auxiliar-blindar-async.js', '');
  assert.strictEqual(r.status, 0, 'stderr: ' + r.stderr);
});
