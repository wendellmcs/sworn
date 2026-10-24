'use strict';
// RODADA X - X1 (P0) e X2 (P1). Os 20 testes da secao 7 da PROPOSTA v4.1.
//
// Cada teste declara o que E, porque teste que passa igual com e sem a peca nao
// prova a peca - MAS controle e regressao passam igual DE PROPOSITO:
//   MATA PECA - reverter a peca faz o teste falhar. Provado por mutacao.  (10)
//   CONTROLE  - passa igual antes e depois: prova que a rodada NAO mudou o que
//               nao devia mudar. Nao morre por mutacao, e isso nao e defeito. (6)
//   REGRESSAO - passa igual hoje, mas morre sob mutacao de bug plausivel.   (4)
//
// A classificacao aqui e MEDIDA, nao herdada: a secao 7 da v4.1 dava RX-9,
// RX-13 e RX-14 como MATA PECA, e os tres PASSAM contra a arvore do HEAD
// caf790e - logo sao REGRESSAO. Bancada: contra-head.cjs e muta.cjs.
//
// As fixtures aqui sao PROPRIAS: nomes de pasta (cofre/, app/, notas/,
// pagamento/) que nao aparecem em nenhum outro arquivo de teste, para que um
// teste verde nao possa estar reaproveitando o corpus de outra suite.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const projetoLib = require('../scripts/lib/projeto.js');

const RAIZ = path.join(__dirname, '..');

const BASE = {
  versaoConfig: 1,
  geradoEm: '2026-08-14',
  plataforma: { so: 'win32', shell: 'powershell' },
  modeloDeAmeaca: 'interno',
  provaDePronto: 'npm test',
  quemDecide: 'Ana',
  fontesCanonicas: ['CLAUDE.md'],
  intocaveis: ['cofre/**'],
  marchaPadrao: 'padrao',
  marchas: { aaa: ['**/pagamento/**'], padrao: ['app/**'], rapida: ['notas/**'] },
  comandosBloqueados: [],
  comandosLiberados: [],
  travas: { fecho: true, escopo: true, destrutivo: true, outraFrente: true },
  limiares: {},
  agentes: { escada: [] }
};

const TRAVAS_LIGADAS = { fecho: true, escopo: true, destrutivo: true, outraFrente: true };

function comBancada(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-rx-tmp-'));
  const criados = [tmp];
  const novoDir = function () {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-rx-proj-'));
    criados.push(d);
    return d;
  };
  try {
    fn(novoDir, tmp);
  } finally {
    for (const d of criados) fs.rmSync(d, { recursive: true, force: true });
  }
}

function comBase(mudancas) {
  return Object.assign(JSON.parse(JSON.stringify(BASE)), mudancas || {});
}

function gravarCru(dir, obj) {
  fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify(obj), 'utf8');
  return dir;
}

function gravarProjeto(dir, mudancas) {
  return gravarCru(dir, comBase(mudancas));
}

function rodarPortao(script, entrada, tmp) {
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', script)], {
    input: JSON.stringify(entrada),
    encoding: 'utf8',
    env: Object.assign({}, process.env, { SWORN_TMP: tmp })
  });
  let json = null;
  if (r.stdout && r.stdout.trim()) { try { json = JSON.parse(r.stdout); } catch (e) { json = null; } }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json: json };
}

function bash(dir, tmp, comando, sessao) {
  return rodarPortao('portao-destrutivo.js', {
    session_id: sessao || 'rx', cwd: dir, tool_name: 'Bash', tool_input: { command: comando }
  }, tmp);
}

function escrita(dir, tmp, rel, sessao) {
  return rodarPortao('portao-escopo.js', {
    session_id: sessao || 'rx', cwd: dir, tool_name: 'Write',
    tool_input: { file_path: path.join(dir, rel), content: 'x' }
  }, tmp);
}

function negou(r) {
  return !!(r.json && r.json.hookSpecificOutput && r.json.hookSpecificOutput.permissionDecision === 'deny');
}

function motivo(r) {
  return r.json.hookSpecificOutput.permissionDecisionReason;
}

/**
 * NEGAR e DECISAO. Um portao que estourou nao nega - io.blindar (io.js:69)
 * engole a excecao e sai exit 0 MUDO, isto e, PERMITE. O stderr e o que separa
 * decisao de queda, e por isso ele e conferido aqui, nao so o exit code.
 */
function negouPorDecisao(r, onde) {
  assert.ok(!/portao falhou/.test(r.stderr || ''),
    onde + ': o portao caiu (io.blindar), nao decidiu: ' + r.stderr);
  assert.strictEqual(negou(r), true,
    onde + ': devia NEGAR. stdout=' + r.stdout + ' stderr=' + r.stderr);
}

/** D37/F7: permitir por DECISAO, nunca por inercia. Mesma prova, do outro lado. */
function permitiuPorDecisao(r, onde) {
  assert.strictEqual(r.status, 0, onde + ': o portao tem de sair 0 (R6). stderr: ' + r.stderr);
  assert.ok(!/portao falhou/.test(r.stderr || ''),
    onde + ': permitiu por QUEDA, nao por decisao: ' + r.stderr);
  assert.strictEqual(negou(r), false, onde + ': devia PERMITIR. stdout=' + r.stdout);
}

function repoGit(dir) {
  const g = function (args) { return spawnSync('git', args, { cwd: dir, encoding: 'utf8', shell: false }); };
  g(['init', '-q']);
  g(['config', 'user.email', 'teste@exemplo.com']);
  g(['config', 'user.name', 'teste']);
  return g;
}

/**
 * Monta um projeto git em que `notas/guia.md` JA estava modificado quando a
 * sessao abriu - o unico jeito de exercitar a trava 5b de verdade.
 * `notas/**` e marcha RAPIDA nesta fixture, entao o passo 4 devolve permitir
 * antes do passo 5: a 5b e a UNICA barreira neste caminho, e a decisao do
 * portao vira prova direta da trava `outraFrente`.
 */
function projetoComOutraFrente(novoDir, tmp, travas, sessao) {
  const dir = novoDir();
  const g = repoGit(dir);
  gravarCru(dir, comBase({ travas: travas }));
  fs.mkdirSync(path.join(dir, 'notas'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'notas', 'guia.md'), 'um', 'utf8');
  g(['add', '-A']);
  g(['commit', '-q', '-m', 'inicial']);
  // outra frente mexeu ANTES desta sessao abrir
  fs.writeFileSync(path.join(dir, 'notas', 'guia.md'), 'outra frente', 'utf8');
  const abertura = rodarPortao('abertura.js', { session_id: sessao, cwd: dir, source: 'startup' }, tmp);
  assert.strictEqual(abertura.status, 0, 'a abertura tem de rodar');
  const foto = JSON.parse(fs.readFileSync(path.join(tmp, 'sworn', sessao + '.json'), 'utf8')).gitAbertura;
  assert.ok(foto.indexOf('notas/guia.md') !== -1,
    'sem o alvo na foto o cenario nao discrimina nada: ' + JSON.stringify(foto));
  return dir;
}

// ---------------------------------------------------------------------------
// X1 - sitio 1: portao-destrutivo.js, o lado LIBERADO
// ---------------------------------------------------------------------------

test('RX-1 MATA PECA: comandosLiberados TEXTO nao libera mais nada (X1 sitio 1)', () => {
  comBancada((novoDir, tmp) => {
    // HOJE: `for..of` sobre "git" itera letra a letra, e new RegExp('g','i')
    // casa QUALQUER comando com a letra g - o portao inteiro desliga calado.
    const dir = gravarProjeto(novoDir(), { comandosLiberados: 'git' });
    const r = bash(dir, tmp, 'git push --force origin main', 'rx1');
    negouPorDecisao(r, 'RX-1');
    assert.ok(motivo(r).includes('git push --force origin main'),
      'o motivo tem de nomear o comando: ' + motivo(r));
  });
});

test('RX-2 MATA PECA: comandosLiberados OBJETO decide, nao derruba o portao (X1 sitio 1)', () => {
  comBancada((novoDir, tmp) => {
    // HOJE: `for..of` sobre {} lanca TypeError, io.blindar engole, exit 0 MUDO
    // - e portao que estoura PERMITE. A asserçao de stderr e o que separa
    // "negou" de "caiu", e esta dentro do negouPorDecisao.
    const dir = gravarProjeto(novoDir(), { comandosLiberados: { git: true } });
    const r = bash(dir, tmp, 'rm -rf build', 'rx2');
    negouPorDecisao(r, 'RX-2');
    assert.strictEqual(r.status, 0, 'R6: nunca pode travar a sessao');
  });
});

// ---------------------------------------------------------------------------
// X1 - sitio 3: lib/marcha.js:21, o antigo NIVEL[padrao]
// ---------------------------------------------------------------------------

test('RX-3 MATA PECA: marchaPadrao herdado de Object.prototype nao desliga o escopo (X1 sitio 3)', () => {
  comBancada((novoDir, tmp) => {
    // `lib/util.txt` nao casa NENHUMA das tres listas de marchas desta fixture,
    // entao a decisao vem so da marchaPadrao - se casasse, o teste passaria por
    // outro caminho que nao o que ele diz cobrir.
    // HOJE: NIVEL["constructor"] herda de Object.prototype e e truthy, entao
    // resolverMarcha devolve "constructor", exigeEscopo faz NaN >= 2 -> false,
    // e o portao PERMITE sem escopo declarado.
    const dir = gravarProjeto(novoDir(), { marchaPadrao: 'constructor' });
    const r = escrita(dir, tmp, 'lib/util.txt', 'rx3');
    negouPorDecisao(r, 'RX-3');
    assert.ok(motivo(r).includes('trava 4') && motivo(r).includes('escopo.md'),
      'quem tem de barrar e o passo 5, por falta de escopo: ' + motivo(r));

    // A OUTRA PONTA, sem a qual a de cima passaria contra um portao que nega
    // tudo: com marchaPadrao legitima e RAPIDA, o mesmo alvo passa.
    const solto = gravarProjeto(novoDir(), { marchaPadrao: 'rapida' });
    permitiuPorDecisao(escrita(solto, tmp, 'lib/util.txt', 'rx3b'), 'RX-3 controle');

    // O LIMITE do sitio 3, medido e fixado aqui para nao virar surpresa: o
    // hasOwnProperty faz ToPropertyKey, entao `["rapida"]` COAGE para a chave
    // "rapida", que E propria de NIVEL - e resolverMarcha devolve o ARRAY, nao
    // a string. A DECISAO e identica a do texto equivalente (e a do HEAD),
    // porque exigeEscopo faz o mesmo ToPropertyKey e o motivo passa por
    // escopo.js:41, que faz String(). O que NAO sobrevive e a afirmacao de que
    // "resolverMarcha so devolve 'aaa'|'padrao'|'rapida'".
    const marchaLib = require('../scripts/lib/marcha.js');
    assert.deepStrictEqual(marchaLib.resolverMarcha('lib/util.txt', { marchaPadrao: ['rapida'] }),
      ['rapida'], 'o continente nao coage mais? entao o limite mudou');
    assert.strictEqual(marchaLib.exigeEscopo(['rapida']), false, 'a decisao tem de ser a do texto');
    assert.strictEqual(marchaLib.exigeEscopo(['aaa']), true);
    // e o que o sitio 3 EXISTE para barrar continua barrado, tambem em continente
    assert.strictEqual(marchaLib.resolverMarcha('lib/util.txt', { marchaPadrao: ['constructor'] }), 'padrao');
  });
});

// ---------------------------------------------------------------------------
// X1 um nivel abaixo - o filtro de ELEMENTO, so no lado liberado (P0-23)
// ---------------------------------------------------------------------------

test('RX-4 MATA PECA: elemento lista dentro de comandosLiberados nao libera (ToString)', () => {
  comBancada((novoDir, tmp) => {
    // HOJE: new RegExp faz ToString, String(['.*']) === '.*', e o escape casa
    // tudo. Array.isArray olha o CONTINENTE; este teste olha o CONTEUDO.
    const dir = gravarProjeto(novoDir(), { comandosLiberados: [['.*']] });
    negouPorDecisao(bash(dir, tmp, 'rm -rf /', 'rx4'), 'RX-4');
  });
});

test('RX-5 MATA PECA: a familia que coage para padrao universal nao libera', () => {
  comBancada((novoDir, tmp) => {
    // String([]) === "" (regex universal); String({}) === "[object Object]",
    // que e uma CLASSE DE CARACTERES contendo espaco - casa quase todo comando.
    const casos = [[[]], [{}], [[[]]], [{ a: 1 }]];
    casos.forEach(function (liberados, i) {
      const dir = gravarProjeto(novoDir(), { comandosLiberados: liberados });
      negouPorDecisao(bash(dir, tmp, 'rm -rf /', 'rx5-' + i), 'RX-5 ' + JSON.stringify(liberados));
    });
  });
});

test('RX-6 CONTROLE: numero, null e booleano ja negavam hoje - a familia e menor do que parece', () => {
  comBancada((novoDir, tmp) => {
    // String(123)="123", String(null)="null", String(true)="true": nenhum casa
    // "rm -rf /". Passa igual antes e depois DE PROPOSITO - serve para nao
    // creditar ao filtro uma protecao que ele nao trouxe.
    const casos = [[123], [null], [true], [0], [false]];
    casos.forEach(function (liberados, i) {
      const dir = gravarProjeto(novoDir(), { comandosLiberados: liberados });
      negouPorDecisao(bash(dir, tmp, 'rm -rf /', 'rx6-' + i), 'RX-6 ' + JSON.stringify(liberados));
    });
  });
});

test('RX-7 CONTROLE: o escape legitimo continua servindo', () => {
  comBancada((novoDir, tmp) => {
    const dir = gravarProjeto(novoDir(), { comandosLiberados: ['rm -rf /'] });
    permitiuPorDecisao(bash(dir, tmp, 'rm -rf /', 'rx7'), 'RX-7');
    // ponta 2: o escape e do padrao declarado, nao um passe livre geral
    negouPorDecisao(bash(dir, tmp, 'git push --force', 'rx7b'), 'RX-7 ponta 2');
  });
});

test('RX-8 CONTROLE (D102): comandosLiberados:[".*"] em TEXTO continua desligando o portao', () => {
  comBancada((novoDir, tmp) => {
    // Este teste existe para provar que o X5a saiu por ESCOLHA (D102), nao por
    // esquecimento. O botao honesto de desligar e travas.destrutivo:false.
    // Se um dia isto passar a negar, a D102 mudou e o registro X5 tem de mudar junto.
    const dir = gravarProjeto(novoDir(), { comandosLiberados: ['.*'] });
    permitiuPorDecisao(bash(dir, tmp, 'rm -rf /', 'rx8'), 'RX-8');
  });
});

// ---------------------------------------------------------------------------
// X5b - UNIAO em validar(), nunca substituicao
// ---------------------------------------------------------------------------

// MEDIDO contra o HEAD: este PASSA la, porque o laco antigo ja existe hoje. A
// secao 7 da v4.1 o chamava de MATA PECA; a peca "uniao" nao e uma linha que se
// reverta, e sim a AUSENCIA de substituicao. Ele morre sob a mutacao plausivel
// "trocar o laco antigo pelo novo" - isso e REGRESSAO, pela propria definicao
// da v4.1. Mesma classe do achado P1-33, um documento adiante.
test('RX-9 REGRESSAO: o laco antigo continua pegando a grafia identica ancorada', () => {
  const r = projetoLib.validar(comBase({
    comandosBloqueados: ['\\bnpm publish\\b'],
    comandosLiberados: ['\\bnpm publish\\b']
  }));
  assert.strictEqual(r.ok, false, r.erros.join(' | '));
  assert.ok(r.erros.some(function (e) { return e.indexOf('esta em comandosBloqueados E em comandosLiberados') !== -1; }),
    'o erro do laco ANTIGO sumiu: ' + r.erros.join(' | '));
  // A MEDICAO que prova por que o laco novo nao pode SUBSTITUIR o antigo:
  // padrao ancorado nao casa a propria grafia -
  // new RegExp("\\bnpm publish\\b").test("\\bnpm publish\\b") === false.
  assert.strictEqual(new RegExp('\\bnpm publish\\b', 'i').test('\\bnpm publish\\b'), false);
  assert.ok(!r.erros.some(function (e) { return e.indexOf('neutraliza') !== -1; }),
    'o laco NOVO nao pega este caso - e por isso que o antigo tem de ficar: ' + r.erros.join(' | '));
});

test('RX-10 MATA PECA: liberado que CASA o texto do bloqueado vira erro novo', () => {
  const r = projetoLib.validar(comBase({
    comandosBloqueados: ['npm publish'],
    comandosLiberados: ['npm publis']
  }));
  assert.strictEqual(r.ok, false, 'o conflito tem de reprovar a config: ' + r.erros.join(' | '));
  assert.ok(r.erros.some(function (e) {
    return e.indexOf('neutraliza') !== -1 && e.indexOf('npm publis') !== -1 && e.indexOf('npm publish') !== -1;
  }), 'o erro NOVO nao saiu, ou nao nomeia os dois lados: ' + r.erros.join(' | '));
  // e o laco ANTIGO nao pegava: indexOf so acha grafia identica
  assert.ok(!r.erros.some(function (e) { return e.indexOf('esta em comandosBloqueados E em') !== -1; }),
    'este caso e do laco novo, nao do antigo: ' + r.erros.join(' | '));
});

test('RX-11 CONTROLE: escape legitimo nao ganha erro novo (R-X5d, sem falso positivo)', () => {
  const r = projetoLib.validar(comBase({
    comandosBloqueados: ['npm publish', 'git push --force'],
    comandosLiberados: ['rm -rf /tmp/cache', 'curl ']
  }));
  assert.strictEqual(r.ok, true, 'falso positivo do X5b: ' + r.erros.join(' | '));
});

// ---------------------------------------------------------------------------
// X2b - as TRES travas (a de escopo saiu, D104)
// ---------------------------------------------------------------------------

test('RX-12 MATA PECA: cada uma das tres travas muda a decisao do SEU portao', () => {
  comBancada((novoDir, tmp) => {
    // (a) destrutivo
    const destOff = gravarProjeto(novoDir(), {
      travas: Object.assign({}, TRAVAS_LIGADAS, { destrutivo: false })
    });
    permitiuPorDecisao(bash(destOff, tmp, 'rm -rf build', 'rx12a'), 'RX-12 destrutivo desligada');
    const destOn = gravarProjeto(novoDir(), { travas: TRAVAS_LIGADAS });
    negouPorDecisao(bash(destOn, tmp, 'rm -rf build', 'rx12a2'), 'RX-12 destrutivo ligada');

    // (b) outraFrente - a 5b, com git de verdade
    const frenteOff = projetoComOutraFrente(novoDir, tmp,
      Object.assign({}, TRAVAS_LIGADAS, { outraFrente: false }), 'rx12b');
    permitiuPorDecisao(escrita(frenteOff, tmp, 'notas/guia.md', 'rx12b'), 'RX-12 outraFrente desligada');
    const frenteOn = projetoComOutraFrente(novoDir, tmp, TRAVAS_LIGADAS, 'rx12b2');
    const negadoFrente = escrita(frenteOn, tmp, 'notas/guia.md', 'rx12b2');
    negouPorDecisao(negadoFrente, 'RX-12 outraFrente ligada');
    assert.ok(motivo(negadoFrente).includes('trava 5'),
      'quem tem de barrar e a 5b: ' + motivo(negadoFrente));

    // (c) fecho
    const fechoOff = gravarProjeto(novoDir(), {
      travas: Object.assign({}, TRAVAS_LIGADAS, { fecho: false })
    });
    rodarPortao('marcar-trabalho.js', { session_id: 'rx12c', cwd: fechoOff, tool_name: 'Edit' }, tmp);
    const semBloqueio = rodarPortao('portao-fecho.js', {
      session_id: 'rx12c', cwd: fechoOff, hook_event_name: 'Stop',
      last_assistant_message: 'Pronto, os testes passaram.'
    }, tmp);
    assert.strictEqual(semBloqueio.status, 0);
    assert.ok(!(semBloqueio.json && semBloqueio.json.decision === 'block'),
      'com a trava desligada o fecho nao pode bloquear: ' + semBloqueio.stdout);

    const fechoOn = gravarProjeto(novoDir(), { travas: TRAVAS_LIGADAS });
    rodarPortao('marcar-trabalho.js', { session_id: 'rx12c2', cwd: fechoOn, tool_name: 'Edit' }, tmp);
    const bloqueado = rodarPortao('portao-fecho.js', {
      session_id: 'rx12c2', cwd: fechoOn, hook_event_name: 'Stop',
      last_assistant_message: 'Pronto, os testes passaram.'
    }, tmp);
    assert.strictEqual(bloqueado.json.decision, 'block', 'com a trava ligada o fecho tem de bloquear');
  });
});

// MEDIDO contra o HEAD: PASSA la, porque no HEAD nenhum portao le `travas` -
// os tres ja estao ligados por nao existir a fiacao. A v4.1 o chamava de MATA
// PECA; ele nao morre revertendo a rodada, morre sob a mutacao plausivel
// "trocar travasDe() por leitura direta de projeto.travas" (M5a/b/c da bancada).
// Pela definicao da propria v4.1, isso e REGRESSAO - e e a guarda mais util que
// esta rodada deixa, porque `travasDe` parece supérflua a quem vier depois.
test('RX-13 REGRESSAO: projeto.json SEM a chave travas mantem os tres portoes LIGADOS', () => {
  comBancada((novoDir, tmp) => {
    // E o formato de TODO projeto.json de hoje - nada grava `travas` ate a T10.
    // Ler projeto.travas.X direto recriaria o defeito que o X1 conserta, um
    // campo a direita: undefined.destrutivo estoura, io.blindar engole, PERMITE.
    const cru = comBase({});
    delete cru.travas;

    const dest = gravarCru(novoDir(), cru);
    negouPorDecisao(bash(dest, tmp, 'rm -rf build', 'rx13a'), 'RX-13 destrutivo');

    const frente = novoDir();
    const g = repoGit(frente);
    gravarCru(frente, cru);
    fs.mkdirSync(path.join(frente, 'notas'), { recursive: true });
    fs.writeFileSync(path.join(frente, 'notas', 'guia.md'), 'um', 'utf8');
    g(['add', '-A']);
    g(['commit', '-q', '-m', 'inicial']);
    fs.writeFileSync(path.join(frente, 'notas', 'guia.md'), 'outra frente', 'utf8');
    rodarPortao('abertura.js', { session_id: 'rx13b', cwd: frente, source: 'startup' }, tmp);
    negouPorDecisao(escrita(frente, tmp, 'notas/guia.md', 'rx13b'), 'RX-13 outraFrente');

    const fecho = gravarCru(novoDir(), cru);
    rodarPortao('marcar-trabalho.js', { session_id: 'rx13c', cwd: fecho, tool_name: 'Edit' }, tmp);
    const r = rodarPortao('portao-fecho.js', {
      session_id: 'rx13c', cwd: fecho, hook_event_name: 'Stop',
      last_assistant_message: 'Pronto, esta tudo certo.'
    }, tmp);
    assert.strictEqual(r.json.decision, 'block', 'RX-13 fecho: ' + r.stdout + ' ' + r.stderr);
  });
});

// MEDIDO contra o HEAD: PASSA la, pelo mesmo motivo do RX-13. REGRESSAO.
test('RX-14 REGRESSAO: travas com tipo errado mantem os portoes LIGADOS, sem estourar', () => {
  comBancada((novoDir, tmp) => {
    const ruins = ['sim', [], null, 0, true, 42];
    ruins.forEach(function (ruim, i) {
      const dir = gravarCru(novoDir(), comBase({ travas: ruim }));
      negouPorDecisao(bash(dir, tmp, 'rm -rf build', 'rx14a-' + i),
        'RX-14 destrutivo com travas=' + JSON.stringify(ruim));

      rodarPortao('marcar-trabalho.js', { session_id: 'rx14c-' + i, cwd: dir, tool_name: 'Edit' }, tmp);
      const r = rodarPortao('portao-fecho.js', {
        session_id: 'rx14c-' + i, cwd: dir, hook_event_name: 'Stop',
        last_assistant_message: 'Pronto, esta tudo certo.'
      }, tmp);
      assert.strictEqual(r.json && r.json.decision, 'block',
        'RX-14 fecho com travas=' + JSON.stringify(ruim) + ': ' + r.stdout + ' ' + r.stderr);
    });

    // O portao de ESCOPO entra so com `travas: null`, e a razao e medida:
    // "sim".outraFrente e []. outraFrente ja sao undefined, entao `!== false` da
    // true e a decisao seria a MESMA com ou sem a peca - nao discriminaria nada.
    // `null.outraFrente` ESTOURA, e ai a peca decide.
    const frente = projetoComOutraFrente(novoDir, tmp, null, 'rx14b');
    negouPorDecisao(escrita(frente, tmp, 'notas/guia.md', 'rx14b'), 'RX-14 outraFrente com travas=null');
  });
});

test('RX-15 MATA PECA: travas.fecho:false desliga a COBRANCA, nunca o ledger (R-X2b3)', () => {
  comBancada((novoDir, tmp) => {
    // encerrarTurno e o UNICO chamador de estado.descarregar e de estado.limpar.
    // Um io.permitir() aqui desligaria a medicao do plugin inteiro e vazaria o
    // arquivo de sessao para sempre. A prova e lida do DISCO, nao do processo.
    const dir = gravarProjeto(novoDir(), {
      travas: Object.assign({}, TRAVAS_LIGADAS, { fecho: false })
    });
    // semeia um contador de verdade: app/** e marcha padrao e nao ha escopo.md
    negouPorDecisao(escrita(dir, tmp, 'app/servico.js', 'rx15'), 'RX-15 semeadura');
    rodarPortao('marcar-trabalho.js', { session_id: 'rx15', cwd: dir, tool_name: 'Edit' }, tmp);

    const r = rodarPortao('portao-fecho.js', {
      session_id: 'rx15', cwd: dir, hook_event_name: 'Stop',
      last_assistant_message: 'Pronto, esta tudo certo.'
    }, tmp);
    assert.strictEqual(r.status, 0);
    assert.ok(!(r.json && r.json.decision === 'block'), 'a trava desligada nao pode bloquear');

    const contadores = JSON.parse(
      fs.readFileSync(path.join(dir, '.claude', 'sworn', 'contadores.json'), 'utf8'));
    assert.strictEqual(contadores.sem_escopo, 1,
      'o ledger tem de continuar sendo escrito: ' + JSON.stringify(contadores));
    // T18/D123: o arquivo de sessao passa a durar a SESSAO inteira, de proposito.
    // O que a trava desligada nao pode fazer e deixar de zerar o TURNO - e ai sim
    // bloqueouNesteTurno ficaria congelado e o portao morreria para sempre.
    const sessaoRx = JSON.parse(
      fs.readFileSync(path.join(tmp, 'sworn', 'rx15.json'), 'utf8'));
    assert.strictEqual(sessaoRx.bloqueouNesteTurno, undefined,
      'o turno tem de ter sido zerado: ' + JSON.stringify(sessaoRx));
    assert.strictEqual(sessaoRx.trabalhoReal, undefined,
      'trabalhoReal e do turno: ' + JSON.stringify(sessaoRx));
    assert.strictEqual(sessaoRx.contadores, undefined,
      'o balde do TURNO nao pode sobreviver a descarga (D123): ' + JSON.stringify(sessaoRx));
  });
});

test('RX-16 CONTROLE (D104): travas.escopo nao tem leitor, e isso e de proposito', () => {
  comBancada((novoDir, tmp) => {
    // A chave continua no schema e em montar()/validar(); nenhum portao a le.
    // As duas decisoes tem de ser IDENTICAS com ela ligada e desligada.
    const off = gravarProjeto(novoDir(), {
      travas: Object.assign({}, TRAVAS_LIGADAS, { escopo: false })
    });
    const on = gravarProjeto(novoDir(), { travas: TRAVAS_LIGADAS });

    negouPorDecisao(escrita(off, tmp, 'app/servico.js', 'rx16a'), 'RX-16 desligada nega');
    negouPorDecisao(escrita(on, tmp, 'app/servico.js', 'rx16b'), 'RX-16 ligada nega');
    permitiuPorDecisao(escrita(off, tmp, 'notas/a.md', 'rx16c'), 'RX-16 desligada permite');
    permitiuPorDecisao(escrita(on, tmp, 'notas/a.md', 'rx16d'), 'RX-16 ligada permite');

    // e a chave continua obrigatoria e booleana no schema
    assert.ok(projetoLib.TRAVAS.indexOf('escopo') !== -1, 'a chave saiu do schema');
    assert.strictEqual(projetoLib.montar({}, {}).travas.escopo, true);
  });
});

// ---------------------------------------------------------------------------
// X2a - aviso de tipo, estreito (D101)
// ---------------------------------------------------------------------------

test('RX-17 CONTROLE: fixture parcial nao ganha systemMessage nenhum (P1-12)', () => {
  comBancada((novoDir, tmp) => {
    // A forma das fixtures que ja existem na suite: so as quatro chaves que o
    // portao de escopo usa. Chave AUSENTE nao e tipo errado - o aviso e
    // estreito, e nao pode vazar para quem nao pediu.
    const dir = gravarCru(novoDir(), {
      versaoConfig: 1, marchaPadrao: 'padrao', intocaveis: ['cofre/**'],
      marchas: { aaa: ['**/pagamento/**'], padrao: ['app/**'], rapida: ['notas/**'] }
    });
    const r = escrita(dir, tmp, 'notas/a.md', 'rx17');
    permitiuPorDecisao(r, 'RX-17');
    assert.strictEqual(r.json, null, 'nao podia emitir nada: ' + r.stdout);
  });
});

test('RX-18 MATA PECA: intocaveis com tipo errado AVISA, e a decisao nao muda', () => {
  comBancada((novoDir, tmp) => {
    // glob.casaAlgum (glob.js:46) devolve false para nao-lista: a protecao vira
    // NADA, calado. Quem cobre o buraco e o aviso - nao a decisao do portao.
    const torto = gravarProjeto(novoDir(), { intocaveis: 'cofre/**' });
    const r = escrita(torto, tmp, 'notas/a.md', 'rx18');
    permitiuPorDecisao(r, 'RX-18');
    assert.ok(r.json && r.json.systemMessage, 'faltou o aviso: ' + r.stdout);
    assert.ok(r.json.systemMessage.indexOf('intocaveis tem de ser lista') !== -1, r.json.systemMessage);

    // uma vez por sessao, como o avisouSemConfig
    const repetido = escrita(torto, tmp, 'notas/b.md', 'rx18');
    assert.strictEqual(repetido.json, null, 'o aviso repetiu: ' + repetido.stdout);

    // e a decisao e a MESMA com a lista bem formada - o aviso nao decide nada
    const certo = gravarProjeto(novoDir(), { intocaveis: ['cofre/**'] });
    const semAviso = escrita(certo, tmp, 'notas/a.md', 'rx18b');
    permitiuPorDecisao(semAviso, 'RX-18 controle');
    assert.strictEqual(semAviso.json, null, 'lista bem formada nao pode avisar: ' + semAviso.stdout);

    // O SEGUNDO sitio do canal: o `permitir` do passo 5, que nao e `return` -
    // e a ultima instrucao do callback, e funciona porque io.permitir chama
    // process.exit(0). Sem esta ponta, metade da fiacao ficaria sem prova: o
    // caminho de cima sai pelo passo 4 (marcha rapida) e nunca chega aqui.
    const comEscopo = gravarProjeto(novoDir(), { intocaveis: 'cofre/**' });
    fs.mkdirSync(path.join(comEscopo, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(comEscopo, '.claude', 'sworn', 'escopo.md'),
      '# Escopo\n**Objetivo:** exercitar o passo 5\n## Dentro\n- app/**\n', 'utf8');
    // C9: o alvo tem de JA EXISTIR, senao o passo 6 nega antes e o canal de aviso
    // nunca e exercitado. Editar existente e o caminho que chega ao passo 5 - e e
    // esse caminho que este teste existe para provar, nao a criacao.
    fs.mkdirSync(path.join(comEscopo, 'app'), { recursive: true });
    fs.writeFileSync(path.join(comEscopo, 'app', 'servico.js'), 'ja existia\n', 'utf8');
    const passo5 = escrita(comEscopo, tmp, 'app/servico.js', 'rx18c');
    permitiuPorDecisao(passo5, 'RX-18 passo 5');
    assert.ok(passo5.json && passo5.json.systemMessage &&
      passo5.json.systemMessage.indexOf('intocaveis tem de ser lista') !== -1,
      'o aviso nao sai pelo passo 5: ' + passo5.stdout);
  });
});

test('RX-19 MATA PECA: o aviso olha o ELEMENTO das listas, nao so o continente', () => {
  comBancada((novoDir, tmp) => {
    const dir = gravarProjeto(novoDir(), {
      comandosLiberados: [['.*']],
      comandosBloqueados: [[]]
    });
    const r = escrita(dir, tmp, 'notas/a.md', 'rx19');
    permitiuPorDecisao(r, 'RX-19');
    assert.ok(r.json && r.json.systemMessage, 'faltou o aviso: ' + r.stdout);
    assert.ok(r.json.systemMessage.indexOf('comandosLiberados tem item que nao e texto') !== -1,
      r.json.systemMessage);
    assert.ok(r.json.systemMessage.indexOf('comandosBloqueados tem item que nao e texto') !== -1,
      r.json.systemMessage);
    // A TERCEIRA lista lida passa pelo MESMO laco, e sem esta ponta ela ficava
    // sem teste proprio: medido, da para desligar o item-check SO para
    // `intocaveis` e a suite inteira continua verde.
    const comIntocaveis = gravarProjeto(novoDir(), { intocaveis: ['cofre/**', 42] });
    const i3 = escrita(comIntocaveis, tmp, 'notas/a.md', 'rx19c');
    permitiuPorDecisao(i3, 'RX-19 intocaveis');
    assert.ok(i3.json && i3.json.systemMessage &&
      i3.json.systemMessage.indexOf('intocaveis tem item que nao e texto') !== -1,
      'a terceira lista lida nao avisa: ' + i3.stdout);

    // Os campos de CONTINENTE que o aviso tambem cobre e que nenhum outro teste
    // tocava. Medido: davam para apagar inteiros com a suite verde.
    const continentes = [
      [{ marchas: 'nao e objeto', marchaPadrao: 'rapida' }, 'marchas tem de ser objeto'],
      [{ marchas: { aaa: 'nao e lista', padrao: ['app/**'], rapida: ['notas/**'] } }, 'marchas.aaa tem de ser lista'],
      [{ marchaPadrao: 'turbo' }, 'marchaPadrao tem de ser uma de'],
      [{ travas: 'sim' }, 'travas tem de ser objeto']
    ];
    continentes.forEach(function (par, k) {
      const d = gravarProjeto(novoDir(), par[0]);
      const res = escrita(d, tmp, 'notas/a.md', 'rx19d-' + k);
      permitiuPorDecisao(res, 'RX-19 continente ' + par[1]);
      assert.ok(res.json && res.json.systemMessage &&
        res.json.systemMessage.indexOf(par[1]) !== -1,
        'faltou o aviso "' + par[1] + '": ' + res.stdout);
    });

    // um aviso por LISTA, nunca um por item
    const dois = gravarProjeto(novoDir(), { comandosLiberados: [[], {}, 42, []] });
    const q = escrita(dois, tmp, 'notas/a.md', 'rx19b');
    assert.strictEqual(
      q.json.systemMessage.split('comandosLiberados tem item que nao e texto').length - 1, 1,
      'saiu um aviso por item: ' + q.json.systemMessage);
  });
});

// ---------------------------------------------------------------------------
// Regressao - trava nenhuma pode virar bypass
// ---------------------------------------------------------------------------

test('RX-20 REGRESSAO: trava desligada + intocaveis inerte NAO abre o segredo', () => {
  comBancada((novoDir, tmp) => {
    // Morre sob a mutacao plausivel "trava desligada = permite tudo": aqui as
    // duas defesas de cima ja estao fora (intocaveis inerte por tipo errado,
    // outraFrente desligada pelo dono) e quem segura e o passo 5.
    const dir = gravarProjeto(novoDir(), {
      intocaveis: 'cofre/**',
      travas: Object.assign({}, TRAVAS_LIGADAS, { outraFrente: false })
    });
    const r = escrita(dir, tmp, 'cofre/chave.env', 'rx20');
    negouPorDecisao(r, 'RX-20');
    assert.ok(motivo(r).includes('trava 4'),
      'quem segura aqui e o passo 5, por falta de escopo declarado: ' + motivo(r));
  });
});
