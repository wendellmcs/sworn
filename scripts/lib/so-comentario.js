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
 * G4e: o mesmo corte para o Apps Script (.gs, o leitor de JS), o Python (.py, .pyi, .pyw) e o CSS, cada um com o seu
 * leitor (leitorDe) e a mesma regra: na duvida, null. No Python o recuo e a quebra fora de parentese contam (sao a
 * sintaxe); no CSS o comentario que cola dois nomes (`a/**\/b`) conta, porque separa o que sem ele seria um nome so.
 */

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

// o comentario do Python que muda o que o interpretador ou uma ferramenta faz: o shebang, a codificacao, o tipo, o
// lint, o formatador, a cobertura, a celula do caderno (`# %%`)
const DIRETIVA_PY = /^!|coding[:=]|type:|noqa|nosec|nosonar|lgtm|nopep8|skipcq|pragma|pylint|mypy|pyright|pytype|pyre-|fmt:|isort:|ruff|flake8|yapf|cython:|distutils:|^\s*%%|noinspection|codespell/i;
// a codificacao declarada (PEP 263, so na linha 1 ou 2); a que nao e UTF-8 da null: no UTF-7 o `+AAo-` e uma quebra,
// e o texto de um comentario vira codigo que roda
const CODIFICACAO_PY = /^[ \t\f]*#.*?coding[:=][ \t]*([-\w.]+)/;
const ESPACO_PY = /[ \t\f]/;
const NOME_PY = /[A-Za-z0-9_\u0080-\uffff]/;
// as letras que podem vir colados antes da aspa (r, b, u, f, t e as duplas com r)
const PREFIXO_PY = /^(?:[rRuUfFbBtT]|[rR][bBfFtT]|[bBfFtT][rR])$/;

/**
 * O indice logo depois da string do Python cuja aspa esta em `i`, ou -1 (sem fecho ou leitura incerta). Na f-string
 * (e na t-string) o campo entre chaves e codigo: ali a aspa de fora (Python 3.12), o `#`, a barra invertida e a
 * string longa dao -1, porque a leitura de cada versao do Python diverge e o fim lido cedo demais esconderia texto
 * da string atras de um `#` falso.
 */
function fimDaStringPy(t, i, prefixo) {
  const q = t[i];
  const n = t.length;
  const longa = t[i + 1] === q && t[i + 2] === q;
  const formatada = /[fFtT]/.test(prefixo);
  const outra = q === '"' ? "'" : '"';
  let j = i + (longa ? 3 : 1);
  // a profundidade de chaves dentro do campo da f-string
  let campo = 0;
  while (j < n) {
    const c = t[j];
    if (campo === 0) {
      if (c === '\\') {
        if (j + 1 >= n) return -1;
        // o \N{...} e a chave escapada: cada versao le de um jeito
        if (formatada && 'N{}'.indexOf(t[j + 1]) !== -1) return -1;
        j += 2;
        continue;
      }
      if (c === q) {
        if (!longa) return j + 1;
        if (t[j + 1] === q && t[j + 2] === q) return j + 3;
        j++;
        continue;
      }
      if (c === '\n' && !longa) return -1;
      if (formatada && c === '{') {
        if (t[j + 1] === '{') { j += 2; continue; }
        campo = 1;
        j++;
        continue;
      }
      if (formatada && c === '}') {
        if (t[j + 1] === '}') { j += 2; continue; }
        return -1;
      }
      j++;
      continue;
    }
    if (c === q || c === '#' || c === '\\' || (c === '\n' && !longa)) return -1;
    if (c === outra) {
      // a string curta da outra aspa, dentro do campo, lida ate a mesma aspa
      if (t[j + 1] === outra && t[j + 2] === outra) return -1;
      let k = j + 1;
      while (k < n && t[k] !== outra) {
        if (t[k] === q || t[k] === '\n' || t[k] === '\\') return -1;
        k++;
      }
      if (k >= n) return -1;
      j = k + 1;
      continue;
    }
    if (c === '{') campo++;
    else if (c === '}') campo--;
    j++;
  }
  return -1;
}

/**
 * O codigo Python de `texto`, linha logica por linha logica (JSON), sem comentario, sem linha em branco e com o espaco
 * do meio da linha normalizado; o recuo fica cru e a string (docstring inclusive) fica como veio. Null quando a
 * leitura nao e segura: string ou parentese sem fecho, parentese trocado, barra invertida fora do fim da linha, campo
 * de f-string incerto (fimDaStringPy), a codificacao declarada que nao e UTF-8 e o arquivo que nao e UTF-8. Sai em
 * JSON (a lista das linhas) porque a quebra fora de parentese e sintaxe; serve so para comparar, nunca como codigo.
 */
function codigoPython(texto) {
  if (typeof texto !== 'string') return null;
  const t = texto.replace(/\r\n?/g, '\n');
  if (t.indexOf('\ufffd') !== -1) return null;
  for (const l of t.split('\n', 2)) {
    const m = CODIFICACAO_PY.exec(l);
    if (m && !/^utf[-_]?8$/i.test(m[1])) return null;
  }
  const n = t.length;
  // o shebang (linha 1) e a codificacao (linha 1 ou 2) so valem no lugar: a diretiva dessas linhas leva o numero dela
  const q1 = t.indexOf('\n');
  const q2 = q1 === -1 ? -1 : t.indexOf('\n', q1 + 1);
  function lugar(j) {
    if (q1 === -1 || j < q1) return '\n1';
    return q2 === -1 || j < q2 ? '\n2' : '';
  }
  const linhas = [];
  const pilha = [];
  // null: no comeco de uma linha logica
  let linha = null;
  let espaco = false;
  function poe(pedaco) {
    if (espaco && linha !== '') linha += ' ';
    espaco = false;
    linha += pedaco;
  }
  function fimDaLinha(j) { while (j < n && t[j] !== '\n') j++; return j; }
  let i = 0;
  while (i < n) {
    if (linha === null) {
      let j = i;
      while (j < n && ESPACO_PY.test(t[j])) j++;
      const recuo = t.slice(i, j);
      // a linha em branco e a so de comentario nao mudam o recuo
      if (j >= n || t[j] === '\n') { i = j + 1; continue; }
      if (t[j] === '#') {
        const fim = fimDaLinha(j);
        const dentro = t.slice(j + 1, fim);
        if (DIRETIVA_PY.test(dentro)) linhas.push(recuo + '#' + dentro + lugar(j));
        i = fim + 1;
        continue;
      }
      linha = recuo;
      espaco = false;
      i = j;
      continue;
    }
    const c = t[i];
    if (ESPACO_PY.test(c)) { espaco = true; i++; continue; }
    if (c === '\n') {
      i++;
      // dentro de parentese a quebra e espaco; fora, fecha a linha
      if (pilha.length) { espaco = true; continue; }
      linhas.push(linha);
      linha = null;
      continue;
    }
    if (c === '#') {
      const fim = fimDaLinha(i);
      const dentro = t.slice(i + 1, fim);
      espaco = false;
      if (DIRETIVA_PY.test(dentro)) linha += '#' + dentro + '\n';
      i = fim;
      continue;
    }
    if (c === '\\') {
      // so a barra que junta a linha seguinte: a que vem antes de outra coisa e erro, ou nao se le
      if (t[i + 1] !== '\n') return null;
      poe('\\\n');
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const f = fimDaStringPy(t, i, '');
      if (f === -1) return null;
      poe(t.slice(i, f));
      i = f;
      continue;
    }
    if (NOME_PY.test(c)) {
      let j = i;
      while (j < n && NOME_PY.test(t[j])) j++;
      const nome = t.slice(i, j);
      if ((t[j] === '"' || t[j] === "'") && PREFIXO_PY.test(nome)) {
        const f = fimDaStringPy(t, j, nome);
        if (f === -1) return null;
        poe(t.slice(i, f));
        i = f;
        continue;
      }
      poe(nome);
      i = j;
      continue;
    }
    if ('([{'.indexOf(c) !== -1) pilha.push(c);
    else if (')]}'.indexOf(c) !== -1 && pilha.pop() !== '([{'[')]}'.indexOf(c)]) return null;
    poe(c);
    i++;
  }
  if (pilha.length) return null;
  if (linha !== null) linhas.push(linha);
  return JSON.stringify(linhas);
}

// o comentario do CSS que uma ferramenta le: o `/*!` que o minificador guarda, o mapa, o lint, o formatador, o rtl, o
// corte de classe e o prefixador
const DIRETIVA_CSS = /^!|source(?:Mapping)?URL|stylelint-|prettier-ignore|rtl:|purgecss|autoprefixer|webpackIgnore|csslint|@preserve|@license|cssnano-|postcss-|@noflip|critical:/i;
const ESPACO_CSS = /[ \t\n]/;
const NOME_CSS = /[A-Za-z0-9_\-\u0080-\uffff]/;
const HEX = /[0-9A-Fa-f]/;
// o que nao pode aparecer cru numa url sem aspas
const NAO_IMPRIMIVEL = /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/;

/**
 * O CSS de `texto` sem comentario e com o espaco normalizado (cada trecho de espaco vira um espaco; o comentario sem
 * espaco em volta vira `/**\/`, porque separa dois nomes); a string e a url sem aspas ficam como vieram. Null quando a
 * leitura nao e segura: `@charset` (decide como o arquivo se le), comentario ou string sem fecho, string com quebra,
 * barra invertida antes da quebra ou no fim, nome escapado antes de `(` (pode ser a url), url sem aspas com aspa,
 * parentese, espaco no meio ou caractere de controle, e o arquivo que nao e UTF-8.
 */
function codigoCss(texto) {
  if (typeof texto !== 'string') return null;
  const t = texto.replace(/\r\n?|\f/g, '\n');
  if (t.indexOf('\ufffd') !== -1 || /@charset/i.test(t)) return null;
  const n = t.length;
  let saida = '';
  let espaco = false;
  let comentou = false;
  function poe(pedaco) {
    if (saida) {
      if (espaco) saida += ' ';
      else if (comentou) saida += '/**/';
    }
    espaco = false;
    comentou = false;
    saida += pedaco;
  }
  let i = 0;
  while (i < n) {
    const c = t[i];
    if (ESPACO_CSS.test(c)) { espaco = true; i++; continue; }
    if (c === '/' && t[i + 1] === '*') {
      const fim = t.indexOf('*/', i + 2);
      if (fim === -1) return null;
      const dentro = t.slice(i + 2, fim);
      i = fim + 2;
      if (DIRETIVA_CSS.test(dentro)) { poe('/*' + dentro + '*/'); continue; }
      comentou = true;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (t[j] !== c) {
        if (j >= n || t[j] === '\n') return null;
        j += t[j] === '\\' ? 2 : 1;
      }
      poe(t.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    if (NOME_CSS.test(c) || c === '\\') {
      let j = i;
      let escapou = false;
      while (j < n) {
        if (t[j] === '\\') {
          escapou = true;
          if (j + 1 >= n || t[j + 1] === '\n') return null;
          if (HEX.test(t[j + 1])) {
            // ate 6 digitos hexadecimais e um espaco opcional que fecha o escape
            let k = j + 1;
            while (k < n && k < j + 7 && HEX.test(t[k])) k++;
            if (k < n && ESPACO_CSS.test(t[k])) k++;
            j = k;
          } else {
            j += 2;
          }
          continue;
        }
        if (!NOME_CSS.test(t[j])) break;
        j++;
      }
      const nome = t.slice(i, j);
      if (t[j] === '(' && escapou) return null;
      if (t[j] === '(' && nome.toLowerCase() === 'url') {
        let k = j + 1;
        while (k < n && ESPACO_CSS.test(t[k])) k++;
        if (t[k] !== '"' && t[k] !== "'") {
          // a url sem aspas e um pedaco so: o `/*` dentro dela nao e comentario (o espaco da borda vale)
          let m = k;
          for (;;) {
            if (m >= n) return null;
            const d = t[m];
            if (d === ')') break;
            if (d === '"' || d === "'" || d === '(' || NAO_IMPRIMIVEL.test(d)) return null;
            if (ESPACO_CSS.test(d)) {
              let p = m;
              while (p < n && ESPACO_CSS.test(t[p])) p++;
              if (t[p] !== ')') return null;
              m = p;
              continue;
            }
            if (d === '\\') {
              if (m + 1 >= n || t[m + 1] === '\n') return null;
              m += 2;
              continue;
            }
            m++;
          }
          poe(t.slice(i, m + 1));
          i = m + 1;
          continue;
        }
      }
      poe(nome);
      i = j;
      continue;
    }
    poe(c);
    i++;
  }
  return saida;
}

// cada leitor e as extensoes dele; .jsx e .tsx ficam fora: o texto de tela do JSX nao se le como codigo
const LEITORES = [
  [/\.(?:[cm]?js|[cm]?ts|gs)$/i, codigo],
  [/\.py[iw]?$/i, codigoPython],
  [/\.css$/i, codigoCss]
];
const EXTENSOES = new RegExp(LEITORES.map(function (l) { return '(?:' + l[0].source + ')'; }).join('|'), 'i');

/** O leitor do arquivo `rel` pela extensao, ou null (sem leitor: nunca e so comentario). */
function leitorDe(rel) {
  if (typeof rel !== 'string') return null;
  for (const [re, ler] of LEITORES) if (re.test(rel)) return ler;
  return null;
}

/**
 * `antes` e `depois` diferem so em comentario ou espaco, lidos pelo leitor de `rel`; false em toda duvida
 * (fail-closed) e no arquivo sem leitor. Sem o 3o argumento (undefined), le como JS, o contrato de antes do G4e; o
 * `rel` null, vazio ou de outra extensao nao tem leitor e da false.
 */
function soComentario(antes, depois, rel) {
  const ler = rel === undefined ? codigo : leitorDe(rel);
  if (ler === null) return false;
  const a = ler(antes);
  if (a === null) return false;
  const d = ler(depois);
  return d !== null && a === d;
}

module.exports = {
  EXTENSOES, DIRETIVA, DIRETIVA_PY, DIRETIVA_CSS, codigo, codigoPython, codigoCss, leitorDe, soComentario
};
