'use strict';
const fs = require('node:fs');
const path = require('node:path');

/** FNV-1a de 32 bits. Deterministico: a mesma sessao reproduz a mesma ordem. */
function semente(texto) {
  let h = 0x811c9dc5;
  const s = String(texto == null ? '' : texto);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * B5: o inspetor recebe A e B sem autoria e sem ordem fixa.
 * O mapa fica com quem despachou, e o inspetor nunca o ve.
 */
function rotular(itens, sementeTexto) {
  if (!Array.isArray(itens) || itens.length !== 2) {
    throw new Error('rotular espera exatamente dois itens');
  }
  const inverter = (semente(sementeTexto) % 2) === 1;
  const primeiro = inverter ? itens[1] : itens[0];
  const segundo = inverter ? itens[0] : itens[1];
  return {
    A: { conteudo: primeiro.conteudo },
    B: { conteudo: segundo.conteudo },
    mapa: { A: primeiro.nome, B: segundo.nome }
  };
}

/** Rondas sao pastas numeradas: 1, 2, 3. Teto de 3 e apurado em veredito.js. */
function proximaRonda(dir) {
  let existentes = [];
  try {
    existentes = fs.readdirSync(dir, { withFileTypes: true })
      .filter(function (e) { return e.isDirectory() && /^\d+$/.test(e.name); })
      .map(function (e) { return parseInt(e.name, 10); });
  } catch (e) {
    existentes = [];
  }
  return existentes.length ? Math.max.apply(null, existentes) + 1 : 1;
}

/**
 * D257 secao 11, item 11: uma base por arquivo. O id e o caminho relativo com a barra virando
 * duplo underscore e todo caractere fora de [a-zA-Z0-9._-] virando underscore
 * (scripts/lib/escopo.js -> scripts__lib__escopo.js). Sempre um nome de pasta seguro. Nunca so
 * digitos: `2026` viraria uma ronda solta do formato antigo (temPastaNumeradaSolta), e ganha `_`.
 */
function idDoArquivo(rel) {
  const id = String(rel == null ? '' : rel).split('/').join('__').replace(/[^a-zA-Z0-9._-]/g, '_');
  return /^\d+$/.test(id) ? '_' + id : id;
}

// 0.3.3, item 18: a regra do id em texto, para os avisos dos scripts. Mora ao lado do idDoArquivo, e um
// teste prende que o texto e a funcao concordam.
const REGRA_DO_ID = 'o caminho do arquivo revisado com cada / trocado por __ e cada caractere fora de ' +
  'letras, numeros, ".", "_" e "-" trocado por _';

/** A base das rondas de um arquivo: <revisao>/<id>. As rondas moram em <base>/<n>/. */
function baseDoArquivo(revisao, rel) {
  return path.join(revisao, idDoArquivo(rel));
}

/**
 * Formato da 0.3.0: pasta numerada SOLTA em revisao/ (revisao/1/), uma base unica para todos os
 * arquivos. Ha revisao em andamento nesse formato quando existe uma. As pastas numeradas das
 * bases novas ficam um nivel abaixo e nao contam.
 */
function temPastaNumeradaSolta(revisao) {
  try {
    return fs.readdirSync(revisao, { withFileTypes: true })
      .some(function (e) { return e.isDirectory() && /^\d+$/.test(e.name); });
  } catch (e) {
    return false;
  }
}

// D486 (s107): nas faixas pequenas da D485 o inspetor recebe o trecho mudado, nao o arquivo inteiro. A margem de 20
// linhas em volta de cada bloco e escolha tecnica da s108.
const TRECHO_MARGEM = 20;

/**
 * D486: o texto com so os blocos [{ ini, qtd }] (linha a partir de 1; qtd 0 = insercao do outro lado, a margem fica
 * em volta de `ini`) e `margem` linhas em volta. As linhas de fora ficam em branco - o numero de linha segue o do
 * arquivo, e o apurar e a refutacao nao mudam - e a primeira de cada vao diz "[fora do trecho: linhas a-b]", para o
 * inspetor nao ler o vao como defeito. O \r de cada linha fica (CRLF segue CRLF). Sem bloco, o texto como veio.
 * Ronda 1 da s108 (borda): bloco ou margem que nao e inteiro >= 0 tambem devolve o texto como veio - o NaN nao
 * marcava linha nenhuma e o inspetor recebia um recorte vazio, calado. Na duvida, o arquivo inteiro.
 */
function recortarTrecho(texto, blocos, margem) {
  if (!Array.isArray(blocos) || blocos.length === 0) return texto;
  const inteiro = function (n) { return Number.isInteger(n) && n >= 0; };
  if (!inteiro(margem) || !blocos.every(function (b) { return b && inteiro(b.ini) && inteiro(b.qtd); })) return texto;
  const linhas = String(texto).split('\n');
  const total = linhas[linhas.length - 1] === '' ? linhas.length - 1 : linhas.length;
  const fica = new Array(total).fill(false);
  blocos.forEach(function (b) {
    const de = Math.max(1, b.ini - margem);
    const ate = Math.min(total, b.ini + Math.max(b.qtd, 1) - 1 + margem);
    for (let i = de; i <= ate; i++) fica[i - 1] = true;
  });
  const fimDe = function (l) { return l.endsWith('\r') ? '\r' : ''; };
  for (let i = 0; i < total; i++) {
    if (fica[i]) continue;
    let j = i;
    while (j + 1 < total && !fica[j + 1]) j++;
    linhas[i] = '[fora do trecho: linhas ' + (i + 1) + '-' + (j + 1) + ']' + fimDe(linhas[i]);
    for (let k = i + 1; k <= j; k++) linhas[k] = fimDe(linhas[k]);
    i = j;
  }
  return linhas.join('\n');
}

/**
 * D503 (escolha E1 do plano d503): o tipo da referencia que vale para o arquivo revisado. `texto` pela mesma extensao
 * que a faixa usa (preparar-revisao.js), `tela` pela regra de estilo do portao (design.ehArquivoDeEstilo, que chega
 * pronta em `ehEstilo`), `codigo` o resto. Texto vence estilo, como na faixa.
 */
function tipoDaReferencia(rel, ehEstilo) {
  if (/\.(md|markdown|txt)$/i.test(String(rel))) return 'texto';
  return ehEstilo ? 'tela' : 'codigo';
}

// Esquema de URL (https://, file://): nao vai ao disco, o inspetor so le arquivo.
const RE_URL = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

// Plano 082 (p3-15): o R.txt vai inteiro a cada inspetor, nas duas passadas. Referencia de texto maior que isto (em
// bytes UTF-8) nao entra: vai pelo caminho, como a imagem, e o inspetor a abre com Read. Escolha tecnica da s64.
const TETO_DA_REFERENCIA = 100 * 1024;

// Plano 082 (p3-23): so o cabecalho escrito aqui comeca uma linha com "===". Linha do conteudo que comeca assim ganha
// "\" na frente, para o conteudo nao forjar o comeco de outra referencia; a entrada vai numa linha so. A linha que ja
// comeca com barras e depois "===" tambem ganha uma (p5-8): "\===" vira "\\===" e nao se confunde com "===" escapada;
// quem le tira sempre uma barra so.
function semCabecalho(texto) { return String(texto).replace(/^(?=\\*===)/gm, '\\'); }
function numaLinha(texto) { return String(texto).replace(/[\r\n]+/g, ' '); }

/**
 * D503 (escolha E2): o texto do R.txt. Um bloco por entrada, com cabecalho "=== referencia i de n: <entrada> ===".
 * `ler(entrada)` devolve { tipo: 'texto', conteudo, caminho? } | { tipo: 'binario', caminho } |
 * { tipo: 'grande', caminho, tamanho } | { tipo: 'falta' } e fica com quem chama, para isto ser puro. URL nao chama
 * `ler`. Devolve tambem as entradas que faltam, as URLs e as maiores que o teto, para o aviso.
 */
function montarReferencia(entradas, ler) {
  const faltam = [];
  const urls = [];
  const grandes = [];
  const pelaLeitura = function (caminho) {
    return caminho ? 'abra com Read em "' + caminho + '"' : 'abra com Read o arquivo do cabecalho acima';
  };
  const blocos = entradas.map(function (e, i) {
    const cab = '=== referencia ' + (i + 1) + ' de ' + entradas.length + ': ' + numaLinha(e) + ' ===\n';
    if (RE_URL.test(e)) {
      urls.push(e);
      return cab + '(URL: o inspetor so le arquivo e nao abre a pagina; julgue sem ela e diga isso)\n';
    }
    let lido = ler(e);
    if (lido && lido.tipo === 'texto' && Buffer.byteLength(lido.conteudo, 'utf8') > TETO_DA_REFERENCIA) {
      lido = { tipo: 'grande', caminho: lido.caminho, tamanho: Buffer.byteLength(lido.conteudo, 'utf8') };
    }
    if (lido && lido.tipo === 'texto') {
      const conteudo = semCabecalho(lido.conteudo);
      return cab + conteudo + (conteudo.endsWith('\n') ? '' : '\n');
    }
    if (lido && lido.tipo === 'grande') {
      grandes.push(e);
      return cab + '(maior que o teto do R.txt, ' + TETO_DA_REFERENCIA + ' bytes: tem ' + lido.tamanho + '; ' +
        pelaLeitura(lido.caminho) + ')\n';
    }
    // Plano 082 (p3-22): o caminho entre aspas - com espaco, sem elas, nao se sabe onde ele acaba.
    if (lido && lido.tipo === 'binario') return cab + '(imagem ou binario: ' + pelaLeitura(lido.caminho) + ')\n';
    faltam.push(e);
    // A3-08: qual lista conferir, e que o julgamento segue sem ela.
    return cab + '(NAO ACHADA no disco: confira o caminho na lista "referencias" de .claude/sworn/projeto.json; ' +
      'julgue sem esta referencia)\n';
  });
  return { texto: blocos.join('\n'), faltam: faltam, urls: urls, grandes: grandes };
}

module.exports = { semente, rotular, proximaRonda, idDoArquivo, REGRA_DO_ID, baseDoArquivo, temPastaNumeradaSolta,
  TRECHO_MARGEM, recortarTrecho, tipoDaReferencia, TETO_DA_REFERENCIA, montarReferencia };
