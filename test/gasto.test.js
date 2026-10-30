'use strict';
// Pedido 31 (plano dos pedidos 30-32, Tarefa 3; D520): o gasto do mes. Duas fontes: as transcricoes .jsonl do mes
// (estimadas pela tabela de preco do calibracao.js, com subagentes) e a soma real do cost.usd que o mod guarda no
// $.store por sessao. Sessao que tem valor real nao entra na estimativa (contaria duas vezes).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gasto = require('../scripts/lib/gasto.js');

const OUT = Date.UTC(2026, 9, 10, 12); // 10/10/2026: dentro de outubro em qualquer fuso do Brasil
const SET = Date.UTC(2026, 8, 20, 12); // 20/09/2026

function linha(id, model, usage, t, extra) {
  return JSON.stringify(Object.assign({ type: 'assistant', timestamp: new Date(t).toISOString(),
    message: { id: id, model: model, usage: usage } }, extra || {}));
}
// claude-opus-5-5: US$ 4 por milhao de entrada, 20 de saida.
const U = { input_tokens: 1000000, output_tokens: 0 };

test('custoDoTexto: soma por mensagem (id repetido conta uma vez), com subagente, so desde o inicio', () => {
  const texto = [
    linha('a', 'claude-opus-5-5', U, OUT),
    linha('a', 'claude-opus-5-5', U, OUT),
    linha('b', 'claude-opus-5-5', { input_tokens: 0, output_tokens: 1000000 }, OUT, { isSidechain: true }),
    linha('c', 'claude-opus-5-5', U, SET),
    linha('d', 'modelo-sem-preco', U, OUT),
    'linha torta',
    JSON.stringify({ type: 'user', timestamp: new Date(OUT).toISOString(), message: { content: 'oi' } })
  ].join('\n');
  const r = gasto.custoDoTexto(texto, Date.UTC(2026, 9, 1));
  assert.strictEqual(Math.round(r.usd * 100), 2400, JSON.stringify(r));
  assert.strictEqual(r.semPreco, 1);
});

test('inicioDoMes: primeiro dia do mes, meia-noite local, e a chave AAAA-MM', () => {
  const r = gasto.inicioDoMes(new Date(2026, 9, 15, 14, 30).getTime());
  assert.strictEqual(r.chave, '2026-10');
  assert.strictEqual(r.ms, new Date(2026, 9, 1).getTime());
  assert.strictEqual(r.desde, '01/10');
});

function arvore() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-gasto-'));
  const proj = path.join(raiz, 'c--proj');
  fs.mkdirSync(path.join(proj, 's2', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(proj, 's1.jsonl'), linha('m1', 'claude-opus-5-5', U, OUT));
  fs.writeFileSync(path.join(proj, 's2.jsonl'), linha('m2', 'claude-opus-5-5', U, OUT));
  fs.writeFileSync(path.join(proj, 's2', 'subagents', 'agent-x.jsonl'), linha('m3', 'claude-opus-5-5', U, OUT));
  const velho = path.join(proj, 's0.jsonl');
  fs.writeFileSync(velho, linha('m0', 'claude-opus-5-5', U, SET));
  fs.utimesSync(velho, new Date(SET), new Date(SET));
  return raiz;
}

test('estimarMes: todas as pastas de projeto, subagente na sessao dele, arquivo velho fora, sessao excluida fora', () => {
  const raiz = arvore();
  try {
    const mes = { ms: Date.UTC(2026, 9, 1), chave: '2026-10' };
    const tudo = gasto.estimarMes({ raiz: raiz, mes: mes, cache: {}, excluir: [], prazoMs: 5000 });
    assert.strictEqual(Math.round(tudo.usd), 12, JSON.stringify(tudo));
    assert.strictEqual(tudo.pendentes, 0);
    // o de data anterior ao mes nem e lido: fica fora do cache.
    assert.deepStrictEqual(Object.keys(tudo.cache).map(function (k) { return path.basename(k); }).sort(),
      ['agent-x.jsonl', 's1.jsonl', 's2.jsonl']);
    const sem2 = gasto.estimarMes({ raiz: raiz, mes: mes, cache: {}, excluir: ['s2'], prazoMs: 5000 });
    assert.strictEqual(Math.round(sem2.usd), 4, 's2 e o subagente dela saem: ' + JSON.stringify(sem2));
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('arquivosDoProjeto: o agente de workflow (subagents/workflows/<run>/agent-*.jsonl) entra na sessao dele; o journal do run fica fora', () => {
  // A6 (pedido 12, lacuna (a) da sonda da s186): o gasto dos workflows ficava fora da estimativa do mes.
  const raiz = arvore();
  try {
    const proj = path.join(raiz, 'c--proj');
    const run = path.join(proj, 's2', 'subagents', 'workflows', 'wf_1');
    fs.mkdirSync(run, { recursive: true });
    fs.writeFileSync(path.join(run, 'agent-w.jsonl'), linha('m4', 'claude-opus-5-5', U, OUT));
    fs.writeFileSync(path.join(run, 'journal.jsonl'), linha('m5', 'claude-opus-5-5', U, OUT));
    const s2 = gasto.arquivosDoProjeto(proj).filter(function (f) { return f.sessao === 's2'; });
    assert.deepStrictEqual(s2.map(function (f) { return path.basename(f.arquivo); }).sort(), ['agent-w.jsonl', 'agent-x.jsonl', 's2.jsonl']);
    assert.deepStrictEqual(s2.filter(function (f) { return f.subagente; }).map(function (f) { return path.basename(f.arquivo); }).sort(),
      ['agent-w.jsonl', 'agent-x.jsonl'], 'so a conversa principal fica sem a marca de subagente');
    const mes = { ms: Date.UTC(2026, 9, 1), chave: '2026-10' };
    const tudo = gasto.estimarMes({ raiz: raiz, mes: mes, cache: {}, excluir: [], prazoMs: 5000 });
    assert.strictEqual(Math.round(tudo.usd), 16, 'o agente do workflow soma, o journal nao: ' + JSON.stringify(tudo));
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('estimarMes: o cache poupa a releitura; arquivo mudado e relido; prazo estourado deixa pendentes', () => {
  const raiz = arvore();
  try {
    const mes = { ms: Date.UTC(2026, 9, 1), chave: '2026-10' };
    // data inteira (sem fracao de ms): o utimes de depois a repete igual.
    const s1 = path.join(raiz, 'c--proj', 's1.jsonl');
    const data = new Date(OUT);
    fs.utimesSync(s1, data, data);
    const a = gasto.estimarMes({ raiz: raiz, mes: mes, cache: {}, excluir: [], prazoMs: 5000 });
    // cache com valor falso no s1 e o mesmo tamanho/data: vale o do cache (prova que nao releu).
    assert.ok(a.cache[s1], Object.keys(a.cache).join(','));
    const cache = JSON.parse(JSON.stringify(a.cache));
    cache[s1].usd = 100;
    assert.strictEqual(Math.round(gasto.estimarMes({ raiz: raiz, mes: mes, cache: cache, excluir: [], prazoMs: 5000 }).usd), 108);
    // arquivo que cresceu e relido, mesmo com a data de antes (copia que preserva a data).
    fs.appendFileSync(s1, '\n' + linha('m9', 'claude-opus-5-5', U, OUT));
    fs.utimesSync(s1, data, data);
    assert.strictEqual(Math.round(gasto.estimarMes({ raiz: raiz, mes: mes, cache: cache, excluir: [], prazoMs: 5000 }).usd), 16);
    // prazo zero: nada lido, tudo pendente, e o que ja estava no cache conta.
    const parcial = gasto.estimarMes({ raiz: raiz, mes: mes, cache: {}, excluir: [], prazoMs: 0 });
    assert.ok(parcial.pendentes > 0, JSON.stringify(parcial));
    // cache de outro mes nao vale.
    const outro = gasto.estimarMes({ raiz: raiz, mes: { ms: mes.ms, chave: '2026-11' }, cache: a.cache, excluir: [], prazoMs: 0 });
    assert.strictEqual(outro.usd, 0);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

// O que o mod guarda no $.store a cada medida: o cost.usd real da sessao no mes, e o % das janelas no 1o e no
// ultimo momento da sessao (a previsao em handoffs do medidor le isso).
const USO = { cost: { usd: 2.5 }, rateLimits: [
  { kind: 'five_hour', percentUsed: 40, resetsAt: 'R5' },
  { kind: 'seven_day', percentUsed: 10, resetsAt: 'R7' },
  { kind: 'spend_limit', percentUsed: 3 }
] };

test('guardarSessao: grava o real do mes e abre a sessao no historico; a medida seguinte so move o fim', () => {
  const agora = new Date(2026, 9, 10, 12).getTime();
  const a = gasto.guardarSessao({ historico: {}, gastoReal: {}, sessao: 's1', uso: USO, agora: agora });
  assert.deepStrictEqual(a.gastoReal, { '2026-10': { s1: 2.5 } });
  assert.deepStrictEqual(a.historico.s1, { t: agora, medidas: 1, janelas: {
    five_hour: { resetIni: 'R5', ini: 40, resetFim: 'R5', fim: 40 },
    seven_day: { resetIni: 'R7', ini: 10, resetFim: 'R7', fim: 10 } } });
  const uso2 = { cost: { usd: 3 }, rateLimits: [{ kind: 'five_hour', percentUsed: 45, resetsAt: 'R5b' }] };
  const b = gasto.guardarSessao({ historico: a.historico, gastoReal: a.gastoReal, sessao: 's1', uso: uso2, agora: agora + 1 });
  assert.strictEqual(b.gastoReal['2026-10'].s1, 3);
  assert.deepStrictEqual(b.historico.s1.janelas.five_hour, { resetIni: 'R5', ini: 40, resetFim: 'R5b', fim: 45 });
  assert.deepStrictEqual(b.historico.s1.janelas.seven_day, { resetIni: 'R7', ini: 10, resetFim: 'R7', fim: 10 });
  assert.strictEqual(b.historico.s1.medidas, 2);
  assert.strictEqual(b.historico.s1.t, agora + 1);
});

test('guardarSessao: poda o historico nas 40 mais recentes e o real nos 2 ultimos meses; entrada torta nao lanca', () => {
  const historico = {};
  for (let i = 0; i < 45; i++) historico['v' + i] = { t: i, medidas: 2, janelas: {} };
  const gastoReal = { '2026-07': { a: 1 }, '2026-08': { a: 1 }, '2026-09': { a: 1 } };
  const r = gasto.guardarSessao({ historico: historico, gastoReal: gastoReal, sessao: 'nova', uso: USO,
    agora: new Date(2026, 9, 10).getTime() });
  assert.strictEqual(Object.keys(r.historico).length, 40);
  assert.ok(r.historico.nova && !r.historico.v0 && !r.historico.v5 && r.historico.v6, Object.keys(r.historico).join(','));
  assert.deepStrictEqual(Object.keys(r.gastoReal).sort(), ['2026-09', '2026-10']);
  const torto = gasto.guardarSessao({ historico: 'x', gastoReal: [], sessao: '', uso: null, agora: 0 });
  assert.deepStrictEqual(torto, { historico: {}, gastoReal: {} });
  const semCusto = gasto.guardarSessao({ historico: {}, gastoReal: {}, sessao: 's', uso: { rateLimits: [] }, agora: 5 });
  assert.deepStrictEqual(semCusto.gastoReal, {});
  assert.strictEqual(semCusto.historico.s.medidas, 1);
});

// Plano 082, Tarefa 6 (p6-1): o id undefined da 1a mensagem sem id entrava no Set e descartava as seguintes sem id.
test('082 T6 (p6-1): mensagens sem id contam cada uma; o id que existe segue contando uma vez', () => {
  const texto = [linha(undefined, 'claude-opus-5-5', U, OUT), linha(undefined, 'claude-opus-5-5', U, OUT),
    linha('', 'claude-opus-5-5', U, OUT), linha('', 'claude-opus-5-5', U, OUT),
    linha('a', 'claude-opus-5-5', U, OUT), linha('a', 'claude-opus-5-5', U, OUT)].join('\n');
  // 4 sem id (undefined, undefined, '', '') x US$ 4 + o "a" uma vez
  assert.strictEqual(Math.round(gasto.custoDoTexto(texto, Date.UTC(2026, 9, 1)).usd), 20);
});

// p6-2: a transcricao que nao se le valia zero calada; agora conta em `ilegiveis`, fora do cache (a proxima medida tenta).
// p6-3: o `semPreco` chega ao gastoDoMes e fica no cache (o arquivo do cache seguia somando o seu).
test('082 T6 (p6-2, p6-3): ilegiveis e semPreco saem do estimarMes, do cache e do gastoDoMes', () => {
  const raiz = arvore();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-gasto-cache-'));
  try {
    const proj = path.join(raiz, 'c--proj');
    fs.mkdirSync(path.join(proj, 's2', 'subagents', 'agent-y.jsonl'));
    fs.writeFileSync(path.join(proj, 's3.jsonl'), linha('m4', 'modelo-sem-preco', U, OUT));
    const mes = { ms: Date.UTC(2026, 9, 1), chave: '2026-10' };
    const a = gasto.estimarMes({ raiz: raiz, mes: mes, cache: {}, excluir: [], prazoMs: 5000 });
    assert.deepStrictEqual([a.ilegiveis, a.semPreco, a.pendentes], [1, 1, 0], JSON.stringify(a));
    assert.ok(!Object.keys(a.cache).some(function (k) { return path.basename(k) === 'agent-y.jsonl'; }), 'ilegivel fora do cache');
    const b = gasto.estimarMes({ raiz: raiz, mes: mes, cache: a.cache, excluir: [], prazoMs: 5000 });
    assert.deepStrictEqual([b.ilegiveis, b.semPreco], [1, 1], 'do cache: ' + JSON.stringify(b));
    const agora = new Date(2026, 9, 10, 12).getTime();
    const g = gasto.gastoDoMes({ raiz: raiz, agora: agora, real: {}, arquivoDoCache: path.join(tmp, 'c.json'), prazoMs: 5000 });
    assert.deepStrictEqual([g.ilegiveis, g.semPreco], [1, 1], JSON.stringify(g));
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Plano 083 (p2-7): o arquivo que some entre o readdir e o stat tambem conta em `ilegiveis` (antes saia calado).
test('083 T6 (p2-7): stat que falha conta em ilegiveis', () => {
  const raiz = arvore();
  const original = fs.statSync;
  try {
    const proj = path.join(raiz, 'c--proj');
    fs.writeFileSync(path.join(proj, 's9.jsonl'), linha('m9', 'claude-opus-5-5', U, OUT));
    const mes = { ms: Date.UTC(2026, 9, 1), chave: '2026-10' };
    const antes = gasto.estimarMes({ raiz: raiz, mes: mes, cache: {}, excluir: [], prazoMs: 5000 });
    fs.statSync = function (p) {
      if (path.basename(String(p)) === 's9.jsonl') throw Object.assign(new Error('sumiu'), { code: 'ENOENT' });
      return original.apply(fs, arguments);
    };
    const depois = gasto.estimarMes({ raiz: raiz, mes: mes, cache: {}, excluir: [], prazoMs: 5000 });
    assert.strictEqual(depois.ilegiveis, antes.ilegiveis + 1, JSON.stringify([antes.ilegiveis, depois.ilegiveis]));
  } finally {
    fs.statSync = original;
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test('estimarMes: raiz que nao existe da zero, sem lancar', () => {
  const r = gasto.estimarMes({ raiz: path.join(os.tmpdir(), 'nao-existe-sworn-gasto'), mes: { ms: 0, chave: 'x' },
    cache: {}, excluir: [], prazoMs: 100 });
  assert.deepStrictEqual([r.usd, r.pendentes, r.ilegiveis], [0, 0, 0]);
});

// A6 (s220, estados :89 do HEAD): a raiz que existe e nao se le (aqui um arquivo, ENOTDIR) dava zero calado, igual a
// raiz ausente; agora conta em `ilegiveis`.
test('A6: raiz que nao se le conta em ilegiveis; so a ausente da zero calado', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-gasto-raiz-'));
  try {
    const arquivo = path.join(dir, 'projects');
    fs.writeFileSync(arquivo, 'nao sou pasta', 'utf8');
    const r = gasto.estimarMes({ raiz: arquivo, mes: { ms: 0, chave: 'x' }, cache: {}, excluir: [], prazoMs: 100 });
    assert.deepStrictEqual([r.usd, r.ilegiveis], [0, 1], JSON.stringify(r));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('gastoDoMes: soma o real do $.store do mes e a estimativa das outras sessoes; cache gravado no disco', () => {
  const raiz = arvore();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-gasto-cache-'));
  try {
    const agora = new Date(2026, 9, 10, 12).getTime();
    const real = { '2026-10': { s2: 1.5, atual: 2 }, '2026-09': { velha: 99 } };
    const r = gasto.gastoDoMes({ raiz: raiz, agora: agora, real: real, arquivoDoCache: path.join(tmp, 'c.json'), prazoMs: 5000 });
    assert.strictEqual(r.real, 3.5);
    assert.strictEqual(Math.round(r.estimado), 4, 's1 so (s2 tem real): ' + JSON.stringify(r));
    assert.strictEqual(Math.round(r.usd * 10), 75);
    assert.strictEqual(r.desde, '01/10');
    assert.ok(fs.existsSync(path.join(tmp, 'c.json')));
    // real torto nao derruba
    const torto = gasto.gastoDoMes({ raiz: raiz, agora: agora, real: { '2026-10': { a: 'x', b: -1, c: 2 } },
      arquivoDoCache: path.join(tmp, 'c.json'), prazoMs: 5000 });
    assert.strictEqual(torto.real, 2);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
