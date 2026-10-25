'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const catalogo = require('../scripts/lib/catalogo.js');
const regra = require('../scripts/lib/regra.js');

/**
 * Gatilho 1 da spec (secao 6): instalar e o momento natural de conferir o
 * catalogo de modelos. Decisao 36 do dono: o /sworn:init dispara a consulta
 * ao terminar, com o motivo 'instalacao'; a atualizacao do plugin fica
 * declarada como limite no README - nenhum evento avisa o plugin de que ele
 * foi atualizado.
 *
 * Medido antes desta tarefa: 'instalacao' so existia em DELIBERADOS e num teste
 * de catalogo.js. Motivo que nenhuma skill usa e gatilho que nunca dispara - e
 * que nunca dispara calado.
 */

const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'catalogo.js');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

function pasta() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sworn gatilho1-')); }

function rodar(args, cwd) {
  return spawnSync(process.execPath, [SCRIPT].concat(args), { cwd: cwd, encoding: 'utf8' });
}

function skills() {
  const base = path.join(RAIZ, 'skills');
  return fs.readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ nome: e.name, texto: fs.readFileSync(path.join(base, e.name, 'SKILL.md'), 'utf8') }));
}

/** Do cabecalho que comeca com `inicio` ate o `## ` seguinte. */
function secao(texto, inicio) {
  const i = texto.indexOf('\n' + inicio);
  assert.ok(i !== -1, 'sumiu a secao: ' + inicio);
  const j = texto.indexOf('\n## ', i + 1);
  return texto.slice(i, j === -1 ? texto.length : j);
}

// ── o script ─────────────────────────────────────────────────────────────

test('gatilho 1: o motivo instalacao responde que e hora, mesmo com consulta boa de ontem', () => {
  const dir = pasta();
  catalogo.gravar(dir, catalogo.registrar('ok', [], ['fonte'], Date.now() - catalogo.DIA));
  const r = rodar(['--motivo', 'instalacao'], dir);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const resp = JSON.parse(r.stdout);
  assert.strictEqual(resp.sim, true, resp.porque);
  assert.ok(/deliberada \(instalacao\)/.test(resp.porque), resp.porque);
  // controle: o mesmo cache segura um motivo que nao e deliberado
  assert.strictEqual(JSON.parse(rodar(['--motivo', 'detector'], dir).stdout).sim, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gatilho 1: registrar grava na pasta atual, em caminho com espaco, e o modulo rele', () => {
  const dir = pasta();
  assert.ok(/ /.test(dir), 'a pasta de teste precisa ter espaco: ' + dir);
  const r = rodar(['--registrar', 'ok', 'https://exemplo.invalid/modelos'], dir);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const c = catalogo.ler(dir);
  assert.ok(c, 'o registro nao ficou legivel para catalogo.ler');
  assert.strictEqual(c.desfecho, 'ok');
  assert.deepStrictEqual(c.fontes, ['https://exemplo.invalid/modelos']);
  assert.ok(r.stdout.includes(catalogo.caminho(dir)), 'nao disse onde gravou: ' + r.stdout);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gatilho 1: desfecho desconhecido e recusado, e NADA e gravado', () => {
  const dir = pasta();
  const r = rodar(['--registrar', 'maravilhoso'], dir);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.ok(/desfecho desconhecido/.test(r.stdout), r.stdout);
  assert.strictEqual(fs.existsSync(catalogo.caminho(dir)), false, 'recusou e gravou assim mesmo');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gatilho 1: sem argumento, ou --motivo sem valor, sai 1 e mostra o uso', () => {
  const dir = pasta();
  for (const args of [[], ['--motivo']]) {
    const r = rodar(args, dir);
    assert.strictEqual(r.status, 1, JSON.stringify(args));
    assert.ok(/uso:/.test(r.stdout), r.stdout);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gatilho 1: --degradado imprime o texto do modulo, sem tirar nem por', () => {
  const r = rodar(['--degradado'], RAIZ);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, catalogo.motivoDegradado() + '\n');
});

test('gatilho 1: o script nao abre conexao (decisao 14)', () => {
  const fonte = ler('scripts/catalogo.js');
  for (const proibido of ['node:https', 'node:http', 'fetch(', 'XMLHttpRequest', 'node:net']) {
    assert.ok(fonte.indexOf(proibido) === -1, 'scripts/catalogo.js abre rede: achei "' + proibido + '"');
  }
});

// ── as skills ────────────────────────────────────────────────────────────

test('gatilho 1: todo motivo deliberado tem uma skill que o dispara', () => {
  const todas = skills();
  for (const m of catalogo.DELIBERADOS) {
    const usam = todas.filter((s) => s.texto.includes('catalogo.js" --motivo ' + m));
    assert.ok(usam.length > 0,
      'motivo "' + m + '" esta em DELIBERADOS e nenhuma skill o usa: gatilho que nunca dispara');
  }
});

test('gatilho 1: o init consulta DEPOIS de gravar e ANTES de fechar', () => {
  const t = ler('skills/init/SKILL.md');
  const gravar = t.indexOf('\n## Step 7 ');
  const consulta = t.indexOf('catalogo.js" --motivo instalacao');
  const fechar = t.indexOf('\n## Step 8 ');
  assert.ok((gravar !== -1) && (fechar !== -1), 'sumiu o Passo 7 ou o Passo 8 do init');
  assert.ok(consulta !== -1, 'o init nao dispara a consulta com o motivo instalacao');
  assert.ok((gravar < consulta) && (consulta < fechar),
    'a consulta tem de vir depois de gravar (Passo 7) e antes de fechar (Passo 8)');
  // o passo cita o Passo 1b do auditar como fonte do procedimento: ele tem de existir
  assert.ok(ler('skills/audit/SKILL.md').includes('\n## Step 1b'), 'sumiu o Passo 1b do auditar');
});

test('gatilho 1: o init registra pelo script, e diz por que nao pelo Write', () => {
  const s = secao(ler('skills/init/SKILL.md'), '## Step 7e');
  assert.ok(s.includes('catalogo.js" --registrar'), 'o passo nao da o comando de registro');
  assert.ok(/`Write`/.test(s) && /scope gate/.test(s), 'nao diz por que o Write nao serve');
});

test('gatilho 1: o init avisa que atualizar o plugin nao repete a conferencia', () => {
  // por paragrafo: a secao ja cita o /sworn:audit em outro item, e a secao
  // inteira passaria mesmo sem dizer o que rodar depois de atualizar
  const sobre = secao(ler('skills/init/SKILL.md'), '## Step 7e')
    .split(/\r?\n\r?\n/).filter((p) => /updat/.test(p));
  assert.ok(sobre.length > 0, 'nao fala de atualizacao');
  assert.ok(sobre.some((p) => p.includes('/sworn:audit')),
    'fala de atualizacao sem dizer o que rodar depois: ' + sobre.join(' | ').slice(0, 200));
});

test('gatilho 1: a secao do init nao crava nome de modelo nenhum', () => {
  const sujas = [];
  for (const linha of secao(ler('skills/init/SKILL.md'), '## Step 7e').split(/\r?\n/)) {
    for (const vol of regra.VOLATEIS) {
      if (vol.tipo === 'nome de modelo' && vol.re.test(linha)) sujas.push(linha.trim());
    }
  }
  assert.deepStrictEqual(sujas, [], 'fato volatil na secao do gatilho 1');
});

/**
 * Medido na T41b: `node -e "...require('${CLAUDE_PLUGIN_ROOT}/...')..."` poe o
 * caminho do plugin dentro de uma string JavaScript. Com barra invertida - a forma
 * do caminho de instalacao no Windows - cada barra vira escape e o require falha.
 */
test('gatilho 1: nenhuma skill poe o caminho do plugin dentro de node -e', () => {
  const sujas = [];
  for (const s of skills()) {
    for (const linha of s.texto.split(/\r?\n/)) {
      if (/node -e/.test(linha) && linha.includes('${CLAUDE_PLUGIN_ROOT}')) {
        sujas.push(s.nome + ': ' + linha.trim().slice(0, 80));
      }
    }
  }
  assert.deepStrictEqual(sujas, []);
});

/** O comando escrito na skill e o que o agente copia: ele tem de rodar como esta. */
test('gatilho 1: todo comando catalogo.js das skills roda como esta escrito', () => {
  const prefixo = 'node "${CLAUDE_PLUGIN_ROOT}/scripts/catalogo.js" ';
  const rodados = new Set();
  for (const s of skills()) {
    for (const linha of s.texto.split(/\r?\n/)) {
      const i = linha.indexOf(prefixo);
      if (i === -1) continue;
      const args = (linha.slice(i + prefixo.length).match(/'[^']*'|\S+/g) || [])
        .map((a) => a.replace(/^'|'$/g, ''));
      const dir = pasta();
      const r = rodar(args, dir);
      assert.strictEqual(r.status, 0, s.nome + ': ' + linha.trim() + '\n' + r.stdout + r.stderr);
      fs.rmSync(dir, { recursive: true, force: true });
      rodados.add(s.nome);
    }
  }
  // sem isto, uma skill sem comando nenhum passaria por nao ter o que rodar
  assert.deepStrictEqual(['audit', 'init'].filter((n) => !rodados.has(n)), [],
    'skill que consulta o catalogo sem comando catalogo.js: ' + Array.from(rodados).join(', '));
});

// ── o README ─────────────────────────────────────────────────────────────

test('gatilho 1: o README declara a atualizacao do plugin como limite', () => {
  const t = ler('GUIA.md');
  const i = t.indexOf('\n## O que o `sworn` NÃO promete');
  assert.ok(i !== -1, 'sumiu a secao do que o sworn nao promete');
  const j = t.indexOf('\n## ', i + 1);
  const itens = t.slice(i, j).split(/\r?\n/).filter((l) => /^- /.test(l));
  assert.ok(itens.some((l) => /atualizado/.test(l)),
    'a atualizacao do plugin nao aparece entre os limites: ' + itens.length + ' itens');
});
