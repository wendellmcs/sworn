'use strict';
// T11-1 = R-T20-09 [P0]: o `.css` escrito por comando de shell escapava do portao de design, que so
// olhava Write|Edit. O portao novo (portao-estilo.js) e o segundo gancho da entrada Bash|PowerShell do
// PreToolUse. Nao e trava: o botao de desligar dele e nao ter `.claude/sworn/design.json`.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const design = require('../scripts/lib/design.js');

const SISTEMA = {
  cores: ['#ff6600', '#1a1a1a', '#ffffff'],
  raios: ['4px', '8px'],
  espacos: ['4px', '8px', '16px'],
  sombras: [],
  antiReferencias: ['gradiente']
};

/** Projeto de teste. `semDesign` / `semProjeto` desligam o modulo; `extra` entra no projeto.json. */
function montar(opcoes) {
  const o = opcoes || {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-estilo-'));
  const pasta = path.join(dir, '.claude', 'sworn');
  fs.mkdirSync(pasta, { recursive: true });
  if (!o.semProjeto) {
    fs.writeFileSync(path.join(pasta, 'projeto.json'), JSON.stringify(Object.assign({ marchaPadrao: 'padrao' }, o.extra || {})), 'utf8');
  }
  if (!o.semDesign) fs.writeFileSync(path.join(pasta, 'design.json'), JSON.stringify(SISTEMA), 'utf8');
  return dir;
}

function chamar(dir, ferramenta, comando, id) {
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'portao-estilo.js')], {
    cwd: dir,
    encoding: 'utf8',
    input: JSON.stringify({ session_id: id || 'pe1', cwd: dir, hook_event_name: 'PreToolUse', tool_name: ferramenta,
      tool_input: { command: comando } }),
    env: Object.assign({}, process.env, { SWORN_TMP: path.join(dir, '_sessoes') })
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!/portao falhou/.test(r.stderr || ''), 'o portao caiu e liberou por inercia: ' + r.stderr);
  return r;
}

function motivoDe(r) {
  try { return JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason; } catch (e) { return null; }
}

function sessao(dir, id) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, '_sessoes', 'sworn', (id || 'pe1') + '.json'), 'utf8')); } catch (e) { return null; }
}

/** Cada item e [ferramenta, comando]: todos tem de ser negados / permitidos. */
function todosNegados(dir, casos) {
  for (const [ferramenta, comando] of casos) {
    const r = chamar(dir, ferramenta, comando);
    assert.ok(motivoDe(r), 'tinha de negar (' + ferramenta + '): ' + JSON.stringify(comando) + ' -> stdout ' + JSON.stringify(r.stdout));
  }
}

function todosPermitidos(dir, casos) {
  for (const [ferramenta, comando] of casos) {
    const r = chamar(dir, ferramenta, comando);
    assert.strictEqual(r.stdout, '', 'tinha de permitir (' + ferramenta + '): ' + JSON.stringify(comando) + ' -> ' + r.stdout);
  }
}

// --------------------------------------------------------------- coluna "deve NEGAR"

test('T11-1 nega: heredoc com cor crua escrito em .css (cat > e cat >>)', () => {
  const dir = montar();
  try {
    todosNegados(dir, [
      ['Bash', "cat > src/a.css <<'EOF'\n.x { color: #123456; }\nEOF"],
      ['Bash', "cat >> src/a.css <<'EOF'\n.x { color: #123456; }\nEOF"],
      ['Bash', 'cat <<EOF > src/a.css\n.x { color: #123456; }\nEOF'],
      ['Bash', "cat <<-'FIM' >src/a.css\n\t.x { color: #123456; }\nFIM"],
      ['Bash', 'cat>src/a.css']
    ]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-1 nega: echo/printf redirecionado para .scss, .less, .sass, .styl (>, >>, >|, &>, 2>)', () => {
  const dir = montar();
  try {
    todosNegados(dir, [
      ['Bash', 'echo ".x{}" >> estilos/b.scss'],
      ['Bash', 'echo ".x{}" > estilos/b.less'],
      ['Bash', "printf '.x{}' > estilos/b.sass"],
      ['Bash', 'echo x >| estilos/b.styl'],
      ['Bash', 'echo x &> estilos/b.css'],
      ['Bash', 'echo x 2> estilos/b.css'],
      ['Bash', 'echo x >> "estilos/com aspas.css"'],
      ['Bash', "echo x > 'estilos/com aspas.css'"],
      ['Bash', 'echo x > ./estilos/B.CSS'],
      ['PowerShell', "'.x{}' > estilos\\b.css"],
      ['PowerShell', '".x{}" >> estilos\\b.css']
    ]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-1 nega: tee e tee -a no fim de um cano', () => {
  const dir = montar();
  try {
    todosNegados(dir, [
      ['Bash', "printf '.x{}' | tee src/a.css"],
      ['Bash', "printf '.x{}' | tee -a src/a.css"],
      ['Bash', "printf '.x{}' | tee saida.txt src/a.css"],
      ['Bash', "printf '.x{}' | tee src/a.css > /dev/null"],
      ['Bash', "printf '.x{}' | sudo tee src/a.css"],
      ['PowerShell', "'.x{}' | Tee-Object -FilePath src\\a.css"]
    ]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-1 nega: sed -i (e perl -pi) em arquivo de estilo, com ou sem sufixo de copia', () => {
  const dir = montar();
  try {
    todosNegados(dir, [
      ['Bash', "sed -i 's/#fff/#000/' src/a.css"],
      ['Bash', "sed -i.bak 's/#fff/#000/' src/a.css"],
      ['Bash', "sed -ni 's/#fff/#000/p' src/a.css"],
      ['Bash', "sed -E -i -e 's/#fff/#000/' src/a.css"],
      ['Bash', "sed --in-place 's/#fff/#000/' src/a.css"],
      ['Bash', "sed -i 's/a/b/' README.md src/a.scss"],
      ['Bash', "perl -pi -e 's/#fff/#000/' src/a.css"]
    ]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-1 nega: cp e mv cujo destino e arquivo de estilo (e o diretorio de destino com fonte de estilo)', () => {
  const dir = montar();
  try {
    todosNegados(dir, [
      ['Bash', 'cp novo.css src/a.css'],
      ['Bash', 'mv x.css src/a.css'],
      ['Bash', 'cp -f novo.txt src/a.css'],
      ['Bash', 'install -m 644 novo.css src/a.css'],
      ['Bash', 'cp novo.css src/'],
      ['Bash', 'cp -t src novo.css'],
      ['PowerShell', 'cp novo.css src\\a.css'],
      ['PowerShell', 'Copy-Item x.css src\\a.css'],
      ['PowerShell', 'Copy-Item -Path x.css -Destination src\\a.css -Force'],
      ['PowerShell', 'Copy-Item -Destination src\\a.css x.txt'],
      ['PowerShell', 'Move-Item x.css src\\a.css']
    ]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-1 nega: Set-Content, Add-Content, Out-File e New-Item do PowerShell em arquivo de estilo', () => {
  const dir = montar();
  try {
    todosNegados(dir, [
      ['PowerShell', "Set-Content -Path src\\a.css -Value '.x { color: #123456 }'"],
      ['PowerShell', "Set-Content src\\a.css '.x { color: #123456 }'"],
      ['PowerShell', "Set-Content -LiteralPath src\\a.css -Value 'x' -Encoding utf8"],
      ['PowerShell', "Set-Content -Encoding utf8 -Force src\\a.css 'x'"],
      ['PowerShell', "sc src\\a.css 'x'"],
      ['PowerShell', "Add-Content -Path src\\a.css -Value 'x'"],
      ['PowerShell', "ac src\\a.css 'x'"],
      ['PowerShell', "'.x { color: #123456 }' | Out-File src\\a.css"],
      ['PowerShell', "'.x { color: #123456 }' | Out-File -FilePath src/a.css -Encoding utf8"],
      ['PowerShell', "Get-Content base.txt | Set-Content src\\a.css"],
      ['PowerShell', 'New-Item -ItemType File -Path src -Name a.css -Value x'],
      ['PowerShell', 'New-Item src\\a.css -ItemType File'],
      ['PowerShell', "Set-Content -Path src\\a.css -Value @'\n.x { color: #123456 }\n'@"],
      ['PowerShell', "[System.IO.File]::WriteAllText('src/a.css', '.x { color: #123456 }')"],
      ['PowerShell', "[IO.File]::AppendAllText(\"src\\a.css\", 'x')"]
    ]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-1 nega: node -e que escreve arquivo de estilo (writeFileSync, appendFileSync, copyFileSync, heredoc)', () => {
  const dir = montar();
  try {
    todosNegados(dir, [
      ['Bash', 'node -e "require(\'fs\').writeFileSync(\'src/a.css\',\'.x{color:#123456}\')"'],
      ['Bash', "node -e \"require('fs').appendFileSync('src/a.css', 'x')\""],
      ['Bash', "node --eval \"require('fs').copyFileSync('novo.css', 'src/a.css')\""],
      ['Bash', "node -e 'require(\"fs\").writeFileSync(\"src/a.css\", \"x\")'"],
      ['Bash', "node -p \"require('fs').writeFileSync('src/a.css','x')\""],
      ['Bash', "node <<'EOF'\nrequire('fs').writeFileSync('src/a.css', '.x{color:#123456}');\nEOF"],
      ['Bash', "node -e \"const f='src/a.css'; require('fs').writeFileSync(f, 'x')\""],
      ['Bash', "node -e \"require('fs').renameSync('novo.txt', 'src/a.css')\""],
      ['PowerShell', 'node -e "require(\'fs\').writeFileSync(\'src/a.css\',\'x\')"']
    ]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-1 nega: caminho declarado em projeto.design.caminhosDeEstilo (nao .css) escrito por >, tee, cp e Set-Content', () => {
  const dir = montar({ extra: { design: { caminhosDeEstilo: ['src/tema/**', 'tokens.ts'] } } });
  try {
    todosNegados(dir, [
      ['Bash', "echo 'export const cor = \"#123456\"' > src/tema/cores.ts"],
      ['Bash', 'echo x >> tokens.ts'],
      ['Bash', "printf x | tee src/tema/espacos.ts"],
      ['Bash', 'cp novo.ts src/tema/cores.ts'],
      ['PowerShell', "Set-Content -Path src\\tema\\cores.ts -Value 'x'"]
    ]);
    // controle: fora dos caminhos declarados, o mesmo .ts passa
    todosPermitidos(dir, [['Bash', 'echo x > src/app.ts'], ['Bash', 'echo x > src/tema-antigo/cores.ts']]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-1 nega: o comando embrulhado em bash -c, sh -c, eval e powershell -Command', () => {
  const dir = montar();
  try {
    todosNegados(dir, [
      ['Bash', "bash -c 'echo x > src/a.css'"],
      ['Bash', 'sh -c "cat > src/a.css"'],
      ['Bash', "eval 'echo x > src/a.css'"],
      ['Bash', "pwsh -Command \"Set-Content src/a.css 'x'\""],
      ['Bash', "powershell -NoProfile -Command \"'x' | Out-File src/a.css\""],
      ['PowerShell', "powershell -Command \"Set-Content src/a.css 'x'\""]
    ]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-1 nega: caminho com variavel mas com o nome terminando em extensao de estilo (o resto nao se sabe, a extensao sim)', () => {
  const dir = montar();
  try {
    todosNegados(dir, [
      ['Bash', 'for f in a b; do echo x > "$f.css"; done'],
      ['Bash', 'for f in a b; do echo x > $f.css; done'],
      ['Bash', 'echo x > $OUT/styles.scss'],
      ['Bash', 'echo x | tee "${DIR}/a.less"'],
      ['PowerShell', 'Set-Content -Path "$dir\\a.css" -Value x'],
      ['PowerShell', "Get-ChildItem | ForEach-Object { 'x' | Set-Content \"$($_.Name).css\" }"]
    ]);
    // controle: variavel sem extensao de estilo no fim nao se sabe, e passa
    todosPermitidos(dir, [
      ['Bash', 'echo x > "$f"'],
      ['Bash', 'echo x > $f.txt'],
      ['Bash', 'echo x > "$HOME/.css-cache/lista"'],
      ['PowerShell', 'Set-Content -Path $f -Value x']
    ]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-1 nega: cmd /c (o Windows), com o redirecionamento dentro do texto', () => {
  const dir = montar();
  try {
    todosNegados(dir, [
      ['PowerShell', 'cmd /c "echo x > src\\a.css"'],
      ['Bash', 'cmd /c "echo x > src/a.css"'],
      ['PowerShell', 'cmd.exe /c echo x > src\\a.css']
    ]);
    todosPermitidos(dir, [['PowerShell', 'cmd /c "echo x > nota.txt"']]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-1 nega: no meio de uma lista (&&, ;, |, subshell, quebra de linha, comentario antes)', () => {
  const dir = montar();
  try {
    todosNegados(dir, [
      ['Bash', 'npm run build && echo x > src/a.css'],
      ['Bash', 'echo a; echo x > src/a.css; echo b'],
      ['Bash', 'false || echo x > src/a.css'],
      ['Bash', '( echo x > src/a.css )'],
      ['Bash', 'echo $(echo x > src/a.css)'],
      ['Bash', 'echo oi\n# um comentario\necho x > src/a.css'],
      ['Bash', 'FOO=1 echo x > src/a.css'],
      ['Bash', 'git status\ncat > src/a.css <<EOF\nx\nEOF\ngit diff'],
      ['Bash', 'cat src/a.css | tee src/b.css']
    ]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-1 nega: caminho absoluto dentro do projeto, com barra normal ou invertida; fora do projeto passa', () => {
  const dir = montar();
  try {
    const dentro = path.join(dir, 'src', 'a.css');
    const fora = path.join(os.tmpdir(), 'sworn-estilo-fora-do-projeto', 'a.css');
    todosNegados(dir, [
      ['Bash', 'echo x > "' + dentro.replace(/\\/g, '/') + '"'],
      ['PowerShell', "Set-Content -Path '" + dentro + "' -Value x"]
    ]);
    if (process.platform === 'win32') {
      // Git Bash escreve o disco como /c/pasta/arquivo
      const gitBash = dentro.replace(/^([A-Za-z]):/, function (m, d) { return '/' + d.toLowerCase(); }).replace(/\\/g, '/');
      todosNegados(dir, [['Bash', 'echo x > "' + gitBash + '"']]);
    }
    // o portao de Write/Edit tambem deixa passar o que esta fora do projeto (relativoAoProjeto devolve null)
    todosPermitidos(dir, [['Bash', 'echo x > "' + fora.replace(/\\/g, '/') + '"']]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------- 0.5.2 (D396): P2 n. 2-7 e 14 do plano secao 2.1

test('D396 n. 2: variavel definida no proprio comando vira o valor dela; fora do projeto passa, dentro nega', () => {
  const dir = montar();
  try {
    const fora = path.join(os.tmpdir(), 'sworn-estilo-fora-do-projeto');
    const foraBarra = fora.replace(/\\/g, '/');
    todosPermitidos(dir, [
      ['Bash', 'OUT="' + foraBarra + '"; echo x > "$OUT/styles.scss"'],
      ['Bash', 'export OUT=' + foraBarra + '\ncat > "${OUT}/a.css" <<EOF\nx\nEOF'],
      ['PowerShell', "$out = '" + fora + "'; Set-Content -Path \"$out\\a.css\" -Value x"],
      ['PowerShell', "$env:OUT = '" + fora + "'; Set-Content -Path \"$env:OUT\\a.css\" -Value x"]
    ]);
    todosNegados(dir, [
      ['Bash', 'OUT=src; echo x > "$OUT/a.css"'],
      ['PowerShell', "$Out = 'src'; Set-Content -Path \"$out\\a.css\" -Value x"],
      // a variavel que o comando nao define continua sem pasta conhecida: a extensao basta para negar
      ['Bash', 'OUT=src; echo x > "$OUTRA/a.css"']
    ]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D396 n. 3: (Join-Path ...) como argumento do PowerShell e o caminho, nao o fim do comando', () => {
  const dir = montar();
  try {
    todosNegados(dir, [
      ['PowerShell', "Set-Content -Path (Join-Path src 'a.css') -Value x"],
      ['PowerShell', 'Set-Content (Join-Path -Path src -ChildPath a.css) x'],
      ['PowerShell', "'x' | Out-File (Join-Path $dir 'a.css')"]
    ]);
    todosPermitidos(dir, [['PowerShell', "Set-Content -Path (Join-Path src 'notas.txt') -Value x"]]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  // o `)` so se procura numa janela: muitos `(Join-Path` sem fechar nao viram conta quadratica
  const t0 = Date.now();
  assert.ok(Array.isArray(design.alvosDeEstiloNoShell('x (Join-Path '.repeat(20000), null, { ferramenta: 'PowerShell' })));
  assert.ok(Date.now() - t0 < 2000, 'demorou ' + (Date.now() - t0) + ' ms');
});

test('D396 n. 4: -InputObject leva valor e nao e o alvo', () => {
  const dir = montar();
  try {
    todosNegados(dir, [['PowerShell', 'Out-File -InputObject $css src\\a.css']]);
    todosPermitidos(dir, [['PowerShell', "Out-File -InputObject 'tema.css' notas.txt"]]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D396 n. 5: New-Item -Name se junta ao -Path (ou a pasta solta)', () => {
  assert.deepStrictEqual(design.alvosDeEstiloNoShell('New-Item -ItemType File -Path src -Name a.css -Value x', null, { ferramenta: 'PowerShell' }),
    ['src/a.css']);
  assert.deepStrictEqual(design.alvosDeEstiloNoShell('New-Item src -Name a.css', null, { ferramenta: 'PowerShell' }), ['src/a.css']);
  assert.deepStrictEqual(design.alvosDeEstiloNoShell('New-Item -Name a.css -ItemType File', null, { ferramenta: 'PowerShell' }), ['a.css']);
  const dir = montar({ extra: { design: { caminhosDeEstilo: ['tokens/*.ts'] } } });
  try {
    todosNegados(dir, [['PowerShell', 'New-Item -Path tokens -Name cores.ts -ItemType File']]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D396 n. 6: cp/Copy-Item para pasta sem barra no fim (destino sem extensao) e escrita dentro da pasta', () => {
  assert.deepStrictEqual(design.alvosDeEstiloNoShell('cp novo.css src', null, { ferramenta: 'Bash' }), ['src/novo.css']);
  assert.deepStrictEqual(design.alvosDeEstiloNoShell('cp a.css b.scss estilos', null, { ferramenta: 'Bash' }), ['estilos/a.css', 'estilos/b.scss']);
  assert.deepStrictEqual(design.alvosDeEstiloNoShell('Copy-Item x.css src', null, { ferramenta: 'PowerShell' }), ['src/x.css']);
  const dir = montar();
  try {
    todosNegados(dir, [['Bash', 'cp novo.css src'], ['Bash', 'mv x.css .'], ['PowerShell', 'Copy-Item x.css src']]);
    // controle: destino com extensao e arquivo; ~ e $ seguem como antes (pasta que nao se sabe)
    todosPermitidos(dir, [['Bash', 'cp notas.txt docs'], ['Bash', 'cp a.css ~'], ['Bash', 'cp a.css $DEST'], ['Bash', 'cp a.css b.txt']]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D396 n. 7: bash/sh sem -c le o heredoc como o roteiro', () => {
  const dir = montar();
  try {
    todosNegados(dir, [
      ['Bash', "bash <<'EOF'\necho x > src/a.css\nEOF"],
      ['Bash', 'sh -s <<EOF\ncat > src/a.css\nEOF']
    ]);
    // controle: com arquivo de roteiro, o heredoc e a entrada dele, nao comandos
    todosPermitidos(dir, [['Bash', "bash <<'EOF'\necho x > notas.txt\nEOF"], ['Bash', "bash gerar.sh <<'EOF'\necho x > src/a.css\nEOF"]]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D396 n. 14: a mensagem do shell diz por que nega (o conteudo do comando nao se le antes de rodar)', () => {
  const m = design.motivoShell(['src/a.css']);
  assert.ok(/Por que:/.test(m) && /conteudo/.test(m), m);
});

// -------------------------------------------------------------- coluna "deve PERMITIR"

test('T11-1 permite: ler arquivo de estilo (cat, grep, git diff, sed -n, head, Get-Content)', () => {
  const dir = montar();
  try {
    todosPermitidos(dir, [
      ['Bash', 'cat src/a.css'],
      ['Bash', 'grep -n color src/a.css'],
      ['Bash', 'git diff src/a.css'],
      ['Bash', "sed -n '1,5p' src/a.css"],
      ['Bash', 'head -20 src/a.css | grep color'],
      ['Bash', 'grep -rn "color" --include=*.css src'],
      ['Bash', 'git log -p -- src/a.css'],
      ['Bash', "node -e \"console.log(require('fs').readFileSync('src/a.css','utf8'))\""],
      ['PowerShell', 'Get-Content src\\a.css'],
      ['PowerShell', 'Get-Content src\\a.css | Select-String color'],
      ['PowerShell', 'Select-String -Path src\\a.css -Pattern color']
    ]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-1 permite: o arquivo de estilo e o que se le; o alvo do > nao e estilo', () => {
  const dir = montar();
  try {
    todosPermitidos(dir, [
      ['Bash', 'cat src/a.css > saida.txt'],
      ['Bash', 'diff a.css b.css > out.patch'],
      ['Bash', 'git log -p -- src/a.css > historico.txt'],
      ['Bash', 'cat src/a.css >> lista.txt 2>&1'],
      ['Bash', 'npm test 2>&1 | tee log.txt'],
      ['Bash', 'echo oi > /dev/null'],
      ['Bash', 'ls src > lista.css.txt'],
      ['PowerShell', 'Get-Content src\\a.css | Out-File saida.txt'],
      ['PowerShell', 'Get-Content src\\a.css > saida.txt']
    ]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-1 permite: npm run build e comandos sem relacao com estilo', () => {
  const dir = montar();
  try {
    todosPermitidos(dir, [
      ['Bash', 'npm run build'],
      ['Bash', 'npm test'],
      ['Bash', 'git status'],
      ['Bash', 'ls -la'],
      ['Bash', 'echo x > notas.txt'],
      ['Bash', 'echo x >> README.md'],
      ['PowerShell', 'npm run build'],
      ['PowerShell', "Set-Content -Path notas.txt -Value 'x'"]
    ]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-1 permite: git checkout, restore, mv, add, commit e rm citando arquivo de estilo', () => {
  const dir = montar();
  try {
    todosPermitidos(dir, [
      ['Bash', 'git checkout -- src/a.css'],
      ['Bash', 'git restore src/a.css'],
      ['Bash', 'git restore --staged --worktree src/a.css'],
      ['Bash', 'git mv a.css b.css'],
      ['Bash', 'git add src/a.css'],
      ['Bash', 'git commit -m "feat: ajusta a.css e b.scss"'],
      ['Bash', 'git stash push -- src/a.css'],
      ['Bash', 'rm src/a.css'],
      ['Bash', 'rm -f src/a.css src/b.scss'],
      ['PowerShell', 'git restore src\\a.css'],
      ['PowerShell', 'Remove-Item src\\a.css'],
      ['PowerShell', 'Remove-Item -Path src\\a.css -Force']
    ]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-1 permite: o estilo so aparece como fonte, como texto citado, ou no corpo de um heredoc de outro arquivo', () => {
  const dir = montar();
  try {
    todosPermitidos(dir, [
      ['Bash', 'cp src/a.css backup.txt'],
      ['Bash', 'mv a.css a.old'],
      ['Bash', "sed -i 's/a/b/' README.md"],
      ['Bash', "sed -i 's/a.css/b.css/' README.md"],
      ['Bash', 'echo "a > b.css"'],
      ['Bash', "echo 'cat > src/a.css'"],
      ['Bash', 'echo "edite o a.css" > nota.txt'],
      ['Bash', "cat > nota.md <<'EOF'\nrode: echo x > src/a.css\nEOF"],
      ['Bash', "node -e \"require('fs').writeFileSync('nota.txt','veja src/a.css')\""],
      ['Bash', "node -e \"require('fs').writeFileSync('nota.txt','a.css')\""],
      ['Bash', "node -e \"const fs = require('fs'); fs.writeFileSync('out.txt', fs.readFileSync('src/a.css','utf8').replace(/a/g,'b'))\""],
      ['Bash', "node -e \"require('fs').copyFileSync('src/a.css', 'backup.txt')\""],
      ['Bash', "bash -c 'echo x > nota.txt'"],
      ['PowerShell', "Set-Content -Path notas.txt -Value 'veja a.css'"],
      ['PowerShell', 'Copy-Item src\\a.css backup.txt'],
      ['PowerShell', 'Copy-Item -Path src\\a.css -Destination backup.txt'],
      ['PowerShell', "Set-Content -Path nota.md -Value @'\nSet-Content src\\a.css x\n'@"],
      ['PowerShell', "[System.IO.File]::WriteAllText('nota.txt', 'a.css')"],
      ['PowerShell', 'New-Item -ItemType Directory -Path estilos.css.d']
    ]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-1 permite sem design.json: qualquer escrita de .css (o modulo e opcional), sem estado', () => {
  const dir = montar({ semDesign: true });
  try {
    todosPermitidos(dir, [
      ['Bash', "cat > src/a.css <<'EOF'\n.x{color:#123456}\nEOF"],
      ['Bash', 'echo x >> estilos/b.scss'],
      ['Bash', "printf x | tee src/a.css"],
      ['Bash', "sed -i 's/#fff/#000/' src/a.css"],
      ['Bash', 'cp novo.css src/a.css'],
      ['Bash', 'node -e "require(\'fs\').writeFileSync(\'src/a.css\',\'x\')"'],
      ['PowerShell', "Set-Content -Path src\\a.css -Value 'x'"]
    ]);
    assert.strictEqual(sessao(dir), null, 'permitir nao enche balde de contador');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-1 permite sem projeto.json: qualquer escrita de .css, mesmo com design.json solto na pasta', () => {
  const dir = montar({ semProjeto: true });
  try {
    todosPermitidos(dir, [
      ['Bash', "cat > src/a.css <<'EOF'\n.x{color:#123456}\nEOF"],
      ['PowerShell', "Set-Content -Path src\\a.css -Value 'x'"]
    ]);
    assert.strictEqual(sessao(dir), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-1 permite: pasta sem .claude nenhum', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-estilo-vazio-'));
  try {
    todosPermitidos(dir, [['Bash', 'echo x > src/a.css']]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------------- o que acontece quando nega

test('T11-1: negar enche o balde estilo_por_shell, uma vez por negacao, e nada mais', () => {
  const dir = montar();
  try {
    chamar(dir, 'Bash', 'echo x > src/a.css');
    assert.strictEqual(sessao(dir).contadores.estilo_por_shell, 1, JSON.stringify(sessao(dir)));
    chamar(dir, 'PowerShell', "Set-Content src\\a.css 'x'");
    const s = sessao(dir);
    assert.strictEqual(s.contadores.estilo_por_shell, 2, JSON.stringify(s));
    assert.deepStrictEqual(Object.keys(s.contadores), ['estilo_por_shell'], 'outro balde encheu: ' + JSON.stringify(s));
    // permitir depois nao mexe no balde
    chamar(dir, 'Bash', 'cat src/a.css');
    assert.strictEqual(sessao(dir).contadores.estilo_por_shell, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-1: a mensagem diz que o sworn confere o design.json no Write e no Edit, cita o arquivo e nao ensina desvio', () => {
  const dir = montar();
  try {
    const m = motivoDe(chamar(dir, 'Bash', "cat > src/a.css <<'EOF'\n.x{color:#123456}\nEOF"));
    assert.ok(m, 'tinha de negar');
    assert.ok(/design\.json/.test(m), m);
    assert.ok(/Write/.test(m) && /Edit/.test(m), 'tem de mandar usar Write ou Edit: ' + m);
    assert.ok(m.indexOf('src/a.css') !== -1, 'tem de citar o arquivo: ' + m);
    assert.ok(/^[\x20-\x7E\n]+$/.test(m), 'motivo tem de ser ASCII: ' + JSON.stringify(m));
    assert.ok(!/\bdesligar|\bcontorn|\bburl|\bevit|\bescap|\bpassa\b/i.test(m), 'a mensagem fala em desvio: ' + m);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-1: nem a mensagem nova nem a do Write/Edit ensinam desvio - sem comando alternativo, sem "outro lugar"', () => {
  const motivoShell = design.motivoShell(['src/a.css', 'src/b.scss']);
  const r = design.conferir('.a{color:#00ff00;}', SISTEMA);
  const motivoWrite = design.motivo('src/a.css', r.fora, SISTEMA);
  const proibido = /\b(cat|echo|printf|tee|sed|awk|perl|python|node|cp|mv|heredoc|redirecion\w*|Set-Content|Out-File|Add-Content|copiar|copie|outro (lugar|arquivo|caminho|diretorio|pasta)|outra pasta|depois|renomei\w*|mover|mova)\b/i;
  for (const [nome, texto] of [['motivoShell', motivoShell], ['motivo', motivoWrite]]) {
    assert.ok(!proibido.test(texto), nome + ' ensina um desvio: ' + (texto.match(proibido) || [])[0] + '\n' + texto);
  }
  assert.ok(motivoShell.indexOf('src/a.css') !== -1 && motivoShell.indexOf('src/b.scss') !== -1, 'tem de listar todos os arquivos');
  assert.ok(!/\bde shell\b|\bshell\b/i.test(motivoWrite), 'a mensagem do Write/Edit nao fala de shell: ' + motivoWrite);
});

test('T11-1: negar nao depende das travas do destrutivo - travas.destrutivo:false e comandosLiberados:[".*"] seguem negando', () => {
  const dir = montar({ extra: { travas: { destrutivo: false }, comandosLiberados: ['.*'] } });
  try {
    todosNegados(dir, [['Bash', 'echo x > src/a.css'], ['PowerShell', "Set-Content src\\a.css 'x'"]]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-1: o portao-destrutivo continua igual - nao nega a escrita de .css (quem nega e o portao novo)', () => {
  const dir = montar({ extra: { plataforma: { so: 'linux', shell: 'bash' } } });
  try {
    const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'portao-destrutivo.js')], {
      cwd: dir, encoding: 'utf8',
      input: JSON.stringify({ session_id: 'pd', cwd: dir, tool_name: 'Bash', tool_input: { command: 'echo x > src/a.css' } }),
      env: Object.assign({}, process.env, { SWORN_TMP: path.join(dir, '_sessoes') })
    });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout, '', 'o destrutivo nao pode ganhar regra de estilo: ' + r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ----------------------------------------------------------- entrada quebrada (io.blindar)

test('T11-1: entrada quebrada, vazia ou sem comando sai 0, calado e sem estado', () => {
  const dir = montar();
  try {
    const brutos = ['', '   ', '{isso nao fecha', 'null', '42', '[]', '"texto"', '{}',
      JSON.stringify({ session_id: 'q', cwd: dir, tool_name: 'Bash' }),
      JSON.stringify({ session_id: 'q', cwd: dir, tool_name: 'Bash', tool_input: null }),
      JSON.stringify({ session_id: 'q', cwd: dir, tool_name: 'Bash', tool_input: { command: '' } }),
      JSON.stringify({ session_id: 'q', cwd: dir, tool_name: 'Bash', tool_input: { command: 42 } }),
      JSON.stringify({ session_id: 'q', cwd: dir, tool_name: 'Bash', tool_input: { command: { x: 1 } } }),
      JSON.stringify({ session_id: 'q', cwd: dir, tool_name: 'Bash', tool_input: { command: ['echo x > a.css'] } }),
      JSON.stringify({ session_id: 'q', cwd: 12345, tool_name: 'Bash', tool_input: { command: 'echo x > a.css' } })];
    for (const bruto of brutos) {
      const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'portao-estilo.js')], {
        cwd: dir, encoding: 'utf8', input: bruto,
        env: Object.assign({}, process.env, { SWORN_TMP: path.join(dir, '_sessoes') })
      });
      assert.strictEqual(r.status, 0, JSON.stringify(bruto) + ': ' + r.stderr);
      assert.ok(!/portao falhou/.test(r.stderr || ''), JSON.stringify(bruto) + ' estourou: ' + r.stderr);
      assert.strictEqual(r.stdout, '', JSON.stringify(bruto) + ' -> ' + r.stdout);
    }
    assert.strictEqual(sessao(dir, 'q'), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-1: design.json ou projeto.json quebrados desligam o modulo (sem estourar, sem negar)', () => {
  const dir = montar();
  try {
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'design.json'), '{isso nao fecha', 'utf8');
    todosPermitidos(dir, [['Bash', 'echo x > src/a.css']]);
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'design.json'), JSON.stringify(SISTEMA), 'utf8');
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), '{isso nao fecha', 'utf8');
    todosPermitidos(dir, [['Bash', 'echo x > src/a.css']]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ----------------------------------------------------------------------- a funcao da lib

test('design.alvosDeEstiloNoShell: devolve os caminhos de estilo escritos, normalizados, sem repetir e na ordem', () => {
  const projeto = { design: { caminhosDeEstilo: ['src/tema/**'] } };
  assert.deepStrictEqual(design.alvosDeEstiloNoShell('echo x > src\\a.css && echo y >> ./src/a.css', projeto, { ferramenta: 'PowerShell' }),
    ['src/a.css']);
  assert.deepStrictEqual(design.alvosDeEstiloNoShell('echo x > src/a.css && echo y >> ./src/a.css', projeto, { ferramenta: 'Bash' }),
    ['src/a.css']);
  assert.deepStrictEqual(design.alvosDeEstiloNoShell('echo x > a.css; echo y > src/tema/c.ts; echo z > notas.txt', projeto),
    ['a.css', 'src/tema/c.ts']);
  assert.deepStrictEqual(design.alvosDeEstiloNoShell('cat a.css', projeto), []);
  assert.deepStrictEqual(design.alvosDeEstiloNoShell('', projeto), []);
  assert.deepStrictEqual(design.alvosDeEstiloNoShell(undefined, null), []);
  assert.deepStrictEqual(design.alvosDeEstiloNoShell(42, null), []);
  assert.deepStrictEqual(design.alvosDeEstiloNoShell({ x: 1 }, null), []);
});

test('design.alvosDeEstiloNoShell: texto absurdo nao estoura nem trava (aspas abertas, aninhamento fundo, muito comprido)', () => {
  const casos = ["echo 'aberta > a.css", 'echo "aberta > a.css', 'cat <<EOF\nsem fim > a.css', '$(' .repeat(300) + 'echo x > a.css' + ')'.repeat(300),
    'echo x > ', '>', '>>', '<<', '<<<', '2>', '&>', 'tee', 'sed -i', 'cp', 'node -e', 'bash -c', 'Set-Content', '@\'', "@'\n",
    'a'.repeat(200000) + ' > b.css', 'echo ' + 'x > a.css; '.repeat(5000)];
  for (const c of casos) {
    const t0 = Date.now();
    const r = design.alvosDeEstiloNoShell(c, null, { ferramenta: 'Bash' });
    assert.ok(Array.isArray(r), 'nao devolveu lista para ' + JSON.stringify(c.slice(0, 40)));
    assert.ok(Date.now() - t0 < 2000, 'demorou ' + (Date.now() - t0) + ' ms para ' + JSON.stringify(c.slice(0, 40)));
  }
});

// ----------------------------------------------------------------------------- a fiacao

test('hooks.json: o portao-estilo e o SEGUNDO gancho da entrada Bash|PowerShell, depois do portao-destrutivo', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(RAIZ, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const grupo = hooks.PreToolUse.filter(function (g) { return g.matcher === 'Bash|PowerShell'; });
  assert.strictEqual(grupo.length, 1, 'tem de haver uma entrada Bash|PowerShell so');
  const scripts = grupo[0].hooks.map(function (h) { return h.args[0]; });
  // Plano 091 (#1): o portao do commit vem por ultimo (so ele roda git, e so no comando de commit).
  assert.deepStrictEqual(scripts, [
    '${CLAUDE_PLUGIN_ROOT}/scripts/portao-destrutivo.js',
    '${CLAUDE_PLUGIN_ROOT}/scripts/portao-estilo.js',
    '${CLAUDE_PLUGIN_ROOT}/scripts/portao-commit.js'
  ]);
  for (const h of grupo[0].hooks) {
    assert.strictEqual(h.type, 'command');
    assert.strictEqual(h.command, 'node');
    assert.strictEqual(typeof h.timeout, 'number');
  }
  // o Write|Edit segue com o portao-escopo sozinho
  const we = hooks.PreToolUse.filter(function (g) { return g.matcher === 'Write|Edit|NotebookEdit'; });
  assert.deepStrictEqual(we[0].hooks.map(function (h) { return h.args[0]; }), ['${CLAUDE_PLUGIN_ROOT}/scripts/portao-escopo.js']);
  assert.ok(fs.existsSync(path.join(RAIZ, 'scripts', 'portao-estilo.js')));
});

test('saude.js: estilo_por_shell e balde de bloqueio (nega), como o token_fora_do_sistema', () => {
  const saude = require('../scripts/lib/saude.js');
  assert.ok(saude.BALDES_DE_BLOQUEIO.indexOf('estilo_por_shell') !== -1);
  assert.ok(saude.BALDES_DE_BLOQUEIO.indexOf('token_fora_do_sistema') !== -1);
});

// D420/SH-02: o contador `estilo_por_shell` rodava ANTES da negacao sem protecao. Com o diretorio de
// estado nao gravavel (SWORN_TMP apontando para um ARQUIVO) o incrementar lancava, `io.blindar`
// liberava e a escrita de estilo por shell PASSAVA. O contador e acessorio: a negacao vem primeiro.
test('D420/SH-02: estado nao gravavel nao libera a escrita de estilo por shell', () => {
  const dir = montar();
  const arquivo = path.join(dir, 'e-um-arquivo');
  fs.writeFileSync(arquivo, 'x');
  try {
    const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'portao-estilo.js')], {
      cwd: dir,
      encoding: 'utf8',
      input: JSON.stringify({ session_id: 'pe-sh02', cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Bash',
        tool_input: { command: "cat > src/a.css <<'EOF'\n.x { color: #123456; }\nEOF" } }),
      env: Object.assign({}, process.env, { SWORN_TMP: arquivo })
    });
    assert.ok(motivoDe(r), 'tinha de negar com o estado fora do ar; stdout ' + JSON.stringify(r.stdout) + ' stderr ' + r.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
