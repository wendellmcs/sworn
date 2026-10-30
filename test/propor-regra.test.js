'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'propor-regra.js');

function rodar(args, cwd) {
  const r = spawnSync(process.execPath, [SCRIPT].concat(args), { cwd: cwd, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function projeto() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-aprende-'));
  fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'regras.md'), '# Regras\n\n- ao editar -> rodar git status antes\n', 'utf8');
  return dir;
}

test('propor: sem --gravar, NAO escreve nada (D11)', () => {
  const dir = projeto();
  try {
    const antes = fs.readFileSync(path.join(dir, '.claude', 'sworn', 'regras.md'), 'utf8');
    const r = rodar(['--gatilho', 'ao fechar tarefa', '--acao', 'colar a saida da rodada'], dir);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(fs.readFileSync(path.join(dir, '.claude', 'sworn', 'regras.md'), 'utf8'), antes);
    assert.ok(r.stdout.includes('nao gravei') || r.stdout.includes('NAO gravei'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('propor: com --gravar, acrescenta ao fim sem apagar o que havia', () => {
  const dir = projeto();
  try {
    rodar(['--gatilho', 'ao fechar tarefa', '--acao', 'colar a saida da rodada', '--gravar'], dir);
    const depois = fs.readFileSync(path.join(dir, '.claude', 'sworn', 'regras.md'), 'utf8');
    assert.ok(depois.includes('ao editar -> rodar git status antes'), 'nao pode apagar o que ja existia');
    assert.ok(depois.includes('ao fechar tarefa -> colar a saida da rodada'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('propor: regra invalida e recusada e sai com codigo 1', () => {
  const dir = projeto();
  try {
    const r = rodar(['--gatilho', 'ao subir', '--acao', 'usar a versao 2.1.220', '--gravar'], dir);
    assert.strictEqual(r.status, 1);
    assert.ok(r.stdout.includes('valor que muda com o tempo (numero de versao: "2.1.220")'), r.stdout);
    assert.ok(!fs.readFileSync(path.join(dir, '.claude', 'sworn', 'regras.md'), 'utf8').includes('2.1.220'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('propor: gatilho vazio e recusado', () => {
  const dir = projeto();
  try {
    assert.strictEqual(rodar(['--acao', 'fazer algo'], dir).status, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('propor: regra duplicada nao e gravada duas vezes', () => {
  const dir = projeto();
  try {
    rodar(['--gatilho', 'ao editar', '--acao', 'rodar git status antes', '--gravar'], dir);
    const texto = fs.readFileSync(path.join(dir, '.claude', 'sworn', 'regras.md'), 'utf8');
    const ocorrencias = texto.split('ao editar -> rodar git status antes').length - 1;
    assert.strictEqual(ocorrencias, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// D442/6 (T-20): a duplicata era procurada como TRECHO do arquivo; a regra nova que e so o comeco de uma que ja
// existe ("ao editar -> rodar git status") era dada como JA EXISTE e nao era gravada. Agora compara a linha inteira.
test('D442/6: regra que e trecho de outra e gravada; a mesma regra com espaco a mais segue sendo duplicata', () => {
  const dir = projeto();
  const regras = path.join(dir, '.claude', 'sworn', 'regras.md');
  try {
    const r = rodar(['--gatilho', 'ao editar', '--acao', 'rodar git status', '--gravar'], dir);
    assert.ok(!/JA EXISTE/.test(r.stdout), r.stdout);
    const linhas = fs.readFileSync(regras, 'utf8').split(/\r?\n/);
    assert.ok(linhas.includes('- ao editar -> rodar git status'), linhas.join('|'));
    assert.ok(linhas.includes('- ao editar -> rodar git status antes'), linhas.join('|'));
    const antes = fs.readFileSync(regras, 'utf8');
    const d = rodar(['--gatilho', ' ao editar ', '--acao', 'rodar git status antes ', '--gravar'], dir);
    assert.ok(/JA EXISTE/.test(d.stdout), d.stdout);
    assert.strictEqual(fs.readFileSync(regras, 'utf8'), antes);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('propor: D434 quebra de linha no gatilho ou na acao e recusada e nada e gravado', () => {
  for (const [g, a] of [['linha1\nlinha2', 'x'], ['ao fechar', 'passo1\r\npasso2'], ['ao fechar', 'x\ry']]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-aprende-'));
    try {
      const alvo = path.join(dir, '.claude', 'sworn', 'regras.md');
      const r = rodar(['--gatilho', g, '--acao', a, '--gravar'], dir);
      assert.strictEqual(r.status, 1, r.stdout + r.stderr);
      assert.ok(r.stdout.includes('RECUSADA'), r.stdout);
      assert.ok(r.stdout.includes('uma linha so'), r.stdout);
      assert.strictEqual(fs.existsSync(alvo), false, 'nao pode criar regras.md');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  // e, com regras.md ja existente, ele fica intacto
  const dir = projeto();
  try {
    const alvo = path.join(dir, '.claude', 'sworn', 'regras.md');
    const antes = fs.readFileSync(alvo, 'utf8');
    const r = rodar(['--gatilho', 'a\nb', '--acao', 'x', '--gravar'], dir);
    assert.strictEqual(r.status, 1);
    assert.strictEqual(fs.readFileSync(alvo, 'utf8'), antes);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('propor: A4-04 grava no regras.md da raiz do projeto, mesmo rodando de uma subpasta', () => {
  const dir = projeto();
  try {
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), '{}\n', 'utf8');
    const sub = path.join(dir, 'src', 'modulo');
    fs.mkdirSync(sub, { recursive: true });
    const r = rodar(['--gatilho', 'ao fechar tarefa', '--acao', 'colar a saida da rodada', '--gravar'], sub);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const raiz = fs.readFileSync(path.join(dir, '.claude', 'sworn', 'regras.md'), 'utf8');
    assert.ok(raiz.includes('ao fechar tarefa -> colar a saida da rodada'), raiz);
    assert.ok(raiz.includes('ao editar -> rodar git status antes'), raiz);
    assert.strictEqual(fs.existsSync(path.join(sub, '.claude')), false, 'criou .claude/ na subpasta');
    assert.ok(r.stdout.includes('Total de regras agora: 2'), r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('propor: A4-05 regras.md que nao e texto utf8 e recusado e fica intacto', () => {
  const regras = '# Regras\n\n- ao editar -> rodar git status antes\n- ao subir -> rodar a suite\n';
  const casos = {
    'UTF-16LE com BOM': Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(regras, 'utf16le')]),
    'UTF-16BE com BOM': Buffer.concat([Buffer.from([0xFE, 0xFF]), Buffer.from(regras, 'utf16le').swap16()]),
    'UTF-16LE sem BOM': Buffer.from(regras, 'utf16le'),
    'latin1 (byte invalido em utf8)': Buffer.from('# Regras\n\n- ao editar -> revis\xe3o antes\n', 'latin1')
  };
  for (const [nome, bytes] of Object.entries(casos)) {
    const dir = projeto();
    try {
      const alvo = path.join(dir, '.claude', 'sworn', 'regras.md');
      fs.writeFileSync(alvo, bytes);
      const r = rodar(['--gatilho', 'ao fechar tarefa', '--acao', 'colar a saida da rodada', '--gravar'], dir);
      assert.strictEqual(r.status, 1, nome + ': ' + r.stdout + r.stderr);
      assert.ok(r.stdout.includes('Nao gravei'), nome + ': ' + r.stdout);
      assert.ok(fs.readFileSync(alvo).equals(bytes), nome + ': o regras.md mudou');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('propor: A4-05 regras.md que existe e nao abre e recusado, nunca trocado pelo cabecalho', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-aprende-'));
  try {
    const alvo = path.join(dir, '.claude', 'sworn', 'regras.md');
    fs.mkdirSync(alvo, { recursive: true });
    const r = rodar(['--gatilho', 'ao fechar tarefa', '--acao', 'colar a saida da rodada', '--gravar'], dir);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.ok(r.stdout.includes('Nao gravei'), r.stdout);
    assert.ok(fs.statSync(alvo).isDirectory());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('propor: A4-05 controle - regras.md utf8 com BOM e o ausente seguem gravando', () => {
  const dir = projeto();
  try {
    const alvo = path.join(dir, '.claude', 'sworn', 'regras.md');
    fs.writeFileSync(alvo, '\uFEFF# Regras\n\n- ao editar -> rodar git status antes\n', 'utf8');
    const r = rodar(['--gatilho', 'ao fechar tarefa', '--acao', 'colar a saida da rodada', '--gravar'], dir);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok(fs.readFileSync(alvo, 'utf8').includes('- ao editar -> rodar git status antes'));
    assert.ok(fs.readFileSync(alvo, 'utf8').startsWith('﻿# Regras'), 'o BOM do arquivo do dono sumiu');
    assert.ok(r.stdout.includes('Total de regras agora: 2'), r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const novo = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-aprende-'));
  try {
    const r = rodar(['--gatilho', 'ao fechar tarefa', '--acao', 'colar a saida da rodada', '--gravar'], novo);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes('Total de regras agora: 1'), r.stdout);
  } finally { fs.rmSync(novo, { recursive: true, force: true }); }
});
