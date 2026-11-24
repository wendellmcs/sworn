'use strict';

// H6c (15.4, D895): o portao de commit varre o que o commit vai levar com a classe `segredo` da sanitacao.js. A isca
// vem da propria classe (concatenada la), para este arquivo nao ter segredo nenhum escrito por extenso.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const comum = require('./lib/comum.js');
const sanit = require('../scripts/lib/sanitacao.js');
const segredo = require('../scripts/lib/segredo-commit.js');

const ISCA = sanit.CLASSES_GENERICAS.filter(function (c) { return c.chave === 'segredo'; })[0].isca;

function repo(projeto) {
  const dir = comum.temporaria('sworn-segredo-');
  const arquivos = { 'src/a.js': 'um\ndois\ntres\n', '.gitignore': 'ignorado.txt\n' };
  if (projeto !== null) arquivos['.claude/sworn/projeto.json'] = projeto === undefined ? '{}' : projeto;
  return comum.repo(dir, arquivos);
}

function commitar(dir, comando, ferramenta) {
  const tmp = comum.temporaria('sworn-segredo-tmp-');
  const r = comum.ganchoComoProcesso(path.join('scripts', 'portao-commit.js'),
    { session_id: 'c1', cwd: dir, hook_event_name: 'PreToolUse', tool_name: ferramenta || 'Bash', tool_input: { command: comando } },
    { cwd: dir, env: comum.ambiente({ SWORN_TMP: tmp }) });
  // o portao que quebra e libera sai com status 1 (comum.js), e o stdout nao vazio tem de ser JSON: assim "nao negou"
  // nunca e o gancho que nem rodou
  assert.strictEqual(r.status, 0, 'o portao quebrou: ' + r.stderr);
  const json = r.stdout.trim() ? JSON.parse(r.stdout) : null;
  const saida = json && json.hookSpecificOutput;
  return { status: r.status, negou: !!(saida && saida.permissionDecision === 'deny'),
    motivo: saida ? saida.permissionDecisionReason || '' : '', stderr: r.stderr };
}

function gravar(dir, rel, conteudo) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), conteudo);
}

test('segredo no commit: o staged com segredo nega, com arquivo:linha e a classe, sem o trecho', () => {
  const dir = repo();
  gravar(dir, 'src/a.js', 'um\nconst k = "' + ISCA + '";\ntres\n');
  comum.git(dir, ['add', 'src/a.js']);
  const r = commitar(dir, 'git commit -m x');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.negou, 'o commit com segredo staged passou');
  assert.match(r.motivo, /src\/a\.js:2/);
  assert.match(r.motivo, /segredo, chave ou token/);
  assert.ok(r.motivo.indexOf(ISCA) === -1, 'o motivo repetiu o segredo');
  assert.ok(r.motivo.indexOf(ISCA.slice(0, 12)) === -1, 'o motivo repetiu o comeco do segredo');
  assert.match(r.motivo, /# sworn: segredo-visto/);
});

test('segredo no commit: a linha certa no segundo trecho do diff e no arquivo novo staged', () => {
  const dir = repo();
  gravar(dir, 'src/a.js', 'UM\ndois\ntres\nquatro\ncinco\n' + ISCA + '\n');
  gravar(dir, 'src/novo b.js', 'x\n\n' + ISCA + '\n');
  comum.git(dir, ['add', '-A']);
  const r = commitar(dir, 'git commit -m x');
  assert.ok(r.negou);
  assert.match(r.motivo, /src\/a\.js:6/);
  assert.match(r.motivo, /src\/novo b\.js:3/);
});

test('segredo no commit: tirar o segredo (linha removida) passa, e o diff limpo tambem', () => {
  const dir = comum.repo(comum.temporaria('sworn-segredo-'),
    { '.claude/sworn/projeto.json': '{}', 'src/a.js': 'um\n' + ISCA + '\n' });
  gravar(dir, 'src/a.js', 'um\n');
  comum.git(dir, ['add', 'src/a.js']);
  assert.strictEqual(commitar(dir, 'git commit -m tira').negou, false);
  // as iscas das outras classes (e-mail, caminho de maquina...) nao param o commit: so a de segredo conta
  const outras = sanit.CLASSES_GENERICAS.filter(function (c) { return c.chave !== 'segredo'; })
    .map(function (c) { return c.isca; }).join('\n');
  const limpo = repo();
  gravar(limpo, 'src/a.js', 'um\ndois mudou\n' + outras + '\n');
  comum.git(limpo, ['add', 'src/a.js']);
  assert.strictEqual(commitar(limpo, 'git commit -m x').negou, false);
});

test('segredo no commit: o binario nao rastreado nao se le; o mesmo segredo no indice e no disco sai uma vez', () => {
  const bin = repo();
  fs.writeFileSync(path.join(bin, 'foto.bin'), Buffer.concat([Buffer.from(ISCA + '\n'), Buffer.from([0, 1, 2])]));
  assert.strictEqual(commitar(bin, 'git add . && git commit -m x').negou, false);
  const dir = repo();
  gravar(dir, 'src/a.js', 'um\n' + ISCA + '\n');
  comum.git(dir, ['add', 'src/a.js']);
  gravar(dir, 'src/a.js', 'um\n' + ISCA + 'X\n');
  const r = commitar(dir, 'git commit -am x');
  assert.ok(r.negou);
  assert.strictEqual(r.motivo.split('src/a.js:2').length - 1, 1, r.motivo);
});

test('segredo no commit: o git add no mesmo comando leva o nao rastreado e o mudado; sem ele, so o staged conta', () => {
  const dir = repo();
  gravar(dir, 'config/novo.env', 'TOKEN=' + ISCA + '\n');
  // sem add no comando, o arquivo novo nao entra no commit: passa
  assert.strictEqual(commitar(dir, 'git commit -m x').negou, false);
  const r = commitar(dir, 'git add . && git commit -m x');
  assert.ok(r.negou, 'o add no mesmo comando escapou do portao');
  assert.match(r.motivo, /config\/novo\.env:1/);
  // o ignorado nao entra nem com o add
  const ign = repo();
  gravar(ign, 'ignorado.txt', ISCA + '\n');
  assert.strictEqual(commitar(ign, 'git add -A && git commit -m x').negou, false);
});

test('segredo no commit: o mudado sem stage so conta com -a, --all ou o add', () => {
  const dir = repo();
  gravar(dir, 'src/a.js', 'um\n' + ISCA + '\n');
  assert.strictEqual(commitar(dir, 'git commit -m x').negou, false);
  assert.ok(commitar(dir, 'git commit -am x').negou, '-am escapou');
  assert.ok(commitar(dir, 'git commit --all -m x').negou, '--all escapou');
  assert.ok(commitar(dir, 'git commit -m x src/a.js').negou, 'o commit com caminho escapou');
  // -m com o valor colado nao e -a: o "a" dele e a mensagem
  assert.strictEqual(commitar(dir, 'git commit -mamend').negou, false);
  // -p/--patch/--interactive: o trecho escolhido vem do disco (revisao H6c, ronda 1)
  assert.ok(commitar(dir, 'git commit -p -m x').negou, '-p escapou');
  assert.ok(commitar(dir, 'git commit --patch -m x').negou, '--patch escapou');
  assert.ok(commitar(dir, 'git commit --interactive -m x').negou, '--interactive escapou');
  assert.strictEqual(commitar(dir, 'git commit -mp').negou, false);
});

test('segredo no commit: o link nao rastreado nao se segue (o git guarda o destino, nao o conteudo)', (t) => {
  const dir = repo();
  const fora = path.join(comum.temporaria('sworn-segredo-fora-'), 'alvo.env');
  fs.writeFileSync(fora, ISCA + '\n');
  try { fs.symlinkSync(fora, path.join(dir, 'link.env'), 'file'); } catch (e) {
    if (e.code === 'EPERM' || e.code === 'EACCES') return t.skip('esta maquina nao cria symlink (' + e.code + ')');
    throw e;
  }
  assert.strictEqual(commitar(dir, 'git add . && git commit -m x').negou, false, 'o link foi seguido');
});

test('segredo no commit: os nao rastreados param de se ler em 32 MiB somados', () => {
  const dir = repo();
  const mega = Buffer.alloc(1024 * 1024, 'x');
  for (let i = 0; i < 32; i++) fs.writeFileSync(path.join(dir, 'a' + String(i).padStart(2, '0') + '.txt'), mega);
  gravar(dir, 'z.env', 'TOKEN=' + ISCA + '\n');
  assert.strictEqual(commitar(dir, 'git add . && git commit -m x').negou, false, 'o teto somado nao valeu');
  // abaixo do teto, o mesmo z.env nega
  fs.unlinkSync(path.join(dir, 'a00.txt'));
  assert.ok(commitar(dir, 'git add . && git commit -m x').negou, 'abaixo do teto o segredo escapou');
});

test('segredo no commit: os git do levantamento somam ate 15 s, e o que passa do orcamento nao roda', () => {
  const dir = repo();
  gravar(dir, 'src/a.js', 'um\n' + ISCA + '\n');
  const git = require('../scripts/lib/git.js');
  // cada diff e o ls-files "gastam" `passo` ms no relogio falso; devolve o prazo que cada git recebeu ('ls:' no
  // ls-files) e os achados
  function prazosCom(passo) {
    const rodarOriginal = git.rodar;
    const agoraOriginal = Date.now;
    let relogio = agoraOriginal();
    const prazos = [];
    let achados;
    Date.now = function () { return relogio; };
    git.rodar = function (cwd, args, o) {
      if (args.indexOf('diff') !== -1 || args[0] === 'ls-files') { prazos.push((args[0] === 'ls-files' ? 'ls:' : '') + o.timeout); relogio += passo; }
      return rodarOriginal.apply(this, arguments);
    };
    try {
      achados = segredo.levantar('git add . && git commit -m x', 'Bash', dir);
    } finally {
      git.rodar = rodarOriginal;
      Date.now = agoraOriginal;
    }
    return { prazos: prazos, achados: achados.map(function (a) { return a.arquivo + ':' + a.linha; }) };
  }
  // sem gasto, os tres rodam com 10 s cada; 8 s por git: 10 s, 7 s (15 - 8) e o ls-files ja nao cabe; 16 s: so o 1o.
  // O segredo esta no rastreado mudado fora do indice: so o 2o diff o ve, e sem ele o levantamento sai vazio
  // (fail-open, D895: o cartao do push varre de novo)
  assert.deepStrictEqual(prazosCom(0), { prazos: ['10000', '10000', 'ls:10000'], achados: ['src/a.js:2'] });
  assert.deepStrictEqual(prazosCom(8000), { prazos: ['10000', '7000'], achados: ['src/a.js:2'] });
  assert.deepStrictEqual(prazosCom(16000), { prazos: ['10000'], achados: [] });
});

test('segredo no commit: a marca segredo-visto passa, e so em comentario', () => {
  const dir = repo();
  gravar(dir, 'src/a.js', 'um\n' + ISCA + '\n');
  comum.git(dir, ['add', 'src/a.js']);
  assert.strictEqual(commitar(dir, 'git commit -m x # sworn: segredo-visto').negou, false);
  assert.ok(commitar(dir, 'git commit -m "# sworn: segredo-visto"').negou, 'a marca entre aspas valeu');
  assert.strictEqual(commitar(dir, 'git commit -m x # sworn: segredo-visto', 'PowerShell').negou, false);
  // a marca de commit sem revisao dispensa a revisao, nao o segredo
  assert.ok(commitar(dir, 'git commit -m x # sworn: sem-revisao').negou, 'a marca sem-revisao dispensou o segredo');
});

test('segredo no commit: desliga com segredoNoCommit false, com portaoCommit false e sem projeto.json', () => {
  [['{"segredoNoCommit": false}'], ['{"portaoCommit": false}'], [null]].forEach(function (caso) {
    const dir = repo(caso[0]);
    gravar(dir, 'src/a.js', 'um\n' + ISCA + '\n');
    comum.git(dir, ['add', 'src/a.js']);
    assert.strictEqual(commitar(dir, 'git commit -m x').negou, false, 'negou com ' + caso[0]);
  });
});

test('segredo no commit: o commit em outra pasta (-C) varre aquele repositorio', () => {
  const dir = repo();
  const outro = comum.repo(comum.temporaria('sworn-segredo-outro-'), { 'b.js': 'b\n' });
  gravar(outro, 'b.js', ISCA + '\n');
  comum.git(outro, ['add', 'b.js']);
  const r = commitar(dir, 'git -C "' + outro.replace(/\\/g, '/') + '" commit -m x');
  assert.ok(r.negou, 'o -C de outro repositorio escapou');
  assert.match(r.motivo, /b\.js:1/);
});

test('segredo no commit: linhasDoDiff le o diff sem git (unidade)', () => {
  const diff = [
    'diff --git a/x.js b/x.js',
    '--- a/x.js',
    '+++ b/x.js',
    '@@ -1,0 +3,2 @@',
    '+limpo',
    '+' + ISCA,
    '@@ -9,2 +11,3 @@',
    ' contexto',
    '-' + ISCA,
    '+++' + ISCA,
    '+++ b/parece-cabecalho.js',
    'diff --git a/y.bin b/y.bin',
    'Binary files a/y.bin and b/y.bin differ'
  ].join('\n');
  const a = segredo.linhasDoDiff(diff);
  assert.deepStrictEqual(a.map(function (l) { return l.arquivo + ':' + l.linha; }),
    ['x.js:3', 'x.js:4', 'x.js:12', 'x.js:13']);
  assert.strictEqual(a[2].texto, '++' + ISCA);
  assert.strictEqual(a[3].texto, '++ b/parece-cabecalho.js');
});

test('segredo no commit: o caminho citado pelo git (aspas, escape em C, octal do UTF-8) volta ao nome', () => {
  assert.strictEqual(segredo.caminhoDoCabecalho('"b/a\\303\\251 \\"x\\"\\t.js"'), 'aé "x"\t.js');
  assert.strictEqual(segredo.caminhoDoCabecalho('b/sem aspas.js'), 'sem aspas.js');
  assert.strictEqual(segredo.caminhoDoCabecalho('/dev/null'), null);
  // o TAB que o git poe no fim do cabecalho de caminho com espaco, e o emoji dentro das aspas (revisao H6c, ronda 1)
  assert.strictEqual(segredo.caminhoDoCabecalho('b/x y.txt\t'), 'x y.txt');
  assert.strictEqual(segredo.caminhoDoCabecalho('"b/a\\tb\u{1F600}.txt"'), 'a\tb\u{1F600}.txt');
});
