'use strict';
const test = require('node:test');
const assert = require('node:assert');
const texto = require('../scripts/lib/texto.js');

const BOM = String.fromCharCode(65279);

test('texto: remove o BOM inicial', () => {
  assert.strictEqual(texto.semBom(BOM + '{"a":1}'), '{"a":1}');
});

test('texto: string sem BOM fica intacta', () => {
  assert.strictEqual(texto.semBom('{"a":1}'), '{"a":1}');
});

test('texto: BOM que nao esta no inicio nao e tocado', () => {
  const s = 'a' + BOM + 'b';
  assert.strictEqual(texto.semBom(s), s);
});

test('texto: converte valor nao-string com String()', () => {
  assert.strictEqual(texto.semBom(123), '123');
  assert.strictEqual(texto.semBom(null), 'null');
  assert.strictEqual(texto.semBom(undefined), 'undefined');
});

test('texto: string vazia nao estoura', () => {
  assert.strictEqual(texto.semBom(''), '');
});

test('texto: Buffer lido como utf8 com BOM tambem funciona', () => {
  const bruto = Buffer.from(BOM + '{"a":1}', 'utf8').toString('utf8');
  assert.strictEqual(texto.semBom(bruto), '{"a":1}');
});

// causaDoErro (F3-22, D297 secao 4)
const TRADUCOES = {
  ENOENT: 'nao existe (ENOENT)',
  EACCES: 'sem permissao (EACCES)',
  EPERM: 'sem permissao (EPERM)',
  EISDIR: 'e uma pasta (EISDIR)',
  ENOTDIR: 'parte do caminho nao e uma pasta (ENOTDIR)',
  EBUSY: 'em uso (EBUSY)',
  EEXIST: 'ja existe (EEXIST)',
  ENOSPC: 'disco cheio (ENOSPC)',
};

for (const [codigo, esperado] of Object.entries(TRADUCOES)) {
  test('texto: causaDoErro traduz ' + codigo, () => {
    const e = Object.assign(new Error('falhou'), { code: codigo });
    assert.strictEqual(texto.causaDoErro(e), esperado);
  });
}

test('texto: causaDoErro aceita objeto simples com code (nao e Error)', () => {
  assert.strictEqual(texto.causaDoErro({ code: 'ENOENT' }), 'nao existe (ENOENT)');
});

test('texto: causaDoErro codigo fora da tabela devolve so o codigo', () => {
  const e = Object.assign(new Error('x'), { code: 'ECONNRESET' });
  assert.strictEqual(texto.causaDoErro(e), 'ECONNRESET');
});

test('texto: causaDoErro codigo com nome de propriedade do prototipo nao quebra', () => {
  assert.strictEqual(texto.causaDoErro({ code: 'constructor' }), 'constructor');
  assert.strictEqual(texto.causaDoErro({ code: 'toString' }), 'toString');
});

test('texto: causaDoErro code numerico vira String(code), sem traduzir', () => {
  assert.strictEqual(texto.causaDoErro({ code: 13 }), '13');
});

test('texto: causaDoErro erro sem code usa name: message (SyntaxError real)', () => {
  let erro;
  try { JSON.parse('{'); } catch (e) { erro = e; }
  const r = texto.causaDoErro(erro);
  assert.ok(r.startsWith('SyntaxError: '), r);
  assert.ok(r.includes(erro.message.replace(/\s+/g, ' ').slice(0, 50)), r);
});

test('texto: causaDoErro valores que nao sao erro viram String()', () => {
  assert.strictEqual(texto.causaDoErro('texto solto'), 'texto solto');
  assert.strictEqual(texto.causaDoErro(null), 'null');
  assert.strictEqual(texto.causaDoErro(undefined), 'undefined');
  assert.strictEqual(texto.causaDoErro(42), '42');
});

test('texto: causaDoErro colapsa espacos e quebras em um espaco', () => {
  const e = new Error('a  b\n\tc\r\nd');
  assert.strictEqual(texto.causaDoErro(e), 'Error: a b c d');
});

test('texto: causaDoErro corta em 200 caracteres', () => {
  const r = texto.causaDoErro(new Error('x'.repeat(500)));
  assert.strictEqual(r.length, 200);
  assert.ok(r.startsWith('Error: xxx'));
});

test('texto: causaDoErro corta depois de colapsar (200 sobre o texto ja colapsado)', () => {
  const r = texto.causaDoErro(new Error('a' + ' '.repeat(300) + 'b'));
  assert.strictEqual(r, 'Error: a b');
});

// D484 (V3 da triagem s106): o filtro do retorno de subagente vivia copiado em saude.js e correcao.js, preso ao
// texto da CLI; na s103 o 2.1.296 mudou a forma e os dois deixaram passar. Agora um lugar so.
test('D484: veioDeSubagente reconhece as formas do retorno de subagente e do aviso de tarefa', () => {
  const moldura = '[Subagent hand-back] The text below is the final report of a subagent. The report follows:\n  o contexto está bom?';
  const sim = [
    '<agent-message from="a03dd88b2fa37386b">\n' + moldura,
    '\n  <agent-message from="afada5e858d0f67dd">' + moldura,
    '<task-notification>\n<task-id>a2b689610322d871a</task-id>\n<result>o contexto está bom?</result>',
    'Another Claude session sent a message:\n<agent-message from="adb8871118893aaf1">\n' + moldura,
    'Another Claude session sent a message while you were working:\n<agent-message from="a4d07d4ff914ca816">\n' + moldura
  ];
  sim.forEach(function (p) {
    assert.strictEqual(texto.veioDeSubagente(p), true, 'nao reconheceu: ' + JSON.stringify(p.slice(0, 50)));
  });
  const nao = ['o contexto está bom?', 'nunca mais faca isso', 'veja o <agent-message> no log', '', '   ', null, undefined, 42];
  nao.forEach(function (p) {
    assert.strictEqual(texto.veioDeSubagente(p), false, 'acusou o que nao e de subagente: ' + JSON.stringify(p));
  });
});

test('D484: saude.js e correcao.js usam o filtro de texto.js, sem copia propria da regex', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  ['saude.js', 'correcao.js'].forEach(function (nome) {
    const fonte = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'lib', nome), 'utf8');
    assert.ok(fonte.indexOf('veioDeSubagente(') !== -1, nome + ' nao chama texto.veioDeSubagente');
    assert.strictEqual(fonte.indexOf('<(?:agent-message'), -1, nome + ' ainda tem a propria copia da regex');
  });
});

// Plano 083 (p7-5, p2-1): o valor que vai entre aspas num aviso nao deforma a mensagem - a aspa de dentro vira \" e a
// quebra de linha vira espaco (o valor fica numa linha so).
test('083 T6: entreAspas escapa a aspa e junta as quebras de linha; o resto fica como esta', () => {
  assert.strictEqual(texto.entreAspas('src/a.css'), '"src/a.css"');
  assert.strictEqual(texto.entreAspas('a"b.css'), '"a\\"b.css"');
  assert.strictEqual(texto.entreAspas('a\r\nb\nc'), '"a b c"');
  assert.strictEqual(texto.entreAspas('C:\\pasta\\a.css'), '"C:\\pasta\\a.css"', 'a barra do Windows fica');
  assert.strictEqual(texto.entreAspas(undefined), '"undefined"');
  // R2 do H1v: a barra antes do fim ou de uma aspa dobra, para a aspa final seguir sendo a que fecha
  assert.strictEqual(texto.entreAspas('C:\\pasta\\'), '"C:\\pasta\\\\"');
  assert.strictEqual(texto.entreAspas('a\\"b'), '"a\\\\\\"b"');
});

// P16-abertura-r1-25 e A1-29: uma fonte so para o caminho que o agente copia ao shell (abertura e portao-apelido).
test('caminhoParaShell: aspas duplas no caso comum, simples com $ crase ou aspa, e a aspa simples pelo shell declarado', () => {
  assert.strictEqual(texto.caminhoParaShell('C:\\a b\\x.js'), '"C:\\a b\\x.js"', 'caso comum: a barra do Windows fica');
  assert.strictEqual(texto.caminhoParaShell('a$b`c"d'), "'a$b`c\"d'");
  const misto = "C:\\x'$y";
  assert.strictEqual(texto.caminhoParaShell(misto, 'powershell'), "'C:\\x''$y'", 'no PowerShell a aspa dobra e a barra fica');
  assert.strictEqual(texto.caminhoParaShell(misto), "'C:\\x''$y'", 'sem declarar: a aspa dobra, nada roda em shell nenhum');
  assert.strictEqual(texto.caminhoParaShell(misto, 'bash'), '"C:\\\\x\'\\$y"');
  // o shell declarado vale em qualquer caixa, e o pwsh e o mesmo PowerShell; outro valor cai no Bash
  assert.strictEqual(texto.caminhoParaShell(misto, 'PowerShell'), "'C:\\x''$y'");
  assert.strictEqual(texto.caminhoParaShell(misto, 'pwsh'), "'C:\\x''$y'");
  assert.strictEqual(texto.caminhoParaShell(misto, 'cmd'), '"C:\\\\x\'\\$y"');
  assert.strictEqual(texto.caminhoParaShell(''), '""');
});

// R1 do H1x: no Bash, entre aspas duplas, a barra antes da aspa final a escapa e a barra dobrada vira uma; no
// PowerShell as aspas tipograficas tambem fecham a string. Caminho que nao e texto lanca.
test('caminhoParaShell: barra no fim, UNC, aspas tipograficas e caminho que nao e texto', () => {
  assert.strictEqual(texto.caminhoParaShell('C:\\pasta\\'), "'C:\\pasta\\'", 'Bash: barra no fim vai entre aspas simples');
  assert.strictEqual(texto.caminhoParaShell('\\\\srv\\share\\a b'), "'\\\\srv\\share\\a b'", 'Bash: o UNC fica inteiro');
  assert.strictEqual(texto.caminhoParaShell("\\\\srv\\a'b", 'bash'), '"\\\\\\\\srv\\\\a\'b"', 'Bash: UNC com aspa simples escapa cada barra');
  assert.strictEqual(texto.caminhoParaShell("\\\\srv\\a'b"), "'\\\\srv\\a''b'", 'sem declarar: o UNC com aspa vai entre simples');
  assert.strictEqual(texto.caminhoParaShell('C:\\pasta\\', 'powershell'), '"C:\\pasta\\"', 'PowerShell: a barra nao escapa nada');
  assert.strictEqual(texto.caminhoParaShell('C:\\Ana\u2019s $x', 'powershell'), "'C:\\Ana\u2019\u2019s $x'", 'a aspa tipografica dobra');
  assert.strictEqual(texto.caminhoParaShell('C:\\\u201Cp\u201D', 'powershell'), "'C:\\\u201Cp\u201D'", 'a dupla tipografica vai entre simples');
  for (const torto of [undefined, null, 5, { toString: function () { return '$x'; } }]) {
    assert.throws(function () { texto.caminhoParaShell(torto); }, TypeError, String(torto));
  }
});

// P16-abertura-r2 (seguranca): sem shell declarado (a ordem do init sai sem projeto.json), o escape do Bash entre
// aspas duplas deixava o `$(...)` rodar no PowerShell; agora a saida nao executa nada em nenhum dos dois.
test('caminhoParaShell: sem shell declarado, nada do caminho roda no Bash nem no PowerShell', () => {
  assert.strictEqual(texto.caminhoParaShell("C:\\a'$(calc)"), "'C:\\a''$(calc)'", 'aspa e $: simples, a aspa dobra');
  assert.strictEqual(texto.caminhoParaShell('C:\\a\u201C;calc;\u201D'), "'C:\\a\u201C;calc;\u201D'", 'dupla tipografica: simples');
  assert.strictEqual(texto.caminhoParaShell("C:\\O'Brien"), '"C:\\O\'Brien"', 'so a aspa simples: duplas bastam');
  assert.strictEqual(texto.caminhoParaShell('C:\\Ana\u2019s $x'), "'C:\\Ana\u2019\u2019s $x'", 'tipografica simples com $ dobra');
  assert.strictEqual(texto.caminhoParaShell('C:\\\u201Cp\u201D', 'bash'), '"C:\\\u201Cp\u201D"', 'declarado bash: a tipografica nao conta');
});

// A2-16 (P2 do pedido 12): o escalar.js e o gravar-veredito.js tinham cada um a sua copia de mensagemDe, e elas ja
// divergiam (a do gravar-veredito aceitava PostToolUse sem tool_name). Uma fonte so, na forma estrita: o matcher do
// hooks.json (SubagentHandback) ja garante o nome da ferramenta.
test('A2-16: mensagemDoSubagente le o fim do subagente e o handback; o resto e undefined', () => {
  const m = texto.mensagemDoSubagente;
  assert.strictEqual(m({ hook_event_name: 'SubagentStop', last_assistant_message: 'fim' }), 'fim');
  const hb = { hook_event_name: 'PostToolUse', tool_name: 'SubagentHandback', tool_input: { message: 'volta' } };
  assert.strictEqual(m(hb), 'volta');
  assert.strictEqual(m(Object.assign({}, hb, { tool_name: undefined })), undefined, 'PostToolUse sem tool_name');
  assert.strictEqual(m(Object.assign({}, hb, { tool_name: 'Read' })), undefined, 'outra ferramenta');
  assert.strictEqual(m(Object.assign({}, hb, { tool_input: 'x' })), undefined, 'tool_input que nao e objeto');
  assert.strictEqual(m(Object.assign({}, hb, { tool_input: null })), undefined, 'tool_input null');
  assert.strictEqual(m({ hook_event_name: 'SubagentStart', last_assistant_message: 'x' }), undefined);
  // R1 da faixa (borda): entrada que nao e objeto e resposta que nao e texto saem undefined, nunca lancam.
  for (const e of [null, undefined, 'SubagentStop', 5]) assert.strictEqual(m(e), undefined, JSON.stringify(e));
  assert.strictEqual(m({ hook_event_name: 'SubagentStop', last_assistant_message: 5 }), undefined);
  assert.strictEqual(m(Object.assign({}, hb, { tool_input: { message: { a: 1 } } })), undefined);
  const fs = require('node:fs');
  const path = require('node:path');
  ['escalar.js', 'gravar-veredito.js'].forEach(function (nome) {
    const fonte = fs.readFileSync(path.join(__dirname, '..', 'scripts', nome), 'utf8');
    assert.ok(fonte.indexOf('mensagemDoSubagente(') !== -1, nome + ' nao chama texto.mensagemDoSubagente');
    assert.strictEqual(fonte.indexOf('function mensagemDe('), -1, nome + ' ainda tem a propria copia');
  });
});

// A7-32: o ehObjeto tinha copias em onze arquivos; agora so o texto.js o define e os outros o importam.
test('A7-32: ehObjeto aceita so objeto de verdade e nenhum script tem copia propria', () => {
  for (const v of [{}, { a: 1 }, Object.create(null)]) assert.strictEqual(texto.ehObjeto(v), true, JSON.stringify(v));
  for (const v of [null, undefined, [], [1], 'x', 0, 1, true, false, NaN]) {
    assert.strictEqual(texto.ehObjeto(v), false, String(v));
  }
  const fs = require('node:fs');
  const path = require('node:path');
  // R2 do H1v: o metodo na mesma linha (`{ ehObjeto(v) {`), com static/async, e a seta async tambem sao copia.
  const COPIA = /function ehObjeto\s*\(|ehObjeto\s*[=:]\s*(?:async\s+)?(?:function|\(|\w+\s*=>)|\behObjeto\s*\([^)]*\)\s*\{/;
  for (const c of ['function ehObjeto(v) {', 'const ehObjeto = v => v', 'ehObjeto: (v) => v', 'ehObjeto = async v => v',
    'const u = { ehObjeto(v) { return v; } };', '  static ehObjeto(v) {', '  async ehObjeto(v) {']) {
    assert.ok(COPIA.test(c), c);
  }
  for (const c of ['if (ehObjeto(x)) {', 'const { ehObjeto } = require(\'./texto\');', 'return ehObjeto(a) && ehObjeto(b);',
    'module.exports = { ehObjeto, outro };']) {
    assert.ok(!COPIA.test(c), c);
  }
  const copias = [];
  const varrer = function (pasta) {
    for (const nome of fs.readdirSync(pasta, { withFileTypes: true })) {
      const p = path.join(pasta, nome.name);
      if (nome.isDirectory()) varrer(p);
      else if (/\.js$/.test(nome.name) && nome.name !== 'texto.js' && COPIA.test(fs.readFileSync(p, 'utf8'))) copias.push(p);
    }
  };
  varrer(path.join(__dirname, '..', 'scripts'));
  assert.deepStrictEqual(copias, []);
});

// R1 do H1v: erro com nome e sem mensagem nao mostra "undefined"; o corte nao parte emoji.
test('R1 H1v: causaDoErro sem mensagem e com emoji no corte', () => {
  assert.strictEqual(texto.causaDoErro({ name: 'AbortError' }), 'AbortError');
  assert.strictEqual(texto.causaDoErro({ name: 'Error', message: '' }), 'Error');
  const longo = texto.causaDoErro(new Error('x'.repeat(192) + '\u{1F600}\u{1F600}'));
  assert.strictEqual(longo, 'Error: ' + 'x'.repeat(192) + '\u{1F600}');
  assert.ok(!/[\uD800-\uDBFF]$/.test(longo), 'sem metade de par no fim');
});
