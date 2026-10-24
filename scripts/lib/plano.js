'use strict';
const fs = require('node:fs');
const path = require('node:path');
const escopoLib = require('./escopo.js');

const RE_TAREFA = /^#{2,4}\s*Tarefa\s+(\d+)\s*[:.\-]\s*(.+?)\s*$/i;
const RE_CAIXA = /^\s*-\s*\[( |x|X)\]/;
const ATIVO = path.join('.claude', 'sworn', 'plano-ativo.json');

/** D514 #11: a caixa de passo conta no item de cima - a mesma regra no portao (parseTarefas) e no painel (parseItens). */
function contarCaixa(atual, linha) {
  const caixa = linha.match(RE_CAIXA);
  if (!caixa || !atual) return;
  atual.total += 1;
  if (caixa[1] === ' ') atual.abertos += 1;
}

// A7-01: cabecalho que nao e item, de nivel ACIMA do item aberto ("## Criterios de aceite" depois de "### Tarefa"),
// fecha o item - a caixa embaixo dele nao e passo. D604: no mesmo nivel ("### Passo 1" sob "### Tarefa 2") segue no
// item, como o subcabecalho mais fundo - senao o passo aberto sumia do portao; "# comentario" dentro de
// bloco de codigo nao e cabecalho (senao esconderia do portao os passos abertos depois do bloco). Cabecalho com forma
// de item ("### Tarefa 2b", que o RE_TAREFA nao casa) tambem nao fecha: as caixas dele seguem cobradas na de cima.
// R2 da s107: a cerca guarda o marcador que a abriu e so fecha com o mesmo caractere, comprimento igual ou maior
// (CommonMark) - uma linha ~~~ dentro de um bloco ``` nao fecha. Devolve o marcador aberto, ou null fora da cerca.
const RE_CABECALHO = /^(#{1,6})\s/;
const RE_CERCA = /^\s*(`{3,}|~{3,})/;
function cerca(aberta, linha) {
  const m = linha.match(RE_CERCA);
  if (!m) return aberta;
  if (!aberta) return m[1];
  return m[1][0] === aberta[0] && m[1].length >= aberta.length ? null : aberta;
}
function fechaItem(linha, nivel) {
  const m = linha.match(RE_CABECALHO);
  return !!m && m[1].length < nivel && !RE_ITEM.test(linha);
}

/** CLAUDE.md: etapa so e completa quando TODOS os subitens dela estao feitos. */
function parseTarefas(texto) {
  const linhas = String(texto == null ? '' : texto).split(/\r?\n/);
  const tarefas = [];
  let atual = null;
  let nivel = 0;
  let naCerca = null;
  linhas.forEach(function (linha, i) {
    naCerca = cerca(naCerca, linha);
    const cab = linha.match(RE_TAREFA);
    if (cab) {
      atual = { n: parseInt(cab[1], 10), titulo: cab[2].trim(), abertos: 0, total: 0, linha: i + 1 };
      nivel = linha.match(/^#+/)[0].length;
      tarefas.push(atual);
      return;
    }
    if (atual && !naCerca && fechaItem(linha, nivel)) { atual = null; return; }
    contarCaixa(atual, linha);
  });
  return tarefas;
}

// D476: o painel le o formato real dos planos (o da 0.7 usa "### Item N —" sem caixas). So o painel: o portao de
// fecho segue no parseTarefas, porque nenhum teste prova que o formato largo nao barraria plano antigo a toa.
const RE_ITEM = /^#{2,4}\s*(Tarefa|Item|Etapa|Onda|Fase)\s+(\d+[a-z]?)\s*(?::|\.|-|—|–)\s*(.+?)\s*$/i;
const RE_FEITO = /\s*(?:\[feito\]|\(feito\))/ig;

/**
 * Estado de um item lido: as caixas mandam ("aberta"/"feita"); sem caixas, [FEITO]/(feito) no cabecalho ou na celula
 * da etapa (`marcadoFeito`) = "feita"; senao "sem marca". P2 #26: o estado tem cinco valores - deduzirPeloEscopo grava
 * os outros dois, "em curso" e "a fazer", nas linhas da tabela; o painel trata os cinco. Plano 083 (p3-9): a tarefa
 * "sem marca" (sem caixa de passo nem [FEITO]) o portao nao cobra, mas o painel nao a da como feita.
 */
function estadoDoItem(t) {
  if (t.abertos > 0) return 'aberta';
  if (t.total > 0) return 'feita';
  return t.marcadoFeito ? 'feita' : 'sem marca';
}

// D509: etapas em tabela (o plano do APP, secao 7). Cabecalho = 1a celula Etapa/Item/Tarefa/Onda/Fase (plural
// vale), seguido da linha |---|; cada linha cujo 1a celula comeca por um id (P0, E1, D1, 2a, 1.2, 2b-0, I0.0) vira
// etapa. [FEITO] so na celula da etapa (a 1a). A linha nao recebe as caixas de baixo: elas seguem no cabecalho de cima.
// Censo s40 dos planos reais: so a 1a tabela com linha de id vale (o plano do APP parte 1 tem, depois das etapas,
// "| Item | Onde |" com os pedidos 51-63), id repetido conta uma vez (tabela de resultado, I0 em 4 linhas), e plano
// com caixa de passo em cabecalho ignora tabela (as caixas mandam; tabela-resumo das tarefas duplicaria).
const RE_TIPO_TABELA = /^(Tarefa|Item|Etapa|Onda|Fase)s?$/i;
const RE_SEP_TABELA = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const ID_ETAPA = '[A-Za-z]{0,3}\\d+[a-z]?(?:[.\\-]\\d+[a-z]?)*';
const RE_ID_CELULA = new RegExp('^(' + ID_ETAPA + ')(?!\\w)\\s*(?:[:.\\-—–]\\s*)?(.*)$');

// D513 #1: "\|" e barra dentro da celula (markdown), nao divisa de coluna.
function celulas(linha) {
  return linha.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(function (c) {
    return c.replace(/\\\|/g, '|').replace(/\*\*/g, '').trim();
  });
}

// P2 #20 (D512): os itens nao tem `n` - o id e a chave ("P1" e "E1", "3a" e "3b" davam o mesmo n).
function itemDaTabela(tabela, linha, i) {
  const cel = celulas(linha);
  const m = cel[0].replace(RE_FEITO, ' ').trim().match(RE_ID_CELULA);
  if (!m) return null;
  return {
    tipo: tabela.tipo, id: m[1],
    titulo: (m[2].trim() || (cel[1] || '').replace(RE_FEITO, '').trim()), marcadoFeito: cel[0].search(RE_FEITO) !== -1,
    abertos: 0, total: 0, linha: i + 1, tabela: true, nTabela: tabela.n
  };
}

// A linha i abre uma tabela qualquer: comeca por "|" e a seguinte e |---|.
function abreTabela(linhas, i) {
  return /^\s*\|/.test(linhas[i]) && RE_SEP_TABELA.test(linhas[i + 1] || '');
}

/**
 * Tipo da tabela de etapas que comeca na linha i (1a celula Etapa/Item/..., a seguinte e |---|), senao null.
 * P2 #18: no singular, como o dos cabecalhos ("| Etapas |" -> "Etapa").
 */
function tipoDaTabelaQueAbre(linhas, i) {
  if (!abreTabela(linhas, i)) return null;
  const tipo = celulas(linhas[i])[0];
  return RE_TIPO_TABELA.test(tipo) ? tipo.replace(/s$/i, '') : null;
}

/**
 * Linha i com uma tabela de etapas aberta. P2 #28: nao e so pergunta - se a linha comeca por "|", ela e da tabela e
 * fica GUARDADA (a etapa entra em `itens` e o id em `tabela.ids`; id repetido conta uma vez; o separador |---| e a
 * linha de celulas vazias, D514 #1, nao viram etapa) e devolve true. Devolve false, sem guardar nada, na 1a linha
 * fora dela: a tabela fechou. D514 #7: o nome diz as duas coisas.
 * P2 #16: linha sem id na 1a celula vai para `tabela.semId` (o painel avisa, se for a tabela que conta).
 */
function guardarSeForDaTabela(tabela, linha, i, itens) {
  if (!/^\s*\|/.test(linha)) return false;
  if (RE_SEP_TABELA.test(linha) || celulas(linha).every(function (c) { return !c; })) return true;
  const item = itemDaTabela(tabela, linha, i);
  if (!item) tabela.semId.push({ linha: i + 1, texto: celulas(linha)[0] });
  else if (!tabela.ids.has(item.id.toLowerCase())) {
    tabela.ids.add(item.id.toLowerCase());
    itens.push(item);
  }
  return true;
}

function itemDoCabecalho(cab, linha, i) {
  return {
    tipo: cab[1], id: cab[2].toLowerCase(),
    titulo: cab[3].replace(RE_FEITO, '').trim(), marcadoFeito: cab[3].search(RE_FEITO) !== -1,
    abertos: 0, total: 0, linha: i + 1, nivel: linha.match(/^#+/)[0].length
  };
}

/**
 * D509 (censo s40): o n da tabela de etapas que conta - a 1a com linha de id -, ou null quando nenhuma conta
 * (nenhuma linha de id, ou algum cabecalho tem caixa de passo: as caixas mandam; tabela-resumo das tarefas duplicaria).
 */
function tabelaQueVale(itens) {
  if (itens.some(function (t) { return !t.tabela && t.total > 0; })) return null;
  const primeira = itens.filter(function (t) { return t.tabela; })[0];
  return primeira ? primeira.nTabela : null;
}

/**
 * R1 da revisao cega: "## Fase 1" que so agrupa "### Tarefa N" (sem caixa propria nem [FEITO], e o item seguinte e
 * um cabecalho mais fundo) nao e tarefa - senao aparecia como [?] num plano todo feito. P2 #19: so cabecalho agrupa;
 * o cabecalho logo antes de uma tabela de etapas fica (sumia calado).
 */
function soAgrupa(t, prox) {
  return !t.tabela && t.total === 0 && !t.marcadoFeito && !!prox && !prox.tabela && prox.nivel > t.nivel;
}

/**
 * Os itens do plano, na ordem: cabecalhos de item e as linhas da tabela de etapas que conta. P2 #16: as linhas sem id
 * dessa tabela vao em `semId` ([{ linha, texto }]) na lista devolvida, so quando ha alguma.
 */
function parseItens(texto) {
  // D513 #2: o BOM (comum no Windows) nao esconde o cabecalho da 1a linha.
  const linhas = String(texto == null ? '' : texto).replace(/^\uFEFF/, '').split(/\r?\n/);
  const itens = [];
  const tabelas = [];
  let atual = null;
  let tabela = null;
  let naCerca = null;
  // Cada linha cai em um so caso, nesta ordem: (1) dentro de uma tabela de etapas aberta; (2) abre uma tabela;
  // (3) cabecalho de item, que passa a receber as caixas; (4) cabecalho que fecha o item (A7-01); (5) caixa, contada
  // no item do cabecalho de cima.
  linhas.forEach(function (linha, i) {
    naCerca = cerca(naCerca, linha);
    // D513 #7: guarda a linha na tabela aberta (a etapa entra em `itens`) e diz se ela era da tabela.
    // R2 da s44: cabecalho com |---| embaixo, mesmo colado, abre outra tabela (nao soma etapas na aberta).
    if (tabela && !abreTabela(linhas, i) && guardarSeForDaTabela(tabela, linha, i, itens)) return;
    tabela = null;
    const tipo = tipoDaTabelaQueAbre(linhas, i);
    if (tipo) {
      // D513 #8: n comeca em 1 (tabelas[n - 1]); tabelaQueVale devolve null quando nenhuma vale, e 0 nunca e um n.
      tabela = { tipo: tipo, n: tabelas.length + 1, ids: new Set(), semId: [] };
      tabelas.push(tabela);
      return;
    }
    const cab = linha.match(RE_ITEM);
    if (cab) {
      atual = itemDoCabecalho(cab, linha, i);
      itens.push(atual);
      return;
    }
    if (atual && !naCerca && fechaItem(linha, atual.nivel)) { atual = null; return; }
    contarCaixa(atual, linha);
  });
  const vale = tabelaQueVale(itens);
  // R1 da s45: linha da tabela com o tipo e o id de um cabecalho e a tabela-resumo dele - conta uma vez, a do
  // cabecalho (sem isso, "### Item 1" e "| 1 |" numa tabela "| Item |" davam 2 itens).
  const chave = function (t) { return (t.tipo + ' ' + t.id).toLowerCase(); };
  const dosCabecalhos = new Set(itens.filter(function (t) { return !t.tabela; }).map(chave));
  const validos = itens.filter(function (t) {
    return !t.tabela || (t.nTabela === vale && !dosCabecalhos.has(chave(t)));
  });
  const tarefas = validos.filter(function (t, i) { return !soAgrupa(t, validos[i + 1]); });
  tarefas.forEach(function (t) { t.estado = estadoDoItem(t); });
  const semId = vale ? tabelas[vale - 1].semId : [];
  if (semId.length) tarefas.semId = semId;
  return tarefas;
}

/**
 * D509: tabela de etapas sem nenhuma marca [FEITO] -> o estado vem da ULTIMA "ETAPA <id>" do Objetivo do escopo que
 * existe na tabela: as linhas antes dela feitas, ela "em curso", as depois "a fazer", todas com `deduzido: true` (o
 * painel avisa e cita o id da "em curso"; P2 #21: o id nao se repete em cada linha). Uma marca na tabela ja manda:
 * nada se deduz. Sem deducao devolve a mesma lista; com deducao, uma lista nova (com o `semId` da original) com as
 * linhas da tabela copiadas e os itens de cabecalho os mesmos.
 */
function deduzirPeloEscopo(itens, objetivo) {
  const lista = Array.isArray(itens) ? itens : [];
  const tab = lista.filter(function (t) { return t.tabela; });
  if (!tab.length || tab.some(function (t) { return t.marcadoFeito; })) return lista;
  const ids = tab.map(function (t) { return t.id.toLowerCase(); });
  const re = new RegExp('\\betapa[ \\t]+(' + ID_ETAPA + ')(?!\\w)', 'gi');
  const texto = String(objetivo == null ? '' : objetivo);
  let atual = -1;
  let m;
  while ((m = re.exec(texto)) !== null) {
    const k = ids.indexOf(m[1].toLowerCase());
    if (k !== -1) atual = k;
  }
  if (atual === -1) return lista;
  const nova = lista.map(function (t) {
    if (!t.tabela) return t;
    const k = tab.indexOf(t);
    return Object.assign({}, t, { estado: k < atual ? 'feita' : k === atual ? 'em curso' : 'a fazer', deduzido: true });
  });
  if (lista.semId) nova.semId = lista.semId;
  return nova;
}

function lerAtivo(cwd) {
  try {
    // D442/10: JSON gravado no Windows costuma vir com BOM (D124); sem semBom o plano valido sumia calado.
    const o = JSON.parse(require('./texto.js').semBom(fs.readFileSync(path.join(cwd, ATIVO), 'utf8')));
    return o && typeof o === 'object' ? o : null;
  } catch (e) { return null; }
}

function abrir(cwd, arquivoDoPlano, sessionId) {
  const dado = {
    arquivo: String(arquivoDoPlano).replace(/\\/g, '/'),
    sessionId: String(sessionId || 'sem-sessao'),
    tarefa: null
  };
  const alvo = path.join(cwd, ATIVO);
  // Plano 082 (p7-16): o erro do disco (EACCES, ENOSPC, pasta que e arquivo) sobe com o arquivo e o que fazer, sem stack.
  // Plano 083 (p3-14): com acento e a causa em palavras (o --abrir e comando, nao aviso de gancho: fora da R5).
  try {
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, JSON.stringify(dado, null, 2) + '\n', 'utf8');
  } catch (e) {
    throw new Error('Não consegui gravar ' + alvo + ': ' + causaDoDisco(e) + '. Corrija isso e rode de novo; o plano ' +
      'não foi aberto.');
  }
  return dado;
}

// Plano 083 (p3-14, p3-23): o erro do disco em palavras, com o codigo entre parenteses para o registro do defeito.
const CAUSA_DO_DISCO = {
  EACCES: 'sem permissão', EPERM: 'sem permissão', ENOSPC: 'disco cheio', EROFS: 'o disco só permite leitura',
  ENOENT: 'o arquivo ou a pasta não existe', EISDIR: 'o caminho é uma pasta, não um arquivo',
  ENOTDIR: 'um arquivo ocupa o lugar de uma pasta no caminho', EEXIST: 'um arquivo ocupa o lugar de uma pasta no caminho'
};

function causaDoDisco(e) {
  const code = e && typeof e.code === 'string' ? e.code : '';
  const palavras = Object.prototype.hasOwnProperty.call(CAUSA_DO_DISCO, code) ? CAUSA_DO_DISCO[code]
    : limpo(e && e.message ? e.message : String(e));
  return palavras + (code ? ' (' + code + ')' : '');
}

/** Plano 082 (p7-5): o --abrir aceita caminho absoluto; o path.join o colava no cwd e a leitura dava ENOENT. */
function caminhoDoPlano(cwd, arquivo) { return path.resolve(cwd, String(arquivo)); }

/**
 * D476 (Tarefa 4 da 0.7.1): nada chamava `plano.js --abrir`, e o painel dizia "nenhum plano ativo" numa sessao
 * que trabalhava num plano. Sem plano-ativo.json, o plano vem do Objetivo da frente: o ULTIMO "Plano: <caminho>"
 * (a frente acumula planos; o mais novo fica no fim). Pontuacao que fecha a frase nao e do caminho.
 * R1 da revisao cega: caminho com espaco vai entre crases ou aspas; sem elas, vale ate o primeiro espaco.
 * R2: aceita `**Plano:**` do markdown e aspas simples; nao atravessa linha; aspa sem fechar e valor vazio nao contam
 * (nem apagam o "Plano:" anterior).
 */
function planosDoObjetivo(objetivo) {
  const re = /\bPlano:(?:\*\*)?[ \t]*(?:\*\*)?(?:`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)'|([^\s`"'][^\s]*))/g;
  const texto = String(objetivo == null ? '' : objetivo);
  const achados = [];
  let m;
  while ((m = re.exec(texto)) !== null) {
    const c = m[4] != null ? m[4].replace(/[.,;:)\]*'"`!?]+$/, '') : (m[1] || m[2] || m[3]).trim();
    if (c) achados.push(c);
  }
  return achados;
}

/**
 * D502: a forma que as sessoes ja escrevem sem "Plano:" - `plano \`x.md\`` (qualquer caixa, sem dois-pontos). So com
 * crase ou aspas e .md: "plano" solto aparecia 13x nos Objetivos ("plano 0.7.3", "plano 074)", "plano §3").
 */
function planosCitados(objetivo) {
  const re = /\bplano[ \t]+(?:`([^`\n]+\.md)`|"([^"\n]+\.md)"|'([^'\n]+\.md)')/gi;
  const texto = String(objetivo == null ? '' : objetivo);
  const achados = [];
  let m;
  while ((m = re.exec(texto)) !== null) achados.push((m[1] || m[2] || m[3]).trim());
  return achados;
}

/**
 * P2 #3: so o ULTIMO "Plano:" declarado, sem olhar o disco nem a forma citada (`plano \`x.md\``). Nao e o que o painel
 * usa - o painel usa planoNoDisco (declarados e citados, o que existe no disco); esta fica para os testes do leitor
 * de "Plano:" (R1, R2).
 */
function planoDoObjetivo(objetivo) {
  const achados = planosDoObjetivo(objetivo);
  return achados.length ? achados[achados.length - 1] : null;
}

function ultimoNoDisco(cwd, achados) {
  for (let i = achados.length - 1; i >= 0; i--) {
    try { if (fs.existsSync(path.join(cwd, achados[i]))) return achados[i]; } catch (e) { /* segue */ }
  }
  return null;
}

/**
 * R2: com varios "Plano:", vale o ultimo que existe no disco (um "Plano: pendente" no fim nao apaga o real).
 * D502: "Plano:" ganha do `plano \`x.md\`` citado; o citado so vale quando nenhum "Plano:" existe no disco.
 */
function planoNoDisco(cwd, objetivo) {
  const declarados = planosDoObjetivo(objetivo);
  const citados = planosCitados(objetivo);
  const achado = ultimoNoDisco(cwd, declarados) || ultimoNoDisco(cwd, citados);
  if (achado) return achado;
  if (declarados.length) return declarados[declarados.length - 1];
  return citados.length ? citados[citados.length - 1] : null;
}

/** null = o arquivo nao se le (R1: nao confundir com Objetivo sem "Plano:"). */
function objetivoDoArquivo(abs) {
  try { return escopoLib.parse(fs.readFileSync(abs, 'utf8')).objetivo || ''; } catch (e) { return null; }
}

/**
 * D476: as frentes da pasta que declaram plano no Objetivo, em ordem de nome. R2: a frente cujo arquivo nao se le
 * entra com `ilegivel` (antes sumia da lista calada).
 */
function frentesComPlano(cwd) {
  const pasta = path.join(cwd, escopoLib.PASTA_FRENTES);
  let nomes = [];
  try {
    nomes = fs.readdirSync(pasta).filter(function (n) { return n.toLowerCase().slice(-3) === '.md'; }).sort();
  } catch (e) { nomes = []; }
  return nomes.map(function (n) {
    const objetivo = objetivoDoArquivo(path.join(pasta, n));
    if (objetivo === null) return { frente: n.slice(0, -3), arquivo: null, ilegivel: escopoLib.PASTA_FRENTES + n };
    return { frente: n.slice(0, -3), arquivo: planoNoDisco(cwd, objetivo), objetivo: objetivo };
  }).filter(function (f) { return f.arquivo || f.ilegivel; });
}

/**
 * D476: a frente vinculada a sessao manda (sem "Plano:" no Objetivo dela, o painel diz isso, nao pega o de outra).
 * D502: sem vinculo, o escopo em vigor da sessao e o escopo.md da raiz - plano nele -> ele (`escopo: true`); a
 * sessao de outra frente via o plano desta. Sem plano ali: uma frente com plano no disco -> ela, marcada
 * `semVinculo`; varias -> { varias } para o painel listar. Nada -> null.
 */
function acharPlanoDaFrente(cwd, frenteVinculada) {
  if (frenteVinculada) {
    const rel = escopoLib.arquivoEmVigor(cwd, frenteVinculada);
    if (rel !== escopoLib.ARQUIVO) {
      const objetivo = objetivoDoArquivo(path.join(cwd, rel));
      if (objetivo === null) return { frente: escopoLib.nomeSeguro(frenteVinculada), arquivo: null, ilegivel: rel };
      return { frente: escopoLib.nomeSeguro(frenteVinculada), arquivo: planoNoDisco(cwd, objetivo), objetivo: objetivo };
    }
  }
  const absRaiz = path.join(cwd, escopoLib.ARQUIVO);
  const daRaiz = objetivoDoArquivo(absRaiz);
  // R1 da revisao cega (estados): escopo.md presente que nao se le e dito, como o da frente; ausente e normal.
  if (daRaiz === null && fs.existsSync(absRaiz)) return { escopo: escopoLib.ARQUIVO, arquivo: null, ilegivel: escopoLib.ARQUIVO };
  // Plano declarado ali que nao existe no disco segue sendo o desta sessao: o painel diz que nao o le (como na frente).
  const planoDaRaiz = daRaiz ? planoNoDisco(cwd, daRaiz) : null;
  if (planoDaRaiz) return { escopo: escopoLib.ARQUIVO, arquivo: planoDaRaiz, objetivo: daRaiz };
  const lista = frentesComPlano(cwd);
  if (lista.length === 1) return Object.assign({ semVinculo: true }, lista[0]);
  if (lista.length > 1) return { varias: lista };
  return null;
}

/**
 * D502: sessoes gastas = marcas DISTINTAS "(sN" / "(sessao N" no arquivo do plano (cada sessao anota a sua ao
 * marcar a caixa). Era o Objetivo da frente inteira (D476): 41 sessoes para um plano de 2. Marca logo depois de
 * crase e exemplo citado (`(s37`), nao conta: o plano 078 contava 3 com 1 sessao. P2 #9: a lista "(s1, s2: ...)" ou
 * "(s1 e s2)" conta cada uma; so numero com "s"/"sessao" na frente ("(s5, dois)", "(sessao 3, 2026-10-13)").
 */
function sessoesDoPlano(texto) {
  const marca = '(?:s|sess[aã]o\\s+)\\d+';
  const re = new RegExp('(?<!`)\\((' + marca + '(?:(?:\\s*,\\s*|\\s+e\\s+)' + marca + ')*)(?!\\w)', 'gi');
  const vistas = new Set();
  const t = String(texto == null ? '' : texto);
  let m;
  while ((m = re.exec(t)) !== null) {
    for (const n of m[1].match(/\d+/g)) vistas.add(parseInt(n, 10));
  }
  return vistas.size;
}

/**
 * P2 #6 (D512): o plano tirado do Objetivo (frente ou escopo.md) so se le dentro da pasta do projeto - "Plano:
 * ../fora.md" fazia o painel ler qualquer arquivo. O --abrir segue livre: quem roda escolhe o caminho.
 */
function dentroDoProjeto(cwd, rel) {
  const r = path.relative(path.resolve(cwd), path.resolve(cwd, String(rel)));
  return r.split(/[\\/]/)[0] !== '..' && !path.isAbsolute(r);
}

/**
 * D476: (sessoes / feitas) x as que faltam, arredondada. Sem tarefa feita, ou sem nenhuma marca de sessao (R1: a
 * media 0 dava "0 sessoes" com trabalho pela frente), nao ha base (null).
 */
function estimativaDeSessoes(sessoes, feitas, faltam) {
  if (!(feitas > 0) || !(sessoes > 0)) return null;
  const media = sessoes / feitas;
  // R2: com trabalho pela frente, nunca "0 sessoes" (media < 0,5 com 1 que falta arredondava para 0).
  return { sessoes: faltam > 0 ? Math.max(1, Math.round(media * faltam)) : 0, media: media };
}

/*
 * Plano 082 (mock D532, S5): os paineis do /sworn-plan sao lidos como Markdown no VS Code (D442/2) e saem com
 * acento (D532; era ASCII pela R5). Sem "painel do plano" no topo: o motor ja escreve o nome do plugin antes. O texto
 * que vem do plano ou do disco passa por `limpo`; comando, caminho com `<...>` e mensagem de erro vao por `codigo`
 * (o Markdown leria `<caminho do plano>` como tag e o apagaria).
 */

/** Uma linha so, e caractere de controle vira "?" (o que o ascii fazia, sem tirar o acento). */
function limpo(v) { return umaLinha(v).replace(/[\u0000-\u001F\u007F-\u009F]/g, '?'); }

/**
 * Plano 083 (p3-4): titulo e id que vem do plano, escapados para o Markdown do painel - `<config>` sumia como tag e
 * `*x*` virava italico. O trecho entre crases fica como veio: o plano o escreve como codigo de proposito (mock S5,
 * D532: "chave `referencias`"), e la dentro a barra apareceria. So nos itens do plano; caminho e comando seguem por
 * `codigo`.
 */
function doPlano(v) {
  return limpo(v).split(/(`+[^`]*?`+)/).map(function (parte, i) {
    return i % 2 ? parte : parte.replace(/[\\*_<>[\]]/g, '\\$&');
  }).join('');
}

/** Trecho de codigo em Markdown: a cerca tem uma crase a mais que a maior sequencia de crases do texto. */
function codigo(v) {
  const s = limpo(v);
  const maior = (s.match(/`+/g) || []).reduce(function (m, c) { return Math.max(m, c.length); }, 0);
  const cerca = '`'.repeat(maior + 1);
  const folga = maior ? ' ' : '';
  return cerca + folga + s + folga + cerca;
}

/** D476: varias frentes com plano e a sessao sem vinculo - lista e diz como escolher. */
function painelVariasFrentes(lista, script) {
  const linhas = ['Nenhum plano ativo, e esta sessão não está ligada a nenhuma frente (frente = linha de trabalho com ' +
    'arquivo próprio em ' + escopoLib.PASTA_FRENTES + '). Frentes com plano:', ''];
  for (const f of lista) {
    linhas.push('- ' + limpo(f.frente) + ': ' + (f.arquivo ? limpo(f.arquivo) : '(o arquivo da frente não se lê)'));
  }
  linhas.push('', 'Para escolher, edite o arquivo da frente que você quer, ' + codigo(escopoLib.PASTA_FRENTES + '<frente>.md') +
    ' (qualquer edição liga esta sessão a ela), e rode /sworn-plan de novo. Ou abra um plano: ' +
    codigo(comandoDeAbrir(script)));
  return linhas.join('\n');
}

/** R1 da revisao cega: o arquivo da frente vinculada existe mas nao se le - nao e "frente sem Plano:". */
function painelFrenteIlegivel(frente, rel) {
  // R1 da revisao cega D502: sem frente, quem nao se le e o escopo.md da raiz.
  return 'Não consegui ler ' + (frente ? 'o arquivo da frente ' + limpo(frente) + ' (' + limpo(rel) + ')'
    : 'o escopo ' + limpo(rel)) + '. Confira se ele é um arquivo e se abre, e rode /sworn-plan de novo.';
}

/** D476: a frente vinculada nao declara plano no Objetivo. P2 #4: cita as duas formas que o leitor aceita. */
function painelFrenteSemPlano(frente, script) {
  return 'A frente ' + limpo(frente) + ' não declara plano no Objetivo (o parágrafo ' + codigo('**Objetivo:**') + ' de ' +
    escopoLib.PASTA_FRENTES + limpo(frente) + '.md). Anote no fim dele ' + codigo('Plano: <caminho>') + ' (ou ' +
    codigo('plano `<caminho>.md`') + ', entre crases), ou abra um plano: ' + codigo(comandoDeAbrir(script));
}

/** R2 da revisao cega: o plano anotado nao se le; da frente, o caminho com espaco e sem crases chega cortado. */
function painelNaoLeu(arquivo, daFrente) {
  return 'Não consegui ler o plano ' + limpo(arquivo) + '. Confira se o arquivo existe' + (daFrente
    ? '; se o caminho tem espaço, ponha-o entre crases no Objetivo: ' + codigo('Plano: `meu plano.md`') : '') + '.';
}

/**
 * F17: outra sessao detem este plano - o plano-ativo.json tem sessionId e ele nao e o desta sessao. Sem plano ativo,
 * ou com plano ativo sem sessionId (gravado a mao), o plano conta como livre (false). Sessao sem id vale 'sem-sessao',
 * o mesmo que abrir() grava.
 */
function donoOutro(ativo, sessionId) {
  if (!ativo || !ativo.sessionId) return false;
  return ativo.sessionId !== String(sessionId || 'sem-sessao');
}

/**
 * O erro cometido nesta sessao: numerar decisao pela memoria do ultimo numero escrito.
 * Numero de decisao se le do disco, sempre.
 */
function proximaDecisao(arquivoDeDecisoes) {
  let texto;
  try { texto = fs.readFileSync(arquivoDeDecisoes, 'utf8'); } catch (e) { return 1; }
  let maior = 0;
  const re = /^#{2,4}\s*D(\d+)\b/gim;
  let m;
  while ((m = re.exec(texto)) !== null) {
    const n = parseInt(m[1], 10);
    if (n > maior) maior = n;
  }
  return maior + 1;
}

// N1: roda no gancho Stop, tem de ser linear. O texto passa antes por `\s+ -> ' '`: com um unico espaco
// entre os tokens, o regex nao tem `\s+`/`\s*` adjacentes nem aninhados (era o backtracking quadratico).
// N2: plural ("tarefas", "as tarefas") e lista de numeros ("1 e 2", "3, 4 e 5"), com os auxiliares
// plurais ("estao", "foram"). Sem o nome da tarefa dentro da lista: cada nome da cadeia ("tarefa 1 e
// tarefa 2 concluidas") ja casa sozinho, e a lista nao atravessa outro nome (cada inicio e local).
// Mesmas duas formas do RE_ALEGA_N de scripts/portao-fecho.js (paridade em test/portao-fecho.test.js).
// D442/8 (S-47, S-48): o id aceita "nº 3", "7b" e "1.2"; entre o id e o participio, ":"/"-"/travessao e "ja";
// na 2a forma o verbo e passado ou participio (concluí, fechei, fechamos, fechada): "vou concluir a tarefa",
// "antes de fechar a etapa" e "concluindo" deixam de alegar. Na 1a forma "complet" so como participio/adjetivo
// ("completa", "completado"): com o separador, "Tarefa 3: completar os testes" alegava.
const RE_CONCLUIDA = /\b(?:tarefa|etapa|onda|fase)s? (?:(?:n[º°.] ?)?\d+(?:\.\d+)*(?:[a-z](?![a-z]))?(?: ?(?:,|e) ?(?:n[º°.] ?)?\d+(?:\.\d+)*(?:[a-z](?![a-z]))?)* ?)?(?:[:\-–—] ?)?(?:j[aá] )?(?:est[aá] |est[aã]o |foi |foram )?(?:conclu[ií]d|fechad|finalizad|pronta|complet(?:[ao]s?|ad[ao]s?)\b)|\b(?:conclu(?:[ií](?:mos|ram|u|d[ao]s?)?)|(?:fech|finaliz|complet)(?:ei|ou|amos|aram|ad[ao]s?)) (?:(?:as|os|a|o) )?(?:tarefa|etapa|onda|fase)s?\b/i;

function alegaEtapaConcluida(texto) {
  return RE_CONCLUIDA.test(String(texto == null ? '' : texto).replace(/\s+/g, ' '));
}

function motivoSubitemAberto(tarefa) {
  return [
    'sworn - subitem pendente = etapa aberta.',
    '',
    // Plano 083 (p3-13): sem a bronca do fim; ASCII pela R5 (aviso do gancho Stop, D532), sem o acento do painel.
    'A resposta da a etapa como concluida, mas a Tarefa ' + tarefa.n + ' ("' + tarefa.titulo + '")',
    'ainda tem ' + tarefa.abertos + ' de ' + tarefa.total + ' passos sem marcar no plano.',
    '',
    'Faca uma destas:',
    '  1. execute os passos que faltam e marque as caixas; ou',
    '  2. diga que a etapa segue aberta, e qual passo ficou pendente.',
    '',
    'A etapa fecha quando todos os passos dela estao marcados.'
  ].join('\n');
}

/**
 * D442/3: o comando de abrir com o caminho real do plano.js (quem roda o script sabe onde ele esta), entre aspas.
 * Caminho fora de ASCII (R5) ou com `$`, crase ou `"` (o shell reinterpretaria) volta ao marcador, sem inventar.
 */
function comandoDeAbrir(script) {
  const cabeEntreAspas = typeof script === 'string' && /^[\x20-\x7E]+$/.test(script) && !/[$`"]/.test(script);
  return 'node ' + (cabeEntreAspas ? '"' + script + '"' : '<pasta do plugin sworn>/scripts/plano.js') + ' --abrir <caminho do plano>';
}

/** P2 #6: o plano do Objetivo fora da pasta do projeto - diz por que nao le e as duas saidas. */
function painelPlanoFora(arquivo, script) {
  return 'O plano ' + limpo(arquivo) + ' fica fora da pasta do projeto, e o painel só lê plano anotado no Objetivo ' +
    'dentro dela. Anote um caminho relativo à pasta do projeto, ou abra o plano: ' + codigo(comandoDeAbrir(script));
}

/**
 * P2 #8 e #15: o plano foi lido e a conta falhou - nao e "nao consegui ler". R1 da s43: diz o que fazer agora; a
 * mensagem da excecao fica, entre parenteses, porque e ela que vai no registro do defeito. p7-11 (mock D532, S5): diz
 * o que copiar e onde colar.
 */
function painelQueFalhou(arquivo, erro) {
  return 'Li o plano ' + limpo(arquivo) + ', mas o painel falhou ao contar as tarefas. Veja as tarefas direto no ' +
    'arquivo do plano. Para avisar o defeito, copie a mensagem entre parênteses (' +
    codigo(erro && erro.message ? erro.message : String(erro)) + ') e cole no chat com o pedido "registrar defeito do ' +
    'sworn".';
}

/** D442/10: plano-ativo.json presente que nao se le (JSON quebrado, sem "arquivo") nao e "nenhum plano ativo". */
function painelIlegivel(script) {
  return 'O arquivo .claude/sworn/plano-ativo.json existe, mas não se lê (JSON quebrado, ou sem o campo "arquivo"). ' +
    'Abra o plano de novo: ' + codigo(comandoDeAbrir(script));
}

/** P2 #16: as linhas da tabela de etapas sem id nao somem caladas (cita ate 3, com o numero da linha). */
function avisoDeLinhasSemId(semId) {
  const um = semId.length === 1;
  const citadas = semId.slice(0, 3).map(function (s) { return s.linha + ': "' + limpo(s.texto) + '"'; });
  return 'Aviso: ' + semId.length + (um ? ' linha' : ' linhas') + ' da tabela de etapas sem id no começo da 1ª célula ' +
    (um ? 'ficou' : 'ficaram') + ' fora da conta (' + (um ? 'linha ' : 'linhas ') + citadas.join(', ') +
    (semId.length > 3 ? ', ...' : '') + '); para contar, comece a 1ª célula pelo id (P0, 2a, 2b-0).';
}

/**
 * Bloco M / M2 (D435): o painel do plano em texto - o que o /sworn-plan do mod responde. Mostra a vista o que o
 * portao de fecho so barra no fim: passo aberto = tarefa aberta. Plano 082 (mock D532, S5): titulo "Plano X — N de M
 * tarefas" (ou "concluído"), linha fraca com a origem e o caminho, a lista e o bloco "Ritmo", em Markdown e com acento.
 * D442/3: `script` e o caminho do plano.js para o "como abrir"; sem ele, o marcador.
 * D514 #19: quem monta os argumentos e o chamador (scripts/plano.js --texto): `ativo` vem do plano-ativo.json
 * (lerAtivo: arquivo, sessionId) ou de acharPlanoDaFrente (arquivo, frente, objetivo, escopo, semVinculo), e ele
 * anexa `sessoesDoPlano` (sessoesDoPlano do texto do plano; sem ele, as sessoes saem "nao contadas"); `tarefas` e
 * deduzirPeloEscopo(parseItens(texto), objetivo) - sem a deducao, a tabela sem marca sai toda [?].
 */
function painelTexto(ativo, tarefas, script) {
  if (!ativo || !ativo.arquivo) {
    return 'Nenhum plano ativo nesta sessão: não há .claude/sworn/plano-ativo.json nem plano anotado na frente ou no ' +
      'escopo. Para abrir um: ' + codigo(comandoDeAbrir(script));
  }
  const lista = Array.isArray(tarefas) ? tarefas : [];
  const estado = function (t) { return t.estado; };
  const resumo = resumoDoPlano(lista);
  const feitas = resumo.feitas;
  const faltam = resumo.faltam;
  // Plano 083 (p3-8): o titulo em ifs, um por caso (era um ternario aninhado, como o da D514 #10).
  let titulo = 'Plano ' + nomeCurto(ativo);
  if (lista.length) {
    const conta = contaDoPlano(lista, feitas.length);
    titulo += faltam.length ? ' — ' + conta : ' — concluído (' + conta + ')';
  }
  const blocos = ['**' + titulo + '**', origemDoPlano(ativo)];
  if (!lista.length) {
    blocos.push('O plano não tem cabeçalhos ' + codigo('### Tarefa N: título') + ' (nem Item/Etapa/Onda/Fase N) nem ' +
      'tabela de etapas (1ª coluna "Etapa"): o painel não consegue contar as tarefas. Para contar, escreva as tarefas ' +
      'num desses formatos.');
    return blocos.join('\n\n');
  }
  // D476: os itens vem do parseItens (tipo, id, estado), com o acento e o travessao do plano (D532).
  // Plano 083 (p3-4): o que vem do plano passa por doPlano (Markdown escapado).
  const rotulo = function (t) { return doPlano(t.tipo) + ' ' + doPlano(t.id); };
  // P2 #17: etapa de tabela sem titulo nao deixa a linha cortada em "Etapa P0: ".
  const tituloDe = function (t) { return doPlano(t.titulo) || '(sem título)'; };
  // R1 da s43: uma linha por estado (tres de estadoDoItem, dois de deduzirPeloEscopo); estado que nao esta aqui cai no [?].
  // D513 #18: estado novo tambem pede `p`, `semCaixas` e `faltam`, abaixo. #19: "a fazer" e `[ ]` sem passos de
  // proposito - a etapa nao comecou; "aberta" diz quantos passos faltam.
  const linhaDoItem = function (t) {
    const item = rotulo(t) + ': ' + tituloDe(t);
    switch (estado(t)) {
      case 'aberta': return '- [ ] ' + item + ' (' + t.abertos + ' de ' + t.total + ' passos abertos)';
      case 'feita': return '- [x] ' + item;
      case 'em curso': return '- [>] ' + item + ' (em curso, pelo escopo)';
      case 'a fazer': return '- [ ] ' + item;
      case 'sem marca': // D513 #17: o default e so a rede do estado que ninguem pos aqui
      default: return '- [?] ' + item + (t.tabela
        ? ' (sem [FEITO] na célula da etapa: o painel não sabe se está feita)'
        : ' (sem caixas de passo nem [FEITO]: o painel não sabe se está feita)');
    }
  };
  blocos.push(lista.map(linhaDoItem).join('\n'));
  // D509: estado da tabela deduzido pela "ETAPA <id>" do Objetivo - o painel diz que deduziu e como marcar.
  // P2 #23: em frases curtas, com o que e o Objetivo, e sem "deduzido".
  const deduzida = lista.filter(function (t) { return t.deduzido && t.estado === 'em curso'; })[0];
  if (deduzida) {
    blocos.push('Estado pelo escopo: a tabela não tem [FEITO], então o painel segue o Objetivo do escopo (o parágrafo ' +
      '"Objetivo:"), que diz ETAPA ' + doPlano(deduzida.id) + '. As etapas antes dela contam como feitas, e ela como em ' +
      'curso. Para não depender disso, ponha [FEITO] na 1ª célula de cada etapa feita.');
  }
  if (Array.isArray(lista.semId) && lista.semId.length) blocos.push(avisoDeLinhasSemId(lista.semId));
  const ritmo = [];
  if (faltam.length) {
    // D514 #10: a "proxima" em ifs, um por caso (era um ternario de 4 saidas).
    const p = resumo.proxima;
    const semCaixas = resumo.semCaixas;
    let proxima;
    if (p && estado(p) === 'em curso') proxima = rotulo(p) + ' — ' + tituloDe(p) + ' (em curso, pelo escopo)';
    else if (p) proxima = rotulo(p) + ' — ' + tituloDe(p) + ' (faltam ' + p.abertos + ' de ' + p.total + ' passos)';
    // D436: so tarefa sem caixa sobrando nao e plano acabado - o painel nao sabe se ela esta feita.
    else if (semCaixas) proxima = 'nenhuma tarefa com passo aberto; ' + semCaixas + ' sem caixas de passo, confira à mão';
    else proxima = 'nenhuma tarefa aberta';
    ritmo.push('- próxima: ' + proxima,
      '- falta: ' + faltam.length + ' de ' + lista.length + ' (' + faltam.map(rotulo).join(', ') + ')');
  }
  ritmo.push(linhaDeSessoes(ativo, feitas.length, faltam.length));
  blocos.push(['**Ritmo**'].concat(ritmo).join('\n'));
  return blocos.join('\n\n');
}

/**
 * D502 / P2 #1 / P2 #2: a linha fraca do painel - de onde veio o plano e o caminho dele. Escopo da raiz (sessao sem
 * vinculo), frente (e, sem vinculo, como ligar) ou plano-ativo.json (o dono; pode ter sido editado a mao).
 */
function origemDoPlano(ativo) {
  const arquivo = limpo(ativo.arquivo);
  if (ativo.escopo) return 'anotado no escopo desta sessão (' + limpo(ativo.escopo) + ') · ' + arquivo;
  if (ativo.frente) {
    return 'frente ' + limpo(ativo.frente) + ' · ' + arquivo + (ativo.semVinculo ? ' · esta sessão não está ligada a ' +
      'ela; para ligar, edite ' + escopoLib.PASTA_FRENTES + limpo(ativo.frente) + '.md' : '');
  }
  return 'plano ativo (dono: ' + limpo(ativo.sessionId || 'sem-sessao') + ') · ' + arquivo;
}

/**
 * D476 (item 4): as sessoes gastas e a estimativa com a base da conta, num item do "Ritmo" (mock D532, S5: "7 sessões
 * gastas · nada falta"). D502: a conta e a do plano, com frente ou aberto por --abrir. Quem preenche
 * `ativo.sessoesDoPlano` e o chamador, nao este arquivo: scripts/plano.js --texto le o arquivo do plano e anexa
 * sessoesDoPlano(texto) a copia do `ativo` (abrir() e acharPlanoDaFrente() nao o preenchem); se a leitura falha, ele
 * sai antes de chamar o painel.
 */
// Plano 083 (p3-10): `nFeitas` e `nFaltam` sao contagens; `resumo.feitas` e `resumo.faltam` sao as listas.
function linhaDeSessoes(ativo, nFeitas, nFaltam) {
  // P2 #5: "3" de um plano-ativo.json editado a mao vale 3; o que nao e inteiro positivo nao conta.
  const lido = Number(ativo.sessoesDoPlano);
  const gastas = Number.isInteger(lido) && lido > 0 ? lido : 0;
  if (!gastas) {
    // Plano 083 (p3-15): a orientacao numa linha propria, com exemplo no lugar do "(sN: o que fez)".
    return nFaltam
      ? '- sessões gastas: não contadas (o plano não tem marca de sessão)\n- para contar: ao marcar uma caixa, anote a ' +
        'sessão entre parênteses, por exemplo "(s3: ajustei o painel)" na 3ª sessão. Sem as marcas, não há base para estimar.'
      : '- nada falta · sessões gastas não contadas (o plano não tem marca de sessão)';
  }
  const sessoes = function (n) { return n + (n === 1 ? ' sessão' : ' sessões'); };
  const ja = '- ' + sessoes(gastas) + (gastas === 1 ? ' gasta' : ' gastas');
  if (!nFaltam) return ja + ' · nada falta';
  const est = estimativaDeSessoes(gastas, nFeitas, nFaltam);
  if (!est) return ja + ' · estimativa: sem base ainda (nenhuma tarefa feita)';
  const media = est.media.toFixed(1).replace('.', ',') + (est.media === 1 ? ' sessão' : ' sessões');
  return ja + ' · estimativa: ' + sessoes(est.sessoes) + ' para ' +
    (nFaltam === 1 ? 'a 1 que falta' : 'as ' + nFaltam + ' que faltam') + ' (média de ' + media +
    ' por tarefa feita = ' + sessoes(gastas) + ' / ' + nFeitas + (nFeitas === 1 ? ' feita)' : ' feitas)');
}

const TITULO_NA_LINHA = 48;

/**
 * Plano 082 (p7-2): teto, em bytes no disco, do plano que a faixa le a cada medida. Acima dele a faixa fica vazia, e o
 * /sworn-plan (que roda so quando pedido) le igual. Plano 083 (p3-12): se um plano de verdade passar de 1 MB e a
 * faixa sumir, o teto se sobe aqui (o teste do p7-2 le este numero).
 */
const TETO_DO_PLANO = 1024 * 1024;

/** Pedido 30: o nome do plano sem a data, sem o nome da frente e sem o "-plano" ("...-pendencias-d503-plano.md" -> d503). */
function nomeCurto(ativo) {
  const base = path.basename(String(ativo.arquivo)).replace(/\.md$/i, '');
  // O "-plano" sai antes da frente: com a frente "b", "b-plano" viraria "plano" (achado da mutacao, s53).
  let nome = base.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-plano$/i, '');
  if (ativo.frente && nome.indexOf(ativo.frente + '-') === 0) nome = nome.slice(ativo.frente.length + 1);
  return escopoLib.ascii(nome || base);
}

// Plano 082 (p7-9): a unidade da conta, pelo tipo das linhas (os de RE_ITEM); singular no total 1.
const UNIDADE = { tarefa: ['tarefa', 'tarefas'], etapa: ['etapa', 'etapas'], fase: ['fase', 'fases'],
  onda: ['onda', 'ondas'], item: ['item', 'itens'] };

/** Uma linha so: espaco, tab e quebra viram um espaco (o texto vem do plano, que o dono escreve). */
function umaLinha(v) { return String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim(); }

/**
 * Plano 082 (p7-6): feitas, faltam e proxima, uma regra so para o painel e a faixa (eram copiadas nos dois). A proxima
 * e a 1a aberta ou em curso; `semCaixas` conta as sem marca.
 */
function resumoDoPlano(lista) {
  return {
    feitas: lista.filter(function (t) { return t.estado === 'feita'; }),
    // D476 (item 4): o que falta e tudo que nao esta feito, inclusive o [?].
    faltam: lista.filter(function (t) { return t.estado !== 'feita'; }),
    proxima: lista.filter(function (t) { return t.estado === 'aberta' || t.estado === 'em curso'; })[0],
    semCaixas: lista.filter(function (t) { return t.estado === 'sem marca'; }).length
  };
}

/** "N de M tarefas" da faixa e do painel (S1 e S5): a unidade pelo tipo das linhas, "itens" se misturam. */
function contaDoPlano(lista, nFeitas) {
  const tipos = lista.map(function (t) { return umaLinha(t.tipo).toLowerCase(); });
  const par = UNIDADE[tipos.every(function (t) { return t === tipos[0]; }) ? tipos[0] : 'item'] || UNIDADE.item;
  return nFeitas + ' de ' + lista.length + ' ' + par[lista.length === 1 ? 0 : 1];
}

/**
 * Pedido 30 (plano dos pedidos 30-32, Tarefa 2): o plano em UMA linha, para a faixa do mod - a sonda da s53 provou
 * que o status do VS Code desenha uma linha so. `ativo` e `tarefas` como no painelTexto. Sem plano, ou plano sem
 * tarefa contavel, '' (a faixa nao mostra nada). A proxima e a mesma do painel: a 1a aberta ou em curso.
 * Plano 082 (mock D532, S1): " · " entre as partes, a unidade depois da conta, "concluído" quando nada falta, e acento
 * (D532: a sonda da Tarefa 1 viu o acento inteiro na faixa; o painel do /sworn-plan ganhou acento na Tarefa 4).
 */
function linhaDoPlano(ativo, tarefas) {
  if (!ativo || !ativo.arquivo) return '';
  const lista = Array.isArray(tarefas) ? tarefas : [];
  if (!lista.length) return '';
  const resumo = resumoDoPlano(lista);
  const conta = contaDoPlano(lista, resumo.feitas.length);
  const p = resumo.proxima;
  // D436, como no painel: so tarefa sem caixa sobrando nao e plano acabado.
  const semCaixas = resumo.semCaixas;
  const partes = ['plano ' + nomeCurto(ativo)];
  if (p) {
    const titulo = umaLinha(p.titulo);
    // Plano 083 (p3-2): o corte nao parte um emoji (par substituto) ao meio - recua um se cairia entre os dois.
    let corte = TITULO_NA_LINHA - 3;
    if (/[\uD800-\uDBFF]/.test(titulo.charAt(corte - 1))) corte--;
    partes.push(conta, 'próxima: ' + umaLinha(p.tipo) + ' ' + umaLinha(p.id) + (titulo ? ' — ' +
      (titulo.length > TITULO_NA_LINHA ? titulo.slice(0, corte) + '...' : titulo) : ''));
  } else if (semCaixas) {
    partes.push(conta, semCaixas + ' sem caixas, confira à mão');
  } else {
    partes.push('concluído (' + conta + ')');
  }
  // p7-7: a linha da tabela sem id nao entra no "N de M" (P2 #16, como no painel); a faixa diz quantas ficaram fora.
  const fora = Array.isArray(lista.semId) ? lista.semId.length : 0;
  if (fora) partes.push(fora + (fora === 1 ? ' linha' : ' linhas') + ' da tabela fora da conta');
  return partes.join(' · ');
}

/**
 * Pedido 30: a linha do plano desta sessao, para o scripts/sessao.js (roda a cada medida). Acha o plano na ordem do
 * `plano.js --texto` - plano-ativo.json legivel, senao o da frente vinculada (`frente`) ou o do escopo.md. O que no
 * painel vira explicacao (varias frentes, ilegivel, sem plano, fora do projeto, erro) aqui e '': a faixa so mostra
 * plano lido; o /sworn-plan segue dizendo o porque. Pedido 70 (D541, revoga em parte a D502): a frente unica com
 * plano, sem vinculo (`semVinculo`), tambem e '' - chat sem plano nao mostra o de outra frente; o painel segue nela.
 */
function linhaDoPlanoDaSessao(cwd, frente) {
  try {
    const ativo = lerAtivo(cwd);
    let alvo = ativo && typeof ativo.arquivo === 'string' && ativo.arquivo ? ativo : null;
    // D442/10, como no painel: plano-ativo.json presente que nao da plano nao cai na frente.
    if (!alvo && fs.existsSync(path.join(cwd, ATIVO))) return '';
    if (!alvo) {
      const achado = acharPlanoDaFrente(cwd, frente || null);
      if (!achado || !achado.arquivo || achado.semVinculo || !dentroDoProjeto(cwd, achado.arquivo)) return '';
      alvo = achado;
    }
    const abs = caminhoDoPlano(cwd, alvo.arquivo);
    // p7-2: roda a cada medida; plano acima do teto nao se le (a faixa fica vazia, o /sworn-plan segue lendo).
    if (fs.statSync(abs).size > TETO_DO_PLANO) return '';
    const texto = fs.readFileSync(abs, 'utf8');
    return linhaDoPlano(alvo, deduzirPeloEscopo(parseItens(texto), alvo.objetivo));
  } catch (e) { return ''; }
}

module.exports = {
  ATIVO, RE_TAREFA, RE_CAIXA, parseTarefas, parseItens, lerAtivo, abrir, donoOutro, linhaDoPlano, linhaDoPlanoDaSessao,
  proximaDecisao, alegaEtapaConcluida, motivoSubitemAberto, painelTexto, painelIlegivel,
  planoDoObjetivo, planosDoObjetivo, planosCitados, frentesComPlano, acharPlanoDaFrente, painelVariasFrentes,
  painelFrenteSemPlano, sessoesDoPlano, estimativaDeSessoes, painelFrenteIlegivel, deduzirPeloEscopo,
  dentroDoProjeto, painelPlanoFora, painelQueFalhou, painelNaoLeu, caminhoDoPlano, TETO_DO_PLANO, causaDoDisco
};
