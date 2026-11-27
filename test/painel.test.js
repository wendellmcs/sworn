'use strict';
// Painel de sessoes, fase 2 (D927). Passo P1: o servidor do prototipo e os dados simulados. O servidor escuta so em
// 127.0.0.1, serve so a pasta do prototipo (nada com `..`) e manda os eventos simulados por SSE, na ordem do arquivo.
// Passo P2 (do meio do arquivo): a pagina do prototipo e a logica sem tela dela, em estado.js.
// Passo P3 (o bloco depois do P2): decidir e responder pelo painel lateral, a visao de equipe, o trecho do diff e as mensagens do
// servidor que dizem o que fazer. Fase 3, passo P2 (o bloco "ao vivo"): o servidor ao vivo, com o /gancho, o /decisao,
// as abas e a ponte, pelos ajudantes de test/lib/painel-rede.js.
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
// passado o prazo, mata o processo e reprova. `env` entra por cima do ambiente (a pasta de config da ponte).
function rodar(args, env) {
  return new Promise(function (resolver, rejeitar) {
    const filho = spawn(process.execPath, [SCRIPT].concat(args), { stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, env) });
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

test('pela linha de comando: --prototipo sobe em 127.0.0.1 e imprime o endereco; outro endereco, porta invalida e opcao desconhecida sao recusados', async function (t) {
  const r = await rodar(['--prototipo']);
  t.after(function () { if (r.filho) r.filho.kill(); });
  assert.ok(r.filho, 'subiu: ' + r.saida);
  const json = await pedidoCru(r.porta, 'GET /simulado.json HTTP/1.1');
  assert.strictEqual(json.status, 200);
  assert.match(json.texto, /content-type: application\/json/i);
  const recusas = {};
  for (const args of [['--prototipo', '--endereco', '0.0.0.0'], ['--prototipo', '--porta', 'abc'],
    ['--prototipo', '--porta', '70000'], ['--desconhecida']]) {
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

// Duas sessoes com pedido de id conhecido, na mesma maquina: a do painel (pergunta) e a do terminal (permissao).
function comPedidos(E) {
  return E.criar({ maquinas: [{ id: 'm1', nome: 'Notebook', conexao: 'online' }], projetos: [], sessoes: [
    { id: 'p', origem: 'painel', maquina: 'm1', estado: 'precisa', pedido: { id: 'p1', tipo: 'pergunta', texto: 'Qual?' } },
    { id: 't', origem: 'terminal', maquina: 'm1', estado: 'precisa',
      pedido: { id: 'p2', tipo: 'permissao', texto: 'Rodar?', comando: 'ls' } },
  ] }, AGORA);
}

// A resposta ao pedido que voltou para o terminal nao chegaria a ninguem, e a mesa diria que ele saiu da fila.
test('estado.js: responder recusa o pedido que ja voltou para o terminal, sem mexer na sessao', function () {
  const E = carregarEstado();
  const st = comPedidos(E);
  E.aplicar(st, { tipo: 'voltou', sessao: 'p', pedido: 'p1' }, AGORA);
  const antes = JSON.stringify(st);
  const r = E.responder(st, 'p', 'Vale a capital.', AGORA + 1000);
  assert.deepStrictEqual([r.mudou, r.recusa], [[], 'voltou']);
  assert.strictEqual(JSON.stringify(st), antes);
});

// Quem decidiu foi o servidor: a aba que ve a maquina sem sinal aplica a decisao igual, so o clique dela segue recusado.
test('estado.js: o evento decisao do servidor vale com a maquina sem sinal nesta aba', function () {
  const E = carregarEstado();
  const st = comPedidos(E);
  E.aplicar(st, { tipo: 'maquina', maquina: 'm1', conexao: 'offline' }, AGORA);
  assert.deepStrictEqual(E.decidir(st, 't', 'aprovar', AGORA).mudou, [], 'o clique desta aba segue recusado');
  const r = E.aplicar(st, { tipo: 'decisao', sessao: 't', pedido: 'p2', escolha: 'aprovar' }, AGORA + 1000);
  assert.deepStrictEqual(r.mudou, ['t']);
  const t = E.sessao(st, 't');
  assert.deepStrictEqual([t.estado, t.pedido, t.desde], ['trabalhando', undefined, AGORA + 1000]);
  assert.deepStrictEqual(ultimaFala(t), { quem: 'dono', texto: 'Aprovado: ls' });
  assert.deepStrictEqual(E.aplicar(st, { tipo: 'decisao', sessao: 't', pedido: 'p2', escolha: 'aprovar' }, AGORA).mudou, [],
    'a mesma decisao de novo');
  assert.deepStrictEqual(E.aplicar(st, { tipo: 'decisao', sessao: 'p', pedido: 'p1', escolha: 'talvez' }, AGORA).mudou, [],
    'a escolha que nao cabe no pedido');
  const semFila = E.criar({ maquinas: [{ id: 'm1', nome: 'Notebook', conexao: 'online' }], projetos: [], sessoes: [
    { id: 'w', origem: 'terminal', maquina: 'm1', estado: 'trabalhando', pedido: { id: 'p3', tipo: 'permissao', comando: 'ls' } },
  ] }, AGORA);
  assert.deepStrictEqual(E.aplicar(semFila, { tipo: 'decisao', sessao: 'w', pedido: 'p3', escolha: 'aprovar' }, AGORA).mudou, [],
    'a sessao que trabalha nao esta na fila, mesmo com um pedido velho nos dados');
  assert.deepStrictEqual(E.decidir(semFila, 'w', 'aprovar', AGORA).mudou, [], 'o clique tambem');
});

// A sessao sem origem valida nos dados e do terminal, como a mesa nova do painel ao vivo: a origem fica escrita na
// sessao, e o custo, o limite da mesa e o responder leem a mesma.
test('estado.js: a sessao sem origem valida nos dados nasce do terminal', function () {
  const E = carregarEstado();
  const st = E.criar({ sessoes: [{ id: 'x' }, { id: 'y', origem: 'outra' }, { id: 'z', origem: 'painel' }] }, AGORA);
  assert.deepStrictEqual(st.sessoes.map(function (s) { return s.origem; }), ['terminal', 'terminal', 'painel']);
  assert.strictEqual(E.custoDaSessao(E.sessao(st, 'x')), 'custo não informado pelo terminal');
  assert.match(E.limiteDaMesa(E.sessao(st, 'x')), /^Aberta no terminal: /);
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

// Fase 3, passo P2: o modo ao vivo. O gancho das sessoes manda cada nota ao /gancho, com o token da ponte, e espera a
// decisao no /decisao; a aba entra pela chave que o terminal imprime, que vira o cookie, e so com ele le o retrato
// (/dados.json), os eventos (/eventos) e decide (/decidir). O pedido de permissao so fica no painel enquanto uma aba
// visivel pode decidir; senao volta para o terminal.
const rede = require('./lib/painel-rede.js');
const ponteDoPainel = require(path.join(__dirname, '..', 'scripts', 'lib', 'painel-ponte.js'));
const ID_VIVO = 'b7e3c1d2-4f5a-4b6c-9d8e-0a1b2c3d4e5f';
function nota(evento, extra) { return Object.assign({ sessao: ID_VIVO, evento, cwd: 'C:\\dev\\loja' }, extra); }
const PEDE = nota('PermissionRequest', { ferramenta: 'PowerShell', comando: 'echo sonda > feito.txt',
  descricao: 'Cria o arquivo da sonda' });
function mesa(d) { return d.sessoes.find(function (s) { return s.id === ID_VIVO; }); }
function precisa(e) { return e.tipo === 'estado' && e.dado.estado === 'precisa'; }

test('ao vivo: /gancho e /decisao pedem o token, e o corpo do /gancho tem teto e forma', async function (t) {
  const { porta } = await rede.subirVivo(t);
  for (const token of [null, 'c3'.repeat(32), rede.TOKEN.slice(1)]) {
    const r = await rede.pedir(porta, { metodo: 'POST', caminho: '/gancho', corpo: nota('SessionStart'),
      cabecalhos: token === null ? {} : { 'X-Painel-Token': token } });
    assert.strictEqual(r.status, 401, 'token ' + token);
  }
  assert.strictEqual((await rede.decisao(porta, 'x', 'c3'.repeat(32))).status, 401);
  assert.strictEqual((await rede.pedir(porta, { caminho: '/decisao?pedido=x' })).status, 401);
  const grande = JSON.stringify(nota('UserPromptSubmit', { texto: 'x'.repeat(300 * 1024) }));
  assert.strictEqual((await rede.gancho(porta, grande)).status, 413, 'com Content-Length');
  const emPedacos = await rede.pedir(porta, { metodo: 'POST', caminho: '/gancho', corpo: grande, semTamanho: true,
    cabecalhos: { 'Content-Type': 'application/json', 'X-Painel-Token': rede.TOKEN } });
  assert.strictEqual(emPedacos.status, 413, 'em pedacos');
  assert.strictEqual((await rede.gancho(porta, '{ quebrado')).status, 400);
  assert.strictEqual((await rede.gancho(porta, '[1]')).status, 400);
  const ok = await rede.gancho(porta, nota('SessionStart'));
  assert.deepStrictEqual([ok.status, ok.json], [200, { segurar: false }], ok.texto);
  assert.deepStrictEqual((await rede.gancho(porta, nota('Nada'))).json, { segurar: false }, 'a nota que nao se entende');
  const desconhecido = await rede.decisao(porta, 'f'.repeat(32));
  assert.deepStrictEqual([desconhecido.status, desconhecido.json], [200, { decisao: null }]);
  assert.strictEqual((await rede.pedir(porta, { metodo: 'GET', caminho: '/gancho' })).status, 405);
});

// O gancho pergunta antes de mandar a nota: so o painel que tem o token sabe responder o HMAC do numero. A ponte velha de
// um painel que caiu pode apontar para uma porta que outro processo ocupou.
test('ao vivo: /ola responde a prova do token para o numero do gancho, sem pedir o token', async function (t) {
  const { porta } = await rede.subirVivo(t);
  const numero = 'd4'.repeat(32);
  const r = await rede.pedir(porta, { caminho: '/ola?numero=' + numero });
  assert.deepStrictEqual([r.status, r.json], [200, { prova: ponteDoPainel.prova(rede.TOKEN, numero) }], r.texto);
  assert.notStrictEqual(r.json.prova, ponteDoPainel.prova('c3'.repeat(32), numero), 'a prova depende do token');
  for (const ruim of ['', 'curto', 'G'.repeat(64), 'd4'.repeat(33)]) {
    assert.strictEqual((await rede.pedir(porta, { caminho: '/ola?numero=' + ruim })).status, 400, 'numero ' + ruim);
  }
  assert.strictEqual((await rede.pedir(porta, { caminho: '/ola' })).status, 400, 'sem numero');
  assert.strictEqual((await rede.pedir(porta, { metodo: 'POST', caminho: '/ola?numero=' + numero, corpo: '{}' })).status, 405);
  const outroHost = await rede.pedir(porta, { caminho: '/ola?numero=' + numero, cabecalhos: { Host: 'example.test:' + porta } });
  assert.strictEqual(outroHost.status, 403, 'o Host conferido vale tambem aqui');
});

test('ao vivo: a chave do terminal vira o cookie da aba, e sem ele o retrato e os eventos recusam', async function (t) {
  const { porta } = await rede.subirVivo(t);
  const entrar = await rede.pedir(porta, { caminho: '/?chave=' + rede.CHAVE });
  assert.strictEqual(entrar.status, 302);
  assert.strictEqual(entrar.cabecalhos.location, '/');
  const cookie = String(entrar.cabecalhos['set-cookie']);
  assert.ok(cookie.startsWith('painel_' + porta + '=' + rede.CHAVE + ';'), cookie);
  for (const parte of ['HttpOnly', 'SameSite=Strict', 'Path=/']) assert.ok(cookie.includes(parte), parte + ': ' + cookie);
  const errada = await rede.pedir(porta, { caminho: '/?chave=' + 'c3'.repeat(32) });
  assert.strictEqual(errada.status, 401);
  assert.match(errada.texto, /terminal/, 'diz onde esta o endereco certo');
  for (const c of [undefined, rede.cookie(porta, 'c3'.repeat(32)), 'painel_1=' + rede.CHAVE]) {
    const r = await rede.pedir(porta, { caminho: '/dados.json', cabecalhos: c === undefined ? {} : { Cookie: c } });
    assert.strictEqual(r.status, 401, 'cookie ' + c);
    assert.match(r.texto, /terminal/);
  }
  assert.strictEqual((await rede.pedir(porta, { caminho: '/eventos' })).status, 401);
  const d = await rede.dados(porta);
  assert.strictEqual(d.status, 200);
  assert.match(d.cabecalhos['content-type'], /application\/json/);
  assert.deepStrictEqual([d.json.modo, d.json.seq, d.json.sessoes, d.json.maquinas.map(function (m) { return m.id; })],
    ['ao-vivo', 0, [], ['local']]);
  assert.strictEqual((await rede.pedir(porta, { caminho: '/' })).status, 200, 'a pagina abre sem a chave');
  assert.strictEqual((await rede.pedir(porta, { caminho: '/painel.css' })).status, 200);
  for (const r of [entrar, errada, d]) assert.ok(!r.texto.includes(rede.TOKEN), 'o token nunca sai');
});

test('ao vivo: os eventos saem com id crescente, o retrato diz ate onde ja tem, e a batida mantem a conexao', async function (t) {
  const { porta } = await rede.subirVivo(t, { batidaMs: 50 });
  const aba = await rede.abrirAba(t, porta);
  assert.strictEqual(aba.status, 200);
  await rede.gancho(porta, nota('SessionStart', { fonte: 'startup' }));
  await rede.gancho(porta, nota('UserPromptSubmit', { texto: 'Arrume o carrinho' }));
  await aba.esperar(function (e) { return e.tipo === 'mensagem'; }, 'a fala do dono');
  const ids = aba.eventos.map(function (e) { return e.id; });
  assert.deepStrictEqual(ids, ids.map(function (x, i) { return i + 1; }), 'ids 1, 2, 3...');
  assert.deepStrictEqual(aba.eventos.map(function (e) { return e.tipo; }), ['sessao', 'sessao', 'estado', 'mensagem']);
  assert.ok(aba.eventos.every(function (e) { return e.tipo === e.dado.tipo; }), 'event: e o tipo do evento');
  const d = (await rede.dados(porta)).json;
  assert.strictEqual(d.seq, ids[ids.length - 1]);
  assert.deepStrictEqual([mesa(d).nome, mesa(d).estado], ['Arrume o carrinho', 'trabalhando']);
  await aba.esperarBatida();
});

// A batida que vence entre o fechar e o 'close' da resposta nao escreve depois do fim: no Node, isso e um
// ERR_STREAM_WRITE_AFTER_END sem quem ouca. A resposta falsa so emite 'close' no fim do teste, o pior caso da janela.
test('ao vivo: depois do fechar, a batida nao escreve na aba ja encerrada', async function (t) {
  const { criarVivo } = require(path.join(__dirname, '..', 'scripts', 'lib', 'painel-rotas.js'));
  const { EventEmitter } = require('events');
  const rotas = criarVivo({ token: rede.TOKEN, chave: rede.CHAVE, batidaMs: 5, cabecalhos: function (x) { return x; } });
  const escritas = [];
  const res = Object.assign(new EventEmitter(), {
    writableEnded: false, writableLength: 0, depoisDoFim: 0,
    writeHead: function () {},
    write: function (bloco) {
      if (this.writableEnded) this.depoisDoFim += 1;
      escritas.push(bloco);
      return true;
    },
    end: function () { this.writableEnded = true; },
  });
  t.after(function () { res.emit('close'); });
  const porta = 47999;
  const req = { method: 'GET', headers: { cookie: rede.cookie(porta) } };
  const query = new URLSearchParams('cliente=' + rede.CLIENTE + '&visivel=1');
  assert.strictEqual(rotas.atender(req, res, '/eventos', query, porta), true);
  const ate = Date.now() + 5000;
  while (!escritas.includes(': batida\n\n') && Date.now() < ate) {
    await new Promise(function (ok) { setTimeout(ok, 5); });
  }
  assert.ok(escritas.includes(': batida\n\n'), 'a batida escreve enquanto a aba esta aberta');
  rotas.fechar();
  assert.strictEqual(res.writableEnded, true, 'o fechar encerra a aba');
  await new Promise(function (ok) { setTimeout(ok, 60); });
  assert.strictEqual(res.depoisDoFim, 0, 'nenhuma escrita depois do fim');
});

test('ao vivo: /decidir pede o cabecalho do painel, o cookie e a mesma origem, e so decide o pedido que o painel segura', async function (t) {
  const { porta } = await rede.subirVivo(t);
  const aba = await rede.abrirAba(t, porta);
  const r = await rede.gancho(porta, PEDE);
  assert.strictEqual(r.json.segurar, true, r.texto);
  const pedido = r.json.pedido;
  assert.match(pedido, /^[0-9a-f]{32}$/);
  assert.strictEqual((await aba.esperar(precisa)).dado.pedido.id, pedido, 'a aba recebe o pedido com o id');
  const certo = { sessao: ID_VIVO, pedido, escolha: 'aprovar' };
  const recusas = [
    [{ 'X-Painel': undefined }, certo, 403], [{ Cookie: undefined }, certo, 401],
    [{ Origin: 'http://exemplo.invalid' }, certo, 403], [{ Origin: 'http://127.0.0.1:1' }, certo, 403],
    [{ 'Sec-Fetch-Site': 'cross-site' }, certo, 403],
    [{}, Object.assign({}, certo, { escolha: 'talvez' }), 400], [{}, '{ quebrado', 400],
    [{}, Object.assign({}, certo, { pedido: 'f'.repeat(32) }), 409],
    [{}, Object.assign({}, certo, { sessao: 'outra' }), 409],
  ];
  for (const [cab, corpo, status] of recusas) {
    const x = await rede.decidir(porta, corpo, cab);
    assert.strictEqual(x.status, status, JSON.stringify(cab) + ' ' + JSON.stringify(corpo) + ': ' + x.texto);
  }
  assert.strictEqual((await rede.decidir(porta, Object.assign({}, certo, { pedido: 'f'.repeat(32) }))).json.motivo, 'voltou');
  const sim = await rede.decidir(porta, certo, { Origin: undefined, 'Sec-Fetch-Site': undefined });
  assert.deepStrictEqual([sim.status, sim.json], [200, { ok: true }], 'sem Origin nem Sec-Fetch-Site tambem vale');
  const de2 = await rede.decidir(porta, Object.assign({}, certo, { escolha: 'negar' }));
  assert.deepStrictEqual([de2.status, de2.json], [409, { ok: false, motivo: 'decidido' }]);
  await aba.esperar(function (e) { return e.tipo === 'decisao' && e.dado.pedido === pedido; }, 'a decisao');
  assert.deepStrictEqual((await rede.decisao(porta, pedido)).json, { decisao: 'aprovar' }, 'a decisao espera o gancho');
  assert.deepStrictEqual((await rede.decisao(porta, pedido)).json, { decisao: null }, 'e sai depois de entregue');
});

test('ao vivo: o pedido que ninguem ve volta para o terminal: sem aba, aba escondida, aba que fecha ou some, prazo e pedido novo', async function (t) {
  const { porta } = await rede.subirVivo(t, { folgaMs: 50 });
  assert.deepStrictEqual((await rede.gancho(porta, PEDE)).json, { segurar: false }, 'sem aba');
  assert.strictEqual(mesa((await rede.dados(porta)).json).pedido.voltou, true, 'a mesa diz que voltou');
  const escondida = await rede.abrirAba(t, porta, { visivel: false, cliente: 'aba-escondida' });
  assert.deepStrictEqual((await rede.gancho(porta, PEDE)).json, { segurar: false }, 'so aba escondida');
  await escondida.esperar(function (e) { return e.tipo === 'voltou'; }, 'o voltou');

  const aba = await rede.abrirAba(t, porta);
  const r1 = (await rede.gancho(porta, PEDE)).json;
  assert.strictEqual(r1.segurar, true);
  assert.deepStrictEqual((await rede.presenca(porta, { cliente: rede.CLIENTE, visivel: false })).json, { ok: true });
  assert.deepStrictEqual((await rede.decisao(porta, r1.pedido)).json, { decisao: null }, 'a aba que some');
  await escondida.esperar(function (e) { return e.tipo === 'voltou' && e.dado.pedido === r1.pedido; });
  assert.strictEqual((await rede.presenca(porta, { cliente: 'nunca-abriu', visivel: true })).status, 404);
  assert.strictEqual((await rede.presenca(porta, { cliente: rede.CLIENTE, visivel: true })).status, 200);

  const r2 = (await rede.gancho(porta, PEDE)).json;
  const r3 = (await rede.gancho(porta, PEDE)).json;
  assert.ok(r2.segurar && r3.segurar && r2.pedido !== r3.pedido);
  assert.deepStrictEqual((await rede.decisao(porta, r2.pedido)).json, { decisao: null }, 'o pedido novo solta o velho');
  aba.fechar();
  assert.deepStrictEqual((await rede.decisao(porta, r3.pedido)).json, { decisao: null }, 'a ultima aba visivel fecha');
});

test('ao vivo: o prazo vence, o SessionEnd solta o pedido, e fechar o servidor responde quem espera', async function (t) {
  const curto = await rede.subirVivo(t, { prazoMs: 100 });
  await rede.abrirAba(t, curto.porta);
  const r1 = (await rede.gancho(curto.porta, PEDE)).json;
  assert.strictEqual(r1.segurar, true);
  assert.deepStrictEqual((await rede.decisao(curto.porta, r1.pedido)).json, { decisao: null }, 'o prazo');

  const p = await rede.subirVivo(t);
  const aba = await rede.abrirAba(t, p.porta);
  const r2 = (await rede.gancho(p.porta, PEDE)).json;
  const espera2 = rede.decisao(p.porta, r2.pedido);
  await rede.gancho(p.porta, nota('SessionEnd', { motivo: 'prompt_input_exit' }));
  assert.deepStrictEqual((await espera2).json, { decisao: null }, 'o SessionEnd');
  assert.strictEqual(mesa((await rede.dados(p.porta)).json).estado, 'concluida');
  const tarde = await rede.decidir(p.porta, { sessao: ID_VIVO, pedido: r2.pedido, escolha: 'aprovar' });
  assert.deepStrictEqual(tarde.json, { ok: false, motivo: 'voltou' }, 'o pedido que voltou nao vira decidido');

  const r3 = (await rede.gancho(p.porta, nota('PermissionRequest', { sessao: 'outra-sessao', ferramenta: 'Edit',
    arquivo: 'C:\\dev\\loja\\a.js' }))).json;
  assert.strictEqual(r3.segurar, true);
  // a espera precisa estar no servidor antes do fechar: a resposta do /decisao em curso vem do fechar, nao do prazo
  const chegada3 = rede.chegou(p.servidor, '/decisao?pedido=' + r3.pedido);
  const espera3 = rede.decisao(p.porta, r3.pedido);
  await chegada3;
  p.servidor.close();
  assert.deepStrictEqual((await espera3).json, { decisao: null }, 'o fechar');
  assert.strictEqual(await aba.esperarFim(), null, 'o fechar termina a aba com o fim limpo, nao com a conexao caida');
});

test('ao vivo: o estado mais velho que o ultimo da sessao nao volta o relogio, e o resto do evento entra', async function (t) {
  const { porta } = await rede.subirVivo(t);
  await rede.abrirAba(t, porta);
  await rede.gancho(porta, Object.assign({}, PEDE, { quando: 2000 }));
  await rede.gancho(porta, nota('PostToolUse', { quando: 1000, ferramenta: 'Edit', arquivo: 'C:\\dev\\loja\\a.js',
    mudanca: { mais: 2, menos: 1, trecho: ['@@ -1,1 +1,2 @@', '-a', '+b', '+c'] } }));
  let s = mesa((await rede.dados(porta)).json);
  assert.strictEqual(s.estado, 'precisa', 'o PostToolUse velho chegou depois e nao tira o pedido');
  assert.deepStrictEqual(s.arquivos.map(function (a) { return [a.caminho, a.mais, a.menos]; }), [['a.js', 2, 1]]);
  await rede.gancho(porta, nota('Stop', { quando: 3000, texto: 'Pronto.' }));
  s = mesa((await rede.dados(porta)).json);
  assert.deepStrictEqual([s.estado, s.conversa[s.conversa.length - 1].texto], ['parada', 'Pronto.']);
  // o instante do futuro (relogio errado, valor quebrado) vale como agora: senao a sessao congelava ate ele chegar
  await rede.gancho(porta, nota('UserPromptSubmit', { quando: Date.now() + 1e12, texto: 'Mais uma coisa' }));
  assert.strictEqual(mesa((await rede.dados(porta)).json).estado, 'trabalhando');
  await rede.gancho(porta, nota('Stop', { quando: Date.now(), texto: 'Feito.' }));
  assert.strictEqual(mesa((await rede.dados(porta)).json).estado, 'parada', 'a sessao nao congela');
});

// Recusas que dizem o que fazer: o numero do /ola so em minusculas, e o 403 da aba aponta o endereco do terminal.
test('ao vivo: as recusas do /ola e da aba dizem o que fazer', async function (t) {
  const { porta } = await rede.subirVivo(t);
  const maiusculo = await rede.pedir(porta, { caminho: '/ola?numero=' + 'D4'.repeat(32) });
  assert.strictEqual(maiusculo.status, 400);
  assert.match(maiusculo.texto, /minusculos/, maiusculo.texto);
  const origem = await rede.decidir(porta, { sessao: ID_VIVO, pedido: 'f'.repeat(32), escolha: 'aprovar' },
    { Origin: 'http://[::1]:' + porta });
  assert.strictEqual(origem.status, 403);
  assert.match(origem.texto, /endereco que o terminal imprimiu/, origem.texto);
});

// Duas abas: a 1a aprova com o gancho ja esperando, e a decisao sai na hora. A 2a, que clica depois, ouve que o
// pedido ja foi decidido, nao que voltou para o terminal. A lembranca dura o prazo do pedido e depois se apaga.
test('ao vivo: decidir de novo o pedido ja entregue ao gancho responde decidido', async function (t) {
  const { servidor, porta } = await rede.subirVivo(t, { prazoMs: 1500 });
  await rede.abrirAba(t, porta);
  const r = (await rede.gancho(porta, PEDE)).json;
  assert.strictEqual(r.segurar, true, JSON.stringify(r));
  // o gancho ja espera quando a aba decide: a decisao vai direto para a espera, sem ficar guardada
  const chegada = rede.chegou(servidor, '/decisao?pedido=' + r.pedido);
  const espera = rede.decisao(porta, r.pedido);
  await chegada;
  const sim = await rede.decidir(porta, { sessao: ID_VIVO, pedido: r.pedido, escolha: 'aprovar' });
  assert.deepStrictEqual([sim.status, sim.json], [200, { ok: true }], sim.texto);
  assert.deepStrictEqual((await espera).json, { decisao: 'aprovar' });
  const tarde = await rede.decidir(porta, { sessao: ID_VIVO, pedido: r.pedido, escolha: 'negar' });
  assert.deepStrictEqual([tarde.status, tarde.json], [409, { ok: false, motivo: 'decidido' }]);
  const outra = await rede.decidir(porta, { sessao: 'outra-sessao', pedido: r.pedido, escolha: 'negar' });
  assert.deepStrictEqual([outra.status, outra.json], [409, { ok: false, motivo: 'voltou' }], 'so a mesma sessao');
  // passa do prazo do pedido (o prazoMs de 1500 ms la em cima), com 200 ms de folga
  await new Promise(function (ok) { setTimeout(ok, 1700); });
  const depois = await rede.decidir(porta, { sessao: ID_VIVO, pedido: r.pedido, escolha: 'negar' });
  assert.deepStrictEqual(depois.json, { ok: false, motivo: 'voltou' }, 'passado o prazo, o painel esquece o pedido');
});

// A aba que para de ler (suspensa, com a conexao aberta) nao junta eventos sem fim na memoria do painel: passou do
// teto, a conexao dela cai, e a aba que voltar reconecta e le o retrato. A outra aba segue recebendo. Com o teto
// acima da rajada, a mesma aba parada nao cai e, ao voltar a ler, recebe tudo: quem corta e o teto.
async function rajadaComAbaParada(t, teto) {
  const { porta } = await rede.subirVivo(t, { tetoDoAtraso: teto });
  const viva = await rede.abrirAba(t, porta);
  const parada = net.connect(porta, '127.0.0.1');
  t.after(function () { parada.destroy(); });
  // `erro` fica a parte do `fechou`: o corte do teto chega como fim ou como ECONNRESET, e outro erro nao e o corte
  const r = { lido: '', fechou: false, erro: null };
  parada.setEncoding('utf8');
  parada.on('error', function (e) { r.erro = e.code || e.message; });
  parada.on('close', function () { r.fechou = true; });
  await rede.comPrazo(new Promise(function (ok, falha) { parada.once('connect', ok); parada.once('error', falha); }),
    'a aba parada conectar');
  const abriu = rede.comPrazo(new Promise(function (ok, falha) {
    parada.once('data', ok);
    parada.once('close', function () { falha(new Error('a aba parada fechou antes de abrir: ' + r.lido)); });
  }), 'a aba parada abrir');
  parada.on('data', function (d) { r.lido += d; });
  parada.write('GET /eventos?cliente=aba-parada-1&visivel=1 HTTP/1.1\r\nHost: 127.0.0.1:' + porta + '\r\nCookie: ' +
    rede.cookie(porta) + '\r\n\r\n');
  await abriu;
  parada.pause();
  const fala = 'x'.repeat(64 * 1024);
  for (let i = 0; i < 80; i += 1) await rede.gancho(porta, nota('UserPromptSubmit', { texto: fala + ' ' + i }));
  await rede.gancho(porta, nota('Stop', { texto: 'fim-da-rajada' }));
  await viva.esperar(function (e) { return e.tipo === 'mensagem' && e.dado.texto === 'fim-da-rajada'; }, 'o fim');
  parada.resume();
  const ate = Date.now() + 5000;
  while (!r.fechou && !r.lido.includes('fim-da-rajada') && Date.now() < ate) {
    await new Promise(function (ok) { setTimeout(ok, 50); });
  }
  return r;
}

test('ao vivo: a aba que para de ler cai no teto do atraso, e a outra segue recebendo', async function (t) {
  const cortada = await rajadaComAbaParada(t, 32 * 1024);
  assert.ok(cortada.fechou, 'o painel cortou a aba parada (lidos ' + cortada.lido.length + ' caracteres)');
  assert.ok(cortada.erro === null || cortada.erro === 'ECONNRESET', 'o fim veio do corte, nao de outro erro: ' +
    cortada.erro);
  assert.ok(!cortada.lido.includes('fim-da-rajada'), 'o que passou do teto nao foi guardado para ela');
  const folgada = await rajadaComAbaParada(t, 64 * 1024 * 1024);
  assert.ok(folgada.lido.includes('fim-da-rajada') && !folgada.fechou && folgada.erro === null,
    'abaixo do teto, a aba parada recebe tudo: ' + folgada.erro);
});

// O fechar do servidor solta a espera do gancho; o /eventos que vinha na fila do mesmo socket nao chega as rotas, que
// ja fecharam: o close do Node corta a conexao depois da resposta em curso. (Guarda da refutacao da ronda 1 do
// painel-rotas.js: o rotaEventos nao precisa conferir o `fechado`.)
test('ao vivo: o /eventos na fila de um socket aberto nao entra depois do fechar', async function (t) {
  const { servidor, porta } = await rede.subirVivo(t);
  await rede.abrirAba(t, porta);
  const r = (await rede.gancho(porta, PEDE)).json;
  assert.strictEqual(r.segurar, true, JSON.stringify(r));
  const s = net.connect(porta, '127.0.0.1');
  t.after(function () { s.destroy(); });
  let lido = '';
  s.setEncoding('utf8');
  s.on('data', function (d) { lido += d; });
  const fechou = new Promise(function (ok) { s.on('close', ok); });
  const host = 'Host: 127.0.0.1:' + porta + '\r\n';
  // os dois pedidos vao no mesmo pacote: quando o /decisao chega, o /eventos ja esta lido na fila do socket
  const chegada = rede.chegou(servidor, '/decisao?pedido=' + r.pedido);
  s.write('GET /decisao?pedido=' + r.pedido + ' HTTP/1.1\r\n' + host + 'X-Painel-Token: ' + rede.TOKEN + '\r\n\r\n' +
    'GET /eventos?cliente=aba-tardia-1&visivel=1 HTTP/1.1\r\n' + host + 'Cookie: ' + rede.cookie(porta) + '\r\n\r\n');
  await chegada;
  const parou = new Promise(function (ok) { servidor.close(ok); });
  await rede.comPrazo(Promise.all([fechou, parou]), 'o socket e o servidor fecharem');
  assert.strictEqual(lido.split('HTTP/1.1 ').length - 1, 1, 'so a resposta do /decisao: ' + lido);
  assert.ok(lido.includes('{"decisao":null}'), lido);
  assert.ok(!lido.includes('text/event-stream'), 'o /eventos tardio nao abriu');
});

test('no prototipo: /dados.json e o simulado, e as rotas ao vivo nao existem', async function (t) {
  const servidor = await subir(t, { pasta: PROTOTIPO, eventos: [] });
  const porta = servidor.address().port;
  const d = await rede.pedir(porta, { caminho: '/dados.json' });
  assert.strictEqual(d.status, 200);
  assert.deepStrictEqual(d.json, JSON.parse(fs.readFileSync(SIMULADO, 'utf8')));
  assert.strictEqual((await rede.gancho(porta, nota('SessionStart'))).status, 405);
  assert.strictEqual((await rede.decisao(porta, 'x')).status, 404);
});

test('pela linha de comando: o ao vivo grava a ponte, imprime a chave sem o token e recusa um segundo painel', async function (t) {
  const config = pastaTemporaria(t);
  const env = { CLAUDE_CONFIG_DIR: config };
  // a ponte velha de um pid vivo cuja porta nao responde e sobrescrita
  ponteDoPainel.gravar({ porta: 1, token: 'c3'.repeat(32), pid: process.pid }, env);
  const r = await rodar([], env);
  t.after(function () { if (r.filho) r.filho.kill(); });
  assert.ok(r.filho, 'subiu: ' + r.saida);
  const chave = (/\?chave=([0-9a-f]{64}) /.exec(r.saida) || [])[1];
  assert.ok(chave, 'imprime o endereco com a chave: ' + r.saida);
  assert.match(r.saida, /ao vivo nesta maquina/);
  const lida = ponteDoPainel.ler(env);
  assert.deepStrictEqual([lida && lida.porta, lida && lida.pid], [r.porta, r.filho.pid]);
  assert.match(lida.token, /^[0-9a-f]{64}$/);
  assert.notStrictEqual(lida.token, chave);
  assert.ok(!r.saida.includes(lida.token), 'o token nunca vai para a saida');
  assert.strictEqual((await rede.pedir(r.porta, { caminho: '/?chave=' + chave })).status, 302);
  const segundo = await rodar([], env);
  if (segundo.filho) segundo.filho.kill();
  assert.strictEqual(segundo.codigo, 1, segundo.saida);
  assert.match(segundo.saida, /ja ha um painel ao vivo nesta maquina/);
  assert.match(segundo.saida, new RegExp('porta ' + r.porta));
});

test('pela linha de comando: o painel ao vivo que para apaga a ponte', { skip: process.platform === 'win32' &&
  'no Windows o kill encerra sem sinal, e o painel nao roda o que faz ao sair' }, async function (t) {
  const env = { CLAUDE_CONFIG_DIR: pastaTemporaria(t) };
  const r = await rodar([], env);
  assert.ok(r.filho, r.saida);
  assert.ok(ponteDoPainel.ler(env), 'gravou a ponte');
  await new Promise(function (resolver) { r.filho.on('close', resolver); r.filho.kill('SIGTERM'); });
  assert.strictEqual(fs.existsSync(ponteDoPainel.caminho(env)), false);
});
