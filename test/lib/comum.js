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

const criadas = [];
process.on('exit', function () { criadas.forEach(apagar); });

function apagar(dir) {
  // Pasta ainda presa por um processo (EBUSY no Windows) nao pode derrubar o teste na saida: fica para o sistema.
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* fica para o sistema */ }
}

/** Pasta temporaria nova, com `nome` no caminho. Some na saida do processo; o teste pode apaga-la antes. */
function pasta(nome) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-' + nome + '-'));
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
  const prazo = o.prazo || PRAZO;
  const entrada = o.entrada === undefined || typeof o.entrada === 'string' ? o.entrada : JSON.stringify(o.entrada);
  const r = spawnSync(process.execPath, [path.resolve(RAIZ, script)].concat(args || []), {
    cwd: o.cwd,
    encoding: 'utf8',
    input: entrada,
    env: ambiente(o.env),
    timeout: prazo
  });
  r.prazoEstourado = Boolean(r.error && r.error.code === 'ETIMEDOUT');
  r.stdout = r.stdout || '';
  r.stderr = r.stderr || '';
  if (r.prazoEstourado) r.stderr += '\n[comum.rodar] o prazo de ' + prazo + ' ms estourou: ' + script;
  else if (r.error) {
    r.stderr += '\n[comum.rodar] erro ao rodar ' + script + ' em ' + (o.cwd || process.cwd()) + ': ' + r.error.message;
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
 * Faz de `dir` um repositorio git de brinquedo: autor de ensaio, sem conversao de fim de linha e sem assinatura, para
 * a configuracao da maquina nao mudar o teste. Com `arquivos` ({ 'caminho/relativo': conteudo }), grava cada um e faz
 * o commit `base`; sem `arquivos`, ou com `{}`, nao ha commit (o repositorio fica sem HEAD). Devolve `dir`.
 */
function repo(dir, arquivos) {
  git(dir, ['init', '-q', '.']);
  git(dir, ['config', 'user.email', 'ensaio@ensaio']);
  git(dir, ['config', 'user.name', 'ensaio']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
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

module.exports = { RAIZ, PRAZO, pasta, apagar, ambiente, rodar, git, repo, identidadeDeEnsaio };
