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
 * principal. Le e grava na pasta atual - quem chama roda de dentro da raiz.
 */

function arg(nome) {
  const i = process.argv.indexOf('--' + nome);
  return i !== -1 ? process.argv[i + 1] : null;
}

const cwd = process.cwd();
const USO = 'uso: catalogo.js --motivo <motivo> | --registrar <' +
  catalogo.DESFECHOS.join('|') + '> [fonte...] | --degradado';

if (process.argv.indexOf('--degradado') !== -1) {
  process.stdout.write(catalogo.motivoDegradado() + '\n');
  process.exit(0);
}

if (process.argv.indexOf('--motivo') !== -1) {
  const motivo = arg('motivo');
  if (!motivo) {
    process.stdout.write('ERRO: --motivo sem valor.\n' + USO + '\n');
    process.exit(1);
  }
  const r = catalogo.deveConsultar(catalogo.ler(cwd), motivo, Date.now());
  process.stdout.write(JSON.stringify(r) + '\n');
  process.exit(0);
}

if (process.argv.indexOf('--registrar') !== -1) {
  const desfecho = arg('registrar');
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
  const alvo = catalogo.gravar(cwd, catalogo.registrar(desfecho, [], fontes, Date.now()));
  process.stdout.write('sworn: consulta registrada (' + desfecho + ', ' + fontes.length +
    ' fonte(s)) em ' + alvo + '\n');
  process.exit(0);
}

process.stdout.write('ERRO: nada a fazer.\n' + USO + '\n');
process.exit(1);
