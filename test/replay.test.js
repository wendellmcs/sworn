'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

// A pasta temporaria do sworn deste arquivo de teste: o replay guarda nela, nunca na de verdade.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-replay-teste-'));
process.env.SWORN_TMP = TMP;
const rp = require('../scripts/lib/replay.js');
const MIN = 60 * 1000;

let contador = 0;
/** Uma pasta de projeto nova por teste, com os arquivos dados ({ nome: texto }). */
function projeto(arquivos) {
  const dir = fs.mkdtempSync(path.join(TMP, 'proj-'));
  for (const [nome, texto] of Object.entries(arquivos || {})) fs.writeFileSync(path.join(dir, nome), texto);
  return dir;
}
const sessao = () => 'sessao-' + (++contador);
/** Uma edicao como o mod a faz: o antes, a escrita, o depois. */
function editar(s, turno, arquivo, texto, agora) {
  rp.guardar(s, turno, 'antes', arquivo, agora);
  fs.writeFileSync(arquivo, texto);
  return rp.guardar(s, turno, 'depois', arquivo, agora);
}

test('guardar e texto: por arquivo, as linhas de antes (-) e de depois (+), o arquivo novo e ha quanto tempo', () => {
  const dir = projeto({ 'a.txt': 'um\ndois\ntres\n' });
  const s = sessao();
  assert.strictEqual(editar(s, 't1', path.join(dir, 'a.txt'), 'um\nDOIS\ntres\nquatro\n', 10 * MIN), 'guardou');
  editar(s, 't1', path.join(dir, 'novo.md'), 'x\n', 10 * MIN);
  const t = rp.texto(rp.ler(s), 13 * MIN, dir);
  assert.strictEqual(t.split('\n\nSó entram')[0], [
    'Edições do último turno que mexeu em arquivos (há 3 min): 2 arquivos.',
    '',
    'a.txt (+2 -1)',
    '  linha 2:',
    '  - dois',
    '  + DOIS',
    '  linha 4:',
    '  + quatro',
    '',
    'novo.md (arquivo novo, +1)',
    '  linha 1:',
    '  + x'].join('\n'));
  assert.match(t, /\n\nSó entram as edições das ferramentas de edição do Claude \(Edit, Write, MultiEdit e NotebookEdit\), também as dos subagentes; o que o shell mudou não aparece\. O antes e o depois ficam só nesta máquina, na pasta temporária do sworn\.$/);
  assert.match(rp.texto(rp.ler(s), 10 * MIN + 30000, dir), /\(há menos de 1 min\): 2 arquivos\./);
  // sem a hora, ou com a hora antes da gravacao, nada de "ha"
  assert.match(rp.texto(rp.ler(s), undefined, dir), /^Edições do último turno que mexeu em arquivos: 2 arquivos\./);
  assert.match(rp.texto(rp.ler(s), 5 * MIN, dir), /^Edições do último turno que mexeu em arquivos: 2 arquivos\./);
});

test('no mesmo turno o antes e o da 1a edicao e o depois o da ultima; turno novo apaga as copias do anterior', () => {
  const dir = projeto({ 'a.txt': 'original\n', 'b.txt': 'b\n', 'c.txt': 'c\n' });
  const s = sessao();
  const a = path.join(dir, 'a.txt');
  editar(s, 't1', a, 'meio\n');
  assert.strictEqual(rp.guardar(s, 't1', 'antes', a), 'ja-tinha');
  fs.writeFileSync(a, 'fim\n');
  rp.guardar(s, 't1', 'depois', a);
  // um 2o arquivo no t1: as copias dele (1.antes e 1.depois) tambem saem no turno novo
  editar(s, 't1', path.join(dir, 'c.txt'), 'C\n');
  assert.match(rp.texto(rp.ler(s), 0, dir), /a\.txt \(\+1 -1\)\n  linha 1:\n  - original\n  \+ fim\n/);
  // o turno t2 edita outro arquivo: o t1 some, com as copias dele
  editar(s, 't2', path.join(dir, 'b.txt'), 'B\n');
  const t = rp.texto(rp.ler(s), 0, dir);
  assert.doesNotMatch(t, /a\.txt/);
  assert.match(t, /: 1 arquivo\.\n\nb\.txt \(\+1 -1\)/);
  assert.deepStrictEqual(fs.readdirSync(rp.pastaDaSessao(s)).sort(), ['0.antes', '0.depois', 'indice.json']);
});

test('o que nao guarda: depois sem antes, outro turno, fase errada, sem turno ou sem caminho', () => {
  const dir = projeto({ 'a.txt': 'a\n' });
  const s = sessao();
  const a = path.join(dir, 'a.txt');
  assert.strictEqual(rp.guardar(s, 't1', 'depois', a), 'ignorou');
  assert.strictEqual(rp.ler(s), null);
  rp.guardar(s, 't1', 'antes', a);
  assert.strictEqual(rp.guardar(s, 't9', 'depois', a), 'ignorou');
  assert.strictEqual(rp.guardar(s, 't1', 'depois', path.join(dir, 'outro.txt')), 'ignorou');
  assert.strictEqual(rp.guardar(s, 't1', 'durante', a), 'ignorou');
  assert.strictEqual(rp.guardar(s, '', 'antes', a), 'ignorou');
  assert.strictEqual(rp.guardar(s, 't1', 'antes', ''), 'ignorou');
  assert.strictEqual(rp.guardar(s, 't1', 'antes', null), 'ignorou');
  // so o antes, sem o depois nem o descartar (a edicao que caiu antes de o mod chamar um dos dois)
  assert.match(rp.texto(rp.ler(s), 0, dir), /\n\na\.txt: a edição não terminou \(recusada ou com erro\): nada mudou\.\n/);
});

test('descartar: a edicao recusada ou com erro tira o item sem depois e a copia de antes; o ja editado fica', () => {
  const dir = projeto({ 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n' });
  const s = sessao();
  const [a, b, c] = ['a.txt', 'b.txt', 'c.txt'].map((f) => path.join(dir, f));
  const pasta = rp.pastaDaSessao(s);
  assert.strictEqual(rp.guardar(s, 't1', 'descartar', a), 'ignorou');
  editar(s, 't1', a, 'A\n');
  rp.guardar(s, 't1', 'antes', b);
  assert.ok(fs.existsSync(path.join(pasta, '1.antes')));
  assert.strictEqual(rp.guardar(s, 't1', 'descartar', b), 'descartou');
  assert.ok(!fs.existsSync(path.join(pasta, '1.antes')));
  assert.deepStrictEqual(rp.ler(s).arquivos.map((x) => path.basename(x.caminho)), ['a.txt']);
  // o arquivo que outra edicao deste turno ja mudou: a 2a, recusada, nao apaga o antes da 1a
  rp.guardar(s, 't1', 'antes', a);
  assert.strictEqual(rp.guardar(s, 't1', 'descartar', a), 'ignorou');
  assert.ok(fs.existsSync(path.join(pasta, '0.antes')));
  // de outro turno ou de arquivo sem antes: nada
  rp.guardar(s, 't1', 'antes', c);
  assert.strictEqual(rp.guardar(s, 't9', 'descartar', c), 'ignorou');
  assert.strictEqual(rp.guardar(s, 't1', 'descartar', path.join(dir, 'outro.txt')), 'ignorou');
  assert.strictEqual(rp.ler(s).arquivos.length, 2);
  assert.strictEqual(rp.guardar(s, 't1', 'descartar', c), 'descartou');
  assert.match(rp.texto(rp.ler(s), 0, dir), /: 1 arquivo\.\n\na\.txt \(\+1 -1\)\n/);
  // o turno em que toda edicao foi recusada: nem o texto de nenhuma edicao, nem o do turno anterior
  rp.guardar(s, 't2', 'antes', b);
  rp.guardar(s, 't2', 'descartar', b);
  assert.deepStrictEqual(fs.readdirSync(pasta), ['indice.json']);
  assert.strictEqual(rp.texto(rp.ler(s), 0, dir),
    'O último turno com edição não mudou nenhum arquivo: as edições dele foram recusadas ou deram erro.');
});

test('o que nao se mostra linha por linha: grande, binario, apagado, pasta, a copia sumida ou que falhou, o que voltou', () => {
  const dir = projeto({ 'g.txt': 'x'.repeat(rp.MAX_BYTES + 1), 'b.bin': 'a\u0000b', 'some.txt': 's\n', 'volta.txt': 'v\n',
    'sumiu.txt': 'q\n' });
  const s = sessao();
  editar(s, 't1', path.join(dir, 'g.txt'), 'pequeno\n');
  editar(s, 't1', path.join(dir, 'b.bin'), 'texto\n');
  rp.guardar(s, 't1', 'antes', path.join(dir, 'some.txt'));
  fs.unlinkSync(path.join(dir, 'some.txt'));
  rp.guardar(s, 't1', 'depois', path.join(dir, 'some.txt'));
  editar(s, 't1', path.join(dir, 'volta.txt'), 'v\n');
  editar(s, 't1', path.join(dir, 'sumiu.txt'), 'Q\n');
  fs.unlinkSync(path.join(rp.pastaDaSessao(s), '4.antes'));
  // no limite exato de 1 MB ainda copia; a copia de depois sumida; uma pasta no lugar do arquivo nao e arquivo
  fs.writeFileSync(path.join(dir, 'limite.txt'), 'z'.repeat(rp.MAX_BYTES));
  editar(s, 't1', path.join(dir, 'limite.txt'), 'pequeno\n');
  editar(s, 't1', path.join(dir, 'sumiu2.txt'), 'R\n');
  fs.unlinkSync(path.join(rp.pastaDaSessao(s), '6.depois'));
  fs.mkdirSync(path.join(dir, 'pasta'));
  assert.strictEqual(rp.guardar(s, 't1', 'antes', path.join(dir, 'pasta')), 'guardou');
  assert.strictEqual(rp.guardar(s, 't1', 'depois', path.join(dir, 'pasta')), 'guardou');
  const t = rp.texto(rp.ler(s), 0, dir);
  assert.match(t, /\nlimite\.txt \(\+1 -1\)\n  linha 1:\n  - z+…\n  \+ pequeno\n/);
  assert.match(t, /\nsumiu2\.txt: a cópia guardada sumiu da pasta temporária \(o sistema pode tê-la limpado\): o arquivo segue onde estava; abra-o para ver como ele ficou\.\n/);
  assert.match(t, /\npasta: não é um arquivo \(é uma pasta\): não tem linhas para mostrar\.\n/);
  assert.match(t, new RegExp('\\ng\\.txt: grande demais para mostrar \\(mais de ' + rp.MAX_BYTES / 1000000 + ' MB\\): abra-o para ver como ele ficou\\.\\n'));
  assert.match(t, /\nb\.bin: arquivo binário: não tem linhas para mostrar\.\n/);
  assert.match(t, /\nsome\.txt: o arquivo não existe mais depois da edição\.\n/);
  assert.match(t, /\nvolta\.txt: sem mudança no fim do turno \(o que foi editado voltou a ser o que era\)\.\n/);
  assert.match(t, /\nsumiu\.txt: a cópia guardada sumiu da pasta temporária \(o sistema pode tê-la limpado\): o arquivo segue onde estava; abra-o para ver como ele ficou\.\n/);
  assert.match(t, /: 8 arquivos\./);
});

test('a copia que falha (o destino e uma pasta) vira estado, nunca excecao; a edicao segue no indice', () => {
  const dir = projeto({ 'a.txt': 'a\n', 'b.txt': 'b\n' });
  const s = sessao();
  editar(s, 't1', path.join(dir, 'a.txt'), 'A\n');
  const pasta = rp.pastaDaSessao(s);
  fs.unlinkSync(path.join(pasta, '0.antes'));
  fs.mkdirSync(path.join(pasta, '0.antes'));
  assert.strictEqual(editar(s, 't2', path.join(dir, 'b.txt'), 'B\n'), 'guardou');
  assert.match(rp.texto(rp.ler(s), 0, dir), /\nb\.txt: o sworn não conseguiu copiar o arquivo \(sem permissão de leitura, ou o disco cheio\): abra-o para ver como ele ficou\.\n/);
});

test('as linhas: remocao so com a linha de antes, CRLF igual a LF, controle e direcao limpos, a longa cortada', () => {
  const dir = projeto({ 'r.txt': 'a\nb\nc\n', 'w.txt': 'x\r\ny\r\n', 'l.txt': 'curta\n', 'e.txt': 'p\r\nq\r\n',
    'n.txt': 'p\nq' });
  const s = sessao();
  editar(s, 't1', path.join(dir, 'r.txt'), 'a\nc\n');
  editar(s, 't1', path.join(dir, 'w.txt'), 'x\ny\nz\n');
  editar(s, 't1', path.join(dir, 'l.txt'), 'curta\n\u001b[2J\tfim\n' + 'y'.repeat(200) + '\n' +
    'w'.repeat(rp.MAX_COLUNAS) + '\nc1\u009bfim\n' + 'a'.repeat(rp.MAX_COLUNAS - 2) + '\ud83d\ude00zz\n' +
    'x\u202ey\u2066z\u2028w\u200fv\n');
  // so o fim de linha mudou (CRLF para LF; a quebra no fim); o arquivo novo vazio
  editar(s, 't1', path.join(dir, 'e.txt'), 'p\nq\n');
  editar(s, 't1', path.join(dir, 'n.txt'), 'p\nq\n');
  editar(s, 't1', path.join(dir, 'vazio.txt'), '');
  const t = rp.texto(rp.ler(s), 0, dir);
  assert.match(t, /\ne\.txt: mudou só o fim de linha \(CRLF e LF, ou a quebra de linha no fim do arquivo\)\.\n/);
  assert.match(t, /\nn\.txt: mudou só o fim de linha /);
  assert.match(t, /\nvazio\.txt: arquivo novo, vazio\.\n/);
  // o emoji no ponto do corte sai inteiro (sem a metade); a direcao do texto e a quebra Unicode viram '?'
  assert.ok(t.includes('\n  + ' + 'a'.repeat(rp.MAX_COLUNAS - 2) + '…\n'), 'o corte nao parte o emoji');
  assert.match(t, /\n  \+ x\?y\?z\?w\?v\n/);
  assert.ok(t.includes('\n  + ' + 'w'.repeat(rp.MAX_COLUNAS) + '\n'), 'a linha do tamanho exato do teto sai inteira');
  assert.match(t, /\n  \+ c1\?fim\n/);
  assert.match(t, /\nr\.txt \(\+0 -1\)\n  linha 2 de antes:\n  - b\n/);
  assert.match(t, /\nw\.txt \(\+1 -0\)\n  linha 3:\n  \+ z\n/);
  assert.match(t, /\n  \+ \?\[2J  fim\n/);
  assert.ok(t.includes('\n  + ' + 'y'.repeat(rp.MAX_COLUNAS - 1) + '…\n'), 'a linha longa sai cortada com "…"');
});

test('os tetos: linhas por arquivo, linhas no total e arquivos por turno', () => {
  const muitas = (n, p) => Array.from({ length: n }, (_, i) => p + i).join('\n') + '\n';
  const dir = projeto({ 'p1.txt': '', 'p2.txt': '', 'p3.txt': '', 'p4.txt': '', 'p5.txt': '' });
  const s = sessao();
  for (const n of ['p1', 'p2', 'p3', 'p4', 'p5']) editar(s, 't1', path.join(dir, n + '.txt'), muitas(100, n + '-'));
  const t = rp.texto(rp.ler(s), 0, dir);
  // L por arquivo: 4 arquivos passam do total T (o 4o mostra T - 3L, o 5o so o nome)
  const L = rp.MAX_LINHAS_ARQUIVO, T = rp.MAX_LINHAS;
  assert.ok(T - 3 * L > 0 && T - 3 * L < L && 100 > L, 'os tetos deste teste');
  assert.match(t, new RegExp('\\n  \\+ p1-' + (L - 1) + '\\n  \\.\\.\\. mais ' + (100 - L) + ' linhas mudadas neste arquivo: abra-o para ver\\.\\n'));
  assert.match(t, new RegExp('\\n  \\+ p4-' + (T - 3 * L - 1) + '\\n  \\.\\.\\. mais ' + (100 - (T - 3 * L)) + ' linhas mudadas neste arquivo: abra-o para ver\\.\\n'));
  assert.match(t, new RegExp('\\np5\\.txt \\(\\+100 -0\\)\\n  \\(as linhas ficaram de fora: o texto chegou a ' + T + ' linhas; abra o arquivo para ver\\)\\n'));
  assert.strictEqual(t.split('\n').filter((l) => /^  \+ /.test(l)).length, rp.MAX_LINHAS);
  // um so arquivo com uma linha mudada a mais que o teto: "mais 1 linha mudada"
  const s2 = sessao();
  editar(s2, 't1', path.join(dir, 'q.txt'), muitas(rp.MAX_LINHAS_ARQUIVO + 1, 'q'));
  assert.match(rp.texto(rp.ler(s2), 0, dir), new RegExp('\\n  \\+ q' + (L - 1) + '\\n  \\.\\.\\. mais 1 linha mudada neste arquivo'));
  // 2 arquivos acima do teto de arquivos: ficam de fora e contam no total
  const s3 = sessao();
  const dir3 = projeto();
  for (let i = 0; i < rp.MAX_ARQUIVOS + 2; i++) {
    const r = editar(s3, 't1', path.join(dir3, 'f' + i + '.txt'), 'f\n');
    if (i >= rp.MAX_ARQUIVOS) assert.strictEqual(r, 'ignorou');
  }
  const t3 = rp.texto(rp.ler(s3), 0, dir3);
  assert.match(t3, new RegExp(': ' + (rp.MAX_ARQUIVOS + 2) + ' arquivos\\.'));
  assert.match(t3, new RegExp('\\n2 arquivos ficaram de fora: o /sworn-replay guarda até ' + rp.MAX_ARQUIVOS +
    ' por turno \\(no projeto com git, o git diff mostra todos\\)\\.\\n'));
});

test('o nome: relativo a pasta da sessao com barra normal; fora dela, o caminho inteiro; no Windows, a grafia nao conta', () => {
  const dir = projeto();
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.mkdirSync(path.join(dir, 'minha pasta'));
  const fora = projeto({ 'f.txt': 'f\n' });
  const s = sessao();
  editar(s, 't1', path.join(dir, 'sub', 'x.txt'), 'x\n');
  editar(s, 't1', path.join(dir, 'minha pasta', 'ação.txt'), 'a\n');
  editar(s, 't1', path.join(fora, 'f.txt'), 'F\n');
  const t = rp.texto(rp.ler(s), 0, dir);
  assert.match(t, /\nsub\/x\.txt \(arquivo novo, \+1\)\n/);
  assert.match(t, /\nminha pasta\/ação\.txt \(arquivo novo, \+1\)\n/);
  assert.ok(t.includes('\n' + path.join(fora, 'f.txt') + ' (+1 -1)\n'), 'o de fora sai com o caminho inteiro');
  if (process.platform === 'win32') {
    assert.strictEqual(rp.guardar(s, 't1', 'antes', path.join(dir, 'SUB', 'X.TXT')), 'ja-tinha');
    assert.strictEqual(rp.guardar(s, 't1', 'antes', path.join(dir, 'MINHA PASTA', 'AÇÃO.TXT')), 'ja-tinha');
  }
});

test('a pasta da sessao: o id vira nome seguro; a de outra sessao sem uso ha 7 dias sai no turno novo, a recente fica', () => {
  assert.strictEqual(path.dirname(rp.pastaDaSessao('../../fora')), path.join(TMP, 'sworn', 'replay'));
  assert.strictEqual(path.basename(rp.pastaDaSessao('../../fora')), '------fora');
  assert.strictEqual(path.basename(rp.pastaDaSessao(undefined)), 'sem-sessao');
  // a barra do Windows e o caminho absoluto tambem viram nome
  assert.strictEqual(path.dirname(rp.pastaDaSessao('..\\..\\fora')), path.join(TMP, 'sworn', 'replay'));
  assert.strictEqual(path.basename(rp.pastaDaSessao('C:\\fora')), 'C--fora');
  assert.strictEqual(path.basename(rp.pastaDaSessao('/etc')), '-etc');
  const dir = projeto({ 'a.txt': 'a\n' });
  const velha = sessao(), nova = sessao(), atual = sessao();
  editar(velha, 't1', path.join(dir, 'a.txt'), 'b\n');
  editar(nova, 't1', path.join(dir, 'a.txt'), 'c\n');
  const antigo = (Date.now() - rp.IDADE_MS - MIN) / 1000;
  fs.utimesSync(path.join(rp.pastaDaSessao(velha), 'indice.json'), antigo, antigo);
  // a pasta recente sem indice (a que outra sessao acabou de criar) fica; a velha sem indice sai
  const raiz = path.dirname(rp.pastaDaSessao('x'));
  fs.mkdirSync(path.join(raiz, 'avulsa-recente'));
  fs.mkdirSync(path.join(raiz, 'avulsa-velha'));
  fs.utimesSync(path.join(raiz, 'avulsa-velha'), antigo, antigo);
  // a velha com um arquivo de outro nome: o arquivo fica, e a pasta com ele; a copia dela sai
  fs.mkdirSync(path.join(raiz, 'avulsa-alheia'));
  fs.writeFileSync(path.join(raiz, 'avulsa-alheia', 'meu.txt'), 'nao apague');
  fs.writeFileSync(path.join(raiz, 'avulsa-alheia', '3.antes'), 'copia');
  fs.utimesSync(path.join(raiz, 'avulsa-alheia'), antigo, antigo);
  // a sessao atual com o turno anterior velho: o turno novo nao apaga a propria pasta
  editar(atual, 't0', path.join(dir, 'a.txt'), 'c2\n');
  fs.utimesSync(path.join(rp.pastaDaSessao(atual), 'indice.json'), antigo, antigo);
  fs.utimesSync(rp.pastaDaSessao(atual), antigo, antigo);
  assert.strictEqual(editar(atual, 't1', path.join(dir, 'a.txt'), 'd\n', Date.now()), 'guardou');
  assert.match(rp.texto(rp.ler(atual), 0, dir), /\na\.txt \(\+1 -1\)\n  linha 1:\n  - c2\n  \+ d\n/);
  assert.ok(!fs.existsSync(rp.pastaDaSessao(velha)), 'a velha saiu');
  assert.ok(fs.existsSync(rp.pastaDaSessao(nova)), 'a recente ficou');
  assert.ok(fs.existsSync(path.join(raiz, 'avulsa-recente')), 'a recente sem indice ficou');
  assert.ok(!fs.existsSync(path.join(raiz, 'avulsa-velha')), 'a velha sem indice saiu');
  assert.ok(fs.existsSync(path.join(raiz, 'avulsa-alheia', 'meu.txt')), 'o arquivo de outro nome ficou');
  assert.ok(!fs.existsSync(path.join(raiz, 'avulsa-alheia', '3.antes')), 'a copia da velha saiu');
});

test('a pasta so do dono: 0700 e as copias 0600; um arquivo ou link no lugar dela, nada se copia nem se le', () => {
  const dir = projeto({ 'a.txt': 'a\n' });
  const s = sessao();
  editar(s, 't1', path.join(dir, 'a.txt'), 'b\n');
  const pasta = rp.pastaDaSessao(s);
  if (process.platform !== 'win32') {
    assert.strictEqual(fs.statSync(pasta).mode & 0o777, 0o700);
    for (const f of ['0.antes', '0.depois', 'indice.json']) assert.strictEqual(fs.statSync(path.join(pasta, f)).mode & 0o777, 0o600, f);
  }
  // um arquivo com o nome da pasta da sessao: guardar lanca (o replay.js sai 1) e ler da nada
  const s2 = sessao();
  fs.writeFileSync(rp.pastaDaSessao(s2), 'nao e pasta');
  assert.throws(() => rp.guardar(s2, 't1', 'antes', path.join(dir, 'a.txt')));
  assert.strictEqual(rp.ler(s2), null);
  // o link no lugar da pasta (outro usuario pode cria-lo antes; no Windows, a juncao, que nao pede administrador):
  // nem copia nem le o indice de la
  const alvo = projeto();
  const ca = path.resolve(dir, 'a.txt');
  // o 2o item e o a.txt sem depois: o descartar pela juncao apagaria a copia de la
  fs.writeFileSync(path.join(alvo, 'indice.json'), JSON.stringify({ turno: 't1', em: 0, fora: 0, arquivos: [
    { chave: 'k', caminho: 'isca.txt', n: 0, antes: 'ausente', depois: 'texto' },
    { chave: process.platform === 'win32' ? ca.toLowerCase() : ca, caminho: ca, n: 1, antes: 'texto', depois: null }] }));
  fs.writeFileSync(path.join(alvo, '0.depois'), 'isca\n');
  fs.writeFileSync(path.join(alvo, '1.antes'), 'isca\n');
  const s3 = sessao();
  fs.symlinkSync(alvo, rp.pastaDaSessao(s3), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => rp.guardar(s3, 't1', 'antes', path.join(dir, 'a.txt')));
  assert.throws(() => rp.guardar(s3, 't1', 'descartar', path.join(dir, 'a.txt')));
  assert.strictEqual(rp.ler(s3), null);
  assert.deepStrictEqual(fs.readdirSync(alvo).sort(), ['0.depois', '1.antes', 'indice.json']);
  // o link no lugar da pasta do replay inteira: tambem para (a limpeza das velhas nunca anda fora da temporaria)
  const raiz = path.dirname(rp.pastaDaSessao('x'));
  const guardada = raiz + '-guardada';
  fs.renameSync(raiz, guardada);
  try {
    fs.symlinkSync(alvo, raiz, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => rp.guardar(sessao(), 't1', 'antes', path.join(dir, 'a.txt')));
    fs.unlinkSync(raiz);
  } finally {
    fs.renameSync(guardada, raiz);
  }
});

test('ler e texto com o indice torto ou sem edicao: o texto de nenhuma edicao', () => {
  const s = sessao();
  assert.strictEqual(rp.ler(s), null);
  const nenhuma = 'Nenhum arquivo editado nesta sessão ainda. O /sworn-replay mostra, linha por linha, o que o último ' +
    'turno com edição mudou em cada arquivo.';
  assert.strictEqual(rp.texto(null, 0, ''), nenhuma);
  fs.mkdirSync(rp.pastaDaSessao(s), { recursive: true });
  fs.writeFileSync(path.join(rp.pastaDaSessao(s), 'indice.json'), '{"turno":1}');
  assert.strictEqual(rp.ler(s), null);
  fs.writeFileSync(path.join(rp.pastaDaSessao(s), 'indice.json'), '{"turno":"t1","arquivos":[null,{"caminho":3}]}');
  assert.strictEqual(rp.texto(rp.ler(s), 0, ''), nenhuma);
  // o item com o estado que nao existe (versao velha): nao da para mostrar, sem quebrar
  fs.writeFileSync(path.join(rp.pastaDaSessao(s), 'indice.json'), JSON.stringify({ turno: 't1', arquivos: [
    { chave: 'k', caminho: 'x.txt', n: 0, antes: 'estranho', depois: 'texto' },
    { chave: 'j', caminho: 'y.txt', n: 1, antes: 'ausente', depois: 'xyz' }] }));
  fs.writeFileSync(path.join(rp.pastaDaSessao(s), '0.depois'), 'd\n');
  const torto = rp.texto(rp.ler(s), 0, '');
  assert.match(torto, /\nx\.txt: a cópia guardada sumiu da pasta temporária \(o sistema pode tê-la limpado\): o arquivo segue onde estava; abra-o para ver como ele ficou\.\n/);
  assert.match(torto, /\ny\.txt: a cópia guardada sumiu da pasta temporária \(o sistema pode tê-la limpado\): o arquivo segue onde estava; abra-o para ver como ele ficou\.\n/);
  // o item nulo e o de numero torto saem, e o bom fica; o numero torto ('../..') nunca vira caminho fora da pasta
  fs.writeFileSync(path.join(rp.pastaDaSessao(s), 'indice.json'), JSON.stringify({ turno: 't1', arquivos: [null,
    { chave: 'v', caminho: 'v.txt', n: 0, antes: 'ausente', depois: 'texto' },
    { chave: 'm', caminho: 'm.txt', n: '../../fora', antes: 'texto', depois: 'texto' },
    { chave: 'o', caminho: 'o.txt', n: -1, antes: 'texto', depois: 'texto' }] }));
  const isca = path.join(rp.pastaDaSessao(s), '..', '..', 'fora.antes');
  fs.writeFileSync(isca, 'nao apague');
  const bom = rp.texto(rp.ler(s), 0, '');
  assert.match(bom, /: 1 arquivo\.\n\nv\.txt \(arquivo novo, \+1\)\n/);
  assert.doesNotMatch(bom, /m\.txt|o\.txt/);
  // o indice torto e o turno novo: guarda por cima, e a isca fora da pasta fica
  const dir = projeto({ 'a.txt': 'a\n' });
  editar(s, 't2', path.join(dir, 'a.txt'), 'b\n');
  assert.match(rp.texto(rp.ler(s), 0, dir), /\na\.txt \(\+1 -1\)\n/);
  assert.ok(fs.existsSync(isca), 'o numero torto do indice nao apagou fora da pasta');
  // no mesmo turno, o numero novo vem depois do maior ja usado (o item 0 que o indice perdeu ainda tem a copia)
  const pasta = rp.pastaDaSessao(s);
  fs.writeFileSync(path.join(pasta, 'indice.json'), JSON.stringify({ turno: 't2', em: 0, fora: 0, arquivos: [
    { chave: 'k5', caminho: 'k5.txt', n: 5, antes: 'ausente', depois: 'texto' }] }));
  fs.writeFileSync(path.join(pasta, '5.depois'), 'k\n');
  editar(s, 't2', path.join(dir, 'a.txt'), 'c\n');
  assert.ok(fs.existsSync(path.join(pasta, '6.antes')), 'o novo foi para o 6');
  assert.strictEqual(fs.readFileSync(path.join(pasta, '0.antes'), 'utf8'), 'a\n', 'a copia do 0 nao foi pisada');
  // o indice quebrado (JSON torto) e o turno novo: as copias que ninguem nomeia saem tambem
  fs.writeFileSync(path.join(pasta, 'indice.json'), '{');
  fs.writeFileSync(path.join(pasta, '7.depois'), 'solta');
  editar(s, 't3', path.join(dir, 'a.txt'), 'd\n');
  assert.deepStrictEqual(fs.readdirSync(pasta).sort(), ['0.antes', '0.depois', 'indice.json']);
});

test('replay.js: --guardar e --texto pelo stdin, saida 0; entrada torta guarda nada e mostra nenhuma edicao; a excecao sai 1', () => {
  const script = path.join(__dirname, '..', 'scripts', 'replay.js');
  const dir = projeto({ 'a.txt': 'um\n' });
  // o SWORN_TMP vem do process.env deste teste (linha do TMP); o prazo poe o filho que trava como falha, nunca espera
  const rodar = (args, stdin) => cp.spawnSync(process.execPath, [script].concat(args), { input: stdin, encoding: 'utf8',
    cwd: dir, timeout: 30000 });
  const s = sessao();
  const ent = JSON.stringify({ sessao: s, turno: 't1', caminho: path.join(dir, 'a.txt'), agora: 1000 });
  const g = rodar(['--guardar', 'antes'], ent);
  assert.strictEqual(g.status, 0);
  assert.strictEqual(g.stdout, '');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'dois\n');
  rodar(['--guardar', 'depois'], ent);
  // sem cwd na entrada, a pasta do processo (a da sessao, no mod); sem agora, a hora desta maquina
  const t = rodar(['--texto'], JSON.stringify({ sessao: s }));
  assert.strictEqual(t.status, 0);
  assert.match(t.stdout, /^Edições do último turno que mexeu em arquivos \(há \d+ min\): 1 arquivo\.\n\na\.txt \(\+1 -1\)\n/);
  // com cwd e agora na entrada, valem eles
  const c = rodar(['--texto'], JSON.stringify({ sessao: s, agora: 1000 + 5 * MIN, cwd: path.dirname(dir) }));
  assert.ok(c.stdout.startsWith('Edições do último turno que mexeu em arquivos (há 5 min): 1 arquivo.\n\n' +
    path.basename(dir) + '/a.txt (+1 -1)\n'), c.stdout);
  for (const torto of ['nao e json', 'null', '[]', '']) {
    const r = rodar(['--guardar', 'antes'], torto);
    assert.strictEqual(r.status, 0, 'guardar: ' + torto);
    assert.strictEqual(r.stdout, '');
    const x = rodar(['--texto'], torto);
    assert.strictEqual(x.status, 0, 'texto: ' + torto);
    assert.match(x.stdout, /^Nenhum arquivo editado nesta sessão ainda\./);
  }
  // sem modo nenhum: nada, e sai 0
  const nada = rodar([], ent);
  assert.strictEqual(nada.status, 0);
  assert.strictEqual(nada.stdout, '');
  assert.strictEqual(nada.stderr, '');
  // a excecao (um arquivo no lugar da pasta da sessao): sai 1, com a causa no stderr e nada no stdout
  const s2 = sessao();
  fs.writeFileSync(rp.pastaDaSessao(s2), 'nao e pasta');
  const quebrou = rodar(['--guardar', 'antes'], JSON.stringify({ sessao: s2, turno: 't1', caminho: path.join(dir, 'a.txt') }));
  assert.strictEqual(quebrou.status, 1);
  assert.strictEqual(quebrou.stdout, '');
  assert.match(quebrou.stderr, /^sworn replay: /);
});

test.after(() => {
  // apaga de vez a pasta temporaria deste teste (so o que ele criou, nada fora de TMP); a que sobrar e avisada
  const apagarTudo = (p) => {
    for (const d of fs.readdirSync(p, { withFileTypes: true })) {
      const q = path.join(p, d.name);
      if (d.isDirectory()) { apagarTudo(q); fs.rmdirSync(q); } else fs.unlinkSync(q);
    }
  };
  try { apagarTudo(TMP); fs.rmdirSync(TMP); } catch (e) { console.error('sobrou a pasta deste teste: ' + TMP + ' (' + e.message + ')'); }
});
