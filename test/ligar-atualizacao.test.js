'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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

function rodar(dir, args) {
  const env = Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: dir });
  const r = spawnSync(process.execPath, [SCRIPT].concat(args || []), { env: env, encoding: 'utf8', timeout: 30000 });
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

test('ligar-atualizacao: forma errada sem o known_marketplaces mostra o source publico do README (D603)', () => {
  const dir = config({ 'settings.json': JSON.stringify({ extraKnownMarketplaces: { 'sworn-local': true } }) });
  try {
    const r = rodar(dir, ['--gravar']);
    assert.strictEqual(r.status, 1, r.saida);
    assert.ok(r.saida.includes('"source": {"source":"git","url":"https://github.com/wendellmcs/sworn.git"}'), r.saida);
    const readme = fs.readFileSync(path.join(RAIZ, 'GUIA.md'), 'utf8');
    assert.ok(readme.includes('"source": { "source": "git", "url": "https://github.com/wendellmcs/sworn.git" }'),
      'o README mudou o source publico; mude o do script junto');
    assert.ok(r.saida.indexOf('...') === -1 && r.saida.indexOf('<') === -1, r.saida);
    // D603 (conferencia): sem o marketplace no known_marketplaces, o /plugin nao o lista - nenhuma recusa o oferece
    assert.ok(r.saida.indexOf('/plugin') === -1, r.saida);
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
    assert.ok(r.saida.includes('/plugin, aba Marketplaces, sworn-local, Enable auto-update'), r.saida);
  } finally { fs.rmSync(comConhecido, { recursive: true, force: true }); }
});

test('ligar-atualizacao: sem o marketplace em lugar nenhum, recusa e manda instalar primeiro', () => {
  for (const extra of [{}, { 'plugins/known_marketplaces.json': { outro: { source: SOURCE } } },
    { 'plugins/known_marketplaces.json': { 'sworn-local': { source: 'git' } } },
    { 'plugins/known_marketplaces.json': { 'sworn-local': { source: {} } } }]) {
    const dir = config(Object.assign({ 'settings.json': { model: 'x' } }, extra));
    try {
      const r = rodar(dir, ['--gravar']);
      assert.strictEqual(r.status, 1, r.saida);
      assert.ok(r.saida.includes('claude plugin marketplace add wendellmcs/sworn'), r.saida);
      assert.ok(r.saida.indexOf('<repositorio') === -1, 'comando com lacuna que o usuario nao sabe preencher: ' + r.saida);
      // D603: o /plugin nao lista marketplace que nao esta instalado; oferecer o caminho la seria falso
      assert.ok(r.saida.indexOf('/plugin') === -1, r.saida);
      assert.deepStrictEqual(settings(dir), { model: 'x' });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('ligar-atualizacao: o init pergunta e roda o comando com --gravar so depois do sim (D598)', () => {
  const skill = fs.readFileSync(path.join(RAIZ, 'skills', 'init', 'SKILL.md'), 'utf8');
  assert.ok(skill.includes('node "${CLAUDE_PLUGIN_ROOT}/scripts/ligar-atualizacao.js"'), 'o init nao roda o comando');
  assert.ok(skill.includes('node "${CLAUDE_PLUGIN_ROOT}/scripts/ligar-atualizacao.js" --gravar'), 'o init nao grava');
  assert.ok(/AskUserQuestion/.test(skill.slice(skill.indexOf('ligar-atualizacao.js'))), 'o init nao pergunta antes');
});
