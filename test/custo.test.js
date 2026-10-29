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

// D678 T2: o que a chamada passa vence o frontmatter do agente (sonda d2/run8); a tabela dos degraus so vale se o
// portao ler a chamada. Campo que a chamada nao traz e "nao sei" (binario velho sem effort; o arquivo decide): passa.
const COM_DEGRAUS = { agentes: { degraus: [
  { agente: 'busca-rapida', apelido: 'haiku', esforco: 'low' },
  { agente: 'desenvolvedor', apelido: 'sonnet', esforco: 'medium' },
  { agente: 'arquiteto', apelido: 'opus' }
] } };

test('D678 T2: degrau chamado com model ou effort fora da tabela e negado, com a chamada certa escrita', () => {
  const r = custo.chamadaDaTabela('desenvolvedor', { model: 'opus', effort: 'medium' }, COM_DEGRAUS);
  assert.strictEqual(r.ok, false, 'model fora da tabela nega');
  assert.ok(r.motivo.includes('Voce chamou "desenvolvedor" com model "opus",'), r.motivo);
  assert.ok(r.motivo.includes('(agentes.degraus no projeto.json) diz model "sonnet" e effort "medium".'), r.motivo);
  assert.ok(r.motivo.includes('Agent({ subagent_type: "desenvolvedor", model: "sonnet", effort: "medium", ... })'), r.motivo);
  assert.ok(r.motivo.includes('chame o de cima da escada: "arquiteto"'), r.motivo);
  assert.ok(/^[\x20-\x7E\n]+$/.test(r.motivo), 'motivo tem de ser ASCII (R5)');
  const so = custo.chamadaDaTabela('desenvolvedor', { model: 'sonnet', effort: 'high' }, COM_DEGRAUS);
  assert.strictEqual(so.ok, false, 'so o effort fora da tabela tambem nega');
  assert.ok(so.motivo.includes('com effort "high",'), so.motivo);
  const ambos = custo.chamadaDaTabela('busca-rapida', { model: 'opus', effort: 'max' }, COM_DEGRAUS);
  assert.strictEqual(ambos.ok, false, 'os dois campos fora da tabela negam');
  assert.ok(ambos.motivo.includes('com model "opus" e effort "max",'), ambos.motivo);
});

test('D678 T2: chamada como a tabela, sem os campos, fora dos degraus ou sem o campo gravado passa', () => {
  const ok = (tipo, entrada, projeto) => custo.chamadaDaTabela(tipo, entrada, projeto || COM_DEGRAUS).ok;
  assert.ok(ok('desenvolvedor', { model: 'sonnet', effort: 'medium' }));
  assert.ok(ok('desenvolvedor', {}), 'sem os campos o arquivo do agente decide');
  assert.ok(ok('desenvolvedor', { effort: 'medium' }), 'sem model: nao sei');
  assert.ok(ok('desenvolvedor', { model: 'sonnet' }), 'sem effort: binario velho');
  assert.ok(ok('desenvolvedor', { model: '', effort: null }), 'campo vazio ou null tambem e nao sei');
  // D693 (fila do pedido 12): a entrada inteira ausente tambem e "nao sei", e nao lanca.
  assert.ok(ok('desenvolvedor', null), 'entrada null passa');
  assert.ok(ok('desenvolvedor', undefined), 'entrada undefined passa');
  assert.ok(ok('arquiteto', { model: 'opus', effort: 'max' }), 'degrau sem esforco gravado nao compara o effort');
  assert.ok(ok('a', { model: 'opus' }, { agentes: { degraus: ['a', 'b'] } }), 'degrau sem apelido nao compara o model');
  assert.ok(ok('sworn:inspector', { model: 'opus' }), 'fora dos degraus o portao nao opina');
  assert.ok(ok('fork', { model: 'opus' }));
  assert.ok(ok('desenvolvedor', { model: 'opus' }, { marchas: {} }), 'sem degraus o portao nao opina');
});

test('D678 T2: no topo da escada nao ha degrau de cima; valor com aspa ou quebra sai escapado numa linha', () => {
  const r = custo.chamadaDaTabela('arquiteto', { model: 'son"net\nx' }, COM_DEGRAUS);
  assert.strictEqual(r.ok, false, 'o topo da escada tambem nega o model fora da tabela');
  assert.ok(!/de cima da escada/.test(r.motivo), r.motivo);
  assert.ok(r.motivo.includes('\n  2. se a tabela esta errada'), 'sem o degrau de cima a opcao da tabela e a 2: ' + r.motivo);
  assert.ok(r.motivo.split('\n').indexOf('Voce chamou "arquiteto" com model "son\\"net x",') !== -1, r.motivo);
});

// R1 da revisao da T2 (estados, borda): o String() cru lancava TypeError com {"toString": 1} no model, e o
// `io.blindar` do portao liberava a chamada que tinha de negar.
test('D678 T2: valor que nao e texto nao derruba a conferencia; nega com o valor escrito em JSON', () => {
  // D693 (fila do pedido 12): o mesmo no effort, que so o model cobria.
  for (const campo of ['model', 'effort']) {
    for (const v of [{ toString: 1 }, [{ toString: 1 }], { a: 1 }]) {
      const r = custo.chamadaDaTabela('desenvolvedor', { [campo]: v }, COM_DEGRAUS);
      assert.strictEqual(r.ok, false, campo + ' ' + JSON.stringify(v));
      assert.ok(r.motivo.includes('com ' + campo + ' "' + JSON.stringify(v).replace(/"/g, '\\"') + '",'), r.motivo);
    }
  }
});

// A2-48 (P2 do pedido 12): o nome da escada que nao e texto ia cru ao entreAspas; {"toString": 1} lancava e o
// `io.blindar` do portao liberava o agente caro. O validar so avisa: o portao roda com o projeto.json como esta.
test('A2-48: nome da escada que nao e texto nao derruba o portao; sai em JSON na lista', () => {
  const r = custo.permitido('d', 'rapida', { agentes: { escada: ['a', { toString: 1 }, 'c', 'd'] } });
  assert.strictEqual(r.ok, false, 'o do topo em marcha rapida segue barrado');
  assert.ok(r.motivo.split('\n').indexOf('  - "{\\"toString\\":1}"') !== -1, r.motivo);
});

// A2-50/51/52 (P2 do pedido 12): o aviso dizia "escala sozinho" e "a escolha fica visivel" sem dizer como nem onde,
// nao nomeava o arquivo nem a secao do escopo, e a tabela dizia so que a chamada "vence" o arquivo do agente.
test('A2-50/51/52: os avisos dizem como o agente pede o de cima, onde editar o escopo e o efeito da chamada', () => {
  const r = custo.permitido('especialista', 'rapida', PROJETO);
  const sozinho = r.motivo.replace(/\n\s+/g, ' ');
  assert.ok(/ESCALAR/.test(sozinho) && /barra o fim do turno/.test(sozinho), r.motivo);
  assert.ok(sozinho.includes('secao "Dentro" do escopo (.claude/sworn/escopo.md, ou o arquivo da frente em ' +
    '.claude/sworn/escopos/)'), r.motivo);
  assert.ok(!/escala sozinho|fica visivel/.test(r.motivo), r.motivo);
  const t = custo.chamadaDaTabela('desenvolvedor', { model: 'opus' }, COM_DEGRAUS);
  assert.ok(!/vence/.test(t.motivo), t.motivo);
  assert.ok(t.motivo.replace(/\n/g, ' ').includes('model (o modelo) e effort (o esforco)') &&
    /nao com o que a escada grava/.test(t.motivo), t.motivo);
  for (const m of [r.motivo, t.motivo]) {
    for (const l of m.split('\n')) assert.ok(l.length <= 100, 'linha com ' + l.length + ' caracteres: ' + l);
  }
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

// A2 (s193): o mesmo na chamada fora da tabela dos degraus (D678 T2), que nenhum teste cobria: a mutacao que
// tira o try desse contador passava calada.
test('A2 (s193): estado nao gravavel nao libera a chamada fora da tabela dos degraus', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-a2tab-'));
  try {
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify(COM_DEGRAUS));
    const arquivo = path.join(dir, 'e-um-arquivo');
    fs.writeFileSync(arquivo, 'x');
    const entrada = JSON.stringify({ session_id: 'a2tab', cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Agent',
      tool_input: { subagent_type: 'desenvolvedor', model: 'opus', prompt: 'p' } });
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'portao-agente.js')], {
      cwd: dir, encoding: 'utf8', input: entrada, env: Object.assign({}, process.env, { SWORN_TMP: arquivo }) });
    assert.ok(/"permissionDecision"\s*:\s*"deny"/.test(r.stdout) && /fora da tabela/.test(r.stdout),
      'tinha de negar com o estado fora do ar; stdout ' + JSON.stringify(r.stdout) + ' stderr ' + r.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
