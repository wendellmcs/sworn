#!/usr/bin/env node
'use strict';
// C3 (D808, D769 (b)): o inspetor da revisao cega um degrau acima do executor. No despacho de `sworn:inspector` (ou
// `sworn-inspector` fora do Claude Code), troca o `model` pelo degrau acima do modelo da sessao (lib/juiz.js), pelo
// `updatedInput` do PreToolUse; nao decide permissao. Sem o modelo da sessao, com o despacho ja num degrau igual ou
// acima, ou com "juizAcima": false no projeto.json, deixa passar como veio. D829: o briefing das rondas 2 e 3 (pelo
// caminho da pasta de vereditos) vai um degrau abaixo do juiz, com o pedido que vier.
const io = require('./lib/io.js');
const config = require('./lib/config.js');
const juiz = require('./lib/juiz.js');

const INSPETOR = /^(?:sworn:inspector|sworn-inspector)$/;

io.blindar(function () {
  io.lerEntrada(function (e) {
    const pedido = e.tool_input || {};
    if (!INSPETOR.test(String(pedido.subagent_type || ''))) return io.permitir();
    const projeto = config.carregarProjeto(config.raizDoProjeto(e.cwd || process.cwd()));
    if (projeto && projeto.juizAcima === false) return io.permitir();
    // D829: a ronda sai do caminho de vereditos do briefing; as rondas 2 e 3 vao um degrau abaixo do juiz
    const alvo = juiz.alvoDoDespacho(juiz.modeloDaSessao(e.transcript_path), pedido);
    if (!alvo) return io.permitir();
    return io.permitir({
      hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: Object.assign({}, pedido, { model: alvo }) }
    });
  });
});
