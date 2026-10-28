'use strict';

// Dez LENTES, nao dez copias do mesmo revisor.
// Dez copias acham o mesmo problema dez vezes; dez lentes acham dez classes de problema.
const LENTES = [
  { chave: 'correcao', titulo: 'Correcao e regressao',
    pergunta: 'Qual dos dois quebra? Entrada concreta que produz resultado errado, com arquivo:linha.' },
  { chave: 'escopo', titulo: 'Fidelidade ao pedido',
    pergunta: 'O que mudou alem do necessario? Renomeacao, extracao, formatacao junto de correcao funcional.' },
  { chave: 'estados', titulo: 'Estados obrigatorios (codigo)',
    pergunta: 'Erro, vazio, carregando, limite e timeout estao tratados, ou so o caso feliz?' },
  { chave: 'borda', titulo: 'Entrada e borda',
    pergunta: 'null, string vazia, lista vazia, numero negativo, unicode, caminho com espaco, arquivo enorme.' },
  { chave: 'seguranca', titulo: 'Seguranca e dado sensivel',
    pergunta: 'Segredo em texto, log com dado do usuario, entrada nao validada que vira comando ou caminho. ' +
      'Antes de P0, tres conferencias: (1) os chamadores reais, nao o caminho hipotetico; ' +
      '(2) leitura nao e mutacao; (3) desenho deliberado, padrao repetido e coerente no modulo, nao e falha. ' +
      'Sem confirmar a intencao, o achado nasce P2 com pergunta, nunca P0.' },
  { chave: 'manutencao', titulo: 'Legibilidade e manutencao',
    pergunta: 'O que um leitor novo entende errado? Nome que mente, funcao que faz duas coisas, erro engolido.' },
  { chave: 'microcopy', titulo: 'Texto que o usuario le',
    pergunta: 'Mensagem que nao diz o que fazer a seguir, jargao, ingles solto, tom que culpa o usuario.' },
  { chave: 'medidor', titulo: 'Mexeram no medidor',
    pergunta: 'Teste, baseline, threshold, skip ou mock mudaram junto com o codigo que eles cobrem?' },
  { chave: 'design', titulo: 'Fidelidade ao design system (codigo)',
    pergunta: 'Cite o token literal ou a tela irmã de referência. Valor cru, gradiente, sombra larga, card aninhado ou tipografia fluida onde o sistema nao os tem. Sem citar token ou coordenada, o veredito nao conta.' },
  // D553/D554 (0.9.0): a ideia do /ponytail-review, texto nosso. Regra de saida no revisar/SKILL.md (como `escopo`).
  { chave: 'enxuto', titulo: 'Codigo que nao precisava existir',
    pergunta: 'O que dava para nao escrever, e o que o substitui? Cite arquivo:linha do que sobra e do que ja faz o ' +
      'mesmo (funcao da linguagem, da plataforma, dependencia ja instalada, codigo do projeto). Validacao na ' +
      'fronteira, perda de dados, seguranca e acessibilidade nunca sao excesso.' }
];

// D121 mediu: 3 exatas, 1 parcial, 4 contra 4 sem contraparte. A causa nao e
// descuido - a familia de cima e de CODIGO, esta e de TELA. Decisao 8 (2026-09-23):
// convivem declaradas, nao se fundem. Chaves com sufixo para nunca colidir. F6-01 (D335): o titulo tambem
// nao se repete - o inspetor grava o titulo no campo lente, e o apurar casa a refutacao por esse texto -,
// entao os dois que as familias dividiam levam "(codigo)" e "(tela)".
const LENTES_UI = [
  { chave: 'ui-design', titulo: 'Fidelidade ao design system (tela)', pergunta: 'Cite o token literal ou a tela irma de referencia. Valor cru, gradiente, sombra larga, card aninhado ou tipografia fluida onde o sistema nao os tem.' },
  { chave: 'ui-estados', titulo: 'Estados obrigatorios (tela)', pergunta: 'Carregando, vazio, erro e limite estao desenhados, ou so o caso cheio?' },
  { chave: 'ui-responsivo', titulo: 'Responsividade e overflow', pergunta: 'Em qual largura o conteudo vaza, corta ou empilha errado? Diga a largura e o elemento.' },
  { chave: 'ui-a11y', titulo: 'Acessibilidade', pergunta: 'Contraste, alvo de toque, foco visivel, ordem de tabulacao, rotulo de campo e de botao de icone.' },
  { chave: 'ui-microcopy', titulo: 'Microcopy', pergunta: 'Texto que nao diz o que fazer a seguir, jargao, ingles solto, tom que culpa quem le.' },
  { chave: 'ui-antiref', titulo: 'Anti-referencias visuais', pergunta: 'O que parece template generico em vez do produto? Cite o elemento e a tela irma que faz melhor.' },
  { chave: 'ui-correcao', titulo: 'Correcao visual e regressao', pergunta: 'O que funcionava e parou de aparecer, ou aparece em lugar errado? Cite viewport e coordenada.' },
  { chave: 'ui-governanca', titulo: 'Governanca e permissao', pergunta: 'Superficie restrita renderizada sem a permissao que a habilita, ou dado sensivel visivel no print.' }
];

const FAMILIAS = { codigo: LENTES, ui: LENTES_UI };

// Arquivo so de logica (nao e de estilo e nao monta tela): estas saem da ronda 1. `design` pela decisao do dono de
// 2026-09-29; `medidor` e `escopo` pela D448 (ronda 1 de 41 revisoes: 11 de 13 e 5 de 6 achados refutados na fonte).
const SAEM_SO_LOGICA = ['design', 'medidor', 'escopo'];

// L2-ver-1 (S7, D426): sem acento e sem diferenca entre a forma composta e a decomposta (NFD separa as marcas, e
// elas saem): o inspetor escreve "Correção e regressão" e o titulo canonico e "Correcao e regressao".
function grafiaSolta(s) { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(); }

/**
 * A chave da lente a partir do que o inspetor escreveu. Em ordem: a chave exata, o titulo exato (so os espacos
 * das pontas saem) e, por fim, a grafia solta (caixa e acento nao contam) quando ela aponta uma lente so, entre
 * as duas familias. null quando nao e nenhuma lente conhecida ou quando a grafia solta serve a duas.
 * L2-ver-4 (S7, D426): "Microcopy" e o titulo da lente de tela e "microcopy" e a chave da de codigo; as formas
 * exatas separam as familias, e "MICROCOPY" nao se adivinha.
 * (Era do gravar-veredito.js; o apurar tambem precisa, RV-02 da D422.)
 */
function chaveDaLente(nome) {
  if (typeof nome !== 'string') return null;
  const todas = LENTES.concat(LENTES_UI);
  const exato = nome.trim();
  const chaveExata = todas.filter(function (l) { return l.chave === exato; });
  if (chaveExata.length === 1) return chaveExata[0].chave;
  const tituloExato = todas.filter(function (l) { return l.titulo === exato; });
  if (tituloExato.length === 1) return tituloExato[0].chave;
  const solta = new Set();
  todas.forEach(function (l) {
    if (grafiaSolta(l.chave) === grafiaSolta(nome) || grafiaSolta(l.titulo) === grafiaSolta(nome)) solta.add(l.chave);
  });
  return solta.size === 1 ? solta.values().next().value : null;
}

/** RV-02: a lente que entra na chave de repeticao e na comparacao da refutacao: a chave canonica, ou o texto normalizado. */
function lenteCanonica(nome) {
  return chaveDaLente(nome) || grafiaSolta(nome);
}

/**
 * A regra de despacho da spec (decisao 8), a mesma da tabela do /sworn:review: so codigo,
 * as 10; so tela, as 8; os dois, as 18. Nada declarado e duvida, e na duvida vao as duas
 * familias - nunca nenhuma, que seria uma revisao sem voto.
 */
function familiasPara(tocaCodigo, tocaTela) {
  if (tocaCodigo && !tocaTela) return ['codigo'];
  if (tocaTela && !tocaCodigo) return ['ui'];
  return ['codigo', 'ui'];
}

// D485 (s106): revisao proporcional ao diff. A faixa vem antes das familias: so comentario, numero ou frase curta
// = 1 inspetor; logica pequena com teste vermelho e mutacao = 2; texto = correcao + microcopy; arquivo novo ou
// logica grande = a tabela de familias (familiasPara). Os cortes 3 e 40 e a dupla correcao + borda sao escolha
// tecnica da s108, nao da D485. Sem medida, identico ao HEAD (nao ha diff para medir) ou estilo: a completa.
const FAIXA_UMA_ATE = 3;
const FAIXA_DUAS_ATE = 40;
const LENTES_DA_FAIXA = { uma: ['correcao'], duas: ['correcao', 'borda'], texto: ['correcao', 'microcopy'] };

function faixaDaMudanca(m) {
  const o = m || {};
  const n = o.linhasMudadas;
  if (o.novo || o.identico || o.estilo || !Number.isInteger(n) || n < 0) return 'completa';
  if (n <= FAIXA_UMA_ATE) return 'uma';
  if (o.texto) return 'texto';
  return n <= FAIXA_DUAS_ATE ? 'duas' : 'completa';
}

/** As chaves das lentes da faixa (copia), ou null na completa: ai vale a tabela de familias. */
function lentesDaFaixa(faixa) {
  return Object.prototype.hasOwnProperty.call(LENTES_DA_FAIXA, faixa) ? LENTES_DA_FAIXA[faixa].slice() : null;
}

const SEVERIDADES = ['P0', 'P1', 'P2'];
// Colheita 10-20, lote 3 (vereditos tipados) + 4a (LIDO/INFERIDO): confirmado = LIDO, com severidade e o trecho
// copiado do arquivo citado (o apurar-ronda.js confere no A.txt/B.txt); pendente = INFERIDO, com o fato exato que falta
// e sem severidade, e nao molha a ronda. Rejeitado e o refutados.json, com a prova de quem orquestra.
const ESTADOS = ['confirmado', 'pendente'];

// L3 (A3-03): a faixa completa nao tem lista fixa (a tabela de familias e do orquestrador); o menor numero dela e o do
// arquivo so de logica, as LENTES sem as de SAEM_SO_LOGICA.
const MINIMO_DA_COMPLETA = LENTES.length - SAEM_SO_LOGICA.length;

/** L3 (A3-03): o voto que falta para a apuracao (como a ronda vazia); o codigo deixa o CLI dizer so o que fazer. */
function votoQueFalta(texto) {
  const e = new Error(texto);
  e.codigo = 'VOTO_QUE_FALTA';
  return e;
}

// Ronda 1 do 8c.5: a lente entra na chave. Dois defeitos de lentes diferentes na mesma
// linha sao dois achados; a mesma lente repetindo o mesmo lugar segue sendo um. A
// severidade continua primeiro: o motivo do teto conta os abertos pelo prefixo P0| e P1|.
function chaveAchado(a, lente) {
  return [a.severidade, a.arquivo, a.linha, lente].join('|');
}

// D503/D508 (plano d503, E5): com referencia (R.txt no pacote), cada lado e julgado contra ela. O inspetor segue cego
// a qual lado e o novo; o apurar le o do trabalho pelo mapa.
const RESULTADOS_REFERENCIA = ['vence', 'empata', 'perde'];

// D223 e D228 (ronda 2 do 8c.10): o que invalida o veredito inteiro, e nao so um achado. O
// apurar-ronda.js para nestes, como no ilegivel, e o apurar os recusa; o validarVeredito os
// devolve junto dos erros de achado, que so descartam o achado.
// opcoes (opcional): { comReferencia } - true quando o pacote tem R.txt; ai vsReferencia e lacunas sao exigidos.
// Sem opcoes (ou com comReferencia falso), os dois campos nao se olham: e a regra da revisao sem referencia.
function errosDoVeredito(vd, opcoes) {
  if (!vd || typeof vd !== 'object') return ['veredito nao e objeto'];
  const erros = [];
  if (!vd.lente) erros.push('veredito sem lente');
  if (['A', 'B', 'empate'].indexOf(vd.melhor) === -1) erros.push('melhor tem de ser A, B ou empate');
  if (!Array.isArray(vd.achados)) erros.push('achados tem de ser lista, vazia quando nao ha achado');
  // Lote 3/4a: sem estado o veredito e do formato de antes, e para a apuracao (descartar o achado secaria a ronda).
  const semEstado = Array.isArray(vd.achados) ? vd.achados.filter(function (a) {
    return !a || ESTADOS.indexOf(a.estado) === -1;
  }).length : 0;
  if (semEstado) {
    erros.push(semEstado + ' achado(s) sem estado: cada achado e "confirmado" (com severidade e o trecho copiado do ' +
      'arquivo citado) ou "pendente" (com o fato que falta em "falta", sem severidade); regrave o veredito');
  }
  // R3 do lote 3/4a (D672): o confirmado sem trecho tambem para a apuracao, pelo mesmo motivo.
  const semTrecho = Array.isArray(vd.achados) ? vd.achados.filter(function (a) {
    return a && a.estado === 'confirmado' && (typeof a.trecho !== 'string' || a.trecho.trim() === '');
  }).length : 0;
  if (semTrecho) {
    erros.push(semTrecho + ' achado(s) confirmado(s) sem trecho: copie do arquivo citado o texto da linha que mostra ' +
      'o defeito, ou marque o achado como "pendente"; regrave o veredito');
  }
  if (opcoes && opcoes.comReferencia) {
    const vs = vd.vsReferencia;
    if (!vs || typeof vs !== 'object' || Array.isArray(vs) || RESULTADOS_REFERENCIA.indexOf(vs.A) === -1 ||
        RESULTADOS_REFERENCIA.indexOf(vs.B) === -1) {
      // Plano 082, Tarefa 5 (p2-16): a lente diz qual veredito regravar.
      erros.push('vsReferencia' + (vd.lente ? ' da lente "' + String(vd.lente) + '"' : '') + ' tem de ser { "A": ..., ' +
        '"B": ... }, cada um vence, empata ou perde contra a referencia (o pacote tem R.txt)');
    }
    if (!Array.isArray(vd.lacunas)) erros.push('lacunas tem de ser lista, vazia quando nada separa os lados da referencia');
  }
  return erros;
}

/**
 * RV-03: a linha como inteiro >= 1, ou null. Aceita inteiro, texto "42" e intervalo "40-45" / "40-45 com travessao".
 * L2-ver-2 (S7, D426): o intervalo vale pelo MENOR numero, escrito em qualquer ordem ("45-40" tambem e 40); o
 * menor tem de ser linha valida, entao "0-5" e descartado em vez de virar 5 calado.
 */
function linhaDoAchado(linha) {
  if (Number.isInteger(linha)) return linha >= 1 ? linha : null;
  if (typeof linha !== 'string') return null;
  const m = /^\s*(\d+)(?:\s*[-\u2013\u2014]\s*(\d+))?\s*$/.exec(linha);
  const n = m ? Math.min(parseInt(m[1], 10), m[2] === undefined ? Infinity : parseInt(m[2], 10)) : 0;
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/** L3 (A3-05): o achado (ou lacuna) com a severidade sem espaco nas pontas e em maiuscula; o resto como veio. */
function severidadeCanonica(x) {
  if (!x || typeof x.severidade !== 'string') return x;
  const s = x.severidade.trim().toUpperCase();
  return s === x.severidade ? x : Object.assign({}, x, { severidade: s });
}

/** O comeco da descricao do achado descartado, para a mensagem; sem descricao, diz isso (e nao "undefined"). */
function trechoDaDescricao(d) {
  return d === undefined || d === null || String(d).trim() === '' ? '(sem descricao)' : String(d).slice(0, 60);
}

/**
 * Os erros do veredito e os achados (e lacunas) que valem. opcoes: as do errosDoVeredito - com comReferencia, as
 * lacunas sao conferidas e sobem em lacunasValidas; sem ela, lacunasValidas sai vazia mesmo que o veredito traga
 * lacunas (sem R.txt nao ha contra o que comparar).
 */
function validarVeredito(vd, opcoes) {
  const erros = errosDoVeredito(vd, opcoes);
  const validos = [];
  const lacunas = [];
  const pendentes = [];
  if (!vd || typeof vd !== 'object') {
    return { ok: false, erros: erros, achadosValidos: [], lacunasValidas: [], pendentesValidos: [] };
  }

  for (const bruto of (vd.achados || [])) {
    if (bruto && bruto.estado === 'pendente') {
      const linhaP = linhaDoAchado(bruto.linha);
      if (bruto.severidade !== undefined && bruto.severidade !== null && bruto.severidade !== '') {
        erros.push('achado pendente com severidade (o pendente nao tem severidade: confirme com o trecho, ou tire a ' +
          'severidade), descartado: ' + trechoDaDescricao(bruto.descricao));
      } else if (!bruto.arquivo || linhaP === null) {
        erros.push('achado pendente sem arquivo:linha valido, descartado: ' + trechoDaDescricao(bruto.descricao));
      } else if (!bruto.descricao || String(bruto.descricao).trim() === '') {
        erros.push('achado pendente sem descricao, descartado');
      } else if (typeof bruto.falta !== 'string' || bruto.falta.trim() === '') {
        erros.push('achado pendente sem falta (o fato exato que confirmaria o achado), descartado: ' +
          trechoDaDescricao(bruto.descricao));
      } else {
        pendentes.push(linhaP === bruto.linha ? bruto : Object.assign({}, bruto, { linha: linhaP }));
      }
      continue;
    }
    // L3 (A3-05): "p1" e " P1 " sao P1; antes o achado saia descartado e a ronda seca.
    const a = severidadeCanonica(bruto);
    if (SEVERIDADES.indexOf(a && a.severidade) === -1) {
      erros.push('achado com severidade invalida: ' + (a && a.severidade));
      continue;
    }
    // Anti-teatro: sem arquivo:linha, o voto nao conta. D396 n. 37/38: linha a partir de 1, como a da
    // refutacao (conferirRefutados); o achado de linha 0 molhava a ronda e nao tinha como ser refutado.
    // RV-03 (D422): "42" e "40-45" tambem sao arquivo:linha - viram 42 e 40 (o menor do intervalo). Sem numero, segue descartado.
    const linha = linhaDoAchado(a.linha);
    if (!a.arquivo || linha === null) {
      erros.push('achado sem arquivo:linha valido (a linha e um numero inteiro a partir de 1; "42" e "40-45" tambem valem; sem numero nenhum, nao conta), descartado: ' + trechoDaDescricao(a.descricao));
      continue;
    }
    if (!a.descricao || String(a.descricao).trim() === '') {
      erros.push('achado sem descricao, descartado');
      continue;
    }
    if (typeof a.trecho !== 'string' || a.trecho.trim() === '') {
      erros.push('achado confirmado sem trecho (copie do arquivo citado o texto da linha que mostra o defeito), ' +
        'descartado: ' + trechoDaDescricao(a.descricao));
      continue;
    }
    validos.push(linha === a.linha ? a : Object.assign({}, a, { linha: linha }));
  }
  // D503 (E5): a lacuna para a referencia segue o anti-teatro do achado, e cita o lado que fica atras (A ou B).
  if (opcoes && opcoes.comReferencia && Array.isArray(vd.lacunas)) {
    for (const brutaL of vd.lacunas) {
      const l = severidadeCanonica(brutaL);
      if (SEVERIDADES.indexOf(l && l.severidade) === -1) {
        erros.push('lacuna com severidade invalida: ' + (l && l.severidade));
        continue;
      }
      const linha = linhaDoAchado(l.linha);
      if (rotuloDoArquivo(l.arquivo) === null || linha === null) {
        erros.push('lacuna sem arquivo:linha valido (o arquivo e A.txt ou B.txt, o lado que fica atras da referencia), ' +
          'descartada: ' + trechoDaDescricao(l.descricao));
        continue;
      }
      if (!l.descricao || String(l.descricao).trim() === '') {
        erros.push('lacuna sem descricao, descartada');
        continue;
      }
      lacunas.push(linha === l.linha ? l : Object.assign({}, l, { linha: linha }));
    }
  }
  return { ok: erros.length === 0, erros: erros, achadosValidos: validos, lacunasValidas: lacunas,
    pendentesValidos: pendentes };
}

const TETO = 3;

/**
 * D244/defeito 3: `A.txt`, `B.txt` ou um caminho que termina neles -> 'A' | 'B' | null.
 * T14: o que vem depois do nome (`A.txt:120`, `A.txt linha 45`, `A.txt#L12`) nao tira o lado; sem
 * isso o achado do lado antigo voltava a contar. Os dois rotulos na mesma citacao: sem lado.
 * D246: antes do nome, qualquer nao-palavra e fronteira - `A.txt,B.txt` dava `A`.
 */
function rotuloDoArquivo(arquivo) {
  const re = /(?<![\w.])([AB])\.txt(?![\w.])/gi;
  const achados = new Set();
  let m;
  while ((m = re.exec(String(arquivo == null ? '' : arquivo))) !== null) achados.add(m[1].toUpperCase());
  return achados.size === 1 ? achados.values().next().value : null;
}

function mesmaLente(a, b) {
  return lenteCanonica(a) === lenteCanonica(b);
}

/** D244/defeito 3: refutar tambem exige citar. Refutacao sem prova derruba a apuracao. */
function conferirRefutados(refutados) {
  const lista = Array.isArray(refutados) ? refutados : [];
  for (let i = 0; i < lista.length; i++) {
    const r = lista[i];
    // F6-03: o que nao e objeto (null, numero, texto, lista) nao e uma refutacao sem prova: e a forma errada.
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      throw new Error('entrada invalida no refutados.json (posicao ' + (i + 1) + '): cada refutacao e um objeto ' +
        '{ ronda, lente, arquivo, linha, severidade, prova }');
    }
    if (typeof r.prova !== 'string' || r.prova.trim() === '') {
      throw new Error('refutacao sem prova (ronda ' + (r && r.ronda) + ', lente ' + (r && r.lente) + ', linha ' +
        (r && r.linha) + '): cite a fonte primaria - arquivo:linha ou o comando - em "prova"');
    }
    const onde = ' (ronda ' + r.ronda + ', lente ' + r.lente + ', linha ' + r.linha + '): ';
    // T14: sem o lado, a refutacao casava por null === null com achado que tambem nao citava A nem B.
    if (rotuloDoArquivo(r.arquivo) === null) {
      throw new Error('refutacao sem arquivo' + onde + '"arquivo" tem de ser A.txt ou B.txt, como o achado que ela refuta');
    }
    // T14 ronda 2: `linha: true` virava 1 por coercao e derrubava o achado da linha 1.
    if (!Number.isInteger(r.ronda) || r.ronda < 1) {
      throw new Error('refutacao com ronda invalida' + onde + '"ronda" tem de ser o numero inteiro da ronda, a partir de 1');
    }
    if (!Number.isInteger(r.linha) || r.linha < 1) {
      throw new Error('refutacao com linha invalida' + onde + '"linha" tem de ser o numero inteiro da linha do achado');
    }
    if (typeof r.lente !== 'string' || r.lente.trim() === '') {
      throw new Error('refutacao sem lente' + onde + '"lente" tem de ser o texto da lente, como no veredito');
    }
    // D246: sem a severidade, refutar o P1 de uma linha apagava o P0 da mesma lente e linha.
    if (SEVERIDADES.indexOf(r.severidade) === -1) {
      throw new Error('refutacao sem severidade' + onde + '"severidade" tem de ser P0, P1 ou P2, a do achado que ela refuta');
    }
    // D503 (E7): o A.txt da 2a passada (invertida/) e outro arquivo que o da 1a; a refutacao diz de qual passada e.
    if (r.passada !== undefined && r.passada !== 1 && r.passada !== 2) {
      throw new Error('refutacao com passada invalida' + onde + '"passada" e 2 para achado da 2a passada (invertida/), ' +
        'ou fica fora do objeto');
    }
  }
  return lista;
}

function refutado(lista, ronda, lente, a, passada) {
  return lista.some(function (r) {
    return r.ronda === ronda && mesmaLente(r.lente, lente) && r.linha === a.linha && r.severidade === a.severidade &&
      rotuloDoArquivo(r.arquivo) === rotuloDoArquivo(a.arquivo) && (r.passada || 1) === passada;
  });
}

// O peso de cada resultado contra a referencia: quanto maior, pior. O pior entre lados e vereditos e o que vale.
const PESO_REFERENCIA = { vence: 0, empata: 1, perde: 2 };

/**
 * D503 (E6): o resultado do lado trabalho contra a referencia numa passada: o pior dos lados que o mapa diz trabalho
 * (os dois, quando o arquivo e identico ao HEAD). null quando nenhum lado e trabalho. O mapa chega sempre conferido:
 * o apurar recusa a ronda com referencia cujo mapa nao passa no mapaDoTrabalho antes de chamar esta funcao.
 */
function vsDoTrabalho(vs, mapa) {
  let pior = null;
  for (const rot of ['A', 'B']) {
    if (mapa[rot] !== 'trabalho') continue;
    if (pior === null || PESO_REFERENCIA[vs[rot]] > PESO_REFERENCIA[pior]) pior = vs[rot];
  }
  return pior;
}

/**
 * Plano 082 (p2-6, p2-7): com referencia, o mapa de cada passada tem de dizer o lado dos dois rotulos ("trabalho" ou
 * "HEAD") e ter ao menos um trabalho. Sem isso o resultado contra a referencia ficava "incompleta" calado (nunca
 * aprovava) e o achado de um rotulo sem lado caia na chave por arquivo, igual nas duas passadas.
 */
function mapaDoTrabalho(mapa) {
  if (!mapa || typeof mapa !== 'object' || Array.isArray(mapa)) return false;
  const lado = function (v) { return v === 'trabalho' || v === 'HEAD'; };
  return lado(mapa.A) && lado(mapa.B) && (mapa.A === 'trabalho' || mapa.B === 'trabalho');
}

/** D503 (E6): as duas ordens viram um resultado: perde em alguma = perde; vence nas duas = vence; o resto, empata. */
function resultadoDasDuasOrdens(o1, o2) {
  if (o1 === null || o2 === null) return 'incompleta';
  if (o1 === 'perde' || o2 === 'perde') return 'perde';
  return o1 === 'vence' && o2 === 'vence' ? 'vence' : 'empata';
}

// D387 (#11c): dois achados do mesmo arquivo a ate 10 linhas um do outro viram "par candidato" para o
// juiz de mesmo defeito. Distancia 10 entra; 11 fica fora.
const DISTANCIA_PAR = 10;
const RESPOSTAS_MESMO = ['sim', 'nao', 'nao-sei'];

/**
 * D387 (#11c): o mesmos.json e a resposta do juiz-mesmo: [{ novo, outro, resposta }], com as chaves de
 * achado que o apurar usa. Molde do conferirRefutados: o que nao tem a forma certa para, com a posicao.
 * `chavesExistentes` e o conjunto de chaves dos achados apurados (Set ou lista).
 */
function conferirMesmos(lista, chavesExistentes) {
  if (!Array.isArray(lista)) {
    throw new Error('mesmos.json nao e uma lista (veio ' + (lista === null ? 'null' : typeof lista) + '): a forma e ' +
      'uma lista de { novo, outro, resposta }, e [] quando o juiz nao achou par');
  }
  const existentes = chavesExistentes instanceof Set ? chavesExistentes : new Set(chavesExistentes || []);
  for (let i = 0; i < lista.length; i++) {
    const m = lista[i];
    const onde = 'entrada invalida no mesmos.json (posicao ' + (i + 1) + '): ';
    if (!m || typeof m !== 'object' || Array.isArray(m)) {
      throw new Error(onde + 'cada item e um objeto { "novo": "<chave>", "outro": "<chave>", "resposta": "sim" | "nao" | "nao-sei" }');
    }
    for (const campo of ['novo', 'outro']) {
      if (typeof m[campo] !== 'string' || m[campo].trim() === '') {
        throw new Error(onde + '"' + campo + '" tem de ser o texto da chave do achado, copiada de paresCandidatos');
      }
      if (!existentes.has(m[campo])) {
        throw new Error(onde + '"' + campo + '" (' + m[campo] + ') nao e a chave de nenhum achado apurado; copie a chave ' +
          'exatamente como veio em paresCandidatos');
      }
    }
    // D396 n. 41: a forma (a resposta) antes do sentido (a mesma chave), como os campos acima.
    if (RESPOSTAS_MESMO.indexOf(m.resposta) === -1) {
      throw new Error(onde + '"resposta" tem de ser "sim", "nao" ou "nao-sei" (veio ' + JSON.stringify(m.resposta) + ')');
    }
    // D391: um achado nao e par dele mesmo (paresCandidatos nunca o lista); sem isto saia o aviso
    // "provavel mesmo defeito que" a propria chave.
    if (m.novo === m.outro) {
      throw new Error(onde + '"novo" e "outro" sao a mesma chave (' + m.novo + '); copie o par exatamente como veio em ' +
        'paresCandidatos');
    }
  }
  return lista;
}

/**
 * D475 (s99): a chave de repeticao de um achado, olhando o texto da linha citada.
 * variantesDaChave: Map kBase -> [{ texto, chave }], um item por texto ja visto naquela chave (o primeiro leva
 * a propria kBase). Devolve a chave a usar:
 *   - primeira vez da kBase: kBase;
 *   - texto igual a um ja visto: a chave daquele texto (repeticao);
 *   - texto diferente de todos: kBase + "|r<ronda>" (linha reescrita = achado novo);
 *   - sem texto (bruto que nao e string), agora ou em alguma vez anterior: kBase, a conta de antes da D475.
 */
function chavePeloTexto(kBase, bruto, variantesDaChave, ronda) {
  const texto = typeof bruto === 'string' ? bruto.replace(/\s+/g, ' ').trim() : null;
  const variantes = variantesDaChave.get(kBase);
  if (!variantes) {
    variantesDaChave.set(kBase, [{ texto: texto, chave: kBase }]);
    return kBase;
  }
  const igual = variantes.find(function (x) { return x.texto === texto; });
  if (igual) return igual.chave;
  if (texto === null || variantes.some(function (x) { return x.texto === null; })) return kBase;
  const chave = kBase + '|r' + ronda;
  variantes.push({ texto: texto, chave: chave });
  return chave;
}

function descricaoNormal(d) {
  return String(d).replace(/\s+/g, ' ').trim();
}

/**
 * rondas: lista de rondas; cada ronda e uma lista de vereditos.
 * Ronda seca = zero achado NOVO de P1 ou acima.
 * D244/defeito 3 - opcoes (opcional; sem ela a conta e a de antes):
 *   mapas[i]   = { A: 'trabalho'|'HEAD', B: ... } da ronda i (o mapa.json). Com ele, so P0/P1 do
 *                lado 'trabalho' molha; os do lado 'HEAD' saem em achadosDoLadoAntigo. A chave
 *                passa a ser pelo LADO: o rotulo A/B e sorteado a cada ronda.
 *   refutados  = [{ ronda, lente, arquivo, linha, severidade, prova, passada? }]: achado refutado na fonte
 *                primaria nao molha. Sem `prova` ou sem `severidade`, lanca erro. `passada` e 2 para o achado
 *                da ordem trocada (invertida/); sem ela, vale a 1a.
 *   mesmos     = [{ novo, outro, resposta }] (D387, #11c): so ALIMENTA provaveisMesmos; nao entra em
 *                secas, encerrar, motivo, novos, abertos nem no teto. A palavra do juiz e aviso, nao prova.
 *   textoDaLinha(indiceDaRonda, rotulo, linha, passada) -> texto ou null (D475): com ele, a mesma chave sobre um
 *                texto diferente do ja visto vira achado novo (chave + "|r<ronda>"); texto igual segue repeticao.
 *   invertidas[i] = { mapa, vereditos } (D503, E6-E8): a 2a passada (A/B trocados) da ronda i com referencia. Os
 *                vereditos das duas passadas exigem vsReferencia e lacunas, e os mapas das duas passadas exigem o
 *                lado de A e de B (mapaDoTrabalho); os achados da 2a contam pelo mapa dela e saem com passada 2. Sai `referencia` (null sem ela): { pronta, lentes, lacunas, lentesAtras };
 *                com a ultima ronda fora da referencia, duas secas nao aprovam.
 *   faixas[i]  = a faixa do mapa.json da ronda i (L3, A3-03). Com a da ronda 1: a ronda 1 sem as lentes da faixa (na
 *                completa, menos de MINIMO_DA_COMPLETA lentes conhecidas) e a ronda sem a lente que achou P0/P1 do lado
 *                novo na anterior lancam erro com codigo VOTO_QUE_FALTA.
 *   trechoNoArquivo(indiceDaRonda, rotulo, linha, trecho, passada) -> true | false | null (lote 3/4a): false tira o
 *                confirmado da conta e o poe em trechoNaoConfere; true ou null (sem como ler o arquivo) conta como antes.
 *                Sem a funcao, nada se confere: o erro de quem chama cai do lado de molhar a ronda, nunca de seca-la.
 * pendentes e trechoNaoConfere saem sempre (listas, vazias quando nao ha), de todas as rondas, com ronda e lente.
 * paresCandidatos sai sempre: achado P0/P1 novo da ultima ronda x outro achado do lado novo, mesmo
 * arquivo (o lado, com mapa; o rotulo, sem), a ate DISTANCIA_PAR linhas, chave diferente.
 */
function apurar(rondas, opcoes) {
  // F2-14: sem nenhuma ronda nao ha o que apurar (antes saia "ronda 1 chama so as lentes..." sem ronda nenhuma).
  if (!Array.isArray(rondas) || rondas.length === 0) throw new Error('nenhuma ronda para apurar');
  const op = opcoes || {};
  const mapas = Array.isArray(op.mapas) ? op.mapas : [];
  const refutados = conferirRefutados(op.refutados);
  const vistos = new Set();
  const variantesDaChave = new Map();
  // D602: chave sem ordinal -> as descricoes ja vistas nela, na ordem do ordinal (a 1a e a base)
  const historicoDaChave = new Map();
  const abertos = new Set();
  let secas = 0;
  let novosDaUltima = [];
  let novosChavesDaUltima = [];
  let antigosDaUltima = [];
  // D387: todo achado valido visto (chave -> o que o juiz le) e, a parte, os do lado novo em ordem.
  const metas = new Map();
  const doLadoNovo = [];
  const placar = { A: 0, B: 0, empate: 0 };
  // D503 (E6/E8): invertidas[i] = { mapa, vereditos } da 2a passada (ordem A/B trocada) da ronda com referencia.
  const invertidas = Array.isArray(op.invertidas) ? op.invertidas : [];
  // lente -> o resultado contra a referencia na ultima ronda que a chamou
  const refLentes = new Map();
  let ultimaComReferencia = false;
  // Lote 3/4a: os pendentes (nao molham) e os confirmados cujo trecho nao esta no arquivo citado (nao contam), de
  // todas as rondas, para quem orquestra ler.
  const pendentes = [];
  const trechoNaoConfere = [];

  // L3 (A3-03): com a faixa da ronda 1 (o mapa.json do preparar-revisao.js a grava), o script confere as lentes; sem
  // ela (base de antes), a conta de antes.
  const faixa1 = Array.isArray(op.faixas) && typeof op.faixas[0] === 'string' ? op.faixas[0] : null;
  let lentesComNovosAntes = new Set();
  function conferirLentes(indice, ronda, comNovosAntes) {
    const presentes = new Set(ronda.map(function (vd) { return vd && lenteCanonica(vd.lente); }));
    const conhecidas = Array.from(presentes).filter(function (l) { return l && chaveDaLente(l) !== null; });
    const grave = 'grave o veredito de cada uma na pasta vereditos da ronda ' + (indice + 1) +
      ' (Passo 2 do /sworn:review) e rode de novo';
    if (indice === 0) {
      const esperadas = lentesDaFaixa(faixa1);
      const faltam = esperadas ? esperadas.filter(function (l) { return !presentes.has(l); }) : [];
      if (faltam.length) {
        throw votoQueFalta('ronda 1 da faixa ' + faixa1 + ' sem o voto da(s) lente(s) ' + faltam.join(', ') +
          ': a ronda 1 chama todas as lentes da faixa; ' + grave);
      }
      if (!esperadas && conhecidas.length < MINIMO_DA_COMPLETA) {
        throw votoQueFalta('ronda 1 da faixa ' + faixa1 + ' com ' + conhecidas.length + ' lente(s) conhecida(s) (' +
          (conhecidas.join(', ') || 'nenhuma') + '): o minimo e ' + MINIMO_DA_COMPLETA + ' (a tabela de familias do ' +
          'Passo 2 do /sworn:review); chame as que faltam, ' + grave);
      }
      return;
    }
    const naoVoltaram = Array.from(comNovosAntes).filter(function (l) { return !presentes.has(l); });
    if (naoVoltaram.length) {
      throw votoQueFalta('ronda ' + (indice + 1) + ' sem o voto da(s) lente(s) que acharam P0/P1 do lado novo na ronda ' +
        indice + ': ' + naoVoltaram.join(', ') + '. A ronda seguinte confere o proprio achado (Passo 4 do ' +
        '/sworn:review): ' + grave + '. Achado refutado na fonte vai em refutados.json e nao obriga a lente a voltar');
    }
  }

  rondas.forEach(function (ronda, indice) {
    const novos = [];
    const novosChaves = [];
    const antigos = [];
    const lentesComNovos = new Set();
    const mapa = mapas[indice] && typeof mapas[indice] === 'object' ? mapas[indice] : null;
    const inv = invertidas[indice] && typeof invertidas[indice] === 'object' ? invertidas[indice] : null;
    const comReferencia = inv !== null;
    // 0.3.3, item 1: ronda sem nenhum veredito nao e ronda seca - e voto que falta. Sem isto,
    // `apurar([[], []])` fechava aprovado. Diz qual ronda; o apurar-ronda.js confere a pasta antes.
    if (!Array.isArray(ronda) || ronda.length === 0) {
      throw new Error('ronda ' + (indice + 1) + ' sem nenhum veredito: ronda sem voto nao e ronda seca, e nao se apura; ' +
        'grave os vereditos da ronda ' + (indice + 1) + ' na pasta vereditos dela e rode de novo');
    }
    if (comReferencia && (!Array.isArray(inv.vereditos) || inv.vereditos.length === 0)) {
      throw new Error('ronda ' + (indice + 1) + ' com referencia sem nenhum veredito da 2a passada (invertida/vereditos): ' +
        'a ordem trocada e metade do voto; grave os vereditos da 2a passada e rode de novo');
    }
    if (comReferencia) {
      for (const [mapaDaPassada, ordem] of [[mapa, ''], [inv.mapa, ' (com A e B trocados)']]) {
        if (mapaDoTrabalho(mapaDaPassada)) continue;
        throw new Error('ronda ' + (indice + 1) + ordem + ' sem o mapa que diz qual lado e o trabalho ({ "A": "trabalho" ' +
          'ou "HEAD", "B": ... }, com ao menos um trabalho): sem ele a comparacao com a referencia nunca fecha. Prepare ' +
          'a ronda de novo (Passo 1 do /sworn:review) e rode de novo');
      }
    }
    const mapaInv = comReferencia ? inv.mapa : null;
    const daRonda = new Map();
    const passadas = comReferencia ? [[ronda, mapa, 1], [inv.vereditos, mapaInv, 2]] : [[ronda, mapa, 1]];
    for (const [lista, mapaP, passada] of passadas) {
      for (const vd of lista) {
        // D230: o que nao e veredito nao e voto sem achado - seria ronda seca por falta de voto. O
        // apurar-ronda.js para antes de chegar aqui; quem chamar direto recebe o erro, com o motivo.
        const invalido = errosDoVeredito(vd, { comReferencia: comReferencia });
        if (invalido.length) {
          // Plano 082, Tarefa 5 (p2-16): a ronda, a ordem dos lados sem giria e a lente - qual veredito regravar.
          throw new Error('veredito que nao e veredito na ronda ' + (indice + 1) + (passada === 2 ? ' (com A e B trocados)' : '') +
            (vd && vd.lente ? ', lente "' + String(vd.lente) + '"' : '') + ': ' + invalido.join('; '));
        }
        const r = validarVeredito(vd, { comReferencia: comReferencia });
        // O placar (qual rotulo saiu melhor) conta so a ordem normal: a ordem trocada julga os mesmos dois arquivos
        // com os rotulos invertidos, e somar as duas contaria cada lente duas vezes, uma em cada rotulo.
        if (passada === 1 && indice === rondas.length - 1 && placar[vd.melhor] !== undefined) placar[vd.melhor] += 1;
        // RV-02 (D422): a chave leva a lente CANONICA; "Correcao e regressao" e "correcao" sao a mesma lente.
        const lenteChave = lenteCanonica(vd.lente);
        if (comReferencia) {
          if (!daRonda.has(lenteChave)) daRonda.set(lenteChave, { ordem1: null, ordem2: null, lacunas: [] });
          const daLente = daRonda.get(lenteChave);
          const campo = passada === 1 ? 'ordem1' : 'ordem2';
          const resultado = vsDoTrabalho(vd.vsReferencia, mapaP);
          if (resultado !== null && (daLente[campo] === null || PESO_REFERENCIA[resultado] > PESO_REFERENCIA[daLente[campo]])) {
            daLente[campo] = resultado;
          }
          for (const lacuna of r.lacunasValidas) {
            // so a lacuna do trabalho barra a referencia: a do lado HEAD e o que ja estava atras antes da mudanca
            if (mapaP[rotuloDoArquivo(lacuna.arquivo)] !== 'trabalho') continue;
            daLente.lacunas.push({ lente: lenteChave, ronda: indice + 1, passada: passada, severidade: lacuna.severidade,
              arquivo: lacuna.arquivo, linha: lacuna.linha, descricao: lacuna.descricao });
          }
        }
        // L3 (A3-01): no MESMO veredito, a mesma chave com outra descricao e outro defeito, nao repeticao: leva o
        // ordinal (|n2, |n3...). A mesma descricao repetida segue um achado so (D387/pares).
        // D602 (revisao L3 R3): o ordinal sai do historico da chave entre rondas, nao da ordem do veredito. A descricao
        // ja vista fica com o ordinal dela; com 2 ou mais descricoes na chave no veredito, a que nao bate ganha ordinal
        // novo (ali nenhum defeito some; 2 repetidos reescritos molham - custo aceito). Uma descricao so, que nao bate,
        // fica na base e conta como reescrita: um defeito novo SOZINHO na linha de um ja visto some (desenho D475).
        const semOrdem = function (a) {
          const rotulo = rotuloDoArquivo(a.arquivo);
          const lado = mapaP && rotulo ? mapaP[rotulo] : null;
          return lado ? [a.severidade, lado, a.linha, lenteChave].join('|') : chaveAchado(a, lenteChave);
        };
        const marca = function (x) {
          return Object.assign({ ronda: indice + 1, lente: lenteChave }, passada === 2 ? { passada: 2 } : {}, x);
        };
        for (const p of r.pendentesValidos) pendentes.push(marca(p));
        // Lote 3/4a: o confirmado cujo trecho nao esta no arquivo citado nao conta (nem para o ordinal); sem como ler o
        // arquivo (null), conta como antes.
        const achados = r.achadosValidos.filter(function (a) {
          const rotulo = rotuloDoArquivo(a.arquivo);
          if (typeof op.trechoNoArquivo !== 'function' || !rotulo ||
              op.trechoNoArquivo(indice, rotulo, a.linha, a.trecho, passada) !== false) return true;
          trechoNaoConfere.push(marca({ severidade: a.severidade, arquivo: a.arquivo, linha: a.linha, trecho: a.trecho,
            descricao: a.descricao }));
          return false;
        });
        const grupos = new Map();
        for (const a of achados) {
          const k = semOrdem(a);
          if (!grupos.has(k)) grupos.set(k, []);
          const g = grupos.get(k);
          const d = descricaoNormal(a.descricao);
          if (g.indexOf(d) === -1) g.push(d);
        }
        const vezDaDescricao = new Map();
        grupos.forEach(function (descricoes, k) {
          const historico = historicoDaChave.get(k);
          if (!historico) historicoDaChave.set(k, descricoes.slice());
          descricoes.forEach(function (d, i) {
            let vez = historico ? historico.indexOf(d) : i;
            if (vez === -1 && descricoes.length === 1) vez = 0;
            else if (vez === -1) vez = historico.push(d) - 1;
            vezDaDescricao.set(k + '\n' + d, vez + 1);
          });
        });
        for (const a of achados) {
          const rotulo = rotuloDoArquivo(a.arquivo);
          const lado = mapaP && rotulo ? mapaP[rotulo] : null;
          const kSemOrdem = semOrdem(a);
          const vez = vezDaDescricao.get(kSemOrdem + '\n' + descricaoNormal(a.descricao));
          const kBase = vez === 1 ? kSemOrdem : kSemOrdem + '|n' + vez;
          // D475 (s99): a mesma chave sobre uma linha REESCRITA entre rondas e evidencia nova, nao repeticao.
          const bruto = typeof op.textoDaLinha === 'function' && rotulo ? op.textoDaLinha(indice, rotulo, a.linha, passada) : null;
          const k = chavePeloTexto(kBase, bruto, variantesDaChave, indice + 1);
          if (vistos.has(k)) continue;
          vistos.add(k);
          // L2-ver-3 (S7, D426): o que o juiz le leva a lente canonica, a mesma da chave, e nao a grafia do inspetor.
          const meta = { chave: k, ronda: indice + 1, lente: lenteChave, severidade: a.severidade, linha: a.linha,
            descricao: a.descricao };
          metas.set(k, meta);
          // Achado do lado HEAD tem linha do arquivo antigo: nao faz par. Sem lado e sem rotulo, nao ha como
          // dizer que dois achados sao do mesmo arquivo: tambem nao faz par.
          const grupo = lado || rotulo;
          if (lado !== 'HEAD' && grupo) doLadoNovo.push({ meta: meta, grupo: grupo });
          if (a.severidade !== 'P0' && a.severidade !== 'P1') continue;
          // D503 (E7): o achado da 2a passada sai marcado; o A.txt dela e outro arquivo que o da 1a.
          const marcado = passada === 2 ? Object.assign({}, a, { passada: 2 }) : a;
          if (lado === 'HEAD') { antigos.push(marcado); continue; }
          if (refutado(refutados, indice + 1, vd.lente, a, passada)) continue;
          abertos.add(k);
          novos.push(marcado);
          novosChaves.push(k);
          lentesComNovos.add(lenteChave);
        }
      }
    }
    if (faixa1 !== null) conferirLentes(indice, ronda, lentesComNovosAntes);
    lentesComNovosAntes = lentesComNovos;
    daRonda.forEach(function (e, lente) {
      refLentes.set(lente, { lente: lente, ronda: indice + 1, ordem1: e.ordem1, ordem2: e.ordem2,
        resultado: resultadoDasDuasOrdens(e.ordem1, e.ordem2), lacunas: e.lacunas });
    });
    if (novos.length === 0) secas += 1; else secas = 0;
    if (indice === rondas.length - 1) {
      novosDaUltima = novos; novosChavesDaUltima = novosChaves; antigosDaUltima = antigos;
      ultimaComReferencia = comReferencia;
    }
  });

  // D503 (E6): pronto contra a referencia = toda lente empata ou vence nas duas ordens, sem lacuna P0/P1 do trabalho.
  // Vale quando a ultima ronda tem referencia; sem ela, null e a regra de hoje.
  let referencia = null;
  if (ultimaComReferencia) {
    const lentes = [];
    const lacunas = [];
    refLentes.forEach(function (e) {
      lentes.push({ lente: e.lente, ronda: e.ronda, ordem1: e.ordem1, ordem2: e.ordem2, resultado: e.resultado });
      e.lacunas.forEach(function (l) { lacunas.push(l); });
    });
    const faltam = new Set();
    lentes.forEach(function (l) { if (l.resultado !== 'vence' && l.resultado !== 'empata') faltam.add(l.lente); });
    lacunas.forEach(function (l) { if (l.severidade === 'P0' || l.severidade === 'P1') faltam.add(l.lente); });
    referencia = { pronta: lentes.length > 0 && faltam.size === 0, lentes: lentes, lacunas: lacunas,
      lentesAtras: Array.from(faltam) };
  }

  // D387 (#11c): pares para o juiz. Nada aqui entra na contagem acima.
  // D396 n. 23: cada grupo em ordem de linha, e so os vizinhos a ate DISTANCIA_PAR linhas se comparam (antes,
  // todos com todos, sem teto). A saida segue na ordem de antes: a de doLadoNovo.
  const ehNovoDaUltima = new Set(novosChavesDaUltima);
  const porGrupo = new Map();
  doLadoNovo.forEach(function (x, i) {
    if (!porGrupo.has(x.grupo)) porGrupo.set(x.grupo, []);
    porGrupo.get(x.grupo).push({ y: x, j: i });
  });
  porGrupo.forEach(function (lista) {
    lista.sort(function (p, q) { return p.y.meta.linha - q.y.meta.linha || p.j - q.j; });
  });
  const paresCandidatos = [];
  doLadoNovo.forEach(function (x, i) {
    if (!ehNovoDaUltima.has(x.meta.chave)) return;
    const lista = porGrupo.get(x.grupo);
    let ini = 0;
    let fim = lista.length;
    while (ini < fim) {
      const meio = (ini + fim) >> 1;
      if (lista[meio].y.meta.linha < x.meta.linha - DISTANCIA_PAR) ini = meio + 1; else fim = meio;
    }
    const perto = [];
    for (let k = ini; k < lista.length && lista[k].y.meta.linha <= x.meta.linha + DISTANCIA_PAR; k++) perto.push(lista[k]);
    perto.sort(function (p, q) { return p.j - q.j; });
    perto.forEach(function (p) {
      const y = p.y;
      if (x.meta.chave === y.meta.chave) return;
      // Os dois novos da ultima ronda: o par sai uma vez so, na ordem em que apareceram.
      if (ehNovoDaUltima.has(y.meta.chave) && p.j < i) return;
      paresCandidatos.push({ novo: x.meta, outro: y.meta, distancia: Math.abs(x.meta.linha - y.meta.linha) });
    });
  });

  const provaveisMesmos = [];
  // D396 n. 24: null pela API e o mesmo que ausente (sem juiz); a CLI ja barra o mesmos.json com null.
  if (op.mesmos !== undefined && op.mesmos !== null) {
    const mesmos = conferirMesmos(op.mesmos, vistos);
    const vistosPares = new Set();
    for (const m of mesmos) {
      if (m.resposta !== 'sim') continue;
      for (const [chave, outra] of [[m.novo, m.outro], [m.outro, m.novo]]) {
        if (!ehNovoDaUltima.has(chave) || vistosPares.has(chave + '\u0000' + outra)) continue;
        vistosPares.add(chave + '\u0000' + outra);
        const o = metas.get(outra);
        provaveisMesmos.push({ chave: chave, mesmoQue: outra, lente: o.lente, ronda: o.ronda,
          texto: 'provavel mesmo defeito que ' + outra + ' (lente ' + o.lente + ', ronda ' + o.ronda + ')' });
      }
    }
  }

  const ronda = rondas.length;
  const extra = { achadosDoLadoAntigo: antigosDaUltima, refutados: refutados, paresCandidatos: paresCandidatos,
    provaveisMesmos: provaveisMesmos, referencia: referencia, pendentes: pendentes, trechoNaoConfere: trechoNaoConfere };
  // A ultima ronda tem referencia e ela ainda nao foi alcancada: barra a aprovacao. Sem referencia (null), nao barra.
  const atrasDaReferencia = referencia !== null && !referencia.pronta;
  // Plano 082, Tarefa 5 (p2-15): lista vazia aqui nao acontece (ronda sem veredito lanca antes, e lente julgada que nao
  // empata nem vence entra em lentesAtras); se acontecer, diz a causa e o que fazer, e nao "nenhuma lente julgada".
  const quaisAtras = atrasDaReferencia ? ' (' + (referencia.lentesAtras.join(', ') ||
    'nenhuma lente julgou contra a referencia: grave os vereditos desta ronda com vsReferencia e apure de novo') + ')' : '';

  if (secas >= 2 && !atrasDaReferencia) {
    return Object.assign({ ronda: ronda, secas: secas, encerrar: true,
      motivo: 'duas rondas secas seguidas: aprovado', novos: novosDaUltima, placar: placar }, extra);
  }
  if (ronda >= TETO) {
    return Object.assign({ ronda: ronda, secas: secas, encerrar: true,
      motivo: 'teto de ' + TETO + ' rondas com ' + abertos.size + ' achado(s) P0/P1' +
        (atrasDaReferencia ? ' e a referencia nao alcancada' + quaisAtras : '') +
        ': para aqui e leva ao dono com 3 opcoes; o que sobrar vira registro',
      novos: novosDaUltima, placar: placar }, extra);
  }
  return Object.assign({ ronda: ronda, secas: secas, encerrar: false,
    motivo: 'ronda ' + (ronda + 1) + ' chama so as lentes que acharam P0/P1' +
      (atrasDaReferencia ? ' e as que nao empatam com a referencia ou tem lacuna P0/P1' + quaisAtras : ''),
    novos: novosDaUltima, placar: placar }, extra);
}

module.exports = { LENTES, LENTES_UI, FAMILIAS, SAEM_SO_LOGICA, familiasPara, FAIXA_UMA_ATE, FAIXA_DUAS_ATE,
  faixaDaMudanca, lentesDaFaixa, SEVERIDADES, RESULTADOS_REFERENCIA, TETO, chaveAchado, chaveDaLente, errosDoVeredito,
  validarVeredito, apurar, conferirMesmos, DISTANCIA_PAR, mapaDoTrabalho };
