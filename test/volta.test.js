'use strict';
// Plano 084 (pedido 73, D549, mock D550): aviso antes de gastar ao voltar a chat grande parado. Parado mais de 1 h
// (o cache de 1 h venceu) e contexto de 200 mil ou mais: o gancho de entrada segura a mensagem uma vez por pausa e
// diz quanto custa continuar contra um chat novo. Falha de leitura nunca segura.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const saude = require('../scripts/lib/saude.js');
const volta = require('../scripts/lib/volta.js');
const projeto = require('../scripts/lib/projeto.js');
const estado = require('../scripts/lib/estado.js');

const RAIZ = path.join(__dirname, '..');
const MIN = 60 * 1000;
const AGORA = Date.parse('2026-10-17T12:00:00.000Z');

function transcript(linhas) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-volta-'));
  const f = path.join(dir, 's.jsonl');
  fs.writeFileSync(f, linhas.map(function (l) { return typeof l === 'string' ? l : JSON.stringify(l); }).join('\n') + '\n');
  return { dir: dir, f: f, fim: function () { fs.rmSync(dir, { recursive: true, force: true }); } };
}
function chamada(quando, modelo, contexto, extra) {
  return Object.assign({ type: 'assistant', timestamp: new Date(quando).toISOString(),
    message: { model: modelo, usage: { input_tokens: 10, cache_read_input_tokens: contexto - 10,
      cache_creation_input_tokens: 0, output_tokens: 9 } } }, extra || {});
}

// O texto do mock aprovado da 0.11.0 (prints-0110/mock-0110.html, D588), letra por letra: o resumo gravado ao segurar.
const RESUMO = '.claude/sworn/handoff/2026-10-22-retomar-d731fc49.md';
// A5-25, A5-26 e A5-59 (D735): sem "cache" nem "regrava"; a opcao 2 diz o custo e que a mensagem foi segurada; a 1
// do "Sem resumo" diz onde fica o handoff e como saber se esta em dia.
const MOCK = [
  'sworn - este chat ficou 1 h 16 min parado: continuar aqui fica mais caro, porque a conversa inteira ' +
    '(461 mil tokens) e cobrada de novo.',
  '',
  'Continuar neste chat: cerca de US$ 3,69 (Opus 5.5).',
  'Abrir um chat novo: cerca de US$ 0,55.',
  '',
  'Resumo deste chat gravado em ' + RESUMO + ' (sem gastar nada).',
  '',
  'Faca uma destas:',
  '  1. abra um chat novo e cole:',
  '     Retome o chat d731fc49 pelo resumo ' + RESUMO + ': leia-o antes de qualquer coisa e siga de onde ele parou.',
  '  2. para seguir neste chat (cerca de US$ 3,69), mande a mensagem de novo: o sworn a segurou antes do Claude ' +
    'e nao segura a proxima nesta pausa.',
  '',
  'Desligar neste projeto: "avisoDeVolta": false em .claude/sworn/projeto.json.'
].join('\n');
// Sem resumo (registro torto, disco cheio): a linha diz isso e a opcao 1 volta a ser a da 0.8.4 (mock D550).
const MOCK_SEM_RESUMO = [
  'sworn - este chat ficou 3 h 08 min parado: continuar aqui fica mais caro, porque a conversa inteira ' +
    '(318 mil tokens) e cobrada de novo.',
  '',
  'Continuar neste chat: cerca de US$ 2,54 (Opus 5.5).',
  'Abrir um chat novo: cerca de US$ 0,55.',
  '',
  'Sem resumo: nao consegui montar o resumo deste chat.',
  '',
  'Faca uma destas:',
  '  1. abra um chat novo e cole o prompt do ultimo handoff (o /sworn:handoff grava em ' +
    '.claude/sworn/handoff/), se ele foi gravado depois do seu ultimo pedido;',
  '  2. para seguir neste chat (cerca de US$ 2,54), mande a mensagem de novo: o sworn a segurou antes do Claude ' +
    'e nao segura a proxima nesta pausa.',
  '',
  'Desligar neste projeto: "avisoDeVolta": false em .claude/sworn/projeto.json.'
].join('\n');

test('084: ultimaChamadaDoTranscript da contexto, horario e modelo da ultima chamada da linha principal', () => {
  const t = transcript([chamada(AGORA - 300 * MIN, 'claude-opus-5-5', 1000),
    chamada(AGORA - 200 * MIN, 'claude-fable-5-1', 250000),
    { type: 'user', timestamp: new Date(AGORA - 5 * MIN).toISOString(), message: { content: 'segue' } },
    chamada(AGORA - 100 * MIN, 'claude-haiku-5-5', 5000, { isSidechain: true }), 'linha torta {', '']);
  try {
    assert.deepStrictEqual(saude.ultimaChamadaDoTranscript(t.f),
      { contexto: 250000, horario: AGORA - 200 * MIN, modelo: 'claude-fable-5-1' });
    // o contexto de antes segue igual (D445)
    assert.strictEqual(saude.contextoDoTranscript(t.f), 250000);
  } finally { t.fim(); }
  assert.strictEqual(saude.ultimaChamadaDoTranscript(null), null);
  assert.strictEqual(saude.ultimaChamadaDoTranscript(path.join(os.tmpdir(), 'nao-existe-sworn-volta.jsonl')), null);
  // sem horario legivel ou sem modelo: o campo vem null, o contexto vem
  const s = transcript([{ type: 'assistant', timestamp: 'ontem', message: { usage: { input_tokens: 7 } } }]);
  try {
    assert.deepStrictEqual(saude.ultimaChamadaDoTranscript(s.f), { contexto: 7, horario: null, modelo: null });
  } finally { s.fim(); }
});

test('0.11.0: o aviso do mock aprovado (1 h 16 min, 461 mil, Opus 5.5) com o resumo, letra por letra', () => {
  const r = volta.avaliar({ contexto: 461000, horario: AGORA - 76 * MIN, modelo: 'claude-opus-5-5' }, AGORA);
  assert.ok(r, 'tinha de avisar');
  assert.strictEqual(volta.motivo(r, { caminho: RESUMO, chat: 'd731fc49', handoff: null }), MOCK);
  assert.strictEqual(r.marca, AGORA - 76 * MIN, 'a marca da pausa e o horario da ultima chamada');
});

test('0.11.0: sem resumo, o aviso diz isso e a opcao 1 e a de antes, letra por letra', () => {
  const r = volta.avaliar({ contexto: 318000, horario: AGORA - 188 * MIN, modelo: 'claude-opus-5-5' }, AGORA);
  assert.strictEqual(volta.motivo(r, null), MOCK_SEM_RESUMO);
  assert.strictEqual(volta.motivo(r), MOCK_SEM_RESUMO);
  // A5-25: modelo fora da tabela de precos nao tem valor; a opcao 2 diz o que encarece
  const semPreco = volta.avaliar({ contexto: 318000, horario: AGORA - 188 * MIN, modelo: 'claude-nada-9' }, AGORA);
  const opcao2 = '  2. para seguir neste chat (a conversa inteira e cobrada outra vez), mande a mensagem de novo: ' +
    'o sworn a segurou antes do Claude e nao segura a proxima nesta pausa.';
  assert.ok(volta.motivo(semPreco).split('\n').indexOf(opcao2) !== -1, volta.motivo(semPreco));
});

test('0.11.0: handoff do modelo em dia - a opcao 1 aponta o handoff e o resumo; atrasado ou fora de ASCII, so o resumo', () => {
  const r = volta.avaliar({ contexto: 461000, horario: AGORA - 76 * MIN, modelo: 'claude-opus-5-5' }, AGORA);
  const h = '.context/plans/2026-10-22-frente-handoff.md';
  const emDia = volta.motivo(r, { caminho: RESUMO, chat: 'd731fc49', handoff: { caminho: h, emDia: true } });
  assert.ok(emDia.split('\n').indexOf('     Retome o chat d731fc49 pelo handoff ' + h + ' e pelo resumo ' + RESUMO +
    ': leia os dois antes de qualquer coisa e siga de onde ele parou.') !== -1, emDia);
  const atrasado = volta.motivo(r, { caminho: RESUMO, chat: 'd731fc49', handoff: { caminho: h, emDia: false } });
  assert.strictEqual(atrasado, MOCK);
  const acento = volta.motivo(r, { caminho: RESUMO, chat: 'd731fc49', handoff: { caminho: 'pasta/ação-handoff.md', emDia: true } });
  assert.strictEqual(acento, MOCK, 'caminho fora de ASCII nao entra no aviso (D532); o resumo o cita');
  // 0.11.1 (P2 da revisao da 0.11.0): sem caminho, o teste ASCII via "undefined" e o aviso dizia "pelo handoff undefined"
  for (const torto of [undefined, null, 42]) {
    const sem = volta.motivo(r, { caminho: RESUMO, chat: 'd731fc49', handoff: { caminho: torto, emDia: true } });
    assert.strictEqual(sem, MOCK, 'caminho ' + String(torto) + ' nao entra no aviso');
  }
});

test('084: a conta - continuar = contexto x escrita de 1 h; chat novo = 68.723 x escrita de 1 h', () => {
  const r = volta.avaliar({ contexto: 400000, horario: AGORA - 61 * MIN, modelo: 'claude-fable-5-1' }, AGORA);
  assert.ok(Math.abs(r.continuar - 400000 * 20 / 1e6) < 1e-9, 'Fable 5.1: escrita de 1 h US$ 20/M');
  assert.ok(Math.abs(r.novo - 68723 * 20 / 1e6) < 1e-9);
  assert.strictEqual(volta.RECOMECO, 68723, 'mediana da 1a chamada de chat novo (D547)');
  assert.match(volta.motivo(r),
    /^sworn - este chat ficou 1 h 01 min parado: .* \(400 mil tokens\) e cobrada de novo\.$/m);
  assert.match(volta.motivo(r), /cerca de US\$ 8,00 \(Fable 5\.1\)\./);
});

test('084: quando NAO avisa - ate 1 h parado, menos de 200 mil, leitura que falta', () => {
  const ok = { contexto: 200000, horario: AGORA - 61 * MIN, modelo: 'claude-opus-5-5' };
  assert.ok(volta.avaliar(ok, AGORA), 'controle: 200 mil e 61 min avisa');
  assert.strictEqual(volta.avaliar(Object.assign({}, ok, { horario: AGORA - 60 * MIN }), AGORA), null, '60 min exatos: o cache dura');
  assert.strictEqual(volta.avaliar(Object.assign({}, ok, { contexto: 199999 }), AGORA), null, 'abaixo de 200 mil');
  assert.strictEqual(volta.avaliar(Object.assign({}, ok, { horario: null }), AGORA), null, 'sem horario');
  assert.strictEqual(volta.avaliar(Object.assign({}, ok, { horario: AGORA + 90 * MIN }), AGORA), null, 'relogio no futuro');
  assert.strictEqual(volta.avaliar(null, AGORA), null, 'sem leitura');
});

test('084: uma vez por pausa - a mesma marca nao avisa de novo; pausa nova avisa', () => {
  const c = { contexto: 300000, horario: AGORA - 90 * MIN, modelo: 'claude-opus-5-5' };
  const r = volta.avaliar(c, AGORA);
  assert.strictEqual(volta.avaliar(c, AGORA, r.marca), null, 'mesma pausa: passa');
  assert.ok(volta.avaliar(c, AGORA, r.marca - MIN), 'outra pausa: avisa');
});

test('084: modelo sem preco avisa sem o valor em dolar', () => {
  // 'constructor' e 'toString' sao nomes herdados do objeto da tabela: nao sao preco (ronda 1, borda)
  for (const modelo of ['claude-novo-9', null, 'constructor', 'toString']) {
    const r = volta.avaliar({ contexto: 250000, horario: AGORA - 120 * MIN, modelo: modelo }, AGORA);
    assert.ok(r, String(modelo) + ': tinha de avisar');
    const t = volta.motivo(r);
    assert.ok(!/US\$ \d/.test(t), 'sem valor em dolar: ' + t);
    assert.match(t, /^sworn - este chat ficou 2 h 00 min parado: .* \(250 mil tokens\) e cobrada de novo\.$/m);
    assert.match(t, /sem o valor em US\$|sem preco/i);
  }
});

test('084: chave avisoDeVolta - liga/desliga do projeto.json, ligada por padrao, so false desliga', () => {
  assert.ok(projeto.CHAVES_LIGA_DESLIGA.indexOf('avisoDeVolta') !== -1);
  assert.strictEqual(volta.ligada(null), true);
  assert.strictEqual(volta.ligada({}), true);
  assert.strictEqual(volta.ligada({ avisoDeVolta: 'false' }), true, 'texto nao desliga (D388)');
  assert.strictEqual(volta.ligada({ avisoDeVolta: false }), false);
  assert.ok(estado.CAMPOS_DA_SESSAO.indexOf('avisouVolta') !== -1, 'a marca da pausa sobrevive ao fecho');
});

// Tarefa 3: o gancho de entrada (abrir-turno.js) de ponta a ponta.
function abrir(dir, sessoes, id, transcriptPath, prompt) {
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'abrir-turno.js')], {
    cwd: dir, encoding: 'utf8',
    input: JSON.stringify({ session_id: id, cwd: dir, hook_event_name: 'UserPromptSubmit', prompt: prompt || 'segue',
      transcript_path: transcriptPath }),
    env: Object.assign({}, process.env, { SWORN_TMP: sessoes })
  });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

// D587: a forma curta - para o turno com `continue: false` e o aviso em `stopReason` (sem "Original prompt").
function parou(saida) { return !!(saida && saida.continue === false); }

test('0.11.0: abrir-turno para a 1a mensagem da pausa na forma curta e deixa passar a 2a', () => {
  const agora = Date.now();
  const t = transcript([chamada(agora - 188 * MIN, 'claude-opus-5-5', 318000)]);
  const sessoes = path.join(t.dir, 'sessoes');
  try {
    const um = abrir(t.dir, sessoes, 'v1', t.f);
    assert.ok(parou(um), 'a 1a mensagem tinha de parar: ' + JSON.stringify(um));
    assert.strictEqual(um.decision, undefined, 'a forma curta nao usa decision: block');
    assert.match(um.stopReason, /^sworn - este chat ficou 3 h 0[78] min parado/);
    assert.match(um.stopReason, /Desligar neste projeto: "avisoDeVolta": false/);
    // o registro so tem a chamada, sem pedido do dono: sem resumo, e o aviso diz isso
    assert.match(um.stopReason, /^Sem resumo: nao consegui montar o resumo deste chat\.$/m);
    assert.strictEqual(fs.existsSync(path.join(t.dir, '.claude', 'sworn', 'handoff')), false);
    const dois = abrir(t.dir, sessoes, 'v1', t.f);
    assert.ok(!parou(dois), 'a 2a mensagem tinha de passar: ' + JSON.stringify(dois));
  } finally { t.fim(); }
});

test('0.11.0: abrir-turno grava o resumo antes de parar e o aviso traz o prompt do chat novo', () => {
  const agora = Date.now();
  const t = transcript([
    { type: 'user', timestamp: new Date(agora - 200 * MIN).toISOString(), origin: { kind: 'human' },
      message: { role: 'user', content: 'segue com a T4' } },
    Object.assign(chamada(agora - 190 * MIN, 'claude-opus-5-5', 318000), { message: { model: 'claude-opus-5-5',
      content: [{ type: 'text', text: 'T4 feita.' }], usage: { input_tokens: 10, cache_read_input_tokens: 317990 } } })
  ]);
  const sessoes = path.join(t.dir, 'sessoes');
  try {
    const um = abrir(t.dir, sessoes, 'abcdef12-3456', t.f);
    assert.ok(parou(um), JSON.stringify(um));
    const pasta = path.join(t.dir, '.claude', 'sworn', 'handoff');
    const gravados = fs.readdirSync(pasta);
    assert.strictEqual(gravados.length, 1);
    assert.match(gravados[0], /^\d{4}-\d\d-\d\d-retomar-abcdef12\.md$/);
    const rel = '.claude/sworn/handoff/' + gravados[0];
    assert.ok(um.stopReason.split('\n').indexOf('Resumo deste chat gravado em ' + rel + ' (sem gastar nada).') !== -1, um.stopReason);
    assert.ok(um.stopReason.split('\n').indexOf('     Retome o chat abcdef12 pelo resumo ' + rel +
      ': leia-o antes de qualquer coisa e siga de onde ele parou.') !== -1, um.stopReason);
    const texto = fs.readFileSync(path.join(pasta, gravados[0]), 'utf8');
    assert.ok(texto.indexOf('segue com a T4') !== -1 && texto.indexOf('T4 feita.') !== -1, texto);
  } finally { t.fim(); }
});

// Ronda 1 da 0.11.0 (correcao, P1): o require do retomar.js que lanca (arquivo ausente, erro de sintaxe) zerava o aviso
// depois de a marca da pausa ja estar gravada - a pausa passava calada e o aviso nao voltava. Resumo que falha nao
// impede o aviso (abrir-turno.js, comentario da D586): sai com "Sem resumo".
test('0.11.0: retomar.js que lanca no require nao cala o aviso - sai sem resumo', () => {
  const agora = Date.now();
  const t = transcript([chamada(agora - 188 * MIN, 'claude-opus-5-5', 318000)]);
  const copia = path.join(t.dir, 'plugin');
  fs.cpSync(path.join(RAIZ, 'scripts'), path.join(copia, 'scripts'), { recursive: true });
  fs.cpSync(path.join(RAIZ, 'modelos'), path.join(copia, 'modelos'), { recursive: true });
  fs.writeFileSync(path.join(copia, 'scripts', 'lib', 'retomar.js'), "throw new Error('retomar quebrado');\n");
  const sessoes = path.join(t.dir, 'sessoes');
  try {
    const r = spawnSync(process.execPath, [path.join(copia, 'scripts', 'abrir-turno.js')], {
      cwd: t.dir, encoding: 'utf8',
      input: JSON.stringify({ session_id: 'q1', cwd: t.dir, hook_event_name: 'UserPromptSubmit', prompt: 'segue',
        transcript_path: t.f }),
      env: Object.assign({}, process.env, { SWORN_TMP: sessoes })
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const um = r.stdout.trim() ? JSON.parse(r.stdout) : null;
    assert.ok(parou(um), 'a 1a mensagem da pausa tinha de parar mesmo sem o retomar.js: ' + JSON.stringify(um));
    assert.match(um.stopReason, /^Sem resumo: nao consegui montar o resumo deste chat\.$/m);
  } finally { t.fim(); }
});

// 0.11.1 (P2 da revisao da 0.11.0): o volta.motivo ficava fora do try interno - resumo torto que o fizesse lancar
// zerava o aviso no try de fora, com a marca da pausa ja gravada. Agora sai sem resumo, como o require que lanca.
test('0.11.1: resumo torto que faz o motivo lancar nao cala o aviso - sai sem resumo', () => {
  const agora = Date.now();
  const t = transcript([chamada(agora - 188 * MIN, 'claude-opus-5-5', 318000)]);
  const copia = path.join(t.dir, 'plugin');
  fs.cpSync(path.join(RAIZ, 'scripts'), path.join(copia, 'scripts'), { recursive: true });
  fs.cpSync(path.join(RAIZ, 'modelos'), path.join(copia, 'modelos'), { recursive: true });
  fs.writeFileSync(path.join(copia, 'scripts', 'lib', 'retomar.js'),
    "exports.resumir = function () { return { caminho: 'x.md', chat: 'q2', get handoff() { throw new Error('torto'); } }; };\n");
  const sessoes = path.join(t.dir, 'sessoes');
  try {
    const r = spawnSync(process.execPath, [path.join(copia, 'scripts', 'abrir-turno.js')], {
      cwd: t.dir, encoding: 'utf8',
      input: JSON.stringify({ session_id: 'q2', cwd: t.dir, hook_event_name: 'UserPromptSubmit', prompt: 'segue',
        transcript_path: t.f }),
      env: Object.assign({}, process.env, { SWORN_TMP: sessoes })
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const um = r.stdout.trim() ? JSON.parse(r.stdout) : null;
    assert.ok(parou(um), 'a 1a mensagem da pausa tinha de parar com o resumo torto: ' + JSON.stringify(um));
    assert.match(um.stopReason, /^Sem resumo: nao consegui montar o resumo deste chat\.$/m);
  } finally { t.fim(); }
});

test('084 Tarefa 3: abrir-turno nao segura - chave desligada, chat pequeno, transcript ausente', () => {
  const agora = Date.now();
  const t = transcript([chamada(agora - 188 * MIN, 'claude-opus-5-5', 318000)]);
  const p = transcript([chamada(agora - 188 * MIN, 'claude-opus-5-5', 50000)]);
  const sessoes = path.join(t.dir, 'sessoes');
  try {
    // controle positivo na mesma pasta antes de desligar
    assert.ok(parou(abrir(t.dir, sessoes, 'c0', t.f)));
    fs.mkdirSync(path.join(t.dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(t.dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify({ avisoDeVolta: false }));
    const off = abrir(t.dir, sessoes, 'c1', t.f);
    assert.ok(!parou(off), 'desligado: ' + JSON.stringify(off));
    const peq = abrir(p.dir, sessoes, 'c2', p.f);
    assert.ok(!parou(peq), 'chat pequeno: ' + JSON.stringify(peq));
    const sem = abrir(p.dir, sessoes, 'c3', path.join(p.dir, 'nao-existe.jsonl'));
    assert.ok(!parou(sem), 'sem transcript: ' + JSON.stringify(sem));
  } finally { t.fim(); p.fim(); }
});
