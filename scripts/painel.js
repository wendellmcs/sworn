#!/usr/bin/env node
'use strict';
// Painel de sessoes (pedido 15, D927): o servidor do painel.
//
//   node scripts/painel.js [--porta N]               fase 3: ao vivo, as sessoes do Claude Code desta maquina
//   node scripts/painel.js --prototipo [--porta N]   fase 2: o prototipo navegavel, com dados simulados
//
// Escuta so em 127.0.0.1 ate a fase 5 (a rede e decisao do dono, D927). Serve so a pasta painel/prototipo, sem nada
// com `..`. No prototipo, manda os eventos de painel/prototipo/simulado.json por SSE (`/eventos`), um a cada
// RITMO_PADRAO ms, na ordem do arquivo. Ao vivo, as rotas de scripts/lib/painel-rotas.js recebem as notas do gancho
// das sessoes e a ponte (scripts/lib/painel-ponte.js) diz ao gancho a porta e o token. So Node puro, sem dependencia.
const http = require('http');
const fs = require('fs');
const net = require('net');
const path = require('path');
// So o ondeQuebrou: a linha e a coluna do JSON quebrado, no mesmo texto que o roteiro da captura usa.
const { ondeQuebrou } = require('./lib/roteiro.js');
const ponte = require('./lib/painel-ponte.js');
const { criarVivo } = require('./lib/painel-rotas.js');

const ENDERECO = '127.0.0.1';
const PASTA_PROTOTIPO = path.join(__dirname, '..', 'painel', 'prototipo');
const RITMO_PADRAO = 4000;
const RECONEXAO_MS = 3000;
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
// O tipo do evento vai cru na linha `event:` do SSE: uma quebra de linha nele inventaria outro campo.
const TIPO_EVENTO = /^[a-z]+$/;
// O caminho pedido, ja decodificado: so letras sem acento, digitos, `.`, `_`, `-` e `/`. Fica de fora a barra
// invertida, o `:` (unidade e fluxo alternativo no Windows), o `%` e o byte nulo.
const CAMINHO_ACEITO = /^\/[A-Za-z0-9._\/-]*$/;
const USO = 'uso: node scripts/painel.js [--prototipo] [--porta N] [--endereco 127.0.0.1]\n' +
  '  sem --prototipo: o painel ao vivo das sessoes do Claude Code desta maquina; abra o endereco que ele imprime,\n' +
  '    que ja leva a chave de acesso\n' +
  '  --porta N: a porta do painel; 0, o padrao, escolhe uma livre\n' +
  '  --prototipo: o prototipo do painel, com dados simulados\n' +
  '  --endereco so aceita 127.0.0.1 por enquanto: abrir o painel de outra maquina ainda nao existe\n';
// Quanto o painel que sobe espera a porta do outro painel responder, antes de contar a ponte como velha.
const ESPERA_DO_OUTRO_MS = 1500;

// A regra mora aqui, e o lerSimulado e o criarServidor passam por ela: quem chama o servidor direto, sem o
// arquivo, tambem nao consegue por uma quebra de linha na linha `event:`.
function conferirEventos(eventos, origem) {
  if (!Array.isArray(eventos)) throw new Error(origem + ': "eventos" precisa ser uma lista');
  eventos.forEach(function (e, i) {
    if (!e || typeof e.tipo !== 'string' || !TIPO_EVENTO.test(e.tipo)) {
      throw new Error(origem + ': o evento ' + (i + 1) + ' tem o tipo ' + JSON.stringify(e && e.tipo) +
        ', e o tipo so aceita letras minusculas sem acento');
    }
  });
}

function lerSimulado(arquivo) {
  let texto;
  try { texto = fs.readFileSync(arquivo, 'utf8'); } catch (e) {
    throw new Error(arquivo + ': nao consegui ler o arquivo (' + (e.code || e.message) + ')');
  }
  // O Bloco de Notas do Windows grava a marca de ordem de bytes (BOM) no inicio, e o JSON.parse nao a aceita.
  if (texto.charCodeAt(0) === 0xFEFF) texto = texto.slice(1);
  let dados;
  try { dados = JSON.parse(texto); } catch (e) {
    throw new Error(arquivo + ': o JSON esta quebrado, ' + ondeQuebrou(e.message, texto));
  }
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
    throw new Error(arquivo + ': o arquivo precisa ser um objeto JSON');
  }
  conferirEventos(dados.eventos, arquivo);
  for (const chave of ['projetos', 'maquinas', 'sessoes']) {
    if (!Array.isArray(dados[chave])) throw new Error(arquivo + ': "' + chave + '" precisa ser uma lista');
  }
  return dados;
}

function cabecalhos(extra) {
  return Object.assign({
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'Referrer-Policy': 'no-referrer',
  }, extra);
}

function responder(res, status, texto, extra) {
  res.writeHead(status, cabecalhos(Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, extra)));
  res.end(texto + '\n');
}

function dentro(arquivo, raiz) {
  return arquivo === raiz || arquivo.startsWith(raiz + path.sep);
}

// Defesa contra DNS rebinding: um site de fora que resolve para 127.0.0.1 chega com o nome dele no Host.
function hostAceito(host, porta) {
  const m = /^(127\.0\.0\.1|localhost)(?::(\d+))?$/.exec(String(host || '').toLowerCase());
  return Boolean(m) && (m[2] === undefined || Number(m[2]) === porta);
}

function transmitir(req, res, eventos, ritmo) {
  res.writeHead(200, cabecalhos({ 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' }));
  if (req.method === 'HEAD') return res.end();
  // O navegador manda o id do ultimo evento que recebeu ao reconectar: a lista segue dali, sem repetir.
  const ultimo = /^\d+$/.test(String(req.headers['last-event-id'] || '')) ? Number(req.headers['last-event-id']) : 0;
  let proximo = Math.min(ultimo, eventos.length);
  res.write('retry: ' + RECONEXAO_MS + '\n\n');
  const timer = setInterval(function () {
    if (proximo >= eventos.length) { clearInterval(timer); return; }
    const evento = eventos[proximo];
    proximo += 1;
    res.write('id: ' + proximo + '\nevent: ' + evento.tipo + '\ndata: ' + JSON.stringify(evento) + '\n\n');
  }, ritmo);
  res.on('close', function () { clearInterval(timer); });
}

function criarServidor(opcoes) {
  const pasta = path.resolve(opcoes.pasta);
  const raizReal = fs.realpathSync(pasta);
  const eventos = opcoes.eventos === undefined ? [] : opcoes.eventos;
  conferirEventos(eventos, 'criarServidor');
  if (opcoes.ritmo !== undefined && !(Number.isInteger(opcoes.ritmo) && opcoes.ritmo > 0)) {
    throw new Error('criarServidor: o ritmo precisa ser um inteiro de milissegundos maior que zero');
  }
  const ritmo = opcoes.ritmo === undefined ? RITMO_PADRAO : opcoes.ritmo;
  // Ao vivo (`opcoes.vivo`: token, chave e os prazos), as rotas do gancho e da aba; sem ele, o prototipo.
  const rotas = opcoes.vivo ? criarVivo(Object.assign({}, opcoes.vivo, { cabecalhos })) : null;
  const servidor = http.createServer(function (req, res) {
    const porta = servidor.address().port;
    const endereco = 'http://' + ENDERECO + ':' + porta + '/';
    if (!hostAceito(req.headers.host, porta)) {
      req.resume();
      return responder(res, 403, 'host recusado: abra o painel por ' + endereco);
    }
    const i = req.url.indexOf('?');
    let nome;
    try { nome = decodeURIComponent(i === -1 ? req.url : req.url.slice(0, i)); } catch (e) {
      req.resume();
      return responder(res, 400, 'caminho invalido');
    }
    if (!CAMINHO_ACEITO.test(nome) || nome.split('/').indexOf('..') !== -1) {
      req.resume();
      return responder(res, 400, 'caminho invalido');
    }
    if (rotas && rotas.atender(req, res, nome, new URLSearchParams(i === -1 ? '' : req.url.slice(i + 1)), porta)) {
      return undefined;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      req.resume();
      return responder(res, 405, 'metodo nao aceito: ' + (rotas ? 'a pagina do painel' : 'o prototipo') +
        ' so responde a GET e HEAD; abra ' + endereco + ' no navegador', { Allow: 'GET, HEAD' });
    }
    if (!rotas && nome === '/eventos') return transmitir(req, res, eventos, ritmo);
    // O cliente le o retrato em /dados.json nos dois modos: no prototipo, e o simulado.
    if (!rotas && nome === '/dados.json') nome = '/simulado.json';
    if (nome === '/') nome = '/index.html';
    const arquivo = path.resolve(pasta, '.' + nome);
    if (!dentro(arquivo, pasta)) return responder(res, 404, 'nao encontrado');
    // O realpath pega o atalho (link simbolico) de dentro da pasta que aponta para fora dela.
    return fs.realpath(arquivo, function (erroReal, real) {
      if (erroReal || !dentro(real, raizReal)) return responder(res, 404, 'nao encontrado');
      return fs.stat(real, function (erro, info) {
        if (erro || !info.isFile()) return responder(res, 404, 'nao encontrado');
        const tipo = TIPOS[path.extname(real).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, cabecalhos({ 'Content-Type': tipo, 'Content-Length': info.size }));
        if (req.method === 'HEAD') return res.end();
        return fs.createReadStream(real).on('error', function (e) {
          // O 200 ja saiu: so resta cortar a conexao, e o motivo fica no stderr para quem mantem.
          process.stderr.write('painel: erro ao ler ' + nome + ' (' + (e.code || e.message) + ')\n');
          res.destroy();
        }).pipe(res);
      });
    });
  });
  if (rotas) {
    // O close do Node espera as conexoes abertas (os /eventos das abas e os /decisao dos ganchos): as rotas fecham
    // antes, e quem espera recebe a resposta.
    const fecharServidor = servidor.close.bind(servidor);
    servidor.close = function (fim) {
      rotas.fechar();
      return fecharServidor(fim);
    };
  }
  return servidor;
}

function erroDeUso(texto) {
  process.stderr.write('ERRO: ' + texto + '\n' + USO);
  return 2;
}

function principal(args) {
  let prototipo = false;
  let porta = 0;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--prototipo') prototipo = true;
    else if (a === '--porta') {
      const v = args[i += 1];
      if (!/^\d{1,5}$/.test(v || '') || Number(v) > 65535) return erroDeUso('--porta precisa ser um numero de 0 a 65535');
      porta = Number(v);
    } else if (a === '--endereco') {
      if (args[i += 1] !== ENDERECO) {
        return erroDeUso('o painel so escuta em 127.0.0.1 por enquanto: tire o --endereco ou passe --endereco 127.0.0.1');
      }
    } else return erroDeUso('opcao desconhecida: ' + a);
  }
  if (!prototipo) {
    subirAoVivo(porta);
    return 0;
  }
  let simulado;
  try { simulado = lerSimulado(path.join(PASTA_PROTOTIPO, 'simulado.json')); } catch (e) {
    process.stderr.write('ERRO: ' + e.message + '\n');
    return 1;
  }
  const servidor = criarServidor({ pasta: PASTA_PROTOTIPO, eventos: simulado.eventos });
  servidor.on('error', function (e) {
    process.stderr.write('ERRO: o painel nao subiu: ' + motivoDaFalha(e, porta) + '\n');
    process.exitCode = 1;
  });
  servidor.listen(porta, ENDERECO, function () {
    process.stdout.write('painel: http://' + ENDERECO + ':' + servidor.address().port +
      '/ (prototipo, dados simulados; Ctrl+C para parar)\n');
  });
  return 0;
}

// O outro painel da ponte esta de pe se a porta dele responde. O pid ja foi conferido antes: o ponte.ler devolve null
// para a ponte de pid morto. A ponte de um painel que caiu sem apagar fica velha, e o painel novo grava por cima.
function outroDePe(dados, fim) {
  if (!dados) return fim(false);
  let feito = false;
  const sonda = net.connect({ host: ENDERECO, port: dados.porta });
  const relogio = setTimeout(function () { acabar(false); }, ESPERA_DO_OUTRO_MS);
  function acabar(dePe) {
    if (feito) return;
    feito = true;
    clearTimeout(relogio);
    sonda.destroy();
    fim(dePe);
  }
  sonda.on('connect', function () { acabar(true); });
  sonda.on('error', function () { acabar(false); });
  return undefined;
}

// O painel ao vivo: um por maquina, porque o gancho das sessoes so conhece uma ponte. A chave vai so no endereco que o
// terminal imprime; o token, so na ponte, que o gancho le.
function subirAoVivo(porta) {
  const outro = ponte.ler();
  outroDePe(outro, function (dePe) {
    if (dePe) {
      process.stderr.write('ERRO: ja ha um painel ao vivo nesta maquina (pid ' + outro.pid + ', porta ' + outro.porta +
        '): use o endereco que o terminal dele imprimiu, ou pare ele com Ctrl+C e suba de novo\n');
      process.exitCode = 1;
      return;
    }
    const token = ponte.novoToken();
    const chave = ponte.novoToken();
    const servidor = criarServidor({ pasta: PASTA_PROTOTIPO, vivo: { token, chave } });
    servidor.on('error', function (e) {
      process.stderr.write('ERRO: o painel nao subiu: ' + motivoDaFalha(e, porta) + '\n');
      process.exitCode = 1;
    });
    servidor.listen(porta, ENDERECO, function () {
      const p = servidor.address().port;
      try {
        ponte.gravar({ porta: p, token, pid: process.pid });
      } catch (e) {
        process.stderr.write('ERRO: o painel subiu, mas nao gravou o arquivo que as sessoes leem para achar o painel (' +
          ponte.caminho() + ': ' + (e.code || e.message) + '); confira se essa pasta aceita gravacao e se ha espaco ' +
          'em disco, e suba o painel de novo\n');
        process.exitCode = 1;
        servidor.close();
        return;
      }
      process.on('exit', function () { ponte.apagar(process.pid); });
      for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        process.on(sinal, function () { process.exit(0); });
      }
      process.stdout.write('painel: http://' + ENDERECO + ':' + p + '/?chave=' + chave +
        ' (ao vivo nesta maquina; Ctrl+C para parar)\n');
    });
  });
}

// Por que o servidor nao subiu, em portugues e com o que fazer.
function motivoDaFalha(e, porta) {
  const outra = 'escolha outra com --porta N, ou --porta 0 para uma livre';
  if (e.code === 'EADDRINUSE') return 'a porta ' + porta + ' ja esta em uso; ' + outra;
  if (e.code === 'EACCES') return 'sem permissao para escutar na porta ' + porta + '; ' + outra;
  // o erro que o painel nao conhece vai com o texto do sistema, o unico que diz a causa; a porta fica como hipotese
  const detalhe = e.message || e.code || 'erro sem codigo nem mensagem';
  return 'nao deu para escutar na porta ' + porta + ' (' + detalhe + '); se a causa for a porta, ' + outra;
}

module.exports = { criarServidor, lerSimulado, principal, hostAceito, motivoDaFalha };

if (require.main === module) process.exitCode = principal(process.argv.slice(2));
