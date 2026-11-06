'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const harness = require('../scripts/lib/harness.js');

// Pedido 6 (D752): as entradas reais gravadas na sonda das sessoes 269-271 (Etapas 1 e 1b do plano proprio),
// sanitizadas (C:\dev\proj, C:\dev\conta). Nome do arquivo: <harness>-<evento>[-<ferramenta>].json.
const PASTA = path.join(__dirname, 'fixtures', 'harness');
// O agy nao diz o evento na entrada: a ponte o recebe no 3o argumento e o poe em hook_event_name, como aqui.
const fixture = (nome) => {
  const f = JSON.parse(fs.readFileSync(path.join(PASTA, nome + '.json'), 'utf8'));
  if (nome.startsWith('agy-')) f.hook_event_name = nome.split('-')[1];
  return f;
};
const uma = (h, nome, evento, opcoes) => {
  const r = harness.normalizar(h, fixture(nome), evento, opcoes);
  assert.strictEqual(r.length, 1, nome + ': ' + JSON.stringify(r));
  return r[0];
};

test('harness: os cinco harnesses fora do Claude Code', () => {
  assert.deepStrictEqual(harness.HARNESSES, ['codex', 'qwen', 'agy', 'dsh', 'opencode']);
});

test('harness: o evento do harness vira os do Claude Code que ele cobre', () => {
  assert.deepStrictEqual(harness.eventosDoHarness('codex', fixture('codex-Stop')), ['Stop']);
  assert.deepStrictEqual(harness.eventosDoHarness('dsh', fixture('dsh-SubagentStart')), ['SubagentStart']);
  // agy nao tem abertura nem evento do prompt: a 1a PreInvocation faz os dois papeis.
  assert.deepStrictEqual(harness.eventosDoHarness('agy', fixture('agy-PreInvocation')), ['SessionStart', 'UserPromptSubmit']);
  assert.deepStrictEqual(harness.eventosDoHarness('agy', fixture('agy-PostInvocation')), []);
  assert.deepStrictEqual(harness.eventosDoHarness('agy', fixture('agy-Stop')), ['Stop']);
  assert.deepStrictEqual(harness.eventosDoHarness('opencode', fixture('opencode-tool.execute.before-write')), ['PreToolUse']);
  assert.deepStrictEqual(harness.eventosDoHarness('opencode', fixture('opencode-tool.execute.after-write')), ['PostToolUse']);
  assert.deepStrictEqual(harness.eventosDoHarness('opencode', fixture('opencode-experimental.chat.system.transform')),
    ['SessionStart']);
  assert.deepStrictEqual(harness.eventosDoHarness('opencode', fixture('opencode-chat.message')), ['UserPromptSubmit']);
  assert.deepStrictEqual(harness.eventosDoHarness('opencode', fixture('opencode-session.idle')), ['Stop']);
  assert.deepStrictEqual(harness.eventosDoHarness('opencode', fixture('opencode-session.created')), []);
  assert.deepStrictEqual(harness.eventosDoHarness('nenhum', {}), []);
});

test('harness: toda fixture normaliza sem lancar, em cada evento que cobre', () => {
  const nomes = fs.readdirSync(PASTA).filter((n) => n.endsWith('.json'));
  assert.strictEqual(nomes.length, 76);
  for (const n of nomes) {
    const h = n.split('-')[0];
    if (!harness.HARNESSES.includes(h)) continue;
    const bruta = fixture(n.replace(/\.json$/, ''));
    for (const ev of harness.eventosDoHarness(h, bruta)) {
      const r = harness.normalizar(h, bruta, ev);
      assert.ok(Array.isArray(r), n);
      for (const e of r) assert.strictEqual(e.hook_event_name, ev, n);
    }
  }
});

test('harness: apply_patch do Codex vira um Write por arquivo, caminho relativo ao cwd', () => {
  const r = harness.normalizar('codex', fixture('codex-PreToolUse-apply_patch'), 'PreToolUse');
  assert.deepStrictEqual(r.map((e) => [e.tool_name, e.tool_input.file_path, e.tool_input.content]),
    [['Write', 'a.txt', 'um'], ['Write', 'sub/b.txt', 'dois'], ['Write', 'proibido.txt', 'x']]);
  for (const e of r) {
    assert.strictEqual(e.cwd, 'C:\\dev\\proj');
    assert.strictEqual(e.session_id, '01a19db0-998d-7cb3-907c-1b479f121035');
  }
});

test('harness: apply_patch com Update, Move e Delete', () => {
  const bruta = fixture('codex-PreToolUse-apply_patch');
  bruta.tool_input.command = [
    '*** Begin Patch',
    '*** Update File: a.txt',
    '@@',
    ' fica',
    '-um',
    '+UM',
    '*** Move to: c.txt',
    '*** Delete File: velho.txt',
    '*** End Patch'
  ].join('\n');
  const r = harness.normalizar('codex', bruta, 'PreToolUse');
  assert.deepStrictEqual(r.map((e) => [e.tool_name, e.tool_input]), [
    ['Edit', { file_path: 'a.txt', old_string: 'fica\num', new_string: 'fica\nUM' }],
    ['Write', { file_path: 'c.txt', content: 'fica\nUM' }],
    ['Write', { file_path: 'velho.txt', content: '' }]
  ]);
});

// s299 (D766): com modelo GPT o OpenCode edita pelo apply_patch (texto em patchText), e a trava 4 nao barrava.
test('harness: apply_patch do OpenCode vira Edit, antes e depois da ferramenta', () => {
  const edit = ['Edit', { file_path: 'C:\\dev\\proj\\src\\b.js', old_string: "module.exports = { nome: 'b' };",
    new_string: "module.exports = { nome: 'c' };" }];
  const antes = harness.normalizar('opencode', fixture('opencode-tool.execute.before-apply_patch'), 'PreToolUse');
  assert.deepStrictEqual(antes.map((e) => [e.tool_name, e.tool_input]), [edit]);
  assert.strictEqual(antes[0].session_id, 'ses_e5db870ddffevzDjeMienA46E8');
  const depois = harness.normalizar('opencode', fixture('opencode-tool.execute.after-apply_patch'), 'PostToolUse');
  assert.deepStrictEqual(depois.map((e) => [e.tool_name, e.tool_input]), [edit]);
  assert.match(depois[0].tool_response, /^Success\. Updated the following files:/);
});

test('harness: patch sem arquivo nenhum nao vira chamado', () => {
  const bruta = fixture('codex-PreToolUse-apply_patch');
  bruta.tool_input.command = '*** Begin Patch\n*** End Patch';
  assert.deepStrictEqual(harness.normalizar('codex', bruta, 'PreToolUse'), []);
});

// s300 (D768): o Codex com MiniMax nao tem o apply_patch nativo; o modelo o chamou de dentro do shell e editou o
// src/b.js, fora do escopo. A fixture e o comando real do t2mm (o 5o, o que editou), com a quebra em `n.
const B = ['Edit', { file_path: 'src/b.js', old_string: "module.exports = { nome: 'b' };",
  new_string: "module.exports = { nome: 'c' };" }];
test('harness: apply_patch dentro do shell segue ao portao de shell e cada arquivo vira Edit (D768)', () => {
  const r = harness.normalizar('codex', fixture('codex-PreToolUse-Bash-patch'), 'PreToolUse', { plataforma: 'win32' });
  assert.deepStrictEqual(r.map((e) => e.tool_name), ['PowerShell', 'Edit']);
  assert.match(r[0].tool_input.command, /--codex-run-as-apply-patch/);
  assert.deepStrictEqual([r[1].tool_name, r[1].tool_input], B);
  for (const e of r) assert.strictEqual(e.session_id, '01a1a263-c7c7-78a1-8339-395414f03cc6');
  const depois = harness.normalizar('codex', Object.assign(fixture('codex-PreToolUse-Bash-patch'),
    { hook_event_name: 'PostToolUse' }), 'PostToolUse', { plataforma: 'win32' });
  assert.deepStrictEqual(depois.map((e) => e.tool_name), ['PowerShell', 'Edit']);
});

test('harness: o patch no shell de cada harness, com quebra real, `n ou \\n e a aspa colada no caminho (D768)', () => {
  const real = "@'\n*** Begin Patch\n*** Update File: src/b.js\n@@\n-module.exports = { nome: 'b' };\n" +
    "+module.exports = { nome: 'c' };\n*** End Patch\n'@ | apply_patch";
  const brutas = {
    qwen: Object.assign(fixture('qwen-PreToolUse-run_shell_command'), { tool_input: { command: real } }),
    agy: Object.assign(fixture('agy-PreToolUse-run_command'), { toolCall: { name: 'run_command',
      args: { CommandLine: real } } }),
    dsh: Object.assign(fixture('dsh-PreToolUse-pwsh'), { tool_input: { command: real } }),
    opencode: { hook_event_name: 'tool.execute.before', tool_name: 'bash', input: { tool: 'bash', sessionID: 's' },
      output: { args: { command: real } } }
  };
  for (const [h, bruta] of Object.entries(brutas)) {
    const r = harness.normalizar(h, bruta, 'PreToolUse', { plataforma: 'win32' });
    assert.deepStrictEqual(r.slice(1).map((e) => [e.tool_name, e.tool_input]), [B], h);
    assert.ok(['PowerShell', 'Bash'].includes(r[0].tool_name), h);
  }
  // O caminho do intocavel nao escapa pela aspa que fecha a string, nem pelo \n do printf do Bash.
  const cmd = (c) => harness.normalizar('codex', Object.assign(fixture('codex-PreToolUse-Bash'),
    { tool_input: { command: c } }), 'PreToolUse', { plataforma: 'linux' }).slice(1).map((e) => e.tool_input.file_path);
  assert.deepStrictEqual(cmd('apply_patch "*** Begin Patch`n*** Delete File: segredos/chave.env"'),
    ['segredos/chave.env']);
  assert.deepStrictEqual(cmd("printf '*** Begin Patch\\n*** Add File: segredos/chave.env\\n+x\\n*** End Patch\\n' | " +
    'apply_patch'), ['segredos/chave.env']);
  assert.deepStrictEqual(cmd("printf '*** Begin Patch\\n*** Delete File: segredos/chave.env\\n' | apply_patch"),
    ['segredos/chave.env']);
  // Revisao cega, rondas 1 e 2: no patch de quebra real o \n do caminho do Windows fica (C:\dev\new.js nao vira
  // C:\dev); no escapado, o printf parte todo \n, e a trava ve o caminho que o apply_patch recebe.
  assert.deepStrictEqual(cmd("@'\n*** Begin Patch\n*** Update File: C:\\dev\\proj\\src\\new.js\n@@\n-a\n+b\n" +
    "*** End Patch\n'@ | apply_patch"), ['C:\\dev\\proj\\src\\new.js']);
  assert.deepStrictEqual(cmd("printf '*** Begin Patch\\n*** Add File: C:\\dev\\new.js\\n+x\\n*** End Patch' | " +
    'apply_patch'), ['C:\\dev']);
  // A aspa no meio da linha corta o caminho ali, e a linha seguinte nao se junta ao cabecalho.
  assert.deepStrictEqual(cmd("printf '*** Begin Patch\\n*** Delete File: segredos/chave.env' | apply_patch"),
    ['segredos/chave.env']);
  assert.deepStrictEqual(cmd('apply_patch "*** Begin Patch\\n*** Delete File: segredos/chave.env\\" && echo ok'),
    ['segredos/chave.env']);
  const conteudo = harness.normalizar('codex', Object.assign(fixture('codex-PreToolUse-Bash'), { tool_input: {
    command: "@'\n*** Begin Patch\n*** Update File: a.js\n@@\n-x = 1\n+x = 'y'\n*** End Patch\n'@ | apply_patch" } }),
  'PreToolUse', { plataforma: 'linux' });
  assert.deepStrictEqual(conteudo[1].tool_input, { file_path: 'a.js', old_string: 'x = 1', new_string: "x = 'y'" });
  // Shell sem patch segue sozinho.
  assert.deepStrictEqual(cmd('echo "*** Update File: x.js"'), []);
});

// D770 (revisao cega da D768, ronda 3): a aspa so corta o cabecalho antes do fim da linha ou de um operador do shell; o
// printf e emulado numa passada (\\ \n \t \r); o corte e linear numa linha enorme.
test('harness: o patch no shell guarda o apostrofo, desfaz o printf inteiro e corta em tempo linear (D770)', () => {
  const cmd = (c) => harness.normalizar('codex', Object.assign(fixture('codex-PreToolUse-Bash'),
    { tool_input: { command: c } }), 'PreToolUse', { plataforma: 'linux' }).slice(1).map((e) => e.tool_input.file_path);
  assert.deepStrictEqual(cmd("@'\n*** Begin Patch\n*** Update File: docs/it's.md\n@@\n-a\n+b\n*** End Patch\n" +
    "'@ | apply_patch"), ["docs/it's.md"]);
  assert.deepStrictEqual(cmd("printf '*** Begin Patch\\n*** Delete File: docs/it's.md' | apply_patch"),
    ["docs/it's.md"]);
  assert.deepStrictEqual(cmd("echo $(printf '*** Begin Patch\\n*** Delete File: segredos/chave.env')"),
    ['segredos/chave.env']);
  assert.deepStrictEqual(cmd("printf '*** Begin Patch\\n*** Delete File: segredos/chave.env'>p.txt"),
    ['segredos/chave.env']);
  assert.deepStrictEqual(cmd("printf '*** Begin Patch\\n*** Delete File: segredos/chave.env';apply_patch"),
    ['segredos/chave.env']);
  assert.deepStrictEqual(cmd("printf '*** Begin Patch\\n*** Add File: C:\\\\dev\\\\n-utils\\\\a.js\\n+x\\n" +
    "*** End Patch\\n' | apply_patch"), ['C:\\dev\\n-utils\\a.js']);
  assert.deepStrictEqual(cmd("printf '*** Begin Patch\\n*** Delete File: a\\tb.js\\n' | apply_patch"), ['a\tb.js']);
  assert.deepStrictEqual(cmd("printf '*** Begin Patch\\r\\n*** Delete File: c.js\\r\\n' | apply_patch"), ['c.js']);
  // Revisao cega da D770, ronda 1: com a quebra CRLF real, o \r no fim da linha nao segura a aspa no caminho.
  assert.deepStrictEqual(cmd('apply_patch "*** Begin Patch\r\n*** Delete File: segredos/chave.env"\r\necho ok'),
    ['segredos/chave.env']);
  const inicio = Date.now();
  const longo = cmd("@'\n*** Begin Patch\n*** Delete File: x" + ' '.repeat(40000) + "y\n*** End Patch\n" +
    "'@ | apply_patch");
  assert.ok(Date.now() - inicio < 250, `corte levou ${Date.now() - inicio} ms`);
  assert.strictEqual(longo.length, 1);
});

test('harness: o shell do Codex, do Qwen e do agy e o PowerShell no Windows e o Bash fora dele', () => {
  const win = { plataforma: 'win32' };
  const lin = { plataforma: 'linux' };
  assert.strictEqual(uma('codex', 'codex-PreToolUse-Bash', 'PreToolUse', win).tool_name, 'PowerShell');
  assert.strictEqual(uma('codex', 'codex-PreToolUse-Bash', 'PreToolUse', lin).tool_name, 'Bash');
  const q = uma('qwen', 'qwen-PreToolUse-run_shell_command', 'PreToolUse', win);
  assert.strictEqual(q.tool_name, 'PowerShell');
  assert.strictEqual(q.tool_input.command, 'echo PROIBIDO268');
  assert.strictEqual(uma('qwen', 'qwen-PreToolUse-run_shell_command', 'PreToolUse', lin).tool_name, 'Bash');
  const a = uma('agy', 'agy-PreToolUse-run_command', 'PreToolUse', win);
  assert.strictEqual(a.tool_name, 'PowerShell');
  assert.strictEqual(a.tool_input.command, 'echo PROIBIDO269');
  // dsh roda pwsh e o OpenCode roda o Git Bash, nos dois casos pelo nome da ferramenta.
  assert.strictEqual(uma('dsh', 'dsh-PreToolUse-pwsh', 'PreToolUse', lin).tool_name, 'PowerShell');
  const oc = harness.normalizar('opencode', { hook_event_name: 'tool.execute.before', tool_name: 'bash',
    input: { tool: 'bash', sessionID: 'ses_1' }, output: { args: { command: 'ls' } } }, 'PreToolUse', win);
  assert.deepStrictEqual([oc[0].tool_name, oc[0].tool_input.command], ['Bash', 'ls']);
});

test('harness: Qwen - nomes do Claude Code, campos iguais', () => {
  const w = uma('qwen', 'qwen-PreToolUse-write_file', 'PreToolUse');
  assert.deepStrictEqual([w.tool_name, w.tool_input.file_path, w.tool_input.content], ['Write', 'C:\\dev\\proj\\a.txt', 'um\n']);
  const e = uma('qwen', 'qwen-PreToolUse-edit', 'PreToolUse');
  assert.deepStrictEqual([e.tool_name, e.tool_input.old_string, e.tool_input.new_string], ['Edit', 'um\n', 'UM\n']);
  const g = uma('qwen', 'qwen-PreToolUse-agent', 'PreToolUse');
  assert.deepStrictEqual([g.tool_name, g.tool_input.subagent_type], ['Agent', 'general-purpose']);
  assert.strictEqual(uma('qwen', 'qwen-PostToolUse-read_file', 'PostToolUse').tool_name, 'Read');
  assert.strictEqual(uma('qwen', 'qwen-PostToolUse-glob', 'PostToolUse').tool_name, 'Glob');
  const s = uma('qwen', 'qwen-Stop', 'Stop');
  assert.strictEqual(s.stop_hook_active, false);
  assert.ok(s.last_assistant_message.includes('MOTIVO-270'));
});

test('harness: agy - camelCase vira o formato do Claude Code', () => {
  const w = uma('agy', 'agy-PreToolUse-write_file', 'PreToolUse');
  assert.deepStrictEqual([w.tool_name, w.tool_input], ['Write', { file_path: 'C:\\dev\\proj\\a.txt', content: 'um' }]);
  assert.strictEqual(w.session_id, 'bfedea99-174a-4665-bc2c-3b28cf33b989');
  assert.strictEqual(w.cwd, 'C:/dev/proj');
  assert.ok(w.transcript_path.endsWith('transcript_full.jsonl'));
  const e = uma('agy', 'agy-PreToolUse-edit_file', 'PreToolUse');
  assert.deepStrictEqual([e.tool_name, e.tool_input],
    ['Edit', { file_path: 'C:\\dev\\proj\\a.txt', old_string: 'um', new_string: 'UM' }]);
  const g = uma('agy', 'agy-PreToolUse-invoke_subagent', 'PreToolUse');
  assert.deepStrictEqual([g.tool_name, g.tool_input.prompt, g.tool_input.subagent_type, g.tool_input.description],
    ['Agent', 'Responda apenas com a palavra: oi', 'self', 'Subagente simples']);
  // s357 (agy2, gpt-oss): o read_file do agy e a leitura. Sem o par, ler nao contava como busca (trava 7) nem como a
  // releitura do handoff. Os campos sao os do gancho real (sonda s357: toolCall.args = {Path}).
  const r = harness.normalizar('agy', Object.assign(fixture('agy-PostToolUse-write_file'),
    { toolCall: { name: 'read_file', args: { Path: 'C:\\dev\\proj\\plano.md' } } }), 'PostToolUse')[0];
  assert.deepStrictEqual([r.tool_name, r.tool_input], ['Read', { file_path: 'C:\\dev\\proj\\plano.md' }]);
  assert.strictEqual(require('../scripts/lib/busca.js').ehBusca(r.tool_name, r.tool_input), true,
    'a leitura do agy nao conta como busca');
  const p = uma('agy', 'agy-PreInvocation', 'UserPromptSubmit');
  assert.ok(p.prompt.startsWith('Responda em portugues. 1)'));
  assert.strictEqual(uma('agy', 'agy-PreInvocation', 'SessionStart').source, 'startup');
  assert.strictEqual(uma('agy', 'agy-Stop', 'Stop').session_id, '5417dab3-eab5-4b58-940f-1815cbf1dfe3');
});

test('harness: dsh - nomes proprios, campos do Claude Code, caminho relativo fica', () => {
  const w = uma('dsh', 'dsh-PreToolUse-write', 'PreToolUse');
  assert.deepStrictEqual([w.tool_name, w.tool_input.file_path, w.cwd], ['Write', 'a.txt', 'C:\\dev\\proj']);
  assert.strictEqual(uma('dsh', 'dsh-PreToolUse-edit', 'PreToolUse').tool_name, 'Edit');
  assert.strictEqual(uma('dsh', 'dsh-PreToolUse-subagent', 'PreToolUse').tool_name, 'Agent');
  assert.strictEqual(uma('dsh', 'dsh-PostToolUse-write', 'PostToolUse').tool_response.includes('Created file'), true);
  // Ferramenta sem par no Claude Code segue com o proprio nome: nenhum matcher do hooks.json casa.
  assert.strictEqual(uma('dsh', 'dsh-PreToolUse-list_agents', 'PreToolUse').tool_name, 'list_agents');
  // s360 (dshg-s360, grok): o read e o glob do dsh sao a leitura e a busca. Sem o par, 30 leituras e 18 buscas nao
  // contaram como busca e a trava 7 barrou criar o feito.txt 10 vezes. Campos do evento real: {file_path}, {pattern}.
  const busca = require('../scripts/lib/busca.js');
  const pares = [['read', { file_path: 'plano.md' }, 'Read'], ['glob', { pattern: 'plano.md' }, 'Glob']];
  for (const [nome, entrada, par] of pares) {
    const r = harness.normalizar('dsh', Object.assign(fixture('dsh-PreToolUse-write'),
      { tool_name: nome, tool_input: entrada }), 'PostToolUse')[0];
    assert.deepStrictEqual([r.tool_name, r.tool_input], [par, entrada]);
    assert.strictEqual(busca.ehBusca(r.tool_name, r.tool_input), true, 'o ' + nome + ' do dsh nao conta como busca');
  }
  assert.strictEqual(harness.matcherDoHarness('dsh', 'Grep|Glob|Read'), 'Grep|Glob|Read|glob|read');
});

test('harness: OpenCode - entrada do plugin vira o formato do Claude Code', () => {
  const comCwd = (nome) => Object.assign(fixture(nome), { cwd: 'C:\\dev\\proj' });
  const w = harness.normalizar('opencode', comCwd('opencode-tool.execute.before-write'), 'PreToolUse')[0];
  assert.deepStrictEqual([w.tool_name, w.tool_input, w.session_id, w.cwd],
    ['Write', { file_path: 'C:\\dev\\proj\\a.txt', content: 'um' }, 'ses_e622bb2f9ffergvg2M06lP1yIx', 'C:\\dev\\proj']);
  const e = uma('opencode', 'opencode-tool.execute.before-edit', 'PreToolUse');
  assert.deepStrictEqual([e.tool_name, e.tool_input],
    ['Edit', { file_path: 'C:\\dev\\proj\\a.txt', old_string: 'um', new_string: 'UM' }]);
  const t = uma('opencode', 'opencode-tool.execute.before-task', 'PreToolUse');
  assert.deepStrictEqual([t.tool_name, t.tool_input.prompt, t.tool_input.subagent_type], ['Agent', 'Responda somente: oi', 'general']);
  const d = uma('opencode', 'opencode-tool.execute.after-write', 'PostToolUse');
  assert.deepStrictEqual([d.tool_name, d.tool_input.file_path, d.tool_response],
    ['Write', 'C:\\dev\\proj\\a.txt', 'Wrote file successfully.']);
  assert.ok(uma('opencode', 'opencode-chat.message', 'UserPromptSubmit').prompt.includes('Responda em portugues. 1)'));
  assert.strictEqual(uma('opencode', 'opencode-session.idle', 'Stop').session_id, 'ses_e622b8010ffeZfxvE2ZxrFkjSh');
  assert.strictEqual(uma('opencode', 'opencode-experimental.chat.system.transform', 'SessionStart').source, 'startup');
});

test('harness: a chamada do agente de memoria do harness e reconhecida', () => {
  const m = (h, nome, ev) => harness.ehMemoria(harness.normalizar(h, fixture(nome), ev)[0]);
  assert.strictEqual(m('codex', 'codex-PreToolUse-Bash-memoria', 'PreToolUse'), true);
  assert.strictEqual(m('codex', 'codex-SessionStart-memoria', 'SessionStart'), true);
  assert.strictEqual(m('codex', 'codex-PreToolUse-Bash', 'PreToolUse'), false);
  assert.strictEqual(harness.ehMemoria({ cwd: 'C:\\dev\\proj', tool_input: { file_path: 'C:\\dev\\conta\\.qwen\\memories\\MEMORY.md' } }), true);
  assert.strictEqual(harness.ehMemoria({ cwd: 'C:\\dev\\proj', tool_input: { file_path: 'C:\\dev\\proj\\memories\\a.md' } }), false);
  assert.strictEqual(harness.ehMemoria({}), false);
});

test('harness: lerSaida entende as formas que os portoes escrevem', () => {
  assert.deepStrictEqual(harness.lerSaida(''), { bruto: '' });
  assert.deepStrictEqual(harness.lerSaida('sworn - regras'), { contexto: 'sworn - regras', bruto: 'sworn - regras' });
  const neg = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
    permissionDecisionReason: 'fora do escopo' } });
  assert.strictEqual(harness.lerSaida(neg).negar, 'fora do escopo');
  const blq = harness.lerSaida(JSON.stringify({ decision: 'block', reason: 'cole a prova', systemMessage: 'ao usuario' }));
  assert.deepStrictEqual([blq.bloquear, blq.aviso], ['cole a prova', 'ao usuario']);
  assert.strictEqual(harness.lerSaida(JSON.stringify({ continue: false, stopReason: 'outro chat' })).segurar, 'outro chat');
  const ctx = harness.lerSaida(JSON.stringify({ systemMessage: 'u', hookSpecificOutput: { hookEventName: 'PreToolUse',
    additionalContext: 'm' } }));
  assert.deepStrictEqual([ctx.contexto, ctx.aviso, ctx.negar], ['m', 'u', undefined]);
});

test('harness: juntar - um deny nega o chamado inteiro, com os motivos juntos', () => {
  const d = harness.juntar([{ bruto: '' }, { negar: 'a.txt fora' }, { negar: 'b.txt fora', aviso: 'x' }]);
  assert.deepStrictEqual(d, { negar: 'a.txt fora\n\nb.txt fora', aviso: 'x' });
  assert.deepStrictEqual(harness.juntar([]), {});
  const so = { contexto: 't', bruto: 't' };
  assert.strictEqual(harness.juntar([so]), so);
});

test('harness: Codex e Qwen recebem a saida do portao como ela veio; juntada, na forma do Claude Code', () => {
  for (const h of ['codex', 'qwen']) {
    assert.strictEqual(harness.escreverSaida(h, 'SessionStart', harness.lerSaida('texto puro')), 'texto puro');
    assert.strictEqual(harness.escreverSaida(h, 'PreToolUse', {}), '');
    assert.deepStrictEqual(JSON.parse(harness.escreverSaida(h, 'PreToolUse', { negar: 'm1\n\nm2' })),
      { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'm1\n\nm2' } });
  }
});

for (const h of ['codex', 'qwen']) test('harness: no Stop do ' + h +
    ' o contexto ao modelo vira decision block (o additionalContext dele nao chega)', () => {
  // s349 (cx4 ao vivo): a ordem do handoff saiu no additionalContext do Stop e o Codex nao a levou ao modelo.
  // s354 (qw1 ao vivo): no Qwen o mesmo (avisouSaude true, nenhum handoff); a sonda do Stop bloqueante levou o motivo.
  const ordem = JSON.stringify({ systemMessage: 'u',
    hookSpecificOutput: { hookEventName: 'Stop', additionalContext: 'grave o handoff' } });
  assert.deepStrictEqual(JSON.parse(harness.escreverSaida(h, 'Stop', harness.lerSaida(ordem))),
    { decision: 'block', reason: 'grave o handoff', systemMessage: 'u' });
  assert.strictEqual(harness.stopViraBlock(h, 'Stop', harness.lerSaida(ordem)), true);
  // O block que o portao ja deu segue igual; so aviso, sem contexto, nao vira block.
  const barra = JSON.stringify({ decision: 'block', reason: 'cole a prova' });
  assert.strictEqual(harness.escreverSaida(h, 'Stop', harness.lerSaida(barra)), barra);
  const aviso = JSON.stringify({ systemMessage: 'u' });
  assert.strictEqual(harness.escreverSaida(h, 'Stop', harness.lerSaida(aviso)), aviso);
  // Block junto de contexto: o motivo do block manda (nao troca pelo contexto); continue false sem contexto: igual.
  const ambos = JSON.stringify({ decision: 'block', reason: 'cole a prova',
    hookSpecificOutput: { hookEventName: 'Stop', additionalContext: 'grave o handoff' } });
  assert.strictEqual(harness.escreverSaida(h, 'Stop', harness.lerSaida(ambos)), ambos);
  const para = JSON.stringify({ continue: false, stopReason: 'fim' });
  assert.strictEqual(harness.escreverSaida(h, 'Stop', harness.lerSaida(para)), para);
  // continue false junto de contexto: o parar manda (nao vira block); contexto vazio nao vira block vazio.
  const paraCom = JSON.stringify({ continue: false, stopReason: 'fim',
    hookSpecificOutput: { hookEventName: 'Stop', additionalContext: 'grave o handoff' } });
  assert.strictEqual(harness.escreverSaida(h, 'Stop', harness.lerSaida(paraCom)), paraCom);
  assert.strictEqual(harness.escreverSaida(h, 'Stop', { contexto: '' }),
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: '' } }));
  // Fora do Stop a saida vai como veio.
  const sessao = JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'releia' } });
  assert.strictEqual(harness.escreverSaida(h, 'SessionStart', harness.lerSaida(sessao)), sessao);
  // O OpenCode (o plugin faz o reenvio) nao entra na regra.
  assert.strictEqual(harness.stopViraBlock('opencode', 'Stop', harness.lerSaida(ordem)), false);
});

test('harness: no Stop do dsh e do agy o contexto ao modelo vira block (dsh) e continue (agy)', () => {
  // s361 (dshl ao vivo): avisouSaude true e nenhum handoff; o README do dsh-hooks-claude-code (:43 e :95) diz que o
  // Stop so leva ao modelo o reason de um block. agy: na sonda s269 o reason do decision continue chegou ao modelo.
  const ordem = harness.lerSaida(JSON.stringify({ systemMessage: 'u',
    hookSpecificOutput: { hookEventName: 'Stop', additionalContext: 'grave o handoff' } }));
  assert.deepStrictEqual(JSON.parse(harness.escreverSaida('dsh', 'Stop', ordem)),
    { decision: 'block', reason: 'grave o handoff', systemMessage: 'u' });
  assert.deepStrictEqual(JSON.parse(harness.escreverSaida('agy', 'Stop', ordem)),
    { decision: 'continue', reason: 'grave o handoff' });
  for (const h of ['dsh', 'agy']) assert.strictEqual(harness.stopViraBlock(h, 'Stop', ordem), true);
  // O block que o portao ja deu manda (nao troca pelo contexto); o parar manda; contexto vazio nao vira block vazio.
  const ambos = harness.lerSaida(JSON.stringify({ decision: 'block', reason: 'cole a prova',
    hookSpecificOutput: { hookEventName: 'Stop', additionalContext: 'grave o handoff' } }));
  assert.deepStrictEqual(JSON.parse(harness.escreverSaida('dsh', 'Stop', ambos)),
    { decision: 'block', reason: 'cole a prova' });
  assert.deepStrictEqual(JSON.parse(harness.escreverSaida('agy', 'Stop', ambos)),
    { decision: 'continue', reason: 'cole a prova' });
  const paraCom = { segurar: 'fim', contexto: 'grave o handoff' };
  assert.deepStrictEqual(JSON.parse(harness.escreverSaida('dsh', 'Stop', paraCom)),
    { continue: false, stopReason: 'fim' });
  assert.strictEqual(harness.escreverSaida('agy', 'Stop', paraCom), '');
  for (const h of ['dsh', 'agy']) {
    assert.strictEqual(harness.stopViraBlock(h, 'Stop', { contexto: '' }), false);
    assert.strictEqual(harness.stopViraBlock(h, 'Stop', paraCom), false);
    assert.strictEqual(harness.stopViraBlock(h, 'UserPromptSubmit', ordem), false);
  }
  assert.strictEqual(harness.escreverSaida('agy', 'Stop', { contexto: '' }), '');
  // Fora do Stop o contexto segue no canal de cada um.
  assert.deepStrictEqual(JSON.parse(harness.escreverSaida('dsh', 'UserPromptSubmit', { contexto: 'releia' })),
    { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'releia' } });
  assert.deepStrictEqual(JSON.parse(harness.escreverSaida('agy', 'UserPromptSubmit', { contexto: 'releia' })),
    { injectSteps: [{ ephemeralMessage: 'releia' }] });
});

test('harness: dsh - texto puro vira additionalContext (texto puro some no dsh)', () => {
  assert.deepStrictEqual(JSON.parse(harness.escreverSaida('dsh', 'SessionStart', harness.lerSaida('regras'))),
    { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'regras' } });
  assert.deepStrictEqual(JSON.parse(harness.escreverSaida('dsh', 'Stop', { bloquear: 'b', aviso: 'u' })),
    { decision: 'block', reason: 'b', systemMessage: 'u' });
  assert.deepStrictEqual(JSON.parse(harness.escreverSaida('dsh', 'UserPromptSubmit', { segurar: 's' })),
    { continue: false, stopReason: 's' });
  assert.strictEqual(harness.escreverSaida('dsh', 'PreToolUse', { bruto: '' }), '');
});

test('harness: agy - deny, contexto e Stop no formato dele; passar e saida vazia ({} nega)', () => {
  assert.deepStrictEqual(JSON.parse(harness.escreverSaida('agy', 'PreToolUse', { negar: 'm' })),
    { decision: 'deny', reason: 'm' });
  assert.deepStrictEqual(JSON.parse(harness.escreverSaida('agy', 'Stop', { bloquear: 'b' })),
    { decision: 'continue', reason: 'b' });
  assert.deepStrictEqual(JSON.parse(harness.escreverSaida('agy', 'SessionStart', { contexto: 'regras' })),
    { injectSteps: [{ ephemeralMessage: 'regras' }] });
  assert.deepStrictEqual(JSON.parse(harness.escreverSaida('agy', 'UserPromptSubmit', { segurar: 's' })),
    { injectSteps: [{ ephemeralMessage: 's' }] });
  assert.strictEqual(harness.escreverSaida('agy', 'PreToolUse', {}), '');
  assert.strictEqual(harness.escreverSaida('agy', 'PreToolUse', { contexto: 'so contexto' }), '');
  assert.strictEqual(harness.escreverSaida('agy', 'PostToolUse', { aviso: 'u' }), '');
});

test('harness: OpenCode - a decisao vai ao plugin como JSON simples', () => {
  assert.deepStrictEqual(JSON.parse(harness.escreverSaida('opencode', 'PreToolUse', { negar: 'm', bruto: 'x' })),
    { negar: 'm' });
  assert.strictEqual(harness.escreverSaida('opencode', 'PreToolUse', { bruto: '' }), '');
});

test('harness: chave do prompt - Qwen por prompt_id, dsh e agy pelo texto, os outros sem deduplicar', () => {
  const q = uma('qwen', 'qwen-UserPromptSubmit', 'UserPromptSubmit');
  assert.strictEqual(harness.chaveDoPrompt('qwen', q), '1e3214ef-41e7-495e-a058-eb7eba69fdac########0');
  const d = uma('dsh', 'dsh-UserPromptSubmit', 'UserPromptSubmit');
  assert.strictEqual(harness.chaveDoPrompt('dsh', d), d.prompt);
  const a = uma('agy', 'agy-PreInvocation', 'UserPromptSubmit');
  assert.strictEqual(harness.chaveDoPrompt('agy', a), a.prompt);
  assert.strictEqual(harness.chaveDoPrompt('codex', uma('codex', 'codex-UserPromptSubmit', 'UserPromptSubmit')), null);
  assert.strictEqual(harness.chaveDoPrompt('opencode', uma('opencode', 'opencode-chat.message', 'UserPromptSubmit')), null);
});

// Etapa 4b (D756): as formas medidas na sonda com interface da sessao 279 (bloco s279 do plano do pedido 6).
const PERGUNTA = { header: 'Cor', id: 'cor', question: 'Qual cor?', options: [
  { label: 'Azul (Recomendado)', description: 'a' }, { label: 'Verde', description: 'b' },
  { label: 'Vermelho', description: 'c' }] };
const unica = (h, bruta, evento) => {
  const r = harness.normalizar(h, bruta, evento);
  assert.strictEqual(r.length, 1, JSON.stringify(r));
  return r[0];
};
const doOpencode = (gancho, tool, args, output) => ({ hook_event_name: gancho, tool_name: tool,
  input: { tool: tool, sessionID: 'ses_teste', args: args }, output: gancho.endsWith('before') ? { args: args }
    : { output: output } });

test('harness: a pergunta com opcoes de cada um vira o AskUserQuestion; a opcao em texto do agy vira {label}', () => {
  for (const [h, nome] of [['codex', 'request_user_input'], ['qwen', 'ask_user_question'],
    ['dsh', 'ask_user_question']]) {
    const e = unica(h, { hook_event_name: 'PreToolUse', tool_name: nome, tool_input: { questions: [PERGUNTA] } },
      'PreToolUse');
    // A resposta so se le no PostToolUse: no PreToolUse nao nasce tool_response.
    assert.deepStrictEqual([e.tool_name, e.tool_input.questions, e.tool_response],
      ['AskUserQuestion', [PERGUNTA], undefined], h);
  }
  const o = unica('opencode', doOpencode('tool.execute.before', 'question', { questions: [PERGUNTA] }), 'PreToolUse');
  assert.deepStrictEqual([o.tool_name, o.tool_input.questions], ['AskUserQuestion', [PERGUNTA]]);
  const a = unica('agy', { hook_event_name: 'PreToolUse', toolCall: { name: 'ask_question', args: { questions: [
    { question: 'Qual cor?', options: ['(Recommended) Azul', 'Verde', 'Vermelho'] }] } } }, 'PreToolUse');
  assert.strictEqual(a.tool_name, 'AskUserQuestion');
  assert.deepStrictEqual(a.tool_input.questions, [{ question: 'Qual cor?',
    options: [{ label: '(Recommended) Azul' }, { label: 'Verde' }, { label: 'Vermelho' }] }]);
  // Opcao que ja e objeto, ou que nao e texto, fica como veio: o portao da decisao diz o defeito.
  const b = unica('agy', { hook_event_name: 'PreToolUse', toolCall: { name: 'ask_question', args: { questions: [
    { question: 'q', options: [{ label: 'x' }, 7] }] } } }, 'PreToolUse');
  assert.deepStrictEqual(b.tool_input.questions[0].options, [{ label: 'x' }, 7]);
});

test('harness: a resposta da pergunta vira answers {chave: rotulo}, na forma de cada harness', () => {
  const pos = (h, nome, resp) => unica(h, { hook_event_name: 'PostToolUse', tool_name: nome,
    tool_input: { questions: [PERGUNTA] }, tool_response: resp }, 'PostToolUse').tool_response;
  assert.deepStrictEqual(pos('codex', 'request_user_input',
    '{"answers":{"cor":{"answers":["Azul (Recomendado)"]},"lado":{"answers":["A","B"]}}}'),
  { answers: { cor: 'Azul (Recomendado)', lado: 'A, B' } });
  assert.deepStrictEqual(pos('qwen', 'ask_user_question', { llmContent:
    'User has provided the following answers:\n\n**Cor**: Azul (Recomendado)\n**Lado**: A', returnDisplay: 'x' }),
  { answers: { Cor: 'Azul (Recomendado)', Lado: 'A' } });
  assert.deepStrictEqual(pos('qwen', 'ask_user_question', { llmContent: [{ text: '**Cor**: Verde' }] }),
    { answers: { Cor: 'Verde' } });
  // O texto do Qwen nao escapa nada: a barra do rotulo fica (so o do OpenCode vem entre aspas com escape).
  assert.deepStrictEqual(pos('qwen', 'ask_user_question', { llmContent: '**Pasta**: C:\\dev\\proj' }),
    { answers: { Pasta: 'C:\\dev\\proj' } });
  assert.deepStrictEqual(pos('dsh', 'ask_user_question',
    '{"answers":[{"id":"cor","selected":["Verde"]},{"id":"obs","selected":[],"custom":"outra"}]}'),
  { answers: { cor: 'Verde', obs: 'outra' } });
  const o = unica('opencode', doOpencode('tool.execute.after', 'question', { questions: [PERGUNTA] },
    'User has answered your questions: "Qual cor?"="Azul (Recomendado)", "Diz \\"oi\\"?"="Sim". You can now ' +
    'continue with the user\'s answers in mind.'), 'PostToolUse');
  assert.deepStrictEqual(o.tool_response, { answers: { 'Qual cor?': 'Azul (Recomendado)', 'Diz "oi"?': 'Sim' } });
  // Resposta que nao se le conta zero decisoes; a de outra ferramenta fica como veio.
  // O answers em lista e a forma do dsh: no Codex nao se le, ainda que cada item traga answers.
  for (const torta of [undefined, '{torto', 'sem resposta', { llmContent: 7 }, '{"answers":[1]}',
    '{"answers":[{"answers":["x"]}]}']) {
    assert.deepStrictEqual(pos('codex', 'request_user_input', torta), { answers: {} }, String(torta));
  }
  for (const torta of ['{"answers":[{"id":"cor"}]}', '{"answers":[{"selected":["x"]}]}']) {
    assert.deepStrictEqual(pos('dsh', 'ask_user_question', torta), { answers: {} }, torta);
  }
  const r = uma('qwen', 'qwen-PostToolUse-read_file', 'PostToolUse');
  assert.deepStrictEqual(r.tool_response, fixture('qwen-PostToolUse-read_file').tool_response);
});

test('harness: agy - a resposta do ask_question sai do passo dele na transcricao; "User Skipped" conta zero', () => {
  // Sonda s290: o passo GENERIC de step_index = stepIdx do PostToolUse, uma linha "A<n>: <resposta>" por pergunta.
  const passo = (i, conteudo, tipo) => JSON.stringify({ step_index: i, source: 'MODEL', type: tipo || 'GENERIC',
    status: 'DONE', content: conteudo });
  const texto = [passo(1, 'A1: de outro passo', 'PLANNER_RESPONSE'),
    passo(2, 'Created At: x\nCompleted At: x\nA1: Azul (Recomendado)\r\nA2: User Skipped\nA3: Verde'),
    '{torto', passo(3, 'A1: User Skipped'), passo(5, 'A1: Sim\nA2: Nao'), passo(7, 'A1:  '),
    JSON.stringify({ step_index: 8, type: 'GENERIC' })].join('\n');
  assert.deepStrictEqual(harness.respostaDoAgy(texto, [{ passo: 2, perguntas: 3 }]),
    { answers: { '2.A1': 'Azul (Recomendado)', '2.A3': 'Verde' } });
  // Linha alem do numero de perguntas nao conta (texto livre da resposta com quebra de linha nao vira decisao).
  assert.deepStrictEqual(harness.respostaDoAgy(texto, [{ passo: 2, perguntas: 2 }]),
    { answers: { '2.A1': 'Azul (Recomendado)' } });
  assert.deepStrictEqual(harness.respostaDoAgy(texto, [{ passo: 2, perguntas: 1 }, { passo: 5, perguntas: 2 }]),
    { answers: { '2.A1': 'Azul (Recomendado)', '5.A1': 'Sim', '5.A2': 'Nao' } });
  for (const [t, pendentes] of [[texto, [{ passo: 3, perguntas: 1 }]], [texto, [{ passo: 4, perguntas: 1 }]],
    [texto, []], [texto, undefined], [null, [{ passo: 2, perguntas: 1 }]], [texto, [{ passo: '2', perguntas: 1 }]],
    [texto, [{ passo: 7, perguntas: 1 }]], [texto, [{ passo: 8, perguntas: 1 }]]]) {
    assert.deepStrictEqual(harness.respostaDoAgy(t, pendentes), { answers: {} }, JSON.stringify(pendentes));
  }
});

test('harness: o agente do sworn fora do Claude Code se chama sworn-<papel> e volta como sworn:<papel>', () => {
  const s = unica('qwen', { hook_event_name: 'SubagentStop', agent_type: 'sworn-inspector',
    last_assistant_message: 'v' }, 'SubagentStop');
  assert.strictEqual(s.agent_type, 'sworn:inspector');
  for (const outro of ['general-purpose', 'meu-sworn-x', 'sworn:reader']) {
    assert.strictEqual(unica('qwen', { hook_event_name: 'SubagentStop', agent_type: outro }, 'SubagentStop')
      .agent_type, outro);
  }
  const q = unica('qwen', { hook_event_name: 'PreToolUse', tool_name: 'agent',
    tool_input: { subagent_type: 'sworn-dedupe-judge', prompt: 'p' } }, 'PreToolUse');
  assert.deepStrictEqual([q.tool_name, q.tool_input.subagent_type], ['Agent', 'sworn:dedupe-judge']);
  // Codex: o tipo e a mensagem viram os campos do Claude Code; o modelo dele nao entra na tabela da escada.
  const c = unica('codex', { hook_event_name: 'PreToolUse', tool_name: 'spawn_agent', tool_input: {
    agent_type: 'sworn-reader', message: 'leia', model: 'gpt-x', reasoning_effort: 'medium' } }, 'PreToolUse');
  assert.deepStrictEqual([c.tool_name, c.tool_input], ['Agent', { subagent_type: 'sworn:reader', prompt: 'leia' }]);
  const o = unica('opencode', doOpencode('tool.execute.before', 'task', { subagent_type: 'sworn-inspector',
    prompt: 'p' }), 'PreToolUse');
  assert.deepStrictEqual([o.tool_name, o.tool_input.subagent_type], ['Agent', 'sworn:inspector']);
});

test('harness: o fim do subagente no resultado - OpenCode pelo <task_result>, Codex pelo wait_agent', () => {
  const o = unica('opencode', doOpencode('tool.execute.after', 'task', { subagent_type: 'sworn-inspector' },
    '<task id="ses_filho" state="completed">\n<task_result>\n{"lente":"a"}\n</task_result>\n</task>'), 'PostToolUse');
  assert.deepStrictEqual([o.tool_name, o.agent_type, o.agent_id, o.tool_input.message],
    ['SubagentHandback', 'sworn:inspector', 'ses_filho', '{"lente":"a"}']);
  // Sem <task_result> (o subagente falhou) segue como o Agent que era.
  const f = unica('opencode', doOpencode('tool.execute.after', 'task', { subagent_type: 'general' }, 'erro'),
    'PostToolUse');
  assert.strictEqual(f.tool_name, 'Agent');
  // O <task_result> e so do OpenCode: no Qwen o mesmo texto segue como o Agent que era.
  assert.strictEqual(unica('qwen', { hook_event_name: 'PostToolUse', tool_name: 'agent', tool_input: {},
    tool_response: '<task id="x"><task_result>t</task_result></task>' }, 'PostToolUse').tool_name, 'Agent');
  // O wait_agent chamado dentro de um subagente traz o tipo de quem chamou: o handback nao o herda.
  const dentro = harness.normalizar('codex', { hook_event_name: 'PostToolUse', session_id: 's', agent_id: 'pai',
    agent_type: 'sworn-reader', tool_name: 'multi_agent_v1wait_agent',
    tool_response: '{"status":{"a1":{"completed":"t"}}}' }, 'PostToolUse');
  assert.deepStrictEqual(dentro.map((e) => [e.agent_id, e.agent_type]), [['a1', undefined]]);
  const r = harness.normalizar('codex', { hook_event_name: 'PostToolUse', session_id: 's', tool_name:
    'multi_agent_v1wait_agent', tool_input: { targets: ['a1', 'a2', 'a3'] }, tool_response: JSON.stringify({
    status: { a1: { completed: 'texto 1' }, a2: { running: true }, a3: { completed: 'texto 3' } },
    timed_out: false }) }, 'PostToolUse');
  assert.deepStrictEqual(r.map((e) => [e.tool_name, e.agent_id, e.tool_input.message, e.session_id]),
    [['SubagentHandback', 'a1', 'texto 1', 's'], ['SubagentHandback', 'a3', 'texto 3', 's']]);
  for (const torta of ['{torto', '{"status":7}', undefined]) {
    assert.deepStrictEqual(harness.normalizar('codex', { hook_event_name: 'PostToolUse',
      tool_name: 'multi_agent_v1wait_agent', tool_response: torta }, 'PostToolUse'), [], String(torta));
  }
});

test('harness: no agy e no dsh o fim do subagente vem no send_message ao pai (D760, registros da s278)', () => {
  const vd = '{"lente":"correcao","vereditos":".claude/sworn/revisao/r/1/vereditos","achados":[]}';
  const agy = (evento, msg) => ({ hook_event_name: evento, conversationId: 'filho',
    toolCall: { name: 'send_message', args: { Message: msg, Recipient: 'pai' } } });
  const dsh = (evento, msg) => ({ hook_event_name: evento, session_id: 'filho', tool_name: 'send_message',
    tool_input: { agent_id: 'pai', message: msg } });
  for (const [h, bruta] of [['agy', agy], ['dsh', dsh]]) {
    const e = unica(h, bruta('PostToolUse', vd), 'PostToolUse');
    assert.deepStrictEqual([e.tool_name, e.agent_type, e.agent_id, e.tool_input.message, e.session_id],
      ['SubagentHandback', 'sworn:inspector', 'filho', vd, 'filho'], h);
    // O agy e o dsh nao dizem o papel do filho: so o JSON do inspetor traz o campo vereditos (o briefing manda).
    const outro = unica(h, bruta('PostToolUse', 'oi, "vereditos" sem dois-pontos'), 'PostToolUse');
    assert.deepStrictEqual([outro.tool_name, outro.agent_type, outro.agent_id], ['SubagentHandback', undefined,
      'filho'], h);
    // So no PostToolUse: no PreToolUse o envio do inspetor segue sem o tipo, e o portao por papel nao o nega.
    const antes = unica(h, bruta('PreToolUse', vd), 'PreToolUse');
    assert.deepStrictEqual([antes.tool_name, antes.agent_type], ['SubagentHandback', undefined], h);
    assert.strictEqual(harness.matcherDoHarness(h, 'SubagentHandback'), 'SubagentHandback|send_message', h);
  }
  // O send_message e so do agy e do dsh: no Qwen e no Codex segue com o proprio nome.
  for (const h of ['qwen', 'codex']) {
    const e = unica(h, dsh('PostToolUse', vd), 'PostToolUse');
    assert.deepStrictEqual([e.tool_name, e.agent_type], ['send_message', undefined], h);
  }
});

test('harness: matcher de agente sai do harness (a ponte refiltra pelo nome do Claude Code); lista ganha o par', () => {
  for (const h of harness.HARNESSES) assert.strictEqual(harness.matcherDoHarness(h, '^sworn:inspector$'), undefined);
  assert.strictEqual(harness.matcherDoHarness('codex', 'SubagentHandback'),
    'SubagentHandback|multi_agent_v1wait_agent');
  assert.strictEqual(harness.matcherDoHarness('codex', 'Task|Agent'), 'Task|Agent|spawn_agent');
  assert.strictEqual(harness.matcherDoHarness('qwen', 'AskUserQuestion'), 'AskUserQuestion|ask_user_question');
  // D768: o shell pode trazer o apply_patch, e o harness tem de chamar a trava 4 (matcher Write|Edit) para ele.
  assert.strictEqual(harness.matcherDoHarness('codex', 'Write|Edit|NotebookEdit'),
    'Write|Edit|NotebookEdit|apply_patch|Bash');
  assert.strictEqual(harness.matcherDoHarness('qwen', 'Write|Edit|NotebookEdit'),
    'Write|Edit|NotebookEdit|run_shell_command|write_file|edit');
  assert.strictEqual(harness.matcherDoHarness('agy', 'Write|Edit'), 'Write|Edit|run_command|write_file|edit_file');
  // s357: o PostToolUse do marcar-trabalho (matcher com Read) tem de chamar a ponte para o read_file do agy.
  assert.strictEqual(harness.matcherDoHarness('agy', 'Grep|Glob|Read'), 'Grep|Glob|Read|read_file');
  assert.strictEqual(harness.matcherDoHarness('dsh', 'Write|Edit'), 'Write|Edit|pwsh|write|edit');
  assert.strictEqual(harness.matcherDoHarness('dsh', 'Bash'), 'Bash');
  assert.ok(harness.eventosQueDispara('qwen').includes('SubagentStop'));
});
