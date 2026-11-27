'use strict';
// Painel de sessoes, fase 3, passo P2: o gancho das sessoes (scripts/painel-gancho.js) contra o painel ao vivo de
// verdade. O servidor sobe aqui, a ponte fica numa pasta de config temporaria e o gancho roda como processo, com a
// entrada no stdin, como o Claude Code o roda. O gancho nunca escreve no stdout, a nao ser a decisao do
// PermissionRequest, e sempre sai 0: o painel desligado nao pode atrapalhar a sessao.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const comum = require('./lib/comum.js');
const rede = require('./lib/painel-rede.js');
const ponte = require(path.join(comum.RAIZ, 'scripts', 'lib', 'painel-ponte.js'));

const GANCHO = path.join(comum.RAIZ, 'scripts', 'painel-gancho.js');
// O gancho que segura espera a decisao; passado este prazo o teste reprova, em vez de esperar os 125 s do gancho.
const PRAZO_DO_GANCHO = 20000;
const ID = 'b7e3c1d2-4f5a-4b6c-9d8e-0a1b2c3d4e5f';
const CWD = 'C:\\dev\\loja';

function pastaDeConfig(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-painel-gancho-'));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

function entrada(evento, extra) {
  return Object.assign({ session_id: ID, hook_event_name: evento, cwd: CWD, permission_mode: 'default' }, extra);
}
const PERMISSAO = entrada('PermissionRequest', { tool_name: 'PowerShell',
  tool_input: { command: 'echo sonda > feito.txt', description: 'Cria o arquivo da sonda' } });

// Roda o gancho: a entrada no stdin, a pasta de config no ambiente isolado. `fim` resolve com o codigo, o stdout, o
// stderr e quanto levou; `filho` fica para o teste ver que ele segue vivo enquanto segura.
function iniciar(config, stdin) {
  const inicio = Date.now();
  const filho = spawn(process.execPath, [GANCHO], { env: comum.ambiente({ CLAUDE_CONFIG_DIR: config }),
    stdio: ['pipe', 'pipe', 'pipe'] });
  let saida = '';
  let erro = '';
  filho.stdout.on('data', function (d) { saida += d; });
  filho.stderr.on('data', function (d) { erro += d; });
  const fim = new Promise(function (resolver, rejeitar) {
    const relogio = setTimeout(function () {
      filho.kill();
      rejeitar(new Error('o gancho nao saiu em ' + PRAZO_DO_GANCHO + ' ms: ' + erro));
    }, PRAZO_DO_GANCHO);
    filho.on('close', function (codigo) {
      clearTimeout(relogio);
      resolver({ codigo, saida, erro, ms: Date.now() - inicio });
    });
    filho.on('error', function (e) { clearTimeout(relogio); rejeitar(e); });
  });
  filho.stdin.on('error', function () {});
  filho.stdin.end(typeof stdin === 'string' ? stdin : JSON.stringify(stdin));
  return { filho, fim };
}

function gravarPonte(config, dados) {
  ponte.gravar(Object.assign({ token: rede.TOKEN, pid: process.pid }, dados), { CLAUDE_CONFIG_DIR: config });
}

async function painelComPonte(t, vivo) {
  const p = await rede.subirVivo(t, vivo);
  const config = pastaDeConfig(t);
  gravarPonte(config, { porta: p.porta });
  return Object.assign(p, { config });
}

function silencioso(r, rotulo) {
  assert.deepStrictEqual([r.codigo, r.saida], [0, ''], rotulo + ': ' + r.erro);
}

async function pidMorto() {
  const filho = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise(function (r) { filho.on('close', r); });
  return filho.pid;
}

async function portaFechada() {
  const s = net.createServer();
  await new Promise(function (r) { s.listen(0, '127.0.0.1', r); });
  const porta = s.address().port;
  await new Promise(function (r) { s.close(r); });
  return porta;
}

test('gancho: com o painel desligado (sem ponte, pid morto, porta fechada) sai 0 sem escrever nada', async function (t) {
  const semPonte = pastaDeConfig(t);
  const r1 = await iniciar(semPonte, PERMISSAO).fim;
  silencioso(r1, 'sem ponte');
  assert.strictEqual(r1.erro, '', 'sem ponte: nada no stderr');

  // o pid morto com um painel de pe na porta da ponte: so a conferencia do pid deixa o gancho calado
  const vivo = await rede.subirVivo(t);
  const morto = pastaDeConfig(t);
  gravarPonte(morto, { porta: vivo.porta, pid: await pidMorto() });
  const r2 = await iniciar(morto, PERMISSAO).fim;
  silencioso(r2, 'pid morto');
  assert.strictEqual(r2.erro, '', 'pid morto: nada no stderr');
  assert.ok(!(await rede.dados(vivo.porta)).json.sessoes.some(function (s) { return s.id === ID; }),
    'pid morto: a nota nao chegou ao painel da porta');

  const fechada = pastaDeConfig(t);
  gravarPonte(fechada, { porta: await portaFechada() });
  const r3 = await iniciar(fechada, PERMISSAO).fim;
  silencioso(r3, 'porta fechada');
  assert.strictEqual(r3.erro, '', 'porta fechada: o painel que caiu nao e erro');
});

test('gancho: o SessionStart poe a mesa no painel; a entrada que nao e JSON e o token errado nao mudam nada', async function (t) {
  const p = await painelComPonte(t);
  silencioso(await iniciar(p.config, entrada('SessionStart', { source: 'startup' })).fim, 'SessionStart');
  const d1 = (await rede.dados(p.porta)).json;
  assert.strictEqual(d1.modo, 'ao-vivo');
  const s = d1.sessoes.find(function (x) { return x.id === ID; });
  assert.ok(s, 'a mesa nova: ' + JSON.stringify(d1.sessoes));
  assert.deepStrictEqual([s.maquina, s.origem, s.estado, s.projeto], ['local', 'terminal', 'parada', 'C:/dev/loja']);
  assert.ok(d1.seq >= 1, 'o retrato diz ate onde ja tem');

  silencioso(await iniciar(p.config, '{ nao e json').fim, 'entrada quebrada');
  const outro = pastaDeConfig(t);
  gravarPonte(outro, { porta: p.porta, token: 'c3'.repeat(32) });
  silencioso(await iniciar(outro, entrada('UserPromptSubmit', { prompt: 'Arrume o carrinho' })).fim, 'token errado');
  assert.strictEqual((await rede.dados(p.porta)).json.seq, d1.seq, 'nada entrou');
});

// A ponte velha de um painel que caiu aponta para uma porta que outro processo pode ocupar (aqui, com o pid vivo deste
// teste): o gancho pergunta antes e, sem a prova do token, nao manda a nota nem o token.
test('gancho: outro programa na porta da ponte nao recebe a nota nem o token', async function (t) {
  const recebidos = [];
  const impostor = http.createServer(function (req, res) {
    let corpo = '';
    req.setEncoding('utf8');
    req.on('data', function (d) { corpo += d; });
    req.on('end', function () {
      recebidos.push({ metodo: req.method, caminho: req.url, token: req.headers['x-painel-token'], corpo });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ segurar: true, pedido: 'f'.repeat(32), prova: 'f'.repeat(64) }));
    });
  });
  await new Promise(function (r) { impostor.listen(0, '127.0.0.1', r); });
  t.after(function () { impostor.closeAllConnections(); impostor.close(); });
  const config = pastaDeConfig(t);
  gravarPonte(config, { porta: impostor.address().port });
  silencioso(await iniciar(config, entrada('UserPromptSubmit', { prompt: 'Arrume o carrinho' })).fim, 'impostor');
  silencioso(await iniciar(config, PERMISSAO).fim, 'impostor no pedido');
  assert.ok(recebidos.length > 0, 'o gancho perguntou');
  for (const r of recebidos) {
    assert.strictEqual(r.token, undefined, 'o token foi ao impostor: ' + JSON.stringify(r));
    assert.ok(!r.corpo.includes('carrinho') && !r.corpo.includes('sonda'), 'a nota foi ao impostor: ' + JSON.stringify(r));
    assert.ok(r.metodo === 'GET' && r.caminho.startsWith('/ola?'), 'so a pergunta: ' + JSON.stringify(r));
  }
});

// Quem responde na porta da ponte nao prende a sessao: a resposta que pinga um byte por vez nunca deixa o socket
// parado, e so o prazo total do pedido (3 s na nota) solta o gancho.
test('gancho: a resposta que pinga devagar nao prende a sessao alem do prazo da nota', async function (t) {
  const pingos = [];
  const lento = http.createServer(function (req, res) {
    res.on('error', function () {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{');
    pingos.push(setInterval(function () { res.write(' '); }, 300));
  });
  await new Promise(function (r) { lento.listen(0, '127.0.0.1', r); });
  t.after(function () {
    for (const p of pingos) clearInterval(p);
    lento.closeAllConnections();
    lento.close();
  });
  const config = pastaDeConfig(t);
  gravarPonte(config, { porta: lento.address().port });
  const r = await iniciar(config, entrada('UserPromptSubmit', { prompt: 'Arrume o carrinho' })).fim;
  silencioso(r, 'resposta que pinga');
  assert.strictEqual(r.erro, '', 'o painel que nao responde a tempo nao e erro');
  assert.ok(r.ms < 8000, 'o gancho levou ' + r.ms + ' ms');
});

// A resposta grande demais (aqui, a prova certa com 2 MB de enchimento) e descartada no teto, sem juntar tudo na
// memoria: o gancho para ali e nao manda a nota.
test('gancho: a resposta acima do teto e descartada e a nota nao segue', async function (t) {
  const recebidos = [];
  const grande = http.createServer(function (req, res) {
    recebidos.push(req.method + ' ' + req.url.split('?')[0]);
    res.on('error', function () {});
    const numero = new URL(req.url, 'http://127.0.0.1').searchParams.get('numero') || '';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ prova: ponte.prova(rede.TOKEN, numero), enchimento: 'x'.repeat(2 * 1024 * 1024),
      segurar: false }));
  });
  await new Promise(function (r) { grande.listen(0, '127.0.0.1', r); });
  t.after(function () { grande.closeAllConnections(); grande.close(); });
  const config = pastaDeConfig(t);
  gravarPonte(config, { porta: grande.address().port });
  const r = await iniciar(config, entrada('UserPromptSubmit', { prompt: 'Arrume o carrinho' })).fim;
  silencioso(r, 'resposta grande');
  assert.strictEqual(r.erro, '', 'a resposta descartada nao e erro');
  assert.deepStrictEqual(recebidos, ['GET /ola'], 'so a pergunta, sem a nota');
});

// O pedido segurado: o gancho fica vivo ate o dono decidir, e a decisao vira a saida do PermissionRequest.
async function segurarEDecidir(t, escolha) {
  const p = await painelComPonte(t);
  const aba = await rede.abrirAba(t, p.porta);
  const g = iniciar(p.config, PERMISSAO);
  const precisa = await aba.esperar(function (e) { return e.tipo === 'estado' && e.dado.estado === 'precisa'; }, 'o pedido');
  const pedido = precisa.dado.pedido.id;
  assert.match(pedido, /^[0-9a-f]{32}$/);
  assert.deepStrictEqual([precisa.dado.pedido.tipo, precisa.dado.pedido.comando], ['permissao', 'echo sonda > feito.txt']);
  assert.strictEqual(g.filho.exitCode, null, 'o gancho segue segurando a sessao');
  const r = await rede.decidir(p.porta, { sessao: ID, pedido, escolha });
  assert.deepStrictEqual([r.status, r.json], [200, { ok: true }], r.texto);
  const fim = await g.fim;
  assert.strictEqual(fim.codigo, 0, fim.erro);
  await aba.esperar(function (e) { return e.tipo === 'decisao' && e.dado.pedido === pedido && e.dado.escolha === escolha; },
    'a decisao para as abas');
  const s = (await rede.dados(p.porta)).json.sessoes.find(function (x) { return x.id === ID; });
  assert.deepStrictEqual([s.estado, s.pedido], ['trabalhando', undefined]);
  return JSON.parse(fim.saida);
}

test('gancho: com uma aba visivel o PermissionRequest segura ate o dono aprovar no painel, e aprovar vira allow', async function (t) {
  assert.deepStrictEqual(await segurarEDecidir(t, 'aprovar'),
    { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
});

test('gancho: negar no painel vira deny, com o motivo para o agente', async function (t) {
  assert.deepStrictEqual(await segurarEDecidir(t, 'negar'), { hookSpecificOutput: { hookEventName: 'PermissionRequest',
    decision: { behavior: 'deny', message: 'Negado pelo dono no painel de sessões. Não repita o mesmo pedido: pergunte ' +
      'ao dono o que ele quer ou siga por outro caminho.' } } });
});

// "Na hora": o gancho sai bem antes do prazo do painel (aqui 15 s, abaixo do prazo deste teste); o teto de 5 s cobre
// a partida do node numa maquina lenta e reprova o pedido que ficou segurado.
const NA_HORA_MS = 5000;

test('gancho: sem aba visivel o pedido volta na hora para o terminal, sem decisao', async function (t) {
  const p = await painelComPonte(t, { prazoMs: 15000 });
  const r1 = await iniciar(p.config, PERMISSAO).fim;
  silencioso(r1, 'sem aba');
  assert.ok(r1.ms < NA_HORA_MS, 'sem aba: o gancho levou ' + r1.ms + ' ms');
  const escondida = await rede.abrirAba(t, p.porta, { visivel: false });
  const r2 = await iniciar(p.config, PERMISSAO).fim;
  silencioso(r2, 'aba escondida');
  assert.ok(r2.ms < NA_HORA_MS, 'aba escondida: o gancho levou ' + r2.ms + ' ms');
  const precisa = await escondida.esperar(function (e) { return e.tipo === 'estado' && e.dado.estado === 'precisa'; });
  await escondida.esperar(function (e) { return e.tipo === 'voltou' && e.dado.pedido === precisa.dado.pedido.id; },
    'o pedido que voltou');
});

test('gancho: o prazo do painel vence e o pedido volta para o terminal sem decisao', async function (t) {
  const p = await painelComPonte(t, { prazoMs: 300 });
  const aba = await rede.abrirAba(t, p.porta);
  silencioso(await iniciar(p.config, PERMISSAO).fim, 'prazo vencido');
  await aba.esperar(function (e) { return e.tipo === 'voltou'; }, 'o pedido que voltou');
});

test('gancho: o painel que cai no meio da espera solta a sessao', async function (t) {
  const p = await painelComPonte(t);
  const aba = await rede.abrirAba(t, p.porta);
  const g = iniciar(p.config, PERMISSAO);
  await aba.esperar(function (e) { return e.tipo === 'estado' && e.dado.estado === 'precisa'; }, 'o pedido');
  p.servidor.close();
  silencioso(await g.fim, 'painel fechado');
});
