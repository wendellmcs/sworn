'use strict';
// 0.3.4, item 1 (D264, D287): o veredito do inspetor e gravado por hook, nao a mao.
// O script nunca barra (sai com 0, nunca emite `decision`) e nunca cala (nao gravou = systemMessage
// com a causa). A fixture REAL_SUBAGENT_STOP e o payload de um SubagentStop real (claude 2.1.258,
// 2026-09-30, agente sworn:inspector), com os caminhos de usuario trocados por ficticios. D597: o session_id tambem (era o de uma sessao real do dono).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const comum = require('./lib/comum.js');

const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'gravar-veredito.js');

const REAL_SUBAGENT_STOP = {
  session_id: '11111111-2222-4333-8444-555555555555',
  transcript_path: 'C:\\dev\\.claude\\projects\\proj\\11111111-2222-4333-8444-555555555555.jsonl',
  cwd: 'C:\\dev\\proj',
  prompt_id: 'e7fb3c83-5849-4197-bccb-fd491ed465fa',
  permission_mode: 'acceptEdits',
  agent_id: 'a4ef814f10f9daff9',
  agent_type: 'sworn:inspector',
  effort: { level: 'medium' },
  hook_event_name: 'SubagentStop',
  stop_hook_active: false,
  agent_transcript_path: 'C:\\dev\\.claude\\projects\\proj\\11111111\\subagents\\agent-a4ef814f10f9daff9.jsonl',
  last_assistant_message: '```json\n{\n  "lente": "correcao",\n  "melhor": "empate",\n' +
    '  "porQue": "nao sei - A.txt:1 retorna 1 e B.txt:1 retorna 2",\n  "achados": []\n}\n```',
  background_tasks: [{ id: 'a4ef814f10f9daff9', type: 'subagent', status: 'running',
    description: 'sworn:inspector review', agent_type: 'sworn:inspector' }],
  session_crons: []
};

function tmp(nome) {
  return comum.temporaria('sworn gravar-' + nome + '-');
}

/** Um projeto com uma ronda de verdade: revisao/<id>/<n>/ com A.txt, B.txt e vereditos/. */
function projeto() {
  const dir = tmp('proj');
  const ronda = path.join(dir, '.claude', 'sworn', 'revisao', 'src__a.js', '1');
  fs.mkdirSync(path.join(ronda, 'vereditos'), { recursive: true });
  fs.writeFileSync(path.join(ronda, 'A.txt'), 'a\n', 'utf8');
  fs.writeFileSync(path.join(ronda, 'B.txt'), 'b\n', 'utf8');
  return { dir: dir, ronda: ronda, vereditos: path.join(ronda, 'vereditos'), estado: path.join(dir, '_estado') };
}

function veredito(p, extra) {
  return Object.assign({
    lente: 'correcao', melhor: 'A', porQue: 'A.txt:3 trata o null',
    achados: [{ estado: 'confirmado', trecho: 'x', severidade: 'P1', arquivo: 'B.txt', linha: 3, descricao: 'nao trata o null', comoFalha: 'null -> erro' }],
    vereditos: p.vereditos
  }, extra || {});
}

function stop(p, mensagem, extra) {
  return Object.assign({}, REAL_SUBAGENT_STOP, { cwd: p.dir, last_assistant_message: mensagem }, extra || {});
}

function handback(p, mensagem, extra) {
  return Object.assign({
    session_id: REAL_SUBAGENT_STOP.session_id, cwd: p.dir, agent_id: REAL_SUBAGENT_STOP.agent_id,
    agent_type: 'sworn:inspector', hook_event_name: 'PostToolUse', tool_name: 'SubagentHandback',
    tool_input: { message: mensagem }, tool_response: {}
  }, extra || {});
}

/** O ambiente do gancho: o do processo de teste, com o estado na pasta do projeto de ensaio. */
function ambienteDe(p) {
  return Object.assign({}, process.env, { SWORN_TMP: p.estado });
}

function opcoes(p, entrada) {
  return { cwd: p.dir, encoding: 'utf8', input: typeof entrada === 'string' ? entrada : JSON.stringify(entrada),
    env: ambienteDe(p) };
}

// F1g: o gancho roda no processo do teste (a entrada em texto segue por processo, pelo proprio ganchoComoProcesso)
function rodar(p, entrada) {
  const r = comum.ganchoComoProcesso(SCRIPT, entrada, { cwd: p.dir, env: ambienteDe(p) });
  return { status: r.status, json: r.json, stdout: r.stdout, stderr: r.stderr };
}

/** O contrato que vale em TODA resposta: sai com 0 e nunca emite decision. */
function semBarrar(r) {
  assert.strictEqual(r.status, 0, 'o hook tem de sair com 0. stderr: ' + r.stderr);
  if (r.json) {
    assert.strictEqual(r.json.decision, undefined, 'decision no SubagentStop faria o inspetor continuar');
    assert.strictEqual(r.json.hookSpecificOutput && r.json.hookSpecificOutput.permissionDecision, undefined);
  }
}

function calado(r) {
  semBarrar(r);
  assert.strictEqual((r.stdout || '').trim(), '', 'era para ficar calado: ' + r.stdout);
}

function avisou(r, causa) {
  semBarrar(r);
  assert.ok(r.json && typeof r.json.systemMessage === 'string', 'nao gravou e nao avisou: ' + r.stdout);
  // 0.3.5 (C): o aviso diz o que fazer, em vez de supor que o leitor conhece o procedimento ("como antes").
  assert.ok(/grave esta lente a mao: salve o JSON do inspetor como .+\.json \(skill revisar, Passo 2\)/i.test(r.json.systemMessage), r.json.systemMessage);
  assert.ok(!/como antes/i.test(r.json.systemMessage), r.json.systemMessage);
  if (causa) assert.ok(causa.test(r.json.systemMessage), String(causa) + ' fora de: ' + r.json.systemMessage);
}

/** A resposta do tipo errado para a ronda: o aviso manda chamar a lente de novo, nunca gravar a mao a resposta recusada. */
function avisouChamarDeNovo(r, causa) {
  semBarrar(r);
  assert.ok(r.json && typeof r.json.systemMessage === 'string', 'nao gravou e nao avisou: ' + r.stdout);
  const m = r.json.systemMessage;
  assert.ok(/\. Chame a lente de novo com o briefing desta ronda; nao grave esta resposta a mao\.$/.test(m), m);
  assert.ok(!/salve o JSON do inspetor/i.test(m), m);
  assert.ok(causa.test(m), String(causa) + ' fora de: ' + m);
}

/** F3-08: o aviso de "ja existe ... outro conteudo" manda comparar e apagar o errado, nao "gravar a mao". */
function avisouOutroConteudo(r, arquivo) {
  semBarrar(r);
  assert.ok(r.json && typeof r.json.systemMessage === 'string', 'nao avisou: ' + r.stdout);
  const m = r.json.systemMessage;
  assert.ok(/ja existe .+\.json com outro conteudo; nao sobrescrevi/.test(m), m);
  assert.ok(/compare os dois \(o arquivo e o JSON do inspetor\) e apague o errado antes de gravar de novo/i.test(m), m);
  assert.ok(!/grave esta lente a mao/i.test(m), 'o aviso ainda manda gravar a mao: ' + m);
  if (arquivo) assert.ok(m.includes(arquivo), 'o aviso nao diz qual arquivo comparar: ' + m);
}

function lerVeredito(p, lente) {
  return JSON.parse(fs.readFileSync(path.join(p.vereditos, lente + '.json'), 'utf8'));
}

function arquivosEm(p) {
  return fs.readdirSync(p.vereditos).sort();
}

function limpar(p) { fs.rmSync(p.dir, { recursive: true, force: true }); }

// ------------------------------------------------------------------ o que grava

test('gravar-veredito: grava o JSON valido do SubagentStop em <lente>.json', () => {
  const p = projeto();
  try {
    const vd = veredito(p);
    const r = rodar(p, stop(p, JSON.stringify(vd)));
    calado(r);
    assert.deepStrictEqual(lerVeredito(p, 'correcao'), vd);
  } finally { limpar(p); }
});

test('gravar-veredito: grava o JSON cercado por bloco json, como o inspetor real devolve', () => {
  const p = projeto();
  try {
    const vd = veredito(p, { lente: 'seguranca', melhor: 'empate', achados: [] });
    const r = rodar(p, stop(p, '```json\n' + JSON.stringify(vd, null, 2) + '\n```'));
    calado(r);
    assert.deepStrictEqual(lerVeredito(p, 'seguranca'), vd);
  } finally { limpar(p); }
});

test('gravar-veredito: grava tambem com texto solto em volta do JSON', () => {
  const p = projeto();
  try {
    const vd = veredito(p, { lente: 'borda', achados: [] });
    const r = rodar(p, stop(p, 'Segue o veredito:\n' + JSON.stringify(vd) + '\nFim.'));
    calado(r);
    assert.deepStrictEqual(lerVeredito(p, 'borda'), vd);
  } finally { limpar(p); }
});

test('gravar-veredito: o JSON cercado vale mesmo com chaves soltas na prosa em volta', () => {
  const p = projeto();
  try {
    const vd = veredito(p, { lente: 'estados', achados: [] });
    calado(rodar(p, stop(p, 'Na {ronda} 1:\n```json\n' + JSON.stringify(vd) + '\n```\nVeja {isto}.')));
    assert.deepStrictEqual(lerVeredito(p, 'estados'), vd);
  } finally { limpar(p); }
});

test('gravar-veredito: lente de UI grava com a chave ui-', () => {
  const p = projeto();
  try {
    const vd = veredito(p, { lente: 'ui-a11y', achados: [] });
    calado(rodar(p, stop(p, JSON.stringify(vd))));
    assert.deepStrictEqual(arquivosEm(p), ['ui-a11y.json']);
  } finally { limpar(p); }
});

test('gravar-veredito: a lente pode vir pelo titulo quando o titulo e unico', () => {
  const p = projeto();
  try {
    const vd = veredito(p, { lente: 'Correcao e regressao', achados: [] });
    calado(rodar(p, stop(p, JSON.stringify(vd))));
    assert.deepStrictEqual(arquivosEm(p), ['correcao.json']);
  } finally { limpar(p); }
});

// F6-01 (D335 secao 1): o inspetor grava o TITULO no campo lente, e o apurar casa refutacao por esse texto
// (mesmaLente). Titulo repetido entre as duas familias deixava o texto ambiguo; agora nenhum se repete.
test('gravar-veredito: nenhum titulo de lente se repete entre as familias (codigo e tela), pela mesma comparacao do gravador', () => {
  const vered = require('../scripts/lib/veredito.js');
  const todas = vered.LENTES.concat(vered.LENTES_UI);
  const vistos = {};
  for (const l of todas) {
    const t = String(l.titulo).trim().toLowerCase();
    assert.ok(!Object.prototype.hasOwnProperty.call(vistos, t), 'titulo repetido: "' + l.titulo + '" (' + vistos[t] + ' e ' + l.chave + ')');
    vistos[t] = l.chave;
  }
});

test('gravar-veredito: o titulo completo de cada familia grava na chave certa (Estados e Fidelidade, codigo e tela)', () => {
  const p = projeto();
  try {
    const casos = [
      ['Estados obrigatorios (codigo)', 'estados.json'], ['Estados obrigatorios (tela)', 'ui-estados.json'],
      ['Fidelidade ao design system (codigo)', 'design.json'], ['Fidelidade ao design system (tela)', 'ui-design.json']
    ];
    for (const [titulo, arquivo] of casos) {
      calado(rodar(p, stop(p, JSON.stringify(veredito(p, { lente: titulo, achados: [] })))));
      assert.ok(fs.existsSync(path.join(p.vereditos, arquivo)), titulo + ' nao gravou ' + arquivo + ': ' + arquivosEm(p));
    }
    assert.strictEqual(arquivosEm(p).length, 4);
  } finally { limpar(p); }
});

test('gravar-veredito: o titulo antigo, sem o sufixo (codigo)/(tela), nao grava: qual das duas?', () => {
  const p = projeto();
  try {
    for (const titulo of ['Estados obrigatorios', 'Fidelidade ao design system']) {
      avisou(rodar(p, stop(p, JSON.stringify(veredito(p, { lente: titulo, achados: [] })))), /lente desconhecida/);
    }
    assert.deepStrictEqual(arquivosEm(p), []);
  } finally { limpar(p); }
});

test('gravar-veredito: a pasta vereditos pode vir relativa ao cwd da sessao', () => {
  const p = projeto();
  try {
    const rel = path.relative(p.dir, p.vereditos);
    const vd = veredito(p, { vereditos: rel, achados: [] });
    calado(rodar(p, stop(p, JSON.stringify(vd))));
    assert.deepStrictEqual(arquivosEm(p), ['correcao.json']);
  } finally { limpar(p); }
});

test('gravar-veredito: o payload REAL do SubagentStop e lido (sem a pasta, que o inspetor da 0.3.3 nao devolve): avisa', () => {
  const p = projeto();
  try {
    const r = rodar(p, Object.assign({}, REAL_SUBAGENT_STOP, { cwd: p.dir }));
    avisou(r, /vereditos/);
    assert.ok(/correcao/.test(r.json.systemMessage), 'a lente do payload real nao entrou na mensagem: ' + r.json.systemMessage);
    assert.deepStrictEqual(arquivosEm(p), []);
  } finally { limpar(p); }
});

// ----------------------------------------------------------- o que nao grava e avisa

test('gravar-veredito: texto que nao e JSON nao grava e avisa', () => {
  const p = projeto();
  try {
    avisou(rodar(p, stop(p, 'Terminei a revisao, sem achados.')), /JSON/);
    assert.deepStrictEqual(arquivosEm(p), []);
  } finally { limpar(p); }
});

test('gravar-veredito: mensagem vazia ou ausente nao grava e avisa', () => {
  const p = projeto();
  try {
    avisou(rodar(p, stop(p, '')), /vazia/);
    const sem = stop(p, 'x'); delete sem.last_assistant_message;
    avisou(rodar(p, sem), /vazia/);
    assert.deepStrictEqual(arquivosEm(p), []);
  } finally { limpar(p); }
});

test('gravar-veredito: JSON invalido pela regua do apurar (sem melhor, achados que nao e lista) nao grava e avisa', () => {
  const p = projeto();
  try {
    const semMelhor = veredito(p); delete semMelhor.melhor;
    avisou(rodar(p, stop(p, JSON.stringify(semMelhor))), /melhor/);
    avisou(rodar(p, stop(p, JSON.stringify(veredito(p, { achados: 'nada' })))), /achados/);
    avisou(rodar(p, stop(p, JSON.stringify(veredito(p, { lente: '' })))), /lente/);
    avisou(rodar(p, stop(p, '[1, 2]')), /JSON/);
    assert.deepStrictEqual(arquivosEm(p), []);
  } finally { limpar(p); }
});

test('gravar-veredito: lente desconhecida nao grava e avisa, sem inventar nome de arquivo', () => {
  const p = projeto();
  try {
    for (const lente of ['elogio', '../correcao', 'correcao/../x']) {
      avisou(rodar(p, stop(p, JSON.stringify(veredito(p, { lente: lente })))), /lente desconhecida/);
    }
    // D822: a lente que nao e texto ja para no formato do veredito, com o mesmo aviso de nao gravado
    avisou(rodar(p, stop(p, JSON.stringify(veredito(p, { lente: 42 })))), /veredito sem lente/);
    assert.deepStrictEqual(arquivosEm(p), []);
    assert.ok(!fs.existsSync(path.join(p.ronda, 'x.json')));
  } finally { limpar(p); }
});

test('gravar-veredito: sem o campo vereditos nao grava e avisa', () => {
  const p = projeto();
  try {
    const vd = veredito(p); delete vd.vereditos;
    avisou(rodar(p, stop(p, JSON.stringify(vd))), /vereditos/);
    avisou(rodar(p, stop(p, JSON.stringify(veredito(p, { vereditos: 7 })))), /vereditos/);
    assert.deepStrictEqual(arquivosEm(p), []);
  } finally { limpar(p); }
});

test('gravar-veredito: pasta que nao e de ronda nao grava e avisa', () => {
  const p = projeto();
  try {
    // fora de .claude/sworn/revisao/, mesmo com A.txt e B.txt ao lado
    const solta = path.join(p.dir, 'outra', 'vereditos');
    fs.mkdirSync(solta, { recursive: true });
    fs.writeFileSync(path.join(p.dir, 'outra', 'A.txt'), 'a', 'utf8');
    fs.writeFileSync(path.join(p.dir, 'outra', 'B.txt'), 'b', 'utf8');
    avisou(rodar(p, stop(p, JSON.stringify(veredito(p, { vereditos: solta })))), /nao e a pasta vereditos de uma ronda/);
    assert.deepStrictEqual(fs.readdirSync(solta), []);

    // pasta irma cujo nome so COMECA por vereditos, numa ronda que tem A.txt e B.txt
    const velha = path.join(p.ronda, 'vereditos-velha');
    fs.mkdirSync(velha);
    avisou(rodar(p, stop(p, JSON.stringify(veredito(p, { vereditos: velha })))), /nao e a pasta vereditos de uma ronda/);
    assert.deepStrictEqual(fs.readdirSync(velha), []);

    // a propria pasta da ronda, e nao a vereditos dela
    avisou(rodar(p, stop(p, JSON.stringify(veredito(p, { vereditos: p.ronda })))), /nao e a pasta vereditos de uma ronda/);
    assert.ok(!fs.existsSync(path.join(p.ronda, 'correcao.json')));

    // sobe com .. para fora da revisao e volta a um nome que parece certo
    const escapa = path.join(p.ronda, '..', '..', '..', '..', '..', 'outra', 'vereditos');
    avisou(rodar(p, stop(p, JSON.stringify(veredito(p, { vereditos: escapa })))), /nao e a pasta vereditos de uma ronda/);
    assert.deepStrictEqual(fs.readdirSync(solta), []);
  } finally { limpar(p); }
});

test('gravar-veredito: ronda sem A.txt e B.txt ao lado nao grava e avisa', () => {
  const p = projeto();
  try {
    fs.rmSync(path.join(p.ronda, 'B.txt'));
    const r = rodar(p, stop(p, JSON.stringify(veredito(p))));
    avisou(r, /A\.txt e B\.txt/);
    // T4: o aviso diz QUAL pasta conferir
    assert.ok(r.json.systemMessage.includes('"' + p.vereditos + '"'), r.json.systemMessage);
    assert.deepStrictEqual(arquivosEm(p), []);
  } finally { limpar(p); }
});

test('gravar-veredito: pasta vereditos que nao existe nao e criada: avisa', () => {
  const p = projeto();
  try {
    fs.rmdirSync(p.vereditos);
    const r = rodar(p, stop(p, JSON.stringify(veredito(p))));
    avisou(r, /nao existe/);
    // T4: o aviso diz QUAL pasta nao existe
    assert.ok(r.json.systemMessage.includes('"' + p.vereditos + '"'), r.json.systemMessage);
    assert.ok(!fs.existsSync(p.vereditos));
  } finally { limpar(p); }
});

// -------------------------------------------------------------- nao sobrescreve

test('gravar-veredito: arquivo igual ja existe -> nada, e nada muda', () => {
  const p = projeto();
  try {
    const vd = veredito(p);
    calado(rodar(p, stop(p, JSON.stringify(vd))));
    const antes = fs.readFileSync(path.join(p.vereditos, 'correcao.json'));
    const antesMtime = fs.statSync(path.join(p.vereditos, 'correcao.json')).mtimeMs;
    const r = rodar(p, stop(p, JSON.stringify(vd)));
    calado(r);
    assert.ok(antes.equals(fs.readFileSync(path.join(p.vereditos, 'correcao.json'))));
    assert.strictEqual(fs.statSync(path.join(p.vereditos, 'correcao.json')).mtimeMs, antesMtime);
  } finally { limpar(p); }
});

test('gravar-veredito: arquivo escrito a mao, igual fora do campo vereditos, conta como igual', () => {
  const p = projeto();
  try {
    const vd = veredito(p);
    const aMao = Object.assign({}, vd); delete aMao.vereditos;
    fs.writeFileSync(path.join(p.vereditos, 'correcao.json'), JSON.stringify(aMao), 'utf8');
    calado(rodar(p, stop(p, JSON.stringify(vd))));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(p.vereditos, 'correcao.json'), 'utf8')), aMao);
  } finally { limpar(p); }
});

test('gravar-veredito: arquivo diferente ja existe -> nao sobrescreve e avisa', () => {
  const p = projeto();
  try {
    const antigo = veredito(p, { melhor: 'B', porQue: 'outra ronda', achados: [] });
    fs.writeFileSync(path.join(p.vereditos, 'correcao.json'), JSON.stringify(antigo), 'utf8');
    avisouOutroConteudo(rodar(p, stop(p, JSON.stringify(veredito(p)))), path.join(p.vereditos, 'correcao.json'));
    assert.deepStrictEqual(lerVeredito(p, 'correcao'), antigo);
  } finally { limpar(p); }
});

test('gravar-veredito: o que ja existe e nao se le (JSON quebrado, ou pasta no lugar) nao e sobrescrito: avisa', () => {
  const p = projeto();
  try {
    fs.writeFileSync(path.join(p.vereditos, 'correcao.json'), '{ quebrado', 'utf8');
    avisou(rodar(p, stop(p, JSON.stringify(veredito(p)))), /nao consegui le-lo/);
    assert.strictEqual(fs.readFileSync(path.join(p.vereditos, 'correcao.json'), 'utf8'), '{ quebrado');
    fs.mkdirSync(path.join(p.vereditos, 'borda.json'));
    avisou(rodar(p, stop(p, JSON.stringify(veredito(p, { lente: 'borda' })))), /nao consegui le-lo/);
    assert.ok(fs.statSync(path.join(p.vereditos, 'borda.json')).isDirectory());
  } finally { limpar(p); }
});

// ------------------------------------------------------ de quem e o veredito

test('gravar-veredito: agent_type de outro agente (ou sem agent_type) -> nada', () => {
  const p = projeto();
  try {
    const msg = JSON.stringify(veredito(p));
    calado(rodar(p, stop(p, msg, { agent_type: 'desenvolvedor' })));
    calado(rodar(p, stop(p, msg, { agent_type: 'inspetor' })));
    calado(rodar(p, stop(p, msg, { agent_type: 'outro:sworn:inspector' })));
    const sem = stop(p, msg); delete sem.agent_type;
    calado(rodar(p, sem));
    calado(rodar(p, handback(p, msg, { agent_type: 'Explore' })));
    assert.deepStrictEqual(arquivosEm(p), []);
  } finally { limpar(p); }
});

test('gravar-veredito: outro evento, ou outra ferramenta no PostToolUse -> nada', () => {
  const p = projeto();
  try {
    const msg = JSON.stringify(veredito(p));
    calado(rodar(p, stop(p, msg, { hook_event_name: 'Stop' })));
    calado(rodar(p, stop(p, msg, { hook_event_name: 'SubagentStart' })));
    calado(rodar(p, handback(p, msg, { tool_name: 'Read' })));
    // A2-16: PostToolUse sem tool_name nao e handback (a forma estrita do texto.mensagemDoSubagente).
    calado(rodar(p, handback(p, msg, { tool_name: undefined })));
    assert.deepStrictEqual(arquivosEm(p), []);
  } finally { limpar(p); }
});

// ------------------------------------------------ os dois caminhos de entrega

test('gravar-veredito: o handback (PostToolUse) grava a partir de tool_input.message', () => {
  const p = projeto();
  try {
    const vd = veredito(p, { lente: 'manutencao', achados: [] });
    const r = rodar(p, handback(p, '```json\n' + JSON.stringify(vd) + '\n```'));
    calado(r);
    assert.deepStrictEqual(lerVeredito(p, 'manutencao'), vd);
  } finally { limpar(p); }
});

test('gravar-veredito: o SubagentStop depois do handback que gravou fica calado (texto de encerramento)', () => {
  const p = projeto();
  try {
    const vd = veredito(p);
    calado(rodar(p, handback(p, JSON.stringify(vd))));
    const r = rodar(p, stop(p, 'Veredito entregue.'));
    calado(r);
    assert.deepStrictEqual(arquivosEm(p), ['correcao.json']);
  } finally { limpar(p); }
});

test('gravar-veredito: o SubagentStop depois do handback que JA AVISOU tambem fica calado (aviso uma vez so)', () => {
  const p = projeto();
  try {
    avisou(rodar(p, handback(p, JSON.stringify(veredito(p, { lente: 'elogio' })))), /lente desconhecida/);
    calado(rodar(p, stop(p, 'Veredito entregue.')));
  } finally { limpar(p); }
});

test('gravar-veredito: o silencio do SubagentStop e por inspetor: outro agent_id, sem handback, segue avisando', () => {
  const p = projeto();
  try {
    calado(rodar(p, handback(p, JSON.stringify(veredito(p)))));
    avisou(rodar(p, stop(p, 'Veredito entregue.', { agent_id: 'outro-inspetor' })), /JSON/);
  } finally { limpar(p); }
});

test('gravar-veredito: SubagentStop sem handback e sem JSON (encerramento solto) avisa', () => {
  const p = projeto();
  try {
    avisou(rodar(p, stop(p, 'Veredito entregue.')), /JSON/);
  } finally { limpar(p); }
});

test('gravar-veredito: os dois pontos disparando com o mesmo veredito gravam um arquivo so, sem aviso', () => {
  const p = projeto();
  try {
    const msg = JSON.stringify(veredito(p));
    calado(rodar(p, handback(p, msg)));
    calado(rodar(p, stop(p, msg)));   // caminho sem handback previo do mesmo agente: igual -> nada
    assert.deepStrictEqual(arquivosEm(p), ['correcao.json']);
  } finally { limpar(p); }
});

test('gravar-veredito: dois inspetores na mesma pasta gravam cada um o seu arquivo', () => {
  const p = projeto();
  try {
    calado(rodar(p, stop(p, JSON.stringify(veredito(p, { lente: 'correcao', achados: [] })), { agent_id: 'a1' })));
    calado(rodar(p, stop(p, JSON.stringify(veredito(p, { lente: 'escopo', melhor: 'B', achados: [] })), { agent_id: 'a2' })));
    assert.deepStrictEqual(arquivosEm(p), ['correcao.json', 'escopo.json']);
    assert.strictEqual(lerVeredito(p, 'escopo').melhor, 'B');
  } finally { limpar(p); }
});

test('gravar-veredito: vinte inspetores terminando juntos gravam vinte arquivos, sem aviso e sem perda', async () => {
  const p = projeto();
  try {
    const lentes = require('../scripts/lib/veredito.js').LENTES.concat(require('../scripts/lib/veredito.js').LENTES_UI);
    const rodadas = lentes.map((l, i) => new Promise((resolve) => {
      const f = spawn(process.execPath, [SCRIPT], { cwd: p.dir,
        env: Object.assign({}, process.env, { SWORN_TMP: p.estado }) });
      let out = '';
      f.stdout.on('data', (d) => { out += d; });
      f.on('close', (status) => resolve({ status: status, stdout: out }));
      f.stdin.end(JSON.stringify(stop(p, JSON.stringify(veredito(p, { lente: l.chave, achados: [] })),
        { agent_id: 'par' + i })));
    }));
    const todas = await Promise.all(rodadas);
    for (const r of todas) { assert.strictEqual(r.status, 0); assert.strictEqual(r.stdout.trim(), '', r.stdout); }
    assert.deepStrictEqual(arquivosEm(p), lentes.map((l) => l.chave + '.json').sort());
  } finally { limpar(p); }
});

// --------------------------------------------------------- nunca barra, nunca cai

test('gravar-veredito: entrada vazia, lixo e tipos absurdos saem com 0 e sem decision', () => {
  const p = projeto();
  try {
    for (const entrada of ['', 'isto nao e json', '[]', 'null', '{}']) semBarrar(rodar(p, entrada));
    for (const e of [{ hook_event_name: 'SubagentStop', agent_type: 'sworn:inspector', last_assistant_message: 7 },
      { hook_event_name: 'PostToolUse', agent_type: 'sworn:inspector', tool_name: 'SubagentHandback', tool_input: 'x' },
      { hook_event_name: 'PostToolUse', agent_type: 'sworn:inspector', tool_name: 'SubagentHandback' },
      { hook_event_name: 'SubagentStop', agent_type: 'sworn:inspector', cwd: 5, last_assistant_message: '{}' }]) {
      semBarrar(rodar(p, e));
    }
    assert.deepStrictEqual(arquivosEm(p), []);
  } finally { limpar(p); }
});

test('gravar-veredito: em nenhum caminho de aviso ha decision block, e o exit e 0', () => {
  const p = projeto();
  try {
    const ruins = [
      stop(p, ''), stop(p, 'sem json'), stop(p, JSON.stringify(veredito(p, { lente: 'elogio' }))),
      stop(p, JSON.stringify(veredito(p, { vereditos: '/nao/existe/vereditos' }))),
      stop(p, JSON.stringify(veredito(p, { melhor: 'C' }))), handback(p, 'sem json')
    ];
    for (const e of ruins) {
      const r = rodar(p, e);
      avisou(r);
      assert.ok(!/"decision"/.test(r.stdout), r.stdout);
      assert.ok(!/block/.test(r.stdout), r.stdout);
    }
  } finally { limpar(p); }
});

// ------------------------------------------------ 0.3.5 T3: as mensagens do gravador
// Cada teste abaixo foi escrito antes da mudanca e visto falhar contra o codigo da 0.3.4.

/** Roda o script com um modulo pre-carregado que faz fs.existsSync lancar para a marca do inspetor. */
function rodarComExcecao(p, entrada) {
  const pre = path.join(p.dir, 'pre-excecao.js');
  fs.writeFileSync(pre, "const fs = require('node:fs'); const orig = fs.existsSync;\n" +
    "fs.existsSync = function (x) { if (String(x).endsWith('.marca')) throw new Error('falha de teste'); return orig.apply(this, arguments); };\n");
  const r = spawnSync(process.execPath, ['--require', pre, SCRIPT], opcoes(p, entrada));
  let json = null;
  if (r.stdout && r.stdout.trim()) { try { json = JSON.parse(r.stdout); } catch (e) { json = null; } }
  return { status: r.status, json: json, stdout: r.stdout, stderr: r.stderr };
}

test('gravar-veredito (B): excecao inesperada traz a lente quando o JSON se le', () => {
  const p = projeto();
  try {
    const vd = veredito(p, { lente: 'borda', achados: [] });
    const r = rodarComExcecao(p, stop(p, JSON.stringify(vd)));
    avisou(r, /falha de teste/);
    assert.ok(/lente borda/.test(r.json.systemMessage), 'a lente nao entrou no aviso: ' + r.json.systemMessage);
    assert.ok(!/nao soube qual lente/.test(r.json.systemMessage), r.json.systemMessage);
    assert.deepStrictEqual(arquivosEm(p), []);
  } finally { limpar(p); }
});

test('gravar-veredito (B): excecao inesperada sem JSON legivel diz que nao se soube qual lente', () => {
  const p = projeto();
  try {
    for (const msg of ['Veredito entregue.', '']) {
      const r = rodarComExcecao(p, stop(p, msg));
      avisou(r, /falha de teste/);
      assert.ok(/nao soube qual lente/.test(r.json.systemMessage), 'faltou dizer que a lente e desconhecida: ' + r.json.systemMessage);
      assert.ok(!/da lente /.test(r.json.systemMessage), r.json.systemMessage);
    }
  } finally { limpar(p); }
});

test('gravar-veredito (C): o aviso diz onde e como gravar: <pasta>/<lente>.json, e cita a skill revisar', () => {
  const p = projeto();
  try {
    // lente conhecida e pasta conhecida: o caminho do arquivo vem pronto
    fs.writeFileSync(path.join(p.vereditos, 'correcao.json'), JSON.stringify(veredito(p, { melhor: 'B', achados: [] })), 'utf8');
    const r = rodar(p, stop(p, JSON.stringify(veredito(p))));
    avisouOutroConteudo(r, path.join(p.vereditos, 'correcao.json'));
    assert.ok(r.json.systemMessage.includes(path.join(p.vereditos, 'correcao.json')), r.json.systemMessage);
    // os outros avisos seguem com o "Grave esta lente a mao" (o que nao e "outro conteudo")
    fs.writeFileSync(path.join(p.vereditos, 'borda.json'), '{ quebrado', 'utf8');
    avisou(rodar(p, stop(p, JSON.stringify(veredito(p, { lente: 'borda' })), { agent_id: 'outro-aviso' })), /nao consegui le-lo/);
    // lente e pasta desconhecidas: diz o molde, sem inventar nome
    const sem = rodar(p, stop(p, 'Veredito entregue.', { agent_id: 'sem-json' }));
    avisou(sem, /JSON/);
    assert.ok(/<pasta[^>]*>\/<lente>\.json/.test(sem.json.systemMessage), sem.json.systemMessage);
  } finally { limpar(p); }
});

test('gravar-veredito (E): handback que avisa e nao grava a marca diz que o aviso pode se repetir', () => {
  const p = projeto();
  try {
    // a pasta do estado nao se cria: ja existe um ARQUIVO onde ficaria a pasta "sworn"
    fs.mkdirSync(p.estado, { recursive: true });
    fs.writeFileSync(path.join(p.estado, 'sworn'), 'x', 'utf8');
    const r = rodar(p, handback(p, 'sem json nenhum'));
    avisou(r, /JSON/);
    assert.ok(/pode se repetir/.test(r.json.systemMessage), 'faltou dizer que o aviso pode voltar: ' + r.json.systemMessage);
    // Pedido 12 (A3-04): sem o jargao interno ("marca", "subagente") e com o que fazer com a repeticao.
    assert.ok(/a repeticao e o mesmo aviso, ignore/.test(r.json.systemMessage), r.json.systemMessage);
    assert.ok(!/marca|subagente/.test(r.json.systemMessage), r.json.systemMessage);
  } finally { limpar(p); }
});

test('gravar-veredito (E): marca gravada -> o aviso do handback nao fala em repetir; gravou sem aviso -> segue calado', () => {
  const p = projeto();
  try {
    const r = rodar(p, handback(p, 'sem json nenhum'));
    avisou(r, /JSON/);
    assert.ok(!/pode se repetir/.test(r.json.systemMessage), r.json.systemMessage);
    calado(rodar(p, handback(p, JSON.stringify(veredito(p)), { agent_id: 'outro' })));
  } finally { limpar(p); }
});

// ------------------------------------------------ T2 do plano dos 82 (frente sworn-pendencias)

test('T2/F3-07 (D335 secao 2): handback que GRAVOU e nao grava a marca avisa que gravou, e que o "nao achei o JSON" do fim pode ser ignorado', () => {
  const p = projeto();
  try {
    // a pasta do estado nao se cria: ja existe um ARQUIVO onde ficaria a pasta "sworn"
    fs.mkdirSync(p.estado, { recursive: true });
    fs.writeFileSync(path.join(p.estado, 'sworn'), 'x', 'utf8');
    const vd = veredito(p, { lente: 'borda', achados: [] });
    const r = rodar(p, handback(p, JSON.stringify(vd)));
    semBarrar(r);
    assert.ok(r.json && typeof r.json.systemMessage === 'string', 'gravou, a marca falhou e o hook ficou calado: ' + r.stdout);
    const m = r.json.systemMessage;
    assert.ok(/gravei o veredito da lente borda/.test(m), 'nao diz que gravou, nem a lente: ' + m);
    assert.ok(m.includes('vereditos/borda.json'), 'nao diz o arquivo: ' + m);
    assert.ok(/nao achou o JSON do veredito/.test(m) && /ignore/.test(m), 'nao diz que o aviso do fim pode ser ignorado: ' + m);
    assert.ok(!/nao gravei/.test(m), 'e um aviso de que gravou, nao de que falhou: ' + m);
    assert.ok(!/marca|subagente/.test(m), 'jargao interno no aviso (pedido 12, A3-04): ' + m);
    assert.deepStrictEqual(arquivosEm(p), ['borda.json']);
    // gravado igual de antes (outro handback, mesma lente): o veredito esta la, e o aviso tambem
    const r2 = rodar(p, handback(p, JSON.stringify(vd), { agent_id: 'segundo' }));
    assert.ok(r2.json && /gravei o veredito da lente borda/.test(r2.json.systemMessage), r2.stdout);
    // quando o handback AVISA (nao gravou) e a marca falha, segue o aviso de sempre, sem dizer que gravou
    const r3 = rodar(p, handback(p, 'sem json nenhum', { agent_id: 'terceiro' }));
    avisou(r3, /JSON/);
    assert.ok(/pode se repetir/.test(r3.json.systemMessage) && !/^sworn: gravei o veredito/.test(r3.json.systemMessage), r3.json.systemMessage);
  } finally { limpar(p); }
  // controle: marca gravada + gravou = segue calado
  const q = projeto();
  try {
    calado(rodar(q, handback(q, JSON.stringify(veredito(q, { lente: 'borda', achados: [] })))));
    assert.deepStrictEqual(arquivosEm(q), ['borda.json']);
  } finally { limpar(q); }
});

test('T2/F3-21: a pasta da ronda tem de estar dentro da raiz do projeto (absoluta de fora nao grava)', () => {
  const p = projeto();
  const fora = tmp('fora');
  try {
    const rondaFora = path.join(fora, '.claude', 'sworn', 'revisao', 'src__a.js', '1');
    fs.mkdirSync(path.join(rondaFora, 'vereditos'), { recursive: true });
    fs.writeFileSync(path.join(rondaFora, 'A.txt'), 'a\n', 'utf8');
    fs.writeFileSync(path.join(rondaFora, 'B.txt'), 'b\n', 'utf8');
    const r = rodar(p, stop(p, JSON.stringify(veredito(p, { vereditos: path.join(rondaFora, 'vereditos') }))));
    avisou(r, /fora da pasta do projeto/);
    assert.deepStrictEqual(fs.readdirSync(path.join(rondaFora, 'vereditos')), [], 'gravou fora do projeto');
    assert.deepStrictEqual(arquivosEm(p), []);
    // controle: a relativa e a absoluta DENTRO da raiz seguem gravando
    calado(rodar(p, stop(p, JSON.stringify(veredito(p, { vereditos: path.relative(p.dir, p.vereditos), lente: 'borda', achados: [] })))));
    calado(rodar(p, stop(p, JSON.stringify(veredito(p, { vereditos: p.vereditos, lente: 'estados', achados: [] })))));
    assert.deepStrictEqual(arquivosEm(p), ['borda.json', 'estados.json']);
  } finally { limpar(p); fs.rmSync(fora, { recursive: true, force: true }); }
});

// Pedido 12 (A3-05): a guarda de cima e lexica (regex e path.relative). A pasta vereditos que e link (junction) DENTRO
// do projeto para uma pasta de FORA passava, e o veredito ia parar fora. Pelo caminho real, nao grava e avisa.
test('A3-05: vereditos que e link dentro do projeto para fora nao grava, e avisa', (t) => {
  const p = projeto();
  const fora = tmp('fora-link');
  try {
    fs.rmdirSync(p.vereditos);
    // Junction: no Windows nao pede privilegio; em POSIX o tipo e ignorado e vira link comum.
    try { fs.symlinkSync(fora, p.vereditos, 'junction'); } catch (e) {
      t.skip('nao deu para criar link neste disco/usuario (' + ((e && e.code) || 'erro') + ')');
      return;
    }
    const r = rodar(p, stop(p, JSON.stringify(veredito(p))));
    avisou(r, /passa por um link que leva para fora da pasta do projeto/);
    assert.deepStrictEqual(fs.readdirSync(fora), [], 'gravou fora do projeto pelo link');
  } finally { limpar(p); fs.rmSync(fora, { recursive: true, force: true }); }
});

/** Roda o script com um modulo pre-carregado (src) que troca uma funcao do fs antes do script carregar. */
function rodarComPre(p, entrada, src) {
  const pre = path.join(p.dir, 'pre-fs.js');
  fs.writeFileSync(pre, src, 'utf8');
  const r = spawnSync(process.execPath, ['--require', pre, SCRIPT], opcoes(p, entrada));
  let json = null;
  if (r.stdout && r.stdout.trim()) { try { json = JSON.parse(r.stdout); } catch (e) { json = null; } }
  return { status: r.status, json: json, stdout: r.stdout, stderr: r.stderr };
}

test('T2/F3-22: a causa dos erros de escrita e de leitura vem traduzida (texto.causaDoErro)', () => {
  const p = projeto();
  try {
    // escrita que falha com EACCES (nao e EEXIST): "sem permissao (EACCES)", nao o codigo cru
    const w = rodarComPre(p, stop(p, JSON.stringify(veredito(p))),
      "const fs = require('node:fs'); const orig = fs.writeFileSync;\n" +
      "fs.writeFileSync = function (f) { if (String(f).endsWith('correcao.json')) { " +
      "throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }); } return orig.apply(this, arguments); };\n");
    avisou(w, /erro ao escrever .*correcao\.json \(sem permissao \(EACCES\)\)/);
    // o que ja existe e e uma pasta: a leitura falha com EISDIR
    fs.mkdirSync(path.join(p.vereditos, 'borda.json'));
    const r = rodar(p, stop(p, JSON.stringify(veredito(p, { lente: 'borda' }))));
    avisou(r, /nao consegui le-lo \(e uma pasta \(EISDIR\)\)/);
  } finally { limpar(p); }
});

// ------------------------------------------------------------------ a fiacao

test('fiacao: o hooks.json liga o gravar-veredito no SubagentStop (inspetor) e no PostToolUse (SubagentHandback)', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(RAIZ, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const chama = (g) => JSON.stringify(g.hooks || []).indexOf('gravar-veredito.js') !== -1;

  const gs = (hooks.SubagentStop || []).filter(chama);
  assert.strictEqual(gs.length, 1, 'SubagentStop sem o gravar-veredito, ou com ele duas vezes');
  assert.strictEqual(gs[0].matcher, '^sworn:inspector$');
  assert.ok(new RegExp(gs[0].matcher).test('sworn:inspector'));
  assert.ok(!new RegExp(gs[0].matcher).test('meu-sworn:inspector'));

  const gp = (hooks.PostToolUse || []).filter(chama);
  assert.strictEqual(gp.length, 1, 'PostToolUse sem o gravar-veredito, ou com ele duas vezes');
  assert.strictEqual(gp[0].matcher, 'SubagentHandback');
  // entrada propria: o grupo do marcar-trabalho nao pode herdar o matcher dele, nem o contrario
  assert.strictEqual(gp[0].hooks.length, 1);
  const marcador = (hooks.PostToolUse || []).filter((g) => JSON.stringify(g.hooks || []).indexOf('marcar-trabalho.js') !== -1);
  assert.strictEqual(marcador.length, 1);
  assert.ok(marcador[0] !== gp[0]);
  assert.ok(marcador[0].matcher.split('|').indexOf('SubagentHandback') === -1);

  for (const g of gs.concat(gp)) {
    for (const h of g.hooks) {
      assert.strictEqual(h.command, 'node');
      assert.ok(h.args[0].indexOf('${CLAUDE_PLUGIN_ROOT}/scripts/gravar-veredito.js') === 0, h.args[0]);
      assert.ok(fs.existsSync(path.join(RAIZ, 'scripts', 'gravar-veredito.js')));
      assert.ok(h.timeout > 0);
    }
  }
});

test('fiacao: o inspetor devolve a pasta vereditos e o briefing da skill a passa (D287)', () => {
  const inspetor = fs.readFileSync(path.join(RAIZ, 'agents', 'inspector.md'), 'utf8');
  assert.ok(/"vereditos":/.test(inspetor), 'o formato do JSON do inspetor nao tem o campo vereditos');
  const skill = fs.readFileSync(path.join(RAIZ, 'skills', 'review', 'SKILL.md'), 'utf8');
  const briefing = skill.slice(skill.indexOf('Briefing of each one'), skill.indexOf('The ruler line only'));
  assert.ok(/vereditos/.test(briefing), 'o briefing nao passa o caminho da pasta vereditos');
  const passo2 = skill.slice(skill.indexOf('## Step 2'), skill.indexOf('## Step 3'));
  assert.ok(/hook/.test(passo2) && /gravar-veredito/.test(passo2), 'o Passo 2 nao diz que o hook grava');
  assert.ok(!/Write each (response|answer) (to|at) the path/.test(skill), 'a instrucao de gravar cada resposta a mao continua');
  assert.ok(/one\s+file per dispatched lens/.test(passo2), 'o Passo 2 nao manda conferir um arquivo por lente');
});

test('D503: fiacao da referencia - o inspetor devolve vsReferencia e lacunas; a skill passa R.txt e a 2a passada e diz o custo', () => {
  const inspetor = fs.readFileSync(path.join(RAIZ, 'agents', 'inspector.md'), 'utf8');
  assert.match(inspetor, /"vsReferencia":/, 'o JSON do inspetor nao tem vsReferencia');
  assert.match(inspetor, /"lacunas":/, 'o JSON do inspetor nao tem lacunas');
  assert.match(inspetor, /R\.txt/, 'o inspetor nao sabe do R.txt');
  const skill = fs.readFileSync(path.join(RAIZ, 'skills', 'review', 'SKILL.md'), 'utf8');
  const passo2 = skill.slice(skill.indexOf('## Step 2'), skill.indexOf('## Step 3'));
  assert.match(passo2, /R\.txt/, 'o Passo 2 nao passa o R.txt');
  assert.match(passo2, /`invertida\.vereditos`/, 'o briefing da 2a passada nao troca a pasta de vereditos');
  assert.match(passo2, /`invertida\.a` and `invertida\.b`/, 'o briefing da 2a passada nao troca os dois arquivos');
  assert.match(passo2, /doubles/i, 'o Passo 2 nao diz que o custo dobra');
  const passo3 = skill.slice(skill.indexOf('## Step 3'), skill.indexOf('## Step 4'));
  assert.match(passo3, /`referencia`/, 'o Passo 3 nao fala do campo referencia da saida');
  assert.match(passo3, /"passada": 2/, 'o Passo 3 nao diz como refutar achado da 2a passada');
  const passo5 = skill.slice(skill.indexOf('## Step 5'), skill.indexOf('## Step 6'));
  assert.match(passo5, /only approve when every lens ties or beats the reference in both orders/,
    'o Passo 5 nao diz a parada com referencia');
  // F2a (D828.2/.3/.5): o P2 de melhoria nao tem mais linha no teto (vira registro desde a ronda 1); o teto manda
  // consertar com teste, rodar a suite e commitar com a marca, sem perguntar e sem revisao nova
  assert.match(passo5, /\| cap of 3 rounds with P0, P1 or P2 `erro` open, or the reference not reached \| \*\*Do not ask, and do not open a new review\.\*\*[^|]*broken on purpose[^|]*whole suite[^|]*`# sworn: sem-revisao`[^|]*record of the plan \|/,
    'o teto nao manda consertar com teste e commitar com a marca');
  assert.doesNotMatch(passo5, /stronger agent|only P2 `melhoria` open|Four possible/, 'o Passo 5 guarda a pratica de antes');
  assert.match(passo5, /Three possible outcomes:/, 'o Passo 5 nao conta tres saidas');
  assert.match(passo3, /`registros`[\s\S]*`melhoria`[\s\S]*`linha nova`[\s\S]*record of the plan/,
    'o Passo 3 nao fala dos registros');
  const passo4 = skill.slice(skill.indexOf('## Step 4'), skill.indexOf('## Step 5'));
  assert.match(passo4, /a P2 `melhoria` never does/, 'o Passo 4 nao diz que a melhoria nao segura');
  assert.match(passo4, /\*\*Rounds 2 and 3 only verify\.\*\*/, 'o Passo 4 nao diz que as rondas 2 e 3 so verificam');
});

// Plano 082, Tarefa 6 (p4-2, p4-3, p4-4): o inspetor sabe ler cada bloco do R.txt, o que devolver contra a referencia
// quando nao a ve, e o "nao tem acesso" nao contradiz a regua.md e o R.txt.
test('082 T6 (p4-2, p4-3, p4-4): o inspetor le os blocos do R.txt e sabe o que devolver contra a referencia sem ve-la', () => {
  const inspetor = fs.readFileSync(path.join(RAIZ, 'agents', 'inspector.md'), 'utf8');
  const ref = inspetor.slice(inspetor.indexOf('## When the briefing passes an `R.txt`'), inspetor.indexOf('## Provenance'));
  for (const t of ['=== referencia i de n: <entrada> ===', '`\\===`', '(imagem ou binario: abra com Read em "<caminho>")',
    '(maior que o teto do R.txt', '(URL:', '(NAO ACHADA', '`vsReferencia` and `lacunas` come from the blocks you read']) {
    assert.ok(ref.indexOf(t) !== -1, 'falta na secao do R.txt: ' + t);
  }
  const prov = inspetor.slice(inspetor.indexOf('## Provenance'));
  assert.ok(!/nothing (beyond|besides|other than) the two files/.test(prov), 'o "nada alem dos dois arquivos" contradiz a regua.md e o R.txt');
  assert.match(prov, /regua\.md/);
  assert.match(prov, /"vsReferencia": \{ "A": "perde", "B": "perde" \}/, 'o "nao sei" nao diz o que devolver contra a referencia');
  assert.match(prov, /"lacunas": \[\]/);
});

// D503/D508 (plano d503, E9): o pacote com referencia tem R.txt e a 2a passada em <ronda>/invertida/vereditos.
function projetoComReferencia() {
  const p = projeto();
  const inv = path.join(p.ronda, 'invertida');
  fs.mkdirSync(path.join(inv, 'vereditos'), { recursive: true });
  fs.writeFileSync(path.join(inv, 'A.txt'), 'b\n', 'utf8');
  fs.writeFileSync(path.join(inv, 'B.txt'), 'a\n', 'utf8');
  fs.writeFileSync(path.join(p.ronda, 'R.txt'), '=== referencia 1 de 1: ref/topo.js ===\ntopo\n', 'utf8');
  return Object.assign(p, { invertida: path.join(inv, 'vereditos') });
}

test('D503 E9: o veredito da 2a passada (invertida/vereditos) e gravado la', () => {
  const p = projetoComReferencia();
  const vd = veredito(p, { vereditos: p.invertida, vsReferencia: { A: 'perde', B: 'vence' }, lacunas: [] });
  calado(rodar(p, stop(p, JSON.stringify(vd))));
  assert.ok(fs.existsSync(path.join(p.invertida, 'correcao.json')), 'a 2a passada nao foi gravada');
  assert.ok(!fs.existsSync(path.join(p.vereditos, 'correcao.json')), 'gravou na pasta da 1a passada');
});

test('D503 E9: no pacote com referencia, veredito sem vsReferencia nao e gravado e o aviso diz o campo', () => {
  const p = projetoComReferencia();
  for (const pasta of [p.vereditos, p.invertida]) {
    const r = rodar(p, stop(p, JSON.stringify(veredito(p, { vereditos: pasta }))));
    avisou(r);
    assert.match(r.json.systemMessage, /vsReferencia/);
    assert.ok(!fs.existsSync(path.join(pasta, 'correcao.json')));
  }
  // sem R.txt, o mesmo veredito grava como hoje
  const sem = projeto();
  calado(rodar(sem, stop(sem, JSON.stringify(veredito(sem)))));
  assert.ok(fs.existsSync(path.join(sem.vereditos, 'correcao.json')));
});

test('D503 E9: invertida/vereditos fora de uma ronda com referencia (sem R.txt acima) nao e aceita', () => {
  const p = projetoComReferencia();
  // revisao/<id>/outra/invertida/vereditos casa o formato do caminho e tem A.txt e B.txt ao lado; "outra" nao e ronda
  const inv = path.join(p.dir, '.claude', 'sworn', 'revisao', 'src__a.js', 'outra', 'invertida');
  fs.mkdirSync(path.join(inv, 'vereditos'), { recursive: true });
  fs.writeFileSync(path.join(inv, 'A.txt'), 'b\n', 'utf8');
  fs.writeFileSync(path.join(inv, 'B.txt'), 'a\n', 'utf8');
  const vd = veredito(p, { vereditos: path.join(inv, 'vereditos'), vsReferencia: { A: 'vence', B: 'vence' }, lacunas: [] });
  const r = rodar(p, stop(p, JSON.stringify(vd)));
  avisou(r);
  assert.match(r.json.systemMessage, /ronda com referencia/);
  assert.ok(!fs.existsSync(path.join(inv, 'vereditos', 'correcao.json')));
});

// Plano 082, Tarefa 6 (p1-1): "invertida" so e a 2a passada dentro de uma ronda numerada; revisao/<id>/invertida/ com
// A.txt, B.txt e R.txt no <id> passava pela 2a passada de uma "ronda" que o apurar nunca le.
test('082 T6 (p1-1): invertida/ fora de uma ronda numerada nao vira 2a passada, mesmo com A, B e R.txt acima', () => {
  const p = projetoComReferencia();
  const base = path.join(p.dir, '.claude', 'sworn', 'revisao', 'src__a.js');
  for (const n of ['A.txt', 'B.txt', 'R.txt']) fs.writeFileSync(path.join(base, n), 'x\n', 'utf8');
  const inv = path.join(base, 'invertida');
  fs.mkdirSync(path.join(inv, 'vereditos'), { recursive: true });
  fs.writeFileSync(path.join(inv, 'A.txt'), 'b\n', 'utf8');
  fs.writeFileSync(path.join(inv, 'B.txt'), 'a\n', 'utf8');
  const vd = veredito(p, { vereditos: path.join(inv, 'vereditos'), vsReferencia: { A: 'vence', B: 'vence' }, lacunas: [] });
  const r = rodar(p, stop(p, JSON.stringify(vd)));
  avisou(r);
  assert.match(r.json.systemMessage, /pasta numerada/);
  assert.ok(!fs.existsSync(path.join(inv, 'vereditos', 'correcao.json')));
});

// Colheita 10-20, lote 3/4a: o inspetor devolve o estado de cada achado; a skill diz o que fazer com os pendentes e com
// o trecho que nao confere.
test('lote 3/4a: o inspetor devolve estado, trecho e falta; a skill le pendentes e trechoNaoConfere', () => {
  const inspetor = fs.readFileSync(path.join(RAIZ, 'agents', 'inspector.md'), 'utf8');
  const formato = inspetor.slice(inspetor.indexOf('## What you return'), inspetor.indexOf('## When the briefing passes'));
  for (const t of ['"estado": "confirmado"', '"trecho":', '"estado": "pendente"', '"falta":']) {
    assert.ok(formato.indexOf(t) !== -1, 'falta no formato do inspetor: ' + t);
  }
  const blocoPendente = formato.slice(formato.indexOf('"estado": "pendente"'));
  assert.ok(!/"severidade"/.test(blocoPendente.slice(0, blocoPendente.indexOf('}'))), 'o pendente do formato traz severidade');
  assert.match(inspetor, /copied from the cited file/i, 'o inspetor nao sabe que o trecho e copiado do arquivo citado');
  assert.match(inspetor, /`lacunas`[\s\S]{0,80}no `estado`/, 'o inspetor nao sabe que a lacuna fica sem estado');
  const prov = inspetor.slice(inspetor.indexOf('## Provenance'));
  assert.match(prov, /`pendente`, with what you can't see in `falta`/, 'o "nao sei" contradiz o pendente');
  const skill = fs.readFileSync(path.join(RAIZ, 'skills', 'review', 'SKILL.md'), 'utf8');
  const passo3 = skill.slice(skill.indexOf('## Step 3'), skill.indexOf('## Step 4'));
  assert.match(passo3, /`pendentes`/, 'o Passo 3 nao fala dos pendentes');
  assert.match(passo3, /`trechoNaoConfere`/, 'o Passo 3 nao fala do trecho que nao confere');
});

// A4 (s369): o veredito recusado (JSON quebrado do inspetor, achado sem trecho) avisava so na tela do dono
// (systemMessage); quem orquestra a revisao so descobria contando os arquivos. No handback (PostToolUse) o mesmo aviso
// vai ao modelo, que grava a mao ou chama o inspetor de novo.
test('A4: o veredito recusado no handback chega tambem ao modelo, com a causa e o que fazer', () => {
  const p = projeto();
  try {
    // o caso real da s369: a lente microcopy devolveu `"arquivo":"B.txt":"B.txt"`
    const quebrado = '{"lente":"microcopy","vereditos":' + JSON.stringify(p.vereditos) +
      ',"melhor":"empate","porQue":"x","achados":[{"estado":"confirmado","severidade":"P2","arquivo":"B.txt":"B.txt",' +
      '"linha":1,"trecho":"t","descricao":"d","comoFalha":"c"}]}';
    for (const msg of [quebrado, JSON.stringify(veredito(p, { achados: [{ estado: 'confirmado', severidade: 'P1',
      arquivo: 'A.txt', linha: 1, trecho: '', descricao: 'd', comoFalha: 'c' }] }))]) {
      const r = rodar(p, handback(p, msg));
      avisou(r);
      const ctx = r.json.hookSpecificOutput && r.json.hookSpecificOutput.additionalContext;
      assert.strictEqual(r.json.hookSpecificOutput.hookEventName, 'PostToolUse');
      assert.strictEqual(ctx, r.json.systemMessage, 'o modelo recebe o mesmo aviso: ' + JSON.stringify(r.json));
    }
    // o gravado segue calado; o SubagentStop segue so com systemMessage (o evento nao leva contexto ao modelo)
    calado(rodar(p, handback(p, JSON.stringify(veredito(p)), { agent_id: 'outro-a4' })));
    const s = rodar(p, stop(p, 'sem json nenhum', { agent_id: 'terceiro-a4' }));
    avisou(s);
    assert.strictEqual(s.json.hookSpecificOutput, undefined, 'SubagentStop sem hookSpecificOutput');
  } finally {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
});

// D820 (D1): o voto de seguranca com P1 sem a fronteira nao e gravado - o aviso diz o campo, e a lente roda de novo
test('D820: o voto de seguranca sem a fronteira nao se grava, e o aviso diz o campo; com ela, grava', () => {
  const p = projeto();
  try {
    const sem = veredito(p, { lente: 'seguranca' });
    const r = rodar(p, handback(p, JSON.stringify(sem)));
    avisou(r, /fronteira/);
    assert.deepStrictEqual(arquivosEm(p), [], 'nada gravado');
    const com = veredito(p, { lente: 'seguranca', achados: [Object.assign({}, sem.achados[0],
      { fronteira: { entrada: 'o nome vindo do usuario', controle: 'a guarda de caminho', efeito: 'le fora da pasta' } })] });
    calado(rodar(p, handback(p, JSON.stringify(com), { agent_id: 'outro-d820' })));
    assert.deepStrictEqual(arquivosEm(p), ['seguranca.json']);
  } finally {
    limpar(p);
  }
});

// F2b (D828): o P2 confirmado sem `tipo` e veredito invalido. O gancho nao grava e avisa com a causa; com o tipo, grava.
test('F2b: o veredito com P2 sem tipo nao e gravado e o aviso diz o que falta; com tipo erro ou melhoria, grava', () => {
  const p2 = (tipo) => Object.assign({ estado: 'confirmado', trecho: 'x', severidade: 'P2', arquivo: 'B.txt', linha: 3,
    descricao: 'nome que confunde', comoFalha: 'le o valor errado' }, tipo === undefined ? {} : { tipo: tipo });
  for (const tipo of [undefined, 'outra coisa']) {
    const p = projeto();
    try {
      const r = rodar(p, stop(p, JSON.stringify(veredito(p, { achados: [p2(tipo)] }))));
      avisou(r, /veredito invalido \(1 achado\(s\) P2 sem "tipo"/);
      assert.deepStrictEqual(arquivosEm(p), [], String(tipo));
    } finally {
      limpar(p);
    }
  }
  for (const tipo of ['erro', 'melhoria']) {
    const p = projeto();
    try {
      calado(rodar(p, stop(p, JSON.stringify(veredito(p, { achados: [p2(tipo)] })))));
      assert.strictEqual(lerVeredito(p, 'correcao').achados[0].tipo, tipo);
    } finally {
      limpar(p);
    }
  }
});

test('F2b: o inspetor e a skill dizem que o P2 sem tipo invalida o veredito e que a ronda 1 sem achado aprova sozinha', () => {
  const inspetor = fs.readFileSync(path.join(RAIZ, 'agents', 'inspector.md'), 'utf8');
  assert.match(inspetor, /A `P2` without `tipo` invalidates the whole verdict/);
  assert.doesNotMatch(inspetor, /counts as `erro`/);
  const skill = fs.readFileSync(path.join(RAIZ, 'skills', 'review', 'SKILL.md'), 'utf8');
  // sem o titulo, o indexOf da -1 e o recorte sai vazio ou errado: o doesNotMatch passaria sem conferir nada
  for (const n of [3, 4, 5, 6]) assert.ok(skill.includes('\n## Step ' + n + ' '), 'a skill perdeu o titulo do Passo ' + n);
  const passo3 = skill.slice(skill.indexOf('## Step 3'), skill.indexOf('## Step 4'));
  assert.match(passo3, /\*\*Every confirmed P2 says its `tipo`\*\*[\s\S]*complete the field yourself with `"erro"`[\s\S]*Never write `"melhoria"` yourself/);
  const passo4 = skill.slice(skill.indexOf('## Step 4'), skill.indexOf('## Step 5'));
  assert.doesNotMatch(passo4, /counts as `erro`/);
  const passo5 = skill.slice(skill.indexOf('## Step 5'), skill.indexOf('## Step 6'));
  assert.match(passo5, /\*\*Round 1 approves by itself\*\* when every lens of the band voted and no verdict brings a finding other than a\s+`melhoria`/);
  assert.match(passo5, /P2 `melhoria` on the new side goes to the record and does not hold the round \(a P0 or P1 marked `melhoria`, or one on\s+the old side, still does\)/);
  assert.ok(passo5.includes('`ronda 1 completa sem achado nenhum: aprovado`'), 'o Passo 5 nao cita o motivo que o script escreve');
  assert.ok(passo5.includes('`ronda 1 completa so com melhoria (vai ao registro): aprovado`'), 'o Passo 5 nao cita o motivo da melhoria');
  assert.match(passo5, /\| two dry rounds, or round 1 complete with no finding other than a P2 `melhoria` \(with a reference: and `referencia\.pronta`\) \| Approved\./);
});

// F2d (a): o playbook e as referencias dele diziam a regra velha (seca = sem P1 ou acima; P2 nunca segura; o teto
// levado a quem decide), e a skill nao dizia como e o briefing nem o modelo das rondas 2 e 3.
test('F2d: o playbook e a skill dizem a regra nova das rondas, do P2 de erro e do teto sem perguntar', () => {
  // CRLF sai na leitura: no checkout do Windows com autocrlf, a quebra de linha vem com \r
  const ler = function (rel) { return fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n'); };
  // a secao do titulo ate o titulo seguinte do mesmo nivel; sem um dos dois, o recorte nao confere nada
  const secao = function (texto, titulo, proximo) {
    const ini = texto.indexOf(titulo);
    const fim = texto.indexOf(proximo, ini + 1);
    assert.ok(ini !== -1 && fim !== -1, 'perdeu o titulo ' + titulo + ' ou o seguinte');
    return texto.slice(ini, fim);
  };
  const s44 = secao(ler('skills/playbook/SKILL.md'), '### 4.4 Convergence with a cap', '\n## 5. ');
  const s4 = secao(ler('skills/playbook/references/03-inspecao-cega.md'), '\n## 4. Convergence', '\n## 5');
  const marchas = ler('skills/playbook/references/01-marchas-e-gates.md');
  const skill = ler('skills/review/SKILL.md');
  // a tabela de severidade da 4.4 separa o P2 de erro do de melhoria
  assert.match(s44, /\| \*\*P2 `erro`\*\* \|[^\n]*\| Holds the round, like a P1: it is fixed \|/);
  assert.match(s44, /\| \*\*P2 `melhoria`\*\* \|[^\n]*\| Becomes a record, \*\*does not\*\* become a fix \|/);
  // as frases da regra velha, nas duas secoes (teto da revisao da F2d: so a secao 4 do 03 as proibia)
  const velhas = /P1 or above|P2 never reopens|take it to `\{\{campo:quemDecide\}\}`|fix only P0 and P1|had a P0\/P1 finding|that is a decision for `\{\{campo:quemDecide\}\}`/;
  for (const [nome, texto] of [['playbook 4.4', s44], ['03-inspecao-cega secao 4', s4]]) {
    assert.doesNotMatch(texto, velhas, nome + ': a regra velha');
    assert.match(texto, /P0, P1 or P2 `erro`/, nome);
    assert.match(texto, /round 1 (in which no lens points out anything at all|with no finding at all)/, nome);
    assert.match(texto, /do not ask/, nome);
    assert.match(texto, /`# sworn: sem-revisao`/, nome);
    assert.match(texto, /becomes a record/, nome);
  }
  assert.doesNotMatch(marchas, /ten for code, eight for screen/);
  assert.match(marchas, /stop at 2 dry rounds or at a complete round 1 with no finding\n? *at all/);
  const passo4 = skill.slice(skill.indexOf('## Step 4'), skill.indexOf('## Step 5'));
  // D829: as rondas 2 e 3 um degrau abaixo da ronda 1, pelo portao do juiz (nao mais o Haiku fixo)
  assert.match(passo4, /\*\*Rounds 2 and 3 run one step below round 1\*\*/);
  assert.match(passo4, /`scripts\/portao-juiz\.js`/);
  assert.doesNotMatch(passo4, /`model: "haiku"`/);
  assert.match(passo4, /the briefing never asks the inspector to look at the rest/);
  assert.doesNotMatch(skill, /an improvement left at the cap becomes a record/);
  // F2d parte b: o juiz so recebe os pares fortes; e so o P2 de erro se conserta dentro do pedido
  const passo3 = skill.slice(skill.indexOf('## Step 3'), skill.indexOf('## Step 4'));
  assert.match(passo3, /If `paresFortes` is not empty, dispatch \*\*one\*\*\n *`sworn:dedupe-judge` subagent with that list/);
  assert.doesNotMatch(passo3, /If the output brings a non-empty `paresCandidatos`, dispatch/);
  assert.match(skill, /A P2 `erro` is fixed when it is part of what was requested/);
  // F2d parte c: na completa, a saida traz as lentes escolhidas pelo risco, e a skill manda despachar so elas
  const passo2 = skill.slice(skill.indexOf('## Step 2'), skill.indexOf('## Step 3'));
  assert.match(passo2, /\*\*In the `completa` band the output of Step 1 brings `lentes`, chosen by risk\*\*/);
  assert.match(passo2, /Dispatch every lens in `lentes`/);
  assert.match(passo2, /You can add a lens the script left out, never drop one/);
  assert.match(passo2, /`estados` and `borda`\n? *stay apart/);
});

// L3-s105-6: a resposta da conferencia ({ lente, conferencia }) so se grava na ronda de conferencia (mapa.json com
// `conferencia`), e a ronda de conferencia so recebe essa resposta
test('L3-s105-6: gravar-veredito grava a resposta da conferencia so na ronda de conferencia', () => {
  const p = projeto();
  try {
    const resposta = { lente: 'correcao', conferencia: [{ id: 1, corrigido: true }], vereditos: p.vereditos };
    avisouChamarDeNovo(rodar(p, stop(p, JSON.stringify(resposta))), /^sworn: nao gravei o veredito da lente correcao: a resposta traz a lista "conferencia", e a ronda .+ nao e de conferencia\./);
    assert.deepStrictEqual(arquivosEm(p), []);
    fs.writeFileSync(path.join(p.ronda, 'mapa.json'), JSON.stringify({ arquivo: 'src/a.js', mapa: { A: 'trabalho', B: 'HEAD' },
      conferencia: { abertos: [{ id: 1, lente: 'correcao' }], lentes: ['correcao'] } }), 'utf8');
    avisouChamarDeNovo(rodar(p, stop(p, JSON.stringify(veredito(p)))), /e de conferencia, e a resposta nao traz a lista "conferencia"\./);
    assert.deepStrictEqual(arquivosEm(p), []);
    // a lista vazia nao confere nada: recusa com o motivo, sem gravar
    avisou(rodar(p, stop(p, JSON.stringify(Object.assign({}, resposta, { conferencia: [] })))), /a lista "conferencia" veio vazia/);
    assert.deepStrictEqual(arquivosEm(p), []);
    calado(rodar(p, stop(p, JSON.stringify(resposta))));
    assert.deepStrictEqual(lerVeredito(p, 'correcao'), resposta);
  } finally { limpar(p); }
});
