'use strict';
// Plano volta-resumo (D586, mock D588): ao segurar a volta a chat parado, o gancho grava um resumo mecanico do
// registro do chat (o transcript), sem o Claude: os ultimos pedidos do dono, as ultimas respostas, os arquivos
// mexidos, onde parou. O chat novo le o resumo em vez de pedir o handoff no chat parado (que regrava tudo).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const retomar = require('../scripts/lib/retomar.js');

const MIN = 60 * 1000;
const AGORA = Date.parse('2026-10-22T14:35:00.000Z');
const ID = 'd731fc49-6d1e-4a6b-9a55-0123456789ab';

function pasta() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-retomar-')); }
function registro(linhas) {
  const dir = pasta();
  const f = path.join(dir, 's.jsonl');
  fs.writeFileSync(f, linhas.map(function (l) { return typeof l === 'string' ? l : JSON.stringify(l); }).join('\n') + '\n');
  return { dir: dir, f: f, fim: function () { fs.rmSync(dir, { recursive: true, force: true }); } };
}
function quando(min) { return new Date(AGORA - min * MIN).toISOString(); }
function pedido(min, texto, extra) {
  return Object.assign({ type: 'user', timestamp: quando(min), origin: { kind: 'human' },
    message: { role: 'user', content: texto } }, extra || {});
}
function naFila(min, texto, origem, extra) {
  return { type: 'attachment', timestamp: quando(min), attachment: Object.assign({ type: 'queued_command',
    prompt: texto, commandMode: 'prompt', origin: origem === undefined ? { kind: 'human' } : origem }, extra || {}) };
}
function resposta(min, texto, extra) {
  return Object.assign({ type: 'assistant', timestamp: quando(min),
    message: { role: 'assistant', content: [{ type: 'text', text: texto }] } }, extra || {});
}
function ferramenta(min, nome, entrada) {
  return { type: 'assistant', timestamp: quando(min),
    message: { role: 'assistant', content: [{ type: 'tool_use', name: nome, input: entrada }] } };
}
function resultado(min) {
  return { type: 'user', timestamp: quando(min), message: { role: 'user',
    content: [{ type: 'tool_result', content: 'saida da ferramenta' }] } };
}
function hora(min) {
  const d = new Date(AGORA - min * MIN);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

test('volta-resumo: lerRegistro junta os pedidos do dono, do mais novo, e tira o que o harness injeta', () => {
  const r = registro([
    pedido(90, 'primeiro pedido'),
    pedido(80, [{ type: 'text', text: 'segue com a T4' }, { type: 'text', text: '<system-reminder>\nlembrete\n</system-reminder>' }]),
    pedido(70, 'injetado pelo harness', { isMeta: true }),
    pedido(65, 'de subagente', { isSidechain: true }),
    resultado(60),
    pedido(55, '<task-notification><summary>x</summary></task-notification>', { origin: { kind: 'task-notification' } }),
    naFila(50, 'qual o numero de inspetores?'),
    naFila(48, 'mensagem de outro agente', { kind: 'peer', from: 'a1' }),
    naFila(47, 'aviso de tarefa', null, { commandMode: 'task-notification' }),
    pedido(45, 'veja isto <browser_instruction>\nfaca X\n</browser_instruction> e <ide_selection>codigo</ide_selection>ok'),
    pedido(40, '<pasted_content id="ab12">\nSworn (raiz). Frente x.\n</pasted_content id="ab12">'),
    pedido(35, '<system-reminder>so lembrete</system-reminder>'),
    pedido(30, 'Eu dou o ok'),
    'linha torta {'
  ]);
  try {
    const reg = retomar.lerRegistro(r.f);
    assert.deepStrictEqual(reg.pedidos.map(function (p) { return p.texto; }), [
      'Eu dou o ok',
      'Sworn (raiz). Frente x.',
      'veja isto e ok',
      'qual o numero de inspetores?',
      'segue com a T4'
    ]);
    assert.strictEqual(reg.pedidos[0].horario, AGORA - 30 * MIN);
  } finally { r.fim(); }
});

test('volta-resumo: o resumo da compactacao nao e pedido do dono (A5-01, A9-08)', () => {
  const r = registro([
    pedido(40, 'pedido antes de compactar'),
    pedido(30, 'This session is being continued from a previous conversation that ran out of context.',
      { isCompactSummary: true, isVisibleInTranscriptOnly: true, origin: undefined }),
    pedido(20, 'pedido depois de compactar')
  ]);
  try {
    assert.deepStrictEqual(retomar.lerRegistro(r.f).pedidos.map(function (p) { return p.texto; }),
      ['pedido depois de compactar', 'pedido antes de compactar']);
  } finally { r.fim(); }
});

test('volta-resumo: o comando de barra conta como pedido, pelo nome e pelos argumentos', () => {
  const r = registro([pedido(10,
    '<command-message>handoff is running</command-message>\n<command-name>/sworn:handoff</command-name>\n<command-args>volta</command-args>')]);
  try {
    assert.deepStrictEqual(retomar.lerRegistro(r.f).pedidos.map(function (p) { return p.texto; }), ['/sworn:handoff volta']);
  } finally { r.fim(); }
});

test('volta-resumo: respostas = o ultimo texto de cada turno, 3 no maximo, do mais novo', () => {
  const r = registro([
    pedido(100, 'p1'), resposta(99, 'r1 final'),
    pedido(90, 'p2'), resposta(89, 'r2 meio'), ferramenta(88, 'Bash', { command: 'ls' }), resposta(87, 'r2 final'),
    pedido(80, 'p3'), resposta(79, 'r3 final'),
    pedido(70, 'p4'), resposta(69, 'r4 meio'), resposta(68, 'r4 final'),
    resposta(67, 'de subagente', { isSidechain: true })
  ]);
  try {
    const reg = retomar.lerRegistro(r.f);
    assert.deepStrictEqual(reg.respostas.map(function (p) { return p.texto; }), ['r4 final', 'r3 final', 'r2 final']);
    assert.strictEqual(reg.respostas[0].horario, AGORA - 68 * MIN);
  } finally { r.fim(); }
});

test('volta-resumo: arquivos mexidos (Edit/Write/NotebookEdit), unicos, do mais novo, e o ultimo handoff do modelo', () => {
  const linhas = [pedido(200, 'p')];
  for (let i = 0; i < 25; i++) linhas.push(ferramenta(190 - i, 'Edit', { file_path: '/proj/a' + i + '.js' }));
  linhas.push(ferramenta(150, 'Write', { file_path: '/proj/.claude/sworn/handoff/2026-10-22-frente.md' }));
  linhas.push(ferramenta(140, 'Write', { file_path: '/proj/.claude/sworn/handoff/2026-10-22-retomar-aaaaaaaa.md' }));
  linhas.push(ferramenta(130, 'NotebookEdit', { notebook_path: '/proj/n.ipynb' }));
  linhas.push(ferramenta(120, 'Edit', { file_path: '/proj/a24.js' }));
  linhas.push(ferramenta(110, 'Read', { file_path: '/proj/lido.js' }));
  const r = registro(linhas);
  try {
    const reg = retomar.lerRegistro(r.f);
    assert.strictEqual(reg.arquivos.length, 20);
    // a24.js foi mexido duas vezes: entra uma
    assert.strictEqual(new Set(reg.arquivos).size, 20);
    assert.deepStrictEqual(reg.arquivos.slice(0, 4), ['/proj/a24.js', '/proj/n.ipynb',
      '/proj/.claude/sworn/handoff/2026-10-22-retomar-aaaaaaaa.md', '/proj/.claude/sworn/handoff/2026-10-22-frente.md']);
    assert.ok(reg.arquivos.indexOf('/proj/lido.js') === -1);
    // o resumo do proprio sworn (retomar-) nao e handoff do modelo
    assert.deepStrictEqual(reg.handoff, { caminho: '/proj/.claude/sworn/handoff/2026-10-22-frente.md', horario: AGORA - 150 * MIN });
  } finally { r.fim(); }
});

test('volta-resumo: lerRegistro le a cauda em blocos sem partir caractere acentuado e para no limite', () => {
  const linhas = [];
  for (let i = 0; i < 40; i++) linhas.push(pedido(400 - i, 'pedido ' + i + ' com ação e ênfase ' + 'x'.repeat(50)));
  const r = registro(linhas);
  try {
    // bloco pequeno: a fronteira cai no meio de linhas e de caracteres de 2 bytes
    const reg = retomar.lerRegistro(r.f, { bloco: 97 });
    assert.deepStrictEqual(reg.pedidos.map(function (p) { return p.texto.slice(0, 9); }),
      ['pedido 39', 'pedido 38', 'pedido 37', 'pedido 36', 'pedido 35']);
    assert.ok(/ação e ênfase/.test(reg.pedidos[0].texto));
    // limite de leitura: so a cauda; o que nao coube fica de fora, sem erro
    // (bloco maior que o limite: le so os 200 bytes do fim, menos que uma linha)
    const curto = retomar.lerRegistro(r.f, { bloco: 1000, limite: 200 });
    assert.strictEqual(curto.pedidos.length, 0);
  } finally { r.fim(); }
});

test('volta-resumo: lerRegistro sem leitura = null; sem pedido = listas vazias', () => {
  assert.strictEqual(retomar.lerRegistro(null), null);
  assert.strictEqual(retomar.lerRegistro(path.join(os.tmpdir(), 'nao-existe-sworn-retomar.jsonl')), null);
  const r = registro(['', 'torta {', resultado(5)]);
  try {
    assert.deepStrictEqual(retomar.lerRegistro(r.f), { pedidos: [], respostas: [], arquivos: [], handoff: null });
  } finally { r.fim(); }
});

function dados(extra) {
  return Object.assign({
    sessao: ID, agora: AGORA, raiz: '/proj',
    volta: { parado: 76 * MIN, contexto: 461234, modelo: 'claude-opus-5-5' },
    registro: {
      pedidos: [{ horario: AGORA - 30 * MIN, texto: 'Eu dou o ok' }, { horario: AGORA - 40 * MIN, texto: 'qual o numero?' }],
      respostas: [{ horario: AGORA - 29 * MIN, texto: 'D583 gravada.' }],
      arquivos: ['/proj/scripts/referencia.js', '/fora/outro.md'],
      handoff: { caminho: '/proj/.claude/sworn/handoff/2026-10-22-s173.md', horario: AGORA - 31 * MIN }
    },
    frente: 'sworn-pendencias', objetivo: 'plano do REA, Tarefa 3.',
    plano: 'plano rea · 3 de 5 tarefas',
    git: { ramo: 'master', head: '1a2b3c4', modificados: ['M docs/decisoes.md'] }
  }, extra || {});
}

test('volta-resumo: montar segue o mock (D588), com o texto do sworn em ASCII', () => {
  const t = retomar.montar(dados());
  const linhas = t.split('\n');
  assert.strictEqual(linhas[0], '# Resumo para retomar o chat d731fc49');
  assert.ok(t.indexOf('(parado 1 h 16 min; 461 mil tokens; Opus 5.5)') !== -1);
  assert.ok(t.indexOf('nao e o handoff do modelo') !== -1);
  for (const secao of ['## Onde parou', '## Seus ultimos pedidos (do mais novo)', '## Ultimas respostas do Claude (do mais novo)',
    '## Arquivos mexidos (os ultimos)', '## Para o chat novo']) {
    assert.ok(linhas.indexOf(secao) !== -1, secao);
  }
  assert.ok(linhas.indexOf('Frente: sworn-pendencias. Objetivo: plano do REA, Tarefa 3.') !== -1);
  assert.ok(linhas.indexOf('Plano: plano rea · 3 de 5 tarefas') !== -1);
  assert.ok(linhas.indexOf('Ultimo handoff do modelo: .claude/sworn/handoff/2026-10-22-s173.md (' + hora(31) + ').') !== -1);
  assert.ok(linhas.indexOf('Raiz: master 1a2b3c4; modificados: M docs/decisoes.md.') !== -1);
  assert.ok(linhas.indexOf('1. (' + hora(30) + ') Eu dou o ok') !== -1);
  assert.ok(linhas.indexOf('2. (' + hora(40) + ') qual o numero?') !== -1);
  assert.ok(linhas.indexOf('1. (' + hora(29) + ') D583 gravada.') !== -1);
  // dentro da raiz sai relativo; fora, como veio
  assert.ok(linhas.indexOf('scripts/referencia.js') !== -1);
  assert.ok(linhas.indexOf('/fora/outro.md') !== -1);
  assert.ok(linhas.indexOf('Se precisar de handoff completo, rode /sworn:handoff.') !== -1);
  // o texto fixo do sworn e ASCII (D532); so o que veio do chat pode ter acento
  const fixo = retomar.montar(dados({ plano: 'plano x', registro: { pedidos: [{ horario: AGORA, texto: 'ok' }],
    respostas: [], arquivos: [], handoff: null } }));
  assert.ok(/^[\x00-\x7E]*$/.test(fixo), 'texto fixo fora de ASCII');
});

test('volta-resumo: montar corta pedido em 600 e resposta em 800, mascara segredo e respeita o teto de 10 KB', () => {
  const longo = 'a'.repeat(5000);
  const chave = 'sk-' + 'ant-api03-' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4';
  const t = retomar.montar(dados({ registro: {
    pedidos: [1, 2, 3, 4, 5].map(function (i) { return { horario: AGORA - i * MIN, texto: longo + ' ' + chave }; }),
    respostas: [1, 2, 3].map(function (i) { return { horario: AGORA - i * MIN, texto: 'b'.repeat(5000) }; }),
    arquivos: Array.from({ length: 20 }, function (_, i) { return '/proj/' + 'c'.repeat(300) + i; }),
    handoff: null
  } }));
  // acima do teto saem os arquivos mais velhos, nao o fim do resumo
  assert.ok(t.indexOf('Se precisar de handoff completo, rode /sworn:handoff.') !== -1);
  assert.ok(t.indexOf('c'.repeat(300) + '0') !== -1);
  assert.ok(t.indexOf('c'.repeat(300) + '19') === -1);
  const p1 = t.split('\n').filter(function (l) { return /^1\. \(\d\d:\d\d\) a/.test(l); })[0];
  assert.strictEqual(p1.length, '1. (00:00) '.length + 600);
  assert.ok(/\.\.\.$/.test(p1));
  const r1 = t.split('\n').filter(function (l) { return /^1\. \(\d\d:\d\d\) b/.test(l); })[0];
  assert.strictEqual(r1.length, '1. (00:00) '.length + 800);
  assert.ok(Buffer.byteLength(t, 'utf8') <= 10 * 1024);
  const comChave = retomar.montar(dados({ registro: { pedidos: [{ horario: AGORA, texto: 'use ' + chave + ' aqui' }],
    respostas: [], arquivos: [], handoff: null } }));
  assert.ok(comChave.indexOf(chave) === -1);
  assert.ok(comChave.indexOf('use [segredo omitido] aqui') !== -1);
});

test('volta-resumo: montar sem frente, plano, handoff ou git diz que nao achou, sem quebrar', () => {
  const t = retomar.montar(dados({ frente: null, objetivo: '', plano: '', git: null,
    registro: { pedidos: [{ horario: AGORA, texto: 'ok' }], respostas: [], arquivos: [], handoff: null } }));
  const linhas = t.split('\n');
  assert.ok(linhas.indexOf('Frente: nenhuma vinculada a este chat.') !== -1);
  assert.ok(linhas.indexOf('Plano: nenhum lido.') !== -1);
  assert.ok(linhas.indexOf('Ultimo handoff do modelo: nenhum neste chat.') !== -1);
  assert.ok(linhas.indexOf('Raiz: git nao lido.') !== -1);
  assert.ok(linhas.indexOf('(nenhuma resposta de texto no trecho lido)') !== -1);
  assert.ok(linhas.indexOf('(nenhum arquivo mexido no trecho lido)') !== -1);
});

test('volta-resumo: gravar cria a pasta handoff/ e o mesmo chat no mesmo dia nao duplica o arquivo', () => {
  const raiz = pasta();
  try {
    const rel = retomar.gravar(raiz, ID, AGORA, 'um');
    const d = new Date(AGORA);
    const dia = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    assert.strictEqual(rel, '.claude/sworn/handoff/' + dia + '-retomar-d731fc49.md');
    assert.strictEqual(retomar.gravar(raiz, ID, AGORA + MIN, 'dois'), rel);
    const dir = path.join(raiz, '.claude', 'sworn', 'handoff');
    assert.deepStrictEqual(fs.readdirSync(dir), [dia + '-retomar-d731fc49.md']);
    assert.strictEqual(fs.readFileSync(path.join(dir, dia + '-retomar-d731fc49.md'), 'utf8'), 'dois');
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('volta-resumo: o id da sessao que nao e nome seguro nao vira caminho', () => {
  const raiz = pasta();
  try {
    assert.throws(function () { retomar.gravar(raiz, '../../fora', AGORA, 'x'); });
    assert.throws(function () { retomar.gravar(raiz, '', AGORA, 'x'); });
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('volta-resumo: resumir grava e devolve o caminho; handoff em dia = gravado depois do ultimo pedido', () => {
  const raiz = pasta();
  const ho = path.join(raiz, '.claude', 'sworn', 'handoff', '2026-10-22-frente.md');
  const r = registro([pedido(40, 'faz o handoff'), ferramenta(35, 'Write', { file_path: ho }), resposta(34, 'Handoff gravado.')]);
  try {
    const s = retomar.resumir({ raiz: raiz, sessao: ID, transcript: r.f, frente: null, agora: AGORA,
      volta: { parado: 76 * MIN, contexto: 461234, modelo: 'claude-opus-5-5' } });
    assert.ok(s && /^\.claude\/sworn\/handoff\/\d{4}-\d\d-\d\d-retomar-d731fc49\.md$/.test(s.caminho));
    assert.deepStrictEqual(s.handoff, { caminho: '.claude/sworn/handoff/2026-10-22-frente.md', emDia: true });
    assert.strictEqual(s.chat, 'd731fc49');
    const texto = fs.readFileSync(path.join(raiz, s.caminho), 'utf8');
    assert.ok(texto.indexOf('faz o handoff') !== -1);
    // pedido depois do handoff: o handoff ficou para tras
    const r2 = registro([pedido(40, 'faz o handoff'), ferramenta(35, 'Write', { file_path: ho }), pedido(20, 'agora a T4')]);
    try {
      const s2 = retomar.resumir({ raiz: raiz, sessao: ID, transcript: r2.f, frente: null, agora: AGORA,
        volta: { parado: 76 * MIN, contexto: 461234, modelo: 'claude-opus-5-5' } });
      assert.strictEqual(s2.handoff.emDia, false);
    } finally { r2.fim(); }
  } finally { r.fim(); fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('volta-resumo: resumir sem registro legivel ou sem pedido devolve null e nao grava nada', () => {
  const raiz = pasta();
  const vazio = registro(['']);
  const semPedido = registro([resposta(10, 'so resposta')]);
  try {
    const base = { raiz: raiz, sessao: ID, frente: null, agora: AGORA, volta: { parado: 76 * MIN, contexto: 461234, modelo: null } };
    assert.strictEqual(retomar.resumir(Object.assign({}, base, { transcript: path.join(raiz, 'nao-existe.jsonl') })), null);
    assert.strictEqual(retomar.resumir(Object.assign({}, base, { transcript: vazio.f })), null);
    assert.strictEqual(retomar.resumir(Object.assign({}, base, { transcript: semPedido.f })), null);
    assert.strictEqual(fs.existsSync(path.join(raiz, '.claude')), false);
  } finally { vazio.fim(); semPedido.fim(); fs.rmSync(raiz, { recursive: true, force: true }); }
});

// Colheita 10-20, item 13 (D674): o handoff tem dono. O chat que o le marca a posse; outro chat que le o mesmo handoff
// em menos de 24 h e avisado, e a posse passa a ele (o aviso vai para quem chegou por ultimo, nos dois sentidos).
test('item 13: reclamar marca o dono do handoff e avisa a outra sessao em menos de 24 h', () => {
  const raiz = pasta();
  try {
    const h = path.join(raiz, 'planos', '2026-10-25-x-handoff.md');
    assert.strictEqual(retomar.reclamar(raiz, h, 'aaaaaaaa-1', AGORA), null, 'sem .claude/sworn/ nao grava');
    assert.strictEqual(fs.existsSync(path.join(raiz, '.claude')), false);
    fs.mkdirSync(path.join(raiz, '.claude', 'sworn'), { recursive: true });
    assert.strictEqual(retomar.reclamar(raiz, h, 'aaaaaaaa-1', AGORA), null, '1a leitura: so marca');
    assert.strictEqual(retomar.reclamar(raiz, h, 'aaaaaaaa-1', AGORA + 5 * MIN), null, 'a mesma sessao relendo');
    const aviso = retomar.reclamar(raiz, h, 'bbbbbbbb-2', AGORA + 30 * MIN);
    assert.ok(aviso, 'outra sessao em 30 min tinha de ser avisada');
    assert.ok(aviso.includes('planos/2026-10-25-x-handoff.md'), aviso);
    assert.ok(aviso.includes('aaaaaaaa'), aviso);
    assert.ok(/^[\x20-\x7E\n]+$/.test(aviso), 'aviso fora de ASCII: ' + aviso);
    const donos = JSON.parse(fs.readFileSync(path.join(raiz, '.claude', 'sworn', 'handoff-donos.json'), 'utf8'));
    assert.strictEqual(donos['planos/2026-10-25-x-handoff.md'].sessao, 'bbbbbbbb', 'a posse passou');
    assert.ok(retomar.reclamar(raiz, h, 'aaaaaaaa-1', AGORA + 40 * MIN), 'a 1a, voltando, e avisada');
    assert.strictEqual(retomar.reclamar(raiz, h, 'cccccccc-3', AGORA + 40 * MIN + 25 * 60 * MIN), null, 'posse velha');
    for (const torto of ['[1,', '5', '[1]', 'null']) {
      fs.writeFileSync(path.join(raiz, '.claude', 'sworn', 'handoff-donos.json'), torto);
      assert.strictEqual(retomar.reclamar(raiz, h, 'dddddddd-4', AGORA), null, 'arquivo torto recomeca sem lancar: ' + torto);
      const lido = JSON.parse(fs.readFileSync(path.join(raiz, '.claude', 'sworn', 'handoff-donos.json'), 'utf8'));
      assert.strictEqual(lido['planos/2026-10-25-x-handoff.md'].sessao, 'dddddddd', torto);
    }
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('item 13: o marcar-trabalho avisa no Read de handoff pego por outra sessao; subagente e outro arquivo nao', () => {
  const { spawnSync } = require('node:child_process');
  const raiz = pasta();
  const sessoes = path.join(raiz, 'sessoes');
  fs.mkdirSync(path.join(raiz, '.claude', 'sworn'), { recursive: true });
  function ler(id, arquivo, extra) {
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'marcar-trabalho.js')], {
      cwd: raiz, encoding: 'utf8',
      input: JSON.stringify(Object.assign({ session_id: id, cwd: raiz, hook_event_name: 'PostToolUse', tool_name: 'Read',
        tool_input: { file_path: arquivo } }, extra || {})),
      env: Object.assign({}, process.env, { SWORN_TMP: sessoes })
    });
    assert.strictEqual(r.status, 0, r.stderr);
    return r.stdout.trim() ? JSON.parse(r.stdout) : null;
  }
  try {
    const h = path.join(raiz, '.claude', 'sworn', 'handoff', '2026-10-25-frete.md');
    assert.strictEqual(ler('s1-aaaaaa', h), null);
    assert.strictEqual(ler('s2-bbbbbb', h, { agent_id: 'sub1' }), null, 'subagente nao pega o handoff');
    assert.strictEqual(ler('s1-aaaaaa', path.join(raiz, 'README.md')), null);
    assert.strictEqual(ler('s2-bbbbbb', path.join(raiz, 'README.md')), null, 'arquivo comum nao tem dono');
    const saida = ler('s2-bbbbbb', h);
    assert.ok(saida && saida.hookSpecificOutput, JSON.stringify(saida));
    assert.strictEqual(saida.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.ok(saida.hookSpecificOutput.additionalContext.includes('s1-aaaaa'), JSON.stringify(saida));
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});
