'use strict';
/**
 * Criterio 7 da secao 10: alguem que nunca viu este projeto entende o README.
 * Isso nao da para testar. O que DA, e o que ja custou caro duas vezes, e que o
 * README nao minta sobre si mesmo.
 *
 * D134, defeito 5: "CHANGELOG com cinco travas, cinco perguntas, oito lentes -
 * os mesmos tres defeitos que o README tinha de manha". Numero escrito por
 * extenso envelhece calado, porque quem acrescenta a nona linha da tabela nao
 * volta ao paragrafo que diz "oito".
 *
 * D134, defeito 6: "plugin.json descrevia 4 portoes de 8 - descricao escrita na
 * T1 e nunca revista".
 *
 * Aqui cada numero que o README escreve sobre si e conferido contra o que o
 * proprio README contem, e cada skill citada e conferida contra o disco.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { MANUAL } = require('../scripts/lib/ordens.js');

const RAIZ = path.join(__dirname, '..');
const README = fs.readFileSync(path.join(RAIZ, 'GUIA.md'), 'utf8');

const NUMEROS = {
  'uma': 1, 'um': 1, 'duas': 2, 'dois': 2, 'tres': 3, 'três': 3, 'quatro': 4,
  'cinco': 5, 'seis': 6, 'sete': 7, 'oito': 8, 'nove': 9, 'dez': 10, 'onze': 11,
  'doze': 12, 'treze': 13, 'quatorze': 14, 'catorze': 14, 'quinze': 15,
  'dezesseis': 16, 'dezessete': 17, 'dezoito': 18, 'dezenove': 19, 'vinte': 20
};

function porExtenso(palavra) {
  const n = NUMEROS[String(palavra).toLowerCase()];
  assert.ok(n !== undefined, 'numero por extenso desconhecido: ' + palavra);
  return n;
}

/** Do cabecalho `## ` que contem `pedaco` ate o `## ` seguinte. */
function secao(pedaco) {
  const linhas = README.split(/\r?\n/);
  let i = linhas.findIndex((l) => /^## /.test(l) && l.indexOf(pedaco) !== -1);
  assert.notStrictEqual(i, -1, 'sumiu a secao que contem: ' + pedaco);
  const titulo = linhas[i];
  const corpo = [];
  for (let j = i + 1; j < linhas.length && !/^## /.test(linhas[j]); j++) corpo.push(linhas[j]);
  return { titulo: titulo, corpo: corpo.join('\n') };
}

/** Linhas de dados de uma tabela markdown: fora o cabecalho e o separador. */
function linhasDeTabela(texto) {
  const linhas = texto.split(/\r?\n/).filter((l) => /^\|/.test(l.trim()));
  return linhas.filter((l) => !/^\|[\s:|-]+\|$/.test(l.trim())).slice(1);
}

function itens(texto) {
  return texto.split(/\r?\n/).filter((l) => /^- /.test(l));
}

// ── os numeros que o README escreve sobre si mesmo ───────────────────────

test('readme: o numero de travas no titulo bate com as linhas da tabela', () => {
  const s = secao('travas');
  const dito = porExtenso(s.titulo.match(/^## As (\S+) travas/)[1]);
  assert.strictEqual(linhasDeTabela(s.corpo).length, dito,
    'o titulo diz ' + dito + ' e a tabela tem outra coisa');
});

test('readme: o numero de comandos no titulo bate com as linhas da tabela', () => {
  const s = secao('comandos');
  const dito = porExtenso(s.titulo.match(/^## Os (\S+) comandos/)[1]);
  assert.strictEqual(linhasDeTabela(s.corpo).length, dito,
    'o titulo diz ' + dito + ' e a tabela tem outra coisa');
  const outros = s.corpo.match(/Os outros (\S+) \*\*não são travas/);
  assert.ok(outros, 'sumiu a frase que conta os comandos que nao sao travas');
  assert.strictEqual(porExtenso(outros[1]), dito - 2,
    'so as travas 1 e 2 sao comandos: os outros sao ' + (dito - 2) + ', e a frase diz ' + outros[1]);
});

test('readme: o numero de promessas negadas bate com a lista', () => {
  const s = secao('NÃO promete');
  const m = s.corpo.match(/Cada uma dessas (\S+)/);
  assert.ok(m, 'sumiu a frase que conta as promessas negadas');
  assert.strictEqual(itens(s.corpo).length, porExtenso(m[1]),
    'a frase conta ' + m[1] + ' e a lista tem ' + itens(s.corpo).length);
});

test('readme: o numero de limites irredutiveis bate com a lista', () => {
  const s = secao('limites');
  const dito = porExtenso(s.titulo.match(/^## Os (\S+) limites/)[1]);
  assert.strictEqual(itens(s.corpo).length, dito,
    'o titulo diz ' + dito + ' limites e a lista tem ' + itens(s.corpo).length);
  const ab = s.corpo.match(/As (\S+) acima são promessas[\s\S]*?Estas (\S+) são outra coisa/);
  assert.ok(ab, 'sumiu a abertura que conta as promessas e os limites');
  assert.strictEqual(porExtenso(ab[2]), dito,
    'a abertura diz ' + ab[2] + ' limites e a lista tem ' + dito);
  const negadas = itens(secao('NÃO promete').corpo).length;
  assert.strictEqual(porExtenso(ab[1]), negadas,
    'a abertura diz ' + ab[1] + ' promessas e a lista tem ' + negadas);
});

// ── o que o README promete existe no disco ───────────────────────────────

/** O frontmatter do SKILL.md da pasta `nome` de `dir`; sem ele, a falha nomeia a pasta (nao o ENOENT cru). */
function frenteDaSkill(dir, nome) {
  let texto;
  try {
    texto = fs.readFileSync(path.join(dir, nome, 'SKILL.md'), 'utf8');
  } catch (e) {
    assert.fail('skills/' + nome + '/ sem SKILL.md legivel (' + e.code + '): crie o SKILL.md ou apague a pasta');
  }
  return texto.replace(/\r\n/g, '\n').split('\n---\n')[0];
}

test('readme: toda skill do disco aparece no README', () => {
  const doDisco = fs.readdirSync(path.join(RAIZ, 'skills'), { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const faltando = doDisco.filter((n) => README.indexOf(n) === -1);
  assert.deepStrictEqual(faltando, [],
    'skill instalada e nao documentada: quem instala paga o contexto dela sem saber o que e');
  // D678 T4: a frase conta o total e as que nao sao comando (o manual e as que a doc tira do menu).
  const ord = README.match(/(\S+) das (\S+) skills instaladas \*\*não são comando\*\*/);
  assert.ok(ord, 'sumiu a frase que conta as skills instaladas');
  assert.strictEqual(porExtenso(ord[2]), doDisco.length,
    'a frase diz ' + ord[2] + ' skills e o disco tem ' + doDisco.length);
  const naoComando = doDisco.filter((n) => MANUAL.test(n) ||
    /^user-invocable:\s*false\s*$/m.test(frenteDaSkill(path.join(RAIZ, 'skills'), n)));
  assert.strictEqual(porExtenso(ord[1]), naoComando.length,
    'a frase diz ' + ord[1] + ' que nao sao comando e o disco tem ' + naoComando.length);
});

test('readme: pasta de skill sem SKILL.md reprova com o nome da pasta, nao com ENOENT cru', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn readme-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'sem-arquivo'));
  assert.throws(() => frenteDaSkill(dir, 'sem-arquivo'),
    (e) => e.code !== 'ENOENT' && /skills\/sem-arquivo\//.test(e.message));
});

test('readme: todo comando citado no README existe como skill ou workflow no disco', () => {
  const doDisco = new Set(fs.readdirSync(path.join(RAIZ, 'skills'), { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name));
  // D449 (0.6.2): workflow do plugin roda como /sworn:<meta.name> (workflows/*.js na raiz do plugin)
  for (const f of fs.readdirSync(path.join(RAIZ, 'workflows')).filter((n) => n.endsWith('.js'))) {
    const nome = fs.readFileSync(path.join(RAIZ, 'workflows', f), 'utf8').match(/^  name: '([a-z-]+)',$/m);
    if (nome) doDisco.add(nome[1]);
  }
  const citados = new Set();
  const re = /sworn:([a-z-]+)/g;
  let m;
  while ((m = re.exec(README)) !== null) citados.add(m[1]);
  assert.ok(citados.size > 0, 'o README nao cita comando nenhum: o parser quebrou');
  const inventados = Array.from(citados).filter((c) => !doDisco.has(c)).sort();
  assert.deepStrictEqual(inventados, [],
    'o README promete comando que nao existe - foi a D134 defeito 6, de novo');
});

test('readme: todo script citado no README existe em scripts/', () => {
  const re = /scripts\/([a-z-]+\.js)/g;
  const citados = new Set();
  let m;
  while ((m = re.exec(README)) !== null) citados.add(m[1]);
  assert.ok(citados.size > 0, 'o README nao cita script nenhum: o parser quebrou');
  const inventados = Array.from(citados)
    .filter((n) => !fs.existsSync(path.join(RAIZ, 'scripts', n))).sort();
  assert.deepStrictEqual(inventados, [], 'o README manda rodar coisa que nao esta la');
});

/**
 * Este e o unico ponto com lista escrita a mao, e e assim de proposito: os seis
 * limites vem da spec, nao do disco - nao ha de onde derivar. O que se confere e
 * que os SEIS ASSUNTOS continuam nomeados, nao a redacao deles.
 */
test('readme: os seis limites sao os seis da spec, por assunto', () => {
  // No titulo em negrito de cada item, e um assunto por item: no corpo inteiro, o
  // limite trocado passava, porque o vizinho tambem diz "harness".
  const titulos = itens(secao('limites').corpo)
    .map((l) => (l.match(/^- \*\*(.+?)\*\*/) || [null, ''])[1].toLowerCase());
  const assuntos = [
    ['custo', /custo|pagar|bolso|dinheiro/],
    ['janela ate o proximo gatilho', /janela|entre o lancamento|intervalo/],
    ['ambiente da outra pessoa', /outra pessoa|sem rede|politica|ambiente/],
    ['campo nao documentado', /documentad|documentou|pode sumir|sem aviso/],
    ['o harness muda', /harness|evento de hook|schema/],
    ['instrucao nao e deterministica', /instru[cç][aã]o|pode ser pulad|determinist/]
  ];
  const faltando = assuntos.filter(([, re]) => titulos.filter((x) => re.test(x)).length !== 1)
    .map(([nome]) => nome);
  assert.deepStrictEqual(faltando, [],
    'limite que sumiu do README volta a ser buraco escondido: ' + faltando.join(', '));
  const usados = new Set(assuntos.map(([, re]) => titulos.findIndex((x) => re.test(x))));
  assert.strictEqual(usados.size, assuntos.length, 'dois assuntos no mesmo limite: um deles sumiu');

  // Decisao 34: agente do plugin que crava modelo no frontmatter e a excecao a
  // regra de nao guardar nome de modelo - e quem instala tem de ler isso aqui.
  const dirAg = path.join(RAIZ, 'agents');
  const frente = (f) => fs.readFileSync(path.join(dirAg, f), 'utf8').split(/^---\s*$/m)[1] || '';
  const comModelo = fs.readdirSync(dirAg).filter((f) => /\.md$/.test(f))
    .filter((f) => /^model:/m.test(frente(f))).map((f) => f.replace(/\.md$/, ''));
  const secaoLimites = secao('limites').corpo;
  assert.strictEqual(/uma exceção, declarada/.test(secaoLimites), comModelo.length > 0,
    'agentes com model: ' + JSON.stringify(comModelo) +
    ' - a excecao declarada tem de existir so se eles existirem');
  comModelo.forEach((n) => assert.ok(secaoLimites.indexOf('`' + n + '`') !== -1,
    'excecao nao nomeada: ' + n));
});

test('readme: o que nao foi testado em outro sistema esta DECLARADO', () => {
  // Na secao dela: a tabela de falhas cita "Linux" por outro motivo, e segurava o teste.
  const sis = secao('sistemas').corpo;
  assert.ok(/(linux|macos|mac os)/i.test(sis),
    'o H6 se fecha declarando; README que nao nomeia os outros sistemas nao declara nada');
  assert.ok(/n[aã]o[^.]{0,24}testad/i.test(sis),
    'falta dizer, com estas palavras, que nao foi testado');
});

// ── o recurso de qualidade de resposta: o README mostra o bloco que a abertura injeta ──

test('readme: o bloco da secao "Qualidade de resposta" e IGUAL a qualidade.BLOCO, e o numero de caracteres e o dele', () => {
  const qualidade = require('../scripts/lib/qualidade.js');
  const s = secao('Qualidade de resposta');
  const blocos = Array.from(s.corpo.matchAll(/^```[^\n]*\n([\s\S]*?)^```[ \t]*$/gm)).map((m) => m[1]);
  assert.strictEqual(blocos.length, 1, 'a secao tem de trazer exatamente um bloco de codigo: o bloco literal');
  assert.strictEqual(blocos[0], qualidade.BLOCO,
    'o bloco do README diverge do que a abertura injeta: foi copiado a mao, ou o texto mudou so de um lado');
  const numeros = Array.from(s.corpo.matchAll(/(\d+) caracteres/g)).map((m) => Number(m[1]));
  assert.deepStrictEqual(numeros, [qualidade.BLOCO.length],
    'a secao cita ' + JSON.stringify(numeros) + ' caracteres e o bloco tem ' + qualidade.BLOCO.length);
});

// ── T10-6 (D357): o aviso de troca de chat - o que dispara, o que nao, e como conferir ──

test('readme: cada gatilho de saude aparece com a chave de limiares e o valor padrao que o codigo tem', () => {
  const saude = require('../scripts/lib/saude.js');
  const s = secao('Como funciona').corpo;
  const faltando = [];
  for (const chave of Object.keys(saude.LIMIARES_PADRAO)) {
    const valor = saude.LIMIARES_PADRAO[chave];
    const linha = s.split(/\r?\n/).filter((l) => /^\|/.test(l.trim()) && l.indexOf('`' + chave + '`') !== -1)[0];
    if (!linha) { faltando.push(chave + ': sem linha de tabela com a chave'); continue; }
    if (!new RegExp('\\|\\s*' + valor + '\\s*\\|').test(linha)) faltando.push(chave + ': a linha nao traz o padrao ' + valor);
  }
  assert.deepStrictEqual(faltando, [], 'o README diverge dos limiares padrao de scripts/lib/saude.js');
});

test('readme: diz o que NAO dispara, como conferir os ganchos e de que o gatilho de commit depende', () => {
  const s = secao('Como funciona').corpo;
  assert.ok(/n[aã]o (?:se )?(?:conta|contam|dispara)[^.]*(?:erro|inflação|inflacao)/i.test(s) ||
    /(?:erro de medição|inflação de contexto)/.test(s), 'falta dizer o que o aviso NAO conta');
  assert.ok(s.indexOf('sworn: lendo o estado do repositorio') !== -1, 'falta o texto da abertura que prova que os ganchos rodam');
  assert.ok(/`node`[^.\n]*PATH|PATH[^.\n]*`node`/.test(README), 'falta dizer que o node tem de estar no PATH');
  assert.ok(s.indexOf('gitOperation') !== -1 && s.indexOf('2.1.258') !== -1,
    'falta declarar a dependencia do gitOperation e a versao do Claude Code em que foi medida');
});

// D484 (V1 da triagem s106): "os outros cinco gatilhos" ficou para tras quando a tabela cresceu (sao 7 alem do
// commit). O numero por extenso tem de seguir os limiares do codigo, menos o proprio commit.
test('D484: "os outros N gatilhos" do paragrafo do commit bate com os limiares do codigo', () => {
  const saude = require('../scripts/lib/saude.js');
  const POR_EXTENSO = ['zero', 'um', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez'];
  const s = secao('Como funciona').corpo.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const m = s.match(/os outros (\w+) gatilhos/);
  assert.ok(m, 'sumiu a frase "os outros N gatilhos" do paragrafo do commit');
  const esperado = Object.keys(saude.LIMIARES_PADRAO).filter((k) => k !== 'commits').length;
  assert.strictEqual(POR_EXTENSO.indexOf(m[1]), esperado,
    'o README diz "os outros ' + m[1] + ' gatilhos" e o codigo tem ' + esperado + ' alem do commit');
});

test('readme: ensina a atualizacao automatica pelo settings.json, porque o painel do VS Code nao tem o botao (D346)', () => {
  const s = secao('Como instalar').corpo;
  assert.ok(s.indexOf('extraKnownMarketplaces') !== -1 && s.indexOf('autoUpdate') !== -1 &&
    s.indexOf('settings.json') !== -1, 'falta o caminho pelo settings.json');
  assert.ok(/VS Code/.test(s), 'falta dizer que o painel do VS Code nao tem o botao');
  assert.ok(/"sworn-local"\s*:\s*\{[\s\S]*?"autoUpdate"\s*:\s*true/.test(s), 'falta o trecho literal do settings.json');
});

// D442/3 (M-8, M-10, M-11, M-13): o paragrafo dos comandos de mod nao dizia que a forma com dois-pontos nao
// existe, nem a 3a causa de o comando faltar (o plugin antigo), nem o que /sworn-plan responde sem plano
// (o dono achou que o plano "nao apareceu", s70).
test('D442/3: o paragrafo dos mods diz o efeito dos dois-pontos, a causa plugin antigo e o painel sem plano', () => {
  const i = README.indexOf('**Ver os números a qualquer hora:**');
  assert.ok(i !== -1, 'sumiu o paragrafo dos mods');
  const p = README.slice(i, README.indexOf('\n\n', i));
  assert.ok(/dois-pontos[^.]*n[aã]o existe/.test(p), 'falta dizer que a forma com dois-pontos nao existe');
  assert.ok(p.indexOf('claude plugin update sworn@sworn-local') !== -1, 'falta a causa plugin antigo, com o comando');
  assert.ok(p.indexOf('nenhum plano ativo') !== -1 && p.indexOf('--abrir') !== -1, 'falta o que o painel diz sem plano e como abrir');
});

// D499 (censo da s37): o README cobre tudo o que o plugin instala. A lista sai do disco, entao o item novo que
// chega sem README reprova aqui, sem ninguem lembrar de acrescentar.
function faltamNoReadme(termos) {
  return termos.filter((t) => README.indexOf(t) === -1);
}
function nomes(pasta, ext) {
  return fs.readdirSync(path.join(RAIZ, pasta)).filter((f) => !ext || f.endsWith(ext));
}

test('D499: o README cita cada skill, o workflow, cada agente, cada evento de gancho e cada painel', () => {
  const skills = nomes('skills').map((s) => (s === 'playbook' ? '`playbook`' : 'sworn:' + s));
  const workflows = nomes('workflows', '.js').map((w) => 'sworn:' + w.replace(/\.js$/, ''));
  const agentes = nomes('agents', '.md').map((a) => a.replace(/\.md$/, ''));
  const eventos = Object.keys(JSON.parse(fs.readFileSync(path.join(RAIZ, 'hooks', 'hooks.json'), 'utf8')).hooks);
  const mods = fs.readFileSync(path.join(RAIZ, 'hooks', 'mods.tsx'), 'utf8');
  const paineis = Array.from(mods.matchAll(/name: '([^']+)'/g)).map((m) => '/' + m[1]);
  assert.ok(paineis.length > 0, 'o leitor do mods.tsx nao achou painel: mudou a forma do register?');
  assert.deepStrictEqual(faltamNoReadme(skills.concat(workflows, agentes, eventos, paineis)), []);
});

test('D499: o README cita cada script de scripts/', () => {
  assert.deepStrictEqual(faltamNoReadme(nomes('scripts', '.js')), []);
});

test('D499: o README cita cada chave do projeto.json e cada trava', () => {
  const projeto = require(path.join(RAIZ, 'scripts', 'lib', 'projeto.js'));
  // D503: as opcionais (`referencias`) tambem. A lista tem de existir: concat de undefined poria "undefined" na
  // conta, e o README o cita (README:451) - o teste passaria sem a chave.
  assert.ok(Array.isArray(projeto.CHAVES_OPCIONAIS), 'projeto.js nao exporta CHAVES_OPCIONAIS');
  const chaves = projeto.CHAVES.concat(projeto.CHAVES_LIGA_DESLIGA, projeto.CHAVES_OPCIONAIS);
  assert.ok(chaves.length >= 24 && projeto.TRAVAS.length >= 4, 'projeto.js exporta menos chaves que o censo da s47 (15 + 8 + 1 e 4 travas)');
  // A chave entre crases inteira (`vigia` nao casa `vigia-puxar.js`); a trava pelo caminho (`travas.escopo`, nao `escopo.md`).
  const faltam = chaves.filter((c) => README.indexOf('`' + c + '`') === -1 && README.indexOf('"' + c + '"') === -1)
    .concat(projeto.TRAVAS.filter((t) => README.indexOf('travas.' + t) === -1).map((t) => 'travas.' + t));
  assert.deepStrictEqual(faltam, []);
});

test('D499: o README cita cada arquivo de modelos/ e cada referencia do padrao', () => {
  assert.deepStrictEqual(faltamNoReadme(nomes('modelos').concat(nomes(path.join('skills', 'playbook', 'references')))), []);
});

test('D499 (D497/D498): o README conta a parte visual', () => {
  assert.deepStrictEqual(faltamNoReadme([
    'lentes de tela', 'escolha visual', 'página Artifact', 'só dado fictício', 'catálogo de estados', 'INP',
    '200 ms', '500 ms', '24 × 24', '2.5.8', 'antes × depois', '5 usuários', 'DESIGN.md', 'design.json',
    'contraste', 'claro e escuro', 'celular'
  ]), []);
});
