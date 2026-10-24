'use strict';
// Bloco V (D426/D437): a tarefa agendada que traz `vigia/novidades.md` do ramo `claude/vigia` para o disco.
// SEM rede: o "remote backup" e um repositorio bare em pasta temporaria. Cada teste monta o seu.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'vigia-puxar.js');
const IDENT = ['-c', 'user.name=t', '-c', 'user.email=t@t'];

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd: cwd, encoding: 'utf8', shell: false, windowsHide: true });
  assert.strictEqual(r.status, 0, 'git ' + args.join(' ') + ' falhou: ' + r.stderr);
  return r.stdout;
}

/** Caminho real normalizado (expande nome curto 8.3 do Windows; compara sem diferenca de caixa ou barra). */
function real(p) {
  return path.resolve(fs.realpathSync.native(p)).toLowerCase();
}

function paraBarra(p) {
  return p.replace(/\\/g, '/');
}

/** Confere que a pasta e a raiz dela mesma (um git em pasta errada ja commitou no repo pai uma vez). */
function ehRaizDeSi(dir) {
  const topo = git(dir, ['rev-parse', '--show-toplevel']).trim();
  assert.strictEqual(real(topo), real(dir), 'o repo temporario nao e ele mesmo: ' + topo);
}

/**
 * Monta bare + trabalho (publica o ramo claude/vigia com o conteudo, se houver) + repo do dono (remote
 * backup apontando para o bare). Devolve { base, bare, dono, dest }.
 */
function cenario(nome, conteudo) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-vigiapx-' + nome + '-'));
  const bare = path.join(base, 'bare.git');
  const trabalho = path.join(base, 'trabalho');
  const dono = path.join(base, 'dono');
  fs.mkdirSync(bare);
  git(bare, ['init', '--bare', '-q']);
  const gitDirBare = git(bare, ['rev-parse', '--absolute-git-dir']).trim();
  assert.strictEqual(real(gitDirBare), real(bare), 'o bare temporario nao e ele mesmo: ' + gitDirBare);
  fs.mkdirSync(trabalho);
  git(trabalho, ['init', '-q']);
  ehRaizDeSi(trabalho);
  if (conteudo !== null) {
    git(trabalho, ['checkout', '-q', '-b', 'claude/vigia']);
    fs.mkdirSync(path.join(trabalho, 'vigia'));
    fs.writeFileSync(path.join(trabalho, 'vigia', 'novidades.md'), conteudo, 'utf8');
    git(trabalho, ['add', '.']);
    git(trabalho, IDENT.concat(['commit', '-q', '-m', 'novidade']));
    git(trabalho, ['push', '-q', paraBarra(bare), 'claude/vigia']);
  }
  fs.mkdirSync(dono);
  git(dono, ['init', '-q']);
  ehRaizDeSi(dono);
  git(dono, ['remote', 'add', 'backup', paraBarra(bare)]);
  return { base: base, bare: bare, dono: dono, dest: path.join(base, 'destino') };
}

function puxar(args) {
  return spawnSync(process.execPath, [SCRIPT].concat(args), { encoding: 'utf8', windowsHide: true });
}

function lerBusca(dest) {
  return JSON.parse(fs.readFileSync(path.join(dest, 'ultima-busca.json'), 'utf8'));
}

const RELATORIO = 'semana: 2026-10-05\n\n# Novidades\n\n- Cartão novo\n';

test('sucesso: grava novidades.md (com acento intacto) e ultima-busca ok:true, exit 0', () => {
  const c = cenario('ok', RELATORIO);
  try {
    const r = puxar(['--repo', c.dono, '--destino', c.dest]);
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.ok(/^vigia: novidade de 2026-10-05 gravada em .*novidades\.md\r?\n$/.test(r.stdout), r.stdout);
    assert.ok(/^[\x20-\x7E\r\n]*$/.test(r.stdout), 'stdout nao e ASCII: ' + JSON.stringify(r.stdout));
    assert.strictEqual(fs.readFileSync(path.join(c.dest, 'novidades.md'), 'utf8'), RELATORIO);
    assert.ok(!fs.existsSync(path.join(c.dest, 'novidades.md.tmp')), 'sobrou o temporario');
    const b = lerBusca(c.dest);
    assert.deepStrictEqual(Object.keys(b).sort(), ['motivo', 'ok', 'quando', 'semana']);
    assert.strictEqual(b.ok, true);
    assert.strictEqual(b.motivo, null);
    assert.strictEqual(b.semana, '2026-10-05');
    assert.ok(Math.abs(Date.now() - Date.parse(b.quando)) < 120000, b.quando);
  } finally { fs.rmSync(c.base, { recursive: true, force: true }); }
});

test('sucesso troca a novidade antiga pela nova (atomico) quando o ramo avanca', () => {
  const c = cenario('troca', RELATORIO);
  try {
    assert.strictEqual(puxar(['--repo', c.dono, '--destino', c.dest]).status, 0);
    const trabalho = path.join(c.base, 'trabalho');
    fs.writeFileSync(path.join(trabalho, 'vigia', 'novidades.md'), 'semana: 2026-10-12\n\nOutra\n', 'utf8');
    git(trabalho, ['add', '.']);
    git(trabalho, IDENT.concat(['commit', '-q', '-m', 'outra']));
    git(trabalho, ['push', '-q', paraBarra(c.bare), 'claude/vigia']);
    const r = puxar(['--repo', c.dono, '--destino', c.dest]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(fs.readFileSync(path.join(c.dest, 'novidades.md'), 'utf8'), 'semana: 2026-10-12\n\nOutra\n');
    assert.strictEqual(lerBusca(c.dest).semana, '2026-10-12');
  } finally { fs.rmSync(c.base, { recursive: true, force: true }); }
});

test('opcoes --remote, --ramo e --arquivo mudam de onde se puxa', () => {
  const c = cenario('opcoes', RELATORIO);
  try {
    git(c.dono, ['remote', 'rename', 'backup', 'outro']);
    // com os padroes falha (nao ha remote backup); com as opcoes funciona
    assert.strictEqual(puxar(['--repo', c.dono, '--destino', c.dest]).status, 1);
    const r = puxar(['--repo', c.dono, '--destino', c.dest, '--remote', 'outro', '--ramo', 'claude/vigia', '--arquivo', 'vigia/novidades.md']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(fs.readFileSync(path.join(c.dest, 'novidades.md'), 'utf8'), RELATORIO);
  } finally { fs.rmSync(c.base, { recursive: true, force: true }); }
});

test('ramo inexistente: exit 1, ultima-busca ok:false, novidades.md anterior intacto', () => {
  const c = cenario('sem-ramo', null);
  try {
    fs.mkdirSync(c.dest, { recursive: true });
    fs.writeFileSync(path.join(c.dest, 'novidades.md'), 'semana: 2026-09-28\n\nantiga\n', 'utf8');
    const r = puxar(['--repo', c.dono, '--destino', c.dest]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.ok(/^vigia: busca falhou \(.+\)\r?\n$/.test(r.stderr), r.stderr);
    assert.ok(/^[\x20-\x7E\r\n]*$/.test(r.stderr), 'stderr nao e ASCII: ' + JSON.stringify(r.stderr));
    assert.strictEqual(fs.readFileSync(path.join(c.dest, 'novidades.md'), 'utf8'), 'semana: 2026-09-28\n\nantiga\n');
    const b = lerBusca(c.dest);
    assert.strictEqual(b.ok, false);
    assert.ok(typeof b.motivo === 'string' && b.motivo.length > 0, JSON.stringify(b));
    assert.strictEqual(b.semana, null);
  } finally { fs.rmSync(c.base, { recursive: true, force: true }); }
});

test('arquivo do ramo sem a linha semana: exit 1 e nao sobrescreve o que ja estava', () => {
  const c = cenario('sem-semana', '# relatorio sem a linha de semana\n\ntexto\n');
  try {
    fs.mkdirSync(c.dest, { recursive: true });
    fs.writeFileSync(path.join(c.dest, 'novidades.md'), 'semana: 2026-09-28\n\nantiga\n', 'utf8');
    const r = puxar(['--repo', c.dono, '--destino', c.dest]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.ok(/semana/.test(r.stderr), r.stderr);
    assert.strictEqual(fs.readFileSync(path.join(c.dest, 'novidades.md'), 'utf8'), 'semana: 2026-09-28\n\nantiga\n');
    assert.ok(!fs.existsSync(path.join(c.dest, 'novidades.md.tmp')));
    assert.strictEqual(lerBusca(c.dest).ok, false);
  } finally { fs.rmSync(c.base, { recursive: true, force: true }); }
});

test('arquivo inexistente no ramo: exit 1 sem criar novidades.md', () => {
  const c = cenario('sem-arquivo', RELATORIO);
  try {
    const r = puxar(['--repo', c.dono, '--destino', c.dest, '--arquivo', 'vigia/nao-existe.md']);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.ok(!fs.existsSync(path.join(c.dest, 'novidades.md')));
    assert.strictEqual(lerBusca(c.dest).ok, false);
  } finally { fs.rmSync(c.base, { recursive: true, force: true }); }
});

test('sem --repo: uso no stderr, exit 2, nada gravado', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-vigiapx-uso-'));
  try {
    const dest = path.join(base, 'destino');
    const r = puxar(['--destino', dest]);
    assert.strictEqual(r.status, 2, r.stdout + r.stderr);
    assert.ok(/--repo/.test(r.stderr) && /[Uu]so/.test(r.stderr), r.stderr);
    assert.ok(!fs.existsSync(dest), 'criou o destino sem --repo');
    // --repo sem valor (seguido de outra opcao) tambem e falta
    assert.strictEqual(puxar(['--repo', '--destino', dest]).status, 2);
    assert.ok(!fs.existsSync(dest));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('sem --destino usa SWORN_VIGIA (a mesma pasta que a abertura le)', () => {
  const c = cenario('env', RELATORIO);
  try {
    const r = spawnSync(process.execPath, [SCRIPT, '--repo', c.dono], {
      encoding: 'utf8', windowsHide: true, env: Object.assign({}, process.env, { SWORN_VIGIA: c.dest })
    });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(fs.readFileSync(path.join(c.dest, 'novidades.md'), 'utf8'), RELATORIO);
  } finally { fs.rmSync(c.base, { recursive: true, force: true }); }
});

test('D148: so a tarefa agendada fala com a rede (via git); a fonte nao tem cliente de rede proprio', () => {
  const fonte = fs.readFileSync(SCRIPT, 'utf8');
  for (const proibido of ['node:https', 'node:http', 'fetch(', 'XMLHttpRequest', 'node:net']) {
    assert.strictEqual(fonte.indexOf(proibido), -1, 'vigia-puxar.js contem ' + proibido);
  }
  assert.ok(/gancho/.test(fonte) && /agendada/.test(fonte), 'o cabecalho precisa dizer que roda pela tarefa agendada, nunca por gancho');
});
