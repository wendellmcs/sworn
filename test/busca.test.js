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
