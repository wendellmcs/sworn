'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const catalogo = require('../scripts/lib/catalogo.js');

const T0 = 1700000000000;
function dias(n) { return n * catalogo.DIA; }
function pasta() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sworn catalogo-')); }

// ------------------------------------------------------- a janela e o desfecho

test('catalogo: sem cache, consulta', () => {
  const r = catalogo.deveConsultar(null, 'detector', T0);
  assert.strictEqual(r.sim, true);
  assert.ok(r.porque.includes('cache'), r.porque);
});

test('catalogo: consulta boa e recente segura a proxima', () => {
  const c = catalogo.registrar('ok', [], ['pagina-do-fabricante'], T0);
  const r = catalogo.deveConsultar(c, 'detector', T0 + dias(1));
  assert.strictEqual(r.sim, false, r.porque);
  assert.ok(r.porque.includes('janela'), r.porque);
});

test('catalogo: passada a janela, consulta de novo', () => {
  const c = catalogo.registrar('ok', [], [], T0);
  assert.strictEqual(catalogo.deveConsultar(c, 'detector', T0 + dias(catalogo.JANELA_DIAS)).sim, true);
});

test('catalogo: no limite exato da janela ja consulta', () => {
  const c = catalogo.registrar('ok', [], [], T0);
  const menos = catalogo.deveConsultar(c, 'detector', T0 + dias(catalogo.JANELA_DIAS) - 1);
  assert.strictEqual(menos.sim, false, 'um milissegundo antes ainda e dentro da janela');
  const igual = catalogo.deveConsultar(c, 'detector', T0 + dias(catalogo.JANELA_DIAS));
  assert.strictEqual(igual.sim, true);
});

/**
 * A regra que mais importa deste modulo. Uma queda de rede de um minuto nao
 * pode calar a conferencia por uma semana - e calar em silencio.
 */
test('catalogo: consulta SEM REDE nao consome a janela', () => {
  const c = catalogo.registrar('semRede', [], [], T0);
  const r = catalogo.deveConsultar(c, 'detector', T0 + 1000);
  assert.strictEqual(r.sim, true, 'falha de rede calou a conferencia: ' + r.porque);
  assert.ok(r.porque.includes('semRede'), r.porque);
});

test('catalogo: consulta que FALHOU nao consome a janela', () => {
  const c = catalogo.registrar('falhou', [], [], T0);
  assert.strictEqual(catalogo.deveConsultar(c, 'detector', T0 + 1000).sim, true);
});

test('catalogo: pedido do dono ignora a janela', () => {
  const c = catalogo.registrar('ok', [], [], T0);
  const r = catalogo.deveConsultar(c, 'pedido', T0 + 1000);
  assert.strictEqual(r.sim, true, 'o dono pediu e o plugin disse nao');
  assert.ok(r.porque.includes('deliberada'), r.porque);
});

test('catalogo: atualizacao do plugin ignora a janela', () => {
  const c = catalogo.registrar('ok', [], [], T0);
  assert.strictEqual(catalogo.deveConsultar(c, 'instalacao', T0 + 1000).sim, true);
});

test('catalogo: desfecho desconhecido vira "falhou", nunca "ok"', () => {
  // Falhar para o lado seguro: desfecho que ninguem reconhece nao pode ganhar
  // o direito de calar a conferencia por uma semana.
  const c = catalogo.registrar('maravilhoso', [], [], T0);
  assert.strictEqual(c.desfecho, 'falhou');
  assert.strictEqual(catalogo.deveConsultar(c, 'detector', T0 + 1000).sim, true);
});

// ------------------------------------------------------------ o arquivo

test('catalogo: grava e rele, em caminho com espaco', () => {
  const dir = pasta();
  assert.ok(/ /.test(dir), 'a pasta de teste precisa ter espaco: ' + dir);
  const c = catalogo.registrar('ok', [{ nome: 'apelido-qualquer' }], ['fonte'], T0);
  catalogo.gravar(dir, c);
  assert.deepStrictEqual(catalogo.ler(dir), c);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('catalogo: projeto sem cache devolve null, e nao estoura', () => {
  const dir = pasta();
  assert.strictEqual(catalogo.ler(dir), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('catalogo: cache corrompido vale o mesmo que cache ausente', () => {
  const dir = pasta();
  const alvo = catalogo.caminho(dir);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, '{ isto nao e json', 'utf8');
  assert.strictEqual(catalogo.ler(dir), null);
  assert.strictEqual(catalogo.deveConsultar(catalogo.ler(dir), 'detector', T0).sim, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('catalogo: JSON valido com a forma errada tambem e recusado', () => {
  const dir = pasta();
  const alvo = catalogo.caminho(dir);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, JSON.stringify({ consultadoEm: 'ontem', desfecho: 'ok', fontes: [] }), 'utf8');
  assert.strictEqual(catalogo.ler(dir), null, 'data que nao e numero passou');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('catalogo: cache gravado com BOM ainda e lido (JSON do Windows)', () => {
  const dir = pasta();
  const alvo = catalogo.caminho(dir);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  const c = catalogo.registrar('ok', [], [], T0);
  fs.writeFileSync(alvo, '\uFEFF' + JSON.stringify(c), 'utf8');
  assert.ok(catalogo.ler(dir), 'o BOM desligou o modulo em silencio');
  fs.rmSync(dir, { recursive: true, force: true });
});

// -------------------------------------------------- foco de revisao 3: sem rede

test('catalogo: o modo degradado declara, pergunta e proibe inventar', () => {
  const m = catalogo.motivoDegradado();
  assert.ok(/degradado/i.test(m), m);
  assert.ok(/memoria/i.test(m), 'tem de proibir completar de memoria');
  assert.ok(/dono/i.test(m), 'tem de mandar perguntar ao dono');
});

test('catalogo: sem rede nao lanca excecao em ponto nenhum do caminho', () => {
  const dir = pasta();
  assert.doesNotThrow(function () {
    const c = catalogo.registrar('semRede', [], [], T0);
    catalogo.gravar(dir, c);
    catalogo.deveConsultar(catalogo.ler(dir), 'detector', T0 + 1000);
    catalogo.motivoDegradado();
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------- decisao 14 e regra dos volateis

test('catalogo: o modulo NAO abre conexao - nem require de rede, nem fetch', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'lib', 'catalogo.js'), 'utf8');
  for (const proibido of ['node:https', 'node:http', 'require("https")', 'fetch(', 'XMLHttpRequest']) {
    assert.ok(fonte.indexOf(proibido) === -1,
      'decisao 14: o plugin nao abre rede, e achei "' + proibido + '"');
  }
});

test('catalogo: o modulo nao crava nome de modelo nenhum', () => {
  const regra = require('../scripts/lib/regra.js');
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'lib', 'catalogo.js'), 'utf8');
  for (const linha of fonte.split(/\r?\n/)) {
    for (const vol of regra.VOLATEIS) {
      if (vol.tipo === 'nome de modelo') {
        assert.ok(!vol.re.test(linha), 'fato volatil no modulo: ' + linha.trim());
      }
    }
  }
});

// F1-C02: consultadoEm no futuro dava idade negativa e segurava a janela para sempre
// ("ja se consultou ha -N dia(s)"): relogio errado na hora de gravar calava a conferencia.
test('catalogo: consultadoEm mais de 1 dia no futuro e invalido; ate 1 dia e tolerado', () => {
  const agora = Date.now();
  const base = catalogo.registrar('ok', [], ['pagina'], agora);
  const futuro = Object.assign({}, base, { consultadoEm: agora + dias(2) });
  assert.strictEqual(catalogo.valido(futuro), false, 'data no futuro distante nao e cache valido');
  const tolerado = Object.assign({}, base, { consultadoEm: agora + dias(1) - 60000 });
  assert.strictEqual(catalogo.valido(tolerado), true, 'folga de relogio de ate 1 dia e normal');
  // e o efeito que importa: cache de futuro nao segura a janela, manda consultar
  const r = catalogo.deveConsultar(futuro, 'detector', agora);
  assert.strictEqual(r.sim, true, r.porque);
  assert.ok(r.porque.includes('cache'), r.porque);
  // chega do disco do mesmo jeito: ler() devolve null
  const dir = pasta();
  catalogo.gravar(dir, futuro);
  assert.strictEqual(catalogo.ler(dir), null);
});
