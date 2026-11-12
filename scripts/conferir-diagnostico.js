#!/usr/bin/env node
'use strict';
// D826 (D4): o passo do /sworn:diagnose que separa o achado provado do inventado. Le a lista que os analistas
// devolveram e responde, em JSON, os confirmados (a citacao confere no projeto ou na pasta das transcricoes) e os
// descartados, com o motivo. So le: nao muda nenhum arquivo.
//   node scripts/conferir-diagnostico.js --achados <lista.json> [--transcricoes <pasta>]
const fs = require('node:fs');
const path = require('node:path');
const config = require('./lib/config.js');
const calibracao = require('./lib/calibracao.js');
const diag = require('./lib/diagnostico.js');
const textoLib = require('./lib/texto.js');

function falhar(msg) { process.stdout.write('ERRO: ' + msg + '\n'); process.exit(1); }
/** O valor da flag, ou null sem a flag; a flag sem valor nao some calada. */
function valor(nome) {
  const i = process.argv.indexOf(nome);
  if (i === -1) return null;
  const v = process.argv[i + 1];
  if (!v || v.startsWith('--')) falhar(nome + ' pede um valor (o caminho depois dela) e rode de novo.');
  return v;
}

const cwd = process.cwd();
const arq = valor('--achados');
if (!arq) falhar('falta --achados <lista.json>: o arquivo com a lista que os analistas devolveram.');
const abs = path.resolve(cwd, arq);
let achados;
try {
  achados = JSON.parse(textoLib.semBom(fs.readFileSync(abs, 'utf8')));
} catch (e) {
  falhar('nao li os achados em ' + abs + ' (causa: ' + textoLib.causaDoErro(e) + '). Grave a lista dos analistas ' +
    'nesse arquivo e rode de novo.');
}
if (!Array.isArray(achados)) falhar('o arquivo ' + abs + ' nao traz uma lista de achados: junte os achados de todos os ' +
  'analistas numa lista JSON ([...]) e rode de novo.');

const raiz = config.raizDoProjeto(cwd);
const dada = valor('--transcricoes');
const transcricoes = dada ? path.resolve(cwd, dada) : calibracao.pastaDasTranscricoes(raiz);
if (dada) {
  let st = null;
  try { st = fs.statSync(transcricoes); } catch (e) { st = null; }
  // a pasta errada descartaria toda citacao da transcricao sem dizer por que
  if (!st || !st.isDirectory()) {
    falhar('a pasta de --transcricoes nao existe: ' + transcricoes + '. Passe a pasta das transcricoes do projeto ' +
      '(em <CLAUDE_CONFIG_DIR ou ~/.claude>/projects/) e rode de novo.');
  }
}
const raizes = [path.resolve(raiz)].concat(transcricoes ? [transcricoes] : []);
const saida = Object.assign({ raizes: raizes }, diag.conferirAchados(achados, raizes));
if (!transcricoes) {
  saida.aviso = 'nao achei a pasta das transcricoes deste projeto: so vale citacao de arquivo do projeto; passe ' +
    '--transcricoes <pasta> para conferir as citacoes da transcricao';
}
process.stdout.write(JSON.stringify(saida, null, 2) + '\n');
