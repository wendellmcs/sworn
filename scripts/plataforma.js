#!/usr/bin/env node
'use strict';
const path = require('node:path');
const plataforma = require('./lib/plataforma.js');

/**
 * H6 na tela: em que sistemas este plugin de fato rodou, e o que nele so se
 * prova rodando no sistema de verdade.
 *
 * A matriz ja e conferida pela suite a cada rodada. Este comando existe porque
 * a DECLARACAO tem leitor humano: quem instala o plugin em Linux merece uma
 * frase que diga, sem eufemismo, o que ninguem mediu ali. Relatorio que so vive
 * dentro de uma assercao nao declara nada a ninguem.
 *
 * Saida 1 quando a matriz nao cobre o disco - orfa ou ponto morto. Um relatorio
 * de cobertura que se contradiz nao serve de declaracao.
 *
 * Saida 2 quando nao ha veredito (a convencao do sanitar.js): erro de uso, ou
 * caminho que a varredura nao leu. Nunca 1, que mandaria editar PONTOS.
 */

const USO = 'uso: plataforma.js [--raiz <pasta>] [--como ' + plataforma.SISTEMAS.join('|') + ']';
const FLAGS_DO_USO = ['--raiz', '--como'];

function recusar(msg) {
  console.error(msg);
  console.error(USO);
  process.exit(2);
}

// A1 (pedido 12), borda: flag sem valor (ultima da linha, vazia ou seguida de outra flag do USO) caia calada no
// padrao - `--raiz --como linux` media a pasta "--como". O molde e o arg() do preparar-revisao.js.
function argumento(argv, nome) {
  const i = argv.indexOf(nome);
  if (i === -1) return null;
  const valor = argv[i + 1];
  if (valor === undefined || valor === '' || FLAGS_DO_USO.indexOf(valor) !== -1) {
    recusar('ERRO: ' + nome + ' pede um valor.');
  }
  return valor;
}

function main() {
  const argv = process.argv.slice(2);
  const raiz = path.resolve(argumento(argv, '--raiz') || '.');
  const so = argumento(argv, '--como');
  if (so !== null && plataforma.SISTEMAS.indexOf(so) === -1) {
    recusar('ERRO: --como aceita ' + plataforma.SISTEMAS.join(', ') + '; veio "' + so + '".');
  }

  const m = plataforma.matriz(raiz, so || undefined);
  console.log(plataforma.texto(m));

  if (m.naoLidos.length > 0) {
    console.error('');
    console.error('A varredura NAO LEU ' + m.naoLidos.length + ' caminho(s) (NAO LIDOS, acima): sem eles a matriz nao');
    console.error('vale, e um MORTO pode ser so o arquivo que nao se leu.');
    console.error('Para consertar: confira se ' + raiz + ' e a raiz do plugin (--raiz) e se ela se le;');
    console.error('depois rode este comando de novo.');
    process.exit(2);
  }
  if (!m.integra) {
    console.error('');
    console.error('A matriz NAO cobre o disco. Enquanto isto valer, a declaracao acima');
    console.error('fala de um codigo que nao e mais este.');
    console.error('ORFA: trecho que depende do sistema num arquivo que o ponto do mesmo tipo nao lista.');
    console.error('MORTO: arquivo que um ponto lista e que ja nao tem trecho do tipo desse ponto.');
    console.error('(o tipo e a primeira coluna nas listas ORFAS e MORTOS, acima)');
    console.error('Para consertar: em scripts/lib/plataforma.js, na lista PONTOS, ponha o arquivo de cada ORFA nos');
    console.error('arquivos do ponto do tipo dela e tire cada MORTO dos arquivos do ponto dele.');
    console.error('Depois rode este comando de novo.');
    process.exit(1);
  }
  process.exit(0);
}

main();
