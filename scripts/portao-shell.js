#!/usr/bin/env node
'use strict';
const path = require('node:path');
const io = require('./lib/io.js');

// F3a (D828): o PreToolUse de Bash|PowerShell|Monitor num processo so. Antes eram tres processos node por comando
// (portao-destrutivo, portao-estilo, portao-commit), cada um de 0,75 a 1,4 s nesta maquina; agora a entrada se le uma
// vez e os portoes rodam aqui, em fila, cada um com a mesma entrada (como no paralelo do Claude Code). A 1a negacao vale.
// Cada portao segue sendo um script que roda sozinho (os outros harnesses e os testes o chamam assim).
// H6b (15.3): o 4o, portao-pacote.js, so avisa (pacote fora do manifesto e do lockfile); nunca nega.
const PORTOES = ['portao-destrutivo.js', 'portao-estilo.js', 'portao-commit.js', 'portao-pacote.js'];

// P14 (A1-06): o Monitor do Claude Code roda o `command` no mesmo shell da ferramenta Bash; os portoes o leem como Bash
// (o idioma, as armadilhas, o apagar). O Monitor de WebSocket (sem `command`) passa como o comando vazio.
function comoShell(e) {
  return e && e.tool_name === 'Monitor' ? Object.assign({}, e, { tool_name: 'Bash' }) : e;
}

io.blindar(function () {
  io.lerEntrada(function (entrada) {
    const saidas = io.rodarJuntos(comoShell(entrada), PORTOES.map(function (p) { return path.join(__dirname, p); }));
    io.permitir(io.juntarSaidas(saidas, 'PreToolUse'));
  });
});
