'use strict';
const fs = require('node:fs');
const path = require('node:path');
const auditoria = require('./auditoria.js');
const instrucoes = require('./instrucoes.js');

/**
 * Entrega D. Regra sem cicatriz e opiniao, e opiniao nao sobrevive a
 * discordancia - criterio 8 de `modelos/boa-skill.md`. Um manual que cresce por
 * acumulacao cobra contexto de TODA sessao de quem instala, e ninguem nunca tira
 * nada de arquivo de instrucao. Este modulo responde uma pergunta so, item a
 * item: existe decisao, incidente ou achado atras desta linha?
 *
 * O que ele NAO faz, e por desenho: nao apaga, nao move, nao edita. Sobreposicao
 * de termos e SINAL, nunca veredito - o mesmo limite que `auditoria.sobreposicoes`
 * ja declara. Quem poda e o dono.
 *
 * O corpus e sempre ARGUMENTO. Nenhum caminho de maquina e nenhum nome de projeto
 * entra aqui: e a regra dos volateis aplicada ao proprio auditor.
 */

const MARCAS = [
  { re: /\bD\d{1,4}\b/, tipo: 'decisao' },
  { re: /\bdecis(?:ao|ão|oes|ões)\b/i, tipo: 'decisao' },
  { re: /\bvalidad[oa] em\b/i, tipo: 'decisao' },
  { re: /\bnao perguntar de novo\b|\bnão perguntar de novo\b/i, tipo: 'decisao' },
  { re: /\bR-T\d+-\d+\b/, tipo: 'achado' },
  { re: /\bachad[oa]s?\b/i, tipo: 'achado' },
  { re: /\bP[012]\b/, tipo: 'achado' },
  { re: /\b(incidente|quebrou|quebra|estourou|falhou|custou|regrediu|vazou)\b/i, tipo: 'incidente' }
];

/** Quantos termos distintivos a regra e a passagem precisam dividir para que a
 *  ligacao entre as duas conte. Um so termo e ruido: e o limite conhecido de
 *  `auditoria.sobreposicoes`, que casa duas skills por uma palavra em comum. */
const MINIMO_DE_TERMOS = 2;

/**
 * O piso absoluto nao basta, e isto foi MEDIDO: com so ele, 169 de 177 itens
 * saiam "com cicatriz", todos marcados com os tres tipos ao mesmo tempo. Uma
 * passagem longa acumula toda marca que existe e divide dois termos com
 * qualquer regra - o auditor mandava guardar tudo, que e o mesmo que nao
 * auditar. Duas correcoes, e as duas sao sobre TAMANHO:
 *
 *   1. a passagem tem teto de linhas, para que "aparecer junto" queira dizer
 *      alguma coisa;
 *   2. a ligacao se mede em FRACAO dos termos da regra, nao em numero absoluto.
 */
const MAX_LINHAS_POR_PASSAGEM = 40;
const FRACAO_MINIMA = 0.6;

const TIPOS = ['decisao', 'incidente', 'achado'];

/** Que marcas de cicatriz esta passagem carrega. Vazio = passagem sem cicatriz. */
function marcas(trecho) {
  const t = String(trecho == null ? '' : trecho);
  const achadas = [];
  for (const m of MARCAS) {
    if (m.re.test(t) && achadas.indexOf(m.tipo) === -1) achadas.push(m.tipo);
  }
  return achadas.sort();
}

/** Uma passagem por cabecalho; sem cabecalho, o arquivo inteiro e uma passagem. */
function passagens(texto) {
  const linhas = String(texto == null ? '' : texto).split(/\r?\n/);
  const blocos = [];
  let atual = { linha: 1, corpo: [] };
  linhas.forEach(function (l, i) {
    if (/^#{1,6}\s/.test(l)) {
      if (atual.corpo.length) blocos.push(atual);
      atual = { linha: i + 1, corpo: [l] };
    } else {
      atual.corpo.push(l);
    }
  });
  if (atual.corpo.length) blocos.push(atual);

  // Secao longa vira varios pedacos: sem teto, uma secao de centenas de linhas
  // carrega toda marca que existe e casa com qualquer regra.
  const saida = [];
  for (const b of blocos) {
    for (let i = 0; i < b.corpo.length; i += MAX_LINHAS_POR_PASSAGEM) {
      saida.push({
        linha: b.linha + i,
        texto: b.corpo.slice(i, i + MAX_LINHAS_POR_PASSAGEM).join('\n')
      });
    }
  }
  return saida;
}

/**
 * Lista recursiva de .md sob `raiz`, em caminho relativo e com barra normal.
 * `raiz` pode ser um ARQUIVO (IN-10): quem aponta um arquivo de proposito - o historico
 * deste projeto e um so - quer esse arquivo lido, qualquer que seja a extensao. Devolve
 * [''] (o proprio arquivo, sem relativo); `abrirEm` resolve isso.
 */
function arquivosDe(raiz) {
  try { if (fs.statSync(raiz).isFile()) return ['']; } catch (e) { return []; }
  const achados = [];
  (function andar(dir) {
    let entradas = [];
    try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entradas) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const cheio = path.join(dir, e.name);
      if (e.isDirectory()) andar(cheio);
      else if (/\.md$/i.test(e.name)) achados.push(cheio);
    }
  })(raiz);
  return achados.map(function (c) {
    return path.relative(raiz, c).split(path.sep).join('/');
  }).sort();
}

/** Caminho de leitura de um item de `arquivosDe`: o relativo sob a pasta, ou o proprio arquivo. */
function abrirEm(raiz, rel) { return rel ? path.join(raiz, rel) : raiz; }

/** Nome para citar na prova: o relativo, ou o nome do arquivo quando `raiz` e um arquivo. */
function nomeDe(raiz, rel) { return rel || path.basename(raiz); }

/**
 * O indice de cicatrizes do corpus: so as passagens que carregam marca entram.
 * Passagem sem marca e prosa, e prosa nao prova dor de origem.
 */
function indexar(raizCorpus) {
  const indice = [];
  for (const rel of arquivosDe(raizCorpus)) {
    let texto = '';
    try { texto = fs.readFileSync(abrirEm(raizCorpus, rel), 'utf8'); } catch (e) { continue; }
    for (const p of passagens(texto)) {
      const tipos = marcas(p.texto);
      if (!tipos.length) continue;
      indice.push({
        arquivo: nomeDe(raizCorpus, rel),
        linha: p.linha,
        tipos: tipos,
        termos: auditoria.termos(p.texto)
      });
    }
  }
  return indice;
}

/** Os itens de instrucao de um manual: linha que comeca com marcador ou numero. */
function itensDe(raizManual) {
  const itens = [];
  for (const rel of arquivosDe(raizManual)) {
    let texto = '';
    try { texto = fs.readFileSync(abrirEm(raizManual, rel), 'utf8'); } catch (e) { continue; }
    texto.split(/\r?\n/).forEach(function (l, i) {
      if (!instrucoes.RE_ITEM.test(l)) return;
      const corpo = l.replace(/^\s*(?:[-*+]\s+|\d+\.\s+)/, '').trim();
      if (!corpo) return;
      itens.push({ arquivo: nomeDe(raizManual, rel), linha: i + 1, texto: corpo });
    });
  }
  return itens;
}

/** Esta linha tem dor de origem no corpus? Devolve as provas, nao um booleano nu. */
function conferir(item, indice, minimo, fracao) {
  const alvo = auditoria.termos(item.texto);
  const piso = typeof minimo === 'number' ? minimo : MINIMO_DE_TERMOS;
  const frac = typeof fracao === 'number' ? fracao : FRACAO_MINIMA;
  const provas = [];
  for (const c of (indice || [])) {
    const comuns = Array.from(alvo).filter(function (x) { return c.termos.has(x); });
    if (comuns.length < piso) continue;
    if (!alvo.size || comuns.length / alvo.size < frac) continue;
    provas.push({ arquivo: c.arquivo, linha: c.linha, tipos: c.tipos, termos: comuns.sort() });
  }
  provas.sort(function (a, b) { return b.termos.length - a.termos.length; });
  const tipos = [];
  for (const p of provas) for (const t of p.tipos) if (tipos.indexOf(t) === -1) tipos.push(t);
  return {
    temCicatriz: provas.length > 0,
    tipos: tipos.sort(),
    provas: provas.slice(0, 3)
  };
}

/**
 * O relatorio. `corpus` ausente nao e falha: e o modo degradado previsto, e ele
 * se DECLARA em vez de devolver tudo como "sem cicatriz" - que seria o mesmo
 * silencio que este modulo existe para quebrar.
 */
function varrer(raizManual, raizCorpus, opcoes) {
  const o = opcoes || {};
  // S8/L2-cic-1: pasta que existe mas nao tem nenhum .md nao e corpus lido (indice vazio com
  // `corpusLido: true` mandaria podar tudo); cai no modo degradado como a pasta inexistente.
  const temCorpus = !!raizCorpus && fs.existsSync(raizCorpus) && arquivosDe(raizCorpus).length > 0;
  const indice = temCorpus ? indexar(raizCorpus) : [];
  const itens = itensDe(raizManual);

  const avaliados = itens.map(function (it) {
    const r = temCorpus ? conferir(it, indice, o.minimo, o.fracao)
      : { temCicatriz: false, tipos: [], provas: [] };
    return {
      arquivo: it.arquivo, linha: it.linha, texto: it.texto,
      temCicatriz: r.temCicatriz, tipos: r.tipos, provas: r.provas
    };
  });

  const com = avaliados.filter(function (a) { return a.temCicatriz; });
  // Conta pela prova MAIS FORTE de cada item, nao pela uniao. Medido: contra um
  // historico grande a uniao dava 166/166/163 - tres numeros iguais nao separam
  // nada, e numero que nao separa nada e decoracao com casas decimais.
  const porTipo = {};
  for (const t of TIPOS) {
    porTipo[t] = com.filter(function (a) {
      return a.provas.length && a.provas[0].tipos.indexOf(t) !== -1;
    }).length;
  }

  return {
    corpusLido: temCorpus,
    minimo: typeof o.minimo === 'number' ? o.minimo : MINIMO_DE_TERMOS,
    fracao: typeof o.fracao === 'number' ? o.fracao : FRACAO_MINIMA,
    passagensComMarca: indice.length,
    itens: avaliados,
    resumo: {
      total: avaliados.length,
      comCicatriz: com.length,
      semCicatriz: avaliados.length - com.length,
      porTipo: porTipo
    }
  };
}

/** O texto. Quem nao tem cicatriz vem PRIMEIRO: e a lista que motiva a poda. */
function texto(r, limite) {
  const teto = typeof limite === 'number' ? limite : 20;
  // Plano 082, Tarefa 5 (mock S10): a 1a linha diz o que o relatorio responde; arquivo:linha entre aspas.
  // A5-44 (D735): cicatriz e dor de origem, que o resto do relatorio usa, explicadas logo abaixo.
  const linhas = ['sworn - auditoria por cicatriz: que regra tem dor de origem, e qual pode sair.',
    'Cicatriz: a decisao, o incidente ou o achado do historico (o corpus) que explica por que a regra',
    'nasceu, a dor de origem dela.', ''];

  if (!r.corpusLido) {
    linhas.push('CORPUS NAO LIDO. Sem historico para comparar, nada aqui distingue regra com');
    linhas.push('dor de origem de regra sem - e chamar todas de "sem cicatriz" seria mentir.');
    linhas.push('Aponte o corpus com --corpus <pasta> e rode de novo.');
    linhas.push('');
  }

  linhas.push('Itens de instrucao: ' + r.resumo.total +
    ' | com cicatriz: ' + r.resumo.comCicatriz +
    ' | sem: ' + r.resumo.semCicatriz);
  // A5-43/45 (D735): o que o corpus tem, e o piso dito como o conferir() o aplica: os dois juntos, o minimo de
  // termos E a fracao dos termos da regra.
  linhas.push('Trechos do corpus com marca de decisao, incidente ou achado: ' + r.passagensComMarca);
  const plural = function (n, um, varios) { return n + ' ' + (n === 1 ? um : varios); };
  linhas.push('Uma regra tem cicatriz quando um desses trechos divide com ela ao menos ' +
    plural(r.minimo, 'palavra-chave', 'palavras-chave'));
  linhas.push('e ' + Math.round(r.fracao * 100) + '% das palavras-chave dela.');
  linhas.push('Por tipo de cicatriz: decisao ' + r.resumo.porTipo.decisao +
    ', incidente ' + r.resumo.porTipo.incidente +
    ', achado ' + r.resumo.porTipo.achado);
  linhas.push('');

  const sem = r.itens.filter(function (a) { return !a.temCicatriz; });
  linhas.push('SEM cicatriz - candidatos a poda (' + sem.length + '):');
  for (const a of sem.slice(0, teto)) {
    linhas.push('  - "' + a.arquivo + ':' + a.linha + '" ' + a.texto.slice(0, 90));
  }
  if (sem.length > teto) linhas.push('  ... mais ' + (sem.length - teto) + '.');
  linhas.push('');

  const com = r.itens.filter(function (a) { return a.temCicatriz; });
  linhas.push('COM cicatriz - ficam, e a prova esta ao lado (' + com.length + '):');
  for (const a of com.slice(0, teto)) {
    const p = a.provas[0];
    linhas.push('  - "' + a.arquivo + ':' + a.linha + '" [' + a.tipos.join(',') + '] <- "' +
      p.arquivo + ':' + p.linha + '"');
  }
  if (com.length > teto) linhas.push('  ... mais ' + (com.length - teto) + '.');
  linhas.push('');
  // A5-43 (D735): "indicio" no lugar de "SINAL", e o passo antes de podar.
  linhas.push('Isto e indicio, nunca veredito: palavra em comum liga duas linhas, nao prova que uma');
  linhas.push('nasceu da outra. Antes de tirar uma regra da lista SEM cicatriz, procure o motivo dela no corpus');
  linhas.push('com outras palavras. Quem poda e o dono, e nada foi alterado aqui.');
  return linhas.join('\n');
}

module.exports = {
  MARCAS, MINIMO_DE_TERMOS, MAX_LINHAS_POR_PASSAGEM, FRACAO_MINIMA, TIPOS,
  marcas, passagens, arquivosDe, indexar, itensDe, conferir, varrer, texto
};
