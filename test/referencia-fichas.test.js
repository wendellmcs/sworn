'use strict';
// D615 (L9 do censo da D612): ficha de referencia que nao esta trabalhando - guardada em .claude/sworn/referencias/
// sem estar na chave `referencias` (o /sworn:review nao a usa), estudada ha mais de 180 dias (os lideres mudam) ou com
// data de estudo que nao existe. A abertura avisa cada uma UMA vez (marca em .claude/sworn/), em ASCII. Sem a chave,
// quem fala e o aviso da D503.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const comum = require('./lib/comum.js');

const RAIZ = path.join(__dirname, '..');
const RE = /fichas de referencia sem uso, velhas ou com data errada/;

function temp(nome) { return fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-fichas-' + nome + '-')); }

function escrever(dir, rel, conteudo) {
  const alvo = path.join(dir, rel);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, conteudo, 'utf8');
}

/**
 * Uma abertura como o gancho: processo novo, com prazo e o ambiente isolado do comum. O status e conferido aqui, em
 * toda chamada: abertura que quebra sai com stdout vazio, e o "nao avisou" passaria por isso.
 */
function abrir(dir, id, rotulo) {
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'abertura.js')], {
    cwd: dir, encoding: 'utf8', timeout: comum.PRAZO,
    input: JSON.stringify({ session_id: id, cwd: dir, source: 'startup' }),
    env: comum.ambiente({ SWORN_TMP: path.join(dir, '_sessoes'), SWORN_VIGIA: path.join(dir, '_vigia') })
  });
  assert.strictEqual(r.status, 0, (rotulo || id) + ': ' + (r.error ? r.error.message + '\n' : '') + r.stderr);
  return r;
}

/** A linha do aviso das fichas na saida da abertura, ou '' sem ela. */
function linhaDoAviso(r) {
  return r.stdout.split('\n').find(function (l) { return RE.test(l); }) || '';
}

function ficha(data) {
  return '# Referência de tela: algo\n\nEstudo de ' + data + ' 10:00. Tipo do projeto: tela.\n\n## Achados\n';
}

const HOJE = new Date().toISOString().slice(0, 10);
const REF = '.claude/sworn/referencias/';

test('L9: ficha guardada fora de referencias e ficha velha sao avisadas uma vez, em ASCII; a ficha em uso e nova, nao', () => {
  const dir = temp('l9');
  try {
    escrever(dir, '.claude/sworn/projeto.json', JSON.stringify({ versaoConfig: 1,
      referencias: { tela: [REF + 'tela-em-uso.md', REF + 'tela-velha.md'] } }));
    escrever(dir, REF + 'tela-em-uso.md', ficha(HOJE));
    escrever(dir, REF + 'tela-velha.md', ficha('2020-01-15'));
    escrever(dir, REF + 'tela-guardada.md', ficha(HOJE));
    const r = abrir(dir, 'l9a');
    const aviso = linhaDoAviso(r);
    assert.ok(aviso, 'sem aviso: ' + r.stdout);
    assert.ok(aviso.includes('tela-guardada.md') && /fora de "referencias"/.test(aviso), 'a guardada: ' + aviso);
    assert.ok(aviso.includes('tela-velha.md') && aviso.includes('2020-01-15') && /180 dias/.test(aviso), 'a velha: ' + aviso);
    assert.ok(!aviso.includes('tela-em-uso.md'), 'a ficha em uso e nova nao e cobrada: ' + aviso);
    assert.ok(aviso.includes('/sworn:reference'), 'diz o que fazer');
    assert.ok(/^[\x20-\x7E]*$/.test(aviso), 'fora de ASCII: ' + aviso);
    const de_novo = abrir(dir, 'l9b');
    assert.doesNotMatch(de_novo.stdout, RE, 'cada ficha avisada uma vez: ' + de_novo.stdout);
    // ficha nova sem uso depois do aviso: so ela sai
    escrever(dir, REF + 'tela-outra.md', ficha(HOJE));
    const terceira = abrir(dir, 'l9c');
    const a3 = linhaDoAviso(terceira);
    assert.ok(a3.includes('tela-outra.md') && !a3.includes('tela-guardada.md'), 'so a nova: ' + terceira.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L9: controles - sem a chave referencias, sem pasta de fichas, ou com tudo em uso, nada sai', () => {
  const casos = [
    ['sem-chave', { versaoConfig: 1 }, { 'tela-x.md': ficha(HOJE) }],
    ['sem-pasta', { versaoConfig: 1, referencias: {} }, {}],
    ['tudo-em-uso', { versaoConfig: 1, referencias: { tela: [REF + 'tela-x.md'] } }, { 'tela-x.md': ficha(HOJE) }]
  ];
  for (const [nome, projeto, fichas] of casos) {
    const dir = temp(nome);
    try {
      escrever(dir, '.claude/sworn/projeto.json', JSON.stringify(projeto));
      for (const f of Object.keys(fichas)) escrever(dir, REF + f, fichas[f]);
      const r = abrir(dir, nome);
      assert.doesNotMatch(r.stdout, RE, nome + ': ' + r.stdout);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

// s116 (revisao cega, P1 de estados e manutencao): marca com JSON valido que nao e objeto (5, "x", lista) nao cala o
// aviso; ela vale como vazia, como a ilegivel.
test('L9: marca torta (JSON que nao e objeto) - o aviso sai mesmo assim', () => {
  for (const torta of ['5', '"x"', '[]', 'null']) {
    const dir = temp('marca-torta');
    try {
      escrever(dir, '.claude/sworn/projeto.json', JSON.stringify({ versaoConfig: 1, referencias: { tela: [] } }));
      escrever(dir, REF + 'tela-guardada.md', ficha(HOJE));
      escrever(dir, '.claude/sworn/referencia-fichas-avisadas.json', torta);
      const r = abrir(dir, 'marca-torta', 'marca ' + torta);
      assert.match(r.stdout, RE, 'marca ' + torta + ' calou o aviso: ' + r.stdout);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

// P16-abertura-r1-1 e r2-3: "referencias" em lista (tipo errado) ou {} (a escolha "nunca usar" do aviso da D503) nao
// cobra ficha nenhuma; antes a lista dava indices como tipo e o {} acusava toda ficha da pasta. O controle, com um
// tipo declarado, prova que a mesma ficha seria cobrada.
test('L9: referencias em lista ou vazia ({}) - nenhuma ficha e cobrada; com um tipo declarado, a guardada e', () => {
  for (const [nome, refs, sai] of [['lista', [REF + 'tela-x.md'], false], ['vazia', {}, false], ['controle', { tela: [] }, true]]) {
    const dir = temp('refs-' + nome);
    try {
      escrever(dir, '.claude/sworn/projeto.json', JSON.stringify({ versaoConfig: 1, referencias: refs }));
      escrever(dir, REF + 'tela-x.md', ficha(HOJE));
      const r = abrir(dir, 'refs-' + nome);
      assert.strictEqual(RE.test(r.stdout), sai, nome + ': ' + r.stdout);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

// P16-abertura-r1-2: o caminho declarado com barra invertida casa com a ficha em qualquer sistema.
test('L9: ficha declarada com barra invertida conta como em uso', () => {
  const dir = temp('barra');
  try {
    escrever(dir, '.claude/sworn/projeto.json', JSON.stringify({ versaoConfig: 1,
      referencias: { tela: ['.claude\\sworn\\referencias\\tela-x.md'] } }));
    escrever(dir, REF + 'tela-x.md', ficha(HOJE));
    const r = abrir(dir, 'barra');
    assert.doesNotMatch(r.stdout, RE, r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// P16-abertura-r1-18: "Estudo de 2026-13-45" nao e data; antes o NaN passava a ficha como em dia. P16-abertura-r2: o
// dia que nao existe no mes (2026-02-30) o Date.parse rolava para marco, e a ficha passava como em dia.
test('L9: ficha em uso com data de estudo que nao e data e avisada, diz o formato e o conserto', () => {
  for (const torta of ['2026-13-45', '2026-02-30', '2025-04-31']) {
    const dir = temp('nan');
    try {
      escrever(dir, '.claude/sworn/projeto.json', JSON.stringify({ versaoConfig: 1, referencias: { tela: [REF + 'tela-x.md'] } }));
      escrever(dir, REF + 'tela-x.md', ficha(torta));
      const r = abrir(dir, 'nan', torta);
      const aviso = linhaDoAviso(r);
      assert.ok(aviso.includes('tela-x.md') && aviso.includes(torta) && /nao e uma data \(AAAA-MM-DD\)/.test(aviso), torta + ': ' + r.stdout);
      assert.ok(aviso.includes('para a data errada, corrija o "Estudo de AAAA-MM-DD" na ficha'), aviso);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

// P16-abertura-r1-7: o motivo que deixou de valer sai da marca; a ficha que entra em "referencias" e sai de novo e
// avisada de novo.
test('L9: ficha guardada que entra em referencias e sai de novo volta a ser avisada', () => {
  const dir = temp('volta');
  const gravarProjeto = function (refs) {
    escrever(dir, '.claude/sworn/projeto.json', JSON.stringify({ versaoConfig: 1, referencias: { tela: refs } }));
  };
  try {
    escrever(dir, REF + 'tela-x.md', ficha(HOJE));
    gravarProjeto([]);
    assert.match(abrir(dir, 'volta1').stdout, RE, 'primeira: guardada fora');
    assert.doesNotMatch(abrir(dir, 'volta2').stdout, RE, 'segunda: ja avisada');
    gravarProjeto([REF + 'tela-x.md']);
    assert.doesNotMatch(abrir(dir, 'volta3').stdout, RE, 'em uso: calada');
    gravarProjeto([]);
    const de_novo = abrir(dir, 'volta4');
    assert.match(de_novo.stdout, RE, 'saiu de novo: avisada de novo: ' + de_novo.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
