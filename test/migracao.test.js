'use strict';
// T2 do plano nome+pagina (D623): o plugin se chamava esquadro ate a 0.13.0. A abertura leva a pasta antiga
// .claude/esquadro/ para .claude/sworn/ uma vez so - a do projeto (achada subindo pastas, como o raizDoProjeto) e a
// da home (so com o vigia ligado e sem SWORN_VIGIA: a home so guarda a pasta do vigia). Destino ja existente: nao
// mexe em nenhuma e avisa uma vez. Os caminhos de `referencias` do projeto.json que apontavam para a pasta antiga
// passam a apontar para a nova, sem mudar o resto do arquivo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const migracao = require('../scripts/lib/migracao.js');
const RE_MIGROU = /passou a \.claude\/sworn\//;
const RE_JUNTAS = /nao mexi em nenhuma/;

function temp(nome) { return fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-migracao-' + nome + '-')); }

function escrever(dir, rel, conteudo) {
  const alvo = path.join(dir, rel);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, conteudo, 'utf8');
}

function ler(dir, rel) { return fs.readFileSync(path.join(dir, rel), 'utf8'); }
function existe(dir, rel) { return fs.existsSync(path.join(dir, rel)); }

/** Abre a sessao em `cwd`, com a home em `casa` e sem SWORN_VIGIA (a migracao da home so roda sem ela). */
function abrir(cwd, casa, id) {
  const env = Object.assign({}, process.env, { SWORN_TMP: path.join(casa, '_sessoes'), USERPROFILE: casa, HOME: casa });
  delete env.SWORN_VIGIA;
  return spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'abertura.js')], {
    cwd, encoding: 'utf8', input: JSON.stringify({ session_id: id, cwd, source: 'startup' }), env
  });
}

function linhas(saida, re) { return saida.split('\n').filter(function (l) { return re.test(l); }); }

test('T2: projeto aberto em subpasta - a pasta antiga sobe a .claude/sworn/ uma vez, com as referencias atualizadas e o resto do projeto.json intacto', () => {
  const base = temp('sub');
  const casa = temp('casa-sub');
  try {
    const projeto = '﻿{\n  "versaoConfig": 1,\n  "intocaveis": ["esquadro/**"],\n  "referencias": {\n' +
      '    "tela": [".claude/esquadro/referencias/a.md", "docs/fora.md"],\n' +
      '    "codigo": [".claude\\\\esquadro\\\\referencias\\\\b.md"]\n  }\n}\n';
    escrever(base, '.claude/esquadro/projeto.json', projeto);
    escrever(base, '.claude/esquadro/referencias/a.md', '# a\n');
    escrever(base, '.claude/esquadro/escopos/frente.md', '**Objetivo:** x\n');
    const sub = path.join(base, 'pacote', 'fonte');
    fs.mkdirSync(sub, { recursive: true });
    const r = abrir(sub, casa, 'm1');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(!existe(base, '.claude/esquadro'), 'a pasta antiga saiu');
    assert.strictEqual(ler(base, '.claude/sworn/referencias/a.md'), '# a\n', 'o conteudo veio junto');
    assert.ok(existe(base, '.claude/sworn/escopos/frente.md'), 'as subpastas vieram juntas');
    assert.ok(!existe(sub, '.claude'), 'nada criado na subpasta');
    const esperado = projeto.replace('.claude/esquadro/referencias/a.md', '.claude/sworn/referencias/a.md')
      .replace('.claude\\\\esquadro\\\\referencias\\\\b.md', '.claude\\\\sworn\\\\referencias\\\\b.md');
    assert.strictEqual(ler(base, '.claude/sworn/projeto.json'), esperado, 'so os caminhos de referencias mudaram');
    const aviso = linhas(r.stdout, RE_MIGROU);
    assert.strictEqual(aviso.length, 1, 'uma linha diz que migrou: ' + r.stdout);
    assert.ok(/2 caminhos de "referencias"/.test(aviso[0]), 'conta os caminhos trocados: ' + aviso[0]);
    assert.ok(/^[\x20-\x7E]*$/.test(aviso[0]), 'fora de ASCII: ' + aviso[0]);
    const de_novo = abrir(sub, casa, 'm2');
    assert.strictEqual(linhas(de_novo.stdout, RE_MIGROU).length, 0, 'uma vez so: ' + de_novo.stdout);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(casa, { recursive: true, force: true });
  }
});

test('T2: as duas pastas juntas - nao mexe em nenhuma e avisa uma vez', () => {
  const base = temp('juntas');
  const casa = temp('casa-juntas');
  try {
    escrever(base, '.claude/esquadro/projeto.json', '{"versaoConfig":1}\n');
    escrever(base, '.claude/esquadro/regras.md', 'antiga\n');
    escrever(base, '.claude/sworn/projeto.json', '{"versaoConfig":1,"nova":true}\n');
    const r = abrir(base, casa, 'j1');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(ler(base, '.claude/esquadro/regras.md'), 'antiga\n', 'a antiga ficou');
    assert.strictEqual(ler(base, '.claude/sworn/projeto.json'), '{"versaoConfig":1,"nova":true}\n', 'a nova ficou');
    assert.strictEqual(linhas(r.stdout, RE_MIGROU).length, 0, 'nao diz que migrou');
    const aviso = linhas(r.stdout, RE_JUNTAS);
    assert.strictEqual(aviso.length, 1, 'avisa: ' + r.stdout);
    assert.ok(/^[\x20-\x7E]*$/.test(aviso[0]), 'fora de ASCII: ' + aviso[0]);
    const de_novo = abrir(base, casa, 'j2');
    assert.strictEqual(linhas(de_novo.stdout, RE_JUNTAS).length, 0, 'avisa uma vez so: ' + de_novo.stdout);
    assert.ok(existe(base, '.claude/esquadro/regras.md'), 'a antiga segue la');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(casa, { recursive: true, force: true });
  }
});

test('T2: sem projeto.json em lugar nenhum, a pasta antiga da propria pasta migra; projeto ja sworn mais perto nao deixa subir', () => {
  const solta = temp('solta');
  const casa = temp('casa-solta');
  const base = temp('perto');
  try {
    escrever(solta, '.claude/esquadro/contadores.json', '{}\n');
    const r = abrir(solta, casa, 's1');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(existe(solta, '.claude/sworn/contadores.json') && !existe(solta, '.claude/esquadro'), 'migrou: ' + r.stdout);
    assert.strictEqual(linhas(r.stdout, RE_MIGROU).length, 1, r.stdout);

    escrever(base, '.claude/esquadro/projeto.json', '{"versaoConfig":1}\n');
    escrever(base, 'app/.claude/sworn/projeto.json', '{"versaoConfig":1}\n');
    const p = abrir(path.join(base, 'app'), casa, 's2');
    assert.strictEqual(p.status, 0, p.stderr);
    assert.ok(existe(base, '.claude/esquadro/projeto.json') && !existe(base, '.claude/sworn'), 'a de cima e outro projeto');
    assert.strictEqual(linhas(p.stdout, RE_MIGROU).length + linhas(p.stdout, RE_JUNTAS).length, 0, p.stdout);
  } finally {
    for (const d of [solta, casa, base]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('T2: a home migra pela abertura so com o vigia ligado; desligado, nem olha', () => {
  const base = temp('home');
  const casa = temp('casa-home');
  try {
    escrever(casa, '.claude/esquadro/vigia/visto.json', '{"semana":"2026-10-19"}\n');
    escrever(base, '.claude/sworn/projeto.json', '{"versaoConfig":1,"vigia":false}\n');
    const desligado = abrir(base, casa, 'h1');
    assert.strictEqual(desligado.status, 0, desligado.stderr);
    assert.ok(existe(casa, '.claude/esquadro/vigia/visto.json') && !existe(casa, '.claude/sworn'), 'vigia desligado nao mexe');

    escrever(base, '.claude/sworn/projeto.json', '{"versaoConfig":1,"vigia":true}\n');
    const r = abrir(base, casa, 'h2');
    assert.strictEqual(r.status, 0, r.stderr);
    // O vigia roda logo depois e acrescenta a marca do dia (sem novidades.md): prova de que ja le a pasta nova.
    assert.strictEqual(JSON.parse(ler(casa, '.claude/sworn/vigia/visto.json')).semana, '2026-10-19', 'a pasta do vigia veio');
    assert.ok(!existe(casa, '.claude/esquadro'), 'a antiga saiu');
    const aviso = linhas(r.stdout, /~\/\.claude\/sworn\//);
    assert.strictEqual(aviso.length, 1, 'uma linha diz que migrou: ' + r.stdout);
    assert.ok(/^[\x20-\x7E]*$/.test(aviso[0]), 'fora de ASCII: ' + aviso[0]);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(casa, { recursive: true, force: true });
  }
});

test('T2 (lib): migrarCasa respeita SWORN_VIGIA e a nova ja existente; projeto.json ilegivel migra sem trocar caminho', () => {
  const casa = temp('casa-lib');
  const base = temp('ilegivel');
  try {
    escrever(casa, '.claude/esquadro/vigia/novidades.md', 'semana: 2026-10-19\n');
    const ligado = { vigia: true };
    assert.strictEqual(migracao.migrarCasa(casa, { SWORN_VIGIA: path.join(casa, 'outra') }, ligado, base), null, 'pasta escolhida');
    assert.ok(existe(casa, '.claude/esquadro/vigia/novidades.md'), 'com SWORN_VIGIA nao mexe');
    escrever(casa, '.claude/sworn/vigia/visto.json', '{"problema":"2026-10-23"}\n');
    const juntas = migracao.migrarCasa(casa, {}, ligado, base);
    assert.ok(RE_JUNTAS.test(juntas || ''), 'avisa as duas juntas: ' + juntas);
    assert.ok(existe(casa, '.claude/esquadro/vigia/novidades.md'), 'nao mexeu na antiga');
    assert.strictEqual(migracao.migrarCasa(casa, {}, ligado, base), null, 'avisa uma vez so');

    escrever(base, '.claude/esquadro/projeto.json', '{"referencias": {"tela": [".claude/esquadro/r.md",]}}\n');
    const msg = migracao.migrarProjeto(base);
    assert.ok(RE_MIGROU.test(msg || ''), msg);
    assert.strictEqual(ler(base, '.claude/sworn/projeto.json'), '{"referencias": {"tela": [".claude/esquadro/r.md",]}}\n',
      'ilegivel fica como estava');
    assert.ok(/nao consegui ler/.test(msg), 'diz que os caminhos ficaram: ' + msg);

    // O mesmo caminho fora de `referencias`: a troca no texto pegaria os dois, o parser recusa e nada se grava.
    const outra = temp('repetido');
    try {
      const repetido = '{"intocaveis": [".claude/esquadro/r.md"], "referencias": {"tela": [".claude/esquadro/r.md"]}}\n';
      escrever(outra, '.claude/esquadro/projeto.json', repetido);
      const m2 = migracao.migrarProjeto(outra);
      assert.ok(RE_MIGROU.test(m2 || '') && /nao consegui ler/.test(m2), m2);
      assert.strictEqual(ler(outra, '.claude/sworn/projeto.json'), repetido, 'nada gravado');
    } finally { fs.rmSync(outra, { recursive: true, force: true }); }

    // projeto.json que existe e nao se le (aqui uma pasta: EISDIR, como seria um EACCES) avisa; so o ausente cala.
    const travado = temp('travado');
    try {
      fs.mkdirSync(path.join(travado, '.claude', 'esquadro', 'projeto.json'), { recursive: true });
      const m3 = migracao.migrarProjeto(travado);
      assert.ok(RE_MIGROU.test(m3 || '') && /nao consegui ler/.test(m3), m3);
      assert.strictEqual(migracao.trocarReferencias(path.join(travado, 'nao-existe.json')), 0, 'ausente = nada a trocar');
    } finally { fs.rmSync(travado, { recursive: true, force: true }); }
  } finally {
    fs.rmSync(casa, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  }
});
