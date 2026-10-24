#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const alvo = path.join(process.cwd(), '.claude', 'sworn', 'contadores.json');
let dados = null;
try { dados = JSON.parse(fs.readFileSync(alvo, 'utf8')); } catch (e) { dados = null; }
// Plano 091 T6: os contadores de ordem (lib/ordens.js) moram no mesmo arquivo, mas nao sao disparo de trava.
const RE_ORDEM = /^ordem_/;
const temOrdens = !!dados && typeof dados === 'object' && Object.keys(dados).some(function (k) { return RE_ORDEM.test(k); });
if (temOrdens) dados = Object.fromEntries(Object.entries(dados).filter(function (par) { return !RE_ORDEM.test(par[0]); }));

if (!dados || Object.keys(dados).length === 0) {
  process.stdout.write('sworn: nenhum disparo registrado ainda em ' + alvo + '\n');
  process.exit(0);
}

// p4-30: so numero de verdade entra na ordem e na soma; o resto (texto, null) vai ao fim, dito como invalido.
const ehNumero = function (v) { return typeof v === 'number' && isFinite(v); };
const chaves = Object.keys(dados);
const linhas = chaves.filter(function (k) { return ehNumero(dados[k]); }).map(function (k) { return [k, dados[k]]; })
  .sort(function (a, b) { return b[1] - a[1]; });
const invalidas = chaves.filter(function (k) { return !ehNumero(dados[k]); });
const total = linhas.reduce(function (s, l) { return s + l[1]; }, 0);

// Plano 082, Tarefa 5 (mock S10): a 1a linha diz o que o relatorio responde; o arquivo lido entre aspas.
process.stdout.write('sworn - quantas vezes cada trava disparou neste projeto.\n\nContado em:\n  - "' + alvo + '"\n\n');
for (const [chave, n] of linhas) {
  process.stdout.write('  ' + String(n).padStart(6) + ' | ' + chave + '\n');
}
for (const chave of invalidas) {
  process.stdout.write('  ' + '?'.padStart(6) + ' | ' + chave + ' (nao e numero: ' + JSON.stringify(dados[chave]) + ')\n');
}
process.stdout.write('\n  ' + String(total).padStart(6) + ' | TOTAL\n\n');
process.stdout.write('Manter ou tirar trava se decide por estes numeros, nao por impressao.\n');
if (temOrdens) process.stdout.write('As ordens (dadas, cumpridas, recusadas) saem na auditoria automatica.\n');
process.exit(0);
