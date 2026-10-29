'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const catraca = require('../scripts/lib/catraca.js');

/**
 * B7 - "quando o teste me atrapalha, eu tenho vontade de mexer no medidor".
 * O desenho da v1 §12 adiou o item; a autoavaliacao exigia "diff cruzado
 * teste x codigo". Cada teste que ACUSA vem com o par que NAO pode acusar.
 */

test('catraca: subir teto e afrouxar - acusa', () => {
  const r = catraca.afrouxou('const TETO = 3;', 'const TETO = 8;');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].de, 3);
  assert.strictEqual(r[0].para, 8);
  assert.strictEqual(r[0].familia, 'teto');
});

test('catraca: DESCER teto e apertar - NAO acusa (controle)', () => {
  assert.strictEqual(catraca.afrouxou('"teto": 200', '"teto": 150').length, 0);
});

test('catraca: descer piso e afrouxar - acusa', () => {
  const r = catraca.afrouxou('cobertura minima: 80', 'cobertura minima: 40');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].familia, 'piso');
});

test('catraca: SUBIR piso e apertar - NAO acusa (controle)', () => {
  assert.strictEqual(catraca.afrouxou('minimo: 40', 'minimo: 80').length, 0);
});

test('catraca: numero sem palavra de catraca NAO acusa (controle)', () => {
  assert.strictEqual(catraca.afrouxou('const x = 3;', 'const x = 900;').length, 0);
});

test('catraca: criar catraca nova NAO e afrouxar (controle)', () => {
  // Palavra que so existe depois e criacao. Exigir "antes" evita que escrever
  // uma catraca pela primeira vez seja lido como afrouxamento dela.
  assert.strictEqual(catraca.afrouxou('const A = 1;', 'const A = 1;\nconst TETO = 5;').length, 0);
});

test('catraca: acento nao esconde a palavra', () => {
  assert.strictEqual(catraca.semAcento('máximo'), 'maximo');
  assert.ok(catraca.afrouxou('máximo: 5', 'máximo: 50').length >= 1);
});

test('catraca: pega a forma de flag de linha de comando', () => {
  const r = catraca.afrouxou('--max-warnings 0', '--max-warnings 50');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].de, 0);
  assert.strictEqual(r[0].para, 50);
});

test('catraca: pega a forma camelCase do proprio projeto', () => {
  assert.strictEqual(catraca.afrouxou('tetoDeInstrucoes: 200', 'tetoDeInstrucoes: 400').length, 1);
});

test('catraca: o maior teto manda, mesmo se outro desceu junto', () => {
  const r = catraca.afrouxou('teto: 10\nteto: 20', 'teto: 5\nteto: 99');
  assert.strictEqual(r.length, 1, 'subir o teto mais alto e afrouxar, ainda que outro aperte');
  assert.strictEqual(r[0].para, 99);
});

test('catraca: motivo cita o arquivo e o numero que andou', () => {
  const m = catraca.motivo('regra.js', catraca.afrouxou('teto: 3', 'teto: 8'));
  assert.ok(m.includes('regra.js'));
  assert.ok(m.includes('3 -> 8'));
  assert.ok(/decisao do dono/i.test(m), 'a recusa tem de dizer de quem e a decisao');
});

// A2-39/40 (P2 do pedido 12): "catraca" e "indicador" eram jargao; o aviso nao dizia como desfazer, nem o caminho do
// dono, nem onde registrar a decisao.
test('A2-39/40: o aviso diz o que afrouxou sem jargao, como refazer e o caminho do dono', () => {
  const m = catraca.motivo('regra.js', catraca.afrouxou('teto: 3', 'teto: 8'));
  assert.ok(!/catraca|indicador/i.test(m), m);
  assert.ok(/afrouxa um limite de qualidade/.test(m), m);
  const junto = m.replace(/\n/g, ' ');
  assert.ok(/refaca a edicao com o numero da esquerda/.test(junto), m);
  assert.ok(/feita a mao por ele/.test(junto) && /onde o projeto registra as decisoes/.test(junto), m);
  for (const l of m.split('\n')) assert.ok(l.length <= 100, 'linha com ' + l.length + ': ' + l);
});

// A2-35 (P2 do pedido 12): Math.max.apply com a lista inteira estourava a pilha (RangeError) a partir de ~130 mil
// ocorrencias (medido na s206); o extremo sai por laco.
test('A2-35: o extremo de uma lista enorme nao estoura a pilha', () => {
  const lista = new Array(300000).fill(5);
  lista[123456] = 9;
  lista[234567] = 1;
  assert.strictEqual(catraca.extremo(lista, 'teto'), 9);
  assert.strictEqual(catraca.extremo(lista, 'piso'), 1);
  assert.strictEqual(catraca.extremo([-Infinity, 2], 'teto'), 2);
  assert.strictEqual(catraca.extremo([Infinity, 2], 'piso'), 2);
  // O extremo dos dois lados, nao o primeiro: o maior teto desceu de 20 para 18, e isso aperta.
  assert.strictEqual(catraca.afrouxou('teto: 10\nteto: 20', 'teto: 15\nteto: 18').length, 0);
  assert.strictEqual(catraca.afrouxou('minimo: 50\nminimo: 40', 'minimo: 45\nminimo: 42').length, 0);
});

test('catraca: entrada vazia ou nula nao estoura', () => {
  assert.strictEqual(catraca.afrouxou(null, undefined).length, 0);
  assert.strictEqual(catraca.afrouxou('', '').length, 0);
});

// ── regressao: falsos positivos achados na auditoria de 2026-09-02 ──────────

test('catraca REGRESSAO: "climax" nao e "max" - palavra tem de comecar', () => {
  // Sem o \b no padrao, qualquer palavra que CONTENHA uma palavra de catraca
  // virava catraca, e o portao passava a negar edicao honesta.
  assert.strictEqual(catraca.afrouxou('climax: 1', 'climax: 7').length, 0);
  assert.strictEqual(catraca.afrouxou('administrador: 9', 'administrador: 5').length, 0);
  assert.strictEqual(catraca.afrouxou('terminal: 2', 'terminal: 8').length, 0);
});

test('catraca REGRESSAO: "maximo" conta UMA vez, nao duas', () => {
  // "maximo" e "max" casavam a mesma ocorrencia e o motivo saia duplicado.
  const r = catraca.afrouxou('maximo: 2', 'maximo: 8');
  assert.strictEqual(r.length, 1, 'reportou ' + r.length + ': ' + JSON.stringify(r.map((x) => x.palavra)));
  assert.strictEqual(r[0].palavra, 'maximo', 'a palavra mais longa e a que descreve o achado');
});

// Ronda 1 do 8c.5: a faixa de acentos do semAcento estava em caractere cru - uma marca
// combinante sozinha no fonte, invisivel no editor, que um salvamento em NFC pode fundir
// com o `[` e mudar o regex sem mudar nada que se veja. Os irmaos (auditoria.js,
// obrigacoes.js) usam escape. O semAcento com acento ja se confere acima.
test('catraca: nenhum script traz marca combinante crua - a faixa de acentos vai em escape', () => {
  const crus = [];
  const visitar = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { visitar(p); continue; }
      if (!e.name.endsWith('.js')) continue;
      fs.readFileSync(p, 'utf8').split('\n').forEach((linha, i) => {
        if ([...linha].some((ch) => ch.codePointAt(0) >= 0x300 && ch.codePointAt(0) <= 0x36f)) {
          crus.push(path.relative(path.join(__dirname, '..'), p) + ':' + (i + 1));
        }
      });
    }
  };
  visitar(path.join(__dirname, '..', 'scripts'));
  assert.deepStrictEqual(crus, [], 'marca combinante crua no fonte: ' + crus.join(', '));
});

// PT-02 (lote 2, D422): max/min sao palavras genericas - CSS e variavel de codigo nao sao regua de qualidade.
test('catraca PT-02: max-width/min-height de CSS e const max/min de codigo NAO sao catraca', () => {
  const casos = [
    ['max-width: 600px', 'max-width: 720px'],
    ['min-height: 100px', 'min-height: 80px'],
    ['.a { max-width: 600px; }', '.a { max-width: 720px; }'],
    ['min-height: 0', 'min-height: 1'],
    ['const max = 10;', 'const max = 20;'],
    ['const min = 5;', 'const min = 1;'],
    ['let max = 10;', 'let max = 20;']
  ];
  for (const [antes, depois] of casos) {
    assert.deepStrictEqual(catraca.afrouxou(antes, depois), [], antes + ' -> ' + depois);
  }
});

test('catraca PT-02: controle - max/min como chave de configuracao e as palavras especificas seguem acusando', () => {
  assert.strictEqual(catraca.afrouxou('max: 10', 'max: 20').length, 1);
  assert.strictEqual(catraca.afrouxou('"max": 10', '"max": 20').length, 1);
  assert.strictEqual(catraca.afrouxou('"min": 80', '"min": 50').length, 1);
  assert.strictEqual(catraca.afrouxou('max = 10', 'max = 20').length, 1, 'forma ini');
  assert.strictEqual(catraca.afrouxou('max-lines: 300', 'max-lines: 900').length, 1, 'regra do eslint');
  assert.strictEqual(catraca.afrouxou('const TETO = 3;', 'const TETO = 8;').length, 1);
});

// Ronda 1 da revisao cega do lote 2: o filtro do PT-02 estava largo demais e deixava passar piso/teto de verdade.
test('catraca PT-02 C1: piso/teto com unidade (%, ms) segue acusando - o filtro de unidade foi removido', () => {
  assert.strictEqual(catraca.afrouxou('min: 80%', 'min: 50%').length, 1, 'cobertura em %');
  assert.strictEqual(catraca.afrouxou('max: 300ms', 'max: 900ms').length, 1, 'teto em ms');
  assert.strictEqual(catraca.afrouxou('"min": "80%"', '"min": "50%"').length, 1, 'aspas');
});

test('catraca PT-02 C1: min()/max() de CSS e propriedade com medida seguem sem acusar', () => {
  const casos = [
    ['width: min(600px, 100%)', 'width: min(300px, 100%)'],
    ['width: max(600px, 100%)', 'width: max(900px, 100%)'],
    ['max-width: 600px', 'max-width: 720px'],
    ['min-height: 100%', 'min-height: 50%'],
    ['max-inline-size: 60ch', 'max-inline-size: 90ch']
  ];
  for (const [antes, depois] of casos) {
    assert.deepStrictEqual(catraca.afrouxou(antes, depois), [], antes + ' -> ' + depois);
  }
});

test('catraca PT-02 C2: camelCase de CSS-in-JS (maxWidth, minHeight) tambem nao e catraca', () => {
  const casos = [
    ['{ maxWidth: 600 }', '{ maxWidth: 800 }'],
    ['{ minHeight: 100 }', '{ minHeight: 40 }'],
    ['{ maxInlineSize: 60 }', '{ maxInlineSize: 90 }'],
    ['{ minBlockSize: 100 }', '{ minBlockSize: 40 }']
  ];
  for (const [antes, depois] of casos) {
    assert.deepStrictEqual(catraca.afrouxou(antes, depois), [], antes + ' -> ' + depois);
  }
});

test('catraca PT-02 C3: so o identificador PURO max/min e isento - maxWarnings, MIN_COVERAGE, max_lines acusam', () => {
  assert.strictEqual(catraca.afrouxou('const MAX_WARNINGS = 0;', 'const MAX_WARNINGS = 50;').length, 1);
  assert.strictEqual(catraca.afrouxou('const MIN_COVERAGE = 80;', 'const MIN_COVERAGE = 60;').length, 1);
  assert.strictEqual(catraca.afrouxou('const maxWarnings = 0;', 'const maxWarnings = 5;').length, 1);
  assert.strictEqual(catraca.afrouxou('let max_lines = 300;', 'let max_lines = 900;').length, 1);
  // o pedido original do PT-02 continua valendo
  assert.deepStrictEqual(catraca.afrouxou('const max = 10;', 'const max = 20;'), []);
  assert.deepStrictEqual(catraca.afrouxou('const min = 5;', 'const min = 1;'), []);
});

// TS-02 (lote 3, D423): a fronteira. So ANDAR para o lado frouxo acusa; ficar no mesmo numero nao.
test('catraca TS-02: fronteira - teto e piso no MESMO numero nao acusam; um passo para o lado frouxo acusa', () => {
  assert.deepStrictEqual(catraca.afrouxou('"teto": 3', '"teto": 3'), [], 'teto igual');
  assert.deepStrictEqual(catraca.afrouxou('"minimo": 80', '"minimo": 80'), [], 'piso igual');
  assert.strictEqual(catraca.afrouxou('"teto": 3', '"teto": 4').length, 1, 'teto +1 acusa');
  assert.strictEqual(catraca.afrouxou('"minimo": 80', '"minimo": 79').length, 1, 'piso -1 acusa');
  assert.deepStrictEqual(catraca.afrouxou('"teto": 4', '"teto": 3'), [], 'teto -1 aperta');
  assert.deepStrictEqual(catraca.afrouxou('"minimo": 79', '"minimo": 80'), [], 'piso +1 aperta');
});

// S4 (L2-cat-1,3,4,6,7,8): estreitar a isencao do PT-02 onde ela cegava reguas reais, sem desfaze-la.
test('catraca S4 cat-1: constante em CAIXA ALTA (MAX, MIN) e regua - so o minusculo puro segue isento', () => {
  assert.strictEqual(catraca.afrouxou('const MAX = 50;', 'const MAX = 500;').length, 1, 'MAX sobe');
  assert.strictEqual(catraca.afrouxou('const MIN = 80;', 'const MIN = 10;').length, 1, 'MIN desce');
  assert.deepStrictEqual(catraca.afrouxou('const max = 50;', 'const max = 500;'), [], 'max minusculo isento');
  assert.deepStrictEqual(catraca.afrouxou('let min = 80;', 'let min = 10;'), [], 'min minusculo isento');
});

test('catraca S4 cat-3/4: a propriedade CSS casa inteira e aceita _ - max-width-budget acusa, max_width nao', () => {
  assert.strictEqual(catraca.afrouxou('max-width-budget: 300', 'max-width-budget: 900').length, 1, 'sufixo a mais e regua');
  assert.strictEqual(catraca.afrouxou('maxWidthBudget: 300', 'maxWidthBudget: 900').length, 1, 'camelCase com sufixo a mais');
  assert.deepStrictEqual(catraca.afrouxou('max_width = 600', 'max_width = 900'), [], 'snake_case de CSS');
  assert.deepStrictEqual(catraca.afrouxou('min_height = 100', 'min_height = 40'), [], 'snake_case de CSS (piso)');
  assert.deepStrictEqual(catraca.afrouxou('max_inline_size = 60', 'max_inline_size = 90'), [], 'inline_size');
  assert.deepStrictEqual(catraca.afrouxou('max-width: 600px', 'max-width: 900px'), [], 'max-width: 600px -> 900px isento');
});

test('catraca S4 cat-6: anotacao de tipo (TS) entre o nome e o numero nao esconde a regua', () => {
  assert.strictEqual(catraca.afrouxou('maxWarnings: number = 0', 'maxWarnings: number = 5').length, 1);
  assert.strictEqual(catraca.afrouxou('const MAX_WARNINGS: number = 0;', 'const MAX_WARNINGS: number = 5;').length, 1);
  // o identificador puro declarado segue isento mesmo com a anotacao
  assert.deepStrictEqual(catraca.afrouxou('const max: number = 10;', 'const max: number = 50;'), []);
  // sem "=" depois do tipo nao e atribuicao: nao inventa par
  assert.deepStrictEqual(Object.keys(catraca.pares('maxWarnings: number 5')), []);
});

test('catraca S4 cat-7: _ antes da palavra nao tira a regua (ESLINT_MAX_WARNINGS), letra/digito antes segue tirando', () => {
  assert.strictEqual(catraca.afrouxou('ESLINT_MAX_WARNINGS=0', 'ESLINT_MAX_WARNINGS=5').length, 1);
  assert.strictEqual(catraca.afrouxou('--max-warnings 0', '--max-warnings 5').length, 1, 'max-warnings 0 -> 5 negado');
  assert.deepStrictEqual(catraca.afrouxou('climax: 3', 'climax: 9'), [], 'climax');
  assert.deepStrictEqual(catraca.afrouxou('xmax: 3', 'xmax: 9'), [], 'letra antes');
  assert.deepStrictEqual(catraca.afrouxou('1max: 3', '1max: 9'), [], 'digito antes');
});

// D429/3 (L2-cat-5): o 2o declarador da mesma linha recebe a mesma regra do 1o. Virgula dentro de
// chamada, objeto ou array NAO abre declarador novo.
test('D429/3 cat-5: `const a = 1, max = 10` - o 2o declarador minusculo e variavel local, como o 1o', () => {
  assert.deepStrictEqual(catraca.afrouxou('const a = 1, max = 50;', 'const a = 1, max = 500;'), [], '2o declarador isento');
  assert.deepStrictEqual(catraca.afrouxou('let a = 1, b = 2, max = 50;', 'let a = 1, b = 2, max = 500;'), [], '3o declarador isento');
  assert.deepStrictEqual(catraca.afrouxou('var a, max = 50;', 'var a, max = 500;'), [], 'sem inicializador no 1o');
  assert.deepStrictEqual(catraca.afrouxou('const a = 1, min = 80;', 'const a = 1, min = 10;'), [], 'min (piso) isento');
  assert.deepStrictEqual(catraca.afrouxou('for (let i = 0, max = 50; i < 3; i++) {}', 'for (let i = 0, max = 500; i < 3; i++) {}'), [], 'declarador no for');
  assert.deepStrictEqual(catraca.afrouxou('const a = f(1, 2), max = 50;', 'const a = f(1, 2), max = 500;'), [], 'virgula de chamada no 1o declarador');
  assert.deepStrictEqual(catraca.afrouxou('const s = "x, y", max = 50;', 'const s = "x, y", max = 500;'), [], 'virgula dentro de string');
});

test('D429/3 cat-5: no 2o declarador a CAIXA ALTA e o sufixo seguem sendo regua', () => {
  assert.strictEqual(catraca.afrouxou('const a = 1, MAX = 10;', 'const a = 1, MAX = 99;').length, 1, 'MAX acusa');
  assert.strictEqual(catraca.afrouxou('const a = 1, MIN = 80;', 'const a = 1, MIN = 10;').length, 1, 'MIN acusa');
  assert.strictEqual(catraca.afrouxou('const a = 1, maxWarnings = 0;', 'const a = 1, maxWarnings = 5;').length, 1, 'maxWarnings acusa');
  assert.strictEqual(catraca.afrouxou('const a = 1, maxWarnings: number = 0;', 'const a = 1, maxWarnings: number = 5;').length, 1, 'com anotacao de tipo');
  assert.strictEqual(catraca.afrouxou('const a = 1, ESLINT_MAX_WARNINGS = 0;', 'const a = 1, ESLINT_MAX_WARNINGS = 5;').length, 1);
});

test('D429/3 cat-5: virgula de chamada, objeto ou array NAO e declarador novo - segue acusando', () => {
  assert.strictEqual(catraca.afrouxou('const a = f(1, max = 50);', 'const a = f(1, max = 500);').length, 1, 'argumento de chamada');
  assert.strictEqual(catraca.afrouxou('const o = { a: 1, max: 50 };', 'const o = { a: 1, max: 500 };').length, 1, 'chave de objeto');
  assert.strictEqual(catraca.afrouxou('const v = [1, max = 50];', 'const v = [1, max = 500];').length, 1, 'item de array');
  assert.strictEqual(catraca.afrouxou('const a = g(x), h = f(1, max: 50);', 'const a = g(x), h = f(1, max: 500);').length, 1, 'declarador seguinte, mas dentro de chamada');
  assert.strictEqual(catraca.afrouxou('foo(1, max = 50);', 'foo(1, max = 500);').length, 1, 'sem declaracao nenhuma');
  assert.strictEqual(catraca.afrouxou('const a = 1; foo(2, max = 50);', 'const a = 1; foo(2, max = 500);').length, 1, ';-fim da declaracao');
});

test('D429/3 cat-5: o que ja conferia nao muda', () => {
  assert.strictEqual(catraca.afrouxou('const MAX = 50;', 'const MAX = 500;').length, 1);
  assert.strictEqual(catraca.afrouxou('max-width-budget: 300', 'max-width-budget: 900').length, 1);
  assert.deepStrictEqual(catraca.afrouxou('max_width = 600', 'max_width = 900'), []);
  assert.strictEqual(catraca.afrouxou('ESLINT_MAX_WARNINGS=0', 'ESLINT_MAX_WARNINGS=5').length, 1);
  assert.deepStrictEqual(catraca.afrouxou('const a = 1, climax = 3;', 'const a = 1, climax = 9;'), []);
  assert.deepStrictEqual(Object.keys(catraca.pares('const a = 1, MIN_COVERAGE = 80;')), ['coverage']);
  assert.strictEqual(catraca.afrouxou('maxWarnings: number = 0', 'maxWarnings: number = 5').length, 1);
});

test('D429/3 cat-5: tempo linear - linha de 30000 caracteres com muitas virgulas e declaradores', () => {
  const linha = 'const a = 1' + ', max = 1'.repeat(3300);
  const t0 = process.hrtime.bigint();
  catraca.pares(linha);
  catraca.pares('const a = f(' + '1, '.repeat(10000) + 'max = 5)');
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(linha.length > 29000);
  assert.ok(ms < 500, 'levou ' + ms + ' ms');
});
