'use strict';
const test = require('node:test');
const assert = require('node:assert');
const custo = require('../scripts/lib/custo.js');
const degraus = require('../scripts/lib/degraus.js');

const PROJETO = {
  marchaPadrao: 'padrao',
  marchas: { aaa: ['**/auth/**'], padrao: ['src/**'], rapida: ['**/*.md'] },
  agentes: { escada: ['busca-rapida', 'tarefas-simples', 'desenvolvedor', 'arquiteto', 'especialista'] }
};

test('custo: escada vai do mais barato ao mais caro', () => {
  assert.ok(custo.nivelDoAgente('busca-rapida', PROJETO) < custo.nivelDoAgente('especialista', PROJETO));
});

test('custo: agente fora da escada tem nivel 0 e nunca e barrado', () => {
  assert.strictEqual(custo.nivelDoAgente('inspetor', PROJETO), 0);
  assert.strictEqual(custo.permitido('inspetor', 'rapida', PROJETO).ok, true);
});

test('custo: escopo so de doc tem marcha maxima rapida', () => {
  const esc = { dentro: ['docs/a.md', 'README.md'], fora: [] };
  assert.strictEqual(custo.marchaMaximaDoEscopo(esc, PROJETO), 'rapida');
});

test('custo: escopo com um caminho AAA tem marcha maxima aaa', () => {
  const esc = { dentro: ['docs/a.md', 'src/auth/token.js'], fora: [] };
  assert.strictEqual(custo.marchaMaximaDoEscopo(esc, PROJETO), 'aaa');
});

test('custo: sem escopo declarado, nao ha teto e nada e barrado', () => {
  assert.strictEqual(custo.marchaMaximaDoEscopo(null, PROJETO), 'aaa');
  assert.strictEqual(custo.permitido('especialista', 'aaa', PROJETO).ok, true);
});

test('custo: agente do topo em escopo so de marcha rapida e barrado (F18)', () => {
  const r = custo.permitido('especialista', 'rapida', PROJETO);
  assert.strictEqual(r.ok, false);
  assert.ok(r.motivo.includes('especialista'));
  assert.ok(/^[\x20-\x7E\n]+$/.test(r.motivo), 'motivo tem de ser ASCII (R5)');
});

test('custo: agente barato em escopo de marcha rapida passa', () => {
  assert.strictEqual(custo.permitido('busca-rapida', 'rapida', PROJETO).ok, true);
  assert.strictEqual(custo.permitido('tarefas-simples', 'rapida', PROJETO).ok, true);
});

test('custo: em marcha padrao ou AAA, todos passam - rigor e eixo independente do custo', () => {
  assert.strictEqual(custo.permitido('especialista', 'padrao', PROJETO).ok, true);
  assert.strictEqual(custo.permitido('especialista', 'aaa', PROJETO).ok, true);
});

test('custo: projeto sem escada configurada nao barra ninguem', () => {
  assert.strictEqual(custo.permitido('especialista', 'rapida', { marchas: {} }).ok, true);
});

// Ronda 1 do 8c.5: o portao deixava de opinar abaixo de um `2` cru, e o relatorio de
// cobertura acusa o mesmo limite pelo degraus.MINIMO. Os dois tem de concordar sobre onde
// fica a linha, ou um diz "nao opina" onde o outro opina.
test('custo: o portao passa a opinar exatamente no degraus.MINIMO, o limite que a cobertura acusa', () => {
  const MIN = degraus.MINIMO;
  const projeto = (n) => ({ marchaPadrao: 'padrao', marchas: PROJETO.marchas,
    agentes: { escada: Array.from({ length: n }, (_, i) => 'agente-' + i) } });
  assert.strictEqual(custo.permitido('agente-' + (MIN - 2), 'rapida', projeto(MIN - 1)).ok, true,
    'com ' + (MIN - 1) + ' nome(s) na escada o portao nao opina');
  assert.strictEqual(custo.permitido('agente-' + (MIN - 1), 'rapida', projeto(MIN)).ok, false,
    'com ' + MIN + ' nomes o do topo em marcha rapida e barrado');
});

// Plano 083 (p2-1): o nome do agente e os da escada com aspa ou quebra nao deformam o aviso.
test('083 T6 (p2-1): tipo e nomes da escada com aspa ou quebra saem escapados, numa linha so', () => {
  const r = custo.permitido('ca"ro\nx', 'rapida', { agentes: { escada: ['barato', 'me"dio', 'ca"ro\nx'] } });
  assert.strictEqual(r.ok, false);
  const l = r.motivo.split('\n');
  assert.ok(l.some((x) => x.indexOf('Voce despachou "ca\\"ro x", da metade') === 0), r.motivo);
  assert.ok(l.indexOf('  - "me\\"dio"') !== -1 && l.indexOf('  - "ca\\"ro x"') !== -1, r.motivo);
});

// A12-01 (revisao completa, L2): o `fork` (Claude Code 2.1.302, ligado por padrao) roda no modelo do
// agente principal e nao esta na escada; fora da escada = nivel 0 = o portao liberava o agente caro.
test('A12-01: fork fora da escada conta como o topo - barrado em marcha rapida, livre nas outras', () => {
  const r = custo.permitido('fork', 'rapida', PROJETO);
  assert.strictEqual(r.ok, false, 'fork em escopo so de marcha rapida tinha de ser barrado');
  assert.ok(r.motivo.includes('"fork"') && /modelo do agente principal/.test(r.motivo), r.motivo);
  assert.ok(/^[\x20-\x7E\n]+$/.test(r.motivo), 'motivo tem de ser ASCII (R5)');
  assert.strictEqual(custo.permitido('fork', 'padrao', PROJETO).ok, true);
  assert.strictEqual(custo.permitido('fork', 'rapida', { marchas: {} }).ok, true, 'sem escada o portao nao opina');
  const comFork = { agentes: { escada: ['fork', 'b', 'c', 'd'] } };
  assert.strictEqual(custo.permitido('fork', 'rapida', comFork).ok, true, 'fork posto na escada pelo dono vale onde ele pos');
});

// A2-06 (revisao completa, L2): os contadores do portao-agente rodavam sem try antes da negacao; com o
// estado nao gravavel (SWORN_TMP apontando para um ARQUIVO) o incrementar lancava, `io.blindar`
// liberava e o agente caro passava. Mesmo defeito do D420/SH-02 no portao-estilo.
test('A2-06: estado nao gravavel nao libera o agente caro em marcha rapida', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-a206-'));
  try {
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify({
      marchaPadrao: 'padrao', marchas: { aaa: [], padrao: [], rapida: ['docs/**'] },
      agentes: { escada: ['busca', 'dev', 'arq', 'esp'] } }));
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'escopo.md'), '# Escopo\n**Objetivo:** t\n## Dentro\n- docs/**\n');
    const arquivo = path.join(dir, 'e-um-arquivo');
    fs.writeFileSync(arquivo, 'x');
    const entrada = JSON.stringify({ session_id: 'a206', cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Agent',
      tool_input: { subagent_type: 'esp', prompt: 'p' } });
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'portao-agente.js')], {
      cwd: dir, encoding: 'utf8', input: entrada, env: Object.assign({}, process.env, { SWORN_TMP: arquivo }) });
    assert.ok(/"permissionDecision"\s*:\s*"deny"/.test(r.stdout),
      'tinha de negar com o estado fora do ar; stdout ' + JSON.stringify(r.stdout) + ' stderr ' + r.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
