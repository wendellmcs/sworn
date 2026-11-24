#!/usr/bin/env node
'use strict';
const path = require('node:path');
const io = require('./lib/io.js');
const estado = require('./lib/estado.js');

// SessionEnd (T11-2, D366): varre a pasta de estado e apaga os arquivos de sessao parados ha mais de
// 7 dias. Nunca o da sessao que fecha: o --resume mantem o session_id. O evento nao tem controle de
// decisao e a saida e descartada; o orcamento e de 1,5 s, e a limpeza para sozinha antes disso.
// R1: as pastas que o sworn criou nesta sessao (o clone de estudo, a carga) saem num processo solto, que nao cabe no
// orcamento; o que ainda se usa (o export sem push, o worktree com mudanca) fica.
// H6g (15.6, D903): no projeto com o sworn, o custo e o uso da sessao saem noutro processo solto, que le o transcript
// e grava .sworn/custo/<sessao>.json (custo-das-sessoes.js --gravar); o fim que espera a conta passaria do orcamento.
const SESSAO = /^[A-Za-z0-9_-]{1,200}$/;

function gravarCusto(e) {
  if (typeof e.transcript_path !== 'string' || !e.transcript_path) return;
  try {
    const config = require('./lib/config.js');
    const cwd = typeof e.cwd === 'string' && e.cwd ? e.cwd : process.cwd();
    const raiz = config.raizDoProjeto(cwd);
    if (typeof raiz !== 'string' || !config.carregarProjeto(raiz)) return;
    // o filho roda na raiz: o transcript relativo vale a partir do cwd do evento, nao dela
    const filho = require('node:child_process').spawn(process.execPath, [path.join(__dirname, 'custo-das-sessoes.js'),
      '--gravar', '--sessao=' + e.session_id, '--transcript=' + path.resolve(cwd, e.transcript_path), '--raiz=' + raiz],
    { detached: true, stdio: 'ignore', windowsHide: true, cwd: raiz });
    filho.on('error', function () { /* sem registro desta sessao: o custo nao e portao, e a proxima grava a dela */ });
    filho.unref();
  } catch (erro) { /* idem: o custo e so registro */ }
}

io.blindar(function () {
  io.lerEntrada(function (e) {
    estado.limparVelhos(e.session_id, Date.now());
    if (SESSAO.test(String(e.session_id || ''))) {
      require('./lib/pastas.js').emSegundoPlano(['--limpar', '--fim-da-sessao', '--sessao=' + e.session_id]);
      gravarCusto(e);
    }
    io.permitir();
  });
});
