#!/usr/bin/env node
'use strict';
const path = require('node:path');
const cicatriz = require('./lib/cicatriz.js');

/**
 * Entrega D. Mede e propoe; NAO poda. Aposentar instrucao e decisao do dono, e a
 * skill `audit` ja promete isso com todas as letras: "nao apaga, nao move, nao
 * edita". Este comando existe para que a proposta tenha numero atras.
 *
 * O corpus e argumento, sempre. Cravar aqui o caminho de um historico seria
 * exatamente o fato volatil que o plugin inteiro se proibe de guardar.
 */

const USO = 'uso: cicatriz.js [--manual <pasta>] [--corpus <pasta>] [--minimo <inteiro de 1 em diante>] ' +
  '[--fracao <numero acima de 0 ate 1>] [--json]\n';

function erroDeUso(texto) {
  process.stdout.write('ERRO: ' + texto + '\n' + USO);
  process.exit(1);
}

// A5 (R1 :17): flag presente sem valor (a ultima, vazia ou seguida de outra flag do USO) e erro de uso que diz qual,
// no molde do preparar-revisao.js; antes `--corpus --json` lia o corpus de uma pasta chamada "--json".
const FLAGS_DO_USO = ['--manual', '--corpus', '--minimo', '--fracao', '--json'];
function valor(nome) {
  const i = process.argv.indexOf(nome);
  if (i === -1) return null;
  const v = process.argv[i + 1];
  if (v === undefined || v === '' || FLAGS_DO_USO.indexOf(v) !== -1) erroDeUso(nome + ' pede um valor.');
  return v;
}

// A5 (R1 :26): `--minimo abc` virava NaN, que nenhum `<` barra: as regras todas saiam "com cicatriz" e a lista de
// poda vazia, com saida 0. Numero fora da faixa e erro de uso.
function numero(nome, valido) {
  const v = valor(nome);
  if (v === null) return undefined;
  const n = Number(v);
  if (!valido(n)) erroDeUso(nome + ' fora da faixa (veio "' + v + '").');
  return n;
}

const manual = path.resolve(valor('--manual') || path.join(__dirname, '..', 'skills'));
const bruto = valor('--corpus');
const corpus = bruto ? path.resolve(bruto) : null;
const min = numero('--minimo', function (n) { return Number.isInteger(n) && n >= 1; });
const frac = numero('--fracao', function (n) { return Number.isFinite(n) && n > 0 && n <= 1; });

const r = cicatriz.varrer(manual, corpus, { minimo: min, fracao: frac });

if (process.argv.indexOf('--json') !== -1) {
  process.stdout.write(JSON.stringify(r, null, 2) + '\n');
} else {
  process.stdout.write(cicatriz.texto(r) + '\n');
}
process.exit(0);
