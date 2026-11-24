'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const comum = require('./lib/comum.js');
const herdados = require('../scripts/lib/herdados.js');
const veredito = require('../scripts/lib/veredito.js');

// H6e3 (D900): o P2 descartado com motivo numa revisao vale na seguinte do mesmo conteudo
const SEIS = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'];
const DE_PE = { lente: 'correcao', severidade: 'P2', janela: 'l1\nl2\nl3\nl4\nl5', prova: 'nao se conserta aqui',
  foraDoPedido: 'fora do pedido', origem: '.claude/sworn/revisao-fechada/x/1, ronda 1' };

test('H6e3: a janela e a linha com 2 vizinhas de cada lado, cortada nas pontas; linha branca ou fora nao ancora', () => {
  assert.strictEqual(herdados.janela(SEIS, 3), 'l1\nl2\nl3\nl4\nl5');
  assert.strictEqual(herdados.janela(SEIS, 1), 'l1\nl2\nl3');
  assert.strictEqual(herdados.janela(SEIS, 6), 'l4\nl5\nl6');
  assert.strictEqual(herdados.janela(['a', '  ', 'b'], 2), null);
  for (const linha of [0, 7, 2.5, '3']) assert.strictEqual(herdados.janela(SEIS, linha), null, String(linha));
  assert.strictEqual(herdados.janela(null, 1), null);
  // o '' depois do "\n" final nao e linha: nao entra na janela e nao ancora
  assert.strictEqual(herdados.janela(SEIS.concat(''), 6), 'l4\nl5\nl6');
  assert.strictEqual(herdados.janela(SEIS.concat(''), 5), 'l3\nl4\nl5\nl6');
  assert.strictEqual(herdados.janela(SEIS.concat(''), 7), null);
  const doFim = Object.assign({}, DE_PE, { janela: herdados.janela(SEIS.concat(''), 6) });
  assert.deepStrictEqual(herdados.podar([doFim], SEIS.join('\n')), [doFim], 'o arquivo sem o "\\n" final');
  assert.deepStrictEqual(herdados.podar([doFim], SEIS.join('\n') + '\n'), [doFim], 'o arquivo com o "\\n" final');
});

test('H6e3: a forma do herdado: P2, lente conhecida que nao e a do pedido, janela, prova e origem com texto', () => {
  assert.strictEqual(herdados.valido(DE_PE), true);
  const torto = (extra) => Object.assign({}, DE_PE, extra);
  for (const e of [torto({ severidade: 'P1' }), torto({ lente: 'escopo' }), torto({ lente: 'nenhuma' }),
    torto({ janela: ' ' }), torto({ prova: '' }), torto({ origem: undefined }), torto({ simbolo: 3 }), null, [], 'x']) {
    assert.strictEqual(herdados.valido(e), false, JSON.stringify(e));
  }
  assert.deepStrictEqual(herdados.conferir([DE_PE]), [DE_PE]);
  assert.throws(() => herdados.conferir([DE_PE, torto({ severidade: 'P0' })]), /posicao 2/);
  assert.throws(() => herdados.conferir({}), /nao e uma lista/);
  // o opcional vazio tambem e forma errada, e a mensagem diz isso
  assert.throws(() => herdados.conferir([torto({ simbolo: ' ' })]), /simbolo e foraDoPedido, quando vem, tambem sao texto/);
});

test('H6e3: achar casa a mesma lente (pela chave) e a mesma janela; podar guarda so a janela que segue no arquivo', () => {
  assert.strictEqual(herdados.achar([DE_PE], 'Correção e regressão', 'l1\nl2\nl3\nl4\nl5'), DE_PE);
  assert.strictEqual(herdados.achar([DE_PE], 'borda', 'l1\nl2\nl3\nl4\nl5'), null);
  assert.strictEqual(herdados.achar([DE_PE], 'correcao', 'l1\nl2\nl3\nl4\nl6'), null);
  assert.strictEqual(herdados.achar([DE_PE], 'correcao', null), null);
  assert.deepStrictEqual(herdados.podar([DE_PE], 'l0\nl1\nl2\nl3\nl4\nl5\n'), [DE_PE]);
  // a janela tem de casar linha inteira: "xl1" nao e "l1"
  assert.deepStrictEqual(herdados.podar([DE_PE], 'xl1\nl2\nl3\nl4\nl5\n'), []);
  assert.deepStrictEqual(herdados.podar([DE_PE], 'l1\nl2\nMUDOU\nl4\nl5\n'), []);
});

test('H6e3: da revisao arquivada herda o P2 refutado do lado do trabalho, e os herdados dela; o resto fica', () => {
  const pasta = comum.temporaria('sworn-herdados-');
  try {
    const ronda = (n, mapa, invertida) => {
      fs.mkdirSync(path.join(pasta, String(n), 'invertida'), { recursive: true });
      fs.writeFileSync(path.join(pasta, String(n), 'mapa.json'), JSON.stringify({ mapa: mapa, invertida: invertida }));
      fs.writeFileSync(path.join(pasta, String(n), 'A.txt'), SEIS.join('\r\n') + '\r\n');
      fs.writeFileSync(path.join(pasta, String(n), 'B.txt'), 'antigo\n');
      fs.writeFileSync(path.join(pasta, String(n), 'invertida', 'B.txt'), SEIS.join('\n') + '\n');
    };
    ronda(1, { A: 'trabalho', B: 'HEAD' }, { A: 'HEAD', B: 'trabalho' });
    ronda(2, { A: 'HEAD', B: 'trabalho' });
    const r = (extra) => Object.assign({ ronda: 1, lente: 'correcao', arquivo: 'A.txt', linha: 3, severidade: 'P2',
      prova: 'fica assim', foraDoPedido: 'fora do pedido' }, extra);
    const anterior = Object.assign({}, DE_PE, { lente: 'borda', janela: 'outra\njanela' });
    fs.writeFileSync(path.join(pasta, '1', herdados.ARQUIVO), JSON.stringify([anterior, { lente: 'escopo' }]));
    fs.writeFileSync(path.join(pasta, 'refutados.json'), JSON.stringify([
      r({ comando: 'node x.js' }),
      r({ lente: 'Correção e regressão' }), // a mesma lente e janela: duplicata
      r({ lente: 'estados', arquivo: 'B.txt', linha: 4, passada: 2, foraDoPedido: undefined, simbolo: 'l4' }),
      r({ severidade: 'P1' }), r({ lente: 'escopo' }), r({ lacuna: true, lente: 'borda' }), r({ lente: 'nenhuma' }),
      r({ lente: 'borda', arquivo: 'B.txt' }), // lado HEAD
      r({ lente: 'borda', ronda: 2 }), // A.txt da ronda 2 e o HEAD
      r({ lente: 'borda', ronda: 3 }), // ronda que nao existe
      r({ lente: 'borda', linha: 40 }), r({ lente: 'borda', prova: ' ' }), null, 'x']));
    const lista = herdados.daRevisaoArquivada(pasta, 'fechada/x');
    assert.deepStrictEqual(lista, [anterior,
      { lente: 'correcao', severidade: 'P2', janela: 'l1\nl2\nl3\nl4\nl5', prova: 'fica assim', origem: 'fechada/x, ronda 1',
        comando: 'node x.js', foraDoPedido: 'fora do pedido' },
      { lente: 'estados', severidade: 'P2', janela: 'l2\nl3\nl4\nl5\nl6', prova: 'fica assim', origem: 'fechada/x, ronda 1',
        simbolo: 'l4' }]);
    lista.forEach(function (e) { assert.strictEqual(herdados.valido(e), true, JSON.stringify(e)); });
    // o refutados.json torto nao para: a revisao fechada nao herda nada dele
    fs.writeFileSync(path.join(pasta, 'refutados.json'), '{ torto');
    assert.deepStrictEqual(herdados.daRevisaoArquivada(pasta, 'fechada/x'), [anterior]);
    // a duplicata se ve pela chave da lente: o herdado gravado com o titulo e o refutado com a chave sao um so
    const peloTitulo = Object.assign({}, DE_PE, { lente: 'Correção e regressão' });
    fs.writeFileSync(path.join(pasta, '1', herdados.ARQUIVO), JSON.stringify([peloTitulo]));
    fs.writeFileSync(path.join(pasta, 'refutados.json'), JSON.stringify([r()]));
    assert.deepStrictEqual(herdados.daRevisaoArquivada(pasta, 'fechada/x'), [peloTitulo]);
  } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('H6e3: no veredito.apurar, o P2 de erro herdado vai a registros como "descartado antes" e nao molha; P0/P1, melhoria, lado HEAD e refutado nao perguntam', () => {
  const achado = (extra) => Object.assign({ estado: 'confirmado', severidade: 'P2', tipo: 'erro', arquivo: 'A.txt', linha: 3,
    trecho: 'l3', descricao: 'defeito' }, extra);
  const vd = (lente, achados) => ({ lente: lente, melhor: 'A', achados: achados });
  const perguntas = [];
  const herdado = function (indice, rotulo, linha, passada, lente) {
    perguntas.push([indice, rotulo, linha, passada, lente]);
    return lente === 'correcao' ? { prova: 'fica assim', origem: 'fechada/x, ronda 1', outro: 'nao sai' } : null;
  };
  const mapas = [{ A: 'trabalho', B: 'HEAD' }];
  const r = veredito.apurar([[vd('correcao', [achado()])]], { mapas: mapas, herdado: herdado });
  assert.deepStrictEqual(perguntas, [[0, 'A', 3, 1, 'correcao']]);
  // a linha em texto chega como inteiro: o veredito a normaliza antes de perguntar
  perguntas.length = 0;
  veredito.apurar([[vd('correcao', [achado({ linha: '3' }), achado({ linha: '5-4', trecho: 'l4' })])]],
    { mapas: mapas, herdado: herdado });
  assert.deepStrictEqual(perguntas, [[0, 'A', 3, 1, 'correcao'], [0, 'A', 4, 1, 'correcao']]);
  assert.deepStrictEqual(r.novos, []);
  assert.strictEqual(r.secas, 1);
  assert.deepStrictEqual(r.registros.map(function (x) { return [x.registro, x.descartadoAntes]; }),
    [['descartado antes', { prova: 'fica assim', origem: 'fechada/x, ronda 1' }]]);
  // outra lente: a funcao responde null, e o P2 de erro segura como antes
  assert.strictEqual(veredito.apurar([[vd('borda', [achado()])]], { mapas: mapas, herdado: herdado }).novos.length, 1);
  // sem a funcao, segura como antes
  assert.strictEqual(veredito.apurar([[vd('correcao', [achado()])]], { mapas: mapas }).novos.length, 1);
  perguntas.length = 0;
  const graves = veredito.apurar([[vd('correcao', [achado({ severidade: 'P1', tipo: undefined }),
    achado({ severidade: 'P0', tipo: undefined, linha: 4 }), achado({ tipo: 'melhoria', linha: 5 }),
    achado({ arquivo: 'B.txt', linha: 6 })])]], { mapas: mapas, herdado: herdado });
  assert.deepStrictEqual(perguntas, [], 'P0, P1, melhoria e o lado HEAD nao perguntam');
  // ronda sem mapa: nao se sabe qual lado e o trabalho, e o P2 de erro segura
  assert.strictEqual(veredito.apurar([[vd('correcao', [achado()])]], { mapas: [], herdado: herdado }).novos.length, 1);
  assert.deepStrictEqual(perguntas, [], 'sem o mapa da ronda nao pergunta');
  assert.strictEqual(graves.novos.length, 2, 'o P0 e o P1 seguram');
  assert.deepStrictEqual(graves.registros.map(function (x) { return x.registro; }), ['melhoria']);
  const refutados = [{ ronda: 1, lente: 'correcao', arquivo: 'A.txt', linha: 3, severidade: 'P2', prova: 'x',
    foraDoPedido: 'fora' }];
  const ref = veredito.apurar([[vd('correcao', [achado()])]], { mapas: mapas, herdado: herdado, refutados: refutados });
  assert.deepStrictEqual(perguntas, [], 'o refutado nesta revisao nao pergunta');
  assert.deepStrictEqual(ref.registros, []);
});
