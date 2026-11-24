#!/usr/bin/env node
'use strict';
const io = require('./lib/io.js');
const config = require('./lib/config.js');
const pacoteNovo = require('./lib/pacote-novo.js');

// H6b (15.3): PreToolUse em Bash|PowerShell, 4o portao do portao-shell.js. O comando que instala pacote (npm i, pip
// install, cargo add e afins, tabela em scripts/lib/pacote-novo.js) com um nome fora do manifesto e do lockfile do
// projeto passa com um aviso ao agente (additionalContext), com o comando que confere o nome no registro. Nunca nega e
// nao consulta a rede: quem confere e o agente. Roda sem projeto.json (o aviso nao e trava, nao tem botao).
io.blindar(function () {
  io.lerEntrada(function (e) {
    const comando = (e.tool_input || {}).command;
    if (typeof comando !== 'string' || !comando) return io.permitir();
    const pacotes = pacoteNovo.pacotesDoComando(comando, e.tool_name === 'PowerShell');
    if (!pacotes.length) return io.permitir();
    const cwd = e.cwd || process.cwd();
    const naoLidos = [];
    const novos = pacoteNovo.pacotesNovos(pacotes, [config.raizDoProjeto(cwd), cwd], naoLidos);
    if (!novos.length) return io.permitir();
    io.permitir({ hookSpecificOutput: { hookEventName: 'PreToolUse',
      additionalContext: pacoteNovo.aviso(novos, naoLidos) } });
  });
});
