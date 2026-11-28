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
      '- [ ] Mudar `src/vendas.js` -> `totalComDesconto`: o desconto em porcentagem. Prova: `npm test` (R1)',
      '- [ ] Criar `src/recibo.js` (novo), com o formato em reais. Prova: `node --test` (R2)',
      '- [x] Rodar `node scripts/gerar.js` antes (feito)',
      '',
      '- **R1:** o desconto sai em porcentagem.',
      'R2. O recibo sai em reais.',
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
      '- [ ] Mudar `src/vemdas.js` para somar o frete. Prova: `npm test` (R1)',
      '- [ ] Em `src/vendas.js` -> `totalSemDesconto`, tirar o desconto. Prova: `npm test` (R1)',
      '- [ ] Rodar `node scripts/apagar.js`. Prova: `npm run verificar` (R1)',
      '- [ ] Ajustar o README sem dizer como provar',
      '',
      'R1: o frete entra no total.',
      ''
    ].join('\n');
    const r = lib.conferir(plano, raiz);
    assert.deepStrictEqual(tipos(r), [
      'caixa-sem-prova:- [ ] Ajustar o README sem dizer como provar',
      'caminho-inexistente:src/vemdas.js',
      'comando-sem-script:node scripts/apagar.js',
      'comando-sem-script:npm run verificar',
      'passo-sem-requisito:- [ ] Ajustar o README sem dizer como provar',
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
      '- [ ] Novo arquivo `src/frete.js`, criado do zero. Prova: `npm test` (R1)',
      'R1 - o frete tem arquivo proprio.',
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

test('P6 item 3 (s378): o comando node de um teste que a linha diz que sera criado nao e achado; sem criar, e o npm, seguem', () => {
  projeto((raiz) => {
    const plano = [
      '- [ ] Teste vermelho antes, a criar. Prova: `node --test test/frete.test.js` (R1)',
      '- [ ] Rodar o gerador. Prova: `node scripts/gerar.js` (R1)',
      '- [ ] Rodar o teste do recibo. Prova: `node --test test/recibo.test.js` (R1)',
      '- [ ] Script do npm, a criar. Prova: `npm run verificar` (R1)',
      // o "new" dentro das crases nao diz que o script sera criado: so o texto fora delas diz
      '- [ ] Rodar o executor. Prova: `node scripts/new-runner.js` (R1)',
      'R1: o frete tem teste.',
      ''
    ].join('\n');
    const r = lib.conferir(plano, raiz);
    assert.deepStrictEqual(tipos(r), [
      'comando-sem-script:node --test test/recibo.test.js',
      'comando-sem-script:node scripts/new-runner.js',
      'comando-sem-script:npm run verificar'
    ], JSON.stringify(r.achados));
    // o comando do teste a criar conta como conferido, como o caminho a criar
    assert.strictEqual(r.conferidos, r.citados - 3, JSON.stringify(r));
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
      '  com prova pelo `npm test` depois da edicao, para o R1',
      '- [x] Caixa ja feita, sem prova escrita',
      '- [ ] Outra sem prova',
      '  e sem comando na continuacao (R1)',
      '',
      '## R1: o desconto novo vale',
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
    fs.writeFileSync(plano, '- [ ] Mudar `src/vendas.js`. Prova: `npm test` (R1)\nR1: o desconto vale.\n');
    const limpo = cli([plano]);
    assert.strictEqual(limpo.status, 0, limpo.stdout + limpo.stderr);
    assert.match(limpo.stdout, /nenhum achado/);
    fs.writeFileSync(plano, '- [ ] Mudar `src/nao.js`. Prova: `npm test` (R1)\nR1: o desconto vale.\n');
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
      '- [ ] Revisar `ação.md` e o `irmao.md`. Prova: `npm test` (R1)\nR1: a acao esta revisada.\n');
    const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'revisar-plano.js'), 'docs/plano.md', '--json'],
      { cwd: raiz, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const j = JSON.parse(r.stdout);
    assert.deepStrictEqual([j.citados, j.conferidos, j.achados.length], [3, 3, 0], r.stdout);
    assert.doesNotMatch(r.stderr, /sem a lista do git/);
  });
});

// H9-13 (D881): os requisitos numerados sao obrigatorios no plano com passos
test('H9-13: R sem passo, passo sem R, R inexistente e plano sem R viram achado, com a linha', () => {
  projeto((raiz) => {
    const plano = [
      '# Plano',
      '- **R1:** o desconto sai em porcentagem.',
      '- R2: o recibo sai em reais.',
      '### R3. O frete entra no total.',
      '',
      '- [ ] Mudar `src/vendas.js`. Prova: `npm test` (R1)',
      '- [ ] Ajustar o recibo. Prova: `npm test`',
      '- [x] Passo feito que cita o R2',
      '- [ ] Passo que cita o R9. Prova: `npm test`',
      '```md',
      '- [ ] exemplo no bloco, sem R. Prova: `npm test`',
      'R4: definicao no bloco nao vale',
      '```',
      ''
    ].join('\n');
    const r = lib.conferir(plano, raiz);
    const req = r.achados.filter(function (a) { return /requisit/.test(a.tipo); })
      .map(function (a) { return a.tipo + ':' + a.valor + '@' + a.linha; });
    assert.deepStrictEqual(req, ['requisito-sem-passo:R3@4', 'passo-sem-requisito:- [ ] Ajustar o recibo. Prova: `npm test`@7', 'requisito-inexistente:R9@9'],
      JSON.stringify(r.achados));
    // o R2, citado so pela caixa feita, tem passo e nao sai como sem passo (fora da lista acima); e o bloco de codigo
    // nao gera achado de outro tipo
    assert.deepStrictEqual(r.achados.filter(function (a) { return !/requisit/.test(a.tipo); }), [], JSON.stringify(r.achados));
    // o plano com caixas e sem R nenhum
    const sem =lib.conferir('# Plano\n\n- [ ] Mudar `src/vendas.js`. Prova: `npm test`\n- [x] Outro\n', raiz);
    assert.deepStrictEqual(tipos(sem), ['plano-sem-requisitos:R<n>'], JSON.stringify(sem.achados));
    assert.strictEqual(sem.achados[0].linha, 3, 'o achado aponta a primeira caixa');
    // texto sem caixa e sem R nao e plano de passos: nada a cobrar
    assert.deepStrictEqual(lib.conferir('Notas soltas sobre `src/vendas.js`.\n', raiz).achados, []);
    // "R2D2" e "PR12" nao citam requisito
    const falso = lib.requisitos('R1: vale\n- [ ] o R2D2 e o PR12 (R1)\n');
    assert.deepStrictEqual(falso.caixas[0].refs, ['1']);
    assert.deepStrictEqual(Object.keys(falso.definidos), ['1']);
    // o R<n> dentro de crase e caminho ou comando, nao citacao
    assert.deepStrictEqual(lib.requisitos('R1: vale\n- [ ] R1: edite `docs/R2.md` `npm test`\n').caixas[0].refs, ['1']);
    // "R2.0 ..." e "R2-D2 ..." nao definem o R2; "R3 - ..." e "R4. ..." (com espaco) definem
    assert.deepStrictEqual(Object.keys(lib.requisitos('R2.0 do modulo sai em maio\nR2-D2 e um robo\nR3 - vale\nR4. vale\n').definidos), ['3', '4']);
    // a citacao segue a mesma regra: "R2.0" e "R2-D2" nao citam o R2; "R1." e "R3," no fim da frase citam
    assert.deepStrictEqual(lib.requisitos('R1: vale\n- [ ] subir para R2.0 e o R2-D2, cumpre R1. e R3, `npm test`\n').caixas[0].refs, ['1', '3']);
    // a faixa "R4-R6" cita as duas pontas (o intervalo nao se expande)
    assert.deepStrictEqual(lib.requisitos('R1: vale\n- [ ] cobre R4-R6 `npm test`\n').caixas[0].refs, ['4', '6']);
    // a definicao em lista numerada ou em citacao tambem vale
    assert.deepStrictEqual(lib.requisitos('1. R1: o login expira\n2) **R2:** o recibo\n> R3: citado\n').definidos, { 1: 1, 2: 2, 3: 3 });
    // R01 e R1 sao o mesmo requisito, na definicao e na citacao
    const zero = lib.requisitos('R01: o login expira\n- [ ] cumpre R1 `npm test`\n- [ ] cumpre R001 `npm test`\n');
    assert.deepStrictEqual(zero.definidos, { 1: 1 });
    assert.deepStrictEqual(zero.caixas.map((c) => c.refs), [['1'], ['1']]);
    // a segunda definicao do mesmo numero vira achado, com a linha da primeira no motivo
    const dup = lib.conferir('# Plano\nR1: o login expira\nR1: exportar CSV\n\n- [ ] Mudar `src/vendas.js`. Prova: `npm test` (R1)\n', raiz);
    const achDup = dup.achados.filter((a) => a.tipo === 'requisito-duplicado');
    assert.deepStrictEqual(achDup.map((a) => a.valor + '@' + a.linha), ['R1@3'], JSON.stringify(dup.achados));
    assert.match(achDup[0].motivo, /definido na linha 2/);
  });
});
