'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const transcricoes = require('../scripts/lib/transcricoes.js');
const saude = require('../scripts/lib/saude.js');

// Pedido 6, Etapa 4: transcricoes reais dos 5 harnesses (s275), cada uma com teste que falha, edicao de soma.js,
// teste de novo e resposta final. A versao cortada (so ate a edicao) e a cobranca 7b/8: teste que falhou e prova
// pendente depois da edicao.
const PASTA = path.join(__dirname, 'fixtures', 'harness', 'transcricoes');
const PROVA = 'node --test';

function temp(nome) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-transcricoes-')), nome);
}

function linhas(nome) {
  return fs.readFileSync(path.join(PASTA, nome), 'utf8').split('\n').filter(Boolean);
}

/** As `n` primeiras linhas da fixture num arquivo novo. */
function cortada(nome, n) {
  const destino = temp(nome);
  fs.writeFileSync(destino, linhas(nome).slice(0, n).join('\n') + '\n');
  return destino;
}

/** O dsh grava session.v4.jsonl.zstd: um quadro zstd por escrita, encadeados. */
function dsh(n) {
  const destino = temp('session.v4.jsonl.zstd');
  const todas = linhas('dsh.jsonl').slice(0, n);
  fs.writeFileSync(destino, Buffer.concat(todas.map((l) => zlib.zstdCompressSync(Buffer.from(l + '\n')))));
  return destino;
}

/** O OpenCode guarda a sessao no SQLite (tabelas message e part); a ponte passa <db>#<sessao>. */
function opencode(n) {
  const exp = JSON.parse(fs.readFileSync(path.join(PASTA, 'opencode.json'), 'utf8'));
  return banco(exp.info.id, exp.messages.slice(0, n), exp.messages[1]);
}

function banco(sessao, mensagens, outra) {
  const { DatabaseSync } = require('node:sqlite');
  const arquivo = temp('opencode.db');
  const db = new DatabaseSync(arquivo);
  db.exec('create table message (id text primary key, session_id text, time_created integer, time_updated integer, ' +
    'data text); create table part (id text primary key, message_id text, session_id text, time_created integer, ' +
    'time_updated integer, data text)');
  const msg = db.prepare('insert into message values (?, ?, ?, ?, ?)');
  const parte = db.prepare('insert into part values (?, ?, ?, ?, ?, ?)');
  let t = 1000;
  // Outra sessao no mesmo banco, com teste que falha por ultimo: nao pode vazar para a lida.
  if (outra) {
    msg.run('msg_outra', 'ses_outra', 99999, 99999, JSON.stringify(outra.info));
    outra.parts.forEach((p, i) => parte.run('prt_outra' + i, 'msg_outra', 'ses_outra', 99999, 99999, JSON.stringify(p)));
  }
  mensagens.forEach((m) => {
    t += 10;
    msg.run(m.info.id, sessao, t, t, JSON.stringify(m.info));
    m.parts.forEach((p) => { t += 1; parte.run(p.id, m.info.id, sessao, t, t, JSON.stringify(p)); });
  });
  db.close();
  return arquivo + '#' + sessao;
}

function jsonl(nome, objetos) {
  const destino = temp(nome);
  fs.writeFileSync(destino, objetos.map((o) => JSON.stringify(o)).join('\n') + '\n');
  return destino;
}

const CASOS = [
  // codex: o node --test saiu com spawn EPERM (o sandbox barrou o processo filho; D785, s328).
  { formato: 'codex', inteira: () => path.join(PASTA, 'codex.jsonl'), ate: () => cortada('codex.jsonl', 18),
    contexto: 23169, teste: 'node --test soma.test.js .', passou: false, sandbox: true,
    mensagem: /^Corrigi `soma\.js`, mas/ },
  { formato: 'qwen', inteira: () => path.join(PASTA, 'qwen.jsonl'), ate: () => cortada('qwen.jsonl', 7),
    contexto: 24793, modelo: 'deepseek-chat', teste: 'node --test soma.test.js', passou: true,
    mensagem: /^Terminou com sucesso: o teste/ },
  { formato: 'agy', inteira: () => path.join(PASTA, 'agy.jsonl'), ate: () => cortada('agy.jsonl', 7),
    contexto: 8629, teste: 'node --test soma.test.js', passou: true, mensagem: /^O teste passou com sucesso/ },
  // dsh: o 2o node --test foi negado (sem canal de aprovacao) e o que passou foi `node soma.test.js`, que nao e teste.
  { formato: 'dsh', inteira: () => dsh(), ate: () => dsh(31), contexto: 9554, modelo: 'deepseek-flash',
    teste: 'node --test soma.test.js', passou: false, mensagem: /^Passou: `node soma\.test\.js`/ },
  { formato: 'opencode', inteira: () => opencode(), ate: () => opencode(4), contexto: 15638, modelo: 'deepseek-flash',
    teste: 'node --test soma.test.js', passou: true, mensagem: /^Terminou com sucesso: 1 teste passou, 0 falhas\.$/ }
];

for (const c of CASOS) {
  test('transcricoes ' + c.formato + ': formato, contexto, ultimo teste e ultima mensagem da transcricao inteira', () => {
    const caminho = c.inteira();
    const lida = transcricoes.ler(caminho);
    assert.strictEqual(lida.formato, c.formato);
    assert.match(lida.ultimaMensagem, c.mensagem);
    const chamada = saude.ultimaChamadaDoTranscript(caminho);
    assert.strictEqual(chamada.contexto, c.contexto);
    assert.ok(Number.isFinite(chamada.horario), 'horario da ultima chamada');
    if (c.modelo) assert.strictEqual(chamada.modelo, c.modelo);
    assert.strictEqual(saude.contextoDoTranscript(caminho), c.contexto);
    const ultimoTeste = Object.assign({ comando: c.teste, falhou: !c.passou }, c.sandbox ? { barradoPeloSandbox: true } : {});
    assert.deepStrictEqual(saude.testesDoTranscript(caminho, PROVA), { ultimoTeste: ultimoTeste, provaPendente: false });
  });

  test('transcricoes ' + c.formato + ': cortada depois da edicao, o teste falhou e a prova ficou pendente', () => {
    const t = saude.testesDoTranscript(c.ate(), PROVA);
    assert.strictEqual(t.ultimoTeste.falhou, true);
    assert.match(t.ultimoTeste.comando, /^node --test soma\.test\.js/);
    assert.strictEqual(t.provaPendente, true);
  });
}

// A marca de falha de cada harness, com uma saida que nao mostra falha (textoMostraFalha da false): so a marca decide.
const NEUTRA = 'saida neutra';
const MARCAS = {
  codex: (f) => jsonl('codex.jsonl', [{ type: 'event_msg', payload: { type: 'item_completed', item: {
    type: 'CommandExecution', id: 'c1', command: ['bash', '-lc', 'node --test'], status: f ? 'failed' : 'completed',
    aggregated_output: NEUTRA } } }]),
  qwen: (f) => jsonl('qwen.jsonl', [
    { type: 'assistant', message: { parts: [{ functionCall: { id: 'q1', name: 'run_shell_command',
      args: { command: 'node --test' } } }] } },
    { type: 'tool_result', message: { parts: [{ functionResponse: { id: 'q1', response: { output: NEUTRA } } }] },
      toolCallResult: { status: f ? 'error' : 'success' } }]),
  // Duas chamadas no mesmo passo: os resultados vem na ordem delas.
  agy: (f) => jsonl('agy.jsonl', [
    { step_index: 1, type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'run_command', args: { CommandLine: 'node --test' } },
      { name: 'read_file', args: { Path: 'C:\\dev\\proj\\soma.js' } }] },
    { step_index: 2, type: 'GENERIC', status: f ? 'ERROR' : 'DONE', content: NEUTRA },
    { step_index: 3, type: 'GENERIC', status: f ? 'DONE' : 'ERROR', content: NEUTRA }]),
  dsh: (f) => {
    const destino = temp('session.v4.jsonl.zstd');
    fs.writeFileSync(destino, zlib.zstdCompressSync(Buffer.from([
      { type: 'assistant/message', data: { message: { content: [{ type: 'tool-call', id: 'd1', name: 'pwsh',
        arguments: '{"command":"node --test"}' }] } } },
      { type: 'tool/result', data: { message: { toolCallId: 'd1', isError: f, content: [{ type: 'text', text: NEUTRA }] } } }
    ].map((o) => JSON.stringify(o)).join('\n'))));
    return destino;
  },
  opencode: (f) => banco('ses_marca', [{ info: { id: 'msg_1', role: 'assistant' }, parts: [{ id: 'prt_1', type: 'tool',
    tool: 'bash', callID: 'o1', state: { status: 'completed', input: { command: 'node --test' }, output: NEUTRA,
      metadata: { exit: f ? 1 : 0 } } }] }]),
  'opencode com erro': (f) => banco('ses_erro', [{ info: { id: 'msg_1', role: 'assistant' }, parts: [{ id: 'prt_1',
    type: 'tool', tool: 'bash', callID: 'o1', state: f ? { status: 'error', input: { command: 'node --test' }, error: NEUTRA }
      : { status: 'completed', input: { command: 'node --test' }, output: NEUTRA } }] }])
};

for (const [nome, montar] of Object.entries(MARCAS)) {
  test('transcricoes ' + nome + ': a marca de falha do harness decide, sem texto de falha na saida', () => {
    assert.deepStrictEqual(saude.testesDoTranscript(montar(true), PROVA).ultimoTeste,
      { comando: 'node --test', falhou: true });
    assert.deepStrictEqual(saude.testesDoTranscript(montar(false), PROVA).ultimoTeste,
      { comando: 'node --test', falhou: false });
  });
}

test('transcricoes opencode: ferramenta ainda rodando nao e resultado', () => {
  const caminho = banco('ses_rodando', [{ info: { id: 'msg_1', role: 'assistant' }, parts: [{ id: 'prt_1', type: 'tool',
    tool: 'bash', callID: 'o1', state: { status: 'running', input: { command: 'node --test' } } }] }]);
  assert.strictEqual(saude.testesDoTranscript(caminho, PROVA).ultimoTeste, null);
});

// s306 (t7 ao vivo, gpt-6-luna): node --test, read, apply_patch em src/a.js e "Tudo verde" com o bloco de antes. O
// apply_patch chegava cru e a edicao nao contava: a prova nao ficava pendente e a trava 8 nao barrou.
test('transcricoes opencode: a edicao pelo apply_patch deixa a prova pendente; a de .md, nao', () => {
  const patch = (arquivo) => banco('ses_patch', [
    { info: { id: 'msg_1', role: 'assistant' }, parts: [{ id: 'prt_1', type: 'tool', tool: 'bash', callID: 'call_1',
      state: { status: 'completed', input: { command: 'node --test', timeout: 120000, workdir: 'C:\\dev\\proj' },
        output: 'ℹ pass 1\nℹ fail 0', metadata: { exit: 0 } } }] },
    { info: { id: 'msg_2', role: 'assistant' }, parts: [{ id: 'prt_2', type: 'tool', tool: 'apply_patch',
      callID: 'call_2', state: { status: 'completed', output: 'Success.', input: { patchText: '*** Begin Patch\n' +
        '*** Update File: C:\\dev\\proj\\' + arquivo + '\n@@\n module.exports = { soma: (a, b) => a + b, ' +
        'coberturaMinima };\n+// revisado\n*** End Patch' } } }] }]);
  const codigo = patch('src\\a.js');
  assert.deepStrictEqual(transcricoes.ler(codigo).eventos.filter((e) => e.tipo === 'chamada')
    .map((e) => [e.nome, e.entrada.file_path]), [['Bash', undefined], ['Edit', 'C:\\dev\\proj\\src\\a.js']]);
  assert.deepStrictEqual(saude.testesDoTranscript(codigo, PROVA),
    { ultimoTeste: { comando: 'node --test', falhou: false }, provaPendente: true });
  assert.strictEqual(saude.testesDoTranscript(patch('docs\\notas.md'), PROVA).provaPendente, false);
});

test('transcricoes: o cache entra no contexto do agy, e o texto do usuario nao e a ultima mensagem do OpenCode', () => {
  const agy = jsonl('agy.jsonl', [{ step_index: 1, type: 'PLANNER_RESPONSE', input_tokens: 10, cache_read_tokens: 5,
    content: 'pronto' }]);
  assert.strictEqual(saude.contextoDoTranscript(agy), 15);
  const oc = banco('ses_texto', [
    { info: { id: 'msg_1', role: 'assistant' }, parts: [{ id: 'prt_1', type: 'text', text: 'resposta' }] },
    { info: { id: 'msg_2', role: 'user' }, parts: [{ id: 'prt_2', type: 'text', text: 'pedido novo' }] }]);
  assert.strictEqual(transcricoes.ler(oc).ultimaMensagem, 'resposta');
});

test('transcricoes: linha com cara de outro harness depois da 1a do Claude Code nao muda o formato', () => {
  const caminho = jsonl('claude.jsonl', [{ type: 'user', isSidechain: false, message: { content: 'oi' } },
    { type: 'x', payload: {}, step_index: 1 }]);
  assert.strictEqual(transcricoes.ler(caminho).formato, 'claude');
});

test('transcricoes: a do Claude Code segue no caminho de hoje', () => {
  const caminho = temp('claude.jsonl');
  fs.writeFileSync(caminho, [
    { type: 'assistant', timestamp: '2026-11-02T10:00:00Z', message: { model: 'claude-x', usage: { input_tokens: 5,
      cache_read_input_tokens: 10, cache_creation_input_tokens: 1 }, content: [{ type: 'tool_use', id: 't1',
      name: 'Bash', input: { command: 'node --test' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'x' }] } }
  ].map((o) => JSON.stringify(o)).join('\n') + '\n');
  assert.strictEqual(transcricoes.ler(caminho).formato, 'claude');
  assert.deepStrictEqual(saude.ultimaChamadaDoTranscript(caminho),
    { contexto: 16, horario: Date.parse('2026-11-02T10:00:00Z'), modelo: 'claude-x' });
  assert.deepStrictEqual(saude.testesDoTranscript(caminho, PROVA),
    { ultimoTeste: { comando: 'node --test', falhou: true }, provaPendente: false });
});

test('transcricoes: sem leitura (sem caminho, arquivo ausente, banco ausente, sessao sem linha) da null', () => {
  assert.strictEqual(transcricoes.ler(''), null);
  assert.strictEqual(transcricoes.ler(undefined), null);
  assert.strictEqual(transcricoes.ler(temp('nao-existe.jsonl')), null);
  assert.strictEqual(transcricoes.ler(temp('nao-existe.jsonl.zstd')), null);
  assert.strictEqual(transcricoes.ler(temp('nao-existe.db') + '#ses_x'), null);
  assert.strictEqual(transcricoes.ler(opencode().replace(/#.*$/, '#ses_nenhuma')), null);
  assert.strictEqual(saude.testesDoTranscript(temp('nao-existe.jsonl'), PROVA), null);
});

test('transcricoes: legivel - o dsh pede zstd no zlib, o OpenCode node:sqlite, os outros leem sempre', () => {
  for (const h of ['codex', 'qwen', 'agy', 'dsh', 'opencode']) assert.strictEqual(transcricoes.legivel(h), true);
  const original = zlib.zstdDecompressSync;
  zlib.zstdDecompressSync = undefined;
  try {
    assert.strictEqual(transcricoes.legivel('dsh'), false);
    assert.strictEqual(transcricoes.legivel('opencode'), true);
  } finally { zlib.zstdDecompressSync = original; }
});

// s296: bytes que nao comprimem vao crus para o quadro, e o numero magico pode estar entre eles. O corte nesse ponto
// apagava, calado, todos os quadros seguintes (o quadro truncado nao lanca no zstd do Node).
test('transcricoes dsh: o numero magico cru dentro de um quadro nao apaga os quadros seguintes', () => {
  const magico = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const ruido = (de) => Buffer.concat(Array.from({ length: 100 }, (_, i) =>
    crypto.createHash('sha256').update(de + i).digest())).map((b) => (b === 0x0a ? 0x0b : b));
  // Um bloco so de espacos (RLE) antes do ruido; os quadros variam o cabecalho: com checksum e sem o tamanho (janela).
  const c = zlib.constants;
  const cabecalhos = [{}, { [c.ZSTD_c_checksumFlag]: 1 }, { [c.ZSTD_c_contentSizeFlag]: 0 }];
  // A linha 2 da transcricao vem no mesmo quadro, depois do numero magico: cortar ali a perderia.
  const todas = linhas('dsh.jsonl');
  const estranho = zlib.zstdCompressSync(Buffer.concat([Buffer.alloc(300000, 0x20), ruido('a'), magico, ruido('b'),
    Buffer.from('\n' + todas[1] + '\n')]), { params: { [c.ZSTD_c_checksumFlag]: 1, [c.ZSTD_c_contentSizeFlag]: 0 } });
  assert.ok(estranho.indexOf(magico, 1) > 0, 'o quadro do teste tem de trazer o numero magico dentro');
  const montar = (meio, cabecalho) => {
    const destino = temp('session.v4.jsonl.zstd');
    const quadros = todas.map((l, i) => zlib.zstdCompressSync(Buffer.from(l + '\n'), { params: cabecalho(i) }));
    fs.writeFileSync(destino, Buffer.concat([quadros[0], meio].concat(quadros.slice(2))));
    return destino;
  };
  // A referencia so com o cabecalho padrao: o que ela le nao depende do que o teste prova.
  assert.deepStrictEqual(transcricoes.ler(montar(estranho, (i) => cabecalhos[i % 3])),
    transcricoes.ler(montar(zlib.zstdCompressSync(Buffer.from('ruido\n' + todas[1] + '\n')), () => ({}))));
});

test('transcricoes dsh: o ultimo quadro truncado (o dsh no meio da escrita) guarda os blocos inteiros dele', () => {
  const todas = linhas('dsh.jsonl');
  const enchimento = Array.from({ length: 12000 }, (_, i) => JSON.stringify({ type: 'enchimento', i })).join('\n');
  const ultimo = zlib.zstdCompressSync(Buffer.from(todas.slice(20).join('\n') + '\n' + enchimento + '\n'));
  const destino = temp('session.v4.jsonl.zstd');
  fs.writeFileSync(destino, Buffer.concat(todas.slice(0, 20).map((l) => zlib.zstdCompressSync(Buffer.from(l + '\n')))
    .concat([ultimo.subarray(0, ultimo.length - 10)])));
  assert.deepStrictEqual(transcricoes.ler(destino), transcricoes.ler(dsh()));
});
