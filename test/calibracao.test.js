'use strict';
// Item 2 da 0.7 (D466/D467): o calibrador por projeto. Os scripts de medicao da D464 viram comando do
// plugin: le as transcricoes principais do proprio projeto, mede o custo por faixa de contexto, simula a
// troca de chat no fim de turno do dono e sugere `limiares.tokensDeContexto`. So numeros saem dele.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const cal = require('../scripts/lib/calibracao.js');
const saude = require('../scripts/lib/saude.js');

const SEGREDO = 'frase-que-nunca-pode-sair-do-calibrador';
let relogio = Date.parse('2026-10-01T10:00:00Z');
let serial = 0;

/** Uma chamada da linha principal com contexto C (tokens), toda lida do cache. */
function chamada(C, extra) {
  relogio += 60000;
  const e = extra || {};
  return JSON.stringify({
    type: 'assistant', timestamp: new Date(relogio).toISOString(), isSidechain: e.lado === true,
    message: {
      id: e.id || 'msg_' + (++serial), model: e.modelo || 'claude-opus-5-5',
      usage: { input_tokens: 0, cache_read_input_tokens: C - (e.escrita || 0), cache_creation_input_tokens: e.escrita || 0,
        output_tokens: 100, cache_creation: { ephemeral_1h_input_tokens: e.escrita || 0, ephemeral_5m_input_tokens: 0 } },
      content: e.conteudo || [{ type: 'text', text: e.texto || 'feito' }]
    }
  });
}

function fala(texto) {
  relogio += 60000;
  return JSON.stringify({ type: 'user', timestamp: new Date(relogio).toISOString(), message: { role: 'user', content: texto } });
}

function pasta() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'esq-cal-'));
}

// ── leitura de uma sessao ────────────────────────────────────────────────

test('calibracao: lerSessao soma o contexto, junta linhas da mesma mensagem e pula subagente e sintetica', () => {
  const linhas = [
    fala('comeca'),
    chamada(60000, { id: 'a' }),
    chamada(60000, { id: 'a' }),                       // mesma mensagem em duas linhas: uma chamada so
    chamada(90000, { lado: true }),                    // subagente: fora
    chamada(70000, { modelo: '<synthetic>' }),         // sintetica: fora
    chamada(80000, { modelo: 'modelo-sem-preco' }),    // fora da tabela: conta em semPreco
    'linha torta {',
    chamada(100000)
  ];
  const s = cal.lerSessao(linhas.join('\n'));
  assert.deepStrictEqual(s.chamadas.map((c) => c.C), [60000, 100000]);
  assert.strictEqual(s.semPreco, 1);
});

test('calibracao: o custo da chamada usa a tabela de preco (leitura de cache, escrita de 1h, saida)', () => {
  const s = cal.lerSessao([chamada(1000000, { escrita: 200000 })].join('\n'));
  const p = cal.PRECOS['claude-opus-5-5'];
  const esperado = (800000 * p[2] + 100 * p[1] + 200000 * p[4]) / 1e6;
  assert.ok(Math.abs(s.chamadas[0].custo - esperado) < 1e-9, s.chamadas[0].custo + ' != ' + esperado);
});

test('calibracao: fim de turno do dono = a ultima chamada antes de uma fala real do dono', () => {
  const linhas = [
    fala('primeiro pedido'), chamada(60000), chamada(61000),
    fala('<system-reminder>lembrete</system-reminder>'),   // nao e fala do dono
    chamada(62000),
    fala('segundo pedido'), chamada(63000)
  ];
  const s = cal.lerSessao(linhas.join('\n'));
  // -1: a primeira fala vem antes de qualquer chamada
  assert.deepStrictEqual(s.prompts, [-1, 2]);
});

test('calibracao: sessao de handoff e reconhecida pela primeira fala, sem guardar o texto', () => {
  const s = cal.lerSessao([fala('Ler o handoff e continuar de onde parou. ' + SEGREDO), chamada(60000)].join('\n'));
  assert.strictEqual(s.deHandoff, true);
  assert.ok(JSON.stringify(s).indexOf(SEGREDO) === -1, 'o texto da conversa vazou para o resultado');
});

test('calibracao: paradas classificam a ultima fala do agente antes do dono (paradas.mjs da s90)', () => {
  const linhas = [
    fala('pedido'),
    chamada(60000, { texto: 'Pronto. Abra o navegador e recarregue a extensao.' }),
    fala('feito'),
    chamada(61000, { texto: 'Posso seguir para o item 2?' }),
    fala('sim'),
    chamada(62000, { conteudo: [{ type: 'tool_use', name: 'AskUserQuestion', input: {} }] })
  ];
  const s = cal.lerSessao(linhas.join('\n'));
  assert.deepStrictEqual(s.paradas.map((p) => p.classe), ['pede acao manual ao dono', 'pede licenca para seguir']);
  assert.strictEqual(s.perguntas, 1);
});

test('calibracao: so gravar o handoff marca a chamada; ler o handoff na abertura nao marca (D471)', () => {
  const ler = { type: 'tool_use', name: 'Read', input: { file_path: 'C:/proj/.context/plans/2026-10-12-x-handoff.md' } };
  const gravar = { type: 'tool_use', name: 'Write', input: { file_path: 'C:/proj/.context/plans/2026-10-12-y-handoff.md' } };
  const s = cal.lerSessao([fala('pedido'), chamada(60000, { conteudo: [ler] }), chamada(61000), chamada(62000, { conteudo: [gravar] })].join('\n'));
  assert.deepStrictEqual(s.chamadas.map((c) => c.handoff), [false, false, true]);
});

// ── segmentos, troca e simulacao ─────────────────────────────────────────

test('calibracao: compactacao (queda brusca acima de 80K) abre segmento novo', () => {
  const sessao = cal.lerSessao([fala('x'), chamada(200000), chamada(210000), chamada(90000), chamada(95000)].join('\n'));
  const segs = cal.segmentar([sessao]);
  assert.deepStrictEqual(segs.map((g) => g.chamadas.length), [2, 2]);
});

test('calibracao: sem trocas medidas suficientes, o custo da troca e o padrao da D464', () => {
  const t = cal.custoDaTroca([]);
  assert.strictEqual(t.medida, false);
  assert.strictEqual(t.custo, cal.TROCA_PADRAO.custo);
  assert.strictEqual(t.recomeco, cal.TROCA_PADRAO.recomeco);
});

test('calibracao: simular so troca no fim de turno do dono, depois de cruzar o limiar', () => {
  // turno longo acima do limiar: nenhuma troca ate o dono falar
  const linhas = [fala('x')];
  for (let i = 0; i < 6; i++) linhas.push(chamada(300000 + i * 1000));
  linhas.push(fala('proximo'));
  for (let i = 0; i < 20; i++) linhas.push(chamada(310000 + i * 1000));
  const segs = cal.segmentar([cal.lerSessao(linhas.join('\n'))]);
  const x = cal.simular(segs, 250000, 3.4, 119000);
  assert.strictEqual(x.trocas, 1);
  // 20 chamadas lendo ~190K a menos do cache pagam menos que a troca de US$ 3,40
  const leituraPoupada = 20 * (310000 - 119000) * cal.PRECOS['claude-opus-5-5'][2] / 1e6;
  assert.ok(Math.abs(x.delta - (3.4 - leituraPoupada)) < 0.05, x.delta + ' vs ' + (3.4 - leituraPoupada));
  assert.strictEqual(cal.simular(segs, 400000, 3.4, 119000).trocas, 0);
});

test('calibracao: escolher pega o menor limiar em que trocar nao sai mais caro que nao trocar', () => {
  const linhas = [{ T: 150000, delta: 9 }, { T: 200000, delta: 1.3 }, { T: 250000, delta: -0.5 }, { T: 400000, delta: -2.6 }];
  assert.strictEqual(cal.escolher(linhas).tokensDeContexto, 250000);
  const caras = [{ T: 150000, delta: 9 }, { T: 300000, delta: 2 }, { T: 400000, delta: 4 }];
  const e = cal.escolher(caras);
  assert.strictEqual(e.tokensDeContexto, 300000);
  assert.ok(/nenhum/.test(e.motivo), e.motivo);
});

test('calibracao: os candidatos ficam abaixo do alarme', () => {
  assert.ok(cal.CANDIDATOS.every((T) => T < saude.LIMIARES_PADRAO.tokensAlarme));
  assert.ok(cal.CANDIDATOS.indexOf(saude.LIMIARES_PADRAO.tokensDeContexto) !== -1, 'o padrao tem de ser candidato');
});

test('calibracao: amostra pequena fica no padrao da D464 e diz por que', () => {
  const s = cal.lerSessao([fala('x'), chamada(60000), chamada(70000), chamada(80000)].join('\n'));
  const r = cal.calibrar([s], {});
  assert.strictEqual(r.sugestao.suficiente, false);
  assert.strictEqual(r.sugestao.tokensDeContexto, saude.LIMIARES_PADRAO.tokensDeContexto);
  assert.ok(/amostra pequena/.test(r.sugestao.motivo), r.sugestao.motivo);
});

// ── a pasta das transcricoes ─────────────────────────────────────────────

test('calibracao: o nome da pasta do projeto troca todo caractere fora de letra e numero por hifen', () => {
  const raiz = process.platform === 'win32' ? 'C:\\obra\\meu app.v2' : '/obra/meu app.v2';
  const esperado = process.platform === 'win32' ? 'C--obra-meu-app-v2' : '-obra-meu-app-v2';
  assert.strictEqual(cal.nomeDaPasta(raiz), esperado);
});

test('calibracao: acha a pasta das transcricoes sem diferenciar maiuscula (o VS Code manda a unidade minuscula)', () => {
  const casa = pasta();
  const raiz = path.join(casa, 'obra');
  const nome = cal.nomeDaPasta(raiz).toLowerCase();
  fs.mkdirSync(path.join(casa, '.claude', 'projects', nome), { recursive: true });
  try {
    assert.strictEqual(cal.pastaDasTranscricoes(raiz, {}, casa), path.join(casa, '.claude', 'projects', nome));
    assert.strictEqual(cal.pastaDasTranscricoes(path.join(casa, 'outra'), {}, casa), null);
  } finally { fs.rmSync(casa, { recursive: true, force: true }); }
});

// ── o comando ────────────────────────────────────────────────────────────

function rodar(args, cwd) {
  return spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'calibrar.js')].concat(args),
    { cwd: cwd, encoding: 'utf8', env: Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: path.join(cwd, 'sem-config') }) });
}

test('calibrar.js: --pasta le as transcricoes e imprime so numeros', () => {
  const dir = pasta();
  const trans = path.join(dir, 'trans');
  fs.mkdirSync(trans);
  fs.writeFileSync(path.join(trans, 's1.jsonl'), [fala(SEGREDO), chamada(60000), chamada(70000), chamada(80000)].join('\n'));
  fs.mkdirSync(path.join(trans, 's1'));   // pasta de subagentes ao lado: nao entra
  try {
    const r = rodar(['--pasta', trans], dir);
    assert.strictEqual(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.strictEqual(j.amostra.sessoes, 1);
    assert.strictEqual(j.sugestao.tokensDeContexto, saude.LIMIARES_PADRAO.tokensDeContexto);
    assert.ok(r.stdout.indexOf(SEGREDO) === -1, 'o texto da conversa vazou na saida');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('calibrar.js: sem pasta de transcricoes achada, sai 1 e manda passar --pasta', () => {
  const dir = pasta();
  try {
    const r = rodar([], dir);
    assert.strictEqual(r.status, 1);
    assert.ok(/--pasta/.test(JSON.parse(r.stdout).erro), r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('calibrar.js: --gravar poe limiares.tokensDeContexto no projeto.json e preserva o resto', () => {
  const dir = pasta();
  const arq = path.join(dir, '.claude', 'sworn', 'projeto.json');
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, '\uFEFF' + JSON.stringify({ shell: 'bash', limiares: { commits: 5 } }));
  try {
    const r = rodar(['--gravar', '300000'], dir);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const j = JSON.parse(fs.readFileSync(arq, 'utf8'));
    assert.deepStrictEqual(j, { shell: 'bash', limiares: { commits: 5, tokensDeContexto: 300000 } });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('calibrar.js (D495): alarme gravado que nao e numero positivo cai no padrao', () => {
  for (const alarme of [0, null, -1]) {
    const dir = pasta();
    const arq = path.join(dir, '.claude', 'sworn', 'projeto.json');
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    fs.writeFileSync(arq, JSON.stringify({ shell: 'bash', limiares: { tokensAlarme: alarme } }));
    try {
      const r = rodar(['--gravar', '300000'], dir);
      assert.strictEqual(r.status, 0, String(alarme) + ': ' + r.stdout + r.stderr);
      assert.strictEqual(JSON.parse(fs.readFileSync(arq, 'utf8')).limiares.tokensDeContexto, 300000);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

// Plano 083 (sobra 5, D538): o limiarAtual do relatorio e o que vale hoje, como o medidor (saude.medir): o gravado no
// projeto.json; senao o do modo continuo, quando ligado; senao o padrao do plugin. A origem vem em limiarAtualDe.
test('083 T6 (sobra 5): limiarAtual e o em vigor - gravado, modo continuo ou padrao - com a origem', () => {
  const casos = [
    [{ shell: 'bash', modoContinuo: true }, 250000, 'modo continuo'],
    [{ shell: 'bash', modoContinuo: true, limiares: { tokensDeContexto: 300000 } }, 300000, 'projeto.json'],
    // Plano 091 (#9): o modo continuo e ligado por padrao - chave ausente ou de outro tipo valem o do modo continuo;
    // so o booleano false volta ao padrao do plugin
    [{ shell: 'bash', modoContinuo: 'true' }, 250000, 'modo continuo'],
    [{ shell: 'bash' }, 250000, 'modo continuo'],
    [{ shell: 'bash', limiares: { tokensDeContexto: 0 } }, 250000, 'modo continuo'],
    [{ shell: 'bash', modoContinuo: false }, saude.LIMIARES_PADRAO.tokensDeContexto, 'padrao do plugin'],
    [{ shell: 'bash', modoContinuo: false, limiares: { tokensDeContexto: 0 } }, saude.LIMIARES_PADRAO.tokensDeContexto, 'padrao do plugin']
  ];
  for (const [cfg, limiar, de] of casos) {
    const dir = pasta();
    const trans = path.join(dir, 'trans');
    fs.mkdirSync(trans);
    fs.writeFileSync(path.join(trans, 's1.jsonl'), [chamada(60000), chamada(70000)].join('\n'));
    const arq = path.join(dir, '.claude', 'sworn', 'projeto.json');
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    fs.writeFileSync(arq, JSON.stringify(cfg));
    try {
      const j = JSON.parse(rodar(['--pasta', trans], dir).stdout);
      assert.deepStrictEqual([j.limiarAtual, j.limiarAtualDe], [limiar, de], JSON.stringify(cfg));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

// Plano 083 (sobra 5, D539): "manter" se grava - o --manter poe o limiar em vigor em limiares.tokensDeContexto, para o
// botao "calibrar" (que aparece enquanto o projeto nunca calibrou) nao voltar a cada chat.
test('083 T6 (sobra 5): --manter grava o limiar em vigor e preserva o resto; sem projeto.json manda rodar o init', () => {
  const dir = pasta();
  const arq = path.join(dir, '.claude', 'sworn', 'projeto.json');
  try {
    const sem = rodar(['--manter'], dir);
    assert.strictEqual(sem.status, 1);
    assert.ok(/sworn:init/.test(JSON.parse(sem.stdout).erro), sem.stdout);
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    fs.writeFileSync(arq, JSON.stringify({ shell: 'bash', modoContinuo: true, limiares: { commits: 5 } }));
    const r = rodar(['--manter'], dir);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.deepStrictEqual(JSON.parse(r.stdout), { gravou: true, manteve: true, tokensDeContexto: 250000, arquivo: '.claude/sworn/projeto.json' });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(arq, 'utf8')).limiares, { commits: 5, tokensDeContexto: 250000 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('calibrar.js: --gravar recusa valor torto ou no alarme e nao grava; sem projeto.json manda rodar o init', () => {
  const dir = pasta();
  const arq = path.join(dir, '.claude', 'sworn', 'projeto.json');
  try {
    const sem = rodar(['--gravar', '300000'], dir);
    assert.strictEqual(sem.status, 1);
    assert.ok(/sworn:init/.test(JSON.parse(sem.stdout).erro), sem.stdout);
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    const antes = JSON.stringify({ shell: 'bash' });
    fs.writeFileSync(arq, antes);
    for (const v of ['abc', '30000', String(saude.LIMIARES_PADRAO.tokensAlarme), '250000.5']) {
      const r = rodar(['--gravar', v], dir);
      assert.strictEqual(r.status, 1, v + ': ' + r.stdout);
      assert.strictEqual(fs.readFileSync(arq, 'utf8'), antes, v + ' gravou mesmo recusado');
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
