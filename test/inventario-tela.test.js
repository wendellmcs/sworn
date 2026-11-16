'use strict';
// E3 item 4 (R-hallmark): o inventario do que a tela liga, antes (HEAD) e depois (trabalho), com dispensa declarada.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const inv = require('../scripts/lib/inventario-tela.js');

const RAIZ = path.join(__dirname, '..');

test('E3 item 4: a fiacao le id, campo, link, script, envio, gancho de teste e evento, com a linha', () => {
  const html = [
    '<form id="compra" action="/pagar" onsubmit="enviar(event)">',
    '  <input name="cartao" data-testid="campo-cartao">',
    '  <meta name="descricao" content="x">',
    '  <a href="/ajuda">ajuda</a> <img src="x.png">',
    '  <button @click="pagar" v-on:keyup="atalho">Pagar</button>',
    '</form>',
    '<script src="/app.js"></script>'
  ].join('\n');
  assert.deepStrictEqual(Array.from(inv.fiacao(html)), [
    ['id:compra', 1], ['envio:/pagar', 1], ['evento:onsubmit=enviar(event)', 1],
    ['campo:cartao', 2], ['teste:campo-cartao', 2],
    ['link:/ajuda', 4],
    ['evento:@click=pagar', 5], ['evento:v-on:keyup=atalho', 5],
    ['script:/app.js', 7]
  ], 'o name do <meta> e o src da imagem nao sao fiacao');
  // JSX: o evento entre chaves (com espaco junto) e o atributo com > dentro de aspas.
  const jsx = '<Botao onClick={ pagar  agora } title="a > b" id="x" />';
  assert.deepStrictEqual(Array.from(inv.fiacao(jsx).keys()), ['evento:onclick=pagar agora', 'id:x']);
  assert.strictEqual(inv.fiacao('').size, 0);
  assert.strictEqual(inv.fiacao(null).size, 0);
});

test('E3 item 4: montar diz o que sumiu, o que a dispensa com motivo cobre e recusa a de motivo curto', () => {
  const head = '<div id="a"></div>\n<div id="b"></div>\n<div id="c"></div>\n<a href="/x">x</a>';
  const trabalho = '<div id="a"></div>\n' +
    '<!-- sworn-dispensa: id:b -- o painel lateral saiu do fluxo novo -->\n' +
    '<!-- sworn-dispensa: link:/x -- curto -->\n' +
    '<!-- sworn-dispensa: id:c2 -- item que nao casa exato com o que sumiu -->';
  const r = inv.montar({ head, trabalho });
  assert.strictEqual(r.total, 4);
  assert.strictEqual(r.mantidos, 1);
  assert.deepStrictEqual(r.dispensados, [{ item: 'id:b', motivo: 'o painel lateral saiu do fluxo novo' }]);
  assert.deepStrictEqual(r.sumiram, [{ item: 'id:c', linhaNoAntes: 3 }, { item: 'link:/x', linhaNoAntes: 4 }],
    'a dispensa de id:c2 nao cobre id:c; a de motivo curto nao vale');
  assert.deepStrictEqual(r.dispensasInvalidas, [{ item: 'link:/x', motivo: 'curto', linha: 3 }]);
  assert.strictEqual(r.acessibilidade, null, 'sem as duas fotos, sem acessibilidade');
  const frase = inv.fraseDoFecho(r);
  assert.strictEqual(frase, 'inventario da tela: mantido 1/4, 1 dispensado(s) com motivo, 2 sumiu(ram) sem dispensa ' +
    '(inventario.sumiram): ponha de volta, ou declare num comentario do arquivo "sworn-dispensa: <item> -- <motivo>" com o ' +
    'item exato e o motivo de 12 letras ou mais, 1 dispensa(s) recusada(s) por motivo curto (inventario.dispensasInvalidas): ' +
    'reescreva o motivo com 12 letras ou mais, ' +
    'sem os nomes da acessibilidade (falta a arvore de acessibilidade na foto de --tela-antes e --tela-depois: prepare a ' +
    'ronda com --tela-antes <endereco> e --tela-depois <endereco>)');
  assert.strictEqual(inv.fraseDoFecho(inv.montar({ head: '<p>x</p>', trabalho: '' })), null, 'sem fiacao, sem frase');
  assert.strictEqual(inv.fraseDoFecho(inv.montar({ head, trabalho: head })), 'inventario da tela: mantido 4/4, sem os nomes da acessibilidade (falta a arvore de acessibilidade na foto de ' +
    '--tela-antes e --tela-depois: prepare a ronda com --tela-antes <endereco> e --tela-depois <endereco>)');
});

test('E3 item 4: com as duas fotos, os nomes da acessibilidade entram, e a dispensa aceita nome com espaco', () => {
  const foto = (nomes) => ({ acessibilidade: { itens: nomes.map(([papel, nome]) => ({ papel, nome })) } });
  const antes = foto([['button', 'Pagar agora'], ['link', 'Ajuda'], ['heading', '  '], ['button', 'Voltar']]);
  const depois = foto([['button', 'Pagar   agora']]);
  const trabalho = '<p>/* sworn-dispensa: acess:button:Voltar -- o voltar virou o gesto do sistema */</p>';
  const r = inv.montar({ head: '', trabalho, antes, depois });
  assert.strictEqual(r.acessibilidade.antes, 3, 'o nome vazio nao conta');
  assert.deepStrictEqual(r.acessibilidade.sumiram, [{ item: 'acess:link:Ajuda' }]);
  assert.deepStrictEqual(r.dispensados.map((d) => d.item), ['acess:button:Voltar']);
  assert.strictEqual(r.total, 3);
  assert.strictEqual(r.mantidos, 1);
  assert.strictEqual(inv.montar({ head: '', trabalho, antes, depois: null }).acessibilidade, null);
  assert.strictEqual(r.semAcessibilidade, null, 'com as duas arvores, a acessibilidade se comparou');
  assert.strictEqual(inv.montar({ head: '', trabalho, antes, depois: null }).semAcessibilidade,
    'falta a arvore de acessibilidade na foto de --tela-depois: prepare a ronda com --tela-depois <endereco>');
  assert.strictEqual(inv.montar({ head: '', trabalho, antes: { acessibilidade: {} }, depois }).semAcessibilidade,
    'falta a arvore de acessibilidade na foto de --tela-antes: prepare a ronda com --tela-antes <endereco>');
});

test('E3 item 4: a tag com chave dentro de chave e o atributo sem aspas entram; a tag comentada nao', () => {
  const jsx = '<button id="pagar" style={{ color: "red", m: { t: 1 } }} onClick={() => { pagar({ a: 1 }); }}>';
  assert.deepStrictEqual(Array.from(inv.fiacao(jsx).keys()), ['id:pagar', 'evento:onclick=() => { pagar({ a: 1 }); }']);
  assert.deepStrictEqual(Array.from(inv.fiacao('<form action=/pagar id=checkout>').keys()), ['envio:/pagar', 'id:checkout']);
  const comentado = '<!-- <a id="sair" href="/logout"> -->\n{/* <b id="x"> */}\n<a id="ok" href="https://site/a">';
  assert.deepStrictEqual(Array.from(inv.fiacao(comentado)), [['id:ok', 3], ['link:https://site/a', 3]],
    'o comentario do HTML e o do JSX escondem a tag; o // da URL nao e comentario');
  // O comentario de varias linhas apagado guarda as quebras: a linha do item depois dele segue certa.
  assert.deepStrictEqual(Array.from(inv.fiacao('<!--\n<a id="velho">\n-->\n/* a\nb */ <i id="ok">')), [['id:ok', 5]]);
  // A tag que saiu para um comentario sumiu da tela.
  const r = inv.montar({ head: '<a id="sair" href="/logout">', trabalho: '<!-- <a id="sair" href="/logout"> -->' });
  assert.deepStrictEqual(r.sumiram.map((s) => s.item), ['id:sair', 'link:/logout']);
});

test('E3 item 4: o /* dentro de atributo ou de string nao abre comentario, e o // so comenta no comeco da linha', () => {
  const longo = 'removido nesta reforma de tela';
  // O `/*` do atributo apagava ate o fim do texto: a tag depois dele sumia dos dois lados.
  const r = inv.montar({ head: '<input type="file" accept="image/*" name="foto">\n<button id="pagar">',
    trabalho: '<input type="file" accept="image/*" name="foto">' });
  assert.deepStrictEqual(r.sumiram.map((s) => s.item), ['id:pagar'], 'a remocao depois do image/* aparece');
  assert.deepStrictEqual(Array.from(inv.fiacao('<a href="/docs/*">\n<i id="ok">').keys()), ['link:/docs/*', 'id:ok']);
  assert.deepStrictEqual(Array.from(inv.fiacao("const p = import.meta.glob('./pages/*.tsx');\n<i id=\"ok\">")),
    [['id:ok', 2]], 'a string de JS com /* nao apaga o resto');
  assert.deepStrictEqual(Array.from(inv.fiacao('const s = `a/*b`;\n<i id="ok">').keys()), ['id:ok'], 'nem a de crase');
  // O comentario de verdade depois da string segue escondendo a tag.
  assert.deepStrictEqual(Array.from(inv.fiacao('const s = "/";\n/* <b id="x"> */ <i id="ok">').keys()), ['id:ok']);
  // No .html o // e texto da pagina, no meio ou no comeco da linha; fora dele e comentario, tambem depois do codigo.
  assert.strictEqual(inv.dispensas('<p>a // sworn-dispensa: id:pagar -- ' + longo + '</p>', 'a.html').validas.size, 0);
  assert.strictEqual(inv.dispensas('<p>\n  // sworn-dispensa: id:pagar -- ' + longo + '\n</p>', 'a/B.HTM').validas.size, 0);
  assert.deepStrictEqual(Array.from(inv.dispensas('x\n  // sworn-dispensa: id:a -- ' + longo).validas.keys()), ['id:a']);
  assert.deepStrictEqual(Array.from(inv.dispensas('const t = 1; // sworn-dispensa: id:a -- ' + longo, 'a.tsx')
    .validas.keys()), ['id:a'], 'o // depois do codigo, num .tsx');
  assert.deepStrictEqual(Array.from(inv.fiacao('<p>\n// <i id="x">\n</p>', 'a.html').keys()), ['id:x'], 'no .html, // e texto');
  assert.deepStrictEqual(Array.from(inv.fiacao('// <i id="x">\n<i id="ok">', 'a.tsx').keys()), ['id:ok'], 'no .tsx, comenta');
  // O /* sem */ depois nao e comentario: o texto da pagina com src/* nao apaga o resto, e o comentario seguinte conta.
  const r2 = inv.montar({ head: '<p>Arquivos em src/* vao para o build</p>\n<button id="pagar">', trabalho: '<p>x</p>',
    caminho: 'a.html' });
  assert.deepStrictEqual(r2.sumiram.map((s) => s.item), ['id:pagar'], 'a remocao depois do src/* aparece');
  assert.deepStrictEqual(Array.from(inv.dispensas('<p>src/*</p>\n<!-- sworn-dispensa: id:a -- ' + longo + ' -->')
    .validas.keys()), ['id:a']);
  assert.strictEqual(inv.dispensas('<p>src/* x sworn-dispensa: id:a -- ' + longo + '</p>', 'a.html').validas.size, 0);
  assert.deepStrictEqual(Array.from(inv.fiacao('src/*\n<!-- <b id="x"> -->\n<i id="ok">')), [['id:ok', 3]],
    'depois do /* solto, o <!-- --> segue escondendo, e a linha segue certa');
  assert.deepStrictEqual(Array.from(inv.fiacao('a /*/ b\n<i id="ok">').keys()), ['id:ok'], 'o /*/ nao se fecha sozinho');
  // O montar passa o caminho aos dois lados e as dispensas: no .html, a linha com // e texto em todos.
  const r3 = inv.montar({ head: '<p>\n// <i id="x"> <i id="y">\n</p>',
    trabalho: '<p>\n// <i id="y"> sworn-dispensa: id:x -- ' + longo + '\n</p>', caminho: 'a.html' });
  assert.deepStrictEqual(r3.sumiram.map((s) => s.item), ['id:x']);
  // O /* que fecha segue escondendo, mesmo com outro /* solto depois.
  assert.deepStrictEqual(Array.from(inv.fiacao('/* <b id="x"> */ src/*\n<i id="ok">').keys()), ['id:ok']);
  // O marcador dentro de um atributo ou de uma string nao e comentario.
  assert.strictEqual(inv.dispensas('<a title="/* sworn-dispensa: id:a -- ' + longo + ' */">').validas.size, 0);
  assert.strictEqual(inv.dispensas('const s = "/* sworn-dispensa: id:a -- ' + longo + ' */";').validas.size, 0);
  // Sem aspas, so a tag casada inteira segura o /* e o // do valor.
  assert.deepStrictEqual(Array.from(inv.fiacao('<a href=/docs/* >\n<i id="ok">').keys()), ['link:/docs/*', 'id:ok']);
  assert.strictEqual(inv.dispensas('<a href=/a/* title="sworn-dispensa: id:a -- ' + longo + ' */">').validas.size, 0);
  // A tag numa string de JS segue contando, como antes da string protegida.
  assert.deepStrictEqual(Array.from(inv.fiacao("const t = '<i id=\"ok\">';").keys()), ['id:ok']);
});

test('E3 item 4: a dispensa so vale dentro de comentario, e o motivo vai ate o fim do comentario ou da linha', () => {
  const longo = 'removido nesta reforma de tela';
  assert.strictEqual(inv.dispensas('<p>sworn-dispensa: id:pagar -- ' + longo + '</p>').validas.size, 0, 'texto da pagina');
  assert.strictEqual(inv.dispensas('const s = "sworn-dispensa: id:pagar -- ' + longo + '";').validas.size, 0, 'string');
  const d = inv.dispensas('// sworn-dispensa: id:pagar -- o {x} saiu porque a tela de pagamento foi removida\n' +
    '<a href="http://x"> <!-- sworn-dispensa: id:b -- ' + longo + ' -->\n' +
    '{/* sworn-dispensa: id:c -- ' + longo + ' */}\n' +
    '<!--\n\n  sworn-dispensa: id:d -- curto\n-->');
  assert.deepStrictEqual(Array.from(d.validas), [['id:pagar', 'o {x} saiu porque a tela de pagamento foi removida'],
    ['id:b', longo], ['id:c', longo]], 'a chave no motivo nao o corta; o fim do comentario sim');
  assert.deepStrictEqual(d.invalidas, [{ item: 'id:d', motivo: 'curto', linha: 6 }], 'a linha conta dentro do comentario');
  // O comentario que nao fecha vai ate o fim do texto: muitos <!-- soltos se leem em tempo linear.
  const t0 = Date.now();
  // (Com o comentario sem fim que volta a cada `<!--`, os 100 mil levam ~10 s; lidos ate o fim, ~1 ms.)
  for (const solto of ['<!--', '/* ']) { // o espaco: '/*/*' ja traz um '*/' que fecha
    const r = inv.montar({ head: solto.repeat(100000), trabalho: solto.repeat(100000) });
    assert.strictEqual(r.total, 0);
  }
  assert.ok(Date.now() - t0 < 3000, 'levou ' + (Date.now() - t0) + ' ms');
  // O `//` logo depois de `:` e URL, nao comentario: o marcador no texto depois dela nao dispensa.
  assert.strictEqual(inv.dispensas('<p>veja http://x sworn-dispensa: id:a -- ' + longo + '</p>').validas.size, 0);
});

test('E3 item 4: o fecho confere os mantidos, conta o que o teto cortou e diz a dispensa recusada sem fiacao', () => {
  assert.strictEqual(inv.fraseDoFecho({ total: 5 }), null, 'sem mantidos, sem frase com undefined');
  assert.strictEqual(inv.fraseDoFecho({ total: 0, mantidos: 0, dispensasInvalidas: [{ item: 'id:x', motivo: 'curto' }] }),
    'inventario da tela: nada ligado no HEAD, 1 dispensa(s) recusada(s) por motivo curto (inventario.dispensasInvalidas): ' +
    'reescreva o motivo com 12 letras ou mais');
  const n = inv.TETO + 3;
  const head = Array.from({ length: n }, (_, i) => '<i id="i' + i + '">').join('\n');
  const trabalho = Array.from({ length: n }, (_, i) => '<!-- sworn-dispensa: id:i' + i + ' -- saiu na reforma da tela -->')
    .join('\n');
  const r = inv.montar({ head, trabalho });
  assert.strictEqual(r.dispensados.length, inv.TETO);
  assert.strictEqual(r.dispensadosForaDoTeto, 3);
  assert.strictEqual(r.mantidos, 0);
  assert.match(inv.fraseDoFecho(r), new RegExp('^inventario da tela: mantido 0/' + n + ', ' + n + ' dispensado\\(s\\) com motivo, sem'));
  const curtas = inv.montar({ head: '', trabalho: trabalho.replace(/saiu na reforma da tela/g, 'x') });
  assert.strictEqual(curtas.dispensasInvalidas.length, inv.TETO);
  assert.strictEqual(curtas.invalidasForaDoTeto, 3);
  assert.match(inv.fraseDoFecho(curtas), new RegExp('nada ligado no HEAD, ' + n + ' dispensa'));
});

test('E3 item 4: o arquivo com milhares de tags se le em tempo linear', () => {
  const grande = Array.from({ length: 40000 }, (_, i) => '<div id="i' + i + '"></div>').join('\n');
  const t = Date.now();
  const r = inv.montar({ head: grande, trabalho: grande });
  assert.strictEqual(r.mantidos, 40000);
  const ms = Date.now() - t;
  assert.ok(ms < 5000, 'levou ' + ms + ' ms');
});

test('E3 item 4: o arquivo de tela se reconhece pela extensao, sem caixa', () => {
  assert.ok(inv.ehArquivoDeTela('src/App.TSX') && inv.ehArquivoDeTela('a.vue') && !inv.ehArquivoDeTela('a.css'));
});

test('E3 item 4: pelo CLI, o preparar grava o inventario da tela e o apurar poe o mantido N/N no fecho', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-inventario-'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-inventario-tmp-'));
  try {
    const g = (args) => {
      const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', shell: false, timeout: 30000 });
      assert.strictEqual(r.status, 0, 'git ' + args.join(' ') + ': ' + (r.error ? r.error.message : r.stdout + r.stderr));
    };
    g(['init', '-q', '.']); g(['config', 'user.email', 'ensaio@ensaio']); g(['config', 'user.name', 'ensaio']);
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify({ versaoConfig: 1 }));
    fs.writeFileSync(path.join(dir, 'tela.html'), '<button id="pagar" onclick="pagar()">Pagar</button>\n<a href="/ajuda">a</a>\n');
    fs.writeFileSync(path.join(dir, 'novo.html'), '');
    g(['add', 'tela.html']); g(['commit', '-qm', 'base']);
    // No .html o // e texto da pagina: a linha abaixo nao dispensa (o preparar passa o caminho ao inventario).
    fs.writeFileSync(path.join(dir, 'tela.html'), '<button id="pagar">Pagar</button>\n<a href="/ajuda">a</a>\n' +
      '// sworn-dispensa: evento:onclick=pagar() -- removido nesta reforma de tela\n');
    const env = Object.assign({}, process.env, { SWORN_TMP: tmp });
    delete env.CLAUDE_CODE_SESSION_ID;
    const rodar = (script, args) => spawnSync(process.execPath, [path.join(RAIZ, 'scripts', script)].concat(args),
      { cwd: dir, encoding: 'utf8', env, timeout: 60000 });
    const p = rodar('preparar-revisao.js', ['--arquivo', 'tela.html', '--semente', 'fixa']);
    assert.strictEqual(p.status, 0, p.stdout + p.stderr);
    const saida = JSON.parse(p.stdout);
    const pasta = path.dirname(saida.a);
    const gravado = JSON.parse(fs.readFileSync(path.join(pasta, 'inventario.json'), 'utf8'));
    assert.deepStrictEqual(gravado.sumiram, [{ item: 'evento:onclick=pagar()', linhaNoAntes: 1 }]);
    assert.match(saida.aviso, /inventario\.json guarda o que a tela ligava no HEAD \(id, evento, link, campo, gancho de teste, script, destino do formulario\) e o que sumiu no trabalho/);
    // Arquivo novo: sem antes, sem inventario.
    const pn = rodar('preparar-revisao.js', ['--arquivo', 'novo.html', '--semente', 'fixa']);
    assert.strictEqual(pn.status, 0, pn.stdout + pn.stderr);
    const n = JSON.parse(pn.stdout);
    assert.ok(!fs.existsSync(path.join(path.dirname(n.a), 'inventario.json')));
    // A ronda 1 completa e sem achado nenhum aprova (scripts/lib/veredito.js): o fecho traz o mantido N/N.
    const lentes = saida.lentes;
    assert.ok(Array.isArray(lentes) && lentes.length, 'a saida do preparar traz as lentes: ' + p.stdout);
    const votar = (d) => {
      fs.mkdirSync(path.join(d, 'vereditos'), { recursive: true });
      for (const l of lentes) {
        fs.writeFileSync(path.join(d, 'vereditos', l + '.json'), JSON.stringify({ lente: l, melhor: 'empate', achados: [] }));
      }
    };
    votar(pasta);
    const a = rodar('apurar-ronda.js', ['--arquivo', 'tela.html', '--sessao', 'inventario']);
    assert.strictEqual(a.status, 0, a.stdout + a.stderr);
    const ap = JSON.parse(a.stdout);
    assert.strictEqual(ap.inventario.mantidos, 2);
    assert.strictEqual(ap.encerrar, true, a.stdout);
    assert.match(ap.motivo, /^ronda 1 completa sem achado nenhum: aprovado/);
    assert.match(ap.motivo, /; inventario da tela: mantido 2\/3, 1 sumiu\(ram\) sem dispensa \(inventario\.sumiram\)/);
    // Fora da forma: ERRO, nunca o fecho calado.
    // Cada campo sozinho fora da forma barra (o total em texto, os mantidos ausentes, a lista que nao e lista, mais
    // mantidos que o total, mantidos negativos, o item da lista que nao e objeto com "item").
    for (const torta of [{ total: '3', mantidos: 2, sumiram: [] }, { total: 3, sumiram: [] }, { total: 3, mantidos: 2, sumiram: 'x' },
      { total: 3, mantidos: 4, sumiram: [] }, { total: 3, mantidos: -1, sumiram: [] }, { total: 3, mantidos: 2, sumiram: ['id:x'] },
      { total: 3, mantidos: 2, sumiram: [{ item: 7 }] }]) {
      fs.writeFileSync(path.join(pasta, 'inventario.json'), JSON.stringify(torta));
      const torto = rodar('apurar-ronda.js', ['--arquivo', 'tela.html', '--sessao', 'inventario']);
      assert.strictEqual(torto.status, 1, JSON.stringify(torta) + ': ' + torto.stdout);
      assert.match(torto.stdout, /inventario\.json nao tem o formato esperado/);
    }
    fs.writeFileSync(path.join(pasta, 'inventario.json'), '{');
    const ilegivel = rodar('apurar-ronda.js', ['--arquivo', 'tela.html', '--sessao', 'inventario']);
    assert.strictEqual(ilegivel.status, 1, ilegivel.stdout);
    assert.match(ilegivel.stdout, /inventario\.json ilegivel \(.+\)\. Ele e gravado pelo preparar-revisao\.js e ninguem o edita: prepare uma ronda nova, ou apague-o/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
