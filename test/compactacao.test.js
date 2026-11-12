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

// R3g (s369, pedido do dono 2026-11-12: "isso tem que ser automatico, no plugin, para qualquer projeto"): a abertura
// da sessao grava o ponto uma vez por projeto - repositorio git aberto na raiz, com ou sem projeto.json -, o arquivo
// pessoal fica fora do git, e o que o dono ja decidiu (valor proprio, chave apagada, variavel no ambiente) fica.
const comum = require('./lib/comum.js');
// os repositorios de brinquedo assinam com um autor de ensaio, nao com a identidade da maquina (test/lib/comum.js)
comum.identidadeDeEnsaio();
const abrirEm = (dir, env, source) => comum.rodar('scripts/abertura.js', [],
  { cwd: dir, entrada: { session_id: 'r3g-' + path.basename(dir), cwd: dir, source: source || 'startup' }, env: env });
// a abertura rodou ate o fim: saiu 0 e o bloco fixo do fim (qualidade de resposta, sai com ou sem projeto.json) veio
const abriu = (r, onde) => {
  assert.strictEqual(r.status, 0, onde + ': ' + r.stderr);
  assert.match(r.stdout, /qualidade de resposta/, onde + ': a abertura parou antes do fim');
  return r;
};
// sem o ignore global da maquina (o Claude Code poe o settings.local.json nele): o teste ve o info/exclude
const semIgnoreGlobal = (dir) => {
  const vazio = path.join(comum.pasta('r3g-ignore'), 'ignore');
  fs.writeFileSync(vazio, '');
  comum.git(dir, ['config', 'core.excludesFile', vazio]);
  return dir;
};
// a pasta de config e o estado de cada teste sao novos e vazios (comum.pasta e mkdtemp); a variavel do processo sai
const config = () => ({ CLAUDE_CONFIG_DIR: comum.pasta('r3g-config'), SWORN_TMP: comum.pasta('r3g-estado'),
  CLAUDE_CODE_AUTO_COMPACT_WINDOW: '' });
const feitos = (env) => path.join(env.CLAUDE_CONFIG_DIR, 'sworn', 'compactacao-gravada.json');
const chave = (dir) => fs.realpathSync.native(dir);

test('R3g: a abertura grava o ponto num repositorio sem projeto.json, fora do git, e diz o valor', () => {
  const dir = semIgnoreGlobal(comum.repo(comum.pasta('r3g-repo'), { 'a.txt': 'a\n' }));
  const env = config();
  const r = abriu(abrirEm(dir, env), 'primeira');
  assert.deepStrictEqual(JSON.parse(ler(settings(dir))), { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '333000' } });
  const linha = r.stdout.split('\n').find((l) => /compactacao automatica/.test(l)) || '';
  for (const parte of ['333000', '.claude/settings.local.json', '/.claude/settings.local.json do .git/info/exclude',
    'proxima sessao', 'apague a chave CLAUDE_CODE_AUTO_COMPACT_WINDOW']) {
    assert.ok(linha.includes(parte), 'a linha da abertura diz ' + parte + ': ' + linha);
  }
  assert.strictEqual(comum.git(dir, ['status', '--porcelain']), '', 'o arquivo pessoal nao aparece no git');
  assert.deepStrictEqual(JSON.parse(ler(feitos(env))).raizes, [chave(dir)], 'o projeto entrou na lista');
  // a segunda abertura nao fala de novo nem regrava
  const gravado = ler(settings(dir));
  const de2 = abriu(abrirEm(dir, env), 'segunda');
  assert.doesNotMatch(de2.stdout, /compactacao automatica/);
  assert.strictEqual(ler(settings(dir)), gravado);
});

test('R3g: com projeto.json, o limiar dele manda (300 mil -> 383000)', () => {
  const dir = comum.repo(comum.pasta('r3g-proj'), {
    '.claude/sworn/projeto.json': JSON.stringify({ shell: 'bash', limiares: { tokensDeContexto: 300000 } }) });
  abriu(abrirEm(dir, config()), 'projeto');
  assert.strictEqual(JSON.parse(ler(settings(dir))).env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '383000');
});

test('R3g: o que o dono decidiu fica - chave apagada, valor proprio, variavel no ambiente', () => {
  const env = config();
  const apagada = comum.repo(comum.pasta('r3g-apagada'), { 'a.txt': 'a\n' });
  abriu(abrirEm(apagada, env), 'apagada 1');
  assert.strictEqual(JSON.parse(ler(settings(apagada))).env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '333000',
    'a 1a abertura gravou: a chave que o dono apaga existia');
  escrever(settings(apagada), JSON.stringify({ env: {} }));
  abriu(abrirEm(apagada, env), 'apagada 2');
  assert.deepStrictEqual(JSON.parse(ler(settings(apagada))), { env: {} }, 'a chave apagada nao volta');
  const propria = comum.repo(comum.pasta('r3g-propria'), { 'a.txt': 'a\n' });
  escrever(settings(propria), JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '500000' } }));
  const p = abriu(abrirEm(propria, env), 'propria');
  assert.strictEqual(JSON.parse(ler(settings(propria))).env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '500000');
  assert.doesNotMatch(p.stdout, /compactacao automatica/);
  assert.ok(JSON.parse(ler(feitos(env))).raizes.includes(chave(propria)), 'a regra rodou: o projeto entrou na lista');
  const noAmbiente = comum.repo(comum.pasta('r3g-ambiente'), { 'a.txt': 'a\n' });
  abriu(abrirEm(noAmbiente, Object.assign({}, env, { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '400000' })), 'ambiente');
  assert.ok(!fs.existsSync(settings(noAmbiente)), 'a variavel do ambiente e do dono');
  // controle: o mesmo repositorio, sem a variavel, grava - o caso acima nao passou por outro motivo
  abriu(abrirEm(noAmbiente, env), 'ambiente, controle');
  assert.ok(fs.existsSync(settings(noAmbiente)), 'controle do ambiente');
});

test('R3g: subpasta sem projeto.json, pasta fora do git e a reabertura da compactacao nao gravam', () => {
  const env = config();
  const dir = comum.repo(comum.pasta('r3g-sub'), { 'sub/a.txt': 'a\n' });
  abriu(abrirEm(path.join(dir, 'sub'), env), 'subpasta');
  assert.ok(!fs.existsSync(settings(path.join(dir, 'sub'))) && !fs.existsSync(settings(dir)), 'subpasta');
  // controle: a raiz do mesmo repositorio grava, na mesma config
  abriu(abrirEm(dir, env), 'subpasta, controle');
  assert.ok(fs.existsSync(settings(dir)), 'controle da subpasta');
  const solta = comum.pasta('r3g-solta');
  abriu(abrirEm(solta, env), 'fora do git');
  assert.ok(!fs.existsSync(settings(solta)), 'fora do git');
  // controle: a mesma pasta, virando repositorio, grava
  comum.git(solta, ['init', '-q']);
  abriu(abrirEm(solta, env), 'fora do git, controle');
  assert.ok(fs.existsSync(settings(solta)), 'controle de fora do git');
  const comp = comum.repo(comum.pasta('r3g-compact'), { 'a.txt': 'a\n' });
  abriu(abrirEm(comp, env, 'compact'), 'compact');
  assert.ok(!fs.existsSync(settings(comp)), 'compact');
  // controle: a raiz do mesmo repositorio grava, na mesma config
  abriu(abrirEm(comp, env, 'startup'), 'compact, controle');
  assert.ok(fs.existsSync(settings(comp)), 'controle da compactacao');
});

test('R3g: arquivo torto nao grava, diz o erro, nao entra na lista e a abertura seguinte tenta de novo', () => {
  const env = config();
  const dir = comum.repo(comum.pasta('r3g-torto'), { 'a.txt': 'a\n' });
  escrever(settings(dir), '{ torto');
  const r = abriu(abrirEm(dir, env), 'torto');
  assert.match(r.stdout, /nao gravou: \.claude\/settings\.local\.json nao e JSON valido[^\n]*corrija o arquivo\. A proxima abertura de sessao tenta de novo\./);
  assert.strictEqual(ler(settings(dir)), '{ torto');
  assert.ok(!fs.existsSync(feitos(env)), 'a lista volta como estava (ausente)');
  escrever(settings(dir), '{}');
  abriu(abrirEm(dir, env), 'consertado');
  assert.strictEqual(JSON.parse(ler(settings(dir))).env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '333000');
});

test('R3g: lista dos feitos que nao se le nao se sobrescreve nem grava o ponto', () => {
  const env = config();
  const dir = comum.repo(comum.pasta('r3g-lista'), { 'a.txt': 'a\n' });
  escrever(feitos(env), '{ "raizes": ["/outro"');
  const r = abriu(abrirEm(dir, env), 'lista torta');
  assert.match(r.stdout, /a lista dos projetos com o ponto da compactacao automatica nao se le/);
  assert.strictEqual(ler(feitos(env)), '{ "raizes": ["/outro"');
  assert.ok(!fs.existsSync(settings(dir)));
});

test('R3g: link simbolico no caminho do arquivo pessoal nao se segue', (t) => {
  // a pasta .claude e o link (junction no Windows, que nao pede privilegio; symlink no resto)
  const dir = comum.repo(comum.pasta('r3g-link'), { 'a.txt': 'a\n' });
  const fora = comum.pasta('r3g-fora');
  try { fs.symlinkSync(fora, path.join(dir, '.claude'), process.platform === 'win32' ? 'junction' : 'dir'); } catch (e) {
    t.skip('esta maquina nao cria link (' + e.code + ')');
    return;
  }
  const env = config();
  const r = abriu(abrirEm(dir, env), 'link');
  assert.ok(!fs.existsSync(path.join(fora, 'settings.local.json')), 'nada se gravou no destino do link');
  // o dono fica sabendo, uma vez, e de como gravar
  assert.match(r.stdout, /nao foi gravado neste projeto: a pasta \.claude ou o \.claude\/settings\.local\.json e um link/);
  assert.ok(r.stdout.includes('tire ' + chave(dir) + ' da lista ' + feitos(env)), r.stdout);
  // quem liga a pasta .claude de proposito nao ouve o aviso a cada abertura
  assert.doesNotMatch(abriu(abrirEm(dir, env), 'link 2').stdout, /compactacao automatica/);
  // o /sworn:init e o calibrar.js (gravarNoClaude) tambem nao gravam pelo link, e dizem por que
  const g = compactacao.gravarNoClaude(dir, 250000);
  assert.strictEqual(g.gravou, false);
  assert.match(g.erro, /e um link \(atalho\) que leva para fora do projeto/);
  assert.ok(!fs.existsSync(path.join(fora, 'settings.local.json')), 'nem pelo gravarNoClaude');
  // controle: sem o link e fora da lista, como o aviso manda, o mesmo repositorio grava na mesma config
  try { fs.unlinkSync(path.join(dir, '.claude')); } catch (e) { fs.rmdirSync(path.join(dir, '.claude')); }
  fs.rmSync(feitos(env));
  abriu(abrirEm(dir, env), 'link, controle');
  assert.ok(fs.existsSync(settings(dir)), 'controle do link');
});

test('R3g: lista que existe mas nao se le (uma pasta no lugar) avisa e nao grava nada', () => {
  const env = config();
  const dir = comum.repo(comum.pasta('r3g-lista-pasta'), { 'a.txt': 'a\n' });
  fs.mkdirSync(feitos(env), { recursive: true });
  const r = abriu(abrirEm(dir, env), 'lista pasta');
  assert.match(r.stdout, /a lista dos projetos com o ponto da compactacao automatica nao se le \([^)]*: /);
  assert.ok(fs.statSync(feitos(env)).isDirectory(), 'a lista ficou como estava');
  assert.ok(!fs.existsSync(settings(dir)));
});

test('R3g: a restauracao da lista que falha diz como tentar de novo, sem prometer que tenta sozinha', () => {
  const env = config();
  const dir = comum.repo(comum.pasta('r3g-restaura'), { 'a.txt': 'a\n' });
  escrever(settings(dir), '{ torto');
  const original = fs.rmSync;
  fs.rmSync = function (alvo) {
    if (String(alvo) === feitos(env)) throw Object.assign(new Error('preso'), { code: 'EBUSY' });
    return original.apply(this, arguments);
  };
  let linha;
  try { linha = compactacao.gravarNaAbertura(dir, null, env); } finally { fs.rmSync = original; }
  assert.match(linha, /ficou com este projeto/);
  assert.ok(linha.includes('tire ' + chave(dir) + ' de la'), linha);
  assert.doesNotMatch(linha, /A proxima abertura de sessao tenta de novo/);
});

test('R3g: com a lista travada por outra abertura nada se grava; solta a trava, a abertura seguinte grava', () => {
  const env = config();
  const dir = comum.repo(comum.pasta('r3g-trava'), { 'a.txt': 'a\n' });
  escrever(feitos(env) + '.trava', '');
  assert.strictEqual(compactacao.gravarNaAbertura(dir, null, env), null, 'outra sessao segura a lista');
  assert.ok(!fs.existsSync(settings(dir)) && !fs.existsSync(feitos(env)), 'nada se gravou');
  fs.rmSync(feitos(env) + '.trava');
  assert.match(compactacao.gravarNaAbertura(dir, null, env), /CLAUDE_CODE_AUTO_COMPACT_WINDOW = 333000/);
  assert.strictEqual(JSON.parse(ler(settings(dir))).env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '333000', 'gravou de fato');
  assert.deepStrictEqual(JSON.parse(ler(feitos(env))).raizes, [chave(dir)]);
  assert.ok(!fs.existsSync(feitos(env) + '.trava'), 'a trava se solta');
});

test('R3g: a lista que nao grava fica como estava, sem arquivo pela metade nem o do lado', () => {
  const env = config();
  const dir = comum.repo(comum.pasta('r3g-inteiro'), { 'a.txt': 'a\n' });
  const velha = JSON.stringify({ raizes: ['/outro'] });
  escrever(feitos(env), velha);
  const original = fs.renameSync;
  fs.renameSync = function (de, para) {
    if (String(para) === feitos(env)) throw Object.assign(new Error('disco cheio'), { code: 'ENOSPC' });
    return original.apply(this, arguments);
  };
  let linha;
  try { linha = compactacao.gravarNaAbertura(dir, null, env); } finally { fs.renameSync = original; }
  assert.match(linha, /a lista [^ ]+ nao grava \(.*disco cheio.*\)\. A proxima abertura de sessao tenta de novo\./);
  assert.strictEqual(ler(feitos(env)), velha, 'a lista dos outros projetos ficou inteira');
  assert.ok(!fs.existsSync(feitos(env) + '.novo'), 'o arquivo do lado saiu');
  assert.ok(!fs.existsSync(settings(dir)), 'sem a lista, nada se grava');
});

test('R3g: um valor vazio no arquivo nao e decisao do dono: a abertura grava o ponto', () => {
  const env = config();
  const dir = comum.repo(comum.pasta('r3g-vazio'), { 'a.txt': 'a\n' });
  escrever(settings(dir), JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: ' ' } }));
  abriu(abrirEm(dir, env), 'vazio');
  assert.strictEqual(JSON.parse(ler(settings(dir))).env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '333000');
});

test('R3g: repositorio numa pasta com espaco no fim do nome e a raiz do git (fora do Windows)', (t) => {
  if (process.platform === 'win32') { t.skip('o Windows nao aceita espaco no fim do nome da pasta'); return; }
  const env = config();
  const dir = comum.repo(path.join(comum.pasta('r3g-fim'), 'proj '), { 'a.txt': 'a\n' });
  abriu(abrirEm(dir, env), 'espaco no fim');
  assert.strictEqual(JSON.parse(ler(settings(dir))).env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '333000');
});

test('R3g: gravarNoClaude deixa o settings.local.json fora do git, numa linha so do info/exclude', () => {
  const dir = semIgnoreGlobal(comum.repo(comum.pasta('r3g-exclude'), { 'p/a.txt': 'a\n' }));
  const sub = path.join(dir, 'p');
  const g = compactacao.gravarNoClaude(sub, 250000);
  assert.strictEqual(g.gravou, true);
  assert.strictEqual(g.exclude, '/p/.claude/settings.local.json', 'o resultado diz a linha do exclude');
  compactacao.gravarNoClaude(sub, 300000);
  assert.strictEqual(comum.git(dir, ['status', '--porcelain']), '');
  const exclude = ler(path.join(dir, '.git', 'info', 'exclude'));
  assert.strictEqual(exclude.split('\n').filter((l) => l === '/p/.claude/settings.local.json').length, 1, exclude);
  // ja ignorado pelo .gitignore do projeto: o info/exclude fica como estava
  const ign = semIgnoreGlobal(comum.repo(comum.pasta('r3g-ign'), { '.gitignore': '.claude/settings.local.json\n' }));
  const antes = ler(path.join(ign, '.git', 'info', 'exclude'));
  const gi = compactacao.gravarNoClaude(ign, 250000);
  assert.strictEqual(gi.gravou, true);
  assert.strictEqual(gi.exclude, undefined);
  assert.strictEqual(ler(path.join(ign, '.git', 'info', 'exclude')), antes);
  // o .gitignore que pede o arquivo de volta vence o info/exclude: a linha nao se repete a cada gravacao
  const volta = semIgnoreGlobal(comum.repo(comum.pasta('r3g-volta'), { '.gitignore': '!.claude/settings.local.json\n' }));
  compactacao.gravarNoClaude(volta, 250000);
  compactacao.gravarNoClaude(volta, 300000);
  const ex = ler(path.join(volta, '.git', 'info', 'exclude'));
  assert.strictEqual(ex.split('\n').filter((l) => l === '/.claude/settings.local.json').length, 1, ex);
  // o gravado antes da R3g (mesmo valor, sem exclude) tambem sai do git
  const velho = semIgnoreGlobal(comum.repo(comum.pasta('r3g-velho'), { 'a.txt': 'a\n' }));
  escrever(settings(velho), JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '333000' } }));
  assert.strictEqual(compactacao.gravarNoClaude(velho, 250000).gravou, false);
  assert.strictEqual(comum.git(velho, ['status', '--porcelain']), '');
  // pasta com curinga do gitignore no nome: a linha vem escapada e casa com o arquivo
  const curinga = semIgnoreGlobal(comum.repo(comum.pasta('r3g-curinga'), { 'a[1]/a.txt': 'a\n' }));
  const gc = compactacao.gravarNoClaude(path.join(curinga, 'a[1]'), 250000);
  assert.strictEqual(gc.gravou, true);
  assert.strictEqual(gc.exclude, '/a\\[1\\]/.claude/settings.local.json');
  assert.ok(fs.existsSync(settings(path.join(curinga, 'a[1]'))));
  assert.strictEqual(comum.git(curinga, ['status', '--porcelain']), '');
  // pasta com espaco no comeco do nome: o espaco fica na linha
  const espaco = semIgnoreGlobal(comum.repo(comum.pasta('r3g-espaco'), { ' x/a.txt': 'a\n' }));
  const ge = compactacao.gravarNoClaude(path.join(espaco, ' x'), 250000);
  assert.strictEqual(ge.exclude, '/ x/.claude/settings.local.json');
  assert.strictEqual(comum.git(espaco, ['status', '--porcelain']), '');
});
