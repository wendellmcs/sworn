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
    // A6 (s220, microcopy :15): o vazio diz o que faz o numero subir.
    assert.match(r.stdout, /sobe quando ela barra ou avisa/, r.stdout);
    // A6-02 (D735): o vazio diz o passo.
    assert.match(r.stdout, /Rode de novo depois de alguns turnos de trabalho\./, r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A6 (s220, borda/estados/manutencao :8 e borda :11): so o arquivo ausente e vazio. JSON quebrado, valor que nao e
// objeto simples e erro de leitura saem "ilegivel" com a causa, exit 1; o BOM que o Bloco de Notas poe se le.
test('A6: contadores.json ilegivel diz a causa e sai 1, nunca "nenhum disparo"', () => {
  // A6-06 e A6-09 (D735): o texto do Node entre aspas e marcado como dele; o efeito sem "guarda" nem "recomeca".
  const casos = [['{quebrado', /\(o texto nao e JSON valido; o Node diz: "[^"]/], ['[3,4]', /nao e um objeto/],
    ['"abc"', /nao e um objeto/], ['null', /nao e um objeto/]];
  for (const [conteudo, causa] of casos) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-uso-'));
    try {
      fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'contadores.json'), conteudo, 'utf8');
      const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
      assert.strictEqual(r.status, 1, conteudo + ': ' + r.stdout);
      assert.match(r.stderr, /contadores\.json ilegivel \(/, conteudo);
      assert.match(r.stderr, causa, conteudo + ': ' + r.stderr);
      assert.match(r.stderr, /Corrija o JSON: ele tem de ser um objeto, com o nome de cada trava e quantas vezes ela /,
        conteudo);
      assert.match(r.stderr, /poe o arquivo de lado \(renomeado para contadores\.json\.corrompido, sem apagar\) e /,
        conteudo);
      assert.ok(!/guarda|recomeca/.test(r.stderr), conteudo + ': ' + r.stderr);
      assert.ok(!r.stdout.includes('nenhum disparo'), conteudo + ': ' + r.stdout);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('A6: contadores.json que e pasta sai ilegivel com a causa; com BOM se le', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-uso-'));
  try {
    const alvo = path.join(dir, '.claude', 'sworn', 'contadores.json');
    fs.mkdirSync(alvo, { recursive: true });
    let r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(r.status, 1, r.stdout);
    assert.match(r.stderr, /contadores\.json ilegivel \(e uma pasta \(EISDIR\)\)/, r.stderr);
    fs.rmdirSync(alvo);
    fs.writeFileSync(alvo, '﻿' + JSON.stringify({ fora_do_escopo: 3 }), 'utf8');
    r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /3 \| fora_do_escopo/, r.stdout);
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
    // A6-02 (D735): o rodape explica a trava e diz o que fazer com os numeros.
    assert.ok(r.stdout.includes('Trava e cada regra do sworn que barra ou avisa uma acao. Use estes numeros para ' +
      'decidir qual manter ou desligar'), r.stdout);
    assert.ok(!r.stdout.includes('impressao'), r.stdout);
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
