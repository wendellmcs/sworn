#!/usr/bin/env node
'use strict';
// R2b: a conferencia da tela contra a referencia, largura por largura. Para cada largura, a captura (capturar-tela.js)
// fotografa e mede a tela e a referencia; a comparacao (lib/conferencia-tela.js) diz o que difere e o que nao se
// comparou, e, com o .claude/sworn/design.json da pasta onde roda, o tamanho do sistema mais perto do da referencia.
//
//   node scripts/conferir-tela.js --url <a tela> --referencia <a tela de referencia> --saida <pasta>
//     [--larguras 1440,768,390] [--tempo-max 30000]
//
// Grava <saida>/tela-<largura>/ e <saida>/referencia-<largura>/ (a foto e a evidencia de cada captura) e
// <saida>/conferencia.json. Imprime o resumo em JSON e sai com 0 quando tudo se comparou, ou 1 quando alguma medida
// ficou sem comparar (o que nao se comparou barra o "pronto": as diferencas so se listam) e no erro da chamada.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const captura = require('./lib/captura.js');
const conferencia = require('./lib/conferencia-tela.js');
const config = require('./lib/config.js');

const CAPTURA = path.join(__dirname, 'capturar-tela.js');
// A folga do processo da captura alem do prazo dela: abrir e fechar o navegador.
const FOLGA_DO_PROCESSO = 120000;

// A primeira linha com texto de uma saida, sem o \r do Windows; '' sem nenhuma.
function linhaDe(texto) {
  return String(texto || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean)[0] || '';
}

// A linha que diz o erro na saida de erro de um Node que caiu: a do "TypeError: ..." (a ultima com cara de erro), nao
// o aviso final da versao ("Node.js v22") nem as linhas da pilha ("at ..."); sem nenhuma, a ultima que sobrou.
function linhaDoErro(texto) {
  const linhas = String(texto || '').split(/\r?\n/).map(function (l) { return l.trim(); })
    .filter(function (l) { return l && !/^at /.test(l) && !/^Node\.js v\d/.test(l); });
  const doErro = linhas.filter(function (l) { return /^(?:[A-Z]\w*)?Error\b/.test(l); });
  return doErro.length ? doErro[doErro.length - 1] : (linhas.length ? linhas[linhas.length - 1] : '');
}

// Captura uma tela numa largura e devolve o que resultadoDaCaptura diz.
function medir(url, largura, pasta, tempoMax) {
  const prazo = tempoMax + FOLGA_DO_PROCESSO;
  return resultadoDaCaptura(spawnSync(process.execPath, [CAPTURA, '--url', url, '--saida', pasta, '--largura',
    String(largura), '--tempo-max', String(tempoMax)], { encoding: 'utf8', timeout: prazo, windowsHide: true }), prazo);
}

// Do resultado do processo da captura (o do spawnSync), o `layout` da evidencia (que pode trazer `erro`, quando a
// leitura falhou na pagina), ou { erro } com o motivo da captura que nao deu certo. O motivo vai para o disco: passa
// pela limpeza.
function resultadoDaCaptura(r, prazo) {
  if (r.error && r.error.code === 'ETIMEDOUT') {
    return { erro: 'a captura passou de ' + Math.round(prazo / 1000) + ' s e foi parada: a pagina demorou demais; ' +
      'confira se ela termina de carregar, ou aumente --tempo-max' };
  }
  if (r.error) return { erro: 'a captura nao comecou: ' + captura.textoParaODisco(r.error.message) };
  if (r.signal) {
    return { erro: 'a captura foi parada pelo sinal ' + r.signal + ' (o sistema encerrou o processo, por exemplo por ' +
      'falta de memoria): rode de novo, com menos programas abertos' };
  }
  if (r.status !== 0) {
    // A captura escreve o "ERRO: ..." na saida padrao; um erro do Node que escapou vai para a de erro.
    const linha = linhaDe(r.stdout).replace(/^ERRO: /, '') || linhaDoErro(r.stderr) || 'sem mensagem, codigo ' + r.status;
    return { erro: 'a captura falhou: ' + captura.textoParaODisco(linha) };
  }
  let fim;
  try { fim = JSON.parse(r.stdout); } catch (e) {
    return { erro: 'a saida da captura nao e o resumo em JSON esperado: ' + captura.textoParaODisco(linhaDe(r.stdout)) };
  }
  if (!fim || typeof fim.evidencia !== 'string') {
    return { erro: 'o resumo da captura veio sem o caminho da evidencia: rode de novo; se repetir, a captura mudou de ' +
      'formato e a conferencia precisa acompanhar' };
  }
  let evidencia;
  try { evidencia = JSON.parse(fs.readFileSync(fim.evidencia, 'utf8')); } catch (e) {
    return { erro: 'nao deu para ler a evidencia da captura em ' + captura.textoParaODisco(fim.evidencia) + ' (' +
      captura.textoParaODisco(e.message) + '): rode de novo; se repetir, abra o arquivo e veja se ele esta inteiro' };
  }
  return evidencia.layout || { erro: 'a evidencia da captura veio sem o layout' };
}

function main(argv) {
  const lido = conferencia.lerArgs(argv);
  if (lido.erro) return { erro: lido.erro };
  const o = lido.opcoes;
  try { fs.mkdirSync(o.saida, { recursive: true }); } catch (e) {
    return { erro: 'nao deu para criar a pasta de --saida "' + o.saida + '" (' + (e.code || e.message) + '): escolha uma ' +
      'pasta onde se pode escrever' };
  }
  const medicoes = o.larguras.map(function (largura) {
    return { largura, tela: medir(o.url, largura, path.join(o.saida, 'tela-' + largura), o.tempoMax),
      referencia: medir(o.referencia, largura, path.join(o.saida, 'referencia-' + largura), o.tempoMax) };
  });
  const sistema = config.carregarDesign(process.cwd());
  const r = conferencia.conferir(medicoes, sistema);
  const caminho = path.join(o.saida, 'conferencia.json');
  // O endereco vai limpo de segredo, como na evidencia da captura.
  try {
    fs.writeFileSync(caminho, JSON.stringify(Object.assign({ url: captura.semSegredo(o.url),
      referencia: captura.semSegredo(o.referencia), hora: new Date().toISOString(), comDesign: !!sistema }, r), null, 2) + '\n');
  } catch (e) {
    return { erro: 'nao deu para gravar ' + caminho + ' (' + (e.code || e.message) + '): as capturas ficaram na pasta' };
  }
  const fim = { ok: r.tudoComparado, conferencia: caminho, diferencas: r.diferencas, naoComparado: r.naoComparado,
    tudoComparado: r.tudoComparado };
  const aviso = conferencia.avisoDaConferencia(r);
  if (aviso) fim.aviso = aviso;
  return fim;
}

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (e) { r = { erro: captura.textoParaODisco(String(e.message)) }; }
  if (r.erro) {
    process.stdout.write('ERRO: ' + r.erro + '\n');
    process.exitCode = 1;
  } else {
    process.stdout.write(JSON.stringify(r) + '\n');
    process.exitCode = r.tudoComparado ? 0 : 1;
  }
}

module.exports = { main, medir, resultadoDaCaptura };
