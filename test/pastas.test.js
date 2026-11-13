'use strict';
// R1 (pedido do dono, 2026-11-12): o estudo de referencia por clone, e a limpeza das pastas que o proprio sworn cria.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const comum = require('./lib/comum.js');

const pastas = require('../scripts/lib/pastas.js');

/** Um ambiente com a pasta de config so deste teste: o registro de cada teste nao ve o dos outros. */
function ambiente() {
  const config = comum.pasta('pastas-config');
  return { CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_SESSION_ID: '' };
}

const DIA = 24 * 60 * 60 * 1000;

/** Um repositorio com um commit, e um remoto vazio (bare) ao lado. */
function repoComRemoto(nome) {
  const dir = comum.repo(comum.pasta(nome), { 'a.txt': 'a\n' });
  const remoto = comum.pasta(nome + '-remoto');
  comum.git(remoto, ['init', '-q', '--bare', '.']);
  comum.git(dir, ['remote', 'add', 'origin', remoto]);
  return dir;
}

test('R1: registrar so aceita pasta que existe, dentro da temporaria do sistema, de um tipo conhecido', function () {
  const env = ambiente();
  // fora da temporaria: a temporaria do sistema passa a ser outra pasta (o repositorio pode morar dentro da
  // temporaria de verdade, como o export de uma publicacao, e a raiz dele nao serve de exemplo de fora)
  const dirFora = comum.pasta('pastas-fora-registrar');
  const outraTmp = comum.pasta('pastas-outra-tmp-registrar');
  const antes = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  let fora;
  try {
    for (const k of Object.keys(antes)) process.env[k] = outraTmp;
    fora = pastas.registrar(dirFora, 'estudo', { sessao: 's1' }, env);
  } finally {
    for (const k of Object.keys(antes)) { if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]; }
  }
  assert.strictEqual(fora.ok, false);
  assert.match(fora.erro, /temporaria/);
  const sumida = pastas.registrar(path.join(os.tmpdir(), 'sworn-nao-existe-' + Date.now()), 'estudo', { sessao: 's1' }, env);
  assert.strictEqual(sumida.ok, false);
  const tipo = pastas.registrar(comum.pasta('pastas-tipo'), 'lixo', { sessao: 's1' }, env);
  assert.strictEqual(tipo.ok, false);
  assert.match(tipo.erro, /tipo/);
  // o worktree sem o repositorio de origem nao se registra: a limpeza dele e pelo git do repositorio
  const semRepo = pastas.registrar(comum.pasta('pastas-wt'), 'worktree', { sessao: 's1' }, env);
  assert.strictEqual(semRepo.ok, false);
  assert.deepStrictEqual(pastas.listar(env), []);
  // controle: a pasta certa entra, com o caminho real do disco
  const boa = comum.pasta('pastas-boa');
  const ok = pastas.registrar(boa, 'estudo', { sessao: 's1' }, env);
  assert.strictEqual(ok.ok, true, ok.erro);
  const lista = pastas.listar(env);
  assert.strictEqual(lista.length, 1);
  assert.strictEqual(lista[0].caminho, fs.realpathSync.native(boa));
  assert.strictEqual(lista[0].tipo, 'estudo');
  assert.strictEqual(lista[0].sessao, 's1');
});

test('R1: o estudo sai no fim da sessao dele; antes disso, e de outra sessao recente, fica', function () {
  const env = ambiente();
  const minha = comum.pasta('pastas-minha');
  const outra = comum.pasta('pastas-outra');
  fs.writeFileSync(path.join(minha, 'README.md'), 'x');
  assert.ok(pastas.registrar(minha, 'estudo', { sessao: 's1' }, env).ok);
  assert.ok(pastas.registrar(outra, 'carga', { sessao: 's2' }, env).ok);
  const durante = pastas.limpar({ sessao: 's1', fimDaSessao: false }, env);
  assert.deepStrictEqual(durante.apagadas, []);
  assert.strictEqual(durante.ficam.length, 2);
  assert.ok(fs.existsSync(minha));
  const real = fs.realpathSync.native(minha);
  const fim = pastas.limpar({ sessao: 's1', fimDaSessao: true }, env);
  assert.deepStrictEqual(fim.apagadas.map(function (a) { return a.caminho; }), [real]);
  assert.strictEqual(fs.existsSync(minha), false);
  assert.ok(fs.existsSync(outra), 'a pasta da outra sessao fica');
  assert.strictEqual(pastas.listar(env).length, 1);
});

test('R1: a pasta de outra sessao sai depois de 7 dias, contados da criacao', function () {
  const env = ambiente();
  const velha = comum.pasta('pastas-velha');
  assert.ok(pastas.registrar(velha, 'estudo', { sessao: 's2' }, env).ok);
  const seis = pastas.limpar({ sessao: 's1', fimDaSessao: false, agora: Date.now() + 6 * DIA }, env);
  assert.deepStrictEqual(seis.apagadas, []);
  const oito = pastas.limpar({ sessao: 's1', fimDaSessao: false, agora: Date.now() + 8 * DIA }, env);
  assert.strictEqual(oito.apagadas.length, 1);
  assert.strictEqual(fs.existsSync(velha), false);
  // a da sessao em curso nao sai pela idade: so no fim dela
  const minha = comum.pasta('pastas-minha-velha');
  assert.ok(pastas.registrar(minha, 'estudo', { sessao: 's1' }, env).ok);
  const longa = pastas.limpar({ sessao: 's1', fimDaSessao: false, agora: Date.now() + 8 * DIA }, env);
  assert.deepStrictEqual(longa.apagadas, []);
  assert.match(longa.ficam[0].motivo, /sessao em curso/);
});

test('R1: a pasta do registro que ficou fora da temporaria do sistema nunca se apaga', function () {
  const env = ambiente();
  const dir = comum.pasta('pastas-fora-da-tmp');
  assert.ok(pastas.registrar(dir, 'estudo', { sessao: 's1' }, env).ok);
  // a temporaria do sistema muda (outro TEMP, outro TMPDIR): a pasta registrada fica fora dela
  const antes = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  const outraTmp = comum.pasta('pastas-outra-tmp');
  try {
    for (const k of Object.keys(antes)) process.env[k] = outraTmp;
    const r = pastas.limpar({ sessao: 's1', fimDaSessao: true, cwd: comum.RAIZ }, env);
    assert.deepStrictEqual(r.apagadas, []);
    assert.match(r.ficam[0].motivo, /fora da temporaria/);
    assert.ok(fs.existsSync(dir));
  } finally {
    for (const k of Object.keys(antes)) { if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]; }
  }
  // controle: de volta a temporaria de antes, sai
  const r2 = pastas.limpar({ sessao: 's1', fimDaSessao: true, cwd: comum.RAIZ }, env);
  assert.strictEqual(r2.apagadas.length, 1);
});

test('R1: outra pasta no mesmo caminho nao se apaga, e o registro dela sai', function () {
  const env = ambiente();
  const dir = comum.pasta('pastas-troca');
  assert.ok(pastas.registrar(dir, 'estudo', { sessao: 's1' }, env).ok);
  fs.rmSync(dir, { recursive: true, force: true });
  // a primeira pasta some e outra nasce no lugar, com o mesmo nome: a limpeza nao a reconhece como sua
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'do-dono.txt'), 'nao e do sworn');
  // o sistema pode reusar o numero da pasta apagada: a marca de criacao tambem confere
  const r = pastas.limpar({ sessao: 's1', fimDaSessao: true }, env);
  assert.deepStrictEqual(r.apagadas, []);
  assert.ok(fs.existsSync(path.join(dir, 'do-dono.txt')));
  assert.strictEqual(r.estranhas.length, 1);
  assert.deepStrictEqual(pastas.listar(env), []);
});

test('R1: a pasta com a pasta de trabalho dentro nunca se apaga', function () {
  const env = ambiente();
  const dir = comum.pasta('pastas-trabalho');
  fs.mkdirSync(path.join(dir, 'sub'));
  assert.ok(pastas.registrar(dir, 'estudo', { sessao: 's1' }, env).ok);
  const dentro = pastas.limpar({ sessao: 's1', fimDaSessao: true, cwd: path.join(dir, 'sub') }, env);
  assert.deepStrictEqual(dentro.apagadas, []);
  assert.match(dentro.ficam[0].motivo, /pasta de trabalho/);
  const propria = pastas.limpar({ sessao: 's1', fimDaSessao: true, cwd: dir }, env);
  assert.deepStrictEqual(propria.apagadas, []);
  assert.ok(fs.existsSync(dir));
  // controle: com a pasta de trabalho fora, sai
  const fora = pastas.limpar({ sessao: 's1', fimDaSessao: true, cwd: comum.RAIZ }, env);
  assert.strictEqual(fora.apagadas.length, 1);
});

test('R1: a pasta registrada que ja sumiu sai do registro sem erro', function () {
  const env = ambiente();
  const dir = comum.pasta('pastas-sumiu');
  assert.ok(pastas.registrar(dir, 'carga', { sessao: 's1' }, env).ok);
  const real = fs.realpathSync.native(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  const r = pastas.limpar({ sessao: 's1', fimDaSessao: false }, env);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.sumiram, [real]);
  assert.deepStrictEqual(pastas.listar(env), []);
});

test('R1: a pasta que nao se le agora (EPERM, EBUSY) fica, com o registro, para a proxima passada', function () {
  const env = ambiente();
  const dir = comum.pasta('pastas-presa');
  assert.ok(pastas.registrar(dir, 'carga', { sessao: 's1' }, env).ok);
  const real = fs.realpathSync.native(dir);
  // o Windows devolve ENOENT ate para o caminho torto: o erro de outro processo segurando a pasta se simula aqui
  const original = fs.lstatSync;
  fs.lstatSync = function (p) {
    if (path.resolve(String(p)) === path.resolve(real)) throw Object.assign(new Error('presa'), { code: 'EPERM' });
    return original.apply(fs, arguments);
  };
  let r;
  try { r = pastas.limpar({ sessao: 's1', fimDaSessao: true, cwd: comum.RAIZ }, env); } finally { fs.lstatSync = original; }
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.apagadas, []);
  assert.deepStrictEqual(r.sumiram, []);
  assert.strictEqual(r.ficam.length, 1);
  assert.match(r.ficam[0].motivo, /EPERM/);
  assert.ok(fs.existsSync(dir), 'a pasta presa nao se apaga');
  assert.strictEqual(pastas.listar(env).length, 1, 'o registro dela fica');
});

test('R1: o export fica enquanto tem mudanca sem commit ou commit sem push, e sai depois do push', function () {
  const env = ambiente();
  const exp = repoComRemoto('pastas-export');
  assert.ok(pastas.registrar(exp, 'export', { sessao: 's1' }, env).ok);
  const semPush = pastas.limpar({ sessao: 's1', fimDaSessao: true }, env);
  assert.deepStrictEqual(semPush.apagadas, []);
  assert.match(semPush.ficam[0].motivo, /sem push/);
  comum.git(exp, ['push', '-q', 'origin', 'HEAD:main']);
  fs.writeFileSync(path.join(exp, 'a.txt'), 'mudou\n');
  const sujo = pastas.limpar({ sessao: 's1', fimDaSessao: true }, env);
  assert.deepStrictEqual(sujo.apagadas, []);
  assert.match(sujo.ficam[0].motivo, /sem commit/);
  comum.git(exp, ['checkout', '--', 'a.txt']);
  // depois do push, sai mesmo durante a sessao (os objetos do git sao so leitura no disco: saem tambem)
  const limpo = pastas.limpar({ sessao: 's1', fimDaSessao: false }, env);
  assert.strictEqual(limpo.apagadas.length, 1, JSON.stringify(limpo));
  assert.strictEqual(fs.existsSync(exp), false);
});

test('R1: o worktree de origem sai junto com o export publicado, pelo git do repositorio', function () {
  const env = ambiente();
  const repo = comum.repo(comum.pasta('pastas-repo'), { 'a.txt': 'a\n' });
  const wt = path.join(comum.pasta('pastas-wtpai'), 'wt');
  comum.git(repo, ['worktree', 'add', '-q', '--detach', wt]);
  assert.ok(pastas.registrar(wt, 'worktree', { sessao: 's1', repo: repo }, env).ok);
  const exp = repoComRemoto('pastas-export2');
  assert.ok(pastas.registrar(exp, 'export', { sessao: 's1', origem: wt }, env).ok);
  const antes = pastas.limpar({ sessao: 's1', fimDaSessao: false }, env);
  assert.deepStrictEqual(antes.apagadas, []);
  assert.ok(antes.ficam.some(function (f) { return f.tipo === 'worktree' && /export/.test(f.motivo); }));
  comum.git(exp, ['push', '-q', 'origin', 'HEAD:main']);
  const depois = pastas.limpar({ sessao: 's1', fimDaSessao: false }, env);
  assert.deepStrictEqual(depois.apagadas.map(function (a) { return a.tipo; }).sort(), ['export', 'worktree']);
  assert.strictEqual(fs.existsSync(wt), false);
  assert.doesNotMatch(comum.git(repo, ['worktree', 'list']), /wtpai/);
  assert.deepStrictEqual(pastas.listar(env), []);
});

test('R1: o worktree com mudanca fica, mesmo no fim da sessao', function () {
  const env = ambiente();
  const repo = comum.repo(comum.pasta('pastas-repo2'), { 'a.txt': 'a\n' });
  const wt = path.join(comum.pasta('pastas-wtpai2'), 'wt');
  comum.git(repo, ['worktree', 'add', '-q', '--detach', wt]);
  assert.ok(pastas.registrar(wt, 'worktree', { sessao: 's1', repo: repo }, env).ok);
  fs.writeFileSync(path.join(wt, 'novo.txt'), 'x');
  const r = pastas.limpar({ sessao: 's1', fimDaSessao: true }, env);
  assert.deepStrictEqual(r.apagadas, []);
  assert.match(r.ficam[0].motivo, /sem commit/);
  assert.ok(fs.existsSync(path.join(wt, 'novo.txt')));
  // controle: sem a mudanca, o fim da sessao o tira
  fs.rmSync(path.join(wt, 'novo.txt'));
  const fim = pastas.limpar({ sessao: 's1', fimDaSessao: true }, env);
  assert.strictEqual(fim.apagadas.length, 1, JSON.stringify(fim));
});

test('R1: o registro que nao se le nao se sobrescreve, e nada se apaga', function () {
  const env = ambiente();
  const dir = comum.pasta('pastas-ilegivel');
  assert.ok(pastas.registrar(dir, 'estudo', { sessao: 's1' }, env).ok);
  const arquivo = pastas.arquivoDoRegistro(env);
  fs.writeFileSync(arquivo, '{ quebrado');
  const r = pastas.limpar({ sessao: 's1', fimDaSessao: true }, env);
  assert.strictEqual(r.ok, false);
  assert.match(r.erro, /nao se le/);
  assert.ok(fs.existsSync(dir));
  assert.strictEqual(fs.readFileSync(arquivo, 'utf8'), '{ quebrado');
  const reg = pastas.registrar(comum.pasta('pastas-ilegivel2'), 'estudo', { sessao: 's1' }, env);
  assert.strictEqual(reg.ok, false);
  assert.strictEqual(fs.readFileSync(arquivo, 'utf8'), '{ quebrado');
});

test('R1: o registro que esta versao nao entende fica no arquivo, e a pasta dele tambem', function () {
  const env = ambiente();
  const dir = comum.pasta('pastas-alheio');
  const outra = comum.pasta('pastas-alheio-data');
  assert.ok(pastas.registrar(dir, 'estudo', { sessao: 's1' }, env).ok);
  const arquivo = pastas.arquivoDoRegistro(env);
  const lista = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  // um tipo de outra versao, e uma data que nao se le
  const alheio = Object.assign({}, lista[0], { tipo: 'cache-de-outra-versao' });
  const semData = Object.assign({}, lista[0], { caminho: fs.realpathSync.native(outra), criada: 'ontem' });
  fs.writeFileSync(arquivo, JSON.stringify(lista.concat([alheio, semData])));
  assert.strictEqual(pastas.listar(env).length, 1, 'so o registro valido entra na conta');
  const r = pastas.limpar({ sessao: 's1', fimDaSessao: true, cwd: comum.RAIZ }, env);
  assert.strictEqual(r.apagadas.length, 1);
  const depois = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  assert.deepStrictEqual(depois.map(function (x) { return x.tipo + '|' + x.criada; }).sort(),
    [alheio.tipo + '|' + alheio.criada, 'estudo|ontem'].sort());
  assert.ok(fs.existsSync(outra), 'a pasta do registro sem data nao se apaga');
});

test('R1: o export com commit so no HEAD solto fica', function () {
  const env = ambiente();
  const exp = repoComRemoto('pastas-solto');
  comum.git(exp, ['push', '-q', 'origin', 'HEAD:main']);
  comum.git(exp, ['fetch', '-q', 'origin']);
  comum.git(exp, ['checkout', '-q', '--detach']);
  fs.writeFileSync(path.join(exp, 'b.txt'), 'b\n');
  comum.git(exp, ['add', 'b.txt']);
  comum.git(exp, ['commit', '-q', '-m', 'so no HEAD solto']);
  assert.ok(pastas.registrar(exp, 'export', { sessao: 's1' }, env).ok);
  const r = pastas.limpar({ sessao: 's1', fimDaSessao: true, cwd: comum.RAIZ }, env);
  assert.deepStrictEqual(r.apagadas, []);
  assert.match(r.ficam[0].motivo, /sem push/);
});

test('R1: rodar codigo de dentro do clone de estudo e reconhecido; ler o clone, nao', function () {
  const env = ambiente();
  const clone = comum.pasta('pastas-clone');
  fs.writeFileSync(path.join(clone, 'x.js'), '');
  assert.ok(pastas.registrar(clone, 'estudo', { sessao: 's1' }, env).ok);
  const fora = comum.pasta('pastas-fora');
  const c = clone.replace(/\\/g, '/');
  const roda = [
    'node "' + c + '/x.js"',
    'bash ' + c + '/install.sh',
    'python3 -u ' + c + '/setup.py install',
    '"' + c + '/run.sh" --x',
    'cd "' + c + '" && npm install',
    'npm --prefix "' + c + '" install',
    'make -C ' + c,
    'cargo build --manifest-path ' + c + '/Cargo.toml',
    'X=1 sudo node ' + c + '/x.js',
    '& "' + c + '/x.ps1"',
    // o & sozinho separa os comandos (segundo plano no bash, sequencia no cmd)
    'cd "' + c + '" & npm install',
    'grep x a & node ' + c + '/x.js',
    // as aspas no meio da palavra, e a opcao curta colada
    'npm --prefix="' + c + '" install',
    'make -C' + c
  ];
  for (const comando of roda) {
    assert.ok(pastas.executaNoEstudo(comando, fora, env), 'devia reconhecer: ' + comando);
  }
  // a pasta do comando dentro do clone: o gerenciador de pacote roda o que o clone manda
  assert.ok(pastas.executaNoEstudo('npm test', clone, env));
  assert.ok(pastas.executaNoEstudo('make', clone, env), 'o construtor sem argumento, na pasta do clone');
  assert.ok(pastas.executaNoEstudo('cargo build --manifest-path=' + c + '/Cargo.toml', fora, env), 'a opcao com =');
  if (process.platform === 'win32') {
    // o cd do cmd com a chave /d: a pasta e a que vem depois dela, nao a raiz da unidade
    assert.ok(pastas.executaNoEstudo('cd /d "' + clone + '" & npm install', fora, env), 'cd /d do cmd');
    assert.ok(pastas.executaNoEstudo('cd /D ' + c + ' && npm install', fora, env), 'cd /D do cmd');
  }
  const le = [
    'grep -rn "foo" "' + c + '"',
    'cat ' + c + '/README.md',
    'node scripts/referencia.js ' + c + '/README.md',
    'git -C "' + c + '" log -1',
    'ls ' + c,
    'npm test',
    'node ' + fora.replace(/\\/g, '/') + '/x.js'
  ];
  for (const comando of le) {
    assert.strictEqual(pastas.executaNoEstudo(comando, fora, env), null, 'nao devia reconhecer: ' + comando);
  }
  assert.strictEqual(pastas.executaNoEstudo('cat x.js', clone, env), null);
});

test('R1: o caminho curto do Windows e a forma do Git Bash tambem apontam para o clone', { skip: process.platform !== 'win32' }, function () {
  const env = ambiente();
  const clone = comum.pasta('pastas-curto');
  assert.ok(pastas.registrar(clone, 'estudo', { sessao: 's1' }, env).ok);
  const longo = fs.realpathSync.native(clone);
  const bash = '/' + longo[0].toLowerCase() + longo.slice(2).replace(/\\/g, '/');
  assert.ok(pastas.executaNoEstudo('node ' + bash + '/x.js', comum.RAIZ, env));
  // os.tmpdir() desta maquina pode vir no nome curto (WENDEL~1): o caminho como o teste o criou tambem casa
  assert.ok(pastas.executaNoEstudo('node "' + clone + '\\x.js"', comum.RAIZ, env));
});

test('R1: o clone de estudo so aceita https, sem opcao disfarcada no endereco nem no ramo', function () {
  const env = ambiente();
  for (const url of ['http://github.com/a/b', 'git' + '@github.com:a/b.git','ssh://github.com/a/b', 'file:///c/x',
    'ext::sh -c x', '--upload-pack=x', 'https://github.com/a/b --config=x', 'https://']) {
    const r = pastas.clonar(url, { sessao: 's1' }, env);
    assert.strictEqual(r.ok, false, url);
    assert.match(r.erro, /https/, url);
  }
  // o ramo se confere antes de qualquer clone; a origem local que nao existe faz o ramo que passasse falhar na hora,
  // sem rede
  const semOrigem = path.join(comum.pasta('pastas-sem-origem'), 'nao-existe');
  for (const ref of ['--upload-pack=x', '-q', 'a..b']) {
    const ramo = pastas.clonar(semOrigem, { sessao: 's1', ref: ref, aceitarLocal: true }, env);
    assert.strictEqual(ramo.ok, false, ref);
    assert.match(ramo.erro, /ramo/, ref);
  }
  assert.deepStrictEqual(pastas.listar(env), []);
});

test('R1: o clone de estudo grava a pasta no registro e devolve o commit lido; o que falha nao deixa pasta', function () {
  const env = ambiente();
  const origem = comum.repo(comum.pasta('pastas-origem'), { 'README.md': '# x\n' });
  const commit = comum.git(origem, ['rev-parse', 'HEAD']);
  const r = pastas.clonar(origem, { sessao: 's1', aceitarLocal: true }, env);
  assert.strictEqual(r.ok, true, r.erro);
  assert.strictEqual(r.commit, commit);
  assert.ok(fs.existsSync(path.join(r.pasta, 'README.md')));
  const lista = pastas.listar(env);
  assert.strictEqual(lista.length, 1);
  assert.strictEqual(lista[0].tipo, 'estudo');
  assert.strictEqual(lista[0].caminho, r.pasta);
  // o endereco local so vale para o teste: pela linha de comando, nunca
  assert.strictEqual(pastas.clonar(origem, { sessao: 's1' }, env).ok, false);
  // so as pastas nascidas agora: o resto de outra rodada na temporaria nao conta
  const doClone = function () {
    return fs.readdirSync(os.tmpdir()).filter(function (n) { return n.indexOf('sworn-estudo-nao-existe') === 0; });
  };
  const antes = doClone();
  const falha = pastas.clonar(path.join(origem, 'nao-existe'), { sessao: 's1', aceitarLocal: true }, env);
  assert.strictEqual(falha.ok, false);
  assert.strictEqual(pastas.listar(env).length, 1, 'a pasta do clone que falhou sai do registro');
  assert.deepStrictEqual(doClone().filter(function (n) { return antes.indexOf(n) === -1; }), [],
    'a pasta do clone que falhou sai do disco');
});

test('R1: a linha de comando lista, registra e limpa, e recusa o endereco que nao e https', function () {
  const env = ambiente();
  const dir = comum.pasta('pastas-cli');
  const reg = comum.rodar('scripts/pastas.js', ['--registrar', dir, '--tipo', 'carga'], { env: Object.assign({}, env, { CLAUDE_CODE_SESSION_ID: 's9' }) });
  assert.strictEqual(reg.status, 0, reg.stderr + reg.stdout);
  const lista = comum.rodar('scripts/pastas.js', ['--listar'], { env: env });
  assert.strictEqual(JSON.parse(lista.stdout).pastas[0].sessao, 's9');
  const limpa = comum.rodar('scripts/pastas.js', ['--limpar', '--fim-da-sessao'], { env: Object.assign({}, env, { CLAUDE_CODE_SESSION_ID: 's9' }) });
  assert.strictEqual(limpa.status, 0, limpa.stderr + limpa.stdout);
  assert.strictEqual(JSON.parse(limpa.stdout).apagadas.length, 1);
  assert.strictEqual(fs.existsSync(dir), false);
  const ruim = comum.rodar('scripts/pastas.js', ['--estudar', 'http://github.com/a/b'], { env: env });
  assert.strictEqual(ruim.status, 1);
  assert.match(JSON.parse(ruim.stdout).erro, /https/);
  const local = comum.rodar('scripts/pastas.js', ['--estudar', comum.RAIZ], { env: env });
  assert.strictEqual(local.status, 1);
});

/** Espera a condicao por ate `ms` (o gancho limpa num processo solto, que termina depois dele). */
function esperar(condicao, ms) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (condicao()) return true;
    spawnSync(process.execPath, ['-e', 'setTimeout(function(){},200)']);
  }
  return condicao();
}

test('R1: a trava 5 nao deixa rodar codigo do clone de estudo, com o porque e o que fazer', function () {
  const env = ambiente();
  const clone = comum.pasta('pastas-portao');
  assert.ok(pastas.registrar(clone, 'estudo', { sessao: 's1' }, env).ok);
  const c = clone.replace(/\\/g, '/');
  const entrada = function (comando) {
    return { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: comum.RAIZ,
      tool_input: { command: comando } };
  };
  const r = comum.rodar('scripts/portao-destrutivo.js', [], { entrada: entrada('node ' + c + '/x.js'), env: env });
  assert.strictEqual(r.status, 0, r.stderr);
  const saida = JSON.parse(r.stdout);
  assert.strictEqual(saida.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(saida.hookSpecificOutput.permissionDecisionReason, /clone de estudo/);
  // controle: ler o clone passa
  const le = comum.rodar('scripts/portao-destrutivo.js', [], { entrada: entrada('grep -rn x ' + c), env: env });
  assert.strictEqual(le.status, 0, le.stderr);
  assert.doesNotMatch(le.stdout, /"deny"/);
});

test('R1: o fim da sessao limpa as pastas dela num processo solto', function () {
  const env = ambiente();
  const dir = comum.pasta('pastas-fim');
  assert.ok(pastas.registrar(dir, 'estudo', { sessao: 'fim1' }, env).ok);
  const r = comum.rodar('scripts/fim-sessao.js', [], { entrada: { session_id: 'fim1', hook_event_name: 'SessionEnd' }, env: env });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(esperar(function () { return !fs.existsSync(dir); }, 20000), 'a pasta da sessao devia sair');
});

test('R1: depois de um push, o export publicado sai sozinho', function () {
  const env = ambiente();
  const exp = repoComRemoto('pastas-push');
  comum.git(exp, ['push', '-q', 'origin', 'HEAD:main']);
  assert.ok(pastas.registrar(exp, 'export', { sessao: 'p1' }, env).ok);
  // o estudo desta mesma sessao, de 8 dias atras (sessao longa): o push nao o leva, so o fim dela
  const estudo = comum.pasta('pastas-push-estudo');
  assert.ok(pastas.registrar(estudo, 'estudo', { sessao: 'p1' }, env).ok);
  const arq = pastas.arquivoDoRegistro(env);
  const lista = JSON.parse(fs.readFileSync(arq, 'utf8'));
  for (const reg of lista) if (reg.tipo === 'estudo') reg.criada = new Date(Date.now() - 8 * DIA).toISOString();
  fs.writeFileSync(arq, JSON.stringify(lista));
  const outro = comum.rodar('scripts/limpar-depois-do-push.js', [], { entrada: { session_id: 'p1',
    hook_event_name: 'PostToolUse', tool_name: 'Bash', cwd: comum.RAIZ, tool_input: { command: 'git status' } }, env: env });
  assert.strictEqual(outro.status, 0, outro.stderr);
  assert.ok(!esperar(function () { return !fs.existsSync(exp); }, 1500), 'sem push, nada se limpa');
  const r = comum.rodar('scripts/limpar-depois-do-push.js', [], { entrada: { session_id: 'p1',
    hook_event_name: 'PostToolUse', tool_name: 'Bash', cwd: comum.RAIZ,
    tool_input: { command: 'git -C "' + exp + '" push origin main' } }, env: env });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(esperar(function () { return !fs.existsSync(exp); }, 20000), 'o export publicado devia sair');
  assert.ok(esperar(function () { return pastas.listar(env).length === 1; }, 20000), 'o registro do export devia sair');
  assert.ok(fs.existsSync(estudo), 'o estudo da sessao em curso fica');
});
