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

test('commit: pastaDoComando le o -C e o ultimo cd antes do commit; sem nenhum, null', () => {
  assert.strictEqual(commit.pastaDoComando('git -C "C:/a b/repo" commit -m x'), 'C:/a b/repo');
  assert.strictEqual(commit.pastaDoComando('cd "x y" && git commit -m z'), 'x y');
  assert.strictEqual(commit.pastaDoComando("( cd 'p' && git commit )"), 'p');
  assert.strictEqual(commit.pastaDoComando('cd a && cd b && git commit'), 'b');
  assert.strictEqual(commit.pastaDoComando('git commit -m x'), null);
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

// F1h (0.45.0): o pendentes pergunta a raiz e o blob do HEAD num git so por arquivo de codigo; o texto nao gasta git.
// O git combinado e o `rev-parse --show-toplevel HEAD:./<arq>`; a reserva de antes e o `rev-parse --show-toplevel`
// sozinho (a raiz por pasta) mais o `cat-file -e` do arquivo. O gravador marca o combinado com ' HEAD:' para os dois
// nao se confundirem na contagem.
function ehRaizEBlob(args) {
  return args[0] === 'rev-parse' && args[1] === '--show-toplevel' && typeof args[2] === 'string' && args[2].startsWith('HEAD:');
}
const RAIZ_E_BLOB = 'rev-parse --show-toplevel HEAD:';
const SO_A_RAIZ = 'rev-parse --show-toplevel';
// `troca(args)`: devolve o resultado falso de um git, ou undefined para o git de verdade.
function gitsDoPendentes(dir, arquivos, troca, tetos) {
  const cp = require('node:child_process');
  const original = cp.spawnSync;
  const vistos = [];
  cp.spawnSync = function (cmd, args) {
    if (cmd === 'git' && Array.isArray(args)) {
      vistos.push(ehRaizEBlob(args) ? RAIZ_E_BLOB : args.slice(0, 2).join(' '));
      const falso = troca && troca(args);
      if (falso) return falso;
    }
    return original.apply(this, arguments);
  };
  try {
    return { lista: commit.pendentes(arquivos, [], dir, null, null, [], tetos), vistos: vistos };
  } finally { cp.spawnSync = original; }
}
function quantos(vistos, nome) { return vistos.filter(function (v) { return v === nome; }).length; }
// O resultado do spawnSync de um git que estourou o prazo.
const ESTOURO = { status: null, signal: 'SIGTERM', stdout: '', stderr: '',
  error: Object.assign(new Error('spawnSync git ETIMEDOUT'), { code: 'ETIMEDOUT' }) };

test('F1h: pendentes gasta um rev-parse de raiz e blob por arquivo de codigo, e a lista sai a mesma', () => {
  comRepo(function (dir) {
    const arquivos = ['src/grande.js', 'src/pequeno.js', 'src/novo.js', 'LEIA.md'].map(function (r) { return path.join(dir, r); });
    const r = gitsDoPendentes(dir, arquivos);
    const lista = r.vistos.join(' | ');
    assert.deepStrictEqual(r.lista.map(function (p) { return p.rel; }), ['src/grande.js', 'src/pequeno.js', 'src/novo.js']);
    assert.strictEqual(quantos(r.vistos, RAIZ_E_BLOB), 3, 'um git de raiz e blob por arquivo de codigo (3), o LEIA.md nenhum: ' + lista);
    assert.strictEqual(quantos(r.vistos, SO_A_RAIZ), 0, 'sem a pergunta da raiz sozinha, que era da reserva: ' + lista);
    assert.strictEqual(r.vistos.filter(function (v) { return v.startsWith('cat-file'); }).length, 0,
      'o blob do HEAD ja diz se o arquivo e novo, sem cat-file: ' + lista);
    // dois arquivos no HEAD medem pelo diff, o novo pelo check-ignore: 3 + 3 gits, o LEIA.md nenhum
    assert.strictEqual(r.vistos.length, 6, '3 de raiz e blob mais 3 de medida: ' + lista);
  });
});

test('F1h: o blob do teto sai do mesmo git (sem um rev-parse HEAD:<arquivo> a mais), e o teto segue valendo', () => {
  comRepo(function (dir) {
    const abs = path.join(dir, 'src', 'pequeno.js');
    const tetos = commit.comTeto({}, abs);
    const r = gitsDoPendentes(dir, [abs], null, tetos);
    assert.deepStrictEqual(r.lista.map(function (p) { return [p.rel, p.teto]; }), [['src/pequeno.js', true]]);
    assert.deepStrictEqual(r.vistos.filter(function (v) { return v.startsWith('rev-parse'); }), [RAIZ_E_BLOB],
      'um rev-parse so, o de raiz e blob: ' + r.vistos.join(' | '));
  });
});

test('F1h: o git de raiz e blob que estoura o prazo cai no caminho de antes, e o arquivo segue na lista', () => {
  comRepo(function (dir) {
    const arquivos = ['src/grande.js', 'src/novo.js'].map(function (r) { return path.join(dir, r); });
    // so o git combinado estoura; o da reserva responde (os dois estourando: os testes D844 abaixo)
    const estoura = function (args) { return ehRaizEBlob(args) ? ESTOURO : undefined; };
    const r = gitsDoPendentes(dir, arquivos, estoura);
    const lista = r.vistos.join(' | ');
    assert.deepStrictEqual(r.lista.map(function (p) { return p.rel; }), ['src/grande.js', 'src/novo.js'],
      'o arquivo nao pode sair da lista porque o git demorou: ' + lista);
    assert.strictEqual(quantos(r.vistos, RAIZ_E_BLOB), 2, 'o git combinado tentado uma vez por arquivo: ' + lista);
    assert.strictEqual(quantos(r.vistos, SO_A_RAIZ), 1, 'a reserva pergunta a raiz uma vez para a pasta src: ' + lista);
    assert.strictEqual(quantos(r.vistos, 'cat-file -e'), 2, 'a reserva confere o HEAD de cada arquivo: ' + lista);
  });
});

// D844 (pendencia #11): o git que nao responde no prazo nunca vira "fora do repositorio"; o arquivo entra como
// semResposta e o portao nega com o motivo do git lento, sem contar commit sem revisao nem dar a ordem de revisar.
const estouraARaiz = function (args) { return args[0] === 'rev-parse' && args[1] === '--show-toplevel' ? ESTOURO : undefined; };

test('D844: o git de raiz e blob e o da reserva estourando o prazo deixam o arquivo como semResposta', () => {
  comRepo(function (dir) {
    const arquivos = ['src/grande.js', 'src/novo.js', 'LEIA.md'].map(function (r) { return path.join(dir, r); });
    const r = gitsDoPendentes(dir, arquivos, estouraARaiz);
    const lista = r.vistos.join(' | ');
    assert.deepStrictEqual(r.lista, [{ rel: 'src/grande.js', semResposta: true }, { rel: 'src/novo.js', semResposta: true }],
      'o arquivo saiu da conta porque o git demorou: ' + lista);
    assert.strictEqual(quantos(r.vistos, SO_A_RAIZ), 1, 'a reserva pergunta uma vez por pasta, mesmo estourando: ' + lista);
    assert.strictEqual(r.vistos.filter(function (v) { return v.startsWith('cat-file') || v.startsWith('diff'); }).length, 0,
      'sem o repositorio, nada se mede: ' + lista);
  });
});

test('D844: a reserva que responde "fora do repositorio" (sem prazo estourado) segue deixando o arquivo de fora', () => {
  comRepo(function (dir) {
    const abs = path.join(dir, 'src', 'grande.js');
    const fora = { status: 128, signal: null, stdout: '', stderr: 'fatal: not a git repository' };
    const r = gitsDoPendentes(dir, [abs], function (args) {
      if (ehRaizEBlob(args)) return ESTOURO;
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
