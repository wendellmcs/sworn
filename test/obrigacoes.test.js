'use strict';
/**
 * O INVENTARIO DE OBRIGACOES, derivado do manual.
 *
 * Duas metades, e a segunda so vale por causa da primeira:
 *   o INSTRUMENTO - provado com manuais de mentira, montados aqui, onde da para
 *     saber a resposta certa de antemao;
 *   a ASSERCAO SOBRE ESTE MANUAL - a contagem minima por familia, que reprova
 *     alto se o manual do plugin for reescrito e uma familia inteira sumir.
 *
 * Sem a segunda, o inventario poderia encolher para zero e todo mundo passaria.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ob = require('../scripts/lib/obrigacoes.js');

const RAIZ = path.join(__dirname, '..');
const MANUAL = path.join(RAIZ, 'skills', 'playbook');

function manualDeMentira(skill, refs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn obrig '));
  fs.writeFileSync(path.join(dir, 'SKILL.md'), skill, 'utf8');
  if (refs) {
    fs.mkdirSync(path.join(dir, 'references'));
    for (const nome of Object.keys(refs)) {
      fs.writeFileSync(path.join(dir, 'references', nome), refs[nome], 'utf8');
    }
  }
  return dir;
}
function limpar(dir) { fs.rmSync(dir, { recursive: true, force: true }); }
const ids = (inv) => inv.obrigacoes.map((o) => o.id);

// ── linhas logicas ───────────────────────────────────────────────────────

test('obrigacoes: prosa quebrada em duas linhas vira UM paragrafo so', () => {
  const b = ob.linhasLogicas('Gatilhos contaveis - basta\n**um**:\n\n- a;\n- b;\n');
  assert.strictEqual(b[0].tipo, 'paragrafo');
  assert.strictEqual(b[0].texto, 'Gatilhos contaveis - basta **um**:');
  assert.strictEqual(b[0].linha, 1, 'a linha gravada e a PRIMEIRA fisica, que e onde se procura');
  assert.deepStrictEqual(b.slice(1).map((x) => x.tipo), ['item', 'item']);
});

test('obrigacoes: o que esta dentro de cerca de codigo nao vira obrigacao', () => {
  const b = ob.linhasLogicas('texto\n\n```\n- **Nunca faca isto** dentro do exemplo\n```\n\ndepois\n');
  assert.deepStrictEqual(b.map((x) => x.tipo), ['paragrafo', 'paragrafo']);
});

// ── as tres formas ───────────────────────────────────────────────────────

test('obrigacoes: forma 1 - cabecalho ordinal vira obrigacao, com familia e numero', () => {
  const d = manualDeMentira('# m\n\n## Marcha 3 - AAA\n\n## Lente 5 - Microcopy\n');
  const inv = ob.inventario(d);
  assert.deepStrictEqual(ids(inv), ['marcha-3', 'lente-5']);
  assert.strictEqual(inv.obrigacoes[0].forma, 'ordinal');
  assert.strictEqual(inv.obrigacoes[1].titulo, 'Microcopy');
  limpar(d);
});

test('obrigacoes: o ordinal de dois digitos nao e truncado', () => {
  // Manual com mais de nove lentes existe; ler so o primeiro digito faria a
  // decima virar lente-1 e sobrescrever a primeira, em silencio.
  const d = manualDeMentira('# m' + String.fromCharCode(10).repeat(2) + '## Lente 12 - Decima segunda' + String.fromCharCode(10));
  assert.deepStrictEqual(ids(ob.inventario(d)), ['lente-12']);
  limpar(d);
});

test('obrigacoes: forma 2 - item de lista dentro de bloco anunciado', () => {
  const d = manualDeMentira('# m\n\n## Regras\n\nSao todas obrigatorias:\n\n- **Primeira** coisa\n- **Segunda** coisa\n');
  const inv = ob.inventario(d);
  assert.strictEqual(inv.obrigacoes.length, 2);
  assert.strictEqual(inv.obrigacoes[0].forma, 'bloco');
  assert.strictEqual(inv.obrigacoes[0].familia, 'regras');
  limpar(d);
});

test('obrigacoes: forma 2 nao dispara sem anunciador - lista comum nao obriga', () => {
  const d = manualDeMentira('# m\n\n## Exemplos\n\nAlguns casos:\n\n- um\n- dois\n');
  assert.deepStrictEqual(ob.inventario(d).obrigacoes, []);
  limpar(d);
});

test('obrigacoes: forma 3 - frase solta em negrito vira obrigacao', () => {
  const d = manualDeMentira('# m\n\n**Se surgiu a duvida "ja e hora?", ja era.**\n');
  const inv = ob.inventario(d);
  assert.strictEqual(inv.obrigacoes.length, 1);
  assert.strictEqual(inv.obrigacoes[0].familia, 'afirmacao');
  limpar(d);
});

test('obrigacoes: a frase solta nao atravessa dois trechos em negrito', () => {
  // Medido no ensaio: sem a trava, o titulo saia com ** no meio, colando duas
  // frases distantes numa obrigacao que o manual nunca escreveu.
  const d = manualDeMentira('# m\n\n**A cegueira e parcial.** Contagem de linhas entrega qual lado e o **novo**.\n');
  for (const o of ob.inventario(d).obrigacoes) {
    assert.strictEqual(o.titulo.indexOf('**'), -1, 'titulo colado: ' + o.titulo);
  }
  limpar(d);
});

test('obrigacoes: frase em negrito terminada em dois pontos e ANUNCIADOR, nao obrigacao', () => {
  // O primeiro negrito termina em ":" e nao tem marcador: nao anuncia, e
  // tambem nao obriga. Sem ele no teste, virar afirmacao passava calado.
  const d = manualDeMentira('# m\n\n**Um exemplo do que se ve:**\n\n**Portoes, todos obrigatorios:**\n\n1. **Plano** antes de editar\n2. **Contagem** antes do brief\n');
  const inv = ob.inventario(d);
  assert.strictEqual(inv.obrigacoes.length, 2, 'nenhum negrito terminado em dois pontos pode virar obrigacao');
  assert.strictEqual(inv.obrigacoes[0].forma, 'bloco');
  limpar(d);
});

// ── as tres armadilhas medidas no ensaio ─────────────────────────────────

test('obrigacoes: armadilha (a) - os dois pontos ANTES do fecho do negrito', () => {
  // "**Portoes - todos obrigatorios:**". Procurar ":" no fim da linha crua
  // perdia as nove obrigacoes de maior peso do manual, em silencio.
  const d = manualDeMentira('# m\n\n## Marcha 3 - AAA\n\n**Portoes - todos obrigatorios:**\n\n1. **Plano escrito** antes\n2. **Contagem** antes do brief\n3. **Loop de inspecao**\n');
  const inv = ob.inventario(d);
  assert.strictEqual(inv.porFamilia['marcha-3-aaa'], 3, 'o anunciador com :** tem de abrir o bloco');
  limpar(d);
});

test('obrigacoes: armadilha (b) - anunciador que quebra em duas linhas fisicas', () => {
  const d = manualDeMentira('# m\n\n## Saude\n\nGatilhos contaveis - basta\n**um**:\n\n- fechou uma etapa;\n- vai abrir etapa nova;\n');
  assert.strictEqual(ob.inventario(d).obrigacoes.length, 2);
  limpar(d);
});

test('obrigacoes: armadilha (c) - cabecalho ordinal nunca anuncia bloco', () => {
  // "## Lente 2 - Estados obrigatorios" casa com /obrigat/. Sem a trava, cada
  // estado virava obrigacao solta e duplicava a lente, que ja e uma.
  const d = manualDeMentira('# m\n\n## Lente 2 - Estados obrigatorios\n\n- **Erro** tratado\n- **Vazio** tratado\n');
  const inv = ob.inventario(d);
  assert.deepStrictEqual(ids(inv), ['lente-2'], 'os sub-itens da lente sao o criterio DELA');
  limpar(d);
});

// ── o vocabulario, com controle positivo e negativo ──────────────────────

test('obrigacoes: cada marcador pega um caso real e um marcador falso nao pega', () => {
  const positivos = ['Portoes obrigatorios:', 'Guarda-corpos inviolaveis',
    'O que um pronto precisa ter', 'E proibido isto:', 'Jamais faca assim:',
    'Nunca suba a catraca:', 'Sempre cole a saida:', 'Tem de valer sempre:',
    'Gatilhos contaveis:', 'Como pedir decisao ao dono'];
  assert.strictEqual(positivos.length, ob.MARCADORES.length,
    'todo marcador tem de ter um caso que o prova - senao entrou sem ganhar o lugar');
  positivos.forEach((p, i) => {
    assert.ok(ob.MARCADORES[i].test(p), 'marcador ' + i + ' nao pegou o proprio caso: ' + p);
  });
  for (const neutro of ['Exemplos de uso', 'Referencias', 'O que esta skill e']) {
    for (const re of ob.MARCADORES) {
      assert.ok(!re.test(neutro), 'marcador ' + re + ' pegou prosa neutra: ' + neutro);
    }
  }
});

test('obrigacoes: anunciador longo demais nao e anunciador, e prosa', () => {
  // O comprimento e literal DE PROPOSITO: medido contra ob.LIMITE_ANUNCIO, o
  // teste subia junto com a constante e nunca reprovava mexer nela. E e 170, e
  // nao 400: com 400, o limite subia ate 399 com a suite verde, e o
  // cruzamento de dois manuais reais mudava.
  const longo = 'x'.repeat(170) + ' sempre:';
  assert.ok(ob.LIMITE_ANUNCIO < 170, 'o limite passou de 170 e este teste virou decoracao');
  const d = manualDeMentira('# m\n\n## S\n\n' + longo + '\n\n- um\n');
  assert.deepStrictEqual(ob.inventario(d).obrigacoes, []);
  limpar(d);
});

// ── a chave de casamento ─────────────────────────────────────────────────

test('obrigacoes: a chave sai do NOME em negrito, nao da explicacao em volta', () => {
  assert.strictEqual(ob.chaveDe('**Evidencia colada** porque memoria nao e evidencia'),
    ob.chaveDe('**Evidencia colada** - e a saida do comando, nao um resumo'));
});

test('obrigacoes: a chave ignora acento, fatia de molde e enfeite', () => {
  assert.strictEqual(ob.normalizar('A **prova** de conclus\u00e3o, [j\u00e1](x.md) - `{{campo:provaDePronto}}`'),
    'a prova de conclusao ja');
});

test('obrigacoes: a mesma obrigacao dita duas vezes conta uma vez so', () => {
  const d = manualDeMentira('# m\n\n## A\n\nSempre:\n\n- **Colar a saida**\n\n## B\n\nSempre:\n\n- **Colar a saida**\n');
  assert.strictEqual(ob.inventario(d).obrigacoes.length, 1,
    'duas linhas para a mesma pergunta fariam a segunda copiar a primeira');
  limpar(d);
});

// ── bordas ───────────────────────────────────────────────────────────────

test('obrigacoes: diretorio que nao existe devolve inventario vazio, nao estoura', () => {
  for (const ruim of [null, undefined, '', path.join(os.tmpdir(), 'sworn nao existe 404')]) {
    const inv = ob.inventario(ruim);
    assert.strictEqual(inv.ok, false, JSON.stringify(ruim));
    assert.deepStrictEqual(inv.obrigacoes, []);
  }
});

test('obrigacoes: manual sem references le so o SKILL.md', () => {
  const d = manualDeMentira('# m\n\n## Marcha 1 - Rapida\n');
  const inv = ob.inventario(d);
  assert.deepStrictEqual(inv.arquivos, ['SKILL.md']);
  assert.strictEqual(inv.obrigacoes.length, 1);
  limpar(d);
});

// ── o cruzamento ─────────────────────────────────────────────────────────

test('obrigacoes: o cruzamento separa comum, so-no-plugin e so-no-outro', () => {
  const a = manualDeMentira('# a\n\n## R\n\nSempre:\n\n- **Comum** aqui\n- **So no plugin**\n');
  const b = manualDeMentira('# b\n\n## R\n\nSempre:\n\n- **Comum** ali, com outra explicacao\n- **So no outro**\n');
  const c = ob.cruzar(ob.inventario(a), ob.inventario(b));
  // Conferir QUEM esta em cada balde, nao so quantos: com os lados trocados os
  // tres tamanhos continuam 1, 1 e 1, e a troca passava despercebida.
  assert.deepStrictEqual(c.comuns.map((o) => o.chave), ['comum']);
  assert.deepStrictEqual(c.soNoPlugin.map((o) => o.chave), ['so no plugin']);
  assert.deepStrictEqual(c.soNoOutro.map((o) => o.chave), ['so no outro']);
  assert.ok(/aqui/.test(c.comuns[0].titulo), 'a comum cita o manual do plugin: ' + c.comuns[0].titulo);
  assert.strictEqual(c.cruzou, true);
  assert.strictEqual(c.total, 3);
  limpar(a); limpar(b);
});

test('obrigacoes: sem segundo manual o cruzamento nao inventa, e declara que nao cruzou', () => {
  const a = manualDeMentira('# a\n\n## R\n\nSempre:\n\n- **Uma** coisa\n');
  const c = ob.cruzar(ob.inventario(a), ob.inventario(null));
  assert.strictEqual(c.cruzou, false);
  assert.strictEqual(c.soNoPlugin.length, 1);
  assert.deepStrictEqual(c.soNoOutro, []);
  assert.strictEqual(c.total, 1, 'sem cruzamento o total e o do plugin');
  assert.deepStrictEqual(ob.linhasDoExperimento(c).map((l) => l.aConferir), [false],
    'sem cruzamento ninguem tem o que conferir - marcar tudo daria trabalho falso ao juiz');
  limpar(a);
});

test('obrigacoes: a linha que so existe no outro manual sai marcada nao migrada', () => {
  const a = manualDeMentira('# a\n\n## R\n\nSempre:\n\n- **Uma**\n- **So no plugin**\n');
  const b = manualDeMentira('# b\n\n## R\n\nSempre:\n\n- **Uma**\n- **Outra** que ficou para tras\n');
  const linhas = ob.linhasDoExperimento(ob.cruzar(ob.inventario(a), ob.inventario(b)));
  const perdida = linhas.filter((l) => l.naoMigrada);
  assert.strictEqual(perdida.length, 1);
  assert.ok(/Outra/.test(perdida[0].titulo));
  // As duas marcas de TODA linha, nao so da perdida: sem isto, a comum fora do
  // experimento ou a do plugin marcada nao migrada passavam com a suite verde.
  assert.deepStrictEqual(linhas.map((l) => [l.chave, l.naoMigrada, l.aConferir]),
    [['uma', false, false], ['so no plugin', false, true], ['outra', true, true]]);
  limpar(a); limpar(b);
});

// D244/defeito 8 (D242 secao 3.8): os ids sao numerados POR MANUAL, e a linha que so existe no
// outro manual herdava o id de uma linha do plugin. No roteiro real, 12 ids repetidos: 84 linhas,
// 72 classificaveis, e o [NADA] imprimia o titulo da linha errada.
test('D244/defeito 8: todo id do experimento e unico, e o [NADA] fala da linha certa', () => {
  const a = manualDeMentira('# a\n\n## R\n\nSempre:\n\n- **Uma**\n- **So no plugin**\n');
  const b = manualDeMentira('# b\n\n## R\n\nSempre:\n\n- **Uma**\n- **Outra** que ficou para tras\n');
  const linhas = ob.linhasDoExperimento(ob.cruzar(ob.inventario(a), ob.inventario(b)));
  const ids = linhas.map((l) => l.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'id repetido: ' + JSON.stringify(ids));
  const doPlugin = linhas.find((l) => l.chave === 'so no plugin');
  const doOutro = linhas.find((l) => l.chave === 'outra');
  const c = ob.conferirResultado(linhas, {
    tarefa: { referencia: 'abc1234' }, executor: 'x', juiz: 'y', semManualAntigo: true,
    linhas: linhas.map((l) => ({ id: l.id, mecanismo: l === doOutro ? 'NADA' : 'HOOK', evidencia: 'e' }))
  });
  assert.strictEqual(c.classificadas, 3, 'cada linha tem de poder ser julgada: ' + JSON.stringify(c));
  assert.deepStrictEqual(c.nada.map((n) => n.id), [doOutro.id]);
  assert.ok(/Outra/.test(c.nada[0].titulo), 'o [NADA] tem de imprimir o titulo do outro manual');
  assert.notStrictEqual(doPlugin.id, doOutro.id);
  limpar(a); limpar(b);
});

/* ------------------------------------------------------------------------- *
 * A ASSERCAO SOBRE ESTE MANUAL. E a que envelhece junto com o repositorio.
 * As contagens abaixo sao PISOS, nao igualdades: o manual pode ganhar
 * obrigacao sem reprovar ninguem, mas nao pode PERDER uma familia inteira em
 * silencio - que e como uma reescrita apaga um portao sem ninguem ver.
 * ------------------------------------------------------------------------- */

test('obrigacoes: o manual do plugin rende o inventario que o experimento julga', () => {
  const inv = ob.inventario(MANUAL);
  assert.ok(inv.ok, 'sem skills/playbook nao ha inventario - e a T32 quem o cria');
  assert.strictEqual(inv.arquivos.length, 7, 'o manual absorvido tem 7 arquivos');

  const pisos = { marcha: 3, lente: 8, 'marcha-3-aaa': 9, '5-guarda-corpos-inviolaveis': 8,
    '6-saude-de-contexto': 8, '7-como-pedir-decisao': 5, '8-o-que-um': 5 };
  for (const familia of Object.keys(pisos)) {
    const n = inv.porFamilia[familia] || 0;
    assert.ok(n >= pisos[familia],
      'a familia "' + familia + '" tem ' + n + ' obrigacoes e o piso e ' + pisos[familia] +
      '. Ou o manual foi reescrito e o inventario deixou de ve-la, ou uma obrigacao ' +
      'sumiu. Nos dois casos o experimento passaria a julgar menos do que o manual obriga.');
  }
  assert.ok(inv.obrigacoes.length >= 55,
    'inventario com ' + inv.obrigacoes.length + ' obrigacoes: caiu demais para ser reescrita de estilo');
});

test('obrigacoes: toda obrigacao do manual cita arquivo e linha - regra anti-teatro', () => {
  for (const o of ob.inventario(MANUAL).obrigacoes) {
    assert.ok(o.arquivo && Number.isInteger(o.linha) && o.linha > 0, JSON.stringify(o));
    assert.ok(o.titulo.trim() !== '', 'obrigacao sem titulo: ' + o.id);
    assert.ok(o.id.indexOf('|') === -1, 'id com separador reservado: ' + o.id);
  }
});

test('obrigacoes: nenhum id se repete - id repetido faria duas linhas virarem uma', () => {
  const vistos = ob.inventario(MANUAL).obrigacoes.map((o) => o.id);
  assert.strictEqual(new Set(vistos).size, vistos.length);
});
