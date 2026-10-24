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

function valor(nome) {
  const i = process.argv.indexOf(nome);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const manual = path.resolve(valor('--manual') || path.join(__dirname, '..', 'skills'));
const bruto = valor('--corpus');
const corpus = bruto ? path.resolve(bruto) : null;
const min = valor('--minimo');
const frac = valor('--fracao');

const r = cicatriz.varrer(manual, corpus, { minimo: min ? Number(min) : undefined, fracao: frac ? Number(frac) : undefined });

if (process.argv.indexOf('--json') !== -1) {
  process.stdout.write(JSON.stringify(r, null, 2) + '\n');
} else {
  process.stdout.write(cicatriz.texto(r) + '\n');
}
process.exit(0);
