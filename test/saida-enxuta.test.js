'use strict';
// H6a (15.1, D891): a saida verde de um executor de teste conhecido chega ao modelo so com o resumo e o caminho do log
// inteiro (.sworn/provas/), pelo updatedToolOutput do PostToolUse; o recibo de cada rodada (verde ou falha) fica no
// estado da sessao. Executor desconhecido, falha, pipe, segundo plano e saida pequena: nada se corta.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const enxuta = require('../scripts/lib/saida-enxuta.js');
const io = require('../scripts/lib/io.js');
const { pasta, rodar, ganchoComoProcesso } = require('./lib/comum.js');

// A saida do node --test (spec) com `n` testes verdes e o resumo do fim.
function saidaDoNode(n, falhas) {
  const linhas = [];
  for (let i = 0; i < n; i++) linhas.push('✔ o caso ' + i + ' da regra confere o valor (1.2ms)');
  const f = falhas || 0;
  return linhas.concat(['ℹ tests ' + (n + f), 'ℹ suites 0', 'ℹ pass ' + n, 'ℹ fail ' + f, 'ℹ cancelled 0',
    'ℹ skipped 0', 'ℹ todo 0', 'ℹ duration_ms 812.5']).join('\n');
}
const VERDE = saidaDoNode(120);

test('H6a: o node --test verde e grande sai so com as linhas do resumo', () => {
  const r = enxuta.resumir('node --test test/a.test.js', VERDE, null);
  assert.strictEqual(r.teste, true);
  assert.strictEqual(r.verde, true);
  assert.deepStrictEqual(r.resumo, ['ℹ tests 120', 'ℹ suites 0', 'ℹ pass 120', 'ℹ fail 0', 'ℹ cancelled 0',
    'ℹ skipped 0', 'ℹ todo 0', 'ℹ duration_ms 812.5']);
  assert.deepStrictEqual(r.executores, ['node --test']);
  // o tap do node (saida sem terminal) tambem, e o fim de linha do Windows nao atrapalha
  const tap = VERDE.replace(/^ℹ /gm, '# ').replace(/^✔ /gm, 'ok 1 - ').replace(/\n/g, '\r\n');
  assert.deepStrictEqual(enxuta.resumir('node --test', tap, null).resumo.slice(0, 4),
    ['# tests 120', '# suites 0', '# pass 120', '# fail 0']);
});

test('H6a: nada se corta com falha, pipe, saida pequena, executor desconhecido ou comando que nao e teste', () => {
  // falha no resumo (o codigo 0 nao basta: o pipe e o `|| true` o zeram)
  const vermelho = enxuta.resumir('node --test', saidaDoNode(120, 2), null);
  assert.strictEqual(vermelho.verde, false);
  assert.strictEqual(vermelho.resumo, undefined);
  // a marca de erro do npm, fora das linhas que nomeiam teste (evidencia.textoMostraFalha)
  const npm = enxuta.resumir('npm test', VERDE + '\nnpm ERR! code ELIFECYCLE', null);
  assert.strictEqual(npm.verde, false);
  assert.strictEqual(npm.resumo, undefined);
  // pipe, ponto e virgula, || e redirecao: o codigo de saida nao e o do executor
  for (const c of ['node --test | tail -5', 'node --test; echo fim', 'node --test || true', 'node --test > log.txt',
    'node --test & wait', 'node --test `x`', 'node --test $(x)', 'node --test\necho fim']) {
    const r = enxuta.resumir(c, VERDE, null);
    assert.strictEqual(r.teste, true, c);
    assert.strictEqual(r.resumo, undefined, c);
  }
  // o && e o 2>&1 mantem o codigo do executor
  assert.ok(enxuta.resumir('cd "a b" && node --test 2>&1', VERDE, null).resumo, 'o && e o 2>&1 cortam');
  // saida pequena: o log nao ganha nada
  assert.strictEqual(enxuta.resumir('node --test', saidaDoNode(3), null).resumo, undefined);
  // executor conhecido no comando, saida sem o resumo dele: nao corta
  assert.strictEqual(enxuta.resumir('node --test', 'x\n'.repeat(3000), null).resumo, undefined);
  // comando que nao e teste
  const ls = enxuta.resumir('ls -la', VERDE, null);
  assert.strictEqual(ls.teste, false);
  assert.strictEqual(ls.resumo, undefined);
});

test('H6a: npm test e a provaDePronto tentam todos os executores; o especifico so o dele', () => {
  // o npm test nao diz qual executor roda: vale o que a saida mostrar
  const mocha = 'linha de log\n'.repeat(300) + '  12 passing (30ms)\n  1 pending\n';
  assert.deepStrictEqual(enxuta.resumir('npm test', mocha, null).resumo, ['  12 passing (30ms)', '  1 pending']);
  // a provaDePronto declarada (e as formas equivalentes) e teste, mesmo sem nome de executor
  assert.ok(enxuta.resumir('./verificar.sh', VERDE, ['./verificar.sh']).resumo);
  assert.strictEqual(enxuta.resumir('./verificar.sh', VERDE, null).teste, false);
  // com o nome do jest no comando, o resumo do mocha na saida nao conta
  assert.strictEqual(enxuta.resumir('npx jest', mocha, null).resumo, undefined);
});

// Uma saida verde e uma vermelha de cada executor da tabela, com o recheio que a deixa grande.
const RECHEIO = 'PASS  src/caso.test.js\n'.repeat(200);
const EXECUTORES = [
  ['npx jest', 'Test Suites: 3 passed, 3 total\nTests:       2 skipped, 12 passed, 14 total\nSnapshots:   0 total\nTime:        1.2 s',
    'Test Suites: 1 failed, 2 passed, 3 total\nTests:       1 failed, 11 passed, 12 total'],
  ['npx vitest run', ' Test Files  3 passed (3)\n      Tests  12 passed (12)\n   Duration  1.20s',
    ' Test Files  1 failed | 2 passed (3)\n      Tests  1 failed | 11 passed (12)'],
  ['python -m pytest', '============================== 12 passed, 1 skipped in 0.42s ==============================',
    '========================= 1 failed, 11 passed in 0.42s ========================='],
  ['go test ./...', 'ok  \texemplo.com/a\t0.012s\nok  \texemplo.com/b\t(cached)\n?   \texemplo.com/c\t[no test files]',
    'ok  \texemplo.com/a\t0.012s\n--- FAIL: TestB (0.00s)\nFAIL\texemplo.com/b\t0.010s'],
  ['cargo test', 'test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s',
    'test result: FAILED. 11 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s'],
  ['dotnet test', 'Passed!  - Failed:     0, Passed:    12, Skipped:     0, Total:    12, Duration: 25 ms - A.dll (net8.0)',
    'Failed!  - Failed:     1, Passed:    11, Skipped:     0, Total:    12, Duration: 25 ms - A.dll (net8.0)'],
  ['dotnet test', 'Test summary: total: 12, failed: 0, succeeded: 12, skipped: 0, duration: 1.2s',
    'Test summary: total: 12, failed: 1, succeeded: 11, skipped: 0, duration: 1.2s'],
  ['mvn test', '[INFO] Tests run: 12, Failures: 0, Errors: 0, Skipped: 0\n[INFO] BUILD SUCCESS\n[INFO] Total time:  3.1 s',
    '[ERROR] Tests run: 12, Failures: 1, Errors: 0, Skipped: 0\n[INFO] BUILD FAILURE'],
  ['./gradlew test', 'BUILD SUCCESSFUL in 3s\n5 actionable tasks: 5 executed', 'BUILD FAILED in 3s'],
  ['npx mocha', '  12 passing (30ms)', '  11 passing (30ms)\n  1 failing']
];

test('H6a: cada executor da tabela corta o verde e deixa o vermelho inteiro', () => {
  for (const [comando, verde, vermelho] of EXECUTORES) {
    const r = enxuta.resumir(comando, RECHEIO + verde, null);
    assert.ok(Array.isArray(r.resumo) && r.resumo.length > 0, comando + ': ' + JSON.stringify(r));
    assert.ok(r.resumo.every((l) => (RECHEIO + verde).indexOf(l) !== -1), comando + ': a linha vem da saida');
    assert.strictEqual(r.resumo.indexOf('PASS  src/caso.test.js'), -1, comando + ': o recheio sai');
    const v = enxuta.resumir(comando, RECHEIO + vermelho, null);
    assert.strictEqual(v.resumo, undefined, comando + ' vermelho: ' + JSON.stringify(v));
    assert.strictEqual(v.verde, false, comando + ' vermelho');
  }
});

test('H6a: o maven e o gradle com algo no meio do comando, e a linha [WARNING] do maven com testes pulados', () => {
  for (const c of ['mvn clean test', 'mvn -q verify', 'mvnw.cmd test', './gradlew clean test', 'gradle.bat check']) {
    assert.strictEqual(enxuta.ehComandoDeTeste(c, null), true, c);
  }
  for (const c of ['mvn dependency:tree', 'mvn clean install', 'gradle build', 'mvn clean test-compile']) {
    assert.strictEqual(enxuta.ehComandoDeTeste(c, null), false, c);
  }
  const pulados = ['[WARNING] Tests run: 10, Failures: 0, Errors: 0, Skipped: 2', '[INFO] BUILD SUCCESS',
    '[INFO] Total time:  3.1 s'].join('\n');
  const r = enxuta.resumir('mvn clean test', RECHEIO + pulados, null);
  assert.strictEqual(r.resumo[0], '[WARNING] Tests run: 10, Failures: 0, Errors: 0, Skipped: 2', JSON.stringify(r));
});

test('H6a: a tabela que nao le (ausente, JSON quebrado, regex invalida) vira lista vazia, e nada se corta', () => {
  const dir = pasta('enxuta-tabela');
  const quebrado = path.join(dir, 'quebrado.json');
  fs.writeFileSync(quebrado, '{ "executores": [');
  const regex = path.join(dir, 'regex.json');
  fs.writeFileSync(regex, JSON.stringify({ executores: [{ nome: 'x', comandos: ['x'], resumo: ['('], verde: [], vermelho: [] }] }));
  assert.deepStrictEqual(enxuta.lerTabela(path.join(dir, 'nao-existe.json')), []);
  assert.deepStrictEqual(enxuta.lerTabela(quebrado), []);
  assert.deepStrictEqual(enxuta.lerTabela(regex), []);
  assert.ok(enxuta.lerTabela(path.join(__dirname, '..', 'modelos', 'resumidores.json')).length >= 10);
});

test('H6a: resumo com mais de 40 linhas nao corta (saida fora do comum)', () => {
  const linhas = (n) => Array.from({ length: n }, (_, i) => 'ok  \texemplo.com/p' + i + '\t0.01s').join('\n');
  assert.strictEqual(enxuta.resumir('go test ./...', RECHEIO + linhas(41), null).resumo, undefined);
  assert.strictEqual(enxuta.resumir('go test ./...', RECHEIO + linhas(40), null).resumo.length, 40);
});

test('H6a: o texto que vai ao modelo leva o resumo, o tamanho e o caminho do log, em ASCII fora do resumo', () => {
  const t = enxuta.textoAoModelo(['ℹ tests 3', 'ℹ fail 0'], { linhas: 441, bytes: 32290 }, 'C:/Meus Projetos/p/.sworn/provas/x.log');
  assert.ok(t.startsWith('ℹ tests 3\nℹ fail 0\n\n'), t);
  const nota = t.split('\n\n')[1];
  assert.ok(/^[\x20-\x7E]*$/.test(nota), nota);
  assert.ok(nota.indexOf('441 linhas') !== -1 && nota.indexOf('32290 bytes') !== -1, nota);
  // entre aspas: o caminho com espaco chega inteiro
  assert.ok(nota.indexOf('"C:/Meus Projetos/p/.sworn/provas/x.log"') !== -1, nota);
  // o resumo cortado nao pode parecer falha a quem le a saida depois (saude.testesDoTranscript)
  assert.strictEqual(require('../scripts/lib/evidencia.js').textoMostraFalha(t), false);
});

// ------------------------------------------------------------------ o gancho

function projeto(nome, extra) {
  const dir = pasta('enxuta-' + nome);
  fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify(Object.assign({
    provaDePronto: 'node --test test/*.test.js' }, extra || {})));
  return dir;
}
function entrada(dir, sid, comando, resposta, extra) {
  return Object.assign({ session_id: sid, cwd: dir, hook_event_name: 'PostToolUse', tool_name: 'PowerShell',
    tool_input: { command: comando }, tool_response: resposta }, extra || {});
}
const resposta = (stdout) => ({ stdout: stdout, stderr: '', interrupted: false, isImage: false });
function gancho(e, tmp, env) {
  const r = ganchoComoProcesso('scripts/recibo-da-prova.js', e, { cwd: e.cwd,
    env: Object.assign({}, process.env, { SWORN_TMP: tmp, SWORN_PONTE: '' }, env || {}) });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.json;
}
function recibos(tmp, sid) {
  const f = path.join(tmp, 'sworn', sid + '.json');
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')).recibos || []) : [];
}

test('H6a gancho: o verde sai cortado, com o log inteiro em .sworn/provas/ (que o git ignora) e o recibo', () => {
  const dir = projeto('verde');
  const tmp = pasta('enxuta-verde-tmp');
  const r = gancho(entrada(dir, 'v1', 'node --test test/*.test.js', resposta(VERDE)), tmp);
  const h = r.hookSpecificOutput;
  assert.strictEqual(h.hookEventName, 'PostToolUse');
  const u = h.updatedToolOutput;
  // a forma da saida do shell fica (a documentacao ignora a que nao casa), so o texto muda
  assert.deepStrictEqual(Object.keys(u).sort(), ['interrupted', 'isImage', 'stderr', 'stdout']);
  assert.strictEqual(u.stderr, '');
  assert.ok(u.stdout.startsWith('ℹ tests 120\n'), u.stdout);
  assert.ok(u.stdout.length < 600, 'cortou: ' + u.stdout.length);
  const provas = path.join(dir, '.sworn', 'provas');
  const logs = fs.readdirSync(provas).filter((f) => f.endsWith('.log'));
  assert.strictEqual(logs.length, 1);
  assert.strictEqual(fs.readFileSync(path.join(provas, '.gitignore'), 'utf8'), '*\n');
  const log = fs.readFileSync(path.join(provas, logs[0]), 'utf8');
  assert.ok(log.indexOf(VERDE) !== -1, 'o log tem a saida inteira');
  assert.ok(log.indexOf('node --test test/*.test.js') !== -1, 'e o comando');
  assert.ok(u.stdout.indexOf(path.join(provas, logs[0]).replace(/\\/g, '/')) !== -1, 'o caminho do log vai ao modelo');
  const [rec] = recibos(tmp, 'v1');
  assert.strictEqual(rec.verde, true);
  assert.strictEqual(rec.codigo, 0);
  assert.strictEqual(rec.cortado, true);
  assert.strictEqual(rec.comando, 'node --test test/*.test.js');
  assert.deepStrictEqual(rec.resumo.slice(0, 2), ['ℹ tests 120', 'ℹ suites 0']);
  assert.strictEqual(rec.bytes, Buffer.byteLength(VERDE));
  assert.ok(!Number.isNaN(Date.parse(rec.hora)), rec.hora);
});

test('H6a gancho: o segredo do comando e da saida nao vai ao log nem ao recibo', () => {
  const dir = projeto('segredo');
  const tmp = pasta('enxuta-segredo-tmp');
  const comando = 'node --test https://ana:s3nh4sup3r@exemplo.com/x';
  const r = gancho(entrada(dir, 'g1', comando, { stdout: ['Authorization: Bearer tok3nl0ng0abcdef', VERDE].join('\n'),
    stderr: 'Cookie: sessao=c00k13v4l0r', interrupted: false, isImage: false }), tmp);
  assert.ok(r && r.hookSpecificOutput.updatedToolOutput, JSON.stringify(r));
  const provas = path.join(dir, '.sworn', 'provas');
  const log = fs.readFileSync(path.join(provas, fs.readdirSync(provas).find((f) => f.endsWith('.log'))), 'utf8');
  for (const s of ['s3nh4sup3r', 'tok3nl0ng0abcdef', 'c00k13v4l0r']) assert.strictEqual(log.indexOf(s), -1, s + ' no log');
  assert.ok(log.indexOf(VERDE.slice(0, 200)) !== -1, 'o resto da saida fica');
  const [rec] = recibos(tmp, 'g1');
  assert.strictEqual(rec.comando.indexOf('s3nh4sup3r'), -1, rec.comando);
});

test('H6a gancho: o stderr entra no log e na conta, e sai da tela no verde', () => {
  const dir = projeto('stderr');
  const tmp = pasta('enxuta-stderr-tmp');
  const r = gancho(entrada(dir, 's1', 'npx jest', { stdout: '', stderr: RECHEIO + EXECUTORES[0][1],
    interrupted: false, isImage: false }), tmp);
  assert.ok(r.hookSpecificOutput.updatedToolOutput.stdout.startsWith('Test Suites: 3 passed'), JSON.stringify(r));
  assert.strictEqual(r.hookSpecificOutput.updatedToolOutput.stderr, '');
  const provas = path.join(dir, '.sworn', 'provas');
  const log = fs.readFileSync(path.join(provas, fs.readdirSync(provas).find((f) => f.endsWith('.log'))), 'utf8');
  assert.ok(log.indexOf(EXECUTORES[0][1]) !== -1);
});

test('H6a gancho: sem cortar, o recibo fica (vermelho, pequeno, chave desligada); sem projeto, segundo plano ou outra forma, nada', () => {
  const dir = projeto('sem-corte');
  const tmp = pasta('enxuta-sem-corte-tmp');
  // vermelho com codigo 0 (pipe): sem corte, recibo vermelho
  assert.strictEqual(gancho(entrada(dir, 'n1', 'node --test | tail', resposta(saidaDoNode(120, 1))), tmp), null);
  assert.deepStrictEqual(recibos(tmp, 'n1').map((x) => [x.verde, x.cortado]), [[false, false]]);
  // pequeno: verde, sem corte
  assert.strictEqual(gancho(entrada(dir, 'n2', 'node --test', resposta(saidaDoNode(2))), tmp), null);
  assert.deepStrictEqual(recibos(tmp, 'n2').map((x) => [x.verde, x.cortado, x.log]), [[true, false, null]]);
  // a chave desligada: recibo verde, sem corte e sem log
  const desligado = projeto('desligado', { saidaEnxuta: false });
  assert.strictEqual(gancho(entrada(desligado, 'n3', 'node --test', resposta(VERDE)), tmp), null);
  assert.deepStrictEqual(recibos(tmp, 'n3').map((x) => [x.verde, x.cortado]), [[true, false]]);
  assert.ok(!fs.existsSync(path.join(desligado, '.sworn')), 'sem log');
  // pela ponte (Codex, Qwen...): recibo, sem corte
  assert.strictEqual(gancho(entrada(dir, 'n4', 'node --test', resposta(VERDE)), tmp, { SWORN_PONTE: 'codex' }), null);
  assert.deepStrictEqual(recibos(tmp, 'n4').map((x) => x.cortado), [false]);
  // a saida em texto (a ponte do OpenCode): recibo sem o codigo, que o texto nao diz, e sem corte
  assert.strictEqual(gancho(entrada(dir, 'n7', 'node --test', VERDE), tmp), null);
  assert.deepStrictEqual(recibos(tmp, 'n7').map((x) => [x.verde, x.codigo, x.cortado, x.log]), [[true, null, false, null]]);
  assert.strictEqual(gancho(entrada(dir, 'n8', 'node --test', saidaDoNode(120, 1)), tmp), null);
  assert.deepStrictEqual(recibos(tmp, 'n8').map((x) => [x.verde, x.codigo]), [[false, null]]);
  // sem nada: o comando que nao e teste, o segundo plano, a interrompida e o projeto sem sworn
  assert.strictEqual(gancho(entrada(dir, 'n5', 'git status', resposta(VERDE)), tmp), null);
  assert.strictEqual(gancho(entrada(dir, 'n5', 'node --test', { stdout: '', stderr: '', interrupted: false,
    backgroundTaskId: 'b1' }, { tool_input: { command: 'node --test', run_in_background: true } }), tmp), null);
  // cada sinal do segundo plano basta sozinho: a marca no pedido, ou o id da tarefa na resposta
  assert.strictEqual(gancho(entrada(dir, 'n5', 'node --test', resposta(VERDE),
    { tool_input: { command: 'node --test', run_in_background: true } }), tmp), null);
  assert.strictEqual(gancho(entrada(dir, 'n5', 'node --test', Object.assign(resposta(VERDE), { backgroundTaskId: 'b2' })),
    tmp), null);
  assert.strictEqual(gancho(entrada(dir, 'n5', 'node --test', Object.assign(resposta(VERDE), { interrupted: true })), tmp), null);
  assert.deepStrictEqual(recibos(tmp, 'n5'), []);
  const semSworn = pasta('enxuta-sem-sworn');
  assert.strictEqual(gancho(entrada(semSworn, 'n6', 'node --test', resposta(VERDE)), tmp), null);
  assert.deepStrictEqual(recibos(tmp, 'n6'), []);
  assert.ok(!fs.existsSync(path.join(semSworn, '.sworn')), 'o projeto sem sworn nao ganha pasta');
});

test('H6a gancho: o PostToolUseFailure grava o recibo da falha com o codigo e nao devolve nada', () => {
  const dir = projeto('falha');
  const tmp = pasta('enxuta-falha-tmp');
  // a forma medida no Claude Code 2.1.328: sem tool_response, o `error` abre com "Exit code N"
  const e = { session_id: 'f1', cwd: dir, hook_event_name: 'PostToolUseFailure', tool_name: 'PowerShell',
    tool_input: { command: 'node --test test/*.test.js' }, error: 'Exit code 2\nℹ fail 1', is_interrupt: false };
  assert.strictEqual(gancho(e, tmp), null);
  const [rec] = recibos(tmp, 'f1');
  assert.deepStrictEqual([rec.verde, rec.codigo, rec.interrompido, rec.cortado, rec.log], [false, 2, false, false, null]);
  // interrompido ou sem o codigo: vermelho, codigo null
  assert.strictEqual(gancho(Object.assign({}, e, { session_id: 'f2', error: 'cancelado', is_interrupt: true }), tmp), null);
  // o interrompido nao tem codigo do executor, mesmo com o "Exit code" no erro
  assert.strictEqual(gancho(Object.assign({}, e, { session_id: 'f2', error: 'Exit code 130', is_interrupt: true }), tmp),
    null);
  assert.deepStrictEqual(recibos(tmp, 'f2').map((x) => [x.verde, x.codigo, x.interrompido]),
    [[false, null, true], [false, null, true]]);
  // o erro sem codigo e sem interrupcao (o tempo do shell que acabou) nao se confunde com a interrupcao
  assert.strictEqual(gancho(Object.assign({}, e, { session_id: 'f4', error: 'Command timed out after 2m 0s' }), tmp), null);
  assert.deepStrictEqual(recibos(tmp, 'f4').map((x) => [x.verde, x.codigo, x.interrompido]), [[false, null, false]]);
  // a falha de comando que nao e teste nao grava recibo
  assert.strictEqual(gancho(Object.assign({}, e, { session_id: 'f3', tool_input: { command: 'git push' } }), tmp), null);
  assert.deepStrictEqual(recibos(tmp, 'f3'), []);
  assert.ok(!fs.existsSync(path.join(dir, '.sworn')), 'a falha nao grava log: o erro chega inteiro ao modelo');
});

test('H6a gancho: guarda so os 20 logs mais novos e os 50 recibos mais novos', () => {
  const dir = projeto('teto');
  const tmp = pasta('enxuta-teto-tmp');
  const provas = path.join(dir, '.sworn', 'provas');
  fs.mkdirSync(provas, { recursive: true });
  for (let i = 0; i < 25; i++) fs.writeFileSync(path.join(provas, '2000-01-01T00-00-' + String(i).padStart(2, '0') + '.log'), 'velho');
  fs.writeFileSync(path.join(provas, 'meu-arquivo.txt'), 'do dono');
  fs.writeFileSync(path.join(provas, 'meu.log'), 'do dono, com o nome fora do padrao do sworn');
  const f = path.join(tmp, 'sworn', 't1.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ recibos: Array.from({ length: 50 }, (_, i) => ({ comando: 'r' + i })) }));
  gancho(entrada(dir, 't1', 'node --test', resposta(VERDE)), tmp);
  const logs = fs.readdirSync(provas).filter((n) => /^\d{4}-/.test(n)).sort();
  assert.strictEqual(logs.length, 20);
  assert.ok(logs.indexOf('2000-01-01T00-00-05.log') === -1 && logs.indexOf('2000-01-01T00-00-06.log') !== -1, logs.join());
  assert.ok(fs.existsSync(path.join(provas, 'meu-arquivo.txt')), 'o que nao e log do sworn fica');
  assert.ok(fs.existsSync(path.join(provas, 'meu.log')), 'o .log com outro nome fica');
  const rs = recibos(tmp, 't1');
  assert.strictEqual(rs.length, 50);
  assert.strictEqual(rs[0].comando, 'r1');
  assert.strictEqual(rs[49].comando, 'node --test');
});

test('H6a: o log que nao grava nao corta (sem o log, o modelo perderia a saida)', () => {
  const dir = projeto('sem-log');
  const tmp = pasta('enxuta-sem-log-tmp');
  // .sworn como arquivo: a pasta provas nao se cria
  fs.writeFileSync(path.join(dir, '.sworn'), 'arquivo no lugar da pasta');
  assert.strictEqual(gancho(entrada(dir, 'l1', 'node --test', resposta(VERDE)), tmp), null);
  assert.deepStrictEqual(recibos(tmp, 'l1').map((x) => [x.verde, x.cortado]), [[true, false]]);
});

test('H6a: o erro de disco no log volta null; o erro de programa sobe, nao some como falha de disco', () => {
  const { gravarLog } = require('../scripts/recibo-da-prova.js');
  const retomar = require('../scripts/lib/retomar.js');
  const r = { stdout: 'x', stderr: '' };
  const arquivo = pasta('enxuta-gravar-arquivo');
  fs.writeFileSync(path.join(arquivo, '.sworn'), 'arquivo no lugar da pasta');
  assert.strictEqual(gravarLog(arquivo, 'node --test', r, '2026-01-01T00:00:00.000Z'), null);
  const original = retomar.protegerPasta;
  retomar.protegerPasta = function () { throw new TypeError('protegerPasta mudou'); };
  try {
    assert.throws(() => gravarLog(pasta('enxuta-gravar-programa'), 'node --test', r, '2026-01-01T00:00:00.000Z'),
      /protegerPasta mudou/);
  } finally { retomar.protegerPasta = original; }
});

test('H6a: juntarSaidas leva o updatedToolOutput do 1o que o traz, junto do contexto dos outros', () => {
  const u = (s) => ({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: { stdout: s } } });
  const j = io.juntarSaidas([{ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'marcou' } },
    u('um'), u('dois')], 'PostToolUse');
  assert.deepStrictEqual(j, { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'marcou',
    updatedToolOutput: { stdout: 'um' } } });
});

// O depois-do-shell.js e o combinador (io.rodarJuntos fora do modo embutido): so roda como processo.
test('H6a: o depois-do-shell.js roda o recibo junto e devolve a saida cortada', () => {
  const dir = projeto('junto');
  const tmp = pasta('enxuta-junto-tmp');
  const r = rodar('scripts/depois-do-shell.js', [], { cwd: dir, env: { SWORN_TMP: tmp, SWORN_PONTE: '' },
    entrada: entrada(dir, 'j1', 'node --test', resposta(VERDE)) });
  assert.strictEqual(r.status, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.ok(json.hookSpecificOutput.updatedToolOutput.stdout.startsWith('ℹ tests 120'), r.stdout);
  assert.strictEqual(recibos(tmp, 'j1').length, 1);
});
