'use strict';

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

// A gramatica do padrao:
//   **/  -> 'niveis': zero ou mais pastas inteiras (nada, ou qualquer coisa que termine em barra)
//   **   -> 'tudo': qualquer coisa, inclusive barra
//   *    -> 'um': qualquer coisa menos barra
//   o resto -> 'lit': o proprio caractere
// O padrao e escrito a mao (projeto.json, escopo.md, design.json): o espaco nas pontas sai antes de normalizar.
function pecasDoPadrao(padrao) {
  const p = normalizar(String(padrao == null ? '' : padrao).trim());
  const pecas = [];
  let i = 0;
  while (i < p.length) {
    if (p[i] === '*' && p[i + 1] === '*') {
      if (p[i + 2] === '/') { pecas.push({ t: 'niveis' }); i += 3; } else { pecas.push({ t: 'tudo' }); i += 2; }
    } else if (p[i] === '*') {
      pecas.push({ t: 'um' }); i += 1;
    } else {
      pecas.push({ t: 'lit', c: p[i] }); i += 1;
    }
  }
  return pecas;
}

// O caractere como a comparacao sem caixa das regex do JavaScript (a flag `i`, sem `u`) o le: a maiuscula dele,
// salvo quando ela tem mais de um caractere ou leva um caractere de fora do ASCII para dentro dele (o sinal de
// Kelvin nao vira "K"). Assim o casamento sem caixa e o mesmo de quando o padrao virava regex.
function comoAFlagI(ch) {
  const maiuscula = ch.toUpperCase();
  if (maiuscula.length !== 1) return ch;
  if (ch.charCodeAt(0) >= 128 && maiuscula.charCodeAt(0) < 128) return ch;
  return maiuscula;
}

// A quebra de linha que o `.` da regex nao lia: o `**` e o `**/` tambem nao a leem; o `*` (o `[^/]`) le.
const QUEBRAS = new Set(['\n', '\r', String.fromCharCode(0x2028), String.fromCharCode(0x2029)]);

// Os pontos alcancaveis sem ler caractere: um curinga pode casar nada, entao o ponto seguinte tambem vale.
function fecho(pecas, pontos) {
  const fila = Array.from(pontos);
  while (fila.length) {
    const k = fila.pop();
    if (k < pecas.length && pecas[k].t !== 'lit' && !pontos.has(k + 1)) { pontos.add(k + 1); fila.push(k + 1); }
  }
  return pontos;
}

// O caminho casa o padrao? O caminho e lido uma vez, com o conjunto dos pontos do padrao em que a leitura pode
// estar (como um automato), e o custo e o tamanho do caminho vezes o do padrao: um padrao com muitos curingas nao
// trava o portao a cada Write/Edit, como travava quando virava regex (backtracking sem teto).
// O `**/` tem, alem do ponto dele, o conjunto `dentro`: os `**/` que ja comecaram a ler pastas e so terminam
// logo depois de uma barra. Sem ele, o fecho deixaria `**/auth/**` casar `xauth/a`.
// (Comentarios de linha de proposito: o `**/` fecharia um comentario de bloco.)
// Caixa: so o omitido segue a plataforma (win32 ignora caixa); outro valor vale pelo que e como booleano, e null
// ou false deixam a caixa sensivel.
function casa(padrao, caminho, ignorarCaixa) {
  if (!padrao) return false;
  const semCaixa = ignorarCaixa === undefined ? CAIXA_PADRAO : Boolean(ignorarCaixa);
  const pecas = pecasDoPadrao(padrao);
  const texto = normalizar(caminho);
  const igual = semCaixa
    ? function (a, b) { return a === b || comoAFlagI(a) === comoAFlagI(b); }
    : function (a, b) { return a === b; };
  let pontos = fecho(pecas, new Set([0]));
  let dentro = new Set();
  for (let j = 0; j < texto.length && (pontos.size || dentro.size); j++) {
    const ch = texto[j];
    const quebra = QUEBRAS.has(ch);
    const proximos = new Set();
    const proximosDentro = new Set();
    for (const k of dentro) {
      if (quebra) continue;
      proximosDentro.add(k);
      if (ch === '/') proximos.add(k + 1);
    }
    for (const k of pontos) {
      const peca = pecas[k];
      if (!peca) continue;
      if (peca.t === 'lit') {
        if (igual(peca.c, ch)) proximos.add(k + 1);
      } else if (peca.t === 'um') {
        if (ch !== '/') proximos.add(k);
      } else if (peca.t === 'tudo') {
        if (!quebra) proximos.add(k);
      } else if (peca.t === 'niveis') {
        // A entrada do `**/` le a primeira pasta: fica dentro e, na barra, passa para a peca seguinte.
        if (!quebra) { proximosDentro.add(k); if (ch === '/') proximos.add(k + 1); }
      }
    }
    pontos = fecho(pecas, proximos);
    dentro = proximosDentro;
  }
  return pontos.has(pecas.length);
}

function casaAlgum(padroes, caminho, ignorarCaixa) {
  if (!Array.isArray(padroes)) return false;
  return padroes.some(function (p) { return casa(p, caminho, ignorarCaixa); });
}

module.exports = { normalizar, casa, casaAlgum };
