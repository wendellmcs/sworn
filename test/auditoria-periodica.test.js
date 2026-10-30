'use strict';
// Bloco A2 (D426): a auditoria roda sozinha na abertura, no maximo 1 vez a cada N dias, e so avisa o
// que passou do teto. Aqui a unidade, com `agora` e `auditar` injetados: nada espera dias e nada
// depende do disco real. A fiacao com a abertura (processo de verdade) esta em fiacao.test.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ap = require('../scripts/lib/auditoria-periodica.js');

const DIA = 24 * 60 * 60 * 1000;
const AGORA = Date.UTC(2026, 9, 11, 12, 0, 0);

function temp(nome) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-audper-' + nome + '-'));
}

function escrever(dir, rel, conteudo) {
  const alvo = path.join(dir, rel);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, conteudo, 'utf8');
}

function marca(dir, ms) {
  escrever(dir, '.claude/sworn/auditoria.json', JSON.stringify({ ultima: new Date(ms).toISOString() }));
}

function lerMarcaBruta(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'sworn', 'auditoria.json'), 'utf8'));
}

/** Relatorio no formato de lib/auditoria.auditar, tudo certo; cada teste estraga so o que quer provar. */
function limpo(extra) {
  return Object.assign({
    peso: { total: 50, teto: 200, estourou: false }, skills: [], sobreposicoes: [], contradicoes: []
  }, extra || {});
}

function stub(relatorio) {
  const f = function () { f.chamadas++; return relatorio; };
  f.chamadas = 0;
  return f;
}

const PROJETO = {};

test('A2: a chave e auditarNaAbertura; ligada por padrao, so false desliga', () => {
  assert.strictEqual(ap.CHAVE, 'auditarNaAbertura');
  assert.strictEqual(ap.ligada(null), true);
  assert.strictEqual(ap.ligada({}), true);
  assert.strictEqual(ap.ligada({ auditarNaAbertura: true }), true);
  assert.strictEqual(ap.ligada({ auditarNaAbertura: 'nao' }), true);
  assert.strictEqual(ap.ligada({ auditarNaAbertura: 0 }), true);
  assert.strictEqual(ap.ligada({ auditarNaAbertura: false }), false);
});

test('A2: dias vem de limiares quando e numero positivo; senao o padrao (7 e 90)', () => {
  assert.strictEqual(ap.dias({}, 'diasEntreAuditorias'), 7);
  assert.strictEqual(ap.dias({}, 'diasSkillParada'), 90);
  assert.strictEqual(ap.dias({ limiares: { diasEntreAuditorias: 3, diasSkillParada: 30 } }, 'diasEntreAuditorias'), 3);
  assert.strictEqual(ap.dias({ limiares: { diasEntreAuditorias: 3, diasSkillParada: 30 } }, 'diasSkillParada'), 30);
  for (const ruim of [0, -1, '5', null, NaN, Infinity, [], {}]) {
    assert.strictEqual(ap.dias({ limiares: { diasEntreAuditorias: ruim } }, 'diasEntreAuditorias'), 7, String(ruim));
  }
  assert.strictEqual(ap.dias({ limiares: 5 }, 'diasEntreAuditorias'), 7);
  assert.strictEqual(ap.dias(null, 'diasEntreAuditorias'), 7);
});

test('A2: sem marca, audita e grava a marca; dentro do prazo fica calada e nao audita', () => {
  const dir = temp('prazo');
  try {
    const a = stub(limpo());
    assert.strictEqual(ap.avisoDaAuditoria(dir, PROJETO, { agora: AGORA, auditar: a }), '');
    assert.strictEqual(a.chamadas, 1);
    assert.strictEqual(lerMarcaBruta(dir).ultima, new Date(AGORA).toISOString());
    // 6 dias depois: ainda dentro do prazo de 7 -> nao audita
    assert.strictEqual(ap.avisoDaAuditoria(dir, PROJETO, { agora: AGORA + 6 * DIA, auditar: a }), '');
    assert.strictEqual(a.chamadas, 1, 'auditou dentro do prazo');
    // 7 dias exatos: vence
    ap.avisoDaAuditoria(dir, PROJETO, { agora: AGORA + 7 * DIA, auditar: a });
    assert.strictEqual(a.chamadas, 2, 'nao auditou no 7o dia');
    assert.strictEqual(lerMarcaBruta(dir).ultima, new Date(AGORA + 7 * DIA).toISOString(), 'a marca nao andou');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A2: limiares.diasEntreAuditorias muda o prazo', () => {
  const dir = temp('prazo-n');
  try {
    const projeto = { limiares: { diasEntreAuditorias: 2 } };
    marca(dir, AGORA);
    const a = stub(limpo());
    ap.avisoDaAuditoria(dir, projeto, { agora: AGORA + 1 * DIA, auditar: a });
    assert.strictEqual(a.chamadas, 0);
    ap.avisoDaAuditoria(dir, projeto, { agora: AGORA + 2 * DIA, auditar: a });
    assert.strictEqual(a.chamadas, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A2: marca ilegivel, sem data valida ou no futuro conta como vencida (nao como "nunca mais")', () => {
  const dir = temp('marca-ruim');
  try {
    const casos = ['{ quebrado', '[]', '{}', JSON.stringify({ ultima: 'ontem' }), JSON.stringify({ ultima: 42 }), ''];
    for (const bruto of casos) {
      escrever(dir, '.claude/sworn/auditoria.json', bruto);
      assert.strictEqual(ap.vencida(dir, PROJETO, AGORA), true, 'marca: ' + JSON.stringify(bruto));
    }
    marca(dir, AGORA + 30 * DIA); // relogio voltou
    assert.strictEqual(ap.vencida(dir, PROJETO, AGORA), true, 'data futura calou a auditoria');
    const a = stub(limpo());
    ap.avisoDaAuditoria(dir, PROJETO, { agora: AGORA, auditar: a });
    assert.strictEqual(a.chamadas, 1);
    assert.strictEqual(lerMarcaBruta(dir).ultima, new Date(AGORA).toISOString(), 'a marca futura nao foi corrigida');
    // BOM do Windows na marca: le normalmente
    escrever(dir, '.claude/sworn/auditoria.json', '﻿' + JSON.stringify({ ultima: new Date(AGORA).toISOString() }));
    assert.strictEqual(ap.vencida(dir, PROJETO, AGORA + DIA), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A2: sem projeto.json (projeto null) nao audita e nao cria nada; chave desligada tambem nao', () => {
  const dir = temp('sem-projeto');
  try {
    const a = stub(limpo({ peso: { total: 300, teto: 200, estourou: true } }));
    assert.strictEqual(ap.avisoDaAuditoria(dir, null, { agora: AGORA, auditar: a }), '');
    assert.strictEqual(a.chamadas, 0);
    assert.ok(!fs.existsSync(path.join(dir, '.claude')), 'criou .claude num projeto sem configuracao');
    assert.strictEqual(ap.avisoDaAuditoria(dir, { auditarNaAbertura: false }, { agora: AGORA, auditar: a }), '');
    assert.strictEqual(a.chamadas, 0);
    assert.ok(!fs.existsSync(path.join(dir, '.claude')), 'desligado nao grava marca');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A2: tudo dentro do teto = silencio, e a marca e gravada mesmo assim', () => {
  const dir = temp('silencio');
  try {
    assert.strictEqual(ap.avisoDaAuditoria(dir, PROJETO, { agora: AGORA, auditar: stub(limpo()) }), '');
    assert.ok(fs.existsSync(path.join(dir, '.claude', 'sworn', 'auditoria.json')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Plano 091 (#3, D559): o fim do aviso deixa de ser informacao e vira ordem ao modelo, no texto do mock aprovado.
const ORDEM_DO_MOCK = [
  'Faca no seu primeiro turno, depois de atender o pedido:',
  '1. Rode /sworn:audit para ver o detalhe.',
  '2. Leve os cortes ao usuario pelo AskUserQuestion, em 3 opcoes, com o',
  '   recomendado primeiro e o custo de cada um. Nao corte nada sem o sim.',
  'Desligar: "auditarNaAbertura": false em .claude/sworn/projeto.json.'
].join('\n');

test('A2: cada categoria avisa sozinha, em ASCII, com o prefixo, o detalhe e a ordem de auditar (D559)', () => {
  const casos = [
    // A6-72 (pedido 12): o peso em palavras do dono, com o que fazer; singular e plural do rotulo.
    ['peso', limpo({ peso: { total: 227, teto: 200, estourou: true } }),
      /- instrucoes do projeto com 227 itens de lista \(.+\), acima do limite de 200\. Junte ou corte itens\./],
    ['peso-um', limpo({ peso: { total: 1, teto: 0, estourou: true } }),
      /- instrucoes do projeto com 1 item de lista \(.+\), acima do limite de 0\. Junte ou corte itens\./],
    ['sobreposicao', limpo({ sobreposicoes: [{ a: 'revisar', b: 'inspecionar', termos: ['x', 'y'] }] }),
      /skills que se sobrepoem \(1\): revisar x inspecionar/],
    ['contradicao', limpo({ contradicoes: [{ gatilho: 'antes de commitar', acoes: ['a', 'b'] }] }),
      /regras que se contradizem \(1 gatilho\): antes de commitar/]
  ];
  for (const [nome, relatorio, esperado] of casos) {
    const dir = temp('cat-' + nome);
    try {
      const t = ap.avisoDaAuditoria(dir, PROJETO, { agora: AGORA, auditar: stub(relatorio) });
      assert.ok(t.startsWith('sworn: auditoria automatica (a cada 7 dias) achou o que cortar:\n'), nome + ': ' + t);
      assert.ok(esperado.test(t), nome + ': ' + t);
      assert.ok(t.endsWith('\n' + ORDEM_DO_MOCK), nome + ' sem a ordem do mock no fim: ' + t);
      assert.ok(/^[\x20-\x7E\n]+$/.test(t), nome + ' nao e ASCII: ' + JSON.stringify(t));
      // so a categoria do caso aparece: prefixo + 1 item + as 5 linhas da ordem
      assert.strictEqual(t.split('\n').length, 7, nome + ' trouxe mais que um item: ' + t);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

// Plano 091 #8 (mock D559, secao 2): atalho sem gatilho e motivo de corte; o que tem gatilho nao conta.
test('091 #8: atalhos sem gatilho entram na lista do que cortar, com arquivo:linha', () => {
  const dir = temp('atalhos');
  const ok = temp('atalhos-ok');
  try {
    const achados = [
      { arquivo: 'scripts/lib/gasto.js', linha: 42, oque: 'a', limite: null, gatilho: null },
      { arquivo: 'scripts/lib/gasto.js', linha: 50, oque: 'b', limite: null, gatilho: 'c' },
      { arquivo: 'scripts/abrir-turno.js', linha: 77, oque: 'd', limite: 'e', gatilho: null }
    ];
    const t = ap.avisoDaAuditoria(dir, PROJETO, { agora: AGORA, auditar: stub(limpo({})), atalhos: function () { return achados; } });
    assert.strictEqual(t, [
      'sworn: auditoria automatica (a cada 7 dias) achou o que cortar:',
      '- atalhos sem "trocar quando" (2): scripts/lib/gasto.js:42; scripts/abrir-turno.js:77. ' +
        'Complete o "trocar quando" ou desfaca o atalho.',
      ORDEM_DO_MOCK
    ].join('\n'));
    const so = ap.avisoDaAuditoria(ok, PROJETO, { agora: AGORA, auditar: stub(limpo({})),
      atalhos: function () { return [achados[1]]; } });
    assert.strictEqual(so, '', 'atalho com gatilho nao e corte: ' + so);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(ok, { recursive: true, force: true });
  }
});

test('091 #8: sem stub, a auditoria varre o repositorio de verdade (rastreado e novo nao ignorado)', () => {
  const dir = temp('atalhos-git');
  try {
    git(dir, ['init', '-q']);
    escrever(dir, '.gitignore', 'fora.js\n');
    escrever(dir, 'a.js', 'x\n// atalho: sem gatilho\n');
    escrever(dir, 'fora.js', '// atalho: ignorado\n');
    const t = ap.avisoDaAuditoria(dir, PROJETO, { agora: AGORA, auditar: stub(limpo({})) });
    assert.ok(t.indexOf('\n- atalhos sem "trocar quando" (1): a.js:2. ' +
      'Complete o "trocar quando" ou desfaca o atalho.\n') !== -1, t);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A2: o prefixo diz o N configurado; nome com acento sai ASCII; lista grande corta em 5 com "e mais K"', () => {
  const dir = temp('lista');
  try {
    const pares = [];
    for (let i = 0; i < 8; i++) pares.push({ a: 'skill-' + i, b: 'skill-é' + i, termos: [] });
    const t = ap.avisoDaAuditoria(dir, { limiares: { diasEntreAuditorias: 3 } },
      { agora: AGORA, auditar: stub(limpo({ sobreposicoes: pares })) });
    assert.ok(t.startsWith('sworn: auditoria automatica (a cada 3 dias) achou o que cortar:'), t);
    assert.ok(/skills que se sobrepoem \(8\)/.test(t) && /; e mais 3\n/.test(t), t);
    assert.ok(t.indexOf('skill-0 x skill-?0') !== -1, 'acento nao virou ?: ' + t);
    assert.strictEqual((t.match(/ x /g) || []).length, 5, 'passou de 5 nomes: ' + t);
    assert.ok(/^[\x20-\x7E\n]+$/.test(t), JSON.stringify(t));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A2: skill parada usa o mtime do SKILL.md: avisa a de 100 dias, cala a de 10, respeita diasSkillParada', () => {
  const dir = temp('parada');
  try {
    escrever(dir, '.claude/skills/velha/SKILL.md', '---\nname: velha\n---\n');
    escrever(dir, '.claude/skills/nova/SKILL.md', '---\nname: nova\n---\n');
    const mt = function (nome, diasAtras) {
      const s = (AGORA - diasAtras * DIA) / 1000;
      fs.utimesSync(path.join(dir, '.claude', 'skills', nome, 'SKILL.md'), s, s);
    };
    mt('velha', 100);
    mt('nova', 10);
    const rel = limpo({ skills: ['velha', 'nova', 'sem-arquivo'] });
    const t = ap.avisoDaAuditoria(dir, PROJETO, { agora: AGORA, auditar: stub(rel) });
    assert.ok(/skills sem mudanca ha 90 dias ou mais \(1\): velha \(100 dias\)/.test(t), t);
    assert.ok(t.indexOf('nova') === -1 && t.indexOf('sem-arquivo') === -1, t);
    // com o limite em 5 dias as duas aparecem (a sem arquivo continua de fora)
    fs.rmSync(path.join(dir, '.claude', 'sworn'), { recursive: true, force: true });
    const t2 = ap.avisoDaAuditoria(dir, { limiares: { diasSkillParada: 5 } }, { agora: AGORA, auditar: stub(rel) });
    assert.ok(/skills sem mudanca ha 5 dias ou mais \(2\): velha \(100 dias\); nova \(10 dias\)/.test(t2), t2);
    // 89 dias: ainda nao; 90 dias exatos: sim
    mt('velha', 89);
    assert.deepStrictEqual(ap.skillsParadas(dir, ['velha'], AGORA, 90), []);
    mt('velha', 90);
    assert.strictEqual(ap.skillsParadas(dir, ['velha'], AGORA, 90).length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A2: auditar que lanca vira UMA linha de aviso, grava a marca e nao relanca', () => {
  const dir = temp('falha');
  try {
    const quebra = function () { throw new TypeError('relatorio quebrado\ncom quebra e acentuação'); };
    let t;
    assert.doesNotThrow(function () { t = ap.avisoDaAuditoria(dir, PROJETO, { agora: AGORA, auditar: quebra }); });
    assert.strictEqual(t.split('\n').length, 1, 'mais de uma linha: ' + JSON.stringify(t));
    assert.ok(t.startsWith('sworn: auditoria automatica falhou (') &&
      /rode \/sworn:audit para ver o detalhe\.$/.test(t), t);
    assert.ok(/relatorio quebrado/.test(t) && /^[\x20-\x7E]+$/.test(t), JSON.stringify(t));
    assert.strictEqual(lerMarcaBruta(dir).ultima, new Date(AGORA).toISOString(), 'falha nao gravou a marca');
    // e, com a marca valida, a abertura seguinte nao repete a falha
    assert.strictEqual(ap.avisoDaAuditoria(dir, PROJETO, { agora: AGORA + DIA, auditar: quebra }), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A2: relatorio de forma estranha nao derruba (campos ausentes ou de tipo errado = nada a avisar)', () => {
  const dir = temp('forma');
  try {
    for (const rel of [undefined, null, {}, { peso: 5, skills: 'x', sobreposicoes: {}, contradicoes: 7 }]) {
      fs.rmSync(path.join(dir, '.claude'), { recursive: true, force: true });
      assert.strictEqual(ap.avisoDaAuditoria(dir, PROJETO, { agora: AGORA, auditar: stub(rel) }), '', JSON.stringify(rel));
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A2: falha ao gravar a marca nao lanca nem muda o aviso', () => {
  const dir = temp('marca-falha');
  try {
    // um DIRETORIO no lugar do arquivo da marca: writeFileSync da EISDIR
    fs.mkdirSync(path.join(dir, '.claude', 'sworn', 'auditoria.json'), { recursive: true });
    const rel = limpo({ peso: { total: 300, teto: 200, estourou: true } });
    let t;
    assert.doesNotThrow(function () { t = ap.avisoDaAuditoria(dir, PROJETO, { agora: AGORA, auditar: stub(rel) }); });
    assert.ok(/acima do limite de 200\./.test(t), t);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A2: com a auditoria real, projeto com fonte canonica de 205 itens avisa o peso estourado', () => {
  const dir = temp('real');
  try {
    const itens = [];
    for (let i = 0; i < 205; i++) itens.push('- item ' + i);
    escrever(dir, 'DOC.md', itens.join('\n') + '\n');
    const t = ap.avisoDaAuditoria(dir, { fontesCanonicas: ['DOC.md'] }, { agora: AGORA });
    assert.ok(/instrucoes do projeto com 205 itens de lista .*, acima do limite de 200\./.test(t), t);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- skill parada: a data vem do ultimo commit (git), com o mtime so de reserva
const { spawnSync } = require('node:child_process');

function git(dir, args, quando) {
  const iso = new Date(quando === undefined ? AGORA : quando).toISOString();
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false'].concat(args), {
    cwd: dir, encoding: 'utf8', shell: false,
    env: Object.assign({}, process.env, { GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso })
  });
  assert.strictEqual(r.status, 0, 'git ' + args.join(' ') + ': ' + r.stderr);
  return r.stdout;
}

function mtime(dir, nome, ms) {
  const s = ms / 1000;
  fs.utimesSync(path.join(dir, '.claude', 'skills', nome, 'SKILL.md'), s, s);
}

test('A2: skill parada usa a data do ultimo commit, nao o mtime (clone/checkout deixa o mtime em "agora")', () => {
  const dir = temp('git-data');
  try {
    git(dir, ['init', '-q']);
    escrever(dir, '.claude/skills/velha/SKILL.md', '---\nname: velha\n---\n');
    escrever(dir, '.claude/skills/nova/SKILL.md', '---\nname: nova\n---\n');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-q', '-m', 'velha e nova'], AGORA - 200 * DIA);
    // a nova e tocada de novo num commit recente
    escrever(dir, '.claude/skills/nova/SKILL.md', '---\nname: nova\n---\nmais\n');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-q', '-m', 'nova mudou'], AGORA - 10 * DIA);
    // como depois de um clone: o mtime das duas e "agora"
    mtime(dir, 'velha', AGORA);
    mtime(dir, 'nova', AGORA);
    const achadas = ap.skillsParadas(dir, ['velha', 'nova'], AGORA, 90);
    assert.deepStrictEqual(achadas, [{ nome: 'velha', dias: 200 }]);
    const t = ap.avisoDaAuditoria(dir, PROJETO, { agora: AGORA, auditar: stub(limpo({ skills: ['velha', 'nova'] })) });
    assert.ok(/skills sem mudanca ha 90 dias ou mais \(1\): velha \(200 dias\)/.test(t), t);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A2: skill nao rastreada (sem commit) usa o mtime, mesmo dentro de um repositorio git', () => {
  const dir = temp('git-solta');
  try {
    git(dir, ['init', '-q']);
    escrever(dir, '.claude/skills/velha/SKILL.md', 'x\n');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-q', '-m', 'velha'], AGORA - 200 * DIA);
    escrever(dir, '.claude/skills/solta-antiga/SKILL.md', 'x\n');
    escrever(dir, '.claude/skills/solta-nova/SKILL.md', 'x\n');
    mtime(dir, 'solta-antiga', AGORA - 100 * DIA);
    mtime(dir, 'solta-nova', AGORA - 1 * DIA);
    const achadas = ap.skillsParadas(dir, ['velha', 'solta-antiga', 'solta-nova'], AGORA, 90);
    assert.deepStrictEqual(achadas.map(function (s) { return s.nome + ':' + s.dias; }), ['velha:200', 'solta-antiga:100']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A2: repositorio sem nenhum commit, ou pasta fora de repositorio, cai no mtime', () => {
  const dir = temp('git-vazio');
  try {
    escrever(dir, '.claude/skills/velha/SKILL.md', 'x\n');
    mtime(dir, 'velha', AGORA - 100 * DIA);
    assert.deepStrictEqual(ap.skillsParadas(dir, ['velha'], AGORA, 90), [{ nome: 'velha', dias: 100 }]);
    git(dir, ['init', '-q']);
    assert.deepStrictEqual(ap.skillsParadas(dir, ['velha'], AGORA, 90), [{ nome: 'velha', dias: 100 }]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A2: git.ultimasMudancas devolve a data do commit mais recente de cada arquivo, em ms, e null sem repositorio', () => {
  const gitLib = require('../scripts/lib/git.js');
  const dir = temp('git-lib');
  try {
    assert.strictEqual(gitLib.ultimasMudancas(path.join(dir, 'nao-existe'), '.claude/skills'), null);
    git(dir, ['init', '-q']);
    escrever(dir, '.claude/skills/ação/SKILL.md', 'a\n');
    escrever(dir, '.claude/skills/b/SKILL.md', 'b\n');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-q', '-m', 'um'], AGORA - 50 * DIA);
    escrever(dir, '.claude/skills/b/SKILL.md', 'b2\n');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-q', '-m', 'dois'], AGORA - 5 * DIA);
    const m = gitLib.ultimasMudancas(dir, '.claude/skills');
    assert.ok(m instanceof Map);
    assert.strictEqual(m.get('.claude/skills/ação/SKILL.md'), Math.floor((AGORA - 50 * DIA) / 1000) * 1000);
    assert.strictEqual(m.get('.claude/skills/b/SKILL.md'), Math.floor((AGORA - 5 * DIA) / 1000) * 1000);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- git.ultimasMudancas: bordas (maxBuffer, sentinela do cabecalho, arquivo apagado)

/** Roda git com stdin; devolve { status, stdout }. */
function gitIn(dir, args, entrada) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', shell: false, input: entrada,
    maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('A2/git: correr repassa maxBuffer opcional (minusculo estoura -> null; sem ele, o padrao responde)', () => {
  const gitLib = require('../scripts/lib/git.js');
  const dir = temp('git-buf');
  try {
    assert.strictEqual(typeof gitLib.correr('' + dir, ['--version']), 'string');
    assert.strictEqual(gitLib.correr(dir, ['--version'], { maxBuffer: 1 }), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A2/git: historico grande (saida de git log > 1 MiB) nao vira null', () => {
  const gitLib = require('../scripts/lib/git.js');
  const dir = temp('git-grande');
  try {
    git(dir, ['init', '-q']);
    // 400 caminhos de ~3000 caracteres direto no indice (sem criar arquivo: o limite de caminho do disco nao vale)
    const blob = gitIn(dir, ['hash-object', '-w', '--stdin'], 'x\n').stdout.trim();
    const linhas = [];
    for (let i = 0; i < 400; i++) {
      linhas.push('100644 ' + blob + '\t.claude/skills/' + ('d'.repeat(30) + '/').repeat(95) + 'SKILL' + i + '.md');
    }
    const u = gitIn(dir, ['update-index', '--add', '--index-info'], linhas.join('\n') + '\n');
    assert.strictEqual(u.status, 0, u.stderr);
    git(dir, ['commit', '-q', '-m', 'grande'], AGORA - 30 * DIA);
    const bruto = gitIn(dir, ['log', '--name-only', '--format=%ct', '--', '.claude/skills']).stdout;
    assert.ok(bruto.length > 1024 * 1024, 'a fixture nao passou de 1 MiB: ' + bruto.length);
    const m = gitLib.ultimasMudancas(dir, '.claude/skills');
    assert.ok(m instanceof Map, 'historico grande virou null');
    assert.strictEqual(m.size, 400);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A2/git: arquivo chamado @<digitos> nao e confundido com o cabecalho de data; nome com controle tambem nao', () => {
  const gitLib = require('../scripts/lib/git.js');
  const dir = temp('git-sentinela');
  try {
    git(dir, ['init', '-q']);
    escrever(dir, '@1700000000', 'a\n');
    escrever(dir, 'normal.md', 'b\n');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-q', '-m', 'um'], AGORA - 40 * DIA);
    const m = gitLib.ultimasMudancas(dir, '.');
    assert.strictEqual(m.get('@1700000000'), Math.floor((AGORA - 40 * DIA) / 1000) * 1000, 'o arquivo @... virou data');
    assert.strictEqual(m.get('normal.md'), Math.floor((AGORA - 40 * DIA) / 1000) * 1000, 'o arquivo seguinte perdeu a data');
    // nome com caractere de controle (so se o git deixar entrar no indice): nunca vira cabecalho
    const blob = gitIn(dir, ['hash-object', '-w', '--stdin'], 'x\n').stdout.trim();
    const u = gitIn(dir, ['update-index', '--add', '--index-info'], '100644 ' + blob + '\t\u0001123\n');
    // o git de hoje ignora o caminho ("Ignoring path", status 0): so confere se algum dia aceitar
    if (u.status === 0 && !/Ignoring/.test(u.stderr)) {
      git(dir, ['commit', '-q', '-m', 'dois'], AGORA - 20 * DIA);
      const m2 = gitLib.ultimasMudancas(dir, '.');
      assert.strictEqual(m2.get('normal.md'), Math.floor((AGORA - 40 * DIA) / 1000) * 1000);
      // com -z o nome chega cru: se entrar, entra com a SUA data e nunca vira cabecalho de outro
      if (m2.has('\u0001123')) assert.strictEqual(m2.get('\u0001123'), Math.floor((AGORA - 20 * DIA) / 1000) * 1000);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A2/git: arquivo apagado nao carrega a data da delecao nem a do commit anterior - sai do Map (A2-16)', () => {
  const gitLib = require('../scripts/lib/git.js');
  const dir = temp('git-apagado');
  try {
    git(dir, ['init', '-q']);
    escrever(dir, '.claude/skills/x/SKILL.md', 'a\n');
    escrever(dir, '.claude/skills/y/SKILL.md', 'b\n');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-q', '-m', 'um'], AGORA - 100 * DIA);
    git(dir, ['rm', '-q', '.claude/skills/x/SKILL.md']);
    git(dir, ['commit', '-q', '-m', 'apaga x'], AGORA - 2 * DIA);
    const m = gitLib.ultimasMudancas(dir, '.claude/skills');
    assert.ok(!m.has('.claude/skills/x/SKILL.md'), 'o apagado ficou no Map: ' + m.get('.claude/skills/x/SKILL.md'));
    assert.strictEqual(m.get('.claude/skills/y/SKILL.md'), Math.floor((AGORA - 100 * DIA) / 1000) * 1000);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- P2 do bloco A2 (S10, D426): itens 1, 1c, 13, 14, 15, 16

test('A2-1: Date invalido em `agora` cai no relogio; a auditoria vencida roda e a marca grava (nao morre em RangeError)', () => {
  const dir = temp('data-invalida');
  try {
    marca(dir, Date.now() - 30 * DIA); // vencida: 30 dias atras
    const a = stub(limpo());
    assert.doesNotThrow(function () {
      ap.avisoDaAuditoria(dir, PROJETO, { agora: new Date('isto nao e data'), auditar: a });
    });
    assert.strictEqual(a.chamadas, 1, 'Date invalido calou a auditoria');
    const gravada = Date.parse(lerMarcaBruta(dir).ultima);
    assert.ok(isFinite(gravada) && Math.abs(gravada - Date.now()) < 60 * 1000, 'a marca nao foi regravada com a hora de agora');
    // e skillsParadas com o mesmo Date invalido nao vira NaN: usa o relogio
    escrever(dir, '.claude/skills/velha/SKILL.md', 'x\n');
    mtime(dir, 'velha', Date.now() - 100 * DIA);
    assert.strictEqual(ap.skillsParadas(dir, ['velha'], new Date(NaN), 90).length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A2-1c: elemento null/nao-objeto em sobreposicoes e contradicoes nao troca o aviso valido por "falhou"', () => {
  const dir = temp('itens-null');
  try {
    const rel = limpo({
      peso: { total: 300, teto: 200, estourou: true },
      sobreposicoes: [null, undefined, 7, 'x'],
      contradicoes: [null, undefined]
    });
    const t = ap.avisoDaAuditoria(dir, PROJETO, { agora: AGORA, auditar: stub(rel) });
    assert.ok(/acima do limite de 200\./.test(t), 'perdeu o aviso de peso: ' + t);
    assert.ok(t.indexOf('falhou') === -1, 'virou falha: ' + t);
    assert.ok(t.indexOf('sobrepoem') === -1 && t.indexOf('contradizem') === -1, 'contou lixo como achado: ' + t);
    // misturado com item valido: so o valido conta
    fs.rmSync(path.join(dir, '.claude'), { recursive: true, force: true });
    const t2 = ap.avisoDaAuditoria(dir, PROJETO, { agora: AGORA, auditar: stub(limpo({
      sobreposicoes: [null, { a: 'revisar', b: 'inspecionar' }],
      contradicoes: [{ gatilho: 'antes de commitar' }, null]
    })) });
    assert.ok(/skills que se sobrepoem \(1\): revisar x inspecionar/.test(t2), t2);
    assert.ok(/regras que se contradizem \(1 gatilho\): antes de commitar/.test(t2), t2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A2-13: nome que o git cita entre aspas (aspas, tab) entra no Map com o nome verdadeiro', () => {
  const gitLib = require('../scripts/lib/git.js');
  const dir = temp('git-aspas');
  try {
    git(dir, ['init', '-q']);
    // direto no indice (-z): o disco do Windows nao aceita aspas nem tab em nome de arquivo, e o git do
    // Windows so deixa entrar no indice com protectNTFS desligado (so neste comando)
    const blob = gitIn(dir, ['hash-object', '-w', '--stdin'], 'x\n').stdout.trim();
    const nomes = ['.claude/skills/com"aspas/SKILL.md', '.claude/skills/com\ttab/SKILL.md', '.claude/skills/normal/SKILL.md'];
    const u = gitIn(dir, ['-c', 'core.protectNTFS=false', 'update-index', '-z', '--add', '--index-info'],
      nomes.map(function (n) { return '100644 ' + blob + '\t' + n + '\0'; }).join(''));
    assert.strictEqual(u.status, 0, u.stderr);
    git(dir, ['commit', '-q', '-m', 'nomes'], AGORA - 60 * DIA);
    const m = gitLib.ultimasMudancas(dir, '.claude/skills');
    const esperado = Math.floor((AGORA - 60 * DIA) / 1000) * 1000;
    for (const n of nomes) assert.strictEqual(m.get(n), esperado, 'faltou (ou veio com aspas): ' + JSON.stringify(n));
    assert.strictEqual(m.size, 3, JSON.stringify(Array.from(m.keys())));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A2-14: timeout do git e distinguivel de "fora do git" (ambos null; so o timeout marca `falha.timeout`)', () => {
  const gitLib = require('../scripts/lib/git.js');
  const dir = temp('git-timeout');
  try {
    git(dir, ['init', '-q']);
    escrever(dir, 'a.md', 'a\n');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-q', '-m', 'um']);
    const falha = {};
    assert.strictEqual(gitLib.correr(dir, ['--version'], { timeout: 1, falha: falha }), null);
    assert.strictEqual(falha.timeout, true, 'timeout nao foi sinalizado');
    // ultimasMudancas repassa o canal
    const f2 = {};
    assert.strictEqual(gitLib.ultimasMudancas(dir, '.', { timeout: 1, falha: f2 }), null);
    assert.strictEqual(f2.timeout, true, 'ultimasMudancas escondeu o timeout');
    // fora do git: null tambem, mas SEM timeout
    const f3 = {};
    assert.strictEqual(gitLib.ultimasMudancas(path.join(dir, 'nao-existe'), '.', { falha: f3 }), null);
    assert.ok(!f3.timeout, 'cwd inexistente foi chamado de timeout');
    const f4 = {};
    assert.strictEqual(gitLib.correr(dir, ['subcomando-que-nao-existe'], { falha: f4 }), null);
    assert.ok(!f4.timeout, 'erro do git foi chamado de timeout');
    // sem opcoes tudo segue igual
    assert.strictEqual(typeof gitLib.correr(dir, ['--version']), 'string');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A2-15: vale a data MAIOR do arquivo, nao a primeira que o log mostra (relogio torto / ordem topologica)', () => {
  const gitLib = require('../scripts/lib/git.js');
  const dir = temp('git-ordem');
  try {
    git(dir, ['init', '-q']);
    escrever(dir, '.claude/skills/f/SKILL.md', 'a\n');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-q', '-m', 'pai recente'], AGORA - 5 * DIA);
    escrever(dir, '.claude/skills/f/SKILL.md', 'b\n');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-q', '-m', 'filho com relogio atrasado'], AGORA - 50 * DIA); // o log mostra o filho primeiro
    const m = gitLib.ultimasMudancas(dir, '.claude/skills');
    assert.strictEqual(m.get('.claude/skills/f/SKILL.md'), Math.floor((AGORA - 5 * DIA) / 1000) * 1000);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A2-16: apagado no git e recriado SEM commit usa o mtime (nao a data antiga do ultimo commit que o escreveu)', () => {
  const gitLib = require('../scripts/lib/git.js');
  const dir = temp('git-recriado');
  try {
    git(dir, ['init', '-q']);
    escrever(dir, '.claude/skills/r/SKILL.md', 'a\n');
    escrever(dir, '.claude/skills/ficou/SKILL.md', 'a\n');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-q', '-m', 'um'], AGORA - 100 * DIA);
    git(dir, ['rm', '-q', '.claude/skills/r/SKILL.md']);
    git(dir, ['commit', '-q', '-m', 'apaga r'], AGORA - 90 * DIA);
    escrever(dir, '.claude/skills/r/SKILL.md', 'recriada\n'); // sem commit
    mtime(dir, 'r', AGORA - 1 * DIA);
    mtime(dir, 'ficou', AGORA);
    assert.ok(!gitLib.ultimasMudancas(dir, '.claude/skills').has('.claude/skills/r/SKILL.md'),
      'o apagado ficou no Map com a data antiga');
    // consumidor: a recriada (mtime de 1 dia) nao e "parada"; a que ficou no git e (100 dias)
    assert.deepStrictEqual(ap.skillsParadas(dir, ['r', 'ficou'], AGORA, 90), [{ nome: 'ficou', dias: 100 }]);
    // recriada E commitada de novo: volta ao Map, com a data do novo commit
    git(dir, ['add', '.']);
    git(dir, ['commit', '-q', '-m', 'recria r'], AGORA - 3 * DIA);
    assert.strictEqual(gitLib.ultimasMudancas(dir, '.claude/skills').get('.claude/skills/r/SKILL.md'),
      Math.floor((AGORA - 3 * DIA) / 1000) * 1000);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Plano 091, Tarefa 6 (mock D559, secao 5): a auditoria le os contadores de ordem, mostra a diferenca contra a foto
// que guardou na marca da vez anterior e grava a foto nova. Nada disparado e nada a cortar segue em silencio.
function contadores(dir, obj) {
  escrever(dir, '.claude/sworn/contadores.json', JSON.stringify(obj));
}

test('091 T6: nada a cortar, com ordens na janela - so a retroalimentacao, sem a ordem de auditar; foto na marca', () => {
  const dir = temp('retro');
  try {
    escrever(dir, '.claude/sworn/auditoria.json', JSON.stringify({ ultima: new Date(AGORA - 7 * DIA).toISOString(),
      ordens: { ordem_aprender_dada: 1 } }));
    contadores(dir, { ordem_aprender_dada: 3, ordem_aprender_cumprida: 2, fecho_sem_evidencia: 4 });
    const t = ap.avisoDaAuditoria(dir, PROJETO, { agora: AGORA, auditar: stub(limpo()) });
    assert.strictEqual(t, [
      'sworn: auditoria automatica (a cada 7 dias): nada a cortar.',
      '- ordens dos ultimos 7 dias que o sworn deu ao Claude (dadas / cumpridas / recusadas pelo dono):',
      '  aprender 2/2/-',
      '  nunca disparadas: auditar, calibrar, init, revisar, manual',
      '  ("-": o sworn so ve a recusa no commit sem revisao; nas outras, ' +
        'a ordem que o Claude nao cumpriu foi ignorada ou',
      '  recusada na conversa. Ordem que se repete sem cumprir: vale perguntar ao dono se ela ainda serve.)'
    ].join('\n'));
    assert.strictEqual(ap.pedeCorte(t), false, 'nada a cortar nao pode acender o botao nem contar a ordem');
    assert.deepStrictEqual(lerMarcaBruta(dir).ordens, { ordem_aprender_dada: 3, ordem_aprender_cumprida: 2 });
    assert.strictEqual(lerMarcaBruta(dir).ultima, new Date(AGORA).toISOString());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('091 T6: com o que cortar, a retroalimentacao entra entre a lista e a ordem de auditar', () => {
  const dir = temp('retro-corte');
  try {
    contadores(dir, { ordem_revisar_dada: 2, ordem_revisar_cumprida: 1, ordem_revisar_recusada: 1 });
    const t = ap.avisoDaAuditoria(dir, PROJETO, { agora: AGORA,
      auditar: stub(limpo({ peso: { total: 227, teto: 200, estourou: true } })) });
    assert.strictEqual(t, [
      'sworn: auditoria automatica (a cada 7 dias) achou o que cortar:',
      '- instrucoes do projeto com 227 itens de lista (regras, skills e fontes canonicas), acima do limite de 200. ' +
        'Junte ou corte itens.',
      '- ordens desde o comeco que o sworn deu ao Claude (dadas / cumpridas / recusadas pelo dono):',
      '  revisar antes do commit 2/1/1',
      '  nunca disparadas: aprender, auditar, calibrar, init, manual',
      ORDEM_DO_MOCK
    ].join('\n'));
    assert.strictEqual(ap.pedeCorte(t), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('091 T6: nada disparado desde a foto e nada a cortar = silencio; a foto segue gravada', () => {
  const dir = temp('retro-calada');
  try {
    escrever(dir, '.claude/sworn/auditoria.json', JSON.stringify({ ultima: new Date(AGORA - 8 * DIA).toISOString(),
      ordens: { ordem_aprender_dada: 3 } }));
    contadores(dir, { ordem_aprender_dada: 3 });
    assert.strictEqual(ap.avisoDaAuditoria(dir, PROJETO, { agora: AGORA, auditar: stub(limpo()) }), '');
    assert.deepStrictEqual(lerMarcaBruta(dir).ordens, { ordem_aprender_dada: 3 });
    assert.strictEqual(ap.pedeCorte(''), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('091 T6: auditar que lanca com ordens na janela - a retroalimentacao sai junto, porque a foto avanca (revisao cega 0.9.0)', () => {
  const dir = temp('retro-falha');
  try {
    contadores(dir, { ordem_aprender_dada: 2 });
    const t = ap.avisoDaAuditoria(dir, PROJETO, { agora: AGORA, auditar: function () { throw new Error('quebrou'); } });
    assert.ok(t.startsWith('sworn: auditoria automatica falhou (Error: quebrou); ' +
      'rode /sworn:audit para ver o detalhe.\n'), t);
    assert.ok(t.includes('  aprender 2/0/-'), t);
    assert.deepStrictEqual(lerMarcaBruta(dir).ordens, { ordem_aprender_dada: 2 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- Plano 092: D573 (injetado da conversa anterior), D574 (atalhos a cada 30 dias), D576 (pasta e repositorios de dentro)

const injetadoLib = require('../scripts/lib/injetado.js');
const atalhosLib = require('../scripts/lib/atalhos.js');

/** A data local no formato da linha do mock: AAAA-MM-DD HH:MM. */
function local(ms) {
  const d = new Date(ms);
  const p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

test('D573: a auditoria passa a transcricao anterior ao auditar e avisa o gancho que volta mais de 5 vezes, com a conversa', () => {
  const dir = temp('injetado');
  try {
    const quando = Date.UTC(2026, 9, 19, 12, 5);
    const alvo = { caminho: path.join(dir, '4f947022-aaaa.jsonl'), plugins: dir, id: '4f947022', quando: quando };
    const relatorio = limpo({ injetado: { medido: true, repetidos: [
      { texto: '<context_guidance>', plugin: 'context-mode', gancho: 'PreToolUse:Read', vezes: 12, caracteres: 4812 }] } });
    let recebido = null;
    const auditar = function (c, p, o) { recebido = o; return relatorio; };
    const t = ap.avisoDaAuditoria(dir, PROJETO, { agora: AGORA, auditar: auditar, atalhos: function () { return []; }, transcricao: alvo });
    assert.ok(recebido && recebido.transcricao === alvo, 'o auditar nao recebeu a transcricao anterior');
    assert.strictEqual(t, [
      'sworn: auditoria automatica (a cada 7 dias) achou o que cortar:',
      '- texto repetido por plugin mais de 5 vezes na conversa anterior (4f947022, ' + local(quando) +
        ') (1): context-mode PreToolUse:Read 12x, 4812 caracteres. Corte para uma vez por sessao.',
      ORDEM_DO_MOCK
    ].join('\n'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D573: injetado nao medido, sem repetidos ou de forma estranha = linha nenhuma (nunca zero inventado)', () => {
  const rep = [{ texto: 't', plugin: 'p', gancho: 'g', vezes: 9, caracteres: 9 }];
  for (const injetado of [{ medido: false, motivo: 'nao medido' }, { medido: false, repetidos: rep }, { medido: true, repetidos: [] }, { medido: true, repetidos: [null, 3] }, null, 'x']) {
    const dir = temp('injetado-nada');
    try {
      const t = ap.avisoDaAuditoria(dir, PROJETO, { agora: AGORA, auditar: stub(limpo({ injetado: injetado })),
        atalhos: function () { return []; }, transcricao: { caminho: 'x', plugins: 'y', id: 'abcd1234', quando: AGORA } });
      assert.strictEqual(t, '', JSON.stringify(injetado) + ' -> ' + t);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('D573: injetado.anterior acha o .jsonl mais recente da pasta que nao e o da sessao atual (exista ou nao o atual)', () => {
  const dir = temp('anterior');
  try {
    const gravar = function (nome, ms) { escrever(dir, nome, '{}\n'); fs.utimesSync(path.join(dir, nome), new Date(ms), new Date(ms)); };
    gravar('11111111-velha.jsonl', AGORA - 3 * DIA);
    gravar('22222222-nova.jsonl', AGORA - DIA);
    gravar('atual-sessao.jsonl', AGORA);
    gravar('notas.txt', AGORA);
    const a = injetadoLib.anterior(path.join(dir, 'atual-sessao.jsonl'), 'atual-sessao', {});
    assert.strictEqual(path.basename(a.caminho), '22222222-nova.jsonl');
    assert.strictEqual(a.id, '22222222');
    assert.strictEqual(a.quando, AGORA - DIA);
    assert.ok(typeof a.plugins === 'string' && a.plugins.length > 0, 'sem a pasta de plugins');
    const semAtual = injetadoLib.anterior(path.join(dir, 'ainda-nao-existe.jsonl'), 'ainda-nao-existe', {});
    assert.strictEqual(path.basename(semAtual.caminho), 'atual-sessao.jsonl', 'com o atual ausente, a mais recente das outras');
    assert.strictEqual(injetadoLib.anterior(null, 'x', {}), null);
    assert.strictEqual(injetadoLib.anterior(path.join(dir, 'nada', 'x.jsonl'), 'x', {}), null, 'pasta que nao existe');
    // revisao 092 (borda): .jsonl vazio (sessao que nem escreveu) nao vira a "anterior" e esconde a de verdade
    escrever(dir, '44444444-vazia.jsonl', '');
    fs.utimesSync(path.join(dir, '44444444-vazia.jsonl'), new Date(AGORA - 1000), new Date(AGORA - 1000));
    assert.strictEqual(path.basename(injetadoLib.anterior(path.join(dir, 'atual-sessao.jsonl'), 'atual-sessao', {}).caminho),
      '22222222-nova.jsonl', 'escolheu o .jsonl vazio');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D573: com a entrada do gancho, a auditoria acha a anterior sozinha; dentro do prazo nem procura', () => {
  const dir = temp('entrada');
  const pasta = temp('entrada-projects');
  try {
    escrever(pasta, '33333333-outra.jsonl', '{}\n');
    let recebido = null;
    const auditar = function (c, p, o) { recebido = o; return limpo({}); };
    const entrada = { transcript_path: path.join(pasta, 'sessao-agora.jsonl'), session_id: 'sessao-agora' };
    ap.avisoDaAuditoria(dir, PROJETO, { agora: AGORA, auditar: auditar, atalhos: function () { return []; }, entrada: entrada });
    assert.strictEqual(path.basename(recebido.transcricao.caminho), '33333333-outra.jsonl');
    recebido = null;
    ap.avisoDaAuditoria(dir, PROJETO, { agora: AGORA + DIA, auditar: auditar, atalhos: function () { return []; }, entrada: entrada });
    assert.strictEqual(recebido, null, 'dentro do prazo auditou');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});

const ORDEM_DOS_ATALHOS = [
  'Faca no seu primeiro turno, depois de atender o pedido:',
  '1. Para cada atalho, confira se o "trocar quando" ja aconteceu.',
  '2. Se algum venceu (ou nao tem gatilho), leve ao usuario pelo',
  '   AskUserQuestion, em 3 opcoes, com o custo. Nao troque nada sem o sim.',
  '   Se nenhum venceu, nao diga nada.',
  'Desligar: "atalhosNaAbertura": false em .claude/sworn/projeto.json.'
].join('\n');

test('D574: a chave e atalhosNaAbertura e o prazo padrao e 30 dias', () => {
  assert.strictEqual(ap.CHAVE_ATALHOS, 'atalhosNaAbertura');
  assert.strictEqual(ap.PADROES.diasEntreAtalhos, 30);
  assert.strictEqual(ap.dias({ limiares: { diasEntreAtalhos: 10 } }, 'diasEntreAtalhos'), 10);
});

test('D574: a lista completa dos atalhos, no texto do mock, com e sem gatilho; marca propria; dentro de 30 dias, calada', () => {
  const dir = temp('rev-atalhos');
  try {
    const achados = [
      { arquivo: 'sworn/scripts/lib/ordens.js', linha: 88, oque: 'raiz comparada sem maiuscula em todo sistema.',
        limite: 'pastas que so diferem na caixa.', gatilho: 'aparecer projeto no Linux com duas pastas que so diferem na caixa.' },
      { arquivo: 'scripts/y.js', linha: 7, oque: 'retry fixo de 3 vezes.', limite: null, gatilho: null }
    ];
    let chamadas = 0;
    const varrer = function () { chamadas++; return achados; };
    const t = ap.avisoDosAtalhos(dir, PROJETO, { agora: AGORA, atalhos: varrer });
    assert.strictEqual(t, [
      'sworn: atalhos registrados (revisao a cada 30 dias): 2 atalhos em 2 arquivos; 1 sem gatilho.',
      '- sworn/scripts/lib/ordens.js:88  raiz comparada sem maiuscula em todo sistema.',
      '    trocar quando: aparecer projeto no Linux com duas pastas que so diferem na caixa.',
      '- scripts/y.js:7  retry fixo de 3 vezes.',
      '    sem gatilho',
      ORDEM_DOS_ATALHOS
    ].join('\n'));
    assert.ok(fs.existsSync(path.join(dir, '.claude', 'sworn', ap.MARCA_ATALHOS)), 'a marca propria nao foi gravada');
    assert.ok(!fs.existsSync(path.join(dir, '.claude', 'sworn', ap.MARCA)), 'gravou a marca da auditoria');
    assert.strictEqual(ap.avisoDosAtalhos(dir, PROJETO, { agora: AGORA + 29 * DIA, atalhos: varrer }), '');
    assert.strictEqual(chamadas, 1, 'dentro do prazo varreu de novo');
    assert.ok(ap.avisoDosAtalhos(dir, PROJETO, { agora: AGORA + 30 * DIA, atalhos: varrer }).startsWith('sworn: atalhos registrados'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D574: um atalho com gatilho = "todos com gatilho"; sem atalho, calada e com a marca; sem projeto ou desligada, nada', () => {
  const um = temp('rev-um');
  const nada = temp('rev-nada');
  const sem = temp('rev-sem');
  try {
    const t = ap.avisoDosAtalhos(um, PROJETO, { agora: AGORA,
      atalhos: function () { return [{ arquivo: 'a.js', linha: 1, oque: 'x.', limite: null, gatilho: 'y.' }]; } });
    assert.ok(t.startsWith('sworn: atalhos registrados (revisao a cada 30 dias): 1 atalho em 1 arquivo; todos com gatilho.\n'), t);
    assert.strictEqual(ap.avisoDosAtalhos(nada, PROJETO, { agora: AGORA, atalhos: function () { return []; } }), '');
    assert.ok(fs.existsSync(path.join(nada, '.claude', 'sworn', ap.MARCA_ATALHOS)), 'sem atalho tambem grava a marca');
    assert.strictEqual(ap.avisoDosAtalhos(sem, null, { agora: AGORA, atalhos: function () { return [{ arquivo: 'a.js', linha: 1, oque: 'x', gatilho: null }]; } }), '');
    assert.strictEqual(ap.avisoDosAtalhos(sem, { atalhosNaAbertura: false }, { agora: AGORA,
      atalhos: function () { return [{ arquivo: 'a.js', linha: 1, oque: 'x', gatilho: null }]; } }), '');
    assert.ok(!fs.existsSync(path.join(sem, '.claude')), 'sem projeto ou desligada criou a pasta');
  } finally {
    for (const d of [um, nada, sem]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('D574: mais de 10 atalhos lista os 10 primeiros e manda o resto ao /sworn:shortcuts; acento sai ASCII', () => {
  const dir = temp('rev-teto');
  const quebra = temp('rev-quebra');
  try {
    const achados = Array.from({ length: 12 }, function (_, i) {
      return { arquivo: 'a.js', linha: i + 1, oque: 'simplificação ' + i + '.', limite: null, gatilho: 'quando crescer.' };
    });
    const t = ap.avisoDosAtalhos(dir, PROJETO, { agora: AGORA, atalhos: function () { return achados; } });
    const itens = t.split('\n').filter(function (l) { return l.startsWith('- '); });
    assert.strictEqual(itens.length, 10);
    assert.ok(t.includes('- a.js:1  simplificacao 0.'), t);
    assert.ok(t.includes('\n(+2 nao listados: rode /sworn:shortcuts)\n'), t);
    assert.ok(/^[\x0a\x20-\x7e]*$/.test(t), 'saiu fora do ASCII');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(quebra, { recursive: true, force: true });
  }
});

// Revisao cega da 0.9.2 (ronda 1, estados/borda/manutencao): a falha da varredura calava por 30 dias, e o repositorio
// que nao respondia sumia da lista quando outro respondia.
test('revisao 092: varredura que lanca sai numa linha com a causa e o proximo passo, e a marca anda', () => {
  const quebra = temp('rev-quebra');
  try {
    const t = ap.avisoDosAtalhos(quebra, PROJETO, { agora: AGORA, atalhos: function () { throw new Error('git sumiu'); } });
    assert.strictEqual(t, 'sworn: atalhos registrados (revisao a cada 30 dias): a busca falhou (Error: git sumiu); rode /sworn:shortcuts para ver o detalhe.');
    assert.ok(fs.existsSync(path.join(quebra, '.claude', 'sworn', ap.MARCA_ATALHOS)), 'a falha repetiria a cada abertura');
  } finally { fs.rmSync(quebra, { recursive: true, force: true }); }
});

test('revisao 092: repositorio que nao respondeu sai nomeado, com e sem atalho; pasta sem git nenhum segue calada', () => {
  const com = temp('rev-falha-com');
  const sem = temp('rev-falha-sem');
  const fora = temp('rev-fora');
  try {
    const um = [{ arquivo: 'a.js', linha: 1, oque: 'x.', limite: null, gatilho: 'y.' }];
    const t = ap.avisoDosAtalhos(com, PROJETO, { agora: AGORA, atalhos: function () { return { achados: um, falhas: ['sub'] }; } });
    assert.ok(t.includes('\n1 repositorio nao varrido (o git nao respondeu): sub; rode /sworn:shortcuts de dentro dele.\n'), t);
    const s = ap.avisoDosAtalhos(sem, PROJETO, { agora: AGORA, atalhos: function () { return { achados: [], falhas: ['sub', 'outro'] }; } });
    assert.strictEqual(s, 'sworn: atalhos registrados (revisao a cada 30 dias): nenhum atalho achado; ' +
      '2 repositorios nao varridos (o git nao respondeu): sub; outro; rode /sworn:shortcuts de dentro dele.');
    assert.strictEqual(ap.avisoDosAtalhos(fora, PROJETO, { agora: AGORA,
      atalhos: function () { return { erro: 'Esta pasta nao e repositorio git', foraDeRepositorio: true }; } }), '');
  } finally {
    for (const d of [com, sem, fora]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('revisao 092: daPastaEDeDentro devolve em `falhas` o repositorio de dentro que o git nao leu', () => {
  const dir = temp('varre-falha');
  try {
    git(dir, ['init', '-q']);
    escrever(dir, 'a.js', '// atalho: na raiz\n');
    fs.mkdirSync(path.join(dir, 'quebrado'));
    fs.writeFileSync(path.join(dir, 'quebrado', '.git'), ''); // gitfile vazio: o git recusa a pasta
    const r = atalhosLib.daPastaEDeDentro(dir, {});
    assert.deepStrictEqual(r.achados.map(function (a) { return a.arquivo; }), ['a.js']);
    assert.deepStrictEqual(r.falhas, ['quebrado']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D576: a varredura pega a pasta aberta e os repositorios logo abaixo dela, com o caminho a partir da pasta', () => {
  const dir = temp('varre');
  try {
    git(dir, ['init', '-q']);
    escrever(dir, 'a.js', '// atalho: na raiz\n');
    escrever(dir, 'pasta/c.js', '// atalho: pasta comum da raiz\n');
    fs.mkdirSync(path.join(dir, 'sub'));
    git(path.join(dir, 'sub'), ['init', '-q']);
    escrever(dir, 'sub/b.js', 'x\n// atalho: no repositorio de dentro\n');
    const r = atalhosLib.daPastaEDeDentro(dir, {});
    const onde = r.achados.map(function (a) { return a.arquivo + ':' + a.linha; }).sort();
    assert.deepStrictEqual(onde, ['a.js:1', 'pasta/c.js:1', 'sub/b.js:2']);
    const t = ap.avisoDaAuditoria(dir, PROJETO, { agora: AGORA, auditar: stub(limpo({})) });
    assert.ok(t.includes('- atalhos sem "trocar quando" (3): '), t);
    assert.ok(t.includes('sub/b.js:2'), 'a auditoria de 7 dias nao varreu o repositorio de dentro: ' + t);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D576: pasta aberta fora de git com repositorio dentro ainda varre o de dentro; sem nenhum, erro', () => {
  const dir = temp('varre-fora');
  const vazio = temp('varre-vazio');
  const soQuebrado = temp('varre-so-quebrado');
  try {
    const noGit = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' });
    if (noGit.status === 0) return; // tmpdir dentro de repositorio: o cenario nao se monta aqui
    fs.mkdirSync(path.join(dir, 'sub'));
    git(path.join(dir, 'sub'), ['init', '-q']);
    escrever(dir, 'sub/b.js', '// atalho: dentro\n');
    const r = atalhosLib.daPastaEDeDentro(dir, {});
    assert.deepStrictEqual(r.achados.map(function (a) { return a.arquivo; }), ['sub/b.js']);
    assert.ok(atalhosLib.daPastaEDeDentro(vazio, {}).erro, 'sem repositorio nenhum devia dar erro');
    assert.strictEqual(atalhosLib.daPastaEDeDentro(vazio, {}).foraDeRepositorio, true, 'pasta sem git e falha do git se confundem');
    // revisao 092: o unico repositorio de dentro quebrado sai nomeado, nao como "pasta fora de git"
    fs.mkdirSync(path.join(soQuebrado, 'quebrado'));
    fs.writeFileSync(path.join(soQuebrado, 'quebrado', '.git'), ''); // gitfile vazio: o git recusa a pasta
    const q = atalhosLib.daPastaEDeDentro(soQuebrado, {});
    assert.deepStrictEqual(q.achados, [], JSON.stringify(q));
    assert.deepStrictEqual(q.falhas, ['quebrado'], JSON.stringify(q));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(vazio, { recursive: true, force: true });
    fs.rmSync(soQuebrado, { recursive: true, force: true });
  }
});
