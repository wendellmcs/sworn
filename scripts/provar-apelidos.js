#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('./lib/config.js');
const agentesLib = require('./lib/agentes.js');
const apelidos = require('./lib/apelidos.js');

/**
 * H4: apelido ou campo de frontmatter pode deixar de valer sem aviso.
 *
 * Um teste em Node NAO consegue despachar um subagente - so o agente principal
 * consegue. Entao este script nao sonda: ele MONTA O ROTEIRO da sondagem, o
 * agente principal executa, e o resultado gravado e que reprova a suite
 * (test/apelidos-vivos.test.js). Decisao 16 do dono.
 *
 * Os campos nao sao lista fixa: saem do frontmatter do proprio molde. Se o
 * molde ganhar um campo, a sondagem passa a cobri-lo sem ninguem lembrar -
 * metodo em vez de resultado.
 *
 * Decisao 29: o plugin tambem publica agentes, em agents/, e o `inspector`
 * guarda um apelido. Eles entram no roteiro como `doPlugin`; com --plugin, o
 * roteiro e so deles - o caso do repositorio do plugin, que nao tem projeto.
 */

function caminhoDaProva(cwd) {
  return path.join(String(cwd), '.claude', 'sworn', 'apelidos-vivos.json');
}

// A1 (pedido 12), estados: a leitura do molde nao tinha try - molde que faltava saia como pilha de excecao.
function camposDoMolde() {
  const molde = path.join(__dirname, '..', 'modelos', 'agente.md');
  let bruto;
  try { bruto = fs.readFileSync(molde, 'utf8'); }
  catch (e) {
    process.stdout.write('ERRO: nao consegui ler o molde ' + molde + ': ' + e.message + '\n');
    process.stdout.write('Sem ele nao ha a lista de campos a testar: reinstale o plugin e rode de novo.\n');
    process.exit(1);
  }
  const f = agentesLib.frontmatter(bruto);
  return Object.keys(f.campos);
}

const cwd = process.cwd();
const soPlugin = process.argv.indexOf('--plugin') !== -1;
const doPlugin = apelidos.agentesDoPlugin();
const projeto = soPlugin ? null : config.carregarProjeto(cwd);
const SO_PLUGIN = 'Para sondar so os agentes do proprio plugin, rode com --plugin.\n';

if (!soPlugin && !projeto) {
  process.stdout.write('ERRO: rode /sworn:init primeiro; nao achei .claude/sworn/projeto.json\n');
  process.stdout.write(SO_PLUGIN);
  process.exit(1);
}

const mapa = apelidos.mapaDeDegraus(projeto);
const lista = [];
for (const d of mapa.lista) {
  if (d.apelido !== '' && lista.indexOf(d.apelido) === -1) lista.push(d.apelido);
}

if (!soPlugin && lista.length === 0) {
  process.stdout.write('NAO VERIFICAVEL: este projeto nao tem apelidos gravados.\n');
  process.stdout.write('Rode /sworn:init e, na pergunta dos agentes, de o apelido do modelo de cada um; ' +
    'sem eles nao ha o que sondar.\n');
  process.stdout.write(SO_PLUGIN);
  process.exit(1);
}
if (soPlugin && doPlugin.length === 0) {
  process.stdout.write('NAO VERIFICAVEL: o plugin nao publica agente nenhum em agents/.\n');
  process.exit(1);
}

const campos = camposDoMolde();

process.stdout.write(JSON.stringify({
  apelidos: lista,
  campos: campos,
  doPlugin: doPlugin,
  ondeGravar: caminhoDaProva(cwd),
  comoSondar: [
    'Para CADA apelido: despache um subagente trivial usando aquele apelido e',
    'veja se o despacho e aceito. Aceito = aceito; recusado, ou aceito calado',
    'com outro modelo, conta como NAO aceito.',
    'Para CADA campo: emita um agente de ensaio com aquele campo no frontmatter',
    'e veja se a ferramenta o aceita sem reclamar.',
    'Os agentes de doPlugin sao do PROPRIO plugin: sonde o apelido',
    'e cada campo que eles declaram do mesmo jeito, e grave junto, nas duas listas.',
    'Evidencia e a mensagem literal que voltou, nunca a sua impressao.'
  ],
  formatoDoResultado: {
    provadoEm: '<epoch ms>',
    apelidos: [{ apelido: '<um da lista>', aceito: true, evidencia: '<o que voltou>' }],
    campos: [{ campo: '<um da lista>', aceito: true, evidencia: '<o que voltou>' }]
  }
}, null, 2) + '\n');

// A1 (pedido 12), microcopy: "reprova a suite" so vale no repositorio do plugin (--plugin); no projeto quem le a
// prova e o relatorio de cobertura. E "o caminho acima" nao nomeava o campo: o fim nomeia ondeGravar e o passo
// seguinte.
process.stdout.write('\n');
process.stdout.write('Grave o resultado, no formato de formatoDoResultado, em ondeGravar:\n');
process.stdout.write('  ' + caminhoDaProva(cwd) + '\n');
if (soPlugin) {
  const teste = path.join(__dirname, '..', 'test', 'apelidos-vivos.test.js');
  process.stdout.write('Depois rode: node --test "' + teste + '"\n');
  process.stdout.write('Apelido ou campo testado e RECUSADO reprova esse teste; ' +
    'apelido que ninguem testou nao reprova.\n');
} else {
  process.stdout.write('Depois confira com: node "' + path.join(__dirname, 'cobertura.js') + '"\n');
  process.stdout.write('O relatorio de cobertura le esse arquivo e diz, na linha ' +
    '"O apelido de modelo ainda e aceito", o apelido que falta testar.\n');
}
process.exit(0);
