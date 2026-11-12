'use strict';
// D466/D467/D468 (0.7.0): menos paradas. Ligado por padrao: validar pelo proprio agente antes de pedir acao
// manual. Sob a chave `modoContinuo` (so o booleano true liga): os gatilhos contaveis de revisoes, decisoes,
// commits, turnos e arquivos nao pedem troca de chat; tamanho, alarme e bloqueios seguem.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const c = require('../scripts/lib/continuo.js');
const saude = require('../scripts/lib/saude.js');
const projetoLib = require('../scripts/lib/projeto.js');

// Plano 091 (#9, D556/D559): o modo continuo passa a vir ligado; so o booleano false desliga.
test('continuo: com false, o bloco so manda validar antes de pedir acao manual e diz como ligar a chave', () => {
  const b = c.bloco({ modoContinuo: false });
  assert.ok(/^# sworn - menos paradas/.test(b), 'titulo');
  assert.ok(/valide voce mesmo/.test(b), 'validar pelo proprio agente');
  assert.ok(/credencial/.test(b) && /num pedido so/.test(b), 'o que pedir ao dono, junto');
  assert.ok(!/Modo continuo ligado/.test(b), 'desligado o bloco nao diz que esta ligado');
  assert.ok(b.indexOf('"' + c.CHAVE + '": true') !== -1, 'diz como ligar com a chave que o codigo le');
});

test('continuo: sem a chave (e sem projeto), o bloco diz o que para e o que nao para, e manda decidir o tecnico', () => {
  assert.strictEqual(c.bloco(null), c.bloco({ modoContinuo: true }), 'sem a chave = ligado');
  const b = c.bloco(null);
  assert.ok(/Modo continuo ligado/.test(b), b);
  assert.ok(/tamanho da conversa/.test(b) && /bloqueios/.test(b), 'o que ainda pede troca');
  assert.ok(/Releia o trecho do plano/.test(b), 'reler o plano antes de cada subitem');
  // D785 item 6 (s369, 2.6): "o de produto" virou regra de negocio; o custo segue citado (o de dentro do pedido nao)
  assert.ok(/irreversivel/.test(b) && /custo/.test(b) && /regra de negocio/.test(b), 'quando ainda perguntar');
  assert.ok(/credencial, permissao ou seguranca/.test(b), 'SP7: credencial, permissao e seguranca vao ao dono');
  assert.ok(b.indexOf('"' + c.CHAVE + '": false') !== -1, 'diz como desligar');
});

test('continuo: so o booleano false desliga; ASCII puro e dentro do teto', () => {
  for (const v of [null, undefined, {}, { modoContinuo: 'false' }, { modoContinuo: 0 }, { modoContinuo: true }, [], 'x']) {
    assert.strictEqual(c.ativo(v), true, JSON.stringify(v));
    assert.strictEqual(c.bloco(v), c.bloco(null), JSON.stringify(v));
  }
  assert.strictEqual(c.ativo({ modoContinuo: false }), false);
  for (const b of [c.bloco(null), c.bloco({ modoContinuo: false })]) {
    assert.ok(/^[\x20-\x7E\n]+$/.test(b), 'caractere fora de ASCII');
    assert.ok(b.length <= c.TETO, 'bloco com ' + b.length + ' caracteres, teto ' + c.TETO);
  }
});

test('continuo: a chave e de liga/desliga do projeto.json (aviso de tipo e validar)', () => {
  assert.ok(projetoLib.CHAVES_LIGA_DESLIGA.indexOf('modoContinuo') !== -1);
  assert.ok(projetoLib.avisosDeTipo({ modoContinuo: 'true' }).indexOf('modoContinuo tem de ser true ou false') !== -1);
  assert.deepStrictEqual(projetoLib.avisosDeTipo({ modoContinuo: true }), []);
});

test('D468: com a chave, revisoes, decisoes, commits, turnos e arquivos nao disparam; tamanho e bloqueios sim', () => {
  const cheio = {
    turnosComTrabalho: 99, arquivosTocados: new Array(40).fill('a'), decisoesDoDono: 9, commitsFeitos: 9,
    contadores: { revisao_fechada: 9 }
  };
  assert.strictEqual(saude.avaliar(cheio).disparou, true, 'controle: sem a chave dispara');
  assert.strictEqual(saude.avaliar(cheio, null, true).disparou, false, 'com a chave os cinco calam');
  const m = saude.medir(cheio, null, true);
  for (const chave of c.CALADOS) {
    const g = m.find((x) => x.chave === chave);
    assert.strictEqual(g.cruzou, false, chave);
    assert.strictEqual(g.calado, true, chave);
  }
  assert.deepStrictEqual(c.CALADOS.slice().sort(),
    ['arquivosTocados', 'commits', 'decisoesDoDono', 'revisoesFechadas', 'turnosComTrabalho']);
  assert.strictEqual(saude.avaliar({ contadores: { cd_solto: 6 } }, null, true).disparou, true, 'bloqueios seguem');
  assert.strictEqual(saude.avaliar({ tokensDeContexto: 260000 }, null, true).disparou, true, 'tamanho segue');
  assert.strictEqual(saude.avaliar({ avisouSaude: true, tokensDeContexto: 460000 }, null, true).alarme, true, 'alarme segue');
  // so o booleano true cala
  assert.strictEqual(saude.avaliar(cheio, null, 'true').disparou, true);
});

test('D493: com a chave, o aviso de tamanho sai a 250000; o limiar do projeto manda; sem a chave, 175000', () => {
  const g = (e, L, k) => saude.medir(e, L, k).find((x) => x.chave === 'tokensDeContexto');
  assert.strictEqual(c.TOKENS_CONTEXTO, 250000);
  assert.strictEqual(g({ tokensDeContexto: 249999 }, null, true).cruzou, false);
  assert.strictEqual(g({ tokensDeContexto: 250000 }, null, true).cruzou, true);
  assert.strictEqual(g({}, null, true).limiar, 250000, 'o medidor mostra o limiar que vale');
  assert.strictEqual(saude.avaliar({ tokensDeContexto: 200000 }, null, true).disparou, false);
  assert.ok(/260000 tokens de contexto, o tamanho desta conversa \(limiar 250000\)/
    .test(saude.avaliar({ tokensDeContexto: 260000 }, null, true).aviso));
  // o numero gravado pelo projeto manda, com ou sem a chave
  assert.strictEqual(g({ tokensDeContexto: 180000 }, { tokensDeContexto: 180000 }, true).cruzou, true);
  assert.strictEqual(g({}, { tokensDeContexto: 180000 }, true).limiar, 180000);
  // sem a chave (ou com "true" em texto), o padrao da D475
  assert.strictEqual(g({ tokensDeContexto: 200000 }, null).cruzou, true);
  assert.strictEqual(g({}, null, 'true').limiar, saude.LIMIARES_PADRAO.tokensDeContexto);
  assert.strictEqual(saude.LIMIARES_PADRAO.tokensDeContexto, 175000, 'o padrao sem a chave nao muda');
  // o alarme nao muda com a chave
  assert.strictEqual(saude.avaliar({ avisouSaude: true, tokensDeContexto: 450000 }, null, true).alarme, true);
});

test('D493 (P1 da revisao): o bloco diz o aviso e o alarme que o medidor usa, com o limiar do projeto', () => {
  const casos = [
    [{}, '250 mil', '450 mil'],
    [{ tokensDeContexto: 120000 }, '120 mil', '450 mil'],
    [{ tokensDeContexto: 123456, tokensAlarme: 300000 }, '123456', '300 mil'],
    [{ tokensDeContexto: '120000' }, '250 mil', '450 mil'] // texto nao e numero: o medidor ignora, o bloco tambem
  ];
  for (const [limiares, aviso, alarme] of casos) {
    const b = c.bloco({ modoContinuo: true, limiares: limiares });
    assert.ok(b.indexOf('(aviso a ' + aviso + ', alarme a ' + alarme + ')') !== -1, JSON.stringify(limiares) + '\n' + b);
    assert.ok(/^[\x20-\x7E\n]+$/.test(b) && b.length <= c.TETO, 'ASCII e teto com ' + JSON.stringify(limiares));
  }
  // ronda 2 (borda) e D495: o alarme e o que o avaliar compara; valor que nao e numero positivo cai no padrao
  for (const tokensAlarme of ['300000', null, 0, -1, NaN]) {
    const b = c.bloco({ modoContinuo: true, limiares: { tokensAlarme: tokensAlarme } });
    assert.ok(b.indexOf('alarme a 450 mil)') !== -1, String(tokensAlarme) + '\n' + b);
    const av = (n) => saude.avaliar({ avisouSaude: true, tokensDeContexto: n }, { tokensAlarme: tokensAlarme }, true).alarme;
    assert.strictEqual(av(449999), false, String(tokensAlarme) + ': alarme antes do padrao');
    assert.strictEqual(av(450000), true, String(tokensAlarme) + ': sem alarme no padrao');
  }
  const torto = c.bloco({ modoContinuo: true, limiares: { tokensAlarme: 'três mil' } });
  assert.ok(/^[\x20-\x7E\n]+$/.test(torto), 'valor torto nao tira o bloco do ASCII');
  // o mesmo numero do medidor (sem literal a parte)
  const L = { tokensDeContexto: 120000 };
  assert.strictEqual(saude.medir({}, L, true).find((x) => x.chave === 'tokensDeContexto').limiar, 120000);
  assert.ok(c.bloco({ modoContinuo: true }).indexOf((c.TOKENS_CONTEXTO / 1000) + ' mil') !== -1);
});

test('D495: limiar que nao e numero positivo cai no padrao (aviso, alarme e os outros gatilhos)', () => {
  const lim = (L, chave, continuo) => saude.medir({}, L, continuo).find((x) => x.chave === chave).limiar;
  for (const v of [0, -5, null, '120000', NaN, Infinity]) {
    // o aviso: com a chave, o do modo continuo; sem, o padrao da D475
    assert.strictEqual(lim({ tokensDeContexto: v }, 'tokensDeContexto', true), c.TOKENS_CONTEXTO, String(v));
    assert.strictEqual(lim({ tokensDeContexto: v }, 'tokensDeContexto'), saude.LIMIARES_PADRAO.tokensDeContexto, String(v));
    assert.ok(c.bloco({ modoContinuo: true, limiares: { tokensDeContexto: v } }).indexOf('(aviso a 250 mil, alarme a 450 mil)') !== -1, String(v));
    // os outros: `>= null` cruzaria com zero
    assert.strictEqual(lim({ bloqueios: v }, 'bloqueios'), saude.LIMIARES_PADRAO.bloqueios, String(v));
    assert.strictEqual(saude.avaliar({ contadores: {} }, { bloqueios: v }).disparou, false, String(v));
  }
  assert.deepStrictEqual(saude.limiaresValidos({ commits: 5, bloqueios: 0, tokensAlarme: null, x: 1 }), { commits: 5 });
  assert.deepStrictEqual(saude.limiaresValidos(null), {});
});

test('continuo: o medidor da sessao mostra o gatilho calado pela chave, sem dizer que cruzou', () => {
  const medidor = require('../scripts/lib/medidor.js');
  const m = saude.medir({ turnosComTrabalho: 99 }, null, true);
  const r = medidor.linhaDaSessao({ uso: null, amostras: [], medidas: m, avisouSaude: false });
  // Plano 082 (mock S4): os desligados numa linha so, depois dos que valem; nunca com "disparou".
  const linha = r.longa.split('\n').filter((l) => /^- desligados pelo modo contínuo: /.test(l))[0];
  assert.ok(linha && /respostas 99\/15/.test(linha) && !/disparou/.test(linha), r.longa);
  assert.ok(r.longa.indexOf('respostas com trabalho real') === -1, r.longa);
});

test('continuo: a linha curta do medidor conta so os gatilhos que podem disparar (M2, D490)', () => {
  const medidor = require('../scripts/lib/medidor.js');
  const m = saude.medir({ turnosComTrabalho: 99 }, null, true);
  const podem = m.filter((g) => g.calado !== true).length;
  assert.strictEqual(m.length - podem, c.CALADOS.length, 'controle: os cinco calados estao na lista');
  const r = medidor.linhaDaSessao({ uso: null, amostras: [], medidas: m, avisouSaude: false });
  // Pedido 71 (D544): a barra diz quanto falta pelo sinal mais perto; os 99 turnos calados nao contam (bloqueios 0
  // de 6 e contexto 0 empatam; vale o 1o, como no bloco "Troca de chat").
  assert.strictEqual(r.curta, 'troca de chat em 6 ações negadas pelo sworn');
  const cruzou = medidor.linhaDaSessao({ uso: null, amostras: [], medidas: saude.medir({ tokensDeContexto: 260000 }, null, true), avisouSaude: false });
  assert.strictEqual(cruzou.curta, 'troque de chat → /sworn:handoff');
  // sem a chave, nada se cala: os 99 turnos disparam
  const sem = medidor.linhaDaSessao({ uso: null, amostras: [], medidas: saude.medir({ turnosComTrabalho: 99 }, null), avisouSaude: false });
  assert.strictEqual(sem.curta, 'troque de chat → /sworn:handoff');
  const zero = medidor.linhaDaSessao({ uso: null, amostras: [], medidas: saude.medir({}, null), avisouSaude: false });
  assert.strictEqual(zero.curta, 'troca de chat em 15 respostas com trabalho real');
});

test('continuo: a sworn:playbook e o README falam da chave e da validacao pelo proprio agente', () => {
  const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const skill = ler('skills/playbook/SKILL.md');
  assert.ok(skill.indexOf('`modoContinuo`') !== -1, 'a skill nao cita a chave');
  assert.ok(/validate by the agent itself/.test(skill), 'a skill nao manda validar antes de pedir');
  const readme = ler('GUIA.md');
  assert.ok(readme.indexOf('`modoContinuo`') !== -1, 'o README nao cita a chave');
});

// D785 item 6 (s369, 2.6): o "menos paradas" deixa a pergunta ao dono so para regra de negocio, aparencia (com opcoes),
// o irreversivel ou externo e credencial; custo dentro do pedido sai da lista, e o resto o agente faz sozinho.
test('D785/2.6: o modo continuo pergunta so regra de negocio, aparencia, irreversivel/externo e credencial', () => {
  const t = c.bloco({});
  assert.ok(/regra de negocio/.test(t) && /aparencia \(com opcoes\)/.test(t) && /credencial/.test(t), t);
  assert.ok(/custo dentro do pedido nao se pergunta/.test(t), t);
  // a SP7 segue: credencial, permissao ou seguranca vao ao dono (a D785 so tira o custo de dentro do pedido)
  assert.ok(!/o de custo e o de produto/.test(t) && /credencial, permissao ou seguranca/.test(t), t);
  assert.ok(/sem perguntar/.test(t), t);
  assert.ok(/^[\x20-\x7E\n]+$/.test(t), 'ASCII: ' + t);
});

// B3 (s369, R-dsh): a pergunta ao dono por classe (as 4 da D785) e o estado tipado do fecho.
test('B3: a pergunta ao dono cai numa das 4 classes da D785, ou fica de fora', () => {
  const casos = [
    ['publicar a 0.23.0 e empurrar o backup', 'externo'],
    ['enviar o e-mail ao cliente', 'externo'],
    ['a chave da API do xKiro (credencial)', 'credencial'],
    ['permissao de escrita na pasta do servidor', 'credencial'],
    ['qual das 3 cores do botao (aparencia)', 'aparencia'],
    ['regra de negocio: o desconto vale para o plano anual?', 'regra_de_negocio'],
    ['qual nome de variavel eu uso?', null],
    ['abrir o chat novo e colar o prompt', null],
    ['', null]
  ];
  for (const [texto, classe] of casos) assert.strictEqual(c.classeDaPergunta(texto), classe, texto);
});

test('B3: o estado do fecho - bloqueado, esperando, falhou, pronto (pela prova da trava 3) ou nenhum', () => {
  const e = (o) => c.estadoDoFecho(Object.assign({ pedeDono: false, espera: false, alegaSucesso: false,
    comEvidencia: false, mostraFalha: false, teste: null }, o));
  assert.strictEqual(e({ pedeDono: true, alegaSucesso: true, comEvidencia: true }), 'bloqueado', 'o dono vem primeiro');
  assert.strictEqual(e({ espera: true }), 'esperando');
  assert.strictEqual(e({ pedeDono: true, espera: true }), 'bloqueado', 'o pedido ao dono vence a espera');
  assert.strictEqual(e({ alegaSucesso: true, comEvidencia: true, teste: { provaRodando: true } }), 'esperando',
    'a prova em segundo plano espera');
  assert.strictEqual(e({ mostraFalha: true }), 'falhou');
  assert.strictEqual(e({ alegaSucesso: true, comEvidencia: true, teste: { ultimoTeste: { falhou: true } } }), 'falhou');
  assert.strictEqual(e({ alegaSucesso: true, comEvidencia: true }), 'pronto');
  assert.strictEqual(e({ alegaSucesso: true, comEvidencia: true, teste: { ultimoTeste: { falhou: false } } }), 'pronto');
  assert.strictEqual(e({ alegaSucesso: true, comEvidencia: false }), null, 'pronto sem evidencia nao e pronto');
  assert.strictEqual(e({ alegaSucesso: true, comEvidencia: true, teste: { provaPendente: true } }), null,
    'a prova que nao rodou depois da edicao nao e pronto');
  assert.strictEqual(e({}), null, 'conversa nao tem estado');
  assert.strictEqual(c.estadoDoFecho(), null, 'sem argumento: sem estado, sem erro');
  assert.strictEqual(c.estadoDoFecho(null), null);
  assert.strictEqual(c.classeDaPergunta(null), null, 'pergunta nula: fora');
});

// B4 (s369, R-superpowers): a decisao autonoma registrada em uma linha "Decisao: <o que> - por que: ... - custo se
// errado: ...", que o fecho conta; a linha sem o custo e a falha medida.
test('B4: o bloco manda registrar a decisao com o que, por que e custo se errado', () => {
  const t = c.bloco(null);
  assert.ok(/Decisao: <o que> - por que: <motivo> - custo se errado: <o que quebra>/.test(t), t);
});

test('B4: as decisoes da resposta, cada uma dizendo se traz o custo se errado', () => {
  assert.deepStrictEqual(c.decisoesDaResposta('Feito.\nDecisao: usar matchAll - por que: diz a intencao - custo se ' +
    'errado: nenhum, e leitura\nDecisão: lote de 100 - por que: linha de comando do Windows'), [true, false]);
  assert.deepStrictEqual(c.decisoesDaResposta('```\nDecisao: colada num bloco\n```\n> Decisao: citada'), [],
    'a colada ou citada nao conta');
  assert.deepStrictEqual(c.decisoesDaResposta('**Decisão**: lote - por que: x - custo se errado: y'), [true],
    'o negrito do markdown conta');
  assert.deepStrictEqual(c.decisoesDaResposta('Decisao: x - por que: y - custo se errado: <o que quebra>'), [false],
    'o molde sem preencher nao e o custo');
  assert.deepStrictEqual(c.decisoesDaResposta(''), []);
  assert.deepStrictEqual(c.decisoesDaResposta(null), []);
});
