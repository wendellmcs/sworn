'use strict';
// F4e: um guia curto por familia de modelo Claude (modelos/claude/<familia>.md), destilado das paginas oficiais da
// Anthropic ("Prompting Claude <modelo>" e "What's new in <modelo>"), com a fonte, a data da leitura e a impressao
// digital de cada pagina; a secao "How to ask" e o que entra no pedido do subagente que roda naquele modelo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const guias = require('../scripts/lib/guias-modelo.js');

const os = require('node:os');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const ABERTURA = path.join(RAIZ, 'scripts', 'abertura.js');
const CLI = path.join(RAIZ, 'scripts', 'modelos.js');

/** Copia os quatro guias de verdade para `dir`/modelos/claude, com o dia de leitura trocado por `dia`. */
function copiarGuias(dir, dia) {
  fs.mkdirSync(path.join(dir, 'modelos', 'claude'), { recursive: true });
  for (const f of guias.FAMILIAS) {
    fs.writeFileSync(path.join(dir, 'modelos', 'claude', f + '.md'),
      guias.ler(RAIZ, f).texto.replace(/\| read \d{4}-\d{2}-\d{2} \|/g, '| read ' + dia + ' |'));
  }
  return dir;
}

function guiaDeTeste(extra) {
  return [
    '# Claude Opus - usage guide',
    'model: claude-opus-5-5',
    'source: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5.md | read 2026-11-13 | fingerprint 6171e5c0ada4178c',
    '',
    '## What it is for',
    '- Most workloads. [1]',
    '## Recommended effort',
    '- Start at high. [2]',
    '## What to ask',
    '- Long agentic tasks. [1]',
    '## How to ask',
    '- State the goal and the stopping point before the steps. [2]',
    '- Report progress in one line between tool calls. [1]',
    '## What to avoid',
    '- Asking for exhaustive exploration of every file. [2]',
    '## Citations',
    '[1] source 1: "start with Claude Opus 5.5 for most workloads"',
    '[2] source 1: "Calibrate effort"',
    extra || ''
  ].join('\n');
}

test('F4e guias: as quatro familias tem guia no formato, dentro do teto, com fonte oficial', () => {
  assert.deepStrictEqual(guias.FAMILIAS, ['haiku', 'sonnet', 'opus', 'fable']);
  for (const f of guias.FAMILIAS) {
    const g = guias.ler(RAIZ, f);
    assert.ok(!g.erro, f + ': ' + g.erro);
    assert.deepStrictEqual(guias.conferirFormato(g.texto), [], f);
    assert.ok(g.fontes.length >= 1 && g.fontes.every(function (s) { return /^https:\/\/platform\.claude\.com\/docs\//.test(s.url); }), f);
    assert.match(g.modelo, new RegExp('^claude-' + f + '-'), f);
  }
});

test('F4e guias: o formato reprova secao faltando, fonte torta, citacao sem entrada e guia acima do teto', () => {
  assert.deepStrictEqual(guias.conferirFormato(guiaDeTeste()), []);
  assert.match(guias.conferirFormato(guiaDeTeste().replace('## What to avoid', '## Other')).join(' | '), /falta a secao "## What to avoid"/);
  assert.match(guias.conferirFormato(guiaDeTeste().replace('fingerprint 6171e5c0ada4178c', 'fingerprint xyz')).join(' | '), /linha source/);
  assert.match(guias.conferirFormato(guiaDeTeste().replace(/^source: .*$/m, '')).join(' | '), /sem linha source/);
  assert.match(guias.conferirFormato(guiaDeTeste().replace(/^model: .*$/m, '')).join(' | '), /sem linha model/);
  assert.match(guias.conferirFormato(guiaDeTeste().replace('stopping point before the steps. [2]', 'stopping point. [7]')).join(' | '), /\[7\] sem entrada em ## Citations/);
  assert.match(guias.conferirFormato(guiaDeTeste().replace('[2] source 1:', '[2] source 3:')).join(' | '), /\[2\] cita a source 3/);
  assert.match(guias.conferirFormato(guiaDeTeste('x'.repeat(guias.TETO_DO_GUIA))).join(' | '), /bytes; o teto do guia e/);
  const comprido = guiaDeTeste().replace('- Report progress', '- ' + 'y'.repeat(guias.TETO_DO_PEDIDO) + '\n- Report progress');
  assert.match(guias.conferirFormato(comprido).join(' | '), /How to ask.*bytes; o teto do bloco do pedido e/);
});

test('F4e guias: o bloco do pedido e a secao "How to ask" sem as citacoes, com o modelo e a fonte', () => {
  const b = guias.blocoDoTexto(guiaDeTeste());
  assert.match(b, /^Guidance for claude-opus-5-5 \(from Anthropic's official prompting guide\):\n/);
  assert.match(b, /^- State the goal and the stopping point before the steps\.$/m);
  assert.match(b, /^- Report progress in one line between tool calls\.$/m);
  assert.ok(!/\[\d+\]/.test(b), 'sem as marcas de citacao');
  assert.ok(!/Long agentic tasks|exhaustive/.test(b), 'so a secao How to ask');
  assert.ok(Buffer.byteLength(b, 'utf8') <= guias.TETO_DO_PEDIDO);
  for (const f of guias.FAMILIAS) {
    const real = guias.bloco(RAIZ, f);
    assert.ok(real.length > 0 && Buffer.byteLength(real, 'utf8') <= guias.TETO_DO_PEDIDO, f);
  }
  assert.strictEqual(guias.bloco(RAIZ, 'gpt'), '', 'familia desconhecida: nada');
  assert.strictEqual(guias.bloco(path.join(RAIZ, 'nao-existe'), 'opus'), '', 'guia que nao se le: nada');
  const torto = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-f4e-torto-'));
  try {
    fs.mkdirSync(path.join(torto, 'modelos', 'claude'), { recursive: true });
    fs.writeFileSync(path.join(torto, 'modelos', 'claude', 'opus.md'), guiaDeTeste().replace('## What to avoid', '## Other'));
    assert.strictEqual(guias.bloco(torto, 'opus'), '', 'guia fora do formato: nada entra no pedido');
    fs.writeFileSync(path.join(torto, 'modelos', 'claude', 'opus.md'), guiaDeTeste());
    assert.strictEqual(guias.bloco(torto, 'opus'), b, 'o mesmo guia no formato entra');
  } finally {
    fs.rmSync(torto, { recursive: true, force: true });
  }
});

test('F4e guias: cada citacao e um trecho literal da pagina citada (com a pagina salva); o que nao confere aparece', () => {
  const pagina = '# Prompting\n\nIf unsure, start with Claude Opus 5.5 for most workloads.\n\n## Calibrate effort\n';
  assert.deepStrictEqual(guias.citacoesQueNaoConferem(guiaDeTeste(), [pagina]), []);
  const torta = guiaDeTeste().replace('"Calibrate effort"', '"Calibrated efforts"');
  assert.deepStrictEqual(guias.citacoesQueNaoConferem(torta, [pagina]), ['[2] "Calibrated efforts" nao esta na source 1']);
  // aspas e espacos tipograficos da pagina nao contam como diferenca
  assert.deepStrictEqual(guias.citacoesQueNaoConferem(guiaDeTeste(), [pagina.replace('most workloads', 'most\n workloads')]), []);
  const curva = guiaDeTeste().replace('"start with Claude Opus 5.5 for most workloads"', '"you\'re unsure"');
  assert.deepStrictEqual(guias.citacoesQueNaoConferem(curva, ['If you’re unsure, ... Calibrate effort']), []);
});

test('F4e guias: a familia do despacho vem do pedido, do padrao do agente ou, com inherit, da sessao', () => {
  assert.strictEqual(guias.familiaDoDespacho('opus', 'sonnet', 'haiku'), 'opus');
  assert.strictEqual(guias.familiaDoDespacho('claude-haiku-5-5', 'sonnet', 'opus'), 'haiku', 'o id vale pelo apelido');
  assert.strictEqual(guias.familiaDoDespacho('Sonnet', null, 'opus'), 'sonnet', 'a caixa nao conta');
  assert.strictEqual(guias.familiaDoDespacho('', 'sonnet', 'opus'), 'sonnet', 'sem pedido, o do agente');
  assert.strictEqual(guias.familiaDoDespacho(undefined, null, 'fable'), 'fable', 'agente sem modelo herda a sessao');
  assert.strictEqual(guias.familiaDoDespacho('Inherit', 'haiku', 'opus'), 'opus', 'inherit e a sessao');
  assert.strictEqual(guias.familiaDoDespacho(undefined, 'inherit', 'sonnet'), 'sonnet', 'o agente com inherit herda');
  assert.strictEqual(guias.familiaDoDespacho('inherit', null, ''), '', 'sessao desconhecida: nada');
  assert.strictEqual(guias.familiaDoDespacho('gpt-5', 'sonnet', 'opus'), '', 'modelo de fora: nada');
  assert.strictEqual(guias.familiaDoDespacho(undefined, null, 'gpt'), '', 'sessao de fora: nada');
  assert.match(guias.ler(RAIZ, '../claude/opus').erro, /familia desconhecida/, 'so as quatro familias, nunca um caminho');
});

// G4e parte 5: a ordem da doc oficial dos subagentes: o `model` do despacho, o da definicao (inherit tambem), a
// variavel CLAUDE_CODE_SUBAGENT_MODEL, a sessao; com CLAUDE_CODE_SUBAGENT_MODEL_FORCE ligada, a variavel vale sobre tudo
test('G4e guias: a variavel do modelo do subagente entra so onde o pedido e a definicao nao dizem', () => {
  const f = guias.familiaDoDespacho;
  const env = function (modelo, forca) {
    const e = { CLAUDE_CODE_SUBAGENT_MODEL: modelo };
    if (forca !== undefined) e.CLAUDE_CODE_SUBAGENT_MODEL_FORCE = forca;
    return { env: e };
  };
  assert.strictEqual(f(undefined, null, 'opus', env('haiku')), 'haiku', 'agente sem modelo: a variavel antes da sessao');
  assert.strictEqual(f(undefined, null, 'opus', env('claude-sonnet-5-5')), 'sonnet', 'a variavel com id vale pelo apelido');
  assert.strictEqual(f(undefined, null, 'opus', env('  ')), 'opus', 'variavel so de espaco: a sessao');
  assert.strictEqual(f(undefined, null, 'opus', env('inherit')), 'opus', 'variavel inherit: a sessao');
  assert.strictEqual(f(undefined, null, 'opus', env('gpt-5')), '', 'variavel de fora: nada');
  assert.strictEqual(f(undefined, 'sonnet', 'opus', env('haiku')), 'sonnet', 'a definicao vale sobre a variavel');
  assert.strictEqual(f(undefined, 'inherit', 'opus', env('haiku')), 'opus', 'a definicao com inherit tambem');
  assert.strictEqual(f('sonnet', null, 'opus', env('haiku')), 'sonnet', 'o pedido vale sobre a variavel');
  ['1', 'true', 'YES', ' on '].forEach(function (v) {
    assert.strictEqual(f('sonnet', 'opus', 'opus', env('haiku', v)), 'haiku', 'forcada com ' + JSON.stringify(v));
  });
  ['0', 'false', '', 'sim'].forEach(function (v) {
    assert.strictEqual(f('sonnet', 'opus', 'opus', env('haiku', v)), 'sonnet', 'nao forcada com ' + JSON.stringify(v));
  });
  assert.strictEqual(f('sonnet', null, 'opus', { env: { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' } }), 'sonnet',
    'forca sem a variavel: nada muda');
  assert.strictEqual(f(undefined, null, 'opus', { env: {} }), 'opus');
  assert.strictEqual(f(undefined, null, 'opus', {}), 'opus', 'sem env: como antes');
  // sem definicao conhecida (o agente nao foi achado): so o pedido ou a variavel forcada dizem o modelo
  const sem = function (o) { return Object.assign({ semDefinicao: true }, o); };
  assert.strictEqual(f(undefined, null, 'opus', sem(env('haiku'))), '', 'sem definicao, a variavel sozinha nao diz');
  assert.strictEqual(f('', null, 'opus', sem({})), '', 'sem definicao e sem pedido: nada');
  assert.strictEqual(f('sonnet', null, 'opus', sem(env('haiku'))), 'sonnet', 'sem definicao, o pedido diz');
  assert.strictEqual(f('inherit', null, 'opus', sem({})), 'opus', 'sem definicao, o pedido inherit e a sessao');
  assert.strictEqual(f(undefined, null, 'opus', sem(env('haiku', '1'))), 'haiku', 'sem definicao, a forcada diz');
});

test('F4e guias: o guia entra no fim do pedido, uma vez so, e a tarefa vale mais que ele', () => {
  const g = guias.blocoDoTexto(guiaDeTeste());
  const p = guias.comGuia('Your lens is X.', g);
  assert.ok(p.startsWith('Your lens is X.\n\n' + g + '\n'), p);
  assert.match(p.slice(p.indexOf(g) + g.length), /^\nWhere this guidance conflicts with the task above, the task wins\.$/);
  assert.strictEqual(guias.comGuia(p, g), p, 'o pedido que ja leva um guia fica como veio');
  assert.strictEqual(guias.comGuia('x', ''), 'x', 'sem guia, o pedido fica');
  assert.ok(guias.comGuia('', g).startsWith(g), 'pedido vazio: so o guia');
});

test('F4e guias: a abertura traz o guia do modelo da sessao (pelo campo model ou pela transcricao)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-f4e-'));
  try {
    const abrir = function (nome, entrada, projeto) {
      const dir = path.join(tmp, nome);
      fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'),
        JSON.stringify(Object.assign({ versaoConfig: 1, provaDePronto: 'node --test' }, projeto || {})), 'utf8');
      const r = spawnSync(process.execPath, [ABERTURA], {
        input: JSON.stringify(Object.assign({ session_id: 'f4e-' + nome, cwd: dir, source: 'startup' }, entrada)),
        encoding: 'utf8', env: Object.assign({}, process.env, { SWORN_TMP: path.join(tmp, '_sessoes') }), timeout: 30000
      });
      assert.strictEqual(r.status, 0, r.stderr);
      return r.stdout;
    };
    const titulo = /^# sworn - guia do modelo da sessao \(claude-opus-5-5\)/m;
    const opus = abrir('opus', { model: 'claude-opus-5-5' });
    assert.match(opus, titulo);
    assert.ok(opus.includes(guias.bloco(RAIZ, 'opus')), 'o bloco do guia do Opus, inteiro');
    assert.ok(abrir('um', { model: 'claude-opus-5-5[1m]' }).includes(guias.bloco(RAIZ, 'opus')), 'o sufixo [1m] nao conta');
    // sem o campo model (depois do /clear), a ultima resposta da transcricao
    const transcricao = path.join(tmp, 't.jsonl');
    fs.writeFileSync(transcricao, JSON.stringify({ type: 'assistant', message: { model: 'claude-haiku-5-5', content: [] } }) + '\n');
    assert.ok(abrir('haiku', { transcript_path: transcricao }).includes(guias.bloco(RAIZ, 'haiku')));
    // sem saber o modelo, com modelo de fora, com a chave desligada ou na abertura enxuta: sem o guia
    for (const [nome, entrada, projeto] of [['nada', {}], ['fora', { model: 'gpt-5' }],
      ['desligado', { model: 'claude-opus-5-5' }, { guiaDoModelo: false }],
      ['enxuta', { model: 'claude-opus-5-5' }, { aberturaEnxuta: true }]]) {
      assert.ok(!/# sworn - guia do modelo da sessao/.test(abrir(nome, entrada, projeto)), nome);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// F4e3: a renovacao - a conferencia le as paginas (aqui, falsas: sem rede), compara pela impressao digital e acha o
// modelo novo no "Models overview"; a abertura do repositorio do plugin lembra quando a ultima passa de 30 dias.
const ATUAIS = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', fable: 'claude-fable-5-2' };

test('F4e guias: o modelo novo e o id da mesma familia com versao acima da do guia', () => {
  const overview = 'Latest: claude-opus-5-6 and claude-opus-5-5. Legacy: claude-opus-4-1, claude-haiku-4-5-20251001,\n' +
    '`claude-sonnet-6` (new), claude-opus-5-6 again, claude-fable-5-2, claude-gpt-9, claude-haiku-5-5-20261101.';
  assert.deepStrictEqual(guias.modelosNovos(overview, ATUAIS), [
    { familia: 'opus', id: 'claude-opus-5-6', atual: 'claude-opus-5-5' },
    { familia: 'sonnet', id: 'claude-sonnet-6', atual: 'claude-sonnet-5-5' }
  ]);
  assert.deepStrictEqual(guias.modelosNovos('claude-opus-5-5 claude-fable-5-1', ATUAIS), [], 'o mesmo ou mais velho: nada');
  assert.deepStrictEqual(guias.modelosNovos('claude-opus-6 claude-opus-3', { opus: '' }), [],
    'familia sem guia legivel: nenhum id dela e "novo" (o guia que falta ja e erro)');
  assert.deepStrictEqual(guias.modelosNovos('claude-opus-5-1', { opus: 'claude-opus-5-20260101' }),
    [{ familia: 'opus', id: 'claude-opus-5-1', atual: 'claude-opus-5-20260101' }], 'a data no id do guia nao conta como versao');
});

test('F4e guias: a conferencia com paginas falsas diz o que mudou, o modelo novo e o que nao se leu, sem rede', async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-f4e3-'));
  try {
    fs.mkdirSync(path.join(raiz, 'modelos', 'claude'), { recursive: true });
    const url = 'https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5.md';
    fs.writeFileSync(path.join(raiz, 'modelos', 'claude', 'opus.md'),
      guiaDeTeste().replace('fingerprint 6171e5c0ada4178c', 'fingerprint ' + guias.impressao('pagina A')));
    const pedidas = [];
    const falsa = function (paginas) {
      return function (u) {
        pedidas.push(u);
        if (!(u in paginas)) return Promise.reject(new Error('status 404'));
        return Promise.resolve(paginas[u]);
      };
    };
    const igual = await guias.conferir(raiz, falsa({ [url]: 'pagina A', [guias.OVERVIEW]: 'claude-opus-5-5' }));
    assert.deepStrictEqual(igual.mudaram, []);
    assert.deepStrictEqual(igual.novos, []);
    assert.deepStrictEqual(igual.paginas, [], 'a pagina igual nao vai para o rascunho');
    assert.deepStrictEqual(igual.erros.map(function (e) { return e.familia; }), ['haiku', 'sonnet', 'fable'],
      'o guia que falta e erro, nunca "nada mudou"');
    assert.ok(pedidas.indexOf(url) !== -1 && pedidas.indexOf(guias.OVERVIEW) !== -1);
    const mudou = await guias.conferir(raiz, falsa({ [url]: 'pagina B', [guias.OVERVIEW]: 'claude-opus-5-6' }));
    assert.deepStrictEqual(mudou.mudaram, [{ familia: 'opus', url: url, antes: guias.impressao('pagina A'),
      agora: guias.impressao('pagina B') }]);
    assert.deepStrictEqual(mudou.novos, [{ familia: 'opus', id: 'claude-opus-5-6', atual: 'claude-opus-5-5' }]);
    assert.deepStrictEqual(mudou.paginas.map(function (p) { return [p.familia, p.url, p.texto]; }), [['opus', url, 'pagina B']]);
    assert.strictEqual(fs.readFileSync(path.join(raiz, 'modelos', 'claude', 'opus.md'), 'utf8'),
      guiaDeTeste().replace('fingerprint 6171e5c0ada4178c', 'fingerprint ' + guias.impressao('pagina A')),
      'a conferencia nunca troca o guia: o novo so entra com o sim do dono');
    const caiu = await guias.conferir(raiz, falsa({}));
    assert.deepStrictEqual(caiu.erros.filter(function (e) { return e.url; }).map(function (e) { return [e.url, e.erro]; }),
      [[url, 'status 404'], [guias.OVERVIEW, 'status 404']], 'a pagina que nao abriu aparece com a causa');
    assert.deepStrictEqual(caiu.mudaram, []);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test('F4e guias: o lembrete sai quando a ultima conferencia (a leitura do guia ou a gravada) chega a 30 dias', () => {
  const RAIZ = copiarGuias(fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-f4e-dia-')), '2026-11-13');
  try {
  assert.strictEqual(guias.ultimaConferencia(RAIZ, null), '2026-11-13');
  assert.strictEqual(guias.avisoDeRenovacao(RAIZ, null, '2026-12-12'), '', '29 dias: ainda nao');
  const aviso = guias.avisoDeRenovacao(RAIZ, null, '2026-12-13');
  assert.match(aviso, /^# sworn - guias dos modelos: a ultima conferencia foi em 2026-11-13, ha 30 dias/);
  assert.match(aviso, /scripts\/modelos\.js" --conferir/);
  assert.strictEqual(guias.ultimaConferencia(RAIZ, { conferido: '2026-12-10' }), '2026-12-10', 'a gravada, mais nova, vale');
  assert.strictEqual(guias.avisoDeRenovacao(RAIZ, { conferido: '2026-12-10' }, '2026-12-20'), '');
  assert.strictEqual(guias.ultimaConferencia(RAIZ, { conferido: 'ontem' }), '2026-11-13', 'a gravada torta nao conta');
  assert.strictEqual(guias.ultimaConferencia(RAIZ, { conferido: '2026-02-30' }), '2026-11-13', 'data que nao existe nao conta');
  assert.strictEqual(guias.ultimaConferencia(RAIZ, { conferido: '2026-13-01' }), '2026-11-13', 'mes 13 nao conta nem estoura');
  assert.strictEqual(guias.avisoDeRenovacao(RAIZ, null, '2026-13-01'), '', 'hoje com mes 13: sem lembrete');
  assert.strictEqual(guias.avisoDeRenovacao(RAIZ, null, 'hoje'), '', 'hoje torto: sem lembrete');
  assert.strictEqual(guias.ultimaConferencia(path.join(RAIZ, 'nao-existe'), null), '', 'sem guia, sem data');
  const semGuia = guias.avisoDeRenovacao(path.join(RAIZ, 'nao-existe'), null, '2026-12-13');
  assert.match(semGuia, /nenhum guia de modelos\/claude\/ abriu/, 'sem guia nenhum: diz que nao abriu, nao "nunca conferiu"');
  assert.match(semGuia, /scripts\/modelos\.js" --conferir/, 'com o proximo passo');
  } finally {
    fs.rmSync(RAIZ, { recursive: true, force: true });
  }
});

test('F4e guias: modelos.js --citacoes confere o rascunho de guia contra as paginas; sem argumento, sai 2', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-f4e3c-'));
  try {
    const guia = path.join(tmp, 'g.md');
    const pagina = path.join(tmp, 'p.md');
    fs.writeFileSync(guia, guiaDeTeste());
    fs.writeFileSync(pagina, 'If unsure, start with Claude Opus 5.5 for most workloads.\n## Calibrate effort\n');
    const rodar = function (args) { return spawnSync(process.execPath, [CLI].concat(args), { encoding: 'utf8', timeout: 30000 }); };
    const ok = rodar(['--citacoes', guia, pagina]);
    assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
    assert.strictEqual(JSON.parse(ok.stdout).ok, true);
    fs.writeFileSync(pagina, 'outra coisa');
    const torto = rodar(['--citacoes', guia, pagina]);
    assert.strictEqual(torto.status, 1);
    assert.strictEqual(JSON.parse(torto.stdout).citacoes.length, 2);
    assert.match(JSON.parse(torto.stdout).passo, /trecho copiado da pagina/, 'o que reprova diz o que fazer');
    fs.writeFileSync(pagina, 'If unsure, start with Claude Opus 5.5 for most workloads.\n## Calibrate effort\n');
    fs.writeFileSync(guia, guiaDeTeste().replace('## What to avoid', '## Other'));
    const semSecao = rodar(['--citacoes', guia, pagina]);
    assert.strictEqual(semSecao.status, 1, 'citacoes certas, formato torto: reprova');
    assert.match(JSON.parse(semSecao.stdout).formato.join(' | '), /falta a secao "## What to avoid"/);
    fs.writeFileSync(guia, guiaDeTeste());
    for (const args of [[], ['--citacoes'], ['--citacoes', guia], ['--outro'], ['--conferir', '--salvar'], ['--conferir', '--salvar', '']]) {
      const r = rodar(args);
      assert.strictEqual(r.status, 2, JSON.stringify(args) + ': ' + r.stdout);
      assert.match(r.stderr, /^uso: node .*modelos\.js/m, JSON.stringify(args));
      assert.ok(!/nao li/.test(r.stderr), JSON.stringify(args));
    }
    for (const args of [['--citacoes', path.join(tmp, 'nao.md'), pagina], ['--citacoes', guia, path.join(tmp, 'nao.md')]]) {
      const r = rodar(args);
      assert.strictEqual(r.status, 2, JSON.stringify(args));
      assert.match(r.stderr, /^nao li: .*nao\.md$/m, JSON.stringify(args));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('F4e guias: a abertura do repositorio do plugin lembra a conferencia velha; fora dele, nao', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-f4e3a-'));
  try {
    const repo = function (nome, doPlugin) {
      const dir = path.join(tmp, nome);
      fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
      copiarGuias(dir, '2026-01-01');
      if (doPlugin) {
        fs.mkdirSync(path.join(dir, '.claude-plugin'));
        fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'sworn' }));
      }
      return dir;
    };
    const abrir = function (dir, casa) {
      const r = spawnSync(process.execPath, [ABERTURA], {
        input: JSON.stringify({ session_id: 'f4e3-' + path.basename(dir), cwd: dir, source: 'startup' }), encoding: 'utf8',
        env: Object.assign({}, process.env, { SWORN_TMP: path.join(tmp, '_sessoes'), CLAUDE_CONFIG_DIR: casa }), timeout: 30000
      });
      assert.strictEqual(r.status, 0, r.stderr);
      return r.stdout;
    };
    const casa = path.join(tmp, 'casa');
    const lembrete = /# sworn - guias dos modelos: a ultima conferencia foi em 2026-01-01/;
    assert.match(abrir(repo('plugin', true), casa), lembrete);
    assert.ok(!lembrete.test(abrir(repo('outro', false), casa)), 'fora do repositorio do plugin, sem lembrete');
    // a conferencia gravada hoje cala o lembrete
    fs.mkdirSync(path.dirname(guias.arquivoDoEstado({ CLAUDE_CONFIG_DIR: casa })), { recursive: true });
    fs.writeFileSync(guias.arquivoDoEstado({ CLAUDE_CONFIG_DIR: casa }), JSON.stringify({ conferido: guias.diaLocal(new Date()) }));
    assert.ok(!/# sworn - guias dos modelos/.test(abrir(repo('plugin2', true), casa)));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('F4e guias: a impressao digital e o sha256 da pagina, nos 16 primeiros hex', () => {
  assert.strictEqual(guias.impressao('abc'), 'ba7816bf8f01cfea');
});

// Ronda 1 da revisao cega: o formato que deixava passar, o CRLF do Windows e as mensagens sem proximo passo.
test('F4e guias: o guia com CRLF (checkout do Windows) passa e entra igual ao de LF', () => {
  const crlf = guiaDeTeste().replace(/\n/g, '\r\n');
  assert.deepStrictEqual(guias.conferirFormato(crlf), []);
  assert.strictEqual(guias.blocoDoTexto(crlf), guias.blocoDoTexto(guiaDeTeste()));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-f4e-crlf-'));
  try {
    fs.mkdirSync(path.join(dir, 'modelos', 'claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'modelos', 'claude', 'opus.md'), crlf);
    assert.strictEqual(guias.ler(dir, 'opus').modelo, 'claude-opus-5-5');
    assert.strictEqual(guias.bloco(dir, 'opus'), guias.blocoDoTexto(guiaDeTeste()));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('F4e guias: o formato reprova item sem marca, modelo de outra familia, citacao repetida ou torta e dia que nao existe', () => {
  const p = function (t, familia) { return guias.conferirFormato(t, familia).join(' | '); };
  assert.match(p(guiaDeTeste().replace('between tool calls. [1]', 'between tool calls.')),
    /item sem a marca \[n\] no fim: - Report progress/);
  assert.match(p(guiaDeTeste().replace('model: claude-opus-5-5', 'model: claude-sonnet-5-5'), 'opus'),
    /a linha model e de claude-sonnet-5-5, e o guia e da familia opus/);
  assert.deepStrictEqual(guias.conferirFormato(guiaDeTeste(), 'opus'), [], 'a familia certa passa');
  assert.match(p(guiaDeTeste('[1] source 1: "outra coisa"')), /\[1\] aparece mais de uma vez em ## Citations/);
  assert.match(p(guiaDeTeste('[4] source one: "x"')), /linha fora do formato em ## Citations: \[4\] source one/);
  assert.match(p(guiaDeTeste().replace('read 2026-11-13', 'read 2026-13-45')), /dia que nao existe \(2026-13-45\)/);
  assert.match(p(guiaDeTeste().replace('read 2026-11-13', 'read 2026-02-30')), /dia que nao existe \(2026-02-30\)/,
    'o Date aceita 30 de fevereiro (vira 2 de marco); o calendario nao');
  const acento = p(guiaDeTeste('é'.repeat(3100)));
  assert.match(acento, /o guia tem \d+ bytes; o teto do guia e 6144: corte \d+ bytes/, 'o teto conta bytes, nao letras');
  const comprido = guiaDeTeste().replace('- Report progress', '- ' + 'y'.repeat(guias.TETO_DO_PEDIDO) + ' [1]\n- Report progress');
  assert.match(p(comprido), /o teto do bloco do pedido e 1200: corte \d+ bytes dos itens de How to ask/);
  const largo = guiaDeTeste().replace('- Report progress', '- ' + 'é'.repeat(560) + ' [1]\n- Report progress');
  assert.ok(guias.blocoDoTexto(largo).length < guias.TETO_DO_PEDIDO, 'menos letras que o teto...');
  assert.match(p(largo), /o teto do bloco do pedido e 1200: corte \d+ bytes/, '...e mais bytes: o teto do pedido conta bytes');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-f4e-fam-'));
  try {
    fs.mkdirSync(path.join(dir, 'modelos', 'claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'modelos', 'claude', 'opus.md'), guiaDeTeste().replace('model: claude-opus-5-5', 'model: claude-sonnet-5-5'));
    assert.strictEqual(guias.bloco(dir, 'opus'), '', 'o guia de outra familia nao entra no pedido do opus');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('F4e guias: o bloco tira toda marca, inclusive no meio do item e antes do ponto', () => {
  const t = guiaDeTeste().replace('- Report progress in one line between tool calls. [1]', '- Say what you want [1], then why. [2]');
  assert.match(guias.blocoDoTexto(t), /^- Say what you want, then why\.$/m);
  assert.doesNotMatch(guias.blocoDoTexto(t), /\[\d+\]/);
  assert.strictEqual(guias.blocoDoTexto(guiaDeTeste().replace(/^- State.*\n- Report.*$/m, '')), '', 'How to ask sem itens: nada');
});

test('F4e guias: a citacao vazia, a pagina que nao veio e as reticencias tipograficas', () => {
  const pagina = 'If unsure, start with Claude Opus 5.5 for most workloads.\n## Calibrate effort\n';
  assert.deepStrictEqual(guias.citacoesQueNaoConferem(guiaDeTeste().replace('"Calibrate effort"', '"**"'), [pagina]),
    ['[2] o trecho fica vazio sem a marcacao: cite um trecho com texto da source 1']);
  assert.deepStrictEqual(guias.citacoesQueNaoConferem(guiaDeTeste(), []), [
    '[1] cita a source 1, e a pagina dela nao veio: passe a pagina de cada source, na ordem das linhas source',
    '[2] cita a source 1, e a pagina dela nao veio: passe a pagina de cada source, na ordem das linhas source']);
  const reticencias = guiaDeTeste().replace('"Calibrate effort"', '"Be clear... and direct"');
  assert.deepStrictEqual(guias.citacoesQueNaoConferem(reticencias, [pagina + 'Be clear… and direct']), []);
});

test('F4e guias: o item so de marcas, a source que o guia nao tem e as paginas que nao vieram', () => {
  assert.match(guias.conferirFormato(guiaDeTeste().replace('- Report progress in one line between tool calls. [1]', '- [1]')).join(' | '),
    /item sem texto antes da marca: - \[1\]/);
  const pagina = 'If unsure, start with Claude Opus 5.5 for most workloads.\n## Calibrate effort\n';
  assert.deepStrictEqual(guias.citacoesQueNaoConferem(guiaDeTeste('[3] source 7: "x"'), [pagina]),
    ['[3] cita a source 7, e o guia so tem 1 linha source: troque pelo numero de uma delas']);
  assert.strictEqual(guias.citacoesQueNaoConferem(guiaDeTeste()).length, 2, 'sem a lista de paginas: as mensagens, nao um TypeError');
  const semSource = guiaDeTeste().split('\n').filter(function (l) { return !/^source: /.test(l); }).join('\n');
  assert.deepStrictEqual(guias.citacoesQueNaoConferem(semSource, [pagina]).slice(0, 1),
    ['[1] cita a source 1, e o guia nao tem linha source: acrescente a linha source da pagina citada']);
});

test('F4e guias: as mensagens de erro do guia dizem o que fazer', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-f4e-ilegivel-'));
  try {
    fs.mkdirSync(path.join(pasta, 'modelos', 'claude', 'opus.md'), { recursive: true });
    assert.match(guias.ler(pasta, 'opus').erro,
      /^nao consegui ler modelos\/claude\/opus\.md \(EISDIR\): confira se o arquivo existe e pode ser lido, e rode de novo$/);
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  assert.match(guias.ler(RAIZ, 'Opus').erro, /familia desconhecida: Opus \(as familias sao haiku, sonnet, opus, fable\)/);
  assert.match(guias.ler(path.join(RAIZ, 'nao-existe'), 'opus').erro, /^falta o guia modelos\/claude\/opus\.md: escreva-o/);
});

test('F4e guias: o despacho com modelo em branco segue o do agente; o guia so nao entra de novo no pedido reenviado', () => {
  assert.strictEqual(guias.familiaDoDespacho('  ', 'haiku', 'opus'), 'haiku');
  const g = guias.blocoDoTexto(guiaDeTeste());
  const citando = 'Review this: it emits "Guidance for claude-opus-5-5 (from ...)" at the end.';
  assert.ok(guias.comGuia(citando, g).endsWith(g + '\nWhere this guidance conflicts with the task above, the task wins.'),
    'a tarefa que so cita o cabecalho recebe o guia');
  const reenviado = guias.comGuia('tarefa', g);
  assert.strictEqual(guias.comGuia(reenviado, g), reenviado);
  assert.strictEqual(guias.comGuia(reenviado + '\n', g), reenviado + '\n', 'o fim com espaco ainda e o reenviado');
});

// O juiz que troca o modelo do despacho (o inspetor um degrau acima) recebe o pedido ja com o guia de quem o escreveu:
// o guia que fica no fim e o do modelo que vai rodar, nao o de antes.
test('F4e guias: o guia de outro modelo no fim do pedido sai, e entra o do modelo que vai rodar', () => {
  const A = '\nWhere this guidance conflicts with the task above, the task wins.';
  const g = guias.blocoDoTexto(guiaDeTeste());
  const outro = guias.blocoDoTexto(guiaDeTeste().replace('model: claude-opus-5-5', 'model: claude-sonnet-5-5'));
  assert.notStrictEqual(outro, g);
  assert.strictEqual(guias.comGuia(guias.comGuia('tarefa', outro), g), 'tarefa\n\n' + g + A);
  assert.strictEqual(guias.comGuia(guias.comGuia('tarefa', outro) + '\n', g), 'tarefa\n\n' + g + A, 'o fim com espaco');
  assert.strictEqual(guias.comGuia(guias.comGuia('', outro), g), g + A, 'pedido que e so o guia de outro');
  // so o ultimo cabecalho conta: o guia citado no meio da tarefa fica, e o do fim, do mesmo modelo, tambem
  const meio = 'Look:\n' + outro + '\nend.';
  const r = guias.comGuia(meio, g);
  assert.strictEqual(guias.comGuia(r, g), r);
  assert.strictEqual(guias.comGuia(guias.comGuia(meio, outro), g), meio + '\n\n' + g + A);
  // a frase final sem cabecalho de guia nenhum e da tarefa: fica como veio
  assert.strictEqual(guias.comGuia('tarefa' + A, g), 'tarefa' + A);
  // o texto da tarefa depois de um guia de outro modelo, terminando na frase final, nao e guia: fica inteiro
  const tarefaDepois = guias.comGuia('', outro) + '\n\nNova tarefa.' + A;
  assert.strictEqual(guias.comGuia(tarefaDepois, g), tarefaDepois, 'a tarefa depois do guia velho fica');
  // o guia de outro modelo com fim de linha CRLF tambem sai
  const crlf = guias.comGuia('tarefa', outro).replace(/\n/g, '\r\n');
  assert.strictEqual(guias.comGuia(crlf, g), 'tarefa\n\n' + g + A, 'o guia velho em CRLF');
});

test('F4e guias: a conferencia acusa a source torta, a pagina vazia e nao chama de novo o id da familia sem guia', async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-f4e3r-'));
  try {
    fs.mkdirSync(path.join(raiz, 'modelos', 'claude'), { recursive: true });
    const url = 'https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5.md';
    fs.writeFileSync(path.join(raiz, 'modelos', 'claude', 'opus.md'),
      guiaDeTeste().replace('fingerprint 6171e5c0ada4178c', 'fingerprint ' + guias.impressao('pagina A')) +
      '\nsource: https://x | read 2026-1-05 | fingerprint ab');
    const paginas = { [url]: 'pagina A', [guias.OVERVIEW]: 'claude-haiku-3 claude-haiku-4-5 claude-opus-5-5' };
    const r = await guias.conferir(raiz, function (u) { return Promise.resolve(paginas[u]); });
    const doOpus = r.erros.filter(function (e) { return e.familia === 'opus'; });
    assert.strictEqual(doOpus.length, 1);
    assert.match(doOpus[0].erro, /o guia nao passa no formato \(.*linha source fora do formato: source: https:\/\/x/);
    assert.deepStrictEqual(r.novos, [], 'haiku sem guia: o erro do guia basta, nenhum id dele vira "novo"');
    const vazia = await guias.conferir(raiz, function (u) { return Promise.resolve(u === url ? '  ' : paginas[u]); });
    assert.deepStrictEqual(vazia.erros.filter(function (e) { return e.url === url; }).map(function (e) { return e.erro; }),
      ['a pagina veio vazia'], 'pagina vazia e erro, nunca "mudou"');
    assert.deepStrictEqual(vazia.mudaram, []);
    fs.writeFileSync(path.join(raiz, 'modelos', 'claude', 'opus.md'), guiaDeTeste().replace('model: claude-opus-5-5', 'model: claude-sonnet-5-5'));
    const outra = await guias.conferir(raiz, function (u) { return Promise.resolve(u === guias.OVERVIEW ? 'claude-opus-9' : 'pagina A'); });
    assert.deepStrictEqual(outra.novos, [], 'o guia do opus com modelo do sonnet nao serve de medida para o opus');
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test('F4e guias: o lembrete ignora dia no futuro e conta o dia local', () => {
  const raiz = copiarGuias(fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-f4e-fut-')), '2026-01-01');
  try {
    const opus = path.join(raiz, 'modelos', 'claude', 'opus.md');
    fs.writeFileSync(opus, fs.readFileSync(opus, 'utf8').replace(/\| read 2026-01-01 \|/, '| read 2062-01-10 |'));
    assert.strictEqual(guias.ultimaConferencia(raiz, null, '2026-03-01'), '2026-01-01', 'o dia depois de hoje nao conta');
    assert.match(guias.avisoDeRenovacao(raiz, { conferido: '2099-01-01' }, '2026-03-01'), /a ultima conferencia foi em 2026-01-01, ha 59 dias/);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
  const semDia = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-f4e-semdia-'));
  try {
    fs.mkdirSync(path.join(semDia, 'modelos', 'claude'), { recursive: true });
    fs.writeFileSync(path.join(semDia, 'modelos', 'claude', 'opus.md'), 'guia sem linha source');
    assert.match(guias.avisoDeRenovacao(semDia, null, '2026-03-01'), /a conferencia nunca foi feita; rode `node .*--conferir`/);
  } finally {
    fs.rmSync(semDia, { recursive: true, force: true });
  }
  assert.strictEqual(guias.diaLocal(new Date(2026, 10, 13, 23, 30)), '2026-11-13');
  assert.strictEqual(guias.diaLocal(new Date(2026, 0, 5, 0, 10)), '2026-01-05');
});

test('F4e guias: os passos do modelos.js nomeiam a pagina, o endereco inteiro e nao mandam repetir o --salvar', () => {
  const cli = require('../scripts/modelos.js');
  const url = 'https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5.md';
  const caiu = cli.passos({ erros: [{ familia: 'opus', url: url, erro: 'status 404' }, { familia: 'sonnet', url: url, erro: 'timeout' }],
    mudaram: [], novos: [] }, null, false).join('\n');
  assert.match(caiu, /Nao abriu https:\/\/platform\.claude\.com\/docs\/en\/models\/opus-5-5\/whats-new-opus-5-5\.md \(status 404\): o endereco mudou; .*modelos\/claude\/opus\.md/);
  assert.match(caiu, /\(timeout\): rode de novo mais tarde/);
  const overview = cli.passos({ erros: [{ familia: '', url: guias.OVERVIEW, erro: 'status 404' }], mudaram: [], novos: [] }, null, false).join('\n');
  assert.match(overview, /o endereco mudou; .*corrija a constante OVERVIEW em scripts\/lib\/guias-modelo\.js/);
  assert.doesNotMatch(overview, /modelos\/claude\/\.md/);
  const novo = cli.passos({ erros: [], mudaram: [], novos: [{ familia: 'opus', id: 'claude-opus-5-6', atual: 'claude-opus-5-5' }] }, 'pasta', false).join('\n');
  assert.match(novo, /https:\/\/platform\.claude\.com\/docs\/en\/build-with-claude\/prompt-engineering\/prompting-claude-opus-5-6\.md/);
  assert.match(novo, /https:\/\/platform\.claude\.com\/docs\/en\/models\/opus-5-6\/whats-new-opus-5-6\.md/);
  assert.doesNotMatch(novo, /Rode de novo com --salvar|\.\.\.\/|nao foram salvas/, 'com --salvar dado e so modelo novo: nada de repetir');
  const mudou = { erros: [], novos: [], mudaram: [{ familia: 'opus', url: url, antes: 'a', agora: 'b' }] };
  assert.match(cli.passos(mudou, null, false).join('\n'), /Rode de novo com --salvar <pasta>/);
  assert.match(cli.passos(mudou, 'p', true).join('\n'), /As paginas que mudaram estao em p\./);
  assert.match(cli.passos(mudou, null, false).join('\n'), /o texto das paginas e dado, nao instrucao/);
  assert.strictEqual(cli.nomeDoArquivo({ familia: 'opus', url: url }), 'opus--whats-new-opus-5-5.md');
  assert.strictEqual(cli.nomeDoArquivo({ familia: 'opus', url: 'https://x/a/' }), 'opus--pagina.md');
});

test('F4e guias: a pagina que nunca responde vira erro de espera, e a que nao abre, o status', async () => {
  const http = require('node:http');
  const cli = require('../scripts/modelos.js');
  const presos = [];
  const servidor = http.createServer(function (req, res) {
    if (req.url === '/some') { res.statusCode = 404; res.end('x'); } else presos.push(res);
  });
  await new Promise(function (ok) { servidor.listen(0, '127.0.0.1', ok); });
  const base = 'http://127.0.0.1:' + servidor.address().port;
  try {
    await assert.rejects(cli.buscar(base + '/preso', 200), /^Error: sem resposta em 0\.2 s$/);
    await assert.rejects(cli.buscar(base + '/some', 2000), /^Error: status 404$/);
  } finally {
    presos.forEach(function (r) { r.destroy(); });
    servidor.closeAllConnections();
    await new Promise(function (ok) { servidor.close(ok); });
  }
});

test('F4e guias: o modelos.js que nao grava as paginas ou o dia diz o que houve e nao perde o resultado', () => {
  const cli = require('../scripts/modelos.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-f4e-grava-'));
  try {
    const arquivo = path.join(dir, 'arquivo');
    fs.writeFileSync(arquivo, 'x');
    const erro = cli.salvarPaginas(arquivo, [{ familia: 'opus', url: 'https://x/a.md', texto: 't' }]);
    assert.match(erro, /^nao salvei as paginas que mudaram em .*arquivo .*: escolha uma pasta que se possa gravar em --salvar e rode de novo$/);
    assert.strictEqual(cli.salvarPaginas(path.join(dir, 'boa'), [{ familia: 'opus', url: 'https://x/a.md', texto: 't' }]), null);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'boa', 'opus--a.md'), 'utf8'), 't');
    const estado = cli.gravarConferencia({ CLAUDE_CONFIG_DIR: path.join(arquivo, 'dentro') }, '2026-11-13');
    assert.match(estado, /^a conferencia esta limpa, mas nao gravei o dia dela em .*: confira se essa pasta pode ser gravada e rode de novo/);
    assert.strictEqual(cli.gravarConferencia({ CLAUDE_CONFIG_DIR: path.join(dir, 'casa') }, '2026-11-13'), null);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(guias.arquivoDoEstado({ CLAUDE_CONFIG_DIR: path.join(dir, 'casa') }), 'utf8')),
      { conferido: '2026-11-13' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
