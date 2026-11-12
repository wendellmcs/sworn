'use strict';
// D826 (D4): a conferencia de citacao "arquivo:linha + texto", tirada do apurar-ronda.js (a prova da refutacao,
// D821) com as raizes como argumento. O apurar confere no projeto; o /sworn:diagnose, no projeto e na pasta das
// transcricoes da sessao.
const fs = require('node:fs');
const path = require('node:path');

// a transcricao passa de centenas de MB: le em blocos e guarda so a janela de linhas pedida
const BLOCO = 1024 * 1024;

/** Espacos e quebras viram um espaco so: o texto citado nao precisa repetir a indentacao. */
function semEspaco(s) { return String(s).replace(/\s+/g, ' ').trim(); }

/** `abs` fica dentro de `raiz` (e nao e a propria raiz). "..notas.md" dentro dela vale; "../x" e outro disco nao. */
function dentroDe(raiz, abs) {
  const rel = path.relative(raiz, abs);
  return !!rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

/**
 * As linhas `de` a `ate` (contando de 1) do arquivo, lido em blocos, e se a linha `alvo` existe. A quebra final do
 * arquivo nao abre uma linha a mais. Quebra em "\n" (o "\r" do CRLF fica, e o semEspaco o trata como espaco): o byte 0x0A nunca fica no meio de um
 * caractere UTF-8, entao cada linha se decodifica inteira.
 */
function janela(abs, de, ate, alvo) {
  const fd = fs.openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(BLOCO);
    const guardadas = [];
    let partes = [];
    let numero = 1;
    let lidos;
    let algoDepois = false; // ha byte depois da ultima quebra (a linha corrente existe)
    while ((lidos = fs.readSync(fd, buf, 0, BLOCO, null)) > 0) {
      let inicio = 0;
      for (let i = 0; i < lidos; i++) {
        if (buf[i] !== 0x0a) continue;
        if (numero >= de && numero <= ate) {
          partes.push(Buffer.from(buf.subarray(inicio, i)));
          guardadas.push(Buffer.concat(partes).toString('utf8'));
        }
        partes = [];
        numero++;
        inicio = i + 1;
        if (numero > ate) return { linhas: guardadas, existe: true }; // a janela inclui a linha alvo
      }
      if (inicio < lidos) {
        algoDepois = true;
        if (numero >= de && numero <= ate) partes.push(Buffer.from(buf.subarray(inicio, lidos)));
      } else {
        algoDepois = false;
      }
    }
    const ultima = algoDepois ? numero : numero - 1; // a quebra final nao abre linha
    if (algoDepois && numero >= de && numero <= ate) {
      guardadas.push(Buffer.concat(partes).toString('utf8'));
    }
    return { linhas: guardadas, existe: alvo <= ultima };
  } finally { fs.closeSync(fd); }
}

/**
 * O `texto` esta no arquivo `caminho`, na linha `linha` ou ate `vizinhas` linhas acima ou abaixo, com os espacos
 * normalizados. `raizes` e uma pasta ou uma lista; o caminho relativo parte da primeira. So vale arquivo dentro de
 * uma raiz, tambem pelo caminho real (o atalho dentro dela que aponta para fora nao vale). Arquivo que falta ou nao
 * se le, linha que nao e inteiro de 1 ao fim, ou texto vazio: false.
 */
function citacaoConfere(raizes, caminho, linha, texto, vizinhas) {
  const lista = [].concat(raizes).filter(function (r) { return typeof r === 'string' && r !== ''; });
  if (!lista.length || !Number.isInteger(linha) || linha < 1 || !semEspaco(texto || '')) return false;
  const abs = path.resolve(lista[0], String(caminho).replace(/\\/g, '/'));
  const n = Math.max(0, vizinhas | 0);
  for (const raiz of lista) {
    if (!dentroDe(raiz, abs)) continue;
    let lido;
    try {
      if (!dentroDe(fs.realpathSync.native(raiz), fs.realpathSync.native(abs))) continue;
      lido = janela(abs, Math.max(1, linha - n), linha + n, linha);
    } catch (e) { continue; }
    if (!lido.existe) return false;
    return semEspaco(lido.linhas.join('\n')).indexOf(semEspaco(texto)) !== -1;
  }
  return false;
}

module.exports = { semEspaco, dentroDe, citacaoConfere };
