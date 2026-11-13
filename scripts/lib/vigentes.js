'use strict';
// F4a: o que vale entre as decisoes sai das revogacoes escritas nelas, sem o rodape "Continua valendo" copiado de uma
// decisao para a outra (ele seguia citando a D372 depois que a D373 a revogou). Le o registro no formato
// `### D<n> · <titulo>`, com o titulo lido junto do corpo, e duas formas de revogar: a ativa ("revoga a D372",
// "**Revoga:** D372", "revoga em parte a D634") e a passiva ("a D372, revogada pela D373", "a D2 e revogada", "a D133
// §8.1 deixa de valer"). O que esta numa frase de "Recusadas", no infinitivo ("revogar") ou no condicional
// ("revogaria") nao e revogacao.

const CABECALHO = /^### (D\d+) · (.*)$/gm;
// Linha que comeca como cabecalho de decisao: a que nao casa o CABECALHO e cabecalho torto, e o registro reprova.
const QUASE_CABECALHO = /^###\s*D\d+/;
// Alterar, corrigir e emendar mudam parte do que vale ("Altera a D350 so no em paralelo"): contam como em parte, e so
// com a decisao logo depois do verbo ("Corrige-se o achado da D1" nao conta).
const ATIVA = /\b(revoga|altera|corrige|emenda)(?![\wà-ú])/gi;
const PASSIVA = /\b(?:revogad[ao]s?|deixam? de valer)(?![\wà-ú])/gi;
// A parte de uma decisao, logo depois do numero: o paragrafo ("D5 §3") ou a letra ("D776 b"). A letra "e" e a que
// junta duas decisoes ("a D2 e a D3"), nao uma parte; "a" e "o" sao artigos ("revoga a D5 a partir de hoje") e so
// contam como parte com pontuacao logo depois ("a D5 a, b").
const LETRA_DE_PARTE = '\\s+(?:[b-df-np-z](?=[\\s,.;)]|$)|[ao](?=[,.;)]|$))';
const PARTE_DA_DECISAO = '(?:\\s*§\\s*[\\d.]+|' + LETRA_DE_PARTE + ')';
// O sujeito da passiva: a lista de decisoes colada antes do verbo ("a D2 §1 e a D3 ficam"), com um parentese no fim.
const SUJEITO = new RegExp('((?:(?:a|as|o|os|da|do|das|dos)\\s+)?\\bD\\d+' + PARTE_DA_DECISAO +
  '?(?:\\s*,\\s*|\\s+e\\s+)?)+\\s*(?:\\([^()]{0,120}\\)\\s*)?(?:fica|ficam|é|e|são|foi|foram)?\\s*$', 'i');
// A lista colada ao verbo na revogacao direta ("revoga a D1, a D2 e a D3"): so ela e revogada. A decisao citada
// depois, de contexto ("revoga a D372, que nasceu da D300"), nao.
const LISTA = new RegExp('^\\s*(?:(?:a|as|o|os)\\s+)?\\bD\\d+' + PARTE_DA_DECISAO + '?(?:(?:\\s*,\\s*|\\s+e\\s+|\\s+ou\\s+|' +
  '\\s*\\/\\s*|\\s*[–-]\\s*)(?:(?:a|as|o|os|da|das|do|dos)\\s+)?\\bD\\d+' + PARTE_DA_DECISAO + '?)*', 'i');
const PARTE = /em parte|\bparte\b|(?:^|\s)s[oó](?=[\s,.;]|$)|§|["“”]|\bexceto\b/i;
// A letra de parte depois do numero (o paragrafo ja esta em PARTE).
const LETRA = new RegExp('\\bD\\d+' + LETRA_DE_PARTE, 'i');
// Um intervalo ("D12–D14") se expande ate este tamanho: o registro nunca escreveu um maior, e um maior seria erro de
// digitacao, que encheria a lista de revogadas.
const MAIOR_INTERVALO = 500;

// O titulo, como aparece na lista: sem negrito nem crase.
function semMarcas(texto) {
  return texto.replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim();
}

// O corpo, como o leitor o percorre. O paragrafo e o rotulo em negrito ("**Revoga:** D372", sem ponto no fim) fecham
// a frase e abrem um bloco (BLOCO): sem isso, o rotulo seguinte ("**Relaciona:** D10") entraria na mesma oracao. O
// item de lista (ITEM) fecha a oracao, mas segue no bloco: o item sob "**Recusadas:**" continua recusado, mesmo com
// uma linha em branco entre o rotulo que termina em ":" e a lista.
const BLOCO = '¶';
const ITEM = '•';
function corpoLido(texto) {
  return texto.replace(/:(\*\*)?[ \t]*\r?\n\s*\r?\n(?=[ \t]*(?:[-*+]|\d+\.)\s)/g, ':$1\n')
    .replace(/\r?\n\s*\r?\n/g, '. ' + BLOCO + ' ')
    .replace(/\r?\n\s*(?:[-*+]|\d+\.)\s+/g, ' ' + ITEM + ' ')
    .replace(/\*\*([^*\n]{1,60}?):\*\*/g, '. ' + BLOCO + ' $1:')
    .replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim();
}

function numeros(trecho, existe) {
  const achados = [];
  const re = /\bD(\d+)(?:\s*[–-]\s*D(\d+))?/g;
  let m;
  while ((m = re.exec(trecho))) {
    const de = Number(m[1]);
    // O intervalo ao contrario ("D14–D12") ou grande demais fica so com as duas pontas.
    const ate = m[2] ? Number(m[2]) : de;
    if (ate < de || ate - de >= MAIOR_INTERVALO) {
      for (const n of [de, ate]) if (existe.has('D' + n)) achados.push('D' + n);
      continue;
    }
    for (let n = de; n <= ate; n++) if (existe.has('D' + n)) achados.push('D' + n);
  }
  return achados;
}

// A clausula da revogacao ativa: do verbo ate o fim da frase, o ";" ou o ")" que fecha um parentese aberto antes.
function clausula(texto, desde) {
  let fundo = 0;
  for (let i = desde; i < texto.length; i++) {
    const c = texto[i];
    if (c === '(') fundo++;
    else if (c === ')') { if (fundo === 0) return texto.slice(desde, i); fundo--; }
    else if (c === ';' || c === ITEM) return texto.slice(desde, i);
    else if (c === '.' && (i + 1 === texto.length || /\s/.test(texto[i + 1]))) return texto.slice(desde, i);
  }
  return texto.slice(desde);
}

// O comeco da frase em que esta a posicao: logo depois do ultimo ". ", "! ", "? " ou "; " antes dela. O ponto dentro
// de um numero ("0.31.0", "§8.1") nao tem espaco depois e nao conta.
function inicioDaFrase(texto, ate) {
  const re = /[.!?;]\s/g;
  let inicio = 0;
  let m;
  while ((m = re.exec(texto)) && m.index < ate) inicio = m.index + 2;
  return Math.min(inicio, ate);
}

// Recusada e a frase com "Recusad" antes do verbo, ou o item de lista de um bloco que comeca por "Recusad".
function recusada(texto, posicao) {
  if (/Recusad/i.test(texto.slice(inicioDaFrase(texto, posicao), posicao))) return true;
  const bloco = texto.slice(0, posicao).lastIndexOf(BLOCO);
  const desdeOBloco = texto.slice(bloco + 1, posicao);
  return /^\s*Recusad/i.test(desdeOBloco) && desdeOBloco.indexOf(ITEM) !== -1;
}

function revogacoesDe(d, existe) {
  const texto = d.titulo + '. ' + d.corpo;
  const achadas = [];
  const juntar = function (alvo, por, parte) {
    if (alvo !== por && existe.has(alvo) && existe.has(por)) achadas.push({ alvo: alvo, por: por, parte: parte });
  };
  let m;
  ATIVA.lastIndex = 0;
  while ((m = ATIVA.exec(texto))) {
    if (recusada(texto, m.index)) continue;
    const bruta = clausula(texto, m.index + m[0].length);
    const resto = bruta.replace(/^:/, '');
    const lista = LISTA.exec(resto);
    const revoga = /^revoga$/i.test(m[1]);
    // "Altera: D350" e "emenda a D382" mudam; "com a emenda D41" e o substantivo.
    if (!revoga && !/^(?::\s*|\s+(?:a|as)\s+)D\d+/.test(bruta)) continue;
    const parte = !revoga || !lista || PARTE.test(resto) || LETRA.test(resto);
    for (const alvo of numeros(lista ? lista[0] : resto, existe)) juntar(alvo, d.id, parte);
  }
  PASSIVA.lastIndex = 0;
  while ((m = PASSIVA.exec(texto))) {
    if (recusada(texto, m.index)) continue;
    const antes = texto.slice(Math.max(inicioDaFrase(texto, m.index), m.index - 160), m.index);
    const s = SUJEITO.exec(antes);
    if (!s) continue;
    const depois = texto.slice(m.index + m[0].length);
    const pelo = /^\s*(?:em parte\s+)?(?:pel[ao]|por)\s+D(\d+)/i.exec(depois);
    const emParte = /^\s*em parte/i.test(depois);
    const por = pelo ? 'D' + pelo[1] : d.id;
    const re = new RegExp('\\bD(\\d+)(' + PARTE_DA_DECISAO + ')?', 'gi');
    let k;
    while ((k = re.exec(s[0]))) juntar('D' + k[1], por, emParte || !!k[2]);
  }
  return achadas;
}

function analisar(texto) {
  const decisoes = [];
  let m;
  CABECALHO.lastIndex = 0;
  const marcas = [];
  while ((m = CABECALHO.exec(texto))) marcas.push({ id: m[1], titulo: semMarcas(m[2]), inicio: m.index, fimDoCabecalho: m.index + m[0].length });
  for (let i = 0; i < marcas.length; i++) {
    const fim = i + 1 < marcas.length ? marcas[i + 1].inicio : texto.length;
    decisoes.push({ id: marcas[i].id, titulo: marcas[i].titulo, corpo: corpoLido(texto.slice(marcas[i].fimDoCabecalho, fim)) });
  }
  // O registro com defeito (numero repetido, cabecalho fora do formato) nao gera lista: ela sairia errada calada.
  const contagem = new Map();
  for (const d of decisoes) contagem.set(d.id, (contagem.get(d.id) || 0) + 1);
  const repetidas = Array.from(contagem.keys()).filter(function (id) { return contagem.get(id) > 1; });
  const tortos = [];
  texto.split(/\r?\n/).forEach(function (l, i) {
    if (QUASE_CABECALHO.test(l) && !/^### D\d+ · /.test(l)) tortos.push(i + 1);
  });
  const existe = new Set(contagem.keys());
  const vistas = new Map();
  for (const d of decisoes) {
    for (const r of revogacoesDe(d, existe)) {
      const chave = r.alvo + '<' + r.por;
      const ja = vistas.get(chave);
      // O titulo resume ("revoga a D328") e o corpo restringe ("na parte adiado"): a restricao vence.
      if (!ja) vistas.set(chave, r);
      else if (r.parte) ja.parte = true;
    }
  }
  return {
    decisoes: decisoes.map(function (d) { return { id: d.id, titulo: d.titulo }; }),
    revogacoes: Array.from(vistas.values()),
    repetidas: repetidas,
    cabecalhosTortos: tortos
  };
}

const numero = function (id) { return Number(id.slice(1)); };
const celula = function (t) { return t.replace(/\|/g, '\\|'); };

function gerar(analise, nomeDoRegistro) {
  const inteira = new Map();
  const emParte = new Map();
  for (const r of analise.revogacoes) {
    const balde = r.parte ? emParte : inteira;
    if (!balde.has(r.alvo)) balde.set(r.alvo, []);
    balde.get(r.alvo).push(r.por);
  }
  const ordem = analise.decisoes.slice().sort(function (a, b) { return numero(b.id) - numero(a.id); });
  const por = function (lista) { return lista.slice().sort(function (a, b) { return numero(a) - numero(b); }).join(', '); };
  const revogadas = ordem.filter(function (d) { return inteira.has(d.id); });
  const parciais = ordem.filter(function (d) { return !inteira.has(d.id) && emParte.has(d.id); });
  const vigentes = ordem.filter(function (d) { return !inteira.has(d.id); });
  const linhas = [
    '# Decisões vigentes', '',
    'Gerado por `scripts/vigentes.js` a partir de `' + nomeDoRegistro + '` (' + analise.decisoes.length + ' decisões). ' +
      'Não edite à mão: rode `node scripts/vigentes.js --gravar`.',
    'O registro guarda o histórico inteiro, com o porquê de cada decisão; aqui fica só o que vale. Uma revogação entra ' +
      'aqui quando o registro a escreve com a decisão logo depois do verbo ou do rótulo: "revoga a D…", "revoga em ' +
      'parte a D…", "**Revoga:** D…"; na passiva, "a D… fica revogada", "a D…, revogada pela D…" ou "a D… deixa de ' +
      'valer"; e, sempre em parte, "altera a D…", "corrige a D…", "emenda a D…" ou os rótulos "**Altera:** D…", "**Corrige:** D…" e "**Emenda:** D…". ' +
      'O que está numa frase de "Recusadas" não entra.',
    '', '## Revogadas (' + revogadas.length + ')', '', '| Decisão | Título | Revogada por |', '|---|---|---|'
  ];
  for (const d of revogadas) linhas.push('| ' + d.id + ' | ' + celula(d.titulo) + ' | ' + por(inteira.get(d.id)) + ' |');
  linhas.push('', '## Revogadas ou alteradas em parte (' + parciais.length + ')', '', '| Decisão | Título | Em parte por |', '|---|---|---|');
  for (const d of parciais) linhas.push('| ' + d.id + ' | ' + celula(d.titulo) + ' | ' + por(emParte.get(d.id)) + ' |');
  linhas.push('', '## Vigentes (' + vigentes.length + ')', '');
  for (const d of vigentes) linhas.push('- ' + d.id + ' · ' + d.titulo + (emParte.has(d.id) ? ' (em parte: ' + por(emParte.get(d.id)) + ')' : ''));
  return linhas.join('\n') + '\n';
}

// As linhas (contadas de 1) que ainda trazem o rodape copiado.
function rodapes(texto) {
  const achadas = [];
  texto.split(/\r?\n/).forEach(function (l, i) { if (l.indexOf('**Continua valendo:**') !== -1) achadas.push(i + 1); });
  return achadas;
}

module.exports = { analisar, gerar, rodapes };
