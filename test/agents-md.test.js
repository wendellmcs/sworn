'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const molde = require('../scripts/lib/molde.js');

const RAIZ = path.join(__dirname, '..');
const MOLDE = path.join(RAIZ, 'modelos', 'agents-md.md');
const GERADOR = path.join(RAIZ, 'scripts', 'gerar-agents-md.js');

const PROJETO = {
  versaoConfig: 1, geradoEm: '2026-09-23',
  plataforma: { so: 'linux', shell: 'bash' },
  modeloDeAmeaca: 'interno', provaDePronto: 'comando de ensaio', quemDecide: 'dono',
  fontesCanonicas: [], intocaveis: [], marchaPadrao: 'padrao',
  marchas: { aaa: [], padrao: [], rapida: [] },
  comandosBloqueados: [], comandosLiberados: [],
  travas: { fecho: true, escopo: true, destrutivo: true, outraFrente: true },
  limiares: {}, agentes: { escada: [] }
};

function preenchido() {
  const texto = fs.readFileSync(MOLDE, 'utf8');
  const valores = {};
  for (const s of molde.slots(texto)) {
    if (s.tipo === 'texto') valores[s.nome] = 'conteudo de ensaio para ' + s.nome;
  }
  return molde.preencher(texto, valores, PROJETO);
}

test('agents-md: o molde preenche e valida', () => {
  const r = molde.validar(preenchido());
  assert.strictEqual(r.ok, true, r.erros.join(' | '));
});

// Spec §3: guarde o metodo, nunca o resultado. O AGENTS.md que CRAVA o comando
// de teste mente no dia em que o projeto trocar de comando - e ninguem percebe.
test('agents-md: aponta para o campo, nao copia o valor', () => {
  const cheio = preenchido();
  assert.ok(cheio.includes('projeto.json'), 'tem de mandar ler do projeto.json');
  assert.ok(!cheio.includes('comando de ensaio'), 'o valor nao pode estar cravado no texto');
});

test('agents-md: nenhum fato volatil no molde', () => {
  const regra = require('../scripts/lib/regra.js');
  const texto = fs.readFileSync(MOLDE, 'utf8');
  const sujos = [];
  for (const linha of texto.split('\n')) {
    for (const vol of regra.VOLATEIS) {
      if (vol.re.test(linha)) sujos.push(vol.tipo + ': ' + linha.trim().slice(0, 60));
    }
  }
  assert.deepStrictEqual(sujos, []);
});

function pastaComProjeto(t) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn agents-'));
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
  const dir = path.join(raiz, '.claude', 'sworn');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'projeto.json'), JSON.stringify(PROJETO, null, 2), 'utf8');
  return raiz;
}

function respostasEmArquivo(raiz) {
  const texto = fs.readFileSync(MOLDE, 'utf8');
  const valores = {};
  for (const s of molde.slots(texto)) {
    if (s.tipo === 'texto') valores[s.nome] = 'conteudo de ensaio para ' + s.nome;
  }
  const alvo = path.join(raiz, 'respostas.json');
  fs.writeFileSync(alvo, JSON.stringify(valores), 'utf8');
  return alvo;
}

function rodar(raiz, args) {
  return spawnSync(process.execPath, [GERADOR].concat(args || []), { cwd: raiz, encoding: 'utf8' });
}

test('agents-md: sem --gravar propoe e nao escreve', (t) => {
  const raiz = pastaComProjeto(t);
  const r = rodar(raiz, ['--respostas', respostasEmArquivo(raiz)]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes('PROPOSTA'), r.stdout);
  assert.strictEqual(fs.existsSync(path.join(raiz, 'AGENTS.md')), false);
});

test('agents-md: com --gravar escreve na raiz do projeto', (t) => {
  const raiz = pastaComProjeto(t);
  const r = rodar(raiz, ['--respostas', respostasEmArquivo(raiz), '--gravar']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(path.join(raiz, 'AGENTS.md')), r.stdout);
});

// Muitos projetos ja tem um. Sobrescrever apaga trabalho de meses.
test('agents-md: AGENTS.md que ja existe nao e tocado', (t) => {
  const raiz = pastaComProjeto(t);
  const alvo = path.join(raiz, 'AGENTS.md');
  fs.writeFileSync(alvo, '# o AGENTS.md de alguem\n', 'utf8');
  const r = rodar(raiz, ['--respostas', respostasEmArquivo(raiz), '--gravar']);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.strictEqual(fs.readFileSync(alvo, 'utf8'), '# o AGENTS.md de alguem\n');
});

test('agents-md: sem projeto.json para com erro legivel', (t) => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn vazio-'));
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
  const r = rodar(raiz, ['--respostas', respostasEmArquivo(raiz), '--gravar']);
  assert.strictEqual(r.status, 1);
  assert.ok(r.stdout.includes('init'), r.stdout);
});

test('agents-md: sem respostas o gerador recusa e nomeia a fatia que falta', (t) => {
  const raiz = pastaComProjeto(t);
  const r = rodar(raiz, []);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.ok(r.stdout.includes('RECUSADO'), r.stdout);
  assert.ok(r.stdout.includes('comoSeTrabalha'), r.stdout);
  assert.strictEqual(fs.existsSync(path.join(raiz, 'AGENTS.md')), false);
});

// A4-10 (pedido 12, microcopy): o RECUSADO dizia "nao passou no validador" e nao dizia onde corrigir.
test('A4-10: o RECUSADO diz o que houve, sem "validador", e onde corrigir', (t) => {
  const raiz = pastaComProjeto(t);
  const sem = rodar(raiz, []);
  assert.strictEqual(sem.status, 1, sem.stdout);
  assert.ok(sem.stdout.startsWith('RECUSADO: o AGENTS.md gerado tem pendencias, e nada foi gravado:\n'), sem.stdout);
  assert.ok(!sem.stdout.includes('validador'), sem.stdout);
  assert.ok(sem.stdout.endsWith('Passe as respostas com --respostas <arquivo.json>, uma chave por fatia' +
    ' (os nomes saem com --fatias).\n'), sem.stdout);
  const arq = respostasEmArquivo(raiz);
  const valores = JSON.parse(fs.readFileSync(arq, 'utf8'));
  valores.comoSeTrabalha = '';
  fs.writeFileSync(arq, JSON.stringify(valores), 'utf8');
  const com = rodar(raiz, ['--respostas', arq]);
  assert.strictEqual(com.status, 1, com.stdout);
  assert.ok(com.stdout.endsWith('Corrija ' + arq + ' e rode de novo.\n'), com.stdout);
});

// A4-gam-1 (pedido 12, borda+microcopy): `--respostas` sem valor caia calado no "sem respostas", e JSON quebrado
// saia como "nao consegui ler". Agora erro de uso que nomeia a flag, e a frase do lerRespostas do molde.js.
test('A4-gam-1: --respostas sem valor e erro de uso; JSON quebrado nao e "nao consegui ler"', (t) => {
  const raiz = pastaComProjeto(t);
  [['--respostas'], ['--respostas', ''], ['--respostas', '--gravar']].forEach((args) => {
    const r = spawnSync(process.execPath, [GERADOR].concat(args), { cwd: raiz, encoding: 'utf8', timeout: 60000 });
    assert.strictEqual(r.status, 1, args.join(' ') + ': ' + r.stdout + r.stderr);
    assert.ok(/--respostas pede um valor/.test(r.stdout) && /uso: gerar-agents-md\.js/.test(r.stdout), r.stdout);
    assert.strictEqual(fs.existsSync(path.join(raiz, 'AGENTS.md')), false, args.join(' ') + ': gravou');
  });
  fs.writeFileSync(path.join(raiz, 'quebrado.json'), '{"x": ', 'utf8');
  const r = spawnSync(process.execPath, [GERADOR, '--respostas', 'quebrado.json'], { cwd: raiz, encoding: 'utf8', timeout: 60000 });
  assert.ok(/ERRO: quebrado\.json nao e JSON valido/.test(r.stdout), r.stdout);
});

// A4-gam-2 (pedido 12, estados): o write do AGENTS.md sem try saia em excecao crua, sem GRAVADO nem ERRO. O --require
// faz a gravacao falhar com EACCES no processo filho (a raiz do projeto nao tem pasta-mae que se possa trocar).
test('A4-gam-2: AGENTS.md que nao se grava sai com a causa e saida 1, sem excecao crua', (t) => {
  const raiz = pastaComProjeto(t);
  const falha = path.join(raiz, 'falha.js');
  fs.writeFileSync(falha, "const fs = require('fs'); const w = fs.writeFileSync;\n" +
    "fs.writeFileSync = function (p) { if (/AGENTS\.md$/.test(String(p))) { const e = new Error('negado'); " +
    "e.code = 'EACCES'; throw e; } return w.apply(fs, arguments); };\n", 'utf8');
  const r = spawnSync(process.execPath, ['--require', falha, GERADOR, '--respostas', respostasEmArquivo(raiz), '--gravar'],
    { cwd: raiz, encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(/ERRO: nao consegui gravar .*AGENTS\.md \(sem permissao \(EACCES\)\)/.test(r.stdout), r.stdout);
  assert.strictEqual(/\n\s+at /.test(r.stderr), false, 'excecao crua: ' + r.stderr);
  assert.strictEqual(r.stdout.indexOf('GRAVADO'), -1, r.stdout);
});

// A4-gam-3 (pedido 12, R2 da A4, estados - a classe do A4-gsk-3): o AGENTS.md que aparece entre o existsSync e o write
// era sobrescrito (flag 'w'). O --require faz o existsSync nao ver o AGENTS.md que ja esta la.
test('A4-gam-3: AGENTS.md que aparece entre a conferencia e a escrita nao e sobrescrito', (t) => {
  const raiz = pastaComProjeto(t);
  const alvo = path.join(raiz, 'AGENTS.md');
  fs.writeFileSync(alvo, 'trabalho de meses\n', 'utf8');
  const cego = path.join(raiz, 'cego.js');
  fs.writeFileSync(cego, "const fs = require('fs'); const e = fs.existsSync;\n" +
    "fs.existsSync = function (p) {\n  return /AGENTS\.md$/.test(String(p)) ? false : e.apply(fs, arguments);\n};\n",
    'utf8');
  const r = spawnSync(process.execPath, ['--require', cego, GERADOR, '--respostas', respostasEmArquivo(raiz), '--gravar'],
    { cwd: raiz, encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(/\(ja existe \(EEXIST\)\)/.test(r.stdout), r.stdout);
  assert.strictEqual(fs.readFileSync(alvo, 'utf8'), 'trabalho de meses\n', 'sobrescreveu');
});
