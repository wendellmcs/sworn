'use strict';
// E1 parte 2 (D827): a foto de cada lado dentro da revisao cega. A parte pura (scripts/lib/tela-cega.js) roda em
// qualquer maquina; a ponta a ponta (preparar-revisao.js com --tela-antes e --tela-depois, depois o apurar-ronda.js)
// abre o Chrome ou o Edge de verdade e e pulada, com o motivo, onde nao ha navegador.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL, fileURLToPath } = require('node:url');
const telaCega = require('../scripts/lib/tela-cega.js');
const captura = require('../scripts/lib/captura.js');

const RAIZ = path.join(__dirname, '..');
const PREPARAR = path.join(RAIZ, 'scripts', 'preparar-revisao.js');
const APURAR = path.join(RAIZ, 'scripts', 'apurar-ronda.js');

test('conferirTelas: --tela-antes pede --tela-depois, e os dois nao podem ser o mesmo endereco', function () {
  assert.strictEqual(telaCega.conferirTelas(null, null), null);
  assert.strictEqual(telaCega.conferirTelas(null, 'http://localhost:3000'), null);
  assert.strictEqual(telaCega.conferirTelas('http://localhost:3001', 'http://localhost:3000'), null);
  assert.match(telaCega.conferirTelas('http://localhost:3001', null), /^--tela-antes pede --tela-depois/);
  const mesmo = telaCega.conferirTelas('http://a.example/?token=abc', 'http://a.example/?token=abc');
  assert.match(mesmo, /sao o mesmo endereco \("http:\/\/a\.example\/\?token=\[segredo\]"\)/);
  assert.ok(!/abc/.test(mesmo), 'o segredo do endereco nao vai para a mensagem');
  // O mesmo endereco escrito de outro jeito tambem e o mesmo.
  assert.match(telaCega.conferirTelas('http://LOCALHOST:3000', 'http://localhost:3000/'), /sao o mesmo endereco/);
  assert.match(telaCega.conferirTelas('http://localhost:3000/', 'http://127.0.0.1:3000/'), /sao o mesmo endereco/);
  assert.match(telaCega.conferirTelas('http://[::1]:3000/a', 'http://localhost:3000/a'), /sao o mesmo endereco/);
  assert.strictEqual(telaCega.conferirTelas('http://127.0.0.1:3001/', 'http://localhost:3000/'), null);
  // Texto vazio conta como flag ausente aqui (a linha de comando ja recusa a flag em branco, ver preparar-revisao abaixo);
  // o que nao e texto nao e endereco.
  assert.strictEqual(telaCega.conferirTelas('', 'http://localhost:3000'), null);
  assert.match(telaCega.conferirTelas(null, 5), /^--tela-depois nao e um endereco: "5"/);
  // O que nao e endereco para aqui, com o exemplo, sem segredo.
  assert.strictEqual(telaCega.conferirTelas('nao e url', 'http://localhost:3000'),
    '--tela-antes nao e um endereco: "nao e url". Passe o endereco inteiro, com http://, https:// ou file:/// ' +
    '(exemplo: http://localhost:3000)');
  assert.match(telaCega.conferirTelas(null, 'localhost:3000/?token=abc'), /^--tela-depois nao e um endereco: "localhost:3000\/\?token=\[segredo\]"/);
  assert.match(telaCega.conferirTelas('abc', 'abc'), /^--tela-antes nao e um endereco/);
});

test('prefixosDoEndereco: a origem do servidor (com os nomes da propria maquina), ou a pasta do arquivo', function () {
  assert.deepStrictEqual(telaCega.prefixosDoEndereco('http://localhost:3001/app?x=1'),
    ['http://localhost:3001', 'http://127.0.0.1:3001', 'http://[::1]:3001']);
  // Sem porta escrita, tambem a padrao por extenso.
  assert.deepStrictEqual(telaCega.prefixosDoEndereco('http://127.0.0.1/x'),
    ['http://localhost', 'http://localhost:80', 'http://127.0.0.1', 'http://127.0.0.1:80', 'http://[::1]', 'http://[::1]:80']);
  assert.deepStrictEqual(telaCega.prefixosDoEndereco('https://app.example/x'), ['https://app.example', 'https://app.example:443']);
  assert.deepStrictEqual(telaCega.prefixosDoEndereco('https://app.example:8443/x'), ['https://app.example:8443']);
  // A pasta, e o caminho do sistema dela; a barra da busca ou do fragmento nao conta.
  assert.deepStrictEqual(telaCega.prefixosDoEndereco('file:///C:/copia/pagina.html?r=a/b#c/d'),
    ['file:///C:/copia/', fileURLToPath('file:///C:/copia/')]);
  assert.deepStrictEqual(telaCega.prefixosDoEndereco('file:///C:/minha%20copia/p.html'),
    ['file:///C:/minha%20copia/', 'file:///C:/minha copia/', fileURLToPath('file:///C:/minha%20copia/')]);
  assert.deepStrictEqual(telaCega.prefixosDoEndereco('nao e url'), []);
  assert.deepStrictEqual(telaCega.prefixosDoEndereco(undefined), []);
});

test('evidenciaCega: sem endereco, hora, duracao e navegador; o endereco da pagina vira [pagina] em todo texto', function () {
  const ev = {
    url: 'http://localhost:3001/app', urlFinal: 'http://localhost:3001/app/', status: 200, hora: '2026-11-10T10:00:00Z',
    navegador: 'C:/nav.exe', largura: 1280, altura: 900, alturaDaPagina: 900, cortada: false, imagem: 'tela.png',
    sha256: 'ab12', duracaoMs: 812,
    console: [{ tipo: 'log', texto: 'abri http://localhost:3001/app' }, null],
    erros: [{ texto: 'Error: x\n    at http://localhost:3001/a.js:4:15', url: 'http://localhost:3001/a.js', linha: 4, coluna: 15 }],
    acessibilidade: { itens: [{ papel: 'link', nome: 'http://localhost:3001/sobre' }], cortada: true },
  };
  assert.deepStrictEqual(telaCega.evidenciaCega(ev, 'B'), {
    imagem: 'B.png', sha256: 'ab12', status: 200, largura: 1280, altura: 900, alturaDaPagina: 900, cortada: false,
    console: [{ tipo: 'log', texto: 'abri [pagina]/app' }],
    erros: [{ texto: 'Error: x\n    at [pagina]/a.js:4:15', url: '[pagina]/a.js', linha: 4, coluna: 15 }],
    foraDoTeto: { console: 0, erros: 0 },
    acessibilidade: { itens: [{ papel: 'link', nome: '[pagina]/sobre' }], cortada: true },
  });
  // O teto de entradas que o inspetor le, e quantas ficaram fora.
  const muitas = Array.from({ length: telaCega.ENTRADAS_DO_INSPETOR + 3 }, function (_, i) { return { tipo: 'log', texto: 'm' + i }; });
  const cheia = telaCega.evidenciaCega({ console: muitas, erros: muitas.slice(0, telaCega.ENTRADAS_DO_INSPETOR) }, 'A');
  assert.strictEqual(cheia.console.length, telaCega.ENTRADAS_DO_INSPETOR);
  assert.strictEqual(cheia.console[telaCega.ENTRADAS_DO_INSPETOR - 1].texto, 'm' + (telaCega.ENTRADAS_DO_INSPETOR - 1));
  assert.deepStrictEqual(cheia.foraDoTeto, { console: 3, erros: 0 });
  // Arquivo local: a pasta inteira sai, com %20 e com o espaco.
  const local = telaCega.evidenciaCega({ url: 'file:///C:/minha%20copia/p.html',
    erros: [{ texto: 'em file:///C:/minha copia/p.html e file:///C:/minha%20copia/p.html', url: '' }] }, 'A');
  assert.strictEqual(local.erros[0].texto, 'em [pagina]/p.html e [pagina]/p.html');
  // O redirecionamento para outra origem: as duas saem.
  const redirecionada = telaCega.evidenciaCega({ url: 'http://localhost:3001/', urlFinal: 'https://login.example/entrar',
    console: [{ tipo: 'log', texto: 'de http://localhost:3001/ para https://login.example/entrar' }] }, 'A');
  assert.strictEqual(redirecionada.console[0].texto, 'de [pagina]/ para [pagina]/entrar');
  // A origem so sai inteira: depois da porta, so um digito continua; o ponto final da frase nao.
  const vizinha = telaCega.evidenciaCega({ url: 'http://localhost:300/',
    console: [{ texto: 'GET http://localhost:3001/x, http://localhost:300/z, http://localhost:300-x e falhou http://localhost:300.' }] }, 'A');
  assert.strictEqual(vizinha.console[0].texto, 'GET http://localhost:3001/x, [pagina]/z, [pagina]-x e falhou [pagina].');
  // Depois de um host sem porta: outro dominio, hifen e outra porta continuam; a porta padrao por extenso e o ponto
  // final, nao.
  const semPorta = telaCega.evidenciaCega({ url: 'https://app.example/',
    console: [{ texto: 'https://app.example.com/x https://app.example-b/y https://app.example:8443/z ' +
      'https://app.example:443/w https://app.example. fim' }] }, 'A');
  assert.strictEqual(semPorta.console[0].texto,
    'https://app.example.com/x https://app.example-b/y https://app.example:8443/z [pagina]/w [pagina]. fim');
  // Uma pasta dentro da outra (a pagina redirecionou para uma subpasta): a mais comprida sai primeiro, inteira.
  const aninhada = telaCega.evidenciaCega({ url: 'file:///C:/a/p.html', urlFinal: 'file:///C:/a/b/q.html',
    console: [{ texto: 'file:///C:/a/b/q.html' }] }, 'A');
  assert.strictEqual(aninhada.console[0].texto, '[pagina]/q.html');
  // O segredo que a pagina escreveu sai tambem na evidencia cega, mesmo que o evidencia.json venha sem a limpeza.
  const comSegredo = telaCega.evidenciaCega({ url: 'http://localhost:3001/',
    console: [{ texto: 'chamei http://localhost:3001/api?token=abc123' }],
    erros: [{ texto: 'Authorization: Bearer x9y8z7w6v5', url: 'http://localhost:3001/a.js?token=abc123' }] }, 'A');
  assert.strictEqual(comSegredo.console[0].texto, 'chamei [pagina]/api?token=[segredo]');
  assert.deepStrictEqual([comSegredo.erros[0].texto, comSegredo.erros[0].url],
    ['Authorization: Bearer [segredo]', '[pagina]/a.js?token=[segredo]']);
  // O caminho do sistema da pasta (C:\copia\ no Windows) tambem sai.
  const doSistema = fileURLToPath('file:///C:/copia/');
  const separador = doSistema.slice(-1); // a barra do sistema que fecha a pasta (\ no Windows, / nos outros)
  const caminho = telaCega.evidenciaCega({ url: 'file:///C:/copia/p.html',
    erros: [{ texto: 'em ' + doSistema + 'p.js:1', url: '' }] }, 'A');
  assert.strictEqual(caminho.erros[0].texto, 'em [pagina]' + separador + 'p.js:1');
  // Outro nome da mesma maquina, e outra caixa, tambem denunciam o lado.
  const outroNome = telaCega.evidenciaCega({ url: 'http://localhost:3001/', urlFinal: 'file:///C:/copia/p.html',
    console: [{ texto: 'http://127.0.0.1:3001/a e http://[::1]:3001/b e HTTP://LOCALHOST:3001/c e file:///c:/copia/p.html' }] }, 'A');
  assert.strictEqual(outroNome.console[0].texto, '[pagina]/a e [pagina]/b e [pagina]/c e [pagina]/p.html');
  // Numero torto (um endereco no lugar da largura) nao passa cru: vira null.
  const torta = telaCega.evidenciaCega({ url: 'http://localhost:3001/', largura: 'http://localhost:3001', altura: NaN,
    alturaDaPagina: 900, erros: [{ texto: 'x', url: '', linha: '4', coluna: 7 }, { texto: 'z', url: '', linha: -1, coluna: 0 }],
    console: ['texto solto', [1, 2], { tipo: 'http://localhost:3001', texto: 'y' }] }, 'A');
  assert.deepStrictEqual([torta.largura, torta.altura, torta.alturaDaPagina], [null, null, 900]);
  assert.deepStrictEqual(torta.erros, [{ texto: 'x', url: '', linha: null, coluna: 7 }, { texto: 'z', url: '', linha: null, coluna: 0 }]);
  assert.deepStrictEqual(torta.console, [{ tipo: '[pagina]', texto: 'y' }]);
  assert.deepStrictEqual(telaCega.evidenciaCega(undefined, 'A'), {
    imagem: 'A.png', sha256: null, status: null, largura: null, altura: null, alturaDaPagina: null, cortada: false,
    console: [], erros: [], foraDoTeto: { console: 0, erros: 0 }, acessibilidade: { itens: [], cortada: false },
  });
});

test('resumoDoFecho: de onde e quando veio a foto, e quanto ela registrou', function () {
  assert.deepStrictEqual(telaCega.resumoDoFecho({ url: 'http://a/', urlFinal: 'http://a/x', status: 404, hora: 'h',
    sha256: 's', console: [{}, {}], erros: [{}], acessibilidade: { itens: [{}, {}, {}] }, cortada: true }, 'A'),
  { rotulo: 'A', url: 'http://a/', urlFinal: 'http://a/x', status: 404, hora: 'h', sha256: 's', console: 2, erros: 1,
    acessibilidade: 3, cortada: true });
  assert.deepStrictEqual(telaCega.resumoDoFecho(null, 'B'), { rotulo: 'B', url: null, urlFinal: null, status: null,
    hora: null, sha256: null, console: 0, erros: 0, acessibilidade: 0, cortada: false });
  // Conta o que o inspetor ve (so objetos), e status fora de 100 a 599 vira null, como na evidenciaCega.
  const torto = { status: -1, console: [null, {}, 'x', [1]], erros: [{}, 5], acessibilidade: { itens: [null, {}] } };
  const resumo = telaCega.resumoDoFecho(torto, 'A');
  assert.deepStrictEqual([resumo.status, resumo.console, resumo.erros, resumo.acessibilidade], [null, 1, 1, 1]);
  const cega = telaCega.evidenciaCega(torto, 'A');
  assert.deepStrictEqual([cega.status, cega.console.length, cega.erros.length, cega.acessibilidade.itens.length], [null, 1, 1, 1]);
  assert.strictEqual(telaCega.resumoDoFecho({ status: 600 }, 'A').status, null);
  assert.strictEqual(telaCega.resumoDoFecho({ status: 100 }, 'A').status, 100);
});

// O processo falso que o capturar roda no teste, e os pedacos fixos das mensagens dele.
const falso = function (resposta) { return function () { return resposta; }; };
const URL_COM_SEGREDO = 'http://a.example/?token=abc';
const DE_NOVO = '. Rode de novo; se repetir, rode a captura sozinha, com o mesmo endereco, que mostra o erro inteiro ' +
  'no terminal: node scripts/capturar-tela.js --url <o endereco> --saida <uma pasta vazia>';
const INICIO = 'a captura de http://a.example/?token=[segredo] ';

test('capturar: o processo que nao termina, nao abre, falha ou para viram erro com o que fazer, sem segredo', function () {
  const url = URL_COM_SEGREDO;
  const prazo = telaCega.capturar(url, 'x', falso({ error: { code: 'ETIMEDOUT' } }));
  assert.strictEqual(prazo.erro, INICIO + 'nao terminou em 120 s' + DE_NOVO);
  assert.strictEqual(telaCega.capturar(url, 'x', falso({ error: { code: 'ENOENT' } })).erro, INICIO + 'nao rodou: nao existe (ENOENT)' + DE_NOVO);
  assert.strictEqual(telaCega.capturar(url, 'x', falso({ status: 1, stdout: 'ERRO: a pagina nao abriu\naviso: perfil\n' })).erro,
    INICIO + 'falhou: a pagina nao abriu; aviso: perfil' + DE_NOVO);
  assert.strictEqual(telaCega.capturar(url, 'x', falso({ status: 1, stdout: '' })).erro,
    INICIO + 'falhou: saiu com 1 sem mensagem' + DE_NOVO);
  assert.strictEqual(telaCega.capturar(url, 'x', falso({ status: null, signal: 'SIGKILL', stdout: '' })).erro,
    INICIO + 'falhou: parou pelo sinal SIGKILL sem mensagem' + DE_NOVO);
  assert.strictEqual(telaCega.capturar(url, 'x', falso({ status: null, stdout: '' })).erro,
    INICIO + 'falhou: parou sem codigo de saida sem mensagem' + DE_NOVO);
  // Sem ERRO no stdout, o stderr (a pilha de uma falha do Node), limpo do segredo.
  const pilha = telaCega.capturar(url, 'x', falso({ status: 1, stdout: '', stderr: 'TypeError: x\n    at ?token=abc' }));
  assert.strictEqual(pilha.erro, INICIO + 'falhou: TypeError: x;     at ?token=[segredo]' + DE_NOVO);
  for (const r of [prazo, pilha]) assert.ok(!/abc/.test(r.erro), 'o segredo nao vai para a mensagem');
});

test('capturar: a saida que nao diz onde gravou a foto vira erro com o que ela imprimiu', function () {
  // Texto solto, null, objeto vazio, sem a imagem.
  for (const stdout of ['oi', 'null', '{}', JSON.stringify({ evidencia: 'e.json' })]) {
    const r = telaCega.capturar(URL_COM_SEGREDO, 'x', falso({ status: 0, stdout: stdout }));
    assert.strictEqual(r.erro, INICIO + 'terminou sem dizer onde gravou a foto; ela imprimiu "' + stdout + '"' + DE_NOVO, stdout);
  }
});

test('capturar: so e sucesso com a foto no disco e a evidencia como objeto; o comando sugerido nao leva o endereco', function () {
  const url = URL_COM_SEGREDO;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-tela-cega-capturar-'));
  try {
    const foto = path.join(pasta, 'tela.png');
    const ev = path.join(pasta, 'evidencia.json');
    const responde = function () { return falso({ status: 0, stdout: JSON.stringify({ ok: true, evidencia: ev, imagem: foto, aviso: 'a' }) }); };
    assert.strictEqual(telaCega.capturar(url, 'x', responde()).erro,
      INICIO + 'disse que gravou a foto em "' + foto + '", mas ela nao se abre: nao existe (ENOENT)' + DE_NOVO);
    fs.mkdirSync(foto);
    assert.strictEqual(telaCega.capturar(url, 'x', responde()).erro,
      INICIO + 'disse que gravou a foto em "' + foto + '", mas ela nao e um arquivo' + DE_NOVO);
    fs.rmdirSync(foto);
    fs.writeFileSync(foto, 'png');
    const QUEBRADA = INICIO + 'gravou a foto, mas o arquivo com o que a pagina registrou (evidencia.json) ';
    assert.strictEqual(telaCega.capturar(url, 'x', responde()).erro,
      QUEBRADA + 'nao se le: nao existe (ENOENT); a captura ficou pela metade' + DE_NOVO);
    fs.writeFileSync(ev, 'nao e json');
    assert.strictEqual(telaCega.capturar(url, 'x', responde()).erro,
      QUEBRADA + 'nao se le: o arquivo esta corrompido; a captura ficou pela metade' + DE_NOVO);
    for (const torto of ['null', '[]', '5', '{}', '{"sha256":5}']) {
      fs.writeFileSync(ev, torto);
      assert.strictEqual(telaCega.capturar(url, 'x', responde()).erro,
        QUEBRADA + 'veio vazio ou incompleto (sem a marca que identifica a foto): a captura ficou pela metade' + DE_NOVO, torto);
    }
    fs.writeFileSync(ev, '{"sha256":"s"}');
    assert.deepStrictEqual(telaCega.capturar(url, 'x', responde()), { evidencia: { sha256: 's' }, imagem: foto, aviso: 'a' });
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  // O comando sugerido nao leva o endereco: nada vindo de fora (aspa ASCII ou tipografica, $(...), crase) chega ao shell.
  const furo = "http://x.example/$(calc)'’`calc`";
  const mensagem = telaCega.capturar(furo, 'p', falso({ error: { code: 'ETIMEDOUT' } })).erro;
  const comando = mensagem.slice(mensagem.indexOf('node scripts/'));
  assert.strictEqual(comando, 'node scripts/capturar-tela.js --url <o endereco> --saida <uma pasta vazia>');
});

// ---------------------------------------------------------------- pelo preparar-revisao.js

function repoComPagina(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-tela-cega-'));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  const g = function (args) { return spawnSync('git', args, { cwd: dir, encoding: 'utf8', shell: false, timeout: 30000 }); };
  g(['init', '-q', '.']);
  g(['config', 'user.email', 'ensaio@ensaio']);
  g(['config', 'user.name', 'ensaio']);
  const pagina = function (titulo) {
    return '<!doctype html><html><head><title>t</title></head><body><h1>' + titulo + '</h1>' +
      '<button>Salvar</button><script>console.log("abri " + location.href)</script>' +
      '<script>throw new Error("quebrou em " + location.href)</script></body></html>\n';
  };
  fs.writeFileSync(path.join(dir, 'pagina.html'), pagina('Antes'), 'utf8');
  g(['add', '-A']);
  g(['commit', '-qm', 'base']);
  // A versao do HEAD roda em outra pasta, como uma copia do repositorio no HEAD.
  const copia = path.join(dir, 'copia-do-head');
  fs.mkdirSync(copia);
  fs.writeFileSync(path.join(copia, 'pagina.html'), pagina('Antes'), 'utf8');
  fs.writeFileSync(path.join(dir, 'pagina.html'), pagina('Depois'), 'utf8');
  return { dir: dir, antes: pathToFileURL(path.join(copia, 'pagina.html')).href,
    depois: pathToFileURL(path.join(dir, 'pagina.html')).href };
}

// A semente "fixa" poe o HEAD em A; a "outra", o trabalho em A (o sorteio e do cegar.rotular).
function preparar(cwd, extra, env, semente) {
  return spawnSync(process.execPath, [PREPARAR, '--arquivo', 'pagina.html', '--semente', semente || 'fixa'].concat(extra),
    { cwd: cwd, encoding: 'utf8', shell: false, timeout: 300000, env: env || process.env });
}

// O JSON da saida do apurar-ronda.js, que pode vir depois de avisos; sem JSON, a falha mostra a saida inteira.
function saidaDoApurar(a) {
  const i = a.stdout.indexOf('{');
  assert.ok(i !== -1, 'o apurar-ronda.js nao devolveu JSON: ' + a.stdout + a.stderr);
  return JSON.parse(a.stdout.slice(i));
}

function revisaoDe(dir) { return path.join(dir, '.claude', 'sworn', 'revisao', 'pagina.html'); }
function telasDe(dir) { return path.join(dir, '.claude', 'sworn', 'revisao-telas'); }

test('preparar-revisao: o uso errado das telas para antes de gravar qualquer coisa', function (t) {
  const p = repoComPagina(t);
  const so = preparar(p.dir, ['--tela-antes', p.antes]);
  assert.strictEqual(so.status, 1, so.stdout);
  assert.match(so.stdout, /^ERRO: --tela-antes pede --tela-depois: .*Nada foi gravado\.\n/);
  const mesmo = preparar(p.dir, ['--tela-antes', p.depois, '--tela-depois', p.depois]);
  assert.match(mesmo.stdout, /^ERRO: --tela-antes e --tela-depois sao o mesmo endereco/);
  const semValor = preparar(p.dir, ['--tela-depois', '--completa']);
  assert.match(semValor.stdout, /^ERRO: --tela-depois pede um valor\./);
  const antesSemValor = preparar(p.dir, ['--tela-antes', '--tela-depois', p.depois]);
  assert.match(antesSemValor.stdout, /^ERRO: --tela-antes pede um valor\./);
  // A flag em branco na linha de comando tambem e "sem valor", nao "sem a flag".
  const vazia = preparar(p.dir, ['--tela-antes', '', '--tela-depois', p.depois]);
  assert.match(vazia.stdout, /^ERRO: --tela-antes pede um valor\./);
  assert.ok(!fs.existsSync(revisaoDe(p.dir)), 'nenhuma ronda gravada');
});

test('preparar-revisao: a captura que falha nao grava a ronda, nao arquiva a revisao fechada e nao deixa a pasta das fotos', function (t) {
  const p = repoComPagina(t);
  // Uma revisao anterior ja fechada: a captura que falha nao pode tira-la de revisao/.
  const r0 = preparar(p.dir, []);
  assert.strictEqual(r0.status, 0, r0.stdout);
  fs.writeFileSync(path.join(revisaoDe(p.dir), 'fechada.json'), JSON.stringify({ ronda: 1, sessao: 't' }), 'utf8');
  const tmp = path.join(p.dir, 'tmp-do-teste');
  fs.mkdirSync(tmp);
  const apontado = path.join(p.dir, 'nao-existe', 'nav.exe');
  const r = preparar(p.dir, ['--tela-depois', p.depois],
    Object.assign({}, process.env, { SWORN_NAVEGADOR: apontado, SWORN_TMP: tmp }));
  assert.strictEqual(r.status, 1, r.stdout);
  assert.match(r.stdout, /^ERRO: a captura de file:\/\/\/.*pagina\.html falhou: SWORN_NAVEGADOR aponta para .*Nada foi gravado\.\n$/);
  assert.ok(fs.existsSync(path.join(revisaoDe(p.dir), 'fechada.json')), 'a revisao fechada segue em revisao/');
  assert.ok(!fs.existsSync(path.join(p.dir, '.claude', 'sworn', 'revisao-fechada')), 'nada foi arquivado');
  assert.ok(!fs.existsSync(path.join(revisaoDe(p.dir), '2')), 'a ronda 2 nao existe');
  assert.deepStrictEqual(fs.readdirSync(tmp), [], 'a pasta de trabalho das fotos saiu da temporaria');
  assert.ok(!fs.existsSync(telasDe(p.dir)), 'nada de pasta de fotos dentro do projeto');
  // A pasta de trabalho nasce na temporaria que SWORN_TMP aponta: se ela nao existe, para antes de capturar.
  const semTmp = preparar(p.dir, ['--tela-depois', p.depois],
    Object.assign({}, process.env, { SWORN_TMP: path.join(p.dir, 'nao-existe-tmp') }));
  assert.strictEqual(semTmp.status, 1, semTmp.stdout);
  assert.match(semTmp.stdout, /^ERRO: nao consegui criar a pasta temporaria das fotos \(nao existe \(ENOENT\)\)\. Nada foi gravado\./);
  assert.ok(fs.existsSync(path.join(revisaoDe(p.dir), 'fechada.json')), 'a revisao fechada segue em revisao/');
});

const NAVEGADOR = captura.acharNavegador(captura.candidatosDoNavegador(process.platform, process.env),
  function (p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });

test('ponta a ponta: cada lado leva a foto pelo rotulo cego, sem endereco; o fecho traz antes e depois, e a ronda ' +
  'seguinte sem foto nao apaga essa evidencia', function (t) {
  if (!NAVEGADOR) { t.skip('sem Chrome nem Edge nesta maquina'); return; }
  const p = repoComPagina(t);
  const r = preparar(p.dir, ['--tela-antes', p.antes, '--tela-depois', p.depois]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const saida = JSON.parse(r.stdout);
  assert.match(saida.aviso, /A foto de cada lado esta em A\.png e B\.png/);
  const ronda = path.dirname(saida.a);
  const mapa = JSON.parse(fs.readFileSync(path.join(ronda, 'mapa.json'), 'utf8'));
  assert.ok(!fs.existsSync(telasDe(p.dir)), 'a pasta de trabalho das fotos saiu');
  for (const rotulo of ['A', 'B']) {
    assert.deepStrictEqual(saida.fotos[rotulo], { imagem: path.join(ronda, rotulo + '.png'),
      evidencia: path.join(ronda, rotulo + '.evidencia.json') });
    const png = fs.readFileSync(saida.fotos[rotulo].imagem);
    assert.strictEqual(png.subarray(1, 4).toString('latin1'), 'PNG');
    const texto = fs.readFileSync(saida.fotos[rotulo].evidencia, 'utf8');
    const ev = JSON.parse(texto);
    // O lado se le pelo conteudo da pagina, e o mapa diz qual e: a foto do HEAD tem "Antes".
    const titulo = mapa.mapa[rotulo] === 'HEAD' ? 'Antes' : 'Depois';
    assert.ok(ev.acessibilidade.itens.some(function (i) { return i.papel === 'heading' && i.nome === titulo; }), texto);
    assert.strictEqual(ev.imagem, rotulo + '.png');
    for (const chave of ['url', 'urlFinal', 'hora', 'duracaoMs', 'navegador']) assert.ok(!(chave in ev), chave);
    assert.ok(!/copia-do-head|sworn-tela-cega-/.test(texto), 'nada do endereco denuncia o lado: ' + texto);
    assert.ok(ev.console.some(function (c) { return c.texto === 'abri [pagina]/pagina.html'; }), texto);
    // O erro da pagina de verdade chega a evidencia, tambem cego.
    assert.ok(ev.erros.some(function (x) { return x.texto.indexOf('quebrou em [pagina]/pagina.html') !== -1; }), texto);
    const resumo = mapa.telas[mapa.mapa[rotulo]];
    assert.strictEqual(resumo.rotulo, rotulo);
    assert.strictEqual(resumo.url, mapa.mapa[rotulo] === 'HEAD' ? p.antes : p.depois);
    assert.strictEqual(resumo.sha256, ev.sha256);
    assert.match(resumo.hora, /^\d{4}-\d\d-\d\dT/);
  }
  // O fecho: o apurar-ronda.js devolve o resumo do mapa.json, com antes e depois. O pendente deixa a revisao aberta
  // para a ronda 2: a ronda 1 sem achado nenhum aprovaria sozinha (F2b), e preparar de novo abriria outra revisao.
  fs.writeFileSync(path.join(ronda, 'vereditos', 'correcao.json'), JSON.stringify({ lente: 'correcao',
    vereditos: path.join(ronda, 'vereditos'), melhor: 'empate', porQue: 'iguais', achados: [{ estado: 'pendente',
      arquivo: 'A.txt', linha: 1, descricao: 'nao vi o resto da pagina', falta: 'o arquivo inteiro' }] }), 'utf8');
  const a = spawnSync(process.execPath, [APURAR, '--arquivo', 'pagina.html', '--sessao', 'teste-tela'],
    { cwd: p.dir, encoding: 'utf8', shell: false, timeout: 60000 });
  const apurado = saidaDoApurar(a);
  assert.deepStrictEqual(apurado.telas, { ronda: 1, pasta: '.claude/sworn/revisao/pagina.html/1',
    antes: mapa.telas.HEAD, depois: mapa.telas.trabalho });
  // A ronda seguinte sem foto (ou com um telas torto, sem lado que seja objeto) nao apaga a evidencia da anterior.
  const r2 = preparar(p.dir, []);
  assert.strictEqual(r2.status, 0, r2.stdout + r2.stderr);
  const ronda2 = path.dirname(JSON.parse(r2.stdout).a);
  const mapa2 = JSON.parse(fs.readFileSync(path.join(ronda2, 'mapa.json'), 'utf8'));
  mapa2.telas = { HEAD: null, trabalho: 'x' };
  fs.writeFileSync(path.join(ronda2, 'mapa.json'), JSON.stringify(mapa2), 'utf8');
  fs.writeFileSync(path.join(ronda2, 'vereditos', 'correcao.json'), JSON.stringify({ lente: 'correcao',
    vereditos: path.join(ronda2, 'vereditos'), melhor: 'empate', porQue: 'iguais', achados: [] }), 'utf8');
  const a2 = spawnSync(process.execPath, [APURAR, '--arquivo', 'pagina.html', '--sessao', 'teste-tela'],
    { cwd: p.dir, encoding: 'utf8', shell: false, timeout: 60000 });
  assert.strictEqual(saidaDoApurar(a2).telas.ronda, 1, a2.stdout);
});

test('ponta a ponta: com referencia, a 2a passada leva as fotos com as letras trocadas', function (t) {
  if (!NAVEGADOR) { t.skip('sem Chrome nem Edge nesta maquina'); return; }
  const p = repoComPagina(t);
  fs.writeFileSync(path.join(p.dir, 'modelo.html'), '<p>topo</p>\n', 'utf8');
  fs.mkdirSync(path.join(p.dir, '.claude', 'sworn'), { recursive: true });
  // O .html e "tela" ou "codigo" conforme o estilo do projeto: a referencia vale para os dois.
  fs.writeFileSync(path.join(p.dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify({ versaoConfig: 1,
    referencias: { tela: ['modelo.html'], codigo: ['modelo.html'] } }), 'utf8');
  const r = preparar(p.dir, ['--tela-antes', p.antes, '--tela-depois', p.depois]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const saida = JSON.parse(r.stdout);
  assert.ok(saida.invertida, 'o pacote tem a 2a passada');
  const ronda = path.dirname(saida.a);
  for (const [daqui, dela] of [['A', 'B'], ['B', 'A']]) {
    assert.ok(fs.readFileSync(path.join(ronda, daqui + '.png')).equals(fs.readFileSync(path.join(ronda, 'invertida', dela + '.png'))),
      daqui + '.png e a invertida/' + dela + '.png');
    const aqui = JSON.parse(fs.readFileSync(path.join(ronda, daqui + '.evidencia.json'), 'utf8'));
    const la = JSON.parse(fs.readFileSync(path.join(ronda, 'invertida', dela + '.evidencia.json'), 'utf8'));
    assert.strictEqual(la.imagem, dela + '.png');
    assert.strictEqual(la.sha256, aqui.sha256);
  }
});

test('ponta a ponta: so com --tela-depois, o lado do trabalho tem foto e o aviso diz que ela nao e cega', function (t) {
  if (!NAVEGADOR) { t.skip('sem Chrome nem Edge nesta maquina'); return; }
  const p = repoComPagina(t);
  // Com o trabalho em A: a foto segue o lado, nao a letra.
  const r = preparar(p.dir, ['--tela-depois', p.depois], undefined, 'outra');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const saida = JSON.parse(r.stdout);
  const mapa = JSON.parse(fs.readFileSync(path.join(path.dirname(saida.a), 'mapa.json'), 'utf8'));
  assert.strictEqual(mapa.mapa.A, 'trabalho', 'a semente "outra" poe o trabalho em A');
  assert.ok(fs.existsSync(saida.fotos.A.imagem));
  assert.strictEqual(saida.fotos.B, null);
  assert.ok(!fs.existsSync(path.join(path.dirname(saida.a), 'B.png')));
  assert.strictEqual(mapa.telas.HEAD, null);
  assert.match(saida.aviso, /So o lado A tem foto .*a foto nao e cega nesta ronda/);
});

test('ponta a ponta: o --tela-antes que nao abre para tudo, mesmo com o --tela-depois bom', function (t) {
  if (!NAVEGADOR) { t.skip('sem Chrome nem Edge nesta maquina'); return; }
  const p = repoComPagina(t);
  const tmp = path.join(p.dir, 'tmp-do-teste');
  fs.mkdirSync(tmp);
  const sumido = pathToFileURL(path.join(p.dir, 'nao-existe', 'pagina.html')).href;
  const r = preparar(p.dir, ['--tela-antes', sumido, '--tela-depois', p.depois],
    Object.assign({}, process.env, { SWORN_TMP: tmp }));
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^ERRO: a captura de file:\/\/\/.*nao-existe\/pagina\.html falhou: .*Nada foi gravado\.\n$/);
  assert.ok(!fs.existsSync(revisaoDe(p.dir)), 'nenhuma ronda gravada');
  assert.deepStrictEqual(fs.readdirSync(tmp), [], 'a pasta de trabalho das fotos saiu da temporaria');
});
