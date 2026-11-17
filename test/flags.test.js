'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const flags = require('../scripts/lib/flags.js');

const USO = ['--raiz', '--destino', '--gravar'];

/** O valor e as recusas de uma linha. Recusar so anota, sem sair: cada caso de recusa prova tambem que a recusa que
 * volta deixa o valor null, com uma recusa so. */
function ler(argv, nome) {
  const recusas = [];
  const v = flags.valor(argv, nome, USO, function (msg) { recusas.push(msg); });
  return { valor: v, recusas: recusas };
}

// A4-48: a regra que os scripts copiavam fica num lugar so
test('A4-48 flags: sem a flag e null, sem recusa; com valor, o valor', () => {
  assert.deepStrictEqual(ler(['node', 'x.js'], '--raiz'), { valor: null, recusas: [] });
  assert.deepStrictEqual(ler(['node', 'x.js', '--raiz', 'pasta'], '--raiz'), { valor: 'pasta', recusas: [] });
  assert.deepStrictEqual(ler(['--destino', 'b', '--raiz', 'a'], '--raiz'), { valor: 'a', recusas: [] }, 'a ordem nao importa');
  assert.deepStrictEqual(ler(['--raiz', ' a '], '--raiz'), { valor: ' a ', recusas: [] }, 'o valor sai como veio');
});

test('A4-48 flags: a ultima da linha, a vazia e a seguida de outra flag do USO pedem um valor', () => {
  for (const argv of [['--raiz'], ['--raiz', ''], ['--raiz', '--gravar'], ['--raiz', '--destino', 'b']]) {
    assert.deepStrictEqual(ler(argv, '--raiz'), { valor: null, recusas: ['--raiz pede um valor.'] }, JSON.stringify(argv));
  }
});

// A4-71: o valor so de espaco media a pasta " "
test('A4-71 flags: valor so de espaco (espaco, tab, quebras de linha, espaco unicode) pede um valor', () => {
  for (const v of [' ', '   ', '\t', '\n', '\r', '\r\n', ' \t ', '\u00a0', '\u3000', '\ufeff']) {
    assert.deepStrictEqual(ler(['--raiz', v], '--raiz'), { valor: null, recusas: ['--raiz pede um valor.'] }, JSON.stringify(v));
  }
});

// A4-52/A4-53 (nao-procede): a regra da 0.3.3 fica, um arquivo chamado --x.js e caminho
test('A4-52 A4-53 flags (nao-procede): valor que comeca com - e nao e flag do USO vale', () => {
  for (const v of ['--x.js', '-x', '--', '-']) {
    assert.deepStrictEqual(ler(['--raiz', v], '--raiz'), { valor: v, recusas: [] }, v);
  }
});

test('A4-48 flags: a flag repetida e recusada, mesmo com os dois valores bons', () => {
  for (const argv of [['--raiz', 'a', '--raiz', 'b'], ['--raiz', 'a', '--destino', 'x', '--raiz', 'a'], ['--raiz', '--raiz']]) {
    assert.deepStrictEqual(ler(argv, '--raiz'),
      { valor: null, recusas: ['--raiz aparece mais de uma vez; passe-a uma vez so.'] }, JSON.stringify(argv));
  }
  assert.deepStrictEqual(ler(['--raiz', 'a', '--destino', 'b'], '--destino'), { valor: 'b', recusas: [] }, 'outra flag nao conta');
});

// Pelos scripts: o valor so de espaco agora e erro de uso, no canal e com o codigo de cada um
const SCRIPTS = path.join(__dirname, '..', 'scripts');
function rodar(script, args, cwd) {
  return spawnSync(process.execPath, [path.join(SCRIPTS, script)].concat(args),
    { cwd: cwd || path.join(__dirname, '..'), encoding: 'utf8', timeout: 60000 });
}
/** O que sai na mensagem de falha: o processo morto pelo timeout diz que morreu, nao so "null !== 1". */
function contar(r) { return (r.error ? '[' + r.error.code + '] ' : '') + (r.signal ? '[' + r.signal + '] ' : '') + r.stdout + r.stderr; }

test('A4-71 flags: sanitar e plataforma (--raiz) e exportar (--destino) recusam valor so de espaco no stderr, com 2', () => {
  for (const [script, args] of [['sanitar.js', ['--raiz', '  ']], ['exportar.js', ['--destino', ' ']],
    ['plataforma.js', ['--raiz', ' ']]]) {
    const r = rodar(script, args);
    assert.strictEqual(r.status, 2, script + ': ' + contar(r));
    assert.ok(r.stderr.startsWith('ERRO: ' + args[0] + ' pede um valor.\n'), script + ': ' + r.stderr);
  }
});

test('A4-71 flags: plano.js (stderr) e cicatriz.js (stdout) recusam valor so de espaco, com 1', () => {
  const p = rodar('plano.js', ['--abrir', ' ']);
  assert.strictEqual(p.status, 1, contar(p));
  assert.ok(p.stderr.startsWith('ERRO: --abrir pede um valor.\nuso: plano.js '), p.stderr);
  const c = rodar('cicatriz.js', ['--corpus', '\t']);
  assert.strictEqual(c.status, 1, contar(c));
  assert.ok(c.stdout.startsWith('ERRO: --corpus pede um valor.\n'), c.stdout);
  assert.strictEqual(c.stderr, '');
});

test('A4-48 flags: experimento.js diz o que a flag espera, e a repetida diz que e repetida', () => {
  const falta = rodar('experimento.js', ['--manual', ' ']);
  assert.strictEqual(falta.status, 1, contar(falta));
  assert.strictEqual(falta.stdout, 'ERRO: --manual pede um valor (a pasta com os SKILL.md do manual antigo).\n');
  const dupla = rodar('experimento.js', ['--manual', 'a', '--manual', 'b']);
  assert.strictEqual(dupla.status, 1, contar(dupla));
  assert.strictEqual(dupla.stdout, 'ERRO: --manual aparece mais de uma vez; passe-a uma vez so.\n');
});

// A4-43 (0.66.0): os cinco que ainda copiavam a regra. Cada caso fixa a saida inteira (stdout, stderr vazio, 1): o
// valor que e outra flag do USO, o so de espaco e a repetida, cada um com a frase do script.
const REPETIDA = ' aparece mais de uma vez; passe-a uma vez so.';
const USO_CATALOGO = 'uso: catalogo.js --motivo <motivo> | --registrar <ok|semRede|falhou> [fonte...] | --degradado\n';
const USO_CORRIGIR = '  --corrigir <agente> --para arquivo   (o arquivo passa a dizer o que o mapa diz)\n' +
  '  --corrigir <agente> --para mapa      (o mapa passa a dizer o que o arquivo diz)\n';
const USO_PROPOR = "uso: propor-regra.js --gatilho '<quando>' --acao '<o que fazer>' [--gravar]\n";
const USO_REFERENCIA = 'node referencia.js <ficha> [--gravar | --tipo radar]';
const SESSAO_FALTA = 'ERRO: --sessao sem valor. Passe o id da sessao: --sessao <id>, ou tire a flag para usar ' +
  'CLAUDE_CODE_SESSION_ID.\n';
const ARQUIVO_FALTA = 'ERRO: --arquivo sem caminho. Passe o arquivo revisado: --arquivo <caminho>.\n';
function json(o) { return JSON.stringify(o, null, 2) + '\n'; }

test('A4-43 flags: apurar-ronda, catalogo, portao-apelido, propor-regra e referencia recusam pela lib, com 1', () => {
  const casos = [
    ['apurar-ronda.js', ['--sessao', ' '], SESSAO_FALTA],
    ['apurar-ronda.js', ['--arquivo', '--sessao', 'x'], ARQUIVO_FALTA],
    ['apurar-ronda.js', ['--arquivo', 'a', '--arquivo', 'b'], 'ERRO: --arquivo' + REPETIDA + '\n'],
    ['catalogo.js', ['--motivo', '\t'], 'ERRO: --motivo sem valor.\n' + USO_CATALOGO],
    ['catalogo.js', ['--registrar', ' '], 'ERRO: --registrar sem valor: use ok, semRede, falhou.\n' + USO_CATALOGO],
    ['catalogo.js', ['--motivo', 'a', '--motivo', 'b'], 'ERRO: --motivo' + REPETIDA + '\n' + USO_CATALOGO],
    ['portao-apelido.js', ['--corrigir', '--para', 'arquivo'], 'ERRO: --corrigir pede um valor.\n' + USO_CORRIGIR],
    ['portao-apelido.js', ['--corrigir', 'x', '--para', ' '], 'ERRO: --para pede um valor.\n' + USO_CORRIGIR],
    ['portao-apelido.js', ['--corrigir', 'x', '--para', 'mapa', '--para', 'arquivo'], 'ERRO: --para' + REPETIDA + '\n' +
      USO_CORRIGIR],
    ['propor-regra.js', ['--gatilho', '--acao', 'x'], 'ERRO: --gatilho pede um valor.\n' + USO_PROPOR],
    ['propor-regra.js', ['--gatilho', 'g', '--acao', ' '], 'ERRO: --acao pede um valor.\n' + USO_PROPOR],
    ['propor-regra.js', ['--gatilho', 'g', '--acao', 'a', '--acao', 'b'], 'ERRO: --acao' + REPETIDA + '\n' + USO_PROPOR],
    // a falta do valor vem antes da repetida: o --gatilho depois do --acao e o valor que falta, nao a repeticao
    ['propor-regra.js', ['--gatilho', 'a', '--acao', '--gatilho'], 'ERRO: --acao pede um valor.\n' + USO_PROPOR],
    ['propor-regra.js', ['--gatilho', 'a', '--gatilho', 'b', '--acao', 'x'], 'ERRO: --gatilho' + REPETIDA + '\n' + USO_PROPOR],
    ['referencia.js', ['f.md', '--tipo', '--gravar'], json({ gravou: false, erro: '--tipo pede um valor: ' + USO_REFERENCIA })],
    ['referencia.js', ['f.md', '--tipo', ' '], json({ gravou: false, erro: '--tipo pede um valor: ' + USO_REFERENCIA })],
    ['referencia.js', ['f.md', '--tipo', 'radar', '--tipo', 'radar'],
      json({ gravou: false, erro: '--tipo aparece mais de uma vez; passe-a uma vez so: ' + USO_REFERENCIA })]
  ];
  for (const [script, args, saida] of casos) {
    const r = rodar(script, args);
    const onde = script + ' ' + JSON.stringify(args) + ': ';
    assert.strictEqual(r.status, 1, onde + contar(r));
    assert.strictEqual(r.stdout, saida, onde + r.stdout);
    assert.strictEqual(r.stderr, '', onde + r.stderr);
  }
});

// Os controles rodam numa pasta vazia, para o resultado nao depender do estado do repositorio; o fim confere que
// nenhum dos cinco grava na pasta de onde roda.
test('A4-43 flags: o valor bom passa nos cinco (controle das recusas acima)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-flags-'));
  try {
    // --arquivo e --sessao bons chegam a procura da revisao, que nao existe nesta pasta
    const apu = rodar('apurar-ronda.js', ['--arquivo', 'x.js', '--sessao', 'abc1'], dir);
    assert.strictEqual(apu.status, 1, contar(apu));
    assert.ok(apu.stdout.startsWith('ERRO: nao ha revisao de x.js.'), apu.stdout);
    // --gatilho e --acao bons montam a proposta, sem gravar
    const pro = rodar('propor-regra.js', ['--gatilho', 'ao fechar tarefa', '--acao', 'colar a saida da rodada'], dir);
    assert.strictEqual(pro.status, 0, contar(pro));
    assert.ok(pro.stdout.includes('  - ao fechar tarefa -> colar a saida da rodada\n'), pro.stdout);
    // --tipo bom chega a ficha (que nao existe): a recusa e a da leitura, nao a da flag
    const ref = rodar('referencia.js', ['nao-existe.md', '--tipo', 'radar'], dir);
    assert.strictEqual(ref.status, 1, contar(ref));
    assert.match(JSON.parse(ref.stdout).erro, /^nao consegui ler a ficha nao-existe\.md /, ref.stdout);
    // --corrigir e --para bons chegam ao mapa: o agente que nao diverge e "nada a corrigir", nao erro de uso
    const ape = rodar('portao-apelido.js', ['--corrigir', 'nao-existe', '--para', 'mapa'], dir);
    assert.strictEqual(ape.status, 1, contar(ape));
    assert.ok(ape.stdout.startsWith('NADA A CORRIGIR: "nao-existe"'), ape.stdout);
    // --motivo bom consulta (a deliberada sempre diz sim, sem rede: o script nao abre conexao)
    const cat = rodar('catalogo.js', ['--motivo', 'instalacao'], dir);
    assert.strictEqual(cat.status, 0, contar(cat));
    assert.deepStrictEqual(JSON.parse(cat.stdout),
      { sim: true, porque: 'consulta deliberada (instalacao): a janela nao se aplica' });
    assert.deepStrictEqual(fs.readdirSync(dir), [], 'nenhum dos cinco grava na pasta');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A4-43 referencia: um argumento vazio antes da ficha nao esconde a ficha', () => {
  const r = rodar('referencia.js', ['', 'nao-existe.md']);
  assert.strictEqual(r.status, 1, contar(r));
  assert.match(JSON.parse(r.stdout).erro, /^nao consegui ler a ficha nao-existe\.md /, r.stdout);
});
