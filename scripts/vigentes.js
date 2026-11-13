#!/usr/bin/env node
'use strict';
// F4a: gera e confere o docs/vigentes.md, o que vale entre as decisoes, a partir do registro docs/decisoes.md.
//   node scripts/vigentes.js                 contagens em JSON: decisoes lidas, pares de revogacao e quantos sao em parte
//   node scripts/vigentes.js --gravar        grava o vigentes.md
//   node scripts/vigentes.js --conferir      sai 1 se o vigentes.md falta ou difere do gerado, ou se o registro tem
//                                            rodape copiado
// Opcoes: --decisoes <arquivo> (padrao docs/decisoes.md) e --saida <arquivo> (padrao docs/vigentes.md). Erro de uso,
// de leitura do registro ou de gravacao: saida 2.
const fs = require('node:fs');
const path = require('node:path');
const v = require('./lib/vigentes.js');
const texto = require('./lib/texto.js');

const COM_VALOR = ['--decisoes', '--saida'];
const SEM_VALOR = ['--gravar', '--conferir'];
// As mensagens saem em ASCII: o ponto do meio do cabecalho vai pelo nome.
const FORMATO = '"### D<n> <ponto do meio> <titulo>" (o ponto do meio e o caractere U+00B7, entre espacos)';

// O valor de uma opcao e o argumento seguinte, desde que nao seja outra opcao: "--saida --gravar" gravaria num
// arquivo chamado "--gravar".
function lerArgs(args) {
  const lidos = { '--decisoes': 'docs/decisoes.md', '--saida': 'docs/vigentes.md' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (SEM_VALOR.indexOf(a) !== -1) { lidos[a] = true; continue; }
    if (COM_VALOR.indexOf(a) === -1) return { erro: 'opcao desconhecida: ' + a };
    const valor = args[i + 1];
    if (valor === undefined || valor === '' || valor.slice(0, 2) === '--') return { erro: a + ' sem o caminho depois' };
    lidos[a] = valor;
    lidos[a + ':dado'] = true;
    i++;
  }
  if (lidos['--gravar'] && lidos['--conferir']) return { erro: 'use --gravar ou --conferir, nao os dois' };
  return lidos;
}

function main(args) {
  const lidos = lerArgs(args);
  if (lidos.erro) {
    console.error('ERRO: ' + lidos.erro + '. Uso: node scripts/vigentes.js [--gravar | --conferir] [--decisoes <arquivo>] [--saida <arquivo>]');
    return 2;
  }
  const registro = lidos['--decisoes'];
  const saida = lidos['--saida'];
  // O comando de conserto repete os caminhos que a pessoa passou: sem eles, gravaria o padrao e o arquivo conferido
  // seguiria velho.
  const aspas = function (p) { return /[\s"]/.test(p) ? '"' + p.replace(/"/g, '\\"') + '"' : p; };
  const gravar = 'node scripts/vigentes.js --gravar' + (lidos['--decisoes:dado'] ? ' --decisoes ' + aspas(registro) : '') +
    (lidos['--saida:dado'] ? ' --saida ' + aspas(saida) : '');
  let conteudo;
  try {
    conteudo = fs.readFileSync(registro, 'utf8');
  } catch (e) {
    console.error('ERRO: nao deu para ler o registro ' + registro + ' (' + texto.causaDoErro(e) + '): rode da raiz do projeto ou passe --decisoes <arquivo>');
    return 2;
  }
  const analise = v.analisar(conteudo);
  if (!analise.decisoes.length) {
    console.error('ERRO: nenhuma decisao em ' + registro + ': cada uma comeca por um cabecalho ' + FORMATO);
    return 2;
  }
  if (analise.repetidas.length || analise.cabecalhosTortos.length) {
    const tortos = analise.cabecalhosTortos;
    console.error('ERRO: o registro ' + registro + ' tem defeito, e a lista sairia errada:' +
      (analise.repetidas.length ? ' numero repetido (' + analise.repetidas.join(', ') + ');' : '') +
      (tortos.length ? ' cabecalho fora do formato ' + FORMATO + ' na(s) linha(s) ' + tortos.slice(0, 10).join(', ') +
        (tortos.length > 10 ? ' e mais ' + (tortos.length - 10) : '') + ';' : '') + ' conserte o registro e rode de novo');
    return 2;
  }
  const nome = path.relative(process.cwd(), registro).split(path.sep).join('/');
  const gerado = v.gerar(analise, nome);
  const parte = analise.revogacoes.filter(function (r) { return r.parte; }).length;
  const resumo = { decisoes: analise.decisoes.length, revogacoes: analise.revogacoes.length, emParte: parte };
  if (lidos['--gravar']) {
    try {
      fs.writeFileSync(saida, gerado);
    } catch (e) {
      console.error('ERRO: nao deu para gravar ' + saida + ' (' + texto.causaDoErro(e) + '): confira se a pasta existe e se o arquivo pode ser escrito');
      return 2;
    }
    console.log(JSON.stringify(Object.assign({ gravado: saida }, resumo)));
    return 0;
  }
  if (!lidos['--conferir']) {
    console.log(JSON.stringify(resumo));
    return 0;
  }
  const problemas = [];
  let atual = null;
  try {
    atual = fs.readFileSync(saida, 'utf8');
  } catch (e) {
    problemas.push(e && e.code === 'ENOENT' ? 'falta ' + saida + ': rode ' + gravar
      : 'nao deu para ler ' + saida + ' (' + texto.causaDoErro(e) + ')');
  }
  if (atual !== null && atual.replace(/\r\n/g, '\n') !== gerado) {
    problemas.push(saida + ' difere do que o registro gera (o registro mudou, ou o arquivo foi editado a mao): rode ' +
      gravar + ', que reescreve o arquivo inteiro');
  }
  const linhas = v.rodapes(conteudo);
  if (linhas.length) {
    problemas.push('rodape copiado (**Continua valendo:**) em ' + registro + ', linha(s) ' + linhas.slice(0, 10).join(', ') +
      (linhas.length > 10 ? ' e mais ' + (linhas.length - 10) : '') + ': apague esses rodapes no registro (o --gravar ' +
      'nao os tira); a lista do que vale fica em ' + saida);
  }
  console.log(JSON.stringify(Object.assign({ ok: problemas.length === 0, problemas: problemas }, resumo)));
  return problemas.length ? 1 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main };
