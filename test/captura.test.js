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
  assert.deepStrictEqual(r.opcoes, { url: 'https://exemplo.com/a', saida: 'out', esperar: null, arquivo: null, largura: 1280,
    altura: 800, tempoMax: 30000 });
  const r2 = captura.lerArgs(['--url', 'file:///C:/x/p.html', '--saida', 'o', '--largura', '390', '--altura', '844',
    '--esperar', '#app .pronto', '--tempo-max', '5000']);
  assert.deepStrictEqual(r2.opcoes, { url: 'file:///C:/x/p.html', saida: 'o', esperar: '#app .pronto', arquivo: null, largura: 390,
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

function pastaTemporaria(t) {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sworn-teste-captura-'));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

test('E3 item 2: resumirEstilo passa so a forma esperada, com os tetos, e o exemplo limpo de segredo', function () {
  const r = captura.resumirEstilo({ vistos: 7, cortado: false, valores: [
    ['color', ' rgb(255, 0, 0) ', 3, 'p.aviso'],
    ['background-color', 'rgb(0, 0, 0)', 0, 'div#k?token=abc'],
    ['margin', '8px', 1, 'p'],            // propriedade que a captura nao le
    ['color', '', 1, 'p'],                // valor vazio
    ['font-size', 13, 1, 'p'],            // valor que nao e texto
    'torto',
  ] });
  assert.deepStrictEqual(r.valores.map(function (v) { return [v.propriedade, v.valor, v.quantos]; }),
    [['color', 'rgb(255, 0, 0)', 3]]);
  assert.strictEqual(r.vistos, 7);
  assert.strictEqual(r.cortado, false);
  // Os itens tortos contam em descartados (a contagem 0 tambem, que a pagina honesta nunca manda); o par
  // que fica igual depois da limpeza soma no mesmo item; o exemplo cabe nos 80; o semCorpo passa adiante; o --arquivo
  // perde o espaco das pontas.
  assert.strictEqual(r.descartados, 5);
  const segredo = captura.resumirEstilo({ valores: [['background-color', 'rgb(0, 0, 0)', 1, 'div#k?token=abc']] });
  assert.strictEqual(segredo.valores.length, 1);
  assert.ok(!JSON.stringify(segredo).includes('abc'), 'o segredo do exemplo foi para a evidencia');
  // Contagem que nao e inteiro de 1 para cima e texto enorme (valor ou exemplo) sao descartados.
  const tortos = captura.resumirEstilo({ valores: [['color', 'red', -5, 'p'], ['color', 'red', 'abc', 'p'],
    ['color', 'red', 1.5, 'p'], ['color', 'x'.repeat(65537), 1, 'p'], ['color', 'blue', 1, 'p'.repeat(65537)],
    ['color', 'green', 1, 'p']] });
  assert.deepStrictEqual(tortos.valores.map(function (v) { return v.valor; }), ['green']);
  assert.strictEqual(tortos.descartados, 5);
  // O exemplo que nao e texto e o valor acima de 4096 caracteres tambem; o exemplo ausente nao.
  const r3 = captura.resumirEstilo({ valores: [['color', 'red', 1, { x: 1 }], ['color', 'x'.repeat(4097), 1, 'p'],
    ['color', 'x'.repeat(4096), 1, 'p'], ['color', 'blue', 1]] });
  assert.deepStrictEqual(r3.valores.map(function (v) { return v.valor.length; }), [4096, 4]);   // cabe em 4096: vai inteiro, so limpo de segredo
  assert.strictEqual(r3.descartados, 2);
  const iguais = captura.resumirEstilo({ valores: [['font-family', 'token=aaa', 2, 'p'], ['font-family', 'token=bbb', 3, 'p']] });
  assert.deepStrictEqual(iguais.valores.map(function (x) { return x.quantos; }), [5]);
  assert.strictEqual(captura.resumirEstilo({ valores: [], semCorpo: true }).semCorpo, true);
  // Sem nada, ou com a forma torta: vazio, sem lancar.
  assert.deepStrictEqual(captura.resumirEstilo(null), { valores: [], vistos: 0, cortado: false, descartados: 0, ilegivel: true });
  assert.deepStrictEqual(captura.resumirEstilo({ valores: 'x', vistos: -1 }), { valores: [], vistos: 0, cortado: false, descartados: 0, ilegivel: true });
  // Acima do teto de pares, corta e diz que cortou.
  const muitos = [];
  for (let i = 0; i < captura.VALORES_DO_ESTILO + 5; i++) muitos.push(['color', 'rgb(' + i + ', 0, 0)', 1, 'p']);
  const c = captura.resumirEstilo({ valores: muitos, vistos: 1 });
  assert.strictEqual(c.valores.length, captura.VALORES_DO_ESTILO);
  assert.strictEqual(c.cortado, true);
  // Com a lista cheia, a leitura segue: o repetido ainda soma e o torto ainda conta.
  const depois = captura.resumirEstilo({ valores: muitos.concat([['color', 'rgb(0, 0, 0)', 7, 'p'], 'torto']), vistos: 1 });
  assert.strictEqual(depois.valores[0].quantos, 8);
  assert.strictEqual(depois.descartados, 1);
  // As contagens da pagina tem teto: 1e308 somado nao vira Infinity (o JSON gravaria null).
  const enorme = captura.resumirEstilo({ vistos: 1e308, valores: [['color', 'red', 1e308, 'p'], ['color', 'red', 1e308, 'p']] });
  assert.strictEqual(enorme.valores[0].quantos, captura.ELEMENTOS_DO_ESTILO);
  assert.strictEqual(enorme.vistos, captura.ELEMENTOS_DO_ESTILO);
  assert.strictEqual(captura.resumirEstilo({ vistos: 5000, valores: [['color', 'red', 5000, 'p']] }).valores[0].quantos,
    captura.ELEMENTOS_DO_ESTILO);
  // A expressao que roda na pagina e uma expressao so, que o motor aceita.
  assert.doesNotThrow(function () { new Function('return ' + captura.EXPRESSAO_DO_ESTILO); });
  // O valor da pagina tambem sai limpo de segredo; o corte do exemplo nao parte um emoji. O emoji comeca no
  // caractere 77 (indice 76), o ultimo antes das reticencias: o corte em 77 o partiria ao meio.
  const hostil = captura.resumirEstilo({ valores: [['font-family', 'api_key=abc123', 1, 'x'.repeat(76) + '\u{1F600}' + 'y'.repeat(5)]] });
  assert.ok(!JSON.stringify(hostil).includes('abc123'), 'o segredo do valor foi para a evidencia');
  assert.strictEqual(hostil.valores[0].exemplo, 'x'.repeat(76) + '...', 'o exemplo partiu um emoji');
  // O emoji que termina no caractere 77 cabe inteiro antes das reticencias.
  const noLimite = captura.resumirEstilo({ valores: [['color', 'red', 1, 'x'.repeat(75) + '\u{1F600}' + 'y'.repeat(5)]] });
  assert.strictEqual(noLimite.valores[0].exemplo, 'x'.repeat(75) + '\u{1F600}...', 'o emoji que cabia foi cortado');
  // O segredo que cruza o corte dos 80 sai inteiro: a limpeza vem antes do corte, e nem o comeco dele fica.
  const cruza = captura.resumirEstilo({ valores: [['color', 'red', 1, 'a#b' + 'x'.repeat(66) + '?token=k9q7w2x5z8']] });
  assert.doesNotMatch(cruza.valores[0].exemplo, /token=k/, 'o comeco do segredo ficou no exemplo');
  assert.strictEqual(cruza.valores[0].exemplo.length, 80);
});

test('E3 item 2: lerArgs aceita o --arquivo aparado e diz o que fazer quando ele vem vazio ou sem valor', function () {
  assert.strictEqual(captura.lerArgs(['--url', 'http://x', '--saida', 's', '--arquivo', ' src/a.css ']).opcoes.arquivo, 'src/a.css');
  assert.strictEqual(captura.lerArgs(['--url', 'http://x', '--saida', 's', '--arquivo', ' ']).erro, '--arquivo veio vazio: diga o ' +
    'caminho do arquivo que desenha a tela, a partir da raiz do projeto (exemplo: src/checkout/tela.css), ou tire a opcao');
  assert.match(captura.lerArgs(['--url', 'http://x', '--saida', 's', '--arquivo']).erro, /^--arquivo veio sem valor\. uso: .*\[--arquivo <caminho a partir da raiz do projeto, ex\.: src\/checkout\/tela\.css>\]$/);
});

test('E3 item 2: o aviso do estilo diz o que fazer, e o desvio so vale com --arquivo', function () {
  const { avisoDoEstilo } = require('../scripts/capturar-tela.js');
  // Sem design.json, o estilo nao foi conferido: o aviso diz de onde rodar, ou como criar o sistema; o --arquivo dado
  // tambem nao serviu.
  assert.strictEqual(avisoDoEstilo(null, null), 'sem .claude/sworn/design.json na pasta onde a captura roda, o estilo ' +
    'foi gravado sem conferir: rode a captura da raiz do projeto (a pasta do .claude/sworn/design.json), ou crie o ' +
    'sistema de design com o /sworn:init');
  assert.match(avisoDoEstilo(null, 'src/a.css'), /o estilo foi gravado sem conferir e o --arquivo nao foi usado: rode a captura da raiz do projeto \(a pasta do \.claude\/sworn\/design\.json\), ou crie o sistema de design com o \/sworn:init$/);
  // O --arquivo fora do projeto: rodar da raiz e passar o caminho a partir dela.
  assert.strictEqual(avisoDoEstilo({ feita: true, fora: [], arquivoForaDoProjeto: true }, '../x.css'), 'o --arquivo fica ' +
    'fora da pasta do projeto, e os desvios dele nao valeram: se o arquivo e do projeto, rode a captura da raiz do ' +
    'projeto e passe o caminho a partir dela; um arquivo fora do projeto nao tem desvio');
  // Conferido e tudo dentro do sistema: nada a dizer.
  assert.strictEqual(avisoDoEstilo({ feita: true, fora: [] }, null), '');
  // Sem --arquivo, o desvio da tela nao vale: o aviso diz que e o --arquivo que o faz valer.
  const semArquivo = avisoDoEstilo({ feita: true, fora: [1, 2] }, null);
  assert.match(semArquivo, /^2 valor\(es\) fora do sistema de design, listados em estiloForaDoSistema\.fora do evidencia\.json: troque cada um por um valor do \.claude\/sworn\/design\.json, ou peca ao dono que declare um desvio para esta tela em "desvios" do design\.json e rode de novo com --arquivo <o arquivo que desenha a tela>: sem ele, so o sistema vale$/);
  // Com --arquivo, o desvio ja foi aplicado: nada de mandar passar o --arquivo de novo.
  const comArquivo = avisoDoEstilo({ feita: true, fora: [1] }, 'src/a.css');
  assert.match(comArquivo, /^1 valor\(es\) fora .*ou peca ao dono que declare um desvio para esta tela em "desvios" do design\.json$/);
  assert.doesNotMatch(comArquivo, /rode de novo com --arquivo/);
  // A conferencia que nao rodou (feita: false) nao fala de valores fora.
  assert.strictEqual(avisoDoEstilo({ feita: false, fora: [1] }, null), '');
});

test('E3 item 2: a conferencia le o design.json da pasta onde roda, e o --arquivo vira o caminho a partir dela', function (t) {
  const { conferenciaDoEstilo } = require('../scripts/capturar-tela.js');
  const dir = pastaTemporaria(t);
  const antes = process.cwd();
  const estilo = captura.resumirEstilo({ valores: [['color', 'rgb(255, 0, 0)', 1, 'p']], vistos: 1 });
  try {
    process.chdir(dir);
    assert.strictEqual(conferenciaDoEstilo(estilo, 'src/promo.css'), null, 'sem design.json, a conferencia tem de ser null');
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'design.json'), JSON.stringify({ cores: ['#000'], raios: [],
      espacos: [], sombras: [], desvios: [{ arquivos: ['src/promo.css'], motivo: 'campanha', cores: ['#ff0000'] }] }));
    const valoresFora = function (r) { return r.fora.map(function (x) { return x.valor; }); };
    const semArquivo = conferenciaDoEstilo(estilo, null);
    assert.strictEqual(semArquivo.arquivo, null);
    assert.strictEqual(semArquivo.feita, true);
    assert.deepStrictEqual(valoresFora(semArquivo), ['rgb(255, 0, 0)'], 'sem --arquivo, o desvio nao pode valer');
    // Relativo, com barra invertida ou absoluto: o mesmo caminho a partir da pasta, e o desvio vale.
    for (const dado of ['src/promo.css', 'src\\promo.css', path.join(process.cwd(), 'src', 'promo.css')]) {
      const r = conferenciaDoEstilo(estilo, dado);
      assert.strictEqual(r.arquivo, 'src/promo.css', 'o --arquivo ' + dado + ' nao virou o caminho a partir da pasta');
      assert.deepStrictEqual(valoresFora(r), [], 'com o --arquivo ' + dado + ', o desvio nao valeu');
      assert.strictEqual(r.arquivoForaDoProjeto, undefined);
    }
    // Outro arquivo do projeto: o desvio do promo.css nao vale para ele.
    assert.deepStrictEqual(valoresFora(conferenciaDoEstilo(estilo, 'src/outra.css')), ['rgb(255, 0, 0)']);
    // Acima da pasta ou em outro disco: nenhum desvio, so a marca, e o caminho nao vai para a evidencia.
    const outroDisco = process.platform === 'win32' ? (/^z/i.test(process.cwd()) ? 'Y' : 'Z') + ':/x/fora.css' : 'C:/x/fora.css';
    for (const dado of ['../fora.css', outroDisco]) {
      const r = conferenciaDoEstilo(estilo, dado);
      assert.strictEqual(r.arquivo, null, 'o --arquivo ' + dado + ' casou desvio');
      assert.strictEqual(r.arquivoForaDoProjeto, true, 'o --arquivo ' + dado + ' nao foi marcado fora do projeto');
      assert.ok(!JSON.stringify(r).includes('fora.css'), 'o caminho de fora foi para a evidencia: ' + JSON.stringify(r));
    }
    // A propria pasta: nenhum desvio e nenhuma marca.
    const raiz = conferenciaDoEstilo(estilo, '.');
    assert.strictEqual(raiz.arquivo, null);
    assert.strictEqual(raiz.arquivoForaDoProjeto, undefined);
    // O estilo que nao foi lido: a lista vazia nao diz "tudo dentro do sistema".
    const naoLido = conferenciaDoEstilo({ ...captura.resumirEstilo(null), erro: 'nao deu' }, null);
    assert.strictEqual(naoLido.feita, false);
    assert.strictEqual(naoLido.ok, false);
  } finally {
    process.chdir(antes);
  }
});

test('E3 item 2: o exemplo de 80 caracteres vai inteiro, e o de 81 e cortado em 80 com as reticencias', function () {
  const exemplo = function (n) { return captura.resumirEstilo({ valores: [['color', 'red', 1, 'p'.repeat(n)]] }).valores[0].exemplo; };
  assert.strictEqual(exemplo(80), 'p'.repeat(80));
  assert.strictEqual(exemplo(81), 'p'.repeat(77) + '...');
});

// ---------------------------------------------------------------- ponta a ponta, com o navegador de verdade


const NAVEGADOR = captura.acharNavegador(captura.candidatosDoNavegador(process.platform, process.env),
  function (p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });

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

test('ponta a ponta (E3 item 2): o estilo calculado vai para a evidencia e e conferido contra o design.json', function (t) {
  if (!NAVEGADOR) { t.skip('sem Chrome nem Edge nesta maquina'); return; }
  const dir = pastaTemporaria(t);
  const tmp = path.join(dir, 'tmp');
  fs.mkdirSync(tmp);
  // O projeto onde a captura roda: o design.json tem o preto, o branco e o raio de 8px; a tela usa um vermelho por
  // var() (o navegador resolve), um raio de 3px e um fundo transparente (nao conta).
  const projeto = path.join(dir, 'projeto');
  fs.mkdirSync(path.join(projeto, '.claude', 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(projeto, '.claude', 'sworn', 'design.json'), JSON.stringify({
    cores: ['#000', '#fff'], raios: ['8px'], espacos: [], sombras: [],
    desvios: [{ arquivos: ['src/promo.css'], motivo: 'campanha', cores: ['#ff0000'] }] }));
  const pagina = path.join(dir, 'pagina.html');
  fs.writeFileSync(pagina, '<!doctype html><html><head><meta charset="utf-8"><style>:root { --alerta: #f00; }' +
    'body { margin: 0; background: #fff; color: #000; } .aviso { color: var(--alerta); border-radius: 3px; ' +
    'background: transparent; } .ok { border-radius: 8px; } .ph::placeholder { color: rgb(13, 14, 15); }</style></head>' +
    // Os dois forms vem primeiro, para o exemplo do par ser deles: o fundo preto e do form#f (o campo
    // name="id" nao tampa o id) e o raio de 8px e do form.tampado (os campos que tampam tagName, firstChild e
    // getBoundingClientRect nao derrubam a leitura, e o texto roxo antes deles ainda e achado). O texto de um display:contents (sem caixa) entra com a cor dele.
    '<body><form id="f" style="background:#000"><input name="id" value="Buscar" style="color:#00f;border:none;background:#fff"></form>' +
    '<form class="tampado" style="border-radius:8px;color:rgb(128, 0, 128)">Nome<input name="tagName" style="border:none;background:#fff">' +
    '<input name="firstChild" style="border:none;background:#fff"><input name="getBoundingClientRect" ' +
    'style="border:none;background:#fff"></form>' +
    '<p class="aviso">Atencao</p><p class="ok">Tudo certo</p><div style="display:none;color:#0f0">x</div><p style="visibility:hidden;color:#0f0">y</p><div style="opacity:0"><p style="color:#0f0">z</p></div>' +
    // O fundo dele nao se ve (nao tem caixa): nao entra.
    '<span style="display:contents;color:rgb(0, 128, 0);background:#123456">verde</span>' +
    // O display:contents dentro de outro (o ancestral com caixa e o body) e o de visibility:visible sob um
    // pai hidden aparecem; o <img name="body"> nao tampa o document.body da leitura.
    '<div style="display:contents"><span style="display:contents;color:rgb(0, 0, 128)">aninhado</span></div>' +
    '<div style="visibility:hidden"><span style="display:contents;visibility:visible;color:rgb(128, 128, 0)">visivel</span></div>' +
    '<img name="body" width="1" height="1" alt="">' +
    '<span style="display:contents;visibility:hidden;color:#0f0">oculto</span>' +
    // A caixa de marcar nao mostra texto (o value "on" nao conta); o fundo branco com alfa 0 e o canto 0% nao
    // se veem; o select mostra o rotulo da opcao escolhida, mesmo com value vazio.
    '<input type="checkbox" style="color:rgb(1, 2, 3);border:none;background:#fff">' +
    '<div style="background:rgba(255, 255, 255, 0);border-radius:0%;width:10px;height:10px"></div>' +
    '<select style="color:rgb(4, 5, 6);border:none;background:#fff"><option value="">Escolha</option></select>' +
    // O value do botao nao aparece, e a borda transparente so guarda o espaco; o texto transparente
    // (gradiente) nao mostra a propria cor; o fundo oklch com alfa 0 e o canto 0 20px (reto) nao se veem; o submit
    // sem value mostra o rotulo padrao; o campo vazio mostra o placeholder com a cor do ::placeholder.
    '<button name="acao" value="apagar" style="color:rgb(7, 8, 9);border:1px solid transparent;background:#fff;' +
    'width:20px;height:20px"></button>' +
    '<h2 style="color:transparent">gradiente</h2>' +
    '<div style="background:oklch(0.7 0.1 200 / 0);border-top-left-radius:0 20px;width:10px;height:10px"></div>' +
    '<input type="submit" style="color:rgb(10, 11, 12);border:none;background:#fff">' +
    '<input class="ph" placeholder="Email" style="color:#000;border:none;background:#fff">' +
    '</body></html>');
  const capturar = function (saida, extra, outra) {
    const r = spawnSync(process.execPath, [SCRIPT, '--url', pathToFileURL(outra || pagina).href, '--saida', saida, '--largura', '600',
      '--altura', '400', '--tempo-max', '120000'].concat(extra || []),
    { encoding: 'utf8', timeout: 180000, env: ambiente({ SWORN_TMP: tmp }), cwd: projeto });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    return { fim: JSON.parse(r.stdout), e: JSON.parse(fs.readFileSync(path.join(saida, 'evidencia.json'), 'utf8')) };
  };
  const { fim, e } = capturar(path.join(dir, 'a'));
  const par = function (p, v) { return e.estilo.valores.some(function (x) { return x.propriedade === p && x.valor === v; }); };
  assert.ok(par('color', 'rgb(255, 0, 0)') && par('border-radius', '3px') && par('border-radius', '8px'), JSON.stringify(e.estilo));
  assert.ok(!par('color', 'rgb(0, 255, 0)'), 'o elemento escondido entrou no estilo');
  // O body entra (o fundo da pagina mora nele), e o raio dos 4 cantos de um elemento conta esse elemento uma vez.
  assert.ok(par('background-color', 'rgb(255, 255, 255)'), 'o fundo do body ficou fora do estilo');
  assert.strictEqual(e.estilo.valores.find(function (x) { return x.valor === '3px'; }).quantos, 1);
  assert.ok(!e.estilo.valores.some(function (x) { return x.propriedade === 'background-color' && /^rgba\(.*,\s*0\)$/.test(x.valor); }),
    'o fundo transparente entrou no estilo');
  const fora = e.estiloForaDoSistema.fora.map(function (x) { return x.propriedade + ' ' + x.valor; }).sort();
  assert.deepStrictEqual(fora, ['border-radius 3px', 'color rgb(0, 0, 128)', 'color rgb(0, 0, 255)', 'color rgb(0, 128, 0)',
    'color rgb(10, 11, 12)', 'color rgb(128, 0, 128)', 'color rgb(128, 128, 0)', 'color rgb(13, 14, 15)',
    'color rgb(255, 0, 0)', 'color rgb(4, 5, 6)'].sort());
  assert.ok(!par('color', 'rgb(7, 8, 9)'), 'o value do botao entrou como texto');
  assert.ok(!e.estilo.valores.some(function (x) { return /^rgba\((?:[^,]*,){3}\s*0\)$|\/\s*0\)$/.test(x.valor); }),
    'uma cor transparente (borda, texto ou fundo oklch) entrou: ' + JSON.stringify(e.estilo));
  assert.ok(!par('border-radius', '0px 20px'), 'o canto reto 0 20px entrou');
  assert.ok(!par('color', 'rgb(1, 2, 3)'), 'a caixa de marcar entrou como texto');
  assert.ok(!par('border-radius', '0%'), 'o canto reto em 0% entrou');
  // O campo de formulario (valor sem no de texto) entra: a cor dele, rgb(0, 0, 255), esta na lista de fora acima. E o
  // exemplo do form com campo name="id" nao vira objeto.
  assert.ok(!JSON.stringify(e.estilo).includes('[object'), JSON.stringify(e.estilo));
  const exemploDe = function (p, v) {
    const x = e.estilo.valores.find(function (y) { return y.propriedade === p && y.valor === v; });
    return x && x.exemplo;
  };
  assert.strictEqual(exemploDe('background-color', 'rgb(0, 0, 0)'), 'form#f', JSON.stringify(e.estilo));
  assert.strictEqual(exemploDe('border-radius', '8px'), 'form.tampado', JSON.stringify(e.estilo));
  assert.strictEqual(e.estilo.erro, undefined);
  assert.strictEqual(fim.valoresForaDoSistema, 10);
  assert.strictEqual(e.estiloForaDoSistema.feita, true);
  assert.match(fim.avisoDoEstilo, /10 valor\(es\) fora do sistema de design, listados em estiloForaDoSistema\.fora/);
  assert.strictEqual(fim.estiloNaoLido, undefined);
  // Com --arquivo do desvio, o vermelho da campanha vale nesta tela; o raio de 3px segue fora. O caminho absoluto
  // vira o caminho a partir do projeto (e assim que o desvio casa, e o caminho pessoal nao vai para a evidencia).
  const comDesvio = capturar(path.join(dir, 'b'), ['--arquivo', path.join(projeto, 'src', 'promo.css')]).e.estiloForaDoSistema;
  assert.strictEqual(comDesvio.arquivo, 'src/promo.css');
  assert.deepStrictEqual(comDesvio.fora.map(function (x) { return x.valor; }).sort(), ['3px', 'rgb(0, 0, 128)', 'rgb(0, 0, 255)',
    'rgb(0, 128, 0)', 'rgb(10, 11, 12)', 'rgb(128, 0, 128)', 'rgb(128, 128, 0)', 'rgb(13, 14, 15)', 'rgb(4, 5, 6)'].sort());
  // O --arquivo fora do projeto nao casa desvio e nao vai para a evidencia, so a marca.
  // O relativo que sobe (..) tambem; o que so comeca com dois pontos no nome (..tema) e do projeto.
  const subiu = capturar(path.join(dir, 'c'), ['--arquivo', '../fora.css']);
  const fora1 = subiu.e.estiloForaDoSistema;
  assert.match(subiu.fim.avisoDoEstilo, /o --arquivo fica fora da pasta do projeto/);
  assert.strictEqual(fora1.arquivo, null);
  assert.strictEqual(fora1.arquivoForaDoProjeto, true);
  assert.ok(!JSON.stringify(fora1).includes('fora.css'), JSON.stringify(fora1));
  const pontos = capturar(path.join(dir, 'e'), ['--arquivo', path.join(projeto, '..tema', 'x.css')]).e.estiloForaDoSistema;
  assert.strictEqual(pontos.arquivo, '..tema/x.css');
  assert.strictEqual(pontos.arquivoForaDoProjeto, undefined);
  // A propria pasta do projeto nao e caminho fora dele: nenhum desvio, sem a marca.
  const raiz = capturar(path.join(dir, 'g'), ['--arquivo', '.']).e.estiloForaDoSistema;
  assert.strictEqual(raiz.arquivo, null);
  assert.strictEqual(raiz.arquivoForaDoProjeto, undefined);
  // O documento sem body (um SVG aberto direto) nao derruba a foto: o estilo sai vazio com o motivo, e a
  // saida leva o motivo no lugar de uma contagem que diria "tudo dentro do sistema".
  const svg = path.join(dir, 'figura.svg');
  fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>');
  const semCorpo = capturar(path.join(dir, 'd'), [], svg);
  assert.match(semCorpo.e.estilo.erro, /nao e um documento HTML com corpo/);
  assert.match(semCorpo.e.estilo.erro, /confira-os na foto, a olho/);
  assert.strictEqual(semCorpo.fim.estiloNaoLido, semCorpo.e.estilo.erro);
  assert.strictEqual(semCorpo.fim.valoresForaDoSistema, undefined);
  // A evidencia tambem nao diz "tudo dentro do sistema" quando o estilo nao foi lido.
  assert.strictEqual(semCorpo.e.estiloForaDoSistema.feita, false);
  assert.strictEqual(semCorpo.e.estiloForaDoSistema.ok, false);
  // O body sem altura (tudo dentro posicionado) entra: o fundo dele pinta a tela inteira.
  const corpoZero = path.join(dir, 'corpo.html');
  fs.writeFileSync(corpoZero, '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;' +
    'background:#123456"><div style="position:absolute;top:0;color:#000">x</div></body></html>');
  const zero = capturar(path.join(dir, 'f'), [], corpoZero).e;
  assert.ok(zero.estilo.valores.some(function (x) { return x.propriedade === 'background-color' && x.valor === 'rgb(18, 52, 86)'; }),
    JSON.stringify(zero.estilo));
  assertSemSobras(tmp, dir, JSON.stringify(e.estiloForaDoSistema));
});

test('ponta a ponta (E3 item 2): textarea pelo value, submit vazio, a cor pintada e a subida com teto', function (t) {
  if (!NAVEGADOR) { t.skip('sem Chrome nem Edge nesta maquina'); return; }
  const dir = pastaTemporaria(t);
  const tmp = path.join(dir, 'tmp');
  fs.mkdirSync(tmp);
  // Duas correntes de display: contents, montadas por script (o leitor de HTML do Chrome achata o aninhamento alem de
  // 512 niveis), com um span display: contents no fim. Com 1000 ancestrais contents, o teto da subida, o texto entra;
  // com 1001, passa do teto: a leitura nao prende e marca `cortado`.
  const corrente = function (n, cor) {
    return '<script>(function () { let p = document.body; for (let i = 0; i < ' + n + '; i++) { const d = document.createElement("div"); ' +
      'd.style.display = "contents"; p.appendChild(d); p = d; } const s = document.createElement("span"); s.style.display = "contents"; ' +
      's.style.color = "' + cor + '"; s.textContent = "fundo"; p.appendChild(s); })();</script>';
  };
  const pagina = path.join(dir, 'pagina.html');
  fs.writeFileSync(pagina, '<!doctype html><html><head><meta charset="utf-8"><style>body { margin: 0; background: #fff; color: #000; } ' +
    '.bph::placeholder { color: rgb(51, 52, 53); }</style></head><body>' +
    // O textarea mostra o value atual, nao o texto inicial: o esvaziado nao mostra texto; o preenchido por script mostra.
    '<textarea id="vazio" style="color:rgb(21, 22, 23);border:none;background:#fff">inicial</textarea>' +
    '<textarea id="cheio" style="color:rgb(18, 19, 20);border:none;background:#fff"></textarea>' +
    // O submit com value="" fica vazio. O botao nao mostra o placeholder: nem o submit vazio nem o button sem value.
    '<input type="submit" value="" style="color:rgb(24, 25, 26);border:none;background:#fff">' +
    '<input type="submit" value="" placeholder="Enviar" class="bph" style="color:rgb(57, 58, 59);border:none;background:#fff">' +
    '<input type="button" placeholder="Ir" class="bph" style="color:rgb(60, 61, 62);border:none;background:#fff;width:20px;height:20px">' +
    // A cor pintada e a do -webkit-text-fill-color, nao a color.
    '<p style="color:rgb(27, 28, 29);-webkit-text-fill-color:rgb(30, 31, 32)">pintado</p>' +
    // No texto de SVG, a cor e a do fill.
    '<svg width="40" height="20"><text x="0" y="15" fill="rgb(33, 34, 35)" style="color:rgb(36, 37, 38)">s</text></svg>' +
    // O fill por gradiente (url(...)) nao e cor: nao entra, nem a color de baixo.
    '<svg width="40" height="20"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs>' +
    '<text x="0" y="15" fill="url(#g)" style="color:rgb(48, 49, 50)">g</text></svg>' +
    // O segredo no id da pagina nao vai para o disco: o exemplo (tag#id) sai limpo.
    '<p id="k?token=zzsegredo99" style="color:rgb(63, 64, 65)">k</p>' +
    // A borda, a fonte e o tamanho de um elemento com caixa entram com o valor calculado.
    '<p style="border:2px solid rgb(45, 46, 47);font-family:Georgia;font-size:17px;color:#000">borda</p>' +
    corrente(1000, 'rgb(42, 43, 44)') + corrente(1001, 'rgb(39, 40, 41)') +
    '<script>document.getElementById("vazio").value = ""; document.getElementById("cheio").value = "novo";</script>' +
    '</body></html>');
  const saida = path.join(dir, 'a');
  const r = spawnSync(process.execPath, [SCRIPT, '--url', pathToFileURL(pagina).href, '--saida', saida, '--largura', '600',
    '--altura', '400', '--tempo-max', '120000'], { encoding: 'utf8', timeout: 180000, env: ambiente({ SWORN_TMP: tmp }), cwd: dir });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const e = JSON.parse(fs.readFileSync(path.join(saida, 'evidencia.json'), 'utf8'));
  const cor = function (v) { return e.estilo.valores.some(function (x) { return x.propriedade === 'color' && x.valor === v; }); };
  assert.ok(!cor('rgb(21, 22, 23)'), 'o textarea esvaziado entrou pelo texto inicial: ' + JSON.stringify(e.estilo));
  assert.ok(cor('rgb(18, 19, 20)'), 'o textarea preenchido por script ficou fora: ' + JSON.stringify(e.estilo));
  assert.ok(!cor('rgb(24, 25, 26)'), 'o submit com value vazio entrou como texto');
  assert.ok(!cor('rgb(51, 52, 53)') && !cor('rgb(57, 58, 59)') && !cor('rgb(60, 61, 62)'),
    'o placeholder de um botao entrou como texto: ' + JSON.stringify(e.estilo));
  assert.ok(cor('rgb(30, 31, 32)') && !cor('rgb(27, 28, 29)'), 'a cor pintada nao e a do -webkit-text-fill-color: ' + JSON.stringify(e.estilo));
  assert.ok(cor('rgb(33, 34, 35)') && !cor('rgb(36, 37, 38)'), 'o texto de SVG nao entrou pelo fill: ' + JSON.stringify(e.estilo));
  assert.ok(!e.estilo.valores.some(function (x) { return /url\(/.test(x.valor); }), 'o fill por gradiente entrou como cor: ' + JSON.stringify(e.estilo));
  assert.ok(!cor('rgb(48, 49, 50)'), 'a color de baixo do fill por gradiente entrou');
  const par = function (p, v) { return e.estilo.valores.some(function (x) { return x.propriedade === p && x.valor === v; }); };
  assert.ok(par('border-color', 'rgb(45, 46, 47)') && par('font-family', 'Georgia') && par('font-size', '17px'),
    'a borda, a fonte ou o tamanho ficaram fora: ' + JSON.stringify(e.estilo));
  assert.ok(cor('rgb(42, 43, 44)'), 'o texto com 1000 ancestrais contents (o teto) ficou fora: ' + JSON.stringify(e.estilo));
  assert.ok(!cor('rgb(39, 40, 41)'), 'o texto alem do teto da subida entrou');
  assert.strictEqual(e.estilo.cortado, true, 'a subida alem do teto nao marcou cortado');
  assert.ok(cor('rgb(63, 64, 65)'), 'o paragrafo com o segredo no id ficou fora');
  assert.ok(!fs.readFileSync(path.join(saida, 'evidencia.json'), 'utf8').includes('zzsegredo99'), 'o segredo do id foi para a evidencia');
  assertSemSobras(tmp, dir, r.stdout);
});
