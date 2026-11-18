'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const comum = require('./lib/comum.js');

/**
 * D598 (revisao completa, A11-02): o /sworn:init pergunta e, com o sim, liga a atualizacao automatica do
 * marketplace `sworn-local` no settings.json do usuario - a forma provada na s15 (decisoes.md:13444):
 * `extraKnownMarketplaces.sworn-local.autoUpdate = true`, com o `source` que o Claude Code ja conhece.
 * Tudo roda numa pasta de config de mentira (CLAUDE_CONFIG_DIR), nunca na do dono.
 */
const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'ligar-atualizacao.js');
const SOURCE = { source: 'git', url: 'https://github.com/fulano/sworn.git' };

function config(arquivos) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-atualiza-'));
  for (const [rel, conteudo] of Object.entries(arquivos || {})) {
    const alvo = path.join(dir, rel);
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, typeof conteudo === 'string' || Buffer.isBuffer(conteudo) ? conteudo : JSON.stringify(conteudo, null, 2));
  }
  return dir;
}

const CONHECIDO = { 'plugins/known_marketplaces.json': { 'sworn-local': { source: SOURCE, installLocation: 'x' } } };

// F1g (s372): no processo do teste (comum.scriptComoProcesso); o script e sincrono e nao le o stdin
function rodar(dir, args) {
  const env = Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: dir });
  const r = comum.scriptComoProcesso(SCRIPT, args || [], { env: env });
  return { status: r.status, saida: (r.stdout || '') + (r.stderr || '') };
}

function settings(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
}

test('ligar-atualizacao: sem --gravar so propoe e nao cria nada (D11)', () => {
  const dir = config(CONHECIDO);
  try {
    const r = rodar(dir);
    assert.strictEqual(r.status, 0, r.saida);
    assert.ok(r.saida.includes('PROPOSTA'), r.saida);
    assert.strictEqual(fs.existsSync(path.join(dir, 'settings.json')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ligar-atualizacao: sem settings.json, grava a entrada com o source do known_marketplaces', () => {
  const dir = config(CONHECIDO);
  try {
    const r = rodar(dir, ['--gravar']);
    assert.strictEqual(r.status, 0, r.saida);
    assert.ok(r.saida.includes('LIGADA'), r.saida);
    assert.deepStrictEqual(settings(dir), { extraKnownMarketplaces: { 'sworn-local': { source: SOURCE, autoUpdate: true } } });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ligar-atualizacao: preserva o resto do settings.json e o source que ja estava la', () => {
  const proprio = { source: 'directory', path: 'D:/meu/sworn' };
  const antes = {
    model: 'x', hooks: { Stop: [] },
    extraKnownMarketplaces: { outro: { source: SOURCE }, 'sworn-local': { source: proprio, autoUpdate: false } }
  };
  const dir = config(Object.assign({ 'settings.json': antes }, CONHECIDO));
  try {
    const r = rodar(dir, ['--gravar']);
    assert.strictEqual(r.status, 0, r.saida);
    const depois = settings(dir);
    assert.deepStrictEqual(depois.extraKnownMarketplaces['sworn-local'], { source: proprio, autoUpdate: true });
    assert.deepStrictEqual(depois.extraKnownMarketplaces.outro, antes.extraKnownMarketplaces.outro);
    assert.strictEqual(depois.model, 'x');
    assert.deepStrictEqual(depois.hooks, { Stop: [] });
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['plugins', 'settings.json'], 'sobrou temporario na pasta');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ligar-atualizacao: entrada com source proprio liga mesmo sem o known_marketplaces.json', () => {
  const dir = config({ 'settings.json': { extraKnownMarketplaces: { 'sworn-local': { source: SOURCE, autoUpdate: false } } } });
  try {
    const r = rodar(dir, ['--gravar']);
    assert.strictEqual(r.status, 0, r.saida);
    assert.deepStrictEqual(settings(dir).extraKnownMarketplaces['sworn-local'], { source: SOURCE, autoUpdate: true });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ligar-atualizacao: source vazio ou que nao e objeto na entrada e trocado pelo do known_marketplaces (R1)', () => {
  for (const ruim of [null, '', 'x', 0, {}, { source: '' }, { url: 'u' }]) {
    const dir = config(Object.assign({ 'settings.json': { extraKnownMarketplaces: { 'sworn-local': { source: ruim } } } }, CONHECIDO));
    try {
      const r = rodar(dir, ['--gravar']);
      assert.strictEqual(r.status, 0, JSON.stringify(ruim) + ': ' + r.saida);
      assert.deepStrictEqual(settings(dir).extraKnownMarketplaces['sworn-local'], { source: SOURCE, autoUpdate: true },
        JSON.stringify(ruim));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('ligar-atualizacao: entrada que ja existe sem source recebe o do known_marketplaces', () => {
  const dir = config(Object.assign({ 'settings.json': { extraKnownMarketplaces: { 'sworn-local': {} } } }, CONHECIDO));
  try {
    const r = rodar(dir, ['--gravar']);
    assert.strictEqual(r.status, 0, r.saida);
    assert.deepStrictEqual(settings(dir).extraKnownMarketplaces['sworn-local'], { source: SOURCE, autoUpdate: true });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ligar-atualizacao: ja ligada diz isso e nao regrava, nem com --gravar', () => {
  const texto = JSON.stringify({ extraKnownMarketplaces: { 'sworn-local': { source: SOURCE, autoUpdate: true } } });
  const dir = config({ 'settings.json': texto });
  try {
    const r = rodar(dir, ['--gravar']);
    assert.strictEqual(r.status, 0, r.saida);
    assert.ok(r.saida.includes('JA LIGADA'), r.saida);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), texto);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ligar-atualizacao: autoUpdate ligado com o source torto nao e "ja ligada": regrava com o source instalado (L4-s106-7)', () => {
  const dir = config(Object.assign({ 'settings.json': { extraKnownMarketplaces: { 'sworn-local': { source: {}, autoUpdate: true } } } }, CONHECIDO));
  try {
    const r = rodar(dir, ['--gravar']);
    assert.strictEqual(r.status, 0, r.saida);
    assert.ok(!r.saida.includes('JA LIGADA') && r.saida.includes('LIGADA'), r.saida);
    assert.deepStrictEqual(settings(dir).extraKnownMarketplaces['sworn-local'], { source: SOURCE, autoUpdate: true });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ligar-atualizacao: settings.json vazio, so com espaco ou so com o BOM vale como {} (L4-s106-11)', () => {
  for (const [nome, vazio] of [['vazio', ''], ['so espaco', '  \n'], ['so o BOM', '\uFEFF']]) {
    const dir = config(Object.assign({ 'settings.json': vazio }, CONHECIDO));
    try {
      const r = rodar(dir, ['--gravar']);
      assert.strictEqual(r.status, 0, nome + ': ' + r.saida);
      assert.deepStrictEqual(settings(dir), { extraKnownMarketplaces: { 'sworn-local': { source: SOURCE, autoUpdate: true } } }, nome);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('ligar-atualizacao: temporario alheio com o mesmo nome nao e escrito nem apagado, e a recusa nao oferece o /plugin (L4-s106-9, L4-s107-2)', () => {
  // o script roda neste processo (rodar), entao o pid do nome do temporario e o deste
  const nomeTemp = 'settings.json.' + process.pid + '.tmp';
  const dir = config(Object.assign({ [nomeTemp]: 'alheio' }, CONHECIDO));
  try {
    const r = rodar(dir, ['--gravar']);
    assert.strictEqual(r.status, 1, r.saida);
    assert.ok(r.saida.includes('Nao gravei') && r.saida.includes('nao e deste comando'), r.saida);
    assert.ok(r.saida.includes('apague esse arquivo e rode de novo'), 'a recusa nao diz o que fazer: ' + r.saida);
    assert.ok(r.saida.indexOf('/plugin') === -1, r.saida);
    assert.strictEqual(fs.readFileSync(path.join(dir, nomeTemp), 'utf8'), 'alheio');
    assert.strictEqual(fs.existsSync(path.join(dir, 'settings.json')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ligar-atualizacao: settings.json que nao abre recusa pela permissao, sem oferecer o /plugin (L4-s107-2)', () => {
  // uma pasta no lugar do arquivo: o readFileSync falha sem ser ENOENT
  const dir = config(CONHECIDO);
  fs.mkdirSync(path.join(dir, 'settings.json'));
  try {
    const r = rodar(dir, ['--gravar']);
    assert.strictEqual(r.status, 1, r.saida);
    assert.ok(r.saida.includes('nao abriu') && r.saida.includes('confira se voce pode ler e gravar'), r.saida);
    assert.ok(r.saida.indexOf('/plugin') === -1, r.saida);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// L4-s106-10: o rename sobre um settings.json que e link o trocaria por um arquivo comum. Roda com --gravar e confere
// que a entrada foi para o arquivo apontado (real), com o resto dele; o link, cada teste confere do seu jeito.
function gravarNoApontado(dir, real) {
  const r = rodar(dir, ['--gravar']);
  assert.strictEqual(r.status, 0, r.saida);
  const gravado = JSON.parse(fs.readFileSync(real, 'utf8'));
  assert.strictEqual(gravado.extraKnownMarketplaces['sworn-local'].autoUpdate, true);
  assert.strictEqual(gravado.model, 'x');
}

test('ligar-atualizacao: settings.json que e link grava no arquivo apontado e o link fica (L4-s106-10)', (t) => {
  const dir = config(CONHECIDO);
  const fora = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-atualiza-real-'));
  const real = path.join(fora, 'settings.json');
  fs.writeFileSync(real, JSON.stringify({ model: 'x' }));
  try {
    try { fs.symlinkSync(real, path.join(dir, 'settings.json'), 'file'); } catch (e) {
      // o Windows sem o modo de desenvolvedor nao cria link de arquivo; o teste de baixo cobre pelo realpathSync
      if (e && e.code === 'EPERM') { t.skip('sem permissao para criar link de arquivo aqui'); return; }
      throw e;
    }
    gravarNoApontado(dir, real);
    assert.ok(fs.lstatSync(path.join(dir, 'settings.json')).isSymbolicLink(), 'o link virou arquivo comum');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(fora, { recursive: true, force: true });
  }
});

test('ligar-atualizacao: grava onde o realpathSync do settings.json aponta, nao em cima dele (L4-s106-10)', () => {
  // sem link de verdade (o Windows sem o modo de desenvolvedor nao cria): o fs do script e o deste processo
  const dir = config(Object.assign({ 'settings.json': JSON.stringify({ model: 'x' }) }, CONHECIDO));
  const fora = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-atualiza-real-'));
  const real = path.join(fora, 'settings.json');
  fs.writeFileSync(real, JSON.stringify({ model: 'x' }));
  const original = fs.realpathSync;
  const doLink = path.join(dir, 'settings.json');
  fs.realpathSync = function (p, o) { return path.resolve(String(p)) === path.resolve(doLink) ? real : original(p, o); };
  try {
    gravarNoApontado(dir, real);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(doLink, 'utf8')), { model: 'x' }, 'gravou em cima do link');
    assert.deepStrictEqual(fs.readdirSync(fora), ['settings.json'], 'sobrou temporario ao lado do arquivo apontado');
  } finally {
    fs.realpathSync = original;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(fora, { recursive: true, force: true });
  }
});

test('ligar-atualizacao: link quebrado (o apontado ainda nao existe) grava no apontado e cria a pasta dele, nao no lugar do link (L4-s106-10)', () => {
  // o link de mentira do teste de cima: o realpathSync falha, o lstatSync diz link e o readlinkSync diz para onde.
  // O script chama fs.realpathSync etc. pelo objeto do modulo, e o rodar o carrega de novo a cada vez.
  const dir = config(CONHECIDO);
  const fora = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-atualiza-real-'));
  const real = path.join(fora, 'pasta-que-nao-existe', 'settings.json');
  const doLink = path.join(dir, 'settings.json');
  const ehOLink = (p) => path.resolve(String(p)) === path.resolve(doLink);
  const orig = { realpathSync: fs.realpathSync, lstatSync: fs.lstatSync, readlinkSync: fs.readlinkSync };
  fs.realpathSync = function (p, o) {
    if (ehOLink(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return orig.realpathSync(p, o);
  };
  fs.lstatSync = function (p, o) { return ehOLink(p) ? { isSymbolicLink: () => true } : orig.lstatSync(p, o); };
  fs.readlinkSync = function (p, o) { return ehOLink(p) ? real : orig.readlinkSync(p, o); };
  try {
    const r = rodar(dir, ['--gravar']);
    assert.strictEqual(r.status, 0, r.saida);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(real, 'utf8')),
      { extraKnownMarketplaces: { 'sworn-local': { source: SOURCE, autoUpdate: true } } });
    assert.strictEqual(fs.existsSync(doLink), false, 'gravou no lugar do link');
  } finally {
    Object.assign(fs, orig);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(fora, { recursive: true, force: true });
  }
});

test('ligar-atualizacao: entrada com o source torto e nada instalado diz que a entrada esta la, sem source que sirva', () => {
  const dir = config({ 'settings.json': { extraKnownMarketplaces: { 'sworn-local': { source: {}, autoUpdate: true } } } });
  try {
    const r = rodar(dir, ['--gravar']);
    assert.strictEqual(r.status, 1, r.saida);
    assert.ok(r.saida.includes('a entrada sworn-local do settings.json nao tem um source que sirva, e o '), r.saida);
    assert.ok(!r.saida.includes('nao esta no settings.json'), r.saida);
    assert.ok(r.saida.includes('instale primeiro (claude plugin marketplace add wendellmcs/sworn) e rode de novo'),
      'a recusa nao diz o que fazer: ' + r.saida);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ligar-atualizacao: settings.json com BOM utf8 e lido', () => {
  const dir = config(Object.assign({ 'settings.json': '\uFEFF' + JSON.stringify({ model: 'x' }) }, CONHECIDO));
  try {
    const r = rodar(dir, ['--gravar']);
    assert.strictEqual(r.status, 0, r.saida);
    const depois = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8').replace(/^\uFEFF/, ''));
    assert.strictEqual(depois.model, 'x');
    assert.strictEqual(depois.extraKnownMarketplaces['sworn-local'].autoUpdate, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ligar-atualizacao: settings.json que nao se le como objeto JSON e recusado e fica intacto', () => {
  const casos = {
    'JSON quebrado': '{ "model": ',
    'UTF-16 com BOM': Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('{"model":"x"}', 'utf16le')]),
    'lista': '[]',
    'extraKnownMarketplaces que nao e objeto': JSON.stringify({ extraKnownMarketplaces: ['sworn-local'] }),
    'entrada que nao e objeto': JSON.stringify({ extraKnownMarketplaces: { 'sworn-local': true } })
  };
  for (const [nome, conteudo] of Object.entries(casos)) {
    const dir = config(Object.assign({ 'settings.json': conteudo }, CONHECIDO));
    try {
      const antes = fs.readFileSync(path.join(dir, 'settings.json'));
      const r = rodar(dir, ['--gravar']);
      assert.strictEqual(r.status, 1, nome + ': ' + r.saida);
      assert.ok(r.saida.includes('Nao gravei'), nome + ': ' + r.saida);
      assert.ok(r.saida.includes('Enable auto-update') && r.saida.includes('rode de novo'), nome + ': ' + r.saida);
      if (/extraKnownMarketplaces|entrada/.test(nome)) {
        // R2: a forma esperada vai na propria mensagem, nao "a do README"
        assert.ok(r.saida.includes('"extraKnownMarketplaces": { "sworn-local": {'), nome + ': ' + r.saida);
        // D603: o source real, nao "{ ... }", que o usuario nao sabe preencher
        assert.ok(r.saida.includes('"source": ' + JSON.stringify(SOURCE)), nome + ': ' + r.saida);
        assert.ok(r.saida.indexOf('...') === -1, nome + ': ' + r.saida);
      }
      assert.ok(fs.readFileSync(path.join(dir, 'settings.json')).equals(antes), nome + ': o settings.json mudou');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('ligar-atualizacao: forma errada sem o known_marketplaces mostra o source publico do GUIA.md (D603)', () => {
  const dir = config({ 'settings.json': JSON.stringify({ extraKnownMarketplaces: { 'sworn-local': true } }) });
  try {
    const r = rodar(dir, ['--gravar']);
    assert.strictEqual(r.status, 1, r.saida);
    assert.ok(r.saida.includes('"source": {"source":"git","url":"https://github.com/wendellmcs/sworn.git"}'), r.saida);
    const guia = fs.readFileSync(path.join(RAIZ, 'GUIA.md'), 'utf8');
    assert.ok(guia.includes('"source": { "source": "git", "url": "https://github.com/wendellmcs/sworn.git" }'),
      'o GUIA.md mudou o source publico; mude o do script junto');
    assert.ok(r.saida.indexOf('...') === -1 && r.saida.indexOf('<') === -1, r.saida);
    // D603 (conferencia): sem o marketplace no known_marketplaces, o /plugin nao o lista - nenhuma recusa o oferece
    assert.ok(r.saida.indexOf('/plugin') === -1, r.saida);
    // L4-s107-1: a recusa diz que esse source e o publico, e por que
    assert.ok(r.saida.includes('esse source e o publico, o do GUIA.md, porque o ') &&
      r.saida.includes('known_marketplaces.json nao existe; se voce instalou o marketplace de outro lugar'), r.saida);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const quebrado = config({ 'settings.json': '{ "model": ' });
  try {
    const r = rodar(quebrado, ['--gravar']);
    assert.strictEqual(r.status, 1, r.saida);
    assert.ok(r.saida.indexOf('/plugin') === -1, r.saida);
  } finally { fs.rmSync(quebrado, { recursive: true, force: true }); }
  const comConhecido = config(Object.assign({ 'settings.json': '{ "model": ' }, CONHECIDO));
  try {
    const r = rodar(comConhecido, ['--gravar']);
    assert.strictEqual(r.status, 1, r.saida);
    assert.ok(r.saida.includes('/plugin, aba Marketplaces, sworn-local, Enable auto-update'), r.saida);
    assert.ok(!r.saida.includes('esse source e o publico'), 'com o source instalado, a forma nao e a publica: ' + r.saida);
  } finally { fs.rmSync(comConhecido, { recursive: true, force: true }); }
});

test('ligar-atualizacao: sem o marketplace em lugar nenhum, recusa, diz por que e o que fazer em cada caso (L4-s106-8, L4-s107-3)', () => {
  const KM = 'plugins/known_marketplaces.json';
  const instalar = (comeco) => comeco + ' (claude plugin marketplace add wendellmcs/sworn) e rode de novo';
  // [caso, arquivos a mais, o porque na recusa, o que fazer]
  const casos = [
    ['sem o arquivo', {}, 'known_marketplaces.json nao existe', instalar('instale primeiro')],
    ['sem a entrada', { [KM]: { outro: { source: SOURCE } } }, 'nao tem a entrada sworn-local', instalar('instale primeiro')],
    // o arquivo existe e nao se le: o conserto e o JSON dele, nao reinstalar
    ['JSON quebrado', { [KM]: '{ "sworn-local": ' }, 'nao se le como objeto JSON', 'abra esse arquivo e corrija o JSON'],
    ['source em texto', { [KM]: { 'sworn-local': { source: 'git' } } }, 'com o source sem o tipo', instalar('instale de novo')],
    ['source sem o tipo', { [KM]: { 'sworn-local': { source: {} } } }, 'com o source sem o tipo', instalar('instale de novo')],
    ['entrada que nao e objeto', { [KM]: { 'sworn-local': true } }, 'com o source sem o tipo', instalar('instale de novo')],
    // uma pasta no lugar do arquivo: nao abre, e reinstalar nao resolve - o que falta e acesso
    ['arquivo que nao abre', { [KM + '/x']: 'y' }, 'known_marketplaces.json nao abriu (', 'confira se voce pode ler o ']
  ];
  for (const [nome, extra, porQue, fazer] of casos) {
    const dir = config(Object.assign({ 'settings.json': { model: 'x' } }, extra));
    try {
      const r = rodar(dir, ['--gravar']);
      assert.strictEqual(r.status, 1, nome + ': ' + r.saida);
      assert.ok(r.saida.includes('o marketplace sworn-local nao esta no settings.json, e o ') && r.saida.includes(porQue),
        nome + ': ' + r.saida);
      assert.ok(r.saida.includes(fazer), nome + ': ' + r.saida);
      // quando o conserto nao e instalar, a recusa nao manda instalar
      if (!fazer.startsWith('instale')) assert.ok(!r.saida.includes('instale'), nome + ': ' + r.saida);
      assert.ok(r.saida.indexOf('<repositorio') === -1, 'comando com lacuna que o usuario nao sabe preencher: ' + r.saida);
      // D603: o /plugin nao lista marketplace que nao esta instalado; oferecer o caminho la seria falso
      assert.ok(r.saida.indexOf('/plugin') === -1, nome + ': ' + r.saida);
      assert.deepStrictEqual(settings(dir), { model: 'x' }, nome);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('ligar-atualizacao: o init pergunta e roda o comando com --gravar so depois do sim (D598)', () => {
  const skill = fs.readFileSync(path.join(RAIZ, 'skills', 'init', 'SKILL.md'), 'utf8');
  assert.ok(skill.includes('node "${CLAUDE_PLUGIN_ROOT}/scripts/ligar-atualizacao.js"'), 'o init nao roda o comando');
  assert.ok(skill.includes('node "${CLAUDE_PLUGIN_ROOT}/scripts/ligar-atualizacao.js" --gravar'), 'o init nao grava');
  assert.ok(/AskUserQuestion/.test(skill.slice(skill.indexOf('ligar-atualizacao.js'))), 'o init nao pergunta antes');
});

// A4-35: a forma da recusa imprimia o source instalado inteiro, e uma url com credencial (usuario:senha@ ou o token no
// lugar do usuario) ia ao stdout. Agora o trecho antes do @ vira um marcador, com a frase de troca (tirar calado fazia
// a forma colada perder o "git@" do ssh). D869: o source instalado com credencial nao e copiado; so o do ssh e gravado.
test('ligar-atualizacao: a forma da recusa troca a credencial da url por um marcador; o source com credencial nao e copiado (A4-35, D869)', () => {
  // a url montada em partes: inteira no fonte, o detector de vazamento da publicacao a le como e-mail
  const A = '@';
  const host = A + 'github.com/fulano/sworn.git';
  const casos = [
    ['usuario e senha', 'https://fulano:zq7xy9' + host, 'https://'],
    ['token no lugar do usuario', 'https://zq7xy9' + host, 'https://'],
    ['senha com @ cru', 'https://fulano:zq7' + A + 'xy9' + host, 'https://'],
    ['senha com aspas', 'https://fulano:zq7"xy9' + host, 'https://'],
    ['usuario do ssh', 'ssh://git' + host, 'ssh://']
  ];
  for (const [nome, url, esquema] of casos) {
    const conhecido = { 'plugins/known_marketplaces.json': { 'sworn-local': { source: { source: 'git', url: url } } } };
    const dir = config(Object.assign({ 'settings.json': JSON.stringify({ extraKnownMarketplaces: ['x'] }) }, conhecido));
    try {
      const r = rodar(dir, ['--gravar']);
      assert.strictEqual(r.status, 1, nome + ': ' + r.saida);
      assert.ok(r.saida.includes('"url":"' + esquema + '<usuario-e-senha>' + host + '"'), nome + ': ' + r.saida);
      assert.ok(r.saida.includes('(troque <usuario-e-senha> pelo que vem antes do @'), nome + ': ' + r.saida);
      assert.ok(!/zq7|xy9/.test(r.saida), nome + ': a credencial foi ao stdout: ' + r.saida);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    const ok = config(conhecido);
    try {
      // D869: a credencial do source instalado nao e copiada para o settings.json; o "git@" do ssh nao e credencial
      const ssh = esquema === 'ssh://';
      // sem --gravar (a proposta que o init mostra primeiro) a credencial tambem nao vai a tela
      const proposta = rodar(ok);
      assert.strictEqual(proposta.status, ssh ? 0 : 1, nome + ': ' + proposta.saida);
      assert.ok(!/zq7|xy9/.test(proposta.saida), nome + ': a proposta mostrou a credencial: ' + proposta.saida);
      const r = rodar(ok, ['--gravar']);
      assert.strictEqual(r.status, ssh ? 0 : 1, nome + ': ' + r.saida);
      assert.ok(!/zq7|xy9/.test(r.saida), nome + ': ' + r.saida);
      if (ssh) assert.strictEqual(settings(ok).extraKnownMarketplaces['sworn-local'].source.url, url, nome);
      else {
        assert.ok(r.saida.includes('tem credencial na url') && r.saida.includes('Nao gravei'), nome + ': ' + r.saida);
        assert.ok(!fs.existsSync(path.join(ok, 'settings.json')), nome + ': gravou o settings.json');
      }
    } finally { fs.rmSync(ok, { recursive: true, force: true }); }
  }
  // sem credencial na url, a forma sai como esta e sem a frase de troca
  const limpo = config(Object.assign({ 'settings.json': JSON.stringify({ extraKnownMarketplaces: ['x'] }) }, CONHECIDO));
  try {
    const r = rodar(limpo, ['--gravar']);
    assert.strictEqual(r.status, 1, r.saida);
    assert.ok(r.saida.includes('"url":"' + SOURCE.url + '"') && !r.saida.includes('<usuario-e-senha>'), r.saida);
  } finally { fs.rmSync(limpo, { recursive: true, force: true }); }
});

// D869 (pendencias 14 e 15): o token na query tambem nao vai a tela nem ao settings.json; o parametro comum passa, e o
// source que o dono ja pos no settings.json (nao e copia) segue gravado
test('ligar-atualizacao: o token na query vira marcador na tela e o source com ele nao e copiado (D869)', () => {
  const base = 'https://example.com/sworn.git';
  // a senha no userinfo de outro esquema tambem e credencial (so o usuario sozinho, o "git@" do ssh, nao)
  // o @ montado por codigo: inteiro no fonte, o detector de vazamento da publicacao leria a url como e-mail
  const comSenha = config({ 'plugins/known_marketplaces.json': { 'sworn-local': { source: { source: 'git',
    url: 'ssh://git:zq7xy9' + String.fromCharCode(64) + 'example.com/sworn.git' } } } });
  try {
    const r = rodar(comSenha, ['--gravar']);
    assert.strictEqual(r.status, 1, r.saida);
    assert.ok(r.saida.includes('tem credencial na url') && !/zq7|xy9/.test(r.saida), r.saida);
  } finally { fs.rmSync(comSenha, { recursive: true, force: true }); }
  for (const url of [base + '?access_token=zq7xy9', base + '?ref=main&private_token=zq7xy9#x', base + '?Sig=zq7xy9',
    base + '?apiKey=zq7xy9', base + '?accessToken=zq7xy9', base + '?accesstoken=zq7xy9', base + '?privatekey=zq7xy9']) {
    const conhecido = { 'plugins/known_marketplaces.json': { 'sworn-local': { source: { source: 'url', url: url } } } };
    const torto = config(Object.assign({ 'settings.json': JSON.stringify({ extraKnownMarketplaces: ['x'] }) }, conhecido));
    try {
      const r = rodar(torto, ['--gravar']);
      assert.strictEqual(r.status, 1, url + ': ' + r.saida);
      assert.ok(r.saida.includes('=<segredo>') && r.saida.includes('(troque <segredo> pelo valor'), url + ': ' + r.saida);
      assert.ok(!/zq7|xy9/.test(r.saida), url + ': o token foi ao stdout: ' + r.saida);
    } finally { fs.rmSync(torto, { recursive: true, force: true }); }
    const dir = config(conhecido);
    try {
      for (const args of [[], ['--gravar']]) {
        const r = rodar(dir, args);
        assert.strictEqual(r.status, 1, url + ' ' + args + ': ' + r.saida);
        assert.ok(r.saida.includes('tem credencial na url') && !/zq7|xy9/.test(r.saida), url + ': ' + r.saida);
      }
      assert.ok(!fs.existsSync(path.join(dir, 'settings.json')), url + ': gravou o settings.json');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  // controle: parametro sem nome de segredo (o pedaco no meio da palavra nao conta), com nome de segredo e valor vazio,
  // ou o `?` dentro do #fragmento, nao e credencial
  for (const url of [base + '?ref=main', base + '?token=', base + '?design=a&author=b&keyword=c&monkey=d&compass=e&hotkey=f',
    base + '#a?token=x']) {
    const dir = config({ 'plugins/known_marketplaces.json': { 'sworn-local': { source: { source: 'url', url: url } } } });
    try {
      const r = rodar(dir, ['--gravar']);
      assert.strictEqual(r.status, 0, url + ': ' + r.saida);
      assert.strictEqual(settings(dir).extraKnownMarketplaces['sworn-local'].source.url, url);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  // o source com credencial que ja esta no settings.json e do dono: so liga o autoUpdate
  const doDono = { source: 'url', url: base + '?access_token=zq7xy9' };
  const dono = config(Object.assign({ 'settings.json': JSON.stringify({ extraKnownMarketplaces: { 'sworn-local': { source: doDono } } }) },
    CONHECIDO));
  try {
    const r = rodar(dono, ['--gravar']);
    assert.strictEqual(r.status, 0, r.saida);
    assert.ok(!/zq7|xy9/.test(r.saida), 'o token do dono foi ao stdout: ' + r.saida);
    assert.deepStrictEqual(settings(dono).extraKnownMarketplaces['sworn-local'], { source: doDono, autoUpdate: true });
  } finally { fs.rmSync(dono, { recursive: true, force: true }); }
});
