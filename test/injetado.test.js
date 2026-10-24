'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'auditar.js');
const inj = require('../scripts/lib/injetado.js');

// Plano 0.9.1 (D560/D568), Tarefa 4: a auditoria mede o que os ganchos injetam, lido da transcricao.
// Fixture montada pelo teste em pasta temporaria: pasta de config falsa, cache de plugins falso, transcricao de
// brinquedo. Nenhum caminho real. A forma dos registros e a vista na transcricao real da s84 (plano, Tarefa 1).

function pasta(nome) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-injetado-' + nome + '-'));
}

/** hooks.json de um plugin no cache: <cfg>/plugins/cache/<mercado>/<plugin>/<versao>/hooks/hooks.json */
function plugin(cfg, nome, hooks) {
  const dir = path.join(cfg, 'plugins', 'cache', 'mercado', nome, '1.0.0', 'hooks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'hooks.json'), JSON.stringify({ hooks: hooks }));
}

function sucesso(evento, nome, id, comando, stdout, content) {
  return { type: 'attachment', attachment: { type: 'hook_success', hookEvent: evento, hookName: nome, toolUseID: id,
    command: comando, stdout: stdout, content: content === undefined ? '' : content } };
}
function anexo(evento, nome, id, textos) {
  return { type: 'attachment', attachment: { type: 'hook_additional_context', hookEvent: evento, hookName: nome,
    toolUseID: id, content: textos } };
}
function json(ac) { return JSON.stringify({ hookSpecificOutput: { additionalContext: ac } }); }

// O corte (70) cai no meio de "prolongadamente", e antes dele vem ", ": o texto esperado so sai com a fronteira de
// palavra E a pontuacao tirada do fim (cada uma das duas, sozinha, da outro texto).
const AVISO = 'alfa - aviso que volta: o comando rodou de outro jeito, no subshell, prolongadamente e segue.';

/** Monta cfg + transcricao. Devolve { cfg, transcricao }. `vezes` = quantas vezes o aviso do alfa volta. */
function cenario(nome, vezes) {
  const cfg = pasta(nome);
  plugin(cfg, 'alfa', {
    SessionStart: [{ hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/scripts/abrir.js'],
      statusMessage: 'alfa: lendo o estado' }] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/scripts/portao.js'] }] }]
  });
  plugin(cfg, 'beta', {
    PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'node hooks/pre.mjs' }] }]
  });
  const beta = 'node "/cfg/plugins/cache/mercado/beta/1.0.0/hooks/inicio.mjs"';
  const linhas = [
    { type: 'user', message: { content: 'oi' } },
    // SessionStart do alfa: texto puro no stdout, comando registrado como o statusMessage
    sucesso('SessionStart', 'SessionStart:startup', 'a0', 'alfa: lendo o estado', 'regras do alfa\nmais uma linha\n', 'regras do alfa\nmais uma linha'),
    // SessionStart do beta: JSON; o anexo vem com outro toolUseID (casa so pelo evento e pelo texto)
    sucesso('SessionStart', 'SessionStart:startup', 'b0', beta, json('contexto do beta')),
    anexo('SessionStart', 'SessionStart', 'outro', ['contexto do beta']),
    // settings do projeto, texto puro
    sucesso('SessionStart', 'SessionStart:startup', 'p0', 'node "$CLAUDE_PROJECT_DIR/.claude/x.js"', 'conv', 'conv'),
    '{ linha torta',
    // o mesmo aviso do alfa, cada vez com um detalhe diferente na 3a linha
  ];
  for (let i = 0; i < vezes; i++) {
    const t = AVISO + '\n\ndetalhe ' + i;
    linhas.push(sucesso('PreToolUse', 'PreToolUse:Bash', 't' + i, 'node ${CLAUDE_PLUGIN_ROOT}/scripts/portao.js', json(t)));
    linhas.push(anexo('PreToolUse', 'PreToolUse:Bash', 't' + i, [t]));
  }
  // dica do beta pelo caminho do cache, duas vezes
  for (let i = 0; i < 2; i++) {
    linhas.push(sucesso('PreToolUse', 'PreToolUse:Read', 'r' + i, 'node "/cfg/plugins/cache/mercado/beta/1.0.0/hooks/pre.mjs"', json('dica do beta')));
    linhas.push(anexo('PreToolUse', 'PreToolUse:Read', 'r' + i, ['dica do beta']));
  }
  // anexo sem registro do gancho que o injetou
  linhas.push(anexo('PostToolUse', 'PostToolUse:Edit', 'x1', ['sem dono']));
  // linha de subagente: fica de fora
  const lado = anexo('PreToolUse', 'PreToolUse:Bash', 'side', ['do subagente']);
  lado.isSidechain = true;
  linhas.push(lado);
  const dir = path.join(cfg, 'projects', 'pasta-do-projeto');
  fs.mkdirSync(dir, { recursive: true });
  const transcricao = path.join(dir, 'sessao-falsa.jsonl');
  fs.writeFileSync(transcricao, linhas.map(function (l) { return typeof l === 'string' ? l : JSON.stringify(l); }).join('\n') + '\n');
  return { cfg: cfg, transcricao: transcricao };
}

function alvoDe(c) {
  return { caminho: c.transcricao, plugins: path.join(c.cfg, 'plugins', 'cache') };
}
function linha(r, plugin, gancho) {
  return r.porGancho.filter(function (g) { return g.plugin === plugin && g.gancho === gancho; })[0];
}

test('injetado: soma por plugin e gancho, vezes e caracteres, com o total', () => {
  const c = cenario('soma', 7);
  try {
    const r = inj.medir(alvoDe(c));
    assert.strictEqual(r.medido, true, r.motivo);
    const aviso = linha(r, 'alfa', 'PreToolUse:Bash');
    assert.ok(aviso, JSON.stringify(r.porGancho));
    assert.strictEqual(aviso.vezes, 7);
    let chars = 0;
    for (let i = 0; i < 7; i++) chars += (AVISO + '\n\ndetalhe ' + i).length;
    assert.strictEqual(aviso.caracteres, chars);
    // texto puro do SessionStart entra, pelo statusMessage
    assert.strictEqual(linha(r, 'alfa', 'SessionStart (texto puro)').caracteres, 'regras do alfa\nmais uma linha'.length);
    // JSON do SessionStart casa pelo evento e pelo texto, mesmo com outro toolUseID; o caminho do cache da o plugin
    assert.strictEqual(linha(r, 'beta', 'SessionStart').vezes, 1);
    assert.strictEqual(linha(r, 'beta', 'PreToolUse:Read').vezes, 2);
    assert.strictEqual(linha(r, 'projeto (settings.json)', 'SessionStart (texto puro)').vezes, 1);
    assert.strictEqual(linha(r, 'nao identificado', 'PostToolUse:Edit').vezes, 1);
    // o subagente fica de fora
    assert.ok(!r.porGancho.some(function (g) { return g.caracteres === 'do subagente'.length && g.vezes === 1 && g.gancho === 'PreToolUse:Bash'; }));
    const somaVezes = r.porGancho.reduce(function (s, g) { return s + g.vezes; }, 0);
    const somaChars = r.porGancho.reduce(function (s, g) { return s + g.caracteres; }, 0);
    assert.deepStrictEqual(r.total, { vezes: somaVezes, caracteres: somaChars });
    assert.strictEqual(r.total.vezes, 7 + 1 + 1 + 1 + 2 + 1);
    // ordem: mais caracteres primeiro
    for (let i = 1; i < r.porGancho.length; i++) assert.ok(r.porGancho[i - 1].caracteres >= r.porGancho[i].caracteres);
  } finally { fs.rmSync(c.cfg, { recursive: true, force: true }); }
});

test('injetado: aponta o texto que volta mais de 5 vezes, pela 1a linha, cortado em fronteira de palavra', () => {
  const c = cenario('volta', 6);
  try {
    const r = inj.medir(alvoDe(c));
    assert.strictEqual(r.repetidos.length, 1, JSON.stringify(r.repetidos));
    const x = r.repetidos[0];
    assert.strictEqual(x.plugin, 'alfa');
    assert.strictEqual(x.gancho, 'PreToolUse:Bash');
    assert.strictEqual(x.vezes, 6);
    assert.strictEqual(x.texto, 'alfa - aviso que volta: o comando rodou de outro jeito, no subshell...');
    assert.strictEqual(inj.VOLTA_MAIS_DE, 5);
  } finally { fs.rmSync(c.cfg, { recursive: true, force: true }); }
});

test('injetado: o aviso do cd solto do proprio sworn sai como no mock aprovado (D568)', () => {
  const shell = require('../scripts/lib/shell.js');
  assert.strictEqual(inj.cabeca(shell.avisoCdCorrigido({ achado: 'cd x' })),
    'sworn - cd solto corrigido: o comando rodou dentro de um subshell...');
  assert.strictEqual(inj.cabeca('\n  curto  \nresto'), 'curto');
});

test('injetado: exatamente 5 vezes nao e "volta mais de 5"', () => {
  const c = cenario('cinco', 5);
  try {
    assert.deepStrictEqual(inj.medir(alvoDe(c)).repetidos, []);
  } finally { fs.rmSync(c.cfg, { recursive: true, force: true }); }
});

test('injetado: script de mesmo nome em dois plugins nao vira palpite', () => {
  const c = cenario('ambiguo', 1);
  try {
    plugin(c.cfg, 'gama', { PreToolUse: [{ hooks: [{ type: 'command', command: 'node ${CLAUDE_PLUGIN_ROOT}/x/portao.js' }] }] });
    const r = inj.medir(alvoDe(c));
    assert.ok(!linha(r, 'alfa', 'PreToolUse:Bash'));
    assert.strictEqual(linha(r, 'nao identificado', 'PreToolUse:Bash').vezes, 1);
  } finally { fs.rmSync(c.cfg, { recursive: true, force: true }); }
});

// Ronda 1 da revisao da 0.9.1 (lente borda): hooks.json de outro plugin com forma torta derrubava a medicao inteira.
test('injetado: hooks.json torto de um plugin nao derruba a medicao, e os outros plugins seguem identificados', () => {
  const c = cenario('torto', 1);
  try {
    plugin(c.cfg, 'torto', { SessionStart: [{ hooks: [null, 5, 'x'] }], PreToolUse: [{ hooks: { nao: 'lista' } }, null] });
    const r = inj.medir(alvoDe(c));
    assert.strictEqual(r.medido, true, r.motivo);
    assert.strictEqual(linha(r, 'alfa', 'PreToolUse:Bash').vezes, 1);
    assert.strictEqual(linha(r, 'alfa', 'SessionStart (texto puro)').vezes, 1);
  } finally { fs.rmSync(c.cfg, { recursive: true, force: true }); }
});

test('injetado: caminho do cache com barra invertida (Windows) tambem da o plugin', () => {
  const vazio = { scripts: new Map(), mensagens: new Map() };
  assert.strictEqual(inj.pluginDoComando('node "D:\\cfg\\plugins\\cache\\mercado\\beta\\1.0.0\\hooks\\pre.mjs"', vazio), 'beta');
  assert.strictEqual(inj.pluginDoComando('node ${CLAUDE_PLUGIN_ROOT}\\scripts\\x.js', vazio), 'nao identificado');
});

test('injetado: leitura que falha e "nao medido" com a causa, nunca zero', () => {
  const dir = pasta('falha');
  try {
    const r = inj.medir({ caminho: path.join(dir, 'nao-existe.jsonl'), plugins: dir });
    assert.strictEqual(r.medido, false);
    assert.strictEqual(r.causa, 'ENOENT');
    assert.ok(/^nao medido: /.test(r.motivo), r.motivo);
    assert.ok(/--transcricao/.test(r.motivo), 'a mensagem diz o que fazer: ' + r.motivo);
    assert.ok(!('total' in r));
    assert.ok(/nao e documentado/.test(r.nota), r.nota);
    const sem = inj.medir(undefined);
    assert.strictEqual(sem.medido, false);
    assert.strictEqual(sem.causa, 'sem-transcricao');
    // arquivo sem nenhuma linha JSON: o formato mudou, nao "nenhuma injecao"
    const torto = path.join(dir, 'torto.jsonl');
    fs.writeFileSync(torto, 'nada aqui\noutra coisa\n');
    const t = inj.medir({ caminho: torto, plugins: dir });
    assert.strictEqual(t.medido, false);
    assert.strictEqual(t.causa, 'formato');
    assert.ok(/\.jsonl/.test(t.motivo), 'a mensagem diz o que conferir: ' + t.motivo);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('injetado: transcricao lida sem registro de gancho e zero com aviso de que o formato pode ter mudado', () => {
  const dir = pasta('zero');
  try {
    const arq = path.join(dir, 's.jsonl');
    fs.writeFileSync(arq, JSON.stringify({ type: 'user', message: { content: 'oi' } }) + '\n');
    const r = inj.medir({ caminho: arq, plugins: dir });
    assert.strictEqual(r.medido, true);
    assert.deepStrictEqual(r.total, { vezes: 0, caracteres: 0 });
    assert.ok(/nenhum registro de gancho/.test(r.aviso), r.aviso);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('injetado: localizar acha a transcricao pelo CLAUDE_CODE_SESSION_ID na pasta de config', () => {
  const c = cenario('localizar', 1);
  try {
    const env = { CLAUDE_CONFIG_DIR: c.cfg, CLAUDE_CODE_SESSION_ID: 'sessao-falsa' };
    const a = inj.localizar(null, env);
    assert.strictEqual(a.caminho, c.transcricao);
    assert.strictEqual(a.plugins, path.join(c.cfg, 'plugins', 'cache'));
    // o caminho passado vence a sessao
    assert.strictEqual(inj.localizar('outro.jsonl', env).caminho, path.resolve('outro.jsonl'));
    const sem = inj.localizar(null, { CLAUDE_CONFIG_DIR: c.cfg });
    assert.strictEqual(sem.causa, 'sem-sessao');
    const fora = inj.localizar(null, { CLAUDE_CONFIG_DIR: c.cfg, CLAUDE_CODE_SESSION_ID: 'outra-sessao' });
    assert.strictEqual(fora.causa, 'nao-achada');
    assert.ok(/--transcricao/.test(fora.motivo), 'a mensagem diz o que fazer: ' + fora.motivo);
    assert.strictEqual(inj.medir(fora).medido, false);
    assert.ok(/^nao medido: /.test(inj.medir(fora).motivo));
  } finally { fs.rmSync(c.cfg, { recursive: true, force: true }); }
});

test('injetado: auditar.js traz a chave injetado, pela sessao do ambiente e por --transcricao', () => {
  const c = cenario('cli', 6);
  const proj = pasta('cli-proj');
  try {
    const rodar = function (args, env) {
      const r = spawnSync(process.execPath, [SCRIPT].concat(args), { cwd: proj, encoding: 'utf8', env: Object.assign({}, process.env, env) });
      assert.strictEqual(r.status, 0, r.stderr);
      return JSON.parse(r.stdout).injetado;
    };
    const pelaSessao = rodar([], { CLAUDE_CONFIG_DIR: c.cfg, CLAUDE_CODE_SESSION_ID: 'sessao-falsa' });
    assert.strictEqual(pelaSessao.medido, true, pelaSessao.motivo);
    assert.strictEqual(pelaSessao.repetidos.length, 1);
    const peloCaminho = rodar(['--transcricao', c.transcricao], { CLAUDE_CONFIG_DIR: c.cfg, CLAUDE_CODE_SESSION_ID: '' });
    assert.strictEqual(peloCaminho.total.vezes, pelaSessao.total.vezes);
    const semNada = rodar([], { CLAUDE_CONFIG_DIR: c.cfg, CLAUDE_CODE_SESSION_ID: '' });
    assert.strictEqual(semNada.medido, false);
    assert.strictEqual(semNada.causa, 'sem-sessao');
  } finally {
    fs.rmSync(c.cfg, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('injetado: a skill do auditar apresenta o item 1c a partir da chave injetado', () => {
  const skill = fs.readFileSync(path.join(RAIZ, 'skills', 'audit', 'SKILL.md'), 'utf8');
  const i = skill.indexOf('1c.');
  assert.ok(i !== -1, 'falta o item 1c no Passo 2');
  const item = skill.slice(i, skill.indexOf('\n2. ', i));
  assert.ok(item.indexOf('`injetado`') !== -1, 'o item 1c nao cita a chave injetado');
  assert.ok(/n[aã]o medido/i.test(item), 'o item 1c nao diz o que fazer quando nao mediu');
  assert.ok(/mais de 5/.test(item), 'o item 1c nao cita o "volta mais de 5 vezes"');
});
