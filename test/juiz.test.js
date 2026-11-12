'use strict';
// C3 (D808, D769 (b)): o inspetor um degrau acima do executor. O modelo da sessao sai da transcricao; o gancho troca o
// `model` do despacho do sworn:inspector pelo updatedInput, e so dele.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const lib = require('../scripts/lib/juiz.js');
const GANCHO = path.join(__dirname, '..', 'scripts', 'portao-juiz.js');

function pasta(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-juiz-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function transcricao(dir, modelos) {
  const linhas = [JSON.stringify({ type: 'user', message: { content: 'oi' } })].concat(modelos.map(function (m) {
    return JSON.stringify({ type: 'assistant', message: { model: m, content: [] } });
  }));
  const arquivo = path.join(dir, 'sessao.jsonl');
  fs.writeFileSync(arquivo, linhas.join('\n') + '\n');
  return arquivo;
}

function gancho(dir, entrada) {
  const r = spawnSync(process.execPath, [GANCHO], { cwd: dir, input: JSON.stringify(Object.assign({ cwd: dir }, entrada)),
    encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout) : null;
}

test('C3 juiz: o degrau acima do executor; o desconhecido fica com o do agente', () => {
  assert.strictEqual(lib.juizDe('haiku'), 'sonnet');
  assert.strictEqual(lib.juizDe('sonnet'), 'opus');
  assert.strictEqual(lib.juizDe('opus'), 'opus');
  assert.strictEqual(lib.juizDe(''), null);
  assert.strictEqual(lib.juizDe('constructor'), null, 'so os degraus, nunca o que o objeto herda');
  assert.strictEqual(lib.jaBasta('opus', 'sonnet'), true);
  assert.strictEqual(lib.jaBasta('sonnet', 'sonnet'), true);
  assert.strictEqual(lib.jaBasta('haiku', 'sonnet'), false);
  assert.strictEqual(lib.jaBasta(undefined, 'sonnet'), false);
  // o pedido vale pelo apelido; o que nao se entende fica como veio (troca-lo podia rebaixar)
  assert.strictEqual(lib.jaBasta('Opus', 'sonnet'), true);
  assert.strictEqual(lib.jaBasta('claude-opus-4-1', 'sonnet'), true);
  assert.strictEqual(lib.jaBasta('claude-haiku-5-5', 'sonnet'), false);
  assert.strictEqual(lib.jaBasta('inherit', 'sonnet'), false, 'inherit e o modelo da sessao: o juiz sobe');
  assert.strictEqual(lib.jaBasta('Inherit', 'sonnet'), false, 'a caixa nao muda o inherit');
  assert.strictEqual(lib.jaBasta('modelo-qualquer', 'sonnet'), true, 'o id sem apelido fica como veio');
});

test('C3 juiz: o modelo da sessao e o da ultima resposta, sem a sintetica; sem arquivo, nao se sabe', () => {
  pasta(function (dir) {
    assert.strictEqual(lib.modeloDaSessao(transcricao(dir, ['claude-opus-5-5', 'claude-haiku-5-5', '<synthetic>'])),
      'haiku');
    assert.strictEqual(lib.modeloDaSessao(path.join(dir, 'nao-existe.jsonl')), '');
    assert.strictEqual(lib.modeloDaSessao(undefined), '');
    fs.writeFileSync(path.join(dir, 'cortada.jsonl'), '{"type":"assistant","message":{"mod\n');
    assert.strictEqual(lib.modeloDaSessao(path.join(dir, 'cortada.jsonl')), '', 'a linha cortada fica de fora');
  });
});

test('C3 juiz: o gancho sobe o inspetor um degrau, so o inspetor, e respeita o pedido mais forte e a chave', () => {
  pasta(function (dir) {
    const haiku = transcricao(dir, ['claude-haiku-5-5']);
    const inspetor = { tool_name: 'Agent', transcript_path: haiku,
      tool_input: { subagent_type: 'sworn:inspector', prompt: 'lente', description: 'x' } };
    const r = gancho(dir, inspetor);
    assert.strictEqual(r.hookSpecificOutput.updatedInput.model, 'sonnet');
    assert.strictEqual(r.hookSpecificOutput.updatedInput.prompt, 'lente', 'o resto do pedido segue igual');
    assert.strictEqual(r.hookSpecificOutput.permissionDecision, undefined, 'o gancho nao decide permissao');
    // fora do Claude Code o inspetor se chama sworn-inspector
    const fora = gancho(dir, Object.assign({}, inspetor, { tool_input: { subagent_type: 'sworn-inspector' } }));
    assert.strictEqual(fora.hookSpecificOutput.updatedInput.model, 'sonnet');
    // outro agente passa como veio
    assert.strictEqual(gancho(dir, Object.assign({}, inspetor, { tool_input: { subagent_type: 'general-purpose' } })),
      null);
    // o pedido que ja e mais forte fica
    assert.strictEqual(gancho(dir, Object.assign({}, inspetor,
      { tool_input: { subagent_type: 'sworn:inspector', model: 'opus' } })), null);
    // a sessao no Sonnet sobe o juiz para o Opus
    const sonnet = gancho(dir, Object.assign({}, inspetor, { transcript_path: transcricao(dir, ['claude-sonnet-5-5']) }));
    assert.strictEqual(sonnet.hookSpecificOutput.updatedInput.model, 'opus');
    // sem saber o modelo da sessao, passa como veio
    assert.strictEqual(gancho(dir, Object.assign({}, inspetor, { transcript_path: path.join(dir, 'x.jsonl') })), null);
    // a chave desliga
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify({ juizAcima: false }));
    assert.strictEqual(gancho(dir, Object.assign({}, inspetor, { transcript_path: haiku })), null);
  });
});

// D829: as rondas 2 e 3 da revisao cega so conferem e rodam um degrau abaixo do juiz da ronda 1
test('D829 juiz: a ronda sai do caminho de vereditos do briefing, com barra de qualquer sistema', () => {
  assert.strictEqual(lib.rondaDoBriefing('Verdicts folder: `C:/p/.claude/sworn/revisao/scripts__a.js/2/vereditos`.'), 2);
  assert.strictEqual(lib.rondaDoBriefing('C:\\p\\.claude\\sworn\\revisao\\GUIA.md\\3\\vereditos'), 3);
  assert.strictEqual(lib.rondaDoBriefing('/p/.claude/sworn/revisao/a.js/2/invertida/vereditos'), 2, 'a 2a passada');
  assert.strictEqual(lib.rondaDoBriefing('/p/.claude/sworn/revisao/a.js/1/vereditos'), 1);
  for (const t of ['', null, undefined, 'lente', '/p/revisao-fechada/a.js/2/vereditos', '/p/revisao/a.js/2/A.txt',
    '/p/revisao/a.js/2/vereditosx', '/p/revisao/a.js/x/vereditos']) {
    assert.strictEqual(lib.rondaDoBriefing(t), 0, JSON.stringify(t));
  }
});

test('D829 juiz: o modelo do despacho - ronda 1 no juiz, rondas 2 e 3 um degrau abaixo dele', () => {
  const r2 = { prompt: 'x /p/.claude/sworn/revisao/a.js/2/vereditos y' };
  assert.deepStrictEqual(['haiku', 'sonnet', 'opus', 'fable'].map(lib.conferenteDe), ['haiku', 'haiku', 'sonnet', 'opus']);
  assert.strictEqual(lib.conferenteDe('constructor'), null);
  // sessao Opus: Opus na ronda 1, Sonnet nas rondas 2 e 3, com qualquer pedido
  assert.strictEqual(lib.alvoDoDespacho('opus', { prompt: 'ronda 1' }), 'opus');
  assert.strictEqual(lib.alvoDoDespacho('opus', r2), 'sonnet');
  assert.strictEqual(lib.alvoDoDespacho('opus', Object.assign({ model: 'haiku' }, r2)), 'sonnet', 'o pedido mais fraco sobe');
  assert.strictEqual(lib.alvoDoDespacho('opus', Object.assign({ model: 'opus' }, r2)), 'sonnet', 'o pedido mais forte desce');
  assert.strictEqual(lib.alvoDoDespacho('opus', Object.assign({ model: 'claude-sonnet-5-5' }, r2)), null, 'ja no alvo, fica');
  // sessao Sonnet: juiz Opus, rondas 2 e 3 no Sonnet; sessao Haiku: juiz Sonnet, rondas 2 e 3 no Haiku
  assert.strictEqual(lib.alvoDoDespacho('sonnet', r2), 'sonnet');
  assert.strictEqual(lib.alvoDoDespacho('haiku', r2), 'haiku');
  // ronda 1 com pedido mais forte fica como veio (C3); sessao desconhecida, nada muda
  assert.strictEqual(lib.alvoDoDespacho('haiku', { model: 'opus', prompt: 'ronda 1' }), null);
  assert.strictEqual(lib.alvoDoDespacho('', r2), null);
});

test('D829 juiz: o gancho poe o inspetor da ronda 2 um degrau abaixo do juiz', () => {
  pasta(function (dir) {
    const opus = transcricao(dir, ['claude-opus-5-5']);
    const despacho = function (prompt, model) {
      const entrada = { tool_name: 'Agent', transcript_path: opus,
        tool_input: { subagent_type: 'sworn:inspector', prompt: prompt, description: 'x' } };
      if (model) entrada.tool_input.model = model;
      return gancho(dir, entrada);
    };
    assert.strictEqual(despacho('Verdicts folder: `' + dir + '/.claude/sworn/revisao/a.js/1/vereditos`').hookSpecificOutput
      .updatedInput.model, 'opus');
    const r2 = despacho('Verdicts folder: `' + dir + '/.claude/sworn/revisao/a.js/2/vereditos`', 'opus');
    assert.strictEqual(r2.hookSpecificOutput.updatedInput.model, 'sonnet');
    assert.strictEqual(r2.hookSpecificOutput.permissionDecision, undefined, 'o gancho nao decide permissao');
    assert.strictEqual(despacho(dir + '/.claude/sworn/revisao/a.js/3/vereditos', 'sonnet'), null, 'ja no alvo');
  });
});
