'use strict';
// F2c (D828): o contrato do que o trecho usa entra no pacote da revisao cega (scripts/lib/contrato.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const barra = (p) => String(p).split(String.fromCharCode(92)).join('/'); // A3-15: a saida usa barra normal
const comum = require('./lib/comum.js');
const cegar = require('../scripts/lib/cegar.js');
const contrato = require('../scripts/lib/contrato.js');

// n linhas de enchimento, sem nome que o contrato possa achar e sem ser comentario (o comentario logo acima de uma
// definicao entra com ela)
const enche = function (n) { return new Array(n).fill('void 0;').join('\n'); };
const bloco = function (ini, qtd) { return [{ ini: ini, qtd: qtd === undefined ? 1 : qtd }]; };
// a linha (de 1) de um texto que comeca com `inicio`
const linhaDe = function (texto, inicio) {
  const i = texto.split('\n').findIndex(function (l) { return l.startsWith(inicio); });
  assert.ok(i >= 0, 'sem a linha ' + inicio);
  return i + 1;
};
const doMesmo = function (texto, ini, qtd, extra) {
  return contrato.doTrecho(Object.assign({ lados: [{ texto: texto, blocos: bloco(ini, qtd) },
    { texto: texto, blocos: bloco(ini, qtd) }], margem: 0, rel: 'src/a.js', raiz: comum.RAIZ }, extra || {}));
};
// as linhas (de 1) que as faixas cobrem
const cobre = function (faixas) {
  const s = new Set();
  for (const f of faixas) for (let i = f.ini; i <= f.fim; i++) s.add(i);
  return s;
};

test('F2c: recortarTrecho com extras deixa a mostra as linhas pedidas, sem margem, e marca cada vao', () => {
  const t = Array.from({ length: 10 }, function (_, i) { return 'l ' + (i + 1); }).join('\n') + '\n';
  assert.deepStrictEqual(cegar.recortarTrecho(t, bloco(8), 0, [{ ini: 2, fim: 3 }]).split('\n'),
    ['[fora do trecho: linhas 1-1]', 'l 2', 'l 3', '[fora do trecho: linhas 4-7]', '', '', '', 'l 8',
      '[fora do trecho: linhas 9-10]', '', '']);
  // sem extras (ou lista vazia), o recorte de antes
  assert.strictEqual(cegar.recortarTrecho(t, bloco(8), 0, []), cegar.recortarTrecho(t, bloco(8), 0));
  // extra alem do fim nao quebra: vale ate a ultima linha
  assert.strictEqual(cegar.recortarTrecho(t, bloco(1), 0, [{ ini: 10, fim: 99 }]).split('\n')[9], 'l 10');
  // extra invalido: na duvida, o arquivo inteiro (como bloco invalido)
  for (const ex of [null, 'x', [{ ini: 0, fim: 1 }], [{ ini: 3, fim: 2 }], [{ ini: 1.5, fim: 2 }], [{ ini: 1 }], [null]]) {
    assert.strictEqual(cegar.recortarTrecho(t, bloco(8), 0, ex), t, JSON.stringify(ex));
  }
  assert.strictEqual(cegar.linhasDoTrecho(10, [], 0), null);
  assert.deepStrictEqual(cegar.linhasDoTrecho(3, bloco(2), 0, [{ ini: 3, fim: 3 }]), [false, true, true]);
});

test('F2c: do proprio arquivo, o require e a definicao de topo do que o trecho usa ficam a mostra', () => {
  const texto = [
    "const fs = require('node:fs');",
    "const { join, dirname: pai } = require('node:path');",
    '// soma dois numeros',
    'function somar(a, b) {',
    '  return a + b;',
    '}',
    'const longa = function (x) {',
    enche(20),
    '};',
    // a definicao de uma linha so nao procura fecho: a funcao logo abaixo fica fora
    'const LIMITE = 10;',
    'function naoUsada() {',
    '  return 1;',
    '}',
    enche(5),
    'function usar() {',
    "  return somar(LIMITE, longa(fs.existsSync(join('a', pai('b')))));",
    '}',
    ''
  ].join('\n');
  const uso = linhaDe(texto, '  return somar(');
  const c = doMesmo(texto, uso);
  const vistas = cobre(c.extras[1]);
  assert.deepStrictEqual(c.extras[0], c.extras[1], 'os dois lados iguais pedem as mesmas linhas');
  assert.ok(vistas.has(1), 'o require do fs');
  assert.ok(vistas.has(2), 'o require desestruturado, pelo nome local (pai)');
  for (let i = linhaDe(texto, '// soma'); i <= linhaDe(texto, '}'); i++) assert.ok(vistas.has(i), 'somar inteira: ' + i);
  assert.ok(vistas.has(linhaDe(texto, 'const LIMITE')));
  // definicao longa (sem comentario em cima): so a linha da assinatura
  const ini = linhaDe(texto, 'const longa');
  assert.ok(vistas.has(ini) && !vistas.has(ini + 1), 'longa: so a assinatura');
  assert.ok(!vistas.has(linhaDe(texto, 'function naoUsada')), 'o que o trecho nao usa fica fora');
  assert.strictEqual(c.texto, null, 'sem modulo relativo, sem contrato.txt');
  // o recorte com os extras mostra as linhas e mantem o numero de linhas
  const r = cegar.recortarTrecho(texto, bloco(uso), 0, c.extras[1]).split('\n');
  assert.strictEqual(r.length, texto.split('\n').length);
  assert.strictEqual(r[linhaDe(texto, 'function somar') - 1], 'function somar(a, b) {');
  // a naoUsada vem logo depois do LIMITE (a mostra): abre o vao, com a marca
  assert.match(r[linhaDe(texto, 'function naoUsada') - 1], /^\[fora do trecho: linhas \d+-\d+\]$/);
});

test('F2c: o fecho da definicao segue o saldo de chaves e parenteses, e o comentario de cima tem teto', () => {
  // assinatura em varias linhas: o `) {` nao fecha a funcao
  const multi = ['function f(', '  a,', '  b', ') {', '  return a;', '}', 'const depois = 1;'];
  assert.deepStrictEqual(contrato.faixaDaDefinicao(multi, 0), { ini: 0, fim: 5 });
  // objeto e seta com o valor na linha de baixo
  assert.deepStrictEqual(contrato.faixaDaDefinicao(['const O = {', '  a: { b: 1 },', '};', 'x'], 0), { ini: 0, fim: 2 });
  assert.deepStrictEqual(contrato.faixaDaDefinicao(['const g = (x) =>', '  x + 1;', 'const h = 2;'], 0), { ini: 0, fim: 1 });
  // chave dentro de aspas nao conta
  assert.deepStrictEqual(contrato.faixaDaDefinicao(["const s = '{';", 'const t = 1;'], 0), { ini: 0, fim: 0 });
  // o comentario de cima: no maximo TETO_COMENTARIO linhas
  const comentado = new Array(contrato.TETO_COMENTARIO + 3).fill('// linha').concat(['const k = 1;']);
  const s = comentado.length - 1;
  assert.deepStrictEqual(contrato.faixaDaDefinicao(comentado, s), { ini: s - contrato.TETO_COMENTARIO, fim: s });
});

test('F2c: nome em string, em comentario, definido duas vezes ou so dentro de funcao nao puxa nada', () => {
  const texto = [
    'function dupla() { return 1; }',
    'function dupla() { return 2; }',
    'function soNoTexto() { return 3; }',
    'function soNoComentario() { return 4; }',
    'function externa() {',
    '  function interna() { return 5; }',
    '  return interna();',
    '}',
    enche(5),
    "const r = dupla() + interna() + 'soNoTexto()'; // soNoComentario()",
    ''
  ].join('\n');
  const c = doMesmo(texto, linhaDe(texto, 'const r ='));
  assert.deepStrictEqual(c.extras, [[], []]);
});

test('F2c: a uniao dos dois lados - o nome que so um lado usa mostra a definicao nos dois, na numeracao de cada um', () => {
  const topo = ['function ajudante() {', '  return 1;', '}', enche(5)];
  const velho = topo.concat(['const v = ajudante();', '']).join('\n');
  // o lado novo tem 3 linhas a mais no comeco: a mesma definicao, 3 linhas abaixo
  const novo = ['void 1;', 'void 2;', 'void 3;'].concat(topo, ['const v = 2;', '']).join('\n');
  const c = contrato.doTrecho({ lados: [{ texto: velho, blocos: bloco(linhaDe(velho, 'const v')) },
    { texto: novo, blocos: bloco(linhaDe(novo, 'const v')) }], margem: 0, rel: 'a.js', raiz: comum.RAIZ });
  assert.deepStrictEqual(c.extras[0], [{ ini: 1, fim: 3 }]);
  assert.deepStrictEqual(c.extras[1], [{ ini: 4, fim: 6 }], 'o lado que nao usa tambem mostra: a escolha nao revela o lado');
});

test('F2c: dois nomes do mesmo require pedem a linha uma vez so', () => {
  const texto = ["const { a, b } = require('./x');", enche(3), 'const r = a() + b();', ''].join('\n');
  assert.deepStrictEqual(doMesmo(texto, linhaDe(texto, 'const r')).extras[1], [{ ini: 1, fim: 1 }]);
});

test('F2c: de outro modulo, o contrato.txt traz o comentario e a assinatura (ou a definicao curta)', () => {
  // a raiz e uma subpasta, para o fora.js existir de verdade fora dela
  const raiz = path.join(comum.pasta('contrato'), 'raiz');
  fs.mkdirSync(path.join(raiz, 'src', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'src', 'lib', 'util.js'), [
    "'use strict';",
    '/** Lê o estado; devolve null quando o arquivo não existe. */',
    'function ler(caminho) {',
    '  return null;',
    '}',
    '// muda o estado e devolve o novo',
    'function alterar(id, fn) {',
    enche(30),
    '}',
    'exports.versao = 3;',
    'module.exports.tamanho = function (x) { return x.length; };',
    // a funcao e o exports dela sao uma definicao so; o nome definido duas vezes e ambiguo
    'function viaExport() { return 1; }',
    'exports.viaExport = viaExport;',
    'function dupla() { return 1; }',
    'function dupla() { return 2; }',
    'module.exports = { ler, alterar };',
    ''
  ].join('\n'));
  fs.writeFileSync(path.join(raiz, '..', 'fora.js'), 'function segredo() {}\n');
  const texto = [
    "const util = require('./lib/util');",
    "const { ler: lerEstado } = require('./lib/util.js');",
    "const versao = require('./lib/util').versao;",
    "const fora = require('../../fora.js');",
    "const nada = require('./lib/nao-existe');",
    enche(5),
    'const s = util.alterar(lerEstado(1), util.sumida) + versao + util.tamanho(fora.segredo(nada.x)) + util.viaExport() +',
    '  util.dupla();',
    ''
  ].join('\n');
  const c = contrato.doTrecho({ lados: [{ texto: texto, blocos: bloco(linhaDe(texto, 'const s'), 2) },
    { texto: texto, blocos: bloco(linhaDe(texto, 'const s'), 2) }], margem: 0, rel: 'src/a.js', raiz: raiz });
  assert.ok(c.texto, 'ha contrato.txt');
  // o que o script escreve vai em ASCII; o codigo copiado vai como esta no disco, com o acento
  const cabeca = c.texto.split('\n\n')[0];
  assert.match(cabeca, /^[\x20-\x7E]+$/, 'o cabecalho vai ao modelo: so ASCII');
  assert.match(cabeca, /never cite contrato\.txt in a finding/);
  const notas = c.texto.slice(c.texto.indexOf('\nNot found'));
  assert.match(notas, /^[\x0A\x20-\x7E]+$/, 'as notas do fim: so ASCII');
  // o desestruturado pelo nome exportado, com a definicao curta inteira e o comentario de cima
  assert.match(c.texto, /== src\/lib\/util\.js:2-5 {2}ler \(used as `lerEstado`\)\n\/\*\* Lê o estado; devolve null quando o arquivo não existe\. \*\/\nfunction ler\(caminho\) \{\n {2}return null;\n\}\n/);
  // a longa: comentario e assinatura, sem o corpo
  assert.match(c.texto, /== src\/lib\/util\.js:6-7 {2}alterar \(used as `util\.alterar`\)\n\/\/ muda o estado e devolve o novo\nfunction alterar\(id, fn\) \{\n/);
  assert.doesNotMatch(c.texto, /void 0/, 'o corpo longo fica fora');
  // exports.x = e module.exports.x =, e o require(...).membro
  assert.match(c.texto, /versao \(used as `versao`\)\nexports\.versao = 3;/);
  assert.match(c.texto, /tamanho \(used as `util\.tamanho`\)/);
  assert.match(c.texto, /viaExport \(used as `util\.viaExport`\)\nfunction viaExport\(\) \{ return 1; \}\n/);
  // o membro que o modulo nao define, o modulo fora da raiz e o que nao existe vao na linha do que nao se achou,
  // e nada do arquivo de fora entra
  assert.match(c.texto, /Not found as a single top-level definition: util\.sumida \(src\/lib\/util\.js\), fora\.segredo \(module \.\.\/\.\.\/fora\.js not found inside the project\), nada\.x \(module \.\/lib\/nao-existe not found inside the project\), util\.dupla \(src\/lib\/util\.js\)\.\n/);
  assert.doesNotMatch(c.texto, /function segredo|return 2/);
  assert.strictEqual(c.nomes, 5);
});

test('F2c: so nao achado ainda gera o contrato.txt, e a fronteira da raiz vale por pasta e pelo caminho real', () => {
  const pai = comum.pasta('contrato-raiz');
  const raiz = path.join(pai, 'proj');
  fs.mkdirSync(path.join(raiz, '..x'), { recursive: true });
  fs.mkdirSync(path.join(pai, 'proj-irma'), { recursive: true });
  fs.writeFileSync(path.join(raiz, '..x', 'dentro.js'), 'function d() { return 1; }\n');
  fs.writeFileSync(path.join(pai, 'proj-irma', 'irma.js'), 'function i() { return 2; }\n');
  fs.writeFileSync(path.join(pai, 'fora.js'), 'function f() { return 3; }\n');
  // juncao de pasta: o Windows cria sem permissao especial; fora dele, o tipo e ignorado e vira link de pasta
  fs.mkdirSync(path.join(pai, 'de-fora'));
  fs.writeFileSync(path.join(pai, 'de-fora', 'link.js'), 'function d() { return 3; }\n');
  let comLink = true;
  try { fs.symlinkSync(path.join(pai, 'de-fora'), path.join(raiz, 'ponte'), 'junction'); } catch (e) { comLink = false; }
  const roda = function (linhas) {
    const t = linhas.concat([enche(3), 'const r = ' + linhas.map(function (_, k) { return 'm' + k + '.' + 'dif'[k % 3] + '()'; }).join(' + ') + ';', '']).join('\n');
    return contrato.doTrecho({ lados: [{ texto: t, blocos: bloco(linhaDe(t, 'const r')) },
      { texto: t, blocos: bloco(linhaDe(t, 'const r')) }], margem: 0, rel: 'a.js', raiz: raiz });
  };
  // `..x` e nome de pasta dentro da raiz; a pasta irma com o mesmo comeco de nome fica fora
  const c = roda(["const m0 = require('./..x/dentro');", "const m1 = require('../proj-irma/irma');"]);
  assert.match(c.texto, /== \.\.x\/dentro\.js:1-1 {2}d /);
  assert.match(c.texto, /m1\.i \(module \.\.\/proj-irma\/irma not found inside the project\)/);
  assert.doesNotMatch(c.texto, /return 2/);
  // so o que nao se achou: o contrato.txt sai mesmo sem entrada nenhuma
  const so = roda(["const m0 = require('../proj-irma/irma');"]);
  assert.strictEqual(so.nomes, 0);
  assert.match(so.texto, /^Contract of what the excerpt uses[\s\S]*\nNot found as a single top-level definition: m0\.d /);
  // o link simbolico dentro da raiz que aponta para fora fica fora (sem permissao de criar link, o caso nao roda)
  assert.ok(comLink || process.platform !== 'win32', 'a juncao de pasta tem de criar no Windows');
  if (comLink) {
    const l = roda(["const m0 = require('./ponte/link');"]);
    assert.doesNotMatch(l.texto, /return 3/);
    assert.match(l.texto, /m0\.d \(module \.\/ponte\/link not found inside the project\)/);
  }
});

test('F2c: os tetos - linhas a mais por lado e entradas no contrato.txt', () => {
  const defs = [];
  const usos = [];
  for (let i = 0; i < 20; i++) {
    defs.push('function f' + i + '() {', enche(contrato.TETO_DEF - 3), '}');
    usos.push('f' + i + '()');
  }
  const texto = defs.concat([enche(3), 'const r = ' + usos.join(' + ') + ';', '']).join('\n');
  const c = doMesmo(texto, linhaDe(texto, 'const r'));
  const total = c.extras[1].reduce(function (s, f) { return s + f.fim - f.ini + 1; }, 0);
  // os valores pedidos pela F2c, e o teto cheio ate onde cabe: as primeiras definicoes inteiras, o resto cortado
  assert.deepStrictEqual([contrato.TETO_DEF, contrato.TETO_EXTRAS, contrato.TETO_ENTRADAS, contrato.TETO_BYTES,
    contrato.TETO_COMENTARIO], [15, 120, 30, 60000, 12]);
  const porDef = contrato.TETO_DEF - 1;
  assert.strictEqual(total, Math.floor(contrato.TETO_EXTRAS / porDef) * porDef, 'o teto guarda o que cabe: ' + total);
  assert.deepStrictEqual(c.extras[1][0], { ini: 1, fim: porDef }, 'a primeira definicao, inteira');
  assert.ok(c.cortadosDoProprio.indexOf('f19') !== -1 && c.cortadosDoProprio.indexOf('f0') === -1);
  assert.deepStrictEqual(c.cortados, [], 'o corte do proprio arquivo nao vai para o contrato.txt');
  assert.strictEqual(c.texto, null);
  // contrato.txt: no maximo TETO_ENTRADAS entradas
  const raiz = comum.pasta('contrato-teto');
  const nomes = Array.from({ length: contrato.TETO_ENTRADAS + 5 }, function (_, i) { return 'g' + i; });
  fs.writeFileSync(path.join(raiz, 'm.js'), nomes.map(function (n) { return 'function ' + n + '() {}'; }).join('\n') + '\n');
  const usa = "const m = require('./m');\n" + enche(3) + '\nconst r = ' + nomes.map(function (n) { return 'm.' + n + '()'; }).join(' + ') + ';\n';
  const c2 = contrato.doTrecho({ lados: [{ texto: usa, blocos: bloco(5) }, { texto: usa, blocos: bloco(5) }], margem: 0,
    rel: 'a.js', raiz: raiz });
  assert.strictEqual(c2.nomes, contrato.TETO_ENTRADAS);
  assert.match(c2.texto, /Left out of this file by its size cap: m\.g30, /);
  // o teto e de bytes, nao de caracteres: uma definicao curta com acento que passa dos 60000 bytes fica fora
  const larga = 'function largo() {\n' + new Array(contrato.TETO_DEF - 2).fill('  // ' + 'é'.repeat(2400)).join('\n') + '\n}\n';
  assert.ok(larga.length < contrato.TETO_BYTES && Buffer.byteLength(larga) > contrato.TETO_BYTES);
  fs.writeFileSync(path.join(raiz, 'l.js'), larga);
  const usaL = "const l = require('./l');\n" + enche(3) + '\nconst r = l.largo();\n';
  const c3 = contrato.doTrecho({ lados: [{ texto: usaL, blocos: bloco(5) }, { texto: usaL, blocos: bloco(5) }], margem: 0,
    rel: 'a.js', raiz: raiz });
  assert.strictEqual(c3.nomes, 0);
  assert.match(c3.texto, /Left out of this file by its size cap: l\.largo\./);
});

test('F2c: arquivo que nao e JavaScript, ou bloco invalido, segue o recorte de antes', () => {
  const t = 'function a() {}\n' + enche(3) + '\na();\n';
  for (const rel of ['a.md', 'a.ts', 'a.json', 'a.txt', '']) {
    assert.deepStrictEqual(doMesmo(t, 5, 1, { rel: rel }),
      { extras: [[], []], texto: null, nomes: 0, cortados: [], cortadosDoProprio: [] }, rel);
  }
  // lados que nao sao dois: tudo vazio, sem lancar
  for (const lados of [undefined, null, [], [{ texto: t, blocos: bloco(5) }]]) {
    assert.deepStrictEqual(contrato.doTrecho({ lados: lados, margem: 0, rel: 'a.js', raiz: comum.RAIZ }).extras, [[], []]);
  }
  // lado vazio (arquivo novo): sem bloco valido nele, tudo vazio
  assert.deepStrictEqual(contrato.doTrecho({ lados: [{ texto: '', blocos: [] }, { texto: t, blocos: bloco(5) }], margem: 0,
    rel: 'a.js', raiz: comum.RAIZ }).extras, [[], []]);
  for (const rel of ['a.js', 'a.cjs', 'a.mjs', 'b/A.JS']) assert.ok(contrato.ehCodigo(rel), rel);
  assert.deepStrictEqual(contrato.doTrecho({ lados: [{ texto: t, blocos: [] }, { texto: t, blocos: bloco(5) }], margem: 0,
    rel: 'a.js', raiz: comum.RAIZ }).extras, [[], []]);
  // CRLF: o numero de linha e o mesmo do arquivo
  const crlf = t.replace(/\n/g, '\r\n');
  assert.deepStrictEqual(doMesmo(crlf, 5).extras[1], [{ ini: 1, fim: 1 }]);
});

test('F2c: preparar-revisao poe o contrato no pacote do recorte de codigo, e so nele', () => {
  const dir = comum.pasta('prep-contrato');
  const ajudante = ['// diz se o valor e par', 'function par(n) {', '  return n % 2 === 0;', '}'];
  const corpo = function (valor) {
    return ["'use strict';", "const util = require('./lib/util.js');"].concat(ajudante, [enche(40),
      'const v = par(' + valor + ') && util.ok();', enche(40), '']).join('\n');
  };
  comum.repo(dir, {
    'src/a.js': corpo(1),
    'src/lib/util.js': '/** sempre verdadeiro */\nfunction ok() { return true; }\nmodule.exports = { ok };\n',
    'notas.md': '# notas\n\n' + enche(60) + '\nlinha velha\n'
  });
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), corpo(2));
  let r = comum.rodar('scripts/preparar-revisao.js', ['--arquivo', 'src/a.js', '--semente', 'fixa'], { cwd: dir });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  let s = JSON.parse(r.stdout);
  assert.strictEqual(s.faixa, 'uma');
  // duas faixas por lado (o require e o ajudante), nos dois lados
  assert.deepStrictEqual(s.trecho, { margem: cegar.TRECHO_MARGEM, extras: 4 });
  assert.strictEqual(s.contrato, barra(path.join(path.dirname(s.a), 'contrato.txt')));
  const c = fs.readFileSync(s.contrato, 'utf8');
  assert.match(c, /== src\/lib\/util\.js:1-2 {2}ok \(used as `util\.ok`\)\n\/\*\* sempre verdadeiro \*\/\nfunction ok\(\) \{ return true; \}\n/);
  for (const lado of [s.a, s.b]) {
    const l = fs.readFileSync(lado, 'utf8').split('\n');
    assert.strictEqual(l[1], "const util = require('./lib/util.js');", 'o require a mostra');
    assert.deepStrictEqual(l.slice(2, 6), ajudante, 'o ajudante inteiro a mostra');
    assert.match(l[0], /^\[fora do trecho: linhas 1-1\]$/);
    assert.match(l[6], /^\[fora do trecho: linhas 7-\d+\]$/);
  }
  assert.match(s.aviso, /contrato\.txt/);
  assert.match(s.aviso, /require e a definicao de topo/);
  assert.match(s.aviso, /^[\x20-\x7E]+$/, 'o aviso vai ao modelo: so ASCII');
  // texto: sem contrato
  fs.writeFileSync(path.join(dir, 'notas.md'), '# notas\n\n' + enche(60) + '\nlinha nova\n');
  r = comum.rodar('scripts/preparar-revisao.js', ['--arquivo', 'notas.md', '--semente', 'fixa'], { cwd: dir });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  s = JSON.parse(r.stdout);
  assert.ok(s.trecho);
  assert.strictEqual(s.contrato, undefined);
  assert.ok(!fs.existsSync(path.join(path.dirname(s.a), 'contrato.txt')));
  assert.doesNotMatch(s.aviso, /contrato/);
  // completa (--completa): o arquivo inteiro, sem contrato
  fs.writeFileSync(path.join(dir, 'src', 'b.js'), corpo(2));
  r = comum.rodar('scripts/preparar-revisao.js', ['--arquivo', 'src/b.js', '--completa', '--semente', 'fixa'], { cwd: dir });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  s = JSON.parse(r.stdout);
  assert.strictEqual(s.faixa, 'completa');
  assert.strictEqual(s.contrato, undefined);
  assert.ok(!fs.existsSync(path.join(path.dirname(s.a), 'contrato.txt')));
  // arquivo novo: um lado vazio, o outro inteiro
  assert.deepStrictEqual([fs.readFileSync(s.a, 'utf8'), fs.readFileSync(s.b, 'utf8')].sort(), ['', corpo(2)]);
});

test('F2c: a skill manda o contrato.txt no briefing e o inspetor pode le-lo, sem cita-lo em achado', () => {
  const skill = fs.readFileSync(path.join(comum.RAIZ, 'skills', 'review', 'SKILL.md'), 'utf8');
  const inspetor = fs.readFileSync(path.join(comum.RAIZ, 'agents', 'inspector.md'), 'utf8');
  assert.match(skill, /When `trecho` also brings `extras`, add right after that line:\n\n> A line kept visible inside a gap is the `require` or the top-level definition of a name the excerpt uses[^\n]*the finding is `pendente`\./);
  assert.match(skill, /When the output of Step 1 also brings `contrato`, add after them:\n\n> Also read `<caminho de contrato\.txt>`:[^\n]*never cite it in a finding/);
  assert.match(inspetor, /a `contrato\.txt` \(what the\n {2}excerpt uses from other files: context, never cited in a finding\)/);
});
