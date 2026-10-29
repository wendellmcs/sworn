'use strict';
// D451 (0.6.2): o /sworn:init pergunta UMA vez se autoriza o /sworn:parallel e grava a regra de permissao
// `Workflow(sworn:parallel)` no .claude/settings.local.json do projeto, por script (JSON, nunca texto).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'autorizar-paralelo.js');
const REGRA = 'Workflow(sworn:parallel)';

function comDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-autorizar-'));
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function rodar(dir, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8' });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (e) { json = null; }
  return { status: r.status, stdout: r.stdout, json };
}
const local = (dir) => path.join(dir, '.claude', 'settings.local.json');
const ler = (dir) => JSON.parse(fs.readFileSync(local(dir), 'utf8'));

test('autorizar: sem arquivo, cria .claude/settings.local.json so com a regra', () => {
  comDir((dir) => {
    const r = rodar(dir);
    assert.strictEqual(r.status, 0, r.stdout);
    assert.deepStrictEqual(r.json, { autorizado: true, gravou: true, arquivo: '.claude/settings.local.json' });
    assert.deepStrictEqual(ler(dir), { permissions: { allow: [REGRA] } });
  });
});

test('autorizar: preserva o resto do arquivo e nao duplica a regra', () => {
  comDir((dir) => {
    fs.mkdirSync(path.join(dir, '.claude'));
    const antes = { model: 'x', permissions: { allow: ['Bash(npm test)'], deny: ['Read(.env)'] }, env: { A: '1' } };
    fs.writeFileSync(local(dir), JSON.stringify(antes));
    assert.strictEqual(rodar(dir).json.gravou, true);
    assert.deepStrictEqual(ler(dir), { model: 'x', permissions: { allow: ['Bash(npm test)', REGRA], deny: ['Read(.env)'] }, env: { A: '1' } });
    const segunda = rodar(dir);
    assert.deepStrictEqual(segunda.json, { autorizado: true, gravou: false, arquivo: '.claude/settings.local.json' });
    assert.strictEqual(ler(dir).permissions.allow.filter((a) => a === REGRA).length, 1);
  });
});

test('autorizar: JSON ilegivel ou forma inesperada -> sai 1 e NAO grava (nunca sobrescreve o que nao entende)', () => {
  for (const bruto of ['{ "permissions": ', '[]', '{"permissions": []}', '{"permissions": {"allow": "Bash"}}']) {
    comDir((dir) => {
      fs.mkdirSync(path.join(dir, '.claude'));
      fs.writeFileSync(local(dir), bruto);
      const r = rodar(dir);
      assert.strictEqual(r.status, 1, bruto + ': ' + r.stdout);
      assert.strictEqual(r.json.gravou, false, bruto);
      assert.ok(typeof r.json.erro === 'string' && r.json.erro.length > 0, bruto);
      assert.ok(/rode de novo/.test(r.json.erro), 'o erro diz o que fazer a seguir: ' + r.json.erro);
      assert.strictEqual(fs.readFileSync(local(dir), 'utf8'), bruto, 'mexeu no arquivo: ' + bruto);
    });
  }
});

test('autorizar: erro de forma mostra a forma esperada (revisao cega da 0.6.2)', () => {
  const casos = { '[]': /\{ \.\.\. \}/, '{"permissions": []}': /"permissions": \{/, '{"permissions": {"allow": "Bash"}}': /"allow": \[/ };
  for (const bruto of Object.keys(casos)) {
    comDir((dir) => {
      fs.mkdirSync(path.join(dir, '.claude'));
      fs.writeFileSync(local(dir), bruto);
      const r = rodar(dir);
      assert.ok(casos[bruto].test(r.json.erro), bruto + ' -> ' + r.json.erro);
    });
  }
});

test('autorizar --conferir: so le, e diz se ja esta autorizado (o init pergunta uma vez so)', () => {
  comDir((dir) => {
    const antes = rodar(dir, '--conferir');
    assert.strictEqual(antes.status, 0);
    assert.deepStrictEqual(antes.json, { autorizado: false, gravou: false, arquivo: '.claude/settings.local.json' });
    assert.ok(!fs.existsSync(local(dir)), '--conferir nao pode criar o arquivo');
    rodar(dir);
    assert.strictEqual(rodar(dir, '--conferir').json.autorizado, true);
  });
});

test('autorizar: regra em permissions.deny vence a allow -> nao diz autorizado (D452)', () => {
  for (const negada of [REGRA, 'Workflow', 'Workflow(*)', 'Workflow(sworn:*)']) {
    comDir((dir) => {
      fs.mkdirSync(path.join(dir, '.claude'));
      const bruto = JSON.stringify({ permissions: { allow: [REGRA], deny: [negada] } });
      fs.writeFileSync(local(dir), bruto);
      for (const args of [[], ['--conferir']]) {
        const r = rodar(dir, ...args);
        assert.strictEqual(r.status, 1, negada + ' ' + args + ': ' + r.stdout);
        assert.strictEqual(r.json.autorizado, false, r.stdout);
        assert.ok(/deny/.test(r.json.erro) && /rode de novo/.test(r.json.erro), r.json.erro);
      }
      assert.strictEqual(fs.readFileSync(local(dir), 'utf8'), bruto, 'mexeu no arquivo');
    });
  }
});

// A2 (s193): o deny que nao e lista passava calado (:69): o script gravava e dizia autorizado:true. Item que nao e
// texto, nas duas listas, e a mesma forma inesperada (o contrato do :13). Para como o allow torto, sem gravar.
test('A2 (s193): deny que nao e lista, ou item que nao e texto, sai 1 sem gravar e diz a forma esperada', () => {
  const casos = [['deny', 'Workflow'], ['deny', { 0: 'Workflow' }], ['deny', 5], ['deny', true], ['deny', null],
    ['deny', [5]], ['deny', [['Workflow']]], ['allow', [5]], ['allow', [null, REGRA]]];
  for (const [nome, valor] of casos) {
    comDir((dir) => {
      fs.mkdirSync(path.join(dir, '.claude'));
      const permissions = { allow: ['Bash(npm test)'] };
      permissions[nome] = valor;
      const bruto = JSON.stringify({ permissions });
      fs.writeFileSync(local(dir), bruto);
      for (const args of [[], ['--conferir']]) {
        const r = rodar(dir, ...args);
        const rotulo = nome + ' ' + JSON.stringify(valor) + ' ' + args;
        assert.strictEqual(r.status, 1, rotulo + ': ' + r.stdout);
        assert.deepStrictEqual([r.json.autorizado, r.json.gravou], [false, false], rotulo);
        assert.ok(r.json.erro.indexOf('permissions.' + nome) !== -1 && r.json.erro.indexOf('"' + nome + '": [') !== -1 &&
          /rode de novo/.test(r.json.erro), rotulo + ' -> ' + r.json.erro);
      }
      assert.strictEqual(fs.readFileSync(local(dir), 'utf8'), bruto, 'mexeu no arquivo');
    });
  }
});

test('autorizar: de uma subpasta, grava na raiz do repositorio, nao num .claude novo ali (D452)', () => {
  comDir((dir) => {
    fs.mkdirSync(path.join(dir, '.git'));
    const sub = path.join(dir, 'scripts', 'lib');
    fs.mkdirSync(sub, { recursive: true });
    const r = rodar(sub);
    assert.strictEqual(r.status, 0, r.stdout);
    assert.strictEqual(r.json.gravou, true);
    assert.ok(!fs.existsSync(path.join(sub, '.claude')), 'criou .claude na subpasta');
    assert.deepStrictEqual(ler(dir), { permissions: { allow: [REGRA] } });
    assert.strictEqual(rodar(sub, '--conferir').json.autorizado, true);
  });
});

test('autorizar: deny de outro workflow nao bloqueia (D452)', () => {
  comDir((dir) => {
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.writeFileSync(local(dir), JSON.stringify({ permissions: { deny: ['Workflow(outro)', 'Workflow(sworn:review*)'] } }));
    const r = rodar(dir);
    assert.strictEqual(r.status, 0, r.stdout);
    assert.strictEqual(r.json.autorizado, true);
  });
});

test('autorizar: .git na pasta pessoal (dotfiles) nao vira raiz do projeto (conferencia da D452)', () => {
  comDir((casa) => {
    fs.mkdirSync(path.join(casa, '.git'));
    const proj = path.join(casa, 'projetos', 'novo');
    fs.mkdirSync(proj, { recursive: true });
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: proj, encoding: 'utf8',
      env: Object.assign({}, process.env, { HOME: casa, USERPROFILE: casa }) });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok(!fs.existsSync(path.join(casa, '.claude')), 'gravou na pasta pessoal');
    assert.deepStrictEqual(ler(proj), { permissions: { allow: [REGRA] } });
  });
});

test('autorizar: settings.local.json com BOM (PowerShell 5.1) ou vazio nao para o init (D460)', () => {
  for (const [nome, conteudo, esperado] of [
    ['BOM', '\uFEFF' + JSON.stringify({ model: 'x' }), { model: 'x', permissions: { allow: [REGRA] } }],
    ['vazio', '', { permissions: { allow: [REGRA] } }],
    ['so espacos', ' \r\n', { permissions: { allow: [REGRA] } }]
  ]) {
    comDir((dir) => {
      fs.mkdirSync(path.join(dir, '.claude'));
      fs.writeFileSync(local(dir), conteudo, 'utf8');
      const c = rodar(dir, '--conferir');
      assert.strictEqual(c.status, 0, nome + ': ' + c.stdout);
      assert.strictEqual(c.json.autorizado, false, nome);
      const r = rodar(dir);
      assert.strictEqual(r.status, 0, nome + ': ' + r.stdout);
      assert.strictEqual(r.json.gravou, true, nome);
      assert.deepStrictEqual(ler(dir), esperado, nome);
    });
  }
});
