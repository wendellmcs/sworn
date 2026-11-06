'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const PONTE = path.join(RAIZ, 'scripts', 'ponte.js');
const PASTA = path.join(__dirname, 'fixtures', 'harness');
// O agy nao diz o evento na entrada: o processo o recebe no 3o argumento; no nucleo, vai em hook_event_name.
const fixture = (nome) => {
  const f = JSON.parse(fs.readFileSync(path.join(PASTA, nome + '.json'), 'utf8'));
  if (nome.startsWith('agy-')) f.hook_event_name = nome.split('-')[1];
  return f;
};

// O estado da ponte (prompt ja visto, Stop ja barrado) mora onde mora o dos portoes: SWORN_TMP no teste.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-ponte-'));
process.env.SWORN_TMP = TMP;
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const ponte = require('../scripts/ponte.js');
const estado = require('../scripts/lib/estado.js');

/** Portao de mentira: grava cada entrada que recebeu e responde o que `responder` devolver. */
function falso(responder) {
  const chamadas = [];
  return {
    chamadas,
    executar: function (script, entrada) {
      chamadas.push({ script: path.basename(script), entrada });
      return responder ? responder(entrada, chamadas.length) : '';
    }
  };
}
const negarSe = (pedaco) => (e) => String(e.tool_input && e.tool_input.file_path).includes(pedaco)
  ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
    permissionDecisionReason: 'fora do escopo: ' + e.tool_input.file_path } })
  : '';

test('ponte: apply_patch roda o portao uma vez por arquivo e um deny nega o chamado inteiro', () => {
  const f = falso(negarSe('proibido'));
  const saida = ponte.rodar('codex', 'portao-escopo', fixture('codex-PreToolUse-apply_patch'), { executar: f.executar });
  assert.deepStrictEqual(f.chamadas.map((c) => [c.script, c.entrada.tool_name, c.entrada.tool_input.file_path]),
    [['portao-escopo.js', 'Write', 'a.txt'], ['portao-escopo.js', 'Write', 'sub/b.txt'],
      ['portao-escopo.js', 'Write', 'proibido.txt']]);
  assert.deepStrictEqual(JSON.parse(saida), { hookSpecificOutput: { hookEventName: 'PreToolUse',
    permissionDecision: 'deny', permissionDecisionReason: 'fora do escopo: proibido.txt' } });
});

// s303 (Aberto B): o Codex roda os ganchos do PreToolUse ao mesmo tempo, e no Windows o rename do estado da ponte da
// EPERM enquanto outro processo o le: o deny ja dado se perdia (o blindar liberava). 2 em 30 rodadas ao vivo.
const ePerm = () => Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
const negadoEm = (sessao) => Object.assign(fixture('codex-PreToolUse-apply_patch'), { session_id: sessao });
const DENY_PROIBIDO = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
  permissionDecisionReason: 'fora do escopo: proibido.txt' } };

test('ponte: rename do estado com EPERM passageiro tenta de novo, grava e mantem o deny', (t) => {
  const real = fs.renameSync;
  let falhas = 0;
  t.mock.method(fs, 'renameSync', function () {
    if (falhas++ < 2) throw ePerm();
    return real.apply(fs, arguments);
  });
  const saida = ponte.rodar('codex', 'portao-escopo', negadoEm('eperm-passageiro'),
    { executar: falso(negarSe('proibido')).executar });
  assert.deepStrictEqual(JSON.parse(saida), DENY_PROIBIDO);
  assert.ok(fs.existsSync(estado.caminhoSessao('ponte-codex-eperm-passageiro')), 'o estado gravou depois das falhas');
});

test('ponte: estado que nao grava de jeito nenhum nao leva o deny junto e fica dito no stderr', (t) => {
  const real = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', function (p) {
    if (String(p).includes('ponte-codex-eperm-sempre')) throw ePerm();
    return real.apply(fs, arguments);
  });
  const ditos = [];
  t.mock.method(process.stderr, 'write', (s) => { ditos.push(String(s)); return true; });
  const saida = ponte.rodar('codex', 'portao-escopo', negadoEm('eperm-sempre'),
    { executar: falso(negarSe('proibido')).executar });
  assert.deepStrictEqual(JSON.parse(saida), DENY_PROIBIDO);
  assert.match(ditos.join(''), /estado da ponte nao gravou: sem permissao \(EPERM\);/);
});

// R2 s303 (borda): o valor lancado pode nao ser Error (D735); o catch que le e.code de null lancava e levava o deny.
test('ponte: estado que lanca valor que nao e Error (null, texto) tambem mantem o deny', (t) => {
  const ditos = [];
  t.mock.method(process.stderr, 'write', (s) => { ditos.push(String(s)); return true; });
  let lancado;
  t.mock.method(estado, 'gravarAtomico', () => { throw lancado; });
  for (lancado of [null, 'falhou']) {
    const saida = ponte.rodar('codex', 'portao-escopo', negadoEm('lanca-' + String(lancado)),
      { executar: falso(negarSe('proibido')).executar });
    assert.deepStrictEqual(JSON.parse(saida), DENY_PROIBIDO);
  }
  assert.match(ditos.join(''), /nao gravou: null;[\s\S]*nao gravou: falhou;/);
});

test('ponte: apply_patch do OpenCode roda o portao de edicao e o deny nega', () => {
  const f = falso(negarSe('b.js'));
  const saida = ponte.rodar('opencode', 'portao-escopo', fixture('opencode-tool.execute.before-apply_patch'),
    { executar: f.executar });
  assert.deepStrictEqual(f.chamadas.map((c) => [c.script, c.entrada.tool_name, c.entrada.tool_input.file_path]),
    [['portao-escopo.js', 'Edit', 'C:\\dev\\proj\\src\\b.js']]);
  assert.deepStrictEqual(JSON.parse(saida), { negar: 'fora do escopo: C:\\dev\\proj\\src\\b.js' });
});

test('ponte: dois arquivos negados no mesmo patch levam os dois motivos', () => {
  const f = falso(negarSe('.txt'));
  const saida = JSON.parse(ponte.rodar('codex', 'portao-escopo', fixture('codex-PreToolUse-apply_patch'),
    { executar: f.executar }));
  const motivo = saida.hookSpecificOutput.permissionDecisionReason;
  for (const a of ['a.txt', 'sub/b.txt', 'proibido.txt']) assert.ok(motivo.includes('fora do escopo: ' + a), motivo);
});

// s300 (D768): o apply_patch chamado de dentro do shell (Codex com MiniMax, t2mm) editou o src/b.js fora do escopo.
test('ponte: apply_patch dentro do shell roda a trava 4 por arquivo e o portao de shell no comando (D768)', () => {
  const f = falso(negarSe('b.js'));
  const o = { executar: f.executar, plataforma: 'win32' };
  const saida = JSON.parse(ponte.rodar('codex', 'portao-escopo', fixture('codex-PreToolUse-Bash-patch'), o));
  assert.deepStrictEqual(f.chamadas.map((c) => [c.script, c.entrada.tool_name, c.entrada.tool_input.file_path]),
    [['portao-escopo.js', 'Edit', 'src/b.js']]);
  assert.strictEqual(saida.hookSpecificOutput.permissionDecision, 'deny');
  ponte.rodar('codex', 'portao-destrutivo', fixture('codex-PreToolUse-Bash-patch'), o);
  assert.deepStrictEqual(f.chamadas.slice(1).map((c) => [c.script, c.entrada.tool_name]),
    [['portao-destrutivo.js', 'PowerShell']]);
});

test('ponte: o matcher do hooks.json decide; portao de shell nao roda para o apply_patch', () => {
  const f = falso(() => 'nao devia rodar');
  assert.strictEqual(ponte.rodar('codex', 'portao-destrutivo', fixture('codex-PreToolUse-apply_patch'),
    { executar: f.executar }), '');
  assert.strictEqual(f.chamadas.length, 0);
  // E o portao de shell roda para o shell, com o nome que o hooks.json espera.
  ponte.rodar('codex', 'portao-destrutivo', fixture('codex-PreToolUse-Bash'), { executar: f.executar, plataforma: 'win32' });
  assert.deepStrictEqual(f.chamadas.map((c) => c.entrada.tool_name), ['PowerShell']);
});

test('ponte: script fora do evento, harness desconhecido ou nome torto passam sem rodar nada', () => {
  const f = falso(() => 'x');
  assert.strictEqual(ponte.rodar('codex', 'portao-fecho', fixture('codex-PreToolUse-Bash'), { executar: f.executar }), '');
  assert.strictEqual(ponte.rodar('nenhum', 'portao-escopo', fixture('codex-PreToolUse-apply_patch'),
    { executar: f.executar }), '');
  assert.strictEqual(ponte.rodar('codex', '../fora', fixture('codex-PreToolUse-Bash'), { executar: f.executar }), '');
  assert.strictEqual(ponte.rodar('codex', 'nao-existe', fixture('codex-PreToolUse-Bash'), { executar: f.executar }), '');
  assert.strictEqual(f.chamadas.length, 0);
});

test('ponte: a chamada do agente de memoria do harness passa direto', () => {
  const f = falso(() => 'x');
  assert.strictEqual(ponte.rodar('codex', 'portao-destrutivo', fixture('codex-PreToolUse-Bash-memoria'),
    { executar: f.executar }), '');
  assert.strictEqual(ponte.rodar('codex', 'abertura', fixture('codex-SessionStart-memoria'), { executar: f.executar }), '');
  assert.strictEqual(f.chamadas.length, 0);
});

test('ponte: Qwen repete o UserPromptSubmit a cada volta; o portao roda uma vez por prompt_id', () => {
  const f = falso();
  const e = fixture('qwen-UserPromptSubmit');
  e.session_id = 'qwen-dedup-1';
  ponte.rodar('qwen', 'abrir-turno', e, { executar: f.executar });
  ponte.rodar('qwen', 'abrir-turno', e, { executar: f.executar });
  assert.strictEqual(f.chamadas.length, 1);
  ponte.rodar('qwen', 'abrir-turno', Object.assign({}, e, { prompt_id: 'outro' }), { executar: f.executar });
  assert.strictEqual(f.chamadas.length, 2);
});

test('ponte: dsh sem prompt_id deduplica pela sessao e pelo texto, e o texto puro vira additionalContext', () => {
  const f = falso(() => 'aviso do turno');
  const e = fixture('dsh-UserPromptSubmit');
  e.session_id = 'dsh-dedup-1';
  const saida = ponte.rodar('dsh', 'abrir-turno', e, { executar: f.executar });
  assert.deepStrictEqual(JSON.parse(saida),
    { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'aviso do turno' } });
  assert.strictEqual(ponte.rodar('dsh', 'abrir-turno', e, { executar: f.executar }), '');
  ponte.rodar('dsh', 'abrir-turno', Object.assign({}, e, { prompt: 'outro pedido' }), { executar: f.executar });
  assert.strictEqual(f.chamadas.length, 2);
});

test('ponte: dsh manda stop_hook_active sempre false; a ponte emula o segundo Stop depois de um block', () => {
  const blk = JSON.stringify({ decision: 'block', reason: 'cole a prova' });
  // Barra nas duas primeiras: sem o prompt novo, o terceiro Stop chegaria com true.
  const f = falso((e, n) => n <= 2 ? blk : '');
  const stop = Object.assign(fixture('dsh-Stop'), { session_id: 'dsh-stop-1' });
  assert.deepStrictEqual(JSON.parse(ponte.rodar('dsh', 'portao-fecho', stop, { executar: f.executar })),
    { decision: 'block', reason: 'cole a prova' });
  ponte.rodar('dsh', 'portao-fecho', stop, { executar: f.executar });
  assert.deepStrictEqual(f.chamadas.map((c) => c.entrada.stop_hook_active), [false, true]);
  // Prompt novo zera: o Stop seguinte volta a ser o primeiro.
  ponte.rodar('dsh', 'abrir-turno', Object.assign(fixture('dsh-UserPromptSubmit'), { session_id: 'dsh-stop-1' }),
    { executar: function () { return ''; } });
  ponte.rodar('dsh', 'portao-fecho', stop, { executar: f.executar });
  assert.strictEqual(f.chamadas[2].entrada.stop_hook_active, false);
});

for (const h of ['dsh', 'agy']) test('ponte: no ' + h + ' a ordem do Stop vira block, e o Stop seguinte chega em laco',
    () => {
  // s361 (F6): como no Codex, que manda stop_hook_active true depois do block; sem a marca, o Stop seguinte chegaria
  // como o primeiro.
  const ordem = JSON.stringify({ systemMessage: 'u',
    hookSpecificOutput: { hookEventName: 'Stop', additionalContext: 'grave o handoff' } });
  const f = falso((e, n) => n === 1 ? ordem : '');
  /* O agy le a sessao do conversationId. */
  const stop = Object.assign(fixture(h + '-Stop'),
    h === 'agy' ? { conversationId: 'agy-stop-f6' } : { session_id: 'dsh-stop-f6' });
  const saida = JSON.parse(ponte.rodar(h, 'portao-fecho', stop, { executar: f.executar }));
  assert.strictEqual(saida.reason, 'grave o handoff');
  ponte.rodar(h, 'portao-fecho', stop, { executar: f.executar });
  ponte.rodar(h, 'portao-fecho', stop, { executar: f.executar });
  assert.deepStrictEqual(f.chamadas.map((c) => c.entrada.stop_hook_active), [false, true, false]);
});

test('ponte: o Stop do subagente do dsh (session_id do filho) nao passa pelo portao do fecho', () => {
  const f = falso(() => JSON.stringify({ decision: 'block', reason: 'x' }));
  ponte.rodar('dsh', 'abrir-subagente', fixture('dsh-SubagentStart'), { executar: function () { return ''; } });
  assert.strictEqual(ponte.rodar('dsh', 'portao-fecho', fixture('dsh-Stop'), { executar: f.executar }), '');
  assert.strictEqual(f.chamadas.length, 0);
});

// Etapa 4b (D756, sonda s279): no Codex o subagente manda o UserPromptSubmit no session_id do pai, com agent_id e
// agent_type, e o texto dele chega no PostToolUse do wait_agent, so com o id.
test('ponte: Codex - o prompt do subagente nao abre turno no pai; o wait_agent leva o tipo que ele disse', () => {
  const f = falso();
  const sub = (id, tipo) => ({ hook_event_name: 'UserPromptSubmit', session_id: 'codex-4b', agent_id: id,
    agent_type: tipo, prompt: 'briefing' });
  ponte.rodar('codex', 'abrir-turno', sub('id-1', 'sworn-inspector'), { executar: f.executar });
  ponte.rodar('codex', 'abrir-turno', sub('id-2', 'general'), { executar: f.executar });
  assert.strictEqual(f.chamadas.length, 0, 'o prompt do subagente nao e pedido do usuario');
  ponte.rodar('codex', 'abrir-turno', { hook_event_name: 'UserPromptSubmit', session_id: 'codex-4b', prompt: 'p' },
    { executar: f.executar });
  assert.strictEqual(f.chamadas.length, 1, 'o do usuario roda');
  const g = falso();
  ponte.rodar('codex', 'gravar-veredito', { hook_event_name: 'PostToolUse', session_id: 'codex-4b',
    tool_name: 'multi_agent_v1wait_agent', tool_input: { targets: ['id-1', 'id-2', 'id-3'] },
    tool_response: JSON.stringify({ status: { 'id-1': { completed: 'v1' }, 'id-2': { completed: 'v2' },
      'id-3': { completed: 'v3' } } }) }, { executar: g.executar });
  assert.deepStrictEqual(g.chamadas.map((c) => [c.entrada.tool_name, c.entrada.agent_id, c.entrada.agent_type,
    c.entrada.tool_input.message]), [['SubagentHandback', 'id-1', 'sworn:inspector', 'v1'],
    ['SubagentHandback', 'id-2', 'general', 'v2'], ['SubagentHandback', 'id-3', undefined, 'v3']]);
  // O tipo guardado e desta sessao: outra sessao com o mesmo id nao o herda.
  const h = falso();
  ponte.rodar('codex', 'gravar-veredito', { hook_event_name: 'PostToolUse', session_id: 'codex-4b-outra',
    tool_name: 'multi_agent_v1wait_agent', tool_response: '{"status":{"id-1":{"completed":"v"}}}' },
  { executar: h.executar });
  assert.strictEqual(h.chamadas[0].entrada.agent_type, undefined);
  // Dentro de um subagente, o wait_agent vem com o tipo de quem chamou: o handback leva o que o esperado disse.
  const d = falso();
  ponte.rodar('codex', 'gravar-veredito', { hook_event_name: 'PostToolUse', session_id: 'codex-4b', agent_id: 'pai',
    agent_type: 'sworn-reader', tool_name: 'multi_agent_v1wait_agent',
    tool_response: '{"status":{"id-1":{"completed":"v"},"toString":{"completed":"w"}}}' }, { executar: d.executar });
  assert.deepStrictEqual(d.chamadas.map((c) => [c.entrada.agent_id, c.entrada.agent_type]),
    [['id-1', 'sworn:inspector'], ['toString', undefined]]);
  // So o handback ganha o tipo guardado: outra ferramenta com o mesmo id segue como veio.
  const l = falso();
  ponte.rodar('codex', 'marcar-trabalho', { hook_event_name: 'PostToolUse', session_id: 'codex-4b', agent_id: 'id-1',
    tool_name: 'Read', tool_input: { file_path: 'a.txt' }, tool_response: 'x' }, { executar: l.executar });
  assert.deepStrictEqual(l.chamadas.map((c) => c.entrada.agent_type), [undefined]);
});

// D758 (sonda s287): no Codex o .toml do agente perde o tools:, e o PreToolUse do subagente chega com agent_id e
// agent_type. A ponte nega a ferramenta que o agents/<papel>.md nao lista, sem rodar o portao.
const doSub = (base, tipo) => Object.assign(fixture(base), { session_id: 'codex-d758', agent_id: 'id-9',
  agent_type: tipo });

test('ponte: D758 - o papel so de leitura do sworn nao edita nem roda shell fora do tools: dele', () => {
  const f = falso();
  const o = { executar: f.executar, plataforma: 'win32' };
  for (const tipo of ['sworn-inspector', 'sworn-dedupe-judge']) {
    for (const [script, base, nome] of [['portao-escopo', 'codex-PreToolUse-apply_patch', 'Write'],
      ['portao-destrutivo', 'codex-PreToolUse-Bash', 'PowerShell']]) {
      const s = JSON.parse(ponte.rodar('codex', script, doSub(base, tipo), o)).hookSpecificOutput;
      assert.strictEqual(s.permissionDecision, 'deny', tipo + ' ' + nome);
      for (const pedaco of [tipo.replace('sworn-', 'sworn:'), 'Read, Grep, Glob', nome]) {
        assert.ok(s.permissionDecisionReason.includes(pedaco), s.permissionDecisionReason);
      }
    }
  }
  assert.strictEqual(f.chamadas.length, 0, 'negado antes do portao');
  // O reader tem shell no tools: e o portao de shell roda; a edicao segue negada.
  ponte.rodar('codex', 'portao-destrutivo', doSub('codex-PreToolUse-Bash', 'sworn-reader'), o);
  assert.deepStrictEqual(f.chamadas.map((c) => c.entrada.tool_name), ['PowerShell']);
  const r = JSON.parse(ponte.rodar('codex', 'portao-escopo', doSub('codex-PreToolUse-apply_patch', 'sworn-reader'), o));
  assert.strictEqual(r.hookSpecificOutput.permissionDecision, 'deny');
  assert.strictEqual(f.chamadas.length, 1);
  // Papel que nao e do sworn (o mesmo nome sem o prefixo inclusive) e o agente principal seguem para o portao.
  for (const tipo of ['inspector', 'sonda-shell', undefined]) {
    assert.strictEqual(ponte.rodar('codex', 'portao-destrutivo', doSub('codex-PreToolUse-Bash', tipo), o), '');
  }
  assert.strictEqual(f.chamadas.length, 4);
  // So o PreToolUse nega: o PostToolUse do papel roda o portao dele.
  ponte.rodar('codex', 'marcar-trabalho', doSub('codex-PostToolUse-Bash', 'sworn-inspector'), o);
  assert.strictEqual(f.chamadas.length, 5);
});

test('ponte: D758 - papel sem tools: libera tudo, papel sem arquivo passa e arquivo sem cabecalho nega', () => {
  const pasta = fs.mkdtempSync(path.join(TMP, 'agentes-'));
  fs.writeFileSync(path.join(pasta, 'livre.md'), '---\nname: livre\n---\ncorpo\n');
  fs.writeFileSync(path.join(pasta, 'torto.md'), 'sem cabecalho\n');
  const f = falso();
  const o = { executar: f.executar, plataforma: 'win32', agentes: pasta };
  for (const tipo of ['sworn-livre', 'sworn-outro']) {
    assert.strictEqual(ponte.rodar('codex', 'portao-destrutivo', doSub('codex-PreToolUse-Bash', tipo), o), '');
  }
  assert.strictEqual(f.chamadas.length, 2);
  const t = JSON.parse(ponte.rodar('codex', 'portao-destrutivo', doSub('codex-PreToolUse-Bash', 'sworn-torto'), o));
  assert.strictEqual(t.hookSpecificOutput.permissionDecision, 'deny');
  assert.ok(t.hookSpecificOutput.permissionDecisionReason.includes('agents/torto.md'));
  // O arquivo que existe e nao se le (aqui, uma pasta) nega como o sem cabecalho.
  fs.mkdirSync(path.join(pasta, 'pasta.md'));
  const p = JSON.parse(ponte.rodar('codex', 'portao-destrutivo', doSub('codex-PreToolUse-Bash', 'sworn-pasta'), o));
  assert.strictEqual(p.hookSpecificOutput.permissionDecision, 'deny');
  // O tools: sem a lista na mesma linha (vazio ou em lista YAML) nega, como o instalar.js o deixa fora: o campo so le
  // a mesma linha, e liberar todas seria o contrario do papel.
  fs.writeFileSync(path.join(pasta, 'vazio.md'), '---\nname: vazio\ntools:\n---\ncorpo\n');
  fs.writeFileSync(path.join(pasta, 'yaml.md'), '---\nname: yaml\ntools:\n  - PowerShell\n---\ncorpo\n');
  for (const tipo of ['sworn-vazio', 'sworn-yaml']) {
    const s = JSON.parse(ponte.rodar('codex', 'portao-destrutivo', doSub('codex-PreToolUse-Bash', tipo), o));
    assert.strictEqual(s.hookSpecificOutput.permissionDecision, 'deny', tipo);
    assert.ok(s.hookSpecificOutput.permissionDecisionReason.includes('mesma linha'), tipo);
  }
  assert.strictEqual(f.chamadas.length, 2);
});

test('ponte: agy - a abertura roda uma vez por conversa e volta como injectSteps', () => {
  const f = falso(() => 'sworn - regras');
  const e = Object.assign(fixture('agy-PreInvocation'), { conversationId: 'agy-abre-1' });
  assert.deepStrictEqual(JSON.parse(ponte.rodar('agy', 'abertura', e, { executar: f.executar })),
    { injectSteps: [{ ephemeralMessage: 'sworn - regras' }] });
  assert.strictEqual(ponte.rodar('agy', 'abertura', e, { executar: f.executar }), '');
  assert.strictEqual(f.chamadas.length, 1);
  assert.strictEqual(f.chamadas[0].entrada.hook_event_name, 'SessionStart');
  // O mesmo PreInvocation chega ao portao do prompt como UserPromptSubmit, com o texto do usuario.
  const g = falso();
  ponte.rodar('agy', 'abrir-turno', e, { executar: g.executar });
  assert.strictEqual(g.chamadas[0].entrada.prompt, e.lastUserInput);
});

test('ponte: Codex e Qwen - o SessionStart da compactacao chega a abertura como compact, a cada vez (D786)', () => {
  for (const h of ['codex', 'qwen']) {
    const f = falso(() => 'releia o handoff');
    const e = fixture(h + '-SessionStart-compact');
    assert.strictEqual(ponte.rodar(h, 'abertura', e, { executar: f.executar }), 'releia o handoff', h);
    assert.strictEqual(ponte.rodar(h, 'abertura', e, { executar: f.executar }), 'releia o handoff', h);
    assert.deepStrictEqual(f.chamadas.map((c) => c.entrada.source), ['compact', 'compact'], h);
  }
});

test('ponte: OpenCode - o experimental.session.compacting roda a abertura de novo, como compact (D786)', () => {
  const f = falso((e) => 'abertura ' + e.source);
  const base = { input: { sessionID: 'oc-compacta-1' }, cwd: 'C:\\dev\\proj' };
  const abrir = (gancho) => ponte.rodar('opencode', 'abertura', Object.assign({ hook_event_name: gancho }, base),
    { executar: f.executar });
  assert.deepStrictEqual(JSON.parse(abrir('experimental.chat.system.transform')), { contexto: 'abertura startup' });
  assert.strictEqual(abrir('experimental.chat.system.transform'), '');
  assert.deepStrictEqual(JSON.parse(abrir('experimental.session.compacting')), { contexto: 'abertura compact' });
  assert.deepStrictEqual(JSON.parse(abrir('experimental.session.compacting')), { contexto: 'abertura compact' });
  assert.deepStrictEqual(f.chamadas.map((c) => c.entrada.hook_event_name), ['SessionStart', 'SessionStart',
    'SessionStart']);
});

// D786 passo 4: agy e dsh nao avisam a compactacao; a ponte a ve pela queda do contexto depois do handoff marcado.
function compactaSemAviso(h, nome, campo, id) {
  const e = Object.assign(fixture(nome), { [campo]: id });
  estado.gravar(id, { handoffDaSessao: 'C:\\dev\\proj\\h-handoff.md', tokensDeContexto: 150000 });
  const medida = { atual: 210000 };
  const f = falso((x) => (x.hook_event_name === 'SessionStart' ? 'RELEIA ' + x.source : 'TURNO'));
  const rodar = () => ponte.rodar(h, 'abrir-turno', e, { executar: f.executar, medir: () => medida.atual });
  const aberturas = () => f.chamadas.filter((c) => c.script === 'abertura.js');
  return { e, medida, f, rodar, aberturas };
}

test('ponte: agy - a queda do contexto depois do handoff marcado roda a abertura do compact na PreInvocation', () => {
  const t = compactaSemAviso('agy', 'agy-PreInvocation', 'conversationId', 'agy-compacta-1');
  t.medida.atual = 120000;
  assert.deepStrictEqual(JSON.parse(t.rodar()), { injectSteps: [{ ephemeralMessage: 'TURNO' }] });
  // O pico (210 mil) se grava tambem na PreInvocation repetida, que nao roda o portao do turno.
  t.medida.atual = 210000;
  assert.strictEqual(t.rodar(), '');
  assert.strictEqual(t.aberturas().length, 0);
  // 125 mil = 59,5% do pico: compactou. O prompt repetido nao roda o portao do turno; a releitura sai.
  t.medida.atual = 125000;
  assert.deepStrictEqual(JSON.parse(t.rodar()), { injectSteps: [{ ephemeralMessage: 'RELEIA compact' }] });
  assert.strictEqual(t.aberturas().length, 1);
  const a = t.aberturas()[0].entrada;
  assert.deepStrictEqual([a.hook_event_name, a.source, a.session_id], ['SessionStart', 'compact', 'agy-compacta-1']);
  // A mesma marca nao manda reler duas vezes, ainda que a abertura nao a consuma e o contexto caia de novo.
  t.medida.atual = 40000;
  t.rodar();
  assert.strictEqual(t.aberturas().length, 1);
});

test('ponte: dsh - a queda do contexto depois do handoff marcado roda a abertura do compact no prompt', () => {
  const t = compactaSemAviso('dsh', 'dsh-UserPromptSubmit', 'session_id', 'dsh-compacta-1');
  t.rodar();
  t.medida.atual = 125000;
  t.e.prompt = 'outro pedido';
  assert.deepStrictEqual(JSON.parse(t.rodar()), { hookSpecificOutput: { hookEventName: 'UserPromptSubmit',
    additionalContext: 'RELEIA compact\n\nTURNO' } });
  assert.strictEqual(t.aberturas().length, 1);
  // Consumida a marca (a abertura do compact a zera), a marca nova com o mesmo arquivo manda reler de novo.
  estado.gravar('dsh-compacta-1', { handoffDaSessao: null });
  t.rodar();
  estado.gravar('dsh-compacta-1', { handoffDaSessao: 'C:\\dev\\proj\\h-handoff.md', tokensDeContexto: 150000 });
  t.medida.atual = 40000;
  t.rodar();
  assert.strictEqual(t.aberturas().length, 2);
});

test('ponte: o prompt segurado ou bloqueado deixa a releitura para o prompt seguinte, agy e dsh', () => {
  const casos = [['agy', 'agy-PreInvocation', 'conversationId', { continue: false, stopReason: 'VOLTA' }],
    ['dsh', 'dsh-UserPromptSubmit', 'session_id', { continue: false, stopReason: 'VOLTA' }],
    ['dsh', 'dsh-UserPromptSubmit', 'session_id', { decision: 'block', reason: 'VOLTA' }]];
  for (const [h, nome, campo, retem] of casos) {
    const t = compactaSemAviso(h, nome, campo, h + '-compacta-segura-' + Object.keys(retem)[0]);
    let segura = true;
    const f = falso((x) => (x.hook_event_name === 'SessionStart' ? 'RELEIA ' + x.source
      : segura ? JSON.stringify(retem) : 'TURNO'));
    const rodar = () => ponte.rodar(h, 'abrir-turno', t.e, { executar: f.executar, medir: () => t.medida.atual });
    const pedido = h === 'agy' ? 'lastUserInput' : 'prompt';
    segura = false;
    rodar();
    segura = true;
    t.medida.atual = 40000;
    t.e[pedido] = 'depois da pausa';
    const segurou = rodar();
    assert.ok(segurou.includes('VOLTA') && !segurou.includes('RELEIA'), h);
    assert.strictEqual(f.chamadas.filter((c) => c.script === 'abertura.js').length, 0, h);
    segura = false;
    t.e[pedido] = 'de novo';
    assert.ok(rodar().includes('RELEIA compact'), h);
    assert.strictEqual(f.chamadas.filter((c) => c.script === 'abertura.js').length, 1, h);
  }
});

test('ponte: dsh - a queda se mede na transcricao achada na casa, tambem no prompt repetido', () => {
  const casa = fs.mkdtempSync(path.join(TMP, 'dsh-casa-'));
  const t = compactaSemAviso('dsh', 'dsh-UserPromptSubmit', 'session_id', 'dsh-compacta-casa');
  const arquivo = path.join(casa, '.dsh', 'sessions', 'p', 'dsh-compacta-casa', 'session.v4.jsonl.zstd');
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, '');
  const lidos = [];
  const medir = (c) => { lidos.push(c); return t.medida.atual; };
  const rodar = () => ponte.rodar('dsh', 'abrir-turno', t.e, { executar: t.f.executar, medir, casa });
  rodar();
  t.medida.atual = 40000;
  assert.ok(rodar().includes('RELEIA compact'));
  assert.deepStrictEqual(lidos, [arquivo, arquivo]);
  // A abertura do compact recebe a transcricao achada (o dsh a manda vazia).
  assert.strictEqual(t.aberturas()[0].entrada.transcript_path, arquivo);
});

test('ponte: abertura do compact que falha ou sai vazia tenta de novo no prompt seguinte', () => {
  const t = compactaSemAviso('dsh', 'dsh-UserPromptSubmit', 'session_id', 'dsh-compacta-falha');
  let vazia = true;
  const f = falso((x) => (x.hook_event_name === 'SessionStart' ? (vazia ? '' : 'RELEIA ' + x.source) : 'TURNO'));
  const rodar = () => ponte.rodar('dsh', 'abrir-turno', t.e, { executar: f.executar, medir: () => t.medida.atual });
  rodar();
  t.medida.atual = 40000;
  t.e.prompt = 'depois da queda';
  assert.ok(!rodar().includes('RELEIA'));
  vazia = false;
  t.e.prompt = 'de novo';
  assert.ok(rodar().includes('RELEIA compact'));
  // Entregue, nao manda de novo.
  t.e.prompt = 'mais um';
  assert.ok(!rodar().includes('RELEIA'));
  assert.strictEqual(f.chamadas.filter((c) => c.script === 'abertura.js').length, 2);
});

test('ponte: sem queda, sem marca, fora do agy e do dsh ou no 2o portao do prompt, o compact nao roda', () => {
  // 126 mil = 60% do pico: nao e queda.
  const t = compactaSemAviso('dsh', 'dsh-UserPromptSubmit', 'session_id', 'dsh-compacta-2');
  t.rodar();
  t.medida.atual = 126000;
  t.rodar();
  // Pico abaixo de 80 mil: queda de handoff pedido cedo nao conta.
  const p = compactaSemAviso('dsh', 'dsh-UserPromptSubmit', 'session_id', 'dsh-compacta-3');
  estado.gravar('dsh-compacta-3', { handoffDaSessao: 'C:\\dev\\proj\\h-handoff.md', tokensDeContexto: 70000 });
  p.medida.atual = 79000;
  p.rodar();
  p.medida.atual = 10000;
  p.rodar();
  // Sem marca.
  const m = compactaSemAviso('dsh', 'dsh-UserPromptSubmit', 'session_id', 'dsh-compacta-4');
  estado.gravar('dsh-compacta-4', { tokensDeContexto: 150000 });
  m.rodar();
  m.medida.atual = 10000;
  m.rodar();
  // O Codex avisa a compactacao (SessionStart compact): a ponte nao mede.
  const c = compactaSemAviso('codex', 'codex-UserPromptSubmit', 'session_id', 'codex-compacta-1');
  c.rodar();
  c.medida.atual = 10000;
  c.rodar();
  // So o 1o portao do UserPromptSubmit no hooks.json manda reler (cada portao chama a ponte a parte).
  const d = compactaSemAviso('dsh', 'dsh-UserPromptSubmit', 'session_id', 'dsh-compacta-5');
  const ganchos = { SessionStart: [{ hooks: [{ args: ['x/abertura.js'] }] }],
    UserPromptSubmit: [{ hooks: [{ args: ['x/abrir-turno.js'] }, { args: ['x/outro.js'] }] }] };
  const rodarOutro = () => ponte.rodar('dsh', 'outro', d.e, { executar: d.f.executar, medir: () => d.medida.atual,
    ganchos });
  rodarOutro();
  d.medida.atual = 10000;
  rodarOutro();
  for (const x of [t, p, m, c, d]) assert.strictEqual(x.aberturas().length, 0);
});

// s359 (F2b): sem handoff marcado e sem aviso de saude, o turno longo que cruzou o limiar e compactou sem fim de turno
// no meio nao recebia ordem nenhuma. A ponte guarda o pico que ela mesma viu e, na queda, roda o compact com ele.
test('ponte: sem marca e sem aviso, a queda de um pico no limiar roda o compact com o pico, agy e dsh', () => {
  const casos = [['agy', 'agy-PreInvocation', 'conversationId'], ['dsh', 'dsh-UserPromptSubmit', 'session_id']];
  for (const [h, nome, campo] of casos) {
    const t = compactaSemAviso(h, nome, campo, h + '-f2b');
    estado.gravar(h + '-f2b', { tokensDeContexto: 300000 });
    t.medida.atual = 300000;
    t.rodar();
    t.medida.atual = 100000;
    assert.ok(t.rodar().includes('RELEIA compact'), h + ': a queda sem marca nao rodou o compact');
    assert.strictEqual(t.aberturas().length, 1, h);
    assert.strictEqual(t.aberturas()[0].entrada.sworn_pico, 300000, h + ': o pico nao foi a abertura');
    // Entregue, o pico zera: o tokensDeContexto gravado antes do compact (velho) nao vira queda de novo.
    t.medida.atual = 90000;
    t.rodar();
    assert.strictEqual(t.aberturas().length, 1, h + ': repetiu a ordem');
    // Pico abaixo do limiar (250 mil sem projeto): compactou cedo, nada a pedir.
    const b = compactaSemAviso(h, nome, campo, h + '-f2b-baixo');
    estado.gravar(h + '-f2b-baixo', {});
    b.medida.atual = 240000;
    b.rodar();
    b.medida.atual = 50000;
    b.rodar();
    // O aviso ja dado no fecho: a ordem dele segue pelo caminho de sempre (marca do handoff).
    const a = compactaSemAviso(h, nome, campo, h + '-f2b-avisado');
    estado.gravar(h + '-f2b-avisado', { avisouSaude: true });
    a.medida.atual = 300000;
    a.rodar();
    a.medida.atual = 50000;
    a.rodar();
    assert.strictEqual(b.aberturas().length + a.aberturas().length, 0, h);
    // O pico de antes do aviso (ou da marca) nao sobrevive a ele: depois do compact, que rearma o aviso e consome a
    // marca, o contexto baixo contra o pico velho repetiria a ordem.
    const marcas = [['aviso', { avisouSaude: true }], ['marca', { handoffDaSessao: 'C:\\dev\\h.md' }]];
    for (const [sufixo, depois] of marcas) {
      const v = compactaSemAviso(h, nome, campo, h + '-f2b-velho-' + sufixo);
      estado.gravar(h + '-f2b-velho-' + sufixo, {});
      v.medida.atual = 300000;
      v.rodar();
      estado.gravar(h + '-f2b-velho-' + sufixo, Object.assign({ tokensDeContexto: 300000 }, depois));
      v.rodar();
      estado.gravar(h + '-f2b-velho-' + sufixo, { avisouSaude: false, handoffDaSessao: null });
      v.medida.atual = 50000;
      v.rodar();
      assert.strictEqual(v.aberturas().length, 0, h + ': o pico de antes do ' + sufixo + ' virou queda');
    }
  }
});

test('ponte: agy - a resposta do ask_question vai ao marcar-trabalho na PreInvocation seguinte, uma vez', () => {
  const transcricao = path.join(fs.mkdtempSync(path.join(TMP, 'agy-pergunta-')), 'transcript_full.jsonl');
  const comum = { conversationId: 'agy-pergunta-1', transcriptPath: transcricao, workspacePaths: ['C:\\dev\\proj'] };
  const pre = Object.assign({ hook_event_name: 'PreInvocation', lastUserInput: 'pedido' }, comum);
  const pos = (passo, ferramenta, args) => Object.assign({ hook_event_name: 'PostToolUse', stepIdx: passo,
    toolCall: { name: ferramenta, args: args } }, comum);
  const perguntas = { questions: [{ question: 'Qual cor?', options: ['Azul', 'Verde'] },
    { question: 'Qual lado?', options: ['A', 'B'] }] };
  const passo = (i, conteudo) => fs.appendFileSync(transcricao, JSON.stringify({ step_index: i, type: 'GENERIC',
    content: conteudo }) + '\n');
  const f = falso();
  // A abertura e o prompt ja rodaram nesta conversa: a PreInvocation seguinte sai cedo nos dois.
  ponte.rodar('agy', 'abertura', pre, { executar: f.executar });
  ponte.rodar('agy', 'abrir-turno', pre, { executar: f.executar });
  // No PostToolUse a resposta ainda nao esta na transcricao: o marcar-trabalho roda e conta zero.
  ponte.rodar('agy', 'marcar-trabalho', pos(2, 'ask_question', perguntas), { executar: f.executar });
  assert.deepStrictEqual(f.chamadas.slice(2).map((c) => [c.script, c.entrada.tool_response]),
    [['marcar-trabalho.js', { answers: {} }]]);
  // Outra ferramenta antes da PreInvocation nao le a resposta, que ainda nao esta la.
  ponte.rodar('agy', 'portao-escopo', Object.assign({ hook_event_name: 'PreToolUse', toolCall: { name: 'write_file',
    args: { Path: 'C:\\dev\\proj\\a.txt', Content: 'x' } } }, comum), { executar: f.executar });
  // A3 passa do numero de perguntas (2) e fica fora.
  passo(2, 'Created At: x\nA1: Azul\nA2: User Skipped\nA3: Verde');
  const g = falso();
  assert.strictEqual(ponte.rodar('agy', 'abertura', pre, { executar: g.executar }), '');
  assert.strictEqual(ponte.rodar('agy', 'abrir-turno', pre, { executar: g.executar }), '');
  assert.deepStrictEqual(g.chamadas, [{ script: 'marcar-trabalho.js', entrada: { session_id: 'agy-pergunta-1',
    transcript_path: transcricao, cwd: 'C:\\dev\\proj', hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
    tool_input: {}, tool_response: { answers: { '2.A1': 'Azul' } } } }]);
  // Duas perguntas antes da PreInvocation: as duas ficam guardadas.
  const h = falso();
  ponte.rodar('agy', 'marcar-trabalho', pos(4, 'ask_question', perguntas), { executar: h.executar });
  passo(4, 'A1: Verde\nA2: User Skipped');
  ponte.rodar('agy', 'marcar-trabalho', pos(5, 'ask_question', perguntas), { executar: h.executar });
  passo(5, 'A1: User Skipped\nA2: User Skipped');
  ponte.rodar('agy', 'abertura', pre, { executar: h.executar });
  assert.deepStrictEqual(h.chamadas.map((c) => c.entrada.tool_response), [{ answers: {} }, { answers: {} },
    { answers: { '4.A1': 'Verde' } }]);
  // So pulada, ou de outra ferramenta: nenhuma decisao, e o marcar-trabalho nao roda de novo.
  const k = falso();
  ponte.rodar('agy', 'marcar-trabalho', pos(6, 'ask_question', perguntas), { executar: k.executar });
  passo(6, 'A1: User Skipped\nA2: User Skipped');
  ponte.rodar('agy', 'marcar-trabalho', pos(7, 'write_file', { Path: 'C:\\dev\\proj\\a.txt', Content: 'x' }),
    { executar: k.executar });
  const guardado = JSON.parse(fs.readFileSync(estado.caminhoSessao('ponte-agy-agy-pergunta-1'), 'utf8'));
  assert.deepStrictEqual(guardado.perguntas, [{ passo: 6, perguntas: 2 }]);
  passo(7, 'A1: Azul');
  // Sem o passo no gancho, nada fica guardado (a linha sem step_index nao e o passo dela).
  ponte.rodar('agy', 'marcar-trabalho', pos(undefined, 'ask_question', perguntas), { executar: k.executar });
  fs.appendFileSync(transcricao, JSON.stringify({ type: 'GENERIC', content: 'A1: Azul' }) + '\n');
  ponte.rodar('agy', 'abertura', pre, { executar: k.executar });
  ponte.rodar('agy', 'abrir-turno', pre, { executar: k.executar });
  assert.deepStrictEqual(k.chamadas.map((c) => c.entrada.tool_name), ['AskUserQuestion', 'Write', 'AskUserQuestion']);
});

test('ponte: agy - sem o marcar-trabalho no PostToolUse do hooks.json, a resposta guardada nao roda nada', () => {
  const ganchos = { SessionStart: [{ hooks: [{ args: ['x/abertura.js'] }] }],
    PostToolUse: [{ matcher: 'AskUserQuestion', hooks: [{ args: ['x/outro.js'], timeout: 10 }] }] };
  const transcricao = path.join(fs.mkdtempSync(path.join(TMP, 'agy-pergunta-')), 'transcript_full.jsonl');
  fs.writeFileSync(transcricao, JSON.stringify({ step_index: 2, type: 'GENERIC', content: 'A1: Azul' }) + '\n');
  const comum = { conversationId: 'agy-pergunta-2', transcriptPath: transcricao, workspacePaths: ['C:\\dev\\proj'] };
  const f = falso();
  ponte.rodar('agy', 'outro', Object.assign({ hook_event_name: 'PostToolUse', stepIdx: 2, toolCall: {
    name: 'ask_question', args: { questions: [{ question: 'Qual cor?', options: ['Azul'] }] } } }, comum),
  { executar: f.executar, ganchos: ganchos });
  ponte.rodar('agy', 'abertura', Object.assign({ hook_event_name: 'PreInvocation', lastUserInput: 'p' }, comum),
    { executar: f.executar, ganchos: ganchos });
  assert.deepStrictEqual(f.chamadas.map((c) => c.script), ['outro.js', 'abertura.js']);
});

test('ponte: agy - deny no formato dele; portao que libera devolve saida vazia', () => {
  const f = falso(negarSe('a.txt'));
  assert.deepStrictEqual(JSON.parse(ponte.rodar('agy', 'portao-escopo', fixture('agy-PreToolUse-write_file'),
    { executar: f.executar })), { decision: 'deny', reason: 'fora do escopo: C:\\dev\\proj\\a.txt' });
  const g = falso(() => '');
  assert.strictEqual(ponte.rodar('agy', 'portao-escopo', fixture('agy-PreToolUse-write_file'), { executar: g.executar }), '');
});

test('ponte: OpenCode - deny vai ao plugin como {negar}', () => {
  const f = falso(negarSe('a.txt'));
  const e = Object.assign(fixture('opencode-tool.execute.before-edit'), { cwd: 'C:\\dev\\proj' });
  assert.deepStrictEqual(JSON.parse(ponte.rodar('opencode', 'portao-escopo', e, { executar: f.executar })),
    { negar: 'fora do escopo: C:\\dev\\proj\\a.txt' });
  assert.strictEqual(f.chamadas[0].entrada.cwd, 'C:\\dev\\proj');
});

// Pedido 6, Etapa 4: a casa do usuario entra por opcao; nada aqui le a pasta pessoal de verdade.
function casaFalsa() {
  return fs.mkdtempSync(path.join(TMP, 'casa-'));
}

/** Uma sessao do dsh na casa: um quadro zstd por linha, como ele grava. */
function sessaoDsh(casa, pasta, texto) {
  const dir = path.join(casa, '.dsh', 'sessions', '--C-dev-proj--', pasta);
  fs.mkdirSync(dir, { recursive: true });
  const linha = { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: texto }] } } };
  const arquivo = path.join(dir, 'session.v4.jsonl.zstd');
  fs.writeFileSync(arquivo, zlib.zstdCompressSync(Buffer.from(JSON.stringify(linha) + '\n')));
  return arquivo;
}

test('ponte: dsh - o transcript_path vazio vira a sessao achada na casa, com e sem o prefixo session-', () => {
  const casa = casaFalsa();
  const sem = sessaoDsh(casa, 'dsh-acha-1', 'um');
  const com = sessaoDsh(casa, 'session-dsh-acha-2', 'dois');
  const f = falso();
  for (const id of ['dsh-acha-1', 'dsh-acha-2', 'dsh-acha-3']) {
    ponte.rodar('dsh', 'abrir-turno', Object.assign(fixture('dsh-UserPromptSubmit'), { session_id: id }),
      { executar: f.executar, casa: casa });
  }
  assert.deepStrictEqual(f.chamadas.map((c) => c.entrada.transcript_path), [sem, com, '']);
  // A ultima resposta so no Stop.
  assert.strictEqual(f.chamadas[0].entrada.last_assistant_message, undefined);
});

test('ponte: dsh - session_id com caminho nao sai da pasta das sessoes', () => {
  const casa = casaFalsa();
  sessaoDsh(casa, path.join('..', 'fora'), 'fora');
  const f = falso();
  ponte.rodar('dsh', 'abrir-turno', Object.assign(fixture('dsh-UserPromptSubmit'), { session_id: '../fora' }),
    { executar: f.executar, casa: casa });
  assert.strictEqual(f.chamadas[0].entrada.transcript_path, '');
});

test('ponte: Stop do dsh, do agy e do OpenCode chega ao portao com a ultima resposta da transcricao', () => {
  const casa = casaFalsa();
  const f = falso();
  sessaoDsh(casa, 'dsh-ultima-1', 'resposta do dsh');
  ponte.rodar('dsh', 'portao-fecho', Object.assign(fixture('dsh-Stop'), { session_id: 'dsh-ultima-1' }),
    { executar: f.executar, casa: casa });

  const agy = path.join(casa, 'transcript_full.jsonl');
  fs.writeFileSync(agy, JSON.stringify({ step_index: 0, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE',
    content: 'resposta do agy' }) + '\n');
  ponte.rodar('agy', 'portao-fecho', Object.assign(fixture('agy-Stop'), { conversationId: 'agy-ultima-1',
    transcriptPath: agy }), { executar: f.executar, casa: casa });

  const pasta = path.join(casa, '.local', 'share', 'opencode');
  fs.mkdirSync(pasta, { recursive: true });
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(pasta, 'opencode.db'));
  db.exec('create table message (id text, session_id text, time_created integer, data text); ' +
    'create table part (id text, message_id text, session_id text, time_created integer, data text)');
  db.prepare('insert into message values (?, ?, ?, ?)').run('msg_1', 'ses_ultima1', 1,
    JSON.stringify({ role: 'assistant' }));
  db.prepare('insert into part values (?, ?, ?, ?, ?)').run('prt_1', 'msg_1', 'ses_ultima1', 2,
    JSON.stringify({ type: 'text', text: 'resposta do opencode' }));
  db.close();
  const idle = fixture('opencode-session.idle');
  idle.properties.sessionID = 'ses_ultima1';
  ponte.rodar('opencode', 'portao-fecho', idle, { executar: f.executar, casa: casa });

  assert.deepStrictEqual(f.chamadas.map((c) => c.entrada.last_assistant_message),
    ['resposta do dsh', 'resposta do agy', 'resposta do opencode']);
  assert.strictEqual(f.chamadas[2].entrada.transcript_path, path.join(pasta, 'opencode.db') + '#ses_ultima1');
});

test('ponte: o caminho e a ultima resposta que o harness ja manda ficam como vieram', () => {
  const casa = casaFalsa();
  sessaoDsh(casa, 'dsh-veio-1', 'da transcricao');
  const f = falso();
  const e = fixture('codex-Stop');
  ponte.rodar('codex', 'portao-fecho', e, { executar: f.executar, casa: casa });
  ponte.rodar('dsh', 'portao-fecho', Object.assign(fixture('dsh-Stop'), { session_id: 'dsh-veio-1',
    transcript_path: 'C:\\dev\\conta\\sessao.jsonl', last_assistant_message: 'a do harness' }),
  { executar: f.executar, casa: casa });
  ponte.rodar('dsh', 'portao-fecho', Object.assign(fixture('dsh-Stop'), { session_id: 'dsh-veio-1',
    last_assistant_message: 'a do harness' }), { executar: f.executar, casa: casa });
  // O Codex sem caminho nao pega a sessao do dsh de mesmo id.
  ponte.rodar('codex', 'portao-fecho', Object.assign(fixture('codex-Stop'), { session_id: 'dsh-veio-1',
    transcript_path: '' }), { executar: f.executar, casa: casa });
  assert.deepStrictEqual(f.chamadas.map((c) => c.entrada.last_assistant_message),
    [e.last_assistant_message, 'a do harness', 'a do harness', e.last_assistant_message]);
  assert.deepStrictEqual(f.chamadas.map((c) => c.entrada.transcript_path).slice(1),
    ['C:\\dev\\conta\\sessao.jsonl', path.join(casa, '.dsh', 'sessions', '--C-dev-proj--', 'dsh-veio-1',
      'session.v4.jsonl.zstd'), '']);
});

test('ponte: sem leitor da transcricao no Node, a abertura do dsh e do OpenCode diz que a cobranca nao roda', () => {
  // R1 s285 (microcopy): o aviso diz o que fazer.
  const aviso = /teste vermelho nao roda aqui\. Para liga-la, atualize o Node para o 22\.15, o 23\.8 ou mais novo\./;
  const f = falso(() => 'sworn - regras');
  const dsh = (legivel) => JSON.parse(ponte.rodar('dsh', 'abertura', fixture('dsh-SessionStart'),
    { executar: f.executar, casa: casaFalsa(), legivel: () => legivel })).hookSpecificOutput.additionalContext;
  assert.match(dsh(false), aviso);
  assert.match(dsh(false), /^sworn - regras/);
  assert.doesNotMatch(dsh(true), aviso);
  const criada = fixture('opencode-experimental.chat.system.transform');
  criada.input.sessionID = 'ses_semleitor1';
  assert.match(JSON.parse(ponte.rodar('opencode', 'abertura', criada,
    { executar: f.executar, casa: casaFalsa(), legivel: () => false })).contexto, aviso);
  // So a abertura: o aviso nao se repete em cada portao.
  const g = falso(() => '');
  assert.strictEqual(ponte.rodar('dsh', 'abrir-turno', Object.assign(fixture('dsh-UserPromptSubmit'),
    { session_id: 'dsh-semleitor-1' }), { executar: g.executar, casa: casaFalsa(), legivel: () => false }), '');
  assert.strictEqual(g.chamadas.length, 1);
  // Nem em outro script da abertura do harness.
  const raiz = '${CLAUDE_PLUGIN_ROOT}/scripts/';
  const ganchos = { SessionStart: [{ hooks: [{ args: [raiz + 'abertura.js'] }, { args: [raiz + 'outro.js'] }] }] };
  assert.strictEqual(ponte.rodar('dsh', 'outro', fixture('dsh-SessionStart'),
    { executar: g.executar, casa: casaFalsa(), legivel: () => false, ganchos: ganchos }), '');
  assert.strictEqual(g.chamadas.length, 2);
});

test('ponte: pipe negado (EPERM, o sandbox do dsh) roda o portao com stdio por arquivo; outro erro nao', () => {
  const eco = path.join(TMP, 'eco.js');
  fs.writeFileSync(eco, "let b = ''; process.stdin.on('data', (c) => { b += c; });\n" +
    "process.stdin.on('end', () => { process.stdout.write('eco:' + b); });\n");
  const chamadas = [];
  const negaPipe = (codigo) => (cmd, args, opcoes) => {
    chamadas.push(Array.isArray(opcoes.stdio) ? 'arquivo' : 'pipe');
    return opcoes.input === undefined ? spawnSync(cmd, args, opcoes)
      : { error: Object.assign(new Error('negado'), { code: codigo }) };
  };
  // Os arquivos do portao moram com o estado (SWORN_TMP) e saem no fim.
  fs.mkdirSync(path.join(TMP, 'sworn'), { recursive: true });
  const sobras = () => fs.readdirSync(path.join(TMP, 'sworn')).filter((n) => n.startsWith('portao-')).length;
  const antes = sobras();
  const entrada = { cwd: TMP, hook_event_name: 'PreToolUse' };
  assert.strictEqual(ponte.executar(eco, entrada, 10, negaPipe('EPERM')), 'eco:' + JSON.stringify(entrada));
  assert.deepStrictEqual(chamadas, ['pipe', 'arquivo']);
  assert.strictEqual(sobras(), antes);
  chamadas.length = 0;
  assert.strictEqual(ponte.executar(eco, entrada, 10, negaPipe('ENOENT')), '');
  assert.deepStrictEqual(chamadas, ['pipe']);
  assert.strictEqual(ponte.executar(eco, entrada, 10), 'eco:' + JSON.stringify(entrada));
});

test('ponte: portao que nao rodou (timeout, spawn negado) libera e diz no stderr, pelo pipe e por arquivo', () => {
  const erro = (codigo) => ({ error: Object.assign(new Error('falhou'), { code: codigo }), stdout: null });
  // O pipe da EPERM; por arquivo, `noArquivo` responde.
  const pipeNegado = (noArquivo) => (cmd, args, opcoes) => Array.isArray(opcoes.stdio) ? noArquivo : erro('EPERM');
  const entrada = { cwd: TMP, hook_event_name: 'PreToolUse' };
  const portao = (nome) => path.join(TMP, nome + '.js');
  const ditos = [];
  const escrever = process.stderr.write;
  process.stderr.write = (t) => { ditos.push(String(t)); return true; };
  try {
    assert.strictEqual(ponte.executar(portao('estourou'), entrada, 10, () => erro('ETIMEDOUT')), '');
    assert.strictEqual(ponte.executar(portao('por-arquivo'), entrada, 10, pipeNegado(erro('ETIMEDOUT'))), '');
    // O que rodou nao ganha aviso, pelo pipe e por arquivo.
    assert.strictEqual(ponte.executar(portao('rodou'), entrada, 10, () => ({ status: 0, stdout: 'ok' })), 'ok');
    assert.strictEqual(ponte.executar(portao('rodou'), entrada, 10, pipeNegado({ status: 0 })), '');
  } finally {
    process.stderr.write = escrever;
  }
  assert.deepStrictEqual(ditos, [
    'sworn: o portao estourou nao rodou (ETIMEDOUT) e o gancho seguiu sem ele.\n',
    'sworn: o portao por-arquivo nao rodou (ETIMEDOUT) e o gancho seguiu sem ele.\n']);
});

test('ponte: no dsh sem SWORN_TMP o estado mora na pasta de ligado do projeto; nos outros, no temp', () => {
  const proj = fs.mkdtempSync(path.join(TMP, 'proj-'));
  for (const h of ['dsh', 'qwen']) fs.mkdirSync(path.join(proj, '.claude', 'sworn', 'ligado', h), { recursive: true });
  const pasta = path.join(proj, '.claude', 'sworn', 'ligado', 'dsh', 'tmp');
  const f = falso(() => '');
  const q = Object.assign(fixture('qwen-UserPromptSubmit'), { cwd: proj, prompt_id: 'estado-1' });
  const doQwen = path.join(os.tmpdir(), 'sworn', 'ponte-qwen-' + q.session_id.replace(/[^\w-]/g, '-') + '.json');
  try {
    delete process.env.SWORN_TMP;
    ponte.rodar('qwen', 'abrir-turno', q, { executar: f.executar });
    assert.strictEqual(process.env.SWORN_TMP, undefined);
    ponte.rodar('dsh', 'abrir-turno', Object.assign(fixture('dsh-UserPromptSubmit'),
      { session_id: 'dsh-estado-1', cwd: proj }), { executar: f.executar });
    assert.strictEqual(process.env.SWORN_TMP, pasta);
    assert.ok(fs.existsSync(path.join(pasta, 'sworn', 'ponte-dsh-dsh-estado-1.json')));
    // SWORN_TMP declarado fica como veio.
    process.env.SWORN_TMP = TMP;
    ponte.rodar('dsh', 'abrir-turno', Object.assign(fixture('dsh-UserPromptSubmit'),
      { session_id: 'dsh-estado-2', cwd: proj }), { executar: f.executar });
    assert.strictEqual(process.env.SWORN_TMP, TMP);
    assert.strictEqual(f.chamadas.length, 3);
  } finally {
    process.env.SWORN_TMP = TMP;
    fs.rmSync(doQwen, { force: true });
  }
});

// Ponta a ponta: o processo de verdade, com o portao de verdade, sem mudar nada no portao.
function chamarPonte(args, entrada, extraEnv) {
  return spawnSync(process.execPath, [PONTE].concat(args), {
    input: typeof entrada === 'string' ? entrada : JSON.stringify(entrada),
    encoding: 'utf8',
    env: Object.assign({}, process.env, { SWORN_TMP: TMP }, extraEnv || {})
  });
}

test('ponte (processo): o portao destrutivo de hoje nega pelo Codex e pelo agy', () => {
  const proj = fs.mkdtempSync(path.join(TMP, 'proj-'));
  const c = fixture('codex-PreToolUse-Bash');
  c.cwd = proj;
  c.tool_input.command = 'git reset --hard';
  const r = chamarPonte(['codex', 'portao-destrutivo'], c);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const a = fixture('agy-PreToolUse-run_command');
  delete a.hook_event_name;
  a.workspacePaths = [proj];
  a.toolCall.args.CommandLine = 'git reset --hard';
  const ra = chamarPonte(['agy', 'portao-destrutivo', 'PreToolUse'], a);
  assert.strictEqual(ra.status, 0, ra.stderr);
  const s = JSON.parse(ra.stdout);
  assert.strictEqual(s.decision, 'deny');
  assert.ok(/git reset --hard/.test(s.reason), s.reason);
});

test('ponte (processo): falha da ponte libera - entrada torta ou argumento faltando sai 0 sem saida', () => {
  for (const [args, entrada] of [[['codex', 'portao-escopo'], '{torto'], [[], '{}'], [['agy'], '{}']]) {
    const r = chamarPonte(args, entrada);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout, '');
  }
});
