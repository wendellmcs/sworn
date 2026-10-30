#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const molde = require('./lib/molde.js');
const config = require('./lib/config.js');
const texto = require('./lib/texto.js');

const USO = 'uso: gerar-skill.js [--fatias] [--respostas <arquivo.json>] [--gravar]\n';
const FLAGS_DO_USO = ['--respostas', '--gravar', '--fatias'];

// A4-gsk-1 (pedido 12), borda: flag sem valor (ultima da linha, vazia ou seguida de outra flag do USO) caia calada no
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
const arquivoRespostas = arg('respostas');
const gravar = process.argv.indexOf('--gravar') !== -1;

const projeto = config.carregarProjeto(cwd);
if (!projeto) {
  process.stdout.write('ERRO: rode /sworn:init primeiro; nao achei .claude/sworn/projeto.json\n');
  process.exit(1);
}

let valores = {};
if (arquivoRespostas) {
  const lidas = molde.lerRespostas(arquivoRespostas);
  if (!lidas.ok) { process.stdout.write('ERRO: ' + lidas.erro + '\n'); process.exit(1); }
  valores = lidas.valores;
}

const moldeTexto = fs.readFileSync(path.join(__dirname, '..', 'modelos', 'skill-projeto.md'), 'utf8');

if (process.argv.indexOf('--fatias') !== -1) {
  const pedidas = molde.slots(moldeTexto).filter(function (s) { return s.tipo === 'texto'; });
  process.stdout.write(JSON.stringify(pedidas.map(function (s) { return s.nome; }), null, 2) + '\n');
  process.exit(0);
}

const cheio = molde.preencher(moldeTexto, valores, projeto);
const v = molde.validar(cheio);

if (!v.ok) {
  process.stdout.write('RECUSADA: a skill gerada nao passou no validador.\n');
  for (const e of v.erros) process.stdout.write('  - ' + e + '\n');
  process.exit(1);
}

const rubrica = require('./lib/rubrica.js');
const vr = rubrica.conferir(cheio);
if (!vr.ok) {
  process.stdout.write('RECUSADA pela rubrica de boa skill:\n');
  for (const e of vr.erros) process.stdout.write('  - ' + e + '\n');
  process.stdout.write('\nCriterios em modelos/boa-skill.md. Os que a maquina nao confere\n');
  process.stdout.write('seguem sendo leitura humana - a rubrica inteira e mais larga que este teste.\n');
  process.exit(1);
}

const slug = (valores.slug || 'projeto').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
const alvo = path.join(cwd, '.claude', 'skills', slug, 'SKILL.md');

if (!gravar) {
  // D11/D24: o default e NAO escrever. A skill sai inteira na tela para o dono ler.
  process.stdout.write('PROPOSTA (nao gravei nada). Destino seria: ' + alvo + '\n');
  process.stdout.write('----- INICIO DA SKILL -----\n');
  process.stdout.write(cheio);
  process.stdout.write('\n----- FIM DA SKILL -----\n');
  process.stdout.write('Para gravar, rode de novo com --gravar, DEPOIS de o dono aprovar.\n');
  process.exit(0);
}

if (fs.existsSync(alvo)) {
  process.stdout.write('ERRO: ' + alvo + ' ja existe. Nao sobrescrevo skill de projeto.\n');
  process.stdout.write('Se for para substituir, isso e decisao do dono: ele apaga ou renomeia antes.\n');
  process.exit(1);
}

// A4-gsk-2 (pedido 12), estados: mkdir e write sem try saiam em excecao crua, sem GRAVADA nem ERRO.
// A4-gsk-3 (R2): 'wx' fecha a janela entre o existsSync e o write - a skill que aparece nela sai EEXIST, sem
// ser sobrescrita.
try {
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, cheio, { encoding: 'utf8', flag: 'wx' });
} catch (e) {
  process.stdout.write('ERRO: nao consegui gravar ' + alvo + ' (' + texto.causaDoErro(e) + ').\n');
  process.stdout.write('Nada foi gravado: conserte a pasta e rode de novo.\n');
  process.exit(1);
}
process.stdout.write('GRAVADA em ' + alvo + '\n');
process.stdout.write('Rode /reload-plugins ou reabra a sessao para o Claude Code enxerga-la.\n');
process.exit(0);
