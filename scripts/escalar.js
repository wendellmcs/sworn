#!/usr/bin/env node
'use strict';
const io = require('./lib/io.js');
const estado = require('./lib/estado.js');
const config = require('./lib/config.js');
const escalada = require('./lib/escalada.js');
const { mensagemDoSubagente } = require('./lib/texto.js');

// D694 (T3 da escada, D678): no fim do subagente, guarda o pedido `ESCALAR: <agente> - <motivo>`; no comeco, da baixa
// no pedido que tinha aquele agente como destino (lib/escalada.js). Quem cobra e o fecho do turno (portao-fecho.js).
// NUNCA decide: no SubagentStop, `block` faria o subagente continuar.

io.blindar(function () {
  io.lerEntrada(function (e) {
    let mudar;
    if (e.hook_event_name === 'SubagentStart') {
      mudar = function (s) { return escalada.aoAbrir(s, e.agent_type, e.agent_id); };
    } else {
      const mensagem = mensagemDoSubagente(e);
      if (typeof mensagem !== 'string') return io.permitir();
      const projeto = config.carregarProjeto(config.raizDoProjeto(typeof e.cwd === 'string' && e.cwd ? e.cwd : process.cwd()));
      mudar = function (s) { return escalada.aoFechar(s, e.agent_type, e.agent_id, mensagem, projeto); };
    }
    // Sem nada a mudar, nem trava nem gravacao: as levas de inspetores nascem e terminam juntas.
    const antes = estado.ler(e.session_id);
    if (mudar(antes) === antes.escalada) return io.permitir();
    estado.alterar(e.session_id, function (s) { s.escalada = mudar(s); return s; });
    io.permitir();
  });
});
