#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const texto = require('./lib/texto.js');
const projeto = require('./lib/projeto.js');

// A6-15/A7-06: da subpasta, a raiz do projeto (a pasta com .claude/sworn/projeto.json), como os outros scripts
const alvo = path.join(require('./lib/config.js').raizDoProjeto(process.cwd()), '.claude', 'sworn', 'contadores.json');
// A6 (s220): so o arquivo ausente e vazio. JSON quebrado, valor que nao e objeto simples e erro de leitura saem com a
// causa, como o estado.descarregar os ve (lib/estado.js:257, que guarda o torto como .corrompido no fim do turno).
// A6-06 e A6-09 (D735): a causa traduzida (o texto do Node entre aspas, marcado como dele) e o efeito sem jargao.
// A6-05: o nome diz os dois efeitos (escreve a causa e sai com 1).
function sairIlegivel(causa) {
  process.stderr.write('sworn: contadores.json ilegivel (' + causa + ') em ' + alvo + '.\nCorrija o JSON: ele tem ' +
    'de ser um objeto, com o nome de cada trava e quantas vezes ela barrou ou avisou, como { "fora_do_escopo": 3 }. ' +
    'Se ficar assim, no fim do proximo turno o sworn poe o arquivo de lado (renomeado para ' +
    'contadores.json.corrompido, sem apagar) e comeca uma contagem nova.\n');
  process.exit(1);
}
let dados = null;
let lido = null;
try { lido = fs.readFileSync(alvo, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') sairIlegivel(texto.causaDoErro(e)); }
if (lido !== null) {
  try {
    dados = JSON.parse(texto.semBom(lido));
  } catch (e) { sairIlegivel('o texto nao e JSON valido; o Node diz: ' + texto.entreAspas(e.message)); }
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
    sairIlegivel('nao e um objeto: ' + JSON.stringify(dados));
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
  // A6-01: o arquivo so com contadores de ordem nao e vazio; diz onde eles aparecem
  if (temOrdens) process.stdout.write('O arquivo so tem contadores de ordem (dadas, cumpridas, recusadas), que nao ' +
    'sao disparo de trava; eles saem na auditoria automatica.\n');
  process.exit(0);
}

// A6-111: o contador tem o nome do que a trava barrou, e o "travas" do projeto.json tem o nome da trava. O par de cada
// contador que uma chave desliga, conferido no portao que o incrementa: o portao-fecho.js (depois do `travas.fecho`),
// o portao-destrutivo.js e o conferir-depois.js (`travas.destrutivo`) e o portao-escopo.js (`travas.outraFrente`).
// A chave `escopo` nao tem leitor de proposito (D104: o mesmo portao guarda os intocaveis), e nao entra aqui.
const TRAVA_DO_CONTADOR = {
  fecho_sem_evidencia: 'fecho', subitem_pendente: 'fecho', teste_sem_vermelho: 'fecho',
  comando_destrutivo: 'destrutivo', shell_idioma_errado: 'destrutivo', armadilha_shell: 'destrutivo',
  codigo_do_estudo: 'destrutivo', cd_solto: 'destrutivo', restaurou_fora_do_escopo: 'destrutivo',
  outra_frente: 'outraFrente'
};
const SEM_LEITOR = ['escopo'];

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
  // a chave vem de um arquivo que se edita a mao: "constructor" ou "__proto__" nao podem achar o que o objeto herda
  const trava = Object.hasOwn(TRAVA_DO_CONTADOR, chave) ? TRAVA_DO_CONTADOR[chave] : null;
  process.stdout.write('  ' + String(n).padStart(6) + ' | ' + chave + (trava ? ' (desliga com "' + trava + '")' : '') + '\n');
}
for (const chave of invalidas) {
  process.stdout.write('  ' + '?'.padStart(6) + ' | ' + chave + ' (nao e numero: ' + JSON.stringify(dados[chave]) + ')\n');
}
process.stdout.write('\n  ' + String(total).padStart(6) + ' | TOTAL\n\n');
// A6-02 (D735): o que e a trava e o que fazer com os numeros.
process.stdout.write('Trava e cada regra do sworn que barra ou avisa uma acao. Use estes numeros para decidir qual ' +
  'manter ou desligar: a que nunca dispara talvez sobre; a que dispara muito mostra onde o Claude mais erra.\n');
// A6-84 (D735): como desligar, conferido trava por trava: as do bloco travas (projeto.TRAVAS) e as que dizem a chave
// na ultima linha do aviso ("Desligar neste projeto", test/forma-aviso.test.js).
// A6-111: so as chaves que desligam algo; o exemplo era a `escopo`, que nao desliga nada.
const desligam = projeto.TRAVAS.filter(function (t) { return SEM_LEITOR.indexOf(t) === -1; });
const nomes = desligam.slice(0, -1).join(', ') + ' e ' + desligam[desligam.length - 1];
process.stdout.write('Para desligar ' + nomes + ', ponha o nome em "travas" no .claude/sworn/projeto.json, como ' +
  '"travas": { "' + desligam[desligam.length - 1] + '": false }; o contador que cada uma desliga diz o nome dela ' +
  'entre parenteses. A chave "escopo" existe, mas nao desliga nada: o mesmo portao guarda os arquivos intocaveis. ' +
  'As outras travas que se desligam dizem como na ultima linha do aviso delas.\n');
if (temOrdens) process.stdout.write('As ordens (dadas, cumpridas, recusadas) saem na auditoria automatica.\n');
process.exit(0);
