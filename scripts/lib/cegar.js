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

/** O embaralhamento final do murmur3 (fmix32): cada bit da saida depende de todos os da entrada. */
function embaralhar(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
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
  // A3-14: o bit mais fraco do FNV-1a e so a paridade dos caracteres de codigo impar (o multiplicador e impar): duas
  // sementes que mudam um 'b' por um 'd' davam sempre a mesma ordem. O embaralhamento final do murmur3 (fmix32)
  // espalha todos os bits, e o bit de cima decide.
  const inverter = (embaralhar(semente(sementeTexto)) >>> 31) === 1;
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
 * duplo underscore (scripts/lib/escopo.js -> scripts__lib__escopo.js). Sempre um nome de pasta seguro. Nunca so
 * digitos: `2026` viraria uma ronda solta do formato antigo (temPastaNumeradaSolta), e ganha `_`.
 * A3-12b: o resto fora de [a-zA-Z0-9.-] (o _ tambem) virava _, e a/b.js e a__b.js caiam na mesma base, somando as
 * rondas dos dois. Agora cada um vira ~ e o seu codigo de 4 digitos hexadecimais (_ -> ~005f, espaco -> ~0020), e o
 * id volta a dizer de qual caminho veio. O caminho sem _ nem caractere especial guarda o id de antes. O _ solto so
 * sai do prefixo: o id so de digitos, so de pontos (.. sairia de revisao/) ou vazio ganha _ na frente.
 * O id comprido (o ç vira 5 caracteres, e o nome de uma pasta tem teto de 255) fica nos primeiros ID_CORTE caracteres,
 * mais ~~ e o FNV-1a do caminho inteiro: o ~ do codigo sempre vem antes de 4 digitos, e ~~ so sai daqui.
 */
const ID_LONGO = 150;
const ID_CORTE = 140;
function idDoArquivo(rel) {
  const s = String(rel == null ? '' : rel);
  let id = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '/') id += '__';
    else if (/[a-zA-Z0-9.-]/.test(ch)) id += ch;
    else id += '~' + s.charCodeAt(i).toString(16).padStart(4, '0');
  }
  if (id.length > ID_LONGO) id = id.slice(0, ID_CORTE) + '~~' + semente(s).toString(16).padStart(8, '0');
  return /^(\d+|\.*)$/.test(id) ? '_' + id : id;
}

/**
 * O id de antes da A3-12b: o _ e todo caractere fora de [a-zA-Z0-9._-] viravam _. So para achar a base antiga; null
 * quando o id de antes so tem pontos ou e vazio (revisao/.. e a pasta de cima, nunca uma base).
 */
function idDeAntes(rel) {
  const id = String(rel == null ? '' : rel).split('/').join('__').replace(/[^a-zA-Z0-9._-]/g, '_');
  if (/^\.*$/.test(id)) return null;
  return /^\d+$/.test(id) ? '_' + id : id;
}

/**
 * O arquivo que o mapa.json de cada ronda numerada da base cita (com barra normal), ou null na ronda sem mapa legivel
 * ou sem `arquivo`. null no lugar da lista quando a base nao se le. Quem le a lista decide o que fazer com o null.
 */
function arquivosPorRonda(base) {
  let rondas = [];
  try {
    rondas = fs.readdirSync(base, { withFileTypes: true })
      .filter(function (e) { return e.isDirectory() && /^\d+$/.test(e.name); });
  } catch (e) {
    // a base que nao se le nao diz de quem e: quem chama trata o null
    return null;
  }
  return rondas.map(function (r) {
    try {
      let t = fs.readFileSync(path.join(base, r.name, 'mapa.json'), 'utf8');
      if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
      const m = JSON.parse(t);
      return m && typeof m.arquivo === 'string' ? m.arquivo.replace(/\\/g, '/') : null;
    } catch (e) {
      // a ronda sem mapa legivel nao diz de quem e: quem chama trata o null
      return null;
    }
  });
}

// 0.3.3, item 18: a regra do id em texto, para os avisos dos scripts. Mora ao lado do idDoArquivo, e um
// teste prende que o texto e a funcao concordam.
const REGRA_DO_ID = 'o caminho do arquivo revisado com cada / trocado por __ e cada caractere fora de ' +
  'letras sem acento, numeros, "." e "-" trocado por ~ e o seu codigo em 4 digitos hexadecimais, de 0 a 9 e de a a f (o _ vira ~005f, o espaco ' +
  '~0020, o ç ~00e7); o id feito so de numeros ou so de pontos ganha um _ na frente (2026 vira _2026), e o de ' +
  'mais de 150 caracteres fica nos 140 primeiros, mais ~~ e uma marca de 8 caracteres';

/**
 * A base das rondas de um arquivo: <revisao>/<id>. As rondas moram em <base>/<n>/.
 * A3-12b: a base com o id de antes, enquanto alguma ronda dela for deste arquivo e a nova nao existir, ainda e a dele:
 * o preparar-revisao.js a muda para o id novo (migrarBaseAntiga) antes de abrir a ronda seguinte, e ate la o
 * apurar-ronda.js a acha aqui. Tambem fica nela a base misturada, que o migrarBaseAntiga nao muda. Abrir a base nova
 * zeraria a contagem e daria mais 3 rondas ao mesmo arquivo.
 */
function baseDoArquivo(revisao, rel) {
  const id = idDoArquivo(rel);
  const nova = path.join(revisao, id);
  const antes = idDeAntes(rel);
  if (antes === null || antes === id || fs.existsSync(nova)) return nova;
  const antiga = path.join(revisao, antes);
  // o rel chega com barra normal (o preparar e o apurar o normalizam); a \ teria o seu proprio id, ~005c.
  // fail-closed para a base antiga: a base ou a ronda que nao se le nao prova que a revisao e deste arquivo
  return (arquivosPorRonda(antiga) || []).indexOf(rel) !== -1 ? antiga : nova;
}

/**
 * A3-12b: muda a base que mora no id de antes de `rel` para o id novo do arquivo que as rondas dela citam. Serve aos
 * dois lados de uma colisao: a base de a__b.js no id de antes (a__b.js) e tambem a pasta de a/b.js, e a de a_b.js
 * (id de antes a_b.js) so tem nome velho. Depois, cada arquivo fica com as suas rondas. So muda a base cujas rondas
 * todas citam um arquivo so, cujo id de antes e o nome da pasta, com o id novo diferente e a pasta nova ainda livre; a
 * base misturada (os dois arquivos ja somados) ou com ronda ilegivel fica como esta. O baseDoArquivo a segue dando ao
 * arquivo enquanto alguma ronda legivel o citar; com todas as rondas ilegiveis, nada prova de quem ela e, e o arquivo
 * abre a base do id novo, com a contagem do zero.
 * So a pasta do id de antes pode ser a base antiga de outro arquivo: o id de antes nunca tem ~ (o ~ virava _), e o id
 * novo que difere do de antes sempre tem.
 * Devolve null quando nada muda, { de, para } quando mudou, e { de, para, erro } quando o rename falhou: o
 * preparar-revisao.js para com ERRO, senao o outro arquivo cairia nas rondas desta base.
 */
function migrarBaseAntiga(revisao, rel) {
  const id = idDeAntes(rel);
  if (id === null) return null;
  const de = path.join(revisao, id);
  if (!fs.existsSync(de)) return null;
  const porRonda = arquivosPorRonda(de);
  // a ronda ilegivel (null) e diferente do dono, e a base com ela nao muda; todas ilegiveis, ou nenhuma ronda (dono
  // undefined), o id de antes do dono e null, e null nunca e o id
  if (!porRonda) return null;
  const dono = porRonda[0];
  if (porRonda.some(function (a) { return a !== dono; }) || idDeAntes(dono) !== id) return null;
  const para = path.join(revisao, idDoArquivo(dono));
  // o id novo igual ao de antes cai aqui tambem: a pasta de destino e a propria base
  if (fs.existsSync(para)) return null;
  try {
    fs.renameSync(de, para);
    return { de: de, para: para };
  } catch (e) {
    // fail-closed: quem chama recebe o erro e para; a base fica onde estava
    return { de: de, para: para, erro: e };
  }
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
 * F2c (D828): `extras` (opcional) = [{ ini, fim }], linhas de 1 a total que tambem ficam, sem margem: o contrato do
 * que o trecho usa e esta definido fora dele (scripts/lib/contrato.js). Extra que nao e inteiro >= 1, ou com fim antes
 * do ini, tambem devolve o texto como veio.
 */
function recortarTrecho(texto, blocos, margem, extras) {
  const linhas = String(texto).split('\n');
  const total = linhas[linhas.length - 1] === '' ? linhas.length - 1 : linhas.length;
  const fica = linhasDoTrecho(total, blocos, margem, extras);
  if (!fica) return texto;
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
 * F2c: a marca de cada linha do recorte (true = fica a mostra), de `total` linhas, pelos `blocos` com `margem` e pelos
 * `extras`; null quando nao ha bloco ou algum valor e invalido (quem chama devolve o texto inteiro). O contrato.js usa a
 * mesma marca para saber o que o inspetor ja ve.
 */
function linhasDoTrecho(total, blocos, margem, extras) {
  if (!Array.isArray(blocos) || blocos.length === 0) return null;
  const inteiro = function (n) { return Number.isInteger(n) && n >= 0; };
  if (!inteiro(margem) || !blocos.every(function (b) { return b && inteiro(b.ini) && inteiro(b.qtd); })) return null;
  const lista = extras === undefined ? [] : extras;
  if (!Array.isArray(lista) || !lista.every(function (e) {
    return e && Number.isInteger(e.ini) && Number.isInteger(e.fim) && e.ini >= 1 && e.fim >= e.ini;
  })) return null;
  const fica = new Array(total).fill(false);
  blocos.forEach(function (b) {
    const de = Math.max(1, b.ini - margem);
    const ate = Math.min(total, b.ini + Math.max(b.qtd, 1) - 1 + margem);
    for (let i = de; i <= ate; i++) fica[i - 1] = true;
  });
  lista.forEach(function (e) {
    for (let i = e.ini; i <= Math.min(total, e.fim); i++) fica[i - 1] = true;
  });
  return fica;
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

module.exports = { semente, rotular, proximaRonda, idDoArquivo, REGRA_DO_ID, baseDoArquivo, migrarBaseAntiga,
  temPastaNumeradaSolta,
  TRECHO_MARGEM, recortarTrecho, linhasDoTrecho, tipoDaReferencia, TETO_DA_REFERENCIA, montarReferencia };
