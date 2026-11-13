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
  assert.ok(!/[^\x00-\x7f]/.test(t.split(dir.replace(/\\/g, '/')).join('')), 'o texto fixo e ASCII (chega a terminal de qualquer pagina de codigo)');
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
  const mostradas = (secao5.match(/^ {2}- #\d+ /gm) || []).length;
  assert.ok(mostradas < 10, 'mostrou ' + mostradas);
  assert.match(secao5, new RegExp('e mais ' + (12 - mostradas) + ' no arquivo'));
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
test('F4c comandos: handoff-curto.js imprime o destino e o texto; --conferir sai 1 com marca sobrando', () => {
  const dir = projeto();
  const r = comum.rodar('scripts/handoff-curto.js', ['--slug', 'x', '--frente', 'frente-x', '--hoje', HOJE], { cwd: dir });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /^arquivo: \.sworn\/handoff\/2026-11-13-x\.md\n\n# Handoff/);
  const alvo = path.join(dir, '.sworn', 'handoff', '2026-11-13-x.md');
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, r.stdout.replace(/^arquivo: [^\n]*\n\n/, ''));
  const c = comum.rodar('scripts/handoff-curto.js', ['--conferir', alvo], { cwd: dir });
  assert.strictEqual(c.status, 1);
  assert.strictEqual(JSON.parse(c.stdout).ok, false);
  fs.writeFileSync(alvo, fs.readFileSync(alvo, 'utf8').replace(/<<[A-Z]+:[^>]*>>/g, 'preenchido'));
  const passou = comum.rodar('scripts/handoff-curto.js', ['--conferir', alvo], { cwd: dir });
  assert.strictEqual(passou.status, 0, passou.stdout);
  assert.strictEqual(JSON.parse(passou.stdout).ok, true);
  const relativo = comum.rodar('scripts/handoff-curto.js', ['--conferir', '.sworn/handoff/2026-11-13-x.md'], { cwd: dir });
  assert.strictEqual(relativo.status, 0, relativo.stdout);
  const ausente = comum.rodar('scripts/handoff-curto.js', ['--conferir', 'nao-existe.md'], { cwd: dir });
  assert.strictEqual(ausente.status, 2);
  assert.match(ausente.stderr, /nao consegui ler .*nao-existe\.md/);
  const sem = comum.rodar('scripts/handoff-curto.js', [], { cwd: dir });
  assert.strictEqual(sem.status, 2);
  assert.match(sem.stderr, /--slug/);
  for (const c of [[['--slug', 'X'], /slug do handoff invalido/], [['--slug', 'x', '--hoje'], /--hoje pede a data/],
    [['--slug', 'x', '--hoje', '2026-02-30'], /--hoje fora do formato/], [['--slug', '--frente', 'f'], /passe --slug/],
    [['--slug', 'x', '--frente'], /--frente pede o nome/], [['--slug', 'x', '--sessao', '--frente', 'f'], /--sessao pede o id/]]) {
    const r2 = comum.rodar('scripts/handoff-curto.js', c[0], { cwd: dir });
    assert.strictEqual(r2.status, 2, c[0].join(' '));
    assert.match(r2.stderr, c[1], c[0].join(' '));
  }
});

test('F4c comandos: pendencias.js adiciona, lista e fecha; erro de uso sai 2 com a mensagem', () => {
  const dir = comum.pasta('pend-cli');
  const a = comum.rodar('scripts/pendencias.js', ['--adicionar', '--dono', 'Ana', '--texto', 'publicar'], { cwd: dir });
  assert.strictEqual(a.status, 0, a.stderr);
  assert.match(a.stdout, /#1/);
  const l = comum.rodar('scripts/pendencias.js', ['--listar'], { cwd: dir });
  assert.strictEqual(JSON.parse(l.stdout).abertas.length, 1);
  const f = comum.rodar('scripts/pendencias.js', ['--fechar', '1', '--como', 'publicada'], { cwd: dir });
  assert.strictEqual(f.status, 0, f.stderr);
  assert.strictEqual(JSON.parse(comum.rodar('scripts/pendencias.js', ['--listar'], { cwd: dir }).stdout).abertas.length, 0);
  const e = comum.rodar('scripts/pendencias.js', ['--adicionar', '--texto', 'sem dono'], { cwd: dir });
  assert.strictEqual(e.status, 2);
  assert.match(e.stderr, /sem --dono/);
  const dois = comum.rodar('scripts/pendencias.js', ['--listar', '--fechar', '1'], { cwd: dir });
  assert.strictEqual(dois.status, 2);
  assert.match(dois.stderr, /um modo por vez/);
  const valorFalta = comum.rodar('scripts/pendencias.js', ['--adicionar', '--dono', '--texto', 'x'], { cwd: dir });
  assert.strictEqual(valorFalta.status, 2, 'opcao no lugar do valor conta como valor faltando');
  assert.strictEqual(comum.rodar('scripts/pendencias.js', ['--fechar', '9', '--como', 'x'], { cwd: dir }).status, 2);
  const quebrado = comum.pasta('pend-cli-quebrado');
  fs.mkdirSync(path.join(quebrado, pend.ARQUIVO), { recursive: true });
  const lq = comum.rodar('scripts/pendencias.js', ['--listar'], { cwd: quebrado });
  assert.strictEqual(lq.status, 1, 'arquivo que nao se le sai 1');
  assert.match(JSON.parse(lq.stdout).erro, /pasta \(EISDIR\)/);
  assert.match(lq.stderr, /nao consegui ler/);
  assert.strictEqual(comum.rodar('scripts/pendencias.js', ['--adicionar', '--dono', 'A', '--texto', 'x'], { cwd: quebrado }).status, 1);
});
