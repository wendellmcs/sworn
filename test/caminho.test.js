'use strict';
// Pendencia #10 (s372, 0.40.0): caminho.apagarPasta, o apagar de pasta do produto. No Windows (Node 24) o fs.rmSync
// recursivo volta sem erro e deixa a pasta com acento no caminho; o resto sai item por item.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const comum = require('./lib/comum.js');
const caminho = require('../scripts/lib/caminho.js');

/** Arvore com acento no nome, subpasta, arquivo comum e arquivo somente-leitura (como o objeto do .git). */
function arvore(base) {
  const dir = path.join(base, 'histórico ação');
  fs.mkdirSync(path.join(dir, 'sub pasta', 'mais funda'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'nota.md'), 'a\n');
  fs.writeFileSync(path.join(dir, 'sub pasta', 'mais funda', 'ç.txt'), 'b\n');
  const so = path.join(dir, 'sub pasta', 'objeto');
  fs.writeFileSync(so, 'c\n');
  fs.chmodSync(so, 0o444);
  return dir;
}

/** O rmSync do Windows com acento: volta sem erro e sem apagar nada. */
function rmSyncQueNaoApaga(t) { t.mock.method(fs, 'rmSync', function () {}); }

test('#10 apagarPasta: a pasta com acento sai inteira, com subpasta e arquivo somente-leitura', () => {
  const dir = arvore(comum.temporaria('sworn caminho ação-'));
  caminho.apagarPasta(dir);
  assert.strictEqual(fs.existsSync(dir), false, 'a pasta com acento ficou no disco');
});

test('#10 apagarPasta: a pasta que nao existe volta sem erro, como o force do rmSync', () => {
  const dir = path.join(comum.temporaria('sworn caminho vazio-'), 'nunca criada');
  caminho.apagarPasta(dir);
  assert.strictEqual(fs.existsSync(dir), false);
});

test('#10 apagarPasta: caminho vazio ou que nao e texto e recusado antes de tocar o disco', (t) => {
  const rm = t.mock.method(fs, 'rmSync', function () {});
  ['', '   ', undefined, null, 42].forEach(function (ruim) {
    assert.throws(function () { caminho.apagarPasta(ruim); }, TypeError, JSON.stringify(ruim) + ' passou');
  });
  assert.strictEqual(rm.mock.callCount(), 0, 'chamou o rmSync com caminho vazio (o \'\' viraria a pasta atual)');
});

test('#10 apagarPasta: o rmSync que volta sem apagar nada cai no item por item, sem seguir a juncao', (t) => {
  const base = comum.temporaria('sworn caminho juncao-');
  const fora = path.join(base, 'fora');
  fs.mkdirSync(fora);
  const guardado = path.join(fora, 'guardado.txt');
  fs.writeFileSync(guardado, 'nao apague\n');
  const dir = arvore(base);
  fs.symlinkSync(fora, path.join(dir, 'atalho'), 'junction');
  rmSyncQueNaoApaga(t);
  caminho.apagarPasta(dir);
  assert.strictEqual(fs.existsSync(dir), false, 'o item por item deixou a pasta');
  assert.strictEqual(fs.existsSync(guardado), true, 'seguiu a juncao e apagou fora');
  assert.strictEqual(fs.readFileSync(guardado, 'utf8'), 'nao apague\n');
});

test('#10 apagarPasta: o item que some no meio do item por item conta como apagado', (t) => {
  const dir = arvore(comum.temporaria('sworn caminho sumiu-'));
  rmSyncQueNaoApaga(t);
  const ler = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', function (alvo) {
    const nomes = ler.apply(fs, arguments);
    return alvo === dir ? nomes.concat('apagado por outro processo.txt') : nomes;
  });
  caminho.apagarPasta(dir);
  assert.strictEqual(fs.existsSync(dir), false, 'o ENOENT do item que sumiu parou o item por item');
});

test('#10 apagarPasta: o erro do rmSync sobe igual e a pasta fica (quem chama trata o EBUSY)', (t) => {
  const dir = arvore(comum.temporaria('sworn caminho preso-'));
  const preso = Object.assign(new Error('arquivo preso de mentira'), { code: 'EBUSY' });
  t.mock.method(fs, 'rmSync', function () { throw preso; });
  assert.throws(function () { caminho.apagarPasta(dir); }, function (e) { return e === preso; });
  assert.strictEqual(fs.existsSync(path.join(dir, 'nota.md')), true, 'apagou item por item depois do erro do rmSync');
});

test('#10 apagarPasta: o erro do item por item sobe e a pasta fica, para quem chama avisar', (t) => {
  const dir = arvore(comum.temporaria('sworn caminho falha-'));
  rmSyncQueNaoApaga(t);
  t.mock.method(fs, 'rmdirSync', function () { throw Object.assign(new Error('pasta presa de mentira'), { code: 'EBUSY' }); });
  assert.throws(function () { caminho.apagarPasta(dir); }, /pasta presa de mentira/);
  assert.strictEqual(fs.existsSync(dir), true, 'disse que falhou e a pasta sumiu');
});

test('#10 apagarPasta: o rmSync recebe as opcoes de quem chama, sempre com recursive e force', (t) => {
  const rm = t.mock.method(fs, 'rmSync', function () {});
  const base = comum.temporaria('sworn caminho opcoes-');
  caminho.apagarPasta(path.join(base, 'nao existe'), { maxRetries: 5, retryDelay: 200, recursive: false });
  caminho.apagarPasta(path.join(base, 'nao existe'));
  assert.deepStrictEqual(rm.mock.calls.map(function (c) { return c.arguments[1]; }), [
    { maxRetries: 5, retryDelay: 200, recursive: true, force: true },
    { recursive: true, force: true }
  ]);
});

/** Os argumentos de cada chamada `rmSync(` do texto, ate o parentese que fecha (a chamada pode ter varias linhas). */
function chamadasDoRmSync(texto) {
  const achadas = [];
  const re = /\brmSync\s*\(/g;
  let m;
  while ((m = re.exec(texto))) {
    let fundo = 1;
    let i = re.lastIndex;
    while (i < texto.length && fundo > 0) {
      if (texto[i] === '(') fundo++;
      else if (texto[i] === ')') fundo--;
      i++;
    }
    achadas.push({ linha: texto.slice(0, m.index).split('\n').length, args: texto.slice(re.lastIndex, i - 1) });
  }
  return achadas;
}

/** A posicao da primeira virgula de cima dos argumentos (a de dentro do path.join(a, b) ou de um texto nao conta). */
function virgulaDeCima(args) {
  let fundo = 0;
  let aspa = null;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (aspa) {
      if (c === '\\') i++;
      else if (c === aspa) aspa = null;
    } else if (c === '\'' || c === '"' || c === '`') aspa = c;
    else if ('([{'.includes(c)) fundo++;
    else if (')]}'.includes(c)) fundo--;
    else if (c === ',' && fundo === 0) return i;
  }
  return -1;
}

/** O rmSync de pasta: o que tem `recursive` nos argumentos, ou opcoes que nao sao um objeto escrito ali. */
function apagaPasta(args) {
  const virgula = virgulaDeCima(args);
  if (virgula < 0) return false;
  const opcoes = args.slice(virgula + 1).trim();
  return /\brecursive\b/.test(opcoes) || !/^\{[^}]*\}$/.test(opcoes);
}

test('#10 apagarPasta: a guarda acha o rmSync de pasta em varias linhas e com as opcoes numa variavel', () => {
  const casos = chamadasDoRmSync([
    'fs.rmSync(a, { force: true });',
    'fs.rmSync(trava);',
    'fs.rmSync(b, {\n  recursive: true, force: true });',
    'const o = { recursive: true }; fs.rmSync(c, o);',
    'fs.rmSync(path.join(d, e));',
    'fs.rmSync(path.join(f, \'g,h\'), { force: true });',
    'fs.rmSync(path.join(i, j), o);',
    'fs.rmSync(\'nome, com virgula.tmp\');'
  ].join('\n'));
  assert.deepStrictEqual(casos.map(function (c) { return apagaPasta(c.args); }),
    [false, false, true, true, false, false, true, false]);
  assert.deepStrictEqual(casos.map(function (c) { return c.linha; }), [1, 2, 3, 5, 6, 7, 8, 9]);
});

test('#10 apagarPasta: nenhum script apaga pasta pelo rmSync direto, so pelo caminho.apagarPasta', () => {
  const scripts = path.join(comum.RAIZ, 'scripts');
  const dele = path.join('lib', 'caminho.js');
  const achados = [];
  fs.readdirSync(scripts, { recursive: true }).forEach(function (rel) {
    if (!/\.js$/.test(rel) || rel === dele) return;
    chamadasDoRmSync(fs.readFileSync(path.join(scripts, rel), 'utf8')).forEach(function (c) {
      if (apagaPasta(c.args)) achados.push(path.join('scripts', rel) + ':' + c.linha);
    });
  });
  assert.deepStrictEqual(achados, [], 'rmSync de pasta fora do caminho.apagarPasta (deixa a pasta com acento no Windows)');
});

// A2-07: o caminho da worktree do subagente isolado vira o caminho de dentro dela; o .claude/ dela, a pasta sozinha, a
// caixa trocada (a pasta do usuario no Linux) e o que nao e worktree nao se trocam
test('caminho A2-07: naWorktreeDoClaude separa a pasta da worktree do caminho de dentro', () => {
  assert.deepStrictEqual(caminho.naWorktreeDoClaude('.claude/worktrees/agent-x/src/a.js'),
    { pasta: '.claude/worktrees/agent-x', rel: 'src/a.js' });
  assert.strictEqual(caminho.naWorktreeDoClaude('.claude/worktrees/agent-x/.claude/sworn/escopo.md'), null);
  assert.strictEqual(caminho.naWorktreeDoClaude('.claude/worktrees/agent-x/.CLAUDE/x'), null);
  assert.strictEqual(caminho.naWorktreeDoClaude('.claude/worktrees/agent-x'), null);
  assert.strictEqual(caminho.naWorktreeDoClaude('.claude/worktrees/agent-x/'), null);
  assert.strictEqual(caminho.naWorktreeDoClaude('.Claude/Worktrees/agent-x/src/a.js'), null);
  assert.strictEqual(caminho.naWorktreeDoClaude('src/.claude/worktrees/x/a.js'), null);
  assert.strictEqual(caminho.naWorktreeDoClaude(undefined), null);
});
