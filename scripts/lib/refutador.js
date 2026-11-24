'use strict';
// H6e2 (15.0, D898): o refutador independente dos P0/P1 (docs/revisao-automatica.md, secao 5.4, item 2; RA7).
// Quem refuta no refutados.json um P0/P1 do lado do trabalho precisa antes da resposta do sworn:refuter: um agente
// que nao escreveu o conserto, le o codigo vivo e responde confirmado, refutado ou inconclusivo. O gancho
// (gravar-veredito.js) grava a resposta em <base>/refutacoes/<nome>; o apurar-ronda.js so aceita a refutacao que tem a
// resposta "refutado". Inconclusivo e confirmado ficam (RA7): na duvida, o achado continua de pe.
const veredito = require('./veredito.js');
const texto = require('./texto.js');

const AGENTE = 'sworn:refuter';
const VEREDITOS = ['confirmado', 'refutado', 'inconclusivo'];
const GRAVES = ['P0', 'P1'];
// revisao/<id>/refutacoes: a pasta fica na base do arquivo, ao lado das rondas numeradas
const PASTA = /(?:^|\/)\.claude\/sworn\/revisao\/[^/]+\/refutacoes$/i;
// a prova do "refutado" cita o codigo vivo: caminho:linha, com extensao que comeca por letra (a.js:12) ou pasta
// (src/Makefile:3); "10:30", "nota:1" e "v1.2:3" nao sao citacao. E so a forma: o arquivo citado nao e conferido aqui
// (example.com:80 passa), quem confere e o refutador, que le o codigo vivo
const CITACAO = /(?:[\w.\/\\-]*\.[A-Za-z][A-Za-z0-9]*|[\w.-]*[\/\\][\w.\/\\-]*[\w-]):\d+/;
// o trecho da prova que a mensagem mostra, cortado por code point: nao deixa meio par surrogate (emoji sozinho); um
// emoji composto ou um acento combinado ainda podem partir no corte, so na mensagem
const CORTE_DA_PROVA = 120;

function inteiro(n) { return Number.isInteger(n) && n >= 1; }

/**
 * O nome do arquivo da resposta de um achado: r<ronda>-<lente>-<A|B>-<linha>-<severidade>[-p2].json. O mesmo para a
 * entrada do refutados.json e para a resposta do refutador, que copia os campos do achado. null fora da forma.
 */
function nomeDoArquivo(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
  const lente = veredito.chaveDaLente(a.lente);
  const lado = veredito.rotuloDoArquivo(a.arquivo);
  if (!lente || !lado || !inteiro(a.ronda) || !inteiro(a.linha) || GRAVES.indexOf(a.severidade) === -1) return null;
  if (a.passada !== undefined && a.passada !== 1 && a.passada !== 2) return null;
  return 'r' + a.ronda + '-' + lente + '-' + lado + '-' + a.linha + '-' + a.severidade + (a.passada === 2 ? '-p2' : '') +
    '.json';
}

/** Os erros da resposta do refutador; lista vazia = resposta valida. */
function errosDaResposta(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return ['a resposta nao e um objeto JSON'];
  const erros = [];
  if (typeof r.refutacoes !== 'string' || !r.refutacoes.trim()) {
    erros.push('falta "refutacoes" (a pasta que o briefing passou)');
  }
  if (VEREDITOS.indexOf(r.veredito) === -1) erros.push('"veredito" tem de ser confirmado, refutado ou inconclusivo');
  if (typeof r.prova !== 'string' || !r.prova.trim()) {
    erros.push('falta "prova" (o que o codigo vivo mostra, com arquivo:linha)');
  } else if (r.veredito === 'refutado' && !CITACAO.test(r.prova)) {
    erros.push('o "refutado" precisa citar na "prova" o arquivo:linha do codigo vivo que mostra o achado errado ' +
      '(por exemplo, src/a.js:12)');
  }
  if (!nomeDoArquivo(r)) {
    erros.push('o achado nao esta na forma: "ronda" e "linha" inteiras, "lente" conhecida, "arquivo" A.txt ou B.txt, ' +
      '"severidade" P0 ou P1 e "passada" 1, 2 ou fora do objeto, copiados do briefing');
  }
  return erros;
}

/**
 * As refutacoes do refutados.json que nao valem sem o refutador: uma mensagem por refutacao. `exige(r)` diz se a
 * entrada precisa da resposta (o apurar: o lado do trabalho numa ronda preparada na 0.87.0 ou depois); `ler(nome)`
 * devolve o JSON da resposta em refutacoes/, null quando o arquivo nao existe, ou lanca quando nao se le. So o P0/P1
 * de achado entra: a lacuna contra a referencia e o P2 seguem pela prova no repositorio. A entrada fora da forma fica
 * para o conferirRefutados, que recusa com a causa.
 */
function faltas(refutados, exige, ler) {
  const msgs = [];
  for (const r of Array.isArray(refutados) ? refutados : []) {
    // o nomeDoArquivo so da nome ao P0/P1 na forma: o P2 e a entrada torta ficam fora por ele
    if (!r || typeof r !== 'object' || r.lacuna === true) continue;
    const nome = nomeDoArquivo(r);
    if (!nome || !exige(r)) continue;
    const achado = 'o ' + r.severidade + ' da ronda ' + r.ronda + ', lente ' + r.lente + ', ' + r.arquivo + ':' + r.linha +
      (r.passada === 2 ? ' (2a passada)' : '');
    let resp;
    try { resp = ler(nome); } catch (e) {
      msgs.push('a resposta do refutador para ' + achado + ' (refutacoes/' + nome + ') nao se le (' +
        texto.causaDoErro(e) + '). Mova o arquivo para fora de refutacoes/, despache o sworn:refuter de novo com esse ' +
        'achado e rode este comando de novo.');
      continue;
    }
    if (resp === null) {
      msgs.push('a refutacao d' + achado + ' nao tem a resposta do refutador (refutacoes/' + nome + '). Um P0/P1 so ' +
        'sai da conta quando um sworn:refuter, que le o codigo vivo, responde "refutado": despache-o com esse achado ' +
        '(Passo 3 do /sworn:review) e rode este comando de novo.');
      continue;
    }
    const erros = errosDaResposta(resp);
    if (erros.length) {
      msgs.push('a resposta do refutador para ' + achado + ' (refutacoes/' + nome + ') esta fora da forma (' +
        erros.join('; ') + '). Mova o arquivo para fora de refutacoes/, despache o sworn:refuter de novo e rode este ' +
        'comando de novo.');
      continue;
    }
    if (nomeDoArquivo(resp) !== nome) {
      msgs.push('a resposta em refutacoes/' + nome + ' e de outro achado (ela diz ' + nomeDoArquivo(resp) + '). Mova o ' +
        'arquivo para fora de refutacoes/, despache o sworn:refuter de novo com ' + achado + ' e rode este comando de novo.');
      continue;
    }
    if (resp.veredito !== 'refutado') {
      const prova = Array.from(resp.prova);
      const mostra = prova.slice(0, CORTE_DA_PROVA).join('') + (prova.length > CORTE_DA_PROVA ? '...' : '');
      msgs.push('o refutador respondeu "' + resp.veredito + '" para ' + achado + ' (' + mostra +
        '): o achado fica (RA7). Tire essa refutacao do refutados.json, corrija o achado e rode este comando de novo.');
    }
  }
  return msgs;
}

module.exports = { AGENTE, VEREDITOS, PASTA, nomeDoArquivo, errosDaResposta, faltas };
