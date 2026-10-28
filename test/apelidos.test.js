'use strict';
const test = require('node:test');
const assert = require('node:assert');
const apelidos = require('../scripts/lib/apelidos.js');
const agentesLib = require('../scripts/lib/agentes.js');

const MAPA_DOIS = { agentes: {
  escada: ['busca', 'arquiteto'],
  degraus: [{ agente: 'busca', apelido: 'barato' }, { agente: 'arquiteto', apelido: 'caro' }]
} };

function lidos(lista) { return { existe: true, agentes: lista }; }
function ag(nome, model) {
  return { arquivo: nome + '.md', nome: nome, model: model, temFrontmatter: true };
}

// -------------------------------------------------- nao verificavel (foco 1)

test('apelidos: sem a pasta .claude/agents a conferencia se declara NAO verificavel', () => {
  const r = apelidos.conferir(MAPA_DOIS, { existe: false, agentes: [] });
  assert.strictEqual(r.verificavel, false);
  assert.ok(r.motivo.includes('.claude/agents'), r.motivo);
  assert.deepStrictEqual(r.divergencias, []);
});

test('apelidos: pasta VAZIA e verificavel - e diferente de nao conseguir olhar', () => {
  const r = apelidos.conferir(MAPA_DOIS, lidos([]));
  assert.strictEqual(r.verificavel, true, 'pasta vazia nao pode virar "nao verificavel"');
  assert.strictEqual(r.motivo, null);
  assert.deepStrictEqual(r.semArquivo.map((x) => x.agente), ['busca', 'arquiteto']);
});

test('apelidos: sem apelidos gravados a conferencia se declara NAO verificavel', () => {
  const r = apelidos.conferir({ agentes: { escada: ['busca'] } }, lidos([ag('busca', 'barato')]));
  assert.strictEqual(r.verificavel, false);
  assert.ok(r.motivo.includes('apelidos'), r.motivo);
});

test('apelidos: projeto.json ausente por completo nao estoura', () => {
  const r = apelidos.conferir(null, lidos([ag('busca', 'barato')]));
  assert.strictEqual(r.verificavel, false);
});

// ------------------------------------------------------------ a divergencia

test('apelidos: mapa e arquivos casados nao acusam nada', () => {
  const r = apelidos.conferir(MAPA_DOIS, lidos([ag('busca', 'barato'), ag('arquiteto', 'caro')]));
  assert.strictEqual(r.verificavel, true);
  assert.deepStrictEqual(r.divergencias, []);
  assert.deepStrictEqual(r.naoDeclarados, []);
  assert.deepStrictEqual(r.semArquivo, []);
  assert.deepStrictEqual(r.foraDoMapa, []);
});

test('apelidos: model: diferente do apelido gravado e a divergencia, e diz os DOIS lados', () => {
  const r = apelidos.conferir(MAPA_DOIS, lidos([ag('busca', 'caro'), ag('arquiteto', 'caro')]));
  assert.strictEqual(r.divergencias.length, 1, JSON.stringify(r.divergencias));
  assert.strictEqual(r.divergencias[0].agente, 'busca');
  assert.strictEqual(r.divergencias[0].declarado, 'caro');
  assert.strictEqual(r.divergencias[0].gravado, 'barato');
});

// Foco de revisao 4: ausente e vazio sao a MESMA resposta, e nenhuma e divergir.
test('apelidos: agente sem model: NAO e divergencia - e nao declarado', () => {
  const r = apelidos.conferir(MAPA_DOIS, lidos([ag('busca', null), ag('arquiteto', 'caro')]));
  assert.deepStrictEqual(r.divergencias, [], 'nao declarado virou achado falso');
  assert.strictEqual(r.naoDeclarados.length, 1);
  assert.strictEqual(r.naoDeclarados[0].agente, 'busca');
});

test('apelidos: model: vazio cai no mesmo balde do ausente', () => {
  const r = apelidos.conferir(MAPA_DOIS, lidos([ag('busca', ''), ag('arquiteto', 'caro')]));
  assert.deepStrictEqual(r.divergencias, []);
  assert.strictEqual(r.naoDeclarados.length, 1);
});

test('apelidos: agente no disco que a escada nao menciona fica fora do mapa, nao divergente', () => {
  const r = apelidos.conferir(MAPA_DOIS, lidos([
    ag('busca', 'barato'), ag('arquiteto', 'caro'), ag('intruso', 'seja-la-o-que-for')
  ]));
  assert.deepStrictEqual(r.divergencias, []);
  assert.deepStrictEqual(r.foraDoMapa.map((x) => x.agente), ['intruso']);
});

test('apelidos: degrau gravado sem arquivo no disco e balde proprio', () => {
  const r = apelidos.conferir(MAPA_DOIS, lidos([ag('busca', 'barato')]));
  assert.deepStrictEqual(r.divergencias, []);
  assert.deepStrictEqual(r.semArquivo.map((x) => x.agente), ['arquiteto']);
});

// ----------------------------------------------------------- a mensagem

test('apelidos: o motivo cita os dois lados e as duas direcoes de conserto', () => {
  const r = apelidos.conferir(MAPA_DOIS, lidos([ag('busca', 'caro'), ag('arquiteto', 'caro')]));
  const m = apelidos.motivo(r);
  assert.ok(m.includes('busca'), m);
  assert.ok(m.includes('caro') && m.includes('barato'), m);
  // Plano 082, Tarefa 5: as duas direcoes em "Faca uma destas" numerado (era a) e b)).
  assert.ok(/\n {2}1\. o arquivo passa a dizer/.test(m) && /\n {2}2\. o mapa passa a dizer/.test(m),
    'tem de oferecer as DUAS direcoes: ' + m);
  assert.ok(!/arquiteto/.test(m), 'agente que nao divergiu nao entra na mensagem');
});

// Plano 083 (p6-4): correcao() nao tinha chamador (o motivo mostra os dois lados por agente e as duas direcoes); saiu.
test('083 T6 (p6-4): a correcao() morta saiu da lib; o motivo segue com os dois valores de cada agente', () => {
  assert.strictEqual(apelidos.correcao, undefined);
  const r = apelidos.conferir(MAPA_DOIS, lidos([ag('busca', 'caro')]));
  const m = apelidos.motivo(r);
  assert.ok(m.includes('      o arquivo diz: caro') && m.includes('      o mapa diz:    barato'), m);
});

test('apelidos: o motivo diz que nada foi bloqueado', () => {
  const r = apelidos.conferir(MAPA_DOIS, lidos([ag('busca', 'caro'), ag('arquiteto', 'caro')]));
  assert.ok(/nada foi bloqueado/i.test(apelidos.motivo(r)));
});

// ------------------------------------------------- a correcao (decisao 15)

test('apelidos: trocar o model: preserva o resto do arquivo BYTE A BYTE', () => {
  const antes = '---\nname: busca\nmodel: caro\ndescription: procura\n---\n\n# busca\n\ncorpo com  espacos  e\ttab\n';
  const r = apelidos.trocarModel(antes, 'barato');
  assert.strictEqual(r.ok, true, r.motivo);
  assert.strictEqual(r.texto, antes.replace('model: caro', 'model: barato'));
});

test('apelidos: CRLF continua CRLF depois da troca', () => {
  const antes = '---\r\nname: busca\r\nmodel: caro\r\n---\r\ncorpo\r\n';
  const r = apelidos.trocarModel(antes, 'barato');
  assert.strictEqual(r.ok, true, r.motivo);
  assert.strictEqual(r.texto, '---\r\nname: busca\r\nmodel: barato\r\n---\r\ncorpo\r\n');
  assert.strictEqual((r.texto.match(/\r\n/g) || []).length, 5, 'perdeu ou ganhou CR: ' + JSON.stringify(r.texto));
});

test('apelidos: o BOM sobrevive a troca', () => {
  const r = apelidos.trocarModel('\uFEFF---\nmodel: caro\n---\n', 'barato');
  assert.strictEqual(r.ok, true, r.motivo);
  assert.strictEqual(r.texto.charCodeAt(0), 0xFEFF, 'o BOM sumiu');
  assert.ok(r.texto.includes('model: barato'));
});

test('apelidos: agente SEM model: ganha a linha dentro do frontmatter', () => {
  const r = apelidos.trocarModel('---\nname: busca\n---\n\ncorpo\n', 'barato');
  assert.strictEqual(r.ok, true, r.motivo);
  assert.strictEqual(r.texto, '---\nname: busca\nmodel: barato\n---\n\ncorpo\n');
  // e o proprio leitor da T34 tem de conseguir ler o que acabou de ser escrito
  const f = agentesLib.frontmatter(r.texto);
  assert.strictEqual(f.ok, true);
  assert.strictEqual(f.campos.model, 'barato');
});

test('apelidos: a linha acrescentada usa o terminador do arquivo, nao um fixo', () => {
  const r = apelidos.trocarModel('---\r\nname: busca\r\n---\r\ncorpo\r\n', 'barato');
  assert.strictEqual(r.ok, true, r.motivo);
  assert.ok(r.texto.includes('model: barato\r\n'), 'misturou LF em arquivo CRLF: ' + JSON.stringify(r.texto));
  assert.ok(!/[^\r]\n/.test(r.texto), 'sobrou um LF solto: ' + JSON.stringify(r.texto));
});

test('apelidos: arquivo sem frontmatter e RECUSADO, nunca remendado', () => {
  const r = apelidos.trocarModel('# so um titulo\n', 'barato');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.texto, null);
  assert.ok(r.motivo.includes('frontmatter'), r.motivo);
});

test('apelidos: cerca que abre e nunca fecha e RECUSADA', () => {
  const r = apelidos.trocarModel('---\nname: busca\nmodel: caro\n', 'barato');
  assert.strictEqual(r.ok, false);
  assert.ok(r.motivo.includes('nunca fecha'), r.motivo);
});

test('apelidos: dois model: no frontmatter param a troca em vez de adivinhar', () => {
  const r = apelidos.trocarModel('---\nmodel: caro\nname: busca\nmodel: outro\n---\n', 'barato');
  assert.strictEqual(r.ok, false);
  assert.ok(r.motivo.includes('2 linhas'), r.motivo);
});

test('apelidos: model: DEPOIS da cerca de fecho nao e do frontmatter e nao e tocado', () => {
  const antes = '---\nname: busca\nmodel: caro\n---\n\nmodel: isto e prosa do corpo\n';
  const r = apelidos.trocarModel(antes, 'barato');
  assert.strictEqual(r.ok, true, r.motivo);
  assert.ok(r.texto.includes('model: isto e prosa do corpo'), 'mexeu no corpo: ' + r.texto);
  assert.strictEqual((r.texto.match(/model: barato/g) || []).length, 1);
});

// A prova forte: depois de corrigir, a conferencia para de acusar.
test('apelidos: corrigido o arquivo, a conferencia deixa de acusar (ida e volta)', () => {
  const antes = '---\nname: busca\nmodel: caro\n---\n';
  const depois = apelidos.trocarModel(antes, 'barato').texto;
  const lido = agentesLib.frontmatter(depois);
  const r = apelidos.conferir(MAPA_DOIS, lidos([
    { arquivo: 'busca.md', nome: lido.campos.name, model: lido.campos.model, temFrontmatter: true },
    ag('arquiteto', 'caro')
  ]));
  assert.deepStrictEqual(r.divergencias, [], 'a correcao nao corrigiu');
});

// ------------------------------------------ D678 T1: o effort: contra a tabela

const MAPA_ESFORCO = { agentes: {
  escada: ['busca', 'arquiteto'],
  degraus: [{ agente: 'busca', apelido: 'barato', esforco: 'low' }, { agente: 'arquiteto', apelido: 'caro', esforco: 'high' }]
} };
function agE(nome, model, effort) { return Object.assign(ag(nome, model), { effort: effort }); }

test('D678 T1: effort: diferente do esforco gravado e divergencia de esforco, com os dois lados', () => {
  const r = apelidos.conferir(MAPA_ESFORCO, lidos([agE('busca', 'barato', 'high'), agE('arquiteto', 'caro', 'high')]));
  assert.deepStrictEqual(r.divergencias, [], 'o modelo bate: nao e divergencia de modelo');
  assert.strictEqual(r.esforcoDivergente.length, 1, JSON.stringify(r.esforcoDivergente));
  assert.deepStrictEqual(r.esforcoDivergente[0],
    { agente: 'busca', arquivo: 'busca.md', declarado: 'high', gravado: 'low' });
});

test('D678 T1: agente sem effort: com esforco gravado e balde proprio, nao divergencia', () => {
  const r = apelidos.conferir(MAPA_ESFORCO, lidos([agE('busca', 'barato', null), agE('arquiteto', 'caro', 'high')]));
  assert.deepStrictEqual(r.esforcoDivergente, []);
  assert.deepStrictEqual(r.esforcoNaoDeclarado, [{ agente: 'busca', arquivo: 'busca.md', gravado: 'low' }]);
});

test('D678 T1: tabela sem esforco nao compara o effort: (configuracao anterior nao acusa nada)', () => {
  const r = apelidos.conferir(MAPA_DOIS, lidos([agE('busca', 'barato', 'max'), agE('arquiteto', 'caro', null)]));
  assert.deepStrictEqual(r.esforcoDivergente, []);
  assert.deepStrictEqual(r.esforcoNaoDeclarado, []);
});

test('D678 T1: o motivo cita a divergencia de esforco com os dois lados', () => {
  const r = apelidos.conferir(MAPA_ESFORCO, lidos([agE('busca', 'barato', 'high'), agE('arquiteto', 'caro', 'high')]));
  const m = apelidos.motivo(r);
  assert.ok(m.includes('"busca"'), m);
  assert.ok(m.includes('      o arquivo diz: effort: high') && m.includes('      o mapa diz:    esforco low'), m);
  assert.ok(!/arquiteto/.test(m), 'agente que nao divergiu nao entra na mensagem');
});

test('D678 T1: trocarCampo troca o effort: e preserva o resto; trocarModel segue igual', () => {
  const antes = '---\r\nname: busca\r\nmodel: caro\r\neffort: high\r\n---\r\ncorpo\r\n';
  const r = apelidos.trocarCampo(antes, 'effort', 'low');
  assert.strictEqual(r.ok, true, r.motivo);
  assert.strictEqual(r.texto, antes.replace('effort: high', 'effort: low'));
  const sem = apelidos.trocarCampo('---\nname: busca\n---\n', 'effort', 'low');
  assert.strictEqual(sem.texto, '---\nname: busca\neffort: low\n---\n');
  assert.strictEqual(apelidos.trocarModel(antes, 'barato').texto, antes.replace('model: caro', 'model: barato'));
});

// R1 da revisao (5 lentes): o nome do campo entra num RegExp; nome fora do formato de chave e recusado, nao estoura.
test('D678 T1: trocarCampo recusa nome de campo fora do formato de chave, sem lancar', () => {
  for (const campo of ['ef(fort', 'a.b', '', 'model:x']) {
    const r = apelidos.trocarCampo('---\nmodel: caro\naXb: 1\n---\n', campo, 'x');
    assert.strictEqual(r.ok, false, campo + ' passou');
    assert.strictEqual(r.texto, null);
  }
});

test('D678 T1: dois effort: no frontmatter param a troca em vez de adivinhar', () => {
  const r = apelidos.trocarCampo('---\neffort: low\nname: busca\neffort: high\n---\n', 'effort', 'medium');
  assert.strictEqual(r.ok, false);
  assert.ok(r.motivo.includes('effort:'), r.motivo);
});

// "Em agente": o proprio plugin nao publica id de versao no model: dos agentes dele, e o effort: e um dos aceitos.
test('D678 T1: os agentes do plugin declaram apelido (nunca id de versao) e esforco valido', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const degrausLib = require('../scripts/lib/degraus.js');
  const pasta = path.join(__dirname, '..', 'agents');
  const lista = apelidos.agentesDoPlugin(pasta);
  assert.ok(lista.length > 0, 'nao achou agents/ do plugin');
  for (const a of lista) {
    assert.ok(!degrausLib.ehNomeDeModelo(a.apelido), a.arquivo + ' declara id de versao: ' + a.apelido);
    const effort = agentesLib.frontmatter(fs.readFileSync(path.join(pasta, a.arquivo), 'utf8')).campos.effort;
    if (effort) assert.ok(agentesLib.ESFORCOS.includes(effort), a.arquivo + ' declara effort: ' + effort);
  }
});
