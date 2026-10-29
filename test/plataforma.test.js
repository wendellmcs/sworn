'use strict';
// H6 - "comportamento em Windows, Linux e macOS". Nao ha maquina Linux nem macOS
// aqui, e nao ha CI. Este arquivo NAO finge o contrario: ele exercita de verdade
// o que entra por parametro, e DECLARA o que so se prova no sistema de verdade.
//
// O que ele impede, que e o valor real: ponto cego NOVO entrando em silencio.
// A matriz e conferida contra o disco a cada rodada, nas duas direcoes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const plataforma = require('../scripts/lib/plataforma.js');
const glob = require('../scripts/lib/glob.js');
const shell = require('../scripts/lib/shell.js');
const estado = require('../scripts/lib/estado.js');

const RAIZ = path.join(__dirname, '..');

function pasta() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sworn plataforma-')); }

function semear(dir, rel, conteudo) {
  const alvo = path.join(dir, rel);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, conteudo, 'utf8');
}

// ── a matriz cobre o disco, nas duas direcoes ────────────────────────────

test('plataforma: a matriz cobre TODA ocorrencia do disco - nenhuma orfa', () => {
  const m = plataforma.matriz(RAIZ);
  const lista = m.orfas.map((o) => o.marcador + '  ' + o.arquivo + ':' + o.linha);
  assert.strictEqual(m.orfas.length, 0,
    'ponto cego de plataforma sem linha na matriz. Acrescente o arquivo em PONTOS, ' +
    'no ponto de mesma chave:\n  ' + lista.join('\n  '));
  // Com zero orfa, cada ocorrencia e de um ponto so: a soma por ponto e o total.
  // Sem isto, a linha "N ocorrencia(s)" do relatorio podia contar qualquer coisa.
  const soma = m.pontos.reduce((n, p) => n + p.ocorrencias, 0);
  assert.strictEqual(soma, m.resumo.ocorrencias,
    'a conta de ocorrencias por ponto nao fecha com o total: ' + soma + ' de ' + m.resumo.ocorrencias);
});

test('plataforma: nenhum ponto declarado ficou morto', () => {
  const m = plataforma.matriz(RAIZ);
  const lista = m.mortos.map((o) => o.marcador + '  ' + o.arquivo);
  assert.strictEqual(m.mortos.length, 0,
    'a matriz declara cobertura de coisa que nao existe mais - tire a linha:\n  ' + lista.join('\n  '));
  // Controle negativo do morto. Sem ele, "zero mortos" acima seria indistinguivel
  // de uma conta que nunca registra morto. Numa pasta sem nenhum script, todo
  // arquivo declarado sai morto - e o morto sozinho, sem orfa, reprova a matriz.
  const vazia = plataforma.matriz(pasta());
  const declarados = plataforma.PONTOS.reduce((n, p) => n + p.arquivos.length, 0);
  assert.strictEqual(vazia.orfas.length, 0);
  assert.strictEqual(vazia.mortos.length, declarados,
    'numa pasta vazia, todo arquivo declarado tinha de sair morto');
  assert.strictEqual(vazia.integra, false, 'morto sem orfa tem de reprovar a matriz');
});

/**
 * Controle negativo do varredor. Sem isto, "zero orfas" seria indistinguivel de
 * um varredor que nao le nada - que e exatamente a saida que ninguem confere.
 */
test('plataforma: o varredor ACHA ponto novo que ninguem declarou', () => {
  const dir = pasta();
  semear(dir, path.join('scripts', 'lib', 'novo.js'),
    'const x = process.platform === "linux";\n');
  // A chave conta, nao so o arquivo: glob.js ja esta declarado em outros pontos,
  // e um marcador NOVO nele tem de sair orfa do mesmo jeito.
  semear(dir, path.join('scripts', 'lib', 'glob.js'), 'const fim = os.EOL;\n');
  const m = plataforma.matriz(dir);
  const orfa = m.orfas.filter((o) => o.arquivo === 'scripts/lib/novo.js')[0];
  assert.ok(orfa, 'o varredor nao viu o arquivo novo: a matriz inteira e teatro');
  assert.strictEqual(orfa.marcador, 'process_platform');
  assert.strictEqual(orfa.linha, 1, 'achado sem linha certa nao serve para conferir');
  assert.strictEqual(m.integra, false);
  const outraChave = m.orfas.filter((o) => o.arquivo === 'scripts/lib/glob.js')[0];
  assert.ok(outraChave, 'marcador novo em arquivo declarado sob outra chave passou calado');
  assert.strictEqual(outraChave.marcador, 'fim_de_linha');

  // Marcador sem ocorrencia no disco e arame esticado, e nenhum outro teste o puxa.
  const arame = pasta();
  const amostras = [['pasta_pessoal', 'os.homedir()'], ['caminho_especifico', 'path.win32'],
    ['caminho_especifico', 'path.posix'], ['caminho_especifico', 'path.delimiter']];
  semear(arame, path.join('scripts', 'arame.js'), amostras.map((a) => a[1]).join('\n') + '\n');
  const achados = plataforma.varrer(arame);
  amostras.forEach((a, i) => {
    const achou = achados.filter((x) => x.linha === i + 1)[0];
    assert.ok(achou && achou.marcador === a[0], 'o arame de ' + a[0] + ' nao pega ' + a[1]);
  });
});

test('plataforma: o varredor entra em subpasta e ignora o que nao e .js', () => {
  const dir = pasta();
  semear(dir, path.join('scripts', 'fundo', 'mais', 'a.js'), 'os.EOL\n');
  semear(dir, path.join('scripts', 'leia.md'), 'os.EOL\n');
  const achados = plataforma.varrer(dir);
  assert.strictEqual(achados.length, 1, 'esperava so o .js: ' + JSON.stringify(achados));
  assert.strictEqual(achados[0].arquivo, 'scripts/fundo/mais/a.js',
    'caminho tem de sair com barra normal, em qualquer sistema');
});

// ── o que de fato se exercita daqui: os injetaveis ───────────────────────

/**
 * Nao e simulacao. `conferir` recebe a plataforma por parametro e roda o mesmo
 * caminho que rodaria la - e e por isso que a trava 5 esta marcada como
 * exercitada nos tres sistemas.
 */
test('plataforma/injetavel: a tabela de shell roda nos dois lados daqui', () => {
  const comando = 'rm -rf /tmp/build';
  const comoWindows = shell.conferir(comando, { so: 'win32', shell: 'powershell' });
  const comoLinux = shell.conferir(comando, { so: 'linux', shell: 'bash' });
  assert.ok(comoWindows.length > 0, 'no Windows este comando tem de ser acusado');
  assert.strictEqual(comoLinux.length, 0, 'fora do Windows a tabela nem carrega');
});

test('plataforma/injetavel: caixa de letra - os dois comportamentos, daqui', () => {
  assert.strictEqual(glob.casa('src/*.js', 'SRC/A.JS', true), true,
    'com caixa ignorada, que e o padrao do Windows, tinha de casar');
  assert.strictEqual(glob.casa('src/*.js', 'SRC/A.JS', false), false,
    'com caixa respeitada, que e o padrao do Linux, nao pode casar');
});

test('plataforma/injetavel: barra invertida vira barra normal, em qualquer sistema', () => {
  assert.strictEqual(glob.normalizar('a\\b\\c.js'), 'a/b/c.js');
  assert.strictEqual(glob.casa('a/**/c.js', 'a\\b\\c.js'), true);
});

test('plataforma/injetavel: SWORN_TMP manda em onde o estado e gravado', () => {
  const dir = pasta();
  const antes = process.env.SWORN_TMP;
  process.env.SWORN_TMP = dir;
  try {
    const alvo = estado.caminhoSessao('s1');
    assert.strictEqual(path.dirname(alvo), path.join(dir, 'sworn'),
      'sem esta porta, a suite escreveria na pasta temporaria de verdade do sistema');
  } finally {
    if (antes === undefined) delete process.env.SWORN_TMP;
    else process.env.SWORN_TMP = antes;
  }
});

// ── a declaracao, que e a entrega do H6 ──────────────────────────────────

/**
 * A matriz recebe o sistema por parametro DE PROPOSITO: sem isso ela so seria
 * testavel no Windows - o defeito exato que ela existe para denunciar nos outros.
 */
test('plataforma: a matriz vira quando o sistema vira - nao esta cravada em win32', () => {
  const noWindows = plataforma.matriz(RAIZ, 'win32');
  const noLinux = plataforma.matriz(RAIZ, 'linux');

  const pw = noWindows.pontos.filter((p) => p.classe === plataforma.SO_NO_SISTEMA)[0];
  const pl = noLinux.pontos.filter((p) => p.chave === pw.chave)[0];

  assert.strictEqual(pw.porSistema.win32, 'exercitado neste sistema');
  assert.strictEqual(pw.porSistema.linux, 'NAO TESTADO');
  assert.strictEqual(pl.porSistema.linux, 'exercitado neste sistema');
  assert.strictEqual(pl.porSistema.win32, 'NAO TESTADO');
});

test('plataforma: o injetavel NAO vira com o sistema - e esse o ponto dele', () => {
  const inj = plataforma.matriz(RAIZ, 'darwin').pontos
    .filter((p) => p.classe === plataforma.INJETAVEL);
  assert.ok(inj.length >= 3, 'esperava ao menos 3 pontos injetaveis');
  inj.forEach((p) => {
    plataforma.SISTEMAS.forEach((s) => {
      assert.strictEqual(p.porSistema[s], 'exercitado por injecao',
        p.chave + ' deveria valer nos tres: ' + s + ' deu ' + p.porSistema[s]);
    });
  });
});

test('plataforma: rodando aqui, Linux e macOS saem declarados NAO TESTADO', () => {
  const m = plataforma.matriz(RAIZ, 'win32');
  const fora = m.resumo.naoTestados.map((n) => n.sistema).sort();
  assert.deepStrictEqual(fora, ['darwin', 'linux'],
    'o H6 se fecha DECLARANDO o que nao foi testado; lista vazia aqui seria mentira');
  m.resumo.naoTestados.forEach((n) => {
    assert.ok(n.pontos > 0 && n.pontos < m.resumo.pontos,
      'nem tudo e testado nem tudo e cego: ' + n.sistema + ' deu ' + n.pontos);
  });
  // Quais pontos so se provam no sistema e declaracao escrita, nao contagem:
  // reclassificar um deles apaga um NAO TESTADO, e "0 < n < total" nao ve.
  const cegos = m.pontos.filter((p) => p.classe === plataforma.SO_NO_SISTEMA)
    .map((p) => p.chave).sort();
  assert.deepStrictEqual(cegos, ['caminho_especifico', 'process_platform', 'processo_externo'],
    'mudar a classe de um ponto muda a declaracao do H6: mude aqui tambem, de proposito');
});

test('plataforma: nenhum ponto entra sem dizer COMO se prova', () => {
  plataforma.PONTOS.forEach((p) => {
    assert.ok(p.comoSeProva && p.comoSeProva.length > 20,
      p.chave + ': ponto sem forma de prova e cobertura declarada no ar');
    assert.ok(p.classe === plataforma.INJETAVEL || p.classe === plataforma.SO_NO_SISTEMA,
      p.chave + ': classe desconhecida ' + p.classe);
    assert.ok(Array.isArray(p.arquivos) && p.arquivos.length > 0, p.chave + ': ponto sem arquivo');
  });
  assert.strictEqual(new Set(plataforma.PONTOS.map((p) => p.chave)).size,
    plataforma.PONTOS.length, 'chave de ponto repetida');
});

test('plataforma: todo ponto declarado corresponde a um marcador que existe', () => {
  const chaves = new Set(plataforma.MARCADORES.map((m) => m.chave));
  plataforma.PONTOS.forEach((p) => {
    assert.ok(chaves.has(p.chave), p.chave + ': ponto sem marcador que o ache');
  });
});

test('plataforma: o texto declara o sistema da rodada e o que nao foi testado', () => {
  const m = plataforma.matriz(RAIZ, 'win32');
  const t = plataforma.texto(m);
  assert.ok(/esta rodada: win32/.test(t), t.slice(0, 200));
  assert.ok(/NAO TESTADO em linux/.test(t), 'o relatorio tem de dizer o que nao foi testado');
  assert.ok(/NAO TESTADO em darwin/.test(t));
  m.resumo.naoTestados.forEach((n) => {
    const frase = 'NAO TESTADO em ' + n.sistema + ': ' + n.pontos + ' de ' + m.resumo.pontos + ' pontos.';
    assert.notStrictEqual(t.indexOf(frase), -1, 'a conta impressa tem de ser a da matriz: ' + frase);
  });
  assert.ok(/Historico declarado: a suite so rodou em win32\./.test(t),
    'a declaracao de historico e a entrega do H6, e nenhum teste sabe medi-la');
  plataforma.PONTOS.forEach((p) => {
    assert.ok(t.indexOf(p.chave) !== -1, 'ponto fora do relatorio: ' + p.chave);
  });
});

test('plataforma: ponto com ressalva a imprime - ressalva calada nao serve de nada', () => {
  const comRessalva = plataforma.PONTOS.filter((p) => p.ressalva);
  assert.ok(comRessalva.length >= 3, 'esperava ressalva em ao menos 3 pontos');
  const t = plataforma.texto(plataforma.matriz(RAIZ, 'win32'));
  comRessalva.forEach((p) => {
    assert.ok(t.indexOf(p.ressalva.slice(0, 40)) !== -1, 'ressalva nao saiu no texto: ' + p.chave);
  });
});

// ── o ponto de entrada, exercido como processo ──────────────────────────

/**
 * A familia A do plano v1 - "a fiacao nao tem prova" - tinha sete achados
 * dizendo a mesma coisa: desfazer a ligacao entre o script e a lib deixava a
 * suite identica. Por isso o script roda aqui como processo de verdade.
 */
test('plataforma: o comando imprime a matriz e sai 0 quando ela cobre o disco', () => {
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'plataforma.js')],
    { cwd: RAIZ, encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(/Matriz de plataforma/.test(r.stdout), r.stdout.slice(0, 200));
  assert.ok(/NAO TESTADO em linux/.test(r.stdout), r.stdout);
  assert.ok(/nenhuma orfa, nenhum morto/.test(r.stdout), r.stdout);
});

test('plataforma: o comando sai 1 quando a matriz NAO cobre mais o disco', () => {
  const dir = pasta();
  semear(dir, path.join('scripts', 'lib', 'novo.js'), 'const x = process.platform;\n');
  const r = spawnSync(process.execPath,
    [path.join(RAIZ, 'scripts', 'plataforma.js'), '--raiz', dir],
    { encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(r.status, 1, 'declaracao que se contradiz nao pode sair com 0');
  assert.ok(/NAO cobre o disco/.test(r.stderr), r.stderr);
  // Ronda 1 do 8c.5: a mensagem dizia o problema e nao o que fazer. A1-12 (pedido 12, microcopy): ORFA e MORTO
  // saiam sem explicacao, e o passo ("declare cada ORFA num ponto de PONTOS") pedia o modelo interno.
  assert.ok(/scripts\/lib\/plataforma\.js/.test(r.stderr) &&
    /ponha o arquivo de cada ORFA nos\s+arquivos do ponto do tipo dela/.test(r.stderr) &&
    /tire cada MORTO dos arquivos do ponto dele/.test(r.stderr) && /rode este comando de novo/.test(r.stderr),
    'a saida tem de dizer onde e como se conserta: ' + r.stderr);
  assert.ok(/ORFA: trecho que depende do sistema num arquivo que o ponto do mesmo tipo nao lista\./.test(r.stderr) &&
    /MORTO: arquivo que um ponto lista e que ja nao tem trecho do tipo desse ponto\./.test(r.stderr) &&
    /o tipo e a primeira coluna nas listas ORFAS e MORTOS/.test(r.stderr) &&
    r.stderr.indexOf('ORFA:') < r.stderr.indexOf('Para consertar'),
    'ORFA e MORTO tem de vir explicados antes do passo: ' + r.stderr);
  // A pasta tem uma orfa e nenhum dos arquivos declarados: o relatorio tem de
  // nomear as duas coisas, e nao pode se dizer integro.
  assert.strictEqual(r.stdout.indexOf('nenhuma orfa, nenhum morto'), -1,
    'relatorio que nao cobre o disco se disse integro: ' + r.stdout);
  assert.notStrictEqual(r.stdout.indexOf('    process_platform  scripts/lib/novo.js:1'), -1,
    'a orfa tem de sair com marcador, arquivo e linha: ' + r.stdout);
  const p0 = plataforma.PONTOS[0];
  assert.notStrictEqual(r.stdout.indexOf('    ' + p0.chave + '  ' + p0.arquivos[0]), -1,
    'o morto tem de sair com marcador e arquivo: ' + r.stdout);
});

test('plataforma: --como deixa ver a matriz do sistema que ninguem tem aqui', () => {
  const r = spawnSync(process.execPath,
    [path.join(RAIZ, 'scripts', 'plataforma.js'), '--como', 'linux'],
    { cwd: RAIZ, encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(/esta rodada: linux/.test(r.stdout), r.stdout.slice(0, 200));
  assert.ok(/NAO TESTADO em win32/.test(r.stdout),
    'visto do Linux, e o Windows que fica declarado como nao testado');
});

// A1-plat-1 (pedido 12, borda): flag sem valor caia calada no padrao - `--raiz --como linux` media a pasta
// "--como" - e `--como` fora de SISTEMAS saia sem aviso. Agora e erro de uso, saida 2, sem matriz.
test('A1-plat-1: flag sem valor ou --como fora de SISTEMAS e erro de uso, nunca o padrao calado', () => {
  const casos = [
    [['--raiz'], /--raiz pede um valor/],
    [['--raiz', '--como', 'linux'], /--raiz pede um valor/],
    [['--como', ''], /--como pede um valor/],
    [['--como', '--raiz', RAIZ], /--como pede um valor/],
    [['--como', 'solaris'], /--como aceita win32, linux, darwin; veio "solaris"/]
  ];
  casos.forEach(([args, re]) => {
    const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'plataforma.js')].concat(args),
      { cwd: RAIZ, encoding: 'utf8', timeout: 60000 });
    assert.strictEqual(r.status, 2, args.join(' ') + ': ' + r.stdout + r.stderr);
    assert.ok(re.test(r.stderr) && /uso: plataforma\.js/.test(r.stderr), args.join(' ') + ': ' + r.stderr);
    assert.strictEqual(r.stdout.indexOf('Matriz de plataforma'), -1, 'erro de uso nao imprime matriz: ' + r.stdout);
  });
});

// A1-plat-2 (pedido 12, estados): pasta ou arquivo que nao se le era engolido - raiz que nao existe virava matriz
// de mortos, e o comando mandava editar PONTOS. Agora entra em naoLidos, com a causa, e o comando diz a causa.
test('A1-plat-2: o que a varredura nao le entra em naoLidos com a causa, e a matriz nao se diz integra', () => {
  const vazia = plataforma.matriz(path.join(pasta(), 'nao-existe'));
  assert.deepStrictEqual(vazia.naoLidos, [{ arquivo: 'scripts', causa: 'nao existe (ENOENT)' }]);
  assert.strictEqual(vazia.integra, false);
  const t = plataforma.texto(vazia);
  assert.notStrictEqual(
    t.indexOf('NAO LIDOS - o que a varredura nao conseguiu ler (1):\n    scripts  nao existe (ENOENT)'), -1, t);

  const dir = pasta();
  semear(dir, path.join('scripts', 'a.js'), 'os.EOL\n');
  semear(dir, path.join('scripts', 'b.js'), 'os.EOL\n');
  semear(dir, path.join('scripts', 'sub', 'c.js'), 'os.EOL\n');
  const negado = (nome) => Object.assign(new Error('EACCES: negado ' + nome), { code: 'EACCES' });
  const ler = fs.readFileSync;
  const listar = fs.readdirSync;
  fs.readFileSync = function (p) {
    const nome = path.basename(String(p));
    if (nome === 'b.js' || path.resolve(String(p)) === path.join(RAIZ, 'scripts', 'atalhos.js')) throw negado(nome);
    return ler.apply(this, arguments);
  };
  fs.readdirSync = function (p) {
    if (path.basename(String(p)) === 'sub') throw negado('sub');
    return listar.apply(this, arguments);
  };
  let m;
  let soNaoLido;
  try {
    m = plataforma.matriz(dir);
    // atalhos.js nao esta em PONTOS: sem ler ele nao sai orfa nem morto, e so o nao lido tem de reprovar.
    soNaoLido = plataforma.matriz(RAIZ);
  } finally { fs.readFileSync = ler; fs.readdirSync = listar; }
  const porArquivo = (x, y) => (x.arquivo < y.arquivo ? -1 : 1);
  assert.deepStrictEqual(m.naoLidos.slice().sort(porArquivo), [
    { arquivo: 'scripts/b.js', causa: 'sem permissao (EACCES)' },
    { arquivo: 'scripts/sub', causa: 'sem permissao (EACCES)' }
  ], 'pasta de dentro tambem conta: ' + JSON.stringify(m.naoLidos));
  assert.deepStrictEqual(m.orfas.map((o) => o.arquivo), ['scripts/a.js'], 'o que se leu segue varrido');
  assert.deepStrictEqual(soNaoLido.naoLidos, [{ arquivo: 'scripts/atalhos.js', causa: 'sem permissao (EACCES)' }]);
  assert.strictEqual(soNaoLido.orfas.length + soNaoLido.mortos.length, 0, JSON.stringify(soNaoLido.mortos));
  assert.strictEqual(soNaoLido.integra, false, 'o nao lido sozinho tem de reprovar a matriz');
  assert.strictEqual(plataforma.matriz(RAIZ, 'linux').sistemaReal, process.platform, 'o real e o do Node');

  const r = spawnSync(process.execPath,
    [path.join(RAIZ, 'scripts', 'plataforma.js'), '--raiz', path.join(dir, 'nao-existe')],
    { encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(r.status, 2, 'sem leitura nao ha veredito: ' + r.stdout + r.stderr);
  assert.ok(/NAO LEU 1 caminho/.test(r.stderr) && /nao-existe/.test(r.stderr), r.stderr);
  assert.strictEqual(r.stderr.indexOf('PONTOS'), -1, 'o que nao se leu nao se conserta editando PONTOS: ' + r.stderr);
});

// A1-plat-3 (pedido 12, manutencao): "Nunca rodou fora de win32" saia fixo ao lado de "esta rodada: linux". O
// historico e declaracao (HISTORICO); a rodada fora dele diz se e simulada pelo --como ou de verdade.
test('A1-plat-3: a frase do historico sai de HISTORICO, e a rodada fora dele diz se e simulada ou de verdade', () => {
  assert.deepStrictEqual(plataforma.HISTORICO, ['win32']);
  const simulada = plataforma.matriz(RAIZ, 'linux');
  simulada.sistemaReal = 'win32';
  const t = plataforma.texto(simulada);
  assert.strictEqual(t.indexOf('Nunca rodou fora de'), -1, t.slice(-400));
  assert.ok(/Historico declarado: a suite so rodou em win32\./.test(t), t.slice(-400));
  assert.ok(/Esta rodada so simula linux \(o sistema de verdade e win32\): ela nao conta para o historico\./.test(t),
    t.slice(-400));
  const deVerdade = plataforma.matriz(RAIZ, 'linux');
  deVerdade.sistemaReal = 'linux';
  const tv = plataforma.texto(deVerdade);
  assert.ok(/Esta rodada e em linux de verdade, fora do historico: se a suite passou aqui, acrescente linux em/
    .test(tv) && /em HISTORICO, em scripts\/lib\/plataforma\.js\./.test(tv), tv.slice(-400));
  const dentro = plataforma.matriz(RAIZ, 'win32');
  dentro.sistemaReal = 'win32';
  assert.strictEqual(plataforma.texto(dentro).indexOf('Esta rodada'), -1, 'rodada dentro do historico nao ganha linha');
});

// A1-15 (pedido 12, enxuto): o pad refazia o padEnd. A coluna tem a largura dada, e o texto que a enche ou passa
// dela ganha um espaco, para nao colar na coluna seguinte.
test('A1-15: a tabela alinha as colunas, e o texto mais largo que a coluna nao cola na seguinte', () => {
  const m = plataforma.matriz(RAIZ, 'win32');
  assert.strictEqual(plataforma.texto(m).split('\n')[2], 'ponto' + ' '.repeat(19) + 'classe' + ' '.repeat(10) +
    'win32' + ' '.repeat(21) + 'linux' + ' '.repeat(21) + 'darwin');
  const largo = Object.assign({}, m.pontos[0], { chave: 'x'.repeat(24), classe: 'y'.repeat(30) });
  const linha = plataforma.texto(Object.assign({}, m, { pontos: [largo] })).split('\n')[3];
  assert.ok(linha.startsWith('x'.repeat(24) + ' ' + 'y'.repeat(30) + ' ' + largo.porSistema.win32 + '  '), linha);
});

// A1-16 (pedido 12, manutencao): o comoSeProva da pasta_pessoal virou historico de seis modulos, com pedidos e
// versoes. A prova diz o metodo (a porta por onde o teste entra); quem entrou quando fica no git.
test('A1-16: comoSeProva diz o metodo, sem historico de pedido ou versao', () => {
  plataforma.PONTOS.forEach((p) => {
    assert.ok(!/\bpedido\b|\d+\.\d+\.\d+|\bBloco [A-Z]\b/.test(p.comoSeProva), p.chave + ': ' + p.comoSeProva);
  });
  const casa = plataforma.PONTOS.filter((p) => p.chave === 'pasta_pessoal')[0].comoSeProva;
  ['por parametro', 'CLAUDE_CONFIG_DIR', 'SWORN_VIGIA', 'HOME e USERPROFILE'].forEach((porta) => {
    assert.notStrictEqual(casa.indexOf(porta), -1, 'a porta ' + porta + ' sumiu da prova: ' + casa);
  });
});

// A1-18 e A1-22 (pedido 12, microcopy e manutencao): a frase do historico dizia "declaracao, nao medicao" e nao o
// que fazer. Agora diz que a lista e escrita a mao e o passo para acrescentar um sistema, uma vez so: a rodada de
// verdade fora do historico ja traz o passo dela, com o nome do sistema.
test('A1-18: o historico diz o passo para acrescentar um sistema, sem jargao e sem repetir', () => {
  const dentro = plataforma.matriz(RAIZ, 'win32');
  dentro.sistemaReal = 'win32';
  const t = plataforma.texto(dentro);
  assert.strictEqual(t.indexOf('nao medicao'), -1, t.slice(-400));
  assert.ok(/a suite so rodou em win32\. A lista e escrita a mao: nenhum teste sabe onde a suite ja rodou\./.test(t),
    t.slice(-400));
  assert.ok(/Para acrescentar um sistema: rode a suite nele \(node --test test\/\*\.test\.js\) e, se ela passar, /
    .test(t) && /acrescente o sistema em HISTORICO, em scripts\/lib\/plataforma\.js\./.test(t), t.slice(-400));
  const deVerdade = plataforma.matriz(RAIZ, 'linux');
  deVerdade.sistemaReal = 'linux';
  const tv = plataforma.texto(deVerdade);
  assert.strictEqual(tv.split('em HISTORICO').length - 1, 1, 'o passo saiu duas vezes: ' + tv.slice(-400));
  assert.strictEqual(tv.indexOf('so simula'), -1, 'a rodada de verdade se disse simulada: ' + tv.slice(-400));
  const simulada = plataforma.matriz(RAIZ, 'linux');
  simulada.sistemaReal = 'win32';
  assert.ok(/Para acrescentar um sistema/.test(plataforma.texto(simulada)), 'a rodada simulada tambem ganha o passo');
});

// A1-19 (pedido 12, microcopy): "NAO TESTADO" saia ao lado de "exercitado por injecao" sem legenda.
test('A1-19: a tabela traz a legenda dos tres estados, logo abaixo dela', () => {
  const m = plataforma.matriz(RAIZ, 'win32');
  const t = plataforma.texto(m).split('\n');
  const i = 3 + plataforma.PONTOS.length;
  assert.deepStrictEqual(t.slice(i, i + 5), ['', 'Legenda:',
    '    "exercitado por injecao" = o teste escolhe o sistema e roda daqui o caminho de cada um dos tres.',
    '    "exercitado neste sistema" = a suite o exercita quando roda neste sistema.',
    '    "NAO TESTADO" = so se prova rodando a suite naquele sistema.']);
  // A legenda cita os estados por extenso: se a matriz trocar a grafia de um, a legenda fica falando de outra coisa.
  const estados = new Set();
  m.pontos.forEach((p) => plataforma.SISTEMAS.forEach((s) => estados.add(p.porSistema[s])));
  assert.strictEqual(estados.size, 3, [...estados].join(' | '));
  estados.forEach((e) => {
    assert.ok(t.slice(i + 2, i + 5).some((l) => l.startsWith('    "' + e + '" = ')), 'estado sem legenda: ' + e);
  });
});
