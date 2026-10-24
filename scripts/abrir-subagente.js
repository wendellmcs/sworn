#!/usr/bin/env node
'use strict';
const io = require('./lib/io.js');
const config = require('./lib/config.js');
const enxuto = require('./lib/enxuto.js');

/**
 * Plano 090 Tarefa 3, ultimo subitem (0.9.0): o contexto da abertura e so da conversa principal e nao chega ao
 * subagente; o bloco "menos codigo" vai a ele pelo SubagentStart, no formato da doc (hookSpecificOutput com
 * additionalContext; stdout puro a doc nao garante). Os agentes que so leem ficam de fora. Entrada torta falha
 * aberto: injeta, como no ponytail, de onde veio a ideia.
 */
const SO_LEEM = ['sworn:inspector', 'sworn:dedupe-judge', 'sworn:reader', 'Explore', 'Plan'];

io.blindar(function () {
  io.lerEntrada(function (e) {
    if (SO_LEEM.indexOf(e.agent_type) !== -1) return;
    const cwd = config.raizDoProjeto(typeof e.cwd === 'string' ? e.cwd : process.cwd());
    const bloco = enxuto.bloco(config.carregarProjeto(cwd));
    if (!bloco) return;
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: bloco } }));
  });
});
