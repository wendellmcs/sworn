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

test('G4e: JS, TS, Apps Script, Python e CSS entram na conta (sem JSX), cada um com o seu leitor', () => {
  for (const n of ['a.js', 'a.mjs', 'a.cjs', 'a.ts', 'a.mts', 'a.cts', 'dir/A.JS', 'Code.gs', 'a.py', 'a.pyi', 'a.pyw',
    'a.css', 'DIR/A.CSS']) assert.ok(sc.EXTENSOES.test(n), n);
  for (const n of ['a.jsx', 'a.tsx', 'a.json', 'a.js.map', 'a.md', 'a.scss', 'a.less', 'a.sh', 'a.html', 'a.pyc',
    'a.css.map', 'a.py.bak', 'a.gsx']) assert.ok(!sc.EXTENSOES.test(n), n);
  assert.strictEqual(sc.leitorDe('x/Code.gs'), sc.codigo);
  assert.strictEqual(sc.leitorDe('a.PY'), sc.codigoPython);
  assert.strictEqual(sc.leitorDe('a.pyi'), sc.codigoPython);
  assert.strictEqual(sc.leitorDe('a.css'), sc.codigoCss);
  assert.strictEqual(sc.leitorDe('a.rb'), null);
  assert.strictEqual(sc.leitorDe(null), null);
  // sem o nome, o leitor de JS (o de antes); com um nome sem leitor, nunca so comentario
  assert.strictEqual(sc.soComentario('f(1); // a', 'f(1); // b'), true);
  assert.strictEqual(sc.soComentario('x = 1 # a', 'x = 1 # b', 'a.rb'), false);
  assert.strictEqual(sc.soComentario('x = 1', 'x = 1', 'a.rb'), false, 'nem igual');
});

test('G4e: o .gs (Apps Script) passa pelo leitor de JS', () => {
  assert.strictEqual(sc.soComentario('f(1); // a\n', 'f(1); /* b */\n', 'Code.gs'), true);
  assert.strictEqual(sc.soComentario('f(1);\n', 'f(2);\n', 'Code.gs'), false);
  assert.strictEqual(sc.soComentario('x = 1 # a\n', 'x = 1 # b\n', 'Code.gs'), false, 'o # nao e comentario no JS');
});

const PY = [
  '#!/usr/bin/env python3',
  '# cabecalho',
  'import os',
  '',
  'def f(x):',
  '    """A doc."""',
  '    s = "a # nao e comentario"  # de linha',
  '    t = f"# {x!r:>10} {{literal}} {os.sep}" + rb\'\\x\'',
  '    return [',
  '        x,  # dentro do colchete',
  '        2,',
  '    ] + \\',
  '        [s, t]  # depois da barra',
  ''
].join('\n');

test('G4e: Python com comentario, linha em branco e espaco mudados e so comentario', () => {
  const casos = [
    PY.replace('# cabecalho', '# cabecalho reescrito'),
    PY.replace('  # de linha', ''),
    PY.replace('import os\n', 'import os\n\n\n    # antes da funcao, com outro recuo\n'),
    PY.replace('# dentro do colchete', '# outro\n        # mais um'),
    PY.replace('s = "a', 's   =   "a'),
    PY.replace('# depois da barra', '# mudado'),
    PY.split('\n').join('\r\n'),
    PY + '\n\n# fim\n',
    // dentro do colchete o recuo nao e sintaxe
    PY.replace('        2,', '    2,')
  ];
  casos.forEach(function (depois, i) { assert.strictEqual(sc.soComentario(PY, depois, 'a.py'), true, 'caso ' + i + ':\n' + depois); });
  // a chave dobrada da f-string e texto, e nao campo: o # dela e da string
  assert.strictEqual(sc.soComentario('s = f"{{#}}"  # a\n', 's = f"{{#}}"  # b\n', 'a.py'), true, 'a chave dobrada');
  // a codificacao UTF-8 declarada nao muda a leitura; a da linha 3 o Python nao le (PEP 263: linha 1 ou 2)
  assert.strictEqual(sc.soComentario('# -*- coding: utf-8 -*-\nx = 1\n', '# -*- coding: utf-8 -*-\nx = 1  # b\n', 'a.py'),
    true, 'utf-8 declarado');
  assert.strictEqual(sc.soComentario('x = 1\ny = 2\n# coding: latin-1\n', 'x = 1  # b\ny = 2\n# coding: latin-1\n', 'a.py'),
    true, 'a codificacao fora das linhas 1 e 2');
  // o BOM nos dois lados e o mesmo texto (o BOM que entra fica no teste do nao)
  const bom = String.fromCharCode(0xfeff);
  assert.strictEqual(sc.soComentario(bom + 'x = 1\n', bom + 'x = 1  # b\n', 'a.py'), true, 'o BOM nos dois lados');
});

test('G4e: Python com recuo, codigo, string, docstring ou diretiva mudados nao e so comentario', () => {
  const casos = [
    ['o recuo', PY.replace('    """A doc."""', '\t"""A doc."""')],
    ['o codigo', PY.replace('2,', '3,')],
    ['o # dentro da string', PY.replace('# nao e comentario"', '# outro texto"')],
    ['o # dentro da f-string', PY.replace('f"# {x', 'f"#! {x')],
    ['a docstring', PY.replace('A doc.', 'Outra doc.')],
    ['a diretiva noqa', PY.replace('# de linha', '# noqa: E501')],
    ['a diretiva type', PY.replace('# cabecalho', '# type: ignore')],
    ['o shebang', PY.replace('python3', 'python2')],
    ['o comentario que entra depois da barra', PY.replace('] + \\\n', '] + \\\n        # quebra a linha\n')],
    // o shebang so vale na linha 1: o que desce dela deixa de ser lido pelo sistema
    ['o shebang que desce da linha 1', '\n' + PY],
    ['o comentario que entra antes do shebang', '# novo\n' + PY],
    // o leitor nao tira o BOM: o que entra muda o texto, e na duvida vai a revisao
    ['o BOM que entra', String.fromCharCode(0xfeff) + PY]
  ];
  for (const [nome, depois] of casos) assert.strictEqual(sc.soComentario(PY, depois, 'a.py'), false, nome);
  // a aspa de fora dentro do campo da f-string (Python 3.12) o leitor nao le (null, no teste abaixo): se tomasse o #
  // por comentario, os dois lados sairiam iguais
  assert.strictEqual(sc.soComentario('s = f"{d["#"]}"\n', 's = f"{d["#"]}" + 1\n', 'a.py'), false, 'a aspa de fora no campo');
});

test('G4e: no Python, na duvida o leitor diz null', () => {
  for (const [nome, texto] of [
    ['string sem fecho', 's = "abc\n'],
    ['string longa sem fecho', 's = """abc\n'],
    ['colchete sem fecho', 'x = [1,\n'],
    ['colchete que fecha demais', 'x = 1)\n'],
    ['colchete trocado', 'x = [1)\n'],
    ['barra invertida no fim do arquivo', 'x = 1 \\'],
    ['barra invertida no meio da linha', 'x = 1 \\ + 2\n'],
    ['chave solta na f-string', 's = f"a}b"\n'],
    ['campo da f-string sem fecho', 's = f"{x"\n'],
    ['comentario no campo da f-string', 's = f"""{x # c\n}"""\n'],
    ['aspa de fora no campo da f-string', 's = f"{d["k"]}"\n'],
    ['string longa da outra aspa no campo', "s = f\"{'''x'''}\"\n"],
    ['barra invertida no campo da f-string', 's = f"{a\\\nb}"\n'],
    ['o \\N da f-string', 's = f"\\N{DASH}"\n'],
    ['arquivo que nao e UTF-8', 's = "' + String.fromCharCode(0xfffd) + '"\n'],
    // no UTF-7 o `+AAo-` e uma quebra: o texto do comentario vira codigo que roda
    ['codificacao UTF-7 declarada', '# coding: utf-7\n# x +AAo-print(1)\n'],
    ['codificacao latin-1 na linha 2', '#!/usr/bin/python\n# -*- coding: latin-1 -*-\nx = 1\n'],
    ['nao e texto', null],
    ['nao e texto (undefined)', undefined]
  ]) {
    assert.strictEqual(sc.codigoPython(texto), null, nome);
    assert.strictEqual(sc.soComentario(texto, texto, 'a.py'), false, nome + ' (mesmo igual)');
  }
  // o leitor de Python sai em JSON (a lista das linhas logicas): o vazio e a lista vazia
  assert.strictEqual(sc.codigoPython(''), '[]', 'o vazio');
  assert.strictEqual(sc.soComentario('', '# so comentario\n', 'a.py'), true);
});

const CSS = [
  '/* cabecalho */',
  '.a > .b, .c:hover {',
  '  color: #fff; /* branco */',
  '  background: url(img/x.png) no-repeat;',
  '  content: "/* nao e comentario */";',
  '}',
  ''
].join('\n');

test('G4e: CSS com comentario e espaco mudados e so comentario', () => {
  const casos = [
    CSS.replace('/* cabecalho */', '/* outro\n   cabecalho */'),
    CSS.replace(' /* branco */', ''),
    CSS.replace('color: #fff;', 'color:   #fff;'),
    CSS.replace('.a > .b', '.a /* x */ > .b'),
    CSS.split('\n').join('\r\n'),
    '\n\n' + CSS + '/* fim */\n'
  ];
  casos.forEach(function (depois, i) { assert.strictEqual(sc.soComentario(CSS, depois, 'a.css'), true, 'caso ' + i + ':\n' + depois); });
  assert.strictEqual(sc.soComentario('a b{}', 'a /* x */ b{}', 'a.css'), true);
  const bom = String.fromCharCode(0xfeff);
  assert.strictEqual(sc.soComentario(bom + 'a{}\n', bom + 'a{} /* b */\n', 'a.css'), true, 'o BOM nos dois lados');
});

test('G4e: CSS com seletor, valor, string, url ou escape mudados nao e so comentario', () => {
  const casos = [
    ['o seletor', CSS.replace('.c:hover', '.c :hover')],
    ['o valor', CSS.replace('#fff', '#ffe')],
    ['a string com /*', CSS.replace('nao e comentario', 'outro')],
    ['a url', CSS.replace('img/x.png', 'img/y.png')],
    ['o BOM que entra', String.fromCharCode(0xfeff) + CSS]
  ];
  for (const [nome, depois] of casos) assert.strictEqual(sc.soComentario(CSS, depois, 'a.css'), false, nome);
  assert.strictEqual(sc.soComentario('ab{}', 'a/**/b{}', 'a.css'), false, 'o comentario que separa dois nomes');
  assert.strictEqual(sc.soComentario('a{b:url(x/*y*/z)}', 'a{b:url(x/*w*/z)}', 'a.css'), false, 'o /* dentro da url');
  assert.strictEqual(sc.soComentario('.a\\31 23{}', '.a\\31  23{}', 'a.css'), false, 'o espaco que fecha o escape');
  // o comentario que uma ferramenta le (minificador, lint, mapa, rtl) conta como codigo, como no JS
  for (const d of ['/*! licenca */', '/* stylelint-disable */', '/*# sourceMappingURL=a.css.map */', '/* rtl:ignore */']) {
    assert.strictEqual(sc.soComentario(CSS, CSS.replace('/* branco */', d), 'a.css'), false, d);
  }
});

test('G4e: no CSS, na duvida o leitor diz null', () => {
  for (const [nome, texto] of [
    ['@charset', '@charset "utf-8";\na{}'],
    ['@CHARSET', '@CHARSET "utf-8";\na{}'],
    ['comentario sem fecho', 'a{} /* x'],
    ['string com quebra', 'a{content:"x\ny"}'],
    ['string sem fecho', 'a{content:"x'],
    ['nome escapado antes do parentese', 'a{b:u\\72l(x)}'],
    ['aspa no meio da url', 'a{b:url(x"y)}'],
    ['parentese no meio da url', 'a{b:url(x(y)}'],
    ['espaco no meio da url', 'a{b:url(x y)}'],
    ['url sem fecho', 'a{b:url(x'],
    ['barra invertida antes da quebra', 'a\\\n{}'],
    ['barra invertida no fim', 'a\\'],
    ['arquivo que nao e UTF-8', 'a{content:"' + String.fromCharCode(0xfffd) + '"}'],
    ['nao e texto', null],
    ['nao e texto (undefined)', undefined]
  ]) {
    assert.strictEqual(sc.codigoCss(texto), null, nome);
    assert.strictEqual(sc.soComentario(texto, texto, 'a.css'), false, nome + ' (mesmo igual)');
  }
  assert.strictEqual(sc.codigoCss(''), '', 'o vazio');
  assert.strictEqual(sc.codigoCss('a{b:url( "x" )}'), 'a{b:url( "x" )}', 'a url com aspas e funcao comum');
  assert.strictEqual(sc.codigoCss('a{b:url( x/*y*/z )}'), 'a{b:url( x/*y*/z )}', 'o espaco da borda da url sem aspas');
});
