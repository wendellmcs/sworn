'use strict';
// D827: o sworn nao depende de terceiro. A ideia de um projeto mapeado (radar, referencia) entra reescrita dentro do
// plugin; o produto do terceiro so se instala para teste, com o sim do dono, e nunca vira dependencia. Este teste e a
// regra no plugin: o package.json nao declara dependencia, e o codigo que o plugin carrega (scripts/, hooks/,
// workflows/) so importa modulo nativo do Node, arquivo proprio (caminho relativo) ou a propria plataforma.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { builtinModules } = require('node:module');

const RAIZ = path.join(__dirname, '..');
const PASTAS = ['scripts', 'hooks', 'workflows'];
// Um arquivo que existe em cada pasta: prova que a varredura entrou nela (e em scripts/lib, a subpasta).
const CONHECIDOS = ['scripts/apurar-ronda.js', 'scripts/lib/citacao.js', 'hooks/mods.tsx', 'workflows/parallel.js'];
const EXTENSOES = /\.(?:js|mjs|cjs|ts|tsx)$/;
// A plataforma onde o plugin roda (os mods do Claude Code), nao um pacote de terceiro.
const PLATAFORMA = /^claude-code(?:\/|$)/;
// Cada forma de import, com o nome do modulo sempre no grupo 2 (aspas simples, duplas ou crase).
const FORMAS = [
  /\brequire(?:\.resolve)?\(\s*(['"`])([^'"`]+)\1\s*\)/g,
  /\bimport\(\s*(['"`])([^'"`]+)\1\s*\)/g,
  /\bfrom\s+(['"])([^'"]+)\1/g,
  /(?:^|;)\s*import\s+(['"])([^'"]+)\1/gm,
];
const COMO_RESOLVER = ' — pela D827, troque por modulo nativo do Node ou reescreva a ideia dentro do plugin.';

function arquivos(dir) {
  const fora = [];
  if (!fs.existsSync(dir)) return fora;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') fora.push(...arquivos(p)); } else if (EXTENSOES.test(e.name)) fora.push(p);
  }
  return fora;
}

function permitido(nome) {
  if (nome.startsWith('./') || nome.startsWith('../')) return true;
  if (nome.startsWith('node:')) return true;
  if (builtinModules.includes(nome)) return true; // a lista ja traz os subcaminhos (fs/promises)
  return PLATAFORMA.test(nome);
}

// Tira o comentario que comeca a linha: `//` ate o fim dela; `/*` ate o `*/`, que pode fechar linhas abaixo. O codigo
// depois do `*/` fica. Um `/*` no meio da linha (dentro de uma string de glob, por exemplo) nao abre comentario: o
// erro que sobra e contar um comentario como codigo, que reprova alto, nunca esconder um import.
function semComentario(texto) {
  let emBloco = false;
  return texto.split('\n').map(function (linha) {
    let resto = linha;
    if (emBloco) {
      const fim = resto.indexOf('*/');
      if (fim === -1) return '';
      emBloco = false;
      resto = resto.slice(fim + 2);
    }
    const ini = resto.search(/\S/);
    if (ini === -1) return resto;
    if (resto.startsWith('//', ini)) return '';
    if (resto.startsWith('/*', ini)) {
      const fim = resto.indexOf('*/', ini + 2);
      if (fim === -1) { emBloco = true; return ''; }
      return resto.slice(fim + 2);
    }
    return resto;
  }).join('\n');
}

function importsDeTerceiro(texto) {
  const codigo = semComentario(texto);
  const fora = [];
  for (const forma of FORMAS) {
    for (const m of codigo.matchAll(forma)) if (!permitido(m[2])) fora.push(m[2]);
  }
  return fora;
}

const CAMPOS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies',
  'bundledDependencies'];
// Os nomes dos campos do package.json que trazem alguma dependencia (lista ou objeto nao vazio).
function camposComDependencia(pkg) {
  return CAMPOS.filter(function (campo) {
    const v = pkg[campo];
    if (v === undefined || v === null) return false;
    return Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0;
  });
}

test('o package.json nao declara dependencia de terceiro (D827)', function () {
  const arquivo = path.join(RAIZ, 'package.json');
  assert.ok(fs.existsSync(arquivo), 'package.json nao existe na raiz do plugin: ' + arquivo);
  const pkg = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  assert.deepStrictEqual(camposComDependencia(pkg), [], 'package.json declara dependencia nestes campos' + COMO_RESOLVER);
});

test('a conferencia do package.json pega cada campo de dependencia e aceita o vazio', function () {
  assert.deepStrictEqual(camposComDependencia({}), []);
  assert.deepStrictEqual(camposComDependencia({ dependencies: {}, bundleDependencies: [], peerDependencies: null }), []);
  // Lista propria, nao a CAMPOS: tirar um campo de CAMPOS tem de reprovar aqui.
  for (const campo of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies',
    'bundleDependencies', 'bundledDependencies']) {
    const valor = campo.startsWith('bundle') ? ['x'] : { x: '1.0.0' };
    assert.deepStrictEqual(camposComDependencia({ [campo]: valor }), [campo], campo);
  }
});

test('o codigo do plugin so importa modulo nativo, arquivo proprio ou a plataforma (D827)', function () {
  const lidos = PASTAS.flatMap(function (p) { return arquivos(path.join(RAIZ, p)); });
  const relativos = lidos.map(function (f) { return path.relative(RAIZ, f).split(path.sep).join('/'); });
  for (const c of CONHECIDOS) assert.ok(relativos.includes(c), 'a varredura nao passou por ' + c);
  const achados = [];
  lidos.forEach(function (f, i) {
    for (const nome of importsDeTerceiro(fs.readFileSync(f, 'utf8'))) achados.push(relativos[i] + ': ' + nome);
  });
  assert.deepStrictEqual(achados, [], 'import de terceiro no plugin (arquivo: modulo)' + COMO_RESOLVER);
});

test('o detector pega cada forma de import de terceiro e deixa passar o permitido', function () {
  assert.deepStrictEqual(importsDeTerceiro("const a = require('lodash');"), ['lodash']);
  assert.deepStrictEqual(importsDeTerceiro('const a = require("@scope/pkg/x");'), ['@scope/pkg/x']);
  assert.deepStrictEqual(importsDeTerceiro('const a = require(`lodash`);'), ['lodash']);
  assert.deepStrictEqual(importsDeTerceiro("const p = require.resolve('agent-browser');"), ['agent-browser']);
  assert.deepStrictEqual(importsDeTerceiro("import x from 'puppeteer'"), ['puppeteer']);
  assert.deepStrictEqual(importsDeTerceiro("const m = await import('playwright');"), ['playwright']);
  assert.deepStrictEqual(importsDeTerceiro("import 'side-effect-pkg'"), ['side-effect-pkg']);
  assert.deepStrictEqual(importsDeTerceiro([
    "const fs = require('fs');", "const p = require('node:path');", "const l = require('./lib/x.js');",
    "const u = require('../y');", "const pr = require('fs/promises');", "import type { R } from 'claude-code'",
    "import { t } from 'claude-code/testing'",
  ].join('\n')), []);
  assert.deepStrictEqual(importsDeTerceiro("import x from 'claude-codex'"), ['claude-codex']);
});

test('comentario nao conta como import; o codigo depois do comentario conta', function () {
  assert.deepStrictEqual(importsDeTerceiro("// copiado from 'lodash'\n/* require('y') */"), []);
  assert.deepStrictEqual(importsDeTerceiro("/**\n * le from 'x'\n require('z')\n */\nconst f = 1;"), []);
  assert.deepStrictEqual(importsDeTerceiro("// nota\nconst a = require('lodash');"), ['lodash']);
  assert.deepStrictEqual(importsDeTerceiro("/* x */ const a = require('lodash');"), ['lodash']);
  assert.deepStrictEqual(importsDeTerceiro("/* a\n b */ const c = require('lodash');"), ['lodash']);
  assert.deepStrictEqual(importsDeTerceiro("const g = 'scripts/*.js'; const a = require('lodash');"), ['lodash']);
  assert.deepStrictEqual(importsDeTerceiro("const u = 'https://x'; const a = require('lodash');"), ['lodash']);
  assert.deepStrictEqual(importsDeTerceiro("/*/ require('x') */"), [], '/*/ so abre o comentario');
  assert.deepStrictEqual(importsDeTerceiro("foo(); import 'pkg'"), ['pkg']);
});
