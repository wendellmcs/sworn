'use strict';
// E3 item 4 (R-hallmark): o inventario do que a tela liga, antes e depois. Numa reforma de tela, o que o codigo e o
// teste esperam achar (o id, o evento, o link, o campo do formulario, o gancho de teste, o script, o destino do form)
// some sem ninguem ver; a revisao cega julga o que esta, nao o que sumiu. Aqui o antes e o lado HEAD da revisao (o
// arquivo inteiro, nao o recorte) e o depois e o trabalho: cada item que sumiu sem dispensa declarada vai ao fecho.
// Com as duas fotos, os nomes da arvore de acessibilidade (papel e nome) entram tambem.
// Dispensa: um comentario no lado do trabalho, `sworn-dispensa: <item exato> -- <motivo>`, com o item como o fecho o
// escreve (`id:pagar`, `evento:onclick=pagar()`) e o motivo de 12 letras ou mais; item que nao casa exato nao dispensa.
// Quem chama: scripts/preparar-revisao.js (montar, ao gravar a ronda) e scripts/apurar-ronda.js (le o inventario.json e
// poe "mantido N/N" no fecho). Quem ajuda: a evidencia da foto (scripts/lib/tela-cega.js, acessibilidade.itens).

const ARQUIVO = 'inventario.json';
const EXTENSOES_TELA = ['.html', '.htm', '.jsx', '.tsx', '.vue', '.svelte'];
const MOTIVO_MINIMO = 12; // letras do motivo da dispensa, como no hallmark: "nao precisa" nao explica nada
const TETO = 200; // itens que sumiram listados; o resto so conta
// Os campos de formulario: so o `name` deles e fiacao (o `name` do <meta> nao e).
const DE_CAMPO = new Set(['input', 'select', 'textarea', 'button', 'form', 'fieldset', 'output']);
// A tag de abertura com os atributos. atalho: le a tag por regex, sem montar a arvore. limite: a expressao JSX entre
// chaves vale ate 3 niveis (`style={{ a: { b } }}`); com 4 ou mais, ou com chave solta numa string da expressao
// (`{"}"}`), a tag nao casa e o que ela liga nao entra. trocar quando: houver um leitor de JSX/HTML no projeto.
const CHAVE1 = '\\{[^{}]*\\}';
const CHAVE2 = '\\{(?:[^{}]|' + CHAVE1 + ')*\\}';
const CHAVE3 = '\\{(?:[^{}]|' + CHAVE2 + ')*\\}';
const ATRIBUTOS = '(?:[^<>"\'{}]|"[^"]*"|\'[^\']*\'|' + CHAVE3 + ')*';
const RE_TAG = new RegExp('<([A-Za-z][\\w.:-]*)\\b(' + ATRIBUTOS + ')\\/?>', 'g');
// A tag inteira, sem captura: casa antes do comentario, para o `/*` de um atributo (`accept="image/*"`) nao abrir um.
const TAG = '<[A-Za-z][\\w.:-]*\\b' + ATRIBUTOS + '\\/?>';
// A string de uma linha, pelo mesmo motivo (`import.meta.glob('./pages/*.tsx')`). limite: o apostrofo do texto da
// pagina abre uma string ate o proximo na mesma linha (`Don't ... it's`), e o comentario no meio dela nao conta.
const STRING = '"[^"\\n]*"|\'[^\'\\n]*\'|`[^`\\n]*`';
// O valor do atributo: entre aspas, entre chaves (JSX, ate 3 niveis) ou sem aspas, como o HTML aceita (`id=pagar`).
const RE_ATRIBUTO = new RegExp('([@:]?[A-Za-z_][\\w.:-]*)\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|(' + CHAVE3 + ')|' +
  '([^\\s"\'=<>`{}]+))', 'g');
// Os comentarios: o do HTML (grupo 1), o de bloco (grupo 2, tambem o do JSX, `{/* */}`) e o de linha (grupo 3). A tag
// e a string casam primeiro, sem grupo: o `/*` e o `//` dentro delas nao sao comentario. O `<!--` que nao fecha vai
// ate o fim do texto (o solto nao custa o quadrado do tamanho); o `/*` que nao fecha nao e comentario (`src/*` no texto
// da pagina), e o resto se le sem o ramo do bloco (ver `comentarios`). O `//` logo depois de `:` e o de `https://`; no
// .html o `//` e texto da pagina, e o ramo dele sai. atalho: le por regex, sem montar a arvore. limite: o `/*` numa
// regex do JS ou numa string de varias linhas abre um bloco quando ha um `*/` depois. trocar quando: o leitor de
// JSX/HTML do RE_TAG chegar.
const NUNCA = '((?!)x)'; // o grupo que nunca casa: mantem os numeros dos grupos quando um ramo sai
function reComentario(comBloco, comLinha) {
  return new RegExp('<!--([\\s\\S]*?)(?:-->|$)|' + TAG + '|' + STRING + '|' +
    (comBloco ? '\\/\\*([\\s\\S]*?)(?:\\*\\/|$)' : NUNCA) + '|' + (comLinha ? '(?<!:)\\/\\/([^\\n]*)' : NUNCA), 'g');
}
const RE_COMENTARIO = { true: { true: reComentario(true, true), false: reComentario(true, false) },
  false: { true: reComentario(false, true), false: reComentario(false, false) } };
// Dentro de um comentario: o item vai ate o ` -- ` (o nome da acessibilidade tem espaco: `acess:button:Pagar agora`);
// o motivo, ate o fim da linha ou de um comentario de outro tipo que o `//` tenha engolido na mesma linha.
const RE_DISPENSA = /sworn-dispensa:[ \t]*([^\n]+?)[ \t]+--[ \t]+([^\n]*?)[ \t]*(?:-->|\*\/|$)/gm;

function ehArquivoDeTela(caminho) {
  const c = String(caminho || '').toLowerCase();
  return EXTENSOES_TELA.some(function (e) { return c.endsWith(e); });
}

/**
 * A linha (de 1 em diante) de cada posicao, pedida em ordem crescente: conta so o trecho novo, para o arquivo com
 * milhares de tags nao custar o quadrado do tamanho.
 */
function contadorDeLinhas(texto) {
  let pos = 0;
  let linha = 1;
  return function (i) {
    for (; pos < i; pos++) if (texto.charCodeAt(pos) === 10) linha++;
    return linha;
  };
}

// O `//` e comentario fora do .html (la ele e texto da pagina; o comentario e o `<!-- -->` ou o de bloco).
function temComentarioDeLinha(caminho) {
  return !/\.html?$/i.test(String(caminho || ''));
}

// Os comentarios do texto, em ordem: [{ inicio, fim, corpo, corpoInicio }]. O bloco que nao fecha nao e comentario:
// da primeira vez, nao ha fecho de bloco nenhum dali em diante, e o resto se le sem o ramo do bloco (duas passadas
// lineares).
function comentarios(t, caminho) {
  const linha = temComentarioDeLinha(caminho);
  const lista = [];
  let re = RE_COMENTARIO[true][linha];
  re.lastIndex = 0;
  let c;
  while ((c = re.exec(t)) !== null) {
    if (c[1] === undefined && c[2] === undefined && c[3] === undefined) continue; // uma tag ou uma string
    if (c[2] !== undefined && !c[0].endsWith('*/')) {
      const resto = RE_COMENTARIO[false][linha];
      resto.lastIndex = c.index + 2;
      re = resto;
      continue;
    }
    const corpo = c[1] !== undefined ? c[1] : c[2] !== undefined ? c[2] : c[3];
    lista.push({ inicio: c.index, fim: c.index + c[0].length, corpo: corpo,
      corpoInicio: c.index + (c[1] !== undefined ? 4 : 2) });
  }
  return lista;
}

/**
 * A fiacao do texto: Map item -> primeira linha. O item e `tipo:valor`, como o fecho e a dispensa o escrevem.
 * `caminho` (opcional) diz se o `//` e comentario (fora do .html).
 */
function fiacao(texto, caminho) {
  // A tag comentada nao esta na tela: o comentario vira espaco, com as quebras de linha mantidas para a linha do item.
  const bruto = String(texto == null ? '' : texto);
  const partes = [];
  let pos = 0;
  for (const c of comentarios(bruto, caminho)) {
    partes.push(bruto.slice(pos, c.inicio), bruto.slice(c.inicio, c.fim).replace(/[^\n]/g, ' '));
    pos = c.fim;
  }
  partes.push(bruto.slice(pos));
  const t = partes.join('');
  const itens = new Map();
  const linhaDe = contadorDeLinhas(t);
  // Guarda o item com a primeira linha em que aparece. O contador anda em toda chamada (ele so conta para a frente).
  const anotar = function (item, i) { const l = linhaDe(i); if (!itens.has(item)) itens.set(item, l); };
  RE_TAG.lastIndex = 0;
  let m;
  while ((m = RE_TAG.exec(t)) !== null) {
    const tag = m[1].toLowerCase();
    RE_ATRIBUTO.lastIndex = 0;
    let a;
    while ((a = RE_ATRIBUTO.exec(m[2])) !== null) {
      const nome = a[1];
      const baixo = nome.toLowerCase();
      const valor = (a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4].slice(1, -1) :
        a[5]).trim();
      if (!valor) continue;
      if (baixo === 'id') anotar('id:' + valor, m.index);
      else if (baixo === 'name' && DE_CAMPO.has(tag)) anotar('campo:' + valor, m.index);
      else if (baixo === 'href' && (tag === 'a' || tag === 'link')) anotar('link:' + valor, m.index);
      else if (baixo === 'src' && tag === 'script') anotar('script:' + valor, m.index);
      else if (baixo === 'action' && tag === 'form') anotar('envio:' + valor, m.index);
      else if (/^data-(?:testid|test-id|test|cy|qa)$/.test(baixo)) anotar('teste:' + valor, m.index);
      // O evento: on* do HTML e do JSX (onclick, onClick), @click e v-on:click do Vue, on:click do Svelte.
      else if (/^on[a-z]+$/.test(baixo) || /^@[a-z]/.test(baixo) || /^(?:v-on|on):[a-z]/.test(baixo)) {
        anotar('evento:' + baixo + '=' + valor.replace(/\s+/g, ' '), m.index);
      }
    }
  }
  return itens;
}

/**
 * As dispensas declaradas num comentario do texto: { validas: Map item -> motivo, invalidas: [{ item, motivo, linha }] }.
 * O marcador fora de comentario (num texto da pagina, numa string) nao dispensa nada. `caminho`: como na `fiacao`.
 */
function dispensas(texto, caminho) {
  const t = String(texto == null ? '' : texto);
  const validas = new Map();
  const invalidas = [];
  const linhaDe = contadorDeLinhas(t);
  for (const c of comentarios(t, caminho)) {
    RE_DISPENSA.lastIndex = 0;
    let m;
    while ((m = RE_DISPENSA.exec(c.corpo)) !== null) {
      const motivo = m[2].trim();
      const letras = (motivo.match(/\p{L}/gu) || []).length;
      if (letras >= MOTIVO_MINIMO) validas.set(m[1], motivo);
      else invalidas.push({ item: m[1], motivo: motivo, linha: linhaDe(c.corpoInicio + m.index) });
    }
  }
  return { validas, invalidas };
}

/** Os nomes da arvore de acessibilidade da foto (evidencia.acessibilidade.itens): Set de `acess:papel:nome`. */
function nomesDaFoto(evidencia) {
  const acess = evidencia && evidencia.acessibilidade;
  const itens = acess && Array.isArray(acess.itens) ? acess.itens : null;
  if (!itens) return null;
  const s = new Set();
  for (const i of itens) {
    if (!i || typeof i.nome !== 'string' || !i.nome.trim()) continue;
    s.add('acess:' + String(i.papel || '').trim() + ':' + i.nome.trim().replace(/\s+/g, ' '));
  }
  return s;
}

/**
 * O conteudo do inventario.json. `head` e `trabalho`: o arquivo inteiro de cada lado; `antes` e `depois`: a evidencia
 * de cada foto (ou null). Sem as duas fotos, a acessibilidade fica de fora (null): o antes sem foto nao se compara.
 */
function montar(o) {
  const antes = fiacao(o.head, o.caminho);
  const depois = fiacao(o.trabalho, o.caminho);
  const { validas, invalidas } = dispensas(o.trabalho, o.caminho);
  const sumiram = [];
  const dispensados = [];
  for (const [item, linha] of antes) {
    if (depois.has(item)) continue;
    if (validas.has(item)) dispensados.push({ item: item, motivo: validas.get(item) });
    else sumiram.push({ item: item, linhaNoAntes: linha });
  }
  let acessibilidade = null;
  const nomesAntes = nomesDaFoto(o.antes);
  const nomesDepois = nomesDaFoto(o.depois);
  if (nomesAntes && nomesDepois) {
    const sumiu = [];
    for (const item of nomesAntes) {
      if (nomesDepois.has(item)) continue;
      if (validas.has(item)) dispensados.push({ item: item, motivo: validas.get(item) });
      else sumiu.push({ item: item });
    }
    acessibilidade = { antes: nomesAntes.size, sumiram: sumiu.slice(0, TETO), foraDoTeto: Math.max(0, sumiu.length - TETO) };
  }
  // Sem a comparacao da acessibilidade, o fecho diz qual foto nao trouxe a arvore: o "mantido N/N" e so do fonte.
  const semArvore = [nomesAntes ? null : '--tela-antes', nomesDepois ? null : '--tela-depois'].filter(Boolean);
  const total = antes.size + (acessibilidade ? acessibilidade.antes : 0);
  const perdidos = sumiram.length + (acessibilidade ? acessibilidade.sumiram.length + acessibilidade.foraDoTeto : 0);
  return {
    total: total,
    mantidos: total - perdidos - dispensados.length,
    sumiram: sumiram.slice(0, TETO),
    foraDoTeto: Math.max(0, sumiram.length - TETO),
    dispensados: dispensados.slice(0, TETO),
    dispensadosForaDoTeto: Math.max(0, dispensados.length - TETO),
    dispensasInvalidas: invalidas.slice(0, TETO),
    invalidasForaDoTeto: Math.max(0, invalidas.length - TETO),
    acessibilidade: acessibilidade,
    // A foto do capturar-tela.js sempre traz a arvore: falta so a foto, e o texto diz a flag que a tira.
    semAcessibilidade: acessibilidade ? null : 'falta a arvore de acessibilidade na foto de ' + semArvore.join(' e ') +
      ': prepare a ronda com ' + semArvore.map(function (f) { return f + ' <endereco>'; }).join(' e ')
  };
}

/** Quantos a lista tem, com o que o teto cortou. */
function quantos(lista, foraDoTeto) {
  return (Array.isArray(lista) ? lista.length : 0) + (Number.isInteger(foraDoTeto) ? foraDoTeto : 0);
}

/**
 * A frase do fecho: "mantido N/N", com o que sumiu, a dispensa recusada e a acessibilidade que nao se comparou. Sem
 * nada ligado no HEAD, so a dispensa recusada (se houver) aparece. Inventario fora da forma: null.
 */
function fraseDoFecho(inv) {
  if (!inv || !Number.isInteger(inv.total) || !Number.isInteger(inv.mantidos)) return null;
  const invalidas = quantos(inv.dispensasInvalidas, inv.invalidasForaDoTeto);
  const recusadas = invalidas ? invalidas + ' dispensa(s) recusada(s) por motivo curto (inventario.dispensasInvalidas): ' +
    'reescreva o motivo com ' + MOTIVO_MINIMO + ' letras ou mais' : '';
  if (inv.total === 0) return recusadas ? 'inventario da tela: nada ligado no HEAD, ' + recusadas : null;
  const dispensados = quantos(inv.dispensados, inv.dispensadosForaDoTeto);
  const perdidos = inv.total - inv.mantidos - dispensados;
  let f = 'inventario da tela: mantido ' + inv.mantidos + '/' + inv.total;
  if (dispensados) f += ', ' + dispensados + ' dispensado(s) com motivo';
  if (perdidos > 0) {
    f += ', ' + perdidos + ' sumiu(ram) sem dispensa (inventario.sumiram): ponha de volta, ou declare num comentario ' +
      'do arquivo "sworn-dispensa: <item> -- <motivo>" com o item exato e o motivo de ' + MOTIVO_MINIMO + ' letras ou mais';
  }
  if (recusadas) f += ', ' + recusadas;
  if (typeof inv.semAcessibilidade === 'string' && inv.semAcessibilidade) {
    f += ', sem os nomes da acessibilidade (' + inv.semAcessibilidade + ')';
  }
  return f;
}

module.exports = { ARQUIVO, EXTENSOES_TELA, MOTIVO_MINIMO, TETO, ehArquivoDeTela, fiacao, dispensas, montar, fraseDoFecho };
