'use strict';

const ESPECIAIS = new Set(['.', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']);
const CAIXA_PADRAO = process.platform === 'win32';

/**
 * Troca barra invertida por barra, tira './' da frente e barra sobrando no comeco; null e undefined viram vazio.
 * A2-27: nao apara espaco. 'a ' e 'a' sao arquivos distintos, tambem no Windows (o Node grava o nome inteiro).
 */
function normalizar(caminho) {
  return String(caminho == null ? '' : caminho)
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}

// Padrao de caminho -> RegExp ancorada.
//   **/  -> zero ou mais niveis de diretorio
//   **   -> qualquer coisa, inclusive barra
//   *    -> qualquer coisa menos barra
// O padrao e escrito a mao (projeto.json, escopo.md, design.json): o espaco nas pontas sai antes de normalizar.
function paraRegExp(padrao, ignorarCaixa) {
  const p = normalizar(String(padrao == null ? '' : padrao).trim());
  let re = '';
  let i = 0;
  while (i < p.length) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      if (p[i + 2] === '/') { re += '(?:.*/)?'; i += 3; }
      else { re += '.*'; i += 2; }
    } else if (c === '*') {
      re += '[^/]*'; i += 1;
    } else if (ESPECIAIS.has(c)) {
      re += '\\' + c; i += 1;
    } else {
      re += c; i += 1;
    }
  }
  // So o omitido segue a plataforma (win32 ignora caixa); qualquer outro valor vale pelo que e como booleano, e null
  // ou false deixam a caixa sensivel.
  const semCaixa = ignorarCaixa === undefined ? CAIXA_PADRAO : Boolean(ignorarCaixa);
  return new RegExp('^' + re + '$', semCaixa ? 'i' : '');
}

function casa(padrao, caminho, ignorarCaixa) {
  if (!padrao) return false;
  return paraRegExp(padrao, ignorarCaixa).test(normalizar(caminho));
}

function casaAlgum(padroes, caminho, ignorarCaixa) {
  if (!Array.isArray(padroes)) return false;
  return padroes.some(function (p) { return casa(p, caminho, ignorarCaixa); });
}

module.exports = { normalizar, paraRegExp, casa, casaAlgum };
