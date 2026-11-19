'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ambiente = require('../scripts/lib/ambiente.js');
const instrucoes = require('../scripts/lib/instrucoes.js');
const rubrica = require('../scripts/lib/rubrica.js');

function montar(arquivos) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-amb-'));
  for (const [rel, txt] of Object.entries(arquivos)) {
    const alvo = path.join(dir, rel);
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, txt, 'utf8');
  }
  return dir;
}

test('ambiente: projeto cru nao detecta nada, e nao estoura', () => {
  const dir = montar({ 'a.js': '' });
  try {
    const r = ambiente.detectar(dir);
    assert.deepStrictEqual(r.skills, []);
    assert.deepStrictEqual(r.plugins, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ambiente: acha skills, agentes e hooks ja configurados no projeto', () => {
  const dir = montar({
    '.claude/skills/padrao-aaa/SKILL.md': '---\nname: padrao-aaa\n---\ntexto',
    '.claude/agents/arquiteto.md': '---\nname: arquiteto\n---',
    '.claude/settings.json': JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'x' }] }] } })
  });
  try {
    const r = ambiente.detectar(dir);
    assert.ok(r.skills.includes('padrao-aaa'));
    assert.ok(r.agentes.includes('arquiteto'));
    assert.ok(r.hooks.includes('SessionStart'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ambiente: plugin instalado vira candidato a DELEGACAO, nao a duplicacao', () => {
  const dir = montar({
    '.claude/settings.json': JSON.stringify({ enabledPlugins: { 'superpowers@x': true, 'context7@y': true } })
  });
  try {
    const r = ambiente.detectar(dir);
    assert.ok(r.plugins.some((p) => p.indexOf('superpowers') === 0));
    assert.ok(r.delegaveis.length > 0, 'superpowers e context7 sao delegaveis conhecidos');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ambiente: settings.json corrompido nao derruba a deteccao', () => {
  const dir = montar({ '.claude/settings.json': '{ isso nao e json' });
  try {
    assert.deepStrictEqual(ambiente.detectar(dir).hooks, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ambiente: settings.json, settings.local.json e .mcp.json com BOM sao lidos (A4-01)', () => {
  // O Out-File do PowerShell 5.1 e o Bloco de Notas antigo gravam o BOM; sem tira-lo o JSON.parse falhava e o
  // ambiente saia vazio, calado - o init duplicava o que o projeto ja tinha.
  const BOM = '\uFEFF';
  const dir = montar({
    '.claude/settings.json': BOM + JSON.stringify({ enabledPlugins: { 'superpowers@x': true }, hooks: { PreToolUse: [] } }),
    '.claude/settings.local.json': BOM + JSON.stringify({ hooks: { Stop: [] } }),
    '.mcp.json': BOM + JSON.stringify({ mcpServers: { servidor: {} } })
  });
  try {
    const r = ambiente.detectar(dir);
    assert.deepStrictEqual(r.plugins, ['superpowers@x']);
    assert.deepStrictEqual(r.hooks.slice().sort(), ['PreToolUse', 'Stop']);
    assert.deepStrictEqual(r.mcp, ['servidor']);
    assert.ok(r.delegaveis.some((d) => d.indexOf('superpowers') === 0), JSON.stringify(r.delegaveis));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('instrucoes: conta item de lista e item numerado nas fontes canonicas', () => {
  const dir = montar({
    'CLAUDE.md': '# t\n\n- regra um\n- regra dois\n1. regra tres\n\nparagrafo solto nao conta.\n',
    '.claude/sworn/regras.md': '- ao editar -> rodar git status\n'
  });
  try {
    const r = instrucoes.contar(dir, { fontesCanonicas: ['CLAUDE.md'] });
    assert.strictEqual(r.total, 4);
    assert.ok(r.metodo.length > 0, 'o metodo tem de sair junto: numero sem metodo nao e medida');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('instrucoes: marca estouro quando cruza o teto', () => {
  const linhas = [];
  for (let i = 0; i < 250; i++) linhas.push('- regra ' + i);
  const dir = montar({ 'CLAUDE.md': linhas.join('\n') });
  try {
    const r = instrucoes.contar(dir, { fontesCanonicas: ['CLAUDE.md'] });
    assert.strictEqual(r.estourou, true);
    assert.ok(r.total >= 250);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('instrucoes: diz QUAL arquivo pesa mais, nao so o total', () => {
  const dir = montar({
    'CLAUDE.md': '- a\n- b\n- c\n',
    'AGENTS.md': '- d\n'
  });
  try {
    const r = instrucoes.contar(dir, { fontesCanonicas: ['CLAUDE.md', 'AGENTS.md'] });
    assert.strictEqual(r.porArquivo[0].arquivo, 'CLAUDE.md');
    assert.strictEqual(r.porArquivo[0].n, 3);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// D732 (fila D687): o registro de decisoes declarado canonico pesava como instrucao (907 dos 934 itens do sworn). A
// fonte canonica em `fontesDeConsulta` segue mandando, mas sai do total e aparece em `foraDoPeso`, com a contagem; o
// metodo diz. Sem a chave, nada muda; o que nao e fonte canonica (regras.md, skill) nao sai por ela.
test('D732: fonte canonica em fontesDeConsulta sai do peso e aparece em foraDoPeso; o metodo diz', () => {
  const dir = montar({
    'CLAUDE.md': '- a\n- b\n- c\n',
    'docs/decisoes.md': '- d1\n- d2\n- d3\n- d4\n- d5\n',
    '.claude/sworn/regras.md': '- r\n'
  });
  try {
    const fontes = ['CLAUDE.md', 'docs/decisoes.md'];
    const sem = instrucoes.contar(dir, { fontesCanonicas: fontes });
    assert.deepStrictEqual([sem.total, sem.foraDoPeso], [9, []]);
    const com = instrucoes.contar(dir, { fontesCanonicas: fontes, fontesDeConsulta: ['./docs/decisoes.md'] });
    assert.strictEqual(com.total, 4);
    assert.deepStrictEqual(com.porArquivo.map((p) => p.arquivo), ['CLAUDE.md', '.claude/sworn/regras.md']);
    assert.deepStrictEqual(com.foraDoPeso, [{ arquivo: 'docs/decisoes.md', n: 5 }]);
    assert.ok(com.metodo.startsWith(sem.metodo + '; fora as fontes de consulta'), com.metodo);
    const regras = instrucoes.contar(dir, { fontesCanonicas: fontes, fontesDeConsulta: ['.claude/sworn/regras.md'] });
    assert.deepStrictEqual([regras.total, regras.foraDoPeso], [9, []]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A6-79: a fonte de consulta ausente, sem item ou que nao se le nao entra em foraDoPeso (a que falhou sai em
// naoLidos); o texto vazio (o cwd, uma pasta) tambem fica fora. A que tem item segue la, com o metodo dizendo.
test('A6-79: so a fonte de consulta com item entra em foraDoPeso', () => {
  const dir = montar({
    'CLAUDE.md': '- a\n- b\n',
    'docs/decisoes.md': '- d1\n- d2\n',
    'docs/prosa.md': 'so prosa, sem item de lista\n',
    'docs/pasta/leia.md': '- x\n'
  });
  try {
    const fontes = ['CLAUDE.md', 'docs/decisoes.md', 'docs/prosa.md', 'docs/sumiu.md', 'docs/pasta', ''];
    const r = instrucoes.contar(dir, { fontesCanonicas: fontes,
      fontesDeConsulta: ['', '  ', 'docs/decisoes.md', 'docs/prosa.md', 'docs/sumiu.md', 'docs/pasta'] });
    assert.deepStrictEqual(r.foraDoPeso, [{ arquivo: 'docs/decisoes.md', n: 2 }]);
    assert.strictEqual(r.total, 2);
    // a pasta e o texto vazio (o cwd) nao se leem: saem com a causa
    assert.deepStrictEqual(r.naoLidos.map((l) => l.split(' (')[0]), ['docs/pasta', '']);
    assert.match(r.metodo, /; fora as fontes de consulta/, r.metodo);
    // so as que nao pesam: foraDoPeso vazio e o metodo sem a frase
    const nada = instrucoes.contar(dir, { fontesCanonicas: ['CLAUDE.md', 'docs/prosa.md', 'docs/sumiu.md'],
      fontesDeConsulta: ['docs/prosa.md', 'docs/sumiu.md'] });
    assert.deepStrictEqual([nada.total, nada.foraDoPeso], [2, []]);
    assert.ok(!nada.metodo.includes('fora as fontes de consulta'), nada.metodo);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Ronda 1 do 8c.5: `LIMITES.tetoDeInstrucoes || 200` engolia o zero - o defeito que a
// varredura.js ja corrigiu (`limite || LIMITE_PADRAO`). Zero e teto de verdade.
test('instrucoes: teto e aviso em zero valem zero; so o ausente cai no padrao', () => {
  const antes = { teto: ambiente.LIMITES.tetoDeInstrucoes, avisar: ambiente.LIMITES.avisarA };
  const dir = montar({ 'CLAUDE.md': '- uma regra\n' });
  try {
    ambiente.LIMITES.tetoDeInstrucoes = 0;
    ambiente.LIMITES.avisarA = 0;
    let r = instrucoes.contar(dir, { fontesCanonicas: ['CLAUDE.md'] });
    assert.strictEqual(r.teto, 0, 'teto zero virou ' + r.teto);
    assert.strictEqual(r.avisarA, 0, 'aviso zero virou ' + r.avisarA);
    assert.strictEqual(r.estourou, true, 'uma instrucao estoura um teto de zero');
    delete ambiente.LIMITES.tetoDeInstrucoes;
    delete ambiente.LIMITES.avisarA;
    r = instrucoes.contar(dir, { fontesCanonicas: ['CLAUDE.md'] });
    assert.deepStrictEqual([r.teto, r.avisarA], [200, 150], 'sem o campo, vale o padrao');
  } finally {
    ambiente.LIMITES.tetoDeInstrucoes = antes.teto;
    ambiente.LIMITES.avisarA = antes.avisar;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rubrica: descricao que nao diz QUANDO usar e recusada (criterio 3)', () => {
  const ruim = '---\nname: x\ndescription: Faz revisao de codigo.\n---\ntexto';
  const bom = '---\nname: x\ndescription: Use quando for revisar codigo antes de dar por pronto.\n---\n## O que NAO promete\n- nada\n';
  assert.strictEqual(rubrica.conferir(ruim).ok, false);
  assert.strictEqual(rubrica.conferir(bom).ok, true, JSON.stringify(rubrica.conferir(bom).erros));
});

test('rubrica: skill sem secao do que NAO promete e recusada (criterio 6)', () => {
  const r = rubrica.conferir('---\nname: x\ndescription: Use quando precisar de x.\n---\n# t\n## Regras\n- a -> b\n');
  assert.strictEqual(r.ok, false);
  assert.ok(r.erros.some((e) => e.toLowerCase().includes('promete')));
});

// Pedido 12, R1 da A3 (s187): os moldes sao em ingles desde a D656, e a rubrica so lia portugues. O gerar-skill.js
// recusava a skill do proprio molde (criterios 3 e 6), e a auditoria marcava toda skill em ingles.
test('rubrica: o molde da skill de projeto passa nos criterios 3 e 6', () => {
  const molde = fs.readFileSync(path.join(__dirname, '..', 'modelos', 'skill-projeto.md'), 'utf8');
  const r = rubrica.conferir(molde);
  assert.deepStrictEqual(r.erros.filter((e) => /criterio [36]/.test(e)), [], JSON.stringify(r.erros));
});

test('rubrica: description e secao do que nao promete em ingles valem como em portugues', () => {
  const bom = '---\nname: x\ndescription: Use when the change is written.\n---\n## What this skill does NOT do\n- nothing\n';
  assert.deepStrictEqual(rubrica.conferir(bom).erros, []);
  assert.deepStrictEqual(rubrica.conferir(bom.replace(/\n/g, '\r\n')).erros, [], 'com CRLF, do checkout no Windows');
  const semQuando = '---\nname: x\ndescription: Reviews code.\n---\n## What this skill does NOT promise\n- nothing\n';
  assert.ok(rubrica.conferir(semQuando).erros.some((e) => e.startsWith('criterio 3:')));
});

// A description vazia nao pega a linha seguinte (o \s* atravessava a quebra); a em bloco do YAML vale inteira.
test('rubrica: description vazia, indentada e em bloco do YAML', () => {
  const T = '\n---\n## O que NAO promete\n- nada\n';
  const erros = (fm) => rubrica.conferir('---\nname: x\n' + fm + T).erros.map((e) => e.split('.')[0]);
  const SEM = 'criterio 3: falta a linha description no cabecalho da skill ' +
    '(o frontmatter, entre as duas linhas --- do topo)';
  assert.deepStrictEqual(erros('description:\nlicense: y'), [SEM]);
  assert.deepStrictEqual(erros('description:\nnota: use quando der'), [SEM]);
  assert.deepStrictEqual(erros('description:\n  Use quando a tarefa pedir'), []);
  assert.deepStrictEqual(erros('description: >-\n  Use quando a tarefa\n  pedir'), []);
});

// "## O que nao faz parte" nao e a secao do criterio 6: o titulo termina no que a skill nao promete, garante ou faz.
test('rubrica: titulo que so contem "nao faz" no meio nao vale como a secao do criterio 6', () => {
  const r = rubrica.conferir('---\nname: x\ndescription: Use quando x.\n---\n## O que nao faz parte do escopo\n- y\n');
  assert.ok(r.erros.some((e) => e.startsWith('criterio 6:')), JSON.stringify(r.erros));
});

test('rubrica: proibicao solta em lista de regras e recusada (criterio 1)', () => {
  const texto = '---\nname: x\ndescription: Use quando x.\n---\n## Regras\n- nunca faca hardening\n## O que NAO promete\n- nada\n';
  const r = rubrica.conferir(texto);
  assert.strictEqual(r.ok, false);
  assert.ok(r.erros.some((e) => e.includes('gatilho')));
});

// Pedido 12, P2 da A3 (D721): a description so vale no frontmatter (A3-15, A3-19); "use noite" nao e "use no" (A3-20).
test('rubrica: description fora do frontmatter nao vale, e o QUANDO e palavra inteira', () => {
  const T = '\n## O que NAO promete\n- nada\n';
  const c3 = (texto) => rubrica.conferir(texto).erros.filter((e) => e.startsWith('criterio 3:')).length;
  assert.strictEqual(c3('---\nname: x\n---\n# t\n```\ndescription: Use quando x\n```' + T), 1, 'description so no corpo');
  assert.strictEqual(c3('# t\ndescription: Use quando x' + T), 1, 'sem frontmatter');
  assert.strictEqual(c3('\uFEFF---\nname: x\ndescription: Use quando x\n---' + T), 0, 'com BOM');
  assert.strictEqual(c3('---\r\nname: x\r\ndescription: Use quando x\r\n---' + T), 0, 'com CRLF');
  assert.strictEqual(c3('---\nname: x\ndescription: Use noite adentro.\n---' + T), 1, '"use noite"');
  assert.strictEqual(c3('---\nname: x\ndescription: Use no inicio da tarefa.\n---' + T), 0, '"use no"');
});

// A3-21, A3-22: a secao do criterio 6 e "o que/what ... nao promete/garante/faz", com outro verbo ou um parentese depois.
const criterio6 = (titulo) => rubrica.conferir('---\nname: x\ndescription: Use quando x.\n---\n' + titulo + '\n- y\n').erros
  .filter((e) => e.startsWith('criterio 6:')).length;
test('rubrica: o titulo do criterio 6 pede "o que/what" e aceita verbo composto ou parentese no fim', () => {
  assert.strictEqual(criterio6('## What this skill does NOT do (yet)'), 0);
  assert.strictEqual(criterio6('## O que nao promete nem garante'), 0);
  assert.strictEqual(criterio6('## What it does not promise, guarantee or do'), 0);
  assert.strictEqual(criterio6('## Isto nao faz'), 1, 'sem "o que"');
  assert.strictEqual(criterio6('## O que nao faz parte do escopo (ainda)'), 1, 'complemento que nao e verbo');
});

// A3-39: o criterio 1 le tambem a proibicao solta em ingles (os moldes sao em ingles desde a D656).
test('rubrica: proibicao solta em ingles tambem e recusada (criterio 1)', () => {
  const c1 = (item) => rubrica.conferir('---\nname: x\ndescription: Use when x.\n---\n## Rules\n- ' + item +
    '\n## What this skill does NOT do\n- y\n').erros.filter((e) => e.startsWith('criterio 1,')).length;
  // A3-41: o apostrofo tipografico (o que o editor poe sozinho) e o "must not" tambem.
  for (const item of ['never do hardening', 'Always run the suite', 'Do not edit the lockfile', "don't push",
    'Forbidden: force push',
    'don\u2019t push', 'Must not edit the lockfile']) {
    assert.strictEqual(c1(item), 1, item);
  }
  assert.strictEqual(c1('never twice -> stop and ask'), 0, 'com gatilho');
  assert.strictEqual(c1('Nevertheless it helps'), 0, 'palavra inteira');
});

// A3-16, A3-17, A3-18: cada erro dos criterios 3 e 6 diz o que escrever, e o exemplo que ele da passa na rubrica.
test('rubrica: os erros dos criterios 3 e 6 dizem o que escrever', () => {
  const T6 = '## O que NAO promete\n- nada\n';
  const semDescricao = rubrica.conferir('---\nname: x\n---\n' + T6).erros[0];
  assert.match(semDescricao, /^criterio 3: falta a linha description no cabecalho .*---.*"description: Use quando/);
  const semQuando = rubrica.conferir('---\nname: x\ndescription: Faz x.\n---\n' + T6).erros[0];
  const formulas = semQuando.match(/"Use [^"]+"/g) || [];
  assert.ok(formulas.length >= 2 && formulas.some((f) => /when/.test(f)), semQuando);
  for (const f of formulas) assert.ok(rubrica.RE_QUANDO.test(f.replace(/\.\.\./, 'x')), f);
  const sem6 = rubrica.conferir('---\nname: x\ndescription: Use quando x.\n---\n# t\n').erros[0];
  const titulos = sem6.match(/"## [^"]+"/g) || [];
  assert.strictEqual(titulos.length, 2, sem6);
  for (const t of titulos) assert.strictEqual(criterio6(t.slice(1, -1)), 0, t);
});

// A3-40: o "criterio N" vem glosado (o numero da rubrica em modelos/boa-skill.md), o frontmatter tambem, e o texto
// corrido nao grita (QUANDO, NAO); os titulos de exemplo seguem como o molde.
test('rubrica: os erros dos criterios 3 e 6 dizem de onde vem o numero e o que e o frontmatter', () => {
  const T6 = '## O que NAO promete\n- nada\n';
  const [semDescricao, semQuando, sem6] = [
    rubrica.conferir('---\nname: x\n---\n' + T6).erros[0],
    rubrica.conferir('---\nname: x\ndescription: Faz x.\n---\n' + T6).erros[0],
    rubrica.conferir('---\nname: x\ndescription: Use quando x.\n---\n# t\n').erros[0],
  ];
  for (const e of [semDescricao, semQuando, sem6]) {
    assert.match(e, /rubrica de modelos\/boa-skill\.md/, e);
    assert.doesNotMatch(e, /QUANDO/, e);
  }
  assert.match(semDescricao, /cabecalho da skill \(o frontmatter, entre as duas linhas --- do topo\)/, semDescricao);
  assert.match(semQuando, /^criterio 3: a linha description do cabecalho diz .*, e nao quando usar\./, semQuando);
  assert.match(sem6, /^criterio 6: falta a secao do que a skill nao promete\./, sem6);
});

// T11-3 (R-T24-02): no init o projeto.json ainda nao existe, e o peso de instrucao ignorava
// justamente o CLAUDE.md. Os candidatos da varredura entram como 3o parametro.
test('instrucoes: sem fontes declaradas, os candidatos entram e o retorno diz que sao candidatas', () => {
  const dir = montar({ 'CLAUDE.md': '- a\n- b\n- c\n' });
  try {
    const r = instrucoes.contar(dir, {}, ['CLAUDE.md']);
    assert.strictEqual(r.total, 3);
    assert.strictEqual(r.fontes, 'candidatas');
    assert.deepStrictEqual(r.porArquivo.map((p) => p.arquivo), ['CLAUDE.md']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('instrucoes: fontesCanonicas declaradas mandam, mesmo vazias, e os candidatos ficam de fora', () => {
  const dir = montar({ 'CLAUDE.md': '- a\n- b\n', 'AGENTS.md': '- c\n' });
  try {
    const vazio = instrucoes.contar(dir, { fontesCanonicas: [] }, ['CLAUDE.md']);
    assert.strictEqual(vazio.total, 0, 'o dono declarou lista vazia: candidato nao entra');
    assert.strictEqual(vazio.fontes, 'declaradas');
    const outro = instrucoes.contar(dir, { fontesCanonicas: ['AGENTS.md'] }, ['CLAUDE.md', 'AGENTS.md']);
    assert.strictEqual(outro.total, 1, 'so o declarado conta');
    assert.strictEqual(outro.fontes, 'declaradas');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('instrucoes: com 2 argumentos segue como antes e diz nenhuma/declaradas; candidatos que nao e lista nao lanca', () => {
  const dir = montar({ 'CLAUDE.md': '- a\n' });
  try {
    const sem = instrucoes.contar(dir, {});
    assert.strictEqual(sem.total, 0);
    assert.strictEqual(sem.fontes, 'nenhuma');
    assert.strictEqual(instrucoes.contar(dir, { fontesCanonicas: ['CLAUDE.md'] }).fontes, 'declaradas');
    for (const ruim of ['CLAUDE.md', 7, { a: 1 }, null]) {
      const r = instrucoes.contar(dir, null, ruim);
      assert.strictEqual(r.total, 0, 'candidato nao-lista nao conta: ' + JSON.stringify(ruim));
      assert.strictEqual(r.fontes, 'nenhuma');
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// D396 n. 11: arquivo citado duas vezes contava em dobro.
test('instrucoes: o mesmo arquivo citado duas vezes conta uma vez so', () => {
  const dir = montar({
    'CLAUDE.md': '- a\n- b\n',
    '.claude/sworn/regras.md': '- c\n',
    '.claude/skills/x/SKILL.md': '- d\n'
  });
  try {
    const r = instrucoes.contar(dir, { fontesCanonicas: ['CLAUDE.md', './CLAUDE.md', '.claude/sworn/regras.md',
      '.claude/skills/x/SKILL.md'] });
    assert.strictEqual(r.total, 4, 'contou em dobro: ' + JSON.stringify(r.porArquivo));
    assert.deepStrictEqual(r.porArquivo.map((p) => p.arquivo).sort(),
      ['.claude/skills/x/SKILL.md', '.claude/sworn/regras.md', 'CLAUDE.md']);
    // onde o disco ignora caixa `claude.md` e o mesmo arquivo; onde nao ignora, ele nao existe e conta 0
    assert.strictEqual(instrucoes.contar(dir, { fontesCanonicas: ['CLAUDE.md', 'claude.md'] }).total, 4);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// sessao 27: a chave saia do path.resolve e a leitura do path.join - fonte em caminho absoluto contava 0
// e ainda apagava a 2a citacao do mesmo arquivo.
test('instrucoes: fonte em caminho absoluto conta, e uma vez so ao lado da relativa', () => {
  const dir = montar({ 'CLAUDE.md': '- a\n- b\n' });
  try {
    const abs = path.join(dir, 'CLAUDE.md');
    assert.strictEqual(instrucoes.contar(dir, { fontesCanonicas: [abs] }).total, 2);
    assert.strictEqual(instrucoes.contar(dir, { fontesCanonicas: [abs, 'CLAUDE.md'] }).total, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// D396 n. 16: candidata nao se passa por canonica no metodo.
test('instrucoes: o metodo diz se as fontes sao canonicas, candidatas ou nenhuma', () => {
  const dir = montar({ 'CLAUDE.md': '- a\n' });
  try {
    const declaradas = instrucoes.contar(dir, { fontesCanonicas: ['CLAUDE.md'] }).metodo;
    const candidatas = instrucoes.contar(dir, {}, ['CLAUDE.md']).metodo;
    const nenhuma = instrucoes.contar(dir, {}).metodo;
    assert.ok(/fontes canonicas/.test(declaradas), declaradas);
    assert.ok(/fontes candidatas/.test(candidatas) && !/fontes canonicas,/.test(candidatas), candidatas);
    assert.ok(/nenhuma fonte/.test(nenhuma) && !/nas fontes/.test(nenhuma), nenhuma);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A4-amb-1 (pedido 12, borda): enabledPlugins com `false` (desligado, ou desligado no settings.local.json por cima do
// settings.json) contava como plugin presente - e virava delegavel no init e na auditoria.
test('A4-amb-1: plugin com enabledPlugins false nao conta, e o local desliga o do settings', () => {
  const dir = montar({
    '.claude/settings.json': JSON.stringify({ enabledPlugins: { 'superpowers@x': true, 'context7@y': true, 'outro@z': false } }),
    '.claude/settings.local.json': JSON.stringify({ enabledPlugins: { 'superpowers@x': false } })
  });
  try {
    const r = ambiente.detectar(dir);
    assert.deepStrictEqual(r.plugins, ['context7@y']);
    assert.strictEqual(r.delegaveis.some((d) => d.indexOf('superpowers') === 0), false, JSON.stringify(r.delegaveis));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A4-amb-2 (pedido 12, estados): settings.json, settings.local.json e .mcp.json quebrados ou ilegiveis eram "ausente",
// calados - o init dizia "nada" de um projeto que configura. So ENOENT e ausente; o resto vai a naoLidos com a causa.
test('A4-amb-2: arquivo de configuracao que nao se le vai a naoLidos com a causa; ausente nao', () => {
  const dir = montar({ '.claude/settings.json': '{ isso nao e json', '.mcp.json/x': '' });
  try {
    const r = ambiente.detectar(dir);
    assert.strictEqual(r.naoLidos.length, 2, JSON.stringify(r.naoLidos));
    // pendencia #17 (dono, 2026-11-19): o JSON quebrado sai sem a mensagem do V8, que copia um trecho do texto
    assert.strictEqual(r.naoLidos[0], '.claude/settings.json (nao e JSON valido)');
    assert.ok(/^\.mcp\.json \(e uma pasta \(EISDIR\)\)$/.test(r.naoLidos[1]), r.naoLidos[1]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const segredo = montar({ '.claude/settings.local.json': '{ "env": { "TOKEN": "sk-segredo-123" ',
    '.mcp.json': '{ "mcpServers": { "x": { "headers": { "Authorization": "Bearer sk-segredo-456" } } x' });
  try {
    const r = ambiente.detectar(segredo);
    assert.deepStrictEqual(r.naoLidos, ['.claude/settings.local.json (nao e JSON valido)', '.mcp.json (nao e JSON valido)']);
    assert.ok(!JSON.stringify(r).includes('sk-segredo'), 'o trecho do arquivo foi para a saida');
  } finally { fs.rmSync(segredo, { recursive: true, force: true }); }
  const limpo = montar({ 'a.js': '', '.claude/settings.json': '[1]' });
  try {
    assert.deepStrictEqual(ambiente.detectar(limpo).naoLidos, ['.claude/settings.json (nao e um objeto JSON)']);
  } finally { fs.rmSync(limpo, { recursive: true, force: true }); }
  const cru = montar({ 'a.js': '' });
  try {
    assert.deepStrictEqual(ambiente.detectar(cru).naoLidos, [], 'ausente nao e ilegivel');
  } finally { fs.rmSync(cru, { recursive: true, force: true }); }
});

// A4-ins-1 (pedido 12, estados): arquivo de instrucoes que nao se le (EACCES, EISDIR) contava 0 calado, e o peso da
// auditoria e do init saia menor sem dizer. So ENOENT conta 0; o resto vai a naoLidos com a causa.
test('A4-ins-1: fonte que nao se le vai a naoLidos com a causa; ausente segue contando 0 sem aviso', () => {
  const dir = montar({ 'CLAUDE.md': '- regra um\n- regra dois\n', 'docs/x.md': '' });
  try {
    const r = instrucoes.contar(dir, { fontesCanonicas: ['CLAUDE.md', 'docs', 'nao-existe.md'] });
    assert.strictEqual(r.total, 2);
    assert.deepStrictEqual(r.naoLidos, ['docs (e uma pasta (EISDIR))']);
    assert.deepStrictEqual(instrucoes.contar(dir, { fontesCanonicas: ['CLAUDE.md'] }).naoLidos, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A6 (pedido 12, R2 :71 da A6, borda): item de fontesCanonicas que nao e texto (projeto.json editado a mao; o validar
// reprova, mas a auditoria e o init leem o projeto sem validar) derrubava o contar no path.resolve. Vai a naoLidos, e a
// fonte de consulta seguinte segue saindo do peso.
test('A6: item de fonte que nao e texto vai a naoLidos e o peso segue', () => {
  const dir = montar({ 'CLAUDE.md': '- regra um\n- regra dois\n', 'docs/decisoes.md': '- d1\n' });
  try {
    const r = instrucoes.contar(dir, { fontesCanonicas: [null, 'CLAUDE.md', 42, 'docs/decisoes.md'],
      fontesDeConsulta: ['docs/decisoes.md'] });
    assert.strictEqual(r.total, 2);
    assert.deepStrictEqual(r.naoLidos, ['fonte null (nao e texto)', 'fonte 42 (nao e texto)']);
    assert.deepStrictEqual(r.foraDoPeso, [{ arquivo: 'docs/decisoes.md', n: 1 }]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A4-75/A4-36: enabledPlugins, hooks ou mcpServers que nao sao um mapa de nomes viravam nomes de indice ("0") ou letras;
// agora contam como nada e o motivo vai a naoLidos. O .mcp.json vale com mcpServers ou com os servidores na raiz.
test('A4-75: enabledPlugins, hooks e mcpServers fora da forma de mapa nao viram nomes e vao a naoLidos', () => {
  const dir = montar({
    '.claude/settings.json': JSON.stringify({ enabledPlugins: ['superpowers@x'], hooks: 'Stop' }),
    '.claude/settings.local.json': JSON.stringify({ enabledPlugins: 'abc' }),
    '.mcp.json': JSON.stringify({ mcpServers: ['servidor'] })
  });
  try {
    const r = ambiente.detectar(dir);
    assert.deepStrictEqual(r.plugins, []);
    assert.deepStrictEqual(r.hooks, []);
    assert.deepStrictEqual(r.mcp, []);
    assert.deepStrictEqual(r.naoLidos.slice().sort(), [
      '.claude/settings.json (enabledPlugins nao e um objeto de nomes)',
      '.claude/settings.json (hooks nao e um objeto de nomes)',
      '.claude/settings.local.json (enabledPlugins nao e um objeto de nomes)',
      '.mcp.json (mcpServers nao e um objeto de nomes)'
    ]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  for (const [nome, mcp] of [['com mcpServers', { mcpServers: { um: {}, dois: {} } }], ['na raiz', { um: {}, dois: {} }]]) {
    const outro = montar({ '.mcp.json': JSON.stringify(mcp) });
    try {
      const r = ambiente.detectar(outro);
      assert.deepStrictEqual(r.mcp, ['um', 'dois'], nome);
      assert.deepStrictEqual(r.naoLidos, [], nome);
    } finally { fs.rmSync(outro, { recursive: true, force: true }); }
  }
});

// H9-2 (D881, curso Introduction to agent skills): criterio 10, o teto de linhas do SKILL.md e de caracteres da descricao.
test('H9-2: a rubrica avisa a skill acima de 500 linhas e a descricao acima de 500 caracteres, e so acima', () => {
  const r10 = (t) => rubrica.conferir(t).erros.filter((e) => e.startsWith('criterio 10'));
  const cab = (d) => '---\nname: x\ndescription: ' + d + '\n---\n## O que nao promete\n';
  const quando = 'Use quando ';
  const desc = (n) => quando + 'x'.repeat(n - quando.length);
  assert.deepStrictEqual(r10(cab(desc(500))), [], '500 caracteres cabem');
  assert.match(r10(cab(desc(501)))[0], /description tem 501 caracteres, acima de 500/);
  // acento conta como um caractere, nao como dois bytes
  assert.deepStrictEqual(r10(cab(quando + '\u00e7'.repeat(500 - quando.length))), []);
  // a marcacao do YAML nao conta: aspas em volta e o indicador de bloco (>, |, >-) ficam fora dos 500
  assert.deepStrictEqual(r10(cab('"' + desc(500) + '"')), [], 'aspas duplas nao contam');
  assert.deepStrictEqual(r10(cab("'" + desc(500) + "'")), [], 'aspas simples nao contam');
  assert.deepStrictEqual(r10(cab('>-\n  ' + desc(500))), [], 'bloco >- nao conta');
  assert.deepStrictEqual(r10(cab('|\n  ' + desc(500))), [], 'bloco | nao conta');
  assert.match(r10(cab('"' + desc(501) + '"'))[0], /description tem 501 caracteres/);
  assert.match(r10(cab('>\n  ' + desc(501)))[0], /description tem 501 caracteres/);
  const corpo = (n) => { const base = cab('Use quando x.'); const falta = n - base.split('\n').length + 1; return base + 'l\n'.repeat(falta); };
  assert.deepStrictEqual(r10(corpo(500)), [], '500 linhas cabem');
  assert.match(r10(corpo(501))[0], /tem 501 linhas, acima de 500/);
  assert.deepStrictEqual(r10(corpo(500).replace(/\n/g, '\r\n')), [], 'CRLF nao conta linha a mais');
});

test('H9-2/H9-8: toda descricao de skill e de agente do sworn cabe nos 500 caracteres', () => {
  const raiz = path.join(__dirname, '..');
  // a rubrica mede a descricao do frontmatter, tambem a em bloco do YAML (>-), nas skills e nos agentes
  const longa = (t) => rubrica.conferir(t).erros.filter((x) => /^criterio 10: a linha description/.test(x));
  let skills = 0;
  for (const n of fs.readdirSync(path.join(raiz, 'skills'))) {
    const arq = path.join(raiz, 'skills', n, 'SKILL.md');
    if (!fs.existsSync(arq)) continue;
    skills++;
    assert.deepStrictEqual(longa(fs.readFileSync(arq, 'utf8')), [], 'skills/' + n);
  }
  assert.ok(skills > 0, 'nenhuma skill medida');
  let agentes = 0;
  for (const n of fs.readdirSync(path.join(raiz, 'agents'))) {
    if (!n.endsWith('.md')) continue;
    agentes++;
    const t = fs.readFileSync(path.join(raiz, 'agents', n), 'utf8');
    // so o frontmatter conta: um "description:" no corpo do agente nao supre o do cabecalho
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(t);
    assert.ok(frontmatter, 'agents/' + n + ' sem frontmatter');
    assert.match(frontmatter[1], /^description:/m, 'agents/' + n + ' sem description no frontmatter');
    assert.deepStrictEqual(longa(t), [], 'agents/' + n);
  }
  assert.ok(agentes > 0, 'nenhum agente medido');
});

// H9-3 (D881): os servidores MCP de fora do .mcp.json, do ~/.claude.json, so pelos nomes
function chaveDoProjeto(dir) {
  const n = dir.replace(/\\/g, '/');
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

test('H9-3: le os nomes dos servidores MCP do usuario e do local, nunca os valores, e so quando pedem', () => {
  const dir = montar({ 'a.js': '' });
  const conf = montar({});
  try {
    const arq = path.join(conf, '.claude.json');
    fs.writeFileSync(arq, JSON.stringify({
      mcpServers: { context7: { command: 'npx', env: { CHAVE: 'SEGREDO-ENSAIO-1' } } },
      projects: {
        [chaveDoProjeto(dir)]: { mcpServers: { banco: { env: { SENHA: 'SEGREDO-ENSAIO-2' } } } },
        [chaveDoProjeto(dir) + '-outro']: { mcpServers: { alheio: {} } }
      }
    }), 'utf8');
    const r = ambiente.detectar(dir, { claudeJson: arq });
    assert.deepStrictEqual(r.mcpForaDoProjeto, { usuario: ['context7'], local: ['banco'] });
    assert.deepStrictEqual(r.mcp, []);
    assert.ok(r.delegaveis.some(function (d) { return d.indexOf('context7:') === 0; }), 'o MCP do usuario conta para delegar');
    assert.ok(!/SEGREDO-ENSAIO/.test(JSON.stringify(r)), 'nenhum valor sai');
    assert.deepStrictEqual(r.naoLidos, []);
    // sem a opcao, o arquivo da maquina nao e lido
    assert.deepStrictEqual(ambiente.detectar(dir).mcpForaDoProjeto, { usuario: [], local: [] });
    assert.deepStrictEqual(ambiente.detectar(dir).delegaveis, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(conf, { recursive: true, force: true });
  }
});

test('H9-3: .claude.json ausente nao avisa; quebrado ou fora da forma entra em naoLidos sem derrubar', () => {
  const dir = montar({ 'a.js': '' });
  // o V8 copia um trecho do texto na mensagem do JSON quebrado ("Unexpected token ..."): o aviso nao a leva
  const conf = montar({ 'quebrado.json': '{"mcpServers":{"x":{"env":{"K":"SEGREDO-FALSO" oops}}}}', 'lista.json': JSON.stringify({ mcpServers: ['x'], projects: { [chaveDoProjeto(dir)]: { mcpServers: 'y' } } }) });
  try {
    const ausente = ambiente.detectar(dir, { claudeJson: path.join(conf, 'nao-existe.json') });
    assert.deepStrictEqual(ausente.mcpForaDoProjeto, { usuario: [], local: [] });
    assert.deepStrictEqual(ausente.naoLidos, []);
    const quebrado = ambiente.detectar(dir, { claudeJson: path.join(conf, 'quebrado.json') });
    assert.deepStrictEqual(quebrado.mcpForaDoProjeto, { usuario: [], local: [] });
    assert.deepStrictEqual(quebrado.naoLidos, ['~/.claude.json (nao e JSON valido)']);
    // o rotulo segue o que o chamador passa (o $CLAUDE_CONFIG_DIR, quando ela muda a pasta)
    assert.deepStrictEqual(ambiente.detectar(dir, { claudeJson: path.join(conf, 'quebrado.json'), rotuloClaudeJson: '$CLAUDE_CONFIG_DIR/.claude.json' }).naoLidos,
      ['$CLAUDE_CONFIG_DIR/.claude.json (nao e JSON valido)']);
    const lista = ambiente.detectar(dir, { claudeJson: path.join(conf, 'lista.json') });
    assert.deepStrictEqual(lista.mcpForaDoProjeto, { usuario: [], local: [] });
    assert.deepStrictEqual(lista.naoLidos, ['~/.claude.json (mcpServers nao e um objeto de nomes)',
      '~/.claude.json, projects deste projeto (mcpServers nao e um objeto de nomes)']);
    // a entrada do projeto que nao e objeto avisa, em vez de sumir calada
    fs.writeFileSync(path.join(conf, 'entrada.json'), JSON.stringify({ projects: { [chaveDoProjeto(dir)]: 'z' } }), 'utf8');
    assert.deepStrictEqual(ambiente.detectar(dir, { claudeJson: path.join(conf, 'entrada.json') }).naoLidos,
      ['~/.claude.json (projects deste projeto nao e um objeto)']);
    // duas chaves da mesma pasta (com e sem barra no fim): os servidores das duas, sem repetir
    fs.writeFileSync(path.join(conf, 'duas.json'), JSON.stringify({ projects: {
      [chaveDoProjeto(dir)]: { mcpServers: { banco: {}, fila: {} } }, [chaveDoProjeto(dir) + '/']: { mcpServers: { banco: {}, cache: {} } } } }), 'utf8');
    assert.deepStrictEqual(ambiente.detectar(dir, { claudeJson: path.join(conf, 'duas.json') }).mcpForaDoProjeto,
      { usuario: [], local: ['banco', 'fila', 'cache'] });
    fs.writeFileSync(path.join(conf, 'escalar.json'), '5', 'utf8');
    const escalar = ambiente.detectar(dir, { claudeJson: path.join(conf, 'escalar.json') });
    assert.deepStrictEqual(escalar.mcpForaDoProjeto, { usuario: [], local: [] });
    assert.deepStrictEqual(escalar.naoLidos, ['~/.claude.json (nao e um objeto JSON)']);
    // a chave do projeto gravada com barra no fim tambem e a deste projeto
    fs.writeFileSync(path.join(conf, 'barra.json'), JSON.stringify({ projects: { [chaveDoProjeto(dir) + '/']: { mcpServers: { banco: {} } } } }), 'utf8');
    assert.deepStrictEqual(ambiente.detectar(dir, { claudeJson: path.join(conf, 'barra.json') }).mcpForaDoProjeto, { usuario: [], local: ['banco'] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(conf, { recursive: true, force: true });
  }
});

test('H9-3: o .claude.json mora na CLAUDE_CONFIG_DIR quando ela vem; o varrer.js o le e diz que leu', () => {
  assert.strictEqual(ambiente.caminhoDoClaudeJson({ CLAUDE_CONFIG_DIR: path.join('x', 'conf') }), path.join('x', 'conf', '.claude.json'));
  assert.strictEqual(ambiente.caminhoDoClaudeJson({}), path.join(os.homedir(), '.claude.json'));
  assert.strictEqual(ambiente.rotuloDoClaudeJson({ CLAUDE_CONFIG_DIR: 'x' }), '$CLAUDE_CONFIG_DIR/.claude.json');
  assert.strictEqual(ambiente.rotuloDoClaudeJson({}), '~/.claude.json');
  const dir = montar({ 'a.js': '' });
  const conf = montar({});
  try {
    fs.writeFileSync(path.join(conf, '.claude.json'), JSON.stringify({ mcpServers: { ensaio: {} } }), 'utf8');
    const env = Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: conf });
    const r = require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'varrer.js'), dir],
      { encoding: 'utf8', env: env, timeout: 60000 });
    assert.strictEqual(r.status, 0, r.stderr || String(r.error || r.signal));
    const saida = JSON.parse(r.stdout);
    assert.deepStrictEqual(saida.ambiente.mcpForaDoProjeto, { usuario: ['ensaio'], local: [] });
    assert.match(saida.teto.observacao, /\$CLAUDE_CONFIG_DIR\/\.claude\.json, so os nomes dos servidores MCP/);
    // a pasta chamada .claude.json nao e lida, e a frase nao diz que foi
    fs.unlinkSync(path.join(conf, '.claude.json'));
    fs.mkdirSync(path.join(conf, '.claude.json'));
    const p = require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'varrer.js'), dir],
      { encoding: 'utf8', env: env, timeout: 60000 });
    assert.strictEqual(p.status, 0, p.stderr || String(p.error || p.signal));
    assert.doesNotMatch(JSON.parse(p.stdout).teto.observacao, /\.claude\.json/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(conf, { recursive: true, force: true });
  }
});

test('H9-3: a auditoria traz os servidores MCP de fora do .mcp.json e o que nao se leu do ~/.claude.json', () => {
  const dir = montar({ 'a.js': '' });
  const conf = montar({ 'quebrado.json': '{ nao e json' });
  try {
    const arq = path.join(conf, '.claude.json');
    fs.writeFileSync(arq, JSON.stringify({ mcpServers: { context7: {} } }), 'utf8');
    const auditoria = require('../scripts/lib/auditoria.js');
    const r = auditoria.auditar(dir, null, { claudeJson: arq, agora: 0 });
    assert.deepStrictEqual(r.mcpForaDoProjeto, { usuario: ['context7'], local: [], naoLidos: [] });
    assert.ok(r.delegaveis.some(function (d) { return d.indexOf('context7:') === 0; }));
    const q = auditoria.auditar(dir, null, { claudeJson: path.join(conf, 'quebrado.json'), agora: 0 });
    assert.deepStrictEqual(q.mcpForaDoProjeto.naoLidos, ['~/.claude.json (nao e JSON valido)']);
    // com o rotulo da CLAUDE_CONFIG_DIR, o filtro casa o mesmo rotulo
    const qc = auditoria.auditar(dir, null, { claudeJson: path.join(conf, 'quebrado.json'), rotuloClaudeJson: '$CLAUDE_CONFIG_DIR/.claude.json', agora: 0 });
    assert.deepStrictEqual(qc.mcpForaDoProjeto.naoLidos, ['$CLAUDE_CONFIG_DIR/.claude.json (nao e JSON valido)']);
    assert.deepStrictEqual(auditoria.auditar(dir, null, { agora: 0 }).mcpForaDoProjeto, { usuario: [], local: [], naoLidos: [] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(conf, { recursive: true, force: true });
  }
});

// H9-17 (D881): allowed-tools estreito so no drift, no review-plan e no shortcuts, e so para o script do proprio plugin
// que o corpo manda rodar. Medido em claude -p (s372): a regra de PowerShell e a que vale no Windows, e um gancho
// PreToolUse que nega continua negando o comando que casa com ela.
test('H9-17: allowed-tools so nas tres skills, cada regra presa a um script do plugin que o corpo roda', () => {
  const raiz = path.join(__dirname, '..');
  const com = [];
  for (const n of fs.readdirSync(path.join(raiz, 'skills'))) {
    const arq = path.join(raiz, 'skills', n, 'SKILL.md');
    if (!fs.existsSync(arq)) continue;
    const t = fs.readFileSync(arq, 'utf8');
    const fm = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(t);
    const linha = fm && /^allowed-tools:[ \t]*(.*)$/m.exec(fm[1]);
    if (!linha) continue;
    com.push(n);
    const regras = linha[1].split(/,\s*(?=(?:Bash|PowerShell)\()/);
    const ferramentas = new Set();
    for (const r of regras) {
      const m = /^(Bash|PowerShell)\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/([a-z-]+\.js)"(?: \*)?\)$/.exec(r.trim());
      assert.ok(m, n + ': regra fora do padrao estreito: ' + r);
      ferramentas.add(m[1]);
      assert.ok(fs.existsSync(path.join(raiz, 'scripts', m[2])), n + ': o script ' + m[2] + ' nao existe');
      assert.ok(t.indexOf('node "${CLAUDE_PLUGIN_ROOT}/scripts/' + m[2] + '"') !== -1, n + ': o corpo nao roda ' + m[2]);
    }
    assert.deepStrictEqual(Array.from(ferramentas).sort(), ['Bash', 'PowerShell'], n + ': as duas ferramentas de shell');
  }
  assert.deepStrictEqual(com.sort(), ['drift', 'review-plan', 'shortcuts']);
});
