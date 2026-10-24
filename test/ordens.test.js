'use strict';
// Plano 091, Tarefa 3 (D556, D559): as ordens da abertura que fazem um comando acontecer sozinho. Os textos sao os do
// mock aprovado (prints-091/mock-091.png); o numero de conversas e o limiar padrao vem do caso.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ordens = require('../scripts/lib/ordens.js');

const AGORA = Date.parse('2026-10-18T12:00:00Z');
const DIA = 24 * 60 * 60 * 1000;

function temp(nome) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-ordens-' + nome + '-'));
  fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
  return dir;
}
const conversas = function (n) { return function () { return n; }; };
const MARCA = path.join('.claude', 'sworn', 'calibrar-ordem.json');

function ordemDoMock(n, padrao) {
  return [
    'sworn: ja ha ' + n + ' conversas salvas neste projeto e o limiar de troca de chat',
    'nunca foi calibrado (vale o padrao, ' + padrao + ' tokens).',
    'Faca no seu primeiro turno, depois de atender o pedido:',
    '1. Rode /sworn:calibrate (so mede; nao grava).',
    '2. Mostre o limiar sugerido e pergunte pelo AskUserQuestion, em 3 opcoes:',
    '   gravar o sugerido (recomendada), manter o padrao, perguntar de novo em 30 dias.',
    'So grave com o sim.'
  ].join('\n');
}

test('ordens #4: 30+ conversas e nunca calibrado -> o texto do mock, com o padrao do modo continuo quando ligado', () => {
  const dir = temp('cal');
  try {
    const t = ordens.ordemDoCalibrar(dir, { modoContinuo: true }, { agora: AGORA, contarConversas: conversas(41) });
    assert.strictEqual(t, ordemDoMock(41, '250 mil'));
    assert.ok(/^[\x20-\x7E\n]+$/.test(t), 'tem de ser ASCII: ' + JSON.stringify(t));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ordens #4: sem o modo continuo, o padrao e o do saude.js (175 mil)', () => {
  const dir = temp('cal-sem');
  try {
    assert.strictEqual(ordens.ordemDoCalibrar(dir, { modoContinuo: false }, { agora: AGORA, contarConversas: conversas(30) }),
      ordemDoMock(30, '175 mil'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ordens #4: calada com limiar gravado, com menos de 30 conversas, sem projeto e sem cwd', () => {
  const dir = temp('cal-calada');
  try {
    const o = { agora: AGORA, contarConversas: conversas(99) };
    assert.strictEqual(ordens.ordemDoCalibrar(dir, { limiares: { tokensDeContexto: 250000 } }, o), '');
    assert.strictEqual(ordens.ordemDoCalibrar(dir, {}, { agora: AGORA, contarConversas: conversas(29) }), '');
    assert.strictEqual(ordens.ordemDoCalibrar(dir, null, o), '');
    assert.strictEqual(ordens.ordemDoCalibrar('', {}, o), '');
    assert.ok(!fs.existsSync(path.join(dir, MARCA)), 'calada nao grava marca');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ordens #4: sai uma vez a cada 30 dias (a marca); marca ilegivel ou no futuro conta como vencida', () => {
  const dir = temp('cal-marca');
  try {
    const o = { agora: AGORA, contarConversas: conversas(41) };
    assert.notStrictEqual(ordens.ordemDoCalibrar(dir, {}, o), '');
    assert.ok(fs.existsSync(path.join(dir, MARCA)), 'nao gravou a marca');
    assert.strictEqual(ordens.ordemDoCalibrar(dir, {}, o), '', 'repetiu dentro do prazo');
    assert.strictEqual(ordens.ordemDoCalibrar(dir, {}, { agora: AGORA + 29 * DIA, contarConversas: conversas(41) }), '');
    assert.notStrictEqual(ordens.ordemDoCalibrar(dir, {}, { agora: AGORA + 30 * DIA, contarConversas: conversas(41) }), '');
    fs.writeFileSync(path.join(dir, MARCA), '{torto');
    assert.notStrictEqual(ordens.ordemDoCalibrar(dir, {}, o), '', 'marca ilegivel calou');
    fs.writeFileSync(path.join(dir, MARCA), JSON.stringify({ ultima: new Date(AGORA + 5 * DIA).toISOString() }));
    assert.notStrictEqual(ordens.ordemDoCalibrar(dir, {}, o), '', 'marca no futuro calou');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// #7: o texto do mock, mais a linha de como gravar o "nunca" (o mock dizia so "fica gravado fora do projeto").
function ordemDoInitMock(comando) {
  return [
    'sworn: este projeto ainda nao tem o sworn configurado',
    '(.claude/sworn/projeto.json). Sem ele, os portoes de escopo e de',
    'intocaveis ficam desligados.',
    'No seu primeiro turno, antes de editar qualquer arquivo, pergunte pelo',
    'AskUserQuestion, em 3 opcoes: configurar agora com /sworn:init',
    '(recomendada; 6 perguntas), depois (pergunto na proxima sessao), nunca',
    'neste projeto. Com "agora", rode o /sworn:init na mesma resposta.',
    'Com "nunca", rode: ' + comando
  ].join('\n');
}

function semProjeto(nome) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-ordens-' + nome + '-'));
}

test('ordens #7: sem projeto.json -> o texto do mock, com o comando do "nunca"', () => {
  const dir = semProjeto('init');
  const cfg = semProjeto('init-cfg');
  try {
    const t = ordens.ordemDoInit(dir, null, { env: { CLAUDE_CONFIG_DIR: cfg }, comandoNunca: 'node "x/recusar-init.js" "' + dir + '"' });
    assert.strictEqual(t, ordemDoInitMock('node "x/recusar-init.js" "' + dir + '"'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(cfg, { recursive: true, force: true }); }
});

test('ordens #7: sem comandoNunca, a ordem nao manda rodar "undefined" (revisao cega 0.9.0, ronda 1)', () => {
  const dir = semProjeto('init-sc');
  const cfg = semProjeto('init-sc-cfg');
  try {
    for (const o of [{ env: { CLAUDE_CONFIG_DIR: cfg } }, { env: { CLAUDE_CONFIG_DIR: cfg }, comandoNunca: '' }]) {
      const t = ordens.ordemDoInit(dir, null, o);
      assert.ok(t.includes('Com "nunca", rode: node <plugin>/scripts/recusar-init.js'), t);
      assert.ok(!/undefined/.test(t), t);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(cfg, { recursive: true, force: true }); }
});

test('ordens #7: calada com projeto carregado, com projeto.json presente e ilegivel, e com o "nunca" gravado', () => {
  const dir = semProjeto('init-c');
  const cfg = semProjeto('init-c-cfg');
  const o = { env: { CLAUDE_CONFIG_DIR: cfg }, comandoNunca: 'x' };
  try {
    assert.strictEqual(ordens.ordemDoInit(dir, {}, o), '');
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), '{torto');
    assert.strictEqual(ordens.ordemDoInit(dir, null, o), '', 'ilegivel tem aviso proprio');
    fs.rmSync(path.join(dir, '.claude'), { recursive: true, force: true });
    assert.notStrictEqual(ordens.ordemDoInit(dir, null, o), '', 'controle: sem nada, fala');
    assert.strictEqual(ordens.recusarInit(dir.toUpperCase(), { CLAUDE_CONFIG_DIR: cfg }), true);
    assert.strictEqual(ordens.ordemDoInit(dir, null, o), '', 'o "nunca" (sem diferenciar maiuscula) nao calou');
    assert.strictEqual(ordens.recusarInit(dir, { CLAUDE_CONFIG_DIR: cfg }), true, 'gravar de novo e inofensivo');
    const lista = JSON.parse(fs.readFileSync(path.join(cfg, 'sworn', ordens.ARQUIVO_INIT_RECUSADO), 'utf8')).raizes;
    assert.strictEqual(lista.length, 1, 'duplicou: ' + JSON.stringify(lista));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(cfg, { recursive: true, force: true }); }
});

test('ordens #7: lista de recusa ilegivel nao cala nem derruba', () => {
  const dir = semProjeto('init-i');
  const cfg = semProjeto('init-i-cfg');
  try {
    fs.mkdirSync(path.join(cfg, 'sworn'));
    fs.writeFileSync(path.join(cfg, 'sworn', ordens.ARQUIVO_INIT_RECUSADO), '{torto');
    assert.notStrictEqual(ordens.ordemDoInit(dir, null, { env: { CLAUDE_CONFIG_DIR: cfg }, comandoNunca: 'x' }), '');
    assert.strictEqual(ordens.ordemDoInit('', null, { env: { CLAUDE_CONFIG_DIR: cfg }, comandoNunca: 'x' }), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(cfg, { recursive: true, force: true }); }
});

test('ordens #4: contar que lanca nao derruba: devolve vazio', () => {
  const dir = temp('cal-lanca');
  try {
    assert.strictEqual(ordens.ordemDoCalibrar(dir, {}, { agora: AGORA, contarConversas: function () { throw new Error('x'); } }), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Plano 091, Tarefa 6 (mock D559, secao 5): cada ordem conta "dada", "cumprida" (a skill pedida rodou depois, na
// mesma sessao) e "recusada pelo dono" nos contadores do turno, que o fecho descarrega em contadores.json.
test('091 T6: os tipos de ordem e a chave do contador', () => {
  assert.deepStrictEqual(ordens.TIPOS_DE_ORDEM, ['aprender', 'auditar', 'calibrar', 'init', 'revisar', 'manual']);
  assert.strictEqual(ordens.chaveDaOrdem('revisar', 'dada'), 'ordem_revisar_dada');
});

test('091 T6: dada conta uma vez por pendencia; cumprida so pela skill certa; recusada so com ordem pendente', () => {
  const s = {};
  ordens.marcarDada(s, 'revisar');
  ordens.marcarDada(s, 'revisar'); // o commit negado de novo: a mesma ordem
  assert.deepStrictEqual(s.ordensPendentes, ['revisar']);
  assert.strictEqual(s.contadores.ordem_revisar_dada, 1);
  ordens.marcarCumprida(s, 'sworn:audit');
  assert.strictEqual(s.contadores.ordem_revisar_cumprida, undefined, 'outra skill cumpriu');
  ordens.marcarCumprida(s, 'sworn:review');
  assert.strictEqual(s.contadores.ordem_revisar_cumprida, 1);
  assert.deepStrictEqual(s.ordensPendentes, []);
  ordens.marcarCumprida(s, 'sworn:review');
  assert.strictEqual(s.contadores.ordem_revisar_cumprida, 1, 'cumpriu sem ordem pendente');
  ordens.marcarDada(s, 'revisar');
  assert.strictEqual(s.contadores.ordem_revisar_dada, 2, 'ordem nova depois de cumprida nao contou');
  ordens.marcarRecusada(s, 'revisar');
  assert.strictEqual(s.contadores.ordem_revisar_recusada, 1);
  assert.deepStrictEqual(s.ordensPendentes, []);
  ordens.marcarRecusada(s, 'revisar');
  assert.strictEqual(s.contadores.ordem_revisar_recusada, 1, 'recusou sem ordem pendente');
});

test('091 T6: o manual cumpre com skill de "padrao" no nome; as outras pelo nome, com ou sem o prefixo do plugin', () => {
  const s = { contadores: { fecho_sem_evidencia: 2 } };
  for (const t of ['manual', 'aprender', 'auditar', 'calibrar', 'init']) ordens.marcarDada(s, t);
  ordens.marcarCumprida(s, 'padrao-aaa');
  ordens.marcarCumprida(s, 'aprender');
  ordens.marcarCumprida(s, 'sworn:calibrate');
  ordens.marcarCumprida(s, 'outro:init');
  ordens.marcarCumprida(s, 'sworn:auditar-x');
  assert.deepStrictEqual(s.ordensPendentes.slice().sort(), ['auditar', 'init']);
  assert.deepStrictEqual(s.contadores, { fecho_sem_evidencia: 2, ordem_manual_dada: 1, ordem_aprender_dada: 1,
    ordem_auditar_dada: 1, ordem_calibrar_dada: 1, ordem_init_dada: 1, ordem_manual_cumprida: 1,
    ordem_aprender_cumprida: 1, ordem_calibrar_cumprida: 1 });
});

test('091 T6: estado torto nao lanca; tipo desconhecido nao conta', () => {
  for (const s of [null, undefined, 'x', 3]) {
    assert.doesNotThrow(function () { ordens.marcarDada(s, 'revisar'); ordens.marcarCumprida(s, 'sworn:review'); });
  }
  const s = { contadores: 'x', ordensPendentes: 'y' };
  ordens.marcarDada(s, 'revisar');
  assert.deepStrictEqual(s.ordensPendentes, ['revisar']);
  assert.deepStrictEqual(s.contadores, { ordem_revisar_dada: 1 });
  ordens.marcarDada(s, 'paralelo');
  ordens.marcarCumprida(s, 42);
  assert.deepStrictEqual(s.contadores, { ordem_revisar_dada: 1 });
});

const NOTA = '  (-: o sworn nao ve essa recusa; dada e nao cumprida foi ignorada ou recusada na conversa)';

test('091 T6: as linhas da auditoria - diferenca contra a foto anterior, os nunca disparados e a nota do "-"', () => {
  const antes = { ordem_aprender_dada: 1, ordem_aprender_cumprida: 1 };
  const agora = { ordem_aprender_dada: 5, ordem_aprender_cumprida: 4, ordem_revisar_dada: 6, ordem_revisar_cumprida: 5,
    ordem_revisar_recusada: 1, ordem_manual_dada: 2, ordem_manual_cumprida: 2, fecho_sem_evidencia: 9 };
  assert.deepStrictEqual(ordens.linhasDasOrdens(antes, agora, 7), [
    '- ordens dos ultimos 7 dias (dadas / cumpridas / recusadas pelo dono):',
    '  aprender 4/3/-; revisar antes do commit 6/5/1; manual 2/2/-',
    '  nunca disparadas: auditar, calibrar, init',
    NOTA
  ]);
  // so o revisar mede a recusa: sem "-", sem a nota
  assert.deepStrictEqual(ordens.linhasDasOrdens({}, { ordem_revisar_dada: 1, ordem_revisar_recusada: 1 }, 1), [
    '- ordens do ultimo dia (dadas / cumpridas / recusadas pelo dono):',
    '  revisar antes do commit 1/0/1',
    '  nunca disparadas: aprender, auditar, calibrar, init, manual'
  ]);
  // sem foto anterior (primeira auditoria): desde o comeco
  assert.strictEqual(ordens.linhasDasOrdens(null, agora, null)[0],
    '- ordens desde o comeco (dadas / cumpridas / recusadas pelo dono):');
  // nada disparado na janela: silencio
  assert.deepStrictEqual(ordens.linhasDasOrdens(agora, agora, 7), []);
  assert.deepStrictEqual(ordens.linhasDasOrdens(null, {}, null), []);
  // contador menor que a foto (contadores.json recomecado): vale o atual inteiro
  assert.strictEqual(ordens.linhasDasOrdens({ ordem_aprender_dada: 9 }, { ordem_aprender_dada: 2 }, 7)[1], '  aprender 2/0/-');
  // valor torto conta zero
  assert.deepStrictEqual(ordens.linhasDasOrdens('x', { ordem_aprender_dada: 'muito' }, 7), []);
});

test('091 T6: totaisDasOrdens le so as chaves de ordem do contadores.json; ausente ou torto = {}', () => {
  const dir = temp('totais');
  try {
    assert.deepStrictEqual(ordens.totaisDasOrdens(dir), {});
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'contadores.json'),
      JSON.stringify({ ordem_aprender_dada: 3, ordem_x: 'a', fecho_sem_evidencia: 2, ordem_revisar_recusada: 1 }));
    assert.deepStrictEqual(ordens.totaisDasOrdens(dir), { ordem_aprender_dada: 3, ordem_revisar_recusada: 1 });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'contadores.json'), '[1,2]');
    assert.deepStrictEqual(ordens.totaisDasOrdens(dir), {});
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
