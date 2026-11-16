'use strict';
// Ajudantes comuns dos testes (F1e, D828): a pasta temporaria, o repositorio git de brinquedo e o `rodar` com prazo e
// ambiente isolado, num lugar so. Cada arquivo de teste tinha os seus, e so alguns isolavam o processo filho da
// sessao real (o auditar.js lia a conversa inteira da sessao: 270 s num teste, F1a).
// Fica em test/lib/ de proposito: o `npm test` roda so `test/*.test.js`. Quem prova este arquivo e o
// `test/comum.test.js`.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..', '..');

/** Prazo padrao de um processo filho, em ms. Com folga: sob a carga da suite inteira um script de 1 s leva varios. */
const PRAZO = 120000;

/**
 * Prazo padrao do git dos ganchos no ensaio (scripts/lib/git.js, `correr`), em ms: os 5 s do produto estouravam sob a
 * carga da suite, o `null` virava "fora do repositorio" e o gancho liberava (commit.test A9-03 e conferir-depois.test
 * A4, F1g 13a fatia). E teto de uma chamada, nao a duracao esperada: fica abaixo do PRAZO, para um git que estoura
 * ainda deixar o processo filho caber no prazo do teste. Vai no process.env: chega ao gancho no proprio processo, ao
 * ambiente() e a todo filho que herda o processo (quem monta o env do zero nao o leva). Ausente ou vazio, vira o
 * PRAZO_DO_GIT; o valor que o ambiente ja traz fica.
 */
const PRAZO_DO_GIT = 60000;
if (!process.env.SWORN_GIT_PRAZO_MS) process.env.SWORN_GIT_PRAZO_MS = String(PRAZO_DO_GIT);

const criadas = [];
process.on('exit', function () { criadas.forEach(apagar); });

function apagar(dir) {
  // Pasta ainda presa por um processo (EBUSY no Windows) nao pode derrubar o teste na saida: fica para o sistema.
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { return; /* fica para o sistema */ }
  // F1g (s372): no Windows, o rmSync recursivo deixava SEM ERRO a pasta com acento no caminho ("sworn cicatriz
  // ação-"): 18 por rodada da suite. O que sobrou assim sai item por item, pelas chamadas de um arquivo so.
  if (fs.existsSync(dir)) { try { apagarItemPorItem(dir); } catch (e) { /* fica para o sistema */ } }
}

function apagarItemPorItem(alvo) {
  if (fs.lstatSync(alvo).isDirectory()) {
    fs.readdirSync(alvo).forEach(function (nome) { apagarItemPorItem(path.join(alvo, nome)); });
    fs.rmdirSync(alvo);
  } else {
    fs.unlinkSync(alvo);
  }
}

/** Pasta temporaria nova, com `nome` no caminho. Some na saida do processo; o teste pode apaga-la antes. */
function pasta(nome) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-' + nome + '-'));
  criadas.push(dir);
  return dir;
}

/**
 * Pasta temporaria nova com o `prefixo` exato no nome (o `mkdtempSync` de cada teste, com o espaco de proposito de
 * alguns), que some na saida do processo como a do `pasta`. Sem ela, cada rodada da suite deixava ~330 pastas na
 * temporaria do sistema e o disco chegou a 0 MB (F1g, s372).
 */
function temporaria(prefixo) {
  // vazio, so `.`, com separador ou com `..`, o prefixo tiraria a pasta de dentro da temporaria (o path.join resolve):
  // a conferencia e a propria regra, feita como o mkdtemp: junta o prefixo e so depois poe os 6 caracteres; a
  // pasta-mae do resultado tem de ser a temporaria
  const base = path.resolve(os.tmpdir());
  if (typeof prefixo !== 'string' || prefixo === '' || /[\\/]/.test(prefixo) || prefixo.includes('..') ||
      path.dirname(path.join(base, prefixo) + 'XXXXXX') !== base) {
    throw new Error('comum.temporaria: prefixo invalido (vazio, com separador ou com ..): ' + JSON.stringify(prefixo));
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
  criadas.push(dir);
  return dir;
}

let configVazia = null;

/**
 * O ambiente do processo filho, sem a sessao real: a pasta de config e uma pasta vazia (uma por processo de teste) e
 * a sessao do ambiente sai. `extra` entra por cima, e pode trocar as duas.
 */
function ambiente(extra) {
  if (configVazia === null) configVazia = pasta('config-vazia');
  return Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: configVazia, CLAUDE_CODE_SESSION_ID: '' }, extra);
}

/**
 * Roda um script do repositorio como processo, com o ambiente isolado e prazo. `script` e o caminho a partir da raiz
 * do repositorio (ou absoluto). `opcoes`: `cwd`; `entrada` (texto vai como esta, outro valor vai em JSON); `env`
 * (entra por cima do ambiente isolado); `prazo` em ms (ausente ou 0: o padrao, `PRAZO`). Devolve o resultado do
 * spawnSync; prazo estourado vem com `prazoEstourado: true` e a causa no fim do stderr, para o assert do teste dizer
 * por que o status nao e 0. Outro erro do proprio spawn (pasta de trabalho que nao existe, saida maior que o buffer)
 * tambem deixa a causa no fim do stderr; `stdout` e `stderr` voltam sempre em texto, nunca null.
 */
function rodar(script, args, opcoes) {
  const o = opcoes || {};
  return processoComPrazo('comum.rodar', script, path.resolve(RAIZ, script), args, o, ambiente(o.env));
}

/** O spawn do `rodar` e do `ganchoComoProcesso`: `rotulo` abre a causa que vai no fim do stderr; `env` e o inteiro. */
function processoComPrazo(rotulo, script, alvo, args, o, env) {
  const prazo = o.prazo || PRAZO;
  const entrada = o.entrada === undefined || typeof o.entrada === 'string' ? o.entrada : JSON.stringify(o.entrada);
  const r = spawnSync(process.execPath, [alvo].concat(args || []), {
    cwd: o.cwd,
    encoding: 'utf8',
    input: entrada,
    env: env,
    timeout: prazo
  });
  r.prazoEstourado = Boolean(r.error && r.error.code === 'ETIMEDOUT');
  r.stdout = r.stdout || '';
  r.stderr = r.stderr || '';
  if (r.prazoEstourado) r.stderr += '\n[' + rotulo + '] o prazo de ' + prazo + ' ms estourou: ' + script;
  else if (r.error) {
    r.stderr += '\n[' + rotulo + '] erro ao rodar ' + script + ' em ' + (o.cwd || process.cwd()) + ': ' + r.error.message;
  }
  return r;
}

/**
 * Roda o git na pasta, sem shell, e devolve a saida sem o fim de linha. Git que falha lanca erro com o stderr: um
 * repositorio de brinquedo montado pela metade faz o teste falhar longe da causa. `env` entra por cima do ambiente do
 * processo de teste, nao do isolado do `rodar`: o git nao le a sessao.
 */
function git(dir, args, env) {
  const r = spawnSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: Object.assign({}, process.env, env),
    timeout: PRAZO
  });
  if (r.status !== 0) {
    throw new Error('git ' + args.join(' ') + ' falhou em ' + dir + ': ' + (r.error ? r.error.message : r.stderr));
  }
  return r.stdout.trim();
}

/**
 * A config de ensaio do `repo`. `maintenance.auto` desligado: sem ele, cada commit abre mais um processo
 * (`git maintenance run --auto`), 460 na suite (F1g, s372).
 */
const CONFIG_DE_ENSAIO = [['user.email', 'ensaio@ensaio'], ['user.name', 'ensaio'], ['core.autocrlf', 'false'],
  ['commit.gpgsign', 'false'], ['maintenance.auto', 'false']];

/** A `CONFIG_DE_ENSAIO` no texto do `.git/config`, para gravar no `.git` copiado sem abrir um `git config` por chave. */
const CONFIG_DE_ENSAIO_TEXTO = CONFIG_DE_ENSAIO.map(function (par) {
  const ponto = par[0].indexOf('.');
  return '[' + par[0].slice(0, ponto) + ']\n\t' + par[0].slice(ponto + 1) + ' = ' + par[1] + '\n';
}).join('');

/** O `.git` vazio de cada ambiente de git (o `init` le a config global e o modelo pelo ambiente). */
const gitsVazios = new Map();

/** As variaveis que mudam o que o `git init` faz: as GIT_* e as que acham a config global. */
function ambienteDoGit() {
  return Object.keys(process.env).filter(function (k) {
    return /^GIT_/i.test(k) || /^(HOME|USERPROFILE|XDG_CONFIG_HOME)$/i.test(k);
  }).sort().map(function (k) { return k + '=' + process.env[k]; }).join('\n');
}

/** `dir` dentro da pasta temporaria do sistema, a mesma do `.git` vazio (o init sonda o disco: core.ignorecase...). */
function naTemporaria(dir) {
  const rel = path.relative(os.tmpdir(), path.resolve(dir));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Faz de `dir` um repositorio git de brinquedo: autor de ensaio, sem conversao de fim de linha, sem assinatura e sem
 * manutencao automatica, para a configuracao da maquina nao mudar o teste. Com `arquivos` ({ 'caminho/relativo':
 * conteudo }), grava cada um e faz o commit `base`; sem `arquivos`, ou com `{}`, nao ha commit (o repositorio fica sem
 * HEAD). Devolve `dir`. Pasta nova na temporaria do sistema ganha um `.git` copiado de um `git init` feito uma vez por
 * ambiente de git (o mesmo que o init daria ali, sem abrir processo), com a config gravada no arquivo. As outras passam
 * pelo `git init` e por um `git config` por chave: a que ja tem `.git` (o init a mantem: commits, indice e config
 * ficam; o `.git` pode ser um arquivo gitdir, e a chave nao duplica), a que nao existe (o git falha com a causa) e a
 * de fora da temporaria.
 */
function repo(dir, arquivos) {
  const destino = path.join(dir, '.git');
  if (!fs.existsSync(destino) && fs.existsSync(dir) && naTemporaria(dir)) {
    const chave = ambienteDoGit();
    let vazio = gitsVazios.get(chave);
    if (vazio === undefined) {
      const base = pasta('git-vazio');
      git(base, ['init', '-q', '.']);
      vazio = path.join(base, '.git');
      gitsVazios.set(chave, vazio);
    }
    fs.cpSync(vazio, destino, { recursive: true });
    fs.appendFileSync(path.join(destino, 'config'), CONFIG_DE_ENSAIO_TEXTO);
  } else {
    git(dir, ['init', '-q', '.']);
    CONFIG_DE_ENSAIO.forEach(function (par) { git(dir, ['config', par[0], par[1]]); });
  }
  const nomes = Object.keys(arquivos || {});
  nomes.forEach(function (rel) {
    const alvo = path.join(dir, rel);
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, arquivos[rel]);
  });
  if (nomes.length > 0) {
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'base']);
  }
  return dir;
}

const moldes = new Map();

/**
 * Pasta nova (`pasta(nome)`) copiada de um molde que `montar(dir)` monta uma vez por processo de teste, para o teste
 * que monta sempre o mesmo repositorio nao abrir os mesmos processos de git a cada vez (F1g, s372). O molde e um por
 * funcao `montar`; a copia nao guarda as datas, e o git confere pelo conteudo o que o indice copiado nao bate.
 */
function doMolde(nome, montar) {
  let base = moldes.get(montar);
  if (base === undefined) {
    base = pasta(nome + '-molde');
    montar(base);
    moldes.set(montar, base);
  }
  const dir = pasta(nome);
  fs.cpSync(base, dir, { recursive: true });
  return dir;
}

let identidadePosta = false;

/**
 * R3f: a sanitacao confere a identidade que vai assinar o proximo commit (`git var GIT_AUTHOR_IDENT`). Sem isto, um
 * repositorio temporario de teste herda a identidade global da maquina (na do dono, o e-mail pessoal) e o teste
 * depende de quem roda. Aponta GIT_CONFIG_GLOBAL, neste processo e nos filhos, para um arquivo temporario que inclui
 * a config global de verdade (fim de linha, ferramentas; a de ~/.gitconfig e a do XDG, ~/.config/git/config) e so troca
 * `user` por um autor de ensaio; tira do ambiente as GIT_AUTHOR_* e GIT_COMMITTER_*, que venceriam a config.
 * Idempotente; erro de escrita lanca (o teste nao segue com a identidade da maquina).
 */
function identidadeDeEnsaio() {
  if (identidadePosta) return;
  const reais = process.env.GIT_CONFIG_GLOBAL ? [path.resolve(process.env.GIT_CONFIG_GLOBAL)]
    : [path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'git', 'config'),
      path.join(os.homedir(), '.gitconfig')];
  const arq = path.join(pasta('gitconfig-ensaio'), 'gitconfig');
  // o caminho vai entre aspas: `#` ou `;` sem aspas comecariam um comentario na config do git
  const incluir = reais.filter(function (r) { return fs.existsSync(r); })
    .map(function (r) { return '[include]\n\tpath = "' + r.replace(/\\/g, '/').replace(/"/g, '\\"') + '"\n'; }).join('');
  fs.writeFileSync(arq, incluir + '[user]\n\tname = ensaio\n\temail = ensaio' + '@exemplo.com\n');
  process.env.GIT_CONFIG_GLOBAL = arq;
  ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'].forEach(function (v) {
    delete process.env[v];
  });
  identidadePosta = true;
}

/**
 * F1 (s372): roda o gancho `script` (caminho a partir da raiz do repositorio, ou absoluto) neste processo, pelo modo
 * embutido do io.js (`io.rodarJuntos`), sem abrir processo: cada processo de Node custa uns 100 ms, e a suite abre
 * milhares. `entrada` e o objeto do stdin; `opcoes`: `env` (o ambiente inteiro da chamada, no lugar do process.env;
 * ausente: o `ambiente()` de agora, o process.env sem a sessao real) e `cwd`. Devolve a saida do gancho como objeto,
 * ou null (sem opiniao, ou o gancho falhou e liberou). O gancho roda de novo a cada chamada (sai do cache do require),
 * e o ambiente e a pasta voltam como estavam, mesmo com erro. So vale para gancho que decide sem esperar nada
 * assincrono e sem process.exit: o que decide depois de um timer ou de uma promessa volta null aqui. Para o resultado
 * no formato do processo, e o gancho que sai por process.exit: `ganchoComoProcesso`.
 */
function ganchoEmProcesso(script, entrada, opcoes) {
  return ganchoCapturado(script, entrada, opcoes).saida;
}

/**
 * O mesmo `ganchoEmProcesso`, devolvendo `{ saida, stdout, stderr }`: o texto que o gancho escreveu durante a chamada
 * direto no stdout e no stderr, como no processo (o gancho que falha e libera deixa no stderr a causa, "sworn: portao
 * falhou e liberou por seguranca: ..."). `stdout` nao traz a `saida`: o processo a escreveria em JSON no fim. Durante
 * a chamada o stdout e o stderr do processo de teste ficam guardados (o stdout e o canal do node:test), e voltam a
 * escrever no fim, mesmo com erro.
 */
function ganchoCapturado(script, entrada, opcoes) {
  const o = opcoes || {};
  const io = require(path.join(RAIZ, 'scripts', 'lib', 'io.js'));
  const alvo = require.resolve(path.resolve(RAIZ, script));
  // as chaves mudam no proprio process.env: no Windows ele nao separa PATH de Path, e um objeto comum separaria
  const envAntes = Object.assign({}, process.env);
  const cwdAntes = process.cwd();
  const escreverErr = process.stderr.write;
  const escreverOut = process.stdout.write;
  let stderr = '';
  let stdout = '';
  delete require.cache[alvo];
  try {
    process.stderr.write = function (pedaco) { stderr += String(pedaco); return true; };
    process.stdout.write = function (pedaco) { stdout += String(pedaco); return true; };
    trocarAmbiente(o.env || ambiente());
    if (o.cwd) process.chdir(o.cwd);
    const saida = io.rodarJuntos(entrada || {}, [alvo])[0];
    return { saida: saida === undefined ? null : saida, stdout: stdout, stderr: stderr };
  } finally {
    process.stderr.write = escreverErr;
    process.stdout.write = escreverOut;
    trocarAmbiente(envAntes);
    process.chdir(cwdAntes);
    delete require.cache[alvo];
  }
}

/** A marca que o io.js deixa no stderr quando o gancho falha e libera. */
const FALHOU_E_LIBEROU = /sworn: portao falhou e liberou por seguranca/;

/**
 * O script que sai por conta propria: em processo, o process.exit derrubaria o processo de teste. Le so o texto do
 * proprio script (nenhuma lib de scripts/lib chama process.exit no modo embutido: o test/comum.test.js confere), e um
 * `process.exit(` num comentario so manda o gancho por processo, mais lento e com o mesmo resultado.
 */
const SAI_POR_EXIT = /\bprocess\.exit\(/;

/**
 * A ultima linha do stdout (a saida que o io.js escreve no fim, numa linha so): `{ json }`, com null quando ela nao
 * abre com `{` (sem opiniao); a que abre com `{` e nao e JSON (saida cortada) volta com `quebrado`, a linha.
 */
function jsonDoFim(stdout) {
  const linhas = stdout.trim().split('\n');
  const ultima = linhas[linhas.length - 1].trim();
  if (ultima.charAt(0) !== '{') return { json: null };
  try { return { json: JSON.parse(ultima) }; } catch (e) { return { json: null, quebrado: ultima }; }
}

/**
 * O gancho em processo (`ganchoCapturado`), com o resultado no formato do spawnSync, para o teste que lia o processo
 * trocar so a chamada: `{ status, stdout, stderr, json, porProcesso }`. `stdout` e o que o processo escreveria (o
 * texto solto, depois a `saida` em JSON); `json` e a `saida` (null sem opiniao). `opcoes`: `env` (o ambiente inteiro;
 * ausente, o `ambiente()`) e `cwd`. Roda como processo, com o mesmo `env` e `cwd`, e volta com `porProcesso: true`: a
 * entrada em texto (vai ao stdin como esta) e o script cujo codigo chama `process.exit(`; ali `json` e a ultima linha
 * do stdout, e o prazo estourado volta com `prazoEstourado` e a causa no fim do stderr, como no `rodar`. Uma diferenca
 * de proposito, nos dois caminhos: o gancho que falha e libera volta com status 1 (o processo sairia com 0, pelo
 * io.blindar), para o assert do status pegar a falha que o teste nao provocou; por processo, tambem a ultima linha
 * que abre com `{` e nao e JSON (status 1 e a causa no fim do stderr). Entrada null ou ausente vai como `{}`, nos dois
 * caminhos. Gancho que espera algo assincrono
 * segue pelo `rodar`.
 */
function ganchoComoProcesso(script, entrada, opcoes) {
  const o = opcoes || {};
  const alvo = require.resolve(path.resolve(RAIZ, script));
  const env = o.env || ambiente();
  if (typeof entrada === 'string' || SAI_POR_EXIT.test(fs.readFileSync(alvo, 'utf8'))) {
    const p = processoComPrazo('comum.ganchoComoProcesso', script, alvo, [],
      { cwd: o.cwd, entrada: entrada == null ? {} : entrada }, env);
    const fim = jsonDoFim(p.stdout);
    const stderr = fim.quebrado === undefined ? p.stderr
      : p.stderr + '\n[comum.ganchoComoProcesso] a ultima linha do stdout abre com { e nao e JSON: ' + fim.quebrado.slice(0, 200);
    const falhou = fim.quebrado !== undefined || FALHOU_E_LIBEROU.test(p.stderr);
    return { status: p.status === 0 && falhou ? 1 : p.status, stdout: p.stdout,
      stderr: stderr, json: fim.json, porProcesso: true, prazoEstourado: p.prazoEstourado };
  }
  const r = ganchoCapturado(alvo, entrada, { env: env, cwd: o.cwd });
  return { status: FALHOU_E_LIBEROU.test(r.stderr) ? 1 : 0, stdout: r.stdout + (r.saida ? JSON.stringify(r.saida) : ''),
    stderr: r.stderr, json: r.saida, porProcesso: false };
}

/**
 * A excecao que o process.exit trocado lanca. O catch do proprio script tambem a pode pegar (o processo de verdade
 * pararia ali): por isso o status e a saida congelam no primeiro exit, e o catch do scriptComoProcesso a reconhece.
 */
const SAIU = { sworn: 'process.exit do scriptComoProcesso' };

/**
 * O status que o processo de verdade daria ao codigo do exit (ou ao exitCode): o inteiro, ou o texto de um inteiro,
 * vale; outro valor (2.7, true) o node recusa e o processo sai com 1. No Windows o codigo vai como 32 bits sem sinal
 * (exit(-1) da 4294967295); fora dele, so os 8 bits de baixo (exit(-1) da 255, exit(256) da 0).
 */
function statusDoExit(codigo) {
  if (codigo === undefined || codigo === null) return 0;
  const n = typeof codigo === 'string' && /^\s*-?\d+\s*$/.test(codigo) ? Number(codigo) : codigo;
  if (!Number.isInteger(n)) return 1;
  return process.platform === 'win32' ? n >>> 0 : n & 0xff;
}

/**
 * Um script de linha de comando (nao gancho) dentro do processo de teste, com o resultado no formato do spawnSync em
 * utf8, como o `ganchoComoProcesso`: `{ status, stdout, stderr }`. `args` vai em process.argv depois do script;
 * `opcoes`: `env` (o ambiente inteiro; ausente, o `ambiente()`) e `cwd`. O primeiro process.exit vale como num processo:
 * grava o codigo (`statusDoExit`) e congela a saida, e o que o script fizer depois (o catch que pega a excecao do exit,
 * outro exit) nao muda status nem texto. Sem exit, o status e o do process.exitCode (ou 0); a excecao que escapa e
 * status 1 com a pilha no stderr. Os modulos de scripts/ carregam de novo a cada chamada e o cache do require volta
 * como estava (o processo de teste segue com os seus); o ambiente, a pasta, o argv, o exit, o exitCode e os ouvintes do
 * process voltam mesmo com falha (o ouvinte que o script pos sai sem rodar). Fora do alcance, e por isso pelo `rodar`:
 * o script que le o stdin; o que espera algo assincrono depois de carregar; o que conta com `finally` ou
 * `process.on('exit')` no meio da saida (o exit de verdade nao roda o finally; aqui ele roda); e o que pode travar,
 * porque aqui nao ha prazo: um laco sem fim trava o processo de teste, onde o `rodar` cortaria com a causa.
 */
function scriptComoProcesso(script, args, opcoes) {
  const o = opcoes || {};
  const alvo = require.resolve(path.resolve(RAIZ, script));
  const dosScripts = path.join(RAIZ, 'scripts') + path.sep;
  const cacheAntes = new Set(Object.keys(require.cache));
  const guardados = {};
  Object.keys(require.cache).forEach(function (k) {
    if (k === alvo || k.startsWith(dosScripts)) { guardados[k] = require.cache[k]; delete require.cache[k]; }
  });
  const ouvintesAntes = {};
  process.eventNames().forEach(function (ev) { ouvintesAntes[ev] = process.listeners(ev); });
  const antes = { env: Object.assign({}, process.env), cwd: process.cwd(), argv: process.argv, exit: process.exit,
    exitCode: process.exitCode, out: process.stdout.write, err: process.stderr.write };
  let stdout = '';
  let stderr = '';
  let status = null;
  try {
    process.stdout.write = function (pedaco) { if (status === null) stdout += String(pedaco); return true; };
    process.stderr.write = function (pedaco) { if (status === null) stderr += String(pedaco); return true; };
    process.exit = function (codigo) {
      if (status === null) status = statusDoExit(codigo === undefined || codigo === null ? process.exitCode : codigo);
      throw SAIU;
    };
    process.exitCode = undefined;
    trocarAmbiente(o.env || ambiente());
    if (o.cwd) process.chdir(o.cwd);
    process.argv = [process.execPath, alvo].concat(args || []);
    try {
      require(alvo);
      if (status === null) status = statusDoExit(process.exitCode);
    } catch (err) {
      if (status === null) { stderr += (err && err.stack ? err.stack : String(err)) + '\n'; status = 1; }
    }
    return { status: status, stdout: stdout, stderr: stderr };
  } finally {
    process.stdout.write = antes.out;
    process.stderr.write = antes.err;
    process.exit = antes.exit;
    process.exitCode = antes.exitCode;
    process.argv = antes.argv;
    trocarAmbiente(antes.env);
    process.chdir(antes.cwd);
    process.eventNames().forEach(function (ev) {
      const eram = ouvintesAntes[ev] || [];
      process.listeners(ev).forEach(function (f) { if (eram.indexOf(f) === -1) process.removeListener(ev, f); });
    });
    Object.keys(require.cache).forEach(function (k) { if (!cacheAntes.has(k)) delete require.cache[k]; });
    Object.keys(guardados).forEach(function (k) { require.cache[k] = guardados[k]; });
  }
}

/** Deixa no process.env so as chaves de `novo` com valor (a de valor undefined sai, como no spawn), sem trocar o objeto. */
function trocarAmbiente(novo) {
  const tem = function (k) { return Object.prototype.hasOwnProperty.call(novo, k) && novo[k] !== undefined; };
  Object.keys(process.env).forEach(function (k) { if (!tem(k)) delete process.env[k]; });
  Object.keys(novo).forEach(function (k) { if (tem(k)) process.env[k] = String(novo[k]); });
}

module.exports = { RAIZ, PRAZO, PRAZO_DO_GIT, pasta, temporaria, apagar, ambiente, rodar, git, repo, doMolde, identidadeDeEnsaio, ganchoEmProcesso,
  ganchoCapturado, ganchoComoProcesso, scriptComoProcesso, FALHOU_E_LIBEROU };
