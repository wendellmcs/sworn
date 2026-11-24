'use strict';
// H6f (15.9): vermelho antes de verde, pelos recibos do H6a (D891). O arquivo de teste que o agente principal edita
// entra em `testesSemVermelho`, no estado da sessao (marcar-trabalho.js); um comando de teste que falha e o cobre o tira
// de la (recibo-da-prova.js); a alegacao de pronto com a lista cheia barra uma vez no fecho (portao-fecho.js). A ideia e
// a do nizos/tdd-guard (MIT), sem modelo: o teste que nunca falhou pode nao testar nada.
// Limites declarados: o comando que nao cita arquivo de teste (a suite, a pasta, o filtro por nome) cobre todos, mesmo
// que a falha seja de outro teste; o `cd` dentro do comando nao muda o cwd com que o caminho se resolve; a opcao que traz
// o arquivo (`--spec=x.test.js`) o cita pelo fim do caminho, em qualquer pasta; a lista guarda os 50 mais recentes (o
// 51o editado tira o mais antigo, que deixa de pedir vermelho; o corte fica marcado na lista, e o motivo do fecho avisa
// dele ate um vermelho que cubra todos).
const fs = require('node:fs');
const path = require('node:path');
const evidencia = require('./evidencia.js');
const { ascii } = require('./escopo.js');

// So pelo nome: o ajudante e a fixture da pasta de teste (test/lib/comum.js) nao pedem vermelho.
const NOME_DE_TESTE = /\.(?:test|spec)\.[cm]?[jt]sx?$|^test_[^\\/]*\.py$|_test\.(?:py|go)$|_spec\.rb$/i;
const TETO = 50;
const MAX_CITADOS = 5;
const ESCAPE = /^[ \t>*_-]*SEM VERMELHO:[ \t]*\S/m;
// A marca do corte, no lugar de um caminho: o `<` nunca abre um caminho resolvido (`/` ou a letra do disco).
const CORTE = '<cortados>';

/** O cwd que resolve os caminhos: o do gancho, ou o do processo quando ele nao e texto. */
function raiz(cwd) {
  return typeof cwd === 'string' && cwd ? cwd : process.cwd();
}

/** A forma de comparar dois caminhos: barra normal e, no Windows e no macOS, sem a caixa (o NTFS e o APFS padrao a
 *  ignoram). */
function chave(abs) {
  const r = String(abs).replace(/\\/g, '/');
  return process.platform === 'win32' || process.platform === 'darwin' ? r.toLowerCase() : r;
}

function ehNomeDeTeste(caminho) {
  return NOME_DE_TESTE.test(path.basename(String(caminho).replace(/\\/g, '/')));
}

function listaValida(lista) {
  return Array.isArray(lista) ? lista.filter(function (x) { return typeof x === 'string' && x; }) : [];
}

/** A lista com o arquivo editado, quando ele tem nome de teste; uma vez so pelo caminho resolvido. Passou do teto: os
 *  mais antigos saem, e a marca do corte abre a lista. */
function comEdicao(lista, cwd, arquivo) {
  const atual = listaValida(lista);
  if (typeof arquivo !== 'string' || !arquivo || !ehNomeDeTeste(arquivo)) return atual;
  const abs = path.resolve(raiz(cwd), arquivo.replace(/\\/g, '/'));
  if (atual.some(function (x) { return chave(x) === chave(abs); })) return atual;
  const nomes = atual.filter(function (x) { return x !== CORTE; }).concat([abs]);
  return (nomes.length > TETO || atual.indexOf(CORTE) !== -1 ? [CORTE] : []).concat(nomes.slice(-TETO));
}

/** O glob de um caminho ja em `chave` como corpo de expressao, segmento a segmento: o segmento `**` cruza pastas
 *  (nenhuma tambem); colado a um nome (`**.test.js`) ele e `*`, como no bash, no minimatch e no glob do node; `*` e `?`
 *  nao cruzam. */
function corpoDoGlob(p) {
  const partes = p.split('/');
  return partes.map(function (s, i) {
    if (s === '**') return '(?:[^/]*/)*';
    return s.replace(/\*+|\?|[.+^${}()|[\]\\]/g, function (m) {
      if (m.charAt(0) === '*') return '[^/]*';
      if (m === '?') return '[^/]';
      return '\\' + m;
    }) + (i < partes.length - 1 ? '/' : '');
  }).join('');
}

/** As palavras do comando; o trecho entre aspas fica inteiro, com o espaco. */
function palavras(comando) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|([^\s"'`;&|()<>]+)/g;
  let m;
  while ((m = re.exec(comando)) !== null) out.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
  return out;
}

/** Os arquivos de teste que o comando cita, como expressao sobre a `chave` do caminho: o caminho resolvido no cwd (pode
 *  ser glob), ou o fim do caminho, quando vem numa opcao (`--spec=x.test.js`). Sem o `::teste` do pytest e sem o
 *  `:linha` do vitest e do jest. */
function alvosDoComando(comando, cwd) {
  const alvos = [];
  palavras(String(comando || '')).forEach(function (t) {
    const opcao = /^-[^=]*=(.*)$/.exec(t);
    const v = (opcao ? opcao[1] : t).replace(/::.*$/, '').replace(/:\d+(?::\d+)?$/, '');
    if (!v || !ehNomeDeTeste(v)) return;
    alvos.push(opcao
      ? new RegExp('(?:^|/)' + corpoDoGlob(chave(v).replace(/^(?:\.\/)+/, '')) + '$')
      : new RegExp('^' + corpoDoGlob(chave(path.resolve(raiz(cwd), v.replace(/\\/g, '/')))) + '$'));
  });
  return alvos;
}

/** A lista sem os arquivos que o comando de teste cobre. Sem arquivo de teste citado, ele cobre todos, e leva a marca
 *  do corte junto; o que cita arquivo a deixa (todo alvo acaba num nome de teste, e a marca nao). */
function semOsCobertos(lista, comando, cwd) {
  const atual = listaValida(lista);
  if (!String(comando || '').trim()) return atual;
  const alvos = alvosDoComando(comando, cwd);
  if (!alvos.length) return [];
  return atual.filter(function (abs) {
    const k = chave(abs);
    return !alvos.some(function (re) { return re.test(k); });
  });
}

/** A resposta abre uma linha com "SEM VERMELHO: <motivo>". */
function declarou(msg) {
  return ESCAPE.test(String(msg || ''));
}

/** O motivo de barrar o pronto: a alegacao de sucesso, sem a linha de escape, com arquivo de teste ainda na lista e no
 *  disco, ou com a marca do corte. Sem isso, null. ASCII (R5). */
function motivoDoFecho(lista, msg, projeto, cwd) {
  if (projeto && projeto.vermelhoAntes === false) return null;
  const atual = listaValida(lista);
  const cortou = atual.indexOf(CORTE) !== -1;
  const vivos = atual.filter(function (abs) {
    if (abs === CORTE) return false;
    // So "nao existe" tira da lista: o arquivo travado por outro processo (EBUSY, EPERM no Windows) segue pedindo.
    try { return fs.statSync(abs).isFile(); } catch (e) { return !(e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')); }
  });
  if ((!vivos.length && !cortou) || declarou(msg)) return null;
  const a = evidencia.analisar(msg);
  if (!a.alegaSucesso || a.declaraNaoRodou) return null;
  const nomes = vivos.slice(0, MAX_CITADOS).map(function (abs) {
    const rel = path.relative(raiz(cwd), abs);
    return '  - "' + ascii((rel && !rel.startsWith('..') ? rel : abs).replace(/\\/g, '/')) + '"';
  });
  const resto = vivos.length - MAX_CITADOS;
  if (resto > 0) nomes.push('  +' + resto + (resto === 1 ? ' outro arquivo de teste' : ' outros arquivos de teste'));
  // O corte ja tirou da lista o mais antigo, talvez sem o vermelho dele (comEdicao): dizer, nao calar.
  if (cortou) {
    nomes.push('  (a lista guarda so os ' + TETO + ' arquivos de teste mais recentes: os editados antes deles podem ' +
      'ter saido sem pedir vermelho)');
  }
  return ['sworn: teste editado sem vermelho antes. Estes arquivos de teste mudaram nesta sessao e nenhum comando de ' +
    'teste que os cobre falhou depois disso:'].concat(nomes, [
    'Um teste que nunca falhou pode nao testar nada. Rode-o antes do conserto, ou quebre o codigo de proposito, e veja-o ' +
    'falhar. Se ele ja falhou antes ou so mudou texto, abra a resposta com a linha "SEM VERMELHO: <motivo>".']).join('\n');
}

module.exports = { comEdicao, semOsCobertos, declarou, motivoDoFecho, ehNomeDeTeste };
