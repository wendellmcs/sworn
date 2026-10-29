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
