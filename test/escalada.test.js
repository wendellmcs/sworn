'use strict';
// D694 (T3 da escada, D678): a escalada despachada. O agente de um degrau que para termina a resposta com
// `ESCALAR: <agente> - <motivo>`; o escalar.js guarda o pedido na sessao (SubagentStop e SubagentHandback) e da baixa
// quando o destino nasce (SubagentStart); o portao-fecho.js barra o fim do turno com pedido sem despacho.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const escalada = require('../scripts/lib/escalada.js');

const ESCADA = ['busca-rapida', 'tarefas-simples', 'desenvolvedor', 'arquiteto'];
const PROJETO = { agentes: { escada: ESCADA } };

function novo() { return {}; }

// ---------------------------------------------------------------- o marcador

test('escalada: o marcador e a ultima linha ESCALAR (ou ESCALATE) com nome de agente valido', () => {
  assert.deepStrictEqual(escalada.marcador('Parei.\nESCALAR: desenvolvedor - precisa de logica nova'),
    { agente: 'desenvolvedor', motivo: 'precisa de logica nova' });
  assert.deepStrictEqual(escalada.marcador('ESCALATE: arquiteto - deep bug'), { agente: 'arquiteto', motivo: 'deep bug' });
  assert.deepStrictEqual(escalada.marcador('  ESCALAR: "arquiteto" - entre aspas'),
    { agente: 'arquiteto', motivo: 'entre aspas' }, 'o nome entre aspas ou crases vale');
  assert.deepStrictEqual(escalada.marcador('ESCALAR: a - um\ntexto\nESCALAR: desenvolvedor - o ultimo vale'),
    { agente: 'desenvolvedor', motivo: 'o ultimo vale' });
  assert.deepStrictEqual(escalada.marcador('`ESCALAR: desenvolvedor - em crase`'), { agente: 'desenvolvedor', motivo: 'em crase' });
  assert.deepStrictEqual(escalada.marcador('**ESCALAR:** desenvolvedor - em negrito'),
    { agente: 'desenvolvedor', motivo: 'em negrito' });
  assert.strictEqual(escalada.marcador('Feito. Nada a escalar.'), null);
  assert.strictEqual(escalada.marcador('O formato e ESCALAR: desenvolvedor - x'), null, 'no meio da linha nao vale');
  assert.strictEqual(escalada.marcador('ESCALAR: <agente> - <motivo>'), null, 'o molde citado nao e pedido');
  assert.strictEqual(escalada.marcador('ESCALAR: desenvolvedor'), null, 'sem motivo nao e pedido');
  assert.deepStrictEqual(escalada.marcador('Parei.\r\nESCALAR: desenvolvedor - fim de linha do Windows\r\n'),
    { agente: 'desenvolvedor', motivo: 'fim de linha do Windows' }, 'CRLF vale');
  assert.strictEqual(escalada.marcador(undefined), null);
  assert.strictEqual(escalada.marcador(null), null);
  assert.strictEqual(escalada.marcador(''), null);
  assert.strictEqual(escalada.marcador({ toString: 1 }), null, 'valor que nao e texto nao lanca');
});

test('escalada: o marcador le linha enorme em tempo linear (o gancho tem 10 s)', () => {
  // s168: com a regex de antes, uma linha ESCALAR com 100 mil espacos levava 14,5 s; sublinhado antes do nome e crase
  // no fim tambem davam tempo quadratico.
  for (const linha of [
    'ESCALAR: desenvolvedor - a' + ' '.repeat(60000) + 'x',
    'ESCALAR: desenvolvedor - a' + '`'.repeat(60000) + 'x',
    'ESCALAR:' + '_'.repeat(60000) + 'x'
  ]) {
    const inicio = Date.now();
    escalada.marcador(linha);
    const ms = Date.now() - inicio;
    assert.ok(ms < 1000, 'o marcador levou ' + ms + ' ms numa linha de ' + linha.length + ' caracteres');
  }
  assert.strictEqual(escalada.marcador('ESCALAR: desenvolvedor - ' + 'x'.repeat(5000)).motivo.length, 300,
    'o motivo guardado na sessao ja sai com o teto');
  assert.deepStrictEqual(escalada.marcador('ESCALAR: desenvolvedor - motivo ' + '*'.repeat(500)),
    { agente: 'desenvolvedor', motivo: 'motivo' }, 'a moldura do fim sai depois do teto');
});

test('escalada: o modelo de agente do plugin ensina a linha que o marcador le', () => {
  const molde = fs.readFileSync(path.join(RAIZ, 'modelos', 'agente.md'), 'utf8');
  const linha = molde.split('\n').filter((l) => /`ESCALAR: /.test(l))[0];
  assert.ok(linha, 'o modelo de agente nao ensina o marcador');
  const exemplo = linha.match(/`(ESCALAR: [^`]+)`/)[1].replace(/<[^>]*agent[^>]*>/, 'desenvolvedor');
  assert.strictEqual(escalada.marcador(exemplo).agente, 'desenvolvedor', 'o marcador nao le a linha do modelo: ' + exemplo);
});

// ---------------------------------------------------------------- o pedido (fim do subagente)

test('escalada: o fim de um degrau com marcador guarda o pedido do destino acima dele', () => {
  const s = novo();
  s.escalada = escalada.aoFechar(s, 'tarefas-simples', 'a1', 'ESCALAR: desenvolvedor - logica nova', PROJETO);
  assert.deepStrictEqual(s.escalada.pendentes,
    [{ id: 'a1', de: 'tarefas-simples', para: 'desenvolvedor', motivo: 'logica nova', n: 1 }]);
});

test('escalada: destino fora da escada, abaixo ou igual vira o degrau seguinte; o topo nao tem destino', () => {
  for (const pedido of ['nao-existe', 'busca-rapida', 'tarefas-simples']) {
    const s = novo();
    s.escalada = escalada.aoFechar(s, 'tarefas-simples', 'a1', 'ESCALAR: ' + pedido + ' - x', PROJETO);
    assert.strictEqual(s.escalada.pendentes[0].para, 'desenvolvedor', pedido);
  }
  const s = novo();
  s.escalada = escalada.aoFechar(s, 'arquiteto', 'a2', 'ESCALAR: especialista - x', PROJETO);
  assert.strictEqual(s.escalada.pendentes[0].para, null, 'o topo nao tem para onde subir');
});

test('escalada: so age com escada de 2+ degraus e agente de dentro dela', () => {
  const casos = [
    ['sworn:inspector', PROJETO], ['fork', PROJETO], ['desenvolvedor', {}], ['desenvolvedor', null],
    ['desenvolvedor', { agentes: { escada: ['desenvolvedor'] } }], ['desenvolvedor', { agentes: { escada: 'x' } }]
  ];
  for (const [tipo, projeto] of casos) {
    const s = novo();
    s.escalada = escalada.aoFechar(s, tipo, 'a1', 'ESCALAR: arquiteto - x', projeto);
    assert.deepStrictEqual((s.escalada && s.escalada.pendentes) || [], [], tipo + ' ' + JSON.stringify(projeto));
  }
  const sem = novo();
  sem.escalada = escalada.aoFechar(sem, 'desenvolvedor', 'a1', 'Pronto, sem pedido.', PROJETO);
  assert.deepStrictEqual((sem.escalada && sem.escalada.pendentes) || [], [], 'sem marcador nao ha pedido');
});

test('escalada: o mesmo subagente lido duas vezes (handback e fim) da um pedido so, mesmo depois de cobrado', () => {
  const s = novo();
  s.escalada = escalada.aoFechar(s, 'tarefas-simples', 'a1', 'ESCALAR: desenvolvedor - x', PROJETO);
  s.escalada = escalada.aoFechar(s, 'tarefas-simples', 'a1', 'ESCALAR: desenvolvedor - x', PROJETO);
  assert.strictEqual(s.escalada.pendentes.length, 1);
  s.escalada = escalada.semPendentes(s);
  s.escalada = escalada.aoFechar(s, 'tarefas-simples', 'a1', 'ESCALAR: desenvolvedor - x', PROJETO);
  assert.deepStrictEqual(s.escalada.pendentes, [], 'o fim que chega depois da cobranca nao pede de novo');
});

// ---------------------------------------------------------------- o despacho (comeco do subagente) e o teto

test('escalada: o destino que nasce da baixa no pedido, e a subida seguinte conta a cadeia ate o teto', () => {
  const s = novo();
  s.escalada = escalada.aoFechar(s, 'busca-rapida', 'a1', 'ESCALAR: tarefas-simples - x', PROJETO);
  s.escalada = escalada.aoAbrir(s, 'desenvolvedor', 'b0');
  assert.strictEqual(s.escalada.pendentes.length, 1, 'outro agente nao da baixa');
  s.escalada = escalada.aoAbrir(s, 'tarefas-simples', 'a2');
  assert.deepStrictEqual(s.escalada.pendentes, [], 'o destino nasceu');
  s.escalada = escalada.aoFechar(s, 'tarefas-simples', 'a2', 'ESCALAR: desenvolvedor - y', PROJETO);
  assert.strictEqual(s.escalada.pendentes[0].n, 2, 'a 2a subida da mesma cadeia');
  assert.ok(escalada.motivoDoFecho(s).includes('Agent({ subagent_type: "desenvolvedor"'), 'a 2a subida ainda despacha');
  assert.ok(!('a2' in s.escalada.subidas), 'o fim do subagente encerra a cadeia dele');
  s.escalada = escalada.aoAbrir(s, 'desenvolvedor', 'a3');
  s.escalada = escalada.aoFechar(s, 'desenvolvedor', 'a3', 'ESCALAR: arquiteto - z', PROJETO);
  assert.strictEqual(s.escalada.pendentes[0].n, escalada.TETO_DE_SUBIDAS + 1, 'a 3a passa do teto');
  const motivo = escalada.motivoDoFecho(s);
  assert.match(motivo, /teto/, motivo);
  assert.ok(!/Agent\(\{/.test(motivo), 'acima do teto a ordem e levar ao usuario, nao despachar: ' + motivo);

  const fresco = novo();
  fresco.escalada = escalada.aoFechar(fresco, 'desenvolvedor', 'c1', 'ESCALAR: arquiteto - z', PROJETO);
  assert.strictEqual(fresco.escalada.pendentes[0].n, 1, 'agente despachado sem pedido comeca cadeia nova');
});

test('escalada: o despacho que vem depois da cobranca no fecho (o caso comum) segue a mesma cadeia', () => {
  const s = novo();
  s.escalada = escalada.aoFechar(s, 'tarefas-simples', 'a1', 'ESCALAR: desenvolvedor - x', PROJETO);
  s.escalada = escalada.semPendentes(s);
  s.escalada = escalada.aoAbrir(s, 'desenvolvedor', 'a2');
  s.escalada = escalada.aoFechar(s, 'desenvolvedor', 'a2', 'ESCALAR: arquiteto - y', PROJETO);
  assert.strictEqual(s.escalada.pendentes[0].n, 2, 'o bloqueio do fecho nao pode zerar a cadeia');
  s.escalada = escalada.semPendentes(s);
  s.escalada = escalada.aoAbrir(s, 'arquiteto', 'a3');
  s.escalada = escalada.aoAbrir(s, 'arquiteto', 'a4');
  s.escalada = escalada.aoFechar(s, 'arquiteto', 'a4', 'ESCALAR: especialista - z', PROJETO);
  assert.strictEqual(s.escalada.pendentes[0].n, 1, 'a ligacao vale para um despacho so');

  const sem = novo();
  sem.escalada = escalada.aoFechar(sem, 'tarefas-simples', 'b1', 'ESCALAR: desenvolvedor - x', PROJETO);
  sem.escalada = escalada.aoAbrir(sem, 'desenvolvedor', 'b2');
  sem.escalada = escalada.aoFechar(sem, 'desenvolvedor', 'b2', 'Resolvido, sem pedido.', PROJETO);
  assert.deepStrictEqual(sem.escalada.subidas, {}, 'o fim sem pedido tambem encerra a cadeia');
});

// ---------------------------------------------------------------- o motivo do fecho

test('escalada: o motivo do fecho escreve o despacho certo, e sem pedido nao ha motivo', () => {
  assert.strictEqual(escalada.motivoDoFecho(undefined), null);
  assert.strictEqual(escalada.motivoDoFecho({ escalada: { pendentes: [] } }), null);
  const s = novo();
  s.escalada = escalada.aoFechar(s, 'tarefas-simples', 'a1', 'ESCALAR: desenvolvedor - decisão "difícil"', PROJETO);
  const motivo = escalada.motivoDoFecho(s);
  assert.match(motivo, /^sworn - /, 'a forma unica dos avisos');
  assert.ok(motivo.includes('Agent({ subagent_type: "desenvolvedor"'), motivo);
  assert.ok(motivo.includes('.\n  Despache agora: Agent({'), 'o despacho tem linha propria: ' + motivo);
  assert.ok(motivo.includes('"tarefas-simples"'), 'diz quem pediu: ' + motivo);
  assert.ok(/^[\x20-\x7E\n]*$/.test(motivo), 'texto de gancho so em ASCII (R5): ' + motivo);
  assert.ok(motivo.includes('decisao \\"dificil\\"'), 'o motivo do agente sai sem acento e com a aspa escapada: ' + motivo);
  const longo = novo();
  longo.escalada = escalada.aoFechar(longo, 'tarefas-simples', 'a5', 'ESCALAR: desenvolvedor - ' + 'x'.repeat(5000), PROJETO);
  assert.ok(escalada.motivoDoFecho(longo).length < 1500, 'o motivo do agente tem teto de tamanho');

  const topo = novo();
  topo.escalada = escalada.aoFechar(topo, 'arquiteto', 'a9', 'ESCALAR: especialista - x', PROJETO);
  const m = escalada.motivoDoFecho(topo);
  assert.match(m, /topo da escada/, m);
  assert.ok(!/Agent\(\{/.test(m), m);
});

test('escalada: pedido que nao e objeto no estado (arquivo editado ou corrompido) nao derruba o fecho', () => {
  // s168: com [null], o motivoDoFecho lancava e o io.blindar liberava todo Stop da sessao.
  const pedido = { id: 'a1', de: 'tarefas-simples', para: 'desenvolvedor', motivo: 'm', n: 1 };
  const s = { escalada: { pendentes: [null, 'x', 7, pedido] } };
  const motivo = escalada.motivoDoFecho(s);
  assert.ok(motivo && motivo.includes('Agent({ subagent_type: "desenvolvedor"'), String(motivo));
  assert.deepStrictEqual(escalada.semPendentes(s).pendentes, []);
  assert.deepStrictEqual(escalada.aoAbrir(s, 'desenvolvedor', 'a2').pendentes, [], 'o despacho da baixa no pedido valido');
});

test('escalada: semPendentes limpa os pedidos e guarda a cadeia', () => {
  const s = novo();
  s.escalada = escalada.aoFechar(s, 'busca-rapida', 'a1', 'ESCALAR: tarefas-simples - x', PROJETO);
  s.escalada = escalada.aoAbrir(s, 'tarefas-simples', 'a2');
  s.escalada = escalada.aoFechar(s, 'desenvolvedor', 'a4', 'ESCALAR: arquiteto - x', PROJETO);
  const limpo = escalada.semPendentes(s);
  assert.deepStrictEqual(limpo.pendentes, []);
  s.escalada = limpo;
  s.escalada = escalada.aoFechar(s, 'tarefas-simples', 'a2', 'ESCALAR: desenvolvedor - y', PROJETO);
  assert.strictEqual(s.escalada.pendentes[0].n, 2, 'a cadeia do a2 sobreviveu a limpeza');
});

// ---------------------------------------------------------------- ponta a ponta

function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-escalada-')); }

function rodar(script, dir, entrada) {
  return spawnSync(process.execPath, [path.join(RAIZ, 'scripts', script)], {
    cwd: dir, encoding: 'utf8', input: JSON.stringify(entrada), timeout: 60000,
    env: Object.assign({}, process.env, { SWORN_TMP: path.join(dir, '_sessoes') })
  });
}

function sessao(dir, id) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, '_sessoes', 'sworn', id + '.json'), 'utf8')); } catch (e) { return {}; }
}

function projeto(dir, extra) {
  fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify(Object.assign({ marchaPadrao: 'padrao',
    agentes: { escada: ESCADA, degraus: ESCADA.map((a) => ({ agente: a, apelido: 'sonnet' })) } }, extra)));
}

test('escalar.js + portao-fecho.js: pedido sem despacho barra o fim uma vez e conta no balde', () => {
  const dir = temp();
  try {
    projeto(dir);
    const fim = rodar('escalar.js', dir, { session_id: 'e1', cwd: dir, hook_event_name: 'SubagentStop',
      agent_id: 'a1', agent_type: 'tarefas-simples', last_assistant_message: 'Parei.\nESCALAR: desenvolvedor - logica nova' });
    assert.strictEqual(fim.status, 0, fim.stderr);
    assert.strictEqual(fim.stdout, '', 'o fim do subagente nunca decide (block faria o subagente continuar)');
    assert.strictEqual(sessao(dir, 'e1').escalada.pendentes.length, 1, JSON.stringify(sessao(dir, 'e1')));

    const stop = rodar('portao-fecho.js', dir, { session_id: 'e1', cwd: dir, hook_event_name: 'Stop',
      last_assistant_message: 'O agente ainda esta rodando.' });
    assert.strictEqual(stop.status, 0, stop.stderr);
    const saida = JSON.parse(stop.stdout);
    assert.strictEqual(saida.decision, 'block', stop.stdout);
    assert.ok(saida.reason.includes('Agent({ subagent_type: "desenvolvedor"'), saida.reason);
    const s = sessao(dir, 'e1');
    assert.strictEqual(s.contadores.escalada_sem_despacho, 1, JSON.stringify(s));
    assert.deepStrictEqual(s.escalada.pendentes, [], 'cobrado uma vez');

    const laco = rodar('portao-fecho.js', dir, { session_id: 'e1', cwd: dir, hook_event_name: 'Stop',
      stop_hook_active: true, last_assistant_message: 'Nao despachei: o usuario decide.' });
    assert.ok(!/"block"/.test(laco.stdout), 'o segundo Stop libera: ' + laco.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('escalar.js: o destino que nasce (SubagentStart) da baixa, e o fim passa calado', () => {
  const dir = temp();
  try {
    projeto(dir);
    rodar('escalar.js', dir, { session_id: 'e2', cwd: dir, hook_event_name: 'SubagentStop',
      agent_id: 'a1', agent_type: 'tarefas-simples', last_assistant_message: 'ESCALAR: desenvolvedor - x' });
    const inicio = rodar('escalar.js', dir, { session_id: 'e2', cwd: dir, hook_event_name: 'SubagentStart',
      agent_id: 'a2', agent_type: 'desenvolvedor' });
    assert.strictEqual(inicio.status, 0, inicio.stderr);
    assert.strictEqual(inicio.stdout, '');
    const stop = rodar('portao-fecho.js', dir, { session_id: 'e2', cwd: dir, hook_event_name: 'Stop',
      last_assistant_message: 'Despachei o desenvolvedor.' });
    assert.strictEqual(stop.stdout, '', 'despachado: o fim passa: ' + stop.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('escalar.js: subagente fora da escada nem trava nem grava o estado da sessao', () => {
  const dir = temp();
  try {
    projeto(dir);
    for (const evento of ['SubagentStart', 'SubagentStop']) {
      const r = rodar('escalar.js', dir, { session_id: 'e5', cwd: dir, hook_event_name: evento,
        agent_id: 'i1', agent_type: 'sworn:inspector', last_assistant_message: '{"lente": "borda"}' });
      assert.strictEqual(r.status, 0, r.stderr);
    }
    assert.ok(!fs.existsSync(path.join(dir, '_sessoes', 'sworn', 'e5.json')), 'gravou o estado sem nada a mudar');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('escalar.js: o handback (modo auto) traz o pedido em tool_input.message', () => {
  const dir = temp();
  try {
    projeto(dir);
    const r = rodar('escalar.js', dir, { session_id: 'e3', cwd: dir, hook_event_name: 'PostToolUse',
      tool_name: 'SubagentHandback', agent_id: 'a1', agent_type: 'desenvolvedor',
      tool_input: { message: 'Bug intermitente.\nESCALAR: arquiteto - causa nao isolada' } });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(sessao(dir, 'e3').escalada.pendentes[0].para, 'arquiteto');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('portao-fecho.js: o pedido sem despacho entra no mesmo bloqueio que os outros motivos do turno', () => {
  const dir = temp();
  try {
    projeto(dir);
    rodar('escalar.js', dir, { session_id: 'e4', cwd: dir, hook_event_name: 'SubagentStop',
      agent_id: 'a1', agent_type: 'tarefas-simples', last_assistant_message: 'ESCALAR: desenvolvedor - x' });
    rodar('marcar-trabalho.js', dir, { session_id: 'e4', cwd: dir, tool_name: 'Write',
      tool_input: { file_path: path.join(dir, 'a.js') } });
    const stop = rodar('portao-fecho.js', dir, { session_id: 'e4', cwd: dir, hook_event_name: 'Stop',
      last_assistant_message: 'Pronto, os testes passaram.' });
    const saida = JSON.parse(stop.stdout);
    assert.strictEqual(saida.decision, 'block', stop.stdout);
    assert.ok(saida.reason.includes('subagent_type: "desenvolvedor"'), 'falta a escalada: ' + saida.reason);
    assert.ok(saida.reason.includes(require('../scripts/lib/evidencia.js').MOTIVO), 'falta o motivo da evidencia: ' + saida.reason);
    const s = sessao(dir, 'e4');
    assert.strictEqual(s.contadores.escalada_sem_despacho, 1);
    assert.strictEqual(s.contadores.fecho_sem_evidencia, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('portao-fecho.js: a escalada barra sozinha, com a trava 3 desligada e junto do subitem aberto', () => {
  const casos = [
    ['so a escalada, com prova colada', {}, null, /^sworn - escalada pedida/],
    ['trava 3 desligada', { travas: { fecho: false } }, null, /escalada pedida/],
    ['subitem aberto', {}, '## Tarefa 1: fazer\n- [x] a\n- [ ] b\n', /subitem pendente[\s\S]*escalada pedida/]
  ];
  for (const [nome, extra, plano, espera] of casos) {
    const dir = temp();
    try {
      projeto(dir, extra);
      if (plano) {
        fs.writeFileSync(path.join(dir, 'plano.md'), plano, 'utf8');
        fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'plano-ativo.json'),
          JSON.stringify({ arquivo: 'plano.md', sessionId: 'e6', tarefa: null }), 'utf8');
      }
      rodar('escalar.js', dir, { session_id: 'e6', cwd: dir, hook_event_name: 'SubagentStop',
        agent_id: 'a1', agent_type: 'tarefas-simples', last_assistant_message: 'ESCALAR: desenvolvedor - x' });
      rodar('marcar-trabalho.js', dir, { session_id: 'e6', cwd: dir, tool_name: 'Write',
        tool_input: { file_path: path.join(dir, 'a.js') } });
      const stop = rodar('portao-fecho.js', dir, { session_id: 'e6', cwd: dir, hook_event_name: 'Stop',
        last_assistant_message: 'A etapa esta concluida.\n```\nok\n```' });
      const saida = JSON.parse(stop.stdout || '{}');
      assert.strictEqual(saida.decision, 'block', nome + ': ' + stop.stdout);
      assert.match(saida.reason, espera, nome);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});
