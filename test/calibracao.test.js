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

test('calibracao: sem trocas medidas suficientes, o custo da troca e o padrao da D749', () => {
  const t = cal.custoDaTroca([]);
  assert.strictEqual(t.medida, false);
  assert.strictEqual(t.custo, cal.TROCA_PADRAO.custo);
  assert.strictEqual(t.recomeco, cal.TROCA_PADRAO.recomeco);
});

// P11 (D749): o padrao da D464 (US$ 3,40) foi medido com a marca de handoff errada; o dono mandou medir de novo.
test('P11: o custo padrao da troca e o medido na s265 (US$ 0,86, recomeco 82K)', () => {
  assert.deepStrictEqual(cal.TROCA_PADRAO, { custo: 0.86, recomeco: 82000 });
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
  assert.ok(/Rode de novo depois de mais algumas semanas de uso$/.test(r.sugestao.motivo), r.sugestao.motivo);
  // os dois minimos faltam aqui, e os dois aparecem, com a contagem em K como nas faixas
  assert.match(r.sugestao.motivo, /^amostra pequena: 1 sessao, de 30 no minimo; 0 conversas chegaram a 175K, de 10 no minimo\./);
});

test('calibracao: o motivo da amostra diz so o minimo que faltou; com custo zero, o motivo diz isso', () => {
  const curtas = [];
  for (let i = 0; i < 30; i++) curtas.push(cal.lerSessao([fala('x'), chamada(60000), chamada(70000)].join('\n')));
  const r = cal.calibrar(curtas, {});
  assert.strictEqual(r.sugestao.suficiente, false);
  assert.match(r.sugestao.motivo, /^amostra pequena: 0 conversas chegaram a 175K, de 10 no minimo\. Fica/);
  assert.doesNotMatch(r.sugestao.motivo, /sessoes/);
  // uma conversa so chega a 175K: o singular
  const umaLonga = curtas.slice(1).concat(cal.lerSessao([fala('x'), chamada(160000), chamada(180000)].join('\n')));
  assert.match(cal.calibrar(umaLonga, {}).sugestao.motivo, /^amostra pequena: 1 conversa chegou a 175K, de 10 no minimo\. Fica/);
  // 30 sessoes que passam de 175K, com preco zero: a amostra basta, mas o custo e zero e nao ha o que comparar
  const zero = [];
  for (let i = 0; i < 30; i++) {
    const s0 = cal.lerSessao([fala('x'), chamada(160000), chamada(180000), chamada(190000)].join('\n'));
    s0.chamadas = s0.chamadas.map((c) => Object.assign(cal.novaChamada({ cache_read_input_tokens: c.C }, [0, 0, 0, 0, 0], c.t),
      { commit: c.commit, edicao: c.edicao, handoff: c.handoff }));
    zero.push(s0);
  }
  const s = cal.calibrar(zero, {});
  assert.strictEqual(s.sugestao.suficiente, false);
  assert.strictEqual(s.sugestao.tokensDeContexto, saude.LIMIARES_PADRAO.tokensDeContexto);
  assert.strictEqual(s.sugestao.motivo, 'as chamadas da amostra somam custo zero, e sem custo nao ha o que comparar. ' +
    'Fica o padrao do plugin. Confira se as transcricoes da pasta trazem os tokens de cada chamada (o campo usage)');
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

// A6 (s220, manutencao :152): a transcricao que nao se le saia calada da amostra; agora conta em `ilegiveis`, e o
// calibrar.js a mostra na `amostra`, como o `chamadasSemPreco` (precedente: `ilegiveis` do gasto, plano 082 p6-2).
test('A6: transcricao que nao se le conta em ilegiveis, e o calibrar.js a mostra na amostra', () => {
  const dir = pasta();
  const trans = path.join(dir, 'trans');
  fs.mkdirSync(trans);
  const tres = [chamada(60000), chamada(70000), chamada(80000)].join('\n');
  fs.writeFileSync(path.join(trans, 's1.jsonl'), tres);
  fs.writeFileSync(path.join(trans, 'ruim.jsonl'), tres);
  const original = fs.readFileSync;
  try {
    fs.readFileSync = function (p) {
      if (path.basename(String(p)) === 'ruim.jsonl') throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      return original.apply(fs, arguments);
    };
    const lidas = cal.lerPasta(trans);
    fs.readFileSync = original;
    assert.deepStrictEqual([lidas.sessoes.length, lidas.ilegiveis], [1, 1], JSON.stringify(lidas.ilegiveis));
    const ok = rodar(['--pasta', trans], dir);
    assert.strictEqual(JSON.parse(ok.stdout).amostra.transcricoesIlegiveis, 0, ok.stdout);
    const preload = path.join(dir, 'falhar.js');
    fs.writeFileSync(preload, "const fs = require('fs'); const o = fs.readFileSync; fs.readFileSync = function (p) { " +
      "if (require('path').basename(String(p)) === 'ruim.jsonl') throw new Error('EBUSY'); return o.apply(fs, arguments); };");
    const r = spawnSync(process.execPath, ['--require', preload, path.join(RAIZ, 'scripts', 'calibrar.js'), '--pasta', trans],
      { cwd: dir, encoding: 'utf8', env: Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: path.join(dir, 'sem-config') }) });
    assert.strictEqual(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.deepStrictEqual([j.amostra.sessoes, j.amostra.transcricoesIlegiveis], [1, 1], r.stdout);
  } finally {
    fs.readFileSync = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A6 (s220, pendentes :76 e lib :149, medidos): --pasta que e arquivo saia com o stack trace do readdirSync (ENOTDIR).
test('A6: --pasta que nao se le como pasta sai 1 com a causa e o passo, sem stack trace', () => {
  const dir = pasta();
  try {
    fs.writeFileSync(path.join(dir, 'arq.txt'), 'x');
    const r = rodar(['--pasta', 'arq.txt'], dir);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.strictEqual(r.stderr, '');
    assert.strictEqual(JSON.parse(r.stdout).erro,
      '--pasta nao se le como pasta (parte do caminho nao e uma pasta (ENOTDIR)); passe --pasta <pasta das ' +
      'transcricoes deste projeto>');
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

// A6-21 (D735): projeto.json que nao e objeto diz a forma, com exemplo, e o passo.
test('A6-21: --gravar com projeto.json que nao e objeto diz a forma e o passo', () => {
  const dir = pasta();
  const arq = path.join(dir, '.claude', 'sworn', 'projeto.json');
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, '[1]');
  try {
    const r = rodar(['--gravar', '300000'], dir);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.strictEqual(JSON.parse(r.stdout).erro, '.claude/sworn/projeto.json tem de ter os campos do projeto entre ' +
      '{ e }, como { "shell": "bash" }; corrija e rode de novo');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A6-86 (D735): limiares fora da forma diz a forma com exemplo, no molde do A6-21, sem "objeto".
test('A6-86: --gravar com limiares fora da forma diz a forma e o passo', () => {
  const dir = pasta();
  const arq = path.join(dir, '.claude', 'sworn', 'projeto.json');
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  try {
    for (const torto of [[300000], [], null, 'x', 5]) {
      fs.writeFileSync(arq, JSON.stringify({ shell: 'bash', limiares: torto }));
      const r = rodar(['--gravar', '300000'], dir);
      assert.strictEqual(r.status, 1, JSON.stringify(torto) + ': ' + r.stdout + r.stderr);
      assert.strictEqual(JSON.parse(r.stdout).erro, 'limiares em .claude/sworn/projeto.json tem de ter os limites ' +
        'entre { e }, como "limiares": { "tokensDeContexto": 300000 }; corrija e rode de novo', JSON.stringify(torto));
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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
    // D786: o ponto da compactacao vai junto (test/compactacao.test.js)
    assert.deepStrictEqual(JSON.parse(r.stdout), { gravou: true, manteve: true, tokensDeContexto: 250000,
      arquivo: '.claude/sworn/projeto.json', compactacao: [{ harness: 'claude', arquivo: '.claude/settings.local.json',
        chave: 'env.CLAUDE_CODE_AUTO_COMPACT_WINDOW', valor: 333000, gravou: true }] });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(arq, 'utf8')).limiares, { commits: 5, tokensDeContexto: 250000 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A6 (s220, microcopy :51): no --manter o valor nao foi digitado - vem do projeto.json ou do modo continuo. A recusa diz
// o limiar em vigor, de onde veio, a faixa e o passo (--gravar com um valor nela), e nao grava.
test('A6: --manter com o limiar em vigor fora da faixa diz qual, de onde veio e manda gravar um valor nela', () => {
  const dir = pasta();
  const arq = path.join(dir, '.claude', 'sworn', 'projeto.json');
  try {
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    const casos = [[{ limiares: { tokensDeContexto: 30000 } }, '30000, do projeto.json'],
      [{ modoContinuo: true, limiares: { tokensAlarme: 200000 } }, '250000, do modo continuo']];
    for (const [cfg, vigor] of casos) {
      fs.writeFileSync(arq, JSON.stringify(cfg));
      const r = rodar(['--manter'], dir);
      assert.strictEqual(r.status, 1, r.stdout);
      const erro = JSON.parse(r.stdout).erro;
      assert.ok(erro.startsWith('--manter: o limiar em vigor (' + vigor + ') esta fora da faixa que se grava'), erro);
      assert.match(erro, /grave um valor nessa faixa com --gravar <tokens>/, erro);
      assert.ok(!/pede um numero/.test(erro), erro);
      assert.strictEqual(fs.readFileSync(arq, 'utf8'), JSON.stringify(cfg), 'gravou mesmo recusado');
    }
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

test('calibracao A6-31/33: so Edit, Write e NotebookEdit marcam edicao, e a mensagem sem preco nao marca chamada nenhuma', () => {
  const editar = (nome) => ({ type: 'tool_use', name: nome, input: { file_path: 'C:/proj/src/app.js' } });
  // cada ferramenta que grava marca a sua chamada; um nome que so contem a palavra nao marca
  const s = cal.lerSessao([fala('pedido'), chamada(60000, { conteudo: [editar('Edit')] }),
    chamada(61000, { conteudo: [editar('Write')] }), chamada(62000, { conteudo: [editar('NotebookEdit')] }),
    chamada(63000, { conteudo: [editar('mcp__arquivos__Write')] }), chamada(64000, { conteudo: [editar('MultiEditX')] })].join('\n'));
  assert.deepStrictEqual(s.chamadas.map((c) => c.edicao), [true, true, true, false, false]);
  // a mensagem de modelo sem preco nao vira chamada, e a edicao dela nao cai na chamada 0
  const t = cal.lerSessao([fala('pedido'), chamada(60000),
    chamada(61000, { id: 'sem', modelo: 'modelo-sem-preco', conteudo: [editar('Edit')] }),
    chamada(61000, { id: 'sem', modelo: 'modelo-sem-preco', conteudo: [editar('Write')] }), chamada(62000)].join('\n'));
  assert.deepStrictEqual(t.chamadas.map((c) => c.edicao), [false, false]);
  // a mesma mensagem sem preco em duas linhas conta uma vez so
  assert.strictEqual(t.semPreco, 1);
});

test('calibracao: mensagem sem id vira chamada propria, e nao se junta as outras sem id', () => {
  const semId = (C) => {
    const o = JSON.parse(chamada(C));
    delete o.message.id;
    return JSON.stringify(o);
  };
  const s = cal.lerSessao([fala('pedido'), semId(60000), semId(61000), semId(62000), chamada(63000, { id: 'x' }),
    chamada(63000, { id: 'x' })].join('\n'));
  assert.deepStrictEqual(s.chamadas.map((c) => c.C), [60000, 61000, 62000, 63000]);
});

// A6-03: a tabela da pagina de precos (lida em 2026-11-18), o id com data no fim e o Haiku 5.5 acima de 100 mil.
test('calibracao A6-03: tabela de precos inteira, id com data e o Haiku 5.5 acima de 100 mil tokens de prompt', () => {
  assert.deepStrictEqual(cal.PRECOS['claude-sonnet-5-5'], [2, 10, 0.10, 2.5, 4]);
  assert.deepStrictEqual(cal.PRECOS['claude-fable-5-2'], [8, 40, 0.20, 10, 16]);
  assert.deepStrictEqual(cal.precoDaChamada('claude-haiku-4-5-20251001', {}), [1, 5, 0.10, 1.25, 2]);
  assert.strictEqual(cal.precoDaChamada('modelo-sem-preco', {}), undefined);
  assert.strictEqual(cal.precoDaChamada('toString', {}), undefined);
  // em 100 mil ainda e o preco de baixo; um token acima, a chamada inteira paga o de cima (a escrita de cache conta)
  const ate = { input_tokens: 1000, cache_read_input_tokens: 99000, cache_creation_input_tokens: 0 };
  const acima = { input_tokens: 1000, cache_read_input_tokens: 99000, cache_creation_input_tokens: 1 };
  assert.deepStrictEqual(cal.precoDaChamada('claude-haiku-5-5', ate), [0.1, 0.5, 0.01, 0.125, 0.2]);
  assert.deepStrictEqual(cal.precoDaChamada('claude-haiku-5-5', acima), [0.5, 2.5, 0.05, 0.625, 1]);
  // pela lerSessao: o Fable 5.2 entra na conta (antes caia em semPreco) e o Haiku com 150 mil paga o preco de cima
  const s = cal.lerSessao([chamada(60000, { modelo: 'claude-fable-5-2' }),
    chamada(150000, { modelo: 'claude-haiku-5-5' })].join('\n'));
  assert.strictEqual(s.semPreco, 0);
  assert.strictEqual(s.chamadas.length, 2);
  const alto = cal.precoDaChamada('claude-haiku-5-5', acima);
  const esperado = (150000 * alto[2] + 100 * alto[1]) / 1e6;
  assert.ok(Math.abs(s.chamadas[1].custo - esperado) < 1e-12, s.chamadas[1].custo + ' != ' + esperado);
});

// A6-06: o id vazio juntava todas as mensagens de id vazio numa chamada so.
test('calibracao A6-06: mensagem de id vazio nao se junta a outra', () => {
  const vazio = (C) => {
    const o = JSON.parse(chamada(C));
    o.message.id = '';
    return JSON.stringify(o);
  };
  const s = cal.lerSessao([fala('pedido'), vazio(60000), vazio(61000), vazio(62000), chamada(63000, { id: 'x' }),
    chamada(63000, { id: 'x' })].join('\n'));
  assert.deepStrictEqual(s.chamadas.map((c) => c.C), [60000, 61000, 62000, 63000]);
});

// A6-08: a simulacao ia ate o alarme padrao, mesmo com o projeto de alarme mais baixo (o --gravar recusa no alarme).
test('calibracao A6-08: a simulacao para no alarme do projeto, e sem limiar para simular fica o que vale hoje', () => {
  assert.deepStrictEqual(cal.candidatosAbaixoDe(250000), [150000, 175000, 200000, 225000]);
  assert.deepStrictEqual(cal.candidatosAbaixoDe(undefined), cal.CANDIDATOS);
  assert.deepStrictEqual(cal.candidatosAbaixoDe(0), cal.CANDIDATOS);
  // o alarme que nao e numero finito cai no padrao; o enorme para na janela de 1M, sem milhoes de limiares
  assert.deepStrictEqual(cal.candidatosAbaixoDe(Infinity), cal.CANDIDATOS);
  const enorme = cal.candidatosAbaixoDe(1e12);
  assert.strictEqual(enorme.length, 34);
  assert.strictEqual(enorme[enorme.length - 1], 975000);
  // 30 sessoes que chegam a 180 mil: amostra suficiente, para a recusa vir do alarme e nao da amostra
  const sessoes = [];
  for (let i = 0; i < 30; i++) {
    sessoes.push(cal.lerSessao([fala('pedido'), chamada(160000), chamada(170000), fala('mais'), chamada(180000)].join('\n')));
  }
  const r = cal.calibrar(sessoes, { alarme: 250000, limiarAtual: 175000 });
  assert.deepStrictEqual(r.simulacao.map((l) => l.limiar), [150000, 175000, 200000, 225000]);
  // em 150 mil as 30 conversas trocam e pagam mais; em 175 mil nenhuma troca: e o menor que empata
  assert.strictEqual(r.sugestao.tokensDeContexto, 175000);
  assert.strictEqual(r.sugestao.suficiente, true);
  // amostra pequena com o alarme baixo: o motivo e o do alarme, porque esperar mais semanas nao o resolve
  const poucas = cal.calibrar(sessoes.slice(0, 3), { alarme: 100000, limiarAtual: 90000 });
  assert.strictEqual(poucas.sugestao.tokensDeContexto, 90000);
  assert.match(poucas.sugestao.motivo, /^o alarme deste projeto \(100K\)/);
  // o alarme que nao e mil redondo aparece como veio, nao arredondado (400 nao vira 0K)
  assert.match(cal.calibrar(sessoes, { alarme: 400 }).sugestao.motivo, /^o alarme deste projeto \(400\)/);
  const baixo = cal.calibrar(sessoes, { alarme: 150000, limiarAtual: 120000 });
  assert.deepStrictEqual(baixo.simulacao, []);
  assert.strictEqual(baixo.sugestao.suficiente, false);
  assert.strictEqual(baixo.sugestao.tokensDeContexto, 120000);
  assert.match(baixo.sugestao.motivo, /^o alarme deste projeto \(150K\) nao passa do ponto onde a simulacao comeca \(150K\)/);
  assert.match(baixo.sugestao.motivo, /suba limiares\.tokensAlarme no projeto\.json para acima de 150000$/);
});

test('calibrar.js A6-08: o comando passa o alarme do projeto.json para a simulacao', () => {
  const dir = pasta();
  const trans = path.join(dir, 'trans');
  fs.mkdirSync(trans);
  fs.writeFileSync(path.join(trans, 's1.jsonl'), [fala('pedido'), chamada(160000), chamada(170000), chamada(180000)].join('\n'));
  const arq = path.join(dir, '.claude', 'sworn', 'projeto.json');
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, JSON.stringify({ shell: 'bash', limiares: { tokensAlarme: 200000 } }));
  try {
    const r = rodar(['--pasta', trans], dir);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.deepStrictEqual(JSON.parse(r.stdout).simulacao.map((l) => l.limiar), [150000, 175000]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
