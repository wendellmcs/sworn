#!/usr/bin/env node
'use strict';
const io = require('./lib/io.js');
const estado = require('./lib/estado.js');

// SessionEnd (T11-2, D366): varre a pasta de estado e apaga os arquivos de sessao parados ha mais de
// 7 dias. Nunca o da sessao que fecha: o --resume mantem o session_id. O evento nao tem controle de
// decisao e a saida e descartada; o orcamento e de 1,5 s, e a limpeza para sozinha antes disso.
// R1: as pastas que o sworn criou nesta sessao (o clone de estudo, a carga) saem num processo solto, que nao cabe no
// orcamento; o que ainda se usa (o export sem push, o worktree com mudanca) fica.
const SESSAO = /^[A-Za-z0-9_-]{1,200}$/;
io.blindar(function () {
  io.lerEntrada(function (e) {
    estado.limparVelhos(e.session_id, Date.now());
    if (SESSAO.test(String(e.session_id || ''))) {
      require('./lib/pastas.js').emSegundoPlano(['--limpar', '--fim-da-sessao', '--sessao=' + e.session_id]);
    }
    io.permitir();
  });
});
