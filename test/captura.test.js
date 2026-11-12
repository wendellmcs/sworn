'use strict';
// E1 (D827): a captura de tela propria do sworn. A parte pura (scripts/lib/captura.js) roda em qualquer maquina; a
// ponta a ponta (scripts/capturar-tela.js) abre o Chrome ou o Edge de verdade e e pulada, com o motivo, onde nao ha
// navegador.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const captura = require('../scripts/lib/captura.js');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'capturar-tela.js');


test('lerArgs: o basico e os valores padrao', function () {
  const r = captura.lerArgs(['--url', 'https://exemplo.com/a', '--saida', 'out']);
  assert.deepStrictEqual(r.opcoes, { url: 'https://exemplo.com/a', saida: 'out', esperar: null, largura: 1280,
    altura: 800, tempoMax: 30000 });
  const r2 = captura.lerArgs(['--url', 'file:///C:/x/p.html', '--saida', 'o', '--largura', '390', '--altura', '844',
    '--esperar', '#app .pronto', '--tempo-max', '5000']);
  assert.deepStrictEqual(r2.opcoes, { url: 'file:///C:/x/p.html', saida: 'o', esperar: '#app .pronto', largura: 390,
    altura: 844, tempoMax: 5000 });
});

test('lerArgs: cada chamada errada diz o que consertar', function () {
  const casos = [
    [[], /falta --url/],
    [['--url', 'https://a.b'], /falta --saida/],
    [['--url'], /--url veio sem valor/],
    [['--url', '--saida', 'x'], /--url veio sem valor/],
    [['--url', 'https://a.b', '--saida', 'o', '--zoom', '2'], /argumento desconhecido "--zoom"/],
    [['constructor', 'x', '--url', 'https://a.b', '--saida', 'o'], /argumento desconhecido "constructor"/],
    [['--url', 'ftp://a.b/x', '--saida', 'o'], /precisa comecar com http:\/\/, https:\/\/ ou file:\/\/\/, e veio "ftp:\/\/a\.b\/x"/],
    [['--url', 'javascript:alert(1)', '--saida', 'o'], /precisa comecar com/],
    [['--url', 'https://a.b', '--saida', 'o', '--largura', '0'], /^--largura precisa ser um inteiro de 1 a 8000 px, veio "0"$/],
    [['--url', 'https://a.b', '--saida', 'o', '--altura', '-5'], /^--altura precisa ser um inteiro de 1 a 16000 px/],
    [['--url', 'https://a.b', '--saida', 'o', '--tempo-max', '1.5'],
      /^--tempo-max precisa ser um inteiro de 1 a 600000 ms, veio "1\.5" \(o padrao e 30000, meio minuto; o maximo, 10 minutos\)$/],
    [['--url', 'https://a.b', '--saida', 'o', '--altura', String(captura.ALTURA_MAXIMA + 1)],
      /^--altura precisa ser um inteiro de 1 a 16000 px, veio "16001" \(acima disso o Chrome nao grava a imagem\)$/],
    [['--url', 'https://a.b', '--saida', 'o', '--largura', String(captura.TETO_DA_LARGURA + 1)], /de 1 a 8000 px, veio "8001"$/],
    [['--url', 'https://a.b', '--saida', 'o', '--tempo-max', '9'.repeat(400)], /--tempo-max precisa ser um inteiro de 1 a 600000 ms/],
    [['--url', 'localhost:3000', '--saida', 'o'], /precisa comecar com/],
    [['--url', 'nao e url', '--saida', 'o'], /nao e um endereco valido: "nao e url" \(exemplo: http:\/\/localhost:3000\)$/],
    [['--url', 'ftp://u:s3' + '@h/?token=abc', '--saida', 'o'], /e veio "ftp:\/\/h\/\?token=\[segredo\]"$/],
    [['--url', 'http://[ruim?token=abc', '--saida', 'o'], /nao e um endereco valido: "http:\/\/\[ruim\?token=\[segredo\]"/],
  ];
  for (const [argv, re] of casos) {
    const r = captura.lerArgs(argv);
    assert.ok(r.erro && re.test(r.erro), JSON.stringify(argv) + ' -> ' + JSON.stringify(r));
  }
  const nosTetos = captura.lerArgs(['--url', 'https://a.b', '--saida', 'o', '--altura', String(captura.ALTURA_MAXIMA),
    '--largura', String(captura.TETO_DA_LARGURA), '--tempo-max', String(captura.TETO_DO_TEMPO)]).opcoes;
  assert.deepStrictEqual([nosTetos.altura, nosTetos.largura, nosTetos.tempoMax], [16000, 8000, 600000]);
});

test('candidatosDoNavegador: SWORN_NAVEGADOR sozinho; sem ele, o Chrome e o Edge de cada sistema', function () {
  assert.deepStrictEqual(captura.candidatosDoNavegador('win32', { SWORN_NAVEGADOR: 'D:\\nav.exe', PROGRAMFILES: 'C:\\PF' }),
    ['D:\\nav.exe']);
  assert.deepStrictEqual(captura.candidatosDoNavegador('linux', { SWORN_NAVEGADOR: '/opt/nav' }), ['/opt/nav']);
  const win = captura.candidatosDoNavegador('win32', { PROGRAMFILES: 'C:\\PF',
    'PROGRAMFILES(X86)': 'C:\\PF86', LOCALAPPDATA: 'C:\\U\\AppData\\Local' });
  assert.deepStrictEqual(win, ['C:\\PF\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\PF86\\Google\\Chrome\\Application\\chrome.exe', 'C:\\U\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\PF\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\U\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe']);
  assert.deepStrictEqual(captura.candidatosDoNavegador('win32', {}), [], 'sem as variaveis, nenhum caminho inventado');
  assert.ok(captura.candidatosDoNavegador('darwin', {})[0].startsWith('/Applications/Google Chrome.app/'));
  assert.ok(captura.candidatosDoNavegador('linux', {}).includes('/usr/bin/chromium'));
  assert.strictEqual(captura.acharNavegador(['a', 'b', 'c'], function (p) { return p !== 'a'; }), 'b');
  assert.strictEqual(captura.acharNavegador(['a'], function () { return false; }), null);
});

test('enderecoDoArquivo: so 127.0.0.1, e so com porta e caminho validos', function () {
  assert.strictEqual(captura.enderecoDoArquivo('51234\n/devtools/browser/ab-12\n'),
    'ws://127.0.0.1:51234/devtools/browser/ab-12');
  assert.strictEqual(captura.enderecoDoArquivo('51234\r\n/devtools/browser/ab-12'),
    'ws://127.0.0.1:51234/devtools/browser/ab-12');
  for (const ruim of ['', '51234', '51234\n', 'x\n/devtools/browser/a', '0\n/devtools/browser/a',
    '70000\n/devtools/browser/a', '51234\n/devtools/page/a', '51234\n/devtools/browser/a?x=1',
    '51234\nws://evil:1/devtools/browser/a']) {
    assert.strictEqual(captura.enderecoDoArquivo(ruim), null, JSON.stringify(ruim));
  }
});

test('entradaDeConsole e erroDaPagina: o texto de cada forma, cortado no teto', function () {
  assert.deepStrictEqual(captura.entradaDeConsole({ type: 'warning', args: [{ type: 'string', value: 'a' },
    { type: 'number', value: 2 }, { type: 'object', description: 'Object' }, { type: 'number', unserializableValue: 'NaN' },
    { type: 'undefined' }, { type: 'object', value: { x: 1 } }] }), { tipo: 'warning', texto: 'a 2 Object NaN undefined {"x":1}' });
  assert.deepStrictEqual(captura.entradaDeConsole({}), { tipo: 'log', texto: '' });
  // A entrada guarda o texto inteiro ate o teto bruto; o corte para o disco vem depois da limpeza.
  const longo = captura.entradaDeConsole({ type: 'log', args: [{ type: 'string', value: 'x'.repeat(900) }] });
  assert.strictEqual(longo.texto, 'x'.repeat(900));
  const enorme = captura.entradaDeConsole({ args: [{ type: 'string', value: 'x'.repeat(captura.TEXTO_BRUTO + 10) }] });
  assert.strictEqual(enorme.texto, 'x'.repeat(captura.TEXTO_BRUTO) + '...');
  assert.strictEqual(captura.textoParaODisco('x'.repeat(900)), 'x'.repeat(captura.TEXTO_MAXIMO) + '...');
  assert.deepStrictEqual(captura.erroDaPagina({ exceptionDetails: { text: 'Uncaught', lineNumber: 3, columnNumber: 14,
    url: 'file:///p.html', exception: { description: 'Error: quebrou' } } }),
  { texto: 'Error: quebrou', url: 'file:///p.html', linha: 4, coluna: 15 });
  assert.deepStrictEqual(captura.erroDaPagina({ exceptionDetails: { text: 'Uncaught' } }),
    { texto: 'Uncaught', url: '', linha: null, coluna: null });
  assert.deepStrictEqual(captura.erroDaPagina(undefined), { texto: 'erro sem texto', url: '', linha: null, coluna: null });
  assert.deepStrictEqual(captura.erroDoLog({ entry: { text: 'Failed to load resource', url: 'http://a/x.png', lineNumber: 0 } }),
    { texto: 'Failed to load resource', url: 'http://a/x.png', linha: 1, coluna: null });
  assert.deepStrictEqual(captura.erroDoLog({}), { texto: 'erro sem texto', url: '', linha: null, coluna: null });
});

test('resumirAcessibilidade: so o que alguem le ou usa, ate o teto', function () {
  const no = function (papel, nome, ignorado) { return { ignored: !!ignorado, role: { value: papel }, name: { value: nome } }; };
  const r = captura.resumirAcessibilidade([no('RootWebArea', 'Teste'), no('generic', ''), no('heading', ' Titulo '),
    no('button', 'Salvar'), no('StaticText', 'Salvar'), no('link', 'x', true), { role: {} }, null, no('textbox', '')]);
  assert.deepStrictEqual(r, { itens: [{ papel: 'heading', nome: 'Titulo' }, { papel: 'button', nome: 'Salvar' },
    { papel: 'textbox', nome: '' }], cortada: false });
  assert.deepStrictEqual(captura.resumirAcessibilidade(undefined), { itens: [], cortada: false });
  const muitos = Array.from({ length: captura.ITENS_MAXIMOS + 1 }, function (_, i) { return no('button', 'b' + i); });
  const c = captura.resumirAcessibilidade(muitos);
  assert.strictEqual(c.itens.length, captura.ITENS_MAXIMOS);
  assert.strictEqual(c.cortada, true);
  assert.strictEqual(captura.resumirAcessibilidade(muitos.slice(1)).cortada, false);
});

test('semSegredo: tira usuario e senha e troca o valor de parametro secreto, em qualquer texto', function () {
  // O usuario:senha@ montado por partes: escrito inteiro, a sanitacao da publicacao o le como e-mail.
  const comUsuario = 'https://ana:x1' + '@' + 'app.example/x?token=abc&pagina=2&api_key=k#topo';
  assert.strictEqual(captura.semSegredo(comUsuario), 'https://app.example/x?token=[segredo]&pagina=2&api_key=[segredo]#topo');
  assert.strictEqual(captura.semSegredo('at file:///C:/p/a.js?token=abc:4:15'), 'at file:///C:/p/a.js?token=[segredo]:4:15');
  assert.strictEqual(captura.semSegredo('?token=1.2:3'), '?token=[segredo]', 'so o par :linha:coluna fica de fora');
  assert.strictEqual(captura.semSegredo('?token=abc:123'), '?token=[segredo]');
  assert.strictEqual(captura.semSegredo('Authorization: Bearer eyJhbGc.x-y'), 'Authorization: Bearer [segredo]');
  assert.strictEqual(captura.semSegredo('basic dXNlcjpwYXNz'), 'basic [segredo]');
  assert.strictEqual(captura.semSegredo('{"token":"abc","nome":"ana"}'), '{"token":"[segredo]","nome":"ana"}');
  assert.strictEqual(captura.semSegredo("{'api_key': 'k'}"), "{'api_key': '[segredo]'}");
  assert.strictEqual(captura.semSegredo('token=abc no comeco'), 'token=[segredo] no comeco');
  assert.strictEqual(captura.semSegredo('senha=x e keyword=y'), 'senha=[segredo] e keyword=y');
  // O que nao e segredo fica: texto comum depois de Basic, e code curto de digitos (status, pagina).
  for (const fica of ['Basic authentication failed', 'Bearer token missing', 'Bearer v2 not set', '?code=404', 'code=200 ok',
    '{"code":"200"}']) {
    assert.strictEqual(captura.semSegredo(fica), fica, fica);
  }
  assert.strictEqual(captura.semSegredo('?code=4/0AY0e-g7abc'), '?code=[segredo]', 'o code de uma autorizacao e segredo');
  assert.strictEqual(captura.semSegredo('{"code":"x7Yq"}'), '{"code":"[segredo]"}');
  assert.strictEqual(captura.semSegredo('https://app.example/cb#access_token=abc123&state=9'),
    'https://app.example/cb#access_token=[segredo]&state=9');
  assert.strictEqual(captura.semSegredo('log: abri https://x.example?token=abc e voltei'),
    'log: abri https://x.example?token=[segredo] e voltei');
  for (const intacto of ['http://localhost:3000', 'http://localhost:3000/a?q=busca', 'file:///C:/p/pagina.html',
    'nao e url', '?keyword=botao&design=azul&encoded=1&passenger=2', '']) {
    assert.strictEqual(captura.semSegredo(intacto), intacto, intacto);
  }
  for (const nome of ['access_token', 'Senha', 'sessionid', 'X-Auth', 'code', 'sig', 'api.key', 'accesstoken',
    'client_secret', 'db-password']) {
    assert.strictEqual(captura.semSegredo('https://a.example/?' + nome + '=v'), 'https://a.example/?' + nome + '=[segredo]', nome);
  }
});

test('semSegredo: cabecalho Authorization, camelCase, JSON com aspa escapada e numero, code de PIN', function () {
  const casos = [
    ['Authorization: Bearer abcdefghijkl', 'Authorization: Bearer [segredo]'],
    ['authorization=xyz123', 'authorization=[segredo]'],
    ['Authorization: Basic dXNlcjpwYXNz', 'Authorization: Basic [segredo]'],
    ['cfg?secretKey=sk_live_abc123', 'cfg?secretKey=[segredo]'],
    ['?accessKey=k1', '?accessKey=[segredo]'],
    ['?keyword=x&monkey=y', '?keyword=x&monkey=y'],
    ['{"password":"ab\\"cd1234","nome":"ana"}', '{"password":"[segredo]","nome":"ana"}'],
    ['{"otp": 123456}', '{"otp": "[segredo]"}'],
    ['{"page": 2}', '{"page": 2}'],
    ['?code=1234', '?code=[segredo]'],
    ['{"code": 200}', '{"code": 200}'],
    ['Cookie: sid=abc; tema=escuro', 'Cookie: [segredo]'],
    ['set-cookie: sessao=xyz; Path=/\nproxima linha', 'set-cookie: [segredo]\nproxima linha'],
  ];
  for (const [entra, sai] of casos) assert.strictEqual(captura.semSegredo(entra), sai, entra);
});

test('consoleEErrosSemSegredo: o segredo sai do console e da pilha dos erros, e lista ausente vira vazia', function () {
  const u = 'file:///C:/p/pagina.html?token=abc';
  const limpo = 'file:///C:/p/pagina.html?token=[segredo]';
  const r = captura.consoleEErrosSemSegredo([{ tipo: 'log', texto: 'abri ' + u + ' e ' + u }],
    [{ texto: 'Error: x\n    at ' + u + ':4:15', url: u, linha: 4, coluna: 15 }, { texto: 'sem url', url: '', linha: null, coluna: null }]);
  assert.deepStrictEqual(r, { console: [{ tipo: 'log', texto: 'abri ' + limpo + ' e ' + limpo }],
    erros: [{ texto: 'Error: x\n    at ' + limpo + ':4:15', url: limpo, linha: 4, coluna: 15 },
      { texto: 'sem url', url: '', linha: null, coluna: null }] });
  assert.deepStrictEqual(captura.consoleEErrosSemSegredo(undefined, null), { console: [], erros: [] });
  assert.deepStrictEqual(captura.consoleEErrosSemSegredo([null, { tipo: 'warning' }], [undefined, {}]),
    { console: [{ tipo: 'warning', texto: '' }], erros: [{ texto: '', url: '' }] });
  assert.deepStrictEqual(captura.consoleEErrosSemSegredo([{}], []).console, [{ tipo: 'log', texto: '' }]);
});

test('saidaDoScript: JSON com 0; ERRO com 1, e o aviso na linha de baixo quando existe', function () {
  assert.deepStrictEqual(captura.saidaDoScript({ ok: true, a: 1 }), { texto: '{"ok":true,"a":1}\n', codigo: 0 });
  assert.deepStrictEqual(captura.saidaDoScript({ erro: 'x' }), { texto: 'ERRO: x\n', codigo: 1 });
  assert.deepStrictEqual(captura.saidaDoScript({ erro: 'x', aviso: 'perfil preso' }),
    { texto: 'ERRO: x\naviso: perfil preso\n', codigo: 1 });
  assert.deepStrictEqual(captura.saidaDoScript(undefined), { texto: 'ERRO: a captura parou sem resultado: rode de novo, e ' +
    'se repetir confira o navegador (SWORN_NAVEGADOR)\n', codigo: 1 });
});

test('juntarAvisos: o aviso novo soma ao que ja havia, sem apagar', function () {
  assert.strictEqual(captura.juntarAvisos(undefined, 'b'), 'b');
  assert.strictEqual(captura.juntarAvisos('', 'b'), 'b');
  assert.strictEqual(captura.juntarAvisos('o servidor respondeu 404', 'pasta presa'), 'o servidor respondeu 404; pasta presa');
});

test('textoParaODisco: o corte no teto nao parte um emoji ao meio', function () {
  assert.strictEqual(captura.textoParaODisco('a'.repeat(captura.TEXTO_MAXIMO - 1) + '😀' + 'b'),
    'a'.repeat(captura.TEXTO_MAXIMO - 1) + '...');
  assert.strictEqual(captura.textoParaODisco('a'.repeat(captura.TEXTO_MAXIMO - 2) + '😀' + 'b'),
    'a'.repeat(captura.TEXTO_MAXIMO - 2) + '😀...');
});

test('textoParaODisco: o segredo que atravessa o corte e limpo antes de cortar', function () {
  const texto = 'x'.repeat(480) + '{"password":"hunter2' + 'y'.repeat(100) + '"}';
  const limpo = captura.consoleEErrosSemSegredo([captura.entradaDeConsole({ args: [{ type: 'string', value: texto }] })], [])
    .console[0].texto;
  assert.ok(!limpo.includes('hunter2'), limpo.slice(470));
  assert.ok(limpo.length <= captura.TEXTO_MAXIMO + 3);
  assert.strictEqual(captura.semSegredo('{"password":"abc'), '{"password":"[segredo]"', 'JSON cortado sem a aspa final');
  const nome = captura.textoParaODisco('x'.repeat(490) + ' token=abc123def');
  assert.ok(!nome.includes('abc'), nome.slice(480));
  // O token Bearer partido pelo corte fica curto demais para parecer credencial: so a limpeza antes do corte o pega.
  const partido = captura.textoParaODisco('x'.repeat(490) + ' Bearer ab1234567890');
  assert.ok(!partido.includes('ab1'), partido.slice(480));
  assert.ok(!/Bearer ab/.test(partido), partido.slice(480));
});

test('alturaDaFoto: a pagina inteira, nunca menos que a janela, ate o limite', function () {
  assert.deepStrictEqual(captura.alturaDaFoto(2500.4, 800), { altura: 2501, cortada: false });
  assert.deepStrictEqual(captura.alturaDaFoto(300, 800), { altura: 800, cortada: false });
  assert.deepStrictEqual(captura.alturaDaFoto(undefined, 800), { altura: 800, cortada: false });
  assert.deepStrictEqual(captura.alturaDaFoto(100, undefined), { altura: captura.PADRAO.altura, cortada: false });
  assert.deepStrictEqual(captura.alturaDaFoto(captura.ALTURA_MAXIMA, 800), { altura: captura.ALTURA_MAXIMA, cortada: false });
  assert.deepStrictEqual(captura.alturaDaFoto(40000, 800), { altura: captura.ALTURA_MAXIMA, cortada: true });
});

// ---------------------------------------------------------------- ponta a ponta, com o navegador de verdade

const NAVEGADOR = captura.acharNavegador(captura.candidatosDoNavegador(process.platform, process.env),
  function (p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });

function pastaTemporaria(t) {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sworn-teste-captura-'));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

// No Windows o nome da variavel nao diferencia maiuscula: a de fora (ProgramFiles) tem de sair antes de a do teste
// (PROGRAMFILES) entrar, senao o processo filho recebe as duas.
function ambiente(env) {
  const extra = env || {};
  const trocadas = new Set(Object.keys(extra).map(function (k) { return k.toUpperCase(); }));
  const base = {};
  for (const [k, v] of Object.entries(process.env)) if (!trocadas.has(k.toUpperCase())) base[k] = v;
  return Object.assign(base, extra);
}

function rodar(args, env) {
  return spawnSync(process.execPath, [SCRIPT].concat(args), { encoding: 'utf8', timeout: 180000, env: ambiente(env) });
}

// No Windows, os PIDs dos processos que ainda citam a pasta do teste na linha de comando: o navegador, o processo de
// relatorio de falhas dele (sobrevive ao pai se so o pai cair) e a limpeza em segundo plano. A lista vem do sistema, e
// nao do script que esta sendo conferido. Fora do Windows, a varredura nao se aplica e a lista sai vazia.
function processosQueSobraram(dir) {
  if (process.platform !== 'win32') return [];
  const nome = path.basename(dir).replace(/'/g, "''");
  const r = spawnSync('powershell', ['-NoProfile', '-Command', "'pids:' + ((Get-CimInstance Win32_Process | Where-Object { " +
    "$_.CommandLine -and $_.CommandLine.Contains('" + nome + "') -and $_.Name -ne 'powershell.exe' } | " +
    "ForEach-Object { $_.ProcessId }) -join ',')"],
  { encoding: 'utf8', timeout: 30000, windowsHide: true });
  return pidsDaVarredura(String(r.stdout || '').trim(), r.error);
}

// A saida da varredura: a marca `pids:` e os numeros separados por virgula (nenhum, quando nada sobrou). Sem a marca
// e a lista inteira, a varredura nao foi feita: falha alto, nunca conta como lista vazia.
function pidsDaVarredura(texto, erro) {
  const lista = /^pids:((?:\d+(?:,\d+)*)?)$/.exec(texto);
  if (!lista) throw new Error('o PowerShell nao listou os processos: ' + JSON.stringify(texto) + ' ' + erro);
  return lista[1] ? lista[1].split(',').map(Number) : [];
}

function perfisQueSobraram(dir) {
  return fs.readdirSync(dir).filter(function (n) { return n.startsWith('sworn-captura-'); });
}

// O processo com esse PID ainda existe? Sem permissao para perguntar (EPERM), existe. `sinal` e o process.kill, ou o
// de mentira do teste.
function vivo(pid, sinal) {
  try { (sinal || process.kill)(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

const PRAZO_DAS_SOBRAS = 120000;
const ENTRE_VARREDURAS = 10000;
const PASSO_DAS_SOBRAS = 100;

// Nada sobra: nem perfil temporario, nem processo citando a pasta do teste. Quando o Windows segura o perfil, a
// captura deixa a limpeza em segundo plano: espera ate 2 minutos por ela. F1b: a espera e pelo PID (`o.vivo`, sem abrir
// processo) e pela pasta, a cada 100 ms. A varredura do sistema (`o.processos`, um PowerShell inteiro, antes repetido a
// cada 2 s) fica para o comeco, para quando tudo o que ela viu ja saiu e, enquanto algo demora, para uma vez a cada
// 10 s: o PID que o sistema deu a outro processo nao segura a espera ate o prazo. Ha sempre uma pausa entre duas.
// `o`: { agora, pausar(ms), processos() -> PIDs, perfis() -> nomes, vivo(pid) }.
function esperarSemSobras(o) {
  const fim = o.agora() + PRAZO_DAS_SOBRAS;
  for (;;) {
    const processos = o.processos();
    let perfis = o.perfis();
    if ((perfis.length === 0 && processos.length === 0) || o.agora() >= fim) return { perfis: perfis, processos: processos };
    const proxima = Math.min(fim, o.agora() + ENTRE_VARREDURAS);
    do {
      o.pausar(PASSO_DAS_SOBRAS);
      perfis = o.perfis();
    } while (o.agora() < proxima && (perfis.length > 0 || processos.some(function (pid) { return o.vivo(pid); })));
  }
}

function assertSemSobras(tmp, dir, saidaDoScript) {
  const pausa = new Int32Array(new SharedArrayBuffer(4));
  const sobra = esperarSemSobras({
    agora: Date.now,
    pausar: function (ms) { Atomics.wait(pausa, 0, 0, ms); },
    processos: function () { return processosQueSobraram(dir); },
    perfis: function () { return perfisQueSobraram(tmp); },
    vivo: function (pid) { return vivo(pid); },
  });
  assert.deepStrictEqual(sobra, { perfis: [], processos: [] }, 'sobrou perfil ou processo; o script disse: ' + saidaDoScript);
}

// F1b: a espera com relogio de mentira. `c.processos(t)` e o que a varredura do sistema devolve no instante t,
// `c.perfis(t)` os perfis na pasta e `c.vivo(pid, t)` se o PID ainda existe. Devolve o resultado, o instante de cada
// varredura e o instante do fim.
function cenaDasSobras(c) {
  let t = 0;
  const varreduras = [];
  const r = esperarSemSobras({
    agora: function () { return t; },
    pausar: function (ms) { t += ms; },
    processos: function () { varreduras.push(t); return c.processos(t); },
    perfis: function () { return c.perfis(t); },
    vivo: function (pid) { return c.vivo(pid, t); },
  });
  return { r: r, varreduras: varreduras, fim: t };
}

test('F1b: esperarSemSobras varre o sistema no comeco e depois que tudo saiu; no meio, espera pelo PID e pela pasta', function () {
  const nada = function () { return []; };
  const limpo = { perfis: [], processos: [] };
  // Tudo limpo: uma varredura, nenhuma espera.
  assert.deepStrictEqual(cenaDasSobras({ processos: nada, perfis: nada, vivo: function () { return false; } }),
    { r: limpo, varreduras: [0], fim: 0 });
  // O navegador (PID 7) sai aos 3 s e o perfil some aos 3,5 s: a 2a varredura so vem quando os dois sairam.
  assert.deepStrictEqual(cenaDasSobras({
    processos: function (t) { return t < 3000 ? [7] : []; },
    perfis: function (t) { return t < 3500 ? ['sworn-captura-a'] : []; },
    vivo: function (pid, t) { return pid === 7 && t < 3000; },
  }), { r: limpo, varreduras: [0, 3500], fim: 3500 });
  // Sem perfil, dois processos: a espera vai ate o ultimo PID sair (o 9, aos 1,2 s), nao ate o primeiro.
  assert.deepStrictEqual(cenaDasSobras({
    processos: function (t) { return t < 1200 ? [7, 9] : []; },
    perfis: nada,
    vivo: function (pid, t) { return t < (pid === 7 ? 400 : 1200); },
  }), { r: limpo, varreduras: [0, 1200], fim: 1200 });
  // O PID que o sistema deu a outro processo (vivo para sempre) nao segura a espera ate o prazo: a varredura volta
  // aos 10 s, e quem decide e ela.
  assert.deepStrictEqual(cenaDasSobras({
    processos: function (t) { return t < 500 ? [7] : []; },
    perfis: nada,
    vivo: function () { return true; },
  }), { r: limpo, varreduras: [0, 10000], fim: 10000 });
  // O que nunca sai: no prazo de 2 minutos devolve o que sobrou, com uma varredura a cada 10 s (13, nao 60).
  const preso = cenaDasSobras({ processos: function () { return [7]; }, perfis: function () { return ['sworn-captura-a']; },
    vivo: function () { return true; } });
  assert.deepStrictEqual(preso.r, { perfis: ['sworn-captura-a'], processos: [7] });
  assert.deepStrictEqual(preso.varreduras, [0, 10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000,
    110000, 120000]);
  assert.strictEqual(preso.fim, 120000);
  // O perfil preso sem processo nenhum tambem espera (pela pasta) e tambem para no prazo.
  const soPerfil = cenaDasSobras({ processos: nada, perfis: function () { return ['sworn-captura-b']; },
    vivo: function () { return false; } });
  assert.deepStrictEqual(soPerfil.r, { perfis: ['sworn-captura-b'], processos: [] });
  assert.strictEqual(soPerfil.varreduras.length, 13);
  // A varredura que ainda lista quem ja saiu (o sistema atrasado) nao vira laco apertado: ha uma pausa entre duas.
  assert.deepStrictEqual(cenaDasSobras({
    processos: function (t) { return t < 300 ? [7] : []; },
    perfis: nada,
    vivo: function () { return false; },
  }), { r: limpo, varreduras: [0, 100, 200, 300], fim: 300 });
  // O prazo nao e ultrapassado quando as varreduras nao caem em multiplos de 10 s: o PID sai, a varredura dos 100 ms
  // ainda o lista e o sistema o da a outro processo; a ultima varredura e a dos 2 minutos, nao a dos 2 min e 100 ms.
  const desalinhado = cenaDasSobras({ processos: function () { return [7]; }, perfis: nada,
    vivo: function (pid, t) { return t > 100; } });
  assert.deepStrictEqual(desalinhado.varreduras, [0, 100, 10100, 20100, 30100, 40100, 50100, 60100, 70100, 80100, 90100,
    100100, 110100, 120000]);
  assert.strictEqual(desalinhado.fim, 120000);
  // Cada PID e perguntado sozinho: o `vivo` nao recebe a posicao dele na lista.
  const perguntas = [];
  esperarSemSobras({ agora: function () { return perguntas.length; }, pausar: function () {},
    processos: function () { return perguntas.length ? [] : [7, 9]; }, perfis: nada,
    vivo: function () { perguntas.push(Array.prototype.slice.call(arguments)); return false; } });
  assert.deepStrictEqual(perguntas, [[7], [9]]);
});

test('F1b: pidsDaVarredura le a lista da varredura e falha alto sem ela', function () {
  assert.deepStrictEqual(pidsDaVarredura('pids:'), []);
  assert.deepStrictEqual(pidsDaVarredura('pids:412'), [412]);
  assert.deepStrictEqual(pidsDaVarredura('pids:412,7,10244'), [412, 7, 10244]);
  // Saida vazia (o PowerShell caiu ou estourou o prazo), cortada ou com outro texto: nunca vira "nada sobrou".
  ['', 'pids', 'pids:412,', 'pids:,7', 'pids:4 12', 'Get-CimInstance : Acesso negado', 'aviso\npids:', 'pids:\n12'].forEach(function (ruim) {
    assert.throws(function () { pidsDaVarredura(ruim, 'ETIMEDOUT'); }, /nao listou os processos[^]*ETIMEDOUT/, JSON.stringify(ruim));
  });
});

test('F1b: vivo diz se o PID ainda existe', function () {
  assert.strictEqual(vivo(process.pid), true);
  // O processo de verdade que ja saiu fica no teste em fila, abaixo: aqui, com a suite inteira abrindo processos ao
  // lado, o sistema pode dar o PID dele a outro antes da pergunta. Com o sinal de mentira: so a falta de permissao
  // (EPERM) conta como vivo; o sinal vai para o PID pedido, com 0.
  const recusa = function (codigo) { return function () { throw Object.assign(new Error(codigo), { code: codigo }); }; };
  assert.strictEqual(vivo(7, recusa('EPERM')), true);
  assert.strictEqual(vivo(7, recusa('ESRCH')), false);
  const pedidos = [];
  assert.strictEqual(vivo(7, function () { pedidos.push(Array.prototype.slice.call(arguments)); }), true);
  assert.deepStrictEqual(pedidos, [[7, 0]]);
});

// Fora da rodada padrao pelo nome (ponta a ponta): a varredura abre um PowerShell inteiro, que sob a carga da suite
// demora o bastante para estourar o prazo dela.
test('ponta a ponta (F1b): processosQueSobraram lista o PID de quem cita a pasta, e o vivo ve a saida dele', async function (t) {
  if (process.platform !== 'win32') { t.skip('a varredura de processos so existe no Windows'); return; }
  const dir = pastaTemporaria(t);
  assert.deepStrictEqual(processosQueSobraram(dir), []);
  const filho = execFile(process.execPath, ['-e', 'setTimeout(function () {}, 120000)', path.basename(dir)], function () {});
  const saiu = new Promise(function (r) { filho.on('exit', r); });
  t.after(function () { filho.kill(); });
  assert.deepStrictEqual(processosQueSobraram(dir), [filho.pid]);
  assert.strictEqual(vivo(filho.pid), true);
  filho.kill();
  await saiu;
  assert.strictEqual(vivo(filho.pid), false);
  assert.deepStrictEqual(processosQueSobraram(dir), []);
});

test('ponta a ponta: foto da pagina inteira, console, erro da pagina, arvore e nada sobrando', function (t) {
  if (!NAVEGADOR) { t.skip('sem Chrome nem Edge nesta maquina'); return; }
  const dir = pastaTemporaria(t);
  const tmp = path.join(dir, 'tmp');
  fs.mkdirSync(tmp);
  const pagina = path.join(dir, 'pagina.html');
  fs.writeFileSync(pagina, '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>T</title></head>' +
    '<body style="margin:0"><h1>Titulo da tela</h1><button>Salvar</button><button>Copiar token=abc</button>' +
    '<div style="height:2400px"></div>' +
    '<script>console.log("ola", 42); console.error("ruim");</script><script>throw new Error("quebrou");</script>' +
    '</body></html>');
  const saida = path.join(dir, 'saida');
  const r = rodar(['--url', pathToFileURL(pagina).href + '?token=abc', '--saida', saida, '--largura', '800',
    '--altura', '600', '--tempo-max', '120000'], { SWORN_TMP: tmp });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const fim = JSON.parse(r.stdout);
  const bytes = fs.readFileSync(fim.imagem);
  assert.deepStrictEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'nao e PNG');
  assert.strictEqual(fim.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.strictEqual(bytes.readUInt32BE(16), 800, 'largura do PNG');
  const e = JSON.parse(fs.readFileSync(fim.evidencia, 'utf8'));
  assert.ok(bytes.readUInt32BE(20) >= 2400 && bytes.readUInt32BE(20) === e.altura, 'a foto pega a pagina inteira');
  assert.strictEqual(e.sha256, fim.sha256);
  assert.strictEqual(e.cortada, false);
  assert.ok(!JSON.stringify(e).includes('abc'), 'o token da URL foi para a evidencia');
  assert.match(e.url, /\?token=\[segredo\]$/);
  assert.match(e.urlFinal, /\?token=\[segredo\]$/);
  assert.match(e.erros[0].texto, /token=\[segredo\]/, 'a pilha do erro traz o endereco limpo');
  assert.deepStrictEqual(e.console, [{ tipo: 'log', texto: 'ola 42' }, { tipo: 'error', texto: 'ruim' }]);
  assert.strictEqual(e.erros.length, 1);
  assert.match(e.erros[0].texto, /quebrou/);
  assert.ok(e.acessibilidade.itens.some(function (i) { return i.papel === 'button' && i.nome === 'Salvar'; }));
  assert.ok(e.acessibilidade.itens.some(function (i) { return i.papel === 'heading' && i.nome === 'Titulo da tela'; }));
  assert.match(e.navegador, /Chrome|Edg/);
  assert.ok(!Number.isNaN(Date.parse(e.hora)));
  assertSemSobras(tmp, dir, r.stdout);
});

test('ponta a ponta: --esperar espera o seletor que aparece depois, e falha no prazo o que nunca aparece', function (t) {
  if (!NAVEGADOR) { t.skip('sem Chrome nem Edge nesta maquina'); return; }
  const dir = pastaTemporaria(t);
  const tmp = path.join(dir, 'tmp');
  fs.mkdirSync(tmp);
  const pagina = path.join(dir, 'tarde.html');
  fs.writeFileSync(pagina, '<!doctype html><body><script>setTimeout(function () { var b = document.createElement("button"); ' +
    'b.className = "pronto"; b.textContent = "Carregou"; document.body.appendChild(b); }, 400);</script></body>');
  const ok = rodar(['--url', pathToFileURL(pagina).href, '--saida', path.join(dir, 's1'), '--esperar', '.pronto',
    '--tempo-max', '120000'], { SWORN_TMP: tmp });
  assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
  const e = JSON.parse(fs.readFileSync(JSON.parse(ok.stdout).evidencia, 'utf8'));
  assert.ok(e.acessibilidade.itens.some(function (i) { return i.nome === 'Carregou'; }), 'a foto saiu antes do seletor');
  const nunca = rodar(['--url', pathToFileURL(pagina).href, '--saida', path.join(dir, 's2'), '--esperar', '.nunca',
    '--tempo-max', '6000'], { SWORN_TMP: tmp });
  // O prazo vale tambem para a pagina responder: com 1500 ms, a suite inteira (maquina carregada) fazia a pagina
  // estourar o prazo antes do seletor, e o teste caia na mensagem errada. 6000 ms cobre a carga; o seletor nunca vem.
  assert.strictEqual(nunca.status, 1);
  assert.match(nunca.stdout, /^ERRO: o seletor "\.nunca" nao apareceu em 6000 ms/);
  const invalido = rodar(['--url', pathToFileURL(pagina).href, '--saida', path.join(dir, 's3'), '--esperar', '##x'],
    { SWORN_TMP: tmp });
  assert.strictEqual(invalido.status, 1);
  assert.match(invalido.stdout, /^ERRO: --esperar nao e um seletor CSS valido/);
  assertSemSobras(tmp, dir, ok.stdout + nunca.stdout + invalido.stdout);
});

test('ponta a ponta: pagina que nao abre, navegador que nao existe e chamada errada saem com ERRO', function (t) {
  const dir = pastaTemporaria(t);
  const errada = rodar(['--url', 'https://a.b']);
  assert.strictEqual(errada.status, 1);
  assert.match(errada.stdout, /^ERRO: falta --saida/);
  const apontado = path.join(dir, 'nao-existe.exe');
  const semNavegador = rodar(['--url', 'https://a.b', '--saida', path.join(dir, 'x')], { SWORN_NAVEGADOR: apontado });
  assert.strictEqual(semNavegador.status, 1);
  assert.strictEqual(semNavegador.stdout, 'ERRO: SWORN_NAVEGADOR aponta para "' + apontado + '", que nao existe. ' +
    'Corrija o caminho ou apague a variavel para o sworn procurar o Chrome ou o Edge.\n');
  assert.ok(!fs.existsSync(path.join(dir, 'x')), 'criou a pasta de saida sem ter navegador');
  if (!NAVEGADOR) { t.skip('sem Chrome nem Edge nesta maquina'); return; }
  const tmp = path.join(dir, 'tmp');
  fs.mkdirSync(tmp);
  const tmpQueNaoExiste = path.join(dir, 'nao-existe-tmp');
  const semTmp = rodar(['--url', 'https://a.b', '--saida', path.join(dir, 's0')], { SWORN_TMP: tmpQueNaoExiste });
  assert.strictEqual(semTmp.status, 1);
  assert.match(semTmp.stdout, /^ERRO: a pasta temporaria ".*nao-existe-tmp" nao existe \(ENOENT\): corrija SWORN_TMP/);
  const arquivo = path.join(dir, 'um-arquivo.txt');
  fs.writeFileSync(arquivo, 'x');
  const saidaArquivo = rodar(['--url', 'https://a.b', '--saida', arquivo], { SWORN_TMP: tmp });
  assert.strictEqual(saidaArquivo.status, 1);
  assert.match(saidaArquivo.stdout, /^ERRO: --saida nao pode ser usada como pasta: ".*um-arquivo\.txt" \(EEXIST\)/);
  const ausente = rodar(['--url', pathToFileURL(path.join(dir, 'nao-existe.html')).href, '--saida', path.join(dir, 's'),
    '--tempo-max', '120000'], { SWORN_TMP: tmp });
  assert.strictEqual(ausente.status, 1);
  assert.match(ausente.stdout, /^ERRO: a pagina nao abriu \(net::ERR_FILE_NOT_FOUND\)/);
  assertSemSobras(tmp, dir, ausente.stdout);
});

test('--limpar-perfil: apaga so um perfil sworn-captura- e recusa outro caminho', function (t) {
  const dir = pastaTemporaria(t);
  const tmp = fs.realpathSync.native(dir);
  // Dentro da pasta temporaria, mas sem o nome sworn-captura-: fica.
  const outro = path.join(tmp, 'meus-arquivos');
  fs.mkdirSync(outro);
  const recusa = rodar(['--limpar-perfil', outro], { SWORN_TMP: tmp });
  assert.strictEqual(recusa.status, 1);
  assert.match(recusa.stdout, /^ERRO: --limpar-perfil so apaga um perfil sworn-captura- da pasta temporaria/);
  assert.ok(fs.existsSync(outro), 'apagou uma pasta que nao e perfil da captura');
  assert.strictEqual(rodar(['--limpar-perfil'], { SWORN_TMP: tmp }).status, 1);
  // Nome certo, pasta errada: um sworn-captura- fora da pasta temporaria fica.
  const foraDaBase = path.join(outro, 'sworn-captura-x');
  fs.mkdirSync(foraDaBase);
  assert.strictEqual(rodar(['--limpar-perfil', foraDaBase], { SWORN_TMP: tmp }).status, 1);
  assert.ok(fs.existsSync(foraDaBase), 'apagou um sworn-captura- fora da pasta temporaria');
  const perfil = path.join(tmp, 'sworn-captura-abc');
  fs.mkdirSync(path.join(perfil, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(perfil, 'Default', 'x.txt'), 'x');
  // No Windows o caminho nao diferencia maiuscula: o mesmo perfil, escrito em maiusculas, ainda e da pasta temporaria.
  const comoVeio = process.platform === 'win32'
    ? path.join(path.dirname(perfil).toUpperCase(), path.basename(perfil)) : perfil;
  const ok = rodar(['--limpar-perfil', comoVeio], { SWORN_TMP: tmp });
  assert.strictEqual(ok.status, 0, ok.stdout);
  assert.ok(!fs.existsSync(perfil));
});

test('ponta a ponta: a resposta 404 do servidor vai para a evidencia, com aviso', async function (t) {
  if (!NAVEGADOR) { t.skip('sem Chrome nem Edge nesta maquina'); return; }
  const http = require('node:http');
  const dir = pastaTemporaria(t);
  const tmp = path.join(dir, 'tmp');
  fs.mkdirSync(tmp);
  const servidor = http.createServer(function (req, res) {
    res.writeHead(req.url === '/ok' ? 200 : 404, { 'content-type': 'text/html' });
    res.end('<!doctype html><h1>' + (req.url === '/ok' ? 'Pronto' : 'Nao achei') + '</h1>');
  });
  await new Promise(function (r) { servidor.listen(0, '127.0.0.1', r); });
  t.after(function () { servidor.close(); });
  const base = 'http://127.0.0.1:' + servidor.address().port;
  const rodarAssincrono = function (args) {
    return new Promise(function (r) {
      execFile(process.execPath, [SCRIPT].concat(args), { encoding: 'utf8', timeout: 180000,
        env: ambiente({ SWORN_TMP: tmp }) }, function (erro, stdout) { r({ erro, stdout }); });
    });
  };
  const lerJson = function (x) { assert.ok(!x.erro, 'o script falhou: ' + x.erro + ' ' + x.stdout); return JSON.parse(x.stdout); };
  const nao = lerJson(await rodarAssincrono(['--url', base + '/sumiu', '--saida', path.join(dir, 'a'), '--tempo-max', '120000']));
  assert.strictEqual(nao.status, 404);
  assert.ok(nao.aviso.startsWith('o servidor respondeu 404: a foto e da pagina de erro; confira o endereco (ou o ' +
    'login, se a pagina pede um) e capture de novo'), nao.aviso);
  assert.strictEqual(JSON.parse(fs.readFileSync(nao.evidencia, 'utf8')).status, 404);
  const sim = lerJson(await rodarAssincrono(['--url', base + '/ok', '--saida', path.join(dir, 'b'), '--tempo-max', '120000']));
  assert.strictEqual(sim.status, 200);
  // So o aviso do servidor fica de fora (F1b): sob a suite inteira o Windows segura a pasta do navegador e a captura
  // avisa que a limpeza ficou para o segundo plano; quem espera por ela e o assertSemSobras, logo abaixo.
  assert.doesNotMatch(sim.aviso || '', /o servidor respondeu/, 'a resposta 200 nao leva o aviso do servidor');
  assertSemSobras(tmp, dir, JSON.stringify(nao) + JSON.stringify(sim));
});
