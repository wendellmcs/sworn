'use strict';
const test = require('node:test');
const assert = require('node:assert');
const degraus = require('../scripts/lib/degraus.js');

test('degraus: aceita as tres formas e devolve sempre a canonica', () => {
  const r = degraus.normalizar([
    { agente: 'busca', apelido: 'barato' },
    { nome: 'arquiteto', model: 'caro' },
    'sem-apelido'
  ]);
  assert.deepStrictEqual(r, [
    { agente: 'busca', apelido: 'barato' },
    { agente: 'arquiteto', apelido: 'caro' },
    { agente: 'sem-apelido', apelido: '' }
  ]);
});

test('degraus: a ORDEM e o dado, e ela se preserva', () => {
  const r = degraus.paraProjeto([
    { agente: 'c', apelido: 'x' }, { agente: 'a', apelido: 'y' }, { agente: 'b', apelido: 'z' }
  ]);
  assert.deepStrictEqual(r.escada, ['c', 'a', 'b']);
  assert.deepStrictEqual(r.degraus.map((d) => d.agente), ['c', 'a', 'b']);
});

test('degraus: escada vazia e resposta legitima, nao erro', () => {
  assert.strictEqual(degraus.validar([]).ok, true);
});

test('degraus: um degrau sozinho nao e escada', () => {
  const r = degraus.validar([{ agente: 'unico', apelido: 'x' }]);
  assert.strictEqual(r.ok, false);
  assert.ok(r.erros.some((e) => e.includes('nao opina')), r.erros.join(' | '));
});

test('degraus: degrau sem apelido e erro nomeado', () => {
  const r = degraus.validar([{ agente: 'a', apelido: '' }, { agente: 'b', apelido: 'y' }]);
  assert.strictEqual(r.ok, false);
  assert.ok(r.erros.some((e) => e.includes('sem apelido')), r.erros.join(' | '));
});

// Decisao 12: apelido e METODO, id de modelo e RESULTADO - e resultado apodrece.
test('degraus: id de modelo no lugar do apelido e recusado', () => {
  const r = degraus.validar([{ agente: 'a', apelido: 'claude-opus-5' }, { agente: 'b', apelido: 'y' }]);
  assert.strictEqual(r.ok, false);
  assert.ok(r.erros.some((e) => e.includes('id de modelo')), r.erros.join(' | '));
});

test('degraus: agente repetido e erro - indexOf so acharia o primeiro', () => {
  const r = degraus.validar([{ agente: 'a', apelido: 'x' }, { agente: 'a', apelido: 'y' }]);
  assert.strictEqual(r.ok, false);
  assert.ok(r.erros.some((e) => e.includes('repetido')), r.erros.join(' | '));
});

test('degraus: escada de dois degraus limpos passa', () => {
  const r = degraus.validar([{ agente: 'busca', apelido: 'barato' }, { agente: 'arquiteto', apelido: 'caro' }]);
  assert.strictEqual(r.ok, true, r.erros.join(' | '));
});

test('degraus: escada e degraus casados nao acusam nada', () => {
  const a = degraus.paraProjeto([{ agente: 'a', apelido: 'x' }, { agente: 'b', apelido: 'y' }]);
  assert.deepStrictEqual(degraus.desalinhados(a), []);
});

test('degraus: configuracao anterior - escada sem degraus - continua valida', () => {
  assert.deepStrictEqual(degraus.desalinhados({ escada: ['a', 'b'] }), []);
});

test('degraus: degraus sem escada deixa o portao de custo mudo, e isso se acusa', () => {
  const r = degraus.desalinhados({ degraus: [{ agente: 'a', apelido: 'x' }] });
  assert.strictEqual(r.length, 1);
  assert.ok(r[0].includes('mudo'), r[0]);
});

test('degraus: a MESMA ordem, nao so os mesmos nomes', () => {
  const r = degraus.desalinhados({
    escada: ['a', 'b'],
    degraus: [{ agente: 'b', apelido: 'y' }, { agente: 'a', apelido: 'x' }]
  });
  assert.strictEqual(r.length, 2, JSON.stringify(r));
  assert.ok(r[0].includes('posicao 1'), r[0]);
});

test('degraus: tamanhos diferentes viram problema nomeado', () => {
  const r = degraus.desalinhados({ escada: ['a', 'b', 'c'], degraus: [{ agente: 'a', apelido: 'x' }] });
  assert.ok(r.some((p) => p.includes('3 nome(s)')), JSON.stringify(r));
});

test('degraus: o motivo cita cada problema e diz o conserto', () => {
  const m = degraus.motivoDesalinhado(['posicao 1: a escada diz "a"']);
  assert.ok(m.includes('posicao 1'));
  assert.ok(m.includes('entrevista'));
});

// ------------------------------------------- D678 T1: o esforco de cada degrau

test('D678 T1: o degrau guarda o esforco, nas duas grafias (esforco e effort do frontmatter)', () => {
  const r = degraus.normalizar([
    { agente: 'busca', apelido: 'haiku', esforco: 'low' },
    { nome: 'arquiteto', model: 'opus', effort: 'high' }
  ]);
  assert.deepStrictEqual(r, [
    { agente: 'busca', apelido: 'haiku', esforco: 'low' },
    { agente: 'arquiteto', apelido: 'opus', esforco: 'high' }
  ]);
});

// R1 da revisao (correcao, borda, manutencao): esforco vazio ou nulo nao pode esconder um effort que veio.
test('D678 T1: esforco vazio ou nulo nao apaga o effort da outra grafia', () => {
  const r = degraus.normalizar([
    { agente: 'a', apelido: 'x', esforco: '', effort: 'high' },
    { agente: 'b', apelido: 'y', esforco: null, effort: 'low' },
    { agente: 'c', apelido: 'z', esforco: '  ', effort: 'max' }
  ]);
  assert.deepStrictEqual(r.map((d) => d.esforco), ['high', 'low', 'max']);
});

test('D678 T1: degrau sem esforco segue na forma de antes (configuracao anterior continua igual)', () => {
  const r = degraus.paraProjeto([{ agente: 'a', apelido: 'x' }, { agente: 'b', apelido: 'y', esforco: '' }]);
  assert.deepStrictEqual(r.degraus, [{ agente: 'a', apelido: 'x' }, { agente: 'b', apelido: 'y' }]);
});

test('D678 T1: esforco fora de low|medium|high|xhigh|max e erro nomeado, com o aceito', () => {
  const r = degraus.validar([{ agente: 'a', apelido: 'x', esforco: 'altissimo' }, { agente: 'b', apelido: 'y' }]);
  assert.strictEqual(r.ok, false);
  assert.ok(r.erros.some((e) => e.includes('"a"') && e.includes('altissimo') && e.includes('low|medium|high|xhigh|max')),
    r.erros.join(' | '));
});

test('D678 T1: esforco de tipo errado e erro, nao vira texto', () => {
  const r = degraus.validar([{ agente: 'a', apelido: 'x', esforco: 3 }, { agente: 'b', apelido: 'y' }]);
  assert.strictEqual(r.ok, false, 'numero no esforco passou');
  assert.ok(r.erros.some((e) => e.includes('esforco')), r.erros.join(' | '));
});

test('D678 T1: tabela com esforco valido em todos os degraus passa', () => {
  const r = degraus.validar([
    { agente: 'busca', apelido: 'haiku', esforco: 'low' }, { agente: 'arquiteto', apelido: 'opus', esforco: 'xhigh' }
  ]);
  assert.strictEqual(r.ok, true, r.erros.join(' | '));
});

// A tabela e perene so com apelido: o id de versao (o que o apelido resolve hoje) apodrece na troca de geracao.
test('D678 T1: id de versao de qualquer geracao no lugar do apelido e recusado', () => {
  for (const id of ['claude-sonnet-5-5', 'claude-haiku-4-5-20251001', 'claude-opus-5-5[1m]', 'claude-fable-5-1']) {
    const r = degraus.validar([{ agente: 'a', apelido: id, esforco: 'low' }, { agente: 'b', apelido: 'opus' }]);
    assert.strictEqual(r.ok, false, id + ' passou como apelido');
    assert.ok(r.erros.some((e) => e.includes('id de modelo')), id + ': ' + r.erros.join(' | '));
  }
});

// A2 (s193): o valor cru do projeto.json entrava na mensagem por concatenacao (validar :73, desalinhados :109-110):
// {"toString": 1} lancava (o validar.js so dizia "estourou", o gerar-agentes.js caia) e o objeto virava
// "[object Object]"; o degrau 0 aparecia como o nome "0". O molde e o custo.js:95: texto entre aspas, o resto em JSON.
test('A2 (s193): valor que nao e texto no esforco, na escada ou no degrau sai em JSON e nao lanca', () => {
  const torto = { toString: 1 };
  const v = degraus.validar([{ agente: 'a', apelido: 'x', esforco: torto }, { agente: 'b', apelido: 'y', esforco: {} }]);
  assert.ok(v.erros.some((e) => e.includes('esforco {"toString":1} invalido')), v.erros.join(' | '));
  assert.ok(v.erros.some((e) => e.includes('esforco {} invalido')), v.erros.join(' | '));
  assert.ok(degraus.validar([{ agente: 'a', apelido: 'x', esforco: 'max ' }, { agente: 'b', apelido: 'y', esforco: 'x' }])
    .erros.some((e) => e.includes('esforco "x" invalido')), 'o texto continua entre aspas');
  const p = degraus.desalinhados({ escada: [torto, 'b', 'c', 'd'], degraus: [{ agente: 'a' }, 0, {}, { agente: torto }] });
  assert.deepStrictEqual(p, ['posicao 1: a escada diz {"toString":1} e os degraus dizem "a"',
    'posicao 2: a escada diz "b" e os degraus dizem 0', 'posicao 3: a escada diz "c" e os degraus dizem nada',
    'posicao 4: a escada diz "d" e os degraus dizem {"toString":1}']);
});

// A2 (s193, microcopy): o erro que o dono le pelo validar.js usava jargao ("gatilho 3") e nao dizia o que fazer.
test('A2 (s193): cada erro do validar diz o que fazer a seguir', () => {
  const um = degraus.validar([{ agente: 'unico', apelido: 'x' }]).erros.join(' | ');
  assert.ok(/acrescente/.test(um) && /deixe a escada vazia/.test(um), um);
  const sem = degraus.validar([{ agente: 'a', apelido: '' }, { agente: 'b', apelido: 'y' }]).erros.join(' | ');
  assert.ok(!/gatilho/.test(sem) && /diga o modelo dele pelo apelido/.test(sem), sem);
  const id = degraus.validar([{ agente: 'a', apelido: 'claude-opus-5' }, { agente: 'b', apelido: 'y' }]).erros.join(' | ');
  assert.ok(/use o apelido/.test(id), id);
  const rep = degraus.validar([{ agente: 'a', apelido: 'x' }, { agente: 'a', apelido: 'y' }]).erros.join(' | ');
  assert.ok(/tire a repeticao/.test(rep), rep);
});

// A2-71 (pedido 12): o esforco que nao e texto segue cru mesmo com a outra grafia preenchida, para o validar acusar.
test('A2-71: esforco que nao e texto vence a outra grafia e chega cru ao validar', () => {
  const r = degraus.normalizar([{ agente: 'a', apelido: 'x', esforco: 0, effort: 'high' },
    { agente: 'b', apelido: 'y', esforco: false, effort: 'low' }, { agente: 'c', apelido: 'z', effort: ' max ' }]);
  assert.deepStrictEqual(r.map((d) => d.esforco), [0, false, 'max']);
});

// A2-72/73 (pedido 12): o nome invalido e a escada ausente diziam o problema e nao o conserto.
test('A2-72/73: nome invalido e escada ausente dizem o conserto', () => {
  const nome = degraus.validar([{ agente: 'Arquiteto', apelido: 'x' }, { agente: 'b', apelido: 'y' }]).erros.join(' | ');
  assert.match(nome, /renomeie com ate 40 caracteres, comecando por letra minuscula/, nome);
  assert.ok(degraus.NOME.test('a'.repeat(40)) && !degraus.NOME.test('a'.repeat(41)), 'o 40 da mensagem e o do NOME');
  const sem = degraus.desalinhados({ degraus: [{ agente: 'a' }, { agente: 'b' }] }).join(' | ');
  assert.match(sem, /grave "escada" em "agentes" com os nomes dos degraus, na mesma ordem/, sem);
});
