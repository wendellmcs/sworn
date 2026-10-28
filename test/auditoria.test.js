'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const aud = require('../scripts/lib/auditoria.js');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'auditar.js');

// ---------------------------------------------------------------- memoria (item 3 da 0.3.4, D288)
// Fixture em pasta temporaria criada pelo teste. Nunca o MEMORY.md real.

function pasta(nome) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-auditoria-' + nome + '-'));
}

/** Grava um MEMORY.md de brinquedo e devolve o caminho (Buffer ou texto, sem tocar em mais nada). */
function memoria(dir, conteudo) {
  const alvo = path.join(dir, 'MEMORY.md');
  fs.writeFileSync(alvo, conteudo);
  return alvo;
}

/** n linhas, cada uma com `largura` caracteres ASCII, todas terminadas em \n. */
function linhas(n, largura) {
  const out = [];
  for (let i = 0; i < n; i++) out.push('x'.repeat(largura));
  return out.join('\n') + '\n';
}

test('auditoria: duas skills com o mesmo gatilho sao apontadas', () => {
  const r = aud.sobreposicoes([
    { nome: 'revisar', descricao: 'Use quando for revisar codigo antes de fechar' },
    { nome: 'code-review', descricao: 'Use quando precisar revisar codigo do diff' },
    { nome: 'deploy', descricao: 'Use quando for publicar em producao' }
  ]);
  assert.strictEqual(r.length, 1);
  assert.ok(r[0].termos.includes('revisar'));
});

test('auditoria: skills sem termo em comum nao sao apontadas', () => {
  assert.strictEqual(aud.sobreposicoes([
    { nome: 'a', descricao: 'Use quando for publicar em producao' },
    { nome: 'b', descricao: 'Use quando precisar desenhar um grafico' }
  ]).length, 0);
});

test('auditoria: palavra vazia nao conta como sobreposicao', () => {
  assert.strictEqual(aud.sobreposicoes([
    { nome: 'a', descricao: 'Use quando o usuario pedir para fazer uma coisa no projeto' },
    { nome: 'b', descricao: 'Use quando o usuario pedir para ver outra coisa no projeto' }
  ]).length, 0);
});

// D396/D398 (#10a): o unico "sim" da bateria da 2b-1 (descricoes de la; o nome do workspace trocado).
test('auditoria: #10a - padrao x padrao-aaa (o "sim" da bateria) segue apontado, mesmo so com as duas skills', () => {
  const r = aud.sobreposicoes([
    { nome: 'padrao', descricao: 'Manual de execucao portatil para qualquer projeto. Use no inicio de toda tarefa que nao seja conversa pura - implementar, corrigir bug, planejar, revisar, auditar, mexer em UI, escrever doc, versionar, publicar, executar plano longo. Define a marcha de rigor (Rapida/Padrao/AAA), as lentes de inspecao (nove de codigo e oito de tela), o loop de julgamento cego com teto de rondas, os gatilhos contaveis de troca de chat, o formato obrigatorio de decisao do dono e o que um "pronto" precisa provar.' },
    { nome: 'padrao-aaa', descricao: 'Manual de execucao obrigatorio deste workspace. Use no inicio de toda tarefa que nao seja conversa pura - implementar, corrigir bug, planejar, revisar, auditar, mexer em UI/CSS, escrever doc, versionar, publicar, executar plano longo. Define a marcha de rigor (Rapida/Padrao/AAA), o roteamento de agentes por custo, os oito portoes de qualidade visual e de codigo, o loop de inspecao cega com teto de rondas, os gatilhos contaveis de troca de chat e o formato obrigatorio de decisao do dono.' }
  ]);
  assert.strictEqual(r.length, 1);
  assert.ok(r[0].termos.length >= 20, 'termos em comum: ' + r[0].termos.length);
});

test('auditoria: #10a - 2 termos em comum com Jaccard baixo (< 0,20) nao sao sobreposicao', () => {
  // a = {revisar, codigo, fechar, sprint, tarefa, prazo}; b = os mesmos 2 + {gerar, grafico, barras, legenda, eixos}
  // comuns 2, todos 11: Jaccard 0,18, abaixo do corte de 0,20 (hoje 1 termo bastava para apontar).
  assert.strictEqual(aud.sobreposicoes([
    { nome: 'a', descricao: 'revisar codigo fechar sprint tarefa prazo' },
    { nome: 'b', descricao: 'revisar codigo gerar grafico barras legenda eixos' }
  ]).length, 0);
  // o mesmo par sem o termo a mais: 2/10 = 0,20, no corte, e apontado
  assert.strictEqual(aud.sobreposicoes([
    { nome: 'a', descricao: 'revisar codigo fechar sprint tarefa prazo' },
    { nome: 'b', descricao: 'revisar codigo gerar grafico barras legenda' }
  ]).length, 1);
});

test('auditoria: #10a - 1 termo em comum nao e sobreposicao, nem com Jaccard alto', () => {
  assert.strictEqual(aud.sobreposicoes([
    { nome: 'a', descricao: 'revisar' },
    { nome: 'b', descricao: 'revisar' }
  ]).length, 0);
});

test('auditoria: mesmo gatilho com acoes diferentes e contradicao', () => {
  const r = aud.contradicoes([
    { gatilho: 'ao fechar tarefa', acao: 'colar a saida do comando' },
    { gatilho: 'ao fechar tarefa', acao: 'resumir sem colar saida' },
    { gatilho: 'ao editar', acao: 'rodar git status' }
  ]);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].acoes.length, 2);
});

test('auditoria: mesmo gatilho com a MESMA acao e duplicata, nao contradicao', () => {
  const r = aud.contradicoes([
    { gatilho: 'ao editar', acao: 'rodar git status' },
    { gatilho: 'ao editar', acao: 'rodar git status' }
  ]);
  assert.strictEqual(r.length, 0);
});

test('auditoria: gatilho comparado sem caixa e sem acento sobrando', () => {
  const r = aud.contradicoes([
    { gatilho: 'Ao Fechar Tarefa', acao: 'x' },
    { gatilho: 'ao fechar tarefa', acao: 'y' }
  ]);
  assert.strictEqual(r.length, 1);
});

test('memoria: arquivo abaixo dos dois limites cabe inteiro e nada fica de fora', () => {
  const dir = pasta('abaixo');
  try {
    // 71 linhas terminadas em \n = 71 linhas, nao 72 (a linha vazia depois do ultimo \n nao e linha).
    const texto = linhas(71, 9);
    const m = aud.medirMemoria(memoria(dir, texto));
    assert.strictEqual(m.medida, true);
    assert.strictEqual(m.linhas, 71);
    assert.strictEqual(m.bytes, 71 * 10);
    assert.strictEqual(m.cabe, true);
    assert.strictEqual(m.primeiro, null);
    assert.deepStrictEqual(m.foraDaCarga, { linhas: 0, bytes: 0 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('memoria: fronteira exata (200 linhas, 25.000 bytes) ainda cabe; uma a mais nao', () => {
  const dir = pasta('fronteira');
  try {
    // 200 linhas de 124 chars + \n = 25.000 bytes exatos.
    const no = aud.medirMemoria(memoria(dir, linhas(200, 124)));
    assert.strictEqual(no.bytes, 25000);
    assert.strictEqual(no.linhas, 200);
    assert.strictEqual(no.cabe, true);
    assert.deepStrictEqual(no.foraDaCarga, { linhas: 0, bytes: 0 });
    const alem = aud.medirMemoria(memoria(dir, linhas(201, 1)));
    assert.strictEqual(alem.cabe, false);
    assert.strictEqual(alem.foraDaCarga.linhas, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('memoria: acima de 200 linhas diz quantas ficam de fora, e que foram as linhas que vieram primeiro', () => {
  const dir = pasta('linhas');
  try {
    const m = aud.medirMemoria(memoria(dir, linhas(250, 1)));
    assert.strictEqual(m.linhas, 250);
    assert.strictEqual(m.bytes, 500);
    assert.strictEqual(m.cabe, false);
    assert.strictEqual(m.primeiro, 'linhas');
    // 0.3.5 (H): as duas medidas saem do mesmo corte; cortou por linhas, os bytes de fora sao os da linha 201 em diante (500 - 400).
    assert.deepStrictEqual(m.foraDaCarga, { linhas: 50, bytes: 100 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('memoria: acima de 25.000 bytes com menos de 200 linhas diz quantos bytes ficam de fora', () => {
  const dir = pasta('bytes');
  try {
    const m = aud.medirMemoria(memoria(dir, linhas(50, 600)));
    assert.strictEqual(m.linhas, 50);
    assert.strictEqual(m.bytes, 50 * 601);
    assert.strictEqual(m.cabe, false);
    assert.strictEqual(m.primeiro, 'bytes');
    // 0.3.5 (H): cortou por bytes, as linhas de fora sao as que nao cabem inteiras: 41 cabem, a 42a e cortada no meio (50 - 41).
    assert.deepStrictEqual(m.foraDaCarga, { linhas: 9, bytes: 50 * 601 - 25000 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('memoria: estourando os dois, "primeiro" e o limite que corta antes', () => {
  const dir = pasta('ambos');
  try {
    // 300 linhas de 100 bytes: a linha 201 comeca no byte 20.200 (antes de 25.000) -> linhas primeiro.
    const a = aud.medirMemoria(memoria(dir, linhas(300, 100)));
    assert.strictEqual(a.primeiro, 'linhas');
    // 0.3.5 (H): cortou por linhas -> bytes de fora = os da linha 201 (byte 20.200) em diante.
    assert.deepStrictEqual(a.foraDaCarga, { linhas: 100, bytes: 300 * 101 - 20200 });
    // 300 linhas de 200 bytes: a linha 201 comeca no byte 40.200 (depois de 25.000) -> bytes primeiro.
    const b = aud.medirMemoria(memoria(dir, linhas(300, 200)));
    assert.strictEqual(b.primeiro, 'bytes');
    // 0.3.5 (H): cortou por bytes -> cabem 124 linhas inteiras nos 25.000 bytes; as outras 176 ficam de fora.
    assert.deepStrictEqual(b.foraDaCarga, { linhas: 300 - 124, bytes: 300 * 201 - 25000 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('memoria: maior linha traz o numero (base 1) e os bytes UTF-8, nao os caracteres', () => {
  const dir = pasta('maior');
  try {
    // linha 3 = a, c-cedilha, a-til, o (4 caracteres, 6 bytes em UTF-8); as outras tem 3, 2 e 1 byte.
    const m = aud.medirMemoria(memoria(dir, Buffer.from('abc\nde\na\u00e7\u00e3o\nf\n', 'utf8')));
    assert.strictEqual(m.linhas, 4);
    assert.deepStrictEqual(m.maiorLinha, { numero: 3, bytes: 6 });
    assert.strictEqual(m.bytes, 4 + 3 + 7 + 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('memoria: CRLF, sem \\n final e arquivo vazio contam certo', () => {
  const dir = pasta('bordas');
  try {
    const crlf = aud.medirMemoria(memoria(dir, 'a\r\nbb\r\nccc\r\n'));
    assert.strictEqual(crlf.linhas, 3);
    assert.strictEqual(crlf.bytes, 12, 'o \\r conta nos bytes do arquivo');
    assert.deepStrictEqual(crlf.maiorLinha, { numero: 3, bytes: 3 }, 'o \\r nao conta na linha');
    const semFinal = aud.medirMemoria(memoria(dir, 'a\nb'));
    assert.strictEqual(semFinal.linhas, 2);
    const vazio = aud.medirMemoria(memoria(dir, ''));
    assert.strictEqual(vazio.medida, true);
    assert.strictEqual(vazio.linhas, 0);
    assert.strictEqual(vazio.cabe, true);
    assert.deepStrictEqual(vazio.maiorLinha, { numero: 0, bytes: 0 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('memoria: os limites e a leitura de "25 KB" vao declarados na propria saida', () => {
  const dir = pasta('declara');
  try {
    const m = aud.medirMemoria(memoria(dir, linhas(3, 3)));
    assert.strictEqual(m.limite.linhas, 200);
    assert.strictEqual(m.limite.bytes, 25000);
    assert.ok(/25\.000/.test(m.limite.nota) && /25\.600/.test(m.limite.nota),
      'a nota tem de dizer que 25 KB foi lido como 25.000 e que podia ser 25.600: ' + m.limite.nota);
    assert.ok(/memory\.md/.test(m.limite.fonte), 'a fonte (doc oficial) vai ao lado do numero');
    assert.ok(m.metodo.length > 0, 'numero sem metodo e opiniao');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('memoria: sem caminho diz "nao medida" e a causa, nunca some calada', () => {
  for (const vazio of [undefined, null, '']) {
    const m = aud.medirMemoria(vazio);
    assert.strictEqual(m.medida, false);
    assert.strictEqual(m.causa, 'sem-caminho');
    assert.ok(/nao medida/.test(m.motivo) && /--memoria/.test(m.motivo), m.motivo);
    assert.strictEqual(m.linhas, undefined, 'nao medida nao inventa numero');
  }
});

test('memoria: caminho que nao se le diz "nao medida" com o codigo do erro', () => {
  const dir = pasta('ilegivel');
  try {
    const falta = path.join(dir, 'nao-existe', 'MEMORY.md');
    const m = aud.medirMemoria(falta);
    assert.strictEqual(m.medida, false);
    assert.strictEqual(m.causa, 'ENOENT');
    assert.strictEqual(m.caminho, falta);
    assert.ok(/nao medida/.test(m.motivo) && /ENOENT/.test(m.motivo), m.motivo);
    // T4: o aviso diz o proximo passo, na mesma frase
    assert.ok(/confira o caminho passado em --memoria/.test(m.motivo), m.motivo);
    // pasta no lugar do arquivo: outro codigo, mesma regra.
    const pastaNoLugar = aud.medirMemoria(dir);
    assert.strictEqual(pastaNoLugar.medida, false);
    assert.ok(/^E[A-Z]+$/.test(pastaNoLugar.causa), pastaNoLugar.causa);
    assert.notStrictEqual(pastaNoLugar.causa, 'ENOENT');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('memoria: o teto de 200 e o mesmo com e sem memoria (ela nao soma)', () => {
  const dir = pasta('teto');
  try {
    fs.mkdirSync(path.join(dir, '.claude', 'skills', 'zelador'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'skills', 'zelador', 'SKILL.md'),
      '---\nname: zelador\ndescription: varre a casa\n---\n\n- um item\n- outro item\n');
    // memoria cheia de itens de lista: se somasse no teto, o total mudaria.
    const arq = memoria(dir, '- item\n'.repeat(300));
    const sem = aud.auditar(dir, {});
    const com = aud.auditar(dir, {}, { memoria: arq });
    assert.deepStrictEqual(com.peso, sem.peso);
    assert.strictEqual(com.peso.total, 2);
    assert.strictEqual(com.peso.estourou, false);
    assert.strictEqual(com.memoria.medida, true);
    assert.strictEqual(com.memoria.linhas, 300);
    assert.strictEqual(sem.memoria.medida, false, 'sem o argumento a chave existe e diz nao medida');
    assert.ok(!com.peso.porArquivo.some(function (p) { return /MEMORY/.test(p.arquivo); }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('memoria: auditar.js --memoria mede; sem o argumento, ou com ele vazio, diz nao medida', () => {
  const dir = pasta('cli');
  try {
    const arq = memoria(dir, linhas(10, 4));
    const rodar = function (args) {
      const r = spawnSync(process.execPath, [SCRIPT].concat(args), { cwd: dir, encoding: 'utf8' });
      assert.strictEqual(r.status, 0, r.stderr);
      return JSON.parse(r.stdout);
    };
    const com = rodar(['--memoria', arq]);
    assert.strictEqual(com.memoria.medida, true);
    assert.strictEqual(com.memoria.linhas, 10);
    // caminho relativo e resolvido contra a pasta do processo
    assert.strictEqual(rodar(['--memoria', 'MEMORY.md']).memoria.linhas, 10);
    const sem = rodar([]);
    assert.strictEqual(sem.memoria.medida, false);
    assert.strictEqual(sem.memoria.causa, 'sem-caminho');
    const semValor = rodar(['--memoria']);
    assert.strictEqual(semValor.memoria.medida, false);
    assert.strictEqual(semValor.memoria.causa, 'sem-caminho');
    const falta = rodar(['--memoria', path.join(dir, 'nada.md')]);
    assert.strictEqual(falta.memoria.causa, 'ENOENT');
    assert.deepStrictEqual(com.peso, sem.peso, 'o peso nao muda com a memoria');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- 0.3.5 T3: a auditoria que nao cala
// Cada teste abaixo foi escrito antes da mudanca e visto falhar contra o codigo da 0.3.4.

function regrasMd(dir, conteudo) {
  const alvo = path.join(dir, '.claude', 'sworn', 'regras.md');
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, conteudo);
  return alvo;
}

/** Roda `fn` com fs.readFileSync trocado por uma versao que falha com `codigo` so para o MEMORY.md. */
function comLeituraQueFalha(codigo, fn) {
  const original = fs.readFileSync;
  fs.readFileSync = function (p) {
    if (/MEMORY\.md$/.test(String(p))) { const e = new Error(codigo); e.code = codigo; throw e; }
    return original.apply(fs, arguments);
  };
  try { return fn(); } finally { fs.readFileSync = original; }
}

test('regras (A): regras.md lido diz lidas e o total; contradicoes segue existindo', () => {
  const dir = pasta('regras-lidas');
  try {
    regrasMd(dir, '- ao fechar tarefa -> colar a saida\n- ao fechar tarefa -> resumir\n- ao editar -> rodar git status\nprosa solta -> sem item de lista\n');
    const r = aud.auditar(dir, {});
    assert.deepStrictEqual(r.regras, { lidas: true, total: 3 });
    assert.strictEqual(r.contradicoes.length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('regras (A): sem regras.md diz "nao lidas" com ENOENT e o motivo, sem ser erro', () => {
  const dir = pasta('regras-ausente');
  try {
    const r = aud.auditar(dir, {});
    assert.strictEqual(r.regras.lidas, false);
    assert.strictEqual(r.regras.causa, 'ENOENT');
    assert.ok(/regras\.md/.test(r.regras.motivo), r.regras.motivo);
    assert.ok(!/erro/i.test(r.regras.motivo), 'ausencia nao e erro: ' + r.regras.motivo);
    // T4 (ronda 1, microcopy): o motivo diz o que fazer, nao so o que nao rodou.
    assert.ok(/\/sworn:init/.test(r.regras.motivo), 'faltou dizer o que fazer: ' + r.regras.motivo);
    assert.deepStrictEqual(r.contradicoes, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('regras (A): regras.md que existe e nao se le diz "nao lidas" com o codigo, e nao vira "nenhuma contradicao" calada', () => {
  const dir = pasta('regras-ilegivel');
  try {
    // uma pasta no lugar do arquivo: existe, e nao se le (EISDIR, nao ENOENT)
    fs.mkdirSync(path.join(dir, '.claude', 'sworn', 'regras.md'), { recursive: true });
    const r = aud.auditar(dir, {});
    assert.strictEqual(r.regras.lidas, false);
    assert.strictEqual(r.regras.causa, 'EISDIR');
    assert.ok(/EISDIR/.test(r.regras.motivo) && /regras\.md/.test(r.regras.motivo), r.regras.motivo);
    assert.ok(/rode \/sworn:audit de novo/.test(r.regras.motivo), 'faltou dizer o que fazer: ' + r.regras.motivo);
    assert.deepStrictEqual(r.contradicoes, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('regras (A): auditar.js tambem traz a chave regras', () => {
  const dir = pasta('regras-cli');
  try {
    regrasMd(dir, '- ao editar -> rodar git status\n');
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(JSON.parse(r.stdout).regras, { lidas: true, total: 1 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('memoria (F): a dica do erro depende do codigo (caminho, pasta, permissao)', () => {
  const dir = pasta('dica');
  try {
    const enoent = aud.medirMemoria(path.join(dir, 'nada', 'MEMORY.md'));
    assert.ok(/confira o caminho/.test(enoent.motivo), enoent.motivo);
    const pastaNoLugar = aud.medirMemoria(dir);
    assert.strictEqual(pastaNoLugar.causa, 'EISDIR');
    assert.ok(/e uma pasta/.test(pastaNoLugar.motivo) && /passe o arquivo/.test(pastaNoLugar.motivo), pastaNoLugar.motivo);
    assert.ok(!/confira o caminho/.test(pastaNoLugar.motivo), 'pasta nao e "caminho errado": ' + pastaNoLugar.motivo);
    for (const codigo of ['EACCES', 'EPERM']) {
      const m = comLeituraQueFalha(codigo, function () { return aud.medirMemoria(path.join(dir, 'MEMORY.md')); });
      assert.strictEqual(m.causa, codigo);
      assert.ok(/permissao/.test(m.motivo), codigo + ': ' + m.motivo);
      assert.ok(!/confira o caminho/.test(m.motivo), codigo + ' nao e caminho errado: ' + m.motivo);
    }
    const enotdir = comLeituraQueFalha('ENOTDIR', function () { return aud.medirMemoria(path.join(dir, 'MEMORY.md')); });
    assert.ok(/confira o caminho/.test(enotdir.motivo), enotdir.motivo);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('memoria (G): opcoes.memoria que nao e texto vira "nao medida" com caminho-invalido, nunca o caminho "true"', () => {
  const dir = pasta('naotexto');
  try {
    // um arquivo chamado "true" na pasta: se true virasse o caminho, ele seria lido e medido
    fs.writeFileSync(path.join(dir, 'true'), 'x\n');
    for (const invalido of [true, 5, {}, ['MEMORY.md']]) {
      const m = aud.auditar(dir, {}, { memoria: invalido }).memoria;
      assert.strictEqual(m.medida, false, JSON.stringify(invalido));
      assert.strictEqual(m.causa, 'caminho-invalido', JSON.stringify(invalido));
      assert.ok(/nao medida/.test(m.motivo) && /--memoria/.test(m.motivo), m.motivo);
    }
    // o que ja valia segue valendo: vazio = sem-caminho, texto = mede
    assert.strictEqual(aud.auditar(dir, {}, { memoria: '' }).memoria.causa, 'sem-caminho');
    assert.strictEqual(aud.auditar(dir, {}, { memoria: 'true' }).memoria.medida, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('memoria (H): linhas cortam primeiro -> os bytes de fora contam a partir do byte onde a linha 201 comeca', () => {
  const dir = pasta('corte-linhas');
  try {
    // 300 linhas de 101 bytes: a linha 201 comeca no byte 20.200 (antes de 25.000) -> linhas cortam.
    const a = aud.medirMemoria(memoria(dir, linhas(300, 100)));
    assert.strictEqual(a.primeiro, 'linhas');
    assert.deepStrictEqual(a.foraDaCarga, { linhas: 100, bytes: 300 * 101 - 200 * 101 });
    // so as linhas estouram: 250 linhas de 2 bytes = 500; a linha 201 comeca no byte 400.
    const b = aud.medirMemoria(memoria(dir, linhas(250, 1)));
    assert.strictEqual(b.primeiro, 'linhas');
    assert.deepStrictEqual(b.foraDaCarga, { linhas: 50, bytes: 100 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('memoria (H): bytes cortam primeiro -> as linhas de fora sao as que nao cabem inteiras nos 25.000 bytes', () => {
  const dir = pasta('corte-bytes');
  try {
    // 50 linhas de 601 bytes: cabem 41 inteiras (24.641); a 42a comeca no byte 24.641 e e cortada no meio -> conta como fora.
    const a = aud.medirMemoria(memoria(dir, linhas(50, 600)));
    assert.strictEqual(a.primeiro, 'bytes');
    assert.deepStrictEqual(a.foraDaCarga, { linhas: 9, bytes: 50 * 601 - 25000 });
    // 300 linhas de 201 bytes: a linha 201 comeca no byte 40.200 -> bytes cortam; cabem 124 inteiras.
    const b = aud.medirMemoria(memoria(dir, linhas(300, 200)));
    assert.strictEqual(b.primeiro, 'bytes');
    assert.deepStrictEqual(b.foraDaCarga, { linhas: 300 - 124, bytes: 300 * 201 - 25000 });
    // 25 linhas de 1.000 bytes = 25.000 exatos, mais "y\n": a linha 26 comeca no byte 25.000 e e a unica de fora.
    const c = aud.medirMemoria(memoria(dir, linhas(25, 999) + 'y\n'));
    assert.strictEqual(c.primeiro, 'bytes');
    assert.deepStrictEqual(c.foraDaCarga, { linhas: 1, bytes: 2 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('memoria (H): o metodo diz que a linha cortada no meio conta como de fora', () => {
  const dir = pasta('metodo-corte');
  try {
    const m = aud.medirMemoria(memoria(dir, linhas(3, 3)));
    assert.ok(/cortada no meio/.test(m.metodo) && /fora/.test(m.metodo), m.metodo);
    assert.ok(/mesmo corte/.test(m.metodo), 'as duas medidas saem do mesmo corte: ' + m.metodo);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- sworn-pendencias T5 (F3-09, F3-19, F3-18, F3-22)

// F3-09: a linha cujo TEXTO termina exatamente no byte 25.000, com o \n no byte seguinte, esta dentro.
test('memoria (F3-09): linha que termina no byte 25.000 com LF logo depois conta como dentro', () => {
  const dir = pasta('byte-25000-lf');
  try {
    const m = aud.medirMemoria(memoria(dir, 'a'.repeat(25000) + '\n' + 'b\n'));
    assert.strictEqual(m.primeiro, 'bytes');
    assert.strictEqual(m.linhas, 2);
    assert.deepStrictEqual(m.foraDaCarga, { linhas: 1, bytes: 3 }, 'so a 2a linha esta fora');
    // controle do lado oposto: um byte a mais na 1a linha e ela passa a ser a cortada
    const alem = aud.medirMemoria(memoria(dir, 'a'.repeat(25001) + '\n' + 'b\n'));
    assert.deepStrictEqual(alem.foraDaCarga, { linhas: 2, bytes: 25001 + 1 + 2 - 25000 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// F3-19: no CRLF o \r ficava no texto da linha e empurrava para fora a que terminava no byte 25.000.
test('memoria (F3-19): em CRLF o CR tambem sai da conta da linha que termina no byte 25.000', () => {
  const dir = pasta('byte-25000-crlf');
  try {
    const m = aud.medirMemoria(memoria(dir, 'a'.repeat(25000) + '\r\n' + 'b\r\n'));
    assert.strictEqual(m.primeiro, 'bytes');
    assert.strictEqual(m.linhas, 2);
    assert.deepStrictEqual(m.foraDaCarga, { linhas: 1, bytes: 5 }, 'so a 2a linha esta fora');
    // o \r de uma linha cortada no meio nao a salva: 25001 caracteres continuam fora
    const alem = aud.medirMemoria(memoria(dir, 'a'.repeat(25001) + '\r\n' + 'b\r\n'));
    assert.strictEqual(alem.foraDaCarga.linhas, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// F3-18: erro do parseRegras nao tem `code`; saia "(ERRO)" e "nao consegui ler", como se o arquivo
// nao tivesse sido aberto. O arquivo abriu - e ilegivel o que ele diz.
test('regras (F3-18): erro sem code vira "regras.md ilegivel: <motivo>", nao "(ERRO)"', () => {
  const regraLib = require('../scripts/lib/regra.js');
  const dir = pasta('regras-parse');
  const original = regraLib.parseRegras;
  try {
    regrasMd(dir, '- ao editar -> rodar git status\n');
    regraLib.parseRegras = function () { throw new Error('linha 3 quebrada'); };
    const r = aud.auditar(dir, {});
    assert.strictEqual(r.regras.lidas, false);
    assert.ok(r.regras.motivo.includes('regras.md ilegivel: Error: linha 3 quebrada'), r.regras.motivo);
    assert.ok(!/\(ERRO\)/.test(r.regras.motivo) && !/nao consegui ler/.test(r.regras.motivo), r.regras.motivo);
    assert.ok(/rode \/sworn:audit de novo/.test(r.regras.motivo), 'faltou dizer o que fazer: ' + r.regras.motivo);
    assert.deepStrictEqual(r.contradicoes, []);
  } finally {
    regraLib.parseRegras = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// F3-22: o codigo cru do Node some atras da causa em portugues; `causa` no estado segue o codigo.
test('auditoria (F3-22): as mensagens de leitura traduzem o codigo, e o campo causa guarda o codigo cru', () => {
  const dir = pasta('causa-pt');
  try {
    const mem = aud.medirMemoria(path.join(dir, 'nada', 'MEMORY.md'));
    assert.strictEqual(mem.causa, 'ENOENT');
    assert.ok(mem.motivo.includes('(nao existe (ENOENT))'), mem.motivo);
    assert.ok(/confira o caminho/.test(mem.motivo), 'a dica por codigo continua: ' + mem.motivo);
    fs.mkdirSync(path.join(dir, '.claude', 'sworn', 'regras.md'), { recursive: true });
    const r = aud.auditar(dir, {});
    assert.strictEqual(r.regras.causa, 'EISDIR');
    assert.ok(r.regras.motivo.includes('(e uma pasta (EISDIR))'), r.regras.motivo);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- T11-3/D370: o peso do auditar sem projeto.json
// Mesmo defeito que a T11-3 corrigiu no init: sem projeto.json, as fontes canonicas ficavam fora do peso.

function claudeMd(dir) {
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Regras\n\n- primeira regra\n- segunda regra\n- terceira regra\n');
}

test('peso (D370): sem projeto (null), o CLAUDE.md entra no peso como fonte candidata', () => {
  const dir = pasta('sem-projeto');
  try {
    claudeMd(dir);
    const peso = aud.auditar(dir, null).peso;
    assert.strictEqual(peso.fontes, 'candidatas');
    assert.ok(peso.porArquivo.some(function (p) { return p.arquivo === 'CLAUDE.md' && p.n === 3; }), JSON.stringify(peso.porArquivo));
    assert.strictEqual(peso.total, 3);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('peso (D370): projeto declarado manda - fontesCanonicas vazio e "declaradas" e o CLAUDE.md nao conta', () => {
  const dir = pasta('declarado-vazio');
  try {
    claudeMd(dir);
    const peso = aud.auditar(dir, { fontesCanonicas: [] }).peso;
    assert.strictEqual(peso.fontes, 'declaradas');
    assert.strictEqual(peso.total, 0);
    assert.ok(!peso.porArquivo.some(function (p) { return p.arquivo === 'CLAUDE.md'; }));
    // projeto sem a chave: nao e "sem projeto"; nada e varrido e a origem e "nenhuma"
    const semChave = aud.auditar(dir, {}).peso;
    assert.strictEqual(semChave.fontes, 'nenhuma');
    assert.strictEqual(semChave.total, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('peso (D370): auditar.js sem projeto.json pesa o CLAUDE.md como candidata; com projeto.json vazio nao', () => {
  const dir = pasta('cli-sem-projeto');
  try {
    claudeMd(dir);
    const rodar = function () {
      const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
      assert.strictEqual(r.status, 0, r.stderr);
      return JSON.parse(r.stdout);
    };
    const sem = rodar().peso;
    assert.strictEqual(sem.fontes, 'candidatas');
    assert.ok(sem.porArquivo.some(function (p) { return p.arquivo === 'CLAUDE.md'; }));
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify({ fontesCanonicas: [] }));
    const com = rodar().peso;
    assert.strictEqual(com.fontes, 'declaradas');
    assert.strictEqual(com.total, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// D615 (L10 do censo da D612): as skills do PLUGIN entram na auditoria so no cruzamento com as do projeto - o corpo
// delas carrega so quando chamadas, entao o peso nao muda. Caso real do workspace do dono: padrao-aaa x sworn:playbook.
test('auditoria (D615): skill do projeto que disputa o gatilho de uma skill do plugin e apontada em doPlugin', () => {
  const dir = pasta('plugin-cruzado');
  try {
    const plugin = fs.readFileSync(path.join(__dirname, '..', 'skills', 'review', 'SKILL.md'), 'utf8');
    const desc = plugin.match(/^description:\s*(.+)$/m)[1];
    fs.mkdirSync(path.join(dir, '.claude', 'skills', 'minha-revisao'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'skills', 'minha-revisao', 'SKILL.md'),
      '---\nname: minha-revisao\ndescription: ' + desc + '\n---\n\n# minha revisao\n');
    const r = aud.auditar(dir, { fontesCanonicas: [] });
    assert.ok(r.doPlugin, 'a saida traz as skills do plugin');
    assert.ok(r.doPlugin.skills.includes('sworn:review') && r.doPlugin.skills.includes('sworn:radar'));
    const par = r.doPlugin.sobreposicoes.filter(function (s) { return s.a === 'minha-revisao' && s.b === 'sworn:review'; });
    assert.strictEqual(par.length, 1, JSON.stringify(r.doPlugin.sobreposicoes));
    // so o cruzamento: par entre duas skills do plugin nao e assunto do projeto
    assert.ok(r.doPlugin.sobreposicoes.every(function (s) { return s.b.indexOf('sworn:') === 0 && s.a.indexOf('sworn:') !== 0; }));
    // o peso nao soma o plugin
    assert.ok(!r.peso.porArquivo.some(function (p) { return /revisar/.test(p.arquivo) && !/minha-revisao/.test(p.arquivo); }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Colheita 10-20, item 15 (D674): a auditoria mostra a idade de cada memoria e de cada regra e aponta a fria (mais de 90
// dias sem mudar) e a duplicada, sem IA. Aposentar e proposta: nada se move sozinho.
const DIA = 86400000;

test('item 15: memorias - idade pelo mtime, fria acima de 90 dias, duplicada pela description', () => {
  const dir = pasta('idade');
  try {
    const agora = Date.parse('2026-10-25T12:00:00Z');
    const caminho = memoria(dir, '- [A](a.md)\n');
    const nota = function (nome, desc, dias) {
      const f = path.join(dir, nome);
      fs.writeFileSync(f, '---\nname: ' + nome + '\ndescription: ' + desc + '\n---\ncorpo\n');
      fs.utimesSync(f, new Date(agora - dias * DIA), new Date(agora - dias * DIA));
    };
    nota('a.md', 'deploy do backend publicado junto com a extensao sempre', 120);
    nota('b.md', 'perfil do dono e preferencias de idioma', 3);
    nota('c.md', 'deploy do backend sempre publicado com a extensao junto', 10);
    fs.mkdirSync(path.join(dir, 'sub'));
    const m = aud.idadeDasMemorias(caminho, agora);
    assert.strictEqual(m.medida, true);
    assert.deepStrictEqual(m.lista.map(function (x) { return [x.arquivo, x.dias, x.fria]; }),
      [['a.md', 120, true], ['b.md', 3, false], ['c.md', 10, false]]);
    assert.deepStrictEqual(m.frias, ['a.md']);
    assert.strictEqual(m.duplicadas.length, 1);
    assert.deepStrictEqual([m.duplicadas[0].a, m.duplicadas[0].b], ['a.md', 'c.md']);
    assert.strictEqual(aud.idadeDasMemorias(null, agora).medida, false, 'sem caminho: nao medida, com o motivo');
    assert.ok(aud.idadeDasMemorias(null, agora).motivo);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('item 15: regras - idade pelo git blame do regras.md; sem git, dias null (nao sei)', () => {
  const dir = pasta('regras-idade');
  try {
    const agora = Date.parse('2026-10-25T12:00:00Z');
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    const arq = path.join(dir, '.claude', 'sworn', 'regras.md');
    fs.writeFileSync(arq, '# Regras\n\n- ao commitar -> rodar a suite\n');
    const regras = aud.idadeDasRegras(dir, require('../scripts/lib/regra.js').parseRegras(fs.readFileSync(arq, 'utf8')), agora);
    assert.deepStrictEqual(regras, [{ linha: 3, gatilho: 'ao commitar', dias: null, fria: false }], 'fora do git: nao sei');
    const git = function (args, env) {
      const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: Object.assign({}, process.env, env || {}) });
      assert.strictEqual(r.status, 0, r.stderr);
    };
    git(['init', '-q']);
    git(['add', '.']);
    const velho = new Date(agora - 200 * DIA).toISOString();
    git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'r'], { GIT_AUTHOR_DATE: velho, GIT_COMMITTER_DATE: velho });
    fs.appendFileSync(arq, '- ao publicar -> mostrar o cartao\n');
    const lidas = require('../scripts/lib/regra.js').parseRegras(fs.readFileSync(arq, 'utf8'));
    const idades = aud.idadeDasRegras(dir, lidas, agora);
    assert.deepStrictEqual(idades.map(function (r) { return [r.gatilho, r.dias, r.fria]; }),
      [['ao commitar', 200, true], ['ao publicar', 0, false]]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('item 15: auditar devolve memorias e idadeDasRegras', () => {
  const dir = pasta('auditar-idade');
  try {
    const caminho = memoria(dir, '- x\n');
    const r = aud.auditar(dir, {}, { memoria: caminho });
    assert.strictEqual(r.memorias.medida, true);
    assert.ok(Array.isArray(r.idadeDasRegras));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Revisao cega do lote 2 (s157): os P1 conferidos na fonte, com teste vermelho antes.
test('item 15: pasta no lugar do MEMORY.md nao mede a pasta de cima', () => {
  const dir = pasta('memoria-pasta');
  try {
    fs.mkdirSync(path.join(dir, 'mem'));
    fs.writeFileSync(path.join(dir, 'vizinha.md'), 'x\n');
    const m = aud.idadeDasMemorias(path.join(dir, 'mem'), Date.now());
    assert.strictEqual(m.medida, false);
    assert.strictEqual(m.causa, 'EISDIR');
    assert.match(m.motivo, /passe o arquivo MEMORY\.md/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('item 15: memoria e memorias dao a mesma causa quando o MEMORY.md nao se mede', () => {
  const dir = pasta('memoria-causa');
  try {
    const r = aud.auditar(dir, {}, { memoria: ['x'] });
    assert.strictEqual(r.memoria.causa, 'caminho-invalido');
    assert.strictEqual(r.memorias.causa, 'caminho-invalido');
    fs.mkdirSync(path.join(dir, 'mem'));
    const p = aud.auditar(dir, {}, { memoria: 'mem' });
    assert.strictEqual(p.memoria.causa, 'EISDIR');
    assert.strictEqual(p.memorias.causa, 'EISDIR');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('item 15: memoria que nao se le entra em ilegiveis, com a causa; nao some calada', () => {
  const dir = pasta('memoria-ilegivel');
  const ler = fs.readFileSync;
  try {
    const caminho = memoria(dir, '- x\n');
    const f = path.join(dir, 'trancada.md');
    fs.writeFileSync(f, '---\ndescription: x\n---\n');
    fs.readFileSync = function (p) {
      if (path.resolve(String(p)) === path.resolve(f)) { const e = new Error('negado'); e.code = 'EACCES'; throw e; }
      return ler.apply(fs, arguments);
    };
    const m = aud.idadeDasMemorias(caminho, Date.now());
    fs.readFileSync = ler;
    assert.strictEqual(m.medida, true);
    assert.deepStrictEqual(m.lista.map(function (x) { return x.arquivo; }), ['trancada.md']);
    assert.deepStrictEqual(m.ilegiveis, [{ arquivo: 'trancada.md', causa: 'EACCES' }]);
    assert.deepStrictEqual(aud.idadeDasMemorias(path.join(dir, 'MEMORY.md'), Date.now()).ilegiveis, [], 'sem erro, lista vazia');
  } finally { fs.readFileSync = ler; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('item 15: pasta das memorias que nao se lista diz o que conferir', () => {
  const m = aud.idadeDasMemorias(path.join(os.tmpdir(), 'sworn-nao-existe-' + process.pid, 'MEMORY.md'), Date.now());
  assert.strictEqual(m.medida, false);
  assert.match(m.motivo, /confira/);
});
