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

test('F1g temporaria: o prefixo exato (com espaco) na temporaria do sistema, e some na saida do processo', () => {
  const codigo = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const comum = require(' + JSON.stringify(COMUM) + ');',
    "const dir = comum.temporaria('sworn comum temporaria-');",
    "fs.writeFileSync(path.join(dir, 'a.txt'), 'a');",
    // com acento e subpasta: o rmSync recursivo do Windows deixava esta sem erro (cicatriz.test, s372)
    "const acento = comum.temporaria('sworn comum ação-');",
    "fs.mkdirSync(path.join(acento, 'histórico'));",
    "fs.writeFileSync(path.join(acento, 'histórico', 'nota.md'), 'a');",
    'process.stdout.write(JSON.stringify({ dir: dir, acento: acento, antes: fs.existsSync(dir) }));'
  ];
  const r = spawnSync(process.execPath, [script('temporaria', codigo)], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const s = JSON.parse(r.stdout);
  assert.strictEqual(path.dirname(s.dir), os.tmpdir(), 'fora da temporaria do sistema: ' + s.dir);
  assert.match(path.basename(s.dir), /^sworn comum temporaria-.{6}$/, 'o prefixo nao veio exato');
  assert.strictEqual(s.antes, true, 'a pasta existia enquanto o processo rodava');
  assert.strictEqual(fs.existsSync(s.dir), false, 'a pasta ficou na temporaria depois da saida');
  assert.match(path.basename(s.acento), /^sworn comum ação-.{6}$/, 'o prefixo com acento nao veio exato');
  assert.strictEqual(fs.existsSync(s.acento), false, 'a pasta com acento ficou na temporaria depois da saida');
});

test('F1g temporaria: prefixo vazio, com separador ou com .. e recusado (tiraria a pasta da temporaria)', () => {
  for (const ruim of ['', '.', 'sub/x-', 'sub\\x-', '..', '..x-', null]) {
    assert.throws(function () { comum.temporaria(ruim); }, /prefixo invalido/, 'aceitou ' + JSON.stringify(ruim));
  }
});

// F1g 13a fatia: sob a carga da suite os 5 s do git.correr estouravam e o gancho liberava (falso vermelho)
test('F1g prazo do git: carregar o comum da ao git.correr dos ganchos 60 s, sem trocar o que o ambiente ja traz', () => {
  const sonda = [
    "const cp = require('node:child_process'); const prazos = [];",
    "cp.spawnSync = function (c, a, config) { prazos.push(config.timeout); return { status: 0, stdout: '', stderr: '' }; };",
    'const comum = require(' + JSON.stringify(COMUM) + ');',
    "require(" + JSON.stringify(path.join(comum.RAIZ, 'scripts', 'lib', 'git.js')) + ").correr('.', ['status']);",
    "process.stdout.write(JSON.stringify({ env: process.env.SWORN_GIT_PRAZO_MS, ambiente: comum.ambiente().SWORN_GIT_PRAZO_MS, prazo: prazos[0] }));"
  ].join('\n');
  const sem = Object.assign({}, process.env); delete sem.SWORN_GIT_PRAZO_MS;
  const a = spawnSync(process.execPath, ['-e', sonda], { encoding: 'utf8', env: sem, timeout: comum.PRAZO });
  assert.strictEqual(a.status, 0, a.stderr);
  assert.deepStrictEqual(JSON.parse(a.stdout), { env: '60000', ambiente: '60000', prazo: 60000 });
  assert.ok(comum.PRAZO_DO_GIT < comum.PRAZO, 'o prazo do git tem de caber no prazo do processo filho');
  const b = spawnSync(process.execPath, ['-e', sonda], { encoding: 'utf8', env: Object.assign({}, sem, { SWORN_GIT_PRAZO_MS: '9000' }),
    timeout: comum.PRAZO });
  assert.strictEqual(b.status, 0, b.stderr);
  assert.deepStrictEqual(JSON.parse(b.stdout), { env: '9000', ambiente: '9000', prazo: 9000 }, 'trocou o valor do ambiente');
  const c = spawnSync(process.execPath, ['-e', sonda], { encoding: 'utf8', env: Object.assign({}, sem, { SWORN_GIT_PRAZO_MS: '' }),
    timeout: comum.PRAZO });
  assert.strictEqual(c.status, 0, c.stderr);
  assert.deepStrictEqual(JSON.parse(c.stdout), { env: '60000', ambiente: '60000', prazo: 60000 }, 'o vazio ficou (git nos 5 s)');
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

test('F1g repo: sem manutencao automatica; dois repositorios nao dividem o .git; a pasta que ja tem .git segue', () => {
  const um = comum.repo(comum.pasta('comum-repo-um'), { 'a.txt': 'um\n' });
  const dois = comum.repo(comum.pasta('comum-repo-dois'), { 'b.txt': 'dois\n' });
  assert.strictEqual(comum.git(um, ['config', '--local', 'maintenance.auto']), 'false', 'o commit nao abre o maintenance');
  assert.strictEqual(comum.git(um, ['config', '--local', 'core.repositoryformatversion']), '0', 'a config do init fica');
  assert.strictEqual(comum.git(um, ['ls-files']), 'a.txt', 'o .git copiado nao traz o do outro');
  assert.strictEqual(comum.git(dois, ['ls-files']), 'b.txt');
  assert.strictEqual(comum.git(um, ['rev-parse', '--git-dir']), '.git', 'o repositorio e a propria pasta');
  // a pasta que ja e repositorio passa pelo git init de verdade: o que havia fica, e a config de ensaio troca a chave
  const ja = comum.pasta('comum-repo-ja');
  comum.git(ja, ['init', '-q', '.']);
  comum.git(ja, ['config', 'user.name', 'outro']);
  comum.git(ja, ['config', 'user.email', 'outro@outro']);
  fs.writeFileSync(path.join(ja, 'velho.txt'), 'v\n');
  comum.git(ja, ['add', '-A']);
  comum.git(ja, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'velho']);
  comum.repo(ja, { 'c.txt': 'c\n' });
  assert.strictEqual(comum.git(ja, ['log', '--format=%an']), 'ensaio\noutro', 'o commit de antes fica; o novo e de ensaio');
  assert.strictEqual(comum.git(ja, ['config', '--local', '--get-all', 'user.name']), 'ensaio', 'a chave nao duplica');
  // duas vezes na mesma pasta: a chave segue com um valor so, e o git config de depois troca sem erro
  comum.repo(um);
  comum.git(um, ['config', 'user.email', 'depois@ensaio']);
  assert.strictEqual(comum.git(um, ['config', '--local', '--get-all', 'user.email']), 'depois@ensaio');
});

test('F1g repo: o .git que e um arquivo gitdir (worktree, submodulo) segue pelo git', () => {
  const real = comum.repo(comum.pasta('comum-repo-real'));
  const dir = comum.pasta('comum-repo-gitdir');
  fs.writeFileSync(path.join(dir, '.git'), 'gitdir: ' + path.join(real, '.git').replace(/\\/g, '/') + '\n');
  comum.repo(dir, { 'g.txt': 'g\n' });
  assert.strictEqual(comum.git(dir, ['log', '--format=%s|%an']), 'base|ensaio');
  assert.strictEqual(comum.git(real, ['config', '--local', '--get-all', 'maintenance.auto']), 'false',
    'a config foi para o .git apontado, com um valor so');
});

test('F1g repo: o .git copiado segue o ambiente de git de agora (a config global trocada no meio)', () => {
  comum.repo(comum.pasta('comum-repo-antes'));
  const global = path.join(comum.pasta('comum-repo-global'), 'gitconfig');
  fs.writeFileSync(global, '[init]\n\tdefaultBranch = ramo-do-ensaio\n');
  comVariavel('GIT_CONFIG_GLOBAL', global, function () {
    const dir = comum.repo(comum.pasta('comum-repo-depois'));
    assert.strictEqual(comum.git(dir, ['symbolic-ref', 'HEAD']), 'refs/heads/ramo-do-ensaio', 'o init de agora, nao o guardado');
  });
});

test('F1g doMolde: monta uma vez por funcao, e cada copia e uma pasta nova e independente', () => {
  let vezes = 0;
  function montar(dir) {
    vezes++;
    comum.repo(dir, { 'x.txt': 'base\n' });
    fs.writeFileSync(path.join(dir, 'x.txt'), 'mudado\n');
  }
  const a = comum.doMolde('comum-molde', montar);
  const b = comum.doMolde('comum-molde', montar);
  assert.strictEqual(vezes, 1, 'o molde e montado uma vez so');
  assert.notStrictEqual(a, b);
  assert.match(path.basename(a), /^sworn-comum-molde-/);
  assert.strictEqual(comum.git(a, ['status', '--porcelain']), 'M x.txt', 'a copia traz o trabalho e o indice do molde');
  fs.writeFileSync(path.join(a, 'x.txt'), 'base\n');
  assert.strictEqual(comum.git(a, ['status', '--porcelain']), '', 'o git confere pelo conteudo, com as datas novas');
  assert.strictEqual(comum.git(b, ['status', '--porcelain']), 'M x.txt', 'mexer numa copia nao muda a outra');
  const c = comum.doMolde('comum-molde', function (dir) { vezes++; fs.writeFileSync(path.join(dir, 'y'), ''); });
  assert.strictEqual(vezes, 2, 'outra funcao, outro molde, mesmo com o mesmo nome');
  assert.deepStrictEqual(fs.readdirSync(c), ['y']);
});

// F1 (s372): o gancho em processo. O brinquedo carrega o io.js do plugin pelo caminho absoluto, como o gancho de verdade
// o carrega pelo relativo: o mesmo modulo, o mesmo modo embutido.
const IO = JSON.stringify(path.join(comum.RAIZ, 'scripts', 'lib', 'io.js'));
function gancho(nome, corpo) {
  return script(nome, ['const io = require(' + IO + ');',
    'io.blindar(function () { io.lerEntrada(function (e) {'].concat(corpo, ['}); });']));
}
// o comando que o portao-destrutivo barra sempre, montado para o texto do teste nao ser ele
const APAGAR_TUDO = ['rm', '-rf', '/'].join(' ');

test('F1 ganchoEmProcesso: decide o mesmo que o processo, no brinquedo e no portao-destrutivo de verdade', () => {
  const nega = gancho('nega', ["if (/x/.test(e.tool_input.command)) return io.negarFerramenta('nao: ' + process.env.SWORN_EXTRA);",
    'io.permitir();']);
  for (const comando of ['x', 'y']) {
    const entrada = { tool_input: { command: comando } };
    const r = comum.rodar(nega, [], { entrada: entrada, env: { SWORN_EXTRA: 'motivo' } });
    assert.strictEqual(r.status, 0, r.stderr);
    const emProcesso = comum.ganchoEmProcesso(nega, entrada, { env: comum.ambiente({ SWORN_EXTRA: 'motivo' }) });
    assert.deepStrictEqual(emProcesso, r.stdout ? JSON.parse(r.stdout) : null, comando);
  }
  const dir = comum.pasta('comum-gancho-real');
  const tmp = comum.pasta('comum-gancho-real-tmp');
  const decisoes = [];
  for (const comando of [APAGAR_TUDO, 'ls']) {
    const entrada = { session_id: 'f1', cwd: dir, tool_name: 'Bash', tool_input: { command: comando } };
    const r = comum.rodar('scripts/portao-destrutivo.js', [], { entrada: entrada, env: { SWORN_TMP: tmp } });
    assert.strictEqual(r.status, 0, r.stderr);
    const env = comum.ambiente({ SWORN_TMP: tmp });
    const emProcesso = comum.ganchoEmProcesso('scripts/portao-destrutivo.js', entrada, { env: env });
    assert.deepStrictEqual(emProcesso, r.stdout ? JSON.parse(r.stdout) : null, comando);
    decisoes.push(emProcesso && emProcesso.hookSpecificOutput ? emProcesso.hookSpecificOutput.permissionDecision : null);
  }
  assert.deepStrictEqual(decisoes, ['deny', null], 'o apagar tudo barra e o ls passa: a comparacao nao e de dois nulos');
});

test('F1 ganchoEmProcesso: o gancho roda de novo a cada chamada; sem env, ve o process.env de agora', () => {
  const conta = gancho('conta', ['globalThis.__swornConta = (globalThis.__swornConta || 0) + 1;',
    "io.permitir({ systemMessage: globalThis.__swornConta + ':' + process.env.SWORN_EXTRA });"]);
  // a variavel herdada do shell que roda a suite sai antes da 1a chamada, e volta no fim
  const herdada = process.env.SWORN_EXTRA;
  delete process.env.SWORN_EXTRA;
  try {
    assert.deepStrictEqual(comum.ganchoEmProcesso(conta, {}), { systemMessage: '1:undefined' });
    comVariavel('SWORN_EXTRA', 'agora', function () {
      assert.deepStrictEqual(comum.ganchoEmProcesso(conta, {}), { systemMessage: '2:agora' }, 'rodou de novo, com o env de agora');
    });
  } finally {
    delete globalThis.__swornConta;
    if (herdada !== undefined) process.env.SWORN_EXTRA = herdada;
  }
});

test('F1 ganchoEmProcesso: o env pedido e o ambiente inteiro da chamada, e o ambiente e a pasta voltam, mesmo com falha', () => {
  const ve = gancho('ve', ["io.permitir({ systemMessage: [typeof process.env.SWORN_FORA, process.env.SWORN_EXTRA, process.cwd()].join('|') });"]);
  // a pasta para onde o gancho que quebra muda: uma pasta nova (o chdir para a raiz da temporaria pode dar EBUSY)
  const suja = comum.pasta('comum-gancho-suja');
  const quebra = gancho('quebra', ["process.env.SWORN_SUJO = '1'; process.chdir(" + JSON.stringify(suja) + ');',
    "throw new Error('de proposito');"]);
  const outra = comum.pasta('comum-gancho-cwd');
  comVariavel('SWORN_FORA', 'fica', function () {
    const antes = JSON.stringify(process.env);
    const cwd = process.cwd();
    // o ambiente isolado (sem a sessao real), sem a SWORN_FORA que o process.env tem agora
    const env = comum.ambiente({ SWORN_EXTRA: 'pedido' });
    delete env.SWORN_FORA;
    const s = comum.ganchoEmProcesso(ve, {}, { env: env, cwd: outra }).systemMessage.split('|');
    assert.deepStrictEqual(s.slice(0, 2), ['undefined', 'pedido'], 'o que nao esta no env pedido nao chega ao gancho');
    assert.strictEqual(fs.realpathSync(s[2]), fs.realpathSync(outra), 'o cwd pedido');
    const escreverAntes = process.stderr.write;
    assert.strictEqual(comum.ganchoEmProcesso(quebra, {}, { env: comum.ambiente() }), null, 'o gancho que falha libera');
    const falhou = comum.ganchoCapturado(quebra, {}, { env: comum.ambiente() });
    assert.strictEqual(falhou.saida, null);
    assert.match(falhou.stderr, /portao falhou e liberou por seguranca: .*de proposito/, 'a causa vem no stderr da chamada');
    assert.strictEqual(process.stderr.write, escreverAntes, 'o stderr do processo de teste volta a escrever');
    assert.deepStrictEqual(comum.ganchoCapturado(ve, {}, { env: env }).stderr, '', 'sem falha, stderr vazio');
    assert.strictEqual(JSON.stringify(process.env), antes, 'o ambiente volta como estava, sem o que o gancho sujou');
    assert.strictEqual(process.cwd(), cwd, 'a pasta volta');
    assert.strictEqual(process.env.SWORN_FORA, 'fica');
  });
});

test('F1 ganchoComoProcesso: o mesmo stdout e json do processo, e o status, salvo a falha que libera (1, nao 0)', () => {
  const fala = gancho('fala', ["if (e.falar) process.stdout.write('aviso solto\\n');",
    "if (e.decidir) return io.permitir({ systemMessage: 'decidiu' });", 'io.permitir();']);
  for (const entrada of [{}, { falar: true }, { decidir: true }, { falar: true, decidir: true }]) {
    const r = comum.rodar(fala, [], { entrada: entrada });
    assert.strictEqual(r.status, 0, r.stderr);
    const p = comum.ganchoComoProcesso(fala, entrada, { env: comum.ambiente() });
    const rotulo = JSON.stringify(entrada);
    assert.strictEqual(p.stdout, r.stdout, rotulo);
    assert.strictEqual(p.status, r.status, rotulo);
    assert.deepStrictEqual(p.json, entrada.decidir ? { systemMessage: 'decidiu' } : null, rotulo);
    assert.strictEqual(p.stderr, '', rotulo);
    assert.strictEqual(p.porProcesso, false, rotulo);
  }
  const quebra = gancho('fala-e-quebra', ["process.stdout.write('antes da falha');", "throw new Error('de proposito');"]);
  const r = comum.rodar(quebra, [], { entrada: {} });
  assert.strictEqual(r.status, 0, 'o processo sai com 0 pelo io.blindar: ' + r.stderr);
  const escreverAntes = process.stdout.write;
  const escreverErrAntes = process.stderr.write;
  const p = comum.ganchoComoProcesso(quebra, {}, { env: comum.ambiente() });
  assert.strictEqual(process.stdout.write, escreverAntes, 'o stdout do processo de teste volta a escrever');
  assert.strictEqual(process.stderr.write, escreverErrAntes, 'o stderr do processo de teste volta a escrever');
  assert.strictEqual(p.status, 1, 'a diferenca de proposito: a falha que libera nao passa como sem opiniao');
  assert.strictEqual(p.stdout, r.stdout, 'o texto escrito antes da falha vem, como no processo');
  assert.strictEqual(p.json, null);
  assert.match(p.stderr, comum.FALHOU_E_LIBEROU);
});

test('F1 ganchoComoProcesso: o gancho que sai por process.exit roda como processo, com o env e o cwd pedidos', () => {
  // texto solto antes do JSON: o json e a ultima linha, como no caminho em processo
  const sai = gancho('sai', ["process.stdout.write('aviso solto\\n' + JSON.stringify({ systemMessage: [e.x, process.env.SWORN_EXTRA, process.cwd()].join('|') }));",
    'process.exit(3);']);
  const outra = comum.pasta('comum-sai-cwd');
  const p = comum.ganchoComoProcesso(sai, { x: 'entrou' }, { env: comum.ambiente({ SWORN_EXTRA: 'pedido' }), cwd: outra });
  assert.strictEqual(p.porProcesso, true, 'o exit derrubaria o processo de teste: foi por processo');
  assert.strictEqual(p.status, 3, p.stderr);
  const s = p.json.systemMessage.split('|');
  assert.deepStrictEqual(s.slice(0, 2), ['entrou', 'pedido']);
  assert.strictEqual(fs.realpathSync(s[2]), fs.realpathSync(outra));
  assert.strictEqual(p.stdout, 'aviso solto\n' + JSON.stringify(p.json));
  // a falha que libera tambem volta com status 1 por processo; o process.exit( num comentario ja manda por processo
  const quebra = gancho('sai-e-quebra', ['// process.exit( so neste comentario', "throw new Error('de proposito');"]);
  const q = comum.ganchoComoProcesso(quebra, {}, { env: comum.ambiente() });
  assert.strictEqual(q.porProcesso, true);
  assert.strictEqual(q.status, 1, 'a falha que libera nao passa como sem opiniao, nem por processo: ' + q.stderr);
  assert.strictEqual(q.json, null);
  assert.match(q.stderr, comum.FALHOU_E_LIBEROU);
  // entrada null vai como {}, como em processo: o script que le o stdin cru, sem o io.js, ve '{}', nao 'null'
  const cru = script('le-cru', ["process.stdout.write(require('fs').readFileSync(0, 'utf8'));", 'process.exit(0);']);
  assert.strictEqual(comum.ganchoComoProcesso(cru, null, { env: comum.ambiente() }).stdout, '{}');
  // a ultima linha que abre com { e nao e JSON (saida cortada) nao passa calada como sem opiniao
  const cortado = gancho('sai-cortado', ["process.stdout.write('{\"systemMessage\": \"cort');", 'process.exit(0);']);
  const c = comum.ganchoComoProcesso(cortado, {}, { env: comum.ambiente() });
  assert.strictEqual(c.porProcesso, true);
  assert.strictEqual(c.status, 1, 'a saida cortada volta como falha');
  assert.strictEqual(c.json, null);
  assert.match(c.stderr, /\[comum\.ganchoComoProcesso\] a ultima linha do stdout abre com \{ e nao e JSON: \{"systemMessage": "cort$/);
});

test('H6b ganchoComoProcesso: o gancho que roda outros (io.rodarJuntos) vai por processo; o ganchoEmProcesso recusa', () => {
  // em processo, o rodarJuntos de dentro zerava o modo embutido de fora e o arquivo de teste passava calado ("tests 1")
  const dentro = gancho('roda-dentro', ["io.permitir({ systemMessage: 'de dentro ' + e.x });"]);
  const fora = gancho('roda-outros', ['const s = io.rodarJuntos(e, [' + JSON.stringify(dentro) + ']);',
    "io.permitir(io.juntarSaidas(s, 'PreToolUse'));"]);
  for (let i = 0; i < 2; i++) {
    const p = comum.ganchoComoProcesso(fora, { x: 'v' + i }, { env: comum.ambiente() });
    assert.strictEqual(p.porProcesso, true, 'o rodarJuntos aninhado derrubaria o runner: foi por processo');
    assert.strictEqual(p.status, 0, p.stderr);
    assert.deepStrictEqual(p.json, { systemMessage: 'de dentro v' + i }, 'o gancho de dentro roda a cada chamada');
  }
  // a recusa se prova com o rodarJuntos( so num comentario: sem a recusa, este rodaria em processo sem derrubar o runner
  const citado = gancho('cita-rodar', ['// io.rodarJuntos( so neste comentario', 'io.permitir();']);
  assert.throws(function () { comum.ganchoEmProcesso(citado, {}, { env: comum.ambiente() }); },
    /roda outros ganchos \(io\.rodarJuntos\) e so roda por processo: use o comum\.ganchoComoProcesso/);
});

// F1g (s372, 0.42.0): a abertura.js termina pelo io.permitir, nao por process.exit: roda no processo do teste e
// responde o mesmo que o processo de verdade (o texto da abertura, sem JSON, status 0).
test('F1g: a abertura.js roda no processo do teste e escreve o mesmo texto que por processo', () => {
  const abrir = function (porProcesso) {
    const dir = comum.pasta('comum-abertura');
    const entrada = { session_id: 'f1', cwd: dir, source: 'startup' };
    const env = comum.ambiente({ SWORN_TMP: comum.pasta('comum-abertura-tmp') });
    const r = porProcesso ? comum.rodar('scripts/abertura.js', [], { cwd: dir, entrada: entrada, env: env })
      : comum.ganchoComoProcesso('scripts/abertura.js', entrada, { env: env, cwd: dir });
    // a pasta sai do texto nas duas grafias (a curta do Windows e a longa), para os dois caminhos compararem igual
    const texto = r.stdout.split(fs.realpathSync.native(dir)).join('<pasta>').split(dir).join('<pasta>');
    return { r: r, texto: texto };
  };
  const junto = abrir(false);
  assert.strictEqual(junto.r.porProcesso, false, 'a abertura tinha de rodar no processo do teste');
  assert.strictEqual(junto.r.status, 0, junto.r.stderr);
  assert.strictEqual(junto.r.stderr, '', 'sem falha nem aviso no stderr, tambem no processo do teste');
  assert.strictEqual(junto.r.json, null);
  assert.match(junto.r.stdout, /^# sworn - /, 'a abertura respondeu');
  const sozinha = abrir(true);
  assert.strictEqual(sozinha.r.status, 0, sozinha.r.stderr);
  assert.strictEqual(sozinha.r.stderr, '', 'sem falha nem aviso no stderr');
  assert.strictEqual(junto.texto, sozinha.texto, 'o mesmo texto nos dois caminhos');
});

test('F1 ganchoComoProcesso: entrada em texto vai por processo como esta; caminho sem extensao; sem env, sem a sessao real', () => {
  const fala = gancho('fala-texto', ["io.permitir({ systemMessage: [e.decidir, process.env.CLAUDE_CODE_SESSION_ID, process.env.SWORN_EXTRA].join('|') });"]);
  const t = comum.ganchoComoProcesso(fala, JSON.stringify({ decidir: 'sim' }), { env: comum.ambiente() });
  assert.strictEqual(t.porProcesso, true, 'texto no stdin, como o rodar');
  assert.strictEqual(t.status, 0, t.stderr);
  assert.strictEqual(t.json.systemMessage.split('|')[0], 'sim', 'o texto chegou como JSON, sem virar string de novo');
  const semExtensao = fala.replace(/\.js$/, '');
  assert.strictEqual(comum.ganchoComoProcesso(semExtensao, { decidir: 'x' }).json.systemMessage.split('|')[0], 'x',
    'resolve como o require');
  comVariavel('CLAUDE_CODE_SESSION_ID', 'sessao-real', function () {
    comVariavel('SWORN_EXTRA', 'agora', function () {
      for (const r of [comum.ganchoComoProcesso(fala, {}), comum.ganchoComoProcesso(fala, '{}')]) {
        assert.deepStrictEqual(r.json.systemMessage.split('|').slice(1), ['', 'agora'],
          'sem env: o ambiente de agora, sem a sessao real (porProcesso ' + r.porProcesso + ')');
      }
      assert.deepStrictEqual(comum.ganchoEmProcesso(fala, {}).systemMessage.split('|').slice(1), ['', 'agora'],
        'o ganchoEmProcesso sem env tambem');
    });
  });
});

test('F1 ganchoComoProcesso: nenhuma lib de scripts/lib chama process.exit no modo embutido (so o io.js, fora dele)', () => {
  const pasta = path.join(comum.RAIZ, 'scripts', 'lib');
  const comExit = fs.readdirSync(pasta).filter(function (n) { return n.endsWith('.js'); }).filter(function (n) {
    // a linha de codigo, nao o texto de um script gerado (entre aspas) nem um comentario
    return fs.readFileSync(path.join(pasta, n), 'utf8').split('\n').some(function (l) {
      const t = l.trim();
      return /\bprocess\.exit\(/.test(t) && !/^(['"]|\/\/|\*)/.test(t);
    });
  });
  assert.deepStrictEqual(comExit, ['io.js'], 'uma lib com process.exit derrubaria o processo de teste no ganchoComoProcesso');
});

/** O script por um processo de verdade (o comum.rodar, com prazo), no formato que o scriptComoProcesso devolve. */
function peloRodar(alvo, args, opcoes) {
  const r = comum.rodar(alvo, args, opcoes);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('F1g scriptComoProcesso: o mesmo status, stdout e stderr do processo, e o primeiro exit vale mesmo dentro de try', () => {
  const casos = [
    ['exit-com-codigo', ['console.log(JSON.stringify(process.argv.slice(2)));', 'process.stderr.write("e\\n");', 'process.exit(3);']],
    ['exit-no-try', ['try { process.stdout.write("a"); process.exit(2); }',
      'catch (e) { process.stdout.write("b"); process.stderr.write("c"); process.exit(1); }', 'process.stdout.write("d");']],
    ['exit-code-sem-exit', ['process.exitCode = 4;', 'console.log("x");']],
    ['exit-vazio-com-exit-code', ['process.exitCode = 5;', 'process.exit();', 'console.log("depois");']],
    ['fim-sem-exit', ['console.log("fim");']],
    ['exit-negativo', ['process.exit(-1);']],
    ['exit-acima-de-255', ['process.exit(300);']],
    ['exit-em-texto', ['process.exit("3");']],
  ];
  casos.forEach(function (c) {
    const alvo = script(c[0], c[1]);
    const args = ['--um', 'dois tres'];
    assert.deepStrictEqual(comum.scriptComoProcesso(alvo, args), peloRodar(alvo, args), c[0] + ': o mesmo resultado do processo');
  });
  // o codigo que o node recusa (fracao): o processo sai com 1 e a causa do node no stderr; aqui, o mesmo status
  const fracao = script('exit-fracao', ['process.exit(2.7);']);
  assert.strictEqual(comum.scriptComoProcesso(fracao).status, peloRodar(fracao).status, 'exit(2.7): o status do processo');
  const quebra = script('quebra', ['process.stdout.write("antes\\n");', 'throw new Error("quebrou de proposito");']);
  const r = comum.scriptComoProcesso(quebra);
  const p = peloRodar(quebra);
  assert.strictEqual(r.status, 1, 'a excecao que escapa sai com 1, como o processo');
  assert.strictEqual(p.status, 1, 'o processo de verdade sai com 1');
  assert.strictEqual(r.stdout, p.stdout, 'o que saiu antes da excecao, igual nos dois');
  assert.match(r.stderr, /Error: quebrou de proposito/, 'a pilha vai ao stderr');
  assert.match(p.stderr, /Error: quebrou de proposito/, 'o processo tambem leva a pilha ao stderr');
  // o exitCode que o processo de teste ja tinha nao vaza para o script (o processo novo nasce sem ele), e volta
  const fim = script('fim-limpo', ['console.log("ok");']);
  const exitCodeAntes = process.exitCode;
  let comCodigo;
  try {
    process.exitCode = 7;
    comCodigo = comum.scriptComoProcesso(fim);
    assert.strictEqual(process.exitCode, 7, 'o exitCode do processo de teste volta');
  } finally { process.exitCode = exitCodeAntes; }
  assert.deepStrictEqual(comCodigo, { status: 0, stdout: 'ok\n', stderr: '' }, 'o script nao herda o exitCode do teste');
});

test('F1g scriptComoProcesso: argv, pasta e ambiente pedidos; sem env, sem a sessao real; tudo volta, mesmo com falha', () => {
  const alvo = script('le-tudo', ['console.log(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(),',
    '  x: process.env.SWORN_ENSAIO_X, sessao: process.env.CLAUDE_CODE_SESSION_ID }));']);
  const dir = comum.pasta('comum-cwd');
  const r = comum.scriptComoProcesso(alvo, ['a', 'b c'], { cwd: dir, env: comum.ambiente({ SWORN_ENSAIO_X: 'sim' }) });
  const lido = JSON.parse(r.stdout);
  assert.deepStrictEqual(lido.argv, ['a', 'b c'], 'os args vem depois do script, o com espaco inteiro');
  assert.strictEqual(fs.realpathSync(lido.cwd), fs.realpathSync(dir), 'o script roda na pasta pedida');
  assert.strictEqual(lido.x, 'sim', 'o script ve o ambiente pedido');
  assert.strictEqual(lido.sessao, '', 'o ambiente() nao leva a sessao');
  const semEnv = comVariavel('CLAUDE_CODE_SESSION_ID', 'sessao-real', function () {
    return JSON.parse(comum.scriptComoProcesso(alvo).stdout);
  });
  assert.strictEqual(semEnv.sessao, '', 'sem env, o ambiente() isolado: a sessao real nao chega ao script');

  // a pasta para onde o script que quebra muda: uma pasta nova (o chdir para a raiz da temporaria pode dar EBUSY)
  const suja = comum.pasta('comum-script-suja');
  const antes = { cwd: process.cwd(), argv: process.argv, exit: process.exit, exitCode: process.exitCode,
    out: process.stdout.write, err: process.stderr.write, env: JSON.stringify(process.env),
    ouvintesExit: process.listenerCount('exit'), ouvintesAviso: process.listenerCount('warning') };
  const quebra = script('quebra-e-suja', ['process.env.SWORN_ENSAIO_SUJO = "1";', 'process.exitCode = 9;',
    'process.on("exit", function () { process.stdout.write("ouvinte do script\\n"); });', 'process.on("warning", function () {});',
    'process.chdir(' + JSON.stringify(suja) + ');', 'throw new Error("no meio");']);
  // o ouvinte que o processo de teste ja tinha fica: so sai o que o script pos
  const doTeste = function () {};
  process.on('exit', doTeste);
  let q;
  try {
    q = comum.scriptComoProcesso(quebra, [], { cwd: dir, env: comum.ambiente({ SWORN_ENSAIO_X: 'sim' }) });
    assert.ok(process.listeners('exit').indexOf(doTeste) !== -1, 'o ouvinte de exit do processo de teste fica');
  } finally { process.removeListener('exit', doTeste); }
  assert.strictEqual(q.status, 1, 'o script quebra no meio: ' + q.stderr);
  assert.match(q.stderr, /Error: no meio/, 'quebrou na excecao do fim, depois de sujar tudo');
  assert.strictEqual(process.cwd(), antes.cwd, 'a pasta do processo de teste volta');
  assert.strictEqual(process.argv, antes.argv, 'o argv do processo de teste volta');
  assert.strictEqual(process.exit, antes.exit, 'o process.exit de verdade volta');
  assert.strictEqual(process.exitCode, antes.exitCode, 'o exitCode que o script pos nao fica');
  assert.strictEqual(process.stdout.write, antes.out, 'o stdout do processo de teste volta');
  assert.strictEqual(process.stderr.write, antes.err, 'o stderr do processo de teste volta');
  assert.strictEqual(JSON.stringify(process.env), antes.env, 'o ambiente volta inteiro: nem o pedido nem o sujo ficam');
  assert.strictEqual(process.listenerCount('exit'), antes.ouvintesExit, 'o ouvinte de exit que o script pos sai');
  assert.strictEqual(process.listenerCount('warning'), antes.ouvintesAviso, 'o ouvinte de warning que o script pos sai');
});

test('F1g scriptComoProcesso: os modulos carregam de novo a cada chamada, e o cache do require volta como estava', () => {
  const texto = path.join(comum.RAIZ, 'scripts', 'lib', 'texto.js');
  const doTeste = require(texto);
  const alvo = script('conta', ['const c = require("./contador.js"); c.n++; console.log(c.n);',
    'const t = require(' + JSON.stringify(texto) + '); t.marcaDoEnsaio = (t.marcaDoEnsaio || 0) + 1; console.log(t.marcaDoEnsaio);']);
  const contador = path.join(path.dirname(alvo), 'contador.js');
  fs.writeFileSync(contador, 'module.exports = { n: 0 };\n');
  const chaves = Object.keys(require.cache).sort();
  assert.strictEqual(comum.scriptComoProcesso(alvo).stdout, '1\n1\n', 'a primeira chamada carrega os modulos do zero');
  assert.strictEqual(comum.scriptComoProcesso(alvo).stdout, '1\n1\n', 'a segunda chamada nao herda o estado da primeira');
  assert.deepStrictEqual(Object.keys(require.cache).sort(), chaves, 'o cache do require volta com as mesmas chaves');
  assert.strictEqual(require(texto), doTeste, 'o processo de teste segue com o seu modulo');
  assert.strictEqual(doTeste.marcaDoEnsaio, undefined, 'o que o script mudou no modulo dele nao chega ao do teste');
});

test('F1g scriptComoProcesso: o apurar-ronda.js de verdade sai igual nos dois caminhos', () => {
  const alvo = path.join(comum.RAIZ, 'scripts', 'apurar-ronda.js');
  const dir = comum.pasta('comum-apurar');
  const r = comum.scriptComoProcesso(alvo, [], { cwd: dir });
  assert.deepStrictEqual(r, peloRodar(alvo, [], { cwd: dir }), 'o mesmo resultado do processo de verdade');
  assert.strictEqual(r.status, 1, 'sem revisao, o apurador para com erro');
  assert.match(r.stdout, /nao ha revisao/, 'e diz a causa');
});
