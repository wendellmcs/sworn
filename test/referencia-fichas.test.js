'use strict';
// D615 (L9 do censo da D612): ficha de referencia que nao esta trabalhando - guardada em .claude/sworn/referencias/
// sem estar na chave `referencias` (o /sworn:review nao a usa) ou estudada ha mais de 180 dias (os lideres mudam).
// A abertura avisa cada uma UMA vez (marca em .claude/sworn/), em ASCII. Sem a chave, quem fala e o aviso da D503.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const RE = /fichas de referencia paradas/;

function temp(nome) { return fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-fichas-' + nome + '-')); }

function escrever(dir, rel, conteudo) {
  const alvo = path.join(dir, rel);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, conteudo, 'utf8');
}

function abrir(dir, id) {
  return spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'abertura.js')], {
    cwd: dir, encoding: 'utf8',
    input: JSON.stringify({ session_id: id, cwd: dir, source: 'startup' }),
    env: Object.assign({}, process.env, { SWORN_TMP: path.join(dir, '_sessoes'), SWORN_VIGIA: path.join(dir, '_vigia') })
  });
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
    assert.strictEqual(r.status, 0, r.stderr);
    const aviso = r.stdout.split('\n').filter(function (l) { return RE.test(l); })[0];
    assert.ok(aviso, 'sem aviso: ' + r.stdout);
    assert.ok(aviso.includes('tela-guardada.md') && /fora de "referencias"/.test(aviso), 'a guardada: ' + aviso);
    assert.ok(aviso.includes('tela-velha.md') && aviso.includes('2020-01-15') && /180 dias/.test(aviso), 'a velha: ' + aviso);
    assert.ok(!aviso.includes('tela-em-uso.md'), 'a ficha em uso e nova nao e parada: ' + aviso);
    assert.ok(aviso.includes('/sworn:reference'), 'diz o que fazer');
    assert.ok(/^[\x20-\x7E]*$/.test(aviso), 'fora de ASCII: ' + aviso);
    const de_novo = abrir(dir, 'l9b');
    assert.doesNotMatch(de_novo.stdout, RE, 'cada ficha avisada uma vez: ' + de_novo.stdout);
    // ficha nova parada depois do aviso: so ela sai
    escrever(dir, REF + 'tela-outra.md', ficha(HOJE));
    const terceira = abrir(dir, 'l9c');
    const a3 = terceira.stdout.split('\n').filter(function (l) { return RE.test(l); })[0] || '';
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
      assert.strictEqual(r.status, 0, nome + ': ' + r.stderr);
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
      const r = abrir(dir, 'marca-torta');
      assert.strictEqual(r.status, 0, torta + ': ' + r.stderr);
      assert.match(r.stdout, RE, 'marca ' + torta + ' calou o aviso: ' + r.stdout);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});
