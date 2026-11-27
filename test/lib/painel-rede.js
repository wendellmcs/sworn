'use strict';
// Ajudantes dos testes do painel ao vivo (fase 3 do painel de sessoes): subir o servidor ao vivo, pedir por HTTP com
// prazo, decidir como a aba decide e abrir uma "aba" (a conexao /eventos com o cookie da chave), que junta os eventos
// que chegam. Fica em test/lib/ de proposito: o `npm test` roda so `test/*.test.js`. Quem usa: test/painel.test.js e
// test/painel-gancho.test.js; test/painel-rede.test.js prova os ajudantes contra um servidor de mentira.
const http = require('node:http');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const painel = require(path.join(RAIZ, 'scripts', 'painel.js'));
const PROTOTIPO = path.join(RAIZ, 'painel', 'prototipo');
// Prazo de toda espera: sem ele, um servidor que nao responde trava a suite em vez de reprovar.
const PRAZO_MS = 10000;
const TOKEN = 'a1'.repeat(32);
const CHAVE = 'b2'.repeat(32);
const CLIENTE = 'aba-de-teste-1';

// Sobe o painel ao vivo numa porta livre de 127.0.0.1, servindo a pasta do prototipo. `vivo` entra por cima do token
// e da chave de teste (prazoMs, batidaMs, folgaMs).
async function subirVivo(t, vivo) {
  const servidor = painel.criarServidor({ pasta: PROTOTIPO, vivo: Object.assign({ token: TOKEN, chave: CHAVE }, vivo) });
  await new Promise(function (r) { servidor.listen(0, '127.0.0.1', r); });
  t.after(function () { servidor.closeAllConnections(); servidor.close(); });
  return { servidor, porta: servidor.address().port };
}

function cookie(porta, chave) { return 'painel_' + porta + '=' + (chave === undefined ? CHAVE : chave); }

// A promessa com prazo: rejeita com o rotulo se nao resolver em `ms` (PRAZO_MS sem ele). Toda espera de socket cru
// passa por aqui.
function comPrazo(promessa, rotulo, ms) {
  const prazoMs = ms === undefined ? PRAZO_MS : ms;
  let relogio;
  const prazo = new Promise(function (_resolver, rejeitar) {
    relogio = setTimeout(function () { rejeitar(new Error(rotulo + ': nao aconteceu em ' + prazoMs + ' ms')); }, prazoMs);
  });
  return Promise.race([promessa, prazo]).finally(function () { clearTimeout(relogio); });
}

// Resolve quando o servidor recebe um pedido cujo endereco comeca por `inicio` (caminho e query), com prazo. Chame
// antes de mandar o pedido. O ouvinte entra depois do das rotas (o do createServer) e o Node chama os dois na ordem:
// quando este roda, a rota ja atendeu, e a espera de um /decisao ja esta registrada. Troca o sono fixo antes do fechar.
function chegou(servidor, inicio) {
  let ouvir;
  const veio = new Promise(function (resolver) {
    ouvir = function (req) { if (req.url.startsWith(inicio)) resolver(req.url); };
    servidor.on('request', ouvir);
  });
  return comPrazo(veio, 'o servidor receber ' + inicio).finally(function () { servidor.removeListener('request', ouvir); });
}

// Um pedido HTTP com prazo. `o`: metodo, caminho, cabecalhos (por cima do Host certo; um Content-Length dado, em
// qualquer caixa, fica no lugar do calculado), corpo (texto ou Buffer; outro valor vai em JSON), semTamanho (o corpo
// vai em pedacos, sem Content-Length) e prazo (em ms; PRAZO_MS sem ele). Resolve com o status, os cabecalhos, o texto
// e o json (null quando o corpo nao e JSON). Rejeita no erro de rede, na conexao que cai antes do fim da resposta e
// no prazo.
function pedir(porta, o) {
  const prazoMs = o.prazo === undefined ? PRAZO_MS : o.prazo;
  const rotulo = (o.metodo || 'GET') + ' ' + o.caminho;
  return new Promise(function (resolver, rejeitar) {
    let corpo = o.corpo;
    if (corpo !== undefined && typeof corpo !== 'string' && !Buffer.isBuffer(corpo)) corpo = JSON.stringify(corpo);
    const cabecalhos = Object.assign({ Host: '127.0.0.1:' + porta }, o.cabecalhos);
    const temTamanho = Object.keys(cabecalhos).some(function (k) { return k.toLowerCase() === 'content-length'; });
    if (corpo !== undefined && !o.semTamanho && !temTamanho) cabecalhos['Content-Length'] = Buffer.byteLength(corpo);
    let acabou = false;
    function falhar(e) {
      if (acabou) return;
      acabou = true;
      clearTimeout(relogio);
      rejeitar(e);
    }
    const req = http.request({ host: '127.0.0.1', port: porta, method: o.metodo || 'GET', path: o.caminho,
      headers: cabecalhos, agent: false }, function (res) {
      let texto = '';
      res.setEncoding('utf8');
      res.on('data', function (d) { texto += d; });
      res.on('end', function () {
        if (acabou) return;
        acabou = true;
        clearTimeout(relogio);
        let json = null;
        try { json = JSON.parse(texto); } catch (e) { json = null; }
        resolver({ status: res.statusCode, cabecalhos: res.headers, texto, json });
      });
      // A conexao que cai antes do fim da resposta chega aqui (o Node da 'aborted', ECONNRESET).
      res.on('error', falhar);
    });
    const relogio = setTimeout(function () {
      const erro = new Error(rotulo + ': sem resposta em ' + prazoMs + ' ms');
      req.destroy(erro);
      falhar(erro);
    }, prazoMs);
    req.on('error', falhar);
    if (corpo !== undefined) req.write(corpo);
    req.end();
  });
}

// O que o gancho manda: a nota no /gancho, com o token.
function gancho(porta, nota, token) {
  return pedir(porta, { metodo: 'POST', caminho: '/gancho', corpo: nota,
    cabecalhos: { 'Content-Type': 'application/json', 'X-Painel-Token': token === undefined ? TOKEN : token } });
}

// O que o gancho espera: a decisao do pedido, com o token.
function decisao(porta, pedido, token) {
  return pedir(porta, { caminho: '/decisao?pedido=' + encodeURIComponent(pedido),
    cabecalhos: { 'X-Painel-Token': token === undefined ? TOKEN : token } });
}

// O que a aba manda ao decidir: o cookie, o cabecalho do painel e a origem do proprio painel. `cabecalhos` troca ou
// tira (undefined) cada um.
function decidir(porta, corpo, cabecalhos) {
  const cab = Object.assign({ 'Content-Type': 'application/json', Cookie: cookie(porta), 'X-Painel': '1',
    Origin: 'http://127.0.0.1:' + porta, 'Sec-Fetch-Site': 'same-origin' }, cabecalhos);
  for (const k of Object.keys(cab)) if (cab[k] === undefined) delete cab[k];
  return pedir(porta, { metodo: 'POST', caminho: '/decidir', corpo, cabecalhos: cab });
}

function presenca(porta, corpo) {
  return pedir(porta, { metodo: 'POST', caminho: '/presenca', corpo,
    cabecalhos: { 'Content-Type': 'application/json', Cookie: cookie(porta), 'X-Painel': '1' } });
}

function dados(porta) {
  return pedir(porta, { caminho: '/dados.json', cabecalhos: { Cookie: cookie(porta) } });
}

// Le um bloco do fluxo de eventos (o texto entre duas linhas vazias, ja com LF) no formato do EventSource: a linha que
// comeca por ':' e comentario, e ': batida' conta uma batida; as outras sao `campo:valor`, com um espaco opcional
// depois dos dois-pontos; as linhas de data se juntam com LF. Devolve { batida, evento }, e evento e null sem data.
function lerBloco(bloco) {
  let batida = 0;
  const data = [];
  let id = null;
  let tipo = null;
  for (const l of bloco.split('\n')) {
    if (l.startsWith(':')) { if (l.startsWith(': batida')) batida += 1; continue; }
    const dois = l.indexOf(':');
    const campo = dois === -1 ? l : l.slice(0, dois);
    let valor = dois === -1 ? '' : l.slice(dois + 1);
    if (valor.startsWith(' ')) valor = valor.slice(1);
    if (campo === 'data') data.push(valor);
    else if (campo === 'id') id = valor;
    else if (campo === 'event') tipo = valor;
  }
  return { batida, evento: data.length === 0 ? null : { id: id === null ? null : Number(id), tipo, texto: data.join('\n') } };
}

// Uma aba do painel: a conexao /eventos com o cookie, que junta cada evento ({ id, tipo, dado }) e conta as batidas.
// `o`: cliente (null tira o parametro, '' vai vazio, sem ele vai CLIENTE), visivel (false manda visivel=0), cookie (o
// cabecalho Cookie inteiro; sem ele vai o da chave de teste) e prazo (em ms, para a resposta e para cada espera;
// PRAZO_MS sem ele). Resolve quando o servidor ja respondeu, com a aba registrada; rejeita se a resposta nao vem no
// prazo. Aceita fim de linha LF, CRLF ou CR. `esperar(teste, rotulo)` resolve com o 1o evento que passa no teste, dos
// que ja chegaram ou dos proximos; `esperarBatida()`, com a 1a batida; `esperarFim()`, quando a conexao fecha: null no
// fim limpo, o codigo (ou o texto) do erro quando ela cai. Um dado que nao e JSON fica em `aba.erro` e reprova toda
// espera, a que ja esperava e as seguintes.
function abrirAba(t, porta, o) {
  const opcoes = o || {};
  const prazoMs = opcoes.prazo === undefined ? PRAZO_MS : opcoes.prazo;
  const aba = { eventos: [], batidas: 0, status: null, fechada: false, erro: null };
  const esperas = [];
  let resto = '';
  let pularLf = false;
  let erroDoFim = null;
  // O pedido nasce dentro da promessa abaixo; o fechar ja existe antes dele, para o caso de o Node recusar o pedido na
  // hora (um cabecalho invalido), quando o pedido nem chega a existir.
  let req = null;
  aba.fechar = function () { if (req) req.destroy(); };
  t.after(function () { aba.fechar(); });
  function conferir() {
    for (let i = esperas.length - 1; i >= 0; i -= 1) {
      const espera = esperas[i];
      if (aba.erro) {
        clearTimeout(espera.relogio);
        espera.rejeitar(aba.erro);
        esperas.splice(i, 1);
        continue;
      }
      const achou = espera.achar();
      if (achou !== undefined) { clearTimeout(espera.relogio); espera.resolver(achou); esperas.splice(i, 1); }
    }
  }
  function esperarPor(achar, rotulo) {
    return new Promise(function (resolver, rejeitar) {
      if (aba.erro) return rejeitar(aba.erro);
      const ja = achar();
      if (ja !== undefined) return resolver(ja);
      const espera = { achar, resolver, rejeitar, relogio: null };
      espera.relogio = setTimeout(function () {
        const i = esperas.indexOf(espera);
        if (i !== -1) esperas.splice(i, 1);
        rejeitar(new Error('aba: ' + rotulo + ' nao chegou em ' + prazoMs + ' ms; chegaram ' +
          JSON.stringify(aba.eventos.map(function (e) { return e.tipo; }))));
      }, prazoMs);
      esperas.push(espera);
    });
  }
  function fim(erro) {
    if (aba.fechada) return;
    aba.fechada = true;
    erroDoFim = erro;
    conferir();
  }
  function receber(pedaco) {
    // Um CR no fim do pedaco ja vale como fim de linha (o fluxo so CR nao espera mais dado); se o pedaco seguinte abre
    // com LF, os dois eram um CRLF partido e esse LF sai.
    if (pularLf && pedaco.startsWith('\n')) pedaco = pedaco.slice(1);
    pularLf = pedaco.endsWith('\r');
    resto += pedaco.replace(/\r\n?/g, '\n');
    let corte;
    while ((corte = resto.indexOf('\n\n')) !== -1) {
      const lido = lerBloco(resto.slice(0, corte));
      resto = resto.slice(corte + 2);
      aba.batidas += lido.batida;
      if (!lido.evento || aba.erro) continue;
      try {
        aba.eventos.push({ id: lido.evento.id, tipo: lido.evento.tipo, dado: JSON.parse(lido.evento.texto) });
      } catch (e) {
        aba.erro = new Error('aba: o dado do evento ' + (lido.evento.tipo || 'sem tipo') + ' nao e JSON: ' +
          lido.evento.texto.slice(0, 200));
      }
    }
    conferir();
  }
  aba.esperar = function (teste, rotulo) {
    return esperarPor(function () { return aba.eventos.find(teste); }, rotulo || 'o evento');
  };
  aba.esperarBatida = function () { return esperarPor(function () { return aba.batidas > 0 ? true : undefined; }, 'a batida'); };
  aba.esperarFim = function () { return esperarPor(function () { return aba.fechada ? erroDoFim : undefined; }, 'o fim'); };
  const query = [];
  if (opcoes.cliente !== null) {
    query.push('cliente=' + encodeURIComponent(opcoes.cliente === undefined ? CLIENTE : opcoes.cliente));
  }
  query.push('visivel=' + (opcoes.visivel === false ? '0' : '1'));
  const respondeu = new Promise(function (resolver, rejeitar) {
    req = http.get({ host: '127.0.0.1', port: porta, path: '/eventos?' + query.join('&'),
      headers: { Cookie: opcoes.cookie === undefined ? cookie(porta) : opcoes.cookie }, agent: false }, function (res) {
      aba.status = res.statusCode;
      res.setEncoding('utf8');
      res.on('data', receber);
      res.on('end', function () { fim(null); });
      // A conexao que cai antes do fim chega aqui (o Node da 'aborted', ECONNRESET).
      res.on('error', function (e) { fim(e.code || e.message); });
      resolver(aba);
    });
    req.on('error', function (e) { fim(e.code || e.message); rejeitar(e); });
  });
  return comPrazo(respondeu, 'aba: a resposta do /eventos', prazoMs).catch(function (e) { aba.fechar(); throw e; });
}

module.exports = { RAIZ, PROTOTIPO, PRAZO_MS, TOKEN, CHAVE, CLIENTE, subirVivo, cookie, comPrazo, chegou, pedir, gancho,
  decisao, decidir, presenca, dados, abrirAba };
