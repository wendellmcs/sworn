#!/usr/bin/env node
'use strict';
const io = require('./lib/io.js');
const estado = require('./lib/estado.js');
const config = require('./lib/config.js');
const escopoLib = require('./lib/escopo.js');
const custo = require('./lib/custo.js');
const escalada = require('./lib/escalada.js');

io.blindar(function () {
  io.lerEntrada(function (e) {
    const cwd = config.raizDoProjeto(e.cwd || process.cwd());
    // L2-s103-20: sem subagent_type o Claude Code (e o Qwen Code) despacham o general-purpose; o `!tipo` liberava
    // essa chamada sem julgamento, ainda que o dono tenha posto o general-purpose no topo da escada.
    const bruto = (e.tool_input || {}).subagent_type;
    const semTipo = bruto === undefined || bruto === null || (typeof bruto === 'string' && bruto.trim() === '');
    // O tipo que nao e texto segue como o seu JSON: o escalada.deNovo e o motivo leem texto, e {"toString": 1} lancava.
    const tipo = semTipo ? custo.AGENTE_SEM_TIPO : (typeof bruto === 'string' ? bruto : JSON.stringify(bruto));

    // F18: contar sempre. Custo e informacao do dono, e ele so a tem se alguem contar.
    // A2-06 (molde D420/SH-02): estado fora do ar lancava aqui e `io.blindar` liberava o agente caro. Cada contador
    // fica no seu try, com o nome literal: o leitor de baldes dos testes (test/auxiliar-baldes.js) le esse padrao.
    try { estado.incrementar(e.session_id, 'agentes_despachados'); } catch (err) { /* o balde vale menos que a negacao */ }

    const projeto = config.carregarProjeto(cwd);
    if (!projeto) return io.permitir();

    // D678 T2: a tabela dos degraus antes da marcha - a chamada errada se conserta primeiro. D785 (2.2): o re-despacho
    // do topo pedido pela escalada leva effort "max", fora da tabela.
    const s = estado.ler(e.session_id);
    const tabela = custo.chamadaDaTabela(tipo, e.tool_input, projeto, { esforcoLivre: escalada.deNovo(s, tipo) });
    if (!tabela.ok) {
      try { estado.incrementar(e.session_id, 'chamada_fora_da_tabela'); } catch (err) { /* a negacao sai mesmo assim */ }
      return io.negarFerramenta(tabela.motivo);
    }

    const esc = escopoLib.carregar(cwd, s.frente);
    const marchaMax = custo.marchaMaximaDoEscopo(esc, projeto);
    const r = custo.permitido(tipo, marchaMax, projeto);
    if (r.ok) return io.permitir();

    try { estado.incrementar(e.session_id, 'agente_caro_em_marcha_rapida'); } catch (err) { /* a negacao sai mesmo assim */ }
    io.negarFerramenta(r.motivo);
  });
});
