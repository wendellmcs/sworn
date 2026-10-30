'use strict';
const test = require('node:test');
const assert = require('node:assert');
const molde = require('../scripts/lib/molde.js');

const PROJETO = { provaDePronto: 'npm test', quemDecide: 'Ana' };

test('molde: acha as duas formas de fatia', () => {
  const s = molde.slots('a {{campo:provaDePronto}} b {{texto:portoes}} c');
  assert.strictEqual(s.length, 2);
  assert.deepStrictEqual(s.map((x) => x.tipo), ['campo', 'texto']);
  assert.deepStrictEqual(s.map((x) => x.nome), ['provaDePronto', 'portoes']);
});

test('molde: fatia de campo vira REFERENCIA, nunca o valor (D10)', () => {
  const r = molde.preencher('Rode {{campo:provaDePronto}}.', {}, PROJETO);
  assert.ok(r.includes('projeto.json'));
  assert.ok(r.includes('provaDePronto'));
  assert.ok(!r.includes('npm test'), 'o valor nao pode ser cravado no texto');
});

test('molde: fatia de texto recebe o que a entrevista respondeu', () => {
  const r = molde.preencher('Portoes: {{texto:portoes}}', { portoes: 'contrato de UX' }, PROJETO);
  assert.ok(r.includes('contrato de UX'));
});

test('molde: fatia de texto sem resposta vira marca visivel, nao some', () => {
  const r = molde.preencher('Portoes: {{texto:portoes}}', {}, PROJETO);
  assert.ok(r.includes('POR PREENCHER'), r);
});

test('molde: validar recusa fatia por preencher', () => {
  const r = molde.validar('Portoes: (POR PREENCHER: portoes)');
  assert.strictEqual(r.ok, false);
  assert.ok(r.erros.some((e) => e.includes('portoes')));
});

// A4-16 (pedido 12, microcopy): os erros diziam o que houve, nao o que fazer.
test('A4-16: os erros do validar dizem o que fazer', () => {
  assert.deepStrictEqual(molde.validar('Portoes: (POR PREENCHER: portoes)').erros,
    ['fatia por preencher: portoes (escreva a resposta dessa fatia)']);
  assert.deepStrictEqual(molde.validar('a {{texto:portoes}} b').erros,
    ['fatia nao substituida: {{texto:portoes}} (troque a marca pelo texto que ela pede)']);
  assert.deepStrictEqual(molde.validar('(POR PREENCHER: campo marchas nao existe em projeto.json)').erros,
    ['fatia por preencher: campo marchas nao existe em projeto.json' +
      ' (grave o campo em .claude/sworn/projeto.json, pelo /sworn:init)']);
  // R1: a marca que o preencher escreve e a que o validar reconhece como campo sao o mesmo texto.
  assert.deepStrictEqual(molde.validar(molde.preencher('{{campo:naoExiste}}', {}, PROJETO)).erros,
    ['fatia por preencher: campo naoExiste nao existe em projeto.json' +
      ' (grave o campo em .claude/sworn/projeto.json, pelo /sworn:init)']);
  const vol = molde.validar(molde.preencher('{{texto:portoes}}', { portoes: 'usar a versao 2.1.220' }, PROJETO));
  assert.ok(vol.erros.length === 1 && vol.erros[0].endsWith(' (tire esse valor da resposta: ele muda com o tempo)'),
    vol.erros.join(' | '));
});

test('molde: validar recusa chave de fatia que sobrou sem substituir', () => {
  const r = molde.validar('a {{texto:portoes}} b');
  assert.strictEqual(r.ok, false);
});

test('molde: validar recusa fato volatil vindo da entrevista (D10)', () => {
  const cheio = molde.preencher('Portoes: {{texto:portoes}}', { portoes: 'usar a versao 2.1.220' }, PROJETO);
  const r = molde.validar(cheio);
  assert.strictEqual(r.ok, false);
  assert.ok(r.erros.some((e) => e.includes('volatil')));
});

test('molde: texto limpo e preenchido passa', () => {
  const cheio = molde.preencher(
    'Prova: {{campo:provaDePronto}}\nPortoes: {{texto:portoes}}',
    { portoes: 'contrato de UX antes de fechar' },
    PROJETO
  );
  assert.strictEqual(molde.validar(cheio).ok, true, molde.validar(cheio).erros.join(' | '));
});

test('molde: campo inexistente no projeto.json e erro nomeado', () => {
  const r = molde.preencher('{{campo:naoExiste}}', {}, PROJETO);
  assert.ok(r.includes('POR PREENCHER'));
  assert.strictEqual(molde.validar(r).ok, false);
});

test('molde: o molde de verdade do plugin preenche e valida', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const texto = fs.readFileSync(path.join(__dirname, '..', 'modelos', 'skill-projeto.md'), 'utf8');
  const valores = {};
  for (const s of molde.slots(texto)) {
    if (s.tipo === 'texto') valores[s.nome] = 'conteudo de ensaio para ' + s.nome;
  }
  const projeto = {
    nome: 'ensaio', provaDePronto: 'npm test', quemDecide: 'dono',
    modeloDeAmeaca: 'interno', marchas: {}, intocaveis: [], fontesCanonicas: [],
    agentes: { escada: [] }, marchaPadrao: 'padrao', limiares: {}
  };
  const cheio = molde.preencher(texto, valores, projeto);
  const r = molde.validar(cheio);
  assert.strictEqual(r.ok, true, r.erros.join(' | '));
});

// D420/IN-06: fatia de texto com quebra de linha DENTRO do frontmatter fecha o
// cabecalho antes da hora e joga model/tools/maxTurns para o corpo. O agente
// so-leitura herdaria TODAS as ferramentas e o validar dizia ok.
function moldeAgente() {
  const fs = require('node:fs');
  const path = require('node:path');
  return fs.readFileSync(path.join(__dirname, '..', 'modelos', 'agente.md'), 'utf8');
}
function valoresAgente(extra) {
  const v = {
    nome: 'leitor', quando: 'Use para buscar codigo.', apelido: 'haiku', esforco: 'low',
    ferramentas: 'Read,Grep', maxTurns: '8', papel: 'Busca codigo.',
    decideSozinho: 'Onde olhar.', escalaPara: 'o degrau de cima', naoFaz: 'Nao edita.'
  };
  return Object.assign(v, extra || {});
}
const PROJETO_AGENTE = { provaDePronto: 'npm test', quemDecide: 'Ana' };

test('molde: quebra de linha numa fatia DENTRO do frontmatter e recusada (D420/IN-06)', () => {
  for (const quebra of ['\n', '\r\n', '\r']) {
    const cheio = molde.preencher(moldeAgente(),
      valoresAgente({ quando: 'Use para buscar codigo.' + quebra + '---' + quebra + 'Nao use para editar.' }),
      PROJETO_AGENTE);
    const r = molde.validar(cheio);
    assert.strictEqual(r.ok, false, 'frontmatter fechado antes da hora passou como ok');
    assert.ok(r.erros.some((e) => e.includes('quando')), r.erros.join(' | '));
  }
});

test('molde: quebra de linha no CORPO continua valendo, e o caso bom do agente passa (D420/IN-06)', () => {
  const ok = molde.preencher(moldeAgente(),
    valoresAgente({ papel: 'Linha um.\nLinha dois.', naoFaz: '- a\n- b' }), PROJETO_AGENTE);
  const r = molde.validar(ok);
  assert.strictEqual(r.ok, true, r.erros.join(' | '));
  assert.ok(ok.includes('Linha um.\nLinha dois.'));
});

// H-5b: valor com caractere especial do YAML numa fatia do frontmatter sai CITADO,
// no mesmo formato que scripts/lib/agentes.js desfaz (aspas duplas, `\"` e `\`).
const agentesLib = require('../scripts/lib/agentes.js');

test('molde: fatia que e o valor inteiro no frontmatter sai citada e volta igual (H-5b)', () => {
  const casos = [
    'Use quando: o usuario pedir busca',
    'Busca codigo # nao comentario',
    '- comeca com hifen',
    '[lista] fingida',
    '*comeca com estrela',
    'termina com dois-pontos:',
    'tem "aspas" e \ barra: junto',
    '"ja vem entre aspas"'
  ];
  for (const original of casos) {
    const cheio = molde.preencher(moldeAgente(), valoresAgente({ quando: original }), PROJETO_AGENTE);
    // o leitor do plugin nao e um parser YAML e nao corta comentario: so a linha citada prova o YAML.
    assert.ok(cheio.includes('\ndescription: "'), 'valor especial saiu sem aspas: ' + original);
    const fm = agentesLib.frontmatter(cheio);
    assert.strictEqual(fm.ok, true, 'frontmatter nao fechou: ' + original);
    assert.strictEqual(fm.campos.description, original, 'ida-e-volta falhou: ' + original);
    assert.strictEqual(fm.campos.model, 'haiku');
    assert.strictEqual(fm.campos.tools, 'Read,Grep');
    assert.strictEqual(fm.campos.maxTurns, '8');
  }
});

test('molde: fatia NO MEIO do valor com ": " cita a LINHA inteira (H-5b)', () => {
  const m = '---\nname: x\ndescription: Manual do projeto {{texto:nome}}. Use no inicio.\n---\n\ncorpo {{texto:nome}}\n';
  const cheio = molde.preencher(m, { nome: 'Alfa: beta' }, PROJETO);
  const fm = agentesLib.frontmatter(cheio);
  assert.strictEqual(fm.ok, true);
  assert.strictEqual(fm.campos.description, 'Manual do projeto Alfa: beta. Use no inicio.');
  assert.ok(cheio.includes('description: "Manual do projeto Alfa: beta. Use no inicio."'), cheio);
  assert.ok(cheio.endsWith('corpo Alfa: beta\n'), 'o corpo nao pode ser citado');
});

test('molde: valor comum no frontmatter sai IDENTICO, sem aspas (H-5b)', () => {
  const cheio = molde.preencher(moldeAgente(), valoresAgente({ ferramentas: 'Read, Grep', apelido: 'sonnet', maxTurns: '20' }), PROJETO_AGENTE);
  assert.ok(cheio.includes('\ntools: Read, Grep\n'), cheio);
  assert.ok(cheio.includes('\nmodel: sonnet\n'));
  assert.ok(cheio.includes('\nmaxTurns: 20\n'));
  assert.ok(cheio.includes('\ndescription: Use para buscar codigo.\n'));
  assert.ok(!/^(name|description|model|effort|tools|maxTurns): ["']/m.test(cheio.split('\n---\n')[0]));
});

test('molde: fora do frontmatter nada e citado (H-5b)', () => {
  const cheio = molde.preencher(moldeAgente(), valoresAgente({ papel: 'Faca isto: agora # ja', naoFaz: '- a: b' }), PROJETO_AGENTE);
  assert.ok(cheio.includes('Faca isto: agora # ja'), cheio);
  assert.ok(cheio.includes('- a: b'));
  assert.ok(!cheio.includes('"Faca isto'));
});

test('molde: fatia por preencher no frontmatter nao e citada, o validar segue recusando (H-5b)', () => {
  const cheio = molde.preencher(moldeAgente(), valoresAgente({ quando: '' }), PROJETO_AGENTE);
  assert.ok(cheio.includes('\ndescription: (POR PREENCHER: quando)\n'), cheio);
  assert.strictEqual(molde.validar(cheio).ok, false);
});

// A4-mol-1 (pedido 12, microcopy+borda): os tres geradores diziam "nao consegui ler" tambem de JSON quebrado (a regra
// do validar.js:12-13 separa ler de interpretar), e o gerar-agentes estourava em TypeError com respostas `null`.
test('A4-mol-1: lerRespostas separa ler de interpretar e recusa o que nao e objeto', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn respostas-'));
  const em = (nome, conteudo) => { const p = path.join(dir, nome); fs.writeFileSync(p, conteudo, 'utf8'); return p; };
  const faltando = path.join(dir, 'nao-existe.json');
  let r = molde.lerRespostas(faltando);
  assert.strictEqual(r.ok, false);
  assert.ok(r.erro.startsWith('nao consegui ler ' + faltando + ': '), r.erro);
  r = molde.lerRespostas(em('quebrado.json', '{"a": '));
  assert.strictEqual(r.ok, false);
  assert.ok(/quebrado\.json nao e JSON valido: /.test(r.erro), r.erro);
  [['nulo.json', 'null', 'nulo'], ['lista.json', '[1]', 'lista'], ['numero.json', '5', 'number']].forEach(([n, c, tipo]) => {
    const x = molde.lerRespostas(em(n, c));
    assert.strictEqual(x.ok, false, n);
    assert.ok(x.erro.indexOf(n + ' tem de ser um objeto JSON') !== -1 && x.erro.indexOf('veio ' + tipo) !== -1, x.erro);
  });
  r = molde.lerRespostas(em('bom.json', '{"slug": "x"}'));
  assert.deepStrictEqual(r, { ok: true, valores: { slug: 'x' } });
  fs.rmSync(dir, { recursive: true, force: true });
});

// A4-mol-2 (pedido 12, R2 borda): o arquivo de respostas com BOM (o Out-File do PowerShell 5.1 grava assim) saia como
// "nao e JSON valido" com o conteudo valido. O BOM sai antes do parse, como no lerJson do ambiente.js (A4-01).
test('A4-mol-2: lerRespostas aceita o arquivo de respostas com BOM', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn respostas-'));
  const p = path.join(dir, 'com-bom.json');
  fs.writeFileSync(p, '\uFEFF{"slug": "x"}', 'utf8');
  assert.deepStrictEqual(molde.lerRespostas(p), { ok: true, valores: { slug: 'x' } });
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── gerar-skill.js, exercido como processo (so tinha o teste de fiacao sem projeto.json) ──
function projetoParaSkill() {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn gerar-skill-'));
  fs.mkdirSync(path.join(raiz, '.claude', 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(raiz, '.claude', 'sworn', 'projeto.json'), JSON.stringify({
    versaoConfig: 1, geradoEm: '2026-09-23', plataforma: { so: 'linux', shell: 'bash' },
    modeloDeAmeaca: 'interno', provaDePronto: 'npm test', quemDecide: 'dono', fontesCanonicas: [], intocaveis: [],
    marchaPadrao: 'padrao', marchas: { aaa: [], padrao: [], rapida: [] }, comandosBloqueados: [], comandosLiberados: [],
    travas: { fecho: true, escopo: true, destrutivo: true, outraFrente: true }, limiares: {}, agentes: { escada: [] }
  }), 'utf8');
  const texto = fs.readFileSync(path.join(__dirname, '..', 'modelos', 'skill-projeto.md'), 'utf8');
  const valores = {};
  for (const s of molde.slots(texto)) {
    if (s.tipo === 'texto') valores[s.nome] = 'conteudo de ensaio para ' + s.nome;
  }
  fs.writeFileSync(path.join(raiz, 'respostas.json'), JSON.stringify(valores), 'utf8');
  return raiz;
}

function gerarSkill(raiz, args) {
  const path = require('node:path');
  return require('node:child_process').spawnSync(process.execPath,
    [path.join(__dirname, '..', 'scripts', 'gerar-skill.js')].concat(args), { cwd: raiz, encoding: 'utf8', timeout: 60000 });
}

// A4-gsk-1 (pedido 12, borda+microcopy): `--respostas` sem valor caia calado no "sem respostas" (RECUSADA por fatia
// vazia), e JSON quebrado saia como "nao consegui ler". Agora erro de uso que nomeia a flag, e a frase do lerRespostas.
test('A4-gsk-1: gerar-skill com --respostas sem valor e erro de uso; JSON quebrado nao e "nao consegui ler"', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const raiz = projetoParaSkill();
  [['--respostas'], ['--respostas', ''], ['--respostas', '--gravar']].forEach((args) => {
    const r = gerarSkill(raiz, args);
    assert.strictEqual(r.status, 1, args.join(' ') + ': ' + r.stdout + r.stderr);
    assert.ok(/--respostas pede um valor/.test(r.stdout) && /uso: gerar-skill\.js/.test(r.stdout), r.stdout);
    assert.strictEqual(fs.existsSync(path.join(raiz, '.claude', 'skills')), false, args.join(' ') + ': gravou');
  });
  fs.writeFileSync(path.join(raiz, 'quebrado.json'), '{"slug": ', 'utf8');
  assert.ok(/ERRO: quebrado\.json nao e JSON valido/.test(gerarSkill(raiz, ['--respostas', 'quebrado.json']).stdout));
  fs.rmSync(raiz, { recursive: true, force: true });
});

// A4-gsk-2 (pedido 12, estados): mkdir e write sem try - a pasta da skill que nao se cria saia em excecao crua, sem
// GRAVADA nem ERRO. Agora ERRO com a causa e saida 1.
test('A4-gsk-2: skill que nao se grava sai com a causa e saida 1, sem excecao crua', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const raiz = projetoParaSkill();
  fs.writeFileSync(path.join(raiz, '.claude', 'skills'), 'sou arquivo\n', 'utf8');
  const r = gerarSkill(raiz, ['--respostas', 'respostas.json', '--gravar']);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(/ERRO: nao consegui gravar .*SKILL\.md \(.*\(E[A-Z]+\)\)/.test(r.stdout), r.stdout);
  assert.strictEqual(/\n\s+at /.test(r.stderr), false, 'excecao crua: ' + r.stderr);
  assert.strictEqual(r.stdout.indexOf('GRAVADA'), -1, r.stdout);
  fs.rmSync(raiz, { recursive: true, force: true });
});

// A4-gsk-3 (pedido 12, R2 estados): a SKILL.md que aparece entre o existsSync e o write (outro processo) era
// sobrescrita - o write usava a flag 'w'. O --require faz o existsSync nao ver a skill que ja esta la.
test('A4-gsk-3: skill que aparece entre a conferencia e a escrita nao e sobrescrita', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const raiz = projetoParaSkill();
  const alvo = /Destino seria: (.*)\n/.exec(gerarSkill(raiz, ['--respostas', 'respostas.json']).stdout)[1];
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, 'skill do dono\n', 'utf8');
  const cego = path.join(raiz, 'cego.js');
  fs.writeFileSync(cego, "const fs = require('fs'); const e = fs.existsSync;\n" +
    "fs.existsSync = function (p) {\n  return /SKILL\.md$/.test(String(p)) ? false : e.apply(fs, arguments);\n};\n",
    'utf8');
  const r = require('node:child_process').spawnSync(process.execPath, ['--require', cego,
    path.join(__dirname, '..', 'scripts', 'gerar-skill.js'), '--respostas', 'respostas.json', '--gravar'],
    { cwd: raiz, encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(/\(ja existe \(EEXIST\)\)/.test(r.stdout), r.stdout);
  assert.strictEqual(fs.readFileSync(alvo, 'utf8'), 'skill do dono\n', 'sobrescreveu');
  fs.rmSync(raiz, { recursive: true, force: true });
});
