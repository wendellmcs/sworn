'use strict';
// R2b: a conferencia da tela contra a referencia, largura por largura (scripts/lib/conferencia-tela.js).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const conf = require('../scripts/lib/conferencia-tela.js');

function layout(o) {
  return Object.assign({ janela: 1440, pagina: 1440, rolagemLateral: false, tipos: { h1: 40, h2: 28, corpo: 16 },
    coluna: 1100, blocos: [{ tag: 'header', porLinha: 1 }, { tag: 'section', porLinha: 3 }], cortado: false,
    arvore: arvore([['heading', 'Titulo'], ['button', 'Menu']]) }, o);
}

// A arvore de acessibilidade como a evidencia da captura grava: [papel, nome] em ordem.
function arvore(pares, cortada) {
  return { itens: pares.map(function (p) { return { papel: p[0], nome: p[1] }; }), cortada: !!cortada };
}

// A conferencia de duas larguras, com a arvore de cada lado: { tela: [1440, 390], referencia: [1440, 390] }.
function conferirArvores(tela, referencia) {
  return conf.conferir([1440, 390].map(function (w, i) {
    return { largura: w, tela: layout({ arvore: tela[i] }), referencia: layout({ arvore: referencia[i] }) };
  }), null);
}

test('R2b: medicoes iguais nao tem diferenca, e a largura conta como comparada', function () {
  const r = conf.compararLargura(1440, layout(), layout(), null);
  assert.deepStrictEqual(r, { largura: 1440, comparada: true, diferencas: [], naoComparado: [] });
});

test('R2b: tipo e coluna so diferem alem da folga (2 px no tipo, 8 px na coluna)', function () {
  const dentro = conf.compararLargura(1440, layout({ tipos: { h1: 42, h2: 26, corpo: 16 }, coluna: 1108 }), layout(), null);
  assert.deepStrictEqual(dentro.diferencas, [], 'dentro da folga');
  const fora = conf.compararLargura(1440, layout({ tipos: { h1: 43, h2: 28, corpo: 16 }, coluna: 1091 }), layout(), null);
  assert.deepStrictEqual(fora.diferencas, [
    { medida: 'h1', tela: 43, referencia: 40 },
    { medida: 'coluna', tela: 1091, referencia: 1100 },
  ]);
});

test('R2b: a rolagem lateral e diferenca quando so um dos lados rola', function () {
  const rola = layout({ pagina: 1600, rolagemLateral: true });
  assert.deepStrictEqual(conf.compararLargura(390, rola, layout(), null).diferencas,
    [{ medida: 'rolagem lateral', tela: true, referencia: false }]);
  assert.deepStrictEqual(conf.compararLargura(390, rola, rola, null).diferencas, [], 'as duas rolam: igual');
  assert.deepStrictEqual(conf.compararLargura(390, layout(), rola, null).diferencas,
    [{ medida: 'rolagem lateral', tela: false, referencia: true }], 'a referencia rola e a tela nao: diferenca tambem');
});

test('R2b: o que existe de um lado so e diferenca; o que a leitura cortada nao viu e nao comparado', function () {
  const semH2 = layout({ tipos: { h1: 40, h2: null, corpo: 16 } });
  assert.deepStrictEqual(conf.compararLargura(768, semH2, layout(), null).diferencas,
    [{ medida: 'h2', tela: null, referencia: 28 }]);
  const cortada = layout({ tipos: { h1: 40, h2: null, corpo: 16 }, cortado: true });
  const r = conf.compararLargura(768, cortada, layout(), null);
  assert.deepStrictEqual(r.diferencas, []);
  assert.strictEqual(r.comparada, false);
  assert.deepStrictEqual(r.naoComparado, [
    'h2: a leitura da tela parou antes de achar essa medida (a pagina passou do teto de elementos lidos): confira na foto',
    'blocos: a leitura da tela parou antes do fim (a pagina passou do teto de elementos lidos): confira na foto']);
  // O espelho: a referencia cortada, sem o h2 que a tela tem.
  const ref = conf.compararLargura(768, layout(), cortada, null);
  assert.deepStrictEqual(ref.diferencas, []);
  assert.deepStrictEqual(ref.naoComparado.map(function (m) { return m.split(' parou')[0]; }),
    ['h2: a leitura da referencia', 'blocos: a leitura da referencia']);
  const ambos = conf.compararLargura(768, semH2, semH2, null);
  assert.deepStrictEqual(ambos.diferencas, [], 'sem h2 dos dois lados: nada a comparar, nada diferente');
});

test('R2b: os blocos se pareiam pela tag, na ordem, e a contagem diferente tambem e diferenca', function () {
  const tela = layout({ blocos: [{ tag: 'header', porLinha: 1 }, { tag: 'section', porLinha: 1 }, { tag: 'footer', porLinha: 1 }] });
  const ref = layout({ blocos: [{ tag: 'header', porLinha: 1 }, { tag: 'section', porLinha: 3 }, { tag: 'section', porLinha: 2 }] });
  assert.deepStrictEqual(conf.compararLargura(1440, tela, ref, null).diferencas, [
    { medida: 'blocos lado a lado', tag: 'section', ordem: 1, tela: 1, referencia: 3 },
    { medida: 'quantos blocos', tag: 'section', tela: 1, referencia: 2 },
    { medida: 'quantos blocos', tag: 'footer', tela: 1, referencia: 0 },
  ]);
});

test('R2b: a medicao que falta, falhou ou e ilegivel de um lado e nao comparada, nunca igual', function () {
  for (const [nome, tela, ref, motivo] of [
    ['tela sem medir', null, layout(), 'a tela nao foi medida'],
    ['referencia sem medir', layout(), undefined, 'a referencia nao foi medida'],
    ['tela com erro', { ilegivel: true, erro: 'nao deu para medir o layout: x' }, layout(), 'a tela: nao deu para medir o layout: x'],
    ['referencia ilegivel', layout(), { ilegivel: true }, 'a referencia: a leitura do layout voltou sem a forma esperada (faltou o tipo ou os blocos): capture de novo; se repetir, confira o layout na foto'],
    ['tela sem corpo', { semCorpo: true }, layout(), 'a tela: a pagina nao e um documento HTML com corpo'],
  ]) {
    const r = conf.compararLargura(1440, tela, ref, null);
    assert.deepStrictEqual(r, { largura: 1440, comparada: false, diferencas: [], naoComparado: [motivo] }, nome);
  }
});

test('R2b: com o design.json, a diferenca de tipo diz o tamanho do sistema mais perto do da referencia', function () {
  const sistema = { cores: [], raios: [], espacos: [], tamanhos: ['14px', '1.25rem', '24px', 'grande'] };
  const r = conf.compararLargura(1440, layout({ tipos: { h1: 32, h2: 28, corpo: 14 } }),
    layout({ tipos: { h1: 25, h2: 28, corpo: 20 } }), sistema);
  assert.deepStrictEqual(r.diferencas, [
    { medida: 'h1', tela: 32, referencia: 25, token: { valor: '24px', px: 24, igual: false } },
    { medida: 'corpo', tela: 14, referencia: 20, token: { valor: '1.25rem', px: 20, igual: true } },
  ]);
  const semTamanhos = conf.compararLargura(1440, layout({ tipos: { h1: 32, h2: 28, corpo: 16 } }), layout(), { cores: [] });
  assert.deepStrictEqual(semTamanhos.diferencas, [{ medida: 'h1', tela: 32, referencia: 40 }], 'sem tamanhos, sem token');
  assert.deepStrictEqual(conf.tokenDoTamanho(22, { tamanhos: ['20px', '24px'] }), { valor: '20px', px: 20, igual: false },
    'no empate, o primeiro declarado');
  assert.strictEqual(conf.tokenDoTamanho(1, { tamanhos: ['grande', 'auto'] }), null, 'tamanho que nao vira px nao e token');
});

test('R2b: conferir junta as larguras e so fica tudoComparado sem nada nao comparado', function () {
  const r = conf.conferir([
    { largura: 1440, tela: layout(), referencia: layout() },
    { largura: 390, tela: layout({ coluna: 300 }), referencia: layout({ coluna: 360 }) },
  ], null);
  assert.strictEqual(r.tudoComparado, true);
  assert.strictEqual(r.diferencas, 1);
  assert.strictEqual(r.naoComparado, 0);
  assert.strictEqual(r.larguras.length, 2);
  const falta = conf.conferir([{ largura: 1440, tela: layout(), referencia: null }], null);
  assert.strictEqual(falta.tudoComparado, false);
  assert.strictEqual(falta.naoComparado, 1);
  // Uma largura comparada e a outra com a tela que nao abriu: a que se comparou fica, e o todo nao passa.
  const metade = conf.conferir([{ largura: 1440, tela: layout(), referencia: layout() },
    { largura: 390, tela: { ilegivel: true, erro: 'a captura falhou: nao abriu' }, referencia: layout() }], null);
  assert.deepStrictEqual([metade.tudoComparado, metade.naoComparado, metade.larguras.map(function (l) { return l.comparada; })],
    [false, 1, [true, false]], 'uma largura sem a tela barra o todo, e a outra segue comparada');
  assert.strictEqual(conf.conferir([], null).tudoComparado, false, 'nenhuma largura medida nao e tudo comparado');
});

test('H10b: o elemento da referencia que some da tela numa largura vira diferenca, com as larguras em que a tela o tem', function () {
  const cheia = arvore([['banner', ''], ['heading', 'Titulo'], ['button', 'Menu'], ['link', 'Entrar']]);
  const semMenu = arvore([['banner', ''], ['heading', 'Titulo'], ['link', 'Entrar']]);
  const r = conferirArvores([cheia, semMenu], [cheia, cheia]);
  assert.deepStrictEqual(r.larguras.map(function (l) { return l.diferencas; }), [[], [
    { medida: 'some da arvore', papel: 'button', nome: 'Menu', tela: false, referencia: true, naTelaEm: [1440] }]]);
  assert.strictEqual(r.diferencas, 1);
  assert.strictEqual(r.tudoComparado, true, 'a diferenca nao barra: so o que nao se comparou barra');
  // A referencia que tambem esconde o botao na 390: igual.
  assert.strictEqual(conferirArvores([cheia, semMenu], [cheia, semMenu]).diferencas, 0, 'os dois somem na 390: igual');
  // O mesmo elemento duas vezes na referencia conta uma vez: a presenca, nao a contagem.
  const dobrada = arvore([['heading', 'Titulo'], ['button', 'Menu'], ['button', 'Menu']]);
  assert.strictEqual(conferirArvores([cheia, semMenu], [dobrada, dobrada]).diferencas, 1);
});

test('H10b: o elemento que so um dos lados tem e conteudo diferente, nao diferenca; sem nome nao conta', function () {
  // A referencia de outro produto: os nomes so dela nao viram "sumiu".
  const tela = arvore([['heading', 'Planos'], ['button', 'Assinar']]);
  const ref = arvore([['heading', 'Pricing'], ['button', 'Buy now'], ['link', 'Login']]);
  assert.strictEqual(conferirArvores([tela, tela], [ref, ref]).diferencas, 0, 'nada em comum: nada a comparar');
  // O que so a tela tem e some na 390 (o menu dela que vira um botao): a referencia nunca o teve.
  const telaMenu = arvore([['heading', 'Planos'], ['link', 'Sobre']]);
  assert.strictEqual(conferirArvores([telaMenu, arvore([['heading', 'Planos']])], [ref, ref]).diferencas, 0,
    'o que a referencia nunca teve nao some dela');
  // Sem nome, o elemento nao diz o que sumiu: fica fora.
  const comVazio = arvore([['heading', 'Planos'], ['button', '']]);
  assert.strictEqual(conferirArvores([comVazio, arvore([['heading', 'Planos']])], [comVazio, comVazio]).diferencas, 0);
  // O papel faz parte do elemento: o mesmo nome em outro papel nao e o mesmo.
  const comoLink = arvore([['link', 'Menu']]);
  const comoBotao = arvore([['button', 'Menu']]);
  assert.strictEqual(conferirArvores([comoLink, comoLink], [comoBotao, comoBotao]).diferencas, 0);
});

test('H10b: a arvore cortada no teto deixa sem comparar so o que pode estar alem dele', function () {
  const cheia = arvore([['heading', 'Titulo'], ['button', 'Menu']]);
  const semMenu = arvore([['heading', 'Titulo']]);
  // A tela cortada na 390 sem o Menu: pode estar alem do teto. Nao comparado, nunca diferenca.
  const telaCortada = conferirArvores([cheia, arvore([['heading', 'Titulo']], true)], [cheia, cheia]);
  assert.deepStrictEqual(telaCortada.larguras[1].diferencas, []);
  assert.deepStrictEqual(telaCortada.larguras[1].naoComparado, ['arvore: a leitura da tela parou no teto de 500 itens, ' +
    'e 1 elemento(s) da referencia nao apareceram antes dele (podem estar alem do teto): confira na foto']);
  assert.strictEqual(telaCortada.larguras[1].comparada, false);
  assert.strictEqual(telaCortada.tudoComparado, false);
  // A referencia cortada na 390, e a tela sem o Menu ali: a referencia pode te-lo alem do teto.
  const refCortada = conferirArvores([cheia, semMenu], [cheia, arvore([['heading', 'Titulo']], true)]);
  assert.deepStrictEqual(refCortada.larguras[1].naoComparado, ['arvore: a leitura da referencia parou no teto de 500 ' +
    'itens, e 1 elemento(s) que a tela tem em outra largura nao apareceram antes dele (podem estar alem do teto): ' +
    'confira na foto']);
  assert.deepStrictEqual(refCortada.larguras[1].diferencas, []);
  // O corte que nao esconde nada que se compara nao barra.
  const semEfeito = conferirArvores([cheia, cheia], [arvore([['heading', 'Titulo'], ['button', 'Menu']], true), cheia]);
  assert.strictEqual(semEfeito.tudoComparado, true, 'a referencia cortada com tudo achado');
  assert.strictEqual(conferirArvores([cheia, arvore([['heading', 'Titulo'], ['button', 'Menu']], true)], [cheia, cheia])
    .tudoComparado, true, 'a tela cortada com tudo achado');
  // A referencia cortada sem o Menu na 1440, onde a tela o tem: nada sumiu ali.
  assert.strictEqual(conferirArvores([cheia, cheia], [arvore([['heading', 'Titulo']], true), cheia]).tudoComparado, true,
    'o que a tela tem na largura nao e incerto');
  // O que so a tela tem (a referencia nunca o leu) e some na 390, com a referencia cortada ali: nao e incerto.
  const comSobre = arvore([['heading', 'Titulo'], ['button', 'Menu'], ['link', 'Sobre']]);
  assert.strictEqual(conferirArvores([comSobre, cheia], [cheia, arvore([['heading', 'Titulo'], ['button', 'Menu']], true)])
    .tudoComparado, true, 'o que a referencia nunca teve nao fica incerto');
  // A referencia cortada que leu o Menu na 390, e a tela sem ele: diferenca, nao incerto.
  const leu = conferirArvores([cheia, semMenu], [cheia, arvore([['heading', 'Titulo'], ['button', 'Menu']], true)]);
  assert.deepStrictEqual([leu.larguras[1].naoComparado, leu.larguras[1].diferencas.length], [[], 1]);
});

test('H10b: a arvore que falta ou vem torta deixa a largura sem comparar, sem repetir o motivo da captura', function () {
  const cheia = arvore([['heading', 'Titulo'], ['button', 'Menu']]);
  const torta = function (a) {
    const r = conf.conferir([{ largura: 390, tela: layout({ arvore: a }), referencia: layout() }], null);
    return r.larguras[0].naoComparado;
  };
  const motivo = 'a tela: a arvore de acessibilidade veio sem a forma esperada (faltou a lista de itens ou o corte): ' +
    'capture de novo; se repetir, e defeito do sworn: confira na foto os elementos de cada largura e diga ao dono que a ' +
    'arvore ficou sem comparar';
  for (const [nome, a] of [['sem arvore', undefined], ['sem itens', { cortada: false }], ['sem corte', { itens: [] }],
    ['item sem nome', { itens: [{ papel: 'button' }], cortada: false }], ['item nulo', { itens: [null], cortada: false }]]) {
    assert.deepStrictEqual(torta(a), [motivo], nome);
  }
  // A captura que falhou ja diz o motivo: a arvore que nao veio nao repete.
  const falhou = conf.conferir([{ largura: 390, tela: { erro: 'a captura falhou: nao abriu' }, referencia: layout() }], null);
  assert.deepStrictEqual(falhou.larguras[0].naoComparado, ['a tela: a captura falhou: nao abriu']);
  // So o layout falhou, e a arvore veio: ela se compara mesmo assim.
  const soLayout = conf.conferir([
    { largura: 1440, tela: layout({ arvore: cheia }), referencia: layout({ arvore: cheia }) },
    { largura: 390, tela: { ilegivel: true, erro: 'nao deu para medir o layout: x', arvore: arvore([['heading', 'Titulo']]) },
      referencia: layout({ arvore: cheia }) }], null);
  assert.deepStrictEqual(soLayout.larguras[1].naoComparado, ['a tela: nao deu para medir o layout: x']);
  assert.deepStrictEqual(soLayout.larguras[1].diferencas, [
    { medida: 'some da arvore', papel: 'button', nome: 'Menu', tela: false, referencia: true, naTelaEm: [1440] }]);
});

test('H10b: o nome comprido aparece cortado na diferenca, e o par se acha pelo nome inteiro', function () {
  const longo = 'x'.repeat(300);
  const r = conferirArvores([arvore([['button', longo]]), arvore([])], [arvore([['button', longo]]), arvore([['button', longo]])]);
  const d = r.larguras[1].diferencas[0];
  assert.strictEqual(d.nome, 'x'.repeat(200) + '...');
  // Dois nomes com o mesmo comeco sao elementos diferentes.
  const outro = 'x'.repeat(250) + 'y';
  assert.strictEqual(conferirArvores([arvore([['button', longo]]), arvore([['button', outro]])],
    [arvore([['button', longo]]), arvore([['button', longo]])]).diferencas, 1);
});

test('R2b: lerArgs le a tela, a referencia, a pasta, as larguras e o prazo, e diz o que consertar', function () {
  const base = ['--url', 'http://localhost:3000', '--referencia', 'https://exemplo.com', '--saida', 'saida'];
  assert.deepStrictEqual(conf.lerArgs(base).opcoes, { url: 'http://localhost:3000', referencia: 'https://exemplo.com',
    saida: 'saida', larguras: [1440, 768, 390], tempoMax: 30000 });
  const lidas = conf.lerArgs(base.concat(['--larguras', '1280, 375,8000', '--tempo-max', '60000'])).opcoes;
  assert.deepStrictEqual(lidas.larguras, [1280, 375, 8000], 'o teto da largura entra');
  assert.strictEqual(lidas.tempoMax, 60000);
  assert.strictEqual(conf.lerArgs(base.concat(['--tempo-max', '600000'])).opcoes.tempoMax, 600000, 'o teto do prazo entra');
  const erro = function (argv) { return conf.lerArgs(argv).erro; };
  assert.match(erro(['--url', 'http://a']), /^falta --referencia/);
  assert.match(erro(['--referencia', 'http://a', '--saida', 's']), /^falta --url/);
  assert.match(erro(['--url', 'http://a', '--referencia', 'http://b']), /^falta --saida/);
  assert.match(erro(base.concat(['--outra', 'x'])), /^argumento desconhecido "--outra"/);
  assert.match(erro(base.concat(['--larguras'])), /^--larguras veio sem valor/);
  assert.match(erro(['--url', '--referencia', 'http://b', '--saida', 's']), /^--url veio sem valor/, 'a flag seguinte nao e o valor');
  assert.match(erro(['--url', 'nada', '--referencia', 'http://b', '--saida', 's']), /^--url nao e um endereco valido/);
  for (const ref of ['ftp://b?token=k1', 'nada?token=k1']) {
    const e = erro(['--url', 'http://a', '--referencia', ref, '--saida', 's']);
    assert.match(e, /^--referencia /, ref);
    assert.ok(!e.includes('k1'), 'o segredo da referencia foi para a mensagem: ' + e);
  }
  for (const l of ['0', '1440,1440', 'a', '1440,,768', '8001', '1,2,3,4,5,6,7', '-390', '1440.5', '']) {
    assert.match(erro(base.concat(['--larguras', l])), /^--larguras /, 'larguras "' + l + '"');
  }
  for (const t of ['0', '600001', 'rapido']) assert.match(erro(base.concat(['--tempo-max', t])), /^--tempo-max /, t);
  // o eco do que veio errado passa pela limpeza de segredo, como o endereco
  for (const argv of [base.concat(['--token=k9segredo', 'x']), base.concat(['--larguras', 'token=k9segredo']),
    base.concat(['--tempo-max', 'token=k9segredo'])]) {
    assert.ok(!erro(argv).includes('k9segredo'), 'o segredo foi para a mensagem: ' + erro(argv));
  }
});

test('R2b: o aviso diz o que fazer com o nao comparado e com a diferenca', function () {
  const larguras = [{ largura: 1440 }];
  assert.strictEqual(conf.avisoDaConferencia({ larguras, diferencas: 0, naoComparado: 0 }), '');
  const ambos = conf.avisoDaConferencia({ larguras, diferencas: 2, naoComparado: 1 });
  assert.match(ambos, /^1 motivo\(s\) do que ficou sem comparar/);
  assert.match(ambos, /a tela nao fica pronta/);
  assert.match(ambos, /confira na foto/, 'o corte que nao se resolve rodando de novo tem saida');
  assert.match(ambos, /2 diferenca\(s\) com a referencia/);
  assert.match(conf.avisoDaConferencia({ larguras: [], diferencas: 0, naoComparado: 0 }), /^nenhuma largura foi medida/,
    'sem largura nenhuma, o aviso nao sai vazio');
  assert.match(conf.avisoDaConferencia({ larguras, diferencas: 3, naoComparado: 0 }), /^3 diferenca\(s\) com a referencia.*de proposito/);
});

// Os erros do comando dizem a causa, sem abrir o navegador.
function pastaDoTeste(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-conferir-'));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

test('R2b: conferir-tela diz a pasta de --saida que nao se cria', function (t) {
  const conferir = require('../scripts/conferir-tela.js');
  const arquivo = path.join(pastaDoTeste(t), 'um-arquivo');
  fs.writeFileSync(arquivo, 'x');
  const r = conferir.main(['--url', 'http://localhost:1', '--referencia', 'http://localhost:2', '--saida',
    path.join(arquivo, 'dentro')]);
  assert.match(r.erro, /^nao deu para criar a pasta de --saida ".*dentro" \(E[A-Z]+\): escolha uma pasta/);
});

test('R2b: conferir-tela repete a linha de erro da captura que falhou, sem o prefixo ERRO', function (t) {
  const conferir = require('../scripts/conferir-tela.js');
  // O endereco invalido para na leitura dos argumentos da captura, antes do navegador.
  const m = conferir.medir('http://', 800, path.join(pastaDoTeste(t), 'tela'), 1000);
  assert.match(m.erro, /^a captura falhou: --url /);
});

test('R2b: o motivo da captura que nao deu certo diz a causa e o que fazer', function (t) {
  const { resultadoDaCaptura } = require('../scripts/conferir-tela.js');
  const de = function (r) { return resultadoDaCaptura(Object.assign({ status: 0, stdout: '', stderr: '' }, r), 150000).erro; };
  assert.strictEqual(de({ error: { code: 'ETIMEDOUT' }, signal: 'SIGTERM', status: null }),
    'a captura passou de 150 s e foi parada: a pagina demorou demais; confira se ela termina de carregar, ou aumente --tempo-max');
  assert.match(de({ signal: 'SIGKILL', status: null }), /^a captura foi parada pelo sinal SIGKILL \(o sistema encerrou o processo/,
    'o processo morto por sinal diz o sinal, nao "codigo null"');
  // O Node que caiu: a linha do erro, nao o aviso da versao no fim nem a pilha.
  const caiu = '[eval]:1\r\nnull.x\r\n     ^\r\n\r\nTypeError: Cannot read properties of null (reading \'x\')\r\n' +
    '    at [eval]:1:6\r\n    at node:internal/main/eval_string:71:3\r\n\r\nNode.js v24.12.0\r\n';
  assert.strictEqual(de({ status: 1, stderr: caiu }), 'a captura falhou: TypeError: Cannot read properties of null (reading \'x\')');
  assert.strictEqual(de({ status: 1, stderr: 'aviso: devagar\nalgo deu errado\n    at f (x.js:1:1)\nNode.js v22.11.0\n' }),
    'a captura falhou: algo deu errado', 'sem linha de erro, a ultima que sobra sem a pilha e o aviso da versao');
  // O erro com propriedades: o Node imprime as chaves dele depois da pilha.
  const comCodigo = 'Error: nao abriu\n    at f (x.js:1:1) {\n  code: \'ERR_X\'\n}\n\nNode.js v24.12.0\n';
  assert.strictEqual(de({ status: 1, stderr: comCodigo }), 'a captura falhou: Error: nao abriu', 'a linha do erro, nao o fecho das chaves');
  assert.strictEqual(de({ status: 1, stdout: 'ERRO: --url sem endereco\n', stderr: caiu }), 'a captura falhou: --url sem endereco',
    'o ERRO da saida padrao vem antes da saida de erro');
  assert.strictEqual(de({ status: 3 }), 'a captura falhou: sem mensagem, codigo 3');
  assert.match(de({ stdout: 'nao e json' }), /^a saida da captura nao e o resumo em JSON esperado: nao e json$/);
  for (const resumo of ['{}', 'null', '{"evidencia":5}']) {
    assert.match(de({ stdout: resumo }), /^o resumo da captura veio sem o caminho da evidencia: rode de novo/, resumo);
  }
  const pasta = pastaDoTeste(t);
  const cortada = path.join(pasta, 'evidencia.json');
  fs.writeFileSync(cortada, '{"layout": {');
  const msg = de({ stdout: JSON.stringify({ evidencia: cortada }) });
  assert.ok(msg.startsWith('nao deu para ler a evidencia da captura em ' + cortada + ' ('), msg);
  assert.match(msg, /\): rode de novo; se repetir, abra o arquivo e veja se ele esta inteiro$/);
  fs.writeFileSync(cortada, '{"layout": {"janela": 800}}');
  assert.deepStrictEqual(resultadoDaCaptura({ status: 0, stdout: JSON.stringify({ evidencia: cortada }) }, 1),
    { janela: 800 }, 'a captura que deu certo devolve o layout da evidencia');
  // H10b: com a arvore de acessibilidade, ela vem junto, em `arvore`; sem o layout, o motivo e a arvore.
  const a = { itens: [{ papel: 'button', nome: 'Menu' }], cortada: false };
  fs.writeFileSync(cortada, JSON.stringify({ layout: { janela: 800 }, acessibilidade: a }));
  assert.deepStrictEqual(resultadoDaCaptura({ status: 0, stdout: JSON.stringify({ evidencia: cortada }) }, 1),
    { janela: 800, arvore: a });
  fs.writeFileSync(cortada, JSON.stringify({ acessibilidade: a }));
  assert.deepStrictEqual(resultadoDaCaptura({ status: 0, stdout: JSON.stringify({ evidencia: cortada }) }, 1),
    { erro: 'a evidencia da captura veio sem o layout', arvore: a });
});
