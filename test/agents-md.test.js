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
