'use strict';
const path = require('path');
const glob = require('./glob.js');
const { entreAspas } = require('./texto.js');

const EXTENSOES_ESTILO = ['.css', '.scss', '.sass', '.less', '.styl'];

function ehArquivoDeEstilo(caminho, projeto) {
  const c = glob.normalizar(caminho).toLowerCase();
  if (EXTENSOES_ESTILO.some(function (e) { return c.endsWith(e); })) return true;
  const extras = projeto && projeto.design && projeto.design.caminhosDeEstilo;
  return glob.casaAlgum(extras, caminho);
}

// RE_COR acha cor escrita a mao no estilo. (PT-05 = item 5 da triagem do lote 2, D423/D424 em docs/decisoes.md.)
// `(?![\w-])` - `#add-btn` e `#fade-overlay` sao seletores de id, nao `#add`/`#fade`; `(?<!&)` - `&#123;`
// tambem nao (D424: o `\w` aqui escondia `solid#f00`; `a#fed {` segue poupado pela regra abaixo, e `url(x.svg#add)`
// volta a ser acusado, falso positivo aceito). O que sobra e `#feed {`: so o caso seguro (D423) e seletor, o resto e valor (`valoresCrus`).
// E3: os argumentos de `rgb(`/`hsl(` aceitam dois niveis de parenteses (`rgb(255 0 0 / calc(1 - min(.2, .5)))`).
// Antes (`[^)]*`), cada `rgb(` sem `)` varria o resto da linha (40 mil levavam 3 s, quadratico); aqui as
// alternativas de cada nivel comecam por caracteres diferentes, sem volta atras. A cor com var() nos canais e
// dinamica e sai no valoresCrus; com var() so no alfa, os canais escritos a mao sao conferidos. O nome da funcao
// nao tem caixa no CSS (`RGBA(...)` e cor): flag `i`.
const RE_COR = /(?<!&)#[0-9a-f]{3,8}(?![\w-])|\b(?:rgba?|hsla?)\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/gi;

// Como `#hex` vira "seletor de id" e fica fora da checagem (as constantes abaixo servem a esse teste, feito em `valoresCrus`):
// Criterio (D423, estreitar ao caso seguro; antes o `{` da linha seguinte e as listas de seletores em cadeia
// decidiam e deixavam passar cor real). `#hex` so e seletor de id quando TUDO vale: (1) comentario `/* */` inline
// e lido como espaco; (2) linha de at-rule (`@include`, `@if`, `@each`...) = valor, salvo at-rule que abre bloco
// de seletor (`@media x { #feed {`); (3) `#hex` dentro de `(` = valor (argumento de mixin/funcao), salvo `(` de
// pseudo-classe de seletor (`:not(#dead) {`); (4) ha um `{` na MESMA linha depois do `#hex` (a linha e cortada
// no primeiro `//`, so para isto) e ele nao e o de `#{` (interpolacao); (5) do ultimo `{`, `}` ou `;` antes do
// `#hex` ate esse `{` so ha caractere de seletor (`ehTrechoDeSeletor`). Sem `{` na linha = valor.
const RE_TERMINADOR = /[{;}]/g;
const RE_CHAR_DE_SELETOR = /[A-Za-z0-9_\s.#,>+~*&-]/;
// D424: `:` so vale como pseudo-classe/elemento quando o NOME e conhecido (lista curta e explicita). `:` + letra
// qualquer escondia a propriedade aninhada do SCSS (`border:solid #f00 { ... }`); nome desconhecido = valor.
const PSEUDOS_FUNCIONAIS = ['not', 'is', 'where', 'has', 'matches', 'any', '-webkit-any', '-moz-any', 'host',
  'host-context', 'global', 'local', 'slotted'];
// As `nth-*` tambem abrem `(`, mas com formula (`2n+1`, `odd`), nao seletor.
const PSEUDOS_NTH = ['nth-child', 'nth-last-child', 'nth-of-type', 'nth-last-of-type'];
const PSEUDOS_CONHECIDOS = new Set(PSEUDOS_FUNCIONAIS.concat(PSEUDOS_NTH, ['hover', 'focus', 'focus-visible',
  'focus-within', 'active', 'visited', 'link', 'checked', 'disabled', 'enabled', 'required', 'optional', 'invalid',
  'valid', 'empty', 'root', 'target', 'first-child', 'last-child', 'only-child', 'first-of-type', 'last-of-type',
  'only-of-type', 'placeholder-shown', 'read-only', 'read-write', 'any-link', 'before', 'after', 'placeholder',
  'selection', 'marker', 'first-line', 'first-letter', 'backdrop']));
const RE_NOME_DE_PSEUDO = /-?[A-Za-z][\w-]*/y;       // `y` + lastIndex: sem fatiar a string a cada `:`
// A2-41: as duas montadas das listas acima, que sao a fonte (antes cada regex escrevia a lista de novo).
// `(` aceito dentro do trecho: as funcionais e as `nth-*`.
const RE_PAREN_DE_PSEUDO = new RegExp(':(?:' + PSEUDOS_FUNCIONAIS.concat(PSEUDOS_NTH).join('|') + ')$');
const RE_AT_DE_BLOCO = /^@(?:media|supports|container|layer|scope|at-root|document|-moz-document)\b/;
// `(` que abre seletor (o `#hex` de dentro e id): so as funcionais.
const RE_PSEUDO_DE_SELETOR = new RegExp(':(?:' + PSEUDOS_FUNCIONAIS.join('|') + ')$');

// As unidades que o portao le. O `%` e as outras (pt, vw, ch...) ficam de fora de
// proposito: bloquear `%` acusaria todo `width:100%`. O README e o CHANGELOG dizem
// isso com estas mesmas unidades, e um teste confere (ronda 2 do Passo 8b).
const UNIDADES = ['px', 'rem', 'em'];
// O sinal e parte do valor: -8px nao e 8px. So conta como sinal o hifen que nao
// vem colado a letra, digito ou ponto - em `.mt-8px` ele e parte do nome.
// D244 (P2 da D238 secao 6): `.04em` sem zero a esquerda. O `\b` antes do digito separava o
// ponto, e a medida lida era `04em`. A segunda alternativa le o ponto quando ele nao vem
// colado a letra, digito ou outro ponto (em `a.5em` ou `1.2.5em` nao e medida inteira).
const RE_MEDIDA = new RegExp('(?:(?<![\\w.-])-)?(?:\\b\\d+(?:\\.\\d+)?|(?<![\\w.])\\.\\d+)(?:' +
  UNIDADES.join('|') + ')\\b', 'g');

function normalizarValor(v) {
  return String(v).trim().toLowerCase().replace(/\s+/g, '');
}

// E3 (D827, do impeccable: a cor comparada ja convertida): a mesma cor escrita de jeitos diferentes e o mesmo valor.
// `#fff`, `#FFFFFF`, `rgb(255,255,255)`, `rgb(255 255 255 / 1)` e `hsl(0,0%,100%)` viram a chave `rgba(255,255,255,1)`.
// O que nao e cor (medida) ou nao se le como cor fica com o normalizarValor de antes: a comparacao so ganha, nunca
// perde, um par que ja casava.
// O numero de um argumento de cor: sem ambiguidade (inteiro com fracao opcional, ou so a fracao) e com teto de
// tamanho, porque o texto vem do estilo escrito, e um `\d*\.?\d+` contra uma corrida longa de digitos volta atras.
const RE_NUMERO_DE_COR = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(%|deg)?$/;
// (em minusculas: a unidade do CSS nao tem caixa, `120DEG` = `120deg`)
function numeroDeCor(t) { return typeof t === 'string' && t.length <= 24 ? RE_NUMERO_DE_COR.exec(t.toLowerCase()) : null; }
function canal(t, maximo) {
  const m = numeroDeCor(t);
  if (!m || m[2] === 'deg') return null;
  const n = m[2] ? parseFloat(m[1]) * maximo / 100 : parseFloat(m[1]);
  return Math.min(maximo, Math.max(0, n));
}
function alfa(t) {
  if (t === undefined) return 1;
  const a = canal(t, 1);
  return a === null ? null : alfaDe255(Math.round(a * 255));
}
// O alfa como a tela o guarda, em 256 degraus: `.5` e o `80` do hex de 8 digitos sao o mesmo degrau (128).
function alfaDe255(n) { return Math.round(n / 255 * 1000) / 1000; }
function deHex(h) {
  const d = h.length <= 4 ? h.split('').map(function (c) { return c + c; }) : h.match(/../g);
  const n = d.map(function (x) { return parseInt(x, 16); });
  return [n[0], n[1], n[2], n.length > 3 ? alfaDe255(n[3]) : 1];
}
function deHsl(h, s, l) {
  const graus = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((graus / 60) % 2 - 1));
  const m = l - c / 2;
  const [r, g, b] = graus < 60 ? [c, x, 0] : graus < 120 ? [x, c, 0] : graus < 180 ? [0, c, x] :
    graus < 240 ? [0, x, c] : graus < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map(function (v) { return Math.round((v + m) * 255); });
}
function chaveDoValor(v) {
  const n = normalizarValor(v);
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(n);
  let rgba = null;
  if (hex) {
    rgba = deHex(hex[1]);
  } else {
    // O texto original (com espacos) separa os argumentos: `rgb(255 255 255 / .5)` ou `rgb(255,255,255,.5)`.
    // (sem `\s*` antes dos argumentos: os dois casariam o mesmo espaco, e o `rgb(` sem `)` voltaria atras)
    const f = /^\s*(rgba?|hsla?)\(([^)]*)\)\s*$/i.exec(String(v));
    if (f) {
      const partes = f[2].trim().split(/\s*[,/]\s*|\s+/).filter(Boolean);
      if (partes.length === 3 || partes.length === 4) {
        const a = alfa(partes[3]);
        if (/^rgb/i.test(f[1])) {
          const cs = partes.slice(0, 3).map(function (t) { return canal(t, 255); });
          if (a !== null && cs.every(function (c) { return c !== null; })) rgba = cs.map(Math.round).concat([a]);
        } else {
          const numeroDoMatiz = numeroDeCor(partes[0]);
          const matiz = numeroDoMatiz && numeroDoMatiz[2] !== '%' ? parseFloat(numeroDoMatiz[1]) : null;
          // Saturacao e luz em porcentagem, ou em numero puro (a sintaxe nova do CSS: `hsl(120 10 50)` = 10%, 50%).
          const pct = function (t) {
            if (/%$/.test(t)) return canal(t, 1);
            const m = numeroDeCor(t);
            return m && !m[2] ? canal(t + '%', 1) : null;
          };
          const s = pct(partes[1]);
          const l = pct(partes[2]);
          if (matiz !== null && s !== null && l !== null && a !== null) rgba = deHsl(matiz, s, l).concat([a]);
        }
      }
    }
  }
  if (rgba) return 'rgba(' + rgba.join(',') + ')';
  // A cor que nao se converte (`rgb(255 0 0 / calc(.5))`) guarda um espaco entre os argumentos: sem ele (o
  // normalizarValor), `rgb(25 50 0 ...)` e `rgb(255 0 0 ...)` dariam a mesma chave. Duas passadas lineares.
  if (/^\s*(?:rgba?|hsla?)\(/i.test(String(v))) {
    return String(v).trim().toLowerCase().replace(/\s+/g, ' ').replace(/ ?([,/()]) ?/g, '$1');
  }
  return n;
}
// A cor com var() apagado (`rgba(255, 0, 0,          )`): com os tres canais escritos, a chave e a da cor opaca
// deles; com menos (um canal veio do var()), null e a cor e dinamica.
function canaisEscritos(semVarDentro) {
  const abre = semVarDentro.indexOf('(');
  const nome = semVarDentro.slice(0, abre).toLowerCase().replace(/a$/, '');
  const partes = semVarDentro.slice(abre + 1, -1).split(/[\s,/]+/).filter(Boolean);
  return partes.length === 3 ? chaveDoValor(nome + '(' + partes.join(' ') + ')') : null;
}
// O achado de cor e o de fonte ja trazem a chave do texto original; medida e anti-referencia, so o valor.
function chaveDoAchado(a) { return a.chave || chaveDoValor(a.valor); }
// No desconto do `old_string`, a fonte tem a sua chave a parte: a fonte "8px" do legado nao desconta a medida 8px.
function chaveDoDesconto(a) { return (a.tipo === 'fonte' ? 'fonte:' : '') + chaveDoAchado(a); }

// D429/5: so o `var(--nome,` e o `)` que fecha viram espaco (indices intactos); o fallback fica e e lido como valor.
// Uma passada (linear), pilha de `(` para achar o `)` certo do `var(` mesmo com `rgba(...)` ou `var(` aninhado.
const RE_ABRE_VAR = /var\(\s*(?:--[\w-]*)?\s*,?/y;
function semVar(linha) {
  const saida = linha.split('');
  const pilha = [];                                    // um item por `(` aberto: true = `(` de var()
  for (let i = 0; i < linha.length; i++) {
    const c = linha.charAt(i);
    if (c === 'v' && !/[\w-]/.test(linha.charAt(i - 1))) {
      RE_ABRE_VAR.lastIndex = i;
      const m = RE_ABRE_VAR.exec(linha);
      if (m) {
        for (let j = i; j < i + m[0].length; j++) saida[j] = ' ';
        pilha.push(true);
        i += m[0].length - 1;
        continue;
      }
    }
    if (c === '(') pilha.push(false);
    else if (c === ')' && pilha.length && pilha.pop()) saida[i] = ' ';
  }
  return saida.join('');
}

// S5: primeiro delimitador de comentario a partir de `i`, fora de string ('..' ou ".." com `\` de escape; a string morre no
// fim da linha): { tipo: 'abre' (`/*`) | 'fecha' (`*/`) | 'linha' (`//` que nao e `://` de url), pos } ou null.
function proximoDelim(linha, i) {
  let aspa = '';
  for (; i < linha.length; i++) {
    const c = linha.charAt(i);
    if (aspa) {
      if (c === '\\') i++;
      else if (c === aspa) aspa = '';
    } else if (c === '"' || c === "'") aspa = c;
    else if (c === '/' && linha.charAt(i + 1) === '*') return { tipo: 'abre', pos: i };
    else if (c === '*' && linha.charAt(i + 1) === '/') return { tipo: 'fecha', pos: i };
    else if (c === '/' && linha.charAt(i + 1) === '/' && linha.charAt(i - 1) !== ':') return { tipo: 'linha', pos: i };
  }
  return null;
}

// S5: comentario de bloco (`/* */`) atravessa linhas. O que esta dentro dele vira espaco (indices intactos) e o
// resto da linha e lido; `emBloco` diz se a linha ja comeca dentro de um. Uma passada por linha (linear).
// Linha que COMECA com `//` e comentario inteiro e nao abre bloco (`// x /*`).
function semComentario(linha, emBloco) {
  if (!emBloco && /^\s*\/\//.test(linha)) return { texto: '', emBloco: false };
  let saida = '';
  let i = 0;
  while (i < linha.length) {
    if (emBloco) {
      const fim = linha.indexOf('*/', i);
      const ate = fim === -1 ? linha.length : fim + 2;
      saida += ' '.repeat(ate - i);
      i = ate;
      emBloco = fim === -1;
    } else {
      const d = proximoDelim(linha, i);
      // `//` antes do `/*`: o resto da linha e comentario de linha, o `/*` dele nao abre bloco (a cor, como antes, e lida)
      if (!d || d.tipo === 'linha') { saida += linha.slice(i); break; }
      const ate = d.tipo === 'abre' ? d.pos : d.pos + 2;   // `*/` solto fora de bloco e texto
      saida += linha.slice(i, ate);
      i = ate;
      emBloco = d.tipo === 'abre';
    }
  }
  return { texto: saida, emBloco: emBloco };
}

// S5: texto que comeca no meio de um comentario (o `new_string` de um Edit): o primeiro delimitador de bloco fora de
// string e `*/`. NAO pular linha iniciada por `*` (`* { padding: 13px }` e o seletor universal).
function comecaEmBloco(linhas) {
  for (const l of linhas) {
    if (/^\s*\/\//.test(l)) continue;
    const d = proximoDelim(l, 0);
    if (d && d.tipo !== 'linha') return d.tipo === 'fecha';
  }
  return false;
}

// S5: so a DECLARACAO do token (`--nome: valor`, ate `;` ou `}`) fica fora; o resto da linha e lido. O `--` precisa
// abrir o nome (`.btn--primary:hover` nao e token).
function semDeclaracaoDeToken(linha) {
  return linha.replace(/(?<![\w-])--[\w-]+\s*:[^;}]*/g, function (c) { return ' '.repeat(c.length); });
}

// Trecho de seletor: so letras, digitos, `_`, `-`, espaco, `.`, `#`, `,`, `>`, `+`, `~`, `*`, `&`, `:` de
// pseudo (`:`/`::` seguido de NOME conhecido, ate o fim do nome - D424), `(`/`)` de pseudo funcional balanceados
// e seletor de atributo `[...]` balanceado (S5).
function ehTrechoDeSeletor(s) {
  let fundo = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (RE_CHAR_DE_SELETOR.test(c)) continue;
    if (c === ':') {
      RE_NOME_DE_PSEUDO.lastIndex = s.charAt(i + 1) === ':' ? i + 2 : i + 1;
      const nome = RE_NOME_DE_PSEUDO.exec(s);
      if (!nome || !PSEUDOS_CONHECIDOS.has(nome[0].toLowerCase())) return false;
      i = RE_NOME_DE_PSEUDO.lastIndex - 1;             // o resto do nome ja foi lido
      continue;
    }
    if (c === '(' && RE_PAREN_DE_PSEUDO.test(s.slice(Math.max(0, i - 24), i))) { fundo++; continue; }
    if (c === ')' && fundo > 0) { fundo--; continue; }
    if (c === '[') {                                   // S5: seletor de atributo; `[` sem `]` encerra (linear)
      const fecha = s.indexOf(']', i + 1);
      if (fecha === -1) return false;
      i = fecha;
      continue;
    }
    return false;
  }
  return fundo === 0;
}

// As linhas do estilo sem o que nao e valor: comentario, a propria definicao do token e o `var()`. Uma so limpeza
// para a cor, a medida e a fonte.
// `manterVar: true` deixa o var(): o valoresCrus olha nele se a cor tem var() dentro (sem o comentario, que nao conta).
function linhasLimpas(texto, opcoes) {
  const linhas = String(texto == null ? '' : texto).split(/\r?\n/);
  const tirarVar = !(opcoes && opcoes.manterVar);
  let emBloco = comecaEmBloco(linhas);
  return linhas.map(function (l) {
    const r = semComentario(l, emBloco);
    emBloco = r.emBloco;
    const semToken = semDeclaracaoDeToken(r.texto);
    return tirarVar ? semVar(semToken) : semToken;
  });
}

function valoresCrus(texto) {
  const achados = [];
  const limpas = linhasLimpas(texto);
  // As mesmas linhas com o var() ainda escrito (a limpeza guarda as posicoes): o `var(` de um comentario ja saiu.
  const linhasComVar = linhasLimpas(texto, { manterVar: true });
  limpas.forEach(function (limpa, i) {
    const linhaDeValor = limpa.trim().charAt(0) === '@' && !RE_AT_DE_BLOCO.test(limpa.trim());
    const corte = limpa.indexOf('//');                 // so para decidir: o `{` de um `//` nao conta (a cor, sim)
    const paraTerm = corte === -1 ? limpa : limpa.slice(0, corte);
    const term = [];
    for (const t of paraTerm.matchAll(RE_TERMINADOR)) term.push(t.index);
    let k = 0;                                         // as cores vem em ordem: os ponteiros so avancam
    let kChecado = -1;                                 // trecho (entre dois terminadores) ja conferido
    let trechoOk = false;
    let pos = 0;
    const pilha = [];                                  // um item por `(` aberto: true = `(` de seletor
    let abertosDeValor = 0;
    for (const m of limpa.matchAll(RE_COR)) {
      for (; pos < m.index; pos++) {
        const c = limpa.charAt(pos);
        if (c === '(') {
          const sel = RE_PSEUDO_DE_SELETOR.test(limpa.slice(Math.max(0, pos - 24), pos));
          pilha.push(sel);
          if (!sel) abertosDeValor++;
        } else if (c === ')' && pilha.length) {
          if (!pilha.pop()) abertosDeValor--;
        }
      }
      if (m[0].charAt(0) === '#' && !linhaDeValor && abertosDeValor === 0) {
        const fim = m.index + m[0].length;
        while (k < term.length && term[k] < fim) k++;
        // `{` da mesma linha, que nao seja o de `#{`; e o trecho (do terminador anterior ate ele) so de seletor.
        // Todos os `#hex` do mesmo trecho dividem o resultado: a conferencia roda uma vez por trecho (linear).
        if (k < term.length && limpa.charAt(term[k]) === '{' && limpa.charAt(term[k] - 1) !== '#') {
          if (kChecado !== k) {
            kChecado = k;
            trechoOk = ehTrechoDeSeletor(limpa.slice(k > 0 ? term[k - 1] + 1 : 0, term[k]));
          }
          if (trechoOk) continue;                      // `#feed {`: seletor de id, nao cor
        }
      }
      // A chave sai do texto como escrito: sem os espacos, `rgb(255 255 255)` grudaria os argumentos.
      // O valor do aviso e a cor como foi escrita (so em minusculas, com um espaco so); a chave compara.
      const valor = m[0].trim().toLowerCase().replace(/\s+/g, ' ');
      let chave = chaveDoValor(m[0]);
      if (m[0].charAt(0) !== '#' && /(?:^|[^\w-])var\(/.test(linhasComVar[i].slice(m.index, m.index + m[0].length))) {
        // `rgb(var(--r), var(--g), var(--b))`: o semVar apagou os var(), e o que sobra (`rgb( , , )`) nao e cor crua.
        // Com os tres canais escritos a mao e o var() so no alfa (`rgba(255, 0, 0, var(--a))`), a cor e a dos canais.
        const canais = canaisEscritos(m[0]);
        if (!canais) continue;
        chave = canais;
      }
      achados.push({ valor: valor, tipo: 'cor', linha: i + 1, chave: chave });
    }
    for (const v of (limpa.match(RE_MEDIDA) || [])) achados.push({ valor: normalizarValor(v), tipo: 'medida', linha: i + 1 });
  });
  return achados;
}

// E3 (dono, 2026-11-10: "fontes" opcional no design.json): as familias do `font-family` escritas no estilo, cada
// uma num achado. A familia generica (serif, sans-serif, system-ui...) e as palavras globais sempre valem. O atalho
// `font:` fica de fora: nele a familia vem depois de tamanho e altura de linha, e ler errado acusaria o que nao e
// fonte. Mesma limpeza do valoresCrus: comentario, a declaracao do proprio token e o `var()` nao contam.
const FONTES_GENERICAS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif',
  'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', 'inherit', 'initial', 'unset', 'revert',
  'revert-layer',
  // a fonte do proprio sistema operacional, na pilha de sempre (`-apple-system, BlinkMacSystemFont, sans-serif`)
  '-apple-system', 'blinkmacsystemfont']);
// A lista vai ate o `;`, o `{` ou o `}`, e so continua na linha de baixo depois de uma virgula no fim da linha:
// em .sass e .styl, sem `;`, a declaracao acaba na quebra de linha (e nao engole a linha seguinte). A linha em
// branco (a de comentario ja limpa) entre dois nomes nao corta a lista. A linha de baixo que comeca com `nome:` e
// outra declaracao (o mapa do SCSS com virgula no fim, `font-family: Inter,\n  color: red`, ou `$x:`), nao
// familia. As quebras e o recuo entram num grupo atomico (o lookahead que captura e o `\2`): sem ele, o recuo longo
// antes de um `nome:` voltava um espaco por vez e relia o resto, quadratico.
const RE_FONT_FAMILY = /(?:^|[\s;{])font-family\s*:\s*([^;{}\n]*(?:(?<=,[ \t]*)(?=((?:\n[ \t]*)+))\2(?![$@]?[\w-]+\s*:)[^;{}\n]*)*)/gi;
// O `//` no fim da linha, fora de aspas e que nao e `://`, e comentario no .sass, .scss e .styl: vira espaco do
// mesmo tamanho, senao o texto dele entraria como nome de fonte. So na leitura da fonte (a cor, como antes, le).
// O `//` logo depois de `(` e o endereco sem protocolo de `url(//cdn/x.png)`, nao comentario.
function depoisDeParentese(linha, pos) {
  let j = pos - 1;
  while (j >= 0 && (linha.charAt(j) === ' ' || linha.charAt(j) === '\t')) j--;
  return linha.charAt(j) === '(';
}
function semComentarioDeLinha(linha) {
  let d = proximoDelim(linha, 0);
  while (d && (d.tipo !== 'linha' || depoisDeParentese(linha, d.pos))) d = proximoDelim(linha, d.pos + 2);
  return d ? linha.slice(0, d.pos) + ' '.repeat(linha.length - d.pos) : linha;
}
// A familia como o sistema a compara: sem aspas nas pontas, em minusculas e com um espaco so ("Open  Sans" =
// "open sans"); vale para o que o estilo escreve e para o que o design.json declara.
function chaveDaFonte(v) {
  return String(v).trim().replace(/^["']|["']$/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
}
// As familias da lista, cada uma com a posicao dela: a virgula dentro de aspas ("Foo, Bar") e do nome, e a de dentro
// de parenteses e da funcao (`map-get($f, corpo)` fica inteira, e a funcao nao e conferida). Uma passada.
function partesDaLista(lista) {
  const partes = [];
  let inicio = 0;
  let aspa = '';
  let fundo = 0;
  for (let i = 0; i < lista.length; i++) {
    const c = lista.charAt(i);
    if (aspa) { if (c === '\\') i++; else if (c === aspa) aspa = ''; continue; }   // `\` escapa, como no proximoDelim
    if (c === '"' || c === "'") { aspa = c; continue; }
    if (c === '(') fundo++;
    else if (c === ')' && fundo > 0) fundo--;
    else if (c === ')') { lista = lista.slice(0, i); break; }   // o `)` sem `(` fecha o mapa do SCSS: a lista acaba
    else if (c === ',' && fundo === 0) { partes.push({ texto: lista.slice(inicio, i), inicio: inicio }); inicio = i + 1; }
  }
  // A ultima familia entra mesmo com a aspa aberta (o new_string cortado no meio): sem isso, passaria sem conferir.
  partes.push({ texto: lista.slice(inicio), inicio: inicio });
  return partes;
}
// A interpolacao (`#{...}`, ate o `}` da mesma linha) vira `$` e espacos, do mesmo tamanho: as posicoes ficam, o `{` dela
// nao corta a lista. Uma passada: o `#{` sem `}` ate a quebra pula direto para ela (uma regex varreria a linha de
// novo a cada `#{`, quadratico).
function semInterpolacao(s) {
  let saida = '';
  let i = 0;
  while (i < s.length) {
    const abre = s.indexOf('#{', i);
    if (abre === -1) { saida += s.slice(i); break; }
    let fim = abre + 2;
    while (fim < s.length && s.charAt(fim) !== '}' && s.charAt(fim) !== '\n') fim++;
    if (s.charAt(fim) === '}') {
      // `$` e espacos: o nome com a interpolacao colada (`Inter#{$x}`) e variavel, nao a familia `inter`.
      saida += s.slice(i, abre) + '$' + ' '.repeat(fim - abre);
      i = fim + 1;
    } else {
      saida += s.slice(i, fim);                        // sem `}` nesta linha: nenhum `#{` dela fecha
      i = fim;
    }
  }
  return saida;
}
// O fim do bloco `@font-face` com chave (CSS, SCSS, LESS): o `}`, ou o `{` de outra regra antes dele (o bloco
// cortado no meio, num new_string de Edit, nao engole a regra seguinte). `pos` e logo depois do `{` que abre.
function fimDoBlocoComChave(s, pos) {
  let j = pos;
  while (j < s.length && s.charAt(j) !== '}' && s.charAt(j) !== '{') j++;
  return j;
}
// No .sass e no .styl, sem chave: a primeira linha com texto e recuo igual ou menor que o da linha do `@font-face`.
function recuoDaLinha(s, inicio) {
  let j = inicio;
  while (j < s.length && (s.charAt(j) === ' ' || s.charAt(j) === '\t')) j++;
  return j - inicio;
}
function fimDoBlocoPorRecuo(s, pos) {
  const recuo = recuoDaLinha(s, s.lastIndexOf('\n', pos) + 1);
  let quebra = s.indexOf('\n', pos);
  while (quebra !== -1) {
    const inicio = quebra + 1;
    const r = recuoDaLinha(s, inicio);
    const c = s.charAt(inicio + r);
    if (c !== '' && c !== '\n' && c !== '\r' && r <= recuo) return inicio;
    quebra = s.indexOf('\n', inicio + r);
  }
  return s.length;
}
function fontesCruas(texto) {
  const achados = [];
  // O texto limpo inteiro, nao linha a linha, para a lista que continua na linha de baixo (`Inter,\n  Comic`).
  const limpo = semInterpolacao(linhasLimpas(texto).map(semComentarioDeLinha).join('\n'));
  // A linha sai da posicao, contando as quebras so do trecho novo (as posicoes crescem): linear no tamanho.
  let posContada = 0;
  let linhaContada = 1;
  const linhaDe = function (pos) {
    for (; posContada < pos; posContada++) if (limpo.charCodeAt(posContada) === 10) linhaContada++;
    return linhaContada;
  };
  // O `font-family` de dentro do `@font-face` da nome a familia que o arquivo carrega; nao e uso dela. So o primeiro
  // de cada bloco (a face tem um descritor so): um segundo, no bloco que nao fechou, e conferido. Os blocos vem em
  // ordem e o ponteiro so avanca (linear).
  const faces = [];
  // (o `@font-face` comeca a regra: depois do inicio, de espaco, `;`, `{` ou `}`; o de dentro de uma string nao e face)
  for (const f of limpo.matchAll(/(?:^|[\s;{}])@font-face\b\s*(\{)?/gi)) {
    if (faces.length && f.index < faces[faces.length - 1].fim) continue;   // ja dentro do bloco anterior
    const fim = f[1] ? fimDoBlocoComChave(limpo, f.index + f[0].length) : fimDoBlocoPorRecuo(limpo, f.index);
    faces.push({ inicio: f.index, fim: fim, usado: false });
  }
  let k = 0;
  for (const m of limpo.matchAll(RE_FONT_FAMILY)) {
    // A posicao do proprio `font-family` (sem o caractere da frente): o `{` que fecha a face cortada e o comeco da
    // linha que fecha a face por recuo ja sao da regra seguinte.
    const pos = /^f/i.test(m[0]) ? m.index : m.index + 1;
    while (k < faces.length && faces[k].fim <= pos) k++;
    if (k < faces.length && faces[k].inicio < pos && !faces[k].usado) { faces[k].usado = true; continue; }
    const base = m.index + m[0].length - m[1].length;
    for (const parte of partesDaLista(m[1])) {
      const familia = chaveDaFonte(parte.texto.replace(/!\s*important/i, ''));
      // Generica, palavra global, e o que nao e nome de fonte: variavel ($x, @x, ou a interpolacao, que vira `$`) e
      // funcao (theme(...)). Esses o portao nao le, como nao le `$var` na cor. O nome entre aspas e nome, mesmo com
      // `(` ou `$` dentro ("Fonte (Bold)").
      const nomeEntreAspas = /^\s*["']/.test(parte.texto);
      if (!familia || FONTES_GENERICAS.has(familia)) continue;
      // O pedaco `nome: valor` e a chave seguinte do mapa do SCSS de uma linha: a lista acabou.
      if (!nomeEntreAspas && familia.indexOf(':') !== -1) break;
      if (!nomeEntreAspas && (familia.indexOf('$') !== -1 || familia.charAt(0) === '@' || familia.indexOf('(') !== -1)) continue;
      achados.push({ valor: familia, tipo: 'fonte', linha: linhaDe(base + parte.inicio + parte.texto.search(/\S|$/)), chave: familia });
    }
  }
  return achados;
}

// A entrevista do /sworn:init coleta anti-referencia em PORTUGUES ("gradiente"), e
// CSS se escreve em INGLES ("linear-gradient"). O cognato so difere pela vogal final,
// entao a busca cai para o radical. ALCANCE MEDIDO: 2 de 7 casos reais de CSS - so o par
// gradiente/gradient. Termo sem cognato ("sombra" x "box-shadow") continua passando:
// limite declarado por teste, nao escondido. D124.
function radical(anti) {
  const a = anti.trim().toLowerCase().split(/\s+/)[0];
  return (a.length > 4 && /e$/.test(a)) ? a.slice(0, -1) : a;
}

// s192: so texto com radical vale. O radical vazio casava toda linha; a lista que nao e lista lancava (e o portao
// liberava) ou corria letra por letra. Texto solto vale como lista de um, como nas listas de `conferir`.
function antiValida(a) {
  return typeof a === 'string' && radical(a) !== '';
}

// A2-46: a posicao (1 a n) de cada anti-referencia que a conferencia deixa de lado, para o aviso dizer quais.
function antiIgnoradas(sistema) {
  const posicoes = [];
  comoLista(sistema.antiReferencias).forEach(function (a, i) { if (!antiValida(a)) posicoes.push(i + 1); });
  return posicoes;
}

// As posicoes numa frase, ate 12 e "e mais N": "item 2", "itens 1, 3" (ou outro par de palavras, como em nasPosicoes).
function itens(posicoes, umaPalavra, variasPalavras) {
  return (posicoes.length > 1 ? (variasPalavras || 'itens') : (umaPalavra || 'item')) + ' ' +
    posicoes.slice(0, 12).join(', ') + (posicoes.length > 12 ? ' e mais ' + (posicoes.length - 12) : '');
}

// "tamanhos" (de fonte) e "fontes" sao opcionais (dono, 2026-11-10): sem elas, o sistema le como antes.
const CHAVES_DE_VALOR = ['cores', 'raios', 'espacos', 'sombras', 'tamanhos', 'fontes'];
// As familias de um item de "fontes", lidas como o estilo as escreve: o item pode ser a pilha inteira
// ("Inter, sans-serif") e as aspas sozinhas ('""') nao dao familia nenhuma.
function familiasDoItem(v) {
  return typeof v === 'string' ? partesDaLista(v).map(function (p) { return chaveDaFonte(p.texto); }).filter(Boolean) : [];
}
// O item que da ao menos uma familia vale; as fontes que o proprio sistema declara assim ligam a conferencia da fonte,
// e so com elas o aviso e o design.md mostram a linha "fontes".
function fonteValida(v) { return familiasDoItem(v).length > 0; }
function fontesDeclaradas(sistema) { return comoLista(sistema && sistema.fontes).filter(fonteValida); }
// O exemplo de item valido de cada chave, para a mensagem do item sem efeito.
const EXEMPLOS_DA_CHAVE = { cores: '"#1a1a1a"', sombras: '"0 1px 2px #0003"', tamanhos: '"14px"', fontes: '"Inter"' };
function exemploDaChave(chave) { return EXEMPLOS_DA_CHAVE[chave] || '"8px"'; }
// O que vale num item da chave: em "fontes", o texto so de aspas nao e nome de fonte.
function regraDoItem(chave) {
  return (chave === 'fontes' ? 'so vale nome de fonte, como ' : 'so vale texto, como ') + exemploDaChave(chave);
}
// Quantos pontos de codigo dos motivos cabem na linha "desvios desta tela" (100 de largura); o corte poe "...".
const LARGURA_DOS_MOTIVOS = 70;
// O valor de uma chave do design.json como lista: texto solto vale como lista de um; vazio e nulo valem nada.
function comoLista(v) { return [].concat(v || []); }
// A posicao do item na frase: "na posicao 2", "nas posicoes 1, 3".
function nasPosicoes(posicoes) { return itens(posicoes, 'na posicao', 'nas posicoes'); }
// O padrao sem nenhuma pasta escrita por extenso casa o projeto inteiro ("**", "*", "**/*", e tambem "**/*.css" ou
// "*.scss", que pegam toda folha de estilo): o desvio e de uma tela, nao do sistema. "src/checkout/**" tem pasta.
function casaTudo(padrao) {
  // A barra invertida e o "./" da frente saem pelo glob.normalizar, o mesmo do portao.
  const partes = glob.normalizar(String(padrao).trim()).split('/');
  const nome = partes.pop();
  return partes.every(function (p) { return /^[*.]*$/.test(p); }) && /^[*.\s]*(\*\.[\w-]+)?$/.test(nome);
}
// O item de lista que vale: texto com algo alem de espaco (o validar, o aviso e a revisao leem igual).
function textoNaoVazio(x) { return typeof x === 'string' && x.trim() !== ''; }
// A posicao (1 a n) de cada item da lista que nao e texto nao vazio: o item sem efeito.
// Em "fontes", o item so de aspas tambem nao tem efeito (nao da familia nenhuma).
function posicoesSemEfeito(v, chave) {
  const posicoes = [];
  comoLista(v).forEach(function (x, i) {
    const vale = chave === 'fontes' ? fonteValida(x) : textoNaoVazio(x);
    if (!vale) posicoes.push(i + 1);
  });
  return posicoes;
}

// E2 (D827): o desvio declarado por tela. No lugar do MASTER.md e de um arquivo de pagina por tela (o desenho do
// ui-ux-pro-max-skill, todo em prosa), o sistema mestre e o proprio design.json, e cada tela que foge dele ganha um
// item da lista `desvios`, no mesmo arquivo, que o portao e a revisao leem. O item diz em quais arquivos vale
// (`arquivos`: caminhos ou globs a partir da raiz do projeto), por que (`motivo`, obrigatorio) e, se quiser, ate quando
// (`ate`, AAAA-MM-DD); os valores dele (as chaves de CHAVES_DE_VALOR) somam aos do sistema so naqueles arquivos. O
// desvio sem motivo, torto ou vencido nao vale: o valor dele volta a ser valor fora do sistema.
function dataValida(t) {
  if (typeof t !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
  const d = new Date(t + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t;
}
// O dia de hoje na hora local de quem roda (o "ate" e escrito pela pessoa, no dia dela): em UTC, o desvio de uma tela
// no Brasil venceria as 21h do proprio dia. O `hoje` e opcional e so vale como Date (o teste fixa o dia): o que nao e
// Date valido, inclusive texto "AAAA-MM-DD", vale o relogio.
function hojeEmTexto(hoje) {
  const d = hoje instanceof Date && !isNaN(hoje.getTime()) ? hoje : new Date();
  const dois = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + dois(d.getMonth() + 1) + '-' + dois(d.getDate());
}
// O desvio vale ate o fim do dia do `ate`; no dia seguinte, venceu. A regra mora so aqui (portao e validar usam esta).
function venceu(d, dia) { return !!d.ate && d.ate < dia; }
// O que esta torto no desvio (texto), ou null.
// `sistema`: o design.json inteiro. Num sistema sem "fontes", a chave "fontes" do desvio nao tem efeito nenhum e
// nao e conferida (sem fontes, nada muda).
function problemaDoDesvio(d, sistema) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return 'nao e um objeto ({ "arquivos": [...], "motivo": "..." })';
  const arquivos = comoLista(d.arquivos);
  if (!arquivos.length) return 'sem "arquivos" (os caminhos da tela onde o desvio vale, como "src/checkout/**")';
  const arquivosRuins = posicoesSemEfeito(arquivos);
  if (arquivosRuins.length) {
    return 'com "arquivos" sem efeito ' + nasPosicoes(arquivosRuins) + ' (so vale texto, como "src/checkout/**")';
  }
  const amplos = arquivos.map(function (a, i) { return casaTudo(a) ? i + 1 : 0; }).filter(Boolean);
  if (amplos.length) {
    return 'com um caminho em "arquivos" que vale para o projeto inteiro, ' + nasPosicoes(amplos) + ' (um desvio e de ' +
      'uma tela: use o caminho dela, como "src/checkout/**"; o valor que vale em todas as telas vai ao proprio ' +
      'sistema, na chave do tipo dele (' + CHAVES_DE_VALOR.map(function (c) { return '"' + c + '"'; }).join(', ') +
      '), com o sim do dono)';
  }
  if (typeof d.motivo !== 'string' || d.motivo.trim() === '') return 'sem "motivo" (por que esta tela foge do sistema)';
  // Sem "ate" (ou "ate": null), o desvio nao tem prazo.
  if (d.ate != null && !dataValida(d.ate)) return '"ate" nao e uma data que existe, no formato AAAA-MM-DD (como "2026-12-31")';
  for (const chave of CHAVES_DE_VALOR) {
    if (chave === 'fontes' && !fontesDeclaradas(sistema).length) continue;
    const ruins = posicoesSemEfeito(d[chave], chave);
    if (ruins.length) return 'com "' + chave + '" sem efeito ' + nasPosicoes(ruins) + ' (' + regraDoItem(chave) + ')';
  }
  return null;
}
// Os itens de "desvios" cujos `arquivos` casam o caminho, bons ou tortos: a regra de "desvio desta
// tela" mora so aqui. So a lista vale, como no validar: um objeto solto em "desvios" e erro de forma, nao um desvio.
function desviosQueCasam(sistema, caminho) {
  if (!sistema || typeof sistema !== 'object' || typeof caminho !== 'string' || !caminho ||
    !Array.isArray(sistema.desvios)) return [];
  return sistema.desvios.filter(function (d) {
    return d && typeof d === 'object' && glob.casaAlgum(comoLista(d.arquivos), caminho);
  });
}
/** Os desvios que valem para `caminho` hoje: os que casam o caminho, bem formados e nao vencidos. */
function desviosDoArquivo(sistema, caminho, hoje) {
  const dia = hojeEmTexto(hoje);
  return desviosQueCasam(sistema, caminho).filter(function (d) { return !problemaDoDesvio(d, sistema) && !venceu(d, dia); });
}
// O motivo numa linha so, para o aviso e o design.md: a quebra de linha do design.json nao abre linha nova no texto.
function motivoEmUmaLinha(d) { return d.motivo.replace(/\s+/g, ' ').trim(); }

// A4-des-1 (pedido 12, fila §5; D721): o design.json nao tinha validador - a anti-referencia sem efeito so aparecia
// no aviso de negacao (motivo, abaixo) e a escrita sem valor fora passava calada. Le as chaves que o conferir le, com
// a mesma leitura (texto solto vale como lista de um; vazio e nulo valem nada), e cada item de `desvios` pela regra
// do portao (problemaDoDesvio e venceu); o validar.js chama quando o arquivo existe.
function validar(sistema, hoje) {
  if (!sistema || typeof sistema !== 'object' || Array.isArray(sistema)) {
    const tipo = Array.isArray(sistema) ? 'lista' : (sistema === null ? 'nulo' : typeof sistema);
    return { ok: false, erros: ['o design.json tem de ser um objeto JSON ({ ... }), e veio ' + tipo] };
  }
  const erros = [];
  for (const chave of CHAVES_DE_VALOR) {
    const ruins = posicoesSemEfeito(sistema[chave], chave);
    if (ruins.length) {
      erros.push(chave + ': ' + itens(ruins) + ' sem efeito (' + regraDoItem(chave) + '): corrija ou tire' +
        ' do design.json');
    }
  }
  const ignoradas = antiIgnoradas(sistema);
  if (ignoradas.length) {
    erros.push('antiReferencias: ' + itens(ignoradas) + ' sem efeito (so vale texto nao vazio, como "gradiente"; so' +
      ' espacos, numero ou objeto nao valem): corrija ou tire do design.json');
  }
  // E2: cada desvio torto ou vencido, pela posicao; o portao ignora os dois. Nulo vale como lista vazia, como no portao.
  if (sistema.desvios != null && !Array.isArray(sistema.desvios)) {
    erros.push('desvios: tem de ser uma lista ([ { "arquivos": [...], "motivo": "..." } ]): corrija ou tire do design.json');
  } else {
    const dia = hojeEmTexto(hoje);
    comoLista(sistema.desvios).forEach(function (d, i) {
      const problema = problemaDoDesvio(d, sistema);
      // Nos dois casos o desvio nao vale, e os valores dele voltam a ser barrados naquela tela.
      if (problema) {
        erros.push('desvios: item ' + (i + 1) + ' ' + problema + ': nao vale, e os valores dele voltam a ser barrados; ' +
          'corrija ou tire do design.json');
      } else if (venceu(d, dia)) {
        erros.push('desvios: item ' + (i + 1) + ' venceu em ' + d.ate + ': nao vale mais, e os valores dele voltam a ser ' +
          'barrados; renove o "ate" ou tire o desvio (decisao do dono)');
      }
    });
  }
  return { ok: erros.length === 0, erros: erros };
}

// Os valores aceitos num arquivo: o sistema e os desvios declarados para ele (`caminho`, relativo a raiz do projeto).
// Dois conjuntos: o dos valores (a cor convertida, a medida) e o das fontes (o nome). Num so, uma fonte chamada
// "8px" liberaria a medida 8px. Serve a conferencia do texto escrito e a do estilo calculado da tela.
function valoresAceitos(sistema, caminho, hoje) {
  const origens = [sistema].concat(desviosDoArquivo(sistema, caminho, hoje));
  const permitidos = new Set();
  const fontesPermitidas = new Set();
  for (const f of origens) {
    for (const chave of CHAVES_DE_VALOR) {
      if (chave === 'fontes') fontesDeclaradas(f).forEach(function (v) { familiasDoItem(v).forEach(function (c) { fontesPermitidas.add(c); }); });
      else comoLista(f[chave]).forEach(function (v) { permitidos.add(chaveDoValor(v)); });
    }
  }
  return { permitidos, fontesPermitidas, origens };
}

// E3 item 2 (camada 2): o estilo calculado da tela (captura.resumirEstilo, lido pela capturar-tela.js) contra o
// sistema, pela mesma chave e com os mesmos desvios do texto escrito. O navegador ja resolveu var(), calc() e a
// cascata: o que sobra e o valor que se ve. Cor (texto, fundo, borda) sempre; raio so com "raios" no sistema,
// tamanho de fonte so com "tamanhos", familia so com "fontes" (sem a chave, o sistema nao disse o que vale). A medida
// do sistema em rem vale 16 px (o tamanho padrao); em `em`, tambem 16 px, uma aproximacao (o em real depende do pai);
// o navegador sempre devolve px. A cor que o navegador devolve noutro espaco (oklch, color()) nao se converte: entra
// em `naoLidos`, e nao em `fora`.
function medidaEmPx(v) {
  const m = /^(-?\d+(?:\.\d+)?|-?\.\d+)(px|rem|em)$/.exec(String(v).trim().toLowerCase());
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * (m[2] === 'px' ? 1 : 16) * 100) / 100;
}
function conferirComputado(estilo, sistema, caminho, hoje) {
  const valores = estilo && Array.isArray(estilo.valores) ? estilo.valores : [];
  if (!sistema) return { ok: true, fora: [], naoLidos: 0, conferidos: 0 };
  // As mesmas origens (o sistema e os desvios do arquivo, lidos uma vez so) dos valores aceitos.
  const { permitidos, fontesPermitidas, origens } = valoresAceitos(sistema, caminho, hoje);
  // As medidas aceitas em px por propriedade. A chave so liga a conferencia quando o proprio sistema declara ao menos
  // uma medida que vira px: `raios: ["50%"]` nao compara com o px do navegador e deixa o raio sem conferir.
  const pxDe = function (chave) {
    if (!comoLista(sistema[chave]).some(function (v) { return medidaEmPx(v) !== null; })) return null;
    const s = new Set();
    for (const f of origens) comoLista(f[chave]).forEach(function (v) { const px = medidaEmPx(v); if (px !== null) s.add(px); });
    return s;
  };
  const MEDIDAS = { 'border-radius': pxDe('raios'), 'font-size': pxDe('tamanhos') };
  const comFontes = fontesDeclaradas(sistema).length > 0;
  // O tipo do achado vem por ultimo: um item que ja traga `tipo` nao troca o da conferencia.
  const achado = function (v, tipo) { return Object.assign({}, v, { tipo: tipo }); };
  const fora = [];
  let naoLidos = 0;
  let conferidos = 0;
  for (const v of valores) {
    if (!v || typeof v.valor !== 'string') continue;
    const p = v.propriedade;
    if (p === 'color' || p === 'background-color' || p === 'border-color') {
      const chave = chaveDoValor(v.valor);
      // So a chave convertida (`rgba(r,g,b,a)` de numeros) e cor lida; a de reserva (`rgba(255 0 0/calc(.5))`) nao.
      if (!/^rgba\(\d+,\d+,\d+,[\d.]+\)$/.test(chave)) { naoLidos++; continue; }
      if (/,0\)$/.test(chave)) continue;                 // transparente: nao se ve
      conferidos++;
      if (!permitidos.has(chave)) fora.push(achado(v, 'cor'));
    } else if (Object.hasOwn(MEDIDAS, p) && MEDIDAS[p]) {
      // O canto eliptico (`8px 4px`) e a porcentagem nao se comparam a uma lista de px.
      const px = medidaEmPx(v.valor);
      if (px === null) { naoLidos++; continue; }
      conferidos++;
      if (!MEDIDAS[p].has(px)) fora.push(achado(v, 'medida'));
    } else if (p === 'font-family' && comFontes) {
      // A primeira familia da pilha e a que o navegador tenta: as outras sao reserva.
      const primeira = familiasDoItem(v.valor)[0];
      if (!primeira) { naoLidos++; continue; }
      if (FONTES_GENERICAS.has(primeira)) continue;
      conferidos++;
      if (!fontesPermitidas.has(primeira)) fora.push(achado(v, 'fonte'));
    }
  }
  return { ok: fora.length === 0, fora, naoLidos, conferidos };
}

// `caminho` (opcional, relativo a raiz do projeto): o arquivo escrito; os desvios declarados para ele somam ao sistema.
function conferir(texto, sistema, antes, caminho, hoje) {
  if (!sistema) return { ok: true, fora: [] };
  // A2-03: no Edit, o valor fora que ja estava no `old_string` (contexto, legado) nao e do pedido: desconta, por contagem.
  const jaTinha = new Map();
  if (typeof antes === 'string') {
    for (const a of conferir(antes, sistema, undefined, caminho, hoje).fora) {
      const k = chaveDoDesconto(a);
      jaTinha.set(k, (jaTinha.get(k) || 0) + 1);
    }
  }
  const { permitidos, fontesPermitidas } = valoresAceitos(sistema, caminho, hoje);
  const fora = [];

  // A comparacao e pela chave (a cor convertida); o achado guarda o valor como foi escrito, para o aviso.
  for (const a of valoresCrus(texto)) {
    if (!permitidos.has(chaveDoAchado(a))) fora.push(a);
  }
  // A fonte so e conferida quando o proprio sistema declara "fontes" com ao menos um nome valido: sem a chave, nada
  // muda (o desvio de uma tela soma fontes so a ela, mas nao liga a conferencia num sistema que nao tem fontes).
  if (fontesDeclaradas(sistema).length) {
    for (const a of fontesCruas(texto)) {
      if (!fontesPermitidas.has(a.chave)) fora.push(a);
    }
  }
  // Anti-referencia: dizer o que a coisa NAO pode parecer e verificavel;
  // dizer o que ela deve parecer, nao e.
  const antis = comoLista(sistema.antiReferencias).filter(antiValida);
  String(texto == null ? '' : texto).split(/\r?\n/).forEach(function (linha, i) {
    for (const anti of antis) {
      const alvo = radical(anti);
      if (linha.toLowerCase().indexOf(alvo) !== -1) {
        fora.push({ valor: anti, tipo: 'anti-referencia', linha: i + 1 });
      }
    }
  });

  const novos = fora.filter(function (a) {
    const k = chaveDoDesconto(a);
    const n = jaTinha.get(k) || 0;
    if (n > 0) jaTinha.set(k, n - 1);
    return n === 0;
  });
  return { ok: novos.length === 0, fora: novos };
}

/**
 * E2: o que a lente de tela le na revisao de `caminho`: o sistema do design.json e os desvios declarados para esse
 * arquivo, com o motivo. O valor que nao esta em nenhum dos dois e desvio nao declarado.
 */
function paraARevisao(sistemaLido, caminho, hoje) {
  const sistema = sistemaLido && typeof sistemaLido === 'object' && !Array.isArray(sistemaLido) ? sistemaLido : {};
  // Cada item numa linha so, como o motivo: a quebra de linha do design.json nao abre cabecalho no design.md.
  const lista = function (v) {
    return comoLista(v).filter(textoNaoVazio).map(function (x) { return x.replace(/\s+/g, ' ').trim(); });
  };
  const linha = function (nome, v) { const l = lista(v); return '- ' + nome + ': ' + (l.length ? l.join(', ') : '(nenhum)'); };
  // "tamanhos" e "fontes" so entram quando o sistema os declara. Item vazio ou so de espaco sai da lista em toda
  // chave (antes, `cores: ["", "#fff"]` dava "- cores: , #fff").
  // A linha "fontes" segue a mesma regra da conferencia (fontesDeclaradas): o item so de aspas nao a liga.
  const opcionais = [['tamanhos de fonte', 'tamanhos'], ['fontes', 'fontes']]
    .filter(function (par) { return par[1] === 'fontes' ? fontesDeclaradas(sistema).length > 0 : lista(sistema[par[1]]).length > 0; })
    .map(function (par) { return linha(par[0], par[1] === 'fontes' ? fontesDeclaradas(sistema) : sistema[par[1]]); });
  const partes = ['# Sistema de design deste projeto (.claude/sworn/design.json)', '',
    linha('cores', sistema.cores), linha('raios', sistema.raios), linha('espacos', sistema.espacos),
    linha('sombras', sistema.sombras)].concat(opcionais, [
    linha('anti-referencias (o que a tela nao pode parecer)', sistema.antiReferencias), '',
    '## Desvios declarados para este arquivo (' + (caminho ? caminho : 'arquivo sem caminho: nenhum desvio se aplica') + ')', '']);
  const desvios = desviosDoArquivo(sistema, caminho, hoje);
  if (!desvios.length) partes.push('Nenhum: todo valor cru fora do sistema acima e desvio nao declarado.');
  // As fontes do desvio so contam num sistema que declara fontes (sem elas, a chave nao tem efeito nenhum).
  const comFontes = fontesDeclaradas(sistema).length > 0;
  for (const d of desvios) {
    const valores = CHAVES_DE_VALOR.map(function (c) { return [c, c === 'fontes' ? (comFontes ? lista(fontesDeclaradas(d)) : []) : lista(d[c])]; })
      .filter(function (par) { return par[1].length; })
      .map(function (par) { return par[0] + ' ' + par[1].join(', '); }).join('; ');
    partes.push('- ' + motivoEmUmaLinha(d) + (d.ate ? ' (vale ate ' + d.ate + ')' : '') + ': ' + (valores || 'sem valor a mais'));
  }
  // A fonte entra na regra so quando o sistema declara fontes: sem elas, a frase e a de antes.
  const tipos = fontesDeclaradas(sistema).length ? 'cor, medida, sombra ou fonte' : 'cor, medida, sombra';
  partes.push('', 'Um valor cru (' + tipos + ') que nao esta no sistema nem num desvio acima e desvio nao declarado: ' +
    'reprove, citando o valor e a linha. var(--nome) nunca e valor cru.');
  return partes.join('\n') + '\n';
}

// Plano 082, Tarefa 5 (mock S10): a forma unica dos avisos - o que falta, o arquivo entre aspas, "Faca uma destas".
// O `hoje` e o mesmo do conferir (o portao nao passa: vale o relogio); com ele, o aviso e a conferencia leem o mesmo dia.
function motivo(alvo, fora, sistema, hoje) {
  const linhas = [
    'sworn - valor fora do sistema de design deste projeto.',
    '',
    'Estes valores nao estao no sistema declarado (.claude/sworn/design.json):',
    '  - ' + entreAspas(alvo)
  ];
  for (const f of fora.slice(0, 12)) {
    linhas.push('      linha ' + f.linha + ': ' + f.valor + ' (' + f.tipo + ')');
  }
  if (fora.length > 12) linhas.push('      ... e mais ' + (fora.length - 12));
  linhas.push('');
  linhas.push('O que existe no sistema:');
  // A4-des-3 (pedido 12): texto solto vale como lista de um, como no conferir - o `.join` direto estourava, e o
  // io.blindar do portao-estilo liberava a escrita.
  // Os rotulos com 10 de largura, a de "tamanhos: ": os valores comecam todos na mesma coluna.
  // F5b r1: so a cor que e texto, e o corte em 10 se marca, como nas fontes
  const cores = comoLista(sistema.cores).filter(textoNaoVazio);
  linhas.push('  cores:    ' + cores.slice(0, 10).join(' ') + (cores.length > 10 ? ' ...' : ''));
  linhas.push('  raios:    ' + comoLista(sistema.raios).join(' '));
  linhas.push('  espacos:  ' + comoLista(sistema.espacos).join(' '));
  // As chaves opcionais aparecem so quando o sistema as tem.
  const tamanhos = comoLista(sistema.tamanhos).filter(textoNaoVazio);
  if (tamanhos.length) linhas.push('  tamanhos: ' + tamanhos.join(' '));
  // A fonte separa por virgula: o nome tem espaco ("Open Sans"). Ate 10, como as cores.
  const fontes = fontesDeclaradas(sistema);
  if (fontes.length) linhas.push('  fontes:   ' + fontes.slice(0, 10).map(function (x) { return x.replace(/\s+/g, ' ').trim(); }).join(', ') + (fontes.length > 10 ? ' ...' : ''));
  // E2: o desvio declarado desta tela (ou como declarar um): o valor que a tela precisa e o sistema nao tem.
  // O motivo cabe na linha de 100: ate 70 pontos de codigo (o corte nao parte um par substituto; um emoji composto,
  // com ZWJ, pode partir), e "..." quando corta.
  const desviosDaqui = desviosDoArquivo(sistema, alvo, hoje);
  const pontosDosMotivos = Array.from(desviosDaqui.map(motivoEmUmaLinha).join('; '));
  const cabe = pontosDosMotivos.length <= LARGURA_DOS_MOTIVOS;
  linhas.push('  desvios desta tela: ' + (desviosDaqui.length
    ? (cabe ? pontosDosMotivos.join('') : pontosDosMotivos.slice(0, LARGURA_DOS_MOTIVOS - 3).join('') + '...')
    : 'nenhum (so o dono declara um: "desvios" do design.json, com arquivos e motivo)'));
  // O desvio que o design.json traz para esta tela e o portao ignorou (mal formado ou vencido): o validar diz qual e
  // por que, pelo caminho real dele, como no aviso do projeto.json (portao-escopo.js).
  const ignorados = desviosQueCasam(sistema, alvo).filter(function (d) { return desviosDaqui.indexOf(d) === -1; });
  if (ignorados.length) {
    // Quantos venceram (o desvio bem formado que nao vale) e quantos tem erro de forma: o passo de cada um e outro.
    const comErro = ignorados.filter(function (d) { return problemaDoDesvio(d, sistema); }).length;
    const vencidos = ignorados.length - comErro;
    const porque = [];
    // F5b r1 (microcopy): quem renova e o dono, como diz a ultima linha; o aviso vai ao agente barrado
    if (vencidos) porque.push(vencidos + (vencidos === 1 ? ' venceu (o dono renova o "ate")' : ' venceram (o dono renova o "ate")'));
    if (comErro) porque.push(comErro + ' com erro de forma');
    linhas.push('  ' + ignorados.length + (ignorados.length === 1 ? ' desvio desta tela no design.json nao vale' :
      ' desvios desta tela no design.json nao valem') + ': ' + porque.join(' e ') + '.');
    linhas.push('    Para ver qual e o que fazer, rode o validador do sworn: node "' +
      path.join(__dirname, '..', 'validar.js') + '"');
  }
  // A2-46: o aviso diz tambem as anti-referencias ignoradas; sem valor fora, quem as acusa e o validar (validar.js).
  const ignoradas = antiIgnoradas(sistema);
  if (ignoradas.length) {
    linhas.push('  antiReferencias: ' + itens(ignoradas) + ' sem efeito: o dono corrige ou tira do design.json');
    linhas.push('    (so vale texto nao vazio, como "gradiente"; so espacos, numero ou objeto nao valem)');
  }
  const comAnti = fora.some(function (f) { return f.tipo === 'anti-referencia'; });
  linhas.push('');
  linhas.push('Faca uma destas:');
  // E3: com fonte fora, o passo 1 segue numa frase so, dizendo o que fazer com a familia (var(--nome) nao a resolve).
  // Sem cor nem medida fora (so fonte, ou fonte e anti-referencia, que tem o passo dela abaixo): o passo 1 fala so
  // da familia, sem mandar trocar uma cor que nao foi acusada.
  const comFonte = fora.some(function (f) { return f.tipo === 'fonte'; });
  if (comFonte && fora.every(function (f) { return f.tipo === 'fonte' || f.tipo === 'anti-referencia'; })) {
    linhas.push('  1. troque a fonte por uma das "fontes" do design.json ou por uma generica, como sans-serif;');
  } else if (comFonte) {
    linhas.push('  1. troque cor e medida por um valor declarado no design.json, ou por var(--nome), e troque a');
    linhas.push('     familia de fonte por uma das "fontes" do design.json ou por uma generica, como sans-serif;');
  } else {
    linhas.push('  1. troque cor e medida por um valor declarado no design.json, ou por var(--nome);');
  }
  // A2-45/A2-84: a pergunta ao dono na redacao do intocavel (escopo.js) e da trava 5, com as opcoes deste caso.
  linhas.push('  2. se o valor novo e mesmo necessario, peca ao dono que decida: 3 opcoes, a recomendada');
  linhas.push('     primeiro, cada uma com o que muda e o custo (ex.: acrescentar o valor ao design.json,');
  linhas.push('     usar o valor do sistema mais proximo, tirar o valor);');
  // E2: o desvio desta tela e um passo proprio, e quem o declara e o dono: o aviso nao ensina o agente barrado a se
  // liberar sozinho (a escrita no design.json e decisao do dono, como diz a ultima linha).
  linhas.push('  3. se so esta tela precisa do valor, peca ao dono que declare um desvio dela em "desvios" do');
  linhas.push('     design.json, com arquivos e motivo' + (comAnti ? ';' : '.'));
  if (comAnti) {
    linhas.push('  4. na linha marcada (anti-referencia), tire o termo: o sistema o proibe, sem valor que o troque.');
  }
  linhas.push('');
  // A2-43: o passo primeiro, sem "catraca".
  linhas.push('O caminho certo e tirar o valor cru; mudar o design.json para esta edicao passar e decisao do dono.');
  return linhas.join('\n');
}

module.exports = {
  UNIDADES, EXTENSOES_ESTILO, ehArquivoDeEstilo, valoresCrus, conferir, motivo, validar,
  desviosDoArquivo, problemaDoDesvio, paraARevisao, conferirComputado, medidaEmPx, chaveDoValor
};
