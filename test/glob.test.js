'use strict';
const test = require('node:test');
const assert = require('node:assert');
const glob = require('../scripts/lib/glob.js');

// D420/TS-05: glob.js decide escopo, intocaveis e marchas. As ancoras do regex, a
// normalizacao de './' e a caixa sobreviviam a mutantes porque nao havia teste proprio.

test('glob: ancora no INICIO - o padrao nao casa no meio do caminho', () => {
  assert.strictEqual(glob.casa('src/**', 'src/a.js'), true);
  assert.strictEqual(glob.casa('src/**', 'vendor/src/x.js'), false);
  assert.strictEqual(glob.casa('segredos/**', 'segredos/k.txt'), true);
  assert.strictEqual(glob.casa('segredos/**', 'public/segredos/x'), false);
});

test('glob: ancora no FIM - o padrao nao casa um prefixo do caminho', () => {
  assert.strictEqual(glob.casa('src/a.js', 'src/a.js'), true);
  assert.strictEqual(glob.casa('src/a.js', 'src/a.js.bak'), false);
  assert.strictEqual(glob.casa('*.md', 'nota.md.old'), false);
  assert.strictEqual(glob.casa('src/*', 'src/a/b'), false);
});

test('glob: "**/" aceita zero niveis de diretorio e muitos', () => {
  assert.strictEqual(glob.casa('**/auth/**', 'auth/login.js'), true, 'zero niveis antes');
  assert.strictEqual(glob.casa('**/auth/**', 'src/auth/login.js'), true);
  assert.strictEqual(glob.casa('**/auth/**', 'a/b/c/auth/x/y.js'), true);
  assert.strictEqual(glob.casa('**/*.md', 'README.md'), true, 'zero niveis para um arquivo na raiz');
  assert.strictEqual(glob.casa('**/*.md', 'docs/a/b.md'), true);
  assert.strictEqual(glob.casa('**/auth/**', 'src/author/x.js'), false, 'auth tem de ser um nivel inteiro');
});

test('glob: "*" nao cruza "/" e "**" cruza', () => {
  assert.strictEqual(glob.casa('src/*.js', 'src/a.js'), true);
  assert.strictEqual(glob.casa('src/*.js', 'src/sub/a.js'), false);
  assert.strictEqual(glob.casa('src/**', 'src/sub/fundo/a.js'), true);
  assert.strictEqual(glob.casa('a**b', 'a/x/b'), true);
});

test('glob: caractere especial do regex e literal', () => {
  assert.strictEqual(glob.casa('a.js', 'a.js'), true);
  assert.strictEqual(glob.casa('a.js', 'axjs'), false, '"." nao pode virar "qualquer caractere"');
  assert.strictEqual(glob.casa('a+b(1).js', 'a+b(1).js'), true);
  assert.strictEqual(glob.casa('a?.js', 'ab.js'), false, '"?" e literal, nao curinga');
});

test('glob: "./" da frente e "\\" sao normalizados, no padrao e no caminho', () => {
  assert.strictEqual(glob.casa('./src/a.js', 'src/a.js'), true, './ no padrao');
  assert.strictEqual(glob.casa('src/a.js', './src/a.js'), true, './ no caminho');
  assert.strictEqual(glob.casa('src/**', 'src\\sub\\a.js'), true, 'barra invertida no caminho');
  assert.strictEqual(glob.casa('src\\sub\\*.js', 'src/sub/a.js'), true, 'barra invertida no padrao');
  assert.strictEqual(glob.casa('src/a.js', '/src/a.js'), true, 'barra sobrando no comeco');
  assert.strictEqual(glob.normalizar('./a/b'), 'a/b');
  assert.strictEqual(glob.normalizar('.\\a\\b'), 'a/b');
  assert.strictEqual(glob.normalizar(null), '');
  // so o "./" da FRENTE: um "./" no meio nao e tocado
  assert.strictEqual(glob.normalizar('a/./b'), 'a/./b');
});

test('glob: caixa conforme a opcao explicita (e a plataforma quando omitida)', () => {
  assert.strictEqual(glob.casa('Src/A.js', 'src/a.js', true), true, 'ignorarCaixa=true');
  assert.strictEqual(glob.casa('Src/A.js', 'src/a.js', false), false, 'ignorarCaixa=false');
  assert.strictEqual(glob.casa('src/a.js', 'src/a.js', false), true);
  // omitida: segue a plataforma (win32 ignora caixa)
  assert.strictEqual(glob.casa('Src/A.js', 'src/a.js'), process.platform === 'win32');
  assert.strictEqual(glob.casaAlgum(['x/**', 'Src/**'], 'src/a.js', true), true);
  assert.strictEqual(glob.casaAlgum(['x/**', 'Src/**'], 'src/a.js', false), false);
});

test('glob: padrao vazio ou lista que nao e lista nao casa nada', () => {
  assert.strictEqual(glob.casa('', 'a'), false);
  assert.strictEqual(glob.casa(null, 'a'), false);
  assert.strictEqual(glob.casaAlgum(undefined, 'a'), false);
  assert.strictEqual(glob.casaAlgum('src/**', 'src/a'), false);
  assert.strictEqual(glob.casaAlgum([], 'a'), false);
  assert.strictEqual(glob.casaAlgum(['x', 'src/**'], 'src/a'), true);
});

// A2-27 (pedido 12): o aparo valia tambem no caminho, e 'a ' casava o 'a' declarado. Sao arquivos distintos: o Node
// grava 'a ' e 'a.' com o nome inteiro tambem no Windows (sonda s204). O padrao, escrito a mao, segue aparado.
test('A2-27: o padrao e aparado e o caminho nao', () => {
  assert.strictEqual(glob.casa('a', 'a '), false, 'caminho com espaco no fim e outro arquivo');
  assert.strictEqual(glob.casa('src/a.js', ' src/a.js'), false, 'caminho com espaco na frente e outro arquivo');
  assert.strictEqual(glob.casa(' src/a.js ', 'src/a.js'), true, 'espaco na ponta do padrao');
  assert.strictEqual(glob.casa(' ./src/a.js', 'src/a.js'), true, 'o aparo vem antes de tirar o ./ da frente');
  assert.strictEqual(glob.normalizar(' a '), ' a ', 'normalizar nao apara o caminho');
});

// A2-25: so o omitido segue a plataforma; null e false deixam a caixa sensivel.
test('A2-25: ignorarCaixa null ou false deixa a caixa sensivel', () => {
  assert.strictEqual(glob.casa('Src/A.js', 'src/a.js', null), false);
  assert.strictEqual(glob.casa('Src/A.js', 'src/a.js', 0), false);
  assert.strictEqual(glob.casa('Src/A.js', 'src/a.js', 1), true);
});
