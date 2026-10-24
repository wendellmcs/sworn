'use strict';
// Criterio 1 da secao 10: instalacao limpa em maquina sem nada. Nao da para
// ensaiar isso sem montar antes a pasta que vai ao publico - e montar a mao ja
// falhou: em 2026-09-02 o export saiu com 92 arquivos de 95, e os 3 que
// faltavam eram o detector de sanitacao e o teste dele. Quem pegou foi o
// contador de testes, nao a leitura da lista.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sanit = require('../scripts/lib/sanitacao.js');

const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'exportar.js');

function pasta(nome) { return fs.mkdtempSync(path.join(os.tmpdir(), 'sworn ' + nome + '-')); }

function escrever(dir, rel, conteudo) {
  const alvo = path.join(dir, rel);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, conteudo, 'utf8');
}

/** Origem de mentira: pequena, com um docs/, um ignorado e um nao rastreado. */
function origem() {
  const dir = pasta('origem');
  escrever(dir, 'README.md', '# um\n');
  escrever(dir, path.join('scripts', 'a.js'), 'module.exports = 1;\n');
  escrever(dir, path.join('docs', 'diario.md'), 'segredo de trabalho\n');
  escrever(dir, '.gitignore', 'local.json\n');
  escrever(dir, 'local.json', '{"privado":true}\n');
  spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8', shell: false });
  spawnSync('git', ['add', '-A'], { cwd: dir, encoding: 'utf8', shell: false });
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t' + '@exemplo.com',
    'commit', '-qm', 'inicial'], { cwd: dir, encoding: 'utf8', shell: false });
  // nao rastreado, escrito DEPOIS do commit: e o caso de 2026-09-02
  escrever(dir, path.join('scripts', 'recem-escrito.js'), 'module.exports = 2;\n');
  return dir;
}

function exportar(raiz, destino, extra) {
  return spawnSync(process.execPath,
    [SCRIPT, '--raiz', raiz, '--destino', destino].concat(extra || []),
    { encoding: 'utf8', timeout: 60000 });
}

function arquivosDe(dir, base, acc) {
  base = base || dir; acc = acc || [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) arquivosDe(p, base, acc);
    else acc.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return acc.sort();
}

test('exportar: sem --gravar nao escreve nada - so propoe', () => {
  const de = origem();
  const para = path.join(pasta('destino'), 'novo');
  const r = exportar(de, para);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(/PROPOSTA - nada foi escrito/.test(r.stdout), r.stdout);
  assert.strictEqual(fs.existsSync(para), false, 'a proposta criou pasta: nao pode');
  // A proposta e o que se le antes de gravar: a conta e a lista sao as do auditor.
  const previsto = sanit.superficiePublicavel(de);
  assert.ok(r.stdout.indexOf('\n' + previsto.length + ' arquivos entram no export.') !== -1, r.stdout);
  previsto.forEach((a) => assert.ok(r.stdout.indexOf('\n  ' + a + '\n') !== -1,
    'a proposta nao lista ' + a));
});

test('exportar: sem --destino devolve 2 e explica o uso', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(r.status, 2);
  assert.ok(/uso: node scripts\/exportar\.js/.test(r.stderr), r.stderr);
});

test('exportar: origem que nao e repositorio devolve 2, nunca monta pela metade', () => {
  const r = exportar(pasta('sem git'), path.join(pasta('destino'), 'novo'), ['--gravar']);
  assert.strictEqual(r.status, 2, r.stdout + r.stderr);
  assert.ok(/NAO DEU PARA MEDIR/.test(r.stderr), r.stderr);
});

test('exportar: destino nao vazio e recusado - sobra nao aparece em lista nenhuma', () => {
  const de = origem();
  const para = pasta('destino');
  escrever(para, 'sobra.txt', 'de um export anterior\n');
  const r = exportar(de, para, ['--gravar']);
  assert.strictEqual(r.status, 2);
  assert.ok(/nao esta vazio/.test(r.stderr), r.stderr);
});

/** O caso de 2026-09-02, virado teste: o arquivo escrito e nao adicionado. */
test('exportar: o arquivo NOVO, ainda nao adicionado, entra no export', () => {
  const de = origem();
  const para = path.join(pasta('destino'), 'novo');
  const r = exportar(de, para, ['--gravar']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const dentro = arquivosDe(para);
  assert.ok(dentro.indexOf('scripts/recem-escrito.js') !== -1,
    'o arquivo recem-escrito ficou de fora: e o erro de 92 de 95, outra vez');
});

test('exportar: docs/ e o ignorado NAO vao junto', () => {
  const de = origem();
  const para = path.join(pasta('destino'), 'novo');
  exportar(de, para, ['--gravar']);
  const dentro = arquivosDe(para);
  assert.strictEqual(dentro.filter((a) => a.indexOf('docs/') === 0).length, 0,
    'o diario de trabalho foi para o repositorio publico (D132)');
  assert.strictEqual(dentro.indexOf('local.json'), -1,
    'o arquivo ignorado foi junto - e e assim que o vocabulario privado vazaria');
});

/**
 * A propriedade que sustenta o resto: o montador e o auditor leem a MESMA
 * funcao. Se cada um tivesse a lista dele, poderiam discordar em silencio - o
 * auditor dando limpo sobre um conjunto e o montador copiando outro.
 */
test('exportar: o que foi copiado e EXATAMENTE a superficie que o auditor mede', () => {
  const de = origem();
  const para = path.join(pasta('destino'), 'novo');
  exportar(de, para, ['--gravar']);
  const previsto = sanit.superficiePublicavel(de).slice().sort();
  assert.deepStrictEqual(arquivosDe(para), previsto);
  // A lista bater nao basta: um montador que criasse os arquivos vazios passaria.
  previsto.forEach((rel) => assert.ok(
    fs.readFileSync(path.join(para, rel)).equals(fs.readFileSync(path.join(de, rel))),
    'o arquivo chegou com outro conteudo: ' + rel));
  assert.deepStrictEqual(sanit.superficiePublicavel(para).slice().sort(), previsto,
    'a superficie medida DENTRO do export tem de ser a mesma: senao a auditoria ' +
    'do export mede outra coisa');
});

/**
 * O que `git add` muda aqui e PRECISO, e o ensaio corrigiu a primeira redacao
 * deste teste: ele afirmava que sem o add a superficie sairia vazia, e isso e
 * FALSO - `--others` ja lista o nao rastreado. A mutacao que removeu o add
 * sobreviveu, e quem estava errado era a assercao, nao o codigo.
 *
 * O efeito de verdade e outro: o export sai COM INDICE, pronto para o commit
 * que vem depois - e sem o commit, que e o ato irreversivel e tem dono proprio.
 */
test('exportar: o destino fica com indice pronto, e SEM commit', () => {
  const de = origem();
  const para = path.join(pasta('destino'), 'novo');
  exportar(de, para, ['--gravar']);
  assert.strictEqual(fs.existsSync(path.join(para, '.git')), true, 'faltou o git init');
  assert.strictEqual(sanit.semCommits(para), true,
    'o commit e o ato irreversivel, e ele tem dono proprio - nao e este script');

  const indexado = spawnSync('git', ['diff', '--cached', '--name-only'],
    { cwd: para, encoding: 'utf8', shell: false }).stdout.split(/\r?\n/).filter(Boolean);
  assert.deepStrictEqual(indexado.sort(), arquivosDe(para),
    'o export tem de chegar ao commit com TUDO no indice: se o add faltar, o commit ' +
    'seguinte sai incompleto e ninguem olha a lista de novo');
});

test('exportar: o export recem-montado e auditavel ANTES do primeiro commit', () => {
  const de = origem();
  const para = path.join(pasta('destino'), 'novo');
  const saida = exportar(de, para, ['--gravar']).stdout;
  // A dica e o comando que se copia, e esta pasta tem espaco no nome: sem as aspas ele quebra.
  const dica = 'node "' + path.join(para, 'scripts', 'sanitar.js') + '" --raiz "' + para + '"';
  assert.ok(saida.indexOf(dica) !== -1, saida);
  const r = sanit.auditar(para);
  assert.ok(r !== null, 'auditar devolveu "nao sei" num export que existe e esta pronto');
  assert.strictEqual(r.commits, 0);
  assert.strictEqual(r.limpo, true, JSON.stringify(r.porClasse));
});

test('exportar: a contagem impressa e a de verdade, nao a prevista', () => {
  const de = origem();
  const para = path.join(pasta('destino'), 'novo');
  const r = exportar(de, para, ['--gravar']);
  const m = r.stdout.match(/Copiados: (\d+) de (\d+)/);
  assert.ok(m, r.stdout);
  assert.strictEqual(Number(m[1]), arquivosDe(para).length,
    'o numero impresso tem de ser o que chegou ao disco - foi o contador que pegou o erro de 2026-09-02');
  assert.strictEqual(m[1], m[2]);

  // Onde a prevista e a de verdade coincidem, o teste nao distingue uma da outra.
  // O arquivo que esta no indice e sumiu do disco faz as duas divergirem - e o
  // export incompleto tem de sair 1, nomeando o que faltou.
  const de2 = origem();
  fs.unlinkSync(path.join(de2, 'scripts', 'a.js'));
  const para2 = path.join(pasta('destino'), 'novo');
  const r2 = exportar(de2, para2, ['--gravar']);
  assert.strictEqual(r2.status, 1, r2.stdout + r2.stderr);
  const m2 = r2.stdout.match(/Copiados: (\d+) de (\d+)/);
  assert.ok(m2, r2.stdout);
  assert.strictEqual(Number(m2[1]), arquivosDe(para2).length);
  assert.strictEqual(Number(m2[2]), Number(m2[1]) + 1, 'a prevista conta o que faltou; a copiada, nao');
  assert.ok(/NAO COPIADOS \(1\):\r?\n\s+scripts\/a\.js /.test(r2.stderr), r2.stderr);
});

// F1-C05: superficie vazia dava "Copiados: 0 de 0" e saida 0 - export "bem-sucedido" de nada.
test('exportar: superficie vazia e ERRO (saida 1), nao "0 de 0"; nada e criado', () => {
  const de = pasta('origem-vazia');
  escrever(de, path.join('docs', 'so-isto.md'), 'fora do publico\n');
  spawnSync('git', ['init', '-q'], { cwd: de, encoding: 'utf8', shell: false });
  spawnSync('git', ['add', '-A'], { cwd: de, encoding: 'utf8', shell: false });
  assert.deepStrictEqual(sanit.superficiePublicavel(de), [], 'a fixture precisa ter superficie vazia');
  const para = path.join(pasta('destino'), 'novo');
  const r = exportar(de, para, ['--gravar']);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(/superficie vazia: nada a exportar/.test(r.stderr), r.stderr);
  assert.strictEqual(r.stdout.indexOf('Copiados'), -1, r.stdout);
  assert.strictEqual(fs.existsSync(para), false, 'montou destino para nada');
});

// F3-22: o codigo cru do Node ("ENOENT") nao diz nada a quem le o relatorio.
test('exportar: arquivo que sumiu e nomeado com a causa em portugues', () => {
  const de = origem();
  fs.unlinkSync(path.join(de, 'scripts', 'a.js'));
  const r = exportar(de, path.join(pasta('destino'), 'novo'), ['--gravar']);
  assert.ok(/scripts\/a\.js \(nao existe \(ENOENT\)\)/.test(r.stderr), r.stderr);
});

// Ronda 1 do Passo 8b: o git do destino nao tinha teto de tempo nem retorno
// conferido, e a saida dizia "feitos" com saida 0 mesmo quando o add falhava.
test('exportar: git que falha no destino sai 1 e nao anuncia indice pronto', () => {
  const de = origem();
  const base = pasta('destino');
  const para = path.join(base, 'novo');
  // O indice apontado para uma pasta que nao existe: o ls-files da origem ainda
  // responde, e o `git add` do destino nao tem onde gravar.
  const env = Object.assign({}, process.env,
    { GIT_INDEX_FILE: path.join(base, 'nao-existe', 'index') });
  const r = spawnSync(process.execPath, [SCRIPT, '--raiz', de, '--destino', para, '--gravar'],
    { encoding: 'utf8', timeout: 60000, env: env });
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(/Copiados: \d+ de \d+/.test(r.stdout), 'a contagem tem de sair mesmo assim: ' + r.stdout);
  assert.strictEqual(r.stdout.indexOf('feitos'), -1,
    'anunciou o indice pronto sem ele estar: ' + r.stdout);
  // a linha que NOMEIA a falha - a explicacao logo abaixo tambem cita o `git add`
  assert.ok(/NAO FICOU PRONTO: git add saiu \d+/.test(r.stderr),
    'nao disse qual passo do git falhou: ' + r.stderr);
});

test('exportar: todo spawnSync dos scripts tem teto de tempo, como os irmaos do git.js', () => {
  const sem = [];
  const com = [];
  const visitar = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { visitar(p); continue; }
      if (!e.name.endsWith('.js')) continue;
      const rel = path.relative(RAIZ, p).replace(/\\/g, '/');
      const re = /spawnSync\([\s\S]*?\}\s*\)/g;
      let m;
      while ((m = re.exec(fs.readFileSync(p, 'utf8'))) !== null) {
        (/\btimeout\s*:/.test(m[0]) ? com : sem).push(rel);
      }
    }
  };
  visitar(path.join(RAIZ, 'scripts'));
  assert.ok(com.indexOf('scripts/exportar.js') !== -1, 'o git do exportar.js ficou sem teto');
  assert.ok(com.length >= 4, 'o leitor achou so ' + com.length + ' chamadas com teto: ' + com.join(', '));
  assert.deepStrictEqual(sem, [], 'git sem teto de tempo pendura o script sem aviso');
});
