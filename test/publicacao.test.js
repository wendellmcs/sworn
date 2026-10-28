'use strict';
/**
 * PRE-VOO. A publicacao e o unico ato irreversivel deste plano: depois do push,
 * o que foi para o ar foi, e reescrever historico e forca bruta em cima do que
 * outros ja clonaram.
 *
 * Por isso o que da para conferir por maquina NAO fica em checklist. Enquanto
 * faltar qualquer peca, a suite fica vermelha - e nao ha como chegar ao commit
 * com algo em aberto sem ver.
 *
 * DUAS LICOES MEDIDAS, das quais este arquivo nasceu (`docs/etapa6-skill-universal.md`):
 *   1. o LICENSE gerado pela INTERFACE do GitHub preenche o copyright com o nome
 *      do perfil - foi preciso apagar e recriar um repositorio por causa disso.
 *      Entao o LICENSE nasce AQUI, no repositorio, e vai junto no export.
 *   2. a identidade do git se configura ANTES do primeiro commit. Isso nao da
 *      para testar em Node; e passo de checklist, e a conferencia dele acontece
 *      DEPOIS do commit e ANTES do push - que e a janela em que ainda da para
 *      desfazer.
 *
 * O QUE ESTE ARQUIVO NAO TESTA, e esta dito para nao parecer que testa: se o
 * export esta limpo nas tres superficies. Isso se mede no export montado, com o
 * `sanitar.js`, e e passo do plano. Um teste aqui mediria o repositorio de
 * trabalho, que e outra coisa.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const sanit = require('../scripts/lib/sanitacao.js');
const saude = require('../scripts/lib/saude.js');
const veredito = require('../scripts/lib/veredito.js');
const design = require('../scripts/lib/design.js');
const projetoLib = require('../scripts/lib/projeto.js');
const { baldesNoCodigo, SO_CONTAM } = require('./auxiliar-baldes.js');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const json = (rel) => JSON.parse(ler(rel));

const PLUGIN = json('.claude-plugin/plugin.json');
const MERCADO = json('.claude-plugin/marketplace.json');
const CHANGELOG = ler('CHANGELOG.md');
const README = ler('GUIA.md');

// Os textos de skill traduzidos para o ingles trazem os numeros por extenso em ingles.
const NUMEROS_EN = {
  'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
  'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
  'sixteen': 16, 'seventeen': 17, 'eighteen': 18
};

const NUMEROS = {
  // Plano 083, Tarefa 7 (sobra 3): o CHANGELOG antigo ganhou acento ("teto de três rondas").
  'tres': 3, 'três': 3, 'quatro': 4,
  'cinco': 5, 'seis': 6, 'sete': 7, 'oito': 8, 'nove': 9, 'dez': 10,
  'onze': 11, 'doze': 12, 'treze': 13, 'quatorze': 14, 'quinze': 15,
  'dezesseis': 16, 'dezessete': 17, 'dezoito': 18
};

// ── a licenca ────────────────────────────────────────────────────────────

test('publicacao: o LICENSE existe no repositorio, nao na interface do GitHub', () => {
  assert.ok(fs.existsSync(path.join(RAIZ, 'LICENSE')),
    'sem LICENSE no repositorio, quem cria pela interface do GitHub ganha o ' +
    'copyright preenchido com o nome do perfil - e ja custou apagar e recriar um repo');
});

test('publicacao: o LICENSE e MIT, com ano, e o plugin.json concorda', () => {
  const texto = ler('LICENSE');
  assert.ok(/MIT License/i.test(texto), 'o LICENSE nao se declara MIT');
  assert.ok(/Permission is hereby granted, free of charge/.test(texto),
    'falta o corpo da MIT: um arquivo que so diz "MIT" nao licencia nada');
  assert.ok(/Copyright \(c\) (\d{4})/.test(texto), 'LICENSE sem ano de copyright');
  assert.strictEqual(PLUGIN.license, 'MIT', 'o manifesto declara outra licenca');
});

test('publicacao: o detentor do LICENSE e o mesmo autor do manifesto', () => {
  const m = ler('LICENSE').match(/Copyright \(c\) \d{4}\s+(.+)/);
  assert.ok(m, 'nao deu para ler o detentor do direito no LICENSE');
  assert.strictEqual(m[1].trim(), PLUGIN.author.name,
    'LICENSE e manifesto discordam sobre quem publica isto');
});

test('publicacao: manifesto e marketplace concordam sobre quem publica', () => {
  assert.strictEqual(MERCADO.owner.name, PLUGIN.author.name);
});

test('publicacao: o LICENSE entra na superficie que vai a publico', () => {
  const s = sanit.superficiePublicavel(RAIZ);
  assert.ok(s !== null, 'git nao respondeu');
  assert.ok(s.indexOf('LICENSE') !== -1,
    'o LICENSE ficou de fora do que seria publicado: repositorio publico sem licenca ' +
    'nao autoriza ninguem a usar nada');
});

// ── a superficie que vai a publico ───────────────────────────────────────

test('publicacao: o diario de trabalho e o vocabulario privado NAO vao junto', () => {
  const s = sanit.superficiePublicavel(RAIZ);
  assert.strictEqual(s.filter((a) => a.indexOf('docs/') === 0).length, 0, 'docs/ na superficie (D132)');
  assert.strictEqual(s.indexOf(sanit.ARQUIVO_LOCAL), -1,
    'o vocabulario privado iria ao repositorio publico levando exatamente o que existe para impedir');
  assert.strictEqual(s.filter((a) => a.indexOf('.context/') === 0 ||
    a.indexOf('.superpowers/') === 0).length, 0, 'contexto local na superficie');
});

// ── os numeros que o CHANGELOG afirma ────────────────────────────────────

// Revisao da 0.13.0, R1: o README dizia "treze chaves" de liga/desliga com quinze no codigo (a T3b do radar somou o
// oferecerRadar, e a anterior ja tinha passado sem acertar o numero).
test('publicacao: o numero de chaves de liga/desliga do README vem do codigo', () => {
  const m = README.match(/A lista das (\S+) chaves, com o padr[aã]o de cada uma/);
  assert.ok(m, 'o README nao diz quantas chaves de liga/desliga ha');
  assert.strictEqual(NUMEROS[m[1].toLowerCase()], projetoLib.CHAVES_LIGA_DESLIGA.length,
    'o README conta ' + m[1] + ' chaves, e o codigo tem ' + projetoLib.CHAVES_LIGA_DESLIGA.length);
});

// Revisao da 0.13.0, R2: a entrada dizia "ate 10" projetos por tema e, linhas abaixo, "11 projetos lidos" na medicao;
// e "junto com a novidade da semana" sem dizer que e a do vigia.
test('publicacao: a entrada do radar no CHANGELOG nao se contradiz na conta nem cita recurso sem nome', () => {
  const topo = CHANGELOG.split(/^## /m)[1];
  const teto = topo.match(/at[eé] (\d+), por tema/);
  const lidos = topo.match(/(\d+) projetos\s+lidos/);
  assert.ok(!teto || !lidos || Number(lidos[1]) <= Number(teto[1]),
    'o CHANGELOG diz ate ' + (teto && teto[1]) + ' por tema e ' + (lidos && lidos[1]) + ' lidos');
  assert.ok(!/novidade da semana(?! do vigia)/.test(topo), 'novidade da semana sem dizer que e a do vigia');
});

// Revisao da 0.13.0, R3: o README dizia que a ficha fora do formato "diz quantos problemas tem" e parava ai; a
// abertura manda ao /sworn:radar (lib/vigia-local.js, contaDaFicha), e o README tem de dizer o mesmo passo.
test('publicacao: o README diz o proximo passo da ficha do radar fora do formato', () => {
  const m = README.match(/A ficha fora do formato[^.]*\./);
  assert.ok(m, 'o README nao fala da ficha do radar fora do formato');
  assert.ok(/\/sworn:radar/.test(m[0]), 'sem o proximo passo: ' + m[0]);
  assert.ok(/o \/sworn:radar confere/.test(ler('scripts/lib/vigia-local.js')), 'a frase da abertura mudou');
});

test('publicacao: a versao do manifesto e a do topo do CHANGELOG', () => {
  const m = CHANGELOG.match(/^## (\d+\.\d+\.\d+)/m);
  assert.ok(m, 'o CHANGELOG nao abre com uma versao');
  assert.strictEqual(PLUGIN.version, m[1],
    'manifesto e CHANGELOG discordam da versao que esta saindo');
});

test('publicacao: a versao do package.json e a do manifesto', () => {
  assert.strictEqual(json('package.json').version, PLUGIN.version,
    'package.json e manifesto discordam da versao (a 0.2.0 saiu com o package.json em 0.1.0)');
});

/**
 * Spec, secao 3: "guarde o metodo, nunca o resultado". Numero de teste congelado
 * em prosa apodrece calado - o CHANGELOG ja carregou "419 testes" quando eram
 * outros, e a D134 registrou a mesma classe de erro no README e no manifesto.
 * O CHANGELOG passa a dizer ONDE o numero se obtem.
 */
test('publicacao: o CHANGELOG nao congela contagem de teste - aponta o comando', () => {
  const congelado = CHANGELOG.match(/\*?\*?(\d+)\*?\*? testes/);
  assert.strictEqual(congelado, null,
    'contagem de teste congelada no CHANGELOG: ' + (congelado && congelado[0]) +
    '. O numero muda a cada tarefa e ninguem volta aqui para corrigi-lo');
  assert.ok(/npm test/.test(CHANGELOG),
    'se o numero sai, o comando que o produz tem de entrar no lugar');
});

test('publicacao: o numero de travas e o MESMO no README, no CHANGELOG e no manifesto', () => {
  const doReadme = NUMEROS[README.match(/^## As (\S+) travas/m)[1].toLowerCase()];
  const doChangelog = NUMEROS[(CHANGELOG.match(/(\S+) travas/) || [])[1].toLowerCase()];
  const doManifesto = NUMEROS[(PLUGIN.description.match(/^(\S+) port[oõ]es/i) || [])[1].toLowerCase()];
  assert.strictEqual(doChangelog, doReadme, 'CHANGELOG e README discordam do numero de travas');
  assert.strictEqual(doManifesto, doReadme,
    'a descricao do manifesto conta outro numero - foi a D134, defeito 6');
  // 0.11.1 (P2 da revisao da 0.11.0): o manifesto dizia "Oito" e listava sete. A lista vai ate o 1o ponto.
  const itens = PLUGIN.description.split(':')[1].split('.')[0].split(',');
  assert.strictEqual(itens.length, doReadme, 'o manifesto lista ' + itens.length + ' itens: ' + itens.join(' |'));
});

test('publicacao: o numero de baldes que negam vem do codigo, nao da memoria', () => {
  const m = CHANGELOG.match(/(\d+) que negam/);
  assert.ok(m, 'o CHANGELOG nao diz quantos baldes negam');
  assert.strictEqual(Number(m[1]), saude.BALDES_DE_BLOQUEIO.length,
    'lista escrita a mao contra lista do codigo: foi assim que a D134 achou o defeito 4');
});

// Ronda 1 do Passo 8b: a frase dos baldes tem tres numeros, e o teste acima
// conferia um so. O total e os que so contam passavam errados com a suite verde.
test('publicacao: o total de baldes e os que so contam tambem vem do codigo', () => {
  // Plano 082, Tarefa 7 (p3-1): a frase ganhou acento ("só contam").
  const m = CHANGELOG.match(/\*\*(\d+) baldes\*\* de contador: (\d+) que negam, (\d+) que s[oó] contam/);
  assert.ok(m, 'o CHANGELOG nao diz quantos baldes ha, nem quantos so contam');
  const noCodigo = baldesNoCodigo();
  assert.strictEqual(Number(m[1]), noCodigo.size, 'o total de baldes foi escrito a mao');
  const soContam = Array.from(noCodigo).filter((b) => SO_CONTAM.has(b)).length;
  assert.strictEqual(Number(m[3]), soContam, 'os que so contam foram escritos a mao');
  assert.strictEqual(Number(m[1]), Number(m[2]) + Number(m[3]), 'a frase nao fecha a propria conta');
});

// Ronda 1 do Passo 8b: as lentes que o revisar despacha sao duas familias, e a
// soma quando a mudanca e de codigo e de tela. Tres numeros por extenso, nenhum
// ligado ao veredito.js - uma lente nova apodreceria o CHANGELOG calada.
// Ronda 1 do 8c.5: a linha do /sworn:review no README passa a dizer os mesmos tres.
test('publicacao: as lentes do CHANGELOG e do README sao as do veredito.js - as duas familias e a soma', () => {
  for (const [nome, texto] of [['CHANGELOG', CHANGELOG], ['README', README]]) {
    const m = texto.match(/\*\*(\S+)\*\* de c[oó]digo, \*\*(\S+)\*\* de\s+tela, e \*\*(\S+)\*\* quando/);
    assert.ok(m, 'o ' + nome + ' nao diz quantas lentes o revisar despacha');
    const [codigo, tela, soma] = m.slice(1).map((p) => NUMEROS[p.toLowerCase()]);
    assert.strictEqual(codigo, veredito.LENTES.length, 'lentes de codigo: o ' + nome + ' conta outra coisa');
    assert.strictEqual(tela, veredito.LENTES_UI.length, 'lentes de tela: o ' + nome + ' conta outra coisa');
    assert.strictEqual(soma, veredito.LENTES.length + veredito.LENTES_UI.length,
      nome + ': codigo e tela juntos despacham as duas familias inteiras');
  }
});

// Ronda 1 do 8c.5: a skill padrao dizia "oito lentes" como se fossem todas, e a tabela da
// rubrica mandava revisar logica sem UI com duas das oito de tela - o revisar despacha as
// nove de codigo. Toda "<numero> lentes" da skill diz a familia, com o numero do codigo.
test('publicacao: a skill padrao conta as duas familias de lentes, com os numeros do veredito.js', () => {
  const dir = path.join(RAIZ, 'skills', 'playbook');
  const arquivos = ['SKILL.md'].concat(fs.readdirSync(path.join(dir, 'references'))
    .filter((f) => f.endsWith('.md')).map((f) => 'references/' + f));
  const FAMILIA = { tela: veredito.LENTES_UI.length, codigo: veredito.LENTES.length };
  const numero = (p) => (/^\d+$/.test(p) ? Number(p) : NUMEROS_EN[p.toLowerCase()]);
  const soltas = [];
  const erradas = [];
  const naSkill = { tela: 0, codigo: 0 };
  for (const rel of arquivos) {
    const texto = fs.readFileSync(path.join(dir, rel), 'utf8');
    // "4.2 Lentes distintas" e numero de secao, nao contagem: o numero nao vem colado a ponto.
    for (const m of texto.matchAll(/(?<![\p{L}\d.])([\p{L}\d]+)\s+lenses/giu)) {
      if (numero(m[1]) !== undefined) soltas.push(rel + ': "' + m[0] + '"');
    }
    for (const m of texto.matchAll(/([\p{L}\d]+)\s+(?:for\s+(screens?|code)|(screen|code)\s+lenses)/giu)) {
      const n = numero(m[1]);
      if (n === undefined) continue;
      const fam = (m[2] || m[3]).toLowerCase().startsWith('screen') ? 'tela' : 'codigo';
      if (rel === 'SKILL.md') naSkill[fam] += 1;
      if (n !== FAMILIA[fam]) erradas.push(rel + ': "' + m[0] + '" (o codigo tem ' + FAMILIA[fam] + ')');
    }
  }
  assert.deepStrictEqual(soltas, [], 'numero de lentes sem dizer a familia');
  assert.deepStrictEqual(erradas, [], 'numero de lentes que nao e o do veredito.js');
  assert.ok(naSkill.tela > 0 && naSkill.codigo > 0, 'o SKILL.md tem de contar as duas familias: ' +
    JSON.stringify(naSkill));
  const rubrica = fs.readFileSync(path.join(dir, 'references', '02-rubrica-aaa.md'), 'utf8').split('\n');
  for (const mudanca of ['Logic without UI', 'Contract between systems']) {
    const linha = rubrica.find((l) => l.startsWith('| ' + mudanca + ' |'));
    assert.ok(linha && /code lenses/.test(linha), 'a rubrica manda "' + mudanca + '" para outra familia: ' + linha);
  }
  // Ronda 2 do 8c.10: a secao 4.2 dizia que as nove de codigo vao "em toda mudanca". A regra de
  // despacho e a tabela do Passo 2 do revisar; a secao aponta para ela, e ela bate com o codigo.
  const skill = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  const secao = skill.slice(skill.indexOf('### 4.2'), skill.indexOf('### 4.3'));
  assert.ok(secao.includes('skills/review/SKILL.md'), 'a secao 4.2 tem de apontar para a tabela do revisar');
  assert.ok(!/(?:in|on|for) every change/.test(secao), 'a secao 4.2 manda as de codigo em toda mudanca: ' + secao);
  const revisar = fs.readFileSync(path.join(RAIZ, 'skills', 'review', 'SKILL.md'), 'utf8').split('\n');
  const despacho = { 'Code only': FAMILIA.codigo, 'Screen only': FAMILIA.tela, 'Code and screen': FAMILIA.codigo + FAMILIA.tela };
  for (const [mudanca, n] of Object.entries(despacho)) {
    const linha = revisar.find((l) => l.startsWith('| ' + mudanca + ' |'));
    assert.ok(linha && linha.includes('**' + n + '**'), 'o revisar manda "' + mudanca + '" com outro numero: ' + linha);
  }
});

/**
 * O ritual de decisao tem DUAS metades - a decisao e o pronto - e a skill `playbook` carrega as duas
 * sozinha desde que a `economia` saiu: a regra do tamanho das opcoes vive na secao da decisao, e a
 * forma enxuta do pronto aponta para o bloco que a abertura injeta. Vinham do teste da `economia`;
 * medido por mutacao la, olhar a skill inteira deixava apagar metade da fiacao com a suite verde.
 * Cada uma e lida na SUA secao (entre `## `), nao por distancia em caracteres: o criterio estrutural
 * nao e recalibrado toda vez que a secao cresce.
 */
function secaoDaPadrao(ancora) {
  const manual = fs.readFileSync(path.join(RAIZ, 'skills', 'playbook', 'SKILL.md'), 'utf8');
  const i = manual.indexOf(ancora);
  assert.notStrictEqual(i, -1, 'sumiu a ancora do ritual: ' + ancora);
  const antes = manual.slice(0, i).lastIndexOf('\n## ');
  const depois = manual.indexOf('\n## ', i);
  return manual.slice(antes === -1 ? 0 : antes, depois === -1 ? manual.length : depois);
}

test('publicacao: a padrao traz, na secao da decisao, a regra do tamanho das opcoes por inteiro', () => {
  const s = secaoDaPadrao('A decision made goes to');
  assert.ok(/three options/i.test(s), 'sumiu a exigencia de tres opcoes');
  assert.ok(/recommended/i.test(s), 'sumiu a marcacao da recomendada');
  assert.ok(/one or two sentences/i.test(s), 'sumiu o tamanho: uma ou duas frases por opcao');
  assert.ok(/consequence/i.test(s), 'a opcao tem de levar a consequencia dentro');
  assert.ok(/cost/i.test(s), 'a opcao tem de levar o custo dentro');
  assert.ok(/more than two sentences[^.]*hides two choices[^.]*get separated/i.test(s),
    'sumiu o sinal de que opcao com mais de duas frases esconde duas escolhas, e elas se separam');
  assert.ok(!/economia/i.test(s), 'a secao da decisao ainda aponta para a skill que saiu');
});

test('publicacao: a padrao aponta, na secao do pronto, para o bloco de qualidade de resposta da abertura', () => {
  const s = secaoDaPadrao('Fresh evidence');
  assert.ok(/response-quality block/i.test(s), 'o pronto nao aponta para o bloco de qualidade de resposta');
  assert.ok(/opening/i.test(s), 'o ponteiro tem de dizer que o bloco vem da abertura da sessao');
  assert.ok(/rules 1 and 5/i.test(s), 'o ponteiro tem de dizer quais regras do bloco: 1 e 5');
  assert.ok(!/economia/i.test(s), 'a secao do pronto ainda aponta para a skill que saiu');
});

// T2/item 13 da D257 (decisao do dono, 2026-09-29): arquivo so de logica - nao e de estilo e nao
// monta tela - e revisado sem a `design`. D448 (2026-10-11): saem tambem `medidor` e `escopo` (11 de 13 e
// 5 de 6 achados refutados na ronda 1 de 41 revisoes). O numero nao e escrito a mao: e LENTES.length menos
// SAEM_SO_LOGICA, e cada lente que sai tem de existir em LENTES. Na duvida, todas (LENTES.length; D554: 10).
test('publicacao: a linha "So logica" do revisar diz LENTES menos SAEM_SO_LOGICA, e cada lente que sai existe', () => {
  const saem = veredito.SAEM_SO_LOGICA;
  assert.deepStrictEqual(saem, ['design', 'medidor', 'escopo'], 'D448: saem design, medidor e escopo');
  saem.forEach((k) => assert.ok(veredito.LENTES.some((l) => l.chave === k), 'lente que sai nao existe: ' + k));
  const n = veredito.LENTES.length - saem.length;
  const revisar = fs.readFileSync(path.join(RAIZ, 'skills', 'review', 'SKILL.md'), 'utf8').split('\n');
  const linha = revisar.find((l) => l.startsWith('| Logic only '));
  assert.ok(linha, 'a tabela do Passo 2 do revisar nao tem a linha "Só lógica"');
  assert.ok(linha.includes('**' + n + '**'), 'so logica tem de dizer LENTES menos SAEM_SO_LOGICA: ' + linha);
  saem.forEach((k) => assert.ok(linha.includes('`' + k + '`'), 'a linha tem de nomear a lente que sai (' + k + '): ' + linha));
  assert.match(linha, /SAEM_SO_LOGICA/, 'a linha tem de apontar a constante, nao a lista de memoria: ' + linha);
  assert.match(revisar.join('\n'), new RegExp('when in doubt, the ' + veredito.LENTES.length + '\\b', 'i'),
    'o revisar tem de dizer que na duvida vao as ' + veredito.LENTES.length);
  const m = README.match(/\*\*(\S+)\*\* quando [ée] s[oó] l[oó]gica/);
  assert.ok(m, 'a linha do /sworn:review no README nao diz o caso so logica');
  assert.strictEqual(NUMEROS[m[1].toLowerCase()], n, 'o README conta so logica errado');
});

// D485 (s106): a faixa vem antes da tabela de familias. A tabela das faixas do revisar diz as lentes de
// lentesDaFaixa e os cortes FAIXA_UMA_ATE / FAIXA_DUAS_ATE do veredito.js, nao de memoria; e a regra de que o
// agente pode subir de faixa, nunca descer, esta escrita.
test('D485: a tabela de faixas do revisar diz as lentes e os cortes do veredito.js', () => {
  const revisar = fs.readFileSync(path.join(RAIZ, 'skills', 'review', 'SKILL.md'), 'utf8');
  const linhas = revisar.split('\n');
  for (const faixa of ['uma', 'duas', 'texto']) {
    const linha = linhas.find((l) => l.startsWith('| `' + faixa + '` |'));
    assert.ok(linha, 'a tabela de faixas nao tem a linha `' + faixa + '`');
    const lentes = veredito.lentesDaFaixa(faixa);
    assert.ok(linha.includes('**' + lentes.length + '**'), 'a faixa ' + faixa + ' conta outro numero: ' + linha);
    lentes.forEach((k) => assert.ok(linha.includes('`' + k + '`'), 'a faixa ' + faixa + ' nao nomeia ' + k + ': ' + linha));
  }
  const completa = linhas.find((l) => l.startsWith('| `completa` |'));
  assert.ok(completa && /table of families/i.test(completa), 'a completa tem de mandar para a tabela de familias: ' + completa);
  assert.ok(revisar.includes('up to ' + veredito.FAIXA_UMA_ATE + ' changed lines'), 'o corte da faixa uma nao e o do codigo');
  assert.ok(revisar.includes('up to ' + veredito.FAIXA_DUAS_ATE + ' lines'), 'o corte da faixa duas nao e o do codigo');
  assert.match(revisar, /move up a band, never down/i, 'falta a regra de que a faixa so sobe');
  assert.ok(revisar.indexOf('| `uma` |') < revisar.indexOf('| Logic only '), 'a faixa vem antes da tabela de familias');
});

// D486 (s107): na faixa pequena, A e B sao recortes. O briefing do revisar ganha a linha do recorte quando a saida
// traz `trecho`, e o inspetor sabe que o vao marcado nao e defeito (diz "nao consigo ver", nao "esta ausente").
test('D486: o revisar e o inspetor dizem o que fazer com o recorte do trecho mudado', () => {
  const revisar = fs.readFileSync(path.join(RAIZ, 'skills', 'review', 'SKILL.md'), 'utf8');
  assert.match(revisar, /`trecho`/, 'o revisar nao fala do campo trecho da saida');
  assert.ok(revisar.includes('[fora do trecho: linhas a-b]'), 'o revisar nao diz a marca do vao');
  // o que o inspetor le e o briefing: a linha do recorte leva a marca e o "nao consigo ver"
  const brief = revisar.split('\n').find((l) => l.startsWith('> A and B are excerpts'));
  assert.ok(brief && brief.includes('[fora do trecho: linhas a-b]') && /I can't see it/.test(brief),
    'o briefing do recorte nao diz a marca nem o "nao consigo ver": ' + brief);
  assert.ok(!/Deliver the \*\*whole file\*\* to the inspector\./.test(revisar), 'o revisar ainda manda sempre o arquivo inteiro');
  const inspetor = fs.readFileSync(path.join(RAIZ, 'agents', 'inspector.md'), 'utf8');
  assert.ok(inspetor.includes('[fora do trecho'), 'o inspetor nao sabe da marca do vao');
  assert.match(inspetor, /I can't see it/i, 'o inspetor tem de dizer "nao consigo ver" sobre o que esta fora');
  // s108, ronda 1 da Tarefa 3: 5 de 6 P1 das faixas pequenas eram inferencia sobre o que ficou fora do recorte.
  // O que depende do vao sai no maximo P2, no briefing e no inspetor. Lote 3/4a da colheita 10-20: nao lido nao tem
  // severidade - sai `pendente`, que nao molha a ronda (mais forte que o P2, que ainda contava como achado).
  assert.ok(/`pendente`/.test(brief) && !/at most P2/.test(brief), 'o briefing do recorte tem de mandar a pendente o que depende do vao: ' + brief);
  assert.ok(/depends on what is outside[\s\S]{0,120}`pendente`/.test(inspetor) && !/at most P2/.test(inspetor), 'o inspetor tem de mandar a pendente o que depende do vao');
});

// L3 (s104): subir a completa tem flag (A3-04); a aprovacao com achado descartado manda ler vereditosDescartados
// (A3-05); a ronda 1 sem as lentes da faixa, ou sem a lente que achou P0/P1, para a apuracao (A3-03).
test('L3: o revisar cita --completa, manda ler vereditosDescartados e diz que o script confere as lentes', () => {
  const revisar = fs.readFileSync(path.join(RAIZ, 'skills', 'review', 'SKILL.md'), 'utf8');
  assert.ok(revisar.includes('--completa'), 'o revisar nao diz como subir a completa');
  assert.ok(revisar.includes('`vereditosDescartados`'), 'o revisar nao manda ler os descartados');
  assert.match(revisar, /lens that found P0 or P1 and didn't come back/i, 'o revisar nao diz que a lente tem de voltar');
});

// Ronda 2 do Passo 8b: "oito travas" batia o README com o CHANGELOG e o manifesto, e o
// titulo do README com a tabela dele - nunca com o codigo. Trava e portao que nega (os
// baldes de bloqueio do saude.js) ou um dos dois comandos. Balde novo que nega tem de
// dizer aqui de que trava e, ou se e modulo.
const TRAVA_DO_BALDE = {
  fecho_sem_evidencia: 3, subitem_pendente: 3,
  fora_do_escopo: 4, sem_escopo: 4, intocavel: 4, frente_invalida: 4, fora_declarado: 4,
  comando_destrutivo: 5, shell_idioma_errado: 5, outra_frente: 5, cd_solto: 5,
  agente_caro_em_marcha_rapida: 6, criou_sem_buscar: 7, catraca_afrouxada: 8,
  // D678 T2: o mesmo portao-agente da trava 6, quando a chamada foge da tabela dos degraus
  chamada_fora_da_tabela: 6,
  // D694 T3: a escada da trava 6, cobrada no fim do turno quando o agente pediu o degrau de cima e ninguem o despachou
  escalada_sem_despacho: 6,
  // o modulo de design nega, mas e opcional e nao e trava: so existe com design.json
  token_fora_do_sistema: null,
  // T11-1: o mesmo modulo de design, quando o estilo e escrito por comando de shell
  estilo_por_shell: null,
  // D412/D415: portao proprio do prompt do handoff, com chave propria como o de decisao: fora da conta das travas
  handoff_sem_prompt: null,
  // D503 (0.8.1): portao proprio da referencia de topo, com chave propria (portaoReferencia) como o do handoff
  fecho_sem_referencia: null,
  // D655: portao proprio da revisao aprovada no fecho da marcha AAA, com chave propria (portaoRevisao)
  fecho_sem_revisao: null,
  // Plano 091 (#6, D559): portao proprio do manual antes de arquivo AAA, com chave propria (portaoManual)
  sem_manual: null,
  // Plano 091 (#1, D558/D559): portao proprio da revisao antes do commit, com chave propria (portaoCommit)
  commit_sem_revisao: null
};
const TRAVA_DO_COMANDO = { init: 1, review: 2 };

test('publicacao: as travas do README sao as do codigo - os portoes que negam e os dois comandos', () => {
  const temTrava = (b) => Object.prototype.hasOwnProperty.call(TRAVA_DO_BALDE, b);
  assert.deepStrictEqual(saude.BALDES_DE_BLOQUEIO.filter((b) => !temTrava(b)), [],
    'balde que nega sem trava declarada: e trava nova ou modulo? declare no mapa');
  assert.deepStrictEqual(Object.keys(TRAVA_DO_BALDE).filter((b) => saude.BALDES_DE_BLOQUEIO.indexOf(b) === -1), [],
    'o mapa tem balde que o codigo nao tem mais');
  for (const c of Object.keys(TRAVA_DO_COMANDO)) {
    assert.ok(fs.existsSync(path.join(RAIZ, 'skills', c, 'SKILL.md')), 'a trava do comando ' + c + ' sumiu do disco');
  }
  const doCodigo = Object.values(TRAVA_DO_COMANDO)
    .concat(Object.values(TRAVA_DO_BALDE).filter((n) => n !== null));
  const numeros = Array.from(new Set(doCodigo)).sort((a, b) => a - b);
  const secao = README.split(/^## /m).filter((s) => /^As \S+ travas/.test(s))[0];
  const linhas = secao.split('\n').filter((l) => /^\| \d+ \|/.test(l)).map((l) => Number(l.match(/^\| (\d+) \|/)[1]));
  assert.deepStrictEqual(linhas, numeros, 'a tabela do README numera outras travas que o codigo');
  assert.strictEqual(NUMEROS[README.match(/^## As (\S+) travas/m)[1].toLowerCase()], numeros.length,
    'o titulo do README conta outras travas que o codigo');
});

const ORDINAIS = { 'quarta': 4, 'quinta': 5, 'sexta': 6, 'setima': 7, 'oitava': 8 };

// Ronda 2 do Passo 8b: "seis perguntas" esta no CHANGELOG e no README, e nada contava
// as perguntas que a skill do init de fato faz, nem o campo que cada uma grava.
test('publicacao: as perguntas do init sao as que o CHANGELOG e o README contam', () => {
  const p4 = ler('skills/init/SKILL.md').split(/^## /m).filter((s) => /^Step 4 /.test(s))[0];
  assert.ok(p4, 'sumiu o Passo 4 do init');
  const perguntas = p4.split(/\n(?=\d+\. \*\*)/).slice(1);
  const titulo = p4.match(/^Step 4 — the (\S+) questions/);
  assert.ok(titulo, 'o Passo 4 nao diz quantas perguntas faz');
  assert.strictEqual(perguntas.length, NUMEROS_EN[titulo[1]], 'o titulo do Passo 4 conta outras perguntas');
  // cada pergunta grava um campo que o projeto.json aceita, e nenhuma o mesmo que outra
  const campos = perguntas.map((t) => (t.match(/(?:writes|write to) `(\w+)/i) || [])[1]);
  assert.deepStrictEqual(campos.filter((c) => projetoLib.CHAVES.indexOf(c) === -1), [],
    'pergunta sem campo do projeto.json: ' + campos.join(', '));
  assert.strictEqual(new Set(campos).size, perguntas.length, 'duas perguntas gravam o mesmo campo');

  const ch = CHANGELOG.match(/faz \*\*(\S+)\*\* perguntas[\s\S]*?a (\S+) [eé] a escada de agentes/);
  assert.ok(ch, 'o CHANGELOG nao diz quantas perguntas o init faz');
  assert.strictEqual(NUMEROS[ch[1].toLowerCase()], perguntas.length, 'o CHANGELOG conta outras perguntas');
  assert.strictEqual(ORDINAIS[ch[2].toLowerCase()], campos.indexOf('agentes') + 1,
    'o CHANGELOG poe a escada de agentes em outra pergunta');
  const rd = README.match(/faz (\S+) perguntas/);
  assert.ok(rd, 'o README nao diz quantas perguntas o init faz');
  assert.strictEqual(NUMEROS[rd[1].toLowerCase()], perguntas.length, 'o README conta outras perguntas');
});

// Ronda 2 do Passo 8b: o teto de rondas esta por extenso no CHANGELOG e em algarismo
// no README, e nenhum dos dois estava ligado ao veredito.js, que e quem para.
test('publicacao: o teto de rondas do CHANGELOG e do README e o do veredito.js', () => {
  const ditos = [];
  for (const [nome, texto] of [['CHANGELOG', CHANGELOG], ['README', README]]) {
    const re = /teto de (\S+) rondas/gi;
    let m;
    while ((m = re.exec(texto)) !== null) ditos.push([nome, m[1]]);
  }
  assert.deepStrictEqual(Array.from(new Set(ditos.map((d) => d[0]))).sort(), ['CHANGELOG', 'README'],
    'o teto sumiu de um dos dois: ' + JSON.stringify(ditos));
  for (const [nome, p] of ditos) {
    const n = /^\d+$/.test(p) ? Number(p) : NUMEROS[p.toLowerCase()];
    assert.strictEqual(n, veredito.TETO,
      nome + ' diz teto de ' + p + ' rondas, e o veredito.js para em ' + veredito.TETO);
  }
});

// Ronda 2 do Passo 8b: o portao de design so le medida em algumas unidades, e o texto
// nao dizia - `border-radius:50%` passava calado para quem confiasse nele.
test('publicacao: o limite de unidades do portao de design esta escrito, com as do codigo', () => {
  const naoPromete = README.split(/^## /m).filter((s) => s.indexOf('NÃO promete') !== -1)[0] || '';
  const item = naoPromete.split('\n').filter((l) => /^- \*\*/.test(l) && /design/.test(l))[0];
  assert.ok(item, 'o README nao declara o limite do portao de design no que nao promete');
  const par = CHANGELOG.split(/\n\s*\n/).filter((p) => /^M[oó]dulo opcional/.test(p))[0];
  assert.ok(par, 'sumiu do CHANGELOG o paragrafo do modulo de design');
  for (const [nome, texto] of [['README', item], ['CHANGELOG', par]]) {
    for (const u of design.UNIDADES.concat(['%'])) {
      assert.ok(texto.indexOf('`' + u + '`') !== -1, nome + ' nao nomeia `' + u + '` no limite do design: ' + texto);
    }
  }
});

/**
 * Comando citado no CHANGELOG e ausente do disco: so passa se o proprio CHANGELOG diz que
 * ele saiu - uma linha com `/sworn:<nome>` e "saiu" ou "aposentad", em QUALQUER entrada,
 * nao so na do topo. Na versao seguinte a entrada do topo muda, a citacao antiga continua no
 * historico, e o teste quebraria sem ninguem ter mexido em nada.
 */
const RENOMEADOS = { aprender: 'learn', atalhos: 'shortcuts', auditar: 'audit', calibrar: 'calibrate', padrao: 'playbook',
  referencia: 'reference', revisar: 'review', paralelo: 'parallel' };
function comandosInexistentes(changelog, doDisco) {
  const citados = new Set();
  const aposentados = new Set();
  // D625: o plugin se chamava esquadro, e as entradas antigas do CHANGELOG guardam a historia com o nome antigo.
  // Os comandos mudaram de nome junto: o nome antigo, so com o prefixo antigo, vale se o novo existe.
  const re = /(sworn|esquadro):([a-z-]+)/g;
  let m;
  while ((m = re.exec(changelog)) !== null) citados.add(m[1] === 'esquadro' && RENOMEADOS[m[2]] ? RENOMEADOS[m[2]] : m[2]);
  for (const linha of changelog.split(/\r?\n/)) {
    if (!/saiu|aposentad/i.test(linha)) continue;
    for (const a of linha.matchAll(/\/(?:sworn|esquadro):([a-z-]+)/g)) aposentados.add(a[1]);
  }
  return Array.from(citados).filter((c) => !doDisco.has(c) && !aposentados.has(c)).sort();
}

test('publicacao: todo comando que o CHANGELOG anuncia existe como skill ou workflow, ou diz que saiu', () => {
  const doDisco = new Set(fs.readdirSync(path.join(RAIZ, 'skills'), { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name));
  // 0.6.2: workflow do plugin roda como /sworn:<meta.name> (mesmo criterio do readme.test.js)
  for (const f of fs.readdirSync(path.join(RAIZ, 'workflows')).filter((n) => n.endsWith('.js'))) {
    const nome = fs.readFileSync(path.join(RAIZ, 'workflows', f), 'utf8').match(/^  name: '([a-z-]+)',$/m);
    if (nome) doDisco.add(nome[1]);
  }
  assert.ok(/(?:sworn|esquadro):([a-z-]+)/.test(CHANGELOG), 'o CHANGELOG nao anuncia comando nenhum');
  assert.deepStrictEqual(comandosInexistentes(CHANGELOG, doDisco), [],
    'o CHANGELOG anuncia comando que nao existe e nao diz que saiu');
});

test('publicacao: comando aposentado - o instrumento distingue inventado, aposentado sem aviso e com aviso', () => {
  const disco = new Set(['init', 'padrao']);
  // inventado: cita, nao existe, nao diz que saiu - segue falhando
  assert.deepStrictEqual(comandosInexistentes('- **`/sworn:fantasma`** novo.', disco), ['fantasma']);
  // a economia ausente do disco, citada so no historico e sem a frase de saida: falha
  const antiga = '## 0.3.0\n- **`/sworn:economia`** poe o ritual no tamanho certo.\n';
  assert.deepStrictEqual(comandosInexistentes(antiga, disco), ['economia']);
  // com a frase de saida, em entrada que nao e a do topo: passa
  const nova = '## 0.5.0\n- nada.\n\n## 0.4.0\n- A `/sworn:economia` saiu: as regras viraram o bloco.\n\n' + antiga;
  assert.deepStrictEqual(comandosInexistentes(nova, disco), []);
  // "aposentad" tambem vale, e a frase de saida de um comando nao perdoa outro
  assert.deepStrictEqual(comandosInexistentes(
    '- `/sworn:economia` foi aposentada.\n- `/sworn:fantasma` existe.', disco), ['fantasma']);
  // comando que esta no disco nunca falha
  assert.deepStrictEqual(comandosInexistentes('- `/sworn:init` pergunta.', disco), []);
});

// ── o texto que vai a publico ────────────────────────────────────────────

/**
 * Ronda 1 do Passo 8b: mensagens, moldes e skills citavam codigos de dois
 * registros que NAO vao a publico - a autoavaliacao (B7, C9, F16...) e o log de
 * decisoes (D14, "decisao 12"). Quem le nao tem onde procurar o que o codigo quer
 * dizer. Mede-se o que chega a quem le: as strings dos scripts e os .md e .json.
 * Comentario fica de fora de proposito - e de quem mantem, e tem o repositorio.
 * O test/ tambem: nome de teste e assercao sao para quem roda a suite.
 * Codigo precedido de `%` e hexadecimal de URL codificada (`%C3%A7`), nao registro.
 */
const CODIGO_INTERNO =
  /(?<!%)\b(?:[A-F]\d{1,2}|D\d{1,3}|R\d{1,2}|R-T\d+-\d+)\b|\b[Dd]ecis(?:ao|ão) (?:do dono )?\d+/;

/**
 * Os literais de texto de um fonte JS, sem comentario nem regex literal. O regex
 * literal e pulado porque uma crase ou aspa dentro dele abriria uma string falsa
 * que engole o resto da linha - medido no `destrutivo.js`.
 */
function literais(fonte) {
  const achados = [];
  const re = new RegExp([
    '\\/\\*[\\s\\S]*?\\*\\/', '\\/\\/[^\\n]*',
    '(?<=(?:^|[(,=:[!&|?{};]|\\breturn)\\s*)' +
      '\\/(?:[^/\\\\\\n[]|\\\\.|\\[(?:[^\\]\\\\\\n]|\\\\.)*\\])+\\/[a-z]*',
    "'(?:[^'\\\\\\n]|\\\\.)*'", '"(?:[^"\\\\\\n]|\\\\.)*"', '`(?:[^`\\\\]|\\\\.)*`'
  ].join('|'), 'gm');
  let m;
  while ((m = re.exec(fonte)) !== null) if (m[0][0] !== '/') achados.push(m[0]);
  return achados;
}

test('publicacao: o texto que vai a publico nao cita codigo de registro que nao vai', () => {
  // o instrumento: acha na string; ignora no comentario e no regex literal
  // e o hexadecimal de URL codificada (%C3%A7 e um c cedilha, nao o codigo C3)
  const amostra = literais("x('(F16) idioma'); // D35\n/* C9 */ y(\"decisao 12\");\n" +
    "if (/[`']/.test(c)) z('D14'); // `B7`\nw('%C3%A7');");
  assert.deepStrictEqual(amostra.filter((p) => CODIGO_INTERNO.test(p)),
    ["'(F16) idioma'", '"decisao 12"', "'D14'"]);

  const s = sanit.superficiePublicavel(RAIZ);
  assert.ok(s !== null, 'git nao respondeu');
  const achados = [];
  let lidos = 0;
  for (const rel of s) {
    if (rel.indexOf('test/') === 0) continue;
    const ext = path.extname(rel);
    let pedacos;
    if (ext === '.js') pedacos = literais(ler(rel));
    else if (ext === '.md' || ext === '.json') pedacos = ler(rel).split('\n');
    else continue;
    lidos++;
    for (const p of pedacos) {
      const c = p.match(CODIGO_INTERNO);
      if (c) achados.push(rel + ': ' + c[0]);
    }
  }
  assert.ok(lidos > 50, 'a varredura leu so ' + lidos + ' arquivos');
  assert.deepStrictEqual(achados, [], 'codigo que quem le nao tem onde procurar');
});

test('publicacao: o pacote segue privado para o npm - publicar aqui e outro caminho', () => {
  assert.strictEqual(json('package.json').private, true,
    'este plugin se instala por marketplace do Claude Code, nunca por npm publish');
});

// ── T11: o roteiro do init e o README dizem o que o codigo faz ─────────────

const secaoDoInit = (inicio) => {
  const t = ler('skills/init/SKILL.md');
  const i = t.indexOf('\n## ' + inicio);
  assert.ok(i !== -1, 'sumiu o passo "' + inicio + '" do init');
  const f = t.indexOf('\n## ', i + 4);
  return t.slice(i, f === -1 ? t.length : f);
};
// a prosa quebra linha no meio da frase: as frases se conferem com o espaco normalizado
const plano = (s) => s.replace(/\n>/g, '\n').replace(/\s+/g, ' ');

test('T11-3: o Passo 2c do init diz que o peso conta candidatos a fonte quando instrucoes.fontes e candidatas', () => {
  const p = plano(secaoDoInit('Step 2c'));
  assert.ok(/instrucoes\.fontes/.test(p), 'o passo nao cita o campo instrucoes.fontes');
  assert.ok(/`candidatas`/.test(p), 'o passo nao diz o valor candidatas');
  assert.ok(/canonical-source candidates/i.test(p), 'o passo nao diz que o numero conta candidatos a fonte canonica');
  assert.ok(/not yet confirmed/i.test(p), 'o passo nao diz que ainda nao estao confirmados');
  assert.ok(/question 2 of Step 4/.test(p), 'o passo nao manda para a pergunta 2 do Passo 4');
  assert.ok(/together with the number/i.test(p), 'o passo nao manda dizer isso ao dono junto com o numero');
});

test('T11-5: o Passo 4b pergunta onde cada coisa se registra, depois do 4 e antes do 5, sem virar a 7a pergunta', () => {
  const t = ler('skills/init/SKILL.md');
  const i4 = t.indexOf('\n## Step 4 ');
  const i4b = t.indexOf('\n## Step 4b');
  const i5 = t.indexOf('\n## Step 5 ');
  assert.ok(i4 !== -1 && i4b !== -1 && i5 !== -1, 'faltou o Passo 4, o 4b ou o 5');
  assert.ok(i4 < i4b && i4b < i5, 'o 4b tem de vir depois do 4 e antes do 5');
  const p = plano(secaoDoInit('Step 4b'));
  assert.ok(/^ ## Step 4b [—-] where each thing is recorded/.test(p), 'titulo do 4b');
  assert.ok(/decision log/i.test(p), 'faltou o destino: log de decisoes');
  assert.ok(/still-open questions/i.test(p), 'faltou o destino: duvidas abertas');
  assert.ok(/ledger/i.test(p), 'faltou o destino: ledger do plano em execucao');
  assert.ok(/ondeRegistrar/.test(p), 'o 4b nao cita a fatia ondeRegistrar');
  assert.ok(/AskUserQuestion/.test(p), 'o 4b nao usa AskUserQuestion');
  assert.ok(/Step 3b/.test(p), 'o 4b nao manda oferecer so nome da listagem do Passo 3b');
  assert.ok(/Do not create the files/i.test(p), 'o 4b nao diz que nao cria os arquivos');
  assert.ok(/Step 7c/.test(p) && /decisoes/.test(p), 'o 4b nao diz que a resposta vai para a fatia decisoes do 7c');
  assert.ok(/Don't save/.test(p) && /not saved anywhere/.test(p),
    'o 4b nao avisa que, com "Nao gravar" a skill no 7c, a resposta nao fica gravada em lugar nenhum');
  // o 4b nao e a 7a pergunta do Passo 4 (ondeRegistrar nao e campo do projeto.json)
  assert.strictEqual(projetoLib.CHAVES.indexOf('ondeRegistrar'), -1);
  const p4 = secaoDoInit('Step 4 ');
  assert.ok(!/ondeRegistrar/.test(p4), 'o Passo 4 nao pode carregar a pergunta do 4b');
});

// D503 (plano d503, Tarefa 6, 1o subitem): a referencia de topo e perguntada no fim do 4b (o Passo 4 segue com seis
// perguntas), grava `referencias`, e a opcao de nunca usar grava `{}`, que cala o aviso da abertura.
test('D503 T6: o 4b pergunta a referencia de topo e grava referencias; o Passo 4 nao a carrega', () => {
  const p = plano(secaoDoInit('Step 4b'));
  assert.ok(/top reference/i.test(p), 'o 4b nao pergunta a referencia de topo');
  assert.ok(/`referencias`/.test(p), 'o 4b nao diz que grava a chave referencias');
  assert.ok(/`tela`/.test(p) && /`codigo`/.test(p) && /`texto`/.test(p), 'o 4b nao diz os tres tipos');
  assert.ok(/`"referencias": \{\}`/.test(p), 'o 4b nao diz que "nunca" grava o objeto vazio');
  assert.ok(/warns once/.test(p), 'o 4b nao diz que, sem a chave, a abertura avisa uma vez');
  assert.ok(/six questions/.test(p), 'o 4b nao diz por que a pergunta mora nele (as seis do Passo 4)');
  assert.ok(!/referencias/.test(secaoDoInit('Step 4 ')), 'o Passo 4 nao pode carregar a pergunta da referencia');
  assert.ok(/`referencias`/.test(plano(secaoDoInit('Step 7 '))), 'o Passo 7 nao diz quando gravar referencias');
});

test('T11-5: a linha decisoes do Passo 7c remete ao 4b e nao pergunta de novo', () => {
  const linha = secaoDoInit('Step 7c').split('\n').filter((l) => /^\| `decisoes` \|/.test(l))[0];
  assert.ok(linha, 'sumiu a linha decisoes do 7c');
  assert.ok(/Step 4b/.test(linha), 'a linha decisoes nao remete ao Passo 4b');
  assert.ok(/without asking again/i.test(linha), 'a linha decisoes nao diz que nao se pergunta de novo');
});

test('D396 n. 12, 17, 20, 21, 26, 28: os textos de skill e README dizem o que o codigo faz', () => {
  const p4b = plano(secaoDoInit('Step 4b'));
  assert.ok(/one question per place/.test(p4b), 'n. 17: o 4b nao diz que e uma pergunta por lugar (3 lugares != 3 opcoes)');
  const naoGravar = plano(secaoDoInit('Step 7c')).match(/\*\*Don't save\*\*[^*]*/);
  assert.ok(naoGravar, 'n. 20: sumiu a opcao Nao gravar do 7c');
  assert.ok(!/nothing is lost/.test(naoGravar[0]) && /Step 4b/.test(naoGravar[0]),
    'n. 20: o Nao gravar do 7c tem de dizer que a resposta do 4b se perde');
  assert.ok(/Gerado por `\/sworn:init`"; with more than one/.test(p4b), 'n. 21: o re-init nao diz qual skill e a do projeto');
  const padrao = plano(ler('skills/playbook/SKILL.md'));
  assert.ok(/Gerado por `\/sworn:init`"; with more than one like that, ask the owner/.test(padrao),
    'n. 21: o Passo 0-bis nao diz qual skill e a do projeto');
  // sessao 27: so a gerada deixava de fora a skill de execucao escrita a mao, que a secao 1 diz que vence
  assert.ok(/ask the owner which one applies; with none like that, the handwritten one/.test(padrao),
    'sessao 27: o Passo 0-bis exclui a skill de execucao escrita a mao');
  const revisar = ler('skills/review/SKILL.md');
  assert.ok(!/~50 pairs/.test(revisar) && /with more than 50 pairs, batches of up to 50/.test(revisar), 'n. 26: lote do juiz ambiguo');
  const i = README.indexOf('\n## Como desligar uma trava');
  const f = README.indexOf('\n## ', i + 4);
  assert.ok(i !== -1 && /"portaoDecisao": false/.test(README.slice(i, f)), 'n. 28: o portaoDecisao fora de Como desligar');
  const linhaFim = README.split('\n').filter((l) => /`scripts\/fim-sessao\.js`/.test(l))[0];
  assert.ok(/1,5 s/.test(linhaFim) && /`timeout`/.test(linhaFim), 'n. 12: o README nao diz que o timeout nao aumenta o 1,5 s');
});

test('T11-6: o README nao promete o aviso Plugin updated como certo e diz que a versao chega minutos depois', () => {
  const i = README.indexOf('Ligue a atualiza');
  const f = README.indexOf('**No painel do VS Code o bot', i);
  assert.ok(i !== -1 && f > i, 'sumiu o bloco da atualizacao automatica do README');
  const bloco = plano(README.slice(i, f));
  assert.ok(/alguns minutos depois/i.test(bloco), 'o README nao diz que a versao chega minutos depois');
  assert.ok(!/avisa\s+`?Plugin updated/i.test(bloco), 'o README ainda promete o aviso Plugin updated');
  assert.ok(/pode n[ãa]o aparecer/i.test(bloco), 'o README nao diz que o aviso pode nao aparecer');
  assert.ok(/painel do VS Code/.test(bloco), 'o README nao cita o painel do VS Code');
  assert.ok(/\/reload-plugins/.test(bloco), 'o README nao manda rodar /reload-plugins');
  assert.ok(/claude plugin list/.test(bloco), 'o README nao ensina o claude plugin list');
  assert.ok(!/a cada sess[ãa]o nova/i.test(bloco), 'o README ainda diz que a versao baixa a cada sessao nova, na abertura');
});

test('T11-6: todo script ligado no hooks.json aparece na tabela de ganchos do README, na ordem dos eventos', () => {
  const hooks = json('hooks/hooks.json').hooks;
  const ligados = [];
  for (const grupos of Object.values(hooks)) {
    for (const g of grupos) {
      for (const h of g.hooks) {
        const nome = path.basename(h.args[0]);
        if (ligados.indexOf(nome) === -1) ligados.push(nome);
      }
    }
  }
  const i = README.indexOf('O plugin se pendura em ');
  assert.ok(i !== -1, 'sumiu a tabela de ganchos do README');
  // A2 (D426): o fim da tabela e a primeira linha em branco depois dela; antes era o "\nTr" de
  // "Tres coisas acontecem", que virou "Cinco" quando o README passou a listar o aprender e a auditoria.
  const f = README.indexOf('\n\n', README.indexOf('| Quando |', i));
  const tabela = README.slice(i, f);
  const faltam = ligados.filter((n) => tabela.indexOf('scripts/' + n) === -1);
  assert.deepStrictEqual(faltam, [], 'script ligado no hooks.json e ausente da tabela de ganchos do README');
  const linhas = tabela.split('\n').filter((l) => /^\| /.test(l) && !/^\| Quando /.test(l) && !/^\|---/.test(l));
  const dito = tabela.match(/se pendura em (\S+) pontos/);
  assert.ok(dito, 'a tabela nao diz em quantos pontos o plugin se pendura');
  assert.strictEqual(NUMEROS[dito[1].toLowerCase()], linhas.length, 'o texto conta outros pontos que as linhas da tabela');
  // fim da sessao e a ultima linha, depois do fim do turno
  assert.ok(/fim-sessao\.js/.test(linhas[linhas.length - 1]), 'o fim da sessao tem de ser a ultima linha da tabela');
  assert.ok(/portao-fecho\.js/.test(linhas[linhas.length - 2]), 'o fim do turno vem antes do fim da sessao');
  const shell = linhas.filter((l) => /portao-estilo\.js/.test(l))[0];
  assert.ok(shell && /portao-destrutivo\.js/.test(shell), 'o portao-estilo vai na linha do Bash e PowerShell, ao lado do destrutivo');
});

// T11-4 (sessao 24): o README copia a pergunta de cada lente; a de seguranca ganhou as tres
// conferencias antes de P0 no veredito.js, e a copia do README tem de dizer o mesmo.
test('publicacao: a lente de seguranca do README cita as tres conferencias antes de P0', () => {
  const linha = README.split('\n').filter((l) => /^\| Seguran\u00e7a e dado sens\u00edvel \|/.test(l))[0];
  assert.ok(linha, 'sumiu a linha da lente de seguranca na tabela das lentes do README');
  assert.ok(/Antes de P0, tr\u00eas confer\u00eancias/.test(linha), 'a lente de seguranca do README nao cita as tres conferencias');
  assert.ok(/chamadores reais/.test(linha) && /leitura n\u00e3o \u00e9 muta\u00e7\u00e3o/.test(linha), 'faltam conferencias na lente do README');
  assert.ok(/P2 com pergunta/.test(linha), 'a lente do README nao diz que o achado sem intencao confirmada nasce P2');
});

// D387/D388 (0.5.0): o juiz de "mesmo defeito" e o portao do AskUserQuestion estao ligados onde devem.
test('D387: agents/dedupe-judge.md existe com model haiku e sem Write, e o corpo nao nomeia modelo', () => {
  const t = ler('agents/dedupe-judge.md');
  const cab = t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(cab, 'o agente nao tem frontmatter');
  assert.ok(/^name: dedupe-judge$/m.test(cab[1]), 'o name do agente e dedupe-judge');
  assert.ok(/^model: haiku$/m.test(cab[1]), 'o juiz roda no apelido haiku');
  const ferramentas = cab[1].match(/^tools: (.*)$/m);
  assert.ok(ferramentas && !/\bWrite\b/.test(ferramentas[1]), 'o juiz nao pode ter Write');
  const corpo = t.slice(cab[0].length);
  assert.ok(!/haiku|sonnet|opus|fable|claude-|\bv?\d+\.\d+\.\d+\b|\$\s?\d/i.test(corpo), 'o corpo do juiz nao nomeia modelo, versao nem preco');
});

// D447 corte 1 (0.6.2): inspetor e juiz abrem sem a lista de skills, sem as ferramentas adiadas e sem o
// CLAUDE.md. Lista fechada sem Skill tira as duas listas da abertura (medido: boot 28.5K contra 56.6K);
// omitClaudeMd tira as instrucoes do projeto. Nenhum dos dois roda comando nem chama skill.
test('D447: inspetor e juiz-mesmo tem tools fechada so de leitura e omitClaudeMd', () => {
  for (const nome of ['inspector', 'dedupe-judge']) {
    const cab = ler('agents/' + nome + '.md').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    assert.ok(cab, nome + ': o agente nao tem frontmatter');
    assert.ok(/^tools: Read, Grep, Glob$/m.test(cab[1]), nome + ': tools tem de ser Read, Grep, Glob');
    assert.ok(!/^disallowedTools:/m.test(cab[1]), nome + ': disallowedTools herda a lista inteira (com Skill); use tools');
    assert.ok(/^omitClaudeMd: true$/m.test(cab[1]), nome + ': falta omitClaudeMd: true');
  }
});

test('D387: o Passo 3 do revisar manda despachar sworn:dedupe-judge e gravar o mesmos.json', () => {
  const t = ler('skills/review/SKILL.md');
  const i = t.indexOf('## Step 3');
  const f = t.indexOf('## Step 4');
  assert.ok(i !== -1 && f > i, 'sumiu o Passo 3 do revisar');
  const passo3 = t.slice(i, f);
  assert.ok(passo3.includes('sworn:dedupe-judge'), 'o Passo 3 nao cita o sworn:dedupe-judge');
  assert.ok(passo3.includes('mesmos.json') && passo3.includes('paresCandidatos') && passo3.includes('provaveisMesmos'),
    'o Passo 3 nao cita mesmos.json, paresCandidatos e provaveisMesmos');
});

test('D388: o hooks.json liga o portao-decisao.js no PreToolUse com o matcher AskUserQuestion, depois do Task|Agent', () => {
  const grupos = json('hooks/hooks.json').hooks.PreToolUse;
  const g = grupos.filter((x) => x.matcher === 'AskUserQuestion');
  assert.strictEqual(g.length, 1, 'tem de haver um grupo PreToolUse para o AskUserQuestion');
  assert.deepStrictEqual(g[0].hooks.map((h) => path.basename(h.args[0])), ['portao-decisao.js']);
  assert.ok(grupos.indexOf(g[0]) > grupos.findIndex((x) => x.matcher === 'Task|Agent'), 'o portao vem depois do Task|Agent');
});

// D454: o Git para Windows clona com core.autocrlf=true e o workflow chegava com CR em cada linha; o VS Code
// recusa o script ("control characters that would be hidden in the approval dialog") antes da janela.
// Medido: sem .gitattributes o clone sai com CR; com eol=lf sai sem nenhum.
test('D454: .gitattributes forca LF no clone e o workflow nao tem caractere de controle', () => {
  const attrs = fs.existsSync(path.join(RAIZ, '.gitattributes')) ? ler('.gitattributes') : '';
  assert.ok(/^\*(\.js)?[ \t]+(.*[ \t])?eol=lf([ \t]|$)/m.test(attrs), '.gitattributes tem de forcar eol=lf em * ou *.js');
  for (const f of fs.readdirSync(path.join(RAIZ, 'workflows')).filter((x) => x.endsWith('.js'))) {
    const s = ler('workflows/' + f);
    const i = s.search(/[\x00-\x08\x0b-\x1f\x7f-\x9f​-‏‪-‮⁦-⁩﻿]/);
    assert.strictEqual(i, -1, 'workflows/' + f + ': caractere de controle na posicao ' + i);
  }
});

// D497/D498 (0.7.6): a escolha visual prefere a pagina Artifact; as lentes de tela ganham o que faltava.
const secao = (s, de, ate) => {
  const i = s.indexOf(de);
  const f = s.indexOf(ate, i + de.length);
  assert.ok(i !== -1 && f > i, 'sumiu o trecho entre ' + de + ' e ' + ate);
  return plano(s.slice(i, f));
};

test('D497: a escolha visual prefere a pagina Artifact e cai na imagem sem a ferramenta', () => {
  const p = secao(ler('skills/playbook/SKILL.md'), '**Visual choice:', '**A manual action by the owner');
  assert.ok(/Artifact page/.test(p), 'D497: o paragrafo nao cita a pagina Artifact');
  assert.ok(/light and dark/.test(p), 'D497: o paragrafo nao pede claro e escuro');
  assert.ok(/laptop/.test(p) && /phone/.test(p), 'D497: o paragrafo nao pede notebook e celular');
  // revisao R1 da 0.7.6: celular atropelava o viewport que o projeto tirou; a pagina pulava a espera do envio
  assert.ok(/screen widths the project declares \(with no declaration/.test(p), 'D497: as larguras nao seguem as que o projeto declara');
  // revisao R2: sem larguras declaradas, celular so entra se o produto roda em celular
  assert.ok(/phone one only if it runs on a phone/.test(p), 'D497: sem declaracao, a largura de celular entra mesmo sem o produto rodar nela');
  assert.ok(/[Tt]he rite is that of the image[^.]*next turn/.test(p), 'D497: a pagina nao segue o rito da imagem (envio, depois as 3 opcoes)');
  assert.ok(/[Ww]ithout the tool[^.]*image/.test(p), 'D497: o paragrafo nao diz que sem a ferramenta cai na imagem');
  assert.ok(/fictitious data only/i.test(p), 'D497: o paragrafo nao manda usar so dado ficticio');
});

test('D498: as lentes 2, 4 e 7 da rubrica de tela dizem catalogo, alvo de 24 px e INP', () => {
  const r = ler('skills/playbook/references/02-rubrica-aaa.md');
  const l2 = secao(r, '## Lens 2', '## Lens 3');
  assert.ok(/component catalog/.test(l2) && /states page/.test(l2), 'D498 n. 2: a Lente 2 nao cita catalogo ou pagina de estados');
  const l4 = secao(r, '## Lens 4', '## Lens 5');
  assert.ok(/24 × 24 px/.test(l4) && /2\.5\.8/.test(l4), 'D498 n. 5: a Lente 4 nao cita o alvo de 24 x 24 px (WCAG 2.5.8)');
  assert.ok(/\*\*P1:\*\*[^*]*24 × 24/.test(l4), 'D498 n. 5: alvo abaixo de 24 x 24 px nao e P1 na Lente 4');
  // revisao R2: na WCAG 2.5.8 o controle equivalente cumpre os 24 px; "do mesmo tamanho" isentava o alvo pequeno
  assert.ok(/another control on the page that meets the 24 px/.test(l4) && !/of the same size/.test(l4),
    'D498 n. 5: a excecao do controle equivalente nao exige que ele cumpra os 24 px');
  const l7 = secao(r, '## Lens 7', '## Lens 8');
  assert.ok(/INP/.test(l7) && /200 ms/.test(l7) && /500 ms/.test(l7), 'D498 n. 4: a Lente 7 nao cita o INP com 200 e 500 ms');
  assert.ok(/\*\*P1:\*\*[^*]*500 ms/.test(l7), 'D498 n. 4: INP medido acima de 500 ms nao e P1 na Lente 7');
});

test('D498: a Marcha AAA pede comparacao de print antes x depois e entrega o roteiro de 5 usuarios', () => {
  const m = secao(ler('skills/playbook/references/01-marchas-e-gates.md'), '## Gear 3', '## Doubt rule');
  assert.ok(/(automatic )?comparison of screenshots before × after/.test(m), 'D498 n. 1: o portao visual nao cita a comparacao de print');
  assert.ok(/5 real users/.test(m) && /does not block/.test(m), 'D498 n. 3: a Marcha AAA nao entrega o roteiro de 5 usuarios sem bloquear');
});

// D503 (plano d503, Tarefa 4): a regra 1 do prompt - a referencia de topo e nomeada antes de fazer e se abre -
// mora na 4.1 do padrao, junto do artefatoDeReferencia, e aponta a chave e a revisao que a usam.
test('D503: a 4.1 do padrao manda nomear antes a referencia de topo que se abre e aponta referencias e o revisar', () => {
  const s = secao(ler('skills/playbook/SKILL.md'), '### 4.1', '### 4.2');
  assert.ok(s.includes('{{texto:artefatoDeReferencia}}'), 'a 4.1 perdeu o artefatoDeReferencia');
  assert.match(s, /before (starting|doing)/i, 'a 4.1 nao diz que a referencia se nomeia antes de fazer');
  assert.match(s, /can be opened/, 'a 4.1 nao exige referencia que se abre');
  assert.match(s, /never a recollection/, 'a 4.1 aceita referencia de memoria');
  assert.match(s, /`referencias`/, 'a 4.1 nao aponta a chave referencias do projeto.json');
  assert.match(s, /\/sworn:review/, 'a 4.1 nao aponta a revisao que usa a referencia');
  assert.match(s, /in both orders/, 'a 4.1 nao diz a regra de pronto contra a referencia');
  assert.match(s, /no reference/, 'a 4.1 nao diz o que fazer sem referencia');
});

// ── L6 da revisao completa: o texto diz o que o codigo faz ─────────────────

test('A4-06: a skill gerada nao manda rodar script do plugin como se morasse no projeto', () => {
  const t = ler('modelos/skill-projeto.md');
  assert.ok(!/`node scripts\//.test(t), 'o molde manda "node scripts/..." - o script mora no plugin (Cannot find module)');
  assert.match(t, /node "<plugin>\/scripts\/uso\.js"/, 'o molde perdeu a contagem de disparos pela pasta do plugin');
  assert.ok(fs.existsSync(path.join(RAIZ, 'scripts', 'uso.js')), 'o uso.js saiu do plugin');
});

test('A4-07: o aprender diz que o propor-regra.js RECUSA quebra de linha (D434)', () => {
  assert.match(ler('scripts/propor-regra.js'), /RECUSADA: o gatilho ou a acao tem quebra de linha\. Nada foi gravado\./);
  const p = plano(ler('skills/learn/SKILL.md'));
  assert.ok(!/(?:does not|doesn't) refuse text with two lines/i.test(p), 'a skill ainda diz que o script nao recusa');
  assert.ok(!/writes (?:it )?anyway/i.test(p), 'a skill ainda diz que o script grava a regra partida');
  assert.match(p, /refuses .{0,80}RECUSADA/, 'a skill nao diz que o script recusa, com a palavra que ele imprime');
});

test('A8-01: o Passo 5 do init nao diz que aaa e padrao barram igual (o portao do manual so olha aaa)', () => {
  assert.match(ler('scripts/portao-escopo.js'), /marcha === 'aaa' && projeto\.portaoManual !== false/);
  const p = plano(secaoDoInit('Step 5 '));
  assert.ok(!/block exactly the same/.test(p), 'o Passo 5 ainda diz que aaa e padrao barram igual');
  assert.ok(!/is not, today, a (?:stricter|tighter) (?:lock|gate)/.test(p), 'o Passo 5 ainda diz que aaa nao aperta mais');
  assert.match(p, /`aaa`.{0,200}manual/, 'o Passo 5 nao diz que aaa exige o manual');
  assert.match(p, /portaoManual"?: false/, 'o Passo 5 nao diz a chave que desliga o portao do manual');
});

test('A8-02: o aprender diz o que o gancho manda - rodar na mesma resposta e perguntar em 3 opcoes', () => {
  const ordem = require('../scripts/lib/correcao.js').INSTRUCAO_DA_CORRECAO;
  assert.match(ordem, /nesta mesma resposta/);
  assert.match(ordem, /em 3 opcoes/);
  const p = plano(ler('skills/learn/SKILL.md'));
  assert.ok(!/offers in one line/.test(p), 'a skill ainda diz que o agente so oferece em uma linha');
  assert.match(p, /in the same response/, 'a skill nao diz que roda na mesma resposta');
  assert.match(p, /3 options/, 'a skill nao diz que pergunta em 3 opcoes');
});

test('A11-01: o que o init manda escrever (Passos 3, 4 e 8) nao e lido como alegacao de sucesso pelo fecho', () => {
  const ev = require('../scripts/lib/evidencia.js');
  const disparam = [];
  let passo = '';
  ler('skills/init/SKILL.md').split(/\r?\n/).forEach(function (l, i) {
    const m = l.match(/^## (Passo \S+)/);
    if (m) passo = m[1];
    if (!/^Passo (3|4|8)\b/.test(passo) || !(/^\|/.test(l) || /^\d+\. \*\*/.test(l))) return;
    if (ev.analisar(l).alegaSucesso) disparam.push(passo + ':' + (i + 1) + ' ' + l.slice(0, 80));
  });
  assert.deepStrictEqual(disparam, [], 'linhas que o modelo repete e o portao de fecho barra');
});

// A8-03: os blocos de saida dos portoes no README sao a saida literal desta versao - rodados aqui, de verdade, contra o
// projeto de exemplo do README. Bloco "sworn..." do README que nao e nenhuma delas reprova (texto velho), salvo os
// que este teste nao gera (o do fecho e o aviso do portaoDecisao).
function saidasDosPortoes() {
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-a803-'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-a803t-'));
  try {
    const escrever = (rel, c) => {
      const a = path.join(dir, rel);
      fs.mkdirSync(path.dirname(a), { recursive: true });
      fs.writeFileSync(a, c, 'utf8');
    };
    escrever('.claude/sworn/projeto.json', JSON.stringify({
      versaoConfig: 1, marchaPadrao: 'padrao', intocaveis: ['.env'],
      marchas: { aaa: [], padrao: ['src/**', 'test/**'], rapida: ['docs/**'] }
    }));
    escrever('.claude/sworn/escopo.md', ['# Escopo', '**Objetivo:** corrigir o calculo do frete no carrinho.',
      '## Dentro', '- src/carrinho/**', '- test/carrinho.test.js', '- test/cobertura.json', '## Fora de escopo',
      '- src/pagamento/**', ''].join('\n'));
    escrever('src/usuarios/perfil.js', 'x\n');
    escrever('src/pagamento/cobranca.js', 'x\n');
    escrever('.env', 'A=1\n');
    escrever('test/cobertura.json', '{ "minimo": 80 }\n');
    spawnSync('git', ['init', '-q', dir]);
    spawnSync('git', ['-C', dir, 'add', '-A']);
    spawnSync('git', ['-C', dir, '-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '-q', '-m', 'base']);
    const env = Object.assign({}, process.env, { SWORN_TMP: tmp });
    const rodar = (script, ev) => {
      const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', script)],
        { input: JSON.stringify(Object.assign({ session_id: 'sa803', cwd: dir }, ev)), encoding: 'utf8', env: env, cwd: dir, timeout: 60000 });
      let j = null;
      try { j = JSON.parse(r.stdout); } catch (e) { j = null; }
      return (j && j.hookSpecificOutput && j.hookSpecificOutput.permissionDecisionReason) || (j && j.reason) || null;
    };
    const pre = (tool, input) => ({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input });
    const em = (rel) => path.join(dir, rel);
    rodar('abertura.js', { hook_event_name: 'SessionStart', source: 'startup' });
    const s = {
      fora: rodar('portao-escopo.js', pre('Edit', { file_path: em('src/usuarios/perfil.js'), old_string: 'x', new_string: 'y' })),
      FORA: rodar('portao-escopo.js', pre('Edit', { file_path: em('src/pagamento/cobranca.js'), old_string: 'x', new_string: 'y' })),
      intocavel: rodar('portao-escopo.js', pre('Write', { file_path: em('.env'), content: 'A=2\n' })),
      destrutivo: rodar('portao-destrutivo.js', pre('Bash', { command: 'git reset --hard origin/main' })),
      criar: rodar('portao-escopo.js', pre('Write', { file_path: em('src/carrinho/frete-novo.js'), content: 'x\n' })),
      catraca: rodar('portao-escopo.js', pre('Edit', { file_path: em('test/cobertura.json'), old_string: '"minimo": 80', new_string: '"minimo": 60' }))
    };
    const ho = '.claude/sworn/handoff/2026-10-10-frete.md';
    escrever(ho, '# handoff\n');
    rodar('marcar-trabalho.js', { hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: em(ho), content: '# handoff\n' } });
    s.handoff = rodar('portao-fecho.js', { hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Gravei o handoff do frete.' });
    s.troca = saude.avisoDeSaude(['7 bloqueios de portao nesta sessao (limiar 6)']);
    return s;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const secaoDoReadme = (titulo) => {
  const t = ler('GUIA.md');
  const i = t.indexOf('\n## ' + titulo);
  assert.ok(i !== -1, 'sumiu a secao "' + titulo + '" do README');
  const f = t.indexOf('\n## ', i + 4);
  return plano(t.slice(i, f === -1 ? t.length : f));
};

// A12-05 (doc host-marketplace, "Grant access to a private marketplace"): o atalho owner/repo sonda o SSH; sem chave
// SSH, CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1 pula a sonda; o /plugin na sessao e o update nao caem sozinhos para HTTPS.
test('A12-05: o Como instalar diz o caminho de quem nao tem chave SSH no GitHub', () => {
  const p = secaoDoReadme('Como instalar');
  assert.match(p, /CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1/, 'falta a variavel que pula a sonda SSH');
  assert.match(p, /SSH/, 'nao diz que o atalho tenta SSH');
  assert.match(p, /https:\/\/github\.com\/wendellmcs\/sworn\.git/, 'falta a URL https, que vai direto por HTTPS');
});

// A12-06 (doc hooks e plugins/org): allowManagedHooksOnly bloqueia hooks de plugin (isento o forcado no enabledPlugins
// gerenciado); allowManagedModsOnly para os hooks do mod; a lista de marketplaces barra com "is blocked by enterprise policy".
test('A12-06: o Como instalar avisa que a politica da empresa pode desligar as travas', () => {
  const p = secaoDoReadme('Como instalar');
  assert.match(p, /allowManagedHooksOnly/, 'falta a chave que bloqueia os hooks de plugin');
  assert.match(p, /enabledPlugins/, 'falta a saida (plugin forcado no enabledPlugins gerenciado)');
  assert.match(p, /allowManagedModsOnly/, 'falta a chave que para os hooks do mod');
  assert.match(p, /is blocked by enterprise policy/, 'falta a mensagem que o /plugin mostra');
});

test('A8-03: os blocos de saida dos portoes no README sao a saida literal desta versao', () => {
  const saidas = saidasDosPortoes();
  Object.keys(saidas).forEach(function (k) { assert.ok(saidas[k], 'o portao "' + k + '" nao negou no projeto de exemplo'); });
  const blocos = [];
  ler('GUIA.md').replace(/\r\n/g, '\n').replace(/^~~~text\n([\s\S]*?)\n~~~$/gm, function (m, c) { blocos.push(c); return m; });
  const literais = Object.keys(saidas).map(function (k) { return saidas[k].replace(/\n+$/, ''); });
  Object.keys(saidas).forEach(function (k, i) {
    assert.ok(blocos.indexOf(literais[i]) !== -1, 'o README nao tem a saida literal do portao "' + k + '":\n' + literais[i]);
  });
  const naoGerados = [/^sworn - portao de fecho \(trava 3\)\./, /^sworn: ATENCAO - valor de tipo errado/];
  const velhos = blocos.filter(function (b) {
    return /^sworn[ :]/.test(b) && literais.indexOf(b) === -1 && !naoGerados.some(function (r) { return r.test(b); });
  });
  assert.deepStrictEqual(velhos.map(function (b) { return b.split('\n')[0]; }), [], 'bloco de portao no README que o codigo nao imprime');
});
