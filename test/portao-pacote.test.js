'use strict';
// H6b (15.3): o portao-pacote.js (4o portao do portao-shell.js) avisa o agente do pacote instalado que nao esta no
// manifesto nem no lockfile do projeto, com o comando que confere o nome no registro. Nunca nega, nunca consulta a rede.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const comum = require('./lib/comum.js');
const pacote = require('../scripts/lib/pacote-novo.js');

/** Projeto de teste com projeto.json na raiz (a raiz nao sobe para as pastas da maquina) e os arquivos dados. */
function projeto(nome, arquivos) {
  const dir = comum.pasta('pacote-' + nome);
  fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), '{"marchaPadrao":"padrao"}', 'utf8');
  Object.entries(arquivos || {}).forEach(function ([rel, texto]) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), texto, 'utf8');
  });
  return dir;
}

/** Os pacotes que o comando instala, como `eco:nome`. `ps`: le o comando como PowerShell (sem ele, como Bash). */
function nomes(comando, ps) {
  return pacote.pacotesDoComando(comando, ps).map(function (p) { return p.eco + ':' + p.nome; });
}

/**
 * O gancho com a entrada do PreToolUse. `porProcesso`: a entrada vai em texto, e o ganchoComoProcesso abre um processo
 * (o portao-shell.js chama io.rodarJuntos por dentro, e o rodarJuntos aninhado no processo de teste derruba o runner).
 */
function chamar(script, dir, comando, opcoes) {
  const o = opcoes || {};
  const cwd = o.cwd || dir;
  const entrada = { session_id: 'pp1', cwd: cwd, hook_event_name: 'PreToolUse', tool_name: o.ferramenta || 'Bash',
    tool_input: { command: comando } };
  const r = comum.ganchoComoProcesso(script, o.porProcesso ? JSON.stringify(entrada) : entrada,
    { cwd: cwd, env: Object.assign({}, process.env, { SWORN_TMP: path.join(dir, '_sessoes') }) });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.json || null;
}

function contextoDe(saida) {
  return saida && saida.hookSpecificOutput ? saida.hookSpecificOutput.additionalContext || null : null;
}

test('H6b: cada gerenciador da tabela le o nome do pacote, sem as opcoes nem os valores delas', () => {
  const casos = [
    ['npm i lodash @types/node@20 -D', ['npm:lodash', 'npm:@types/node']],
    ['npm --prefix web install chalk', ['npm:chalk']],
    ['npm install --registry https://r.example zod', ['npm:zod']],
    ['npm.cmd i chalk', ['npm:chalk']],
    ['pnpm add -C web zod', ['npm:zod']],
    ['yarn global add left-pad', ['npm:left-pad']],
    ['bun add hono', ['npm:hono']],
    ['pip install -r req.txt requests==2.0 "Flask_Login>=1"', ['pypi:requests', 'pypi:Flask_Login']],
    ['pip3.12 install rich', ['pypi:rich']],
    ['python -m pip install numpy', ['pypi:numpy']],
    ['py -m pip install -e . scipy', ['pypi:scipy']],
    ['pipx install ruff', ['pypi:ruff']],
    ['uv pip install httpx', ['pypi:httpx']],
    ['uv add --group dev pytest', ['pypi:pytest']],
    ['poetry add -G dev black@^24', ['pypi:black']],
    ['cargo add serde --features derive', ['crates:serde']],
    ['go get -u github.com/a/b/c@v1.2.0 ./...', ['go:github.com/a/b/c']],
    ['dotnet add app.csproj package Newtonsoft.Json -v 13.0.1', ['nuget:Newtonsoft.Json']],
    ['dotnet add package Serilog', ['nuget:Serilog']],
    ['gem install rails -v 7', ['rubygems:rails']],
    ['bundle add rspec --group test', ['rubygems:rspec']],
    ['composer require monolog/monolog "^3.0" php', ['packagist:monolog/monolog']],
    ['bash -c "npm i express"', ['npm:express']],
    ['npm i chalk && npm i chalk', ['npm:chalk']],
    // as opcoes do python antes do -m, e as de valor do pip e do npm que nao estavam na tabela
    ['python -I -m pip install attrs', ['pypi:attrs']],
    ['py -3.12 -m pip install attrs', ['pypi:attrs']],
    ['python -W ignore -X utf8 -m pip install attrs', ['pypi:attrs']],
    ['python3 -mpip install attrs', ['pypi:attrs']],
    ['python -Im pip install attrs', ['pypi:attrs']],
    ['npm install --fetch-retries 5 --audit-level high --scope @x lodash', ['npm:lodash']],
    ['pip install --timeout 60 --retries 3 --exists-action w requests', ['pypi:requests']],
    ['npm install --loglevel warn --before 2024-01-01 lodash', ['npm:lodash']],
    // o mesmo nome no registro com outro separador e outra caixa sai uma vez so
    ['pip install foo-bar Foo_Bar foo.bar', ['pypi:foo-bar']]
  ];
  for (const [comando, esperado] of casos) assert.deepStrictEqual(nomes(comando), esperado, comando);
});

test('H6b: o que nao instala do registro nao conta (sem pacote, caminho, endereco, git, variavel, @none, outro subcomando)', () => {
  const vazios = ['npm install', 'npm ci', 'npm i ./local user/repo git+https://x/y.git file:../z pkg.tgz',
    'npm i $PKG', 'pip install -r requirements.txt', 'pip install ./dist/a.whl https://x/y.tar.gz',
    'cargo add foo --git https://x', 'cargo add bar --path ../bar', 'go get github.com/a/b@none', 'go get ./...',
    'dotnet add reference ../x.csproj', 'bundle add x --git https://x', 'gem install ./a.gem', 'echo go home',
    'git commit -m "npm i lodash"', 'pip list', 'composer require php ext-json', '', '   ',
    'python -c "import pip" install x', 'python -m', 'python -Ic "import pip" install x', 'python -m pip',
    'python -c -m pip install x'];
  for (const comando of vazios) assert.deepStrictEqual(nomes(comando), [], comando);
});

test('H6b: no PowerShell o comando se le pelo idioma dele', () => {
  assert.deepStrictEqual(nomes('npm i chalk; pip install rich', true), ['npm:chalk', 'pypi:rich']);
  // a crase no fim da linha continua o comando no PowerShell; no Bash abre uma substituicao que nao fecha
  assert.deepStrictEqual(nomes('npm i `\nchalk', true), ['npm:chalk']);
  assert.deepStrictEqual(nomes('npm i `\nchalk', false), []);
  assert.deepStrictEqual(nomes("powershell -Command 'npm i zod'", false), ['npm:zod']);
});

test('H6b: o pacote declarado no manifesto ou so no lockfile nao e novo; o nome parecido nao o declara', () => {
  const dir = projeto('declarado', {
    'package.json': JSON.stringify({ dependencies: { 'react-dom': '^18', preact: '^10' }, devDependencies: { vitest: '^1' } }),
    'package-lock.json': JSON.stringify({ packages: { '': { dependencies: { lodash: '^4' } } } }),
    'requirements-dev.txt': 'flask-login>=1\n',
    'go.mod': 'module x\n\nrequire github.com/a/b v1.0.0\n',
    'app.csproj': '<PackageReference Include="Serilog" Version="3" />'
  });
  const novos = pacote.pacotesNovos(pacote.pacotesDoComando(
    'npm i vitest lodash react; pip install Flask_Login; go get github.com/a/b/c github.com/a/bb; dotnet add package Serilog'),
  [dir]).map(function (p) { return p.nome; });
  // react: "react-dom" e "preact" nao o declaram; github.com/a/bb nao e subpasta de github.com/a/b
  assert.deepStrictEqual(novos, ['react', 'github.com/a/bb']);
});

test('H6b: o modulo go sem barra, o manifesto de outra caixa e o manifesto que nao e JSON valido se leem', () => {
  const dir = projeto('bordas', {
    'go.mod': 'module x\n\nrequire example.com v1.0.0\n',
    'cargo.toml': '[dependencies]\nserde = "1"\n',
    'package.json': '{dependencies: lodash'
  });
  const novos = pacote.pacotesNovos(pacote.pacotesDoComando('go get example.com other.org; cargo add serde; npm i lodash'),
    [dir]).map(function (p) { return p.nome; });
  assert.deepStrictEqual(novos, ['other.org']);
});

test('H6b: o arquivo do ecossistema que nao se le entra em naoLidos, e o aviso diz que nao o leu', () => {
  const dir = projeto('nao-lido');
  fs.mkdirSync(path.join(dir, 'package.json')); // nao e arquivo: nao se le
  const naoLidos = [];
  const novos = pacote.pacotesNovos(pacote.pacotesDoComando('npm i zod; pip install rich'), [dir], naoLidos);
  assert.deepStrictEqual(novos.map(function (p) { return p.nome; }), ['zod', 'rich']);
  assert.deepStrictEqual(naoLidos, [path.join(dir, 'package.json')]);
  assert.match(pacote.aviso(novos, naoLidos), /^Nao li \(acima de 64 MB ou ilegivel\), e o pacote pode estar nele: .*package\.json\.$/m);
  assert.doesNotMatch(pacote.aviso(novos, []), /Nao li/);
  assert.match(contextoDe(chamar('scripts/portao-pacote.js', dir, 'npm i zod')), /^Nao li .*package\.json\.$/m);
});

test('H6b: sem manifesto nenhum, todo pacote e novo; a pasta do comando conta ao lado da raiz', () => {
  const dir = projeto('pastas', { 'web/package.json': JSON.stringify({ dependencies: { zod: '^3' } }) });
  const pacotes = pacote.pacotesDoComando('npm i zod');
  assert.deepStrictEqual(pacote.pacotesNovos(pacotes, [dir]).map(function (p) { return p.nome; }), ['zod']);
  assert.deepStrictEqual(pacote.pacotesNovos(pacotes, [dir, path.join(dir, 'web')]), []);
});

test('H6b: o aviso lista ate o teto, nomeia os de fora sem o comando e da o comando de conferencia de cada um', () => {
  const T = pacote.TETO_DO_AVISO;
  const pkgs = function (n) { return Array.from({ length: n }, function (_, i) { return 'pkg' + i; }); };
  const t = pacote.aviso(pacote.pacotesDoComando('npm i ' + pkgs(T + 2).join(' ') + '; cargo add serde'));
  assert.ok(t.indexOf(', e mais 3 sem o comando de conferencia: `pkg' + T + '`, `pkg' + (T + 1) +
    '`, `serde`. O comando segue.') !== -1, t);
  assert.match(t, /^ {2}npm view pkg0 name version/m);
  assert.match(t, new RegExp('^ {2}npm view pkg' + (T - 1) + ' ', 'm'));
  assert.doesNotMatch(t, new RegExp('^ {2}npm view pkg' + T + ' |cargo info', 'm'));
  // na borda do teto: exatamente o teto nao tem "e mais"; um acima tem "e mais 1"
  assert.doesNotMatch(pacote.aviso(pacote.pacotesDoComando('npm i ' + pkgs(T).join(' '))), /e mais/);
  assert.match(pacote.aviso(pacote.pacotesDoComando('npm i ' + pkgs(T + 1).join(' '))),
    new RegExp(', e mais 1 sem o comando de conferencia: `pkg' + T + '`\\. O comando segue\\.'));
  // o comando de cada ecossistema, e a nota de quando ele pode falhar sem o pacote faltar
  const go = pacote.aviso(pacote.pacotesDoComando('go get rsc.io/quote rsc.io/sampler'));
  assert.match(go, /^ {2}go list -m -versions rsc\.io\/quote$/m);
  assert.strictEqual(go.split('confira o modulo').length - 1, 1, 'a nota do go sai uma vez');
  const py = pacote.aviso(pacote.pacotesDoComando('pip install rich; cargo add serde'));
  assert.match(py, /^ {2}pip index versions rich$/m);
  assert.match(py, /https:\/\/pypi\.org\/project\/rich\//);
  assert.match(py, /^ {2}cargo info serde$/m);
  assert.doesNotMatch(pacote.aviso(pacote.pacotesDoComando('npm i zod')), /^ {2}\(/m);
});

test('H6b: o portao avisa o agente do pacote novo, nunca nega, e cala no declarado e no comando que nao instala', () => {
  const dir = projeto('portao', { 'package.json': JSON.stringify({ dependencies: { lodash: '^4' } }) });
  const novo = chamar('scripts/portao-pacote.js', dir, 'npm i lodash chalk');
  assert.ok(novo && novo.hookSpecificOutput, 'o portao nao imprimiu o aviso');
  assert.ok(!novo.hookSpecificOutput.permissionDecision, 'o portao de pacote nunca decide');
  assert.match(contextoDe(novo), /`chalk` \(npm\)/);
  assert.match(contextoDe(novo), /npm view chalk name version/);
  assert.doesNotMatch(contextoDe(novo), /lodash/);
  assert.strictEqual(contextoDe(chamar('scripts/portao-pacote.js', dir, 'npm i lodash')), null);
  assert.strictEqual(contextoDe(chamar('scripts/portao-pacote.js', dir, 'git status')), null);
  // a ferramenta manda no idioma: o mesmo texto, lido como Bash, nao instala nada
  const ps = 'pip install `\nrich';
  assert.match(contextoDe(chamar('scripts/portao-pacote.js', dir, ps, { ferramenta: 'PowerShell' })), /pip index versions rich/);
  assert.strictEqual(contextoDe(chamar('scripts/portao-pacote.js', dir, ps)), null);
  // a entrada sem comando (ou com o comando vazio) passa calada, sem quebrar o shell
  for (const toolInput of [{}, { command: '' }, { command: 42 }]) {
    const r = comum.ganchoComoProcesso('scripts/portao-pacote.js', { session_id: 'pp1', cwd: dir,
      hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: toolInput }, { cwd: dir });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(contextoDe(r.json), null, JSON.stringify(toolInput));
  }
});

test('H6b: o portao le o manifesto da raiz do projeto e o da pasta do comando', () => {
  const dir = projeto('raiz-e-pasta', { 'package.json': JSON.stringify({ dependencies: { lodash: '^4' } }),
    'web/package.json': JSON.stringify({ dependencies: { zod: '^3' } }) });
  const web = path.join(dir, 'web');
  assert.strictEqual(contextoDe(chamar('scripts/portao-pacote.js', dir, 'npm i lodash zod', { cwd: web })), null);
  assert.match(contextoDe(chamar('scripts/portao-pacote.js', dir, 'npm i lodash zod chalk', { cwd: web })),
    /pacote fora do manifesto e do lockfile deste projeto: `chalk` \(npm\)\. O comando segue\./);
});

test('H6b: o portao-shell.js roda o portao de pacote junto dos outros tres', () => {
  const dir = projeto('shell');
  const saida = chamar('scripts/portao-shell.js', dir, 'npm i zzz-inventado', { porProcesso: true });
  assert.ok(saida && saida.hookSpecificOutput, 'o portao-shell nao imprimiu o aviso');
  assert.match(contextoDe(saida), /npm view zzz-inventado/);
  assert.ok(!saida.hookSpecificOutput.permissionDecision);
});
