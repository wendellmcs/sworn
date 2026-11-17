'use strict';
// D678 T5 (plano da escada, par.3 linha 41): a prova do efetivo. Cada linha `assistant` de um subagente traz o agente
// (`attributionAgent`), o modelo que respondeu (`message.model`) e o esforco (`effort`); a lib junta por agente, cruza
// com os `degraus` do projeto e acusa o apelido que passou a responder com outro id (a familia que mudou calada).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const efetivo = require('../scripts/lib/efetivo.js');
const auditoria = require('../scripts/lib/auditoria.js');

const AGORA = Date.parse('2026-10-27T12:00:00Z');

function resposta(agente, modelo, esforco, quando) {
  const l = { type: 'assistant', attributionAgent: agente, timestamp: quando, message: { model: modelo } };
  if (esforco) l.effort = esforco;
  return JSON.stringify(l);
}

/** Pasta de projeto falsa: `<sessao>.jsonl` da conversa principal e `<sessao>/subagents/agent-<n>.jsonl`. */
function projeto(t, subagentes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn efetivo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 's1.jsonl'), resposta('', 'claude-opus-5-5', 'high', '2026-10-27T10:00:00Z') + '\n');
  fs.mkdirSync(path.join(dir, 's1', 'subagents'), { recursive: true });
  subagentes.forEach(function (linhas, i) {
    fs.writeFileSync(path.join(dir, 's1', 'subagents', 'agent-' + i + '.jsonl'), linhas.join('\n') + '\n');
  });
  return dir;
}

/** Resposta do agente 'grande' com `bytes` de recheio: a linha passa do teto que for menor que isso. */
function longa(bytes) {
  return resposta('grande', 'claude-opus-5-5', 'high', '2026-10-27T09:00:00Z').replace('"type"',
    '"pad":"' + 'y'.repeat(bytes) + '","type"');
}

/** Roda `fn` anotando o tamanho pedido a cada fs.readSync; com `falhaNa`, essa chamada (1, 2...) lanca EIO. */
function comLeituras(fn, falhaNa) {
  const original = fs.readSync;
  const tamanhos = [];
  fs.readSync = function (fd, buf, desde, tamanho) {
    tamanhos.push(tamanho);
    if (tamanhos.length === falhaNa) { const e = new Error('falha de leitura'); e.code = 'EIO'; throw e; }
    return original.apply(fs, arguments);
  };
  try { return { valor: fn(), tamanhos: tamanhos }; } finally { fs.readSync = original; }
}

test('efetivo: o apelido sai do id do modelo; id sem apelido conhecido da vazio', () => {
  assert.strictEqual(efetivo.apelidoDoId('claude-sonnet-5-5'), 'sonnet');
  assert.strictEqual(efetivo.apelidoDoId('claude-3-5-haiku-20241022'), 'haiku');
  assert.strictEqual(efetivo.apelidoDoId('Claude-Opus-6'), 'opus');
  assert.strictEqual(efetivo.apelidoDoId('claude-sonnetx-1'), '');
  assert.strictEqual(efetivo.apelidoDoId(null), '');
});

test('efetivo: junta por agente so as respostas dos subagentes, com o ultimo modelo e esforco', (t) => {
  const dir = projeto(t, [[
    resposta('sworn:inspector', 'claude-sonnet-5-5', 'medium', '2026-10-27T09:00:00Z'),
    '{"type":"user","message":{"content":"x"}}',
    '{quebrado',
    resposta('sworn:inspector', '<synthetic>', '', '2026-10-27T09:30:00Z'),
    resposta('', 'claude-sonnet-5-5', 'high', '2026-10-27T09:40:00Z'),
    resposta('sworn:inspector', 'claude-sonnet-5-5', '', '2026-10-27T09:45:00Z'),
    resposta('sworn:inspector', 'claude-sonnet-5-5', 'low', '2026-10-27T10:00:00Z')
  ]]);
  const m = efetivo.medir(dir, { agora: AGORA });
  assert.deepStrictEqual(Object.keys(m.agentes), ['sworn:inspector'], 'a conversa principal (s1.jsonl) e a linha sem agente ficam fora');
  const a = m.agentes['sworn:inspector'];
  assert.strictEqual(a.respostas, 3, 'linha de usuario, linha quebrada e <synthetic> ficam fora');
  assert.deepStrictEqual(a.modelos, { 'claude-sonnet-5-5': 3 });
  assert.deepStrictEqual(a.esforcos, { medium: 1, low: 1 }, 'resposta sem effort nao conta esforco');
  assert.strictEqual(a.ultimo.modelo, 'claude-sonnet-5-5');
  assert.strictEqual(a.ultimo.esforco, 'low');
});

test('efetivo: resposta sem data nao passa a frente da ultima datada; arquivo que nao se le e contado', (t) => {
  const dir = projeto(t, [[
    resposta('x', 'claude-sonnet-5-5', 'high', '2026-10-27T09:00:00Z'),
    resposta('x', 'claude-haiku-5-5', 'low', undefined),
    resposta('y', 'claude-haiku-5-5', 'low', undefined),
    resposta('y', 'claude-sonnet-5-5', 'high', '2026-10-27T09:00:00Z')
  ]]);
  fs.mkdirSync(path.join(dir, 's1', 'subagents', 'agent-9.jsonl'));
  const m = efetivo.medir(dir, { agora: AGORA });
  assert.strictEqual(m.agentes.x.ultimo.modelo, 'claude-sonnet-5-5', 'sem timestamp nao e "a mais nova"');
  assert.strictEqual(m.agentes.y.ultimo.modelo, 'claude-sonnet-5-5', 'a datada passa a frente da sem data');
  assert.strictEqual(m.ilegiveis, 1, 'a pasta com nome de .jsonl nao se le e entra na conta');
  assert.strictEqual(efetivo.daAuditoria({ caminho: path.join(dir, 's1.jsonl') }, null, AGORA).ilegiveis, 1);
});

// A6-57: a leitura em blocos da o mesmo que a do arquivo inteiro, com a fronteira em qualquer byte
test('efetivo: lido em blocos de qualquer tamanho, o arquivo da o mesmo resultado (A6-57)', (t) => {
  const linhas = [
    resposta('revisão:ação', 'claude-sonnet-5-5', 'médio', '2026-10-27T09:00:00Z'),
    '{"type":"user","message":{"content":"' + 'x'.repeat(50) + '"}}',
    resposta('revisão:ação', 'claude-haiku-5-5', 'low', '2026-10-27T10:00:00Z'),
    resposta('outro', 'claude-opus-5-5', 'high', '2026-10-27T11:00:00Z')
  ];
  const dir = projeto(t, [[]]);
  // CRLF no meio e a ultima linha sem quebra
  fs.writeFileSync(path.join(dir, 's1', 'subagents', 'agent-0.jsonl'), linhas.slice(0, 3).join('\r\n') + '\n' + linhas[3]);
  const inteiro = efetivo.medir(dir, { agora: AGORA });
  assert.deepStrictEqual(Object.keys(inteiro.agentes).sort(), ['outro', 'revisão:ação']);
  assert.strictEqual(inteiro.agentes['revisão:ação'].respostas, 2);
  assert.deepStrictEqual(inteiro.agentes['revisão:ação'].esforcos, { 'médio': 1, low: 1 });
  assert.strictEqual(inteiro.agentes.outro.ultimo.modelo, 'claude-opus-5-5', 'a ultima linha, sem \\n, entra');
  // o tamanho que chega ao readSync prova que a opcao vale (o resultado, sozinho, e o mesmo com qualquer bloco)
  for (const bloco of [1, 2, 3, 7, 64]) {
    const lido = comLeituras(() => efetivo.medir(dir, { agora: AGORA, bloco: bloco }));
    assert.deepStrictEqual(lido.valor, inteiro, 'bloco ' + bloco);
    assert.deepStrictEqual([...new Set(lido.tamanhos)], [bloco], 'bloco ' + bloco + ': o readSync pede esse tamanho');
  }
  // bloco que nao e inteiro positivo cai no padrao (1 MiB)
  for (const ruim of [0, -1, 1.5, '4', NaN, Infinity]) {
    const lido = comLeituras(() => efetivo.medir(dir, { agora: AGORA, bloco: ruim }));
    assert.deepStrictEqual(lido.valor, inteiro, 'bloco ' + String(ruim));
    assert.deepStrictEqual([...new Set(lido.tamanhos)], [1024 * 1024], 'bloco ' + String(ruim) + ' cai no padrao');
  }
});

test('efetivo: o arquivo vazio conta como lido, sem resposta e sem linha pulada (A6-57)', (t) => {
  const dir = projeto(t, [[]]);
  fs.writeFileSync(path.join(dir, 's1', 'subagents', 'agent-0.jsonl'), '');
  for (const bloco of [1, 1024]) {
    const m = efetivo.medir(dir, { agora: AGORA, bloco: bloco });
    assert.deepStrictEqual([m.arquivos, m.ilegiveis, m.linhasLongas, m.agentes], [1, 0, 0, {}], 'bloco ' + bloco);
  }
});

test('efetivo: a linha acima do teto e pulada inteira, contada em linhasLongas, e a seguinte entra (A6-57)', (t) => {
  const dir = projeto(t, [[longa(300), resposta('pequeno', 'claude-haiku-5-5', 'low', '2026-10-27T10:00:00Z')]]);
  for (const bloco of [4, 16, 1024]) {
    const m = efetivo.medir(dir, { agora: AGORA, bloco: bloco, tetoDaLinha: 200 });
    const onde = 'bloco ' + bloco + ': ';
    assert.deepStrictEqual(Object.keys(m.agentes), ['pequeno'], onde + JSON.stringify(m.agentes));
    assert.strictEqual(m.arquivos, 1, onde + 'o arquivo se leu');
    assert.strictEqual(m.ilegiveis, 0, onde + 'a linha pulada nao torna o arquivo ilegivel');
    assert.strictEqual(m.linhasLongas, 1, onde + 'a linha pulada aparece na conta');
  }
  // com o teto acima da linha, as duas entram e nada e pulado
  const m = efetivo.medir(dir, { agora: AGORA, bloco: 16, tetoDaLinha: 1000 });
  assert.deepStrictEqual(Object.keys(m.agentes).sort(), ['grande', 'pequeno']);
  assert.strictEqual(m.linhasLongas, 0);
  // teto que nao e inteiro positivo cai no padrao (64 MiB): a linha de 300 bytes entra
  for (const ruim of [0, -1, 1.5, '200', NaN]) {
    const r = efetivo.medir(dir, { agora: AGORA, bloco: 16, tetoDaLinha: ruim });
    assert.deepStrictEqual(Object.keys(r.agentes).sort(), ['grande', 'pequeno'], 'teto ' + String(ruim) + ' cai no padrao');
    assert.strictEqual(r.linhasLongas, 0, 'teto ' + String(ruim) + ': nada pulado');
  }
});

test('efetivo: a ultima linha, sem quebra e acima do teto, tambem e pulada e contada (A6-57)', (t) => {
  const dir = projeto(t, [[]]);
  fs.writeFileSync(path.join(dir, 's1', 'subagents', 'agent-0.jsonl'),
    resposta('pequeno', 'claude-haiku-5-5', 'low', '2026-10-27T10:00:00Z') + '\n' + longa(300));
  for (const bloco of [4, 16, 1024]) {
    const m = efetivo.medir(dir, { agora: AGORA, bloco: bloco, tetoDaLinha: 200 });
    const onde = 'bloco ' + bloco + ': ';
    assert.deepStrictEqual(Object.keys(m.agentes), ['pequeno'], onde + JSON.stringify(m.agentes));
    assert.strictEqual(m.ilegiveis, 0, onde + 'a linha pulada nao torna o arquivo ilegivel');
    assert.strictEqual(m.linhasLongas, 1, onde + 'a ultima linha pulada aparece na conta');
  }
});

test('efetivo: sem opcao, o teto padrao (64 MiB) vale e a auditoria leva a conta das linhas puladas (A6-57)', (t) => {
  const dir = projeto(t, [[longa(64 * 1024 * 1024), resposta('pequeno', 'claude-haiku-5-5', 'low', '2026-10-27T10:00:00Z')]]);
  const m = efetivo.daAuditoria({ caminho: path.join(dir, 's1.jsonl') }, null, AGORA);
  assert.deepStrictEqual(m.foraDaTabela.map((a) => a.agente), ['pequeno'], 'a linha acima de 64 MiB nao entra');
  assert.strictEqual(m.linhasLongas, 1);
  assert.strictEqual(m.ilegiveis, 0);
});

test('efetivo: o erro de leitura no meio do arquivo nao deixa metade dele na conta (A6-57)', (t) => {
  const primeira = resposta('a', 'claude-haiku-5-5', 'low', '2026-10-27T09:00:00Z');
  const dir = projeto(t, [[primeira, resposta('a', 'claude-sonnet-5-5', 'high', '2026-10-27T10:00:00Z')]]);
  // o primeiro bloco traz a primeira resposta inteira (com a quebra); o segundo readSync falha. So o agent-0 e lido: a
  // conversa principal (s1.jsonl) nao e de subagente e o medir nem a abre.
  const bloco = Buffer.byteLength(primeira) + 10;
  const lido = comLeituras(() => efetivo.medir(dir, { agora: AGORA, bloco: bloco }), 2);
  assert.ok(lido.tamanhos.length >= 2, 'o teste nao chegou ao segundo bloco');
  assert.strictEqual(lido.valor.ilegiveis, 1, 'o erro no meio conta o arquivo como ilegivel');
  assert.strictEqual(lido.valor.arquivos, 0, 'o arquivo lido pela metade nao conta como lido');
  assert.deepStrictEqual(lido.valor.agentes, {}, 'a resposta do primeiro bloco nao entra');
});

test('efetivo: o agente de workflow (subagents/workflows/<run>/) entra; o journal do run nao e transcricao', (t) => {
  // A6 (pedido 12, lacuna (a) da sonda da s186): o efetivo so lia subagents/*.jsonl e nao via os inspetores das levas.
  const dir = projeto(t, []);
  fs.writeFileSync(path.join(dir, 's1.jsonl'), resposta('principal', 'claude-opus-5-5', 'high', '2026-10-27T09:00:00Z') + '\n');
  const run = path.join(dir, 's1', 'subagents', 'workflows', 'wf_1');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'agent-a1.jsonl'), resposta('sworn:inspector', 'claude-sonnet-5-5', 'medium', '2026-10-27T09:00:00Z') + '\n');
  fs.writeFileSync(path.join(run, 'journal.jsonl'), resposta('intruso', 'claude-opus-5-5', 'high', '2026-10-27T09:00:00Z') + '\n');
  const m = efetivo.medir(dir, { agora: AGORA });
  assert.deepStrictEqual(Object.keys(m.agentes), ['sworn:inspector'], 'a conversa principal e o journal do run ficam fora');
  assert.strictEqual(m.agentes['sworn:inspector'].ultimo.esforco, 'medium');
  assert.strictEqual(m.arquivos, 1);
});

test('efetivo: arquivo mexido antes da janela nao e lido; pasta que nao existe da vazio', (t) => {
  const dir = projeto(t, [[resposta('velho', 'claude-haiku-5-5', 'low', '2026-08-01T10:00:00Z')]]);
  const antigo = new Date('2026-08-01T10:00:00Z');
  fs.utimesSync(path.join(dir, 's1', 'subagents', 'agent-0.jsonl'), antigo, antigo);
  assert.deepStrictEqual(efetivo.medir(dir, { agora: AGORA, dias: 30 }).agentes, {});
  assert.deepStrictEqual(Object.keys(efetivo.medir(dir, { agora: AGORA, dias: 100 }).agentes), ['velho'], 'a janela vem de `dias`');
  assert.deepStrictEqual(efetivo.medir(path.join(dir, 'nao-existe'), { agora: AGORA }).agentes, {});
});

test('efetivo: cruza com os degraus - confere, diverge no modelo ou no esforco, e "nao sei" sem resposta ou sem effort', (t) => {
  const dir = projeto(t, [[
    resposta('busca-rapida', 'claude-haiku-5-5', 'low', '2026-10-27T09:00:00Z'),
    resposta('revisor', 'claude-opus-5-5', 'high', '2026-10-27T09:00:00Z'),
    resposta('detalhista', 'claude-sonnet-5-5', 'medium', '2026-10-27T09:00:00Z'),
    resposta('antigo', 'claude-sonnet-5-5', '', '2026-10-27T09:00:00Z'),
    resposta('sem-esforco', 'claude-haiku-5-5', 'high', '2026-10-27T09:00:00Z'),
    resposta('herda', 'claude-opus-5-5', 'high', '2026-10-27T09:00:00Z')
  ]]);
  const linhas = efetivo.cruzar(efetivo.medir(dir, { agora: AGORA }), [
    { agente: 'busca-rapida', apelido: 'haiku', esforco: 'low' },
    { agente: 'revisor', apelido: 'sonnet', esforco: 'high' },
    { agente: 'detalhista', apelido: 'sonnet', esforco: 'high' },
    { agente: 'antigo', apelido: 'sonnet', esforco: 'medium' },
    { agente: 'parado', apelido: 'opus', esforco: 'high' },
    { agente: 'sem-esforco', apelido: 'Haiku' },
    { agente: 'herda', apelido: 'inherit', esforco: 'high' }
  ]);
  const por = {};
  for (const l of linhas) por[l.agente] = l;
  assert.strictEqual(por['busca-rapida'].confere, true);
  assert.strictEqual(por.revisor.confere, false);
  assert.match(por.revisor.motivo, /^modelo: .*; confira o arquivo do agente .* agentes\.degraus do \.claude\/sworn\/projeto\.json$/);
  assert.strictEqual(por.detalhista.confere, false);
  assert.match(por.detalhista.motivo, /^esforco: .*; confira o arquivo do agente .* agentes\.degraus do /);
  assert.strictEqual(por.antigo.confere, null, 'resposta sem effort (binario velho) e "nao sei", nao divergencia');
  assert.match(por.antigo.motivo, /nao sei; atualize o Claude Code e chame o agente de novo$/);
  assert.strictEqual(por.parado.confere, null, 'degrau sem resposta na janela e "nao sei"');
  assert.match(por.parado.motivo, /nao sei se a tabela vale para ele; chame o agente uma vez e rode a auditoria de novo$/);
  assert.strictEqual(por.parado.efetivo, null);
  assert.strictEqual(por['sem-esforco'].confere, true, 'degrau sem esforco gravado compara so o modelo, sem caixa');
  assert.strictEqual(por.herda.confere, null, 'apelido fora dos conhecidos e "nao sei", nao divergencia');
});

test('efetivo: cruzar sem medida e "nao sei" em cada degrau, sem lancar', () => {
  const linhas = efetivo.cruzar(undefined, [{ agente: 'revisor', apelido: 'sonnet', esforco: 'high' }]);
  assert.strictEqual(linhas.length, 1);
  assert.strictEqual(linhas[0].confere, null);
  assert.match(linhas[0].motivo, /nada medido/);
});

test('efetivo: acusa o apelido que passou a responder com outro id, do mais velho para o mais novo', (t) => {
  const dir = projeto(t, [
    [resposta('a', 'claude-sonnet-5-5', 'medium', '2026-10-20T09:00:00Z')],
    [resposta('b', 'claude-sonnet-6', 'medium', '2026-10-26T09:00:00Z')],
    [resposta('c', 'claude-haiku-5-5', 'low', '2026-10-26T09:00:00Z')],
    [resposta('d', 'outro-modelo-1', '', '2026-10-21T09:00:00Z'), resposta('d', 'outro-modelo-2', '', '2026-10-25T09:00:00Z')]
  ]);
  const trocas = efetivo.trocas(efetivo.medir(dir, { agora: AGORA }));
  assert.deepStrictEqual(trocas, [
    { apelido: 'sonnet', de: 'claude-sonnet-5-5', para: 'claude-sonnet-6', desde: '2026-10-26T09:00:00.000Z' }
  ], 'id sem apelido conhecido nao entra');
});

test('efetivo: dois ids do mesmo apelido que seguem respondendo juntos nao sao troca', (t) => {
  const dir = projeto(t, [
    [resposta('preso', 'claude-sonnet-5', 'medium', '2026-10-20T09:00:00Z'), resposta('preso', 'claude-sonnet-5', 'medium', '2026-10-26T09:00:00Z')],
    [resposta('livre', 'claude-sonnet-5-5', 'medium', '2026-10-22T09:00:00Z')]
  ]);
  assert.deepStrictEqual(efetivo.trocas(efetivo.medir(dir, { agora: AGORA })), []);
});

test('efetivo: a auditoria traz o efetivo da pasta da transcricao, e diz "nao medido" sem ela', (t) => {
  const dir = projeto(t, [[resposta('busca-rapida', 'claude-haiku-5-5', 'low', new Date().toISOString())],
    [resposta('sworn:inspector', 'claude-sonnet-5-5', 'medium', new Date().toISOString())]]);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn efetivo-cwd-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const projetoJson = { agentes: { degraus: [{ agente: 'busca-rapida', apelido: 'haiku', esforco: 'low' }] } };
  // a forma que o auditar.js passa: o que o injetado.localizar devolve
  const alvo = { caminho: path.join(dir, 's1.jsonl') };
  const r = auditoria.auditar(cwd, projetoJson, { transcricao: alvo, efetivo: true });
  assert.strictEqual(r.efetivo.medido, true);
  assert.deepStrictEqual(r.efetivo.tabela.map((l) => [l.agente, l.confere]), [['busca-rapida', true]]);
  assert.deepStrictEqual(r.efetivo.trocas, []);
  assert.deepStrictEqual(r.efetivo.foraDaTabela,
    [{ agente: 'sworn:inspector', modelo: 'claude-sonnet-5-5', esforco: 'medium', respostas: 1 }]);
  const sem = auditoria.auditar(cwd, projetoJson, { efetivo: true });
  assert.strictEqual(sem.efetivo.medido, false);
  assert.match(sem.efetivo.motivo, /transcricao/);
  const naoAchada = { causa: 'sem-sessao', motivo: 'nao medido: sem --transcricao e sem CLAUDE_CODE_SESSION_ID no ambiente' };
  assert.strictEqual(auditoria.auditar(cwd, projetoJson, { transcricao: naoAchada, efetivo: true }).efetivo.motivo,
    naoAchada.motivo, 'o motivo do localizar passa adiante');
  // D706: a rodada automatica (abertura.js, SessionStart com 15 s) chama o auditar sem pedir; num projeto real a medida
  // levou 23,4 s em 4.732 arquivos. Sem o pedido, nada e lido.
  const automatica = auditoria.auditar(cwd, projetoJson, { transcricao: alvo });
  assert.strictEqual(automatica.efetivo.medido, false);
  assert.match(automatica.efetivo.motivo, /sworn:audit/);
});

test('efetivo: o auditar.js (o /sworn:audit) pede o efetivo', (t) => {
  const dir = projeto(t, [[resposta('busca-rapida', 'claude-haiku-5-5', 'low', new Date().toISOString())]]);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn efetivo-cli-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const r = require('node:child_process').spawnSync(process.execPath,
    [path.join(__dirname, '..', 'scripts', 'auditar.js'), '--transcricao', path.join(dir, 's1.jsonl')], { cwd: cwd, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const e = JSON.parse(r.stdout).efetivo;
  assert.strictEqual(e.medido, true, e.motivo);
  assert.strictEqual(e.arquivos, 1);
});

test('efetivo: a skill do audit apresenta o item 1d a partir da chave efetivo', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'skills', 'audit', 'SKILL.md'), 'utf8');
  const i = skill.indexOf('1d.');
  assert.ok(i !== -1, 'falta o item 1d no Passo 2');
  const fim = skill.indexOf('\n2. ', i);
  assert.ok(fim !== -1, 'o item 1d nao termina no item 2 do Passo 2');
  const item = skill.slice(i, fim);
  for (const chave of ['`efetivo`', '`trocas`', '`tabela`', '`foraDaTabela`', '`ilegiveis`']) {
    assert.ok(item.indexOf(chave) !== -1, 'o item 1d nao cita ' + chave);
  }
  assert.ok(/not measured/i.test(item), 'o item 1d nao diz o que fazer quando nao mediu');
  assert.ok(item.indexOf('.claude/sworn/projeto.json') !== -1, 'o aviso de troca nao diz onde se muda o degrau');
  assert.ok(skill.slice(0, i).indexOf('(item 1d)') !== -1, 'a abertura da skill nao aponta o item 1d');
});
