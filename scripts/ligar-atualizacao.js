#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const textoLib = require('./lib/texto.js');

/**
 * D598 (revisao completa, A11-02): o /sworn:init pergunta se o usuario quer as versoes novas sozinho e, com o
 * sim, roda este comando com --gravar. O marketplace de terceiros comeca com a atualizacao automatica desligada; a
 * forma que liga, provada na s15 (D347), e `autoUpdate: true` na entrada do marketplace em `extraKnownMarketplaces`
 * do <CLAUDE_CONFIG_DIR ou ~/.claude>/settings.json. Na abertura seguinte o Claude Code copia a chave.
 *
 *   node ligar-atualizacao.js [--gravar]
 *
 * Sem --gravar so diz o que faria (D11). Sai 0 com a chave proposta, gravada ou ja ligada; 1 sem gravar nada quando
 * o settings.json nao se le como objeto JSON (nunca regrava o arquivo do usuario por cima do que nao entendeu) ou
 * quando o marketplace nao aparece em lugar nenhum (sem o `source`, a entrada nova nao funcionaria).
 */
const MARKETPLACE = 'sworn-local';
const gravar = process.argv.indexOf('--gravar') !== -1;
const pastaConfig = path.dirname(require('./lib/gasto.js').pastaDosProjetos());
const alvo = path.join(pastaConfig, 'settings.json');

// R1: toda recusa diz o que fazer e oferece o caminho que nao depende deste comando - so com o marketplace no
// known_marketplaces.json (D603): o /plugin so lista o que esta instalado.
const PELO_PLUGIN = 'ou ligue a mao: /plugin, aba Marketplaces, ' + MARKETPLACE + ', Enable auto-update';
function recusar(porQue, comoResolver) {
  process.stdout.write('ERRO: ' + porQue + '. Nao gravei.\n  - ' + comoResolver + '\n' +
    (conhecido ? '  - ' + PELO_PLUGIN + '\n' : ''));
  process.exit(1);
}
const PERMISSAO = 'confira se voce pode ler e gravar o arquivo e a pasta dele, e rode de novo';
const CONHECIDOS = path.join(pastaConfig, 'plugins', 'known_marketplaces.json');

function ehObjeto(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
// R2: `source` que serve tem ao menos o tipo (`source.source`, como "git"); `{}` gravaria uma entrada que nao instala.
function ehSource(v) { return ehObjeto(v) && typeof v.source === 'string' && v.source !== ''; }

// O `source` que o Claude Code gravou na instalacao, ou null.
let conhecido = null;
try {
  const conhecidos = JSON.parse(textoLib.semBom(fs.readFileSync(CONHECIDOS, 'utf8')));
  const meu = conhecidos && conhecidos[MARKETPLACE];
  conhecido = meu && ehSource(meu.source) ? meu.source : null;
} catch (e) { conhecido = null; }

// R2: a forma que a recusa pede vai na propria mensagem; D603: com o source real - o instalado ou, sem ele, o publico
// do README (o teste confere os dois juntos).
const PUBLICO = { source: 'git', url: 'https://github.com/wendellmcs/sworn.git' };
const FORMA = '"extraKnownMarketplaces": { "' + MARKETPLACE + '": { "source": ' + JSON.stringify(conhecido || PUBLICO) +
  ', "autoUpdate": true } }';

let settings = {};
let bruto = null;
try { bruto = fs.readFileSync(alvo, 'utf8'); } catch (e) {
  if (!e || e.code !== 'ENOENT') recusar('o ' + alvo + ' nao abriu: ' + textoLib.causaDoErro(e), PERMISSAO);
}
if (bruto !== null) {
  try { settings = JSON.parse(textoLib.semBom(bruto)); } catch (e) { settings = null; }
  if (!ehObjeto(settings)) {
    recusar('o ' + alvo + ' nao se le como objeto JSON (texto quebrado ou gravado em UTF-16)',
      'abra o arquivo, corrija o JSON (ou salve-o em utf8) e rode de novo');
  }
}
const extras = settings.extraKnownMarketplaces === undefined ? {} : settings.extraKnownMarketplaces;
if (!ehObjeto(extras) || (extras[MARKETPLACE] !== undefined && !ehObjeto(extras[MARKETPLACE]))) {
  recusar('a chave extraKnownMarketplaces do ' + alvo + ' nao tem a forma de objeto',
    'corrija o arquivo para esta forma e rode de novo: ' + FORMA);
}
const atual = extras[MARKETPLACE];
if (atual && atual.autoUpdate === true) {
  process.stdout.write('JA LIGADA: a atualizacao automatica do ' + MARKETPLACE + ' ja esta ligada em ' + alvo + '.\n');
  process.exit(0);
}

// Entrada nova precisa do `source`: o do known_marketplaces.json, que o Claude Code gravou na instalacao.
// R1/R2: `source` da entrada que nao passa no ehSource nao conta - vale o do known_marketplaces.json.
const source = atual && ehSource(atual.source) ? atual.source : conhecido;
if (!source) {
  recusar('o marketplace ' + MARKETPLACE + ' nao aparece no settings.json nem no plugins/known_marketplaces.json de ' +
    pastaConfig + ' (ausente, ilegivel ou sem essa entrada)',
    'instale primeiro (claude plugin marketplace add wendellmcs/sworn) e rode de novo');
}

const entrada = Object.assign({}, atual || {}, { source: source, autoUpdate: true });
if (!gravar) {
  process.stdout.write('PROPOSTA (nao gravei nada): ligar a atualizacao automatica do ' + MARKETPLACE + '\n');
  process.stdout.write('  extraKnownMarketplaces.' + MARKETPLACE + '.autoUpdate = true, em ' + alvo + '\n');
  process.stdout.write('Para gravar, rode de novo com --gravar, DEPOIS de o usuario aceitar.\n');
  process.exit(0);
}

settings.extraKnownMarketplaces = Object.assign({}, extras, { [MARKETPLACE]: entrada });
// Temporario + rename: o settings.json e do usuario inteiro, e escrita pela metade o deixaria quebrado.
const temp = alvo + '.' + process.pid + '.tmp';
try {
  fs.mkdirSync(pastaConfig, { recursive: true });
  fs.writeFileSync(temp, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  fs.renameSync(temp, alvo);
} catch (e) {
  try { fs.rmSync(temp, { force: true }); } catch (e2) { /* ja foi */ }
  recusar('nao consegui gravar o ' + alvo + ': ' + textoLib.causaDoErro(e), PERMISSAO);
}
process.stdout.write('LIGADA em ' + alvo + ': extraKnownMarketplaces.' + MARKETPLACE + '.autoUpdate = true.\n');
process.stdout.write('Vale a partir da proxima sessao; a versao nova chega alguns minutos depois de a sessao abrir.\n');
process.exit(0);
