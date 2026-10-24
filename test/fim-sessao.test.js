'use strict';
// T11-2 (D366): o gancho SessionEnd apaga os arquivos de sessao parados ha mais de 7 dias em
// %TEMP%/sworn, e NUNCA o da sessao que fecha (o --resume mantem o session_id: apagar o da propria
// sessao perderia o vinculo da frente e refaria a foto do git status, o defeito da D46).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const DIA = 24 * 60 * 60 * 1000;

/** estado.js carregado com SWORN_TMP apontando para uma pasta nova (a raiz() le o ambiente a cada chamada). */
function comTmp(fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-fim-sessao-'));
  const antes = process.env.SWORN_TMP;
  process.env.SWORN_TMP = base;
  delete require.cache[require.resolve('../scripts/lib/estado.js')];
  const estado = require('../scripts/lib/estado.js');
  try {
    fn(estado, path.join(base, 'sworn'), base);
  } finally {
    if (antes === undefined) delete process.env.SWORN_TMP;
    else process.env.SWORN_TMP = antes;
    fs.rmSync(base, { recursive: true, force: true });
  }
}

/** Cria o arquivo `nome` em `pasta` com o mtime `idadeDias` dias antes de `agora`. */
function criar(pasta, nome, idadeDias, agora) {
  fs.mkdirSync(pasta, { recursive: true });
  const alvo = path.join(pasta, nome);
  fs.writeFileSync(alvo, '{}', 'utf8');
  const quando = new Date(agora - idadeDias * DIA);
  fs.utimesSync(alvo, quando, quando);
  return alvo;
}

test('limparVelhos: apaga o .json, a .trava e o .tmp de outra sessao parados ha mais de 7 dias, e devolve quantos', () => {
  comTmp((estado, pasta) => {
    const agora = Date.now();
    const velhos = [
      criar(pasta, 'sessao-velha.json', 8, agora),
      criar(pasta, 'sessao-velha.json.trava', 8, agora),
      criar(pasta, 'sessao-velha.json.4242.k3j2h4g5.tmp', 8, agora)
    ];
    assert.strictEqual(estado.limparVelhos('sessao-atual', agora), 3);
    for (const v of velhos) assert.ok(!fs.existsSync(v), 'ficou: ' + path.basename(v));
  });
});

test('limparVelhos: mantem o arquivo de outra sessao que ainda e novo (menos de 7 dias)', () => {
  comTmp((estado, pasta) => {
    const agora = Date.now();
    const novos = [
      criar(pasta, 'outra.json', 1, agora),
      criar(pasta, 'outra2.json', 6.9, agora),
      criar(pasta, 'outra3.json', 0, agora)
    ];
    assert.strictEqual(estado.limparVelhos('sessao-atual', agora), 0);
    for (const n of novos) assert.ok(fs.existsSync(n), 'apagou o novo: ' + path.basename(n));
  });
});

test('limparVelhos: o corte e "mais de 7 dias" - 7 dias e um minuto sai, 6 dias e 23 horas fica', () => {
  comTmp((estado, pasta) => {
    const agora = Date.now();
    const passou = criar(pasta, 'passou.json', 7 + 1 / 1440, agora);
    const ficou = criar(pasta, 'ficou.json', 7 - 1 / 24, agora);
    assert.strictEqual(estado.IDADE_LIMPEZA_MS, 7 * DIA, 'a constante exportada tem de ser 7 dias');
    assert.strictEqual(estado.limparVelhos('sessao-atual', agora), 1);
    assert.ok(!fs.existsSync(passou));
    assert.ok(fs.existsSync(ficou));
  });
});

test('limparVelhos: NUNCA apaga o da sessao atual, mesmo velho - .json, .trava e .tmp', () => {
  comTmp((estado, pasta) => {
    const agora = Date.now();
    const meus = [
      criar(pasta, 'minha-sessao.json', 30, agora),
      criar(pasta, 'minha-sessao.json.trava', 30, agora),
      criar(pasta, 'minha-sessao.json.99.abc123.tmp', 30, agora)
    ];
    const outro = criar(pasta, 'sessao-velha.json', 30, agora);
    assert.strictEqual(estado.limparVelhos('minha-sessao', agora), 1, 'so o da outra sessao sai');
    for (const m of meus) assert.ok(fs.existsSync(m), 'apagou o da sessao atual: ' + path.basename(m));
    assert.ok(!fs.existsSync(outro));
  });
});

test('limparVelhos: a sessao atual e comparada pelo id SANEADO, como o caminhoSessao', () => {
  comTmp((estado, pasta) => {
    const agora = Date.now();
    // 'a/b c' vira 'a-b-c' no nome do arquivo
    const sujo = criar(pasta, path.basename(estado.caminhoSessao('a/b c')), 30, agora);
    assert.strictEqual(path.basename(sujo), 'a-b-c.json');
    assert.strictEqual(estado.limparVelhos('a/b c', agora), 0);
    assert.ok(fs.existsSync(sujo), 'o id sujo da sessao atual nao foi saneado antes de comparar');
  });
});

test('limparVelhos: a comparacao da sessao atual nao diferencia caixa (ABC e abc sao o mesmo arquivo no Windows)', () => {
  comTmp((estado, pasta) => {
    const agora = Date.now();
    const minuscula = criar(pasta, 'abc-1.json', 30, agora);
    const mista = criar(pasta, 'Xyz-2.json', 30, agora);
    assert.strictEqual(estado.limparVelhos('ABC-1', agora), 1, 'so o Xyz-2 e de outra sessao');
    assert.ok(fs.existsSync(minuscula), 'a comparacao diferenciou a caixa (arquivo minusculo, id maiusculo)');
    assert.ok(!fs.existsSync(mista));
    const maiuscula = criar(pasta, 'QRS-3.json', 30, agora);
    assert.strictEqual(estado.limparVelhos('qrs-3', agora), 1, 'o abc-1 agora e de outra sessao e sai; o QRS-3 fica');
    assert.ok(fs.existsSync(maiuscula), 'a comparacao diferenciou a caixa (arquivo maiusculo, id minusculo)');
  });
});

test('limparVelhos: sem session_id a sessao atual e "sem-sessao", como no caminhoSessao', () => {
  comTmp((estado, pasta) => {
    const agora = Date.now();
    const semId = criar(pasta, 'sem-sessao.json', 30, agora);
    const outra = criar(pasta, 'outra.json', 30, agora);
    assert.strictEqual(estado.limparVelhos(undefined, agora), 1);
    assert.ok(fs.existsSync(semId), 'sem session_id o arquivo sem-sessao.json tinha de ficar');
    assert.ok(!fs.existsSync(outra));
  });
});

test('limparVelhos: so apaga os nomes que o estado e o gravar-veredito criam - nome estranho e pasta ficam', () => {
  comTmp((estado, pasta) => {
    const agora = Date.now();
    const intactos = [
      criar(pasta, 'x.veredito-.marca', 30, agora),                // marca sem agente
      criar(pasta, 'x.veredito-a.b.marca', 30, agora),             // ponto no agente
      criar(pasta, 'x.marca', 30, agora),
      criar(pasta, 'notas.txt', 30, agora),
      criar(pasta, 'sessao.json.bak', 30, agora),
      criar(pasta, 'sessao.jsonx', 30, agora),
      criar(pasta, '.json', 30, agora),                           // sem id
      criar(pasta, 'com espaco.json', 30, agora),                 // fora da classe [a-zA-Z0-9_-]
      criar(pasta, 'a.b.json', 30, agora),                        // ponto no id
      criar(pasta, 'sessao.json.trava.extra', 30, agora),
      criar(pasta, 'sessao.json.pid.rand.tmp', 30, agora)         // pid nao numerico
    ];
    // pastas, mesmo com nome de arquivo de sessao e velhas
    const dir = path.join(pasta, 'pasta-velha.json');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'dentro.json'), '{}', 'utf8');
    const antiga = new Date(agora - 30 * DIA);
    fs.utimesSync(dir, antiga, antiga);
    fs.utimesSync(path.join(dir, 'dentro.json'), antiga, antiga);

    assert.strictEqual(estado.limparVelhos('outra', agora), 0);
    for (const i of intactos) assert.ok(fs.existsSync(i), 'apagou o que nao era dele: ' + path.basename(i));
    assert.ok(fs.existsSync(path.join(dir, 'dentro.json')), 'entrou em pasta');
    assert.ok(fs.existsSync(pasta), 'a pasta raiz() tem de ficar');
  });
});

// D396 n. 1: as marcas `<sessao>.veredito-<agente>.marca` do gravar-veredito.js acumulavam para sempre.
test('limparVelhos: D396 n. 1 - marca de veredito de outra sessao com mais de 7 dias sai; a da sessao atual e a nova ficam', () => {
  comTmp((estado, pasta) => {
    const agora = Date.now();
    const velha = criar(pasta, 'outra.veredito-agente_1.marca', 30, agora);
    const minha = criar(pasta, 'atual.veredito-agente_2.marca', 30, agora);
    const nova = criar(pasta, 'outra.veredito-agente_3.marca', 1, agora);
    assert.strictEqual(estado.limparVelhos('atual', agora), 1);
    assert.ok(!fs.existsSync(velha), 'a marca velha de outra sessao ficou');
    assert.ok(fs.existsSync(minha), 'apagou a marca da sessao atual');
    assert.ok(fs.existsSync(nova), 'apagou a marca nova');
  });
});

// D396 n. 9: typeof NaN === 'number' - NaN na idade apagava o arquivo novo, e no prazo tirava o teto.
test('limparVelhos: D396 n. 9 - NaN ou Infinity em idadeMs, limiteMs ou agoraMs cai no padrao', () => {
  comTmp((estado, pasta) => {
    const agora = Date.now();
    const novo = criar(pasta, 'outra.json', 1, agora);
    assert.strictEqual(estado.limparVelhos('atual', agora, { idadeMs: NaN }), 0, 'idadeMs NaN apagou o novo');
    assert.strictEqual(estado.limparVelhos('atual', NaN), 0, 'agoraMs NaN apagou o novo');
    assert.strictEqual(estado.limparVelhos('atual', agora, { idadeMs: Infinity }), 0);
    assert.ok(fs.existsSync(novo));
    // prazo: o relogio salta 10 s depois da 1a leitura; com o teto padrao (800 ms) nada sai, com NaN saia tudo
    ['a', 'b', 'c'].forEach((n) => criar(pasta, n + '.json', 9, agora));
    const real = Date.now;
    for (const ruim of [NaN, Infinity]) {
      let chamadas = 0;
      Date.now = function () { return real() + (chamadas++ === 0 ? 0 : 10000); };
      try {
        assert.strictEqual(estado.limparVelhos('atual', agora, { limiteMs: ruim }), 0, 'limiteMs ' + ruim + ' tirou o teto');
      } finally { Date.now = real; }
    }
  });
});

// D396 n. 8: o readdirSync lia a pasta inteira antes do primeiro olhar no prazo.
test('limparVelhos: D396 n. 8 - le a pasta entrada a entrada, com o prazo conferido antes de cada uma', () => {
  comTmp((estado, pasta) => {
    const agora = Date.now();
    ['a', 'b', 'c'].forEach((n) => criar(pasta, n + '.json', 9, agora));
    const original = fs.readdirSync;
    const abrirOriginal = fs.opendirSync;
    let leuInteira = 0;
    let leituras = 0;
    fs.readdirSync = function (alvo) {
      if (path.resolve(String(alvo)) === path.resolve(pasta)) leuInteira++;
      return original.apply(fs, arguments);
    };
    // sessao 27: o prazo vem ANTES de cada leitura - com ele ja estourado, nenhuma entrada se le
    fs.opendirSync = function () {
      const dir = abrirOriginal.apply(fs, arguments);
      const ler = dir.readSync.bind(dir);
      dir.readSync = function () { leituras++; return ler(); };
      return dir;
    };
    try {
      assert.strictEqual(estado.limparVelhos('atual', agora, { limiteMs: -1 }), 0);
      assert.strictEqual(leituras, 0, 'leu entrada com o prazo ja estourado');
      assert.strictEqual(estado.limparVelhos('atual', agora), 3);
    } finally { fs.readdirSync = original; fs.opendirSync = abrirOriginal; }
    assert.strictEqual(leuInteira, 0, 'a pasta foi lida inteira de uma vez');
  });
});

test('limparVelhos: pasta inexistente, ou que e um arquivo, nao lanca e devolve 0', () => {
  comTmp((estado, pasta) => {
    assert.ok(!fs.existsSync(pasta));
    assert.strictEqual(estado.limparVelhos('x', Date.now()), 0);
    assert.strictEqual(fs.existsSync(pasta), false, 'nao pode CRIAR a pasta so para limpar');
    fs.writeFileSync(pasta, 'sou um arquivo', 'utf8');
    assert.strictEqual(estado.limparVelhos('x', Date.now()), 0);
  });
});

test('limparVelhos: arquivo que nao deixa apagar (EPERM) ou que some no meio nao lanca - o resto segue e a conta so tem os apagados', () => {
  comTmp((estado, pasta) => {
    const agora = Date.now();
    const a = criar(pasta, 'a.json', 9, agora);
    const b = criar(pasta, 'b.json', 9, agora);
    const c = criar(pasta, 'c.json', 9, agora);
    const original = fs.unlinkSync;
    fs.unlinkSync = function (alvo) {
      if (path.basename(alvo) === 'b.json') { const e = new Error('EPERM: operation not permitted'); e.code = 'EPERM'; throw e; }
      if (path.basename(alvo) === 'c.json') { fs.rmSync(alvo, { force: true }); const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return original.apply(fs, arguments);
    };
    try {
      assert.strictEqual(estado.limparVelhos('atual', agora), 1);
    } finally { fs.unlinkSync = original; }
    assert.ok(!fs.existsSync(a));
    assert.ok(fs.existsSync(b), 'o EPERM nao pode apagar por outro caminho');
  });
});

test('limparVelhos: tem teto de tempo - com o prazo estourado nao apaga nada e nao lanca', () => {
  comTmp((estado, pasta) => {
    const agora = Date.now();
    const velhos = ['a', 'b', 'c'].map((n) => criar(pasta, n + '.json', 9, agora));
    assert.strictEqual(estado.limparVelhos('atual', agora, { limiteMs: -1 }), 0);
    for (const v of velhos) assert.ok(fs.existsSync(v), 'apagou depois do prazo: ' + path.basename(v));
    // controle: o mesmo estado, sem o prazo apertado, apaga os tres (o que sobrou sai na proxima)
    assert.strictEqual(estado.limparVelhos('atual', agora), 3);
    assert.ok(estado.LIMITE_LIMPEZA_MS > 0 && estado.LIMITE_LIMPEZA_MS <= 1000,
      'o teto padrao tem de caber no orcamento de 1,5 s do SessionEnd: ' + estado.LIMITE_LIMPEZA_MS);
  });
});

test('limparVelhos: nao usa alterar nem travar - uma trava ja existente de outra sessao nao o faz esperar', () => {
  comTmp((estado, pasta) => {
    const agora = Date.now();
    // trava NOVA (nao e velha) da propria sessao atual: se o codigo tentasse travar, esperaria ate 2 s
    criar(pasta, 'atual.json.trava', 0, agora);
    criar(pasta, 'velha.json', 9, agora);
    const t0 = Date.now();
    assert.strictEqual(estado.limparVelhos('atual', agora), 1);
    assert.ok(Date.now() - t0 < 1000, 'demorou ' + (Date.now() - t0) + ' ms: esperou trava?');
    assert.ok(fs.existsSync(path.join(pasta, 'atual.json.trava')), 'a trava da sessao atual tem de ficar');
  });
});

test('limpar continua existindo e apagando o arquivo da sessao pedida (o estado.test.js usa)', () => {
  comTmp((estado) => {
    estado.gravar('s1', { a: 1 });
    estado.limpar('s1');
    assert.deepStrictEqual(estado.ler('s1'), {});
  });
});

// ------------------------------------------------------------------ o script e a fiacao

function rodarFim(dir, entrada, bruto) {
  return spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'fim-sessao.js')], {
    cwd: dir,
    encoding: 'utf8',
    input: bruto !== undefined ? bruto : JSON.stringify(entrada),
    env: Object.assign({}, process.env, { SWORN_TMP: path.join(dir, '_sessoes') })
  });
}

test('fim-sessao.js: roda com a entrada do SessionEnd, sai 0 calado, apaga o velho de outra sessao e poupa o da atual', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-fim-script-'));
  try {
    const pasta = path.join(dir, '_sessoes', 'sworn');
    const agora = Date.now();
    const velhoOutro = criar(pasta, 'sessao-antiga.json', 10, agora);
    const velhoMeu = criar(pasta, 'sessao-hoje.json', 10, agora);
    const novoOutro = criar(pasta, 'sessao-recente.json', 1, agora);

    const r = rodarFim(dir, { session_id: 'sessao-hoje', cwd: dir, transcript_path: path.join(dir, 't.jsonl'),
      hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout, '', 'a saida do SessionEnd e descartada: nao ha o que dizer');
    assert.ok(!fs.existsSync(velhoOutro), 'o velho de outra sessao tinha de sair');
    assert.ok(fs.existsSync(velhoMeu), 'o da propria sessao tem de ficar, mesmo velho');
    assert.ok(fs.existsSync(novoOutro));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fim-sessao.js: todas as razoes do SessionEnd saem 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-fim-razoes-'));
  try {
    for (const reason of ['clear', 'resume', 'logout', 'prompt_input_exit', 'other', 'razao-nova']) {
      const r = rodarFim(dir, { session_id: 's-' + reason, cwd: dir, hook_event_name: 'SessionEnd', reason: reason });
      assert.strictEqual(r.status, 0, reason + ': ' + r.stderr);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fim-sessao.js: entrada quebrada, vazia ou sem session_id sai 0 e nao apaga a sessao "sem-sessao"', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-fim-quebrada-'));
  try {
    const pasta = path.join(dir, '_sessoes', 'sworn');
    const semSessao = criar(pasta, 'sem-sessao.json', 20, Date.now());
    for (const bruto of ['', '   ', '{isso nao fecha', 'null', '42', '[]', '"texto"']) {
      const r = rodarFim(dir, null, bruto);
      assert.strictEqual(r.status, 0, JSON.stringify(bruto) + ': ' + r.stderr);
      assert.strictEqual(r.stdout, '');
    }
    assert.ok(fs.existsSync(semSessao), 'sem session_id a sessao atual e sem-sessao: o arquivo dela fica');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fim-sessao.js: pasta de estado impossivel (SWORN_TMP dentro de um arquivo) sai 0 sem erro', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-fim-impossivel-'));
  try {
    const arquivo = path.join(dir, 'e-um-arquivo');
    fs.writeFileSync(arquivo, 'x', 'utf8');
    const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'fim-sessao.js')], {
      cwd: dir, encoding: 'utf8', input: JSON.stringify({ session_id: 's', cwd: dir }),
      env: Object.assign({}, process.env, { SWORN_TMP: path.join(arquivo, 'dentro') })
    });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stderr, '', 'nao pode nem reclamar: ' + r.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fim-sessao.js: nao grava estado nenhum - nao cria a pasta nem o arquivo da sessao', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-fim-sem-estado-'));
  try {
    const r = rodarFim(dir, { session_id: 'so-uma-vez', cwd: dir, hook_event_name: 'SessionEnd', reason: 'other' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(!fs.existsSync(path.join(dir, '_sessoes')), 'o fim de sessao criou a pasta de estado');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('hooks.json: o SessionEnd roda o fim-sessao.js, sem matcher (todas as razoes), no formato dos outros ganchos', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(RAIZ, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const grupos = hooks.SessionEnd;
  assert.ok(Array.isArray(grupos) && grupos.length === 1, 'falta o evento SessionEnd no hooks.json');
  assert.strictEqual(grupos[0].matcher, undefined, 'com matcher o gancho so rodaria em algumas razoes');
  assert.strictEqual(grupos[0].hooks.length, 1);
  const g = grupos[0].hooks[0];
  assert.strictEqual(g.type, 'command');
  assert.strictEqual(g.command, 'node');
  assert.deepStrictEqual(g.args, ['${CLAUDE_PLUGIN_ROOT}/scripts/fim-sessao.js']);
  assert.strictEqual(typeof g.timeout, 'number', 'timeout no mesmo formato dos outros ganchos');
  assert.ok(fs.existsSync(path.join(RAIZ, 'scripts', 'fim-sessao.js')), 'o script do hooks.json nao existe');
});
