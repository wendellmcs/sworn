'use strict';
// Painel de sessoes, fase 2 (D927). Passo P1: o servidor do prototipo e os dados simulados. O servidor escuta so em
// 127.0.0.1, serve so a pasta do prototipo (nada com `..`) e manda os eventos simulados por SSE, na ordem do arquivo.
// Passo P2 (do meio do arquivo): a pagina do prototipo e a logica sem tela dela, em estado.js.
// Passo P3 (os testes do fim): decidir e responder pelo painel lateral, a visao de equipe, o trecho do diff e as mensagens do
// servidor que dizem o que fazer.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'painel.js');
const SIMULADO = path.join(__dirname, '..', 'painel', 'prototipo', 'simulado.json');
const painel = require(SCRIPT);
// Prazo de toda espera de rede ou de processo: sem ele, um servidor que nao responde trava a suite em vez de reprovar.
const PRAZO_MS = 10000;

function pastaTemporaria(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-painel-'));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

function pastaDeTeste(t) {
  const dir = pastaTemporaria(t);
  const pasta = path.join(dir, 'prototipo');
  fs.mkdirSync(pasta);
  fs.writeFileSync(path.join(pasta, 'index.html'), '<!doctype html><h1>Prototipo</h1>');
  fs.writeFileSync(path.join(pasta, 'painel.css'), 'body { margin: 0 }');
  fs.writeFileSync(path.join(dir, 'segredo.txt'), 'fora da pasta');
  return pasta;
}

async function subir(t, opcoes) {
  const servidor = painel.criarServidor(opcoes);
  await new Promise(function (r) { servidor.listen(0, '127.0.0.1', r); });
  t.after(function () { servidor.closeAllConnections(); servidor.close(); });
  return servidor;
}

// Pedido cru, pelo socket: o http.get normaliza o caminho, e o teste precisa mandar o `..` como o atacante manda.
function pedidoCru(porta, linha, host) {
  return new Promise(function (resolver, rejeitar) {
    const s = net.connect(porta, '127.0.0.1', function () {
      s.write(linha + '\r\nHost: ' + (host === undefined ? '127.0.0.1:' + porta : host) +
        '\r\nConnection: close\r\n\r\n');
    });
    s.setTimeout(PRAZO_MS, function () { s.destroy(new Error(linha + ': sem resposta em ' + PRAZO_MS + ' ms')); });
    let texto = '';
    s.on('data', function (d) { texto += d; });
    s.on('end', function () {
      const m = /^HTTP\/1\.[01] (\d{3}) /.exec(texto);
      if (m) resolver({ status: Number(m[1]), texto });
      else rejeitar(new Error(linha + ': resposta sem a linha de status: ' + JSON.stringify(texto.slice(0, 80))));
    });
    s.on('error', rejeitar);
  });
}

// Le o /eventos ate juntar `quantos` blocos com `data:`. Reprova se a conexao fechar antes, se der erro ou se o
// prazo passar. Junta o bloco inteiro, ate a linha em branco, mesmo quando ele chega partido em dois pedacos.
function lerEventos(porta, quantos, cabecalhos) {
  return new Promise(function (resolver, rejeitar) {
    const blocos = [];
    let resto = '';
    let conteudo = '';
    let feito = false;
    function acabar(erro) {
      if (feito) return;
      feito = true;
      clearTimeout(relogio);
      req.destroy();
      if (erro) rejeitar(erro); else resolver({ conteudo, blocos });
    }
    const relogio = setTimeout(function () {
      acabar(new Error('/eventos: ' + blocos.length + ' de ' + quantos + ' eventos em ' + PRAZO_MS + ' ms'));
    }, PRAZO_MS);
    const req = http.get({ host: '127.0.0.1', port: porta, path: '/eventos', headers: cabecalhos || {} },
      function (res) {
        conteudo = res.headers['content-type'] || '';
        res.setEncoding('utf8');
        res.on('data', function (d) {
          resto += d;
          let fim;
          try {
            while ((fim = resto.indexOf('\n\n')) !== -1) {
              const bloco = resto.slice(0, fim);
              resto = resto.slice(fim + 2);
              const dado = bloco.split('\n').find(function (l) { return l.startsWith('data: '); });
              if (dado) blocos.push({ bloco, evento: JSON.parse(dado.slice(6)) });
            }
          } catch (e) { return acabar(e); }
          if (blocos.length >= quantos) acabar();
        });
        res.on('end', function () {
          acabar(new Error('/eventos fechou com ' + blocos.length + ' de ' + quantos + ' eventos'));
        });
        res.on('error', acabar);
      });
    req.on('error', acabar);
  });
}

test('o servidor serve a pasta do prototipo e o / e o index.html', async function (t) {
  const pasta = pastaDeTeste(t);
  const servidor = await subir(t, { pasta, eventos: [] });
  const porta = servidor.address().port;
  assert.strictEqual(servidor.address().address, '127.0.0.1');
  const raiz = await pedidoCru(porta, 'GET / HTTP/1.1');
  assert.strictEqual(raiz.status, 200);
  assert.match(raiz.texto, /content-type: text\/html/i);
  assert.match(raiz.texto, /<h1>Prototipo<\/h1>/);
  const css = await pedidoCru(porta, 'GET /painel.css HTTP/1.1');
  assert.strictEqual(css.status, 200);
  assert.match(css.texto, /content-type: text\/css/i);
});

test('fora da pasta: o que nao existe da 404, e o `..` e recusado sem ler o arquivo', async function (t) {
  const pasta = pastaDeTeste(t);
  const servidor = await subir(t, { pasta, eventos: [] });
  const porta = servidor.address().port;
  assert.strictEqual((await pedidoCru(porta, 'GET /nao-existe.html HTTP/1.1')).status, 404);
  for (const caminho of ['/../segredo.txt', '/%2e%2e/segredo.txt', '/..%5csegredo.txt', '/x/../../segredo.txt']) {
    const r = await pedidoCru(porta, 'GET ' + caminho + ' HTTP/1.1');
    assert.strictEqual(r.status, 400, caminho);
    assert.doesNotMatch(r.texto, /fora da pasta/, caminho);
  }
  assert.strictEqual((await pedidoCru(porta, 'GET /%E0%A4%A HTTP/1.1')).status, 400, 'escape quebrado');
  assert.strictEqual((await pedidoCru(porta, 'POST / HTTP/1.1')).status, 405);
});

test('o servidor recusa o pedido que chega com outro Host (outro endereco na frente do 127.0.0.1)', async function (t) {
  const pasta = pastaDeTeste(t);
  const servidor = await subir(t, { pasta, eventos: [] });
  const porta = servidor.address().port;
  const outraPorta = porta === 1 ? 2 : 1;
  for (const host of ['exemplo.com', '127.0.0.1.exemplo.com:' + porta, 'localhost.exemplo.com:' + porta,
    '127.0.0.1:' + outraPorta, '']) {
    assert.strictEqual((await pedidoCru(porta, 'GET / HTTP/1.1', host)).status, 403, JSON.stringify(host));
  }
  for (const host of ['localhost:' + porta, 'LOCALHOST:' + porta, '127.0.0.1']) {
    assert.strictEqual((await pedidoCru(porta, 'GET / HTTP/1.1', host)).status, 200, host);
  }
});

test('o /eventos manda os eventos do simulado.json, na ordem do arquivo, por SSE', async function (t) {
  const simulado = painel.lerSimulado(SIMULADO);
  const servidor = await subir(t, { pasta: path.dirname(SIMULADO), eventos: simulado.eventos, ritmo: 2 });
  const r = await lerEventos(servidor.address().port, simulado.eventos.length);
  assert.match(r.conteudo, /^text\/event-stream/);
  assert.deepStrictEqual(r.blocos.map(function (b) { return b.evento; }), simulado.eventos);
  r.blocos.forEach(function (b, i) {
    assert.match(b.bloco, new RegExp('^id: ' + (i + 1) + '\\nevent: ' + simulado.eventos[i].tipo + '\\n', 'm'));
  });
});

test('o /eventos retoma depois do Last-Event-ID que o navegador manda ao reconectar', async function (t) {
  const eventos = [{ tipo: 'custo', sessao: 's1' }, { tipo: 'estado', sessao: 's2' }, { tipo: 'custo', sessao: 's3' }];
  const servidor = await subir(t, { pasta: pastaDeTeste(t), eventos, ritmo: 2 });
  const r = await lerEventos(servidor.address().port, 1, { 'Last-Event-ID': '2' });
  assert.match(r.blocos[0].bloco, /^id: 3$/m);
  assert.deepStrictEqual(r.blocos[0].evento, eventos[2]);
});

test('o simulado.json tem o que o prototipo precisa mostrar', function () {
  const s = painel.lerSimulado(SIMULADO);
  assert.ok(s.projetos.length >= 3, 'pelo menos 3 projetos');
  assert.ok(s.maquinas.length >= 2, 'pelo menos 2 maquinas');
  assert.ok(s.sessoes.length >= 9, 'pelo menos 9 sessoes');
  const estados = new Set(s.sessoes.map(function (x) { return x.estado; }));
  assert.deepStrictEqual([...estados].sort(), ['concluida', 'parada', 'precisa', 'trabalhando']);
  const origens = new Set(s.sessoes.map(function (x) { return x.origem; }));
  assert.deepStrictEqual([...origens].sort(), ['painel', 'terminal']);
  const pedidos = s.sessoes.filter(function (x) { return x.pedido; }).map(function (x) { return x.pedido.tipo; });
  assert.ok(pedidos.includes('pergunta'), 'uma pergunta do tipo AskUserQuestion');
  assert.ok(pedidos.includes('permissao'), 'um pedido de permissao');
  const ids = new Set(s.sessoes.map(function (x) { return x.id; }));
  const projetos = new Set(s.projetos.map(function (x) { return x.id; }));
  const maquinas = new Set(s.maquinas.map(function (x) { return x.id; }));
  for (const x of s.sessoes) {
    assert.ok(projetos.has(x.projeto), x.id + ': projeto ' + x.projeto);
    assert.ok(maquinas.has(x.maquina), x.id + ': maquina ' + x.maquina);
  }
  // A sala vazia tambem precisa de desenho: um projeto sem sessao.
  const comSessao = new Set(s.sessoes.map(function (x) { return x.projeto; }));
  assert.ok(s.projetos.some(function (p) { return !comSessao.has(p.id); }), 'um projeto sem sessao');
  for (const m of s.maquinas) assert.ok(['online', 'offline'].includes(m.conexao), m.id + ': conexao ' + m.conexao);
  // O pedido de permissao diz o que vai rodar (comando) ou o que vai editar (arquivo), nunca os dois.
  const permissoes = s.sessoes.map(function (x) { return x.pedido; })
    .concat(s.eventos.map(function (e) { return e.pedido; }))
    .filter(function (p) { return p && p.tipo === 'permissao'; });
  for (const p of permissoes) assert.ok(('comando' in p) !== ('arquivo' in p), 'comando ou arquivo, so um: ' + p.texto);
  assert.ok(permissoes.some(function (p) { return 'arquivo' in p; }), 'uma permissao para editar um arquivo');
  for (const e of s.eventos) {
    if (e.tipo === 'maquina') assert.ok(maquinas.has(e.maquina), 'evento de maquina que nao existe: ' + e.maquina);
    else assert.ok(ids.has(e.sessao), 'evento de sessao que nao existe: ' + e.sessao);
  }
  assert.ok(s.eventos.some(function (e) { return e.tipo === 'maquina' && e.conexao === 'offline'; }),
    'uma maquina que perde a conexao');
});

test('lerSimulado recusa evento sem tipo valido (o tipo vai cru na linha `event:` do SSE)', function (t) {
  const arquivo = path.join(pastaTemporaria(t), 'simulado.json');
  for (const tipo of ['estado\ndata: x', '', 'Estado', 42]) {
    fs.writeFileSync(arquivo, JSON.stringify({ projetos: [], maquinas: [], sessoes: [], eventos: [{ tipo, sessao: 's1' }] }));
    assert.throws(function () { painel.lerSimulado(arquivo); }, /tipo/, JSON.stringify(tipo));
  }
  fs.writeFileSync(arquivo, '{"eventos": 3}');
  assert.throws(function () { painel.lerSimulado(arquivo); }, /eventos/);
});

test('lerSimulado aceita o arquivo com BOM e, no JSON quebrado, diz qual arquivo corrigir', function (t) {
  const dir = pastaTemporaria(t);
  const arquivo = path.join(dir, 'simulado.json');
  const valido = JSON.stringify({ projetos: [], maquinas: [], sessoes: [], eventos: [{ tipo: 'custo', sessao: 's1' }] });
  // O Bloco de Notas do Windows grava a marca de ordem de bytes (EF BB BF) no inicio do arquivo.
  fs.writeFileSync(arquivo, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(valido)]));
  assert.strictEqual(painel.lerSimulado(arquivo).eventos.length, 1);
  fs.writeFileSync(arquivo, '{"eventos": [],}');
  assert.throws(function () { painel.lerSimulado(arquivo); }, function (e) {
    return e.message.indexOf(arquivo) !== -1 && /JSON/.test(e.message);
  });
  assert.throws(function () { painel.lerSimulado(path.join(dir, 'nao-existe.json')); }, /nao-existe\.json/);
});

test('criarServidor recusa evento de tipo invalido e ritmo que nao e inteiro positivo, sem cair no padrao', function (t) {
  const pasta = pastaDeTeste(t);
  assert.throws(function () { painel.criarServidor({ pasta, eventos: [{ tipo: 'x\ndata: y' }] }); }, /tipo/);
  for (const ritmo of ['50', 0, -1, 2.5]) {
    assert.throws(function () { painel.criarServidor({ pasta, eventos: [], ritmo }); }, /ritmo/, String(ritmo));
  }
});

// Roda o painel.js. Resolve com a porta quando ele imprime o endereco, ou com o codigo de saida quando ele fecha;
// passado o prazo, mata o processo e reprova.
function rodar(args) {
  return new Promise(function (resolver, rejeitar) {
    const filho = spawn(process.execPath, [SCRIPT].concat(args), { stdio: ['ignore', 'pipe', 'pipe'] });
    let saida = '';
    const relogio = setTimeout(function () {
      filho.kill();
      rejeitar(new Error('painel.js ' + args.join(' ') + ': nem endereco nem fim em ' + PRAZO_MS + ' ms: ' + saida));
    }, PRAZO_MS);
    filho.stdout.on('data', function (d) {
      saida += d;
      const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(saida);
      if (m) { clearTimeout(relogio); resolver({ filho, porta: Number(m[1]), saida }); }
    });
    filho.stderr.on('data', function (d) { saida += d; });
    // `close`, nao `exit`: o `exit` pode chegar antes do resto da saida.
    filho.on('close', function (codigo) { clearTimeout(relogio); resolver({ codigo, saida }); });
    // O processo que nem sobe reprova este teste com o motivo, em vez de derrubar a suite.
    filho.on('error', function (erro) { clearTimeout(relogio); rejeitar(erro); });
  });
}

test('pela linha de comando: --prototipo sobe em 127.0.0.1 e imprime o endereco; outro endereco, porta invalida e falta de modo sao recusados', async function (t) {
  const r = await rodar(['--prototipo']);
  t.after(function () { if (r.filho) r.filho.kill(); });
  assert.ok(r.filho, 'subiu: ' + r.saida);
  const json = await pedidoCru(r.porta, 'GET /simulado.json HTTP/1.1');
  assert.strictEqual(json.status, 200);
  assert.match(json.texto, /content-type: application\/json/i);
  const recusas = {};
  for (const args of [['--prototipo', '--endereco', '0.0.0.0'], ['--prototipo', '--porta', 'abc'],
    ['--prototipo', '--porta', '70000'], []]) {
    const e = await rodar(args);
    if (e.filho) e.filho.kill();
    assert.strictEqual(e.codigo, 2, args.join(' ') + ': ' + e.saida);
    assert.match(e.saida, /ERRO|uso:/, args.join(' '));
    recusas[args.join(' ')] = e.saida;
  }
  const fora = recusas['--prototipo --endereco 0.0.0.0'];
  assert.match(fora, /tire o --endereco/, 'diz o que fazer');
  assert.match(fora, /--endereco 127\.0\.0\.1/, 'o uso cita o --endereco');
});

test('pela linha de comando: a porta ocupada sai 1 e diz como escolher outra', async function (t) {
  const ocupante = http.createServer();
  await new Promise(function (r) { ocupante.listen(0, '127.0.0.1', r); });
  t.after(function () { ocupante.close(); });
  const r = await rodar(['--prototipo', '--porta', String(ocupante.address().port)]);
  t.after(function () { if (r.filho) r.filho.kill(); });
  assert.strictEqual(r.codigo, 1, r.saida);
  assert.match(r.saida, /ja esta em uso/);
  assert.match(r.saida, /--porta 0/);
});

// P2: a pagina do prototipo. A CSP do servidor (default-src 'self') barra script e estilo em linha e endereco de
// fora; o texto das sessoes e dado, entao o cliente so escreve por textContent. A logica sem tela (a fila, as
// contagens, os eventos, o tempo e o custo) mora em estado.js, que roda no navegador e aqui.
const PROTOTIPO = path.join(__dirname, '..', 'painel', 'prototipo');
const AGORA = Date.UTC(2026, 10, 26, 12, 0, 0);
// O evento i do simulado chega em AGORA + i * PASSO_MS.
const PASSO_MS = 4000;
function carregarEstado() { return require(path.join(PROTOTIPO, 'estado.js')); }
function idsDe(lista) { return lista.map(function (s) { return s.id; }); }

test('a pagina do prototipo cabe na CSP: script e estilo so de arquivo da pasta, nada de fora, texto nunca vira HTML', function () {
  const html = fs.readFileSync(path.join(PROTOTIPO, 'index.html'), 'utf8');
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<html lang="pt-BR">/);
  assert.doesNotMatch(html, /<style/i, 'estilo em linha');
  assert.doesNotMatch(html, /\sstyle=/i, 'atributo style');
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'manipulador em linha (onclick=...)');
  // Todo src e href, com aspas duplas, simples ou sem aspas, aponta para um arquivo desta pasta: sem esquema, sem
  // caminho absoluto e sem `..` (o servidor responde 400 a ele). A ancora do "pular para" fica na mesma pagina.
  const enderecos = [...html.matchAll(/\s(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
    .map(function (m) { return m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]; });
  for (const e of enderecos) {
    if (e.startsWith('#')) continue;
    assert.doesNotMatch(e, /^(?:[a-z][a-z0-9+.-]*:|\/|\\)|(?:^|[/\\])\.\.(?:[/\\]|$)/i, 'endereco de fora da pasta: ' + e);
    // Um endereco vazio, ou so com `?` ou `#`, vira a propria pasta, que existe: o que se quer e um arquivo.
    const arquivo = path.join(PROTOTIPO, e.split(/[?#]/)[0]);
    assert.ok(fs.existsSync(arquivo) && fs.statSync(arquivo).isFile(), 'endereco sem arquivo da pasta: "' + e + '"');
  }
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length >= 2, 'estado.js e painel.js');
  for (const s of scripts) {
    assert.strictEqual(s[2].trim(), '', 'script em linha');
    assert.match(s[1], /\ssrc\s*=/, 'script sem src');
  }
  assert.ok(enderecos.includes('painel.css'), 'a folha de estilo');
  // Sem o icone, o navegador pede /favicon.ico, leva 404 e o console da captura sai com erro.
  assert.ok(enderecos.includes('icone.svg'), 'o icone da aba');
  for (const nome of ['painel.js', 'estado.js']) {
    const js = fs.readFileSync(path.join(PROTOTIPO, nome), 'utf8');
    assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/, nome);
    assert.doesNotMatch(js, /\.style\b|setAttribute\(\s*['"]style/, nome + ': estilo em linha pelo JS');
  }
  const css = fs.readFileSync(path.join(PROTOTIPO, 'painel.css'), 'utf8');
  assert.doesNotMatch(css, /@import|url\(\s*['"]?(?:[a-z]+:)?\/\//i, 'fonte ou imagem de fora');
});

// As regras do painel.css, sem os comentarios: o seletor (cada um da lista separada por virgula) e o corpo.
function regrasDoCss() {
  const css = fs.readFileSync(path.join(PROTOTIPO, 'painel.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(function (m) {
    return { seletores: m[1].split(',').map(function (s) { return s.trim(); }), corpo: m[2] };
  });
}

test('painel.css: o enfeite do content gerado nao e lido pelo leitor de tela', function () {
  // Um content com texto ("›", "▍", com aspas duplas ou simples) entra na arvore de acessibilidade e o leitor de tela
  // le o simbolo. A forma `content: "x" / ""` da o texto alternativo vazio; a declaracao simples antes dela fica para
  // o navegador que nao a entende, que descarta a segunda.
  const TEXTO = /^(?:"[^"]+"|'[^']+')/;
  const ALTERNATIVO_VAZIO = /\/\s*(?:""|'')\s*(?:!important)?$/;
  let comTexto = 0;
  for (const r of regrasDoCss()) {
    const valores = [...r.corpo.matchAll(/(?:^|;)\s*content\s*:\s*([^;]+)/g)].map(function (m) { return m[1].trim(); });
    if (!valores.some(function (v) { return TEXTO.test(v); })) continue;
    comTexto += 1;
    assert.ok(valores.some(function (v) { return TEXTO.test(v) && ALTERNATIVO_VAZIO.test(v); }),
      r.seletores.join(', ') + ': content com texto sem o alternativo vazio');
  }
  assert.ok(comTexto >= 2, 'a seta da tarefa e o cursor da fala');
});

test('painel.css: o nome do projeto no painel lateral encolhe e quebra', function () {
  // O nome do projeto no topo do painel lateral e um item de flex: sem min-width: 0, o nome comprido de uma palavra so
  // nao encolhe e vaza do painel. As declaracoes podem estar em mais de uma regra, ou numa lista de seletores.
  const corpos = regrasDoCss().filter(function (r) {
    return r.seletores.some(function (s) { return /^\.lateral__projeto\s*>/.test(s); });
  }).map(function (r) { return r.corpo; }).join(';');
  assert.ok(corpos, 'regra para o nome dentro de .lateral__projeto');
  assert.match(corpos, /min-width\s*:\s*0\b/);
  assert.match(corpos, /overflow-wrap\s*:\s*anywhere/);
});

test('estado.js: a fila tem o que espera pelo dono, por urgencia e depois pela espera mais longa', function () {
  const E = carregarEstado();
  const dados = painel.lerSimulado(SIMULADO);
  const st = E.criar(dados, AGORA);
  assert.deepStrictEqual(idsDe(E.fila(st)), ['s2', 's4']);
  assert.deepStrictEqual(E.contar(st), { precisa: 2, trabalhando: 3, parada: 2, concluida: 2 });
  assert.deepStrictEqual(E.contar(st, 'loja-online'), { precisa: 1, trabalhando: 1, parada: 0, concluida: 1 });
  assert.deepStrictEqual(E.contar(st, 'site-institucional'), { precisa: 0, trabalhando: 0, parada: 0, concluida: 0 });
  const s2 = E.sessao(st, 's2');
  assert.strictEqual(E.minutos(s2, AGORA), 14);
  assert.strictEqual(E.minutos(s2, AGORA + 60000), 15);
  // s5 entra com urgencia alta e espera mais curta que a s2; s9, media e mais curta que a s4.
  E.aplicar(st, { tipo: 'estado', sessao: 's9', estado: 'precisa',
    pedido: { tipo: 'permissao', urgencia: 'media', texto: 'Rodar um comando', comando: 'make ics' } }, AGORA);
  E.aplicar(st, { tipo: 'estado', sessao: 's5', estado: 'precisa',
    pedido: { tipo: 'pergunta', urgencia: 'alta', texto: 'Qual chave?', opcoes: [] } }, AGORA);
  assert.deepStrictEqual(idsDe(E.fila(st)), ['s2', 's5', 's4', 's9']);
  assert.strictEqual(E.custoTotal(E.criar(dados, AGORA)), 14.46);
});

test('estado.js: os eventos do simulado mudam a sessao, a fila e a maquina, sem mexer nos dados de entrada', function () {
  const E = carregarEstado();
  const dados = painel.lerSimulado(SIMULADO);
  const st = E.criar(dados, AGORA);
  const avisos = [];
  dados.eventos.forEach(function (ev, i) {
    const r = E.aplicar(st, ev, AGORA + i * PASSO_MS);
    if (r.aviso) avisos.push(r.aviso);
  });
  assert.deepStrictEqual(idsDe(E.fila(st)), ['s2', 's4', 's7']);
  const s1 = E.sessao(st, 's1');
  assert.strictEqual(s1.estado, 'concluida');
  assert.strictEqual(s1.custoUsd, 1.97);
  const falasDaS1 = dados.eventos.filter(function (e) { return e.tipo === 'mensagem' && e.sessao === 's1'; });
  assert.ok(falasDaS1.length, 'o simulado tem fala da s1');
  assert.strictEqual(s1.conversa[s1.conversa.length - 1].texto, falasDaS1[falasDaS1.length - 1].texto);
  const s7 = E.sessao(st, 's7');
  assert.strictEqual(s7.arquivos.length, 3, 'o arquivo que ja estava na lista nao duplica');
  const agendador = s7.arquivos.find(function (a) { return a.caminho === 'app/lembretes/agendador.py'; });
  assert.ok(agendador, 'o arquivo do evento esta na lista da s7');
  assert.strictEqual(agendador.mais, 81);
  assert.strictEqual(s7.pedido.arquivo, 'app/config/fuso.py');
  const mudancaDaS7 = dados.eventos.findLastIndex(function (e) { return e.tipo === 'estado' && e.sessao === 's7'; });
  assert.ok(mudancaDaS7 >= 0, 'o simulado muda o estado da s7');
  assert.strictEqual(E.minutos(s7, AGORA + mudancaDaS7 * PASSO_MS), 0, 'o tempo no estado zera quando o estado muda');
  assert.strictEqual(E.maquina(st, 'desktop-casa').conexao, 'offline');
  assert.deepStrictEqual(idsDe(st.sessoes.filter(function (s) { return E.semSinal(st, s); })), ['s3', 's4', 's6', 's8']);
  assert.strictEqual(avisos.length, 2, avisos.join(' | '));
  assert.match(avisos[0], /lembrete por e-mail/);
  assert.match(avisos[1], /desktop-casa/);
  E.aplicar(st, { tipo: 'arquivo', sessao: 's9', caminho: 'src/ics.js', mais: 3, menos: 0 }, AGORA);
  assert.deepStrictEqual(E.sessao(st, 's9').arquivos, [{ caminho: 'src/ics.js', mais: 3, menos: 0 }]);
  function daEntrada(id) { return dados.sessoes.find(function (s) { return s.id === id; }); }
  assert.strictEqual(daEntrada('s1').custoUsd, 1.84, 'criar copia os dados');
  assert.strictEqual(daEntrada('s7').pedido, undefined, 'aplicar nao escreve nos dados de entrada');
});

test('estado.js: o pedido sai da fila quando a sessao deixa de precisar; evento desconhecido nao muda nada', function () {
  const E = carregarEstado();
  const st = E.criar(painel.lerSimulado(SIMULADO), AGORA);
  assert.deepStrictEqual(E.aplicar(st, { tipo: 'estado', sessao: 's2', estado: 'trabalhando' }, AGORA).mudou, ['s2']);
  assert.strictEqual(E.sessao(st, 's2').pedido, undefined);
  assert.deepStrictEqual(idsDe(E.fila(st)), ['s4']);
  const antes = JSON.stringify(st);
  for (const ev of [
    { tipo: 'estado', sessao: 'x9', estado: 'parada' },
    { tipo: 'estado', sessao: 's1', estado: 'dormindo' },
    { tipo: 'cometa', sessao: 's1' },
    { tipo: 'maquina', maquina: 'nenhuma', conexao: 'offline' },
    { tipo: 'maquina', maquina: 'desktop-casa', conexao: 'talvez' },
    { tipo: 'custo', sessao: 's1', custoUsd: 'muito' },
    null,
  ]) {
    const r = E.aplicar(st, ev, AGORA);
    assert.deepStrictEqual(r.mudou, [], JSON.stringify(ev));
    assert.strictEqual(r.aviso, undefined, JSON.stringify(ev));
  }
  assert.strictEqual(JSON.stringify(st), antes);
});

test('estado.js: tempo e custo no formato pt-BR; responder so na sessao aberta pelo painel', function () {
  const E = carregarEstado();
  assert.strictEqual(E.formatarTempo(0), 'agora');
  assert.strictEqual(E.formatarTempo(-3), 'agora', 'relogio adiantado nao vira tempo negativo');
  assert.strictEqual(E.formatarTempo(6), '6 min');
  assert.strictEqual(E.formatarTempo(60), '1 h');
  assert.strictEqual(E.formatarTempo(95), '1 h 35 min');
  assert.strictEqual(E.formatarTempo(240), '4 h');
  assert.match(E.formatarCusto(1.84), /^US\$\s1,84$/);
  assert.match(E.formatarCusto(14.46), /^US\$\s14,46$/);
  assert.strictEqual(E.podeResponder({ origem: 'painel' }), true);
  assert.strictEqual(E.podeResponder({ origem: 'terminal' }), false);
});

test('estado.js: os rotulos da mesa e da fila: estado, urgencia, modelo, arquivos e o limite de cada origem', function () {
  const E = carregarEstado();
  assert.deepStrictEqual(E.ESTADOS.map(E.rotuloDoEstado), ['Precisa de você', 'Trabalhando', 'Parada', 'Concluída']);
  assert.strictEqual(E.rotuloDoEstado('dormindo'), 'Estado desconhecido');
  assert.strictEqual(E.rotuloDaUrgencia({ urgencia: 'alta' }), 'Urgência alta');
  assert.strictEqual(E.rotuloDaUrgencia({ urgencia: 'baixa' }), 'Urgência baixa');
  assert.strictEqual(E.rotuloDaUrgencia({ urgencia: 'qualquer' }), 'Urgência média', 'a mesma regra da fila');
  assert.strictEqual(E.rotuloDaUrgencia(undefined), 'Urgência média');
  assert.deepStrictEqual([{ urgencia: 'alta' }, { urgencia: 'baixa' }, { urgencia: 'qualquer' }, null].map(E.urgencia),
    ['alta', 'baixa', 'media', 'media']);
  assert.strictEqual(E.resumoDaContagem({ precisa: 2, trabalhando: 3, parada: 2, concluida: 2 }),
    '2 precisam de você, 3 trabalhando, 2 paradas, 2 concluídas');
  assert.strictEqual(E.resumoDaContagem({ precisa: 1, trabalhando: 0, parada: 1, concluida: 1 }),
    '1 precisa de você, 1 parada, 1 concluída');
  assert.strictEqual(E.resumoDaContagem({ precisa: 0, trabalhando: 0, parada: 0, concluida: 0 }), 'Nenhuma sessão');
  assert.strictEqual(E.nomeDoModelo('claude-opus-5-5'), 'Opus 5.5');
  assert.strictEqual(E.nomeDoModelo('claude-haiku-5-5'), 'Haiku 5.5');
  assert.strictEqual(E.nomeDoModelo('gpt-x'), 'gpt-x', 'nome de outro formato fica como veio');
  assert.strictEqual(E.nomeDoModelo(undefined), 'Modelo não informado');
  assert.strictEqual(E.resumoDosArquivos([]), 'Nenhum arquivo mudado');
  assert.strictEqual(E.resumoDosArquivos(undefined), 'Nenhum arquivo mudado');
  assert.strictEqual(E.resumoDosArquivos([{ caminho: 'a', mais: 81, menos: 9 }]), '1 arquivo, +81 −9');
  assert.strictEqual(E.resumoDosArquivos([{ caminho: 'a', mais: 1, menos: 0 }, { caminho: 'b', mais: 2, menos: 3 }]),
    '2 arquivos, +3 −3');
  // A contagem que nao e contagem (negativa, quebrada) fica fora da soma, como o evento ja barra.
  assert.strictEqual(E.resumoDosArquivos([{ caminho: 'a', mais: -3, menos: 1.5 }, { caminho: 'b', mais: 4, menos: 2 }]),
    '2 arquivos, +4 −2');
  assert.match(E.limiteDaMesa({ origem: 'painel' }), /^Aberta pelo painel: .*responder/);
  assert.match(E.limiteDaMesa({ origem: 'terminal' }), /^Aberta no terminal: .*aprovar ou negar.*responder, use o terminal/);
});

test('estado.js: entrada torta nao quebra nem suja a tela (dados nulos, item nulo, pedido sem texto, valor negativo)', function () {
  const E = carregarEstado();
  for (const torto of [null, undefined, 'texto', 7, []]) {
    const st = E.criar(torto, AGORA);
    assert.deepStrictEqual([st.maquinas, st.projetos, st.sessoes], [[], [], []], 'dados: ' + JSON.stringify(torto));
  }
  const st = E.criar({
    maquinas: [null, { id: 'm1', conexao: 'online' }],
    projetos: ['solto', { id: 'p1', nome: 'Um' }],
    sessoes: [null, { id: 'a', estado: 'parada', maquina: 'm1', projeto: 'p1', minutosNoEstado: -5,
      conversa: [null, { quem: 'agente', texto: 'oi' }, { quem: 'dono' }] }],
  }, AGORA);
  assert.deepStrictEqual([st.maquinas.length, st.projetos.length, st.sessoes.length], [1, 1, 1], 'item que nao e objeto sai');
  const a = E.sessao(st, 'a');
  // O grampo e no inicio do estado: sem ele, a sessao ficaria "no futuro" e furaria a ordem da fila.
  assert.strictEqual(a.desde, AGORA, 'minutos negativos no estado viram zero');
  assert.deepStrictEqual(a.conversa, [{ quem: 'agente', texto: 'oi' }], 'fala sem texto sai');
  assert.strictEqual(a.nome, 'a', 'sessao sem nome mostra o id');
  assert.strictEqual(st.maquinas[0].nome, 'm1', 'maquina sem nome mostra o id');
  assert.strictEqual(E.rotuloDoProjeto(st, a), 'Um');
  assert.strictEqual(E.rotuloDoProjeto(st, { projeto: 'p9' }), 'p9');
  assert.strictEqual(E.rotuloDoProjeto(st, {}), 'Sem projeto');
  // Sessao sem projeto vira projeto '' na borda: contar(st, undefined) conta todas, e a sala "Sem projeto" mentiria.
  const semProjeto = E.criar({ sessoes: [{ id: 'c', estado: 'parada' }, { id: 'd', estado: 'parada', projeto: 'p1' }] }, AGORA);
  assert.strictEqual(semProjeto.sessoes[0].projeto, '');
  assert.strictEqual(E.rotuloDoProjeto(semProjeto, semProjeto.sessoes[0]), 'Sem projeto');
  assert.strictEqual(E.contar(semProjeto, '').parada, 1);
  // Maquina que o painel nao conhece: nao ha sinal dela, entao a mesa nao pode dizer que tem.
  assert.strictEqual(E.semSinal(semProjeto, semProjeto.sessoes[0]), true);
  // O relogio que nao e numero nao vira NaN no tempo de estado.
  assert.strictEqual(E.criar({ sessoes: [{ id: 'b', estado: 'parada' }] }, 'ontem').sessoes[0].desde > 0, true);

  const nada = [
    { tipo: 'estado', sessao: 'a', estado: 'precisa', pedido: 'faca isto' },
    { tipo: 'estado', sessao: 'a', estado: 'precisa', pedido: ['x'] },
    { tipo: 'custo', sessao: 'a', custoUsd: -1 },
    { tipo: 'arquivo', sessao: 'a', caminho: '', mais: 1, menos: 0 },
    { tipo: 'arquivo', sessao: 'a', caminho: 'x.js', mais: -1, menos: 0 },
    { tipo: 'arquivo', sessao: 'a', caminho: 'x.js', mais: 1.5, menos: 0 },
    { tipo: 'mensagem', sessao: 'a', quem: 'x', texto: 'oi' },
    { tipo: 'mensagem', sessao: 'a', quem: 'agente' },
  ];
  const antes = JSON.stringify(st);
  for (const ev of nada) assert.deepStrictEqual(E.aplicar(st, ev, AGORA).mudou, [], JSON.stringify(ev));
  assert.strictEqual(JSON.stringify(st), antes, 'evento recusado nao muda o estado');
  const r0 = E.aplicar(st, null, AGORA);
  assert.ok(Object.isFrozen(r0) && Object.isFrozen(r0.mudou), 'a resposta vazia e compartilhada e nao pode ser mudada');

  const semTexto = E.aplicar(st, { tipo: 'estado', sessao: 'a', estado: 'precisa', pedido: { tipo: 'pergunta' } }, AGORA);
  assert.deepStrictEqual(semTexto.mudou, ['a']);
  assert.doesNotMatch(semTexto.aviso, /undefined/, semTexto.aviso);
  const pergunta = E.aplicar(st, { tipo: 'estado', sessao: 'a', estado: 'precisa', pedido: { tipo: 'pergunta', texto: 'Sigo?' } }, AGORA);
  assert.doesNotMatch(pergunta.aviso, /\?\.$/, 'texto que ja termina em pontuacao nao ganha ponto: ' + pergunta.aviso);

  assert.deepStrictEqual(E.alvoDoPedido({ tipo: 'permissao', comando: 'make' }), { rotulo: 'Comando: ', valor: 'make' });
  assert.deepStrictEqual(E.alvoDoPedido({ tipo: 'permissao', arquivo: 'a.py' }), { rotulo: 'Arquivo: ', valor: 'a.py' });
  assert.strictEqual(E.alvoDoPedido({ tipo: 'pergunta' }), null);
  assert.strictEqual(E.alvoDoPedido(undefined), null);
  assert.strictEqual(E.rotuloDaOpcao('Sim'), 'Sim');
  assert.strictEqual(E.rotuloDaOpcao({ rotulo: 'Nao' }), 'Nao');
  assert.strictEqual(E.rotuloDaOpcao({ id: 1 }), 'Opção sem rótulo');
  assert.strictEqual(E.rotuloDaOpcao(null), 'Opção sem rótulo');
  assert.deepStrictEqual([E.resumoDasOpcoes(['a']), E.resumoDasOpcoes(['a', 'b']), E.resumoDasOpcoes(undefined)],
    ['1 opção', '2 opções', '0 opções']);
  assert.deepStrictEqual(E.contar(st, 'p1'), { precisa: 1, trabalhando: 0, parada: 0, concluida: 0 });

  for (let i = 0; i < E.LIMITE_DA_CONVERSA + 5; i++) E.aplicar(st, { tipo: 'mensagem', sessao: 'a', quem: 'agente', texto: 'fala ' + i }, AGORA);
  assert.strictEqual(a.conversa.length, E.LIMITE_DA_CONVERSA, 'a conversa guarda so as ultimas falas');
  assert.strictEqual(a.conversa[a.conversa.length - 1].texto, 'fala ' + (E.LIMITE_DA_CONVERSA + 4));
});

// P3: o painel lateral decide pela sessao. Aprovar, negar e escolher a opcao valem nas duas origens; a resposta
// escrita, so na sessao aberta pelo painel. Sessao sem sinal nao recebe decisao: ela nao chegaria.
function ultimaFala(s) { return s.conversa[s.conversa.length - 1]; }

test('estado.js: decidir aprova, nega ou escolhe a opcao, tira o pedido da fila e devolve a sessao ao trabalho', function () {
  const E = carregarEstado();
  const dados = painel.lerSimulado(SIMULADO);
  const st = E.criar(dados, AGORA);
  const DEPOIS = AGORA + 30000;
  const r = E.decidir(st, 's4', 'aprovar', DEPOIS);
  assert.deepStrictEqual(r.mudou, ['s4']);
  assert.match(r.aviso, /^estorno parcial \(.+\) voltou a trabalhar\. Aprovado: npm run migrar -- --banco teste$/, r.aviso);
  const s4 = E.sessao(st, 's4');
  assert.deepStrictEqual(ultimaFala(s4), { quem: 'dono', texto: 'Aprovado: npm run migrar -- --banco teste' });
  assert.strictEqual(s4.estado, 'trabalhando');
  assert.strictEqual(s4.pedido, undefined);
  assert.strictEqual(s4.desde, DEPOIS, 'o tempo no estado zera');
  assert.deepStrictEqual(idsDe(E.fila(st)), ['s2']);

  const escolha = E.decidir(st, 's2', 0, DEPOIS);
  assert.deepStrictEqual(escolha.mudou, ['s2']);
  assert.deepStrictEqual(ultimaFala(E.sessao(st, 's2')), { quem: 'dono', texto: 'Escolhido: Capital (Recomendada)' });
  assert.deepStrictEqual(E.fila(st), []);

  const outro = E.criar(dados, AGORA);
  E.decidir(outro, 's4', 'negar', DEPOIS);
  assert.deepStrictEqual(ultimaFala(E.sessao(outro, 's4')), { quem: 'dono', texto: 'Negado: npm run migrar -- --banco teste' });
  assert.strictEqual(E.sessao(outro, 's4').estado, 'trabalhando', 'negada a permissao, o agente segue sem ela');
  // Permissao sem comando nem arquivo: a fala nao inventa o alvo.
  E.aplicar(outro, { tipo: 'estado', sessao: 's9', estado: 'precisa', pedido: { tipo: 'permissao', texto: 'Seguir?' } }, AGORA);
  E.decidir(outro, 's9', 'aprovar', DEPOIS);
  assert.deepStrictEqual(ultimaFala(E.sessao(outro, 's9')), { quem: 'dono', texto: 'Aprovado.' });
  // A escolha da opcao vale tambem na sessao do terminal: e decisao, nao conversa.
  E.aplicar(outro, { tipo: 'estado', sessao: 's7', estado: 'precisa',
    pedido: { tipo: 'pergunta', texto: 'Qual fuso?', opcoes: ['UTC', { rotulo: 'America/Sao_Paulo' }] } }, AGORA);
  assert.deepStrictEqual(E.decidir(outro, 's7', 1, DEPOIS).mudou, ['s7']);
  assert.deepStrictEqual(ultimaFala(E.sessao(outro, 's7')), { quem: 'dono', texto: 'Escolhido: America/Sao_Paulo' });
});

test('estado.js: decidir recusa o que nao cabe no pedido, a sessao que nao espera e a maquina sem sinal', function () {
  const E = carregarEstado();
  const st = E.criar(painel.lerSimulado(SIMULADO), AGORA);
  const antes = JSON.stringify(st);
  for (const [id, escolha] of [
    ['s2', 3], ['s2', -1], ['s2', 1.5], ['s2', '0'], ['s2', 'aprovar'], ['s2', null],
    ['s4', 0], ['s4', 'talvez'], ['s4', undefined],
    ['s1', 'aprovar'], ['x9', 'aprovar'],
  ]) {
    const r = E.decidir(st, id, escolha, AGORA);
    assert.deepStrictEqual(r.mudou, [], id + ' ' + JSON.stringify(escolha));
    assert.strictEqual(r.aviso, undefined, id + ' ' + JSON.stringify(escolha));
  }
  assert.strictEqual(JSON.stringify(st), antes, 'decisao recusada nao muda o estado');
  E.aplicar(st, { tipo: 'maquina', maquina: 'desktop-casa', conexao: 'offline' }, AGORA);
  const semSinal = JSON.stringify(st);
  assert.deepStrictEqual(E.decidir(st, 's4', 'aprovar', AGORA).mudou, [], 'a decisao nao chegaria a sessao');
  assert.strictEqual(JSON.stringify(st), semSinal);
  // Pergunta sem lista de opcoes nao tem o que escolher.
  E.aplicar(st, { tipo: 'estado', sessao: 's5', estado: 'precisa', pedido: { tipo: 'pergunta', texto: 'Qual?' } }, AGORA);
  assert.deepStrictEqual(E.decidir(st, 's5', 0, AGORA).mudou, []);
});

test('estado.js: responder so na sessao do painel, com texto de 1 a LIMITE_DA_RESPOSTA caracteres', function () {
  const E = carregarEstado();
  const dados = painel.lerSimulado(SIMULADO);
  const st = E.criar(dados, AGORA);
  const DEPOIS = AGORA + 30000;
  const antes = JSON.stringify(st);
  // a recusa diz o porque, para a tela nao dar ao dono a causa errada
  for (const [id, texto, recusa] of [
    ['s4', 'Pode rodar', 'terminal'], ['s2', '', 'vazia'], ['s2', '   ', 'vazia'], ['s2', 42, 'vazia'],
    ['s2', undefined, 'vazia'], ['s2', 'x'.repeat(E.LIMITE_DA_RESPOSTA + 1), 'longa'], ['x9', 'oi', 'sem-sessao'],
  ]) {
    const r = E.responder(st, id, texto, DEPOIS);
    assert.deepStrictEqual([r.mudou, r.recusa], [[], recusa], id + ' ' + String(texto).slice(0, 20));
  }
  assert.strictEqual(JSON.stringify(st), antes, 'resposta recusada nao muda o estado');

  const r = E.responder(st, 's2', '  Vale a capital.  ', DEPOIS);
  assert.deepStrictEqual(r.mudou, ['s2']);
  assert.strictEqual(r.recusa, undefined);
  assert.match(r.aviso, /^frete por CEP \(.+\) recebeu a resposta/, r.aviso);
  assert.match(r.aviso, /fila/, 'diz que o pedido saiu da fila');
  const s2 = E.sessao(st, 's2');
  assert.deepStrictEqual(ultimaFala(s2), { quem: 'dono', texto: 'Vale a capital.' });
  assert.strictEqual(s2.pedido, undefined);
  assert.strictEqual(s2.estado, 'trabalhando');
  assert.strictEqual(s2.desde, DEPOIS);
  assert.deepStrictEqual(idsDe(E.fila(st)), ['s4']);

  // Sessao que ja trabalha recebe a fala sem zerar o tempo no estado; a parada volta a trabalhar.
  const s1 = E.sessao(st, 's1');
  const desdeDaS1 = s1.desde;
  const r1 = E.responder(st, 's1', 'Use o cupom de teste', DEPOIS);
  assert.deepStrictEqual(r1.mudou, ['s1']);
  assert.doesNotMatch(r1.aviso, /fila/, 'sem pedido, nada saiu da fila: ' + r1.aviso);
  assert.strictEqual(s1.desde, desdeDaS1);
  E.responder(st, 's5', 'Pus a chave nova', DEPOIS);
  assert.strictEqual(E.sessao(st, 's5').estado, 'trabalhando');
  assert.deepStrictEqual(E.responder(st, 's2', 'x'.repeat(E.LIMITE_DA_RESPOSTA), DEPOIS).mudou, ['s2'], 'o limite cabe');

  E.aplicar(st, { tipo: 'maquina', maquina: 'desktop-casa', conexao: 'offline' }, AGORA);
  const semSinal = E.responder(st, 's6', 'oi', DEPOIS);
  assert.deepStrictEqual([semSinal.mudou, semSinal.recusa], [[], 'sem-sinal'], 'a s6 e do painel, mas a maquina dela esta sem sinal');
});

test('estado.js: a visao de equipe soma sessoes, estados, custo, arquivos e a ultima atividade por projeto e por maquina', function () {
  const E = carregarEstado();
  const dados = painel.lerSimulado(SIMULADO);
  const st = E.criar(dados, AGORA);
  const MIN = 60000;
  const eq = E.equipe(st);
  function linha(lista, id) {
    const l = lista.find(function (x) { return x.id === id; });
    assert.ok(l, 'a linha ' + id);
    return [l.sessoes, l.estados, l.custoUsd, l.arquivos, l.atividade];
  }
  function est(precisa, trabalhando, parada, concluida) { return { precisa, trabalhando, parada, concluida }; }
  assert.deepStrictEqual(eq.projetos.map(function (p) { return p.id; }),
    ['loja-online', 'api-pagamentos', 'app-agenda', 'site-institucional'], 'na ordem do simulado, com o projeto vazio');
  assert.deepStrictEqual(linha(eq.projetos, 'loja-online'), [3, est(1, 1, 0, 1), 4.56, 5, AGORA - 6 * MIN]);
  assert.deepStrictEqual(linha(eq.projetos, 'api-pagamentos'), [3, est(1, 1, 1, 0), 4.56, 4, AGORA - 2 * MIN]);
  assert.deepStrictEqual(linha(eq.projetos, 'app-agenda'), [3, est(0, 1, 1, 1), 5.34, 4, AGORA - 11 * MIN]);
  assert.deepStrictEqual(linha(eq.projetos, 'site-institucional'), [0, est(0, 0, 0, 0), 0, 0, null]);
  assert.deepStrictEqual([eq.projetos[0].nome, eq.projetos[0].cor], ['loja-online', 'amber']);
  assert.deepStrictEqual(linha(eq.maquinas, 'notebook-trabalho'), [5, est(1, 2, 2, 0), 8.44, 7, AGORA - 6 * MIN]);
  assert.deepStrictEqual(linha(eq.maquinas, 'desktop-casa'), [4, est(1, 1, 0, 2), 6.02, 6, AGORA - 2 * MIN]);
  assert.strictEqual(eq.maquinas[0].conexao, 'online');
  assert.deepStrictEqual([eq.total.sessoes, eq.total.estados, eq.total.custoUsd, eq.total.arquivos, eq.total.atividade],
    [9, est(2, 3, 2, 2), 14.46, 13, AGORA - 2 * MIN]);

  // Todo evento aceito da sessao conta como atividade, o custo tambem.
  const custo = dados.eventos.find(function (e) { return e.tipo === 'custo' && e.sessao === 's1'; });
  E.aplicar(st, custo, AGORA + 4000);
  const loja = E.equipe(st).projetos[0];
  assert.deepStrictEqual([loja.custoUsd, loja.atividade], [Math.round((4.56 - 1.84 + custo.custoUsd) * 100) / 100, AGORA + 4000]);

  // Projeto e maquina que as listas nao trazem ganham linha propria, com o id como nome.
  const solto = E.criar({ maquinas: [], projetos: [], sessoes: [
    { id: 'a', estado: 'parada', projeto: 'p9', maquina: 'm9', custoUsd: 1 },
    { id: 'b', estado: 'parada' },
  ] }, AGORA);
  const eqs = E.equipe(solto);
  assert.deepStrictEqual(eqs.projetos.map(function (p) { return [p.id, p.nome, p.sessoes]; }), [['p9', 'p9', 1], ['', 'Sem projeto', 1]]);
  assert.deepStrictEqual(eqs.maquinas.map(function (m) { return [m.id, m.nome, m.conexao, m.sessoes]; }),
    [['m9', 'm9', 'offline', 1], ['', 'Sem máquina', 'offline', 1]]);
  assert.deepStrictEqual(idsDe(E.todosOsProjetos(solto)), ['p9', '']);
});

test('estado.js: o trecho do diff vira linhas tipadas, com teto, e o evento arquivo guarda ou tira o trecho', function () {
  const E = carregarEstado();
  assert.deepStrictEqual(E.linhasDoTrecho({ trecho: ['@@ -10,3 +10,4 @@', ' a', '-b', '+c', 'd', '', 7, null] }), {
    linhas: [
      { tipo: 'lugar', texto: '@@ -10,3 +10,4 @@' },
      { tipo: 'igual', texto: 'a' },
      { tipo: 'menos', texto: 'b' },
      { tipo: 'mais', texto: 'c' },
      { tipo: 'igual', texto: 'd' },
      { tipo: 'igual', texto: '' },
    ],
    cortadas: 0,
  });
  const longo = E.linhasDoTrecho({ trecho: Array.from({ length: E.LIMITE_DO_TRECHO + 5 }, function (_, i) { return '+l' + i; }) });
  assert.strictEqual(longo.linhas.length, E.LIMITE_DO_TRECHO);
  assert.strictEqual(longo.cortadas, 5);
  for (const torto of [undefined, null, {}, { trecho: 'x' }, { trecho: {} }]) {
    assert.deepStrictEqual(E.linhasDoTrecho(torto), { linhas: [], cortadas: 0 }, JSON.stringify(torto));
  }

  const st = E.criar(painel.lerSimulado(SIMULADO), AGORA);
  const trecho = ['@@ -1 +1,2 @@', '+export default x;'];
  const ev = { tipo: 'arquivo', sessao: 's9', caminho: 'src/ics.js', mais: 1, menos: 0, trecho };
  assert.deepStrictEqual(E.aplicar(st, ev, AGORA).mudou, ['s9']);
  trecho.push('+depois');
  assert.deepStrictEqual(E.sessao(st, 's9').arquivos, [{ caminho: 'src/ics.js', mais: 1, menos: 0,
    trecho: ['@@ -1 +1,2 @@', '+export default x;'] }], 'o trecho e copiado do evento');
  E.aplicar(st, { tipo: 'arquivo', sessao: 's9', caminho: 'src/ics.js', mais: 4, menos: 0 }, AGORA);
  assert.deepStrictEqual(E.sessao(st, 's9').arquivos, [{ caminho: 'src/ics.js', mais: 4, menos: 0 }],
    'o arquivo atualizado sem trecho perde o trecho velho, que ja nao bate com as contagens');
  const antes = JSON.stringify(st);
  for (const torto of ['x', {}, 3]) {
    assert.deepStrictEqual(E.aplicar(st, { tipo: 'arquivo', sessao: 's9', caminho: 'src/ics.js', mais: 1, menos: 0, trecho: torto }, AGORA).mudou,
      [], JSON.stringify(torto));
  }
  assert.strictEqual(JSON.stringify(st), antes);
  // O trecho guardado para no teto, numa aba aberta o dia inteiro; a conta do que foi cortado chega a tela igual.
  const grande = ['@@ -1,0 +1,100 @@'].concat(Array.from({ length: 100 }, function (_, i) { return '+linha ' + i; }));
  E.aplicar(st, { tipo: 'arquivo', sessao: 's9', caminho: 'src/grande.js', mais: 100, menos: 0, trecho: grande }, AGORA);
  const guardado = E.sessao(st, 's9').arquivos.find(function (a) { return a.caminho === 'src/grande.js'; });
  assert.strictEqual(guardado.trecho.length, E.LIMITE_DO_TRECHO);
  assert.deepStrictEqual(E.linhasDoTrecho(guardado).cortadas, grande.length - E.LIMITE_DO_TRECHO);
  // o arquivo que volta com trecho curto perde a conta velha do que foi cortado
  E.aplicar(st, { tipo: 'arquivo', sessao: 's9', caminho: 'src/grande.js', mais: 1, menos: 0, trecho: ['@@ -1 +1 @@', '+x'] }, AGORA);
  assert.deepStrictEqual(E.linhasDoTrecho(guardado).cortadas, 0);
  // O simulado traz trecho: o painel lateral tem diff para mostrar.
  const comTrecho = painel.lerSimulado(SIMULADO).sessoes.filter(function (s) {
    return s.arquivos.some(function (a) { return E.linhasDoTrecho(a).linhas.length > 0; });
  });
  assert.ok(comTrecho.length >= 3, 'sessoes com trecho no simulado: ' + idsDe(comTrecho).join(', '));
});

test('estado.js: o pedido novo devolve `chamado`, para a notificacao do navegador; o resto nao', function () {
  const E = carregarEstado();
  const dados = painel.lerSimulado(SIMULADO);
  const st = E.criar(dados, AGORA);
  const chamados = [];
  dados.eventos.forEach(function (ev, i) {
    const r = E.aplicar(st, ev, AGORA + i * PASSO_MS);
    if (r.chamado !== undefined) chamados.push(r.chamado);
  });
  assert.deepStrictEqual(chamados, ['s7'], 'so a s7 passa a precisar do dono; a maquina sem sinal so avisa');
  // a decisao aceita (a recusada tambem nao tem `chamado`, e nao provaria nada)
  const decidida = E.decidir(st, 's7', 'aprovar', AGORA);
  assert.deepStrictEqual(decidida.mudou, ['s7']);
  assert.strictEqual(decidida.chamado, undefined);
});

test('o servidor diz o que fazer: 403 e 405 com o endereco certo, JSON quebrado com linha e coluna, falha de subida em portugues', async function (t) {
  const servidor = await subir(t, { pasta: pastaDeTeste(t), eventos: [] });
  const porta = servidor.address().port;
  const endereco = 'http://127.0.0.1:' + porta + '/';
  const post = await pedidoCru(porta, 'POST / HTTP/1.1');
  assert.strictEqual(post.status, 405);
  assert.ok(post.texto.includes(endereco), post.texto);
  const host = await pedidoCru(porta, 'GET / HTTP/1.1', 'exemplo.invalid');
  assert.strictEqual(host.status, 403);
  assert.ok(host.texto.includes(endereco), host.texto);

  const arquivo = path.join(pastaTemporaria(t), 'simulado.json');
  fs.writeFileSync(arquivo, '{"eventos": [],}');
  assert.throws(function () { painel.lerSimulado(arquivo); }, function (e) {
    return e.message.indexOf(arquivo) !== -1 && /linha 1, coluna 16/.test(e.message) &&
      !/position|Unexpected|Expected/.test(e.message);
  });

  assert.match(painel.motivoDaFalha({ code: 'EADDRINUSE' }, 4817), /^a porta 4817 ja esta em uso; .*--porta 0/);
  const acesso = painel.motivoDaFalha({ code: 'EACCES', message: 'listen EACCES: permission denied' }, 80);
  assert.match(acesso, /permissao/);
  assert.match(acesso, /--porta/);
  assert.doesNotMatch(acesso, /permission denied/, 'sem a mensagem do Node em ingles');
  // o erro que o painel nao conhece vai com o texto do sistema, o unico que diz a causa; a porta so como hipotese
  const outra = painel.motivoDaFalha({ code: 'EXYZ', message: 'listen EXYZ: boom' }, 1);
  assert.strictEqual(outra, 'nao deu para escutar na porta 1 (listen EXYZ: boom); se a causa for a porta, escolha outra com ' +
    '--porta N, ou --porta 0 para uma livre');
  assert.match(painel.motivoDaFalha({ code: 'EXYZ' }, 1), /\(EXYZ\)/);
  assert.match(painel.motivoDaFalha({}, 1), /\(erro sem codigo nem mensagem\)/);
});
