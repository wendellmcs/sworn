'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const config = require('../scripts/lib/config.js');

const BOM = String.fromCharCode(65279);

function comProjeto(conteudo, fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-config-'));
  try {
    const pasta = path.join(cwd, '.claude', 'sworn');
    fs.mkdirSync(pasta, { recursive: true });
    if (conteudo !== null) {
      fs.writeFileSync(path.join(pasta, 'projeto.json'), conteudo, 'utf8');
    }
    fn(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

test('config: projeto.json com BOM carrega o objeto (D-A)', () => {
  const json = JSON.stringify({ nome: 'sworn', intocaveis: ['docs/plano-v1.md'] });
  comProjeto(BOM + json, (cwd) => {
    const bytes = fs.readFileSync(path.join(cwd, '.claude', 'sworn', 'projeto.json'));
    assert.strictEqual(bytes.slice(0, 3).toString('hex'), 'efbbbf', 'arquivo de teste realmente tem BOM');
    const obj = config.carregarProjeto(cwd);
    assert.ok(obj, 'carregarProjeto nao devolveu null com BOM');
    assert.strictEqual(obj.nome, 'sworn');
    assert.deepStrictEqual(obj.intocaveis, ['docs/plano-v1.md']);
  });
});

test('config: projeto.json sem BOM carrega o mesmo objeto (controle)', () => {
  const json = JSON.stringify({ nome: 'sworn', intocaveis: ['docs/plano-v1.md'] });
  comProjeto(json, (cwd) => {
    const bytes = fs.readFileSync(path.join(cwd, '.claude', 'sworn', 'projeto.json'));
    assert.notStrictEqual(bytes.slice(0, 3).toString('hex'), 'efbbbf', 'controle: este arquivo NAO tem BOM');
    const obj = config.carregarProjeto(cwd);
    assert.ok(obj);
    assert.strictEqual(obj.nome, 'sworn');
    assert.deepStrictEqual(obj.intocaveis, ['docs/plano-v1.md']);
  });
});

test('config: arquivo ausente devolve null', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-config-'));
  try {
    assert.strictEqual(config.carregarProjeto(cwd), null);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('config: json de verdade corrompido devolve null', () => {
  comProjeto('{"a":', (cwd) => {
    assert.strictEqual(config.carregarProjeto(cwd), null);
  });
});

test('config: cwd falsy devolve null', () => {
  assert.strictEqual(config.carregarProjeto(null), null);
  assert.strictEqual(config.carregarProjeto(undefined), null);
  assert.strictEqual(config.carregarProjeto(''), null);
});

// --- D124: carregarDesign nascia sem semBom, e a irmã dela 8 linhas acima ja tinha. ---

function comDesign(conteudo, fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-design-'));
  try {
    const pasta = path.join(cwd, '.claude', 'sworn');
    fs.mkdirSync(pasta, { recursive: true });
    if (conteudo !== null) {
      fs.writeFileSync(path.join(pasta, 'design.json'), conteudo, 'utf8');
    }
    fn(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

test('config: design.json com BOM carrega o objeto (D124)', () => {
  const json = JSON.stringify({ cores: ['#ff6600'], antiReferencias: ['gradiente'] });
  comDesign(BOM + json, (cwd) => {
    const bytes = fs.readFileSync(path.join(cwd, '.claude', 'sworn', 'design.json'));
    assert.strictEqual(bytes.slice(0, 3).toString('hex'), 'efbbbf', 'arquivo de teste realmente tem BOM');
    const obj = config.carregarDesign(cwd);
    assert.ok(obj, 'null aqui DESLIGA o modulo de design em silencio, e nada avisa');
    assert.deepStrictEqual(obj.cores, ['#ff6600']);
  });
});

test('config: design.json sem BOM carrega o mesmo objeto (controle)', () => {
  const json = JSON.stringify({ cores: ['#ff6600'], antiReferencias: ['gradiente'] });
  comDesign(json, (cwd) => {
    const bytes = fs.readFileSync(path.join(cwd, '.claude', 'sworn', 'design.json'));
    assert.notStrictEqual(bytes.slice(0, 3).toString('hex'), 'efbbbf', 'controle: este arquivo NAO tem BOM');
    const obj = config.carregarDesign(cwd);
    assert.ok(obj);
    assert.deepStrictEqual(obj.cores, ['#ff6600']);
  });
});

test('config: design.json ausente devolve null - o modulo e opcional', () => {
  comDesign(null, (cwd) => {
    assert.strictEqual(config.carregarDesign(cwd), null);
  });
  assert.strictEqual(config.carregarDesign(null), null);
});

// --- 0.3.3, item 27: o caminho de um arquivo de .claude/sworn/ mora aqui, e o reinjecao o usa. ---

test("config: caminhoEmSworn monta <projeto>/.claude/sworn/<nome> (0.3.3, item 27)", () => {
  const cwd = path.join(os.tmpdir(), "qualquer-projeto");
  assert.strictEqual(config.caminhoEmSworn(cwd, "projeto.json"), path.join(cwd, ".claude", "sworn", "projeto.json"));
  assert.strictEqual(config.caminhoEmSworn(cwd, "regras.md"), path.join(cwd, ".claude", "sworn", "regras.md"));
});

test("config: carregarProjeto le o arquivo que caminhoEmSworn aponta (0.3.3, item 27)", () => {
  comProjeto(JSON.stringify({ nome: "a" }), (cwd) => {
    assert.ok(fs.existsSync(config.caminhoEmSworn(cwd, "projeto.json")), "o caminho exportado e o do arquivo de verdade");
    assert.strictEqual(config.carregarProjeto(cwd).nome, "a");
  });
});

test('H-3: projeto.json e design.json que sao LISTA JSON valida nao sao objeto: devolvem null', () => {
  for (const bruto of ['[]', '[1, 2]', '[{"intocaveis": ["x"]}]']) {
    comProjeto(bruto, (cwd) => assert.strictEqual(config.carregarProjeto(cwd), null, 'projeto.json ' + bruto));
    comDesign(bruto, (cwd) => assert.strictEqual(config.carregarDesign(cwd), null, 'design.json ' + bruto));
  }
  comProjeto('{}', (cwd) => assert.deepStrictEqual(config.carregarProjeto(cwd), {}, 'controle: objeto vazio segue objeto'));
});
