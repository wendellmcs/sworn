'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const RAIZ = path.join(__dirname, '..');
const INSTALAR = path.join(RAIZ, 'scripts', 'instalar.js');
const PASTA = path.join(__dirname, 'fixtures', 'harness');
const fixture = (nome) => JSON.parse(fs.readFileSync(path.join(PASTA, nome + '.json'), 'utf8'));

// Projeto, pasta pessoal e estado da ponte, todos numa pasta temporaria do teste.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-instalar-'));
process.env.SWORN_TMP = path.join(TMP, 'estado');
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const instalar = require('../scripts/instalar.js');
const ponte = require('../scripts/ponte.js');
const harnessLib = require('../scripts/lib/harness.js');

let n = 0;
function pastas() {
  n += 1;
  const projeto = path.join(TMP, 'proj' + n);
  const home = path.join(TMP, 'conta' + n);
  fs.mkdirSync(projeto, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  return { projeto, home, raiz: RAIZ };
}
const lerJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
// Grupo com matcher ({matcher, hooks}) ou gancho solto (o PreInvocation e o Stop do agy).
const comandos = (grupos) => grupos.flatMap((g) => (g.hooks || [g]).map((h) => h.command));
const grupoDo = (grupos, script) => grupos.find((g) => comandos([g]).some((c) => c.split(' ').includes(script)));
const PONTE = 'node "' + path.join(RAIZ, 'scripts', 'ponte.js').replace(/\\/g, '/') + '"';
const PONTE_AGY = 'node ' + path.join(RAIZ, 'scripts', 'ponte.js').replace(/\\/g, '/');

test('instalar: o Codex ganha .codex/hooks.json com a ponte em cada portao dos eventos que ele dispara', () => {
  const p = pastas();
  const r = instalar.instalar('codex', p);
  const arq = path.join(p.projeto, '.codex', 'hooks.json');
  const cfg = lerJson(arq).hooks;
  assert.deepStrictEqual(Object.keys(cfg).sort(),
    ['PostToolUse', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit']);
  assert.deepStrictEqual(comandos(cfg.SessionStart), [PONTE + ' codex abertura']);
  assert.ok(grupoDo(cfg.PreToolUse, 'portao-escopo').matcher.split('|').includes('apply_patch'));
  // D768: o shell pode trazer o apply_patch; o Codex chama a trava 4 para ele, e a ponte so roda os arquivos do patch.
  assert.ok(grupoDo(cfg.PreToolUse, 'portao-escopo').matcher.split('|').includes('Bash'));
  // A ponte roda o portao com o timeout do hooks.json; o do harness tem folga para o node a mais.
  assert.strictEqual(grupoDo(cfg.PreToolUse, 'portao-commit').hooks.find((h) => h.command.endsWith(' portao-commit'))
    .timeout, 35);
  assert.ok(r.gravados.includes(arq), r.gravados.join('\n'));
});

test('instalar: no Qwen, o matcher ganha os nomes dele e o settings.json guarda o resto', () => {
  const p = pastas();
  const arq = path.join(p.projeto, '.qwen', 'settings.json');
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, JSON.stringify({ model: { name: 'x' },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node meu.js' }] }] } }));
  instalar.instalar('qwen', p);
  instalar.instalar('qwen', p);
  const cfg = lerJson(arq);
  assert.deepStrictEqual(cfg.model, { name: 'x' });
  assert.deepStrictEqual(comandos(cfg.hooks.Stop), ['node meu.js', PONTE + ' qwen portao-fecho']);
  assert.strictEqual(comandos(cfg.hooks.PreToolUse).filter((c) => c.endsWith(' portao-escopo')).length, 1);
  const escopo = grupoDo(cfg.hooks.PreToolUse, 'portao-escopo').matcher.split('|');
  for (const nome of ['Write', 'Edit', 'write_file', 'edit']) assert.ok(escopo.includes(nome), escopo.join('|'));
  assert.ok(grupoDo(cfg.hooks.PreToolUse, 'portao-destrutivo').matcher.split('|').includes('run_shell_command'));
});

test('instalar: settings.json que nao e JSON nao e sobrescrito; vira passo', () => {
  const p = pastas();
  const arq = path.join(p.projeto, '.qwen', 'settings.json');
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, '{ quebrado');
  const r = instalar.instalar('qwen', p);
  assert.strictEqual(fs.readFileSync(arq, 'utf8'), '{ quebrado');
  assert.ok(r.passos.some((s) => s.includes(arq)), r.passos.join('\n'));
});

test('instalar: o agy ganha o grupo sworn em .agents/hooks.json, com o evento do agy no 3o argumento', () => {
  const p = pastas();
  const arq = path.join(p.projeto, '.agents', 'hooks.json');
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, JSON.stringify({ outro: { Stop: [{ type: 'command', command: 'node outro.js' }] } }));
  instalar.instalar('agy', p);
  const cfg = lerJson(arq);
  assert.deepStrictEqual(Object.keys(cfg).sort(), ['outro', 'sworn']);
  const s = cfg.sworn;
  assert.deepStrictEqual(comandos(s.PreInvocation),
    [PONTE_AGY + ' agy abertura PreInvocation', PONTE_AGY + ' agy abrir-turno PreInvocation']);
  assert.deepStrictEqual(comandos(s.Stop), [PONTE_AGY + ' agy portao-fecho Stop']);
  assert.ok(s.PreInvocation.every((h) => h.type === 'command' && !h.hooks));
  assert.ok(grupoDo(s.PreToolUse, 'portao-destrutivo').matcher.split('|').includes('run_command'));
  assert.ok(grupoDo(s.PreToolUse, 'portao-escopo').matcher.split('|').includes('write_file'));
});

// s283 (Etapa 5): o agy 1.4.12 parte o comando do gancho em cada espaco e nao tira as aspas: com aspas, o node recebia
// o caminho com elas e nenhum gancho rodava. Com espaco no caminho do sworn nao ha forma que rode: vira passo.
test('instalar: no agy a ponte vai sem aspas; espaco no caminho do sworn vira passo so no agy', () => {
  const raiz = path.join(TMP, 'com espaco');
  fs.mkdirSync(raiz, { recursive: true });
  const r = instalar.instalar('agy', Object.assign(pastas(), { raiz }));
  const comEspaco = raiz.replace(/\\/g, '/');
  assert.ok(r.passos.some((s) => s.includes('espaço') && s.includes(comEspaco)), r.passos.join('\n'));
  const q = instalar.instalar('qwen', Object.assign(pastas(), { raiz }));
  assert.ok(!q.passos.some((s) => s.includes('espaço')), q.passos.join('\n'));
  const semEspaco = instalar.instalar('agy', pastas());
  assert.ok(!semEspaco.passos.some((s) => s.includes('espaço')), semEspaco.passos.join('\n'));
});

test('instalar: no dsh, os ganchos vao num arquivo proprio e o perfil sworn aponta para ele', () => {
  const p = pastas();
  const r1 = instalar.instalar('dsh', p);
  const cfg = lerJson(path.join(p.projeto, '.dsh', 'sworn-hooks.json')).hooks;
  assert.deepStrictEqual(comandos(cfg.SubagentStart), [PONTE + ' dsh abrir-subagente', PONTE + ' dsh escalar']);
  assert.ok(!fs.existsSync(path.join(p.projeto, '.claude', 'settings.json')));
  // Sem a ponte oficial do dsh no perfil, o passo diz como pôr.
  assert.ok(r1.passos.some((s) => s.includes('dsh plugin --profile sworn add')), r1.passos.join('\n'));
  const perfil = path.join(p.home, '.dsh', 'profiles', 'sworn');
  fs.mkdirSync(path.join(perfil, 'node_modules', '@deepseek-ai', 'dsh-hooks-claude-code'), { recursive: true });
  fs.writeFileSync(path.join(perfil, 'cordis.patch.yml'), '# a camada do perfil\n');
  const r2 = instalar.instalar('dsh', p);
  instalar.instalar('dsh', p);
  const patch = fs.readFileSync(path.join(perfil, 'cordis.patch.yml'), 'utf8');
  assert.ok(patch.startsWith('# a camada do perfil\n'), patch);
  assert.match(patch, /configPath: \.\/\.dsh\/sworn-hooks\.json/);
  assert.strictEqual(patch.split('sworn-hooks.json').length - 1, 1);
  assert.ok(!r2.passos.some((s) => s.includes('dsh plugin')), r2.passos.join('\n'));
});

// s283 (Etapa 5): o `dsh plugin add` cria a camada com a lista vazia `[]`; a entrada acrescentada depois dela nao e
// YAML ("end of the stream or a document separator is expected") e o dsh nem abria. O `[]` sai; o resto fica.
test('instalar: no dsh, a lista vazia [] que o dsh plugin add grava sai da camada; comentario e entrada ficam', () => {
  const p = pastas();
  const perfil = path.join(p.home, '.dsh', 'profiles', 'sworn');
  fs.mkdirSync(path.join(perfil, 'node_modules', '@deepseek-ai', 'dsh-hooks-claude-code'), { recursive: true });
  const arq = path.join(perfil, 'cordis.patch.yml');
  fs.writeFileSync(arq, '# a top-level YAML array of loader patch entries\n# [] e a lista vazia\n[]\n');
  instalar.instalar('dsh', p);
  const patch = fs.readFileSync(arq, 'utf8');
  assert.ok(patch.startsWith('# a top-level YAML array of loader patch entries\n# [] e a lista vazia\n'), patch);
  assert.ok(!/^\s*\[\]\s*$/m.test(patch), patch);
  assert.match(patch, /^- insert:$/m);
  // Uma lista que ja tem entradas fica como veio, com a nossa no fim.
  const q = pastas();
  const outro = path.join(q.home, '.dsh', 'profiles', 'sworn');
  fs.mkdirSync(path.join(outro, 'node_modules', '@deepseek-ai', 'dsh-hooks-claude-code'), { recursive: true });
  fs.writeFileSync(path.join(outro, 'cordis.patch.yml'), '- disable: [x]\n');
  instalar.instalar('dsh', q);
  assert.ok(fs.readFileSync(path.join(outro, 'cordis.patch.yml'), 'utf8').startsWith('- disable: [x]\n- insert:\n'));
  // CRLF e o [] sem quebra no fim (ou com espaco em volta) saem tambem.
  for (const camada of ['# c\r\n[]', '# c\r\n  [] \r\n']) {
    const w = pastas();
    const pw = path.join(w.home, '.dsh', 'profiles', 'sworn');
    fs.mkdirSync(path.join(pw, 'node_modules', '@deepseek-ai', 'dsh-hooks-claude-code'), { recursive: true });
    fs.writeFileSync(path.join(pw, 'cordis.patch.yml'), camada);
    instalar.instalar('dsh', w);
    const lida = fs.readFileSync(path.join(pw, 'cordis.patch.yml'), 'utf8');
    assert.ok(!lida.includes('[]'), JSON.stringify(lida));
    assert.match(lida, /^- insert:$/m);
  }
});

test('instalar: o OpenCode ganha .opencode/plugins/sworn.js, que reexporta o plugin do sworn', () => {
  const p = pastas();
  instalar.instalar('opencode', p);
  const stub = fs.readFileSync(path.join(p.projeto, '.opencode', 'plugins', 'sworn.js'), 'utf8');
  const alvo = pathToFileURL(path.join(RAIZ, 'opencode', 'sworn.mjs')).href;
  assert.ok(stub.includes("export { SwornPlugin } from '" + alvo + "'"), stub);
});

test('instalar: o arquivo de instrucoes ganha o bloco que manda conferir, um por harness, sem apagar o resto', () => {
  const p = pastas();
  fs.writeFileSync(path.join(p.projeto, 'AGENTS.md'), '# Meu projeto\n\nregra minha\n');
  instalar.instalar('codex', p);
  instalar.instalar('codex', p);
  instalar.instalar('opencode', p);
  const t = fs.readFileSync(path.join(p.projeto, 'AGENTS.md'), 'utf8');
  assert.ok(t.startsWith('# Meu projeto\n\nregra minha\n'), t);
  assert.strictEqual(t.split('<!-- sworn:ligar codex').length - 1, 1);
  assert.ok(t.includes('instalar.js" --conferir codex'), t);
  assert.ok(t.includes('instalar.js" --conferir opencode'), t);
  instalar.instalar('qwen', p);
  assert.ok(fs.readFileSync(path.join(p.projeto, 'QWEN.md'), 'utf8').includes('--conferir qwen'));
});

// As skills chamam scripts por ${CLAUDE_PLUGIN_ROOT}, que so o Claude Code troca (sondas s270 e s271).
const VAR = '${CLAUDE_PLUGIN_ROOT}';
const barra = (p) => p.replace(/\\/g, '/');
function raizFalsa() {
  n += 1;
  const raiz = path.join(TMP, 'sworn' + n);
  fs.mkdirSync(path.join(raiz, 'skills', 'init', 'references'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'skills', 'init', 'SKILL.md'),
    '---\nname: init\ndescription: x\n---\nnode "' + VAR + '/scripts/a.js" e "' + VAR + '/scripts/b.js"\n');
  fs.writeFileSync(path.join(raiz, 'skills', 'init', 'references', 'r.md'), 'veja ' + VAR + '/docs\n');
  return raiz;
}
const lerTexto = (...partes) => fs.readFileSync(path.join(...partes), 'utf8');

test('manifestos: Codex, Qwen e agy recebem as skills, com a versao do plugin e sem os ganchos do Claude Code', () => {
  const versao = lerJson(path.join(RAIZ, '.claude-plugin', 'plugin.json')).version;
  // Sem "hooks": {}, o Codex acha o hooks/hooks.json e roda os portoes fora da ponte (molde superpowers 7.0.0).
  const codex = lerJson(path.join(RAIZ, '.codex-plugin', 'plugin.json'));
  assert.deepStrictEqual([codex.name, codex.version, codex.skills, codex.hooks], ['sworn', versao, './skills/', {}]);
  // O Qwen 0.26.5 le o hooks/hooks.json da extensao quando "hooks" nao e um objeto.
  const qwen = lerJson(path.join(RAIZ, 'qwen-extension.json'));
  assert.deepStrictEqual([qwen.name, qwen.version, qwen.hooks], ['sworn', versao, {}]);
  // O plugin nativo do agy so le o hooks.json da raiz; importado como do Claude Code, levaria o hooks/hooks.json.
  const agy = lerJson(path.join(RAIZ, '.antigravity-plugin', 'plugin.json'));
  assert.deepStrictEqual([agy.name, agy.version], ['sworn', versao]);
  assert.ok(!fs.existsSync(path.join(RAIZ, 'hooks.json')));
});

test('instalar: no Codex, no Qwen e no agy a copia instalada das skills ganha a raiz no lugar da variavel', () => {
  for (const h of ['codex', 'qwen', 'agy']) {
    const p = Object.assign(pastas(), { raiz: raizFalsa() });
    instalar.instalar(h, p);
    instalar.instalar(h, p);
    const t = lerTexto(p.raiz, 'skills', 'init', 'SKILL.md');
    assert.ok(t.includes('node "' + barra(p.raiz) + '/scripts/a.js" e "' + barra(p.raiz) + '/scripts/b.js"'), h + t);
    assert.ok(t.startsWith('---\nname: init\n'), h + t);
    assert.strictEqual(lerTexto(p.raiz, 'skills', 'init', 'references', 'r.md'), 'veja ' + barra(p.raiz) + '/docs\n');
  }
});

test('instalar: num repositorio git (a fonte) as skills nao mudam, e o passo diz qual e a raiz', () => {
  const p = Object.assign(pastas(), { raiz: raizFalsa() });
  fs.mkdirSync(path.join(p.raiz, '.git'));
  const antes = lerTexto(p.raiz, 'skills', 'init', 'SKILL.md');
  const r = instalar.instalar('agy', p);
  assert.strictEqual(lerTexto(p.raiz, 'skills', 'init', 'SKILL.md'), antes);
  assert.ok(r.passos.some((s) => s.includes(VAR) && s.includes(barra(p.raiz))), r.passos.join('\n'));
});

test('instalar: no dsh e no OpenCode as skills vao para .agents/skills/sworn-<nome> do projeto, com a raiz', () => {
  for (const h of ['dsh', 'opencode']) {
    const p = Object.assign(pastas(), { raiz: raizFalsa() });
    fs.mkdirSync(path.join(p.raiz, '.git'));
    const antes = lerTexto(p.raiz, 'skills', 'init', 'SKILL.md');
    const minha = path.join(p.projeto, '.agents', 'skills', 'minha', 'SKILL.md');
    fs.mkdirSync(path.dirname(minha), { recursive: true });
    fs.writeFileSync(minha, 'minha\n');
    instalar.instalar(h, p);
    const r = instalar.instalar(h, p);
    const copia = path.join(p.projeto, '.agents', 'skills', 'sworn-init');
    const t = lerTexto(copia, 'SKILL.md');
    // O nome da skill acompanha o da pasta (Agent Skills), e o prefixo nao colide com as skills do projeto.
    assert.ok(t.startsWith('---\nname: sworn-init\ndescription: x\n---\n'), h + t);
    assert.ok(t.includes('node "' + barra(p.raiz) + '/scripts/a.js"') && !t.includes(VAR), h + t);
    assert.strictEqual(lerTexto(copia, 'references', 'r.md'), 'veja ' + barra(p.raiz) + '/docs\n');
    assert.strictEqual(lerTexto(p.raiz, 'skills', 'init', 'SKILL.md'), antes);
    assert.strictEqual(lerTexto(minha), 'minha\n');
    assert.ok(r.gravados.includes(path.join(copia, 'SKILL.md')), r.gravados.join('\n'));
    assert.ok(!r.passos.some((s) => s.includes(VAR)), r.passos.join('\n'));
  }
});

// Etapa 4b (D756): os agentes de agents/*.md (fonte unica) na forma de cada harness que nomeia agente (sondas
// s278-s279); o agy e o dsh so tem o agente padrao. As skills de esforco ficam so no Claude Code.
const fonteDoAgente = (nome) => {
  const t = lerTexto(RAIZ, 'agents', nome + '.md');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(t);
  const descricao = /^description:[ \t]*(.*)$/m.exec(m[1])[1].trim();
  return { descricao, corpo: t.slice(m[0].length) };
};

test('instalar: Codex, Qwen e OpenCode ganham os agentes do sworn como sworn-<papel>, do agents/*.md', () => {
  const p = pastas();
  const gravados = [];
  for (const h of harnessLib.HARNESSES) gravados.push(...instalar.instalar(h, p).gravados);
  const insp = fonteDoAgente('inspector');
  const toml = lerTexto(p.projeto, '.codex', 'agents', 'sworn-inspector.toml');
  assert.match(toml, /^name = "sworn-inspector"$/m);
  assert.strictEqual(JSON.parse(/^description = (.*)$/m.exec(toml)[1]), insp.descricao);
  assert.strictEqual(JSON.parse(/^developer_instructions = (.*)$/m.exec(toml)[1]), insp.corpo);
  const qwen = lerTexto(p.projeto, '.qwen', 'agents', 'sworn-inspector.md');
  assert.ok(qwen.startsWith('---\nname: sworn-inspector\ndescription: ' + JSON.stringify(insp.descricao) +
    '\ntools:\n  - read_file\n  - grep_search\n  - glob\n---\n'), qwen.slice(0, 400));
  assert.ok(qwen.endsWith(insp.corpo));
  const leitor = lerTexto(p.projeto, '.qwen', 'agents', 'sworn-reader.md');
  assert.ok(leitor.includes('\ntools:\n  - read_file\n  - grep_search\n  - glob\n  - run_shell_command\n---\n'),
    leitor);
  const oc = lerTexto(p.projeto, '.opencode', 'agent', 'sworn-inspector.md');
  assert.ok(oc.startsWith('---\ndescription: ' + JSON.stringify(insp.descricao) + '\nmode: subagent\ntools:\n' +
    '  write: false\n  edit: false\n  bash: false\n---\n'), oc.slice(0, 400));
  // O leitor roda comando: no OpenCode, so a escrita e a edicao ficam negadas.
  assert.ok(lerTexto(p.projeto, '.opencode', 'agent', 'sworn-reader.md').includes(
    '\ntools:\n  write: false\n  edit: false\n---\n'));
  for (const nome of ['inspector', 'dedupe-judge', 'reader']) {
    for (const arq of [path.join(p.projeto, '.codex', 'agents', 'sworn-' + nome + '.toml'),
      path.join(p.projeto, '.qwen', 'agents', 'sworn-' + nome + '.md'),
      path.join(p.projeto, '.opencode', 'agent', 'sworn-' + nome + '.md')]) assert.ok(gravados.includes(arq), arq);
  }
  assert.ok(!fs.existsSync(path.join(p.projeto, '.agents', 'agents')));
  assert.ok(!gravados.some((g) => /[\\/]\.dsh[\\/]agents|[\\/]\.agents[\\/]agents/.test(g)), gravados.join('\n'));
});

test('instalar: sem agents/ na raiz, nenhum agente; skill de esforco fora da copia do dsh e do OpenCode', () => {
  for (const h of ['dsh', 'opencode', 'qwen']) {
    const p = Object.assign(pastas(), { raiz: raizFalsa() });
    fs.mkdirSync(path.join(p.raiz, '.git'));
    for (const s of ['effort-high', 'effort-low']) {
      fs.mkdirSync(path.join(p.raiz, 'skills', s), { recursive: true });
      fs.writeFileSync(path.join(p.raiz, 'skills', s, 'SKILL.md'), '---\nname: ' + s + '\ndescription: x\n---\nx\n');
    }
    const r = instalar.instalar(h, p);
    assert.ok(!r.gravados.some((g) => /effort-|[\\/]agents?[\\/]sworn-/.test(g)), h + ': ' + r.gravados.join('\n'));
  }
  const p = Object.assign(pastas(), { raiz: raizFalsa() });
  instalar.instalar('dsh', p);
  assert.ok(fs.existsSync(path.join(p.projeto, '.agents', 'skills', 'sworn-init', 'SKILL.md')), 'o resto vai');
});

test('instalar: agente sem tools herda todas; ferramenta sem par fica fora; .md sem frontmatter nao e agente', () => {
  const p = Object.assign(pastas(), { raiz: raizFalsa() });
  fs.mkdirSync(path.join(p.raiz, '.git'));
  fs.mkdirSync(path.join(p.raiz, 'agents'));
  fs.writeFileSync(path.join(p.raiz, 'agents', 'livre.md'), '---\nname: livre\ndescription: livre\n---\ncorpo\n');
  fs.writeFileSync(path.join(p.raiz, 'agents', 'meio.md'),
    '---\nname: meio\ndescription: meio\ntools: Read, WebSearch\n---\ncorpo\n');
  fs.writeFileSync(path.join(p.raiz, 'agents', 'torto.md'), 'sem frontmatter\n');
  fs.writeFileSync(path.join(p.raiz, 'agents', 'so-web.md'),
    '---\nname: so-web\ndescription: so-web\ntools: WebSearch\n---\ncorpo\n');
  const gravados = [];
  const passos = [];
  for (const h of ['codex', 'qwen', 'opencode']) {
    const r = instalar.instalar(h, p);
    gravados.push(...r.gravados);
    passos.push(...r.passos);
  }
  // Nenhuma ferramenta com par no Qwen: o tools: vazio liberaria todas, e o agente fica fora do Qwen (os outros o tem).
  assert.ok(!fs.existsSync(path.join(p.projeto, '.qwen', 'agents', 'sworn-so-web.md')));
  assert.ok(fs.existsSync(path.join(p.projeto, '.opencode', 'agent', 'sworn-so-web.md')));
  assert.ok(passos.some((s) => s.includes('agents/so-web.md') && s.includes('Qwen')), passos.join('\n'));
  // O .md sem cabecalho nao e agente, e o instalador diz qual ficou fora.
  assert.ok(passos.some((s) => s.includes('agents/torto.md')), passos.join('\n'));
  // O dsh nao nomeia agente: nem le a pasta.
  assert.ok(!instalar.instalar('dsh', p).passos.some((s) => s.includes('agents/')));
  assert.strictEqual(lerTexto(p.projeto, '.qwen', 'agents', 'sworn-livre.md'),
    '---\nname: sworn-livre\ndescription: "livre"\n---\ncorpo\n');
  assert.strictEqual(lerTexto(p.projeto, '.opencode', 'agent', 'sworn-livre.md'),
    '---\ndescription: "livre"\nmode: subagent\n---\ncorpo\n');
  assert.ok(lerTexto(p.projeto, '.qwen', 'agents', 'sworn-meio.md').includes('\ntools:\n  - read_file\n---\n'));
  assert.ok(!gravados.some((g) => /sworn-torto/.test(g)), gravados.join('\n'));
});

test('instalar: no Codex o effort: do agents/*.md vira o model_reasoning_effort do .toml (D760, sonda s290)', () => {
  const p = Object.assign(pastas(), { raiz: raizFalsa() });
  fs.mkdirSync(path.join(p.raiz, '.git'));
  fs.mkdirSync(path.join(p.raiz, 'agents'));
  const niveis = { baixo: 'low', medio: 'medium', alto: 'high', xalto: 'xhigh', maximo: 'max', torto: 'turbo',
    sem: undefined, aspas: '"high"' };
  for (const [nome, nivel] of Object.entries(niveis)) {
    fs.writeFileSync(path.join(p.raiz, 'agents', nome + '.md'), '---\nname: ' + nome + '\ndescription: ' + nome +
      '\n' + (nivel ? 'effort: ' + nivel + '\n' : '') + '---\ncorpo\n');
  }
  const r = instalar.instalar('codex', p);
  const q = instalar.instalar('qwen', p);
  const esforco = (nome) => {
    const m = /^model_reasoning_effort = (.*)$/m.exec(lerTexto(p.projeto, '.codex', 'agents', 'sworn-' + nome + '.toml'));
    return m ? JSON.parse(m[1]) : null;
  };
  // Nivel que o Codex nao tem fica fora: o Codex recusaria o .toml.
  assert.deepStrictEqual(Object.keys(niveis).map(esforco), ['low', 'medium', 'high', 'xhigh', 'max', null, null,
    null]);
  // ... mas nao calado: um passo por agente com effort: que o Codex nao tem, e so no Codex.
  assert.deepStrictEqual(r.passos.filter((s) => s.includes('effort:')).map((s) => s.split(' ')[0]),
    ['agents/aspas.md', 'agents/torto.md']);
  assert.ok(!q.passos.some((s) => s.includes('effort:')), q.passos.join('\n'));
  assert.ok(!lerTexto(p.projeto, '.qwen', 'agents', 'sworn-baixo.md').includes('effort'), 'so no Codex');
});

test('instalar: agents/ que nao se le vira passo (sem a pasta, nao); tools: em bloco fica fora, nao livre', () => {
  const sem = Object.assign(pastas(), { raiz: raizFalsa() });
  fs.mkdirSync(path.join(sem.raiz, '.git'));
  assert.ok(!instalar.instalar('qwen', sem).passos.some((s) => s.includes('agents/')));
  const torta = Object.assign(pastas(), { raiz: raizFalsa() });
  fs.mkdirSync(path.join(torta.raiz, '.git'));
  fs.writeFileSync(path.join(torta.raiz, 'agents'), 'um arquivo, nao a pasta\n');
  const passos = instalar.instalar('qwen', torta).passos;
  assert.ok(passos.some((s) => s.includes('agents/') && s.includes('ENOTDIR') && s.includes('rode o instalador')),
    passos.join('\n'));
  // O tools: com a lista nas linhas de baixo nao se le: sem o passo, o agente sairia sem restricao. O .md que nao se le
  // (aqui, uma pasta) vira passo e nao derruba o instalador no meio: o instalado.json sai.
  const p = Object.assign(pastas(), { raiz: raizFalsa() });
  fs.mkdirSync(path.join(p.raiz, '.git'));
  fs.mkdirSync(path.join(p.raiz, 'agents', 'pasta.md'), { recursive: true });
  fs.writeFileSync(path.join(p.raiz, 'agents', 'bloco.md'),
    '---\nname: bloco\ndescription: bloco\ntools:\n  - Read\n---\ncorpo\n');
  for (const h of ['codex', 'qwen', 'opencode']) {
    const r = instalar.instalar(h, p);
    assert.ok(!r.gravados.some((g) => /sworn-bloco/.test(g)), h + ': ' + r.gravados.join('\n'));
    assert.ok(r.passos.some((s) => s.includes('agents/bloco.md')), h + ': ' + r.passos.join('\n'));
    assert.ok(r.passos.some((s) => s.includes('agents/pasta.md') && s.includes('EISDIR')),
      h + ': ' + r.passos.join('\n'));
  }
});

test('ponte: o gancho que roda marca o evento na pasta de ligado do harness; sem a pasta, nada', () => {
  const p = pastas();
  const stop = { session_id: 's-marca', cwd: p.projeto, hook_event_name: 'Stop' };
  ponte.rodar('codex', 'portao-fecho', stop, { executar: () => '' });
  assert.ok(!fs.existsSync(path.join(p.projeto, '.claude')));
  instalar.instalar('codex', p);
  const ligado = path.join(p.projeto, '.claude', 'sworn', 'ligado', 'codex');
  assert.strictEqual(fs.readFileSync(path.join(ligado, '.gitignore'), 'utf8'), '*\n');
  ponte.rodar('codex', 'portao-fecho', stop, { executar: () => '' });
  assert.ok(!isNaN(Date.parse(fs.readFileSync(path.join(ligado, 'Stop--portao-fecho'), 'utf8'))));
  // O matcher que nao casa nao roda o portao, mas o gancho rodou: marca.
  const ler = { session_id: 's-marca', cwd: p.projeto, hook_event_name: 'PreToolUse', tool_name: 'Read',
    tool_input: { file_path: 'a.txt' } };
  ponte.rodar('codex', 'portao-escopo', ler, { executar: () => assert.fail('nao devia rodar') });
  assert.ok(fs.existsSync(path.join(ligado, 'PreToolUse--portao-escopo')));
});

test('conferir: sem instalar, o passo e instalar', () => {
  const p = pastas();
  const r = instalar.conferir('qwen', p);
  assert.strictEqual(r.verde, false);
  assert.ok(r.passos[0].includes('instalar.js" qwen'), r.passos[0]);
});

test('hashDoCodex: o mesmo hash do /hooks do Codex (vetores da conta que bateu 14 de 14 no config.toml real)', () => {
  assert.strictEqual(instalar.hashDoCodex('PreToolUse', { matcher: 'Bash' },
    { type: 'command', command: 'node "/x/scripts/ponte.js" codex portao-fecho', timeout: 30 }),
  'sha256:e925bf06598641279bb49fff5272f980ff13a8200d67de21a6d5357ea287dbbb');
  // Stop nao leva matcher; sem timeout vale 600.
  assert.strictEqual(instalar.hashDoCodex('Stop', { matcher: 'ignorado' }, { type: 'command', command: 'node a.js' }),
    'sha256:2209dfac6d54a0ae025f09e1396c828198a853868c33615151003b14af7eeeac');
  // SessionEnd corta o timeout em 3.
  assert.strictEqual(instalar.hashDoCodex('SessionEnd', {}, { type: 'command', command: 'node b.js', timeout: 10 }),
    'sha256:4b378f9f4568326d79399e73446ad4647d916c0ca69b7679c45eb86a32783ee3');
});

// O [hooks.state] como o Codex grava: chave entre aspas duplas, com a barra do Windows escapada.
function aprovarNoCodex(p, trocar) {
  const arq = path.join(p.projeto, '.codex', 'hooks.json');
  const hooks = JSON.parse(fs.readFileSync(arq, 'utf8')).hooks;
  let toml = '[features]\nhooks = true\n\n';
  for (const [ev, grupos] of Object.entries(hooks)) {
    const snake = ev.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
    grupos.forEach((grupo, gi) => grupo.hooks.forEach((g, hi) => {
      const chave = arq + ':' + snake + ':' + gi + ':' + hi;
      const padrao = 'trusted_hash = "' + instalar.hashDoCodex(ev, grupo, g) + '"';
      const linhas = (trocar && trocar(chave, padrao)) || [padrao];
      toml += '[hooks.state."' + chave.replace(/\\/g, '\\\\') + '"]\n' + linhas.join('\n') + '\n\n';
    }));
  }
  fs.mkdirSync(path.join(p.home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(p.home, '.codex', 'config.toml'), toml);
}

test('conferir: instalado sem gancho rodado nao e verde; no Codex, aprovacao de hash velho nao conta', () => {
  const p = pastas();
  instalar.instalar('codex', p);
  aprovarNoCodex(p, (chave) => /:pre_tool_use:0:0$/.test(chave) && ['trusted_hash = "sha256:0"']);
  const r = instalar.conferir('codex', p);
  assert.strictEqual(r.verde, false);
  assert.match(r.passos.join('\n'), /\/hooks/);
  const total = JSON.parse(fs.readFileSync(path.join(p.projeto, '.claude', 'sworn', 'ligado', 'codex',
    'instalado.json'), 'utf8')).ganchos;
  assert.match(r.passos.join('\n'), new RegExp('aprovados: ' + (total - 1) + ' de ' + total + '\\)'));
});

test('conferir: no Codex, gancho rodado so e verde com todos os ganchos do sworn aprovados como estao hoje', () => {
  const p = pastas();
  // Um gancho do dono antes dos do sworn: desloca o indice dos nossos e nao entra na conta.
  fs.mkdirSync(path.join(p.projeto, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(p.projeto, '.codex', 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [
    { matcher: 'Bash', hooks: [{ type: 'command', command: 'node dono.js' }] }] } }));
  instalar.instalar('codex', p);
  ponte.rodar('codex', 'portao-fecho', { session_id: 's-hash', cwd: p.projeto, hook_event_name: 'Stop' },
    { executar: () => '' });
  const total = JSON.parse(fs.readFileSync(path.join(p.projeto, '.claude', 'sworn', 'ligado', 'codex',
    'instalado.json'), 'utf8')).ganchos;
  aprovarNoCodex(p);
  assert.strictEqual(instalar.conferir('codex', p).verde, true);
  // Depois de atualizar o sworn, o gancho mudado fica com o hash velho: o Codex nao roda ele, e nao e verde.
  aprovarNoCodex(p, (chave) => /:pre_tool_use:1:0$/.test(chave) && ['trusted_hash = "sha256:velho"']);
  let r = instalar.conferir('codex', p);
  assert.strictEqual(r.verde, false);
  assert.match(r.passos.join('\n'), new RegExp('aprovados: ' + (total - 1) + ' de ' + total + '\\)'));
  assert.doesNotMatch(r.passos.join('\n'), /mande qualquer pedido/, 'o gancho ja rodou');
  // O desligado no /hooks tambem nao roda.
  aprovarNoCodex(p, (chave, padrao) => /:stop:0:0$/.test(chave) && ['enabled = false', padrao]);
  r = instalar.conferir('codex', p);
  assert.strictEqual(r.verde, false);
  assert.match(r.passos.join('\n'), new RegExp('aprovados: ' + (total - 1) + ' de ' + total + '\\)'));
});

test('Codex: com todos aprovados nao pede /hooks; sem o hooks.json, pede instalar de novo, nao aprovar', () => {
  const p = pastas();
  instalar.instalar('codex', p);
  aprovarNoCodex(p);
  // Reinstalar sem mudar nada: a aprovacao vale, e o passo nao manda aprovar de novo.
  assert.ok(!instalar.instalar('codex', p).passos.some((s) => s.includes('rode /hooks')));
  let r = instalar.conferir('codex', p);
  assert.strictEqual(r.verde, false);
  assert.ok(!r.passos.some((s) => s.includes('rode /hooks')), r.passos.join('\n'));
  assert.match(r.passos.join('\n'), /mande qualquer pedido/);
  ponte.rodar('codex', 'portao-fecho', { session_id: 's-sem', cwd: p.projeto, hook_event_name: 'Stop' },
    { executar: () => '' });
  fs.renameSync(path.join(p.projeto, '.codex', 'hooks.json'), path.join(p.projeto, '.codex', 'hooks.json.velho'));
  r = instalar.conferir('codex', p);
  assert.strictEqual(r.verde, false);
  assert.match(r.passos.join('\n'), /hooks\.json deste projeto não tem os ganchos do sworn.*" codex de novo/);
  assert.ok(!r.passos.some((s) => s.includes('rode /hooks')), r.passos.join('\n'));
});

test('conferir: depois de um gancho rodar, verde, com os eventos ligados e os ainda nao vistos', () => {
  const p = pastas();
  instalar.instalar('qwen', p);
  ponte.rodar('qwen', 'abertura', { session_id: 's1', cwd: p.projeto, hook_event_name: 'SessionStart' },
    { executar: () => '' });
  const r = instalar.conferir('qwen', p);
  assert.strictEqual(r.verde, true);
  assert.deepStrictEqual(r.ligados, ['SessionStart']);
  assert.ok(r.naoVistos.includes('Stop'), r.naoVistos.join(','));
  assert.ok(!r.naoVistos.includes('SessionStart'));
});

test('conferir: marca de antes da instalacao nao conta, e o sworn noutra pasta pede instalar de novo', () => {
  const p = pastas();
  instalar.instalar('qwen', p);
  const marca = path.join(p.projeto, '.claude', 'sworn', 'ligado', 'qwen', 'SessionStart--abertura');
  fs.writeFileSync(marca, '2000-01-01T00:00:00.000Z');
  assert.strictEqual(instalar.conferir('qwen', p).verde, false);
  fs.writeFileSync(marca, new Date(Date.now() + 1000).toISOString());
  assert.strictEqual(instalar.conferir('qwen', p).verde, true);
  const r = instalar.conferir('qwen', Object.assign({}, p, { raiz: path.join(TMP, 'outra-versao') }));
  assert.strictEqual(r.verde, false);
  assert.match(r.passos.join('\n'), /de novo/);
});

test('instalar.js: harness desconhecido sai com 2; --conferir sai com 1 ate um gancho rodar', () => {
  const p = pastas();
  const errado = spawnSync(process.execPath, [INSTALAR, 'gemini'], { cwd: p.projeto, encoding: 'utf8' });
  assert.strictEqual(errado.status, 2);
  assert.match(errado.stderr, /uso:/);
  const ok = spawnSync(process.execPath, [INSTALAR, 'qwen'], { cwd: p.projeto, encoding: 'utf8' });
  assert.strictEqual(ok.status, 0, ok.stderr);
  assert.ok(fs.existsSync(path.join(p.projeto, '.qwen', 'settings.json')));
  const c = spawnSync(process.execPath, [INSTALAR, '--conferir', 'qwen'], { cwd: p.projeto, encoding: 'utf8' });
  assert.strictEqual(c.status, 1);
  assert.match(c.stdout, /faltam/);
});

/** O plugin do OpenCode com a ponte de mentira: grava cada chamada e responde o que `responder` devolver. */
async function plugin(responder, lerGanchos) {
  const mod = await import(pathToFileURL(path.join(RAIZ, 'opencode', 'sworn.mjs')).href);
  const chamadas = [];
  const prompts = [];
  const rodar = (harness, script, bruta) => {
    chamadas.push({ harness, script, bruta });
    return (responder && responder(script, bruta)) || '';
  };
  const client = { session: {
    get: async (a) => {
      if (a.path.id === 'ses_get_fora') throw new Error('get fora');
      // O SDK do OpenCode devolve o erro HTTP em `error`, sem lancar (so lanca com throwOnError).
      if (a.path.id === 'ses_get_erro') return { error: { name: 'NotFoundError' } };
      return { data: { parentID: a.path.id === 'ses_filha' ? 'ses_pai' : undefined } };
    },
    prompt: async (a) => {
      if (a.path.id === 'ses_sem_servidor') throw new Error('servidor fora');
      prompts.push(a);
    }
  } };
  const ganchos = await mod.criar(rodar, lerGanchos)({ client, directory: 'C:\\dev\\proj' });
  return { ganchos, chamadas, prompts };
}

/** O que `fn` escreve no stderr, sem sair no terminal do teste. */
async function stderrDe(fn) {
  const original = process.stderr.write;
  let escrito = '';
  process.stderr.write = (t) => { escrito += t; return true; };
  try { await fn(); } finally { process.stderr.write = original; }
  return escrito;
}

test('opencode: o deny da ponte vira throw com o motivo, e a ponte recebe o gancho, a ferramenta e o cwd', async () => {
  const f = fixture('opencode-tool.execute.before-write');
  const o = await plugin((s) => (s === 'portao-escopo' ? JSON.stringify({ negar: 'fora do escopo' }) : ''));
  await assert.rejects(o.ganchos['tool.execute.before'](f.input, f.output), /fora do escopo/);
  const c = o.chamadas.find((x) => x.script === 'portao-escopo');
  assert.strictEqual(c.harness, 'opencode');
  assert.strictEqual(c.bruta.hook_event_name, 'tool.execute.before');
  assert.strictEqual(c.bruta.tool_name, 'write');
  assert.strictEqual(c.bruta.cwd, 'C:\\dev\\proj');
  assert.deepStrictEqual(c.bruta.output, f.output);
});

test('opencode: o contexto do pos-ferramenta entra no fim da saida da ferramenta', async () => {
  const f = fixture('opencode-tool.execute.after-write');
  const o = await plugin((s) => (s === 'marcar-trabalho' ? JSON.stringify({ contexto: 'KIWI' }) : ''));
  const saida = Object.assign({}, f.output, { output: 'ok' });
  await o.ganchos['tool.execute.after'](f.input, saida);
  assert.strictEqual(saida.output, 'ok\n\nKIWI');
});

test('opencode: ferramenta sem saida recebe so o contexto, sem "undefined" nem "null" na frente', async () => {
  const f = fixture('opencode-tool.execute.after-write');
  const o = await plugin((s) => (s === 'marcar-trabalho' ? JSON.stringify({ contexto: 'KIWI' }) : ''));
  for (const vazio of [undefined, null]) {
    const saida = Object.assign({}, f.output, { output: vazio });
    await o.ganchos['tool.execute.after'](f.input, saida);
    assert.strictEqual(saida.output, 'KIWI');
  }
});

test('opencode: a abertura roda uma vez por sessao e entra no sistema a cada chamada, com o contexto do turno', async () => {
  const o = await plugin((s) => {
    if (s === 'abertura') return JSON.stringify({ contexto: 'ABERTURA' });
    if (s === 'abrir-turno') return JSON.stringify({ contexto: 'TURNO' });
    return '';
  });
  const f = fixture('opencode-experimental.chat.system.transform');
  const um = { system: ['base'] };
  const dois = { system: ['base'] };
  await o.ganchos['experimental.chat.system.transform'](f.input, um);
  const m = fixture('opencode-chat.message');
  await o.ganchos['chat.message'](m.input, m.output);
  await o.ganchos['experimental.chat.system.transform'](f.input, dois);
  assert.deepStrictEqual(um.system, ['base', 'ABERTURA']);
  assert.deepStrictEqual(dois.system, ['base', 'ABERTURA', 'TURNO']);
  assert.strictEqual(o.chamadas.filter((c) => c.script === 'abertura').length, 1);
});

test('opencode: o Stop que barra reenvia o motivo na sessao de topo; a sessao filha passa', async () => {
  const o = await plugin((s) => (s === 'portao-fecho' ? JSON.stringify({ bloquear: 'falta a prova' }) : ''));
  await o.ganchos.event({ event: { type: 'session.idle', properties: { sessionID: 'ses_filha' } } });
  assert.strictEqual(o.prompts.length, 0);
  await o.ganchos.event({ event: { type: 'session.idle', properties: { sessionID: 'ses_topo' } } });
  assert.deepStrictEqual(o.prompts, [{ path: { id: 'ses_topo' },
    body: { parts: [{ type: 'text', text: 'falta a prova' }] } }]);
  await o.ganchos.event({ event: { type: 'session.created', properties: {} } });
  assert.strictEqual(o.prompts.length, 1);
});

test('opencode: o reenvio do motivo do fecho que falha libera (R6) e fica dito no stderr', async () => {
  const o = await plugin((s) => (s === 'portao-fecho' ? JSON.stringify({ bloquear: 'falta a prova' }) : ''));
  const dito = await stderrDe(() =>
    o.ganchos.event({ event: { type: 'session.idle', properties: { sessionID: 'ses_sem_servidor' } } }));
  assert.match(dito, /^sworn: .*fecho.*\(servidor fora\)/m);
  // s296 (D763): o portao rodou e barrou; o que falhou foi so a entrega, e o motivo vai a quem le o stderr.
  assert.doesNotMatch(dito, /sem o portao/);
  assert.match(dito, /barrou.*falta a prova/);
});

test('opencode: a consulta da sessao que falha libera (R6), sem reenvio, e fica dita no stderr', async () => {
  const o = await plugin((s) => (s === 'portao-fecho' ? JSON.stringify({ bloquear: 'falta a prova' }) : ''));
  const dito = await stderrDe(() =>
    o.ganchos.event({ event: { type: 'session.idle', properties: { sessionID: 'ses_get_fora' } } }));
  assert.match(dito, /^sworn: .*sessao.*\(get fora\)/m);
  assert.strictEqual(o.prompts.length, 0);
  assert.strictEqual(o.chamadas.filter((c) => c.script === 'portao-fecho').length, 0);
});

test('opencode: a consulta da sessao que devolve erro sem lancar tambem libera e fica dita', async () => {
  const o = await plugin((s) => (s === 'portao-fecho' ? JSON.stringify({ bloquear: 'falta a prova' }) : ''));
  const dito = await stderrDe(() =>
    o.ganchos.event({ event: { type: 'session.idle', properties: { sessionID: 'ses_get_erro' } } }));
  assert.match(dito, /^sworn: .*sessao.*NotFoundError/m);
  assert.strictEqual(o.prompts.length, 0);
  assert.strictEqual(o.chamadas.filter((c) => c.script === 'portao-fecho').length, 0);
});

test('opencode: a sessao apagada sai da memoria do plugin: a abertura roda de novo e o turno velho some', async () => {
  const o = await plugin((s) => {
    if (s === 'abertura') return JSON.stringify({ contexto: 'ABERTURA' });
    if (s === 'abrir-turno') return JSON.stringify({ contexto: 'TURNO' });
    return '';
  });
  const transformar = async () => {
    const saida = { system: [] };
    await o.ganchos['experimental.chat.system.transform']({ sessionID: 'ses_a' }, saida);
    return saida.system;
  };
  await o.ganchos['chat.message']({ sessionID: 'ses_a' }, { parts: [] });
  assert.deepStrictEqual(await transformar(), ['ABERTURA', 'TURNO']);
  await o.ganchos.event({ event: { type: 'session.deleted', properties: { info: { id: 'ses_a' } } } });
  o.chamadas.length = 0;
  assert.deepStrictEqual(await transformar(), ['ABERTURA']);
  assert.strictEqual(o.chamadas.filter((c) => c.script === 'abertura').length, 1);
});

test('opencode: falha da ponte libera (R6) e fica dita no stderr, com o portao e o erro', async () => {
  const o = await plugin(() => { throw new Error('quebrou'); });
  const f = fixture('opencode-tool.execute.before-write');
  const dito = await stderrDe(() => o.ganchos['tool.execute.before'](f.input, f.output));
  assert.match(dito, /^sworn: .*portao-escopo.*\(quebrou\)/m);
  // s296 (D763): a mensagem diz o que fazer, com o caminho real do instalador.
  assert.ok(dito.includes(instalar.comandoDoInstalar(RAIZ, '--conferir opencode')), dito);
});

test('opencode: erro sem message (texto lancado, objeto do SDK) sai no stderr, nunca "(undefined)"', async () => {
  const f = fixture('opencode-tool.execute.before-write');
  const casos = [['quebrou em texto', '(quebrou em texto)'], [{ name: 'Falha' }, '({"name":"Falha"})']];
  for (const [erro, esperado] of casos) {
    const o = await plugin(() => { throw erro; });
    const dito = await stderrDe(() => o.ganchos['tool.execute.before'](f.input, f.output));
    assert.ok(dito.includes(esperado), dito);
    assert.doesNotMatch(dito, /undefined/);
  }
});

test('opencode: a abertura que falha nao fica guardada: a chamada seguinte ao modelo tenta de novo', async () => {
  let falhar = true;
  const o = await plugin((s) => {
    if (s !== 'abertura') return '';
    if (falhar) { falhar = false; throw new Error('abertura fora'); }
    return JSON.stringify({ contexto: 'ABERTURA' });
  });
  const f = fixture('opencode-experimental.chat.system.transform');
  const um = { system: [] };
  const dois = { system: [] };
  await stderrDe(() => o.ganchos['experimental.chat.system.transform'](f.input, um));
  await o.ganchos['experimental.chat.system.transform'](f.input, dois);
  assert.deepStrictEqual(um.system, []);
  assert.deepStrictEqual(dois.system, ['ABERTURA']);
  assert.strictEqual(o.chamadas.filter((c) => c.script === 'abertura').length, 2);
});

test('opencode: a chamada sem sessao (a do Agent.generate) nao roda a abertura nem recebe contexto', async () => {
  const o = await plugin((s) => (s === 'abertura' ? JSON.stringify({ contexto: 'ABERTURA' }) : ''));
  const saida = { system: ['base'] };
  await o.ganchos['experimental.chat.system.transform']({ model: {} }, saida);
  assert.deepStrictEqual(saida.system, ['base']);
  assert.strictEqual(o.chamadas.length, 0);
});

test('opencode: hooks.json ilegivel libera (R6): o plugin carrega, nenhum portao roda e o stderr diz', async () => {
  let o;
  const dito = await stderrDe(async () => {
    o = await plugin(() => JSON.stringify({ negar: 'nao devia rodar' }), () => { throw new Error('sem hooks.json'); });
  });
  assert.match(dito, /^sworn: .*hooks\.json.*\(sem hooks\.json\)/m);
  const f = fixture('opencode-tool.execute.before-write');
  await o.ganchos['tool.execute.before'](f.input, f.output);
  assert.strictEqual(o.chamadas.length, 0);
});
