#!/usr/bin/env node
'use strict';
const path = require('node:path');
const io = require('./lib/io.js');

// F3a (D828): o PostToolUse de Bash|PowerShell num processo so (antes, dois: marcar-trabalho e conferir-depois). A
// entrada se le uma vez e os dois rodam aqui, em fila, com a mesma entrada; as saidas se juntam (io.juntarSaidas).
// Nas outras ferramentas o marcar-trabalho segue no gancho dele. R1: a limpeza das pastas do sworn depois do push.
const GANCHOS = ['marcar-trabalho.js', 'conferir-depois.js', 'limpar-depois-do-push.js'];

io.blindar(function () {
  io.lerEntrada(function (entrada) {
    const saidas = io.rodarJuntos(entrada, GANCHOS.map(function (g) { return path.join(__dirname, g); }));
    io.permitir(io.juntarSaidas(saidas, 'PostToolUse'));
  });
});
