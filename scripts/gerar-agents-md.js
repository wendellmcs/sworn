#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const molde = require('./lib/molde.js');
const config = require('./lib/config.js');

function arg(nome) {
  const i = process.argv.indexOf('--' + nome);
  return i !== -1 ? process.argv[i + 1] : null;
}

const cwd = process.cwd();
const gravar = process.argv.indexOf('--gravar') !== -1;
const projeto = config.carregarProjeto(cwd);

if (!projeto) {
  process.stdout.write('ERRO: rode /sworn:init primeiro; nao achei .claude/sworn/projeto.json\n');
  process.exit(1);
}

const moldeTexto = fs.readFileSync(path.join(__dirname, '..', 'modelos', 'agents-md.md'), 'utf8');

if (process.argv.indexOf('--fatias') !== -1) {
  const nomes = [];
  for (const s of molde.slots(moldeTexto)) {
    if (s.tipo === 'texto' && nomes.indexOf(s.nome) === -1) nomes.push(s.nome);
  }
  process.stdout.write(JSON.stringify(nomes, null, 2) + '\n');
  process.exit(0);
}

let valores = {};
const arquivoRespostas = arg('respostas');
if (arquivoRespostas) {
  try { valores = JSON.parse(fs.readFileSync(arquivoRespostas, 'utf8')); }
  catch (e) {
    process.stdout.write('ERRO: nao consegui ler ' + arquivoRespostas + ': ' + e.message + '\n');
    process.exit(1);
  }
}

const cheio = molde.preencher(moldeTexto, valores, projeto);
const v = molde.validar(cheio);
if (!v.ok) {
  process.stdout.write('RECUSADO: o AGENTS.md gerado nao passou no validador.\n');
  for (const e of v.erros) process.stdout.write('  - ' + e + '\n');
  process.exit(1);
}

const alvo = path.join(cwd, 'AGENTS.md');

if (!gravar) {
  process.stdout.write('PROPOSTA (nao gravei nada). Destino seria: ' + alvo + '\n');
  process.stdout.write('----- INICIO -----\n');
  process.stdout.write(cheio);
  process.stdout.write('\n----- FIM -----\n');
  process.stdout.write('Para gravar, rode de novo com --gravar, DEPOIS de o dono aprovar.\n');
  process.exit(0);
}

// Muitos projetos ja tem um AGENTS.md, e ele costuma ser trabalho de meses.
if (fs.existsSync(alvo)) {
  process.stdout.write('ERRO: ' + alvo + ' ja existe. Nao sobrescrevo o AGENTS.md deste projeto.\n');
  process.stdout.write('Ele pode ser trabalho de meses. Se for para substituir, isso e decisao do\n');
  process.stdout.write('dono: ele renomeia o atual antes de rodar de novo.\n');
  process.exit(1);
}

fs.writeFileSync(alvo, cheio, 'utf8');
process.stdout.write('GRAVADO em ' + alvo + '\n');
process.exit(0);
