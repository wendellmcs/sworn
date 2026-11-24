'use strict';
// H6f (15.9): vermelho antes de verde, pelos recibos do H6a. O arquivo de teste editado na sessao so sai da lista
// quando um comando de teste que o cobre falha depois da edicao; a alegacao de pronto com a lista cheia barra no fecho,
// salvo a linha "SEM VERMELHO: <motivo>" ou `"vermelhoAntes": false`. A ideia e a do nizos/tdd-guard (MIT), sem modelo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const va = require('../scripts/lib/vermelho-antes.js');
const { pasta, ganchoComoProcesso } = require('./lib/comum.js');

const RAIZ = path.resolve(__dirname, '..');
const em = (dir, rel) => path.join(dir, rel);

// ------------------------------------------------------------------ a lib

test('H6f lib: so o nome de arquivo de teste entra na lista, uma vez, pelo caminho resolvido', () => {
  const dir = pasta('va-nome');
  let lista = [];
  for (const rel of ['test/a.test.js', 'src/b.spec.ts', 'tests/test_c.py', 'pkg/d_test.go', 'spec/e_spec.rb']) {
    lista = va.comEdicao(lista, dir, rel);
  }
  assert.deepStrictEqual(lista.map((a) => path.relative(dir, a).replace(/\\/g, '/')),
    ['test/a.test.js', 'src/b.spec.ts', 'tests/test_c.py', 'pkg/d_test.go', 'spec/e_spec.rb']);
  // o ajudante e a fixture da pasta de teste nao sao teste: editar nao pede vermelho
  for (const rel of ['test/lib/comum.js', 'test/fixtures/x.json', 'src/a.js', 'README.md', 'test/a.test.md']) {
    assert.strictEqual(va.comEdicao([], dir, rel).length, 0, rel);
  }
  // o mesmo arquivo por outro caminho (absoluto depois do relativo, a outra barra) entra uma vez so
  let uma = va.comEdicao([], dir, 'test/a.test.js');
  uma = va.comEdicao(uma, dir, em(dir, 'test/a.test.js'));
  uma = va.comEdicao(uma, dir, 'test\\a.test.js');
  assert.strictEqual(uma.length, 1, JSON.stringify(uma));
  // a lista fora do formato vira lista nova; o arquivo vazio ou nao texto nao entra
  assert.strictEqual(va.comEdicao(42, dir, 'test/a.test.js').length, 1);
  assert.strictEqual(va.comEdicao(['', 7, null], dir, 'test/a.test.js').length, 1);
  assert.deepStrictEqual(va.comEdicao([], dir, ''), []);
  assert.deepStrictEqual(va.comEdicao([], dir, null), []);
});

test('H6f lib: o vermelho tira da lista o que o comando cobre', () => {
  const dir = pasta('va-cobre');
  const a = em(dir, 'test/a.test.js');
  const b = em(dir, 'test/b.test.js');
  const c = em(dir, 'outro/c.test.js');
  const lista = [a, b, c];
  const rel = (l) => l.map((x) => path.relative(dir, x).replace(/\\/g, '/'));
  // o comando que nao cita arquivo de teste (a suite, a pasta, o filtro por nome) cobre todos
  for (const cmd of ['npm test', 'node --test', 'node --test test/', 'node --test --test-name-pattern=x', 'pytest -k x']) {
    assert.deepStrictEqual(va.semOsCobertos(lista, cmd, dir), [], cmd);
  }
  // o comando que cita um arquivo cobre so ele, pelo caminho relativo ao cwd do comando ou absoluto
  assert.deepStrictEqual(rel(va.semOsCobertos(lista, 'node --test test/a.test.js', dir)),
    ['test/b.test.js', 'outro/c.test.js']);
  assert.deepStrictEqual(rel(va.semOsCobertos(lista, 'node --test "' + b + '"', dir)),
    ['test/a.test.js', 'outro/c.test.js']);
  assert.deepStrictEqual(rel(va.semOsCobertos(lista, 'node --test test\\a.test.js test/b.test.js', dir)),
    ['outro/c.test.js']);
  // o glob cobre o que casa nele, na pasta dele
  assert.deepStrictEqual(rel(va.semOsCobertos(lista, 'node --test test/*.test.js', dir)), ['outro/c.test.js']);
  assert.deepStrictEqual(rel(va.semOsCobertos(lista, 'node --test test/?.test.js', dir)), ['outro/c.test.js']);
  assert.deepStrictEqual(rel(va.semOsCobertos(lista, 'node --test test/a*.test.js', dir)),
    ['test/b.test.js', 'outro/c.test.js']);
  // o arquivo de outro teste nao cobre este; o nodeid do pytest cobre o arquivo dele
  assert.deepStrictEqual(rel(va.semOsCobertos(lista, 'node --test test/z.test.js', dir)),
    ['test/a.test.js', 'test/b.test.js', 'outro/c.test.js']);
  const py = em(dir, 'tests/test_d.py');
  assert.deepStrictEqual(rel(va.semOsCobertos([py, a], 'pytest tests/test_d.py::test_x', dir)), ['test/a.test.js']);
  // a opcao sem arquivo de teste nao e alvo; a que traz um (o --spec=x.test.js) esta no teste das formas, abaixo
  assert.deepStrictEqual(va.semOsCobertos([a], 'npx jest --testPathPattern=src', dir), []);
  // no Windows e no macOS a pasta nao distingue caixa (o padrao do NTFS e do APFS); no Linux, distingue
  const maiuscula = path.join(dir, 'TEST', 'a.test.js');
  const plataforma = Object.getOwnPropertyDescriptor(process, 'platform');
  try {
    for (const [nome, resta] of [['win32', []], ['darwin', []], ['linux', [maiuscula]]]) {
      Object.defineProperty(process, 'platform', { value: nome });
      assert.deepStrictEqual(va.semOsCobertos([maiuscula], 'node --test test/a.test.js', dir), resta, nome);
    }
  } finally { Object.defineProperty(process, 'platform', plataforma); }
  // a lista fora do formato: vazia; o comando vazio nao cobre nada
  assert.deepStrictEqual(va.semOsCobertos(null, 'npm test', dir), []);
  assert.deepStrictEqual(rel(va.semOsCobertos([a], '', dir)), ['test/a.test.js']);
});

test('H6f lib: o motivo do fecho so com alegacao, sem a linha de escape, e so do arquivo que ainda existe', () => {
  const dir = pasta('va-motivo');
  fs.mkdirSync(em(dir, 'test'), { recursive: true });
  const a = em(dir, 'test/a.test.js');
  fs.writeFileSync(a, '', 'utf8');
  const sumido = em(dir, 'test/sumido.test.js');
  const alega = 'Pronto, os testes passaram.\n```\n# pass 3\n```';
  const m = va.motivoDoFecho([a, sumido], alega, {}, dir);
  assert.ok(m && /test\/a\.test\.js/.test(m) && !/sumido/.test(m), String(m));
  assert.ok(/SEM VERMELHO: /.test(m), 'o motivo diz a linha de escape: ' + m);
  assert.ok(/^[\x00-\x7f]*$/.test(m), 'o motivo e ASCII');
  // sem alegacao, com a ressalva de que nao rodou, ou com a linha de escape: nada
  assert.strictEqual(va.motivoDoFecho([a], 'Anotado.', {}, dir), null);
  assert.strictEqual(va.motivoDoFecho([a], 'Pronto, mas nao rodei os testes.', {}, dir), null);
  assert.strictEqual(va.motivoDoFecho([a], 'SEM VERMELHO: so mudou o texto do assert\n' + alega, {}, dir), null);
  assert.strictEqual(va.declarou('  SEM VERMELHO: x'), true);
  assert.strictEqual(va.declarou('SEM VERMELHO:'), false, 'sem o motivo nao vale');
  assert.strictEqual(va.declarou('o texto cita SEM VERMELHO: x no meio'), false, 'so a linha que abre com a marca');
  // o dono desligou, a lista vazia ou fora do formato: nada
  assert.strictEqual(va.motivoDoFecho([a], alega, { vermelhoAntes: false }, dir), null);
  assert.strictEqual(va.motivoDoFecho([], alega, {}, dir), null);
  assert.strictEqual(va.motivoDoFecho('x', alega, {}, dir), null);
  assert.strictEqual(va.motivoDoFecho([sumido], alega, {}, dir), null);
  // mais de 5 arquivos: os 5 primeiros e o "+N"
  const muitos = [];
  for (let i = 0; i < 7; i++) { const f = em(dir, 'test/m' + i + '.test.js'); fs.writeFileSync(f, '', 'utf8'); muitos.push(f); }
  const mm = va.motivoDoFecho(muitos, alega, {}, dir);
  assert.ok(/m4\.test\.js/.test(mm) && !/m5\.test\.js/.test(mm) && /\+2 outros arquivos de teste/.test(mm), mm);
  muitos.pop();
  assert.ok(/\+1 outro arquivo de teste/.test(va.motivoDoFecho(muitos, alega, {}, dir)), 'o singular');
});

// Ronda 1 da revisao (D902): as formas de citar o teste que a 1a versao nao via, o teto e o disco ocupado.
test('H6f lib: o glob que cruza pastas, o sufixo de linha, a opcao com o arquivo e o caminho com espaco', () => {
  const dir = pasta('va-formas');
  const a = em(dir, 'test/a.test.js');
  const b = em(dir, 'test/b.test.js');
  const fundo = em(dir, 'test/sub/c.test.js');
  const espaco = em(dir, 'meus testes/d.test.js');
  const rel = (l) => l.map((x) => path.relative(dir, x).replace(/\\/g, '/'));
  // o segmento "**" cruza pastas, inclusive nenhuma; "*" nao cruza, e "**" colado ao nome e "*" (bash, minimatch, node)
  assert.deepStrictEqual(rel(va.semOsCobertos([a, fundo, espaco], 'node --test "test/**/*.test.js"', dir)),
    ['meus testes/d.test.js']);
  assert.deepStrictEqual(rel(va.semOsCobertos([a, fundo], 'node --test test/*/*.test.js', dir)), ['test/a.test.js']);
  assert.deepStrictEqual(rel(va.semOsCobertos([a, fundo], 'node --test test/*.test.js', dir)), ['test/sub/c.test.js']);
  assert.deepStrictEqual(rel(va.semOsCobertos([a, fundo], 'node --test test/**.test.js', dir)),
    ['test/sub/c.test.js']);
  // "?" e um caractere que nao e a barra
  const barra = em(dir, 'test/a/b.test.js');
  assert.deepStrictEqual(va.semOsCobertos([barra], 'node --test test/a?b.test.js', dir), [barra]);
  // o ponto do nome e literal, nao "qualquer caractere"
  const quase = em(dir, 'test/aXtest.js');
  assert.deepStrictEqual(va.semOsCobertos([quase], 'node --test test/a.test.js', dir), [quase]);
  // o sufixo de linha do vitest e do jest cita o arquivo, nao cobre todos
  assert.deepStrictEqual(rel(va.semOsCobertos([a, b], 'npx vitest test/a.test.js:10', dir)), ['test/b.test.js']);
  assert.deepStrictEqual(rel(va.semOsCobertos([a, b], 'npx vitest test/a.test.js:10:5', dir)), ['test/b.test.js']);
  // a opcao com o arquivo cita so ele, pelo fim do caminho
  assert.deepStrictEqual(rel(va.semOsCobertos([a, b], 'npx jest --testPathPattern=a.test.js', dir)), ['test/b.test.js']);
  assert.deepStrictEqual(rel(va.semOsCobertos([a, b], 'npx jest --spec=test/b.test.js', dir)), ['test/a.test.js']);
  assert.deepStrictEqual(rel(va.semOsCobertos([a, b], 'npx jest --spec=./test/b.test.js', dir)), ['test/a.test.js']);
  assert.deepStrictEqual(rel(va.semOsCobertos([a, fundo], 'npx jest --testPathPattern=sub/c.test.js', dir)),
    ['test/a.test.js']);
  // o caminho entre aspas com espaco fica inteiro
  assert.deepStrictEqual(rel(va.semOsCobertos([a, espaco], 'node --test "meus testes/d.test.js"', dir)),
    ['test/a.test.js']);
  assert.deepStrictEqual(rel(va.semOsCobertos([a, espaco], "node --test 'meus testes/d.test.js'", dir)),
    ['test/a.test.js']);
});

test('H6f lib: o teto de 50 guarda os mais recentes, e o disco ocupado nao tira o arquivo da lista', () => {
  const dir = pasta('va-teto');
  let lista = [];
  for (let i = 0; i < 51; i++) lista = va.comEdicao(lista, dir, 'test/t' + i + '.test.js');
  const nomes = (l) => l.filter((x) => path.isAbsolute(x));
  assert.strictEqual(nomes(lista).length, 50);
  assert.ok(/t50\.test\.js$/.test(nomes(lista)[49]) && /t1\.test\.js$/.test(nomes(lista)[0]), nomes(lista)[0]);
  // so "nao existe" tira da lista: o arquivo travado por outro processo (EBUSY, EPERM) segue pedindo vermelho
  const a = em(dir, 'test/a.test.js');
  const alega = 'Pronto, os testes passaram.\n```\n# pass 3\n```';
  const orig = fs.statSync;
  for (const code of ['EBUSY', 'EPERM', 'EACCES', 'ENOENT', 'ENOTDIR']) {
    fs.statSync = () => { const e = new Error(code); e.code = code; throw e; };
    let m;
    try { m = va.motivoDoFecho([a], alega, {}, dir); } finally { fs.statSync = orig; }
    assert.strictEqual(m === null, code === 'ENOENT' || code === 'ENOTDIR', code + ': ' + m);
  }
  // o corte fica marcado: o aviso sai depois de um vermelho que cobre parte da lista e de outra edicao; 50 sem corte, nao
  let cinquenta = [];
  for (let i = 0; i < 50; i++) cinquenta = va.comEdicao(cinquenta, dir, 'test/t' + i + '.test.js');
  const parcial = va.semOsCobertos(lista, 'node --test test/t49.test.js test/t50.test.js', dir);
  const editada = va.comEdicao(parcial, dir, 'test/novo.test.js');
  // o vermelho que cobre todos os nomes deixa so o corte, e o fecho ainda barra
  const soCorte = va.semOsCobertos(lista, 'node --test "test/t*.test.js"', dir);
  assert.strictEqual(nomes(parcial).length, 48);
  assert.strictEqual(nomes(soCorte).length, 0);
  fs.statSync = () => ({ isFile: () => true });
  const avisos = [];
  let semCorte;
  try {
    for (const l of [lista, parcial, editada, soCorte]) avisos.push(va.motivoDoFecho(l, alega, {}, dir));
    semCorte = va.motivoDoFecho(cinquenta, alega, {}, dir);
  } finally { fs.statSync = orig; }
  for (const m of avisos) assert.ok(/so os 50 arquivos de teste mais recentes/.test(m) && !/cortados/.test(m), m);
  assert.ok(semCorte && !/mais recentes/.test(semCorte), semCorte);
  // o vermelho que cobre todos limpa o corte; com a linha de escape ou desligado, o corte so nao barra
  assert.deepStrictEqual(va.semOsCobertos(lista, 'npm test', dir), []);
  assert.strictEqual(va.motivoDoFecho(soCorte, 'SEM VERMELHO: rodei antes\n' + alega, {}, dir), null);
  assert.strictEqual(va.motivoDoFecho(soCorte, alega, { vermelhoAntes: false }, dir), null);
});

test('H6f lib: o cwd que nao e texto vale como o do processo, sem lancar', () => {
  const alega = 'Pronto, os testes passaram.\n```\n# pass 3\n```';
  for (const cwd of [undefined, null, 42, '']) {
    const lista = va.comEdicao([], cwd, 'test/x.test.js');
    assert.strictEqual(lista[0], path.resolve(process.cwd(), 'test/x.test.js'), String(cwd));
    assert.deepStrictEqual(va.semOsCobertos(lista, 'node --test test/x.test.js', cwd), [], String(cwd));
    const f = path.join(pasta('va-cwd'), 'y.test.js');
    fs.writeFileSync(f, '', 'utf8');
    assert.ok(/y\.test\.js/.test(va.motivoDoFecho([f], alega, {}, cwd)), String(cwd));
  }
});

// ------------------------------------------------------------------ os ganchos

function projeto(nome, extra) {
  const dir = pasta('va-' + nome);
  fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify(Object.assign({
    versaoConfig: 1, marchaPadrao: 'padrao' }, extra || {})), 'utf8');
  fs.writeFileSync(path.join(dir, 'test', 'a.test.js'), '', 'utf8');
  return dir;
}
function gancho(script, e, tmp) {
  const r = ganchoComoProcesso(path.join('scripts', script), e, { cwd: e.cwd,
    env: Object.assign({}, process.env, { SWORN_TMP: tmp, SWORN_PONTE: '' }) });
  assert.strictEqual(r.status, 0, script + ': ' + r.stderr);
  return r.json;
}
const estadoDe = (tmp, sid) => {
  const f = path.join(tmp, 'sworn', sid + '.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
};
const editar = (dir, sid, rel, tmp, extra) => gancho('marcar-trabalho.js', Object.assign({ session_id: sid, cwd: dir,
  hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: em(dir, rel) } }, extra || {}), tmp);
const falhar = (dir, sid, comando, tmp, extra) => gancho('recibo-da-prova.js', Object.assign({ session_id: sid, cwd: dir,
  hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: comando },
  error: 'Exit code 1\nfail 1', is_interrupt: false }, extra || {}), tmp);
const fechar = (dir, sid, msg, tmp) => gancho('portao-fecho.js', { session_id: sid, cwd: dir, hook_event_name: 'Stop',
  last_assistant_message: msg }, tmp);
const ALEGA = 'Pronto, os testes passaram.\n```\n# pass 3\n```';

test('H6f ganchos: o teste editado sem vermelho barra o pronto; o vermelho que o cobre libera', () => {
  const dir = projeto('fluxo');
  const tmp = pasta('va-fluxo-tmp');
  editar(dir, 'v1', 'test/a.test.js', tmp);
  assert.strictEqual(estadoDe(tmp, 'v1').testesSemVermelho.length, 1);
  // o fim de turno sem alegacao nao barra e a lista atravessa o turno (o fecho regrava so os campos da sessao)
  assert.strictEqual(fechar(dir, 'v1', 'Anotado.', tmp), null);
  assert.strictEqual(estadoDe(tmp, 'v1').testesSemVermelho.length, 1, 'a lista sobrevive ao fim do turno');
  editar(dir, 'v1', 'test/a.test.js', tmp);
  const r = fechar(dir, 'v1', ALEGA, tmp);
  assert.ok(r && r.decision === 'block' && /SEM VERMELHO/.test(r.reason), JSON.stringify(r));
  assert.strictEqual(estadoDe(tmp, 'v1').contadores.teste_sem_vermelho, 1);
  // o vermelho de outro arquivo nao cobre; o deste cobre, e o pronto passa (sessao v2: sem o bloqueio que a v1 gastou)
  editar(dir, 'v2', 'test/a.test.js', tmp);
  falhar(dir, 'v2', 'node --test test/outro.test.js', tmp);
  assert.strictEqual(estadoDe(tmp, 'v2').testesSemVermelho.length, 1);
  falhar(dir, 'v2', 'node --test test/a.test.js', tmp);
  assert.deepStrictEqual(estadoDe(tmp, 'v2').testesSemVermelho, []);
  assert.strictEqual(fechar(dir, 'v2', ALEGA, tmp), null);
  // editar de novo depois do vermelho pede outro vermelho
  editar(dir, 'v2', 'test/a.test.js', tmp);
  assert.strictEqual(estadoDe(tmp, 'v2').testesSemVermelho.length, 1);
});

test('H6f ganchos: o vermelho interrompido, sem codigo ou de comando que nao e teste nao conta', () => {
  const dir = projeto('naoconta');
  const tmp = pasta('va-naoconta-tmp');
  editar(dir, 'n1', 'test/a.test.js', tmp);
  falhar(dir, 'n1', 'node --test test/a.test.js', tmp, { error: 'Exit code 130', is_interrupt: true });
  falhar(dir, 'n1', 'node --test test/a.test.js', tmp, { error: 'Command timed out after 2m 0s' });
  falhar(dir, 'n1', 'git push', tmp);
  assert.strictEqual(estadoDe(tmp, 'n1').testesSemVermelho.length, 1);
  // o verde (PostToolUse com codigo 0 e saida verde) nao tira da lista; a saida que mostra falha tira
  const verde = { stdout: 'ℹ tests 1\nℹ pass 1\nℹ fail 0\n', stderr: '', interrupted: false, isImage: false };
  gancho('recibo-da-prova.js', { session_id: 'n1', cwd: dir, hook_event_name: 'PostToolUse', tool_name: 'Bash',
    tool_input: { command: 'node --test test/a.test.js' }, tool_response: verde }, tmp);
  assert.strictEqual(estadoDe(tmp, 'n1').testesSemVermelho.length, 1);
  const vermelhoNaSaida = { stdout: 'not ok 1 - x\nℹ tests 1\nℹ pass 0\nℹ fail 1\n', stderr: '', interrupted: false,
    isImage: false };
  gancho('recibo-da-prova.js', { session_id: 'n1', cwd: dir, hook_event_name: 'PostToolUse', tool_name: 'Bash',
    tool_input: { command: 'node --test test/a.test.js | tail -5' }, tool_response: vermelhoNaSaida }, tmp);
  assert.deepStrictEqual(estadoDe(tmp, 'n1').testesSemVermelho, []);
});

test('H6f ganchos: a linha de escape libera e limpa a lista; desligado nao barra; o subagente nao marca', () => {
  const dir = projeto('escape');
  const tmp = pasta('va-escape-tmp');
  editar(dir, 'e1', 'test/a.test.js', tmp);
  assert.strictEqual(fechar(dir, 'e1', 'SEM VERMELHO: so mudou o texto de um assert\n' + ALEGA, tmp), null);
  assert.deepStrictEqual(estadoDe(tmp, 'e1').testesSemVermelho, []);
  const desligado = projeto('desligado', { vermelhoAntes: false });
  editar(desligado, 'e2', 'test/a.test.js', tmp);
  assert.strictEqual(fechar(desligado, 'e2', ALEGA, tmp), null);
  editar(dir, 'e3', 'test/a.test.js', tmp, { agent_id: 'sub1' });
  assert.ok(!(estadoDe(tmp, 'e3').testesSemVermelho || []).length, 'a edicao do subagente nao entra');
  // o arquivo que nao e teste nao entra, e o pronto passa
  editar(dir, 'e4', 'src/a.js', tmp);
  assert.strictEqual(fechar(dir, 'e4', ALEGA, tmp), null);
});

test('H6f: a chave vermelhoAntes e o balde teste_sem_vermelho estao declarados', () => {
  assert.ok(require('../scripts/lib/projeto.js').CHAVES_LIGA_DESLIGA.indexOf('vermelhoAntes') !== -1);
  assert.ok(require('../scripts/lib/saude.js').BALDES_DE_BLOQUEIO.indexOf('teste_sem_vermelho') !== -1);
  assert.ok(fs.readFileSync(path.join(RAIZ, 'GUIA.md'), 'utf8').includes('`vermelhoAntes`'), 'o GUIA documenta a chave');
});
