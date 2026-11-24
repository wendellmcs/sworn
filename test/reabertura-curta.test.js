'use strict';
// H6a2 (D892, defeito 1): na compactacao, a reabertura que passa do que o harness mostra inteiro vai inteira para um
// arquivo, e o stdout leva so a previa: as ordens primeiro, o caminho do arquivo, as regras que couberem.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const comum = require('./lib/comum.js');
const curta = require('../scripts/lib/reabertura-curta.js');

const ORDEM_GRAVAR = '# sworn - depois da compactacao: grave o handoff primeiro';
const bytes = (t) => Buffer.byteLength(t, 'utf8');

/** Um projeto com regras.md grande (a reabertura passa do teto) e o estado da sessao com o aviso de saude dado. */
function cenario(linhasDeRegra) {
  const dir = comum.pasta('reab-proj');
  const tmp = comum.pasta('reab-tmp');
  fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'),
    JSON.stringify({ versaoConfig: 1, marchaPadrao: 'padrao', modoContinuo: false }), 'utf8');
  const regras = [];
  for (let i = 0; i < linhasDeRegra; i++) regras.push('- ao fazer a coisa numero ' + i + ' -> conferir no disco antes de seguir, regra ' + i);
  fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'regras.md'), regras.join('\n') + '\n', 'utf8');
  fs.mkdirSync(path.join(tmp, 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'sworn', 'r1.json'), JSON.stringify({ avisouSaude: true }), 'utf8');
  return { dir: dir, env: { SWORN_TMP: tmp } };
}

function abrir(c, source) {
  return comum.rodar('scripts/abertura.js', [], { cwd: c.dir, entrada: { session_id: 'r1', cwd: c.dir, source: source }, env: c.env });
}

test('H6a2 (1): compact grande - o stdout cabe no teto, abre pela ordem e cita o arquivo com a reabertura inteira', () => {
  const c = cenario(150);
  const r = abrir(c, 'compact');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(bytes(r.stdout) <= curta.TETO_DA_SAIDA, 'o stdout passou do teto: ' + bytes(r.stdout) + ' bytes');
  assert.strictEqual(r.stdout.indexOf(ORDEM_GRAVAR), 0, 'a ordem tem de abrir o stdout: ' + r.stdout.slice(0, 200));
  const arquivo = path.join(c.dir, '.sworn', 'reabertura', 'r1.md');
  assert.ok(r.stdout.includes(arquivo.replace(/\\/g, '/')), 'o stdout tem de citar o arquivo: ' + r.stdout.slice(0, 1500));
  const inteiro = fs.readFileSync(arquivo, 'utf8');
  assert.match(inteiro, /qualidade de resposta/, 'o arquivo tem de trazer a reabertura ate o fim');
  assert.ok(inteiro.includes('regra 149'), 'o arquivo tem de trazer a ultima regra');
  assert.ok(!r.stdout.includes('regra 149'), 'controle: a ultima regra ficou fora da previa');
  assert.ok(r.stdout.includes('regra 0\n'), 'as regras que travam vem logo depois da ordem: ' + r.stdout.slice(0, 1500));
  assert.match(r.stdout, /\[sworn: fim da previa; o resto esta em [^\]]+\]\n$/, 'a previa fecha com a marca do corte');
  assert.strictEqual(fs.readFileSync(path.join(c.dir, '.sworn', 'reabertura', '.gitignore'), 'utf8'), '*\n');
});

test('H6a2 (1): compact aberto de uma subpasta grava a reabertura na raiz do projeto, nao na subpasta', () => {
  const c = cenario(150);
  const sub = path.join(c.dir, 'src', 'fundo');
  fs.mkdirSync(sub, { recursive: true });
  const r = comum.rodar('scripts/abertura.js', [], { cwd: sub, entrada: { session_id: 'r1', cwd: sub, source: 'compact' }, env: c.env });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(c.dir, '.sworn', 'reabertura', 'r1.md')), 'a reabertura vai para a raiz do projeto');
  assert.ok(!fs.existsSync(path.join(sub, '.sworn')), 'nada na subpasta');
});

test('H6a2 (1): a falha fora do modo embutido solta o que se juntou antes de sair', () => {
  const script = path.join(comum.pasta('reab-solo'), 'gancho.js');
  fs.writeFileSync(script, 'const io = require(' + JSON.stringify(require.resolve('../scripts/lib/io.js')) + ');\n' +
    'io.blindar(function () { io.antesDeSair(function () { process.stdout.write("SOLTOU\\n"); }); throw new Error("quebrou"); });\n', 'utf8');
  const r = require('node:child_process').spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 30000 });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, 'SOLTOU\n', 'o gancho que quebra ainda solta o stdout juntado');
});

test('H6a2 (1): compact pequeno e abertura de startup grande saem inteiros, sem arquivo', () => {
  const pequeno = cenario(2);
  const r = abrir(pequeno, 'compact');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /qualidade de resposta/);
  assert.ok(!fs.existsSync(path.join(pequeno.dir, '.sworn', 'reabertura')), 'compact pequeno nao grava arquivo');
  const grande = cenario(150);
  const s = abrir(grande, 'startup');
  assert.strictEqual(s.status, 0, s.stderr);
  assert.ok(s.stdout.includes('regra 149') && /qualidade de resposta/.test(s.stdout), 'startup sai inteiro');
  assert.ok(!fs.existsSync(path.join(grande.dir, '.sworn', 'reabertura')), 'startup nao grava arquivo');
});

test('H6a2 (1): previa - ordens, ponteiro, linhas inteiras ate o teto e a marca do fim', () => {
  const ordens = '# ordem\nfaca isto primeiro';
  const linhas = [];
  for (let i = 0; i < 400; i++) linhas.push('linha ' + i + ' ' + 'x'.repeat(40));
  const texto = 'aviso de migracao\n\n' + ordens + '\n' + linhas.join('\n') + '\n';
  const p = curta.previa(texto, ordens, 'C:\\proj\\.sworn\\reabertura\\r1.md');
  assert.strictEqual(p.indexOf(ordens + '\n'), 0, 'as ordens abrem a previa');
  assert.strictEqual(p.split(ordens).length, 2, 'as ordens saem uma vez so');
  assert.ok(p.includes('C:/proj/.sworn/reabertura/r1.md'), 'o caminho com barra normal');
  assert.ok(bytes(p) <= curta.TETO_DA_SAIDA, 'a previa cabe no teto: ' + bytes(p));
  assert.ok(p.includes('aviso de migracao'), 'o que vinha antes das ordens segue no resto');
  for (const l of p.split('\n')) {
    if (/^linha /.test(l)) assert.match(l, /^linha \d+ x{40}$/, 'linha cortada no meio: ' + l);
  }
  assert.ok(!p.includes('linha 399'), 'controle: o fim ficou de fora');
  assert.match(p, /\[sworn: fim da previa; o resto esta em C:\/proj\/\.sworn\/reabertura\/r1\.md\]\n$/);
  const semOrdens = curta.previa(texto, null, '/p/r1.md');
  assert.strictEqual(semOrdens.indexOf('sworn: a reabertura inteira'), 0, 'sem ordens, o ponteiro abre: ' + semOrdens.slice(0, 80));
});

test('H6a2 (1): previa com acento - o teto conta bytes, nao letras, e nenhuma letra sai partida', () => {
  const linhas = [];
  for (let i = 0; i < 400; i++) linhas.push('ação ' + i + ' ' + 'ç'.repeat(40));
  const ordens = linhas.slice(0, 200).map(function (l) { return 'ordem ' + l; }).join('\n');
  for (const [texto, ord] of [['aviso\n' + linhas.join('\n') + '\n', '# ordem de reler'], [ordens + '\nresto\n', ordens]]) {
    const p = curta.previa(texto, ord, '/p/r1.md');
    assert.ok(p.length < curta.TETO_DA_SAIDA, 'controle: em letras a previa fica abaixo do teto');
    assert.ok(bytes(p) <= curta.TETO_DA_SAIDA, 'a previa cabe no teto em bytes: ' + bytes(p));
    assert.ok(!p.includes('�'), 'letra partida na previa');
    for (const l of p.split('\n')) {
      if (/ação \d/.test(l)) assert.match(l, /ação \d+ ç{40}$/, 'linha cortada no meio: ' + l);
    }
  }
});

test('H6a2 (1): soltar - o disco que nao grava devolve o texto inteiro, com as ordens e o aviso na frente; sem juntar, nada', () => {
  const raizQueEArquivo = path.join(comum.pasta('reab-arq'), 'arquivo');
  fs.writeFileSync(raizQueEArquivo, 'x', 'utf8');
  const escrever = process.stdout.write;
  let saiu = '';
  process.stdout.write = function (t) { saiu += t; return true; };
  const corpo = 'a'.repeat(curta.TETO_DA_SAIDA + 10);
  try {
    curta.juntar();
    process.stdout.write('migrou\n# ordem\n' + corpo);
    curta.soltar(raizQueEArquivo, 'r1', '# ordem\n');
    curta.soltar(raizQueEArquivo, 'r1', '# ordem\n');
  } finally { process.stdout.write = escrever; }
  assert.strictEqual(saiu.indexOf('# ordem\nsworn: nao gravei a reabertura'), 0, 'as ordens e o aviso abrem: ' + saiu.slice(0, 120));
  // acima do teto do sworn e abaixo dos 10 mil: o Claude Code mostra tudo e nao cita arquivo, e o aviso nao pode dizer o contrario
  assert.ok(bytes(saiu) > curta.TETO_DA_SAIDA && bytes(saiu) < 10000, 'controle: a saida fica entre o teto e os 10 mil: ' + bytes(saiu));
  assert.ok(!/passa do que o harness mostra|o arquivo que o harness cita/.test(saiu), 'o aviso nao afirma o corte: ' + saiu.slice(0, 300));
  assert.match(saiu, /nao gravei a reabertura em \.sworn\/reabertura\/ \(o disco recusou\), entao ela vai inteira abaixo\. Se o Claude Code/);
  assert.ok(saiu.endsWith('migrou\n' + corpo), 'o resto sai inteiro');
  assert.strictEqual(saiu.split('# ordem').length, 2, 'uma vez so, e as ordens sem repetir');
});

test('H6a2 (1): previa - ordens maiores que o teto saem cortadas e o ponteiro e a marca do fim ficam', () => {
  const linhas = [];
  for (let i = 0; i < 300; i++) linhas.push('ordem ' + i + ' ' + 'y'.repeat(40));
  const ordens = linhas.join('\n');
  const p = curta.previa(ordens + '\nresto\n', ordens, '/p/r1.md');
  assert.ok(bytes(p) <= curta.TETO_DA_SAIDA, 'a previa cabe no teto: ' + bytes(p));
  assert.strictEqual(p.indexOf('ordem 0 '), 0, 'as ordens ainda abrem');
  assert.ok(p.includes('[sworn: ordens cortadas no teto'), 'o corte das ordens e dito');
  assert.ok(p.includes('sworn: a reabertura inteira tem'), 'o ponteiro fica');
  assert.match(p, /\[sworn: fim da previa; o resto esta em \/p\/r1\.md\]\n$/);
});

test('H6a2 (1): juntar - o write com callback e codificacao se comporta como o stdout', async () => {
  const escrever = process.stdout.write;
  let saiu = '';
  process.stdout.write = function (t) { saiu += t; return true; };
  let chamou = 0;
  try {
    curta.juntar();
    process.stdout.write('ola ', function () { chamou++; });
    process.stdout.write(Buffer.from('mundo').toString('hex'), 'hex', function () { chamou++; });
    curta.soltar(comum.pasta('reab-cb'), 'r1', null);
  } finally { process.stdout.write = escrever; }
  // a espera vem depois de devolver o stdout: o executor dos testes tambem escreve nele
  await new Promise(function (r) { setImmediate(r); });
  assert.strictEqual(chamou, 2, 'os dois callbacks rodam');
  assert.strictEqual(saiu, 'ola mundo', 'a codificacao vale');
});

test('H6a2 (1): juntar - a letra com acento partida em dois write sai inteira', () => {
  const escrever = process.stdout.write;
  let saiu = '';
  process.stdout.write = function (t) { saiu += t; return true; };
  try {
    curta.juntar();
    const c = Buffer.from('a\u00e7\u00e3o', 'utf8');
    process.stdout.write(c.subarray(0, 2));
    process.stdout.write(c.subarray(2));
    curta.soltar(comum.pasta('reab-utf8'), 'r1', null);
  } finally { process.stdout.write = escrever; }
  assert.strictEqual(saiu, 'a\u00e7\u00e3o', 'sem U+FFFD: ' + JSON.stringify(saiu));
});

test('H6a2 (1): previa - o ponteiro diz o teto do sworn, que fica abaixo dos 10 mil do Claude Code', () => {
  const p = curta.previa('x\n'.repeat(5000), null, 'c:/r/a.md');
  assert.ok(p.includes('acima do teto de ' + curta.TETO_DA_SAIDA + ' '), 'o teto do sworn no ponteiro: ' + p.slice(0, 200));
  assert.ok(!/mais do que o harness mostra/.test(p), 'a frase que errava o numero saiu');
});

test('H6a2 (1): io.antesDeSair roda quando o gancho falha no modo embutido, e uma vez so', () => {
  const io = require('../scripts/lib/io.js');
  const script = path.join(comum.pasta('reab-script'), 'gancho.js');
  fs.writeFileSync(script, 'const io = require(' + JSON.stringify(require.resolve('../scripts/lib/io.js')) + ');\n' +
    'global.__chamadas = 0;\nio.antesDeSair(function () { global.__chamadas++; });\nthrow new Error("quebrou");\n', 'utf8');
  const escreverErr = process.stderr.write;
  process.stderr.write = function () { return true; };
  try { io.rodarJuntos({}, [script]); } finally { process.stderr.write = escreverErr; }
  assert.strictEqual(global.__chamadas, 1, 'o antesDeSair nao rodou na falha');
  const script2 = path.join(path.dirname(script), 'gancho2.js');
  fs.writeFileSync(script2, 'const io = require(' + JSON.stringify(require.resolve('../scripts/lib/io.js')) + ');\n' +
    'io.antesDeSair(function () { global.__chamadas++; });\nio.permitir();\n', 'utf8');
  io.rodarJuntos({}, [script2]);
  assert.strictEqual(global.__chamadas, 2, 'o antesDeSair roda no io.permitir, e o da falha nao repete');
  delete global.__chamadas;
});
