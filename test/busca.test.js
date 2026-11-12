'use strict';
const test = require('node:test');
const assert = require('node:assert');
const busca = require('../scripts/lib/busca.js');

/**
 * C9 - "eu prefiro criar arquivo novo a entender o que ja existe".
 * A autoavaliacao exigia "busca citada antes de arquivo novo"; ate aqui isso era
 * so uma regra de texto em modelos/regras.md.
 */

test('busca: Grep e Glob contam como ter procurado', () => {
  assert.strictEqual(busca.ehBusca('Grep', {}), true);
  assert.strictEqual(busca.ehBusca('Glob', {}), true);
});

test('busca: o nome da ferramenta nao diferencia caixa', () => {
  assert.strictEqual(busca.ehBusca('grep', {}), true);
  assert.strictEqual(busca.ehBusca('GREP', {}), true);
});

test('busca: Write e Edit NAO sao busca (controle)', () => {
  assert.strictEqual(busca.ehBusca('Write', { file_path: 'a.js' }), false);
  assert.strictEqual(busca.ehBusca('Edit', { file_path: 'a.js' }), false);
});

test('busca: Bash conta pelo COMANDO, nao pelo nome da ferramenta', () => {
  assert.strictEqual(busca.ehBusca('Bash', { command: 'grep -rn foo src/' }), true);
  assert.strictEqual(busca.ehBusca('Bash', { command: 'rg --files' }), true);
  assert.strictEqual(busca.ehBusca('Bash', { command: 'git ls-files' }), true);
});

test('busca: Bash destrutivo NAO conta como busca (controle)', () => {
  assert.strictEqual(busca.ehBusca('Bash', { command: 'rm -rf build' }), false);
  assert.strictEqual(busca.ehBusca('Bash', { command: 'npm install' }), false);
});

test('busca: Bash sem comando nenhum nao conta (controle)', () => {
  assert.strictEqual(busca.ehBusca('Bash', {}), false);
  assert.strictEqual(busca.ehBusca('Bash', null), false);
});

test('busca: o comando tem de comecar palavra - "regrep" nao e grep (controle)', () => {
  assert.strictEqual(busca.ehBusca('Bash', { command: 'regrep foo' }), false);
  assert.strictEqual(busca.ehBusca('Bash', { command: 'meufind .' }), false);
});

test('busca: grep depois de cano ou ; conta', () => {
  assert.strictEqual(busca.ehBusca('Bash', { command: 'cat a | grep b' }), true);
  assert.strictEqual(busca.ehBusca('Bash', { command: 'cd x; find . -name "*.js"' }), true);
});

test('busca: ferramenta desconhecida nao conta (controle)', () => {
  assert.strictEqual(busca.ehBusca('WebFetch', { url: 'x' }), false);
  assert.strictEqual(busca.ehBusca(null, null), false);
});

test('busca: motivo diz que editar existente NAO exige busca', () => {
  const m = busca.motivo('src/novo.js');
  assert.ok(m.includes('src/novo.js'));
  assert.ok(/quem edita ja achou/i.test(m), 'a recusa tem de dizer o que NAO e barrado');
  // A falha de origem vai em palavras: o codigo da autoavaliacao nao vai a publico,
  // e quem le a recusa nao teria onde procura-lo (ronda 1 do Passo 8b).
  assert.ok(/criar arquivo novo em vez de entender o que ja existe/.test(m), 'a recusa cita a falha de origem');
  assert.ok(!/"eu prefiro/.test(m), 'F1-H08: a frase em primeira pessoa e do catalogo de falhas, nao da recusa');
});

// A4-30 (pedido 12, microcopy): a recusa diz o motivo e o passo sem o jargao do projeto.
test('A4-30: a recusa de arquivo novo diz o motivo e o passo sem "falha de origem" nem "portao"', () => {
  const m = busca.motivo('src/novo.js');
  assert.ok(!/falha de origem|portao/i.test(m), m);
  assert.ok(m.includes('Por que: o risco e criar arquivo novo em vez de entender o que ja existe.'), m);
  assert.ok(m.includes('crie: depois de uma busca neste turno, criar arquivo novo fica liberado.'), m);
});

// A4-104 (pedido 12, microcopy): a 1a linha era "sworn: NEGADO - ...", fora da forma unica, e nao dizia o passo.
test('A4-104: a 1a linha da recusa de arquivo novo segue a forma unica e diz o passo', () => {
  const l1 = busca.motivo('src/novo.js').split('\n')[0];
  assert.match(l1, /^sworn - \S.*\.$/, l1);
  assert.ok(!/NEGADO/.test(l1), l1);
  assert.ok(/sem ter procurado/.test(l1) && /procure/.test(l1), l1);
  // A4-124: a palavra de bloqueio na 1a linha, como as travas 5 e 8 (sem ela, soa como conselho).
  assert.match(l1, /^sworn - arquivo novo barrado \(trava 7\): /, l1);
});

// ── regressao: furo achado na auditoria de 2026-09-02 ───────────────────────

test('busca REGRESSAO: comando que ESCREVE nao e passe para criar', () => {
  // `sed -i` altera arquivo. Aceitar um comando de escrita como "ja procurei"
  // seria o portao se abrindo com a propria chave.
  assert.strictEqual(busca.ehBusca('Bash', { command: 'sed -i s/x/y/ a.js' }), false);
  assert.strictEqual(busca.ehBusca('Bash', { command: 'awk "{print}" a.js' }), false);
  // e o que so le continua contando
  assert.strictEqual(busca.ehBusca('Bash', { command: 'cat a.js' }), true);
  assert.strictEqual(busca.ehBusca('Bash', { command: 'tail -20 a.js' }), true);
});

// F1-C11: 'search' e 'ls' nao sao ferramentas que nenhum hook entregue (hooks.json so escuta
// Write|Edit|Bash|PowerShell|Grep|Glob|Read): contavam como busca sem poder ser chamadas.
test('busca: FERRAMENTAS so lista o que o hook entrega (Grep, Glob, Read)', () => {
  assert.deepStrictEqual(busca.FERRAMENTAS, ['grep', 'glob', 'read']);
  assert.strictEqual(busca.ehBusca('Search', {}), false);
  assert.strictEqual(busca.ehBusca('LS', {}), false);
  assert.strictEqual(busca.ehBusca('Read', {}), true, 'controle: o que fica continua contando');
});

// A4-bus-1 (pedido 12, seguranca): `find` com -delete/-exec/-execdir/-ok/-okdir (e `fd -x/-X/--exec`) altera ou roda
// comando por si e contava como busca - o portao de arquivo novo abria com o mesmo tipo de chave que o `sed -i`.
test('A4-bus-1: find que apaga ou executa NAO e passe para criar; find que so lista segue contando', () => {
  [
    'find . -name "*.tmp" -delete',
    'find . -type f -exec rm {} \;',
    'find src -execdir touch novo.js \;',
    'find . -ok rm {} \;',
    'find . -okdir rm {} \;',
    'ls && find . -delete',
    'fd tmp -x rm',
    'fd tmp -X rm',
    'fd tmp --exec rm',
    'fd tmp --exec-batch rm'
  ].forEach((c) => assert.strictEqual(busca.ehBusca('Bash', { command: c }), false, c));
  assert.strictEqual(busca.ehBusca('PowerShell', { command: 'find . -delete' }), false);
  ['find . -name "*.js"', 'fd busca src', 'find . -name x | grep -c y', 'find . -executable'].forEach((c) =>
    assert.strictEqual(busca.ehBusca('Bash', { command: c }), true, c));
});

// s351 (D786 passo 5, ao vivo cx6): no Windows o Codex procura pelo PowerShell (Get-ChildItem, Select-String), e a
// busca nao contava: a trava 7 barrou o apply_patch do handoff e o modelo gravou pelo shell, sem a marca.
test('busca: os cmdlets de busca do PowerShell contam, em qualquer caixa', () => {
  ['Get-ChildItem .sworn -Recurse -File', 'get-childitem src', 'gci -Recurse', 'Select-String -Path *.js -Pattern x',
    'sls foo a.md', 'Get-Content plano.md', '$x = Get-ChildItem .; $x', 'GCI -RECURSE', 'SLS foo a.md',
    'ls | %{sls foo $_}', '%{sls foo $_}', 'sls del src/x.js', 'Select-String -Pattern erase .',
    'Get-Content a.md 2>&1', 'gci | % { $_.Name -> 1 }'].forEach((c) =>
    assert.strictEqual(busca.ehBusca('PowerShell', { command: c }), true, c));
  // A palavra que altera, como argumento, e o que se procura; o 2> nao grava (controle do Bash).
  ['grep -rn del src', 'rg erase scripts', 'grep -rn "rm -rf" .', 'grep foo src 2>/dev/null', 'ls 2>&1'].forEach((c) =>
    assert.strictEqual(busca.ehBusca('Bash', { command: c }), true, c));
});

test('busca: o cmdlet de busca que despeja no Remove-Item nao conta; nome parecido tambem nao (controle)', () => {
  ['Get-ChildItem *.tmp | Remove-Item', 'gci build -Recurse | ri', 'Get-ChildItem x |Remove-Item',
    'Get-ChildItemX', 'New-Item a.md', 'Set-Content a.md x', 'gci src | Set-Content x.txt', 'Remove-Item (gci *.tmp)',
    'gci -r | % { ri $_ }', 'gci -r | %{ri $_}', 'Get-Content a.md | Out-File b.md', 'Select-String x a.md; del a.md',
    'Get-ChildItem . | Move-Item -Destination z', 'gci src | rm -Force', 'gci . | % { rm $_ }',
    'Get-ChildItem src > lista.txt', 'sls foo *.js >> x.md', 'dir *.tmp | Remove-Item', 'ls src | Set-Content x.txt',
    'gci x\nRemove-Item y', 'gci x && del y', '$(rm x); gci'].forEach((c) =>
    assert.strictEqual(busca.ehBusca('PowerShell', { command: c }), false, c));
  ['ls; rm -rf build', 'ls > lista.txt', 'cat a.md | tee b.md'].forEach((c) =>
    assert.strictEqual(busca.ehBusca('Bash', { command: c }), false, c));
});

// s352 (ronda 3 da revisao de busca.js): o que esta entre aspas e o padrao procurado, nao comando nem redirecionamento;
// o comando que altera depois de xargs/sudo, o 1> e o 2> para arquivo, e o metodo .NET que apaga ou grava tambem tiram
// o comando da busca.
test('busca: | ( e > entre aspas sao o padrao procurado e seguem contando', () => {
  ['grep -rnE "foo|del" src', 'rg "(copy|move)" scripts', 'rg "<div>" src', 'grep -rn "Array<string>" src',
    "grep -rn 'a > b' src", 'grep -rn "rm -rf" .'].forEach((c) =>
    assert.strictEqual(busca.ehBusca('Bash', { command: c }), true, c));
  ['Select-String -Pattern "a|ren" .', "sls '(del)' x.js", 'gci src 2>$null', 'gci src 1>&2'].forEach((c) =>
    assert.strictEqual(busca.ehBusca('PowerShell', { command: c }), true, c));
});

test('busca: xargs/sudo antes do comando que altera, 1> e 2> para arquivo, e .Delete() nao contam', () => {
  ['grep -rl foo src | xargs rm', 'find . -name "*.tmp" | xargs rm', 'ls src | xargs -0 rm -f',
    'ls | xargs -I {} mv {} z', 'ls src; sudo rm x', 'ls src 2>err.txt', 'ls src 1> lista.txt', 'ls src 2>> err.txt',
    'ls src &> tudo.txt', 'ls src 2>nul.txt', 'grep "x" a.md > b.md', 'ls; touch novo.js', 'ls; mkdir novo',
    'ls; unlink a.md', 'ls -n 1 | xargs -n 1 rm', 'if ls a; then rm a; fi',
    'for f in $(ls); do rm $f; done'].forEach((c) =>
    assert.strictEqual(busca.ehBusca('Bash', { command: c }), false, c));
  ['Get-ChildItem src 1> lista.txt', 'gci src | ForEach-Object { $_.Delete() }', 'gci *.tmp | % { $_.MoveTo("z") }',
    'gci *.md | % { $_.CopyTo("z") }', 'gci; [IO.File]::WriteAllText("a.md", "x")',
    "gci; [System.IO.File]::Delete('a.md')", "gci; [IO.File]::AppendAllText('a.md', 'x')",
    "gci; [IO.File]::Move('a', 'b')", "gci; [IO.File]::Copy('a', 'b')", "gci; [IO.File]::Create('a.md')"].forEach((c) =>
    assert.strictEqual(busca.ehBusca('PowerShell', { command: c }), false, c));
});

// F3c (D828): a trava 7 procura sozinha. `parecidos` devolve os arquivos de mesmo nome-base (versionados ou na pasta do
// alvo), fora o proprio; sem git, null (a trava cobra a busca como antes).
const { pasta: pastaTemp, repo: repoTemp, rodar: rodarScript } = require('./lib/comum.js');
const fsF3c = require('node:fs');
const pathF3c = require('node:path');

test('F3c: parecidos acha o mesmo nome-base em outra pasta e na pasta do alvo; sem git, null', () => {
  const dir = repoTemp(pastaTemp('busca-f3c'), { 'src/calculo.js': 'x\n', 'lib/outro.js': 'y\n', 'docs/Calculo.md': 'z\n' });
  fsF3c.writeFileSync(pathF3c.join(dir, 'src', 'calculo.ts'), 'nao versionado, na pasta do alvo\n');
  assert.deepStrictEqual(busca.parecidos(dir, 'novo/calculo.py'), ['docs/Calculo.md', 'src/calculo.js']);
  assert.deepStrictEqual(busca.parecidos(dir, 'src/calculo.mjs'), ['docs/Calculo.md', 'src/calculo.js', 'src/calculo.ts']);
  assert.deepStrictEqual(busca.parecidos(dir, 'src/inedito.js'), []);
  // o caminho do Windows, com barra invertida, acha a mesma coisa
  assert.deepStrictEqual(busca.parecidos(dir, 'src\\calculo.mjs'), ['docs/Calculo.md', 'src/calculo.js', 'src/calculo.ts']);
  // o proprio alvo nao conta (ja versionado, mas apagado do disco: criar de novo)
  fsF3c.unlinkSync(pathF3c.join(dir, 'lib', 'outro.js'));
  assert.deepStrictEqual(busca.parecidos(dir, 'lib/outro.js'), []);
  assert.strictEqual(busca.parecidos(pastaTemp('sem-git-f3c'), 'a.js'), null);
  assert.strictEqual(busca.parecidos(dir, ''), null);
  // o limite corta depois de ordenar; limite que nao e inteiro positivo vale 10
  assert.deepStrictEqual(busca.parecidos(dir, 'src/calculo.mjs', 1), ['docs/Calculo.md'], 'o limite');
  // o da pasta do alvo chega depois dos versionados, mas vem antes na ordem: o corte e depois de ordenar
  fsF3c.mkdirSync(pathF3c.join(dir, 'a'));
  fsF3c.writeFileSync(pathF3c.join(dir, 'a', 'calculo.txt'), 'nao versionado\n');
  assert.deepStrictEqual(busca.parecidos(dir, 'a/calculo.py', 1), ['a/calculo.txt'], 'ordena e depois corta');
  for (const torto of [-5, 0, NaN, '2']) {
    assert.strictEqual(busca.parecidos(dir, 'src/calculo.mjs', torto).length, 3, 'limite torto: ' + torto);
  }
  // com 12 parecidos, o padrao e o limite torto cortam em 10 (o aviso diz "ate 10"); um limite maior passa dele
  fsF3c.mkdirSync(pathF3c.join(dir, 'muitos'));
  for (const ext of 'abcdefghijkl') fsF3c.writeFileSync(pathF3c.join(dir, 'muitos', 'taxa.' + ext), 'x\n');
  assert.strictEqual(busca.parecidos(dir, 'muitos/taxa.js').length, 10, 'o padrao corta em 10');
  for (const torto of [-5, 0, NaN, '2', 2.5]) {
    assert.strictEqual(busca.parecidos(dir, 'muitos/taxa.js', torto).length, 10, 'limite torto corta em 10: ' + torto);
  }
  assert.strictEqual(busca.parecidos(dir, 'muitos/taxa.js', 11).length, 11, 'limite maior que 10');
  // uma pasta de mesmo nome nao e arquivo parecido
  fsF3c.mkdirSync(pathF3c.join(dir, 'src', 'calculo'));
  assert.deepStrictEqual(busca.parecidos(dir, 'src/calculo.mjs'), ['docs/Calculo.md', 'src/calculo.js', 'src/calculo.ts']);
  // o alvo fora da raiz nao e lido
  for (const fora of ['../fora/calculo.js', 'src/../../calculo.js', '/tmp/calculo.js', 'C:/x/calculo.js']) {
    assert.strictEqual(busca.parecidos(dir, fora), null, 'fora da raiz: ' + fora);
  }
  // a variante que nasce ao lado da original (o caso do README: utils2.js ao lado do utils.js)
  assert.deepStrictEqual(busca.parecidos(dir, 'lib/outro2.js'), ['lib/outro.js']);
  assert.deepStrictEqual(busca.parecidos(dir, 'src/calculo-novo.js'), ['docs/Calculo.md', 'src/calculo.js', 'src/calculo.ts']);
  assert.deepStrictEqual(busca.parecidos(dir, 'src/calculo_v2.js'), ['docs/Calculo.md', 'src/calculo.js', 'src/calculo.ts']);
  for (const v of ['calculo-copia', 'calculo.old', 'calculo velho', 'calculoNew', 'calculo-v3']) {
    assert.deepStrictEqual(busca.parecidos(dir, 'src/' + v + '.js'), ['docs/Calculo.md', 'src/calculo.js', 'src/calculo.ts'], v);
  }
  // so o nome do ALVO perde o sufixo: o arquivo que ja existe casa pelo nome inteiro (sha256 nao acha sha512; o
  // conta2 acha o conta2 e o conta, nunca o conta3)
  for (const f of ['sha512.txt', 'conta.txt', 'conta2.txt', 'conta3.txt']) fsF3c.writeFileSync(pathF3c.join(dir, 'src', f), 'x\n');
  assert.deepStrictEqual(busca.parecidos(dir, 'src/sha256.js'), []);
  assert.deepStrictEqual(busca.parecidos(dir, 'src/conta2.js'), ['src/conta.txt', 'src/conta2.txt']);
  // so o nome de variante, sem base: sem busca (a trava cobra como antes)
  assert.strictEqual(busca.parecidos(dir, 'src/2.js'), null);
});

test('F3c: pelo portao, a criacao sem busca passa sem parecido e e negada com a lista quando ha', () => {
  const dir = repoTemp(pastaTemp('portao-f3c'), { 'src/calculo.js': 'x\n' });
  const sworn = pathF3c.join(dir, '.claude', 'sworn');
  fsF3c.mkdirSync(sworn, { recursive: true });
  fsF3c.writeFileSync(pathF3c.join(sworn, 'projeto.json'), JSON.stringify({ marchaPadrao: 'padrao' }));
  fsF3c.writeFileSync(pathF3c.join(sworn, 'escopo.md'), '# Escopo\n**Objetivo:** F3c\n## Dentro\n- src/**\n');
  const escrever = (id, rel) => rodarScript('scripts/portao-escopo.js', [], { cwd: dir, env: { SWORN_TMP: pastaTemp('tmp-f3c') },
    entrada: { session_id: id, cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Write',
      tool_input: { file_path: pathF3c.join(dir, rel), content: 'novo\n' } } });
  const negado = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason; } catch (e) { return null; } };
  const passa = escrever('f3c1', 'src/inedito.js');
  assert.strictEqual(passa.status, 0, passa.stderr);
  // liberar e nao escrever nada (o portao sai sem opiniao)
  assert.strictEqual(passa.stdout.trim(), '', 'sem parecido, cria: ' + passa.stdout);
  const nega = negado(escrever('f3c2', 'src/util/calculo.ts'));
  assert.ok(nega && /^sworn - arquivo novo barrado \(trava 7\): ja existe arquivo com o mesmo nome; leia antes/.test(nega), nega);
  assert.ok(/O sworn procurou por voce e achou arquivo\(s\) com o mesmo nome \(ate 10\):\n {2}- src\/calculo\.js\n/.test(nega), nega);
  assert.ok(!/sem ter procurado/.test(nega), 'a lista nao diz que nada foi procurado: ' + nega);
  assert.ok(/^[\n\x20-\x7E]*$/.test(nega), 'ASCII (R5)');
});

test('F3c: o motivo sem lista e o de sempre; com lista, o que diz o que achou', () => {
  const sem = busca.motivo('src/a.js');
  assert.match(sem, /^sworn - arquivo novo barrado \(trava 7\): sem ter procurado/);
  assert.strictEqual(busca.motivo('src/a.js', []), sem);
  assert.strictEqual(busca.motivo('src/a.js', null), sem);
  const com = busca.motivo('src/a2.js', ['src/a.js', 'lib/a.ts']);
  assert.match(com, /\n {2}- src\/a\.js\n {2}- lib\/a\.ts\n/);
  assert.match(com, /Leia esses arquivos/);
});
