'use strict';
// O GUIA.md cita contas, listas e comportamentos do codigo. Cada teste aqui pega a frase que se afasta do que o
// codigo faz. O nome de cada teste e o codigo do achado que ele fecha, na lista de achados antigos
// (.superpowers/sdd/esquadro-pendencias/h1/triagem-antigos.tsv).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
// Lido sob demanda, dentro de cada teste: um GUIA.md que suma reprova estes testes, nao derruba o carregamento.
// As quebras viram \n: com CRLF (checkout com autocrlf), o fim de paragrafo '\n\n' nao seria achado.
const guia = () => ler('GUIA.md').replace(/\r\n/g, '\n');

/** O paragrafo que comeca em `marca`, ate a linha em branco; a marca e o fim tem de existir. */
function paragrafo(marca) {
  const p = guia();
  const ini = p.indexOf(marca);
  assert.ok(ini !== -1, 'sumiu do GUIA.md "' + marca + '": se mudou, acerte este teste');
  const fim = p.indexOf('\n\n', ini);
  assert.ok(fim !== -1, 'o paragrafo de "' + marca + '" nao termina numa linha em branco');
  return p.slice(ini, fim);
}
// sem acento e em minusculas: o codigo grava os titulos sem acento, o GUIA com
const semAcento = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** A linha da tabela que comeca por `inicio`; tem de existir, senao o teste diz qual sumiu. */
function linhaQueComeca(inicio) {
  const l = guia().split(/\r?\n/).find((x) => x.startsWith(inicio));
  assert.ok(l, 'sumiu do GUIA.md a linha que comeca por ' + inicio + ': se ela mudou, acerte este teste');
  return l;
}

test('A8-04: o titulo da lista de lentes diz quantas sao, e a tabela de codigo traz cada lente de codigo', () => {
  const v = require('../scripts/lib/veredito.js');
  const NUMEROS = { dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, 'vinte e uma': 21, 'vinte e duas': 22 };
  const p = guia();
  const m = /<summary>As (.+?) lentes e a pergunta de cada uma<\/summary>/.exec(p);
  assert.ok(m, 'sumiu o titulo "As N lentes e a pergunta de cada uma" do GUIA.md');
  assert.ok(m[1] in NUMEROS, 'o titulo diz "' + m[1] + '", que este teste nao conhece: acrescente o numero em NUMEROS');
  assert.strictEqual(NUMEROS[m[1]], v.LENTES.length + v.LENTES_UI.length,
    'o titulo diz "' + m[1] + '" e o codigo tem ' + v.LENTES.length + ' de codigo e ' + v.LENTES_UI.length + ' de tela');
  const ini = p.indexOf(m[0]);
  const fim = p.indexOf('</details>', ini);
  assert.ok(fim !== -1, 'a lista de lentes nao fecha com </details>: o teste leria o resto do GUIA.md');
  const bloco = semAcento(p.slice(ini, fim));
  const faltam = v.LENTES.concat(v.LENTES_UI).filter((l) => bloco.indexOf('| ' + semAcento(l.titulo) + ' |') === -1)
    .map((l) => l.chave);
  assert.deepStrictEqual(faltam, [], 'lente sem linha na tabela do GUIA.md: acrescente a linha com a pergunta dela');
});

test('A8-29: as ferramentas do PostToolUse que o GUIA.md lista sao as do hooks.json', () => {
  const h = JSON.parse(ler('hooks/hooks.json'));
  const pos = h.hooks && h.hooks.PostToolUse;
  assert.ok(Array.isArray(pos), 'o hooks.json nao tem a lista PostToolUse: acerte este teste');
  const matcher = pos.map((x) => x.matcher).find((mt) => /Write/.test(mt || ''));
  assert.ok(matcher, 'nenhum PostToolUse do hooks.json pega o Write: acerte este teste');
  const doHook = matcher.split('|').sort();
  const linha = linhaQueComeca('| `PostToolUse` em `Write`');
  const doGuia = (linha.split('(no ')[0].match(/`([A-Za-z]+)`/g) || []).map((x) => x.replace(/`/g, ''))
    .filter((x) => x !== 'PostToolUse').sort();
  assert.deepStrictEqual(doGuia, doHook, 'a linha "| `PostToolUse` em `Write`..." do GUIA.md lista ferramentas diferentes ' +
    'das do matcher do hooks.json: acerte a linha do GUIA.md (ou o hooks.json, se o gancho mudou sem querer)');
  const tabela1 = linhaQueComeca('| depois de `Write`');
  for (const f of doHook) {
    assert.ok(tabela1.includes('`' + f + '`'),
      'a linha "| depois de `Write`..." do GUIA.md nao cita `' + f + '`, que o hooks.json pega: acrescente a ferramenta nela');
  }
});

test('A8-13: nenhuma doc diz "topo da escada": a trava barra a metade mais cara', () => {
  // "o topo" sozinho vale (com 2 ou 3 agentes a metade cara e so o topo); errado e chamar o barrado de "o do topo"
  const velhas = /agente do topo da escada|top-of-the-ladder agent|top-tier agent/i;
  const comVelha = ['GUIA.md', 'README.md', 'README.pt-BR.md', 'modelos/skill-projeto.md']
    .filter((f) => velhas.test(ler(f)));
  assert.deepStrictEqual(comVelha, [], 'ainda diz "topo da escada": troque por "metade mais cara da escada"');
});

test('A8-27: a excecao dos nomes de modelo cita cada arquivo do plugin que nomeia modelo', () => {
  const trecho = paragrafo('exceções, declaradas');
  const comModelo = fs.readdirSync(path.join(RAIZ, 'agents')).filter((f) => /\.md$/.test(f))
    .filter((f) => /^model:/m.test(ler('agents/' + f))).map((f) => f.replace(/\.md$/, ''));
  assert.ok(comModelo.length > 0, 'nenhum agente com model: o teste nao conferiria nada');
  for (const a of comModelo) {
    assert.ok(trecho.includes('`' + a + '`'),
      'o paragrafo "duas exceções, declaradas" do GUIA.md nao cita o agente ' + a + ', que tem model:: acrescente `' + a + '` nele');
  }
  assert.ok(/MODELOS = \[/.test(ler('workflows/parallel.js')),
    'o workflows/parallel.js nao tem mais MODELOS = [: acerte este teste e o paragrafo das exceções');
  assert.ok(trecho.includes('`workflows/parallel.js`'),
    'o paragrafo "duas exceções, declaradas" do GUIA.md nao cita o `workflows/parallel.js`, que aceita haiku, sonnet e opus');
});

test('A8-30: a tabela de ferramentas traz o catalogo.js com cada flag dele', () => {
  const src = ler('scripts/catalogo.js');
  const m = /const FLAGS = \[([^\]]+)\]/.exec(src);
  assert.ok(m, 'sumiu o FLAGS do scripts/catalogo.js: acerte este teste');
  const flags = m[1].match(/--[a-z-]+/g);
  assert.ok(flags, 'o FLAGS do scripts/catalogo.js nao lista nenhuma flag escrita: acerte este teste');
  const linha = linhaQueComeca('| `node "<plugin>/scripts/catalogo.js"');
  for (const f of flags) assert.ok(linha.includes(f), 'a linha do catalogo.js no GUIA.md nao cita ' + f + ': acrescente');
  const desfechos = require('../scripts/lib/catalogo.js').DESFECHOS;
  assert.ok(Array.isArray(desfechos) && desfechos.length > 0, 'o catalogo.js nao exporta os DESFECHOS: acerte este teste');
  assert.ok(linha.includes(desfechos.join('\\|')), 'a linha do catalogo.js nao lista os desfechos ' + desfechos);
});

test('L4-s106-15/L4-s107-4: o GUIA diz onde o ligar-atualizacao grava e o que fazer quando ele recusa', () => {
  const par = paragrafo('**O `/sworn:init` faz isso por você:**');
  const src = ler('scripts/ligar-atualizacao.js');
  assert.ok(/CLAUDE_CONFIG_DIR/.test(src) && /corrija o JSON/.test(src) && /instale primeiro/.test(src),
    'o scripts/ligar-atualizacao.js mudou a pasta ou as mensagens de recusa: acerte este teste e o paragrafo do GUIA.md');
  assert.ok(par.includes('`CLAUDE_CONFIG_DIR`') && par.includes('`~/.claude/`'),
    'o paragrafo do /sworn:init no GUIA.md nao diz a pasta do settings.json que o script grava');
  assert.ok(/corrija o JSON/.test(par), 'o paragrafo do /sworn:init no GUIA.md nao diz o que fazer quando o JSON esta quebrado');
  assert.ok(/instalar primeiro/.test(par), 'o paragrafo do /sworn:init no GUIA.md nao diz o caso sem o marketplace');
});

test('A5-18/P16-README-r1-2: as linhas da abertura e do abrir-turno dizem o que eles mandam e gravam', () => {
  const abertura = ler('scripts/abertura.js');
  const turno = ler('scripts/abrir-turno.js');
  assert.ok(/ordemDoInit/.test(abertura) && /ordemDoCalibrar/.test(abertura), 'a abertura mudou: acerte este teste');
  assert.ok(/radarOferta/.test(turno) && /pedidos\.registrar/.test(turno) && /volta/.test(turno),
    'o abrir-turno mudou: acerte este teste');
  const linhas = [linhaQueComeca('| a sessão abre, reabre ou compacta |'), linhaQueComeca('| `SessionStart`')];
  for (const l of linhas) {
    assert.ok(l.includes('`/sworn:init`') && l.includes('`/sworn:calibrate`'), 'a linha da abertura nao cita a ordem do init e a do calibrar');
  }
  for (const l of [linhaQueComeca('| você manda um pedido |'), linhaQueComeca('| `UserPromptSubmit`')]) {
    assert.ok(l.includes('`/sworn:radar`'), 'a linha do abrir-turno nao cita a oferta do radar');
    assert.ok(l.includes('`.claude/sworn/pedidos/`'), 'a linha do abrir-turno nao cita a lista de pedidos');
    assert.ok(l.includes('200 mil') && l.includes('`.sworn/handoff/`'), 'a linha do abrir-turno nao cita a volta parada');
  }
});

test('s45-45: o exemplo de cabecalhos e tabela que somam da a conta que o GUIA diz', () => {
  assert.ok(/linhas da tabela somam: `### Etapa 1: \.\.\.` e `### Etapa 2: \.\.\.` com uma tabela de linhas `P0`, `P1` e\s+`2` dão\s+quatro tarefas/
    .test(guia()), 'o exemplo dos cabecalhos e da tabela mudou no GUIA.md: acerte este teste');
  const exemplo = '# Plano\n\n### Etapa 1: um\n\ntexto\n\n### Etapa 2: dois\n\nmais\n\n' +
    '| Etapa | O que |\n|---|---|\n| P0 | a |\n| P1 | b |\n| 2 | resumo do dois |\n';
  const itens = require('../scripts/lib/plano.js').parseItens(exemplo);
  assert.deepStrictEqual(itens.map((t) => t.id), ['1', '2', 'P0', 'P1'],
    'parseItens conta outra coisa no exemplo do GUIA.md: acerte o exemplo');
});

test('A8-25/L6-s108-8/P16-r3-7/P16-r3-10: frases que nao enganam quem le', () => {
  const p = guia();
  assert.ok(!/as três listas vazias/.test(p), 'o padrao de marchas nao e "as três listas vazias": o init propoe as listas');
  assert.ok(/a proposta que o `\/sworn:init` faz/.test(linhaQueComeca('| `marchas` |')),
    'a linha de marchas do GUIA.md nao diz que o padrao e a proposta do /sworn:init, confirmada por voce');
  assert.ok(/em inglês e com estas palavras, `is blocked by enterprise/.test(p), 'a mensagem do /plugin sem o aviso de que e literal');
  assert.ok(!/conta do radar/.test(p), '"conta do radar" e jargao: diga candidatos e para adotar');
  assert.ok(/quantos projetos são candidatos e quantos a ficha propõe adotar/.test(linhaQueComeca('| Vigia (a abertura) |')),
    'a linha do vigia no GUIA.md nao diz o que a abertura conta do radar: candidatos e para adotar');
  const radar = linhaQueComeca('| `/sworn:radar` |');
  assert.ok(/ELv2, que proíbe/.test(radar) && /AGPL, que obriga/.test(radar), 'a linha do radar nao explica ELv2 e AGPL');
  assert.ok(radar.includes('<br>'), 'a linha do radar voltou a ser um paragrafo so');
});
