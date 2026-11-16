'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gitLib = require('../scripts/lib/git.js');

/**
 * F5a (diagnostico de 2026-11-10, secao F): o git era chamado por spawnSync em 13 lugares, com prazo, teto de saida,
 * shell e tratamento de erro diferentes em cada um. `rodar` e o unico spawn do git; os outros passam por ele.
 */

const RAIZ = path.join(__dirname, '..');

test('F5a: rodar devolve o resultado do spawn, com stdout em texto, e ok() diz se deu certo', () => {
  const r = gitLib.rodar(RAIZ, ['--version']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /^git version /);
  assert.strictEqual(gitLib.ok(r), true);
  // revisao cega: falha em qualquer pasta (o rev-parse --show-toplevel sai 0 se o tmpdir do CI estiver num repositorio)
  const fora = gitLib.rodar(RAIZ, ['rev-parse', '--verify', '--quiet', 'refs/sworn/nao-existe-' + process.pid]);
  assert.notStrictEqual(fora.status, 0);
  assert.strictEqual(gitLib.ok(fora), false);
  assert.strictEqual(gitLib.ok(null), false);
  assert.strictEqual(gitLib.ok({ status: 0, stdout: null }), false, 'stdout que nao e texto nao e sucesso');
  assert.strictEqual(gitLib.ok({ status: 0, stdout: '', error: new Error('x') }), false, 'erro com status 0 nao e sucesso');
});

test('F5a: rodar roda sem shell - argumento com espaco chega inteiro ao git', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-git-espaco-'));
  try {
    fs.writeFileSync(path.join(pasta, 'arquivo com espaco.cfg'), '[sworn]\n\tchave = achou\n');
    const r = gitLib.rodar(pasta, ['config', '--file', 'arquivo com espaco.cfg', '--get', 'sworn.chave']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout.trim(), 'achou');
  } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('F5a: rodar nunca lanca - pasta que nao existe, prazo e teto de saida voltam como erro no resultado', () => {
  const sumida = path.join(os.tmpdir(), 'sworn-git-sumida-' + process.pid + '-' + Date.now());
  const r = gitLib.rodar(sumida, ['--version']);
  assert.ok(r.error, 'pasta que nao existe vira r.error');
  assert.strictEqual(gitLib.ok(r), false);
  // 1 ms nao da para abrir um processo: o prazo sempre estoura (revisao cega: o `if` deixava o caso sem prova).
  const lento = gitLib.rodar(RAIZ, ['--version'], { timeout: 1 });
  assert.strictEqual(lento.error && lento.error.code, 'ETIMEDOUT');
  const grande = gitLib.rodar(RAIZ, ['--version'], { maxBuffer: 1 });
  assert.strictEqual(grande.error && grande.error.code, 'ENOBUFS', 'maxBuffer de 1 byte: o teto de saida volta como erro');
  const ruim = gitLib.rodar(RAIZ, ['--version\0']);
  assert.ok(ruim.error, 'argumento com byte nulo faz o spawnSync lancar; rodar devolve o erro');
  assert.strictEqual(ruim.status, null);
  assert.strictEqual(ruim.stdout, '');
});

test('F5a: a saida padrao passa de 1 MiB (o padrao do spawnSync) sem virar ENOBUFS', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-git-grande-'));
  try {
    fs.writeFileSync(path.join(pasta, 'vazio'), '');
    fs.writeFileSync(path.join(pasta, 'grande'), 'linha de teste\n'.repeat(160000)); // ~2,2 MiB
    const r = gitLib.rodar(pasta, ['diff', '--no-index', '--no-color', '--', 'vazio', 'grande']);
    assert.strictEqual(r.error, undefined, r.error && r.error.code);
    assert.strictEqual(r.status, 1, 'diff --no-index sai 1 quando ha diferenca');
    assert.ok(r.stdout.length > 2 * 1024 * 1024, 'esperava mais de 2 MiB (2097152 bytes); saiu ' + r.stdout.length);
    assert.strictEqual(gitLib.SAIDA_PADRAO_BYTES, 64 * 1024 * 1024);
  } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('F5a: rodar soma o env pedido ao do processo (o PATH segue)', () => {
  const r = gitLib.rodar(RAIZ, ['var', 'GIT_AUTHOR_IDENT'],
    { env: { GIT_AUTHOR_NAME: 'Fulano Teste', GIT_AUTHOR_EMAIL: 'fulano.teste' } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Fulano Teste <fulano\.teste>/);
});

test('F5a: rodar entrega ao spawnSync o prazo e a saida padrao finitos e o env somado (espiao no cp.spawnSync)', () => {
  // A mutacao mostrou: sem maxBuffer o spawnSync nao tem limite e sem PATH o Windows ainda acha o git, entao so a
  // configuracao entregue prova o padrao. rodar le cp.spawnSync na hora da chamada, por isso o espiao pega.
  const cp = require('node:child_process');
  const original = cp.spawnSync;
  const vistos = [];
  cp.spawnSync = function (cmd, args, config) { vistos.push(config); return { status: 0, stdout: '', stderr: '' }; };
  try {
    gitLib.rodar(RAIZ, ['status']);
    gitLib.rodar(RAIZ, ['status'], { timeout: 0, env: { SWORN_TESTE_ENV: 'x' } });
  } finally { cp.spawnSync = original; }
  assert.strictEqual(vistos[0].maxBuffer, gitLib.SAIDA_PADRAO_BYTES);
  assert.strictEqual(vistos[0].timeout, 20000);
  assert.strictEqual(vistos[0].shell, false);
  assert.strictEqual(vistos[0].env, undefined, 'sem opcoes.env herda o do processo');
  assert.strictEqual(vistos[1].timeout, 20000, 'timeout 0 vira o padrao, nunca "sem limite"');
  assert.strictEqual(vistos[1].env.SWORN_TESTE_ENV, 'x');
  assert.strictEqual(vistos[1].env.PATH || vistos[1].env.Path, process.env.PATH || process.env.Path);
});

test('F5a: correr segue o contrato antigo (texto ou null) por cima de rodar', () => {
  assert.strictEqual(typeof gitLib.correr(RAIZ, ['--version']), 'string');
  assert.strictEqual(gitLib.correr(RAIZ, ['--version'], { maxBuffer: 1 }), null);
  assert.strictEqual(gitLib.correr(path.join(os.tmpdir(), 'sworn-git-sumida-' + process.pid), ['--version']), null);
});

// F1g (s372, 0.39.0): o prazo padrao do correr (5 s) vem do SWORN_GIT_PRAZO_MS quando e inteiro positivo; o pedido
// em opcoes ganha dele. Na suite carregada os 5 s estouravam e o portao de commit liberava (falso vermelho).
test('F1g: o prazo padrao do correr e 5 s, ou o SWORN_GIT_PRAZO_MS inteiro positivo; o timeout pedido ganha', () => {
  const cp = require('node:child_process');
  const original = cp.spawnSync;
  const antes = process.env.SWORN_GIT_PRAZO_MS;
  const prazos = [];
  cp.spawnSync = function (cmd, args, config) { prazos.push(config.timeout); return { status: 0, stdout: '', stderr: '' }; };
  const com = function (valor, opcoes) {
    if (valor === undefined) delete process.env.SWORN_GIT_PRAZO_MS; else process.env.SWORN_GIT_PRAZO_MS = valor;
    gitLib.correr(RAIZ, ['status'], opcoes);
    return prazos[prazos.length - 1];
  };
  try {
    assert.strictEqual(com(undefined), 5000, 'sem a variavel');
    assert.strictEqual(com('60000'), 60000);
    assert.strictEqual(com(' 7000 '), 7000, 'espaco nas pontas');
    assert.strictEqual(com('3000000000'), 3000000000, 'sem teto abaixo do inteiro seguro (o spawnSync aceita)');
    for (const ruim of ['', '   ', '0', '-5', 'abc', '1.5', '1e4', '30000ms', '99999999999999999999']) {
      assert.strictEqual(com(ruim), 5000, 'aceitou ' + JSON.stringify(ruim));
    }
    assert.strictEqual(com('60000', { timeout: 300 }), 300, 'o timeout pedido ganha da variavel');
  } finally {
    cp.spawnSync = original;
    if (antes === undefined) delete process.env.SWORN_GIT_PRAZO_MS; else process.env.SWORN_GIT_PRAZO_MS = antes;
  }
});

// O guarda da duplicacao: um spawn de git fora do lib/git.js volta a espalhar prazo, teto e erro diferentes.
test('F5a: nenhum script chama o git por spawn direto, so pelo scripts/lib/git.js', () => {
  // O texto inteiro do arquivo, nao linha a linha: `spawnSync(\n  'git', ...)` e `'git.exe'` tambem contam (revisao
  // cega). atalho: o nome do binario numa constante (`spawnSync(GIT, ...)`) nao se ve. limite: vale para o literal.
  // trocar quando: um script do plugin guardar o nome do git numa variavel.
  const achados = [];
  let lidos = 0;
  const CHAMADA = /\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync)\(\s*['"`]git(?:\.exe)?['"`]/g;
  function varrer(pasta) {
    for (const nome of fs.readdirSync(pasta, { withFileTypes: true })) {
      const caminho = path.join(pasta, nome.name);
      if (nome.isDirectory()) { varrer(caminho); continue; }
      if (!/\.(?:js|cjs|mjs)$/.test(nome.name)) continue;
      const rel = path.relative(RAIZ, caminho).split(path.sep).join('/');
      if (rel === 'scripts/lib/git.js') continue;
      const fonte = fs.readFileSync(caminho, 'utf8');
      lidos++;
      for (const m of fonte.matchAll(CHAMADA)) achados.push(rel + ':' + fonte.slice(0, m.index).split('\n').length);
    }
  }
  for (const p of ['scripts', 'hooks', 'workflows']) if (fs.existsSync(path.join(RAIZ, p))) varrer(path.join(RAIZ, p));
  assert.ok(lidos > 50, 'o guarda leu ' + lidos + ' arquivos: a varredura nao achou o scripts/');
  assert.deepStrictEqual(achados, [], 'spawn direto do git: chame rodar() ou correr() do scripts/lib/git.js, que ' +
    'ja trazem o prazo, o teto de saida e o erro no resultado');
  // o proprio padrao pega a chamada partida em duas linhas e o git.exe
  assert.ok('cp.spawnSync(\n  \'git\', [])'.match(CHAMADA) && 'execFile("git.exe")'.match(CHAMADA));
});

// F1g (s372, 0.41.0): a arvore limpa sai do `modificados` com um git so (o status). O prefixo so serve para converter
// os caminhos que o status listou; sem caminho, era um processo a mais em toda abertura, turno e comando destrutivo.
test('F1g: modificados na arvore limpa roda so o status; com arquivo mudado, o prefixo continua', () => {
  const comum = require('./lib/comum.js');
  const dir = comum.repo(comum.temporaria('sworn-git-limpo-'), { 'pacote/a.txt': 'um\n' });
  const sub = path.join(dir, 'pacote');
  const cp = require('node:child_process');
  const original = cp.spawnSync;
  let vistos = [];
  cp.spawnSync = function (cmd, args) { vistos.push(args.slice(0, 2).join(' ')); return original.apply(this, arguments); };
  let limpa; let suja; let daLimpa;
  try {
    limpa = gitLib.modificados(sub);
    daLimpa = vistos; vistos = [];
    fs.writeFileSync(path.join(sub, 'a.txt'), 'dois\n');
    suja = gitLib.modificados(sub);
  } finally { cp.spawnSync = original; }
  assert.deepStrictEqual(limpa, [], 'arvore limpa e lista vazia, nunca null');
  assert.deepStrictEqual(daLimpa, ['status --porcelain'], 'na arvore limpa so o status: ' + daLimpa.join(' | '));
  assert.deepStrictEqual(vistos, ['status --porcelain', 'rev-parse --show-prefix'], vistos.join(' | '));
  assert.deepStrictEqual(suja, ['a.txt'], 'da subpasta, o caminho vem relativo a ela: ' + JSON.stringify(suja));
});
