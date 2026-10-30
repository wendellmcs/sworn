'use strict';
// Bloco M / M1 (D435): scripts/sessao.js e o que o mod chama por $.process.run. Le do stdin
// { uso, amostras, sessao }, junta o estado da sessao (a mesma conta do portao-fecho: saude.acumular)
// e os limiares do projeto, e devolve JSON { curta, longa, cruzou }. Nunca derruba: saida 0 sempre.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'sessao.js');

function cenario(fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-session-'));
  const projeto = path.join(base, 'projeto');
  fs.mkdirSync(path.join(projeto, '.claude', 'sworn'), { recursive: true });
  fs.mkdirSync(path.join(base, 'sworn'), { recursive: true });
  try { fn({ base: base, projeto: projeto }); } finally { fs.rmSync(base, { recursive: true, force: true }); }
}

function rodar(c, entrada) {
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: c.projeto,
    input: typeof entrada === 'string' ? entrada : JSON.stringify(entrada),
    // Pedido 31: o gasto do mes le as transcricoes de CLAUDE_CONFIG_DIR/projects - a do teste, nunca a real.
    env: Object.assign({}, process.env, { SWORN_TMP: c.base, CLAUDE_CONFIG_DIR: path.join(c.base, 'config') }),
    encoding: 'utf8'
  });
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const USO = { startedAt: 0, context: { tokens: 46900, window: 1000000, percent: 5 }, rateLimits: [], cost: { usd: 1 } };

test('sessao.js: soma turno + sessao e usa o limiar do projeto (a conta do portao-fecho)', () => {
  cenario(function (c) {
    // Plano 091 (#9): modoContinuo false - o gatilho de revisoes so conta com o modo continuo desligado
    fs.writeFileSync(path.join(c.projeto, '.claude', 'sworn', 'projeto.json'), JSON.stringify({ limiares: { revisoesFechadas: 5 }, modoContinuo: false }));
    fs.writeFileSync(path.join(c.base, 'sworn', 'sess-1.json'),
      JSON.stringify({ contadoresSessao: { revisao_fechada: 3 }, contadores: { revisao_fechada: 2 } }));
    const r = rodar(c, { uso: USO, amostras: [], sessao: 'sess-1' });
    assert.strictEqual(r.cruzou, true, JSON.stringify(r));
    assert.ok(r.longa.indexOf('- revisões independentes fechadas: 5 de 5 ← disparou') !== -1, r.longa);
    assert.ok(r.curta.indexOf('contexto 5%') !== -1, r.curta);
  });
});

test('sessao.js: sem estado e sem projeto -> limiares padrao, nada cruzou', () => {
  cenario(function (c) {
    const r = rodar(c, { uso: USO, amostras: [], sessao: 'nao-existe' });
    assert.strictEqual(r.cruzou, false);
    // Plano 091 (#9): sem projeto o modo continuo e o padrao (ligado): o contexto ao vivo (46.900 de 250.000) e o
    // sinal mais perto - pedido 71 (D544); os gatilhos contaveis ficam calados.
    assert.ok(/ · troca de chat em 203 mil tokens$/.test(r.curta), r.curta);
    assert.ok(r.longa.indexOf('- tamanho do contexto: 46.900 de 250.000 tokens') !== -1, r.longa);
    // controle: com modoContinuo false o padrao antigo volta (D445: 46.900 de 175.000).
    fs.writeFileSync(path.join(c.projeto, '.claude', 'sworn', 'projeto.json'), JSON.stringify({ modoContinuo: false }));
    const antigo = rodar(c, { uso: USO, amostras: [], sessao: 'nao-existe' });
    assert.strictEqual(antigo.cruzou, false);
    assert.ok(/ · troca de chat em 128 mil tokens$/.test(antigo.curta), antigo.curta);
  });
});

test('sessao.js: aviso ja dado na sessao aparece no medidor', () => {
  cenario(function (c) {
    fs.writeFileSync(path.join(c.base, 'sworn', 'sess-2.json'), JSON.stringify({ avisouSaude: true }));
    const r = rodar(c, { uso: USO, amostras: [], sessao: 'sess-2' });
    assert.ok(/ · troca já avisada → \/sworn:handoff$/.test(r.curta), r.curta);
  });
});

test('sessao.js: entrada que nao e JSON -> saida 0, curta mesmo assim e o erro dito', () => {
  cenario(function (c) {
    const r = rodar(c, 'isto nao e json');
    // Plano 091 (#9): sem projeto o modo continuo e o padrao: o turno nao e gatilho, o mais perto e o bloqueio de portao
    assert.ok(typeof r.curta === 'string' && /(^| · )troca de chat em 6 ações negadas pelo sworn$/.test(r.curta),
      JSON.stringify(r));
    assert.ok(typeof r.erro === 'string' && r.erro.length > 0, JSON.stringify(r));
    // controle: com modoContinuo false o turno volta a ser o sinal mais perto
    fs.writeFileSync(path.join(c.projeto, '.claude', 'sworn', 'projeto.json'), JSON.stringify({ modoContinuo: false }));
    const antigo = rodar(c, 'isto nao e json');
    assert.ok(typeof antigo.curta === 'string' && /(^| · )troca de chat em 15 respostas com trabalho real$/.test(antigo.curta), JSON.stringify(antigo));
    assert.ok(typeof antigo.erro === 'string' && antigo.erro.length > 0, JSON.stringify(antigo));
  });
});

// A7-19 (D735): o `erro` diz o que houve, o efeito e o passo; a mensagem do Node vai entre aspas, marcada como dele.
test('A7-19: entrada torta e medida que falha dizem o que houve, o efeito e o passo', () => {
  cenario(function (c) {
    const passo = ' a medida saiu sem os dados da sessao. Mande na entrada do script um objeto JSON com os campos ' +
      'uso e sessao (a lista inteira esta no topo de scripts/sessao.js) e rode de novo.';
    // P2 da R1 (s242): a mensagem e a do JSON.parse deste Node, inteira (o ".+" aceitava qualquer texto; sem barra nem
    // quebra de linha nela, o JSON.stringify e o entreAspas dao o mesmo), e a entrada vazia cai no mesmo ramo
    const doNode = (bruto) => { try { JSON.parse(bruto); } catch (e) { return e.message; } };
    for (const bruto of ['isto nao e json', '']) {
      const esperado = 'A entrada nao e JSON valido (o Node diz: ' + JSON.stringify(doNode(bruto)) + ');' + passo;
      assert.strictEqual(rodar(c, bruto).erro, esperado);
    }
    assert.strictEqual(rodar(c, '5').erro, 'A entrada e JSON, mas nao um objeto (veio 5);' + passo);
    assert.strictEqual(rodar(c, 'null').erro, 'A entrada e JSON, mas nao um objeto (veio null);' + passo);
    // a medida que lanca (o daSessao do botoes.js trocado, pelo -r, por um que lanca): a causa entre aspas e o passo
    const lanca = path.join(c.base, 'lanca.js');
    fs.writeFileSync(lanca, 'require(' + JSON.stringify(path.join(__dirname, '..', 'scripts', 'lib', 'botoes.js')) +
      ').daSessao = function () { throw new Error("quebrou de proposito"); };');
    const r = spawnSync(process.execPath, ['-r', lanca, SCRIPT], { cwd: c.projeto, input: JSON.stringify({ uso: USO }),
      env: Object.assign({}, process.env, { SWORN_TMP: c.base, CLAUDE_CONFIG_DIR: path.join(c.base, 'config') }),
      encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(JSON.parse(r.stdout).erro, 'A medida falhou (o Node diz: "quebrou de proposito") e saiu ' +
      'vazia. Corrija a causa que o Node aponta e rode de novo.');
  });
});

// D445 (0.6.2): o medidor usa o contexto ao vivo (uso.context.tokens) no 7o gatilho.
test('sessao.js: o gatilho de contexto usa uso.context.tokens ao vivo', () => {
  cenario(function (c) {
    // Plano 091 (#9): modoContinuo false - o limiar de 175.000 e o do modo continuo desligado (ligado e 250.000)
    fs.writeFileSync(path.join(c.projeto, '.claude', 'sworn', 'projeto.json'), JSON.stringify({ modoContinuo: false }));
    const alto = Object.assign({}, USO, { context: { tokens: 260000, window: 1000000, percent: 26 } });
    const r = rodar(c, { uso: alto, amostras: [], sessao: 'nao-existe' });
    assert.strictEqual(r.cruzou, true, JSON.stringify(r));
    assert.ok(r.longa.indexOf('- tamanho do contexto: 260.000 de 175.000 tokens ← disparou') !== -1, r.longa);
  });
});

// Plano 082 (p8-36): so `typeof number` deixava entrar negativo e Infinity (JSON.parse('1e400') da Infinity) no 7o
// gatilho. Numero que nao e contagem de tokens fica fora: vale o gravado no estado.
test('sessao.js: tokens ao vivo negativos ou infinitos nao entram no gatilho de contexto', () => {
  cenario(function (c) {
    fs.writeFileSync(path.join(c.base, 'sworn', 'sess-t.json'), JSON.stringify({ tokensDeContexto: 1234 }));
    for (const tokens of ['-5', '1e400', '-1e400']) {
      const r = rodar(c, '{"uso":{"context":{"tokens":' + tokens + ',"window":1000000,"percent":5}},"amostras":[],"sessao":"sess-t"}');
      assert.ok(r.longa.indexOf('- tamanho do contexto: 1.234 de ') !== -1, tokens + ': ' + r.longa);
      assert.ok(!/tamanho do contexto: (-|Infinity)/.test(r.longa), tokens + ': ' + r.longa);
    }
    // controle: o valor ao vivo bom ainda manda (D445)
    const bom = rodar(c, { uso: Object.assign({}, USO, { context: { tokens: 0, window: 1000000, percent: 0 } }), amostras: [], sessao: 'sess-t' });
    assert.ok(bom.longa.indexOf('- tamanho do contexto: 0 de ') !== -1, bom.longa);
  });
});

// Pedido 30 (plano dos pedidos 30-32, Tarefa 2): o medidor devolve a linha do plano, que o mod poe na faixa.
test('sessao.js: devolve a linha do plano (vazia sem plano)', () => {
  cenario(function (c) {
    assert.strictEqual(rodar(c, { uso: USO, amostras: [], sessao: 'nao-existe' }).plano, '');
    fs.mkdirSync(path.join(c.projeto, 'p'));
    fs.writeFileSync(path.join(c.projeto, 'p', '2026-01-01-x-plano.md'), '### Tarefa 1: a\n- [x] p\n### Tarefa 2: b\n- [ ] p\n');
    fs.writeFileSync(path.join(c.projeto, '.claude', 'sworn', 'plano-ativo.json'),
      JSON.stringify({ arquivo: 'p/2026-01-01-x-plano.md', sessionId: 's' }));
    const comPlano = rodar(c, { uso: USO, amostras: [], sessao: 'nao-existe' });
    assert.strictEqual(comPlano.plano, 'plano x · 1 de 2 tarefas · próxima: Tarefa 2 — b');
    // plano 082 (p6-24): o plano fica so na faixa; a barra comeca no contexto
    assert.ok(comPlano.curta.indexOf('contexto 5% · ') === 0 && comPlano.curta.indexOf('plano') === -1, comPlano.curta);
  });
});

// Pedido 31 (D520): o medidor soma o real do $.store (com a sessao atual) e a estimativa das transcricoes das outras,
// e devolve em `guardar` o que o mod grava de volta.
test('sessao.js: gasto do mes (real + transcricoes) na curta, e `guardar` com o real e o historico da sessao', () => {
  cenario(function (c) {
    const proj = path.join(c.base, 'config', 'projects', 'c--proj');
    fs.mkdirSync(proj, { recursive: true });
    const linha = (id, sessao) => JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(),
      message: { id: id, model: 'claude-opus-5-5', usage: { input_tokens: 1000000, output_tokens: 0 } } });
    fs.writeFileSync(path.join(proj, 'outra.jsonl'), linha('m1'));
    fs.writeFileSync(path.join(proj, 'sess-g.jsonl'), linha('m2'));
    const uso = Object.assign({}, USO, { cost: { usd: 1 },
      rateLimits: [{ kind: 'seven_day', percentUsed: 30, resetsAt: '2026-10-20T07:00:00.000Z' }] });
    const antes = (t) => ({ t: t, medidas: 4, janelas: { seven_day: { resetIni: 'R', ini: 0, resetFim: 'R', fim: 10 } } });
    const r = rodar(c, { uso: uso, amostras: [], sessao: 'sess-g', historico: { a: antes(1), b: antes(2) }, gastoReal: {} });
    // semana 30% usada, 10% por sessao nas 2 anteriores -> 7 handoffs
    // (plano 082, p6-32: a previsao em handoffs saiu da barra; fica na resposta do comando)
    assert.ok(r.longa.indexOf('- a janela da semana acaba em ~7 trocas de chat') !== -1, r.longa);
    assert.ok(r.curta.indexOf('semana 30% · ') !== -1 && r.curta.indexOf('handoffs') === -1, r.curta);
    // real: a sessao atual (US$ 1); estimado: so a "outra" (US$ 4) - a atual tem real e sai da estimativa.
    assert.ok(r.curta.indexOf('mês US$ 5 · ') !== -1, r.curta);
    assert.ok(r.curta.indexOf('sessão US$ 1,00') !== -1, r.curta);
    assert.ok(r.guardar && r.guardar.historico['sess-g'].janelas.seven_day.ini === 30, JSON.stringify(r.guardar));
    const chave = Object.keys(r.guardar.gastoReal)[0];
    assert.deepStrictEqual(r.guardar.gastoReal[chave], { 'sess-g': 1 });
    assert.ok(fs.existsSync(path.join(c.base, 'sworn', 'cache', 'gasto-mes.json')), 'cache na pasta do estado');
  });
});

// Pedido 32 (plano dos pedidos 30-32, Tarefa 4 subitem 3): o sessao.js devolve `botoes` (lib/botoes.js) com o que ja
// le - estado, projeto, cruzou - e o que o mod manda: a ultima resposta do agente e se o manual foi carregado.
test('sessao.js: devolve `botoes` na ordem de prioridade, com a resposta e o padrao que o mod manda', () => {
  cenario(function (c) {
    const nomes = (r) => (r.botoes || []).map((b) => b.nome);
    // sem projeto.json: o do init
    assert.deepStrictEqual(nomes(rodar(c, { uso: USO, amostras: [], sessao: 'nao-existe' })), ['init']);
    fs.writeFileSync(path.join(c.projeto, '.claude', 'sworn', 'projeto.json'), JSON.stringify({ marchas: { aaa: ['src/**'] } }));
    fs.writeFileSync(path.join(c.base, 'sworn', 'sess-b.json'), JSON.stringify({
      arquivosTocados: [path.join(c.projeto, 'src', 'a.js')], esperaAprender: 4, auditoriaAvisou: true }));
    const r = rodar(c, { uso: USO, amostras: [], sessao: 'sess-b', resposta: 'ofereco o /sworn:parallel', padrao: false });
    // 091 #5 (D557): a resposta que cita o paralelo nao acende botao (roda direto)
    assert.deepStrictEqual(nomes(r), ['aprender', 'auditar', 'padrao'], JSON.stringify(r.botoes));
    assert.deepStrictEqual(nomes(rodar(c, { uso: USO, amostras: [], sessao: 'sess-b', padrao: true })), ['aprender', 'auditar']);
    // calibrar: 30 conversas na pasta de transcricoes do projeto e limiar nunca calibrado
    const calibracao = require('../scripts/lib/calibracao.js');
    const pasta = path.join(c.base, 'config', 'projects', calibracao.nomeDaPasta(c.projeto));
    fs.mkdirSync(pasta, { recursive: true });
    for (let i = 0; i < calibracao.AMOSTRA_MINIMA.sessoes; i++) fs.writeFileSync(path.join(pasta, 's' + i + '.jsonl'), '');
    assert.ok(nomes(rodar(c, { uso: USO, amostras: [], sessao: 'nao-existe' })).indexOf('calibrar') !== -1);
    assert.ok(fs.existsSync(path.join(c.base, 'sworn', 'cache', 'calibrar.json')), 'marca do dia na pasta do estado');
  });
});

test('sessao.js: cruzou acende o botao do handoff, em primeiro', () => {
  cenario(function (c) {
    fs.writeFileSync(path.join(c.projeto, '.claude', 'sworn', 'projeto.json'), JSON.stringify({ limiares: { revisoesFechadas: 1 }, modoContinuo: false })); // Plano 091 (#9): sem modoContinuo false a revisao nao cruza
    fs.writeFileSync(path.join(c.base, 'sworn', 'sess-h.json'), JSON.stringify({ contadores: { revisao_fechada: 1 } }));
    const r = rodar(c, { uso: USO, amostras: [], sessao: 'sess-h' });
    assert.strictEqual(r.cruzou, true);
    assert.strictEqual(r.botoes[0].nome, 'handoff', JSON.stringify(r.botoes));
  });
});
