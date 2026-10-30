#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const molde = require('./lib/molde.js');
const config = require('./lib/config.js');
const agentes = require('./lib/agentes.js');
const degrausLib = require('./lib/degraus.js');
const texto = require('./lib/texto.js');

const USO = 'uso: gerar-agentes.js [--fatias] [--respostas <arquivo.json>] [--gravar]\n';
const FLAGS_DO_USO = ['--respostas', '--gravar', '--fatias'];

// A4-gag-1 (pedido 12), borda: flag sem valor (ultima da linha, vazia ou seguida de outra flag do USO) caia calada -
// `--respostas --gravar` lia um arquivo chamado "--gravar". O molde e o arg() do preparar-revisao.js.
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

const lista = degrausLib.normalizar((projeto.agentes || {}).degraus);
if (lista.length === 0) {
  process.stdout.write('ERRO: este projeto nao tem degraus gravados.\n');
  process.stdout.write('Rode /sworn:init: a entrevista pergunta os degraus, e sem eles nao ha o que gerar\n');
  process.stdout.write('(nem nome de agente, nem apelido para escrever no cabecalho do arquivo do agente).\n');
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
    observacao: 'nome, apelido e escalaPara saem do projeto.json, e o esforco tambem quando o degrau o tem; as outras fatias sao por agente'
  }, null, 2) + '\n');
  process.exit(0);
}

let respostas = {};
const arquivoRespostas = arg('respostas');
if (arquivoRespostas) {
  const lidas = molde.lerRespostas(arquivoRespostas);
  if (!lidas.ok) {
    process.stdout.write('ERRO: ' + lidas.erro + '\n');
    process.exit(1);
  }
  respostas = lidas.valores;
}

let gravados = 0;
let pulados = 0;
let recusados = 0;
let naoGravados = 0;

for (let i = 0; i < lista.length; i++) {
  const degrau = lista[i];
  // A4-gag-3 (pedido 12), seguranca: o nome do degrau vira o nome do arquivo (agentes.caminho); fora da regra NOME
  // (degraus.js:12) - com `..` - o agente ia parar fora de .claude/agents. Recusa antes de montar o caminho.
  if (!degrausLib.NOME.test(degrau.agente)) {
    recusados++;
    process.stdout.write('RECUSADO ' + JSON.stringify(String(degrau.agente)) + ':\n');
    process.stdout.write('  - nome de agente invalido: ele vira o nome do arquivo em .claude/agents. Renomeie em' +
      ' "agentes" de .claude/sworn/projeto.json: ate 40 caracteres, comecando por letra minuscula e so com' +
      ' minusculas, digitos e hifen\n');
    continue;
  }
  // nome, apelido e escalaPara vem do projeto.json e NAO do arquivo de respostas:
  // os dois primeiros sao a resposta que a entrevista ja validou; o terceiro e a
  // ordem da escada, e nao se reescreve aqui. O esforco (D678 T1) segue o apelido
  // quando o degrau o tem; sem ele, vale o do arquivo. O normalizar (linha 24) ja
  // tirou o esforco vazio ou nulo, e o validarFatias abaixo recusa o fora da lista.
  const valores = Object.assign({}, respostas[degrau.agente] || {}, {
    nome: degrau.agente,
    apelido: degrau.apelido,
    escalaPara: agentes.escalaPara(lista, i)
  });
  if (degrau.esforco !== undefined) valores.esforco = degrau.esforco;
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
    // A4-09 (pedido 12, microcopy): as fatias vem do arquivo de respostas; o RECUSADO diz onde corrigir.
    process.stdout.write(arquivoRespostas
      ? '  Corrija a chave ' + JSON.stringify(degrau.agente) + ' de ' + arquivoRespostas + ' e rode de novo.\n'
      : '  Passe as respostas com --respostas <arquivo.json>, uma chave por agente' +
        ' (os nomes das fatias saem com --fatias).\n');
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
  // A4-gag-4 (pedido 12), estados: mkdir e write sem try saiam em excecao crua, sem GRAVADO nem ERRO.
  // A4-gag-5 (R2): 'wx' fecha a janela entre o existsSync e o write - o agente que aparece nela sai EEXIST.
  try {
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, cheio, { encoding: 'utf8', flag: 'wx' });
  } catch (e) {
    naoGravados++;
    process.stdout.write('NAO GRAVADO: ' + alvo + ' (' + texto.causaDoErro(e) + ')\n');
    continue;
  }
  gravados++;
  process.stdout.write('GRAVADO: ' + alvo + '\n');
}

if (!gravar) {
  process.stdout.write('\nPara gravar, rode de novo com --gravar, DEPOIS de o dono aprovar.\n');
  process.exit(recusados > 0 ? 1 : 0);
}

process.stdout.write('\nGRAVADOS: ' + gravados + '  PULADOS: ' + pulados + '  RECUSADOS: ' + recusados +
  (naoGravados > 0 ? '  NAO GRAVADOS: ' + naoGravados : '') + '\n');
if (pulados > 0) {
  process.stdout.write('Agente que ja existia nao foi tocado - o arquivo e trabalho de alguem.\n');
  process.stdout.write('Substituir e decisao do dono: ele apaga ou renomeia antes de rodar de novo.\n');
}
if (naoGravados > 0) {
  process.stdout.write('O que nao foi gravado traz a causa na linha NAO GRAVADO: conserte a pasta e rode de novo;\n');
  process.stdout.write('os agentes ja gravados saem como PULADOS.\n');
}
process.exit(recusados + naoGravados > 0 ? 1 : 0);
