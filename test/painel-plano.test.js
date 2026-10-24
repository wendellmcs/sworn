'use strict';
// Bloco M / M2 (D435): o painel do plano em texto - o que o comando /sworn-plan do mod responde
// (o chat da extensao do VS Code nao desenha mod). Mostra antes, a vista, o que o portao de fecho so
// barra no fim: etapa com passo aberto nao esta concluida.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const planoLib = require('../scripts/lib/plano.js');

// Plano 082 (mock D532, S5): o painel sai com acento (D532) e em Markdown; o que nao pode e caractere de controle.
const LIMPO = /^[^\x00-\x09\x0B-\x1F\x7F]*$/;
// Fora dos trechos de codigo nao sobra `<palavra`: o Markdown leria `<caminho do plano>` como tag e a apagaria.
function semTagSolta(t) { return !/<[a-z]/i.test(t.replace(/(`+)[\s\S]*?\1/g, '')); }
const PLANO = [
  '# Plano',
  '### Tarefa 1: Medidor',
  '- [x] teste vermelho',
  '- [x] codigo',
  '### Tarefa 2: Painel',
  '- [x] teste vermelho',
  '- [ ] codigo',
  '- [ ] revisao cega',
  '### Tarefa 3: Vigia',
  '- [ ] desenho'
].join('\n');

test('painelTexto: conta concluidas, marca cada tarefa e aponta a proxima com os passos que faltam', () => {
  const t = planoLib.painelTexto({ arquivo: 'p.md', sessionId: 's1' }, planoLib.parseItens(PLANO));
  assert.ok(LIMPO.test(t), JSON.stringify(t));
  assert.ok(t.indexOf('**Plano p — 1 de 3 tarefas**\n\nplano ativo (dono: s1) · p.md\n\n') === 0, t);
  assert.ok(t.indexOf('\n- [x] Tarefa 1: Medidor\n') !== -1, t);
  assert.ok(t.indexOf('\n- [ ] Tarefa 2: Painel (2 de 3 passos abertos)\n') !== -1, t);
  assert.ok(t.indexOf('**Ritmo**\n- próxima: Tarefa 2 — Painel (faltam 2 de 3 passos)\n') !== -1, t);
});

// Plano 082 (mock D532, S5): a cena do mock parte 3, inteira - titulo, linha fraca, lista e o bloco "Ritmo".
test('plano 082 S5: plano concluido sai igual a cena do mock', () => {
  const plano = ['### Tarefa 1: chave `referencias` (0.8.0)', '### Tarefa 2: pacote com referência (0.8.0)',
    '### Tarefa 3: veredito e apuração (0.8.0)', '### Tarefa 4: textos e fecho da 0.8.0',
    '### Tarefa 5: gatilho automático (0.8.1)', '### Tarefa 6: init e fecho da 0.8.1'].join('\n- [x] a\n') + '\n- [x] a';
  const arquivo = 'sworn/.context/plans/2026-10-13-sworn-pendencias-d503-plano.md';
  const t = planoLib.painelTexto({ arquivo: arquivo, frente: 'sworn-pendencias', sessoesDoPlano: 7 },
    planoLib.parseItens(plano));
  assert.strictEqual(t, [
    '**Plano d503 — concluído (6 de 6 tarefas)**',
    '',
    'frente sworn-pendencias · ' + arquivo,
    '',
    '- [x] Tarefa 1: chave `referencias` (0.8.0)',
    '- [x] Tarefa 2: pacote com referência (0.8.0)',
    '- [x] Tarefa 3: veredito e apuração (0.8.0)',
    '- [x] Tarefa 4: textos e fecho da 0.8.0',
    '- [x] Tarefa 5: gatilho automático (0.8.1)',
    '- [x] Tarefa 6: init e fecho da 0.8.1',
    '',
    '**Ritmo**',
    '- 7 sessões gastas · nada falta'
  ].join('\n'));
});

test('painelTexto: tudo feito diz concluido no titulo, sem linha de proxima', () => {
  const t = planoLib.painelTexto({ arquivo: 'p.md', sessionId: 's1' }, planoLib.parseItens('### Tarefa 1: A\n- [x] um'));
  assert.ok(t.indexOf('**Plano p — concluído (1 de 1 tarefa)**') === 0, t);
  assert.ok(t.indexOf('próxima') === -1, t);
  assert.ok(t.indexOf('**Ritmo**\n- nada falta · sessões gastas não contadas (o plano não tem marca de sessão)') !== -1, t);
});

test('painelTexto: tarefa sem nenhuma caixa de passo nao aparece como concluida (revisao cega do M, lib/plano B:115)', () => {
  const t = planoLib.painelTexto({ arquivo: 'p.md', sessionId: 's1' },
    planoLib.parseItens('### Tarefa 1: A\n- [x] um\n### Tarefa 2: Revisar\nsem caixas aqui'));
  assert.ok(LIMPO.test(t), JSON.stringify(t));
  assert.ok(t.indexOf('[x] Tarefa 2') === -1, t);
  assert.ok(t.indexOf('\n- [?] Tarefa 2: Revisar (sem caixas de passo nem [FEITO]: o painel não sabe se está feita)') !== -1, t);
  assert.ok(t.indexOf('**Plano p — 1 de 2 tarefas**') === 0, t);
  // D436: sem tarefa de passo aberto mas com [?], o painel nao diz que o plano acabou.
  assert.ok(t.indexOf('concluído') === -1 && t.indexOf('nenhuma tarefa aberta') === -1, t);
  assert.ok(t.indexOf('- próxima: nenhuma tarefa com passo aberto; 1 sem caixas de passo, confira à mão') !== -1, t);
});

test('painelTexto: sem plano ativo diz como abrir um', () => {
  const t = planoLib.painelTexto(null, []);
  assert.ok(/^Nenhum plano ativo/.test(t) && /--abrir/.test(t), t);
  assert.ok(semTagSolta(t), t);
});

test('painelTexto: plano sem cabecalho "Tarefa N:" diz que nao consegue contar, em vez de 0 de 0', () => {
  const t = planoLib.painelTexto({ arquivo: 'p.md', sessionId: 's1' }, []);
  assert.ok(/Tarefa N:/.test(t), t);
  assert.ok(t.indexOf('0 de 0') === -1, t);
});

test('plano.js --texto: le o plano ativo do projeto e imprime o painel', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-painel-'));
  try {
    fs.writeFileSync(path.join(base, 'plano.md'), PLANO);
    planoLib.abrir(base, 'plano.md', 's1');
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'plano.js'), '--texto'], { cwd: base, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.indexOf('**Plano plano — 1 de 3 tarefas**') === 0, r.stdout);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('plano.js --texto: sem plano ativo, saida 0 e o texto de como abrir', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-painel-'));
  try {
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'plano.js'), '--texto'], { cwd: base, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(/^Nenhum plano ativo/.test(r.stdout), r.stdout);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

const SCRIPT = path.join(__dirname, '..', 'scripts', 'plano.js');
function painelEm(conteudoDoAtivo, args) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-painel-'));
  try {
    fs.writeFileSync(path.join(base, 'plano.md'), PLANO);
    if (conteudoDoAtivo !== null) {
      fs.mkdirSync(path.join(base, '.claude', 'sworn'), { recursive: true });
      fs.writeFileSync(path.join(base, '.claude', 'sworn', 'plano-ativo.json'), conteudoDoAtivo);
    }
    return spawnSync(process.execPath, [SCRIPT].concat(args || ['--texto']), { cwd: base, encoding: 'utf8' });
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
}

// D442/3 (M-8/M-10/M-14 e o print do dono na s70): sem plano, o painel mandava rodar
// `node <pasta do plugin sworn>/scripts/plano.js` - o dono nao sabe que pasta e essa. O script sabe onde esta.
test('D442/3: sem plano ativo, o painel diz o caminho real do plano.js, entre aspas', () => {
  const r = painelEm(null);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.indexOf('<pasta do plugin') === -1, r.stdout);
  // Plano 082 (S5): o comando vai entre crases - copiavel, e o Markdown nao le <caminho do plano> como tag
  assert.ok(r.stdout.indexOf('`node "' + SCRIPT + '" --abrir <caminho do plano>`') !== -1, r.stdout);
  // caminho que nao e ASCII (R5) ou que o shell reinterpretaria: volta ao marcador, sem inventar
  assert.ok(/<pasta do plugin sworn>/.test(planoLib.painelTexto(null, [], 'C:/Usuários/zé/plano.js')));
  assert.ok(/<pasta do plugin sworn>/.test(planoLib.painelTexto(null, [], '/tmp/$x/plano.js')));
  assert.ok(/<pasta do plugin sworn>/.test(planoLib.painelTexto(null, [])));
});

// D442/10 (M-28): o --texto nao caia (conferido: saida 0 em 10 formas de arquivo torto), mas DIZIA "nenhum plano
// ativo" com o arquivo la: JSON quebrado, e ate um plano valido gravado com BOM (comum no Windows, D124).
test('D442/10: plano-ativo.json com BOM vale; JSON quebrado diz que existe mas nao se le', () => {
  const comBom = painelEm('\uFEFF' + JSON.stringify({ arquivo: 'plano.md', sessionId: 's1' }));
  assert.strictEqual(comBom.status, 0, comBom.stderr);
  assert.ok(comBom.stdout.indexOf('1 de 3 tarefas**') !== -1, comBom.stdout);
  for (const torto of ['{"arquivo": ', '[]', '"x"']) {
    const r = painelEm(torto);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(!/nenhum plano ativo/i.test(r.stdout), torto + ' -> ' + r.stdout);
    assert.ok(/^O arquivo \.claude\/sworn\/plano-ativo\.json existe, mas não se lê/.test(r.stdout), torto + ' -> ' + r.stdout);
    assert.ok(LIMPO.test(r.stdout) && semTagSolta(r.stdout), JSON.stringify(r.stdout));
  }
});

// D442/9 (M-23/M-24): o painel em texto ja nao contava tarefa sem caixa como feita (D436), mas a saida JSON
// do plano.js (sem --texto) contava: `concluidas = tarefas - abertas`.
test('D442/9: plano.js (JSON) nao conta tarefa sem caixa como concluida e diz quantas sao', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-painel-'));
  try {
    fs.writeFileSync(path.join(base, 'plano.md'), '### Tarefa 1: A\n- [x] um\n### Tarefa 2: B\nsem caixas\n');
    planoLib.abrir(base, 'plano.md', 's1');
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: base, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.strictEqual(j.tarefas, 2);
    assert.strictEqual(j.concluidas, 1, r.stdout);
    assert.strictEqual(j.semCaixas, 1, r.stdout);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// D476 (Tarefa 4 da 0.7.1): nada chamava `plano.js --abrir`, entao o /sworn-plan dizia "nenhum plano ativo"
// numa sessao que trabalhava num plano. Sem plano-ativo.json, o plano vem da frente vinculada: o ULTIMO
// "Plano: <caminho>" do Objetivo do arquivo da frente. Sem vinculo: uma frente com plano no disco -> ela.
function projetoComFrentes(opcoes) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-painel-frente-'));
  const tmp = path.join(base, '_tmp');
  fs.mkdirSync(path.join(base, '.claude', 'sworn', 'escopos'), { recursive: true });
  fs.writeFileSync(path.join(base, 'plano.md'), opcoes.plano != null ? opcoes.plano : PLANO);
  fs.writeFileSync(path.join(base, 'velho.md'), '### Tarefa 1: Velha\n- [ ] nada\n');
  // D502: o escopo.md da raiz (o escopo em vigor da sessao sem vinculo)
  if (opcoes.escopo != null) {
    fs.writeFileSync(path.join(base, '.claude', 'sworn', 'escopo.md'), '# Escopo\n**Objetivo:** ' + opcoes.escopo + '\n## Dentro\n- x/**\n');
  }
  for (const nome of Object.keys(opcoes.frentes || {})) {
    fs.writeFileSync(path.join(base, '.claude', 'sworn', 'escopos', nome + '.md'),
      '# Escopo\n**Objetivo:** ' + opcoes.frentes[nome] + '\n## Dentro\n- x/**\n');
  }
  if (opcoes.vinculo) {
    fs.mkdirSync(path.join(tmp, 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'sworn', 's-frente.json'), JSON.stringify({ frente: opcoes.vinculo }));
  }
  if (opcoes.ativo) planoLib.abrir(base, opcoes.ativo, 's1');
  const env = Object.assign({}, process.env, { SWORN_TMP: tmp });
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_SESSION_ID;
  try {
    return spawnSync(process.execPath, [SCRIPT, '--texto', '--sessao', 's-frente'], { cwd: base, encoding: 'utf8', env: env });
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
}

test('D476: sem plano-ativo.json, o painel acha o plano pelo ULTIMO "Plano:" do Objetivo da frente vinculada', () => {
  const r = projetoComFrentes({
    frentes: { f1: 'fazer X. Plano: velho.md. (sessao 1, hoje) agora a 2a parte. Plano: plano.md', f2: 'outra. Plano: velho.md' },
    vinculo: 'f1'
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!/nenhum plano ativo/i.test(r.stdout), r.stdout);
  assert.ok(r.stdout.indexOf('\n\nfrente f1 · plano.md\n\n') !== -1, r.stdout);
  assert.ok(r.stdout.indexOf('1 de 3 tarefas**') !== -1, r.stdout);
  // D502: a marca "(sessao 1" do Objetivo e da frente, nao do plano - o plano sem marca nao conta sessoes
  assert.ok(r.stdout.indexOf('- sessões gastas: não contadas') !== -1, r.stdout);
});

test('D502: as sessoes gastas vem das marcas do PLANO, nao das 40 do Objetivo da frente', () => {
  const marcas = [];
  for (let i = 1; i <= 40; i++) marcas.push('(sessao ' + i + ', hoje)');
  const r = projetoComFrentes({
    frentes: { f1: marcas.join(' ') + ' Plano: plano.md' }, vinculo: 'f1',
    plano: '### Tarefa 1: A\n- [x] um (s37: feito)\n- [x] dois (s37, depois)\n### Tarefa 2: B\n- [x] tres (s38: ok)\n' +
      '### Tarefa 3: C\n- [ ] quatro'
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.indexOf('- 2 sessões gastas · estimativa: 1 sessão para a 1 que falta (média de 1,0 sessão por ' +
    'tarefa feita = 2 sessões / 2 feitas)') !== -1, r.stdout);
});

const DO_ESCOPO = 'anotado no escopo desta sessão (.claude/sworn/escopo.md) · velho.md';

test('D502: sessao sem vinculo le o escopo.md da raiz antes das frentes', () => {
  const r = projetoComFrentes({ escopo: 'APP. Plano: velho.md', frentes: { so: 'outra frente. Plano: plano.md' } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(LIMPO.test(r.stdout), JSON.stringify(r.stdout));
  assert.ok(r.stdout.indexOf(DO_ESCOPO) !== -1, r.stdout);
  assert.ok(r.stdout.indexOf('frente so') === -1, r.stdout);
  // varias frentes com plano tambem nao passam na frente do escopo.md
  const v = projetoComFrentes({ escopo: 'APP. Plano: velho.md', frentes: { fa: 'A. Plano: plano.md', fb: 'B. Plano: plano.md' } });
  assert.ok(v.stdout.indexOf(DO_ESCOPO) !== -1, v.stdout);
});

test('D502: a forma que o escopo da raiz ja escreve, plano `caminho.md` (minusculo, sem dois-pontos), vale', () => {
  const r = projetoComFrentes({ escopo: 'ETAPA P2 (plano `velho.md` secao 7, linha P2)', frentes: { so: 'X. Plano: plano.md' } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.indexOf(DO_ESCOPO) !== -1, r.stdout);
});

test('R1 D502: escopo.md da raiz que nao se le e dito; Plano: dele que nao existe no disco nao cai noutra frente', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-painel-raiz-'));
  const env = Object.assign({}, process.env, { SWORN_TMP: path.join(base, '_tmp') });
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_SESSION_ID;
  try {
    fs.mkdirSync(path.join(base, '.claude', 'sworn', 'escopo.md'), { recursive: true });
    fs.mkdirSync(path.join(base, '.claude', 'sworn', 'escopos'), { recursive: true });
    fs.writeFileSync(path.join(base, 'plano.md'), PLANO);
    fs.writeFileSync(path.join(base, '.claude', 'sworn', 'escopos', 'so.md'), '**Objetivo:** X. Plano: plano.md\n');
    const r = spawnSync(process.execPath, [SCRIPT, '--texto', '--sessao', 'nada'], { cwd: base, encoding: 'utf8', env: env });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.indexOf('Não consegui ler o escopo .claude/sworn/escopo.md. Confira se ele é um arquivo') === 0, r.stdout);
    assert.ok(r.stdout.indexOf('frente so') === -1, r.stdout);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
  const p = projetoComFrentes({ escopo: 'APP. Plano: pendente.md', frentes: { so: 'X. Plano: plano.md' } });
  assert.ok(p.stdout.indexOf('Não consegui ler o plano pendente.md. Confira se o arquivo existe.') === 0, p.stdout);
  assert.ok(p.stdout.indexOf('frente so') === -1, p.stdout);
});

const SEM_VINCULO = 'frente so · plano.md · esta sessão não está ligada a ela; para ligar, edite .claude/sworn/escopos/so.md';

test('D502: sem plano no escopo.md, cai na frente unica e diz que a sessao nao esta ligada a ela', () => {
  const r = projetoComFrentes({ escopo: 'APP sem plano anotado', frentes: { so: 'X. Plano: plano.md' } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.indexOf('\n\n' + SEM_VINCULO + '\n\n') !== -1, r.stdout);
});

test('D502: plano minusculo so com crase ou aspas e .md; "Plano:" ganha quando os dois existem', () => {
  const p = planoLib.planosCitados;
  assert.deepStrictEqual(p('o plano 0.7.3 e o plano 074) e plano §3 e PLANO DA 0.5 e plano docs/x.md'), []);
  assert.deepStrictEqual(p('(plano `docs/meu plano.md` secao 7) e plano "b.md" e Plano \'c.md\''), ['docs/meu plano.md', 'b.md', 'c.md']);
  assert.deepStrictEqual(p('plano `notas.txt`'), []);
  const r = projetoComFrentes({ frentes: { f1: 'X. Plano: plano.md (s1) depois o plano `velho.md` citado' }, vinculo: 'f1' });
  assert.ok(r.stdout.indexOf('\n\nfrente f1 · plano.md\n\n') !== -1, r.stdout);
});

test('D476: sem vinculo e com UMA frente com plano no disco, o painel usa ela; ponto final do caminho nao entra', () => {
  const r = projetoComFrentes({ frentes: { so: 'fazer X. Plano: plano.md.', semplano: 'nada aqui' } });
  assert.strictEqual(r.status, 0, r.stderr);
  // D502: sem vinculo, o rotulo diz que a sessao nao e da frente
  assert.ok(r.stdout.indexOf('\n\n' + SEM_VINCULO + '\n\n') !== -1, r.stdout);
  assert.ok(r.stdout.indexOf('1 de 3 tarefas**') !== -1, r.stdout);
});

test('D476: sem vinculo e com VARIAS frentes com plano, o painel lista as frentes e diz como escolher', () => {
  const r = projetoComFrentes({ frentes: { fa: 'A. Plano: plano.md', fb: 'B. Plano: velho.md' } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(LIMPO.test(r.stdout) && semTagSolta(r.stdout), JSON.stringify(r.stdout));
  assert.ok(r.stdout.indexOf('tarefas') === -1, r.stdout);
  assert.ok(r.stdout.indexOf('\n- fa: plano.md\n- fb: velho.md\n') !== -1, r.stdout);
  assert.ok(r.stdout.indexOf('`.claude/sworn/escopos/<frente>.md`') !== -1 && /--abrir/.test(r.stdout), r.stdout);
});

test('D476: plano-ativo.json presente manda, mesmo com a sessao vinculada a uma frente com outro plano', () => {
  const r = projetoComFrentes({ frentes: { f1: 'X. Plano: velho.md' }, vinculo: 'f1', ativo: 'plano.md' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.indexOf('\n\nplano ativo (dono: s1) · plano.md\n\n') !== -1, r.stdout);
  assert.ok(r.stdout.indexOf('1 de 3 tarefas**') !== -1, r.stdout);
});

test('D476: frente vinculada sem "Plano:" no Objetivo diz isso, e nao pega o plano de outra frente', () => {
  const r = projetoComFrentes({ frentes: { f1: 'sem plano anotado', f2: 'X. Plano: plano.md' }, vinculo: 'f1' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.indexOf('tarefas') === -1, r.stdout);
  assert.ok(semTagSolta(r.stdout), r.stdout);
  assert.ok(r.stdout.indexOf('A frente f1 não declara plano no Objetivo (o parágrafo `**Objetivo:**` de ' +
    '.claude/sworn/escopos/f1.md). Anote no fim dele `Plano: <caminho>` (ou `` plano `<caminho>.md` ``, entre ' +
    'crases), ou abra um plano: `node ') === 0, r.stdout);
});

// D476: o painel le o formato real dos planos (o da 0.7 usa "### Item N —" sem caixas): cabecalho #{2,4} com
// Tarefa|Item|Etapa|Onda|Fase + numero (3a, 3b) + separador ":" "." "-" travessao. Sem caixas, [FEITO]/(feito)
// no cabecalho = feita; senao "sem marca" (o painel nao inventa). O portao de fecho segue no formato de hoje.
const PLANO_REAL = [
  '# Plano',
  '## Tarefa 1 \u2014 Publicar',
  '- [x] export',
  '### Item 2 \u2014 calibrador (sess\u00e3o 93) [FEITO]',
  'texto sem caixa',
  '### Item 3a \u2014 ligado por padr\u00e3o (feito)',
  '### Item 3b \u2014 sob chave',
  '### Etapa 4. Revis\u00e3o',
  '- [ ] lente 1',
  '- [x] lente 2',
  '#### Onda 5 - Fecho',
  '### Fase 6: Publicar',
  '- [ ] push'
].join('\n');

test('D476: parseItens le Tarefa/Item/Etapa/Onda/Fase, numero com letra e os 4 separadores', () => {
  const itens = planoLib.parseItens(PLANO_REAL);
  assert.deepStrictEqual(itens.map(function (t) { return t.tipo + ' ' + t.id; }),
    ['Tarefa 1', 'Item 2', 'Item 3a', 'Item 3b', 'Etapa 4', 'Onda 5', 'Fase 6']);
  assert.deepStrictEqual(itens.map(function (t) { return t.estado; }),
    ['feita', 'feita', 'feita', 'sem marca', 'aberta', 'sem marca', 'aberta']);
  // as caixas mandam: [FEITO] no cabecalho com passo aberto segue aberta
  assert.strictEqual(planoLib.parseItens('### Fase 7: X [FEITO]\n- [ ] y')[0].estado, 'aberta');
});

test('D476: o painel mostra o formato real, com [FEITO] sem caixa como feita e "sem marca" como [?]', () => {
  const t = planoLib.painelTexto({ arquivo: 'p.md', frente: 'f1' }, planoLib.parseItens(PLANO_REAL));
  assert.ok(LIMPO.test(t), JSON.stringify(t));
  // tipos misturados (Tarefa, Item, Etapa...): a unidade e "itens", como na faixa
  assert.ok(t.indexOf('**Plano p — 3 de 7 itens**') === 0, t);
  // Plano 082 (D532): o titulo sai com o acento do plano
  assert.ok(t.indexOf('\n- [x] Item 2: calibrador (sessão 93)\n') !== -1, t);
  assert.ok(t.indexOf('\n- [x] Item 3a: ligado por padrão\n') !== -1, t);
  assert.ok(t.indexOf('\n- [?] Item 3b: sob chave (sem caixas de passo nem [FEITO]') !== -1, t);
  assert.ok(t.indexOf('\n- [ ] Etapa 4: Revisão (1 de 2 passos abertos)\n') !== -1, t);
  assert.ok(t.indexOf('\n- próxima: Etapa 4 — Revisão (faltam 1 de 2 passos)\n') !== -1, t);
});

test('D476: o portao de fecho segue no formato de hoje - parseTarefas nao le "Item N" nem travessao', () => {
  assert.deepStrictEqual(planoLib.parseTarefas('### Item 1 \u2014 X\n- [ ] a\n## Tarefa 2 \u2014 Y\n- [ ] b'), []);
});

// D502 (era D476 item 3, no Objetivo da frente): sessoes gastas = marcas "(sN" / "(sessao N" DISTINTAS no plano;
// estimativa = (sessoes / feitas) x as que faltam, arredondada; sem tarefa feita nao ha base.
test('D502: sessoesDoPlano conta "(sN" e "(sessao N" distintas, com e sem acento, e so com numero', () => {
  assert.strictEqual(planoLib.sessoesDoPlano(
    'X (sessao 91, hoje: a) Y (sessão 92) (Sessao 93: b) sessao 94 sem parentese (sessao sem numero) (sessao 95'), 4);
  assert.strictEqual(planoLib.sessoesDoPlano('- [x] a (s37: um)\n- [x] b (s37, dois)\n- [x] c (S38)\n(s39x) (sim) (s 40)'), 2);
  // exemplo entre crases nao e marca
  assert.strictEqual(planoLib.sessoesDoPlano('(sessão 38, hoje) as marcas `(s37` e `(s38` e `(sessão 12,`'), 1);
  assert.strictEqual(planoLib.sessoesDoPlano(''), 0);
  assert.strictEqual(planoLib.sessoesDoPlano(null), 0);
});

test('D476: estimativaDeSessoes = media por tarefa feita x as que faltam, arredondada; sem feita = sem base', () => {
  assert.deepStrictEqual(planoLib.estimativaDeSessoes(10, 4, 2), { sessoes: 5, media: 2.5 });
  assert.deepStrictEqual(planoLib.estimativaDeSessoes(4, 3, 4), { sessoes: 5, media: 4 / 3 });
  assert.deepStrictEqual(planoLib.estimativaDeSessoes(5, 3, 1), { sessoes: 2, media: 5 / 3 });
  assert.deepStrictEqual(planoLib.estimativaDeSessoes(7, 3, 0), { sessoes: 0, media: 7 / 3 });
  assert.strictEqual(planoLib.estimativaDeSessoes(5, 0, 3), null);
});

// D476 (item 4): o painel diz o que falta, as sessoes gastas e a estimativa com a base. Plano 082 (S5): no bloco "Ritmo".
test('D476: painel com frente mostra falta, sessoes gastas e estimativa com a base', () => {
  const t = planoLib.painelTexto({ arquivo: 'p.md', frente: 'f1', sessoesDoPlano: 4 },
    planoLib.parseItens(PLANO_REAL));
  assert.ok(LIMPO.test(t), JSON.stringify(t));
  // a ordem do plano: proxima, falta, sessoes gastas com a estimativa, cada uma num item da lista
  assert.ok(t.indexOf('\n\n**Ritmo**\n- próxima: Etapa 4 — Revisão (faltam 1 de 2 passos)\n' +
    '- falta: 4 de 7 (Item 3b, Etapa 4, Onda 5, Fase 6)\n' +
    '- 4 sessões gastas · estimativa: 5 sessões para as 4 que faltam (média de 1,3 sessões por tarefa feita = ' +
    '4 sessões / 3 feitas)') !== -1, t);
  assert.ok(/\(média de 1,3 sessões por tarefa feita = 4 sessões \/ 3 feitas\)$/.test(t), t);
});

test('D502: plano sem marca de sessao (com ou sem frente) diz como anotar e nao estima', () => {
  const t = planoLib.painelTexto({ arquivo: 'p.md', sessionId: 's1' }, planoLib.parseItens(PLANO));
  assert.ok(LIMPO.test(t), JSON.stringify(t));
  assert.ok(t.indexOf('\n- falta: 2 de 3 (Tarefa 2, Tarefa 3)\n') !== -1, t);
  // Plano 083 (p3-15): a orientacao numa linha propria, com exemplo concreto no lugar do "(sN: o que fez)".
  assert.ok(t.indexOf('\n- sessões gastas: não contadas (o plano não tem marca de sessão)\n- para contar: ao marcar uma ' +
    'caixa, anote a sessão entre parênteses, por exemplo "(s3: ajustei o painel)" na 3ª sessão. Sem as marcas, não há ' +
    'base para estimar.') !== -1, t);
  assert.ok(t.indexOf('(sN') === -1, t);
  assert.ok(t.indexOf('estimativa') === -1, t);
  // D502: aberto por --abrir tambem conta, se o plano tem marca
  const a = planoLib.painelTexto({ arquivo: 'p.md', sessionId: 's1', sessoesDoPlano: 2 }, planoLib.parseItens(PLANO));
  assert.ok(a.indexOf('\n- 2 sessões gastas · estimativa: 4 sessões para as 2 que faltam') !== -1, a);
});

test('D502: plano.js --texto conta as marcas do plano tambem no plano aberto por --abrir', () => {
  const r = projetoComFrentes({ ativo: 'plano.md', plano: '### Tarefa 1: A\n- [x] a (s5: ok)\n### Tarefa 2: B\n- [ ] b' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.indexOf('\n\nplano ativo (dono: s1) · plano.md\n\n') !== -1, r.stdout);
  assert.ok(r.stdout.indexOf('\n- 1 sessão gasta · estimativa:') !== -1, r.stdout);
});

test('D476: frente sem tarefa feita nao estima; tudo feito diz que nada falta; 1 sessao no singular', () => {
  const sem = planoLib.painelTexto({ arquivo: 'p.md', frente: 'f1', sessoesDoPlano: 1 },
    planoLib.parseItens('### Item 1: A\n- [ ] a\n### Item 2: B'));
  assert.ok(sem.indexOf('\n- 1 sessão gasta · estimativa: sem base ainda (nenhuma tarefa feita)') !== -1, sem);
  const tudo = planoLib.painelTexto({ arquivo: 'p.md', frente: 'f1', sessoesDoPlano: 2 },
    planoLib.parseItens('### Item 1: A\n- [x] a'));
  assert.ok(/\*\*Ritmo\*\*\n- 2 sessões gastas · nada falta$/.test(tudo), tudo);
  assert.ok(tudo.indexOf('falta:') === -1 && tudo.indexOf('estimativa') === -1, tudo);
  const um = planoLib.painelTexto({ arquivo: 'p.md', frente: 'f1', sessoesDoPlano: 2 },
    planoLib.parseItens('### Item 1: A\n- [x] a\n### Item 2: B [FEITO]\n### Item 3: C\n- [ ] c'));
  assert.ok(um.indexOf('\n- 2 sessões gastas · estimativa: 1 sessão para a 1 que falta (média de 1,0 sessão por ' +
    'tarefa feita = 2 sessões / 2 feitas)') !== -1, um);
});

// R1 da revisao cega D469 de scripts/lib/plano.js (sessao 101).
test('R1: caminho do plano entre crases ou aspas pode ter espaco; sem elas, vale ate o primeiro espaco', () => {
  assert.strictEqual(planoLib.planoDoObjetivo('X. Plano: `docs/meu plano.md`. (sessao 1, hoje)'), 'docs/meu plano.md');
  assert.strictEqual(planoLib.planoDoObjetivo('X. Plano: "docs/meu plano.md"'), 'docs/meu plano.md');
  assert.strictEqual(planoLib.planoDoObjetivo('Plano: a.md. depois Plano: `b c.md`'), 'b c.md');
  assert.strictEqual(planoLib.planoDoObjetivo('Plano: `b c.md` e depois Plano: d.md.'), 'd.md');
});

test('R1: cabecalho que so agrupa (sem caixa nem [FEITO], com cabecalhos mais fundos abaixo) nao vira tarefa', () => {
  const itens = planoLib.parseItens('## Fase 1: Grupo\n### Tarefa 1: A\n- [x] a\n### Tarefa 2: B\n- [ ] b\n' +
    '## Fase 2: Com passo proprio\n- [ ] c\n### Tarefa 3: C\n- [x] c');
  assert.deepStrictEqual(itens.map(function (t) { return t.tipo + ' ' + t.id; }), ['Tarefa 1', 'Tarefa 2', 'Fase 2', 'Tarefa 3']);
  // mesmo nivel, sem caixas: segue "sem marca" (o painel nao inventa)
  assert.deepStrictEqual(planoLib.parseItens('### Item 1: X\n### Item 2: Y').map(function (t) { return t.estado; }),
    ['sem marca', 'sem marca']);
  // [FEITO] no agrupador o mantem como item
  assert.strictEqual(planoLib.parseItens('## Fase 1: G [FEITO]\n### Tarefa 1: A\n- [x] a').length, 2);
});

test('R1: plano sem marca de sessao e com tarefa feita nao estima 0 sessoes', () => {
  assert.strictEqual(planoLib.estimativaDeSessoes(0, 2, 3), null);
  const t = planoLib.painelTexto({ arquivo: 'p.md', frente: 'f1', sessoesDoPlano: 0 },
    planoLib.parseItens('### Item 1: A\n- [x] a\n### Item 2: B\n- [ ] b'));
  assert.ok(t.indexOf('- sessões gastas: não contadas') !== -1, t);
  assert.ok(t.indexOf('Sem as marcas, não há base para estimar.') !== -1 && t.indexOf('0 sess') === -1, t);
});

test('R1: arquivo da frente vinculada que nao se le nao vira "nao tem Plano:"', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-painel-ilegivel-'));
  try {
    const tmp = path.join(base, '_tmp');
    fs.mkdirSync(path.join(base, '.claude', 'sworn', 'escopos', 'f1.md'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'sworn', 's-frente.json'), JSON.stringify({ frente: 'f1' }));
    const env = Object.assign({}, process.env, { SWORN_TMP: tmp });
    delete env.CLAUDE_CODE_SESSION_ID;
    delete env.CLAUDE_SESSION_ID;
    const r = spawnSync(process.execPath, [SCRIPT, '--texto', '--sessao', 's-frente'], { cwd: base, encoding: 'utf8', env: env });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.indexOf('não declara plano') === -1, r.stdout);
    assert.ok(/^Não consegui ler o arquivo da frente f1 \(\.claude\/sworn\/escopos\/f1\.md\)\. Confira se ele é um arquivo e se abre, e rode \/sworn-plan de novo\.\n$/.test(r.stdout), r.stdout);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('R1: varias frentes - o painel diz o que e frente e como ligar a sessao a uma delas', () => {
  const t = planoLib.painelVariasFrentes([{ frente: 'fa', arquivo: 'a.md' }, { frente: 'fb', arquivo: 'b.md' }], null);
  assert.ok(LIMPO.test(t) && semTagSolta(t), JSON.stringify(t));
  assert.ok(t.indexOf('Nenhum plano ativo, e esta sessão não está ligada a nenhuma frente (frente = linha de trabalho com ' +
    'arquivo próprio em .claude/sworn/escopos/). Frentes com plano:\n\n- fa: a.md\n- fb: b.md\n\n') === 0, t);
  assert.ok(t.indexOf('Para escolher, edite o arquivo da frente que você quer, `.claude/sworn/escopos/<frente>.md` ' +
    '(qualquer edição liga esta sessão a ela), e rode /sworn-plan de novo. Ou abra um plano: `node ') !== -1, t);
});

// R2 da revisao cega D469 de scripts/lib/plano.js (sessao 101).
test('R2: "Plano:" com markdown, aspas simples, aspa sem fechar, valor vazio e quebra de linha', () => {
  assert.strictEqual(planoLib.planoDoObjetivo('**Plano:** docs/x.md'), 'docs/x.md');
  assert.strictEqual(planoLib.planoDoObjetivo('Plano: **docs/x.md**'), 'docs/x.md');
  assert.strictEqual(planoLib.planoDoObjetivo("Plano: 'docs/meu plano.md'"), 'docs/meu plano.md');
  assert.strictEqual(planoLib.planoDoObjetivo('Plano: docs/x.md"'), 'docs/x.md');
  assert.strictEqual(planoLib.planoDoObjetivo('Plano:\nOutra coisa'), null);
  assert.strictEqual(planoLib.planoDoObjetivo('Plano: "docs/meu plano.md'), null);
  assert.strictEqual(planoLib.planoDoObjetivo('Plano: ""'), null);
  // valor que nao e caminho nao apaga o anterior
  assert.strictEqual(planoLib.planoDoObjetivo('Plano: a.md. depois Plano: ...'), 'a.md');
  assert.strictEqual(planoLib.planoDoObjetivo('Plano: a.md e Plano: "b c.md'), 'a.md');
});

test('R2: com varios "Plano:", vale o ultimo que existe no disco; nenhum existe -> o ultimo, e o painel da a dica', () => {
  const r = projetoComFrentes({ frentes: { f1: 'X. Plano: plano.md. depois Plano: pendente' }, vinculo: 'f1' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.indexOf('\n\nfrente f1 · plano.md\n\n') !== -1, r.stdout);
  const s = projetoComFrentes({ frentes: { f1: 'X. Plano: docs/meu plano.md' }, vinculo: 'f1' });
  assert.strictEqual(s.status, 0, s.stderr);
  assert.strictEqual(s.stdout, 'Não consegui ler o plano docs/meu. Confira se o arquivo existe; se o caminho tem ' +
    'espaço, ponha-o entre crases no Objetivo: `` Plano: `meu plano.md` ``.\n');
});

test('R2: estimativa com trabalho pela frente nunca sai 0 sessoes', () => {
  assert.deepStrictEqual(planoLib.estimativaDeSessoes(1, 3, 1), { sessoes: 1, media: 1 / 3 });
  assert.deepStrictEqual(planoLib.estimativaDeSessoes(7, 3, 0), { sessoes: 0, media: 7 / 3 });
});

test('R2: sem vinculo, frente cujo arquivo nao se le aparece na lista (e sozinha diz que nao se le)', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-painel-ilegivel2-'));
  const env = Object.assign({}, process.env, { SWORN_TMP: path.join(base, '_tmp') });
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_SESSION_ID;
  try {
    const escopos = path.join(base, '.claude', 'sworn', 'escopos');
    fs.mkdirSync(path.join(escopos, 'fa.md'), { recursive: true });
    const so = spawnSync(process.execPath, [SCRIPT, '--texto', '--sessao', 'nada'], { cwd: base, encoding: 'utf8', env: env });
    assert.ok(/^Não consegui ler o arquivo da frente fa/.test(so.stdout), so.stdout);
    fs.writeFileSync(path.join(escopos, 'fb.md'), '**Objetivo:** X. Plano: plano.md\n');
    const duas = spawnSync(process.execPath, [SCRIPT, '--texto', '--sessao', 'nada'], { cwd: base, encoding: 'utf8', env: env });
    assert.ok(duas.stdout.indexOf('\n- fa: (o arquivo da frente não se lê)\n- fb: plano.md\n') !== -1, duas.stdout);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('D476: plano.js --texto usa o leitor novo (plano no formato real, achado pela frente)', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-painel-real-'));
  try {
    fs.mkdirSync(path.join(base, '.claude', 'sworn', 'escopos'), { recursive: true });
    fs.writeFileSync(path.join(base, 'real.md'), PLANO_REAL);
    fs.writeFileSync(path.join(base, '.claude', 'sworn', 'escopos', 'so.md'), '**Objetivo:** X. Plano: real.md\n');
    const env = Object.assign({}, process.env, { SWORN_TMP: path.join(base, '_tmp') });
    delete env.CLAUDE_CODE_SESSION_ID;
    const r = spawnSync(process.execPath, [SCRIPT, '--texto', '--sessao', 'nada'], { cwd: base, encoding: 'utf8', env: env });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.indexOf('**Plano real — 3 de 7 itens**') === 0, r.stdout);
    // D532: o acento do plano chega inteiro na saida do script (o mod le em UTF-8)
    assert.ok(r.stdout.indexOf('- [x] Item 2: calibrador (sessão 93)') !== -1, r.stdout);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// D506/D507/D509 (Tarefa 6 da 0.7.8): o plano do APP lista as etapas numa tabela (secao 7, P0-P7), sem caixa nem
// [FEITO]; o estado vive no Objetivo do escopo ("ETAPA P2"). Forma copiada do plano real (so as colunas e os ids),
// com as outras tabelas dele, que nao sao de etapas (1a celula "#" e "Arquivo", esta com uma coluna "Etapa").
const PLANO_TABELA = [
  '# Plano do app -- parte 2',
  '## 4. Fatos que decidem o desenho',
  '| # | Fato | Fonte |',
  '|---|---|---|',
  '| F1 | 16 abas no registro | `x.js:1` [V] |',
  '## 7. Etapas (~11-12 sessoes [I]) -- ordem nova',
  '',
  '| Etapa | O que | Onde mexe | Aceite | Release/deploy |',
  '|---|---|---|---|---|',
  '| **P0 provas** (~2) | N1-N7, N9-N12 (secao 6; N8 saiu) | copia + prototipo descartavel | aceite do P0 (6) | nenhum |',
  '| **P1 extensão: preparo** (~1,75) | superficie `app` | `workspace.js` | contrato | release da extensao |',
  '| **P2 motor do app** (~2) | protocolo, 2 janelas | `app-desktop/main.js` | N1-N7 de novo | nenhum |',
  '| **P3 app: telas + ponte** (~2) | servidor da ponte | `app-desktop/src/*` | estados | nenhum |',
  '| **P4 release do app** (~0,5) | 1.1.0 | `package.json` | 1.0.1 -> 1.1.0 | **release do app** |',
  '',
  '## 8. Contagem por arquivo',
  '| Arquivo | Pontos | Etapa |',
  '|---|---|---|',
  '| `extension/background.js` | guarda | P1 |'
].join('\n');
const OBJETIVO_APP = 'APP PARTE 2 -- ETAPA P3 "APP: TELAS + PONTE" (plano `plano.md` secao 7, linha P3)';

test('D509: parseItens le a tabela de etapas (1a celula Etapa/Item/Tarefa/Onda/Fase), id sem **, e so ela', () => {
  const itens = planoLib.parseItens(PLANO_TABELA);
  assert.deepStrictEqual(itens.map(function (t) { return t.tipo + ' ' + t.id; }),
    ['Etapa P0', 'Etapa P1', 'Etapa P2', 'Etapa P3', 'Etapa P4']);
  assert.deepStrictEqual(itens.map(function (t) { return t.titulo; }),
    ['provas (~2)', 'extensão: preparo (~1,75)', 'motor do app (~2)', 'app: telas + ponte (~2)', 'release do app (~0,5)']);
  assert.deepStrictEqual(itens.map(function (t) { return t.estado; }), ['sem marca', 'sem marca', 'sem marca', 'sem marca', 'sem marca']);
  // os outros nomes da 1a celula, no plural, id so numero, e o titulo da 2a celula quando a 1a so tem o id
  assert.deepStrictEqual(planoLib.parseItens('| Fases | O que |\n|---|---|\n| 1 | preparo |\n| 2a - fecho | x |')
    .map(function (t) { return t.tipo + ' ' + t.id + ': ' + t.titulo; }), ['Fase 1: preparo', 'Fase 2a: fecho']);
  for (const nome of ['Item', 'Tarefa', 'Onda', '**Etapa**']) {
    assert.strictEqual(planoLib.parseItens('| ' + nome + ' | X |\n|---|---|\n| D1 | a |').length, 1, nome);
  }
  // linha de tabela sem id na 1a celula nao vira etapa; tabela sem a linha |---| nao e tabela
  assert.strictEqual(planoLib.parseItens('| Etapa | X |\n|---|---|\n| Preparo | a |').length, 0);
  assert.strictEqual(planoLib.parseItens('| Etapa | X |\n|---|---|\n| 3dias de prova | a |').length, 0);
  assert.strictEqual(planoLib.parseItens('| Etapa | X |\n| P0 | a |').length, 0);
  // ids reais: "2b-0" (decisor-local) e "I0.0" (superplano) inteiros
  assert.deepStrictEqual(planoLib.parseItens('| Fase | X |\n|---|---|\n| 2b-0 | Laya |\n| **I0.0** caracterizacao | a |')
    .map(function (t) { return t.id + ': ' + t.titulo; }), ['2b-0: Laya', 'I0.0: caracterizacao']);
});

test('D509: so a 1a tabela de etapas com id vale, id repetido nao conta, e plano com caixas ignora tabela', () => {
  // o plano do APP parte 1: a tabela "| Item | Onde |" (pedidos 51-63) depois das etapas nao e etapa
  const duas = PLANO_TABELA + '\n\n| Item | Onde |\n|---|---|\n| 51 (par identico) | 4.3 |\n| 54 (abas) | todo |';
  assert.deepStrictEqual(planoLib.parseItens(duas).map(function (t) { return t.id; }), ['P0', 'P1', 'P2', 'P3', 'P4']);
  // a 1a tabela sem linha de id (plano de evolucao: "| Item |" com "Modelo") nao toma o lugar da de etapas
  const semId = '| Item | O que |\n|---|---|\n| Modelo | jina |\n\n| Fase | X |\n|---|---|\n| **0 — Enxergar** | a |';
  assert.deepStrictEqual(planoLib.parseItens(semId).map(function (t) { return t.tipo + ' ' + t.id + ': ' + t.titulo; }),
    ['Fase 0: Enxergar']);
  // id repetido (tabela de resultado do superplano: I0 em 4 linhas) conta uma vez
  assert.strictEqual(planoLib.parseItens('| Tarefa | R |\n|---|---|\n| I0 a | x |\n| I0 b | y |\n| D0 | z |').length, 2);
  // plano de caixas com tabela-resumo das tarefas: as caixas mandam, a tabela nao duplica
  const resumo = '### Tarefa 1: A\n- [x] um\n### Tarefa 2: B\n- [ ] dois\n\n| Tarefa | Arquivos |\n|---|---|\n| 1 | a.js |\n| 2 | b.js |';
  assert.deepStrictEqual(planoLib.parseItens(resumo).map(function (t) { return t.id + '=' + t.estado; }), ['1=feita', '2=aberta']);
});

test('D509: [FEITO] na celula da etapa = feita; noutra celula nao conta; as caixas seguem no cabecalho de cima', () => {
  const plano = PLANO_TABELA.replace('**P0 provas** (~2)', '**P0 provas** (~2) [FEITO]')
    .replace('| contrato |', '| contrato [FEITO] |');
  const itens = planoLib.parseItens(plano);
  assert.strictEqual(itens[0].estado, 'feita');
  assert.strictEqual(itens[0].titulo, 'provas (~2)');
  assert.strictEqual(itens[1].estado, 'sem marca');
  // caixa depois da tabela e do cabecalho de tarefa acima, nao da ultima linha da tabela (e, com caixa, a tabela sai)
  const misto = planoLib.parseItens('### Tarefa 1: A\n| Etapa | X |\n|---|---|\n| E1 | a |\n- [ ] passo');
  assert.deepStrictEqual(misto.map(function (t) { return t.id + '=' + t.estado; }), ['1=aberta']);
});

test('D509: sem marca na tabela, deduz pela "ETAPA <id>" do Objetivo (anteriores feitas, ela em curso) e avisa', () => {
  const itens = planoLib.deduzirPeloEscopo(planoLib.parseItens(PLANO_TABELA), OBJETIVO_APP);
  assert.deepStrictEqual(itens.map(function (t) { return t.estado; }), ['feita', 'feita', 'feita', 'em curso', 'a fazer']);
  const t = planoLib.painelTexto({ arquivo: 'plano.md', escopo: '.claude/sworn/escopo.md' }, itens);
  assert.ok(LIMPO.test(t), JSON.stringify(t));
  assert.ok(t.indexOf('**Plano plano — 3 de 5 etapas**') === 0, t);
  assert.ok(t.indexOf('\n\nEstado pelo escopo: a tabela não tem [FEITO], então o painel segue o Objetivo do escopo (o ' +
    'parágrafo "Objetivo:"), que diz ETAPA P3. As etapas antes dela contam como feitas, e ela como em curso. Para não ' +
    'depender disso, ponha [FEITO] na 1ª célula de cada etapa feita.\n\n**Ritmo**\n') !== -1, t);
  assert.ok(t.indexOf('\n- [x] Etapa P1: extensão: preparo (~1,75)\n') !== -1, t);
  assert.ok(t.indexOf('\n- [>] Etapa P3: app: telas + ponte (~2) (em curso, pelo escopo)\n') !== -1, t);
  assert.ok(t.indexOf('\n- [ ] Etapa P4: release do app (~0,5)\n') !== -1, t);
  assert.ok(t.indexOf('[?]') === -1, t);
  assert.ok(t.indexOf('\n- próxima: Etapa P3 — app: telas + ponte (~2) (em curso, pelo escopo)\n') !== -1, t);
  assert.ok(t.indexOf('\n- falta: 2 de 5 (Etapa P3, Etapa P4)\n') !== -1, t);
  // caixa baixa vale; vale a ULTIMA etapa citada que existe na tabela
  const baixa = planoLib.deduzirPeloEscopo(planoLib.parseItens(PLANO_TABELA), 'etapa P1 feita (s1). agora etapa p2; ETAPA P9');
  assert.deepStrictEqual(baixa.map(function (x) { return x.estado; }), ['feita', 'feita', 'em curso', 'a fazer', 'a fazer']);
});

test('D509: com marca na tabela a marca manda; sem "ETAPA <id>" que exista na tabela, fica "sem marca" como hoje', () => {
  const marcado = planoLib.parseItens(PLANO_TABELA.replace('**P0 provas** (~2)', '**P0 provas** (~2) [FEITO]'));
  assert.deepStrictEqual(planoLib.deduzirPeloEscopo(marcado, OBJETIVO_APP).map(function (t) { return t.estado; }),
    ['feita', 'sem marca', 'sem marca', 'sem marca', 'sem marca']);
  for (const objetivo of ['APP sem etapa', 'ETAPA P9', 'etapa 3', '', null]) {
    const itens = planoLib.deduzirPeloEscopo(planoLib.parseItens(PLANO_TABELA), objetivo);
    assert.ok(itens.every(function (t) { return t.estado === 'sem marca'; }), String(objetivo));
    assert.ok(planoLib.painelTexto({ arquivo: 'p.md' }, itens).indexOf('pelo escopo') === -1, String(objetivo));
  }
  // so a tabela se deduz: cabecalho de lista com caixas fica com as caixas
  const lista = planoLib.deduzirPeloEscopo(planoLib.parseItens('### Etapa 1: A\n- [ ] x\n### Etapa 2: B\n- [ ] y'), 'ETAPA 2');
  assert.deepStrictEqual(lista.map(function (t) { return t.estado; }), ['aberta', 'aberta']);
  // o painel sem itens fala tambem da tabela
  assert.ok(/tabela/.test(planoLib.painelTexto({ arquivo: 'p.md' }, [])));
});

test('D509: plano.js --texto mostra a tabela do plano do escopo com a deducao; plano aberto por --abrir nao deduz', () => {
  const r = projetoComFrentes({ escopo: OBJETIVO_APP, plano: PLANO_TABELA });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(LIMPO.test(r.stdout), JSON.stringify(r.stdout));
  assert.ok(r.stdout.indexOf('\n\nanotado no escopo desta sessão (.claude/sworn/escopo.md) · plano.md\n\n') !== -1, r.stdout);
  assert.ok(r.stdout.indexOf('3 de 5 etapas**') !== -1, r.stdout);
  assert.ok(r.stdout.indexOf('- [>] Etapa P3') !== -1, r.stdout);
  const aberto = projetoComFrentes({ escopo: OBJETIVO_APP, plano: PLANO_TABELA, ativo: 'plano.md' });
  assert.ok(aberto.stdout.indexOf('0 de 5 etapas**') !== -1, aberto.stdout);
  assert.ok(aberto.stdout.indexOf('pelo escopo') === -1, aberto.stdout);
});

// D512 (Tarefa 7 da 0.7.8): os P2 de comportamento da revisao cega (lista em p2-078-s41.md, numero entre parenteses).
test('P2 #5: sessoesDoPlano em texto ("1") conta como numero, e o singular sai certo', () => {
  const t = planoLib.painelTexto({ arquivo: 'p.md', frente: 'f1', sessoesDoPlano: '1' },
    planoLib.parseItens('### Item 1: A\n- [x] a\n### Item 2: B\n- [ ] b'));
  assert.ok(t.indexOf('\n- 1 sessão gasta · ') !== -1, t);
  assert.ok(t.indexOf('= 1 sessão / 1 feita)') !== -1, t);
  for (const torto of ['abc', '1.5', -2, null]) {
    const x = planoLib.painelTexto({ arquivo: 'p.md', frente: 'f1', sessoesDoPlano: torto }, planoLib.parseItens('### Item 1: A\n- [x] a'));
    assert.ok(x.indexOf('sessões gastas não contadas') !== -1, String(torto) + ' -> ' + x);
  }
});

test('P2 #6: plano do Objetivo fora da pasta do projeto nao e lido, e o painel diz por que', () => {
  assert.strictEqual(planoLib.dentroDoProjeto('/p', 'docs/x.md'), true);
  assert.strictEqual(planoLib.dentroDoProjeto('/p', 'a/../x.md'), true);
  assert.strictEqual(planoLib.dentroDoProjeto('/p', '../x.md'), false);
  assert.strictEqual(planoLib.dentroDoProjeto('/p', 'a/../../x.md'), false);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-painel-fora-'));
  const proj = path.join(base, 'proj');
  const env = Object.assign({}, process.env, { SWORN_TMP: path.join(base, '_tmp') });
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_SESSION_ID;
  try {
    fs.mkdirSync(path.join(proj, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(base, 'fora.md'), PLANO);
    fs.writeFileSync(path.join(proj, '.claude', 'sworn', 'escopo.md'), '**Objetivo:** X. Plano: ../fora.md\n');
    const r = spawnSync(process.execPath, [SCRIPT, '--texto', '--sessao', 'nada'], { cwd: proj, encoding: 'utf8', env: env });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(LIMPO.test(r.stdout) && semTagSolta(r.stdout), JSON.stringify(r.stdout));
    assert.ok(r.stdout.indexOf('tarefas') === -1, r.stdout);
    assert.ok(r.stdout.indexOf('O plano ../fora.md fica fora da pasta do projeto, e o painel só lê plano anotado no ' +
      'Objetivo dentro dela. Anote um caminho relativo à pasta do projeto, ou abra o plano: `node ') === 0, r.stdout);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// Plano legivel cujo parse lanca: o `-r` troca a funcao da lib antes do plano.js rodar (o require e o mesmo objeto).
function painelQueLanca(funcao) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-painel-lanca-'));
  const env = Object.assign({}, process.env, { SWORN_TMP: path.join(base, '_tmp') });
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_SESSION_ID;
  try {
    fs.mkdirSync(path.join(base, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(base, 'plano.md'), PLANO);
    fs.writeFileSync(path.join(base, '.claude', 'sworn', 'escopo.md'), '**Objetivo:** X. Plano: plano.md\n');
    const pre = path.join(base, 'lanca.js');
    fs.writeFileSync(pre, 'require(' + JSON.stringify(path.join(__dirname, '..', 'scripts', 'lib', 'plano.js')) + ').' +
      funcao + ' = function () { throw new Error("quebrou"); };\n');
    return spawnSync(process.execPath, ['-r', pre, SCRIPT, '--texto', '--sessao', 'nada'], { cwd: base, encoding: 'utf8', env: env });
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
}

test('P2 #8 e #15: erro ao montar o painel de um plano lido nao vira "nao consegui ler"', () => {
  for (const funcao of ['sessoesDoPlano', 'parseItens', 'deduzirPeloEscopo']) {
    const r = painelQueLanca(funcao);
    assert.strictEqual(r.status, 0, funcao + ': ' + r.stderr);
    assert.ok(r.stdout.indexOf('consegui ler') === -1, funcao + ' -> ' + r.stdout);
    // R1 da s43: a mensagem diz o que fazer agora. p7-11 (mock D532, S5): e o que copiar e onde colar.
    assert.strictEqual(r.stdout, 'Li o plano plano.md, mas o painel falhou ao contar as tarefas. Veja as tarefas direto ' +
      'no arquivo do plano. Para avisar o defeito, copie a mensagem entre parênteses (`quebrou`) e cole no chat com o ' +
      'pedido "registrar defeito do sworn".\n', funcao);
  }
});

test('p7-11: a mensagem do erro vai num trecho de codigo que aguenta crase e quebra de linha', () => {
  const t = planoLib.painelQueFalhou('p.md', new Error('x `y`\nz'));
  assert.ok(t.indexOf('(`` x `y` z ``)') !== -1, t);
  assert.ok(planoLib.painelQueFalhou('p.md', 'texto solto').indexOf('(`texto solto`)') !== -1);
});

test('P2 #9: "(s1, s2: ...)" conta as duas sessoes; numero sem "s" na lista nao e sessao', () => {
  assert.strictEqual(planoLib.sessoesDoPlano('(s1, s2: refeito) (s3 e s4) (s5, dois) (sessao 6, sessao 7) (s8, s9x)'), 8);
  assert.strictEqual(planoLib.sessoesDoPlano('(sessao 3, 2026-10-13 22:41: x) (s3/s4)'), 1);
  assert.strictEqual(planoLib.sessoesDoPlano('exemplo `(s1, s2: x)` nao conta'), 0);
});

test('P2 #12: Plano: que nao existe no disco perde para o plano citado que existe', () => {
  const r = projetoComFrentes({ frentes: { f1: 'X. Plano: sumiu.md e depois o plano `plano.md` citado' }, vinculo: 'f1' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.indexOf('\n\nfrente f1 · plano.md\n\n') !== -1, r.stdout);
});

test('P2 #16: linha da tabela de etapas sem id fica fora da conta, e o painel avisa', () => {
  const itens = planoLib.parseItens('| Etapa | X |\n|---|---|\n| P0 | a |\n| Alfa | b |\n| P1 | c |');
  assert.deepStrictEqual(itens.map(function (t) { return t.id; }), ['P0', 'P1']);
  assert.deepStrictEqual(itens.semId, [{ linha: 4, texto: 'Alfa' }]);
  const t = planoLib.painelTexto({ arquivo: 'p.md' }, planoLib.deduzirPeloEscopo(itens, 'ETAPA P1'));
  assert.ok(LIMPO.test(t), JSON.stringify(t));
  assert.ok(t.indexOf('\n\nAviso: 1 linha da tabela de etapas sem id no começo da 1ª célula ficou fora da conta ' +
    '(linha 4: "Alfa"); para contar, comece a 1ª célula pelo id (P0, 2a, 2b-0).\n\n') !== -1, t);
  // tabela que nao conta (sem nenhuma linha de id, ou plano com caixas) nao avisa
  const semId = '| Item | O que |\n|---|---|\n| Modelo | jina |\n\n| Fase | X |\n|---|---|\n| **0 — Enxergar** | a |';
  assert.strictEqual(planoLib.parseItens(semId).semId, undefined);
  assert.strictEqual(planoLib.parseItens('### Tarefa 1: A\n- [ ] a\n| Etapa | X |\n|---|---|\n| P0 | a |\n| Alfa | b |').semId, undefined);
  assert.ok(planoLib.painelTexto({ arquivo: 'p.md' }, planoLib.parseItens(PLANO_TABELA)).indexOf('Aviso:') === -1);
});

test('P2 #17: etapa sem titulo aparece com "(sem título)", nao com a linha cortada', () => {
  const t = planoLib.painelTexto({ arquivo: 'p.md' }, planoLib.parseItens('| Etapa | O que |\n|---|---|\n| P0 | |'));
  assert.ok(t.indexOf('\n- [?] Etapa P0: (sem título) (sem [FEITO] na célula da etapa: o painel não sabe se está feita)\n') !== -1, t);
});

test('P2 #18: tipo da tabela no plural vira singular ("Etapas P0" -> "Etapa P0")', () => {
  assert.strictEqual(planoLib.parseItens('| Etapas | X |\n|---|---|\n| P0 | a |')[0].tipo, 'Etapa');
  assert.strictEqual(planoLib.parseItens('| **ONDAS** | X |\n|---|---|\n| 1 | a |')[0].tipo, 'ONDA');
});

test('P2 #19: cabecalho sem caixa logo antes da tabela de etapas nao some como agrupador', () => {
  const itens = planoLib.parseItens('### Etapa 1: Preparar\n| Etapa | X |\n|---|---|\n| P0 | a |\n| P1 | b |');
  assert.deepStrictEqual(itens.map(function (t) { return t.tipo + ' ' + t.id + '=' + t.estado; }),
    ['Etapa 1=sem marca', 'Etapa P0=sem marca', 'Etapa P1=sem marca']);
  // o agrupador de cabecalhos mais fundos segue saindo (R1)
  assert.deepStrictEqual(planoLib.parseItens('## Fase 1: G\n### Tarefa 1: A\n- [x] a').map(function (t) { return t.id; }), ['1']);
});

test('P2 #20 e #21: item do painel sem "n" (id e a chave) e deducao sem etapaDoEscopo repetido em toda linha', () => {
  const itens = planoLib.parseItens(PLANO_REAL).concat(planoLib.parseItens('| Etapa | X |\n|---|---|\n| P1 | a |\n| E1 | b |'));
  assert.strictEqual(itens.length, 9);
  assert.ok(itens.every(function (t) { return !('n' in t); }), JSON.stringify(itens));
  const ded = planoLib.deduzirPeloEscopo(planoLib.parseItens(PLANO_TABELA), OBJETIVO_APP);
  assert.ok(ded.every(function (t) { return !('etapaDoEscopo' in t); }), JSON.stringify(ded));
  assert.ok(planoLib.painelTexto({ arquivo: 'p.md' }, ded).indexOf('ETAPA P3') !== -1);
});

test('D513 #1: barra vertical escapada na celula nao corta o titulo da etapa', () => {
  const itens = planoLib.parseItens('| Etapa | O que |\n|---|---|\n| P0 | usa `a\\|b` no filtro |\n| P1 x\\|y | b |');
  assert.deepStrictEqual(itens.map(function (t) { return t.id + ': ' + t.titulo; }), ['P0: usa `a|b` no filtro', 'P1: x|y']);
});

test('D513 #2: plano com BOM nao perde o cabecalho da 1a linha', () => {
  assert.deepStrictEqual(planoLib.parseItens('\uFEFF### Tarefa 1: A\n- [ ] a').map(function (t) { return t.id + ' ' + t.estado; }),
    ['1 aberta']);
});

// Plano 082 (D532): o acento passa (era ASCII pela R5, D513 #16); caractere de controle segue barrado.
test('D513 #16: painel de plano-ativo.json com acento no caminho e no dono sai com o acento, sem caractere de controle', () => {
  const t = planoLib.painelTexto({ arquivo: 'docs/planó.md', sessionId: 'sessão' }, planoLib.parseItens('### Tarefa 1: A\n- [ ] a'));
  assert.ok(t.indexOf('\n\nplano ativo (dono: sessão) · docs/planó.md\n\n') !== -1, t);
  const c = planoLib.painelTexto({ arquivo: 'p\u001b[31m.md', sessionId: 's\u0007' },
    planoLib.parseItens('### Tarefa 1: A\u001bB\n- [ ] a'));
  assert.ok(LIMPO.test(c), JSON.stringify(c));
  assert.ok(c.indexOf('plano ativo (dono: s?) · p?[31m.md') !== -1 && c.indexOf('Tarefa 1: A?B') !== -1, c);
});

test('D513 #12 e #21: os avisos do painel dizem o que mudar no plano', () => {
  const t = planoLib.painelTexto({ arquivo: 'p.md' }, planoLib.parseItens('| Etapa | X |\n|---|---|\n| P0 | a |\n| Alfa | b |'));
  assert.ok(t.indexOf('ficou fora da conta (linha 4: "Alfa"); para contar, comece a 1ª célula pelo id (P0, 2a, 2b-0).') !== -1, t);
  const vazio = planoLib.painelTexto({ arquivo: 'p.md' }, []);
  assert.ok(LIMPO.test(vazio), JSON.stringify(vazio));
  assert.strictEqual(vazio, '**Plano p**\n\nplano ativo (dono: sem-sessao) · p.md\n\nO plano não tem cabeçalhos ' +
    '`### Tarefa N: título` (nem Item/Etapa/Onda/Fase N) nem tabela de etapas (1ª coluna "Etapa"): o painel não ' +
    'consegue contar as tarefas. Para contar, escreva as tarefas num desses formatos.');
});

test('R2 da s44: tabela colada na de etapas, sem linha em branco, e outra tabela (nao soma etapas nem vira "sem id")', () => {
  const colada = '| Etapa | Estado |\n|---|---|\n| P0 | x |\n| Item | Onde |\n|---|---|\n| 51 | y |';
  const itens = planoLib.parseItens(colada);
  assert.deepStrictEqual(itens.map(function (t) { return t.tipo + ' ' + t.id; }), ['Etapa P0']);
  assert.strictEqual(itens.semId, undefined);
  const outra = planoLib.parseItens('| Etapa | Estado |\n|---|---|\n| P0 | x |\n| Risco | Dono |\n|---|---|\n| Alfa | y |\n| P1 | z |');
  assert.deepStrictEqual(outra.map(function (t) { return t.id; }), ['P0']);
  assert.strictEqual(outra.semId, undefined);
  // Linha sem "|" antes do |---| nao abre tabela.
  assert.deepStrictEqual(planoLib.parseItens('Etapa\n|---|---|\n| P0 | x |'), []);
});

test('D514 #1: linha vazia da tabela de etapas (espacador) nao vira "sem id" nem fecha a tabela', () => {
  const itens = planoLib.parseItens('| Etapa | X |\n|---|---|\n| P0 | a |\n| | |\n|  |\n|\n| P1 | b |');
  assert.deepStrictEqual(itens.map(function (t) { return t.id; }), ['P0', 'P1']);
  assert.strictEqual(itens.semId, undefined);
  assert.ok(planoLib.painelTexto({ arquivo: 'p.md' }, itens).indexOf('Aviso:') === -1);
  // linha com texto e sem id segue avisada (a linha vazia antes dela nao conta)
  assert.deepStrictEqual(planoLib.parseItens('| Etapa | X |\n|---|---|\n| | |\n| Alfa | b |\n| P0 | a |').semId,
    [{ linha: 4, texto: 'Alfa' }]);
});

test('R1 da s45: tabela-resumo dos cabecalhos sem caixa nao conta cada item duas vezes (vale o cabecalho)', () => {
  const plano = '### Item 1 — x [FEITO]\n### Item 2 — y\n\n| Item | Onde |\n|---|---|\n| 1 | a |\n| 2 [FEITO] | b |\n| 3 | c |';
  const itens = planoLib.parseItens(plano);
  assert.deepStrictEqual(itens.map(function (t) { return t.id + (t.tabela ? ' (tabela)' : '') + '=' + t.estado; }),
    ['1=feita', '2=sem marca', '3 (tabela)=sem marca']);
  assert.ok(planoLib.painelTexto({ arquivo: 'p.md' }, itens).indexOf('**Plano p — 1 de 3 itens**') === 0);
  // o cabecalho guarda o id em minusculas, a tabela como esta escrito: "### Etapa 2A" e "| 2a |" numa tabela
  // "| ETAPAS |" sao o mesmo (o cabecalho so aceita id de numero, RE_ITEM; "### Etapa P1" nao e cabecalho)
  assert.deepStrictEqual(planoLib.parseItens('### Etapa 2A: x\n| ETAPAS | X |\n|---|---|\n| 2a | a |\n| 3 | b |')
    .map(function (t) { return t.id; }), ['2a', '3']);
  // tipo diferente nao e resumo: "Etapa 1" e "Fase 1" seguem os dois
  assert.strictEqual(planoLib.parseItens('### Etapa 1: Mapear\n| Fase | X |\n|---|---|\n| 1 | a |').length, 2);
});
