'use strict';
/**
 * H1-custo (D868, pedidos 218-221 do dono): o diff de JS ou TS que so muda comentario ou espaco nao muda o que o
 * codigo faz, e o portao de commit (commit.pendentes) nao cobra a revisao cega dele, como ja nao cobra a do texto
 * (.md). A conta: o codigo dos dois lados, sem os comentarios e com cada trecho de espaco virando um espaco (ou uma
 * quebra, quando tinha quebra: a quebra muda o ponto e virgula automatico do JS), tem de sair igual.
 * Fail-closed em toda duvida: string, template, regex ou comentario sem fecho, chave de template desequilibrada, a
 * `/` depois de `)` ou `}` com outra `/` na mesma linha (regex ou divisao?) e o arquivo com `</` ou `/>` (JSX, onde
 * o `//` de um texto de tela nao e comentario) dao null, e null nunca e "so comentario". O comentario que uma
 * ferramenta le (`@ts-ignore`, `eslint-disable`, `@__PURE__`...) conta como codigo.
 */

// .jsx e .tsx ficam fora: o texto de tela do JSX nao se le como codigo
const EXTENSOES = /\.(?:[cm]?js|[cm]?ts)$/i;
// depois destas palavras a `/` abre uma regex (`return /a/.test(x)`); depois de outro nome, numero, valor, `)`, `]` ou
// `}`, e divisao (a `/` depois de `)` ou `}` com outra `/` na linha da null: ver codigo)
const PALAVRAS_ANTES_DE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await', 'default', 'extends']);
// o comentario que muda o que uma ferramenta faz (tipo, lint, minificador, empacotador, cobertura, Flow);
// `global` e `exported` sao do JSHint e do ESLint; `^\s*:` e o tipo do Flow em comentario (`/*: number */`, `/*:: */`)
const DIRETIVA = /@ts-|eslint|jshint|[@#]__(?:PURE|INLINE|NOINLINE|KEY)__|webpack[A-Z]|vite-ignore|sourceMappingURL|sourceURL|@flow|@jsx|istanbul\s+ignore|[cv]8\s+ignore|prettier-ignore|^\s*(?:global|exported)\s|^\s*:/;

function ehQuebra(c) { return c === '\n' || c === '\u2028' || c === '\u2029'; }
// o \s do JS e o WhiteSpace e o LineTerminator da especificacao, os Zs (U+3000...) inclusive
function ehEspaco(c) { return /\s/.test(c); }
function ehNome(c) { return /[A-Za-z0-9_$\u0080-\uffff]/.test(c) && !ehEspaco(c); }

/** O indice logo depois da aspa que fecha a string aberta em `i`, ou -1 (sem fecho na linha). */
function fimDaString(t, i, aspa) {
  for (let j = i + 1; j < t.length; j++) {
    const c = t[j];
    if (c === '\\') { j++; continue; }
    if (c === aspa) return j + 1;
    if (ehQuebra(c)) return -1;
  }
  return -1;
}

/** O indice logo depois das flags da regex aberta em `i`, ou -1 (sem fecho na linha). */
function fimDaRegex(t, i) {
  let classe = false;
  for (let j = i + 1; j < t.length; j++) {
    const c = t[j];
    if (c === '\\') { j++; continue; }
    if (ehQuebra(c)) return -1;
    if (classe) { if (c === ']') classe = false; continue; }
    if (c === '[') { classe = true; continue; }
    if (c === '/') {
      let k = j + 1;
      while (k < t.length && /[A-Za-z]/.test(t[k])) k++;
      return k;
    }
  }
  return -1;
}

function regexPode(anterior) {
  if (anterior === null) return true;
  if (anterior.tipo === 'nome') return PALAVRAS_ANTES_DE_REGEX.has(anterior.texto);
  return anterior.tipo === 'pont' && ')]}'.indexOf(anterior.texto) === -1;
}

/**
 * O codigo de `texto` sem comentario e com o espaco normalizado (o conteudo de string, template e regex fica como
 * veio), ou null quando a leitura nao e segura (ver o topo do arquivo).
 */
function codigo(texto) {
  if (typeof texto !== 'string') return null;
  // o BOM do comeco e espaco (ehEspaco) e nao sai
  const t = texto.replace(/\r\n?/g, '\n');
  if (t.indexOf('</') !== -1 || t.indexOf('/>') !== -1) return null;
  // o arquivo que nao e UTF-8: dois bytes invalidos diferentes viram o mesmo U+FFFD na leitura
  if (t.indexOf('\ufffd') !== -1) return null;
  const n = t.length;
  let saida = '';
  let espaco = '';
  let anterior = null;
  // a profundidade de chaves de cada `${` aberto num template
  const pilha = [];
  let emTemplate = false;
  function poe(pedaco, tipo) {
    if (saida && espaco) saida += espaco;
    espaco = '';
    saida += pedaco;
    anterior = { tipo: tipo, texto: pedaco };
  }
  function comoEspaco(quebra) { espaco = espaco === '\n' || quebra ? '\n' : ' '; }
  let i = 0;
  while (i < n) {
    if (emTemplate) {
      let j = i;
      let fim = -1;
      let abre = false;
      while (j < n) {
        const c = t[j];
        if (c === '\\') { j += 2; continue; }
        if (c === '`') { fim = j + 1; break; }
        if (c === '$' && t[j + 1] === '{') { fim = j + 2; abre = true; break; }
        j++;
      }
      if (fim === -1) return null;
      saida += t.slice(i, fim);
      i = fim;
      emTemplate = false;
      if (abre) {
        pilha.push(0);
        anterior = { tipo: 'pont', texto: '{' };
      } else {
        anterior = { tipo: 'valor', texto: '`' };
      }
      continue;
    }
    const c = t[i];
    if (ehEspaco(c)) {
      let quebra = false;
      while (i < n && ehEspaco(t[i])) { if (ehQuebra(t[i])) quebra = true; i++; }
      comoEspaco(quebra);
      continue;
    }
    if (c === '/' && (t[i + 1] === '/' || t[i + 1] === '*')) {
      const deLinha = t[i + 1] === '/';
      let fim;
      if (deLinha) { fim = i + 2; while (fim < n && !ehQuebra(t[fim])) fim++; } else {
        fim = t.indexOf('*/', i + 2);
        if (fim === -1) return null;
      }
      const dentro = t.slice(i + 2, fim);
      i = deLinha ? fim : fim + 2;
      if (DIRETIVA.test(dentro)) {
        // a diretiva entra na conta como esta, sem mudar o que decide a regex
        const antes = anterior;
        poe(deLinha ? '//' + dentro + '\n' : '/*' + dentro + '*/', 'diretiva');
        anterior = antes;
        continue;
      }
      // o comentario vale um espaco; o de bloco com quebra vale uma quebra, como no JS
      comoEspaco(!deLinha && /[\n\u2028\u2029]/.test(dentro));
      continue;
    }
    if (c === '"' || c === "'") {
      const f = fimDaString(t, i, c);
      if (f === -1) return null;
      poe(t.slice(i, f), 'valor');
      i = f;
      continue;
    }
    if (c === '`') { poe('`', 'valor'); i++; emTemplate = true; continue; }
    if (c === '{') { if (pilha.length) pilha[pilha.length - 1]++; poe('{', 'pont'); i++; continue; }
    if (c === '}') {
      i++;
      if (pilha.length && pilha[pilha.length - 1] === 0) { pilha.pop(); poe('}', 'pont'); emTemplate = true; continue; }
      if (pilha.length) pilha[pilha.length - 1]--;
      poe('}', 'pont');
      continue;
    }
    if (c === '/' && regexPode(anterior)) {
      const f = fimDaRegex(t, i);
      if (f === -1) return null;
      poe(t.slice(i, f), 'valor');
      i = f;
      continue;
    }
    // a `/` depois de `)` ou `}` abre regex (`if (a) /x/.test(s)`) ou e divisao (`(a) / 2`): com outra `/` na mesma
    // linha nao da para saber, e a regex lida como divisao esconderia codigo atras de um `//` falso (`/[//]/`)
    const depoisDeFecho = anterior !== null && anterior.tipo === 'pont' && (anterior.texto === ')' || anterior.texto === '}');
    if (c === '/' && depoisDeFecho) {
      for (let j = i + 1; j < n && !ehQuebra(t[j]); j++) if (t[j] === '/') return null;
    }
    if (ehNome(c)) {
      let j = i;
      while (j < n && ehNome(t[j])) j++;
      poe(t.slice(i, j), 'nome');
      i = j;
      continue;
    }
    poe(c, 'pont');
    i++;
  }
  // o template que o `}` reabriu e o arquivo acabou: sem fecho
  if (pilha.length || emTemplate) return null;
  return saida;
}

/** `antes` e `depois` diferem so em comentario ou espaco; false em toda duvida (fail-closed). */
function soComentario(antes, depois) {
  const a = codigo(antes);
  if (a === null) return false;
  const d = codigo(depois);
  return d !== null && a === d;
}

module.exports = { EXTENSOES, DIRETIVA, codigo, soComentario };
