'use strict';

/**
 * F2a (D828.5): o que mudou entre duas listas de linhas, sem processo de fora. O apurar-ronda.js compara o lado novo
 * de duas rondas seguidas (dois arquivos da pasta da revisao, fora do git), e a conta roda dentro do apurar; o
 * `git diff --no-index` sai com codigo 1 quando ha diferenca, que o git.correr le como falha.
 * Os blocos saem na forma do `git diff -U0` (a do git.diffContraHead): { antigoIni, antigoQtd, novoIni, novoQtd },
 * linhas a partir de 1. No bloco so de insercao (antigoQtd 0), antigoIni e a linha de antes depois da qual o texto
 * entrou (0 no comeco); no so de remocao (novoQtd 0), novoIni e a linha de depois que fica antes do ponto.
 */

/**
 * Acima disto (linhas de antes x linhas de depois, ja sem o comeco e o fim iguais) o miolo nao se mede. E tambem o
 * maior teto que se aceita: a tabela guarda 16 bits por celula, e com ele o menor lado nunca passa de 4000 linhas.
 */
const TETO_DE_CELULAS = 16000000;

function bloco(antes, qtdAntes, depois, qtdDepois) {
  return { antigoIni: qtdAntes ? antes + 1 : antes, antigoQtd: qtdAntes, novoIni: qtdDepois ? depois + 1 : depois,
    novoQtd: qtdDepois };
}

/**
 * Os blocos mudados de `antes` para `depois` (listas de texto, uma linha por item), em ordem. Corta o comeco e o fim
 * iguais e mede o miolo pela maior subsequencia comum. Miolo acima de `teto` celulas sai como um bloco so: quem le
 * erra para o lado de "mudou", nunca para o de "ficou igual". O `teto` so abaixa o padrao (TETO_DE_CELULAS): o que
 * passar dele vale o padrao.
 */
function blocos(antes, depois, teto) {
  const limite = Number.isInteger(teto) ? Math.min(teto, TETO_DE_CELULAS) : TETO_DE_CELULAS;
  let ini = 0;
  while (ini < antes.length && ini < depois.length && antes[ini] === depois[ini]) ini++;
  let fimA = antes.length;
  let fimD = depois.length;
  while (fimA > ini && fimD > ini && antes[fimA - 1] === depois[fimD - 1]) { fimA--; fimD--; }
  const a = fimA - ini;
  const d = fimD - ini;
  if (a === 0 && d === 0) return [];
  if (a === 0 || d === 0 || a * d > limite) return [bloco(ini, a, ini, d)];
  // comum[i * (d + 1) + j] = o tamanho da maior subsequencia comum de antes[ini + i..] e depois[ini + j..]. O valor
  // cabe em 16 bits: nunca passa do menor lado, e o menor lado nunca passa da raiz do limite, que o teto nao sobe.
  const largura = d + 1;
  const comum = new Uint16Array((a + 1) * largura);
  for (let i = a - 1; i >= 0; i--) {
    for (let j = d - 1; j >= 0; j--) {
      comum[i * largura + j] = antes[ini + i] === depois[ini + j]
        ? comum[(i + 1) * largura + j + 1] + 1
        : Math.max(comum[(i + 1) * largura + j], comum[i * largura + j + 1]);
    }
  }
  const saida = [];
  let i = 0;
  let j = 0;
  let abertoI = 0;
  let abertoJ = 0;
  const fechar = function () {
    if (i > abertoI || j > abertoJ) saida.push(bloco(ini + abertoI, i - abertoI, ini + abertoJ, j - abertoJ));
  };
  while (i < a && j < d) {
    if (antes[ini + i] === depois[ini + j]) {
      fechar();
      i++; j++;
      abertoI = i; abertoJ = j;
    } else if (comum[(i + 1) * largura + j] >= comum[i * largura + j + 1]) i++;
    else j++;
  }
  i = a; j = d;
  fechar();
  return saida;
}

/** As linhas de depois que os blocos tocaram, em ordem; no bloco so de remocao, as duas vizinhas do ponto. */
function tocadas(lista) {
  const linhas = [];
  for (const b of lista) {
    if (b.novoQtd === 0) {
      if (b.novoIni >= 1) linhas.push(b.novoIni);
      linhas.push(b.novoIni + 1);
    }
    for (let n = b.novoIni; n < b.novoIni + b.novoQtd; n++) linhas.push(n);
  }
  return linhas;
}

/** A linha de depois que corresponde a `linha` de antes; null quando ela caiu dentro de um bloco mudado. */
function levar(linha, lista) {
  let desloca = 0;
  for (const b of lista) {
    if (b.antigoQtd === 0) {
      if (linha <= b.antigoIni) break;
      desloca += b.novoQtd;
      continue;
    }
    if (linha < b.antigoIni) break;
    if (linha < b.antigoIni + b.antigoQtd) return null;
    desloca += b.novoQtd - b.antigoQtd;
  }
  return linha + desloca;
}

module.exports = { TETO_DE_CELULAS, blocos, tocadas, levar };
