#!/usr/bin/env node
'use strict';
const catalogo = require('./lib/catalogo.js');

/**
 * A consulta ao catalogo de modelos pela linha de comando: se e hora de
 * consultar, o texto do modo sem rede, e o registro do desfecho. E o que o
 * /sworn:init chama ao terminar, com o motivo `instalacao` - o gatilho 1 da
 * spec (decisao 36) -, e o que o /sworn:audit chama no Passo 1b.
 *
 * Existe em vez de `node -e` por um motivo medido: o one-liner poe o caminho do
 * plugin DENTRO de uma string JavaScript, e no Windows esse caminho vem com barra
 * invertida - cada barra vira escape, e o require procura um modulo que nao
 * existe. Como argumento de shell o caminho chega intacto, que e como os outros
 * comandos das skills ja o passam.
 *
 * ESTE SCRIPT NAO ABRE CONEXAO (decisao 14): quem consulta e a skill, no agente
 * principal. Le e grava na raiz do projeto (a pasta com .claude/sworn/projeto.json), mesmo rodado de uma subpasta.
 */

const flags = require('./lib/flags.js');

// A6-15/A7-06: da subpasta, a raiz do projeto (a pasta com .claude/sworn/projeto.json), como os outros scripts
const cwd = require('./lib/config.js').raizDoProjeto(process.cwd());
const USO = 'uso: catalogo.js --motivo <motivo> | --registrar <' +
  catalogo.DESFECHOS.join('|') + '> [fonte...] | --degradado';
const FLAGS = ['--motivo', '--registrar', '--degradado'];

// A4-43 (0.66.0): a regra da flag sem valor e a da lib/flags.js (antes `--motivo " "` consultava o motivo " ", e
// `--registrar --motivo` dizia "desfecho desconhecido"); a falta do valor ganha a frase de cada flag, e a repetida
// sai com a frase da lib. Erro de uso aqui vai ao stdout com o USO, saida 1, como os outros deste script.
function valorDe(nome, falta) {
  return flags.valor(process.argv, nome, FLAGS, function (msg) {
    process.stdout.write('ERRO: ' + (/ pede um valor\.$/.test(msg) ? falta : msg) + '\n' + USO + '\n');
    process.exit(1);
  });
}

if (process.argv.indexOf('--degradado') !== -1) {
  process.stdout.write(catalogo.motivoDegradado() + '\n');
  process.exit(0);
}

if (process.argv.indexOf('--motivo') !== -1) {
  const motivo = valorDe('--motivo', '--motivo sem valor.');
  const r = catalogo.deveConsultar(catalogo.ler(cwd), motivo, Date.now());
  process.stdout.write(JSON.stringify(r) + '\n');
  process.exit(0);
}

if (process.argv.indexOf('--registrar') !== -1) {
  const desfecho = valorDe('--registrar', '--registrar sem valor: use ' + catalogo.DESFECHOS.join(', ') + '.');
  // registrar() troca desfecho desconhecido por 'falhou', para o lado seguro.
  // Aqui quem digitou esta presente: recusar e dizer vale mais que trocar calado.
  if (catalogo.DESFECHOS.indexOf(desfecho) === -1) {
    process.stdout.write('ERRO: desfecho desconhecido "' + (desfecho || '') + '": use ' +
      catalogo.DESFECHOS.join(', ') + '.\n');
    process.exit(1);
  }
  // `achados` fica vazio de proposito: o que a consulta trouxe se mostra ao dono
  // na conversa, com a fonte. O arquivo guarda quando, como terminou e de onde.
  const fontes = process.argv.slice(process.argv.indexOf('--registrar') + 2);
  // A6-80: o gravar sem captura saia em stack trace (um `.claude` que e arquivo da ENOTDIR); agora a causa e o passo.
  let alvo;
  try {
    alvo = catalogo.gravar(cwd, catalogo.registrar(desfecho, [], fontes, Date.now()));
  } catch (e) {
    process.stdout.write('ERRO: nao consegui gravar o registro da consulta em ' + catalogo.caminho(cwd) + ': ' +
      require('./lib/texto.js').causaDoErro(e) + '. Confira se .claude e .claude/sworn sao pastas (e nao arquivos)' +
      ' e se da para escrever nelas, e rode de novo.\n');
    process.exit(1);
  }
  process.stdout.write('sworn: consulta registrada (' + desfecho + ', ' + fontes.length +
    ' fonte(s)) em ' + alvo + '\n');
  process.exit(0);
}

process.stdout.write('ERRO: nada a fazer.\n' + USO + '\n');
process.exit(1);
