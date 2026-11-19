'use strict';
// C2 (R-EGM): o drift - o codigo se afastou do plano. Pelo diff desde a base contra os caminhos e as caixas do plano,
// por script (o original relia tudo pelo modelo, sem diff). Cada desvio semeado tem o seu achado exato.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const lib = require('../scripts/lib/drift.js');

const tipos = function (r) { return r.achados.map(function (a) { return a.tipo + ':' + a.valor; }).sort(); };

test('C2 drift: sem desvio, nenhum achado; cada desvio semeado vira o seu', () => {
  const plano = [
    '- [x] Mudar `src/vendas.js` -> o desconto. Prova: `npm test`',
    '- [x] Mudar `src/recibo.js`, o formato. Prova: `npm test`',
    '- [ ] Criar `src/frete.js` (novo). Prova: `npm test`',
    'O nome curto `cli.js` tambem vale.',
    ''
  ].join('\n');
  const existe = function (p) { return ['src/vendas.js', 'src/recibo.js', 'src/cli.js'].indexOf(p) !== -1; };
  // tudo nos conformes: os dois feitos mudaram, o nome curto cobre src/cli.js, o novo ainda nao foi feito
  const limpo = lib.drift({ texto: plano, mudados: ['src/vendas.js', 'src/recibo.js', 'src/cli.js'], existe: existe });
  assert.deepStrictEqual(limpo.achados, [], JSON.stringify(limpo.achados));
  // desvios: um arquivo fora do plano, um feito sem mudanca, e o novo que a caixa diz feito mas nao existe
  const feito = plano.replace('- [ ] Criar', '- [x] Criar');
  const r = lib.drift({ texto: feito, mudados: ['src/vendas.js', 'test/extra.test.js'], existe: existe });
  assert.deepStrictEqual(tipos(r), [
    'criar-ausente:src/frete.js',
    'feita-sem-mudanca:src/recibo.js',
    'fora-do-plano:test/extra.test.js'
  ], JSON.stringify(r.achados));
  const linha = function (tipo) { return r.achados.filter(function (a) { return a.tipo === tipo; })[0].linha; };
  assert.strictEqual(linha('feita-sem-mudanca'), 2);
  assert.strictEqual(linha('criar-ausente'), 3);
  assert.strictEqual(linha('fora-do-plano'), null, 'o arquivo fora do plano nao tem linha no plano');
  assert.deepStrictEqual([r.mudados, r.noPlano], [2, 1], 'conta os mudados e quantos o plano cobre');
});

test('C2 drift: o id de modelo com barra nao e caminho; o erro de digitacao com extensao segue sendo', () => {
  const existe = function (p) { return p === 'src' || p === 'src/a.js'; };
  const plano = '- [x] Rodar o `openai/gpt-6-luna` e o `x-ai/grok-4.7` em `src/a.js`. Prova: `npm test`\n';
  const r = lib.drift({ texto: plano, mudados: ['src/a.js'], existe: existe });
  assert.deepStrictEqual(r.achados, [], JSON.stringify(r.achados));
  const typo = lib.drift({ texto: '- [x] Mudar `scr/a.js`. Prova: `npm test`\n', mudados: ['src/a.js'], existe: existe });
  assert.deepStrictEqual(tipos(typo), ['feita-sem-mudanca:scr/a.js', 'fora-do-plano:src/a.js']);
  // o "./" do comeco nao muda o arquivo; sem a funcao existe, nada existe (e nada quebra)
  const ponto = lib.drift({ texto: '- [x] Mudar `./src/a.js`. Prova: `npm test`\n', mudados: ['src/a.js'] });
  assert.deepStrictEqual(ponto.achados, [], JSON.stringify(ponto.achados));
  const semExiste = lib.drift({ texto: '- [x] Rodar o `openai/gpt-6-luna`. Prova: `npm test`\n', mudados: [] });
  assert.deepStrictEqual(semExiste.achados, [], 'sem a funcao existe, a pasta de cima nao confirma o id de modelo');
  // o nome com acento e caminho como os outros: citado, cobre o arquivo mudado
  const acento = lib.drift({ texto: '- [x] Revisar `docs/ação.md`. Prova: `npm test`\n', mudados: ['docs/ação.md'],
    existe: existe });
  assert.deepStrictEqual(acento.achados, [], JSON.stringify(acento.achados));
});

test('C2 drift: o caminho da continuacao responde pela linha da caixa; o bloco de codigo nao cobre arquivo', () => {
  const existe = function () { return true; };
  const plano = [
    '- [x] Mudar o calculo,',
    '  em `src/conta.js`. Prova: `npm test`',
    '- [x] Criar `src/existe.js` (novo). Prova: `npm test`',
    '```',
    'require("./src/z.js") // `src/z.js` so no exemplo',
    '```',
    ''
  ].join('\n');
  const r = lib.drift({ texto: plano, mudados: ['src/z.js'], existe: existe });
  assert.deepStrictEqual(r.achados.map(function (a) { return a.tipo + ':' + a.valor + '@' + a.linha; }).sort(), [
    'feita-sem-mudanca:src/conta.js@1',
    // o novo existe mas nao mudou desde a base: e caixa feita sem mudanca, nao "criar ausente"
    'feita-sem-mudanca:src/existe.js@3',
    'fora-do-plano:src/z.js@null'
  ], JSON.stringify(r.achados));
  // o ~~~ dentro de um bloco de crase nao o fecha: o caminho depois dele segue no exemplo
  const misto = ['- [x] Mudar `src/a.js`. Prova: `npm test`', '```md', '~~~', '- [x] Mudar `src/b.js`.', '```', ''];
  const m = lib.drift({ texto: misto.join('\n'), mudados: ['src/a.js'], existe: existe });
  assert.deepStrictEqual(m.achados, [], JSON.stringify(m.achados));
  // e o bloco aberto com ~~~ tambem e bloco
  const til = lib.drift({ texto: ['~~~', '- [x] Mudar `src/b.js`.', '~~~', ''].join('\n'), mudados: [], existe: existe });
  assert.deepStrictEqual(til.achados, [], JSON.stringify(til.achados));
});

test('C2 drift: o proprio plano e o que o sworn grava ficam fora do "fora do plano"', () => {
  const r = lib.drift({ texto: '- [x] Mudar `src/a.js`. Prova: `npm test`\n', mudados: ['src/a.js',
    'docs/plano.md', '.claude/sworn/estado.json', '.sworn/handoff/x.md'], existe: function () { return true; },
  plano: 'docs/plano.md' });
  assert.deepStrictEqual(r.achados, [], JSON.stringify(r.achados));
});

test('C2 drift: o comando drift.js le o diff desde a base num repositorio git de verdade', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-drift-'));
  try {
    const git = function (args) {
      const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false']
        .concat(args), { cwd: dir, encoding: 'utf8' });
      assert.strictEqual(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    git(['init', '-q']);
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'a\n');
    fs.writeFileSync(path.join(dir, 'src', 'b.js'), 'b\n');
    fs.writeFileSync(path.join(dir, 'plano.md'), '- [x] Mudar `src/a.js`. Prova: `npm test`\n');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'base']);
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'a2\n');
    git(['commit', '-q', '-am', 'a']);
    fs.writeFileSync(path.join(dir, 'src', 'b.js'), 'b2\n'); // na arvore, sem commit: tambem conta
    const cli = function (args) {
      return spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'drift.js')].concat(args),
        { cwd: dir, encoding: 'utf8' });
    };
    const r = cli(['plano.md']);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /fora-do-plano  src\/b\.js  \(mudou e o plano nao o cita: cite o arquivo na caixa/);
    assert.match(r.stdout, /acerte o plano ou o codigo e rode de novo, ate "nenhum achado"/, 'o proximo passo');
    assert.doesNotMatch(r.stdout, /src\/a\.js  /, 'o que o plano cita nao e desvio');
    const j = JSON.parse(cli(['plano.md', '--json']).stdout);
    assert.deepStrictEqual(j.achados.map(function (a) { return a.valor; }), ['src/b.js']);
    // a base explicita: desde o commit de a, so o b mudou (na arvore)
    const desde = cli(['plano.md', '--desde', 'HEAD', '--json']);
    assert.deepStrictEqual(JSON.parse(desde.stdout).mudados, 1);
    // sem plano: uso; base que nao existe: diz o que fazer
    assert.strictEqual(cli([]).status, 2);
    const ruim = cli(['plano.md', '--desde', 'nao-existe']);
    assert.strictEqual(ruim.status, 2);
    assert.match(ruim.stderr, /a base nao-existe nao e um commit/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('C2 drift: o nome com acento chega inteiro; a falha do git e erro, nunca "nada mudou"', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-drift-'));
  try {
    const git = function (args) {
      const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false']
        .concat(args), { cwd: dir, encoding: 'utf8' });
      assert.strictEqual(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    const cli = function (args) {
      return spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'drift.js')].concat(args),
        { cwd: dir, encoding: 'utf8' });
    };
    git(['init', '-q']);
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'ação.js'), 'a\n');
    fs.writeFileSync(path.join(dir, 'plano.md'), '- [x] Mudar `src/ação.js` e criar `src/nova-ç.js`. Prova: `npm test`\n');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'base']);
    const base = git(['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(dir, 'src', 'ação.js'), 'a2\n');
    git(['commit', '-q', '-am', 'a']);
    fs.writeFileSync(path.join(dir, 'src', 'nova-ç.js'), 'n\n'); // nova, fora do git: o ls-files tambem com -z
    const ok = cli(['plano.md', '--json']);
    assert.deepStrictEqual(JSON.parse(ok.stdout).achados, [], ok.stdout + ok.stderr);
    assert.strictEqual(JSON.parse(ok.stdout).noPlano, 2, 'os dois nomes com acento casam com o plano');
    // o --desde seguido de outra opcao e uso errado, nao um commit chamado "--json"
    const uso = cli(['plano.md', '--desde', '--json']);
    assert.strictEqual(uso.status, 2);
    assert.match(uso.stderr, /^uso: /);
    // o plano apagado e criado de novo: a base segue o commit mais antigo que o criou, e o b.js do meio conta
    fs.writeFileSync(path.join(dir, 'src', 'b.js'), 'b\n');
    git(['rm', '-q', 'plano.md']);
    git(['add', '.']);
    git(['commit', '-q', '-m', 'meio']);
    fs.writeFileSync(path.join(dir, 'plano.md'), '- [x] Mudar `src/ação.js` e criar `src/nova-ç.js`. Prova: `npm test`\n');
    git(['add', 'plano.md']);
    git(['commit', '-q', '-m', 'de novo']);
    const deNovo = JSON.parse(cli(['plano.md', '--json']).stdout);
    assert.strictEqual(deNovo.base, base, 'a base e o commit mais antigo que criou o plano');
    assert.deepStrictEqual(deNovo.achados.map(function (a) { return a.valor; }), ['src/b.js']);
    // a arvore da base some: o git falha, e o drift diz isso com codigo 2 em vez de "nenhum achado"
    const arvore = git(['rev-parse', base + '^{tree}']);
    fs.rmSync(path.join(dir, '.git', 'objects', arvore.slice(0, 2), arvore.slice(2)));
    const desde = cli(['plano.md', '--desde', base]);
    assert.strictEqual(desde.status, 2, desde.stdout + desde.stderr);
    assert.match(desde.stderr, /nao consegui ler o que mudou desde a base: o git falhou: /);
    assert.doesNotMatch(desde.stdout, /nenhum achado/);
    const semDesde = cli(['plano.md']);
    assert.strictEqual(semDesde.status, 2, semDesde.stdout + semDesde.stderr);
    assert.match(semDesde.stderr, /nao consegui ler o (historico do plano|que mudou desde a base): o git falhou: /);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('C2 drift: fora de um repositorio, a frase do git vai junto; o HEAD que o git recusa nao vira "sem commit"', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-drift-'));
  try {
    fs.writeFileSync(path.join(dir, 'plano.md'), '- [x] Mudar `a.js`. Prova: `npm test`\n');
    const cli = function () {
      return spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'drift.js'), 'plano.md'],
        { cwd: dir, encoding: 'utf8', env: Object.assign({}, process.env, { GIT_CEILING_DIRECTORIES: path.dirname(dir) }) });
    };
    const fora = cli();
    assert.strictEqual(fora.status, 2, fora.stdout);
    assert.match(fora.stderr, /sworn: o git falhou: .+; rode o drift na pasta do projeto/);
    spawnSync('git', ['init', '-q'], { cwd: dir });
    // o HEAD com lixo: o git sai 128, e o drift diz a causa em vez de "o plano nao tem commit"
    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'lixo\n');
    const lixo = cli();
    assert.strictEqual(lixo.status, 2, lixo.stdout);
    assert.match(lixo.stderr, /sworn: o git falhou: /);
    assert.doesNotMatch(lixo.stderr, /o plano nao tem commit/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('C2 drift: plano fora do git sem --desde diz como dar a base', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-drift-'));
  try {
    spawnSync('git', ['init', '-q'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'plano.md'), '- [x] Mudar `a.js`. Prova: `npm test`\n');
    const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'drift.js'), 'plano.md'],
      { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(r.status, 2, r.stdout);
    assert.match(r.stderr, /o plano nao tem commit no git; diga a base com --desde <commit>/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// H9-13 (D881): o requisito feito no papel, sem rastro no codigo
test('H9-13 drift: o R com todos os passos feitos e nenhum arquivo deles mudado vira achado', () => {
  const existe = function () { return true; };
  const plano = [
    'R1: o desconto vale.',
    'R2: o recibo sai em reais.',
    'R3: o frete entra.',
    'R4: o log sai.',
    '- [x] Mudar `src/vendas.js` (R1)',
    '- [x] Mudar `src/recibo.js` (R2)',
    '- [x] Conferir o frete, sem arquivo (R3)',
    '- [ ] Mudar `src/log.js` (R4)',
    '- [x] Mudar `src/cli.js` para o log (R4)',
    ''
  ].join('\n');
  // o src/cli.js do R4 nao mudou: o R4 so fica de fora porque tem passo aberto
  const r = lib.drift({ texto: plano, mudados: ['src/vendas.js'], existe: existe });
  const req = r.achados.filter(function (a) { return a.tipo === 'requisito-sem-mudanca'; })
    .map(function (a) { return a.valor + '@' + a.linha; });
  // R1 mudou; R2 nao (o arquivo dele ficou parado); R3 feito sem arquivo nenhum; R4 tem passo aberto
  assert.deepStrictEqual(req, ['R2@2', 'R3@3'], JSON.stringify(r.achados));
  // o arquivo citado na continuacao da caixa conta para o R dela
  const cont = lib.drift({ texto: 'R1: vale.\n- [x] Fazer o R1\n  em `src/vendas.js`\n', mudados: ['src/vendas.js'], existe: existe });
  assert.deepStrictEqual(cont.achados, [], JSON.stringify(cont.achados));
});
