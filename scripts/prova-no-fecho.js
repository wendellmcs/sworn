#!/usr/bin/env node
'use strict';
// D794: liga, desliga ou mostra, neste projeto (a raiz da pasta atual), a prova de pronto rodada pelo proprio gancho
// do fecho. A chave fica na maquina de quem roda, fora do repositorio. Uso: node prova-no-fecho.js ligar|desligar|ver
const config = require('./lib/config.js');
const lib = require('./lib/prova-no-fecho.js');

function main(argv, cwd, env) {
  const acao = argv[0];
  if (acao !== 'ligar' && acao !== 'desligar' && acao !== 'ver') {
    process.stderr.write('uso: node prova-no-fecho.js ligar | desligar | ver\n');
    return 2;
  }
  const raiz = config.raizDoProjeto(cwd);
  const projeto = config.carregarProjeto(raiz) || {};
  const prova = typeof projeto.provaDePronto === 'string' ? projeto.provaDePronto.trim() : '';
  if (acao === 'ver') {
    const ligada = lib.provaLigada(raiz, env);
    // ligada para outro comando (o projeto.json mudou depois): o gancho nao roda o novo sem o dono ligar de novo
    if (ligada !== null && ligada !== prova) {
      process.stdout.write('sworn: prova no fecho parada em ' + raiz + ': foi ligada para "' + ligada + '", e o ' +
        'projeto.json declara ' + (prova ? '"' + prova + '"' : 'outra coisa (sem provaDePronto)') + '. O gancho so ' +
        'roda o comando que voce ligou; para rodar o de agora: node prova-no-fecho.js ligar\n');
      return 0;
    }
    process.stdout.write('sworn: prova no fecho ' + (ligada !== null ? 'ligada' : 'desligada') + ' em ' + raiz +
      (prova ? ' (prova: ' + prova + ')' : ' (sem provaDePronto no projeto.json)') + '\n');
    return 0;
  }
  if (acao === 'ligar' && !prova) {
    process.stderr.write('sworn: ' + raiz + ' nao declara provaDePronto no .claude/sworn/projeto.json; declare o ' +
      'comando da prova (o /sworn:init pergunta) e ligue de novo\n');
    return 1;
  }
  let mudou;
  try {
    mudou = acao === 'ligar' ? lib.ligar(raiz, prova, env) : lib.desligar(raiz, env);
  } catch (e) {
    process.stderr.write('sworn: ' + e.message + '\n');
    return 1;
  }
  if (acao === 'desligar') {
    process.stdout.write('sworn: prova no fecho ' + (mudou ? 'desligada' : 'ja estava desligada') + ' em ' + raiz + '\n');
    return 0;
  }
  process.stdout.write('sworn: prova no fecho ligada em ' + raiz + '. No fim do turno que editou codigo sem rodar a ' +
    'prova, o gancho roda: ' + prova + ' (teto de ' + (lib.TETO_MS / 1000) + ' s). Desligar: node prova-no-fecho.js ' +
    'desligar\n');
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2), process.cwd(), process.env);

module.exports = { main };
