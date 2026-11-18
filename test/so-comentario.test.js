'use strict';
// H1-custo (D868): o leitor que diz se dois textos de JS ou TS diferem so em comentario ou espaco. Na duvida, nao.
const test = require('node:test');
const assert = require('node:assert');

const sc = require('../scripts/lib/so-comentario.js');

const BASE = [
  "'use strict';",
  '// cabecalho',
  'const re = /a\\/\\/b[/*]/g; // regex com barras',
  'const t = `x ${ {a: 1}.a } // nao e comentario`;',
  'function f(x) {',
  '  return x / 2 / 3; /* meio */',
  '}',
  'module.exports = { re, t, f };',
  ''
].join('\n');

test('H1-custo: comentario e espaco mudados sao so comentario', () => {
  const casos = [
    BASE.replace('// cabecalho', '// cabecalho reescrito, mais longo'),
    BASE.replace('// cabecalho', '/**\n * cabecalho\n * em bloco\n */'),
    BASE.replace('/* meio */', '// meio, de linha'),
    BASE.replace('// regex com barras', ''),
    BASE.replace('function f', '\n\n// antes da funcao\nfunction f'),
    BASE.split('\n').map(function (l) { return l ? '\t' + l : l; }).join('\n'),
    BASE.split('\n').join('\r\n'),
    '\ufeff' + BASE
  ];
  casos.forEach(function (depois, i) { assert.strictEqual(sc.soComentario(BASE, depois), true, 'caso ' + i + ':\n' + depois); });
});

test('H1-custo: codigo, string, template, regex e diretiva mudados nao sao so comentario', () => {
  const casos = [
    ['o numero', BASE.replace('x / 2', 'x / 4')],
    ['o // dentro do template', BASE.replace('// nao e comentario', '// outro texto')],
    ['a regex', BASE.replace('[/*]', '[/]')],
    ['a string', BASE.replace("'use strict'", "'use sloppy'")],
    ['a diretiva do TypeScript', BASE.replace('// cabecalho', '// @ts-ignore')],
    ['a diretiva do eslint', BASE.replace('/* meio */', '// eslint-disable-line')],
    ['a marca de funcao pura', BASE.replace('/* meio */', '/* @__PURE__ */')]
  ];
  for (const [nome, depois] of casos) assert.strictEqual(sc.soComentario(BASE, depois), false, nome);
  assert.strictEqual(sc.soComentario('let ab;', 'let a/**/b;'), false, 'o comentario separa dois nomes');
});

test('H1-custo: a quebra de linha conta (o ponto e virgula automatico), o espaco no meio da linha nao', () => {
  assert.strictEqual(sc.soComentario('return x;', 'return /*\n*/ x;'), false, 'o bloco com quebra depois do return');
  assert.strictEqual(sc.soComentario('return x;', 'return /* sem quebra */ x;'), true);
  assert.strictEqual(sc.soComentario('a = b\n(c)', 'a = b (c)'), false);
  assert.strictEqual(sc.soComentario('a  =  b;', 'a = b; // igual'), true);
});

test('H1-custo: na duvida o leitor diz null, e null nunca e so comentario', () => {
  for (const [nome, texto] of [
    ['string sem fecho', "const a = 'x;\n"],
    ['string que passa da linha', "a = 'x\nb';"],
    ['arquivo que nao e UTF-8 (o U+FFFD da leitura)', "a = '" + String.fromCharCode(0xfffd) + "';"],
    ['template sem fecho', 'const a = `x ${y}'],
    ['chave de template sem fecho', 'const a = `x ${ {y'],
    ['comentario sem fecho', 'const a = 1; /* x'],
    ['regex sem fecho', 'const a = /x;\n'],
    ['JSX', 'const a = <p>http://x</p>;'],
    ['JSX que fecha sozinho', 'const a = <br />;'],
    ['nao e texto', null]
  ]) {
    assert.strictEqual(sc.codigo(texto), null, nome);
    assert.strictEqual(sc.soComentario(texto, texto), false, nome + ' (mesmo igual)');
  }
  // um lado so ilegivel ja basta
  assert.strictEqual(sc.soComentario(BASE, "const a = 'x;\n"), false, 'o depois ilegivel');
  assert.strictEqual(sc.soComentario("const a = 'x;\n", BASE), false, 'o antes ilegivel');
  assert.strictEqual(sc.codigo(undefined), null, 'undefined');
});

test('H1-custo: o arquivo vazio e codigo vazio, e ganhar so comentario continua so comentario', () => {
  assert.strictEqual(sc.codigo(''), '');
  assert.strictEqual(sc.soComentario('', '// so comentario\n'), true);
  assert.strictEqual(sc.soComentario('', 'x;'), false);
});

test('H1-custo: a divisao depois de nome, numero e parentese nao abre regex', () => {
  assert.strictEqual(sc.soComentario('a = b / c / d; // x', 'a = b / c / d; // y'), true);
  assert.strictEqual(sc.soComentario('a = (b) / 2;', 'a  =  (b)  /  2; '), true, 'sem outra / na linha, e divisao');
  assert.strictEqual(sc.soComentario('a = (b) / 2; // x', 'a = (b) / 2;'), false, 'com outra / na linha, na duvida');
  assert.strictEqual(sc.soComentario('if (ok) return /a/.test(s); // x', 'if (ok) return /a/.test(s);'), true);
  assert.strictEqual(sc.soComentario('return /a/.test(s);', 'return /b/.test(s);'), false);
  // a regex com // dentro: lida como divisao, o // esconderia o resto da linha
  assert.strictEqual(sc.soComentario('/[//]/.test(a);', '/[//]/.test(b);'), false, 'a regex no comeco do arquivo');
  assert.strictEqual(sc.soComentario('return /[//]/.test(a);', 'return /[//]/.test(b);'), false, 'a regex depois do return');
  // a `/` depois de `)` ou `}` com outra `/` na linha: regex ou divisao, null
  for (const [antes, depois] of [
    ['if (ok) /[//]/.test(s);', 'if (ok) /[//]/.test(t);'],
    ['if (ok) /a\\//.test(s);', 'if (ok) /a\\//.test(t);'],
    ['}\n/[//]/.test(s);', '}\n/[//]/.test(t);'],
    ['export default /[//]/.test(s);', 'export default /[//]/.test(t);']
  ]) assert.strictEqual(sc.soComentario(antes, depois), false, antes);
  // o espaco Zs (U+3000) e espaco, nao pedaco do nome: o return segue abrindo regex
  const ideo = String.fromCharCode(0x3000);
  assert.strictEqual(sc.soComentario('return' + ideo + '/[//]/.test(s);', 'return' + ideo + '/[//]/.test(t);'), false);
  assert.strictEqual(sc.codigo('a' + ideo + '=' + ideo + 'b;'), 'a = b;');
});

test('H1-custo: so JS e TS (sem JSX) entram na conta', () => {
  for (const n of ['a.js', 'a.mjs', 'a.cjs', 'a.ts', 'a.mts', 'a.cts', 'dir/A.JS']) assert.ok(sc.EXTENSOES.test(n), n);
  for (const n of ['a.jsx', 'a.tsx', 'a.py', 'a.json', 'a.js.map', 'a.md']) assert.ok(!sc.EXTENSOES.test(n), n);
});
