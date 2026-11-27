'use strict';
// Painel de sessoes, fase 3: as rotas do painel ao vivo, que o scripts/painel.js monta quando sobe sem --prototipo.
//
//   POST /gancho    (token)   a nota de uma sessao, que o scripts/painel-gancho.js manda; responde se segura o pedido
//   GET  /decisao   (token)   o gancho espera aqui a decisao do pedido segurado (long-poll)
//   GET  /ola?numero=         o gancho confere, antes de mandar o token, que este painel o tem: responde o HMAC do
//                             token com o numero (a prova, em scripts/lib/painel-ponte.js)
//   GET  /?chave=   a chave que o terminal imprimiu vira o cookie da aba
//   GET  /dados.json, GET /eventos, POST /presenca, POST /decidir   (cookie)   o retrato, os eventos, a aba
//        visivel e a decisao do dono
//
// O token so o gancho tem (vem da ponte, scripts/lib/painel-ponte.js); a chave, so quem leu o terminal. O pedido de
// permissao so fica segurado enquanto uma aba visivel pode decidir; sem ela, volta na hora para o terminal.
const crypto = require('crypto');
const path = require('path');
const E = require(path.join(__dirname, '..', '..', 'painel', 'prototipo', 'estado.js'));
const vivo = require('./painel-vivo.js');
const { mesmoToken, prova } = require('./painel-ponte.js');
const { ehObjeto } = require('./texto.js');

const PRAZO_PADRAO_MS = 120000;
const BATIDA_PADRAO_MS = 25000;
const FOLGA_PADRAO_MS = 5000;
// A decisao que chegou antes do gancho pedir fica guardada este tempo; depois, o gancho que pedir recebe null.
const GUARDA_MS = 10000;
const RECONEXAO_MS = 3000;
// O que uma aba pode deixar de ler (suspensa, com a conexao aberta) antes de o painel cortar o /eventos dela: a aba que
// voltar reconecta e le o retrato, e o painel nao junta na memoria a fala de todas as sessoes para quem nao le.
const TETO_DO_ATRASO = 1024 * 1024;
const TETO_DA_NOTA = 256 * 1024;
const TETO_DA_ABA = 16 * 1024;
const ID_DO_PEDIDO = /^[0-9a-f]{32}$/;
const NUMERO_DO_GANCHO = /^[0-9a-f]{64}$/;
const ID_DA_ABA = /^[A-Za-z0-9_-]{8,64}$/;
const ESCOLHAS = ['aprovar', 'negar'];
const SEM_CHAVE = 'sem acesso: abra o painel pelo endereco com a chave que o terminal imprimiu ao subir';

// Le o corpo inteiro ate o teto. Passou do teto: segue lendo sem guardar e responde depois do fim, porque cortar a
// conexao no meio faria o cliente perder a resposta.
function lerCorpo(req, teto, fim) {
  const declarado = Number(req.headers['content-length']);
  let excedeu = Number.isFinite(declarado) && declarado > teto;
  const pedacos = [];
  let tamanho = 0;
  req.on('data', function (d) {
    if (excedeu) return;
    tamanho += d.length;
    if (tamanho > teto) { excedeu = true; pedacos.length = 0; return; }
    pedacos.push(d);
  });
  req.on('end', function () { fim(excedeu, excedeu ? null : Buffer.concat(pedacos).toString('utf8')); });
}

// O corpo do pedido HTTP como objeto JSON, ou null (o jsonio.js le arquivo do disco, nao corpo de pedido).
function objetoDoCorpo(texto) {
  try {
    const v = JSON.parse(texto);
    return ehObjeto(v) ? v : null;
  } catch (e) {
    return null;
  }
}

// O valor do cookie desta porta: o cookie vale por host, nao por porta, e o nome com a porta separa dois paineis.
function valorDoCookie(cabecalho, porta) {
  const nome = 'painel_' + porta;
  for (const parte of String(cabecalho || '').split(';')) {
    const i = parte.indexOf('=');
    if (i !== -1 && parte.slice(0, i).trim() === nome) return parte.slice(i + 1).trim();
  }
  return null;
}

// `o`: token e chave (64 hex cada), prazoMs (quanto o pedido fica segurado), batidaMs (o comentario que mantem o
// /eventos aberto), folgaMs (quanto espera uma aba voltar antes de soltar os pedidos), tetoDoAtraso (os bytes que uma
// aba pode deixar de ler) e cabecalhos (os do servidor).
function criarVivo(o) {
  const prazoMs = o.prazoMs === undefined ? PRAZO_PADRAO_MS : o.prazoMs;
  const batidaMs = o.batidaMs === undefined ? BATIDA_PADRAO_MS : o.batidaMs;
  const folgaMs = o.folgaMs === undefined ? FOLGA_PADRAO_MS : o.folgaMs;
  const tetoDoAtraso = o.tetoDoAtraso === undefined ? TETO_DO_ATRASO : o.tetoDoAtraso;
  const cabecalhos = o.cabecalhos;
  const st = E.criar({ maquinas: [{ id: 'local', nome: 'Esta máquina', conexao: 'online' }], projetos: [], sessoes: [] },
    Date.now());
  let seq = 0;
  let fechado = false;
  let folga = null;
  // As abas: cada /eventos aberto (ouvintes) e, das que disseram quem sao, se estao visiveis (clientes).
  const ouvintes = new Set();
  const clientes = new Map();
  // Os pedidos segurados: id -> { sessao, res (o /decisao do gancho, quando ja pediu), decisao, timer }.
  const pendentes = new Map();
  // Os pedidos ja entregues com a escolha do dono: id -> sessao, pelo prazo, para a 2a aba ouvir 'decidido'.
  const decididos = new Map();
  // O instante do ultimo evento de cada sessao: a nota async que chega fora de ordem nao volta o estado.
  const ultimas = new Map();

  function json(res, status, corpo, extra) {
    res.writeHead(status, cabecalhos(Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, extra)));
    res.end(JSON.stringify(corpo) + '\n');
  }
  function texto(res, status, t, extra) {
    res.writeHead(status, cabecalhos(Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, extra)));
    res.end(t + '\n');
  }

  function difundir(ev) {
    seq += 1;
    const bloco = 'id: ' + seq + '\nevent: ' + ev.tipo + '\ndata: ' + JSON.stringify(ev) + '\n\n';
    // Conta o que ficou sem ler dos eventos anteriores, nao o bloco novo: um evento grande nao corta a aba que le.
    for (const res of ouvintes) {
      if (res.writableLength > tetoDoAtraso) res.destroy();
      else res.write(bloco);
    }
  }
  // So o evento que mudou o estado vai para as abas: a aba aplica igual e chega ao mesmo estado.
  function aplicar(ev) {
    const r = E.aplicar(st, ev, Date.now());
    if (r.mudou.length) difundir(ev);
    return r;
  }

  function algumVisivel() {
    for (const c of clientes.values()) if (c.visivel) return true;
    return false;
  }

  function entregar(id, p) {
    pendentes.delete(id);
    clearTimeout(p.timer);
    if (!p.res.writableEnded) json(p.res, 200, { decisao: p.decisao });
  }

  // A decisao do pedido: a escolha do dono, ou null quando ele volta para o terminal (prazo, aba que sumiu, sessao que
  // seguiu). O gancho que ja espera recebe na hora; senao a decisao fica guardada ate ele pedir.
  function resolver(id, decisao) {
    const p = pendentes.get(id);
    if (!p || p.decisao !== undefined) return;
    p.decisao = decisao;
    clearTimeout(p.timer);
    if (decisao === null) aplicar({ tipo: 'voltou', sessao: p.sessao, pedido: id });
    else {
      decididos.set(id, p.sessao);
      setTimeout(function () { decididos.delete(id); }, prazoMs).unref();
    }
    if (p.res) return entregar(id, p);
    p.timer = setTimeout(function () { if (pendentes.get(id) === p) pendentes.delete(id); }, GUARDA_MS);
    p.timer.unref();
  }

  // O pedido segurado que a sessao ja nao tem (outro pedido, a sessao seguiu ou acabou) nao espera mais.
  function soltarOrfaos(sessao) {
    const s = E.sessao(st, sessao);
    const atual = s && s.pedido ? s.pedido.id : null;
    for (const [id, p] of pendentes) {
      if (p.sessao === sessao && p.decisao === undefined && id !== atual) resolver(id, null);
    }
  }

  // Sem aba visivel, os pedidos voltam depois da folga, que deixa a aba recarregar sem perder o pedido.
  function conferirPresenca() {
    if (algumVisivel()) {
      clearTimeout(folga);
      folga = null;
      return;
    }
    if (folga) return;
    folga = setTimeout(function () {
      folga = null;
      if (algumVisivel()) return;
      for (const [id, p] of pendentes) if (p.decisao === undefined) resolver(id, null);
    }, folgaMs);
    folga.unref();
  }

  function receberNota(nota) {
    // O instante do futuro (relogio errado, valor quebrado) vale como agora: senao a sessao congelava ate ele chegar.
    const agora = Date.now();
    const quando = Number.isFinite(nota.quando) && nota.quando <= agora ? nota.quando : agora;
    let eventos = vivo.traduzir(nota, E.sessao(st, nota.sessao) || null);
    if (!eventos.length) return { segurar: false };
    const ultima = ultimas.get(nota.sessao);
    if (ultima !== undefined && quando < ultima) eventos = eventos.filter(function (ev) { return ev.tipo !== 'estado'; });
    ultimas.set(nota.sessao, ultima === undefined ? quando : Math.max(ultima, quando));
    let pedido = null;
    for (const ev of eventos) {
      if (ev.tipo === 'estado' && ev.estado === 'precisa' && ev.pedido) {
        ev.pedido.id = crypto.randomBytes(16).toString('hex');
        if (aplicar(ev).mudou.length) pedido = ev.pedido.id;
      } else aplicar(ev);
    }
    soltarOrfaos(nota.sessao);
    if (nota.evento !== 'PermissionRequest' || pedido === null) return { segurar: false };
    if (fechado || !algumVisivel()) {
      aplicar({ tipo: 'voltou', sessao: nota.sessao, pedido });
      return { segurar: false };
    }
    const p = { sessao: nota.sessao, res: null, decisao: undefined, timer: null };
    p.timer = setTimeout(function () { resolver(pedido, null); }, prazoMs);
    p.timer.unref();
    pendentes.set(pedido, p);
    return { segurar: true, pedido };
  }

  function rotaGancho(req, res) {
    if (!mesmoToken(req.headers['x-painel-token'], o.token)) {
      req.resume();
      return texto(res, 401, 'token recusado');
    }
    return lerCorpo(req, TETO_DA_NOTA, function (excedeu, corpo) {
      if (excedeu) return texto(res, 413, 'nota grande demais', { Connection: 'close' });
      const nota = objetoDoCorpo(corpo);
      if (!nota) return texto(res, 400, 'a nota precisa ser um objeto JSON');
      return json(res, 200, receberNota(nota));
    });
  }

  function rotaDecisao(req, res, query) {
    if (!mesmoToken(req.headers['x-painel-token'], o.token)) return texto(res, 401, 'token recusado');
    const id = query.get('pedido') || '';
    const p = ID_DO_PEDIDO.test(id) ? pendentes.get(id) : undefined;
    if (!p) return json(res, 200, { decisao: null });
    if (p.res) return texto(res, 409, 'este pedido ja tem quem espere');
    p.res = res;
    if (p.decisao !== undefined) return entregar(id, p);
    // O gancho que desiste (a sessao seguiu pelo terminal, o processo caiu) solta o pedido.
    res.on('close', function () {
      if (pendentes.get(id) !== p || p.res !== res || res.writableEnded) return;
      p.res = null;
      resolver(id, null);
    });
    return undefined;
  }

  function rotaOla(req, res, query) {
    const numero = query.get('numero') || '';
    if (!NUMERO_DO_GANCHO.test(numero)) {
      return texto(res, 400, 'o numero precisa ter 64 digitos hexadecimais minusculos');
    }
    return json(res, 200, { prova: prova(o.token, numero) });
  }

  function comCookie(req, porta) {
    const v = valorDoCookie(req.headers.cookie, porta);
    return v !== null && mesmoToken(v, o.chave);
  }

  // A aba que manda algo: o cabecalho do painel (um formulario de outro site nao o poe), o cookie e, quando o navegador
  // diz, a mesma origem. Devolve o status da recusa, ou 0.
  function recusaDaAba(req, porta) {
    if (req.headers['x-painel'] !== '1') return 403;
    if (!comCookie(req, porta)) return 401;
    const origem = req.headers.origin;
    if (origem !== undefined && origem !== 'http://127.0.0.1:' + porta && origem !== 'http://localhost:' + porta) return 403;
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin') return 403;
    return 0;
  }

  function corpoDaAba(req, res, porta, fazer) {
    const recusa = recusaDaAba(req, porta);
    if (recusa) {
      req.resume();
      return texto(res, recusa, recusa === 401 ? SEM_CHAVE : 'pedido recusado: so a pagina do painel decide; abra o ' +
        'painel pelo endereco que o terminal imprimiu e decida por la');
    }
    return lerCorpo(req, TETO_DA_ABA, function (excedeu, corpo) {
      if (excedeu) return texto(res, 413, 'pedido grande demais', { Connection: 'close' });
      const dado = objetoDoCorpo(corpo);
      if (!dado) return texto(res, 400, 'o pedido precisa ser um objeto JSON');
      return fazer(dado);
    });
  }

  function rotaDecidir(req, res, porta) {
    return corpoDaAba(req, res, porta, function (d) {
      if (!ESCOLHAS.includes(d.escolha) || typeof d.pedido !== 'string' || typeof d.sessao !== 'string') {
        return texto(res, 400, 'a decisao precisa de sessao, pedido e escolha (aprovar ou negar)');
      }
      const p = pendentes.get(d.pedido);
      if (!p && decididos.get(d.pedido) === d.sessao) return json(res, 409, { ok: false, motivo: 'decidido' });
      if (!p || p.sessao !== d.sessao || p.decisao === null) return json(res, 409, { ok: false, motivo: 'voltou' });
      if (p.decisao !== undefined) return json(res, 409, { ok: false, motivo: 'decidido' });
      if (!aplicar({ tipo: 'decisao', sessao: d.sessao, pedido: d.pedido, escolha: d.escolha }).mudou.length) {
        return json(res, 409, { ok: false, motivo: 'voltou' });
      }
      resolver(d.pedido, d.escolha);
      return json(res, 200, { ok: true });
    });
  }

  function rotaPresenca(req, res, porta) {
    return corpoDaAba(req, res, porta, function (d) {
      if (typeof d.cliente !== 'string' || typeof d.visivel !== 'boolean') {
        return texto(res, 400, 'a presenca precisa de cliente e visivel');
      }
      const c = clientes.get(d.cliente);
      if (!c) return json(res, 404, { ok: false });
      c.visivel = d.visivel;
      conferirPresenca();
      return json(res, 200, { ok: true });
    });
  }

  function rotaEventos(req, res, query) {
    if (req.method === 'HEAD') {
      res.writeHead(200, cabecalhos({ 'Content-Type': 'text/event-stream; charset=utf-8' }));
      return res.end();
    }
    // A aba entra na conta antes da resposta sair: quem le o 200 ja pode contar com ela.
    const id = query.get('cliente');
    const cliente = id !== null && ID_DA_ABA.test(id) ? { res, visivel: query.get('visivel') === '1' } : null;
    if (cliente) clientes.set(id, cliente);
    ouvintes.add(res);
    conferirPresenca();
    res.writeHead(200, cabecalhos({ 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' }));
    res.write('retry: ' + RECONEXAO_MS + '\n\n');
    // Entre o end() do fechar e o 'close' da resposta, a batida ainda vence: sem a guarda, escreveria depois do fim.
    const batida = setInterval(function () { if (!res.writableEnded) res.write(': batida\n\n'); }, batidaMs);
    batida.unref();
    res.on('close', function () {
      clearInterval(batida);
      ouvintes.delete(res);
      if (cliente && clientes.get(id) === cliente) clientes.delete(id);
      conferirPresenca();
    });
    return undefined;
  }

  function entrar(res, query, porta) {
    if (!mesmoToken(query.get('chave'), o.chave)) return texto(res, 401, SEM_CHAVE);
    res.writeHead(302, cabecalhos({ Location: '/',
      'Set-Cookie': 'painel_' + porta + '=' + o.chave + '; HttpOnly; SameSite=Strict; Path=/' }));
    return res.end();
  }

  const ROTAS = {
    '/gancho': { metodos: ['POST'], fazer: rotaGancho },
    '/decisao': { metodos: ['GET'], fazer: rotaDecisao },
    '/ola': { metodos: ['GET'], fazer: rotaOla },
    '/decidir': { metodos: ['POST'], fazer: function (req, res, q, porta) { return rotaDecidir(req, res, porta); } },
    '/presenca': { metodos: ['POST'], fazer: function (req, res, q, porta) { return rotaPresenca(req, res, porta); } },
    '/dados.json': { metodos: ['GET', 'HEAD'], aba: true, fazer: function (req, res) {
      return json(res, 200, vivo.retrato(st, Date.now(), seq));
    } },
    '/eventos': { metodos: ['GET', 'HEAD'], aba: true, fazer: rotaEventos },
  };

  // Atende a rota ao vivo e devolve true; o que nao e dela (os arquivos da pagina) fica com o servidor.
  function atender(req, res, nome, query, porta) {
    if (nome === '/' && query.has('chave') && (req.method === 'GET' || req.method === 'HEAD')) {
      entrar(res, query, porta);
      return true;
    }
    const rota = Object.hasOwn(ROTAS, nome) ? ROTAS[nome] : null;
    if (!rota) return false;
    if (!rota.metodos.includes(req.method)) {
      req.resume();
      texto(res, 405, 'metodo nao aceito em ' + nome, { Allow: rota.metodos.join(', ') });
      return true;
    }
    if (rota.aba && !comCookie(req, porta)) {
      texto(res, 401, SEM_CHAVE);
      return true;
    }
    rota.fazer(req, res, query, porta);
    return true;
  }

  // O servidor que fecha responde quem espera (o gancho segue pelo terminal) e encerra as abas.
  function fechar() {
    if (fechado) return;
    fechado = true;
    clearTimeout(folga);
    for (const p of pendentes.values()) {
      clearTimeout(p.timer);
      if (p.res && !p.res.writableEnded) json(p.res, 200, { decisao: null });
    }
    pendentes.clear();
    clientes.clear();
    for (const res of ouvintes) res.end();
    ouvintes.clear();
  }

  return { atender, fechar };
}

module.exports = { criarVivo, valorDoCookie, PRAZO_PADRAO_MS };
