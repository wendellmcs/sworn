'use strict';
// F4a: o docs/vigentes.md sai por script das revogacoes escritas nas decisoes, sem rodape copiado.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const v = require('../scripts/lib/vigentes.js');

const RAIZ = path.join(__dirname, '..');
const CLI = path.join(RAIZ, 'scripts', 'vigentes.js');

function registro(blocos) {
  return '# Decisoes\n\n' + blocos.map(function (b) { return '### ' + b[0] + ' · ' + b[1] + '\n\n' + (b[2] || '') + '\n'; })
    .join('\n---\n\n');
}
function pares(r) {
  return r.revogacoes.map(function (x) { return x.alvo + '<' + x.por + (x.parte ? ' parte' : ''); }).sort();
}

test('F4a: le cada decisao pelo cabecalho, com o numero e o titulo sem negrito', function () {
  const r = v.analisar(registro([['D1', 'A primeira', 'corpo'], ['D2', '**Segunda** → **com seta**', '']]));
  assert.deepStrictEqual(r.decisoes.map(function (d) { return [d.id, d.titulo]; }),
    [['D1', 'A primeira'], ['D2', 'Segunda → com seta']]);
  assert.deepStrictEqual(r.revogacoes, []);
});

test('F4a: revoga inteira, pelo verbo, pelo rotulo e pelo titulo', function () {
  const r = v.analisar(registro([
    ['D1', 'um'], ['D2', 'dois'], ['D3', 'tres'], ['D4', 'quatro'], ['D10', 'dez'], ['D11', 'onze'],
    ['D5', 'cinco', 'Ficou assim. Revoga a D1; a D10 segue. Fica (revoga a D11) e a D10 vale.'],
    ['D6', 'seis', '**Continua valendo:** D5. **Revoga:** D2.'],
    ['D7', 'sete (revoga a D3)', 'corpo'],
    ['D8', 'oito', 'Escolha do dono; revoga a D4 e a D9 que nao existe.']
  ]));
  assert.deepStrictEqual(pares(r), ['D1<D5', 'D11<D5', 'D2<D6', 'D3<D7', 'D4<D8'].sort(), 'o ; e o ) fecham a clausula');
});

test('F4a: revoga em parte (em parte, so, a parte, paragrafo, letra, trecho citado, barra e intervalo)', function () {
  const blocos = [];
  for (let i = 1; i <= 18; i++) blocos.push(['D' + i, 'd' + i]);
  blocos.push(['D19', 'dezenove (revoga a D15)', 'Revoga a D15 na parte "adiado ate acabar a fila".']);
  blocos.push(['D21', 'vinte e um (corrige a D16)', 'Altera a D17 so no "em paralelo". Emenda a D18 so na ordem. ' +
    'Corrige-se o achado da D1, e altera-se o texto da D2. O git.js com a emenda D3 passa. Altera: D4 e D5 no que citam.']);
  blocos.push(['D20', 'vinte', 'Revoga em parte a D1 (a ressalva) e o teto da D2 (o topo). Revoga a D3 so no sem commit. ' +
    'Revoga a parte da D4 que previa a camada 3. Revoga a D5 §3. Revoga a D6 b; e mais. ' +
    'Revoga o "antes do vigia" da D7. Revoga o ~150K da D8/D9. Revoga, da D10, so a frase. ' +
    'Revoga em parte a D11 e a pratica das D12–D14.']);
  const r = v.analisar(registro(blocos));
  const esperado = [];
  for (let i = 1; i <= 14; i++) esperado.push('D' + i + '<D20 parte');
  esperado.push('D15<D19 parte', 'D16<D21 parte', 'D17<D21 parte', 'D18<D21 parte', 'D4<D21 parte', 'D5<D21 parte');
  assert.deepStrictEqual(pares(r), esperado.sort(), 'o titulo diz inteira, o corpo restringe: vale a parte');
});

test('F4a: a forma passiva diz quem revogou, ou a propria decisao', function () {
  const r = v.analisar(registro([
    ['D1', 'um'], ['D2', 'dois'], ['D3', 'tres'], ['D4', 'quatro'], ['D5', 'cinco'], ['D6', 'seis'], ['D7', 'sete'],
    ['D10', 'dez', 'O modelo da **D1**, revogado pela **D6**, segue citado. A D2 §1 e a D3 ficam revogadas neste ponto. ' +
      'A D4 e REVOGADA: publica-se em portugues. A D5 §8.1 deixa de valer. A D7 fica revogada em parte. ' +
      'A D97 fica revogada, e a D6, revogada pela D98, tambem.']
  ]));
  assert.deepStrictEqual(pares(r), ['D1<D6', 'D2<D10 parte', 'D3<D10', 'D4<D10', 'D5<D10 parte', 'D7<D10 parte'],
    'decisao que nao existe, de um lado ou do outro, nao entra');
});

test('F4a: o que foi recusado, hipotetico ou negado nao e revogacao', function () {
  const r = v.analisar(registro([
    ['D1', 'um'], ['D2', 'dois'], ['D3', 'tres'], ['D4', 'quatro'],
    ['D9', 'nove', 'Recusadas: as duas metades (revoga parte da D1; risco de contar). Recusadas: revogar a D2. ' +
      'Curta e com acento (revogaria a D3). O que saiu fica como esta, sem revogar a D4. Revoga a D9 a si mesma.']
  ]));
  assert.deepStrictEqual(r.revogacoes, []);
});

test('F4a: o texto gerado separa revogadas, revogadas em parte e vigentes, da mais nova para a mais antiga', function () {
  const r = v.analisar(registro([['D1', 'um'], ['D2', 'dois'], ['D3', 'tres'], ['D4', 'quatro', 'Revoga a D1. Revoga em parte a D2.']]));
  const texto = v.gerar(r, 'docs/decisoes.md');
  assert.match(texto, /^# Decisões vigentes/);
  assert.match(texto, /Gerado por `scripts\/vigentes\.js`/);
  const secao = function (titulo) {
    const i = texto.indexOf('\n## ' + titulo);
    assert.ok(i !== -1, 'falta a secao ' + titulo);
    const fim = texto.indexOf('\n## ', i + 1);
    return texto.slice(i, fim === -1 ? texto.length : fim);
  };
  const inteiras = secao('Revogadas (');
  const parciais = secao('Revogadas ou alteradas em parte');
  const vig = secao('Vigentes');
  assert.match(inteiras, /\| D1 \| um \| D4 \|/, 'a revogada inteira, na tabela dela, diz quem revogou');
  assert.doesNotMatch(inteiras, /\| D2 \|/, 'a revogada em parte nao vai para a tabela das inteiras');
  assert.match(parciais, /\| D2 \| dois \| D4 \|/, 'a revogada em parte, na tabela dela');
  assert.doesNotMatch(parciais, /\| D1 \|/);
  const pos = ['D4 · quatro', 'D3 · tres', 'D2 · dois'].map(function (s) { return vig.indexOf(s); });
  assert.ok(pos.every(function (p) { return p !== -1; }), 'as vigentes estao todas na lista');
  assert.ok(pos[0] < pos[1] && pos[1] < pos[2], 'mais nova primeiro');
  assert.doesNotMatch(vig, /D1 · um/, 'a revogada inteira sai das vigentes');
  assert.match(vig, /D2 · dois \(em parte: D4\)/, 'a revogada em parte fica, marcada');
});

test('F4a: o rodape copiado e cobrado; o resto da linha nao', function () {
  assert.deepStrictEqual(v.rodapes('a\n**Continua valendo:** D1, D2.\nb\nfim. **Continua valendo:** D3. **Revoga:** D2.\n'),
    [2, 4]);
  assert.deepStrictEqual(v.rodapes('O rodape "Continua valendo" saiu.\n'), []);
});

test('F4a: o comando grava, confere e reprova o vigentes velho ou o rodape novo', function () {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-vigentes-'));
  // Pasta com espaco: o comando de conserto poe os caminhos entre aspas, em qualquer maquina.
  const dir = path.join(base, 'com espaco');
  fs.mkdirSync(dir);
  try {
    const dec = path.join(dir, 'decisoes.md');
    const saida = path.join(dir, 'vigentes.md');
    fs.writeFileSync(dec, registro([['D1', 'um'], ['D2', 'dois', 'Revoga a D1.']]));
    const rodar = function (args) {
      return spawnSync(process.execPath, [CLI, '--decisoes', dec, '--saida', saida].concat(args), { encoding: 'utf8' });
    };
    let r = rodar(['--conferir']);
    assert.strictEqual(r.status, 1, 'sem o arquivo, a conferencia reprova');
    assert.match(r.stdout, /--gravar/, 'e diz como gerar');
    r = rodar(['--gravar']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(fs.readFileSync(saida, 'utf8'), /\| D1 \| um \| D2 \|/);
    assert.strictEqual(rodar(['--conferir']).status, 0, 'em dia');
    fs.writeFileSync(saida, fs.readFileSync(saida, 'utf8').replace(/\n/g, '\r\n'));
    assert.strictEqual(rodar(['--conferir']).status, 0, 'o git do Windows poe CRLF na saida: segue em dia');
    fs.appendFileSync(dec, '\n---\n\n### D3 · tres\n\nCorpo.\n');
    r = rodar(['--conferir']);
    assert.strictEqual(r.status, 1, 'decisao nova sem gerar de novo');
    assert.match(r.stdout, /difere do que o registro gera/);
    const conserto = JSON.parse(r.stdout).problemas[0];
    assert.ok(conserto.indexOf('--gravar --decisoes "' + dec + '" --saida "' + saida + '"') !== -1,
      'o conserto repete os dois caminhos passados, entre aspas: ' + conserto);
    assert.strictEqual(rodar(['--gravar']).status, 0);
    fs.appendFileSync(dec, '\n**Continua valendo:** D2.\n');
    assert.strictEqual(rodar(['--gravar']).status, 0, 'o rodape nao impede gravar');
    r = rodar(['--conferir']);
    assert.strictEqual(r.status, 1, 'rodape novo reprova mesmo com o vigentes em dia');
    assert.strictEqual(JSON.parse(r.stdout).problemas.length, 1, 'so o rodape: ' + r.stdout);
    assert.match(r.stdout, /Continua valendo/);
    assert.match(r.stdout, /o --gravar nao os tira/, 'o rodape se apaga a mao');
    const sem = spawnSync(process.execPath, [CLI, '--decisoes', path.join(dir, 'nao-existe.md'), '--conferir'], { encoding: 'utf8' });
    assert.strictEqual(sem.status, 2, 'sem o registro, erro de uso');
    assert.match(sem.stderr, /^ERRO: nao deu para ler o registro .*nao-existe\.md/);
    assert.doesNotMatch(sem.stderr, /\n\s+at /, 'sem pilha do Node');
    const outra = path.join(dir, 'outra.md');
    const so = spawnSync(process.execPath, [CLI, '--decisoes', dec, '--saida', outra], { encoding: 'utf8' });
    assert.strictEqual(so.status, 0);
    assert.deepStrictEqual(JSON.parse(so.stdout), { decisoes: 3, revogacoes: 1, emParte: 0 }, 'sem modo, so as contagens');
    assert.ok(!fs.existsSync(outra), 'sem modo, nao grava');
    // O nome do registro no cabecalho e relativo a pasta atual e com barra normal, em qualquer sistema.
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.copyFileSync(dec, path.join(dir, 'sub', 'dec.md'));
    const rel = spawnSync(process.execPath, [CLI, '--decisoes', path.join('sub', 'dec.md'), '--saida', 'v.md', '--gravar'],
      { encoding: 'utf8', cwd: dir });
    assert.strictEqual(rel.status, 0, rel.stderr);
    assert.match(fs.readFileSync(path.join(dir, 'v.md'), 'utf8'), /a partir de `sub\/dec\.md` \(3 decisões\)/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('F4a: o comando recusa uso errado, registro vazio ou com defeito e erro de gravacao, sem pilha do Node', function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-vigentes-'));
  try {
    const dec = path.join(dir, 'decisoes.md');
    fs.writeFileSync(dec, registro([['D1', 'um'], ['D2', 'dois', 'Revoga a D1.']]));
    const rodar = function (args, cwd) {
      return spawnSync(process.execPath, [CLI].concat(args), { encoding: 'utf8', cwd: cwd || dir });
    };
    const erroDeUso = function (args, motivo, cwd) {
      const r = rodar(args, cwd);
      assert.strictEqual(r.status, 2, motivo + ': ' + r.stdout + r.stderr);
      assert.match(r.stderr, /^ERRO: /, motivo + ': a mensagem e a do comando');
      assert.doesNotMatch(r.stderr, /\n\s+at /, motivo + ': sem pilha do Node');
      return r;
    };
    erroDeUso(['--decisoes', dec, '--saida', '--gravar'], 'a opcao sem valor nao toma o flag seguinte');
    assert.ok(!fs.existsSync(path.join(dir, '--gravar')), 'nao grava num arquivo chamado --gravar');
    erroDeUso(['--decisoes', dec, '--gravar', '--saida'], 'a opcao no fim, sem valor');
    assert.match(erroDeUso(['--decisoes', dec, '--gravr'], 'opcao desconhecida').stderr, /opcao desconhecida: --gravr/);
    erroDeUso(['--decisoes', dec, '--saida', path.join(dir, 'w.md'), '--gravar', '--conferir'], 'os dois modos juntos');
    assert.ok(!fs.existsSync(path.join(dir, 'w.md')), 'os dois modos juntos nao gravam');
    const semPasta = path.join(dir, 'nao', 'existe', 'v.md');
    assert.ok(erroDeUso(['--decisoes', dec, '--gravar', '--saida', semPasta], 'pasta que nao existe').stderr
      .indexOf('nao deu para gravar ' + semPasta + ' (') !== -1, 'diz o arquivo e a causa');
    const pasta = rodar(['--decisoes', dec, '--conferir', '--saida', dir]);
    assert.strictEqual(pasta.status, 1);
    assert.match(pasta.stdout, /nao deu para ler .*EISDIR/, 'a saida que nao se le nao vira "falta", e diz a causa');
    assert.doesNotMatch(pasta.stdout, /"falta /);
    const vazio = path.join(dir, 'vazio.md');
    fs.writeFileSync(vazio, '# Decisoes\n\nnada aqui\n');
    assert.match(erroDeUso(['--decisoes', vazio, '--gravar', '--saida', path.join(dir, 'v.md')], 'registro sem decisao').stderr,
      /nenhuma decisao/);
    assert.ok(!fs.existsSync(path.join(dir, 'v.md')), 'o registro vazio nao grava lista vazia');
    const torto = path.join(dir, 'torto.md');
    fs.writeFileSync(torto, registro([['D1', 'um'], ['D2', 'dois']]) + '\n---\n\n### D3 — tres\n\n### D2 · de novo\n');
    const t = erroDeUso(['--decisoes', torto, '--gravar', '--saida', path.join(dir, 'v.md')], 'registro com defeito');
    assert.match(t.stderr, /numero repetido \(D2\)/);
    const linhaTorta = fs.readFileSync(torto, 'utf8').split('\n').indexOf('### D3 — tres') + 1;
    assert.match(t.stderr, new RegExp('linha\\(s\\) ' + linhaTorta + ';'), 'aponta a linha do cabecalho torto');
    // Sem o caminho, que vem da pasta temporaria da maquina e pode ter acento.
    assert.doesNotMatch(t.stderr.split(torto).join(''), /[^\x20-\x7e\n]/, 'a mensagem sai em ASCII');
    assert.ok(!fs.existsSync(path.join(dir, 'v.md')), 'o registro com defeito nao grava');
    const muitos = path.join(dir, 'muitos.md');
    let corpo = registro([['D1', 'um']]);
    for (let i = 2; i <= 13; i++) corpo += '\n### D' + i + ' - torto\n';
    fs.writeFileSync(muitos, corpo);
    assert.match(erroDeUso(['--decisoes', muitos, '--gravar', '--saida', path.join(dir, 'v.md')], 'muitos tortos').stderr,
      / e mais 2;/, 'a lista cortada diz quantos faltam');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('F4a: o rotulo sem ponto, a frase com numero, a passiva recusada e a decisao de contexto', function () {
  const r = v.analisar(registro([
    ['D1', 'um'], ['D2', 'dois'], ['D3', 'tres'], ['D4', 'quatro'], ['D5', 'cinco'], ['D6', 'seis'], ['D7', 'sete'],
    ['D8', 'oito'], ['D9', 'nove'], ['D11', 'onze'], ['D12', 'doze'], ['D13', 'treze'], ['D14', 'catorze'],
    ['D15', 'quinze', '**Recusadas:**\n\n- opcao C: revoga a D13.\n\nRecusadas:\n\n1. revoga a D14.'],
    ['D10', 'dez', '**Revoga:** D1\n**Relaciona:** D2, D3.\n\nRecusadas: a opcao B. A versao 0.31.0 revoga a D4. ' +
      'Recusadas: deixar a D5 revogada. Revoga a D6, que nasceu da D7. Recusadas: a 0.31.0 revoga a D8.\n\n' +
      '**Recusadas:**\n- opcao A: algo.\n- opcao B: revoga a D9.\n\nRevoga a D11 a partir de hoje. Revoga a D12 o resto.']
  ]));
  assert.deepStrictEqual(pares(r), ['D1<D10', 'D11<D10', 'D12<D10', 'D4<D10', 'D6<D10'].sort(),
    'o rotulo seguinte, a passiva recusada, o item da lista recusada e a decisao de contexto nao entram; o artigo ' +
    'depois do numero nao e letra de parte');
});

test('F4a: a revogacao em parte, que le a clausula inteira, para no ;, no ), no rotulo seguinte e no paragrafo', function () {
  const blocos = [];
  for (let i = 1; i <= 20; i++) blocos.push(['D' + i, 'd' + i]);
  blocos.push(['D40', 'quarenta', 'Revoga em parte a D1; a D2 segue. Fica (revoga em parte a D3) e a D4 vale. ' +
    '**Revoga:** o trecho da D5\n**Relaciona:** D6.\n\nRevoga o trecho da D7\n\nA D8 segue citada. ' +
    'Revoga em parte a D9 - 20 regras. Revoga em parte a D10 e o hash MD11.\n- Revoga a D12\n- so o titulo muda.']);
  const r = v.analisar(registro(blocos));
  assert.deepStrictEqual(pares(r), ['D1<D40 parte', 'D10<D40 parte', 'D12<D40', 'D3<D40 parte', 'D5<D40 parte', 'D7<D40 parte', 'D9<D40 parte'].sort(),
    'o item de lista seguinte fecha a oracao');
});

test('F4a: o intervalo pede D nas duas pontas; o contrario fica nas pontas; MD5 nao e decisao; CRLF nao muda nada', function () {
  const blocos = [];
  for (let i = 1; i <= 20; i++) blocos.push(['D' + i, 'd' + i]);
  blocos.push(['D600', 'seiscentos']);
  blocos.push(['D30', 'trinta', 'Revoga a D5 - 20 regras. Revoga a D14–D12. Revoga a D9 e o hash MD5. ' +
    'Revoga em parte a D1–D600.']);
  const texto = registro(blocos);
  const r = v.analisar(texto);
  assert.deepStrictEqual(pares(r), ['D12<D30', 'D14<D30', 'D5<D30', 'D9<D30', 'D1<D30 parte', 'D600<D30 parte'].sort(),
    'o intervalo de 500 ou mais fica so com as pontas');
  assert.strictEqual(v.gerar(v.analisar(texto.replace(/\n/g, '\r\n')), 'x'), v.gerar(r, 'x'));
  const comDefeito = texto + '\n### D3 · repetida\n\n###D40 · sem espaco\n';
  const defeito = v.analisar(comDefeito);
  assert.deepStrictEqual(defeito.repetidas, ['D3']);
  assert.deepStrictEqual(defeito.cabecalhosTortos, [comDefeito.split('\n').indexOf('###D40 · sem espaco') + 1]);
});

test('F4a: o docs/vigentes.md deste repositorio esta em dia e o registro nao tem rodape copiado', { skip: !fs.existsSync(path.join(RAIZ, 'docs', 'decisoes.md')) && 'sem docs/ (pacote publico)' }, function () {
  const r = spawnSync(process.execPath, [CLI, '--conferir'], { cwd: RAIZ, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});
