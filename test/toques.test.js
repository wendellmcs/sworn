'use strict';
// V3 (colheita lote 5, D846): o arquivo que outra sessao do sworn escreveu depois que esta abriu e de outra frente.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const comum = require('./lib/comum.js');
const toques = require('../scripts/lib/toques.js');
const estado = require('../scripts/lib/estado.js');
const escopo = require('../scripts/lib/escopo.js');

function comEstado(fn) {
  const tmp = comum.temporaria('sworn-toq-');
  const antes = process.env.SWORN_TMP;
  process.env.SWORN_TMP = tmp;
  try { fn(tmp); } finally {
    if (antes === undefined) delete process.env.SWORN_TMP; else process.env.SWORN_TMP = antes;
  }
}

test('toques: o toque de outra sessao depois da abertura volta; o proprio, o de antes e o sem hora, nao', () => {
  comEstado((tmp) => {
    const raiz = path.join(tmp, 'proj');
    const abs = path.join(raiz, 'src', 'a.js');
    toques.registrar(raiz, abs, 'B', 2000);
    assert.deepStrictEqual(toques.deOutraSessao(raiz, abs, 'A', 1000), { em: 2000 });
    assert.strictEqual(toques.deOutraSessao(raiz, abs, 'A', 2000), null, 'o toque na hora exata da abertura e de antes');
    assert.strictEqual(toques.deOutraSessao(raiz, abs, 'A', 3000), null);
    assert.strictEqual(toques.deOutraSessao(raiz, abs, 'B', 1000), null, 'o proprio toque nao e de outra frente');
    assert.strictEqual(toques.deOutraSessao(raiz, abs, 'A', undefined), null, 'sem a hora da abertura, nada');
    assert.strictEqual(toques.deOutraSessao(raiz, abs, 'A', NaN), null);
    // a chave nao olha a barra; a caixa, so onde o sistema nao a diferencia (D45)
    const semCaixa = process.platform === 'win32' || process.platform === 'darwin';
    assert.deepStrictEqual(toques.deOutraSessao(raiz, path.join(raiz, 'SRC', 'A.JS'), 'A', 1000), semCaixa ? { em: 2000 } : null);
    assert.deepStrictEqual(toques.deOutraSessao(raiz, abs.replace(/\\/g, '/'), 'A', 1000), { em: 2000 });
    assert.deepStrictEqual(toques.deOutraSessao(raiz, raiz + '/src/x/../a.js', 'A', 1000), { em: 2000 }, 'o .. se resolve');
    assert.strictEqual(toques.deOutraSessao(raiz, path.join(raiz, 'src', 'b.js'), 'A', 1000), null);
    // um registro por projeto
    assert.strictEqual(toques.deOutraSessao(path.join(tmp, 'outro'), abs, 'A', 1000), null);
    // o ultimo toque vale
    toques.registrar(raiz, abs, 'A', 2500);
    assert.strictEqual(toques.deOutraSessao(raiz, abs, 'A', 1000), null);
    assert.deepStrictEqual(toques.deOutraSessao(raiz, abs, 'C', 1000), { em: 2500 });
    // sem o id da sessao: nao grava, e quem consulta sem id nao separa o proprio toque do alheio
    const semId = path.join(raiz, 'sem-id.js');
    toques.registrar(raiz, semId, undefined, 2000);
    toques.registrar(raiz, semId, '', 2000);
    assert.strictEqual(toques.deOutraSessao(raiz, semId, 'A', 1000), null, 'o toque sem id nao entrou');
    assert.strictEqual(toques.deOutraSessao(raiz, abs, undefined, 1000), null);
    assert.strictEqual(toques.deOutraSessao(raiz, abs, '', 1000), null);
  });
});

test('toques: o toque com hora adiante do relogio nao vale e sai na gravacao seguinte', () => {
  comEstado(() => {
    const raiz = path.join(process.env.SWORN_TMP, 'proj');
    const futuro = path.join(raiz, 'futuro.js');
    const agora = 10 * 60 * 1000;
    toques.registrar(raiz, futuro, 'B', agora + toques.FOLGA_DO_RELOGIO_MS);
    assert.deepStrictEqual(toques.deOutraSessao(raiz, futuro, 'A', 0, agora), { em: agora + toques.FOLGA_DO_RELOGIO_MS },
      'dentro da folga ainda vale');
    toques.registrar(raiz, futuro, 'B', agora + toques.FOLGA_DO_RELOGIO_MS + 1);
    assert.strictEqual(toques.deOutraSessao(raiz, futuro, 'A', 0, agora), null, 'alem da folga, nao');
    toques.registrar(raiz, path.join(raiz, 'outro.js'), 'B', agora);
    assert.strictEqual(estado.ler(toques.idDoProjeto(raiz)).mapa[toques.chave(futuro)], undefined, 'saiu ao gravar');
  });
});

test('toques: o velho de 7 dias sai, o teto segura o registro e o registro torto nao derruba', () => {
  comEstado(() => {
    const raiz = path.join(process.env.SWORN_TMP, 'proj');
    const velho = path.join(raiz, 'velho.js');
    const novo = path.join(raiz, 'novo.js');
    toques.registrar(raiz, velho, 'B', 0);
    toques.registrar(raiz, novo, 'B', estado.IDADE_LIMPEZA_MS);
    assert.deepStrictEqual(toques.deOutraSessao(raiz, velho, 'A', -1), { em: 0 }, 'com 7 dias exatos ainda fica');
    toques.registrar(raiz, novo, 'B', estado.IDADE_LIMPEZA_MS + 1);
    assert.strictEqual(toques.deOutraSessao(raiz, velho, 'A', -1), null, 'passou de 7 dias: sai');
    assert.deepStrictEqual(toques.deOutraSessao(raiz, novo, 'A', -1), { em: estado.IDADE_LIMPEZA_MS + 1 });

    const id = toques.idDoProjeto(raiz);
    const mapa = {};
    for (let i = 0; i < toques.TETO_DE_ARQUIVOS; i++) {
      mapa[toques.chave(path.join(raiz, 'f' + i))] = { s: 'B', em: 1000 + i };
    }
    estado.gravar(id, { mapa: mapa });
    toques.registrar(raiz, path.join(raiz, 'mais.js'), 'B', 5000);
    const depois = estado.ler(id).mapa;
    assert.strictEqual(Object.keys(depois).length, toques.TETO_DE_ARQUIVOS);
    assert.strictEqual(toques.deOutraSessao(raiz, path.join(raiz, 'f0'), 'A', 0), null, 'o mais velho saiu');
    assert.deepStrictEqual(toques.deOutraSessao(raiz, path.join(raiz, 'f1'), 'A', 0), { em: 1001 });
    assert.deepStrictEqual(toques.deOutraSessao(raiz, path.join(raiz, 'mais.js'), 'A', 0), { em: 5000 });

    estado.gravar(id, { mapa: [1, 2] });
    assert.strictEqual(toques.deOutraSessao(raiz, novo, 'A', 0), null);
    const torto = {};
    torto[toques.chave(novo)] = { s: 5, em: 'x' };
    estado.gravar(id, { mapa: torto });
    assert.strictEqual(toques.deOutraSessao(raiz, novo, 'A', 0), null);
    toques.registrar(raiz, novo, 'B', 9000);
    assert.deepStrictEqual(toques.deOutraSessao(raiz, novo, 'A', 0), { em: 9000 }, 'o registro torto se refaz');
  });
});

test('toques: o aviso diz quando foi a mudanca e o que fazer', () => {
  const m = escopo.motivoOutraSessao('docs/a.md', '.claude/sworn/escopo.md', 125000);
  assert.match(m, /^sworn - outra frente de trabalho \(trava 5 - arquivo de outra frente\)\./);
  assert.ok(m.includes('O arquivo docs/a.md foi alterado por outra sessao do sworn depois que esta abriu (a ultima ' +
    'escrita dela foi ha 2 min), e a mudanca segue sem commit.'), m);
  assert.ok(m.includes('Quando a outra sessao fizer o commit, este arquivo volta a passar.'), m);
  assert.ok(m.includes('liste o caminho exato em .claude/sworn/escopo.md, na secao "## Dentro"'), m);
  assert.ok(escopo.motivoOutraSessao('a', null, 59999).includes('(a ultima escrita dela foi ha menos de 1 min)'));
  assert.ok(escopo.motivoOutraSessao('a', null, -5).includes('(a ultima escrita dela foi ha menos de 1 min)'));
  assert.ok(escopo.motivoOutraSessao('a', null, 60000).includes('(a ultima escrita dela foi ha 1 min)'));
  assert.ok(escopo.motivoOutraSessao('a', null, NaN).includes('depois que esta abriu, e a mudanca'));
});

const PROJETO = { versaoConfig: 1, marchaPadrao: 'padrao', marchas: { rapida: ['**/*.md'] } };

function gravarSessao(tmp, id, dados) {
  fs.mkdirSync(path.join(tmp, 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'sworn', id + '.json'), JSON.stringify(dados), 'utf8');
}

function negou(r) {
  return !!(r.json && r.json.hookSpecificOutput && r.json.hookSpecificOutput.permissionDecision === 'deny');
}

function motivoDe(r) {
  return r.json && r.json.hookSpecificOutput ? String(r.json.hookSpecificOutput.permissionDecisionReason || '') : '';
}

function portao(dir, sessao, rel, env) {
  return comum.ganchoComoProcesso('scripts/portao-escopo.js', {
    session_id: sessao, cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Write',
    tool_input: { file_path: path.join(dir, rel), content: 'x\n' }
  }, { env: env });
}

function escreveu(dir, sessao, rel, env, ferramenta) {
  const r = comum.ganchoComoProcesso('scripts/marcar-trabalho.js', {
    session_id: sessao, cwd: dir, hook_event_name: 'PostToolUse', tool_name: ferramenta || 'Write',
    tool_input: { file_path: path.join(dir, rel) }, tool_response: {}
  }, { env: env });
  assert.strictEqual(r.status, 0, r.stderr);
}

function liberou(r) {
  assert.strictEqual(r.status, 0, 'o portao caiu: ' + r.stderr);
  assert.strictEqual(negou(r), false, motivoDe(r));
}

test('toques: de ponta, o Write no arquivo que outra sessao mudou depois da abertura e negado ate o commit', () => {
  const tmp = comum.temporaria('sworn-toq-');
  const env = comum.ambiente({ SWORN_TMP: tmp });
  const dir = comum.repo(comum.temporaria('sworn-toq-proj-'), {
    'docs/nota.md': 'a\n', 'docs/outra.md': 'a\n', '.claude/sworn/projeto.json': JSON.stringify(PROJETO)
  });
  const agora = Date.now();
  gravarSessao(tmp, 'A', { inicioMs: agora - 60000, gitAbertura: [] });
  gravarSessao(tmp, 'C', { inicioMs: agora + 60000, gitAbertura: [] });
  gravarSessao(tmp, 'D', { gitAbertura: [] });

  fs.writeFileSync(path.join(dir, 'docs', 'nota.md'), 'mudado por B\n');
  escreveu(dir, 'B', 'docs/nota.md', env);
  const r = portao(dir, 'A', 'docs/nota.md', env);
  assert.ok(negou(r), 'a sessao A devia ser barrada');
  assert.ok(motivoDe(r).includes('O arquivo docs/nota.md foi alterado por outra sessao do sworn depois que esta abriu ' +
    '(a ultima escrita dela foi ha menos de 1 min), e a mudanca segue sem commit.'), motivoDe(r));
  liberou(portao(dir, 'B', 'docs/nota.md', env));
  liberou(portao(dir, 'C', 'docs/nota.md', env));
  liberou(portao(dir, 'D', 'docs/nota.md', env));
  liberou(portao(dir, 'A', 'docs/outra.md', env));

  // a leitura nao conta como toque
  fs.writeFileSync(path.join(dir, 'docs', 'outra.md'), 'mudado fora\n');
  escreveu(dir, 'E', 'docs/outra.md', env, 'Read');
  liberou(portao(dir, 'A', 'docs/outra.md', env));

  // a trava desligada nao barra; religada, barra de novo
  const pj = path.join(dir, '.claude', 'sworn', 'projeto.json');
  fs.writeFileSync(pj, JSON.stringify(Object.assign({ travas: { outraFrente: false } }, PROJETO)));
  liberou(portao(dir, 'A', 'docs/nota.md', env));
  fs.writeFileSync(pj, JSON.stringify(PROJETO));
  assert.ok(negou(portao(dir, 'A', 'docs/nota.md', env)));

  // o caminho no "## Dentro" do escopo passa
  const esc = path.join(dir, '.claude', 'sworn', 'escopo.md');
  fs.writeFileSync(esc, '# Escopo\n\n## Objetivo\nx\n\n## Dentro\n- docs/nota.md\n');
  liberou(portao(dir, 'A', 'docs/nota.md', env));
  fs.unlinkSync(esc);
  assert.ok(negou(portao(dir, 'A', 'docs/nota.md', env)));

  // o arquivo novo que outra sessao criou (sem rastreio no git) tambem segue sem commit
  fs.writeFileSync(path.join(dir, 'docs', 'nova.md'), 'criado por B\n');
  escreveu(dir, 'B', 'docs/nova.md', env);
  assert.ok(negou(portao(dir, 'A', 'docs/nova.md', env)), 'o arquivo novo de B devia barrar A');

  // com o commit, nao e mais trabalho em andamento
  comum.git(dir, ['add', 'docs/nota.md', 'docs/nova.md']);
  comum.git(dir, ['commit', '-q', '-m', 'B']);
  liberou(portao(dir, 'A', 'docs/nota.md', env));
  liberou(portao(dir, 'A', 'docs/nova.md', env));
});

// A2-07: na worktree do subagente (.claude/worktrees/<nome>), o "segue sem commit" e a foto da abertura sao do git da
// propria worktree, nao do projeto principal: a foto (git do principal) nao barra a copia da worktree, e o toque nela
// barra enquanto a worktree o tem sem commit, mesmo com o principal limpo.
test('toques A2-07: na worktree do subagente, o git que conta e o da worktree', () => {
  const tmp = comum.temporaria('sworn-toq-');
  const env = comum.ambiente({ SWORN_TMP: tmp });
  const dir = comum.repo(comum.temporaria('sworn-toq-wt-'), {
    '.gitignore': '.claude/\n', 'docs/nota.md': 'a\n', 'docs/outra.md': 'a\n'
  });
  fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify(PROJETO));
  const wt = path.join(dir, '.claude', 'worktrees', 'w1');
  comum.git(dir, ['worktree', 'add', '-q', wt]);
  try {
    gravarSessao(tmp, 'A', { inicioMs: Date.now() - 60000, gitAbertura: ['docs/nota.md'] });
    // a foto da abertura lista docs/nota.md (sujo no principal): a copia da worktree e outra, e passa
    liberou(portao(wt, 'A', 'docs/nota.md', env));
    // B muda docs/outra.md na worktree e nao commita; o principal segue limpo: A e barrada
    fs.writeFileSync(path.join(wt, 'docs', 'outra.md'), 'mudado por B\n');
    escreveu(wt, 'B', 'docs/outra.md', env);
    const r = portao(wt, 'A', 'docs/outra.md', env);
    assert.ok(negou(r), 'a sessao A devia ser barrada pelo toque de B na worktree');
    assert.ok(motivoDe(r).includes('O arquivo docs/outra.md foi alterado por outra sessao'), motivoDe(r));
  } finally {
    // a limpeza que falha nao troca o erro do assert pelo dela
    try { comum.git(dir, ['worktree', 'remove', '--force', wt]); } catch (err) { /* so a limpeza */ }
  }
});

test('toques: fora de um repositorio git, o toque vale sozinho', () => {
  const tmp = comum.temporaria('sworn-toq-');
  const env = comum.ambiente({ SWORN_TMP: tmp });
  const dir = comum.temporaria('sworn-toq-sem-git-');
  fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify(PROJETO));
  gravarSessao(tmp, 'A', { inicioMs: Date.now() - 60000 });
  escreveu(dir, 'B', 'nota.md', env);
  assert.ok(negou(portao(dir, 'A', 'nota.md', env)), 'sem o git status, o toque basta');
});

test('toques: a abertura grava a hora uma vez, e a reabertura a mantem', () => {
  const tmp = comum.temporaria('sworn-toq-');
  const env = comum.ambiente({ SWORN_TMP: tmp });
  const dir = comum.repo(comum.temporaria('sworn-toq-ab-'), { 'a.md': 'a\n', '.claude/sworn/projeto.json': JSON.stringify(PROJETO) });
  const antes = Date.now();
  const q = path.join(tmp, 'sworn', 'Q.json');
  const r1 = comum.ganchoComoProcesso('scripts/abertura.js',
    { session_id: 'Q', cwd: dir, hook_event_name: 'SessionStart', source: 'startup' }, { env: env });
  assert.strictEqual(r1.status, 0, r1.stderr);
  const lido = JSON.parse(fs.readFileSync(q, 'utf8'));
  assert.ok(Number.isFinite(lido.inicioMs) && lido.inicioMs >= antes && lido.inicioMs <= Date.now(), String(lido.inicioMs));
  const r2 = comum.ganchoComoProcesso('scripts/abertura.js',
    { session_id: 'Q', cwd: dir, hook_event_name: 'SessionStart', source: 'compact' }, { env: env });
  assert.strictEqual(r2.status, 0, r2.stderr);
  assert.strictEqual(JSON.parse(fs.readFileSync(q, 'utf8')).inicioMs, lido.inicioMs);
  // o fecho do turno com trabalho regrava o estado so com os campos da sessao: a hora tem de atravessar
  fs.writeFileSync(q, JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(q, 'utf8')), { trabalhoReal: true })));
  const rf = comum.ganchoComoProcesso('scripts/portao-fecho.js',
    { session_id: 'Q', cwd: dir, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'ok' }, { env: env });
  assert.strictEqual(rf.status, 0, rf.stderr);
  const depoisDoFecho = JSON.parse(fs.readFileSync(q, 'utf8'));
  assert.strictEqual(depoisDoFecho.inicioMs, lido.inicioMs, 'o fecho do turno apagou a hora: ' + JSON.stringify(depoisDoFecho));
  // a sessao de antes da V3 (foto sem hora) ganha a hora na reabertura
  gravarSessao(tmp, 'V', { gitAbertura: [] });
  const rv = comum.ganchoComoProcesso('scripts/abertura.js',
    { session_id: 'V', cwd: dir, hook_event_name: 'SessionStart', source: 'resume' }, { env: env });
  assert.strictEqual(rv.status, 0, rv.stderr);
  assert.ok(Number.isFinite(JSON.parse(fs.readFileSync(path.join(tmp, 'sworn', 'V.json'), 'utf8')).inicioMs));
});
