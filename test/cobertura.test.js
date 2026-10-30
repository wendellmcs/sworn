'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const cobertura = require('../scripts/lib/cobertura.js');
const agentesLib = require('../scripts/lib/agentes.js');
const catalogoLib = require('../scripts/lib/catalogo.js');
const degraus = require('../scripts/lib/degraus.js');

const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'cobertura.js');

function pasta() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sworn cobertura-')); }

function semear(dir, extra) {
  fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
  const p = Object.assign({
    versaoConfig: 1,
    marchas: { aaa: ['**/auth/**'], padrao: ['src/**'], rapida: ['docs/**'] },
    intocaveis: ['segredos/**'],
    plataforma: { so: 'win32', shell: 'powershell' },
    agentes: { escada: ['busca', 'arquiteto'], degraus: [
      { agente: 'busca', apelido: 'barato' }, { agente: 'arquiteto', apelido: 'caro' }
    ] }
  }, extra || {});
  fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'),
    JSON.stringify(p, null, 2), 'utf8');
  return p;
}

function agente(dir, nome, model) {
  const alvo = agentesLib.caminho(dir, nome);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, '---\nname: ' + nome + '\nmodel: ' + model + '\n---\n', 'utf8');
}

function porChave(r, chave) {
  return r.portoes.filter(function (p) { return p.chave === chave; })[0];
}

test('cobertura: projeto completo tem quase tudo verificavel', () => {
  const dir = pasta();
  const p = semear(dir);
  agente(dir, 'busca', 'barato');
  agente(dir, 'arquiteto', 'caro');
  const r = cobertura.relatorio(dir, p);
  assert.strictEqual(porChave(r, 'escopo').verificavel, true);
  assert.strictEqual(porChave(r, 'intocaveis').verificavel, true);
  assert.strictEqual(porChave(r, 'shell').verificavel, true);
  assert.strictEqual(porChave(r, 'custo').verificavel, true);
  assert.strictEqual(porChave(r, 'apelido').verificavel, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Foco de revisao 2. O `permitido` do custo.js devolve "permitido" com menos de dois nomes e
 * NAO avisa que se calou. Um portao mudo que parece ligado e pior do que portao
 * nenhum - e este relatorio e o unico lugar onde isso aparece.
 */
test('cobertura: escada com menos de dois nomes aparece como portao DESLIGADO', () => {
  const dir = pasta();
  const p = semear(dir, { agentes: { escada: ['unico'], degraus: [{ agente: 'unico', apelido: 'x' }] } });
  const r = cobertura.relatorio(dir, p);
  const custo = porChave(r, 'custo');
  assert.strictEqual(custo.verificavel, false);
  assert.ok(/NAO OPINA/.test(custo.porque), custo.porque);
  assert.ok(/nao avisa/.test(custo.porque), 'tem de dizer que o silencio e o problema: ' + custo.porque);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cobertura: escada vazia tambem desliga o portao de custo', () => {
  const dir = pasta();
  const p = semear(dir, { agentes: { escada: [] } });
  assert.strictEqual(porChave(cobertura.relatorio(dir, p), 'custo').verificavel, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

// Ronda 2 do 8c.10: os dois testes acima cravam 1 e 0 nomes. Este mede no limite, pelo
// degraus.MINIMO que o custo.js tambem le: um abaixo desliga, no limite liga. Um 2 cru no
// relatorio, com a escada mudando de minimo, reprova aqui.
test('cobertura: o portao de custo liga exatamente no degraus.MINIMO, e um abaixo desliga', () => {
  const MIN = degraus.MINIMO;
  const nomes = (n) => Array.from({ length: n }, (_, i) => 'agente-' + i);
  for (const [n, liga] of [[MIN - 1, false], [MIN, true]]) {
    const dir = pasta();
    try {
      const p = semear(dir, { agentes: { escada: nomes(n), degraus: [] } });
      const custo = porChave(cobertura.relatorio(dir, p), 'custo');
      assert.strictEqual(custo.verificavel, liga, n + ' nome(s) na escada: ' + custo.porque);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('cobertura: sem .claude/agents o gatilho 3 aparece como nao verificavel, com motivo', () => {
  const dir = pasta();
  const p = semear(dir);
  const apel = porChave(cobertura.relatorio(dir, p), 'apelido');
  assert.strictEqual(apel.verificavel, false);
  assert.ok(/agents/.test(apel.porque), apel.porque);
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Spec 9.6: o gatilho 2 vive em skill. Prometer garantia aqui seria mentir. */
test('cobertura: o gatilho 2 e sempre INSTRUCAO, nunca garantido - nem com cache', () => {
  const dir = pasta();
  const p = semear(dir);
  catalogoLib.gravar(dir, catalogoLib.registrar('ok', [], ['fonte'], Date.now()));
  const cat = porChave(cobertura.relatorio(dir, p), 'catalogo');
  assert.strictEqual(cat.determinismo, cobertura.INSTRUCAO);
  assert.strictEqual(cat.verificavel, false, 'cache cheio nao transforma instrucao em garantia');
  assert.ok(/pulada/.test(cat.porque), cat.porque);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cobertura: o gatilho 3 e HOOK - e a unica guarda deterministica da escada', () => {
  const dir = pasta();
  const p = semear(dir);
  agente(dir, 'busca', 'barato');
  agente(dir, 'arquiteto', 'caro');
  const r = cobertura.relatorio(dir, p);
  assert.strictEqual(porChave(r, 'apelido').determinismo, cobertura.HOOK);
  assert.strictEqual(porChave(r, 'catalogo').determinismo, cobertura.INSTRUCAO);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cobertura: "garantidos" conta so hook verificavel, nunca instrucao', () => {
  const dir = pasta();
  const p = semear(dir);
  const r = cobertura.relatorio(dir, p);
  const contados = r.portoes.filter(function (x) {
    return x.verificavel && x.determinismo === cobertura.HOOK;
  }).length;
  assert.strictEqual(r.resumo.garantidos, contados);
  for (const x of r.portoes) {
    if (x.determinismo === cobertura.INSTRUCAO) {
      assert.strictEqual(x.verificavel && x.determinismo === cobertura.HOOK, false);
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cobertura: sem projeto.json o relatorio RODA e declara tudo que falta', () => {
  const dir = pasta();
  const r = cobertura.relatorio(dir, null);
  assert.strictEqual(r.resumo.total, r.portoes.length);
  assert.ok(r.resumo.naoVerificaveis > 0);
  // nao pode sumir portao nenhum da lista so porque o ambiente e cru
  assert.ok(porChave(r, 'custo'), 'portao sumiu do relatorio em vez de ser declarado');
  assert.ok(porChave(r, 'apelido'));
  fs.rmSync(dir, { recursive: true, force: true });
});

// A6 (s220, estados/manutencao :28): apelidos-vivos.json que existe e nao se le era igual ao ausente ("ainda nao se
// sondou"); agora o portao diz a causa e o passo. A prova que se le e nao tem a forma (provaInvalida, da A1) tambem
// aparece; o BOM se le.
test('A6: apelidos-vivos.json ilegivel ou fora da forma aparece no portao com a causa e o passo', () => {
  const dir = pasta();
  try {
    const p = semear(dir);
    const arq = path.join(dir, '.claude', 'sworn', 'apelidos-vivos.json');
    const porque = function () { return porChave(cobertura.relatorio(dir, p), 'apelidos-vivos'); };
    fs.writeFileSync(arq, '{quebrado', 'utf8');
    let g = porque();
    assert.strictEqual(g.verificavel, false);
    assert.ok(g.porque.startsWith('apelidos-vivos.json nao se le (JSON invalido: '), g.porque);
    assert.match(g.porque, /rode node scripts\/provar-apelidos\.js/, g.porque);
    fs.unlinkSync(arq);
    fs.mkdirSync(arq);
    g = porque();
    assert.ok(g.porque.startsWith('apelidos-vivos.json nao se le (EISDIR)'), g.porque);
    fs.rmdirSync(arq);
    fs.writeFileSync(arq, JSON.stringify({ outra: 1 }), 'utf8');
    g = porque();
    assert.strictEqual(g.verificavel, false);
    assert.ok(g.porque.startsWith('a prova gravada nao tem a lista `apelidos`'), g.porque);
    fs.writeFileSync(arq, '﻿' + JSON.stringify({ apelidos: [] }), 'utf8');
    assert.ok(!/nao se le|prova gravada/.test(porque().porque), porque().porque);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A6 (s220, microcopy :78 e :94): a busca-antes-de-criar sem projeto.json diz o passo, como o escopo; o shell nomeia o
// campo que falta e o passo.
test('A6: busca-antes-de-criar e shell dizem o campo e o passo', () => {
  const dir = pasta();
  try {
    assert.strictEqual(porChave(cobertura.relatorio(dir, null), 'busca-antes-de-criar').porque,
      'sem projeto.json: rode a entrevista');
    const p = semear(dir, { plataforma: { shell: 'bash' } });
    assert.strictEqual(porChave(cobertura.relatorio(dir, p), 'shell').porque,
      'projeto.json nao declara plataforma.so: sem o sistema da maquina, nao da para conferir se o comando de shell e ' +
      'o certo; rode /sworn:init de novo, que o infere e grava');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A6-47 (s235): sem prova, ou com apelido por sondar, o portao diz o comando que sonda.
test('A6-47: sem prova ou com apelido por sondar, o portao diz o comando que sonda', () => {
  const dir = pasta();
  try {
    const p = semear(dir);
    const porque = () => porChave(cobertura.relatorio(dir, p), 'apelidos-vivos').porque;
    const passo = /: rode node scripts\/provar-apelidos\.js \(com --plugin no repositorio do plugin\) e grave a prova no formato que ele mostra$/;
    assert.ok(porque().startsWith('ainda nao se sondou neste ambiente (a sondar: ') && passo.test(porque()), porque());
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'apelidos-vivos.json'), JSON.stringify({ apelidos: [] }), 'utf8');
    assert.ok(porque().startsWith('faltam sondar: ') && passo.test(porque()), porque());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A6-52 (s235): os titulos dos portoes em palavras comuns, sem "Gatilho n", "H4" nem o campo `model:`.
test('A6-52: os titulos dos portoes falam em palavras comuns, sem codigo interno', () => {
  const dir = pasta();
  try {
    const r = cobertura.relatorio(dir, semear(dir));
    assert.strictEqual(porChave(r, 'apelido').titulo, 'Modelo que cada agente declara x apelido gravado no projeto');
    assert.strictEqual(porChave(r, 'catalogo').titulo, 'Comparacao com o catalogo de modelos');
    assert.strictEqual(porChave(r, 'apelidos-vivos').titulo, 'O apelido de modelo ainda e aceito');
    r.portoes.forEach((p) => assert.ok(!/Gatilho|\bH\d\b|model:/.test(p.titulo), p.titulo));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/**
 * Criterio 6 da spec: o relatorio roda com a rede desligada. Aqui nao da para
 * desligar a rede da maquina, mas da para provar o que torna isso verdade:
 * nenhum modulo do caminho abre conexao. Decisao 14 - quem consulta e a skill.
 */
test('cobertura: nenhum modulo do caminho do relatorio abre conexao', () => {
  for (const arq of ['lib/cobertura.js', 'lib/catalogo.js', 'lib/apelidos.js', 'cobertura.js']) {
    const fonte = fs.readFileSync(path.join(RAIZ, 'scripts', arq), 'utf8');
    for (const proibido of ['node:https', 'node:http', 'fetch(', 'XMLHttpRequest', 'node:net']) {
      assert.ok(fonte.indexOf(proibido) === -1, arq + ' abre rede: achei "' + proibido + '"');
    }
  }
});

test('cobertura: cache de consulta ausente nao impede o relatorio de sair', () => {
  const dir = pasta();
  const p = semear(dir);
  assert.strictEqual(catalogoLib.ler(dir), null);
  assert.doesNotThrow(function () { cobertura.relatorio(dir, p); });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cobertura: o texto lista as duas metades e nomeia a nao verificavel', () => {
  const dir = pasta();
  const t = cobertura.texto(cobertura.relatorio(dir, semear(dir, { agentes: { escada: [] } })));
  assert.ok(/Consigo verificar aqui/.test(t), t);
  assert.ok(/NAO consigo verificar aqui/.test(t), t);
  assert.ok(/Agente caro em marcha rapida/.test(t), 'o portao desligado tem de aparecer pelo nome');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cobertura: o script roda e o --json sai parseavel', () => {
  const dir = pasta();
  semear(dir);
  const texto = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
  assert.strictEqual(texto.status, 0, texto.stderr);
  assert.ok(/cobertura neste ambiente/.test(texto.stdout), texto.stdout);

  const json = spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: dir, encoding: 'utf8' });
  assert.strictEqual(json.status, 0, json.stderr);
  const r = JSON.parse(json.stdout);
  assert.ok(Array.isArray(r.portoes) && r.portoes.length > 0);
  assert.strictEqual(typeof r.resumo.garantidos, 'number');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cobertura: todo portao tem as cinco chaves, sem excecao', () => {
  const dir = pasta();
  const r = cobertura.relatorio(dir, semear(dir));
  for (const p of r.portoes) {
    for (const chave of ['chave', 'titulo', 'determinismo', 'verificavel', 'porque']) {
      assert.ok(Object.prototype.hasOwnProperty.call(p, chave), p.chave + ': faltou ' + chave);
    }
    assert.ok(p.porque && p.porque.length > 10, p.chave + ': motivo vazio nao declara nada');
    assert.ok([cobertura.HOOK, cobertura.INSTRUCAO].indexOf(p.determinismo) !== -1, p.chave);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

// F1-C03: a linha do gatilho 2 mostrava a consulta a pagina, que quem grava sao os gatilhos 1 e 4 -
// o texto sugeria que era o gatilho 2 que consultava.
test('cobertura: a linha do gatilho 2 diz que a consulta a pagina e dos gatilhos 1 e 4', () => {
  const dir = pasta();
  const p = semear(dir);
  catalogoLib.gravar(dir, catalogoLib.registrar('ok', [], ['fonte'], Date.now()));
  const cat = porChave(cobertura.relatorio(dir, p), 'catalogo');
  // A6-52 (s235): os gatilhos 1 e 4 pelo nome que o usuario roda, e o catalogo sem o ingles "harness".
  assert.ok(cat.porque.includes('ultima consulta a pagina (feita pelo /sworn:init e pelo /sworn:audit): ok'), cat.porque);
  assert.ok(!/gatilho|harness/i.test(cat.porque), cat.porque);
  fs.rmSync(dir, { recursive: true, force: true });
  const vazio = pasta();
  const sem = porChave(cobertura.relatorio(vazio, semear(vazio)), 'catalogo');
  assert.ok(sem.porque.includes('nunca se consultou aqui'), sem.porque);
  fs.rmSync(vazio, { recursive: true, force: true });
});
