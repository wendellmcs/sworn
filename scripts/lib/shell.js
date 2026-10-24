'use strict';
const fs = require('node:fs');
const path = require('node:path');
const texto = require('./texto.js');
// A1-08: o comando e o achado vem do dono e podem ter acento; o aviso sai em ASCII (R5) como o do destrutivo.js.
const { ascii } = require('./escopo.js');

// 0.3.5/D294: a tabela que nao se le NAO some calada. A causa fica guardada e o portao a mostra
// (`problemasDaTabela` + `avisoTabela`): o comando passa, e sai aviso. Nada se nega por arquivo
// estragado. O nome do arquivo ja diz o SO: a tabela so vale no win32, mesmo quando nao se leu.
const ARQUIVO_TABELA = 'modelos/shell-win32.json';
const SO_DA_TABELA = 'win32';

function causaDoErro(e) {
  const causa = (e && e.code) ? String(e.code) : (e && e.name ? e.name + ': ' + e.message : String(e));
  return causa.replace(/\s+/g, ' ').slice(0, 200);
}

const CARGA = (function () {
  const vazia = { quando: {}, regras: [], regrasPowerShell51: [] };
  const quebrou = (causa) => ({ tabela: vazia, problema: { tipo: 'arquivo', onde: ARQUIVO_TABELA, causa } });
  let bruta;
  try {
    bruta = JSON.parse(texto.semBom(fs.readFileSync(path.join(__dirname, '..', '..', ARQUIVO_TABELA), 'utf8')));
  } catch (e) {
    return quebrou(causaDoErro(e));
  }
  if (!bruta || typeof bruta !== 'object' || Array.isArray(bruta)) return quebrou('o conteudo nao e um objeto de tabela');
  // `regras` ou `regrasPowerShell51` que nao e lista = tabela ilegivel, como o arquivo todo
  const naoLista = ['regras', 'regrasPowerShell51'].filter((k) => bruta[k] !== undefined && !Array.isArray(bruta[k]));
  if (naoLista.length) return quebrou(naoLista.join(' e ') + ' nao e uma lista');
  return {
    tabela: {
      quando: (bruta.quando && typeof bruta.quando === 'object') ? bruta.quando : {},
      regras: bruta.regras || [],
      regrasPowerShell51: bruta.regrasPowerShell51 || []
    },
    problema: null
  };
})();
const TABELA = CARGA.tabela;

/**
 * Tira o que esta entre aspas: /tmp dentro de string literal nao e comando.
 * D244/achado 13: o corpo de here-string do PowerShell (`@'` ou `@"` no fim da linha, fechado
 * por `'@`/`"@` no comeco de outra) tambem e texto - sai ANTES das aspas, porque o corpo costuma
 * ter aspas desbalanceadas.
 * 0.3.4/item 2: com `idioma` ('bash' ou 'powershell') as aspas seguem o idioma e a que abre
 * primeiro manda: aspa simples nao tem escape nos dois, e a dupla escapa com barra no bash e com
 * crase no PowerShell. Sem `idioma` (o `conferir`) fica como era.
 * T4 r2: o comentario entra na mesma varredura, porque o que vem primeiro manda: o apostrofo de
 * `# it's` nao abre literal, e o `<#` dentro de uma string nao abre comentario de bloco.
 */
const LITERAIS = {
  bash: /\\[\s\S]|"(?:[^"\\]|\\[\s\S])*"|'[^']*'|(?<=^|[\s;&|(])#[^\n]*/g,
  powershell: /<#[\s\S]*?#>|`[\s\S]|"(?:[^"`]|`[\s\S])*"|'[^']*'|(?<=^|[\s;&|(])#[^\n]*/g
};

function semLiterais(comando, idioma) {
  const base = String(comando == null ? '' : comando)
    .replace(/@'[ \t]*\r?\n[\s\S]*?\r?\n'@/g, ' ')
    .replace(/@"[ \t]*\r?\n[\s\S]*?\r?\n"@/g, ' ');
  if (LITERAIS[idioma]) return base.replace(LITERAIS[idioma], ' ');
  return base
    .replace(/"(?:[^"\\]|\\.)*"/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, ' ');
}

/**
 * 0.3.5/D294: a regra que nao se compila nao vira `null` calado - devolve a causa junto.
 * Padrao que nao e texto (`new RegExp(undefined)` casa TUDO) tambem e regra que nao se le.
 */
function lerRegra(regra) {
  if (!regra || typeof regra.padrao !== 'string') return { re: null, causa: 'o padrao nao e um texto' };
  if (!regra.padrao.trim()) return { re: null, causa: 'o padrao esta vazio (casaria tudo)' };
  try { return { re: new RegExp(regra.padrao), causa: null }; } catch (e) { return { re: null, causa: causaDoErro(e) }; }
}

function compilar(regra) {
  return lerRegra(regra).re;
}

/** As regras que valem para esta plataforma: a do PowerShell 5.1 so com o shell powershell. */
function regrasAplicaveis(p) {
  return TABELA.regras.concat(p.shell === 'powershell' ? TABELA.regrasPowerShell51 : []);
}

/**
 * F16: a tabela e carregada pela plataforma declarada em projeto.json,
 * nao inferida a cada comando.
 * D244/defeito 4: e pela FERRAMENTA (`tool_name` do hook). No Windows a ferramenta Bash do
 * harness e Git Bash, onde `&&`, `head` e `/tmp` existem: a tabela, que descreve o PowerShell,
 * nao vale para ela. Sem ferramenta (chamada antiga), vale a plataforma, como antes.
 */
function conferir(comando, plataforma, ferramenta) {
  const p = plataforma || {};
  if (p.so !== SO_DA_TABELA) return []; // a mesma porta do `problemasDaTabela`
  if (ferramenta === 'Bash') return [];

  // 0.3.5/D294: o `conferir` so roda fora da ferramenta Bash, ou seja, no PowerShell - as aspas
  // seguem o idioma dele (a barra nao escapa na simples; a dupla escapa com crase).
  const limpo = semLiterais(comando, 'powershell');
  const problemas = [];

  for (const regra of regrasAplicaveis(p)) {
    const re = compilar(regra);
    if (re && re.test(limpo)) {
      problemas.push({ achado: regra.achado, sugestao: regra.sugestao, motivo: regra.motivo });
    }
  }
  return problemas;
}

/**
 * 0.3.5/D294: o que na tabela do PowerShell nao se le, para o portao AVISAR (nunca negar).
 * So onde a tabela valeria: plataforma win32 e ferramenta que nao e a Bash (a mesma porta do
 * `conferir`). Cada problema e `{ tipo: 'arquivo'|'regra', onde, achado?, causa }`; a regra
 * invalida so entra se estiver no conjunto aplicavel (a do PowerShell 5.1 so com shell powershell).
 */
function problemasDaTabela(plataforma, ferramenta) {
  const p = plataforma || {};
  if (p.so !== SO_DA_TABELA || ferramenta === 'Bash') return [];
  const lista = CARGA.problema ? [CARGA.problema] : [];
  const confere = (regras, dono) => regras.forEach((regra, i) => {
    const { causa } = lerRegra(regra);
    if (causa) lista.push({ tipo: 'regra', onde: dono + '[' + i + ']', achado: String((regra && regra.achado) || '(sem achado)'), causa });
  });
  confere(TABELA.regras, 'regras');
  if (p.shell === 'powershell') confere(TABELA.regrasPowerShell51, 'regrasPowerShell51');
  return lista;
}

// Os avisos deste arquivo seguem a forma unica dos avisos de gancho, conferida em test/forma-aviso.test.js: a 1a linha
// "sworn - <o que houve>." e uma linha em branco; o corpo; uma linha em branco e "Faca uma destas:" numerado (ou
// "Faca assim:", quando ha um caminho so); a liberacao, que e do dono, por ultimo. Em ASCII (R5).

function motivo(comando, problemas, tentativa) {
  const c = String(comando);
  const linhas = [
    'sworn - comando escrito no idioma de shell errado para esta plataforma.',
    '',
    'Comando: ' + (c.length > 120 ? c.slice(0, 120) + '...(' + c.length + ' caracteres)' : c),
    '',
    'Achado                 Use no lugar'
  ];
  for (const p of problemas) {
    linhas.push('  ' + String(p.achado || '(sem achado)').padEnd(20) + ' ' + (p.sugestao || '(sem sugestao)'));
    if (p.motivo) linhas.push('      por que: ' + p.motivo);
  }
  linhas.push('');
  if (tentativa >= 2) {
    // O agravante da F16: o reflexo e tentar outra variacao do MESMO idioma.
    linhas.push('Esta e a tentativa ' + tentativa + ' com sintaxe da plataforma errada. Troque de idioma, nao de variacao.');
  } else {
    linhas.push('A plataforma deste projeto esta no campo "plataforma" de .claude/sworn/projeto.json:');
    linhas.push('leia de la, nao infira a cada comando.');
  }
  linhas.push('');
  linhas.push('Faca uma destas:');
  linhas.push(tentativa >= 2
    ? '  1. escreva o comando em PowerShell, sem outra forma de bash;'
    : '  1. reescreva o comando com o que esta em "Use no lugar";');
  linhas.push('  2. ou use uma ferramenta multiplataforma (Node, o proprio harness).');
  return linhas.map(ascii).join('\n');
}

/**
 * 0.3.5/D294: o texto do aviso (ASCII, como o resto). Diz qual arquivo ou regra quebrou e a causa, e
 * que a trava de idioma esta desligada - por inteiro (arquivo) ou so naquelas regras - ate consertar.
 */
function avisoTabela(problemas) {
  const linhas = ['sworn - a tabela de idioma do PowerShell nao esta valendo; o comando rodou normalmente.', ''];
  for (const p of problemas) {
    linhas.push(p.tipo === 'arquivo'
      ? '  - "' + p.onde + '" do plugin nao se leu: ' + p.causa
      : '  - regra "' + p.achado + '" (' + p.onde + ' em "' + ARQUIVO_TABELA + '") tem padrao invalido: ' + p.causa);
  }
  linhas.push(problemas.some((p) => p.tipo === 'arquivo')
    ? 'A trava de idioma de shell esta DESLIGADA ate consertar esse arquivo (nada e negado por ele).'
    : 'A trava de idioma esta DESLIGADA so para as regras acima; as outras seguem valendo.');
  linhas.push('Este aviso sai uma vez por sessao.');
  linhas.push('');
  linhas.push('Faca assim: conserte o arquivo no plugin sworn; o comando seguinte ja usa a tabela consertada.');
  return linhas.join('\n');
}

// ---------------------------------------------------------------------------
// 0.3.4/item 2 (D286) e 0.3.5/D293: o `cd` solto.
//
// A pasta atual PERSISTE entre uma chamada e outra das ferramentas Bash e PowerShell, em
// qualquer SO. A raiz dos portoes nao muda com o `cd` (config.js), mas o comando seguinte cai na
// pasta errada: um `git` sem caminho age no outro repositorio. Por isso esta funcao NAO e a
// tabela do win32 (que e de idioma): vale em qualquer plataforma e em qualquer das duas
// ferramentas. "Solto" = no nivel de cima do comando, fora de texto, de comentario e de subshell.
//
// 0.3.5/D293: UMA leitura do comando, caractere a caractere, por idioma (a pilha de regex da 0.3.4
// errava o que a camada de cima ja tinha tirado). A mesma passada sabe aspas, comentario,
// heredoc/here-string, subshell e POSICAO DE COMANDO, e devolve so os eventos de pasta, em ordem.
// E heuristica, nao um parser de bash nem de PowerShell.
//
// Bash: `( )`, `$( )`, crase, `<( )` e cada elo de cano `|` sao subshell (a pasta volta); `{ ; }`,
//   `if`, `then`, `do` NAO isolam. `$'..'` tem escape com barra. Palavra-chave (`then do else elif
//   if while until`) so vale em posicao de comando; o braco de `case` comeca depois do `)`.
//   Funcao definida guarda os eventos do corpo e a CHAMADA em posicao de comando os repete: o
//   achado e o `cd` de dentro (a palavra que muda a pasta), nao o nome da funcao. Funcao chamada
//   em OUTRO comando (outra chamada da ferramenta) nao se ve. O grupo `{ }` em cano roda em subshell.
//   D332 secao 3 (T1/F3-02, F3-03), igual ao bash e por isso NAO nega: terminador de heredoc
//   indentado por tab so fecha com `<<-` (com `<<` o resto e corpo); funcao chamada ANTES de
//   definida ainda nao existe (`f; f() { cd x; }`).
// PowerShell: NADA isola - nem `& { }`, nem `( )`, nem `$( )` (que RODA, ate dentro de aspa dupla).
//   A crase dentro da palavra escapa o caractere (`c`d` = `cd`). Chave de hashtable `@{ cd = 1 }`
//   nao e comando. So o par Push-Location com Pop-Location no mesmo comando devolve a pasta.
//   `function f { }` guarda o corpo como no bash; a chamada (sem caixa) o repete.
// ---------------------------------------------------------------------------

// `time` e `!` na frente tambem deixam a palavra seguinte em posicao de comando (T1/F3-01)
const PALAVRA_CHAVE_BASH = new Set(['then', 'do', 'else', 'elif', 'if', 'while', 'until', 'time', '!']);
const ATRIBUICAO = /^[A-Za-z_][A-Za-z0-9_]*\+?=/; // `x=1 cd y`: a atribuicao na frente nao tira a posicao de comando
const ASPA = String.fromCharCode(0); // bash: marca o trecho entre aspas na palavra (`'cd'` e cd, `'then'` nao e palavra-chave)
// `cd..` e `cd\` sao funcoes do PowerShell 5.1 (medido, D290); `sl\` nao e comando.
const CD_PS = new Set(['cd', 'chdir', 'sl', 'set-location', 'cd..', 'cd\\']);
const PUSH_PS = new Set(['push-location', 'pushd']);
const POP_PS = new Set(['pop-location', 'popd']);
const HEREDOC = /<<(-?)[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/y;
const FUNCAO_VAZIA = /[ \t]*\([ \t]*\)/y;

/**
 * Devolve os eventos de pasta do comando, em ordem: { p: 'cd'|'push'|'pop', achado, arg, reg, junto },
 * ou null quando passou do teto de aninhamento e nao se leu inteiro (T1/F3-06).
 */
function lerComando(s, idioma) {
  const ps = idioma === 'powershell';
  const n = s.length;
  const eventos = [];
  const funcoes = new Map(); // nome -> eventos do corpo
  const heredocs = [];       // marcadores abertos, lidos na proxima quebra de linha
  const delim = ps ? ' \t\r\n;&|(){}' : ' \t\r\n;&|()<>';
  let isolado = 0;
  let prof = 0;
  let teto = false; // T1/F3-06: passou de 100 niveis e o resto do comando nao se leu
  // T1/F3-12/13/14: onde o evento roda. '/1/3' = dentro de duas condicoes (depois de && ou ||, no corpo
  // de if/while/for). O Pop so desempilha o Push da mesma regiao ou de dentro dela.
  let regiao = '';
  let seq = 0;
  const abrir = () => { regiao += '/' + (++seq); };
  const doPush = new Set(); // T1/F3-13: regioes abertas pelo && logo depois de um pushd (so rodam se ele rodou)

  const emitir = (ev) => { if (!isolado) eventos.push(Object.assign({ reg: regiao }, ev)); };
  const temArgumento = (i) => {
    while (s[i] === ' ' || s[i] === '\t') i++;
    return i < n && !/[\n\r;|&})#]/.test(s[i]);
  };

  // `i` aponta para o primeiro caractere depois da aspa que abre; devolve o indice depois da que fecha.
  const aspaSimples = (i) => { const j = s.indexOf("'", i); return j < 0 ? n : j + 1; };
  const aspaAnsi = (i) => {
    for (; i < n; i++) {
      if (s[i] === '\\') i++;
      else if (s[i] === "'") return i + 1;
    }
    return n;
  };
  const aspaDupla = (i) => {
    while (i < n) {
      const c = s[i];
      if (c === (ps ? '`' : '\\')) i += 2;
      else if (c === '"') return i + 1;
      else if (c === '$' && s[i + 1] === '(') i = ler(i + 2, ')', !ps); // no PowerShell o $( ) roda
      else if (c === '`') i = ler(i + 1, '`', true);                       // so chega aqui no bash
      else i++;
    }
    return n;
  };
  // depois da quebra de linha: pula o corpo de cada heredoc aberto, na ordem
  const corposDeHeredoc = (i) => {
    while (heredocs.length) {
      const h = heredocs.shift();
      while (i < n) {
        let fim = s.indexOf('\n', i);
        if (fim < 0) fim = n;
        const linha = s.slice(i, fim).replace(/\r$/, '');
        i = fim + 1;
        if ((h.tab ? linha.replace(/^\t+/, '') : linha) === h.marca) break;
      }
    }
    return Math.min(i, n);
  };

  // Le ate `fecha` (ou o fim). `isola`: o que esta dentro nao conta (subshell do bash).
  function ler(i, fecha, isola) {
    if (prof >= 100) { teto = true; return n; } // aninhamento absurdo: para de ler em vez de estourar a pilha
    prof++;
    const regiaoDeFora = regiao;
    if (isola) isolado++;
    const pilha = []; // bash: case/grupo/funcao; PowerShell: bloco/hash
    let cmdPos = true;
    let palavra = '';
    let seg = { ini: eventos.length, cano: false }; // o comando de agora; em cano, nada dele conta
    let defPendente = null; // nome de funcao do bash esperando o `{` do corpo
    let esperaNome = false; // viu `function`
    let base = null; // a regiao de antes do primeiro && ou || da lista: o resto dela pode nao rodar
    let segDoPush = null; // o comando que fez o ultimo pushd
    let aposOperador = false; // nada lido desde o && ou ||: a quebra de linha continua a lista
    let variavel = false; // PowerShell: a palavra de antes abriu o comando com `$x` ou `[tipo]$x` (D342)
    const topo = () => pilha[pilha.length - 1];
    const noPadrao = () => { const t = topo(); return !!t && t.t === 'case' && t.fase === 'padrao'; };

    const operador = (e) => { // `&&` (e) ou `||`: cada um abre uma regiao dentro da anterior
      if (base === null) base = regiao;
      abrir(); aposOperador = true;
      if (e && segDoPush === seg) doPush.add(regiao);
    };
    const fimDaLista = () => { if (base !== null) { regiao = base; base = null; } };
    // bash: if/while/until/for/{ }/funcao comecam lista nova; o fim deles volta a regiao e a lista de fora
    const empilhar = (q) => { q.reg = regiao; q.base = base; base = null; pilha.push(q); };
    const desempilhar = () => { const t = pilha.pop(); regiao = t.reg; base = t.base; return t; };
    const condicao = (w) => { // T1/F3-14: o que vem depois de then, do, else e elif pode nao rodar
      if (w === 'if' || w === 'while' || w === 'until') empilhar({ t: 'se' });
      else if (w === 'then' || w === 'do' || w === 'else' || w === 'elif') {
        if (!topo() || topo().t !== 'se') empilhar({ t: 'se' });
        regiao = topo().reg; abrir();
      }
    };
    const guardarFuncao = (t) => { // os eventos do corpo saem da lista, com a regiao relativa a definicao
      funcoes.set(t.nome, eventos.splice(t.ini).map((ev) =>
        Object.assign({}, ev, { reg: ev.reg.startsWith(t.reg) ? ev.reg.slice(t.reg.length) : '' })));
      seg.ini = Math.min(seg.ini, eventos.length);
    };
    const repetir = (nome) => funcoes.get(nome).forEach((ev) => emitir(Object.assign({}, ev, { reg: regiao + ev.reg })));

    const fimDoComando = () => {
      if (seg.cano && eventos.length > seg.ini) eventos.length = seg.ini;
      seg = { ini: eventos.length, cano: false };
    };
    const separador = () => {
      fimDoComando();
      const t = topo();
      cmdPos = !(t && t.t === 'hash') && !noPadrao(); // chave de hashtable e padrao de case nao sao comando
    };

    // A palavra acabou, `i` aponta para o delimitador. Devolve o indice (anda se leu `()` de funcao).
    const palavraPronta = (i) => {
      const w = palavra;
      palavra = '';
      aposOperador = false;
      // D342: no PowerShell, `$x = f` e `$x += f` rodam o `f`: depois do `=` vem posicao de comando
      if (ps && variavel && /^([-+*\/%]|\?\?)?=$/.test(w)) { variavel = false; cmdPos = true; return i; }
      variavel = ps && cmdPos && /^[$[]/.test(w);
      if (!ps && w === 'esac' && topo() && topo().t === 'case' && (cmdPos || noPadrao())) {
        pilha.pop(); cmdPos = false; return i;
      }
      if (!cmdPos) { defPendente = null; return i; }
      if (!ps) {
        if (w === '{') {
          empilhar(defPendente ? { t: 'funcao', nome: defPendente, ini: eventos.length } : { t: 'grupo', ini: eventos.length });
          defPendente = null;
          return i; // segue em posicao de comando
        }
        const nome = esperaNome ? w : null;
        esperaNome = false;
        const t = topo();
        defPendente = null;
        if (w === '}') {
          if (t && (t.t === 'grupo' || t.t === 'funcao')) {
            desempilhar();
            if (t.t === 'funcao') guardarFuncao(t);
            else seg.ini = Math.min(seg.ini, t.ini); // T1/F3-05: o grupo e um comando so; em cano, nada dele conta
          }
          cmdPos = false; return i;
        }
        if (nome === null && PALAVRA_CHAVE_BASH.has(w)) { condicao(w); return i; }
        if (nome === null && ATRIBUICAO.test(w)) return i;
        if (nome === null && w === 'function') { esperaNome = true; return i; }
        if (nome === null && w === 'case') { pilha.push({ t: 'case', fase: 'padrao' }); cmdPos = false; return i; }
        FUNCAO_VAZIA.lastIndex = i;
        const vazia = FUNCAO_VAZIA.exec(s);
        if (nome !== null || (vazia && /^[\w.:-]+$/.test(w))) { // `f() {` e `function f {`
          defPendente = nome !== null ? nome : w;
          cmdPos = true;
          return vazia ? i + vazia[0].length : i;
        }
        if (t && t.t === 'se' && (w === 'fi' || w === 'done')) desempilhar();
        else if (w === 'for' || w === 'select') empilhar({ t: 'se' }); // o `do` dele abre a regiao
        const v = w.split(ASPA).join(''); // a palavra sem as aspas (T1/F3-01)
        if (v === 'cd') emitir({ p: 'cd', achado: v });
        else if (v === 'pushd') { emitir({ p: 'push', achado: v, arg: temArgumento(i) }); segDoPush = seg; }
        else if (v === 'popd') emitir({ p: 'pop', achado: v, junto: doPush.has(regiao) });
        else if (funcoes.has(v)) repetir(v);
      } else {
        const b = w.toLowerCase();
        if (esperaNome) { esperaNome = false; defPendente = b; return i; } // T1/F3-04: `function f {` guarda o corpo
        if (b === 'function') { esperaNome = true; return i; }
        if (CD_PS.has(b)) emitir({ p: 'cd', achado: b === 'cd..' || b === 'cd\\' ? w.slice(0, 2) : w }); // `cd..` e `cd\` -> `cd`
        else if (PUSH_PS.has(b)) emitir({ p: 'push', achado: w, arg: temArgumento(i) });
        else if (POP_PS.has(b)) emitir({ p: 'pop', achado: w });
        else if (funcoes.has(b)) repetir(b);
      }
      cmdPos = false;
      return i;
    };

    while (i < n) {
      const c = s[i];
      if (c === fecha && !(c === ')' && noPadrao())) { if (palavra) palavraPronta(i); i++; break; }
      if (palavra !== '' && delim.includes(c)) { i = palavraPronta(i); continue; }

      if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
      if (c === '\n') { i++; separador(); if (!aposOperador) fimDaLista(); if (!ps) i = corposDeHeredoc(i); continue; }
      if (c === '#' && palavra === '') { while (i < n && s[i] !== '\n') i++; continue; }
      if (ps && c === '<' && s[i + 1] === '#' && palavra === '') {
        const j = s.indexOf('#>', i + 2);
        i = j < 0 ? n : j + 2;
        continue;
      }

      if (c === ';') {
        if (!ps && topo() && topo().t === 'case' && (s[i + 1] === ';' || s[i + 1] === '&')) {
          topo().fase = 'padrao'; fimDoComando(); cmdPos = false; fimDaLista(); i += 2; continue; // `;;` fecha o braco
        }
        separador(); fimDaLista(); i++; continue;
      }
      if (c === '&') {
        if (s[i - 1] === '<' || s[i - 1] === '>' || s[i + 1] === '>') { i++; continue; } // `2>&1`, `&>`
        if (s[i + 1] === '&') operador(true); else { fimDaLista(); aposOperador = false; }
        separador();
        i += s[i + 1] === '&' ? 2 : 1; continue;
      }
      if (c === '|') {
        if (s[i + 1] === '|') { operador(false); separador(); i += 2; continue; }
        if (!ps && noPadrao()) { i++; continue; } // `a|b)` do case
        if (ps) separador(); else { seg.cano = true; cmdPos = true; } // cada elo do cano e subshell no bash
        i += s[i + 1] === '&' ? 2 : 1;
        continue;
      }
      if (c === '(') {
        if (!ps && noPadrao()) { i++; continue; }
        i = ler(i + 1, ')', !ps);
        cmdPos = false; aposOperador = false;
        continue;
      }
      if (c === ')') {
        const t = topo();
        if (!ps && t && t.t === 'case' && t.fase === 'padrao') { t.fase = 'corpo'; cmdPos = true; }
        i++; continue;
      }
      if (ps && c === '{') {
        pilha.push(defPendente ? { t: 'funcao', nome: defPendente, ini: eventos.length, reg: regiao } : { t: 'bloco' });
        defPendente = null; cmdPos = true; i++; continue;
      }
      if (ps && c === '}') { const t = pilha.pop(); if (t && t.t === 'funcao') guardarFuncao(t); cmdPos = false; i++; continue; }
      if (!ps && c === '<') {
        if (s.startsWith('<<<', i)) { i += 3; continue; }
        HEREDOC.lastIndex = i;
        const m = s[i + 1] === '<' ? HEREDOC.exec(s) : null;
        if (m) { heredocs.push({ marca: m[3], tab: m[1] === '-' }); i += m[0].length; continue; }
        i++; continue;
      }
      if (!ps && c === '>') { i++; continue; }

      // daqui para baixo e caractere de palavra
      if (ps && c === '@' && s[i + 1] === '{') { // @{ }: o que esta dentro e chave, nao comando
        if (palavra) palavraPronta(i);
        pilha.push({ t: 'hash' }); cmdPos = false; i += 2; continue;
      }
      if (ps && c === '@' && palavra === '' && (s[i + 1] === "'" || s[i + 1] === '"') && /^[ \t]*\r?\n/.test(s.slice(i + 2, i + 40))) {
        const j = s.indexOf('\n' + s[i + 1] + '@', i + 2); // here-string: o corpo e texto
        palavra = '@';
        i = j < 0 ? n : j + 3;
        continue;
      }
      if (c === "'") { const j = aspaSimples(i + 1); palavra += ps ? "'" : ASPA + s.slice(i + 1, j).replace(/'$/, ''); i = j; continue; }
      if (c === '"') { // no bash, a dupla sem $, crase nem barra e texto puro (`"cd" x` e cd); com eles, nao se sabe
        const j = aspaDupla(i + 1);
        const d = s.slice(i + 1, j).replace(/"$/, '');
        palavra += ps ? '"' : ASPA + (/[$`\\]/.test(d) ? '$' : d);
        i = j; continue;
      }
      if (!ps && c === '$' && s[i + 1] === "'") { i = aspaAnsi(i + 2); palavra += "'"; continue; }
      if (c === '$' && s[i + 1] === '(') { i = ler(i + 2, ')', !ps); palavra += '$'; continue; }
      if (c === '$' && s[i + 1] === '{') { const j = s.indexOf('}', i); i = j < 0 ? n : j + 1; palavra += '$'; continue; }
      if (!ps && c === '`') { i = ler(i + 1, '`', true); palavra += '`'; continue; }
      if (c === (ps ? '`' : '\\')) { // escape; no fim da linha e continuacao
        const k = s[i + 1] === '\n' ? 2 : (s[i + 1] === '\r' && s[i + 2] === '\n' ? 3 : 0);
        if (k) { if (palavra) { i = palavraPronta(i); continue; } i += k; continue; }
        if (i + 1 < n) palavra += s[i + 1];
        i += 2; continue;
      }
      palavra += c; i++;
    }
    if (palavra) palavraPronta(i);
    fimDoComando();
    regiao = regiaoDeFora;
    if (isola) isolado--;
    prof--;
    return i;
  }

  ler(0, '', false);
  return teto ? null : eventos; // null: o comando nao foi lido inteiro
}

function idiomaDoCd(ferramenta, plataforma) {
  if (ferramenta === 'PowerShell') return 'powershell';
  if (ferramenta === 'Bash') return 'bash';
  // chamada sem ferramenta: a plataforma declarada escolhe; sem ela, o Bash (o caso comum)
  return (plataforma && plataforma.shell === 'powershell') ? 'powershell' : 'bash';
}

/**
 * Acha o `cd` solto. Devolve `{ forma: 'bash'|'powershell', achado }` (achado = a palavra, como
 * foi escrita) ou `null`. Nao depende de plataforma: `plataforma` so escolhe o idioma quando a
 * ferramenta nao veio.
 * Pilha do Push/Pop, igual nos dois idiomas, na ordem do texto: Pop com a pilha vazia nao faz nada
 * (medido no 5.1); cd com a pilha vazia esta solto; cd com pilha nao vazia nao; Push que sobra na
 * pilha esta solto - salvo o Push-Location sem caminho, que so empilha a pasta atual (medido).
 * T1/F3-12/13/14: o Pop so desempilha se rodar sempre que o Push rodou - na mesma regiao do Push ou
 * fora dela. Pop depois de && ou ||, no corpo de if/while/for, ou numa funcao chamada depois de && nao
 * desempilha (`pushd x && make && popd` nega); Push e Pop no mesmo bloco condicional se anulam. A
 * excecao e o Pop logo depois de `pushd x &&` (`pushd x && popd`): se o pushd falha, a pasta nao mudou.
 * T1/F3-06: comando com mais de 100 niveis de aninhamento nao se le inteiro e nega (`teto`), mesmo sem cd.
 */
function cdSolto(comando, ferramenta, plataforma) {
  const forma = idiomaDoCd(ferramenta, plataforma);
  const pilha = [];
  const eventos = lerComando(String(comando == null ? '' : comando), forma);
  if (!eventos) return { forma, achado: null, teto: true };
  const garantido = (pop, push) => push === pop || push.startsWith(pop + '/');
  for (const ev of eventos) {
    if (ev.p === 'push') pilha.push({ achado: ev.achado, mudou: ev.arg, reg: ev.reg });
    else if (ev.p === 'pop') {
      const t = pilha[pilha.length - 1];
      if (t && (ev.junto || garantido(ev.reg, t.reg))) pilha.pop();
    }
    else if (!pilha.length) return { forma, achado: ev.achado };
    else pilha[pilha.length - 1].mudou = true;
  }
  const sobra = pilha.find((p) => p.mudou);
  return sobra ? { forma, achado: sobra.achado } : null;
}

/** A mensagem da negacao: o que aconteceu, o porque, e a forma certa para a ferramenta. */
function motivoCdSolto(comando, achado) {
  const ps = !!achado && achado.forma === 'powershell';
  const teto = !!achado && achado.teto === true;
  const linhas = [
    'sworn - cd solto: a pasta mudada ficaria valendo para os comandos seguintes.',
    '',
    'Comando: ' + String(comando).slice(0, 300)
  ];
  if (teto) { // T1/F3-06
    linhas.push('O comando passa de 100 niveis de aninhamento e nao foi lido inteiro: um cd la dentro');
    linhas.push('nao se veria, e a pasta mudada ficaria valendo no comando seguinte.');
  } else {
    linhas.push('O que o ' + (achado ? achado.achado : 'cd') + ' muda persiste no comando seguinte, e um git ou npm');
    linhas.push('sem caminho passa a agir em outra pasta.');
  }
  linhas.push('');
  linhas.push('Faca uma destas:');
  // Cada opcao e a 1a linha e as de continuacao; o numero sai da posicao, num lugar so.
  const opcoes = [];
  if (teto) opcoes.push(['divida o comando em comandos menores, e use uma das formas abaixo para mudar de pasta;']);
  if (ps) {
    opcoes.push(['mude de pasta so dentro do bloco, e a pasta volta mesmo se o comando falhar:',
      "       Push-Location -LiteralPath '<pasta>' -ErrorAction Stop; try { <comando> } finally { Pop-Location }",
      '     O bloco & { Set-Location X } NAO isola a pasta (medido no PowerShell 5.1). Sem o -ErrorAction Stop,',
      '     uma pasta errada deixa o comando rodar na pasta de antes e o Pop-Location desempilha a pasta errada (medido);']);
    opcoes.push(['ou nao mude de pasta:', "       git -C '<pasta>' <comando do git>", "       npm --prefix '<pasta>' <comando do npm>"]);
  } else {
    opcoes.push(['rode em subshell (os parenteses abrem um shell filho: o cd vale so dentro dele e a pasta volta sozinha):',
      '       ( cd "<pasta>" && <comando> )']);
    opcoes.push(['ou nao mude de pasta:', '       git -C "<pasta>" <comando do git>', '       npm --prefix "<pasta>" <comando do npm>']);
  }
  opcoes.forEach(function (o, i) {
    linhas.push('  ' + (i + 1) + '. ' + o[0]);
    for (const resto of o.slice(1)) linhas.push(resto);
  });
  linhas.push('');
  linhas.push('So o dono libera: ele acrescenta o padrao em "comandosLiberados" de .claude/sworn/projeto.json.');
  return linhas.map(ascii).join('\n');
}

/**
 * D486 (s108): o cd solto do Bash se corrige sozinho. O comando inteiro vai num subshell, e o que o cd muda morre
 * com ele; o resto do estado do shell ja nao passava de uma chamada para a outra. O `)` vem na linha de baixo para
 * fechar depois de heredoc e de comentario no fim. Devolve null quando nao da para envolver: comando ilegivel
 * (teto), idioma que nao e o do Bash, ou fim em barra (a barra emendaria a linha do `)`).
 */
function envolverEmSubshell(comando, achado) {
  if (!achado || achado.teto || achado.forma !== 'bash' || typeof comando !== 'string') return null;
  if (/\\$/.test(comando.replace(/\s+$/, ''))) return null;
  return '( ' + comando + '\n)';
}

/**
 * D486: o que o agente fica sabendo quando o comando foi corrigido em vez de negado. Nada falta (o comando ja rodou),
 * entao o aviso nao tem "Faca uma destas". D569: inteiro na 1a vez da sessao; `deNovo` da a linha curta das seguintes.
 */
function avisoCdCorrigido(achado, deNovo) {
  if (deNovo) return 'sworn - cd solto corrigido de novo (subshell): ( cd "<pasta>" && <comando> ), ou git -C "<pasta>".';
  return [
    'sworn - cd solto corrigido: o comando rodou dentro de um subshell, ( ... ).',
    '',
    'O ' + (achado ? achado.achado : 'cd') + ' mudaria a pasta para os comandos seguintes; no subshell a pasta volta sozinha.',
    'Da proxima vez, escreva assim: ( cd "<pasta>" && <comando> ), ou git -C "<pasta>" sem mudar de pasta.'
  ].map(ascii).join('\n');
}

module.exports = { TABELA, semLiterais, conferir, problemasDaTabela, avisoTabela, motivo, cdSolto, motivoCdSolto,
  envolverEmSubshell, avisoCdCorrigido };
