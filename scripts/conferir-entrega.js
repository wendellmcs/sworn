#!/usr/bin/env node
'use strict';
const io = require('./lib/io.js');
const estado = require('./lib/estado.js');
const entrega = require('./lib/entrega-pedida.js');

// H12c (s376, D914): no fim do subagente, o arquivo que o briefing pediu e nao existe fica na sessao; o portao-fecho.js
// cobra uma vez no fecho do turno (lib/entrega-pedida.js). NUNCA decide: no SubagentStop, `block` faria o subagente
// continuar.
// atalho: so a transcricao do Claude Code (`agent_transcript_path`). limite: nas pontes (Codex, Qwen, OpenCode) o
// briefing nao e lido e nada se confere. trocar quando: a ponte passar a transcricao do subagente.
io.blindar(function () {
  io.lerEntrada(function (e) {
    if (e.hook_event_name !== 'SubagentStop') return io.permitir();
    const pedidos = entrega.caminhosPedidos(entrega.briefingDaTranscricao(e.agent_transcript_path));
    if (!pedidos.length) return io.permitir();
    const faltam = entrega.faltando(pedidos, typeof e.cwd === 'string' && e.cwd ? e.cwd : process.cwd());
    if (!faltam.length) return io.permitir();
    estado.alterar(e.session_id, function (s) { s.entregaFaltando = entrega.anotarFaltando(s, e.agent_type, faltam); return s; });
    io.permitir();
  });
});
