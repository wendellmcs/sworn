'use strict';
// H12c (D914): o briefing que pede ao subagente um arquivo com caminho explicito e o subagente que termina sem ele.
// O conferir-entrega.js le o briefing no SubagentStop e guarda o que falta na sessao; o portao-fecho.js cobra uma vez
// no fecho do turno, o lugar em que o texto chega a quem despachou.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const entrega = require('../scripts/lib/entrega-pedida.js');

// ---------------------------------------------------------------- o pedido no briefing

test('entrega: o pedido e o verbo no comeco da frase, da linha ou do item, com o caminho entre crases', () => {
  // as formas medidas nos briefings deste projeto (s376)
  assert.deepStrictEqual(entrega.caminhosPedidos('Leia o README.\n4. Grave o resultado em `/c/proj/h10/a.md` com as secoes:'),
    ['/c/proj/h10/a.md']);
  assert.deepStrictEqual(entrega.caminhosPedidos('Conte os testes. Grave com Write o arquivo `C:\\proj\\saida.json`.'),
    ['C:\\proj\\saida.json']);
  assert.deepStrictEqual(entrega.caminhosPedidos('Write the report to `out/relatorio.md`.\n- Save it as `b.txt`'),
    ['out/relatorio.md', 'b.txt']);
  assert.deepStrictEqual(entrega.caminhosPedidos('Grave em `a.md`. Grave em `a.md` de novo.'), ['a.md'],
    'o mesmo caminho conta uma vez');
});

test('entrega: o que nao e pedido de arquivo fica de fora', () => {
  // o briefing do inspetor cita arquivos para ler, nunca para gravar
  assert.deepStrictEqual(entrega.caminhosPedidos('Read only these two files: `/c/proj/A.txt` and `/c/proj/B.txt`.\n' +
    'Verdicts folder: `/c/proj/vereditos`. Don\'t open it.'), []);
  assert.deepStrictEqual(entrega.caminhosPedidos('Don\'t create `x.md` here.'), [], 'a negacao nao e pedido');
  assert.deepStrictEqual(entrega.caminhosPedidos('O script grava em `y.json` sozinho.'), [], 'no meio da frase nao vale');
  assert.deepStrictEqual(entrega.caminhosPedidos('Grave em `<caminho>.md`. Crie `*.json`.'), [], 'molde e curinga nao valem');
  assert.deepStrictEqual(entrega.caminhosPedidos('Grave em `~/notas.md`.'), [], 'a pasta pessoal nao se expande');
  assert.deepStrictEqual(entrega.caminhosPedidos('Grave o resultado.'), [], 'sem caminho entre crases nao vale');
  assert.deepStrictEqual(entrega.caminhosPedidos('Grave em ``.'), [], 'crases vazias nao sao caminho');
  // o caminho de rede: conferir que existe abriria conexao SMB com o host
  assert.deepStrictEqual(entrega.caminhosPedidos('Grave em `\\\\host\\share\\x.md`. Crie `//host/share/y.md`.'), []);
  assert.deepStrictEqual(entrega.caminhosPedidos('Grave em `/c/proj/z.md`.'), ['/c/proj/z.md'], 'uma barra so e caminho');
  // endereco com esquema nao e arquivo do disco; a letra do drive (uma so) segue caminho
  assert.deepStrictEqual(entrega.caminhosPedidos('Salve `https://exemplo.com/pagina.html`. Grave `file:///c/x.md`.'), []);
  assert.deepStrictEqual(entrega.caminhosPedidos('Grave em `C:/proj/w.md`.'), ['C:/proj/w.md'], 'o drive e caminho');
  assert.deepStrictEqual(entrega.caminhosPedidos(''), []);
  assert.deepStrictEqual(entrega.caminhosPedidos(undefined), []);
  assert.deepStrictEqual(entrega.caminhosPedidos({}), []);
});

test('entrega: o briefing enorme se le em tempo linear (o gancho tem 10 s)', () => {
  for (const texto of ['Grave ' + ' '.repeat(200000) + 'x', 'Grave ' + 'a'.repeat(200000) + '`',
    ('. Grave `' + 'b'.repeat(50)).repeat(5000)]) {
    const inicio = Date.now();
    entrega.caminhosPedidos(texto);
    const ms = Date.now() - inicio;
    assert.ok(ms < 1000, 'levou ' + ms + ' ms em ' + texto.length + ' caracteres');
  }
});

test('entrega: o aviso conta os agentes e da o nome em ASCII', () => {
  const um = entrega.motivoDoFecho({ entregaFaltando: entrega.anotarFaltando({}, '', ['a.md']) });
  assert.match(um, /^sworn - um subagente terminou sem gravar o que o briefing pediu\.\n/);
  assert.match(um, /O agente "sem tipo" nao gravou:\n {2}- a\.md\n/, 'sem tipo, o nome fica "sem tipo"');
  const s = { entregaFaltando: [{ agente: 'revis\u00e3o:\u00e1gil "x"\n', caminhos: ['b.md'] },
    { agente: '\u00e7\u00e3', caminhos: ['c.md'] }, { agente: '!!', caminhos: ['d.md'] }, { agente: 'vazio', caminhos: [] }] };
  const varios = entrega.motivoDoFecho(s);
  assert.match(varios, /^sworn - 3 subagentes terminaram sem gravar o que o briefing pediu\.\n/, 'quem gravou tudo nao conta');
  assert.match(varios, /O agente "revisao:agil x" nao gravou:/, 'o acento cai sem levar a letra; aspas e quebra somem');
  assert.match(varios, /O agente "ca" nao gravou:/);
  assert.match(varios, /O agente "sem tipo" nao gravou:\n {2}- d\.md/, 'o nome que some todo vira "sem tipo"');
  assert.ok(!/vazio/.test(varios));
  assert.ok(/^[\x0a\x20-\x7e]*$/.test(varios), 'texto ao modelo em ASCII');
  assert.strictEqual(entrega.motivoDoFecho({}), null);
  assert.strictEqual(entrega.motivoDoFecho({ entregaFaltando: [] }), null);
});

test('entrega: anotarFaltando guarda os ultimos 10, cada um com ate 10 caminhos', () => {
  let s = {};
  for (let i = 0; i < 12; i++) s.entregaFaltando = entrega.anotarFaltando(s, 't' + i, ['x' + i + '.md']);
  assert.strictEqual(s.entregaFaltando.length, 10);
  assert.strictEqual(s.entregaFaltando[0].agente, 't2');
  const muitos = Array.from({ length: 15 }, (_, i) => i + '.md');
  assert.strictEqual(entrega.anotarFaltando({}, 't', muitos)[0].caminhos.length, 10);
});

// ---------------------------------------------------------------- ponta a ponta

function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-entrega-')); }

function rodar(script, dir, entrada) {
  return spawnSync(process.execPath, [path.join(RAIZ, 'scripts', script)], {
    cwd: dir, encoding: 'utf8', input: JSON.stringify(entrada), timeout: 60000,
    env: Object.assign({}, process.env, { SWORN_TMP: path.join(dir, '_sessoes') })
  });
}

/** O estado da sessao; {} so quando o arquivo nao existe (o JSON quebrado reprova). `entregaFaltando` [] e cobrado;
 *  undefined e nunca anotado. */
function sessao(dir, id) {
  let texto;
  try { texto = fs.readFileSync(path.join(dir, '_sessoes', 'sworn', id + '.json'), 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
  return JSON.parse(texto);
}

/** A transcricao do subagente como o Claude Code a grava: o briefing na 1a linha, depois as respostas. */
function transcricao(dir, briefing) {
  const arquivo = path.join(dir, 'agent-a1.jsonl');
  fs.writeFileSync(arquivo, [
    { parentUuid: null, isSidechain: true, agentId: 'a1', type: 'user', message: { role: 'user', content: briefing } },
    { parentUuid: 'x', isSidechain: true, agentId: 'a1', type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Feito: grave em `nada.md`.' }] } }
  ].map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  return arquivo;
}

function fim(dir, id, arquivo) {
  return rodar('conferir-entrega.js', dir, { session_id: id, cwd: dir, hook_event_name: 'SubagentStop',
    agent_id: 'a1', agent_type: 'general-purpose', agent_transcript_path: arquivo, last_assistant_message: 'Pronto.' });
}

function stop(dir, id, extra) {
  return rodar('portao-fecho.js', dir, Object.assign({ session_id: id, cwd: dir, hook_event_name: 'Stop',
    last_assistant_message: 'O agente terminou.' }, extra));
}

test('conferir-entrega.js + portao-fecho.js: o arquivo pedido que nao existe vira aviso no fecho, uma vez', () => {
  const dir = temp();
  try {
    const pedido = path.join(dir, 'saida', 'relatorio.md');
    const r = fim(dir, 'g1', transcricao(dir, 'Leia tudo.\n3. Grave o resultado em `' + pedido + '` com as secoes:'));
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout, '', 'o fim do subagente nunca decide (block faria o subagente continuar)');

    const s1 = stop(dir, 'g1');
    assert.strictEqual(s1.status, 0, s1.stderr);
    const saida = JSON.parse(s1.stdout);
    assert.strictEqual(saida.decision, 'block', s1.stdout);
    assert.ok(saida.reason.includes(pedido), saida.reason);
    assert.match(saida.reason, /"general-purpose"/);
    assert.ok(!saida.reason.includes('nada.md'), 'so o briefing conta, nao a resposta do subagente');
    assert.deepStrictEqual(sessao(dir, 'g1').entregaFaltando, [], 'cobrado uma vez');

    // o segundo Stop, mesmo sem stop_hook_active, nao cobra de novo: a 1a cobranca limpou a lista da sessao
    const s2 = stop(dir, 'g1');
    assert.strictEqual(s2.status, 0, s2.stderr);
    assert.strictEqual(s2.stdout, '', 'o segundo Stop libera');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('conferir-entrega.js: o arquivo pedido que existe passa calado, e o fecho tambem', () => {
  const dir = temp();
  try {
    fs.mkdirSync(path.join(dir, 'saida'));
    fs.writeFileSync(path.join(dir, 'saida', 'relatorio.md'), '# ok\n');
    // o caminho relativo vale contra o cwd do subagente
    const r = fim(dir, 'g2', transcricao(dir, 'Grave o resultado em `saida/relatorio.md`.'));
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout, '');
    assert.strictEqual(sessao(dir, 'g2').entregaFaltando, undefined, JSON.stringify(sessao(dir, 'g2')));
    const s1 = stop(dir, 'g2');
    assert.strictEqual(s1.status, 0, s1.stderr);
    assert.strictEqual(s1.stdout, '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('conferir-entrega.js: o caminho do Git Bash (/c/...) no Windows e o mesmo arquivo', { skip: process.platform !== 'win32' }, () => {
  const dir = temp();
  try {
    const real = path.join(dir, 'b.json');
    fs.writeFileSync(real, '{}');
    const bash = '/' + real[0].toLowerCase() + real.slice(2).replace(/\\/g, '/');
    const r = fim(dir, 'g3', transcricao(dir, 'Grave com Write o arquivo `' + bash + '`.'));
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout, '');
    assert.strictEqual(sessao(dir, 'g3').entregaFaltando, undefined, bash);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('entrega: o briefing em blocos de texto tambem se le', () => {
  const dir = temp();
  try {
    const arquivo = path.join(dir, 'agent-a2.jsonl');
    fs.writeFileSync(arquivo, JSON.stringify({ type: 'user', message: { role: 'user', content: [
      { type: 'text', text: 'Leia.' }, { type: 'image', source: {} },
      // so o bloco de texto e o briefing: outro bloco com campo `text` fica de fora
      { type: 'document', text: 'Grave em `doc.md`.' }, { type: 'text', text: 'Grave em `c.md`.' }] } }) + '\n');
    assert.deepStrictEqual(entrega.caminhosPedidos(entrega.briefingDaTranscricao(arquivo)), ['c.md']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('entrega: a linha do briefing maior que um bloco de leitura se le inteira, com acento no corte', () => {
  const dir = temp();
  try {
    const arquivo = path.join(dir, 'agent-a3.jsonl');
    // 700 KB de texto antes do pedido: passa de dois blocos de 256 KB, e o acento de 2 bytes cai em qualquer corte
    const briefing = 'ç'.repeat(350 * 1024) + '\nGrave em `fim.md`.';
    fs.writeFileSync(arquivo, JSON.stringify({ type: 'summary', text: 'x' }) + '\n' +
      JSON.stringify({ type: 'user', message: { role: 'user', content: briefing } }) + '\n');
    assert.strictEqual(entrega.briefingDaTranscricao(arquivo), briefing);
    // a ultima linha sem quebra no fim tambem vale
    fs.writeFileSync(arquivo, JSON.stringify({ type: 'user', message: { role: 'user', content: 'Grave em `u.md`.' } }));
    assert.deepStrictEqual(entrega.caminhosPedidos(entrega.briefingDaTranscricao(arquivo)), ['u.md']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('conferir-entrega.js: sem transcricao, transcricao ilegivel ou outro evento, passa calado', () => {
  const dir = temp();
  try {
    const quebrada = path.join(dir, 'quebrada.jsonl');
    fs.writeFileSync(quebrada, 'nao e json\n{"type":"user"\n');
    const vazia = path.join(dir, 'vazia.jsonl');
    fs.writeFileSync(vazia, '');
    assert.strictEqual(entrega.briefingDaTranscricao(quebrada), null);
    assert.strictEqual(entrega.briefingDaTranscricao(vazia), null);
    assert.strictEqual(entrega.briefingDaTranscricao(dir), null, 'uma pasta no lugar do arquivo');
    for (const entrada of [
      { session_id: 'g4', cwd: dir, hook_event_name: 'SubagentStop', agent_id: 'a1', agent_transcript_path: quebrada },
      { session_id: 'g4', cwd: dir, hook_event_name: 'SubagentStop', agent_id: 'a1', agent_transcript_path: vazia },
      { session_id: 'g4', cwd: dir, hook_event_name: 'SubagentStop', agent_id: 'a1' },
      { session_id: 'g4', cwd: dir, hook_event_name: 'SubagentStop', agent_id: 'a1',
        agent_transcript_path: path.join(dir, 'nao-existe.jsonl') },
      { session_id: 'g4', cwd: dir, hook_event_name: 'SubagentStart', agent_id: 'a1',
        agent_transcript_path: transcricao(dir, 'Grave em `falta.md`.') }
    ]) {
      const r = rodar('conferir-entrega.js', dir, entrada);
      assert.strictEqual(r.status, 0, r.stderr);
      assert.strictEqual(r.stdout, '', JSON.stringify(entrada));
    }
    assert.strictEqual(sessao(dir, 'g4').entregaFaltando, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
