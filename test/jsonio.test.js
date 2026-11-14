'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jsonio = require('../scripts/lib/jsonio.js');

/**
 * F5a (diagnostico de 2026-11-10, secao F): seis copias de lerJson, cada uma com um contrato (uma sem o BOM, uma
 * calando o arquivo quebrado, outra dizendo a causa). `ler` e a leitura unica, e diz POR QUE nao leu.
 */

const RAIZ = path.join(__dirname, '..');

function pasta() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-jsonio-')); }

test('F5a: ler devolve o valor, aceita o BOM do PowerShell 5.1 e separa ausente de ilegivel', () => {
  const p = pasta();
  try {
    fs.writeFileSync(path.join(p, 'a.json'), '﻿{"x": 1}');
    assert.deepStrictEqual(jsonio.ler(path.join(p, 'a.json')), { valor: { x: 1 }, ausente: false, etapa: null, erro: null });
    const sem = jsonio.ler(path.join(p, 'nao-existe.json'));
    assert.deepStrictEqual(sem, { valor: null, ausente: true, etapa: null, erro: null });
    const pastaNoLugar = jsonio.ler(p);
    assert.strictEqual(pastaNoLugar.ausente, false);
    assert.strictEqual(pastaNoLugar.etapa, 'leitura');
    assert.ok(pastaNoLugar.erro && pastaNoLugar.erro.code, 'a causa do sistema vem no erro');
    fs.writeFileSync(path.join(p, 'quebrado.json'), '{"x": ');
    const q = jsonio.ler(path.join(p, 'quebrado.json'));
    assert.strictEqual(q.valor, null);
    assert.strictEqual(q.etapa, 'json');
    assert.ok(q.erro instanceof SyntaxError);
    assert.strictEqual(jsonio.ler(undefined).etapa, 'leitura', 'caminho que nao e texto nao lanca');
    assert.strictEqual(jsonio.ler(null).etapa, 'leitura', 'null tambem nao lanca');
    assert.strictEqual(jsonio.ler('').ausente, true, 'caminho vazio: o sistema diz ENOENT, nao ha arquivo a ler');
    // revisao cega: o vazio (gravacao cortada, Out-File de texto vazio) e ilegivel, nunca ausente nem valor
    for (const [nome, conteudo] of [['vazio', ''], ['espacos', '  \r\n\t'], ['so-bom', '﻿']]) {
      fs.writeFileSync(path.join(p, nome + '.json'), conteudo);
      const v = jsonio.ler(path.join(p, nome + '.json'));
      assert.deepStrictEqual([v.valor, v.ausente, v.etapa], [null, false, 'json'], nome);
    }
  } finally { fs.rmSync(p, { recursive: true, force: true }); }
});

test('F5a: com objeto: true, lista, numero e null valido viram etapa "forma", sem valor', () => {
  const p = pasta();
  try {
    for (const conteudo of ['[1, 2]', '3', 'null', '"texto"']) {
      fs.writeFileSync(path.join(p, 'f.json'), conteudo);
      const r = jsonio.ler(path.join(p, 'f.json'), { objeto: true });
      assert.deepStrictEqual(r, { valor: null, ausente: false, etapa: 'forma', erro: null }, conteudo);
      assert.deepStrictEqual(jsonio.ler(path.join(p, 'f.json')).valor, JSON.parse(conteudo), 'sem a opcao: ' + conteudo);
      assert.deepStrictEqual(jsonio.ler(path.join(p, 'f.json'), { objeto: false }).valor, JSON.parse(conteudo),
        'objeto: false: ' + conteudo);
    }
    fs.writeFileSync(path.join(p, 'f.json'), '{}');
    assert.deepStrictEqual(jsonio.ler(path.join(p, 'f.json'), { objeto: true }).valor, {});
  } finally { fs.rmSync(p, { recursive: true, force: true }); }
});

test('F5a: os leitores de config, ambiente, cobertura e varredura passam pelo jsonio (contrato de cada um mantido)', () => {
  const p = pasta();
  try {
    fs.mkdirSync(path.join(p, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(p, '.claude', 'sworn', 'projeto.json'), '﻿{"a": 1}');
    fs.writeFileSync(path.join(p, '.claude', 'sworn', 'design.json'), '[1]');
    const config = require('../scripts/lib/config.js');
    assert.deepStrictEqual(config.carregarProjeto(p), { a: 1 });
    assert.strictEqual(config.carregarDesign(p), null, 'lista nao e o objeto do design.json');
    assert.strictEqual(config.carregarProjeto(''), null);
    fs.writeFileSync(path.join(p, '.claude', 'sworn', 'apelidos-vivos.json'), '{"x":');
    fs.writeFileSync(path.join(p, '.claude', 'settings.json'), '[]');
    fs.writeFileSync(path.join(p, '.mcp.json'), '{"mcpServers": ');
    const fatos = require('../scripts/lib/ambiente.js').detectar(p);
    assert.strictEqual(fatos.naoLidos[0], '.claude/settings.json (nao e um objeto JSON)', fatos.naoLidos.join('; '));
    assert.match(fatos.naoLidos[1], /^\.mcp\.json \(SyntaxError: /, 'o quebrado diz a causa');
    assert.strictEqual(fatos.naoLidos.length, 2, 'o ausente (settings.local.json) nao e "nao lido"');
    const cob = require('../scripts/lib/cobertura.js').ambiente(p, {});
    assert.strictEqual(cob.prova, null);
    assert.match(cob.provaIlegivel, /^JSON invalido: /);
    fs.rmSync(path.join(p, '.claude', 'sworn', 'apelidos-vivos.json'));
    assert.strictEqual(require('../scripts/lib/cobertura.js').ambiente(p, {}).provaIlegivel, null, 'ausente nao e ilegivel');
    fs.writeFileSync(path.join(p, 'package.json'), '﻿{"scripts": {"test": "node --test"}}');
    const inferido = require('../scripts/lib/varredura.js').inferir(['package.json'], p);
    assert.strictEqual(inferido.provaDePronto, 'npm test', 'o package.json com BOM se le');
    // revisao cega da F5a: cwd vazio nao le o package.json da pasta do processo (o do repositorio, que tem test).
    assert.notStrictEqual(require('../scripts/lib/varredura.js').inferir(['package.json'], '').provaDePronto, 'npm test');
  } finally { fs.rmSync(p, { recursive: true, force: true }); }
});

// O guarda da duplicacao: outra funcao lerJson volta a espalhar contratos diferentes.
const DEFINE_LERJSON = new RegExp([
  'function\\s+lerJson\\b', // function lerJson(
  '\\blerJson\\s*=(?!=)', // const lerJson = ..., sem casar a comparacao ==
  '^\\s*(?:async\\s+)?lerJson\\s*\\([^)]*\\)\\s*\\{', // metodo lerJson(p) {
  '\\blerJson\\s*:\\s*(?:async\\b|function\\b|\\([^)]*\\)\\s*=>|[\\w$]+\\s*=>)' // propriedade { lerJson: p => ... }
].join('|'));
test('F5a: nenhum script define a propria lerJson; a leitura de arquivo JSON e a do scripts/lib/jsonio.js', () => {
  const achados = [];
  function varrer(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const c = path.join(dir, e.name);
      if (e.isDirectory()) { varrer(c); continue; }
      if (!/\.js$/.test(e.name)) continue;
      fs.readFileSync(c, 'utf8').split(/\r?\n/).forEach(function (l, i) {
        if (DEFINE_LERJSON.test(l)) {
          achados.push(path.relative(RAIZ, c).split(path.sep).join('/') + ':' + (i + 1));
        }
      });
    }
  }
  varrer(path.join(RAIZ, 'scripts'));
  if (fs.existsSync(path.join(RAIZ, 'hooks'))) varrer(path.join(RAIZ, 'hooks'));
  assert.deepStrictEqual(achados, [], 'lerJson propria: troque por require(\'./lib/jsonio.js\').ler, que separa ' +
    'ausente de ilegivel e tira o BOM');
  // revisao cega: a seta sem parenteses, o async e o metodo tambem contam; o comentario que so cita o nome, nao
  for (const def of ['function lerJson(p) {', 'const lerJson = p => 1;', 'let lerJson = async (p) => 1;', '  lerJson(p) {',
    'module.exports = { lerJson: p => 1 };', '{ lerJson: function (p) {', '{ lerJson: (p, o) => 1 }', 'lerJson: () => 1,']) {
    assert.ok(DEFINE_LERJSON.test(def), def);
  }
  // revisao cega (ronda 3): o ternario com o outro ramo entre parenteses nao e definicao
  for (const nao of ['// como no lerJson do ambiente.js', 'x = lerJson(p);', 'y = ok ? lerJson : outro;',
    'const f = ok ? lerJson : (outro);']) {
    assert.ok(!DEFINE_LERJSON.test(nao), nao);
  }
});
