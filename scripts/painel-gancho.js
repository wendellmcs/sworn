#!/usr/bin/env node
'use strict';
// Painel de sessoes, fase 3: o gancho que leva cada evento da sessao do Claude Code ao painel ao vivo desta maquina
// (scripts/painel.js sem --prototipo). O hooks/hooks.json o chama no SessionStart, UserPromptSubmit, PreToolUse da
// AskUserQuestion, PermissionRequest, PostToolUse, Stop e SessionEnd; so no Claude Code: a ponte dos outros harnesses
// o tira (SO_NO_CLAUDE_CODE, em scripts/ponte.js).
//
// Sem painel de pe (sem a ponte de scripts/lib/painel-ponte.js, pid morto, porta fechada), sai na hora, sem escrever
// nada. Antes de mandar a nota, o gancho confere que quem responde na porta e o painel: manda um numero aleatorio, sem
// o token, e so segue se a resposta for a prova do token com ele (GET /ola); a ponte velha de um painel que caiu pode
// apontar para uma porta que outro programa ocupou, e a nota leva a fala da sessao. No PermissionRequest com uma aba
// do painel visivel, o painel segura o pedido: o gancho espera a decisao do dono e a devolve ao Claude Code; sem
// decisao (o prazo, a aba que some, o painel que cai), sai sem nada e o pedido segue no terminal. Sempre sai 0: o
// painel e opcional e nunca atrapalha a sessao.
const quando = Date.now();
const http = require('http');
const path = require('path');
const { lerEntrada } = require('./lib/io.js');
const ponte = require('./lib/painel-ponte.js');
const vivo = require('./lib/painel-vivo.js');

const ENDERECO = '127.0.0.1';
const PRAZO_DA_NOTA_MS = 3000;
// O painel segura o pedido por ate 120 s (PRAZO_PADRAO_MS, scripts/lib/painel-rotas.js); o gancho espera um pouco mais
// que ele, e o timeout do hooks.json (130 s) um pouco mais que o gancho.
const PRAZO_DA_DECISAO_MS = 125000;
// A maior resposta que o painel da: a prova, o pedido segurado ou a decisao, cada um com menos de 1 KB.
const TETO_DA_RESPOSTA = 64 * 1024;

function sair(saida) {
  if (!saida) return process.exit(0);
  return process.stdout.write(JSON.stringify(saida), function () { process.exit(0); });
}

// O erro que ninguem previu fica numa linha do stderr, e a sessao segue como se o painel nao existisse.
process.on('uncaughtException', function (e) {
  let causa = 'erro sem texto';
  try { causa = (e && e.message) || String(e); } catch (x) { /* fica o texto de reserva */ }
  process.stderr.write('sworn: o gancho do painel falhou e a sessao seguiu sem ele: ' + causa +
    '. Se repetir, feche o painel (Ctrl+C) e abra de novo: node "' + path.join(__dirname, 'painel.js') + '"\n');
  process.exit(0);
});

// Um pedido ao painel; `fim` recebe o JSON do 200, ou null em qualquer falha (recusado, cortado, prazo, outro status,
// resposta acima do teto): o painel que nao responde e o mesmo que o painel desligado. `o.semToken`: o pedido nao leva
// o token (o /ola). `o.prazo` vale para o pedido inteiro, do envio ao fim da resposta: o timeout do http.request so
// conta o socket parado, e a resposta que pinga um byte por vez o zeraria para sempre.
function pedir(dados, o, corpo, fim) {
  let feito = false;
  let req = null;
  const relogio = setTimeout(function () {
    if (req) req.destroy();
    acabar(null);
  }, o.prazo);
  function acabar(r) {
    if (feito) return;
    feito = true;
    clearTimeout(relogio);
    fim(r);
  }
  const cabecalhos = { Connection: 'close' };
  if (!o.semToken) cabecalhos['X-Painel-Token'] = dados.token;
  if (corpo !== undefined) {
    cabecalhos['Content-Type'] = 'application/json; charset=utf-8';
    cabecalhos['Content-Length'] = Buffer.byteLength(corpo);
  }
  req = http.request({ host: ENDERECO, port: dados.porta, method: o.metodo, path: o.caminho, headers: cabecalhos,
    agent: false, timeout: o.prazo }, function (res) {
    const partes = [];
    let tamanho = 0;
    res.on('data', function (d) {
      tamanho += d.length;
      if (tamanho > TETO_DA_RESPOSTA) {
        req.destroy();
        return acabar(null);
      }
      return partes.push(d);
    });
    res.on('error', function () { acabar(null); });
    res.on('end', function () {
      if (res.statusCode !== 200) return acabar(null);
      try { return acabar(JSON.parse(Buffer.concat(partes).toString('utf8'))); } catch (e) { return acabar(null); }
    });
  });
  req.on('timeout', function () {
    req.destroy();
    acabar(null);
  });
  req.on('error', function () { acabar(null); });
  req.end(corpo);
}

lerEntrada(function (entrada) {
  const nota = vivo.enxugar(entrada);
  if (!nota) return sair(null);
  const dados = ponte.ler();
  if (!dados) return sair(null);
  nota.quando = quando;
  const numero = ponte.novoToken();
  return pedir(dados, { metodo: 'GET', caminho: '/ola?numero=' + numero, prazo: PRAZO_DA_NOTA_MS, semToken: true },
    undefined, function (ola) {
      if (!ola || !ponte.mesmoToken(ola.prova, ponte.prova(dados.token, numero))) return sair(null);
      return pedir(dados, { metodo: 'POST', caminho: '/gancho', prazo: PRAZO_DA_NOTA_MS }, JSON.stringify(nota),
        function (r) {
          if (!r || r.segurar !== true || typeof r.pedido !== 'string') return sair(null);
          return pedir(dados, { metodo: 'GET', caminho: '/decisao?pedido=' + encodeURIComponent(r.pedido),
            prazo: PRAZO_DA_DECISAO_MS }, undefined, function (d) {
            sair(d ? vivo.saidaDaDecisao(d.decisao) : null);
          });
        });
    });
});
