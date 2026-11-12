'use strict';
const test = require('node:test');
const assert = require('node:assert');
const d = require('../scripts/lib/diff-linhas.js');

const L = (texto) => texto.split(' ');
const bloco = (antigoIni, antigoQtd, novoIni, novoQtd) => ({ antigoIni, antigoQtd, novoIni, novoQtd });

test('F2a diff-linhas: listas iguais nao tem bloco; a vazia contra a vazia tambem nao', () => {
  assert.deepStrictEqual(d.blocos(L('a b c'), L('a b c')), []);
  assert.deepStrictEqual(d.blocos([], []), []);
});

test('F2a diff-linhas: troca, insercao e remocao saem na forma do git diff -U0', () => {
  // troca no meio: a linha 2 de antes vira a linha 2 de depois
  assert.deepStrictEqual(d.blocos(L('a b c'), L('a X c')), [bloco(2, 1, 2, 1)]);
  // insercao: antigoQtd 0, e antigoIni e a linha de antes DEPOIS da qual o texto entrou (0 no comeco)
  assert.deepStrictEqual(d.blocos(L('a b c'), L('a b X Y c')), [bloco(2, 0, 3, 2)]);
  assert.deepStrictEqual(d.blocos(L('a b'), L('X a b')), [bloco(0, 0, 1, 1)]);
  assert.deepStrictEqual(d.blocos(L('a b'), L('a b X')), [bloco(2, 0, 3, 1)]);
  // remocao: novoQtd 0, e novoIni e a linha de depois que fica ANTES do ponto (0 no comeco)
  assert.deepStrictEqual(d.blocos(L('a b c d'), L('a d')), [bloco(2, 2, 1, 0)]);
  assert.deepStrictEqual(d.blocos(L('a b'), L('b')), [bloco(1, 1, 0, 0)]);
  // tudo contra nada, nos dois sentidos
  assert.deepStrictEqual(d.blocos([], L('a b')), [bloco(0, 0, 1, 2)]);
  assert.deepStrictEqual(d.blocos(L('a b'), []), [bloco(1, 2, 0, 0)]);
});

test('F2a diff-linhas: duas mudancas separadas por linhas iguais sao dois blocos, com o deslocamento no 2o', () => {
  assert.deepStrictEqual(d.blocos(L('a b c d e f'), L('a X Y c d Z f')), [bloco(2, 1, 2, 2), bloco(5, 1, 6, 1)]);
  // linha repetida (como as em branco de um recorte): o que casa fica fora dos blocos
  assert.deepStrictEqual(d.blocos(L('- - a - -'), L('- - b - -')), [bloco(3, 1, 3, 1)]);
  assert.deepStrictEqual(d.blocos(L('a - b - c'), L('a - X - b - c')), [bloco(2, 0, 3, 2)]);
});

test('F2a diff-linhas: acima do teto de celulas o miolo inteiro e um bloco so (erra para o lado de "mudou")', () => {
  const antes = L('a b c d e f');
  const depois = L('a X c d Z f');
  assert.deepStrictEqual(d.blocos(antes, depois), [bloco(2, 1, 2, 1), bloco(5, 1, 5, 1)]);
  // o miolo e de 4 x 4 linhas: com o teto em 16 celulas ainda se mede; em 15, vira um bloco
  assert.deepStrictEqual(d.blocos(antes, depois, 16), [bloco(2, 1, 2, 1), bloco(5, 1, 5, 1)]);
  assert.deepStrictEqual(d.blocos(antes, depois, 15), [bloco(2, 4, 2, 4)]);
  assert.ok(Number.isInteger(d.TETO_DE_CELULAS) && d.TETO_DE_CELULAS >= 4000000, 'o teto padrao cobre 2000 x 2000 linhas');
});

test('F2a diff-linhas: o teto passado so abaixa o padrao; acima dele vale o padrao (a tabela guarda 16 bits por celula)', () => {
  // 4002 x 4000 linhas, todas diferentes menos uma no meio: passa do padrao por pouco
  const lado = (letra, qtd, meio) => Array.from({ length: qtd }, (_, i) => (i === meio ? 'igual' : letra + i));
  const antes = lado('a', 4002, 2001);
  const depois = lado('d', 4000, 2000);
  assert.ok(antes.length * depois.length > d.TETO_DE_CELULAS);
  assert.deepStrictEqual(d.blocos(antes, depois), [bloco(1, 4002, 1, 4000)]);
  assert.deepStrictEqual(d.blocos(antes, depois, Number.MAX_SAFE_INTEGER), [bloco(1, 4002, 1, 4000)]);
  // abaixo do padrao, o teto alto nao muda nada: o miolo se mede
  assert.deepStrictEqual(d.blocos(L('a b c d e f'), L('a X c d Z f'), Number.MAX_SAFE_INTEGER), [bloco(2, 1, 2, 1), bloco(5, 1, 5, 1)]);
});

test('F2a diff-linhas: tocadas sao as linhas novas de cada bloco; na remocao, as duas vizinhas do ponto', () => {
  assert.deepStrictEqual(d.tocadas([bloco(2, 1, 2, 2), bloco(5, 1, 6, 1)]), [2, 3, 6]);
  assert.deepStrictEqual(d.tocadas([bloco(2, 2, 1, 0)]), [1, 2]);
  // remocao no comeco: nao existe a linha 0
  assert.deepStrictEqual(d.tocadas([bloco(1, 1, 0, 0)]), [1]);
  // remocao no fim (depois ficou com 2 linhas): a vizinha de baixo sai mesmo sem existir, porque tocadas nao sabe o
  // tamanho do texto; linha alem do fim nao tem achado, entao nao segura nada
  assert.deepStrictEqual(d.tocadas(d.blocos(L('a b c'), L('a b'))), [2, 3]);
  assert.deepStrictEqual(d.tocadas([]), []);
});

test('F2a diff-linhas: levar da a linha de depois de uma linha de antes; a que caiu num bloco mudado da null', () => {
  const blocos = d.blocos(L('a b c d e f'), L('a X Y c d Z f'));
  assert.strictEqual(d.levar(1, blocos), 1);
  assert.strictEqual(d.levar(2, blocos), null, 'a linha trocada nao tem par');
  assert.strictEqual(d.levar(3, blocos), 4);
  assert.strictEqual(d.levar(4, blocos), 5);
  assert.strictEqual(d.levar(5, blocos), null);
  assert.strictEqual(d.levar(6, blocos), 7);
  // insercao depois da linha 2: a 2 fica, a 3 desce
  const ins = d.blocos(L('a b c'), L('a b X Y c'));
  assert.strictEqual(d.levar(2, ins), 2);
  assert.strictEqual(d.levar(3, ins), 5);
  // insercao no comeco (antigoIni 0): tudo desce
  assert.strictEqual(d.levar(1, d.blocos(L('a b'), L('X a b'))), 2);
  // remocao das linhas 2 e 3: a 1 fica, a 4 sobe, as removidas nao tem par
  const rem = d.blocos(L('a b c d'), L('a d'));
  assert.deepStrictEqual([1, 2, 3, 4].map((n) => d.levar(n, rem)), [1, null, null, 2]);
  assert.strictEqual(d.levar(7, []), 7, 'sem bloco, a linha e a mesma');
});

test('F2a diff-linhas: toda linha de antes que levar devolve cai numa linha de depois com o mesmo texto', () => {
  // conferencia cruzada do levar com o blocos, em pares montados a mao
  const pares = [
    ['a b c d e f g', 'a c X e Y Z g h'],
    ['x x x a x x', 'x a x x x x b'],
    ['um dois tres', 'zero um dois tres quatro'],
    ['a b c d', 'd c b a']
  ];
  for (const [t1, t2] of pares) {
    const antes = L(t1);
    const depois = L(t2);
    const blocos = d.blocos(antes, depois);
    const tocadas = new Set(d.tocadas(blocos));
    // as linhas de depois que estao dentro de um bloco: texto novo, sem par em antes
    const novas = new Set();
    blocos.forEach((b) => { for (let k = b.novoIni; k < b.novoIni + b.novoQtd; k++) novas.add(k); });
    antes.forEach((texto, i) => {
      const n = d.levar(i + 1, blocos);
      if (n !== null) {
        assert.strictEqual(depois[n - 1], texto, t1 + ' -> ' + t2 + ', linha ' + (i + 1));
        assert.ok(!novas.has(n), t1 + ' -> ' + t2 + ': a linha levada ' + n + ' caiu dentro de um bloco');
      }
    });
    // toda linha de depois ou veio de antes (levada, com o mesmo texto) ou esta dentro de um bloco, e entao e tocada
    const levadas = new Set(antes.map((_, i) => d.levar(i + 1, blocos)).filter((n) => n !== null));
    depois.forEach((_, j) => {
      const n = j + 1;
      assert.strictEqual(levadas.has(n), !novas.has(n), t1 + ' -> ' + t2 + ': linha ' + n + ' levada e dentro de bloco, ou nenhum dos dois');
      if (novas.has(n)) assert.ok(tocadas.has(n), t1 + ' -> ' + t2 + ': linha ' + n + ' de bloco fora das tocadas');
    });
  }
});
