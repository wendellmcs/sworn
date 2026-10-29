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

const RAIZ = path.join(__dirname, '..');

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

test('commit: pastaDoComando le o -C e o ultimo cd antes do commit; sem nenhum, null', () => {
  assert.strictEqual(commit.pastaDoComando('git -C "C:/a b/repo" commit -m x'), 'C:/a b/repo');
  assert.strictEqual(commit.pastaDoComando('cd "x y" && git commit -m z'), 'x y');
  assert.strictEqual(commit.pastaDoComando("( cd 'p' && git commit )"), 'p');
  assert.strictEqual(commit.pastaDoComando('cd a && cd b && git commit'), 'b');
  assert.strictEqual(commit.pastaDoComando('git commit -m x'), null);
});

test('commit: inspetores pela faixa (D485): uma 1, duas 2, completa 10 de codigo e 8 de estilo', () => {
  assert.strictEqual(commit.inspetores('uma', false), 1);
  assert.strictEqual(commit.inspetores('duas', false), 2);
  assert.strictEqual(commit.inspetores('completa', false), 10);
  assert.strictEqual(commit.inspetores('completa', true), 8);
});

// ------------------------------- o gancho, num repositorio de verdade

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-commit-'));
  const g = function (args) { return spawnSync('git', args, { cwd: dir, encoding: 'utf8', shell: false }); };
  g(['init', '-q', '.']);
  g(['config', 'user.email', 'ensaio@ensaio']);
  g(['config', 'user.name', 'ensaio']);
  fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), '{}');
  fs.mkdirSync(path.join(dir, 'src'));
  const linhas = function (n, p) { return Array.from({ length: n }, function (_, i) { return p + i; }).join('\n') + '\n'; };
  fs.writeFileSync(path.join(dir, 'src', 'grande.js'), linhas(60, 'a'));
  fs.writeFileSync(path.join(dir, 'src', 'pequeno.js'), linhas(10, 'b'));
  fs.writeFileSync(path.join(dir, 'LEIA.md'), 'texto\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'base']);
  fs.writeFileSync(path.join(dir, 'src', 'grande.js'), linhas(60, 'z'));
  fs.writeFileSync(path.join(dir, 'src', 'pequeno.js'), linhas(9, 'b') + 'mudou\n');
  fs.writeFileSync(path.join(dir, 'src', 'novo.js'), 'x\n');
  fs.writeFileSync(path.join(dir, 'LEIA.md'), 'texto mudado\n');
  return dir;
}

function hook(script, dir, tmp, entrada) {
  return spawnSync(process.execPath, [path.join(RAIZ, 'scripts', script)], {
    input: JSON.stringify(Object.assign({ session_id: 'c1', cwd: dir }, entrada)),
    encoding: 'utf8', env: Object.assign({}, process.env, { SWORN_TMP: tmp })
  });
}

function tocar(dir, tmp, rel) {
  return hook('marcar-trabalho.js', dir, tmp, { hook_event_name: 'PostToolUse', tool_name: 'Write',
    tool_input: { file_path: path.join(dir, rel) } });
}

function commitar(dir, tmp, comando) {
  const r = hook('portao-commit.js', dir, tmp, { hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: comando } });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (e) { json = null; }
  return { status: r.status, json: json, stderr: r.stderr };
}

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
    'Desligar esta parada do commit neste projeto: "portaoCommit": false em .claude/sworn/projeto.json.'
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
      const comVariavel = commitar(dir, tmp, 'D="' + dir + '"; ( cd "$D" && git commit -m "x" )');
      assert.strictEqual(comVariavel.status, 0, comVariavel.stderr);
      assert.ok(!negou(comVariavel), 'cd "$D": o arquivo de fora barrou o commit: ' + JSON.stringify(comVariavel.json));
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
      'Desligar esta parada do commit neste projeto: "portaoCommit": false em .claude/sworn/projeto.json.'
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
    const anterior = process.env.SWORN_TMP;
    process.env.SWORN_TMP = tmp;
    try {
      const estado = require('../scripts/lib/estado.js');
      estado.alterar('c1', function (s) { s.revisadosAprovados = [path.join(dir, 'src', 'pequeno.js')]; return s; });
    } finally {
      if (anterior === undefined) delete process.env.SWORN_TMP; else process.env.SWORN_TMP = anterior;
    }
    assert.ok(!negou(commitar(dir, tmp, 'git commit -m x')), 'aprovado foi negado');
    tocar(dir, tmp, 'src/pequeno.js');
    const r = commitar(dir, tmp, 'git commit -m x');
    assert.ok(negou(r), 'editado depois de aprovado passou');
    assert.ok(motivo(r).indexOf('"src/pequeno.js"') !== -1, motivo(r));
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
  assert.strictEqual(commit.pastaDoComando('cd a && x-git commit; git -C b commit -m y'), 'b');
  assert.strictEqual(commit.pastaDoComando('git -c user.name="a b" -C repo commit -m x'), 'repo');
  assert.strictEqual(commit.pastaDoComando('cd "x y" && echo "git -C z commit" && git commit'), 'x y');
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
