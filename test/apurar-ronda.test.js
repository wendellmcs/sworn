'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');

/** D120: o apurador e CLI, nao hook. Ele descobre a sessao por --sessao ou pelo ambiente. */
function rodar(args, cwd, tmp, extraEnv) {
  const env = Object.assign({}, process.env, { SWORN_TMP: tmp }, extraEnv || {});
  delete env.CLAUDE_CODE_SESSION_ID;
  if (extraEnv && extraEnv.CLAUDE_CODE_SESSION_ID) env.CLAUDE_CODE_SESSION_ID = extraEnv.CLAUDE_CODE_SESSION_ID;
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'apurar-ronda.js')].concat(args || []), {
    cwd: cwd, encoding: 'utf8', env: env
  });
  let json = null;
  if (r.stdout && r.stdout.trim()) { try { json = JSON.parse(r.stdout); } catch (e) { json = null; } }
  return { status: r.status, stdout: r.stdout, json: json };
}

function comTmp(fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-apurar-'));
  try { fn(base); } finally { fs.rmSync(base, { recursive: true, force: true }); }
}

/** Escreve <cwd>/.claude/sworn/revisao/<n>/vereditos/<lente>.json */
function gravarRonda(cwd, n, vereditos) {
  const dir = path.join(cwd, '.claude', 'sworn', 'revisao', String(n), 'vereditos');
  fs.mkdirSync(dir, { recursive: true });
  for (const v of vereditos) {
    fs.writeFileSync(path.join(dir, v.lente + '.json'), JSON.stringify(v), 'utf8');
  }
}

function gravarMapa(cwd, n, mapa) {
  const dir = path.join(cwd, '.claude', 'sworn', 'revisao', String(n));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'mapa.json'), JSON.stringify({ arquivo: 'src/a.js', mapa: mapa }), 'utf8');
}

// D244/defeito 3: a forma da onda 7 - todo P1 do lado antigo, nenhum do novo - fecha por
// duas secas, e nao pelo teto. Fixture sintetica: os vereditos reais citam o produto.
test('D244/defeito 3: pelo CLI, P1 so do lado antigo fecha por duas rondas secas', () => {
  comTmp((tmp) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-apurar-lado-'));
    const vd = (arq, linha) => ({ lente: 'design', melhor: 'A',
      achados: [{ estado: 'confirmado', trecho: 'x', severidade: 'P1', arquivo: arq, linha: linha, descricao: 'valor cru' }] });
    gravarMapa(cwd, 1, { A: 'trabalho', B: 'HEAD' });
    gravarRonda(cwd, 1, [vd('B.txt', 379)]);
    gravarMapa(cwd, 2, { A: 'HEAD', B: 'trabalho' });
    gravarRonda(cwd, 2, [vd('A.txt', 471)]);
    const r = rodar(['--sessao', 'lado'], cwd, tmp);
    assert.strictEqual(r.status, 0, r.stdout);
    assert.strictEqual(r.json.encerrar, true, r.stdout);
    assert.strictEqual(r.json.motivo, 'duas rondas secas seguidas: aprovado');
    assert.strictEqual(r.json.achadosDoLadoAntigo.length, 1);
  });
});

// D475 (s99): o par R2/R3 da skills/playbook/SKILL.md reduzido. O lado novo e B na ronda 1 e A na ronda 2; a linha 3
// do lado novo foi reescrita entre as rondas, e a mesma lente cita P1 nela de novo: evidencia nova, molha.
test('D475: pelo CLI, P1 na mesma linha do lado novo com texto reescrito entre rondas molha a ronda', () => {
  comTmp((tmp) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-apurar-reescrita-'));
    const vd = (arq) => ({ lente: 'microcopy', melhor: 'A',
      achados: [{ estado: 'confirmado', trecho: 'dois', severidade: 'P1', arquivo: arq, linha: 3, descricao: 'frase ambigua' }] });
    const texto = (n, rotulo, linha3) => fs.writeFileSync(path.join(cwd, '.claude', 'sworn', 'revisao', String(n),
      rotulo + '.txt'), 'um\ndois\n' + linha3 + '\nquatro\n', 'utf8');
    gravarMapa(cwd, 1, { A: 'HEAD', B: 'trabalho' });
    gravarRonda(cwd, 1, [vd('B.txt')]);
    texto(1, 'A', 'frase antiga');
    texto(1, 'B', 'nem os contadores, turnos e arquivos');
    gravarMapa(cwd, 2, { A: 'trabalho', B: 'HEAD' });
    gravarRonda(cwd, 2, [vd('A.txt')]);
    texto(2, 'A', 'os bloqueios de portao, que o plugin conta');
    texto(2, 'B', 'frase antiga');
    const r = rodar(['--sessao', 'reescrita'], cwd, tmp);
    assert.strictEqual(r.status, 0, r.stdout);
    assert.strictEqual(r.json.rondasSecas, 0, r.stdout);
    assert.strictEqual(r.json.achadosNovosP0P1.length, 1, r.stdout);
  });
});

// s104 (R1 da D469 de apurar-ronda.js, estados+manutencao): A.txt/B.txt que EXISTE e nao se le nao e "arquivo que
// falta". O resto do script so trata ENOENT como ausencia; os outros erros param com a causa (0.3.3, item 1).
test('D475: pelo CLI, A.txt da ronda que existe e nao se le para com a causa; o que falta segue a conta de antes', () => {
  comTmp((tmp) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-apurar-ilegivel-'));
    gravarMapa(cwd, 1, { A: 'trabalho', B: 'HEAD' });
    gravarRonda(cwd, 1, [{ lente: 'microcopy', melhor: 'B',
      achados: [{ estado: 'confirmado', trecho: 'x', severidade: 'P2', arquivo: 'A.txt', linha: 1, descricao: 'x' }] }]);
    const r0 = rodar(['--sessao', 'falta'], cwd, tmp);
    assert.strictEqual(r0.status, 0, 'A.txt que falta tem de seguir a conta de antes: ' + r0.stdout);
    fs.mkdirSync(path.join(cwd, '.claude', 'sworn', 'revisao', '1', 'A.txt'));
    const r = rodar(['--sessao', 'ilegivel'], cwd, tmp);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.match(r.stdout, /ERRO: nao consegui ler .*1\/A\.txt/, r.stdout);
    assert.doesNotMatch(r.stdout, /refutados\.json/, 'a causa nao e o refutados.json: ' + r.stdout);
  });
});

test('D244/defeito 3: pelo CLI, refutados.json sem prova para com erro', () => {
  comTmp((tmp) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-apurar-ref-'));
    gravarMapa(cwd, 1, { A: 'trabalho', B: 'HEAD' });
    gravarRonda(cwd, 1, [{ lente: 'design', melhor: 'A',
      achados: [{ estado: 'confirmado', trecho: 'x', severidade: 'P1', arquivo: 'A.txt', linha: 3, descricao: 'x' }] }]);
    fs.writeFileSync(path.join(cwd, '.claude', 'sworn', 'revisao', 'refutados.json'),
      JSON.stringify([{ ronda: 1, lente: 'design', arquivo: 'A.txt', linha: 3 }]), 'utf8');
    const r = rodar(['--sessao', 'ref'], cwd, tmp);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.match(r.stdout, /prova/);
  });
});

function contadorDe(tmp, sessionId) {
  const arquivo = path.join(tmp, 'sworn', sessionId + '.json');
  try {
    const s = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    return (s.contadores && s.contadores.revisao_fechada) || 0;
  } catch (e) {
    return 0;
  }
}

test('apurar-ronda: revisao que encerra soma +1 em revisao_fechada (D21)', () => {
  comTmp((tmp) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-repo-'));
    try {
      gravarRonda(cwd, 1, [{ lente: 'correcao', melhor: 'B', achados: [] }]);
      gravarRonda(cwd, 2, [{ lente: 'correcao', melhor: 'B', achados: [] }]);
      const r = rodar(['--sessao', 's1'], cwd, tmp);
      assert.strictEqual(r.status, 0);
      assert.strictEqual(r.json.encerrar, true, 'duas rondas secas tinham de encerrar');
      assert.strictEqual(contadorDe(tmp, 's1'), 1, 'revisao fechada conta exatamente 1');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// Plano 091 (#1, D559): o "aprovado" grava o arquivo revisado em revisadosAprovados, que o portao do commit le; o
// teto (encerra sem aprovar) e a ronda que nao encerra nao gravam.
function aprovadosDe(tmp, sessionId) {
  try { return JSON.parse(fs.readFileSync(path.join(tmp, 'sworn', sessionId + '.json'), 'utf8')).revisadosAprovados; }
  catch (e) { return undefined; }
}

test('091 #1: revisao aprovada grava o arquivo em revisadosAprovados; o teto nao grava', () => {
  comTmp((tmp) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-repo-'));
    try {
      gravarMapa(cwd, 1, { A: 'trabalho', B: 'HEAD' });
      gravarRonda(cwd, 1, [{ lente: 'correcao', melhor: 'A', achados: [] }]);
      gravarMapa(cwd, 2, { A: 'trabalho', B: 'HEAD' });
      gravarRonda(cwd, 2, [{ lente: 'correcao', melhor: 'A', achados: [] }]);
      const r = rodar(['--sessao', 'ap1'], cwd, tmp);
      assert.strictEqual(r.status, 0, r.stdout);
      assert.match(String(r.json.motivo), /aprovado/);
      assert.deepStrictEqual(aprovadosDe(tmp, 'ap1'), [path.resolve(cwd, 'src/a.js')]);
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  });
  comTmp((tmp) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-repo-'));
    try {
      for (const n of [1, 2, 3]) {
        gravarMapa(cwd, n, { A: 'trabalho', B: 'HEAD' });
        gravarRonda(cwd, n, [{ lente: 'correcao', melhor: 'B',
          achados: [{ estado: 'confirmado', trecho: 'x', severidade: 'P1', arquivo: 'A.txt', linha: n * 10, descricao: 'quebra ' + n }] }]);
      }
      const r = rodar(['--sessao', 'ap2'], cwd, tmp);
      assert.strictEqual(r.status, 0, r.stdout);
      assert.strictEqual(r.json.encerrar, true, 'o teto tinha de encerrar: ' + r.stdout);
      assert.doesNotMatch(String(r.json.motivo), /aprovado/);
      assert.strictEqual(aprovadosDe(tmp, 'ap2'), undefined, 'o teto gravou aprovado');
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  });
});

test('apurar-ronda: revisao que NAO encerra nao conta (contador inflado e D14 sem base)', () => {
  comTmp((tmp) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-repo-'));
    try {
      gravarRonda(cwd, 1, [{
        lente: 'correcao', melhor: 'A',
        achados: [{ estado: 'confirmado', trecho: 'x', severidade: 'P1', arquivo: 'x.js', linha: 10, o_que: 'quebra' }]
      }]);
      const r = rodar(['--sessao', 's1'], cwd, tmp);
      assert.strictEqual(r.status, 0);
      assert.strictEqual(r.json.encerrar, false, 'ronda 1 com P1 novo nao encerra');
      assert.strictEqual(contadorDe(tmp, 's1'), 0, 'nao fechou, nao conta');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});

test('apurar-ronda: sem --sessao, a sessao vem de CLAUDE_CODE_SESSION_ID', () => {
  comTmp((tmp) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-repo-'));
    try {
      gravarRonda(cwd, 1, [{ lente: 'correcao', melhor: 'B', achados: [] }]);
      gravarRonda(cwd, 2, [{ lente: 'correcao', melhor: 'B', achados: [] }]);
      const r = rodar([], cwd, tmp, { CLAUDE_CODE_SESSION_ID: 'da-env' });
      assert.strictEqual(r.status, 0);
      assert.strictEqual(r.json.encerrar, true);
      assert.strictEqual(contadorDe(tmp, 'da-env'), 1, 'contou na sessao que veio do ambiente');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// Ronda 1 do 8c.5: o veredito que nao se le virava empate sem achados, passava na
// validacao e contava a ronda como seca. Um voto que falta nao e voto a favor.
test('apurar-ronda: veredito ilegivel para a apuracao, nomeia o arquivo e nao conta a revisao', () => {
  comTmp((tmp) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-repo-'));
    try {
      gravarRonda(cwd, 1, [{ lente: 'correcao', melhor: 'B', achados: [] }]);
      gravarRonda(cwd, 2, [{ lente: 'correcao', melhor: 'B', achados: [] }]);
      fs.writeFileSync(path.join(cwd, '.claude', 'sworn', 'revisao', '2', 'vereditos', 'seguranca.json'),
        '{ "lente": "seguranca", "melhor": ', 'utf8');
      const r = rodar(['--sessao', 's1'], cwd, tmp);
      assert.strictEqual(r.status, 1, 'ronda com voto ilegivel nao pode sair 0: ' + r.stdout);
      assert.strictEqual(r.json, null, 'nao pode sair apuracao com um voto faltando: ' + r.stdout);
      assert.ok(r.stdout.includes('.claude/sworn/revisao/2/vereditos/seguranca.json'),
        'a mensagem tem de nomear o arquivo ilegivel: ' + r.stdout);
      assert.ok(/regrave/i.test(r.stdout), 'a mensagem tem de dizer o que fazer: ' + r.stdout);
      assert.strictEqual(contadorDe(tmp, 's1'), 0, 'revisao que nao se apurou nao fecha');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// Ronda 2 do 8c.10: o que se le mas nao e veredito - nao e objeto, nao tem lente, o melhor nao
// e A, B nem empate, ou os achados faltam ou nao sao lista - contava como voto sem achado e
// deixava a ronda seca. Para como o ilegivel. O achado invalido dentro de um veredito bom
// segue so descartado: um achado mal citado nao trava a ronda.
test('apurar-ronda: o que se le mas nao e veredito para a apuracao, e diz por que', () => {
  comTmp((tmp) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-repo-'));
    try {
      gravarRonda(cwd, 1, [{ lente: 'correcao', melhor: 'B', achados: [] }]);
      gravarRonda(cwd, 2, [{ lente: 'correcao', melhor: 'B', achados: [] }]);
      const dir = path.join(cwd, '.claude', 'sworn', 'revisao', '2', 'vereditos');
      const falsos = {
        'estados.json': ['{}', ['sem lente', 'melhor', 'achados']],
        'seguranca.json': ['null', ['nao e objeto']],
        'borda.json': ['{ "lente": "borda", "melhor": "talvez", "achados": [] }', ['melhor']],
        'medidor.json': ['{ "melhor": "empate", "achados": [] }', ['sem lente']],
        'escopo.json': ['{ "lente": "escopo", "melhor": "empate" }', ['achados']],
        'design.json': ['{ "lente": "design", "melhor": "empate", "achados": 5 }', ['achados']]
      };
      for (const [f, [txt]] of Object.entries(falsos)) fs.writeFileSync(path.join(dir, f), txt, 'utf8');
      let r = rodar(['--sessao', 's1'], cwd, tmp);
      assert.strictEqual(r.status, 1, 'ronda com voto que nao e veredito nao pode sair 0: ' + r.stdout);
      assert.strictEqual(r.json, null, 'nao pode sair apuracao com um voto faltando: ' + r.stdout);
      const linhas = r.stdout.split('\n');
      for (const [f, [, motivos]] of Object.entries(falsos)) {
        const l = linhas.find((x) => x.includes('.claude/sworn/revisao/2/vereditos/' + f));
        assert.ok(l && l.startsWith('ERRO:'), 'a mensagem tem de nomear ' + f + ': ' + r.stdout);
        const ditos = l.slice(l.indexOf(f) + f.length + 2).split('; ');
        assert.strictEqual(ditos.length, motivos.length, f + ' diz os seus motivos, e so eles: ' + l);
        for (const m of motivos) assert.ok(ditos.some((d) => d.includes(m)), f + ' tem de dizer "' + m + '": ' + l);
      }
      assert.ok(/regrave/i.test(r.stdout), 'a mensagem tem de dizer o que fazer: ' + r.stdout);
      assert.strictEqual(contadorDe(tmp, 's1'), 0, 'revisao que nao se apurou nao fecha');

      for (const f of Object.keys(falsos)) fs.rmSync(path.join(dir, f));
      fs.writeFileSync(path.join(dir, 'borda.json'), JSON.stringify({ lente: 'borda', melhor: 'empate',
        achados: [{ estado: 'confirmado', trecho: 'x', severidade: 'P1', descricao: 'sem lugar' }] }), 'utf8');
      r = rodar(['--sessao', 's2'], cwd, tmp);
      assert.strictEqual(r.status, 0, 'achado invalido em veredito bom nao para a apuracao: ' + r.stdout);
      assert.ok(r.json && r.json.vereditosDescartados.some((e) => e.includes('sem lugar')),
        'o achado sem arquivo:linha segue descartado: ' + r.stdout);
      // L3 (s104), A3-05: a aprovacao com achado descartado diz isso no motivo; o descarte segue sem travar (D422).
      assert.strictEqual(r.json.encerrar, true, r.stdout);
      assert.match(r.json.motivo, /^duas rondas secas seguidas: aprovado/);
      assert.match(r.json.motivo, /1 achado\(s\) descartado\(s\)/);
      assert.match(r.json.motivo, /vereditosDescartados/);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// L3 (s104), A3-03: o mapa.json da ronda 1 traz a faixa (o preparar-revisao.js grava); a ronda 1 sem as lentes dela
// para a apuracao, como o voto que falta, e nao conta o fecho.
test('L3 A3-03: pelo CLI, ronda 1 sem as lentes da faixa para com erro e nao fecha', () => {
  comTmp((tmp) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-repo-'));
    try {
      for (const n of [1, 2]) {
        const dir = path.join(cwd, '.claude', 'sworn', 'revisao', String(n));
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'mapa.json'), JSON.stringify({ arquivo: 'src/a.js',
          mapa: { A: 'trabalho', B: 'HEAD' }, faixa: 'duas' }), 'utf8');
        gravarRonda(cwd, n, [{ lente: 'correcao', melhor: 'A', achados: [] }]);
      }
      let r = rodar(['--sessao', 'cob1'], cwd, tmp);
      assert.strictEqual(r.status, 1, r.stdout);
      assert.strictEqual(r.json, null, r.stdout);
      assert.match(r.stdout, /^ERRO: .*ronda 1.*borda/m);
      assert.doesNotMatch(r.stdout, /refutados\.json/, 'o voto que falta nao manda corrigir a refutacao');
      assert.strictEqual(contadorDe(tmp, 'cob1'), 0, 'revisao que nao se apurou nao fecha');
      gravarRonda(cwd, 1, [{ lente: 'borda', melhor: 'A', achados: [] }]);
      r = rodar(['--sessao', 'cob2'], cwd, tmp);
      assert.strictEqual(r.status, 0, r.stdout);
      assert.strictEqual(r.json.motivo, 'duas rondas secas seguidas: aprovado');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------------------------
// T2 / itens 11 e 12 da D257 (secao 11). Os testes de cima sao do FORMATO ANTIGO (0.3.0): pasta
// numerada solta em revisao/. Daqui para baixo, a base e uma por arquivo: revisao/<id>/<n>/.
// ---------------------------------------------------------------------------------------------

const SECO = { lente: 'correcao', melhor: 'B', achados: [] };
const P1_NOVO = { lente: 'correcao', melhor: 'A',
  achados: [{ estado: 'confirmado', trecho: 'x', severidade: 'P1', arquivo: 'A.txt', linha: 3, descricao: 'quebra' }] };

/** Grava revisao/<id>/<n>/ com vereditos e mapa.json (A = trabalho, B = HEAD). */
function gravarNaBase(cwd, id, arquivo, n, vereditos) {
  const dir = path.join(cwd, '.claude', 'sworn', 'revisao', id, String(n));
  fs.mkdirSync(path.join(dir, 'vereditos'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'mapa.json'),
    JSON.stringify({ arquivo: arquivo, mapa: { A: 'trabalho', B: 'HEAD' } }), 'utf8');
  for (const v of vereditos) fs.writeFileSync(path.join(dir, 'vereditos', v.lente + '.json'), JSON.stringify(v), 'utf8');
}

function comRepo(fn) {
  comTmp((tmp) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-bases-'));
    try { fn(cwd, tmp); } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  });
}

test('T2/item 11: --arquivo apura so a base dele, e a saida diz de qual arquivo e', () => {
  comRepo((cwd, tmp) => {
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 1, [SECO]);
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 2, [SECO]);
    gravarNaBase(cwd, 'src__b.js', 'src/b.js', 1, [P1_NOVO]);
    const a = rodar(['--sessao', 'ba', '--arquivo', 'src/a.js'], cwd, tmp);
    assert.strictEqual(a.status, 0, a.stdout);
    assert.strictEqual(a.json.encerrar, true, 'a base de a.js tem duas secas');
    assert.strictEqual(a.json.arquivo, 'src/a.js');
    assert.strictEqual(a.json.ronda, 2);
    const b = rodar(['--sessao', 'bb', '--arquivo', 'src/b.js'], cwd, tmp);
    assert.strictEqual(b.status, 0, b.stdout);
    assert.strictEqual(b.json.encerrar, false, 'a base de b.js tem P1 novo e uma ronda so');
    assert.strictEqual(b.json.arquivo, 'src/b.js');
    assert.strictEqual(b.json.ronda, 1, 'a ronda de b.js nao soma as de a.js');
    assert.strictEqual(contadorDe(tmp, 'bb'), 0);
  });
});

test('T2/item 11: --arquivo com barra invertida e normalizado como no preparar-revisao', () => {
  comRepo((cwd, tmp) => {
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 1, [SECO]);
    gravarNaBase(cwd, 'src__b.js', 'src/b.js', 1, [P1_NOVO]);
    const r = rodar(['--sessao', 'bs', '--arquivo', 'src\\a.js'], cwd, tmp);
    assert.strictEqual(r.status, 0, r.stdout);
    assert.strictEqual(r.json.arquivo, 'src/a.js');
    assert.strictEqual(r.json.rondasSecas, 1);
  });
});

test('T2/item 11: sem --arquivo e com duas bases, para com erro que lista os dois arquivos', () => {
  comRepo((cwd, tmp) => {
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 1, [SECO]);
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 2, [SECO]);
    gravarNaBase(cwd, 'src__b.js', 'src/b.js', 1, [SECO]);
    const r = rodar(['--sessao', 'dois'], cwd, tmp);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.strictEqual(r.json, null, 'sem apuracao: ' + r.stdout);
    assert.ok(r.stdout.startsWith('ERRO:'), r.stdout);
    assert.ok(r.stdout.includes('src/a.js') && r.stdout.includes('src/b.js'), 'lista os dois arquivos: ' + r.stdout);
    assert.ok(r.stdout.includes('--arquivo'), 'diz o que passar: ' + r.stdout);
    assert.strictEqual(contadorDe(tmp, 'dois'), 0, 'nao apurou, nao conta');
  });
});

test('T2/item 11: sem --arquivo e com uma base so, a base e achada sozinha', () => {
  comRepo((cwd, tmp) => {
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 1, [SECO]);
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 2, [SECO]);
    const r = rodar(['--sessao', 'uma'], cwd, tmp);
    assert.strictEqual(r.status, 0, r.stdout);
    assert.strictEqual(r.json.encerrar, true);
    assert.strictEqual(r.json.arquivo, 'src/a.js');
  });
});

test('T2/item 11: revisao/ sem nenhuma ronda da o erro de "nao ha revisao"', () => {
  comRepo((cwd, tmp) => {
    fs.mkdirSync(path.join(cwd, '.claude', 'sworn', 'revisao', 'src__a.js'), { recursive: true });
    const r = rodar(['--sessao', 'zero'], cwd, tmp);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.match(r.stdout, /nao ha revisao/);
  });
});

test('T2/item 11: veredito ilegivel ou invalido numa base nomeia o caminho da base, nao o da pasta plana', () => {
  comRepo((cwd, tmp) => {
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 1, [SECO]);
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 2, [SECO]);
    const dir = path.join(cwd, '.claude', 'sworn', 'revisao', 'src__a.js', '2', 'vereditos');
    fs.writeFileSync(path.join(dir, 'borda.json'), '{ "lente": ', 'utf8');
    const r = rodar(['--sessao', 'ile'], cwd, tmp);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.ok(r.stdout.includes('.claude/sworn/revisao/src__a.js/2/vereditos/borda.json'), r.stdout);
    fs.rmSync(path.join(dir, 'borda.json'));
    fs.writeFileSync(path.join(dir, 'escopo.json'), JSON.stringify({ lente: 'escopo', melhor: 'talvez', achados: [] }), 'utf8');
    const r2 = rodar(['--sessao', 'inv'], cwd, tmp);
    assert.strictEqual(r2.status, 1, r2.stdout);
    assert.ok(r2.stdout.includes('.claude/sworn/revisao/src__a.js/2/vereditos/escopo.json'), r2.stdout);
  });
});

test('T2/item 11: o refutados.json e lido da base escolhida', () => {
  comRepo((cwd, tmp) => {
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 1, [P1_NOVO]);
    gravarNaBase(cwd, 'src__b.js', 'src/b.js', 1, [SECO]);
    fs.writeFileSync(path.join(cwd, '.claude', 'sworn', 'revisao', 'src__a.js', 'refutados.json'),
      JSON.stringify([{ ronda: 1, lente: 'correcao', arquivo: 'A.txt', linha: 3, severidade: 'P1', prova: 'x.js:9' }]), 'utf8');
    const r = rodar(['--sessao', 'rf', '--arquivo', 'src/a.js'], cwd, tmp);
    assert.strictEqual(r.status, 0, r.stdout);
    assert.strictEqual(r.json.refutados.length, 1, 'refutacao da base dele: ' + r.stdout);
    assert.deepStrictEqual(r.json.achadosNovosP0P1, [], 'o P1 refutado nao molha a ronda');
    const r2 = rodar(['--sessao', 'rf', '--arquivo', 'src/b.js'], cwd, tmp);
    assert.deepStrictEqual(r2.json.refutados, [], 'a refutacao de a.js nao vaza para b.js');
  });
});

test('T2/item 11: --arquivo sem base cai na pasta plana quando ha formato antigo', () => {
  comRepo((cwd, tmp) => {
    gravarMapa(cwd, 1, { A: 'trabalho', B: 'HEAD' });
    gravarRonda(cwd, 1, [SECO]);
    gravarMapa(cwd, 2, { A: 'trabalho', B: 'HEAD' });
    gravarRonda(cwd, 2, [SECO]);
    const r = rodar(['--sessao', 'ant', '--arquivo', 'src/a.js'], cwd, tmp);
    assert.strictEqual(r.status, 0, r.stdout);
    assert.strictEqual(r.json.encerrar, true);
    assert.strictEqual(r.json.arquivo, 'src/a.js', 'o arquivo vem do mapa.json da ultima ronda');
  });
});

test('T2/item 11: com pasta plana E bases, sem --arquivo vale a plana; com --arquivo, a base', () => {
  comRepo((cwd, tmp) => {
    gravarRonda(cwd, 1, [SECO]);
    gravarRonda(cwd, 2, [SECO]);
    gravarNaBase(cwd, 'src__b.js', 'src/b.js', 1, [P1_NOVO]);
    const plana = rodar(['--sessao', 'pl'], cwd, tmp);
    assert.strictEqual(plana.status, 0, plana.stdout);
    assert.strictEqual(plana.json.encerrar, true, 'a plana tem duas secas');
    assert.strictEqual(plana.json.arquivo, null, 'a plana desta fixture nao tem mapa.json');
    const base = rodar(['--sessao', 'pl2', '--arquivo', 'src/b.js'], cwd, tmp);
    assert.strictEqual(base.json.encerrar, false);
    assert.strictEqual(base.json.arquivo, 'src/b.js');
  });
});

// Item 12: rodar o apurador de novo numa revisao ja fechada somava revisao_fechada outra vez.
test('T2/item 12: apurar duas vezes uma revisao fechada conta revisao_fechada uma vez so', () => {
  comRepo((cwd, tmp) => {
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 1, [SECO]);
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 2, [SECO]);
    const r1 = rodar(['--sessao', 'idem'], cwd, tmp);
    assert.strictEqual(r1.json.encerrar, true);
    assert.strictEqual(r1.json.revisaoFechadaContada.revisao_fechada, 1);
    assert.strictEqual(contadorDe(tmp, 'idem'), 1);
    const fechada = JSON.parse(fs.readFileSync(
      path.join(cwd, '.claude', 'sworn', 'revisao', 'src__a.js', 'fechada.json'), 'utf8'));
    assert.strictEqual(fechada.ronda, 2);
    assert.strictEqual(fechada.sessao, 'idem');
    assert.match(fechada.motivo, /duas rondas secas/);
    const r2 = rodar(['--sessao', 'outra'], cwd, tmp);
    assert.strictEqual(r2.status, 0, r2.stdout);
    assert.strictEqual(contadorDe(tmp, 'idem'), 1, 'a segunda apuracao nao soma');
    assert.strictEqual(contadorDe(tmp, 'outra'), 0, 'nem na sessao que a rodou de novo');
    assert.strictEqual(r2.json.revisaoFechadaContada.jaContada, true);
    assert.strictEqual(r2.json.revisaoFechadaContada.sessao, 'idem', 'diz onde foi contada: a do arquivo');
    assert.strictEqual(r2.json.encerrar, true, 'o resto da saida nao muda');
  });
});

test('T2/item 12: uma ronda nova numa revisao fechada e outro fecho, e conta de novo', () => {
  comRepo((cwd, tmp) => {
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 1, [SECO]);
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 2, [SECO]);
    rodar(['--sessao', 'nova'], cwd, tmp);
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 3, [SECO]);
    const r = rodar(['--sessao', 'nova'], cwd, tmp);
    assert.strictEqual(r.json.revisaoFechadaContada.revisao_fechada, 2, 'ronda 3 e fecho novo: ' + r.stdout);
    assert.strictEqual(contadorDe(tmp, 'nova'), 2);
  });
});

test('T2/item 12: revisao que nao fecha nao grava fechada.json e a saida segue como antes', () => {
  comRepo((cwd, tmp) => {
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 1, [P1_NOVO]);
    const r = rodar(['--sessao', 'aberta'], cwd, tmp);
    assert.strictEqual(r.json.encerrar, false);
    assert.strictEqual(r.json.revisaoFechadaContada, null);
    assert.strictEqual(fs.existsSync(path.join(cwd, '.claude', 'sworn', 'revisao', 'src__a.js', 'fechada.json')), false);
  });
});

test('T2/item 12: no formato antigo o fechada.json fica na pasta plana e tambem conta uma vez', () => {
  comRepo((cwd, tmp) => {
    gravarRonda(cwd, 1, [SECO]);
    gravarRonda(cwd, 2, [SECO]);
    rodar(['--sessao', 'ant1'], cwd, tmp);
    assert.ok(fs.existsSync(path.join(cwd, '.claude', 'sworn', 'revisao', 'fechada.json')));
    const r = rodar(['--sessao', 'ant1'], cwd, tmp);
    assert.strictEqual(contadorDe(tmp, 'ant1'), 1);
    assert.strictEqual(r.json.revisaoFechadaContada.jaContada, true);
  });
});

// Ronda 1 da T4: --arquivo de um arquivo sem base, com pasta plana de OUTRO arquivo, apurava a
// plana calado e podia contar o fecho dela como o do arquivo pedido.
test('T4/r1: --arquivo sem base e com pasta plana de outro arquivo para com erro que nomeia os dois', () => {
  comRepo((cwd, tmp) => {
    gravarMapa(cwd, 1, { A: 'trabalho', B: 'HEAD' });
    gravarRonda(cwd, 1, [SECO]);
    gravarMapa(cwd, 2, { A: 'trabalho', B: 'HEAD' });
    gravarRonda(cwd, 2, [SECO]);
    const r = rodar(['--sessao', 'outro', '--arquivo', 'src/b.js'], cwd, tmp);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.strictEqual(r.json, null, 'sem apuracao: ' + r.stdout);
    assert.ok(r.stdout.includes('src/a.js') && r.stdout.includes('src/b.js'), r.stdout);
    assert.strictEqual(contadorDe(tmp, 'outro'), 0, 'nao apurou, nao conta');
  });
});

test('T4/r1: --arquivo sem revisao nenhuma diz como prepara-la', () => {
  comRepo((cwd, tmp) => {
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 1, [SECO]);
    const r = rodar(['--sessao', 'sem', '--arquivo', 'src/x.js'], cwd, tmp);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.ok(r.stdout.includes('preparar-revisao.js --arquivo src/x.js'), r.stdout);
  });
});

// Ronda 1 da T4: o fechada.json era gravado ANTES de contar. Se a contagem falhava, a reapuracao
// dizia "ja contada" sem nunca ter contado. Agora fechada.json existir quer dizer que contou.
test('T4/r1: se a contagem do fecho falha, fechada.json nao e gravado e a saida diz o que fazer', () => {
  comRepo((cwd, tmp) => {
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 1, [SECO]);
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 2, [SECO]);
    const arquivoNoLugarDaPasta = path.join(tmp, 'nao-e-pasta');
    fs.writeFileSync(arquivoNoLugarDaPasta, 'x', 'utf8');
    const r = rodar(['--sessao', 'falha'], cwd, arquivoNoLugarDaPasta);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.ok(r.stdout.startsWith('ERRO:'), r.stdout);
    assert.match(r.stdout, /de novo/);
    assert.strictEqual(fs.existsSync(path.join(cwd, '.claude', 'sworn', 'revisao', 'src__a.js', 'fechada.json')), false);
  });
});

test('T4/r1: fechada.json ilegivel para com erro em vez de contar o fecho outra vez', () => {
  comRepo((cwd, tmp) => {
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 1, [SECO]);
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 2, [SECO]);
    fs.writeFileSync(path.join(cwd, '.claude', 'sworn', 'revisao', 'src__a.js', 'fechada.json'), '{ "ronda": ', 'utf8');
    const r = rodar(['--sessao', 'trunc'], cwd, tmp);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.ok(r.stdout.includes('fechada.json'), r.stdout);
    assert.strictEqual(contadorDe(tmp, 'trunc'), 0, 'nao conta de novo');
  });
});

// Ronda 2 da T4.
test('T4/r2: pasta plana sem mapa.json nao aceita --arquivo calada', () => {
  comRepo((cwd, tmp) => {
    gravarRonda(cwd, 1, [SECO]);
    gravarRonda(cwd, 2, [SECO]);
    const r = rodar(['--sessao', 'semmapa', '--arquivo', 'src/b.js'], cwd, tmp);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.ok(r.stdout.includes('nao diz de qual arquivo') && r.stdout.includes('sem --arquivo'), r.stdout);
    assert.strictEqual(contadorDe(tmp, 'semmapa'), 0, 'nao apurou, nao conta');
  });
});

test('T4/r2: se fechada.json nao se grava depois de contar, a saida diz que o fecho ja foi contado', () => {
  comRepo((cwd, tmp) => {
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 1, [SECO]);
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 2, [SECO]);
    const preload = path.join(tmp, 'falha-fechada.js');
    fs.writeFileSync(preload, "const fs = require('fs'); const w = fs.writeFileSync;\n" +
      "fs.writeFileSync = function (p) { if (String(p).endsWith('fechada.json')) throw new Error('EACCES simulado'); " +
      'return w.apply(this, arguments); };\n', 'utf8');
    // No NODE_OPTIONS entre aspas a barra invertida vira escape: o caminho vai com barra normal.
    const r = rodar(['--sessao', 'grava'], cwd, tmp, { NODE_OPTIONS: '--require "' + preload.split(path.sep).join('/') + '"' });
    assert.strictEqual(r.status, 1, r.stdout);
    assert.ok(r.stdout.startsWith('ERRO:'), r.stdout);
    assert.match(r.stdout, /fecho foi contado/);
    assert.strictEqual(contadorDe(tmp, 'grava'), 1, 'contou uma vez, e a saida diz isso');
  });
});

test('T4/r2: --arquivo sem caminho para com erro em vez de apurar sem filtro', () => {
  comRepo((cwd, tmp) => {
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 1, [SECO]);
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 2, [SECO]);
    const r = rodar(['--sessao', 'vazio', '--arquivo'], cwd, tmp);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.match(r.stdout, /--arquivo sem caminho/);
    assert.strictEqual(contadorDe(tmp, 'vazio'), 0, 'nao apurou, nao conta');
    const r2 = rodar(['--arquivo', '--sessao', 'vazio'], cwd, tmp);
    assert.strictEqual(r2.status, 1, r2.stdout);
    assert.match(r2.stdout, /--arquivo sem caminho/);
  });
});

test('T4/r2: erro de leitura que nao e pasta ausente sai com a causa, e nao como "nao ha revisao"', () => {
  comRepo((cwd, tmp) => {
    fs.mkdirSync(path.join(cwd, '.claude', 'sworn', 'revisao'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.claude', 'sworn', 'revisao', 'src__x.js'), 'nao e pasta', 'utf8');
    const r = rodar(['--sessao', 'enotdir', '--arquivo', 'src/x.js'], cwd, tmp);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.ok(!r.stdout.includes('nao ha revisao'), r.stdout);
    assert.match(r.stdout, /ENOTDIR/);
  });
});

test('T4/r2: sem revisao nenhuma, o erro diz como preparar uma', () => {
  comRepo((cwd, tmp) => {
    fs.mkdirSync(path.join(cwd, '.claude', 'sworn', 'revisao'), { recursive: true });
    const r = rodar(['--sessao', 'nada'], cwd, tmp);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.match(r.stdout, /nao ha revisao/);
    assert.ok(r.stdout.includes('preparar-revisao.js --arquivo'), r.stdout);
  });
});

// ---------------------------------------------------------------------------------------------
// 0.3.2 (frente sworn-p2-d258), T1: itens 2, 3, 4, 6 e 7 do apurar-ronda.js. O item 1 e o 5 sao
// a remocao de um catch que nada alcancava: nao ha comportamento novo para prender.
// ---------------------------------------------------------------------------------------------

function baseFechada(cwd) {
  gravarNaBase(cwd, 'src__a.js', 'src/a.js', 1, [SECO]);
  gravarNaBase(cwd, 'src__a.js', 'src/a.js', 2, [SECO]);
  return path.join(cwd, '.claude', 'sworn', 'revisao', 'src__a.js');
}

/** O estado da sessao que --sessao/ambiente aponta: nada pode ter sido escrito em SWORN_TMP. */
function nadaGravadoEm(tmp) {
  return !fs.existsSync(path.join(tmp, 'sworn')) || fs.readdirSync(path.join(tmp, 'sworn')).length === 0;
}

test('0.3.2/item 2: sessao fora de [a-zA-Z0-9_-] para com erro, sem contar e sem gravar fechada.json', () => {
  comRepo((cwd, tmp) => {
    const base = baseFechada(cwd);
    for (const ruim of ['a/b', '..\\x', 'com espaco', 'a.b']) {
      const r = rodar(['--sessao', ruim], cwd, tmp);
      assert.strictEqual(r.status, 1, '"' + ruim + '" nao pode sair 0: ' + r.stdout);
      assert.ok(r.stdout.startsWith('ERRO:'), r.stdout);
      assert.ok(r.stdout.includes('--sessao') && r.stdout.includes(ruim), 'diz de onde veio e o valor: ' + r.stdout);
      assert.ok(/letras/.test(r.stdout), 'diz a forma aceita: ' + r.stdout);
      assert.strictEqual(r.json, null, 'sem apuracao: ' + r.stdout);
      assert.strictEqual(fs.existsSync(path.join(base, 'fechada.json')), false, 'nao grava o fecho');
      assert.ok(nadaGravadoEm(tmp), 'nao conta em sessao nenhuma');
    }
    const env = rodar([], cwd, tmp, { CLAUDE_CODE_SESSION_ID: 'da env' });
    assert.strictEqual(env.status, 1, env.stdout);
    assert.ok(env.stdout.includes('CLAUDE_CODE_SESSION_ID'), 'o valor do ambiente diz que veio do ambiente: ' + env.stdout);
    assert.strictEqual(fs.existsSync(path.join(base, 'fechada.json')), false);
    assert.ok(nadaGravadoEm(tmp));
  });
});

test('0.3.2/item 3: --sessao sem valor para com erro, mesmo com o ambiente e mesmo sem revisao fechada', () => {
  comRepo((cwd, tmp) => {
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 1, [P1_NOVO]);
    const casos = [['--sessao'], ['--sessao', '--arquivo', 'src/a.js'], ['--arquivo', 'src/a.js', '--sessao']];
    for (const args of casos) {
      const r = rodar(args, cwd, tmp, { CLAUDE_CODE_SESSION_ID: 'da-env' });
      assert.strictEqual(r.status, 1, args.join(' ') + ' nao pode sair 0: ' + r.stdout);
      assert.match(r.stdout, /--sessao sem valor/);
      assert.strictEqual(r.json, null, 'sem apuracao: ' + r.stdout);
    }
  });
  comRepo((cwd, tmp) => {
    const vazio = rodar(['--sessao'], cwd, tmp);
    assert.strictEqual(vazio.status, 1, vazio.stdout);
    assert.match(vazio.stdout, /--sessao sem valor/, 'o erro nao espera a base: ' + vazio.stdout);
  });
});

test('0.3.2/item 4: refutados.json ilegivel cita o caminho da base e diz o que fazer', () => {
  comRepo((cwd, tmp) => {
    baseFechada(cwd);
    fs.writeFileSync(path.join(cwd, '.claude', 'sworn', 'revisao', 'src__a.js', 'refutados.json'), '[ { "ronda": ', 'utf8');
    const r = rodar(['--sessao', 'refile'], cwd, tmp);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.strictEqual(r.json, null, r.stdout);
    assert.ok(r.stdout.includes('.claude/sworn/revisao/src__a.js/refutados.json'), 'cita o caminho: ' + r.stdout);
    assert.ok(/corrija/i.test(r.stdout) && /apague/i.test(r.stdout), 'diz o que fazer: ' + r.stdout);
    assert.match(r.stdout, /de novo/);
    assert.strictEqual(contadorDe(tmp, 'refile'), 0, 'nao apurou, nao conta');
  });
});

test('0.3.2/item 6: fechada.json que se le mas nao tem "ronda" inteira para com erro, sem recontar', () => {
  comRepo((cwd, tmp) => {
    const base = baseFechada(cwd);
    const arq = path.join(base, 'fechada.json');
    for (const conteudo of ['{}', '5', '[]', 'null', '{"ronda":"2"}', '{"ronda":2.5}']) {
      fs.writeFileSync(arq, conteudo, 'utf8');
      const r = rodar(['--sessao', 'forma'], cwd, tmp);
      assert.strictEqual(r.status, 1, conteudo + ' nao pode sair 0: ' + r.stdout);
      assert.ok(r.stdout.startsWith('ERRO:') && r.stdout.includes('fechada.json'), r.stdout);
      assert.ok(/apague/i.test(r.stdout) && /de novo/.test(r.stdout), 'diz o que fazer: ' + r.stdout);
      assert.strictEqual(r.json, null, r.stdout);
      assert.strictEqual(contadorDe(tmp, 'forma'), 0, conteudo + ' nao conta de novo');
      assert.strictEqual(fs.readFileSync(arq, 'utf8'), conteudo, 'o arquivo fica como estava');
    }
  });
});

test('0.3.2/item 7: o arquivo do mapa.json da pasta plana com barra invertida ou "./" ainda e o pedido', () => {
  comRepo((cwd, tmp) => {
    gravarRonda(cwd, 1, [SECO]);
    gravarRonda(cwd, 2, [SECO]);
    const mapa2 = path.join(cwd, '.claude', 'sworn', 'revisao', '2', 'mapa.json');
    gravarMapa(cwd, 1, { A: 'trabalho', B: 'HEAD' });
    for (const grafia of ['src\\a.js', './src/a.js', '.\\src\\a.js']) {
      fs.writeFileSync(mapa2, JSON.stringify({ arquivo: grafia, mapa: { A: 'trabalho', B: 'HEAD' } }), 'utf8');
      const r = rodar(['--sessao', 'grafia-' + grafia.length, '--arquivo', 'src/a.js'], cwd, tmp);
      assert.strictEqual(r.status, 0, '"' + grafia + '" e o mesmo arquivo: ' + r.stdout);
      assert.strictEqual(r.json.encerrar, true);
      const outro = rodar(['--sessao', 'outro-' + grafia.length, '--arquivo', 'src/b.js'], cwd, tmp);
      assert.strictEqual(outro.status, 1, 'outro arquivo segue recusado: ' + outro.stdout);
      assert.ok(outro.stdout.includes('nao de src/b.js'), outro.stdout);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 0.3.3 (frente sworn-033), T1: defeito 1 e itens 3 a 8 do apurar-ronda.js.
// ---------------------------------------------------------------------------------------------

const REL_BASE = '.claude/sworn/revisao/src__a.js';

// Defeito 1: o readdir dos vereditos zerava em qualquer erro, e a ronda sem voto contava como seca:
// duas pastas sem veredito nenhum fechavam aprovado, placar 0/0/0.
test('0.3.3/item 1: ronda sem veredito (pasta ausente, vazia ou sem .json) para com erro que cita a pasta', () => {
  comRepo((cwd, tmp) => {
    const base = baseFechada(cwd);
    const dir2 = path.join(base, '2', 'vereditos');
    const guardado = fs.readFileSync(path.join(dir2, 'correcao.json'), 'utf8');
    const casos = {
      ausente: () => {},
      vazia: () => fs.mkdirSync(dir2),
      'so com outro tipo de arquivo': () => { fs.mkdirSync(dir2); fs.writeFileSync(path.join(dir2, 'nota.txt'), 'x', 'utf8'); }
    };
    for (const [nome, monta] of Object.entries(casos)) {
      fs.rmSync(dir2, { recursive: true, force: true });
      monta();
      const r = rodar(['--sessao', 'sem-voto'], cwd, tmp);
      assert.strictEqual(r.status, 1, nome + ' nao pode sair 0: ' + r.stdout);
      assert.ok(r.stdout.startsWith('ERRO:'), r.stdout);
      assert.ok(r.stdout.includes(REL_BASE + '/2/vereditos/'), nome + ': cita a pasta da ronda: ' + r.stdout);
      assert.ok(!r.stdout.includes(REL_BASE + '/1/vereditos/'), nome + ': so a ronda que falta: ' + r.stdout);
      assert.ok(/Passo 2 do \/sworn:review/.test(r.stdout) && /apague/i.test(r.stdout) && /de novo/.test(r.stdout),
        nome + ': diz o que fazer: ' + r.stdout);
      assert.strictEqual(r.json, null, 'sem apuracao: ' + r.stdout);
      assert.strictEqual(fs.existsSync(path.join(base, 'fechada.json')), false, 'nao grava o fecho');
      assert.ok(nadaGravadoEm(tmp), 'nao conta em sessao nenhuma');
    }
    // as duas rondas sem voto: o caso que fechava aprovado. Cada ronda sai citada.
    fs.rmSync(path.join(base, '1', 'vereditos'), { recursive: true, force: true });
    const duas = rodar(['--sessao', 'sem-voto'], cwd, tmp);
    assert.strictEqual(duas.status, 1, duas.stdout);
    assert.ok(duas.stdout.includes(REL_BASE + '/1/vereditos/') && duas.stdout.includes(REL_BASE + '/2/vereditos/'), duas.stdout);
    assert.ok(nadaGravadoEm(tmp));
    // controle: com os vereditos de volta, a mesma base fecha
    fs.mkdirSync(dir2, { recursive: true });
    fs.writeFileSync(path.join(dir2, 'correcao.json'), guardado, 'utf8');
    fs.mkdirSync(path.join(base, '1', 'vereditos'), { recursive: true });
    fs.writeFileSync(path.join(base, '1', 'vereditos', 'correcao.json'), guardado, 'utf8');
    const ok = rodar(['--sessao', 'sem-voto'], cwd, tmp);
    assert.strictEqual(ok.status, 0, ok.stdout);
    assert.strictEqual(ok.json.encerrar, true);
  });
});

test('0.3.3/item 1: no formato antigo a ronda sem veredito tambem para, e pasta que nao se le sai com a causa', () => {
  comRepo((cwd, tmp) => {
    gravarRonda(cwd, 1, [SECO]);
    gravarRonda(cwd, 2, [SECO]);
    const dir2 = path.join(cwd, '.claude', 'sworn', 'revisao', '2', 'vereditos');
    fs.rmSync(dir2, { recursive: true, force: true });
    const r = rodar(['--sessao', 'ant-vazio'], cwd, tmp);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.ok(r.stdout.includes('.claude/sworn/revisao/2/vereditos/'), r.stdout);
    assert.ok(nadaGravadoEm(tmp));
    // vereditos que e arquivo, e nao pasta: nao e "ausente", e a causa do erro de leitura vai na mensagem
    fs.writeFileSync(dir2, 'nao e pasta', 'utf8');
    const e = rodar(['--sessao', 'ant-vazio'], cwd, tmp);
    assert.strictEqual(e.status, 1, e.stdout);
    assert.ok(e.stdout.includes('.claude/sworn/revisao/2/vereditos/') && /ENOTDIR/.test(e.stdout), e.stdout);
    assert.ok(!/Passo 2/.test(e.stdout), 'nao e o caso da pasta ausente: ' + e.stdout);
    assert.ok(nadaGravadoEm(tmp));
  });
});

// Item 3: o refutados.json que se le mas nao e lista virava [] calado, e a refutacao que faltava sumia.
test('0.3.3/item 3: refutados.json que se le mas nao e lista para com erro que cita o arquivo e a forma', () => {
  comRepo((cwd, tmp) => {
    const base = baseFechada(cwd);
    for (const conteudo of ['{}', '5', 'null', '"x"', '{"ronda":1,"prova":"x"}', 'true']) {
      fs.writeFileSync(path.join(base, 'refutados.json'), conteudo, 'utf8');
      const r = rodar(['--sessao', 'ref-forma'], cwd, tmp);
      assert.strictEqual(r.status, 1, conteudo + ' nao pode sair 0: ' + r.stdout);
      assert.ok(r.stdout.startsWith('ERRO:'), r.stdout);
      assert.ok(r.stdout.includes(REL_BASE + '/refutados.json'), 'cita o arquivo: ' + r.stdout);
      assert.ok(r.stdout.includes('[]') && /lista/.test(r.stdout), 'diz a forma: ' + r.stdout);
      assert.strictEqual(r.json, null, r.stdout);
      assert.strictEqual(fs.existsSync(path.join(base, 'fechada.json')), false);
      assert.ok(nadaGravadoEm(tmp), conteudo + ' nao conta');
    }
    // controle: [] e a forma de "sem refutacao" e segue valendo
    fs.writeFileSync(path.join(base, 'refutados.json'), '[]', 'utf8');
    const ok = rodar(['--sessao', 'ref-forma'], cwd, tmp);
    assert.strictEqual(ok.status, 0, ok.stdout);
    assert.deepStrictEqual(ok.json.refutados, []);
  });
});

// Item 4: o valor do AMBIENTE so se valida quando vai ser usado (a revisao fecha e o fecho nao foi contado).
test('0.3.3/item 4: CLAUDE_CODE_SESSION_ID invalido nao para a ronda que nao fecha nem o fecho ja contado', () => {
  comRepo((cwd, tmp) => {
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 1, [P1_NOVO]);
    const r = rodar([], cwd, tmp, { CLAUDE_CODE_SESSION_ID: 'com espaco' });
    assert.strictEqual(r.status, 0, 'ronda que nao fecha nao usa a sessao: ' + r.stdout);
    assert.strictEqual(r.json.encerrar, false);
    assert.strictEqual(r.json.revisaoFechadaContada, null);
    // o --sessao e entrada de quem roda: segue validado no topo, fechando ou nao
    const s = rodar(['--sessao', 'a/b'], cwd, tmp, { CLAUDE_CODE_SESSION_ID: 'da-env' });
    assert.strictEqual(s.status, 1, s.stdout);
    assert.match(s.stdout, /--sessao/);
    assert.strictEqual(s.json, null, s.stdout);
  });
  comRepo((cwd, tmp) => {
    baseFechada(cwd);
    assert.strictEqual(rodar(['--sessao', 'boa'], cwd, tmp).status, 0);
    const j = rodar([], cwd, tmp, { CLAUDE_CODE_SESSION_ID: 'com espaco' });
    assert.strictEqual(j.status, 0, 'fecho ja contado nao usa a sessao: ' + j.stdout);
    assert.strictEqual(j.json.revisaoFechadaContada.jaContada, true);
  });
});

// Item 5: a mesma grafia de arquivo. `a/../b` se normaliza; grafia que so difere na caixa e o mesmo
// arquivo SE o disco disser (mesmo dev+ino), sem olhar a plataforma.
function trocaMapaDaRonda2(cwd, arquivo) {
  fs.writeFileSync(path.join(cwd, '.claude', 'sworn', 'revisao', '2', 'mapa.json'),
    JSON.stringify({ arquivo: arquivo, mapa: { A: 'trabalho', B: 'HEAD' } }), 'utf8');
}

test('0.3.3/item 5: o arquivo do mapa.json com "../" no meio do caminho ainda e o pedido', () => {
  comRepo((cwd, tmp) => {
    gravarRonda(cwd, 1, [SECO]);
    gravarRonda(cwd, 2, [SECO]);
    gravarMapa(cwd, 1, { A: 'trabalho', B: 'HEAD' });
    for (const grafia of ['src/../src/a.js', 'src\\..\\src\\a.js', './src/x/../a.js']) {
      trocaMapaDaRonda2(cwd, grafia);
      const r = rodar(['--sessao', 'norm', '--arquivo', 'src/a.js'], cwd, tmp);
      assert.strictEqual(r.status, 0, '"' + grafia + '" e o mesmo arquivo: ' + r.stdout);
      assert.strictEqual(r.json.encerrar, true);
    }
    // controle: normalizar nao junta arquivos diferentes
    trocaMapaDaRonda2(cwd, 'src/../src/b.js');
    const outro = rodar(['--sessao', 'norm2', '--arquivo', 'src/a.js'], cwd, tmp);
    assert.strictEqual(outro.status, 1, outro.stdout);
    assert.ok(outro.stdout.includes('nao de src/a.js'), outro.stdout);
  });
});

/**
 * Preload que faz o disco "dizer" o dev+ino dos dois nomes: mesmo arquivo, ou (INO_DIFERENTE) arquivos
 * distintos. F2-13: ZERO=ino ou ZERO=dev faz o disco dizer 0 nesse campo (sistema de arquivos que nao o preenche).
 */
function preloadDoDisco() {
  const fs = require('fs');
  const original = fs.statSync;
  fs.statSync = function (p) {
    const q = String(p).split('\\').join('/');
    if (/\/(src\/a\.js|SRC\/A\.JS)$/.test(q)) {
      return { dev: process.env.ZERO === 'dev' ? 0n : 1n,
        ino: process.env.ZERO === 'ino' ? 0n : ((process.env.INO_DIFERENTE && /SRC/.test(q)) ? 9n : 5n) };
    }
    return original.apply(this, arguments);
  };
}

test('0.3.3/item 5: grafia que so difere na caixa e o mesmo arquivo se o disco disser (mesmo dev e ino)', () => {
  comRepo((cwd, tmp) => {
    gravarRonda(cwd, 1, [SECO]);
    gravarRonda(cwd, 2, [SECO]);
    gravarMapa(cwd, 1, { A: 'trabalho', B: 'HEAD' });
    const preload = path.join(tmp, 'disco.js');
    fs.writeFileSync(preload, '(' + preloadDoDisco.toString() + ')();\n', 'utf8');
    const opcoes = '--require "' + preload.split(path.sep).join('/') + '"';
    trocaMapaDaRonda2(cwd, 'SRC/A.JS');
    const igual = rodar(['--sessao', 'caixa', '--arquivo', 'src/a.js'], cwd, tmp, { NODE_OPTIONS: opcoes });
    assert.strictEqual(igual.status, 0, 'o disco diz que e o mesmo: ' + igual.stdout);
    assert.strictEqual(igual.json.encerrar, true);
    // o disco diz que sao dois arquivos: a caixa sozinha nao junta
    const distintos = rodar(['--sessao', 'caixa2', '--arquivo', 'src/a.js'], cwd, tmp,
      { NODE_OPTIONS: opcoes, INO_DIFERENTE: '1' });
    assert.strictEqual(distintos.status, 1, distintos.stdout);
    assert.ok(distintos.stdout.includes('nao de src/a.js'), distintos.stdout);
    // sem o disco confirmar (nenhum dos dois existe), a caixa sozinha tambem nao junta
    trocaMapaDaRonda2(cwd, 'SRC/X.JS');
    const inexistente = rodar(['--sessao', 'caixa3', '--arquivo', 'src/x.js'], cwd, tmp, { NODE_OPTIONS: opcoes });
    assert.strictEqual(inexistente.status, 1, inexistente.stdout);
  });
});

test('0.3.3/item 5: no disco real, a caixa diferente so junta se o sistema de arquivos a trata como a mesma', () => {
  comRepo((cwd, tmp) => {
    gravarRonda(cwd, 1, [SECO]);
    gravarRonda(cwd, 2, [SECO]);
    gravarMapa(cwd, 1, { A: 'trabalho', B: 'HEAD' });
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src', 'a.js'), 'x', 'utf8');
    trocaMapaDaRonda2(cwd, 'SRC/A.JS');
    const insensivel = fs.existsSync(path.join(cwd, 'SRC', 'A.JS'));
    const r = rodar(['--sessao', 'real', '--arquivo', 'src/a.js'], cwd, tmp);
    assert.strictEqual(r.status, insensivel ? 0 : 1,
      (insensivel ? 'disco insensivel a caixa: mesmo arquivo. ' : 'disco sensivel a caixa: outro nome. ') + r.stdout);
  });
});

// Item 6: mapa.json ausente (pacote antigo) segue sem mapa; presente e corrompido virava "sem mapa" calado
// e a ronda contava pelos dois lados.
test('0.3.3/item 6: mapa.json presente e corrompido para com erro que cita o arquivo; ausente segue = pacote antigo', () => {
  comRepo((cwd, tmp) => {
    const base = baseFechada(cwd);
    const mapa2 = path.join(base, '2', 'mapa.json');
    const ruins = ['{ "arquivo": ', '[]', '5', 'null', '"x"', '{"arquivo":"src/a.js"}',
      '{"arquivo":"src/a.js","mapa":5}', '{"arquivo":"src/a.js","mapa":[]}', '{"arquivo":"src/a.js","mapa":null}'];
    for (const conteudo of ruins) {
      fs.writeFileSync(mapa2, conteudo, 'utf8');
      const r = rodar(['--sessao', 'mapa'], cwd, tmp);
      assert.strictEqual(r.status, 1, conteudo + ' nao pode sair 0: ' + r.stdout);
      assert.ok(r.stdout.startsWith('ERRO:'), r.stdout);
      assert.ok(r.stdout.includes(REL_BASE + '/2/mapa.json'), 'cita o arquivo: ' + r.stdout);
      assert.ok(/prepare a ronda de novo/i.test(r.stdout), 'diz o que fazer: ' + r.stdout);
      assert.strictEqual(r.json, null, r.stdout);
      assert.strictEqual(fs.existsSync(path.join(base, 'fechada.json')), false);
      assert.ok(nadaGravadoEm(tmp), conteudo + ' nao conta');
    }
    // ausente (ENOENT) segue como pacote antigo: conta pelos dois lados e a saida diz a ronda
    fs.rmSync(mapa2);
    const ok = rodar(['--sessao', 'mapa'], cwd, tmp);
    assert.strictEqual(ok.status, 0, ok.stdout);
    assert.deepStrictEqual(ok.json.rondasSemMapa, [2]);
    assert.strictEqual(ok.json.encerrar, true);
  });
  // o arquivoDaBase tambem le o mapa.json: pasta plana com --arquivo
  comRepo((cwd, tmp) => {
    gravarRonda(cwd, 1, [SECO]);
    gravarRonda(cwd, 2, [SECO]);
    fs.writeFileSync(path.join(cwd, '.claude', 'sworn', 'revisao', '2', 'mapa.json'), '{ "arquivo": ', 'utf8');
    const r = rodar(['--sessao', 'mapa-plana', '--arquivo', 'src/a.js'], cwd, tmp);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.ok(r.stdout.includes('.claude/sworn/revisao/2/mapa.json'), r.stdout);
    assert.ok(nadaGravadoEm(tmp));
  });
});

// Item 7: o erro do apurar dizia o defeito da refutacao e parava ali.
test('0.3.3/item 7: refutacao invalida cita o arquivo da base e diz o que corrigir', () => {
  comRepo((cwd, tmp) => {
    const base = baseFechada(cwd);
    const refs = [
      [{ ronda: 1, lente: 'correcao', arquivo: 'A.txt', linha: 3, severidade: 'P1' }, /prova/],
      [{ ronda: 1, lente: 'correcao', arquivo: 'mapa.json', linha: 3, severidade: 'P1', prova: 'x.js:1' }, /A\.txt ou B\.txt/]
    ];
    for (const [ref, defeito] of refs) {
      fs.writeFileSync(path.join(base, 'refutados.json'), JSON.stringify([ref]), 'utf8');
      const r = rodar(['--sessao', 'ref-prox'], cwd, tmp);
      assert.strictEqual(r.status, 1, r.stdout);
      assert.ok(r.stdout.startsWith('ERRO:') && defeito.test(r.stdout), 'segue dizendo o defeito: ' + r.stdout);
      assert.ok(r.stdout.includes(REL_BASE + '/refutados.json'), 'cita o arquivo a corrigir: ' + r.stdout);
      assert.ok(/corrija a refutacao/i.test(r.stdout) && /de novo/.test(r.stdout), 'diz o proximo passo: ' + r.stdout);
      assert.strictEqual(r.json, null, r.stdout);
      assert.ok(nadaGravadoEm(tmp));
    }
  });
});

// Item 8: sem --sessao e sem ambiente o fecho conta em "sem-sessao", e ninguem le esse contador.
test('0.3.3/item 8: fecho sem sessao avisa que nao entrou no contador de nenhuma sessao, sem mandar rodar de novo', () => {
  comRepo((cwd, tmp) => {
    const base = baseFechada(cwd);
    const r = rodar([], cwd, tmp);
    assert.strictEqual(r.status, 0, r.stdout);
    assert.strictEqual(r.json.revisaoFechadaContada.sessao, 'sem-sessao');
    const aviso = r.json.revisaoFechadaContada.aviso;
    assert.strictEqual(typeof aviso, 'string', 'o fecho traz o aviso: ' + r.stdout);
    assert.ok(/nenhuma sessao/.test(aviso) && aviso.includes('--sessao <id>'), 'diz o que passar da proxima vez: ' + aviso);
    assert.ok(aviso.includes(REL_BASE + '/fechada.json'), 'diz que o fecho ja esta registrado: ' + aviso);
    assert.ok(!/de novo|outra vez|repita|rode/i.test(aviso), 'rodar de novo nao recontaria: nao pode mandar: ' + aviso);
    assert.ok(fs.existsSync(path.join(base, 'fechada.json')), 'o fecho foi registrado');
    // rodar de novo nao recontou e nao traz o aviso (o fecho ja foi contado)
    const de2 = rodar([], cwd, tmp);
    assert.strictEqual(de2.json.revisaoFechadaContada.jaContada, true);
    assert.strictEqual(de2.json.revisaoFechadaContada.aviso, undefined);
  });
  // com --sessao (ou ambiente) nao ha aviso
  comRepo((cwd, tmp) => {
    baseFechada(cwd);
    const r = rodar(['--sessao', 'certa'], cwd, tmp);
    assert.strictEqual(r.json.revisaoFechadaContada.aviso, undefined, JSON.stringify(r.json.revisaoFechadaContada));
  });
  comRepo((cwd, tmp) => {
    baseFechada(cwd);
    const r = rodar([], cwd, tmp, { CLAUDE_CODE_SESSION_ID: 'do-ambiente' });
    assert.strictEqual(r.json.revisaoFechadaContada.aviso, undefined, JSON.stringify(r.json.revisaoFechadaContada));
  });
});

// ---------------------------------------------------------------------------------------------
// Frente sworn-pendencias, T2 do plano dos 82: F2-01, F2-06, F2-13 e F3-22 do apurar-ronda.js.
// ---------------------------------------------------------------------------------------------

test('T2/F2-01: valor que comeca com "--" so e "sem valor" quando e flag do uso (--sessao, --arquivo)', () => {
  comRepo((cwd, tmp) => {
    // um arquivo chamado --x.js e um caminho valido para --arquivo
    gravarNaBase(cwd, '--x.js', '--x.js', 1, [SECO]);
    gravarNaBase(cwd, '--x.js', '--x.js', 2, [SECO]);
    const r = rodar(['--sessao', 'f201', '--arquivo', '--x.js'], cwd, tmp);
    assert.strictEqual(r.status, 0, '--arquivo --x.js e o caminho --x.js: ' + r.stdout);
    assert.strictEqual(r.json.arquivo, '--x.js');
    // --sessao seguido de algo que nao e flag do uso: esse e o valor (a classe do id decide o resto)
    const s = rodar(['--sessao', '--x', '--arquivo', '--x.js'], cwd, tmp);
    assert.doesNotMatch(s.stdout, /sem valor|sem caminho/, '--sessao --x nao e flag sem valor: ' + s.stdout);
    // controle: flag do USO no lugar do valor, e valor vazio, seguem "sem valor"
    const a = rodar(['--arquivo', '--sessao', 'f201'], cwd, tmp);
    assert.strictEqual(a.status, 1, a.stdout);
    assert.match(a.stdout, /--arquivo sem caminho/);
    const b = rodar(['--sessao', '--arquivo', '--x.js'], cwd, tmp);
    assert.strictEqual(b.status, 1, b.stdout);
    assert.match(b.stdout, /--sessao sem valor/);
    const c = rodar(['--arquivo', ''], cwd, tmp);
    assert.strictEqual(c.status, 1, c.stdout);
    assert.match(c.stdout, /--arquivo sem caminho/);
    const d = rodar(['--sessao', ''], cwd, tmp);
    assert.strictEqual(d.status, 1, d.stdout);
    assert.match(d.stdout, /--sessao sem valor/);
  });
});

test('T2/F2-06: na lista de "ha N revisoes", base com mapa.json ruim sai como "(mapa ilegivel)" na linha dela', () => {
  comRepo((cwd, tmp) => {
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 1, [SECO]);
    gravarNaBase(cwd, 'src__b.js', 'src/b.js', 1, [SECO]);
    const mapaB = path.join(cwd, '.claude', 'sworn', 'revisao', 'src__b.js', '1', 'mapa.json');
    fs.writeFileSync(mapaB, '{ "arquivo": ', 'utf8');
    const r = rodar(['--sessao', 'f206'], cwd, tmp);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.ok(r.stdout.startsWith('ERRO: ha 2 revisoes'), 'a lista sai inteira, sem o ERRO do mapa: ' + r.stdout);
    assert.ok(r.stdout.includes('\n  src/a.js\n'), 'a base boa segue pelo arquivo do mapa: ' + r.stdout);
    assert.ok(r.stdout.includes('\n  src__b.js (mapa ilegivel)\n'), 'a base ruim diz o nome da pasta e o motivo: ' + r.stdout);
    assert.ok(!/esta corrompido/.test(r.stdout), r.stdout);
    assert.strictEqual(r.json, null, r.stdout);
    assert.ok(nadaGravadoEm(tmp));
    // controle: fora da listagem o mapa ruim segue parando, citando o arquivo
    const c = rodar(['--sessao', 'f206', '--arquivo', 'src/b.js'], cwd, tmp);
    assert.strictEqual(c.status, 1, c.stdout);
    assert.ok(c.stdout.startsWith('ERRO: ') && c.stdout.includes('src__b.js/1/mapa.json esta corrompido'), c.stdout);
  });
});

test('T2/F2-13: dev ou ino 0 no disco nao confirma que dois nomes de caixa diferente sejam o mesmo arquivo', () => {
  comRepo((cwd, tmp) => {
    gravarRonda(cwd, 1, [SECO]);
    gravarRonda(cwd, 2, [SECO]);
    gravarMapa(cwd, 1, { A: 'trabalho', B: 'HEAD' });
    const preload = path.join(tmp, 'disco.js');
    fs.writeFileSync(preload, '(' + preloadDoDisco.toString() + ')();\n', 'utf8');
    const opcoes = '--require "' + preload.split(path.sep).join('/') + '"';
    trocaMapaDaRonda2(cwd, 'SRC/A.JS');
    // controle: dev e ino iguais e diferentes de 0 seguem juntando
    const igual = rodar(['--sessao', 'f213', '--arquivo', 'src/a.js'], cwd, tmp, { NODE_OPTIONS: opcoes });
    assert.strictEqual(igual.status, 0, 'ino 5 igual junta: ' + igual.stdout);
    for (const zero of ['ino', 'dev']) {
      const r = rodar(['--sessao', 'f213-' + zero, '--arquivo', 'src/a.js'], cwd, tmp, { NODE_OPTIONS: opcoes, ZERO: zero });
      assert.strictEqual(r.status, 1, zero + ' 0 nao confirma nada: ' + r.stdout);
      assert.ok(r.stdout.includes('nao de src/a.js'), r.stdout);
    }
  });
});

// F3-22: a causa dos erros de leitura vem traduzida (texto.causaDoErro), nao o err.message cru do Node.
test('T2/F3-22: mapa.json que nao se le (e uma pasta) diz a causa traduzida', () => {
  comRepo((cwd, tmp) => {
    const base = baseFechada(cwd);
    const mapa2 = path.join(base, '2', 'mapa.json');
    fs.rmSync(mapa2);
    fs.mkdirSync(mapa2);
    const r = rodar(['--sessao', 'f322a'], cwd, tmp);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.ok(r.stdout.includes(REL_BASE + '/2/mapa.json esta corrompido (e uma pasta (EISDIR))'), r.stdout);
  });
});

test('T2/F3-22: pasta de revisao que nao se le (ENOTDIR) diz a causa traduzida', () => {
  comRepo((cwd, tmp) => {
    fs.mkdirSync(path.join(cwd, '.claude', 'sworn', 'revisao'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.claude', 'sworn', 'revisao', 'src__x.js'), 'nao e pasta', 'utf8');
    const r = rodar(['--sessao', 'f322b', '--arquivo', 'src/x.js'], cwd, tmp);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.ok(r.stdout.includes('(parte do caminho nao e uma pasta (ENOTDIR))'), r.stdout);
  });
});

test('T2/F3-22: pasta vereditos que nao se le (ENOTDIR) diz a causa traduzida', () => {
  comRepo((cwd, tmp) => {
    const base = baseFechada(cwd);
    const dir2 = path.join(base, '2', 'vereditos');
    fs.rmSync(dir2, { recursive: true, force: true });
    fs.writeFileSync(dir2, 'nao e pasta', 'utf8');
    const r = rodar(['--sessao', 'f322c'], cwd, tmp);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.ok(r.stdout.includes(REL_BASE + '/2/vereditos/ (parte do caminho nao e uma pasta (ENOTDIR))'), r.stdout);
  });
});

// ---------------------------------------------------------------------------------------------
// D387 (#11c): mesmos.json (resposta do juiz-mesmo). Tratado como o refutados.json; so alimenta
// provaveisMesmos, nunca a contagem.
// ---------------------------------------------------------------------------------------------

const K_NOVO = 'P1|trabalho|5|borda';
const K_VELHO = 'P2|trabalho|3|correcao';

/** Ronda 1: um P2 em A.txt:3. Ronda 2: um P1 novo em A.txt:5 (2 linhas de distancia: um par candidato). */
function baseComPar(cwd) {
  gravarNaBase(cwd, 'src__a.js', 'src/a.js', 1, [{ lente: 'correcao', melhor: 'A',
    achados: [{ estado: 'confirmado', trecho: 'x', severidade: 'P2', arquivo: 'A.txt', linha: 3, descricao: 'raiz' }] }]);
  gravarNaBase(cwd, 'src__a.js', 'src/a.js', 2, [{ lente: 'borda', melhor: 'A',
    achados: [{ estado: 'confirmado', trecho: 'x', severidade: 'P1', arquivo: 'A.txt', linha: 5, descricao: 'repete a raiz' }] }]);
  return path.join(cwd, '.claude', 'sworn', 'revisao', 'src__a.js');
}

test('D387/mesmos.json: ausente deixa a saida de hoje e acrescenta paresCandidatos e provaveisMesmos', () => {
  comRepo((cwd, tmp) => {
    baseComPar(cwd);
    const r = rodar(['--sessao', 'mz-aus'], cwd, tmp);
    assert.strictEqual(r.status, 0, r.stdout);
    assert.strictEqual(r.json.encerrar, false);
    assert.strictEqual(r.json.rondasSecas, 0);
    assert.strictEqual(r.json.achadosNovosP0P1.length, 1);
    assert.deepStrictEqual(r.json.paresCandidatos.map((p) => [p.novo.chave, p.outro.chave, p.distancia]), [[K_NOVO, K_VELHO, 2]]);
    assert.deepStrictEqual(r.json.provaveisMesmos, []);
  });
});

test('D387/mesmos.json: sem par candidato, os dois campos saem como lista vazia', () => {
  comRepo((cwd, tmp) => {
    baseFechada(cwd);
    const r = rodar(['--sessao', 'mz-vazio'], cwd, tmp);
    assert.strictEqual(r.status, 0, r.stdout);
    assert.deepStrictEqual(r.json.paresCandidatos, []);
    assert.deepStrictEqual(r.json.provaveisMesmos, []);
  });
});

test('D387/mesmos.json: com "sim" o aviso aparece e a contagem e a mesma de sem o arquivo', () => {
  comRepo((cwd, tmp) => {
    const base = baseComPar(cwd);
    const sem = rodar(['--sessao', 'mz-sem'], cwd, tmp);
    fs.writeFileSync(path.join(base, 'mesmos.json'), JSON.stringify([{ novo: K_NOVO, outro: K_VELHO, resposta: 'sim' }]), 'utf8');
    const com = rodar(['--sessao', 'mz-com'], cwd, tmp);
    assert.strictEqual(com.status, 0, com.stdout);
    assert.deepStrictEqual(com.json.provaveisMesmos, [{ chave: K_NOVO, mesmoQue: K_VELHO, lente: 'correcao', ronda: 1,
      texto: 'provavel mesmo defeito que ' + K_VELHO + ' (lente correcao, ronda 1)' }]);
    for (const campo of ['ronda', 'rondasSecas', 'encerrar', 'motivo', 'placarDaUltimaRonda', 'achadosNovosP0P1',
      'achadosDoLadoAntigo', 'refutados', 'paresCandidatos']) {
      assert.deepStrictEqual(com.json[campo], sem.json[campo], campo + ' muda com o mesmos.json');
    }
    assert.strictEqual(com.json.achadosNovosP0P1.length, 1, 'o achado novo segue molhando a ronda');
  });
});

test('D387/mesmos.json: "nao" e "nao-sei" nao geram aviso', () => {
  comRepo((cwd, tmp) => {
    const base = baseComPar(cwd);
    for (const resposta of ['nao', 'nao-sei']) {
      fs.writeFileSync(path.join(base, 'mesmos.json'), JSON.stringify([{ novo: K_NOVO, outro: K_VELHO, resposta }]), 'utf8');
      const r = rodar(['--sessao', 'mz-' + resposta], cwd, tmp);
      assert.strictEqual(r.status, 0, r.stdout);
      assert.deepStrictEqual(r.json.provaveisMesmos, []);
    }
  });
});

test('D387/mesmos.json: ilegivel para com erro que cita o caminho e diz o que fazer, sem contar', () => {
  comRepo((cwd, tmp) => {
    const base = baseFechada(cwd);
    fs.writeFileSync(path.join(base, 'mesmos.json'), '[ { "novo": ', 'utf8');
    const r = rodar(['--sessao', 'mz-ile'], cwd, tmp);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.strictEqual(r.json, null, r.stdout);
    assert.ok(r.stdout.startsWith('ERRO:'), r.stdout);
    assert.ok(r.stdout.includes(REL_BASE + '/mesmos.json ilegivel'), 'cita o caminho: ' + r.stdout);
    assert.ok(/corrija/i.test(r.stdout) && /apague/i.test(r.stdout) && /de novo/.test(r.stdout), 'diz o que fazer: ' + r.stdout);
    assert.strictEqual(fs.existsSync(path.join(base, 'fechada.json')), false);
    assert.ok(nadaGravadoEm(tmp), 'nao apurou, nao conta');
  });
});

test('D387/mesmos.json: o que se le mas nao e lista para com erro que cita o arquivo e a forma', () => {
  comRepo((cwd, tmp) => {
    const base = baseFechada(cwd);
    for (const conteudo of ['{}', '5', 'null', '"x"', 'true']) {
      fs.writeFileSync(path.join(base, 'mesmos.json'), conteudo, 'utf8');
      const r = rodar(['--sessao', 'mz-forma'], cwd, tmp);
      assert.strictEqual(r.status, 1, conteudo + ' nao pode sair 0: ' + r.stdout);
      assert.ok(r.stdout.startsWith('ERRO:'), r.stdout);
      assert.ok(r.stdout.includes(REL_BASE + '/mesmos.json nao e uma lista'), 'cita o arquivo: ' + r.stdout);
      assert.ok(r.stdout.includes('[]'), 'diz a forma: ' + r.stdout);
      assert.strictEqual(r.json, null, r.stdout);
      assert.ok(nadaGravadoEm(tmp), conteudo + ' nao conta');
    }
    // controle: [] e a forma de "o juiz nao achou par" e segue valendo
    fs.writeFileSync(path.join(base, 'mesmos.json'), '[]', 'utf8');
    const ok = rodar(['--sessao', 'mz-forma'], cwd, tmp);
    assert.strictEqual(ok.status, 0, ok.stdout);
    assert.deepStrictEqual(ok.json.provaveisMesmos, []);
  });
});

test('D387/mesmos.json: item fora da forma ou com chave que nao existe para com erro que cita o mesmos.json', () => {
  comRepo((cwd, tmp) => {
    const base = baseComPar(cwd);
    const ruins = [
      [{ novo: K_NOVO, outro: 'P1|trabalho|99|borda', resposta: 'sim' }],
      [{ novo: K_NOVO, outro: K_VELHO, resposta: 'talvez' }],
      ['x']
    ];
    for (const ruim of ruins) {
      fs.writeFileSync(path.join(base, 'mesmos.json'), JSON.stringify(ruim), 'utf8');
      const r = rodar(['--sessao', 'mz-item'], cwd, tmp);
      assert.strictEqual(r.status, 1, JSON.stringify(ruim) + ': ' + r.stdout);
      assert.ok(r.stdout.startsWith('ERRO:') && r.stdout.includes('mesmos.json'), r.stdout);
      assert.ok(r.stdout.includes('Corrija ' + REL_BASE + '/mesmos.json'), 'a 2a linha manda corrigir o mesmos.json: ' + r.stdout);
      assert.ok(!r.stdout.includes('refutados.json'), 'nao confunde com o refutados.json: ' + r.stdout);
      assert.ok(nadaGravadoEm(tmp));
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Lote 2 da D422: RV-04 (BOM do PowerShell 5.1), RV-03 (linha em texto) e RV-01 (arquivo igual ao HEAD).
// ---------------------------------------------------------------------------------------------

const BOM = '﻿';
function comBom(arquivo) {
  fs.writeFileSync(arquivo, BOM + fs.readFileSync(arquivo, 'utf8'), 'utf8');
  assert.strictEqual(fs.readFileSync(arquivo, 'utf8').charCodeAt(0), 0xFEFF, 'o fixture tem de comecar com BOM');
}

for (const alvo of ['2/vereditos/correcao.json', '2/mapa.json']) {
  test('RV-04: ' + alvo + ' gravado com BOM le normalmente (nao vira "ilegivel")', () => {
    comRepo((cwd, tmp) => {
      const base = baseFechada(cwd);
      comBom(path.join(base, ...alvo.split('/')));
      const r = rodar(['--sessao', 'rv04'], cwd, tmp);
      assert.strictEqual(r.status, 0, r.stdout);
      assert.strictEqual(r.json.encerrar, true, r.stdout);
    });
  });
}

test('RV-04: refutados.json com BOM le normalmente e a refutacao vale', () => {
  comRepo((cwd, tmp) => {
    const base = baseComPar(cwd);
    fs.writeFileSync(path.join(base, 'refutados.json'), JSON.stringify([{ ronda: 2, lente: 'borda', arquivo: 'A.txt',
      linha: 5, severidade: 'P1', prova: 'src/a.js:5 ja trata' }]), 'utf8');
    comBom(path.join(base, 'refutados.json'));
    const r = rodar(['--sessao', 'rv04-ref'], cwd, tmp);
    assert.strictEqual(r.status, 0, r.stdout);
    assert.strictEqual(r.json.achadosNovosP0P1.length, 0, 'a refutacao tem de valer: ' + r.stdout);
  });
});

test('RV-04: mesmos.json com BOM le normalmente e o aviso do juiz aparece', () => {
  comRepo((cwd, tmp) => {
    const base = baseComPar(cwd);
    fs.writeFileSync(path.join(base, 'mesmos.json'), JSON.stringify([{ novo: K_NOVO, outro: K_VELHO, resposta: 'sim' }]), 'utf8');
    comBom(path.join(base, 'mesmos.json'));
    const r = rodar(['--sessao', 'rv04-mes'], cwd, tmp);
    assert.strictEqual(r.status, 0, r.stdout);
    assert.strictEqual(r.json.provaveisMesmos.length, 1, r.stdout);
  });
});

test('RV-04: fechada.json com BOM le normalmente e o fecho nao e contado outra vez', () => {
  comRepo((cwd, tmp) => {
    const base = baseFechada(cwd);
    const um = rodar(['--sessao', 'rv04-fe'], cwd, tmp);
    assert.strictEqual(um.status, 0, um.stdout);
    comBom(path.join(base, 'fechada.json'));
    const dois = rodar(['--sessao', 'rv04-fe'], cwd, tmp);
    assert.strictEqual(dois.status, 0, dois.stdout);
    assert.strictEqual(dois.json.revisaoFechadaContada.jaContada, true, dois.stdout);
    assert.strictEqual(contadorDe(tmp, 'rv04-fe'), 1);
  });
});

// RV-03: linha "42" (texto) ou "40-45" (intervalo) era descartada calada, e a ronda fechava "aprovado" com o P0 de pe.
test('RV-03: pelo CLI, P0 com linha em texto ("42") ou intervalo ("40-45") molha a ronda, e nao fecha aprovado', () => {
  comRepo((cwd, tmp) => {
    const vd = (linha) => ({ lente: 'correcao', melhor: 'A',
      achados: [{ estado: 'confirmado', trecho: 'x', severidade: 'P0', arquivo: 'A.txt', linha: linha, descricao: 'quebra' }] });
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 1, [vd('42')]);
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 2, [vd('40-45')]);
    const r = rodar(['--sessao', 'rv03'], cwd, tmp);
    assert.strictEqual(r.status, 0, r.stdout);
    assert.notStrictEqual(r.json.motivo, 'duas rondas secas seguidas: aprovado', r.stdout);
    assert.strictEqual(r.json.rondasSecas, 0, r.stdout);
    assert.strictEqual(r.json.achadosNovosP0P1.length, 1, r.stdout);
    assert.strictEqual(r.json.achadosNovosP0P1[0].linha, 40, 'o intervalo vale pela 1a linha: ' + r.stdout);
    assert.deepStrictEqual(r.json.vereditosDescartados, [], r.stdout);
  });
});

// RV-01: revisar depois de commitar deixa os dois lados iguais; o inspetor cita A ou B ao acaso, e o que cai no
// rotulo "HEAD" ia para achadosDoLadoAntigo e nao molhava a ronda. Com identico:true, os dois rotulos sao o trabalho.
test('RV-01: mapa com identico:true conta os achados dos dois rotulos como do lado atual', () => {
  comRepo((cwd, tmp) => {
    const vd = (arq, linha) => ({ lente: 'correcao', melhor: 'empate',
      achados: [{ estado: 'confirmado', trecho: 'x', severidade: 'P0', arquivo: arq, linha: linha, descricao: 'quebra' }] });
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 1, [vd('B.txt', 10)]);
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 2, [vd('B.txt', 20)]);
    const base = path.join(cwd, '.claude', 'sworn', 'revisao', 'src__a.js');
    for (const n of ['1', '2']) {
      fs.writeFileSync(path.join(base, n, 'mapa.json'),
        JSON.stringify({ arquivo: 'src/a.js', mapa: { A: 'trabalho', B: 'HEAD' }, identico: true }), 'utf8');
    }
    const r = rodar(['--sessao', 'rv01'], cwd, tmp);
    assert.strictEqual(r.status, 0, r.stdout);
    assert.strictEqual(r.json.encerrar, false, 'dois P0 reais nao fecham aprovado: ' + r.stdout);
    assert.strictEqual(r.json.achadosNovosP0P1.length, 1, r.stdout);
    assert.deepStrictEqual(r.json.achadosDoLadoAntigo, [], r.stdout);
  });
});

test('RV-01: CONTROLE - mapa antigo, sem o campo, segue contando o rotulo HEAD como lado antigo', () => {
  comRepo((cwd, tmp) => {
    const vd = (arq, linha) => ({ lente: 'correcao', melhor: 'empate',
      achados: [{ estado: 'confirmado', trecho: 'x', severidade: 'P0', arquivo: arq, linha: linha, descricao: 'quebra' }] });
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 1, [vd('B.txt', 10)]);
    gravarNaBase(cwd, 'src__a.js', 'src/a.js', 2, [vd('B.txt', 20)]);
    const r = rodar(['--sessao', 'rv01c'], cwd, tmp);
    assert.strictEqual(r.status, 0, r.stdout);
    assert.strictEqual(r.json.motivo, 'duas rondas secas seguidas: aprovado', r.stdout);
    assert.strictEqual(r.json.achadosDoLadoAntigo.length, 1, r.stdout);
  });
});

// D503/D508 (plano d503, Tarefa 3, E6-E8): ronda com referencia = mapa.json com `invertida`; a 2a passada mora em
// <ronda>/invertida/vereditos e os textos dela em invertida/A.txt e invertida/B.txt (os lados trocados).
function gravarRondaRef(cwd, n, mapa, pass1, pass2, textos) {
  const dir = path.join(cwd, '.claude', 'sworn', 'revisao', String(n));
  fs.mkdirSync(path.join(dir, 'invertida', 'vereditos'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'mapa.json'), JSON.stringify({ arquivo: 'src/a.js', mapa: mapa,
    referencia: { tipo: 'codigo', entradas: ['ref/topo.js'] }, invertida: { A: mapa.B, B: mapa.A } }), 'utf8');
  gravarRonda(cwd, n, pass1);
  for (const v of pass2) {
    fs.writeFileSync(path.join(dir, 'invertida', 'vereditos', v.lente + '.json'), JSON.stringify(v), 'utf8');
  }
  const t = textos || { A: 'um\n', B: 'um\n' };
  fs.writeFileSync(path.join(dir, 'A.txt'), t.A, 'utf8');
  fs.writeFileSync(path.join(dir, 'B.txt'), t.B, 'utf8');
  fs.writeFileSync(path.join(dir, 'invertida', 'A.txt'), t.B, 'utf8');
  fs.writeFileSync(path.join(dir, 'invertida', 'B.txt'), t.A, 'utf8');
  fs.writeFileSync(path.join(dir, 'R.txt'), '=== referencia 1 de 1: ref/topo.js ===\ntopo\n', 'utf8');
}
function vdRef(lente, vsA, vsB, achados, lacunas) {
  return { lente: lente, melhor: 'A', porQue: 'A.txt:1', achados: achados || [], vsReferencia: { A: vsA, B: vsB },
    lacunas: lacunas || [] };
}

test('D503: pelo CLI, empata ou vence a referencia nas duas ordens, com duas secas, aprova; a saida traz referencia', () => {
  comTmp((tmp) => comTmp((cwd) => {
    const m = { A: 'trabalho', B: 'HEAD' };
    gravarRondaRef(cwd, 1, m, [vdRef('correcao', 'vence', 'perde')], [vdRef('correcao', 'perde', 'empata')]);
    gravarRondaRef(cwd, 2, m, [vdRef('correcao', 'vence', 'perde')], [vdRef('correcao', 'perde', 'vence')]);
    const r = rodar(['--sessao', 'ref1'], cwd, tmp);
    assert.strictEqual(r.status, 0, r.stdout);
    assert.strictEqual(r.json.motivo, 'duas rondas secas seguidas: aprovado', r.stdout);
    assert.strictEqual(r.json.referencia.pronta, true, r.stdout);
    assert.deepStrictEqual(r.json.referencia.lentes.map((l) => [l.lente, l.resultado]), [['correcao', 'vence']]);
  }));
});

test('D503: pelo CLI, perder a referencia numa ordem segura a revisao aberta', () => {
  comTmp((tmp) => comTmp((cwd) => {
    const m = { A: 'trabalho', B: 'HEAD' };
    gravarRondaRef(cwd, 1, m, [vdRef('correcao', 'empata', 'perde')], [vdRef('correcao', 'perde', 'perde')]);
    gravarRondaRef(cwd, 2, m, [vdRef('correcao', 'empata', 'perde')], [vdRef('correcao', 'perde', 'perde')]);
    const r = rodar(['--sessao', 'ref2'], cwd, tmp);
    assert.strictEqual(r.status, 0, r.stdout);
    assert.strictEqual(r.json.encerrar, false, r.stdout);
    assert.match(r.json.motivo, /referencia/);
    assert.deepStrictEqual(r.json.referencia.lentesAtras, ['correcao']);
  }));
});

test('D503: sem referencia no mapa.json, a saida traz referencia null', () => {
  comTmp((tmp) => comTmp((cwd) => {
    gravarMapa(cwd, 1, { A: 'trabalho', B: 'HEAD' });
    gravarRonda(cwd, 1, [{ lente: 'correcao', melhor: 'A', achados: [] }]);
    const r = rodar(['--sessao', 'ref3'], cwd, tmp);
    assert.strictEqual(r.status, 0, r.stdout);
    assert.strictEqual(r.json.referencia, null, r.stdout);
  }));
});

test('D503: pelo CLI, ronda com referencia sem a 2a passada para com o caminho da pasta', () => {
  comTmp((tmp) => comTmp((cwd) => {
    gravarRondaRef(cwd, 1, { A: 'trabalho', B: 'HEAD' }, [vdRef('correcao', 'vence', 'perde')], []);
    const r = rodar(['--sessao', 'ref4'], cwd, tmp);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.match(r.stdout, /invertida\/vereditos/);
    // Plano 082, Tarefa 5 (p2-32): sem a giria "2a passada" nem "metade do voto"; diz a lente e o pacote.
    assert.doesNotMatch(r.stdout, /2a passada|metade do voto/, r.stdout);
    assert.match(r.stdout, /com A e B trocados/, r.stdout);
    assert.match(r.stdout, /Lentes que faltam com os lados trocados: correcao\./, r.stdout);
    assert.match(r.stdout, /invertida\/A\.txt e invertida\/B\.txt/, r.stdout);
  }));
});

// Plano 082, Tarefa 5 (p2-2, p2-33): sem sessao, o aviso diz o efeito pratico e, com referencia, que ela tambem ficou de fora.
test('082 T5: fecho sem sessao diz o efeito pratico; com referencia, diz que a comparacao tambem nao entrou', () => {
  comTmp((tmp) => comTmp((cwd) => {
    const m = { A: 'trabalho', B: 'HEAD' };
    gravarRondaRef(cwd, 1, m, [vdRef('correcao', 'vence', 'perde')], [vdRef('correcao', 'perde', 'empata')]);
    gravarRondaRef(cwd, 2, m, [vdRef('correcao', 'vence', 'perde')], [vdRef('correcao', 'perde', 'vence')]);
    const r = rodar([], cwd, tmp);
    assert.strictEqual(r.status, 0, r.stdout);
    const aviso = r.json.revisaoFechadaContada.aviso;
    assert.match(aviso, /nenhuma sessao le/, aviso);
    assert.match(aviso, /comparacao com a referencia tambem nao entrou/, aviso);
    assert.match(aviso, /portao de fecho/, aviso);
    assert.ok(!/de novo|outra vez|repita|rode/i.test(aviso), aviso);
  }));
  comRepo((cwd, tmp) => {
    baseFechada(cwd);
    const aviso = rodar([], cwd, tmp).json.revisaoFechadaContada.aviso;
    assert.match(aviso, /nenhuma sessao le/, aviso);
    assert.doesNotMatch(aviso, /referencia/, 'sem referencia, nao fala dela: ' + aviso);
  });
});

test('D503 (revisao s49): mapa.json com `invertida` que nao e objeto esta corrompido, nao vira ronda sem referencia', () => {
  for (const torta of [[], 'x', null, 5]) {
    comTmp((tmp) => comTmp((cwd) => {
      gravarRondaRef(cwd, 1, { A: 'trabalho', B: 'HEAD' }, [vdRef('correcao', 'vence', 'perde')],
        [vdRef('correcao', 'perde', 'vence')]);
      const arq = path.join(cwd, '.claude', 'sworn', 'revisao', '1', 'mapa.json');
      const mj = JSON.parse(fs.readFileSync(arq, 'utf8'));
      mj.invertida = torta;
      fs.writeFileSync(arq, JSON.stringify(mj), 'utf8');
      const r = rodar(['--sessao', 'ref4b'], cwd, tmp);
      assert.strictEqual(r.status, 1, JSON.stringify(torta) + ': ' + r.stdout);
      assert.ok(r.stdout.includes('1/mapa.json esta corrompido ("invertida" nao e um objeto)'), r.stdout);
    }));
  }
});

// Plano 082, Tarefa 6 (p2-34): `invertida {}` passava no lerMapaJson e virava excecao do apurar, sem o arquivo nem o que fazer.
test('082 T6 (p2-34): `invertida` sem o lado de A e de B esta corrompido, com o arquivo e o que fazer', () => {
  for (const torta of [{}, { A: 'trabalho' }, { A: 'HEAD', B: 'HEAD' }, { A: 'x', B: 'trabalho' }]) {
    comTmp((tmp) => comTmp((cwd) => {
      gravarRondaRef(cwd, 1, { A: 'trabalho', B: 'HEAD' }, [vdRef('correcao', 'vence', 'perde')],
        [vdRef('correcao', 'perde', 'vence')]);
      const arq = path.join(cwd, '.claude', 'sworn', 'revisao', '1', 'mapa.json');
      const mj = JSON.parse(fs.readFileSync(arq, 'utf8'));
      mj.invertida = torta;
      fs.writeFileSync(arq, JSON.stringify(mj), 'utf8');
      const r = rodar(['--sessao', 'ref4c'], cwd, tmp);
      assert.strictEqual(r.status, 1, JSON.stringify(torta) + ': ' + r.stdout);
      assert.ok(r.stdout.includes('1/mapa.json esta corrompido ("invertida" nao diz o lado de A e de B'), r.stdout);
      assert.ok(r.stdout.includes('prepare a ronda de novo'), r.stdout);
      assert.ok(r.stdout.indexOf('sem o mapa que diz') === -1, 'virou a excecao do apurar: ' + r.stdout);
    }));
  }
});

// p2-28: sem `invertida` no mapa.json, a pasta invertida/vereditos/ nunca se lia e o voto dela sumia calado.
test('082 T6 (p2-28): vereditos com A e B trocados numa ronda sem `invertida` no mapa.json param com o que fazer', () => {
  comTmp((tmp) => comTmp((cwd) => {
    gravarMapa(cwd, 1, { A: 'trabalho', B: 'HEAD' });
    gravarRonda(cwd, 1, [{ lente: 'correcao', melhor: 'A', achados: [] }]);
    const inv = path.join(cwd, '.claude', 'sworn', 'revisao', '1', 'invertida', 'vereditos');
    fs.mkdirSync(inv, { recursive: true });
    const r0 = rodar(['--sessao', 'ref9'], cwd, tmp);
    assert.strictEqual(r0.status, 0, 'pasta vazia nao perde voto: ' + r0.stdout);
    fs.writeFileSync(path.join(inv, 'correcao.json'), JSON.stringify(vdRef('correcao', 'vence', 'perde')), 'utf8');
    const r = rodar(['--sessao', 'ref9'], cwd, tmp);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.ok(r.stdout.includes('ERRO: a ronda 1 tem vereditos com A e B trocados em .claude/sworn/revisao/1/invertida/vereditos/, ' +
      'mas o mapa.json dela nao tem "invertida"'), r.stdout);
    assert.match(r.stdout, /prepare a ronda de novo/, r.stdout);
    assert.match(r.stdout, /apague a pasta \.claude\/sworn\/revisao\/1\/invertida\//, r.stdout);
  }));
});

// Plano 083 (p5-5): so a pasta que nao existe (ENOENT) e "sem veredito"; a que nao se le por outra causa para, com a causa.
test('083 T5 (p5-5): invertida/vereditos que nao se le (e um arquivo) numa ronda sem `invertida` para com a causa', () => {
  comTmp((tmp) => comTmp((cwd) => {
    gravarMapa(cwd, 1, { A: 'trabalho', B: 'HEAD' });
    gravarRonda(cwd, 1, [{ lente: 'correcao', melhor: 'A', achados: [] }]);
    const inv = path.join(cwd, '.claude', 'sworn', 'revisao', '1', 'invertida');
    fs.mkdirSync(inv, { recursive: true });
    const r0 = rodar(['--sessao', 'ref10'], cwd, tmp);
    assert.strictEqual(r0.status, 0, 'invertida/ sem vereditos/ (ENOENT) nao perde voto: ' + r0.stdout);
    fs.writeFileSync(path.join(inv, 'vereditos'), 'nao e pasta', 'utf8');
    const r = rodar(['--sessao', 'ref10'], cwd, tmp);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.ok(r.stdout.includes('ERRO: nao consegui ler .claude/sworn/revisao/1/invertida/vereditos/ ('), r.stdout);
    assert.match(r.stdout, /ENOTDIR/, r.stdout);
  }));
});

// Plano 083 (p5-2): as lentes que faltam com os lados trocados saem sem repeticao, e o veredito da ordem normal que
// nao se leu (ilegivel) e dito, em vez de sumir da lista.
test('083 T5 (p5-2): lente repetida sai uma vez e o veredito ilegivel da ordem normal e contado na mensagem', () => {
  comTmp((tmp) => comTmp((cwd) => {
    gravarRondaRef(cwd, 1, { A: 'trabalho', B: 'HEAD' }, [vdRef('borda', 'vence', 'perde')], []);
    const vds = path.join(cwd, '.claude', 'sworn', 'revisao', '1', 'vereditos');
    fs.writeFileSync(path.join(vds, 'borda-2.json'), JSON.stringify(vdRef('borda', 'vence', 'perde')), 'utf8');
    fs.writeFileSync(path.join(vds, 'quebrado.json'), '{ nao e json', 'utf8');
    const r = rodar(['--sessao', 'ref11'], cwd, tmp);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.ok(r.stdout.includes('Lentes que faltam com os lados trocados: borda. Falta tambem a lente de 1 veredito da ' +
      'ordem normal que nao se leu (o ERRO de veredito ilegivel ou invalido, abaixo, diz qual).'), r.stdout);
    assert.doesNotMatch(r.stdout, /borda, borda/, r.stdout);
  }));
});

test('D503: pelo CLI, veredito sem vsReferencia na ronda com referencia e veredito invalido, nas duas passadas', () => {
  comTmp((tmp) => comTmp((cwd) => {
    gravarRondaRef(cwd, 1, { A: 'trabalho', B: 'HEAD' }, [{ lente: 'correcao', melhor: 'A', achados: [] }],
      [vdRef('borda', 'vence', 'perde'), { lente: 'correcao', melhor: 'A', achados: [] }]);
    const r = rodar(['--sessao', 'ref5'], cwd, tmp);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.match(r.stdout, /veredito invalido em \.claude\/sworn\/revisao\/1\/vereditos\/correcao\.json: .*vsReferencia/);
    assert.match(r.stdout, /veredito invalido em \.claude\/sworn\/revisao\/1\/invertida\/vereditos\/correcao\.json: .*vsReferencia/);
  }));
});

test('D503 E7: pelo CLI, o texto da linha da 2a passada vem de invertida/ (o mesmo defeito nao dobra)', () => {
  comTmp((tmp) => comTmp((cwd) => {
    // trabalho = A na 1a passada e B na 2a; a linha 2 do trabalho e "novo"; a do HEAD e "velho"
    const p1 = [vdRef('correcao', 'empata', 'empata', [{ estado: 'confirmado', trecho: 'um', severidade: 'P1', arquivo: 'A.txt', linha: 2, descricao: 'quebra' }])];
    const p2 = [vdRef('correcao', 'empata', 'empata', [{ estado: 'confirmado', trecho: 'um', severidade: 'P1', arquivo: 'B.txt', linha: 2, descricao: 'quebra' }])];
    gravarRondaRef(cwd, 1, { A: 'trabalho', B: 'HEAD' }, p1, p2, { A: 'um\nnovo\n', B: 'um\nvelho\n' });
    const r = rodar(['--sessao', 'ref6'], cwd, tmp);
    assert.strictEqual(r.status, 0, r.stdout);
    assert.strictEqual(r.json.achadosNovosP0P1.length, 1, r.stdout);
  }));
});

test('D503: pelo CLI, arquivo identico ao HEAD conta os dois lados como trabalho tambem na 2a passada', () => {
  comTmp((tmp) => comTmp((cwd) => {
    // a invertida gravada diz { A: HEAD, B: trabalho }; com identico, os dois sao trabalho e vale o pior (o A perde)
    gravarRondaRef(cwd, 1, { A: 'trabalho', B: 'HEAD' }, [vdRef('correcao', 'vence', 'vence')], [vdRef('correcao', 'perde', 'vence')]);
    const arq = path.join(cwd, '.claude', 'sworn', 'revisao', '1', 'mapa.json');
    const mj = JSON.parse(fs.readFileSync(arq, 'utf8'));
    mj.identico = true;
    fs.writeFileSync(arq, JSON.stringify(mj), 'utf8');
    const r = rodar(['--sessao', 'ref8'], cwd, tmp);
    assert.strictEqual(r.status, 0, r.stdout);
    assert.strictEqual(r.json.referencia.lentes[0].ordem2, 'perde', r.stdout);
  }));
});

test('D503 E5: pelo CLI, lacuna sem arquivo:linha sai em vereditosDescartados', () => {
  comTmp((tmp) => comTmp((cwd) => {
    const p1 = [vdRef('correcao', 'empata', 'empata', [], [{ severidade: 'P1', arquivo: 'R.txt', linha: 1, descricao: 'R tem' }])];
    gravarRondaRef(cwd, 1, { A: 'trabalho', B: 'HEAD' }, p1, [vdRef('correcao', 'empata', 'empata')]);
    const r = rodar(['--sessao', 'ref7'], cwd, tmp);
    assert.strictEqual(r.status, 0, r.stdout);
    assert.ok(r.json.vereditosDescartados.some((e) => /lacuna sem arquivo:linha/.test(e)), r.stdout);
  }));
});

// D503 (plano d503, Tarefa 5): o portao de fecho le se uma revisao CONTRA A REFERENCIA fechou na sessao. O apurar
// conta esse fecho num balde proprio, alem do revisao_fechada; a revisao sem referencia nao entra nele.
function contadoresDe(tmp, sessionId) {
  return JSON.parse(fs.readFileSync(path.join(tmp, 'sworn', sessionId + '.json'), 'utf8')).contadores || {};
}

test('D503 T5: revisao com referencia que fecha conta revisao_referencia_fechada (e revisao_fechada), uma vez so', () => {
  comTmp((tmp) => comTmp((cwd) => {
    const m = { A: 'trabalho', B: 'HEAD' };
    gravarRondaRef(cwd, 1, m, [vdRef('correcao', 'vence', 'perde')], [vdRef('correcao', 'perde', 'empata')]);
    gravarRondaRef(cwd, 2, m, [vdRef('correcao', 'vence', 'perde')], [vdRef('correcao', 'perde', 'vence')]);
    const r = rodar(['--sessao', 'rf1'], cwd, tmp);
    assert.strictEqual(r.json.encerrar, true, r.stdout);
    assert.strictEqual(contadoresDe(tmp, 'rf1').revisao_referencia_fechada, 1, r.stdout);
    assert.strictEqual(contadoresDe(tmp, 'rf1').revisao_fechada, 1);
    rodar(['--sessao', 'rf1'], cwd, tmp);
    assert.strictEqual(contadoresDe(tmp, 'rf1').revisao_referencia_fechada, 1, 'apurar de novo nao reconta');
  }));
});

test('D503 T5: revisao sem referencia que fecha nao conta revisao_referencia_fechada; com referencia aberta, nada conta', () => {
  comTmp((tmp) => comTmp((cwd) => {
    gravarRonda(cwd, 1, [{ lente: 'correcao', melhor: 'B', achados: [] }]);
    gravarRonda(cwd, 2, [{ lente: 'correcao', melhor: 'B', achados: [] }]);
    const r = rodar(['--sessao', 'rf2'], cwd, tmp);
    assert.strictEqual(r.json.encerrar, true, r.stdout);
    assert.strictEqual(contadoresDe(tmp, 'rf2').revisao_fechada, 1, 'controle: a revisao fechou');
    assert.strictEqual(contadoresDe(tmp, 'rf2').revisao_referencia_fechada, undefined);
  }));
  comTmp((tmp) => comTmp((cwd) => {
    const m = { A: 'trabalho', B: 'HEAD' };
    gravarRondaRef(cwd, 1, m, [vdRef('correcao', 'empata', 'perde')], [vdRef('correcao', 'perde', 'perde')]);
    gravarRondaRef(cwd, 2, m, [vdRef('correcao', 'empata', 'perde')], [vdRef('correcao', 'perde', 'perde')]);
    const r = rodar(['--sessao', 'rf3'], cwd, tmp);
    assert.strictEqual(r.json.encerrar, false, r.stdout);
    let c = {};
    try { c = contadoresDe(tmp, 'rf3'); } catch (e) { c = {}; }
    assert.strictEqual(c.revisao_referencia_fechada, undefined, 'aberta nao conta');
  }));
});

// Colheita 10-20, lote 3/4a: pelo CLI, o trecho do confirmado e conferido no A.txt/B.txt da ronda (linha citada e ate 2
// acima ou abaixo, espacos normalizados); o que nao confere nao conta e entra nos descartados. O pendente sai a parte.
test('lote 3/4a: pelo CLI, o trecho e conferido no A.txt da ronda e o pendente sai em pendentes', () => {
  comTmp((tmp) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-apurar-trecho-'));
    gravarMapa(cwd, 1, { A: 'trabalho', B: 'HEAD' });
    const linhas = ['a', 'b', 'c', 'd', '  const   x = ler(arq);', 'f', 'g', 'h', 'i', 'j'];
    fs.writeFileSync(path.join(cwd, '.claude', 'sworn', 'revisao', '1', 'A.txt'), linhas.join('\r\n'), 'utf8');
    gravarRonda(cwd, 1, [{ lente: 'correcao', melhor: 'B', achados: [
      { estado: 'confirmado', severidade: 'P1', arquivo: 'A.txt', linha: 3, trecho: 'const x = ler(arq)', descricao: 'perto' },
      { estado: 'confirmado', severidade: 'P1', arquivo: 'A.txt', linha: 9, trecho: 'const x = ler(arq)', descricao: 'longe' },
      { estado: 'confirmado', severidade: 'P0', arquivo: 'A.txt', linha: 2, trecho: 'apaga()', descricao: 'inventado' },
      { estado: 'pendente', arquivo: 'A.txt', linha: 5, falta: 'o que ler() devolve com arquivo vazio', descricao: 'talvez' }
    ] }]);
    const r = rodar(['--sessao', 'trecho'], cwd, tmp);
    assert.strictEqual(r.status, 0, r.stdout);
    assert.deepStrictEqual(r.json.achadosNovosP0P1.map((a) => a.descricao), ['perto']);
    assert.deepStrictEqual(r.json.trechoNaoConfere.map((a) => a.descricao), ['longe', 'inventado']);
    assert.strictEqual(r.json.pendentes.length, 1);
    assert.strictEqual(r.json.pendentes[0].falta, 'o que ler() devolve com arquivo vazio');
    assert.ok(r.json.vereditosDescartados.some((e) => /trecho/.test(e) && /A\.txt:9/.test(e)), JSON.stringify(r.json.vereditosDescartados));
  });
});
