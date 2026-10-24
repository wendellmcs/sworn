#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const molde = require('./lib/molde.js');
const config = require('./lib/config.js');
const agentes = require('./lib/agentes.js');
const degrausLib = require('./lib/degraus.js');

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

const lista = degrausLib.normalizar((projeto.agentes || {}).degraus);
if (lista.length === 0) {
  process.stdout.write('ERRO: este projeto nao tem degraus gravados.\n');
  process.stdout.write('A entrevista do /sworn:init pergunta, e sem eles nao ha o que gerar:\n');
  process.stdout.write('nem nome de agente, nem apelido para escrever no frontmatter.\n');
  process.exit(1);
}

// A escada torta nao estoura em lugar nenhum - so deixa um portao mudo. Aqui ela
// PARA, porque depois de gravado o arquivo ja esta na pasta da pessoa.
const desalinho = degrausLib.desalinhados(projeto.agentes || {});
if (desalinho.length > 0) {
  process.stdout.write(degrausLib.motivoDesalinhado(desalinho) + '\n');
  process.exit(1);
}

const moldeTexto = fs.readFileSync(path.join(__dirname, '..', 'modelos', 'agente.md'), 'utf8');

if (process.argv.indexOf('--fatias') !== -1) {
  const nomes = [];
  for (const s of molde.slots(moldeTexto)) {
    if (s.tipo === 'texto' && nomes.indexOf(s.nome) === -1) nomes.push(s.nome);
  }
  process.stdout.write(JSON.stringify({
    degraus: lista.map(function (d) { return d.agente; }),
    fatias: nomes,
    observacao: 'nome, apelido e escalaPara saem do projeto.json; as outras fatias sao por agente'
  }, null, 2) + '\n');
  process.exit(0);
}

let respostas = {};
const arquivoRespostas = arg('respostas');
if (arquivoRespostas) {
  try { respostas = JSON.parse(fs.readFileSync(arquivoRespostas, 'utf8')); }
  catch (e) {
    process.stdout.write('ERRO: nao consegui ler ' + arquivoRespostas + ': ' + e.message + '\n');
    process.exit(1);
  }
}

let gravados = 0;
let pulados = 0;
let recusados = 0;

for (let i = 0; i < lista.length; i++) {
  const degrau = lista[i];
  // nome, apelido e escalaPara vem do projeto.json e NAO do arquivo de respostas:
  // os dois primeiros sao a resposta que a entrevista ja validou; o terceiro e a
  // ordem da escada, e nao se reescreve aqui.
  const valores = Object.assign({}, respostas[degrau.agente] || {}, {
    nome: degrau.agente,
    apelido: degrau.apelido,
    escalaPara: agentes.escalaPara(lista, i)
  });
  // Quem digita 8 em maxTurns nao errou: numero no JSON vira texto antes de preencher.
  for (const k of Object.keys(valores)) {
    if (typeof valores[k] === 'number') valores[k] = String(valores[k]);
  }
  const cheio = molde.preencher(moldeTexto, valores, projeto);
  const v = molde.validar(cheio);
  for (const e of agentes.validarFatias(valores)) v.erros.push(e);
  v.ok = v.erros.length === 0;
  const alvo = agentes.caminho(cwd, degrau.agente);

  if (!v.ok) {
    recusados++;
    process.stdout.write('RECUSADO ' + degrau.agente + ':\n');
    for (const e of v.erros) process.stdout.write('  - ' + e + '\n');
    continue;
  }
  if (!gravar) {
    process.stdout.write('PROPOSTA (nao gravei nada). Destino seria: ' + alvo + '\n');
    process.stdout.write('----- INICIO ' + degrau.agente + ' -----\n');
    process.stdout.write(cheio);
    process.stdout.write('\n----- FIM ' + degrau.agente + ' -----\n');
    continue;
  }
  if (fs.existsSync(alvo)) {
    pulados++;
    process.stdout.write('PULADO (ja existe): ' + alvo + '\n');
    continue;
  }
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, cheio, 'utf8');
  gravados++;
  process.stdout.write('GRAVADO: ' + alvo + '\n');
}

if (!gravar) {
  process.stdout.write('\nPara gravar, rode de novo com --gravar, DEPOIS de o dono aprovar.\n');
  process.exit(recusados > 0 ? 1 : 0);
}

process.stdout.write('\nGRAVADOS: ' + gravados + '  PULADOS: ' + pulados + '  RECUSADOS: ' + recusados + '\n');
if (pulados > 0) {
  process.stdout.write('Agente que ja existia nao foi tocado - o arquivo e trabalho de alguem.\n');
  process.stdout.write('Substituir e decisao do dono: ele apaga ou renomeia antes de rodar de novo.\n');
}
process.exit(recusados > 0 ? 1 : 0);
