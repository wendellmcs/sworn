'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'uso.js');

test('uso: projeto sem contadores diz que ainda nao ha dado', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-uso-'));
  try {
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(r.status, 0);
    assert.ok(r.stdout.toLowerCase().includes('nenhum'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Plano 083 (p4-30): valor que nao e numero no contadores.json nao entra no sort nem na soma; a linha diz que ele e
// invalido, e o total e o dos numeros.
test('083 T6 (p4-30): valor que nao e numero fica fora da soma e da ordem, e a linha diz por que', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-uso-'));
  try {
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'contadores.json'),
      JSON.stringify({ texto: '3', nulo: null, bom: 5, outro: 2 }), 'utf8');
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    const linhas = r.stdout.split('\n').filter((l) => l.includes('|'));
    assert.deepStrictEqual(linhas.map((l) => l.split('|')[1].trim().split(' ')[0]), ['bom', 'outro', 'texto', 'nulo', 'TOTAL']);
    assert.match(r.stdout, /\| TOTAL\n/);
    assert.ok(linhas[linhas.length - 1].trim().startsWith('7 |'), r.stdout);
    assert.ok(linhas.some((l) => /\? \| texto \(nao e numero: "3"\)$/.test(l)), r.stdout);
    assert.ok(linhas.some((l) => /\? \| nulo \(nao e numero: null\)$/.test(l)), r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('uso: lista os disparos em ordem decrescente', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-uso-'));
  try {
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.claude', 'sworn', 'contadores.json'),
      JSON.stringify({ fora_do_escopo: 40, fecho_sem_evidencia: 7, comando_destrutivo: 2 }),
      'utf8'
    );
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
    const linhas = r.stdout.split('\n').filter((l) => l.includes('|'));
    assert.ok(linhas[0].includes('fora_do_escopo'), r.stdout);
    assert.ok(r.stdout.includes('49'), 'devia somar o total');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Plano 091 T6: os contadores de ordem (ordem_<tipo>_<fase>) moram no mesmo arquivo, mas nao sao disparo de trava:
// ficam fora da lista e do total; uma linha diz onde eles aparecem.
test('091 T6: as chaves de ordem ficam fora da lista e do total das travas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-uso-'));
  try {
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'contadores.json'),
      JSON.stringify({ fora_do_escopo: 4, ordem_revisar_dada: 30, ordem_aprender_cumprida: 2 }), 'utf8');
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    const linhas = r.stdout.split('\n').filter((l) => l.includes('|'));
    assert.deepStrictEqual(linhas.map((l) => l.split('|')[1].trim()), ['fora_do_escopo', 'TOTAL']);
    assert.ok(linhas[1].trim().startsWith('4 |'), r.stdout);
    assert.ok(r.stdout.includes('As ordens (dadas, cumpridas, recusadas) saem na auditoria automatica.'), r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
