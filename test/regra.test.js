'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const regra = require('../scripts/lib/regra.js');
const reinjecao = require('../scripts/lib/reinjecao.js');

test('regra: gatilho -> acao e aceita', () => {
  const r = regra.validarRegra('antes de criar arquivo novo -> buscar o que ja existe e citar a busca');
  assert.strictEqual(r.ok, true, r.erros.join(' | '));
});

test('regra: proibicao solta e recusada (falha A1)', () => {
  const r = regra.validarRegra('nao faca hardening nao solicitado');
  assert.strictEqual(r.ok, false);
  assert.ok(r.erros.some((e) => e.includes('gatilho')));
});

test('regra: gatilho vazio e recusado', () => {
  assert.strictEqual(regra.validarRegra('-> faca alguma coisa').ok, false);
});

test('regra: acao vazia e recusada', () => {
  assert.strictEqual(regra.validarRegra('quando editar ->').ok, false);
});

test('regra: numero de versao cravado e recusado (D10)', () => {
  const r = regra.validarRegra('ao instalar -> usar a versao 2.1.220');
  assert.strictEqual(r.ok, false);
  assert.ok(r.erros.some((e) => e.includes('versao')));
});

test('regra: nome de modelo cravado e recusado (D10)', () => {
  assert.strictEqual(regra.validarRegra('ao delegar -> usar claude-opus-5').ok, false);
});

test('regra: preco cravado e recusado (D10)', () => {
  assert.strictEqual(regra.validarRegra('ao escolher -> lembrar que custa US$ 3 por milhao').ok, false);
});

test('regra: nome de evento de hook cravado e recusado (D10)', () => {
  assert.strictEqual(regra.validarRegra('ao fechar -> conferir o PostToolUse').ok, false);
});

test('regra: flag de linha de comando cravada e recusada (D10)', () => {
  assert.strictEqual(regra.validarRegra('ao rodar teste -> passar --fail-fast').ok, false);
});

test('regra: seta ASCII -> tambem vale', () => {
  assert.strictEqual(regra.validarRegra('ao reverter posicao -> citar a evidencia nova').ok, true);
});

test('regra: parseRegras acha as regras e ignora prosa', () => {
  const texto = [
    '# Regras',
    'Isto e um paragrafo de introducao.',
    '',
    '- ao editar arquivo -> rodar git status antes',
    '- ao afirmar sucesso -> colar a saida da rodada atual'
  ].join('\n');
  const regras = regra.parseRegras(texto);
  assert.strictEqual(regras.length, 2);
  assert.strictEqual(regras[0].gatilho, 'ao editar arquivo');
});

test('regra: validarArquivo reprova o arquivo inteiro por uma regra ruim', () => {
  const texto = '- ao editar -> rodar git status\n- proibido gradiente\n';
  const r = regra.validarArquivo(texto);
  assert.strictEqual(r.total, 1, 'so a linha com seta conta como regra');
  assert.strictEqual(r.ok, true, 'linha sem seta e prosa, nao regra invalida');
});

test('regra: validarArquivo reprova regra com fato volatil', () => {
  const r = regra.validarArquivo('- ao subir -> usar node 24.12.0\n');
  assert.strictEqual(r.ok, false);
});

// --- Acrescimos desta rodada, com motivo declarado no brief da T11 -------------

/**
 * O modelo que o plugin embarca e copiado pelo Passo 7 do /sworn:init, e o
 * Passo 6 do init roda o validar.js - que a partir da T11 valida regras.md.
 * Um modelo que reprove no proprio validador quebraria TODO init, e o defeito
 * apareceria no projeto do usuario, nunca aqui.
 */
test('regra: o proprio modelos/regras.md passa no validador', () => {
  const alvo = path.join(__dirname, '..', 'modelos', 'regras.md');
  const bruto = fs.readFileSync(alvo, 'utf8');
  const r = regra.validarArquivo(bruto);
  assert.strictEqual(r.ok, true, r.erros.join(' | '));
  // Contagem EXATA, nao `> 0`: com `> 0` a regra fantasma da R-T11-01 passava
  // despercebida - 11 lidas onde ha 10 itens de lista tambem e maior que zero.
  const itens = (bruto.match(/^\s*[-*+]\s+.*(?:->|=>|→)/gm) || []).length;
  assert.strictEqual(r.total, itens, 'o validador leu numero de regras diferente do de itens de lista');
});

/**
 * D115 / R-T11-01: a frase que EXPLICA o formato contem uma seta, por definicao.
 * Sem a guarda de item de lista ela virava a primeira "regra" reinjetada em toda
 * sessao de todo projeto. Este teste e o que reprova se a guarda cair.
 */
test('regra: prosa com seta continua prosa, e nao entra no nucleo', () => {
  const texto = [
    '# Regras deste projeto',
    '',
    'Escritas como `gatilho → acao`, nunca como proibicao solta.',
    '',
    '- ao editar arquivo -> rodar git status antes'
  ].join('\n');
  const rs = regra.parseRegras(texto);
  assert.strictEqual(rs.length, 1, 'so o item de lista e regra; a prosa com seta nao e');
  assert.strictEqual(rs[0].gatilho, 'ao editar arquivo');

  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-regra-'));
  try {
    fs.mkdirSync(path.join(cwd, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.claude', 'sworn', 'regras.md'), texto, 'utf8');
    assert.ok(!reinjecao.nucleo(cwd).includes('Escritas como'), 'a prosa vazou para o nucleo reinjetado');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

/** nucleo() e a UNICA funcao que o hook de abertura chama - e o plano nao a testava. */
test('regra: nucleo devolve null quando o projeto nao tem regras.md', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-regra-'));
  try {
    assert.strictEqual(reinjecao.nucleo(cwd), null);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('regra: nucleo reinjeta as regras do projeto, e cita a fonte', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-regra-'));
  try {
    fs.mkdirSync(path.join(cwd, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, '.claude', 'sworn', 'regras.md'),
      '# Regras\n\nProsa que nao e regra.\n\n- ao editar arquivo -> rodar git status antes\n',
      'utf8'
    );
    const texto = reinjecao.nucleo(cwd);
    assert.ok(texto, 'com regras.md no lugar, nucleo nao pode devolver null');
    assert.ok(texto.includes('ao editar arquivo -> rodar git status antes'));
    assert.ok(texto.includes('.claude/sworn/regras.md'), 'o texto reinjetado tem de citar a fonte');
    assert.ok(!texto.includes('Prosa que nao e regra'), 'prosa nao entra no nucleo reinjetado');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

/**
 * R-T10-49 / D114: o roteiro do /sworn:init grava projeto.json e DEPOIS
 * regras.md. Assim que projeto.json existe o portao de escopo esta vivo, e
 * .claude/sworn/regras.md nao tem o passe livre - que e do escopo.md e so
 * dele (D35). Medido: com projeto.json no disco o portao responde `deny`.
 * O conserto e a ORDEM: semear as regras antes de levantar o portao. Este teste
 * guarda a ordem, que e prosa e por isso se perde calada numa reescrita.
 */
test('R-T10-49: no roteiro do init, semear as regras vem ANTES de gravar o projeto.json', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'skills', 'init', 'SKILL.md'), 'utf8');
  const semear = skill.indexOf('semear as regras');
  const gravar = skill.indexOf('gravar e validar');
  assert.ok(semear !== -1, 'nao achei o passo de semear as regras no SKILL.md');
  assert.ok(gravar !== -1, 'nao achei o passo de gravar e validar no SKILL.md');
  assert.ok(
    semear < gravar,
    'o passo que grava .claude/sworn/regras.md tem de vir antes do que grava projeto.json: ' +
      'depois dele o portao de escopo esta vivo e nega o regras.md (R-T10-49)'
  );
});

// --- D116 / R-T10-22: as quatro respostas da entrevista chegam na sessao ------

/**
 * R-T10-22 [P0]: o /sworn:init pergunta cinco coisas e grava todas, mas
 * `fontesCanonicas`, `modeloDeAmeaca`, `quemDecide` e `provaDePronto` nao eram
 * lidas por portao nenhum NEM reinjetadas - medido: so `intocaveis`,
 * `comandosLiberados`, `comandosBloqueados`, `marchas` e `marchaPadrao` tinham
 * consumidor. Pior: duas das dez regras semeadas MANDAM consultar valores que o
 * agente nunca recebia ("a menos que esteja em fontesCanonicas", E15; "o shell
 * declarado em projeto.json", F16) - obrigando justamente o abrir-arquivo que a
 * reinjecao existe para evitar.
 */
function bancada(regras, projeto) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-regra-'));
  fs.mkdirSync(path.join(cwd, '.claude', 'sworn'), { recursive: true });
  if (regras !== null) {
    fs.writeFileSync(path.join(cwd, '.claude', 'sworn', 'regras.md'), regras, 'utf8');
  }
  if (projeto !== null) {
    fs.writeFileSync(
      path.join(cwd, '.claude', 'sworn', 'projeto.json'),
      typeof projeto === 'string' ? projeto : JSON.stringify(projeto),
      'utf8'
    );
  }
  return cwd;
}

const REGRAS_OK = '# Regras\n\n- ao editar arquivo -> rodar git status antes\n';
const PROJETO_OK = {
  versaoConfig: 1,
  plataforma: { so: 'win32', shell: 'powershell' },
  modeloDeAmeaca: 'interno',
  quemDecide: 'Ana',
  provaDePronto: 'npm test',
  fontesCanonicas: ['CLAUDE.md', 'AGENTS.md']
};

test('D116: nucleo reinjeta as quatro respostas da entrevista, e cita a fonte', () => {
  const cwd = bancada(REGRAS_OK, PROJETO_OK);
  try {
    const t = reinjecao.nucleo(cwd);
    assert.ok(t, 'nucleo nao pode devolver null com regras.md e projeto.json no lugar');
    assert.ok(t.includes('Ana'), 'quemDecide nao chegou na sessao');
    assert.ok(t.includes('npm test'), 'provaDePronto nao chegou na sessao');
    assert.ok(t.includes('CLAUDE.md') && t.includes('AGENTS.md'), 'fontesCanonicas nao chegaram');
    assert.ok(/interno/.test(t), 'modeloDeAmeaca nao chegou na sessao');
    // F16 manda usar "o shell declarado em projeto.json" - entao ele tem de vir junto,
    // senao a regra continua mandando abrir arquivo.
    assert.ok(t.includes('powershell'), 'o shell declarado nao chegou (regra F16)');
    assert.ok(t.includes('projeto.json'), 'o texto reinjetado tem de citar a fonte do contexto');
    // A regra continua sendo o corpo do nucleo - o contexto e cabecalho, nao substituto.
    assert.ok(t.includes('ao editar arquivo -> rodar git status antes'));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('D116: sem projeto.json, o nucleo ainda reinjeta as regras e nao inventa contexto', () => {
  const cwd = bancada(REGRAS_OK, null);
  try {
    const t = reinjecao.nucleo(cwd);
    assert.ok(t, 'a ausencia de projeto.json nao pode matar a reinjecao das regras');
    assert.ok(t.includes('ao editar arquivo -> rodar git status antes'));
    assert.ok(!/quem decide/i.test(t), 'sem projeto.json nao ha contexto a declarar');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('D116: projeto.json corrompido nao derruba a reinjecao das regras', () => {
  const cwd = bancada(REGRAS_OK, '{ isto nao e json');
  try {
    const t = reinjecao.nucleo(cwd);
    assert.ok(t, 'projeto.json corrompido nao pode zerar o nucleo');
    assert.ok(t.includes('ao editar arquivo -> rodar git status antes'));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

/**
 * `provaDePronto` aceita null por contrato (projeto.js:118) e a entrevista aceita
 * "nao existe ainda". Reinjetar "prova de pronto: null" em toda sessao seria pior
 * que nao reinjetar nada: o agente leria `null` como um valor.
 */
test('D116: campo nao declarado vira texto honesto, nunca null nem undefined', () => {
  const cwd = bancada(REGRAS_OK, {
    versaoConfig: 1,
    plataforma: null,
    modeloDeAmeaca: null,
    quemDecide: null,
    provaDePronto: null,
    fontesCanonicas: []
  });
  try {
    const t = reinjecao.nucleo(cwd);
    assert.ok(t, 'nucleo nao pode devolver null aqui');
    assert.ok(!/null|undefined|\[object Object\]/.test(t), 'vazou valor cru para a sessao: ' + t);
    assert.ok(/nao declarad/i.test(t), 'campo ausente tem de ser declarado como ausente');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
