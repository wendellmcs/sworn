'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const kit = require('../scripts/lib/kit.js');

// H6j (15.5, D906): o kit da linguagem que o init e a cobertura recomendam, sem embutir nem instalar.

function item(k, chave) { return k.itens.filter(function (i) { return i.chave === chave; })[0]; }
function fatos(extra) {
  return Object.assign({ linguagem: 'node', nomes: new Set(), pacote: null, plugins: [], mcp: [] }, extra || {});
}

test('kit: projeto node sem nada mostra os cinco itens, nenhum visto, com o comando de cada', () => {
  const k = kit.recomendar(fatos());
  assert.strictEqual(k.conferido, kit.CONFERIDO);
  assert.strictEqual(k.linguagem, 'node');
  assert.deepStrictEqual(k.itens.map(function (i) { return i.chave; }), ['lsp', 'context7', 'gitleaks', 'semgrep', 'knip']);
  k.itens.forEach(function (i) {
    assert.strictEqual(i.visto, false, i.chave);
    assert.ok(i.para && i.onde && i.como, i.chave + ' sem para, onde ou como');
  });
  assert.strictEqual(item(k, 'lsp').nome, 'typescript-lsp');
  assert.match(item(k, 'lsp').como, /^\/plugin install typescript-lsp@claude-plugins-official /);
  assert.match(item(k, 'lsp').como, /instale o typescript-language-server no PATH \(https:\/\/code\.claude\.com\/docs\/en\/plugins\/code-intelligence\)/);
  assert.match(item(k, 'gitleaks').como, /^instale pela pagina https:\/\/github\.com\/gitleaks\/gitleaks$/);
  assert.match(item(k, 'semgrep').como, /^instale pela pagina https:\/\/github\.com\/semgrep\/semgrep$/);
  assert.match(item(k, 'context7').como, /npx ctx7 setup/);
  assert.match(item(k, 'knip').como, /npm install -D knip/);
});

test('kit: o servidor de linguagem de cada linguagem e o da tabela oficial', () => {
  const esperado = {
    node: ['typescript-lsp', 'typescript-language-server'], python: ['pyright-lsp', 'pyright-langserver'],
    go: ['gopls-lsp', 'gopls'], rust: ['rust-analyzer-lsp', 'rust-analyzer'], jvm: ['jdtls-lsp', 'jdtls'],
    ruby: ['ruby-lsp', 'ruby-lsp'], php: ['php-lsp', 'intelephense']
  };
  Object.keys(esperado).forEach(function (l) {
    const lsp = item(kit.recomendar(fatos({ linguagem: l })), 'lsp');
    assert.strictEqual(lsp.nome, esperado[l][0], l);
    assert.ok(lsp.como.indexOf(esperado[l][1]) !== -1, l + ': ' + lsp.como);
  });
});

test('kit: linguagem nao reconhecida fica sem servidor de linguagem e sem knip', () => {
  const k = kit.recomendar(fatos({ linguagem: null }));
  assert.strictEqual(k.linguagem, null);
  assert.deepStrictEqual(k.itens.map(function (i) { return i.chave; }), ['context7', 'gitleaks', 'semgrep']);
});

test('kit: o knip so entra em projeto node', () => {
  assert.strictEqual(item(kit.recomendar(fatos({ linguagem: 'python' })), 'knip'), undefined);
  assert.ok(item(kit.recomendar(fatos({ linguagem: 'python' })), 'lsp'));
});

test('kit: o plugin de linguagem visto e o de nome exato, ligado nos settings do projeto', () => {
  assert.strictEqual(item(kit.recomendar(fatos({ plugins: ['typescript-lsp@claude-plugins-official'] })), 'lsp').visto, true);
  assert.strictEqual(item(kit.recomendar(fatos({ plugins: ['typescript-lsp@outro'] })), 'lsp').visto, true);
  assert.strictEqual(item(kit.recomendar(fatos({ plugins: ['typescript-lsp-extra@x'] })), 'lsp').visto, false);
  assert.strictEqual(item(kit.recomendar(fatos({ plugins: ['pyright-lsp@claude-plugins-official'] })), 'lsp').visto, false);
  // o visto diz que o binario no PATH segue por conferir: o plugin ligado sem o binario nao funciona
  assert.match(item(kit.recomendar(fatos({ plugins: ['typescript-lsp@x'] })), 'lsp').onde,
    /^ligado nos settings do projeto; confira o typescript-language-server no PATH \(o sworn nao confere\)$/);
});

test('kit: o nao visto do plugin diz que o settings pessoal nao e lido e como conferir', () => {
  const onde = item(kit.recomendar(fatos()), 'lsp').onde;
  assert.match(onde, /settings pessoal \(~\/\.claude\/settings\.json\) nao e lido/);
  assert.match(onde, /claude plugin list/);
});

test('kit: o context7 e visto pelo plugin ou pelo servidor MCP', () => {
  assert.strictEqual(item(kit.recomendar(fatos({ plugins: ['context7@claude-plugins-official'] })), 'context7').visto, true);
  assert.strictEqual(item(kit.recomendar(fatos({ mcp: ['context7'] })), 'context7').visto, true);
  assert.strictEqual(item(kit.recomendar(fatos({ mcp: ['upstash-context7-mcp'] })), 'context7').visto, true);
  assert.strictEqual(item(kit.recomendar(fatos({ mcp: ['github'] })), 'context7').visto, false);
  // o nome e do dono: a caixa nao conta, no plugin e no servidor
  assert.strictEqual(item(kit.recomendar(fatos({ mcp: ['Context7'] })), 'context7').visto, true);
  assert.strictEqual(item(kit.recomendar(fatos({ plugins: ['Context7@x'] })), 'context7').visto, true);
  // o plugin conta pelo comeco do nome; o servidor, em qualquer parte
  assert.strictEqual(item(kit.recomendar(fatos({ plugins: ['meu-context7@x'] })), 'context7').visto, false);
  // o visto nao diz "do projeto": o servidor pode vir do ~/.claude.json
  assert.match(item(kit.recomendar(fatos({ mcp: ['context7'] })), 'context7').onde, /do projeto ou do ~\/\.claude\.json/);
});

test('kit: gitleaks e semgrep sao vistos pelo arquivo de configuracao na raiz', () => {
  const k = kit.recomendar(fatos({ nomes: new Set(['.gitleaks.toml', '.semgrepignore']) }));
  assert.strictEqual(item(k, 'gitleaks').visto, true);
  assert.match(item(k, 'gitleaks').onde, /\.gitleaks\.toml/);
  assert.strictEqual(item(k, 'semgrep').visto, true);
  assert.match(item(k, 'semgrep').onde, /\.semgrepignore/);
  const nada = kit.recomendar(fatos());
  assert.match(item(nada, 'gitleaks').onde, /\.gitleaksignore/);
  assert.match(item(nada, 'gitleaks').onde, /CI/);
});

test('kit: o knip e visto pela dependencia, pela chave do package.json ou pelo arquivo', () => {
  assert.strictEqual(item(kit.recomendar(fatos({ pacote: { devDependencies: { knip: '^5' } } })), 'knip').visto, true);
  assert.strictEqual(item(kit.recomendar(fatos({ pacote: { dependencies: { knip: '^5' } } })), 'knip').visto, true);
  assert.strictEqual(item(kit.recomendar(fatos({ pacote: { knip: { entry: ['a.js'] } } })), 'knip').visto, true);
  assert.strictEqual(item(kit.recomendar(fatos({ nomes: new Set(['knip.jsonc']) })), 'knip').visto, true);
  assert.strictEqual(item(kit.recomendar(fatos({ nomes: new Set(['knip.jsonc']) })), 'knip').onde, 'achei knip.jsonc na raiz');
  assert.strictEqual(item(kit.recomendar(fatos({ pacote: { knip: {} } })), 'knip').onde, 'achei o knip no package.json');
  // o nao visto do knip avisa, como o do gitleaks, que o instalado so na maquina ou no CI nao aparece
  assert.match(item(kit.recomendar(fatos()), 'knip').onde, /^nao achei o knip no package\.json nem knip\.json, .+ na raiz \(instalado so na maquina ou no CI nao aparece aqui\)$/);
  assert.strictEqual(item(kit.recomendar(fatos({ pacote: { devDependencies: { 'knip-extra': '1' } } })), 'knip').visto, false);
  // o package.json fora da forma (lista, texto) nao quebra
  assert.strictEqual(item(kit.recomendar(fatos({ pacote: ['knip'] })), 'knip').visto, false);
  assert.strictEqual(item(kit.recomendar(fatos({ pacote: 'knip' })), 'knip').visto, false);
  assert.strictEqual(item(kit.recomendar(fatos({ pacote: { devDependencies: 'knip' } })), 'knip').visto, false);
});

test('kit: entrada sem as listas nao quebra', () => {
  const k = kit.recomendar({ linguagem: 'node' });
  assert.strictEqual(k.itens.length, 5);
  assert.ok(k.itens.every(function (i) { return i.visto === false; }));
  // lista que nao e lista, e item que nao e texto, ficam de fora sem quebrar
  const emTexto = kit.recomendar(fatos({ plugins: 'typescript-lsp@x', mcp: 'context7' }));
  assert.strictEqual(item(emTexto, 'lsp').visto, false);
  assert.strictEqual(item(emTexto, 'context7').visto, false);
  assert.strictEqual(item(kit.recomendar(fatos({ plugins: [5, null, 'typescript-lsp@x'], mcp: [{}, 'context7'] })), 'lsp').visto, true);
  assert.strictEqual(item(kit.recomendar(fatos({ mcp: [{}, 'context7'] })), 'context7').visto, true);
});

test('kit: linguagem fora da tabela (ou nome herdado do Object) fica sem linguagem', () => {
  for (const l of ['cobol', 'toString', 'constructor', '', 5]) {
    const k = kit.recomendar(fatos({ linguagem: l }));
    assert.strictEqual(k.linguagem, null, String(l));
    assert.strictEqual(item(k, 'lsp'), undefined, String(l));
  }
});

test('kit: daPasta le a raiz e o package.json, sem caixa fixa no nome', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn kit-'));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { knip: '5' } }), 'utf8');
    fs.writeFileSync(path.join(dir, '.GITLEAKS.toml'), '', 'utf8');
    const k = kit.daPasta(dir, { plugins: ['typescript-lsp@claude-plugins-official'], mcp: [],
      mcpForaDoProjeto: { usuario: ['context7'], local: [] } });
    assert.strictEqual(k.linguagem, 'node');
    assert.strictEqual(item(k, 'lsp').visto, true);
    assert.strictEqual(item(k, 'context7').visto, true);
    assert.strictEqual(item(k, 'gitleaks').visto, true);
    assert.strictEqual(item(k, 'semgrep').visto, false);
    assert.strictEqual(item(k, 'knip').visto, true);
    // o MCP local do ~/.claude.json tambem conta
    assert.strictEqual(item(kit.daPasta(dir, { plugins: [], mcp: [], mcpForaDoProjeto: { usuario: [], local: ['context7'] } }), 'context7').visto, true);
    // sem ambiente nenhum, so os arquivos
    assert.strictEqual(item(kit.daPasta(dir), 'context7').visto, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('kit: daPasta numa pasta sem marcador fica sem linguagem', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn kit-'));
  try {
    assert.strictEqual(kit.daPasta(dir, {}).linguagem, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('kit: daPasta com package.json quebrado ou pasta que nao existe nao lanca', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn kit-'));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{', 'utf8');
    const k = kit.daPasta(dir, {});
    assert.strictEqual(k.linguagem, 'node');
    assert.strictEqual(item(k, 'knip').visto, false);
    const sem = kit.daPasta(path.join(dir, 'nao existe'), {});
    assert.strictEqual(sem.linguagem, null);
    assert.deepStrictEqual(sem.itens.map(function (i) { return i.chave; }), ['context7', 'gitleaks', 'semgrep']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('kit: daPasta acha o marcador com maiuscula (Cargo.toml) em qualquer sistema', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn kit-'));
  try {
    fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\n', 'utf8');
    const k = kit.daPasta(dir, {});
    assert.strictEqual(k.linguagem, 'rust');
    assert.strictEqual(item(k, 'lsp').nome, 'rust-analyzer-lsp');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('kit: as linhas dizem a data conferida, que nada e instalado, e marcam visto e nao visto', () => {
  const t = kit.linhas(kit.recomendar(fatos({ plugins: ['typescript-lsp@claude-plugins-official'] }))).join('\n');
  assert.match(t, /^Kit da linguagem \(node\)/);
  assert.ok(t.indexOf(kit.CONFERIDO) !== -1, t);
  assert.match(t, /nunca instala/);
  assert.match(t, /\n {2}\[x\] Servidor de linguagem \(typescript-lsp\) - /);
  assert.match(t, /\n {2}\[ \] gitleaks - [^\n]+ Como: instale pela pagina https:\/\/github\.com\/gitleaks\/gitleaks/);
  assert.doesNotMatch(t.split('\n').filter(function (l) { return /\[x\]/.test(l); }).join('\n'), /Como:/);
  // sem linguagem, o cabecalho diz por que falta o servidor de linguagem e quais linguagens o sworn reconhece
  assert.match(kit.linhas(kit.recomendar(fatos({ linguagem: null }))).join('\n'),
    /^Kit da linguagem \(linguagem nao reconhecida, entao sem servidor de linguagem: o sworn reconhece node, python, go, rust, jvm, ruby, php\)/);
});
