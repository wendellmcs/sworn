'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const design = require('../scripts/lib/design.js');

const DESIGN = {
  cores: ['#ff6600', '#1a1a1a', '#ffffff'],
  raios: ['4px', '8px'],
  espacos: ['4px', '8px', '16px', '24px'],
  sombras: ['0 1px 2px rgba(0,0,0,.08)'],
  antiReferencias: ['gradiente', 'glassmorphism', 'sombra larga']
};

test('design: reconhece arquivo de estilo', () => {
  assert.strictEqual(design.ehArquivoDeEstilo('src/a.css', {}), true);
  assert.strictEqual(design.ehArquivoDeEstilo('src/a.scss', {}), true);
  assert.strictEqual(design.ehArquivoDeEstilo('src/a.js', {}), false);
});

test('design: caminho de estilo pode ser declarado no projeto', () => {
  const p = { design: { caminhosDeEstilo: ['src/tema/**'] } };
  assert.strictEqual(design.ehArquivoDeEstilo('src/tema/cores.ts', p), true);
});

test('design: valor cru fora do sistema e apontado com a linha', () => {
  const css = '.a{color:#ff6600;}\n.b{color:#00ff00;}';
  const r = design.conferir(css, DESIGN);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.fora.length, 1);
  assert.strictEqual(r.fora[0].valor, '#00ff00');
  assert.strictEqual(r.fora[0].linha, 2);
});

test('design: valor que esta no sistema passa', () => {
  assert.strictEqual(design.conferir('.a{color:#ff6600;border-radius:8px;}', DESIGN).ok, true);
});

test('design: cor em maiuscula casa com o token em minuscula', () => {
  assert.strictEqual(design.conferir('.a{color:#FF6600;}', DESIGN).ok, true);
});

test('design: uso de var() nunca e apontado', () => {
  assert.strictEqual(design.conferir('.a{color:var(--cor-marca);}', DESIGN).ok, true);
});

test('design: anti-referencia e apontada mesmo com valor valido', () => {
  const r = design.conferir('.a{background:linear-gradient(#ff6600,#1a1a1a);}', DESIGN);
  assert.strictEqual(r.ok, false);
  assert.ok(r.fora.some((f) => f.tipo === 'anti-referencia'));
});

test('design: sem design.json declarado, nada e apontado', () => {
  assert.strictEqual(design.conferir('.a{color:#123456;}', null).ok, true);
});

test('design: motivo cita o token esperado, nao so o erro (D12)', () => {
  const r = design.conferir('.a{color:#00ff00;}', DESIGN);
  const m = design.motivo('src/a.css', r.fora, DESIGN);
  assert.ok(m.includes('#00ff00'));
  assert.ok(m.includes('#ff6600'), 'tem de mostrar o que existe no sistema');
  assert.ok(/^[\x20-\x7E\n]+$/.test(m), 'motivo tem de ser ASCII (R5)');
});

// --- D124: o par teste/codigo do plano nao fechava. Estes tres guardam a correcao. ---

test('design: anti-referencia em portugues casa com o cognato ingles do CSS (D124)', () => {
  // A entrevista coleta "gradiente"; o CSS diz "linear-gradient". Antes do radical, o
  // casamento pegava ZERO de 7 casos reais de CSS: portao vivo por fora, morto por dentro.
  const r = design.conferir('.a{background:radial-gradient(#ff6600,#1a1a1a);}', DESIGN);
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.fora.map((f) => f.tipo), ['anti-referencia']);
  assert.strictEqual(r.fora[0].valor, 'gradiente', 'o motivo mostra o que o DONO escreveu');
});

test('design: CONTROLE NEGATIVO - o radical corta a vogal final, nao a palavra (D124)', () => {
  // Sem este controle, um radical guloso (que fosse cortando ate casar) passaria no teste
  // acima apontando qualquer CSS, e o portao viraria ruido. "bordado" NAO termina em "e":
  // fica inteiro, e nao pode casar "border". Cortado em 3 viraria "bor", e casaria.
  const b = { cores: [], raios: [], espacos: [], sombras: [], antiReferencias: ['bordado'] };
  assert.strictEqual(design.conferir('.a{border:inherit;}', b).ok, true,
    'radical guloso: "bor" casaria "border" e o portao negaria CSS inocente');
  assert.strictEqual(design.conferir('.a{/*bordado*/border:inherit;}', b).ok, false,
    'CONTROLE POSITIVO: quando a palavra INTEIRA esta la, o portao pega');
});

test('design: anti-referencia sem cognato ingles nao e pega - limite declarado (D124)', () => {
  // MEDIDO: vocabulario PT contra CSS EN pega 2 de 7 casos reais. So o par gradiente/gradient
  // tem cognato; "sombra larga" x "box-shadow" nao tem, e passa. Fica declarado AQUI para
  // ninguem confiar no portao alem do que ele mede, nem "consertar" isto calado.
  const so = { cores: [], raios: [], espacos: [], sombras: [], antiReferencias: ['sombra larga'] };
  assert.strictEqual(design.conferir('.a{box-shadow:inherit;}', so).ok, true,
    'o limite declarado tem de continuar visivel');
});

test('A2 (s192): anti-referencia torta nao acusa toda linha nem lanca; texto solto vale como lista de um', () => {
  // design.js:234: o radical de '' (ou de ' x') era '' e casava toda linha; texto solto corria letra por letra;
  // numero, booleano ou objeto lancava no for...of, e o io.blindar do portao liberava a escrita sem conferir.
  const css = '.a{display:grid}\n.b{font-weight:500}\n.c{background:linear-gradient(red,blue)}';
  const anti = (antiReferencias) => design.conferir(css, { antiReferencias }).fora
    .filter((f) => f.tipo === 'anti-referencia').map((f) => f.valor + ':' + f.linha);
  for (const torta of [[''], ['   '], [5], [null], [{}], 5, true, {}]) {
    assert.deepStrictEqual(anti(torta), [], JSON.stringify(torta));
  }
  assert.deepStrictEqual(anti([' gradiente']), [' gradiente:3'], 'espaco na frente: o radical e o da palavra');
  assert.deepStrictEqual(anti(['gradiente\tsuave']), ['gradiente\tsuave:3'], 'tab separa a palavra como o espaco');
  assert.deepStrictEqual(anti('gradiente'), ['gradiente:3'], 'texto solto vale como lista de um');
});

test('design: medida negativa e outro valor - -8px nao passa por 8px (ronda 1 do 8b)', () => {
  // O \b antes do digito ancorava depois do sinal: `margin: -8px` era lido 8px, e
  // com 8px no sistema o portao deixava passar um valor que ninguem declarou.
  const r = design.conferir('.a{margin:-8px;}', DESIGN);
  assert.strictEqual(r.ok, false, 'com 8px no sistema, -8px passou calado');
  assert.strictEqual(r.fora[0].valor, '-8px');
  assert.strictEqual(design.conferir('.a{margin: -8px;}', DESIGN).ok, false,
    'com espaco antes do sinal');
  // declarado, passa: o sinal e parte do valor, nao motivo de recusa
  const comNegativo = Object.assign({}, DESIGN, { espacos: DESIGN.espacos.concat(['-8px']) });
  assert.strictEqual(design.conferir('.a{margin:-8px;}', comNegativo).ok, true);
  // hifen de nome nao e sinal: o seletor .mt-8px segue lendo 8px, como antes
  assert.strictEqual(design.conferir('.mt-8px{margin:8px;}', DESIGN).ok, true,
    'o hifen colado a letra virou sinal de menos');
});

test('design: medida fora de px, rem e em passa sem conferencia - limite declarado (ronda 2 do 8b)', () => {
  // O portao le medida so nas unidades de UNIDADES. O `%` ficou de fora de proposito:
  // bloquea-lo acusaria todo `width:100%`. O limite esta escrito no README e no
  // CHANGELOG com estas mesmas unidades, e fica AQUI para ninguem confiar no portao
  // alem do que ele mede, nem "consertar" isto calado.
  assert.deepStrictEqual(design.UNIDADES, ['px', 'rem', 'em']);
  for (const u of design.UNIDADES) {
    assert.strictEqual(design.conferir('.a{margin:3' + u + ';}', DESIGN).ok, false,
      'controle: 3' + u + ' fora do sistema tinha de ser pego');
  }
  for (const v of ['50%', '2pt', '10vw', '1.5ch']) {
    assert.strictEqual(design.conferir('.a{border-radius:' + v + ';}', DESIGN).ok, true,
      v + ' passou a ser conferido: o limite escrito no README e no CHANGELOG ficou falso');
  }
});

// D244 (P2 da D238 secao 6): `.04em` era lido `04em` - o `\b` separa o ponto do digito, e a
// medida valida do sistema virava valor barrado.
test('D244/P2 .04em: medida sem zero a esquerda e lida inteira, com e sem sinal', () => {
  const v = (css) => design.valoresCrus(css).map((a) => a.valor);
  assert.deepStrictEqual(v('a { letter-spacing: .04em; }'), ['.04em']);
  assert.deepStrictEqual(v('a { margin: -.5em 0.04em 12px; }'), ['-.5em', '0.04em', '12px']);
  assert.strictEqual(design.conferir('a { letter-spacing: .04em; }', { espacos: ['.04em'] }).ok, true);
});

// PT-05 (lote 2, D422): seletor de id feito so de letras hex (#add-btn, #feed) nao e cor.
test('design PT-05: seletor de id com letras hex NAO e cor fora do sistema', () => {
  const css = [
    '#add-btn { padding: var(--s); }',
    '#fade-overlay { margin: 4px; }',
    '#feed { margin: 4px; }',
    '#decade-list li { margin: 4px; }',
    '#main { margin: 4px; }',
    '#feed, #add { margin: 4px; }',
    '#feed:hover { margin: 4px; }',
    '#bad > .x { margin: 4px; }'
  ].join('\n');
  const r = design.conferir(css, DESIGN);
  assert.deepStrictEqual(r.fora, [], 'seletor lido como cor: ' + JSON.stringify(r.fora));
});

test('design PT-05: controle - cor em posicao de valor segue sendo achada', () => {
  const casos = [
    ['.a { color: #fff; }', '#fff'],
    ['.a { border: 1px solid #abc; }', '#abc'],
    ['.a{background:#123456}', '#123456'],
    ['.a { color: #abcdef80; }', '#abcdef80'],
    ['#feed { color: #bad; }', '#bad'],
    ['.a { background: linear-gradient(#fed, #def); }', '#fed'],
    ['.a { box-shadow: 0 0 #cab, 0 0 #bad; }', '#bad'],
    ['  #fed;', '#fed'],
    ['.a { color: #ABC }', '#abc']
  ];
  for (const [css, esperado] of casos) {
    const r = design.conferir(css, DESIGN);
    assert.ok(r.fora.some((f) => f.tipo === 'cor' && f.valor === esperado), css + ' -> ' + JSON.stringify(r.fora));
  }
});

// Ronda 1 da revisao cega do lote 2: o criterio por "`:` na linha" cegava cor em valor de varias linhas.
// Novo criterio: o que vem primeiro DEPOIS do #hex no arquivo - `{` e seletor; `;`, `}` ou nada e valor.
test('design PT-05 D1: cor em valor de varias linhas e achada', () => {
  const cores = (css) => design.conferir(css, DESIGN).fora.filter((f) => f.tipo === 'cor').map((f) => f.valor);
  assert.deepStrictEqual(cores('.a { box-shadow:\n  0 1px 2px #123456,\n  0 4px 8px #abcdef;\n}'), ['#123456', '#abcdef'], 'sombra');
  assert.deepStrictEqual(cores('.a {\n  color:\n  #ff6601\n;\n}'), ['#ff6601'], 'ponto e virgula na linha de baixo');
  assert.deepStrictEqual(cores('.a {\n  border:\n  1px solid\n  #ff6601 dashed;\n}'), ['#ff6601'], 'nome de borda depois');
  assert.deepStrictEqual(cores('.a {\n  background:\n  #ff6601\n}'), ['#ff6601'], 'sem ; antes de }');
  assert.deepStrictEqual(cores('.a {\n  background:\n  #ff6601'), ['#ff6601'], 'ate o fim do arquivo');
  assert.deepStrictEqual(cores('.a\n  color #ff6601'), ['#ff6601'], 'Stylus sem chaves');
  assert.deepStrictEqual(cores('.a { background: linear-gradient(\n  #fff,\n  #000\n); }'), ['#fff', '#000'], 'gradiente multilinha');
});

test('design PT-05 D2: seletor de id depois de pseudo-classe NAO e cor; lista multilinha so poupa a linha do {', () => {
  const cores = (css) => design.conferir(css, DESIGN).fora.filter((f) => f.tipo === 'cor').map((f) => f.valor);
  assert.deepStrictEqual(cores('.menu:hover #feed {\n  margin: 4px;\n}'), []);
  assert.deepStrictEqual(cores('a:hover #fed {\n  margin: 4px;\n}'), []);
  // D423: lista de ids em varias linhas passa a ser acusada por engano (so o #bad, da linha com `{`, e seletor).
  // Aceito pelo dono como registro: sem `{` na mesma linha o #hex e valor.
  assert.deepStrictEqual(cores('#feed,\n#add,\n.x:focus #bad {\n  margin: 4px;\n}'), ['#feed', '#add']);
  assert.deepStrictEqual(cores('.a:not(.b) > #dead { margin: 4px; }'), []);
});

// D423 (estreitar ao caso seguro): #hex so e seletor de id quando o `{` esta na MESMA linha e tudo entre o
// inicio do trecho e o `{` e caractere de seletor. O resto acusa, mesmo que um `{` apareca na linha seguinte.
test('design PT-05 E1 (D423): so `#id {` na mesma linha e seletor; o resto acusa', () => {
  const cores = (css) => design.conferir(css, DESIGN).fora.filter((f) => f.tipo === 'cor').map((f) => f.valor);
  assert.deepStrictEqual(cores('a {\n  color: #fff // {\n}'), ['#fff'], '`{` em comentario // nao decide');
  assert.deepStrictEqual(cores('a\n  color #fff\n  #{$x} {\n  }'), ['#fff'], 'Stylus: `{` da linha seguinte');
  assert.deepStrictEqual(cores('color: #fff\n{'), ['#fff'], '`{` solto na linha seguinte');
  assert.deepStrictEqual(cores('$cor: #ff0000\n.btn {\n  x: 1;\n}'), ['#ff0000'], 'variavel sem ; e seletor depois');
  assert.deepStrictEqual(cores('.m(\n  $a: #fff,\n  $b: #000) {\n}'), ['#fff', '#000'], 'mixin multilinha, `) {`');
  assert.deepStrictEqual(cores('  border 1px #fff #{$w}'), ['#fff'], 'Stylus: o `{` e de interpolacao');
  assert.deepStrictEqual(cores('#dead\n{ margin: 4px; }'), ['#dead'], '`{` na linha seguinte');
  // #ffffff esta no sistema de teste (conferir o calaria): le-se direto de valoresCrus.
  const crus = design.valoresCrus('.a {\n  @if $x { }\n  } @else if $bg == #ffffff {\n}')
    .filter((a) => a.tipo === 'cor').map((a) => a.valor);
  assert.deepStrictEqual(crus, ['#ffffff'], '`} @else if ... {`: o prefixo nao e de seletor');
  // controles: continuam seletor
  assert.deepStrictEqual(cores('#feed {\n  x: 1;\n}'), []);
  assert.deepStrictEqual(cores('#add-btn { x: 1; }'), []);
  assert.deepStrictEqual(cores('a:not(#dead) {\n  x: 1;\n}'), []);
  assert.deepStrictEqual(cores('@media x { #feed {\n  x: 1;\n} }'), []);
  assert.deepStrictEqual(cores('.menu:hover #feed {\n  x: 1;\n}'), []);
  assert.deepStrictEqual(cores('#feed, #add { x: 1; }'), []);
});

// Ronda 2 da revisao cega do lote 2 (falsos negativos): o terminador decisivo agora tem alcance curto
// (resto da linha, ou a proxima linha nao vazia) e a linha e lida sem comentario inline, sem at-rule de
// valor e sem argumento de funcao.
test('design PT-05 G1: cor em argumento de mixin, funcao ou at-rule seguida de { e achada', () => {
  const cores = (css) => design.conferir(css, DESIGN).fora.filter((f) => f.tipo === 'cor').map((f) => f.valor);
  assert.deepStrictEqual(cores('.a {\n  @include tema(#ff0000) {\n    margin: 4px;\n  }\n}'), ['#ff0000'], 'include com argumento');
  assert.deepStrictEqual(cores('.a {\n  @include btn($bg: #ff0000) {\n    margin: 4px;\n  }\n}'), ['#ff0000'], 'argumento nomeado');
  assert.deepStrictEqual(cores('.m(@c: #fff) {\n  margin: 4px;\n}'), ['#fff'], 'mixin Less');
  assert.deepStrictEqual(cores('@if $c == #fff {\n  .a { margin: 4px; }\n}'), ['#fff'], '@if');
  assert.deepStrictEqual(cores('@each $c in #fff, #000 {\n  .a { margin: 4px; }\n}'), ['#fff', '#000'], '@each');
});

test('design PT-05 G2: { dentro de comentario inline nao decide', () => {
  const cores = (css) => design.conferir(css, DESIGN).fora.filter((f) => f.tipo === 'cor').map((f) => f.valor);
  assert.deepStrictEqual(cores('.a {\n  background: #abc /* base { */;\n}'), ['#abc'], 'comentario antes do ;');
  assert.deepStrictEqual(cores('.a {\n  color: #ff0000 /* ajuste { */\n}'), ['#ff0000'], 'comentario no fim da linha');
});

test('design PT-05 G3: { distante (Stylus, sem ;) nao transforma a cor anterior em seletor', () => {
  const cores = (css) => design.conferir(css, DESIGN).fora.filter((f) => f.tipo === 'cor').map((f) => f.valor);
  assert.deepStrictEqual(cores('a\n  color #ff6601\nb\n  width {w}px'), ['#ff6601']);
  assert.deepStrictEqual(cores('a\n  color #ff6601\nb\n  c #123456\n  d 1\n  width #{$x}px'), ['#ff6601', '#123456']);
});

// Excecoes que mantem o que ja era certo (a regra "dentro de parenteses e valor" e "@ e valor" ja nao as pegam).
// D424: dois furos novos do D423. (1) o `\w` no lookbehind de RE_COR escondia `solid#f00`; agora so `&#123;` e
// poupado, e `a#fed {` segue poupado pela regra da mesma linha. (2) `:` + letra qualquer valia como pseudo-classe
// e escondia a propriedade aninhada do SCSS (`border:solid #f00 { ... }`); agora so nome conhecido vale.
// Falso positivo ACEITO (D424): `url(icones.svg#add)` volta a ser acusado, como no HEAD.
test('design PT-05 E2 (D424): cor colada em palavra e propriedade aninhada acusam; pseudo conhecida segue seletor', () => {
  const crus = (css) => design.valoresCrus(css).filter((a) => a.tipo === 'cor').map((a) => a.valor);
  assert.deepStrictEqual(crus('a{border:1px solid#f00}'), ['#f00'], 'colada em palavra');
  assert.deepStrictEqual(crus('a{border:solid #f00 { left:0 }}'), ['#f00'], 'propriedade aninhada, uma linha');
  assert.deepStrictEqual(crus('a {\n  border:solid #f00 {\n    left: 0;\n  }\n}'), ['#f00'], 'propriedade aninhada, varias linhas');
  assert.deepStrictEqual(crus('a{border:1px#000}'), ['#000'], 'colada em unidade');
  assert.deepStrictEqual(crus('.a { background: url(icones.svg#add); }'), ['#add'], 'url com ancora: falso positivo aceito');
  assert.deepStrictEqual(crus('a&#123;b'), [], '`&#123;` segue poupado');
  // controles: seguem seletor
  assert.deepStrictEqual(crus('a#fed {\n x: 1;\n}'), []);
  assert.deepStrictEqual(crus('a:hover #feed {\n x: 1;\n}'), []);
  assert.deepStrictEqual(crus('li:nth-child(2) #fed {\n x: 1;\n}'), []);
  assert.deepStrictEqual(crus('a::before #fed {\n x: 1;\n}'), []);
  assert.deepStrictEqual(crus('.x:focus-visible #bad {\n x: 1;\n}'), []);
  assert.deepStrictEqual(crus('.x:not(.y):first-child #bad {\n x: 1;\n}'), []);
});

test('design PT-05 G1: seletor em pseudo-classe funcional e em at-rule de bloco continua NAO sendo cor', () => {
  const cores = (css) => design.conferir(css, DESIGN).fora.filter((f) => f.tipo === 'cor').map((f) => f.valor);
  assert.deepStrictEqual(cores('a:not(#dead) {\n  margin: 4px;\n}'), []);
  assert.deepStrictEqual(cores('.x:is(#feed, .y) > #fed {\n  margin: 4px;\n}'), []);
  assert.deepStrictEqual(cores('@media screen { #feed { margin: 4px; } }'), []);
  assert.deepStrictEqual(cores('@media screen { #feed { color: #bad; } }'), ['#bad']);
  assert.deepStrictEqual(cores('@include tema(#feed) { margin: 4px; }'), ['#feed']);
});

test('design PT-05 D1: varredura linear - arquivo grande com muitas cores nao trava', () => {
  const css = '.a { color: #fed; }\n'.repeat(20000) + '.b { background: ' + '#abc, '.repeat(20000) + '#def; }';
  const t0 = Date.now();
  const v = design.valoresCrus(css).filter((a) => a.tipo === 'cor');
  assert.strictEqual(v.length, 40001);
  assert.ok(Date.now() - t0 < 3000, 'demorou ' + (Date.now() - t0) + 'ms');
});

// S5 (L2-des-4, S52-des-1/2/4): comentario de bloco multilinha, `--x:` no meio da linha e seletor de atributo.
test('design S5: comentario de bloco atravessa linhas; o que esta fora dele na mesma linha e lido', () => {
  const crus = (css) => design.valoresCrus(css).map((a) => a.valor);
  assert.deepStrictEqual(crus('/*\n cor antiga #fff e 8px\n*/\na { x: 1 }'), [], 'linha interna sem `*` inicial');
  assert.deepStrictEqual(crus('/* a\n   #fff\n   #000 */\na { x: 1 }'), [], 'abre na 1a linha, fecha na 3a');
  assert.deepStrictEqual(crus('/*\n x\n*/ color: #f00;'), ['#f00'], 'o que vem depois do `*/` e lido');
  assert.deepStrictEqual(crus('/* nota */ color: #f00;'), ['#f00'], 'linha que comeca com `/*` fechado');
  assert.deepStrictEqual(crus('/* a */ /* b #fff */ color: #00f;'), ['#00f'], 'dois blocos na linha');
  assert.deepStrictEqual(crus('*zoom: 1; color: #f00'), ['#f00'], 'hack `*prop` nao e comentario');
  assert.deepStrictEqual(crus('/**\n * x #fff\n */\na { color: #f00 }'), ['#f00'], 'bloco estilo JSDoc');
  assert.deepStrictEqual(crus('/*\r\n #fff\r\n*/\r\na { color: #f00 }'), ['#f00'], 'CRLF');
  assert.deepStrictEqual(crus('// x #fff\ncolor: #f00;'), ['#f00'], '`//` no inicio segue pulando a linha');
  assert.deepStrictEqual(crus('// abre /*\ncolor: #f00;'), ['#f00'], '`/*` dentro de linha `//` nao abre bloco');
  assert.deepStrictEqual(design.valoresCrus('/*\n 8px\n*/').filter((a) => a.tipo === 'medida'), [], 'medida em comentario');
  assert.deepStrictEqual(design.valoresCrus('a {\n color: #f00; /* #fff\n 8px */ margin: 4px;\n}').map((a) => a.valor + '@' + a.linha),
    ['#f00@2', '4px@3']);
});

test('design S5: so a declaracao do token (`--x: v`) fica fora; o resto da linha e lido', () => {
  const crus = (css) => design.valoresCrus(css).map((a) => a.valor);
  assert.deepStrictEqual(crus('.a { --x: 1px; color: #f00; }'), ['#f00']);
  assert.deepStrictEqual(crus('.a { color: #f00; --x: 1px }'), ['#f00']);
  assert.deepStrictEqual(crus('.a { --x: #fff }'), [], 'a definicao do token segue fora');
  assert.deepStrictEqual(crus(':root { --a: #fff; --b: 2px; }'), []);
  assert.deepStrictEqual(crus('.a{--x:var(--y);color:#f00}'), ['#f00']);
  assert.deepStrictEqual(crus('.btn--primary:hover { color: #f00; }'), ['#f00'], '`--` dentro de nome de classe nao e token');
});

test('design S5: seletor de atributo balanceado nao faz o id virar cor', () => {
  const crus = (css) => design.valoresCrus(css).map((a) => a.valor);
  assert.deepStrictEqual(crus('#feed[data-x] {\n x: 1;\n}'), []);
  assert.deepStrictEqual(crus('#feed[data-x="1"] {\n x: 1;\n}'), []);
  assert.deepStrictEqual(crus('a[href^=\'http\'] #fed, #dad[x] {\n x: 1;\n}'), []);
  assert.deepStrictEqual(crus('#feed[data-x {\n x: 1;\n}'), ['#feed'], 'colchete aberto e valor');
  assert.deepStrictEqual(crus('#feed]x {\n x: 1;\n}'), ['#feed'], 'colchete fechado sem abrir e valor');
  assert.deepStrictEqual(crus('a{border:solid #f00 [x] { left:0 }}'), ['#f00'], 'propriedade aninhada segue valor');
  assert.deepStrictEqual(crus('#feed[data-x] { color: #bad; }'), ['#bad'], 'a cor do bloco segue acusada');
});

test('design D429/5: fallback cru de var() e acusado; o nome do token nunca', () => {
  // substitui o controle S5 que afirmava o contrario (decisao do dono D429 item 5)
  const crus = (css) => design.valoresCrus(css).map((a) => a.valor);
  assert.deepStrictEqual(crus('a { color: var(--a, #f00); }'), ['#f00']);
  assert.deepStrictEqual(crus('a { color: var(--a,#f00); }'), ['#f00'], 'sem espaco');
  assert.deepStrictEqual(crus('a { color: var(--a, var(--b, #0f0)); }'), ['#0f0'], 'aninhado');
  assert.deepStrictEqual(crus('a { padding: var(--a, 13px); }'), ['13px'], 'medida no fallback');
  assert.deepStrictEqual(crus('a { color: var(--a, rgba(0, 0, 0, .5)); }'), ['rgba(0,0,0,.5)'], 'rgba no fallback');
  assert.deepStrictEqual(crus('a { color: var(--a, var(--b)); }'), []);
  assert.deepStrictEqual(crus('a { color: var(--a); }'), []);
  assert.deepStrictEqual(crus('a { color: var(--a, ); }'), []);
  assert.deepStrictEqual(crus('a { --x: var(--y, #f00); }'), [], 'declaracao de token segue isenta');
  assert.deepStrictEqual(crus('a { color: var(--a, #f00); border: 1px solid #0f0; }'), ['#f00', '#0f0', '1px'], 'o resto da linha segue lido');
  const t = Date.now();
  design.valoresCrus('a { x: ' + 'var(--a, '.repeat(3000) + 'x' + ')'.repeat(3000) + '; }');
  assert.ok(Date.now() - t < 500, 'linear');
});

test('design S5: `//` de comentario no meio da linha encerra a busca de `/*`; `://` de url nao e comentario', () => {
  const crus = (css) => design.valoresCrus(css).map((a) => a.valor + '@' + a.linha);
  assert.deepStrictEqual(crus('a { x: 1 } // nota /*\n.b { color: #f00; }'), ['#f00@2'], '`/*` depois de `//` nao abre bloco');
  assert.deepStrictEqual(crus('a { } // so nota\n.b { color: #f00; }'), ['#f00@2'], 'controle: sem `/*`');
  assert.deepStrictEqual(crus('.a { background: url(http://x/y.png); }\n.b { color: #0f0; }'), ['#0f0@2'], 'controle: `://` nao e comentario');
  assert.deepStrictEqual(crus('.a { background: url(http://x/y.png); } /* abre\n #fff\n*/\n.b { color: #0f0; }'), ['#0f0@4'], '`/*` depois de `://` abre bloco');
  assert.deepStrictEqual(crus('/* a // b */ .x { color: #f00; } /* c\n #fff */'), ['#f00@1'], '`//` dentro de bloco nao conta');
});

// S52-des (ronda 1): `/*` dentro de string nao abre bloco; fragmento que comeca no meio de um comentario.
test('design S5: `/*` dentro de string nao abre comentario de bloco', () => {
  const crus = (css) => design.valoresCrus(css).map((a) => a.valor + '@' + a.linha);
  assert.deepStrictEqual(crus('a::after { content: "/*"; }\n.x { color: #f00; padding: 13px }'), ['#f00@2', '13px@2']);
  assert.deepStrictEqual(crus('a::after { content: \'/*\'; }\n.x { color: #f00 }'), ['#f00@2'], 'aspa simples');
  assert.deepStrictEqual(crus('a::after { content: "a\\"/*"; }\n.x { color: #f00 }'), ['#f00@2'], 'aspa escapada nao fecha a string');
  assert.deepStrictEqual(crus('a::after { content: "//"; } /* c #fff */ .x { color: #f00 }'), ['#f00@1'], '`//` em string nao encerra a busca');
  assert.deepStrictEqual(crus('/* real\n #fff\n*/\n.x { color: #f00 }'), ['#f00@4'], 'controle: comentario real segue fechando');
});

test('design S5: fragmento que comeca no meio de um comentario de bloco', () => {
  const crus = (css) => design.valoresCrus(css).map((a) => a.valor + '@' + a.linha);
  assert.deepStrictEqual(crus(' * antes era #ff6600 */\n a{color:var(--x)}'), [], 'o primeiro delimitador e `*/`');
  assert.deepStrictEqual(crus(' * x #fff\n * y #000 */ a { color: #f00 }'), ['#f00@2'], 'fecha na 2a linha, o resto e lido');
  assert.deepStrictEqual(crus('* { padding: 13px }'), ['13px@1'], 'seletor universal segue acusado (S52-des-1)');
  assert.deepStrictEqual(crus('a { color: #f00 }\n/* nota */ b { color: #0f0 }'), ['#f00@1', '#0f0@2'], 'primeiro delimitador `/*`: nao e fragmento');
});

// Plano 083 (p7-5, p7-6): o alvo com aspa ou quebra de linha nao deforma o aviso; linha em branco antes de "O que
// existe no sistema:".
test('083 T6 (p7-5, p7-6): alvo com aspa ou quebra fica numa linha so e escapado; branco antes do sistema', () => {
  const r = design.conferir('.a{color:#00ff00;}', DESIGN);
  const m = design.motivo('a"b\nc.css', r.fora, DESIGN).split('\n');
  assert.ok(m.indexOf('  - "a\\"b c.css"') !== -1, m.join('\n'));
  const i = m.indexOf('O que existe no sistema:');
  assert.strictEqual(m[i - 1], '', m.join('\n'));
  const s = design.motivoShell(['a"b.css', 'x\ny.scss']).split('\n');
  assert.ok(s.indexOf('  - "a\\"b.css"') !== -1 && s.indexOf('  - "x y.scss"') !== -1, s.join('\n'));
});

// A2-41 (P2 do pedido 12): a lista das pseudo-classes funcionais era escrita de novo nas duas regex que leem o `(`.
test('A2-41: as pseudo funcionais e as nth-* saem de uma lista so, e cada uma le o seu `(`', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'lib', 'design.js'), 'utf8');
  for (const nome of ['host-context', 'slotted', '-moz-any', 'nth-last-of-type']) {
    assert.strictEqual(fonte.split(nome).length - 1, 1, nome + ' escrito mais de uma vez no design.js');
  }
  const cores = (css) => design.valoresCrus(css).filter((a) => a.tipo === 'cor').map((a) => a.valor);
  for (const nome of ['not', 'is', 'where', 'has', 'matches', 'any', '-webkit-any', '-moz-any', 'host',
    'host-context', 'global', 'local', 'slotted']) {
    assert.deepStrictEqual(cores('a:' + nome + '(#abc) { color: var(--x) }'), [], nome + ': seletor dentro do (');
  }
  for (const nome of ['nth-child', 'nth-last-child', 'nth-of-type', 'nth-last-of-type']) {
    assert.deepStrictEqual(cores('li:' + nome + '(2n+1) #abc { color: var(--x) }'), [], nome + ': o ( da formula');
    assert.deepStrictEqual(cores('li:' + nome + '(#abc) { color: var(--x) }'), ['#abc'], nome + ': dentro e valor');
  }
});

// A2-43/45 e A2-84 (P2 do pedido 12): "catraca" sem explicacao, "3 opcoes com a recomendada marcada" sem dizer o que
// cada uma traz, e o "na (anti-referencia)" truncado; a pergunta ao dono na redacao do intocavel (escopo.js).
test('A2-43/45: o aviso do design diz o passo, as 3 opcoes como no intocavel e a linha da anti-referencia', () => {
  const com = design.motivo('src/a.css', [{ linha: 9, valor: 'gradiente', tipo: 'anti-referencia' }], DESIGN);
  const sem = design.motivo('src/a.css', [{ linha: 3, valor: '#123456', tipo: 'cor' }], DESIGN);
  for (const m of [com, sem]) {
    const junto = m.replace(/\n +/g, ' ');
    assert.ok(!/catraca|recomendada marcada/.test(m), m);
    assert.match(junto, /3 opcoes, a recomendada primeiro, cada uma com o que muda e o custo/, m);
    assert.match(junto, /acrescentar o valor ao design\.json, usar o valor do sistema mais proximo, tirar o valor/, m);
    // A4-65 (microcopy do pedido 12): "design system" e "token" eram ingles solto no aviso em portugues.
    assert.ok(!/design system|token/.test(m), m);
    // R2 da s230: a lista "O que existe no sistema" mostra so 10 cores e nenhuma sombra; o passo aponta o design.json.
    assert.match(m, /\n {2}1\. troque cor e medida por um valor declarado no design\.json, ou por var\(--nome\);\n/, m);
    assert.match(m.split('\n')[0], /fora do sistema de design deste projeto\.$/, m);
    assert.match(m.split('\n').pop(), /^O caminho certo e tirar o valor cru; .*decisao do dono\.$/, m);
    for (const l of m.split('\n')) assert.ok(l.length <= 100, 'linha com ' + l.length + ': ' + l);
  }
  assert.match(com, /tirar o valor\);\n {2}3\. na linha marcada \(anti-referencia\), tire o termo:/, com);
  assert.match(sem, /tirar o valor\)\.\n\n/, sem);
  assert.ok(!/ 3\. /.test(sem), 'sem anti-referencia, sem a opcao 3: ' + sem);
});

// A2-44 (P2 do pedido 12): o aviso do shell nao dizia onde registrar o erro do sworn, e o "diga ao usuario" misturava
// o passo do agente com o que e do usuario.
test('A2-44: o aviso do shell separa o passo do agente e diz ao usuario onde registrar a leitura errada', () => {
  const m = design.motivoShell(['src/a.css']);
  assert.ok(!/diga ao usuario/.test(m), m);
  assert.match(m, /\n {2}2\. .*leitura errada do sworn: conte ao usuario no fecho do turno/, m);
  assert.match(m, /\n\nAo usuario: .*https:\/\/github\.com\/wendellmcs\/sworn\/issues/, m);
  assert.match(m, /tire dele antes senha, token e caminho interno: o issue e publico/, 'segredo no issue publico: ' + m);
  for (const l of m.split('\n')) assert.ok(l.length <= 100, 'linha com ' + l.length + ': ' + l);
  // A4-66 (microcopy do pedido 12): o "Por que:" vinha colado na lista de arquivos; e o "tokens" era ingles solto.
  assert.match(m, /"\n\nPor que: /, m);
  assert.ok(!/os tokens/.test(m), m);
});

// A2-46 (P2 do pedido 12, R2): a anti-referencia que nao e texto com palavra saia calada da conferencia.
test('A2-46: o aviso diz quais anti-referencias o portao ignorou, pela posicao no design.json', () => {
  const fora = [{ linha: 3, valor: '#123456', tipo: 'cor' }];
  const linha = (anti) => {
    const m = design.motivo('src/a.css', fora, Object.assign({}, DESIGN, { antiReferencias: anti })).split('\n');
    const i = m.findIndex((l) => /antiReferencias/.test(l));
    return i === -1 ? [] : m.slice(i, i + 2);
  };
  // A4-64 (microcopy do pedido 12): "texto com palavra" nao dizia o que falha; a regra vai na linha de baixo.
  const fim = ' sem efeito: corrija ou tire do design.json';
  const regra = '    (so vale texto nao vazio, como "gradiente"; so espacos, numero ou objeto nao valem)';
  assert.deepStrictEqual(linha(['  ', 5, 'gradiente', null]), ['  antiReferencias: itens 1, 2, 4' + fim, regra],
    'tres ignoradas');
  assert.deepStrictEqual(linha(5), ['  antiReferencias: item 1' + fim, regra], 'nao e lista');
  assert.deepStrictEqual(linha(['gradiente']), [], 'nenhuma ignorada, nenhuma linha');
  assert.deepStrictEqual(linha(undefined), [], 'sem anti-referencia, nenhuma linha');
  const muitas = linha(new Array(15).fill(0));
  assert.match(muitas[0], /itens 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 e mais 3 sem efeito/, muitas[0]);
});

// A4-des-1 (pedido 12, fila §5; D721): o design.json nao tinha validador - a anti-referencia sem efeito so aparecia no
// aviso de negacao, e a escrita sem valor fora passava calada. validar() diz cada item sem efeito e o que escrever.
test('A4-des-1: validar acusa o que nao e objeto e cada item sem efeito, por chave e posicao', () => {
  assert.deepStrictEqual(design.validar({ cores: ['#fff'], raios: '4px', antiReferencias: ['gradiente'] }),
    { ok: true, erros: [] });
  assert.deepStrictEqual(design.validar({}), { ok: true, erros: [] });
  for (const [v, tipo] of [[[], 'lista'], [null, 'nulo'], ['x', 'string']]) {
    const r = design.validar(v);
    assert.strictEqual(r.ok, false, tipo);
    assert.ok(/tem de ser um objeto JSON .* veio /.test(r.erros[0]) && r.erros[0].endsWith(tipo), r.erros[0]);
  }
  const r = design.validar({ cores: ['#fff', 5, ' '], espacos: null, sombras: [{}], antiReferencias: ['', 3, 'ok'] });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.erros.map((e) => e.split(' sem efeito')[0]),
    ['cores: itens 2, 3', 'sombras: item 1', 'antiReferencias: itens 1, 2']);
  assert.ok(r.erros.every((e) => /: corrija ou tire do design\.json$/.test(e)), r.erros.join(' | '));
  // A4-64: a anti-referencia diz o que falha, como no aviso do portao (motivo).
  assert.match(r.erros[2], /\(so vale texto nao vazio, como "gradiente"; so espacos, numero ou objeto nao valem\)/,
    r.erros[2]);
});

// A4-des-3 (pedido 12, achado lateral da s212): texto solto vale como lista de um no conferir, mas o motivo() fazia
// `.join` na chave - `raios: "4px"` estourava, e o io.blindar do portao-estilo liberava a escrita (falha aberta).
test('A4-des-3: motivo aceita texto solto nas chaves do sistema, como o conferir', () => {
  const s = { cores: '#fff', raios: '4px', espacos: '8px' };
  assert.strictEqual(design.conferir('a { color: #123; }', s).ok, false);
  const m = design.motivo('a.css', [{ valor: '#123', tipo: 'cor', linha: 1 }], s);
  assert.ok(/cores: {3}#fff\n/.test(m) && /raios: {3}4px\n/.test(m) && /espacos: 8px\n/.test(m), m);
});
