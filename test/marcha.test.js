'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const glob = require('../scripts/lib/glob.js');
const caminho = require('../scripts/lib/caminho.js');
const marcha = require('../scripts/lib/marcha.js');

test('glob: * nao atravessa barra', () => {
  assert.ok(glob.casa('src/*.js', 'src/a.js', false));
  assert.ok(!glob.casa('src/*.js', 'src/sub/a.js', false));
});

test('glob: **/ casa zero ou mais niveis', () => {
  assert.ok(glob.casa('**/*.md', 'README.md', false));
  assert.ok(glob.casa('**/*.md', 'docs/a.md', false));
  assert.ok(glob.casa('**/*.md', 'a/b/c.md', false));
});

test('glob: ** no fim casa a subarvore inteira', () => {
  assert.ok(glob.casa('Projeto Vizinho/**', 'Projeto Vizinho/a/b.js', false));
  assert.ok(!glob.casa('Projeto Vizinho/**', 'outro/a.js', false));
});

test('glob: ponto e literal, nao coringa', () => {
  assert.ok(glob.casa('a.js', 'a.js', false));
  assert.ok(!glob.casa('a.js', 'axjs', false));
});

test('glob: barra invertida do Windows e normalizada', () => {
  assert.ok(glob.casa('src/**', 'src\\lib\\a.js', false));
});

test('glob: ignorarCaixa faz o casamento ser insensivel', () => {
  assert.ok(glob.casa('SRC/**', 'src/a.js', true));
  assert.ok(!glob.casa('SRC/**', 'src/a.js', false));
});

test('caminho: absoluto vira relativo POSIX ao projeto', () => {
  const cwd = process.platform === 'win32' ? 'C:\\proj' : '/proj';
  const alvo = process.platform === 'win32' ? 'C:\\proj\\src\\a.js' : '/proj/src/a.js';
  assert.strictEqual(caminho.relativoAoProjeto(alvo, cwd), 'src/a.js');
});

test('caminho: arquivo fora do projeto devolve null', () => {
  const cwd = process.platform === 'win32' ? 'C:\\proj' : '/proj';
  const fora = process.platform === 'win32' ? 'C:\\outro\\a.js' : '/outro/a.js';
  assert.strictEqual(caminho.relativoAoProjeto(fora, cwd), null);
});

test('caminho: entrada vazia devolve null', () => {
  assert.strictEqual(caminho.relativoAoProjeto(undefined, '/proj'), null);
  assert.strictEqual(caminho.relativoAoProjeto('', '/proj'), null);
});

// ---------------------------------------------------- F2-21 (D334)
// Junction (link de pasta) no Windows nao pede privilegio; em POSIX o tipo e ignorado e vira link comum.
function tmp(prefixo) { return fs.mkdtempSync(path.join(os.tmpdir(), prefixo)); }

function ligar(alvo, link) {
  try { fs.symlinkSync(alvo, link, 'junction'); return null; } catch (e) { return e && e.code; }
}

test('caminho/F2-21: dentroPeloCaminhoReal acompanha o link, e relativoAoProjeto continua lexico (D334)', (t) => {
  const dir = tmp('sworn-caminho-');
  const fora = tmp('sworn-caminho-fora-');
  try {
    fs.writeFileSync(path.join(fora, 'segredo.md'), 'x', 'utf8');
    fs.writeFileSync(path.join(dir, 'a.js'), 'x', 'utf8');
    const erro = ligar(fora, path.join(dir, 'L'));
    if (erro) { t.skip('nao deu para criar link neste disco/usuario (' + erro + ')'); return; }
    // O link vive DENTRO do projeto e aponta para FORA: pelo caminho real o arquivo e de fora.
    assert.strictEqual(caminho.dentroPeloCaminhoReal('L/segredo.md', dir), false, 'link para fora nao e dentro');
    assert.strictEqual(caminho.dentroPeloCaminhoReal(path.join(dir, 'L', 'segredo.md'), dir), false);
    // Controle: o arquivo normal segue dentro, por caminho relativo e por absoluto.
    assert.strictEqual(caminho.dentroPeloCaminhoReal('a.js', dir), true);
    assert.strictEqual(caminho.dentroPeloCaminhoReal(path.join(dir, 'a.js'), dir), true);
    // Arquivo que ainda nao existe: sem realpath, vale o caminho escrito.
    assert.strictEqual(caminho.dentroPeloCaminhoReal('novo/b.js', dir), true);
    assert.strictEqual(caminho.dentroPeloCaminhoReal(path.join(fora, 'novo.js'), dir), false);
    // D334: o portao de escopo depende do relativoAoProjeto, que NAO muda - segue lexico.
    assert.strictEqual(caminho.relativoAoProjeto('L/segredo.md', dir), 'L/segredo.md');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(fora, { recursive: true, force: true });
  }
});

test('caminho/F2-21: cwd aberto por link e arquivo pelo caminho real: dentro (o caso oposto)', (t) => {
  const real = tmp('sworn-caminho-real-');
  const base = tmp('sworn-caminho-base-');
  try {
    fs.writeFileSync(path.join(real, 'p.md'), 'x', 'utf8');
    const porLink = path.join(base, 'J');
    const erro = ligar(real, porLink);
    if (erro) { t.skip('nao deu para criar link neste disco/usuario (' + erro + ')'); return; }
    assert.strictEqual(caminho.dentroPeloCaminhoReal(path.join(fs.realpathSync(real), 'p.md'), porLink), true);
    assert.strictEqual(caminho.dentroPeloCaminhoReal('p.md', porLink), true);
  } finally {
    fs.rmSync(real, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('caminho/F2-21: entrada vazia, nao-texto e o proprio projeto nao sao "dentro"', () => {
  const dir = tmp('sworn-caminho-');
  try {
    for (const v of [undefined, null, '', 7, {}]) assert.strictEqual(caminho.dentroPeloCaminhoReal(v, dir), false, String(v));
    assert.strictEqual(caminho.dentroPeloCaminhoReal('a.js', ''), false);
    assert.strictEqual(caminho.dentroPeloCaminhoReal(dir, dir), false, 'o projeto em si nao e um arquivo dele');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const PROJETO = {
  marchaPadrao: 'padrao',
  marchas: {
    aaa: ['**/auth/**', 'manifest.json'],
    padrao: ['src/**', 'scripts/**'],
    rapida: ['**/*.md', 'docs/**']
  }
};

test('marcha: AAA vence quando o caminho casa em mais de uma lista', () => {
  assert.strictEqual(marcha.resolverMarcha('src/auth/token.js', PROJETO), 'aaa');
});

test('marcha: caminho de doc e rapida', () => {
  assert.strictEqual(marcha.resolverMarcha('docs/plano-v1.md', PROJETO), 'rapida');
});

test('marcha: caminho nao listado cai na marchaPadrao', () => {
  assert.strictEqual(marcha.resolverMarcha('outro/x.txt', PROJETO), 'padrao');
});

test('marcha: sem projeto, o default e padrao', () => {
  assert.strictEqual(marcha.resolverMarcha('qualquer.txt', null), 'padrao');
});

test('marcha: so padrao e AAA exigem escopo declarado', () => {
  assert.strictEqual(marcha.exigeEscopo('rapida'), false);
  assert.strictEqual(marcha.exigeEscopo('padrao'), true);
  assert.strictEqual(marcha.exigeEscopo('aaa'), true);
});

test('marcha: D8 - sobe sim, desce nao', () => {
  assert.ok(marcha.podeSubir('padrao', 'aaa'));
  assert.ok(marcha.podeSubir('padrao', 'padrao'));
  assert.ok(!marcha.podeSubir('aaa', 'padrao'));
  assert.ok(!marcha.podeSubir('padrao', 'rapida'));
});

// Plano 082, Tarefa 6 (p8-25): no Windows Src/A.js e src/a.js sao o mesmo arquivo e contavam duas vezes.
test('082 T6 (p8-25): aaaComReferencia junta a mesma grafia em caixa diferente onde o disco nao distingue caixa', () => {
  const raiz = path.join(os.tmpdir(), 'sworn-marcha-caixa');
  const projeto = { marchas: { aaa: ['**'] }, referencias: { codigo: ['ref/topo.js'] } };
  const r = marcha.aaaComReferencia([path.join(raiz, 'src', 'a.js'), path.join(raiz, 'Src', 'A.js'),
    path.join(raiz, 'src', 'b.js')], projeto, raiz);
  const caixaIgual = process.platform === 'win32';
  assert.deepStrictEqual(r, caixaIgual ? ['src/a.js', 'src/b.js'] : ['src/a.js', 'Src/A.js', 'src/b.js']);
});
