'use strict';
// F1e (D828): os ajudantes comuns dos testes (test/lib/comum.js). O que se prova aqui e o contrato que os outros
// testes usam sem conferir: a pasta some, o processo filho nao ve a sessao real, o prazo corta, o git que falha grita.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const comum = require('./lib/comum.js');

const COMUM = path.join(__dirname, 'lib', 'comum.js');

/** Grava um script de brinquedo numa pasta temporaria e devolve o caminho absoluto dele. */
function script(nome, linhas) {
  const alvo = path.join(comum.pasta('comum-' + nome), nome + '.js');
  fs.writeFileSync(alvo, linhas.join('\n') + '\n');
  return alvo;
}

// Devolve em JSON o que o processo filho recebeu: argumentos, pasta, entrada e as duas variaveis da sessao.
const ECO = [
  "let entrada = '';",
  "process.stdin.on('data', function (d) { entrada += d; });",
  "process.stdin.on('end', function () {",
  '  process.stdout.write(JSON.stringify({',
  '    args: process.argv.slice(2), cwd: process.cwd(), entrada: entrada,',
  '    config: process.env.CLAUDE_CONFIG_DIR, sessao: process.env.CLAUDE_CODE_SESSION_ID, extra: process.env.SWORN_EXTRA',
  '  }));',
  '});'
];

function eco(args, opcoes) {
  const r = comum.rodar(script('eco', ECO), args, opcoes);
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

/** Roda `fn` com a variavel de ambiente trocada e a devolve como estava, mesmo com erro. */
function comVariavel(nome, valor, fn) {
  const tinha = Object.prototype.hasOwnProperty.call(process.env, nome);
  const antes = process.env[nome];
  process.env[nome] = valor;
  try { return fn(); } finally {
    if (tinha) process.env[nome] = antes; else delete process.env[nome];
  }
}

test('F1e pasta: nova a cada chamada, com o nome no caminho, dentro da pasta temporaria do sistema', () => {
  const a = comum.pasta('comum-nome');
  const b = comum.pasta('comum-nome');
  assert.notStrictEqual(a, b, 'duas chamadas, duas pastas');
  assert.ok(fs.statSync(a).isDirectory() && fs.statSync(b).isDirectory(), 'as duas existem');
  assert.strictEqual(path.dirname(a), path.join(os.tmpdir()), 'fica na pasta temporaria do sistema');
  assert.match(path.basename(a), /^sworn-comum-nome-.+/, 'o nome do teste aparece no caminho');
  assert.deepStrictEqual(fs.readdirSync(a), [], 'nasce vazia');
});

test('F1e pasta: some na saida do processo, com o que tiver dentro; apagada antes pelo teste, a saida nao falha', () => {
  const codigo = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const comum = require(' + JSON.stringify(COMUM) + ');',
    "const cheia = comum.pasta('comum-saida');",
    "fs.mkdirSync(path.join(cheia, 'sub'));",
    "fs.writeFileSync(path.join(cheia, 'sub', 'a.txt'), 'a');",
    "const apagada = comum.pasta('comum-saida');",
    'comum.apagar(apagada);',
    'process.stdout.write(JSON.stringify({ cheia: cheia, apagada: apagada, antes: fs.existsSync(cheia) }));'
  ];
  const r = spawnSync(process.execPath, [script('saida', codigo)], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stderr, '', 'a limpeza da saida nao reclama da pasta que o teste ja apagou');
  const s = JSON.parse(r.stdout);
  assert.strictEqual(s.antes, true, 'a pasta existia enquanto o processo rodava');
  assert.strictEqual(fs.existsSync(s.cheia), false, 'a pasta com arquivos sumiu na saida');
  assert.strictEqual(fs.existsSync(s.apagada), false, 'a apagada pelo teste segue apagada');
});

test('F1e apagar: a pasta que nao existe nao lanca erro', () => {
  const dir = comum.pasta('comum-apagar');
  comum.apagar(dir);
  assert.strictEqual(fs.existsSync(dir), false);
  assert.doesNotThrow(function () { comum.apagar(dir); });
  assert.doesNotThrow(function () { comum.apagar(undefined); }, 'a pasta que nem chegou a ser criada');
});

test('F1e apagar: a pasta presa por outro processo nao derruba o teste', () => {
  const dir = comum.pasta('comum-presa');
  const rm = fs.rmSync;
  fs.rmSync = function () { throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }); };
  try {
    assert.doesNotThrow(function () { comum.apagar(dir); });
  } finally { fs.rmSync = rm; }
  assert.strictEqual(fs.existsSync(dir), true, 'a pasta presa fica; quem a apaga e a saida do processo ou o sistema');
});

test('F1e ambiente: pasta de config vazia (a mesma no processo todo) e sem a sessao; o ambiente real nao muda', () => {
  comVariavel('CLAUDE_CODE_SESSION_ID', 'sessao-real', function () {
    comVariavel('CLAUDE_CONFIG_DIR', 'pasta-real', function () {
      const a = comum.ambiente();
      assert.strictEqual(a.CLAUDE_CODE_SESSION_ID, '', 'a sessao real nao passa');
      assert.notStrictEqual(a.CLAUDE_CONFIG_DIR, 'pasta-real', 'a pasta de config real nao passa');
      assert.deepStrictEqual(fs.readdirSync(a.CLAUDE_CONFIG_DIR), [], 'a pasta de config existe e esta vazia');
      assert.strictEqual(comum.ambiente().CLAUDE_CONFIG_DIR, a.CLAUDE_CONFIG_DIR, 'uma pasta so por processo');
      // Variavel propria, nao o PATH: no Windows a chave da copia e `Path`, e `a.PATH` viria undefined.
      const resto = comVariavel('SWORN_RESTO', 'passa', function () { return comum.ambiente().SWORN_RESTO; });
      assert.strictEqual(resto, 'passa', 'o resto do ambiente passa');
      assert.strictEqual(process.env.CLAUDE_CODE_SESSION_ID, 'sessao-real', 'o ambiente do teste fica como estava');
      assert.strictEqual(process.env.CLAUDE_CONFIG_DIR, 'pasta-real');
    });
  });
});

test('F1e ambiente: o extra entra por cima, e pode trocar a pasta de config e a sessao', () => {
  const a = comum.ambiente({ SWORN_EXTRA: 'x', CLAUDE_CONFIG_DIR: 'outra', CLAUDE_CODE_SESSION_ID: 'de-teste' });
  assert.strictEqual(a.SWORN_EXTRA, 'x');
  assert.strictEqual(a.CLAUDE_CONFIG_DIR, 'outra');
  assert.strictEqual(a.CLAUDE_CODE_SESSION_ID, 'de-teste');
});

test('F1e rodar: o processo filho nao ve a sessao real, recebe os argumentos, a pasta e o env pedido', () => {
  const dir = comum.pasta('comum-cwd');
  const s = comVariavel('CLAUDE_CODE_SESSION_ID', 'sessao-real', function () {
    return eco(['--um', 'dois tres'], { cwd: dir, env: { SWORN_EXTRA: 'veio' } });
  });
  assert.strictEqual(s.sessao, '', 'a sessao real nao chega ao processo filho');
  assert.strictEqual(s.config, comum.ambiente().CLAUDE_CONFIG_DIR, 'a pasta de config e a vazia');
  assert.deepStrictEqual(s.args, ['--um', 'dois tres'], 'argumento com espaco chega inteiro');
  assert.strictEqual(fs.realpathSync(s.cwd), fs.realpathSync(dir));
  assert.strictEqual(s.extra, 'veio');
  assert.strictEqual(s.entrada, '', 'sem entrada, o stdin fecha vazio');
});

test('F1e rodar: sem argumentos nem opcoes roda; o env do pedido troca a sessao so naquela chamada', () => {
  assert.deepStrictEqual(eco().args, []);
  assert.strictEqual(eco([], { env: { CLAUDE_CODE_SESSION_ID: 'de-teste' } }).sessao, 'de-teste');
  assert.strictEqual(eco([]).sessao, '', 'a chamada seguinte volta ao isolado');
});

test('F1e rodar: a entrada em texto vai como esta; outro valor vai em JSON', () => {
  assert.strictEqual(eco([], { entrada: 'texto cru, nao e JSON' }).entrada, 'texto cru, nao e JSON');
  assert.strictEqual(eco([], { entrada: '' }).entrada, '');
  assert.strictEqual(eco([], { entrada: { a: 1, b: ['c'] } }).entrada, '{"a":1,"b":["c"]}');
  assert.strictEqual(eco([], { entrada: null }).entrada, 'null');
  assert.strictEqual(eco([], { entrada: 0 }).entrada, '0');
});

test('F1e rodar: o caminho relativo sai da raiz do repositorio, nao da pasta de trabalho', () => {
  const dir = comum.pasta('comum-raiz');
  const r = comum.rodar('test/lib/comum.js', [], { cwd: dir });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.prazoEstourado, false);
  const fora = comum.rodar('nao-existe-na-raiz.js', [], { cwd: dir });
  assert.strictEqual(fora.status, 1, 'script que nao existe e erro do node, nao prazo');
  assert.strictEqual(fora.prazoEstourado, false);
  assert.match(fora.stderr, /nao-existe-na-raiz\.js/);
});

test('F1e rodar: a pasta de trabalho que nao existe volta com a causa no stderr, em texto, e nao e prazo', () => {
  const dir = path.join(comum.pasta('comum-cwd-fora'), 'nao-existe');
  const r = comum.rodar(script('eco', ECO), [], { cwd: dir });
  assert.notStrictEqual(r.status, 0, 'processo que nao rodou nao passa por verde');
  assert.strictEqual(r.prazoEstourado, false);
  assert.strictEqual(r.stdout, '', 'o stdout volta em texto, nao null');
  assert.match(r.stderr, /^\n\[comum\.rodar\] erro ao rodar .*eco\.js em .*nao-existe: .*ENOENT/, 'diz o script, a pasta e a causa');
});

test('F1e rodar: sem prazo pedido, ou com prazo 0, o prazo padrao chega ao processo filho', () => {
  // Esperar o padrao estourar levaria 120 s: o processo filho troca o spawnSync por um que so anota o que recebeu.
  const codigo = [
    "const cp = require('node:child_process');",
    'let visto = null;',
    "cp.spawnSync = function (comando, args, opcoes) { visto = opcoes; return { status: 0, stdout: '', stderr: '' }; };",
    'const comum = require(' + JSON.stringify(COMUM) + ');',
    "comum.rodar('x.js');",
    'const semPrazo = visto.timeout;',
    "comum.rodar('x.js', [], { prazo: 0 });",
    'const zero = visto.timeout;',
    "comum.rodar('x.js', [], { prazo: 700 });",
    'process.stdout.write(JSON.stringify({ semPrazo: semPrazo, zero: zero, pedido: visto.timeout, padrao: comum.PRAZO }));'
  ];
  const r = spawnSync(process.execPath, [script('padrao', codigo)], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout), { semPrazo: 120000, zero: 120000, pedido: 700, padrao: 120000 });
});

test('F1e rodar: o prazo corta o processo que nao termina e diz a causa no stderr', () => {
  // O script termina sozinho em 20 s: se o prazo deixar de cortar, o teste falha em vez de ficar preso para sempre.
  const preso = script('preso', ["process.stderr.write('comecei');", 'setTimeout(function () {}, 20000);']);
  const inicio = Date.now();
  const r = comum.rodar(preso, [], { prazo: 1500 });
  assert.ok(Date.now() - inicio < 15000, 'cortou antes de o script terminar sozinho');
  assert.strictEqual(r.prazoEstourado, true);
  assert.notStrictEqual(r.status, 0, 'processo cortado nao passa por verde');
  assert.match(r.stderr, /\[comum\.rodar\] o prazo de 1500 ms estourou: .*preso\.js$/, 'a causa fica no fim do stderr');
});

test('F1e git: devolve a saida sem o fim de linha, aceita env, e o git que falha lanca erro com a causa', () => {
  const dir = comum.pasta('comum-git');
  comum.git(dir, ['init', '-q', '.']);
  assert.strictEqual(comum.git(dir, ['rev-parse', '--is-inside-work-tree']), 'true');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  comum.git(dir, ['add', 'a.txt']);
  comum.git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'r'],
    { GIT_AUTHOR_DATE: '2020-01-02T03:04:05Z', GIT_COMMITTER_DATE: '2020-01-02T03:04:05Z' });
  assert.match(comum.git(dir, ['log', '-1', '--format=%aI']), /^2020-01-02T03:04:05/, 'o env chegou ao git');
  // LC_ALL=C: a mensagem do git em ingles, qualquer que seja o idioma da maquina.
  assert.throws(function () { comum.git(dir, ['rev-parse', 'ramo-que-nao-existe'], { LC_ALL: 'C' }); },
    function (e) {
      assert.match(e.message, /^git rev-parse ramo-que-nao-existe falhou em /);
      assert.ok(e.message.includes(dir), 'diz em que pasta');
      assert.match(e.message, /ramo-que-nao-existe.*\n?.*(unknown revision|ambiguous argument)/s, 'traz o stderr do git');
      return true;
    });
});

test('F1e repo: sem arquivos, repositorio com autor de ensaio e sem commit', () => {
  const dir = comum.pasta('comum-repo-vazio');
  assert.strictEqual(comum.repo(dir), dir, 'devolve a pasta');
  assert.strictEqual(comum.git(dir, ['config', '--local', 'user.name']), 'ensaio');
  assert.strictEqual(comum.git(dir, ['config', '--local', 'user.email']), 'ensaio@ensaio');
  assert.strictEqual(comum.git(dir, ['config', '--local', 'core.autocrlf']), 'false');
  assert.strictEqual(comum.git(dir, ['config', '--local', 'commit.gpgsign']), 'false');
  assert.throws(function () { comum.git(dir, ['rev-parse', '--verify', 'HEAD']); }, /falhou em/, 'sem commit');
  const semNada = comum.repo(comum.pasta('comum-repo-vazio'), {});
  assert.throws(function () { comum.git(semNada, ['rev-parse', '--verify', 'HEAD']); }, /falhou em/, 'lista vazia: sem commit');
});

test('F1e repo: com arquivos, grava cada um (com subpasta), faz o commit base e deixa a arvore limpa', () => {
  const dir = comum.pasta('comum-repo');
  // Um fim de linha CRLF e um LF: com a conversao da maquina (autocrlf) o commit guardaria 16 bytes, nao 17.
  comum.repo(dir, { 'raiz.txt': 'raiz\n', 'sub/dentro/b.txt': 'linha 1\r\nlinha 2\n' });
  assert.strictEqual(comum.git(dir, ['log', '--format=%s|%an|%ae']), 'base|ensaio|ensaio@ensaio', 'um commit so, do autor de ensaio');
  assert.strictEqual(comum.git(dir, ['status', '--porcelain']), '', 'arvore limpa');
  assert.strictEqual(comum.git(dir, ['ls-files']), 'raiz.txt\nsub/dentro/b.txt');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'sub', 'dentro', 'b.txt'), 'utf8'), 'linha 1\r\nlinha 2\n', 'o fim de linha fica como veio');
  assert.strictEqual(comum.git(dir, ['cat-file', '-s', 'HEAD:sub/dentro/b.txt']), '17', 'o commit guarda os bytes como vieram');
});

test('F1e repo: a pasta que nao existe lanca erro em vez de montar o repositorio em outro lugar', () => {
  const dir = path.join(comum.pasta('comum-repo-fora'), 'nao-existe');
  assert.throws(function () { comum.repo(dir, { 'a.txt': 'a' }); }, /^Error: git init -q \. falhou em .*nao-existe: .*ENOENT/, 'diz a causa mesmo sem stderr do git');
});
