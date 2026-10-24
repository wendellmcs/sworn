#!/usr/bin/env node
'use strict';

/**
 * Plano 091 (#7, D559): o "nunca neste projeto" da pergunta do init. A abertura de um projeto sem
 * .claude/sworn/projeto.json manda o modelo perguntar em 3 opcoes; com "nunca", ele roda este comando com a pasta,
 * e a abertura nao pergunta mais ali. Grava fora do projeto (lib/ordens.js, recusarInit).
 *
 *   node recusar-init.js <pasta>
 *
 * Sai 0 com a pasta gravada; 1 sem pasta ou sem conseguir gravar.
 */
const ordens = require('./lib/ordens.js');

const pasta = process.argv[2];
if (!pasta) {
  process.stdout.write('ERRO: falta a pasta do projeto: node recusar-init.js <pasta>\n');
  process.exit(1);
}
if (!ordens.recusarInit(pasta)) {
  process.stdout.write('ERRO: nao consegui gravar a recusa; a abertura vai perguntar de novo.\n');
  process.exit(1);
}
process.stdout.write('sworn: nao pergunto mais o /sworn:init em ' + pasta + '.\n');
process.exit(0);
