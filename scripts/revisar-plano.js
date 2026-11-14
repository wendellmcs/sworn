#!/usr/bin/env node
'use strict';
// C2 (/sworn:review-plan, parte mecanica): confere o que o plano cita contra o disco da pasta atual. Uso:
// node revisar-plano.js <plano.md> [--json]. Codigo 0 sem achado, 1 com achado, 2 sem plano legivel.
const fs = require('node:fs');
const path = require('node:path');
const gitLib = require('./lib/git.js');
const { ascii } = require('./lib/escopo.js');
const { conferir } = require('./lib/plano-conferir.js');

const CAUSA = { ENOENT: 'o arquivo nao existe', EISDIR: 'e uma pasta, nao um arquivo', EACCES: 'sem permissao de leitura' };

/**
 * Os arquivos do repositorio (para o nome curto e o caminho de fixture), ou null quando a lista falta (fora de um
 * repositorio, ou o git falhou). Com -z o nome com acento chega como e, sem aspas nem octal.
 */
function arquivosDoGit(cwd) {
  const r = gitLib.rodar(cwd, ['ls-files', '-z']);
  return gitLib.ok(r) ? String(r.stdout).split('\0').filter(Boolean) : null;
}

function main(argv, cwd) {
  const arquivo = argv.filter(function (a) { return a !== '--json'; })[0];
  if (!arquivo) {
    process.stderr.write('uso: node revisar-plano.js <plano.md> [--json]\n');
    return 2;
  }
  const caminho = path.resolve(cwd, arquivo);
  let texto;
  try {
    texto = fs.readFileSync(caminho, 'utf8');
  } catch (e) {
    process.stderr.write('sworn: nao consegui ler o plano ' + ascii(arquivo) + ': ' + (CAUSA[e.code] || e.code) +
      '; confira o caminho a partir da pasta atual\n');
    return 2;
  }
  const arquivos = arquivosDoGit(cwd);
  if (!arquivos) {
    process.stderr.write('sworn: sem a lista do git (fora de um repositorio, ou o git falhou): o nome curto so se ' +
      'confere na raiz e na pasta do plano\n');
  }
  const r = conferir(texto, cwd, { pasta: path.dirname(caminho), arquivos: arquivos || [] });
  const codigo = r.achados.length ? 1 : 0;
  if (argv.indexOf('--json') !== -1) {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    return codigo;
  }
  const linhas = ['sworn: plano ' + ascii(arquivo) + ': ' + r.citados + ' citados, ' + r.conferidos + ' conferidos; ' +
    (r.achados.length ? r.achados.length + ' achado(s):' : 'nenhum achado.')];
  r.achados.forEach(function (a) {
    linhas.push('  linha ' + a.linha + '  ' + a.tipo + '  ' + ascii(a.valor) + '  (' + ascii(a.motivo) + ')');
  });
  if (r.achados.length) linhas.push('sworn: corrija o plano e rode de novo, ate "nenhum achado".');
  process.stdout.write(linhas.join('\n') + '\n');
  return codigo;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2), process.cwd());

module.exports = { main };
