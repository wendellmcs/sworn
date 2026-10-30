#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const texto = require('./lib/texto.js');

const alvo = path.join(process.cwd(), '.claude', 'sworn', 'contadores.json');
// A6 (s220): so o arquivo ausente e vazio. JSON quebrado, valor que nao e objeto simples e erro de leitura saem com a
// causa, como o estado.descarregar os ve (lib/estado.js:257, que guarda o torto como .corrompido no fim do turno).
// A6-06 e A6-09 (D735): a causa traduzida (o texto do Node entre aspas, marcado como dele) e o efeito sem jargao.
function ilegivel(causa) {
  process.stderr.write('sworn: contadores.json ilegivel (' + causa + ') em ' + alvo + '.\nCorrija o JSON: ele tem ' +
    'de ser um objeto, com o nome de cada trava e quantas vezes ela barrou ou avisou, como { "fora_do_escopo": 3 }. ' +
    'Se ficar assim, no fim do proximo turno o sworn poe o arquivo de lado (renomeado para ' +
    'contadores.json.corrompido, sem apagar) e comeca uma contagem nova.\n');
  process.exit(1);
}
let dados = null;
let lido = null;
try { lido = fs.readFileSync(alvo, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') ilegivel(texto.causaDoErro(e)); }
if (lido !== null) {
  try {
    dados = JSON.parse(texto.semBom(lido));
  } catch (e) { ilegivel('o texto nao e JSON valido; o Node diz: ' + texto.entreAspas(e.message)); }
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
    ilegivel('nao e um objeto: ' + JSON.stringify(dados));
  }
}
// Plano 091 T6: os contadores de ordem (lib/ordens.js) moram no mesmo arquivo, mas nao sao disparo de trava.
const RE_ORDEM = /^ordem_/;
const temOrdens = !!dados && Object.keys(dados).some(function (k) { return RE_ORDEM.test(k); });
if (temOrdens) dados = Object.fromEntries(Object.entries(dados).filter(function (par) { return !RE_ORDEM.test(par[0]); }));

if (!dados || Object.keys(dados).length === 0) {
  process.stdout.write('sworn: nenhum disparo registrado ainda em ' + alvo + '\nO numero de uma trava sobe quando ' +
    'ela barra ou avisa algo, e vai para este arquivo no fim do turno. Rode de novo depois de alguns turnos de ' +
    'trabalho.\n');
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
// A6-02 (D735): o que e a trava e o que fazer com os numeros.
process.stdout.write('Trava e cada regra do sworn que barra ou avisa uma acao. Use estes numeros para decidir qual ' +
  'manter ou desligar: a que nunca dispara talvez sobre; a que dispara muito mostra onde o Claude mais erra.\n');
if (temOrdens) process.stdout.write('As ordens (dadas, cumpridas, recusadas) saem na auditoria automatica.\n');
process.exit(0);
