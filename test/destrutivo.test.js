'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const destrutivo = require('../scripts/lib/destrutivo.js');
const git = require('../scripts/lib/git.js');

const RAIZ = path.join(__dirname, '..');

// R-T12-04 / D119: MEDIDOR DE ORDEM DE GRANDEZA, no lugar do relogio de parede.
// Os tres tetos de 250 ms que existiam aqui mediam a MAQUINA, nao o algoritmo:
// bastava um worker de teste a mais disputando CPU para `60k COM gatilho`
// custar 518,34 ms e reprovar codigo correto. Como qualquer tarefa nova da
// Etapa 3 em diante acrescenta arquivo de teste, o falso negativo so pioraria.
//
// O que estes testes sempre quiseram provar esta escrito nos comentarios deles:
// a mudanca de ORDEM DE GRANDEZA, nao um numero de milissegundos. Entao a
// catraca passa a ser a RAZAO entre dois tamanhos medidos na MESMA maquina, na
// MESMA rodada: quadruplicar a entrada custa ~4x se o custo e linear e ~16x se
// e quadratico. A contencao inflaciona as DUAS medidas juntas, e a razao
// sobrevive - o relogio absoluto nao sobrevivia.
//
// Duas defesas contra ruido de escalonamento:
//   - o MENOR de N execucoes, porque contencao so pode SOMAR tempo, nunca
//     subtrair: o minimo e o estimador robusto;
//   - medidas INTERCALADAS, para que um pico nao caia so num dos lados.
// A chamada de aquecimento tira o custo de compilacao da primeira medida.
//
// F1-H05 / F1-H06: so isso ainda oscilou - em 2026-10-06 uma rodada deu 9,24x com
// teto 8 num codigo linear. Por isso o que os testes chamam e `razaoConfirmada`:
// 9 repeticoes (eram 5; o minimo de mais amostras cai mais) e, se a primeira
// medida passa do teto, uma SEGUNDA medida completa - so reprova se as duas
// passarem. Uma funcao quadratica de verdade passa do teto nas duas (~16x); um
// pico de escalonamento raramente cai nas duas. O teto em si nao mudou.
function razaoDeCusto(repeticoes, fnPequeno, fnGrande) {
  fnPequeno(); fnGrande();
  let pequeno = Infinity;
  let grande = Infinity;
  for (let i = 0; i < repeticoes; i++) {
    let t0 = process.hrtime.bigint();
    fnPequeno();
    const msP = Number(process.hrtime.bigint() - t0) / 1e6;
    if (msP < pequeno) pequeno = msP;
    t0 = process.hrtime.bigint();
    fnGrande();
    const msG = Number(process.hrtime.bigint() - t0) / 1e6;
    if (msG < grande) grande = msG;
  }
  return { pequeno: pequeno, grande: grande, razao: grande / pequeno };
}

// Teto da catraca: 4x de entrada custa ~4x se linear, ~16x se quadratico.
// 8 fica no meio, em escala log. Medido nesta maquina, 5 rodadas: 4,67 a 5,49
// sem gatilho e 4,08 a 4,87 com gatilho. A queda de 2026-10-06 (9,24x) foi sob
// carga, nao mudanca de algoritmo: o teto fica, a medida e que e confirmada.
const TETO_RAZAO = 8;

const REPETICOES_RAZAO = 9;

// Devolve a medida que decide: a primeira, se ela fica abaixo do teto; senao a menor das
// duas. `razoes` e o texto com TODAS as razoes medidas, para a mensagem de falha.
function razaoConfirmada(fnPequeno, fnGrande) {
  const primeira = razaoDeCusto(REPETICOES_RAZAO, fnPequeno, fnGrande);
  if (primeira.razao < TETO_RAZAO) {
    return Object.assign({}, primeira, { razoes: primeira.razao.toFixed(2) + 'x' });
  }
  const segunda = razaoDeCusto(REPETICOES_RAZAO, fnPequeno, fnGrande);
  const melhor = segunda.razao < primeira.razao ? segunda : primeira;
  return Object.assign({}, melhor, {
    razoes: primeira.razao.toFixed(2) + 'x na 1a medida e ' + segunda.razao.toFixed(2) + 'x na 2a'
  });
}

const DEVE_BARRAR = [
  'rm -rf build',
  'rm -fr ./dist',
  'Remove-Item -Recurse -Force .\\dist',
  'git reset --hard origin/main',
  'git clean -fd',
  'git push --force origin main',
  'git push -f',
  'git branch -D feature',
  'DROP TABLE usuarios;',
  'TRUNCATE TABLE log;',
  'npm publish'
];

const DEVE_PASSAR = [
  'npm test',
  'git status --short',
  'git log --oneline -5',
  'node --test test/',
  'git add . && git commit -m "x"',
  'rm arquivo.txt'
];
// D48: a entrada que estava aqui era
//   'echo "rm -rf isso e so texto"'.replace('rm -rf', 'r m - r f')
// O .replace() destruia exatamente o caso sob teste: a string que chegava em
// classificar nao continha "rm", o nome do teste prometia "deixa passar comando
// de leitura" e a assercao nao podia falhar. O comportamento real - o comando E
// barrado, e esse falso positivo e ACEITO - esta no teste D48 no fim deste
// arquivo, e o limite esta declarado em docs/desenho-v1.md secao 10.

test('destrutivo: barra o que precisa de decisao humana', () => {
  for (const cmd of DEVE_BARRAR) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, 'devia barrar: ' + cmd);
  }
});

test('destrutivo: deixa passar comando de leitura e de teste', () => {
  for (const cmd of DEVE_PASSAR) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false, 'devia passar: ' + cmd);
  }
});

// Revisao completa, L1 (A9-06): as grafias de A1-01..05 que o rm e o git de verdade aceitam e o portao deixava
// passar (`achados/A1-destrutivo.md`): opcao do rm depois do alvo ou depois de uma opcao longa (A1-01), opcao longa
// abreviada (A1-02), a arvore inteira sem o `.` (A1-03), `dd` com os operandos invertidos (A1-04) e `branch -d -f` (A1-05).
const DEVE_BARRAR_A1 = [
  'rm --no-preserve-root -rf /',
  'rm --verbose -rf build',
  'sudo rm --verbose -rf build',
  'rm dist -rf',
  'rm a b -rf',
  'rm build -Rf',
  'rm build -vrf',
  'rm build.log -f',
  'rm --rec build',
  'rm --forc build.log',
  'git reset --har HEAD~1',
  'git reset --h',
  'git checkout --forc main',
  'git switch --disc main',
  'git push --del origin main',
  'git push --mir origin',
  'git push --prun origin',
  'git checkout :/',
  'git checkout ./',
  'git checkout *',
  'git checkout -- *',
  'git restore ./',
  'git restore :/',
  'git restore *',
  'git restore --worktree :/',
  'git restore --source HEAD ./',
  'dd of=/dev/sda if=img',
  'dd bs=1M of=/dev/sda if=x',
  'git branch -d -f x',
  'git branch -df x',
  'git branch -fd x',
  'git branch --delete --force x'
];

// Os vizinhos que nao apagam e tem de continuar passando depois da correcao.
const DEVE_PASSAR_A1 = [
  'rm report.txt',
  'rm -i build.log',
  'git restore --staged :/',
  'git restore --staged ./',
  'git checkout ./src/a.js',
  'git checkout :/src/a.js',
  'git checkout -- .gitignore',
  'git branch -d feature',
  'git branch -f feature main',
  'git branch --format x',
  'git reset --soft HEAD~1',
  'git push --dry-run origin main',
  'dd --version'
];

test('destrutivo: L1 (A1-01..05) barra as grafias que o rm e o git aceitam', () => {
  const passaram = DEVE_BARRAR_A1.filter((cmd) => !destrutivo.classificar(cmd).destrutivo);
  assert.deepStrictEqual(passaram, []);
});

test('destrutivo: L1 (A1-01..05) deixa passar os vizinhos que nao apagam', () => {
  const barraram = DEVE_PASSAR_A1.filter((cmd) => destrutivo.classificar(cmd).destrutivo);
  assert.deepStrictEqual(barraram, []);
});

test('destrutivo: projeto pode acrescentar padrao proprio', () => {
  const projeto = { comandosBloqueados: ['gcloud\\s+run\\s+deploy'] };
  assert.strictEqual(destrutivo.classificar('gcloud run deploy api', projeto).destrutivo, true);
  assert.strictEqual(destrutivo.classificar('gcloud run deploy api').destrutivo, false);
});

test('destrutivo: padrao invalido no projeto nao derruba o portao', () => {
  const projeto = { comandosBloqueados: ['[isso nao compila'] };
  assert.strictEqual(destrutivo.classificar('npm test', projeto).destrutivo, false);
});

test('destrutivo: motivo e ASCII puro e nomeia o comando', () => {
  const r = destrutivo.classificar('rm -rf build');
  const m = destrutivo.motivo('rm -rf build', r);
  assert.ok(/^[\x20-\x7E\n]+$/.test(m));
  assert.ok(m.includes('rm -rf build'));
});

test('git D49: fora de repo devolve null (nao consegui), nao lista vazia (arvore limpa)', () => {
  const fora = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-sem-git-'));
  const limpo = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-git-limpo-'));
  try {
    assert.strictEqual(git.modificados(fora), null,
      'fora de repositorio o git falha, e falha e null - senao a guarda da D46 congela');
    assert.strictEqual(git.modificados(''), null, 'sem cwd tambem e null');

    // A OUTRA METADE da distincao da D49, e o caso mais comum de todos: arvore
    // limpa. Sem esta ponta o teste acima passaria contra um `modificados` que
    // devolvesse null SEMPRE - e ai a trava 5b ficaria muda o dia inteiro.
    // `[]` e `null` sao coisas diferentes: `[]` congela a foto (nada de outra
    // frente, e nao ha o que refotografar); `null` deixa a proxima abertura
    // tentar de novo (abertura.js:25).
    const g = (args) => spawnSync('git', args, { cwd: limpo, encoding: 'utf8', shell: false });
    g(['init', '-q']);
    g(['config', 'user.email', 'teste@exemplo.com']);
    g(['config', 'user.name', 'teste']);
    fs.writeFileSync(path.join(limpo, 'a.txt'), 'um', 'utf8');
    g(['add', '-A']);
    g(['commit', '-q', '-m', 'inicial']);
    const foto = git.modificados(limpo);
    assert.deepStrictEqual(foto, [],
      'arvore limpa e lista VAZIA, nunca null: ' + JSON.stringify(foto));
    assert.ok(Array.isArray(foto) && git.modificados(fora) === null,
      'a guarda da D46 (Array.isArray) tem de saber separar os dois casos');
  } finally {
    fs.rmSync(fora, { recursive: true, force: true });
    fs.rmSync(limpo, { recursive: true, force: true });
  }
});

test('git: enxerga arquivo modificado e nao rastreado', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-git-'));
  try {
    const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', shell: false });
    g(['init', '-q']);
    g(['config', 'user.email', 'teste@exemplo.com']);
    g(['config', 'user.name', 'teste']);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'um', 'utf8');
    g(['add', 'a.txt']);
    g(['commit', '-q', '-m', 'inicial']);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'dois', 'utf8');
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'sub', 'b.txt'), 'novo', 'utf8');
    const lista = git.modificados(dir);
    assert.ok(lista.includes('a.txt'), JSON.stringify(lista));
    assert.ok(lista.includes('sub/b.txt'), JSON.stringify(lista));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('portao-destrutivo: nega rm -rf e libera npm test', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-dest-'));
  try {
    const chamar = (comando) => {
      const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'portao-destrutivo.js')], {
        input: JSON.stringify({ session_id: 's1', cwd: tmp, tool_name: 'Bash', tool_input: { command: comando } }),
        encoding: 'utf8',
        env: Object.assign({}, process.env, { SWORN_TMP: tmp })
      });
      try { return JSON.parse(r.stdout); } catch (e) { return null; }
    };
    const negado = chamar('rm -rf build');
    assert.strictEqual(negado.hookSpecificOutput.permissionDecision, 'deny');
    assert.strictEqual(chamar('npm test'), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('git D41: em subpasta, o caminho volta relativo ao cwd que o portao usa', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-git-sub-'));
  try {
    const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', shell: false });
    g(['init', '-q']);
    g(['config', 'user.email', 'teste@exemplo.com']);
    g(['config', 'user.name', 'teste']);
    fs.mkdirSync(path.join(dir, 'pacote', 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pacote', 'src', 'a.js'), 'um', 'utf8');
    fs.writeFileSync(path.join(dir, 'raiz.txt'), 'r', 'utf8');
    g(['add', '-A']);
    g(['commit', '-q', '-m', 'inicial']);
    fs.writeFileSync(path.join(dir, 'pacote', 'src', 'a.js'), 'dois', 'utf8');
    fs.writeFileSync(path.join(dir, 'raiz.txt'), 'rr', 'utf8');

    const daRaiz = git.modificados(dir);
    assert.ok(daRaiz.includes('pacote/src/a.js'), 'na raiz: ' + JSON.stringify(daRaiz));
    assert.ok(daRaiz.includes('raiz.txt'), 'na raiz: ' + JSON.stringify(daRaiz));

    // O portao compara com caminho relativo ao cwd - em `portao-escopo.js`,
    // procure o simbolo `alvoBaixo` e o `deOutraFrente` logo abaixo dele.
    // Ponteiro por SIMBOLO e nao por numero: o numero envelhece a cada
    // comentario acrescentado acima dele (licao da D57).
    const daSub = git.modificados(path.join(dir, 'pacote'));
    assert.ok(daSub.includes('src/a.js'), 'na subpasta: ' + JSON.stringify(daSub));
    assert.ok(!daSub.includes('raiz.txt'),
      'arquivo fora do cwd nao entra na lista: ' + JSON.stringify(daSub));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('destrutivo D43: caixa trocada e forma longa das flags nao sao escape', () => {
  for (const cmd of ['RM -rf src', 'Rm -rf src', 'rm -RF src',
                     'rm --recursive --force src', 'rm --recursive src',
                     'RM --RECURSIVE --FORCE src']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, 'devia barrar: ' + cmd);
  }
  // Fechar a burla nao pode criar falso positivo: o piso continua deixando passar o inocente.
  for (const cmd of ['rm arquivo.txt', 'git rm arquivo.txt', 'npm run build', 'npm test > log.txt']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false, 'devia passar: ' + cmd);
  }
});

test('destrutivo D44: comando acentuado nao vaza byte fora de ASCII no texto do hook', () => {
  const cmd = 'rm -rf relatório-de-produção';
  const r = destrutivo.classificar(cmd);
  assert.strictEqual(r.destrutivo, true, 'o comando acentuado tem de ser classificado como destrutivo');
  const m = destrutivo.motivo(cmd, r);
  assert.ok(/^[\x20-\x7E\n]+$/.test(m), 'texto emitido nao e ASCII puro: ' + JSON.stringify(m));
  assert.ok(m.includes('relatorio-de-producao'),
    'o comando tem de aparecer no texto, sem acento: ' + JSON.stringify(m));
});

test('destrutivo D64: o MOTIVO tambem nao vaza byte fora de ASCII (R5)', () => {
  // ACHADO DA RONDA 7, lente de governanca. Os dois testes de ASCII acima sao
  // CEGOS ao unico caminho por onde nao-ASCII entra de verdade: `motivo()`
  // higienizava o COMANDO e concatenava `r.motivo` cru, e `extras()` monta
  // `regra do projeto: <padrao>` a partir do `projeto.json`, que e texto
  // arbitrario do dono. Acento em portugues e o caso NORMAL, nao o exotico.
  //
  // A R5 (`plano-v1.md`, secao das regras) exige ASCII no TEXTO EMITIDO POR
  // HOOK. Comentario de codigo, `.md` e teste podem ter acento; o que sai pelo
  // hook, nao. Medido antes da correcao: o texto saia com ["c-cedilha","a-til"].
  const padrao = 'deploy produção';
  const r = destrutivo.classificar(padrao, { comandosBloqueados: [padrao] });
  assert.strictEqual(r.destrutivo, true, 'a regra do projeto tem de disparar');
  assert.ok(/produção/.test(r.motivo),
    'o motivo CLASSIFICADO guarda o padrao como o dono escreveu: ' + JSON.stringify(r.motivo));

  const m = destrutivo.motivo(padrao, r);
  assert.ok(/^[\x20-\x7E\n]+$/.test(m),
    'o texto EMITIDO nao e ASCII puro: ' + JSON.stringify(m));
  assert.ok(m.includes('regra do projeto: deploy producao'),
    'o motivo tem de aparecer no texto, sem acento: ' + JSON.stringify(m));

  // CONTROLE NEGATIVO: higienizar o motivo nao pode apagar o motivo. Sem isto,
  // um `r.motivo = ''` passaria nas duas assercoes acima.
  const r2 = destrutivo.classificar('rm -rf src');
  const m2 = destrutivo.motivo('rm -rf src', r2);
  assert.ok(m2.includes('Por que barrou: rm recursivo ou forcado.'),
    'o motivo built-in nao pode ter sido perdido pela higienizacao: ' + JSON.stringify(m2));
});

test('destrutivo D47: opcao global do git nao derruba as regras de git', () => {
  for (const cmd of ['git -C . reset --hard', 'git --no-pager reset --hard',
                     'git -c core.x=1 clean -fd', 'git -C .. restore .',
                     'git -c a=b push --force origin main', 'git -C . branch -D feature',
                     'git --no-optional-locks rebase -i HEAD~3']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, 'devia barrar: ' + cmd);
  }
  // CONTROLE NEGATIVO: sem ele este teste passaria contra um portao que barra
  // TUDO que comeca com `git `. O que decide e o SUBCOMANDO depois da opcao
  // global, nao a presenca da opcao global - estes tem a mesma forma de prefixo
  // e subcomando inofensivo.
  for (const cmd of ['git -C . status --short', 'git --no-pager log -5',
                     'git -c core.pager=cat diff', 'git -c rebase.autoStash=true pull']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false, 'devia passar: ' + cmd);
  }
});

test('destrutivo D47: +refspec e push forcado', () => {
  for (const cmd of ['git push origin +main', 'git push origin +refs/heads/main:refs/heads/main']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, 'devia barrar: ' + cmd);
  }
  assert.strictEqual(destrutivo.classificar('git push origin main').destrutivo, false);
  assert.strictEqual(destrutivo.classificar('git push origin HEAD:refs/for/main').destrutivo, false);
});

test('destrutivo D47: apelido do PowerShell e parametro abreviado', () => {
  for (const cmd of ['ri -Recurse -Force src', 'rd src -Recurse -Force', 'del src -Recurse',
                     'Remove-Item -Recu -Fo src', 'erase src -Recurse -Force',
                     'rmdir src -Recurse -Force', 'Remove-Item -R src',
                     // D49: a ORDEM CANONICA - flag antes do caminho, que e a forma mais
                     // curta e a que a documentacao usa. `src` liga posicionalmente em -Path.
                     'rd -Recurse src', 'ri -Recurse src', 'del -Recurse src',
                     'erase -Recurse src', 'rmdir -Recurse src', 'rd -Recurse:$true src',
                     // D49: posicao de comando dentro de bloco de script e de atribuicao
                     'Get-ChildItem sub | rd -Recurse',
                     'Get-ChildItem | ForEach-Object { rd $_ -Recurse -Force }',
                     'if (Test-Path src) { rd src -Recurse -Force }',
                     '& { rd src -Recurse -Force }',
                     '$null = rd src -Recurse -Force',
                     'powershell -Command rd src -Recurse -Force']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, 'devia barrar: ' + cmd);
  }
  // CONTROLE NEGATIVO: sem ele este teste passaria contra uma regra que barrasse
  // qualquer linha com `-Recurse`. O que decide e o apelido estar em POSICAO DE
  // COMANDO (D51) - nos dois primeiros o nome do apelido aparece como argumento
  // nu, e nos dois ultimos as flags sao exatamente as mesmas de um caso barrado.
  for (const cmd of ['Copy-Item rd dst -Recurse -Force',
                     'Select-String -Path src -Pattern del -Recurse',
                     'Get-ChildItem -Path src -Recurse -Force',
                     'Copy-Item .\\rd\\ dst -Recurse -Force']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false, 'devia passar: ' + cmd);
  }
});

test('destrutivo D47: regra maior nao pode criar falso positivo', () => {
  for (const cmd of ['git -C . status --short', 'git --no-pager log -5', 'git -c core.pager=cat diff',
                     'git -C .. diff --stat', 'git checkout -b feature', 'git checkout main',
                     'git checkout -- arquivo.txt', 'git restore --staged arquivo.txt',
                     'git branch -d feature', 'git branch -a', 'git push origin main',
                     'git push --set-upstream origin feature', 'git push origin HEAD:refs/for/main',
                     'git clean -n', 'git clean --dry-run', 'git rm arquivo.txt',
                     'Get-ChildItem -Path src -Recurse -Force', 'Copy-Item src dst -Recurse -Force',
                     'Copy-Item .\\rd\\ dst -Recurse -Force', 'Copy-Item .\\ri\\ dst -Recurse',
                     'Select-String -Path src -Pattern "erase" -Recurse',
                     'Write-Host "ri is not a command" -ForegroundColor Red',
                     'Get-Content .\\del\\notas.txt',
                     'New-Item -ItemType Directory -Force -Path build',
                     'Compress-Archive -Path src -DestinationPath a.zip -Force',
                     // D49: comando COMPOSTO de bash. `rm arquivo.txt` e permitido pelo piso,
                     // e encadear com um `-R` de outro comando nao pode transformar isso em
                     // destrutivo. Era a lacuna da bancada anterior, que so tinha PowerShell e git.
                     'rm a.txt && cp -R src dst', 'rm package-lock.json && chmod -R 755 dist',
                     'rm nota.txt; grep -R TODO src', 'rm build.log && ls -R',
                     'rm tmp.txt; docker compose up -d --force-recreate',
                     'rm log.txt && npm run build -- --force',
                     'rm ./notas.md && node tools/gerar.js',
                     'Remove-Item log.txt; Get-ChildItem -R',
                     'del .\\tmp.txt; Get-ChildItem . -Recurse',
                     // D49: `rebase.autoStash` e configuracao publicada do git, e o `.`
                     // e fronteira de palavra - o subcomando tem de ser token completo.
                     'git -c rebase.autoStash=true pull', 'git -c rebase.autosquash=true log',
                     'git -c push.default=simple log', 'git -c push.default=simple checkout main',
                     // D49: o `+` fora de refspec
                     'git push origin main # +1', 'git push origin main && echo " +ok"',
                     // D50: nao pode barrar push comum nem refspec normal
                     'git push origin main:main', 'git push -u origin feature']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false, 'devia passar: ' + cmd);
  }
});

test('destrutivo D48: comando que apenas cita um destrutivo e barrado - limite declarado', () => {
  // Falso positivo ACEITO e declarado em docs/desenho-v1.md secao 10. Ignorar o
  // trecho entre aspas abriria `bash -c "rm -rf src"`, que e muito pior: deixar
  // passar um comando que apaga custa mais que barrar uma mensagem de commit.
  for (const cmd of ['echo "rm -rf isso e so texto"',
                     'git commit -m "removi o rm -rf do script"',
                     'cat README.md | grep "git reset --hard"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'o limite declarado tem de continuar visivel: ' + cmd);
  }
  // E a razao de ele ser aceito: o destrutivo de verdade, escondido entre aspas, e barrado.
  for (const cmd of ['bash -c "rm -rf src"', "sh -c 'rm -rf src'",
                     'pwsh -Command "Remove-Item -Recurse -Force src"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, 'devia barrar: ' + cmd);
  }
  // O par NEGATIVO, sem o qual este teste inteiro passaria com uma regra /./ :
  // a D48 registra `grep -rn "rm -rf" .` como comando que PASSA, e o passe sem
  // aspas da D50 nao pode quebrar isso - por isso ele so tira aspas de UM token.
  assert.strictEqual(destrutivo.classificar('grep -rn "rm -rf" .').destrutivo, false,
    'frase entre aspas nao pode ser descascada');
});

test('D45: a trava 5b nao se escapa trocando a caixa do caminho', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-d45-'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-d45-tmp-'));
  try {
    const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', shell: false });
    g(['init', '-q']);
    g(['config', 'user.email', 'teste@exemplo.com']);
    g(['config', 'user.name', 'teste']);
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    // `**/*.md` e marcha RAPIDA: o passo 5 do portao devolve permitir antes de
    // chegar ao escopo, entao a 5b e a UNICA barreira. Sem esta escolha de
    // fixture o teste passaria tambem contra o codigo velho, pela via
    // `fora_do_escopo`, e nao discriminaria nada.
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify({
      versaoConfig: 1, marchaPadrao: 'padrao', intocaveis: ['segredos/**'],
      marchas: { aaa: ['**/auth/**'], padrao: ['src/**'], rapida: ['**/*.md'] }
    }), 'utf8');
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'escopo.md'),
      '# Escopo\n**Objetivo:** exercitar a 5b\n## Dentro\n- src/app.js\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'guia.md'), 'um', 'utf8');
    g(['add', '-A']);
    g(['commit', '-q', '-m', 'inicial']);
    // outra frente mexeu em guia.md ANTES desta sessao abrir
    fs.writeFileSync(path.join(dir, 'guia.md'), 'outra frente', 'utf8');

    const env = Object.assign({}, process.env, { SWORN_TMP: tmp });
    spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'abertura.js')], {
      input: JSON.stringify({ session_id: 'd45', cwd: dir, source: 'startup' }),
      encoding: 'utf8', env: env
    });
    const escrever = (rel) => {
      const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'portao-escopo.js')], {
        input: JSON.stringify({
          session_id: 'd45', cwd: dir, tool_name: 'Write',
          tool_input: { file_path: path.join(dir, rel), content: 'x' }
        }),
        encoding: 'utf8', env: env
      });
      try { return JSON.parse(r.stdout).hookSpecificOutput.permissionDecision; }
      catch (e) { return 'permitir'; }
    };
    const motivoDe = (rel) => {
      const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'portao-escopo.js')], {
        input: JSON.stringify({
          session_id: 'd45', cwd: dir, tool_name: 'Write',
          tool_input: { file_path: path.join(dir, rel), content: 'x' }
        }),
        encoding: 'utf8', env: env
      });
      try { return JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason; }
      catch (e) { return ''; }
    };
    // CONTROLE NEGATIVO: sem ele um portao que negasse tudo passaria neste teste.
    assert.strictEqual(escrever('notas.md'), 'permitir',
      'arquivo que NAO estava na foto tem de passar - marcha rapida nao exige escopo');
    assert.strictEqual(escrever('guia.md'), 'deny', 'a 5b tem de pegar o arquivo de outra frente');
    // E tem de negar POR SER de outra frente, nao por outra via: a D45 so importa
    // aqui porque este caminho e marcha rapida e o passo 5 nem chega a rodar.
    assert.match(motivoDe('guia.md'), /outra frente/i,
      'a negacao tem de vir da trava 5b, e o texto e a prova de qual via negou');
    assert.strictEqual(escrever('GUIA.md'), 'deny', 'trocar a caixa e o MESMO arquivo no disco');
    assert.match(motivoDe('GUIA.md'), /outra frente/i, 'e pela 5b tambem com a caixa trocada');
    assert.strictEqual(escrever('Guia.MD'), 'deny', 'trocar a caixa e o MESMO arquivo no disco');
    // Sem conferir o MOTIVO, num CI Linux esta linha passaria verde mesmo com a
    // D45 revertida: la `glob.js:4` compara com caixa, `Guia.MD` nao casaria
    // `**/*.md`, a marcha viraria padrao e o passo 5 negaria por `fora_do_escopo`.
    // Verde pela via errada e a mesma classe de defeito das duas linhas acima.
    assert.match(motivoDe('Guia.MD'), /outra frente/i,
      'a negacao tem de vir da 5b, nao do passo 5 do portao');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// TS-04 (lote 3, D423): o D45 acima so tem a FOTO em minuscula; o lado `p` (a foto) nunca trazia maiuscula,
// entao tirar o `.toLowerCase()` de `String(p)` na 5b passava despercebido. Aqui o git guarda `Guia.md`.
test('TS-04 (lote 3, D423): a 5b dobra a caixa tambem do lado da FOTO - foto com Guia.md nega guia.md e GUIA.MD', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-ts04-'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-ts04-tmp-'));
  try {
    const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', shell: false });
    g(['init', '-q']);
    g(['config', 'user.email', 'teste@exemplo.com']);
    g(['config', 'user.name', 'teste']);
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    // marcha RAPIDA para `.md`: o passo 5 devolve permitir, e a 5b e a UNICA barreira (mesma razao do D45)
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify({
      versaoConfig: 1, marchaPadrao: 'padrao', intocaveis: ['segredos/**'],
      marchas: { aaa: ['**/auth/**'], padrao: ['src/**'], rapida: ['**/*.md'] }
    }), 'utf8');
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'escopo.md'),
      '# Escopo\n**Objetivo:** exercitar a 5b\n## Dentro\n- src/app.js\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'Guia.md'), 'um', 'utf8');
    g(['add', '-A']);
    g(['commit', '-q', '-m', 'inicial']);
    fs.writeFileSync(path.join(dir, 'Guia.md'), 'outra frente', 'utf8');

    const env = Object.assign({}, process.env, { SWORN_TMP: tmp });
    spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'abertura.js')], {
      input: JSON.stringify({ session_id: 'ts04', cwd: dir, source: 'startup' }),
      encoding: 'utf8', env: env
    });
    const foto = JSON.parse(fs.readFileSync(path.join(tmp, 'sworn', 'ts04.json'), 'utf8')).gitAbertura;
    assert.deepStrictEqual(foto, ['Guia.md'], 'pre-condicao: a foto tem de guardar a maiuscula do git');
    const escrever = (rel) => {
      const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'portao-escopo.js')], {
        input: JSON.stringify({
          session_id: 'ts04', cwd: dir, tool_name: 'Write',
          tool_input: { file_path: path.join(dir, rel), content: 'x' }
        }),
        encoding: 'utf8', env: env
      });
      try {
        const h = JSON.parse(r.stdout).hookSpecificOutput;
        return { decisao: h.permissionDecision, motivo: h.permissionDecisionReason };
      } catch (e) { return { decisao: 'permitir', motivo: '' }; }
    };
    // CONTROLE NEGATIVO: arquivo fora da foto passa (marcha rapida) - um portao que negasse tudo reprovaria aqui
    assert.strictEqual(escrever('notas.md').decisao, 'permitir');
    for (const rel of ['guia.md', 'GUIA.MD', 'Guia.md']) {
      const r = escrever(rel);
      assert.strictEqual(r.decisao, 'deny', rel + ': a 5b tem de pegar o arquivo de outra frente');
      assert.match(r.motivo, /outra frente/i, rel + ': a negacao tem de vir da 5b, nao de outra via');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('D46: SessionStart em compact nao refaz a foto do git', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-d46-'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-d46-tmp-'));
  try {
    const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', shell: false });
    g(['init', '-q']);
    g(['config', 'user.email', 'teste@exemplo.com']);
    g(['config', 'user.name', 'teste']);
    fs.writeFileSync(path.join(dir, 'guia.md'), 'um', 'utf8');
    fs.writeFileSync(path.join(dir, 'notas.md'), 'um', 'utf8');
    g(['add', '-A']);
    g(['commit', '-q', '-m', 'inicial']);
    fs.writeFileSync(path.join(dir, 'guia.md'), 'outra frente', 'utf8');

    const env = Object.assign({}, process.env, { SWORN_TMP: tmp });
    const abrir = (source) => spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'abertura.js')], {
      input: JSON.stringify({ session_id: 'd46', cwd: dir, source: source }),
      encoding: 'utf8', env: env
    });
    const foto = () => JSON.parse(fs.readFileSync(path.join(tmp, 'sworn', 'd46.json'), 'utf8')).gitAbertura;

    // Conferir o exit: sem isto o teste nao distingue "a guarda funcionou" de
    // "a invocacao morreu" - as duas deixam o arquivo de estado intacto.
    assert.strictEqual(abrir('startup').status, 0, 'o SessionStart de abertura tem de rodar');
    const primeira = foto();
    assert.deepStrictEqual(primeira, ['guia.md'], 'foto da abertura: ' + JSON.stringify(primeira));

    // O agente faz o proprio trabalho, e o contexto compacta: o SessionStart
    // dispara de novo, com o MESMO session_id.
    fs.writeFileSync(path.join(dir, 'notas.md'), 'trabalho do agente', 'utf8');
    assert.strictEqual(abrir('compact').status, 0, 'o SessionStart de compact tem de rodar');
    assert.deepStrictEqual(foto(), primeira,
      'a foto nao pode ser refeita em compact - entraria o trabalho do proprio agente: ' +
      JSON.stringify(foto()));

    // -------------------------------------------------------------------
    // FRONTEIRA DE TURNO. Acima, tudo acontece DENTRO de um turno, e a guarda
    // da D46 vale. Na vida real o turno FECHA antes do compact - e ate a T18 o
    // fecho apagava o estado inteiro, levando a foto junto: o compact seguinte
    // refotografava e engolia o trabalho do proprio agente.
    // A T18 (`plano-v1.md:5324-5603`, Passo 5) separa o que morre no fim do
    // TURNO (trabalhoReal, bloqueouNesteTurno, contadores) do que dura a SESSAO
    // (turnosComTrabalho, gitAbertura, arquivosTocados, contadoresSessao,
    // avisouSaude, e os campos de `estado.CAMPOS_DA_SESSAO`). Com isso a foto
    // sobrevive, e a D46 vale a sessao inteira.
    const chamarScript = (script, extra) => spawnSync(
      process.execPath, [path.join(RAIZ, 'scripts', script)],
      { input: JSON.stringify(Object.assign({ session_id: 'd46', cwd: dir }, extra)),
        encoding: 'utf8', env: env });
    const estadoBruto = () => {
      try { return JSON.parse(fs.readFileSync(path.join(tmp, 'sworn', 'd46.json'), 'utf8')); }
      catch (e) { return null; }
    };

    // 1. Turno de conversa pura: `portao-fecho.js` sai antes de encerrarTurno
    // quando nao houve trabalho real. A foto nem e tocada.
    assert.strictEqual(chamarScript('portao-fecho.js').status, 0, 'o fecho tem de rodar (R6)');
    assert.deepStrictEqual(estadoBruto() && estadoBruto().gitAbertura, primeira,
      'turno sem trabalho real nao chega a encerrarTurno, e a foto sobrevive');

    // 2. Com trabalho real - que e o unico caso em que um `compact` acontece -
    // o fecho zera o TURNO e preserva a SESSAO. A foto e da sessao (T18/D123).
    assert.strictEqual(chamarScript('marcar-trabalho.js', { tool_name: 'Write' }).status, 0);
    assert.strictEqual(chamarScript('portao-fecho.js').status, 0);
    const depois = estadoBruto();
    assert.ok(depois, 'o estado de SESSAO tem de sobreviver ao fecho (T18)');
    assert.deepStrictEqual(depois.gitAbertura, primeira,
      'a foto e estado de SESSAO e sobrevive ao fecho: ' + JSON.stringify(depois));
    // e o que e do TURNO morre - senao a trava 3 congelaria
    assert.strictEqual(depois.trabalhoReal, undefined, 'trabalhoReal e do turno, tem de morrer');
    assert.strictEqual(depois.bloqueouNesteTurno, undefined, 'bloqueouNesteTurno e do turno');
    assert.strictEqual(depois.contadores, undefined,
      'o balde do TURNO nao pode sobreviver: seria descarregado de novo (D123)');

    // 3. E o SessionStart seguinte NAO refotografa: a regressao que a D46
    // existe para impedir fica fechada tambem atravessando a fronteira de turno.
    assert.strictEqual(abrir('compact').status, 0);
    assert.deepStrictEqual(foto(), ['guia.md'],
      'depois do fecho a foto NAO pode ser refeita - notas.md e trabalho do ' +
      'proprio agente e nao pode entrar: ' + JSON.stringify(foto()));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('destrutivo D50: a forma do cmd dos mesmos apelidos', () => {
  for (const cmd of ['rd /s /q build', 'rd /s/q build', 'del /s /q build',
                     'del /f /s /q build', 'cmd /c rd /s /q build', 'erase /s build']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, 'devia barrar: ' + cmd);
  }
  // Controle: o apelido dentro de um caminho nao e comando.
  for (const cmd of ['Get-Content .\\del\\notas.txt', 'Get-ChildItem -Path .\\del -Recurse',
                     'Copy-Item .\\rd\\ dst -Recurse -Force', 'npm run build -- /silent']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false, 'devia passar: ' + cmd);
  }
});

test('destrutivo D50: as outras formas de destruir referencia no remoto', () => {
  for (const cmd of ['git push origin :main', 'git push origin --delete main',
                     'git push --delete origin main', 'git push --mirror origin',
                     'git -C . push origin :refs/heads/main']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, 'devia barrar: ' + cmd);
  }
  // Controle: refspec normal tem `:` no meio do token, nao no comeco.
  for (const cmd of ['git push origin HEAD:refs/for/main', 'git push origin main:main',
                     'git push origin main']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false, 'devia passar: ' + cmd);
  }
});

test('destrutivo D50: aspas em volta de um token, e o sufixo .exe', () => {
  for (const cmd of ['git "reset" --hard', 'git reset "--hard"', "git 'reset' --hard",
                     'rm "-rf" build', 'rm "-rf" "build"', 'git.exe reset --hard',
                     'git.exe push --force origin main']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, 'devia barrar: ' + cmd);
  }
  // Controle: FRASE entre aspas nao e descascada. Sem esta linha o passe da D50
  // viraria um "ignore todas as aspas" e quebraria o que a D48 registrou.
  assert.strictEqual(destrutivo.classificar('grep -rn "rm -rf" .').destrutivo, false);
  assert.strictEqual(destrutivo.classificar('git commit -m "del the old file"').destrutivo, false);
});

test('D49: a foto que falhou nao congela a sessao', () => {
  const fora = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-d49-fora-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-d49-repo-'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-d49-tmp-'));
  try {
    const g = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8', shell: false });
    g(['init', '-q']);
    g(['config', 'user.email', 'teste@exemplo.com']);
    g(['config', 'user.name', 'teste']);
    fs.writeFileSync(path.join(repo, 'guia.md'), 'um', 'utf8');
    g(['add', '-A']);
    g(['commit', '-q', '-m', 'inicial']);
    fs.writeFileSync(path.join(repo, 'guia.md'), 'outra frente', 'utf8');

    const env = Object.assign({}, process.env, { SWORN_TMP: tmp });
    const abrir = (cwd, source) => spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'abertura.js')], {
      input: JSON.stringify({ session_id: 'd49', cwd: cwd, source: source }),
      encoding: 'utf8', env: env
    });
    const estadoDe = () => {
      try { return JSON.parse(fs.readFileSync(path.join(tmp, 'sworn', 'd49.json'), 'utf8')); }
      catch (e) { return {}; }
    };

    // Abertura FORA de repositorio: a foto falha. Nao pode ficar registrada.
    assert.strictEqual(abrir(fora, 'startup').status, 0, 'o hook tem de sair com 0 mesmo falhando (R6)');
    assert.strictEqual(estadoDe().gitAbertura, undefined,
      'foto que falhou nao pode virar lista vazia gravada: ' + JSON.stringify(estadoDe()));

    // Reabertura, agora dentro do repositorio: a segunda chance tem de valer.
    assert.strictEqual(abrir(repo, 'resume').status, 0);
    assert.deepStrictEqual(estadoDe().gitAbertura, ['guia.md'],
      'a reabertura tem de conseguir fotografar: ' + JSON.stringify(estadoDe()));

    // E dai em diante a guarda da D46 vale: a foto boa nao e mais refeita.
    fs.writeFileSync(path.join(repo, 'notas.md'), 'trabalho do agente', 'utf8');
    assert.strictEqual(abrir(repo, 'compact').status, 0);
    assert.deepStrictEqual(estadoDe().gitAbertura, ['guia.md'],
      'depois de uma foto boa, compact nao refaz: ' + JSON.stringify(estadoDe()));
  } finally {
    fs.rmSync(fora, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('D49: a foto guarda o nome como esta no disco, e quem dobra a caixa e o portao', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-d49-caixa-'));
  try {
    const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', shell: false });
    g(['init', '-q']);
    g(['config', 'user.email', 'teste@exemplo.com']);
    g(['config', 'user.name', 'teste']);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'Componente.js'), 'um', 'utf8');
    g(['add', '-A']);
    g(['commit', '-q', '-m', 'inicial']);
    fs.writeFileSync(path.join(dir, 'src', 'Componente.js'), 'dois', 'utf8');
    // O contrato esta declarado no plano da T1; o segundo consumidor e a
    // varredura do `/sworn:init`, que mostra esta lista ao dono - procure
    // o simbolo `modificados: git.modificados(cwd)` em `docs/plano-v1.md`.
    // Ponteiro por SIMBOLO e nao por numero (licao da D57).
    assert.deepStrictEqual(git.modificados(dir), ['src/Componente.js'],
      'o nome tem de sair como esta no disco: ' + JSON.stringify(git.modificados(dir)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ===========================================================================
// D51: a trava 5a passa a LER o comando antes de casar as regras.
// Casos transcritos da bancada de medicao (.superpowers/sdd/plano-v1/
// fix5-bancada/bancada.js e ataque.js), 190 casos ao todo.
// ===========================================================================

test('destrutivo D51: comentario de bloco, continuacao de linha e separador dentro de aspas', () => {
  // As quatro burlas que o casamento de TEXTO nao via, porque nao sabia o que
  // era comentario, o que era quebra de linha e onde a aspa fechava. A mais
  // barata custava 9 caracteres (`<# & #>`) na regra de maior valor do portao.
  for (const cmd of ['Remove-Item <# & #> src -Recurse -Force',
                     'rd <# ; #> src -Recurse -Force',
                     'Remove-Item `\n  src -Recurse -Force',
                     'Remove-Item `\r\n  src -Recurse -Force',
                     'Remove-Item "C:\\Dados\\A & B" -Recurse -Force',
                     'rd "Projetos & Clientes" -Recurse -Force',
                     'Remove-Item "a;b" -Recurse -Force',
                     "Remove-Item 'a|b' -Recurse -Force",
                     'git re""set --hard',
                     "git re''set --hard"]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, 'devia barrar: ' + cmd);
  }
});

test('destrutivo D51: as outras formas de apagar referencia no remoto', () => {
  // O que decide agora e o TOKEN depois do `push`, e nao o texto: `-d`,
  // `--delete`, `--mirror`, `--prune`, ou um refspec que COMECA com `:` ou `+`.
  for (const cmd of ['git push origin -d main', 'git push -d origin main',
                     'git push origin :2026-release', 'git push origin :_wip',
                     'git push origin --prune', 'git push --prune origin',
                     'git push origin +2026', 'git push origin +_wip']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, 'devia barrar: ' + cmd);
  }
  // CONTROLE NEGATIVO: sem ele este teste passaria com uma regra `/./`. Refspec
  // normal tem o `:` no MEIO do token; `-u` e upstream; o `+1` esta em
  // comentario; e `fetch --prune` so apaga referencia local ja morta no remoto.
  for (const cmd of ['git push origin HEAD:refs/for/main', 'git push origin main:main',
                     'git push -u origin feature', 'git push origin main # +1',
                     'git fetch --prune']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false, 'devia passar: ' + cmd);
  }
});

test('destrutivo D51: apelido em posicao de comando, com e sem aspas', () => {
  // Os dois lados no MESMO teste de proposito: e a mesma mudanca - o apelido
  // virar regra de token com posicao de comando de verdade - que fecha o de
  // cima e abre o de baixo. Separa-los esconderia que sao um so movimento.
  for (const cmd of ['"rd" src -Recurse -Force', "'rd' -Recurse src",
                     '& "rd" src -Recurse -Force', '"del" /s /q build',
                     '"rmdir" /s /q build', "'del' src -Recurse"]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, 'devia barrar: ' + cmd);
  }
  // O apelido como argumento NU nao e comando - era falso positivo novo no fix4.
  for (const cmd of ['Select-String -Path src -Pattern del -Recurse',
                     'Select-String -Path . -Pattern rd -Recurse',
                     'Select-String -Path src -Pattern rm -Recurse',
                     'Copy-Item rd dst -Recurse -Force',
                     'Copy-Item del dst -Recurse',
                     'Get-ChildItem -Path src -Filter ri -Recurse',
                     'Move-Item erase dst -Force',
                     'Compare-Object -ReferenceObject rmdir -Recurse']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false, 'devia passar: ' + cmd);
  }
});

test('destrutivo D51: o leitor nao abre burla nova', () => {
  // Ataque ao proprio desenho: o leitor conhece aspas, comentario e continuacao,
  // e cada uma dessas coisas e uma porta em potencial. Estes 52 casos sao o que
  // o leitor PODERIA ter aberto (29) e o que PODERIA ter virado falso positivo (23).
  const caminhoLongo = 'C:\\Projetos\\' + 'pasta-muito-longa\\'.repeat(30) + 'alvo';
  const ABERTAS = [
    ['subexpressao: Remove-Item (Get-Item src)', 'Remove-Item (Get-Item src) -Recurse -Force'],
    ['subexpressao: rd (Get-Item src)', 'rd (Get-Item src) -Recurse -Force'],
    ['chave de variavel: Remove-Item ${alvo}', 'Remove-Item ${alvo} -Recurse -Force'],
    ['chave de variavel: rd ${alvo}', 'rd ${alvo} -Recurse -Force'],
    ['caminho win terminado em barra: rd', 'rd "C:\\Dados\\" -Recurse -Force'],
    ['caminho win terminado em barra: Remove-Item', 'Remove-Item "C:\\Dados\\" -Recurse -Force'],
    ['distancia > 400 chars entre nome e flag', 'Remove-Item "' + caminhoLongo + '" -Recurse -Force'],
    ['distancia > 400 chars, apelido', 'rd "' + caminhoLongo + '" -Recurse -Force'],
    ['distancia > 400 chars, rm longo', 'rm "' + caminhoLongo + '" --recursive'],
    ['operador de chamada com parenteses', '& (rd) src -Recurse'],
    ['pipeline com bloco', "Get-ChildItem | Where-Object { $_.Name -eq 'rd' } | Remove-Item -Recurse"],
    ['comentario glued: #dir e nome de pasta', 'rm -rf #dir'],
    ['comentario de bloco colado', 'Remove-Item<# x #>src -Recurse -Force'],
    ['bloco de comentario com & dentro', 'Remove-Item <# & #> src -Recurse -Force'],
    ['nested quotes bash', 'bash -c "rm -rf \\"a b\\""'],
    ['powershell -Command entre aspas', 'powershell -Command "rd src -Recurse -Force"'],
    ['pwsh /c', 'pwsh /c "rd src -Recurse -Force"'],
    ['tab em vez de espaco', 'rm\t-rf\tbuild'],
    ['espacos multiplos', 'rm   -rf   build'],
    ['flag antes do alvo entre aspas', 'Remove-Item -Recurse -Force "a b"'],
    ['atribuicao colada', '$null=rd src -Recurse -Force'],
    ['crase de continuacao no meio da flag', 'Remove-Item src `\n  -Recurse `\n  -Force'],
    ['barra invertida de continuacao (bash)', 'rm \\\n  -rf \\\n  build'],
    ['CRLF puro como separador nao pode salvar', 'echo ok\r\nrm -rf build'],
    ['git push com opcao global e -d', 'git -C . push origin -d main'],
    ['git push com aspas no subcomando', 'git "push" origin --delete main'],
    ['git push refspec com barra', 'git push origin :feature/x'],
    ['del depois de introdutor', 'cmd /c del /s /q build'],
    ['apelido com sufixo .exe', 'rd.exe src -Recurse -Force']
  ];
  const INOCENTES_NOVOS = [
    ['pattern entre parenteses', 'Select-String -Path src -Pattern (del) -Recurse'],
    ['nome de pasta chamado rd', 'Copy-Item .\\rd dst -Recurse -Force'],
    ['variavel chamada rd', 'Get-ChildItem | Where-Object { $_.Name -eq "rd" }'],
    ['mensagem de commit citando pasta', 'git commit -m "removi a pasta (rd) do build"'],
    ['comentario de linha com +1', 'git push origin main # +1'],
    ['comentario de linha inteiro', '# rm -rf src'],
    ['echo com comentario depois', 'echo ok # rm -rf src'],
    ['fetch --prune e inofensivo', 'git fetch --prune'],
    ['fetch -p e inofensivo', 'git fetch -p origin'],
    ['remote prune e inofensivo', 'git remote prune origin'],
    ['push normal com refspec', 'git push origin HEAD:refs/for/main'],
    ['push com upstream', 'git push -u origin feature'],
    ['config com push. no nome', 'git -c push.default=simple checkout main'],
    ['grep da frase entre aspas (D48)', 'grep -rn "rm -rf" .'],
    ['ajuda do cmdlet', 'Get-Help Remove-Item -Full'],
    ['npm com --force em outro segmento', 'rm log.txt && npm run build -- --force'],
    ['docker force-recreate em outro segmento', 'rm tmp.txt; docker compose up -d --force-recreate'],
    ['docker force-recreate no MESMO segmento sem rm', 'docker compose up -d --force-recreate'],
    ['tar -c com nome parecido', 'tar -c rd.tar src'],
    ['gcc -c', 'gcc -c rm.c -o rm.o'],
    ['variavel com chaves em comando inocente', 'echo ${PATH}'],
    ['subexpressao inocente', 'Write-Host (Get-Date) -ForegroundColor Red'],
    ['select-string com rm nu', 'Select-String -Path src -Pattern rm -Recurse']
  ];
  for (const [rotulo, cmd] of ABERTAS) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'o leitor abriu uma burla: ' + rotulo + ' -> ' + JSON.stringify(cmd));
  }
  for (const [rotulo, cmd] of INOCENTES_NOVOS) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'o leitor criou falso positivo: ' + rotulo + ' -> ' + JSON.stringify(cmd));
  }
});

test('destrutivo D51: o custo deixa de ser quadratico', () => {
  // O `SEG` ("o nome, depois qualquer coisa, depois a flag") fazia a regra
  // varrer a linha inteira a partir de CADA ocorrencia do nome. Medido nesta
  // maquina: antes da D51, 1052,89 ms para estes 60 mil caracteres (1106 ms na
  // medicao do dono); depois, 11,92 ms. O que este teste precisa provar e a
  // mudanca de ORDEM DE GRANDEZA, nao um numero exato - e por isso a catraca e
  // a RAZAO entre dois tamanhos, e nao mais o relogio (R-T12-04 / D119).
  const base = 'rm a '.repeat(3000);
  const cmd = 'rm a '.repeat(12000);
  assert.strictEqual(base.length, 15000);
  assert.strictEqual(cmd.length, 60000);
  const m = razaoConfirmada(() => destrutivo.classificar(base),
                            () => destrutivo.classificar(cmd));
  assert.ok(m.razao < TETO_RAZAO,
    'quadruplicar a entrada custou ' + m.razoes + ' (teto ' + TETO_RAZAO +
    '; linear ~4, quadratico ~16): ' + m.pequeno.toFixed(2) + ' ms para 15 mil e ' +
    m.grande.toFixed(2) + ' ms para 60 mil caracteres');
});

test('destrutivo D51: lerComando separa o que tem de separar', () => {
  // Teste direto do leitor exportado. Sem ele, o passo que a D51 acrescentou so
  // seria observavel pelo veredito final, e um erro de separacao apareceria como
  // "falso positivo misterioso" em vez de "o leitor cortou no lugar errado".
  const dois = destrutivo.lerComando('rm a.txt && cp -R src dst');
  assert.strictEqual(dois.length, 2, 'do outro lado do && e OUTRO comando: ' +
    JSON.stringify(dois.map((s) => s.texto)));

  // O `;` dentro de aspas e nome de arquivo, nao separador.
  const um = destrutivo.lerComando('Remove-Item "a;b" -Recurse');
  assert.strictEqual(um.length, 1, 'a aspa diz onde o argumento termina: ' +
    JSON.stringify(um.map((s) => s.texto)));

  // Comentario de bloco vira espaco, e some do texto sobre o qual as regras rodam.
  const semComentario = destrutivo.lerComando('rd <# ; #> src -Recurse');
  assert.strictEqual(semComentario.length, 1, JSON.stringify(semComentario.map((s) => s.texto)));
  assert.ok(!semComentario[0].texto.includes('#'),
    'o comentario tem de sumir do texto: ' + JSON.stringify(semComentario[0].texto));

  // E a ponta que mantem a D48 de pe: argumento citado COM espaco dentro e
  // relido como comando aninhado, com nivel maior que zero.
  const aninhado = destrutivo.lerComando('powershell -Command "rd src -Recurse -Force"');
  assert.ok(aninhado.some((s) => s.nivel === 1 && /rd\s+src/i.test(s.texto)),
    'o comando de dentro das aspas tem de ser relido: ' +
    JSON.stringify(aninhado.map((s) => [s.nivel, s.texto])));

  // Posicao de comando: o primeiro token do segmento, e nao qualquer token.
  const posicao = destrutivo.lerComando('Copy-Item rd dst -Recurse');
  assert.ok(posicao[0].posCmd.has(0), 'o primeiro token esta em posicao de comando');
  assert.ok(!posicao[0].posCmd.has(1), 'o segundo token e argumento, nao comando');
});

test('destrutivo D53/D54: o escape ^ do cmd nao e escape do portao', () => {
  // A D51 transformou a forma do `cmd` em regra de TOKEN, e o token `^/s` nao e
  // `/s` - dai `del ^/s ^/q build` passava, executando `del /s /q build`.
  // A D53 tentou consertar descascando o `^` DENTRO do leitor, e isso apagou o
  // corte de segmento junto: `echo a ^; rd src -Recurse -Force` virou UM
  // comando so e vazou. Medido: 15 de 15 burlas passando.
  // A D54 descasca o `^` SO na comparacao da regra (`nu()` em `comandoE` e
  // `algumToken`), nunca na leitura. Assim o `^` so pode fazer barrar MAIS -
  // nunca mudar onde um comando comeca ou termina.
  for (const cmd of ['del ^/s ^/q build', 'rd ^/s ^/q build', 'del ^/s /q build',
                     'cmd /c del ^/s ^/q build',
                     // Este nem o codigo do fix4 pegava: o `^` no meio do nome.
                     '^d^e^l /s /q build', 'del /s ^/q build']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, 'devia barrar: ' + cmd);
  }

  // A REDE DE REGRESSAO QUE FALTAVA - e o teste que teria pegado a D53.
  // O `^` NUNCA pode mudar onde um comando comeca ou termina: em `cmd.exe` ele
  // escapa o separador, mas em PowerShell e em bash ele e literal e o separador
  // SEPARA de verdade (`echo a ^; echo BOOM` imprime `a`, `^`, `BOOM`). O portao
  // nao sabe qual shell vai executar, entao tem de barrar os dois lados.
  for (const cmd of ['echo a ^; rd src -Recurse -Force', 'echo a ^| rd src -Recurse -Force',
                     'echo a ^; del /s /q build', 'echo a ^| del /s /q build',
                     'echo a ^; rmdir /s /q build', 'echo a ^& rd src -Recurse -Force',
                     'echo a ^; git push origin --delete main',
                     'echo a ^& git push origin -d main',
                     'echo a ^; git push origin -d main',
                     'echo a ^{ rd src -Recurse -Force',
                     'ls^; del /s /q build',
                     // E a aspa: o `^` colado nela nao pode desfazer a aspa.
                     'rd ^"src" /s /q', 'del ^"src" /s /q',
                     'rd ^"src" -Recurse -Force', 'git push ^"origin" --delete main']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'o ^ nao pode fundir segmento nem desfazer aspa: ' + cmd);
  }

  // CONTROLE NEGATIVO: fechar o escape do cmd nao pode transformar em destrutivo
  // todo comando que usa `^` como ANCORA DE REGEX - que e o uso mais comum do
  // caractere numa linha de comando de verdade. Sem esta metade, a correcao
  // passaria trocando uma regressao por outra.
  for (const cmd of ['grep ^rm arquivo.txt', 'grep -E ^rm.*-rf arquivo.txt',
                     'rg ^rm --files', 'Select-String -Pattern ^del -Path src',
                     'echo ^', 'git log --grep ^fix']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false, 'devia passar: ' + cmd);
  }

  // LIMITE DECLARADO, e o preco da D54/D55 (docs/desenho-v1.md secao 10): o `^`
  // e descascado em toda COMPARACAO que decide barrar - as tres regras de token
  // (apelido do PowerShell, forma do cmd, apaga referencia no remoto), o teste
  // do INTRODUTOR em `montar()`, e nada alem. As regras de TEXTO -
  // `git reset --hard`, `git push --force`, `rm -rf` - continuam casando o texto
  // cru do segmento, e o `^` no meio delas continua escapando o casamento.
  // Preferimos isto a descascar na leitura, que foi o que abriu as 15 burlas
  // acima. Estes tres passavam antes da D53 e voltam a passar.
  for (const cmd of ['git ^reset --hard', 'git ^push --force origin main', 'r^m -rf build']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'limite declarado da D54, nao defeito novo: ' + cmd);
  }

  // NAO acrescentar `grep ^rm -rf .` aos controles negativos: ele barra, e
  // barrava antes da D53 tambem. E falso positivo pre-existente da classe D48 -
  // o comando CITA `rm -rf` -, nao efeito destas mudancas. Medido nas 3 versoes.
  assert.strictEqual(destrutivo.classificar('grep ^rm -rf .').destrutivo, true,
    'limite D48 pre-existente, declarado no desenho secao 10 - nao e regressao');
});

test('destrutivo D55: o `^` vale nas comparacoes de TOKEN que decidem barrar', () => {
  // A D54 descascou o `^` em `comandoE` e `algumToken`, mas essas nao sao as
  // unicas comparacoes de token que decidem barrar. Duas ficaram de fora:
  //   1. o teste do INTRODUTOR em `montar()`, que e quem poe o token seguinte
  //      em posicao de comando - dai `cmd /^c del /s /q build` escapava a regra
  //      que `cmd /c del ^/s ^/q build` recebe. Bastava mover o `^` um token
  //      para a esquerda. Medido: REGRESSAO contra o codigo do fix4.
  //   2. `apagaRemoto`, que descascava so no teste do `git` e depois comparava
  //      `indexOf('push')`, `APAGA_REF` e `:`/`+` literalmente.
  //
  // O criterio nao e ONDE o codigo esta, e SE aquela comparacao de TOKEN pode
  // fazer barrar mais. O leitor continua intocado - e o que a D54 estabeleceu.
  //
  // O QUE **NAO** DESCASCA, e e limite declarado no desenho secao 10:
  //   - `casa()`, as regras de TEXTO (`git reset --hard`, `git push --force`,
  //     `rm -rf`) - o preco que a D54 ja declarava;
  //   - `extras()`, a regra que o projeto escreve em projeto.json - o dono
  //     escreve o padrao contra o comando que ele ve;
  //   - o `$x=cmd` e o `ant === '='` em `montar()` - medido, nao executa em
  //     nenhum dos dois shells que o gancho casa (`^$null=rd` nao e comando no
  //     cmd, e `^=` nao existe no PowerShell).
  // Dizer "toda comparacao" seria falso, e frase falsa em portao de seguranca e
  // divida ativa: quem le acredita.

  // (1) `^` dentro do token INTRODUTOR.
  for (const cmd of ['cmd /^c del /s /q build', 'cmd ^/c del /s /q build',
                     'powershell -^Command rd src -Recurse -Force',
                     'powershell ^-Command rd src -Recurse -Force',
                     'pwsh -C^ommand rd src -Recurse -Force']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'o ^ no introdutor nao pode esconder a posicao de comando: ' + cmd);
  }

  // (2) `apagaRemoto` comparando token literal. O comentario do teste da D54
  // AFIRMAVA que esta familia ja recebia o tratamento do `^`, e nao recebia -
  // frase falsa dentro do proprio diff sob revisao.
  for (const cmd of ['git ^push origin --delete main', 'git ^push origin -d main',
                     'git push origin ^--delete main', 'git push origin ^-d main',
                     'git push origin ^:main', 'git push origin ^+main',
                     'git push ^--mirror origin', 'git push origin ^--prune']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'apagaRemoto tem de descascar o ^ nos tokens que compara: ' + cmd);
  }

  // (2b) A PRIMEIRA forma da correcao estava errada, e a revisao independente
  // pegou: `indexOf('push')` rodava ANTES do `findIndex(nu(t)==='push')` e
  // VENCIA. Bastava existir um token literalmente `push` DEPOIS do destrutivo
  // para o laco comecar tarde demais e a regra nao ver o `--delete`. Por isso o
  // `findIndex` vai SOZINHO: sem `^`, `nu(t) === t`, entao ele ja cobre o
  // `indexOf`. Esta rede existe para que a forma errada nao volte verde.
  for (const cmd of ['git ^push origin --delete main push',
                     'git ^push origin -d main push',
                     'git ^push origin --delete push',
                     'git ^push origin :main push',
                     'git ^push origin +main push',
                     'git p^ush origin --delete main push']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'um token `push` depois do destrutivo nao pode atrasar o laco: ' + cmd);
  }

  // E o caminho limpo nao pode mudar por causa disso.
  for (const [cmd, esperado] of [['git push origin --delete main', true],
                                 ['git push origin :refs/heads/main', true],
                                 ['git push origin main', false],
                                 ['git push origin HEAD:refs/for/main', false],
                                 ['git push origin main:main', false]]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, esperado,
      'o findIndex sozinho nao pode mexer no caminho limpo: ' + cmd);
  }

  // CONTROLE NEGATIVO - a metade que impede trocar uma regressao por outra.
  // `^` como ancora de regex LOGO DEPOIS de um introdutor e o caso que o
  // controle da D54 nao cobria, e e o mais comum numa linha de comando real.
  for (const cmd of ['bash -c "grep ^del arquivo.txt"', 'bash -c "grep ^rm src/*.js"',
                     'sh -c "grep ^rd notas.md"',
                     'powershell -Command "Select-String ^del -Path src"',
                     'bash -c "awk /^del/ dados.txt"',
                     'bash -c "sed -n /^rm/p script.sh"',
                     'cmd /c "findstr ^del arquivo.txt"',
                     'bash -c "rg ^erase --files"',
                     'bash -c "echo ^rm"', 'cmd /k "echo ^del"',
                     'bash -c "git log --grep ^rm"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'ancora de regex depois de introdutor nao pode virar falso positivo: ' + cmd);
  }

  // O LIMITE NAO MUDA: as regras de TEXTO continuam sem o tratamento do `^`,
  // exatamente como a D54 declarou no §10. Nao e defeito novo.
  for (const cmd of ['git ^reset --hard', 'git ^push --force origin main', 'r^m -rf build']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'limite declarado, herdado da D54: ' + cmd);
  }

  // E o leitor continua intocado: o `^` colado em separador nao funde comando.
  for (const cmd of ['echo a ^; rd src -Recurse -Force', 'echo a ^| del /s /q build',
                     'echo a ^& git push origin --delete main', 'rd ^"src" /s /q']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'a D54 continua valendo: o ^ nao mexe na segmentacao: ' + cmd);
  }
});

test('D51/5b: arquivo de outra frente DECLARADO no escopo passa - e so ele', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-5b-esc-'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-5b-esc-tmp-'));
  try {
    const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', shell: false });
    g(['init', '-q']);
    g(['config', 'user.email', 'teste@exemplo.com']);
    g(['config', 'user.name', 'teste']);
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    // `**/*.md` e marcha RAPIDA: o passo 5 do portao devolve permitir antes de
    // olhar escopo, entao a 5b (passo 2) e a UNICA barreira nestes caminhos.
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify({
      versaoConfig: 1, marchaPadrao: 'padrao', intocaveis: ['segredos/**'],
      marchas: { aaa: ['**/auth/**'], padrao: ['src/**'], rapida: ['**/*.md'] }
    }), 'utf8');
    // ARMADILHA JA MEDIDA: declarar `**/*.md` ou `src/**` aqui desligaria a 5b
    // INTEIRA, e este teste passaria contra qualquer codigo. O escopo declara
    // UM arquivo - o da rota de escape - e mais nada.
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'escopo.md'),
      '# Escopo\n**Objetivo:** exercitar a rota de escape da 5b\n' +
      '## Dentro\n- guia.md\n## Fora de escopo\n- notas.md\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'guia.md'), 'um', 'utf8');
    fs.writeFileSync(path.join(dir, 'notas.md'), 'um', 'utf8');
    g(['add', '-A']);
    g(['commit', '-q', '-m', 'inicial']);
    // Outra frente mexeu nos DOIS antes desta sessao abrir: os dois estao na foto.
    fs.writeFileSync(path.join(dir, 'guia.md'), 'outra frente', 'utf8');
    fs.writeFileSync(path.join(dir, 'notas.md'), 'outra frente tambem', 'utf8');

    const env = Object.assign({}, process.env, { SWORN_TMP: tmp });
    const abertura = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'abertura.js')], {
      input: JSON.stringify({ session_id: '5besc', cwd: dir, source: 'startup' }),
      encoding: 'utf8', env: env
    });
    assert.strictEqual(abertura.status, 0, 'a abertura tem de rodar');
    const foto = JSON.parse(fs.readFileSync(path.join(tmp, 'sworn', '5besc.json'), 'utf8')).gitAbertura;
    assert.deepStrictEqual(foto.slice().sort(), ['guia.md', 'notas.md'],
      'os DOIS tem de estar na foto, senao o teste nao discrimina: ' + JSON.stringify(foto));

    const escrever = (rel) => spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'portao-escopo.js')], {
      input: JSON.stringify({
        session_id: '5besc', cwd: dir, tool_name: 'Write',
        tool_input: { file_path: path.join(dir, rel), content: 'x' }
      }),
      encoding: 'utf8', env: env
    });

    // PONTA 1 - a rota de escape: na foto, MAS declarado em `## Dentro`.
    // `portao-escopo.js:58` exige as duas condicoes (`deOutraFrente &&
    // !dentro`), e esta e a unica prova de que o `&&` nao e um `||`.
    const liberado = escrever('guia.md');
    assert.strictEqual(liberado.status, 0);
    assert.strictEqual(liberado.stdout, '',
      'sem saida e permitir - a 5b nao pode barrar o que o dono ja autorizou: ' + liberado.stdout);
    // `io.permitir()` e um portao que MORREU tem os dois a mesma cara (exit 0,
    // stdout vazio). O stderr e o que separa os dois - `io.js:56`.
    assert.ok(!/portao falhou/.test(liberado.stderr || ''),
      'tem de permitir por decisao, nao por queda: ' + liberado.stderr);

    // PONTA 2 - sem ela a ponta 1 passaria contra um portao que libera tudo:
    // o outro arquivo da MESMA foto, nao declarado, continua barrado.
    const negado = escrever('notas.md');
    assert.strictEqual(negado.status, 0);
    const decisao = JSON.parse(negado.stdout).hookSpecificOutput;
    assert.strictEqual(decisao.permissionDecision, 'deny',
      'arquivo de outra frente nao declarado continua barrado');
    assert.match(decisao.permissionDecisionReason, /outra frente/i,
      'e tem de ser a 5b negando, nao outra via');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('destrutivo D57: o introdutor do cmd aceita mais de uma barra (gancho Bash)', () => {
  // ACHADO DA RONDA 5 (revisao independente do desenho secao 10), e e REGRESSAO
  // contra o codigo do fix round 4: 8 de 8 comandos que o fix4 barrava passavam.
  //
  // A premissa, medida com `echo` no Git Bash real - nao inferida:
  //   cmd /c echo X    -> cmd.exe cai no PROMPT INTERATIVO, NAO executa
  //   cmd //c echo X   -> imprime X, EXECUTA
  // Causa: a conversao de caminho do MSYS troca um `/c` sozinho por `C:/`, e
  // come UMA barra quando ha duas ou mais. Entao `//c` chega ao cmd.exe como
  // `/c`. A forma que funciona a partir do gancho `Bash` e justamente a que o
  // INTRODUTOR nao casava, porque `\/[ck]` exigia exatamente uma barra.
  //
  // Sem o INTRODUTOR, nada depois dele entra em `posCmd`, e as TRES regras de
  // TOKEN (forma do cmd, apelido do PowerShell, apaga referencia no remoto)
  // param de disparar por completo - as mesmas que o desenho secao 10 declarava
  // "100% fechadas".
  //
  // Medido, uma marca por forma, com `</dev/null` e `timeout`:
  //   //c EXECUTA | //C EXECUTA | //k EXECUTA | //K EXECUTA | cmd.exe //c EXECUTA
  //   ///c NAO executa | ////c EXECUTA | /////c NAO executa
  // A paridade acima e do parser do cmd.exe, nao do MSYS, e depende de versao.
  // Por isso o regex aceita UMA OU MAIS barras em vez de codificar a paridade:
  // barrar `///c`, que nao executa, e sobre-bloqueio inofensivo e erra para o
  // lado seguro - a mesma escolha ja feita na caixa de letra (D45/D49).
  for (const cmd of ['cmd //c del /s /q build', 'cmd //C rd /s /q build',
                     'cmd.exe //c del /s /q build', 'cmd ////c del /s /q build',
                     'cmd //k del /s /q build',
                     'cmd //c rd src -Recurse -Force',
                     'cmd //c del src -Recurse -Force',
                     'cmd //c git push origin --delete main',
                     'cmd //c git push origin :main',
                     'cmd //c git push origin +main']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'a forma de duas barras executa no Git Bash e tem de barrar: ' + cmd);
  }

  // A forma de UMA barra continua barrando - e o vetor do gancho PowerShell,
  // onde nao ha conversao de caminho. Rede contra conserto que troque um pelo
  // outro em vez de cobrir os dois.
  for (const cmd of ['cmd /c del /s /q build', 'cmd /c rd src -Recurse -Force',
                     'cmd /c git push origin --delete main']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'a forma de uma barra e o vetor do PowerShell e nao pode regredir: ' + cmd);
  }

  // TESTEMUNHA SO-DE-TOKEN (fix round 3; mesmo motivo do bloco D73 - ver o
  // comentario em "lock da crase sob wrapper"). As cargas `--delete`/`:main`/
  // `+main` acima DEIXARAM de discriminar este mecanismo quando a D81 repos a
  // regra de TEXTO da regua (destrutivo.js:762-763): regra de texto e regex
  // sobre `seg.texto`, atravessa o introdutor e barra sozinha, entao aquelas
  // assercoes nao podem mais falhar. `-d` nao esta em regra de texto nenhuma
  // (nem no vivo, nem na regua): so `apagaRemoto` (`APAGA_REF`) o pega, e ele
  // exige o git em POSICAO DE COMANDO.
  // MEDIDO: fix4=passa e vivo=BARRA nas seis (mede-candidato-round3.js), e a
  // mutacao M20 (remocao de `apagaRemoto`) mata as seis.
  // NAO MEDIDO: que o introdutor do cmd seja o UNICO caminho ate elas - nenhum
  // mutante da bancada isola esse caminho hoje. Ver o risco registrado no
  // relatorio do fix round 4.
  for (const cmd of ['cmd //c git push origin -d main',
                     'cmd //C git push origin -d main',
                     'cmd.exe //c git push origin -d main',
                     'cmd ////c git push origin -d main',
                     'cmd //k git push origin -d main',
                     'cmd /c git push origin -d main']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'testemunha so-de-token: o introdutor tem de por o git em posicao de comando: ' + cmd);
  }

  // O `^` da D55 continua valendo POR CIMA da barra dupla: as duas correcoes
  // sao ortogonais, e o teste falha se uma desfizer a outra.
  assert.strictEqual(destrutivo.classificar('cmd /^/c del /s /q build').destrutivo, true,
    'o ^ dentro do introdutor de duas barras tambem tem de barrar');

  // CONTROLE NEGATIVO: aceitar mais barras nao pode criar falso positivo. O
  // INTRODUTOR casa o TOKEN INTEIRO (`^...$`), entao uma URL nao o alcanca.
  for (const cmd of ['curl http://c/del', 'echo //c', 'git remote add o //c/repo.git',
                     'Copy-Item //c dst -Recurse']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'nao pode virar falso positivo: ' + cmd);
  }
});

test('destrutivo D58: o introdutor do cmd e uma CLASSE, nao uma grafia', () => {
  // ACHADO DA RONDA 6: a D57 fechou UMA grafia (`//c`) e deixou a FAMILIA. O
  // cmd.exe aceita um aglomerado de chaves antes do terminal, e cada chave pode
  // trazer valor com dois-pontos. Todas as formas abaixo foram medidas com
  // `echo` no Git Bash real, com `</dev/null` e `timeout` - nenhuma inferida:
  //   //c/c  //q/c  /q/c  //v/c  //e:on/c  //e:off/c  //s/c  //a/c  //u/c
  //   //d/c  //x/c  //y/c  //f:on/c  //v:on/c  //t:0a/c  //q/v/c  //a/q/c
  //   //q/e:on/c  //u/k  //u/r  //q/r  //q/k                    -> TODAS EXECUTAM
  //
  // E o terminal NAO e so `c`/`k`. Enumerado a-z, uma marca por letra, duas
  // vezes (a segunda tolerando byte NUL, porque o `/U` manda a saida em UTF-16
  // e o `grep` da primeira passada descartaria a marca): as letras que executam
  // sozinhas sao EXATAMENTE `c`, `k` e `r`. O `/r` e alias de `/c`, e o revisor
  // que levantou o achado nao o viu - o candidato dele terminava em `[ck]` e
  // deixaria 28 dos 168 comandos abertos.
  //
  // Medido contra 203 comandos (29 prefixos CONFIRMADOS executando x 7 payloads,
  // cobrindo as TRES regras de token - 2 da forma do cmd, 2 do apelido do
  // PowerShell, 3 do apaga-referencia-no-remoto; nao e "um por regra", que
  // seria aritmeticamente impossivel), em A/B contra a reconstrucao do fix4:
  //   fix round 4   203/203 barra      <- e por isso e REGRESSAO, nao limite antigo
  //   D57           35/203 barra       -> 168 abertas
  //   D58           203/203 barra      -> 0 abertas
  const AGLOMERADOS = [
    'cmd //c/c del /s /q build',
    'cmd //q/c del /s /q build',
    'cmd /q/c del /s /q build',
    'cmd //v/c rd /s /q build',
    'cmd //e:on/c rd src -Recurse -Force',
    'cmd //e:off/c del src -Recurse -Force',
    'cmd //t:0a/c del /s /q build',
    'cmd //q/v/c del /s /q build',
    'cmd //a/q/c git push origin --delete main',
    'cmd //q/e:on/c git push origin :main',
    'cmd //u/k git push origin +main',
  ];
  for (const cmd of AGLOMERADOS) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'o aglomerado de chaves executa no cmd.exe e tem de barrar: ' + cmd);
  }

  // O TERMINAL `r`, medido executando e ausente do candidato da revisao.
  for (const cmd of ['cmd //r del /s /q build', 'cmd //R rd /s /q build',
                     'cmd //q/r rd src -Recurse -Force',
                     'cmd //u/r git push origin --delete main']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      '`/r` e alias de `/c` no cmd.exe, medido, e tem de barrar: ' + cmd);
  }

  // A CHAVE NAO E UMA LETRA (D61). A primeira forma da D58 supos `[a-z]` sem
  // medir, e isso deixava 91 dos 189 comandos abertos. O `cmd.exe` PULA chave
  // desconhecida em vez de recusar, entao a chave e qualquer corrida sem barra
  // e sem branco. Todas as formas abaixo foram medidas EXECUTANDO com `echo`.
  for (const cmd of ['cmd //1/c del /s /q build', 'cmd //_/c del /s /q build',
                     'cmd //a1/c del /s /q build', 'cmd //c1/c rd /s /q build',
                     'cmd //zz/c rd src -Recurse -Force',
                     'cmd //srv/c del /s /q build',
                     'cmd //SRV/c del src -Recurse -Force',
                     'cmd //dados/c git push origin --delete main',
                     'cmd //x:y:z/c git push origin :main',
                     'cmd //..../c del /s /q build', 'cmd //-/c del /s /q build',
                     'cmd //@/c del /s /q build',
                     'cmd //srv/dados/c del /s /q build',
                     'cmd //1/2/3/c git push origin +main']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'a chave do introdutor e arbitraria e esta forma executa: ' + cmd);
  }

  // O TERMINAL E O ULTIMO CAMPO, e isto e o que o `$` do regex garante. Medido:
  // `cmd //c/q echo X` NAO executa - o `/c` encerra as chaves e `/q` vira o
  // comando, que nao existe. Se o `$` cair, `//c/q` viraria introdutor e o
  // token seguinte entraria em posicao de comando sem que nada execute.
  assert.strictEqual(destrutivo.classificar('ls //c/q').destrutivo, false,
    '`//c/q` nao executa e nao pode ser introdutor');

  // As formas da D57 e do gancho PowerShell nao podem regredir ao alargar.
  for (const cmd of ['cmd //c del /s /q build', 'cmd /c del /s /q build',
                     'cmd ////c del /s /q build']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'a correcao da D57 nao pode ser desfeita pela da D58: ' + cmd);
  }

  // O `^` da D55 continua ortogonal, agora tambem sobre o aglomerado.
  assert.strictEqual(destrutivo.classificar('cmd //q/^c del /s /q build').destrutivo, true,
    'o ^ dentro do aglomerado tambem tem de barrar');

  // CONTROLE NEGATIVO. Alargar o introdutor nao pode transformar caminho de rede
  // nem argumento de ferramenta em posicao de comando. O que segura e o INTRODUTOR
  // casar o TOKEN INTEIRO (`^...$`): `//srv/c/dados` nao casa, pela ancora de fim.
  // ATENCAO: `//srv/c` SOZINHO E introdutor desde a D61 - a chave NAO e uma letra,
  // e o teste da chave arbitraria logo acima afirma exatamente isso. A frase que
  // estava aqui dizia "cada chave e UMA letra, entao `//srv/c` nao alcanca", que e
  // o modelo da D58, revogado pela D61, e contradito 32 linhas acima no mesmo
  // arquivo (corrigida na D65). Nestes casos o que salva e o token SEGUINTE nao
  // ser destrutivo - e por isso este bloco NAO discrimina um introdutor frouxo.
  for (const cmd of ['robocopy //srv/c/dados dst', 'docker run -v //c/dados:/dados img',
                     'ssh user@host //c/tools/run.sh', 'git remote add up //srv/c/repo.git',
                     'echo //q/c', 'ls //c/k', 'ls //c/r', 'rsync -a //srv/q/c/ dst/',
                     'node //c/tools/run.js', 'grep -r //q/r src', 'mount //srv/k /mnt']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'nao pode virar falso positivo: ' + cmd);
  }

  // O falso positivo do terminal `r`, ACEITO e declarado (decisao do dono,
  // 2026-08-08). `/R` e chave de ferramenta do Windows: em `findstr /S /R`,
  // `xcopy /S /R` e `attrib /S /D /R`, o token seguinte entra em posicao de
  // comando e, se for apelido destrutivo, barra. `findstr /S /R del *.bat` e a
  // forma canonica de AUDITAR script destrutivo - o portao barra a auditoria.
  // E falso positivo NOVO (fix4 e D57 passavam), medido 7 de 8, e da mesma
  // familia do falso positivo da D48: erra para o lado seguro, atrapalha em vez
  // de apagar. A saida e `comandosLiberados`. O teste afirma o comportamento de
  // HOJE de proposito - se algum dia deixar de barrar, a decisao mudou e o
  // desenho secao 10 tem de mudar junto.
  for (const cmd of ['findstr /S /R del *.txt', 'xcopy /S /R del dst']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'falso positivo aceito e declarado - se virar false, atualize o §10: ' + cmd);
  }

  // LIMITE DECLARADO, e o teste o afirma de proposito para que ninguem o leia
  // como buraco esquecido: a forma COLADA passa, e ja passava no fix round 4 -
  // e limite pre-existente, nao regressao. Medido: `cmd //cecho MARCA`,
  // `cmd //kecho`, `cmd //recho`, `cmd //q/cecho`, `cmd //c/cecho` EXECUTAM, e
  // `cmd //c echo/s MARCA` imprime `s MARCA`, provando que o cmd.exe parte o
  // nome do comando na barra. Fechar isso exigiria o introdutor deixar de ser
  // token inteiro e virar prefixo partido dentro de `montar()`. Decisao do dono
  // em 2026-08-08: declarar no desenho secao 10, nao fechar na v1.
  for (const cmd of ['cmd //cdel /s /q build', 'cmd /cdel /s /q build',
                     'cmd //c del/s/q build', 'cmd /c del/s/q build']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'limite declarado: a forma colada passa, como no fix4 - se isto virar true, ' +
      'a cobertura melhorou e o desenho secao 10 precisa ser atualizado junto: ' + cmd);
  }
});

test('destrutivo D67: as tres burlas do leitor (P0-1/P0-2/P0-3) fecham sem reabrir a D53', () => {
  // ACHADO DA RONDA 8 (lente de correcao), TRES P0 de codigo, todos no LEITOR da
  // D51 e nenhum no eixo cmd/^ das rondas 5 a 7. Os tres furam EXATAMENTE as tres
  // regras de TOKEN (apelidoPS, formaCmd, apagaRemoto) - as unicas que dependem de
  // posicao de comando - e nenhuma das treze de texto: 3 de 16 motivos do piso,
  // identico nos tres. Medido A/B contra a reconstrucao do fix round 4 (13
  // regressoes) em fix5-bancada/verifica-ronda8-escopo.js e verifica-ronda8-correcao.js.
  //
  // O conserto NAO mexe na segmentacao primaria - foi mexer nela que abriu 15
  // burlas na D53. Em vez disso o portao LE o comando sob as interpretacoes
  // ambiguas de shell e UNE os segmentos (barra se qualquer leitura barrar), o
  // mesmo molde do `nu()` (o `^`) e do `semAspas` (as aspas). As leituras
  // alternativas SO se somam a primaria: nenhum caso que ja barra pode reabrir.

  // P0-1: comando DENTRO de `(...)` e `$(...)`. No leitor primario `(`/`)` separam
  // TOKEN e nao comando (de proposito: senao `Remove-Item (Get-Item src) ...`
  // escaparia); numa leitura ALTERNATIVA eles cortam segmento e o comando de
  // dentro entra em posicao de comando.
  for (const cmd of ['echo (rd src -Recurse -Force)', '$(rd src -Recurse -Force)',
                     'echo (del /s /q build)', '$(git push origin --delete main)',
                     'powershell -Command "echo (rd src -Recurse -Force)"',
                     'Write-Output (Remove-Item src -Recurse -Force)']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'P0-1: comando dentro de (...) tem de barrar: ' + cmd);
  }

  // P0-2: no bash `\`+quebra e continuacao; no PowerShell a barra invertida e
  // literal e a quebra ENCERRA a instrucao. O portao le das duas formas.
  // Gatilho NATURAL: caminho do Windows terminado em barra invertida no fim da linha.
  for (const cmd of ['echo ok\\\nrd src -Recurse -Force',
                     'echo ok\\\ndel /s /q build',
                     'echo ok\\\ngit push origin --delete main',
                     'Set-Location C:\\proj\\\nrd build -Recurse -Force']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'P0-2: no PowerShell a quebra encerra a instrucao e o comando seguinte roda: ' +
      JSON.stringify(cmd));
  }

  // P0-3: no cmd.exe o `#` NAO e comentario. O argumento citado de `cmd /c "..."`
  // e relido tambem com o `#` literal - escopado a `cmd`/`cmd.exe`.
  for (const cmd of ['cmd //c "# & del /s /q build"', 'cmd /c "# & del /s /q build"',
                     'cmd //c "# & rd /s /q build"', 'cmd //c "# & rd src -Recurse -Force"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'P0-3: no cmd.exe o # e literal e o del/rd depois do & roda: ' + cmd);
  }

  // TESTEMUNHA SO-DE-TOKEN das TRES burlas (fix round 3; mesmo motivo do bloco
  // D73). As cargas `--delete` acima deixaram de discriminar: a D81 repos a
  // regra de TEXTO da regua (destrutivo.js:762-763), que e regex sobre
  // `seg.texto` e atravessa parentese, quebra de linha e ramo do `#` - barra
  // sozinha, com o leitor desligado. `-d` so `apagaRemoto` pega, e ele exige o
  // git em POSICAO DE COMANDO.
  // MEDIDO: fix4=passa e vivo=BARRA nas tres (mede-candidato-round3.js), e a
  // mutacao M20 (remocao de `apagaRemoto`) mata as tres.
  // NAO MEDIDO: que cada uma das tres burlas do leitor seja o UNICO caminho ate
  // a sua linha - nenhum mutante da bancada isola esses cortes hoje.
  for (const cmd of ['$(git push origin -d main)',
                     'echo ok\\\ngit push origin -d main',
                     'cmd //c "# & git push origin -d main"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'testemunha so-de-token: a burla do leitor tem de por o git em posicao de comando: ' +
      JSON.stringify(cmd));
  }

  // AMARRA DA D66 (restricao 2), afirmada no MESMO teste que a corrige, porque e
  // a mesma mudanca que poderia quebra-la: `(`/`)` cortando segmento nao pode
  // transformar `-Pattern (del) -Recurse` em falso positivo, e nao pode deixar
  // `Remove-Item (Get-Item src) ...` escapar. O primeiro passa porque o `del`
  // fica SOZINHO no seu segmento (sem a flag); o segundo barra pela leitura
  // primaria (regra de TEXTO sobre o segmento inteiro).
  assert.strictEqual(destrutivo.classificar('Select-String -Path src -Pattern (del) -Recurse').destrutivo,
    false, 'restricao 2: -Pattern (del) -Recurse tem de PASSAR');
  assert.strictEqual(destrutivo.classificar('Remove-Item (Get-Item src) -Recurse -Force').destrutivo,
    true, 'restricao 2: Remove-Item (Get-Item src) -Recurse -Force tem de BARRAR');

  // CONTROLE NEGATIVO 1: a releitura com `#` literal e ESCOPADA a `cmd`. Em
  // `bash -c "... # ..."`, `sh -c` e `powershell -Command "... # ..."` o `#` E
  // comentario, e reler ali com o `#` literal criaria falso positivo. Estes
  // passam - a menos que CITEM um destrutivo, que ai e limite pre-existente da
  // D48 (e por isso `rm -rf`/`Remove-Item` nao entram nesta lista).
  // D81: a carga do git virou `-d`. O `--delete` deixou de servir de sonda aqui
  // porque a D81 repos a regra de TEXTO do fix round 4 para ele - e, como o
  // proprio comentario acima ja dizia de `rm -rf`/`Remove-Item`, destrutivo
  // CITADO que uma regra de TEXTO pega e limite pre-existente da D48, nao falso
  // positivo deste mecanismo. `-d` continua so de token.
  for (const cmd of ['bash -c "ls # limpar depois: rd /s /q build"',
                     'sh -c "echo ok # del /s /q build"',
                     'bash -c "echo done # git push origin -d main"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'controle: fora do cmd o # e comentario e nao pode virar falso positivo: ' + cmd);
  }

  // CONTROLE NEGATIVO 2: parenteses e continuacao INOCENTES nao viram burla nem
  // falso positivo. Parentese dentro de aspas continua literal (a leitura da aspa
  // vem antes da do parentese), e uma subexpressao sem comando destrutivo passa.
  for (const cmd of ['git commit -m "removi a pasta (rd) do build"',
                     'Write-Host (Get-Date) -ForegroundColor Red',
                     'echo (Get-Date)', 'Measure-Command { (Get-ChildItem).Count }',
                     'Write-Host foo `\n  -NoNewline', 'echo primeira \\\nsegunda linha',
                     'grep -n "(del)" arquivo.txt']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'controle: parentese/continuacao inocente nao pode virar falso positivo: ' +
      JSON.stringify(cmd));
  }

  // CONTROLE NEGATIVO 3: a quebra de linha SEM a barra invertida (dois comandos
  // de verdade) ja barra pela leitura primaria - o conserto do P0-2 nao pode ser
  // o unico caminho, senao ele nao estaria provando nada de novo.
  assert.strictEqual(destrutivo.classificar('echo ok\nrd src -Recurse -Force').destrutivo, true,
    'controle: quebra sem barra sao dois comandos e o segundo barra');

  // O custo NAO pode virar quadratico ao multiplicar leituras. As leituras
  // alternativas so sao montadas quando o gatilho (`(`, continuacao, `#` em cmd)
  // esta presente; um comando de 60 mil chars sem gatilho paga UMA leitura so.
  // R-T12-04 / D119: catraca de ORDEM DE GRANDEZA, nao de relogio. Ver o
  // comentario de `razaoDeCusto` no topo do arquivo.
  const semGatilhoBase = 'rm a '.repeat(3000);
  const semGatilho = 'rm a '.repeat(12000);
  assert.strictEqual(semGatilhoBase.length, 15000);
  assert.strictEqual(semGatilho.length, 60000);
  const mSem = razaoConfirmada(() => destrutivo.classificar(semGatilhoBase),
                               () => destrutivo.classificar(semGatilho));
  assert.ok(mSem.razao < TETO_RAZAO,
    'sem gatilho, quadruplicar a entrada custou ' + mSem.razoes + ' (teto ' +
    TETO_RAZAO + '; linear ~4, quadratico ~16): ' + mSem.pequeno.toFixed(2) + ' ms para 15k e ' +
    mSem.grande.toFixed(2) + ' ms para 60k');
  // E COM gatilho (parenteses) o custo sobe - tres leituras - mas continua linear:
  // a razao entre os dois tamanhos tem de ficar no mesmo patamar da de cima. Se
  // multiplicar leituras tivesse trazido o custo quadratico de volta, e aqui que
  // apareceria, porque e aqui que as leituras alternativas sao montadas.
  const comGatilhoBase = '(a) '.repeat(3750);
  const comGatilho = '(a) '.repeat(15000);
  assert.strictEqual(comGatilhoBase.length, 15000);
  assert.strictEqual(comGatilho.length, 60000);
  const mCom = razaoConfirmada(() => destrutivo.classificar(comGatilhoBase),
                               () => destrutivo.classificar(comGatilho));
  assert.ok(mCom.razao < TETO_RAZAO,
    'COM gatilho, quadruplicar a entrada custou ' + mCom.razoes + ' (teto ' +
    TETO_RAZAO + '; linear ~4, quadratico ~16): ' + mCom.pequeno.toFixed(2) + ' ms para 15k e ' +
    mCom.grande.toFixed(2) + ' ms para 60k');
});

test('destrutivo D68: parentese/crase em ARGUMENTO nao-comando nao vira falso positivo (o D67 abriu)', () => {
  // ACHADO DA RONDA 9 (lente de FP). O D67 le o comando sob a interpretacao de
  // parenteses e PROPAGAVA essa leitura para dentro da RELEITURA do argumento
  // citado - inclusive de argumentos que NAO sao comando. Resultado: prosa que
  // apenas MENCIONA `(rd /s /q build)` entre aspas passou a barrar. Medido:
  // 5 falsos positivos novos, alcance 3 de 16 (as mesmas tres regras de token),
  // A/B em fix5-bancada/verifica-ronda9.js.
  //
  // CONSERTO: a leitura ALTERNATIVA so e propagada para o argumento citado quando
  // ELE esta em POSICAO DE COMANDO - depois de um introdutor (`-c`, `-Command`,
  // `/c` e a classe do cmd ja enumerada em D57/D58/D61). So ai o argumento e um
  // comando de outro shell. A releitura PRIMARIA (texto, D48) continua valendo
  // para todo argumento citado; muda so a leitura alternativa.
  //
  // O TESTE EXERCITA O MECANISMO, nao o exemplo: a flag entra DENTRO do parentese
  // (`(rd /s /q build)`), que e onde o exemplo do proprio D67
  // (`git commit -m "removi a pasta (rd) do build"`, com o `rd` sozinho) passava
  // por acidente. Frase falsa em portao de seguranca e divida ativa (D55): o
  // comentario do codigo tambem foi corrigido.
  for (const cmd of ['git commit -m "doc: explica (rd /s /q build)"',
                     'git commit -m "removi a pasta (rd -Recurse) do build"',
                     'git log --grep="(rd /s)"',
                     'echo "ver o (del /s /q build) do bat"',
                     'echo "nao rodar (rd src -Recurse -Force) aqui"',
                     // D81: `-d` no lugar de `--delete`. Ver a nota da D81 no
                     // controle negativo 1 - o `--delete` passou a ser pego pela
                     // regra de TEXTO reposta, como `rm -rf` sempre foi.
                     'git commit -m "fecha (git push origin -d main) manual"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'prosa citada com parentese nao e comando e nao pode barrar: ' + cmd);
  }
  // D74/P1 (fix19): a CRASE SAIU da lista acima. O gate do posCmd vale para o
  // PARENTESE, que nao executa em prosa - mas a crase EXECUTA em prosa: dentro
  // de aspas duplas ela e expandida pelo shell DE FORA antes de qualquer coisa
  // rodar (invariante provada em shell real na D73, discriminador `uname -s`).
  // O `passa` que esta linha travava nasceu como REGRESSAO da era D68, nao como
  // reducao de FP: fix4 ja barrava (classe [H2] da D74; medido em
  // fix5-bancada/sonda-fix19-d68crase.js, fix4=BARRA). Sobre-bloqueio da
  // familia D48/D63, aceito por decisao registrada.
  const BT = String.fromCharCode(96);
  assert.strictEqual(destrutivo.classificar('echo "o ' + BT + 'rd -Recurse' + BT + ' e so um exemplo no doc"').destrutivo, true,
    'D74/P1: crase em prosa executa no shell de fora e volta a barrar (fix4 barrava)');
  // CONTROLE: o argumento que E comando (depois de introdutor) CONTINUA barrando -
  // fechar o FP nao pode reabrir a burla nested do D66. Se algum destes virar
  // `passa`, o gate ficou apertado demais e a cobertura caiu.
  for (const cmd of ['powershell -Command "echo (rd src -Recurse -Force)"',
                     'bash -c "echo (del /s /q build)"',
                     'sh -c "$(git push origin --delete main)"',
                     'cmd //c "# & del /s /q build"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'argumento em posicao de comando (depois de introdutor) continua barrando: ' + cmd);
  }

  // TESTEMUNHA SO-DE-TOKEN do controle acima (fix round 3; mesmo motivo do
  // bloco D73). O `sh -c "$(git push origin --delete main)"` da lista anterior
  // deixou de discriminar: com a regra de TEXTO da D81 (destrutivo.js:762-763)
  // aquela linha barra mesmo que a releitura do argumento citado seja desligada.
  // `-d` so `apagaRemoto` pega, e ele exige o git em POSICAO DE COMANDO.
  // MEDIDO: fix4=passa e vivo=BARRA (mede-candidato-round3.js), e a mutacao M20
  // (remocao de `apagaRemoto`) mata esta linha.
  // NAO MEDIDO: que a releitura do argumento do introdutor seja o UNICO caminho
  // ate ela - nenhum mutante da bancada isola esse caminho hoje.
  assert.strictEqual(destrutivo.classificar('sh -c "$(git push origin -d main)"').destrutivo, true,
    'testemunha so-de-token: o argumento do introdutor e relido em posicao de comando');
});

test('destrutivo D69: substituicao de comando por CRASE fecha - a quarta via da mesma classe', () => {
  // ACHADO DA RONDA 9 (lente de correcao). A classe "comando escondido em
  // expressao" ja tinha `$()` e `()` (D67); faltava a CRASE: `echo `rd -Recurse``
  // roda `rd`. Medido A/B: 9 regressoes vs fix4, 0 causadas pelo D67 (buraco
  // antigo). A CLASSE FOI ENUMERADA INTEIRA antes de escrever (relatorio fix17):
  //   - `$()`, `()`, `<()`, `>()` ja barram (o `(` corta segmento - D67);
  //   - a CRASE e a via que faltava, fechada aqui;
  //   - `${ ;}` (funsub) da "bad substitution" no Git Bash e `$(())` e aritmetica:
  //     NAO executam no gancho - declarados, nao fechados;
  //   - `env`/`nohup`/`time`/`command`/`xargs`/`find -exec` sao PREFIXO-wrapper,
  //     outra familia (P1, fora de escopo por fix16 §8).
  // No cmd.exe/PowerShell a crase NAO e substituicao de comando; e ambiguo, entao
  // le-se das DUAS formas e barra se qualquer uma barrar (o molde do `^` e das aspas).
  const BT = String.fromCharCode(96);
  for (const cmd of ['echo ' + BT + 'rd src -Recurse -Force' + BT,
                     'echo ' + BT + 'del /s /q build' + BT,
                     'echo ' + BT + 'git push origin --delete main' + BT,
                     'echo ' + BT + 'git push origin :main' + BT,
                     BT + 'git push origin --delete main' + BT,
                     'echo (' + BT + 'rd src -Recurse -Force' + BT + ')',
                     // crase DENTRO das aspas duplas de um shell: no bash e subst de
                     // comando (medido com echo: imprime a marca), no PowerShell e
                     // escape. Ambiguo -> barra pelo lado do bash.
                     'bash -c "echo ' + BT + 'rd src -Recurse -Force' + BT + '"',
                     'sh -c "echo ' + BT + 'del /s /q build' + BT + '"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'a crase executa o comando de dentro e tem de barrar: ' + JSON.stringify(cmd));
  }
  // CONTROLE POSITIVO: a continuacao de linha POR CRASE (crase colada na quebra)
  // continua sendo continuacao - a crase-separador nao pode desfaze-la. Aqui o
  // Remove-Item junta com o -Recurse e barra pelo texto, como na D51.
  assert.strictEqual(destrutivo.classificar('Remove-Item src ' + BT + '\n  -Recurse ' + BT + '\n  -Force').destrutivo,
    true, 'a crase de continuacao de linha nao pode ser quebrada pela crase-separador');
  // CONTROLE NEGATIVO: crase que NAO e substituicao de comando destrutivo nao pode
  // virar falso positivo - escape do PowerShell (`n `t `$), substituicao de comando
  // INOCENTE (node -v, date), e prosa citando um apelido nu (`rd` sozinho, sem flag).
  for (const cmd of ['Write-Host "linha1' + BT + 'nlinha2"',
                     'Write-Host "col1' + BT + 'tcol2"',
                     'echo "custo: ' + BT + '$5 por item"',
                     'VER=' + BT + 'node -v' + BT,
                     'HASH=' + BT + 'git rev-parse HEAD' + BT,
                     'echo ' + BT + 'date' + BT,
                     'echo "o ' + BT + 'rd' + BT + ' e um comando"',
                     'grep -n ' + BT + 'rd' + BT + ' f.txt']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'crase inocente (escape PS, subst nao destrutiva, prosa) tem de passar: ' + JSON.stringify(cmd));
  }
});

test('destrutivo D70/achado 1: ramo do # herda opFilho e nao contorna o gate da D68', () => {
  // ACHADO DA RONDA 10. O ramo do `#` (releitura com `#` literal, escopada a cmd)
  // montava `semCom` a partir de `op` (o do PAI), nao de `opFilho` (o do gate da
  // D68). Resultado: um argumento CITADO fora de posicao de comando, com `#`,
  // recebia a leitura ALTERNATIVA (parenteses) por baixo do gate, e prosa citada
  // virava falso positivo. O conserto e uma palavra: `op` -> `opFilho`.
  //
  // O TESTE exige a combinacao que NENHUM teste exercitava: `cmd` com o argumento
  // FORA de `posCmd` (depois de `echo`, nao logo depois de `/c`) E com `#`.
  // D81: `-d` no lugar de `--delete`, pelo mesmo motivo do controle negativo 1
  // da D67 - a carga tem de continuar sendo pega SO por regra de token.
  for (const cmd of ['cmd /c echo "# doc (rd /s /q build)"',
                     'cmd.exe /c type f.txt "nota # sobre (rd src -Recurse -Force)"',
                     'cmd //c echo "# ver (git push origin -d main)"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'achado 1: argumento citado FORA de posicao de comando, com #, e prosa e nao pode barrar: ' + cmd);
  }
  // CONTROLE 1: o mesmo argumento SEM o `#` ja passava antes - a correcao nao muda.
  assert.strictEqual(destrutivo.classificar('cmd /c echo "doc (rd /s /q build)"').destrutivo, false,
    'controle: cmd sem # em prosa ja passava');
  // CONTROLE 2: os casos da D67 (o `#` EM posicao de comando, depois de `//c`)
  // continuam barrando - o argumento ESTA em posicao de comando, opFilho === op.
  for (const cmd of ['cmd //c "# & del /s /q build"', 'cmd /c "# & del /s /q build"',
                     'cmd //c "# & rd /s /q build"', 'cmd //c "# & rd src -Recurse -Force"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'controle: o # em posicao de comando (D67) continua barrando: ' + cmd);
  }
  // CONTROLE 3 (D74/P1 - regressao do fix18): a MESMA linha que monta o opFilho
  // tem de propagar a CRASE para o argumento citado FORA de posicao de comando.
  // A crase dentro de aspas duplas e expandida pelo shell DE FORA (invariante
  // provada em shell real na D73 com `uname -s`), entao ela EXECUTA mesmo em
  // argumento de prosa - o conserto do parentese (achado 1) NAO pode levar a
  // crase junto. Se um round futuro tirar craseSepara do opFilho, ESTAS
  // assercoes quebram (nao-vacuidade provada por mutacao no fix19).
  const BT = String.fromCharCode(96);
  for (const cmd of ['cmd /c echo "# ' + BT + 'git push origin --delete main' + BT + '"',
                     'cmd //c echo "# ' + BT + 'git push origin --delete main' + BT + '"',
                     'cmd.exe /c type f.txt "nota # ' + BT + 'git push origin --delete main' + BT + '"',
                     'cmd /c echo "# ' + BT + 'rd src -Recurse -Force' + BT + '"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'P1: crase em argumento citado fora de posCmd executa no shell de fora e barra: ' + JSON.stringify(cmd));
  }
  // O MESMO caminho sem o ramo do # (o opFilho direto): a crase fora de posicao
  // de comando, sem #, tambem executa no shell de fora.
  for (const cmd of ['cmd.exe /c type f.txt "nota ' + BT + 'git push origin --delete main' + BT + '"',
                     'echo "nota ' + BT + 'git push origin --delete main' + BT + '"',
                     'git commit -m "versao ' + BT + 'git push origin --delete main' + BT + '"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'P1: crase fora de posCmd sem # tambem executa e barra: ' + JSON.stringify(cmd));
  }

  // TESTEMUNHA SO-DE-TOKEN das duas listas acima (fix round 3; mesmo motivo do
  // bloco D73). Com `--delete` aquelas linhas pararam de discriminar: a regra de
  // TEXTO da D81 (destrutivo.js:762-763) atravessa a crase e o ramo do `#` e
  // barra sozinha, com `craseSepara` e o `opFilho` desligados. `-d` so
  // `apagaRemoto` pega, e ele exige o git em POSICAO DE COMANDO.
  // MEDIDO: fix4=passa e vivo=BARRA nas seis (mede-candidato-round3.js), e a
  // mutacao M20 (remocao de `apagaRemoto`) mata as seis.
  // NAO MEDIDO: que a propagacao da crase para o argumento citado seja o UNICO
  // caminho ate elas - nenhum mutante da bancada isola esse caminho hoje.
  for (const cmd of ['cmd /c echo "# ' + BT + 'git push origin -d main' + BT + '"',
                     'cmd //c echo "# ' + BT + 'git push origin -d main' + BT + '"',
                     'cmd.exe /c type f.txt "nota # ' + BT + 'git push origin -d main' + BT + '"',
                     'cmd.exe /c type f.txt "nota ' + BT + 'git push origin -d main' + BT + '"',
                     'echo "nota ' + BT + 'git push origin -d main' + BT + '"',
                     'git commit -m "versao ' + BT + 'git push origin -d main' + BT + '"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'testemunha so-de-token: a crase propagada tem de por o git em posicao de comando: ' +
      JSON.stringify(cmd));
  }
  // CONTROLE 4: crase INOCENTE no mesmo lugar nao vira falso positivo.
  for (const cmd of ['cmd /c echo "# ' + BT + 'git rev-parse HEAD' + BT + '"',
                     'cmd /c echo "nota ' + BT + 'date' + BT + '"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'controle: crase inocente fora de posCmd continua passando: ' + JSON.stringify(cmd));
  }
});

test('destrutivo D70/achado 3: a QUINTA via - $(...) em aspas duplas de nao-introdutor', () => {
  // ACHADO DA RONDA 10 (lente de correcao). A classe "comando escondido em
  // expressao" tinha `()`/`$()` fora de aspas (D67) e a CRASE (D69); faltava
  // `$(...)` DENTRO de aspas duplas de argumento que NAO e introdutor:
  // `echo "$(git push origin --delete main)"` executa no bash. Medido: 7 casos
  // que ja passavam ANTES da D67 (limite que a D67 nunca fechou, nao regressao do
  // gate da D68). So as TRES regras de TOKEN vazam (o `(` separa TOKEN, entao o
  // `$` fica sozinho no token 0); as de texto ja pegavam (`echo "$(rm -rf src)"`
  // barra). Conserto: leitura alternativa `dolarSepara`, em que `$(` corta
  // SEGMENTO e e propagada para dentro do argumento citado MESMO fora de posicao
  // de comando - `$(...)` executa ate em argumento de prosa.
  const G = 'git push origin --delete main';
  for (const cmd of ['echo "$(' + G + ')"',
                     'printf "$(' + G + ')"',
                     'git commit -m "$(' + G + ')"',
                     'true "$(' + G + ')"',
                     'bash -lc "echo $(' + G + ')"',
                     'sh -ec "echo $(' + G + ')"',
                     'ssh host "echo $(' + G + ')"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'achado 3: $(...) em aspas executa e tem de barrar: ' + cmd);
  }
  // TESTEMUNHA SO-DE-TOKEN das MESMAS sete formas (fix round 3; mesmo motivo do
  // bloco D73). As sete de cima, com `--delete`, deixaram de discriminar
  // `dolarSepara`: a D81 repos a regra de TEXTO da regua (destrutivo.js:762-763)
  // e ela e regex sobre `seg.texto` - casa a carga citada mesmo com `dolarSepara`
  // DESLIGADO, entao aquelas sete assercoes nao podem mais falhar (medido:
  // fix5-bancada/confere-testemunha-d70.js, 7/7 vacuas). `-d` nao esta em regra
  // de texto nenhuma: so `apagaRemoto` o pega, e ele exige o git em POSICAO DE
  // COMANDO.
  //
  // QUANTAS DESTAS SETE DISCRIMINAM `dolarSepara`: TRES - as formas 5, 6 e 7
  // (`bash -lc`, `sh -ec`, `ssh host`). Nas formas 1-4 (`echo`, `printf`,
  // `git commit -m`, `true`) quem poe o git em posicao de comando NAO e
  // `dolarSepara` e sim a RELEITURA DO ARGUMENTO CITADO, que ja as cobria antes
  // do fix round 2 - vacuidade ANTERIOR, registrada e nao consertada. Tres e
  // exatamente o nivel que o bloco tinha em r1, e e o que este conserto devolve.
  // Medido a cada run por fix5-bancada/confere-testemunha-d70.js, bloco
  // "CARGA NOVA" (coluna SEM: vivo), e fix4=passa em todas as sete.
  //
  // A redacao anterior desta linha dizia "se ele for desligado, ESTAS sete
  // passam". Era falsa para quatro delas - corrigida no fix round 4, e pelo
  // mesmo motivo que a D55/Achado 2 existe: frase categorica em portao de
  // seguranca que a medicao nao sustenta.
  const GT = 'git push origin -d main';
  for (const cmd of ['echo "$(' + GT + ')"',
                     'printf "$(' + GT + ')"',
                     'git commit -m "$(' + GT + ')"',
                     'true "$(' + GT + ')"',
                     'bash -lc "echo $(' + GT + ')"',
                     'sh -ec "echo $(' + GT + ')"',
                     'ssh host "echo $(' + GT + ')"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'testemunha so-de-token: dolarSepara tem de por o git em posicao de comando: ' + cmd);
  }
  // CONTROLE POSITIVO: o que ja barrava continua barrando.
  for (const cmd of ['echo $(' + G + ')', 'echo "$(rm -rf src)"', '$(' + G + ')']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'controle: $(...) que ja barrava continua barrando: ' + cmd);
  }
  // CONTROLE - so o `$(` corta, o `(` sozinho NAO: prosa com parentese que a D68
  // fechou nao pode reabrir (`git commit -m "doc: explica (rd /s /q build)"`).
  for (const cmd of ['git commit -m "doc: explica (rd /s /q build)"',
                     'git log --grep="(rd /s)"',
                     'echo "ver o (del /s /q build) do bat"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'controle: prosa com ( (sem $) nao pode reabrir o FP da D68: ' + cmd);
  }
  // CONTROLE NEGATIVO: `$(...)` INOCENTE e `$` que nao e substituicao de comando
  // destrutivo nao viram falso positivo.
  for (const cmd of ['git commit -m "build de $(date)"',
                     'echo "sha: $(git rev-parse HEAD)"',
                     'PATH="$(npm bin):$PATH" npm test',
                     'echo "$HOME/projeto"',
                     'echo "custa $5 por mes"',
                     'make "TARGET=$(uname -s)"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'controle: $(...) inocente tem de passar: ' + cmd);
  }
});

test('destrutivo D74/P0: sob dolarSepara o ) fecha o segmento e a cauda nao e do comando substituido', () => {
  // DEFEITO DO FIX18 (ronda 11, D74). O `$(` abria segmento na leitura
  // `dolarSepara` mas o `)` so fechava TOKEN, entao o segmento do comando
  // substituido ENGOLIA a cauda depois do `)` e as tres regras de token liam
  // argumento alheio como se fosse do comando substituido. Seis inocentes
  // cotidianos barravam (fix4=passa, vivo=BARRA: falso positivo NOVO do fix18).
  for (const cmd of ['echo "a $(git rev-parse HEAD) b push --prune c"',
                     'VERSION=$(git describe --tags) npm run push -- -d',
                     'echo "rev $(git rev-parse HEAD) pronto para push --prune"',
                     'git commit -m "deploy $(git rev-parse --short HEAD) - push feito, tag +1"',
                     'gh release create v1 --notes "$(git log --oneline -5) - push --prune pendente"',
                     'echo "$(git describe --tags) push -> registro :5000"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'P0: a cauda depois de $(...) nao e do comando substituido e nao pode barrar: ' + cmd);
  }
  // Dentro de aspas de argumento de prosa a cauda NUNCA executa - e pedaco de
  // string. Nem quando ela COMECA com um nome de comando destrutivo (a cauda nao
  // recebe posicao de comando; fecha-la em segmento com posCmd seria criar outro
  // falso positivo da mesma classe - medido: fix4=passa).
  for (const cmd of ['echo "deploy $(date) git push --prune scheduled"',
                     'echo "rev $(date) rd src -Recurse -Force notas"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'P0: cauda de prosa citada nao esta em posicao de comando: ' + cmd);
  }
  // CONTROLE POSITIVO 1: o payload DENTRO do $(...) continua barrando - o
  // conserto corta a cauda fora, nunca o miolo.
  for (const cmd of ['echo "$(git push origin --delete main) ok"',
                     'echo "a $(rd src -Recurse -Force) b"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'controle: o payload dentro de $(...) continua barrando: ' + cmd);
  }
  // CONTROLE POSITIVO 2: fora de aspas o canal real continua coberto - em
  // `$(x) git push --delete main` o git EXECUTA quando a substituicao expande
  // vazio, e quem barra e a leitura parenSepara (o `(` e o `)` cortam la e o git
  // cai em posicao de comando). O conserto da cauda nao pode vazar para la.
  assert.strictEqual(destrutivo.classificar('$(true) git push --delete main').destrutivo, true,
    'controle: $(vazio) seguido de comando destrutivo fora de aspas continua barrando');

  // TESTEMUNHA SO-DE-TOKEN dos DOIS controles positivos acima (fix round 3;
  // mesmo motivo do bloco D73). Com `--delete` eles deixaram de discriminar: a
  // regra de TEXTO da D81 (destrutivo.js:762-763) casa a carga com `dolarSepara`
  // e `parenSepara` desligados, entao o corte da cauda podia comer o miolo sem
  // que assercao nenhuma caisse. `-d` so `apagaRemoto` pega, e ele exige o git em
  // POSICAO DE COMANDO.
  // MEDIDO: fix4=passa e vivo=BARRA nas duas (mede-candidato-round3.js), e a
  // mutacao M20 (remocao de `apagaRemoto`) mata as duas.
  // NAO MEDIDO: que o corte do `)` seja o UNICO caminho ate elas - nenhum
  // mutante da bancada isola esse caminho hoje.
  assert.strictEqual(destrutivo.classificar('echo "$(git push origin -d main) ok"').destrutivo, true,
    'testemunha so-de-token: o miolo do $(...) continua em posicao de comando');
  assert.strictEqual(destrutivo.classificar('$(true) git push -d main').destrutivo, true,
    'testemunha so-de-token: $(vazio) seguido de comando mantem a posicao de comando');
});

test('destrutivo D73: lock da crase sob wrapper - o NOME do wrapper nao muda a decisao', () => {
  // INVARIANTE PROVADA EM SHELL REAL (D73; fix5-bancada/confere-recusa-fix18-v2.sh,
  // discriminador `uname -s`, que nao existe no cmd.exe; controle negativo com
  // aspas simples): a crase dentro de aspas DUPLAS e expandida pelo shell DE FORA
  // (o parent bash do gancho Bash) ANTES de o wrapper sequer ser invocado. Quem
  // decide e QUEM EXECUTA, nunca o nome do wrapper no texto do comando. Este lock
  // trava o MECANISMO contra a "correcao" por exclusao de nome (a familia B1/C
  // que a D73 derrubou): o mesmo payload, sob QUALQUER grafia de wrapper, barra.
  //
  // PAYLOADS: apenas os que SO as regras de TOKEN pegam (apagaRemoto, apelidoPS).
  // `rm -rf` NAO serve: a regra de TEXTO pega sozinha, com a leitura da crase
  // inteira desligada, e a linha vira lock vacuo - o defeito que o fix19 tirou
  // daqui. Nao-vacuidade provada por MUTACAO (fix5-bancada, craseSepara
  // desligada: TODAS as linhas abaixo viram passa).
  const BT = String.fromCharCode(96);
  // D81: a carga tem de ser SO DE TOKEN, e `--delete` deixou de ser. A D81
  // repos a regra de TEXTO do fix round 4 para `apaga referencia no remoto`
  // (`:letra`, `--delete`, `--mirror`, `+ref`), entao `git push origin --delete
  // main` passou a ser pego pelo texto sozinho - exatamente o defeito que o
  // comentario acima descreve para o `rm -rf`, e a TESTEMUNHA 2 abaixo acusou.
  // `-d` continua sendo SO de token: a regua nao tem `-d`, logo a regra de
  // texto da D81 tampouco - so `apagaRemoto` (`APAGA_REF`) o pega.
  const G = 'git push origin -d main';         // so apagaRemoto pega (regra de token)
  const R = 'rd src -Recurse -Force';          // so apelidoPS pega (regra de token)
  for (const cmd of ['cmd /c "echo ' + BT + G + BT + '"',
                     'cmd //c "echo ' + BT + G + BT + '"',
                     'cmd.exe /c "echo ' + BT + G + BT + '"',
                     'cmd /r "echo ' + BT + G + BT + '"',
                     'cmd //k "echo ' + BT + G + BT + '"',
                     'powershell -Command "Write-Host ' + BT + G + BT + '"',
                     'powershell.exe -Command "Write-Host ' + BT + G + BT + '"',
                     'pwsh -Command "Write-Host ' + BT + G + BT + '"',
                     'pwsh.exe -Command "Write-Host ' + BT + R + BT + '"',
                     'cmd /c "echo ' + BT + R + BT + '"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'lock D73: a crase executa no shell de fora sob qualquer wrapper: ' + JSON.stringify(cmd));
  }
  // TESTEMUNHA 1 - a assercao acima PODE falhar: mesmo wrapper, mesma crase,
  // payload inocente PASSA. O que barra e o payload, nao a forma.
  for (const cmd of ['cmd /c "echo ' + BT + 'git rev-parse HEAD' + BT + '"',
                     'powershell -Command "Write-Host ' + BT + 'date' + BT + '"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'testemunha 1: payload inocente na mesma forma tem de passar: ' + JSON.stringify(cmd));
  }
  // TESTEMUNHA 2 - o payload e mesmo de TOKEN: sem a crase, o MESMO texto no
  // MESMO lugar PASSA, porque nenhuma regra de texto o pega; e a leitura da
  // crase que poe o payload em posicao de comando.
  for (const cmd of ['cmd /c "echo ' + G + '"',
                     'pwsh.exe -Command "Write-Host ' + R + '"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'testemunha 2: sem a crase o payload de token nao barra: ' + JSON.stringify(cmd));
  }
});

test('destrutivo D80/F1: wrapper de processo abre o resto do segmento para posicao de comando', () => {
  // A D50/D51 trocou tres regras de TEXTO por regras de TOKEN (`apelidoPS`,
  // `formaCmd`, `apagaRemoto`) e a troca nunca foi medida contra o fix round 4.
  // `posCmd` so conhecia o indice 0 e o token depois de um INTRODUTOR, entao
  // QUALQUER palavra antes do comando desligava as tres de uma vez. A varredura
  // adversarial da D72 mediu 111 regressoes; 80 caiam so por isto.
  //
  // O portao chegou a ENSINAR a burla, e este par e a prova:
  //   ssh host "git push origin --delete main"       barrava
  //   ssh deploy@host git push origin --delete main  passava
  // As duas fazem a mesma coisa no host remoto - a diferenca era so a aspa.
  for (const cmd of ['env rd /s /q build',
                     'command git push origin --delete main',
                     'nohup git push origin --delete main',
                     'sudo -u deploy git push origin --delete main',
                     'nice -n 10 rd /s /q build',
                     'timeout 5 git push origin --delete main',
                     'runuser -u deploy -- git push origin --delete main',
                     'ssh deploy@host git push origin --delete main',
                     'ssh -t host rd /s /q build',
                     'docker run --rm alpine git push origin --delete main',
                     'kubectl exec pod-1 -- git push origin --delete main',
                     'npm exec -- git push origin --delete main',
                     'xargs -a ramos.txt -n1 git push origin --delete',
                     'find . -type d -exec git push origin --delete main {} ;',
                     'bash -lc git push origin --delete main',
                     'start rd /s /q build',
                     'runas /user:admin rd /s /q build',
                     'for /f %i in (lista.txt) do rd /s /q %i',
                     'cmd //c call rd /s /q build',
                     'expect -c "spawn rd /s /q build"',
                     'rundll32 shell32.dll,ShellExec_RunDLL rd /s /q build',
                     'Start-Process rd -ArgumentList /s,/q,build',
                     'Register-ScheduledTask -Action (New-ScheduledTaskAction -Execute rd -Argument "/s /q build")',
                     // o git multiplexa subcomando que executa comando alheio
                     'git submodule foreach rd /s /q build',
                     'git bisect run rd /s /q build']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'D80/F1: o wrapper nao pode desligar a posicao de comando: ' + JSON.stringify(cmd));
  }

  // ARIDADE: a abertura vale para o RESTO do segmento, nao para o proximo token.
  // Saber quantos argumentos cada wrapper consome antes do comando e
  // por-programa (`ssh` ~30 flags, `docker run` >100, `timeout -k VALOR`), e um
  // modelo de aridade erra para o lado do falso positivo. Medido no mesmo
  // instrumento: abrir so o proximo token deixa 72 das 111 regressoes de pe;
  // abrir o resto deixa 23.
  for (const cmd of ['env nohup timeout 5 rd /s /q build',
                     'sudo -u deploy env GIT_DIR=/srv/app/.git git push origin --delete main',
                     'ssh host env git push origin --delete main']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'D80/F1: wrapper encadeado tem de continuar barrando: ' + JSON.stringify(cmd));
  }

  // TESTEMUNHA SO-DE-TOKEN da abertura por wrapper (fix round 3; mesmo motivo do
  // bloco D73). NENHUMA das cargas das duas listas acima discriminava mais este
  // mecanismo: `--delete` caiu na regra de TEXTO que a D81 repos
  // (destrutivo.js:762-763) e `rd /s /q`/`rd -Recurse` a regua ja pega por texto
  // tambem - medido, o fix round 4 barra as 29 assercoes positivas deste bloco
  // (fix5-bancada/varre-vacuidade-round3.js). Tirar o wrapper nao serve de prova
  // aqui, porque o que sobra continua sendo destrutivo de verdade; so a carga
  // SO-DE-TOKEN serve. `-d` so `apagaRemoto` pega, e ele exige o git em POSICAO
  // DE COMANDO - que e exatamente o que `posAmpla` concede. Se a abertura por
  // wrapper quebrar, ESTAS catorze linhas passam.
  // Medido: fix4=passa, vivo=BARRA (fix5-bancada/mede-candidato-round3.js) E,
  // por mutacao, as 14 morrem sob M1 (lista de wrappers vazia) e sob M11; 12
  // morrem tambem sob M2 (fix5-bancada/mede-mutacao-testemunhas-round4.js).
  for (const cmd of ['command git push origin -d main',
                     'nohup git push origin -d main',
                     'sudo -u deploy git push origin -d main',
                     'timeout 5 git push origin -d main',
                     'runuser -u deploy -- git push origin -d main',
                     'ssh deploy@host git push origin -d main',
                     'docker run --rm alpine git push origin -d main',
                     'kubectl exec pod-1 -- git push origin -d main',
                     'npm exec -- git push origin -d main',
                     'xargs -a ramos.txt -n1 git push origin -d',
                     'find . -type d -exec git push origin -d main {} ;',
                     'bash -lc git push origin -d main',
                     'sudo -u deploy env GIT_DIR=/srv/app/.git git push origin -d main',
                     'ssh host env git push origin -d main']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'testemunha so-de-token: o wrapper tem de abrir posicao de comando: ' + JSON.stringify(cmd));
  }

  // RECURSAO, e ela nao e nova: a releitura do argumento citado (bloco FUNDO)
  // ja desce ate FUNDO=2 com a leitura primaria, entao o wrapper DENTRO das
  // aspas cai no mesmo caminho um nivel abaixo. Conserto de uma camada so nao
  // serviria - bastaria por um wrapper dentro das aspas para reabrir.
  assert.strictEqual(destrutivo.classificar('ssh host bash -lc "env rd /s /q build"').destrutivo, true,
    'D80/F1: wrapper dentro do argumento citado tem de ser lido');

  // TESTEMUNHA 1 - a assercao acima PODE falhar: a MESMA forma com payload
  // inocente PASSA. O que barra e o payload em posicao de comando, nao o nome
  // do wrapper.
  for (const cmd of ['env NODE_ENV=prod npm run build', 'sudo apt-get update',
                     'timeout 30 npm test', 'nice -n 10 npm test', 'ssh -t host htop',
                     'docker run --rm alpine echo ok', 'kubectl exec -it pod -c app -- npm test',
                     'git submodule foreach npm test', 'xargs -I{} ls -l {}',
                     'Start-Process notepad -ArgumentList /a,/b,arquivo.txt']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'testemunha 1: gemeo inocente da mesma forma tem de passar: ' + JSON.stringify(cmd));
  }

  // TESTEMUNHA 2 - O GUARDA-CORPO DO DESENHO. A abertura vale SO a partir de um
  // token que JA esta em posicao de comando. Sem esse portao, um nome de wrapper
  // que aparece como ARGUMENTO abriria o resto - e foi exatamente o que a
  // medicao mostrou: a variante "wrapper em qualquer posicao" faz
  // `echo "veja $(git rev-parse HEAD) e rd /s /q build"` virar falso positivo,
  // e o proprio bloco de controle do medidor a reprovou.
  for (const cmd of ['Copy-Item rd dst -Recurse',
                     'Copy-Item src dst -Recurse -Force',
                     'Select-String -Path src -Pattern "erase" -Recurse',
                     'echo "veja $(git rev-parse HEAD) e rd /s /q build"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'testemunha 2: apelido fora de posicao de comando nao pode barrar: ' + JSON.stringify(cmd));
  }

  // TESTEMUNHA 3 - a abertura alimenta um conjunto SEPARADO (`posAmpla`), lido
  // so pelas regras; o gate da D68 no bloco FUNDO continua lendo `posCmd`. Por
  // isso a prosa citada de um nao-introdutor NAO recebe a leitura de parentese,
  // nem debaixo de um wrapper - o falso positivo que a D68 fechou fica fechado.
  for (const cmd of ['git commit -m "doc: explica (rd /s /q build)"',
                     'sudo git commit -m "doc: explica (rd /s /q build)"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'testemunha 3: o gate da D68 nao pode ser alargado pelo wrapper: ' + JSON.stringify(cmd));
  }

  // TESTEMUNHA 4 - `posAmpla` existe e e DISTINTO de `posCmd`. Sem esta linha,
  // trocar a implementacao por `posAmpla = posCmd` passaria despercebido nos
  // casos em que outra regra ja barra por texto.
  const seg = destrutivo.lerComando('env rd /s /q build')[0];
  assert.ok(!seg.posCmd.has(1), 'posCmd (estrito) NAO poe o token depois do wrapper');
  assert.ok(seg.posAmpla.has(1), 'posAmpla (ampla) poe o token depois do wrapper');
});

test('destrutivo D80/F4+F7: o nome do comando e descascado na comparacao', () => {
  // Mesmo molde do `nu()` (o `^` da D54): a casca sai na COMPARACAO, nunca no
  // leitor, entao ela so pode fazer barrar mais - nunca muda onde um comando
  // comeca ou termina. E nao injeta token nenhum na lista: token sintetico
  // entra em `semAspas` e cria adjacencia que nao existe no texto real
  // (medido: com a injecao, `alias z='rm -rf'; z build` passava a casar a
  // regra 1 por `z=rm rm -rf` - bloqueio por acidente de texto).
  //
  // CONTRASTE QUE ISOLA A CAUSA: `/usr/bin/git reset --hard` ja barrava, porque
  // e regra de TEXTO com `\b`. So as tres regras `fn:`, que comparam o token
  // inteiro, caiam no caminho.
  for (const cmd of ['/usr/bin/git push origin --delete main',
                     '/usr/bin/git push origin :main',
                     '/mingw64/bin/git push origin --delete main',
                     // caminho NAO citado com espaco: parte em dois tokens, e o
                     // nome real e o ultimo pedaco
                     'C:/Program Files/Git/cmd/git.exe push origin --delete main',
                     // `%VAR:~0,0%` e substring de comprimento zero: expande
                     // para NADA no cmd.exe e o `del` colado vira o comando
                     'cmd /c %COMSPEC:~0,0%del /s /q build',
                     // nome colado por virgula na lista de argumentos do
                     // PowerShell, com o INTRODUTOR no campo anterior
                     'Start-Process pwsh -ArgumentList -NoProfile,-Command,"rd C:/build -Recurse"',
                     // nome depois de `=`
                     'Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine="rd /s /q build"}',
                     'doskey z=rd /s /q $*',
                     // `!` do alias do git e do escape de shell do vim
                     "git -c alias.z='!git push origin --delete main' z",
                     "git config alias.z '!git push origin --delete main'",
                     'vim -c "!rd /s /q build"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'D80/F4+F7: o nome esta no token, so estava coberto por uma casca: ' + JSON.stringify(cmd));
  }

  // TESTEMUNHA SO-DE-TOKEN do descascamento (fix round 3; mesmo motivo do bloco
  // D73). As cargas `--delete`/`:main` acima deixaram de discriminar: a regra de
  // TEXTO que a D81 repos (destrutivo.js:762-763) tem `\b` e atravessa a casca -
  // e o proprio comentario deste bloco ja dizia isso de `/usr/bin/git reset
  // --hard`. `-d` so `apagaRemoto` pega, e `apagaRemoto` compara o TOKEN inteiro:
  // sem `nomeCmd` descascando o caminho, `comandoE` nao reconhece o git e ESTAS
  // cinco linhas passam. Medido por mutacao: as 5 morrem sob M4 (`nomeCmd` vira
  // identidade); 2 morrem tambem sob M10 e 1 sob M9/M11
  // (fix5-bancada/mede-mutacao-testemunhas-round4.js).
  // Medido: fix4=passa, vivo=BARRA (fix5-bancada/mede-candidato-round3.js).
  for (const cmd of ['/usr/bin/git push origin -d main',
                     '/mingw64/bin/git push origin -d main',
                     'C:/Program Files/Git/cmd/git.exe push origin -d main',
                     "git -c alias.z='!git push origin -d main' z",
                     "git config alias.z '!git push origin -d main'"]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'testemunha so-de-token: o nome descascado tem de ser reconhecido como git: ' +
      JSON.stringify(cmd));
  }

  // TESTEMUNHA 1 - a assercao acima PODE falhar: o MESMO caminho, a MESMA
  // casca, com payload inocente, PASSA.
  for (const cmd of ['/usr/bin/git push origin main',
                     '/usr/bin/git log --oneline -5',
                     '/c/Windows/System32/where.exe build',
                     'C:/Program Files/Git/cmd/git.exe push origin main',
                     'cmd /c %COMSPEC:~0,0%echo hi',
                     'Start-Process pwsh -ArgumentList -NoProfile,-Command,"npm test"',
                     'doskey z=git log --oneline $*',
                     "git config alias.z '!git log --oneline -5'"]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'testemunha 1: gemeo inocente com a mesma casca tem de passar: ' + JSON.stringify(cmd));
  }

  // TESTEMUNHA 2 - a abertura de caminho exige separador DOS DOIS LADOS, senao
  // qualquer script com caminho poria o proximo token em posicao de comando.
  assert.strictEqual(destrutivo.classificar('./build.sh rd -Recurse').destrutivo, false,
    'testemunha 2: caminho seguido de nome-nao-caminho nao abre posicao de comando');

  // TESTEMUNHA 3 - LIMITE DECLARADO, e ele tem de continuar aberto. Duas
  // razoes independentes, as duas medidas na sonda: a quebra de linha corta o
  // segmento (`rd` fica no segmento 0, `/s` no 1, e `formaCmd` exige os dois no
  // MESMO segmento) e `A=rd` nao esta em posicao de comando, porque `set` nao e
  // wrapper. O fix round 4 barra esta forma so porque le o VALOR da atribuicao,
  // nao um comando - prova: com `set A=xx` ele tambem barra. Nao e cobertura
  // perdida, e nao se "conserta".
  assert.strictEqual(
    destrutivo.classificar('set A=rd' + String.fromCharCode(10) + '%A% /s /q build').destrutivo, false,
    'testemunha 3: %A% sozinho nao e nome de comando');
});

test('destrutivo D80/R1-R3: a regiao ampliada e ARGUMENTO ate prova em contrario', () => {
  // POR QUE ESTE BLOCO EXISTE, e a licao vale mais que as assercoes:
  //
  // A primeira versao da abertura por wrapper passou nos TRES controles de falso
  // positivo que o projeto tinha - 222 gemeos da varredura, 49 INOCENTES da
  // bancada, 83 comandos cotidianos - e mesmo assim criou 130 falsos positivos,
  // inclusive `git ls-files | xargs -r grep -n rm`, uso diario deste repo.
  // Os tres eram cegos pela MESMA razao: o defeito precisa de tres ingredientes
  // no mesmo segmento (wrapper + apelido em posicao de ARGUMENTO + flag parecida
  // com `-Recurse`/`/s`) e nenhum corpus tinha os tres juntos.
  //
  // O corpus que enxerga e `fix5-bancada/inocentes-wrapper.js`: ele GERA o
  // produto cartesiano (20 wrappers x 20 inocentes) em vez de listar casos de
  // memoria. Este bloco e a amostra dele que mora junto do codigo.

  // --- R1: token CITADO nao entra na regiao ampliada.
  // `"erase"` em `-Pattern "erase"` e string, nao comando.
  for (const cmd of ['sudo Select-String -Path src -Pattern "erase" -Recurse',
                     'time Select-String -Path src -Pattern "erase" -Recurse',
                     'env Compare-Object -ReferenceObject "rm" -Recurse',
                     'nohup docker image inspect "ri" --format "x" -Recurse']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'R1: argumento citado sob wrapper nao e comando: ' + JSON.stringify(cmd));
  }
  // TESTEMUNHA de R1 - e ela PODE falhar: R1 nao custa cobertura nenhuma, porque
  // comando aninhado DE VERDADE e relido no bloco FUNDO, e la os tokens de
  // dentro sao NAO citados. Se R1 estivesse cortando demais, estas quatro caem.
  for (const cmd of ['bash -c "rd src -Recurse"',
                     'ssh host bash -lc "env rd /s /q build"',
                     'expect -c "spawn rd /s /q build"',
                     'powershell -Command "rd src -Recurse -Force"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'R1: comando aninhado de verdade continua barrado: ' + JSON.stringify(cmd));
  }

  // --- R2: a corroboracao vem de OUTRO token e, na regiao ampliada, DEPOIS do
  // nome. Flag ANTES do nome e flag de OUTRO programa, e o nome e argumento
  // dele. Flag no MESMO token nao corrobora coisa nenhuma.
  for (const cmd of ['git ls-files | xargs -r grep -n rm',
                     'xargs -r grep -n rm',
                     'sudo chmod -R 755 /opt/rm',
                     'sudo chown -R deploy /srv/del',
                     'sudo cp /s/rd /tmp',
                     'wsl ls -R /usr/bin/rm',
                     'env tar -cf backup.tar /srv/ri']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'R2: flag antes do nome (ou no mesmo token) nao corrobora: ' + JSON.stringify(cmd));
  }
  // A metade "OUTRO token" de R2 tem testemunha PROPRIA, e ela vive em posicao
  // de comando DE VERDADE - foi assim que a mutacao a encontrou. Aqui o MESMO
  // token daria o nome (pelo descascamento de caminho: `/s/rd` -> `rd`) E a
  // flag (`/s`). Um token nao corrobora a si mesmo: sao programas com caminho
  // infeliz, e o fix round 4 deixa os quatro passarem.
  for (const cmd of ['/s/rd /tmp', '/s/rd', '/s/del arquivo', '-Fo/rd']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'R2: um token nao corrobora a si mesmo: ' + JSON.stringify(cmd));
  }
  // TESTEMUNHA de R2 - PODE falhar: com a flag DEPOIS e em outro token, barra.
  for (const cmd of ['env rd /s /q build',
                     'ssh -t host rd /s /q build',
                     'nice -n 10 rd /s /q build',
                     'sudo -u deploy git push origin --delete main',
                     'Start-Process rd -ArgumentList /s,/q,build']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'R2: flag depois do nome corrobora: ' + JSON.stringify(cmd));
  }

  // --- R3: o descascamento de CAMINHO nao vale na regiao ampliada. Caminho em
  // posicao de argumento e caminho: `/opt/rm` e um arquivo, nao o comando `rm`.
  for (const cmd of ['sudo ls -l /opt/rd',
                     'env Get-ChildItem -Path /srv/rd -Recurse',
                     'nohup stat -f /usr/bin/erase -Recurse',
                     'time file /usr/bin/rmdir -Recurse']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'R3: caminho em posicao de argumento e caminho: ' + JSON.stringify(cmd));
  }
  // TESTEMUNHA de R3 - PODE falhar: em posicao de comando DE VERDADE (`posCmd`)
  // e na continuacao de caminho (`posCam`) o descascamento continua valendo -
  // e o F4, que esta rodada NAO pode perder.
  for (const cmd of ['/usr/bin/git push origin --delete main',
                     '/mingw64/bin/git push origin --delete main',
                     'C:/Program Files/Git/cmd/git.exe push origin --delete main',
                     '/c/Windows/System32/del /s /q build']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'R3: em posicao de comando o caminho continua descascado: ' + JSON.stringify(cmd));
  }

  // --- `posCam` existe e e distinto de `posCmd` e de `posAmpla`. Sem esta
  // linha, colapsar os tres conjuntos passaria despercebido.
  const seg = destrutivo.lerComando('C:/Program Files/Git/cmd/git.exe push origin --delete main')[0];
  assert.ok(!seg.posCmd.has(1), 'posCmd estrito nao tem o segundo pedaco do caminho');
  assert.ok(seg.posCam.has(1), 'posCam tem o segundo pedaco do caminho');
  assert.ok(seg.posAmpla.has(1), 'posAmpla contem posCam');
});

test('destrutivo D80/P1-3: os 13 wrappers que a primeira lista deixou passar', () => {
  // Nenhum destes esta nos 222 casos da varredura, entao o criterio
  // `REGRESSAO <= 24` era CEGO para eles. Achados por revisao de membresia da
  // lista e conferidos um a um contra o fix round 4, que barra todos.
  for (const nome of ['caffeinate', 'mpirun', 'srun', 'fakeroot', 'rlwrap', 'cpulimit',
                      'torsocks', 'torify', 'catchsegv', 'ssh-agent', 'dbus-run-session',
                      'arch', 'retry']) {
    assert.strictEqual(destrutivo.classificar(nome + ' git push origin --delete main').destrutivo, true,
      'P1-3: wrapper real tem de abrir posicao de comando: ' + nome);
    // TESTEMUNHA - o mesmo wrapper com payload inocente PASSA. O que barra e o
    // payload, nao o nome do wrapper.
    assert.strictEqual(destrutivo.classificar(nome + ' git log --oneline -5').destrutivo, false,
      'P1-3: gemeo inocente do mesmo wrapper tem de passar: ' + nome);
    // TESTEMUNHA SO-DE-TOKEN (fix round 3; mesmo motivo do bloco D73). A carga
    // `--delete` da primeira assercao deixou de discriminar a abertura por
    // wrapper: a regra de TEXTO que a D81 repos (destrutivo.js:762-763) barra
    // sozinha, com `posAmpla` desligado - e o proprio comentario acima diz que o
    // fix round 4 barra todos estes treze, o que hoje torna aquela assercao
    // incapaz de falhar. `-d` so `apagaRemoto` pega, e ele exige o git em
    // POSICAO DE COMANDO: sem a abertura, ESTA linha passa.
    // Medido: fix4=passa, vivo=BARRA (fix5-bancada/mede-candidato-round3.js) E,
    // por mutacao, as 13 morrem sob M1 (lista de wrappers vazia) e sob M11
    // (fix5-bancada/mede-mutacao-testemunhas-round4.js). Contraste que da valor
    // a esta linha: das 13 assercoes ANTIGAS deste bloco (`--delete`), ZERO
    // morre sob qualquer mutante de mecanismo.
    assert.strictEqual(destrutivo.classificar(nome + ' git push origin -d main').destrutivo, true,
      'testemunha so-de-token: o wrapper tem de abrir posicao de comando: ' + nome);
  }
});

test('destrutivo D80/P1-4: o guarda-corpo da D51, agora COM wrapper ligado', () => {
  // A testemunha da rodada anterior rodava os quatro casos SEM wrapper - isto e,
  // com o mecanismo que ela dizia cobrir DESLIGADO. Ela nao morria se a abertura
  // quebrasse. Esta roda com ele LIGADO.
  for (const cmd of ['Copy-Item rd dst -Recurse',
                     'Copy-Item src dst -Recurse -Force',
                     'Select-String -Path src -Pattern "erase" -Recurse',
                     // com wrapper, e o mecanismo ligado: R1 tira o token citado
                     'sudo Select-String -Path src -Pattern "erase" -Recurse',
                     'env Select-String -Path src -Pattern "erase" -Recurse',
                     // R3 tira o caminho
                     'sudo Get-ChildItem -Path /srv/rd -Recurse',
                     // R2 tira a flag que vem antes
                     'sudo chmod -R 755 /opt/rm']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'P1-4: guarda-corpo com wrapper ligado: ' + JSON.stringify(cmd));
  }

  // TRAVA DE SOBRE-BLOQUEIO DECLARADO - nao e vitoria, e limite conhecido.
  // `sudo Copy-Item rd dst -Recurse` BARRA. Nao e regressao desta rodada: o fix
  // round 4 tambem barra. E nao ha discriminante honesto sem MODELO DE ARIDADE,
  // que e exatamente o que este desenho evita: para separar
  // `sudo Copy-Item rd dst -Recurse` (inocente) de
  // `sudo -u deploy git push origin --delete main` (destrutivo) seria preciso
  // saber que `-u` consome um valor e `Copy-Item` nao. Medido: as tres travas
  // R1/R2/R3 nao alcancam este caso, porque o `-Recurse` vem DEPOIS do `rd`, em
  // outro token, e nada ali e citado nem caminho.
  // Fica travado por teste para que uma rodada futura nao o mude por acidente:
  // se alguem achar o discriminante, este teste falha e a mudanca vira decisao,
  // nao efeito colateral.
  for (const cmd of ['sudo Copy-Item rd dst -Recurse', 'env Copy-Item rd dst -Recurse']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'P1-4: sobre-bloqueio DECLARADO (o fix4 tambem barra): ' + JSON.stringify(cmd));
  }
});

test('destrutivo D81/F4: `apaga referencia no remoto` volta a ter a forma de TEXTO da regua', () => {
  // POR QUE ESTE BLOCO EXISTE
  //
  // O fix round 1 do fix20 fechou 130 falsos positivos apertando a fatia aberta
  // por wrapper (R1/R2/R3) e, com isso, criou 103 falsos NEGATIVOS: o fix round
  // 4 BARRA `sudo /usr/bin/git push origin --delete main` e o portao passou a
  // deixar passar. Medido com denominador: as cargas de APELIDO do corpus
  // `fn-wrapper.js` tem denominador ZERO (o fix round 4 nao barra
  // `sudo /usr/bin/rd /s /q build`), entao os 103 eram TODOS de `apagaRemoto`.
  //
  // A D81 nao afrouxa R1/R2/R3 - nao encosta neles. Ela repoe a regra de TEXTO
  // do fix round 4, que atravessa wrapper, caminho e aspa por construcao.

  // --- 1. AS REGRESSOES QUE ESTA DECISAO FECHA. Todas BARRAM no fix round 4.
  for (const cmd of ['sudo /usr/bin/git push origin --delete main',
                     'env /usr/bin/git push origin :main',
                     'wsl /mingw64/bin/git push origin --delete main',
                     'sudo C:/Program Files/Git/cmd/git.exe push origin --delete main',
                     'nohup /usr/bin/git push origin --delete main',
                     'time /usr/bin/git push origin --delete main',
                     'sudo "git" push origin --delete main',
                     'ssh deploy@host "git" push origin --delete main',
                     'env "git" push origin :main',
                     'xargs -r bin/git push origin --mirror']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'D81: wrapper + nome como caminho/aspa tem de barrar: ' + JSON.stringify(cmd));
  }

  // --- 2. TESTEMUNHA DA SEGUNDA ENTRADA (`+refspec`), e ela existe porque a
  // PRIMEIRA versao desta correcao a esqueceu. Com so a regra de
  // `:letra|--delete|--mirror`, sobravam 104 falsos negativos nesta grafia - e
  // NENHUM portao obrigatorio os media, porque nenhum corpus herdado varia o
  // TOKEN QUE APAGA. Quem achou foi o bloco [FN-VOCAB] de
  // `fix5-bancada/fp-apagaremoto.js`, escrito depois de perguntar o que este
  // conserto passou a discriminar. Se alguem remover a segunda entrada de
  // REGRAS, estas quatro linhas morrem.
  for (const cmd of ['sudo /usr/bin/git push origin +main:main',
                     'env "git" push origin +refs/heads/x',
                     'nohup /mingw64/bin/git push origin +main:main',
                     'wsl C:/Program Files/Git/cmd/git.exe push origin +refs/heads/x']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'D81: a grafia `+refspec` tambem tem de barrar: ' + JSON.stringify(cmd));
  }

  // --- 3. O QUE NAO PODE BARRAR. Estes sao o corpus adverso desta decisao: os
  // QUATRO ingredientes juntos (wrapper + `git` como caminho/aspa em posicao de
  // ARGUMENTO + token `push` + flag de apagar). O fix round 4 deixa os quatro
  // passarem, e o candidato que esta rodada RECUSOU - afrouxar R1/R3 por regra -
  // barrava todos eles: 279 falsos positivos medidos em
  // `fix5-bancada/fp-apagaremoto.js`.
  for (const cmd of ['sudo grep -rn "git" push -d skip',
                     'sudo ls -l /usr/bin/git push -d',
                     'sudo find /usr/bin/git -name push -d',
                     'sudo grep -n "git" push --prune',
                     'sudo grep -n push /usr/bin/git -d skip',
                     'sudo ls /usr/bin/git logs push --delete',
                     'env rsync -a /srv/git logs push --delete']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'D81: `git` em posicao de ARGUMENTO nao e o comando: ' + JSON.stringify(cmd));
  }

  // --- 4. LIMITE DECLARADO, e ele MUDOU nesta decisao - por isso fica travado.
  //
  // Prosa CITADA que contem `git push ... --delete/--mirror/:ref/+ref` passa a
  // BARRAR. Isto nao e falso positivo novo contra a regua: o fix round 4 barra
  // os tres casos abaixo. E e o MESMO limite pre-existente da D48 que o projeto
  // ja aceita para toda regra de TEXTO - `git commit -m "fecha (git reset
  // --hard) manual"`, `... (git clean -fd) ...` e `... (rm -rf build) ...` ja
  // barravam antes desta decisao (medido). A D81 torna a nona regra de git
  // consistente com as outras oito.
  //
  // O CUSTO E REAL e esta declarado: a D68/D74 tinham reduzido falso positivo
  // ABAIXO da regua para esta carga especifica, e essa reducao se perde. Quem
  // quiser recupera-la sem reabrir os 103 falsos negativos tera de discriminar
  // dentro da maquinaria de token - e ai vale reler os numeros das vias A/B/C
  // no relatorio do fix round 2.
  for (const cmd of ['git commit -m "fecha (git push origin --delete main) manual"',
                     'bash -c "echo done # git push origin --delete main"',
                     'cmd //c echo "# ver (git push origin --delete main)"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'D81: limite DECLARADO - prosa citada com regra de TEXTO barra, como `rm -rf` sempre barrou: ' + JSON.stringify(cmd));
  }
  // CONTROLE do limite acima: com carga de TOKEN a mesma prosa continua
  // passando. Se esta linha cair junto com a de cima, o problema e o gate da
  // D68, nao a regra de texto - e os dois blocos separam os dois casos.
  for (const cmd of ['git commit -m "fecha (git push origin -d main) manual"',
                     'git commit -m "doc: explica (rd /s /q build)"']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'D81: com carga de TOKEN a prosa continua passando: ' + JSON.stringify(cmd));
  }

  // --- 5. O `fn: apagaRemoto` NAO virou codigo morto: ele cobre `-d` e
  // `--prune`, que a regua nao tem e a regra de texto tampouco.
  for (const cmd of ['git push origin -d main', 'git push --prune']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'D81: a regra de token segue cobrindo o que a de texto nao cobre: ' + JSON.stringify(cmd));
  }
});

// ===========================================================================
// FIX22/F3: o ALVO `{}`. `rm -rf {}` - o idioma de delecao mais comum do shell
// (`find -exec`, `xargs -I{}`) - passava, porque `{` e `}` estao em
// SEPARA_SEGMENTO e cortavam o segmento em `rm -rf ` sem alvo, e a regra 1 do
// `rm` exige `\s+\S`. A leitura ALTERNATIVA `chaveVazia` le o par COLADO como
// UM token, e o alvo volta a existir.
// ===========================================================================
// LIMITE DECLARADO DESTE BLOCO (fix round 1): as 29 assercoes estao num UNICO
// `test()`, entao o primeiro `assert` que falhar MASCARA os cinco blocos
// seguintes - quem quebrar o item 1 nao vera se tambem quebrou o item 6.
// Registrado e nao consertado: separar em 6 `test()` mudaria a contagem da
// suite (125), que e numero de aceite desta rodada. Quem for reincidir aqui:
// `fix5-bancada/mede-mutacao-fix22.js` avalia os SEIS blocos de forma
// independente e imprime todos os que quebraram, entao o diagnostico completo
// esta a um comando de distancia.
test('destrutivo FIX22/F3: `{}` e o ALVO do comando, nao um bloco de script', () => {
  const BS = String.fromCharCode(92);   // barra invertida, nunca digitada direto

  // --- 1. AS 6 LINHAS DO F3. Este bloco e a ACEITACAO da rodada.
  // ATENCAO ao ler: estas seis NAO sao testemunhas discriminantes. A regua
  // (`fix4`) BARRA todas as seis, entao elas nao distinguem o mecanismo da
  // ausencia dele - quem faz esse papel e o item 2. Foi exatamente essa
  // confusao que custou uma rodada inteira no fix round 3: "discrimina contra a
  // regua" e "morre se o mecanismo morrer" sao perguntas diferentes.
  for (const cmd of ['rm -rf {}',
                     'find . -name "*.o" -exec rm -rf {} ' + BS + ';',
                     'find . -type d -exec rm -rf {} +',
                     'ls | xargs -I{} rm -rf {}',
                     'xargs -I{} rm -rf {}',
                     'find . -type d -name node_modules -exec rm -rf {} ' + BS + ';']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'FIX22/F3: o alvo `{}` nao pode desligar a regra do rm: ' + JSON.stringify(cmd));
  }

  // --- 2. AS TESTEMUNHAS. Cada carga e `fix4=passa` E `vivo=BARRA` (medido),
  // isto e, ela DISCRIMINA contra a regua; e cada uma passa a barrar SO por
  // causa desta rodada (medido contra `fix5-bancada/destrutivo-fix22-antes.js`,
  // que e o pre-fix - identico ao estado anterior exceto a linha 2, o `require`
  // reancorado para caminho absoluto). Se a leitura `chaveVazia` morrer, as
  // quatro caem - medido: os mutantes MF1 e MF2 matam TESTEMUNHA(4/4) em
  // `fix5-bancada/mede-mutacao-fix22.js`. E nenhuma cai por acidente de texto,
  // porque a regua nao pega nenhuma.
  //
  // SAO 3 MECANISMOS PARA 4 TESTEMUNHAS, nao 4 (corrigido no fix round 1): as
  // duas primeiras cruzam o `{}` com a MESMA via, a rejuncao de aspas do
  // `r""m`. Elas ficam as duas porque variam o HOSPEDEIRO (`xargs -I{}` e
  // `find -exec`), e isso e variacao de forma, nao de mecanismo.
  for (const cmd of [
    // `{}` + rejuncao de aspas de `semAspas` (o `r""m` vira `rm`)
    'xargs -I{} r""m -rf {}',
    'find . -name x -exec r""m -rf {} ' + BS + ';',
    // `{}` + comentario de bloco do PowerShell virando espaco
    'Remove-Item <# & #> {} -Recurse -Force',
    // `{}` + descascamento de CAMINHO em nomeCmd + corroboracao de apelidoPS:
    // sem o `{}` como token, o `-Recurse` cai em OUTRO segmento e nao corrobora
    '/usr/bin/ri {} -Recurse'
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'FIX22/F3: testemunha que a regua NAO pega - se cair, o mecanismo morreu: ' + JSON.stringify(cmd));
  }

  // --- 3. OS GEMEOS. GUARDA DE NAO-REGRESSAO, NAO MEDIDA - e a redacao anterior
  // afirmava mais do que a medicao sustenta (corrigido no fix round 1).
  //
  // O que estava escrito: "e o que reprova um conserto largo; sao eles que
  // provam que o `{}` virou alvo sem virar bloqueio". NADA nesta rodada foi
  // reprovado por estas 11 cargas. Medido:
  //   - dos 5 mutantes de `mede-mutacao-fix22.js`, NENHUM quebra este bloco;
  //     mais 3 variantes de mutante tentadas de proposito para quebra-lo: 0
  //     mortes. Total 8 tentativas, 0.
  //   - dos 6 candidatos, nenhum foi reprovado aqui: V1/V2/V5 abortaram no
  //     `[CTRL]` pela linha da prosa (item 4 abaixo), V3 por `PERDA 24/105`,
  //     V6 pelo bloco de script do PowerShell (item 5).
  //
  // POR QUE E ESTRUTURAL, e nao descuido: `chaveVazia` so ACRESCENTA alvo, nunca
  // inventa verbo destrutivo. Estas 11 cargas nao tem verbo destrutivo algum
  // (ls, echo, cp, chmod, prettier, Write-Host, e `rm` SEM flag r/f), entao
  // nenhuma mutacao honesta do ALVO pode faze-las barrar.
  //
  // O BLOCO NAO E VACUO - o matador dele vive em outro mecanismo, e esta medido:
  // `mut-fix20-M6.js` e `mut-fix20-M15.js` (2 dos 20 mutantes congelados do
  // fix20) fazem `git ls-files | xargs -r grep -n rm` barrar. Sao mutacoes da
  // maquinaria de wrapper (R1/R2/R3), que e o que alcanca estas cargas.
  //
  // O valor deste bloco e delimitar o RAIO do conserto: ele nao mede o
  // mecanismo, ele impede que o mecanismo cresca para cima do inocente.
  for (const cmd of ['find . -name "*.log" -exec ls -l {} ' + BS + ';',
                     'find . -name *.log -exec ls -l {} ' + BS + ';',
                     'find . -type d -exec ls -d {} +',
                     'ls | xargs -I{} echo {}',
                     'xargs -I{} ls -l {}',
                     // inocentes de uso diario com `{}`, que nenhum corpus media
                     'find . -type f -exec chmod 644 {} ' + BS + ';',
                     'find . -name "*.js" -exec prettier --write {} ' + BS + ';',
                     'ls | xargs -I{} cp {} /backup',
                     'git ls-files | xargs -r grep -n rm',
                     // `rm` SEM flag r/f continua passando, como `rm arquivo.txt`
                     'find . -name x -exec rm {} ' + BS + ';',
                     // o bloco de script sem carga destrutiva
                     'Get-ChildItem | ForEach-Object { Write-Host $_ }']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false,
      'FIX22/F3: o alvo `{}` nao pode virar bloqueio de comando inocente: ' + JSON.stringify(cmd));
  }

  // --- 4. O CONTROLE QUE O CONSERTO OBVIO QUEBRA, travado aqui para nao voltar.
  // Tirar o `\s+\S` da regra 1, ou aceitar o FIM do segmento como alvo, barra
  // esta linha - e nao por causa de "prosa": o argumento citado `"rm -rf"` tem
  // espaco dentro e por isso e RELIDO como comando aninhado (D48), virando um
  // segmento com `rm` em posCmd e `-rf` como token irmao, indistinguivel de um
  // `rm -rf` de verdade. So a AUSENCIA DE ALVO separa os dois. Por isso o
  // conserto olha o ALVO, e nunca o par `rm` + flag.
  // A mensagem monta o `\s+\S` com BS: escrito literal numa string simples ele
  // renderizaria `s+S` na falha, contra a disciplina que este bloco adota.
  assert.strictEqual(destrutivo.classificar('grep -rn "rm -rf" .').destrutivo, false,
    'FIX22/F3: `rm -rf` SEM alvo, citado, e prosa legitima - o `' +
    BS + 's+' + BS + 'S` da regra 1 e carga estrutural');

  // --- 5. `{` e `}` CONTINUAM cortando segmento, que e a razao de existirem em
  // SEPARA_SEGMENTO: em `ForEach-Object { rd $_ -Recurse }` o `rd` esta em
  // posicao de comando DENTRO do bloco. So o par COLADO `{}` e alvo; bloco de
  // verdade tem conteudo.
  for (const cmd of ['Get-ChildItem | ForEach-Object { rd $_ -Recurse -Force }',
                     'if ($true) { rd build /s /q }',
                     '1..3 | ForEach-Object { rm -rf build }']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'FIX22/F3: bloco de script de verdade continua cortando segmento: ' + JSON.stringify(cmd));
  }

  // --- 6. A GUARDA DOS 105. Esta e a linha que impede a "simplificacao" obvia
  // desta rodada: mover a leitura `chaveVazia` para a leitura PRIMARIA (isto e,
  // fazer `{}` deixar de cortar segmento sempre). Medido em
  // `fix5-bancada/difere-chave-v3-v4.js`: aquilo PERDE 105 bloqueios que este
  // portao ja tem, porque com `{}` ANTES do comando o token `{}` ocupa o indice
  // 0 e EMPURRA o comando de verdade para fora de `posCmd` - as quatro regras
  // de token ficam cegas. Como leitura alternativa, os segmentos so SE SOMAM.
  // Se estas quatro linhas cairem, alguem fez exatamente essa troca.
  for (const cmd of ['{} rd /s /q build',
                     '; {}ri -Recurse -Force dist',
                     'foo{} del /s /q build',
                     'echo a && {} erase /s /q build']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true,
      'FIX22/F3: `{}` ANTES do comando nao pode cegar as regras de token: ' + JSON.stringify(cmd));
  }
});

// D244/defeito 5 (D241 secao 2.5): `cat >> arq <<'EOF'` que so CITAVA um `rm -f` foi barrado.
// O corpo de heredoc para um escritor de texto e texto; para um shell, e comando.
test('D244/defeito 5: corpo de heredoc para cat/tee e texto, nao comando', () => {
  for (const cmd of [
    "cat >> a.md <<'EOF'\nexemplo: rm -f x\nEOF",
    'cat > a.md <<EOF\nrm -rf build\nEOF',
    'cat > a.md <<"FIM"\r\ngit reset --hard\r\nFIM\r\n',
    "tee a.md <<-'FIM'\n\tgit reset --hard\n\tFIM",
    'cat <<EOF > a.md\nrm -rf x\nEOF'
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false, JSON.stringify(cmd));
  }
});

test('D244/defeito 5: heredoc executado, fora do corpo ou sem fechamento continua barrado', () => {
  for (const cmd of [
    'bash <<EOF\nrm -rf build\nEOF',
    "sh <<'X'\nrm -rf /\nX",
    'cat <<EOF | bash\nrm -rf b\nEOF',
    'ssh host <<EOF\nrm -rf /srv\nEOF',
    'python - <<EOF\nimport shutil\nEOF\nrm -rf build',
    'cat <<EOF > a.md\nx\nEOF\nrm -rf build',
    'cat <<EOF\nrm -rf x',
    'rm -rf build; cat <<EOF\nnada\nEOF'
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, JSON.stringify(cmd));
  }
});

// T14 ronda 1 (lente borda): cada abertura sem fechamento varria ate o fim do comando procurando o
// delimitador - quadratico. Medido: 20 mil aberturas, 6,4 s; o controle so com `echo`, 88 ms.
test('T14: heredoc aberto muitas vezes sem fechamento custa linear', () => {
  const abertos = (n) => Array.from({ length: n }, (_, i) => 'cat <<A' + i).join('\n');
  const base = abertos(1250);
  const cmd = abertos(5000);
  const m = razaoConfirmada(() => destrutivo.classificar(base), () => destrutivo.classificar(cmd));
  assert.ok(m.razao < TETO_RAZAO,
    'quadruplicar as aberturas custou ' + m.razoes + ' (teto ' + TETO_RAZAO +
    '; linear ~4, quadratico ~16): ' + m.pequeno.toFixed(2) + ' ms e ' + m.grande.toFixed(2) + ' ms');
  // D246 sec. 5: dois heredocs no mesmo comando leem tudo (antes da D246, este passava)
  assert.strictEqual(destrutivo.classificar('cat > a <<X\nrm -rf a\nX\ncat > b <<X\nrm -rf b\nX').destrutivo, true);
  assert.strictEqual(destrutivo.classificar('cat > a <<X\nX\nrm -rf b').destrutivo, true);
  // o corpo acaba no PRIMEIRO fechamento depois da abertura, nao no ultimo
  assert.strictEqual(destrutivo.classificar('cat > a <<X\nnada\nX\nrm -rf b\nX').destrutivo, true);
});

// T14 ronda 2 (lente borda, P0): o `<<` dentro de uma aspa nao abre heredoc. Com a aspa aberta numa
// linha anterior, o `cat <<EOF` era lido como abertura e o `rm` que vem depois de a aspa fechar sumia.
// O que o leitor de aspas nao entende ($'...', crase, $(...), <(...), >(...), barra no fim) le tudo.
test('T14: heredoc dentro de aspa, ou depois do que o leitor nao entende, continua lido', () => {
  for (const cmd of [
    'echo "line one\ncat <<EOF\nend quote" ; rm -rf /important\nmore stuff\nEOF',
    'x="; cat <<EOF\n" ; rm -rf /x\nEOF',
    // a aspa fecha DEPOIS do `<<` na mesma linha: a linha termina limpa, mas o `<<` era texto
    'echo "a\ncat <<EOF "\nrm -rf /\nEOF',
    'x="; cat <<EOF "\nrm -rf /\nEOF',
    "echo 'a\ncat <<EOF\n' ; rm -rf /x\nEOF",
    "echo $'a\\'\ncat <<EOF\n' ; rm -rf /x\nEOF",
    'echo `\ncat <<EOF\n` ; rm -rf /x\nEOF',
    'echo "$(\ncat <<EOF\n)" ; rm -rf /x\nEOF',
    'cat <<EOF > >(sh)\nrm -rf /\nEOF',
    'sh -s \\\ncat <<EOF\nrm -rf /\nEOF',
    'sh -s \\\r\ncat <<EOF\r\nrm -rf /\r\nEOF',
    // `<<<` e here-string do bash: a linha seguinte e comando, nao corpo (sonda da ronda 2)
    'cat <<<word\nrm -rf /\nword',
    'cat <<< word\nrm -rf /\nword',
    'tee a <<<"x"\nrm -rf /\nx'
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, JSON.stringify(cmd));
  }
  // D246 sec. 5: outro comando antes do `cat`, ou dois heredocs, leem tudo (antes da D246, controles que passavam)
  for (const cmd of [
    'echo "ok" && cat > a.md <<\'EOF\'\nrm -rf x\nEOF',
    "cat > a <<'EOF'\nit's `x` \"y\n$(z)\nEOF\ncat > b <<EOF\nrm -rf y\nEOF"
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, JSON.stringify(cmd));
  }
  // controle: aspa e crase DENTRO de um corpo com delimitador entre aspas nao atrapalham
  assert.strictEqual(destrutivo.classificar("cat > a <<'EOF'\nit's `x` \"y\n$(z)\nrm -rf y\nEOF").destrutivo, false);
});

// D246 sec. 5 (T14 no teto, decisao do dono): o corpo so sai quando o comando INTEIRO e um unico
// `cat`/`tee` com heredoc e nada mais. Todos, menos os dois ultimos, o bash executa - medido com `echo` no
// lugar do `rm` - e o HEAD barrava: o primeiro e o P0 da ronda 3; os outros, sonda desta correcao, um por
// condicao do `semCorpoDeHeredocInerte`.
test('D246: heredoc so sai quando o comando inteiro e um unico cat/tee com corpo inerte', () => {
  const NB = String.fromCharCode(0xa0);
  for (const cmd of [
    'cat <<EOF > /tmp/x.sh\nrm -rf /\nEOF\nbash /tmp/x.sh',
    // outro comando na abertura
    'cat <<EOF > x.sh; bash x.sh\nrm -rf /\nEOF',
    'cat <<EOF > x.sh && bash x.sh\nrm -rf /\nEOF',
    // delimitador sem aspas: o bash expande o corpo
    'cat > a.md <<EOF\n$(rm -rf /)\nEOF',
    'cat > a.md <<EOF\n`rm -rf /`\nEOF',
    // ... e junta a linha que acaba em barra: `E\` + `OF` e o fechamento
    'cat > a <<EOF\nE\\\nOF\nrm -rf /\nEOF',
    // o delimitador de `<<EOF"x"` e `EOFx`; para o bash, `\r` e espaco unicode sao letra dele
    'cat > a <<EOF"x"\nEOFx\nrm -rf /\nEOF',
    'cat > a <<EOF\rx\nEOF\rx\nrm -rf /\nEOF',
    'cat > a <<EOF' + NB + 'x\nEOF' + NB + 'x\nrm -rf /\nEOF',
    'cat > a <<' + NB + 'EOF\n' + NB + 'EOF\nrm -rf /\nEOF',
    // aspa ou continuacao na abertura: o `<<` e texto, ou o comando segue na linha de baixo
    'cat "a <<EOF b"\nrm -rf /\nEOF',
    'cat <<EOF "x\n" ; rm -rf /\nEOF',
    'cat > a <<EOF \\\n&& rm -rf /\nEOF',
    // consequencia pedida: qualquer outra linha no comando, antes ou depois, le tudo
    'echo a\ncat > a <<EOF\nrm -rf /\nEOF',
    'cat > a <<EOF\nrm -rf /\nEOF\necho fim'
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, JSON.stringify(cmd));
  }
  // controles: linha em branco em volta; `$(`, crase e barra num corpo com delimitador entre aspas; `$VAR` sem aspas
  for (const cmd of [
    '\ncat > a <<EOF\nrm -rf /\nEOF\n\n',
    "cat > a <<'EOF'\n$(rm -rf /) `x` \\\nEOF",
    'cat > a <<EOF\n$HOME rm -rf x\nEOF'
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false, JSON.stringify(cmd));
  }
});

// D244/defeito 12 (D243 secao 4): a ferramenta PowerShell chegava ao portao; o que passava era a
// regua - `Remove-Item` so contava como destrutivo com -Recurse/-Force. Decisao do dono (D244 4.1):
// `-Confirm:$false` pula a confirmacao, e conta como forcado, em paridade com `rm -f`.
test('D244/defeito 12: Remove-Item e apelido com -Confirm:$false sao destrutivos', () => {
  for (const cmd of [
    "Remove-Item -LiteralPath 'C:\\x\\o.txt' -Confirm:$false",
    'Remove-Item x -confirm:$False',
    'ri x -Confirm:$false',
    'del x -Confirm:$false'
  ]) {
    const r = destrutivo.classificar(cmd);
    assert.strictEqual(r.destrutivo, true, JSON.stringify(cmd));
  }
});

test('D244/defeito 12: sem -Confirm:$false, ou em outro cmdlet, nada muda', () => {
  for (const cmd of ['Remove-Item x', 'Get-Item x -Confirm:$false', 'Remove-Item x -Confirm', 'Remove-Item x -WhatIf']) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false, JSON.stringify(cmd));
  }
});

// D420/SH-01: opcao global do git com valor ENTRE ASPAS COM ESPACO (ou o executavel citado) escapava
// de todas as regras do git: o GIT lia o valor como `\S*` e o espaco quebrava a cadeia. O controle
// sem espaco ja barrava.
test('D420/SH-01: opcao global do git com valor citado com espaco nao escapa', () => {
  for (const cmd of [
    'git -C "C:/dev/meu projeto/x" reset --hard',
    "git -C 'C:/dev/meu projeto/x' reset --hard",
    'git -C "C:/dev/meu projeto/x" push --force origin main',
    'git -C "C:/dev/meu projeto/x" clean -fd',
    "git -C 'a b' branch -D feat",
    'git -c user.name="A B" push --force origin main',
    'git -c user.name="A B" -C "x y" reset --hard',
    String.raw`"C:\Program Files\Git\cmd\git.exe" reset --hard`,
    String.raw`& "C:\Program Files\Git\cmd\git.exe" reset --hard`,
    String.raw`& 'C:\Program Files\Git\cmd\git.exe' -C "C:/dev/meu projeto" push -f`
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, 'devia barrar: ' + cmd);
  }
  // controles: mesma forma de prefixo, subcomando inofensivo
  for (const cmd of [
    'git -C "C:/dev/meu projeto/x" status',
    "git -C 'a b' log --oneline",
    'git -c user.name="A B" commit -m "msg"',
    String.raw`"C:\Program Files\Git\cmd\git.exe" status`,
    String.raw`& "C:\Program Files\Git\cmd\git.exe" log -5`,
    'git -C "C:/dev/meu projeto/x" push origin main'
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false, 'devia passar: ' + cmd);
  }
});

// D420/SH-03: flag curta de push colada a outras (`-fu`, `-uf`, `-vf`) e `clean --force` passavam.
test('D420/SH-03: push com -f agrupado e clean --force barram; push sem f passa', () => {
  for (const cmd of [
    'git push -fu origin main', 'git push -uf origin main', 'git push -vf origin main',
    'git push -fv', 'git push origin main -fu', 'git push --force-with-lease origin main',
    'git clean --force', 'git clean --force -d', 'git -C x clean --force'
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, 'devia barrar: ' + cmd);
  }
  for (const cmd of [
    'git push -u origin main', 'git push -v origin main', 'git push origin main',
    'git push --set-upstream origin feat', 'git push origin feat-fix', 'git push origin fix-f',
    'git clean -n', 'git clean --dry-run'
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false, 'devia passar: ' + cmd);
  }
});

// D420/SH-04 e TS-07: as formas que descartam a arvore inteira de trabalho.
test('D420/SH-04: checkout, restore e switch que descartam a arvore inteira barram', () => {
  for (const cmd of [
    'git checkout -- .', 'git -C x checkout -- .', 'git checkout .', 'git checkout HEAD -- .',
    'git checkout main -- .', 'git restore -- .', 'git restore .', 'git restore --worktree .',
    'git restore --staged --worktree .', 'git restore --source=HEAD .', 'git restore --source HEAD .',
    'git switch -f x', 'git switch --force x', 'git switch x -f',
    'git switch --discard-changes x', 'git -C x switch -f y'
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, 'devia barrar: ' + cmd);
  }
  for (const cmd of [
    'git checkout -- arquivo.txt', 'git checkout -- src/a.js', 'git checkout -b nova', 'git checkout main',
    'git restore arquivo.txt', 'git restore --staged arquivo.txt', 'git restore -- arquivo.txt',
    'git restore --source=HEAD arquivo.txt', 'git switch main', 'git switch -c nova',
    'git switch feature-f', 'git checkout feature -- src/a.js'
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false, 'devia passar: ' + cmd);
  }
});

// S1/L1-1 e H-1: `checkout` com flag antes do `.`, `restore` com flag agrupada (`-SW`) ou com valor
// citado (`--source "a b"`) descartavam a arvore e passavam; `restore --staged .` (so o indice, sem
// `--worktree`/`-W`) NAO perde trabalho e estava barrado - saiu da lista de barrados acima.
test('S1/L1-1: checkout -f/--ours/--theirs e restore -SW/--source "a b" barram; restore so --staged passa', () => {
  for (const cmd of [
    'git checkout -f .', 'git checkout --force .', 'git checkout --ours .', 'git checkout --theirs .',
    'git checkout -f -- .', 'git checkout --ours -- .', 'git -C x checkout -f .', 'git checkout -f HEAD -- .',
    'git restore -SW .', 'git restore -S -W .', 'git restore --staged -W .', 'git restore . --worktree',
    'git restore --source "a b" .', 'git restore --source="a b" .', 'git restore -s "a b" .',
    'git restore --staged --source "a b" --worktree .', 'git restore --source "a b" --staged --worktree .',
    // o `-S` de wrapper (sudo/ssh) vem antes do `restore` e nao e o `--staged` do git
    'sudo -S git restore .', 'ssh -S sock h git restore .'
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, 'devia barrar: ' + cmd);
  }
  for (const cmd of [
    // D429/1: `checkout -f <ref>` e `checkout -f <arquivo>` agora barram (ver o teste D429/1 abaixo)
    'git checkout --ours arquivo.txt',
    'git checkout --ours .gitignore', 'git checkout -b nova'
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false, 'devia passar: ' + cmd);
  }
});

// D433: `checkout -- .gitignore` (restaurar UM arquivo cujo nome comeca com ponto) era barrado como
// "descarta todas as mudancas": a forma `-- .` nao exigia fronteira de token depois do ponto.
test('D433: checkout -- <arquivo com ponto> passa; a arvore inteira (`.` como token) segue barrada', () => {
  for (const cmd of [
    'git checkout -- .', 'git checkout .', 'git checkout HEAD -- .', 'git checkout -f .', 'git checkout --ours .',
    'git checkout -- . ; ls', 'git checkout -- .&& x', 'git checkout -- .|cat', 'git -C x checkout -- .'
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, 'devia barrar: ' + cmd);
  }
  for (const cmd of [
    'git checkout -- .gitignore', 'git checkout -- .env', 'git checkout -- ./src/a.js',
    'git checkout HEAD -- .gitignore', 'git -C x checkout -- .gitignore'
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false, 'devia passar: ' + cmd);
  }
});

// D429/1: `git clean` com outra opcao ANTES do -f/-d/-x (so a 1a flag era lida) e `git checkout -f <ramo>`
// (so `-f .` barrava) escapavam. `clean -n`/`--dry-run` nao apaga e segue liberado, mesmo com -fd junto (H-2).
test('D429/1: clean com opcao antes do -f e checkout -f <ramo> barram; dry-run e checkout comum passam', () => {
  const g = 'git';
  const juntar = (...p) => [g, ...p].join(' ');
  for (const cmd of [
    juntar('clean', '-q', '-fd'), juntar('clean', '-e', 'x', '-fd'), juntar('clean', '-x', '-f'),
    juntar('clean', '--quiet', '--force'), juntar('clean', '-q', '-d', '-f'), juntar('-C', 'x', 'clean', '-q', '-fd'),
    juntar('clean', '-en', '-fd'), // -en: o `n` e o valor do -e (padrao a excluir), nao dry-run
    juntar('clean', '-q', '-n', ';', 'git', 'clean', '-q', '-fd'),
    juntar('checkout', '-f', 'main'), juntar('checkout', '--force', 'main'), juntar('checkout', 'main', '-f'),
    juntar('checkout', '-qf', 'main'), juntar('checkout', '-f', 'arquivo.txt'), juntar('-C', 'x', 'checkout', '-f', 'main'),
    juntar('checkout', '-b', 'nova', '-f')
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, 'devia barrar: ' + cmd);
  }
  for (const cmd of [
    juntar('clean', '-n', '-fd'), juntar('clean', '--dry-run', '-fd'), juntar('clean', '-nfd'),
    juntar('clean', '-q', '-n', '-fd'), juntar('clean', '-e', 'x', '--dry-run', '-fd'), juntar('clean', '-dn'),
    juntar('clean', '-n'), juntar('clean', '--dry-run'), juntar('clean', '-q'),
    juntar('checkout', 'main'), juntar('checkout', '-b', 'x'), juntar('checkout', '-q', 'main'),
    juntar('checkout', 'feat-f'), juntar('checkout', '--', '-f'), juntar('checkout', '--ours', 'arquivo.txt')
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false, 'devia passar: ' + cmd);
  }
});

// s62 (revisao cega da D429/1, lente borda): o dry-run so conta como OPCAO do clean - nao dentro de aspas, nao
// depois do `--` (pathspec) e nao como valor do `-e`. E `switch` com `-f` agrupado (`-fq`, `-fc`) tambem forca.
test('s62: clean com -n citado, depois do -- ou como valor do -e barra; switch -f agrupado barra', () => {
  const g = 'git';
  const juntar = (...p) => [g, ...p].join(' ');
  for (const cmd of [
    juntar('clean', '-fdx', '--', '"a -n"'), juntar('clean', '-fd', '--', '-notes'),
    juntar('clean', '-fd', "'x -n'"), juntar('clean', '-e', '-n', '-fd'), juntar('clean', '--exclude', '-n', '-fd'),
    // o git aceita abreviacao unica de opcao longa: `--exc`/`--e` sao o `--exclude` e consomem o token seguinte
    juntar('clean', '-fd', '--exc', '--dry-run'), juntar('clean', '-fd', '--e', '-n'),
    // D431: a ultima opcao vale (`--no-dry-run` depois do `-n` volta a apagar) e `--force` abreviado tambem apaga
    juntar('clean', '-n', '--no-dry-run', '-fd'), juntar('clean', '--dry-run', '-fd', '--no-dry-run'),
    juntar('clean', '-n', '-fd', '--no-d'), juntar('clean', '--forc'), juntar('clean', '--fo', '-d'), juntar('clean', '-q', '--f'),
    juntar('switch', '-fq', 'main'), juntar('switch', '-fc', 'nova'), juntar('switch', '-qf', 'main')
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, 'devia barrar: ' + cmd);
  }
  for (const cmd of [
    juntar('clean', '-n', '-fd', '--', 'x'), juntar('clean', '-e', 'x', '-n', '-fd'), juntar('clean', '-e', 'x', '-nfd'),
    juntar('clean', '--exclude=x', '-n', '-fd'), juntar('clean', '--dry', '-fd'), juntar('clean', '--d', '-fd'),
    juntar('clean', '--no-dry-run', '-n', '-fd'),
    juntar('switch', '-c', 'nova'), juntar('switch', 'main'), juntar('switch', '-q', 'main'), juntar('switch', 'fix-f')
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false, 'devia passar: ' + cmd);
  }
});

// D428: `soIndice` e uma regra ESTRITA, ancorada no subcomando do git. So libera quando o `git` abre o
// segmento (opcoes globais `-C <dir>`/`-c k=v` aceitas), vem `restore`, depois UMA OU MAIS `--staged`/`-S`,
// um `--` isolado opcional e o `.` final, sem mais nada. Qualquer outra coisa barra - inclusive `restore`
// como valor de opcao do wrapper (`sudo -u restore`), `-S` de wrapper (`sudo -S`, `ssh -S`), `-S`/`--staged`
// depois de `--` (pathspec), `--source=`, `-W`, `restore` repetido, `.` antes das opcoes.
test('D428: restore . so libera a forma estrita (git [-C d] restore (--staged|-S)+ [--] .)', () => {
  for (const cmd of [
    'git restore --staged .', 'git restore -S .', 'git restore --staged -- .', 'git restore -S -- .',
    'git -C "a b" restore --staged .', 'git -c k=v restore -S .', 'git restore --staged -S .'
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false, 'devia passar: ' + cmd);
  }
  for (const cmd of [
    'git restore .', 'git restore -SW .', 'git restore --staged --worktree .',
    'git restore -W . restore -S', 'git restore --worktree . restore --staged',
    'sudo -S git restore .', 'ssh -S sock h git restore .',
    'sudo -u restore -S git restore .', 'ssh -l restore -S /tmp/c h git restore .',
    'git restore -- -S .', 'git restore -- --staged .', 'git restore -S restore .',
    'git restore --source=HEAD --staged .', 'git restore --source=HEAD~1 --staged .',
    'git restore --staged --source "a b" .', 'git restore . --staged', 'git restore -S -W .'
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, 'devia barrar: ' + cmd);
  }
});

// D442/1 (S-3, S-52): `restore` com flag que nao muda o descarte antes do `.` (`-q`, `--ours`, `--theirs`,
// `--merge`, `--conflict=X`...) e a abreviacao longa do `--worktree` (`--work`) apagavam a arvore e passavam.
// `-p`/`--patch` (interativo) segue fora, como no checkout. So indice com `-q` (`--staged -q .`) segue passando.
test('D442/1: restore -q/--ours/--theirs/--work . barra; --staged -q . e -p . passam', () => {
  for (const cmd of [
    'git restore -q .', 'git restore --quiet .', 'git restore --ours .', 'git restore --theirs .',
    'git restore --work .', 'git restore --w .', 'git restore --worktree -q .', 'git restore -qW .',
    'git restore -m .', 'git restore --merge .', 'git restore --conflict=diff3 .', 'git restore --ignore-unmerged .',
    'git restore --overlay .', 'git restore --no-overlay .', 'git restore --progress .',
    'git restore --no-progress .', 'git restore --recurse-submodules .', 'git restore --ignore-skip-worktree-bits .',
    'git restore -q -- .', 'git -C x restore --ours .', 'git restore --staged --worktree -q .'
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, 'devia barrar: ' + cmd);
  }
  for (const cmd of [
    'git restore --staged -q .', 'git restore -q --staged .', 'git restore -Sq .', 'git restore --quiet -S -- .',
    'git restore -p .', 'git restore --patch .', 'git restore -q arquivo.txt', 'git restore --ours arquivo.txt'
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false, 'devia passar: ' + cmd);
  }
});

// S1/L1-2: `-[a-z]*f` com flag `i` pegava `-F` e `-fix` (nao sao flags de push) e tinha duas corridas em
// volta do `f`. Agora o aglomerado so pode ter letras de flag curta do push e a leitura e linear.
test('S1/L1-2: push forcado barra por -f/--force; -F e argumento -fix passam; aglomerado enorme e linear', () => {
  for (const cmd of [
    'git push -f', 'git push --force', 'git push -uf', 'git push -fu origin main', 'git push -vf origin main',
    'git push --force-with-lease origin main', 'git push origin main -f', 'git push -fo ci.skip origin main',
    'git push -nf', 'git push -f4'
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, true, 'devia barrar: ' + cmd);
  }
  for (const cmd of [
    'git push -F', 'git push -o -fix origin main', 'git push origin main -fix', 'git push -u origin fix',
    'git push --follow-tags', 'git push -n'
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false, 'devia passar: ' + cmd);
  }
  const ini = Date.now();
  const r = destrutivo.classificar('git push -' + 'f'.repeat(30000) + '-');
  const ms = Date.now() - ini;
  assert.strictEqual(r.destrutivo, false);
  assert.ok(ms < 500, 'aglomerado de 30000 letras devia ser linear, levou ' + ms + ' ms');
});

// D420/TS-08: a regra "escrita direta de disco" nao tinha nenhum teste que a citasse.
test('D420/TS-08: escrita direta de disco barra com o motivo certo; citar o nome em echo passa', () => {
  for (const cmd of ['dd if=/dev/zero of=/dev/sda', 'mkfs.ext4 /dev/sdb1']) {
    const r = destrutivo.classificar(cmd);
    assert.strictEqual(r.destrutivo, true, 'devia barrar: ' + cmd);
    assert.strictEqual(r.motivo, 'escrita direta de disco', cmd);
  }
  assert.strictEqual(destrutivo.classificar('echo dd').destrutivo, false);
});

// Colheita 10-20, item 18: `git commit --no-verify` (`-n`) e `--no-gpg-sign` pulavam a checagem do projeto em silencio.
test('item 18: commit sem gancho ou sem assinatura barra; mensagem, argumento e ultima opcao passam', () => {
  for (const cmd of [
    'git commit --no-verify -m "x"', 'git commit -n -m x', 'git commit -anm x', 'git commit --no-veri -m x',
    'git commit --no-gpg-sign -m x', 'git -C "a b" commit -n', 'git commit arquivo.txt -n',
    'cd repo && git commit -n -m x', 'git commit -S --no-gpg-sign', 'git commit "--no-verify" -m x',
    'git commit -nm"msg com espaco"'
  ]) {
    const r = destrutivo.classificar(cmd);
    assert.strictEqual(r.destrutivo, true, 'devia barrar: ' + cmd);
    assert.strictEqual(r.motivo, 'git commit --no-verify ou --no-gpg-sign pula a checagem do projeto', cmd);
  }
  for (const cmd of [
    'git commit -m "explica o --no-verify"', 'git commit -mnovo', 'git commit -m -n', 'git commit -n --verify -m x',
    'git commit --no-gpg-sign -S -m x', 'git commit --no-gpg-sign --gpg-sign=ABC -m x', 'git commit -Snome -m x', 'git log --grep commit -n 3',
    'git commit -m x -- -n', 'git commit -q -m x', 'git commit --message --no-verify',
    'git commit -n --veri -m x', 'git commit --no-verify --verif -m x', 'git commit --no-gpg-sign --gpg -m x',
    'git commit --no-gpg-sign --gp=ABC -m x'
  ]) {
    assert.strictEqual(destrutivo.classificar(cmd).destrutivo, false, 'devia passar: ' + cmd);
  }
});

// D420/SH-02 e TS-06: o portao e chamado como processo, como o gancho real.
function chamarPortaoDestrutivo(comando, tmpEstado, projetoJson, ferramenta) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-dest-cwd-'));
  try {
    if (projetoJson) {
      fs.mkdirSync(path.join(cwd, '.claude', 'sworn'), { recursive: true });
      fs.writeFileSync(path.join(cwd, '.claude', 'sworn', 'projeto.json'), JSON.stringify(projetoJson));
    }
    const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'portao-destrutivo.js')], {
      input: JSON.stringify({ session_id: 's-d420', cwd: cwd, tool_name: ferramenta || 'Bash', tool_input: { command: comando } }),
      encoding: 'utf8',
      env: Object.assign({}, process.env, { SWORN_TMP: tmpEstado })
    });
    let saida = null;
    try { saida = JSON.parse(r.stdout); } catch (e) { /* stdout vazio = permitiu */ }
    return saida;
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

test('D420/TS-06: padrao de regex INVALIDO em comandosLiberados nao libera nada (rm -rf segue negado)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-dest-ts06-'));
  try {
    const projeto = { comandosLiberados: ['(erro', 'nada-a-ver'] };
    const negado = chamarPortaoDestrutivo('rm -rf ./build', tmp, projeto);
    assert.ok(negado && negado.hookSpecificOutput, 'devia negar: ' + JSON.stringify(negado));
    assert.strictEqual(negado.hookSpecificOutput.permissionDecision, 'deny');
    // controle: um padrao valido na mesma lista continua liberando
    const livre = chamarPortaoDestrutivo('rm -rf ./build', tmp, { comandosLiberados: ['(erro', 'rm -rf \\./build'] });
    assert.strictEqual(livre, null, 'padrao valido devia liberar: ' + JSON.stringify(livre));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('D420/SH-02: estado nao gravavel nao libera o comando destrutivo (o contador e acessorio)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-dest-sh02-'));
  const arquivo = path.join(tmp, 'e-um-arquivo');
  fs.writeFileSync(arquivo, 'x');
  try {
    // SWORN_TMP aponta para um ARQUIVO: o mkdir do diretorio de estado lanca ENOTDIR
    // D486 (s108): o cd solto que o Bash corrige nao passa pelo contador; o que segue negado (fim em barra) passa
    for (const cmd of ['rm -rf ./build', 'git push --force origin main', 'cd .. && ls \\']) {
      const saida = chamarPortaoDestrutivo(cmd, arquivo);
      assert.ok(saida && saida.hookSpecificOutput, 'devia negar com o estado fora do ar: ' + cmd + ' -> ' + JSON.stringify(saida));
      assert.strictEqual(saida.hookSpecificOutput.permissionDecision, 'deny', cmd);
    }
    // o terceiro ramo com contador: idioma de shell errado (tabela do PowerShell, plataforma win32)
    const win = { plataforma: { so: 'win32', shell: 'powershell' } };
    const idioma = chamarPortaoDestrutivo('head -5 notas.txt', arquivo, win, 'PowerShell');
    assert.ok(idioma && idioma.hookSpecificOutput, 'idioma errado devia negar com o estado fora do ar: ' + JSON.stringify(idioma));
    assert.strictEqual(idioma.hookSpecificOutput.permissionDecision, 'deny');
    // controle: comando inofensivo segue livre com o estado fora do ar
    assert.strictEqual(chamarPortaoDestrutivo('npm test', arquivo), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('D721 A1-06/A1-08/A1-09: o padrao que nao compila sai listado; o motivo diz o efeito; o dono e o termo so', () => {
  const projeto = { comandosBloqueados: ['(', 'deploy-prod'] };
  const r = destrutivo.regrasRecusadas(projeto);
  assert.deepStrictEqual(r.map((x) => x.padrao), ['(']);
  assert.ok(r[0].causa, JSON.stringify(r));
  const t = destrutivo.avisoRecusadas(r);
  assert.ok(t.includes('"("') && t.includes('comandosBloqueados'), t);
  // o padrao enorme sai cortado em 400, como o comando no motivo
  const enorme = destrutivo.avisoRecusadas([{ padrao: '('.repeat(1000), causa: 'x' }]).split('\n')[2];
  assert.strictEqual(enorme, '  - "' + '('.repeat(400) + '": x');
  // controle: o padrao valido segue barrando, e sem a lista nada e recusado
  assert.strictEqual(destrutivo.classificar('deploy-prod agora', projeto).destrutivo, true);
  assert.deepStrictEqual(destrutivo.regrasRecusadas({}), []);
  assert.deepStrictEqual(destrutivo.regrasRecusadas(null), []);
  // A1-08: o motivo do DROP diz o que apaga, sem a sigla
  const drop = destrutivo.classificar('DROP TABLE clientes');
  assert.strictEqual(drop.destrutivo, true);
  assert.ok(!/DDL/.test(drop.motivo) && /apaga/.test(drop.motivo), drop.motivo);
  // A1-09: quem confirma e o dono, com um termo so
  const m = destrutivo.motivo('rm -rf x', { motivo: 'apaga' });
  assert.ok(!/confirmacao humana/.test(m) && m.includes('Nenhum comando destrutivo roda sem o sim do dono.'), m);
});
