'use strict';
const test = require('node:test');
const assert = require('node:assert');
const shell = require('../scripts/lib/shell.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const WIN = { so: 'win32', shell: 'powershell' };
const LINUX = { so: 'linux', shell: 'bash' };

test('shell: em Linux nao aponta nada', () => {
  assert.strictEqual(shell.conferir('rm -rf /tmp/x && echo ok 2>/dev/null', LINUX).length, 0);
});

test('shell: /tmp em Windows e apontado com o equivalente', () => {
  const p = shell.conferir('echo oi > /tmp/a.txt', WIN);
  assert.strictEqual(p.length, 1);
  assert.ok(p[0].sugestao.includes('TEMP'), JSON.stringify(p[0]));
});

test('shell: 2>/dev/null em Windows e apontado', () => {
  const p = shell.conferir('node x.js 2>/dev/null', WIN);
  assert.ok(p.some((x) => x.sugestao.includes('$null')));
});

test('shell: && em PowerShell 5.1 e apontado', () => {
  const p = shell.conferir('npm test && npm run build', { so: 'win32', shell: 'powershell' });
  assert.ok(p.some((x) => x.achado === '&&'));
});

test('shell: comando unix inexistente no PowerShell e apontado', () => {
  for (const cmd of ['which node', 'touch a.txt', 'head -n 5 a.txt', 'tail -n 5 a.txt']) {
    assert.ok(shell.conferir(cmd, WIN).length > 0, 'devia apontar: ' + cmd);
  }
});

test('shell: heredoc em PowerShell e apontado', () => {
  assert.ok(shell.conferir("cat <<'EOF'\na\nEOF", WIN).length > 0);
});

test('shell: comando PowerShell legitimo passa limpo', () => {
  assert.strictEqual(shell.conferir('Get-ChildItem -Recurse | Select-Object -First 5', WIN).length, 0);
  assert.strictEqual(shell.conferir('npm test; if ($?) { npm run build }', WIN).length, 0);
});

test('shell: a palavra dentro de string literal nao e apontada', () => {
  assert.strictEqual(shell.conferir('Write-Output "o caminho /tmp e do Linux"', WIN).length, 0);
});

test('shell: na segunda tentativa o motivo manda TROCAR DE IDIOMA', () => {
  const p = shell.conferir('rm -rf build', WIN);
  const primeiro = shell.motivoIdioma('rm -rf build', p, 1);
  const segundo = shell.motivoIdioma('rm -fr build', p, 2);
  // T1/F1-H08: a frase vira tom normal, sem caixa alta gritada
  assert.ok(!primeiro.includes('Troque de idioma'));
  assert.ok(segundo.includes('Troque de idioma, nao de variacao.'), segundo);
  assert.ok(!segundo.includes('TROQUE DE IDIOMA'), segundo);
  assert.ok(/^[\x20-\x7E\n]+$/.test(segundo), 'motivo tem de ser ASCII (R5)');
});

test('shell: motivo mostra achado e substituto lado a lado', () => {
  const p = shell.conferir('echo oi > /tmp/a.txt', WIN);
  const m = shell.motivoIdioma('echo oi > /tmp/a.txt', p, 1);
  assert.ok(m.includes('/tmp'));
  assert.ok(m.includes('TEMP'));
});

// D244/defeito 4 (D241 secao 2.4): no Windows a ferramenta Bash do harness e Git Bash, onde
// `&&`, `head`, `tail` e `/tmp` existem. A tabela descreve o PowerShell, nao o Git Bash.
test('D244/defeito 4: ferramenta Bash no Windows nao leva a tabela do PowerShell', () => {
  assert.deepStrictEqual(shell.conferir('ls | head -3 && tail x > /tmp/a 2>/dev/null', WIN, 'Bash'), []);
  assert.deepStrictEqual(shell.conferir('ls | head -3', WIN, 'PowerShell').map((p) => p.achado), ['head']);
  // sem ferramenta (chamada antiga): o comportamento de antes
  assert.deepStrictEqual(shell.conferir('ls | head -3', WIN).map((p) => p.achado), ['head']);
});

// D244/achado 13: o corpo de um here-string do PowerShell e texto, nao comando.
test('D244/achado 13: corpo de here-string do PowerShell nao e lido como comando', () => {
  assert.deepStrictEqual(shell.conferir("$js = @'\nconst x = 'head';\nfoo && bar\n'@\nnode -e $js", WIN, 'PowerShell'), []);
  assert.deepStrictEqual(shell.conferir('$t = @"\r\nuse tail aqui\r\n"@\r\nWrite-Output $t', WIN, 'PowerShell'), []);
  // o que esta FORA do here-string continua lido
  assert.deepStrictEqual(shell.conferir("@'\nx\n'@ | Out-Null; ls | head", WIN, 'PowerShell').map((p) => p.achado), ['head']);
});

function hookDestrutivo(ferramenta, comando) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-shell-'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-shell-tmp-'));
  fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'),
    JSON.stringify({ versaoConfig: 1, plataforma: WIN }), 'utf8');
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'portao-destrutivo.js')], {
    input: JSON.stringify({ session_id: 'sh', cwd: dir, hook_event_name: 'PreToolUse', tool_name: ferramenta,
      tool_input: { command: comando } }),
    encoding: 'utf8', env: Object.assign({}, process.env, { SWORN_TMP: tmp })
  });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (e) { json = null; }
  return !!(json && json.hookSpecificOutput && json.hookSpecificOutput.permissionDecision === 'deny');
}

test('D244/defeito 4: pelo hook, Bash passa com && e PowerShell e barrado', { skip: process.platform !== 'win32' }, () => {
  assert.strictEqual(hookDestrutivo('Bash', 'git status && git log -1'), false);
  assert.strictEqual(hookDestrutivo('PowerShell', 'git status && git log -1'), true);
  // controle negativo: o portao DESTRUTIVO continua valendo na ferramenta Bash
  assert.strictEqual(hookDestrutivo('Bash', 'rm -rf build'), true);
});

// 0.3.4/item 2 (D286): o `cd` solto. A pasta persiste entre chamadas nas ferramentas Bash e
// PowerShell, em qualquer SO - por isso a funcao nao olha a tabela do win32.
const SOLTO_BASH = [
  ['cd e &&', 'cd X && y'],
  ['cd com caminho e &&', 'cd "C:/dev/Meu Projeto" && git status'],
  ['cd depois de ;', 'echo a; cd X'],
  ['cd depois de ||', 'test -d X || cd Y'],
  ['cd na linha de baixo', 'echo a\ncd X\ngit status'],
  ['cd com CRLF', 'echo a\r\ncd X\r\ngit status'],
  ['cd sozinho', 'cd'],
  ['cd -', 'cd -'],
  ['pushd', 'pushd X && y'],
  ['pushd depois de ;', 'echo a; pushd X'],
  ['cd dentro de { }: o grupo nao isola', '{ cd X; y; }'],
  ['cd dentro de then', 'if true; then cd X; fi'],
  ['cd depois de subshell fechado', '( cd A && y ) && cd B'],
  ['cd depois de heredoc fechado', "cat <<'EOF'\ncorpo\nEOF\ncd X"],
  ['cd na mesma linha do heredoc', 'cat <<EOF; cd X\ncorpo\nEOF'],
  ['cd depois de continuacao de linha', 'git status \\\n; cd X'],
  ['cd depois de heredoc com traco', 'cat <<-EOF\n\tcorpo\n\tEOF\ncd X'],
  ['<<EOF entre aspas nao abre heredoc', 'echo "usa <<EOF aqui"\ncd X'],
  ['cd depois do segundo heredoc da linha', 'cat <<A <<B\ncorpo\nA\noutro\nB\ncd X']
];
const LIVRE_BASH = [
  ['subshell', '( cd X && y )'],
  ['subshell sem espaco', '(cd X && y)'],
  ['subshell com pwd', 'x=$(cd X; pwd)'],
  ['substituicao dentro de aspas', 'echo "$(cd X; pwd)"'],
  ['crase', 'x=`cd X; pwd`'],
  ['crase com separador antes do cd', 'x=`echo a; cd X; pwd`'],
  ['continuacao com CRLF faz do cd um argumento', 'echo a \\\r\n cd X'],
  ['subshell multilinha', '(\n  cd X\n  y\n)'],
  ['cd entre aspas duplas', 'echo "cd X && y"'],
  ['cd entre aspas simples', "echo 'cd X && y'"],
  ['bash -c', "bash -c 'cd X && y'"],
  ['corpo de heredoc', "cat <<'EOF'\ncd X\nEOF"],
  ['corpo de heredoc sem aspas no marcador', 'cat <<EOF\ncd X && y\nEOF'],
  ['corpo de heredoc com apostrofo e cd', "cat > a.txt <<'EOF'\nnao e d'agua\ncd X\nEOF\ngit status"],
  ['heredoc com traco', 'cat <<-EOF\n\tcd X\n\tEOF\ngit status'],
  ['dois heredocs', 'cat <<A <<B\ncd X\nA\ncd Y\nB\nls'],
  ['palavra terminada em cd', 'abcd'],
  ['comando terminado em cd', 'echo abcd; abcd X'],
  ['opcao --cd', 'git status --cd'],
  ['opcao -cd', 'tool -cd X'],
  ['cd como argumento', 'echo cd X'],
  ['cd como argumento de ls', 'ls cd'],
  ['cd colado em sufixo', 'cd-x && y'],
  ['cdx', 'cdx X'],
  ['cd no comentario', '# cd X\ngit status'],
  ['cd depois de separador dentro do comentario', '# nota: a && cd X\ngit status'],
  ['cd depois de separador no comentario do fim da linha', 'git status # ok; cd X'],
  ['cd depois de # na linha', 'git status # cd X'],
  ['expansao de chave', 'echo {cd,x}'],
  ['variavel chamada cd', 'echo ${cd}'],
  ['git -C no lugar do cd', 'git -C X status'],
  ['sem cd', 'git status && git log -1']
];

test('shell/cdSolto: acha o cd solto no Bash (D286)', () => {
  for (const [nome, cmd] of SOLTO_BASH) {
    const r = shell.cdSolto(cmd, 'Bash');
    assert.ok(r, 'tinha de achar: ' + nome + ' -> ' + JSON.stringify(cmd));
    assert.strictEqual(r.forma, 'bash', nome);
  }
});

test('shell/cdSolto: nao acha cd onde ele nao persiste nem e comando (Bash)', () => {
  for (const [nome, cmd] of LIVRE_BASH) {
    assert.strictEqual(shell.cdSolto(cmd, 'Bash'), null, 'nao tinha de achar: ' + nome + ' -> ' + JSON.stringify(cmd));
  }
});

test('shell/cdSolto: o achado diz qual palavra foi e qual era a forma', () => {
  assert.strictEqual(shell.cdSolto('echo a; pushd X', 'Bash').achado, 'pushd');
  assert.strictEqual(shell.cdSolto('cd X && y', 'Bash').achado, 'cd');
  assert.strictEqual(shell.cdSolto('Set-Location X; y', 'PowerShell').achado, 'Set-Location');
});

const SOLTO_PS = [
  ['cd', 'cd X; y'],
  ['cd ..', 'cd ..'],
  ['cd..', 'cd..; y'],
  ['Set-Location', 'Set-Location X; y'],
  ['Set-Location -LiteralPath', "Set-Location -LiteralPath 'C:\\a b'; node x.js"],
  ['set-location em minusculas', 'set-location X; y'],
  ['SET-LOCATION em maiusculas', 'SET-LOCATION X; y'],
  ['sl', 'sl X; y'],
  ['chdir', 'chdir X; y'],
  ['Push-Location sem Pop', 'Push-Location X; y'],
  ['pushd sem popd', 'pushd X; y'],
  ['bloco & { } nao isola (medido)', '& { Set-Location X }; y'],
  ['cd entre parenteses nao isola', '(cd X); y'],
  ['cd na linha de baixo', "Write-Output a\ncd X\ngit status"],
  ['cd dentro de if', 'if (Test-Path X) { Set-Location X }'],
  ['Pop-Location sem Push nao desfaz o Set-Location', 'Set-Location X; y; Pop-Location'],
  ['cd depois do here-string', "$t = @'\ncorpo\n'@\ncd X"]
];
const LIVRE_PS = [
  ['Push com try/finally Pop', "Push-Location -LiteralPath 'X' -ErrorAction Stop; try { y } finally { Pop-Location }"],
  ['Push/Pop em minusculas', 'push-location X; try { y } finally { pop-location }'],
  ['pushd e popd', 'pushd X; y; popd'],
  ['Set-Location dentro do bloco empilhado', "Push-Location -LiteralPath 'X' -ErrorAction Stop; try { Set-Location sub; y } finally { Pop-Location }"],
  ['palavra entre aspas', 'Write-Output "Set-Location X"'],
  ['cd entre aspas simples', "Write-Output 'cd X; y'"],
  ['powershell -Command filho', "powershell -NoProfile -Command 'Set-Location X; y'"],
  ['corpo de here-string', "$js = @'\nSet-Location X\ncd Y\n'@\nnode -e $js"],
  ['corpo de here-string com aspas duplas', '$t = @"\r\ncd X\r\n"@\r\nWrite-Output $t'],
  ['comentario', "# Set-Location X\nGet-ChildItem"],
  ['comentario de bloco', 'Get-ChildItem <# cd X #> | Out-Null'],
  ['comentario de bloco com separador', 'Get-ChildItem <# nota; cd X #> | Out-Null'],
  ['comentario de bloco em varias linhas', "<#\nnota\ncd X\n#>\nGet-ChildItem"],
  ['comentario com separador', 'Get-ChildItem # ok; cd X'],
  ['sl como parte do nome', 'Get-Content sl.txt'],
  ['cd como argumento', 'Write-Output cd'],
  ['Push-Location como argumento', 'Get-Help Push-Location'],
  ['abcd', 'abcd; --cd'],
  ['sem cd', 'npm test; if ($?) { npm run build }']
];

test('shell/cdSolto: acha o cd solto no PowerShell, com cada apelido (D286)', () => {
  for (const [nome, cmd] of SOLTO_PS) {
    const r = shell.cdSolto(cmd, 'PowerShell');
    assert.ok(r, 'tinha de achar: ' + nome + ' -> ' + JSON.stringify(cmd));
    assert.strictEqual(r.forma, 'powershell', nome);
  }
});

test('shell/cdSolto: nao acha cd onde a pasta volta ou onde nao e comando (PowerShell)', () => {
  for (const [nome, cmd] of LIVRE_PS) {
    assert.strictEqual(shell.cdSolto(cmd, 'PowerShell'), null, 'nao tinha de achar: ' + nome + ' -> ' + JSON.stringify(cmd));
  }
});

// 0.3.4/item 2 (T4): aspas de cada idioma. Aspa simples nao tem escape (nem no bash nem no
// PowerShell); a dupla escapa com `\` no bash e com crase no PowerShell. A que abre primeiro manda.
test('shell/cdSolto: aspa simples com barra antes de fechar nao esconde o cd (T4)', () => {
  const cmd = "ls 'C:\\a\\'; cd x; ls 'b'";
  for (const ferr of ['PowerShell', 'Bash']) {
    const r = shell.cdSolto(cmd, ferr);
    assert.ok(r, 'tinha de achar em ' + ferr + ': ' + JSON.stringify(cmd));
    assert.strictEqual(r.achado, 'cd', ferr);
  }
});

test('shell/cdSolto: aspa dupla com barra final: PowerShell nega, bash e uma string so (T4)', () => {
  // PowerShell: a barra nao escapa, a aspa fecha e o cd esta solto.
  const ps = shell.cdSolto('ls "C:\\a\\"; cd x; ls "b"', 'PowerShell');
  assert.ok(ps && ps.achado === 'cd', JSON.stringify(ps));
  // bash: `\"` escapa a aspa, a string vai ate a ultima aspa e o cd esta dentro dela.
  assert.strictEqual(shell.cdSolto('echo "a\\"; cd x; echo b"', 'Bash'), null);
  // PowerShell: a crase escapa a aspa, e o cd fica dentro da string.
  assert.strictEqual(shell.cdSolto('echo "a`"; cd x; echo b"', 'PowerShell'), null);
});

test('shell/cdSolto: aspa dupla dentro de simples nao abre string (T4)', () => {
  const cmd = "echo 'a\"'; cd x; echo \"b\"";
  for (const ferr of ['PowerShell', 'Bash']) {
    const r = shell.cdSolto(cmd, ferr);
    assert.ok(r && r.achado === 'cd', ferr + ': ' + JSON.stringify(cmd));
  }
});

test("shell/cdSolto: PowerShell 'it''s' sao dois literais seguidos e o cd depois esta solto (T4)", () => {
  const r = shell.cdSolto("echo 'it''s'; cd x", 'PowerShell');
  assert.ok(r && r.achado === 'cd', JSON.stringify(r));
  // controle: o cd dentro do literal com '' continua escondido
  assert.strictEqual(shell.cdSolto("echo 'it''s; cd x'", 'PowerShell'), null);
});

test('shell/conferir: a tabela do win32 le as aspas do PowerShell - a barra nao escapa a simples (T4, T2/D294)', () => {
  // 0.3.5/T2 (D294) MUDOU esta expectativa: com a semLiterais antiga (sem idioma), `\'` dentro de
  // aspa simples nao fechava e o `&&` ficava escondido (era o assert `[]`). No PowerShell
  // `'C:\a\'` fecha ali mesmo, e o `&&` depois dele e operador de verdade.
  assert.deepStrictEqual(shell.conferir("echo 'C:\\a\\' && echo 'b'", WIN).map((p) => p.achado), ['&&']);
  // controle positivo: sem aspa o mesmo `&&` e achado
  assert.ok(shell.conferir('echo a && echo b', WIN).length > 0);
});

// 0.3.4/item 2 (T4): o Pop-Location so desfaz o que veio ANTES dele.
test('shell/cdSolto: Pop-Location que nao desfaz nada nao livra o cd (T4)', () => {
  // [comando, palavra achada]: o primeiro que nao esta desfeito, na ordem do texto.
  const casos = [
    ['Push-Location a; Pop-Location; cd b', 'cd'],
    ['cd b; Push-Location a; Pop-Location', 'cd'],
    ['Pop-Location; Push-Location a; cd b', 'Push-Location']
  ];
  for (const [cmd, achado] of casos) {
    const r = shell.cdSolto(cmd, 'PowerShell');
    assert.ok(r, 'tinha de achar: ' + JSON.stringify(cmd));
    assert.strictEqual(r.achado, achado, cmd);
  }
  // controle: Push, cd dentro, Pop depois continua livre
  assert.strictEqual(shell.cdSolto('Push-Location a; cd b; Pop-Location', 'PowerShell'), null);
});

// 0.3.4/item 2 (T4, ronda 2): comentario de linha, comentario de bloco e pilha do Push/Pop.
test('shell/cdSolto: apostrofo em comentario nao abre literal e esconde o cd (T4 r2)', () => {
  const b = shell.cdSolto("# it's\ncd x\necho 'y'", 'Bash');
  assert.ok(b && b.achado === 'cd', JSON.stringify(b));
  const p = shell.cdSolto("# it's\ncd x\nWrite-Host 'y'", 'PowerShell');
  assert.ok(p && p.achado === 'cd', JSON.stringify(p));
  for (const ferr of ['Bash', 'PowerShell']) {
    // # dentro de string nao e comentario; # colado em palavra nao e comentario
    assert.ok(shell.cdSolto("echo '#'; cd x", ferr), ferr + ' aspa com #');
    assert.ok(shell.cdSolto('echo a#b; cd x', ferr), ferr + ' a#b');
    // controle: o cd dentro do comentario continua escondido
    assert.strictEqual(shell.cdSolto('# cd x', ferr), null, ferr + ' comentario so');
  }
});

test('shell/cdSolto: <# numa string e #> em outra nao escondem o cd (T4 r2)', () => {
  const r = shell.cdSolto("Write-Host '<#'; cd C:\\outro; Write-Host '#>'", 'PowerShell');
  assert.ok(r && r.achado === 'cd', JSON.stringify(r));
  // controles: comentario de bloco de verdade continua escondendo
  assert.strictEqual(shell.cdSolto('<# cd x #> Get-Date', 'PowerShell'), null);
  const c = shell.cdSolto("Get-Date <# a'b #>; cd x", 'PowerShell');
  assert.ok(c && c.achado === 'cd', JSON.stringify(c));
});

test('shell/cdSolto: o Pop-Location sem pilha nao faz nada (T4 r2)', () => {
  const a = shell.cdSolto('Push-Location a; Pop-Location; cd b; Pop-Location', 'PowerShell');
  assert.ok(a && a.achado === 'cd', JSON.stringify(a));
  const b = shell.cdSolto('Push-Location a; Push-Location b; Pop-Location', 'PowerShell');
  assert.ok(b && b.achado === 'Push-Location', JSON.stringify(b));
  // Pop como argumento nao desempilha, e cd sem pilha esta solto
  const c = shell.cdSolto('Get-Help Pop-Location; cd x', 'PowerShell');
  assert.ok(c && c.achado === 'cd', JSON.stringify(c));
  // controle: dois Push e dois Pop esvaziam a pilha
  assert.strictEqual(shell.cdSolto('Push-Location a; Push-Location b; Pop-Location; Pop-Location', 'PowerShell'), null);
});

test('shell/cdSolto: cd\\ e comando no PowerShell (T4 r2)', () => {
  const r = shell.cdSolto('cd\\; git status', 'PowerShell');
  assert.ok(r && r.achado === 'cd', JSON.stringify(r));
});

test('shell/cdSolto: sem ferramenta, a plataforma escolhe o idioma; sem nenhuma, vale o Bash', () => {
  // Bash: `( cd X )` isola. PowerShell: nao isola. O mesmo texto, dois veredictos.
  assert.strictEqual(shell.cdSolto('( cd X && y )', 'Bash'), null);
  assert.ok(shell.cdSolto('( cd X && y )', 'PowerShell'));
  assert.ok(shell.cdSolto('Set-Location X; y', undefined, WIN));
  assert.strictEqual(shell.cdSolto('( cd X && y )', undefined, LINUX), null);
  assert.ok(shell.cdSolto('cd X && y', undefined, LINUX));
  assert.strictEqual(shell.cdSolto('( cd X && y )'), null);
  assert.ok(shell.cdSolto('cd X && y'));
  // independe da plataforma: o `cd` persiste em qualquer SO
  assert.ok(shell.cdSolto('cd X && y', 'Bash', LINUX));
  assert.ok(shell.cdSolto('cd X && y', 'Bash', WIN));
  assert.ok(shell.cdSolto('Set-Location X; y', 'PowerShell', LINUX));
});

test('shell/cdSolto: entrada vazia ou estranha nao estoura', () => {
  for (const v of [undefined, null, '', '   ', 42]) {
    assert.strictEqual(shell.cdSolto(v, 'Bash'), null);
    assert.strictEqual(shell.cdSolto(v, 'PowerShell'), null);
  }
});

test('shell/motivoCdSolto: o Bash recebe o subshell, o PowerShell recebe a forma medida, ambos em ASCII', () => {
  const b = shell.motivoCdSolto('cd X && y', shell.cdSolto('cd X && y', 'Bash'));
  assert.ok(b.includes('( cd '), b);
  assert.ok(/persiste/i.test(b), b);
  assert.ok(b.includes('comandosLiberados'), 'faltou o escape declarado: ' + b);
  assert.ok(!b.includes('Pop-Location'), 'o Bash nao recebe a forma do PowerShell: ' + b);
  assert.ok(/^[\x20-\x7E\n]+$/.test(b), 'motivo tem de ser ASCII (R5)');

  const p = shell.motivoCdSolto('Set-Location X; y', shell.cdSolto('Set-Location X; y', 'PowerShell'));
  assert.ok(p.includes('Push-Location -LiteralPath'), p);
  assert.ok(p.includes('-ErrorAction Stop'), p);
  assert.ok(p.includes('try {') && p.includes('finally { Pop-Location }'), p);
  assert.ok(/& \{/.test(p), 'faltou avisar que o bloco & { } nao isola: ' + p);
  assert.ok(!p.includes('( cd '), 'o PowerShell nao recebe o subshell do Bash: ' + p);
  assert.ok(/^[\x20-\x7E\n]+$/.test(p), 'motivo tem de ser ASCII (R5)');
  // mostra o comando do agente, cortado
  assert.ok(b.includes('cd X && y') && p.includes('Set-Location X; y'));
});

test('shell/motivoCdSolto: a forma que a mensagem ensina passa pela propria trava', () => {
  // A mensagem que nega nao pode ensinar uma forma que a mesma trava nega.
  for (const [ferramenta, cmd] of [['Bash', 'cd X && y'], ['PowerShell', 'Set-Location X; y']]) {
    const m = shell.motivoCdSolto(cmd, shell.cdSolto(cmd, ferramenta));
    const formas = m.split('\n').filter((l) => /^\s{2,}\S/.test(l) && /cd |Push-Location/.test(l) && !/^\s+por que/.test(l));
    assert.ok(formas.length >= 1, 'nenhuma forma de exemplo na mensagem: ' + m);
    for (const f of formas) {
      assert.strictEqual(shell.cdSolto(f, ferramenta), null, ferramenta + ' ensina forma que a trava nega: ' + f);
    }
  }
});

// As tres instrucoes do proprio plugin que mandavam usar `cd` solto (achado da abertura, D286).
const RAIZ_PLUGIN = path.join(__dirname, '..');
function lerDoPlugin(rel) { return fs.readFileSync(path.join(RAIZ_PLUGIN, rel), 'utf8'); }

test('D286: a instrucao do init (Passo 7b) usa formas que a trava aceita', () => {
  const texto = lerDoPlugin(path.join('skills', 'init', 'SKILL.md'));
  const i = texto.indexOf('Run the three');
  assert.ok(i !== -1, 'nao achou a frase dos tres geradores no Passo 7b');
  const paragrafo = texto.slice(i, texto.indexOf('\n\n', i));
  const trechos = paragrafo.match(/`[^`]+`/g) || [];
  const bash = trechos.filter((t) => /\bcd\b/.test(t));
  const ps = trechos.filter((t) => /Push-Location|Set-Location/.test(t));
  assert.ok(bash.length >= 1 && ps.length >= 1, 'faltou a forma do Bash ou a do PowerShell: ' + paragrafo);
  for (const t of bash) assert.strictEqual(shell.cdSolto(t.slice(1, -1), 'Bash'), null, 'a trava nega o que o init ensina: ' + t);
  for (const t of ps) {
    assert.strictEqual(shell.cdSolto(t.slice(1, -1), 'PowerShell'), null, 'a trava nega o que o init ensina: ' + t);
    assert.ok(/Pop-Location/.test(t), 'a forma do PowerShell tem de devolver a pasta: ' + t);
  }
  assert.ok(!/Set-Location -LiteralPath '<raiz>'; node/.test(paragrafo), 'sobrou o Set-Location solto do init');
});

test('D286: o bloco do `claude -p` em 06-ambiente.md usa forma que a trava aceita', () => {
  const texto = lerDoPlugin(path.join('skills', 'playbook', 'references', '06-ambiente.md'));
  const i = texto.indexOf('## 8. Proving a hook');
  assert.ok(i !== -1, 'nao achou a secao 8');
  const m = texto.slice(i).match(/```\r?\n([\s\S]*?)\r?\n```/);
  assert.ok(m, 'nao achou o bloco de exemplo da secao 8');
  assert.ok(m[1].includes('claude -p'), m[1]);
  assert.ok(m[1].includes('( cd '), 'o cd do bloco tem de estar em subshell: ' + m[1]);
  assert.strictEqual(shell.cdSolto(m[1], 'Bash'), null, 'a trava nega o bloco inteiro: ' + m[1]);
});

test('D286: o texto que o exportar.js imprime usa forma que a trava aceita', () => {
  const fonte = lerDoPlugin(path.join('scripts', 'exportar.js'));
  const linha = fonte.split(/\r?\n/).find((l) => /console\.log\(.*npm/.test(l));
  assert.ok(linha, 'nao achou a linha que imprime o passo do npm');
  const expr = linha.match(/console\.log\((.*)\);\s*$/)[1];
  const impresso = new Function('destinoPedido', 'return ' + expr)('C:\\pasta com espaco\\export');
  assert.ok(impresso.includes('npm'), impresso);
  assert.strictEqual(shell.cdSolto(impresso, 'Bash'), null, 'a trava nega o que o exportar imprime (Bash): ' + impresso);
  assert.strictEqual(shell.cdSolto(impresso, 'PowerShell'), null, 'a trava nega o que o exportar imprime (PowerShell): ' + impresso);
  assert.ok(!/\bcd\b/.test(impresso), 'sobrou cd no texto impresso: ' + impresso);
});

// 0.3.5/D293: o leitor do `cd` e uma leitura unica do comando. Os 13 casos do plano (1.1) e os 5
// controles, um teste por caso. Barra e crase saem de fromCharCode para o texto ser exatamente o da tabela.
const BARRA = String.fromCharCode(92);
const CRASE = String.fromCharCode(96);

// controles: iguais antes e depois da reescrita
test('0.3.5/C1: cd x && git status nega (Bash)', () => {
  assert.ok(shell.cdSolto('cd x && git status', 'Bash'));
});
test('0.3.5/C2: subshell com cd passa (Bash)', () => {
  assert.strictEqual(shell.cdSolto('( cd x && git status )', 'Bash'), null);
});
test('0.3.5/C3: Push-Location com try/finally Pop-Location passa (PowerShell)', () => {
  assert.strictEqual(shell.cdSolto("Push-Location -LiteralPath 'x' -ErrorAction Stop; try { ls } finally { Pop-Location }", 'PowerShell'), null);
});
test('0.3.5/C4: Set-Location x nega (PowerShell)', () => {
  assert.ok(shell.cdSolto('Set-Location x', 'PowerShell'));
});
test('0.3.5/C5: funcao definida e chamada no mesmo comando nega (Bash)', () => {
  assert.ok(shell.cdSolto('f() { cd X; }; f', 'Bash'));
});

// falsos negativos: tinham de negar e passavam
test('0.3.5/FN1: <<EOF dentro de comentario nao abre heredoc e o cd da linha seguinte nega (Bash)', () => {
  assert.ok(shell.cdSolto('# veja <<EOF\ncd x', 'Bash'));
});
test('0.3.5/FN2: $( ) dentro de aspa dupla RODA no PowerShell e nega', () => {
  assert.ok(shell.cdSolto('"$(Set-Location X)"', 'PowerShell'));
});
test('0.3.5/FN3: cd no braco de case nega (Bash)', () => {
  assert.ok(shell.cdSolto('case $x in a) cd y;; esac', 'Bash'));
});
test('0.3.5/FN4: crase dentro da palavra escapa o caractere e c`d e cd (PowerShell)', () => {
  assert.ok(shell.cdSolto('c' + CRASE + 'd x', 'PowerShell'));
});
test("0.3.5/FN5: aspa ANSI-C $'it\'s' tem escape e o cd depois nega (Bash)", () => {
  assert.ok(shell.cdSolto("echo $'it" + BARRA + "'s'; cd x; echo 'ok'", 'Bash'));
});

// falsos positivos: tinham de passar e negavam
test('0.3.5/FP1: chave de hashtable @{ cd = 1 } nao e comando (PowerShell)', () => {
  assert.strictEqual(shell.cdSolto('$h = @{ cd = 1 }', 'PowerShell'), null);
});
test('0.3.5/FP2: Push-Location sem caminho so empilha a pasta atual (PowerShell, medido no 5.1)', () => {
  assert.strictEqual(shell.cdSolto('Push-Location', 'PowerShell'), null);
});
test('0.3.5/FP3: sl seguido de barra nao e comando no 5.1, mas cd seguido de barra e', () => {
  assert.strictEqual(shell.cdSolto('sl' + BARRA, 'PowerShell'), null);
  const r = shell.cdSolto('cd' + BARRA, 'PowerShell');
  assert.ok(r && r.achado === 'cd', JSON.stringify(r));
});
test('0.3.5/FP4: then como argumento de echo nao e palavra-chave (Bash)', () => {
  assert.strictEqual(shell.cdSolto('echo then cd x', 'Bash'), null);
});
test('0.3.5/FP5: pushd X; ls; popd tem a pilha e passa (Bash)', () => {
  assert.strictEqual(shell.cdSolto('pushd X; ls; popd', 'Bash'), null);
});
test('0.3.5/FP6: cada elo de cano e subshell no bash (echo a | cd X)', () => {
  assert.strictEqual(shell.cdSolto('echo a | cd X', 'Bash'), null);
});
test('0.3.5/FP7: definir funcao nao roda o corpo (Bash)', () => {
  assert.strictEqual(shell.cdSolto('f() { cd X; }', 'Bash'), null);
});
test('0.3.5/FP8: do como argumento de echo nao e palavra-chave (Bash)', () => {
  assert.strictEqual(shell.cdSolto('echo do cd X', 'Bash'), null);
});

// obrigatorios alem da tabela (plano 3, T1)
test('0.3.5/T1: $( ) no Bash e subshell, mesmo dentro de aspa dupla', () => {
  assert.strictEqual(shell.cdSolto('"$(cd x)"', 'Bash'), null);
});
test('0.3.5/T1: a | cd X | b passa (cada elo e subshell)', () => {
  assert.strictEqual(shell.cdSolto('a | cd X | b', 'Bash'), null);
});
test('0.3.5/T1: pushd X sem popd nega; popd sobrando passa (Bash)', () => {
  const r = shell.cdSolto('pushd X', 'Bash');
  assert.ok(r && r.achado === 'pushd', JSON.stringify(r));
  assert.strictEqual(shell.cdSolto('popd; ls', 'Bash'), null);
});
// T4 (ronda 2, correcao): popd depois de && ou || so roda se o comando de antes der certo (ou
// errado); quando nao roda, a sessao fica na pasta do pushd. Pop condicional nao desempilha.
test('0.3.5/T4: popd depois de && ou || nao desempilha: pushd sobra e nega (Bash)', () => {
  for (const c of ['pushd sub && npm test && popd', 'pushd sub && npm test || popd',
    'pushd sub; npm test && popd', 'pushd sub; npm test || popd', 'pushd sub && npm test &&\npopd']) {
    const r = shell.cdSolto(c, 'Bash');
    assert.ok(r && r.achado === 'pushd', JSON.stringify(c) + ' -> ' + JSON.stringify(r));
  }
});
test('0.3.5/T4: popd depois de ; ou de quebra de linha desempilha e passa (Bash)', () => {
  for (const c of ['pushd sub && npm test; popd', 'pushd sub && npm test\npopd', 'pushd sub || exit 1; make; popd',
    'pushd sub && (make)\npopd']) {
    assert.strictEqual(shell.cdSolto(c, 'Bash'), null, JSON.stringify(c));
  }
});
test('0.3.5/T1: cd fora do braco do case nega (Bash)', () => {
  assert.ok(shell.cdSolto('case $x in a) ls;; esac; cd y', 'Bash'));
});
test('0.3.5/T1: then e do como argumento de echo depois de ; passam (Bash)', () => {
  assert.strictEqual(shell.cdSolto('ls; echo then cd x', 'Bash'), null);
  assert.strictEqual(shell.cdSolto('ls; echo do cd x', 'Bash'), null);
});
test('0.3.5/T1: palavra-chave em posicao de comando segue valendo (if/then, for/do)', () => {
  assert.ok(shell.cdSolto('if true; then cd x; fi', 'Bash'));
  assert.ok(shell.cdSolto('for i in 1; do cd x; done', 'Bash'));
});

// ---- 0.3.5/T2 (D294): a tabela que nao se le avisa; o `conferir` le as aspas como o PowerShell

const TABELA_REAL = fs.readFileSync(path.join(__dirname, '..', 'modelos', 'shell-win32.json'), 'utf8');

/**
 * Carrega uma COPIA do shell.js ao lado de um modelos/shell-win32.json escolhido pelo teste (o
 * caminho da tabela e relativo ao __dirname). `conteudo === null` = sem o arquivo.
 */
function shellComTabela(conteudo) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-shell-tabela-'));
  fs.mkdirSync(path.join(base, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(base, 'modelos'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'scripts', 'lib', 'shell.js'), path.join(base, 'scripts', 'lib', 'shell.js'));
  // A1-08: o shell.js pede o ascii do escopo.js, que pede o glob.js.
  for (const dep of ['texto.js', 'escopo.js', 'glob.js']) {
    fs.copyFileSync(path.join(__dirname, '..', 'scripts', 'lib', dep), path.join(base, 'scripts', 'lib', dep));
  }
  if (conteudo !== null) fs.writeFileSync(path.join(base, 'modelos', 'shell-win32.json'), conteudo, 'utf8');
  try { return require(path.join(base, 'scripts', 'lib', 'shell.js')); } finally { fs.rmSync(base, { recursive: true, force: true }); }
}

test('0.3.5/T2: aspa simples com barra no PowerShell nao esconde o que vem depois', () => {
  // `'a\'` e um literal inteiro no PowerShell (a barra nao escapa); o `head` depois do `;` e comando
  const p = shell.conferir("Write-Output 'a\\'; head -3 x; Write-Output 'b'", WIN, 'PowerShell');
  assert.deepStrictEqual(p.map((x) => x.achado), ['head']);
});

test('0.3.5/T2: aspa dupla dentro de aspa simples nao esconde a palavra entre os dois literais', () => {
  // 'x"' e "z'" sao dois literais; o `head` entre eles e argumento solto (a tabela e textual)
  const p = shell.conferir('Write-Output \'x"\' head "z\'"', WIN, 'PowerShell');
  assert.deepStrictEqual(p.map((x) => x.achado), ['head']);
});

test('0.3.5/T2: o que esta DENTRO de literal com barra ou aspa cruzada continua nao sendo apontado', () => {
  assert.deepStrictEqual(shell.conferir("Write-Output 'a\\' 'head' 'b'", WIN, 'PowerShell'), []);
  assert.deepStrictEqual(shell.conferir('Write-Output \'x"\' "tail" "z\'"', WIN, 'PowerShell'), []);
  // controle: o que a tabela ja negava segue negado, com e sem literal por perto
  assert.deepStrictEqual(shell.conferir("Write-Output 'oi'; ls | head", WIN, 'PowerShell').map((x) => x.achado), ['head']);
  assert.deepStrictEqual(shell.conferir('git status && git log', WIN, 'PowerShell').map((x) => x.achado), ['&&']);
});

test('0.3.5/T2: tabela real legivel nao tem problema, e a lista so vale onde a tabela valeria', () => {
  assert.deepStrictEqual(shell.problemasDaTabela(WIN, 'PowerShell'), []);
  assert.deepStrictEqual(shell.problemasDaTabela(WIN), []);
  const ruim = shellComTabela('{ nao e json');
  assert.strictEqual(ruim.problemasDaTabela(WIN, 'PowerShell').length, 1);
  // fora do win32 e na ferramenta Bash a tabela nao vale: nada a avisar
  assert.deepStrictEqual(ruim.problemasDaTabela(LINUX, 'PowerShell'), []);
  assert.deepStrictEqual(ruim.problemasDaTabela(WIN, 'Bash'), []);
  assert.deepStrictEqual(ruim.problemasDaTabela(null, 'PowerShell'), []);
});

test('0.3.5/T2: tabela ilegivel expoe o arquivo e a causa, e o conferir segue sem negar', () => {
  const quebrada = shellComTabela('{ "quando": ');
  const p = quebrada.problemasDaTabela(WIN, 'PowerShell');
  assert.strictEqual(p.length, 1, JSON.stringify(p));
  assert.strictEqual(p[0].tipo, 'arquivo');
  assert.ok(p[0].onde.endsWith('shell-win32.json'), JSON.stringify(p[0]));
  assert.ok(/SyntaxError/.test(p[0].causa), JSON.stringify(p[0]));
  assert.deepStrictEqual(quebrada.conferir('ls | head', WIN, 'PowerShell'), [], 'sem tabela nao se nega');

  const ausente = shellComTabela(null);
  const a = ausente.problemasDaTabela(WIN, 'PowerShell');
  assert.strictEqual(a.length, 1);
  assert.strictEqual(a[0].causa, 'ENOENT', JSON.stringify(a[0]));

  // arquivo que e JSON mas nao e tabela (lista no lugar de objeto) tambem nao se le
  const lista = shellComTabela('[]');
  assert.strictEqual(lista.problemasDaTabela(WIN, 'PowerShell').length, 1);
  assert.deepStrictEqual(lista.conferir('ls | head', WIN, 'PowerShell'), []);
});

test('0.3.5/T2: regra com RegExp invalida expoe o achado dela, e as outras regras seguem valendo', () => {
  const tabela = JSON.parse(TABELA_REAL);
  tabela.regras.push({ padrao: '(aberto', achado: 'regra-quebrada', sugestao: 'x', motivo: 'y' });
  tabela.regrasPowerShell51[0] = { padrao: '[', achado: '&&', sugestao: 'x', motivo: 'y' };
  const s = shellComTabela(JSON.stringify(tabela));
  const p = s.problemasDaTabela(WIN, 'PowerShell');
  assert.deepStrictEqual(p.map((x) => x.achado), ['regra-quebrada', '&&'], JSON.stringify(p));
  assert.ok(p.every((x) => x.tipo === 'regra' && x.causa), JSON.stringify(p));
  // controle: o que a tabela negava segue negado
  assert.deepStrictEqual(s.conferir('ls | head', WIN, 'PowerShell').map((x) => x.achado), ['head']);
  // a regra do PowerShell 5.1 so entra no conjunto do shell powershell
  assert.deepStrictEqual(s.problemasDaTabela({ so: 'win32', shell: 'bash' }, 'PowerShell').map((x) => x.achado),
    ['regra-quebrada']);
});

test('0.3.5/T2: regra sem padrao em texto nao vira "casa tudo": e problema, e nao nega', () => {
  const tabela = JSON.parse(TABELA_REAL);
  tabela.regras = [{ achado: 'sem-padrao', sugestao: 'x', motivo: 'y' }, null];
  const s = shellComTabela(JSON.stringify(tabela));
  assert.deepStrictEqual(s.conferir('echo oi', WIN, 'PowerShell'), []);
  assert.deepStrictEqual(s.problemasDaTabela(WIN, 'PowerShell').map((x) => x.achado), ['sem-padrao', '(sem achado)']);
});

test('0.3.5/T2: o texto do aviso nomeia o arquivo ou a regra e a causa, em ASCII', () => {
  const quebrada = shellComTabela('{ "quando": ');
  const t = quebrada.avisoTabela(quebrada.problemasDaTabela(WIN, 'PowerShell'));
  assert.ok(t.includes('shell-win32.json') && /SyntaxError/.test(t), t);
  assert.ok(/desligada/i.test(t), t);
  const tabela = JSON.parse(TABELA_REAL);
  tabela.regras.push({ padrao: '(aberto', achado: 'regra-quebrada', sugestao: 'x', motivo: 'y' });
  const s = shellComTabela(JSON.stringify(tabela));
  const r = s.avisoTabela(s.problemasDaTabela(WIN, 'PowerShell'));
  assert.ok(r.includes('regra-quebrada'), r);
  for (const x of [t, r]) assert.ok(/^[\x20-\x7E\n]+$/.test(x), 'aviso tem de ser ASCII: ' + x);
});

// ---- T1 do plano dos 82: a tabela, as mensagens e o leitor do `cd`

test('T1/F3-10: tabela com BOM na frente se le como a sem BOM', () => {
  const BOM = String.fromCharCode(0xFEFF);
  const s = shellComTabela(BOM + TABELA_REAL);
  assert.deepStrictEqual(s.problemasDaTabela(WIN, 'PowerShell'), []);
  assert.deepStrictEqual(s.conferir('ls | head', WIN, 'PowerShell').map((x) => x.achado), ['head']);
  // controle: o que nao e JSON segue sendo problema, com ou sem BOM
  assert.strictEqual(shellComTabela(BOM + '{ nao e json').problemasDaTabela(WIN, 'PowerShell').length, 1);
});

test('T1/F3-11: o aviso diz que o comando seguinte ja usa a tabela consertada (cada hook e processo novo)', () => {
  const quebrada = shellComTabela('{ "quando": ');
  const t = quebrada.avisoTabela(quebrada.problemasDaTabela(WIN, 'PowerShell'));
  assert.ok(!t.includes('sessao nova'), t);
  // Plano 082, Tarefa 5: o conserto e o "Faca assim:" da forma unica.
  assert.ok(t.includes('Faca assim: conserte o arquivo no plugin sworn; o comando seguinte ja usa a tabela consertada.'), t);
  assert.ok(t.includes('Este aviso sai uma vez por sessao.'), t);
});

test('T1/F3-15: o conferir abre pela mesma porta do problemasDaTabela (o SO da tabela), nao pelo quando.so', () => {
  for (const quando of [undefined, { so: 'linux' }]) {
    const tabela = JSON.parse(TABELA_REAL);
    if (quando === undefined) delete tabela.quando; else tabela.quando = quando;
    const s = shellComTabela(JSON.stringify(tabela));
    assert.deepStrictEqual(s.conferir('ls | head', WIN, 'PowerShell').map((x) => x.achado), ['head'], JSON.stringify(quando));
    // controle: fora do win32 a tabela segue sem valer
    assert.deepStrictEqual(s.conferir('ls | head', LINUX, 'PowerShell'), [], JSON.stringify(quando));
  }
});

test('T1/F3-16: padrao vazio ou so de espaco e regra que nao se le, e nao casa tudo', () => {
  const tabela = JSON.parse(TABELA_REAL);
  tabela.regras.push({ padrao: '', achado: 'vazio', sugestao: 'x', motivo: 'y' },
    { padrao: '  ', achado: 'espaco', sugestao: 'x', motivo: 'y' });
  const s = shellComTabela(JSON.stringify(tabela));
  assert.deepStrictEqual(s.problemasDaTabela(WIN, 'PowerShell').map((x) => [x.achado, x.causa]),
    [['vazio', 'o padrao esta vazio (casaria tudo)'], ['espaco', 'o padrao esta vazio (casaria tudo)']]);
  assert.deepStrictEqual(s.conferir('echo oi', WIN, 'PowerShell'), []);
  // controle: as regras validas da mesma tabela seguem negando
  assert.deepStrictEqual(s.conferir('ls | head', WIN, 'PowerShell').map((x) => x.achado), ['head']);
});

test('T1/F3-17: o motivo nao lanca com regra sem achado', () => {
  let m = '';
  assert.doesNotThrow(() => { m = shell.motivoIdioma('x', [{ sugestao: 's', motivo: 'm' }], 1); });
  assert.ok(m.includes('  (sem achado)'), m);
  // controle: com achado, a linha mostra o achado
  assert.ok(shell.motivoIdioma('x', [{ achado: 'head', sugestao: 's', motivo: 'm' }], 1).includes('  head '));
});

test('T1/F6-02: o motivo ecoa no maximo 120 caracteres do comando e diz o tamanho quando corta', () => {
  const linhaComando = (c) => shell.motivoIdioma(c, [], 1).split('\n').find((l) => l.startsWith('Comando: '));
  assert.strictEqual(linhaComando('a'.repeat(500)), 'Comando: ' + 'a'.repeat(120) + '...(500 caracteres)');
  // controle: 120 sai inteiro, sem sufixo
  assert.strictEqual(linhaComando('b'.repeat(120)), 'Comando: ' + 'b'.repeat(120));
});

test('D721 A1-01/A1-02: o eco do comando nao mostra null nem undefined e corta por caractere, nunca no meio do emoji', () => {
  const linha = (m) => m.split('\n').find((l) => l.startsWith('Comando: '));
  const cd = { forma: 'bash', achado: 'cd' };
  assert.strictEqual(linha(shell.motivoIdioma(null, [], 1)), 'Comando: ');
  assert.strictEqual(linha(shell.motivoCdSolto(undefined, cd)), 'Comando: ');
  // o emoji conta como um caractere: 200 saem como 120 "?" e o tamanho diz 200
  const emoji = String.fromCodePoint(0x1F600);
  assert.strictEqual(linha(shell.motivoIdioma(emoji.repeat(200), [], 1)), 'Comando: ' + '?'.repeat(120) + '...(200 caracteres)');
  assert.strictEqual(linha(shell.motivoCdSolto(emoji.repeat(400), cd)), 'Comando: ' + '?'.repeat(300));
  // controle: o comando comum sai igual
  assert.strictEqual(linha(shell.motivoIdioma('cd x', [], 1)), 'Comando: cd x');
  assert.strictEqual(linha(shell.motivoCdSolto('cd x', cd)), 'Comando: cd x');
});

test('T1/F3-01: atribuicao, time, ! e palavra entre aspas na frente deixam o cd em posicao de comando (Bash)', () => {
  for (const c of ['x=1 cd y', 'time cd x', '! cd x', "'cd' x", "x='a b' cd y", 'A=1 B=2 cd y', '"cd" x', "c'd' x"]) {
    const r = shell.cdSolto(c, 'Bash');
    assert.ok(r && r.achado === 'cd', JSON.stringify(c) + ' -> ' + JSON.stringify(r));
  }
});
test('T1/F3-01 controle: atribuicao e cd entre aspas como argumento, e cd em $( ), seguem livres (Bash)', () => {
  for (const c of ['echo x=1 cd y', "echo 'cd' x", 'x=1', 'x=$(cd y)']) {
    assert.strictEqual(shell.cdSolto(c, 'Bash'), null, JSON.stringify(c));
  }
  // no PowerShell 'cd' entre aspas e texto, nao comando
  assert.strictEqual(shell.cdSolto("'cd' x", 'PowerShell'), null);
});

test('T1/F3-04: function definida e nao chamada nao roda o corpo (PowerShell)', () => {
  assert.strictEqual(shell.cdSolto('function f { cd x }', 'PowerShell'), null);
  assert.strictEqual(shell.cdSolto('function f($a) { cd x }', 'PowerShell'), null);
});
test('T1/F3-04 controle: a chamada repete o corpo, sem caixa, e & { } segue negando (PowerShell)', () => {
  for (const c of ['function f { cd x }; f', 'Function F { cd x }; f', 'function f($a) { cd x }; F 1', '& { cd x }']) {
    const r = shell.cdSolto(c, 'PowerShell');
    assert.ok(r && r.achado === 'cd', JSON.stringify(c) + ' -> ' + JSON.stringify(r));
  }
});

test('T1/F3-04: D342: no PowerShell o que vem depois do = de atribuicao e posicao de comando', () => {
  for (const c of ['function f { cd x }; $x = f', '$x = Set-Location y', '$x = cd y', 'function f { cd x }; [string]$x = f',
    'function f { cd x }; $x += f']) {
    const r = shell.cdSolto(c, 'PowerShell');
    assert.ok(r && r.forma === 'powershell', JSON.stringify(c) + ' -> ' + JSON.stringify(r));
  }
});
test('T1/F3-04: D342: controle: texto, chave de hashtable, = dentro de argumento e o bash seguem como estavam', () => {
  for (const c of ['@{ cd = 1 }', "$x = 'cd'", '$x = "cd x"', '$x = 1; Write-Output cd', 'if ($a -eq 1) { }',
    'Get-Item x -Filter a=b', 'function f { cd x }']) {
    assert.strictEqual(shell.cdSolto(c, 'PowerShell'), null, JSON.stringify(c));
  }
  assert.ok(shell.cdSolto('x=1 cd y', 'Bash'));
  assert.strictEqual(shell.cdSolto('echo a=b', 'Bash'), null);
});

test('T1/F3-05: grupo { } em cano roda em subshell e nao nega (Bash)', () => {
  for (const c of ['{ cd x; } | cat', '{ cd x; } |& cat']) assert.strictEqual(shell.cdSolto(c, 'Bash'), null, JSON.stringify(c));
});
test('T1/F3-05 controle: grupo fora de cano segue negando; cd em cano segue livre (Bash)', () => {
  for (const c of ['{ cd x; }; echo', '{ cd x; } && echo']) assert.ok(shell.cdSolto(c, 'Bash'), JSON.stringify(c));
  for (const c of ['cd x | cat', 'cat | { cd x; }']) assert.strictEqual(shell.cdSolto(c, 'Bash'), null, JSON.stringify(c));
});

const aninhado = (k, resto) => 'echo ' + '$('.repeat(k) + 'true' + ')'.repeat(k) + resto;
test('T1/F3-06: no teto de 100 niveis o comando nao foi lido inteiro e nega, com mensagem propria (Bash e PowerShell)', () => {
  const casos = [['Bash', aninhado(100, '')], ['Bash', aninhado(100, '; cd x')], ['Bash', '( ' + aninhado(100, '') + ' )'],
    ['PowerShell', aninhado(100, '')], ['PowerShell', aninhado(100, '; cd x')]];
  for (const [ferr, c] of casos) {
    const r = shell.cdSolto(c, ferr);
    assert.ok(r && r.teto === true, ferr + ' ' + c.length + ' -> ' + JSON.stringify(r));
    const m = shell.motivoCdSolto(c, r);
    assert.ok(m.includes('passa de 100 niveis de aninhamento'), m);
    assert.ok(!/O que o (null|undefined)/.test(m), m);
    assert.ok(/^[\x20-\x7E\n]+$/.test(m), 'motivo tem de ser ASCII');
  }
});
test('T1/F3-06 controle: 99 niveis sem cd seguem livres; com cd negam pelo cd (Bash)', () => {
  assert.strictEqual(shell.cdSolto(aninhado(99, ''), 'Bash'), null);
  const r = shell.cdSolto(aninhado(99, '; cd x'), 'Bash');
  assert.ok(r && r.achado === 'cd' && !r.teto, JSON.stringify(r));
});

test('T1/F3-12: popd no corpo de funcao chamada depois de && herda a condicao da chamada (Bash)', () => {
  const r = shell.cdSolto('pushd a; f() { popd; }; true && f', 'Bash');
  assert.ok(r && r.achado === 'pushd', JSON.stringify(r));
});
test('T1/F3-12 controle: chamada sem condicao desempilha; Push e Pop no mesmo corpo se anulam (Bash)', () => {
  for (const c of ['pushd a; f() { popd; }; f', 'f() { pushd a; popd; }; true && f']) {
    assert.strictEqual(shell.cdSolto(c, 'Bash'), null, JSON.stringify(c));
  }
});

test('T1/F3-13: pushd a && popd nao nega: se o pushd falha, a pasta nao mudou (Bash)', () => {
  assert.strictEqual(shell.cdSolto('pushd a && popd', 'Bash'), null);
  // o grupo logo depois do && tambem so roda se o pushd rodou
  assert.strictEqual(shell.cdSolto('pushd a && { make; popd; }', 'Bash'), null);
});
test('T1/F3-13 controle: com comando entre os dois, ou com ||, segue negando (Bash)', () => {
  for (const c of ['pushd a && make && popd', 'pushd a || popd']) {
    const r = shell.cdSolto(c, 'Bash');
    assert.ok(r && r.achado === 'pushd', JSON.stringify(c) + ' -> ' + JSON.stringify(r));
  }
});

test('T1/F3-14: popd dentro de if/then ou while/do pode nao rodar e nao desempilha (Bash)', () => {
  for (const c of ['pushd a; if make; then popd; fi', 'pushd a; while x; do popd; done']) {
    const r = shell.cdSolto(c, 'Bash');
    assert.ok(r && r.achado === 'pushd', JSON.stringify(c) + ' -> ' + JSON.stringify(r));
  }
});
test('T1/F3-14 controle: popd depois do fi, Push e Pop no mesmo bloco e grupo { } desempilham (Bash)', () => {
  for (const c of ['pushd a; make; popd', 'pushd a; if make; then echo; fi; popd', 'if x; then pushd a; popd; fi',
    'pushd a; { popd; }']) {
    assert.strictEqual(shell.cdSolto(c, 'Bash'), null, JSON.stringify(c));
  }
});

// D332 secao 3: os dois sao o comportamento do bash; os testes prendem o de hoje.
test('T1/F3-02 (D332): heredoc sem traco nao fecha com terminador indentado por tab, como no bash', () => {
  assert.strictEqual(shell.cdSolto('cat <<EOF\n\tEOF\ncd x', 'Bash'), null);
  // controle: com <<- o tab sai, o heredoc fecha e o cd depois nega
  assert.ok(shell.cdSolto('cat <<-EOF\n\tEOF\ncd x', 'Bash'));
});
test('T1/F3-03 (D332): funcao chamada antes de definida ainda nao existe e nao nega, como no bash', () => {
  assert.strictEqual(shell.cdSolto('f; f() { cd x; }', 'Bash'), null);
  // controle: chamada depois da definicao nega
  assert.ok(shell.cdSolto('f() { cd x; }; f', 'Bash'));
});

// Plano 083 (p6-30, p6-25): linha em branco depois do "Comando:" e antes do texto que segue a tabela, nas duas
// tentativas; a opcao 2 e a mesma frase nos dois ramos.
test('083 T6 (p6-30, p6-25): motivo com linha em branco em volta da tabela e a opcao 2 igual nas duas tentativas', () => {
  const p = [{ achado: 'head', sugestao: 'Select-Object -First', motivo: 'm' }];
  const um = shell.motivoIdioma('head x', p, 1).split('\n');
  const dois = shell.motivoIdioma('head x', p, 2).split('\n');
  for (const [nome, l] of [['tentativa 1', um], ['tentativa 2', dois]]) {
    const i = l.findIndex((x) => x.startsWith('Comando: '));
    assert.strictEqual(l[i + 1], '', nome + ': linha em branco depois do Comando: ' + l.join('\n'));
    assert.match(l[i + 2], /^Achado +Use no lugar$/, nome);
    const fimDaTabela = l.findIndex((x, k) => k > i + 2 && !/^ {2}/.test(x));
    assert.strictEqual(l[fimDaTabela], '', nome + ': linha em branco depois da tabela: ' + l.join('\n'));
  }
  assert.strictEqual(um[um.length - 1], dois[dois.length - 1], 'a opcao 2 e a mesma frase nos dois ramos');
  assert.match(dois[dois.findIndex((x) => /^Esta e a tentativa 2/.test(x)) - 1], /^$/);
});

// Plano 083 (p6-24): as opcoes do cd solto saem numeradas 1, 2, 3 em sequencia, com e sem o teto, nos dois idiomas.
test('083 T6 (p6-24): as opcoes do motivoCdSolto saem numeradas em sequencia nos 4 casos', () => {
  for (const forma of ['bash', 'powershell']) {
    for (const teto of [false, true]) {
      const m = shell.motivoCdSolto('cd x', { forma: forma, achado: 'cd x', teto: teto });
      const numeros = m.split('\n').filter((l) => /^ {2}\d+\. /.test(l)).map((l) => Number(/\d+/.exec(l)[0]));
      assert.deepStrictEqual(numeros, teto ? [1, 2, 3] : [1, 2], forma + ' teto ' + teto + ': ' + m);
    }
  }
});

test('T10-7/5: motivo sem sugestao nao imprime undefined, e sem motivo nao ha a linha por que:', () => {
  const semSugestao = shell.motivoIdioma('x', [{ achado: 'head', motivo: 'm' }], 1);
  assert.ok(!/undefined/.test(semSugestao), semSugestao);
  assert.ok(semSugestao.includes('(sem sugestao)'), semSugestao);
  assert.ok(semSugestao.includes('      por que: m'), 'com motivo a linha por que: segue: ' + semSugestao);
  const semMotivo = shell.motivoIdioma('x', [{ achado: 'head', sugestao: 's' }], 1);
  assert.ok(!/undefined/.test(semMotivo), semMotivo);
  assert.ok(!/por que:/.test(semMotivo), 'sem motivo nao pode haver a linha por que: ' + semMotivo);
  assert.ok(semMotivo.includes('  head '), semMotivo);
  const completo = shell.motivoIdioma('x', [{ achado: 'head', sugestao: 's', motivo: 'm' }], 1);
  assert.ok(completo.includes('s') && completo.includes('por que: m') && !completo.includes('(sem sugestao)'), completo);
});

test('T10-7/6: o cd solto no Bash explica o termo subshell: shell filho, cd so la dentro, pasta volta sozinha', () => {
  const m = shell.motivoCdSolto('cd X && y', shell.cdSolto('cd X && y', 'Bash'));
  const linha = m.split('\n').find((l) => l.indexOf('em subshell') !== -1) || '';
  assert.ok(linha, 'a expressao em subshell tem de ficar: ' + m);
  assert.ok(/shell filho/.test(linha), 'falta explicar o que e: ' + linha);
  assert.ok(/so dentro dele/.test(linha), 'falta dizer que o cd vale so la dentro: ' + linha);
  assert.ok(/volta sozinha/.test(linha), linha);
});

// D486 (s108): so o cd solto do Bash se envolve em subshell; o PowerShell nao tem subshell que devolva a pasta.
test('D486: envolverEmSubshell - so o Bash, com o ) na linha de baixo; PowerShell, teto e fim em barra ficam null', () => {
  const bash = shell.cdSolto('cd sub && ls', 'Bash');
  assert.strictEqual(shell.envolverEmSubshell('cd sub && ls', bash), '( cd sub && ls\n)');
  const ps = shell.cdSolto('Set-Location sub; ls', 'PowerShell');
  assert.ok(ps && ps.forma === 'powershell', 'controle: o PowerShell acha o cd solto');
  assert.strictEqual(shell.envolverEmSubshell('Set-Location sub; ls', ps), null);
  assert.strictEqual(shell.envolverEmSubshell('cd sub && ls', null), null);
  assert.strictEqual(shell.envolverEmSubshell('cd sub && ls \\  ', bash), null);
  assert.strictEqual(shell.envolverEmSubshell('x', { forma: 'bash', achado: null, teto: true }), null);
});
