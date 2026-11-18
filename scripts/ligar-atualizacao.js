#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const textoLib = require('./lib/texto.js');
const { ehObjeto } = textoLib;

/**
 * D598 (revisao completa, A11-02): o /sworn:init pergunta se o usuario quer as versoes novas sozinho e, com o
 * sim, roda este comando com --gravar. O marketplace de terceiros comeca com a atualizacao automatica desligada; a
 * forma que liga, provada na s15 (D347), e `autoUpdate: true` na entrada do marketplace em `extraKnownMarketplaces`
 * do <CLAUDE_CONFIG_DIR ou ~/.claude>/settings.json. Na abertura seguinte o Claude Code copia a chave.
 *
 *   node ligar-atualizacao.js [--gravar]
 *
 * Sem --gravar so diz o que faria (D11). Sai 0 com a chave proposta, gravada ou ja ligada; 1 sem gravar nada quando
 * o settings.json nao se le como objeto JSON (nunca regrava o arquivo do usuario por cima do que nao entendeu; o
 * arquivo vazio vale como {}) ou quando o marketplace nao aparece em lugar nenhum (sem o `source`, a entrada nova
 * nao funcionaria).
 */
const MARKETPLACE = 'sworn-local';
const gravar = process.argv.indexOf('--gravar') !== -1;
const pastaConfig = path.dirname(require('./lib/gasto.js').pastaDosProjetos());
const alvo = path.join(pastaConfig, 'settings.json');
const PERMISSAO = 'confira se voce pode ler e gravar o arquivo e a pasta dele, e rode de novo';
const CONHECIDOS = path.join(pastaConfig, 'plugins', 'known_marketplaces.json');

// R2: `source` que serve tem ao menos o tipo (`source.source`, como "git"); `{}` gravaria uma entrada que nao instala.
function ehSource(v) { return ehObjeto(v) && typeof v.source === 'string' && v.source !== ''; }

// D869: credencial numa url do source: senha no userinfo (usuario:senha@), qualquer userinfo em http(s) (o token no
// lugar do usuario; o "git@" do ssh fica de fora) ou parametro da query com nome de segredo e valor.
function credencialNaUrl(u) {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^\/?#]*)/i.exec(u);
  if (!m) return false;
  const arroba = m[2].lastIndexOf('@');
  if (arroba !== -1 && (m[2].slice(0, arroba).indexOf(':') !== -1 || /^https?$/i.test(m[1]))) return true;
  // o `?` dentro do #fragmento nao abre query
  const semFragmento = u.split('#')[0];
  const q = semFragmento.indexOf('?');
  if (q === -1) return false;
  return semFragmento.slice(q + 1).split('&').some(function (p) {
    const igual = p.indexOf('=');
    return igual > 0 && igual < p.length - 1 && nomeDeSegredo(p.slice(0, igual));
  });
}
// O nome do parametro termina numa palavra de segredo: as longas no fim de qualquer nome (`accesstoken`,
// `clientsecret`); as curtas (key, pass, pwd, auth, sig) so inteiras (`access_token`, `apiKey`, `Sig`) ou, a key, com
// prefixo conhecido (`privatekey`). O pedaco solto no fim de outra palavra (monkey, compass, hotkey) nao e segredo, e
// recusar por ele barrava a url boa.
const PALAVRA_DE_SEGREDO = new RegExp('(?:token|secret|password|passwd|signature|credentials?' +
  '|(?:^|_|api|access|secret|private|client|session|auth|master|account)key' +
  '|(?:^|_)(?:pass|pwd|auth|sig))$');
function nomeDeSegredo(nome) {
  return PALAVRA_DE_SEGREDO.test(String(nome).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[.-]/g, '_'));
}
function temCredencial(src) {
  return Object.keys(src).some(function (k) { return typeof src[k] === 'string' && credencialNaUrl(src[k]); });
}

// O `source` que o Claude Code gravou na instalacao, ou null. Sem ele, semConhecido diz por que - o arquivo nao
// existe, nao abre, nao se le, nao tem a entrada ou tem a entrada com o source torto - e a recusa diz qual.
const SEM_CONHECIDO = {
  ausente: 'nao existe',
  semEntrada: 'nao tem a entrada ' + MARKETPLACE,
  ilegivel: 'nao se le como objeto JSON',
  torto: 'tem a entrada ' + MARKETPLACE + ' com o source sem o tipo (source.source, como "git")'
};
let conhecido = null;
let semConhecido = null;   // uma chave de SEM_CONHECIDO, ou 'naoAbriu'
let causaNaoAbriu = '';
let textoConhecidos = null;
try { textoConhecidos = fs.readFileSync(CONHECIDOS, 'utf8'); } catch (e) {
  if (e && e.code === 'ENOENT') semConhecido = 'ausente';
  else { semConhecido = 'naoAbriu'; causaNaoAbriu = textoLib.causaDoErro(e); }
}
if (textoConhecidos !== null) {
  let conhecidos = null;
  try { conhecidos = JSON.parse(textoLib.semBom(textoConhecidos)); } catch (e) { /* fica null */ }
  if (!ehObjeto(conhecidos)) semConhecido = 'ilegivel';
  else {
    const meu = conhecidos[MARKETPLACE];
    if (meu === undefined) semConhecido = 'semEntrada';
    else if (ehObjeto(meu) && ehSource(meu.source)) conhecido = meu.source;
    else semConhecido = 'torto';
  }
}
const TEXTO_SEM_CONHECIDO = semConhecido === 'naoAbriu' ? 'nao abriu (' + causaNaoAbriu + ')'
  : SEM_CONHECIDO[semConhecido] || '';

// R1: toda recusa diz o que fazer e oferece o caminho que nao depende deste comando - so com o marketplace no
// known_marketplaces.json (D603): o /plugin so lista o que esta instalado. Quando o arquivo nao abre, nao grava ou tem
// um temporario alheio no caminho, recusarSemOPlugin: o que falta e acesso ao arquivo, e o /plugin nao resolve isso.
const PELO_PLUGIN = 'ou ligue a mao: /plugin, aba Marketplaces, ' + MARKETPLACE + ', Enable auto-update';
function escreverRecusa(porQue, comoResolver, comOPlugin) {
  process.stdout.write('ERRO: ' + porQue + '. Nao gravei.\n  - ' + comoResolver + '\n' +
    (comOPlugin && conhecido ? '  - ' + PELO_PLUGIN + '\n' : ''));
  process.exit(1);
}
function recusar(porQue, comoResolver) { escreverRecusa(porQue, comoResolver, true); }
function recusarSemOPlugin(porQue, comoResolver) { escreverRecusa(porQue, comoResolver || PERMISSAO, false); }

// R2: a forma que a recusa pede vai na propria mensagem; D603: com o source real - o instalado ou, sem ele, o publico
// do GUIA.md (o teste confere os dois juntos).
const PUBLICO = { source: 'git', url: 'https://github.com/wendellmcs/sworn.git' };
// A4-35: a forma vai a tela, e o source instalado pode ter credencial na url (https://usuario:senha@ ou o token no
// lugar do usuario). O trecho antes do ultimo @ da autoridade (ate a primeira /, com @ e aspa escapada dentro da
// senha) vira um marcador, e a frase diz que se troca: tirar calado fazia a forma colada perder o "git@" do ssh ou o
// token de um repositorio privado. A entrada gravada (o source inteiro) nao perde nada.
const MARCADOR = '<usuario-e-senha>';
// D869 (pendencia 14): o token tambem vem na query (?access_token=, &private_token=, ?sig=); o valor do parametro com
// nome de segredo (nomeDeSegredo, a mesma regra da recusa) vira outro marcador.
const SEGREDO = '<segredo>';
const SOURCE_NA_TELA = JSON.stringify(conhecido || PUBLICO).replace(/(:\/\/)(?:[^\/\s"\\]|\\.)*@/g,
  function (m, inicio) { return inicio + MARCADOR + '@'; })
  .replace(/([?&])([^=&#"\s\\]+)=((?:[^&#"\s\\]|\\.)+)/g,
    function (m, sep, nome) { return nomeDeSegredo(nome) ? sep + nome + '=' + SEGREDO : m; });
const FORMA = '"extraKnownMarketplaces": { "' + MARKETPLACE + '": { "source": ' + SOURCE_NA_TELA +
  ', "autoUpdate": true } }' + (SOURCE_NA_TELA.indexOf(MARCADOR) !== -1
  ? ' (troque ' + MARCADOR + ' pelo que vem antes do @ na url do marketplace instalado)' : '') +
  (SOURCE_NA_TELA.indexOf(SEGREDO) !== -1 ? ' (troque ' + SEGREDO + ' pelo valor da url do marketplace instalado)' : '') +
  // sem o source instalado, o da forma e o publico: a frase diz isso, para quem instalou de outro lugar trocar
  (conhecido ? '' : ' (esse source e o publico, o do GUIA.md, porque o ' + CONHECIDOS + ' ' + TEXTO_SEM_CONHECIDO +
    '; se voce instalou o marketplace de outro lugar, ponha o source de la)');

let settings = {};
let bruto = null;
try { bruto = fs.readFileSync(alvo, 'utf8'); } catch (e) {
  if (!e || e.code !== 'ENOENT') recusarSemOPlugin('o ' + alvo + ' nao abriu: ' + textoLib.causaDoErro(e));
}
// Arquivo vazio (ou so com BOM e espaco) e um settings.json sem nada, nao JSON quebrado.
const semBomSettings = bruto === null ? '' : textoLib.semBom(bruto);
if (semBomSettings.trim() !== '') {
  try { settings = JSON.parse(semBomSettings); } catch (e) { settings = null; }
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
// So esta ligada a entrada que tambem tem o source: autoUpdate com o source torto nao instala nada, e e regravada.
if (atual && atual.autoUpdate === true && ehSource(atual.source)) {
  process.stdout.write('JA LIGADA: a atualizacao automatica do ' + MARKETPLACE + ' ja esta ligada em ' + alvo + '.\n');
  process.exit(0);
}

// Entrada nova precisa do `source`: o do known_marketplaces.json, que o Claude Code gravou na instalacao.
// R1/R2: `source` da entrada que nao passa no ehSource nao conta - vale o do known_marketplaces.json.
const source = atual && ehSource(atual.source) ? atual.source : conhecido;
if (!source) {
  const porQue = (atual ? 'a entrada ' + MARKETPLACE + ' do settings.json nao tem um source que sirva'
    : 'o marketplace ' + MARKETPLACE + ' nao esta no settings.json') + ', e o ' + CONHECIDOS + ' ' + TEXTO_SEM_CONHECIDO;
  if (semConhecido === 'naoAbriu') recusarSemOPlugin(porQue, 'confira se voce pode ler o ' + CONHECIDOS + ' e rode de novo');
  // o arquivo existe e nao se le: o conserto e o JSON dele, e nao se sabe se reinstalar o regrava
  if (semConhecido === 'ilegivel') recusar(porQue, 'abra esse arquivo e corrija o JSON (ou salve-o em utf8), e rode de novo');
  recusar(porQue, (semConhecido === 'torto' ? 'instale de novo' : 'instale primeiro') +
    ' (claude plugin marketplace add wendellmcs/sworn) e rode de novo');
}

// D869 (pendencia 15): o source copiado do known_marketplaces.json com credencial na url levaria a credencial ao
// settings.json, que muita gente versiona. Recusa nos dois modos (a proposta nao oferece o que o --gravar recusaria);
// o source que o dono ja pos no settings.json nao e copia e segue.
if (source === conhecido && temCredencial(source)) {
  recusar('o source instalado do ' + MARKETPLACE + ' tem credencial na url (' + SOURCE_NA_TELA + '), e copia-lo poria a ' +
    'credencial no ' + alvo + ', que pode ir para um repositorio',
    'instale o marketplace de uma url sem credencial (o repositorio publico, ou o git com a senha guardada no credential ' +
    'helper) e rode de novo');
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
// settings.json que e link (symlink) grava no arquivo para onde ele aponta: o rename sobre o link o trocaria por um
// arquivo comum, e o link do usuario (para um repositorio de configuracao, por exemplo) se perderia. O link quebrado
// (o arquivo apontado ainda nao existe) grava onde ele aponta, um nivel so.
let destino = alvo;
try { destino = fs.realpathSync(alvo); } catch (e) {
  try {
    if (fs.lstatSync(alvo).isSymbolicLink()) destino = path.resolve(path.dirname(alvo), fs.readlinkSync(alvo));
  } catch (e2) { /* nao existe: grava no proprio alvo */ }
}
const temp = destino + '.' + process.pid + '.tmp';
let tempMeu = false;
try {
  // a pasta do destino: a pastaConfig, ou a do arquivo apontado pelo link quebrado, que pode ainda nao existir
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  // wx: um temporario com esse nome que ja exista nao e deste comando, e nem se escreve nele nem se apaga
  fs.writeFileSync(temp, JSON.stringify(settings, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  tempMeu = true;
  fs.renameSync(temp, destino);
} catch (e) {
  if (!tempMeu && e && e.code === 'EEXIST' && e.path === temp) {
    recusarSemOPlugin('ja existe o ' + temp + ', que nao e deste comando',
      'confira se outro programa esta gravando o settings.json; se nao, apague esse arquivo e rode de novo');
  }
  try { fs.rmSync(temp, { force: true }); } catch (e2) { /* ja foi */ }
  recusarSemOPlugin('nao consegui gravar o ' + destino + ': ' + textoLib.causaDoErro(e));
}
process.stdout.write('LIGADA em ' + alvo + ': extraKnownMarketplaces.' + MARKETPLACE + '.autoUpdate = true.\n');
process.stdout.write('Vale a partir da proxima sessao; a versao nova chega alguns minutos depois de a sessao abrir.\n');
process.exit(0);
