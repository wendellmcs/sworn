'use strict';
// D786 passo 1: o ponto da compactacao automatica do harness logo depois do gatilho de contexto do sworn, gravado por
// um modulo so (scripts/lib/compactacao.js) para o calibrar.js e o instalar.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const compactacao = require('../scripts/lib/compactacao.js');
const saude = require('../scripts/lib/saude.js');

const RAIZ = path.join(__dirname, '..');
const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-compactacao-'));
const settings = (dir) => path.join(dir, '.claude', 'settings.local.json');
const toml = (dir) => path.join(dir, '.codex', 'config.toml');
const escrever = (arq, texto) => {
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, texto);
};
const ler = (arq) => fs.readFileSync(arq, 'utf8');

test('compactacao: o limiar em vigor e o do medidor - gravado, modo continuo ou padrao - com a origem', () => {
  const casos = [
    [null, 250000, 'modo continuo'],
    [{ shell: 'bash' }, 250000, 'modo continuo'],
    [{ modoContinuo: true, limiares: { tokensDeContexto: 300000 } }, 300000, 'projeto.json'],
    [{ limiares: { tokensDeContexto: 0 } }, 250000, 'modo continuo'],
    [{ modoContinuo: false }, saude.LIMIARES_PADRAO.tokensDeContexto, 'padrao do plugin'],
    [{ modoContinuo: false, limiares: { tokensDeContexto: 200000 } }, 200000, 'projeto.json']
  ];
  for (const [cfg, n, de] of casos) {
    assert.deepStrictEqual(compactacao.limiarEmVigor(cfg), { n, de }, JSON.stringify(cfg));
  }
});

test('compactacao: no Claude Code, 250 mil viram a janela 333000 no env do settings.local.json; o resto fica', () => {
  const dir = pasta();
  try {
    const r = compactacao.gravarNoClaude(dir, 250000);
    assert.deepStrictEqual(r, { harness: 'claude', arquivo: '.claude/settings.local.json',
      chave: 'env.CLAUDE_CODE_AUTO_COMPACT_WINDOW', valor: 333000, gravou: true });
    assert.deepStrictEqual(JSON.parse(ler(settings(dir))), { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '333000' } });
    // o arquivo do dono, com BOM do PowerShell 5.1, outras permissoes e outra variavel
    escrever(settings(dir), '\uFEFF' + JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, env: { FOO: '1' } }));
    const de300 = compactacao.gravarNoClaude(dir, 300000);
    assert.strictEqual(de300.gravou, true);
    assert.deepStrictEqual(JSON.parse(ler(settings(dir))),
      { permissions: { allow: ['Bash(ls)'] }, env: { FOO: '1', CLAUDE_CODE_AUTO_COMPACT_WINDOW: '383000' } });
    // o mesmo valor nao regrava; outro valor diz o de antes
    const igual = compactacao.gravarNoClaude(dir, 300000);
    assert.strictEqual(igual.gravou, false);
    assert.strictEqual(igual.antes, undefined);
    assert.strictEqual(compactacao.gravarNoClaude(dir, 250000).antes, '383000');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('compactacao: a janela do Claude Code fica na faixa da documentacao, 100000 a 1000000', () => {
  const dir = pasta();
  try {
    assert.strictEqual(compactacao.gravarNoClaude(dir, 1000).valor, 100000);
    assert.strictEqual(JSON.parse(ler(settings(dir))).env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '100000');
    assert.strictEqual(compactacao.gravarNoClaude(dir, 2000000).valor, 1000000);
    assert.strictEqual(compactacao.gravarNoClaude(dir, 17000).valor, 100000);
    assert.strictEqual(compactacao.gravarNoClaude(dir, 17001).valor, 100001);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('compactacao: settings.local.json ilegivel ou fora da forma nao se sobrescreve; vem o erro com o passo', () => {
  const dir = pasta();
  try {
    for (const torto of ['{ quebrado', '[1]', '"x"', JSON.stringify({ env: ['A=1'] }), JSON.stringify({ env: null })]) {
      escrever(settings(dir), torto);
      const r = compactacao.gravarNoClaude(dir, 250000);
      assert.strictEqual(r.gravou, false, torto);
      assert.match(r.erro, /settings\.local\.json/, torto);
      assert.match(r.erro, /corrija e rode de novo$/, torto);
      assert.strictEqual(ler(settings(dir)), torto, torto + ' foi sobrescrito');
    }
    // vazio vale como {} (D460)
    escrever(settings(dir), '');
    assert.strictEqual(compactacao.gravarNoClaude(dir, 250000).gravou, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('compactacao: no Codex, model_auto_compact_token_limit = ponto no topo do .codex/config.toml do projeto', () => {
  const dir = pasta();
  try {
    const r = compactacao.gravarNoCodex(dir, 250000);
    assert.deepStrictEqual(r, { harness: 'codex', arquivo: '.codex/config.toml',
      chave: 'model_auto_compact_token_limit', valor: 300000, gravou: true });
    assert.strictEqual(ler(toml(dir)), 'model_auto_compact_token_limit = 300000\n');
    assert.strictEqual(compactacao.gravarNoCodex(dir, 250000).gravou, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('compactacao: no config.toml, a chave do topo se troca no lugar; a de dentro de uma tabela nao conta', () => {
  const dir = pasta();
  try {
    escrever(toml(dir), '# do dono\nmodel = "x"\nmodel_auto_compact_token_limit = 90000 # meu\n\n[profiles.p]\n' +
      'model_auto_compact_token_limit = 1\n');
    const r = compactacao.gravarNoCodex(dir, 250000);
    assert.strictEqual(r.antes, '90000');
    assert.strictEqual(ler(toml(dir)), '# do dono\nmodel = "x"\nmodel_auto_compact_token_limit = 300000\n\n' +
      '[profiles.p]\nmodel_auto_compact_token_limit = 1\n');
    // so na tabela: a do topo entra na 1a linha (sempre o topo do TOML), a da tabela fica
    escrever(toml(dir), '[profiles.p]\r\nmodel_auto_compact_token_limit = 1\r\n');
    assert.strictEqual(compactacao.gravarNoCodex(dir, 250000).antes, undefined);
    assert.strictEqual(ler(toml(dir)), 'model_auto_compact_token_limit = 300000\r\n[profiles.p]\r\n' +
      'model_auto_compact_token_limit = 1\r\n');
    // BOM fica na frente
    escrever(toml(dir), '\uFEFFmodel = "x"\n');
    compactacao.gravarNoCodex(dir, 250000);
    assert.strictEqual(ler(toml(dir)), '\uFEFFmodel_auto_compact_token_limit = 300000\nmodel = "x"\n');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('compactacao: o Codex so entra quando o instalar.js gravou os ganchos dele no projeto', () => {
  const dir = pasta();
  try {
    assert.deepStrictEqual(compactacao.gravarPontos(dir, 250000).map((p) => p.harness), ['claude']);
    assert.ok(!fs.existsSync(toml(dir)));
    escrever(path.join(dir, '.claude', 'sworn', 'ligado', 'codex', 'instalado.json'), '{}');
    assert.deepStrictEqual(compactacao.gravarPontos(dir, 250000).map((p) => [p.harness, p.valor]),
      [['claude', 333000], ['codex', 300000]]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── os chamadores ────────────────────────────────────────────────────────

function calibrar(args, cwd) {
  const env = Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: path.join(cwd, 'sem-config') });
  return spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'calibrar.js')].concat(args),
    { cwd: cwd, encoding: 'utf8', env: env });
}
const projeto = (dir) => path.join(dir, '.claude', 'sworn', 'projeto.json');

test('calibrar.js --ponto: grava o ponto do limiar em vigor e nao mexe no projeto.json', () => {
  const dir = pasta();
  try {
    const cfg = JSON.stringify({ shell: 'bash', limiares: { tokensDeContexto: 300000 } });
    escrever(projeto(dir), cfg);
    const r = calibrar(['--ponto'], dir);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.deepStrictEqual(JSON.parse(r.stdout).compactacao.map((p) => [p.harness, p.valor, p.gravou]),
      [['claude', 383000, true]]);
    assert.strictEqual(JSON.parse(ler(settings(dir))).env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '383000');
    assert.strictEqual(ler(projeto(dir)), cfg);
    // settings.local.json torto: sai 1 com o erro, sem sobrescrever
    escrever(settings(dir), '{ quebrado');
    const ruim = calibrar(['--ponto'], dir);
    assert.strictEqual(ruim.status, 1, ruim.stdout);
    assert.match(JSON.parse(ruim.stdout).compactacao[0].erro, /settings\.local\.json/);
    assert.strictEqual(ler(settings(dir)), '{ quebrado');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('calibrar.js --gravar e --manter levam o ponto junto com o limiar', () => {
  const dir = pasta();
  try {
    escrever(projeto(dir), JSON.stringify({ shell: 'bash' }));
    const g = calibrar(['--gravar', '300000'], dir);
    assert.strictEqual(g.status, 0, g.stdout + g.stderr);
    assert.strictEqual(JSON.parse(g.stdout).compactacao[0].valor, 383000);
    assert.strictEqual(JSON.parse(ler(settings(dir))).env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '383000');
    escrever(projeto(dir), JSON.stringify({ shell: 'bash' }));
    const m = calibrar(['--manter'], dir);
    assert.strictEqual(m.status, 0, m.stdout + m.stderr);
    assert.strictEqual(JSON.parse(m.stdout).compactacao[0].antes, '383000');
    assert.strictEqual(JSON.parse(ler(settings(dir))).env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '333000');
    // --ponto junto com --gravar nao descarta o --gravar (R1 da revisao, s332)
    const junto = calibrar(['--ponto', '--gravar', '200000'], dir);
    assert.strictEqual(junto.status, 0, junto.stdout + junto.stderr);
    assert.strictEqual(JSON.parse(ler(projeto(dir))).limiares.tokensDeContexto, 200000);
    assert.strictEqual(JSON.parse(ler(settings(dir))).env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '283000');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('instalar.js: o Codex ganha o ponto da compactacao no .codex/config.toml; o Qwen nao ganha chave', () => {
  const tmp = pasta();
  const antes = process.env.SWORN_TMP;
  process.env.SWORN_TMP = path.join(tmp, 'estado');
  try {
    const instalar = require('../scripts/instalar.js');
    const p = { projeto: path.join(tmp, 'proj'), home: path.join(tmp, 'conta'), raiz: RAIZ };
    fs.mkdirSync(p.projeto, { recursive: true });
    fs.mkdirSync(p.home, { recursive: true });
    escrever(projeto(p.projeto), JSON.stringify({ shell: 'bash', limiares: { tokensDeContexto: 200000 } }));
    const r = instalar.instalar('codex', p);
    assert.strictEqual(ler(toml(p.projeto)), 'model_auto_compact_token_limit = 250000\n');
    assert.ok(r.gravados.includes(toml(p.projeto)), r.gravados.join('\n'));
    instalar.instalar('qwen', p);
    assert.ok(!/autoCompact|compact/i.test(ler(path.join(p.projeto, '.qwen', 'settings.json'))));
    // config.toml que nao se le vira passo, sem derrubar o resto
    fs.rmSync(toml(p.projeto));
    fs.mkdirSync(toml(p.projeto));
    const torto = instalar.instalar('codex', p);
    assert.ok(torto.passos.some((s) => s.includes('config.toml')), torto.passos.join('\n'));
  } finally {
    if (antes === undefined) delete process.env.SWORN_TMP; else process.env.SWORN_TMP = antes;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
