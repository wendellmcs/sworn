'use strict';
const test = require('node:test');
const assert = require('node:assert');
const projeto = require('../scripts/lib/projeto.js');

/**
 * Fecha o buraco que a D104 MEDIU e deixou aberto de proposito.
 *
 * A D104 provou, no portao vivo, que `intocaveis` com typo (`segredo/**` em vez
 * de `segredos/**`) fica inerte em silencio, e que nesse caso quem segura o
 * segredo e o passo 5 do portao de escopo - por acidente. Foi por isso que ela
 * decidiu NAO ligar a trava `travas.escopo`: liga-la apagaria essa defesa.
 *
 * Esta verificacao nao contradiz a D104: nao liga trava nenhuma e nao nega nada.
 * Ela AVISA que o padrao nao pegou arquivo. Padrao para pasta que ainda nao
 * existe e legitimo - por isso aviso, nunca recusa.
 */

const ARQUIVOS = ['segredos/chave.env', 'src/a.js', 'docs/b.md', 'infra/deploy.sh'];

test('inertes: o typo da D104 e acusado', () => {
  const r = projeto.intocaveisInertes({ intocaveis: ['segredo/**'] }, ARQUIVOS);
  assert.deepStrictEqual(r, ['segredo/**']);
});

test('inertes: o padrao CORRETO da D104 nao e acusado (controle)', () => {
  assert.deepStrictEqual(projeto.intocaveisInertes({ intocaveis: ['segredos/**'] }, ARQUIVOS), []);
});

test('inertes: arquivo solto pelo nome exato conta como pegando (controle)', () => {
  assert.deepStrictEqual(projeto.intocaveisInertes({ intocaveis: ['src/a.js'] }, ARQUIVOS), []);
});

test('inertes: separa o que pega do que nao pega, na mesma lista', () => {
  const r = projeto.intocaveisInertes(
    { intocaveis: ['segredos/**', 'typo/**', 'src/a.js', 'outro/**'] }, ARQUIVOS);
  assert.deepStrictEqual(r, ['typo/**', 'outro/**']);
});

test('inertes: git mudo NAO vira alarme falso (controle)', () => {
  // Lista vazia ou null e "nao sei", nunca "nao ha nada". Acusar aqui faria o
  // aviso disparar em todo repositorio recem-clonado e ninguem mais leria.
  assert.deepStrictEqual(projeto.intocaveisInertes({ intocaveis: ['x/**'] }, []), []);
  assert.deepStrictEqual(projeto.intocaveisInertes({ intocaveis: ['x/**'] }, null), []);
  assert.deepStrictEqual(projeto.intocaveisInertes({ intocaveis: ['x/**'] }, undefined), []);
});

test('inertes: projeto sem intocaveis ou mal formado nao estoura (controle)', () => {
  assert.deepStrictEqual(projeto.intocaveisInertes({}, ARQUIVOS), []);
  assert.deepStrictEqual(projeto.intocaveisInertes(null, ARQUIVOS), []);
  // R-X2b6: `intocaveis` como TEXTO em vez de lista - o caso B da D104
  assert.deepStrictEqual(projeto.intocaveisInertes({ intocaveis: 'segredos/**' }, ARQUIVOS), []);
});

test('inertes: entrada vazia dentro da lista e ignorada, nao acusada', () => {
  assert.deepStrictEqual(projeto.intocaveisInertes({ intocaveis: ['', '   ', 42] }, ARQUIVOS), []);
});

test('inertes: o aviso diz o padrao e onde corrigir', () => {
  const m = projeto.motivoInerte(['segredo/**']);
  assert.ok(m.includes('segredo/**'));
  assert.ok(m.includes('projeto.json'));
  assert.ok(/ATENCAO/.test(m), 'e aviso, nao recusa');
  assert.ok(!/NEGADO/.test(m), 'nunca pode parecer bloqueio: a D104 proibe negar aqui');
});

test('inertes: o caso B da D104 continua SEM cobertura, e isso esta dito', () => {
  // `intocaveis` como texto e inerte por TIPO, nao por padrao - quem avisa e o
  // avisosDeTipo, nao este. Os dois cobrem buracos diferentes; nenhum cobre o outro.
  const porTipo = projeto.avisosDeTipo({ intocaveis: 'segredos/**' });
  assert.ok(porTipo.length >= 1, 'o aviso de tipo e que cobre a lista mal formada');
});

// D244/defeito 6 (D241 secao 2.6): pasta que EXISTE no disco, fora do git (ignorada de
// proposito), era acusada de inerte a cada sessao - e aviso falso ensina a ignorar aviso.
test('D244/defeito 6: pasta existente fora do git nao e inerte; o typo continua acusado', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-inertes-'));
  try {
    fs.mkdirSync(path.join(dir, 'Pasta Fora'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Pasta Fora', 'a.txt'), 'x', 'utf8');
    const r = projeto.intocaveisInertes({ intocaveis: ['Pasta Fora/**', 'Pasta Frao/**', 'segredos/**'] }, ARQUIVOS, dir);
    assert.deepStrictEqual(r, ['Pasta Frao/**']);
    // sem cwd, o comportamento de antes (so o git)
    assert.deepStrictEqual(projeto.intocaveisInertes({ intocaveis: ['Pasta Fora/**'] }, ARQUIVOS), ['Pasta Fora/**']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A2-05 (revisao completa, L2): o glob so entende `*` e `**`. `sec/` (barra no fim) e `cfg/*.{js,ts}` nao casam arquivo
// nenhum, e a pasta fixa existir no disco calava o aviso: o intocavel parecia proteger e nao protegia.
test('A2-05: padrao com barra no fim ou {a,b} e inerte pela forma, mesmo com a pasta no disco; o aviso diz a forma certa', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-a205-'));
  try {
    for (const p of ['sec', 'cfg']) fs.mkdirSync(path.join(dir, p));
    const r = projeto.intocaveisInertes({ intocaveis: ['sec/', 'cfg/*.{js,ts}', 'cfg/**', 'sec/**'] }, ARQUIVOS, dir);
    assert.deepStrictEqual(r, ['sec/', 'cfg/*.{js,ts}']);
    const m = projeto.motivoInerte(r);
    assert.match(m, /so entende \* e \*\*/, m);
    assert.ok(/^[\x20-\x7E\n]*$/.test(m), 'fora de ASCII: ' + m);
    assert.doesNotMatch(projeto.motivoInerte(['segredo/**']), /so entende/, 'typo comum nao leva a linha da forma');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D244/defeito 6: padrao sem pasta fixa (so glob) nao se salva pelo disco', () => {
  const os = require('node:os');
  assert.deepStrictEqual(projeto.intocaveisInertes({ intocaveis: ['**/*.pem'] }, ARQUIVOS, os.tmpdir()), ['**/*.pem']);
});

// F1-C12: git que nao respondeu devolvia [] e a abertura calava - "nao sei" lido como "esta tudo certo".
test('F1-C12: abertura fora de repositorio, com intocaveis, diz que nao sabe; sem intocaveis, cala', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const abertura = path.join(__dirname, '..', 'scripts', 'abertura.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-c12-'));
  try {
    const env = Object.assign({}, process.env, { SWORN_TMP: tmp });
    const abrir = (cwd) => spawnSync(process.execPath, [abertura], {
      input: JSON.stringify({ session_id: 'c12', cwd: cwd, source: 'startup' }),
      encoding: 'utf8', env: env, timeout: 30000
    });
    const montar = (nome, intocaveis) => {
      const dir = path.join(tmp, nome);
      fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'),
        JSON.stringify({ versaoConfig: 1, intocaveis: intocaveis }), 'utf8');
      return dir;
    };
    const com = abrir(montar('com', ['segredos/**']));
    assert.strictEqual(com.status, 0, com.stderr);
    // A5-02 (D735): sem o jargao "intocavel inerte"; diz o efeito (protecao sem efeito) e o passo.
    assert.ok(com.stdout.indexOf('nao deu para conferir se os padroes de `intocaveis`') !== -1, com.stdout);
    assert.ok(com.stdout.indexOf('a protecao dele pode estar sem efeito agora') !== -1, com.stdout);
    assert.ok(com.stdout.indexOf('Rode git status nesta pasta para ver a causa') !== -1, com.stdout);
    assert.strictEqual(com.stdout.indexOf('intocavel inerte'), -1, com.stdout);
    const sem = abrir(montar('sem', []));
    assert.strictEqual(sem.status, 0, sem.stderr);
    assert.strictEqual(sem.stdout.indexOf('padroes de `intocaveis`'), -1,
      'sem intocaveis nao ha o que duvidar: ' + sem.stdout);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
