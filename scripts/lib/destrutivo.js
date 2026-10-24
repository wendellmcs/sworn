'use strict';
const escopo = require('./escopo.js');

// ===========================================================================
// D51: O LEITOR. A trava LE o comando antes de casar as regras.
//
// Tres revisoes seguidas reprovaram pelo mesmo fundo: as regras casavam TEXTO,
// nao COMANDO. Cada rodada de regex fechava um buraco e abria outro - comentario
// de bloco (`<# & #>`), continuacao de linha e separador dentro de aspas passavam
// por baixo do casamento de texto; e o ancoradouro do apelido, por nao saber o
// que e posicao de comando, barrava `-Pattern del -Recurse`.
//
// NAO reabre a D48: o texto entre aspas CONTINUA sendo classificado, e
// `bash -c "rm -rf src"` continua barrado. A aspa serve so para saber ONDE UM
// COMANDO TERMINA, nunca para ignorar o que esta dentro dela - tanto que um
// argumento entre aspas com espaco dentro e RELIDO como comando aninhado.
// ===========================================================================

// Fora de aspas, cada um destes encerra o comando corrente. `{` e `}` entram
// porque delimitam bloco de script: em `... | ForEach-Object { rd $_ -Recurse }`
// o `rd` esta em posicao de comando DENTRO do bloco.
// `(` e `)` NAO entram: eles separam TOKEN, nao comando. Se cortassem o
// segmento, `Remove-Item (Get-Item src) -Recurse -Force` escaparia.
const SEPARA_SEGMENTO = ';|&\n\r{}';
const SEPARA_TOKEN = '()';

// Um token logo depois destes esta em posicao de comando: e assim que
// `powershell -Command rd src -Recurse` continua barrado sem que
// `Copy-Item rd dst -Recurse` vire falso positivo.
// UMA OU MAIS barras antes do terminal: a conversao de caminho do MSYS (Git
// Bash) troca um `/c` sozinho por `C:/`, entao `cmd /c` NAO executa a partir
// do gancho `Bash` e `cmd //c` executa - medido com `echo`. Aceitar so uma
// barra deixava as tres regras de token inteiras de fora nesse gancho (D57).
// O regex nao codifica a paridade do parser do cmd.exe (`//c` executa, `///c`
// nao, `////c` executa): sobre-bloquear a forma que nao executa e inofensivo,
// e depender de versao de MSYS nao seria.
// O introdutor e uma CLASSE, nao uma grafia (D58/D61). Antes do terminal o
// cmd.exe aceita um AGLOMERADO de chaves separadas por barra, e ele PULA chave
// desconhecida em vez de recusar: `//q/c`, `//c/c`, `//e:on/c`, `//t:0a/c`,
// `//1/c`, `//_/c`, `//zz/c`, `//srv/c`, `//x:y:z/c`, `//srv/dados/c` e
// `//1/2/3/c` TODAS executam - medidas com `echo`. Por isso a chave e qualquer
// corrida sem barra e sem branco, e NAO uma letra: supor letra foi o erro da
// D58, e e o mesmo erro da D57 um nivel acima (D61).
// O terminal tampouco e so `c`/`k`: a-z foi enumerado, duas vezes, e as letras
// que executam sozinhas sao EXATAMENTE `c`, `k` e `r` - o `/r` e alias de `/c`.
// O terminal e o ULTIMO campo: `//c/q` NAO executa, porque o `/c` encerra a
// leitura de chaves e `/q` passa a ser o comando. Por isso o `$` no fim importa.
// NAO cobre a forma COLADA (`cmd //cdel /s /q build`, `cmd /c del/s/q build`):
// ela executa, mas tambem passava no fix round 4 - e limite pre-existente,
// declarado no desenho secao 10 por decisao do dono, nao regressao.
// Retrocesso medido, nao suposto: `[^\/\s]+` e `\/+` casam conjuntos disjuntos,
// entao a particao e unica e nao ha explosao - 4096 caracteres em 2,7 ms.
const INTRODUTOR = /^(?:-c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?|\/+(?:[^\/\s]+\/+)*[ckr])$/i;

// Teto de recursao da releitura de argumento entre aspas. 2 basta para
// `bash -c "pwsh -Command 'rd src -Recurse'"` e impede laco.
const FUNDO = 2;

// ===========================================================================
// D80/F1: WRAPPER DE PROCESSO - o nome que NAO e o comando, e sim quem EXECUTA
// o resto da linha.
//
// `posCmd` (montado em `montar`) so conhece DUAS coisas: o indice 0 e o token depois de um
// INTRODUTOR. Qualquer palavra antes do comando desligava as tres regras `fn:`
// (`apelidoPS`, `formaCmd`, `apagaRemoto`) de uma vez - e o portao passou a
// ENSINAR a burla: `ssh host "git push origin --delete main"` barrava e
// `ssh deploy@host git push origin --delete main` passava.
//
// POR QUE LISTA DE NOMES, e nao regra de estrutura: nao ha diferenca sintatica
// entre `env rd /s /q build` (o `rd` executa) e `Copy-Item rd dst -Recurse`
// (o `rd` e um caminho). Os dois sao <token> <token> <argumentos>. O que separa
// os dois e SO o nome do primeiro. E a lista NEGATIVA ("todo mundo abre menos
// X") e ilimitada: `echo rd -Recurse`, `grep rd .`, `which rd`, `man rd` sao
// inocentes comuns.
//
// POR QUE ABRE O RESTO DO SEGMENTO, e nao "o proximo token": saber QUANTOS
// argumentos o wrapper consome antes do comando e por-programa (`ssh` ~30
// flags, `docker run` >100, `timeout -k VALOR`, `env` com N atribuicoes).
// Modelo de aridade e caro, fragil, e quando erra ele erra para o lado do
// FALSO POSITIVO - poe o argumento errado em posicao de comando, que e o mesmo
// defeito do `-c` generico. Abrir o resto troca aridade por risco de falso
// positivo.
//
// ESSE RISCO SE MATERIALIZOU, e a correcao dele e o que as tres travas abaixo
// fazem. A primeira versao desta abertura passou nos tres controles que o
// projeto tinha (222 gemeos da varredura, 49 INOCENTES da bancada, 83 comandos
// cotidianos) e MESMO ASSIM criou 130 falsos positivos - inclusive
// `git ls-files | xargs -r grep -n rm`, uso diario deste repositorio. Os tres
// controles eram cegos pela mesma razao: este falso positivo precisa de TRES
// ingredientes no mesmo segmento (wrapper + nome de apelido em posicao de
// ARGUMENTO + flag parecida com `-Recurse`/`/s`), e nenhum corpus tinha os tres
// juntos. O controle que enxerga e `fix5-bancada/inocentes-wrapper.js`, que
// GERA o produto cartesiano em vez de listar casos de memoria.
//
// LICAO, e ela vale mais que o codigo: o caso adverso MUDA quando o conserto
// muda. Corpus montado para medir falso NEGATIVO por wrapper tem gemeos SEM
// wrapper - ele nao pode acusar falso POSITIVO por wrapper.
//
// As tres travas da regiao ampliada, cada uma com o seu marcador:
//   R1 (:montar)   token CITADO nao entra - `"erase"` e string, nao comando.
//   R2 (:corrobora) a flag tem de vir de OUTRO token e, na regiao ampliada,
//                   DEPOIS do nome.
//   R3 (:nomeCmd)  o descascamento de CAMINHO nao vale na regiao ampliada -
//                  `/opt/rm` em posicao de argumento e caminho, nao comando.
//
// A recursao vem DE GRACA, em dois lugares, e por isso nao ha recursao nova
// aqui: (1) a abertura encadeia sozinha no mesmo segmento
// (`env nohup timeout 5 rd /s /q build` abre no `env`); (2) a releitura do
// argumento citado (bloco FUNDO, no fim de `lerComando`) ja desce ate FUNDO=2 com a leitura
// PRIMARIA para todo argumento citado com espaco, entao
// `ssh host bash -lc "env rd /s /q build"` cai no mesmo caminho um nivel abaixo.
//
// A abertura alimenta SO `posAmpla` (:montar), nunca `posCmd`. E deliberado: o
// gate da D68 no FUNDO (o `seg.posCmd.has(k)` de `lerComando`) continua lendo `posCmd`, entao
// `sudo git commit -m "explica (rd /s /q build)"` NAO recebe a leitura de
// parentese dentro da prosa citada, e o falso positivo que a D68 fechou fica
// fechado.
// ===========================================================================
const ABRE_RESTO = new Set([
  // shells e interpretadores
  'bash', 'sh', 'zsh', 'ksh', 'dash', 'fish', 'busybox', 'pwsh', 'powershell', 'cmd',
  // wrappers de processo do Unix
  'env', 'nohup', 'time', 'command', 'builtin', 'exec', 'eval', 'nice', 'ionice',
  'taskset', 'chrt', 'timeout', 'stdbuf', 'setsid', 'setarch', 'flock', 'unbuffer',
  'script', 'watch', 'strace', 'ltrace', 'valgrind', 'perf', 'gdb', 'chroot', 'proot',
  'nsenter', 'unshare', 'firejail', 'bwrap', 'tini', 'dumb-init', 'winpty', 'eatmydata',
  'envdir', 'xargs', 'find', 'parallel', 'entr',
  // D80/P1-3: 13 wrappers reais que o fix round 4 barrava e a primeira lista
  // deixou passar. Nenhum deles esta nos 222 casos da varredura, entao o
  // criterio `REGRESSAO <= 24` era cego para eles - achados por revisao de
  // membresia, conferidos um a um contra o fix4.
  'caffeinate', 'mpirun', 'srun', 'fakeroot', 'rlwrap', 'cpulimit', 'torsocks',
  'torify', 'catchsegv', 'ssh-agent', 'dbus-run-session', 'arch', 'retry',
  // elevacao de privilegio
  'sudo', 'doas', 'pkexec', 'su', 'gosu', 'runuser', 'setpriv', 'runas',
  // sessao, agendamento e servico
  'screen', 'tmux', 'systemd-run', 'systemd-cat', 'start', 'call', 'for', 'doskey',
  'rundll32', 'schtasks', 'psexec', 'wmic', 'spawn', 'at',
  // rede e container
  'ssh', 'docker', 'podman', 'kubectl', 'oc', 'lxc', 'incus', 'distrobox-enter',
  'toolbox', 'wsl', 'heroku', 'vagrant', 'ansible',
  // gerenciador de pacote e de ambiente
  'npm', 'pnpm', 'npx', 'yarn', 'bun', 'bunx', 'deno', 'pipx', 'poetry', 'uv', 'conda',
  'cargo', 'bundle', 'direnv', 'asdf', 'mise', 'rbenv', 'pyenv', 'nvm',
  // o git multiplexa subcomando que executa comando alheio:
  // `git submodule foreach X`, `git bisect run X`
  'git',
  // PowerShell
  'start-process', 'start-job', 'start-threadjob', 'invoke-command',
  'invoke-expression', 'iex', 'register-scheduledtask', 'new-scheduledtaskaction'
]);

// Um token que tem separador de caminho pode ser um pedaco de caminho NAO
// CITADO com espaco no meio (`C:/Program Files/Git/cmd/git.exe`): o nome real
// e o ULTIMO pedaco.
const CAMINHO = /[\\/]/;

// Os bytes que abrem alguma casca em `nomeCmd`. Serve so de atalho de custo.
const CASCA = /[%,=!\\/]/;

/**
 * Separa o comando em segmentos (um por comando) e em tokens (um por argumento).
 * Devolve [{ texto, semAspas, tokens: string[], posCmd: Set<number> }].
 *
 * - `texto`: texto cru do segmento, COM as aspas, sem comentario e com as
 *   continuacoes de linha ja juntadas. E sobre ele que as regras de texto rodam,
 *   e e por isso que a D48 continua valendo.
 * - `semAspas`: os tokens juntados por um espaco, sem as aspas de quem nao tem
 *   espaco dentro. Frase entre aspas continua entre aspas, senao
 *   `grep -rn "rm -rf" .` - que a D48 registra como comando que PASSA - viraria
 *   falso positivo.
 * - `tokens`: valor literal de cada argumento, ja sem aspas.
 * - `posCmd`: indices de token que estao em posicao de comando.
 */
function lerComando(cmd, fundo, opts) {
  const nivel = fundo || 0;
  const op = opts || {};
  const segmentos = [];
  let texto = '';
  let tokens = [];
  let citados = [];
  let tokV = '';
  let tokCitado = false;
  let tokAberto = false;
  // D74/P0: marca o segmento da CAUDA - o que vem logo depois do `)` que fecha
  // um `$(...)` na leitura `dolarSepara`. A cauda e continuacao da mesma frase
  // (`echo "deploy $(date) git push --prune"`), nao um comando novo: ela NAO
  // recebe posicao de comando no token 0. Um separador de verdade (`;`, `|`,
  // `&`, quebra) ou um novo `$(` desliga a marca. So a leitura `dolarSepara`
  // liga a marca; nas demais leituras nada muda.
  let semCmd0 = false;
  let i = 0;
  const n = cmd.length;

  function fecharToken() {
    if (!tokAberto) return;
    tokens.push(tokV);
    citados.push(tokCitado);
    tokV = '';
    tokCitado = false;
    tokAberto = false;
  }

  function fecharSegmento() {
    fecharToken();
    if (texto.trim() !== '' || tokens.length) segmentos.push(montar(texto, tokens, citados, nivel, semCmd0));
    texto = '';
    tokens = [];
    citados = [];
  }

  while (i < n) {
    const c = cmd[i];

    // Comentario de bloco do PowerShell: `<# ... #>` vira um espaco. Era a burla
    // de 9 caracteres: `Remove-Item <# & #> src -Recurse -Force`.
    if (c === '<' && cmd[i + 1] === '#') {
      const fim = cmd.indexOf('#>', i + 2);
      i = (fim === -1) ? n : fim + 2;
      fecharToken();
      texto += ' ';
      continue;
    }

    // Continuacao de linha: crase (PowerShell) ou barra invertida (bash) coladas
    // na quebra. Viram um espaco - o comando e UM so.
    // D67/P0-2: `op.semContinuacao` DESLIGA a juncao. No PowerShell a barra
    // invertida e literal e a quebra ENCERRA a instrucao - `lerTudo` le das duas
    // formas e barra se qualquer uma barrar (mesmo molde do `nu()`).
    if (!op.semContinuacao && (c === '`' || c === '\\') && (cmd[i + 1] === '\n' || (cmd[i + 1] === '\r' && cmd[i + 2] === '\n'))) {
      i += (cmd[i + 1] === '\r') ? 3 : 2;
      fecharToken();
      texto += ' ';
      continue;
    }

    // Comentario de linha: so quando o `#` ABRE um token E vem seguido de branco
    // ou de fim. `# +1` e comentario; `#dir` e nome de pasta, e `rm -rf #dir` tem
    // de continuar barrando.
    // D67/P0-3: `op.semComentario` DESLIGA o comentario. No cmd.exe o `#` e
    // literal - o FUNDO relere o argumento citado de `cmd /c` com o `#` literal.
    if (!op.semComentario && c === '#' && !tokAberto && (i + 1 >= n || /\s/.test(cmd[i + 1]))) {
      while (i < n && cmd[i] !== '\n') i++;
      continue;
    }

    // D69/crase: substituicao de comando por CRASE do bash - `echo `rd -Recurse``
    // executa `rd`. Fora de aspas a crase abre/fecha comando. `op.craseSepara`
    // corta SEGMENTO nesta leitura ALTERNATIVA (nunca na primaria). A crase COLADA
    // na quebra ja virou continuacao acima; a crase DENTRO de aspas duplas e o
    // escape do PowerShell, tratado no ramo das aspas. So a crase solta chega aqui.
    if (op.craseSepara && c === '`') {
      fecharSegmento();
      i++;
      continue;
    }

    // D70/achado 3: `$(` corta SEGMENTO nesta leitura ALTERNATIVA (nunca na
    // primaria), pondo o comando dentro de `$(...)` em posicao de comando. So o
    // `$(` - o `(` sozinho NAO, para nao reabrir o FP de prosa que a D68 fechou.
    if (op.dolarSepara && c === '$' && cmd[i + 1] === '(') {
      fecharSegmento();
      semCmd0 = false; // o MIOLO do $(...) executa: posicao de comando normal
      i += 2;
      continue;
    }

    // `${...}` e UM token. Sem isto o `{` cortaria o segmento e
    // `Remove-Item ${alvo} -Recurse -Force` escaparia.
    if (c === '$' && cmd[i + 1] === '{') {
      const fim = cmd.indexOf('}', i + 2);
      const ate = (fim === -1) ? n : fim + 1;
      const pedaco = cmd.slice(i, ate);
      texto += pedaco;
      tokV += pedaco;
      tokAberto = true;
      i = ate;
      continue;
    }

    // Aspas: o conteudo entra no token E no texto. A aspa marca so onde o
    // argumento termina - nunca esconde o que esta dentro (D48).
    // So a crase escapa dentro de aspas duplas: a barra invertida NAO escapa,
    // senao `rd "C:\Dados\" -Recurse -Force` deixaria a aspa aberta e o
    // `-Recurse` nunca viraria token.
    if (c === '"' || c === "'") {
      const fecha = c;
      texto += c;
      tokAberto = true;
      tokCitado = true;
      i++;
      while (i < n && cmd[i] !== fecha) {
        // No PowerShell a crase dentro de aspas duplas ESCAPA o proximo caractere;
        // no bash ela e SUBSTITUICAO DE COMANDO (`bash -c "echo `rd -Recurse`"`
        // executa `rd`). Na leitura primaria vale a leitura PowerShell (escape);
        // na leitura alternativa `craseSepara` a crase e mantida no token para a
        // releitura corta-la em segmento - a mesma crase, os dois significados,
        // barra se qualquer um barrar (D69).
        if (!op.craseSepara && fecha === '"' && cmd[i] === '`' && i + 1 < n) {
          texto += cmd[i] + cmd[i + 1];
          tokV += cmd[i + 1];
          i += 2;
          continue;
        }
        texto += cmd[i];
        tokV += cmd[i];
        i++;
      }
      if (i < n) { texto += cmd[i]; i++; }
      continue;
    }

    // FIX22/F3: `{}` COLADO e o ALVO do comando, nao um bloco de script.
    // `rm -rf {}` e o idioma de delecao mais comum do shell (`find -exec`,
    // `xargs -I{}`), e ele passava: `{` e `}` estao em SEPARA_SEGMENTO (no topo do arquivo)
    // e cortavam o segmento em `rm -rf ` sem nada depois, entao o `\s+\S` da
    // regra 1 do `rm` (ver REGRAS) nao tinha `\S` para casar. `op.chaveVazia`
    // faz o par COLADO virar UM token nesta leitura ALTERNATIVA (nunca na
    // primaria) - o alvo passa a existir e a regra 1 volta a casar.
    //
    // POR QUE LEITURA ALTERNATIVA, e nao tirar `{}` de SEPARA_SEGMENTO nem
    // ler `{}` como token na leitura primaria: MEDIDO em
    // `fix5-bancada/difere-chave-v3-v4.js`, ler `{}` como token na primaria
    // PERDE 105 bloqueios que este portao ja tem, porque com `{}` antes do
    // comando (`{} rd /s /q build`, `; {}ri -Recurse -Force dist`) o token
    // `{}` ocupa o indice 0 e EMPURRA o comando de verdade para fora de
    // `posCmd` - as quatro regras de token ficam cegas. Tirar `{}` de
    // SEPARA_SEGMENTO desliga 4 dos 7 blocos de script do PowerShell
    // (`ForEach-Object { rd $_ -Recurse -Force }`), que e a razao de `{` e `}`
    // cortarem. Como leitura alternativa os segmentos apenas SE SOMAM a
    // primaria, entao nada que ja barra pode deixar de barrar - o mesmo molde
    // da D67/D69/D70/D74, e medido: PERDA 0.
    //
    // SO O PAR COLADO. Bloco de verdade tem conteudo (`{ rd $_ -Recurse }`,
    // `{rd $_ -Recurse}`), o `{` nao e seguido de `}`, e ele continua cortando
    // segmento nas DUAS leituras.
    //
    // POR QUE NAO A SAIDA FACIL (tirar o `\s+\S` da regra 1, ou aceitar o fim
    // do segmento como alvo): as duas barram `grep -rn "rm -rf" .`, que e
    // controle do portao. A causa e mais funda que "prosa": o argumento citado
    // `"rm -rf"` tem espaco dentro e por isso e RELIDO como comando aninhado
    // (D48, bloco FUNDO), virando um segmento com `rm` em posCmd e `-rf` como
    // token irmao - indistinguivel de um `rm -rf` de verdade. So a AUSENCIA DE
    // ALVO separa os dois. Logo o conserto tem de olhar o ALVO, e nao o par
    // `rm` + flag: uma regra de token para `rm` com flag `-r`/`-f` barra o
    // controle pela mesma porta (medido).
    if (op.chaveVazia && c === '{' && cmd[i + 1] === '}') {
      texto += '{}';
      tokV += '{}';
      tokAberto = true;
      i += 2;
      continue;
    }

    if (SEPARA_SEGMENTO.indexOf(c) !== -1) {
      fecharSegmento();
      semCmd0 = false; // separador de verdade: o que segue volta a ser comando
      i++;
      continue;
    }

    // Parentese separa TOKEN e fica no texto: `& (rd) src -Recurse` tem o `rd`
    // em posicao de comando, e `-Pattern (del) -Recurse` nao tem.
    // D67/P0-1: `op.parenSepara` faz `(` e `)` cortarem SEGMENTO nesta leitura
    // alternativa (nunca na primaria), pondo o comando DENTRO de `(...)`/`$(...)`
    // em posicao de comando. Parentese dentro de aspas NAO chega aqui: a leitura
    // das aspas (mais abaixo) consome o conteudo citado antes. O que PODE disparar
    // parentese dentro de argumento citado e a RELEITURA do argumento (FUNDO) -
    // e por isso ela so propaga esta leitura quando o argumento esta em posicao de
    // comando (ver o gate `seg.posCmd.has(k)` no FUNDO). Sem esse gate,
    // `git commit -m "...(rd /s /q build)..."` virava falso positivo (D68).
    if (SEPARA_TOKEN.indexOf(c) !== -1) {
      if (op.parenSepara) { fecharSegmento(); i++; continue; }
      // D74/P0: sob `dolarSepara` o `)` FECHA o segmento que o `$(` abriu -
      // sem isto o segmento do comando substituido engolia a cauda depois do
      // `)` e as tres regras de token liam argumento alheio (`echo "a $(git
      // rev-parse HEAD) b push --prune c"` barrava; fix4=passa). A cauda vira
      // segmento SEM posicao de comando no token 0 (`semCmd0`): dentro de aspas
      // ela e pedaco de string e nunca executa, e fora de aspas o canal real
      // (`$(x) git push --delete main`, que executa quando a substituicao
      // expande vazio) ja e coberto pela leitura `parenSepara`, onde `(` e `)`
      // cortam e o comando da cauda cai em posicao de comando - medido na
      // sonda do fix19. So o `)`: o `(` sozinho segue separando TOKEN.
      if (op.dolarSepara && c === ')') { fecharSegmento(); semCmd0 = true; i++; continue; }
      fecharToken();
      texto += c;
      i++;
      continue;
    }

    if (/\s/.test(c)) {
      fecharToken();
      texto += ' ';
      i++;
      continue;
    }

    texto += c;
    tokV += c;
    tokAberto = true;
    i++;
  }
  fecharSegmento();

  // D48 levada a serio: um argumento CITADO com espaco dentro e um comando de
  // outro shell (`powershell -Command "rd src -Recurse -Force"`). Ele e relido,
  // e os segmentos dele entram na analise. Argumento de uma palavra nao precisa:
  // o valor literal ja esta em `tokens`.
  if (nivel < FUNDO) {
    const aninhados = [];
    for (const seg of segmentos) {
      for (let k = 0; k < seg.tokens.length; k++) {
        if (seg.citados[k] && /\s/.test(seg.tokens[k])) {
          // D68/FP: a leitura ALTERNATIVA (parenteses, crase, continuacao) so e
          // propagada para dentro do argumento citado quando ELE esta em posicao de
          // comando - isto e, depois de um introdutor (`-c`, `-Command`, `/c`, e as
          // formas da classe do cmd) ja enumerado em D57/D58/D61. So ai o argumento
          // e um COMANDO de outro shell (`powershell -Command "echo (rd ...)"`,
          // `bash -c "echo `rd`"`). Em `git commit -m "... (rd /s /q build) ..."` o
          // `-m` NAO e introdutor, entao a prosa citada nao recebe a leitura de
          // parentese e nao vira falso positivo (o defeito que o D67 abriu). A
          // releitura PRIMARIA (texto, D48) continua rodando para TODO argumento
          // citado; o que o gate corta e so a leitura alternativa.
          // D70/achado 3 + D74/P1: FORA de posicao de comando propagam-se as
          // leituras de quem executa NO SHELL DE FORA - `$(...)` E a CRASE
          // substituem comando ate em argumento de prosa (`echo "$(git push ...)"`;
          // e a crase dentro de aspas duplas e expandida pelo parent bash ANTES
          // de qualquer wrapper rodar, invariante provada em shell real na D73
          // com `uname -s`). O fix18 tinha deixado a crase cair junto com o
          // parentese nesta linha - regressao fechada aqui. So `parenSepara`
          // fica de fora: o `(` sozinho NAO executa em prosa, e propaga-lo
          // reabria o falso positivo que a D68 fechou.
          const opFilho = seg.posCmd.has(k) ? op
            : { dolarSepara: !!op.dolarSepara, craseSepara: !!op.craseSepara };
          for (const s of lerComando(seg.tokens[k], nivel + 1, opFilho)) aninhados.push(s);
          // D67/P0-3: se ESTE segmento e um `cmd`/`cmd.exe`, o argumento citado
          // pode ser lido pelo cmd.exe, onde o `#` NAO e comentario. Releia com o
          // `#` literal e UNA - so acrescenta leitura. Escopado a `cmd` de
          // proposito: em `bash -c "... # ..."` o `#` E comentario, e reler ali
          // criaria falso positivo. Medido antes de escrever.
          if (seg.tokens[k].indexOf('#') !== -1 && comandoE(seg, CMD_EXE)) {
            // D70/achado 1: `opFilho` (nao `op`) - senao o ramo do `#` contorna o
            // gate da D68 e `cmd /c echo "# doc (rd /s /q build)"`, com o argumento
            // FORA de posicao de comando, recebia a leitura de parentese e virava FP.
            const semCom = Object.assign({}, opFilho, { semComentario: true });
            for (const s of lerComando(seg.tokens[k], nivel + 1, semCom)) aninhados.push(s);
          }
        }
      }
    }
    for (const s of aninhados) segmentos.push(s);
  }
  return segmentos;
}

// D67: o portao le o comando sob as interpretacoes AMBIGUAS de shell e UNE os
// segmentos - barra se QUALQUER leitura barrar. E o molde ja usado em `nu()` (o
// `^`) e em `semAspas` (as aspas): onde o portao nao sabe qual shell vai executar,
// erra para o lado do sobre-bloqueio (D45/D49/D57/D58). PROPRIEDADE que isto
// garante, e que separa este desenho da tentativa da D53: as leituras alternativas
// SO SE SOMAM a primaria, que fica intacta - nenhum caso que ja barra pode deixar
// de barrar; o unico risco e falso positivo, e ele foi medido em fix5-bancada.
// As alternativas so sao montadas quando o gatilho esta presente, entao o custo de
// um comando sem `(`, sem continuacao e sem `#` e IDENTICO ao da leitura de antes.
// D244/defeito 5: o corpo de um heredoc so e TEXTO quando quem o recebe e um escritor de
// texto (`cat`, `tee`) e nada o encaminha a outro programa. Para `bash`, `sh`, `ssh`,
// `python` ou por um cano, o corpo e executado e continua lido.
// D246 sec. 5 (T14 no teto): cada ronda achou um furo novo no filtro que lia comando de varias
// linhas (aspa aberta antes, `<<<`, `cat <<EOF > x.sh` e `bash x.sh` depois). Decisao do dono: o
// corpo so sai quando o comando INTEIRO e um unico `cat`/`tee` com heredoc e nada mais. Qualquer
// outra coisa no comando: le tudo, como o resto deste leitor (D67).
const ESCRITOR = /^(?:cat|tee)$/;
// O leitor de aspas da linha de abertura. O `<<` so abre heredoc FORA de aspa (T14 ronda 2). Leitor
// simples de proposito: o que ele nao entende (`$'...'`, crase, `$(`, `<(`, `>(`) vira duvida, e a
// duvida le tudo. Barra no fim da linha e continuacao: tambem le tudo.
function lerAspas(texto, est) {
  const t = texto.replace(/\r$/, '');
  est.continua = false;
  for (let k = 0; k < t.length; k++) {
    const c = t[k];
    if (est.q === "'") { if (c === "'") est.q = ''; continue; }
    if (c === '\\') { if (k === t.length - 1) est.continua = true; k++; continue; }
    if (c === '`' || (t[k + 1] === '(' && (c === '$' || c === '<' || c === '>'))) { est.duvida = true; continue; }
    if (est.q === '"') { if (c === '"') est.q = ''; continue; }
    if (c === '"') { est.q = '"'; continue; }
    if (c === "'") { if (t[k - 1] === '$') est.duvida = true; est.q = "'"; }
  }
  return est;
}
// As condicoes, todas obrigatorias - cada uma fecha uma forma que o bash executa (medido com `echo`):
//  1. a primeira linha nao vazia abre o heredoc: sem `<<<` (here-string), nenhum `;`, `&` ou `|`, o
//     primeiro token e `cat`/`tee`, e o leitor de aspas acha o `<<` fora de aspa e termina a linha
//     limpo;
//  2. o delimitador acaba em espaco, tab, `<`, `>` ou no fim da linha: o de `<<EOF"x"` e `EOFx`, nao
//     `EOF`. So espaco e tab: para o bash, espaco unicode e `\r` sao letra do delimitador;
//  3. delimitador sem aspas: o bash expande o corpo, entao `$(` e crase leem tudo (o `$((` e o `$[`
//     so executam com um dos dois dentro); e a barra invertida tambem, porque ela junta a linha
//     seguinte (`E\` + `OF` e o fechamento);
//  4. depois do PRIMEIRO fechamento, so linha em branco.
// Limite declarado: o arquivo escrito pode ser executado por OUTRO comando depois; isso ja nao e este.
function semCorpoDeHeredocInerte(cmd) {
  if (cmd.indexOf('<<') === -1) return cmd;
  const linhas = cmd.split('\n');
  const vazia = (l) => /^\s*$/.test(l);
  let a = 0;
  while (a < linhas.length && vazia(linhas[a])) a++;
  if (a === linhas.length) return cmd;
  const abertura = linhas[a].replace(/\r$/, '');
  if (/[;&|]|<<</.test(abertura)) return cmd;
  const m = /<<(-?)[ \t]*(['"]?)([A-Za-z_][\w.-]*)\2(?=[ \t<>]|$)/.exec(abertura);
  if (!m) return cmd;
  const antes = abertura.slice(0, m.index);
  if (!ESCRITOR.test(antes.trim().split(/\s+/)[0])) return cmd;
  // a linha inteira passa pelo leitor, entao a duvida de antes do `<<` ja aparece em `naLinha`
  const noOp = lerAspas(antes, { q: '', duvida: false });
  const naLinha = lerAspas(abertura, { q: '', duvida: false });
  if (noOp.q !== '' || naLinha.q !== '' || naLinha.duvida || naLinha.continua) return cmd;
  const fecha = (l) => { const s = l.replace(/\r$/, ''); return (m[1] ? s.replace(/^\t+/, '') : s) === m[3]; };
  let fim = a + 1;
  while (fim < linhas.length && !fecha(linhas[fim])) fim++;
  if (fim === linhas.length) return cmd;
  if (m[2] === '' && /[`\\]|\$\(/.test(linhas.slice(a + 1, fim).join('\n'))) return cmd;
  for (let j = fim + 1; j < linhas.length; j++) if (!vazia(linhas[j])) return cmd;
  return linhas.slice(0, a + 1).concat(linhas.slice(fim)).join('\n');
}

function lerTudo(cmd) {
  cmd = semCorpoDeHeredocInerte(cmd);
  const segmentos = lerComando(cmd, 0);
  // P0-1: comando dentro de `(...)`/`$(...)` em posicao de argumento.
  if (cmd.indexOf('(') !== -1 || cmd.indexOf(')') !== -1) {
    for (const s of lerComando(cmd, 0, { parenSepara: true })) segmentos.push(s);
  }
  // P0-2: `\`/crase + quebra lida como continuacao (bash) OU como fim de instrucao
  // (PowerShell). A leitura primaria junta; esta separa.
  if (/[`\\]\r?\n/.test(cmd)) {
    for (const s of lerComando(cmd, 0, { semContinuacao: true })) segmentos.push(s);
  }
  // D69/crase: substituicao de comando por crase do bash (`echo `rd -Recurse``).
  if (cmd.indexOf('`') !== -1) {
    for (const s of lerComando(cmd, 0, { craseSepara: true })) segmentos.push(s);
  }
  // D70/achado 3: `$(...)` - substituicao de comando do bash E subexpressao do
  // PowerShell. Dentro de aspas duplas de argumento de nao-introdutor as tres
  // regras de TOKEN vazavam porque o `$` fica sozinho no token 0. So o `$(` corta.
  if (cmd.indexOf('$(') !== -1) {
    for (const s of lerComando(cmd, 0, { dolarSepara: true })) segmentos.push(s);
  }
  // FIX22/F3: `{}` como ALVO - `find . -exec rm -rf {} \;`, `xargs -I{} rm -rf
  // {}`, e o `rm -rf {}` sozinho. Gatilho e o par COLADO no texto, entao o
  // custo de um comando sem `{}` e identico ao de antes.
  if (cmd.indexOf('{}') !== -1) {
    for (const s of lerComando(cmd, 0, { chaveVazia: true })) segmentos.push(s);
  }
  return segmentos;
}

function montar(texto, tokens, citados, nivel, semCmd0) {
  const posCmd = new Set();
  const lista = [];
  const cit = [];
  for (let k = 0; k < tokens.length; k++) {
    // `$null = rd src -Recurse` e `$null=rd src -Recurse`: depois da atribuicao
    // comeca comando novo.
    const m = /^\$[^={]*=(.*)$/.exec(tokens[k]);
    lista.push(tokens[k]);
    cit.push(citados[k]);
    if (m && m[1]) { posCmd.add(lista.length); lista.push(m[1]); cit.push(false); }
  }
  for (let k = 0; k < lista.length; k++) {
    // D74/P0: a CAUDA depois do `)` do `$(...)` (leitura dolarSepara) nao poe o
    // token 0 em posicao de comando - ela e resto da frase, nao comando novo.
    if (k === 0) { if (!semCmd0) posCmd.add(0); continue; }
    // D55: o `^` tambem e descascado AQUI, que e a comparacao que decide se o
    // token seguinte esta em posicao de comando. Sem isto `cmd /^c del /s /q
    // build` escapa a regra que `cmd /c del ^/s ^/q build` recebe.
    const ant = lista[k - 1];
    if (ant === '=' || INTRODUTOR.test(ant) || INTRODUTOR.test(nu(ant))) posCmd.add(k);
  }
  // D80/F1: `posAmpla` = `posCmd` MAIS o que um wrapper de processo abriu. Fica
  // num conjunto SEPARADO de proposito: so `achaCmd` (:achaCmd) le a versao
  // ampla; o gate da D68 no FUNDO continua lendo `posCmd`, que nao mudou.
  //
  // `posCam` e a fatia da regiao ampliada que veio da CONTINUACAO DE CAMINHO, e
  // nao de wrapper. Ela precisa existir separada porque so nela o descascamento
  // de caminho continua valendo (ver `achaCmd`): `Files/Git/cmd/git.exe` E o
  // nome do programa; `/opt/rm` em posicao de argumento e um caminho qualquer.
  const posAmpla = new Set(posCmd);
  const posCam = new Set();
  for (let k = 0; k < lista.length; k++) {
    if (!posAmpla.has(k)) continue;
    if (abreResto(lista[k])) {
      // D80/R1: token CITADO nao entra na regiao ampliada. `"erase"` em
      // `-Pattern "erase"` e string, nao comando. Nao se perde comando
      // aninhado de verdade: `bash -c "rd src -Recurse"` e RELIDO no bloco
      // FUNDO (em `lerComando`), e la os tokens de dentro sao NAO citados.
      for (let j = k + 1; j < lista.length; j++) if (!cit[j]) posAmpla.add(j);
      // O `break` E CARGA ESTRUTURAL, nao economia de laco - documentado aqui
      // porque nada dizia, e a proxima passada de limpeza tenderia a remove-lo.
      // Ele impede que `posCam` seja calculado DENTRO da regiao aberta por
      // wrapper. Sem ele, o laco seguiria e o ramo de continuacao de caminho
      // (abaixo) passaria a rodar sobre tokens que ja estao em `posAmpla` por
      // serem argumento de wrapper - e `posCam` e exatamente o conjunto onde o
      // descascamento de CAMINHO volta a valer (`plena` em `achaCmd`), que a
      // D80/R3 restringiu para fechar 130 falsos positivos como
      // `sudo chmod -R 755 /opt/rm` e `wsl ls -R /usr/bin/rm`.
      // Medido: `./a/ ./b/rm -R` da `posCam=[1]` (sem wrapper, correto);
      // `sudo ./a/ ./b/rm -R` da `posCam=[]` - e e o `break` que garante isso.
      break;
    }
    // Caminho nao citado com espaco no meio: `C:/Program` + `Files/.../git.exe`.
    // Exige separador de caminho DOS DOIS LADOS - assim `./build.sh rd -Recurse`
    // nao poe `rd` em posicao de comando.
    if (CAMINHO.test(lista[k]) && k + 1 < lista.length && CAMINHO.test(lista[k + 1])) {
      posAmpla.add(k + 1);
      posCam.add(k + 1);
    }
  }
  const semAspas = lista.map(function (t) {
    return /\s/.test(t) ? '"' + t + '"' : t;
  }).join(' ');
  return { texto: texto.trim(), semAspas: semAspas, tokens: lista, citados: cit, posCmd: posCmd, posAmpla: posAmpla, posCam: posCam, nivel: nivel };
}

// D80/F1: o token esta na lista de wrappers? Compara tambem sem o `^` e pelo
// nome final do caminho, pelo mesmo motivo de `nomeCmd` (:nomeCmd).
// Aqui o descascamento de caminho vale (`plena = true`), e de proposito:
// `/usr/bin/env rd /s /q build` tem de abrir igual a `env rd /s /q build`. E
// seguro porque a lista e de NOMES DE PROGRAMA - abrir e o unico efeito, e
// quem decide o veredito continua sendo `achaCmd` mais `corrobora`.
function abreResto(t) {
  if (typeof t !== 'string' || t === '') return false;
  const cand = [t, nu(t), nomeCmd(t, true), nomeCmd(nu(t), true)];
  for (const c of cand) {
    const b = c.toLowerCase();
    if (ABRE_RESTO.has(b) || ABRE_RESTO.has(b.replace(/\.exe$/, ''))) return true;
  }
  return false;
}

// ---------------------------------------------------------------- as regras

// D47/D50: opcao global do git entre o `git` e o subcomando, e o sufixo `.exe`.
// D420/SH-01: o `semAspas` (lerComando) so tira a aspa do token SEM espaco; token com espaco
// dentro continua entre aspas, e o `\S*` de antes quebrava nele - `git -C "a b" reset --hard`,
// `git -c user.name="A B" push -f` e o executavel citado `"C:\Program Files\Git\cmd\git.exe"` escapavam
// de todas as regras do git. Agora o valor da opcao (e a opcao) aceita trechos entre aspas inteiros;
// a aspa SEM par vira caractere comum (alternativas disjuntas pela antecipacao: custo linear,
// medido a mao na s63 - 4x de entrada custou ~4x de tempo; nenhum teste do repo mede o tempo da regex GIT).
// O texto citado continua sendo classificado como antes (D48): so a cadeia de opcoes ficou mais larga.
const ASPA_OU_LETRA = '(?:"[^"]*"|\'[^\']*\'|"(?![^"]*")|\'(?![^\']*\')|[^\\s"\'])+';
const GIT = '\\bgit(?:\\.exe)?["\']?\\s+(?:-' + ASPA_OU_LETRA + '(?:\\s+(?!-)' + ASPA_OU_LETRA + ')?\\s+)*';

// A1-02 (revisao completa, L1): o git e o GNU rm aceitam abreviacao unica de opcao longa (`--har` e o `--hard`); a
// D431 escreveu os prefixos a mao para o `clean --force`. Aqui eles saem do nome: abrev('hard') = 'h(?:a(?:r(?:d)?)?)?'.
// Prefixo ambiguo (`push --d`: delete ou dry-run) o proprio programa recusa, entao casa-lo nao barra comando que roda.
function abrev(nome) {
  let s = '';
  for (let i = nome.length - 1; i > 0; i--) s = '(?:' + nome[i] + s + ')?';
  return nome[0] + s;
}

// A1-03 (revisao completa, L1): a arvore inteira tambem se escreve `./`, `:/` (raiz do repositorio) e `*`.
const ARVORE = '(?:\\.|\\./|:/|\\*)';

// D49: o subcomando tem de ser um token COMPLETO - `rebase.autoStash` e
// configuracao publicada do git, e o `.` e fronteira de palavra.
const FIM = '(?=[\\s;|&]|$)';

// D81/F4: o resto do segmento, entre o `push` e o token que apaga. E o mesmo
// `SEG` do fix round 4, reposto SO para a regra de texto de `apaga referencia
// no remoto` (ver REGRAS). As outras regras continuam com os DOIS testes
// independentes que a D51 desenhou: o custo quadratico que a D51 evitou vinha
// de usar `SEG` em TODAS elas, nao em uma. Medido nesta rodada com `ataque.js`:
// 23/23 conforme, nenhum divergente, e o pior caso ficou igual ao de antes
// (`git a ` x 20000: 40 ms contra 46 ms do estado anterior).
const SEG = '[^\\n;|&]*';

// D47: no PowerShell o parametro liga por prefixo. `-Recurse` aceita de `-R` em
// diante; `-Force` so a partir de `-Fo`, porque `-F` e ambiguo com `-Filter`.
// D244/defeito 12: `-Confirm:$false` pula a confirmacao humana e conta como forcado, em
// paridade com `rm -f` (decisao do dono, D244 4.1).
const PS_FLAG = /^-(?:R(?:e(?:c(?:u(?:r(?:s(?:e)?)?)?)?)?)?|Fo(?:r(?:c(?:e)?)?)?|Confirm:\$false)\b/i;
const PS_FLAG_TXT = /-(?:R(?:e(?:c(?:u(?:r(?:s(?:e)?)?)?)?)?)?|Fo(?:r(?:c(?:e)?)?)?|Confirm:\$false)\b/i;

// D50/D51: o sufixo `.exe` vale para o apelido tambem, nao so para o `git`.
const APELIDO = /^(?:del|erase|rd|ri|rm|rmdir)(?:\.exe)?$/i;
const APELIDO_CMD = /^(?:rmdir|rd|del|erase)(?:\.exe)?$/i;
// D67: o shell `cmd`/`cmd.exe` - o unico onde `#` NAO e comentario. Escopa a
// releitura com `#` literal ao vetor medido (`cmd /c "..."`), sem tocar `bash -c`.
const CMD_EXE = /^cmd(?:\.exe)?$/i;
const APAGA_REF = new RegExp('^(?:-d|--' + abrev('delete') + '|--' + abrev('mirror') + '|--' + abrev('prune') + ')$', 'i');

// D54: o `^` e o escape do cmd (`del ^/s ^/q build` executa `del /s /q build`),
// mas no PowerShell e no bash ele e literal - e la o separador colado nele
// SEPARA de verdade. Como o portao nao sabe qual shell vai executar, o `^` e
// descascado so aqui, na comparacao, e NUNCA no leitor: assim ele so pode fazer
// barrar mais, nunca mudar onde um comando comeca ou termina.
function nu(t) { return t.indexOf('^') === -1 ? t : t.replace(/\^/g, ''); }

// D80/F4+F7: o NOME do comando dentro do token, descascado no MESMO ponto e
// pelo MESMO motivo do `nu()` - na COMPARACAO, nunca no leitor. Assim ele so
// pode fazer barrar mais, e nunca muda onde um comando comeca ou termina.
//
// DE PROPOSITO nao injeta token nenhum em `lista`: a injecao da atribuicao
// (o laco inicial de `montar`) entra em `semAspas`, e um token sintetico ali cria ADJACENCIA que nao
// existe no texto real - medido: com a atribuicao generalizada,
// `alias z='rm -rf'; z build` passava a casar a regra 1 por `z=rm rm -rf`, um
// bloqueio por acidente de texto, nao por posicao de comando. Descascar na
// comparacao nao tem esse efeito.
//
// As cascas, todas medidas na varredura, na ordem em que o shell as remove:
//  - `%VAR:~0,0%del` (F7): substring de comprimento zero do cmd.exe expande
//    para NADA e o `del` colado passa a ser o comando (provado em cmd real).
//    O `(.+)` devolve o token INTACTO quando nao sobra nome depois do segundo
//    `%`. Isso e defesa, NAO e trava: medido por mutacao, trocar `(.+)` por
//    `(.*)` da o mesmo veredito em toda a varredura, porque nenhum padrao de
//    regra casa a string vazia. O que mantem `set A=rd` + `%A% /s /q build`
//    PASSANDO - e ele TEM de continuar passando, e limite declarado - sao
//    outras duas coisas, medidas na sonda: a quebra de linha corta o segmento
//    (`rd` e `/s` nunca ficam no mesmo segmento) e `A=rd` nao esta em posicao
//    de comando, porque `set` nao e wrapper. O fix4 so barra ali porque le o
//    VALOR da atribuicao, nao um comando.
//  - `-NoProfile,-Command,rd` (F1): a lista de argumentos do PowerShell vem
//    colada por virgula e o INTRODUTOR fica no campo anterior. Exige o
//    INTRODUTOR literal antes da ultima virgula - nao e "toda virgula abre
//    comando".
//  - `CommandLine=rd`, `z=rd`, `alias.z=!git` (F1): o comando depois do `=`,
//    em `@{CommandLine="..."}`, `doskey z=...` e `git config alias.z ...`.
//  - `!git` (F1): o `!` do alias do git e do escape de shell do vim
//    (`vim -c "!rd /s /q build"`).
//  - `/usr/bin/git`, `Files/Git/cmd/git.exe` (F4): o caminho. O sufixo `.exe`
//    ja esta nos proprios padroes (`APELIDO`, `GIT`), entao nao se descasca
//    aqui. CONTRASTE que isola a causa: `/usr/bin/git reset --hard` ja barrava
//    pela regra de TEXTO (`\b`); so as regras `fn:` caiam.
// D80/R3: `plena` diz se o token esta em posicao de comando DE VERDADE
// (`posCmd`) ou numa continuacao de caminho (`posCam`). So ai o descascamento
// de CAMINHO vale. Na regiao aberta por wrapper o token e argumento ate prova
// em contrario, e caminho em posicao de argumento e caminho: sem esta trava,
// `sudo chmod -R 755 /opt/rm` e `wsl ls -R /usr/bin/rm` viravam falso positivo,
// porque `nomeCmd` lia `rm` no fim do caminho. As outras cascas (`%VAR%`, a
// virgula com INTRODUTOR, o `=` e o `!`) continuam valendo nos dois casos:
// todas exigem sintaxe que so aparece de proposito.
function nomeCmd(t, plena) {
  // Atalho que NAO muda veredito: toda casca abaixo exige um destes bytes, e
  // sem nenhum deles a funcao devolveria o proprio token. Vale porque
  // `achaCmd` compara token a token, e o pior caso do `ataque.js` tem dezenas
  // de milhares de tokens: sem o atalho, `git a ` x 20000 sobe de 27 ms para
  // 55 ms; com ele volta ao patamar de antes.
  if (!CASCA.test(t)) return t;
  let s = t;
  const mv = /^%[^%]*%(.+)$/.exec(s);
  if (mv) s = mv[1];
  if (s.indexOf(',') !== -1) {
    const p = s.split(',');
    const ult = p[p.length - 1];
    const ant = p[p.length - 2];
    if (ult && (INTRODUTOR.test(ant) || INTRODUTOR.test(nu(ant)))) s = ult;
  }
  const ma = /^[^\s={]*=(.+)$/.exec(s);
  if (ma) s = ma[1];
  if (s.length > 1 && s[0] === '!') s = s.slice(1);
  if (!plena) return s;
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i === -1 ? s : s.slice(i + 1);
}

// Devolve ONDE o nome do comando casou, nao so SE casou: `corrobora` precisa do
// indice para exigir que a flag venha depois dele na regiao ampliada.
function achaCmd(seg, teste) {
  const ampla = seg.posAmpla || seg.posCmd;
  for (const k of ampla) {
    const t = seg.tokens[k];
    if (t === undefined) continue;
    const plena = seg.posCmd.has(k) || (seg.posCam ? seg.posCam.has(k) : false);
    if (teste.test(t) || teste.test(nu(t)) ||
        teste.test(nomeCmd(t, plena)) || teste.test(nomeCmd(nu(t), plena))) {
      return { k: k, plena: plena };
    }
  }
  return null;
}

function comandoE(seg, teste) { return achaCmd(seg, teste) !== null; }

// D80/R2: A CORROBORACAO. Tem de vir de OUTRO token - sempre - e, quando o nome
// veio da regiao ampliada, tem de vir DEPOIS dele.
//
// Por que "outro token": em `sudo cp /s/rd /tmp` o MESMO token `/s/rd` dava o
// nome (`rd`, pelo descascamento de caminho) e a flag (`/s`). Um token nao
// corrobora a si mesmo.
//
// Por que "depois", e so na regiao ampliada: num comando de verdade a flag vem
// depois do nome - `rd /s /q build`, `ri -Recurse -Force dist`. Quando ela vem
// ANTES, ela e flag de OUTRO programa e o nome e argumento dele:
// `xargs -r grep -n rm`, `chmod -R 755 /opt/rm`, `ls -R /usr/bin/rm`. Em
// `posCmd` a regra segue como a D51 desenhou (corroboracao em qualquer lugar do
// segmento), porque ali o nome ja e evidencia forte - e e o que os 57 casos de
// NAO REGREDIR medem. A assimetria e o ponto: quanto mais fraca a posicao,
// mais forte a corroboracao exigida.
function corrobora(seg, teste, achado) {
  const de = achado.plena ? 0 : achado.k + 1;
  for (let k = de; k < seg.tokens.length; k++) {
    if (k === achado.k) continue;
    const t = seg.tokens[k];
    if (teste.test(t) || teste.test(nu(t))) return true;
  }
  return false;
}

// D51: o apelido do PowerShell so conta em POSICAO DE COMANDO. Antes o
// ancoradouro era um lookbehind de texto, que nao sabia a diferenca entre
// `rd src -Recurse` e `-Pattern del -Recurse`.
function apelidoPS(seg) {
  const a = achaCmd(seg, APELIDO);
  return a !== null && corrobora(seg, PS_FLAG, a);
}

// A1-01/A1-02 (revisao completa, L1): o GNU rm aceita a opcao em qualquer posicao (`rm dist -rf`, `rm --verbose -rf x`)
// e a opcao longa abreviada (`--rec`, `--forc`); a regra de texto so lia `-letras` logo depois do `rm`. Lido por token,
// no molde do `apelidoPS`: `rm` em posicao de comando e outro token que seja opcao recursiva ou forcada. Como na regra
// de texto: o `^` no nome nao conta (limite declarado da D54) e sem alvo e prosa (`grep -rn "rm -rf" .`, FIX22/F3).
const RM_OPCAO = new RegExp('^(?:-(?!-)[a-zA-Z]*[rRf][a-zA-Z]*|--' + abrev('recursive') + '|--' + abrev('force') + ')$');
function rmForcado(seg) {
  const a = achaCmd(seg, /^rm(?:\.exe)?$/i);
  if (a === null || seg.tokens[a.k].indexOf('^') !== -1 || !corrobora(seg, RM_OPCAO, a)) return false;
  for (let k = a.k + 1; k < seg.tokens.length; k++) if (seg.tokens[k][0] !== '-') return true;
  return false;
}

// D50/D51: a forma do cmd (`rd /s /q build`), agora tambem em posicao de comando.
// O `(?![a-z])` deixa passar `/s` e `/s/q` (as duas formas que o cmd aceita) e
// nao casa `/src`, que e caminho e nao chave.
function formaCmd(seg) {
  const a = achaCmd(seg, APELIDO_CMD);
  return a !== null && corrobora(seg, /^\/s(?![a-z])/i, a);
}

// D50/D51: apagar referencia no remoto. Quem decide e o TOKEN: `-d`, `--delete`,
// `--mirror`, `--prune`, um refspec que COMECA com `:` (apaga o ref do outro
// lado) ou com `+` (push forcado). `HEAD:refs/for/main` e `main:main` nao
// comecam com `:`, e continuam passando.
function apagaRemoto(seg) {
  if (!comandoE(seg, /^git(?:\.exe)?$/i)) return false;
  // D55: o token comparado literalmente tambem descasca o `^`. O `findIndex` vai
  // SOZINHO, nunca como reserva de um `indexOf`: quando nao ha `^`, `nu(t) === t`,
  // entao ele ja faz tudo o que o `indexOf` fazia. Com o `indexOf` na frente,
  // bastava existir um token literalmente `push` DEPOIS do destrutivo para o laco
  // comecar tarde demais - `git ^push origin --delete main push` escapava.
  const iPush = seg.tokens.findIndex(function (t) { return nu(t) === 'push'; });
  if (iPush === -1) return false;
  for (let k = iPush + 1; k < seg.tokens.length; k++) {
    const t = seg.tokens[k];
    if (APAGA_REF.test(t) || APAGA_REF.test(nu(t))) return true;
    const tn = nu(t);
    if ((tn[0] === ':' || tn[0] === '+') && tn.length > 1) return true;
  }
  return false;
}

// S1/L1-1: flags de `git checkout` que nao tiram o `.` do alvo e nao mudam o descarte.
const CHECKOUT_FLAG = '(?:-[fq]+|--(?:force|ours|theirs|quiet|no-overlay|overlay|ignore-skip-worktree-bits))';

// S1/H-1, D428: `git restore --staged .` (ou `-S`) so desfaz o stage: o working tree nao muda. Regra ESTRITA,
// ancorada no subcomando: o segmento abre com `git` (opcoes globais `-C <dir>`/`-c k=v` aceitas), depois
// `restore`, UMA OU MAIS `--staged`/`-S`, um `--` isolado opcional e o `.` final - nada alem de espaco.
// Qualquer outra coisa barra (wrapper `sudo -S`/`ssh -S`, `-W`, `--source`, `restore` repetido...). O texto
// citado vira `""` antes, para valor entre aspas (`-C "a b"`) ser um token so.
// D442/1: `-q`/`--quiet` (sozinho ou agrupado ao `-S`, ex. `-Sq`) nao muda o efeito; o `--staged`/`-S` tem de
// estar nas opcoes capturadas - `-q .` sozinho descarta a arvore.
const SO_INDICE = /^\s*git(?:\.exe)?\s+(?:-[Cc]\s+\S+\s+)*restore\s+((?:(?:--staged|--quiet|-[Sq]+)\s+)+)(?:--\s+)?(?:\.\/?|:\/|\*)\s*$/;
function soIndice(t) {
  const m = SO_INDICE.exec(t.replace(/"[^"]*"|'[^']*'/g, '""'));
  return !!m && /(?:^|\s)(?:--staged|-q*S)/.test(m[1]);
}

// D442/1 (S-3, S-52): flags do `restore` que nao tiram o `.` do alvo e nao mudam o descarte. Lista fechada, como
// a do checkout: `-p`/`--patch` (interativo) nao entra. O git aceita abreviacao unica de opcao longa - o
// `--worktree` e o `--quiet` vao por prefixo (`--w`, `--work`, `--q`).
const RESTORE_FLAG = '(?:--staged|--source=' + ASPA_OU_LETRA + '|--source\\s+' + ASPA_OU_LETRA + '|-s\\s+' + ASPA_OU_LETRA +
  '|-[SWqm]+|--w(?:o(?:r(?:k(?:t(?:r(?:ee?)?)?)?)?)?)?|--q(?:u(?:i(?:et?)?)?)?|--ours|--theirs|--merge|--conflict=\\S+' +
  '|--ignore-unmerged|--ignore-skip-worktree-bits|--(?:no-)?(?:overlay|progress|recurse-submodules)|--)';

// D429/1: `git clean -n`/`--dry-run` (inclusive agrupado: `-nfd`, `-dn`) so lista o que apagaria. O `n` depois de um
// `e` no aglomerado (`-en`) e o padrao do `-e`, nao dry-run.
// s62: lido token a token, so como OPCAO do clean - citado vira `""`, o `--` encerra as opcoes (o resto e pathspec)
// e o token depois de `-e`/`--exclude` (ou de aglomerado terminado em `e`) e o padrao, nao opcao. O git aceita
// abreviacao unica de opcao longa: `--d`/`--dry` sao o `--dry-run` e `--e`/`--exc` o `--exclude`.
// D431: vale a ULTIMA opcao, como no git - `--no-dry-run` (ou `--no-d`) depois do `-n` volta a apagar.
function dryRunClean(t) {
  const toks = t.replace(/"[^"]*"|'[^']*'/g, '""').split(/\s+/);
  const i = toks.findIndex(function (x) { return /^clean$/i.test(x); });
  if (i === -1) return false;
  let dry = false;
  for (let k = i + 1; k < toks.length; k++) {
    const x = toks[k];
    if (x === '--') break;
    const longa = /^--([a-z-]+)$/.exec(x);
    if (longa && 'dry-run'.indexOf(longa[1]) === 0) { dry = true; continue; }
    if (longa && longa[1].length > 3 && 'no-dry-run'.indexOf(longa[1]) === 0) { dry = false; continue; }
    if (longa && 'exclude'.indexOf(longa[1]) === 0) { k++; continue; }
    if (!/^-[a-zA-Z]+$/.test(x)) continue;
    const e = x.indexOf('e');
    const n = x.indexOf('n');
    if (n !== -1 && (e === -1 || n < e)) dry = true;
    if (e === x.length - 1) k++;
  }
  return dry;
}

// Piso built-in. O projeto acrescenta o que for dele em projeto.json.
// `semAspas: true` faz a regra rodar tambem sobre o segmento com as aspas de
// token removidas (D50): e assim que `git re""set --hard` vira `git reset --hard`.
// D51: quem antes usava um `SEG` no meio ("o nome, depois qualquer coisa, depois
// a flag") virou DOIS testes independentes (`re` e `e`) sobre o mesmo segmento.
// Como o leitor ja garante que o segmento e UM comando, "os dois aparecem no
// mesmo segmento" e a leitura certa - e o custo deixa de ser quadratico.
const REGRAS = [
  { re: /\brm\s+(-[a-zA-Z]*\s+)*-?[a-zA-Z]*[rf][a-zA-Z]*\s+\S/i, semAspas: true, motivo: 'rm recursivo ou forcado' },
  { re: /\brm\b/i, e: /--(recursive|force)(?![\w-])/i, semAspas: true, motivo: 'rm recursivo ou forcado' },
  { fn: rmForcado, motivo: 'rm recursivo ou forcado' },
  { re: /\bRemove-Item\b/i, e: PS_FLAG_TXT, motivo: 'Remove-Item recursivo ou forcado' },
  { fn: apelidoPS, motivo: 'apelido do PowerShell para Remove-Item, recursivo ou forcado' },
  { fn: formaCmd, motivo: 'forma do cmd: apaga a arvore inteira' },
  { re: new RegExp(GIT + 'reset\\s+--' + abrev('hard') + '(?![\\w-])', 'i'), semAspas: true, motivo: 'git reset --hard descarta trabalho nao commitado' },
  // D420/SH-03: `--force` por extenso tambem apaga (so `-f` agrupado era lido).
  // D429/1: a flag que apaga (-f/-d/-x agrupada ou --force) pode vir depois de outra opcao (`-q -fd`, `-e x -fd`);
  // `libera` tira o dry-run (`-n`, `-nfd`, `--dry-run`), que so lista. `-en`: o `n` e o valor do `-e`, nao dry-run.
  // D431: `--force` abreviado (`--f`, `--fo`, `--forc`) tambem apaga - o git aceita abreviacao unica.
  { re: new RegExp(GIT + 'clean' + FIM + SEG + '\\s(?:-[a-zA-Z]*[fdx]|--f(?:o(?:r(?:ce?)?)?)?' + FIM + ')', 'i'), libera: dryRunClean, semAspas: true, motivo: 'git clean apaga arquivo nao rastreado' },
  // D420/SH-04: alem de `checkout -- .`, descartam a arvore inteira `checkout .`, `checkout HEAD -- .`
  // e `checkout <ref> -- .`. Todas as formas exigem que o `.` seja um token (D433: a forma `-- .` tambem,
  // senao `git checkout -- .gitignore` e `./src/a.js` virariam falso positivo).
  // S1/L1-1: as flags que nao mudam o efeito (`-f`, `--force`, `--ours`, `--theirs`, `-q`...) podem vir antes
  // do `.`; `git checkout -f .` e `--ours .` descartam a arvore como `checkout -- .`. Lista fechada, nao
  // `-\S+`: `-b nova .` e `-p .` (interativo) nao entram.
  // D429/1: `checkout -f <ramo>`/`--force <ramo>` (e `<ramo> -f`) joga fora as mudancas locais ao trocar. A flag so conta
  // antes do `--` (depois dele e pathspec: `checkout -- -f` e um arquivo).
  { re: new RegExp(GIT + 'checkout\\s+(?:(?!--(?:\\s|$))[^\\s;|&]+\\s+)*(?:-[a-zA-Z]*f[a-zA-Z]*|--' + abrev('force') + ')' + FIM, 'i'), semAspas: true, motivo: 'git checkout -f descarta mudancas locais' },
  { re: new RegExp(GIT + 'checkout\\s+(?:' + CHECKOUT_FLAG + '\\s+)*(?:--\\s+' + ARVORE + FIM + '|(?:[^\\s;|&-]\\S*\\s+)?(?:--\\s+)?' + ARVORE + FIM + ')', 'i'), semAspas: true, motivo: 'git checkout . (ou git checkout -- .) descarta todas as mudancas' },
  // D420/SH-04: `restore` aceita `--`, `--worktree`, `--source=X`, `--source X`, `-s X`, `-S`, `-W` antes do `.`.
  // S1/L1-1: `-SW` agrupado e valor entre aspas (`--source "a b"`) tambem. S1/H-1: so o indice (`--staged`/`-S`
  // sem `--worktree`/`-W`) nao perde trabalho - `libera` tira essa forma (ver `soIndice`).
  // D442/1: as flags que nao mudam o descarte (`-q`, `--ours`, `--work`...) estao em RESTORE_FLAG.
  { re: new RegExp(GIT + 'restore\\s+(?:' + RESTORE_FLAG + '\\s+)*' + ARVORE + '(\\s|$)', 'i'), libera: soIndice, semAspas: true, motivo: 'git restore . descarta todas as mudancas' },
  // D420/SH-04: `switch -f`/`--force`/`--discard-changes` jogam fora as mudancas locais ao trocar de branch.
  // s62: `-f` agrupado (`-fq`, `-fc`, `-qf`) tambem, como no checkout.
  { re: new RegExp(GIT + 'switch' + FIM + SEG + '\\s(?:-[a-zA-Z]*f[a-zA-Z]*|--' + abrev('force') + '|--' + abrev('discard-changes') + ')(?![\\w-])', 'i'), semAspas: true, motivo: 'git switch forcado descarta mudancas locais' },
  // D420/SH-03: `-f` agrupado a outras flags curtas (`-fu`, `-uf`, `-vf`) tambem forca o push.
  // S1/L1-2: sem `i` (git distingue `-F` de `-f`) e o aglomerado so vale se TODAS as letras forem flag curta do
  // push (f n d u q v o 4 6): `-fix` e argumento, nao flag. O `(?=...)` valida o aglomerado inteiro e o
  // `[^f\s]*f` acha o primeiro `f` - uma corrida so, linear (antes eram duas em volta do `f`: 30000 letras = 2,8 s).
  { re: new RegExp(GIT + 'push' + FIM, 'i'), e: /(\s--force(-with-lease)?\b|\s-(?=[fnduqvo46]+(?![\w-]))[^f\s]*f)/, semAspas: true, motivo: 'push forcado reescreve historico remoto' },
  // D81/F4: `apaga referencia no remoto` VOLTA A TER TAMBEM A FORMA DE TEXTO
  // DO FIX ROUND 4, ao lado da regra de token. As duas SOMAM - `lerTudo` une as
  // leituras e barra se qualquer uma barrar.
  //
  // O NUMERO QUE DECIDIU: o fix round 1 desta tarefa fechou 130 falsos
  // positivos apertando a fatia aberta por wrapper com R1/R2/R3, e com isso
  // criou 103 falsos NEGATIVOS - `sudo /usr/bin/git push origin --delete main`
  // passava, e o fix round 4 barra. Medido COM DENOMINADOR: as 5 cargas de
  // APELIDO do corpus `fix5-bancada/fn-wrapper.js` tem denominador ZERO (o fix
  // round 4 nao barra `sudo /usr/bin/rd /s /q build`), entao os 103 sao TODOS
  // de `apagaRemoto` - nenhum e de `apelidoPS` nem de `formaCmd`.
  //
  // E `apagaRemoto` e a UNICA das quatro regras `fn:` que o fix round 4
  // implementa como regex de TEXTO contigua. Regra de texto com `\b` atravessa
  // wrapper, caminho e - por `semAspas` - aspa. E exatamente por isso que
  // `/usr/bin/git reset --hard` NUNCA regrediu enquanto o irmao `--delete`
  // regrediu: a D50/D51 converteu um para token e deixou o outro em texto, e a
  // troca nunca foi medida contra a regua.
  //
  // POR QUE NAO afrouxar R1/R3 "por regra", que era o candidato desta rodada:
  // medido, ele zera o portao de falso negativo e passa nos DOIS portoes de
  // falso positivo que ja existiam - e mesmo assim cria 279 falsos positivos no
  // corpus que varia os ingredientes DESTA regra
  // (`fix5-bancada/fp-apagaremoto.js`), como `sudo ls -l /usr/bin/git push -d`
  // e `sudo grep -rn "git" push -d skip`. A premissa "a corroboracao de
  // apagaRemoto e muito mais forte" so vale para o vocabulario da REGUA: o vivo
  // tambem aceita `-d`, `--prune` e `+ref` sem letra, que sao flags comuns de
  // OUTROS programas. Restaurar a regra da regua nao toca em R1/R2/R3, entao os
  // 130 falsos positivos da rodada anterior nao podem reabrir - isto esta
  // medido.
  //
  // O QUE NAO SE PODE AFIRMAR (corrigido no fix round 3): "e o que estas duas
  // linhas casam, a regra identica da regua tambem casa". A regra e a mesma, o
  // TEXTO em que ela roda nao e. `casa()` aplica as regras sobre `seg.texto` e
  // `seg.semAspas`, que sao strings DERIVADAS pelo leitor daqui - e o leitor da
  // regua e outro. Dois casos medidos em que este portao barra e a regua passa:
  //   echo git push origin <# ; #> --delete main    fix4=passa r1=passa vivo=BARRA
  //   echo "git" "" push --delete x                 fix4=passa r1=passa vivo=BARRA
  // No primeiro o comentario de bloco vira um espaco e o `;` que o SEG da regua
  // nao atravessa e engolido; no segundo `semAspas` rejunta os tokens apagando o
  // argumento citado vazio. Sao DOIS falsos positivos NOVOS contra a regua,
  // criados por esta regra - rebuscados e inofensivos (`echo`), aceitos, mas
  // aceitos por medicao, nao por uma equivalencia que nao existe.
  //
  // SAO DUAS ENTRADAS, e a segunda nao e enfeite: com so a primeira sobravam
  // 104 falsos negativos na grafia `+refspec` (`push origin +main:main`), que
  // NENHUM portao obrigatorio media. Quem os achou foi o bloco [FN-VOCAB] do
  // corpus novo, escrito depois de perguntar o que este conserto passou a
  // discriminar - o token que apaga.
  //
  // O `fn: apagaRemoto` continua abaixo e NAO e redundante: ele cobre `-d` e
  // `--prune`, que a regua nao tem.
  { re: new RegExp(GIT + 'push' + FIM + SEG + '\\s(?::[A-Za-z]|--' + abrev('delete') + '(?![\\w-])|--' + abrev('mirror') + '(?![\\w-]))', 'i'), semAspas: true, motivo: 'apaga referencia no remoto' },
  { re: new RegExp(GIT + 'push' + FIM + SEG + '\\s\\+(?=[^\\s]*[A-Za-z/])[^\\s]+', 'i'), semAspas: true, motivo: 'apaga referencia no remoto' },
  { fn: apagaRemoto, motivo: 'apaga referencia no remoto' },
  // Sem `i` de proposito: `-d` apaga branch ja mesclada e e seguro; `-D` nao.
  { re: new RegExp(GIT + 'branch\\s+-D\\b'), semAspas: true, motivo: 'apaga branch sem conferir merge' },
  // A1-05 (revisao completa, L1): `-d` com `-f` e o mesmo que `-D` (`git branch --delete --force x` apaga sem conferir
  // merge), agrupados ou nao. Dois testes independentes sobre o segmento, como a D51 desenhou.
  { re: new RegExp(GIT + 'branch' + FIM + SEG + '\\s(?:-[a-zA-Z]*d[a-zA-Z]*|--' + abrev('delete') + ')' + FIM),
    e: new RegExp('\\s(?:-[a-zA-Z]*f[a-zA-Z]*|--' + abrev('force') + ')' + FIM), semAspas: true, motivo: 'apaga branch sem conferir merge' },
  { re: new RegExp(GIT + '(rebase|filter-branch)' + FIM, 'i'), semAspas: true, motivo: 'reescreve historico' },
  { re: /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i, semAspas: true, motivo: 'DDL destrutivo' },
  { re: /\bTRUNCATE\s+TABLE\b/i, semAspas: true, motivo: 'TRUNCATE apaga a tabela inteira' },
  { re: /\bnpm\s+publish\b/i, semAspas: true, motivo: 'publicacao nao pedida' },
  { re: /\b(mkfs|dd\s+if=)/i, semAspas: true, motivo: 'escrita direta de disco' },
  // A1-04 (revisao completa, L1): o `dd` aceita os operandos em qualquer ordem (`dd of=/dev/sda if=img`).
  { re: /\bdd\s/i, e: /\sof=/i, semAspas: true, motivo: 'escrita direta de disco' }
];

function extras(projeto) {
  const lista = (projeto && projeto.comandosBloqueados) || [];
  const compiladas = [];
  for (const padrao of lista) {
    try { compiladas.push({ re: new RegExp(padrao, 'i'), motivo: 'regra do projeto: ' + padrao }); }
    catch (e) { /* padrao invalido no projeto.json nao pode derrubar o portao */ }
  }
  return compiladas;
}

function casa(r, seg) {
  if (r.fn) return r.fn(seg);
  // S1/H-1: `libera` e a excecao da regra (forma inofensiva que o `re` ainda casa).
  const bate = (t) => r.re.test(t) && (!r.e || r.e.test(t)) && !(r.libera && r.libera(t));
  if (bate(seg.texto)) return true;
  if (r.semAspas && seg.semAspas !== seg.texto && bate(seg.semAspas)) return true;
  return false;
}

function classificar(comando, projeto) {
  const cmd = String(comando == null ? '' : comando);
  if (!cmd.trim()) return { destrutivo: false, motivo: null };
  const segmentos = lerTudo(cmd);
  for (const seg of segmentos) {
    for (const r of REGRAS) {
      if (casa(r, seg)) return { destrutivo: true, motivo: r.motivo };
    }
  }
  // Regra do projeto roda sobre o comando inteiro, como sempre rodou: o dono
  // escreve o padrao contra o comando que ele ve, nao contra o segmento.
  for (const r of extras(projeto)) {
    if (r.re.test(cmd)) return { destrutivo: true, motivo: r.motivo };
  }
  return { destrutivo: false, motivo: null };
}

function motivo(comando, r) {
  // Plano 082, Tarefa 5 (mock S10): a forma unica dos avisos. A liberacao fica por ultimo, como acao do dono.
  return [
    'sworn - comando destrutivo barrado (trava 5): falta o sim do dono.',
    '',
    'Comando: ' + escopo.ascii(String(comando).slice(0, 400)),
    // O MOTIVO tambem e higienizado (D64). Ate a ronda 7 so o comando era, e
    // `extras()` monta `regra do projeto: <padrao>` a partir do `projeto.json`,
    // que e texto arbitrario do dono - um padrao com acento vazava `c-cedilha`
    // e `a-til` para o texto do hook, violando a R5. Acento em portugues e o
    // caso normal, nao o exotico, e os dois testes de ASCII que ja existiam
    // eram cegos a este caminho porque so exercitavam motivo built-in.
    'Por que barrou: ' + escopo.ascii(String(r.motivo).slice(0, 400)) + '.',
    'Nenhum comando destrutivo roda sem confirmacao humana.',
    '',
    'Faca uma destas:',
    '  1. leve ao dono 3 opcoes com a recomendada marcada, dizendo o que acontece na pratica em cada uma;',
    '  2. ou siga sem este comando, se o trabalho nao depende dele.',
    '',
    'So o dono libera: ele mesmo roda o comando, ou acrescenta o padrao em "comandosLiberados" de .claude/sworn/projeto.json.'
  ].join('\n');
}

module.exports = { REGRAS, classificar, motivo, lerComando };
