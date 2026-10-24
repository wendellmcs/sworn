'use strict';
// Plano 090 Tarefa 3, ultimo subitem (s81): o bloco "menos codigo" tambem chega aos subagentes que escrevem codigo,
// pelo SubagentStart. O contexto da abertura e so da conversa principal e nao chega ao subagente. Formato da doc
// (code.claude.com/docs/en/hooks): hookSpecificOutput.additionalContext; a entrada traz agent_type. Os agentes que so
// leem (inspetor, juiz-mesmo, leitor do sworn; Explore e Plan do Claude Code) nao recebem.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const enxuto = require('../scripts/lib/enxuto.js');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'abrir-subagente.js');

function pasta(projeto) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'esq-subag-'));
  if (projeto !== undefined) {
    fs.mkdirSync(path.join(d, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(d, '.claude', 'sworn', 'projeto.json'), JSON.stringify(projeto));
  }
  return d;
}

function rodar(entrada) {
  const r = spawnSync(process.execPath, [SCRIPT], {
    input: typeof entrada === 'string' ? entrada : JSON.stringify(entrada), encoding: 'utf8', timeout: 10000
  });
  return { status: r.status, saida: r.stdout, erro: r.stderr };
}

test('abrir-subagente: agente que escreve codigo recebe o bloco no formato JSON do SubagentStart', () => {
  const cwd = pasta();
  for (const tipo of ['general-purpose', 'desenvolvedor', 'outro-plugin:editor']) {
    const r = rodar({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: tipo, cwd });
    assert.strictEqual(r.status, 0, tipo + ': ' + r.erro);
    const j = JSON.parse(r.saida);
    assert.deepStrictEqual(j, { hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: enxuto.BLOCO } }, tipo);
  }
});

test('abrir-subagente: os agentes que so leem nao recebem (saida vazia, exit 0)', () => {
  const cwd = pasta();
  for (const tipo of ['sworn:inspector', 'sworn:dedupe-judge', 'sworn:reader', 'Explore', 'Plan']) {
    const r = rodar({ hook_event_name: 'SubagentStart', agent_type: tipo, cwd });
    assert.strictEqual(r.status, 0, tipo);
    assert.strictEqual(r.saida, '', tipo + ' recebeu o bloco');
  }
});

test('abrir-subagente: menosCodigo false no projeto.json desliga; outros valores mantem ligado', () => {
  const desligado = rodar({ agent_type: 'general-purpose', cwd: pasta({ menosCodigo: false }) });
  assert.strictEqual(desligado.status, 0);
  assert.strictEqual(desligado.saida, '');
  const ligado = rodar({ agent_type: 'general-purpose', cwd: pasta({ menosCodigo: 'false' }) });
  assert.strictEqual(JSON.parse(ligado.saida).hookSpecificOutput.additionalContext, enxuto.BLOCO);
});

test('abrir-subagente: entrada vazia, invalida ou sem agent_type falha aberto (injeta) e nunca estoura', () => {
  for (const entrada of ['', 'nao e json', { agent_type: 7 }, { cwd: 5 }]) {
    const r = rodar(entrada);
    assert.strictEqual(r.status, 0, JSON.stringify(entrada) + ': ' + r.erro);
    assert.strictEqual(JSON.parse(r.saida).hookSpecificOutput.additionalContext, enxuto.BLOCO, JSON.stringify(entrada));
  }
});

test('fiacao: o hooks.json liga o abrir-subagente no SubagentStart', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8')).hooks;
  const grupos = hooks.SubagentStart || [];
  const args = [].concat(...grupos.map((g) => g.hooks.map((h) => (h.args || []).join(' '))));
  assert.ok(args.some((a) => /scripts\/abrir-subagente\.js$/.test(a)), 'SubagentStart sem o abrir-subagente.js');
});
