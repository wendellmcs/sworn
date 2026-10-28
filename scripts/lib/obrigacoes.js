'use strict';
const fs = require('node:fs');
const path = require('node:path');

/**
 * O INVENTARIO DE OBRIGACOES de um manual, DERIVADO do proprio manual.
 *
 * Spec, secao 3: "guarde o metodo, nunca o resultado". Uma lista de obrigacoes
 * escrita a mao envelhece calada - o manual muda, a lista nao, e ninguem volta
 * para corrigi-la. E a mesma classe de defeito que a D134 achou no README e no
 * manifesto, e a razao pela qual a matriz de plataforma tambem e derivada.
 *
 * O manual declara obrigacao em TRES FORMAS, e este modulo le as tres:
 *
 *   1. CABECALHO ORDINAL   "## Marcha 3 - AAA", "## Lente 5 - Microcopy"
 *      A familia sai da palavra, o numero sai do numero. E como o manual
 *      enumera o que tem contagem fechada.
 *
 *   2. ITEM DE LISTA DENTRO DE BLOCO ANUNCIADO
 *      Um cabecalho, ou um paragrafo curto terminado em ":", que carregue um
 *      dos MARCADORES abre um bloco; os itens de lista dali ate o proximo
 *      cabecalho sao obrigacoes. E o que pega os nove portoes da marcha AAA e
 *      os guarda-corpos inviolaveis.
 *
 *   3. FRASE SOLTA EM NEGRITO   "**Se surgiu a duvida 'ja e hora?', ja era.**"
 *      Paragrafo inteiro em negrito que NAO termina em ":" - porque terminar em
 *      ":" faz dele um ANUNCIADOR, nao uma obrigacao.
 *
 * TRES ARMADILHAS MEDIDAS NO ENSAIO, e as tres estao curadas aqui:
 *
 *   a) O anunciador dos portoes e "**Portoes - todos obrigatorios:**": os dois
 *      pontos vem ANTES do fecho do negrito. Procurar ":" no fim da linha crua
 *      perdia as NOVE obrigacoes de maior peso do manual, em silencio.
 *   b) O anunciador dos gatilhos quebra em duas linhas fisicas, e o marcador
 *      fica na primeira. Por isso o arquivo e lido em LINHAS LOGICAS: paragrafo
 *      e a juncao das linhas ate a proxima em branco, cabecalho ou item.
 *   c) Cabecalho ordinal NUNCA anuncia bloco. "## Lente 2 - Estados
 *      obrigatorios" casa com /obrigat/, e sem esta trava cada estado virava
 *      obrigacao solta, duplicando a lente que ja e uma.
 *
 * O QUE ELE NAO PEGA, e esta dito para nao parecer que pega: obrigacao escrita
 * no meio de um paragrafo de prosa, sem nenhuma das tres formas. O ponto cego e
 * simetrico - vale para os dois manuais cruzados - e e por isso que o teste
 * prende a contagem MINIMA por familia: se o manual for reescrito e uma familia
 * inteira sumir, a suite reprova alto em vez de devolver um inventario menor
 * sem avisar.
 *
 * NENHUM CAMINHO DE MANUAL ENTRA AQUI. O diretorio vem sempre por argumento:
 * cravar o caminho de um manual de projeto poria um fato de fora na superficie
 * publicada - medido no ensaio, onde um segundo manual deixado dentro do
 * repositorio produziu 30 achados de vazamento.
 */

const RE_ORDINAL = /^([A-Za-z\u00c0-\u00ff]+)\s+(\d+)\s*[-\u2013\u2014]\s*(.+?)\s*$/;
const RE_CABECALHO = /^#{1,6}\s+(.*)$/;
const RE_ITEM = /^\s*(?:[-*+]|\d+\.)\s+(.+?)\s*$/;
const RE_SOLTA = /^\*\*((?:(?!\*\*)[\s\S]){12,200})\*\*[.\s]*$/;

/**
 * O vocabulario com que o manual ANUNCIA que o que vem a seguir obriga.
 * Cada padrao ganha o lugar por prova: o teste exige, para cada um, um caso que
 * ele PEGA e um que ele NAO pega - controle positivo e negativo por classe,
 * como o detector de sanitacao ja faz com as dele.
 */
const MARCADORES = [
  /obrigat/i, /inviol/i, /precisa ter/i, /proibid/i, /jamais/i,
  /nunca/i, /sempre/i, /tem de/i, /cont[a\u00e1]ve/i, /pedir decis/i,
  // D656 (T3): o manual do plugin agora e ingles; os mesmos marcadores em ingles.
  /required|mandatory/i, /must have/i, /forbidden|prohibited/i, /\bnever\b/i, /\balways\b/i, /\bmust\b/i,
  /countable/i, /\bask\b[\w ]{0,20} for a decision/i
];

const LIMITE_ANUNCIO = 160;

/** Os cinco mecanismos com que uma obrigacao pode ter valido. Ver o roteiro. */
const MECANISMOS = ['HOOK', 'REGRAS', 'SKILL', 'FORA', 'NADA'];

function anuncia(texto) {
  for (const re of MARCADORES) if (re.test(texto)) return true;
  return false;
}

/** Os arquivos de um manual, na ordem de leitura: o SKILL.md e depois as referencias. */
function arquivosDoManual(dir) {
  const out = [];
  const raiz = path.join(dir, 'SKILL.md');
  if (fs.existsSync(raiz)) out.push(raiz);
  const refs = path.join(dir, 'references');
  if (fs.existsSync(refs) && fs.statSync(refs).isDirectory()) {
    for (const f of fs.readdirSync(refs).sort()) {
      if (/\.md$/i.test(f)) out.push(path.join(refs, f));
    }
  }
  return out;
}

/**
 * Quebra o arquivo em LINHAS LOGICAS. Cabecalho e item de lista valem por si;
 * linhas de prosa consecutivas viram um paragrafo so. Sem isto, anunciador que
 * quebra em duas linhas fisicas passa despercebido (armadilha b).
 *
 * A linha gravada e sempre a da PRIMEIRA linha fisica do trecho, porque e onde
 * um leitor vai procurar.
 */
function linhasLogicas(bruto) {
  const fisicas = String(bruto == null ? '' : bruto).split(/\r?\n/);
  const out = [];
  let emCerca = false;
  let acc = null;
  const fecharAcc = () => { if (acc) { out.push(acc); acc = null; } };

  for (let i = 0; i < fisicas.length; i++) {
    const l = fisicas[i];
    if (/^\s*(```|~~~)/.test(l)) { fecharAcc(); emCerca = !emCerca; continue; }
    if (emCerca) continue;
    if (l.trim() === '') { fecharAcc(); continue; }

    const cab = l.match(RE_CABECALHO);
    if (cab) { fecharAcc(); out.push({ tipo: 'cabecalho', texto: cab[1].trim(), linha: i + 1 }); continue; }

    const item = l.match(RE_ITEM);
    if (item) { fecharAcc(); out.push({ tipo: 'item', texto: item[1].trim(), linha: i + 1 }); continue; }

    if (acc) acc.texto = acc.texto + ' ' + l.trim();
    else acc = { tipo: 'paragrafo', texto: l.trim(), linha: i + 1 };
  }
  fecharAcc();
  return out;
}

function acentoFora(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// A citacao de decisao do FORA (ver conferirResultado): a letra D com o numero, ou a palavra decisao com o numero.
// O lookahead final recusa o numero que continua em letra ou extensao ("D82abc", "d3.js"). Sem repeticao aninhada:
// cada espaco so cabe num \s*, e o texto montado de proposito nao faz o regex retroceder em tempo exponencial (D601).
const CITA_D = /(?:^|[^A-Za-z0-9_])(?:D[\s.#-]{0,2}|d)\d+(?![A-Za-z0-9_]|\.[A-Za-z])/;
const CITA_DECISAO = /\bdecis(?:ao|oes)\s*(?:(?:numero|nr|n)\.?\s*)?(?:[#\u00ba\u00b0:]\s*)?\d+/i;
function citaDecisao(texto) {
  const t = acentoFora(texto);
  return CITA_D.test(t) || CITA_DECISAO.test(t);
}

/**
 * A chave com que duas obrigacoes de manuais DIFERENTES se reconhecem como a
 * mesma. Tira o que e enfeite (negrito, codigo, link) e o que e do projeto (a
 * fatia {{...}} que o molde preenche), e reduz ao texto.
 */
function normalizar(titulo) {
  return acentoFora(String(titulo == null ? '' : titulo))
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*`_]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim().toLowerCase()
    .split(' ').filter((p) => p !== '').join(' ');
}

/**
 * A chave de casamento. Quando o manual nomeia a obrigacao em negrito no
 * comeco do item - que e como ele escreve a maioria - o NOME e a chave, e a
 * explicacao que vem depois fica de fora. Dois manuais dizem a mesma obrigacao
 * com explicacoes diferentes; medido no ensaio, casar pelo item inteiro perdia
 * quatro casamentos legitimos so por causa da prosa em volta.
 */
function chaveDe(titulo) {
  const m = String(titulo == null ? '' : titulo).match(/^\s*\*\*((?:(?!\*\*)[\s\S])+)\*\*/);
  return normalizar(m ? m[1] : titulo);
}

function pedaco(texto, n) {
  const t = String(texto).replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n - 1) + '...';
}

function slug(s, palavras) {
  const base = normalizar(s).split(' ').slice(0, palavras || 4).join('-');
  return base === '' ? 'sem-titulo' : base;
}

/**
 * Le um manual e devolve o que ele obriga.
 *
 * -> { fonte, ok, arquivos, obrigacoes: [{id, familia, titulo, chave, arquivo,
 *      linha, forma}], porFamilia: {familia: n} }
 *
 * Diretorio que nao existe, ou que nao tem SKILL.md, devolve inventario VAZIO
 * com `ok: false` - nunca estoura. Quem chama decide o que fazer com isso, e o
 * roteiro declara "nao verificavel aqui" em vez de seguir com nada.
 */
function inventario(dir) {
  const r = { fonte: String(dir == null ? '' : dir), ok: false, arquivos: [], obrigacoes: [], porFamilia: {} };
  const lista = arquivosDoManual(r.fonte);
  if (lista.length === 0) return r;
  r.ok = true;

  const vistos = Object.create(null);
  const contaFamilia = Object.create(null);

  for (const arq of lista) {
    const nome = path.basename(arq);
    r.arquivos.push(nome);
    let bruto = '';
    try { bruto = fs.readFileSync(arq, 'utf8'); } catch (e) { continue; }

    let secao = slug(nome.replace(/\.md$/i, ''), 3);
    let aberto = false;

    for (const b of linhasLogicas(bruto)) {
      if (b.tipo === 'cabecalho') {
        const ord = b.texto.match(RE_ORDINAL);
        if (ord) {
          // Armadilha (c): o cabecalho ordinal JA E a obrigacao, e nunca anuncia.
          empurrar(acentoFora(ord[1]).toLowerCase(), ord[3], nome, b.linha, 'ordinal', ord[2]);
          secao = slug(b.texto, 3);
          aberto = false;
          continue;
        }
        secao = slug(b.texto, 4);
        aberto = anuncia(b.texto);
        continue;
      }

      if (b.tipo === 'paragrafo') {
        // Armadilha (a): os dois pontos podem vir ANTES do fecho do negrito.
        const semEnfeite = b.texto.replace(/\*+\s*$/, '').trim();
        if (/:$/.test(semEnfeite) && semEnfeite.length <= LIMITE_ANUNCIO && anuncia(semEnfeite)) {
          aberto = true;
          continue;
        }
        const solta = b.texto.match(RE_SOLTA);
        if (solta && !/:$/.test(solta[1].trim())) {
          empurrar('afirmacao', solta[1], nome, b.linha, 'solta', null);
        }
        continue;
      }

      if (b.tipo === 'item' && aberto) empurrar(secao, b.texto, nome, b.linha, 'bloco', null);
    }
  }

  for (const o of r.obrigacoes) r.porFamilia[o.familia] = (r.porFamilia[o.familia] || 0) + 1;
  return r;

  function empurrar(familia, titulo, arquivo, linha, forma, numero) {
    const chave = chaveDe(titulo);
    if (chave === '') return;
    // Obrigacao repetida em dois pontos do manual e a MESMA obrigacao: contar
    // duas vezes daria ao juiz duas linhas para a mesma pergunta, e a segunda
    // sempre copiaria a primeira.
    if (vistos[chave]) return;
    vistos[chave] = true;
    contaFamilia[familia] = (contaFamilia[familia] || 0) + 1;
    const n = numero !== null && numero !== undefined ? numero : String(contaFamilia[familia]);
    r.obrigacoes.push({
      id: familia + '-' + n, familia: familia, titulo: pedaco(titulo, 160),
      chave: chave, arquivo: arquivo, linha: linha, forma: forma
    });
  }
}

/**
 * Cruza o inventario do manual do plugin (A) com o de um segundo manual (B).
 *
 * E o que torna o experimento capaz de achar uma obrigacao que o plugin
 * ESQUECEU. Sem o cruzamento, o inventario so consegue julgar o que o plugin ja
 * sabe que prometeu, e declararia coberto por omissao tudo o que a absorcao
 * deixou cair.
 *
 * O casamento e por chave EXATA, e isso e deliberado: casamento aproximado e
 * julgamento disfarcado de codigo. O que nao casa exato nao vira veredito -
 * vira linha marcada `aConferir`, que o juiz humano decide. A verificacao roda
 * sozinha; a decisao e um clique.
 */
function cruzar(a, b) {
  const r = { comuns: [], soNoPlugin: [], soNoOutro: [], total: 0, cruzou: false };
  if (!a || !a.ok) return r;
  const chavesA = Object.create(null);
  for (const o of a.obrigacoes) chavesA[o.chave] = o;
  if (!b || !b.ok) {
    r.soNoPlugin = a.obrigacoes.slice();
    r.total = a.obrigacoes.length;
    return r;
  }
  r.cruzou = true;
  const chavesB = Object.create(null);
  for (const o of b.obrigacoes) chavesB[o.chave] = o;

  for (const o of a.obrigacoes) {
    if (chavesB[o.chave]) r.comuns.push(o); else r.soNoPlugin.push(o);
  }
  for (const o of b.obrigacoes) {
    if (!chavesA[o.chave]) r.soNoOutro.push(o);
  }
  r.total = r.comuns.length + r.soNoPlugin.length + r.soNoOutro.length;
  return r;
}

/**
 * As linhas que o experimento julga: as do plugin, mais as que SO existem no
 * outro manual - estas marcadas `naoMigrada`, porque sao exatamente as
 * candidatas a continuar precisando da skill.
 *
 * `aConferir` nao e defeito: e a confissao de que o casamento exato nao decidiu
 * aquela linha, e que quem decide e o juiz.
 */
function linhasDoExperimento(cruz) {
  const out = [];
  for (const o of cruz.comuns) out.push(Object.assign({}, o, { naoMigrada: false, aConferir: false }));
  for (const o of cruz.soNoPlugin) out.push(Object.assign({}, o, { naoMigrada: false, aConferir: cruz.cruzou }));
  // D244/defeito 8: o id e numerado POR MANUAL, entao a linha do outro manual pode repetir o id
  // de uma do plugin - e o resultado, indexado por id, julgava as duas com um mecanismo so. A do
  // outro manual que colide ganha o prefixo `outro:`; a do plugin fica como sempre foi.
  const usados = new Set(out.map(function (o) { return o.id; }));
  for (const o of cruz.soNoOutro) {
    const id = usados.has(o.id) ? 'outro:' + o.id : o.id;
    usados.add(id);
    out.push(Object.assign({}, o, { id: id, naoMigrada: true, aConferir: true }));
  }
  return out;
}

/**
 * O que o resultado GRAVADO do experimento prova, contra o inventario ATUAL.
 *
 * Decisao 10 do dono e D83: este experimento TEM DE PODER REPROVAR O PLUGIN.
 * Um criterio que so consegue confirmar nao e experimento, e cerimonia - e foi
 * essa classe de defeito que custou tres rodadas na T6.
 *
 * Por isso ha CINCO desfechos, e eles nao se confundem:
 *
 *   NAO PROVADO   ninguem rodou o experimento. Declara-se; nao reprova nada.
 *   INVALIDO      rodou, mas de um jeito que nao mede o que diz medir. REPROVA
 *                 A SUITE, alto, nomeando o que o invalidou. Experimento
 *                 invalido que se apresenta como valido e pior do que nenhum.
 *   INCONCLUSIVO  rodou, mas ha obrigacao sem classificacao. Nao da para
 *                 concluir nem a favor nem contra.
 *   NAO BASTA     rodou inteiro, e a coluna NADA tem linha. CADA LINHA DELA E O
 *                 QUE CONTINUA PRECISANDO DA SKILL (D83, item 4).
 *   BASTA         rodou inteiro e a coluna NADA esta vazia.
 *
 * A D83 ja avisa que NAO BASTA e o desfecho esperado - "o experimento nao e
 * para descobrir SE ha linhas [NADA], e para descobrir QUAIS". Por isso NAO
 * BASTA nao reprova a suite: e achado sobre o mundo, nao build quebrado. Quem
 * reprova a suite e so o INVALIDO.
 *
 * FORA e o unico mecanismo que precisa citar DECISAO, nao evidencia de
 * execucao: e a alegacao de que aquela obrigacao ja foi decidida como fora do
 * plugin (D82: contrato de negocio fica no AGENTS.md). Sem essa exigencia, FORA
 * viraria a porta dos fundos por onde a coluna NADA se esvazia sozinha.
 */
function conferirResultado(linhas, resultado) {
  const r = {
    temResultado: false, total: Array.isArray(linhas) ? linhas.length : 0,
    classificadas: 0, semClassificacao: [], forasteiras: [],
    porMecanismo: {}, nada: [], invalidez: [], veredito: 'NAO PROVADO'
  };
  for (const m of MECANISMOS) r.porMecanismo[m] = 0;
  if (!Array.isArray(linhas) || linhas.length === 0) return r;
  if (!resultado || typeof resultado !== 'object' || !Array.isArray(resultado.linhas)) {
    r.semClassificacao = linhas.map((o) => o.id);
    return r;
  }
  r.temResultado = true;

  const quem = (x) => normalizar(x && x.trim ? x : '');
  const executor = quem(resultado.executor);
  const juiz = quem(resultado.juiz);
  if (executor === '') r.invalidez.push('o resultado nao diz QUEM executou a tarefa');
  if (juiz === '') r.invalidez.push('o resultado nao diz QUEM julgou as linhas');
  if (executor !== '' && executor === juiz) {
    r.invalidez.push('juiz e executor sao o mesmo: "' + resultado.juiz + '". Isso e auto-avaliacao: ' +
      'quem executou sabe o que pretendia fazer e le intencao como cobertura');
  }
  if (resultado.semManualAntigo !== true) {
    r.invalidez.push('o resultado nao declara que o manual antigo estava FORA da sessao; ' +
      'rodar com os dois carregados mede memoria, nao cobertura');
  }
  const ref = resultado.tarefa && resultado.tarefa.referencia;
  if (typeof ref !== 'string' || ref.trim() === '') {
    r.invalidez.push('a tarefa nao tem referencia rastreavel (commit, arquivo ou chamado). ' +
      'O experimento exige tarefa real: tarefa sintetica nao serve');
  }

  const porId = Object.create(null);
  for (const o of linhas) porId[o.id] = o;
  const vistas = Object.create(null);

  for (const l of resultado.linhas) {
    if (!l || typeof l !== 'object' || typeof l.id !== 'string') continue;
    if (!porId[l.id]) { if (r.forasteiras.indexOf(l.id) === -1) r.forasteiras.push(l.id); continue; }
    if (vistas[l.id]) continue;
    vistas[l.id] = true;

    const mec = String(l.mecanismo == null ? '' : l.mecanismo).toUpperCase();
    if (MECANISMOS.indexOf(mec) === -1) {
      r.invalidez.push('linha "' + l.id + '" usa mecanismo que nao existe: "' + l.mecanismo +
        '". Os validos sao ' + MECANISMOS.join(', '));
      continue;
    }
    const prova = String(l.evidencia == null ? '' : l.evidencia).trim();
    if (mec !== 'NADA' && prova === '') {
      r.invalidez.push('linha "' + l.id + '" afirma cobertura por ' + mec + ' e nao cita nada. ' +
        'Este plugin existe para obrigar a provar em vez de afirmar; a propria tabela nao escapa');
      continue;
    }
    // L3 (A3-20): a exigencia do comentario acima, que o codigo nao cobrava - FORA cita a decisao pelo numero: D82,
    // D 82, D-82, D.82, D#82, d82 colado, ou "decisao"/"decisoes" (com ou sem til) seguida de numero, "numero", "nr."
    // ou "n" antes dele. Prosa com numero ("a decisao de 5 minutos", "tela d 5", "d3.js") nao cita.
    // atalho: D-1 passa como citacao. limite: o regex nao sabe se a decisao existe.
    // trocar quando: o FORA puder conferir o numero contra o registro de decisoes do projeto.
    if (mec === 'FORA' && !citaDecisao(prova)) {
      r.invalidez.push('linha "' + l.id + '" diz FORA sem citar a decisao que a pos fora do plugin: cite a decisao ' +
        'pelo numero (a letra D seguida do numero dela) e diga o que ela decidiu');
      continue;
    }
    r.classificadas++;
    r.porMecanismo[mec]++;
    if (mec === 'NADA') r.nada.push({ id: l.id, titulo: porId[l.id].titulo });
  }

  for (const o of linhas) if (!vistas[o.id]) r.semClassificacao.push(o.id);

  if (r.invalidez.length > 0) r.veredito = 'INVALIDO';
  else if (r.semClassificacao.length > 0) r.veredito = 'INCONCLUSIVO';
  else if (r.nada.length > 0) r.veredito = 'NAO BASTA';
  else r.veredito = 'BASTA';
  return r;
}

/** O texto que o veredito cospe. Nomeia o que aconteceu, nunca so o rotulo. */
function motivo(c) {
  const L = [];
  if (c.veredito === 'NAO PROVADO') {
    L.push('NAO PROVADO: ninguem rodou o experimento neste ambiente.');
    L.push('Isto nao reprova nada: a pergunta sobre aposentar o manual continua sem resposta.');
    return L.join('\n');
  }
  if (c.veredito === 'INVALIDO') {
    L.push('INVALIDO: o experimento rodou de um jeito que nao mede o que diz medir.');
    for (const m of c.invalidez) L.push('  - ' + m);
    L.push('');
    L.push('Isto NAO se conserta afrouxando o teste. Ou se roda o experimento de novo');
    L.push('nas condicoes que ele exige, ou nao ha veredito nenhum sobre aposentar o manual.');
    return L.join('\n');
  }
  if (c.veredito === 'INCONCLUSIVO') {
    L.push('INCONCLUSIVO: ' + c.semClassificacao.length + ' de ' + c.total +
      ' obrigacoes ficaram sem classificacao.');
    L.push('Sem elas nao da para concluir nem a favor nem contra: ' +
      c.semClassificacao.slice(0, 8).join(', ') + (c.semClassificacao.length > 8 ? ', ...' : ''));
    return L.join('\n');
  }
  if (c.veredito === 'NAO BASTA') {
    L.push('NAO BASTA: ' + c.nada.length + ' de ' + c.total + ' obrigacoes valeram apenas');
    L.push('porque alguem lembrou. Cada linha abaixo e o que continua precisando do manual:');
    for (const n of c.nada) L.push('  [NADA] ' + n.id + ' - ' + n.titulo);
    L.push('');
    L.push('Aposentar o manual depende deste experimento. Com a coluna NADA');
    L.push('cheia, a aposentadoria nao acontece - no maximo o manual encolhe para estas linhas.');
    return L.join('\n');
  }
  L.push('BASTA: as ' + c.total + ' obrigacoes tiveram um mecanismo que as fez valer.');
  L.push('HOOK ' + c.porMecanismo.HOOK + ' | REGRAS ' + c.porMecanismo.REGRAS +
    ' | SKILL ' + c.porMecanismo.SKILL + ' | FORA ' + c.porMecanismo.FORA);
  L.push('A condicao para aposentar o manual esta satisfeita. A decisao continua sendo do dono.');
  return L.join('\n');
}

module.exports = {
  RE_ORDINAL, RE_ITEM, RE_SOLTA, MARCADORES, LIMITE_ANUNCIO, MECANISMOS,
  arquivosDoManual, linhasLogicas, normalizar, chaveDe, inventario, cruzar, linhasDoExperimento,
  conferirResultado, motivo
};
