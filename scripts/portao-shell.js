#!/usr/bin/env node
'use strict';
const path = require('node:path');
const io = require('./lib/io.js');

// F3a (D828): o PreToolUse de Bash|PowerShell num processo so. Antes eram tres processos node por comando
// (portao-destrutivo, portao-estilo, portao-commit), cada um de 0,75 a 1,4 s nesta maquina; agora a entrada se le uma
// vez e os tres rodam aqui, em fila, cada um com a mesma entrada (como no paralelo do Claude Code). A 1a negacao vale.
// Cada portao segue sendo um script que roda sozinho (os outros harnesses e os testes o chamam assim).
const PORTOES = ['portao-destrutivo.js', 'portao-estilo.js', 'portao-commit.js'];

io.blindar(function () {
  io.lerEntrada(function (entrada) {
    const saidas = io.rodarJuntos(entrada, PORTOES.map(function (p) { return path.join(__dirname, p); }));
    io.permitir(io.juntarSaidas(saidas, 'PreToolUse'));
  });
});
