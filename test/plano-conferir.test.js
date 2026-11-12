'use strict';
// C2 (R-EGM): a conferência mecânica do plano antes de codar. Cada defeito semeado tem o seu achado exato;
// o plano limpo não tem nenhum, e o relatório conta o que conferiu.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const lib = require('../scripts/lib/plano-conferir.js');

function projeto(fn) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-plano-'));
  try {
    fs.mkdirSync(path.join(raiz, 'src'));
    fs.writeFileSync(path.join(raiz, 'src', 'vendas.js'), 'function totalComDesconto(itens) {}\nmodule.exports = {};\n');
    fs.writeFileSync(path.join(raiz, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
    fs.mkdirSync(path.join(raiz, 'scripts'));
    fs.writeFileSync(path.join(raiz, 'scripts', 'gerar.js'), '');
    fn(raiz);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
}

const tipos = function (r) { return r.achados.map(function (a) { return a.tipo + ':' + a.valor; }).sort(); };

test('C2: o plano limpo nao tem achado, e o relatorio conta o que conferiu', () => {
  projeto((raiz) => {
    const plano = [
      '# Plano',
      '',
      '- [ ] Mudar `src/vendas.js` -> `totalComDesconto`: o desconto em porcentagem. Prova: `npm test`',
      '- [ ] Criar `src/recibo.js` (novo), com o formato em reais. Prova: `node --test`',
      '- [x] Rodar `node scripts/gerar.js` antes (feito)',
      ''
    ].join('\n');
    const r = lib.conferir(plano, raiz);
    assert.deepStrictEqual(r.achados, [], JSON.stringify(r.achados));
    // citados: src/vendas.js, totalComDesconto, src/recibo.js, node scripts/gerar.js, npm test, node --test
    assert.ok(r.citados >= 4 && r.conferidos === r.citados, JSON.stringify(r));
  });
});

test('C2: cada defeito semeado vira o seu achado, com a linha', () => {
  projeto((raiz) => {
    const plano = [
      '# Plano',
      '- [ ] Mudar `src/vemdas.js` para somar o frete. Prova: `npm test`',
      '- [ ] Em `src/vendas.js` -> `totalSemDesconto`, tirar o desconto. Prova: `npm test`',
      '- [ ] Rodar `node scripts/apagar.js`. Prova: `npm run verificar`',
      '- [ ] Ajustar o README sem dizer como provar',
      ''
    ].join('\n');
    const r = lib.conferir(plano, raiz);
    assert.deepStrictEqual(tipos(r), [
      'caixa-sem-prova:- [ ] Ajustar o README sem dizer como provar',
      'caminho-inexistente:src/vemdas.js',
      'comando-sem-script:node scripts/apagar.js',
      'comando-sem-script:npm run verificar',
      'simbolo-ausente:totalSemDesconto'
    ].sort(), JSON.stringify(r.achados));
    const linha = function (tipo) { return r.achados.filter(function (a) { return a.tipo === tipo; })[0].linha; };
    assert.strictEqual(linha('caminho-inexistente'), 2);
    assert.strictEqual(linha('simbolo-ausente'), 3);
    assert.strictEqual(linha('caixa-sem-prova'), 5);
    assert.ok(r.conferidos < r.citados, 'o que faltou nao conta como conferido');
  });
});

test('C2: o caminho marcado criar nao e achado; o que nao e caminho fica fora; o bloco de codigo tambem', () => {
  projeto((raiz) => {
    const plano = [
      '- [ ] Novo arquivo `src/frete.js`, criado do zero. Prova: `npm test`',
      'A palavra `pronto` e a flag `--seco` nao sao caminhos; nem `https://exemplo.com/a.js`, nem `scripts/**`.',
      '```js',
      'require(\'./src/nao-existe.js\'); // `src/nao-existe.js` dentro do bloco',
      '```',
      'Caminho absoluto `C:/x/y.js` e de variavel `<pasta>/x.js` ficam de fora.',
      ''
    ].join('\n');
    const r = lib.conferir(plano, raiz);
    assert.deepStrictEqual(r.achados, [], JSON.stringify(r.achados));
  });
});

test('C2: o que os planos reais citam sem ser caminho do repositorio nao vira achado', () => {
  projeto((raiz) => {
    fs.mkdirSync(path.join(raiz, 'docs', 'tarefas', 'T3', 'saida'), { recursive: true });
    fs.writeFileSync(path.join(raiz, 'docs', 'tarefas', 'T3', 'saida', 'util.js'), '');
    // o plano irmao mora na pasta do plano, nao na raiz: so a pasta do plano o acha
    fs.mkdirSync(path.join(raiz, 'planos'));
    fs.writeFileSync(path.join(raiz, 'planos', 'plano-antigo.md'), '');
    const arquivos = ['src/vendas.js', 'docs/tarefas/T3/saida/util.js', 'scripts/gerar.js'];
    const plano = [
      'O modelo `x-ai/grok-4.7` e o `openai/gpt-6-luna` sao ids, nao caminhos.',
      'As APIs `os.remove` e `fs.unlink` nao sao arquivos.',
      'O nome curto `vendas.js` e o caminho da fixture `saida/util.js` estao no repositorio.',
      'O plano irmao `plano-antigo.md` mora na pasta do plano.',
      'Os comandos `npm run <x>` e `node --test test/*.test.js` levam marcador e curinga.',
      ''
    ].join('\n');
    const r = lib.conferir(plano, raiz, { arquivos: arquivos, pasta: path.join(raiz, 'planos') });
    assert.deepStrictEqual(r.achados, [], JSON.stringify(r.achados));
    // a palavra entre crases depois do caminho, sem separador, nao e simbolo dele
    const solta = lib.conferir('Mudar `src/vendas.js` e depois dizer `pronto`.\n', raiz, { arquivos: arquivos });
    assert.deepStrictEqual(solta.achados, [], JSON.stringify(solta.achados));
    // o erro de digitacao na pasta de cima segue achado, porque a extensao diz que e arquivo
    const typo = lib.conferir('Mudar `scirpts/gerar.js`.\n', raiz, { arquivos: arquivos, pasta: raiz });
    assert.deepStrictEqual(tipos(typo), ['caminho-inexistente:scirpts/gerar.js']);
    // e o nome curto que nao existe em lugar nenhum tambem
    const curto = lib.conferir('Ver `sumiu.js`.\n', raiz, { arquivos: arquivos, pasta: raiz });
    assert.deepStrictEqual(tipos(curto), ['caminho-inexistente:sumiu.js']);
    // o simbolo do nome curto se confere no arquivo que o nome curto achou
    const sim = lib.conferir('Em `vendas.js` -> `totalComDesconto` e `vendas.js` -> `naoTem`.\n', raiz,
      { arquivos: arquivos, pasta: raiz });
    assert.deepStrictEqual(tipos(sim), ['simbolo-ausente:naoTem'], JSON.stringify(sim.achados));
  });
});

test('C2: o simbolo de um caminho que existe e nao se le (pasta) e achado; ".." e a cerca de til ficam de fora', () => {
  projeto((raiz) => {
    // a pasta existe, mas o simbolo nao se confere nela: nao passa calado como conferido
    const pasta = lib.conferir('Em `src/` -> `totalComDesconto`.\n', raiz);
    assert.deepStrictEqual(tipos(pasta), ['simbolo-ausente:totalComDesconto'], JSON.stringify(pasta.achados));
    assert.match(pasta.achados[0].motivo, /nao consegui ler src\//);
    // o caminho que sobe para fora da raiz nao e lido, e a cerca de til e bloco de codigo como a de crase
    fs.writeFileSync(path.join(path.dirname(raiz), 'fora-' + path.basename(raiz) + '.json'), 'CHAVE');
    try {
      const plano = ['Ver `../fora-' + path.basename(raiz) + '.json` -> `CHAVE`.', '~~~', '`src/nao-existe.js`', '~~~', ''];
      const r = lib.conferir(plano.join('\n'), raiz);
      assert.deepStrictEqual(r.achados, [], JSON.stringify(r.achados));
      assert.strictEqual(r.citados, 0, 'nada fora da raiz nem dentro da cerca e citado');
    } finally {
      fs.rmSync(path.join(path.dirname(raiz), 'fora-' + path.basename(raiz) + '.json'), { force: true });
    }
  });
});

test('C2: o package.json que falta ou nao se le diz isso, nao "nao tem o script"; a cerca fecha so com a sua', () => {
  projeto((raiz) => {
    const motivo = function (r) { return r.achados.map(function (a) { return a.motivo; }).join(' | '); };
    fs.rmSync(path.join(raiz, 'package.json'));
    assert.match(motivo(lib.conferir('Rodar `npm test`.\n', raiz)), /nao ha package\.json na pasta/);
    fs.writeFileSync(path.join(raiz, 'package.json'), '{ quebrado');
    assert.match(motivo(lib.conferir('Rodar `npm test`.\n', raiz)), /o package\.json nao e JSON valido/);
    fs.rmSync(path.join(raiz, 'package.json'));
    fs.mkdirSync(path.join(raiz, 'package.json'));
    assert.match(motivo(lib.conferir('Rodar `npm test`.\n', raiz)), /nao consegui ler o package\.json/);
    // a caixa de exemplo dentro do bloco de codigo nao e passo; o ~~~ dentro de um bloco de crase nao o fecha
    const plano = ['```md', '- [ ] passo de exemplo, sem prova', '~~~', '`src/nao-existe.js`', '```', ''].join('\n');
    const r = lib.conferir(plano, raiz);
    assert.deepStrictEqual(r.achados, [], JSON.stringify(r.achados));
    // a cerca de 4 crases mostra um bloco de 3 dentro dela; o ``` com texto depois tambem nao a fecha
    const quatro = ['````md', '```', '`docs/nao-existe.md`', '```js', '````', 'Fora: `src/fora.js`.', ''].join('\n');
    assert.deepStrictEqual(lib.conferir(quatro, raiz).achados.map(function (a) { return a.valor + '@' + a.linha; }),
      ['src/fora.js@6'], 'so a citacao depois do bloco conta');
    const comTexto = ['```', '```js', '`docs/nao-existe.md`', '```', 'Fora: `src/fora.js`.', ''].join('\n');
    assert.deepStrictEqual(lib.conferir(comTexto, raiz).achados.map(function (a) { return a.valor + '@' + a.linha; }),
      ['src/fora.js@5'], 'o ```js no meio do bloco nao o fecha');
    // ```a` b e codigo em linha, nao abre bloco: a citacao da linha seguinte conta
    const emLinha = lib.conferir(['```a` b', 'Fora: `src/fora.js`.', ''].join('\n'), raiz);
    assert.deepStrictEqual(emLinha.achados.map(function (a) { return a.valor; }), ['src/fora.js']);
  });
});

test('C2: a prova da caixa pode vir na linha de continuacao; a caixa feita nao cobra prova', () => {
  projeto((raiz) => {
    const plano = [
      '- [ ] Mudar `src/vendas.js` para o desconto novo,',
      '  com prova pelo `npm test` depois da edicao',
      '- [x] Caixa ja feita, sem prova escrita',
      '- [ ] Outra sem prova',
      '  e sem comando na continuacao',
      ''
    ].join('\n');
    const r = lib.conferir(plano, raiz);
    assert.deepStrictEqual(tipos(r), ['caixa-sem-prova:- [ ] Outra sem prova'], JSON.stringify(r.achados));
  });
});

test('C2: o comando revisar-plano.js imprime o relatorio e sai com 1 quando ha achado', () => {
  projeto((raiz) => {
    const plano = path.join(raiz, 'plano.md');
    const cli = (args) => spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'revisar-plano.js')].concat(args),
      { cwd: raiz, encoding: 'utf8' });
    fs.writeFileSync(plano, '- [ ] Mudar `src/vendas.js`. Prova: `npm test`\n');
    const limpo = cli([plano]);
    assert.strictEqual(limpo.status, 0, limpo.stdout + limpo.stderr);
    assert.match(limpo.stdout, /nenhum achado/);
    fs.writeFileSync(plano, '- [ ] Mudar `src/nao.js`. Prova: `npm test`\n');
    const sujo = cli([plano]);
    assert.strictEqual(sujo.status, 1, sujo.stdout);
    assert.match(sujo.stdout, /caminho-inexistente/);
    assert.match(sujo.stdout, /linha 1/);
    const json = cli([plano, '--json']);
    assert.strictEqual(JSON.parse(json.stdout).achados[0].valor, 'src/nao.js');
    const semArg = cli([]);
    assert.strictEqual(semArg.status, 2);
    assert.match(semArg.stderr, /^uso: node revisar-plano\.js <plano\.md> \[--json\]/);
    const naoExiste = cli([path.join(raiz, 'nao.md')]);
    assert.strictEqual(naoExiste.status, 2);
    assert.match(naoExiste.stderr, /nao consegui ler o plano .*: o arquivo nao existe/);
    // fora de um repositorio git, a lista do git falta: o comando avisa, em vez de seguir calado
    assert.match(sujo.stderr, /sem a lista do git/);
    assert.match(sujo.stdout, /corrija o plano e rode de novo/);
  });
});

test('C2: num repositorio git, o nome curto com acento se acha pela lista do git', () => {
  projeto((raiz) => {
    const git = function (args) {
      return spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t'].concat(args), { cwd: raiz, encoding: 'utf8' });
    };
    git(['init', '-q']);
    fs.mkdirSync(path.join(raiz, 'docs', 'fluxo'), { recursive: true });
    fs.writeFileSync(path.join(raiz, 'docs', 'fluxo', 'ação.md'), '');
    git(['add', '.']);
    // o plano irmao fica fora da lista do git (sem add): so a pasta do plano o acha
    fs.writeFileSync(path.join(raiz, 'docs', 'irmao.md'), '');
    fs.writeFileSync(path.join(raiz, 'docs', 'plano.md'),
      '- [ ] Revisar `ação.md` e o `irmao.md`. Prova: `npm test`\n');
    const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'revisar-plano.js'), 'docs/plano.md', '--json'],
      { cwd: raiz, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const j = JSON.parse(r.stdout);
    assert.deepStrictEqual([j.citados, j.conferidos, j.achados.length], [3, 3, 0], r.stdout);
    assert.doesNotMatch(r.stderr, /sem a lista do git/);
  });
});
