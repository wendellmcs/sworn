#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const molde = require('./lib/molde.js');
const config = require('./lib/config.js');
const texto = require('./lib/texto.js');

const USO = 'uso: gerar-agents-md.js [--fatias] [--respostas <arquivo.json>] [--gravar]\n';
const FLAGS_DO_USO = ['--respostas', '--gravar', '--fatias'];

// A4-gam-1 (pedido 12), borda: flag sem valor (ultima da linha, vazia ou seguida de outra flag do USO) caia calada no
// "sem respostas". O molde e o arg() do preparar-revisao.js.
function arg(nome) {
  const i = process.argv.indexOf('--' + nome);
  if (i === -1) return null;
  const valor = process.argv[i + 1];
  if (valor === undefined || valor === '' || FLAGS_DO_USO.indexOf(valor) !== -1) {
    process.stdout.write('ERRO: --' + nome + ' pede um valor.\n' + USO);
    process.exit(1);
  }
  return valor;
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
  const lidas = molde.lerRespostas(arquivoRespostas);
  if (!lidas.ok) {
    process.stdout.write('ERRO: ' + lidas.erro + '\n');
    process.exit(1);
  }
  valores = lidas.valores;
}

const cheio = molde.preencher(moldeTexto, valores, projeto);
const v = molde.validar(cheio);
if (!v.ok) {
  process.stdout.write('RECUSADO: o AGENTS.md gerado tem pendencias, e nada foi gravado:\n');
  for (const e of v.erros) process.stdout.write('  - ' + e + '\n');
  // A4-10 (pedido 12, microcopy): as fatias vem do arquivo de respostas; o RECUSADO diz onde corrigir.
  process.stdout.write(arquivoRespostas
    ? 'Corrija ' + arquivoRespostas + ' e rode de novo.\n'
    : 'Passe as respostas com --respostas <arquivo.json>, uma chave por fatia (os nomes saem com --fatias).\n');
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

// A4-gam-2 (pedido 12), estados: o write sem try saia em excecao crua, sem GRAVADO nem ERRO.
// A4-gam-3 (R2): 'wx' fecha a janela entre o existsSync e o write - o AGENTS.md que aparece nela sai EEXIST.
try { fs.writeFileSync(alvo, cheio, { encoding: 'utf8', flag: 'wx' }); } catch (e) {
  process.stdout.write('ERRO: nao consegui gravar ' + alvo + ' (' + texto.causaDoErro(e) + ').\n');
  process.stdout.write('Nada foi gravado: conserte a pasta e rode de novo.\n');
  process.exit(1);
}
process.stdout.write('GRAVADO em ' + alvo + '\n');
process.exit(0);
