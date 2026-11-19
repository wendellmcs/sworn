'use strict';
// F3a (D828): o portao-shell.js e o depois-do-shell.js rodam varios ganchos num processo so (io.rodarJuntos) e
// juntam as saidas (io.juntarSaidas). A prova de equivalencia: com a mesma entrada, o processo unico da o mesmo que
// os ganchos antigos, cada um sozinho, juntados.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const io = require('../scripts/lib/io.js');
const { pasta, rodar, repo } = require('./lib/comum.js');

const IO = path.join(__dirname, '..', 'scripts', 'lib', 'io.js');
const negar = (m) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: m } });
const contexto = (ev, m, extra) => ({ hookSpecificOutput: Object.assign({ hookEventName: ev, additionalContext: m }, extra) });

test('F3a: juntarSaidas - a 1a negacao vale e nada mais se soma a ela', () => {
  const j = io.juntarSaidas([contexto('PreToolUse', 'a'), negar('primeira'), negar('segunda')], 'PreToolUse');
  assert.deepStrictEqual(j, negar('primeira'));
});

test('F3a: juntarSaidas - contexto e aviso se somam, o updatedInput e o do 1o que o traz, sem nada e null', () => {
  const j = io.juntarSaidas([null, contexto('PreToolUse', 'um', { updatedInput: { command: 'x' } }),
    { systemMessage: 'ao dono' }, contexto('PreToolUse', 'dois', { updatedInput: { command: 'y' } }), 'torto'],
  'PreToolUse');
  assert.deepStrictEqual(j, { systemMessage: 'ao dono', hookSpecificOutput: { hookEventName: 'PreToolUse',
    additionalContext: 'um\n\ndois', updatedInput: { command: 'x' } } });
  assert.strictEqual(io.juntarSaidas([null, undefined, {}], 'PreToolUse'), null);
  assert.strictEqual(io.juntarSaidas([], 'PostToolUse'), null);
});

test('F3a: juntarSaidas - no PostToolUse o bloqueio vale e os motivos se somam', () => {
  const j = io.juntarSaidas([contexto('PostToolUse', 'marcou'), { decision: 'block', reason: 'voltou a.js',
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'voltou a.js' } }], 'PostToolUse');
  assert.deepStrictEqual(j, { decision: 'block', reason: 'voltou a.js',
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'marcou\n\nvoltou a.js' } });
});

// Ganchos de brinquedo, cada um um arquivo (o require carrega cada script uma vez so).
function ganchos(corpos) {
  const dir = pasta('ganchos-f3a');
  return corpos.map(function (corpo, i) {
    const f = path.join(dir, 'g' + i + '.js');
    fs.writeFileSync(f, "'use strict';\nconst io = require(" + JSON.stringify(IO) + ');\n' + corpo + '\n');
    return f;
  });
}

test('F3a: rodarJuntos - cada gancho le a mesma entrada (copia) e da a sua decisao, em ordem', () => {
  const fs2 = ganchos([
    // muda a propria copia: o seguinte nao ve
    'io.blindar(function () { io.lerEntrada(function (e) { e.tool_input.command = "mudado"; io.permitir(); }); });',
    'io.blindar(function () { io.lerEntrada(function (e) { io.negarFerramenta("viu " + e.tool_input.command); }); });',
    // sem decisao nenhuma: null, como o gancho sozinho que sai sem escrever
    'io.blindar(function () { io.lerEntrada(function () {}); });'
  ]);
  const saidas = io.rodarJuntos({ tool_input: { command: 'ls' } }, fs2);
  assert.deepStrictEqual(saidas, [null, negar('viu ls'), null]);
});

test('F3a: rodarJuntos - a 1a decisao vale mesmo com o gancho engolindo a parada', () => {
  const fs2 = ganchos([
    'io.blindar(function () { io.lerEntrada(function () { try { io.negarFerramenta("nega"); } catch (x) { /* engole */ } io.permitir({ systemMessage: "depois" }); }); });',
    'io.blindar(function () { io.lerEntrada(function () { io.permitir(' + JSON.stringify(contexto('PreToolUse', 'ok')) + '); }); });'
  ]);
  assert.deepStrictEqual(io.rodarJuntos({}, fs2), [negar('nega'), contexto('PreToolUse', 'ok')]);
});

// Num processo filho (no processo do teste, um process.exit levaria o relatorio junto): o gancho que quebra, dentro
// ou fora do blindar, libera sem opiniao, e nem encerra o processo nem leva a decisao dos outros.
test('F3a: rodarJuntos (processo) - o que quebra libera sem parar os outros nem apagar a negacao', () => {
  const gs = ganchos([
    'io.blindar(function () { io.lerEntrada(function () { io.negarFerramenta("nega"); }); });',
    'io.blindar(function () { io.lerEntrada(function () { throw new Error("quebrou"); }); });',
    'throw new Error("quebrou fora do blindar");',
    'io.blindar(function () { io.lerEntrada(function () { io.permitir(' + JSON.stringify(contexto('PreToolUse', 'ok')) + '); }); });'
  ]);
  const combinador = path.join(path.dirname(gs[0]), 'combinador.js');
  fs.writeFileSync(combinador, "'use strict';\nconst io = require(" + JSON.stringify(IO) + ');\n' +
    'io.blindar(function () { io.lerEntrada(function (e) { process.stdout.write(JSON.stringify(io.rodarJuntos(e, ' +
    JSON.stringify(gs) + '))); process.exit(0); }); });\n');
  const r = rodar(combinador, [], { entrada: {} });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout), [negar('nega'), null, null, contexto('PreToolUse', 'ok')]);
  assert.match(r.stderr, /portao falhou e liberou por seguranca: Error: quebrou\n/);
  assert.match(r.stderr, /portao falhou e liberou por seguranca: Error: quebrou fora do blindar/);
});

// Ponta a ponta, pelo processo: o script novo contra os ganchos antigos, cada um sozinho, juntados. Cada lado com a
// sua sessao (o aviso do cd solto muda na 2a vez da mesma sessao) e o mesmo estado de partida (`antes`, por sessao).
// Alem da igualdade, cada caso confere o que tem de sair: o juntarSaidas dos dois lados nao prova a juncao sozinho.
function comparar(dir, tmp, script, antigos, casos) {
  return casos.map(function (caso, i) {
    const lado = function (sid, scripts) {
      if (caso.antes) caso.antes(sid);
      const rs = scripts.map((s) => rodar('scripts/' + s, [], { cwd: dir,
        entrada: Object.assign({}, caso.entrada, { session_id: sid }), env: { SWORN_TMP: tmp } }));
      for (const r of rs) assert.strictEqual(r.status, 0, r.stderr);
      if (caso.depois) caso.depois(sid);
      return rs.map((r) => (r.stdout.trim() ? JSON.parse(r.stdout) : null));
    };
    // o carimbo de hora (a pasta da copia do conferir-depois) muda de um lado para o outro
    const semHora = (o) => JSON.parse(JSON.stringify(o).replace(/\d{4}-\d\d-\d\dT[\d-]+Z/g, '<hora>'));
    const esperado = io.juntarSaidas(lado('f3a-v' + i, antigos), caso.entrada.hook_event_name);
    const [obtido] = lado('f3a-n' + i, [script]);
    assert.deepStrictEqual(semHora(obtido), semHora(esperado), caso.entrada.tool_input.command);
    return obtido;
  });
}

const motivoDe = (s) => s && s.hookSpecificOutput && s.hookSpecificOutput.permissionDecision === 'deny' &&
  s.hookSpecificOutput.permissionDecisionReason;

test('F3a: portao-shell.js da o mesmo que os tres portoes sozinhos, e cada um decide la dentro', () => {
  const dir = repo(pasta('portao-shell'), { 'src/b.js': 'b\n' });
  const tmp = pasta('portao-shell-tmp');
  const sworn = path.join(dir, '.claude', 'sworn');
  fs.mkdirSync(sworn, { recursive: true });
  fs.writeFileSync(path.join(sworn, 'projeto.json'), JSON.stringify({ marchaPadrao: 'padrao' }));
  fs.writeFileSync(path.join(sworn, 'design.json'), JSON.stringify({ cores: ['#ff6600'], raios: ['4px'],
    espacos: ['4px'], sombras: [], antiReferencias: [] }));
  fs.writeFileSync(path.join(dir, 'src', 'b.js'), 'b mudado\n');
  const pre = (comando) => ({ hook_event_name: 'PreToolUse', cwd: dir, tool_name: 'Bash', tool_input: { command: comando } });
  // o commit so e negado na sessao que mexeu no codigo: cada lado marca o arquivo tocado na propria sessao
  const tocou = (sid) => assert.strictEqual(rodar('scripts/marcar-trabalho.js', [], { cwd: dir, env: { SWORN_TMP: tmp },
    entrada: { session_id: sid, cwd: dir, hook_event_name: 'PostToolUse', tool_name: 'Write',
      tool_input: { file_path: path.join(dir, 'src', 'b.js') } } }).status, 0);
  const [destrutivo, cd, passa, estilo, commit, dois, estiloECommit, destrutivoEEstilo] = comparar(dir, tmp, 'portao-shell.js',
    ['portao-destrutivo.js', 'portao-estilo.js', 'portao-commit.js'], [
      { entrada: pre('git reset --hard') },
      { entrada: pre('cd sub && ls') },
      { entrada: pre('ls') },
      { entrada: pre("cat > src/a.css <<'EOF'\n.x{color:#123456}\nEOF") },
      { entrada: pre('git commit -m x'), antes: tocou },
      // dois portoes negam o mesmo comando: vale o 1o da fila (destrutivo antes do commit)
      { entrada: pre('git commit -m x && git reset --hard'), antes: tocou },
      // o estilo e o commit negam o mesmo comando: vale o estilo, o 2o da fila, antes do commit
      { entrada: pre("git commit -m x && cat > src/a.css <<'EOF'\n.x{color:#123456}\nEOF"), antes: tocou },
      // o destrutivo e o estilo negam o mesmo comando: vale o destrutivo, o 1o da fila
      { entrada: pre("git reset --hard && cat > src/a.css <<'EOF'\n.x{color:#123456}\nEOF") }
    ]);
  assert.match(motivoDe(destrutivo), /git reset --hard/);
  assert.match(cd.hookSpecificOutput.updatedInput.command, /^\( cd sub && ls/);
  assert.strictEqual(passa, null);
  assert.match(motivoDe(estilo), /src\/a\.css/);
  assert.match(motivoDe(commit), /src\/b\.js/);
  assert.match(motivoDe(dois), /git reset --hard/);
  assert.doesNotMatch(motivoDe(dois), /src\/b\.js/);
  assert.match(motivoDe(estiloECommit), /src\/a\.css/);
  assert.doesNotMatch(motivoDe(estiloECommit), /src\/b\.js/);
  // o motivo do destrutivo cita o comando inteiro (com o .css): a marca dele e a trava 5
  assert.match(motivoDe(destrutivoEEstilo), /^sworn - comando destrutivo barrado \(trava 5\)/);
});

// Pendencia #6 (0.38.0): o escape do comandosLiberados decidia dentro de um try; no portao-shell.js o io.permitir lanca
// a PARADA, o catch a engolia e o portao-destrutivo seguia ate o fim: a decisao saia certa (a 1a vale), mas a marca do
// aviso do cd solto e o balde do destrutivo eram gravados para um comando que o dono liberou.
test('pendencia #6: no portao-shell.js o comando liberado para o portao, sem marcar o aviso do cd nem encher balde', () => {
  const dir = pasta('portao-shell-liberado');
  const tmp = pasta('portao-shell-liberado-tmp');
  fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify({
    plataforma: { so: 'linux', shell: 'bash' }, comandosLiberados: ['^cd sub && git status$', '^rm -rf \\./build$'] }));
  const shell = (comando) => {
    const r = rodar('scripts/portao-shell.js', [], { cwd: dir, env: { SWORN_TMP: tmp },
      entrada: { session_id: 'p6', cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: comando } } });
    assert.strictEqual(r.status, 0, r.stderr);
    return r.stdout.trim() ? JSON.parse(r.stdout) : null;
  };
  const sessao = () => {
    const f = path.join(tmp, 'sworn', 'p6.json');
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  };
  assert.strictEqual(shell('cd sub && git status'), null, 'o escape declarado libera calado');
  assert.strictEqual(shell('rm -rf ./build'), null, 'o escape declarado libera calado');
  assert.strictEqual(sessao(), null, 'o comando liberado nao grava nada na sessao: ' + JSON.stringify(sessao()));
  // o efeito que o dono ve: o 1o cd solto de verdade da sessao ainda traz o aviso inteiro
  const corrigido = shell('cd outra && git status');
  assert.ok(corrigido && corrigido.hookSpecificOutput, 'o cd solto nao liberado tinha de sair corrigido: ' + JSON.stringify(corrigido));
  assert.match(corrigido.hookSpecificOutput.updatedInput.command, /^\( cd outra && git status/);
  assert.match(corrigido.hookSpecificOutput.additionalContext || '', /cd solto/i, JSON.stringify(corrigido));
});

// P14 (A1-06): o Monitor do Claude Code roda o `command` no shell da ferramenta Bash, e o matcher do shell nao o
// casava: o apagar pelo Monitor nao passava pela trava 5. Agora casa, e os portoes o leem como Bash, tambem no Windows.
test('P14: o Monitor passa pelos portoes do shell, lido como Bash', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8')).hooks;
  const doShell = hooks.PreToolUse.find((g) => (g.hooks || []).some((h) => /portao-shell\.js$/.test((h.args || [])[0])));
  assert.ok(doShell, 'nenhum grupo PreToolUse chama o portao-shell.js');
  assert.ok(doShell.matcher.split('|').includes('Monitor'), doShell.matcher);
  const dir = pasta('portao-shell-monitor');
  const tmp = pasta('portao-shell-monitor-tmp');
  fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify({
    plataforma: { so: 'win32', shell: 'powershell' } }));
  const monitor = (entradaDaFerramenta) => {
    const r = rodar('scripts/portao-shell.js', [], { cwd: dir, env: { SWORN_TMP: tmp },
      entrada: { session_id: 'p14', cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Monitor',
        tool_input: Object.assign({ description: 'ensaio', timeout_ms: 1000 }, entradaDaFerramenta) } });
    assert.strictEqual(r.status, 0, r.stderr);
    return r.stdout.trim() ? JSON.parse(r.stdout) : null;
  };
  const apagar = ['rm', '-rf', '/'].join(' ');
  assert.match(motivoDe(monitor({ command: apagar })) || '', /^sworn - comando destrutivo barrado \(trava 5\)/);
  // a armadilha do Bash (o grep -c antes do &&) vale no Monitor; lido como PowerShell, nao seria conferida
  assert.match(motivoDe(monitor({ command: 'grep -c x a.txt && ls' })) || '', /grep -c/);
  assert.strictEqual(monitor({ command: 'ls && pwd' }), null, 'no Windows, o && do Bash nao e erro do PowerShell');
  assert.strictEqual(monitor({ ws: { url: 'wss://ensaio.invalid/x' } }), null, 'o Monitor de WebSocket passa');
});

test('F3a: depois-do-shell.js da o mesmo que o marcar-trabalho e o conferir-depois sozinhos, e os dois rodam', () => {
  const dir = repo(pasta('depois-shell'), { 'src/b.js': 'b\n', 'fora.txt': 'f\n' });
  const tmp = pasta('depois-shell-tmp');
  const sworn = path.join(dir, '.claude', 'sworn');
  fs.mkdirSync(sworn, { recursive: true });
  fs.writeFileSync(path.join(sworn, 'projeto.json'), JSON.stringify({ marchaPadrao: 'padrao' }));
  fs.writeFileSync(path.join(sworn, 'escopo.md'), '# Escopo\n**Objetivo:** F3a\n## Dentro\n- src/**\n');
  // cada lado abre o turno (o escopo da abertura) e o shell muda o versionado fora do escopo; o conferir-depois o
  // devolve pelo git e bloqueia com o aviso
  const abrirEMudar = (sid) => {
    assert.strictEqual(rodar('scripts/abrir-turno.js', [], { cwd: dir, env: { SWORN_TMP: tmp },
      entrada: { session_id: sid, cwd: dir, hook_event_name: 'UserPromptSubmit', prompt: 'mude o b' } }).status, 0);
    fs.writeFileSync(path.join(dir, 'fora.txt'), 'mudado\n');
  };
  const voltou = () => assert.strictEqual(fs.readFileSync(path.join(dir, 'fora.txt'), 'utf8'), 'f\n');
  const [saida] = comparar(dir, tmp, 'depois-do-shell.js', ['marcar-trabalho.js', 'conferir-depois.js'], [
    { entrada: { hook_event_name: 'PostToolUse', cwd: dir, tool_name: 'Bash', tool_input: { command: 'node muda.js' },
      tool_response: { stdout: '', stderr: '' } }, antes: abrirEMudar, depois: voltou }
  ]);
  assert.strictEqual(saida.decision, 'block');
  assert.match(saida.reason, /fora\.txt/);
  // e o marcar-trabalho rodou no processo junto: a sessao nova tem o trabalho do turno marcado
  const s = JSON.parse(fs.readFileSync(path.join(tmp, 'sworn', 'f3a-n0.json'), 'utf8'));
  assert.strictEqual(s.trabalhoReal, true);
});

