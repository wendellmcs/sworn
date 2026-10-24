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
  assert.ok(/Nunca rodou fora de win32/.test(t),
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
  // Ronda 1 do 8c.5: a mensagem dizia o problema e nao o que fazer.
  assert.ok(/scripts\/lib\/plataforma\.js/.test(r.stderr) && /ORFA num ponto de PONTOS/.test(r.stderr) &&
    /MORTO da lista/.test(r.stderr) && /rode este comando de novo/.test(r.stderr),
    'a saida tem de dizer onde e como se conserta: ' + r.stderr);
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
