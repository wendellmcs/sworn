#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const regraLib = require('./lib/regra.js');
const config = require('./lib/config.js');
const textoLib = require('./lib/texto.js');

function arg(nome) {
  const i = process.argv.indexOf('--' + nome);
  return i !== -1 ? process.argv[i + 1] : null;
}

const gatilho = (arg('gatilho') || '').trim();
const acao = (arg('acao') || '').trim();
const gravar = process.argv.indexOf('--gravar') !== -1;
// A4-04: a raiz do projeto, nao a pasta atual - a regra gravada numa subpasta nunca era lida pela abertura.
const alvo = config.caminhoEmSworn(config.raizDoProjeto(process.cwd()), 'regras.md');

if (!gatilho || !acao) {
  process.stdout.write("uso: propor-regra.js --gatilho '<quando>' --acao '<o que fazer>' [--gravar]\n");
  process.exit(1);
}

// D434: regra e UMA linha so. Quebra de linha dentro do gatilho ou da acao gravaria a regra
// partida (a segunda metade vira texto solto, e o arquivo diz "0 regras"). Recusa antes de tudo.
if (/[\r\n]/.test(gatilho) || /[\r\n]/.test(acao)) {
  process.stdout.write('RECUSADA: o gatilho ou a acao tem quebra de linha. Nada foi gravado.\n');
  process.stdout.write('  - escreva gatilho e acao numa linha so (a regra e uma linha so) e rode de novo\n');
  process.exit(1);
}

const bruta = gatilho + ' -> ' + acao;
const v = regraLib.validarRegra(bruta);

if (!v.ok) {
  process.stdout.write('RECUSADA: ' + bruta + '\n');
  for (const e of v.erros) process.stdout.write('  - ' + e + '\n');
  process.exit(1);
}

if (!gravar) {
  // D11: nada e gravado sem OK explicito. O default e NAO escrever.
  process.stdout.write('PROPOSTA (nao gravei nada):\n\n  - ' + bruta + '\n\n');
  process.stdout.write('Destino: ' + alvo + '\n');
  process.stdout.write('Para gravar, rode de novo com --gravar, DEPOIS de o dono aprovar.\n');
  process.exit(0);
}

// A4-05: so o regras.md AUSENTE vira o cabecalho padrao. O que existe e nao abre, ou nao e texto utf8 (UTF-16 do `>`
// do PowerShell 5.1, latin1), e recusado: ler como utf8 e regravar destruia as regras que ja estavam la.
function recusarLeitura(porQue) {
  process.stdout.write('ERRO: o ' + alvo + ' ' + porQue + '. Nao gravei.\n');
  process.stdout.write('  - converta o arquivo para texto utf8 (ou corrija a causa) e rode de novo\n');
  process.exit(1);
}
let bytes = null;
try { bytes = fs.readFileSync(alvo); } catch (e) {
  if (!e || e.code !== 'ENOENT') recusarLeitura('nao abriu: ' + textoLib.causaDoErro(e));
}
let texto = '# Regras deste projeto\n';
if (bytes) {
  // ignoreBOM: o BOM utf8 fica no texto e volta ao arquivo como estava.
  try { texto = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch (e) { texto = null; }
  if (texto === null || texto.indexOf('\0') !== -1) {
    recusarLeitura('nao e texto utf8 (UTF-16, como o `>` do PowerShell 5.1 grava, ou outra codificacao)');
  }
}

// D442/6 (T-20): duplicata e a LINHA inteira ("- " + regra), nao trecho: a regra que e so o comeco de outra
// ("ao editar -> rodar git status" x "... status antes") era dada como JA EXISTE e nao era gravada.
const jaTem = texto.split(/\r?\n/).some(function (l) { return l.trim().replace(/^-\s*/, '') === bruta; });
if (jaTem) {
  process.stdout.write('JA EXISTE, nao dupliquei: ' + bruta + '\n');
  process.exit(0);
}

const novo = texto.replace(/\s*$/, '') + '\n- ' + bruta + '\n';
const conferencia = regraLib.validarArquivo(novo);
if (!conferencia.ok) {
  process.stdout.write('ERRO: o arquivo ficaria invalido. Nao gravei.\n');
  for (const e of conferencia.erros) process.stdout.write('  - ' + e + '\n');
  process.exit(1);
}

fs.mkdirSync(path.dirname(alvo), { recursive: true });
fs.writeFileSync(alvo, novo, 'utf8');
process.stdout.write('GRAVADA em ' + alvo + ':\n  - ' + bruta + '\n');
process.stdout.write('Total de regras agora: ' + conferencia.total + '\n');
process.exit(0);
