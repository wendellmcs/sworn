'use strict';
const test = require('node:test');
const assert = require('node:assert');
const v = require('../scripts/lib/veredito.js');

// F2b: o P2 confirmado diz o tipo, e sem ele o veredito e invalido. O P2 destes testes e de erro (o que segura a ronda);
// quem quer a melhoria troca o tipo, e quem quer o P2 sem tipo usa o p2SemTipo.
function achado(sev, arq, linha, desc) {
  const a = { estado: 'confirmado', severidade: sev, arquivo: arq, linha: linha, trecho: 'x', descricao: desc || 'defeito',
    comoFalha: 'x -> y' };
  if (sev === 'P2') a.tipo = 'erro';
  return a;
}
function p2SemTipo(arq, linha) {
  const a = achado('P2', arq, linha);
  delete a.tipo;
  return a;
}
function veredito(lente, achados, melhor) {
  return { lente: lente, melhor: melhor || 'A', porQue: 'A.txt:1', achados: achados };
}
// D820: o P0/P1 da lente de seguranca nomeia a fronteira (sem ela, o veredito volta). `fronteira` omitida = a inteira;
// o achado sem o campo e o achado() de sempre.
const FRONTEIRA = { entrada: 'o nome do arquivo que vem do usuario', controle: 'a checagem de caminho de abrir()',
  efeito: 'le um arquivo fora da pasta do projeto' };
function achadoSeg(sev, arq, linha, desc, fronteira) {
  return Object.assign(achado(sev, arq, linha, desc), { fronteira: fronteira === undefined ? FRONTEIRA : fronteira });
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

// D825 (D3b): a mudanca so de tela tambem e conferida contra o pedido. A familia de tela segue com 8; a revisao so de
// tela despacha as 8 e a lente do pedido (a `escopo`, que ja vem na familia de codigo quando a mudanca e dos dois).
test('D825: a revisao so de tela despacha as oito de tela e a lente do pedido', () => {
  assert.strictEqual(v.LENTE_DO_PEDIDO, 'escopo');
  assert.ok(v.LENTES.some((l) => l.chave === v.LENTE_DO_PEDIDO), 'a lente do pedido e da familia de codigo');
  const soTela = v.lentesSoTela();
  assert.deepStrictEqual(soTela, v.LENTES_UI.map((l) => l.chave).concat('escopo'));
  assert.strictEqual(new Set(soTela).size, 9);
  soTela.push('x');
  assert.strictEqual(v.lentesSoTela().length, 9, 'cada chamada devolve uma lista nova');
  // codigo e tela: as duas familias inteiras ja trazem a do pedido uma vez so
  const juntas = v.LENTES.concat(v.LENTES_UI).map((l) => l.chave);
  assert.strictEqual(juntas.filter((c) => c === v.LENTE_DO_PEDIDO).length, 1);
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
  // D875: so `instrucao: false` desce a `doc`; ausente ou outro valor fica na `texto`
  assert.strictEqual(v.faixaDaMudanca({ texto: true, instrucao: false, linhasMudadas: 4 }), 'doc');
  assert.strictEqual(v.faixaDaMudanca({ texto: true, instrucao: false, linhasMudadas: 3 }), 'uma');
  assert.strictEqual(v.faixaDaMudanca({ texto: true, instrucao: true, linhasMudadas: 4 }), 'texto');
  assert.strictEqual(v.faixaDaMudanca({ texto: true, instrucao: 0, linhasMudadas: 4 }), 'texto');
  assert.strictEqual(v.faixaDaMudanca({ instrucao: false, linhasMudadas: 30 }), 'duas', 'codigo nao vira doc');
  assert.strictEqual(v.faixaDaMudanca({ novo: true, texto: true, instrucao: false, linhasMudadas: 9 }), 'completa');
});

test('D875: textoQueInstrui - skill, agente, regra, CLAUDE.md e README ficam; changelog, guia e docs nao', () => {
  for (const r of ['skills/review/SKILL.md', 'agents/inspector.md', 'commands/x.md', '.claude/sworn/regras.md',
    'CLAUDE.md', 'pkg/AGENTS.md', 'README.md', 'README.pt-BR.md', 'readme.md', 'docs/x.prompt.md', 'a\\skills\\b.md',
    '.github/copilot-instructions.md', 'GEMINI.md', '']) {
    assert.strictEqual(v.textoQueInstrui(r), true, r);
  }
  for (const r of ['CHANGELOG.md', 'GUIA.md', 'docs/decisoes.md', 'notas.txt', 'docs/skills.md', 'meu-README-velho.md',
    'askills/x.md', 'CLAUDE.md.bak', 'docs/READMEx.md']) {
    assert.strictEqual(v.textoQueInstrui(r), false, r);
  }
});

test('D485: lentesDaFaixa - as lentes de cada faixa existem em LENTES; a completa devolve null (tabela de familias)', () => {
  assert.deepStrictEqual(v.lentesDaFaixa('uma'), ['correcao']);
  assert.deepStrictEqual(v.lentesDaFaixa('duas'), ['correcao', 'borda']);
  assert.deepStrictEqual(v.lentesDaFaixa('texto'), ['correcao', 'microcopy']);
  assert.deepStrictEqual(v.lentesDaFaixa('doc'), ['correcao']);
  assert.strictEqual(v.lentesDaFaixa('completa'), null);
  assert.strictEqual(v.lentesDaFaixa('outra'), null);
  const chaves = new Set(v.LENTES.map((l) => l.chave));
  for (const f of ['uma', 'duas', 'texto', 'doc']) {
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

// D823 (R1, dono): o P2 aberto molha a ronda, como o P1 (antes: P2 virava registro e a ronda saia seca).
// D828.2 (F2a) tira a melhoria desta lista: ela vira registro (os testes dela vem logo abaixo).
// F2b: o P2 sem a marca, ou com marca desconhecida, deixou de contar como erro: invalida o veredito (testes no fim).
test('D823: a ronda com P2 de erro aberto nao e seca, em qualquer grafia do tipo', () => {
  for (const tipo of ['erro', 'ERRO', ' Erro ']) {
    const a = Object.assign(p2SemTipo('A.txt', 10), { tipo: tipo });
    const r = v.apurar([[veredito('correcao', [a])]]);
    assert.strictEqual(r.secas, 0, tipo);
    assert.deepStrictEqual(r.registros, [], tipo);
    assert.deepStrictEqual(r.novos.map((n) => n.linha), [10], tipo);
  }
});

const achadoMelhoria = (linha) => Object.assign(achado('P2', 'A.txt', linha, 'nome melhor'), { tipo: 'melhoria' });
const achadoErroP2 = (linha) => Object.assign(achado('P2', 'A.txt', linha, 'pode perder dado'), { tipo: 'erro' });

// D828.2 (F2a): o P2 de melhoria nao segura a ronda; sai em `registros`, com a ronda, a lente e o porque.
test('D828.2: o P2 de melhoria vira registro e a ronda sai seca', () => {
  const r = v.apurar([[veredito('correcao', [achadoMelhoria(7)])]]);
  assert.strictEqual(r.secas, 1);
  assert.deepStrictEqual(r.novos, []);
  assert.deepStrictEqual(r.registros, [Object.assign({ ronda: 1, lente: 'correcao' }, achadoMelhoria(7), { registro: 'melhoria' })]);
  assert.deepStrictEqual(r.eixos.padrao, { novos: 0, pior: null }, 'o registro nao entra na conta dos novos');
});

test('D828.2: duas rondas so com melhoria aprovam, e as melhorias de todas as rondas saem no registro', () => {
  const r = v.apurar([[veredito('correcao', [achadoMelhoria(1)])], [veredito('correcao', [achadoMelhoria(2)])]]);
  assert.strictEqual(r.motivo, 'duas rondas secas seguidas: aprovado');
  assert.deepStrictEqual(r.registros.map((a) => [a.ronda, a.linha, a.registro]), [[1, 1, 'melhoria'], [2, 2, 'melhoria']]);
});

test('D828.2: a melhoria repetida entra uma vez; a do lado antigo e a refutada nao sao registro', () => {
  const repetida = v.apurar([[veredito('correcao', [achadoMelhoria(1)])], [veredito('correcao', [achadoMelhoria(1)])]]);
  assert.deepStrictEqual(repetida.registros.map((a) => a.ronda), [1]);
  const melhoriaEmB = Object.assign(achadoMelhoria(4), { arquivo: 'B.txt' });
  const antiga = v.apurar([[veredito('correcao', [melhoriaEmB])]], { mapas: [{ A: 'trabalho', B: 'HEAD' }] });
  assert.deepStrictEqual(antiga.registros, []);
  assert.strictEqual(antiga.achadosDoLadoAntigo.length, 1);
  const refutada = v.apurar([[veredito('correcao', [achadoMelhoria(4)])]], { refutados: [{ ronda: 1, lente: 'correcao',
    arquivo: 'A.txt', linha: 4, severidade: 'P2', prova: 'scripts/x.js:1' }] });
  assert.deepStrictEqual(refutada.registros, []);
  assert.strictEqual(refutada.secas, 1);
});

test('D828.2: a melhoria nao faz par para o juiz de mesmo defeito, e nao obriga a lente a voltar', () => {
  const r1 = [veredito('correcao', [achado('P1', 'A.txt', 10)]), veredito('borda', [achadoMelhoria(11)])];
  const r = v.apurar([r1], { mapas: [{ A: 'trabalho', B: 'HEAD' }] });
  assert.deepStrictEqual(r.paresCandidatos, []);
  // com a faixa, a ronda 2 sem a lente que achou P0/P1 para com erro; a que so deixou melhoria pode ficar de fora
  const r2 = v.apurar([r1, [veredito('correcao', [])]], { mapas: [{ A: 'trabalho', B: 'HEAD' }, { A: 'trabalho', B: 'HEAD' }],
    faixas: ['duas', 'duas'] });
  assert.strictEqual(r2.secas, 1);
});

test('D828.2/D823: no teto, o P2 de erro e o P1 (mesmo marcado melhoria) nao aprovam', () => {
  // o P1 marcado "melhoria" por engano segue P1: so o P2 pode ser melhoria
  const p1Marcado = Object.assign(achado('P1', 'A.txt', 3), { tipo: 'melhoria' });
  for (const aberto of [achadoErroP2(3), achado('P1', 'A.txt', 3), p1Marcado]) {
    const r = v.apurar([[veredito('correcao', [achado('P1', 'A.txt', 1)])], [veredito('correcao', [achado('P1', 'A.txt', 2)])],
      [veredito('correcao', [achadoMelhoria(4), aberto])]]);
    assert.strictEqual(r.encerrar, true);
    assert.doesNotMatch(r.motivo, /aprovado/, JSON.stringify(aberto));
    assert.match(r.motivo, /^teto de 3 rondas com 3 achado\(s\) aberto\(s\)/, JSON.stringify(aberto));
    assert.deepStrictEqual(r.novos.map((a) => a.linha), [3], 'so o que segura a ronda sai em novos');
    assert.deepStrictEqual(r.registros.map((a) => a.linha), [4], 'a melhoria da ronda do teto sai no registro');
  }
});

test('D828.2: antes do teto, a ronda so com melhoria e seca, e a seguinte chama as lentes do que segura a ronda', () => {
  const r = v.apurar([[veredito('correcao', [achadoMelhoria(1)])]]);
  assert.strictEqual(r.encerrar, false);
  assert.strictEqual(r.secas, 1);
  assert.strictEqual(r.motivo, 'ronda 2 chama so as lentes que acharam P0, P1 ou P2 de erro');
});

test('D823: o P2 sai pela refutacao "fora do pedido" com o motivo; com o motivo em branco, ou sendo P0 ou P1, nao', () => {
  const rondas = (sev) => [[veredito('correcao', [achado(sev, 'A.txt', 3)])], [veredito('correcao', [])]];
  const refutacaoForaDoPedido = (sev, motivo) => ({ ronda: 1, lente: 'correcao', arquivo: 'A.txt', linha: 3,
    severidade: sev, prova: 'texto de outra entrada', foraDoPedido: motivo });
  const discoSemProva = () => false;
  const apurarCom = (sev, motivo) => v.apurar(rondas(sev), { mapas: [MAPA_AB, MAPA_AB],
    refutados: [refutacaoForaDoPedido(sev, motivo)], provaNoRepo: discoSemProva });
  assert.strictEqual(apurarCom('P2', 'e de outra mudanca').motivo, 'duas rondas secas seguidas: aprovado');
  assert.throws(() => apurarCom('P2', '  '), /nao confere/);
  for (const sev of ['P0', 'P1']) assert.throws(() => apurarCom(sev, 'e de outra mudanca'), /nao confere/, sev);
});

test('apurar: achado repetido com a mesma evidencia nao molha a ronda', () => {
  const mesmo = [veredito('correcao', [achado('P1', 'A.txt', 10)])];
  const r = v.apurar([mesmo, mesmo, mesmo]);
  assert.strictEqual(r.secas, 2, 'rondas 2 e 3 nao trouxeram nada novo');
  // A3-06: mas o achado voltou igual na ultima e segue aberto: encerra no teto, sem aprovar
  assert.strictEqual(r.encerrar, true);
  assert.match(r.motivo, /^teto de 3 rondas/);
  assert.doesNotMatch(r.motivo, /aprovado/);
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

// D785 item 5 (s369, 2.5): o teto encerra a revisao, mas nao manda ao dono.
// D828.3 (F2a): e tambem nao abre revisao nova: conserto com teste e mutacao, suite verde, commit com a marca.
test('D828.3: teto de 3 rondas com P1 aberto encerra e manda consertar com teste e commitar com a marca, sem perguntar', () => {
  const r = v.apurar([
    [veredito('correcao', [achado('P1', 'A.txt', 1)])],
    [veredito('correcao', [achado('P1', 'A.txt', 2)])],
    [veredito('correcao', [achado('P1', 'A.txt', 3)])]
  ]);
  assert.strictEqual(r.encerrar, true);
  assert.strictEqual(r.motivo, 'teto de 3 rondas com 3 achado(s) aberto(s) (P0, P1 ou P2 de erro): conserte o que e ' +
    'erro, cada conserto com um teste que reprova quando o codigo e estragado de proposito; com a suite inteira verde, ' +
    'o commit sai com "# sworn: sem-revisao" no fim do comando, sem perguntar; o que sobrar vira registro no plano');
  assert.ok(!/dono|humano|3 opcoes|aprovado|prepare de novo|revisao nova/.test(r.motivo), r.motivo);
  assert.ok(/^[\x20-\x7E]+$/.test(r.motivo), 'o motivo vai ao modelo: so ASCII');
});

test('apurar: P0 novo nunca e ronda seca', () => {
  const r = v.apurar([[veredito('seguranca', [achadoSeg('P0', 'B.txt', 7)])]]);
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
    veredito('seguranca', [achadoSeg('P1', 'A.txt', 42, 'caminho sem guarda')])
  ]]);
  assert.deepStrictEqual(r.novos.map((a) => a.descricao).sort(), ['caminho sem guarda', 'quebra com lista vazia'],
    'duas lentes, dois defeitos na mesma linha: ' + JSON.stringify(r.novos));

  const r2 = v.apurar([
    [veredito('correcao', [achado('P1', 'A.txt', 42, 'quebra com lista vazia')])],
    [veredito('correcao', [achado('P1', 'A.txt', 42, 'quebra com lista vazia')]),
      veredito('seguranca', [achadoSeg('P1', 'A.txt', 42, 'caminho sem guarda')])]
  ]);
  assert.deepStrictEqual(r2.novos.map((a) => a.descricao), ['caminho sem guarda'],
    'na ronda 2 so a lente nova naquela linha e novidade: ' + JSON.stringify(r2.novos));
  assert.strictEqual(r2.secas, 0, 'um P1 novo de outra lente molha a ronda');

  // O motivo do teto conta os abertos pelo comeco da chave: a severidade tem de seguir primeiro.
  const r3 = v.apurar([
    [veredito('correcao', [achado('P1', 'A.txt', 42, 'quebra com lista vazia')])],
    [veredito('seguranca', [achadoSeg('P1', 'A.txt', 42, 'caminho sem guarda')])],
    [veredito('correcao', [achado('P2', 'A.txt', 7, 'nome que mente')])]
  ]);
  // D823: o P2 aberto tambem conta (sem a marca de melhoria, e erro)
  assert.ok(r3.motivo.includes('com 3 achado(s) aberto(s)'), 'o teto conta os dois P1 e o P2: ' + r3.motivo);
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

test('veredito: as lentes de codigo fora seguranca, enxuto e escopo seguem com a pergunta de antes', () => {
  const antes = {
    correcao: 'Qual dos dois quebra? Entrada concreta que produz resultado errado, com arquivo:linha.',
    estados: 'Erro, vazio, carregando, limite e timeout estao tratados, ou so o caso feliz?',
    borda: 'null, string vazia, lista vazia, numero negativo, unicode, caminho com espaco, arquivo enorme.',
    manutencao: 'O que um leitor novo entende errado? Nome que mente, funcao que faz duas coisas, erro engolido.',
    microcopy: 'Mensagem que nao diz o que fazer a seguir, jargao, ingles solto, tom que culpa o usuario.',
    medidor: 'Teste, baseline, threshold, skip ou mock mudaram junto com o codigo que eles cobrem?',
    design: 'Cite o token literal ou a tela irm\u00e3 de refer\u00eancia. Valor cru, gradiente, sombra larga, card aninhado ou tipografia fluida onde o sistema nao os tem. Sem citar token ou coordenada, o veredito nao conta.'
  };
  const hoje = {};
  // D554: a `enxuto` e nova, e tem teste proprio (acima); esta guarda as que ja existiam.
  // D824: a escopo mudou (julga contra o pedido.md) e tem teste proprio (D824, no fim)
  // H9-1a e H9-4 (D881): correcao e borda ganharam uma frase no fim, e so ela: a pergunta inteira fica presa aqui
  const fimNovo = {
    correcao: ' Algum teste foi pulado, apagado ou teve a assercao afrouxada para passar? Cite a linha do diff.',
    borda: ' Endereco, porta ou chave de desenvolvimento escrito no lugar da configuracao ou do ambiente.'
  };
  for (const l of v.LENTES) {
    if (l.chave === 'seguranca' || l.chave === 'enxuto' || l.chave === 'escopo') continue;
    hoje[l.chave] = l.pergunta;
  }
  assert.deepStrictEqual(hoje, Object.assign({}, antes, {
    correcao: antes.correcao + fimNovo.correcao, borda: antes.borda + fimNovo.borda }));
});

test('H9 (D881): a correcao pergunta pelo teste afrouxado, a borda pelo valor de desenvolvimento fixo e a enxuto pela dependencia de uma funcao so', () => {
  const p = Object.fromEntries(v.LENTES.map((l) => [l.chave, l.pergunta]));
  assert.match(p.correcao, /teste foi pulado, apagado ou teve a assercao afrouxada para passar\? Cite a linha do diff\.$/);
  assert.match(p.borda, /Endereco, porta ou chave de desenvolvimento escrito no lugar da configuracao ou do ambiente\.$/);
  assert.match(p.enxuto, /nunca sao excesso\. A dependencia nova que serve a uma funcao so e excesso\.$/);
  for (const k of ['correcao', 'borda', 'enxuto']) {
    assert.ok(!/[^\x00-\x7f]/.test(p[k]), k + ': a pergunta tem de ser ASCII');
    assert.ok(!/\bD\d{3}\b|\bH9-/.test(p[k]), k + ': codigo de registro nao vai ao inspetor');
  }
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

// F2d parte b: o juiz so ve o par na mesma linha (paresFortes); os outros candidatos seguem em paresCandidatos
test('F2d: paresFortes sao os paresCandidatos na mesma linha, na mesma ordem', () => {
  const r = v.apurar([[veredito('correcao', [achado('P1', 'A.txt', 50), achado('P2', 'A.txt', 52)]),
    veredito('borda', [achado('P1', 'A.txt', 50), achado('P0', 'A.txt', 58)]),
    veredito('estados', [achado('P2', 'A.txt', 50)])]], { mapas: [MAPA_AB] });
  assert.ok(r.paresCandidatos.length > 3, 'ha vizinhos a mais de 0 linha');
  assert.deepStrictEqual(r.paresFortes, r.paresCandidatos.filter((p) => p.distancia === 0));
  assert.deepStrictEqual(CHAVES(r.paresFortes), [
    ['P1|trabalho|50|correcao', 'P1|trabalho|50|borda'],
    ['P1|trabalho|50|correcao', 'P2|trabalho|50|estados'],
    ['P1|trabalho|50|borda', 'P2|trabalho|50|estados']
  ]);
  // sem par na mesma linha (a 1 linha ja nao e forte), a lista vem vazia (nunca ausente)
  const longe = v.apurar([[veredito('correcao', [achado('P1', 'A.txt', 5), achado('P2', 'A.txt', 6)])]], { mapas: [MAPA_AB] });
  assert.strictEqual(longe.paresCandidatos.length, 1);
  assert.deepStrictEqual(longe.paresFortes, []);
  // o lado antigo nao faz par, nem forte
  const antigo = v.apurar([[veredito('correcao', [achado('P1', 'B.txt', 5)]), veredito('borda', [achado('P1', 'B.txt', 5)])]],
    { mapas: [MAPA_AB] });
  assert.deepStrictEqual(antigo.paresFortes, []);
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

test('D387/pares: sem achado novo na ultima ronda nao ha par; dois P2 novos vizinhos fazem par', () => {
  // D823: o P2 tambem e achado novo; a ronda 2 que so repete a 1 nao traz novo, e nao faz par
  const igual = [veredito('correcao', [achado('P1', 'A.txt', 5), achado('P2', 'A.txt', 6)])];
  const r1 = v.apurar([igual, igual], { mapas: [MAPA_AB, MAPA_AB] });
  assert.deepStrictEqual(r1.paresCandidatos, [], 'o repetido da ronda 1 nao e A');
  const r2 = v.apurar([[veredito('correcao', [achado('P2', 'A.txt', 5), achado('P2', 'A.txt', 6)])]], { mapas: [MAPA_AB] });
  assert.strictEqual(r2.paresCandidatos.length, 1, 'D823: dois P2 novos vizinhos fazem par');
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
  // D823: o P2 tambem e novo, entao ele tambem abre par com os vizinhos (cada par uma vez, na ordem em que apareceram)
  assert.deepStrictEqual(CHAVES(perto.paresCandidatos), [
    ['P2|trabalho|40|correcao', 'P1|trabalho|30|correcao'],
    ['P2|trabalho|40|correcao', 'P1|trabalho|35|correcao'],
    ['P1|trabalho|30|correcao', 'P2|trabalho|21|correcao'],
    ['P1|trabalho|30|correcao', 'P1|trabalho|35|correcao'],
    ['P2|trabalho|21|correcao', 'P2|trabalho|19|correcao']
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
  assert.match(ap3.motivo, /^teto de 3 rondas .*; 1 achado\(s\) ainda aberto\(s\), repetido\(s\) igual\(is\) na ultima/);
  // A3-06: o mesmo P1, em outra grafia da lente, e o que voltou igual na ultima, com a lente canonica
  assert.deepStrictEqual(ap3.achadosAindaAbertos.map((a) => [a.ronda, a.lente, a.linha]), [[3, 'correcao', 10]]);
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
  // D824: a familia de logica tem 8 (a escopo voltou)
  const oito = ['correcao', 'estados', 'borda', 'seguranca', 'manutencao', 'microcopy', 'enxuto', 'escopo'];
  assert.throws(() => v.apurar([oito.slice(0, 7).map(vazio), [vazio('correcao')]], { faixas: ['completa'] }), /8/);
  assert.throws(() => v.apurar([oito.slice(0, 7).concat(['banana']).map(vazio), [vazio('correcao')]], { faixas: ['completa'] }), /8/);
  // controles
  assert.strictEqual(v.apurar([[vazio('correcao'), vazio('borda')], [vazio('correcao')]], { faixas: ['duas'] }).encerrar, true);
  assert.strictEqual(v.apurar([oito.map(vazio), [vazio('correcao')]], { faixas: ['completa'] }).encerrar, true);
  assert.doesNotThrow(() => v.apurar([[vazio('Correção e regressão')]], { faixas: ['uma'] }), 'o titulo com acento e a lente');
  assert.doesNotThrow(() => v.apurar([[vazio('banana')], [vazio('banana')]]), 'sem faixa (base antiga), a conta de antes');
});

// F2d parte c: na faixa completa, as lentes pelo risco; o mapa.json da ronda 1 leva a lista e o apurar a confere
test('F2d: lentesDaCompleta corta seguranca sem risco, enxuto na mudanca pequena, e poe as de tela so com foto', () => {
  const logica = ['correcao', 'escopo', 'estados', 'borda', 'seguranca', 'manutencao', 'microcopy', 'enxuto'];
  assert.deepStrictEqual(v.lentesDaCompleta(), logica, 'sem saber, todas as de logica');
  assert.deepStrictEqual(v.lentesDaCompleta({ risco: true, grande: true }), logica);
  assert.deepStrictEqual(v.lentesDaCompleta({ risco: false }), logica.filter((l) => l !== 'seguranca'));
  assert.deepStrictEqual(v.lentesDaCompleta({ grande: false }), logica.filter((l) => l !== 'enxuto'));
  assert.deepStrictEqual(v.lentesDaCompleta({ estilo: true }), v.LENTES.map((l) => l.chave), 'estilo: as dez');
  const comFoto = v.lentesDaCompleta({ fotos: true });
  assert.deepStrictEqual(comFoto, logica.concat(v.LENTES_UI.map((l) => l.chave)), 'com foto, as de tela no fim');
  assert.ok(comFoto.indexOf('estados') !== -1 && comFoto.indexOf('borda') !== -1, 'estados e borda seguem separadas');
});

// H1-custo (D868): o arquivo de teste na faixa completa leva so as quatro lentes que acham P0/P1 nele
test('H1-custo: lentesDaCompleta do teste leva correcao, estados, borda e manutencao, e as de tela com foto', () => {
  assert.deepStrictEqual(v.lentesDaCompleta({ teste: true }), ['correcao', 'estados', 'borda', 'manutencao']);
  assert.deepStrictEqual(v.lentesDaCompleta({ teste: true, risco: true, grande: true }), v.LENTES_DO_TESTE);
  assert.deepStrictEqual(v.lentesDaCompleta({ teste: true, fotos: true }),
    v.LENTES_DO_TESTE.concat(v.LENTES_UI.map((l) => l.chave)), 'com foto, as de tela no fim');
  assert.strictEqual(v.lentesDaCompleta({ teste: false }).length, 8, 'teste false: como antes');
  for (const rel of ['test/a.js', 'tests/x/b.py', 'src/__tests__/c.ts', 'spec/d.rb', 'src/e.test.js', 'src/f.spec.tsx',
    'g.test.mjs', 'pkg/test_h.py', 'pkg/i_test.go', 'pkg/j_test.py', 'a\\test\\k.js', 'SRC/L.TEST.JS',
    'meu projeto/test/ação.test.js']) {
    assert.strictEqual(v.ehArquivoDeTeste(rel), true, rel);
  }
  for (const rel of ['src/latest.js', 'src/contest/a.js', 'src/testar.js', 'src/a.js', 'test.js', 'attest/a.js',
    'src/protest_x.py', 'docs/specs/fluxo.md', 'test/hooks/x.sh', 'test/fixture.json', '', null, undefined,
    // o de risco pelo caminho segue com todas as lentes, a seguranca inclusive
    'test/hooks/x.test.js', 'test\\.github\\y.test.js']) {
    assert.strictEqual(v.ehArquivoDeTeste(rel), false, String(rel));
  }
  assert.strictEqual(v.lentesDaCompleta({ teste: 'true' }).length, 8, 'so o true booleano corta');
  // o teste de estilo segue com design e medidor
  const estilo = v.lentesDaCompleta({ teste: true, estilo: true });
  assert.ok(estilo.indexOf('design') !== -1 && estilo.indexOf('medidor') !== -1, estilo.join(','));
  assert.ok(estilo.indexOf('microcopy') === -1, 'e sem as outras: ' + estilo.join(','));
});

test('F2d: temRisco pega o risco nas linhas e no caminho, e deixa passar a linha comum', () => {
  for (const t of ["fs.readFileSync(p)", "spawnSync('git', a)", "JSON.parse(x)", "process.env.TOKEN", "el.innerHTML = s",
    "path.join(a, b)", "require(nome)", "fetch(url)", "const senha = 1"]) {
    assert.strictEqual(v.temRisco(t, 'a.js'), true, t);
  }
  for (const t of ['const x = 1;', 'return a + b;', '', null, "const m = require('./m');"]) {
    assert.strictEqual(v.temRisco(t, 'src/a.js'), false, String(t));
  }
  for (const rel of ['hooks/hooks.json', '.claude-plugin/plugin.json', 'package.json', 'x/run.sh', 'ci.yml', 'a\\hooks\\b.js']) {
    assert.strictEqual(v.temRisco('const x = 1;', rel), true, rel);
  }
});

test('F2d: na completa, o apurar confere as lentes do mapa.json da ronda 1; sem a lista, o minimo de antes', () => {
  const vazio = (l) => veredito(l, []);
  const lista = ['correcao', 'escopo', 'estados', 'borda', 'manutencao', 'microcopy'];
  // as seis da lista votaram: a ronda 1 sem achado aprova (F2b), mesmo abaixo do minimo de oito
  assert.strictEqual(v.apurar([lista.map(vazio)], { faixas: ['completa'], lentesDoMapa: [lista] }).encerrar, true);
  // falta uma da lista: voto que falta, com o nome dela
  assert.throws(() => v.apurar([lista.slice(1).map(vazio)], { faixas: ['completa'], lentesDoMapa: [lista] }),
    (e) => e.codigo === 'VOTO_QUE_FALTA' && /correcao/.test(e.message));
  // lista que nao e de texto: vale o minimo de antes
  assert.throws(() => v.apurar([lista.map(vazio)], { faixas: ['completa'], lentesDoMapa: [[1, 2]] }), /8/);
  // lista vazia (ou ausente na ronda 1): tambem o minimo de antes, nunca "nada a cobrar"
  assert.throws(() => v.apurar([[vazio('correcao')]], { faixas: ['completa'], lentesDoMapa: [[]] }),
    (e) => e.codigo === 'VOTO_QUE_FALTA' && /o minimo e 8/.test(e.message));
  assert.throws(() => v.apurar([[vazio('correcao')]], { faixas: ['completa'], lentesDoMapa: [null] }),
    (e) => e.codigo === 'VOTO_QUE_FALTA' && /o minimo e 8/.test(e.message));
  // a lista so vale na completa: na faixa duas, as da faixa
  assert.throws(() => v.apurar([[vazio('correcao')]], { faixas: ['duas'], lentesDoMapa: [['correcao']] }), /borda/);
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

// ---------------------------------------------------------------- D1 (D820): a fronteira e o plano da lente de seguranca

test('D820: a pergunta da lente de seguranca pede a fronteira, a regua da gravidade e o plano do pendente', () => {
  const s = v.LENTES.find((l) => l.chave === 'seguranca');
  assert.match(s.pergunta, /entrada/);
  assert.match(s.pergunta, /controle/);
  assert.match(s.pergunta, /efeito/);
  assert.match(s.pergunta, /P0 derrota o controle/);
  assert.match(s.pergunta, /plano/);
});

test('D820: o P0/P1 de seguranca sem a fronteira inteira invalida o veredito e sai dos validos; o P2 nao precisa dela', () => {
  const sem = (sev, linha) => achado(sev, 'A.txt', linha);
  const ruins = [sem('P1', 2), achadoSeg('P1', 'A.txt', 3, 'd', Object.assign({}, FRONTEIRA, { efeito: '  ' })),
    achadoSeg('P0', 'A.txt', 4, 'd', 'texto solto'), achadoSeg('P1', 'A.txt', 5, 'd', Object.assign({}, FRONTEIRA, { controle: 7 })),
    achadoSeg('p1', 'A.txt', 7, 'd', null), achadoSeg('P0', 'A.txt', 8, 'd', {}),
    achadoSeg('P1', 'A.txt', 10, 'd', { controle: 'c', efeito: 'f' })];
  const r = v.validarVeredito(veredito('seguranca', [achadoSeg('P0', 'A.txt', 1), sem('P2', 6)].concat(ruins)));
  assert.deepStrictEqual(r.achadosValidos.map((a) => a.linha), [1, 6]);
  // um descarte por achado + o erro do veredito inteiro (como o sem trecho, D672)
  assert.strictEqual(r.erros.length, ruins.length + 1, JSON.stringify(r.erros));
  const doVeredito = v.errosDoVeredito(veredito('seguranca', ruins));
  assert.strictEqual(doVeredito.length, 1, JSON.stringify(doVeredito));
  assert.match(doVeredito[0], /^7 achado\(s\) P0\/P1 de seguranca sem a fronteira inteira: .*regrave o veredito$/);
  // o inteiro e o P2 sem fronteira nao invalidam; a grafia solta da lente e a mesma lente; as outras lentes nao cobram
  assert.deepStrictEqual(v.errosDoVeredito(veredito('seguranca', [achadoSeg('P0', 'A.txt', 1), sem('P2', 6)])), []);
  assert.strictEqual(v.errosDoVeredito(veredito('Seguranca e dado sensivel', [sem('P1', 2)])).length, 1);
  assert.strictEqual(v.validarVeredito(veredito('Seguranca e dado sensivel', [sem('P1', 2)])).achadosValidos.length, 0);
  // o pendente com severidade ja e descartado pelo que e; a fronteira so se cobra do confirmado
  const pendenteComSev = Object.assign(pendente('A.txt', 2, 'x'), { severidade: 'P1', plano: 'p' });
  assert.deepStrictEqual(v.errosDoVeredito(veredito('seguranca', [pendenteComSev])), []);
  assert.deepStrictEqual(v.errosDoVeredito(veredito('correcao', [sem('P1', 2)])), []);
  assert.strictEqual(v.validarVeredito(veredito('correcao', [sem('P1', 2)])).achadosValidos.length, 1);
});

test('D820: o pendente de seguranca sem plano invalida o veredito; o das outras lentes nao precisa', () => {
  const comPlano = Object.assign(pendente('A.txt', 1, 'se o proxy limpa o cabecalho'), { plano: 'rodar abrir() com ../x' });
  const ruins = [pendente('A.txt', 2, 'se o proxy limpa o cabecalho'),
    Object.assign(pendente('A.txt', 3, 'se o proxy limpa o cabecalho'), { plano: ' ' })];
  const r = v.validarVeredito(veredito('seguranca', [comPlano].concat(ruins)));
  assert.deepStrictEqual(r.pendentesValidos.map((p) => p.linha), [1]);
  assert.strictEqual(r.erros.length, ruins.length + 1, JSON.stringify(r.erros));
  assert.ok(r.erros.every((e) => /plano/.test(e)), JSON.stringify(r.erros));
  const doVeredito = v.errosDoVeredito(veredito('seguranca', ruins));
  assert.strictEqual(doVeredito.length, 1, JSON.stringify(doVeredito));
  assert.match(doVeredito[0], /^2 achado\(s\) pendente\(s\) de seguranca sem plano: .*regrave o veredito$/);
  assert.deepStrictEqual(v.errosDoVeredito(veredito('seguranca', [comPlano])), []);
  assert.deepStrictEqual(v.errosDoVeredito(veredito('correcao', [pendente('A.txt', 2, 'x')])), []);
  assert.strictEqual(v.validarVeredito(veredito('correcao', [pendente('A.txt', 2, 'x')])).pendentesValidos.length, 1);
});

test('D820: o P1 de seguranca sem fronteira para a apuracao (nada some calado); com ela, molha a ronda', () => {
  const M = { A: 'trabalho', B: 'HEAD' };
  assert.throws(() => v.apurar([[veredito('seguranca', [achado('P1', 'A.txt', 9)])], [veredito('seguranca', [])]],
    { mapas: [M, M] }), /lente "seguranca": 1 achado\(s\) P0\/P1 de seguranca sem a fronteira inteira/);
  const molhada = v.apurar([[veredito('seguranca', [achadoSeg('P1', 'A.txt', 9)])], [veredito('seguranca', [])]],
    { mapas: [M, M] });
  assert.strictEqual(molhada.encerrar, false);
});

// ---------------------------------------------------------------- D2 (D821): a prova da refutacao conferida por script

const M_D821 = { A: 'trabalho', B: 'HEAD' };
const RONDAS_D821 = [[veredito('correcao', [achado('P1', 'A.txt', 3)])], [veredito('correcao', [])]];
const REFUTA_D821 = { ronda: 1, lente: 'correcao', arquivo: 'A.txt', linha: 3, severidade: 'P1' };
/** Apura as duas rondas com uma refutacao do P1 da linha 3, `campos` por cima da base, e o disco `provaNoRepo`. */
function apurarRefutando(campos, provaNoRepo) {
  return v.apurar(RONDAS_D821, { mapas: [M_D821, M_D821], refutados: [Object.assign({}, REFUTA_D821, campos)],
    provaNoRepo: provaNoRepo });
}
/** O disco de mentira: so `scripts/instalar.js:433` tem `sha256:`; guarda cada consulta em `vistos`. */
function discoD821(vistos) {
  return (caminho, linha, simbolo) => {
    vistos.push([caminho, linha, simbolo]);
    return caminho === 'scripts/instalar.js' && linha === 433 && simbolo === 'sha256:';
  };
}

test('D821: o simbolo achado no arquivo:linha citado refuta', () => {
  const vistos = [];
  const ok = apurarRefutando({ prova: 'o hash e hex: scripts/instalar.js:433', simbolo: 'sha256:' }, discoD821(vistos));
  assert.strictEqual(ok.motivo, 'duas rondas secas seguidas: aprovado');
  assert.deepStrictEqual(vistos, [['scripts/instalar.js', 433, 'sha256:']]);
});

test('D821: com varias citacoes, basta uma conferir', () => {
  const vistos = [];
  const ok = apurarRefutando({ prova: 'ver docs/x.md:2 e scripts/instalar.js:433', simbolo: 'sha256:' }, discoD821(vistos));
  assert.strictEqual(ok.motivo, 'duas rondas secas seguidas: aprovado');
  assert.deepStrictEqual(vistos.map((x) => x[0] + ':' + x[1]), ['docs/x.md:2', 'scripts/instalar.js:433']);
});

test('D821: a citacao de intervalo (arquivo:a-b) vale pela primeira linha', () => {
  const vistos = [];
  apurarRefutando({ prova: 'scripts/instalar.js:433-440', simbolo: 'sha256:' }, discoD821(vistos));
  assert.deepStrictEqual(vistos.map((x) => x[1]), [433]);
});

test('F5b r1: a citacao com a letra do disco chega inteira ao disco; sem letra, como antes', () => {
  const vistos = [];
  // o disco de mentira so conhece o caminho relativo: a refutacao nao confere, e o que importa e o caminho consultado
  assert.throws(() => apurarRefutando({ prova: 'ver C:/repo/scripts/instalar.js:433 e docs/x.md:2', simbolo: 'sha256:' },
    discoD821(vistos)), /prova que nao confere/);
  assert.deepStrictEqual(vistos.map((x) => x[0]), ['C:/repo/scripts/instalar.js', 'docs/x.md']);
});

test('F5b r1: severidade invalida diz o que veio, os valores que valem e que o achado (ou a lacuna) saiu', () => {
  const sem = Object.assign(achado('P1', 'A.txt', 3), { severidade: undefined });
  const r = v.validarVeredito(veredito('correcao', [sem, achado('alta', 'A.txt', 4)]));
  assert.strictEqual(r.achadosValidos.length, 0);
  assert.ok(r.erros.some((e) => e.includes('(sem severidade; vale P0, P1 ou P2), descartado')), JSON.stringify(r.erros));
  assert.ok(r.erros.some((e) => e.includes('(veio "ALTA"; vale P0, P1 ou P2), descartado')), JSON.stringify(r.erros));
  assert.ok(r.erros.every((e) => e.indexOf('undefined') === -1), JSON.stringify(r.erros));
  const vd = Object.assign(veredito('correcao', []), { vsReferencia: { A: 'empata', B: 'empata' },
    lacunas: [{ arquivo: 'A.txt', linha: 2, descricao: 'falta x' }] });
  const rl = v.validarVeredito(vd, { comReferencia: true });
  assert.ok(rl.erros.some((e) => e.includes('lacuna com severidade invalida (sem severidade; vale P0, P1 ou P2), descartada')),
    JSON.stringify(rl.erros));
});

test('D821: o comando rodado refuta sem citar arquivo, e o disco nem e consultado', () => {
  const vistos = [];
  assert.strictEqual(apurarRefutando({ prova: 'a suite passa', comando: 'node --test test/a.test.js' },
    discoD821(vistos)).motivo, 'duas rondas secas seguidas: aprovado');
  assert.deepStrictEqual(vistos, []);
});

// a mensagem diz o que trazer: o simbolo da linha citada, ou o comando
const NAO_CONFERE = /refutacao com prova que nao confere.*"simbolo".*"comando"/;

test('D821: o simbolo ausente ou em branco para, mesmo com o disco que aceitaria tudo', () => {
  // o texto vazio esta em toda linha: o disco nem chega a ser consultado
  for (const simbolo of [undefined, '', '   ']) {
    assert.throws(() => apurarRefutando({ prova: 'scripts/instalar.js:433', simbolo: simbolo }, () => true), NAO_CONFERE,
      String(simbolo));
  }
});

test('D821: o simbolo que nao esta na linha citada para', () => {
  assert.throws(() => apurarRefutando({ prova: 'scripts/instalar.js:433', simbolo: 'md5' }, discoD821([])), NAO_CONFERE);
});

test('D821: a prova sem nenhuma citacao arquivo:linha para', () => {
  assert.throws(() => apurarRefutando({ prova: 'olhei e esta certo', simbolo: 'sha256:' }, discoD821([])), NAO_CONFERE);
});

test('D821: o comando em branco nao vale como comando', () => {
  assert.throws(() => apurarRefutando({ prova: 'scripts/instalar.js:433', comando: ' ' }, discoD821([])), NAO_CONFERE);
});

test('D822: a lente que nao e texto e veredito sem lente (antes escapava das regras da lente de seguranca)', () => {
  for (const lente of [7, ['seguranca'], { k: 1 }, null, undefined]) {
    assert.ok(v.errosDoVeredito({ lente: lente, melhor: 'A', achados: [] }).includes('veredito sem lente'), String(lente));
  }
  // e a apuracao para nela, em vez de seguir com a lente virada texto
  assert.throws(() => v.apurar([[{ lente: ['seguranca'], melhor: 'A', achados: [] }]]), /veredito sem lente/);
  assert.deepStrictEqual(v.errosDoVeredito({ lente: 'seguranca', melhor: 'A', achados: [] }), []);
});

test('D822: a lente em branco tambem e veredito sem lente', () => {
  assert.ok(v.errosDoVeredito({ lente: '  ', melhor: 'A', achados: [] }).includes('veredito sem lente'));
});

test('D821: sem o disco (quem chama a lib pura), vale a regra de antes', () => {
  assert.strictEqual(apurarRefutando({ prova: 'x.js:9' }).motivo, 'duas rondas secas seguidas: aprovado');
});


// ---------------------------------------------------------------- D3 (D824): a lente do pedido e os dois eixos

test('D824: a lente escopo julga contra o pedido (o que falta, o que nao foi pedido, o que esta errado) e roda em logica', () => {
  const l = v.LENTES.find((x) => x.chave === 'escopo');
  for (const t of ['pedido.md', 'falta', 'nao foi pedido', 'errado', 'cite a linha do pedido.md']) {
    assert.ok(l.pergunta.includes(t), 'a pergunta nao diz: ' + t);
  }
  assert.ok(/^[\x20-\x7E]+$/.test(l.pergunta), 'pergunta fora de ASCII');
  assert.strictEqual(v.SAEM_SO_LOGICA.indexOf('escopo'), -1, 'a lente do pedido roda no arquivo so de logica');
});

test('D824: a apuracao separa os achados novos em dois eixos, padrao e pedido, sem placar unico', () => {
  const r = v.apurar([[veredito('correcao', [achado('P1', 'A.txt', 3), achado('P2', 'A.txt', 9)]),
    veredito('escopo', [achado('P2', 'A.txt', 5, 'faltou o item 2 do pedido')])]], { mapas: [MAPA_AB] });
  assert.deepStrictEqual(r.eixos, {
    padrao: { novos: 2, pior: 'P1' },
    pedido: { novos: 1, pior: 'P2' }
  });
  const seco = v.apurar([[veredito('correcao', [])]]);
  assert.deepStrictEqual(seco.eixos, { padrao: { novos: 0, pior: null }, pedido: { novos: 0, pior: null } });
  // o P0 e o pior de qualquer ordem, e o achado do lado antigo (B = HEAD) nao entra em eixo nenhum
  const comP0 = v.apurar([[veredito('escopo', [achado('P2', 'A.txt', 1), achado('P0', 'A.txt', 2), achado('P1', 'A.txt', 3)]),
    veredito('correcao', [achado('P0', 'B.txt', 4)])]], { mapas: [MAPA_AB] });
  assert.deepStrictEqual(comP0.eixos, { padrao: { novos: 0, pior: null }, pedido: { novos: 3, pior: 'P0' } });
});

// ---------------------------------------------------------------- F2a (D828.5): as rondas 2 e 3 so verificam

// `mudancas[i]` = os blocos (forma do diff-linhas.js) entre o lado novo da ronda i e o da ronda i+1 (indice a partir
// de 0; a posicao 0 nao se usa). So segura a ronda 2 ou 3 o achado do lado novo a ate 2 linhas de uma linha que o
// conserto tocou ou que uma ronda anterior citou; o resto sai em `registros` como "linha nova".
const TRAB = { A: 'trabalho', B: 'HEAD' };
const blocoDe = (antigoIni, antigoQtd, novoIni, novoQtd) => ({ antigoIni, antigoQtd, novoIni, novoQtd });
const p1DaBorda = (linha) => veredito('borda', [achado('P1', 'A.txt', linha, 'quebra na borda')]);
/** Ronda 1 com um P1 da correcao na linha 10 do lado novo; a ronda 2 e a lista dada, com a mudanca entre as duas. */
function apurarRonda2(vereditos2, mudanca, extra) {
  return v.apurar([[veredito('correcao', [achado('P1', 'A.txt', 10)])], vereditos2],
    Object.assign({ mapas: [TRAB, TRAB], mudancas: [null, mudanca] }, extra || {}));
}
/** As linhas (do lado novo da ronda 2) em que um P1 de outra lente segura a ronda, entre as dadas. */
function linhasQueSeguram(linhas, mudanca, ronda1) {
  return linhas.filter(function (linha) {
    const rondas = [ronda1 || [veredito('correcao', [achado('P1', 'A.txt', 10)])], [p1DaBorda(linha)]];
    const r = v.apurar(rondas, { mapas: [TRAB, TRAB], mudancas: [null, mudanca] });
    const daRonda2 = r.registros.filter((a) => a.ronda === 2);
    assert.strictEqual(r.novos.length + daRonda2.length, 1, 'linha ' + linha + ': ou segura, ou e registro');
    return r.novos.length === 1;
  });
}

test('D828.5: na ronda 2, o achado em linha nova vira registro e nao molha; a ate 2 linhas da tocada, segura', () => {
  const trocouA10 = [blocoDe(10, 1, 10, 1)];
  const r = apurarRonda2([p1DaBorda(30)], trocouA10);
  assert.strictEqual(r.secas, 1);
  assert.deepStrictEqual(r.novos, []);
  assert.deepStrictEqual(r.registros, [Object.assign({ ronda: 2, lente: 'borda' }, achado('P1', 'A.txt', 30, 'quebra na borda'),
    { registro: 'linha nova' })]);
  assert.deepStrictEqual(r.paresCandidatos, [], 'o registro nao faz par para o juiz');
  assert.deepStrictEqual(linhasQueSeguram([7, 8, 9, 10, 11, 12, 13], trocouA10), [8, 9, 10, 11, 12]);
  // o bloco de varias linhas: todas as novas dele, e 2 de cada lado
  assert.deepStrictEqual(linhasQueSeguram([17, 18, 20, 24, 26, 27], [blocoDe(20, 1, 20, 5)]), [18, 20, 24, 26]);
});

test('D828.5: a linha citada antes (achado ou pendente do lado novo) segura a ate 2 linhas; a do lado antigo nao cita', () => {
  const ronda1 = [veredito('correcao', [achado('P1', 'A.txt', 10), pendente('A.txt', 50, 'o que ler() devolve'),
    achado('P1', 'B.txt', 70)])];
  assert.deepStrictEqual(linhasQueSeguram([7, 8, 12, 13, 47, 48, 52, 53, 68, 70, 72], [], ronda1), [8, 12, 48, 52]);
  // a melhoria da ronda 1 tambem cita a linha dela: o que vier ali na ronda 2 e verificacao, nao linha nova
  const comMelhoria = [veredito('correcao', [achado('P1', 'A.txt', 10), achadoMelhoria(90)])];
  assert.deepStrictEqual(linhasQueSeguram([87, 88, 92, 93], [], comMelhoria), [88, 92]);
});

test('D828.5: a linha citada acompanha o arquivo: desce com a insercao, sobe com a remocao, some com a troca', () => {
  // 2 linhas entram depois da 3: tocadas 4 e 5; a citada 10 vira 12
  assert.deepStrictEqual(linhasQueSeguram([1, 2, 7, 8, 9, 10, 14, 15], [blocoDe(3, 0, 4, 2)]), [2, 7, 10, 14]);
  // as linhas 4 e 5 saem: o ponto da remocao sao as novas 3 e 4; a citada 10 vira 8
  assert.deepStrictEqual(linhasQueSeguram([1, 2, 3, 5, 6, 7, 10, 11], [blocoDe(4, 2, 3, 0)]), [1, 2, 3, 5, 6, 7, 10]);
  // a propria linha citada sai (remocao da 10): fica o ponto da remocao, as novas 9 e 10
  assert.deepStrictEqual(linhasQueSeguram([6, 7, 12, 13], [blocoDe(10, 1, 9, 0)]), [7, 12]);
});

test('D828.5: sem a medida (sem mudancas, sem mapa do trabalho, mudanca que nao e lista) tudo molha como antes', () => {
  const rondas = [[veredito('correcao', [achado('P1', 'A.txt', 10)])], [p1DaBorda(30)]];
  const molha = function (opcoes, caso) {
    const r = v.apurar(rondas, opcoes);
    assert.deepStrictEqual([r.novos.length, r.registros.length, r.secas], [1, 0, 0], caso);
  };
  molha(undefined, 'sem opcoes');
  molha({ mapas: [TRAB, TRAB] }, 'sem mudancas');
  molha({ mapas: [TRAB, TRAB], mudancas: [null, null] }, 'mudanca nula');
  molha({ mapas: [TRAB, TRAB], mudancas: [null, 'x'] }, 'mudanca que nao e lista');
  molha({ mapas: [TRAB, TRAB], mudancas: 'x' }, 'mudancas que nao e lista');
  molha({ mapas: [null, TRAB], mudancas: [null, []] }, 'ronda 1 sem mapa: nao ha linha citada para levar');
  molha({ mapas: [{ A: 'trabalho' }, TRAB], mudancas: [null, []] }, 'ronda 1 com o mapa pela metade');
  molha({ mapas: [TRAB, null], mudancas: [null, []] }, 'ronda 2 sem mapa: o achado nao tem lado');
  // controle: com tudo no lugar, o mesmo achado e registro
  assert.strictEqual(v.apurar(rondas, { mapas: [TRAB, TRAB], mudancas: [null, []] }).registros.length, 1);
  // a ronda 1 descobre: nela nada e "linha nova", com ou sem mudancas
  const r1 = v.apurar([[p1DaBorda(30)]], { mapas: [TRAB], mudancas: [[]] });
  assert.deepStrictEqual([r1.novos.length, r1.registros.length], [1, 0]);
});

test('D828.5: na ronda 3 valem as citadas das duas rondas e as tocadas dos dois consertos, levadas ate ela', () => {
  const r1 = [veredito('correcao', [achado('P1', 'A.txt', 10)])];
  const ronda3 = function (linha, mudancas) {
    // a ronda 2 deixa um registro na linha 40 (linha nova): a linha fica citada para a ronda 3
    const r = v.apurar([r1, [p1DaBorda(40)], [veredito('enxuto', [achado('P1', 'A.txt', linha, 'sobra')])]],
      { mapas: [TRAB, TRAB, TRAB], mudancas: mudancas });
    return r.novos.length === 1 ? 'segura' : r.registros.filter((a) => a.ronda === 3).map((a) => a.registro).join();
  };
  const parado = [null, [], []];
  assert.deepStrictEqual([10, 12, 13, 38, 40, 42, 43, 70].map((l) => ronda3(l, parado)),
    ['segura', 'segura', 'linha nova', 'segura', 'segura', 'segura', 'linha nova', 'linha nova']);
  // dois consertos: 2 linhas entram depois da 3 (ronda 2), 1 entra depois da 1 (ronda 3). A citada 10 vira 12 e 13;
  // as tocadas 4 e 5 da ronda 2 viram 5 e 6; a tocada da ronda 3 e a 2; a citada 40 (ja da ronda 2) vira 41.
  const doisConsertos = [null, [blocoDe(3, 0, 4, 2)], [blocoDe(1, 0, 2, 1)]];
  assert.deepStrictEqual([8, 9, 10, 11, 15, 16, 38, 39, 43, 44].map((l) => ronda3(l, doisConsertos)),
    ['segura', 'linha nova', 'linha nova', 'segura', 'segura', 'linha nova', 'linha nova', 'segura', 'segura', 'linha nova']);
  // a medida que falta numa ronda nao volta na seguinte: sem a da ronda 2, a ronda 3 molha tudo
  assert.strictEqual(ronda3(70, [null, null, []]), 'segura');
});

test('D828.5: o registro de linha nova nao obriga a lente a voltar, e duas rondas secas aprovam com ele listado', () => {
  const r = v.apurar([[veredito('correcao', [achado('P1', 'A.txt', 10)])],
    [veredito('correcao', [achado('P1', 'A.txt', 30, 'outro defeito')])], [veredito('borda', [])]],
  { mapas: [TRAB, TRAB, TRAB], mudancas: [null, [blocoDe(10, 1, 10, 1)], []], faixas: ['uma', 'uma', 'uma'] });
  assert.strictEqual(r.motivo, 'duas rondas secas seguidas: aprovado');
  assert.deepStrictEqual(r.registros.map((a) => [a.ronda, a.lente, a.linha, a.severidade, a.registro]),
    [[2, 'correcao', 30, 'P1', 'linha nova']]);
});

test('D828.5: o achado que foi registro de linha nova e volta igual na ronda seguinte segura; a melhoria repetida nao', () => {
  const r1 = [veredito('correcao', [achado('P1', 'A.txt', 10)])];
  const parado = { mapas: [TRAB, TRAB, TRAB], mudancas: [null, [], []] };
  // a ronda 2 registra o P1 da borda na linha 30 (linha nova) e a linha fica citada; a ronda 3 traz o mesmo achado
  const r = v.apurar([r1, [p1DaBorda(30)], [p1DaBorda(30)]], parado);
  assert.deepStrictEqual(r.registros.map((a) => [a.ronda, a.linha, a.registro]), [[2, 30, 'linha nova']]);
  assert.deepStrictEqual(r.novos.map((a) => [a.linha, a.descricao]), [[30, 'quebra na borda']]);
  assert.strictEqual(r.secas, 0);
  // abertos: o P1 da ronda 1, que a correcao nao voltou para fechar, e este
  assert.match(r.motivo, /^teto de 3 rondas com 2 achado\(s\) aberto\(s\)/);
  // com o conserto entre as rondas 2 e 3 (1 linha entra depois da 3), o mesmo achado volta na 31 e segura igual
  const levado = v.apurar([r1, [p1DaBorda(30)], [p1DaBorda(31)]],
    { mapas: [TRAB, TRAB, TRAB], mudancas: [null, [], [blocoDe(3, 0, 4, 1)]] });
  assert.deepStrictEqual(levado.novos.map((a) => a.linha), [31]);
  // a melhoria repetida na ronda seguinte e um registro so, e nao segura
  const melhoria = () => veredito('borda', [achadoMelhoria(30)]);
  const m = v.apurar([r1, [melhoria()], [melhoria()]], parado);
  assert.deepStrictEqual([m.novos.length, m.registros.map((a) => [a.ronda, a.registro])], [0, [[2, 'melhoria']]]);
});

test('D828.5: na ronda 2, a melhoria segue melhoria; o refutado e o do lado antigo nao viram registro', () => {
  const melhoria = apurarRonda2([veredito('borda', [achadoMelhoria(30)])], []);
  assert.deepStrictEqual(melhoria.registros.map((a) => a.registro), ['melhoria']);
  const refutado = apurarRonda2([p1DaBorda(30)], [], { refutados: [{ ronda: 2, lente: 'borda', arquivo: 'A.txt', linha: 30,
    severidade: 'P1', prova: 'scripts/x.js:1' }] });
  assert.deepStrictEqual([refutado.novos.length, refutado.registros.length, refutado.secas], [0, 0, 1]);
  const antigo = apurarRonda2([veredito('borda', [achado('P1', 'B.txt', 30)])], []);
  assert.deepStrictEqual([antigo.novos.length, antigo.registros.length, antigo.achadosDoLadoAntigo.length], [0, 0, 1]);
  // o achado que cita um arquivo que nao e o A.txt nem o B.txt nao tem lado: nao ha linha medida para ele, e ele segura
  const semLado = apurarRonda2([veredito('borda', [achado('P1', 'scripts/x.js', 30)])], []);
  assert.deepStrictEqual([semLado.novos.length, semLado.registros.length, semLado.secas], [1, 0, 0]);
});

test('D828.5: com referencia, o achado da ordem trocada em linha nova sai no registro com passada 2', () => {
  const ok = (achados) => comRef('correcao', 'empata', 'empata', achados);
  const r1 = rondaRef([ok([achado('P1', 'A.txt', 10)])], [ok([])]);
  // na 2a passada o lado novo e o B.txt
  const r2 = rondaRef([ok([])], [ok([achado('P1', 'B.txt', 30, 'so na ordem trocada'), achado('P1', 'B.txt', 11, 'ao lado do conserto')])]);
  const r = apurarRef([r1, r2], { mudancas: [null, [blocoDe(10, 1, 10, 1)]] });
  assert.deepStrictEqual(r.registros.map((a) => [a.ronda, a.passada, a.linha, a.registro]), [[2, 2, 30, 'linha nova']]);
  assert.deepStrictEqual(r.novos.map((a) => [a.passada, a.linha]), [[2, 11]]);
});

// F2b (D828, programa da Fase O): o `tipo` do P2 e obrigatorio. O P2 confirmado sem `tipo` (ou com um valor que nao e
// erro nem melhoria) invalida o veredito inteiro, como o achado sem estado: o apurar para e o gravador nao grava.
test('F2b: o P2 confirmado sem tipo, ou com tipo que nao e erro nem melhoria, invalida o veredito', () => {
  const p2 = (tipo) => Object.assign(p2SemTipo('A.txt', 3), tipo === undefined ? {} : { tipo: tipo });
  for (const tipo of [undefined, null, '', '  ', 'outra coisa', 'erro grave', true, 1, ['erro'], { tipo: 'erro' }]) {
    const erros = v.errosDoVeredito(veredito('correcao', [p2(tipo)]));
    assert.strictEqual(erros.length, 1, JSON.stringify([tipo, erros]));
    assert.match(erros[0], /^1 achado\(s\) P2 sem "tipo"/, String(tipo));
    assert.match(erros[0], /"erro"/);
    assert.match(erros[0], /"melhoria"/);
    assert.match(erros[0], /regrave o veredito$/);
    assert.match(erros[0], /^[\x20-\x7E]+$/, 'a mensagem vai ao modelo: so ASCII');
    assert.throws(() => v.apurar([[veredito('correcao', [p2(tipo)])]]), /P2 sem "tipo"/, String(tipo));
  }
  // a conta e por achado, e a severidade vale em qualquer grafia ("p2", " P2 ")
  const tres = v.errosDoVeredito(veredito('correcao', [p2(), achado('p2', 'A.txt', 4), achado(' P2 ', 'A.txt', 5), p2('erro')]));
  assert.strictEqual(tres.length, 1);
  assert.match(tres[0], /^3 achado\(s\) P2 sem "tipo"/);
});

test('F2b: com tipo erro ou melhoria o P2 vale; o P0, o P1 e o pendente nao pedem tipo', () => {
  const p2 = (tipo) => Object.assign(achado('P2', 'A.txt', 3), { tipo: tipo });
  for (const tipo of ['erro', 'melhoria', ' Melhoria ', 'ERRO']) {
    assert.deepStrictEqual(v.errosDoVeredito(veredito('correcao', [p2(tipo)])), [], tipo);
  }
  assert.deepStrictEqual(v.errosDoVeredito(veredito('correcao', [achado('P0', 'A.txt', 1), achado('P1', 'A.txt', 2),
    pendente('A.txt', 3, 'o que a funcao devolve')])), []);
  // o estado que falta segue sendo o erro do achado sem estado, nao o do tipo
  const semEstado = v.errosDoVeredito(veredito('correcao', [{ severidade: 'P2', arquivo: 'A.txt', linha: 3, descricao: 'x' }]));
  assert.ok(semEstado.length > 0 && semEstado.every((e) => !/"tipo"/.test(e)), JSON.stringify(semEstado));
});

test('F2b: o tipo vale em qualquer grafia de caixa e espaco: " Melhoria " e registro, "ERRO" segura a ronda', () => {
  const p2 = (tipo, linha) => Object.assign(achado('P2', 'A.txt', linha), { tipo: tipo });
  const r = v.apurar([[veredito('correcao', [p2(' Melhoria ', 3), p2('ERRO', 9)])]]);
  assert.deepStrictEqual(r.registros.map((a) => [a.linha, a.registro]), [[3, 'melhoria']]);
  assert.deepStrictEqual(r.novos.map((a) => a.linha), [9]);
  assert.strictEqual(r.secas, 0);
});

// F2b: a ronda 1 completa (todas as lentes da faixa votaram) em que nenhum veredito traz achado nenhum aprova em 1
// ronda. No diagnostico da D828, 21% das revisoes tinham a ronda 1 assim e ainda gastavam a ronda 2.
const UMA_RONDA = 'ronda 1 completa sem achado nenhum: aprovado';
const OITO = ['correcao', 'estados', 'borda', 'seguranca', 'manutencao', 'microcopy', 'enxuto', 'escopo'];
const vazios = (lentes) => lentes.map((l) => veredito(l, []));

test('F2b: a ronda 1 com todas as lentes da faixa e sem achado nenhum aprova em 1 ronda', () => {
  for (const [faixa, lentes] of [['uma', ['correcao']], ['duas', ['correcao', 'borda']], ['texto', ['correcao', 'microcopy']],
    ['doc', ['correcao']], ['completa', OITO]]) {
    const r = v.apurar([vazios(lentes)], { faixas: [faixa], mapas: [{ A: 'trabalho', B: 'HEAD' }] });
    assert.deepStrictEqual([r.encerrar, r.motivo, r.ronda, r.secas], [true, UMA_RONDA, 1, 1], faixa);
    assert.deepStrictEqual([r.novos, r.registros, r.pendentes], [[], [], []], faixa);
  }
});

test('F2b: sem a faixa (base antiga), a ronda 1 sem achado nao aprova: ninguem conferiu as lentes', () => {
  const r = v.apurar([vazios(['correcao'])]);
  assert.deepStrictEqual([r.encerrar, r.secas], [false, 1]);
  assert.match(r.motivo, /^ronda 2 chama/);
  // e a ronda 1 da faixa sem uma das lentes segue sendo voto que falta, nao aprovacao
  assert.throws(() => v.apurar([vazios(['correcao'])], { faixas: ['duas'] }), (e) => e.codigo === 'VOTO_QUE_FALTA');
});

// H1-custo (D868): a melhoria confirmada vai ao registro e nao pede a ronda 2; a fora do formato pede
test('H1-custo: a ronda 1 so com melhoria aprova sozinha, e a melhoria vai ao registro', () => {
  const M = { A: 'trabalho', B: 'HEAD' };
  const melhoria = Object.assign(achado('P2', 'A.txt', 3), { tipo: 'melhoria' });
  const r = v.apurar([[veredito('correcao', [melhoria]), veredito('borda', [])]], { faixas: ['duas'], mapas: [M] });
  assert.deepStrictEqual([r.encerrar, r.aprovado, r.ronda], [true, true, 1]);
  assert.strictEqual(r.motivo, 'ronda 1 completa so com melhoria (vai ao registro): aprovado');
  assert.strictEqual(r.registros.length, 1, 'a melhoria no registro');
  // escrita em outra caixa, a mesma melhoria aprova igual
  const outraCaixa = Object.assign(achado('P2', 'A.txt', 3), { tipo: ' Melhoria ' });
  const r1 = v.apurar([[veredito('correcao', [outraCaixa])]], { faixas: ['uma'], mapas: [M] });
  assert.deepStrictEqual([r1.encerrar, r1.aprovado], [true, true], 'a melhoria em outra caixa');
  const semSeveridade = Object.assign(achado('alta', 'A.txt', 3), { tipo: 'melhoria' });
  const r2 = v.apurar([[veredito('correcao', [semSeveridade])]], { faixas: ['uma'], mapas: [M] });
  assert.deepStrictEqual([r2.encerrar, r2.secas], [false, 1], 'a melhoria fora do formato segura');
  // o P0 ou P1 marcado melhoria e erro aberto: segura
  for (const sev of ['P0', 'P1']) {
    const grave = Object.assign(achado(sev, 'A.txt', 3), { tipo: 'melhoria' });
    const r3 = v.apurar([[veredito('correcao', [grave])]], { faixas: ['uma'], mapas: [M] });
    assert.deepStrictEqual([r3.encerrar, r3.aprovado], [false, false], sev + ' marcado melhoria');
  }
  // a melhoria do lado velho, ou sem lado (sem mapa ou citando os dois), segura como qualquer achado de la
  const doVelho = Object.assign(achado('P2', 'B.txt', 3), { tipo: 'melhoria' });
  const r4 = v.apurar([[veredito('correcao', [doVelho])]], { faixas: ['uma'], mapas: [M] });
  assert.deepStrictEqual([r4.encerrar, r4.aprovado, r4.secas], [false, false, 1], 'a melhoria do lado velho');
  const dosDois = Object.assign(achado('P2', 'A.txt e B.txt', 3), { tipo: 'melhoria' });
  const r5 = v.apurar([[veredito('correcao', [dosDois])]], { faixas: ['uma'], mapas: [M] });
  assert.deepStrictEqual([r5.encerrar, r5.aprovado], [false, false], 'a melhoria sem lado');
  const r6 = v.apurar([[veredito('correcao', [melhoria])]], { faixas: ['uma'] });
  assert.deepStrictEqual([r6.encerrar, r6.aprovado], [false, false], 'a melhoria sem mapa');
  // a melhoria que o validarVeredito descarta (linha 0, linha sem numero) nao conta como melhoria: segura
  for (const [nome, campo] of [['linha 0', { linha: 0 }], ['linha sem numero', { linha: 'perto do fim' }]]) {
    const descartada = Object.assign(achado('P2', 'A.txt', 3), { tipo: 'melhoria' }, campo);
    const r7 = v.apurar([[veredito('correcao', [descartada])]], { faixas: ['uma'], mapas: [M] });
    assert.deepStrictEqual([r7.encerrar, r7.aprovado], [false, false], 'a melhoria descartada ' + nome);
  }
});

test('F2b: qualquer achado na ronda 1 que nao seja melhoria, mesmo o que nao segura a ronda, pede a ronda 2', () => {
  const M = { A: 'trabalho', B: 'HEAD' };
  const casos = {
    'pendente': [pendente('A.txt', 3, 'o que a funcao devolve')],
    'do lado antigo': [achado('P1', 'B.txt', 3)],
    'fora do formato (descartado)': [achado('alta', 'A.txt', 3)],
    'sem arquivo:linha (descartado)': [achado('P1', '', 3)]
  };
  for (const nome of Object.keys(casos)) {
    const r = v.apurar([[veredito('correcao', casos[nome])]], { faixas: ['uma'], mapas: [M] });
    assert.deepStrictEqual([r.encerrar, r.secas], [false, 1], nome);
    assert.match(r.motivo, /^ronda 2 chama/, nome);
  }
  // o refutado e o de trecho que nao confere tambem: houve achado, e a ronda 2 confere
  const p1 = [veredito('correcao', [achado('P1', 'A.txt', 3)])];
  const refutado = v.apurar([p1], { faixas: ['uma'], mapas: [M], refutados: [{ ronda: 1, lente: 'correcao', arquivo: 'A.txt',
    linha: 3, severidade: 'P1', prova: 'scripts/x.js:1' }] });
  assert.deepStrictEqual([refutado.encerrar, refutado.secas], [false, 1]);
  const semTrecho = v.apurar([p1], { faixas: ['uma'], mapas: [M], trechoNoArquivo: () => false });
  assert.deepStrictEqual([semTrecho.encerrar, semTrecho.secas, semTrecho.trechoNaoConfere.length], [false, 1, 1]);
  // um veredito so com achado, entre os da faixa, ja basta
  const umSo = v.apurar([[veredito('correcao', []), veredito('borda', [pendente('A.txt', 3, 'o que a funcao devolve')])]],
    { faixas: ['duas'], mapas: [M] });
  assert.strictEqual(umSo.encerrar, false);
});

test('F2b: so a ronda 1 aprova sozinha: a ronda 2 seca depois de uma ronda 1 com achado segue pedindo a 3', () => {
  const M = { A: 'trabalho', B: 'HEAD' };
  const r = v.apurar([[veredito('correcao', [achado('P1', 'A.txt', 3)])], vazios(['correcao'])], { faixas: ['uma', 'uma'],
    mapas: [M, M], mudancas: [null, []] });
  assert.deepStrictEqual([r.encerrar, r.secas], [false, 1]);
  assert.match(r.motivo, /^ronda 3 chama/);
});

test('F2b: com referencia, a ronda 1 sem achado so aprova com a referencia alcancada e sem lacuna nenhuma', () => {
  const ok = () => comRef('correcao', 'empata', 'vence');
  const pronta = apurarRef([rondaRef([ok()], [ok()])], { faixas: ['uma'] });
  assert.deepStrictEqual([pronta.encerrar, pronta.motivo, pronta.referencia.pronta], [true, UMA_RONDA, true]);
  const atras = apurarRef([rondaRef([comRef('correcao', 'perde', 'vence')], [ok()])], { faixas: ['uma'] });
  assert.deepStrictEqual([atras.encerrar, atras.referencia.pronta], [false, false]);
  assert.match(atras.motivo, /^ronda 2 chama/);
  // a lacuna P2 nao barra a referencia, mas e um achado contra ela: a ronda 2 confere
  const comLacuna = apurarRef([rondaRef([comRef('correcao', 'empata', 'empata', [], [lacuna('P2', 'A.txt', 4)])], [ok()])],
    { faixas: ['uma'] });
  assert.deepStrictEqual([comLacuna.encerrar, comLacuna.referencia.pronta], [false, true]);
  // o achado so na ordem trocada tambem conta
  const naTrocada = apurarRef([rondaRef([ok()], [comRef('correcao', 'empata', 'empata', [pendente('B.txt', 3, 'x')])])],
    { faixas: ['uma'] });
  assert.strictEqual(naTrocada.encerrar, false);
  // e a lacuna so na ordem trocada tambem
  const lacunaNaTrocada = apurarRef([rondaRef([ok()], [comRef('correcao', 'empata', 'empata', [], [lacuna('P2', 'B.txt', 4)])])],
    { faixas: ['uma'] });
  assert.deepStrictEqual([lacunaNaTrocada.encerrar, lacunaNaTrocada.referencia.pronta], [false, true]);
});

test('F2b: a lente que nao voltou e a que achou P0, P1 ou P2 de erro, e a mensagem diz isso', () => {
  const M = { A: 'trabalho', B: 'HEAD' };
  const p2Erro = Object.assign(achado('P2', 'A.txt', 9), { tipo: 'erro' });
  const r1 = [veredito('correcao', []), veredito('borda', [p2Erro])];
  assert.throws(() => v.apurar([r1, vazios(['correcao'])], { mapas: [M, M], faixas: ['duas'], mudancas: [null, []] }),
    (e) => e.codigo === 'VOTO_QUE_FALTA' && /acharam P0, P1 ou P2 de erro do lado novo na ronda 1: borda/.test(e.message));
});

test('F2b: a base com a ronda 2 ja aberta nao aprova pela ronda 1 vazia: vale a regra das duas secas', () => {
  const M = { A: 'trabalho', B: 'HEAD' };
  const opcoes = { faixas: ['uma', 'uma'], mapas: [M, M], mudancas: [null, null] };
  const molhada = v.apurar([vazios(['correcao']), [veredito('correcao', [achado('P1', 'A.txt', 3)])]], opcoes);
  assert.deepStrictEqual([molhada.encerrar, molhada.ronda, molhada.secas], [false, 2, 0]);
  assert.match(molhada.motivo, /^ronda 3 chama/);
  const seca = v.apurar([vazios(['correcao']), vazios(['correcao'])], opcoes);
  assert.deepStrictEqual([seca.encerrar, seca.motivo], [true, 'duas rondas secas seguidas: aprovado']);
});

test('A3-17: o apurar devolve aprovado booleano, que so e true nas duas aprovacoes', () => {
  const M = { A: 'trabalho', B: 'HEAD' };
  const opcoes = { faixas: ['uma', 'uma'], mapas: [M, M], mudancas: [null, null] };
  const seca = v.apurar([vazios(['correcao']), vazios(['correcao'])], opcoes);
  assert.deepStrictEqual([seca.encerrar, seca.aprovado], [true, true]);
  const molhada = v.apurar([vazios(['correcao']), [veredito('correcao', [achado('P1', 'A.txt', 3)])]], opcoes);
  assert.deepStrictEqual([molhada.encerrar, molhada.aprovado], [false, false]);
  const r1 = v.apurar([vazios(['correcao'])], { faixas: ['uma'], mapas: [M], mudancas: [null] });
  assert.deepStrictEqual([r1.encerrar, r1.aprovado, r1.motivo], [true, true, 'ronda 1 completa sem achado nenhum: aprovado']);
  const p1 = [veredito('correcao', [achado('P1', 'A.txt', 3)])];
  const teto = v.apurar([p1, p1, p1], { faixas: ['uma', 'uma', 'uma'], mapas: [M, M, M], mudancas: [null, null, null] });
  assert.deepStrictEqual([teto.encerrar, teto.aprovado], [true, false]);
  assert.match(teto.motivo, /^teto de 3 rondas/);
});

test('F2b: o pendente que traz severidade P2 por engano nao pede tipo: so o confirmado pede', () => {
  const comSeveridade = Object.assign(pendente('A.txt', 3, 'o que a funcao devolve'), { severidade: 'P2' });
  const erros = v.errosDoVeredito(veredito('correcao', [comSeveridade]));
  assert.ok(erros.every((e) => !/"tipo"/.test(e)), JSON.stringify(erros));
});

// ---------------------------------------------------------------- H1 (s372): os achados antigos do veredito.js

test('L3-s104-3: a faixa da ronda 1 que nao e conhecida para com erro, e nao cai no minimo da completa', () => {
  const oito = ['correcao', 'escopo', 'estados', 'borda', 'seguranca', 'manutencao', 'microcopy', 'enxuto']
    .map((l) => veredito(l, []));
  for (const faixa of ['', 'xyz', 'Completa', ' uma']) {
    assert.throws(() => v.apurar([oito], { faixas: [faixa] }), (e) => e.codigo === v.FAIXA_DESCONHECIDA &&
      e.message.indexOf('faixa ' + JSON.stringify(faixa)) !== -1 && /uma, duas, texto, doc ou completa/.test(e.message) &&
      /Passo 1 do \/sworn:review/.test(e.message), 'faixa ' + JSON.stringify(faixa));
  }
  // controle: as conhecidas passam com as lentes delas
  assert.doesNotThrow(() => v.apurar([oito], { faixas: ['completa'] }));
  assert.doesNotThrow(() => v.apurar([[veredito('correcao', []), veredito('microcopy', [])]], { faixas: ['texto'] }));
});

test('L3-s104-4: o codigo do voto que falta e uma constante exportada, e o apurar-ronda.js usa a mesma', () => {
  assert.strictEqual(v.VOTO_QUE_FALTA, 'VOTO_QUE_FALTA');
  assert.throws(() => v.apurar([[veredito('correcao', [])]], { faixas: ['duas'] }),
    (e) => e.codigo === v.VOTO_QUE_FALTA);
  const cli = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'scripts', 'apurar-ronda.js'),
    'utf8');
  assert.ok(cli.indexOf('veredito.VOTO_QUE_FALTA') !== -1, 'o apurar-ronda.js le a constante do veredito.js');
  assert.ok(cli.indexOf("'VOTO_QUE_FALTA'") === -1, 'o apurar-ronda.js nao escreve o codigo por extenso');
});

test('L3-s104-12: a chave do achado e pelo lado com o mapa e pelo arquivo sem ele, nas duas contas', () => {
  const rondas = [[veredito('correcao', [achado('P1', 'A.txt', 10), achado('P1', 'A.txt', 12, 'outro')])]];
  const comMapa = v.apurar(rondas, { mapas: [{ A: 'trabalho', B: 'HEAD' }] });
  assert.deepStrictEqual(CHAVES(comMapa.paresCandidatos), [['P1|trabalho|10|correcao', 'P1|trabalho|12|correcao']]);
  const semMapa = v.apurar(rondas);
  assert.deepStrictEqual(CHAVES(semMapa.paresCandidatos), [['P1|A.txt|10|correcao', 'P1|A.txt|12|correcao']]);
});

test('L3-s105-4: muitas descricoes na mesma chave contam em tempo linear, com o mesmo ordinal de antes', () => {
  // do lado HEAD, para nao fazer par para o juiz: so a conta dos ordinais pesa
  const muitas = Array.from({ length: 40000 }, (_, i) => achado('P1', 'B.txt', 5, 'defeito ' + i));
  const inicio = Date.now();
  const r = v.apurar([[veredito('correcao', muitas)]], { mapas: [{ A: 'trabalho', B: 'HEAD' }] });
  const ms = Date.now() - inicio;
  assert.strictEqual(r.achadosDoLadoAntigo.length, 40000);
  assert.ok(ms < 3000, 'a conta de 40000 descricoes levou ' + ms + ' ms');
  // o ordinal: a descricao ja vista fica com o dela, a nova ganha o seguinte
  const M = { A: 'trabalho', B: 'HEAD' };
  const ronda = (descricoes) => [veredito('correcao', descricoes.map((d) => achado('P1', 'A.txt', 5, d)))];
  const r2 = v.apurar([ronda(['um', 'dois']), ronda(['dois', 'tres'])], { mapas: [M, M] });
  assert.deepStrictEqual(r2.novos.map((a) => a.descricao), ['tres']);
  // a nova da ronda 2 entra no historico: na 3, ela e repeticao, e a outra nova ganha o ordinal seguinte
  const r3 = v.apurar([ronda(['um', 'dois']), ronda(['dois', 'tres']), ronda(['tres', 'quatro'])], { mapas: [M, M, M] });
  assert.deepStrictEqual(r3.novos.map((a) => a.descricao), ['quatro']);
});

test('L3-s104-2: com referencia, a 2a passada tambem traz as lentes da faixa e as que acharam erro', () => {
  const ok = (l, achados) => comRef(l, 'empata', 'empata', achados);
  // ronda 1 da faixa duas: a 2a passada sem a borda
  assert.throws(() => apurarRef([rondaRef([ok('correcao'), ok('borda')], [ok('correcao')])], { faixas: ['duas'] }),
    (e) => e.codigo === v.VOTO_QUE_FALTA && /^ronda 1 \(com A e B trocados\) da faixa duas sem o voto da\(s\) lente\(s\) borda/
      .test(e.message) && /pasta invertida\/vereditos da ronda 1/.test(e.message));
  assert.doesNotThrow(() => apurarRef([rondaRef([ok('correcao'), ok('borda')], [ok('correcao'), ok('borda')])],
    { faixas: ['duas'] }));
  // ronda 2: a lente que achou erro na ronda 1 volta tambem na 2a passada
  const r1 = rondaRef([ok('correcao'), ok('borda', [achado('P1', 'A.txt', 3)])], [ok('correcao'), ok('borda')]);
  assert.throws(() => apurarRef([r1, rondaRef([ok('borda')], [ok('correcao')])], { faixas: ['duas'] }),
    (e) => e.codigo === v.VOTO_QUE_FALTA && /^ronda 2 \(com A e B trocados\) sem o voto/.test(e.message) &&
      /: borda\./.test(e.message) && /pasta invertida\/vereditos da ronda 2/.test(e.message));
  assert.doesNotThrow(() => apurarRef([r1, rondaRef([ok('borda')], [ok('borda')])], { faixas: ['duas'] }));
});

test('A3-09: a lacuna P0/P1 do trabalho sai com a refutacao que traz "lacuna": true, e so ela', () => {
  const limpa = rondaRef([comRef('correcao', 'empata', 'empata')], [comRef('correcao', 'empata', 'empata')]);
  const comLacuna = rondaRef([comRef('correcao', 'empata', 'empata', [], [lacuna('P1', 'A.txt', 3)])],
    [comRef('correcao', 'empata', 'empata', [], [lacuna('P0', 'B.txt', 8)])]);
  const daLacuna = (campos) => Object.assign({ ronda: 2, lente: 'correcao', arquivo: 'A.txt', linha: 3, severidade: 'P1',
    prova: 'R.txt:3 faz o mesmo que A.txt:3', lacuna: true }, campos || {});
  const ap = (refutados) => apurarRef([limpa, comLacuna], { refutados: refutados });
  const sem = ap([]);
  assert.deepStrictEqual([sem.referencia.pronta, sem.encerrar], [false, false]);
  // as duas refutadas (a da 2a passada com "passada": 2): pronta, e as lacunas saem da lista
  const ambas = ap([daLacuna(), daLacuna({ arquivo: 'B.txt', linha: 8, severidade: 'P0', passada: 2 })]);
  assert.deepStrictEqual([ambas.referencia.pronta, ambas.encerrar, ambas.referencia.lacunas], [true, true, []],
    JSON.stringify(ambas.referencia));
  assert.strictEqual(ambas.refutados.length, 2);
  // so uma refutada: a outra segura
  const uma = ap([daLacuna()]);
  assert.deepStrictEqual(uma.referencia.lacunas.map((l) => [l.severidade, l.passada, l.linha]), [['P0', 2, 8]]);
  assert.strictEqual(uma.referencia.pronta, false);
  // a refutacao sem "lacuna" (a de achado) nao tira a lacuna; outra ronda, lente, linha ou severidade tambem nao
  for (const campos of [{ lacuna: undefined }, { ronda: 1 }, { lente: 'borda' }, { linha: 4 }, { severidade: 'P0' },
    { arquivo: 'B.txt' }, { passada: 2 }]) {
    // a lacuna do B fica refutada certo; a de A.txt:3 so tem a refutacao torta, e segura
    const torta = ap([daLacuna({ arquivo: 'B.txt', linha: 8, severidade: 'P0', passada: 2 }), daLacuna(campos)]);
    assert.strictEqual(torta.referencia.pronta, false, JSON.stringify(campos));
  }
  // e a refutacao de lacuna nao tira o achado do mesmo lugar
  const comAchado = rondaRef([comRef('correcao', 'empata', 'empata', [achado('P1', 'A.txt', 3)])],
    [comRef('correcao', 'empata', 'empata')]);
  const r = apurarRef([comAchado], { refutados: [daLacuna({ ronda: 1 })] });
  assert.deepStrictEqual(r.novos.map((a) => a.linha), [3]);
  // "lacuna" que nao e true para, como a passada invalida
  for (const valor of [false, 'sim', 1]) {
    assert.throws(() => ap([daLacuna({ lacuna: valor })]),
      /refutacao com lacuna invalida .*"lacuna" e true para refutar uma lacuna/, String(valor));
  }
});

test('A3-06: o achado que segurou a ronda e volta igual na ultima sai em achadosAindaAbertos e barra a aprovacao', () => {
  const M = { A: 'trabalho', B: 'HEAD' };
  const p1 = veredito('correcao', [achado('P1', 'A.txt', 10)]);
  const seco = veredito('correcao', []);
  const r = v.apurar([[p1], [p1], [p1]], { mapas: [M, M, M] });
  assert.deepStrictEqual(r.achadosAindaAbertos, [Object.assign({ ronda: 3, lente: 'correcao' }, achado('P1', 'A.txt', 10))]);
  // duas secas (a repeticao nao molha, D475), mas nao aprova: no teto, o motivo do teto, e o que segue aberto
  assert.strictEqual(r.secas, 2);
  assert.match(r.motivo, /^teto de 3 rondas com 1 achado\(s\) aberto\(s\)/);
  // no teto, o proximo passo e o do teto (o conserto com teste, o resto no plano): as duas frases nao se contradizem
  assert.ok(r.motivo.endsWith('; 1 achado(s) ainda aberto(s), repetido(s) igual(is) na ultima ronda depois de segurar ' +
    'uma ronda (achadosAindaAbertos): entram no conserto acima como os outros abertos'), r.motivo);
  assert.doesNotMatch(r.motivo, /aprovado|refutados\.json/);
  // a lente que repetiu o achado aberto tem de voltar na ronda seguinte
  const borda = veredito('borda', []);
  assert.throws(() => v.apurar([[p1, borda], [p1], [borda]], { mapas: [M, M, M], faixas: ['duas'] }),
    (e) => e.codigo === v.VOTO_QUE_FALTA && /^ronda 3 sem o voto/.test(e.message) && /: correcao\./.test(e.message));
  assert.doesNotThrow(() => v.apurar([[p1, borda], [p1], [seco]], { mapas: [M, M, M], faixas: ['duas'] }));
  // o consertado (nao voltou) nao fica; sem nenhum, a lista sai vazia e o motivo e o de sempre
  const consertado = v.apurar([[p1], [seco], [seco]], { mapas: [M, M, M] });
  assert.deepStrictEqual([consertado.achadosAindaAbertos, consertado.motivo], [[], 'duas rondas secas seguidas: aprovado']);
  // so a ultima ronda conta: o que voltou na 2 e sumiu na 3 nao fica
  assert.deepStrictEqual(v.apurar([[p1], [p1], [seco]], { mapas: [M, M, M] }).achadosAindaAbertos, []);
  // o do lado antigo, a melhoria e o refutado na ronda em que nasceu nao seguravam: nao ficam
  const antigo = veredito('correcao', [achado('P1', 'B.txt', 10)]);
  assert.deepStrictEqual(v.apurar([[antigo], [antigo]], { mapas: [M, M] }).achadosAindaAbertos, []);
  const melhoria = veredito('correcao', [achadoMelhoria(7)]);
  assert.deepStrictEqual(v.apurar([[melhoria], [melhoria]], { mapas: [M, M] }).achadosAindaAbertos, []);
  const refuta = (ronda) => ({ ronda: ronda, lente: 'correcao', arquivo: 'A.txt', linha: 10, severidade: 'P1', prova: 'a.js:1' });
  assert.deepStrictEqual(v.apurar([[p1], [p1]], { mapas: [M, M], refutados: [refuta(1)] }).achadosAindaAbertos, []);
  // o refutado na ultima ronda tambem sai da lista
  assert.deepStrictEqual(v.apurar([[p1], [p1]], { mapas: [M, M], refutados: [refuta(2)] }).achadosAindaAbertos, []);
  // o novo da ultima ronda e novo, nao "ainda aberto", mesmo duas vezes no mesmo veredito
  const doisNovos = v.apurar([[seco], [veredito('correcao', [achado('P1', 'A.txt', 10), achado('P1', 'A.txt', 10)])]],
    { mapas: [M, M] });
  assert.deepStrictEqual([doisNovos.novos.length, doisNovos.achadosAindaAbertos], [1, []]);
  // antes do teto a lista sai tambem: a ronda seguinte chama a lente que repetiu, e o passo e consertar ou refutar
  const aberta = v.apurar([[p1], [p1]], { mapas: [M, M] });
  assert.deepStrictEqual([aberta.encerrar, aberta.secas, aberta.achadosAindaAbertos.length], [false, 1, 1]);
  assert.strictEqual(aberta.motivo, 'ronda 3 chama so as lentes que acharam P0, P1 ou P2 de erro e as que repetiram ' +
    'um achado ainda aberto; 1 achado(s) ainda aberto(s), repetido(s) igual(is) na ultima ronda depois de segurar uma ' +
    'ronda (achadosAindaAbertos): conserte cada um antes da ronda seguinte, ou refute-o em refutados.json');
});

test('A3-16: na ronda 1, com o diff do HEAD, o achado do lado novo longe da mudanca e registro "fora da mudanca"', () => {
  const M = { A: 'trabalho', B: 'HEAD' };
  const diff = [blocoDe(10, 1, 10, 1)];
  const apura = (linha, extra, lente, arquivo) => v.apurar([[veredito(lente || 'borda',
    [achado('P1', arquivo || 'A.txt', linha)])]], Object.assign({ mapas: [M], diffDoHead: diff }, extra || {}));
  const comoFica = (r) => r.novos.length ? 'segura' : r.registros.length ? r.registros[0].registro
    : r.achadosDoLadoAntigo.length ? 'antigo' : 'sumiu';
  assert.deepStrictEqual([7, 8, 10, 12, 13, 30].map((l) => comoFica(apura(l))),
    ['fora da mudanca', 'segura', 'segura', 'segura', 'fora da mudanca', 'fora da mudanca']);
  const r = apura(30);
  assert.deepStrictEqual(r.registros, [Object.assign({ ronda: 1, lente: 'borda' }, achado('P1', 'A.txt', 30),
    { registro: 'fora da mudanca' })]);
  assert.deepStrictEqual([r.secas, r.paresCandidatos], [1, []]);
  // o rotulo do lado HEAD segue no lado antigo; a lente do pedido (o que falta pode estar onde nada mudou) e a de
  // correcao (a regressao em quem chama o que mudou) seguram
  assert.strictEqual(comoFica(apura(30, {}, 'borda', 'B.txt')), 'antigo');
  assert.strictEqual(comoFica(apura(30, {}, 'correcao')), 'segura');
  assert.strictEqual(comoFica(apura(30, {}, 'Correcao e regressao')), 'segura');
  assert.strictEqual(comoFica(apura(30, {}, 'escopo')), 'segura');
  // sem medida (sem o diff, diff vazio ou que nao e lista, arquivo igual ao HEAD, sem mapa): segura, como antes
  for (const extra of [{ diffDoHead: undefined }, { diffDoHead: [] }, { diffDoHead: 'x' },
    { mapas: [{ A: 'trabalho', B: 'trabalho' }] }, { mapas: [null] }]) {
    assert.strictEqual(comoFica(apura(30, extra)), 'segura', JSON.stringify(extra));
  }
  // o diff do HEAD e so da ronda 1: na ronda 2 sem a medida do conserto, o achado longe segura
  const naRonda2 = v.apurar([[veredito('borda', [])], [veredito('borda', [achado('P1', 'A.txt', 30)])]],
    { mapas: [M, M], diffDoHead: diff });
  assert.deepStrictEqual([naRonda2.novos.length, naRonda2.registros.length], [1, 0]);
  // a melhoria longe da mudanca segue melhoria
  const m = v.apurar([[veredito('correcao', [achadoMelhoria(30)])]], { mapas: [M], diffDoHead: diff });
  assert.deepStrictEqual(m.registros.map((a) => a.registro), ['melhoria']);
  // repetido na ronda 2, e o mesmo registro (nao vira verificacao) e a linha dele nao passa a citada
  const duas = v.apurar([[p1DaBorda(30)], [p1DaBorda(30), veredito('correcao', [achado('P1', 'A.txt', 31)])]],
    { mapas: [M, M], diffDoHead: diff, mudancas: [null, []] });
  assert.deepStrictEqual(duas.novos, []);
  assert.deepStrictEqual(duas.registros.map((a) => [a.ronda, a.linha, a.registro]),
    [[1, 30, 'fora da mudanca'], [2, 31, 'linha nova']]);
  assert.deepStrictEqual(duas.achadosAindaAbertos, []);
});

// L3-s105-6: cada id da conferencia e respondido uma vez, pela lente dona dele
test('L3-s105-6: apurarConferencia recusa o id respondido duas vezes e o respondido por outra lente', () => {
  const abertos = [{ id: 1, lente: 'correcao' }, { id: 2, lente: 'borda' }];
  const ok = v.apurarConferencia(abertos, [
    { lente: 'correcao', conferencia: [{ id: 1, corrigido: true }] },
    { lente: 'borda', conferencia: [{ id: 2, corrigido: true }] }
  ]);
  assert.deepStrictEqual(ok, { aprovado: true, corrigidos: 2, seguem: [] });
  assert.throws(() => v.apurarConferencia(abertos, [
    { lente: 'correcao', conferencia: [{ id: 1, corrigido: true }, { id: 1, corrigido: false, linha: 1, trecho: 'x' }] },
    { lente: 'borda', conferencia: [{ id: 2, corrigido: true }] }
  ]), (e) => e.codigo === v.CONFERENCIA_INCOMPLETA && /o id 1 foi respondido duas vezes/.test(e.message));
  assert.throws(() => v.apurarConferencia(abertos, [
    { lente: 'correcao', conferencia: [{ id: 1, corrigido: true }, { id: 2, corrigido: true }] }
  ]), (e) => e.codigo === v.CONFERENCIA_INCOMPLETA && /o id 2 e da lente borda, e quem respondeu foi correcao/.test(e.message));
});

// L3-s105-6, ronda 1 da revisao: a entrada torta da conferencia e erro com codigo, nunca aprovacao nem TypeError
test('L3-s105-6: apurarConferencia recusa lista vazia, item torto, id repetido e veredito sem lente', () => {
  const incompleta = (re) => (e) => e.codigo === v.CONFERENCIA_INCOMPLETA && re.test(e.message);
  const resposta = [{ lente: 'correcao', conferencia: [{ id: 1, corrigido: true }] }];
  assert.throws(() => v.apurarConferencia(undefined, []), incompleta(/nao traz nenhum achado a conferir/));
  assert.throws(() => v.apurarConferencia([], []), incompleta(/nao traz nenhum achado a conferir/));
  assert.throws(() => v.apurarConferencia([null], resposta), incompleta(/o achado 1 da conferencia nao tem "id" ou "lente"/));
  assert.throws(() => v.apurarConferencia([{ lente: 'correcao' }], [{ lente: 'correcao', conferencia: [{ corrigido: true }] }]),
    incompleta(/nao tem "id" ou "lente"/));
  assert.throws(() => v.apurarConferencia([{ id: 1, lente: 'correcao' }, { id: 1, lente: 'correcao' }], resposta),
    incompleta(/o id 1 aparece duas vezes na conferencia/));
  assert.throws(() => v.apurarConferencia([{ id: 1, lente: 'correcao' }], [{ conferencia: [{ id: 1, corrigido: true }] }]),
    incompleta(/o veredito 1 da conferencia nao tem "lente".*Chame de novo a lente/));
  assert.throws(() => v.apurarConferencia([{ id: 1, lente: 'correcao' }], [{ lente: 'correcao', conferencia: {} }]),
    incompleta(/o veredito 1 da conferencia nao tem a lista "conferencia"/));
  // a lente do mapa se compara pela forma canonica, e a linha em texto vale
  const segue = v.apurarConferencia([{ id: 1, lente: 'Correcao' }],
    [{ lente: 'correcao', conferencia: [{ id: 1, corrigido: false, linha: '42', trecho: 'x' }] }]);
  assert.strictEqual(segue.aprovado, false);
  assert.strictEqual(segue.seguem[0].linhaAgora, 42);
  // a faixa "40-45" vale como no resto do modulo (a menor das pontas); linha 0 e texto torto seguem recusados
  const faixa = v.apurarConferencia([{ id: 1, lente: 'correcao' }],
    [{ lente: 'correcao', conferencia: [{ id: 1, corrigido: false, linha: '40-45', trecho: 'x' }] }]);
  assert.strictEqual(faixa.seguem[0].linhaAgora, 40);
  for (const linha of [0, '0', 'quarenta', 4.5, null]) {
    assert.throws(() => v.apurarConferencia([{ id: 1, lente: 'correcao' }],
      [{ lente: 'correcao', conferencia: [{ id: 1, corrigido: false, linha, trecho: 'x' }] }]),
      incompleta(/precisa da "linha" e do "trecho"/), JSON.stringify(linha));
  }
});
