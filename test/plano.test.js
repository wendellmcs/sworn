'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const plano = require('../scripts/lib/plano.js');

const PLANO = [
  '# Plano',
  '',
  '### Tarefa 1: esqueleto',
  '',
  '- [x] **Passo 1: escrever o teste**',
  '- [x] **Passo 2: rodar**',
  '',
  '### Tarefa 2: marcha',
  '',
  '- [x] **Passo 1: escrever o teste**',
  '- [ ] **Passo 2: implementar**',
  '- [ ] **Passo 3: commit**'
].join('\n');

function tmp(arquivos) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-plan-'));
  for (const [rel, txt] of Object.entries(arquivos || {})) {
    const alvo = path.join(dir, rel);
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, txt, 'utf8');
  }
  return dir;
}

test('plano: conta subitem aberto e fechado por tarefa', () => {
  const t = plano.parseTarefas(PLANO);
  assert.strictEqual(t.length, 2);
  assert.deepStrictEqual([t[0].n, t[0].abertos, t[0].total], [1, 0, 2]);
  assert.deepStrictEqual([t[1].n, t[1].abertos, t[1].total], [2, 2, 3]);
});

// A7-01/A9-07: caixa sob cabecalho que nao e tarefa, de nivel ACIMA dela, nao e passo da tarefa de cima (D604).
const PLANO_COM_SECAO = [
  '# Plano',
  '### Tarefa 1: a',
  '- [x] a',
  '- [X] b',
  '#### Notas da tarefa',
  '- [ ] passo sob subcabecalho',
  '```bash',
  '# comentario no bloco de codigo nao e cabecalho',
  '```',
  '- [ ] passo depois do bloco',
  '## Criterios de aceite',
  '- [ ] testes passam',
  '- [ ] doc'
].join('\n');

test('plano: cabecalho que nao e tarefa fecha a tarefa; subcabecalho e bloco de codigo nao (A7-01)', () => {
  const t = plano.parseTarefas(PLANO_COM_SECAO);
  assert.deepStrictEqual(t.map(function (x) { return [x.n, x.abertos, x.total]; }), [[1, 2, 4]]);
  const i = plano.parseItens(PLANO_COM_SECAO);
  assert.deepStrictEqual(i.map(function (x) { return [x.id, x.abertos, x.total, x.estado]; }), [['1', 2, 4, 'aberta']]);
  const fechada = PLANO_COM_SECAO.replace(/- \[ \] passo/g, '- [x] passo');
  assert.deepStrictEqual(plano.parseTarefas(fechada).map(function (x) { return [x.abertos, x.total]; }), [[0, 4]]);
  assert.deepStrictEqual(plano.parseItens(fechada).map(function (x) { return x.estado; }), ['feita']);
});

// D604 (R2 da s107): cabecalho no MESMO nivel da tarefa segue dentro dela - "### Passo 1" sob "### Tarefa 2" nao
// esconde do portao o passo aberto; "## Criterios" no nivel da "## Tarefa" conta nela (erro do lado seguro).
test('plano: cabecalho no mesmo nivel da tarefa nao fecha - o passo aberto segue cobrado (D604)', () => {
  const texto = '### Tarefa 2: a\n- [x] y\n### Passo 1\n- [ ] x\n### Tarefa 3: b\n- [x] z\n';
  assert.deepStrictEqual(plano.parseTarefas(texto).map(function (x) { return [x.n, x.abertos, x.total]; }), [[2, 1, 2], [3, 0, 1]]);
  assert.deepStrictEqual(plano.parseItens(texto).map(function (x) { return [x.id, x.abertos, x.total]; }), [['2', 1, 2], ['3', 0, 1]]);
  const semCaixaPropria = '### Tarefa 2: a\n### Passo 1\n- [ ] x\n';
  assert.deepStrictEqual(plano.parseTarefas(semCaixaPropria).map(function (x) { return [x.abertos, x.total]; }), [[1, 1]]);
  const mesmoNivel = '## Tarefa 1: a\n- [x] a\n## Criterios de aceite\n- [ ] testes passam\n';
  assert.deepStrictEqual(plano.parseTarefas(mesmoNivel).map(function (x) { return [x.abertos, x.total]; }), [[1, 2]]);
});

// R2 da s107: a cerca so fecha com o marcador que a abriu (mesmo caractere, comprimento igual ou maior); senao a
// linha ~~~ dentro de um bloco ``` "fechava" a cerca e o "# comentario" depois escondia do portao o passo aberto.
test('plano: cerca so fecha com o marcador que abriu - "# " dentro do bloco nao fecha a tarefa (A7-01, R2 s107)', () => {
  ['```md\n~~~\n# comentario\n```', '````\n```\n# comentario\n````', '~~~\n```\n# comentario\n~~~'].forEach(function (bloco) {
    const texto = '## Tarefa 1: a\n- [x] a\n' + bloco + '\n- [ ] passo depois do bloco\n';
    assert.deepStrictEqual(plano.parseTarefas(texto).map(function (x) { return [x.abertos, x.total]; }), [[1, 2]], bloco);
    assert.deepStrictEqual(plano.parseItens(texto).map(function (x) { return [x.abertos, x.total]; }), [[1, 2]], bloco);
  });
});

test('plano: "Tarefa 2b" nao fecha a Tarefa 2 no portao - as caixas dela seguem cobradas (A7-01)', () => {
  const t = plano.parseTarefas('### Tarefa 2: a\n- [x] a\n### Tarefa 2b: b\n- [ ] b\n### Tarefa 3: c\n- [x] c\n');
  assert.deepStrictEqual(t.map(function (x) { return [x.n, x.abertos, x.total]; }), [[2, 1, 2], [3, 0, 1]]);
});

test('plano: [X] maiusculo conta como feito (A9-07)', () => {
  const t = plano.parseTarefas('## Tarefa 1: a\n- [X] a\n- [x] b\n');
  assert.deepStrictEqual([t[0].abertos, t[0].total], [0, 2]);
});

test('plano: le o titulo da tarefa junto com o numero', () => {
  assert.strictEqual(plano.parseTarefas(PLANO)[1].titulo, 'marcha');
});

test('plano: texto sem tarefa nao estoura', () => {
  assert.deepStrictEqual(plano.parseTarefas('# nada aqui'), []);
});

test('plano: abrir grava dono e tarefa; ler devolve o mesmo', () => {
  const dir = tmp({ 'docs/p.md': PLANO });
  try {
    const a = plano.abrir(dir, 'docs/p.md', 'sessao-A');
    assert.strictEqual(a.sessionId, 'sessao-A');
    assert.strictEqual(a.arquivo, 'docs/p.md');
    assert.strictEqual(plano.lerAtivo(dir).sessionId, 'sessao-A');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('plano: sessao diferente da dona e detectada (a colisao de hoje)', () => {
  const dir = tmp({ 'docs/p.md': PLANO });
  try {
    const a = plano.abrir(dir, 'docs/p.md', 'sessao-A');
    assert.strictEqual(plano.donoOutro(a, 'sessao-B'), true);
    assert.strictEqual(plano.donoOutro(a, 'sessao-A'), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('plano: sem plano ativo, donoOutro e falso', () => {
  assert.strictEqual(plano.donoOutro(null, 'sessao-A'), false);
});

test('plano: proximaDecisao le o maior numero DO DISCO', () => {
  const dir = tmp({ 'd.md': '### D7 · a\n### D23 · b\n### D9 · c\n' });
  try {
    assert.strictEqual(plano.proximaDecisao(path.join(dir, 'd.md')), 24);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('plano: arquivo de decisoes ausente comeca em 1', () => {
  assert.strictEqual(plano.proximaDecisao('/nao/existe.md'), 1);
});

test('plano: alegacao de etapa concluida e reconhecida', () => {
  assert.strictEqual(plano.alegaEtapaConcluida('Tarefa 2 concluida.'), true);
  assert.strictEqual(plano.alegaEtapaConcluida('Fechei a etapa 3.'), true);
  assert.strictEqual(plano.alegaEtapaConcluida('A etapa está concluída.'), true);
  assert.strictEqual(plano.alegaEtapaConcluida('Segui para o proximo passo.'), false);
});

// Bloco N1/N2 (fase P2, D426). N1: `alegaEtapaConcluida` roda no gancho Stop; com ~50 mil espacos o regex
// antigo levava segundos (backtracking de `\s+\d*\s*` e `\s+(a|o)?\s*`). Limite folgado de proposito.
test('N1: alegaEtapaConcluida e linear - 50 mil espacos/caracteres em todas as formas patologicas', () => {
  const sp = ' '.repeat(50000);
  const formas = {
    'tarefa+sp+x': 'tarefa' + sp + 'x',
    'tarefa+sp+1+sp+x': 'tarefa' + sp + '1' + sp + 'x',
    'tarefa 1+sp+x': 'tarefa 1' + sp + 'x',
    'conclui+sp+x': 'conclui' + sp + 'x',
    'conclui+sp+a+sp+x': 'conclui' + sp + 'a' + sp + 'x',
    'conclui a+sp+x': 'conclui a' + sp + 'x',
    'tarefas+sp+lista': 'tarefas' + sp + '3' + sp + 'e' + sp + '4' + sp + 'x',
    'tabs/quebras/nbsp': 'tarefa' + '\t\n  '.repeat(12500) + 'x',
    'palavra longa': 'fech' + 'a'.repeat(50000) + ' x',
    'digitos': 'tarefa ' + '1'.repeat(50000) + 'x',
    'lista longa': 'tarefa 1' + ' e 1'.repeat(12500) + 'x',
    'nomes repetidos': 'tarefa '.repeat(7000) + 'x',
    'verbo e artigo repetidos': 'conclui a '.repeat(5000) + 'x',
    // D656: as formas em ingles
    'task 1+sp+x': 'task 1' + sp + 'x',
    'finished the+sp+x': 'finished the' + sp + 'x',
    'lista longa em ingles': 'task 1' + ' and 1'.repeat(10000) + 'x',
    'nomes repetidos em ingles': 'task '.repeat(10000) + 'x',
    'nao repetido': 'not '.repeat(10000) + 'completed x'
  };
  Object.keys(formas).forEach((nome) => {
    const ini = performance.now();
    plano.alegaEtapaConcluida(formas[nome]);
    const ms = performance.now() - ini;
    assert.ok(ms < 200, 'backtracking em "' + nome + '": ' + ms.toFixed(0) + ' ms');
  });
});

// N2: plural e lista alegam. Nao-alegacao continua nao alegando.
test('N2: plural e lista de etapas ("Tarefas 1 e 2 concluidas") alegam conclusao', () => {
  [
    'Tarefas 1 e 2 concluidas', 'etapas 3, 4 e 5 fechadas', 'concluí as tarefas 1 e 2', 'fases concluídas',
    'As tarefas 1 e 2 estão concluídas', 'As tarefas 1 e 2 foram concluídas', 'Concluí as etapas 1, 2 e 3.',
    'Fechei as ondas.', 'Finalizamos as fases 1 e 2.', 'As etapas estao prontas', 'Tarefas  1\ne 2   completas'
  ].forEach((t) => assert.strictEqual(plano.alegaEtapaConcluida(t), true, t));
});

test('N2: o que nao alega conclusao continua sem alegar (singular e plural)', () => {
  [
    'a tarefa 2 ainda nao foi concluida', 'As tarefas 1 e 2 ainda não foram concluídas', 'A tarefa 2 não está concluída',
    'Tarefas 1 e 2 pendentes', 'Tarefa 2 em andamento', 'Fechei os chamados 1 e 2', 'Segui para o proximo passo.',
    'A tarefa 3 esta pendente.', 'Abri a tarefa 3.', 'O chamado 3 foi fechado.', 'Abri as tarefas 1 e 2.'
  ].forEach((t) => assert.strictEqual(plano.alegaEtapaConcluida(t), false, t));
});

test('plano: motivo cita quantos subitens ficaram abertos', () => {
  const t = plano.parseTarefas(PLANO)[1];
  const m = plano.motivoSubitemAberto(t);
  assert.ok(m.includes('2'));
  assert.ok(m.includes('Tarefa 2'));
  assert.ok(/^[\x20-\x7E\n]+$/.test(m), 'motivo tem de ser ASCII (R5)');
});

// ---- lote 2 (D422): DC-02 e DC-03 ------------------------------------------
const { spawnSync } = require('node:child_process');
const RAIZ_PLUGIN = path.join(__dirname, '..');

test('plano.js --abrir: sem --sessao grava o dono de CLAUDE_CODE_SESSION_ID (DC-03)', () => {
  const dir = tmp({ 'docs/p.md': PLANO });
  try {
    const env = Object.assign({}, process.env, { CLAUDE_CODE_SESSION_ID: 'sessao-real-x' });
    delete env.CLAUDE_SESSION_ID;
    const r = spawnSync(process.execPath, [path.join(RAIZ_PLUGIN, 'scripts', 'plano.js'), '--abrir', 'docs/p.md'],
      { cwd: dir, encoding: 'utf8', env: env });
    assert.strictEqual(r.status, 0, r.stderr);
    const gravado = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'sworn', 'plano-ativo.json'), 'utf8'));
    assert.strictEqual(gravado.sessionId, 'sessao-real-x', 'gravou o dono errado: ' + JSON.stringify(gravado));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('abertura.js: o aviso de plano alheio cita um caminho REAL, nunca a variavel nao expandida (DC-02)', () => {
  const dir = tmp({ 'docs/p.md': PLANO });
  try {
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'plano-ativo.json'),
      JSON.stringify({ arquivo: 'docs/p.md', sessionId: 'dono-outro', tarefa: null }), 'utf8');
    const r = spawnSync(process.execPath, [path.join(RAIZ_PLUGIN, 'scripts', 'abertura.js')], {
      cwd: dir, encoding: 'utf8',
      input: JSON.stringify({ session_id: 'eu-mesmo', cwd: dir, source: 'startup' }),
      env: Object.assign({}, process.env, { SWORN_TMP: path.join(dir, '_sessoes') })
    });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('proxima-decisao'), 'faltou o comando no aviso: ' + r.stdout);
    assert.ok(!r.stdout.includes('${CLAUDE_PLUGIN_ROOT}'), 'variavel nao expandida na saida do gancho: ' + r.stdout);
    const m = /node "([^"]+plano\.js)"/.exec(r.stdout);
    assert.ok(m, 'sem caminho entre aspas: ' + r.stdout);
    assert.ok(path.isAbsolute(m[1]) && fs.existsSync(m[1]), 'o caminho citado nao existe: ' + m[1]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('plano.js --proxima-decisao: arquivo ausente avisa no stderr; pasta sai 1 (D460)', () => {
  const dir = tmp({ 'docs/decisoes.md': '### D41 · a\n' });
  try {
    const cli = (alvo) => spawnSync(process.execPath, [path.join(RAIZ_PLUGIN, 'scripts', 'plano.js'), '--proxima-decisao', alvo],
      { cwd: dir, encoding: 'utf8' });
    const certo = cli('docs/decisoes.md');
    assert.strictEqual(certo.status, 0, certo.stderr);
    assert.strictEqual(certo.stdout, '42\n');
    assert.strictEqual(certo.stderr, '', 'arquivo certo nao avisa');
    const errado = cli('doc/decisoes.md');
    assert.strictEqual(errado.status, 0, errado.stderr);
    assert.strictEqual(errado.stdout, '1\n', 'projeto novo segue comecando em 1');
    assert.match(errado.stderr, /nao existe/);
    assert.ok(errado.stderr.includes(path.join(dir, 'doc', 'decisoes.md')), 'o aviso cita o caminho absoluto: ' + errado.stderr);
    const pasta = cli('docs');
    assert.strictEqual(pasta.status, 1, 'pasta no lugar do arquivo: ' + pasta.stdout);
    assert.strictEqual(pasta.stdout, '');
    assert.match(pasta.stderr, /nao e um arquivo/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Pedido 30 (plano dos pedidos 30-32, Tarefa 2): o plano em uma linha, para a faixa do mod (a sonda da s53 provou que
// o status do VS Code desenha uma linha so). Nome curto do arquivo, feitas de total, a proxima.
const D503 = { arquivo: '.context/plans/2026-10-13-sworn-pendencias-d503-plano.md', frente: 'sworn-pendencias' };

// Plano 082, Tarefa 2 (mock D532, S1): separador " · ", a unidade depois da conta (p7-9), "—" entre o id e o titulo, e
// acento (D532: a faixa e excecao a R5).
test('pedido 30: linhaDoPlano - nome curto, feitas de total com a unidade e a proxima, numa linha', () => {
  assert.strictEqual(plano.linhaDoPlano(D503, plano.parseItens(PLANO)), 'plano d503 · 1 de 2 tarefas · próxima: Tarefa 2 — marcha');
  // Sem frente (plano-ativo.json), o nome sai so sem a data e sem o "-plano".
  assert.strictEqual(plano.linhaDoPlano({ arquivo: 'p/2026-01-01-x-plano.md' }, plano.parseItens(PLANO)),
    'plano x · 1 de 2 tarefas · próxima: Tarefa 2 — marcha');
});

test('plano 082 (p7-9): a unidade segue o tipo das linhas que contam (singular no total 1); misturados viram "itens"', () => {
  const casos = [['### Etapa 1: a\n- [x] p\n### Etapa 2: b\n- [ ] p', '1 de 2 etapas'],
    ['### Fase 1: a\n- [ ] p\n### Fase 2: b\n- [ ] p', '0 de 2 fases'], ['### Onda 1: a\n- [ ] p', '0 de 1 onda'],
    ['### Item 1: a\n- [ ] p\n### Item 2: b\n- [ ] p', '0 de 2 itens'], ['### Tarefa 1: a\n- [ ] p', '0 de 1 tarefa'],
    ['### Tarefa 1: a\n- [x] p\n### Etapa 2: b\n- [ ] p', '1 de 2 itens']];
  for (const [texto, conta] of casos) {
    const l = plano.linhaDoPlano(D503, plano.parseItens(texto));
    assert.ok(l.indexOf('plano d503 · ' + conta + ' · ') === 0, l);
  }
});

test('plano 082 (p7-7): linha da tabela sem id fica fora da conta, e a faixa diz quantas', () => {
  const um = plano.parseItens('| Etapa | X |\n|---|---|\n| P0 | a |\n| Alfa | b |\n| P1 | c |');
  assert.strictEqual(um.semId.length, 1, 'controle: a tabela tem 1 linha sem id');
  assert.ok(/ · 1 linha da tabela fora da conta$/.test(plano.linhaDoPlano(D503, um)), plano.linhaDoPlano(D503, um));
  const dois = plano.parseItens('| Etapa | X |\n|---|---|\n| P0 | a |\n| Alfa | b |\n| Beta | c |');
  assert.ok(/ · 2 linhas da tabela fora da conta$/.test(plano.linhaDoPlano(D503, dois)), plano.linhaDoPlano(D503, dois));
  assert.ok(plano.linhaDoPlano(D503, plano.parseItens(PLANO)).indexOf('fora da conta') === -1);
});

test('pedido 30: linhaDoPlano - sem plano, ou plano sem tarefa contavel, e vazia (a faixa nao mostra nada)', () => {
  assert.strictEqual(plano.linhaDoPlano(null, plano.parseItens(PLANO)), '');
  assert.strictEqual(plano.linhaDoPlano({}, plano.parseItens(PLANO)), '');
  assert.strictEqual(plano.linhaDoPlano(D503, []), '');
  assert.strictEqual(plano.linhaDoPlano(D503, null), '');
});

test('pedido 30: linhaDoPlano - tudo feito diz "concluído" com a conta (plano 082, p7-9; mock S1)', () => {
  const feito = '### Tarefa 1: a\n- [x] p\n### Tarefa 2: b\n- [x] p';
  assert.strictEqual(plano.linhaDoPlano(D503, plano.parseItens(feito)), 'plano d503 · concluído (2 de 2 tarefas)');
});

test('pedido 30: linhaDoPlano - tarefa sem caixa sobrando nao e "concluído" (D436, como o painel)', () => {
  const semCaixa = '### Tarefa 1: a\n- [x] p\n### Tarefa 2: b\ntexto sem caixa\n### Tarefa 3: c\noutro texto';
  assert.strictEqual(plano.linhaDoPlano(D503, plano.parseItens(semCaixa)),
    'plano d503 · 1 de 3 tarefas · 2 sem caixas, confira à mão');
});

test('pedido 30: linhaDoPlano - acento e travessao inteiros (D532), uma linha, titulo longo cortado', () => {
  const longo = '### Tarefa 1: a\n- [x] p\n### Tarefa 2: pacote com referência (0.8.0) — depende da decisão ' +
    'acima e de mais coisa ainda\n- [ ] p';
  const l = plano.linhaDoPlano(D503, plano.parseItens(longo));
  assert.ok(l.indexOf('?') === -1 && l.indexOf('\n') === -1, l);
  assert.ok(l.indexOf('próxima: Tarefa 2 — pacote com referência (0.8.0) — depende') !== -1, l);
  assert.ok(/\.\.\.$/.test(l), 'cortado com reticencias: ' + l);
  assert.ok(l.length <= 110, l.length + ': ' + l);
});

// Plano 082 (D532, S5): o painel sai com acento, e o travessao do titulo fica (era trocado por hifen pela R5, s131).
test('s131 par.5: o travessao do titulo chega ao painel do plano inteiro, nem hifen nem "?"', () => {
  const t = plano.parseItens('### Tarefa 1: a — b\n- [ ] p');
  const painel = plano.painelTexto({ arquivo: 'p.md' }, t, 'plano.js');
  assert.ok(painel.indexOf('- [ ] Tarefa 1: a — b (1 de 1 passos abertos)') !== -1, painel);
});

test('pedido 30: linhaDoPlanoDaSessao - pelo plano-ativo.json, pela frente, e vazia sem plano', () => {
  const dir = tmp({
    'p/2026-01-01-x-plano.md': PLANO,
    '.claude/sworn/plano-ativo.json': JSON.stringify({ arquivo: 'p/2026-01-01-x-plano.md', sessionId: 's' })
  });
  const frente = tmp({
    'docs/2026-01-02-fr-y-plano.md': PLANO,
    '.claude/sworn/escopos/fr.md': '# Escopo\n**Objetivo:** algo. Plano: `docs/2026-01-02-fr-y-plano.md`\n## Dentro\n- x/**\n'
  });
  const vazio = tmp({});
  try {
    assert.strictEqual(plano.linhaDoPlanoDaSessao(dir, null), 'plano x · 1 de 2 tarefas · próxima: Tarefa 2 — marcha');
    assert.strictEqual(plano.linhaDoPlanoDaSessao(frente, 'fr'), 'plano y · 1 de 2 tarefas · próxima: Tarefa 2 — marcha');
    assert.strictEqual(plano.linhaDoPlanoDaSessao(vazio, null), '');
    assert.strictEqual(plano.linhaDoPlanoDaSessao(path.join(vazio, 'nao-existe'), 'fr'), '');
  } finally {
    for (const d of [dir, frente, vazio]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('pedido 30: linhaDoPlanoDaSessao - a frente vinculada escolhe entre varias; ilegivel e fora do projeto dao vazio', () => {
  const frente = (nome, plano) => '# Escopo\n**Objetivo:** ' + nome + '. Plano: `' + plano + '`\n## Dentro\n- x/**\n';
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-linha-'));
  const dir = path.join(base, 'proj');
  const escrever = (rel, txt) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), txt); };
  try {
    escrever('docs/2026-01-02-a-plano.md', PLANO);
    escrever('docs/2026-01-02-b-plano.md', '### Tarefa 1: so\n- [ ] p\n');
    escrever('.claude/sworn/escopos/a.md', frente('a', 'docs/2026-01-02-a-plano.md'));
    escrever('.claude/sworn/escopos/b.md', frente('b', 'docs/2026-01-02-b-plano.md'));
    assert.strictEqual(plano.linhaDoPlanoDaSessao(dir, 'b'), 'plano b · 0 de 1 tarefa · próxima: Tarefa 1 — so');
    assert.strictEqual(plano.linhaDoPlanoDaSessao(dir, null), '', 'duas frentes sem vinculo: o painel pede para escolher');
    // Plano fora do projeto: o painel diz que nao le; a linha fica vazia.
    fs.writeFileSync(path.join(base, '2026-01-02-fora-plano.md'), PLANO);
    escrever('.claude/sworn/escopos/b.md', frente('b', '../2026-01-02-fora-plano.md'));
    assert.strictEqual(plano.linhaDoPlanoDaSessao(dir, 'b'), '');
    // plano-ativo.json que nao se le nao cai na frente (D442/10, como no painel).
    escrever('.claude/sworn/plano-ativo.json', '{ quebrado');
    assert.strictEqual(plano.linhaDoPlanoDaSessao(dir, 'a'), '');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// Pedido 70 (D541): chat sem frente vinculada e sem plano no escopo.md nao mostra o plano da unica frente com plano.
test('pedido 70 (D541): a faixa fica vazia sem vinculo; o plano do escopo.md da raiz segue na faixa', () => {
  const dir = tmp({
    'docs/2026-01-02-fr-y-plano.md': PLANO,
    '.claude/sworn/escopos/fr.md': '# Escopo\n**Objetivo:** algo. Plano: `docs/2026-01-02-fr-y-plano.md`\n## Dentro\n- x/**\n'
  });
  try {
    assert.strictEqual(plano.acharPlanoDaFrente(dir, null).semVinculo, true, 'o painel segue achando a frente unica');
    assert.strictEqual(plano.linhaDoPlanoDaSessao(dir, null), '', 'chat sem plano nao mostra o plano de outra frente');
    assert.strictEqual(plano.linhaDoPlanoDaSessao(dir, 'fr'), 'plano y · 1 de 2 tarefas · próxima: Tarefa 2 — marcha');
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'escopo.md'),
      '# Escopo\n**Objetivo:** raiz. Plano: `docs/2026-01-02-fr-y-plano.md`\n## Dentro\n- x/**\n');
    // Sem frente nao ha prefixo a tirar do nome (nomeCurto): "fr-y".
    assert.strictEqual(plano.linhaDoPlanoDaSessao(dir, null), 'plano fr-y · 1 de 2 tarefas · próxima: Tarefa 2 — marcha');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Plano 083 Tarefa 4: p3-2 (corte sem surrogate orfao), p3-4 (Markdown do plano escapado no painel), p3-13 (o
// motivo sem bronca, ASCII pela R5), p3-23 (o modo JSON separa leitura de contagem e diz a causa).
test('083 T4 (p3-2): titulo cortado na faixa nunca parte um emoji ao meio', () => {
  const titulo = 'a'.repeat(44) + '\u{1F600}' + 'b'.repeat(6);
  assert.strictEqual(titulo.charCodeAt(44) >= 0xD800 && titulo.charCodeAt(44) <= 0xDBFF, true, 'controle: o par comeca no corte');
  const l = plano.linhaDoPlano({ arquivo: 'p.md' }, plano.parseItens('### Tarefa 1: ' + titulo + '\n- [ ] p'));
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(l), 'surrogate orfao: ' + JSON.stringify(l));
  assert.ok(/a\.\.\.$/.test(l), 'cortado antes do emoji: ' + l);
});

test('083 T4 (p3-4): titulo e id do plano com Markdown chegam ao painel escapados', () => {
  const t = plano.parseItens('### Tarefa 1: ajustar <config> e *x* e `a_b <c>`_z\n- [ ] p');
  const painel = plano.painelTexto({ arquivo: 'p.md' }, t, 'plano.js');
  // o trecho entre crases fica como veio (codigo de proposito, mock S5); fora dele, escapado
  assert.ok(painel.indexOf('Tarefa 1: ajustar \\<config\\> e \\*x\\* e `a_b <c>`\\_z (1 de 1 passos abertos)') !== -1, painel);
});

test('083 T4 (p3-13): o motivo do subitem aberto diz o que falta sem bronca, em ASCII', () => {
  const m = plano.motivoSubitemAberto(plano.parseTarefas(PLANO)[1]);
  assert.ok(!/ressalva|Ou esta completa|Voce disse/.test(m), m);
  assert.ok(/^sworn - subitem pendente = etapa aberta\.\n\n/.test(m) && /\nFaca uma destas:\n {2}1\. /.test(m), m);
  assert.ok(/^[\x20-\x7E\n]+$/.test(m), 'ASCII (R5)');
});

test('083 T4 (p3-23): o modo JSON diz a causa de nao ler o plano', () => {
  const pasta = tmp({ 'p/uma-pasta/x.md': PLANO, '.claude/sworn/plano-ativo.json': JSON.stringify({ arquivo: 'p/uma-pasta' }) });
  const falta = tmp({ '.claude/sworn/plano-ativo.json': JSON.stringify({ arquivo: 'p/nao-existe.md' }) });
  try {
    const script = path.join(RAIZ_PLUGIN, 'scripts', 'plano.js');
    const a = spawnSync(process.execPath, [script], { cwd: pasta, encoding: 'utf8' });
    assert.strictEqual(a.status, 1, a.stdout);
    assert.strictEqual(a.stdout, 'ERRO: não consegui ler p/uma-pasta: o caminho é uma pasta, não um arquivo (EISDIR).\n');
    const b = spawnSync(process.execPath, [script], { cwd: falta, encoding: 'utf8' });
    assert.strictEqual(b.stdout, 'ERRO: não consegui ler p/nao-existe.md: o arquivo ou a pasta não existe (ENOENT).\n');
  } finally { for (const d of [pasta, falta]) fs.rmSync(d, { recursive: true, force: true }); }
});

// Plano 082, Tarefa 6 (p7-5): o --abrir aceita caminho absoluto, e o path.join o colava no cwd (ENOENT, faixa vazia).
test('082 T6 (p7-5): plano-ativo.json com caminho absoluto se le na faixa, no painel e no JSON', () => {
  const dir = tmp({ 'p/2026-01-01-x-plano.md': PLANO });
  try {
    const abs = path.join(dir, 'p', '2026-01-01-x-plano.md');
    plano.abrir(dir, abs, 's');
    assert.strictEqual(plano.linhaDoPlanoDaSessao(dir, null), 'plano x · 1 de 2 tarefas · próxima: Tarefa 2 — marcha');
    const script = path.join(RAIZ_PLUGIN, 'scripts', 'plano.js');
    const painel = spawnSync(process.execPath, [script, '--texto'], { cwd: dir, encoding: 'utf8' });
    assert.ok(painel.stdout.indexOf('1 de 2 tarefas') !== -1 && painel.stdout.indexOf('Não consegui ler') === -1, painel.stdout);
    const json = spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(json.status, 0, json.stdout);
    assert.strictEqual(JSON.parse(json.stdout).tarefas, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// p7-2: a faixa le o plano a cada medida; acima do teto (bytes no disco) ela fica vazia em vez de ler o arquivo.
test('082 T6 (p7-2): plano no teto se le na faixa; um byte acima, a faixa fica vazia', () => {
  const dir = tmp({});
  try {
    const rel = 'p/2026-01-01-x-plano.md';
    const alvo = path.join(dir, rel);
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    const enche = (n) => PLANO + '\n' + 'x'.repeat(n - Buffer.byteLength(PLANO + '\n', 'utf8'));
    plano.abrir(dir, rel, 's');
    assert.strictEqual(plano.TETO_DO_PLANO, 1024 * 1024);
    fs.writeFileSync(alvo, enche(plano.TETO_DO_PLANO), 'utf8');
    assert.strictEqual(fs.statSync(alvo).size, plano.TETO_DO_PLANO);
    assert.strictEqual(plano.linhaDoPlanoDaSessao(dir, null), 'plano x · 1 de 2 tarefas · próxima: Tarefa 2 — marcha');
    fs.writeFileSync(alvo, enche(plano.TETO_DO_PLANO + 1), 'utf8');
    assert.strictEqual(fs.statSync(alvo).size, plano.TETO_DO_PLANO + 1);
    assert.strictEqual(plano.linhaDoPlanoDaSessao(dir, null), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// p7-16: o abrir() gravava sem try e o erro do disco (EACCES, ENOSPC) subia cru, com stack trace.
test('082 T6 (p7-16): abrir que nao grava diz o arquivo, a causa e o que fazer, sem stack trace', () => {
  const dir = tmp({ 'docs/p.md': PLANO, '.claude': 'um arquivo onde devia haver pasta' });
  try {
    assert.throws(() => plano.abrir(dir, 'docs/p.md', 's'), (e) => {
      // Plano 083 (p3-14): com acento, sem "sworn:" e com a causa em palavras antes do codigo.
      assert.ok(/^Não consegui gravar .*plano-ativo\.json: um arquivo ocupa o lugar de uma pasta no caminho \(E[A-Z]+\)\./
        .test(e.message), e.message);
      assert.ok(e.message.indexOf('o plano não foi aberto.') !== -1, e.message);
      return true;
    });
    const r = spawnSync(process.execPath, [path.join(RAIZ_PLUGIN, 'scripts', 'plano.js'), '--abrir', 'docs/p.md'],
      { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(r.status, 1, r.stdout);
    assert.ok(r.stderr.indexOf('Não consegui gravar ') === 0, r.stderr);
    assert.ok(!/\n\s+at /.test(r.stderr), 'stack trace no stderr: ' + r.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// D660: plano em ingles ("## Task N") dava 0 tarefas e 0 itens - o painel ficava vazio e a alegacao em ingles nao
// cobrava o subitem aberto. Task/Step/Stage/Wave/Phase contam como Tarefa/Etapa/Etapa/Onda/Fase.
test('D660: parseTarefas le "Task N" como le "Tarefa N", e so ele (Step/Stage/Wave/Phase seguem fora, como Etapa)', () => {
  const pt = plano.parseTarefas('## Tarefa 1: A\n- [ ] a\n- [x] b\n## Tarefa 2. B\n- [x] c');
  const en = plano.parseTarefas('## Task 1: A\n- [ ] a\n- [x] b\n## task 2. B\n- [x] c');
  assert.deepStrictEqual(en.map(function (t) { return [t.n, t.titulo, t.abertos, t.total]; }),
    [[1, 'A', 1, 2], [2, 'B', 0, 1]]);
  assert.deepStrictEqual(en.map(function (t) { return [t.n, t.abertos, t.total]; }),
    pt.map(function (t) { return [t.n, t.abertos, t.total]; }));
  assert.deepStrictEqual(plano.parseTarefas('## Step 1: A\n- [ ] a\n## Phase 2: B\n- [ ] b'), []);
  assert.deepStrictEqual(plano.parseTarefas('## Etapa 1: A\n- [ ] a'), []);
  // A palavra inteira: "Tasks 1:" e "Taskforce 1:" nao sao cabecalho de tarefa.
  assert.deepStrictEqual(plano.parseTarefas('## Tasks 1: A\n- [ ] a\n## Taskforce 2: B\n- [ ] b\n## Task3: C\n- [ ] c'), []);
  const m = plano.motivoSubitemAberto(en[0]);
  assert.ok(m.indexOf('Tarefa 1 ("A")') !== -1 && m.indexOf('1 de 2 passos') !== -1, m);
});

test('D660: parseItens le Task/Step/Stage/Wave/Phase como Tarefa/Etapa/Onda/Fase, nos cabecalhos e na tabela', () => {
  const itens = plano.parseItens('## Phase 1: G\n### Task 1: A\n- [x] a\n### Step 2a - B\n- [ ] b\n' +
    '### Stage 3 — C [FEITO]\n### Wave 4. D\n- [x] d');
  assert.deepStrictEqual(itens.map(function (t) { return [t.tipo, t.id, t.titulo, t.estado]; }), [
    ['Task', '1', 'A', 'feita'], ['Step', '2a', 'B', 'aberta'], ['Stage', '3', 'C', 'feita'], ['Wave', '4', 'D', 'feita']]);
  const tabela = plano.parseItens('| Tasks | What |\n|---|---|\n| T1 [FEITO] | x |\n| T2 | y |');
  assert.deepStrictEqual(tabela.map(function (t) { return [t.tipo, t.id, t.estado]; }),
    [['Task', 'T1', 'feita'], ['Task', 'T2', 'sem marca']]);
  assert.deepStrictEqual(plano.parseItens('## Tasks overview\n- [ ] a\n## Taskforce 1: x\n- [ ] b'), []);
  assert.deepStrictEqual(plano.parseItens('| Taskforce | What |\n|---|---|\n| T1 | x |'), []);
});

test('D660: a faixa conta tarefas, etapas, ondas e fases em ingles com a unidade do tipo', () => {
  const ativo = { arquivo: 'docs/x-plano.md' };
  const linha = function (texto) { return plano.linhaDoPlano(ativo, plano.parseItens(texto)); };
  assert.ok(linha('### Task 1: A\n- [x] a\n### Task 2: B\n- [ ] b').indexOf(' 1 de 2 tarefas ') !== -1,
    linha('### Task 1: A\n- [x] a\n### Task 2: B\n- [ ] b'));
  assert.ok(linha('### Step 1: A\n- [x] a\n### Step 2: B\n- [ ] b').indexOf(' 1 de 2 etapas ') !== -1);
  assert.ok(linha('### Stage 1: A\n- [x] a\n### Stage 2: B\n- [ ] b').indexOf(' 1 de 2 etapas ') !== -1);
  assert.ok(linha('### Wave 1: A\n- [x] a\n### Wave 2: B\n- [ ] b').indexOf(' 1 de 2 ondas ') !== -1);
  assert.ok(linha('### Phase 1: A\n- [x] a\n### Phase 2: B\n- [ ] b').indexOf(' 1 de 2 fases ') !== -1);
});

// Colheita 10-20, item 14 (D674): nota viva. Com plano na sessao, 5 turnos com trabalho sem o arquivo do plano mudar
// pedem a nota de progresso nele; o plano mudou = a conta recomeca.
test('item 14: notaViva conta os turnos com trabalho desde a ultima mudanca do plano', () => {
  let r = plano.notaViva(undefined, 1000, 3);
  assert.deepStrictEqual(r, { marca: { mtime: 1000, turnos: 3 }, avisar: false }, '1a vez so marca');
  r = plano.notaViva(r.marca, 1000, 7);
  assert.strictEqual(r.avisar, false, '4 turnos ainda nao');
  r = plano.notaViva(r.marca, 1000, 8);
  assert.strictEqual(r.avisar, true, '5 turnos sem nota');
  assert.deepStrictEqual(r.marca, { mtime: 1000, turnos: 8 }, 'avisou: a conta recomeca');
  assert.strictEqual(plano.notaViva(r.marca, 1000, 12).avisar, false);
  assert.deepStrictEqual(plano.notaViva({ mtime: 1000, turnos: 3 }, 2000, 20), { marca: { mtime: 2000, turnos: 20 }, avisar: false },
    'o plano mudou: recomeca');
  assert.strictEqual(plano.notaViva({ mtime: 1000, turnos: 'x' }, 1000, 20).avisar, false, 'marca torta recomeca');
  assert.deepStrictEqual(plano.notaViva({ mtime: 1000, turnos: 30 }, 1000, 2), { marca: { mtime: 1000, turnos: 2 }, avisar: false },
    'conta que voltou recomeca do numero de agora');
  const m = plano.motivoNotaViva('planos/p.md', 5);
  assert.ok(m.includes('planos/p.md') && m.includes('5'), m);
  assert.ok(/^[\x20-\x7E\n]+$/.test(m), 'fora de ASCII: ' + m);
});

test('item 14: o abrir-turno pede a nota viva depois de 5 turnos com trabalho sem o plano mudar', () => {
  const { spawnSync } = require('node:child_process');
  const estado = require('../scripts/lib/estado.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-nota-'));
  const sessoes = path.join(dir, 'sessoes');
  const antes = process.env.SWORN_TMP;
  function abrir() {
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'abrir-turno.js')], {
      cwd: dir, encoding: 'utf8',
      input: JSON.stringify({ session_id: 'n1', cwd: dir, hook_event_name: 'UserPromptSubmit', prompt: 'segue' }),
      env: Object.assign({}, process.env, { SWORN_TMP: sessoes })
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const s = r.stdout.trim() ? JSON.parse(r.stdout) : null;
    return s && s.hookSpecificOutput ? s.hookSpecificOutput.additionalContext : '';
  }
  try {
    process.env.SWORN_TMP = sessoes;
    fs.mkdirSync(path.join(dir, '.claude', 'sworn', 'escopos'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'p.md'), '1. [ ] passo\n');
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'escopos', 'f.md'), '**Objetivo:** fazer. Plano: p.md\n## Dentro\n- p.md\n');
    estado.gravar('n1', { frente: 'f', turnosComTrabalho: 1 });
    assert.ok(!/nota viva/.test(abrir()), '1a vez so marca');
    estado.alterar('n1', function (s) { s.turnosComTrabalho = 6; return s; });
    const aviso = abrir();
    assert.ok(/nota viva/.test(aviso) && aviso.includes('p.md'), aviso);
    estado.alterar('n1', function (s) { s.turnosComTrabalho = 12; return s; });
    fs.writeFileSync(path.join(dir, 'p.md'), '1. [x] passo (s1: feito)\n');
    fs.utimesSync(path.join(dir, 'p.md'), new Date(), new Date(Date.now() + 5000));
    assert.ok(!/nota viva/.test(abrir()), 'o plano mudou: sem aviso');
    assert.ok(estado.CAMPOS_DA_SESSAO.indexOf('notaViva') !== -1, 'o fecho carrega a marca');
    // sem vinculo, o plano da unica frente com plano e de outra sessao: nao conta
    estado.gravar('n1', { turnosComTrabalho: 1 });
    abrir();
    estado.alterar('n1', function (s) { s.turnosComTrabalho = 20; return s; });
    assert.ok(!/nota viva/.test(abrir()), 'plano de frente sem vinculo nao pede nota');
  } finally {
    if (antes === undefined) delete process.env.SWORN_TMP; else process.env.SWORN_TMP = antes;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
