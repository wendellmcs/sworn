'use strict';
// F5b (3): a metade do design.js que le o comando de shell que escreve arquivo de estilo (o portao-estilo.js a
// chama no Bash e no PowerShell). Saiu do design.js, que fica com o sistema de design (valores, desvios, motivo);
// daqui so se usa dele o que diz se o caminho e de estilo.
const glob = require('./glob.js');
const caminhoLib = require('./caminho.js');
const { entreAspas } = require('./texto.js');
const { EXTENSOES_ESTILO, ehArquivoDeEstilo } = require('./design.js');

// ---------------------------------------------------------------------------
// T11-1 (R-T20-09): o arquivo de estilo escrito por COMANDO DE SHELL tambem passa pelo design.
// O `portao-escopo` so ve Write|Edit, e `cat > a.css <<EOF` escapava sem passar por ele. O conteudo que
// um comando escreve nao se le (vem de heredoc, de cano, de outro arquivo), entao o portao nao confere
// valores: nega a ESCRITA de estilo por shell e manda usar Write ou Edit, que ele confere.
//
// E heuristica sobre o texto do comando, nao um interpretador de shell: le palavras, aspas, redirecao,
// heredoc e separadores, e reconhece os escritores comuns pelo nome. Nao ve o que o comando faz por
// dentro (script chamado por arquivo, `xargs`, `find -exec`, outro programa). Caminho em variavel so se
// resolve quando o proprio comando a define antes, no primeiro nivel (D396 n. 2, `alvosDeEstiloNoShell`);
// a que vem de fora, ou e definida dentro de `bash -c`/`eval`, fica sem valor e so conta pela extensao.
// Prefixo com opcao (`sudo -u nome cp`, `env -i cp`) nao se le: a opcao vira o nome do programa.
// ---------------------------------------------------------------------------

const ESPACO = /[ \t\r]/;
// o que termina uma palavra solta: espaco, quebra de linha, separador de comando e operador de redirecao
const FIM_DE_PALAVRA = ' \t\r\n;|&()<>';
// palavras que vem antes do comando de verdade
const PREFIXOS = new Set(['{', '}', '!', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', 'time', 'sudo',
  'command', 'exec', 'nohup', 'builtin', 'nice', 'env']);
// O PowerShell aceita as aspas tipograficas como aspas e os tracos longos como o `-` do parametro.
const ASPAS_PS = [[/[\u2018\u2019\u201A\u201B]/g, "'"], [/[\u201C\u201D\u201E]/g, '"']];
const TRACO_PS = '[-\\u2013\\u2014\\u2015]';
const RE_TRACO_PS_LETRA = new RegExp('^' + TRACO_PS + '[A-Za-z]');
/** Troca 1 por 1 as aspas tipograficas pelas retas: os indices do texto ficam. */
function aspasRetas(s) {
  ASPAS_PS.forEach(function (par) { s = s.replace(par[0], par[1]); });
  return s;
}
// D396 n. 13: comando dentro de comando (bash -c, eval, powershell -Command, bash <<EOF) e lido ate 3
// niveis. Do 4o em diante nao se le e nada se diz: o que esta la dentro segue sem conferencia. E limite
// da heuristica, declarado aqui; nao e aviso ao usuario.
const PROFUNDIDADE_MAXIMA = 3;
// D396 n. 3: ate onde se procura o `)` de um `(Join-Path ...)`; sem teto, texto com muitos `(` seria quadratico.
const JANELA_JOIN_PATH = 2000;

/**
 * Le o comando em comandos simples: { palavras: [{t, q, qi}], redir: [alvos de >], docs: [corpos de heredoc] }.
 * `q` = a palavra tinha aspas; `qi` = onde, no texto `t`, a primeira aspa abriu (-1 sem aspa). Aspas, escape e
 * here-string seguem o idioma (`ps`): a aspa simples do bash nao tem escape e a do PowerShell escapa a si mesma
 * dobrada; a barra escapa no bash e a crase no PowerShell.
 * A2-10 (H1): a lista leva tambem `comentarios`, o texto de cada comentario (`# ...`, sem o \r do fim), onde o
 * commit.js e o push.js leem as marcas; quem copiar a lista (filter, slice) perde esse campo.
 */
function lerShell(comando, ps) {
  let s = String(comando);
  if (ps) s = aspasRetas(s);
  const n = s.length;
  const escapa = ps ? '`' : '\\'; // o escape e a continuacao de linha: a crase no PowerShell, a barra no bash
  const comandos = [];
  const pendentes = []; // heredocs abertos: o corpo vem depois da proxima quebra de linha
  const comentarios = [];
  let atual = { palavras: [], redir: [], docs: [] };
  const fecharComando = function () {
    if (atual.palavras.length || atual.redir.length) comandos.push(atual);
    atual = { palavras: [], redir: [], docs: [] };
  };

  // Le uma palavra a partir de `i`. Devolve { t, q, qi, achou, fim }.
  function palavra(i) {
    let t = '';
    let q = false;
    let qi = -1;
    let achou = false;
    while (i < n && FIM_DE_PALAVRA.indexOf(s[i]) === -1) {
      const c = s[i];
      // F5b r1: a continuacao de linha do bash (barra e quebra, com ou sem \r) nao e palavra nem parte dela; antes
      // ela sozinha virava a palavra vazia, e o vazio passava a ser o nome do programa
      // A2-10 (H1): a do PowerShell e a crase e quebra; antes a crase escapava a quebra para dentro da palavra.
      // No bash ela junta os dois lados numa palavra so; no PowerShell ela e espaco, e fecha a palavra que vinha
      // (`Set-Content`<quebra>a.css` sao duas palavras).
      if (c === escapa && (s[i + 1] === '\n' || (s[i + 1] === '\r' && s[i + 2] === '\n'))) {
        if (ps && achou) break;
        i += s[i + 1] === '\n' ? 2 : 3;
        continue;
      }
      achou = true;
      if ((c === "'" || c === '"') && qi < 0) qi = t.length;
      if (c === "'") {
        q = true;
        i++;
        if (ps) {
          while (i < n) {
            if (s[i] === "'") {
              if (s[i + 1] === "'") { t += "'"; i += 2; continue; }
              i++;
              break;
            }
            t += s[i++];
          }
        } else {
          const j = s.indexOf("'", i);
          t += s.slice(i, j < 0 ? n : j);
          i = j < 0 ? n : j + 1;
        }
      } else if (c === '"') {
        q = true;
        i++;
        while (i < n) {
          const d = s[i];
          if (d === '"') {
            if (ps && s[i + 1] === '"') { t += '"'; i += 2; continue; }
            i++;
            break;
          }
          if (d === escapa && i + 1 < n) {
            const e = s[i + 1];
            if (ps || '"\\$`\n'.indexOf(e) !== -1) { t += e; i += 2; continue; }
          }
          t += d;
          i++;
        }
      } else if (ps && c === '`') {
        if (i + 1 < n) t += s[i + 1];
        i += 2;
      } else if (!ps && c === '\\') {
        if (i + 1 < n && s[i + 1] !== '\n') t += s[i + 1];
        i += 2;
      } else if (ps && c === '@' && (s[i + 1] === "'" || s[i + 1] === '"') && /^[ \t]*\r?\n/.test(s.slice(i + 2, i + 40))) {
        // here-string do PowerShell: o corpo e texto ate a aspa seguida de @ no comeco de uma linha
        const j = s.indexOf('\n' + s[i + 1] + '@', i + 2);
        q = true;
        if (qi < 0) qi = t.length;
        t += j < 0 ? s.slice(i + 2) : s.slice(i + 2, j);
        i = j < 0 ? n : j + 3;
      } else {
        t += c;
        i++;
      }
    }
    return { t: t, q: q, qi: qi, achou: achou, fim: i };
  }

  // depois da quebra de linha: o corpo de cada heredoc aberto, na ordem
  function corpos(i) {
    while (pendentes.length) {
      const h = pendentes.shift();
      const linhas = [];
      while (i < n) {
        let fim = s.indexOf('\n', i);
        if (fim < 0) fim = n;
        const linha = s.slice(i, fim).replace(/\r$/, '');
        i = fim + 1;
        if ((h.tab ? linha.replace(/^\t+/, '') : linha) === h.marca) break;
        linhas.push(linha);
      }
      h.cmd.docs.push(linhas.join('\n'));
    }
    return Math.min(i, n);
  }

  // F5b r2: tambem a continuacao de linha (a do bash e, A2-10, a do PowerShell), para o alvo de `> \` e a marca de `<< \` na linha de baixo
  function pularEspacos(i) {
    for (;;) {
      while (i < n && ESPACO.test(s[i])) i++;
      if (s[i] === escapa && s[i + 1] === '\n') { i += 2; continue; }
      if (s[i] === escapa && s[i + 1] === '\r' && s[i + 2] === '\n') { i += 3; continue; }
      return i;
    }
  }

  let i = 0;
  while (i < n) {
    const c = s[i];
    if (c === '\n') { fecharComando(); i = corpos(i + 1); continue; }
    if (ESPACO.test(c)) { i++; continue; }
    if (c === '#') {
      // comentario: so aparece entre palavras. A2-10 (H1): o texto fica em `comentarios`, onde o commit.js e o push.js
      // leem as marcas (sem-revisao, push-visto); a marca dentro de aspas ou de heredoc nao e comentario.
      const i0 = i;
      while (i < n && s[i] !== '\n') i++;
      comentarios.push(s.slice(i0, i).replace(/\r$/, ''));
      continue;
    }
    if (ps && c === '(' && atual.palavras.length) {
      // D396 n. 3: no PowerShell, `(Join-Path a b)` como argumento e o caminho a/b, nao o fim do comando
      const jp = joinPathEm(s, i);
      if (jp) { atual.palavras.push({ t: jp.t, q: false, qi: -1 }); i = jp.fim; continue; }
    }
    if (c === ';' || c === '(' || c === ')' || c === '|') { fecharComando(); i++; continue; }
    if (c === '&' && s[i + 1] !== '>') { fecharComando(); i++; continue; }

    if (c === '>' || c === '<' || c === '&') {
      // operador de redirecao. `&>` e `&>>` mandam saida e erro para o arquivo.
      let escrita = true;
      let duplica = false;
      if (c === '&') {
        i += 2;
        if (s[i] === '>') i++;
      } else if (c === '>') {
        i++;
        if (s[i] === '>' || s[i] === '|') i++;
        else if (s[i] === '&') { i++; duplica = true; }
      } else {
        escrita = false;
        i++;
        if (s[i] === '<') {
          i++;
          if (s[i] !== '<') {
            // heredoc: <<MARCA, <<'MARCA', <<-MARCA
            const tab = s[i] === '-';
            if (tab) i++;
            const m = palavra(pularEspacos(i));
            i = m.fim;
            if (m.achou) pendentes.push({ marca: m.t, tab: tab, cmd: atual });
            continue;
          }
          i++; // <<< : here-string, a palavra seguinte e texto de entrada
        } else if (s[i] === '(') {
          continue; // <( ): o parentese vira separador
        } else if (s[i] === '&' || s[i] === '>') {
          i++;
        }
      }
      const alvo = palavra(pularEspacos(i));
      i = alvo.fim;
      if (!alvo.achou || !escrita) continue;
      // `>&1`, `>&2`, `>&-` duplicam descritor; `>&arquivo` escreve no arquivo
      if (duplica && !alvo.q && /^(\d+|-)$/.test(alvo.t)) continue;
      atual.redir.push(alvo.t);
      continue;
    }

    const w = palavra(i);
    // so continuacao de linha (ou nada): segue do fim dela, sem palavra; nunca ficar parado
    if (!w.achou) { i = w.fim > i ? w.fim : i + 1; continue; }
    i = w.fim;
    // `2>arquivo`: o numero colado ao operador e o descritor, nao uma palavra
    if ((s[i] === '>' || s[i] === '<') && !w.q && /^\d+$/.test(w.t)) continue;
    atual.palavras.push({ t: w.t, q: w.q, qi: w.qi });
  }
  fecharComando();
  comandos.comentarios = comentarios;
  return comandos;
}

/**
 * D396 n. 3: `(Join-Path a b)` a partir do `(` em `i`, no PowerShell: { t: 'a/b', fim } ou null. As
 * palavras soltas sao as partes (o nome do parametro, -Path ou -ChildPath, sai). O `)` so se procura
 * ate JANELA_JOIN_PATH caracteres; sem ele, null, e o `(` volta a fechar o comando, como antes.
 */
function joinPathEm(s, i) {
  if (!/^\([ \t]*join-path[ \t]/i.test(s.slice(i, i + 40))) return null;
  const limite = Math.min(s.length, i + JANELA_JOIN_PATH);
  let fundo = 0;
  let j = i;
  for (; j < limite; j++) {
    const c = s[j];
    if (c === "'" || c === '"') {
      const k = s.indexOf(c, j + 1);
      if (k < 0 || k >= limite) return null;
      j = k;
    } else if (c === '(') {
      fundo++;
    } else if (c === ')' && --fundo === 0) {
      break;
    }
  }
  if (j >= limite) return null;
  const cmds = lerShell(s.slice(i + 1, j), true);
  if (cmds.length !== 1) return null;
  const partes = cmds[0].palavras.slice(1)
    .filter(function (p) { return p.q || !RE_TRACO_PS_LETRA.test(p.t); })
    .map(function (p) { return p.t; });
  if (!partes.length) return null;
  const t = partes.map(function (p, k) {
    const sem = k < partes.length - 1 ? p.replace(/[\\/]+$/, '') : p;
    return k > 0 ? sem.replace(/^[\\/]+/, '') : sem;
  }).join('/');
  return { t: t, fim: j + 1 };
}

/** Nome do programa sem pasta nem extensao de executavel, em minusculas. */
function nomeDoPrograma(t) {
  return String(t).replace(/^.*[\\/]/, '').replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();
}

// Parametros de cmdlet do PowerShell que levam valor; os demais (-Force, -Append...) sao chaves sem valor.
// D396 n. 4: `inputobject` leva o conteudo (Out-File, Tee-Object); sem ele na lista o valor virava o alvo.
// F5b r1: `type` e o apelido de -ItemType (New-Item -Type File a.css).
const PARAMETROS_PS = ['path', 'literalpath', 'filepath', 'value', 'encoding', 'destination', 'name', 'itemtype',
  'stream', 'width', 'include', 'exclude', 'filter', 'credential', 'delimiter', 'newline', 'inputobject', 'type'];
const RE_PARAMETRO_PS = new RegExp('^' + TRACO_PS + '([A-Za-z][A-Za-z0-9]*)(?::(.*))?$');

/** O PowerShell aceita abreviar o parametro (-Pa, -Dest) quando so um comeca assim. */
function resolverParametroPs(nome) {
  if (PARAMETROS_PS.indexOf(nome) !== -1) return nome;
  if (nome.length < 2) return null;
  const achados = PARAMETROS_PS.filter(function (p) { return p.indexOf(nome) === 0; });
  return achados.length === 1 ? achados[0] : null;
}

/** Argumentos de cmdlet: { nomeados: Map(parametro -> [valores]), pos: [palavras soltas] }. */
function lerArgumentosPs(args) {
  const nomeados = new Map();
  const pos = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    const m = !a.q && RE_PARAMETRO_PS.exec(a.t);
    if (!m) { pos.push(a.t); continue; }
    const nome = resolverParametroPs(m[1].toLowerCase());
    if (!nome) continue;
    const valor = m[2] !== undefined ? m[2] : (k + 1 < args.length ? args[++k].t : null);
    if (valor !== null) nomeados.set(nome, (nomeados.get(nome) || []).concat([valor]));
  }
  return { nomeados: nomeados, pos: pos };
}

/** Argumentos estilo unix: { valores: Map(opcao -> valor), pos: [palavras soltas] }. As opcoes de `comValor` consomem
 *  o valor (colado por = ou a palavra seguinte); as outras opcoes saem sem leitor (A2-42). */
function lerArgumentosUnix(args, comValor) {
  const valores = new Map();
  const pos = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a.q || !/^--?[A-Za-z]/.test(a.t)) { pos.push(a.t); continue; }
    const m = /^(--?[A-Za-z][A-Za-z-]*)=(.*)$/.exec(a.t);
    if (m && comValor.indexOf(m[1]) !== -1) { valores.set(m[1], m[2]); continue; }
    if (comValor.indexOf(a.t) !== -1 && k + 1 < args.length) valores.set(a.t, args[++k].t);
  }
  return { valores: valores, pos: pos };
}

const ESCREVE_CMDLET = new Set(['set-content', 'sc', 'add-content', 'ac', 'out-file', 'tee-object', 'new-item', 'ni']);
const COPIA_OU_MOVE = new Set(['cp', 'mv', 'install', 'copy', 'move', 'copy-item', 'move-item', 'cpi', 'mi']);
const SO_CMDLET = new Set(['copy', 'move', 'copy-item', 'move-item', 'cpi', 'mi']);
const INTERPRETADOR_DE_SHELL = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const INTERPRETADOR_PS = new Set(['pwsh', 'powershell']);
// chamadas do node que escrevem: o alvo e o 1o argumento, ou o 2o (copiar e renomear)
const NODE_ESCREVE_1 = new Set(['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream']);
const NODE_ESCREVE_2 = new Set(['copyFile', 'copyFileSync', 'cp', 'cpSync', 'rename', 'renameSync']);

/** Fichas de um script do node: literais de texto, identificadores e pontuacao. */
function fichasDoScript(script) {
  const fichas = [];
  const re = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1|([A-Za-z_$][\w$]*)|(\S)/g;
  let m;
  while ((m = re.exec(script)) !== null) {
    if (m[1] !== undefined) fichas.push({ lit: m[2] });
    else if (m[3] !== undefined) fichas.push({ id: m[3] });
    else fichas.push({ p: m[4] });
  }
  return fichas;
}

/** Caminhos que um script do node (-e ou heredoc) manda escrever, quando o alvo esta escrito na chamada. */
function alvosDeScriptNode(script) {
  const f = fichasDoScript(script);
  const variaveis = new Map();
  const alvos = [];
  const valorDe = function (x) {
    if (!x) return null;
    if (x.lit !== undefined) return x.lit;
    return x.id !== undefined && variaveis.has(x.id) ? variaveis.get(x.id) : null;
  };
  for (let k = 0; k < f.length; k++) {
    // const nome = 'texto'
    if (f[k].id && /^(?:const|let|var)$/.test(f[k].id) && f[k + 1] && f[k + 1].id && f[k + 2] && f[k + 2].p === '=' &&
        f[k + 3] && f[k + 3].lit !== undefined) variaveis.set(f[k + 1].id, f[k + 3].lit);
    if (!f[k].id || !f[k + 1] || f[k + 1].p !== '(') continue;
    if (NODE_ESCREVE_1.has(f[k].id)) {
      const v = valorDe(f[k + 2]);
      if (v !== null) alvos.push(v);
    } else if (NODE_ESCREVE_2.has(f[k].id) && f[k + 3] && f[k + 3].p === ',') {
      const v = valorDe(f[k + 4]);
      if (v !== null) alvos.push(v);
    }
  }
  return alvos;
}

// [System.IO.File]::WriteAllText('a.css', ...) e AppendAllText: o 1o argumento e o arquivo
const PS_ARQUIVO_NET = /\[(?:System\.)?IO\.File\]::(?:Write|Append)\w*\(\s*(['"])(.+?)\1/gi;

function alvosDoArquivoNet(texto) {
  const alvos = [];
  const limpo = aspasRetas(String(texto)).replace(/@(['"])[ \t]*\r?\n[\s\S]*?\r?\n\1@/g, ' '); // o corpo de here-string e texto
  PS_ARQUIVO_NET.lastIndex = 0;
  let m;
  while ((m = PS_ARQUIVO_NET.exec(limpo)) !== null) alvos.push(m[2]);
  return alvos;
}

function destinoEmPasta(destino, origens) {
  return origens.map(function (o) { return destino.replace(/[\\/]+$/, '') + '/' + o.replace(/^.*[\\/]/, ''); });
}

/**
 * D396 n. 6: destino de copia que e pasta - barra no fim, `.`/`..`, ou ultimo nome sem extensao (`cp a.css
 * src`). `~` e variavel ficam como estavam (a pasta deles nao se sabe). Nome de arquivo sem extensao
 * (`cp a.css Makefile`) vira pasta: e o limite da heuristica.
 */
function ehPasta(destino) {
  if (/[\\/]$/.test(destino)) return true;
  if (destino.indexOf('$') !== -1 || /^~/.test(destino)) return false;
  const ultimo = destino.replace(/^.*[\\/]/, '');
  return ultimo === '.' || ultimo === '..' || ultimo.indexOf('.') === -1;
}

/**
 * Percorre os comandos do texto, na ordem: `aoAlvo(p)` para cada caminho que um deles escreve e `depois(cmd)` ao fim
 * de cada um. O laco e um so para o primeiro nivel (com variaveis) e para os de dentro (`bash -c`, `eval`).
 */
function percorrerEscritos(texto, ps, profundidade, aoAlvo, depois) {
  lerShell(texto, ps).forEach(function (cmd) {
    escritosPorComando(cmd, ps, profundidade).forEach(function (p) { aoAlvo(p); });
    if (depois) depois(cmd);
  });
  if (ps) alvosDoArquivoNet(texto).forEach(function (p) { aoAlvo(p); });
}

/** Os caminhos (como escritos no comando) que um texto de comando manda escrever. */
function escritosPorTexto(texto, ps, profundidade) {
  const alvos = [];
  percorrerEscritos(texto, ps, profundidade, function (p) { alvos.push(p); });
  return alvos;
}

/** `NOME=valor` do bash: o nome sem aspa; a aspa pode vir so no valor (`LC_ALL='C'`). `'FOO=1'` e programa. */
function ehAtribuicao(w) {
  const m = /^[A-Za-z_][A-Za-z0-9_]*=/.exec(w.t);
  return m !== null && (!w.q || w.qi >= m[0].length);
}

/** `-EncodedCommand` do pwsh/powershell e os apelidos dele (-e, -ec, -enc...): o roteiro vem em base64. */
function ehEncodedCommand(t) {
  const x = String(t).toLowerCase();
  return x === '-e' || x === '-ec' || (x.length >= 4 && '-encodedcommand'.indexOf(x) === 0);
}

/** O roteiro de um -EncodedCommand: base64 do texto em UTF-16LE (o Buffer pula o que nao e base64: nunca lanca). */
function roteiroCodificado(b64) { return Buffer.from(String(b64), 'base64').toString('utf16le'); }

/** O programa de um comando simples, depois dos prefixos (`sudo`, `then`...) e das atribuicoes: { nome, args } ou null. */
function programa(cmd) {
  let k = 0;
  while (k < cmd.palavras.length && (PREFIXOS.has(cmd.palavras[k].t) || ehAtribuicao(cmd.palavras[k]))) k++;
  if (k >= cmd.palavras.length) return null;
  return { nome: nomeDoPrograma(cmd.palavras[k].t), args: cmd.palavras.slice(k + 1) };
}

/**
 * O comando que um programa roda escrito em texto (bash -c, eval, cmd /c, powershell -Command ou -EncodedCommand):
 * { texto, ps } (o idioma de dentro), ou null quando o programa nao roda outro comando.
 */
function internoDe(nome, args, cmd, ps) {
  const textos = args.map(function (a) { return a.t; });
  if (INTERPRETADOR_DE_SHELL.has(nome)) {
    const ic = args.findIndex(function (a) { return !a.q && /^-[A-Za-z]*c$/.test(a.t); });
    if (ic !== -1 && ic + 1 < args.length) return { texto: args[ic + 1].t, ps: false };
    // D396 n. 7: sem -c e sem arquivo de roteiro, o roteiro e o heredoc (`bash <<EOF`, `sh -s <<EOF`)
    if (ic === -1 && cmd.docs.length && !args.some(function (a) { return a.q || !/^-/.test(a.t); })) {
      return { texto: cmd.docs.join('\n'), ps: false };
    }
  } else if (nome === 'eval') {
    return { texto: textos.join(' '), ps: ps };
  } else if (nome === 'cmd') {
    // cmd /c "echo x > a.css": a barra invertida do Windows e caminho, como no PowerShell.
    // atalho: le o de dentro com TODAS as regras do PowerShell (crase escapa, aspa simples, here-string, Join-Path),
    // nao so a da barra. limite: o cmd.exe nao tem nenhuma delas, e `echo a`> x.css` (crase literal no cmd) nao se
    // le. trocar quando: o cmd tiver leitor proprio.
    const ic = args.findIndex(function (a) { return !a.q && /^\/[ck]$/i.test(a.t); });
    if (ic !== -1) return { texto: textos.slice(ic + 1).join(' '), ps: true };
  } else if (INTERPRETADOR_PS.has(nome)) {
    const ic = args.findIndex(function (a) { return !a.q && /^-c(?:o|om|omm|omma|omman|ommand)?$/i.test(a.t); });
    const ie = args.findIndex(function (a) { return !a.q && ehEncodedCommand(a.t); });
    if (ic !== -1 && ic + 1 < args.length) return { texto: textos.slice(ic + 1).join(' '), ps: true };
    // F5b r1 (seguranca): o roteiro em base64 escapava sem ser lido
    if (ie !== -1 && ie + 1 < args.length) return { texto: roteiroCodificado(args[ie + 1].t), ps: true };
  }
  return null;
}

/**
 * A2-10 (H1): os comandos simples do texto, na ordem, com os de dentro (bash -c, eval, cmd /c, powershell -Command)
 * logo depois de quem os roda, ate PROFUNDIDADE_MAXIMA niveis. Cada um: { palavras, redir, docs, ps, profundidade }.
 * A lista leva `comentarios`, os do primeiro nivel (os de dentro sao texto de outro comando, como a aspa).
 */
function comandosSimples(texto, ps, profundidade) {
  const p = profundidade || 0;
  const lidos = lerShell(texto, ps);
  const saida = [];
  lidos.forEach(function (cmd) {
    saida.push({ palavras: cmd.palavras, redir: cmd.redir, docs: cmd.docs, ps: ps, profundidade: p });
    const prog = p < PROFUNDIDADE_MAXIMA ? programa(cmd) : null;
    const de = prog && internoDe(prog.nome, prog.args, cmd, ps);
    if (de) comandosSimples(de.texto, de.ps, p + 1).forEach(function (c) { saida.push(c); });
  });
  saida.comentarios = lidos.comentarios;
  return saida;
}

/** Os caminhos que UM comando simples escreve. */
function escritosPorComando(cmd, ps, profundidade) {
  const alvos = cmd.redir.slice();
  const prog = programa(cmd);
  if (!prog) return alvos;
  const nome = prog.nome;
  const args = prog.args;
  const textos = args.map(function (a) { return a.t; });

  if (nome === 'tee') {
    lerArgumentosUnix(args, []).pos.forEach(function (p) { alvos.push(p); });
  } else if (nome === 'sed' || nome === 'gsed' || nome === 'perl') {
    // -i, -i.bak, -ni, -pi, --in-place: edita o arquivo no lugar. Num sed qualquer opcao com `i` e a -i
    // (o resto do grupo e o sufixo da copia); no perl o `i` tem de fechar o grupo ou vir antes de um ponto,
    // senao `-Mstrict` contaria. O roteiro nao e arquivo: e a palavra depois de -e/-f, ou a primeira solta.
    const re = nome === 'perl' ? /^-[A-Za-z]*i(?:[^A-Za-z].*)?$/ : /^-[A-Za-z]*i/;
    const emLugar = args.some(function (a) { return !a.q && (/^--in-place(=.*)?$/.test(a.t) || re.test(a.t)); });
    if (emLugar) {
      const arquivos = [];
      let temRoteiro = false;
      for (let j = 0; j < args.length; j++) {
        const a = args[j];
        if (a.q || !/^-/.test(a.t)) { arquivos.push(a.t); continue; }
        if (/^--(expression|file)$/.test(a.t) || (/^-[A-Za-z]*[ef]$/.test(a.t) && !/^--/.test(a.t))) { temRoteiro = true; j++; }
        else if (/^--(expression|file)=/.test(a.t)) temRoteiro = true;
      }
      (temRoteiro ? arquivos : arquivos.slice(1)).forEach(function (p) { alvos.push(p); });
    }
  } else if (COPIA_OU_MOVE.has(nome)) {
    if (ps || SO_CMDLET.has(nome)) {
      const a = lerArgumentosPs(args);
      const fontes = (a.nomeados.get('path') || []).concat(a.nomeados.get('literalpath') || []);
      let destino = null;
      if (a.nomeados.has('destination')) destino = a.nomeados.get('destination')[0];
      else if (fontes.length) destino = a.pos.length ? a.pos[0] : null;
      else if (a.pos.length >= 2) destino = a.pos[a.pos.length - 1];
      if (destino !== null) {
        if (ehPasta(destino)) {
          destinoEmPasta(destino, fontes.concat(a.pos.filter(function (p) { return p !== destino; }))).forEach(function (p) { alvos.push(p); });
        } else {
          alvos.push(destino);
        }
      }
    } else {
      const a = lerArgumentosUnix(args, ['-t', '--target-directory', '-S', '--suffix', '-m', '--mode', '-o', '-g']);
      const pasta = a.valores.get('-t') || a.valores.get('--target-directory');
      if (pasta) {
        destinoEmPasta(pasta, a.pos).forEach(function (p) { alvos.push(p); });
      } else if (a.pos.length >= 2) {
        const destino = a.pos[a.pos.length - 1];
        if (ehPasta(destino)) destinoEmPasta(destino, a.pos.slice(0, -1)).forEach(function (p) { alvos.push(p); });
        else alvos.push(destino);
      }
    }
  } else if (ESCREVE_CMDLET.has(nome)) {
    const a = lerArgumentosPs(args);
    const caminhos = [].concat(a.nomeados.get('path') || [], a.nomeados.get('literalpath') || [], a.nomeados.get('filepath') || []);
    const base = caminhos.length ? caminhos : a.pos.slice(0, 1);
    const nomes = a.nomeados.get('name') || [];
    // D396 n. 5: New-Item -Path pasta -Name arquivo escreve pasta/arquivo, nao os dois soltos
    if (nomes.length && base.length) {
      base.forEach(function (b) { nomes.forEach(function (nm) { alvos.push(b.replace(/[\\/]+$/, '') + '/' + nm); }); });
    } else {
      nomes.concat(base).forEach(function (p) { alvos.push(p); });
    }
  } else if (nome === 'dd') {
    textos.forEach(function (t) { if (/^of=/.test(t)) alvos.push(t.slice(3)); });
  } else if (nome === 'node' || nome === 'nodejs') {
    const iEval = args.findIndex(function (a) { return !a.q && /^(-e|--eval|-p|--print|-pe)$/.test(a.t); });
    let scripts = [];
    if (iEval === -1) scripts = cmd.docs; // o roteiro vem por heredoc
    else if (iEval + 1 < args.length) scripts = [args[iEval + 1].t];
    scripts.forEach(function (sc) { alvosDeScriptNode(sc).forEach(function (p) { alvos.push(p); }); });
  } else if (profundidade < PROFUNDIDADE_MAXIMA) {
    // programa que roda outro comando escrito em texto: bash -c, eval, powershell -Command
    const de = internoDe(nome, args, cmd, ps);
    if (de) escritosPorTexto(de.texto, de.ps, profundidade + 1).forEach(function (p) { alvos.push(p); });
  }
  return alvos;
}

/**
 * O caminho que o Git Bash do Windows escreve (/c/pasta/arquivo) volta a ser o do disco. So quando o
 * projeto esta num disco do Windows (cwd como `C:\...`): quem decide e o cwd, nao o sistema que roda.
 */
function caminhoDoShell(p, cwd) {
  const m = /^[A-Za-z]:[\\/]/.test(String(cwd)) ? /^\/([A-Za-z])(?:\/(.*))?$/.exec(p) : null;
  return m ? m[1].toUpperCase() + ':/' + (m[2] || '') : p;
}

/**
 * D396 n. 2: guarda em `variaveis` o que um comando de atribuicao define: `NOME=valor` (so atribuicoes,
 * com ou sem `export`) no bash; `$nome = valor` ou `$env:NOME = valor` no PowerShell (nome sem caixa).
 */
function lerAtribuicao(cmd, ps, variaveis) {
  const w = cmd.palavras;
  let m;
  if (ps) {
    const RE = /^\$([A-Za-z_]\w*(?::[A-Za-z_]\w*)?)$/;
    if (w.length === 3 && !w[0].q && w[1].t === '=' && !w[1].q && (m = RE.exec(w[0].t))) variaveis.set(m[1].toLowerCase(), w[2].t);
    // `$out='a.css'` numa palavra: a aspa so no valor (depois do `=`) ainda e atribuicao
    else if (w.length === 1 && (m = /^\$([A-Za-z_]\w*(?::[A-Za-z_]\w*)?)=([\s\S]*)$/.exec(w[0].t)) &&
      (!w[0].q || w[0].qi > w[0].t.indexOf('='))) variaveis.set(m[1].toLowerCase(), m[2]);
    return;
  }
  const lista = w.length > 1 && w[0].t === 'export' && !w[0].q ? w.slice(1) : w;
  const pares = lista.map(function (p) { return ehAtribuicao(p) ? /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(p.t) : null; });
  if (lista.length && pares.every(Boolean)) pares.forEach(function (x) { variaveis.set(x[1], x[2]); });
}

/** Troca `$NOME`, `${NOME}` (e `$env:NOME` no PowerShell) pelo valor conhecido; a desconhecida fica. */
function trocarVariaveis(p, variaveis, ps) {
  if (!p || !variaveis.size || p.indexOf('$') === -1) return p;
  const re = ps ? /\$\{([A-Za-z_]\w*(?::[A-Za-z_]\w*)?)\}|\$([A-Za-z_]\w*(?::[A-Za-z_]\w*)?)/g
    : /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;
  return p.replace(re, function (todo, a, b) {
    const nome = ps ? (a || b).toLowerCase() : (a || b);
    return variaveis.has(nome) ? variaveis.get(nome) : todo;
  });
}

/**
 * Os arquivos de estilo que o `comando` de shell escreve, como caminhos relativos ao projeto, sem repetir.
 * `opcoes.ferramenta` ('PowerShell' escolhe o idioma de aspas e de escape) e `opcoes.cwd` (a raiz do
 * projeto: caminho fora dela nao conta, como no portao do Write/Edit). Lista vazia = nada a conferir.
 */
function alvosDeEstiloNoShell(comando, projeto, opcoes) {
  if (typeof comando !== 'string' || comando === '') return [];
  const o = opcoes || {};
  const ps = o.ferramenta === 'PowerShell';
  // D396 n. 2: a variavel que o proprio comando define antes (`OUT=x;`, `$out = 'x'`) vira o valor dela,
  // e o caminho passa pela conferencia normal (fora do projeto nao conta). Na ordem dos comandos.
  const variaveis = new Map();
  const brutos = [];
  percorrerEscritos(comando, ps, 0, function (p) { brutos.push(trocarVariaveis(p, variaveis, ps)); },
    function (cmd) { lerAtribuicao(cmd, ps, variaveis); });
  const saida = [];
  brutos.forEach(function (p) {
    if (!p) return;
    if (p.indexOf('$') !== -1) {
      // caminho com variavel: a pasta nao se sabe, mas a extensao no fim do nome sim
      const baixo = p.toLowerCase();
      if (EXTENSOES_ESTILO.some(function (e) { return baixo.endsWith(e); }) && saida.indexOf(p) === -1) saida.push(p);
      return;
    }
    let rel;
    if (o.cwd) {
      rel = caminhoLib.relativoAoProjeto(caminhoDoShell(p, o.cwd), o.cwd);
      if (!rel) return; // fora do projeto, ou o proprio projeto
    } else {
      rel = glob.normalizar(p);
    }
    if (ehArquivoDeEstilo(rel, projeto) && saida.indexOf(rel) === -1) saida.push(rel);
  });
  return saida;
}

/** Mensagem de remedio: o que o sworn confere e onde, e o que fazer. Nao ensina desvio. */
function motivoShell(alvos) {
  // Plano 082, Tarefa 5 (mock S10): a forma unica dos avisos.
  const linhas = [
    'sworn - arquivo de estilo escrito por comando de shell fica sem a conferencia do design.',
    '',
    'Arquivo' + (alvos.length > 1 ? 's' : '') + ':'
  ];
  for (const a of alvos.slice(0, 12)) linhas.push('  - ' + entreAspas(a));
  if (alvos.length > 12) linhas.push('  - ... e mais ' + (alvos.length - 12));
  // D396 n. 14: o porque da negacao, sem ensinar desvio
  linhas.push('');
  linhas.push('Por que: o sworn nao le o conteudo que um comando de shell vai gravar, entao nao confere o estilo');
  linhas.push('com os valores do design.json antes de rodar. Com a ferramenta Write ou Edit, ele confere.');
  linhas.push('');
  linhas.push('Faca uma destas:');
  linhas.push('  1. escreva ' + (alvos.length > 1 ? 'estes arquivos' : 'este arquivo') + ' com a ferramenta Write ou Edit;');
  // A2-44: o passo do agente na lista; onde registrar, numa linha propria, para o usuario.
  linhas.push('  2. se o comando nao grava estilo, e leitura errada do sworn: conte ao usuario na resposta final.');
  linhas.push('');
  linhas.push('Ao usuario: a leitura errada do sworn se registra em https://github.com/wendellmcs/sworn/issues,');
  linhas.push('com o comando barrado (tire dele antes senha, token e caminho interno: o registro e publico).');
  return linhas.join('\n');
}

// A2-20 (H1): o leitor de shell e um so; o commit.js e o push.js leem o git por ele.
module.exports = { alvosDeEstiloNoShell, motivoShell, lerShell, comandosSimples, programa, nomeDoPrograma };
