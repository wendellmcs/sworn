'use strict';
// D875: a impressao do codigo do repositorio (lib/impressao-codigo.js) e o registro dela no lancamento da prova.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const imp = require('../scripts/lib/impressao-codigo.js');

function git(dir, args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', shell: false });
  assert.strictEqual(r.status, 0, args.join(' ') + ': ' + r.stderr);
}

function comRepo(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-impressao-'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-impressao-tmp-'));
  const antes = process.env.SWORN_TMP;
  process.env.SWORN_TMP = tmp;
  try {
    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.email', 'ensaio@ensaio']);
    git(dir, ['config', 'user.name', 'ensaio']);
    git(dir, ['config', 'core.autocrlf', 'false']);
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'const a = 1;\n');
    fs.writeFileSync(path.join(dir, 'LEIA.md'), 'texto\n');
    fs.writeFileSync(path.join(dir, '.gitignore'), 'ignorado/\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'base']);
    fn(dir);
  } finally {
    if (antes === undefined) delete process.env.SWORN_TMP; else process.env.SWORN_TMP = antes;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('D875: a impressao muda com o codigo e nao com o texto, o ignorado, o git add ou o commit', () => {
  comRepo(function (dir) {
    const base = imp.impressao(dir);
    assert.match(base, /^[0-9a-f]{40}$/);
    assert.strictEqual(imp.impressao(dir), base, 'duas leituras seguidas dao a mesma');
    // da subpasta, a mesma (o :/ le o repositorio inteiro)
    assert.strictEqual(imp.impressao(path.join(dir, 'src')), base, 'da subpasta');
    // o texto nao e codigo
    fs.writeFileSync(path.join(dir, 'LEIA.md'), 'outro texto, mais longo\n');
    assert.strictEqual(imp.impressao(dir), base, 'o .md mudado');
    // o ignorado pelo git nao conta
    fs.mkdirSync(path.join(dir, 'ignorado'));
    fs.writeFileSync(path.join(dir, 'ignorado', 'x.js'), 'x\n');
    assert.strictEqual(imp.impressao(dir), base, 'o .js ignorado');
    // o codigo novo, nao ignorado, conta
    fs.writeFileSync(path.join(dir, 'src', 'b.js'), 'const b = 2;\n');
    const comNovo = imp.impressao(dir);
    assert.notStrictEqual(comNovo, base, 'o .js novo');
    // o git add e o commit nao mexem no disco
    git(dir, ['add', '-A']);
    assert.strictEqual(imp.impressao(dir), comNovo, 'depois do git add');
    git(dir, ['commit', '-qm', 'b']);
    assert.strictEqual(imp.impressao(dir), comNovo, 'depois do commit');
    // o mesmo tamanho com outra hora conta (o sed -i que troca uma letra)
    const a = path.join(dir, 'src', 'a.js');
    fs.writeFileSync(a, 'const a = 2;\n');
    const futuro = new Date(Date.now() + 60000);
    fs.utimesSync(a, futuro, futuro);
    const mudado = imp.impressao(dir);
    assert.notStrictEqual(mudado, comNovo, 'o .js mudado');
    // o mesmo tamanho com o mtime reposto a mao (o `touch -r`) ainda conta: o ctime muda com a escrita
    const st = fs.statSync(a);
    fs.writeFileSync(a, 'const a = 9;\n');
    fs.utimesSync(a, st.atime, st.mtime);
    assert.strictEqual(fs.statSync(a).mtimeMs, st.mtimeMs, 'controle: o mtime voltou');
    const reposto = imp.impressao(dir);
    assert.notStrictEqual(reposto, mudado, 'o .js com o mtime reposto');
    // mover para outra pasta com o mesmo nome, tamanho e hora conta (o caminho inteiro entra, nao so o nome)
    // (com o git add, o lugar velho sai do indice; a pasta `zz` fica depois de `src` na ordem: so o caminho novo diz
    // que mudou)
    fs.mkdirSync(path.join(dir, 'zz'));
    fs.renameSync(path.join(dir, 'src', 'b.js'), path.join(dir, 'zz', 'b.js'));
    git(dir, ['add', '-A']);
    const movido = imp.impressao(dir);
    assert.notStrictEqual(movido, reposto, 'o .js movido de pasta');
    // apagar conta
    fs.unlinkSync(a);
    assert.notStrictEqual(imp.impressao(dir), movido, 'o .js apagado');
  });
});

test('D875: fora de repositorio, ou sem raiz, a impressao e null', () => {
  const fora = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-impressao-fora-'));
  try {
    assert.strictEqual(imp.impressao(fora), null);
    assert.strictEqual(imp.impressao(''), null);
    assert.strictEqual(imp.impressao(null), null);
  } finally { fs.rmSync(fora, { recursive: true, force: true }); }
});

test('D875: o lancamento da prova grava a impressao, e o portao compara pelo id ou pelo comando', () => {
  comRepo(function (dir) {
    const PROVA = 'node --test test/*.test.js';
    const entrada = function (id, comando, sessao) {
      return { session_id: sessao || 's1', tool_use_id: id, tool_input: { command: comando } };
    };
    // o que nao e a prova nao grava; sem sessao ou sem comando tambem nao
    assert.strictEqual(imp.gravarSeForAProva(entrada('x', 'ls'), PROVA, dir), false);
    assert.strictEqual(imp.gravarSeForAProva({ tool_input: { command: PROVA } }, PROVA, dir), false);
    assert.strictEqual(imp.gravarSeForAProva(entrada('x', PROVA), null, dir), false, 'sem prova declarada');
    const mesmo = imp.mesmoCodigoDesde('s1', dir);
    assert.strictEqual(mesmo('a', PROVA), false, 'sem nada gravado');
    // a prova grava, e o codigo igual responde true pelo id
    assert.strictEqual(imp.gravarSeForAProva(entrada('a', PROVA), PROVA, dir), true);
    assert.strictEqual(mesmo('a', PROVA), true);
    assert.strictEqual(mesmo('outro', PROVA), false, 'o id que nao foi gravado');
    assert.strictEqual(imp.mesmoCodigoDesde('s2', dir)('a', PROVA), false, 'outra sessao');
    // o gravado sem id (gancho sem tool_use_id) casa pelo comando
    assert.strictEqual(imp.gravarSeForAProva({ session_id: 's3', tool_input: { command: PROVA } }, PROVA, dir), true);
    assert.strictEqual(imp.mesmoCodigoDesde('s3', dir)('qualquer', PROVA), true);
    assert.strictEqual(imp.mesmoCodigoDesde('s3', dir)('qualquer', 'npm test'), false, 'outro comando');
    // sem impressao agora (o git nao responde), o gravado nao vale
    fs.renameSync(path.join(dir, '.git'), path.join(dir, 'git-fora'));
    assert.strictEqual(imp.impressao(dir), null);
    assert.strictEqual(mesmo('a', PROVA), false, 'sem impressao agora');
    fs.renameSync(path.join(dir, 'git-fora'), path.join(dir, '.git'));
    assert.strictEqual(mesmo('a', PROVA), true, 'controle: com o git de volta, igual');
    // o codigo mudado responde false
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'const a = 3; // mais longo\n');
    assert.strictEqual(mesmo('a', PROVA), false);
    // a sessao guarda so os ultimos lancamentos
    for (let i = 0; i < imp.LANCAMENTOS_GUARDADOS + 3; i++) imp.gravarSeForAProva(entrada('n' + i, PROVA), PROVA, dir);
    const lista = JSON.parse(fs.readFileSync(path.join(process.env.SWORN_TMP, 'sworn', 's1.json'), 'utf8')).impressoesDaProva;
    assert.strictEqual(lista.length, imp.LANCAMENTOS_GUARDADOS);
    assert.strictEqual(lista[lista.length - 1].id, 'n' + (imp.LANCAMENTOS_GUARDADOS + 2));
    assert.strictEqual(imp.mesmoCodigoDesde('s1', dir)('n' + (imp.LANCAMENTOS_GUARDADOS + 2), PROVA), true);
    // o lancamento que saiu da lista nao responde mais
    assert.strictEqual(imp.mesmoCodigoDesde('s1', dir)('n0', PROVA), false, 'o que saiu da lista');
  });
});
