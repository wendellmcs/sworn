'use strict';
// R1 (pedido do dono, 2026-11-12: "criamos a rotina de baixar, estudar, melhorar, trazer e depois excluir o lixo
// deixado pra tras ... ele faz a propria limpeza depois"). O registro das pastas que o proprio sworn cria fora do
// projeto (o clone de estudo de uma referencia, o worktree e o export da publicacao, a pasta de uma prova de carga) e
// a limpeza delas. So se apaga o que esta no registro, dentro da pasta temporaria do sistema, a mesma pasta que se
// registrou (o numero e a criacao no disco conferem) e que ja nao se usa: o export publicado, o worktree do export
// que saiu, e o resto no fim da sessao que o criou (ou 7 dias depois, quando a sessao nunca fechou). O clone de estudo
// e so para ler: rodar codigo dele e reconhecido aqui, e a trava 5 nao deixa (portao-destrutivo.js).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const gitLib = require('./git.js');
const { apagarPasta } = require('./caminho.js'); // pendencia #10: o rmSync deixava a pasta com acento

const TIPOS = ['estudo', 'worktree', 'export', 'carga'];
const ARQUIVO = 'pastas.json';
const DIAS_SEM_DONO = 7;
const DIA_MS = 24 * 60 * 60 * 1000;
const PRAZO_GIT_MS = 30000;
const PRAZO_CLONE_MS = 5 * 60 * 1000;
const WINDOWS = process.platform === 'win32';

/** <CLAUDE_CONFIG_DIR ou ~/.claude>/sworn/pastas.json: o registro fica fora de todo projeto, como as pastas. */
function arquivoDoRegistro(env) {
  return path.join(path.dirname(require('./gasto.js').pastaDosProjetos(env || process.env)), 'sworn', ARQUIVO);
}

// O caminho como o disco o guarda (link, nome curto 8.3 do Windows e caixa resolvidos), ou null se nao existe.
const real = (p) => { try { return fs.realpathSync.native(p); } catch (e) { return null; } };
// No Windows o disco nao distingue a caixa; fora dele, distingue.
const chave = (p) => (WINDOWS ? p.toLowerCase() : p);
const falha = (erro) => ({ ok: false, erro: erro });
const causa = (e) => (e && e.message) || String(e);

/** `filho` fica dentro de `pai`, e nunca e o proprio `pai` (os dois ja reais). */
function dentroDe(filho, pai) {
  const rel = path.relative(pai, filho);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** O numero da pasta no disco e a hora de criacao: outra pasta nascida no mesmo caminho tem outros. */
function identidade(p) {
  const st = fs.lstatSync(p, { bigint: true });
  return { dev: String(st.dev), ino: String(st.ino), nasceu: String(st.birthtimeNs) };
}

function valido(r) {
  return Boolean(r) && typeof r === 'object' && typeof r.caminho === 'string' && TIPOS.indexOf(r.tipo) !== -1 &&
    Boolean(r.id) && typeof r.id === 'object' && typeof r.criada === 'string' && !Number.isNaN(Date.parse(r.criada));
}

/** O registro inteiro, como esta no arquivo; o arquivo que nao existe e a lista vazia, e o que nao se le lanca (nunca se
 *  sobrescreve). */
function lerTudo(arquivo) {
  let bruto;
  try { bruto = fs.readFileSync(arquivo, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw new Error('o registro das pastas do sworn nao se le (' + arquivo + ': ' + (e.code || causa(e)) + '): confira ' +
      'a permissao do arquivo');
  }
  let lista = null;
  try { lista = JSON.parse(bruto); } catch (e) { lista = null; }
  if (!Array.isArray(lista)) {
    throw new Error('o registro das pastas do sworn nao se le (' + arquivo + '): corrija o JSON ou apague o arquivo');
  }
  return lista;
}

/** Os registros que esta versao entende. O que ela nao entende (de outra versao, ou editado a mao) fica no arquivo,
 *  intocado: nem se apaga a pasta dele, nem se perde o registro. */
function lerLista(arquivo) { return lerTudo(arquivo).filter(valido); }

function listar(env) { return lerLista(arquivoDoRegistro(env)); }

/** Le, muda e grava o registro em fila (duas sessoes que gravam juntas perderiam a pasta da outra). `muda` devolve
 *  a lista nova; a mesma lista devolvida nao grava nada. */
function comRegistro(env, muda) {
  const arquivo = arquivoDoRegistro(env);
  const pedidos = require('./pedidos.js');
  const trava = arquivo + '.trava';
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  if (!pedidos.travar(trava)) {
    throw new Error('o registro das pastas do sworn esta preso por outro processo (' + trava + '); tente de novo');
  }
  try {
    const tudo = lerTudo(arquivo);
    const antes = tudo.filter(valido);
    const depois = muda(antes);
    if (depois !== antes) {
      const alheios = tudo.filter(function (r) { return !valido(r); });
      require('./compactacao.js').gravarInteiro(arquivo, JSON.stringify(depois.concat(alheios), null, 2) + '\n');
    }
  } finally { pedidos.soltar(trava); }
}

/**
 * Poe a pasta no registro. So a que existe, e pasta, fica dentro da temporaria do sistema (a limpeza nunca apaga
 * fora dela) e e de um tipo conhecido; o worktree leva o repositorio de origem (`opcoes.repo`), porque sai pelo git de
 * la. `opcoes.origem` liga o export ao worktree de que ele saiu. Registrar de novo o mesmo caminho troca o registro.
 */
function registrar(caminho, tipo, opcoes, env) {
  const o = opcoes || {};
  try {
    if (TIPOS.indexOf(tipo) === -1) return falha('o tipo "' + tipo + '" nao existe: use ' + TIPOS.join(', '));
    const p = real(caminho);
    if (p === null) return falha('a pasta nao existe: ' + caminho);
    if (!fs.statSync(p).isDirectory()) return falha('nao e pasta: ' + caminho);
    const tmp = real(os.tmpdir());
    if (tmp === null || !dentroDe(p, tmp)) {
      return falha('so pasta dentro da temporaria do sistema (' + (tmp || os.tmpdir()) + ') entra no registro, ' +
        'porque a limpeza nunca apaga fora dela: ' + caminho);
    }
    const registro = { caminho: p, tipo: tipo, sessao: String(o.sessao || ''), criada: new Date().toISOString(),
      id: identidade(p) };
    if (tipo === 'worktree') {
      const repo = o.repo ? real(o.repo) : null;
      if (repo === null) return falha('o worktree precisa do repositorio de origem (--repo): ele sai pelo git de la');
      registro.repo = repo;
    }
    const origem = o.origem ? real(o.origem) : null;
    if (origem !== null) registro.origem = origem;
    comRegistro(env, function (lista) {
      return lista.filter(function (r) { return chave(r.caminho) !== chave(p); }).concat([registro]);
    });
    return { ok: true, registro: registro };
  } catch (e) { return falha(causa(e)); }
}

/** O git na pasta, sem shell e com prazo; a saida, ou null quando ele falha. */
function git(pasta, args) {
  const r = gitLib.rodar(pasta, args, { timeout: PRAZO_GIT_MS });
  return gitLib.ok(r) ? r.stdout : null;
}

/** Por que a pasta ainda nao se apaga, ou null quando ja pode. `ficaram`: os registros que ficam nesta passada;
 *  `soltos`: os worktrees cujo export saiu nesta passada. */
function motivoParaFicar(reg, ctx, ficaram, soltos) {
  if (reg.tipo === 'export' || reg.tipo === 'worktree') {
    const sujo = git(reg.caminho, ['status', '--porcelain']);
    if (sujo === null) return 'o git nao respondeu nela';
    if (sujo.trim()) return 'tem mudanca sem commit';
  }
  if (reg.tipo === 'export') {
    // --all: os ramos, as tags, o HEAD solto e o stash; o commit que so um deles tem tambem segura a pasta
    const semPush = git(reg.caminho, ['log', '--all', '--not', '--remotes', '--format=%h', '-1']);
    if (semPush === null) return 'o git nao respondeu nela';
    return semPush.trim() ? 'tem commit sem push' : null;
  }
  if (reg.tipo === 'worktree') {
    if (soltos.has(chave(reg.caminho))) return null;
    const exp = ficaram.find(function (r) { return r.tipo === 'export' && r.origem && chave(r.origem) === chave(reg.caminho); });
    if (exp) return 'o export feito dele ainda nao saiu (' + exp.caminho + ')';
  }
  // o estudo, a carga e o worktree solto: o fim da sessao que os criou, ou 7 dias sem ela
  if (ctx.fimDaSessao && reg.sessao && reg.sessao === ctx.sessao) return null;
  const idade = ctx.agora - Date.parse(reg.criada);
  if ((!reg.sessao || reg.sessao !== ctx.sessao) && idade > DIAS_SEM_DONO * DIA_MS) return null;
  return reg.sessao && reg.sessao === ctx.sessao ? 'e da sessao em curso: sai no fim dela' :
    'e de outra sessao, com menos de ' + DIAS_SEM_DONO + ' dias';
}

/** A pasta que a limpeza nunca toca, mesmo registrada: fora da temporaria, ou com a pasta de trabalho dentro. */
function protegida(p, ctx) {
  const tmp = real(os.tmpdir());
  if (tmp === null || !dentroDe(p, tmp)) return 'fica fora da temporaria do sistema';
  for (const c of [ctx.cwd, process.cwd()]) {
    const rc = c ? real(c) : null;
    if (rc !== null && (chave(rc) === chave(p) || dentroDe(rc, p))) return 'a pasta de trabalho fica dentro dela';
  }
  return null;
}

/** 'sumiu', 'outra' (outra pasta no caminho, ou um link), 'presa: <codigo>' (nao se le agora: outro processo, o
 *  antivirus) ou null (e a mesma que se registrou). */
function conferirPasta(reg) {
  let st;
  try { st = fs.lstatSync(reg.caminho); } catch (e) { return e.code === 'ENOENT' ? 'sumiu' : 'presa: ' + (e.code || causa(e)); }
  if (st.isSymbolicLink() || !st.isDirectory()) return 'outra';
  const r = real(reg.caminho);
  if (r === null || chave(r) !== chave(reg.caminho)) return 'outra';
  const id = identidade(r);
  return id.dev === reg.id.dev && id.ino === reg.id.ino && id.nasceu === reg.id.nasceu ? null : 'outra';
}

/** Apaga a pasta; o worktree sai pelo git do repositorio (que recusa o que tem mudanca). Devolve o erro, ou null. */
function apagar(reg) {
  try {
    if (reg.tipo === 'worktree' && reg.repo && fs.existsSync(reg.repo)) {
      const r = gitLib.rodar(null, ['-C', reg.repo, 'worktree', 'remove', reg.caminho], { timeout: PRAZO_GIT_MS });
      if (r.status !== 0) return 'o git nao tirou o worktree: ' + String(r.stderr || (r.error && r.error.message) || '').trim();
    } else {
      apagarPasta(reg.caminho, { maxRetries: 3, retryDelay: 100 });
    }
    return fs.existsSync(reg.caminho) ? 'a pasta continua no disco' : null;
  } catch (e) { return causa(e); }
}

const ORDEM = { export: 0, worktree: 1, estudo: 2, carga: 2 };

/**
 * A limpeza: apaga as pastas do registro que ja nao se usam e devolve o que fez. `contexto`: `sessao` (a que chama),
 * `fimDaSessao` (true so no fim dela, quando o estudo e a carga dela saem), `agora` e `cwd`. O registro de pasta que
 * sumiu, ou de outra pasta no mesmo caminho, sai sem apagar nada. O registro que nao se le fica como esta.
 */
function limpar(contexto, env) {
  const ctx = Object.assign({ sessao: '', fimDaSessao: false, cwd: null }, contexto);
  if (typeof ctx.agora !== 'number') ctx.agora = Date.now();
  const r = { ok: true, apagadas: [], ficam: [], sumiram: [], estranhas: [] };
  try {
    comRegistro(env, function (lista) {
      if (!lista.length) return lista;
      const ficaram = [];
      const soltos = new Set();
      // o export primeiro: o worktree de que ele saiu fica livre na mesma passada
      const fila = lista.slice().sort(function (a, b) { return ORDEM[a.tipo] - ORDEM[b.tipo]; });
      for (const reg of fila) {
        const como = conferirPasta(reg);
        if (como === 'sumiu') { r.sumiram.push(reg.caminho); continue; }
        if (como === 'outra') { r.estranhas.push(reg.caminho); continue; }
        const motivo = (como ? 'nao se le agora (' + como.slice('presa: '.length) + '): a proxima passada confere de novo' : null) ||
          protegida(reg.caminho, ctx) || motivoParaFicar(reg, ctx, ficaram, soltos);
        const erro = motivo ? null : apagar(reg);
        if (motivo || erro) {
          ficaram.push(reg);
          r.ficam.push({ caminho: reg.caminho, tipo: reg.tipo, motivo: motivo || 'nao saiu: ' + erro });
          continue;
        }
        r.apagadas.push({ caminho: reg.caminho, tipo: reg.tipo });
        if (reg.tipo === 'export' && reg.origem) soltos.add(chave(reg.origem));
      }
      return ficaram.length === lista.length ? lista : ficaram;
    });
  } catch (e) { return Object.assign(r, { ok: false, erro: causa(e) }); }
  return r;
}

/** Roda a linha de comando (scripts/pastas.js) num processo solto: o gancho que chama nao espera a limpeza. O processo
 *  nasce na temporaria do sistema (no Windows, a pasta em que um processo esta nao se apaga) e leva a pasta de
 *  trabalho de quem chama em --protegida, que a limpeza nunca toca. */
function emSegundoPlano(args, env) {
  try {
    const filho = spawn(process.execPath, [path.join(__dirname, '..', 'pastas.js')].concat(args, ['--protegida', process.cwd()]),
      { detached: true, stdio: 'ignore', env: env || process.env, windowsHide: true, cwd: os.tmpdir() });
    filho.on('error', function () { /* sem limpeza agora: a proxima passada confere de novo */ });
    filho.unref();
    return true;
  } catch (e) { return false; }
}

// ---- o clone de estudo e so para ler ----

// atalho: reconhecer pela forma do comando. limite: o que roda por outro caminho (um alias, um script de fora que chama
// o do clone, bash -c com o texto montado) passa. trocar quando: um estudo real mostrar codigo do clone rodando por
// uma forma que esta lista nao ve.
const INTERPRETES = /^(node|nodejs|deno|bun|python[0-9.]*|py|pypy[0-9]*|ruby|perl|php|bash|sh|zsh|dash|ksh|fish|pwsh|powershell|cmd|wscript|cscript|source|\.)$/i;
const CONSTRUTORES = /^(npm|npx|pnpm|pnpx|yarn|bunx|cargo|make|gmake|cmake|ninja|pip[0-9.]*|pipx|poetry|uv|go|mvn|mvnw|gradle|gradlew|dotnet|composer|bundle|rake|gem|mix|swift)$/i;
const PREFIXOS = /^(sudo|env|nohup|time|exec|nice|command|xargs|&|call|start)$/i;
const MUDA_PASTA = /^(cd|pushd|chdir|set-location|sl|push-location)$/i;
const ATRIBUICAO = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** As palavras de um pedaco do comando, sem aspas (tambem as do meio, como em --prefix="<pasta>") e sem os parenteses
 *  e chaves das pontas. */
function palavras(trecho) {
  const saida = [];
  const re = /(?:"[^"]*"|'[^']*'|[^\s"']+)+/g;
  let m;
  while ((m = re.exec(trecho)) !== null) {
    const p = m[0].replace(/"([^"]*)"|'([^']*)'/g, '$1$2').replace(/^[({]+|[)}]+$/g, '');
    if (p) saida.push(p);
  }
  return saida;
}

/** O caminho real de uma palavra do comando, a partir da pasta: o arquivo pode nao existir, a pasta dele sim. A forma
 *  do Git Bash (/c/...) vira a do Windows. */
function resolver(palavra, pasta) {
  let t = palavra;
  if (WINDOWS) {
    const m = /^\/([a-zA-Z])(\/.*)?$/.exec(t);
    if (m) t = m[1] + ':' + (m[2] || '/');
  }
  const abs = path.resolve(pasta, t);
  let base = abs;
  let resto = '';
  for (;;) {
    const r = real(base);
    if (r !== null) return resto ? path.join(r, resto) : r;
    const pai = path.dirname(base);
    if (pai === base) return abs;
    resto = resto ? path.join(path.basename(base), resto) : path.basename(base);
    base = pai;
  }
}

/** O nome do programa, sem a pasta e sem a extensao do Windows. */
function nomeDoPrograma(p) {
  return path.basename(p.replace(/\\/g, '/')).replace(/\.(exe|cmd|bat|com|ps1)$/i, '');
}

/**
 * A pasta de estudo cujo codigo o comando rodaria, ou null: o programa dentro dela (./install.sh), o interprete com o
 * script dela, ou o gerenciador de pacote e o construtor com a pasta dela (a pasta do comando, um `cd` antes, ou um
 * argumento como --prefix e -C). Ler (grep, cat, git log, o script do sworn com o arquivo do clone) passa. O registro
 * que nao se le nao barra nada.
 */
function executaNoEstudo(comando, cwd, env) {
  let estudos;
  try {
    estudos = listar(env).filter(function (r) { return r.tipo === 'estudo'; }).map(function (r) { return r.caminho; });
  } catch (e) { return null; }
  if (!estudos.length || typeof comando !== 'string') return null;
  const noEstudo = function (p) {
    return estudos.find(function (e) { return chave(e) === chave(p) || dentroDe(p, e); }) || null;
  };
  // D899: o cwd torto da entrada do gancho (numero, objeto) vale a pasta do processo; o path.resolve dele estourava,
  // e o io.blindar do portao destrutivo virava o estouro em permitir
  const base = typeof cwd === 'string' && cwd ? cwd : process.cwd();
  let pasta = real(base) || path.resolve(base);
  // o & sozinho tambem separa: segundo plano no bash, sequencia no cmd
  for (const trecho of comando.split(/&&|\|\||[;|&\n]/)) {
    const ps = palavras(trecho);
    let i = 0;
    while (i < ps.length && (ATRIBUICAO.test(ps[i]) || PREFIXOS.test(ps[i]))) i++;
    if (i >= ps.length) continue;
    const programa = ps[i];
    const nome = nomeDoPrograma(programa);
    const args = ps.slice(i + 1);
    const primeiro = args.find(function (a) { return !a.startsWith('-'); });
    if (MUDA_PASTA.test(nome)) {
      // o cd do cmd leva a chave /d (troca de unidade junto) antes da pasta
      const destino = args.find(function (a) { return !a.startsWith('-') && !(WINDOWS && /^\/d$/i.test(a)); });
      if (destino) pasta = resolver(destino, pasta);
      continue;
    }
    let achou = null;
    if (/[\\/]/.test(programa) || programa.startsWith('.')) achou = noEstudo(resolver(programa, pasta));
    if (!achou && INTERPRETES.test(nome) && primeiro) achou = noEstudo(resolver(primeiro, pasta));
    if (!achou && CONSTRUTORES.test(nome)) {
      achou = noEstudo(pasta);
      for (const a of args) {
        if (achou) break;
        // a opcao com = (--prefix=<pasta>) e a curta colada (-C<pasta>) levam o valor junto
        const curta = /^-[A-Za-z](.+)$/.exec(a);
        const valor = !a.startsWith('-') ? a : a.indexOf('=') !== -1 ? a.slice(a.indexOf('=') + 1) : curta ? curta[1] : '';
        if (valor) achou = noEstudo(resolver(valor, pasta));
      }
    }
    if (achou) return achou;
  }
  return null;
}

/** A negacao da trava 5: o porque e o que fazer. */
function motivoDoEstudo(comando, pasta) {
  return ['sworn - comando barrado (trava 5): ele roda codigo do clone de estudo.', '',
    'Comando: ' + String(comando).slice(0, 300),
    'Clone de estudo: ' + pasta, '',
    'O clone de uma referencia e so para ler: codigo de terceiro nao roda nesta maquina (instalar, construir, rodar o',
    'teste ou um script dele). Leia com grep, cat, git log e Read, e cite arquivo:linha do commit lido.', '',
    'Faca uma destas:',
    '  1. siga lendo o clone, sem rodar nada dele;',
    '  2. se rodar for preciso para o estudo, peca ao dono: ele roda numa pasta de teste, e o sworn segue com o que ele trouxer.'
  ].join('\n');
}

// ---- o clone de estudo ----

const URL_ESTUDO = /^https:\/\/[A-Za-z0-9.-]+(?::[0-9]+)?(?:\/[A-Za-z0-9._~-]+)+\/?$/;
const RAMO = /^[A-Za-z0-9._/-]+$/;

/** Apaga a pasta do clone que falhou e tira o registro dela (a pasta acabou de nascer, e e do sworn). */
function desfazer(registro, env) {
  try { apagarPasta(registro.caminho, { maxRetries: 3, retryDelay: 100 }); } catch (e) { /* fica para a limpeza */ }
  if (fs.existsSync(registro.caminho)) return;
  try {
    comRegistro(env, function (lista) {
      return lista.filter(function (r) { return chave(r.caminho) !== chave(registro.caminho); });
    });
  } catch (e) { /* o registro de pasta que sumiu sai na proxima limpeza */ }
}

/**
 * R1: clona a referencia para ler (so https, uma revisao, sem tags nem submodulos, sem os filtros do Git LFS e sem
 * link simbolico) numa pasta nova da temporaria, ja no registro, e devolve a pasta e o commit lido. `opcoes`: `ref`
 * (ramo ou tag), `sessao` e `aceitarLocal` (so os testes: um repositorio local no lugar do https).
 */
function clonar(url, opcoes, env) {
  const o = opcoes || {};
  const local = o.aceitarLocal === true && typeof url === 'string' && path.isAbsolute(url);
  if (!local && (typeof url !== 'string' || !URL_ESTUDO.test(url))) {
    return falha('o endereco do estudo tem de ser https://<servidor>/<dono>/<repo>, sem espaco nem opcao: ' + url);
  }
  if (o.ref !== undefined && (typeof o.ref !== 'string' || !RAMO.test(o.ref) || o.ref.startsWith('-') ||
    o.ref.indexOf('..') !== -1)) {
    return falha('o ramo tem de ser um nome simples (letras, numeros, . _ / -), sem comecar por -: ' + o.ref);
  }
  const nome = (String(url).replace(/\.git\/?$/i, '').split(/[\\/]/).filter(Boolean).pop() || 'repo')
    .toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40);
  let pasta;
  try { pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-estudo-' + nome + '-')); } catch (e) {
    return falha('a pasta do estudo nao se cria: ' + causa(e));
  }
  const reg = registrar(pasta, 'estudo', { sessao: o.sessao }, env);
  if (!reg.ok) {
    try { apagarPasta(pasta); } catch (e) { /* vazia */ }
    return reg;
  }
  const args = ['-c', 'protocol.allow=never', '-c', (local ? 'protocol.file.allow' : 'protocol.https.allow') + '=always',
    '-c', 'core.symlinks=false', 'clone', '--depth', '1', '--no-tags', '--single-branch', '--quiet']
    .concat(o.ref ? ['--branch', o.ref] : [], ['--', url, reg.registro.caminho]);
  const r = gitLib.rodar(null, args, { timeout: PRAZO_CLONE_MS, env: { GIT_LFS_SKIP_SMUDGE: '1', GIT_TERMINAL_PROMPT: '0' } });
  if (r.status !== 0) {
    desfazer(reg.registro, env);
    return falha('o git clone falhou (confira o endereco, o ramo e a rede; repositorio privado nao se clona daqui): ' +
      String(r.stderr || (r.error && r.error.message) || 'sem saida').trim().slice(0, 500));
  }
  // a marca da pasta de novo, agora cheia: onde a hora de criacao vem da ultima mudanca (o Linux sem statx), o clone
  // a mudou, e a limpeza tomaria a pasta por outra
  const cheia = registrar(reg.registro.caminho, 'estudo', { sessao: o.sessao }, env);
  const commit = git(reg.registro.caminho, ['rev-parse', 'HEAD']);
  const saida = { ok: true, pasta: reg.registro.caminho, commit: commit ? commit.trim() : null, url: url };
  if (!cheia.ok) saida.aviso = 'a marca da pasta nao se atualizou no registro: ' + cheia.erro;
  if (!commit) saida.aviso = 'o commit lido nao se leu (git rev-parse HEAD falhou): cite a pasta, sem o commit';
  return saida;
}

module.exports = {
  TIPOS, arquivoDoRegistro, listar, registrar, limpar, emSegundoPlano, executaNoEstudo, motivoDoEstudo, clonar
};
