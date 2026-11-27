'use strict';
// Os ajudantes de rede dos testes do painel ao vivo (test/lib/painel-rede.js) contra um servidor de mentira, que manda
// o que o painel nao manda: a resposta que nao vem, o dado que nao e JSON, o fim de linha CRLF, o evento em varias
// linhas de data e a conexao que cai no meio. Sem estes, um defeito do ajudante trava ou engana os testes do painel
// (test/painel.test.js e test/painel-gancho.test.js, que usam o mesmo ajudante contra o servidor de verdade).
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const rede = require('./lib/painel-rede.js');

// Prazo de cada teste: um ajudante que trava reprova aqui, em vez de travar a suite.
const TESTE = { timeout: 5000 };

// Sobe um servidor de 127.0.0.1 numa porta livre com o tratador dado; fecha tudo no fim do teste.
async function servidorDeMentira(t, tratar) {
  const servidor = http.createServer(tratar);
  await new Promise(function (r) { servidor.listen(0, '127.0.0.1', r); });
  t.after(function () { servidor.closeAllConnections(); servidor.close(); });
  return servidor.address().port;
}

function abrirSse(res) { res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' }); }

test('abrirAba: o servidor que aceita e nao responde reprova pelo prazo, com o rotulo', TESTE, async function (t) {
  const porta = await servidorDeMentira(t, function () {});
  const inicio = Date.now();
  await assert.rejects(rede.abrirAba(t, porta, { prazo: 300 }), /aba: a resposta do \/eventos: nao aconteceu em 300 ms/);
  assert.ok(Date.now() - inicio < 3000, 'reprovou pelo prazo da aba, nao pelo do teste');
});

test('abrirAba: o dado que nao e JSON reprova a espera com o rotulo, sem excecao solta', TESTE, async function (t) {
  const porta = await servidorDeMentira(t, function (req, res) { abrirSse(res); res.write('event: estado\ndata: ok\n\n'); });
  const aba = await rede.abrirAba(t, porta, { prazo: 1000 });
  await assert.rejects(aba.esperar(function () { return true; }), /aba: o dado do evento estado nao e JSON: ok/);
  await assert.rejects(aba.esperarBatida(), /nao e JSON/, 'a espera seguinte tambem reprova pelo dado, nao pelo prazo');
});

test('abrirAba: o fim de linha CRLF, mesmo partido entre pedacos, e o evento em varias linhas de data', TESTE,
  async function (t) {
    const porta = await servidorDeMentira(t, function (req, res) {
      abrirSse(res);
      res.write('id: 1\r\nevent: um\r\ndata: {"a":\r');
      setTimeout(function () { res.write('\ndata: 1}\r\n\r\n: batida\r\n\r\nid: 2\nevent: dois\ndata: {"b":2}\n\n'); }, 50);
    });
    const aba = await rede.abrirAba(t, porta, { prazo: 1000 });
    await aba.esperar(function (e) { return e.tipo === 'dois'; }, 'o evento dois');
    assert.deepStrictEqual(aba.eventos, [{ id: 1, tipo: 'um', dado: { a: 1 } }, { id: 2, tipo: 'dois', dado: { b: 2 } }]);
    assert.strictEqual(aba.batidas, 1);
  });

test('abrirAba: o fim de linha so CR entrega o ultimo evento sem esperar mais dado', TESTE, async function (t) {
  const porta = await servidorDeMentira(t, function (req, res) { abrirSse(res); res.write('event: so-cr\rdata: {"c":3}\r\r'); });
  const aba = await rede.abrirAba(t, porta, { prazo: 1000 });
  const evento = await aba.esperar(function (e) { return e.tipo === 'so-cr'; }, 'o evento so-cr');
  assert.deepStrictEqual(evento.dado, { c: 3 });
});

test('abrirAba: o pedido que o Node recusa na hora reprova com o erro dele, nao com o do fechar', TESTE, async function (t) {
  const porta = await servidorDeMentira(t, function (req, res) { abrirSse(res); });
  await assert.rejects(rede.abrirAba(t, porta, { cookie: 'a\nb', prazo: 1000 }), { code: 'ERR_INVALID_CHAR' });
});

test('abrirAba: o cliente vazio vai vazio, o null tira o parametro e sem ele vai o de teste', TESTE, async function (t) {
  const caminhos = [];
  const porta = await servidorDeMentira(t, function (req, res) { caminhos.push(req.url); abrirSse(res); res.write(': batida\n\n'); });
  await rede.abrirAba(t, porta, { cliente: '' });
  await rede.abrirAba(t, porta, { cliente: null });
  await rede.abrirAba(t, porta);
  assert.deepStrictEqual(caminhos, ['/eventos?cliente=&visivel=1', '/eventos?visivel=1',
    '/eventos?cliente=' + rede.CLIENTE + '&visivel=1']);
});

test('abrirAba: o esperarFim diz null no fim limpo e o erro quando a conexao cai', TESTE, async function (t) {
  const porta = await servidorDeMentira(t, function (req, res) {
    abrirSse(res);
    res.write(': batida\n\n');
    setTimeout(function () { if (req.url.includes('cliente=limpo')) res.end(); else res.destroy(); }, 50);
  });
  const limpa = await rede.abrirAba(t, porta, { cliente: 'limpo' });
  assert.strictEqual(await limpa.esperarFim(), null, 'o fim limpo');
  const caiu = await rede.abrirAba(t, porta, { cliente: 'caiu' });
  const erro = await caiu.esperarFim();
  assert.ok(typeof erro === 'string' && erro.length > 0, 'a queda traz o erro: ' + JSON.stringify(erro));
});

test('pedir: o servidor que aceita e nao responde reprova pelo prazo, com o rotulo', TESTE, async function (t) {
  const porta = await servidorDeMentira(t, function () {});
  const inicio = Date.now();
  await assert.rejects(rede.pedir(porta, { metodo: 'POST', caminho: '/x', corpo: '{}', prazo: 300 }),
    /POST \/x: sem resposta em 300 ms/);
  assert.ok(Date.now() - inicio < 3000, 'reprovou pelo prazo do pedido, nao pelo do teste');
});

// O '2', menor que o corpo de 3 bytes, e de proposito: o calculado seria 3, entao so chega '2' se o pedido usar o do
// chamador. E um pedido so, e o servidor fecha no fim do teste: o byte que sobra nao chega a outro pedido.
test('pedir: o Content-Length dado em minusculas fica no lugar do calculado', TESTE, async function (t) {
  let visto;
  const porta = await servidorDeMentira(t, function (req, res) { visto = req.headers['content-length']; res.end('{}'); });
  const r = await rede.pedir(porta, { metodo: 'POST', caminho: '/x', corpo: 'abc', cabecalhos: { 'content-length': '2' },
    prazo: 1000 });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(visto, '2');
});

test('pedir: a conexao que cai no meio do corpo reprova na hora, sem esperar o prazo', TESTE, async function (t) {
  const porta = await servidorDeMentira(t, function (req, res) {
    res.writeHead(200, { 'Content-Length': '100' });
    res.write('metade');
    setTimeout(function () { res.destroy(); }, 50);
  });
  const inicio = Date.now();
  // A queda chega como o 'aborted' do Node (ECONNRESET); outro erro qualquer nao prova que a queda foi ouvida.
  await assert.rejects(rede.pedir(porta, { caminho: '/x', prazo: 3000 }), { code: 'ECONNRESET', message: 'aborted' });
  assert.ok(Date.now() - inicio < 2000, 'reprovou pela queda, nao pelo prazo');
});
