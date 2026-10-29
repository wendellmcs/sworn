'use strict';
const test = require('node:test');
const assert = require('node:assert');
const v = require('../scripts/lib/veredito.js');

function achado(sev, arq, linha, desc) {
  return { estado: 'confirmado', severidade: sev, arquivo: arq, linha: linha, trecho: 'x', descricao: desc || 'defeito',
    comoFalha: 'x -> y' };
}
function veredito(lente, achados, melhor) {
  return { lente: lente, melhor: melhor || 'A', porQue: 'A.txt:1', achados: achados };
}

test('veredito: sao dez lentes distintas', () => {
  assert.strictEqual(v.LENTES.length, 10);
  assert.strictEqual(new Set(v.LENTES.map((l) => l.chave)).size, 10);
});

// D553/D554 (0.9.0): a lente 10 julga o codigo que nao precisava existir (ideia do /ponytail-review, texto nosso).
// Entra na faixa completa e no arquivo so de logica; nao entra nas faixas pequenas.
test('veredito: a lente enxuto pede o que substitui, com arquivo:linha, e nunca chama de excesso o que protege', () => {
  const l = v.LENTES.find((x) => x.chave === 'enxuto');
  assert.ok(l, 'falta a lente enxuto');
  assert.strictEqual(l.titulo, 'Codigo que nao precisava existir');
  assert.ok(/^[\x20-\x7E]+$/.test(l.pergunta), 'pergunta fora de ASCII');
  for (const t of ['arquivo:linha', 'linguagem', 'plataforma', 'dependencia ja instalada', 'codigo do projeto',
    'Validacao na fronteira', 'perda de dados', 'seguranca', 'acessibilidade', 'nunca sao excesso']) {
    assert.ok(l.pergunta.includes(t), 'a pergunta nao diz: ' + t);
  }
  assert.strictEqual(v.chaveDaLente('Código que não precisava existir'), 'enxuto', 'o titulo com acento acha a lente');
  assert.ok(v.SAEM_SO_LOGICA.indexOf('enxuto') === -1, 'enxuto fica no arquivo so de logica');
  for (const f of ['uma', 'duas', 'texto']) {
    assert.ok(v.lentesDaFaixa(f).indexOf('enxuto') === -1, 'enxuto nao entra na faixa ' + f);
  }
  assert.strictEqual(v.lentesDaFaixa('completa'), null, 'na completa vale a familia inteira');
});

test('veredito: as oito lentes de UI sao distintas e nao colidem com as de codigo', () => {
  assert.strictEqual(v.LENTES_UI.length, 8);
  assert.strictEqual(new Set(v.LENTES_UI.map((l) => l.chave)).size, 8);
  // D121: as listas divergem por desenho. Chave repetida entre as familias
  // faria o despacho gravar dois vereditos no mesmo arquivo.
  const codigo = new Set(v.LENTES.map((l) => l.chave));
  for (const l of v.LENTES_UI) {
    assert.ok(!codigo.has(l.chave), 'chave de UI colide com a de codigo: ' + l.chave);
  }
});

test('veredito: toda lente de UI tem titulo e pergunta', () => {
  for (const l of v.LENTES_UI) {
    assert.ok(l.titulo && l.titulo.length > 3, 'lente sem titulo: ' + l.chave);
    assert.ok(l.pergunta && l.pergunta.length > 20, 'lente sem pergunta: ' + l.chave);
  }
});

test('veredito: mudanca sem UI despacha so a familia de codigo', () => {
  assert.deepStrictEqual(v.familiasPara(true, false), ['codigo']);
});

test('veredito: mudanca com UI despacha as duas familias', () => {
  assert.deepStrictEqual(v.familiasPara(true, true), ['codigo', 'ui']);
});

// Ronda 2 do 8c.10: "Codigo sempre" mandava as 9 de codigo tambem na mudanca so de tela, contra
// a regra da spec (decisao 8) e a tabela do /sworn:review. So tela, as 8. Nada declarado e
// duvida, e na duvida vao as duas - nunca nenhuma, que seria revisao sem voto.
test('veredito: mudanca so de tela despacha so a familia de tela; na duvida, as duas', () => {
  assert.deepStrictEqual(v.familiasPara(false, true), ['ui']);
  assert.deepStrictEqual(v.familiasPara(false, false), ['codigo', 'ui']);
  assert.deepStrictEqual(v.familiasPara(), ['codigo', 'ui']);
});

// D485 (s106): revisao proporcional ao diff. So comentario, numero ou frase curta = 1 inspetor; logica pequena
// com teste vermelho e mutacao = 2; texto = correcao + microcopy; arquivo novo ou logica grande = a tabela de
// familias de hoje. Na duvida (sem medida, identico ao HEAD, estilo), a completa.
test('D485: faixaDaMudanca - novo, identico, estilo e sem medida vao a completa', () => {
  assert.strictEqual(v.faixaDaMudanca({ novo: true, linhasMudadas: 1 }), 'completa');
  assert.strictEqual(v.faixaDaMudanca({ identico: true, linhasMudadas: 0 }), 'completa');
  assert.strictEqual(v.faixaDaMudanca({ estilo: true, linhasMudadas: 1 }), 'completa');
  assert.strictEqual(v.faixaDaMudanca({ linhasMudadas: null }), 'completa');
  assert.strictEqual(v.faixaDaMudanca({}), 'completa');
  assert.strictEqual(v.faixaDaMudanca(), 'completa');
  assert.strictEqual(v.faixaDaMudanca({ linhasMudadas: -1 }), 'completa');
  assert.strictEqual(v.faixaDaMudanca({ linhasMudadas: 2.5 }), 'completa');
});

test('D485: faixaDaMudanca - os cortes de linhas, com texto e sem texto', () => {
  assert.strictEqual(v.FAIXA_UMA_ATE, 3);
  assert.strictEqual(v.FAIXA_DUAS_ATE, 40);
  assert.strictEqual(v.faixaDaMudanca({ linhasMudadas: 0 }), 'uma');
  assert.strictEqual(v.faixaDaMudanca({ linhasMudadas: 3 }), 'uma');
  assert.strictEqual(v.faixaDaMudanca({ linhasMudadas: 4 }), 'duas');
  assert.strictEqual(v.faixaDaMudanca({ linhasMudadas: 40 }), 'duas');
  assert.strictEqual(v.faixaDaMudanca({ linhasMudadas: 41 }), 'completa');
  assert.strictEqual(v.faixaDaMudanca({ texto: true, linhasMudadas: 3 }), 'uma');
  assert.strictEqual(v.faixaDaMudanca({ texto: true, linhasMudadas: 4 }), 'texto');
  assert.strictEqual(v.faixaDaMudanca({ texto: true, linhasMudadas: 500 }), 'texto');
});

test('D485: lentesDaFaixa - as lentes de cada faixa existem em LENTES; a completa devolve null (tabela de familias)', () => {
  assert.deepStrictEqual(v.lentesDaFaixa('uma'), ['correcao']);
  assert.deepStrictEqual(v.lentesDaFaixa('duas'), ['correcao', 'borda']);
  assert.deepStrictEqual(v.lentesDaFaixa('texto'), ['correcao', 'microcopy']);
  assert.strictEqual(v.lentesDaFaixa('completa'), null);
  assert.strictEqual(v.lentesDaFaixa('outra'), null);
  const chaves = new Set(v.LENTES.map((l) => l.chave));
  for (const f of ['uma', 'duas', 'texto']) {
    v.lentesDaFaixa(f).forEach((k) => assert.ok(chaves.has(k), 'lente da faixa ' + f + ' nao existe: ' + k));
  }
  // a lista devolvida e copia: quem mexe nela nao muda a regra
  v.lentesDaFaixa('uma').push('escopo');
  assert.deepStrictEqual(v.lentesDaFaixa('uma'), ['correcao']);
});

test('veredito: as duas familias somam 18 lentes sem chave repetida', () => {
  const todas = v.FAMILIAS.codigo.concat(v.FAMILIAS.ui);
  assert.strictEqual(todas.length, 18);
  assert.strictEqual(new Set(todas.map((l) => l.chave)).size, 18);
});

test('veredito: achado sem arquivo:linha nao conta (anti-teatro)', () => {
  const r = v.validarVeredito(veredito('correcao', [
    achado('P1', 'A.txt', 10),
    { estado: 'confirmado', severidade: 'P1', descricao: 'esta feio' }
  ]));
  assert.strictEqual(r.achadosValidos.length, 1);
  assert.ok(r.erros.some((e) => e.includes('arquivo')));
});

// Plano 083 (p5-20): o descarte sem descricao nao imprime "undefined"; com descricao, segue o trecho dela.
test('083 T5 (p5-20): achado e lacuna sem arquivo:linha e sem descricao dizem "(sem descricao)", nao "undefined"', () => {
  const r = v.validarVeredito(comRef('correcao', 'vence', 'empata',
    [{ estado: 'confirmado', trecho: 'x', severidade: 'P1', arquivo: 'A.txt' }, { estado: 'confirmado', trecho: 'x', severidade: 'P1', descricao: 'esta feio' }],
    [{ severidade: 'P1', arquivo: 'C.txt', linha: 2 }]), { comReferencia: true });
  assert.ok(r.erros.length === 3, JSON.stringify(r.erros));
  assert.ok(r.erros.every((e) => e.indexOf('undefined') === -1), JSON.stringify(r.erros));
  assert.ok(/descartado: \(sem descricao\)$/.test(r.erros[0]), r.erros[0]);
  assert.ok(/descartado: esta feio$/.test(r.erros[1]), r.erros[1]);
  assert.ok(/descartada: \(sem descricao\)$/.test(r.erros[2]), r.erros[2]);
});

// A3-01 (pedido 12): o corte em 60 unidades UTF-16 partia o emoji no meio e a mensagem saia com meio caractere.
test('A3-01: o trecho da descricao do descartado corta por caractere, sem partir emoji', () => {
  const r = v.validarVeredito(comRef('correcao', 'vence', 'empata',
    [{ estado: 'confirmado', trecho: 'x', severidade: 'P1', descricao: 'a'.repeat(59) + '\u{1F600}b' }], []),
  { comReferencia: true });
  const erro = r.erros.find((e) => /descartado: /.test(e)) || '';
  assert.ok(erro.isWellFormed() && erro.endsWith('a'.repeat(59) + '\u{1F600}'), JSON.stringify(r.erros));
});

test('veredito: severidade fora dos tres niveis e descartada', () => {
  const r = v.validarVeredito(veredito('correcao', [achado('grave', 'A.txt', 3)]));
  assert.strictEqual(r.achadosValidos.length, 0);
});

test('veredito: veredito sem lente e recusado', () => {
  const r = v.validarVeredito({ melhor: 'A', achados: [] });
  assert.strictEqual(r.ok, false);
});

test('apurar: ronda 1 com P1 novo nao e seca', () => {
  const r = v.apurar([[veredito('correcao', [achado('P1', 'A.txt', 10)])]]);
  assert.strictEqual(r.secas, 0);
  assert.strictEqual(r.encerrar, false);
});

test('apurar: ronda so com P2 e seca (P2 vira registro, nao correcao)', () => {
  const r = v.apurar([[veredito('correcao', [achado('P2', 'A.txt', 10)])]]);
  assert.strictEqual(r.secas, 1);
});

test('apurar: achado repetido com a mesma evidencia nao molha a ronda', () => {
  const mesmo = [veredito('correcao', [achado('P1', 'A.txt', 10)])];
  const r = v.apurar([mesmo, mesmo, mesmo]);
  assert.strictEqual(r.secas, 2, 'rondas 2 e 3 nao trouxeram nada novo');
  assert.strictEqual(r.encerrar, true);
  assert.ok(r.motivo.includes('secas'));
});

test('apurar: duas rondas secas seguidas encerram aprovado', () => {
  const r = v.apurar([
    [veredito('correcao', [achado('P1', 'A.txt', 10)])],
    [veredito('correcao', [])],
    [veredito('correcao', [])]
  ]);
  assert.strictEqual(r.encerrar, true);
  assert.strictEqual(r.secas, 2);
});

test('apurar: teto de 3 rondas com P1 aberto para e manda ao dono', () => {
  const r = v.apurar([
    [veredito('correcao', [achado('P1', 'A.txt', 1)])],
    [veredito('correcao', [achado('P1', 'A.txt', 2)])],
    [veredito('correcao', [achado('P1', 'A.txt', 3)])]
  ]);
  assert.strictEqual(r.encerrar, true);
  assert.ok(r.motivo.includes('teto'));
  assert.ok(r.motivo.includes('dono') || r.motivo.includes('humano'));
});

test('apurar: P0 novo nunca e ronda seca', () => {
  const r = v.apurar([[veredito('seguranca', [achado('P0', 'B.txt', 7)])]]);
  assert.strictEqual(r.secas, 0);
});

test('apurar: placar A/B e sinal, e vem separado dos achados', () => {
  const r = v.apurar([[
    veredito('correcao', [], 'A'),
    veredito('seguranca', [], 'B'),
    veredito('microcopy', [], 'A')
  ]]);
  assert.deepStrictEqual(r.placar, { A: 2, B: 1, empate: 0 });
});

// Ronda 1 do 8c.5: a chave do achado nao levava a lente. Dois defeitos diferentes, de
// lentes diferentes, na mesma linha contavam como um - e o segundo, se voltasse sem
// correcao, nunca molhava a ronda. A mesma lente repetindo o mesmo lugar segue sendo um.
test('apurar: lentes diferentes na mesma linha sao dois achados; a mesma lente repetida, um', () => {
  const r = v.apurar([[
    veredito('correcao', [achado('P1', 'A.txt', 42, 'quebra com lista vazia')]),
    veredito('seguranca', [achado('P1', 'A.txt', 42, 'caminho sem guarda')])
  ]]);
  assert.deepStrictEqual(r.novos.map((a) => a.descricao).sort(), ['caminho sem guarda', 'quebra com lista vazia'],
    'duas lentes, dois defeitos na mesma linha: ' + JSON.stringify(r.novos));

  const r2 = v.apurar([
    [veredito('correcao', [achado('P1', 'A.txt', 42, 'quebra com lista vazia')])],
    [veredito('correcao', [achado('P1', 'A.txt', 42, 'quebra com lista vazia')]),
      veredito('seguranca', [achado('P1', 'A.txt', 42, 'caminho sem guarda')])]
  ]);
  assert.deepStrictEqual(r2.novos.map((a) => a.descricao), ['caminho sem guarda'],
    'na ronda 2 so a lente nova naquela linha e novidade: ' + JSON.stringify(r2.novos));
  assert.strictEqual(r2.secas, 0, 'um P1 novo de outra lente molha a ronda');

  // O motivo do teto conta os abertos pelo comeco da chave: a severidade tem de seguir primeiro.
  const r3 = v.apurar([
    [veredito('correcao', [achado('P1', 'A.txt', 42, 'quebra com lista vazia')])],
    [veredito('seguranca', [achado('P1', 'A.txt', 42, 'caminho sem guarda')])],
    [veredito('correcao', [achado('P2', 'A.txt', 7, 'nome que mente')])]
  ]);
  assert.ok(r3.motivo.includes('com 2 achado(s) P0/P1'), 'o teto conta os dois P1 e nao o P2: ' + r3.motivo);
});

// Ronda 2 do 8c.10: o apurar contava o que nao e veredito como voto sem achado, e a ronda saia
// seca por falta de voto. O apurar-ronda.js para antes; quem chama o apurar direto recebe o erro.
test('apurar: o que nao e veredito e recusado, e nao conta como voto seco', () => {
  const seca = [veredito('correcao', [])];
  const falsos = [[{}, 'sem lente'], [null, 'nao e objeto'],
    [{ lente: 'borda', melhor: 'talvez', achados: [] }, 'melhor'], [{ lente: 'borda', melhor: 'A' }, 'achados']];
  for (const [falso, motivo] of falsos) {
    assert.throws(() => v.apurar([seca, [falso]]), (e) => e.message.includes(motivo),
      'o apurar aceitou ' + JSON.stringify(falso) + ' como voto');
  }
  assert.strictEqual(v.apurar([seca, seca]).motivo, 'duas rondas secas seguidas: aprovado');
});

// D244/defeito 3 (D241 secao 2.3): na onda 7 as 3 rondas molharam com P1 do lado ANTIGO - o que
// a mudanca conserta. So o lado novo molha; o antigo sai listado a parte.
const P1 = (arquivo, linha, lente) => ({ lente: lente || 'design', melhor: 'A',
  achados: [{ estado: 'confirmado', trecho: 'x', severidade: 'P1', arquivo: arquivo, linha: linha, descricao: 'x' }] });
const TRAB_A = { A: 'trabalho', B: 'HEAD' };
const TRAB_B = { A: 'HEAD', B: 'trabalho' };

test('D244/defeito 3: P1 so do lado antigo nao molha a ronda', () => {
  const r = v.apurar([[P1('B.txt', 10)], [P1('A.txt', 12)]], { mapas: [TRAB_A, TRAB_B] });
  assert.strictEqual(r.encerrar, true, JSON.stringify(r));
  assert.strictEqual(r.motivo, 'duas rondas secas seguidas: aprovado');
  assert.strictEqual(r.achadosDoLadoAntigo.length, 1, 'o lado antigo da ultima ronda sai listado');
});

test('D244/defeito 3: P1 do lado novo continua molhando', () => {
  const r = v.apurar([[P1('A.txt', 10)]], { mapas: [TRAB_A] });
  assert.strictEqual(r.secas, 0);
  assert.strictEqual(r.novos.length, 1);
});

test('D244/defeito 3: a mesma linha do mesmo lado e o mesmo achado, mesmo com o rotulo trocado', () => {
  // ronda 1: trabalho = A; ronda 2: trabalho = B. Mesmo lugar do lado novo, rotulo diferente.
  // 0.3.3, item 1: a ronda seca e um veredito sem achados; `[]` (ronda sem veredito) agora e erro, era o proprio
  // defeito. O medidor mudou de proposito: a fixture troca `[]` por um veredito vazio, o mesmo sentido de antes.
  const r = v.apurar([[P1('A.txt', 10)], [P1('B.txt', 10)], [veredito('design', [])]], { mapas: [TRAB_A, TRAB_B, TRAB_A] });
  assert.strictEqual(r.encerrar, true);
  assert.strictEqual(r.motivo, 'duas rondas secas seguidas: aprovado', JSON.stringify(r));
});

// D475 (s99): na R3 da skills/playbook/SKILL.md (0.7.0) a microcopy citou P1 em trabalho:302, mesma chave do P1 da R2,
// mas a linha 302 tinha sido REESCRITA entre as rondas. Mesmo numero com outro texto e evidencia nova, nao repeticao.
test('D475: linha reescrita entre rondas e evidencia nova: o P1 da ronda seguinte molha; texto igual segue repeticao', () => {
  const mic = (arquivo) => ({ lente: 'microcopy', melhor: 'A',
    achados: [{ estado: 'confirmado', trecho: 'x', severidade: 'P1', arquivo: arquivo, linha: 302, descricao: 'x' }] });
  const rondas = [[mic('B.txt')], [mic('A.txt')]];
  const reescrita = (indice) => (indice === 0 ? 'nem os contadores do plugin, turnos e' : 'bloqueios de portao, que o plugin conta');
  const r = v.apurar(rondas, { mapas: [TRAB_B, TRAB_A], textoDaLinha: reescrita });
  assert.strictEqual(r.secas, 0, 'P1 sobre texto novo virou repeticao: ' + JSON.stringify(r));
  assert.strictEqual(r.novos.length, 1);
  const igual = v.apurar(rondas, { mapas: [TRAB_B, TRAB_A], textoDaLinha: () => 'a mesma frase' });
  assert.strictEqual(igual.secas, 1, 'mesma linha com o mesmo texto deixou de ser repeticao: ' + JSON.stringify(igual));
  const semTexto = v.apurar(rondas, { mapas: [TRAB_B, TRAB_A], textoDaLinha: () => null });
  assert.strictEqual(semTexto.secas, 1, 'sem o texto da linha a conta tem de ser a de antes');
  // s104 (R1 da D469 de veredito.js, mutacoes M2/M4 sobreviviam): sem texto na 1a vez, a conta segue a de antes
  // mesmo que a ronda seguinte traga texto; e espaco/fim de linha diferente nao e reescrita.
  const semTextoAntes = v.apurar(rondas, { mapas: [TRAB_B, TRAB_A],
    textoDaLinha: (indice) => (indice === 0 ? null : 'bloqueios de portao, que o plugin conta') });
  assert.strictEqual(semTextoAntes.secas, 1, 'sem texto na 1a vez, o texto da 2a nao pode virar achado novo');
  const soEspaco = v.apurar(rondas, { mapas: [TRAB_B, TRAB_A],
    textoDaLinha: (indice) => (indice === 0 ? '  a mesma   frase\r' : 'a mesma frase') });
  assert.strictEqual(soEspaco.secas, 1, 'so espaco/fim de linha diferente virou linha reescrita');
});

test('D244/defeito 3: arquivo citado com caminho ainda acha o lado', () => {
  const r = v.apurar([[P1('.claude/sworn/revisao/1/B.txt', 10)]], { mapas: [TRAB_A] });
  assert.strictEqual(r.secas, 1);
});

test('D244/defeito 3: refutado com prova nao molha; sem prova e recusado', () => {
  const vd = P1('A.txt', 7);
  const ref = [{ ronda: 1, lente: 'design', arquivo: 'A.txt', linha: 7, severidade: 'P1', prova: 'css/01.css:12 define o token' }];
  // 0.3.3, item 1: a 2a ronda seca era `[]`; agora e um veredito sem achados (ronda sem veredito e erro).
  const r = v.apurar([[vd], [veredito('design', [])]], { mapas: [TRAB_A, TRAB_A], refutados: ref });
  assert.strictEqual(r.motivo, 'duas rondas secas seguidas: aprovado', JSON.stringify(r));
  assert.throws(() => v.apurar([[vd]], { mapas: [TRAB_A],
    refutados: [{ ronda: 1, lente: 'design', arquivo: 'A.txt', linha: 7 }] }), /prova/);
});

test('D244/defeito 3: no teto, os abertos contados sao so os do lado novo nao refutados', () => {
  const r = v.apurar([[P1('A.txt', 1), P1('B.txt', 2, 'borda')], [P1('A.txt', 3)], [P1('A.txt', 4)]],
    { mapas: [TRAB_A, TRAB_A, TRAB_A] });
  assert.match(r.motivo, /teto de 3 rondas com 3 achado/);
});

test('D244/defeito 3: sem mapas (chamada antiga), a conta e a de antes', () => {
  const r = v.apurar([[P1('B.txt', 10)]]);
  assert.strictEqual(r.secas, 0, 'sem mapa nao da para saber o lado: conta, como antes');
});

// T14 ronda 1 (lente correcao): o inspetor que cita "A.txt:120" no campo arquivo perdia o lado, e
// o achado do lado antigo voltava a molhar - o defeito 3 de novo, calado.
test('T14: arquivo citado com a linha colada ainda acha o lado', () => {
  for (const arq of ['A.txt:120', 'A.txt:120-124', '.claude/sworn/revisao/1/A.txt:7']) {
    const r = v.apurar([[P1(arq, 120)]], { mapas: [TRAB_B] });
    assert.strictEqual(r.secas, 1, arq + ' e do lado HEAD: ' + JSON.stringify(r));
    assert.strictEqual(r.achadosDoLadoAntigo.length, 1, arq);
  }
  // controle: o que nao e A nem B segue sem lado, e conta
  assert.strictEqual(v.apurar([[P1('A.txt.bak', 1)]], { mapas: [TRAB_B] }).secas, 0);
});

// T14 ronda 2 (lente correcao): outras formas que um inspetor escreve de verdade.
test('T14: citacao com linha por extenso, ancora ou espaco ainda acha o lado', () => {
  for (const arq of ['A.txt linha 45', 'A.txt#L12', 'A.txt: 120', ' a.txt ', 'C:\\x\\rev\\A.txt (linha 3)']) {
    const r = v.apurar([[P1(arq, 45)]], { mapas: [TRAB_B] });
    assert.strictEqual(r.secas, 1, JSON.stringify(arq) + ' e do lado HEAD: ' + JSON.stringify(r));
  }
  // controles: os dois rotulos juntos, ou nome que so contem A.txt, nao tem lado - e contam
  for (const arq of ['A.txt e B.txt', 'XA.txt', 'A.txt.bak', 'A.txtx']) {
    assert.strictEqual(v.apurar([[P1(arq, 1)]], { mapas: [TRAB_B] }).secas, 0, JSON.stringify(arq));
  }
});

// T14 ronda 2 (lente borda): `linha: true` virava 1 por coercao e derrubava o achado da linha 1.
test('T14: refutacao com ronda, linha ou lente mal formadas e recusada com o motivo', () => {
  const base = { ronda: 1, lente: 'correcao', arquivo: 'A.txt', linha: 1, severidade: 'P1', prova: 'x.js:1' };
  for (const [campo, valor] of [['linha', true], ['linha', ''], ['linha', '1'], ['linha', 0], ['ronda', '1'],
    ['ronda', null], ['lente', ''], ['lente', 3]]) {
    const r = Object.assign({}, base, { [campo]: valor });
    assert.throws(() => v.apurar([[P1('A.txt', 1, 'correcao')]], { mapas: [TRAB_A], refutados: [r] }),
      new RegExp(campo), campo + '=' + JSON.stringify(valor));
  }
  // lente com caixa ou espaco diferente ainda casa
  const ok = v.apurar([[P1('A.txt', 1, 'correcao')]], { mapas: [TRAB_A],
    refutados: [Object.assign({}, base, { lente: ' Correcao ' })] });
  assert.strictEqual(ok.secas, 1, JSON.stringify(ok));
});

// T14 ronda 1 (lente borda): refutacao sem A.txt/B.txt casava por null === null com um achado que
// tambem nao citava A nem B, e o achado sumia da apuracao.
test('T14: refutacao tem de citar A.txt ou B.txt', () => {
  const vd = P1('A.txt.bak', 42, 'correcao');
  for (const arquivo of ['', undefined, 'mapa.json']) {
    assert.throws(() => v.apurar([[vd]], { mapas: [TRAB_A],
      refutados: [{ ronda: 1, lente: 'correcao', arquivo: arquivo, linha: 42, prova: 'x.js:1' }] }), /A\.txt ou B\.txt/,
    String(arquivo));
  }
  // controle: a refutacao certa segue aceita
  const ok = v.apurar([[P1('A.txt', 42, 'correcao')]], { mapas: [TRAB_A],
    refutados: [{ ronda: 1, lente: 'correcao', arquivo: 'A.txt:42', linha: 42, severidade: 'P1', prova: 'x.js:1' }] });
  assert.strictEqual(ok.secas, 1, JSON.stringify(ok));
});

// D246 sec. 4.2: a virgula (e qualquer nao-palavra) e fronteira antes do nome. `A.txt,B.txt` cita os dois
// lados e fica sem lado; antes dava `A`, e o achado ia para o lado antigo.
test('D246: rotulo depois de virgula ou outra pontuacao conta', () => {
  for (const arq of ['A.txt,B.txt', 'A.txt;B.txt', '[A.txt,B.txt]', 'copia.A.txt']) {
    assert.strictEqual(v.apurar([[P1(arq, 1)]], { mapas: [TRAB_B] }).secas, 0, JSON.stringify(arq));
  }
  // um rotulo so, entre pontuacao, ainda acha o lado (A e o HEAD aqui)
  for (const arq of ['"A.txt"', '[A.txt]', 'arquivo=A.txt']) {
    assert.strictEqual(v.apurar([[P1(arq, 1)]], { mapas: [TRAB_B] }).secas, 1, JSON.stringify(arq));
  }
});

// D246 sec. 4.3: a refutacao casa pela severidade. Refutar o P1 de uma linha apagava o P0 da mesma lente e
// linha - medido antes: novos = 0.
test('D246: refutacao exige severidade e so derruba o achado dela', () => {
  const vd = { lente: 'correcao', melhor: 'A', achados: [
    { estado: 'confirmado', trecho: 'x', severidade: 'P0', arquivo: 'A.txt', linha: 5, descricao: 'apaga tudo' },
    { estado: 'confirmado', trecho: 'x', severidade: 'P1', arquivo: 'A.txt', linha: 5, descricao: 'mensagem ruim' }] };
  const ref = { ronda: 1, lente: 'correcao', arquivo: 'A.txt', linha: 5, severidade: 'P1', prova: 'x.js:1' };
  const r = v.apurar([[vd]], { mapas: [TRAB_A], refutados: [ref] });
  assert.strictEqual(r.secas, 0, JSON.stringify(r));
  assert.deepStrictEqual(r.novos.map((a) => a.severidade), ['P0'], JSON.stringify(r));
  for (const sev of [undefined, '', 'p1', 'P3', 1]) {
    assert.throws(() => v.apurar([[vd]], { mapas: [TRAB_A], refutados: [Object.assign({}, ref, { severidade: sev })] }),
      /severidade/, JSON.stringify(sev));
  }
});

// 0.3.3, item 1: ronda sem nenhum veredito contava como seca, e duas dessas fechavam aprovado
// (`apurar([[], []])`, placar 0/0/0). Voto que falta nao e voto a favor: recusa e diz qual ronda.
test('0.3.3/item 1: ronda sem nenhum veredito e recusada e diz qual ronda; nao e ronda seca', () => {
  const seca = [veredito('correcao', [])];
  assert.throws(() => v.apurar([[], []]), /ronda 1 sem nenhum veredito/);
  assert.throws(() => v.apurar([[]]), /ronda 1 sem nenhum veredito/);
  assert.throws(() => v.apurar([seca, []]), /ronda 2 sem nenhum veredito/);
  assert.throws(() => v.apurar([seca, seca, []]), /ronda 3 sem nenhum veredito/);
  assert.throws(() => v.apurar([[P1('A.txt', 1)], undefined]), /ronda 2 sem nenhum veredito/);
  // controle: a ronda seca de verdade e um veredito sem achados, e segue fechando aprovado
  assert.strictEqual(v.apurar([seca, seca]).motivo, 'duas rondas secas seguidas: aprovado');
});

// Frente sworn-pendencias, T2 do plano dos 82.
test('T2/F2-14: apurar sem nenhuma ronda (lista vazia, ou o que nao e lista) lanca "nenhuma ronda para apurar"', () => {
  for (const entrada of [[], undefined, null, 'x', {}, 5]) {
    assert.throws(() => v.apurar(entrada), /nenhuma ronda para apurar/, JSON.stringify(entrada));
  }
  // controle: com uma ronda de verdade apura, como antes
  assert.strictEqual(v.apurar([[veredito('correcao', [])]]).ronda, 1);
});

test('T2/F2-15: ronda sem veredito diz o proximo passo, e segue dizendo qual ronda e que ela nao e seca', () => {
  assert.throws(() => v.apurar([[veredito('correcao', [])], []]), (e) => {
    assert.match(e.message, /ronda 2 sem nenhum veredito/);
    assert.match(e.message, /ronda sem voto nao e ronda seca/);
    assert.match(e.message, /grave os vereditos da ronda 2 na pasta vereditos dela e rode de novo/);
    return true;
  });
});

test('T2/F6-03: entrada de refutados.json que nao e objeto diz "entrada invalida" e a posicao, nao "sem prova"', () => {
  const ok = { ronda: 1, lente: 'correcao', arquivo: 'A.txt', linha: 1, severidade: 'P1', prova: 'x.js:1' };
  for (const ruim of [null, 5, 'texto', [], [ok], true]) {
    assert.throws(() => v.apurar([[veredito('correcao', [])]], { refutados: [ruim] }), (e) => {
      assert.match(e.message, /^entrada invalida no refutados\.json \(posicao 1\): cada refutacao e um objeto \{ ronda, lente, arquivo, linha, severidade, prova \}/,
        JSON.stringify(ruim));
      assert.doesNotMatch(e.message, /sem prova/);
      return true;
    });
  }
  // a posicao e a da entrada ruim na lista (a partir de 1)
  assert.throws(() => v.apurar([[veredito('correcao', [])]], { refutados: [ok, null] }), /\(posicao 2\)/);
  // controle: objeto sem prova segue "refutacao sem prova"
  for (const semProva of [{}, { ronda: 1, lente: 'correcao' }, Object.assign({}, ok, { prova: '  ' })]) {
    assert.throws(() => v.apurar([[veredito('correcao', [])]], { refutados: [semProva] }), /refutacao sem prova/);
  }
});

// T11-4: a lente de seguranca de codigo ganha as tres conferencias da lente de tela (a Lente 8 da
// rubrica) antes de um achado poder ser P0; sem confirmar a intencao, nasce P2 com pergunta.
test('veredito: a pergunta da lente seguranca cobra as tres conferencias e o P2 sem intencao confirmada', () => {
  const l = v.LENTES.find((x) => x.chave === 'seguranca');
  assert.strictEqual(l.titulo, 'Seguranca e dado sensivel', 'o apurar casa a refutacao pelo titulo');
  const p = l.pergunta;
  assert.ok(/Segredo em texto, log com dado do usuario, entrada nao validada que vira comando ou caminho\./.test(p),
    'a pergunta de busca que ja existia tem de seguir inteira');
  assert.ok(/chamador(es)? real|chamadores reais/i.test(p), '1: chamadores reais, nao o caminho hipotetico');
  assert.ok(/leitura/i.test(p) && /mutac/i.test(p), '2: leitura nao e mutacao');
  assert.ok(/desenho deliberado/i.test(p), '3: desenho deliberado nao e falha');
  assert.ok(/P2/.test(p), 'sem confirmar a intencao o achado nasce P2');
  assert.ok(/nunca P0/i.test(p), 'e nunca P0');
  assert.ok(!/[^\x00-\x7f]/.test(p), 'a pergunta tem de ser ASCII');
});

test('veredito: as outras oito lentes de codigo seguem com a pergunta de antes', () => {
  const antes = {
    correcao: 'Qual dos dois quebra? Entrada concreta que produz resultado errado, com arquivo:linha.',
    escopo: 'O que mudou alem do necessario? Renomeacao, extracao, formatacao junto de correcao funcional.',
    estados: 'Erro, vazio, carregando, limite e timeout estao tratados, ou so o caso feliz?',
    borda: 'null, string vazia, lista vazia, numero negativo, unicode, caminho com espaco, arquivo enorme.',
    manutencao: 'O que um leitor novo entende errado? Nome que mente, funcao que faz duas coisas, erro engolido.',
    microcopy: 'Mensagem que nao diz o que fazer a seguir, jargao, ingles solto, tom que culpa o usuario.',
    medidor: 'Teste, baseline, threshold, skip ou mock mudaram junto com o codigo que eles cobrem?',
    design: 'Cite o token literal ou a tela irm\u00e3 de refer\u00eancia. Valor cru, gradiente, sombra larga, card aninhado ou tipografia fluida onde o sistema nao os tem. Sem citar token ou coordenada, o veredito nao conta.'
  };
  const hoje = {};
  // D554: a `enxuto` e nova, e tem teste proprio (acima); esta guarda as que ja existiam.
  for (const l of v.LENTES) if (l.chave !== 'seguranca' && l.chave !== 'enxuto') hoje[l.chave] = l.pergunta;
  assert.deepStrictEqual(hoje, antes);
});

// ---------------------------------------------------------------------------------------------
// D387 (#11c): paresCandidatos e provaveisMesmos. O juiz so avisa: nenhuma conta muda.
// ---------------------------------------------------------------------------------------------

const MAPA_AB = { A: 'trabalho', B: 'HEAD' };
const MAPA_BA = { A: 'HEAD', B: 'trabalho' };
const CHAVES = (pares) => pares.map((p) => [p.novo.chave, p.outro.chave]);

test('D387/pares: distancia 10 entra e 11 fica fora', () => {
  const r = v.apurar([[veredito('correcao', [achado('P1', 'A.txt', 50), achado('P2', 'A.txt', 60), achado('P2', 'A.txt', 39)])]],
    { mapas: [MAPA_AB] });
  assert.deepStrictEqual(CHAVES(r.paresCandidatos), [['P1|trabalho|50|correcao', 'P2|trabalho|60|correcao']]);
  assert.strictEqual(r.paresCandidatos[0].distancia, 10);
  assert.strictEqual(v.DISTANCIA_PAR, 10);
});

test('D387/pares: o par leva o que o juiz le dos dois lados', () => {
  const r = v.apurar([[veredito('correcao', [achado('P1', 'A.txt', 5, 'quebra um')]),
    veredito('borda', [achado('P2', 'A.txt', 8, 'quebra dois')])]], { mapas: [MAPA_AB] });
  assert.strictEqual(r.paresCandidatos.length, 1);
  assert.deepStrictEqual(r.paresCandidatos[0], {
    novo: { chave: 'P1|trabalho|5|correcao', ronda: 1, lente: 'correcao', severidade: 'P1', linha: 5, descricao: 'quebra um' },
    outro: { chave: 'P2|trabalho|8|borda', ronda: 1, lente: 'borda', severidade: 'P2', linha: 8, descricao: 'quebra dois' },
    distancia: 3
  });
});

test('D387/pares: a mesma chave nunca faz par com ela mesma', () => {
  // mesma lente, mesma severidade, mesmo lado, mesma linha, duas vezes: um achado so
  const r = v.apurar([[veredito('correcao', [achado('P1', 'A.txt', 5), achado('P1', 'A.txt', 5)])]], { mapas: [MAPA_AB] });
  assert.deepStrictEqual(r.paresCandidatos, []);
});

test('D387/pares: sem P0/P1 novo na ultima ronda nao ha par', () => {
  const r1 = v.apurar([[veredito('correcao', [achado('P1', 'A.txt', 5), achado('P2', 'A.txt', 6)])],
    [veredito('correcao', [achado('P2', 'A.txt', 7), achado('P2', 'A.txt', 9)])]], { mapas: [MAPA_AB, MAPA_AB] });
  assert.deepStrictEqual(r1.paresCandidatos, [], 'P1 so da ronda 1 nao e A');
  const r2 = v.apurar([[veredito('correcao', [achado('P2', 'A.txt', 5), achado('P2', 'A.txt', 6)])]], { mapas: [MAPA_AB] });
  assert.deepStrictEqual(r2.paresCandidatos, [], 'so P2 nao e A');
});

test('D387/pares: o novo da ultima ronda faz par com achado de ronda anterior, e a ronda do par e a 1a em que a chave apareceu', () => {
  const r = v.apurar([[veredito('correcao', [achado('P2', 'A.txt', 20, 'antigo')])],
    [veredito('correcao', [achado('P2', 'A.txt', 20, 'antigo')]), veredito('borda', [achado('P1', 'A.txt', 25, 'novo')])]],
  { mapas: [MAPA_AB, MAPA_AB] });
  assert.deepStrictEqual(CHAVES(r.paresCandidatos), [['P1|trabalho|25|borda', 'P2|trabalho|20|correcao']]);
  assert.strictEqual(r.paresCandidatos[0].outro.ronda, 1);
  assert.strictEqual(r.paresCandidatos[0].novo.ronda, 2);
});

test('D387/pares: achado refutado ainda serve de B (e a repeticao de algo ja tratado)', () => {
  const r = v.apurar([[veredito('correcao', [achado('P1', 'A.txt', 20)])],
    [veredito('correcao', [achado('P1', 'A.txt', 20)]), veredito('borda', [achado('P1', 'A.txt', 24)])]],
  { mapas: [MAPA_AB, MAPA_AB], refutados: [{ ronda: 1, lente: 'correcao', arquivo: 'A.txt', linha: 20, severidade: 'P1', prova: 'x.js:1' }] });
  assert.deepStrictEqual(CHAVES(r.paresCandidatos), [['P1|trabalho|24|borda', 'P1|trabalho|20|correcao']]);
});

test('D387/pares: achado do lado HEAD nao entra, nem como A nem como B', () => {
  // lado novo = B nas duas rondas (MAPA_BA): A.txt e HEAD
  const r = v.apurar([[veredito('correcao', [achado('P2', 'B.txt', 10), achado('P2', 'A.txt', 12)])],
    [veredito('borda', [achado('P1', 'A.txt', 11), achado('P1', 'B.txt', 11)])]], { mapas: [MAPA_BA, MAPA_BA] });
  // o P1 de B.txt:11 (ultima ronda) so faz par com o P2 de B.txt:10; os de A.txt (HEAD) ficam fora
  assert.deepStrictEqual(CHAVES(r.paresCandidatos), [['P1|trabalho|11|borda', 'P2|trabalho|10|correcao']]);
  const soHead = v.apurar([[veredito('correcao', [achado('P1', 'B.txt', 11), achado('P2', 'B.txt', 12)])]], { mapas: [MAPA_AB] });
  assert.deepStrictEqual(soHead.paresCandidatos, []);
});

test('D387/pares: com mapa, o mesmo lado vale mesmo com os rotulos trocados entre as rondas', () => {
  const r = v.apurar([[veredito('correcao', [achado('P2', 'A.txt', 30, 'velho')])],
    [veredito('borda', [achado('P1', 'B.txt', 33, 'novo')])]], { mapas: [MAPA_AB, MAPA_BA] });
  assert.deepStrictEqual(CHAVES(r.paresCandidatos), [['P1|trabalho|33|borda', 'P2|trabalho|30|correcao']]);
});

test('D387/pares: sem mapa, o mesmo rotulo; rotulos diferentes nao fazem par', () => {
  const mesmo = v.apurar([[veredito('correcao', [achado('P1', 'A.txt', 5), achado('P2', 'A.txt', 9)])]]);
  assert.strictEqual(mesmo.paresCandidatos.length, 1);
  const outro = v.apurar([[veredito('correcao', [achado('P1', 'A.txt', 5), achado('P2', 'B.txt', 9)])]]);
  assert.deepStrictEqual(outro.paresCandidatos, []);
});

test('D387/pares: dois novos da ultima ronda dao um par so', () => {
  const r = v.apurar([[veredito('correcao', [achado('P1', 'A.txt', 5)]), veredito('borda', [achado('P0', 'A.txt', 8)])]],
    { mapas: [MAPA_AB] });
  assert.strictEqual(r.paresCandidatos.length, 1);
  assert.deepStrictEqual(CHAVES(r.paresCandidatos), [['P1|trabalho|5|correcao', 'P0|trabalho|8|borda']]);
});

test('D387/conferirMesmos: forma errada lanca erro com a posicao e o que fazer', () => {
  const existentes = new Set(['k1', 'k2']);
  const erro = (lista, re) => assert.throws(() => v.conferirMesmos(lista, existentes), re);
  erro({}, /mesmos\.json nao e uma lista/);
  erro(null, /mesmos\.json nao e uma lista \(veio null\)/);
  erro(['x'], /posicao 1.*objeto/);
  erro([null], /posicao 1/);
  erro([[]], /posicao 1/);
  erro([{ novo: 'k1', outro: 'k2', resposta: 'sim' }, { novo: 5, outro: 'k2', resposta: 'sim' }], /posicao 2.*"novo"/);
  erro([{ novo: 'k1', outro: 'nao-existe', resposta: 'sim' }], /"outro" \(nao-existe\) nao e a chave de nenhum achado/);
  erro([{ novo: 'k1', outro: 'k2', resposta: 'talvez' }], /"resposta" tem de ser/);
  erro([{ novo: 'k1', outro: 'k2' }], /"resposta" tem de ser/);
  assert.deepStrictEqual(v.conferirMesmos([], existentes), []);
  assert.strictEqual(v.conferirMesmos([{ novo: 'k1', outro: 'k2', resposta: 'nao-sei' }], existentes).length, 1);
});

test('D391/conferirMesmos: novo igual a outro lanca erro (um achado nao e par dele mesmo)', () => {
  const existentes = new Set(['k1', 'k2']);
  assert.throws(() => v.conferirMesmos([{ novo: 'k1', outro: 'k2', resposta: 'sim' }, { novo: 'k1', outro: 'k1', resposta: 'sim' }],
    existentes), /posicao 2.*"novo" e "outro" sao a mesma chave \(k1\)/);
  assert.throws(() => v.conferirMesmos([{ novo: 'k2', outro: 'k2', resposta: 'nao' }], existentes), /mesma chave/);
});

test('D387/apurar: mesmos com chave que nao existe entre os achados apurados lanca erro', () => {
  assert.throws(() => v.apurar([[veredito('correcao', [achado('P1', 'A.txt', 5)])]],
    { mapas: [MAPA_AB], mesmos: [{ novo: 'P1|trabalho|5|correcao', outro: 'P1|trabalho|99|correcao', resposta: 'sim' }] }),
  /mesmos\.json.*nao e a chave de nenhum achado/);
});

test('D387/provaveisMesmos: so a resposta sim vira aviso; nao, nao-sei e ausencia nao', () => {
  const rondas = [[veredito('correcao', [achado('P2', 'A.txt', 20, 'a')])],
    [veredito('correcao', [achado('P2', 'A.txt', 20, 'a')]), veredito('borda', [achado('P1', 'A.txt', 24, 'b')])]];
  const op = { mapas: [MAPA_AB, MAPA_AB] };
  const K_B = 'P1|trabalho|24|borda';
  const K_A = 'P2|trabalho|20|correcao';
  const sim = v.apurar(rondas, Object.assign({ mesmos: [{ novo: K_B, outro: K_A, resposta: 'sim' }] }, op));
  assert.deepStrictEqual(sim.provaveisMesmos, [{ chave: K_B, mesmoQue: K_A, lente: 'correcao', ronda: 1,
    texto: 'provavel mesmo defeito que ' + K_A + ' (lente correcao, ronda 1)' }]);
  for (const resposta of ['nao', 'nao-sei']) {
    assert.deepStrictEqual(v.apurar(rondas, Object.assign({ mesmos: [{ novo: K_B, outro: K_A, resposta }] }, op)).provaveisMesmos, []);
  }
  assert.deepStrictEqual(v.apurar(rondas, op).provaveisMesmos, [], 'sem mesmos: lista vazia');
  // a chave pode vir em "outro": a resposta vale para quem e novo da ultima ronda
  const invertido = v.apurar(rondas, Object.assign({ mesmos: [{ novo: K_A, outro: K_B, resposta: 'sim' }] }, op));
  assert.deepStrictEqual(invertido.provaveisMesmos.map((p) => [p.chave, p.mesmoQue]), [[K_B, K_A]]);
  // quem nao e novo da ultima ronda (K_A, so da ronda 1) nunca recebe o aviso
  assert.ok(sim.provaveisMesmos.every((p) => p.chave !== K_A));
});

test('D387/contagem: com e sem mesmos, secas, encerrar, motivo, novos, placar e achados do lado antigo sao identicos', () => {
  const casos = [
    [[veredito('correcao', [achado('P2', 'A.txt', 20)])],
      [veredito('correcao', [achado('P2', 'A.txt', 20)]), veredito('borda', [achado('P1', 'A.txt', 24)])]],
    [[veredito('correcao', [achado('P1', 'A.txt', 20)])], [veredito('borda', [achado('P1', 'A.txt', 22)])],
      [veredito('estados', [achado('P1', 'A.txt', 25)])]],
    [[veredito('correcao', [])], [veredito('correcao', [])]]
  ];
  const mapas = [MAPA_AB, MAPA_AB, MAPA_AB];
  const todosSim = (rondas) => v.apurar(rondas, { mapas: mapas }).paresCandidatos
    .map((p) => ({ novo: p.novo.chave, outro: p.outro.chave, resposta: 'sim' }));
  for (const rondas of casos) {
    const sem = v.apurar(rondas, { mapas: mapas });
    const com = v.apurar(rondas, { mapas: mapas, mesmos: todosSim(rondas) });
    for (const campo of ['ronda', 'secas', 'encerrar', 'motivo', 'novos', 'placar', 'achadosDoLadoAntigo', 'refutados', 'paresCandidatos']) {
      assert.deepStrictEqual(com[campo], sem[campo], campo + ' muda com mesmos');
    }
  }
  // o caso 2 chega ao teto de 3 rondas com 3 P1 abertos, e o juiz dizendo "sim" nao o desfaz
  const teto = v.apurar(casos[1], { mapas: mapas, mesmos: todosSim(casos[1]) });
  assert.strictEqual(teto.encerrar, true);
  assert.match(teto.motivo, /teto de 3 rondas com 3 achado/);
  assert.ok(teto.provaveisMesmos.length > 0);
});

// ---------------------------------------------------------------------------------------------
// 0.5.2 (D396): P2 n. 23, 24, 37, 38 e 41 do plano secao 2.1
// ---------------------------------------------------------------------------------------------

test('D396 n. 23: muitos achados no mesmo arquivo nao viram conta quadratica, e os pares seguem os mesmos', () => {
  // 30.000 P1 a 20 linhas um do outro: nenhum par; antes, 9e8 comparacoes
  const longe = [];
  for (let i = 0; i < 30000; i++) longe.push(achado('P1', 'A.txt', 1 + i * 20));
  const t0 = Date.now();
  const r = v.apurar([[veredito('correcao', longe)]], { mapas: [MAPA_AB] });
  assert.ok(Date.now() - t0 < 2000, 'demorou ' + (Date.now() - t0) + ' ms');
  assert.deepStrictEqual(r.paresCandidatos, []);
  // ordem e conteudo: a de antes (a ordem em que os achados apareceram), com vizinhos dos dois lados
  const perto = v.apurar([[veredito('correcao', [achado('P2', 'A.txt', 40), achado('P1', 'A.txt', 30), achado('P2', 'A.txt', 21),
    achado('P1', 'A.txt', 35), achado('P2', 'A.txt', 19)])]], { mapas: [MAPA_AB] });
  assert.deepStrictEqual(CHAVES(perto.paresCandidatos), [
    ['P1|trabalho|30|correcao', 'P2|trabalho|40|correcao'],
    ['P1|trabalho|30|correcao', 'P2|trabalho|21|correcao'],
    ['P1|trabalho|30|correcao', 'P1|trabalho|35|correcao'],
    ['P1|trabalho|35|correcao', 'P2|trabalho|40|correcao']
  ]);
});

test('D396 n. 24: mesmos null pela API e o mesmo que sem juiz (nao e erro)', () => {
  const rondas = [[veredito('correcao', [achado('P1', 'A.txt', 5), achado('P2', 'A.txt', 8)])]];
  const r = v.apurar(rondas, { mapas: [MAPA_AB], mesmos: null });
  assert.deepStrictEqual(r.provaveisMesmos, []);
  assert.strictEqual(r.paresCandidatos.length, 1);
});

test('D396 n. 37/38: achado de linha 0 ou negativa e descartado (e nao molha a ronda que nao se podia refutar)', () => {
  for (const linha of [0, -3]) {
    const r = v.validarVeredito(veredito('correcao', [achado('P1', 'A.txt', linha), achado('P1', 'A.txt', 1)]));
    assert.strictEqual(r.achadosValidos.length, 1, 'linha ' + linha + ' passou');
    assert.ok(r.erros.some((e) => /a partir de 1/.test(e)), r.erros.join(' | '));
  }
  // o n. 38: refutar exige linha >= 1; o achado de linha 0 molhava a ronda sem saida
  const ap = v.apurar([[veredito('correcao', [achado('P1', 'A.txt', 0)])], [veredito('correcao', [])]]);
  assert.strictEqual(ap.secas, 2, 'o P1 de linha 0 molhou a ronda');
});

test('D396 n. 41: par autorreferente com resposta invalida recebe a mensagem da resposta primeiro', () => {
  const existentes = new Set(['k1', 'k2']);
  assert.throws(() => v.conferirMesmos([{ novo: 'k1', outro: 'k1', resposta: 'talvez' }], existentes), /"resposta" tem de ser/);
  // resposta valida: segue a mensagem da mesma chave
  assert.throws(() => v.conferirMesmos([{ novo: 'k1', outro: 'k1', resposta: 'sim' }], existentes), /mesma chave/);
});

// Lote 2 da D422. RV-03: a linha em texto ("42") ou em intervalo ("40-45") era descartada calada.
test('RV-03: linha em texto ou intervalo vira o numero da 1a linha; sem numero segue descartada', () => {
  for (const [bruta, esperada] of [['42', 42], [' 42 ', 42], ['40-45', 40], ['40\u201345', 40], ['40 - 45', 40]]) {
    const r = v.validarVeredito(veredito('correcao', [achado('P0', 'B.txt', bruta)]));
    assert.deepStrictEqual(r.erros, [], JSON.stringify(bruta));
    assert.strictEqual(r.achadosValidos.length, 1, JSON.stringify(bruta));
    assert.strictEqual(r.achadosValidos[0].linha, esperada, JSON.stringify(bruta));
  }
  for (const ruim of ['', 'abc', '0', '-3', '4.5', 4.5, 0, null, undefined, true]) {
    const r = v.validarVeredito(veredito('correcao', [achado('P0', 'B.txt', ruim)]));
    assert.strictEqual(r.achadosValidos.length, 0, JSON.stringify(ruim));
    assert.strictEqual(r.erros.length, 1, JSON.stringify(ruim));
  }
  const inteiro = achado('P1', 'B.txt', 7);
  assert.strictEqual(v.validarVeredito(veredito('correcao', [inteiro])).achadosValidos[0], inteiro, 'linha ja inteira passa o mesmo objeto');
});

test('RV-03: o P0 com linha em texto molha a ronda e o intervalo e refutavel pela 1a linha', () => {
  const ap = v.apurar([[veredito('correcao', [achado('P0', 'B.txt', '42')])], [veredito('correcao', [achado('P0', 'B.txt', '40-45')])]]);
  assert.strictEqual(ap.secas, 0);
  assert.strictEqual(ap.encerrar, false);
  assert.strictEqual(ap.novos.length, 1);
  const ref = v.apurar([[veredito('correcao', [achado('P0', 'B.txt', '40-45')])]],
    { refutados: [{ ronda: 1, lente: 'correcao', arquivo: 'B.txt', linha: 40, severidade: 'P0', prova: 'src/a.js:40' }] });
  assert.strictEqual(ref.novos.length, 0, 'refutado pela linha 40');
});

// RV-02: o mesmo defeito, com a lente em outra grafia (chave, titulo, caixa), contava como NOVO e a ronda nunca secava.
test('RV-02: a lente em outra grafia (chave, titulo, caixa) e a mesma chave de repeticao', () => {
  const grafias = ['correcao', 'Correcao', 'Correcao e regressao', ' CORRECAO '];
  const rondas = grafias.map((g) => [veredito(g, [achado('P1', 'B.txt', 10)])]);
  const ap2 = v.apurar(rondas.slice(0, 2));
  assert.strictEqual(ap2.secas, 1, 'a repeticao com outra grafia nao e achado novo');
  assert.strictEqual(ap2.novos.length, 0);
  const ap3 = v.apurar(rondas.slice(0, 3));
  assert.strictEqual(ap3.motivo, 'duas rondas secas seguidas: aprovado');
  // sem familia ambigua: o titulo de tela e o de codigo nao se confundem
  const dois = v.apurar([[veredito('Estados obrigatorios (codigo)', [achado('P1', 'B.txt', 10)])],
    [veredito('Estados obrigatorios (tela)', [achado('P1', 'B.txt', 10)])]]);
  assert.strictEqual(dois.novos.length, 1, 'lentes de familias diferentes seguem sendo achados diferentes');
  // a chave da saida e a canonica
  assert.strictEqual(ap2.paresCandidatos.length, 0);
  assert.strictEqual(v.chaveDaLente('Correcao e regressao'), 'correcao');
});

test('RV-02: a refutacao casa a lente por chave ou titulo, qualquer um dos dois', () => {
  for (const g of ['correcao', 'Correcao e regressao']) {
    const ap = v.apurar([[veredito('correcao', [achado('P1', 'B.txt', 10)])]],
      { refutados: [{ ronda: 1, lente: g, arquivo: 'B.txt', linha: 10, severidade: 'P1', prova: 'x' }] });
    assert.strictEqual(ap.novos.length, 0, g);
  }
});

// S7 da P2 (D426), L2-ver-1: o inspetor escreve o titulo com acento e o titulo canonico nao tem.
// Escapes \u para o arquivo seguir ASCII; a forma decomposta (NFD) tambem vale.
test('L2-ver-1: titulo com acento (composto ou decomposto) e a mesma lente do titulo sem acento', () => {
  assert.strictEqual(v.chaveDaLente('Corre\u00e7\u00e3o e regress\u00e3o'), 'correcao');
  assert.strictEqual(v.chaveDaLente('Corre\u0063\u0327\u0061\u0303o e regress\u0061\u0303o'), 'correcao');
  assert.strictEqual(v.chaveDaLente('Estados obrigat\u00f3rios (c\u00f3digo)'), 'estados');
  assert.strictEqual(v.chaveDaLente('Seguran\u00e7a e dado sens\u00edvel'), 'seguranca');
  // a chave de repeticao e a mesma: o acento nao faz o mesmo defeito virar achado novo
  const ap = v.apurar([[veredito('correcao', [achado('P1', 'B.txt', 10)])],
    [veredito('Corre\u00e7\u00e3o e regress\u00e3o', [achado('P1', 'B.txt', 10)])]]);
  assert.strictEqual(ap.secas, 1, 'a repeticao com acento nao e achado novo');
  // CONTROLE: lente desconhecida segue desconhecida, com ou sem acento
  assert.strictEqual(v.chaveDaLente('Corre\u00e7\u00e3o geral'), null);
});

// L2-ver-2: o intervalo vale pelo MENOR numero, em qualquer ordem. "45-40" valia 45 e "40-45" valia 40.
test('L2-ver-2: intervalo de linha vale pelo menor numero, escrito em qualquer ordem', () => {
  for (const [bruta, esperada] of [['40-45', 40], ['45-40', 40], ['45 \u2013 40', 40], ['45\u201440', 40], ['7-7', 7]]) {
    const r = v.validarVeredito(veredito('correcao', [achado('P1', 'B.txt', bruta)]));
    assert.deepStrictEqual(r.erros, [], JSON.stringify(bruta));
    assert.strictEqual(r.achadosValidos[0].linha, esperada, JSON.stringify(bruta));
  }
  // o menor tem de ser linha valida (>= 1): "0-5" nao vira 5 calado
  for (const ruim of ['0-5', '5-0']) {
    const r = v.validarVeredito(veredito('correcao', [achado('P1', 'B.txt', ruim)]));
    assert.strictEqual(r.achadosValidos.length, 0, ruim);
    assert.strictEqual(r.erros.length, 1, ruim);
  }
  // o intervalo escrito ao contrario e refutavel pela mesma linha do escrito em ordem
  const ref = v.apurar([[veredito('correcao', [achado('P0', 'B.txt', '45-40')])]],
    { refutados: [{ ronda: 1, lente: 'correcao', arquivo: 'B.txt', linha: 40, severidade: 'P0', prova: 'src/a.js:40' }] });
  assert.strictEqual(ref.novos.length, 0);
});

// L2-ver-3: meta.lente (o que o juiz le) e o texto do aviso usam a chave canonica, nao o que o inspetor escreveu.
test('L2-ver-3: meta.lente e provaveisMesmos levam a chave canonica da lente, nao a grafia do inspetor', () => {
  const mapa = { A: 'trabalho', B: 'HEAD' };
  const r1 = [veredito('Correcao e regressao', [achado('P1', 'A.txt', 5, 'um')])];
  const r2 = [veredito('Entrada e borda', [achado('P1', 'A.txt', 8, 'dois')])];
  const ap = v.apurar([r1, r2], { mapas: [mapa, mapa] });
  assert.deepStrictEqual(ap.paresCandidatos.map((p) => [p.novo.lente, p.outro.lente]), [['borda', 'correcao']]);
  const K_NOVO = 'P1|trabalho|8|borda';
  const K_VELHO = 'P1|trabalho|5|correcao';
  const com = v.apurar([r1, r2], { mapas: [mapa, mapa], mesmos: [{ novo: K_NOVO, outro: K_VELHO, resposta: 'sim' }] });
  assert.strictEqual(com.provaveisMesmos.length, 1);
  assert.strictEqual(com.provaveisMesmos[0].lente, 'correcao');
  assert.strictEqual(com.provaveisMesmos[0].texto, 'provavel mesmo defeito que ' + K_VELHO + ' (lente correcao, ronda 1)');
  // lente desconhecida: o texto normalizado, como na chave
  const desc = v.apurar([[veredito('  Lente Nova ', [achado('P1', 'A.txt', 5)])]], { mapas: [mapa] });
  assert.strictEqual(desc.novos.length, 1);
});

// L2-ver-4: "Microcopy" e o TITULO da lente de tela (ui-microcopy) e a CHAVE da de codigo (microcopy).
test('L2-ver-4: "Microcopy" (titulo da tela) nao vira a lente de codigo `microcopy`', () => {
  assert.strictEqual(v.chaveDaLente('microcopy'), 'microcopy', 'a chave exata e a lente de codigo');
  assert.strictEqual(v.chaveDaLente(' microcopy '), 'microcopy');
  assert.strictEqual(v.chaveDaLente('Microcopy'), 'ui-microcopy', 'o titulo exato e a lente de tela');
  assert.strictEqual(v.chaveDaLente(' Microcopy '), 'ui-microcopy');
  assert.strictEqual(v.chaveDaLente('ui-microcopy'), 'ui-microcopy');
  assert.strictEqual(v.chaveDaLente('Texto que o usuario le'), 'microcopy', 'o titulo da lente de codigo segue valendo');
  // caixa diferente das duas formas exatas: nao ha como saber a familia, e nao se adivinha
  assert.strictEqual(v.chaveDaLente('MICROCOPY'), null);
  // no apurar, as duas familias sao achados diferentes e a refutacao de uma nao apaga a outra
  const dois = v.apurar([[veredito('microcopy', [achado('P1', 'B.txt', 10)]), veredito('Microcopy', [achado('P1', 'B.txt', 10)])]]);
  assert.strictEqual(dois.novos.length, 2, 'codigo e tela na mesma linha sao dois achados');
  const ref = v.apurar([[veredito('microcopy', [achado('P1', 'B.txt', 10)]), veredito('Microcopy', [achado('P1', 'B.txt', 10)])]],
    { refutados: [{ ronda: 1, lente: 'Microcopy', arquivo: 'B.txt', linha: 10, severidade: 'P1', prova: 'src/a.js:10' }] });
  assert.strictEqual(ref.novos.length, 1, 'refutou so a de tela');
});

// D503/D508 (plano d503, Tarefa 3, escolhas E5-E8): veredito contra a referencia de topo, nas duas ordens.
function comRef(lente, vsA, vsB, achados, lacunas) {
  return { lente: lente, melhor: 'A', porQue: 'A.txt:1', achados: achados || [],
    vsReferencia: { A: vsA, B: vsB }, lacunas: lacunas || [] };
}
function lacuna(sev, arq, linha) {
  return { severidade: sev, arquivo: arq, linha: linha, descricao: 'R faz melhor' };
}
// Pacote com referencia: o trabalho e A na 1a passada; invertida troca, entao e B na 2a.
const MAPA_REF = { A: 'trabalho', B: 'HEAD' };
const INV_REF = { A: 'HEAD', B: 'trabalho' };
function rondaRef(pass1, pass2) { return { vereditos: pass1, invertida: { mapa: INV_REF, vereditos: pass2 } }; }
function apurarRef(rondas, extra) {
  return v.apurar(rondas.map((r) => r.vereditos), Object.assign({ mapas: rondas.map(() => MAPA_REF),
    invertidas: rondas.map((r) => r.invertida) }, extra || {}));
}

test('D503 E5: sem referencia, vsReferencia e lacunas nao sao exigidos (a regra de hoje)', () => {
  assert.deepStrictEqual(v.errosDoVeredito(veredito('correcao', [])), []);
  assert.deepStrictEqual(v.errosDoVeredito(veredito('correcao', []), { comReferencia: false }), []);
});

test('D503 E5: com referencia, vsReferencia {A,B} em vence/empata/perde e lacunas em lista sao exigidos', () => {
  const op = { comReferencia: true };
  assert.deepStrictEqual(v.errosDoVeredito(comRef('correcao', 'vence', 'perde'), op), []);
  assert.ok(v.errosDoVeredito(veredito('correcao', []), op).some((e) => /vsReferencia/.test(e)));
  assert.ok(v.errosDoVeredito(comRef('correcao', 'vence', 'ganha'), op).some((e) => /vsReferencia/.test(e)));
  assert.ok(v.errosDoVeredito(comRef('correcao', 'vence', undefined), op).some((e) => /vsReferencia/.test(e)));
  const semLista = comRef('correcao', 'vence', 'empata');
  semLista.lacunas = 'nenhuma';
  assert.ok(v.errosDoVeredito(semLista, op).some((e) => /lacunas/.test(e)));
  const semCampo = comRef('correcao', 'vence', 'empata');
  delete semCampo.lacunas;
  assert.ok(v.errosDoVeredito(semCampo, op).some((e) => /lacunas/.test(e)));
});

test('D503 E5: lacuna sem arquivo:linha de A ou B, sem severidade ou sem descricao e descartada', () => {
  const vd = comRef('correcao', 'vence', 'empata', [], [lacuna('P1', 'A.txt', 4), lacuna('P1', 'A.txt', 0),
    lacuna('P1', 'R.txt', 3), lacuna('P3', 'B.txt', 2), { severidade: 'P2', arquivo: 'B.txt', linha: 2, descricao: ' ' },
    lacuna('P2', 'B.txt', '7-9')]);
  const r = v.validarVeredito(vd, { comReferencia: true });
  assert.deepStrictEqual(r.lacunasValidas.map((l) => [l.severidade, l.arquivo, l.linha]), [['P1', 'A.txt', 4], ['P2', 'B.txt', 7]]);
  assert.strictEqual(r.erros.filter((e) => /lacuna/.test(e)).length, 4, r.erros.join(' | '));
  // sem referencia, lacunas nao se olham
  assert.deepStrictEqual(v.validarVeredito(vd).erros, []);
});

test('D503: sem invertidas, apurar devolve referencia null e a conta de hoje', () => {
  const r = v.apurar([[veredito('correcao', [])], [veredito('correcao', [])]]);
  assert.strictEqual(r.referencia, null);
  assert.strictEqual(r.motivo, 'duas rondas secas seguidas: aprovado');
});

test('D503 E6: empata ou vence nas duas ordens, sem lacuna P0/P1, com duas secas = aprovado', () => {
  // 1a passada: trabalho = A; 2a: trabalho = B (invertida)
  const r1 = rondaRef([comRef('correcao', 'vence', 'perde'), comRef('borda', 'empata', 'perde')],
    [comRef('correcao', 'perde', 'vence'), comRef('borda', 'perde', 'vence')]);
  const ap = apurarRef([r1, r1]);
  assert.strictEqual(ap.encerrar, true, ap.motivo);
  assert.strictEqual(ap.motivo, 'duas rondas secas seguidas: aprovado');
  assert.strictEqual(ap.referencia.pronta, true);
  const porLente = Object.fromEntries(ap.referencia.lentes.map((l) => [l.lente, l.resultado]));
  // correcao vence nas duas; borda: empata na 1a e vence na 2a = desacordo, vale empata
  assert.deepStrictEqual(porLente, { correcao: 'vence', borda: 'empata' });
});

test('D503 E6: perde a referencia em uma das ordens = nao aprovado, mesmo com duas secas', () => {
  const r1 = rondaRef([comRef('correcao', 'vence', 'empata')], [comRef('correcao', 'empata', 'perde')]);
  const ap = apurarRef([r1, r1]);
  assert.strictEqual(ap.encerrar, false, ap.motivo);
  assert.strictEqual(ap.referencia.pronta, false);
  assert.strictEqual(ap.referencia.lentes[0].resultado, 'perde');
  assert.deepStrictEqual([ap.referencia.lentes[0].ordem1, ap.referencia.lentes[0].ordem2], ['vence', 'perde']);
  assert.match(ap.motivo, /referencia/);
});

test('D503 E6: lacuna P0/P1 do lado trabalho barra; do lado HEAD e P2 nao barram', () => {
  const limpa = rondaRef([comRef('correcao', 'empata', 'empata', [], [lacuna('P1', 'B.txt', 3), lacuna('P2', 'A.txt', 5)])],
    [comRef('correcao', 'empata', 'empata', [], [lacuna('P1', 'A.txt', 3)])]);
  const ok = apurarRef([limpa, limpa]);
  assert.strictEqual(ok.referencia.pronta, true, JSON.stringify(ok.referencia));
  assert.strictEqual(ok.encerrar, true);
  assert.deepStrictEqual(ok.referencia.lacunas.map((l) => [l.severidade, l.passada, l.linha]), [['P2', 1, 5]]);
  const suja = rondaRef([comRef('correcao', 'empata', 'empata')],
    [comRef('correcao', 'empata', 'empata', [], [lacuna('P1', 'B.txt', 8)])]);
  const nao = apurarRef([suja, suja]);
  assert.strictEqual(nao.referencia.pronta, false);
  assert.strictEqual(nao.encerrar, false);
  assert.deepStrictEqual(nao.referencia.lacunas.map((l) => [l.lente, l.severidade, l.passada, l.linha]),
    [['correcao', 'P1', 2, 8]]);
});

test('D503 E6: lente sem a 2a passada fica incompleta e nao aprova', () => {
  const r1 = rondaRef([comRef('correcao', 'vence', 'perde'), comRef('borda', 'vence', 'perde')],
    [comRef('correcao', 'perde', 'vence')]);
  const ap = apurarRef([r1, r1]);
  assert.strictEqual(ap.referencia.pronta, false);
  const borda = ap.referencia.lentes.find((l) => l.lente === 'borda');
  assert.strictEqual(borda.resultado, 'incompleta');
  assert.strictEqual(borda.ordem2, null);
});

test('D503 E6: cada lente vale pela ultima ronda que a chamou', () => {
  const r1 = rondaRef([comRef('correcao', 'vence', 'perde'), comRef('borda', 'perde', 'perde')],
    [comRef('correcao', 'perde', 'vence'), comRef('borda', 'perde', 'perde')]);
  // ronda 2 chama so a borda, que agora empata
  const r2 = rondaRef([comRef('borda', 'empata', 'perde')], [comRef('borda', 'perde', 'empata')]);
  const ap = apurarRef([r1, r2]);
  assert.strictEqual(ap.referencia.pronta, true, JSON.stringify(ap.referencia));
  assert.strictEqual(ap.encerrar, true);
  const porLente = Object.fromEntries(ap.referencia.lentes.map((l) => [l.lente, [l.resultado, l.ronda]]));
  assert.deepStrictEqual(porLente, { correcao: ['vence', 1], borda: ['empata', 2] });
});

test('D503 E6: arquivo identico ao HEAD (os dois lados sao trabalho) vale pelo pior lado', () => {
  const r1 = rondaRef([comRef('correcao', 'vence', 'empata')], [comRef('correcao', 'vence', 'vence')]);
  const ap = v.apurar([r1.vereditos, r1.vereditos], { mapas: [{ A: 'trabalho', B: 'trabalho' }, { A: 'trabalho', B: 'trabalho' }],
    invertidas: [{ mapa: { A: 'trabalho', B: 'trabalho' }, vereditos: r1.invertida.vereditos },
      { mapa: { A: 'trabalho', B: 'trabalho' }, vereditos: r1.invertida.vereditos }] });
  assert.strictEqual(ap.referencia.lentes[0].ordem1, 'empata');
  assert.strictEqual(ap.referencia.lentes[0].resultado, 'empata');
});

test('D503 E6: a mesma lente com dois vereditos na mesma passada vale pelo pior deles', () => {
  // "Correcao e regressao" e "correcao" sao a mesma lente (chave canonica); a 1a passada tem as duas grafias
  const r1 = rondaRef([comRef('correcao', 'perde', 'empata'), comRef('Correcao e regressao', 'vence', 'empata')],
    [comRef('correcao', 'empata', 'vence')]);
  const ap = apurarRef([r1, r1]);
  assert.strictEqual(ap.referencia.lentes.length, 1);
  assert.strictEqual(ap.referencia.lentes[0].ordem1, 'perde');
  assert.strictEqual(ap.referencia.pronta, false);
});

test('D503 E6: no teto com a referencia nao alcancada, o motivo diz a referencia', () => {
  const r1 = rondaRef([comRef('correcao', 'perde', 'perde')], [comRef('correcao', 'perde', 'perde')]);
  const ap = apurarRef([r1, r1, r1]);
  assert.strictEqual(ap.encerrar, true);
  assert.match(ap.motivo, /^teto de 3 rondas/);
  assert.match(ap.motivo, /referencia/);
});

test('D503 E7: achado da 2a passada conta pelo lado da invertida, sai com passada 2 e se refuta com passada 2', () => {
  // 2a passada: B.txt e o trabalho (invertida); P1 nele molha
  const r1 = rondaRef([comRef('correcao', 'empata', 'empata')],
    [comRef('correcao', 'empata', 'empata', [achado('P1', 'B.txt', 12)])]);
  const ap = apurarRef([r1]);
  assert.strictEqual(ap.novos.length, 1);
  assert.strictEqual(ap.novos[0].passada, 2);
  assert.strictEqual(ap.secas, 0);
  // P1 no A.txt da 2a passada e o lado HEAD
  const velho = rondaRef([comRef('correcao', 'empata', 'empata')],
    [comRef('correcao', 'empata', 'empata', [achado('P1', 'A.txt', 12)])]);
  const apV = apurarRef([velho]);
  assert.strictEqual(apV.novos.length, 0);
  assert.strictEqual(apV.achadosDoLadoAntigo.length, 1);
  // refutacao: so a que diz passada 2 derruba o achado da 2a passada
  const prova = { ronda: 1, lente: 'correcao', arquivo: 'B.txt', linha: 12, severidade: 'P1', prova: 'src/a.js:12' };
  assert.strictEqual(apurarRef([r1], { refutados: [prova] }).novos.length, 1);
  assert.strictEqual(apurarRef([r1], { refutados: [Object.assign({ passada: 2 }, prova)] }).novos.length, 0);
  assert.throws(() => apurarRef([r1], { refutados: [Object.assign({}, prova, { passada: 3 })] }), /passada/);
});

test('D503 E7: o mesmo defeito nas duas passadas nao dobra; placar A/B segue so da 1a passada', () => {
  // 1a: P1 em A.txt:12 (trabalho); 2a: o mesmo defeito em B.txt:12 (trabalho na invertida)
  const r1 = rondaRef([comRef('correcao', 'empata', 'empata', [achado('P1', 'A.txt', 12)])],
    [Object.assign(comRef('correcao', 'empata', 'empata', [achado('P1', 'B.txt', 12)]), { melhor: 'B' })]);
  const ap = apurarRef([r1]);
  assert.strictEqual(ap.novos.length, 1);
  assert.deepStrictEqual(ap.placar, { A: 1, B: 0, empate: 0 });
});

test('D503 E5/E8: na ronda com referencia, veredito sem vsReferencia (qualquer passada) derruba a apuracao', () => {
  const sem = rondaRef([veredito('correcao', [])], [comRef('correcao', 'empata', 'empata')]);
  assert.throws(() => apurarRef([sem]), /vsReferencia/);
  const sem2 = rondaRef([comRef('correcao', 'empata', 'empata')], [veredito('correcao', [])]);
  assert.throws(() => apurarRef([sem2]), /vsReferencia/);
  const vazia = rondaRef([comRef('correcao', 'empata', 'empata')], []);
  assert.throws(() => apurarRef([vazia]), /2a passada/);
});

// Plano 082, Tarefa 5, tela S11 (p2-16): o erro do vsReferencia diz a lente (qual veredito regravar) e a ordem sem giria.
test('082 T5: vsReferencia invalido diz a lente e a ordem dos lados, sem "2a passada"', () => {
  const erros = v.errosDoVeredito(comRef('acessibilidade', 'vence', 'ganha'), { comReferencia: true });
  assert.ok(erros.some((e) => /^vsReferencia da lente "acessibilidade" tem de ser/.test(e)), erros.join(' | '));
  const sem2 = rondaRef([comRef('correcao', 'empata', 'empata')], [comRef('estados', 'vence', 'ganha')]);
  assert.throws(() => apurarRef([sem2]), (err) => {
    assert.match(err.message, /ronda 1 \(com A e B trocados\), lente "estados"/, err.message);
    assert.doesNotMatch(err.message, /2a passada/, err.message);
    return true;
  });
  const sem1 = rondaRef([comRef('correcao', 'perde', 'x')], [comRef('correcao', 'empata', 'empata')]);
  assert.throws(() => apurarRef([sem1]), /ronda 1, lente "correcao"/);
});

// Plano 082, Tarefa 6 (p2-6, p2-7): com referencia, cada passada precisa do mapa que diz qual lado e o trabalho.
test('082 T6 (p2-6): ronda com referencia sem mapa valido em alguma passada derruba a apuracao, com a ronda e a ordem', () => {
  const r1 = rondaRef([comRef('correcao', 'empata', 'empata')], [comRef('correcao', 'empata', 'empata')]);
  const semInv = { mapa: undefined, vereditos: r1.invertida.vereditos };
  assert.throws(() => v.apurar([r1.vereditos], { mapas: [MAPA_REF], invertidas: [semInv] }),
    /ronda 1 \(com A e B trocados\) sem o mapa/);
  assert.throws(() => v.apurar([r1.vereditos], { mapas: [MAPA_REF], invertidas: [{ mapa: {}, vereditos: r1.invertida.vereditos }] }),
    /ronda 1 \(com A e B trocados\) sem o mapa/);
  assert.throws(() => v.apurar([r1.vereditos], { mapas: [null], invertidas: [r1.invertida] }), /ronda 1 sem o mapa/);
  // nenhum lado e o trabalho: a comparacao nunca fecharia
  assert.throws(() => v.apurar([r1.vereditos], { mapas: [{ A: 'HEAD', B: 'HEAD' }], invertidas: [r1.invertida] }), /ronda 1 sem o mapa/);
  // sem referencia, o mapa segue opcional (a conta de antes)
  assert.doesNotThrow(() => v.apurar([[veredito('correcao', [])]], { mapas: [null] }));
});

test('082 T6 (p2-7): mapa sem um dos lados nao deixa o A.txt da ordem trocada cair na chave sem lado', () => {
  const r1 = rondaRef([comRef('correcao', 'empata', 'empata', [achado('P1', 'B.txt', 5)])],
    [comRef('correcao', 'empata', 'empata', [achado('P1', 'B.txt', 5)])]);
  assert.throws(() => v.apurar([r1.vereditos], { mapas: [MAPA_REF], invertidas: [{ mapa: { B: 'trabalho' }, vereditos: r1.invertida.vereditos }] }),
    /sem o mapa/);
  assert.throws(() => v.apurar([r1.vereditos], { mapas: [MAPA_REF], invertidas: [{ mapa: { A: 'HEAD', B: 'novo' }, vereditos: r1.invertida.vereditos }] }),
    /sem o mapa/);
});

// L3 (s104), A3-01 + A9-05: dois defeitos distintos do mesmo veredito na mesma linha eram uma chave so, e o segundo
// sumia de achadosNovosP0P1. O RV-12 cobria so o caso entre rondas; este e dentro da propria ronda.
test('L3 A3-01: dois P1 distintos do mesmo veredito na mesma linha saem os dois; repetidos na ronda seguinte nao molham', () => {
  const M = { A: 'trabalho', B: 'HEAD' };
  const dois = () => [veredito('correcao', [achado('P1', 'A.txt', 42, 'defeito X'), achado('P1', 'A.txt', 42, 'defeito Y')])];
  let r = v.apurar([dois()], { mapas: [M] });
  assert.deepStrictEqual(r.novos.map((a) => a.descricao), ['defeito X', 'defeito Y']);
  r = v.apurar([dois()]);
  assert.deepStrictEqual(r.novos.map((a) => a.descricao), ['defeito X', 'defeito Y'], 'sem mapa, a mesma regra');
  r = v.apurar([dois(), dois()], { mapas: [M, M] });
  assert.strictEqual(r.secas, 1, 'os dois repetidos na ronda 2 nao molham');
  // um terceiro na mesma linha, so na ronda 2, e achado novo
  const tres = [veredito('correcao', [achado('P1', 'A.txt', 42, 'defeito X'), achado('P1', 'A.txt', 42, 'defeito Y'),
    achado('P1', 'A.txt', 42, 'defeito Z')])];
  r = v.apurar([dois(), tres], { mapas: [M, M] });
  assert.strictEqual(r.secas, 0);
  assert.deepStrictEqual(r.novos.map((a) => a.descricao), ['defeito Z']);
  // revisao L3 R2 (correcao, P1): o novo vem ANTES do repetido no veredito - o listado e o novo, nao o repetido
  const yAntes = [veredito('correcao', [achado('P1', 'A.txt', 42, 'defeito Y'), achado('P1', 'A.txt', 42, 'defeito X')])];
  r = v.apurar([[veredito('correcao', [achado('P1', 'A.txt', 42, 'defeito X')])], yAntes], { mapas: [M, M] });
  assert.strictEqual(r.secas, 0);
  assert.deepStrictEqual(r.novos.map((a) => a.descricao), ['defeito Y']);
  // e o repetido sozinho com outras palavras segue sem molhar (a chave base e dele)
  r = v.apurar([[veredito('correcao', [achado('P1', 'A.txt', 42, 'defeito X')])],
    [veredito('correcao', [achado('P1', 'A.txt', 42, 'o X de outro jeito')])]], { mapas: [M, M] });
  assert.strictEqual(r.secas, 1);
  // revisao L3 R3 (correcao, P1; D602): X consertado e Z novo na linha onde ja havia X e Y - o Z nao some
  const xy = () => [veredito('correcao', [achado('P1', 'A.txt', 42, 'defeito X'), achado('P1', 'A.txt', 42, 'defeito Y')])];
  r = v.apurar([xy(), [veredito('correcao', [achado('P1', 'A.txt', 42, 'defeito Y'), achado('P1', 'A.txt', 42, 'defeito Z')])]],
    { mapas: [M, M] });
  assert.strictEqual(r.secas, 0);
  assert.deepStrictEqual(r.novos.map((a) => a.descricao), ['defeito Z']);
  // o novo antes do repetido reescrito: o novo esta na lista (o reescrito tambem - custo aceito na D602)
  r = v.apurar([[veredito('correcao', [achado('P1', 'A.txt', 42, 'defeito X')])],
    [veredito('correcao', [achado('P1', 'A.txt', 42, 'defeito Y'), achado('P1', 'A.txt', 42, 'o X de outro jeito')])]],
  { mapas: [M, M] });
  assert.ok(r.novos.some((a) => a.descricao === 'defeito Y'), JSON.stringify(r.novos));
  // custo aceito na D602: dois repetidos reescritos na mesma linha molham a ronda
  r = v.apurar([xy(), [veredito('correcao', [achado('P1', 'A.txt', 42, 'o X de novo'), achado('P1', 'A.txt', 42, 'o Y de novo')])]],
    { mapas: [M, M] });
  assert.strictEqual(r.secas, 0);
  // um so, ja visto na 2a chave, segue repeticao
  r = v.apurar([xy(), [veredito('correcao', [achado('P1', 'A.txt', 42, 'defeito Y')])]], { mapas: [M, M] });
  assert.strictEqual(r.secas, 1);
  // controle: o mesmo achado em dois vereditos da mesma lente segue um so
  r = v.apurar([[veredito('correcao', [achado('P1', 'A.txt', 42, 'X')]), veredito('correcao', [achado('P1', 'A.txt', 42, 'X')])]],
    { mapas: [M] });
  assert.strictEqual(r.novos.length, 1);
});

// L3 (s104), A3-05: "p1" e " P1 " eram severidade invalida, e o achado saia descartado com a ronda seca.
test('L3 A3-05: severidade em minuscula ou com espaco vale como a canonica; "alta" segue descartada', () => {
  for (const sev of ['p1', ' P1 ', 'p0', 'P2 ']) {
    const r = v.validarVeredito(veredito('correcao', [achado(sev, 'A.txt', 3)]));
    assert.strictEqual(r.achadosValidos.length, 1, JSON.stringify(sev));
    assert.strictEqual(r.achadosValidos[0].severidade, sev.trim().toUpperCase());
  }
  assert.strictEqual(v.validarVeredito(veredito('correcao', [achado('alta', 'A.txt', 3)])).achadosValidos.length, 0);
  const r = v.apurar([[veredito('correcao', [achado('p1', 'A.txt', 3)])], [veredito('correcao', [])]]);
  assert.strictEqual(r.secas, 1, 'o "p1" da ronda 1 molhou');
});

// L3 (s104), A3-03: uma ronda 1 com um veredito so (ou de lente "banana") fechava aprovado. Com a faixa da ronda 1
// (o preparar-revisao.js grava no mapa.json), a ronda 1 sem as lentes da faixa e voto que falta, como a ronda vazia.
test('L3 A3-03: com a faixa, a ronda 1 sem as lentes da faixa e voto que falta', () => {
  const vazio = (l) => veredito(l, []);
  assert.throws(() => v.apurar([[vazio('correcao')], [vazio('correcao')]], { faixas: ['duas', 'duas'] }),
    (e) => /ronda 1/.test(e.message) && /borda/.test(e.message) && e.codigo === 'VOTO_QUE_FALTA');
  assert.throws(() => v.apurar([[vazio('banana')], [vazio('banana')]], { faixas: ['uma'] }), /correcao/);
  const sete = ['correcao', 'estados', 'borda', 'seguranca', 'manutencao', 'microcopy', 'enxuto'];
  assert.throws(() => v.apurar([sete.slice(0, 6).map(vazio), [vazio('correcao')]], { faixas: ['completa'] }), /7/);
  assert.throws(() => v.apurar([sete.slice(0, 6).concat(['banana']).map(vazio), [vazio('correcao')]], { faixas: ['completa'] }), /7/);
  // controles
  assert.strictEqual(v.apurar([[vazio('correcao'), vazio('borda')], [vazio('correcao')]], { faixas: ['duas'] }).encerrar, true);
  assert.strictEqual(v.apurar([sete.map(vazio), [vazio('correcao')]], { faixas: ['completa'] }).encerrar, true);
  assert.doesNotThrow(() => v.apurar([[vazio('Correção e regressão')]], { faixas: ['uma'] }), 'o titulo com acento e a lente');
  assert.doesNotThrow(() => v.apurar([[vazio('banana')], [vazio('banana')]]), 'sem faixa (base antiga), a conta de antes');
});

test('L3 A3-03: com a faixa, a lente que achou P0/P1 do lado novo tem de voltar na ronda seguinte', () => {
  const M = { A: 'trabalho', B: 'HEAD' };
  const r1 = [veredito('correcao', []), veredito('borda', [achado('P1', 'A.txt', 9, 'quebra')])];
  assert.throws(() => v.apurar([r1, [veredito('correcao', [])], [veredito('correcao', [])]], { mapas: [M, M, M], faixas: ['duas'] }),
    (e) => /ronda 2/.test(e.message) && /borda/.test(e.message) && e.codigo === 'VOTO_QUE_FALTA');
  const r = v.apurar([r1, [veredito('borda', [])], [veredito('borda', [])]], { mapas: [M, M, M], faixas: ['duas'] });
  assert.strictEqual(r.motivo, 'duas rondas secas seguidas: aprovado');
  // o P1 refutado e o do lado antigo nao obrigam a lente a voltar
  const ref = [{ ronda: 1, lente: 'borda', arquivo: 'A.txt', linha: 9, severidade: 'P1', prova: 'x.js:1' }];
  assert.doesNotThrow(() => v.apurar([r1, [veredito('correcao', [])]], { mapas: [M, M], faixas: ['duas'], refutados: ref }));
  const antigo = [veredito('correcao', []), veredito('borda', [achado('P1', 'B.txt', 9)])];
  assert.doesNotThrow(() => v.apurar([antigo, [veredito('correcao', [])]], { mapas: [M, M], faixas: ['duas'] }));
  assert.doesNotThrow(() => v.apurar([r1, [veredito('correcao', [])]], { mapas: [M, M] }), 'sem faixa, a conta de antes');
});

// Colheita 10-20, lote 3 (vereditos tipados) + 4a (LIDO/INFERIDO): o achado diz o estado. Confirmado = LIDO, com a
// severidade e o trecho copiado do arquivo citado; pendente = INFERIDO, com o fato exato que falta e sem severidade, e
// nao molha a ronda. Rejeitado e o refutados.json, com a prova. Achado sem estado invalida o veredito inteiro.
function confirmado(sev, arq, linha, trecho, desc) {
  return { estado: 'confirmado', severidade: sev, arquivo: arq, linha: linha, trecho: trecho, descricao: desc || 'defeito',
    comoFalha: 'x -> y' };
}
function pendente(arq, linha, falta, desc) {
  return { estado: 'pendente', arquivo: arq, linha: linha, falta: falta, descricao: desc || 'talvez quebre' };
}

test('lote 3/4a: achado sem estado (ou com estado desconhecido) invalida o veredito inteiro', () => {
  const sem = { severidade: 'P1', arquivo: 'A.txt', linha: 3, descricao: 'quebra' };
  for (const a of [sem, Object.assign({}, sem, { estado: 'talvez' }), Object.assign({}, sem, { estado: 'rejeitado' })]) {
    const erros = v.errosDoVeredito(veredito('correcao', [a]));
    assert.ok(erros.some((e) => /estado/.test(e) && /confirmado/.test(e) && /pendente/.test(e)), JSON.stringify(erros));
    assert.throws(() => v.apurar([[veredito('correcao', [a])]]), /estado/);
  }
  assert.deepStrictEqual(v.errosDoVeredito(veredito('correcao', [])), [], 'sem achado, nada a dizer do estado');
  assert.deepStrictEqual(v.errosDoVeredito(veredito('correcao', [confirmado('P1', 'A.txt', 3, 'x()')])), []);
  assert.deepStrictEqual(v.errosDoVeredito(veredito('correcao', [pendente('A.txt', 3, 'o que ler() devolve')])), []);
});

// R3 do lote 3/4a (D672): o confirmado sem trecho, como o sem estado, invalida o veredito inteiro. Descartado, ele
// secava a ronda, e duas rondas assim aprovavam com um P0 real.
test('lote 3/4a: confirmado sem trecho invalida o veredito inteiro (descartar secaria a ronda)', () => {
  for (const t of [undefined, '', '   ', 5]) {
    const a = confirmado('P0', 'A.txt', 10, t, 'quebra');
    const erros = v.errosDoVeredito(veredito('correcao', [a]));
    assert.ok(erros.some((e) => /trecho/.test(e) && /regrave/.test(e)), JSON.stringify(erros));
    assert.throws(() => v.apurar([[veredito('correcao', [a])], [veredito('correcao', [])]]), /trecho/);
  }
  assert.deepStrictEqual(v.errosDoVeredito(veredito('correcao', [pendente('A.txt', 3, 'o que ler() devolve')])), [],
    'o pendente nao tem trecho');
});

test('lote 3/4a: confirmado sem trecho e pendente sem falta ou com severidade sao descartados', () => {
  const r = v.validarVeredito(veredito('correcao', [
    confirmado('P1', 'A.txt', 3, ''), confirmado('P1', 'A.txt', 4, undefined),
    pendente('A.txt', 5, '  '), Object.assign(pendente('A.txt', 6, 'o retorno de ler()'), { severidade: 'P1' }),
    pendente('A.txt', 0, 'x'),
    confirmado('P0', 'A.txt', 7, 'apaga()'), pendente('B.txt', 8, 'o valor de x em B.txt:2')
  ]));
  assert.strictEqual(r.achadosValidos.length, 1);
  assert.strictEqual(r.achadosValidos[0].linha, 7);
  assert.deepStrictEqual(r.pendentesValidos.map((p) => p.linha), [8]);
  // 5 descartes + o erro do veredito inteiro pelos 2 confirmados sem trecho (D672: o apurar para antes de descartar)
  assert.strictEqual(r.erros.length, 6, JSON.stringify(r.erros));
  assert.ok(r.erros.some((e) => /trecho/.test(e)) && r.erros.some((e) => /falta/.test(e)) &&
    r.erros.some((e) => /severidade/.test(e) && /pendente/.test(e)), JSON.stringify(r.erros));
});

test('lote 3/4a: pendente nao molha a ronda e sai na lista de pendentes com a ronda e a lente', () => {
  const M = { A: 'trabalho', B: 'HEAD' };
  const r1 = [veredito('correcao', [pendente('A.txt', 9, 'o que ler() devolve com arquivo vazio')])];
  const r2 = [veredito('correcao', [])];
  const r = v.apurar([r1, r2], { mapas: [M, M] });
  assert.strictEqual(r.motivo, 'duas rondas secas seguidas: aprovado');
  assert.strictEqual(r.pendentes.length, 1);
  assert.deepStrictEqual([r.pendentes[0].ronda, r.pendentes[0].lente, r.pendentes[0].linha], [1, 'correcao', 9]);
  assert.strictEqual(r.pendentes[0].falta, 'o que ler() devolve com arquivo vazio');
  // controle: o mesmo lugar como confirmado molha
  const molhada = v.apurar([[veredito('correcao', [confirmado('P1', 'A.txt', 9, 'ler()')])], r2], { mapas: [M, M] });
  assert.strictEqual(molhada.encerrar, false);
});

test('lote 3/4a: o trecho do confirmado e conferido no arquivo citado; o que nao confere sai e nao molha', () => {
  const M = { A: 'trabalho', B: 'HEAD' };
  const vistos = [];
  const noArquivo = (indice, rotulo, linha, trecho, passada) => {
    vistos.push([indice, rotulo, linha, passada]);
    return trecho === 'const x = ler()';
  };
  const r1 = [veredito('correcao', [confirmado('P1', 'A.txt', 9, 'inventado()'), confirmado('P1', 'A.txt', 12, 'const x = ler()')])];
  const r = v.apurar([r1], { mapas: [M], trechoNoArquivo: noArquivo });
  assert.deepStrictEqual(r.novos.map((a) => a.linha), [12], 'so o que confere conta');
  assert.strictEqual(r.trechoNaoConfere.length, 1);
  assert.deepStrictEqual([r.trechoNaoConfere[0].ronda, r.trechoNaoConfere[0].lente, r.trechoNaoConfere[0].linha,
    r.trechoNaoConfere[0].trecho], [1, 'correcao', 9, 'inventado()']);
  assert.deepStrictEqual(vistos[0], [0, 'A', 9, 1]);
  // sem como ler (null), conta como antes; sem o callback, idem
  const semTexto = v.apurar([r1], { mapas: [M], trechoNoArquivo: () => null });
  assert.strictEqual(semTexto.novos.length, 2);
  assert.strictEqual(v.apurar([r1], { mapas: [M] }).novos.length, 2);
  assert.deepStrictEqual(v.apurar([r1], { mapas: [M] }).trechoNaoConfere, []);
});
