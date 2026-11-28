'use strict';
// F4c: o handoff curto montado por script (as secoes que o disco sabe saem do disco; o modelo so preenche o que
// pede juizo) e as pendencias num arquivo so, cada uma com dono e data. O diagnostico de 2026-11-10 mediu 622
// handoffs: mediana de 9 KB, o prompt 34% do volume e ~20% das linhas copiadas do anterior.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const comum = require('./lib/comum.js');
const pend = require('../scripts/lib/pendencias.js');
const hc = require('../scripts/lib/handoff-curto.js');
const saude = require('../scripts/lib/saude.js');

const HOJE = '2026-11-13';

// ---------------------------------------------------------------- pendencias
test('F4c pendencias: sem o arquivo, nada aberto e nenhum erro', () => {
  const dir = comum.pasta('pend-vazio');
  const r = pend.ler(dir);
  assert.strictEqual(r.existe, false);
  assert.deepStrictEqual(r.abertas, []);
  assert.deepStrictEqual(r.invalidas, []);
  assert.strictEqual(r.erro, undefined, 'arquivo que nao existe nao e erro');
});

test('F4c pendencias: o numero de item fora do formato e o [X] maiusculo contam no maior; o CRLF do arquivo fica', () => {
  const dir = comum.pasta('pend-maior');
  fs.mkdirSync(path.join(dir, '.sworn'), { recursive: true });
  fs.writeFileSync(path.join(dir, pend.ARQUIVO), '# Pendencias\r\n\r\n- [X] #4 2026-11-10 | dono: A | feito | fechada 2026-11-11: ok\r\n' +
    '- [ ] #7 sem data nem dono\r\n');
  const r = pend.ler(dir);
  assert.deepStrictEqual(r.fechadas.map(function (p) { return p.n; }), [4]);
  assert.strictEqual(r.maior, 7);
  assert.strictEqual(pend.adicionar(dir, { dono: 'A', texto: 'nova', hoje: HOJE }).n, 8, 'o 7 fora do formato nao se reusa');
  const soCrlf = function (t) { return t.split('\r\n').length === t.split('\n').length; };
  assert.ok(soCrlf(fs.readFileSync(path.join(dir, pend.ARQUIVO), 'utf8')), 'adicionar segue o CRLF');
  pend.fechar(dir, 8, 'feita', HOJE);
  const texto = fs.readFileSync(path.join(dir, pend.ARQUIVO), 'utf8');
  assert.ok(soCrlf(texto), 'fechar segue o CRLF');
  assert.match(texto, /- \[x\] #8 2026-11-13 \| dono: A \| nova \| fechada 2026-11-13: feita\r\n$/);
});

test('F4c pendencias: fechar o item da linha 1 de um arquivo com BOM marca o item e guarda o BOM', () => {
  const dir = comum.pasta('pend-bom');
  fs.mkdirSync(path.join(dir, '.sworn'), { recursive: true });
  fs.writeFileSync(path.join(dir, pend.ARQUIVO), String.fromCharCode(0xFEFF) + '- [ ] #1 2026-11-10 | dono: A | primeira\n');
  pend.fechar(dir, 1, 'feita', HOJE);
  const texto = fs.readFileSync(path.join(dir, pend.ARQUIVO), 'utf8');
  assert.strictEqual(texto.charCodeAt(0), 0xFEFF, 'o BOM fica');
  assert.strictEqual(texto.slice(1), '- [x] #1 2026-11-10 | dono: A | primeira | fechada 2026-11-13: feita\n');
  assert.deepStrictEqual(pend.ler(dir).fechadas.map(function (p) { return p.n; }), [1]);
});

test('F4c pendencias: data que nao existe e quebra de linha ou "|" no dono ou no como recusam', () => {
  const dir = comum.pasta('pend-datas');
  assert.throws(function () { pend.adicionar(dir, { dono: 'A', texto: 'x', hoje: '2026-02-30' }); }, /nao existe/);
  assert.throws(function () { pend.adicionar(dir, { dono: 'A\nB', texto: 'x', hoje: HOJE }); }, /--dono com quebra de linha/);
  pend.adicionar(dir, { dono: 'A', texto: 'x', hoje: HOJE });
  assert.throws(function () { pend.fechar(dir, 1, 'a\n- [ ] #9 falsa', HOJE); }, /--como com quebra de linha/);
  assert.throws(function () { pend.fechar(dir, 1, 'a | b', HOJE); }, /--como/);
  assert.deepStrictEqual(pend.ler(dir).abertas.map(function (p) { return p.n; }), [1]);
  assert.match(pend.dataLocal(new Date(2026, 0, 5)), /^2026-01-05$/);
});

test('F4c pendencias: adicionar numera, grava dono e data, e o arquivo nasce com o cabecalho', () => {
  const dir = comum.pasta('pend-add');
  assert.strictEqual(pend.adicionar(dir, { dono: 'Ana', texto: 'publicar a 0.32.0', hoje: HOJE }).n, 1);
  assert.strictEqual(pend.adicionar(dir, { dono: 'agente', texto: 'medir o tempo da suite', hoje: '2026-11-14' }).n, 2);
  const texto = fs.readFileSync(path.join(dir, pend.ARQUIVO), 'utf8');
  assert.match(texto, /^# Pendencias\n/);
  assert.match(texto, /^- \[ \] #1 2026-11-13 \| dono: Ana \| publicar a 0\.32\.0$/m);
  const r = pend.ler(dir);
  assert.deepStrictEqual(r.abertas.map(function (p) { return [p.n, p.data, p.dono, p.texto]; }),
    [[1, '2026-11-13', 'Ana', 'publicar a 0.32.0'], [2, '2026-11-14', 'agente', 'medir o tempo da suite']]);
});

test('F4c pendencias: sem dono, sem texto, com quebra de linha ou com barra vertical, recusa e nao grava', () => {
  const dir = comum.pasta('pend-recusa');
  for (const c of [[{ dono: '', texto: 'x' }, /^Error: sworn: pendencia sem --dono; passe --dono/],
    [{ dono: 'W', texto: '  ' }, /^Error: sworn: pendencia sem --texto; passe --texto/],
    [{ dono: 'W', texto: 'a\nb' }, /^Error: sworn: --texto com quebra de linha ou "\|"/],
    [{ dono: 'W|X', texto: 'x' }, /^Error: sworn: --dono com quebra de linha ou "\|"/],
    [{ dono: 'W', texto: 'a | b' }, /^Error: sworn: --texto com quebra de linha ou "\|"/]]) {
    assert.throws(function () { pend.adicionar(dir, Object.assign({ hoje: HOJE }, c[0])); }, c[1], JSON.stringify(c[0]));
  }
  assert.throws(function () { pend.adicionar(dir, { dono: 'W', texto: 'x', hoje: '13/11/2026' }); }, /AAAA-MM-DD/);
  assert.strictEqual(fs.existsSync(path.join(dir, pend.ARQUIVO)), false);
});

// Pendencia #1 (seguranca, D841): um repositorio clonado pode trazer .sworn ou o PENDENCIAS.md como link; gravar por
// ele escreveria fora do projeto (num arquivo do usuario). Adicionar e fechar recusam, com a causa e o que fazer.
test('F4c pendencias: a pasta .sworn como link (junction) nao se segue ao gravar', (t) => {
  const dir = comum.pasta('pend-link-pasta');
  const fora = comum.pasta('pend-link-fora');
  fs.writeFileSync(path.join(fora, 'PENDENCIAS.md'), '- [ ] #1 2026-11-10 | dono: A | de fora\n');
  try { fs.symlinkSync(fora, path.join(dir, '.sworn'), process.platform === 'win32' ? 'junction' : 'dir'); } catch (e) {
    t.skip('esta maquina nao cria link (' + e.code + ')');
    return;
  }
  const antes = fs.readFileSync(path.join(fora, 'PENDENCIAS.md'), 'utf8');
  const erro = (function () {
    try { pend.adicionar(dir, { dono: 'A', texto: 'nova', hoje: HOJE }); } catch (e) { return e; }
    assert.fail('adicionar gravou pelo link');
  })();
  assert.match(erro.message, /a pasta \.sworn e um link \(atalho\)/);
  assert.match(erro.message, /nao gravo por ele/);
  assert.match(erro.message, /Troque o link por uma pasta de verdade e rode de novo/, 'a recusa diz o que fazer');
  assert.ok(!erro.uso, 'nao e erro de uso');
  assert.throws(function () { pend.fechar(dir, 1, 'feita', HOJE); },
    /a pasta \.sworn e um link \(atalho\)[\s\S]*Troque o link por uma pasta de verdade/);
  assert.strictEqual(fs.readFileSync(path.join(fora, 'PENDENCIAS.md'), 'utf8'), antes, 'o arquivo de fora fica como estava');
  assert.deepStrictEqual(fs.readdirSync(fora), ['PENDENCIAS.md'], 'nada nasce do outro lado do link');
});

test('F4c pendencias: o PENDENCIAS.md como link de arquivo nao se segue ao gravar', (t) => {
  const dir = comum.pasta('pend-link-arq');
  const fora = comum.pasta('pend-link-arq-fora');
  const alvo = path.join(fora, 'perfil.txt');
  fs.writeFileSync(alvo, '- [ ] #1 2026-11-10 | dono: A | de fora\n');
  fs.mkdirSync(path.join(dir, '.sworn'));
  const arquivo = path.join(dir, pend.ARQUIVO);
  let linkDeVerdade = true;
  try { fs.symlinkSync(alvo, arquivo, 'file'); } catch (e) {
    // o Windows sem modo de desenvolvedor nao cria link de arquivo (EPERM): o lstat diz "link" so para este caminho, e
    // o arquivo de verdade no lugar mostra que nada se gravou nele. Outro erro (EEXIST de uma rodada antiga) e falha.
    if (e.code !== 'EPERM' && e.code !== 'EACCES') throw e;
    linkDeVerdade = false;
    t.diagnostic('sem link de arquivo nesta maquina (' + e.code + '): o lstat finge o link');
    fs.writeFileSync(arquivo, '- [ ] #1 2026-11-10 | dono: A | de fora\n');
    const original = fs.lstatSync;
    t.mock.method(fs, 'lstatSync', function (p, o) {
      const st = original.call(fs, p, o);
      if (path.resolve(String(p)) === path.resolve(arquivo)) st.isSymbolicLink = function () { return true; };
      return st;
    });
  }
  const recusa = /\.sworn\/PENDENCIAS\.md e um link \(atalho\)[\s\S]*Troque o link por um arquivo de verdade e rode de novo/;
  assert.throws(function () { pend.adicionar(dir, { dono: 'A', texto: 'nova', hoje: HOJE }); }, recusa);
  assert.throws(function () { pend.fechar(dir, 1, 'feita', HOJE); }, recusa);
  // com o link de verdade, o alvo de fora e o que nao pode mudar; com o lstat fingido, o arquivo no lugar do link
  assert.strictEqual(fs.readFileSync(linkDeVerdade ? alvo : arquivo, 'utf8'), '- [ ] #1 2026-11-10 | dono: A | de fora\n');
});

// F5b r1 (estados, microcopy): o lstat que falha por outro motivo que "nao existe" deixava gravar sem conferir o link;
// e a recusa dizia "pasta ou arquivo" nos dois casos.
test('F5b r1 pendencias: sem conseguir conferir o link, recusa; a recusa diz pasta para .sworn e arquivo para o PENDENCIAS.md', (t) => {
  const dir = comum.pasta('pend-lstat');
  pend.adicionar(dir, { dono: 'A', texto: 'um', hoje: HOJE });
  const antes = fs.readFileSync(path.join(dir, pend.ARQUIVO), 'utf8');
  const original = fs.lstatSync;
  const sworn = path.resolve(dir, '.sworn');
  const mock = t.mock.method(fs, 'lstatSync', function (p, o) {
    if (path.resolve(String(p)) === sworn) { const e = new Error('EACCES: negado'); e.code = 'EACCES'; throw e; }
    return original.call(fs, p, o);
  });
  assert.throws(function () { pend.adicionar(dir, { dono: 'A', texto: 'dois', hoje: HOJE }); },
    (e) => /nao consegui conferir se a pasta \.sworn e um link/.test(e.message) && /EACCES/.test(e.message) && !e.uso);
  assert.throws(function () { pend.fechar(dir, 1, 'feita', HOJE); }, /nao consegui conferir se a pasta \.sworn e um link/);
  assert.strictEqual(fs.readFileSync(path.join(dir, pend.ARQUIVO), 'utf8'), antes, 'nada gravado');
  mock.mock.restore();
  const comoLink = function (alvoDoLink) {
    t.mock.method(fs, 'lstatSync', function (p, o) {
      const st = original.call(fs, p, o);
      if (path.resolve(String(p)) === path.resolve(dir, alvoDoLink)) st.isSymbolicLink = function () { return true; };
      return st;
    });
  };
  comoLink('.sworn');
  assert.throws(function () { pend.adicionar(dir, { dono: 'A', texto: 'x', hoje: HOJE }); },
    /Troque o link por uma pasta de verdade e rode de novo$/);
  t.mock.restoreAll();
  comoLink(pend.ARQUIVO);
  assert.throws(function () { pend.adicionar(dir, { dono: 'A', texto: 'x', hoje: HOJE }); },
    /Troque o link por um arquivo de verdade e rode de novo$/);
});

// F5b r1 (estados, borda, microcopy): o fechar regravava no lugar (a falha no meio truncava o arquivo); numero que nao e
// numero dava "#NaN"; U+2028 no --como sumia o item; "ja esta fechada" nao dizia o proximo passo.
test('F5b r1 pendencias: fechar grava por arquivo temporario, recusa numero invalido e separador de linha Unicode', (t) => {
  const dir = comum.pasta('pend-fechar-atomico');
  pend.adicionar(dir, { dono: 'A', texto: 'um', hoje: HOJE });
  const arquivo = path.join(dir, pend.ARQUIVO);
  const antes = fs.readFileSync(arquivo, 'utf8');
  const escrever = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', function (p, d, o) {
    escrever.call(fs, p, String(d).slice(0, 10), o);
    throw Object.assign(new Error('ENOSPC: disco cheio'), { code: 'ENOSPC' });
  });
  assert.throws(function () { pend.fechar(dir, 1, 'feita', HOJE); }, /ENOSPC/);
  t.mock.restoreAll();
  assert.strictEqual(fs.readFileSync(arquivo, 'utf8'), antes, 'a falha no meio nao trunca o PENDENCIAS.md');
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, '.sworn')), ['PENDENCIAS.md'], 'o temporario da falha nao fica');
  pend.fechar(dir, 1, 'feita', HOJE);
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, '.sworn')), ['PENDENCIAS.md'], 'sem sobra de temporario');
  assert.strictEqual(pend.ler(dir).fechadas.length, 1);
  for (const n of ['abc', '', '0', '-1', '1.5', null]) {
    assert.throws(function () { pend.fechar(dir, n, 'x', HOJE); },
      (e) => e.uso && /pede o numero da pendencia \(1 ou mais\)/.test(e.message), JSON.stringify(n));
  }
  assert.throws(function () { pend.fechar(dir, 1, 'de novo', HOJE); }, /ja esta fechada; nada a fazer \(veja com --listar\)/);
  for (const sep of ['\u2028', '\u2029']) {
    assert.throws(function () { pend.adicionar(dir, { dono: 'A', texto: 'a' + sep + 'b', hoje: HOJE }); }, (e) => e.uso);
  }
});

test('F5b r2 pendencias: o temporario do fechar e criado exclusivo; o que ja existe no nome nao e escrito nem apagado', (t) => {
  const crypto = require('node:crypto');
  const dir = comum.pasta('pend-fechar-exclusivo');
  pend.adicionar(dir, { dono: 'A', texto: 'um', hoje: HOJE });
  const arquivo = path.join(dir, pend.ARQUIVO);
  const antes = fs.readFileSync(arquivo, 'utf8');
  // o sorteio fixo deixa o nome previsivel: no lugar do link plantado, um arquivo comum basta para o EEXIST
  t.mock.method(crypto, 'randomBytes', function (n) { return Buffer.alloc(n); });
  const plantado = arquivo + '.' + process.pid + '.' + Buffer.alloc(6).toString('hex') + '.tmp';
  fs.writeFileSync(plantado, 'de outro');
  assert.throws(function () { pend.fechar(dir, 1, 'feita', HOJE); }, (e) => e.code === 'EEXIST');
  assert.strictEqual(fs.readFileSync(plantado, 'utf8'), 'de outro', 'nao escreve no que ja estava no nome');
  assert.strictEqual(fs.readFileSync(arquivo, 'utf8'), antes, 'o PENDENCIAS.md fica como estava');
  t.mock.restoreAll();
  pend.fechar(dir, 1, 'feita', HOJE);
  assert.strictEqual(pend.ler(dir).fechadas.length, 1, 'com outro sorteio o fechar grava');
  assert.ok(fs.existsSync(plantado), 'o que esta chamada nao criou nao se apaga');
});

test('F4c pendencias: fechar pede como fechou, marca a data e tira das abertas; fechar de novo recusa', () => {
  const dir = comum.pasta('pend-fechar');
  pend.adicionar(dir, { dono: 'Ana', texto: 'publicar', hoje: HOJE });
  pend.adicionar(dir, { dono: 'agente', texto: 'medir', hoje: HOJE });
  assert.throws(function () { pend.fechar(dir, 1, '', HOJE); }, /como/);
  assert.throws(function () { pend.fechar(dir, 9, 'feito', HOJE); }, /#9/);
  pend.fechar(dir, 1, 'publicada, D839', '2026-11-14');
  const r = pend.ler(dir);
  assert.deepStrictEqual(r.abertas.map(function (p) { return p.n; }), [2]);
  assert.deepStrictEqual(r.fechadas.map(function (p) { return [p.n, p.fechadaEm, p.como]; }), [[1, '2026-11-14', 'publicada, D839']]);
  assert.throws(function () { pend.fechar(dir, 1, 'de novo', HOJE); }, /ja esta fechada/);
  assert.strictEqual(pend.adicionar(dir, { dono: 'W', texto: 'outra', hoje: HOJE }).n, 3, 'o numero nao se reusa');
});

test('F4c pendencias: item de lista fora do formato (sem dono ou sem data) aparece em invalidas, com a linha', () => {
  const dir = comum.pasta('pend-invalida');
  fs.mkdirSync(path.join(dir, '.sworn'), { recursive: true });
  fs.writeFileSync(path.join(dir, pend.ARQUIVO), '# Pendencias\n\nTexto solto nao conta.\n' +
    '- [ ] #1 2026-11-13 | dono: W | certo\n- [ ] sem dono nem data\n- [ ] #2 13/11 | dono: W | data errada\n');
  const r = pend.ler(dir);
  assert.deepStrictEqual(r.abertas.map(function (p) { return p.n; }), [1]);
  assert.deepStrictEqual(r.invalidas.map(function (i) { return i.linha; }), [5, 6]);
});

test('F4c pendencias: o arquivo que nao se le devolve a causa, nunca uma lista vazia calada', () => {
  const dir = comum.pasta('pend-ilegivel');
  fs.mkdirSync(path.join(dir, pend.ARQUIVO), { recursive: true });
  const r = pend.ler(dir);
  assert.strictEqual(r.existe, true);
  assert.match(r.erro, /pasta \(EISDIR\)/, 'pasta no lugar do arquivo: erro com a causa');
  assert.throws(function () { pend.adicionar(dir, { dono: 'W', texto: 'x', hoje: HOJE }); }, /nao consegui ler/);
});

// ---------------------------------------------------------------- a caixa aberta
test('F4c handoff: a caixa aberta e a primeira sem filhas (a mae cede a filha aberta; a mae com tudo feito e pulada)', () => {
  const plano = '# Plano\n\n```\n- [ ] exemplo dentro de bloco\n```\n- [x] **A1** feito\n- [ ] **F1 Testes**\n' +
    '  - [x] F1a feito\n- [ ] **F4 Regras**\n' +
    '  - [x] F4a feito\n  - [ ] F4c handoff curto\n    gerado por script.\n  - [ ] F4e guia\n- [ ] **F5 Codigo**\n';
  const c = hc.caixaAberta(plano);
  assert.strictEqual(c.linha, 11);
  assert.strictEqual(c.texto, '- [ ] F4c handoff curto\n    gerado por script.');
  assert.strictEqual(hc.caixaAberta('- [x] tudo feito\n'), null);
  const separada = hc.caixaAberta('- [ ] A solta\nparagrafo no meio\n  - [ ] B de outra lista\n');
  assert.strictEqual(separada.linha, 1, 'caixa mais recuada depois de uma linha de recuo menor nao e filha');
});

test('F4c handoff: o corte da caixa conta caracteres de verdade, sem partir acento nem emoji', () => {
  const c = hc.caixaAberta('- [ ] ' + '\u{1F600}'.repeat(1000) + '\n');
  assert.strictEqual(Array.from(c.texto).length, 900 + ' [...]'.length);
  assert.ok(!/[\uD800-\uDFFF](?![\uDC00-\uDFFF])/.test(c.texto.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')), 'sem metade de par');
});

test('F4c handoff: a caixa longa corta em 900 caracteres e diz que cortou', () => {
  const c = hc.caixaAberta('- [ ] T1 ' + 'a'.repeat(1000) + '\n');
  assert.strictEqual(c.texto.length, 900 + ' [...]'.length);
  assert.ok(c.texto.endsWith(' [...]'), c.texto.slice(-20));
});

// ---------------------------------------------------------------- montar
function projeto(extra) {
  comum.identidadeDeEnsaio();
  const arquivos = Object.assign({
    '.claude/sworn/escopos/frente-x.md': '# Escopo\n**Objetivo:** fazer x. Plano: `docs/plano.md`\n## Dentro\n- `a.js`\n',
    'docs/plano.md': '# Plano\n- [x] T1 feito\n- [ ] T2 o passo de agora\n  com a segunda linha.\n- [ ] T3 depois\n',
    'a.js': '1\n'
  }, extra || {});
  return comum.repo(comum.pasta('hc'), arquivos);
}

test('F4c handoff: monta as secoes do disco (plano, topologia, caixa, pendencias, pedidos) e deixa o resto marcado', () => {
  const dir = projeto();
  fs.writeFileSync(path.join(dir, 'a.js'), '2\n');
  pend.adicionar(dir, { dono: 'Ana', texto: 'publicar a 0.32.0', hoje: HOJE });
  const m = hc.montar(dir, { slug: 'frente-x-t2', hoje: HOJE, frente: 'frente-x' });
  assert.strictEqual(m.caminho, '.sworn/handoff/2026-11-13-frente-x-t2.md');
  assert.ok(saude.ehArquivoDeHandoff(m.caminho), 'o nome e de handoff para os ganchos');
  const t = m.texto;
  for (const s of ['## 1. Ordem de leitura', '## 2. Topologia', '## 3. Onde estamos', '## 4. Decisoes do dono',
    '## 5. Pendencias com dono', '## 6. Erros de metodo', '## 7. Arquivos de terceiros', '## 8. Prompt']) {
    assert.ok(t.indexOf(s) !== -1, 'falta a secao ' + s);
  }
  assert.ok(t.indexOf(path.join(dir, 'docs', 'plano.md').replace(/\\/g, '/')) !== -1, 'o plano pelo caminho absoluto');
  const head = comum.git(dir, ['rev-parse', 'HEAD']).trim();
  assert.ok(t.indexOf(head) !== -1, 'o HEAD lido do git');
  assert.match(t, /M a\.js/, 'o git status curto');
  assert.ok(t.indexOf('- [ ] T2 o passo de agora\n  com a segunda linha.') !== -1, 'a caixa com o texto do arquivo');
  assert.match(t, /#1 2026-11-13 \| dono: Ana \| publicar a 0\.32\.0/);
  for (const marca of ['<<ONDE:', '<<DECISOES:', '<<ERROS:', '<<TERCEIROS:']) assert.ok(t.indexOf(marca) !== -1, 'falta ' + marca);
  const secao1 = t.slice(t.indexOf('## 1.'), t.indexOf('## 2.'));
  assert.ok(secao1.indexOf(path.join(dir, pend.ARQUIVO).replace(/\\/g, '/')) !== -1, 'o PENDENCIAS na ordem de leitura');
  // H6d (D896): o plano se le pela fatia, com o comando pronto
  assert.match(secao1, /pelo node "[^"]*\/scripts\/plano\.js" --fatia --plano "docs\/plano\.md"\)/);
  assert.ok(!/[^\x00-\x7f]/.test(t.split(dir.replace(/\\/g, '/')).join('')), 'o texto fixo e ASCII (chega a terminal de qualquer pagina de codigo)');
});

test('H6d handoff (revisao R1, borda): plano com caractere que o shell expande fica fora do comando da fatia', () => {
  const dir = projeto({
    '.claude/sworn/escopos/frente-x.md': '# Escopo\n**Objetivo:** fazer x. Plano: `docs/p$HOME!.md`\n## Dentro\n- `a.js`\n',
    'docs/p$HOME!.md': '# Plano\n- [ ] T1 agora\n'
  });
  const t = hc.montar(dir, { slug: 'x', hoje: HOJE, frente: 'frente-x' }).texto;
  const secao1 = t.slice(t.indexOf('## 1.'), t.indexOf('## 2.'));
  assert.match(secao1, /docs\/p\$HOME!\.md \(o plano: so o cabecalho e o item da secao 3, pelo node "[^"]*\/scripts\/plano\.js" --fatia\)/, secao1);
  assert.ok(secao1.indexOf('--plano') === -1, 'o caminho nao vai para o comando: ' + secao1);
  assert.ok(t.indexOf('- [ ] T1 agora') !== -1, 'o plano foi lido: ' + t);
});

test('F4c handoff: sem PENDENCIAS, sem handoff anterior e com o plano todo marcado, cada secao diz o que falta', () => {
  const dir = projeto({ 'docs/plano.md': '# Plano\n- [x] T1 feito\n' });
  const t = hc.montar(dir, { slug: 'x', hoje: HOJE, frente: 'frente-x' }).texto;
  const secao1 = t.slice(t.indexOf('## 1.'), t.indexOf('## 2.'));
  assert.ok(secao1.indexOf('PENDENCIAS') === -1 && secao1.indexOf('handoff anterior') === -1, secao1);
  assert.match(t, /nao tem item sem marcar/);
  assert.match(t, /nenhuma aberta em \.sworn\/PENDENCIAS\.md/);
});

test('F4c handoff: pendencia longa corta no handoff; pasta de handoff que nao se le e varias frentes com plano dizem o que houve', () => {
  const dir = projeto({ '.claude/sworn/escopos/frente-y.md': '# Escopo\n**Objetivo:** y. Plano: `docs/plano.md`\n## Dentro\n- `a.js`\n' });
  pend.adicionar(dir, { dono: 'A', texto: 'p'.repeat(300), hoje: HOJE });
  pend.adicionar(dir, { dono: 'D'.repeat(80), texto: 'q', hoje: HOJE });
  fs.writeFileSync(path.join(dir, '.sworn', 'handoff'), 'arquivo no lugar da pasta\n');
  const t = hc.montar(dir, { slug: 'x', hoje: HOJE }).texto;
  assert.match(t, /\| dono: A \| p{160} \[\.\.\.\]\n/, 'o texto da pendencia corta em 160');
  assert.match(t, /\| dono: D{40} \[\.\.\.\] \| q\n/, 'o dono corta em 40');
  assert.match(t, /nao li a pasta \.sworn\/handoff \(.+\): ache o handoff anterior a mao/);
  assert.match(t, /Mais de uma frente tem plano e esta sessao nao esta ligada a nenhuma: rode de novo com --frente/);
});

test('F4c handoff: PENDENCIAS e pedidos que nao se leem dao a causa, nunca "nenhum" calado', () => {
  const dir = projeto();
  fs.mkdirSync(path.join(dir, pend.ARQUIVO), { recursive: true });
  fs.mkdirSync(path.join(dir, '.claude', 'sworn', 'pedidos', 'frente-x.md'), { recursive: true });
  const t = hc.montar(dir, { slug: 'x', hoje: HOJE, frente: 'frente-x' }).texto;
  const secao5 = t.slice(t.indexOf('## 5.'), t.indexOf('## 6.'));
  assert.match(secao5, /nao li \.sworn\/PENDENCIAS\.md: .*pasta \(EISDIR\)/);
  assert.match(secao5, /nao li os pedidos do dono \(.+\): rode node ".+pedidos\.js" --abertos --frente frente-x/);
  assert.ok(!/nenhum pedido|nenhuma aberta/.test(secao5), secao5);
});

test('F4c handoff: o prompt e o ultimo bloco, cita o arquivo e passa do corte de 300 caracteres do pedido colado', () => {
  const dir = projeto();
  const m = hc.montar(dir, { slug: 'x', hoje: HOJE, frente: 'frente-x' });
  const blocos = Array.from(m.texto.matchAll(/^```[^\n]*\r?\n([\s\S]*?)^```[ \t]*\r?$/gm)).map(function (b) { return b[1]; });
  const prompt = blocos[blocos.length - 1];
  assert.ok(prompt.indexOf(m.caminho) !== -1, 'o prompt cita o handoff');
  assert.ok(prompt.replace(/\s+/g, ' ').trim().length > 300, 'mais que o corte do pedidos.js (PROMPT_LONGO)');
  assert.ok(/^```\s*$/m.test(m.texto.trimEnd().split('\n').pop()), 'nada depois do bloco do prompt');
});

test('F4c handoff: o status longo corta em 15 linhas e diz quantas faltam; sem frente com plano, a secao diz isso', () => {
  const extra = {};
  for (let i = 0; i < 20; i++) extra['f' + i + '.txt'] = 'a\n';
  const dir = projeto(extra);
  for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(dir, 'f' + i + '.txt'), 'b\n');
  const m = hc.montar(dir, { slug: 'x', hoje: HOJE, frente: 'nao-existe' });
  assert.match(m.texto, /e mais 5 linhas do git status/);
  assert.strictEqual((m.texto.match(/^ {4}.. f\d+\.txt$/gm) || []).length, 15, 'so 15 linhas do status');
  assert.match(m.texto, /Nenhum plano achado para esta sessao \(frente nao-existe\)/);
});

test('F4c handoff: o anterior e o handoff mais novo da pasta, sem o resumo de retomada e sem o proprio destino', () => {
  const dir = projeto();
  const pasta = path.join(dir, '.sworn', 'handoff');
  fs.mkdirSync(pasta, { recursive: true });
  const t0 = Date.now() / 1000;
  // o certo tem o nome MAIS VELHO e a gravacao mais nova: ordem por nome escolheria o 2026-11-12-velho
  [['2026-11-12-velho.md', 400], ['2026-11-10-certo.md', 300], ['2026-11-12-retomar-abc.md', 200],
    ['2026-11-13-x.md', 100], ['notas.md', 50]].forEach(function (a) {
    const f = path.join(pasta, a[0]);
    fs.writeFileSync(f, '# h\n');
    fs.utimesSync(f, t0 - a[1], t0 - a[1]);
  });
  const t = hc.montar(dir, { slug: 'x', hoje: HOJE, frente: 'frente-x' }).texto;
  const secao1 = t.slice(t.indexOf('## 1.'), t.indexOf('## 2.'));
  assert.ok(secao1.indexOf('2026-11-10-certo.md (o handoff anterior') !== -1, secao1);
  assert.ok(!/velho|retomar|2026-11-13-x|notas/.test(secao1), secao1);
});

test('F4c handoff: a secao 5 corta as pendencias em 10, avisa as fora do formato e lista os pedidos abertos', () => {
  const dir = projeto();
  for (let i = 1; i <= 12; i++) pend.adicionar(dir, { dono: 'W', texto: 'item ' + i, hoje: HOJE });
  fs.appendFileSync(path.join(dir, pend.ARQUIVO), '- [ ] sem dono nem data\n');
  fs.mkdirSync(path.join(dir, '.claude', 'sworn', 'pedidos'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'pedidos', 'frente-x.md'),
    '1. publique [feito: abc1234]\n2. faca a F4\n3. e a F5\n');
  const t = hc.montar(dir, { slug: 'x', hoje: HOJE, frente: 'frente-x' }).texto;
  const secao5 = t.slice(t.indexOf('## 5.'), t.indexOf('## 6.'));
  assert.strictEqual((secao5.match(/^ {2}- #\d+ /gm) || []).length, 10, secao5);
  assert.match(secao5, /e mais 2 no arquivo/);
  assert.match(secao5, /1 item\(ns\) fora do formato .*linha\(s\) 17/);
  assert.match(secao5, /pedidos do dono abertos \(2\): #2, #3;/);
});

test('F4c handoff: fora de um repositorio git, a topologia diz que nao leu, sem quebrar', () => {
  const dir = comum.pasta('hc-sem-git');
  const m = hc.montar(dir, { slug: 'x', hoje: HOJE });
  assert.match(m.texto, /nao e um repositorio git|git nao respondeu/);
});

test('F4c handoff: slug fora da regra (maiuscula, espaco, barra, "retomar") recusa', () => {
  const dir = comum.pasta('hc-slug');
  for (const s of ['', 'A', 'com espaco', 'a/b', 'a\\b', '..', '-x', 'retomar-x', 'frente-retomar', 'x'.repeat(61)]) {
    assert.throws(function () { hc.montar(dir, { slug: s, hoje: HOJE }); }, /slug do handoff invalido.*ate 60 caracteres, sem "retomar"/);
  }
  for (const s of ['x'.repeat(60), 'f4c-handoff-2']) {
    assert.strictEqual(hc.montar(dir, { slug: s, hoje: HOJE }).caminho, '.sworn/handoff/' + HOJE + '-' + s + '.md');
  }
  assert.throws(function () { hc.montar(dir, { slug: 'x', hoje: '2026-13-01' }); }, /^Error: sworn: --hoje/);
  assert.match(hc.montar(dir, { slug: 'x' }).caminho, new RegExp('^\\.sworn/handoff/' + pend.dataLocal(new Date()) + '-x\\.md$'), 'sem --hoje, o dia local');
});

// ---------------------------------------------------------------- conferir
function preenchido(dir) {
  const m = hc.montar(dir, { slug: 'x', hoje: HOJE, frente: 'frente-x' });
  return { caminho: m.caminho, texto: m.texto.replace(/<<[A-Z]+:[^>]*>>/g, 'preenchido') };
}

test('F4c conferir: o preenchido passa; o que sobrou de marca, o tamanho e o prompt fora do lugar reprovam', () => {
  const dir = projeto();
  const p = preenchido(dir);
  const ok = hc.conferir(p.texto, p.caminho);
  assert.deepStrictEqual(ok.problemas, []);
  assert.strictEqual(ok.ok, true);
  assert.ok(ok.bytes > 0 && ok.bytes <= hc.TETO);
  assert.strictEqual(hc.TETO, 4096, 'o teto do item: 4 KB');
  const folga = hc.TETO - ok.bytes;
  const acentos = hc.conferir(p.texto.replace('## 6. Erros de metodo', '## 6. Erros de metodo\n' + 'ç'.repeat(folga - 1)), p.caminho);
  assert.match(acentos.problemas.join(' '), /bytes/, 'o teto conta bytes, nao caracteres: cada cedilha vale 2');

  const comMarca = hc.conferir(p.texto.replace('preenchido', '<<ONDE: falta>>'), p.caminho);
  assert.strictEqual(comMarca.ok, false);
  assert.match(comMarca.problemas.join(' '), /<<ONDE/);

  const grande = hc.conferir(p.texto.replace('## 6. Erros de metodo', '## 6. Erros de metodo\n' + 'x'.repeat(hc.TETO)), p.caminho);
  assert.match(grande.problemas.join(' '), /bytes/);

  const blocoDepois = hc.conferir(p.texto + '\n```\noutro bloco\n```\n', p.caminho);
  assert.match(blocoDepois.problemas.join(' '), /prompt/);

  const semSecao = hc.conferir(p.texto.replace('## 5. Pendencias com dono', '## 5. Outra'), p.caminho);
  assert.match(semSecao.problemas.join(' '), /## 5\./);

  assert.match(hc.conferir(p.texto, '.sworn/handoff/sem-data.md').problemas.join(' '), /o nome \.sworn\/handoff\/sem-data\.md nao e de handoff: grave em/);
  const retomar = hc.conferir(p.texto, '.sworn/handoff/2026-11-13-retomar-x.md').problemas.join(' ');
  assert.match(retomar, /e de resumo de retomada \(-retomar-\), nao de handoff: grave em/);
  assert.ok(!/nao e de handoff/.test(retomar), 'o nome de retomada da a sua mensagem, nao a do nome qualquer');

  assert.match(comMarca.problemas.join(' '), /^sobrou a marca <<ONDE:/);
  const duas = hc.conferir(p.texto.replace('preenchido', '<<ONDE: a>>').replace('preenchido', '<<ERROS: b>>'), p.caminho);
  assert.match(duas.problemas.join(' '), /sobraram as marcas <<ONDE:, <<ERROS:/);
});

test('F4c handoff: o rascunho cabe no orcamento (teto menos 1 KB): muitas pendencias e caixa longa encolhem, e dizem quantas ficaram', () => {
  const dir = projeto({ 'docs/plano.md': '# Plano\n- [ ] T1 ' + 'c'.repeat(2000) + '\n' });
  for (let i = 1; i <= 12; i++) pend.adicionar(dir, { dono: 'D'.repeat(80), texto: 'p'.repeat(300), hoje: HOJE });
  const t = hc.montar(dir, { slug: 'x', hoje: HOJE, frente: 'frente-x' }).texto;
  assert.ok(Buffer.byteLength(t, 'utf8') <= hc.TETO - 1024, Buffer.byteLength(t, 'utf8') + ' bytes');
  const secao5 = t.slice(t.indexOf('## 5.'), t.indexOf('## 6.'));
  // 12 pendencias longas passam do orcamento ate com 5 (LIMITES desce de 5 a 0): nenhuma listada
  assert.strictEqual((secao5.match(/^ {2}- #\d+ /gm) || []).length, 0, secao5);
  // 0.91.0 (A2, b): com nenhuma listada, a conta e o arquivo numa linha so, sem o "e mais 12" depois de uma lista vazia
  assert.match(secao5, /^- abertas em \.sworn\/PENDENCIAS\.md \(12\): o texto delas nao coube aqui; leia no arquivo\.$/m, secao5);
  assert.ok(!/e mais \d+ no arquivo/.test(secao5), secao5);
  // 12 curtas cabem com 5: a lista e o "e mais 7" depois dela
  const curtas = projeto({ 'docs/plano.md': '# Plano\n- [ ] T1 ' + 'c'.repeat(2000) + '\n' });
  for (let i = 1; i <= 12; i++) pend.adicionar(curtas, { dono: 'D'.repeat(10), texto: 'p'.repeat(40), hoje: HOJE });
  const tc = hc.montar(curtas, { slug: 'x', hoje: HOJE, frente: 'frente-x' }).texto;
  const secao5c = tc.slice(tc.indexOf('## 5.'), tc.indexOf('## 6.'));
  assert.strictEqual((secao5c.match(/^ {2}- #\d+ /gm) || []).length, 5, secao5c);
  assert.match(secao5c, /^- abertas em \.sworn\/PENDENCIAS\.md \(12\):$/m, secao5c);
  assert.match(secao5c, /^ {2}- e mais 7 no arquivo\.$/m, secao5c);
  assert.ok(!/nao coube aqui/.test(secao5c), secao5c);
  assert.match(t, /- \[ \] T1 c+ \[\.\.\.\]/, 'a caixa segue no handoff, cortada');
  assert.match(hc.caixaAberta('- [ ] ' + 'c'.repeat(2000), 400).texto, /^- \[ \] c{394} \[\.\.\.\]$/, 'o corte do limite vale (400)');
  const soltas = projeto();
  fs.mkdirSync(path.join(soltas, '.sworn'), { recursive: true });
  fs.writeFileSync(path.join(soltas, pend.ARQUIVO), '# Pendencias\n' + '- [ ] solta\n'.repeat(700));
  const ts = hc.montar(soltas, { slug: 'x', hoje: HOJE, frente: 'frente-x' }).texto;
  assert.ok(Buffer.byteLength(ts, 'utf8') <= hc.TETO - 1024, 'as linhas fora do formato nao estouram o rascunho');
  assert.match(ts, /700 item\(ns\) fora do formato .*linha\(s\) 2, 3, (\d+, ){17}21 e mais 680: corrija/);
  const folgado = hc.montar(projeto(), { slug: 'x', hoje: HOJE, frente: 'frente-x' }).texto;
  assert.ok(folgado.indexOf('- [ ] T2 o passo de agora\n  com a segunda linha.') !== -1, 'o rascunho que cabe nao encolhe');
});

test('F4c handoff: o prompt aponta o PENDENCIAS so quando ele existe; o comando dos pedidos fecha a linha', () => {
  const sem = hc.montar(projeto(), { slug: 'x', hoje: HOJE, frente: 'frente-x' }).texto;
  assert.match(sem, /e as pendencias da secao 5\./);
  assert.ok(sem.indexOf('pendencias com dono em .sworn/PENDENCIAS.md') === -1, 'sem o arquivo, o prompt nao o manda ler');
  const dir = projeto();
  pend.adicionar(dir, { dono: 'A', texto: 'x', hoje: HOJE });
  fs.mkdirSync(path.join(dir, '.claude', 'sworn', 'pedidos'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'pedidos', 'frente-x.md'), '1. faca a F4\n');
  const com = hc.montar(dir, { slug: 'x', hoje: HOJE, frente: 'frente-x' }).texto;
  assert.match(com, /e as pendencias com dono em \.sworn\/PENDENCIAS\.md\./);
  assert.match(com, /o texto de cada um, com o comando: node ".+pedidos\.js" --abertos --frente frente-x\n/, 'sem ponto colado no comando');
});

// 0.91.0 (A2, defeito c): sem vinculo, o plano vem da unica frente com plano e os pedidos tambem; os sem frente (quase
// todos sondas "responda so: ok") so dao a conta e o comando. Vinculada, so a lista da frente, como antes.
test('0.91.0 handoff: sem vinculo, os pedidos sao os da unica frente com plano; os sem frente so dao a conta', () => {
  const dir = projeto();
  const pasta = path.join(dir, '.claude', 'sworn', 'pedidos');
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, 'frente-x.md'), '1. faca a F4 [feito: abc1234]\n2. e a F5\n');
  fs.writeFileSync(path.join(pasta, 'sem-frente.md'), '1. responda so: ok\n2. responda so: ok\n3. continue no handoff\n');
  const t = hc.montar(dir, { slug: 'x', hoje: HOJE }).texto;
  assert.match(t, /achado pela unica frente com plano/, 'controle: a sessao nao esta vinculada');
  const s5 = t.slice(t.indexOf('## 5.'), t.indexOf('## 6.'));
  assert.match(s5, /- pedidos do dono abertos \(1\): #2; o texto de cada um, com o comando: node ".+pedidos\.js" --abertos --frente frente-x\n/, s5);
  assert.match(s5, /- pedidos sem frente abertos \(3\): o texto, com o comando: node ".+pedidos\.js" --abertos\n/, s5);
  const v = hc.montar(dir, { slug: 'x', hoje: HOJE, frente: 'frente-x' }).texto;
  assert.ok(v.indexOf('pedidos sem frente') === -1, 'vinculada, so a lista da frente: ' + v);
  assert.match(v, /- pedidos do dono abertos \(1\): #2;/);
});

test('F4c conferir: cada defeito do prompt da a sua mensagem', () => {
  const dir = projeto();
  const p = preenchido(dir);
  const so = function (texto, re) {
    const r = hc.conferir(texto, p.caminho);
    assert.strictEqual(r.problemas.length, 1, r.problemas.join(' | '));
    assert.match(r.problemas[0], re);
  };
  so(p.texto.replace(/^```$/gm, ''), /sem o bloco do prompt/);
  so(p.texto + 'texto depois\n', /o ultimo bloco do arquivo/);
  so(p.texto.split('2026-11-13-x.md').join('2026-11-13-y.md'), /nao cita o arquivo 2026-11-13-x\.md/);
  so(p.texto.replace(/```\n[\s\S]*\n```\n$/, '```\nleia ' + p.caminho + '\n```\n'), /caracteres/);
  const forDa8 = p.texto.replace('## 8. Prompt\n', '').replace(/```\n$/, '```\n## 8. Prompt\n');
  assert.match(hc.conferir(forDa8, p.caminho).problemas.join(' | '), /o bloco da secao 8/);
});

// ---------------------------------------------------------------- os comandos
// R5 (D939): o handoff que cita o que nao existe no disco manda o chat novo atras do que nao ha
test('R5 conferir: com a raiz, o caminho, o simbolo e o script citados entre crases que nao existem reprovam', () => {
  const dir = projeto();
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scripts', 'existe.js'), 'function vivo() {}\n');
  const p = preenchido(dir);
  const com = function (linha) { return p.texto.replace('## 6. Erros de metodo', '## 6. Erros de metodo\n' + linha); };
  const op = { raiz: dir, arquivos: ['scripts/existe.js'] };
  assert.deepStrictEqual(hc.conferir(p.texto, p.caminho, op).problemas, [], 'o montado, sem citacao torta, passa');
  assert.deepStrictEqual(hc.conferir(com('- siga em `scripts/existe.js` -> `vivo`, e no nome curto `existe.js`'), p.caminho, op).problemas, []);
  const sumiu = hc.conferir(com('- siga em `scripts/sumiu.js`'), p.caminho, op);
  assert.strictEqual(sumiu.ok, false);
  assert.match(sumiu.problemas.join(' | '), /a linha \d+ cita `scripts\/sumiu\.js`: nao existe/);
  assert.match(hc.conferir(com('- `scripts/existe.js` -> `morto`'), p.caminho, op).problemas.join(' | '), /cita `morto`: nao aparece em scripts\/existe\.js/);
  assert.match(hc.conferir(com('- rode `node scripts/sumiu.js`'), p.caminho, op).problemas.join(' | '), /cita `node scripts\/sumiu\.js`: o script scripts\/sumiu\.js nao existe/);
  assert.deepStrictEqual(hc.conferir(com('- criar `scripts/sumiu.js`'), p.caminho, op).problemas, [], 'o que a linha diz que sera criado passa');
  assert.deepStrictEqual(hc.conferir(com('- sem caixa nem requisito: - [ ] passo `scripts/existe.js`'), p.caminho, op).problemas, [],
    'as regras de caixa e de requisito sao do plano, nao do handoff');
  assert.deepStrictEqual(hc.conferir(com('```\n`scripts/sumiu.js`\n```'), p.caminho, op).problemas.filter(function (x) { return /cita/.test(x); }), [],
    'o bloco de codigo fica de fora');
  assert.deepStrictEqual(hc.conferir(com('- siga em `scripts/sumiu.js`'), p.caminho).problemas, [], 'sem a raiz, so a forma');
  // o git que nao respondeu (null) e "nao sei": o nome curto nao se confere, o caminho com pasta segue conferido
  const semGit = { raiz: dir, arquivos: null };
  assert.deepStrictEqual(hc.conferir(com('- siga em `sumiu.js`'), p.caminho, semGit).problemas, [], 'sem a lista do git, o nome curto nao reprova');
  assert.match(hc.conferir(com('- siga em `scripts/sumiu.js`'), p.caminho, semGit).problemas.join(' | '), /cita `scripts\/sumiu\.js`/);
  assert.match(hc.conferir(com('- `scripts/existe.js` -> `morto`'), p.caminho, semGit).problemas.join(' | '), /cita `morto`/,
    'sem a lista do git, o simbolo ausente segue reprovando');
  assert.match(hc.conferir(com('- siga em `sumiu.js`'), p.caminho, { raiz: dir, arquivos: [] }).problemas.join(' | '), /cita `sumiu\.js`/,
    'com a lista do git, mesmo vazia, o nome curto ausente reprova');
});

test('R5 avisoDeCitacao fora do git: o nome curto que existe numa subpasta nao avisa; o caminho com pasta ausente avisa', () => {
  const dir = comum.pasta('hc-sem-git');
  fs.mkdirSync(path.join(dir, 'docs', 'fundo'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'fundo', 'curto-unico.md'), 'x\n');
  const h = path.join(dir, '.sworn', 'handoff', '2026-11-13-r5.md');
  fs.mkdirSync(path.dirname(h), { recursive: true });
  fs.writeFileSync(h, '# Handoff\nVeja `curto-unico.md`.\n');
  assert.strictEqual(hc.avisoDeCitacao(dir, h), null);
  fs.writeFileSync(h, '# Handoff\nVeja `curto-unico.md` e `docs/sumiu.md`.\n');
  assert.match(hc.avisoDeCitacao(dir, h), /cita `docs\/sumiu\.md`/);
  assert.doesNotMatch(hc.avisoDeCitacao(dir, h), /curto-unico/);
});

test('R5 comandos: --conferir confere no disco, a partir da pasta onde roda, o que o handoff cita', () => {
  const dir = projeto({ 'docs/fundo/curto-unico.md': 'x\n' });
  const r = comum.scriptComoProcesso('scripts/handoff-curto.js', ['--slug', 'x', '--frente', 'frente-x', '--hoje', HOJE], { cwd: dir });
  assert.strictEqual(r.status, 0, r.stderr);
  const alvo = path.join(dir, '.sworn', 'handoff', '2026-11-13-x.md');
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  const texto = r.stdout.replace(/^arquivo: [^\n]*\n\n/, '').replace(/<<[A-Z]+:[^>]*>>/g, 'preenchido');
  // o nome curto (`curto-unico.md`, rastreado em docs/fundo/) so se acha pela lista do git
  fs.writeFileSync(alvo, texto.replace('## 6. Erros de metodo', '## 6. Erros de metodo\n- siga em `docs/sumiu.md`, em `curto-unico.md` e em `curto-nada.md`'));
  const c = comum.scriptComoProcesso('scripts/handoff-curto.js', ['--conferir', alvo], { cwd: dir });
  assert.strictEqual(c.status, 1, c.stdout);
  assert.match(JSON.parse(c.stdout).problemas.join(' | '), /cita `docs\/sumiu\.md`/);
  // no repositorio, com a lista do git, o nome curto que nao esta em parte alguma reprova
  assert.match(JSON.parse(c.stdout).problemas.join(' | '), /cita `curto-nada\.md`/);
  assert.doesNotMatch(JSON.parse(c.stdout).problemas.join(' | '), /curto-unico/);
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'sumiu.md'), 'x\n');
  fs.writeFileSync(path.join(dir, 'curto-nada.md'), 'x\n');
  const passou = comum.scriptComoProcesso('scripts/handoff-curto.js', ['--conferir', alvo], { cwd: dir });
  assert.strictEqual(passou.status, 0, passou.stdout);
});

test('R5 avisoDeCitacao: so a citacao ausente avisa, ate 3 e o resto contado; o nome curto rastreado passa', () => {
  const dir = projeto({ 'docs/fundo/curto-unico.md': 'x\n' });
  const h = path.join(dir, '.sworn', 'handoff', '2026-11-13-r5.md');
  fs.mkdirSync(path.dirname(h), { recursive: true });
  assert.strictEqual(hc.avisoDeCitacao(dir, h), null, 'o handoff que nao se le avisou');
  // sem as secoes, com marca sobrando e com o nome curto rastreado: nada disso e citacao ausente
  fs.writeFileSync(h, '# Handoff\n<<FALTA: x>>\nVeja `curto-unico.md` e `a.js`.\n');
  assert.strictEqual(hc.avisoDeCitacao(dir, h), null);
  fs.writeFileSync(h, '# Handoff\n' + ['um', 'dois', 'tres', 'quatro', 'cinco'].map(function (n) {
    return 'Veja `docs/' + n + '.md`.';
  }).join('\n') + '\n');
  const a = hc.avisoDeCitacao(dir, h);
  assert.match(a, /^sworn: o handoff 2026-11-13-r5\.md cita o que nao existe no disco: /);
  assert.match(a, /docs\/tres\.md/);
  assert.doesNotMatch(a, /docs\/quatro\.md/);
  assert.match(a, /\(e mais 2\)\. Corrija com Edit antes de seguir\.$/);
  fs.writeFileSync(h, '# Handoff\nVeja `docs/um.md`, `docs/dois.md`, `docs/tres.md`.\nE `docs/quatro.md`.\n');
  assert.match(hc.avisoDeCitacao(dir, h), /docs\/tres\.md`[^;]* \(e mais 1\)\. Corrija/);
  fs.writeFileSync(h, '# Handoff\nVeja `docs/um.md`, `docs/dois.md`, `docs/tres.md`.\n');
  assert.doesNotMatch(hc.avisoDeCitacao(dir, h), /e mais/);
});

test('F4c comandos: handoff-curto.js imprime o destino e o texto; --conferir sai 1 com marca sobrando', () => {
  const dir = projeto();
  const r = comum.scriptComoProcesso('scripts/handoff-curto.js', ['--slug', 'x', '--frente', 'frente-x', '--hoje', HOJE], { cwd: dir });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /^arquivo: \.sworn\/handoff\/2026-11-13-x\.md\n\n# Handoff/);
  const alvo = path.join(dir, '.sworn', 'handoff', '2026-11-13-x.md');
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, r.stdout.replace(/^arquivo: [^\n]*\n\n/, ''));
  const c = comum.scriptComoProcesso('scripts/handoff-curto.js', ['--conferir', alvo], { cwd: dir });
  assert.strictEqual(c.status, 1);
  assert.strictEqual(JSON.parse(c.stdout).ok, false);
  fs.writeFileSync(alvo, fs.readFileSync(alvo, 'utf8').replace(/<<[A-Z]+:[^>]*>>/g, 'preenchido'));
  const passou = comum.scriptComoProcesso('scripts/handoff-curto.js', ['--conferir', alvo], { cwd: dir });
  assert.strictEqual(passou.status, 0, passou.stdout);
  assert.strictEqual(JSON.parse(passou.stdout).ok, true);
  const relativo = comum.scriptComoProcesso('scripts/handoff-curto.js', ['--conferir', '.sworn/handoff/2026-11-13-x.md'], { cwd: dir });
  assert.strictEqual(relativo.status, 0, relativo.stdout);
  const ausente = comum.scriptComoProcesso('scripts/handoff-curto.js', ['--conferir', 'nao-existe.md'], { cwd: dir });
  assert.strictEqual(ausente.status, 2);
  assert.match(ausente.stderr, /nao consegui ler .*nao-existe\.md/);
  const sem = comum.scriptComoProcesso('scripts/handoff-curto.js', [], { cwd: dir });
  assert.strictEqual(sem.status, 2);
  assert.match(sem.stderr, /--slug/);
  for (const c of [[['--slug', 'X'], /slug do handoff invalido/], [['--slug', 'x', '--hoje'], /--hoje pede a data/],
    [['--slug', 'x', '--hoje', '2026-02-30'], /--hoje fora do formato/], [['--slug', '--frente', 'f'], /passe --slug/],
    [['--slug', 'x', '--frente'], /--frente pede o nome/], [['--slug', 'x', '--sessao', '--frente', 'f'], /--sessao pede o id/]]) {
    const r2 = comum.scriptComoProcesso('scripts/handoff-curto.js', c[0], { cwd: dir });
    assert.strictEqual(r2.status, 2, c[0].join(' '));
    assert.match(r2.stderr, c[1], c[0].join(' '));
  }
});

test('F4c comandos: pendencias.js adiciona, lista e fecha; erro de uso sai 2 com a mensagem', () => {
  const dir = comum.pasta('pend-cli');
  const a = comum.scriptComoProcesso('scripts/pendencias.js', ['--adicionar', '--dono', 'Ana', '--texto', 'publicar'], { cwd: dir });
  assert.strictEqual(a.status, 0, a.stderr);
  assert.match(a.stdout, /#1/);
  const l = comum.scriptComoProcesso('scripts/pendencias.js', ['--listar'], { cwd: dir });
  assert.strictEqual(JSON.parse(l.stdout).abertas.length, 1);
  const f = comum.scriptComoProcesso('scripts/pendencias.js', ['--fechar', '1', '--como', 'publicada'], { cwd: dir });
  assert.strictEqual(f.status, 0, f.stderr);
  assert.strictEqual(JSON.parse(comum.scriptComoProcesso('scripts/pendencias.js', ['--listar'], { cwd: dir }).stdout).abertas.length, 0);
  const e = comum.scriptComoProcesso('scripts/pendencias.js', ['--adicionar', '--texto', 'sem dono'], { cwd: dir });
  assert.strictEqual(e.status, 2);
  assert.match(e.stderr, /sem --dono/);
  const dois = comum.scriptComoProcesso('scripts/pendencias.js', ['--listar', '--fechar', '1'], { cwd: dir });
  assert.strictEqual(dois.status, 2);
  assert.match(dois.stderr, /um modo por vez/);
  const valorFalta = comum.scriptComoProcesso('scripts/pendencias.js', ['--adicionar', '--dono', '--texto', 'x'], { cwd: dir });
  assert.strictEqual(valorFalta.status, 2, 'opcao no lugar do valor conta como valor faltando');
  assert.strictEqual(comum.scriptComoProcesso('scripts/pendencias.js', ['--fechar', '9', '--como', 'x'], { cwd: dir }).status, 2);
  const quebrado = comum.pasta('pend-cli-quebrado');
  fs.mkdirSync(path.join(quebrado, pend.ARQUIVO), { recursive: true });
  const lq = comum.scriptComoProcesso('scripts/pendencias.js', ['--listar'], { cwd: quebrado });
  assert.strictEqual(lq.status, 1, 'arquivo que nao se le sai 1');
  assert.match(JSON.parse(lq.stdout).erro, /pasta \(EISDIR\)/);
  assert.match(lq.stderr, /nao consegui ler/);
  assert.strictEqual(comum.scriptComoProcesso('scripts/pendencias.js', ['--adicionar', '--dono', 'A', '--texto', 'x'], { cwd: quebrado }).status, 1);
});
