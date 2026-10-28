#!/usr/bin/env node
'use strict';
const io = require('./lib/io.js');
const estado = require('./lib/estado.js');
const config = require('./lib/config.js');
const escopoLib = require('./lib/escopo.js');
const custo = require('./lib/custo.js');

io.blindar(function () {
  io.lerEntrada(function (e) {
    const cwd = config.raizDoProjeto(e.cwd || process.cwd());
    const tipo = (e.tool_input || {}).subagent_type;

    // F18: contar sempre. Custo e informacao do dono, e ele so a tem se alguem contar.
    // A2-06 (molde D420/SH-02): estado fora do ar lancava aqui e `io.blindar` liberava o agente caro.
    try { estado.incrementar(e.session_id, 'agentes_despachados'); } catch (err) { /* o balde vale menos que a negacao */ }

    if (!tipo) return io.permitir();
    const projeto = config.carregarProjeto(cwd);
    if (!projeto) return io.permitir();

    // D678 T2: a tabela dos degraus antes da marcha - a chamada errada se conserta primeiro.
    const tabela = custo.chamadaDaTabela(tipo, e.tool_input, projeto);
    if (!tabela.ok) {
      try { estado.incrementar(e.session_id, 'chamada_fora_da_tabela'); } catch (err) { /* idem */ }
      return io.negarFerramenta(tabela.motivo);
    }

    const esc = escopoLib.carregar(cwd, estado.ler(e.session_id).frente);
    const marchaMax = custo.marchaMaximaDoEscopo(esc, projeto);
    const r = custo.permitido(tipo, marchaMax, projeto);
    if (r.ok) return io.permitir();

    try { estado.incrementar(e.session_id, 'agente_caro_em_marcha_rapida'); } catch (err) { /* idem */ }
    io.negarFerramenta(r.motivo);
  });
});
