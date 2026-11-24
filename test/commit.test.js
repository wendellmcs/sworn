'use strict';
// Plano 091, Tarefa 4 (#1, D558, D559): o portao do commit. Commit com arquivo de codigo mudado na sessao sem revisao
// aprovada e negado com a lista (faixa e inspetores de cada um, D485) e a ordem de rodar o /sworn:review. O texto e
// o do mock aprovado (prints-091/mock-091.png), sem a parte dos atalhos (#8, depende do plano 090 Tarefa 5).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const commit = require('../scripts/lib/commit.js');
const comum = require('./lib/comum.js');

test('commit: ehCommit acha o git commit fora de aspas, com -C, -c e depois de cd', () => {
  for (const c of ['git commit -m "x"', 'git -C "C:/a b/repo" commit -qm x', 'cd x && git commit -m y',
    '( cd "p q" && git add . && git commit -m "a" )', 'git -c user.name=x commit', 'git add a; git commit',
    // revisao cega 0.9.0 (ronda 2): outras opcoes globais e o executavel com caminho ou .exe
    'git --no-pager commit -am x', 'git -p commit', 'git --git-dir=.git --work-tree=. commit -m x',
    '/usr/bin/git commit -m x', 'git.exe commit -m x', 'C:\\Git\\bin\\git.exe -C repo commit']) {
    assert.strictEqual(commit.ehCommit(c), true, c);
  }
  for (const c of ['echo "git commit"', "echo 'git commit -m x'", 'git log --grep commit', 'git commit-tree abc',
    'git status', '', null]) {
    assert.strictEqual(commit.ehCommit(c), false, String(c));
  }
});

test('commit: a marca sem-revisao vale so fora de aspas', () => {
  assert.strictEqual(commit.semRevisao('git commit -m x # sworn: sem-revisao'), true);
  assert.strictEqual(commit.semRevisao('git commit -m x #sworn:sem-revisao'), true);
  assert.strictEqual(commit.semRevisao('git commit -m "x # sworn: sem-revisao"'), false);
  assert.strictEqual(commit.semRevisao('git commit -m x'), false);
});

// A2-10 (H1): o git se le pelo leitor de shell comum (estilo-shell.js), nao por regex sobre o texto
test('A2-10: ehCommit acha o commit com opcao global de valor separado, dentro de bash -c, eval e PowerShell', () => {
  for (const c of ['git --git-dir .git --work-tree . commit -m x', 'git -c core.x=1 --namespace n commit',
    'bash -c "git commit -m x"', "sh -c 'cd r && git commit'", 'eval git commit -m x', 'eval "git commit"',
    'git \\\ncommit -m x', 'sudo git commit -m x', 'GIT_AUTHOR_NAME=x git commit', 'x=$(git commit -m y)',
    'cmd /c git commit -m x', 'powershell -Command "git commit -m x"',
    'pwsh -EncodedCommand ' + Buffer.from('git commit -m x', 'utf16le').toString('base64')]) {
    assert.strictEqual(commit.ehCommit(c), true, c);
  }
  // no heredoc, no comentario e como texto de outro programa nao e commit
  for (const c of ["cat <<'EOF'\ngit commit -m x\nEOF", 'echo ok # git commit', 'git --git-dir commit status',
    'echo git commit', 'x-git commit', 'git']) {
    assert.strictEqual(commit.ehCommit(c), false, c);
  }
  // a continuacao de linha do PowerShell (crase e quebra) junta o comando, como a barra do bash
  assert.strictEqual(commit.ehCommit('git `\ncommit -m x', 'PowerShell'), true);
});

test('A2-10 (L2-s103-08): a ferramenta escolhe o idioma; sem ela, basta uma das leituras achar o commit', () => {
  // no PowerShell a barra antes da aspa e caminho; no bash ela escapa a aspa, que nao fecha
  const c = 'git -C "C:\\x\\" commit -m y';
  assert.strictEqual(commit.ehCommit(c, 'PowerShell'), true);
  assert.strictEqual(commit.pastaDoComando(c, 'PowerShell'), 'C:\\x\\');
  assert.strictEqual(commit.ehCommit(c, 'Bash'), false, 'no bash a aspa nao fecha, e o comando nem roda');
  assert.strictEqual(commit.ehCommit(c), true, 'sem ferramenta, a leitura do PowerShell acha');
  // no PowerShell, Set-Location (e o apelido sl) troca a pasta como o cd
  assert.strictEqual(commit.ehCommit("Set-Location 'C:\\r'; git commit -m x", 'PowerShell'), true);
  assert.strictEqual(commit.pastaDoComando("Set-Location -Path 'C:\\r'; git commit -m x", 'PowerShell'), 'C:\\r');
  assert.strictEqual(commit.pastaDoComando("sl 'C:\\r'; git commit", 'PowerShell'), 'C:\\r');
});

test('A2-10: a marca sem-revisao e a do comentario do primeiro nivel; no heredoc ou num bash -c nao vale', () => {
  assert.strictEqual(commit.semRevisao("git commit -F - <<'EOF'\n# sworn: sem-revisao\nEOF"), false,
    'o corpo do heredoc e a mensagem, nao comentario');
  assert.strictEqual(commit.semRevisao("git commit -F - <<'EOF' # sworn: sem-revisao\nmsg\nEOF"), true);
  assert.strictEqual(commit.semRevisao('bash -c "git commit -m x # sworn: sem-revisao"'), false);
  assert.strictEqual(commit.semRevisao('git commit -m x; # sworn: sem-revisao'), true);
  assert.strictEqual(commit.semRevisao('git commit -m x # sworn: sem-revisao', 'PowerShell'), true);
  assert.strictEqual(commit.semRevisao('git commit -m x#sworn: sem-revisao'), false, 'colada a palavra, nao e comentario');
  assert.strictEqual(commit.semRevisao(null), false);
});

test('A2-10 (L2-s103-09/10): os -C se compoem sobre o cd, e o -C vazio nao muda a pasta', () => {
  assert.strictEqual(commit.pastaDoComando('git -C a -C b commit'), 'a/b');
  assert.strictEqual(commit.pastaDoComando('git -C a -C /b commit'), '/b');
  assert.strictEqual(commit.pastaDoComando('git -C "" commit'), null);
  assert.strictEqual(commit.pastaDoComando('git -C a -C "" commit'), 'a');
  assert.strictEqual(commit.pastaDoComando('cd x && git -C y commit'), 'x/y');
  assert.strictEqual(commit.pastaDoComando('cd x/ && git -C y commit'), 'x/y');
  assert.strictEqual(commit.pastaDoComando('cd x && git -C C:/r commit'), 'C:/r');
  assert.strictEqual(commit.pastaDoComando('bash -c "cd r && git commit"'), 'r');
  assert.strictEqual(commit.pastaDoComando('cd -P a && git commit'), 'a', 'a opcao do cd nao e a pasta');
  assert.strictEqual(commit.pastaDoComando('cd && git commit'), '~', 'cd sem pasta vai ao HOME');
  assert.strictEqual(commit.pastaDoComando('git status'), null);
});

test('A2-21: a chave do caminho tira a caixa so no Windows', () => {
  assert.strictEqual(commit.chave('/x/A.js', 'win32'), commit.chave('/x/a.js', 'win32'));
  assert.notStrictEqual(commit.chave('/x/A.js', 'linux'), commit.chave('/x/a.js', 'linux'));
  assert.strictEqual(commit.chave('/x/a.js', 'linux'), path.resolve('/x/a.js'));
  // sem plataforma, a do processo
  assert.strictEqual(commit.chave('/x/A.js'), commit.chave('/x/A.js', process.platform));
});

test('commit: pastaDoComando le o -C e o ultimo cd antes do commit; sem nenhum, null', () => {
  assert.strictEqual(commit.pastaDoComando('git -C "C:/a b/repo" commit -m x'), 'C:/a b/repo');
  assert.strictEqual(commit.pastaDoComando('cd "x y" && git commit -m z'), 'x y');
  assert.strictEqual(commit.pastaDoComando("( cd 'p' && git commit )"), 'p');
  // A2-10 (H1): o cd relativo anda a partir do anterior, como no shell
  assert.strictEqual(commit.pastaDoComando('cd a && cd b && git commit'), 'a/b');
  assert.strictEqual(commit.pastaDoComando('cd a && cd /b && git commit'), '/b');
  // `cd -` volta a pasta de antes: a do cd anterior, ou a do shell (null) sem ele; dois `cd -` voltam ao segundo
  assert.strictEqual(commit.pastaDoComando('cd /a && cd /b && cd - && git commit'), '/a');
  assert.strictEqual(commit.pastaDoComando('cd /a && cd - && git commit'), null);
  assert.strictEqual(commit.pastaDoComando('cd /a && cd /b && cd - && cd - && git commit'), '/b');
  // a aspa sai antes do cd ver o argumento: `cd '-'` tambem volta
  assert.strictEqual(commit.pastaDoComando("cd /a && cd /b && cd '-' && git commit"), '/a');
  assert.strictEqual(commit.pastaDoComando('Set-Location /a; Set-Location /b; Set-Location -; git commit', 'PowerShell'), '/a');
  // o cd sem pasta do bash vai ao HOME e guarda a de antes, como o OLDPWD; o do PowerShell nao muda a pasta
  assert.strictEqual(commit.pastaDoComando('cd /a && cd && git commit'), '~');
  assert.strictEqual(commit.pastaDoComando('cd /a; cd; cd -; git commit'), '/a');
  assert.strictEqual(commit.pastaDoComando('cd /a; Set-Location; git commit', 'PowerShell'), '/a');
  // no PowerShell o `cd -` anda na historia: o segundo volta mais um passo, nao ao ponto
  assert.strictEqual(commit.pastaDoComando('cd /a; cd /b; cd -; cd -; git commit', 'PowerShell'), null);
  assert.strictEqual(commit.pastaDoComando('cd /a; cd /b; cd /c; cd -; cd -; git commit', 'PowerShell'), '/a');
  assert.strictEqual(commit.pastaDoComando('git commit -m x'), null);
  // o cd so citado entre aspas nao muda a pasta; o de verdade, depois dele, vale com o valor original
  assert.strictEqual(commit.pastaDoComando('echo "x; cd /outro" && git commit -m y'), null);
  assert.strictEqual(commit.pastaDoComando("echo 'cd /outro' && cd \"a b\" && git commit"), 'a b');
});

test('commit: semAprovado tira o arquivo e as entradas que nao sao texto', () => {
  assert.deepStrictEqual(commit.semAprovado([null, 5, '/x/a.js', '/x/b.js'], '/x/b.js'), ['/x/a.js']);
  assert.deepStrictEqual(commit.semAprovado('nao e lista', '/x/b.js'), []);
});

test('commit: inspetores pela faixa (D485): uma 1, duas 2, completa 10 de codigo e 9 de estilo (D825)', () => {
  assert.strictEqual(commit.inspetores('uma', false), 1);
  assert.strictEqual(commit.inspetores('duas', false), 2);
  assert.strictEqual(commit.inspetores('completa', false), 10);
  // D825: o estilo leva as 8 de tela e a lente do pedido
  assert.strictEqual(commit.inspetores('completa', true), 9);
});

// ------------------------------- o gancho, num repositorio de verdade

// F1g (7a fatia): o repositorio de ensaio pelo comum.repo (o .git vazio copiado, com a config no arquivo, e o commit
// sem a manutencao automatica): 2 processos de git, e nao 6.
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-commit-'));
  const linhas = function (n, p) { return Array.from({ length: n }, function (_, i) { return p + i; }).join('\n') + '\n'; };
  comum.repo(dir, {
    '.claude/sworn/projeto.json': '{}',
    'src/grande.js': linhas(60, 'a'),
    'src/pequeno.js': linhas(10, 'b'),
    'LEIA.md': 'texto\n'
  });
  fs.writeFileSync(path.join(dir, 'src', 'grande.js'), linhas(60, 'z'));
  fs.writeFileSync(path.join(dir, 'src', 'pequeno.js'), linhas(9, 'b') + 'mudou\n');
  fs.writeFileSync(path.join(dir, 'src', 'novo.js'), 'x\n');
  fs.writeFileSync(path.join(dir, 'LEIA.md'), 'texto mudado\n');
  return dir;
}

// F1g (7a fatia): o gancho no proprio processo do teste (comum.ganchoComoProcesso), com o ambiente isolado (sem a
// sessao real, pasta de config vazia); devolve { status, stdout, stderr, json, porProcesso }.
// `extra` (opcional): variaveis a mais no ambiente do gancho.
function hook(script, dir, tmp, entrada, extra) {
  return comum.ganchoComoProcesso(path.join('scripts', script), Object.assign({ session_id: 'c1', cwd: dir }, entrada),
    { cwd: dir, env: comum.ambiente(Object.assign({ SWORN_TMP: tmp }, extra)) });
}

function tocar(dir, tmp, rel) {
  return hook('marcar-trabalho.js', dir, tmp, { hook_event_name: 'PostToolUse', tool_name: 'Write',
    tool_input: { file_path: path.join(dir, rel) } });
}

function commitar(dir, tmp, comando, transcrito, extra) {
  const entrada = { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: comando } };
  if (transcrito) entrada.transcript_path = transcrito;
  const r = hook('portao-commit.js', dir, tmp, entrada, extra);
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (e) { json = null; }
  return { status: r.status, json: json, stderr: r.stderr, porProcesso: r.porProcesso };
}

/** Roda `fn` com a variavel `nome` do process.env em `valor` (undefined = sem ela) e a devolve como estava. */
function comVariavel(nome, valor, fn) {
  const anterior = process.env[nome];
  if (valor === undefined) delete process.env[nome]; else process.env[nome] = valor;
  try { return fn(); } finally {
    if (anterior === undefined) delete process.env[nome]; else process.env[nome] = anterior;
  }
}

const lerEstado = function (tmp) { return JSON.parse(fs.readFileSync(path.join(tmp, 'sworn', 'c1.json'), 'utf8')); };

const negou = function (r) {
  return !!(r.json && r.json.hookSpecificOutput && r.json.hookSpecificOutput.permissionDecision === 'deny');
};
const motivo = function (r) { return r.json.hookSpecificOutput.permissionDecisionReason; };

function motivoDoMock(linhas) {
  return [
    'sworn - commit parado: falta a revisao antes do commit.',
    '',
    'Arquivos de codigo mudados nesta sessao sem revisao aprovada',
    '(faixa: o tamanho da revisao; inspetores: quantos revisores ela chama):'
  ].concat(linhas, [
    '',
    'Faca agora:',
    '  1. rode /sworn:review "<arquivo>" para cada um, ate sair "aprovado";',
    '  2. rode o commit de novo.',
    'Se o usuario quer este commit sem revisao, pergunte em 3 opcoes; com o sim,',
    'repita o commit com "# sworn: sem-revisao" no fim do comando.',
    'So o dono desliga esta parada do commit neste projeto: "portaoCommit": false em .claude/sworn/projeto.json.'
  ]).join('\n');
}

function comRepo(fn) {
  const dir = repo();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-commit-tmp-'));
  try { fn(dir, tmp); } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('F1g: os ganchos deste arquivo rodam no processo do teste, e o repositorio de ensaio nasce sem manutencao', () => {
  comRepo(function (dir, tmp) {
    const r = tocar(dir, tmp, 'src/grande.js');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.porProcesso, false, 'o gancho tinha de rodar no processo do teste');
    const config = fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8');
    // a forma que o comum.repo grava (CONFIG_DE_ENSAIO_TEXTO): a secao e a chave numa linha com tab
    assert.match(config, /\[maintenance\]\r?\n\tauto = false\b/, 'o commit do ensaio abriria o git maintenance: ' + config);
  });
});

test('091 #1: commit com codigo mudado sem revisao e negado com a lista, a faixa e os inspetores; texto fica fora', () => {
  comRepo(function (dir, tmp) {
    for (const rel of ['src/grande.js', 'src/pequeno.js', 'src/novo.js', 'LEIA.md']) tocar(dir, tmp, rel);
    const r = commitar(dir, tmp, 'git commit -m "feat: x"');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(negou(r), 'o commit passou: ' + JSON.stringify(r.json));
    assert.strictEqual(motivo(r), motivoDoMock([
      '  - "src/grande.js"    faixa completa, 10 inspetores',
      '  - "src/pequeno.js"   faixa uma, 1 inspetor',
      '  - "src/novo.js"      faixa completa, 10 inspetores'
    ]));
    const estado = JSON.parse(fs.readFileSync(path.join(tmp, 'sworn', 'c1.json'), 'utf8'));
    assert.strictEqual(estado.contadores.commit_sem_revisao, 1, 'o balde nao contou');
  });
});

// D870 (A2-11): o arquivo mudado pelo shell (sem Write nem Edit) nao entrava em arquivosTocados e passava sem revisao.
// Com a foto da abertura, o que o git diz mudado e nao estava na foto conta; o que ja estava (outra frente), nao.
test('D870: com a foto da abertura, o codigo mudado pelo shell depois dela barra o commit; o da foto fica fora', () => {
  comRepo(function (dir, tmp) {
    noEstado(tmp, function (s) { s.gitAbertura = ['src/pequeno.js']; });
    const r = commitar(dir, tmp, 'git commit -m "feat: x"');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(negou(r), 'o commit passou: ' + JSON.stringify(r.json));
    assert.strictEqual(motivo(r), motivoDoMock([
      '  - "src/grande.js"   faixa completa, 10 inspetores',
      '  - "src/novo.js"     faixa completa, 10 inspetores'
    ]));
    // o tocado pelo Write e o mesmo arquivo mudado pelo git sai uma vez so
    tocar(dir, tmp, 'src/grande.js');
    const outra = commitar(dir, tmp, 'git commit -m "feat: x"');
    assert.ok(negou(outra), 'o 2o commit passou: ' + JSON.stringify(outra.json));
    assert.strictEqual(motivo(outra).split('src/grande.js').length, 2, motivo(outra));
  });
});

// D870, ronda 1: a foto e o agora vem do mesmo git status e se comparam com a caixa (no disco que distingue caixa,
// o Readme.md da foto nao esconde o README.md mexido agora); a foto vazia (arvore limpa na abertura) deixa tudo contar
test('D870: a foto noutra caixa nao esconde o arquivo; a foto vazia deixa todo mudado contar', () => {
  for (const foto of [['SRC/Pequeno.js'], []]) {
    comRepo(function (dir, tmp) {
      noEstado(tmp, function (s) { s.gitAbertura = foto; });
      const r = commitar(dir, tmp, 'git commit -m "feat: x"');
      assert.ok(negou(r), JSON.stringify(foto) + ': o commit passou: ' + JSON.stringify(r.json));
      for (const nome of ['src/grande.js', 'src/novo.js', 'src/pequeno.js']) {
        assert.ok(motivo(r).indexOf('"' + nome + '"') !== -1, JSON.stringify(foto) + ' sem ' + nome + ': ' + motivo(r));
      }
    });
  }
});

test('D870: sem a foto da abertura, so os tocados contam, como antes (o git nao separa esta sessao da outra frente)', () => {
  comRepo(function (dir, tmp) {
    noEstado(tmp, function (s) { s.arquivosTocados = []; });
    const r = commitar(dir, tmp, 'git commit -m "feat: x"');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(!negou(r), 'sem foto e sem tocados o commit tinha de passar: ' + JSON.stringify(r.json));
  });
});

// D575 (plano 092): arquivo fora de qualquer repositorio (instrumento do scratchpad) nunca conta no portao. Na s85, o
// commit `( cd "$D" && git commit ... )` deu topoDoCommit null (o $D nao se expande) e o portao listou o scratchpad.
test('D575: arquivo tocado fora de qualquer repositorio nao barra o commit, com cd "$D" e com o commit no repositorio', () => {
  comRepo(function (dir, tmp) {
    const fora = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-fora-'));
    try {
      const noGit = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: fora, encoding: 'utf8' });
      if (noGit.status === 0) return; // tmpdir dentro de um repositorio: o cenario nao se monta aqui
      fs.writeFileSync(path.join(fora, 'mutar.js'), 'x\n');
      hook('marcar-trabalho.js', dir, tmp, { hook_event_name: 'PostToolUse', tool_name: 'Write',
        tool_input: { file_path: path.join(fora, 'mutar.js') } });
      const comCdD = commitar(dir, tmp, 'D="' + dir + '"; ( cd "$D" && git commit -m "x" )');
      assert.strictEqual(comCdD.status, 0, comCdD.stderr);
      assert.ok(!negou(comCdD), 'cd "$D": o arquivo de fora barrou o commit: ' + JSON.stringify(comCdD.json));
      const noRepo = commitar(dir, tmp, 'git commit -m "x"');
      assert.ok(!negou(noRepo), 'commit no repositorio: o arquivo de fora barrou: ' + JSON.stringify(noRepo.json));
      assert.deepStrictEqual(commit.pendentes([path.join(fora, 'mutar.js')], [], dir, null, null, []), [],
        'pendentes com topoDoCommit null contou o arquivo de fora');
    } finally {
      fs.rmSync(fora, { recursive: true, force: true });
    }
  });
});

// Plano 091 #8 (mock D559, secao 3): o portao avisa o atalho NOVO sem gatilho (linha acrescentada contra o HEAD, ou
// arquivo novo) dos arquivos que barram o commit; o atalho que ja estava no HEAD e o que tem gatilho ficam fora.
test('091 #8: commit negado lista o atalho novo sem gatilho e manda escrever o gatilho', () => {
  comRepo(function (dir, tmp) {
    const g = function (args) { return spawnSync('git', args, { cwd: dir, encoding: 'utf8', shell: false }); };
    fs.writeFileSync(path.join(dir, 'src', 'velho.js'), 'v\n// atalho: antigo, ja no HEAD\n');
    g(['add', 'src/velho.js']); // so ele: as mudancas do repo() seguem fora do HEAD
    g(['commit', '-qm', 'velho']);
    fs.writeFileSync(path.join(dir, 'src', 'velho.js'), 'v\n// atalho: antigo, ja no HEAD\nnova linha\n');
    fs.writeFileSync(path.join(dir, 'src', 'pequeno.js'),
      Array.from({ length: 9 }, function (_, i) { return 'b' + i; }).join('\n') + '\n// atalho: so um fuso. limite: BRT.\n');
    fs.writeFileSync(path.join(dir, 'src', 'novo.js'), 'x\n// atalho: a. trocar quando: b.\n// shortcut: sem gatilho\n');
    for (const rel of ['src/pequeno.js', 'src/novo.js', 'src/velho.js']) tocar(dir, tmp, rel);
    const r = commitar(dir, tmp, 'git commit -m "feat: atalhos"');
    assert.ok(negou(r), 'o commit passou: ' + JSON.stringify(r.json));
    assert.strictEqual(motivo(r), [
      'sworn - commit parado: falta a revisao antes do commit.',
      '',
      'Arquivos de codigo mudados nesta sessao sem revisao aprovada',
      '(faixa: o tamanho da revisao; inspetores: quantos revisores ela chama):',
      '  - "src/pequeno.js"   faixa uma, 1 inspetor',
      '  - "src/novo.js"      faixa completa, 10 inspetores',
      '  - "src/velho.js"     faixa uma, 1 inspetor',
      'Atalho novo (simplificacao marcada no codigo) sem o "trocar quando:":',
      '  - "src/pequeno.js:10"',
      '  - "src/novo.js:3"',
      '',
      'Faca agora:',
      '  1. rode /sworn:review "<arquivo>" para cada um, ate sair "aprovado";',
      '  2. escreva "trocar quando: ..." em cada atalho listado;',
      '  3. rode o commit de novo.',
      'Se o usuario quer este commit sem revisao, pergunte em 3 opcoes; com o sim,',
      'repita o commit com "# sworn: sem-revisao" no fim do comando.',
      'So o dono desliga esta parada do commit neste projeto: "portaoCommit": false em .claude/sworn/projeto.json.'
    ].join('\n'));
  });
});

test('091 #8: a marcaDeAtalho do projeto vale no portao', () => {
  comRepo(function (dir, tmp) {
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify({ marcaDeAtalho: 'divida' }));
    fs.writeFileSync(path.join(dir, 'src', 'novo.js'), '// divida: sem gatilho\n// atalho: nao conta aqui\n');
    tocar(dir, tmp, 'src/novo.js');
    const m = motivo(commitar(dir, tmp, 'git commit -m x'));
    assert.ok(m.indexOf('Atalho novo (simplificacao marcada no codigo) sem o "trocar quando:":\n  - "src/novo.js:1"\n\n') !== -1, m);
  });
});

test('091 #1: a marca sem-revisao, o "portaoCommit": false e comando que nao e commit passam', () => {
  comRepo(function (dir, tmp) {
    tocar(dir, tmp, 'src/grande.js');
    assert.ok(!negou(commitar(dir, tmp, 'git commit -m x # sworn: sem-revisao')), 'a marca nao liberou');
    assert.ok(!negou(commitar(dir, tmp, 'git status')), 'nao-commit foi negado');
    assert.ok(!negou(commitar(dir, tmp, 'echo "git commit"')), 'commit entre aspas foi negado');
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify({ portaoCommit: false }));
    assert.ok(!negou(commitar(dir, tmp, 'git commit -m x')), 'o false nao desligou');
  });
});

test('H3 (D877): o perfil leve desliga o portao do commit; o portaoCommit escrito e o estrito seguem barrando', () => {
  comRepo(function (dir, tmp) {
    tocar(dir, tmp, 'src/grande.js');
    const arq = path.join(dir, '.claude', 'sworn', 'projeto.json');
    fs.writeFileSync(arq, JSON.stringify({ perfil: 'leve' }));
    assert.ok(!negou(commitar(dir, tmp, 'git commit -m x')), 'o perfil leve nao desligou o portao do commit');
    fs.writeFileSync(arq, JSON.stringify({ perfil: 'leve', portaoCommit: true }));
    assert.ok(negou(commitar(dir, tmp, 'git commit -m x')), 'o portaoCommit escrito nao venceu o perfil');
    fs.writeFileSync(arq, JSON.stringify({ perfil: 'estrito' }));
    assert.ok(negou(commitar(dir, tmp, 'git commit -m x')), 'o estrito desligou o portao do commit');
    fs.writeFileSync(arq, JSON.stringify({ perfil: 'Leve' }));
    assert.ok(negou(commitar(dir, tmp, 'git commit -m x')), 'perfil com a caixa errada valeu como leve');
  });
});

test('091 #1: sem projeto.json, sem arquivo tocado ou com o arquivo ja igual ao HEAD, passa', () => {
  comRepo(function (dir, tmp) {
    assert.ok(!negou(commitar(dir, tmp, 'git commit -m x')), 'sem arquivo tocado foi negado');
    tocar(dir, tmp, 'LEIA.md');
    assert.ok(!negou(commitar(dir, tmp, 'git commit -m x')), 'so texto foi negado');
    tocar(dir, tmp, 'src/pequeno.js');
    spawnSync('git', ['checkout', '--', 'src/pequeno.js'], { cwd: dir, encoding: 'utf8', shell: false });
    assert.ok(!negou(commitar(dir, tmp, 'git commit -m x')), 'arquivo igual ao HEAD foi negado');
    fs.rmSync(path.join(dir, '.claude'), { recursive: true, force: true });
    tocar(dir, tmp, 'src/grande.js');
    assert.ok(!negou(commitar(dir, tmp, 'git commit -m x')), 'sem projeto.json foi negado');
  });
});

test('091 #1: revisao aprovada libera o arquivo; editar de novo o devolve a lista', () => {
  comRepo(function (dir, tmp) {
    tocar(dir, tmp, 'src/pequeno.js');
    comVariavel('SWORN_TMP', tmp, function () {
      const estado = require('../scripts/lib/estado.js');
      estado.alterar('c1', function (s) { s.revisadosAprovados = [path.join(dir, 'src', 'pequeno.js')]; return s; });
    });
    assert.ok(!negou(commitar(dir, tmp, 'git commit -m x')), 'aprovado foi negado');
    tocar(dir, tmp, 'src/pequeno.js');
    const r = commitar(dir, tmp, 'git commit -m x');
    assert.ok(negou(r), 'editado depois de aprovado passou');
    assert.ok(motivo(r).indexOf('"src/pequeno.js"') !== -1, motivo(r));
  });
});

// H6e1 (15.0): pelo gancho, o aprovado mudado pelo shell (sem Edit, entao sem o marcar-trabalho.js) e negado.
test('H6e1: pelo portao, o aprovado com o hash do conteudo passa; mudado pelo shell depois, e negado', () => {
  comRepo(function (dir, tmp) {
    tocar(dir, tmp, 'src/pequeno.js');
    const abs = path.join(dir, 'src', 'pequeno.js');
    noEstado(tmp, function (s) { s.revisadosAprovados = [abs]; s.revisadosHash = { [abs]: commit.hashDoArquivo(abs) }; });
    assert.ok(!negou(commitar(dir, tmp, 'git commit -m x')), 'o aprovado com o mesmo conteudo foi negado');
    fs.appendFileSync(abs, '// sed -i\n');
    const r = commitar(dir, tmp, 'git commit -m x');
    assert.ok(negou(r), 'mudado pelo shell depois de aprovado passou: ' + JSON.stringify(r.json));
    assert.match(motivo(r), /"src\/pequeno\.js" .*\(a revisao aprovada julgou outro conteudo: o arquivo mudou depois dela, fora do Edit\)/);
  });
});

// Plano 091, Tarefa 6: o ciclo da ordem do commit nos contadores do turno - negado (dada, uma vez por pendencia), a
// skill do revisar rodou (cumprida) e o commit com a marca sem-revisao depois de negado (recusada).
test('091 T6: commit negado conta a ordem dada uma vez; o revisar a cumpre; a marca sem-revisao a recusa', () => {
  comRepo(function (dir, tmp) {
    const ler = function () { return JSON.parse(fs.readFileSync(path.join(tmp, 'sworn', 'c1.json'), 'utf8')); };
    const skill = function (nome, extra) {
      return hook('marcar-trabalho.js', dir, tmp, Object.assign({ hook_event_name: 'PostToolUse', tool_name: 'Skill',
        tool_input: { skill: nome } }, extra || {}));
    };
    tocar(dir, tmp, 'src/grande.js');
    assert.ok(negou(commitar(dir, tmp, 'git commit -m x')));
    assert.ok(negou(commitar(dir, tmp, 'git commit -m x')));
    assert.strictEqual(ler().contadores.ordem_revisar_dada, 1, 'a mesma ordem contou duas vezes');
    assert.strictEqual(ler().contadores.commit_sem_revisao, 2, 'o balde do portao conta cada negacao');
    skill('sworn:review', { agent_id: 'sub-1' });
    assert.strictEqual(ler().contadores.ordem_revisar_cumprida, undefined, 'subagente cumpriu a ordem');
    skill('sworn:review');
    assert.strictEqual(ler().contadores.ordem_revisar_cumprida, 1);
    assert.ok(negou(commitar(dir, tmp, 'git commit -m y')));
    assert.ok(!negou(commitar(dir, tmp, 'git commit -m y # sworn: sem-revisao')));
    assert.strictEqual(ler().contadores.ordem_revisar_dada, 2);
    assert.strictEqual(ler().contadores.ordem_revisar_recusada, 1);
    assert.ok(!negou(commitar(dir, tmp, 'git commit -m z # sworn: sem-revisao')));
    assert.strictEqual(ler().contadores.ordem_revisar_recusada, 1, 'recusou sem ordem pendente');
  });
});

// A2-01 (revisao completa, L2): o `-C` que decide o repositorio era o PRIMEIRO do comando, nao o do `git commit`.
test('A2-01: pastaDoComando le o -C do proprio git commit, nao o de outro git antes dele', () => {
  assert.strictEqual(commit.pastaDoComando('git -C "/outro" status && git commit -m x'), null);
  assert.strictEqual(commit.pastaDoComando('git -C "/outro" status && git -C "/meu" commit -m x'), '/meu');
  assert.strictEqual(commit.pastaDoComando('git -C /outro status; cd "a b" && git commit'), 'a b');
  assert.strictEqual(commit.pastaDoComando('git commit -C HEAD'), null, 'o -C do commit e "reusar a mensagem"');
  // revisao cega do L2 (ronda 1, P2 do lado novo): "git commit" entre aspas nao e o commit; valor de -c com espaco
  assert.strictEqual(commit.pastaDoComando('echo "git commit" && git -C /repo commit -m x'), '/repo');
  assert.strictEqual(commit.pastaDoComando('git -c user.name="a b" -C /repo commit'), '/repo');
});

/** Um segundo repositorio, com src/grande.js mudado contra o HEAD. */
function comDoisRepos(fn) {
  comRepo(function (dir, tmp) {
    const outro = repo();
    try { fn(dir, tmp, outro); } finally { fs.rmSync(outro, { recursive: true, force: true }); }
  });
}

test('A2-01: git -C <outro> status && git commit mede o repositorio do commit, e nega', () => {
  comDoisRepos(function (dir, tmp, outro) {
    tocar(dir, tmp, 'src/pequeno.js');
    const r = commitar(dir, tmp, 'git -C "' + outro + '" status && git commit -m x');
    assert.ok(negou(r), 'o -C do status desviou a medida e o commit passou: ' + JSON.stringify(r.json));
    assert.ok(motivo(r).includes('"src/pequeno.js"'), motivo(r));
  });
});

// A9-03 (revisao completa, L2): o filtro "so os arquivos do repositorio do commit" (commit.js, `topoDoCommit`), o
// `check-ignore` do arquivo novo e o "e mais N" do MAX_CITADOS nao tinham teste.
test('A9-03: arquivo tocado em outro repositorio nao barra o commit deste; barra o commit de la', () => {
  comDoisRepos(function (dir, tmp, outro) {
    hook('marcar-trabalho.js', dir, tmp, { hook_event_name: 'PostToolUse', tool_name: 'Write',
      tool_input: { file_path: path.join(outro, 'src', 'grande.js') } });
    const aqui = commitar(dir, tmp, 'git commit -m x');
    assert.ok(!negou(aqui), 'o arquivo do outro repositorio barrou este commit: ' + JSON.stringify(aqui.json));
    const la = commitar(dir, tmp, 'git -C "' + outro + '" commit -m x');
    assert.ok(negou(la), 'o commit no outro repositorio passou sem revisao: ' + JSON.stringify(la.json));
  });
});

test('A9-03: arquivo novo que o .gitignore ignora nao barra o commit', () => {
  comRepo(function (dir, tmp) {
    fs.writeFileSync(path.join(dir, '.gitignore'), 'gerado.js\n');
    fs.writeFileSync(path.join(dir, 'gerado.js'), 'x\n');
    tocar(dir, tmp, 'gerado.js');
    const r = commitar(dir, tmp, 'git commit -m x');
    assert.ok(!negou(r), 'o arquivo ignorado barrou o commit: ' + JSON.stringify(r.json));
  });
});

test('A9-03: com mais de 5 pendentes, o motivo cita 5 e diz "e mais N"', () => {
  comRepo(function (dir, tmp) {
    for (let i = 1; i <= 6; i++) {
      fs.writeFileSync(path.join(dir, 'src', 'n' + i + '.js'), 'x\n');
      tocar(dir, tmp, 'src/n' + i + '.js');
    }
    const r = commitar(dir, tmp, 'git commit -m x');
    assert.ok(negou(r), JSON.stringify(r.json));
    const linhas = motivo(r).split('\n').filter(function (l) { return /^ {2}- "src\/n\d\.js"/.test(l); });
    assert.strictEqual(linhas.length, 5, motivo(r));
    assert.ok(motivo(r).split('\n').indexOf('  - e mais 1') !== -1, motivo(r));
  });
});

// A2-30 (D721): o `git ... commit` numa fonte so; o pastaDoComando (\bgit) achava "git" dentro de "x-git".
test('A2-30 (D721): pastaDoComando acha o mesmo git commit que o ehCommit', () => {
  assert.strictEqual(commit.ehCommit('x-git commit'), false);
  // A2-10 (H1): o -C relativo roda a partir do cd de antes
  assert.strictEqual(commit.pastaDoComando('cd a && x-git commit; git -C b commit -m y'), 'a/b');
  assert.strictEqual(commit.pastaDoComando('git -c user.name="a b" -C repo commit -m x'), 'repo');
  assert.strictEqual(commit.pastaDoComando('cd "x y" && echo "git -C z commit" && git commit'), 'x y');
});

// A2-12 (H1): o pendentes pergunta a raiz uma vez por pasta (`rev-parse --show-toplevel`) e, por repositorio, mede
// todos os arquivos de uma vez: `ls-tree` (blob do HEAD), `ls-files` (o novo que o git nao ignora) e `diff --numstat`
// (o tamanho da mudanca). O que o lote nao respondeu se mede um a um, pelo caminho de antes (cat-file, check-ignore,
// diff). O gravador guarda as duas primeiras palavras de cada git.
const SO_A_RAIZ = 'rev-parse --show-toplevel';
const DO_LOTE = ['ls-tree -z', 'ls-files -z', 'diff --numstat'];
// H1-custo (D868): o texto do HEAD dos JS e TS que diferem dele, para a conta do so-comentario, num git por repositorio
const DO_SO_COMENTARIO = 'grep -n';
// `troca(args)`: devolve o resultado falso de um git, ou undefined para o git de verdade.
function gitsDoPendentes(dir, arquivos, troca, tetos, marcas) {
  const cp = require('node:child_process');
  const original = cp.spawnSync;
  const vistos = [];
  cp.spawnSync = function (cmd, args) {
    if (cmd === 'git' && Array.isArray(args)) {
      vistos.push(args.slice(0, 2).join(' '));
      const falso = troca && troca(args);
      if (falso) return falso;
    }
    return original.apply(this, arguments);
  };
  try {
    return { lista: commit.pendentes(arquivos, [], dir, null, null, marcas || [], tetos), vistos: vistos };
  } finally { cp.spawnSync = original; }
}
function quantos(vistos, nome) { return vistos.filter(function (v) { return v === nome; }).length; }
// O resultado do spawnSync de um git que estourou o prazo.
const ESTOURO = { status: null, signal: 'SIGTERM', stdout: '', stderr: '',
  error: Object.assign(new Error('spawnSync git ETIMEDOUT'), { code: 'ETIMEDOUT' }) };
const MEDIDA = function (p) { return [p.rel, p.faixa, p.inspetores]; };
const ESPERADO = [['src/grande.js', 'completa', 10], ['src/pequeno.js', 'uma', 1], ['src/novo.js', 'completa', 10]];

test('A2-12: pendentes mede os arquivos de um repositorio num lote (5 gits para 3 arquivos: a raiz, o lote e o so-comentario), e a lista sai a mesma', () => {
  comRepo(function (dir) {
    const arquivos = ['src/grande.js', 'src/pequeno.js', 'src/novo.js', 'LEIA.md'].map(function (r) { return path.join(dir, r); });
    const r = gitsDoPendentes(dir, arquivos);
    const lista = r.vistos.join(' | ');
    assert.deepStrictEqual(r.lista.map(MEDIDA), ESPERADO);
    assert.deepStrictEqual(r.vistos, [SO_A_RAIZ].concat(DO_LOTE, [DO_SO_COMENTARIO]),
      'a raiz da pasta src, o lote e um so-comentario para os .js mudados; o LEIA.md nenhum: ' + lista);
  });
});

test('A2-12: mais arquivos no mesmo repositorio nao gastam mais git: um de raiz por pasta, o lote e o so-comentario', () => {
  comRepo(function (dir) {
    for (let i = 0; i < 6; i++) fs.writeFileSync(path.join(dir, 'src', 'n' + i + '.js'), 'x\n');
    fs.mkdirSync(path.join(dir, 'lib'));
    fs.writeFileSync(path.join(dir, 'lib', 'm.js'), 'y\n');
    const rels = ['src/grande.js', 'src/pequeno.js', 'lib/m.js'].concat([0, 1, 2, 3, 4, 5].map(function (i) { return 'src/n' + i + '.js'; }));
    const r = gitsDoPendentes(dir, rels.map(function (x) { return path.join(dir, x); }));
    assert.deepStrictEqual(r.lista.map(function (p) { return p.rel; }), rels, 'na ordem em que foram tocados');
    assert.strictEqual(quantos(r.vistos, SO_A_RAIZ), 2, 'uma raiz por pasta (src e lib): ' + r.vistos.join(' | '));
    assert.strictEqual(r.vistos.length, 6, 'as raizes, o lote e o so-comentario: ' + r.vistos.join(' | '));
  });
});

test('A2-12: o lote acerta o ignorado, o igual ao HEAD (so fim de linha) e o binario', () => {
  comRepo(function (dir) {
    fs.writeFileSync(path.join(dir, '.gitignore'), 'gerado/\n');
    fs.mkdirSync(path.join(dir, 'gerado'));
    fs.writeFileSync(path.join(dir, 'gerado', 'x.js'), 'x\n');
    // so o fim de linha mudou: igual ao HEAD pelo --ignore-cr-at-eol, como no diff de um a um
    const pequeno = fs.readFileSync(path.join(dir, 'src', 'pequeno.js'), 'utf8');
    fs.writeFileSync(path.join(dir, 'src', 'pequeno.js'), pequeno.replace('mudou\n', 'b9\n').replace(/\n/g, '\r\n'));
    const rels = ['gerado/x.js', 'src/pequeno.js', 'src/novo.js'];
    const r = gitsDoPendentes(dir, rels.map(function (x) { return path.join(dir, x); }));
    assert.deepStrictEqual(r.lista.map(function (p) { return p.rel; }), ['src/novo.js'], r.vistos.join(' | '));
  });
});

test('A2-12: o git do lote que falha cai no caminho de um a um, e a lista sai a mesma', () => {
  for (const quebra of DO_LOTE) {
    comRepo(function (dir) {
      const arquivos = ['src/grande.js', 'src/pequeno.js', 'src/novo.js'].map(function (r) { return path.join(dir, r); });
      const falha = { status: 128, signal: null, stdout: '', stderr: 'fatal: x' };
      const r = gitsDoPendentes(dir, arquivos, function (args) { return args.slice(0, 2).join(' ') === quebra ? falha : undefined; });
      assert.deepStrictEqual(r.lista.map(MEDIDA), ESPERADO, quebra + ': ' + r.vistos.join(' | '));
    });
  }
  // o estouro do prazo no lote tambem: o arquivo nunca sai da lista porque o git demorou
  comRepo(function (dir) {
    const arquivos = ['src/grande.js', 'src/novo.js'].map(function (r) { return path.join(dir, r); });
    const r = gitsDoPendentes(dir, arquivos, function (args) { return args[0] === 'ls-tree' ? ESTOURO : undefined; });
    assert.deepStrictEqual(r.lista.map(function (p) { return p.rel; }), ['src/grande.js', 'src/novo.js']);
    assert.strictEqual(quantos(r.vistos, 'cat-file -e'), 2, 'sem o lote, o HEAD de cada arquivo: ' + r.vistos.join(' | '));
  });
});

test('A2-12: o blob do teto sai do lote (sem um rev-parse HEAD:<arquivo> a mais), e o teto segue valendo', () => {
  comRepo(function (dir) {
    const abs = path.join(dir, 'src', 'pequeno.js');
    const tetos = commit.comTeto({}, abs);
    const r = gitsDoPendentes(dir, [abs], null, tetos);
    assert.deepStrictEqual(r.lista.map(function (p) { return [p.rel, p.teto]; }), [['src/pequeno.js', true]]);
    assert.deepStrictEqual(r.vistos.filter(function (v) { return v.startsWith('rev-parse'); }), [SO_A_RAIZ], r.vistos.join(' | '));
  });
});

test('A2-12: o diff de um arquivo so roda quando ele tem atalho sem gatilho, e as linhas novas seguem certas', () => {
  comRepo(function (dir) {
    const marcas = require('../scripts/lib/atalhos.js').marcas({});
    const arquivos = ['src/grande.js', 'src/pequeno.js'].map(function (r) { return path.join(dir, r); });
    const sem = gitsDoPendentes(dir, arquivos, null, null, marcas);
    assert.strictEqual(quantos(sem.vistos, 'diff --no-color'), 0, 'sem atalho, nenhum diff de um a um: ' + sem.vistos.join(' | '));
    // o atalho acrescentado sem "trocar quando" sai com a linha dele
    fs.appendFileSync(path.join(dir, 'src', 'pequeno.js'), '// atalho: x. limite: y.\n');
    const com = gitsDoPendentes(dir, arquivos, null, null, marcas);
    assert.deepStrictEqual(com.lista.map(function (p) { return [p.rel, p.atalhos]; }), [['src/grande.js', []], ['src/pequeno.js', [11]]]);
    assert.strictEqual(quantos(com.vistos, 'diff --no-color'), 1, 'so o pequeno: ' + com.vistos.join(' | '));
  });
});

test('A2-12: no lote, so o modo mudado (0 e 0) e igual ao HEAD, e o binario (- e -) e mudanca sem tamanho medido', () => {
  comRepo(function (dir) {
    const abs = path.join(dir, 'src', 'pequeno.js');
    const falso = function (saida) {
      return function (args) {
        return args[0] === 'diff' && args[1] === '--numstat' ? { status: 0, signal: null, stdout: saida, stderr: '' } : undefined;
      };
    };
    assert.deepStrictEqual(gitsDoPendentes(dir, [abs], falso('0\t0\tsrc/pequeno.js\0')).lista, []);
    assert.deepStrictEqual(gitsDoPendentes(dir, [abs], falso('-\t-\tsrc/pequeno.js\0')).lista.map(MEDIDA),
      [['src/pequeno.js', 'completa', 10]]);
    assert.deepStrictEqual(gitsDoPendentes(dir, [abs], falso('3\t70\tsrc/pequeno.js\0')).lista.map(MEDIDA),
      [['src/pequeno.js', 'completa', 10]], 'a faixa sai do maior dos dois lados');
    assert.deepStrictEqual(gitsDoPendentes(dir, [abs], falso('')).lista, [], 'fora da saida do numstat: igual ao HEAD');
  });
});

test('A2-10: no gancho, a ferramenta da o idioma em que o comando se le', () => {
  comRepo(function (dir, tmp) {
    tocar(dir, tmp, 'src/grande.js');
    const rodar = function (ferramenta, comando) {
      const entrada = { hook_event_name: 'PreToolUse', tool_input: { command: comando } };
      if (ferramenta) entrada.tool_name = ferramenta;
      const r = hook('portao-commit.js', dir, tmp, entrada);
      let json = null;
      try { json = JSON.parse(r.stdout); } catch (e) { json = null; }
      return { status: r.status, json: json, stderr: r.stderr };
    };
    // no PowerShell a aspa fecha em "C:\x\", e a marca depois dela e comentario
    const marca = 'git commit -m "C:\\x\\" # sworn: sem-revisao';
    assert.ok(!negou(rodar('PowerShell', marca)), 'o PowerShell le a marca');
    assert.ok(negou(rodar('Bash', marca)), 'no bash a aspa nao fecha e a marca e texto dela');
    // no bash, a mesma aspa deixa o commit sem subcomando (e o bash nem roda o comando); sem ferramenta, as duas leituras
    const pasta = 'git -C "C:\\x\\" commit -m y';
    assert.ok(!negou(rodar('Bash', pasta)), 'no bash nao ha git commit');
    assert.ok(negou(rodar(null, pasta)), 'sem ferramenta, a leitura do PowerShell acha o commit');
  });
});

// D844 (pendencia #11): o git que nao responde no prazo nunca vira "fora do repositorio"; o arquivo entra como
// semResposta e o portao nega com o motivo do git lento, sem contar commit sem revisao nem dar a ordem de revisar.
const estouraARaiz = function (args) { return args[0] === 'rev-parse' && args[1] === '--show-toplevel' ? ESTOURO : undefined; };

test('D844: o git de raiz que estoura o prazo deixa os arquivos da pasta como semResposta', () => {
  comRepo(function (dir) {
    const arquivos = ['src/grande.js', 'src/novo.js', 'LEIA.md'].map(function (r) { return path.join(dir, r); });
    const r = gitsDoPendentes(dir, arquivos, estouraARaiz);
    const lista = r.vistos.join(' | ');
    assert.deepStrictEqual(r.lista, [{ rel: 'src/grande.js', semResposta: true }, { rel: 'src/novo.js', semResposta: true }],
      'o arquivo saiu da conta porque o git demorou: ' + lista);
    assert.strictEqual(quantos(r.vistos, SO_A_RAIZ), 1, 'a raiz se pergunta uma vez por pasta, mesmo estourando: ' + lista);
    assert.strictEqual(r.vistos.filter(function (v) { return /^(?:cat-file|diff|grep)/.test(v); }).length, 0,
      'sem o repositorio, nada se mede: ' + lista);
    assert.strictEqual(r.vistos.filter(function (v) { return DO_LOTE.indexOf(v) !== -1; }).length, 0, 'nem o lote: ' + lista);
  });
});

test('D844: a raiz que responde "fora do repositorio" (sem prazo estourado) segue deixando o arquivo de fora', () => {
  comRepo(function (dir) {
    const abs = path.join(dir, 'src', 'grande.js');
    const fora = { status: 128, signal: null, stdout: '', stderr: 'fatal: not a git repository' };
    const r = gitsDoPendentes(dir, [abs], function (args) {
      return args[0] === 'rev-parse' && args[1] === '--show-toplevel' ? fora : undefined;
    });
    assert.deepStrictEqual(r.lista, [], 'so o prazo estourado barra; fora do repositorio nunca conta (D575)');
  });
});

test('D844: o motivo do git lento cita o prazo, so os arquivos sem resposta e o SWORN_GIT_PRAZO_MS', () => {
  const lista = [{ rel: 'src/a.js', semResposta: true }, { rel: 'src/b.js', faixa: 'uma', inspetores: 1 }];
  const comeco = function (valor) {
    return comVariavel('SWORN_GIT_PRAZO_MS', valor, function () { return commit.motivoSemResposta(lista).split('\n')[0]; });
  };
  comVariavel('SWORN_GIT_PRAZO_MS', undefined, function () {
    assert.strictEqual(commit.motivoSemResposta(lista), [
      'sworn - commit parado: o git nao respondeu em 5 s ao conferir de que repositorio sao estes arquivos:',
      '  - "src/a.js"',
      'Nao e falta de revisao: sem a resposta do git, o portao nao sabe se o arquivo e deste repositorio.',
      '',
      'Faca agora:',
      '  1. repita o commit;',
      '  2. se ele parar de novo com este aviso, o git esta lento nesta maquina: ponha SWORN_GIT_PRAZO_MS',
      '     (um prazo maior, em milissegundos, por exemplo "30000") no bloco "env" do settings.json do Claude',
      '     Code, abra o Claude Code de novo e repita (o export num comando do shell nao chega ao portao).',
      'So o dono desliga esta parada do commit neste projeto: "portaoCommit": false em .claude/sworn/projeto.json.'
    ].join('\n'));
  });
  assert.match(comeco('30000'), / em 30 s /);
  assert.match(comeco('1500'), / em 1500 ms /);
  // o valor que nao e inteiro positivo fica com os 5 s do git.js, e o texto diz o prazo que valeu
  for (const torto of ['abc', '0', '-5', '', '2.5']) assert.match(comeco(torto), / em 5 s /, JSON.stringify(torto));
  // como o motivo da revisao, cita ate 5 e diz "e mais N"; entrada torta nao derruba
  const seis = Array.from({ length: 6 }, function (_, i) { return { rel: 'src/n' + i + '.js', semResposta: true }; });
  const linhas = commit.motivoSemResposta(seis).split('\n');
  assert.strictEqual(linhas.filter(function (l) { return /^ {2}- "src\/n\d\.js"$/.test(l); }).length, 5);
  assert.ok(linhas.indexOf('  - e mais 1') !== -1, linhas.join('\n'));
  assert.doesNotThrow(function () { commit.motivoSemResposta(null); });
});

test('D844: no gancho, o git que estoura o prazo nega o commit com o motivo dele, sem balde nem ordem de revisar', () => {
  comRepo(function (dir, tmp) {
    tocar(dir, tmp, 'src/grande.js');
    // o gancho roda no processo do teste: o spawnSync trocado faz estourar so as perguntas da raiz, sem depender do relogio
    const cp = require('node:child_process');
    const original = cp.spawnSync;
    cp.spawnSync = function (cmd, args) {
      const falso = cmd === 'git' && Array.isArray(args) ? estouraARaiz(args) : undefined;
      return falso || original.apply(this, arguments);
    };
    let res;
    try { res = commitar(dir, tmp, 'git commit -m x', null, { SWORN_GIT_PRAZO_MS: '5000' }); } finally { cp.spawnSync = original; }
    assert.strictEqual(res.porProcesso, false, 'o gancho tinha de rodar no processo do teste, onde o git falso vale');
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(negou(res), 'o commit passou sem revisao porque o git demorou: ' + JSON.stringify(res.json));
    assert.match(motivo(res), /^sworn - commit parado: o git nao respondeu em 5 s ao conferir/);
    assert.match(motivo(res), /\n {2}- "src\/grande\.js"\n/);
    const s = lerEstado(tmp);
    assert.strictEqual((s.contadores || {}).commit_sem_revisao, undefined, 'git lento nao e commit sem revisao');
    assert.strictEqual(s.ordensPendentes, undefined, 'git lento nao da a ordem de revisar');
  });
});

// A2-31 (D721): o pendentes usa o aprovado(): item da lista que nao e texto nao aprova nada.
test('A2-31 (D721): item torto na lista de aprovados nao libera o arquivo', () => {
  comRepo(function (dir) {
    const abs = path.join(dir, 'src', 'pequeno.js');
    assert.deepStrictEqual(commit.pendentes([abs], [[abs]], dir, null, null, []).map(function (p) { return p.rel; }),
      ['src/pequeno.js']);
    assert.deepStrictEqual(commit.pendentes([abs], [abs], dir, null, null, []), [], 'o texto segue aprovando');
  });
});

// H6e1 (15.0): a aprovacao fica presa ao conteudo que a revisao julgou (revisadosHash). O shell que muda o arquivo
// depois (o Edit ja tira a aprovacao no marcar-trabalho.js) volta a pender, com `mudou`; sem a marca, vale o caminho.
test('H6e1: o aprovado que mudou depois da revisao volta a pendente; o mesmo conteudo e o aprovado sem marca passam', () => {
  comRepo(function (dir) {
    const abs = path.join(dir, 'src', 'pequeno.js');
    const marca = { [abs]: commit.hashDoArquivo(abs) };
    assert.match(marca[abs], /^[0-9a-f]{64}$/, 'o hash e o sha-256 em hexadecimal');
    assert.deepStrictEqual(commit.pendentes([abs], [abs], dir, null, null, [], undefined, marca), [], 'o conteudo julgado passa');
    assert.deepStrictEqual(commit.pendentes([abs], [abs], dir, null, null, [], undefined, undefined), [], 'sem marca: o caminho');
    assert.deepStrictEqual(commit.pendentes([abs], [abs], dir, null, null, [], undefined, { [abs]: 7 }).map(function (p) { return p.mudou; }),
      ['conteudo'], 'marca que nao e texto (estado torto): volta a pendente, nunca libera');
    fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8') + '// mudou pelo shell\n');
    const lista = commit.pendentes([abs], [abs], dir, null, null, [], undefined, marca);
    assert.deepStrictEqual(lista.map(function (p) { return [p.rel, p.mudou]; }), [['src/pequeno.js', 'conteudo']]);
    assert.match(commit.motivo(lista), /\n {2}- "src\/pequeno\.js" +faixa \w+, \d+ inspetor(es)? \(a revisao aprovada julgou outro conteudo: o arquivo mudou depois dela, fora do Edit\)\n/);
    // o arquivo que nao se le nao diz "mudou": diz que a aprovacao nao se confere
    const ilegivel = commit.motivo([Object.assign({}, lista[0], { mudou: 'ilegivel' })]);
    assert.match(ilegivel, /"src\/pequeno\.js" .*\(a revisao aprovada nao se confere: o arquivo nao se le agora\)\n/);
    assert.doesNotMatch(ilegivel, /mudou depois/);
    assert.deepStrictEqual(commit.pendentes([abs], [abs], dir, null, null, [], undefined, { [abs.toUpperCase()]: marca[abs] })
      .map(function (p) { return p.mudou; }), process.platform === 'win32' ? ['conteudo'] : [], 'a marca acha o arquivo pela chave');
    assert.strictEqual(commit.pendentes([abs], [], dir, null, null, [], undefined, marca)[0].mudou, undefined,
      'sem aprovacao, nao e "mudou": e o pendente de sempre');
  });
});

// H6e1 (15.0): o tocado relativo (o git status da) se resolve na raiz, para o aprovado e para o hash; com o cwd do
// processo noutra pasta, o aprovado de mesmo conteudo passa e o mudado volta a pendente.
test('H6e1: o tocado relativo se confere na raiz, nao no cwd do processo', () => {
  comRepo(function (dir) {
    const abs = path.join(dir, 'src', 'pequeno.js');
    const marca = { [abs]: commit.hashDoArquivo(abs) };
    const antes = process.cwd();
    process.chdir(os.tmpdir());
    try {
      assert.deepStrictEqual(commit.pendentes(['src/pequeno.js'], [abs], dir, null, null, [], undefined, marca), [],
        'o aprovado relativo a raiz foi cobrado');
      fs.appendFileSync(abs, '// mudou pelo shell\n');
      assert.deepStrictEqual(commit.pendentes(['src/pequeno.js'], [abs], dir, null, null, [], undefined, marca)
        .map(function (p) { return p.mudou; }), ['conteudo']);
    } finally { process.chdir(antes); }
  });
});

// H6e1 (15.0): o hash em blocos de 64 KiB e o mesmo da conta inteira (a do preparar-revisao.js), acima de um bloco e vazio.
test('H6e1: hashDoArquivo em blocos confere com o sha-256 do arquivo inteiro', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-hash-'));
  try {
    const crypto = require('node:crypto');
    for (const [nome, bytes] of [['grande.bin', crypto.randomBytes(65536 * 2 + 17)], ['vazio.bin', Buffer.alloc(0)]]) {
      const f = path.join(pasta, nome);
      fs.writeFileSync(f, bytes);
      assert.strictEqual(commit.hashDoArquivo(f), crypto.createHash('sha256').update(bytes).digest('hex'), nome);
    }
  } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('H6e1: comHash troca a marca do arquivo, tira com hash vazio ou torto e ignora mapa torto', () => {
  const a = path.resolve('x', 'a.js');
  const b = path.resolve('x', 'b.js');
  assert.deepStrictEqual(commit.comHash({ [b]: 'hb' }, a, 'ha'), { [b]: 'hb', [a]: 'ha' });
  assert.deepStrictEqual(commit.comHash({ [a]: 'velho', [b]: 'hb' }, a, 'novo'), { [b]: 'hb', [a]: 'novo' });
  assert.deepStrictEqual(commit.comHash({ [a]: 'velho' }, a, null), {});
  assert.deepStrictEqual(commit.comHash({ [a]: 'velho' }, a, ''), {});
  assert.deepStrictEqual(commit.comHash(['torto'], a, 'ha'), { [a]: 'ha' });
  assert.strictEqual(commit.hashDoArquivo(path.join(os.tmpdir(), 'sworn-nao-existe-' + process.pid + '.js')), null);
  assert.strictEqual(commit.mudouDepois(null, a), false);
  assert.strictEqual(commit.mudouDepois({ [a]: 'qualquer' }, a), 'ilegivel', 'o arquivo que nao se le nao se confere');
  assert.strictEqual(commit.mudouDepois({ [b]: 'hb' }, a), false, 'sem a marca do arquivo vale o caminho');
  for (const torta of [null, 7, {}, '']) {
    assert.strictEqual(commit.mudouDepois({ [a]: torta }, a), 'conteudo', 'marca torta volta a pendente: ' + JSON.stringify(torta));
  }
});

// F1d (D828.4): com "provaPorArquivoTocado": true, o portao do commit cobra a suite inteira (a provaDePronto) depois da
// ultima edicao de codigo da sessao, terminada e verde; vale tambem com a marca de commit sem revisao.
test('F1d: com provaPorArquivoTocado, o commit espera a suite inteira verde depois da ultima edicao', () => {
  comRepo(function (dir, tmp) {
    const PROVA = 'node --test test/*.test.js';
    // Nenhum caso marca arquivo tocado no estado da sessao: a parte da revisao do portao nao tem o que cobrar, e
    // so a suite decide.
    const projeto = function (extra) {
      fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'),
        JSON.stringify(Object.assign({ provaDePronto: PROVA }, extra)));
    };
    let n = 0;
    const transcrito = function (linhas) {
      const f = path.join(tmp, 't' + (n++) + '.jsonl');
      fs.writeFileSync(f, linhas.map(function (l) { return JSON.stringify(l); }).join('\n') + '\n');
      return f;
    };
    const cmd = function (id, c, extra) { return { type: 'assistant', message: { content: [{ type: 'tool_use', id: id, name: 'Bash', input: Object.assign({ command: c }, extra) }] } }; };
    const res = function (id, c, erro) { return { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: c, is_error: erro === true }] } }; };
    const edita = function (id) { return { type: 'assistant', message: { content: [{ type: 'tool_use', id: id, name: 'Edit', input: { file_path: path.join(dir, 'src', 'pequeno.js') } }] } }; };
    const tentar = function (f, comando) { return commitar(dir, tmp, comando || 'git commit -m "x"', f); };
    // negou com o motivo da suite: o motivo so e lido depois de conferir a negacao, para a falha dizer o caso
    const negouPelaSuite = function (r, estado, caso) {
      assert.ok(negou(r), caso + ': o commit devia ser negado; saida: ' + JSON.stringify(r.json) + ' ' + r.stderr);
      assert.match(motivo(r), /sworn - portao de commit \(a suite inteira antes do commit\)\./, caso);
      assert.match(motivo(r), estado, caso);
    };
    // passou de verdade: o portao terminou com 0 e sem erro (um portao que quebra libera pelo blindar, com stderr)
    const passou = function (r, caso) {
      assert.strictEqual(r.status, 0, caso + ': status');
      assert.strictEqual(String(r.stderr || '').trim(), '', caso + ': o portao escreveu erro');
      assert.ok(!negou(r), caso + ': o commit devia passar; motivo: ' + (r.json ? motivo(r) : ''));
    };
    const NAO_RODOU = /A suite inteira nao rodou depois da ultima edicao de codigo\./;
    projeto({ provaPorArquivoTocado: true });
    const semSuite = tentar(transcrito([edita('e'), cmd('a', 'node --test test/x.test.js'), res('a', '# fail 0')]));
    negouPelaSuite(semSuite, NAO_RODOU, 'sem a suite');
    assert.match(motivo(semSuite), /node --test test\/\*\.test\.js/);
    const foraDoAscii = motivo(semSuite).match(/[^\x20-\x7E\n]/);
    assert.strictEqual(foraDoAscii, null, 'o motivo tem de ser ASCII; achou ' + JSON.stringify(foraDoAscii && foraDoAscii[0]));
    // a suite verde ANTES da ultima edicao nao vale: nega igual
    negouPelaSuite(tentar(transcrito([cmd('a', PROVA), res('a', '# pass 9\n# fail 0'), edita('e')])), NAO_RODOU,
      'suite verde antes da edicao');
    // a marca de commit sem revisao dispensa a revisao, nao a suite
    negouPelaSuite(tentar(transcrito([edita('e')]), 'git commit -m "x" # sworn: sem-revisao'), NAO_RODOU, 'marca sem-revisao');
    // a suite vermelha depois da edicao tambem nega
    negouPelaSuite(tentar(transcrito([edita('e'), cmd('a', PROVA), res('a', 'Exit code 1\n# fail 2', true)])),
      /A ultima rodada da suite inteira falhou\./, 'suite vermelha');
    // a suite lancada em segundo plano, sem o aviso de fim, ainda roda
    negouPelaSuite(tentar(transcrito([edita('e'), cmd('b', PROVA, { run_in_background: true }),
      res('b', 'Command running in background with ID: b1')])), /A suite inteira ainda roda/, 'suite em segundo plano');
    // verde depois da edicao: passa
    passou(tentar(transcrito([edita('e'), cmd('a', PROVA), res('a', '# pass 9\n# fail 0')])), 'verde depois da edicao');
    // sem o transcrito, o portao nao tem como ver a suite: passa (como o resto do portao, nao inventa falta)
    passou(tentar(null), 'sem transcrito');
    // sem a chave, o portao nao cobra a suite
    projeto({});
    passou(tentar(transcrito([edita('e')])), 'sem a chave');
    // "portaoCommit": false desliga o portao inteiro, a cobranca da suite tambem
    projeto({ provaPorArquivoTocado: true, portaoCommit: false });
    passou(tentar(transcrito([edita('e')])), 'portaoCommit false');
  });
});

// D875: o .js gravado fora do projeto depois da suite (o script auxiliar do scratchpad) so pede a suite de novo se o
// codigo do repositorio mudou desde o lancamento dela; o lancamento grava a impressao pelo PreToolUse deste portao.
test('D875: a edicao fora do projeto depois da suite passa o commit enquanto o codigo do repositorio nao mudar', () => {
  comRepo(function (dir, tmp) {
    const PROVA = 'node --test test/*.test.js';
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'),
      JSON.stringify({ provaDePronto: PROVA, provaPorArquivoTocado: true }));
    const fora = path.join(tmp, 'auxiliar.js');
    const t = path.join(tmp, 't.jsonl');
    fs.writeFileSync(t, [
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'Bash', input: { command: PROVA } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: '# pass 9\n# fail 0' }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'w', name: 'Write', input: { file_path: fora } }] } }
    ].map(function (l) { return JSON.stringify(l); }).join('\n') + '\n');
    const tentar = function () { return commitar(dir, tmp, 'git commit -m "x"', t); };
    const NAO_RODOU = /A suite inteira nao rodou depois da ultima edicao de codigo\./;
    // sem a impressao gravada no lancamento: a edicao de fora conta como antes
    const antes = tentar();
    assert.ok(negou(antes) && NAO_RODOU.test(motivo(antes)), 'sem impressao: ' + JSON.stringify(antes.json));
    // o lancamento da suite pelo gancho grava a impressao (outro comando nao grava)
    const lancar = function (id, comando) {
      return hook('portao-commit.js', dir, tmp, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: id,
        tool_input: { command: comando } });
    };
    assert.strictEqual(lancar('z', 'ls').status, 0);
    const semEstado = !fs.existsSync(path.join(tmp, 'sworn', 'c1.json'));
    assert.ok(semEstado || lerEstado(tmp).impressoesDaProva === undefined, 'o ls nao e a prova');
    assert.strictEqual(lancar('a', PROVA).status, 0);
    assert.deepStrictEqual(lerEstado(tmp).impressoesDaProva.map(function (x) { return [x.id, x.comando]; }), [['a', PROVA]]);
    const r = tentar();
    assert.ok(!negou(r), 'impressao igual: o commit passa; motivo: ' + (r.json ? motivo(r) : ''));
    // o git add nao muda a impressao
    const add = spawnSync('git', ['add', '-A'], { cwd: dir, shell: false, encoding: 'utf8' });
    assert.strictEqual(add.status, 0, 'git add: ' + add.stderr);
    assert.ok(!negou(tentar()), 'depois do git add, ainda igual');
    // a prova lancada junto do push (ou do commit) tambem grava, qualquer que seja a resposta do portao ao push
    lancar('p', PROVA + ' && git push');
    assert.deepStrictEqual(lerEstado(tmp).impressoesDaProva.map(function (x) { return x.id; }), ['a', 'p'], 'junto do push');
    // o codigo mudado sem ferramenta de edicao (como o sed -i ou o script que grava no repositorio) muda a impressao
    fs.writeFileSync(path.join(dir, 'src', 'pequeno.js'), 'mudou pelo shell\n');
    const depois = tentar();
    assert.ok(negou(depois) && NAO_RODOU.test(motivo(depois)), 'codigo mudado: ' + JSON.stringify(depois.json));
  });
});

// ---------------------------------------------------------------- F2a (D828.3): o teto da revisao no portao do commit

// O apurar-ronda.js grava em `revisadosNoTeto` o arquivo cuja revisao fechou no teto, com o blob dele no HEAD daquela
// hora ('' no arquivo novo). A marca vale enquanto o HEAD do arquivo for esse: editar nao a tira (o conserto depois do
// teto e esperado), o commit feito a vence.
const blobNoHead = function (dir, rel) {
  return spawnSync('git', ['rev-parse', '--verify', '-q', 'HEAD:' + rel], { cwd: dir, encoding: 'utf8', shell: false }).stdout.trim();
};
function noEstado(tmp, fn) {
  comVariavel('SWORN_TMP', tmp, function () {
    require('../scripts/lib/estado.js').alterar('c1', function (s) { fn(s); return s; });
  });
}
/** Marca no estado da sessao c1 a revisao fechada no teto de cada arquivo, com o HEAD de agora. */
function marcarTeto(dir, tmp, rels) {
  noEstado(tmp, function (s) {
    const marcas = {};
    for (const rel of rels) marcas[path.join(dir, rel)] = blobNoHead(dir, rel);
    s.revisadosNoTeto = marcas;
  });
}
const MOTIVO_DO_TETO = function (nomes, comAtalho) {
  return [
    'sworn - commit parado: a revisao destes arquivos fechou no teto de 3 rondas, sem aprovar.',
    '',
    'Arquivos de codigo com a revisao fechada no teto:'
  ].concat(nomes, comAtalho || [], [
    '',
    'Nao pergunte ao usuario. Faca agora:',
    '  1. confira que cada conserto feito depois do teto tem um teste que reprova quando o codigo e',
    '     estragado de proposito;',
    '  2. rode a suite inteira e espere o verde;',
    '  3. registre no plano o que a revisao deixou aberto;'
  ], comAtalho ? ['  4. escreva "trocar quando: ..." em cada atalho listado;'] : [], [
    '  ' + (comAtalho ? 5 : 4) + '. repita o commit com "# sworn: sem-revisao" no fim do comando.',
    'So o dono desliga esta parada do commit neste projeto: "portaoCommit": false em .claude/sworn/projeto.json.'
  ]).join('\n');
};

test('F2a (D828.3): com todos os pendentes fechados no teto, o motivo manda commitar com a marca, sem perguntar', () => {
  comRepo(function (dir, tmp) {
    tocar(dir, tmp, 'src/grande.js');
    tocar(dir, tmp, 'src/novo.js');
    assert.strictEqual(blobNoHead(dir, 'src/novo.js'), '', 'o novo.js nao esta no HEAD');
    marcarTeto(dir, tmp, ['src/grande.js', 'src/novo.js']);
    const r = commitar(dir, tmp, 'git commit -m "fix: x"');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(negou(r), 'sem a marca o commit passou: ' + JSON.stringify(r.json));
    assert.strictEqual(motivo(r), MOTIVO_DO_TETO(['  - "src/grande.js"', '  - "src/novo.js"']));
    assert.strictEqual(motivo(r).match(/[^\x20-\x7E\n]/), null, 'o motivo tem de ser ASCII');
    assert.strictEqual(lerEstado(tmp).contadores.commit_sem_revisao, 1, 'o balde do portao conta a negacao');
    assert.strictEqual(lerEstado(tmp).contadores.ordem_revisar_dada, undefined, 'no teto nao ha ordem de revisar');
    assert.strictEqual(lerEstado(tmp).ordensPendentes, undefined, 'no teto nao se grava ordem pendente');
    assert.ok(!negou(commitar(dir, tmp, 'git commit -m "fix: x" # sworn: sem-revisao')), 'a marca nao liberou');
  });
});

test('F2a (D828.3): pendente no teto ao lado de pendente sem revisao: a revisao e so do segundo, e o teto e dito', () => {
  comRepo(function (dir, tmp) {
    for (const rel of ['src/grande.js', 'src/pequeno.js', 'src/novo.js']) tocar(dir, tmp, rel);
    marcarTeto(dir, tmp, ['src/grande.js']);
    const r = commitar(dir, tmp, 'git commit -m x');
    assert.ok(negou(r), JSON.stringify(r.json));
    assert.strictEqual(motivo(r), [
      'sworn - commit parado: falta a revisao antes do commit.',
      '',
      'Arquivos de codigo mudados nesta sessao sem revisao aprovada',
      '(faixa: o tamanho da revisao; inspetores: quantos revisores ela chama):',
      '  - "src/pequeno.js"   faixa uma, 1 inspetor',
      '  - "src/novo.js"      faixa completa, 10 inspetores',
      'Com a revisao fechada no teto de 3 rondas (nao se revisam de novo):',
      '  - "src/grande.js"',
      '',
      'Faca agora:',
      '  1. rode /sworn:review "<arquivo>" so nos arquivos sem revisao aprovada (os do teto nao), ate sair "aprovado";',
      '  2. rode o commit de novo: ele para mais uma vez e diz o que fazer com os do teto.',
      'Se o usuario quer este commit sem revisao, pergunte em 3 opcoes; com o sim,',
      'repita o commit com "# sworn: sem-revisao" no fim do comando.',
      'So o dono desliga esta parada do commit neste projeto: "portaoCommit": false em .claude/sworn/projeto.json.'
    ].join('\n'));
    assert.strictEqual(lerEstado(tmp).contadores.ordem_revisar_dada, 1, 'ha arquivo por revisar: a ordem conta');
  });
});

test('F2a (D828.3): a marca do teto vale com o arquivo editado de novo e vence quando o HEAD dele muda', () => {
  comRepo(function (dir, tmp) {
    const g = function (args) { return spawnSync('git', args, { cwd: dir, encoding: 'utf8', shell: false }); };
    tocar(dir, tmp, 'src/pequeno.js');
    tocar(dir, tmp, 'src/novo.js');
    marcarTeto(dir, tmp, ['src/pequeno.js', 'src/novo.js']);
    // o conserto depois do teto: o arquivo muda de novo, a marca segue
    fs.writeFileSync(path.join(dir, 'src', 'pequeno.js'), 'consertado\n');
    tocar(dir, tmp, 'src/pequeno.js');
    assert.strictEqual(motivo(commitar(dir, tmp, 'git commit -m x')), MOTIVO_DO_TETO(['  - "src/pequeno.js"', '  - "src/novo.js"']));
    // o commit saiu: o HEAD dos dois e outro, e a mudanca seguinte pede revisao como qualquer uma
    g(['add', 'src/pequeno.js', 'src/novo.js']);
    assert.strictEqual(g(['commit', '-qm', 'no teto']).status, 0);
    assert.ok(!negou(commitar(dir, tmp, 'git commit -m x')), 'igual ao HEAD: nada a cobrar');
    fs.writeFileSync(path.join(dir, 'src', 'pequeno.js'), 'consertado de novo\n');
    fs.writeFileSync(path.join(dir, 'src', 'novo.js'), 'y\n');
    tocar(dir, tmp, 'src/pequeno.js');
    tocar(dir, tmp, 'src/novo.js');
    assert.strictEqual(motivo(commitar(dir, tmp, 'git commit -m x')), motivoDoMock([
      '  - "src/pequeno.js"   faixa uma, 1 inspetor',
      '  - "src/novo.js"      faixa uma, 1 inspetor'
    ]));
  });
});

test('F2a (D828.3): no teto, o atalho novo sem gatilho segue cobrado, antes do commit com a marca', () => {
  comRepo(function (dir, tmp) {
    fs.writeFileSync(path.join(dir, 'src', 'novo.js'), 'x\n// atalho: so um fuso. limite: BRT.\n');
    tocar(dir, tmp, 'src/novo.js');
    marcarTeto(dir, tmp, ['src/novo.js']);
    assert.strictEqual(motivo(commitar(dir, tmp, 'git commit -m x')), MOTIVO_DO_TETO(['  - "src/novo.js"'], [
      'Atalho novo (simplificacao marcada no codigo) sem o "trocar quando:":',
      '  - "src/novo.js:2"'
    ]));
  });
});

test('F2a (D828.3): com mais de 5 arquivos no teto, o motivo cita 5 e diz "e mais N"', () => {
  comRepo(function (dir, tmp) {
    const rels = [];
    for (let i = 1; i <= 7; i++) {
      fs.writeFileSync(path.join(dir, 'src', 'n' + i + '.js'), 'x\n');
      tocar(dir, tmp, 'src/n' + i + '.js');
      rels.push('src/n' + i + '.js');
    }
    marcarTeto(dir, tmp, rels);
    assert.strictEqual(motivo(commitar(dir, tmp, 'git commit -m x')), MOTIVO_DO_TETO(rels.slice(0, 5)
      .map(function (rel) { return '  - "' + rel + '"'; }).concat(['  - e mais 2'])));
    // misto: 6 no teto e 1 sem revisao; a lista do teto tambem para em 5
    marcarTeto(dir, tmp, rels.slice(1));
    const linhas = motivo(commitar(dir, tmp, 'git commit -m x')).split('\n');
    const ini = linhas.indexOf('Com a revisao fechada no teto de 3 rondas (nao se revisam de novo):');
    assert.deepStrictEqual(linhas.slice(ini - 1, ini + 8), ['  - "src/n1.js"   faixa completa, 10 inspetores',
      'Com a revisao fechada no teto de 3 rondas (nao se revisam de novo):', '  - "src/n2.js"', '  - "src/n3.js"',
      '  - "src/n4.js"', '  - "src/n5.js"', '  - "src/n6.js"', '  - e mais 1', '']);
  });
});

test('F2a (D828.3): pendentes diz o teto de cada um; marca torta, de outro HEAD ou de outro arquivo nao vale', () => {
  comRepo(function (dir) {
    const grande = path.join(dir, 'src', 'grande.js');
    const novo = path.join(dir, 'src', 'novo.js');
    const blob = blobNoHead(dir, 'src/grande.js');
    assert.match(blob, /^[0-9a-f]{40,64}$/);
    const teto = function (marcas) {
      return commit.pendentes([grande, novo], [], dir, null, null, [], marcas).map(function (p) { return p.teto; });
    };
    const par = function (a, b) { const m = {}; m[grande] = a; m[novo] = b; return m; };
    assert.deepStrictEqual(teto(par(blob, '')), [true, true]);
    assert.deepStrictEqual(teto(undefined), [false, false], 'sem as marcas (chamador antigo)');
    assert.deepStrictEqual(teto(null), [false, false]);
    assert.deepStrictEqual(teto([grande, novo]), [false, false], 'lista nao e o mapa das marcas');
    assert.deepStrictEqual(teto('x'), [false, false]);
    assert.deepStrictEqual(teto(par('', blob)), [false, false], 'o blob de outro HEAD nao vale');
    assert.deepStrictEqual(teto(par(5, null)), [false, false], 'valor que nao e texto nao vale');
    assert.deepStrictEqual(teto(par(blob.slice(0, 12), undefined)), [false, false], 'blob pela metade nao vale');
    // o caminho se compara como o dos aprovados: sem diferenca de caixa
    const caixa = {};
    caixa[grande.toUpperCase()] = blob;
    assert.deepStrictEqual(teto(caixa), [true, false]);
  });
});

test('F2a (D828.3): comTeto grava o blob do HEAD de agora (vazio no arquivo novo) e semTeto tira a marca', () => {
  comRepo(function (dir) {
    const grande = path.join(dir, 'src', 'grande.js');
    const novo = path.join(dir, 'src', 'novo.js');
    const blob = blobNoHead(dir, 'src/grande.js');
    const esperado = function (pares) { const m = {}; for (const [k, v] of pares) m[path.resolve(k)] = v; return m; };
    const m1 = commit.comTeto(undefined, grande);
    assert.deepStrictEqual(m1, esperado([[grande, blob]]));
    const m2 = commit.comTeto(m1, novo);
    assert.deepStrictEqual(m2, esperado([[grande, blob], [novo, '']]));
    assert.deepStrictEqual(m1, esperado([[grande, blob]]), 'o comTeto nao mexe no mapa que recebeu');
    // marcar de novo o mesmo arquivo, com outra caixa, nao duplica
    assert.deepStrictEqual(Object.keys(commit.comTeto(m2, grande.toUpperCase())).length, 2);
    assert.deepStrictEqual(commit.semTeto(m2, grande.toUpperCase()), esperado([[novo, '']]));
    assert.deepStrictEqual(m2, esperado([[grande, blob], [novo, '']]), 'o semTeto nao mexe no mapa que recebeu');
    for (const torta of [['x'], 'x', null, 5]) {
      assert.deepStrictEqual(commit.comTeto(torta, novo), esperado([[novo, '']]), JSON.stringify(torta));
      assert.deepStrictEqual(commit.semTeto(torta, novo), {}, JSON.stringify(torta));
    }
  });
});

test('F2a (D828.3): fora de repositorio nao ha HEAD: a marca do teto sai vazia, como a do arquivo novo', (t) => {
  const fora = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-fora-'));
  try {
    if (spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: fora, encoding: 'utf8' }).status === 0) {
      // o salto aparece no relatorio dos testes, em vez de o teste passar sem conferir nada
      t.skip('a pasta temporaria do sistema esta dentro de um repositorio git');
      return;
    }
    const abs = path.join(fora, 'a.js');
    fs.writeFileSync(abs, 'x\n');
    const esperado = {};
    esperado[path.resolve(abs)] = '';
    assert.deepStrictEqual(commit.comTeto({}, abs), esperado);
  } finally {
    fs.rmSync(fora, { recursive: true, force: true });
  }
});

test('F2a (D828.3): o motivo, direto: 5 no teto cabem sem "e mais"; no misto o "e mais" e o atalho sao dos sem revisao; teto que nao e true nao vale', () => {
  const item = function (rel, teto, atalhos) {
    return { rel: rel, faixa: 'uma', inspetores: 1, atalhos: atalhos || [], teto: teto };
  };
  const BLOCO_DO_TETO = 'Com a revisao fechada no teto de 3 rondas (nao se revisam de novo):';
  // exatamente 5 no teto: os 5 citados, sem a linha "e mais 0"
  const cinco = [1, 2, 3, 4, 5].map(function (i) { return item('src/n' + i + '.js', true); });
  assert.strictEqual(commit.motivo(cinco), MOTIVO_DO_TETO(cinco.map(function (p) { return '  - "' + p.rel + '"'; })));
  // 6 sem revisao e 1 no teto: o "e mais" conta so os sem revisao
  const misto = [1, 2, 3, 4, 5, 6].map(function (i) { return item('src/s' + i + '.js', false); })
    .concat([item('src/t.js', true)]);
  const linhas = commit.motivo(misto).split('\n');
  const ini = linhas.indexOf(BLOCO_DO_TETO);
  assert.deepStrictEqual(linhas.slice(ini - 2, ini + 3),
    ['  - "src/s5.js"   faixa uma, 1 inspetor', '  - e mais 1', BLOCO_DO_TETO, '  - "src/t.js"', '']);
  // a marca do teto e so o true: outro valor e arquivo sem revisao, e nao aparece duas vezes
  for (const torta of ['sim', 1, {}, null, undefined]) {
    assert.strictEqual(commit.motivo([item('src/a.js', torta)]),
      motivoDoMock(['  - "src/a.js"   faixa uma, 1 inspetor']), JSON.stringify(torta));
  }
  // misto com atalho novo sem gatilho: o bloco do atalho e o passo dele seguem no texto
  assert.strictEqual(commit.motivo([item('src/a.js', false, [2]), item('src/t.js', true)]), [
    'sworn - commit parado: falta a revisao antes do commit.',
    '',
    'Arquivos de codigo mudados nesta sessao sem revisao aprovada',
    '(faixa: o tamanho da revisao; inspetores: quantos revisores ela chama):',
    '  - "src/a.js"   faixa uma, 1 inspetor',
    BLOCO_DO_TETO,
    '  - "src/t.js"',
    'Atalho novo (simplificacao marcada no codigo) sem o "trocar quando:":',
    '  - "src/a.js:2"',
    '',
    'Faca agora:',
    '  1. rode /sworn:review "<arquivo>" so nos arquivos sem revisao aprovada (os do teto nao), ate sair "aprovado";',
    '  2. escreva "trocar quando: ..." em cada atalho listado;',
    '  3. rode o commit de novo: ele para mais uma vez e diz o que fazer com os do teto.',
    'Se o usuario quer este commit sem revisao, pergunte em 3 opcoes; com o sim,',
    'repita o commit com "# sworn: sem-revisao" no fim do comando.',
    'So o dono desliga esta parada do commit neste projeto: "portaoCommit": false em .claude/sworn/projeto.json.'
  ].join('\n'));
});

// H1-custo (D868): o .js que difere do HEAD so em comentario ou espaco sai da lista do portao; o de codigo, o com
// atalho novo sem gatilho e todos quando o git grep falha seguem nela (fail-closed).
test('H1-custo: pendentes tira o .js so de comentario ou espaco e segue cobrando o de codigo e o atalho novo', () => {
  comRepo(function (dir) {
    const g = function (args) { return spawnSync('git', args, { cwd: dir, encoding: 'utf8', shell: false }); };
    const base = 'const a = 1; // um\n/* bloco */\nfunction f(x) { return x / 2; }\nmodule.exports = { a, f };\n';
    const nomes = ['comentado', 'espaco', 'codigo', 'atalho'];
    for (const n of nomes) fs.writeFileSync(path.join(dir, 'src', n + '.js'), base);
    fs.writeFileSync(path.join(dir, 'src', 'vazio.js'), '');
    g(['add', 'src/vazio.js'].concat(nomes.map(function (n) { return 'src/' + n + '.js'; })));
    g(['commit', '-qm', 'base']);
    fs.writeFileSync(path.join(dir, 'src', 'comentado.js'),
      base.replace('// um', '// o um, explicado').replace('/* bloco */', '/**\n * bloco novo,\n * em tres linhas\n */'));
    fs.writeFileSync(path.join(dir, 'src', 'espaco.js'),
      base.split('\n').map(function (l) { return l ? '    ' + l : l; }).join('\r\n') + '\r\n\r\n');
    fs.writeFileSync(path.join(dir, 'src', 'codigo.js'), base.replace('x / 2', 'x / 3') + '// e um comentario\n');
    fs.writeFileSync(path.join(dir, 'src', 'atalho.js'), base + '// atalho: sem o gatilho\n');
    // o arquivo novo (sem HEAD) so de comentario segue pendente: nao ha o antes para comparar
    fs.writeFileSync(path.join(dir, 'src', 'novo-comentado.js'), '// so comentario\n');
    // e o que era vazio no HEAD: o grep responde sem linha dele, e a falta do antes nao vira "so comentario"
    fs.writeFileSync(path.join(dir, 'src', 'vazio.js'), '// so comentario\n');
    const abs = nomes.concat(['novo-comentado', 'vazio']).map(function (n) { return path.join(dir, 'src', n + '.js'); });
    const lista = commit.pendentes(abs, [], dir, null, null, ['atalho']).map(function (p) { return p.rel; });
    assert.deepStrictEqual(lista, ['src/codigo.js', 'src/atalho.js', 'src/novo-comentado.js', 'src/vazio.js']);
    const todos = abs.map(function (a) { return 'src/' + path.basename(a); });
    // o grep que falha, o que estoura o prazo e o que nao casa nada deixam todos pendentes
    for (const [nome, falso] of [['falha', { status: 128, signal: null, stdout: '', stderr: 'fatal: x' }], ['prazo', ESTOURO],
      ['vazio', { status: 1, signal: null, stdout: '', stderr: '' }]]) {
      const r = gitsDoPendentes(dir, abs, function (args) { return args[0] === 'grep' ? falso : undefined; }, undefined, ['atalho']);
      assert.deepStrictEqual(r.lista.map(function (p) { return p.rel; }), todos, 'o grep ' + nome + ': ' + r.vistos.join(' | '));
    }
  });
});

// H1-custo (ronda 1): o nome com quebra de linha nao vai ao git grep (ele forjaria o texto do HEAD de outro arquivo).
test('H1-custo: o so-comentario deixa fora do grep o nome com quebra, e ele segue pendente', () => {
  const cp = require('node:child_process');
  const original = cp.spawnSync;
  const pedidos = [];
  cp.spawnSync = function (cmd, args) {
    if (cmd === 'git' && Array.isArray(args) && args[0] === 'grep') pedidos.push(args.slice());
    return { status: 1, signal: null, stdout: '', stderr: '' };
  };
  // o lote como o commit.lote o monta: `contas` por nome, com `linhas` numerico para o arquivo de texto medido
  const contas = new Map([['a.js', { linhas: 1 }], ['x\nHEAD:a.js', { linhas: 1 }]]);
  let fora;
  try {
    fora = commit.soComentarioNoLote(os.tmpdir(), { blobs: new Map(), vistos: null, contas: contas }, ['a.js', 'x\nHEAD:a.js']);
  } finally { cp.spawnSync = original; }
  assert.strictEqual(pedidos.length, 1, 'um grep');
  assert.ok(pedidos[0].indexOf(':(literal)a.js') !== -1, 'o a.js vai ao grep');
  assert.ok(!pedidos[0].some(function (a) { return /[\r\n]/.test(a); }), 'o nome com quebra fica fora: ' + JSON.stringify(pedidos[0]));
  assert.strictEqual(fora.size, 0, 'nenhum sai do portao: ' + JSON.stringify(Array.from(fora)));
});

// H1-custo (ronda 1): o erro do leitor deixa o arquivo pendente em vez de derrubar o portao.
test('H1-custo: se o leitor so-comentario lanca, o arquivo segue pendente', () => {
  comRepo(function (dir) {
    const g = function (args) { return spawnSync('git', args, { cwd: dir, encoding: 'utf8', shell: false }); };
    fs.writeFileSync(path.join(dir, 'src', 'c.js'), 'f(1);\n');
    g(['add', 'src/c.js']);
    g(['commit', '-qm', 'c']);
    fs.writeFileSync(path.join(dir, 'src', 'c.js'), 'f(1); // so comentario\n');
    const sc = require('../scripts/lib/so-comentario.js');
    const leitor = sc.soComentario;
    sc.soComentario = function () { throw new Error('leitor quebrado'); };
    let lista;
    try { lista = commit.pendentes([path.join(dir, 'src', 'c.js')], [], dir, null, null, []); } finally { sc.soComentario = leitor; }
    assert.deepStrictEqual(lista.map(function (p) { return p.rel; }), ['src/c.js']);
    assert.deepStrictEqual(commit.pendentes([path.join(dir, 'src', 'c.js')], [], dir, null, null, []), [], 'com o leitor, sai');
  });
});
