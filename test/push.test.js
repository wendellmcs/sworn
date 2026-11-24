'use strict';
// V4 (colheita lote 5, D846): o cartao antes do push, no portao de commit.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const comum = require('./lib/comum.js');
const push = require('../scripts/lib/push.js');
const sanitacao = require('../scripts/lib/sanitacao.js');

test('push: o detector acha o git push como o do commit, e a marca so fora de aspas', () => {
  for (const c of ['git push', 'git push origin main', 'git -C pasta push', 'cd a && git push -f origin main',
    'git commit -q -m "x" && git push', 'C:/Git/bin/git.exe push backup master', 'git --no-pager push']) {
    assert.strictEqual(push.ehPush(c), true, c);
  }
  for (const c of ['echo "git push origin main"', 'echo "depois: git push origin main"', 'git pushx', 'git commit -m "git push"', 'git status', '', null, 7]) {
    assert.strictEqual(push.ehPush(c), false, String(c));
  }
  assert.strictEqual(push.visto('git push origin main # sworn: push-visto'), true);
  assert.strictEqual(push.visto('git push origin main #sworn:push-visto'), true);
  assert.strictEqual(push.visto('git push origin "# sworn: push-visto"'), false, 'entre aspas nao e a marca');
  assert.strictEqual(push.visto('git push origin main'), false);
});

// A2-10 (H1): o push se le pelo leitor de shell do commit.js
test('A2-10: o push dentro de bash -c, com opcao global de valor separado e no PowerShell', () => {
  for (const c of ['bash -c "git push origin main"', 'eval git push', 'git --git-dir .git push origin main',
    'git -c a.b=1 -C r push']) {
    assert.strictEqual(push.ehPush(c), true, c);
  }
  assert.strictEqual(push.ehPush("cat <<'EOF'\ngit push origin main\nEOF"), false, 'no heredoc e texto');
  assert.deepStrictEqual(push.argumentos('bash -c "git push origin main"'), ['origin', 'main']);
  assert.deepStrictEqual(push.argumentos('git --git-dir .git push origin main'), ['origin', 'main'], 'o valor da opcao global nao e o remoto');
  assert.deepStrictEqual(push.argumentos("git push origin 'a b' # sworn: push-visto", 'PowerShell'), ['origin', 'a b']);
  assert.deepStrictEqual(push.argumentos('git push origin `\n  main', 'PowerShell'), ['origin', 'main'], 'a continuacao de linha do PowerShell');
  assert.strictEqual(push.visto("git push <<'EOF'\n# sworn: push-visto\nEOF"), false, 'no heredoc nao e a marca');
  assert.strictEqual(push.visto('git push origin main # sworn: push-visto', 'PowerShell'), true);
  assert.strictEqual(push.pastaDoPush('cd a && git -C b push'), 'a/b');
  assert.strictEqual(push.pastaDoPush('git -C x commit -m y && git push'), null, 'o -C do commit nao e a pasta do push');
});

test('push: os argumentos, o remoto, as refspecs e os avisos', () => {
  assert.deepStrictEqual(push.argumentos('git push origin main # sworn: push-visto'), ['origin', 'main']);
  assert.deepStrictEqual(push.argumentos('git push "meu remoto" main && echo ok'), ['meu remoto', 'main']);
  assert.deepStrictEqual(push.argumentos('git push origin main 2>&1'), ['origin', 'main'], 'o redirecionamento nao e refspec');
  assert.deepStrictEqual(push.argumentos('git push origin main > saida.txt'), ['origin', 'main']);
  assert.deepStrictEqual(push.argumentos('git push origin "a > b"'), ['origin', 'a > b'], 'entre aspas o > fica');
  assert.deepStrictEqual(push.ler('git push'), { remoto: null, refs: [], opcoes: [], avisos: [], todos: false });
  const f = push.ler('git push -f -o ci.skip origin main');
  assert.strictEqual(f.remoto, 'origin');
  assert.deepStrictEqual(f.refs, ['main']);
  assert.deepStrictEqual(f.avisos, ['--force: reescreve o historico do remoto'], 'o valor do -o nao e o remoto');
  assert.deepStrictEqual(push.ler('git push --force-with-lease=main origin main').avisos,
    ['--force-with-lease: reescreve o historico do remoto se ele nao mudou']);
  assert.deepStrictEqual(push.ler('git push --force-if-includes origin main').avisos, [], 'sozinho, nao forca');
  const mais = push.ler('git push origin +main');
  assert.deepStrictEqual([mais.avisos, mais.refs], [['+ na refspec: reescreve o historico do remoto naquele ramo'], ['main']]);
  assert.deepStrictEqual(push.ler('git push origin :velho').avisos, [':ramo na refspec: apaga o ramo no remoto']);
  assert.deepStrictEqual(push.ler('git push --delete origin velho').avisos, ['--delete: apaga o ramo no remoto']);
  for (const todos of ['--all', '--branches']) {
    const t = push.ler('git push ' + todos + ' origin');
    assert.deepStrictEqual([t.avisos, t.todos], [['--all/--branches: todos os ramos'], true], todos);
  }
  assert.strictEqual(push.ler('git push --tags origin').todos, true);
  assert.deepStrictEqual(push.ler('git push origin -- -esquisito').refs, ['-esquisito'], 'depois do --, tudo e refspec');
});

test('push: o endereco sai sem usuario nem senha', () => {
  assert.strictEqual(push.semCredencial('https://x-access-token:segredo' + '@' + 'github.com/a/b.git'), 'https://github.com/a/b.git');
  assert.strictEqual(push.semCredencial('https://user@host/r.git\n'), 'https://host/r.git');
  assert.strictEqual(push.semCredencial('https://u:p' + '@' + 'ss' + '@' + 'host/r.git'), 'https://host/r.git', 'o @ na senha tambem sai');
  assert.strictEqual(push.semCredencial('https://host/r' + '@' + 'x.git'), 'https://host/r' + '@' + 'x.git', 'o @ do caminho fica');
  assert.strictEqual(push.semCredencial('git' + '@' + 'github.com:a/b.git'), 'git' + '@' + 'github.com:a/b.git', 'ssh nao tem senha no endereco');
  assert.strictEqual(push.semCredencial('../caminho/local'), '../caminho/local');
});

/** Um repositorio com um remoto nu, o primeiro commit ja publicado e `extras` commits locais por publicar. */
function montar(email, extras) {
  const nu = comum.temporaria('sworn-push-nu-');
  comum.git(nu, ['init', '-q', '--bare', '.']);
  const dir = comum.repo(comum.temporaria('sworn-push-'), { 'a.txt': 'a\n' });
  comum.git(dir, ['config', 'user.email', email]);
  comum.git(dir, ['branch', '-M', 'main']);
  comum.git(dir, ['remote', 'add', 'origin', nu]);
  comum.git(dir, ['push', '-q', '-u', 'origin', 'main']);
  for (const [rel, conteudo, msg] of extras) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), conteudo);
    comum.git(dir, ['add', '-A']);
    comum.git(dir, ['commit', '-q', '-m', msg]);
  }
  return { dir, nu };
}

test('push: o levantamento traz os commits que o remoto nao tem, os arquivos, os autores e a sanitacao', () => {
  const { dir, nu } = montar('ensaio@users.noreply.github.com',
    [['src/b.js', 'b\n', 'segundo'], ['docs/c.md', 'c\n', 'terceiro']]);
  const classes = sanitacao.classes(dir);
  const r = push.levantar(dir, 'git push origin main', classes);
  assert.strictEqual(r.remoto, 'origin');
  assert.strictEqual(r.ramo, 'main');
  assert.strictEqual(r.url, nu);
  assert.deepStrictEqual(r.commits.map(function (c) { return c.texto.trim(); }), ['terceiro', 'segundo']);
  assert.deepStrictEqual(r.arquivos.slice().sort(), ['docs/c.md', 'src/b.js']);
  assert.deepStrictEqual(r.autores, ['ensaio <ensaio@users.noreply.github.com>']);
  assert.deepStrictEqual(r.sanitacao, [], 'noreply e nada no conteudo: limpo');
  assert.strictEqual(r.varridos, 2);
  const c = push.cartao(r);
  assert.match(c, /^sworn - cartao antes do push: confira o que sai antes de publicar\./);
  assert.ok(c.includes('Destino: origin ('), c);
  assert.ok(c.includes('Commits que saem: 2 (pelo que este repositorio sabe do remoto; um git fetch antes atualiza a conta)'), c);
  assert.ok(c.includes('Arquivos: 2'), c);
  assert.ok(c.includes('Autores: 1) ensaio <ensaio@users.noreply.github.com>'), c);
  assert.ok(c.includes('Sanitacao (autores, mensagens e o conteudo de 2 arquivo(s) no disco): nada achado.'), c);
  assert.ok(c.endsWith('Mostre este cartao ao dono. Com o sim do dono, repita o mesmo push com "# sworn: push-visto" no fim do comando.'), c);

  // sem remoto no comando, o remoto padrao do ramo decide; o que ja esta no remoto nao sai
  const padrao = push.levantar(dir, 'git push', classes);
  assert.deepStrictEqual([padrao.remoto, padrao.ramo, padrao.commits.length], ['origin', 'main', 2]);
  // o ramo do destino e o da configuracao, nao o nome do ramo local
  comum.git(dir, ['checkout', '-q', '-b', 'trabalho', '--track', 'origin/main']);
  assert.strictEqual(push.levantar(dir, 'git push', classes).ramo, 'main');
  comum.git(dir, ['checkout', '-q', 'main']);
  comum.git(dir, ['push', '-q', 'origin', 'main']);
  const nada = push.levantar(dir, 'git push', classes);
  assert.deepStrictEqual([nada.commits, nada.arquivos], [[], []]);
  assert.ok(push.cartao(nada).includes('Commits que saem: 0 ('));
});

test('push: o nome com acento chega cru, e o conteudo dele e varrido', () => {
  const { dir } = montar('ensaio@users.noreply.github.com', [['ação.txt', 'x\n', 'acento']]);
  const r = push.levantar(dir, 'git push origin main', sanitacao.classes(dir));
  assert.deepStrictEqual([r.arquivos, r.varridos], [['ação.txt'], 1]);
  assert.ok(push.cartao(r).includes('  - acao.txt'), push.cartao(r));
});

test('push: o cartao acusa o e-mail do autor, o termo privado e a mensagem com achado, sem o trecho, e corta as listas longas', () => {
  const extras = [];
  for (let i = 0; i < 7; i++) extras.push(['f' + i + '.txt', 'x\n', 'commit ' + i]);
  extras.push(['nota.txt', 'fala do ProjetoSecreto aqui\n', 'nota do ProjetoSecreto']);
  const { dir } = montar('pessoa' + '@' + 'empresa.com.br', extras);
  fs.writeFileSync(path.join(dir, '.sanitacao-local.json'), JSON.stringify({ termos: [{ chave: 'projeto', nome: 'projeto interno', padrao: 'ProjetoSecreto' }] }));
  const r = push.levantar(dir, 'git push origin main', sanitacao.classes(dir));
  const c = push.cartao(r);
  assert.ok(c.includes('Commits que saem: 8 ('), c);
  assert.ok(c.split('Arquivos:')[0].includes('  ... e mais 3'), 'os commits param em 5: ' + c);
  assert.ok(/Sanitacao \(autores, mensagens e o conteudo de 8 arquivo\(s\) no disco\): \d+ achado\(s\), sem o trecho:/.test(c), c);
  assert.ok(c.includes('e-mail no metadado de commit: autor 1 da lista acima'), c);
  assert.ok(c.includes('nota.txt:1'), c);
  assert.ok(c.includes(' (assunto omitido: a mensagem tem achado da sanitacao)'), c);
  assert.ok(!/ProjetoSecreto/.test(c), 'o trecho privado nao entra em parte nenhuma do cartao: ' + c);
});

test('push: o remoto que nao existe, o push de todos os ramos, o endereco com senha e o sem destino', () => {
  const { dir } = montar('ensaio@users.noreply.github.com', [['b.txt', 'b\n', 'b']]);
  const semNome = push.levantar(dir, 'git push outro main', []);
  assert.strictEqual(semNome.commits, null);
  assert.ok(push.cartao(semNome).includes('"outro" nao e um remoto deste repositorio, ou o git nao respondeu (confira com git remote -v)'));
  const semRamo = push.cartao(push.levantar(dir, 'git push origin ramo-que-nao-existe', []));
  assert.ok(semRamo.includes('nao conferidos (o git log nao respondeu; confira se o ramo existe (git branch) e repita o push)'), semRamo);
  for (const todos of ['--all', '--branches']) {
    const c = push.cartao(push.levantar(dir, 'git push ' + todos + ' origin', []));
    assert.ok(c.includes('nao conferidos (o push leva todos os ramos ou tags; publique um ramo por vez para o cartao conferir)'), c);
    assert.ok(c.includes('  - --all/--branches: todos os ramos'), c);
  }
  // a senha do endereco salvo e a do endereco escrito no comando nao saem no cartao
  const noComando = push.cartao(push.levantar(dir, 'git push https://x:segredo456' + '@' + 'exemplo.invalid/r.git main', []));
  assert.ok(!noComando.includes('segredo456'), noComando);
  assert.ok(noComando.includes('Destino: https://exemplo.invalid/r.git, main'), noComando);
  comum.git(dir, ['remote', 'set-url', '--push', 'origin', 'https://x-access-token:segredo123' + '@' + 'exemplo.com/r.git']);
  const salvo = push.cartao(push.levantar(dir, 'git push origin main', []));
  assert.ok(!salvo.includes('segredo123'), salvo);
  assert.ok(salvo.includes('(https://exemplo.com/r.git)'), salvo);
  const vazio = push.cartao(push.levantar(comum.temporaria('sworn-push-fora-'), 'git push', []));
  assert.ok(vazio.includes('Destino: nao achado. Diga o remoto e o ramo no comando (git push origin <ramo>)'), vazio);
  assert.ok(vazio.includes('nao conferidos (sem destino)'), vazio);
});

test('push: a refspec ou o remoto que comeca com "-" nao vira opcao do git', () => {
  const { dir } = montar('ensaio@users.noreply.github.com', [['b.txt', 'b\n', 'b']]);
  const alvo = path.join(dir, 'gravado.txt');
  for (const c of ['git push origin "+--output=' + alvo + '"', 'git push origin -- --output=' + alvo, 'git push -- --output=' + alvo]) {
    const r = push.levantar(dir, c, []);
    assert.strictEqual(r.commits, null, c);
    assert.strictEqual(fs.existsSync(alvo), false, c + ': o git log gravou o arquivo');
    assert.ok(push.cartao(r).includes('o remoto ou um ramo do comando comeca com "-", e o git o leria como opcao; confira esse nome no comando'), c);
  }
});

const PROJETO = { versaoConfig: 1, marchaPadrao: 'padrao', marchas: { rapida: ['**/*.md'] } };

/** O projeto.json do sworn no repositorio, para o portao rodar; devolve o caminho dele. */
function comProjeto(dir) {
  const pj = path.join(dir, '.claude', 'sworn', 'projeto.json');
  fs.mkdirSync(path.dirname(pj), { recursive: true });
  fs.writeFileSync(pj, JSON.stringify(PROJETO));
  return pj;
}

function portao(dir, comando, env) {
  return comum.ganchoComoProcesso('scripts/portao-commit.js', {
    session_id: 'P', cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: comando }
  }, { env: env });
}

function negou(r) {
  return !!(r.json && r.json.hookSpecificOutput && r.json.hookSpecificOutput.permissionDecision === 'deny');
}

function motivoDe(r) {
  return r.json && r.json.hookSpecificOutput ? String(r.json.hookSpecificOutput.permissionDecisionReason || '') : '';
}

/** O portao saiu inteiro (status 0) e nao negou: um gancho que quebra tambem nao nega, e nao pode passar por "passou". */
function passou(r, rotulo) {
  assert.strictEqual(r.status, 0, rotulo + ': ' + r.stderr);
  assert.strictEqual(negou(r), false, rotulo + ': ' + motivoDe(r));
}

test('push: de ponta, o portao nega o push com o cartao e passa com a marca', () => {
  const env = comum.ambiente({ SWORN_TMP: comum.temporaria('sworn-push-tmp-') });
  const { dir } = montar('ensaio@users.noreply.github.com', [['b.txt', 'b\n', 'segundo']]);
  const pj = comProjeto(dir);

  const r = portao(dir, 'git push origin main', env);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(negou(r), 'o push devia ser negado com o cartao');
  assert.ok(motivoDe(r).includes('Commits que saem: 1 ('), motivoDe(r));
  assert.ok(motivoDe(r).includes('  - b.txt'), motivoDe(r));

  for (const c of ['git push origin main # sworn: push-visto', 'git status', 'git log --oneline -1']) passou(portao(dir, c, env), c);
  // o projeto.json se procura a partir da pasta do processo: sem ele ali, o portao nao roda, mesmo com o -C apontando
  // para um repositorio que tem
  passou(portao(comum.temporaria('sworn-push-cwd-'), 'git -C "' + dir + '" push origin main', env), 'sem projeto.json na pasta do processo');
  // com o portao rodando, o cartao e o do repositorio do -C, nao o da pasta do processo
  const outro = montar('ensaio@users.noreply.github.com', [['c.txt', 'c\n', 'terceiro']]).dir;
  const doC = motivoDe(portao(dir, 'git -C "' + outro + '" push origin main', env));
  assert.ok(doC.includes('  - c.txt') && !doC.includes('  - b.txt'), doC);

  fs.writeFileSync(pj, JSON.stringify(Object.assign({ portaoCommit: false }, PROJETO)));
  passou(portao(dir, 'git push origin main', env), 'portaoCommit false desliga o cartao');
  fs.unlinkSync(pj);
  passou(portao(dir, 'git push origin main', env), 'sem projeto.json, nada');
});

test('push: o commit e o push no mesmo comando passam pelos dois portoes, o do commit primeiro', () => {
  const tmp = comum.temporaria('sworn-push-tmp-');
  const env = comum.ambiente({ SWORN_TMP: tmp });
  const { dir } = montar('ensaio@users.noreply.github.com', []);
  comProjeto(dir);
  fs.writeFileSync(path.join(dir, 'x.js'), 'x\n');
  fs.mkdirSync(path.join(tmp, 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'sworn', 'P.json'), JSON.stringify({ arquivosTocados: [path.join(dir, 'x.js')] }));

  const ambos = portao(dir, 'git add x.js && git commit -q -m x && git push origin main', env);
  assert.ok(negou(ambos));
  assert.ok(motivoDe(ambos).includes('"x.js"') && motivoDe(ambos).includes('/sworn:review'), 'o portao do commit nega antes: ' + motivoDe(ambos));
  assert.ok(!motivoDe(ambos).includes('cartao antes do push'), motivoDe(ambos));
  const soPush = portao(dir, 'git add x.js && git commit -q -m x # sworn: sem-revisao\ngit push origin main', env);
  assert.ok(negou(soPush));
  assert.ok(motivoDe(soPush).includes('cartao antes do push'), motivoDe(soPush));
  passou(portao(dir, 'git commit -q -m x # sworn: sem-revisao\ngit push origin main # sworn: push-visto', env), 'as duas marcas');
});

/** A forma que o Git Bash escreve para uma pasta do Windows: `C:\a\b` vira `/c/a/b`. So pasta com letra de disco. */
function doGitBash(p) {
  assert.match(p, /^[A-Za-z]:\\/, 'doGitBash so converte pasta com letra de disco: ' + p);
  return '/' + p[0].toLowerCase() + p.slice(2).replace(/\\/g, '/');
}

// H12d: o `cd /c/...` do Git Bash e a pasta do Windows; o path.resolve sozinho a lia como `C:\c\...`, e o cartao dizia
// que o remoto nao existia, e o portao do commit procurava o repositorio na pasta errada.
test('push: o cd do Git Bash (/c/...) antes do push e do commit e a pasta do Windows', { skip: process.platform !== 'win32' && 'so no Windows' }, () => {
  const tmp = comum.temporaria('sworn-push-tmp-');
  const env = comum.ambiente({ SWORN_TMP: tmp });
  const { dir } = montar('ensaio@users.noreply.github.com', [['b.txt', 'b\n', 'segundo']]);
  comProjeto(dir);
  const outro = montar('ensaio@users.noreply.github.com', [['c.txt', 'c\n', 'terceiro']]).dir;

  // com aspas: a temporaria do sistema pode ter espaco (o perfil do usuario)
  const doCd = motivoDe(portao(dir, 'cd "' + doGitBash(outro) + '"; git push -q origin main', env));
  assert.ok(doCd.includes('  - c.txt') && !doCd.includes('  - b.txt'), doCd);
  assert.ok(!doCd.includes('nao e um remoto deste repositorio'), doCd);

  // o portao do commit cobra so o arquivo tocado no repositorio do cd, nao o do repositorio da pasta do processo
  fs.writeFileSync(path.join(outro, 'x.js'), 'x\n');
  fs.writeFileSync(path.join(dir, 'y.js'), 'y\n');
  fs.mkdirSync(path.join(tmp, 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'sworn', 'P.json'), JSON.stringify({ arquivosTocados: [path.join(outro, 'x.js'), path.join(dir, 'y.js')] }));
  const commit = portao(dir, 'cd "' + doGitBash(outro) + '"; git add x.js && git commit -q -m x', env);
  assert.ok(negou(commit), 'o commit no repositorio do cd devia cobrar a revisao do x.js');
  assert.ok(motivoDe(commit).includes('/x.js"') && !motivoDe(commit).includes('y.js'), motivoDe(commit));
});
