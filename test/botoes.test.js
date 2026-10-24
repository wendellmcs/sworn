'use strict';
// Pedido 32 (plano dos pedidos 30-32, Tarefa 4 subitem 3): um botao por comando na faixa do mod, na hora certa.
// scripts/lib/botoes.js decide quais valem agora, pelos sinais que ja existem (tabela do §2 do plano), e devolve a
// lista na ordem de prioridade; o sessao.js a repassa e o mod desenha o primeiro que a pessoa ainda nao usou.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const botoes = require('../scripts/lib/botoes.js');
const correcao = require('../scripts/lib/correcao.js');
const calibracao = require('../scripts/lib/calibracao.js');

const RAIZ = path.join(os.tmpdir(), 'sworn-botoes-raiz');
const COM_REF = { marchas: { aaa: ['src/**'] }, referencias: { codigo: ['ref/topo.js'] } };
const SO_AAA = { marchas: { aaa: ['src/**'] } };

/** A entrada minima: projeto configurado, nada aceso. Cada teste liga um sinal so. */
function base(extra) {
  return Object.assign({ cruzou: false, s: {}, projeto: {}, raiz: RAIZ, temProjeto: true, resposta: '',
    padraoCarregado: false, contarConversas: function () { return 0; } }, extra || {});
}

function nomes(lista) { return lista.map(function (b) { return b.nome; }); }

test('botoes: nada aceso, nenhum botao', () => {
  assert.deepStrictEqual(botoes.daSessao(base()), []);
});

test('botoes: a ordem de prioridade e a do plano (handoff > revisar > aprender > init > auditar > calibrar > padrao)', () => {
  // Plano 091 #5 (D557): o paralelo roda direto, entao o botao "o agente ofereceu" saiu.
  assert.deepStrictEqual(botoes.ORDEM, ['handoff', 'revisar', 'aprender', 'init', 'auditar', 'calibrar', 'padrao']);
});

test('botao handoff: o gatilho contavel cruzou', () => {
  const b = botoes.daSessao(base({ cruzou: true }));
  assert.deepStrictEqual(nomes(b), ['handoff']);
  assert.strictEqual(b[0].comando, '/sworn:handoff');
  assert.strictEqual(b[0].rotulo, 'gerar handoff');
  assert.match(b[0].texto, /troca de chat cruzou/);
});

test('botao revisar: arquivo AAA com referencia mudado e nenhuma revisao contra ela fechada (a condicao do portao, D503)', () => {
  // manual carregado: o arquivo AAA nao acende tambem o do padrao, e o teste olha so o do revisar
  const s = { arquivosTocados: [path.join(RAIZ, 'src', 'a.js')] };
  const b = botoes.daSessao(base({ s: s, projeto: COM_REF, padraoCarregado: true }));
  assert.deepStrictEqual(nomes(b), ['revisar']);
  assert.strictEqual(b[0].comando, '/sworn:review src/a.js', 'o comando ja leva o arquivo');
  // o sinal passa: a revisao contra a referencia fechou (o balde que o apurar-ronda.js grava)
  const fechada = Object.assign({}, s, { contadores: { revisao_referencia_fechada: 1 } });
  assert.deepStrictEqual(botoes.daSessao(base({ s: fechada, projeto: COM_REF, padraoCarregado: true })), []);
  // sem referencia declarada, nao e o do revisar
  assert.deepStrictEqual(nomes(botoes.daSessao(base({ s: s, projeto: SO_AAA, padraoCarregado: true }))), []);
});

test('botao aprender: o ultimo prompt do dono pareceu correcao e o abrir-turno sugeriu (espera cheia)', () => {
  const s = { esperaAprender: correcao.ESPERA_ENTRE_SUGESTOES };
  const b = botoes.daSessao(base({ s: s }));
  assert.deepStrictEqual(nomes(b), ['aprender']);
  assert.strictEqual(b[0].comando, '/sworn:learn');
  // o sinal passa no prompt seguinte (a espera desce)
  assert.deepStrictEqual(botoes.daSessao(base({ s: { esperaAprender: correcao.ESPERA_ENTRE_SUGESTOES - 1 } })), []);
});

test('botao init: projeto sem .claude/sworn/projeto.json', () => {
  const b = botoes.daSessao(base({ temProjeto: false, projeto: null }));
  assert.deepStrictEqual(nomes(b), ['init']);
  assert.strictEqual(b[0].comando, '/sworn:init');
});

test('botao auditar: a auditoria automatica da abertura avisou nesta sessao', () => {
  const b = botoes.daSessao(base({ s: { auditoriaAvisou: true } }));
  assert.deepStrictEqual(nomes(b), ['auditar']);
  assert.strictEqual(b[0].comando, '/sworn:audit');
});

test('botao calibrar: amostra minima de conversas e o limiar de contexto nunca calibrado', () => {
  const minimo = calibracao.AMOSTRA_MINIMA.sessoes;
  const b = botoes.daSessao(base({ contarConversas: function () { return minimo; } }));
  assert.deepStrictEqual(nomes(b), ['calibrar']);
  assert.strictEqual(b[0].comando, '/sworn:calibrate');
  assert.ok(b[0].texto.indexOf(String(minimo)) !== -1, 'o texto diz quantas conversas: ' + b[0].texto);
  assert.deepStrictEqual(botoes.daSessao(base({ contarConversas: function () { return minimo - 1; } })), [], 'abaixo do minimo');
  // ja calibrado: nem conta as conversas
  let contou = false;
  const calibrado = base({ projeto: { limiares: { tokensDeContexto: 150000 } },
    contarConversas: function () { contou = true; return minimo; } });
  assert.deepStrictEqual(botoes.daSessao(calibrado), []);
  assert.strictEqual(contou, false, 'com o limiar gravado, nao conta conversa nenhuma');
  // sem projeto.json o calibrar nao grava: vale o init
  assert.deepStrictEqual(nomes(botoes.daSessao(base({ temProjeto: false, projeto: null,
    contarConversas: function () { return minimo; } }))), ['init']);
});

test('091 #5: sem botao paralelo - a resposta que cita /sworn:parallel nao acende nada (roda direto, D557)', () => {
  const b = botoes.daSessao(base({ resposta: 'Sao 3 tarefas independentes: ofereco o /sworn:parallel com 3 agentes Haiku.' }));
  assert.deepStrictEqual(b, []);
});

test('botao padrao: arquivo AAA mudado e o manual de execucao nao carregado na sessao', () => {
  const s = { arquivosTocados: [path.join(RAIZ, 'src', 'a.js')] };
  const b = botoes.daSessao(base({ s: s, projeto: SO_AAA }));
  assert.deepStrictEqual(nomes(b), ['padrao']);
  assert.strictEqual(b[0].comando, '/sworn:playbook');
  assert.deepStrictEqual(botoes.daSessao(base({ s: s, projeto: SO_AAA, padraoCarregado: true })), [], 'carregado: passa');
  assert.deepStrictEqual(botoes.daSessao(base({ s: { arquivosTocados: [path.join(RAIZ, 'docs', 'b.md')] }, projeto: SO_AAA })), [],
    'arquivo fora da AAA nao pede o manual');
});

test('botoes: tudo aceso sai na ordem de prioridade', () => {
  const s = { arquivosTocados: [path.join(RAIZ, 'src', 'a.js')], esperaAprender: correcao.ESPERA_ENTRE_SUGESTOES,
    auditoriaAvisou: true };
  const b = botoes.daSessao(base({ cruzou: true, s: s, projeto: COM_REF, resposta: '/sworn:parallel',
    contarConversas: function () { return 999; } }));
  assert.deepStrictEqual(nomes(b), ['handoff', 'revisar', 'aprender', 'auditar', 'calibrar', 'padrao']);
  b.forEach(function (x) {
    assert.match(x.comando, /^\/sworn:[a-z]+( \S.*)?$/, 'comando do sworn: ' + x.comando);
  });
});

// Plano 082, Tarefa 2 (p5-36; mock D532, S1-S2): texto e rotulo sem jargao, dizendo o que fazer, com acento (D532: a
// faixa e excecao a R5). handoff, calibrar e padrao como no mock; os outros 5 na mesma voz.
test('plano 082 (p5-36): os 7 textos e rotulos (8 menos o paralelo, 091 #5), sem jargao e com acento', () => {
  const s = { arquivosTocados: [path.join(RAIZ, 'src', 'a.js')], esperaAprender: correcao.ESPERA_ENTRE_SUGESTOES,
    auditoriaAvisou: true };
  const tudo = botoes.daSessao(base({ cruzou: true, s: s, projeto: COM_REF, resposta: '/sworn:parallel',
    contarConversas: function () { return 557; } })).concat(botoes.daSessao(base({ temProjeto: false, projeto: null })));
  const visto = {};
  tudo.forEach(function (x) { visto[x.nome] = x.texto + ' [' + x.rotulo + ']'; });
  assert.deepStrictEqual(visto, {
    handoff: 'Um gatilho de troca de chat cruzou: gere o handoff e siga num chat novo. [gerar handoff]',
    revisar: 'Você mudou arquivo de rigor máximo e nenhuma revisão contra a referência do projeto fechou. [revisar]',
    aprender: 'Isso pareceu uma correção sua: dá para virar regra das próximas vezes. [virar regra]',
    init: 'Este projeto ainda não tem o sworn configurado. [configurar]',
    auditar: 'A auditoria automática achou regras ou skills para cortar. [ver o que cortar]',
    calibrar: 'Já há 557 conversas salvas: dá para calibrar quando trocar de chat. [calibrar]',
    padrao: 'Você mudou arquivo de rigor máximo sem carregar o manual. [carregar o manual]'
  });
  for (const x of tudo) {
    assert.ok(!/AAA|execucao|contavel|\?/.test(x.texto + x.rotulo), 'sem jargao nem "?": ' + x.texto);
    assert.ok(/^[A-ZÀ-Ú].*\.$/.test(x.texto), 'frase inteira, com maiuscula e ponto: ' + x.texto);
  }
});

test('botoes: estado torto nao lanca (arquivosTocados que nao e lista, contador que nao e numero)', () => {
  assert.deepStrictEqual(botoes.daSessao(base({ s: { arquivosTocados: 'x', contadores: 'y' }, projeto: COM_REF })), []);
  assert.deepStrictEqual(botoes.daSessao({}), []);
});

// Plano 082, Tarefa 6 (p5-31): o contarConversas() lancava e a lista inteira caia; agora so o calibrar fica de fora.
test('082 T6 (p5-31): contarConversas que lanca tira so o calibrar, os outros botoes ficam', () => {
  const b = botoes.daSessao(base({ cruzou: true, s: { auditoriaAvisou: true },
    contarConversas: function () { throw new Error('EACCES'); } }));
  assert.deepStrictEqual(nomes(b), ['handoff', 'auditar']);
});

// p5-33: a ORDEM exportada e a ordem da lista (antes valia a ordem dos if, e as duas podiam divergir).
test('082 T6 (p5-33): a lista sai na ordem de ORDEM, nao na ordem dos if', () => {
  const s = { arquivosTocados: [path.join(RAIZ, 'src', 'a.js')], esperaAprender: correcao.ESPERA_ENTRE_SUGESTOES,
    auditoriaAvisou: true };
  const entrada = base({ cruzou: true, s: s, projeto: COM_REF, resposta: '/sworn:parallel',
    contarConversas: function () { return 999; } });
  const antes = botoes.ORDEM.slice();
  try {
    botoes.ORDEM.reverse();
    assert.deepStrictEqual(nomes(botoes.daSessao(entrada)), ['padrao', 'calibrar', 'auditar', 'aprender', 'revisar', 'handoff']);
  } finally { botoes.ORDEM.splice(0, botoes.ORDEM.length, ...antes); }
  assert.deepStrictEqual(botoes.ORDEM, antes);
});

// p5-37: o caminho com espaco ia cru no comando e virava dois argumentos do /sworn:review.
test('082 T6 (p5-37): arquivo com espaco vai entre aspas no comando do revisar (sem espaco, cru: teste do botao revisar)', () => {
  const s = { arquivosTocados: [path.join(RAIZ, 'src', 'meu arquivo.js')] };
  const b = botoes.daSessao(base({ s: s, projeto: COM_REF, padraoCarregado: true }));
  assert.strictEqual(b[0].comando, '/sworn:review "src/meu arquivo.js"');
});

// Plano 083 (p1-32): a barra antes da aspa que fecha nao pode escapar a aspa. O leitor abaixo segue a regra padrao
// de linha de comando (2n barras + aspa = n barras e a aspa abre/fecha; 2n+1 = n barras e uma aspa literal).
function lerArgumento(t) {
  let out = '';
  let dentro = false;
  for (let i = 0; i < t.length; i++) {
    let barras = 0;
    while (t[i] === '\\') { barras++; i++; }
    if (t[i] === '"') {
      out += '\\'.repeat(Math.floor(barras / 2));
      if (barras % 2) out += '"'; else dentro = !dentro;
    } else {
      out += '\\'.repeat(barras);
      if (i < t.length) out += t[i];
    }
  }
  assert.strictEqual(dentro, false, 'aspa aberta no fim: ' + t);
  return out;
}

test('083 T5 (p1-32): argumento com barra no fim ou antes de aspa volta inteiro pela regra de linha de comando', () => {
  assert.strictEqual(botoes.argumento('C:\\a b\\'), '"C:\\a b\\\\"');
  assert.strictEqual(botoes.argumento('C:\\sem-espaco\\'), 'C:\\sem-espaco\\', 'sem espaco nem aspa, cru');
  for (const p of ['C:\\a b\\', 'C:\\a b\\\\', 'a b\\"c', 'meu "arquivo".js', 'x y\\z', 'src/meu arquivo.js', 'C:\\a\\b c\\d.js']) {
    assert.strictEqual(lerArgumento(botoes.argumento(p)), p, p + ' -> ' + botoes.argumento(p));
  }
});

test('conversasDoProjeto: conta os .jsonl da pasta uma vez por dia (marca no cache)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-botoes-'));
  try {
    const pasta = path.join(dir, 'transcricoes');
    fs.mkdirSync(pasta);
    ['a.jsonl', 'b.jsonl', 'c.jsonl', 'nota.txt'].forEach(function (n) { fs.writeFileSync(path.join(pasta, n), '{}\n'); });
    const cache = path.join(dir, 'cache', 'calibrar.json');
    const dia1 = Date.UTC(2026, 9, 15, 12);
    assert.strictEqual(botoes.conversasDoProjeto(pasta, cache, dia1), 3);
    fs.writeFileSync(path.join(pasta, 'd.jsonl'), '{}\n');
    assert.strictEqual(botoes.conversasDoProjeto(pasta, cache, dia1 + 3600000), 3, 'no mesmo dia vale a marca');
    assert.strictEqual(botoes.conversasDoProjeto(pasta, cache, dia1 + 86400000), 4, 'no dia seguinte conta de novo');
    // a pasta do estado e uma so para todos os projetos: outro projeto no mesmo dia nao herda a contagem
    const outra = path.join(dir, 'outro-projeto');
    fs.mkdirSync(outra);
    fs.writeFileSync(path.join(outra, 'x.jsonl'), '{}\n');
    assert.strictEqual(botoes.conversasDoProjeto(outra, cache, dia1 + 86400000), 1, 'outra pasta, outra contagem');
    assert.strictEqual(botoes.conversasDoProjeto(null, cache, dia1), 0, 'sem pasta de transcricoes');
    assert.strictEqual(botoes.conversasDoProjeto(path.join(dir, 'nao-existe'), path.join(dir, 'c2.json'), dia1), 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
