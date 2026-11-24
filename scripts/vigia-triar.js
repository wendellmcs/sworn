#!/usr/bin/env node
'use strict';

/**
 * H11b (D909): grava a marca de triada da ficha da semana do vigia ou do radar, para a abertura parar de lembrar.
 *
 * As duas tarefas de segunda trazem a ficha para o disco, e a abertura a mostra uma vez. Ate 2026-11-24 ninguem a
 * conferia depois: a ficha de 2026-11-09 apareceu e sumiu sem triagem. Agora a abertura repete, uma vez por dia,
 * "a ficha de <semana> chegou e nao foi triada" ate a marca `triada` = { semana, como, quando } entrar no
 * `visto.json` da pasta. Este comando grava essa marca (lib/vigia-local.js, marcarTriada).
 *
 * Uso: node vigia-triar.js (--vigia | --radar) --semana AAAA-MM-DD --como "<o que foi decidido>" [--pasta <dir>]
 * A pasta padrao e a do vigia (SWORN_VIGIA ou ~/.claude/sworn/vigia); com --radar, a subpasta radar/ dela. --pasta
 * troca a pasta do vigia (a do radar continua sendo a subpasta radar/).
 * Exit 0 = gravou; 1 = recusado (sem ficha, semana que nao e a do disco, --como sem letras ou com o marcador do
 * comando, falha ao gravar; nada muda); 2 = uso errado (flag faltando, flag sem valor ou --como ""; nada e gravado).
 */
const path = require('node:path');
const vigia = require('./lib/vigia-local.js');
const escopoLib = require('./lib/escopo.js');

const USO = 'uso: node vigia-triar.js (--vigia | --radar) --semana AAAA-MM-DD --como "<o que foi decidido>" ' +
  '[--pasta <dir>]';
const umaLinha = escopoLib.asciiEmUmaLinha;

function erroDeUso(texto) {
  process.stderr.write('vigia-triar: ' + texto + '\n' + USO + '\n');
  process.exit(2);
}

// ronda 1: so uma destas no lugar do valor e "faltou o valor"; "-- nada a adotar" e um --como valido
const FLAGS = ['--vigia', '--radar', '--semana', '--como', '--pasta'];

function valor(nome) {
  const i = process.argv.indexOf(nome);
  if (i === -1) return null;
  const v = process.argv[i + 1];
  if (v === undefined || v === '' || FLAGS.indexOf(v) !== -1) erroDeUso(nome + ' pede um valor.');
  return v;
}

const vigiaPedido = process.argv.indexOf('--vigia') !== -1;
const radarPedido = process.argv.indexOf('--radar') !== -1;
if (vigiaPedido === radarPedido) erroDeUso('diga qual ficha: --vigia ou --radar (um dos dois).');
const semana = valor('--semana');
if (!semana || !/^\d{4}-\d{2}-\d{2}$/.test(semana)) erroDeUso('--semana pede a data AAAA-MM-DD da ficha.');
const como = valor('--como');
if (!como) erroDeUso('falta --como (o que foi decidido na triagem, ex. "nada a adotar" ou o numero da decisao).');
const base = valor('--pasta') ? path.resolve(valor('--pasta')) : vigia.pasta(process.env);
const dir = radarPedido ? path.join(base, vigia.PASTA_DO_RADAR) : base;

const r = vigia.marcarTriada(dir, semana, como, Date.now());
if (!r.ok) {
  process.stderr.write('vigia-triar: ' + r.motivo + ' Nada foi gravado.\n');
  process.exit(1);
}
process.stdout.write('vigia-triar: ficha de ' + r.semana + ' do ' + (radarPedido ? 'radar' : 'vigia') +
  ' marcada como triada em ' + umaLinha(path.join(dir, vigia.MARCA)) + '; a abertura para de lembrar dela.\n');
process.exit(0);
