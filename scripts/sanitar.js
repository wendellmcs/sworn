#!/usr/bin/env node
'use strict';
const path = require('node:path');
const sanit = require('./lib/sanitacao.js');

/**
 * H5 - o portao de sanitacao das TRES superficies da D133: conteudo, autoria,
 * mensagens.
 *
 * POR QUE ESTE ARQUIVO PRECISOU EXISTIR. `scripts/lib/sanitacao.js` tem mais de
 * trezentas linhas, cobre as tres superficies, e ate agora NADA o executava
 * inteiro: o teste chamava o autoteste e a superficie 1, e as outras duas so
 * viviam em funcao exportada. Lib sem comando e codigo que ninguem roda - o
 * mesmo defeito que a T43 corrigiu na auditoria por cicatriz.
 *
 * POR QUE ELE E COMANDO E NAO TESTE, e isto e a decisao 13 do plano: autoria e
 * mensagem so existem onde ha HISTORICO de git. A suite tem de continuar
 * passando numa copia sem historico - que e exatamente o caso da instalacao
 * limpa da T46 e do export da T47. So o conteudo reprova a suite; as outras duas
 * saem por aqui, quando alguem pergunta.
 *
 * TRES SAIDAS, e a terceira e a que impede a mentira silenciosa:
 *   0  limpo nas tres
 *   1  vazou - a lista sai com arquivo e linha
 *   2  NAO DEU PARA MEDIR - git mudo, ou o detector nao se provou. Nunca 0.
 *
 * Um comando que devolvesse 0 quando nao conseguiu medir diria "limpo" sobre o
 * que nao leu, e e esse o silencio que a D79 existe para quebrar.
 */

const NOMES = { 1: 'conteudo ', 2: 'autoria  ', 3: 'mensagens' };
const USO = 'uso: sanitar.js [--raiz <pasta>] [--so-conteudo]';
const FLAGS_DO_USO = ['--raiz', '--so-conteudo'];

// A4-san-1 (pedido 12), borda: `--raiz` sem valor (ultima da linha, vazia ou seguida de outra flag do USO) caia
// calada em '.' - media a pasta de onde se chamou. O molde e o argumento() do plataforma.js.
function argumento(argv, nome) {
  const i = argv.indexOf(nome);
  if (i === -1) return null;
  const valor = argv[i + 1];
  if (valor === undefined || valor === '' || FLAGS_DO_USO.indexOf(valor) !== -1) {
    console.error('ERRO: ' + nome + ' pede um valor.');
    console.error(USO);
    process.exit(2);
  }
  return valor;
}

function main() {
  const argv = process.argv.slice(2);
  const pedida = argumento(argv, '--raiz') || '.';
  const raiz = path.resolve(pedida);
  const soConteudo = argv.indexOf('--so-conteudo') !== -1;

  // O instrumento, antes do que ele mede. "Passar nao e prova; o controle
  // negativo e" - detector que nunca acusa devolve limpo para qualquer coisa.
  const prova = sanit.autoteste(raiz);
  if (!prova.ok) {
    console.error('O DETECTOR NAO SE PROVOU - nenhum veredito vale. Falhas:');
    prova.falhas.forEach(function (f) {
      console.error('  ' + f.classe + ' / ' + f.tipo + ': ' + f.porQue);
    });
    process.exit(2);
  }

  const r = sanit.auditar(raiz);
  if (r === null) {
    console.error('NAO DEU PARA MEDIR: o git nao respondeu em ' + pedida + '.');
    console.error('Sem a lista de arquivos e sem o historico nao ha veredito - e');
    console.error('veredito e que este comando existe para dar. Saida 2, nao 0.');
    process.exit(2);
  }

  // A raiz sai COMO FOI PEDIDA, nunca resolvida. Um comando cuja saida existe
  // para ser colada como evidencia, e que caca caminho de maquina, nao pode
  // abrir a propria saida com o caminho absoluto desta maquina.
  console.log('Sanitacao de ' + pedida);
  console.log(prova.testadas + ' verificacoes: ' + prova.genericas + ' classes genericas + ' +
              prova.locais + ' do vocabulario local (cada classe com isca e controle negativo) + ' +
              (prova.testadas - prova.genericas - prova.locais) +
              ' fora das classes (autoria do historico e mensagem de commit).');
  if (!r.comVocabularioLocal) {
    console.log('SEM ' + sanit.ARQUIVO_LOCAL + ': rodando so com as classes genericas.');
    console.log('Nome de pessoa, de empresa e de projeto interno NAO estao sendo procurados.');
  }
  // A4-03: o `docs/` fora e so do export do sworn (exportar.js); aqui a pasta inteira entra.
  console.log('Nao verificados: os arquivos que o .gitignore manda o git ignorar.');
  console.log('Se um deles vai ser publicado, tire-o do .gitignore e rode de novo.');
  console.log('');

  const tamanhos = { 1: r.arquivos + ' arquivos', 2: 'historico', 3: r.commits + ' commits' };
  [1, 2, 3].forEach(function (s) {
    console.log('SUPERFICIE ' + s + ' ' + NOMES[s] + '  ' +
                String(tamanhos[s]).padEnd(14) + '-> ' + (r.porSuperficie[s] || 0));
  });
  console.log('');

  const relevantes = soConteudo
    ? r.achados.filter(function (a) { return a.superficie === 1; })
    : r.achados;

  // D420/IN-01: arquivo da superficie que nao abriu e arquivo NAO lido. Aparece
  // sempre; e sem achado nenhum o veredito e "nao deu para medir" (2), nunca LIMPO.
  const ilegiveis = r.ilegiveis || [];
  if (ilegiveis.length > 0) {
    console.log('NAO LI ' + ilegiveis.length + ' arquivo(s) da superficie:');
    ilegiveis.forEach(function (i) { console.log('  ' + i.arquivo + '  (' + i.porQue + ')'); });
    console.log('');
  }

  // D429/2: binario (NUL) pula com aviso. Nao trava o veredito, mas nunca some do relatorio.
  const naoConferidos = r.naoConferidos || [];
  if (naoConferidos.length > 0) {
    console.log('AVISO - nao conferido (binario): ' + naoConferidos.length + ' arquivo(s) da superficie, pulados:');
    naoConferidos.forEach(function (i) { console.log('  ' + i.arquivo + '  (' + i.porQue + ')'); });
    console.log('');
  }

  if (relevantes.length === 0 && ilegiveis.length > 0) {
    console.error('NAO DEU PARA MEDIR: ' + ilegiveis.length + ' arquivo(s) da superficie nao abriram (lista acima).');
    console.error('Sem le-los nao ha veredito. Saida 2, nao 0.');
    process.exit(2);
  }

  if (relevantes.length === 0) {
    console.log(soConteudo
      ? 'VEREDITO: LIMPO no conteudo.'
      : 'VEREDITO: LIMPO nas tres superficies.');
    if (naoConferidos.length > 0) {
      console.log('RESSALVA: ' + naoConferidos.length + ' arquivo(s) nao conferido(s) (binario) - lista acima.');
    }
    process.exit(0);
  }

  console.log('VAZOU - ' + relevantes.length + ' trecho(s) que nao pode(m) ir a publico:');
  relevantes.forEach(function (a) {
    console.log('  S' + a.superficie + '  ' + a.classe + '  ' + a.arquivo + ':' + a.linha);
  });
  console.log('S1, S2 e S3 sao as superficies acima: 1 o conteudo dos arquivos, 2 a autoria dos commits,');
  console.log('3 as mensagens de commit. Depois do S vem o tipo do que vazou (segredo, email...) e onde ele esta.');
  console.log('');
  console.log('O trecho NAO e impresso de proposito: imprimi-lo poria o vazamento');
  console.log('na saida do terminal, que costuma ser colada em relatorio. Abra o');
  console.log('arquivo na linha indicada.');
  process.exit(1);
}

main();
