'use strict';
// F3d (D828): as armadilhas do Bash que mais custaram tempo nos handoffs (193 mencoes a heredoc e barra, 19 a "grep -c
// 0 mata a cadeia &&"), barradas antes de rodar, com o conserto. Leitura por linha, heuristica como a do `cd` solto
// (shell.js): nao e um parser de bash. So a ferramenta Bash: o PowerShell tem outras regras de aspas e de saida.
//
// 1. heredoc com o delimitador sem aspas (`<<EOF`) e barra invertida dupla, ou barra no fim de linha, no corpo: o bash
//    come a barra (`\\` vira `\`; a barra no fim junta a linha com a de baixo). Medido de novo em 2026-11-10.
// 2. `grep -c` (ou `git grep -c`) logo antes de `&&`: quando conta 0, sai com 1 e o resto da cadeia nao roda.
// 3. `grep -P` no Windows: o grep do Git Bash sai com 2 ("-P supports only unibyte and UTF-8 locales") sem
//    LC_ALL=C.UTF-8 na frente (medido nesta maquina, grep 3.0). O `git grep -P` nao depende do locale e fica de fora.
// H6h (D904), medidas em 2026-11-23 nesta maquina (Git Bash, GNU sed 4.9, Node 24):
// 4. `sed -i` sem `-b` no Windows: o sed le em modo texto e regrava o arquivo inteiro sem o \r (`a\r\nb\r\n` com
//    s/a/x/ virou `x\nb\n`, a linha que nao mudou tambem); com `-b`, `x\r\nb\r\n`.
// 5. crase dentro das aspas duplas do codigo de `node -e`/`-p`: o bash roda o que esta entre crases antes do
//    node e a saida entra no codigo em silencio ("const x = `echo 41`" deu 41, saida 0). Em qualquer sistema.
// 6. caminho do Git Bash (`/c/proj/...`) numa string do codigo do node no Windows: o Git Bash converte o argumento
//    solto, nao o que esta dentro do codigo, e o node nao o entende (o require deu MODULE_NOT_FOUND).
// 7. `/tmp` numa string do codigo do node no Windows: o node le \tmp na raiz do drive atual (C:\tmp aqui), e nao o
//    /tmp do Git Bash (writeFileSync deu ENOENT; se a pasta existir, grava no lugar errado sem aviso).
const { ascii } = require('./escopo.js');

// a mesma varredura de literais do bash do shell.js (o que abre primeiro manda: aspas, comentario, escapado)
const LITERAIS = /\\[\s\S]|"(?:[^"\\]|\\[\s\S])*"|'[^']*'|(?<=^|[\s;&|(])#[^\n]*/g;

// o `<<` que nao e `<<<` (here-string) nem parte dele; o delimitador com aspas (simples, duplas) ou barra vai literal
const HEREDOC = /(?<!<)<<(?!<)(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|\\([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*))/g;
// o corpo sem aspas no delimitador perde a barra: `\\` vira `\`, e a barra no fim da linha emenda a linha de baixo
const BARRA_COMIDA = /\\\\|\\$/m;
const GREP = new Set(['grep', 'egrep', 'fgrep']);
// opcoes curtas que levam valor: o resto do grupo (ou a palavra seguinte) e o valor, nao outra opcao (`-ec` e o padrao c)
const COM_VALOR = new Set(['e', 'f', 'm', 'A', 'B', 'C', 'd', 'D', 'O']);
const LOCALE_UTF8 = /^(?:LC_ALL|LC_CTYPE|LANG)=\S*utf-?8\S*$/i;
const ATRIBUICAO = /^[A-Za-z_][A-Za-z0-9_]*=/;
// o que vem antes do comando e o deixa ser o mesmo comando (a saida e a dele)
const PREFIXOS = new Set(['!', 'time', 'command', 'sudo']);
// opcoes curtas do sed que levam valor (o resto do grupo, ou a palavra seguinte); o `i` leva o resto como sufixo
const SED_COM_VALOR = new Set(['e', 'f', 'l']);
// as opcoes do node cujo valor vem na palavra seguinte (as `--x=...` do `node --help` do Node 24, todas aceitam a
// forma com espaco, medido; mais as antigas `--loader`), e as que dizem que a palavra seguinte e o codigo
const NODE_COM_VALOR = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '-C', '--conditions',
  '--allow-fs-read', '--allow-fs-write', '--build-snapshot-config', '--cpu-prof-dir', '--cpu-prof-interval',
  '--cpu-prof-name', '--diagnostic-dir', '--disable-proto', '--disable-warning', '--dns-result-order', '--env-file',
  '--env-file-if-exists', '--experimental-config-file', '--experimental-sea-config', '--heap-prof-dir',
  '--heap-prof-interval', '--heap-prof-name', '--heapsnapshot-near-heap-limit', '--heapsnapshot-signal',
  '--icu-data-dir', '--inspect-publish-uid', '--localstorage-file', '--max-http-header-size',
  '--max-old-space-size-percentage', '--network-family-autoselection-attempt-timeout', '--openssl-config',
  '--redirect-warnings', '--report-filename', '--report-signal', '--run', '--secure-heap', '--secure-heap-min',
  '--snapshot-blob', '--test-concurrency', '--test-coverage-branches', '--test-coverage-exclude',
  '--test-coverage-functions', '--test-coverage-include', '--test-coverage-lines', '--test-global-setup',
  '--test-name-pattern', '--test-reporter', '--test-reporter-destination', '--test-rerun-failures', '--test-shard',
  '--test-skip-pattern', '--test-timeout', '--title', '--tls-cipher-list', '--tls-keylog', '--trace-event-categories',
  '--trace-event-file-pattern', '--trace-require-module', '--unhandled-rejections', '--use-largepages',
  '--v8-pool-size', '--watch-kill-signal', '--watch-path', '--input-type']);
const NODE_CODIGO = new Set(['-e', '-p', '-pe', '--eval', '--print']);
// numa string do codigo (depois de uma aspa do JavaScript): o caminho do Git Bash (`/c/Users`) e o `/tmp`
const CAMINHO_DO_BASH = /['"`]\/[A-Za-z]\/[^\s'"`\/\\]/;
const TMP = /['"`]\/tmp(?=[\/'"`\\]|$)/;

/** O `<<` na posicao `i` da linha esta fora de aspas e de comentario? (a varredura da linha ate ele) */
function foraDeAspas(linha, i) {
  let aspa = null;
  for (let k = 0; k < i; k++) {
    const c = linha[k];
    if (aspa === "'") { if (c === "'") aspa = null; continue; }
    if (c === '\\') { k++; continue; }
    if (aspa === '"') { if (c === '"') aspa = null; continue; }
    if (c === "'" || c === '"') aspa = c;
    else if (c === '#' && (k === 0 || /[\s;&|(]/.test(linha[k - 1]))) return false;
  }
  return aspa === null;
}

/** O `<<` na posicao `i` esta dentro de uma conta `(( ))` aberta antes dele na linha (`$((a<<b))` desloca bits)? */
function dentroDeConta(linha, i) {
  const antes = linha.slice(0, i);
  return (antes.match(/\(\(/g) || []).length > (antes.match(/\)\)/g) || []).length;
}

/**
 * Separa o comando em codigo e corpos de heredoc. Devolve { codigo, heredocs: [{ linha, operador, literal, corpo,
 * fechado }] }: `codigo` sao as linhas de fora dos corpos (onde um `grep` roda de fato); o corpo sem terminador vai ate
 * o fim (como no bash), com `fechado` false.
 */
function separar(comando) {
  const linhas = String(comando).split('\n');
  const codigo = [];
  const heredocs = [];
  let i = 0;
  while (i < linhas.length) {
    const linha = linhas[i];
    codigo.push(linha);
    const abertos = [];
    HEREDOC.lastIndex = 0;
    let m;
    while ((m = HEREDOC.exec(linha)) !== null) {
      if (!foraDeAspas(linha, m.index) || dentroDeConta(linha, m.index)) continue;
      const literal = m[5] === undefined;
      const palavra = literal ? (m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4]) : m[5];
      abertos.push({ linha: i + 1, operador: m[0], tira: m[1] === '-', literal: literal, palavra: palavra });
    }
    i++;
    for (const h of abertos) {
      const corpo = [];
      let fechado = false;
      while (i < linhas.length) {
        const l = linhas[i].replace(/\r$/, '');
        i++;
        if ((h.tira ? l.replace(/^\t+/, '') : l) === h.palavra) { fechado = true; break; }
        corpo.push(l);
      }
      heredocs.push({ linha: h.linha, operador: h.operador, literal: h.literal, corpo: corpo.join('\n'), fechado: fechado });
    }
  }
  return { codigo: codigo.join('\n'), heredocs: heredocs };
}

/** As opcoes do grep que importam aqui, lidas das palavras depois do comando: { conta, perl }. */
function opcoesDoGrep(palavras) {
  const o = { conta: false, perl: false };
  for (let k = 0; k < palavras.length; k++) {
    const p = palavras[k];
    if (p === '--') break;
    if (p === '--count') o.conta = true;
    else if (p === '--perl-regexp') o.perl = true;
    else if (/^--(?:regexp|file|max-count|after-context|before-context|context|devices|directories)$/.test(p)) k++;
    else if (/^-[A-Za-z0-9]/.test(p)) {
      for (let j = 1; j < p.length; j++) {
        const c = p[j];
        if (c === 'c') o.conta = true;
        if (c === 'P') o.perl = true;
        if (COM_VALOR.has(c)) { if (j === p.length - 1) k++; break; }
      }
    }
  }
  return o;
}

/** As opcoes do sed que importam aqui: { noLugar, binario }. */
function opcoesDoSed(palavras) {
  const o = { noLugar: false, binario: false };
  for (let k = 0; k < palavras.length; k++) {
    const p = palavras[k];
    if (p === '--') break;
    if (/^--in-place(?:=|$)/.test(p)) o.noLugar = true;
    else if (p === '--binary') o.binario = true;
    else if (/^--(?:expression|file|line-length)$/.test(p)) k++;
    else if (/^-[A-Za-z]/.test(p)) {
      for (let j = 1; j < p.length; j++) {
        const c = p[j];
        if (c === 'i') { o.noLugar = true; break; }
        if (c === 'b') o.binario = true;
        if (SED_COM_VALOR.has(c)) { if (j === p.length - 1) k++; break; }
      }
    }
  }
  return o;
}

/**
 * Os comandos do texto, cada um a lista das suas palavras, e cada palavra a lista das suas partes { aspa, texto }
 * (aspa "'", '"' ou '' para o pedaco solto). Separa por espaco, quebra de linha e ; & | ( ); o comentario vai ate o fim
 * da linha, e a barra com quebra de linha emenda. Heuristica, como o resto: nao e um parser de bash.
 */
function comandosDoBash(texto) {
  const comandos = [];
  let palavras = [];
  let palavra = null;
  const parte = function (aspa, t) {
    if (!palavra) palavra = [];
    const ult = palavra[palavra.length - 1];
    if (aspa === '' && ult && ult.aspa === '') ult.texto += t;
    else palavra.push({ aspa: aspa, texto: t });
  };
  const fechaPalavra = function () { if (palavra) palavras.push(palavra); palavra = null; };
  const fechaComando = function () { fechaPalavra(); if (palavras.length) comandos.push(palavras); palavras = []; };
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === "'") {
      const f = texto.indexOf("'", i + 1);
      const fim = f < 0 ? texto.length : f;
      parte("'", texto.slice(i + 1, fim));
      i = fim;
    } else if (c === '"') {
      let j = i + 1;
      while (j < texto.length && texto[j] !== '"') j += texto[j] === '\\' ? 2 : 1;
      parte('"', texto.slice(i + 1, Math.min(j, texto.length)));
      i = j;
    } else if (c === '\\') {
      // o Git Bash emenda tambem a barra seguida de \r\n (medido em 2026-11-23: "echo um \<CR><LF>dois" deu "um dois")
      if (texto[i + 1] === '\r' && texto[i + 2] === '\n') i++;
      else if (texto[i + 1] !== '\n') parte('', texto.slice(i, i + 2));
      i++;
    } else if (c === '#' && !palavra) {
      const f = texto.indexOf('\n', i);
      i = f < 0 ? texto.length : f - 1;
    } else if (c === '\n' || /[;&|()]/.test(c)) fechaComando();
    else if (/\s/.test(c)) fechaPalavra();
    else parte('', c);
  }
  fechaComando();
  return comandos;
}

const textoDe = function (palavra) { return palavra.map(function (p) { return p.texto; }).join(''); };

/** O codigo do `node -e`/`-p` do comando: { trecho, partes } da palavra do codigo, ou null quando nao ha. */
function codigoDoNode(palavras) {
  const t = palavras.map(textoDe);
  let n = 0;
  while (n < t.length && ATRIBUICAO.test(t[n])) n++;
  while (PREFIXOS.has(t[n])) n++;
  if (!/^node(?:\.exe)?$/i.test(t[n] || '')) return null;
  for (let k = n + 1; k < t.length; k++) {
    if (NODE_CODIGO.has(t[k])) return k + 1 < t.length ? { trecho: t.slice(n, k + 1).join(' '), partes: palavras[k + 1] } : null;
    // a forma colada `--eval=<codigo>`/`--print=<codigo>`: o codigo esta na mesma palavra
    const colada = /^(--eval|--print)=/.exec(t[k]);
    if (colada) return { trecho: t.slice(n, k).concat(colada[1]).join(' '), partes: palavras[k] };
    if (NODE_COM_VALOR.has(t[k])) { k++; continue; }
    // a primeira palavra que nao e opcao e o script: o que vem depois e argumento dele
    if (!/^-/.test(t[k])) return null;
  }
  return null;
}

/**
 * Ha crase que o bash roda dentro das aspas duplas (sem barra antes) nas partes da palavra? A solta (`node -e \`cat f\``)
 * e substituicao de proposito; a das aspas duplas e a crase de template do JavaScript.
 */
function temCrase(partes) {
  for (const p of partes) {
    if (p.aspa !== '"') continue;
    for (let i = 0; i < p.texto.length; i++) {
      if (p.texto[i] === '\\') i++;
      else if (p.texto[i] === '`') return true;
    }
  }
  return false;
}

/**
 * As armadilhas do comando, em ordem: [{ tipo: 'heredoc-barra'|'node-crase'|'node-caminho-bash'|'node-tmp'|'sed-crlf'|
 * 'grep-conta'|'grep-perl', trecho }]. So na ferramenta Bash; `so` e o sistema da plataforma declarada (sem ela, so a
 * crase, o heredoc e o grep -c se conferem). Comando que nao e texto: vazia.
 */
function achar(comando, ferramenta, so) {
  if (ferramenta !== 'Bash' || typeof comando !== 'string' || !comando) return [];
  const { codigo, heredocs } = separar(comando);
  const achados = [];
  for (const h of heredocs) {
    if (!h.literal && h.fechado && BARRA_COMIDA.test(h.corpo)) achados.push({ tipo: 'heredoc-barra', trecho: h.operador });
  }
  for (const palavras of comandosDoBash(codigo)) {
    const node = codigoDoNode(palavras);
    if (!node) continue;
    if (temCrase(node.partes)) achados.push({ tipo: 'node-crase', trecho: node.trecho });
    const js = textoDe(node.partes);
    if (so === 'win32' && CAMINHO_DO_BASH.test(js)) achados.push({ tipo: 'node-caminho-bash', trecho: node.trecho });
    if (so === 'win32' && TMP.test(js)) achados.push({ tipo: 'node-tmp', trecho: node.trecho });
  }
  // o que esta entre aspas, o comentario e o caractere escapado nao sao comando (o padrao do grep, a mensagem do commit).
  // Antes, o valor entre aspas de uma atribuicao perde as aspas (`LC_ALL="C.UTF-8"` segue dizendo o locale). O texto
  // entre aspas vira a palavra `_` (o argumento continua contando: `git -C "$d" grep`, `grep -e "x" -c`); o comentario
  // e o escapado somem. Depois, o `&` de redirecionamento (`2>&1`, `>&2`, `&>arq`) sai: nao separa comandos.
  const limpo = codigo.replace(/=(['"])([^'"\s]*)\1/g, '=$2')
    .replace(LITERAIS, function (m) { return m[0] === '"' || m[0] === "'" ? ' _ ' : ' '; })
    .replace(/\d*[<>]&[\d-]*|&>>?/g, ' ');
  // split com grupo de captura: os indices pares sao os comandos e os impares, os operadores entre eles
  const pedacos = limpo.split(/(\|\||&&|;;|[;&|\n()])/);
  for (let k = 0; k < pedacos.length; k += 2) {
    const palavras = pedacos[k].trim().split(/\s+/).filter(Boolean);
    let n = 0;
    const atribuicoes = [];
    while (n < palavras.length && ATRIBUICAO.test(palavras[n])) atribuicoes.push(palavras[n++]);
    while (PREFIXOS.has(palavras[n])) n++;
    // o `git` com opcao global antes do subcomando (`git -C dir grep`, `git --no-pager grep`)
    let g = n + 1;
    if (palavras[n] === 'git') while (g < palavras.length && /^-/.test(palavras[g])) g += /^-[Cc]$/.test(palavras[g]) ? 2 : 1;
    const git = palavras[n] === 'git' && palavras[g] === 'grep';
    const trecho = palavras.slice(0, Math.min(palavras.length, n + 4)).join(' ');
    if (palavras[n] === 'sed') {
      const s = opcoesDoSed(palavras.slice(n + 1));
      if (s.noLugar && !s.binario && so === 'win32') achados.push({ tipo: 'sed-crlf', trecho: trecho });
      continue;
    }
    if (!git && !GREP.has(palavras[n])) continue;
    const o = opcoesDoGrep(palavras.slice(git ? g + 1 : n + 1));
    // o operador seguinte: pula o `)` de um subshell que fecha logo depois (`( grep -c x f ) && y`) e o texto vazio
    // entre dois operadores (indice par)
    let seg = k + 1;
    while (seg < pedacos.length && (pedacos[seg] === ')' || (seg % 2 === 0 && !pedacos[seg].trim()))) seg++;
    if (o.conta && pedacos[seg] === '&&') achados.push({ tipo: 'grep-conta', trecho: trecho });
    if (o.perl && !git && so === 'win32' && !atribuicoes.some(function (a) { return LOCALE_UTF8.test(a); })) {
      achados.push({ tipo: 'grep-perl', trecho: trecho });
    }
  }
  return achados;
}

const TEXTOS = {
  'heredoc-barra': [
    'heredoc com o delimitador sem aspas e barra invertida no corpo: o bash come a barra (\\\\ vira \\, e a barra no',
    '    fim da linha emenda a linha de baixo).',
    "    Conserto: aspas no delimitador (<<'EOF') e o corpo vai como esta; se ele precisa de $variavel, grave o",
    '    arquivo pelo Write.'
  ],
  'grep-conta': [
    'grep -c antes de &&: quando conta 0, o grep sai com 1 e o que vem depois do && nao roda.',
    '    Conserto: troque o && depois dele por ; (para so testar se casa, use grep -q).'
  ],
  'grep-perl': [
    'grep -P no Git Bash: sem locale UTF-8 ele sai com erro ("-P supports only unibyte and UTF-8 locales").',
    '    Conserto: LC_ALL=C.UTF-8 na frente (LC_ALL=C.UTF-8 grep -P ...), ou grep -E.'
  ],
  'sed-crlf': [
    'sed -i no Git Bash: o sed le em modo texto e regrava o arquivo inteiro sem o \\r (o CRLF vira LF em todas as linhas,',
    '    e o diff pega o arquivo todo).',
    '    Conserto: -b junto do -i (sed -b -i ...) mantem o fim de linha; ou edite pelo Edit.'
  ],
  'node-crase': [
    'crase no codigo do node entre aspas duplas: o bash roda o que esta entre as crases antes do node, e a saida entra no',
    '    codigo em silencio.',
    "    Conserto: aspas simples em volta do codigo (node -e '...'), ou barra antes da crase; codigo longo vai num .js",
    '    gravado pelo Write.'
  ],
  'node-caminho-bash': [
    'caminho do Git Bash (/c/...) dentro do codigo do node: no Windows o node nao o entende (o require da',
    '    MODULE_NOT_FOUND); o Git Bash so converte o argumento solto, nao o que esta dentro do codigo.',
    '    Conserto: escreva o caminho do Windows no codigo (C:/proj/...).'
  ],
  'node-tmp': [
    '/tmp dentro do codigo do node: no Windows o node le \\tmp na raiz do drive atual (C:\\tmp, por exemplo), e nao o',
    '    /tmp do Git Bash: da ENOENT, ou grava no lugar errado sem aviso se essa pasta existir.',
    "    Conserto: require('os').tmpdir() no codigo (a pasta temporaria do Windows, a mesma de %TEMP%)."
  ]
};

/** O aviso da negacao, na forma unica dos avisos (test/forma-aviso.test.js), em ASCII. */
function motivo(comando, achados) {
  const c = [...String(comando == null ? '' : comando)];
  const linhas = [
    'sworn - comando com armadilha do shell: ele faria outra coisa do que parece, e nao rodou.',
    '',
    'Comando: ' + (c.length > 300 ? c.slice(0, 300).join('') + '...(' + c.length + ' caracteres)' : c.join('')),
    ''
  ];
  const vistos = new Set();
  for (const a of achados) {
    if (vistos.has(a.tipo)) continue;
    vistos.add(a.tipo);
    const t = TEXTOS[a.tipo];
    linhas.push('  - "' + a.trecho + '": ' + t[0]);
    for (const resto of t.slice(1)) linhas.push(resto);
  }
  linhas.push('');
  linhas.push('Faca assim: reescreva o comando com o conserto de cada item acima e rode de novo.');
  linhas.push('');
  linhas.push('So o dono libera: ele acrescenta o padrao em "comandosLiberados" de .claude/sworn/projeto.json.');
  return linhas.map(ascii).join('\n');
}

module.exports = { achar, motivo, separar };
