'use strict';

/**
 * H6d (15.2, D896): o plano por fatia. Um plano longo (o plano unico passa de 300 KB) lido inteiro a cada chat ou a
 * cada compactacao enche o contexto com o que ja foi feito; o handoff mandava ler "so o cabecalho e o item", mas quem
 * achava os limites era o modelo, a mao. Aqui o corte e deterministico: o cabecalho (o que vem antes da secao da 1a
 * caixa: decisoes, restricoes, mapa) e o item pedido, com as linhas do arquivo.
 *
 * Quem chama: scripts/plano.js (--fatia). Quem aponta para ele: o handoff (handoff-curto.js, a ordem de leitura) e a
 * reinjecao depois da compactacao (reinjecao.js, o bloco do plano em execucao).
 */

// Teto de cada pedaco, em caracteres: o cabecalho do plano unico tem 4,6 mil; uma fase inteira pedida pelo titulo
// pode ter dezenas de milhares, e o corte diz quais linhas ficaram de fora.
const TETO_DO_PEDACO = 16000;

const CAIXA = /^(\s*)-\s*\[( |x|X)\]/;
const TITULO = /^(#{1,6})\s/;

/** Para cada linha, se ela esta dentro de um bloco de codigo (a cerca conta como dentro). Como no CommonMark, a cerca
 *  so fecha com o mesmo caractere, comprimento igual ou maior e nada depois: um ```js dentro de um ```` e conteudo.
 *  Quem usa tambem: handoff-curto.caixaAberta (a proxima caixa aberta sai da mesma regra). */
function dentroDeCerca(linhas) {
  const dentro = [];
  let cerca = null;
  for (const l of linhas) {
    const f = /^\s*(`{3,}|~{3,})(.*)$/.exec(l);
    if (!f) { dentro.push(cerca !== null); continue; }
    if (cerca === null) {
      // A info string de uma cerca de crase nao tem crase: ```npm test``` no comeco da linha e codigo inline, nao cerca.
      if (f[1][0] === '`' && f[2].indexOf('`') !== -1) { dentro.push(false); continue; }
      dentro.push(true);
      cerca = f[1];
    } else {
      dentro.push(true);
      if (f[1][0] === cerca[0] && f[1].length >= cerca.length && !f[2].trim()) cerca = null;
    }
  }
  return dentro;
}

/** Se o caminho entra entre aspas duplas num comando sem o shell mexer nele: so letras, marcas, digitos, espaco e
 *  . _ - / : ~ + @ , (nada de " $ ` \ !, que o bash expande ou fecha entre aspas). Quem usa: comandoDaFatia, logo
 *  abaixo, no script e no --plano, e reinjecao.linhaDaFatia, antes de sugerir o --plano no outro id. */
function cabeNoComando(s) { return /^[\p{L}\p{M}\p{N} ._\-/:~+@,]+$/u.test(String(s)); }

/** O comando que imprime a fatia: node "<script>" --fatia, com --plano "<plano>" so quando o plano cabe
 *  (cabeNoComando); plano null fica sem --plano. Devolve null quando o caminho do proprio script nao cabe: o sworn
 *  instalado numa pasta com $, crase, aspas ou ! imprimiria um comando que o shell expande (revisao R2, borda).
 *  Quem usa: reinjecao.linhaDaFatia e handoff-curto.montar, cada um com o seu texto para o null. */
function comandoDaFatia(script, plano) {
  const s = String(script).replace(/\\/g, '/');
  if (!cabeNoComando(s)) return null;
  return 'node "' + s + '" --fatia' + (plano != null && cabeNoComando(plano) ? ' --plano "' + plano + '"' : '');
}

function recuo(l) { return /^\s*/.exec(l)[0].length; }

function escapar(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** O id como palavra inteira: "H6" nao casa "H6d", "15.2" nao casa "15.20" (letra, digito ou _ depois barra); o
 *  "__" do negrito (__H6d__) nao e letra. */
function reDoId(id, antes) {
  return new RegExp(antes + escapar(id) + '(?![\\p{L}\\p{N}]|_(?!_))', 'u');
}

/** Indice (0-based) de onde o cabecalho acaba (exclusivo): o titulo da secao da 1a caixa, ou a propria caixa. */
function fimDoCabecalho(linhas, dentro) {
  let titulo = -1;
  for (let i = 0; i < linhas.length; i++) {
    if (dentro[i]) continue;
    if (TITULO.test(linhas[i])) titulo = i;
    else if (CAIXA.test(linhas[i])) return titulo > 0 ? titulo : i;
  }
  return linhas.length;
}

/** Fim (exclusivo) de uma caixa: as linhas de continuacao e as filhas, ate a linha nao vazia de recuo igual ou menor. */
function fimDaCaixa(linhas, i) {
  const r = recuo(linhas[i]);
  let fim = i + 1;
  for (let k = i + 1; k < linhas.length; k++) {
    if (!linhas[k].trim()) continue;
    if (recuo(linhas[k]) <= r) break;
    fim = k + 1;
  }
  return fim;
}

/** Fim (exclusivo) de uma secao: o proximo titulo de nivel igual ou maior, fora de bloco de codigo. */
function fimDaSecao(linhas, dentro, i) {
  const nivel = TITULO.exec(linhas[i])[1].length;
  for (let k = i + 1; k < linhas.length; k++) {
    const t = !dentro[k] && TITULO.exec(linhas[k]);
    if (t && t[1].length <= nivel) return k;
  }
  return linhas.length;
}

/**
 * O item: { de, ate (exclusivo), tipo, outras (linhas do mesmo id) } ou null. Sem id, a proxima caixa aberta (a mesma da secao 3 do
 * handoff, handoff-curto.caixaAberta). Com id, nesta ordem: a caixa cujo texto comeca pelo id (com ou sem negrito), o
 * titulo que tem o id como palavra, a linha de tabela cuja 1a celula comeca por ele.
 */
function acharItem(linhas, dentro, id) {
  if (id === null) {
    const c = require('./handoff-curto.js').caixaAberta(linhas.join('\n'), Infinity);
    if (!c) return null;
    return { de: c.linha - 1, ate: fimDaCaixa(linhas, c.linha - 1), tipo: 'proxima', outras: [] };
  }
  const caixa = reDoId(id, '^\\s*-\\s*\\[[ xX]\\]\\s*(?:\\*\\*|__)?');
  const titulo = reDoId(id, '^#{1,6}\\s.*?(?<![\\p{L}\\p{N}]|(?<!_)_)');
  const linha = reDoId(id, '^\\|\\s*(?:\\*\\*|__)?');
  const achados = { caixa: [], titulo: [], linha: [] };
  linhas.forEach(function (l, i) {
    if (dentro[i]) return;
    if (caixa.test(l)) achados.caixa.push(i);
    else if (titulo.test(l)) achados.titulo.push(i);
    else if (linha.test(l)) achados.linha.push(i);
  });
  // `outras`: as outras ocorrencias do mesmo tipo (linhas 1-based), para o aviso de id repetido dizer onde estao.
  function outras(lista) { return lista.slice(1).map(function (k) { return k + 1; }); }
  if (achados.caixa.length) {
    const i = achados.caixa[0];
    return { de: i, ate: fimDaCaixa(linhas, i), tipo: 'caixa', outras: outras(achados.caixa) };
  }
  if (achados.titulo.length) {
    const i = achados.titulo[0];
    return { de: i, ate: fimDaSecao(linhas, dentro, i), tipo: 'titulo', outras: outras(achados.titulo) };
  }
  if (achados.linha.length) {
    const i = achados.linha[0];
    return { de: i, ate: i + 1, tipo: 'linha', outras: outras(achados.linha) };
  }
  return null;
}

/** O titulo mais perto acima de `i`, fora de bloco de codigo: { linha (1-based), texto } ou null. */
function tituloAcima(linhas, dentro, i) {
  for (let k = i - 1; k >= 0; k--) if (!dentro[k] && TITULO.test(linhas[k])) return { linha: k + 1, texto: linhas[k].trim() };
  return null;
}

/** As linhas [de, ate) em texto, com teto: { texto, ate (exclusivo, o que entrou inteiro), parcial }. Corta em linha
 *  inteira; so a 1a linha que sozinha passa do teto sai cortada no teto (parcial), e ela conta como de fora. */
function pedaco(linhas, de, ate, teto) {
  let usados = 0;
  let k = de;
  for (; k < ate; k++) {
    const n = Array.from(linhas[k]).length + (k > de ? 1 : 0);
    if (usados + n > teto) break;
    usados += n;
  }
  if (k === de && de < ate) return { texto: Array.from(linhas[de]).slice(0, teto).join(''), ate: de, parcial: true };
  return { texto: linhas.slice(de, k).join('\n').trimEnd(), ate: k, parcial: false };
}

/**
 * A fatia de `texto` (o plano) para `id` (null = a proxima caixa aberta). Devolve { cabecalho, item, contexto,
 * linhas } (cabecalho e item: { de, ate, texto, cortadoEm } com linhas 1-based inclusivas; item null quando o id nao
 * se acha ou nao ha caixa aberta).
 */
function fatiar(texto, id, teto) {
  const max = teto === undefined ? TETO_DO_PEDACO : teto;
  const linhas = String(texto).replace(/\r\n/g, '\n').split('\n');
  // A quebra do fim do arquivo nao abre uma linha: "a\nb\n" tem 2 linhas, como no editor (e o vazio, 0).
  if (linhas[linhas.length - 1] === '') linhas.pop();
  const dentro = dentroDeCerca(linhas);
  const fimCab = fimDoCabecalho(linhas, dentro);
  // de/ate entram 0-based com ate exclusivo e saem 1-based inclusivos: so o de ganha +1 (o fim exclusivo 0-based ja e
  // o fim inclusivo 1-based).
  function montar(de, ate) {
    const p = pedaco(linhas, de, ate, max);
    return { de: de + 1, ate: ate, texto: p.texto, cortadoEm: p.ate < ate ? p.ate + 1 : null, parcial: p.parcial, teto: max };
  }
  const cabecalho = montar(0, fimCab);
  const achado = acharItem(linhas, dentro, id);
  let item = null;
  let contexto = null;
  if (achado) {
    item = Object.assign(montar(achado.de, achado.ate), { tipo: achado.tipo, outras: achado.outras });
    if (achado.tipo !== 'titulo') contexto = tituloAcima(linhas, dentro, achado.de);
  }
  return { cabecalho: cabecalho, item: item, contexto: contexto, linhas: linhas.length };
}

function faixa(p) { return p.de > p.ate ? 'vazio' : 'linhas ' + p.de + '-' + p.ate; }

function corte(p) {
  return p.cortadoEm ? '\n[cortado no teto de ' + p.teto + ' caracteres: as linhas ' + p.cortadoEm + '-' + p.ate +
    ' ficaram de fora' + (p.parcial ? ' (a ' + p.cortadoEm + ' saiu so ate o teto, acima)' : '') +
    '; leia-as no arquivo com Read (offset ' + p.cortadoEm + ') se precisar]' : '';
}

/** O texto que o plano.js imprime. `rel` = o caminho do plano como foi achado; `id` como em fatiar. Item null so com
 *  id null (plano sem caixa aberta): sai o cabecalho e a linha que diz isso. */
function texto(rel, f, id) {
  const qual = id === null ? 'o proximo item sem marcar' : 'o item ' + id;
  if (!f.item) {
    return 'sworn: fatia do plano ' + rel + ' (' + f.linhas + ' linhas): o plano nao tem item sem marcar; sai so o ' +
      'cabecalho (' + faixa(f.cabecalho) + '). Para ler um item ja marcado, passe o id dele: --fatia <id>.\n\n--- cabecalho (' + faixa(f.cabecalho) +
      ') ---\n' + f.cabecalho.texto + corte(f.cabecalho) + '\n';
  }
  const partes = ['sworn: fatia do plano ' + rel + ' (' + f.linhas + ' linhas): o cabecalho (' + faixa(f.cabecalho) +
    ') e ' + qual + ' (' + faixa(f.item) + '). O resto do plano nao foi lido; outro item: --fatia <id>.'];
  if (f.item.outras.length) {
    const lista = f.item.outras.slice(0, 10).join(', ') + (f.item.outras.length > 10 ? ' e mais ' + (f.item.outras.length - 10) : '');
    partes.push('Atencao: o id ' + id + ' abre ' + (f.item.outras.length + 1) + ' ' + (f.item.tipo === 'caixa' ? 'caixas' : f.item.tipo === 'titulo' ? 'titulos' : 'linhas de tabela') +
      '; aqui vai a da linha ' + f.item.de + ', e as outras estao nas linhas ' + lista + '. Para outra, passe um id que so ela tenha.');
  }
  partes.push('', '--- cabecalho (' + faixa(f.cabecalho) + ') ---', f.cabecalho.texto + corte(f.cabecalho), '');
  partes.push('--- ' + qual + ' (' + faixa(f.item) + ')' +
    (f.contexto ? ', na secao "' + f.contexto.texto + '" (linha ' + f.contexto.linha + ')' : '') + ' ---',
  f.item.texto + corte(f.item));
  return partes.join('\n') + '\n';
}

module.exports = { TETO_DO_PEDACO, fatiar, texto, dentroDeCerca, cabeNoComando, comandoDaFatia };
