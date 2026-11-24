'use strict';
// H6d (15.2, D896): o plano por fatia - scripts/lib/fatia.js e o plano.js --fatia.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fatia = require('../scripts/lib/fatia.js');
const hc = require('../scripts/lib/handoff-curto.js');

const PLANO_JS = path.join(__dirname, '..', 'scripts', 'plano.js');

const PLANO = [
  '# Plano',                            // 1
  '',                                   // 2
  '## Decisoes',                        // 3
  '- D1 vale o disco',                  // 4
  '',                                   // 5
  '## Fase A',                          // 6
  '',                                   // 7
  '- [x] **A1** feito',                 // 8
  '- [ ] **A2** fazer',                 // 9
  '  com a segunda linha',              // 10
  '',                                   // 11
  '  - [ ] A2a a filha',                // 12
  '- [ ] **A3** depois',                // 13
  '',                                   // 14
  '## Fase B',                          // 15
  '',                                   // 16
  '| Item | O que |',                    // 17
  '|---|---|',                          // 18
  '| **B1** | a linha da tabela |',     // 19
  '',                                   // 20
  '### B2 o titulo',                    // 21
  'texto do B2',                        // 22
  '#### B2.1 sub',                      // 23
  'texto do sub',                       // 24
  '### B3 outro',                       // 25
  '- [ ] H6d o item longo',             // 26
  '- [ ] H6 o item curto',              // 27
  '```',                                // 28
  '- [ ] **Z9** dentro da cerca',       // 29
  '```'                                 // 30
].join('\n');

function tmp(arquivos) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-fatia-'));
  fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
  for (const [rel, txt] of Object.entries(arquivos || {})) {
    const alvo = path.join(dir, rel);
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, txt, 'utf8');
  }
  return dir;
}

// Sem a sessao do Claude Code que roda a suite: a frente dela nao pode decidir o plano da pasta temporaria.
function rodar(dir, args) {
  const env = Object.assign({}, process.env, { CLAUDE_CODE_SESSION_ID: '', CLAUDE_SESSION_ID: '',
    SWORN_TMP: path.join(dir, '.tmp-estado') });
  return spawnSync(process.execPath, [PLANO_JS].concat(args), { cwd: dir, encoding: 'utf8', env: env, timeout: 30000 });
}

test('H6d fatia: o cabecalho acaba no titulo da secao da 1a caixa', () => {
  const f = fatia.fatiar(PLANO, null);
  assert.deepStrictEqual([f.cabecalho.de, f.cabecalho.ate], [1, 5]);
  assert.ok(f.cabecalho.texto.indexOf('- D1 vale o disco') !== -1, f.cabecalho.texto);
  assert.ok(f.cabecalho.texto.indexOf('## Fase A') === -1, 'o titulo da secao da caixa e do item, nao do cabecalho');
  assert.strictEqual(f.linhas, 30);
});

test('H6d fatia: plano sem titulo antes da 1a caixa corta na propria caixa; sem caixa, o cabecalho e o arquivo', () => {
  const f = fatia.fatiar('intro\n- [ ] T1 a\n', null);
  assert.deepStrictEqual([f.cabecalho.de, f.cabecalho.ate, f.cabecalho.texto], [1, 1, 'intro']);
  const g = fatia.fatiar('# So texto\nnada a marcar\n', null);
  assert.strictEqual(g.item, null);
  // a quebra do fim nao abre uma 3a linha (revisao R1, correcao/borda): o arquivo tem 2, como no Read e no wc -l
  // (so a ultima quebra sai: 'a\n\n' tem a linha 'a' e uma em branco)
  assert.deepStrictEqual([g.cabecalho.de, g.cabecalho.ate, g.linhas], [1, 2, 2]);
  assert.deepStrictEqual([fatia.fatiar('', null).linhas, fatia.fatiar('a\r\nb\r\n', null).linhas,
    fatia.fatiar('a\n\n', null).linhas], [0, 2, 2]);
});

test('H6d fatia: sem id, a proxima caixa aberta; o pai com filha aberta da a filha', () => {
  const f = fatia.fatiar(PLANO, null);
  assert.strictEqual(f.item.tipo, 'proxima');
  assert.deepStrictEqual([f.item.de, f.item.ate, f.item.texto], [12, 12, '  - [ ] A2a a filha']);
  assert.deepStrictEqual(f.contexto, { linha: 6, texto: '## Fase A' });
});

test('H6d fatia: a caixa pelo id leva a continuacao e as filhas, ate a linha de recuo igual', () => {
  const f = fatia.fatiar(PLANO, 'A2');
  assert.strictEqual(f.item.tipo, 'caixa');
  assert.deepStrictEqual([f.item.de, f.item.ate], [9, 12]);
  assert.ok(f.item.texto.endsWith('  - [ ] A2a a filha'), f.item.texto);
  assert.ok(f.item.texto.indexOf('A3') === -1, f.item.texto);
});

test('H6d fatia: o id e palavra inteira - H6 nao casa H6d, e o negrito casa', () => {
  assert.strictEqual(fatia.fatiar(PLANO, 'H6').item.de, 27);
  assert.strictEqual(fatia.fatiar(PLANO, 'H6d').item.de, 26);
  assert.strictEqual(fatia.fatiar(PLANO, 'A3').item.de, 13);
  assert.strictEqual(fatia.fatiar('# P\n## S\n- [ ] 15.20 x\n', '15.2').item, null, '15.2 nao casa 15.20');
  assert.strictEqual(fatia.fatiar('# P\n## S\n- [ ] 15.2x\n- [ ] 15.2_b\n- [ ] __15.2__ y\n', '15.2').item.de, 5, 'o __ e negrito');
  assert.strictEqual(fatia.fatiar('# P\n## a_H6 x\n## Fase __H6__\n', 'H6').item.de, 3, 'no titulo tambem; a_H6 nao');
});

test('H6d fatia: o titulo pelo id vai ate o proximo titulo de nivel igual ou maior', () => {
  const f = fatia.fatiar(PLANO, 'B2');
  assert.strictEqual(f.item.tipo, 'titulo');
  assert.deepStrictEqual([f.item.de, f.item.ate], [21, 24], 'o #### fica dentro, o ### seguinte fora');
  assert.strictEqual(f.contexto, null, 'o titulo ja e a secao');
  assert.deepStrictEqual([fatia.fatiar(PLANO, 'Fase A').item.de, fatia.fatiar(PLANO, 'Fase A').item.ate], [6, 14]);
});

test('H6d fatia: a linha de tabela pela 1a celula', () => {
  const f = fatia.fatiar(PLANO, 'B1');
  assert.strictEqual(f.item.tipo, 'linha');
  assert.deepStrictEqual([f.item.de, f.item.ate, f.item.texto], [19, 19, '| **B1** | a linha da tabela |']);
  assert.deepStrictEqual(f.contexto, { linha: 15, texto: '## Fase B' });
  const m = fatia.fatiar('# P\n## Mapa\n| M1 | x |\n## S\n- [ ] T1\n', 'M1');
  assert.deepStrictEqual([m.item.de, m.contexto], [3, { linha: 2, texto: '## Mapa' }], 'a linha do cabecalho tem secao tambem');
});

test('H6d fatia: caixa dentro de bloco de codigo nao conta', () => {
  assert.strictEqual(fatia.fatiar(PLANO, 'Z9').item, null);
  const g = fatia.fatiar('# P\n## S\n```\n- [ ] dentro\n```\n- [x] fora feito\n', null);
  assert.strictEqual(g.item, null, 'a unica aberta esta na cerca');
  assert.deepStrictEqual([g.cabecalho.de, g.cabecalho.ate], [1, 1], 'o titulo da cerca nao e o fim do cabecalho');
});

test('H6d fatia (revisao R1, borda): a cerca so fecha com o mesmo caractere, comprimento igual ou maior e nada depois', () => {
  // ```` com um exemplo ```js dentro: o ```js e o ``` sao conteudo, a caixa do exemplo nao conta
  const plano = '# P\n## S\n````md\n```js\n- [ ] H9 exemplo\n```\n````\n- [ ] H8 de verdade\n';
  assert.strictEqual(fatia.fatiar(plano, 'H9').item, null, 'a caixa do exemplo esta na cerca');
  assert.strictEqual(fatia.fatiar(plano, null).item.de, 8, 'a proxima aberta e a de fora');
  assert.strictEqual(hc.caixaAberta(plano).linha, 8, 'o handoff (caixaAberta) usa a mesma regra');
  // ~~~ nao fecha ```, e ``` com texto depois nao fecha
  const misto = '# P\n## S\n```\n~~~\n- [ ] Q1 dentro\n``` nao fecha\n```\n- [ ] Q2 fora\n';
  assert.strictEqual(fatia.fatiar(misto, 'Q1').item, null);
  assert.strictEqual(fatia.fatiar(misto, null).item.de, 8);
  assert.strictEqual(hc.caixaAberta(misto).linha, 8);
  // cerca mais longa fecha a mais curta
  assert.strictEqual(fatia.fatiar('# P\n## S\n```\n- [ ] R1 dentro\n`````\n- [ ] R2 fora\n', null).item.de, 6);
});

test('H6d fatia (revisao R2, borda): ```x``` no comeco da linha e codigo inline, nao abre cerca', () => {
  // a info string de uma cerca de crase nao tem crase; com til, tem (~~~ a`b abre)
  const plano = '# P\n## S\n```npm test``` roda tudo\n- [ ] T1 visivel\n';
  assert.strictEqual(fatia.fatiar(plano, 'T1').item.de, 4, 'a caixa depois do codigo inline conta');
  assert.strictEqual(fatia.fatiar(plano, null).item.de, 4);
  assert.strictEqual(hc.caixaAberta(plano).linha, 4, 'o handoff (caixaAberta) usa a mesma regra');
  assert.deepStrictEqual(fatia.dentroDeCerca(['```npm``` x', '~~~ a`b', '- [ ] T2', '~~~']), [false, true, true, true]);
});

test('H6d fatia: id repetido abre a 1a e o texto diz as linhas das outras', () => {
  const plano = '# P\n## S\n- [ ] X1 a\n- [x] X1 b\n- [x] X1 c\n';
  const f = fatia.fatiar(plano, 'X1');
  assert.deepStrictEqual([f.item.de, f.item.outras], [3, [4, 5]]);
  const t = fatia.texto('p.md', f, 'X1');
  assert.ok(t.indexOf('Atencao: o id X1 abre 3 caixas; aqui vai a da linha 3, e as outras estao nas linhas 4, 5. ' +
    'Para outra, passe um id que so ela tenha.') !== -1, t);
  assert.ok(fatia.texto('p.md', fatia.fatiar(PLANO, 'A2'), 'A2').indexOf('Atencao') === -1, 'id unico sem aviso');
  assert.deepStrictEqual(fatia.fatiar(PLANO, null).item.outras, [], 'a proxima aberta nao e repetida');
  // mais de 10 outras: as 10 primeiras e quantas sobram
  const muitas = '# P\n## S\n' + Array.from({ length: 13 }, (_, i) => '- [ ] X2 ' + i).join('\n') + '\n';
  const tm = fatia.texto('p.md', fatia.fatiar(muitas, 'X2'), 'X2');
  assert.ok(tm.indexOf('nas linhas 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 e mais 2.') !== -1, tm);
});

test('H6d fatia: o teto corta em linha inteira e diz as linhas de fora com o offset do Read', () => {
  const linhas = ['# P', '## S', '- [ ] T1 grande'];
  for (let i = 0; i < 10; i++) linhas.push('  ' + 'x'.repeat(20));
  const f = fatia.fatiar(linhas.join('\n'), 'T1', 50);
  assert.deepStrictEqual([f.item.de, f.item.ate, f.item.cortadoEm], [3, 13, 5]);
  assert.strictEqual(f.item.texto.split('\n').length, 2, 'entram as linhas 3 e 4 (15 + 23 caracteres com a quebra)');
  const t = fatia.texto('p.md', f, 'T1');
  assert.ok(t.indexOf('[cortado no teto de 50 caracteres: as linhas 5-13 ficaram de fora; leia-as no arquivo com Read (offset 5)') !== -1,
    'o aviso diz o teto usado, nao o padrao: ' + t);
  assert.strictEqual(fatia.fatiar(PLANO, 'A2').item.cortadoEm, null);
  // a linha que enche o teto exato entra inteira, sem corte
  const exata = fatia.fatiar('# P\n## S\n- [ ] T2 ' + 'y'.repeat(41), 'T2', 50);
  assert.deepStrictEqual([exata.item.cortadoEm, exata.item.parcial, Array.from(exata.item.texto).length], [null, false, 50]);
});

test('H6d fatia (revisao R1, estados/borda): a 1a linha que sozinha passa do teto sai cortada no teto e avisada', () => {
  const enorme = '- [ ] T1 ' + 'z'.repeat(300);
  const f = fatia.fatiar('# P\n## S\n' + enorme + '\n  continuacao\n', 'T1', 50);
  assert.strictEqual(Array.from(f.item.texto).length, 50, 'o texto nao passa do teto');
  assert.strictEqual(f.item.texto, enorme.slice(0, 50));
  assert.deepStrictEqual([f.item.de, f.item.ate, f.item.cortadoEm, f.item.parcial], [3, 4, 3, true]);
  const t = fatia.texto('p.md', f, 'T1');
  assert.ok(t.indexOf('[cortado no teto de 50 caracteres: as linhas 3-4 ficaram de fora (a 3 saiu so ate o teto, acima); ' +
    'leia-as no arquivo com Read (offset 3) se precisar]') !== -1, t);
  // unicode: o teto conta caractere, nao unidade UTF-16
  const emoji = fatia.fatiar('# P\n## S\n- [ ] T3 ' + '😀'.repeat(100), 'T3', 20);
  assert.strictEqual(Array.from(emoji.item.texto).length, 20);
  assert.ok(!/[\uD800-\uDBFF]$/.test(emoji.item.texto), 'nao corta no meio de um par substituto');
  // o cabecalho tambem: uma linha so, enorme, antes da 1a caixa
  const cab = fatia.fatiar('w'.repeat(100) + '\n## S\n- [ ] C1\n', null, 30);
  assert.deepStrictEqual([cab.cabecalho.cortadoEm, cab.cabecalho.parcial, cab.cabecalho.texto.length], [1, true, 30]);
});

test('H6d fatia: o texto diz o plano, as faixas e a secao do item; plano sem caixa aberta sai so com o cabecalho', () => {
  const t = fatia.texto('docs/p.md', fatia.fatiar(PLANO, 'B1'), 'B1');
  assert.ok(t.startsWith('sworn: fatia do plano docs/p.md (30 linhas): o cabecalho (linhas 1-5) e o item B1 (linhas 19-19).'), t);
  assert.ok(t.indexOf('--- o item B1 (linhas 19-19), na secao "## Fase B" (linha 15) ---\n| **B1**') !== -1, t);
  const v = fatia.texto('p.md', fatia.fatiar('# P\n## S\n- [x] T1 feito\n', null), null);
  assert.ok(v.indexOf('o plano nao tem item sem marcar; sai so o cabecalho (linhas 1-1). Para ler um item ja marcado, ' +
    'passe o id dele: --fatia <id>.') !== -1, v);
  assert.ok(v.indexOf('--- cabecalho (linhas 1-1) ---\n# P\n') !== -1, v);
});

test('H6d plano.js --fatia: --plano, id, id que nao existe, --fatia duas vezes', () => {
  const dir = tmp({ 'docs/p.md': PLANO });
  try {
    const r = rodar(dir, ['--fatia', '--plano', 'docs/p.md']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.indexOf('o proximo item sem marcar (linhas 12-12)') !== -1, r.stdout);
    const s = rodar(dir, ['--fatia', 'B2', '--plano', 'docs/p.md']);
    assert.strictEqual(s.status, 0, s.stderr);
    assert.ok(s.stdout.indexOf('--- o item B2 (linhas 21-24) ---\n### B2 o titulo') !== -1, s.stdout);
    const n = rodar(dir, ['--fatia', 'ZZ9', '--plano', 'docs/p.md']);
    assert.strictEqual(n.status, 1);
    assert.strictEqual(n.stdout, '');
    assert.ok(n.stderr.indexOf('nenhuma caixa (- [ ] ZZ9), titulo nem linha de tabela do plano docs/p.md comeca com o id ZZ9.') !== -1, n.stderr);
    const d = rodar(dir, ['--fatia', '--fatia', '--plano', 'docs/p.md']);
    assert.strictEqual(d.status, 1);
    assert.match(d.stderr, /--fatia aparece mais de uma vez/);
    const lido = rodar(dir, ['--fatia', '--plano', 'docs/sumido.md']);
    assert.strictEqual(lido.status, 1);
    assert.match(lido.stderr, /nao consegui ler o plano docs\/sumido\.md/);
    assert.ok(lido.stderr.indexOf('Confira o caminho: o --plano e relativo a pasta de onde voce rodou.') !== -1, lido.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('H6d plano.js --fatia (revisao R1): --plano sem --fatia, flag junto, id vazio e sobra na linha saem 1 com o motivo', () => {
  const dir = tmp({ 'docs/p.md': PLANO });
  try {
    for (const args of [['--plano', 'docs/p.md'], ['--texto', '--plano', 'docs/p.md']]) {
      const r = rodar(dir, args);
      assert.strictEqual(r.status, 1, args.join(' '));
      assert.strictEqual(r.stdout, '');
      assert.ok(r.stderr.startsWith('ERRO: --plano so vale junto de --fatia'), r.stderr);
    }
    const j = rodar(dir, ['--fatia', '--plano', 'docs/p.md', '--abrir', 'docs/p.md']);
    assert.strictEqual(j.status, 1);
    assert.ok(j.stderr.indexOf('--fatia nao se combina com --abrir; rode cada um num comando.') !== -1, j.stderr);
    assert.ok(!fs.existsSync(path.join(dir, '.claude', 'sworn', 'plano-ativo.json')), 'o --abrir nao rodou');
    const t = rodar(dir, ['--texto', '--proxima-decisao', 'd.md', '--fatia']);
    assert.ok(t.stderr.indexOf('--fatia nao se combina com --proxima-decisao nem --texto;') !== -1, t.stderr);
    const v = rodar(dir, ['--fatia', '  ', '--plano', 'docs/p.md']);
    assert.strictEqual(v.status, 1);
    assert.match(v.stderr, /o id depois de --fatia veio vazio/);
    const s = rodar(dir, ['--fatia', '--plano', 'docs/p.md', 'B2']);
    assert.strictEqual(s.status, 1);
    assert.strictEqual(s.stdout, '', 'o B2 solto nao vira a proxima caixa calada');
    assert.ok(s.stderr.indexOf('B2 sobrou na linha: nao e opcao do plano.js, e o id do item vai logo depois de --fatia') !== -1, s.stderr);
    assert.ok(!s.stderr.endsWith('\n\n'), 'o USO nao deixa linha em branco no fim');
    const f = rodar(dir, ['--fatia', '--sesao', 'x', '--plano', 'docs/p.md']);
    assert.strictEqual(f.status, 1);
    assert.match(f.stderr, /^sworn: --sesao sobrou na linha/, 'flag errada nao vira o id');
    const ok = rodar(dir, ['--sessao', 'abc', '--fatia', ' B2 ', '--plano', 'docs/p.md']);
    assert.strictEqual(ok.status, 0, ok.stderr);
    assert.ok(ok.stdout.indexOf('--- o item B2 (linhas 21-24) ---') !== -1, 'o valor das flags e o id aparado passam');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('H6d plano.js --fatia (revisao R1): varias frentes listadas, escopo que nao se le e frente sem plano dizem a causa', () => {
  const frente = (nome, plano) => '# Escopo\n**Objetivo:** ' + nome + '. Plano: ' + plano + '.\n## Dentro\n- x/**\n';
  const dir = tmp({ 'docs/a.md': PLANO, 'docs/b.md': PLANO,
    '.claude/sworn/escopos/fa.md': frente('A', 'docs/a.md'), '.claude/sworn/escopos/fb.md': frente('B', 'docs/b.md') });
  try {
    const v = rodar(dir, ['--fatia']);
    assert.strictEqual(v.status, 1);
    assert.ok(v.stderr.indexOf('mais de uma frente tem plano (docs/a.md, docs/b.md) e esta sessao nao esta ligada a nenhuma.') !== -1, v.stderr);
    fs.mkdirSync(path.join(dir, '.claude', 'sworn', 'escopos', 'fd.md'));
    const vi = rodar(dir, ['--fatia']);
    assert.ok(vi.stderr.indexOf('(docs/a.md, docs/b.md, .claude/sworn/escopos/fd.md (escopo ilegivel))') !== -1, vi.stderr);
    fs.mkdirSync(path.join(dir, '.claude', 'sworn', 'escopo.md'));
    const i = rodar(dir, ['--fatia']);
    assert.strictEqual(i.status, 1);
    assert.ok(i.stderr.indexOf('nao consegui ler o escopo .claude/sworn/escopo.md, onde fica a linha Plano:.') !== -1, i.stderr);
    fs.rmdirSync(path.join(dir, '.claude', 'sworn', 'escopo.md'));
    // a sessao ligada a uma frente sem a linha Plano:: a causa e a frente, nao "nenhum plano"
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'escopos', 'fc.md'), '# Escopo\n**Objetivo:** C, sem plano.\n## Dentro\n- x/**\n');
    const tmpEstado = path.join(dir, '.tmp-estado');
    const antes = process.env.SWORN_TMP;
    process.env.SWORN_TMP = tmpEstado;
    delete require.cache[require.resolve('../scripts/lib/estado.js')];
    try { require('../scripts/lib/estado.js').gravar('sess-fc', { frente: 'fc' }); }
    finally { if (antes === undefined) delete process.env.SWORN_TMP; else process.env.SWORN_TMP = antes; }
    const env = Object.assign({}, process.env, { CLAUDE_CODE_SESSION_ID: '', CLAUDE_SESSION_ID: '', SWORN_TMP: tmpEstado });
    const c = spawnSync(process.execPath, [PLANO_JS, '--fatia', '--sessao', 'sess-fc'], { cwd: dir, encoding: 'utf8', env: env, timeout: 30000 });
    assert.strictEqual(c.status, 1, c.stdout);
    assert.ok(c.stderr.indexOf('a frente fc nao tem a linha Plano: no Objetivo.') !== -1, c.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('H6d plano.js --fatia: o plano vem do plano-ativo.json; em branco ou fora do projeto, sai 1 com o --plano', () => {
  const dir = tmp({ 'docs/p.md': PLANO, '.claude/sworn/plano-ativo.json': JSON.stringify({ arquivo: 'docs/p.md', sessionId: 's' }) });
  try {
    const r = rodar(dir, ['--fatia', 'A3']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.startsWith('sworn: fatia do plano docs/p.md'), r.stdout);
    // revisao R1 (borda): o teste aparava e o caminho nao; espaco nas pontas sai do caminho tambem
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'plano-ativo.json'), JSON.stringify({ arquivo: ' docs/p.md ', sessionId: 's' }));
    const e = rodar(dir, ['--fatia', 'A3']);
    assert.strictEqual(e.status, 0, e.stderr);
    assert.ok(e.stdout.startsWith('sworn: fatia do plano docs/p.md ('), e.stdout);
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'plano-ativo.json'), JSON.stringify({ arquivo: ' ', sessionId: 's' }));
    const b = rodar(dir, ['--fatia']);
    assert.strictEqual(b.status, 1);
    assert.ok(b.stderr.indexOf('.claude/sworn/plano-ativo.json existe mas nao diz o plano') !== -1, b.stderr);
    assert.ok(b.stderr.indexOf('Passe o plano: --fatia [<id>] --plano <caminho do plano>.') !== -1, b.stderr);
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'plano-ativo.json'), JSON.stringify({ arquivo: '../fora.md', sessionId: 's' }));
    const f = rodar(dir, ['--fatia']);
    assert.strictEqual(f.status, 1);
    assert.match(f.stderr, /fica fora do projeto e nao foi lido/);
    assert.ok(f.stderr.indexOf('Passe o plano: --fatia [<id>] --plano <caminho do plano>.') !== -1, f.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('H6d plano.js --fatia: sem plano-ativo.json, o Plano: do escopo; sem nenhum, sai 1; plano todo feito sai 0', () => {
  const dir = tmp({ 'plano.md': PLANO, '.claude/sworn/escopo.md': '# Escopo\n**Objetivo:** X. Plano: plano.md.\n## Dentro\n- x/**\n' });
  const vazio = tmp({});
  try {
    const r = rodar(dir, ['--fatia']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.startsWith('sworn: fatia do plano plano.md'), r.stdout);
    const n = rodar(vazio, ['--fatia']);
    assert.strictEqual(n.status, 1);
    assert.match(n.stderr, /nenhum plano achado na raiz do projeto/);
    fs.writeFileSync(path.join(dir, 'plano.md'), '# P\n## S\n- [x] T1 feito\n');
    const v = rodar(dir, ['--fatia']);
    assert.strictEqual(v.status, 0, v.stderr);
    assert.match(v.stdout, /o plano nao tem item sem marcar/);
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'escopo.md'), '# Escopo\n**Objetivo:** X. Plano: ../fora.md.\n## Dentro\n- x/**\n');
    const fora = rodar(dir, ['--fatia']);
    assert.strictEqual(fora.status, 1);
    assert.match(fora.stderr, /o plano \.\.\/fora\.md fica fora do projeto e nao foi lido/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(vazio, { recursive: true, force: true });
  }
});

// A reinjecao depois da compactacao e o handoff apontam para a fatia.
function comRein(fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-rein-fatia-'));
  const antes = process.env.SWORN_TMP;
  process.env.SWORN_TMP = base;
  for (const m of ['../scripts/lib/estado.js', '../scripts/lib/reinjecao.js']) delete require.cache[require.resolve(m)];
  try { fn(require('../scripts/lib/reinjecao.js')); }
  finally {
    if (antes === undefined) delete process.env.SWORN_TMP; else process.env.SWORN_TMP = antes;
    fs.rmSync(base, { recursive: true, force: true });
  }
}

test('H6d reinjecao: o bloco do plano ativo traz o comando da fatia', () => {
  comRein((rein) => {
    const dir = tmp({ 'docs/p.md': '### Tarefa 1: x\n- [ ] a\n', '.claude/sworn/plano-ativo.json': JSON.stringify({ arquivo: 'docs/p.md', sessionId: 's1' }) });
    try {
      const t = rein.montar(dir, 's1', 'compact') || '';
      assert.ok(t.indexOf('RELEIA o texto dessa tarefa NO ARQUIVO') !== -1, t);
      assert.match(t, /Leia so o cabecalho e a tarefa: node "[^"]*\/scripts\/plano\.js" --fatia --plano "docs\/p\.md"/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

test('H6d reinjecao: sem plano-ativo.json, o Plano: do escopo entra com a fatia; plano-ativo.json presente nao cai nele', () => {
  comRein((rein) => {
    const escopo = '# Escopo\n**Objetivo:** X. Plano: plano.md.\n## Dentro\n- x/**\n';
    const dir = tmp({ 'plano.md': PLANO, '.claude/sworn/escopo.md': escopo });
    try {
      const t = rein.montar(dir, 's1', 'compact') || '';
      assert.ok(t.indexOf('ESTADO - plano em execucao') !== -1, t);
      assert.ok(t.indexOf('Plano: plano.md') !== -1, t);
      assert.match(t, /--fatia --plano "plano\.md"/);
      fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'plano-ativo.json'), JSON.stringify({ arquivo: '', sessionId: 's1' }));
      const b = rein.montar(dir, 's1', 'compact') || '';
      assert.ok(b.indexOf('Plano ativo ilegivel') !== -1, b);
      assert.ok(b.indexOf('--fatia') === -1, 'o plano-ativo.json ilegivel manda; nao troca pelo do escopo: ' + b);
      fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'plano-ativo.json'), '{ nao e json');
      const j = rein.montar(dir, 's1', 'compact') || '';
      assert.ok(j.indexOf('--fatia') === -1, 'plano-ativo.json quebrado tambem nao cai no do escopo: ' + j);
      assert.ok(j.indexOf('ESTADO - escopo declarado') !== -1, 'o resto do estado segue saindo: ' + j);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

test('H6d reinjecao (revisao R1, borda): sem plano-ativo.json, plano todo marcado nao manda rodar a fatia', () => {
  comRein((rein) => {
    const escopo = '# Escopo\n**Objetivo:** X. Plano: feito.md.\n## Dentro\n- x/**\n';
    const dir = tmp({ 'feito.md': '# P\n## S\n- [x] A1 feito\n', '.claude/sworn/escopo.md': escopo });
    try {
      const t = rein.montar(dir, 's1', 'compact') || '';
      assert.ok(t.indexOf('Plano: feito.md') !== -1, t);
      assert.ok(t.indexOf('O plano nao tem item sem marcar.') !== -1, t);
      assert.ok(t.indexOf('--fatia') === -1, 'sem item aberto, sem o comando: ' + t);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

test('H6d reinjecao (revisao R1, correcao/borda): caminho que o umaLinha muda ou com aspas fica fora do comando', () => {
  comRein((rein) => {
    // longo (o umaLinha corta em 200), espaco na ponta (o umaLinha apara) e, fora do Windows, aspas no nome
    const nomes = ['p'.repeat(201) + '.md', ' p.md'].concat(process.platform === 'win32' ? [] : ['a"b.md']);
    for (const nome of nomes) {
      const dir = tmp({ [nome]: '### Tarefa 1: x\n- [ ] a\n', '.claude/sworn/plano-ativo.json': JSON.stringify({ arquivo: nome, sessionId: 's1' }) });
      try {
        const t = rein.montar(dir, 's1', 'compact') || '';
        assert.match(t, /Leia so o cabecalho e a tarefa: node "[^"]*\/scripts\/plano\.js" --fatia \(sem id, o proximo item sem marcar; outro: --fatia <id>\)\./, t);
        assert.ok(t.indexOf('--plano') === -1, 'o caminho nao vai para o comando: ' + t);
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    }
    // aspas direto na linha (o Windows nao deixa criar o arquivo): o caminho fica fora; o comum entra entre aspas
    // e o que o shell expande entre aspas duplas ($, crase, barra, !) tambem fica fora (revisao R2, borda)
    for (const nome of ['docs/a"b.md', 'docs/p$(id).md', 'docs/p$HOME.md', 'docs/p`id`.md', 'docs\\p.md', 'docs/p!.md']) {
      assert.ok(rein.linhaDaFatia(nome).indexOf('--plano') === -1, nome);
    }
    assert.ok(rein.linhaDaFatia('docs/p q.md').indexOf('--fatia --plano "docs/p q.md" (sem id') !== -1);
    assert.ok(rein.linhaDaFatia('C:/x/Ação_1-2+b@c,d~.md').indexOf('--plano "C:/x/Ação_1-2+b@c,d~.md"') !== -1);
  });
});

test('H6d comandoDaFatia (revisao R2, borda): a pasta do sworn que o shell expande deixa o comando inteiro de fora', () => {
  assert.strictEqual(fatia.comandoDaFatia('C:\\s w\\plano.js', 'docs/p.md'), 'node "C:/s w/plano.js" --fatia --plano "docs/p.md"');
  assert.strictEqual(fatia.comandoDaFatia('/a/plano.js', null), 'node "/a/plano.js" --fatia');
  assert.strictEqual(fatia.comandoDaFatia('/a/plano.js', 'docs/p$HOME.md'), 'node "/a/plano.js" --fatia');
  for (const script of ['/a/$proj/plano.js', '/u/a`id`/plano.js', '/u/a"b/plano.js', '/u/a!/plano.js']) {
    assert.strictEqual(fatia.comandoDaFatia(script, 'docs/p.md'), null, script);
  }
  // as duas pontas trocam o comando por um texto sem ele: o caminho de verdade do sworn aqui cabe, entao o stub
  // faz o papel da pasta com $
  const orig = fatia.comandoDaFatia;
  fatia.comandoDaFatia = () => null;
  try {
    comRein((rein) => {
      const l = rein.linhaDaFatia('docs/p.md');
      assert.strictEqual(l, 'Leia so o cabecalho do plano e a tarefa sem marcar; o comando da fatia ficou fora: a pasta ' +
        'do sworn tem caractere que o shell expande entre aspas.');
    });
    const dir = tmp({ 'docs/p.md': PLANO, '.claude/sworn/escopos/frente-x.md': '# Escopo\n**Objetivo:** X. Plano: `docs/p.md`\n## Dentro\n- x/**\n' });
    try {
      const t = hc.montar(dir, { slug: 'x', hoje: '2026-11-23', frente: 'frente-x' }).texto;
      assert.ok(t.indexOf('docs/p.md (o plano: so o cabecalho e o item da secao 3)') !== -1, t);
      assert.ok(t.indexOf('--fatia') === -1 && t.indexOf('null') === -1, t);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  } finally { fatia.comandoDaFatia = orig; }
});

test('H6d reinjecao: o plano de uma frente sem vinculo com a sessao nao entra', () => {
  comRein((rein) => {
    const dir = tmp({ 'plano.md': PLANO, '.claude/sworn/escopos/f1.md': '# Escopo\n**Objetivo:** X. Plano: plano.md.\n## Dentro\n- x/**\n' });
    try {
      const t = rein.montar(dir, 's1', 'compact') || '';
      assert.ok(t.indexOf('--fatia') === -1, 'o plano de outra frente (D541) nao vira o desta sessao: ' + t);
      // sem escopo.md e sem vinculo com a frente, nao ha estado nenhum a reinjetar
      assert.strictEqual(rein.montar(dir, 's1', 'compact'), null);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

test('H6d reinjecao: o Plano: do escopo que aponta para fora do projeto nao entra', () => {
  comRein((rein) => {
    const dir = tmp({ '.claude/sworn/escopo.md': '# Escopo\n**Objetivo:** X. Plano: ../fora.md.\n## Dentro\n- x/**\n' });
    try {
      const t = rein.montar(dir, 's1', 'compact') || '';
      assert.ok(t.indexOf('--fatia') === -1, t);
      assert.ok(t.indexOf('ESTADO - plano em execucao') === -1, 'nem o bloco do plano: ' + t);
      assert.ok(t.indexOf('ESTADO - escopo declarado') !== -1, 'o escopo segue saindo: ' + t);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
