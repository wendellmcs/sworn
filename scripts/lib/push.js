'use strict';
// V4 (colheita lote 5, D846): o cartao antes do push. Publicar e decisao vista, nao comando: todo `git push` sem a
// marca e negado com o que ele levaria (destino, commits, arquivos, autores e a sanitacao deles); o mesmo push com a
// marca "# sworn: push-visto" no fim passa, depois que o dono viu o cartao. Mora no portao de commit (portao-commit.js):
// nao e trava nova, e `"portaoCommit": false` o desliga junto.
const git = require('./git.js');
const commit = require('./commit.js');
const escopo = require('./escopo.js');

// A grafia que o cartao manda escrever; o MARCA_RE aceita a mesma marca com outro espacamento.
const MARCA = '# sworn: push-visto';
const MARCA_RE = /#\s*sworn:\s*push-visto\b/;
const MAX_COMMITS = 5;
const MAX_ARQUIVOS = 8;
// O conteudo varrido para a sanitacao: os arquivos do push, ate este teto (o portao tem prazo de gancho).
const TETO_DA_VARREDURA = 200;
const BUFFER_DO_LOG = 16 * 1024 * 1024;
// O achado de sanitacao num autor (superficie 2 do sanitacao.js) aponta o autor pelo numero na lista do cartao.
const SUPERFICIE_AUTOR = 2;

// A2-10/A2-20 (H1): o `git push` se le pelo mesmo leitor de shell do commit.js (commit.chamadaGit): opcoes globais
// antes (tambem com o valor separado, `--git-dir X`), depois de cd, encadeado, dentro de bash -c ou eval. `ferramenta`
// ('Bash' ou 'PowerShell', a do gancho) escolhe o idioma; sem ela, valem as regras do commit.js.

/** O comando roda um `git push`? Entre aspas, em heredoc ou em comentario nao conta. */
function ehPush(comando, ferramenta) {
  return commit.chamadaGit(comando, ferramenta, 'push') !== null;
}

/** A marca do push visto, num comentario do comando (entre aspas nao vale). */
function visto(comando, ferramenta) {
  return commit.temMarca(comando, ferramenta, MARCA_RE);
}

/** Os argumentos do push, sem as aspas. O comentario da marca e o redirecionamento (`2>&1`, `> saida`) nao sao
 *  argumentos: o leitor de shell os separa das palavras. */
function argumentos(comando, ferramenta) {
  const g = commit.chamadaGit(comando, ferramenta, 'push');
  return g ? g.args.map(function (a) { return a.t; }) : [];
}

// As opcoes que o cartao destaca, e as que levam valor (o valor nao e o remoto). O --force-if-includes sozinho nao
// forca: so endurece o --force-with-lease, que ja tem o aviso dele.
const AVISOS = [
  { re: /^(?:-f|--force)$/, txt: '--force: reescreve o historico do remoto' },
  { re: /^--force-with-lease(?:=|$)/, txt: '--force-with-lease: reescreve o historico do remoto se ele nao mudou' },
  { re: /^(?:-d|--delete)$/, txt: '--delete: apaga o ramo no remoto' },
  { re: /^--mirror$/, txt: '--mirror: o remoto fica igual a este repositorio, apagando o que so ele tem' },
  { re: /^--(?:all|branches)$/, txt: '--all/--branches: todos os ramos' },
  { re: /^--tags$/, txt: '--tags: todas as tags' }
];
const COM_VALOR = /^(?:-o|--push-option|--repo|--receive-pack|--exec)$/;
// O push que leva todos os ramos ou tags: o cartao nao confere uma faixa so.
const TODOS = /^--(?:all|branches|mirror|tags)$/;

/** { remoto, refs, opcoes, avisos, todos } do push: o primeiro argumento que nao e opcao e o remoto; os outros, as
 *  refspecs, ja sem o `+` da frente. */
function ler(comando, ferramenta) {
  const args = argumentos(comando, ferramenta);
  const opcoes = [];
  const soltos = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { soltos.push.apply(soltos, args.slice(i + 1)); break; }
    if (/^-/.test(a)) {
      opcoes.push(a);
      if (COM_VALOR.test(a) && i + 1 < args.length) i++;
      continue;
    }
    soltos.push(a);
  }
  const brutas = soltos.slice(1);
  // Um `+` na frente da refspec tambem forca, so naquele ramo.
  const avisos = AVISOS.filter(function (x) { return opcoes.some(function (o) { return x.re.test(o); }); })
    .map(function (x) { return x.txt; });
  if (brutas.some(function (r) { return r.charAt(0) === '+'; })) avisos.push('+ na refspec: reescreve o historico do remoto naquele ramo');
  if (brutas.some(function (r) { return /^\+?:/.test(r); })) avisos.push(':ramo na refspec: apaga o ramo no remoto');
  return {
    remoto: soltos[0] || null,
    refs: brutas.map(function (r) { return r.replace(/^\+/, ''); }),
    opcoes: opcoes,
    avisos: avisos,
    todos: opcoes.some(function (o) { return TODOS.test(o); })
  };
}

/** O endereco sem usuario nem senha: `https://x:token@host/r.git` vira `https://host/r.git`, ate com `@` na senha. */
function semCredencial(url) {
  return String(url || '').trim().replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, '$1');
}

function porNulo(s) {
  return s === null ? null : String(s).split('\0').map(function (l) { return l.replace(/^\n+/, ''); })
    .filter(function (l) { return l !== ''; });
}

/**
 * O que o push levaria. `cwd` e a pasta do push. Tudo vem do git local, pelo que ele sabe do remoto: os commits que
 * nenhum ramo daquele remoto tem. O que nao foi conferido fica null, com o porque em `porQue` (commits e arquivos) e
 * em `porQueSanitacao`. `ferramenta`: a do gancho, que da o idioma do comando.
 */
function levantar(cwd, comando, classes, ferramenta) {
  const p = ler(comando, ferramenta);
  const r = { remoto: p.remoto, url: null, ramo: null, avisos: p.avisos, semNome: false, todos: p.todos, porQue: null,
    commits: null, arquivos: null, autores: null, sanitacao: null, porQueSanitacao: null, varridos: 0 };
  const ramoLocal = (git.correr(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']) || '').trim() || null;
  if (!r.remoto && ramoLocal && ramoLocal !== 'HEAD') {
    // O remoto padrao do ramo, pela configuracao dele (o nome do remoto pode ter barra).
    r.remoto = (git.correr(cwd, ['config', '--get', 'branch.' + ramoLocal + '.remote']) || '').trim() || null;
    if (r.remoto) r.ramo = (git.correr(cwd, ['config', '--get', 'branch.' + ramoLocal + '.merge']) || '').trim()
      .replace(/^refs\/heads\//, '') || null;
  }
  if (!r.remoto) { r.porQue = 'sem destino'; return r; }
  if (!r.ramo) r.ramo = p.refs.length ? p.refs.join(' ') : ramoLocal;
  const fontes = p.refs.length ? p.refs.map(function (x) { return x.split(':')[0]; }).filter(Boolean) : [ramoLocal || 'HEAD'];
  // Argumento que comeca com "-" o git leria como opcao (`+--output=arquivo` grava arquivo): nao vai ao git.
  if (/^-/.test(r.remoto) || fontes.some(function (f) { return /^-/.test(f); })) {
    r.porQue = 'o remoto ou um ramo do comando comeca com "-", e o git o leria como opcao; confira esse nome no comando';
    return r;
  }
  // O remoto pode ser um endereco escrito no comando, e nao um nome.
  const url = git.correr(cwd, ['remote', 'get-url', '--push', r.remoto]);
  r.url = semCredencial(url === null ? r.remoto : url);
  if (url === null) {
    r.semNome = true;
    r.porQue = '"' + semCredencial(r.remoto) + '" nao e um remoto deste repositorio, ou o git nao respondeu (confira com git remote -v)';
    return r;
  }
  if (r.todos) { r.porQue = 'o push leva todos os ramos ou tags; publique um ramo por vez para o cartao conferir'; return r; }
  if (!fontes.length) { r.porQue = 'o push so apaga ramo no remoto'; return r; }
  const faixa = fontes.concat(['--not', '--remotes=' + r.remoto]);
  const log = git.correr(cwd, ['log', '-z', '--format=%h%x01%an <%ae>%x01%B'].concat(faixa), { maxBuffer: BUFFER_DO_LOG });
  if (log === null) { r.porQue = 'o git log nao respondeu; confira se o ramo existe (git branch) e repita o push'; return r; }
  r.commits = log.split('\0').filter(function (b) { return b.trim() !== ''; }).map(function (b) {
    const c = b.replace(/^\s+/, '').split('\u0001');
    return { sha: c[0], autor: c[1] || '', texto: c[2] || '' };
  });
  r.autores = Array.from(new Set(r.commits.map(function (c) { return c.autor; })));
  // -z: o nome sai cru, sem as aspas e os escapes que o git poe no acento.
  const nomes = porNulo(git.correr(cwd, ['log', '-z', '--name-only', '--format='].concat(faixa), { maxBuffer: BUFFER_DO_LOG }));
  if (nomes === null) r.porQue = 'o git log da lista de arquivos nao respondeu; repita o push';
  else r.arquivos = Array.from(new Set(nomes));
  if (!r.arquivos) { r.porQueSanitacao = 'sem a lista de arquivos'; return r; }
  if (!Array.isArray(classes)) { r.porQueSanitacao = 'sem as classes da sanitacao'; return r; }
  const san = require('./sanitacao.js');
  const raiz = commit.topo(cwd);
  const varrer = raiz ? r.arquivos.slice(0, TETO_DA_VARREDURA) : [];
  r.varridos = varrer.length;
  r.sanitacao = san.varrerAutores(r.autores, classes)
    .concat(san.varrerMensagens(r.commits.map(function (c) { return { sha: c.sha, texto: c.texto }; }), classes))
    .concat(raiz ? san.varrerArquivos(raiz, varrer, classes, [], []) : []);
  return r;
}

function citar(itens, max, fmt) {
  const l = itens.slice(0, max).map(function (i) { return '  - ' + fmt(i); });
  if (itens.length > max) l.push('  ... e mais ' + (itens.length - max));
  return l;
}

/** O cartao, em ASCII como todo aviso do sworn. Achado de sanitacao sai com a classe e o lugar, sem o trecho; o
 *  assunto do commit com achado na mensagem tambem fica de fora. */
function cartao(r) {
  const a = escopo.ascii;
  const remoto = r.remoto ? semCredencial(r.remoto) : null;
  const l = ['sworn - cartao antes do push: confira o que sai antes de publicar.', ''];
  l.push(remoto ? 'Destino: ' + a(remoto) + (r.url && r.url !== remoto ? ' (' + a(r.url) + ')' : '') +
    (r.ramo ? ', ' + a(r.ramo) : '') : 'Destino: nao achado. Diga o remoto e o ramo no comando (git push origin <ramo>) ' +
    'para o cartao conferir; sem eles, o git escolhe o destino sozinho, pela configuracao push.default.');
  if (r.avisos.length) {
    l.push('Atencao:');
    l.push.apply(l, r.avisos.map(function (x) { return '  - ' + x; }));
  }
  if (r.commits === null) {
    l.push('Commits, arquivos e sanitacao: nao conferidos (' + a(r.porQue || 'o git nao respondeu') + ').');
  } else {
    const comAchado = (r.sanitacao || []).filter(function (x) { return x.superficie !== SUPERFICIE_AUTOR; })
      .map(function (x) { return x.arquivo; });
    l.push('Commits que saem: ' + r.commits.length + ' (pelo que este repositorio sabe do remoto; um git fetch antes ' +
      'atualiza a conta)');
    l.push.apply(l, citar(r.commits, MAX_COMMITS, function (c) {
      if (comAchado.indexOf('(mensagem de commit ' + c.sha + ')') !== -1) return a(c.sha) + ' (assunto omitido: a mensagem tem achado da sanitacao)';
      return a(c.sha + ' ' + String(c.texto).split(/\r?\n/)[0]).slice(0, 110);
    }));
    if (r.arquivos) {
      l.push('Arquivos: ' + r.arquivos.length);
      l.push.apply(l, citar(r.arquivos, MAX_ARQUIVOS, function (f) { return a(f); }));
    } else {
      l.push('Arquivos: nao conferidos (' + a(r.porQue || 'o git nao respondeu') + ').');
    }
    l.push('Autores: ' + (r.autores.length ? r.autores.map(function (x, i) { return (i + 1) + ') ' + a(x); }).join('; ') : 'nenhum'));
    if (r.sanitacao === null) {
      l.push('Sanitacao: nao conferida (' + a(r.porQueSanitacao || 'nao rodou') + ').');
    } else {
      const escopoDaVarredura = 'autores, mensagens e o conteudo de ' + r.varridos + ' arquivo(s) no disco' +
        (r.arquivos && r.arquivos.length > r.varridos ? ', dos ' + r.arquivos.length : '');
      if (!r.sanitacao.length) l.push('Sanitacao (' + escopoDaVarredura + '): nada achado.');
      else {
        l.push('Sanitacao (' + escopoDaVarredura + '): ' + r.sanitacao.length + ' achado(s), sem o trecho:');
        l.push.apply(l, citar(r.sanitacao, MAX_ARQUIVOS, function (x) {
          const lugar = x.superficie === SUPERFICIE_AUTOR ? 'autor ' + x.linha + ' da lista acima' : x.arquivo + ':' + x.linha;
          return a(x.nome + ': ' + lugar);
        }));
      }
    }
  }
  l.push('', 'Mostre este cartao ao dono. Com o sim do dono, repita o mesmo push com "' + MARCA + '" no fim do comando.');
  return l.join('\n');
}

/** A pasta do push: o `git -C <pasta>` dele, ou o ultimo `cd` antes; sem nenhum, null (o commit.js le do mesmo jeito). */
function pastaDoPush(comando, ferramenta) {
  return commit.pastaDoComando(comando, ferramenta, 'push');
}

module.exports = { MARCA, ehPush, visto, argumentos, ler, semCredencial, levantar, cartao, pastaDoPush, TETO_DA_VARREDURA };
