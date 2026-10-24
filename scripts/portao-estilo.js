#!/usr/bin/env node
'use strict';
const io = require('./lib/io.js');
const estado = require('./lib/estado.js');
const config = require('./lib/config.js');
const design = require('./lib/design.js');

// PreToolUse em Bash|PowerShell, segundo gancho depois do portao-destrutivo (T11-1, R-T20-09).
// O portao de design so via Write|Edit: `cat > a.css <<EOF` escrevia estilo sem conferir os tokens.
// Modulo opcional, nao e trava: o botao de desligar e nao ter .claude/sworn/design.json (o mesmo
// do portao-escopo). Por isso nao olha travas.destrutivo nem comandosLiberados. Nao confere valores
// (o conteudo de um comando nao se le): nega a escrita de estilo por shell e manda usar Write ou Edit.
io.blindar(function () {
  io.lerEntrada(function (e) {
    const comando = (e.tool_input || {}).command;
    if (typeof comando !== 'string' || !comando) return io.permitir();

    const cwd = config.raizDoProjeto(e.cwd || process.cwd());
    const projeto = config.carregarProjeto(cwd);
    if (!projeto) return io.permitir();
    if (!config.carregarDesign(cwd)) return io.permitir();

    const alvos = design.alvosDeEstiloNoShell(comando, projeto, { ferramenta: e.tool_name, cwd: cwd });
    if (!alvos.length) return io.permitir();

    // D420/SH-02: o contador e acessorio; estado fora do ar lancava aqui e `io.blindar` liberava a escrita.
    try { estado.incrementar(e.session_id, 'estilo_por_shell'); } catch (err) { /* o balde vale menos que a negacao */ }
    io.negarFerramenta(design.motivoShell(alvos));
  });
});
