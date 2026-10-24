'use strict';
const test = require('node:test');
const assert = require('node:assert');
const saude = require('../scripts/lib/saude.js');
const medidor = require('../scripts/lib/medidor.js');

// Bloco M / M1 (D435): o medidor da sessao. A regra dos gatilhos mora em saude.js (fonte unica);
// o medidor so formata. Desenho: .context/plans/2026-10-11-sworn-bloco-m-desenho.md.

const ASCII = /^[\x20-\x7E\n]*$/;

function uso(extra) {
  return Object.assign({
    startedAt: 0,
    context: { tokens: 46900, window: 1000000, percent: 5 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 49, resetsAt: '2026-10-11T23:20:00.000Z' },
      { kind: 'seven_day', percentUsed: 92, resetsAt: '2026-10-15T07:00:00.000Z' }
    ],
    cost: { usd: 4.1 }
  }, extra || {});
}

function hhmm(iso) {
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// --- saude.medir: os 7 gatilhos contaveis, cruzados ou nao ---

test('medir: devolve os 7 gatilhos na ordem do avaliar, com valor e limiar', () => {
  const m = saude.medir({}, null);
  assert.deepStrictEqual(m.map(function (g) { return g.chave; }),
    ['turnosComTrabalho', 'revisoesFechadas', 'bloqueios', 'arquivosTocados', 'decisoesDoDono', 'commits', 'tokensDeContexto']);
  for (const g of m) {
    assert.strictEqual(g.valor, 0, g.chave);
    assert.strictEqual(g.limiar, saude.LIMIARES_PADRAO[g.chave], g.chave);
    assert.strictEqual(g.cruzou, false, g.chave);
    assert.ok(typeof g.nome === 'string' && g.nome.length > 0 && ASCII.test(g.nome), g.chave);
  }
});

test('medir: soma os baldes de bloqueio e respeita o limiar do projeto', () => {
  const m = saude.medir({ contadores: { fora_do_escopo: 2, cd_solto: 1 } }, { bloqueios: 3 });
  const b = m.find(function (g) { return g.chave === 'bloqueios'; });
  assert.strictEqual(b.valor, 3);
  assert.strictEqual(b.limiar, 3);
  assert.strictEqual(b.cruzou, true);
});

test('medir: NAO se cala com avisouSaude (o aviso ja dado nao zera o painel)', () => {
  const m = saude.medir({ avisouSaude: true, contadores: { revisao_fechada: 17 } }, null);
  const r = m.find(function (g) { return g.chave === 'revisoesFechadas'; });
  assert.strictEqual(r.valor, 17);
  assert.strictEqual(r.cruzou, true);
});

test('medir: estado corrompido nunca cruza (texto/objeto onde se espera numero ou lista)', () => {
  const m = saude.medir({ decisoesDoDono: '9', commitsFeitos: {}, arquivosTocados: 'a,b' }, null);
  for (const g of m) assert.strictEqual(g.cruzou, false, g.chave);
});

test('medir: o texto de todo gatilho, cruzado ou nao, usa o valor normalizado (revisao cega do M, saude A:62)', () => {
  for (const e of [{}, null, { turnosComTrabalho: null }]) {
    for (const g of saude.medir(e, null)) {
      assert.ok(g.texto.indexOf('undefined') === -1 && g.texto.indexOf('null') === -1, g.texto);
      assert.ok(g.texto.indexOf(String(g.valor) + ' ') === 0, g.texto);
    }
  }
});

test('medir x avaliar: os gatilhos do avaliar sao exatamente os textos que o medir cruzou', () => {
  const casos = [
    {},
    { contadores: { revisao_fechada: 2 } },
    { turnosComTrabalho: 15, arquivosTocados: new Array(25).fill('x'), decisoesDoDono: 3, commitsFeitos: 3 },
    { contadores: { fora_do_escopo: 6 } },
    { turnosComTrabalho: 14, contadores: { revisao_fechada: 1 }, decisoesDoDono: 2 }
  ];
  for (const e of casos) {
    const cruzados = saude.medir(e, null).filter(function (g) { return g.cruzou; }).map(function (g) { return g.texto; });
    assert.deepStrictEqual(saude.avaliar(e, null).gatilhos, cruzados, JSON.stringify(e));
  }
});

// --- saude.acumular: turno + sessao, a mesma conta do portao-fecho ---

test('acumular: soma o balde do turno no da sessao sem mexer nos objetos de entrada', () => {
  const s = { contadores: { revisao_fechada: 1, cd_solto: 1 }, contadoresSessao: { revisao_fechada: 2 } };
  const a = saude.acumular(s);
  assert.deepStrictEqual(a, { revisao_fechada: 3, cd_solto: 1 });
  assert.deepStrictEqual(s.contadoresSessao, { revisao_fechada: 2 });
});

test('acumular: estado vazio da objeto vazio', () => {
  assert.deepStrictEqual(saude.acumular({}), {});
  assert.deepStrictEqual(saude.acumular(null), {});
});

// --- medidor.linhaDaSessao ---

// Plano 082, Tarefa 2 (mock D532, tela S3): a barra em uma linha, sem "sworn" na frente (o VS Code ja escreve
// "sworn plugin") e sem o plano (esta na faixa); separador " · " e acento (D532: a sonda da T1 viu inteiro).
// Pedido 71 (D544, barra A): o fim da barra diz quanto falta para o aviso de troca, pelo sinal mais perto.
const LONGE = 'troca de chat em 15 respostas com trabalho real';

test('barra (S3): contexto · 5h até HH:MM · semana · sessão · troca de chat em N, sem "sworn" na frente', () => {
  const r = medidor.linhaDaSessao({ uso: uso(), amostras: [], medidas: saude.medir({}, null), avisouSaude: false });
  assert.ok(r.curta.indexOf('\n') === -1, 'curta e UMA linha');
  assert.strictEqual(r.curta, 'contexto 5% · 5h 49% até ' + hhmm('2026-10-11T23:20:00.000Z') +
    ' · semana 92% · sessão US$ 4,10 · ' + LONGE);
  assert.strictEqual(r.cruzou, false);
});

test('linha curta: campo que o motor nao deu e omitido, nunca vira 0', () => {
  const r = medidor.linhaDaSessao({
    uso: { startedAt: 0, context: { window: 1000000 }, rateLimits: [] },
    amostras: [], medidas: saude.medir({}, null), avisouSaude: false
  });
  assert.ok(r.curta.indexOf('contexto') === -1, r.curta);
  assert.ok(r.curta.indexOf('5h') === -1 && r.curta.indexOf('semana') === -1, r.curta);
  assert.ok(r.curta.indexOf('US$') === -1, r.curta);
  assert.strictEqual(r.curta, LONGE);
});

test('gatilho cruzado: cruzou true e a curta manda ao handoff', () => {
  const r = medidor.linhaDaSessao({ uso: uso(), amostras: [], medidas: saude.medir({ contadores: { revisao_fechada: 17 } }, null), avisouSaude: false });
  assert.strictEqual(r.cruzou, true);
  assert.ok(/ · troque de chat → \/sworn:handoff$/.test(r.curta), r.curta);
  assert.ok(r.longa.indexOf('17 de 2') !== -1, r.longa);
  assert.ok(/handoff/.test(r.longa), r.longa);
});

test('aviso ja dado: a curta diz isso em vez de contar (o fecho zera os contadores depois do aviso)', () => {
  const r = medidor.linhaDaSessao({ uso: uso(), amostras: [], medidas: saude.medir({}, null), avisouSaude: true });
  assert.ok(/ · troca já avisada → \/sworn:handoff$/.test(r.curta), r.curta);
  assert.strictEqual(r.cruzou, true, 'o aviso ja dado segue pedindo a troca');
});

// Plano 082 (mock D532, S4; p6-20): sem previsao, a resposta diz quando ela aparece - pelas respostas e pelos chats.
const SEM_PREVISAO = '- aparece depois de 2 respostas com consumo (em trocas de chat, depois de 2 chats anteriores medidos)';

test('previsao: sem 2 turnos com subida, nada de numero inventado', () => {
  const um = medidor.linhaDaSessao({ uso: uso(), amostras: [{ tokens: 40000, cincoH: 45 }, { tokens: 46900, cincoH: 49 }], medidas: saude.medir({}, null), avisouSaude: false });
  assert.ok(um.curta.indexOf('turnos') === -1, um.curta);
  assert.ok(um.longa.indexOf('**Previsão**\n' + SEM_PREVISAO + '\n') !== -1, um.longa);
  const parado = medidor.linhaDaSessao({ uso: uso(), amostras: [{ tokens: 46900, cincoH: 49 }, { tokens: 46900, cincoH: 49 }, { tokens: 46900, cincoH: 49 }], medidas: saude.medir({}, null), avisouSaude: false });
  assert.ok(parado.longa.indexOf('**Previsão**\n' + SEM_PREVISAO + '\n') !== -1, parado.longa);
});

test('previsao: media da subida por turno -> respostas ate o fim do contexto e da janela de 5h', () => {
  // contexto sobe 10000 por turno: (1000000 - 46900) / 10000 = 95.31 -> ~95; 5h sobe 2 por turno: (100 - 49) / 2 = 25.5 -> ~25
  const amostras = [{ tokens: 26900, cincoH: 45 }, { tokens: 36900, cincoH: 47 }, { tokens: 46900, cincoH: 49 }];
  const r = medidor.linhaDaSessao({ uso: uso(), amostras: amostras, medidas: saude.medir({}, null), avisouSaude: false });
  assert.ok(r.longa.indexOf('- o contexto enche em ~95 respostas\n') !== -1, r.longa);
  assert.ok(r.longa.indexOf('- a janela de 5 horas acaba em ~25 respostas\n') !== -1, r.longa);
  // Plano 082 (p6-32): a previsao saiu da barra; so a resposta do comando a explica.
  assert.ok(r.curta.indexOf('turnos') === -1 && r.curta.indexOf('acaba') === -1, r.curta);
  assert.ok(r.longa.indexOf('turnos') === -1 && r.longa.indexOf(SEM_PREVISAO) === -1, r.longa);
});

test('previsao: contexto ou janela ja no fim nunca dao turnos negativos (revisao cega do M, medidor A:57/A:62)', () => {
  const amostras = [{ tokens: 990000, cincoH: 99 }, { tokens: 1000000, cincoH: 101 }, { tokens: 1010000, cincoH: 103 }];
  const passado = uso({
    context: { tokens: 1010000, window: 1000000, percent: 101 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 103, resetsAt: '2026-10-11T23:20:00.000Z' }]
  });
  const r = medidor.linhaDaSessao({ uso: passado, amostras: amostras, medidas: saude.medir({}, null), avisouSaude: false });
  assert.ok(r.longa.indexOf('~-') === -1 && r.curta.indexOf('~-') === -1, r.longa + '\n' + r.curta);
  assert.ok(r.longa.indexOf('- o contexto enche em ~0 respostas\n') !== -1, r.longa);
  assert.ok(r.longa.indexOf('- a janela de 5 horas acaba em ~0 respostas\n') !== -1, r.longa);
});

test('longa: cada sinal com nome, valor e limiar, e o que fazer', () => {
  const r = medidor.linhaDaSessao({ uso: uso(), amostras: [], medidas: saude.medir({ turnosComTrabalho: 3 }, null), avisouSaude: false });
  assert.ok(r.longa.indexOf('- respostas com trabalho real: 3 de 15\n') !== -1, r.longa);
  assert.ok(/\*\*O que fazer\*\*\nNada por ora\.$/.test(r.longa), r.longa);
});

// D442/2 (print do dono, s70): o painel do VS Code renderiza a longa como Markdown; sem linha em branco, o
// "o que fazer" virava continuacao do ultimo item da lista de gatilhos ("... 0 de 3 o que fazer: ...").
// Plano 082 (S4): vale para todo titulo de bloco - sem a linha em branco, o titulo emenda no item de cima.
test('D442/2: longa separa cada bloco com uma linha em branco, com e sem aviso dado', () => {
  for (const avisou of [false, true]) {
    const r = medidor.linhaDaSessao({ uso: uso(), amostras: [], medidas: saude.medir({}, null), avisouSaude: avisou });
    assert.ok(/\n\n\*\*O que fazer\*\*\n/.test(r.longa), JSON.stringify(r.longa));
    const titulos = r.longa.split('\n').filter(function (l) { return /^\*\*/.test(l); });
    assert.deepStrictEqual(titulos.map(function (t) { return t.split(' ')[0]; }),
      ['**Contexto', '**Gasto**', '**Previsão**', '**Troca', '**O'], r.longa);
    assert.strictEqual(r.longa.split('\n\n').length, 5, JSON.stringify(r.longa));
  }
});

// D442/11 (M-15 a M-22): o motor manda numero com casas e, se vier incompleto, o texto mostrava "undefined",
// "Infinity" ou contava gatilho que nao listava. Campo que o motor nao deu e omitido, nunca inventado.
test('D442/11: percentual arredondado; janela sem kind e gatilho incompleto omitidos; nada de undefined/Infinity', () => {
  const torto = uso({
    context: { tokens: 46900, window: 1000000, percent: 4.6899999 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 37.29999, resetsAt: '2026-10-11T23:20:00.000Z' },
      { percentUsed: 40 },
      { kind: 'seven_day', percentUsed: 92.5, resetsAt: '2026-10-15T07:00:00.000Z' }
    ]
  });
  const certas = saude.medir({}, null);
  const medidas = [null, { cruzou: true }, { nome: 'x', cruzou: false }].concat(certas);
  // subida media de 1e-320 por turno: (1000000 - 46900) / 1e-320 = Infinity
  const tokensSobemQuaseNada = [{ tokens: 0 }, { tokens: 1e-320 }, { tokens: 2e-320 }];
  assert.strictEqual((1000000 - 46900) / 1e-320, Infinity, 'o caso nao exercita o Infinity');
  const r = medidor.linhaDaSessao({ uso: torto, amostras: tokensSobemQuaseNada, medidas: medidas, avisouSaude: false });
  const tudo = r.curta + '\n' + r.longa;
  assert.ok(!/undefined|Infinity|NaN|null/.test(tudo), tudo);
  assert.ok(r.curta.indexOf('contexto 5%') !== -1 && r.curta.indexOf('5h 37%') !== -1 && r.curta.indexOf('semana 93%') !== -1, r.curta);
  assert.ok(r.longa.indexOf('- janela de 5 horas: 37% usada') !== -1, r.longa);
  assert.strictEqual(r.cruzou, false, 'gatilho sem nome/valor/limiar nao cruza a troca');
  assert.ok(new RegExp(' · ' + LONGE + '$').test(r.curta), r.curta);
  const troca = r.longa.split('\n\n').filter(function (b) { return /^\*\*Troca de chat/.test(b); })[0] || '';
  assert.strictEqual((troca.match(/^- /gm) || []).length, certas.length, r.longa);
});

test('entrada torta nao lanca: sem sinal medido, a barra nao inventa quanto falta', () => {
  const r = medidor.linhaDaSessao({ uso: null, amostras: 'x', medidas: null, avisouSaude: false });
  assert.strictEqual(r.curta, '');
});

// Pedido 71 (D544, barra A; p2-27): um estado por linha do mock (prints-083/mock-083.png). Com o modo continuo valem o
// tamanho do contexto (aviso a 250 mil) e os bloqueios; sem ele, os 7. O mais perto e o 1o do bloco "Troca de chat".
test('pedido 71 (D544): troca de chat em N, na unidade do sinal mais perto; disparou -> troque de chat', () => {
  const curta = (estado, continuo) => medidor.linhaDaSessao({ uso: null, amostras: [],
    medidas: saude.medir(estado, null, continuo), avisouSaude: false }).curta;
  assert.strictEqual(curta({ tokensDeContexto: 70000 }, true), 'troca de chat em 180 mil tokens', 'longe do aviso');
  assert.strictEqual(curta({ tokensDeContexto: 238000 }, true), 'troca de chat em 12 mil tokens', 'perto do aviso');
  assert.strictEqual(curta({ tokensDeContexto: 70400 }, true), 'troca de chat em 179 mil tokens', 'arredonda para baixo');
  assert.strictEqual(curta({ tokensDeContexto: 249500 }, true), 'troca de chat em 500 tokens', 'menos de mil');
  assert.strictEqual(curta({ tokensDeContexto: 260000 }, true), 'troque de chat → /sworn:handoff', 'disparou');
  assert.strictEqual(curta({ tokensDeContexto: 1000, contadores: { fora_do_escopo: 5 } }, true),
    'troca de chat em 1 bloqueio de portão', 'o bloqueio mais perto que o contexto');
  assert.strictEqual(curta({ decisoesDoDono: 2, tokensDeContexto: 1000 }, false), 'troca de chat em 1 decisão do dono',
    'sem o modo continuo: o mais perto dos 7');
  assert.strictEqual(curta({ commitsFeitos: 1 }, false), 'troca de chat em 2 commits');
  // o calado pelo modo continuo nunca e o mais perto, nem perto do limite
  assert.strictEqual(curta({ decisoesDoDono: 2, tokensDeContexto: 70000 }, true), 'troca de chat em 180 mil tokens');
  const avisou = medidor.linhaDaSessao({ uso: null, amostras: [], medidas: saude.medir({}, null, true), avisouSaude: true });
  assert.strictEqual(avisou.curta, 'troca já avisada → /sworn:handoff', 'igual a hoje depois do aviso');
});

// Pedido 31 (plano dos pedidos 30-32, Tarefa 3; D520): gasto do mes ao lado do semanal, separado do da sessao.
const GASTO = { usd: 3181.46, real: 12.5, estimado: 3168.96, pendentes: 0, desde: '01/10' };

test('pedido 31: curta com "mês US$" depois das janelas e "sessão US$" depois dele; longa diz as duas fontes', () => {
  const r = medidor.linhaDaSessao({ uso: uso(), amostras: [], medidas: saude.medir({}, null), gasto: GASTO });
  // Plano 082 (p6-16): o mes arredondado com ponto de milhar; a sessao com centavos na virgula.
  assert.ok(/semana 92% · mês US\$ 3\.181 · sessão US\$ 4,10 · /.test(r.curta), r.curta);
  // Plano 082 (mock S4; p6-34, achado da s60): o mes da longa no formato da barra, com centavos; sem jargao.
  assert.ok(r.longa.indexOf('**Gasto**\n- esta sessão: US$ 4,10\n- mês (desde 01/10): US$ 3.181,46 — US$ 12,50 medidos nas ' +
    'sessões com o sworn + US$ 3.168,96 calculados pelas conversas salvas\n' +
    '- na assinatura é o valor que a API cobraria, não uma cobrança\n') !== -1, r.longa);
  assert.ok(!/transcric|estimado|equivalente/.test(r.longa), r.longa);
});

test('plano 082 (p6-16): mês abaixo de US$ 1 sai com centavos, nunca "US$ 0"; acima, arredondado', () => {
  const g = function (usd) {
    // p6-11: o total tem de bater com as duas fontes
    return medidor.linhaDaSessao({ uso: null, amostras: [], medidas: saude.medir({}, null), gasto: Object.assign({}, GASTO, { usd: usd, real: usd, estimado: 0 }) }).curta;
  };
  assert.ok(g(0.42).indexOf('mês US$ 0,42 · ') === 0, g(0.42));
  assert.ok(g(0).indexOf('mês US$ 0,00 · ') === 0, g(0));
  assert.ok(g(1).indexOf('mês US$ 1 · ') === 0, g(1));
  assert.ok(g(3310.5).indexOf('mês US$ 3.311 · ') === 0, g(3310.5));
  assert.ok(g(1234567.4).indexOf('mês US$ 1.234.567 · ') === 0, g(1234567.4));
});

test('pedido 31: conta das transcricoes ainda em curso aparece como "somando"; sem gasto, nada de "mês"', () => {
  const r = medidor.linhaDaSessao({ uso: uso(), amostras: [], medidas: [], gasto: Object.assign({}, GASTO, { pendentes: 7 }) });
  // Plano 082 (p6-22): "+ (somando)" diz que o numero ainda cresce; o detalhe fica na resposta do comando.
  assert.ok(r.curta.indexOf('mês US$ 3.181+ (somando) · ') !== -1, r.curta);
  // Plano 082 (p6-28): plural certo, sem "medidas" e dizendo que nao ha nada a fazer.
  assert.ok(r.longa.indexOf('- ainda somando: faltam 7 conversas salvas para ler; o total se completa sozinho nas ' +
    'próximas respostas, sem você fazer nada\n') !== -1, r.longa);
  const um = medidor.linhaDaSessao({ uso: uso(), amostras: [], medidas: [], gasto: Object.assign({}, GASTO, { pendentes: 1 }) });
  assert.ok(um.longa.indexOf('- ainda somando: falta 1 conversa salva para ler;') !== -1, um.longa);
  const sem = medidor.linhaDaSessao({ uso: uso(), amostras: [], medidas: [] });
  assert.ok(sem.curta.indexOf('mês ') === -1 && sem.longa.indexOf('- mês') === -1 && sem.longa.indexOf('assinatura') === -1, sem.longa);
  const torto = medidor.linhaDaSessao({ uso: uso(), amostras: [], medidas: [], gasto: { usd: 'x' } });
  assert.ok(torto.curta.indexOf('mês ') === -1, torto.curta);
});

test('A6-02: o que ficou fora da conta do mes (sem preco, ilegivel) aparece na resposta longa, nunca calado', () => {
  const longa = function (extra) {
    return medidor.linhaDaSessao({ uso: uso(), amostras: [], medidas: [], gasto: Object.assign({}, GASTO, extra) }).longa;
  };
  const varios = longa({ semPreco: 295, ilegiveis: 2 });
  assert.ok(varios.indexOf('- fora da conta: 295 mensagens de um modelo que a tabela de preços não tem; o mês sai ' +
    'menor do que é\n') !== -1, varios);
  assert.ok(varios.indexOf('- fora da conta: 2 conversas salvas que não se leram; a próxima medida tenta de novo\n') !== -1,
    varios);
  const um = longa({ semPreco: 1, ilegiveis: 1 });
  assert.ok(um.indexOf('- fora da conta: 1 mensagem de um modelo que a tabela de preços não tem;') !== -1, um);
  assert.ok(um.indexOf('- fora da conta: 1 conversa salva que não se leu;') !== -1, um);
  for (const nada of [{}, { semPreco: 0, ilegiveis: 0 }, { semPreco: 'x', ilegiveis: -1 }]) {
    assert.ok(longa(nada).indexOf('fora da conta') === -1, longa(nada));
  }
});

// Plano 082 (p6-24): a barra na ordem contexto · 5h · semana · mês · sessão · troca; o plano saiu dela (esta na faixa).
test('plano 082: a barra na ordem do mock e sem o plano, mesmo se o chamador mandar planoCurto', () => {
  const r = medidor.linhaDaSessao({ uso: uso(), amostras: [], medidas: saude.medir({}, null), gasto: GASTO, planoCurto: 'plano d503 5 de 6' });
  const partes = r.curta.split(' · ').map(function (p) { return p.split(' ')[0]; });
  assert.deepStrictEqual(partes, ['contexto', '5h', 'semana', 'mês', 'sessão', 'troca'], r.curta);
  assert.ok(r.curta.indexOf('plano') === -1 && r.curta.indexOf('sworn') === -1 && r.curta.indexOf('|') === -1, r.curta);
});

// Pedido 31: "semana/5h acabam em ~N handoffs" pela media das sessoes anteriores (historico do $.store).
function hist(n, kind, porSessao, reset, extra) {
  const h = {};
  for (let i = 0; i < n; i++) {
    h['s' + i] = Object.assign({ t: 1000 + i, medidas: 5,
      janelas: { [kind]: { resetIni: reset, ini: 10, resetFim: reset, fim: 10 + porSessao } } }, extra || {});
  }
  return h;
}

test('pedido 31: previsao em handoffs pela media das sessoes anteriores (a atual fora)', () => {
  const h = hist(3, 'seven_day', 2, 'R7');
  h.atual = { t: 9999, medidas: 9, janelas: { seven_day: { resetIni: 'R7', ini: 0, resetFim: 'R7', fim: 80 } } };
  const r = medidor.linhaDaSessao({ uso: uso(), amostras: [], medidas: [], historico: h, sessao: 'atual' });
  // semana 92% usada, 2% por sessao -> 4 handoffs; plano 082 (p6-32): so na resposta do comando, nunca na barra
  assert.ok(r.curta.indexOf('semana 92% · ') !== -1 && r.curta.indexOf('handoffs') === -1, r.curta);
  // Plano 082 (mock S4; p6-29): "trocas de chat" no lugar de "handoffs", e a media diz que so conta o chat medido
  assert.ok(r.longa.indexOf('- a janela da semana acaba em ~4 trocas de chat (média de 2% por chat, nos últimos 3 que deu ' +
    'para medir)\n') !== -1, r.longa);
  assert.ok(r.longa.indexOf('handoffs') === -1, r.longa);
});

test('pedido 31: previsao em handoffs - so as ultimas 5, sessao que cruza a renovacao fora, sem 2 medidas omite', () => {
  const h = hist(6, 'five_hour', 1, 'R5');
  h.s0.janelas.five_hour.fim = 60; // a mais antiga (t menor) fica fora das 5
  h.cruzou = { t: 5000, medidas: 5, janelas: { five_hour: { resetIni: 'R5a', ini: 1, resetFim: 'R5', fim: 50 } } };
  h.curta = { t: 5001, medidas: 1, janelas: { five_hour: { resetIni: 'R5', ini: 0, resetFim: 'R5', fim: 40 } } };
  const r = medidor.linhaDaSessao({ uso: uso(), amostras: [], medidas: [], historico: h, sessao: 'x' });
  // 5h 49% usada, 1% por sessao nas 5 ultimas validas -> 51 handoffs
  assert.ok(r.longa.indexOf('- a janela de 5 horas acaba em ~51 trocas de chat (média de 1% por chat, nos últimos 5 que ' +
    'deu para medir)\n') !== -1, r.longa);
  assert.ok(/^contexto 5% · 5h 49% até [0-9:]+ · semana/.test(r.curta), r.curta);
  const uma = medidor.linhaDaSessao({ uso: uso(), amostras: [], medidas: [], historico: hist(1, 'five_hour', 3, 'R5') });
  assert.ok(uma.longa.indexOf('trocas de chat (') === -1, 'uma sessao so nao faz media: ' + uma.longa);
  const zero = medidor.linhaDaSessao({ uso: uso(), amostras: [], medidas: [], historico: hist(3, 'five_hour', 0, 'R5') });
  assert.ok(zero.longa.indexOf('trocas de chat (') === -1, 'media zero nao divide: ' + zero.longa);
  const torto = medidor.linhaDaSessao({ uso: uso(), amostras: [], medidas: [], historico: { a: null, b: { janelas: 3 } } });
  assert.ok(!/undefined|NaN|Infinity/.test(torto.curta + torto.longa), torto.curta);
});

// --- Plano 082, Tarefa 3 (mock D532, tela S4): a resposta do /sworn-session em 5 blocos com titulo ---

// A cena do mock parte 2: modo continuo ligado, 2 sinais valendo e 5 desligados; 5h com previsao nas duas unidades.
function cenaDoMock() {
  const local = function (mes, d, h, m) { return new Date(2026, mes - 1, d, h, m).toISOString(); };
  const historico = {};
  for (let i = 0; i < 5; i++) {
    const janelas = { seven_day: { resetIni: 'R7', ini: 10, resetFim: 'R7', fim: 10.8 } };
    if (i >= 2) janelas.five_hour = { resetIni: 'R5', ini: 0, resetFim: 'R5', fim: 5 };
    historico['s' + i] = { t: 1000 + i, medidas: 5, janelas: janelas };
  }
  const arquivos = [];
  for (let i = 0; i < 15; i++) arquivos.push('a' + i + '.js');
  return {
    uso: {
      context: { tokens: 240283, window: 1000000, percent: 24 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 4, resetsAt: local(10, 16, 13, 50) },
        { kind: 'seven_day', percentUsed: 18, resetsAt: local(10, 22, 4, 0) }
      ],
      cost: { usd: 7.52 }
    },
    // contexto sobe 30000 por resposta: 759717 / 30000 -> ~25; 5h sobe 1: 96 / 1 -> ~96
    amostras: [{ tokens: 180283, cincoH: 2 }, { tokens: 210283, cincoH: 3 }, { tokens: 240283, cincoH: 4 }],
    medidas: saude.medir({ turnosComTrabalho: 6, contadores: { fora_do_escopo: 1 }, arquivosTocados: arquivos,
      decisoesDoDono: 2, commitsFeitos: 0, tokensDeContexto: 240283 }, null, true),
    historico: historico, sessao: 'atual', avisouSaude: false,
    gasto: { usd: 3311.53, real: 54.44, estimado: 3257.09, pendentes: 0, desde: '01/10' }
  };
}

test('plano 082 (S4): a resposta do comando e a do mock, bloco por bloco', () => {
  const r = medidor.linhaDaSessao(cenaDoMock());
  assert.strictEqual(r.longa, [
    '**Contexto e limites**',
    '- contexto: 24% (240.283 de 1.000.000 tokens)',
    '- janela de 5 horas: 4% usada, renova às 13:50',
    '- janela da semana: 18% usada, renova 22/10 às 04:00',
    '',
    '**Gasto**',
    '- esta sessão: US$ 7,52',
    '- mês (desde 01/10): US$ 3.311,53 — US$ 54,44 medidos nas sessões com o sworn + US$ 3.257,09 calculados pelas conversas salvas',
    '- na assinatura é o valor que a API cobraria, não uma cobrança',
    '',
    '**Previsão**',
    '- o contexto enche em ~25 respostas',
    '- a janela de 5 horas acaba em ~96 respostas, ou ~19 trocas de chat (média de 5% por chat, nos últimos 3 que deu para medir)',
    '- a janela da semana acaba em ~102 trocas de chat (média de 0,8% por chat, nos últimos 5 que deu para medir)',
    '',
    '**Troca de chat — 0 de 2 sinais dispararam (basta 1)**',
    '- tamanho do contexto: 240.283 de 250.000 tokens ← perto do limite',
    '- bloqueios de portão: 1 de 6',
    '- desligados pelo modo contínuo: respostas 6/15 · revisões 0/2 · arquivos 15/25 · decisões 2/3 · commits 0/3',
    '',
    '**O que fazer**',
    'Nada por ora.'
  ].join('\n'));
  assert.strictEqual(r.cruzou, false);
});

test('plano 082 (S4): sinal que disparou e aviso ja dado mandam ao handoff; "perto" so a partir de 90% do limiar', () => {
  const cruzou = medidor.linhaDaSessao({ uso: null, amostras: [], avisouSaude: false,
    medidas: saude.medir({ contadores: { revisao_fechada: 17 }, decisoesDoDono: 2, turnosComTrabalho: 13 }, null) });
  assert.ok(cruzou.longa.indexOf('**Troca de chat — 1 de 7 sinais disparou (basta 1)**\n') !== -1, cruzou.longa);
  // o que disparou vem primeiro (mais perto do limite em cima); 13 de 15 = 87%: ainda nao e "perto"
  assert.ok(cruzou.longa.indexOf('(basta 1)**\n- revisões independentes fechadas: 17 de 2 ← disparou\n') !== -1, cruzou.longa);
  assert.ok(cruzou.longa.indexOf('- respostas com trabalho real: 13 de 15\n') !== -1, cruzou.longa);
  assert.ok(cruzou.longa.indexOf('- decisões do dono respondidas: 2 de 3\n') !== -1, cruzou.longa);
  assert.ok(/\*\*O que fazer\*\*\nRode \/sworn:handoff e cole o prompt pronto num chat novo\.$/.test(cruzou.longa), cruzou.longa);
  const perto = medidor.linhaDaSessao({ uso: null, amostras: [], avisouSaude: false, medidas: saude.medir({ turnosComTrabalho: 14 }, null) });
  assert.ok(perto.longa.indexOf('- respostas com trabalho real: 14 de 15 ← perto do limite\n') !== -1, perto.longa);
  const avisou = medidor.linhaDaSessao({ uso: null, amostras: [], avisouSaude: true, medidas: saude.medir({}, null) });
  assert.ok(avisou.longa.indexOf('\n- o aviso de troca já foi dado nesta sessão; os contadores recomeçam depois dele\n') !== -1, avisou.longa);
  assert.ok(/Rode \/sworn:handoff/.test(avisou.longa), avisou.longa);
});

// Plano 083 Tarefa 4: p2-26 (concordancia do titulo), p2-11 (SINAL/FALTA sem o prototipo), p2-12 (sem "-0,00").
test('083 T4 (p2-26): o titulo concorda - "1 de N sinais disparou", "2 de N sinais dispararam"', () => {
  const dois = medidor.linhaDaSessao({ uso: null, amostras: [], avisouSaude: false,
    medidas: saude.medir({ contadores: { revisao_fechada: 17 }, commitsFeitos: 3 }, null) });
  assert.ok(dois.longa.indexOf('**Troca de chat — 2 de 7 sinais dispararam (basta 1)**\n') !== -1, dois.longa);
});

test('083 T4 (p2-11): chave com nome de propriedade do Object (constructor, toString) usa o nome que veio', () => {
  for (const chave of ['constructor', 'toString', '__proto__']) {
    const r = medidor.linhaDaSessao({ uso: null, amostras: [], avisouSaude: false,
      medidas: [{ chave: chave, nome: 'sinal x', valor: 1, limiar: 5, cruzou: false }] });
    assert.ok(r.longa.indexOf('\n- sinal x: 1 de 5\n') !== -1, chave + ': ' + r.longa);
    assert.strictEqual(r.curta, 'troca de chat em 4 sinal x', chave);
  }
});

test('083 T4 (p2-12): custo negativo minusculo sai "US$ 0,00", nunca "-0,00"', () => {
  for (const usd of [-0.001, -0.004]) {
    const r = medidor.linhaDaSessao({ uso: { cost: { usd: usd } }, amostras: [], medidas: saude.medir({}, null) });
    assert.ok(r.curta.indexOf('sessão US$ 0,00 · ') === 0, r.curta);
    assert.ok(r.longa.indexOf('- esta sessão: US$ 0,00\n') !== -1, r.longa);
  }
});

test('plano 082 (S4): estados sem leitura e sem previsao dizem quando o numero aparece; entrada vazia nao quebra', () => {
  const r = medidor.linhaDaSessao({});
  assert.strictEqual(r.longa, [
    '**Contexto e limites**',
    '- contexto: ainda sem leitura — aparece depois da 1ª resposta',
    '- limites de 5 horas e da semana: ainda sem leitura — aparecem depois da 1ª resposta, só na assinatura',
    '',
    '**Previsão**',
    SEM_PREVISAO,
    '',
    '**Troca de chat — 0 de 0 sinais dispararam (basta 1)**',
    '- nenhum sinal medido ainda',
    '',
    '**O que fazer**',
    'Nada por ora.'
  ].join('\n'));
  // p6-23: sem "o motor" nem "gatilho" na tela
  assert.ok(!/motor|gatilho|turno|handoff/.test(r.longa), r.longa);
});

test('achado s60: token negativo ou janela zero nao desenham a conta de tokens do contexto', () => {
  for (const ctx of [{ tokens: -5, window: 1000000, percent: 5 }, { tokens: 5, window: 0, percent: 5 }, { tokens: 5, percent: 5 }]) {
    const r = medidor.linhaDaSessao({ uso: { context: ctx }, amostras: [], medidas: [] });
    assert.ok(r.longa.indexOf('- contexto: 5%\n') !== -1, JSON.stringify(ctx) + ': ' + r.longa);
  }
});

test('plano 082 (p6-13): gasto sem "desde" ou com pendentes torto nao desenha undefined', () => {
  for (const extra of [{ desde: undefined }, { desde: '' }, { desde: 3 }]) {
    const r = medidor.linhaDaSessao({ uso: null, amostras: [], medidas: [], gasto: Object.assign({}, GASTO, extra) });
    assert.ok(r.longa.indexOf('- mês: US$ 3.181,46 — ') !== -1, JSON.stringify(extra) + ': ' + r.longa);
  }
  for (const pendentes of ['7', null, -2, NaN]) {
    const r = medidor.linhaDaSessao({ uso: null, amostras: [], medidas: [], gasto: Object.assign({}, GASTO, { pendentes: pendentes }) });
    assert.ok(r.longa.indexOf('somando') === -1 && r.curta.indexOf('somando') === -1, String(pendentes) + ': ' + r.longa);
    assert.ok(!/undefined|NaN|null/.test(r.longa + r.curta), r.longa);
  }
});

// --- Plano 082, Tarefa 6 (p6-11, p6-12, p6-21): numero que nao se sustenta nao aparece ---

test('plano 082 (p6-11): gasto negativo ou com total que nao bate com as duas fontes fica de fora', () => {
  const tortos = [
    { usd: -5, real: -5, estimado: 0 },
    { usd: 5, real: -1, estimado: 6 },
    { usd: 5, real: 6, estimado: -1 },
    { usd: 100, real: 12.5, estimado: 3168.96 }
  ];
  for (const t of tortos) {
    const r = medidor.linhaDaSessao({ uso: null, amostras: [], medidas: [], gasto: Object.assign({}, GASTO, t) });
    assert.ok(r.curta.indexOf('mês ') === -1 && r.longa.indexOf('- mês') === -1, JSON.stringify(t) + ': ' + r.curta);
  }
  // a soma em ponto flutuante (0.1 + 0.2 = 0.30000000000000004) nao derruba o gasto certo
  const g = function (usd, real) {
    return medidor.linhaDaSessao({ uso: null, amostras: [], medidas: [], gasto: Object.assign({}, GASTO, { usd: usd, real: real, estimado: 0.2 }) }).curta;
  };
  assert.ok(g(0.3, 0.1).indexOf('mês US$ 0,30') === 0, g(0.3, 0.1));
  // borda: ate meio centavo de diferenca passa; acima, nao (10.205 - 10.2 da 0.0050000000000008 em ponto flutuante)
  assert.ok(g(10.204, 10).indexOf('mês US$ 10') === 0, g(10.204, 10));
  assert.ok(g(10.206, 10).indexOf('mês ') === -1, g(10.206, 10));
});

test('plano 082 (p6-12): sem a sessao atual nao ha como tira-la da media, entao a previsao em trocas de chat some', () => {
  const h = hist(3, 'seven_day', 2, 'R7');
  for (const sessao of [undefined, '', null, 3]) {
    const r = medidor.linhaDaSessao({ uso: uso(), amostras: [], medidas: [], historico: h, sessao: sessao });
    assert.ok(r.longa.indexOf('trocas de chat (') === -1, String(sessao) + ': ' + r.longa);
  }
  const com = medidor.linhaDaSessao({ uso: uso(), amostras: [], medidas: [], historico: h, sessao: 'atual' });
  assert.ok(com.longa.indexOf('trocas de chat (') !== -1, com.longa);
});

test('plano 082 (p6-21): renovacao desconhecida nas duas pontas fica fora; a janela vem do historico, sem lista fixa', () => {
  const semReset = medidor.linhaDaSessao({ uso: uso(), amostras: [], medidas: [], historico: hist(3, 'seven_day', 2, null), sessao: 'x' });
  assert.ok(semReset.longa.indexOf('trocas de chat (') === -1, semReset.longa);
  const vazio = medidor.linhaDaSessao({ uso: uso(), amostras: [], medidas: [], historico: hist(3, 'seven_day', 2, ''), sessao: 'x' });
  assert.ok(vazio.longa.indexOf('trocas de chat (') === -1, vazio.longa);
  const gasto = uso({ rateLimits: [{ kind: 'spend_limit', percentUsed: 40 }] });
  const r = medidor.linhaDaSessao({ uso: gasto, amostras: [], medidas: [], historico: hist(3, 'spend_limit', 10, 'RG'), sessao: 'x' });
  assert.ok(r.longa.indexOf('- o limite de gasto acaba em ~6 trocas de chat (média de 10% por chat, nos últimos 3 que deu ' +
    'para medir)\n') !== -1, r.longa);
});
