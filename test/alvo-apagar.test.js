'use strict';
// Colheita lote 5, V1 (D846): o aviso da trava 5 lista o que o apagar barrado levaria (scripts/lib/alvo-apagar.js), com
// o alvo lido do comando por destrutivo.alvosDoApagar. A lista e acessoria: sem ela o aviso e o de sempre.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const destrutivo = require('../scripts/lib/destrutivo.js');
const alvoApagar = require('../scripts/lib/alvo-apagar.js');
const comum = require('./lib/comum.js');

function criar(dir, rel, conteudo) {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, conteudo === undefined ? 'x' : conteudo);
}

test('alvosDoApagar: le os caminhos do apagar simples, pela leitura do shell que roda', () => {
  const a = destrutivo.alvosDoApagar;
  // bash
  assert.deepStrictEqual(a('rm -rf build dist', 'Bash'), ['build', 'dist']);
  assert.deepStrictEqual(a('rm -r --force build', 'Bash'), ['build']);
  assert.deepStrictEqual(a('rm -rfv --recursive --dir --verbose -I build', 'Bash'), ['build']);
  assert.deepStrictEqual(a('rm.exe -R build', 'Bash'), ['build']);
  assert.deepStrictEqual(a("rm -rf 'a b' \"c d\"", 'Bash'), ['a b', 'c d']);
  assert.deepStrictEqual(a('rm -r -- -x', 'Bash'), ['-x'], 'depois do -- tudo e nome');
  assert.deepStrictEqual(a('rm -r /s', 'Bash'), ['/s'], 'no rm do bash /s e caminho');
  assert.deepStrictEqual(a('rmdir -v --ignore-fail-on-non-empty vazia', 'Bash'), ['vazia']);
  assert.deepStrictEqual(a('  rm -rf build  ', 'Bash'), ['build'], 'espaco nas pontas');
  // PowerShell: o comeco unico do nome do parametro vale, e o -Path/-LiteralPath leva o alvo
  assert.deepStrictEqual(a('Remove-Item -Recurse -Force build', 'PowerShell'), ['build']);
  assert.deepStrictEqual(a('ri -r -fo C:\\x\\y', 'PowerShell'), ['C:\\x\\y']);
  assert.deepStrictEqual(a('Remove-Item -LiteralPath build -Recurse', 'PowerShell'), ['build']);
  assert.deepStrictEqual(a('rd -Recu -pa build', 'PowerShell'), ['build']);
  assert.deepStrictEqual(a('del -lp build -Forc', 'PowerShell'), ['build']);
  assert.deepStrictEqual(a('rm -PSPath "a b" -r', 'PowerShell'), ['a b']);
  // cmd, so dentro do cmd /c (e //c, a grafia do bash do Git)
  assert.deepStrictEqual(a('cmd /c rd /s /q build', 'Bash'), ['build']);
  assert.deepStrictEqual(a('cmd //c rd /s /q build', 'Bash'), ['build']);
  assert.deepStrictEqual(a('cmd.exe /C rmdir /S /Q C:\\x\\y', 'PowerShell'), ['C:\\x\\y']);
  assert.deepStrictEqual(a('cmd /c del /q /f a.txt b.txt', 'Bash'), ['a.txt', 'b.txt']);
});

test('alvosDoApagar: o que nao e exatamente um apagar simples e literal devolve null', () => {
  const a = destrutivo.alvosDoApagar;
  for (const c of ['rm -rf build/*', 'rm -rf $ALVO', 'rm -rf a && ls', 'rm -rf a; ls', 'rm -rf ~/x', 'rm -rf $(pwd)',
    'rm -rf `pwd`', 'rm -rf a | cat', 'rm -rf {a,b}', 'rm -rf a > log', 'git reset --hard', 'git clean -fdx',
    'rm -rf', 'rm -rf -x', 'rm -rf ""', '"rm" -rf a', 'echo rm -rf a', 'rm -rf a\u00a0b', 'rm -rf \u201ca\u201d',
    // flag fora da lista: pode levar valor ou mudar o que sai
    'rm -r --one-file-system a', 'rm -rx a', 'rmdir -p a/b', 'rmdir -r a', 'rm -r "-f" a',
    // os verbos do cmd e do PowerShell nao existem no bash
    'rd /s /q build', 'del /q a.txt', 'Remove-Item -Recurse build', 'ri build',
    // cmd: o /s do del apaga o nome em toda subpasta; chave junta, desconhecida, entre aspas ou barra no nome
    'cmd /c del /s /q a.txt', 'cmd /c rd /s/q build', 'cmd /c rd /s /q a/b', 'cmd /c rd /s "/q" build',
    'cmd /c del /p a.txt', 'cmd /c rm -rf build', 'cmd /c rm build', 'cmd /c rd /s /f build', 'cmd /k rd /s /q build',
    'cmd /c rd /s /q -x']) {
    assert.strictEqual(a(c, 'Bash'), null, c);
  }
  for (const c of ['Remove-Item -Recurse -Include a b', 'Remove-Item -Recurse -Exclude a b',
    'Remove-Item -Recurse -Filter a b', 'Remove-Item -Recurse -Filt a b', 'Remove-Item -Recurse -Incl a b',
    'Remove-Item -Recurse -Exclu a b', 'Remove-Item -Recurse -Force -ErrorAction SilentlyContinue build',
    'Remove-Item -Recurse -ea 0 build', 'Remove-Item -Recurse a b', 'Remove-Item -Path a b', 'Remove-Item -Path',
    'Remove-Item build -Path',
    'Remove-Item -p build', 'Remove-Item -f build', 'Remove-Item -Recurse HKCU:/x', 'Remove-Item -Recurse a.txt:s',
    'rd /s /q build', 'rmdir.exe /S build', 'rm -rf build', 'Remove-Item -Recurse -- build',
    "Remove-Item '-Recurse' build", 'rm.exe build']) {
    assert.strictEqual(a(c, 'PowerShell'), null, c);
  }
  assert.strictEqual(a('rm -rf C:\\x', 'Bash'), null, 'no bash a barra invertida escapa');
  assert.strictEqual(a('', 'Bash'), null);
  assert.strictEqual(a(null, 'Bash'), null);
  assert.strictEqual(a(undefined, 'Bash'), null);
  const vinte = Array.from({ length: 20 }, function (_, i) { return 'a' + i; });
  assert.deepStrictEqual(a('rm -rf ' + vinte.join(' '), 'Bash'), vinte, '20 alvos ainda listam');
  assert.strictEqual(a('rm -rf ' + vinte.join(' ') + ' a20', 'Bash'), null, '21 alvos nao');
});

test('arquivosNomeados: o leitor dividido com alvosDoApagar le como antes', () => {
  const n = destrutivo.arquivosNomeados;
  assert.deepStrictEqual(n('rm a.txt b.txt', 'Bash'), ['a.txt', 'b.txt']);
  assert.deepStrictEqual(n('cmd //c del /q a.txt', 'Bash'), ['a.txt']);
  assert.deepStrictEqual(n('Remove-Item -LiteralPath a.txt', 'PowerShell'), ['a.txt']);
  for (const c of ['rm -rf a', 'cmd /k del a.txt', '"rm" a.txt', 'del /q a.txt', 'rm $X']) assert.strictEqual(n(c, 'Bash'), null, c);
});

test('descrever: pasta com contagem, os primeiros nomes em ordem e o resto contado', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-v1-'));
  try {
    for (let i = 0; i < 9; i++) criar(raiz, 'build/f' + i + '.txt', 'abc');
    criar(raiz, 'build/sub/a.txt', 'abc');
    criar(raiz, 'build/sub/fundo/b.txt', 'abc');
    criar(raiz, 'build/z.txt', 'abc');
    assert.deepStrictEqual(alvoApagar.descrever(['build'], raiz, raiz), [
      'pasta "build": 12 arquivo(s) em 3 pasta(s), 36 bytes',
      '  build/f0.txt', '  build/f1.txt', '  build/f2.txt', '  build/f3.txt', '  build/f4.txt', '  build/f5.txt',
      '  build/f6.txt', '  build/f7.txt', '  build/f8.txt', '  build/z.txt',
      '  ... e mais 2 arquivo(s)'
    ]);
    // os arquivos de cada pasta saem antes das subpastas dela (z.txt antes de sub/a.txt)
    const so = alvoApagar.descrever(['build/sub'], raiz, raiz);
    assert.deepStrictEqual(so, ['pasta "build/sub": 2 arquivo(s) em 2 pasta(s), 6 bytes', '  build/sub/a.txt',
      '  build/sub/fundo/b.txt']);
    // a ordem e a do nome em codigo (maiuscula antes), igual em todo sistema, e as subpastas descem na mesma ordem
    criar(raiz, 'ord/a.txt'); criar(raiz, 'ord/B.txt'); criar(raiz, 'ord/s1/x.txt'); criar(raiz, 'ord/s2/y.txt');
    assert.deepStrictEqual(alvoApagar.descrever(['ord'], raiz, raiz).slice(1),
      ['  ord/B.txt', '  ord/a.txt', '  ord/s1/x.txt', '  ord/s2/y.txt']);
    // os 10 nomes sao somados entre os alvos: o de baixo diz que os seus nao saem, em vez de calar
    criar(raiz, 'depois/d1.txt'); criar(raiz, 'depois/d2.txt');
    const dois = alvoApagar.descrever(['build', 'depois'], raiz, raiz);
    assert.deepStrictEqual(dois.slice(-2), ['pasta "depois": 2 arquivo(s) em 1 pasta(s), 2 bytes',
      '  (sem nomes: os ' + alvoApagar.ARQUIVOS_LISTADOS + ' da lista ja sairam nos alvos acima)']);
    // nome com espaco e com acento, como o rm -rf 'a b' devolve
    criar(raiz, 'a b/\u00e7.txt', 'ab');
    assert.deepStrictEqual(alvoApagar.descrever(['a b'], raiz, raiz),
      ['pasta "a b": 1 arquivo(s) em 1 pasta(s), 2 bytes', '  a b/\u00e7.txt']);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('descrever: arquivo, ausente, vazia, rede, fora da raiz, tamanhos, nome vazio e o cwd', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-v1-'));
  const fora = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-v1-fora-'));
  try {
    criar(raiz, 'x.txt', 'abcde');
    criar(raiz, 'um.txt', 'a');
    criar(raiz, 'kb.bin', Buffer.alloc(2048));
    criar(raiz, 'mb.bin', Buffer.alloc(1536 * 1024));
    criar(raiz, 'src/dentro.txt', 'ab');
    fs.mkdirSync(path.join(raiz, 'vazia'));
    criar(fora, 'longe.txt', 'ab');
    const d = alvoApagar.descrever;
    assert.deepStrictEqual(d(['x.txt'], raiz, raiz), ['arquivo "x.txt": 5 bytes']);
    assert.deepStrictEqual(d(['um.txt'], raiz, raiz), ['arquivo "um.txt": 1 byte']);
    assert.deepStrictEqual(d(['kb.bin'], raiz, raiz), ['arquivo "kb.bin": 2 KB']);
    criar(raiz, 'k1.bin', Buffer.alloc(1024));
    criar(raiz, 'k0.bin', Buffer.alloc(1023));
    assert.deepStrictEqual(d(['k1.bin', 'k0.bin'], raiz, raiz), ['arquivo "k1.bin": 1 KB', 'arquivo "k0.bin": 1023 bytes']);
    assert.deepStrictEqual(d(['mb.bin'], raiz, raiz), ['arquivo "mb.bin": 1,5 MB'], 'virgula decimal');
    assert.deepStrictEqual(d(['nada', 'x.txt/y'], raiz, raiz), ['"nada": nao existe', '"x.txt/y": nao existe']);
    assert.deepStrictEqual(d(['vazia'], raiz, raiz), ['pasta "vazia": vazia']);
    assert.deepStrictEqual(d([''], raiz, raiz), ['"": nome vazio, nao conferido']);
    // o que o shell expande nao e o caminho escrito: nem "nao existe" nem contado
    assert.deepStrictEqual(d(['*', 'x.tx?', '~/x', '$X', 'a{b,c}', '`pwd`', '[ab]', 'a~b'], raiz, raiz),
      ['"*": o shell expande o nome, nao conferido', '"x.tx?": o shell expande o nome, nao conferido',
        '"~/x": o shell expande o nome, nao conferido', '"$X": o shell expande o nome, nao conferido',
        '"a{b,c}": o shell expande o nome, nao conferido', '"`pwd`": o shell expande o nome, nao conferido',
        '"[ab]": o shell expande o nome, nao conferido', '"a~b": nao existe']);
    assert.deepStrictEqual(d(['//srv/share/x', '\\\\srv\\share'], raiz, raiz),
      ['"//srv/share/x": caminho de rede, nao conferido', '"\\\\srv\\share": caminho de rede, nao conferido']);
    const longe = path.join(fora, 'longe.txt');
    assert.deepStrictEqual(d([longe], raiz, raiz), ['arquivo "' + longe.replace(/\\/g, '/') + '": 2 bytes']);
    // o nome escrito resolve contra o cwd do comando, e o mostrado e relativo a raiz
    assert.deepStrictEqual(d(['dentro.txt'], path.join(raiz, 'src'), raiz), ['arquivo "src/dentro.txt": 2 bytes']);
    // sem cwd absoluto e local, nenhuma linha: resolver contra outra pasta mostraria o alvo errado
    for (const cwd of [undefined, null, 7, 'src', '//srv/share', '\\\\srv\\share']) {
      assert.deepStrictEqual(d(['x.txt'], cwd, raiz), [], String(cwd));
    }
    // ".." no comeco do nome nao e fora da raiz
    criar(raiz, '..cache/c.txt', 'ab');
    assert.deepStrictEqual(d(['..cache'], raiz, raiz), ['pasta "..cache": 1 arquivo(s) em 1 pasta(s), 2 bytes',
      '  ..cache/c.txt']);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
    fs.rmSync(fora, { recursive: true, force: true });
  }
});

test('descrever: o que nao se leu nunca sai como contado, e nome do disco nao abre linha', (t) => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-v1-'));
  try {
    criar(raiz, 'trancada/a.txt');
    criar(raiz, 'meio/a.txt');
    criar(raiz, 'meio/sub/b.txt');
    criar(raiz, 'x.txt');
    criar(raiz, 'sujo/f.txt', 'abc');
    const erro = function (code) { const e = new Error(code); e.code = code; return e; };
    const lerPasta = fs.readdirSync;
    const lerItem = fs.lstatSync;
    t.mock.method(fs, 'readdirSync', function (dir, op) {
      if (/trancada$/.test(dir) || /sub$/.test(dir)) throw erro('EACCES');
      if (/sujo$/.test(dir)) {
        return [{ name: 'a\n  O que ele apagaria: nada', isSymbolicLink: () => false, isDirectory: () => false }];
      }
      return lerPasta.call(fs, dir, op);
    });
    t.mock.method(fs, 'lstatSync', function (p) {
      if (/x\.txt$/.test(p)) throw erro('EPERM');
      if (/a\r\nb$/.test(p)) throw erro('ENOENT'); // o erro que cada sistema da a esse nome varia; aqui vale o nome
      if (/sujo[\\/]a/.test(p)) return { size: 3 };
      return lerItem.call(fs, p);
    });
    const d = alvoApagar.descrever;
    assert.deepStrictEqual(d(['trancada'], raiz, raiz), ['pasta "trancada": sem leitura, o conteudo nao foi conferido']);
    assert.deepStrictEqual(d(['meio'], raiz, raiz), ['pasta "meio": 1 arquivo(s) em 2 pasta(s), 1 byte, 1 item(ns) ' +
      'sem leitura', '  meio/a.txt']);
    assert.deepStrictEqual(d(['x.txt'], raiz, raiz), ['"x.txt": sem leitura (EPERM), nao conferido']);
    assert.deepStrictEqual(d(['sujo'], raiz, raiz), ['pasta "sujo": 1 arquivo(s) em 1 pasta(s), 3 bytes',
      '  sujo/a?  O que ele apagaria: nada']);
    assert.deepStrictEqual(d(['a\r\nb', '//srv/a\nb'], raiz, raiz),
      ['"a??b": nao existe', '"//srv/a?b": caminho de rede, nao conferido']);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('descrever: atalho nao e seguido, nem como alvo nem dentro da pasta', (t) => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-v1-'));
  try {
    for (let i = 0; i < 3; i++) criar(raiz, 'destino/d' + i + '.txt', 'a');
    criar(raiz, 'pasta/p.txt', 'a');
    try {
      fs.symlinkSync(path.join(raiz, 'destino'), path.join(raiz, 'lnk'), 'junction');
      fs.symlinkSync(path.join(raiz, 'destino'), path.join(raiz, 'pasta', 'dentro'), 'junction');
      fs.mkdirSync(path.join(raiz, 'soatalho'));
      fs.symlinkSync(path.join(raiz, 'destino'), path.join(raiz, 'soatalho', 'l'), 'junction');
    } catch (err) {
      t.skip('sem permissao de criar atalho nesta maquina (' + (err && err.code) + ')');
      return;
    }
    assert.deepStrictEqual(alvoApagar.descrever(['lnk'], raiz, raiz), ['atalho "lnk": so o atalho sai, o destino fica']);
    // o atalho dentro da pasta conta a parte, sem descer nele nem somar o destino
    assert.deepStrictEqual(alvoApagar.descrever(['pasta'], raiz, raiz),
      ['pasta "pasta": 1 arquivo(s) em 1 pasta(s), 1 byte, 1 atalho(s) (so o atalho sai)', '  pasta/p.txt']);
    // a pasta so com um atalho nao e vazia: o atalho sai junto
    assert.deepStrictEqual(alvoApagar.descrever(['soatalho'], raiz, raiz),
      ['pasta "soatalho": 0 arquivo(s) em 1 pasta(s), 0 bytes, 1 atalho(s) (so o atalho sai)']);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('descrever: a contagem para no teto, somando os alvos, e os nomes listados tambem', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-v1-'));
  try {
    const teto = alvoApagar.TETO_DE_ITENS;
    for (let i = 0; i < teto + 5; i++) criar(raiz, 'grande/f' + String(i).padStart(5, '0') + '.txt', 'a');
    criar(raiz, 'outra/o.txt', 'a');
    criar(raiz, 'solto.txt', 'abc');
    const l = alvoApagar.descrever(['grande', 'outra', 'solto.txt'], raiz, raiz);
    assert.strictEqual(l[0], 'pasta "grande": a contagem parou em ' + teto + ' itens; ate ali, ' + teto +
      ' arquivo(s) em 1 pasta(s), ' + Math.round(teto / 1024) + ' KB');
    assert.strictEqual(l.length, 1 + alvoApagar.ARQUIVOS_LISTADOS + 3, l.join('\n'));
    assert.strictEqual(l[alvoApagar.ARQUIVOS_LISTADOS + 1], '  ... e mais pelo menos ' +
      (teto - alvoApagar.ARQUIVOS_LISTADOS) + ' arquivo(s)');
    // o teto ja gasto pela primeira: a segunda pasta nem e lida, e diz isso; o arquivo solto ainda sai (so um lstat)
    assert.strictEqual(l[l.length - 2], 'pasta "outra": nao contada (a contagem ja parou em ' + teto + ' itens)');
    assert.strictEqual(l[l.length - 1], 'arquivo "solto.txt": 3 bytes');
    // com um alvo antes, a linha diz que o teto e somado: a pasta nao tem sozinha os 2000
    criar(raiz, 'antes/a.txt', 'a');
    assert.strictEqual(alvoApagar.descrever(['antes', 'grande'], raiz, raiz)[2], 'pasta "grande": a contagem, somada ' +
      'com os alvos acima, parou em ' + teto + ' itens; ate ali, ' + (teto - 1) + ' arquivo(s) em 1 pasta(s), 2 KB');
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('motivo: sem alvo o aviso e o de sempre; com alvo, a secao entra depois do porque, em ASCII', () => {
  const r = { destrutivo: true, motivo: 'rm recursivo ou forcado' };
  const sem = destrutivo.motivo('rm -rf build', r);
  assert.strictEqual(destrutivo.motivo('rm -rf build', r, []), sem);
  assert.strictEqual(destrutivo.motivo('rm -rf build', r, null), sem);
  assert.strictEqual(sem.indexOf('O que ele apagaria'), -1);
  // o nome fora do ASCII sai pelo codigo, nunca dobrado ("acao" seria outra pasta)
  const com = destrutivo.motivo('rm -rf build', r, ['pasta "a\u00e7\u00e3o": 1 arquivo(s)', '  a\u00e7\u00e3o/\u{1f600}.txt']);
  const linhas = com.split('\n');
  const i = linhas.indexOf('Por que barrou: rm recursivo ou forcado.');
  assert.deepStrictEqual(linhas.slice(i + 1, i + 5), ['', 'O que ele apagaria:',
    '  pasta "a\\u00e7\\u00e3o": 1 arquivo(s)', '    a\\u00e7\\u00e3o/\\u{1f600}.txt']);
  assert.ok(/^[\x00-\x7f]*$/.test(com), 'so ASCII');
  // o resto do aviso nao muda: o que vem depois da secao e o que vinha depois do porque
  const semLinhas = sem.split('\n');
  assert.deepStrictEqual(linhas.slice(0, i + 1), semLinhas.slice(0, i + 1));
  assert.deepStrictEqual(linhas.slice(i + 5), semLinhas.slice(i + 1));
  // a linha longa e cortada com marca, para nao parecer um caminho inteiro; a de 300 cabe inteira
  const longa = destrutivo.motivo('rm -rf build', r, ['x'.repeat(301), 'y'.repeat(300)]).split('\n');
  assert.strictEqual(longa[i + 3], '  ' + 'x'.repeat(297) + '...');
  assert.strictEqual(longa[i + 4], '  ' + 'y'.repeat(300));
  // a linha que chegar com tab ou quebra nao abre outra linha no aviso
  const torta = destrutivo.motivo('rm -rf build', r, ['a\tb\nc']).split('\n');
  assert.strictEqual(torta[i + 3], '  a b c');
});

test('portao-destrutivo: o rm -rf barrado mostra o que apagaria; o que nao se le sai sem a lista', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-v1-gate-'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-v1-tmp-'));
  try {
    criar(dir, 'build/a.js', 'abc');
    criar(dir, 'build/b/c.js', 'abcd');
    criar(dir, '.claude/sworn/projeto.json', '{}'); // a raiz do projeto e o dir, tambem com o cwd em build/
    // D899: o registro das pastas de estudo e o do teste, nunca o do ~/.claude de quem roda (com um estudo la, o cwd
    // torto estourava no pastas.executaNoEstudo e o portao liberava); com um estudo registrado aqui, o caminho roda sempre
    const env = Object.assign({}, process.env, { SWORN_TMP: tmp, CLAUDE_CONFIG_DIR: path.join(tmp, 'config') });
    const estudo = path.join(tmp, 'estudo');
    fs.mkdirSync(estudo);
    assert.ok(require('../scripts/lib/pastas.js').registrar(estudo, 'estudo', { sessao: 's-v1' }, env).ok);
    const evento = (comando, ferramenta, cwd) => comum.ganchoEmProcesso('scripts/portao-destrutivo.js', {
      session_id: 's-v1', cwd: cwd, tool_name: ferramenta || 'Bash', tool_input: { command: comando } },
    { env: env, cwd: dir });
    const chamar = (comando, ferramenta, cwd) => {
      const o = evento(comando, ferramenta, cwd === undefined ? dir : cwd);
      const h = o?.hookSpecificOutput;
      assert.ok(h && h.permissionDecision === 'deny', comando + ': devia negar: ' + JSON.stringify(o));
      assert.ok(h.permissionDecisionReason.indexOf('sworn - comando destrutivo barrado (trava 5)') === 0,
        h.permissionDecisionReason);
      return h.permissionDecisionReason;
    };
    const motivo = chamar('rm -rf build');
    assert.ok(motivo.indexOf('O que ele apagaria:\n  pasta "build": 2 arquivo(s) em 2 pasta(s), 7 bytes\n' +
      '    build/a.js\n    build/b/c.js\n') !== -1, motivo);
    const ps = chamar('Remove-Item -Recurse -Force build', 'PowerShell');
    assert.ok(ps.indexOf('pasta "build": 2 arquivo(s)') !== -1, ps);
    // o cwd do comando numa subpasta: o nome resolve contra ele e sai relativo a raiz
    const sub = chamar('rm -rf b', 'Bash', path.join(dir, 'build'));
    assert.ok(sub.indexOf('pasta "build/b": 1 arquivo(s) em 1 pasta(s), 4 bytes') !== -1, sub);
    // o que nao se le sem rodar, e o cwd torto ou ausente (que resolveria a pasta errada): nega igual, sem a lista
    for (const [c, cwd] of [['rm -rf build/*'], ['git reset --hard'], ['rm -rf build && ls'], ['rm -rf build', 7],
      ['rm -rf build', null]]) {
      const m = chamar(c, 'Bash', cwd);
      assert.strictEqual(m.indexOf('O que ele apagaria'), -1, c + ' / ' + cwd + ': ' + m);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
