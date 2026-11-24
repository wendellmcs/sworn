'use strict';
// H6e3 (15.0, D900): o descarte com motivo vale na revisao seguinte do mesmo conteudo (docs/revisao-automatica.md,
// secao 5.6). O P2 que o autor refutou no refutados.json (com a prova, o comando ou o "foraDoPedido") ja disse por que
// nao se conserta; quando a revisao fecha e o arquivo volta a revisao, a lente que achar o mesmo P2 sobre as mesmas
// linhas nao segura a ronda de novo: o achado vai ao registro como 'descartado antes', com o motivo e de onde veio.
// So o P2: o P0/P1 volta ao refutador a cada revisao (RA7). Fora a lente do pedido: o pedido e outro a cada tarefa.
// O "mesmo conteudo" e a janela da linha citada: ela e mais VIZINHAS linhas acima e VIZINHAS abaixo, do lado do
// trabalho. A janela e conservadora: a que muda de tamanho (cortada na ponta do arquivo e depois longe dela) ou que
// pega a marca de lacuna de um trecho nao se acha mais, e o P2 volta a segurar a ronda, como sem a heranca.
const fs = require('node:fs');
const path = require('node:path');
const veredito = require('./veredito.js');
const texto = require('./texto.js');

// mora na pasta da ronda 1 da base nova: some com ela se o preparar desfaz a ronda
const ARQUIVO = 'herdados.json';
const VIZINHAS = 2;
const OPCIONAIS = ['comando', 'simbolo', 'foraDoPedido'];

function temTexto(v) { return typeof v === 'string' && v.trim() !== ''; }

/** As linhas de `linha - VIZINHAS` a `linha + VIZINHAS` (cortadas no comeco e no fim), juntas por "\n"; null quando a
 *  linha nao existe ou e branca (linha branca nao ancora conteudo nenhum). O '' que o split deixa depois do "\n"
 *  final nao e linha do arquivo: fica fora da janela, que o podar acha no texto com ou sem o "\n" final. */
function janela(linhas, linha) {
  if (!Array.isArray(linhas)) return null;
  const fim = linhas.length > 0 && linhas[linhas.length - 1] === '' ? linhas.length - 1 : linhas.length;
  if (!Number.isInteger(linha) || linha < 1 || linha > fim) return null;
  if (String(linhas[linha - 1]).trim() === '') return null;
  return linhas.slice(Math.max(0, linha - 1 - VIZINHAS), Math.min(fim, linha + VIZINHAS)).join('\n');
}

/** A entrada do herdados.json esta na forma: { lente, severidade: 'P2', janela, prova, origem } e os opcionais texto. */
function valido(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return false;
  const lente = veredito.chaveDaLente(e.lente);
  if (!lente || lente === veredito.LENTE_DO_PEDIDO || e.severidade !== 'P2') return false;
  if (!temTexto(e.janela) || !temTexto(e.prova) || !temTexto(e.origem)) return false;
  return OPCIONAIS.every(function (c) { return e[c] === undefined || temTexto(e[c]); });
}

/** Lanca com a posicao da primeira entrada fora da forma (o apurar-ronda.js para com ela, como no refutados.json). */
function conferir(lista) {
  if (!Array.isArray(lista)) throw new Error(ARQUIVO + ' nao e uma lista');
  lista.forEach(function (e, i) {
    if (!valido(e)) {
      throw new Error('entrada invalida no ' + ARQUIVO + ' (posicao ' + (i + 1) + '): cada uma e { lente, severidade: ' +
        '"P2", janela, prova, origem } com texto, de uma lente que nao e a do pedido; comando, simbolo e ' +
        'foraDoPedido, quando vem, tambem sao texto nao vazio');
    }
  });
  return lista;
}

// O JSON de um arquivo da revisao arquivada, ou null quando falta ou nao se le: a revisao fechada nao para a nova.
function lerOuNull(arq) {
  try { return JSON.parse(texto.semBom(fs.readFileSync(arq, 'utf8'))); } catch (e) { return null; }
}
function linhasOuNull(arq) {
  try { return texto.semBom(fs.readFileSync(arq, 'utf8')).replace(/\r\n/g, '\n').split('\n'); } catch (e) { return null; }
}

/**
 * Os descartes que a revisao arquivada em `pasta` deixa para a seguinte: os herdados que ela mesma recebeu (na ronda 1
 * dela) e os P2 que o refutados.json dela refutou do lado do trabalho, pelo mapa.json da ronda (o da `invertida` na
 * 2a passada), cada um com a janela do A.txt/B.txt da ronda. `origem` diz de onde vieram os novos. Sem duplicata
 * (a mesma lente, pela chave, sobre a mesma janela fica a primeira).
 */
function daRevisaoArquivada(pasta, origem) {
  const lista = [];
  const herdadosDela = lerOuNull(path.join(pasta, '1', ARQUIVO));
  if (Array.isArray(herdadosDela)) herdadosDela.filter(valido).forEach(function (e) { lista.push(e); });
  const refutados = lerOuNull(path.join(pasta, 'refutados.json'));
  for (const r of Array.isArray(refutados) ? refutados : []) {
    if (!r || typeof r !== 'object' || r.lacuna === true || r.severidade !== 'P2' || !temTexto(r.prova)) continue;
    const lente = veredito.chaveDaLente(r.lente);
    const rotulo = veredito.rotuloDoArquivo(r.arquivo);
    if (!lente || lente === veredito.LENTE_DO_PEDIDO || !rotulo || !Number.isInteger(r.ronda) || r.ronda < 1) continue;
    const passada = r.passada === 2 ? 2 : 1;
    const mj = lerOuNull(path.join(pasta, String(r.ronda), 'mapa.json'));
    const mapa = mj && typeof mj === 'object' ? (passada === 2 ? mj.invertida : mj.mapa) : null;
    if (!mapa || typeof mapa !== 'object' || mapa[rotulo] !== 'trabalho') continue;
    const partes = [pasta, String(r.ronda)].concat(passada === 2 ? ['invertida'] : [], [rotulo + '.txt']);
    const jan = janela(linhasOuNull(path.join.apply(path, partes)), r.linha);
    if (jan === null) continue;
    const e = { lente: lente, severidade: 'P2', janela: jan, prova: r.prova, origem: origem + ', ronda ' + r.ronda };
    OPCIONAIS.forEach(function (c) { if (temTexto(r[c])) e[c] = r[c]; });
    lista.push(e);
  }
  return lista.filter(function (e, i) {
    const chave = veredito.chaveDaLente(e.lente);
    return lista.findIndex(function (o) {
      return veredito.chaveDaLente(o.lente) === chave && o.janela === e.janela;
    }) === i;
  });
}

/** So os herdados cuja janela ainda esta, linha a linha, no texto atual do arquivo. O podar nao normaliza: quem chama
 *  passa o texto com o CRLF ja trocado por "\n", como as janelas. */
function podar(lista, textoAtual) {
  const todo = '\n' + String(textoAtual) + '\n';
  return lista.filter(function (e) { return todo.indexOf('\n' + e.janela + '\n') !== -1; });
}

/** O herdado da mesma lente sobre a mesma janela, ou null. */
function achar(lista, lente, jan) {
  if (jan === null) return null;
  const chave = veredito.chaveDaLente(lente);
  return lista.find(function (e) { return veredito.chaveDaLente(e.lente) === chave && e.janela === jan; }) || null;
}

module.exports = { ARQUIVO, VIZINHAS, janela, valido, conferir, daRevisaoArquivada, podar, achar };
