'use strict';
// Plano 090 Tarefa 5: /sworn:shortcuts. O alvo do texto e o mock aprovado (prints-090/mock-090.png, secao 3, D554).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const atalhos = require('../scripts/lib/atalhos.js');

const RAIZ = path.join(__dirname, '..');
const PADRAO = ['atalho', 'ponytail', 'shortcut'];

test('marcas: padrao atalho, ponytail, shortcut; marcaDeAtalho troca so a primeira', () => {
  assert.deepStrictEqual(atalhos.marcas(null), PADRAO);
  assert.deepStrictEqual(atalhos.marcas({}), PADRAO);
  assert.deepStrictEqual(atalhos.marcas({ marcaDeAtalho: 'divida' }), ['divida', 'ponytail', 'shortcut']);
  assert.deepStrictEqual(atalhos.marcas({ marcaDeAtalho: 'shortcut' }), ['shortcut', 'ponytail'], 'sem repetir');
  for (const torta of ['', 'duas palavras', 'a:b', 7, null, ['x']]) {
    assert.deepStrictEqual(atalhos.marcas({ marcaDeAtalho: torta }), PADRAO, JSON.stringify(torta));
  }
});

test('lerLinha: os tres rotulos, em cada prefixo de comentario', () => {
  const esperado = { oque: 'preço fixo do Opus em vez de ler a tabela.', limite: 'só Opus 5.5.',
    gatilho: 'entrar outro modelo na tabela.' };
  const corpo = 'atalho: preço fixo do Opus em vez de ler a tabela. limite: só Opus 5.5. trocar quando: entrar outro modelo na tabela.';
  for (const linha of ['// ' + corpo, '# ' + corpo, '-- ' + corpo, '/* ' + corpo + ' */', '<!-- ' + corpo + ' -->',
    '  const x = 1; // ' + corpo, '\t# ' + corpo, '//' + corpo]) {
    assert.deepStrictEqual(atalhos.lerLinha(linha, PADRAO), esperado, linha);
  }
});

test('lerLinha: sem rotulo vira so o "o que", sem limite e sem gatilho', () => {
  assert.deepStrictEqual(atalhos.lerLinha('// atalho: pausa medida pelo relogio, vale um fuso', PADRAO),
    { oque: 'pausa medida pelo relogio, vale um fuso', limite: null, gatilho: null });
  assert.deepStrictEqual(atalhos.lerLinha('# ponytail: x. limite: y.', PADRAO), { oque: 'x.', limite: 'y.', gatilho: null });
  assert.deepStrictEqual(atalhos.lerLinha('# shortcut: z. trocar quando: w.', PADRAO), { oque: 'z.', limite: null, gatilho: 'w.' });
});

test('lerLinha: fora de comentario, dentro de string ou marca colada nao conta', () => {
  for (const linha of [
    'texto comum atalho: x',
    'atalho: x',
    "const s = '// atalho: x';",
    'const s = "# atalho: x";',
    'const s = `-- atalho: x`;',
    // com espaco antes do prefixo: so a aspa aberta segura (mutacao: sem dentroDeString estes passavam)
    "const s = 'veja // atalho: x';",
    'const s = "texto # atalho: x";',
    'f(`a -- atalho: x`)',
    // a marca e minuscula: "Atalho:" e palavra comum (tools/lib/dependencias-modal.mjs:360 da extensao)
    '// Atalho: so os livres, como Map(nome -> { linhas, escrito }).',
    '# SHORTCUT: x',
    'veja http://atalho: x',
    '// atalhos: x',
    '// o atalho: x',
    '// atalho x',
    ''
  ]) {
    assert.strictEqual(atalhos.lerLinha(linha, PADRAO), null, linha);
  }
  assert.strictEqual(atalhos.lerLinha('// divida: x', ['divida']).oque, 'x', 'marca configurada');
  assert.strictEqual(atalhos.lerLinha('// atalho: x', ['divida']), null, 'so a marca da lista');
});

test('varrer: linha comecando em 1, pula binario e arquivo que nao leu', () => {
  const conteudo = {
    'b.js': 'a\n// atalho: um. limite: dois. trocar quando: tres.\r\nc\n',
    'a.sh': '# shortcut: quatro\n',
    'bin.dat': 'x\u0000\n// atalho: nao\n',
    'sumiu.js': null
  };
  const achados = atalhos.varrer(Object.keys(conteudo), (a) => conteudo[a], PADRAO);
  assert.deepStrictEqual(achados, [
    { arquivo: 'b.js', linha: 2, oque: 'um.', limite: 'dois.', gatilho: 'tres.' },
    { arquivo: 'a.sh', linha: 1, oque: 'quatro', limite: null, gatilho: null }
  ]);
});

const GASTO = [
  { arquivo: 'scripts/lib/gasto.js', linha: 118, oque: 'soma em memória, sem leitura por partes.',
    limite: 'transcrição de até 50 MB.', gatilho: 'aparecer transcrição maior.' },
  { arquivo: 'scripts/lib/gasto.js', linha: 42, oque: 'preço fixo do Opus em vez de ler a tabela.',
    limite: 'só Opus 5.5.', gatilho: 'entrar outro modelo na tabela.' }
];

test('painel: todos com gatilho (mock coluna 1), ordem por linha', () => {
  assert.strictEqual(atalhos.painel(GASTO, 245, PADRAO), [
    'Atalhos registrados (marca: atalho, ponytail, shortcut)',
    '',
    'scripts/lib/gasto.js',
    '  :42  preço fixo do Opus em vez de ler a tabela.',
    '       limite: só Opus 5.5.',
    '       trocar quando: entrar outro modelo na tabela.',
    '  :118 soma em memória, sem leitura por partes.',
    '       limite: transcrição de até 50 MB.',
    '       trocar quando: aparecer transcrição maior.',
    '',
    '2 atalhos em 1 arquivo; todos com gatilho.'
  ].join('\n'));
});

test('painel: com sem-gatilho (mock coluna 2), arquivos em ordem alfabetica', () => {
  const achados = [GASTO[1], { arquivo: 'scripts/abrir-turno.js', linha: 77, oque: 'pausa medida pelo relógio do PC.',
    limite: 'um fuso só.', gatilho: null }];
  assert.strictEqual(atalhos.painel(achados, 245, PADRAO), [
    'Atalhos registrados (marca: atalho, ponytail, shortcut)',
    '',
    'scripts/abrir-turno.js',
    '  :77  pausa medida pelo relógio do PC.',
    '       limite: um fuso só.',
    '       sem-gatilho',
    'scripts/lib/gasto.js',
    '  :42  preço fixo do Opus em vez de ler a tabela.',
    '       limite: só Opus 5.5.',
    '       trocar quando: entrar outro modelo na tabela.',
    '',
    '2 atalhos em 2 arquivos; 1 sem gatilho.',
    'Atalho sem gatilho vira dívida esquecida: escreva "trocar quando: ..." no comentário.'
  ].join('\n'));
});

test('painel: singular, sem limite, e linha longa alarga a coluna', () => {
  const p = atalhos.painel([{ arquivo: 'x.js', linha: 12345, oque: 'a', limite: null, gatilho: 'b' }], 3, ['divida']);
  assert.strictEqual(p, [
    'Atalhos registrados (marca: divida)',
    '',
    'x.js',
    '  :12345 a',
    '         trocar quando: b',
    '',
    '1 atalho em 1 arquivo; todos com gatilho.'
  ].join('\n'));
});

test('painel: vazio (mock coluna 3) diz onde procurou', () => {
  assert.strictEqual(atalhos.painel([], 245, PADRAO), [
    'Nenhum atalho registrado.',
    '',
    'Procurei comentários com atalho:, ponytail: ou shortcut: em 245 arquivos (os rastreados pelo git e os novos que ele não ignora).'
  ].join('\n'));
  assert.ok(atalhos.painel([], 1, ['divida']).includes('com divida: em 1 arquivo ('), 'uma marca e um arquivo');
});

// --- o CLI, num repositorio de verdade ---

function git(dir, args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false'].concat(args),
    { cwd: dir, encoding: 'utf8', shell: false });
  assert.strictEqual(r.status, 0, 'git ' + args.join(' ') + ': ' + r.stderr);
}

function escrever(dir, rel, conteudo) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), conteudo);
}

function rodar(cwd) {
  return spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'atalhos.js')], { cwd: cwd, encoding: 'utf8', shell: false });
}

test('CLI: rastreado e novo nao ignorado entram; ignorado e node_modules ficam fora; nada muda no disco', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-atalhos-'));
  try {
    git(dir, ['init', '-q']);
    escrever(dir, '.gitignore', 'node_modules/\nfora.js\n');
    escrever(dir, 'src/rastreado.js', 'x\n// atalho: rastreado. limite: um. trocar quando: dois.\n');
    escrever(dir, 'ação.py', '# atalho: nome com acento\n');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-q', '-m', 'base']);
    escrever(dir, 'novo.sh', '# shortcut: novo sem commit. trocar quando: tres.\n');
    escrever(dir, 'fora.js', '// atalho: ignorado\n');
    escrever(dir, 'node_modules/p/i.js', '// atalho: dependencia\n');
    const antes = spawnSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).stdout;
    const r = rodar(path.join(dir, 'src'));
    assert.strictEqual(r.status, 0, r.stderr);
    // `:linha` alinhado na coluna de 4 (`:42` + 2 espacos no mock): `:2` leva 3.
    assert.ok(r.stdout.includes('src/rastreado.js\n  :2   rastreado.'), r.stdout);
    assert.ok(r.stdout.includes('ação.py\n  :1   nome com acento\n       sem-gatilho'), r.stdout);
    assert.ok(r.stdout.includes('novo.sh\n  :1   novo sem commit.'), r.stdout);
    assert.ok(!r.stdout.includes('ignorado') && !r.stdout.includes('dependencia'), r.stdout);
    assert.ok(r.stdout.includes('3 atalhos em 3 arquivos; 1 sem gatilho.'), r.stdout);
    assert.strictEqual(spawnSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).stdout, antes);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: repositorio sem atalho conta os arquivos; marcaDeAtalho do projeto.json vale', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-atalhos-'));
  try {
    git(dir, ['init', '-q']);
    escrever(dir, 'a.js', '// nada\n');
    escrever(dir, 'b.js', '// divida: so com a marca do projeto\n');
    let r = rodar(dir);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.startsWith('Nenhum atalho registrado.'), r.stdout);
    assert.ok(r.stdout.includes('em 2 arquivos ('), r.stdout);
    escrever(dir, '.claude/sworn/projeto.json', JSON.stringify({ marcaDeAtalho: 'divida' }));
    r = rodar(dir);
    assert.ok(r.stdout.includes('(marca: divida, ponytail, shortcut)') && r.stdout.includes('b.js\n  :1   so com a marca'), r.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: fora de repositorio git diz por que e sai com 1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-atalhos-sem-git-'));
  try {
    const r = rodar(dir);
    assert.strictEqual(r.status, 1);
    assert.ok(r.stdout.includes('não é repositório git'), r.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Suite carregada (s129): o git do repositorio de dentro estourou o prazo e a auditoria de 7 dias contou 2 atalhos em
// vez de 3 (auditoria-periodica.test.js, D576). Todo git da varredura leva o mesmo prazo, de 60 s.
test('atalhos: todo git que a varredura chama tem prazo de pelo menos 60 s (o rev-parse nao fica no padrao de 5 s)', () => {
  const gitLib = require('../scripts/lib/git.js');
  const original = gitLib.correr;
  const prazos = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-atalhos-prazo-'));
  try {
    gitLib.correr = function (cwd, args, opcoes) {
      prazos.push(args[0] + ':' + (opcoes && opcoes.timeout));
      return original.call(this, cwd, args, opcoes);
    };
    spawnSync('git', ['init', '-q'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'a.js'), '// atalho: x\n');
    atalhos.doRepositorio(dir, {});
  } finally {
    gitLib.correr = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(prazos.length >= 3, 'esperava rev-parse e os dois ls-files: ' + prazos.join(', '));
  for (const p of prazos) assert.ok(Number(p.split(':')[1]) >= 60000, 'git com prazo curto: ' + prazos.join(', '));
});
