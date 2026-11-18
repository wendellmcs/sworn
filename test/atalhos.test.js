'use strict';
// Plano 090 Tarefa 5: /sworn:shortcuts. O alvo do texto e o mock aprovado (prints-090/mock-090.png, secao 3, D554).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const atalhos = require('../scripts/lib/atalhos.js');

const RAIZ = path.join(__dirname, '..');
const PADRAO = ['atalho', 'ponytail', 'shortcut'];

// A6-55: a linha sozinha, pelo caminho do painel (varrer), sem linha de baixo: { oque, limite, gatilho } ou null.
// Uma linha da no maximo um achado, e sem linha de baixo nada fica cortado: o que sobrar disso reprova aqui.
function umaLinha(linha, lista) {
  const achados = atalhos.varrer(['x'], function () { return linha; }, lista);
  assert.ok(achados.length <= 1, 'mais de um achado numa linha: ' + JSON.stringify(achados));
  const a = achados[0];
  if (!a) return null;
  assert.deepStrictEqual(Object.keys(a).sort(), ['arquivo', 'gatilho', 'limite', 'linha', 'oque'], linha);
  return { oque: a.oque, limite: a.limite, gatilho: a.gatilho };
}

test('marcas: padrao atalho, ponytail, shortcut; marcaDeAtalho troca so a primeira', () => {
  assert.deepStrictEqual(atalhos.marcas(null), PADRAO);
  assert.deepStrictEqual(atalhos.marcas({}), PADRAO);
  assert.deepStrictEqual(atalhos.marcas({ marcaDeAtalho: 'divida' }), ['divida', 'ponytail', 'shortcut']);
  assert.deepStrictEqual(atalhos.marcas({ marcaDeAtalho: 'shortcut' }), ['shortcut', 'ponytail'], 'sem repetir');
  for (const torta of ['', 'duas palavras', 'a:b', 7, null, ['x']]) {
    assert.deepStrictEqual(atalhos.marcas({ marcaDeAtalho: torta }), PADRAO, JSON.stringify(torta));
  }
});

test('varrer, uma linha: os tres rotulos, em cada prefixo de comentario', () => {
  const esperado = { oque: 'preço fixo do Opus em vez de ler a tabela.', limite: 'só Opus 5.5.',
    gatilho: 'entrar outro modelo na tabela.' };
  const corpo = 'atalho: preço fixo do Opus em vez de ler a tabela. limite: só Opus 5.5. trocar quando: entrar outro modelo na tabela.';
  for (const linha of ['// ' + corpo, '# ' + corpo, '-- ' + corpo, '/* ' + corpo + ' */', '<!-- ' + corpo + ' -->',
    '  const x = 1; // ' + corpo, '\t# ' + corpo, '//' + corpo]) {
    assert.deepStrictEqual(umaLinha(linha, PADRAO), esperado, linha);
  }
});

// A6-14: o /** deixava o '*' na frente da marca, e a marca depois de um primeiro prefixo que nao era o dela sumia
test('A6-14: a marca depois de /** e a do comentario seguinte da mesma linha sao achadas', () => {
  const esperado = { oque: 'x.', limite: 'y.', gatilho: 'z.' };
  const corpo = 'atalho: x. limite: y. trocar quando: z.';
  for (const linha of ['/** ' + corpo + ' */', '  /**' + corpo + ' */', 'a = b -- c  # ' + corpo, 'x = 1 # nota // ' + corpo,
    '/* sem marca */ // ' + corpo]) {
    assert.deepStrictEqual(umaLinha(linha, PADRAO), esperado, linha);
  }
  // so comentario sem marca, ou a marca dentro de string depois do comentario, segue sem atalho
  assert.strictEqual(umaLinha('/** so doc */', PADRAO), null);
  assert.strictEqual(umaLinha('// nota "# atalho: x"', PADRAO), null);
});

// o /* dentro de um // nao abre bloco: a linha de baixo sem prefixo e codigo e fica fora da nota
test('A6-14: o /* dentro de // nao abre bloco, e a linha de baixo sem prefixo nao entra na nota', () => {
  const achados = atalhos.varrer(['x.js'], function () { return '// ver /* atalho: a.\nlimite: b.\n'; }, PADRAO);
  assert.deepStrictEqual(achados.map((a) => [a.oque, a.limite]), [['a.', null]]);
});

// so o `//` engole o resto da linha: o `#` de titulo, o `--` de variavel CSS e o `/* x */` ja fechado nao
test('A6-14: o bloco aberto depois de #, -- ou de um /* x */ fechado segue na linha de baixo', () => {
  for (const linha of ['# Titulo <!-- atalho: a.\nlimite: b. -->\n', '  --cor: red; /* atalho: a.\n   limite: b. */\n',
    '/* x */ /* atalho: a.\n   limite: b. */\n', '<!-- ver // aqui --> <!-- atalho: a.\nlimite: b. -->\n',
    '/* a // b */ /* atalho: a.\n   limite: b. */\n', '/* a // b /* atalho: a.\n   limite: b. */\n']) {
    const achados = atalhos.varrer(['x.css'], function () { return linha; }, PADRAO);
    assert.deepStrictEqual(achados.map((a) => [a.oque, a.limite]), [['a.', 'b.']], linha);
  }
});

test('varrer, uma linha: sem rotulo vira so o "o que", sem limite e sem gatilho', () => {
  assert.deepStrictEqual(umaLinha('// atalho: pausa medida pelo relogio, vale um fuso', PADRAO),
    { oque: 'pausa medida pelo relogio, vale um fuso', limite: null, gatilho: null });
  assert.deepStrictEqual(umaLinha('# ponytail: x. limite: y.', PADRAO), { oque: 'x.', limite: 'y.', gatilho: null });
  assert.deepStrictEqual(umaLinha('# shortcut: z. trocar quando: w.', PADRAO), { oque: 'z.', limite: null, gatilho: 'w.' });
});

// revisao D688 R3 (correcao, D690): o gatilho era cortado primeiro e levava junto o limite escrito depois dele
test('varrer, uma linha: rotulos em qualquer ordem, um sem o texto do outro', () => {
  assert.deepStrictEqual(umaLinha('// atalho: a. trocar quando: b. limite: c.', PADRAO),
    { oque: 'a.', limite: 'c.', gatilho: 'b.' });
});

test('varrer, uma linha: fora de comentario, dentro de string ou marca colada nao conta', () => {
  for (const linha of [
    'texto comum atalho: x',
    'atalho: x',
    "const s = '// atalho: x';",
    'const s = "# atalho: x";',
    'const s = `-- atalho: x`;',
    // com espaco antes do prefixo: so a string que fecha depois dele segura (mutacao: sem pular a string, passavam)
    "const s = 'veja // atalho: x';",
    'const s = "texto # atalho: x";',
    'f(`a -- atalho: x`)',
    // a marca e minuscula: "Atalho:" e palavra comum (tools/lib/dependencias-modal.mjs:360 da extensao)
    '// Atalho: so os livres, como Map(nome -> { linhas, escrito }).',
    '# SHORTCUT: x',
    'veja http://atalho: x',
    '// atalhos: x',
    '// o atalho: x',
    '// atalho x',
    ''
  ]) {
    assert.strictEqual(umaLinha(linha, PADRAO), null, linha);
  }
  assert.strictEqual(umaLinha('// divida: x', ['divida']).oque, 'x', 'marca configurada');
  assert.strictEqual(umaLinha('// atalho: x', ['divida']), null, 'so a marca da lista');
});

// A6-54: a aspa se le da esquerda, com escape e apostrofo; a contagem por paridade perdia estes comentarios
test('varrer, uma linha: aspa escapada, apostrofo, aspa dentro de outra e prefixo dentro de string antes do comentario', () => {
  for (const linha of [
    'const s = "a \\" b"; // atalho: x',
    "const s = 'a \\' b'; // atalho: x",
    'const s = "a \\\\"; // atalho: x',
    "Don't touch <!-- atalho: x -->",
    "it's # atalho: x",
    "the users' notes <!-- atalho: x -->",
    // a aspa que nao fecha na linha e texto: o apostrofo depois de uma letra so (I'm, d'agua)
    "I'm done here <!-- atalho: x -->",
    "d'água # atalho: x",
    // o apostrofo de don't nao abre string; a string 'a # b' depois dele fecha e o comentario vem depois
    "Don't use 'a # b' here // atalho: x",
    "the users' list 'a # b' // atalho: x",
    // o apostrofo de uma contracao nao fecha a string: 'it's # b' fecha so no fim (revisao, ronda 3)
    "x = 'it's # b' // atalho: x",
    // a aspa depois de espaco fecha, mesmo com letra colada depois dela
    "x = ' # 'b // atalho: x",
    // so a mesma aspa fecha: a ' solta dentro da " nao fecha nada
    'const s = "a \' # b"; // atalho: x',
    'const s = "it\'s"; // atalho: x',
    "const s = 'diz \"oi\"'; // atalho: x",
    'const s = "a # b"; // atalho: x',
    "s = f'x' # atalho: x"
  ]) {
    assert.deepStrictEqual(umaLinha(linha, PADRAO), { oque: 'x', limite: null, gatilho: null }, linha);
  }
  // a aspa sem par do I'm nao fecha no apostrofo do don't, dentro do comentario (revisao, ronda 3)
  assert.deepStrictEqual(umaLinha("I'm done <!-- atalho: don't cache. trocar quando: y. -->", PADRAO),
    { oque: "don't cache.", limite: null, gatilho: 'y.' });
  for (const linha of [
    'const s = "a \\" // atalho: x";',
    "s = f'veja # atalho: x'",
    "x = a 'veja # atalho: x'",
    'const s = "it\'s // atalho: x";',
    "const s = 'a' + 'b // atalho: x';",
    's = """doc # atalho: x"""'
  ]) {
    assert.strictEqual(umaLinha(linha, PADRAO), null, linha);
  }
});

// A6-54 (revisao): a linha se le uma vez; reler do comeco a cada prefixo custava o quadrado do tamanho dela
test('varrer, uma linha: linha longa com muito prefixo e aspa sem fecho termina rapido', { timeout: 10000 }, () => {
  const longa = '"' + ' #'.repeat(300000);
  const aspas = "'a' ".repeat(100000) + '// atalho: x';
  // a aspa sem fecho e as iguais depois dela, todas escapadas: cada uma relida ate o fim seria o quadrado de novo
  const escapadas = '"' + '\\"'.repeat(150000) + ' // atalho: x';
  const inicio = Date.now();
  assert.strictEqual(umaLinha(longa, PADRAO), null);
  assert.deepStrictEqual(umaLinha(aspas, PADRAO), { oque: 'x', limite: null, gatilho: null });
  assert.deepStrictEqual(umaLinha(escapadas, PADRAO), { oque: 'x', limite: null, gatilho: null });
  assert.ok(Date.now() - inicio < 5000, 'levou ' + (Date.now() - inicio) + ' ms');
});

test('varrer: linha comecando em 1, pula binario e arquivo que nao leu', () => {
  const conteudo = {
    'b.js': 'a\n// atalho: um. limite: dois. trocar quando: tres.\r\nc\n',
    'a.sh': '# shortcut: quatro\n',
    'bin.dat': 'x\u0000\n// atalho: nao\n',
    'sumiu.js': null
  };
  const achados = atalhos.varrer(Object.keys(conteudo), (a) => conteudo[a], PADRAO);
  assert.deepStrictEqual(achados, [
    { arquivo: 'b.js', linha: 2, oque: 'um.', limite: 'dois.', gatilho: 'tres.' },
    { arquivo: 'a.sh', linha: 1, oque: 'quatro', limite: null, gatilho: null }
  ]);
});

// A6 (s220, borda :148): arquivo so com CR (Mac antigo) virava uma linha so; a marca do meio saia na linha 1, e a
// continuacao da linha de baixo nao entrava.
test('A6: varrer quebra linha tambem no CR puro', () => {
  const conteudo = { 'cr.js': 'a();\r// atalho: um. limite: dois.\r// trocar quando: tres.\rc();\r' };
  assert.deepStrictEqual(atalhos.varrer(['cr.js'], (a) => conteudo[a], PADRAO),
    [{ arquivo: 'cr.js', linha: 2, oque: 'um.', limite: 'dois.', gatilho: 'tres.' }]);
});

// D687: 4 dos 5 atalhos do proprio repositorio quebravam o comentario em 2 linhas (scripts/abertura.js:68,
// scripts/lib/custo.js:21, scripts/lib/obrigacoes.js:411, test/fiacao.test.js:247) e saiam sem gatilho ou cortados.
test('varrer: a linha de baixo que abre com rotulo ainda nao usado entra, na linha da marca', () => {
  const conteudo = {
    // linha de baixo que abre com rotulo (custo.js:21)
    'rotulo.js': '// atalho: a. limite: b.\n// trocar quando: c.\nif (x) y();\n',
    // tres linhas, um rotulo em cada uma de baixo, em CRLF e com #
    'tres.sh': '# atalho: a sem ponto\r\n# limite: b.\r\n# trocar quando: c.\r\necho\r\n',
    // a linha com rotulo entra mesmo sem fechar a frase
    'rotulo-sem-ponto.js': '// atalho: a.\n// trocar quando: b sem ponto\nx();\n',
    // o rotulo nao diferencia caixa, como na linha da marca
    'caixa.js': '// atalho: a.\n// Trocar quando: b.\n',
    // o rotulo repetido conta pelo que ja entrou, nao so pela linha da marca
    'repetido-depois.js': '// atalho: a.\n// limite: b.\n// limite: c.\n',
    // revisao D688 R3 (correcao, D690): rotulos em ordem trocada, um por linha
    'ordem.js': '// atalho: cache simples.\n// trocar quando: crescer.\n// limite: 100 itens.\n',
    // dentro de bloco aberto, a linha de baixo e comentario com ou sem ` * ` na frente, ate o fecho
    'bloco.js': '/* atalho: cache em memoria.\n * limite: 100 itens.\n * trocar quando: crescer. */\nx();\n',
    'bloco-sem-asterisco.js': '/* atalho: a.\n   trocar quando: b.\n*/\n',
    'bloco-recuo.js': '/* atalho: a.\n *   limite: b.\n */\n',
    'bloco.md': '<!-- atalho: a.\nlimite: b.\n-->\n',
    'bloco-fechado.js': '/* atalho: a sem ponto\n */\n// trocar quando: z.\n'
  };
  assert.deepStrictEqual(atalhos.varrer(Object.keys(conteudo), (a) => conteudo[a], PADRAO), [
    { arquivo: 'rotulo.js', linha: 1, oque: 'a.', limite: 'b.', gatilho: 'c.' },
    { arquivo: 'tres.sh', linha: 1, oque: 'a sem ponto', limite: 'b.', gatilho: 'c.' },
    { arquivo: 'rotulo-sem-ponto.js', linha: 1, oque: 'a.', limite: null, gatilho: 'b sem ponto' },
    { arquivo: 'caixa.js', linha: 1, oque: 'a.', limite: null, gatilho: 'b.' },
    { arquivo: 'repetido-depois.js', linha: 1, oque: 'a.', limite: 'b.', gatilho: null },
    { arquivo: 'ordem.js', linha: 1, oque: 'cache simples.', limite: '100 itens.', gatilho: 'crescer.' },
    { arquivo: 'bloco.js', linha: 1, oque: 'cache em memoria.', limite: '100 itens.', gatilho: 'crescer.' },
    { arquivo: 'bloco-sem-asterisco.js', linha: 1, oque: 'a.', limite: null, gatilho: 'b.' },
    { arquivo: 'bloco-recuo.js', linha: 1, oque: 'a.', limite: 'b.', gatilho: null },
    { arquivo: 'bloco.md', linha: 1, oque: 'a.', limite: 'b.', gatilho: null },
    { arquivo: 'bloco-fechado.js', linha: 1, oque: 'a sem ponto', limite: null, gatilho: null }
  ]);
});

// D689: nenhuma regra de texto separa a quebra da frase de cima de um comentario alheio logo abaixo (as revisoes D688
// R1 e R2 acharam P1 nos dois sentidos). A linha sem rotulo fica de fora, e o achado avisa quando a nota acaba sem
// ponto final com um comentario desses logo abaixo.
test('varrer: frase sem ponto final com comentario sem rotulo logo abaixo fica de fora e avisa', () => {
  const conteudo = {
    // as quebras reais de antes da D689: abertura.js:68 (limite) e obrigacoes.js:411 (gatilho, CRLF e #)
    'quebra.js': '  // atalho: a. limite: b sem ponto\n  // (fim de b). trocar quando: c.\n  const x = 1;\n',
    'cortado.sh': '# atalho: a. trocar quando: c sem ponto\r\n# d e\r\n# f.\r\necho\r\n',
    'sem-rotulo-quebra.js': '// atalho: caminho sem caixa em\n// qualquer sistema. limite: um. trocar quando: dois.\n',
    // revisao D688 R2 (correcao): alheio em minuscula e quebra real em maiuscula, os dois de fora
    'alheio-minuscula.js': '// atalho: cache. limite: até 10 itens\n// retorna o valor.\nx();\n',
    'quebra-maiuscula.js': '// atalho: x. limite: só vale no\n// Windows e no Linux.\n',
    // revisoes D687 e D688 R1 (correcao): comentario alheio no "o que", no limite e no gatilho
    'alheio.js': '// atalho: cache simples em memoria\n// TODO: revisar o parser\nx();\n',
    'alheio-ponto.js': '// atalho: cache simples em memoria\n// helper de leitura.\n// trocar quando: z.\n',
    'alheio-maiuscula.js': '// atalho: cache. limite: 100 itens\n// Retorna o valor.\nx();\n',
    'gatilho-alheio.sh': '# atalho: x. trocar quando: o volume crescer\n# helper de leitura\necho\n',
    // o aviso olha a nota inteira, depois das linhas de rotulo que entraram
    'depois-do-rotulo.js': '// atalho: a.\n// trocar quando: b sem ponto\n// c.\n',
    // e vale com o comentario de baixo acabando no fim do arquivo ou antes de um vazio
    'sem-fecho-fim.js': '// atalho: a sem ponto\n// b sem ponto',
    'sem-fecho-vazio.js': '// atalho: a sem ponto\n// b sem ponto\n//\n// c.\n'
  };
  const avisa = { talvezCortado: true };
  assert.deepStrictEqual(atalhos.varrer(Object.keys(conteudo), (a) => conteudo[a], PADRAO), [
    { arquivo: 'quebra.js', linha: 1, oque: 'a.', limite: 'b sem ponto', gatilho: null, ...avisa },
    { arquivo: 'cortado.sh', linha: 1, oque: 'a.', limite: null, gatilho: 'c sem ponto', ...avisa },
    { arquivo: 'sem-rotulo-quebra.js', linha: 1, oque: 'caminho sem caixa em', limite: null, gatilho: null, ...avisa },
    { arquivo: 'alheio-minuscula.js', linha: 1, oque: 'cache.', limite: 'até 10 itens', gatilho: null, ...avisa },
    { arquivo: 'quebra-maiuscula.js', linha: 1, oque: 'x.', limite: 'só vale no', gatilho: null, ...avisa },
    { arquivo: 'alheio.js', linha: 1, oque: 'cache simples em memoria', limite: null, gatilho: null, ...avisa },
    { arquivo: 'alheio-ponto.js', linha: 1, oque: 'cache simples em memoria', limite: null, gatilho: null, ...avisa },
    { arquivo: 'alheio-maiuscula.js', linha: 1, oque: 'cache.', limite: '100 itens', gatilho: null, ...avisa },
    { arquivo: 'gatilho-alheio.sh', linha: 1, oque: 'x.', limite: null, gatilho: 'o volume crescer', ...avisa },
    { arquivo: 'depois-do-rotulo.js', linha: 1, oque: 'a.', limite: null, gatilho: 'b sem ponto', ...avisa },
    { arquivo: 'sem-fecho-fim.js', linha: 1, oque: 'a sem ponto', limite: null, gatilho: null, ...avisa },
    { arquivo: 'sem-fecho-vazio.js', linha: 1, oque: 'a sem ponto', limite: null, gatilho: null, ...avisa }
  ]);
});

test('varrer: frase fechada, codigo, comentario vazio, marca nova ou rotulo repetido param a continuacao sem aviso', () => {
  const conteudo = {
    // frase fechada e linha de baixo sem rotulo: outro comentario
    'fechada.js': '// atalho: a. limite: b. trocar quando: c.\n// Outra coisa sem ponto\n',
    'sem-gatilho.js': '// atalho: pausa.\n// comentario seguinte\n',
    // comentario no fim de linha de codigo nao e continuacao
    'codigo.js': '// atalho: a sem ponto\nconst y = 2; // trocar quando: z.\n',
    // comentario vazio separa
    'vazio.js': '// atalho: a sem ponto\n//\n// trocar quando: z.\n',
    // marca nova na linha de baixo: dois atalhos, nenhum emenda no outro
    'dois.js': '// atalho: a sem ponto\n// atalho: b. trocar quando: c.\n',
    // aspa: a linha de baixo e codigo, nao comentario
    'aspa.js': '// atalho: a sem ponto\n"// trocar quando: z."\n',
    // rotulo repetido abre outra nota (scripts/lib/ordens.js:88-89)
    'repetido.js': '// atalho: a. trocar quando: b.\n// trocar quando: c.\n',
    // o fecho da frase e o rotulo usado contam pelo que ja foi juntado, nao so pela linha da marca
    'acumula.js': '// atalho: a sem ponto\n// trocar quando: b.\n// Outra coisa.\n// trocar quando: c.\n',
    // comentario fechado na linha da marca nao continua
    'fechado.md': '<!-- atalho: a sem ponto -->\n# Titulo\n/* atalho: d sem ponto */\n// trocar quando: z.\n',
    // nem o que fecha numa linha de baixo ja juntada
    'fechado-embaixo.md': '<!-- atalho: a sem ponto\nlimite: b -->\ntrocar quando: z.\n',
    // frase fechada com comentario em minuscula logo abaixo, e rotulo no meio da linha de baixo
    'fechada-minuscula.js': '// atalho: a. trocar quando: b.\n// outra coisa.\n',
    'rotulo-no-meio.js': '// atalho: a.\n// outra coisa. limite: b.\n'
  };
  assert.deepStrictEqual(atalhos.varrer(Object.keys(conteudo), (a) => conteudo[a], PADRAO), [
    { arquivo: 'fechada.js', linha: 1, oque: 'a.', limite: 'b.', gatilho: 'c.' },
    { arquivo: 'sem-gatilho.js', linha: 1, oque: 'pausa.', limite: null, gatilho: null },
    { arquivo: 'codigo.js', linha: 1, oque: 'a sem ponto', limite: null, gatilho: null },
    { arquivo: 'vazio.js', linha: 1, oque: 'a sem ponto', limite: null, gatilho: null },
    { arquivo: 'dois.js', linha: 1, oque: 'a sem ponto', limite: null, gatilho: null },
    { arquivo: 'dois.js', linha: 2, oque: 'b.', limite: null, gatilho: 'c.' },
    { arquivo: 'aspa.js', linha: 1, oque: 'a sem ponto', limite: null, gatilho: null },
    { arquivo: 'repetido.js', linha: 1, oque: 'a.', limite: null, gatilho: 'b.' },
    { arquivo: 'acumula.js', linha: 1, oque: 'a sem ponto', limite: null, gatilho: 'b.' },
    { arquivo: 'fechado.md', linha: 1, oque: 'a sem ponto', limite: null, gatilho: null },
    { arquivo: 'fechado.md', linha: 3, oque: 'd sem ponto', limite: null, gatilho: null },
    { arquivo: 'fechado-embaixo.md', linha: 1, oque: 'a sem ponto', limite: 'b', gatilho: null },
    { arquivo: 'fechada-minuscula.js', linha: 1, oque: 'a.', limite: null, gatilho: 'b.' },
    { arquivo: 'rotulo-no-meio.js', linha: 1, oque: 'a.', limite: null, gatilho: null }
  ]);
});

const GASTO = [
  { arquivo: 'scripts/lib/gasto.js', linha: 118, oque: 'soma em memória, sem leitura por partes.',
    limite: 'transcrição de até 50 MB.', gatilho: 'aparecer transcrição maior.' },
  { arquivo: 'scripts/lib/gasto.js', linha: 42, oque: 'preço fixo do Opus em vez de ler a tabela.',
    limite: 'só Opus 5.5.', gatilho: 'entrar outro modelo na tabela.' }
];

test('painel: todos com gatilho (mock coluna 1), ordem por linha', () => {
  assert.strictEqual(atalhos.painel(GASTO, 245, PADRAO), [
    'Atalhos registrados (marca: atalho, ponytail, shortcut)',
    '',
    'scripts/lib/gasto.js',
    '  :42  preço fixo do Opus em vez de ler a tabela.',
    '       limite: só Opus 5.5.',
    '       trocar quando: entrar outro modelo na tabela.',
    '  :118 soma em memória, sem leitura por partes.',
    '       limite: transcrição de até 50 MB.',
    '       trocar quando: aparecer transcrição maior.',
    '',
    '2 atalhos em 1 arquivo; todos com "trocar quando".'
  ].join('\n'));
});

test('painel: com sem-gatilho (mock coluna 2), arquivos em ordem alfabetica', () => {
  const achados = [GASTO[1], { arquivo: 'scripts/abrir-turno.js', linha: 77, oque: 'pausa medida pelo relógio do PC.',
    limite: 'um fuso só.', gatilho: null }];
  assert.strictEqual(atalhos.painel(achados, 245, PADRAO), [
    'Atalhos registrados (marca: atalho, ponytail, shortcut)',
    '',
    'scripts/abrir-turno.js',
    '  :77  pausa medida pelo relógio do PC.',
    '       limite: um fuso só.',
    '       sem "trocar quando"',
    'scripts/lib/gasto.js',
    '  :42  preço fixo do Opus em vez de ler a tabela.',
    '       limite: só Opus 5.5.',
    '       trocar quando: entrar outro modelo na tabela.',
    '',
    '2 atalhos em 2 arquivos; 1 sem "trocar quando".',
    'Sem "trocar quando", ninguém lembra de trocar o atalho: escreva "trocar quando: ..." no comentário.'
  ].join('\n'));
});

test('painel: frase sem ponto final com a linha de baixo de fora avisa no atalho e diz o que fazer (D689)', () => {
  const achados = [
    { arquivo: 'scripts/lib/obrigacoes.js', linha: 411, oque: 'D-1 passa como citacao.',
      limite: 'o regex nao sabe se a decisao existe.', gatilho: 'o FORA puder', talvezCortado: true },
    { arquivo: 'scripts/abertura.js', linha: 68, oque: 'caminho comparado sem caixa em qualquer sistema.',
      limite: 'dois nomes so diferentes na caixa contam como um', gatilho: null, talvezCortado: true }
  ];
  assert.strictEqual(atalhos.painel(achados, 245, PADRAO), [
    'Atalhos registrados (marca: atalho, ponytail, shortcut)',
    '',
    'scripts/abertura.js',
    '  :68  caminho comparado sem caixa em qualquer sistema.',
    '       limite: dois nomes so diferentes na caixa contam como um',
    '       sem "trocar quando"',
    '       sem ponto final: a linha de baixo ficou de fora',
    'scripts/lib/obrigacoes.js',
    '  :411 D-1 passa como citacao.',
    '       limite: o regex nao sabe se a decisao existe.',
    '       trocar quando: o FORA puder',
    '       sem ponto final: a linha de baixo ficou de fora',
    '',
    '2 atalhos em 2 arquivos; 1 sem "trocar quando".',
    'Sem "trocar quando", ninguém lembra de trocar o atalho: escreva "trocar quando: ..." no comentário.',
    'Sem ponto final: só entra a linha de baixo que começa com "limite:" ou "trocar quando:". Termine a frase na ' +
      'mesma linha ou comece a de baixo com o rótulo.'
  ].join('\n'));
});

test('painel: singular, sem limite, e linha longa alarga a coluna', () => {
  const p = atalhos.painel([{ arquivo: 'x.js', linha: 12345, oque: 'a', limite: null, gatilho: 'b' }], 3, ['divida']);
  assert.strictEqual(p, [
    'Atalhos registrados (marca: divida)',
    '',
    'x.js',
    '  :12345 a',
    '         trocar quando: b',
    '',
    '1 atalho em 1 arquivo; todos com "trocar quando".'
  ].join('\n'));
});

test('painel: vazio (mock coluna 3) diz onde procurou', () => {
  assert.strictEqual(atalhos.painel([], 245, PADRAO), [
    'Nenhum atalho registrado.',
    '',
    'Procurei comentários com atalho:, ponytail: ou shortcut: em 245 arquivos de texto, dos rastreados pelo git e dos novos ' +
      'que ele não ignora (binário, link e arquivo acima de 1 MB ficam fora).'
  ].join('\n'));
  assert.ok(atalhos.painel([], 1, ['divida']).includes('com divida: em 1 arquivo de texto,'), 'uma marca e um arquivo');
});

// --- o CLI, num repositorio de verdade ---

function git(dir, args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false'].concat(args),
    { cwd: dir, encoding: 'utf8', shell: false });
  assert.strictEqual(r.status, 0, 'git ' + args.join(' ') + ': ' + r.stderr);
}

function escrever(dir, rel, conteudo) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), conteudo);
}

function rodar(cwd) {
  return spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'atalhos.js')], { cwd: cwd, encoding: 'utf8', shell: false });
}

test('CLI: rastreado e novo nao ignorado entram; ignorado e node_modules ficam fora; nada muda no disco', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-atalhos-'));
  try {
    git(dir, ['init', '-q']);
    escrever(dir, '.gitignore', 'node_modules/\nfora.js\n');
    escrever(dir, 'src/rastreado.js', 'x\n// atalho: rastreado. limite: um. trocar quando: dois.\n');
    escrever(dir, 'ação.py', '# atalho: nome com acento\n');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-q', '-m', 'base']);
    escrever(dir, 'novo.sh', '# shortcut: novo sem commit. trocar quando: tres.\n');
    escrever(dir, 'fora.js', '// atalho: ignorado\n');
    escrever(dir, 'node_modules/p/i.js', '// atalho: dependencia\n');
    const antes = spawnSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).stdout;
    const r = rodar(path.join(dir, 'src'));
    assert.strictEqual(r.status, 0, r.stderr);
    // `:linha` alinhado na coluna de 4 (`:42` + 2 espacos no mock): `:2` leva 3.
    assert.ok(r.stdout.includes('src/rastreado.js\n  :2   rastreado.'), r.stdout);
    assert.ok(r.stdout.includes('ação.py\n  :1   nome com acento\n       sem "trocar quando"'), r.stdout);
    assert.ok(r.stdout.includes('novo.sh\n  :1   novo sem commit.'), r.stdout);
    assert.ok(!r.stdout.includes('ignorado') && !r.stdout.includes('dependencia'), r.stdout);
    assert.ok(r.stdout.includes('3 atalhos em 3 arquivos; 1 sem "trocar quando".'), r.stdout);
    assert.strictEqual(spawnSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).stdout, antes);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: repositorio sem atalho conta os arquivos; marcaDeAtalho do projeto.json vale', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-atalhos-'));
  try {
    git(dir, ['init', '-q']);
    escrever(dir, 'a.js', '// nada\n');
    escrever(dir, 'b.js', '// divida: so com a marca do projeto\n');
    let r = rodar(dir);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.startsWith('Nenhum atalho registrado.'), r.stdout);
    assert.ok(r.stdout.includes('em 2 arquivos de texto,'), r.stdout);
    escrever(dir, '.claude/sworn/projeto.json', JSON.stringify({ marcaDeAtalho: 'divida' }));
    r = rodar(dir);
    assert.ok(r.stdout.includes('(marca: divida, ponytail, shortcut)') && r.stdout.includes('b.js\n  :1   so com a marca'), r.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A6-53: o "em N arquivos" do painel e o dos arquivos de texto lidos; binario e texto acima de 1 MB nao foram lidos
test('CLI: o total do painel conta so o texto lido, sem o binario e o arquivo acima de 1 MB', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-atalhos-total-'));
  try {
    git(dir, ['init', '-q']);
    escrever(dir, 'a.js', '// nada\n');
    escrever(dir, 'b.bin', Buffer.from([0x2f, 0x2f, 0x20, 0x00, 0x01]));
    escrever(dir, 'grande.txt', 'x'.repeat(1024 * 1024 + 1));
    escrever(dir, 'no-limite.txt', 'x'.repeat(1024 * 1024)); // exatamente 1 MB ainda se le
    const r = rodar(dir);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('em 2 arquivos de texto,'), r.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A6-56: o link simbolico nao se segue, nem para dentro nem para fora do repositorio
test('lerArquivo: link simbolico volta null; o alvo, lido pelo proprio caminho, volta o texto', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-atalhos-link-'));
  try {
    const alvo = path.join(dir, 'alvo.js');
    const link = path.join(dir, 'link.js');
    fs.writeFileSync(alvo, '// atalho: de fora\n');
    try { fs.symlinkSync(alvo, link, 'file'); } catch (e) { t.skip('sem permissao para criar link simbolico: ' + e.code); return; }
    assert.strictEqual(atalhos.lerArquivo(alvo), '// atalho: de fora\n');
    assert.strictEqual(atalhos.lerArquivo(link), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A6-56, sem permissao de link (Windows sem modo de desenvolvedor): o lstat diz link e o arquivo real nao se le
test('lerArquivo: o que o lstat diz ser link fica fora, mesmo que o stat ache arquivo', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-atalhos-lstat-'));
  try {
    const arq = path.join(dir, 'link.js');
    fs.writeFileSync(arq, '// atalho: de fora\n');
    const original = fs.lstatSync;
    t.mock.method(fs, 'lstatSync', function (p) {
      if (p === arq) return { isFile: function () { return false; }, isSymbolicLink: function () { return true; }, size: 19 };
      return original.apply(fs, arguments);
    });
    assert.strictEqual(atalhos.lerArquivo(arq), null);
  } finally {
    // o node:test restauraria no fim do teste, mas a limpeza abaixo nao pode ver o lstat falso do link.js
    t.mock.restoreAll();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: fora de repositorio git diz por que e sai com 1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-atalhos-sem-git-'));
  try {
    const r = rodar(dir);
    assert.strictEqual(r.status, 1);
    assert.ok(r.stdout.includes('não é repositório git'), r.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Suite carregada (s129): o git do repositorio de dentro estourou o prazo e a auditoria de 7 dias contou 2 atalhos em
// vez de 3 (auditoria-periodica.test.js, D576). Todo git da varredura leva o mesmo prazo, de 60 s.
test('atalhos: todo git que a varredura chama tem prazo de pelo menos 60 s (o rev-parse nao fica no padrao de 5 s)', () => {
  const gitLib = require('../scripts/lib/git.js');
  const original = gitLib.correr;
  const prazos = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-atalhos-prazo-'));
  try {
    gitLib.correr = function (cwd, args, opcoes) {
      prazos.push(args[0] + ':' + (opcoes && opcoes.timeout));
      return original.call(this, cwd, args, opcoes);
    };
    spawnSync('git', ['init', '-q'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'a.js'), '// atalho: x\n');
    atalhos.doRepositorio(dir, {});
  } finally {
    gitLib.correr = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(prazos.length >= 3, 'esperava rev-parse e os dois ls-files: ' + prazos.join(', '));
  for (const p of prazos) assert.ok(Number(p.split(':')[1]) >= 60000, 'git com prazo curto: ' + prazos.join(', '));
});
