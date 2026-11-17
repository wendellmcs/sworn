#!/usr/bin/env node
'use strict';
// V6 (D847): o /sworn-replay, chamado pelo mod (hooks/mods.tsx) por $.process.run.
// --guardar antes|depois|descartar, com { sessao, turno, caminho, agora } no stdin: copia o arquivo para a pasta
// temporaria do sworn (o antes, a 1a vez no turno; o depois, depois de a edicao rodar) ou, na edicao recusada ou com
// erro, apaga a copia de antes que ficou sem depois. Nao imprime nada.
// --texto, com { sessao, agora, cwd } no stdin: imprime o texto do /sworn-replay.
// Stdin que nao e JSON vale como entrada vazia (saida 0). Uma excecao (a pasta que nao se cria, o indice que nao se
// grava) sai com codigo 1 e a causa no stderr: o mod marca a copia que falhou e o /sworn-replay avisa; a edicao segue.
const fs = require('node:fs');

const modo = process.argv.includes('--texto') ? 'texto' : process.argv.includes('--guardar') ? 'guardar' : '';
try {
  const replay = require('./lib/replay.js');
  let entrada = {};
  try {
    const lido = JSON.parse(fs.readFileSync(0, 'utf8'));
    if (lido && typeof lido === 'object' && !Array.isArray(lido)) entrada = lido;
  } catch {
    // stdin que nao e JSON: segue com a entrada vazia (sem sessao, o texto e o de nenhuma edicao)
  }
  const sessao = typeof entrada.sessao === 'string' ? entrada.sessao : '';
  if (modo === 'guardar') {
    const fase = process.argv[process.argv.indexOf('--guardar') + 1];
    replay.guardar(sessao, entrada.turno, fase, entrada.caminho, entrada.agora);
  } else if (modo === 'texto') {
    // sem a hora do mod (o relogio dele falhou), a desta maquina: o "ha N min" e so um rotulo
    const agora = Number.isFinite(entrada.agora) ? entrada.agora : Date.now();
    const saida = replay.texto(replay.ler(sessao), agora, typeof entrada.cwd === 'string' ? entrada.cwd : process.cwd());
    process.stdout.write(saida + '\n');
  }
} catch (e) {
  process.stderr.write('sworn replay: ' + (e && e.message ? e.message : String(e)) + '\n');
  process.exitCode = 1;
}
