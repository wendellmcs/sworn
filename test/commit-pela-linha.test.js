'use strict';
// T11-7 (D364/D365 §3): o Claude Code so preenche `tool_response.gitOperation` quando a saida do git
// traz a linha `[branch sha]` e o `git -C`, se houver, aponta para caminho sem espaco. Sem o
// `gitOperation`, o marcador conta o commit pela propria linha `[branch sha] mensagem` do stdout.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');

function temp(nome) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-commit-linha-' + nome + '-'));
}

function marcar(dir, id, entrada) {
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'marcar-trabalho.js')], {
    cwd: dir,
    encoding: 'utf8',
    input: JSON.stringify(Object.assign({ session_id: id, cwd: dir }, entrada)),
    env: Object.assign({}, process.env, { SWORN_TMP: path.join(dir, '_sessoes') })
  });
  assert.strictEqual(r.status, 0, r.stderr);
  return r;
}

function sessao(dir, id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, '_sessoes', 'sworn', id + '.json'), 'utf8'));
  } catch (e) {
    return null;
  }
}

function commits(dir, id) {
  const s = sessao(dir, id);
  return s ? (s.commitsFeitos || 0) : 0;
}

const SAIDA_NORMAL = '[master 4377f01] docs(decisoes): D365\n 1 file changed, 24 insertions(+)\n';

test('T11-7: a linha [branch sha] do stdout conta o commit quando nao ha gitOperation (Bash e PowerShell)', () => {
  const dir = temp('linha');
  try {
    for (const f of ['Bash', 'PowerShell']) {
      const id = 'l-' + f;
      marcar(dir, id, { tool_name: f, tool_input: { command: 'git commit -m x' }, tool_response: { stdout: SAIDA_NORMAL } });
      assert.strictEqual(commits(dir, id), 1, f + ' nao contou o commit pela linha: ' + JSON.stringify(sessao(dir, id)));
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-7: os tres formatos da linha contam (branch com espaco e parenteses, root-commit, HEAD solto)', () => {
  const dir = temp('formatos');
  try {
    const linhas = [
      '[master 4377f01] x',
      '[master (root-commit) abc1234] x',
      '[detached HEAD abc1234] x',
      '[feature/uma-coisa 0123456789abcdef0123456789abcdef01234567] x'
    ];
    linhas.forEach(function (linha, i) {
      const id = 'f' + i;
      marcar(dir, id, { tool_name: 'Bash', tool_response: { stdout: linha + '\n 1 file changed\n' } });
      assert.strictEqual(commits(dir, id), 1, 'nao contou: ' + linha);
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-7: a linha pode vir depois de outras linhas da saida (git add e git commit encadeados)', () => {
  const dir = temp('encadeado');
  try {
    marcar(dir, 'e1', { tool_name: 'Bash',
      tool_response: { stdout: 'warning: LF will be replaced by CRLF\n[master 9a8b7c6] docs: x\n 2 files changed\n4377f01 docs(...) antigo\n' } });
    assert.strictEqual(commits(dir, 'e1'), 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-7: com gitOperation e com a linha ao mesmo tempo conta UMA vez, nao duas', () => {
  const dir = temp('os-dois');
  try {
    marcar(dir, 'd1', { tool_name: 'Bash', tool_response: {
      gitOperation: { commit: { sha: '4377f01', kind: 'committed', branch: 'master' } }, stdout: SAIDA_NORMAL } });
    assert.strictEqual(commits(dir, 'd1'), 1, JSON.stringify(sessao(dir, 'd1')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-7: dois commits na MESMA chamada contam um so (+1 por chamada)', () => {
  const dir = temp('duas-linhas');
  try {
    marcar(dir, 'm1', { tool_name: 'Bash',
      tool_response: { stdout: '[master 1111111] a\n 1 file changed\n[master 2222222] b\n 1 file changed\n' } });
    assert.strictEqual(commits(dir, 'm1'), 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-7: sem a linha nao conta - git commit -q (saida vazia) e git log --oneline (sem colchetes)', () => {
  const dir = temp('sem-linha');
  try {
    const casos = [
      { tool_input: { command: 'git commit -q -m x' }, tool_response: { stdout: '' } },
      { tool_input: { command: 'git log --oneline' }, tool_response: { stdout: '4377f01 docs(decisoes): D365\n9018088 feat: y\n' } },
      { tool_input: { command: 'git status' }, tool_response: { stdout: 'On branch master\nnothing to commit\n' } },
      { tool_input: { command: 'echo "git commit"' }, tool_response: { stdout: 'git commit\n' } },
      // colchetes que nao sao o resumo do commit: sem sha hexadecimal de 7 a 40 depois do nome da branch
      { tool_input: { command: 'cat a.txt' }, tool_response: { stdout: '[INFO] iniciando\n[master] sem sha\n[master abc12] sha curto\n' } },
      { tool_input: { command: 'cat b.txt' }, tool_response: { stdout: '[master xyzxyzx] nao e hexadecimal\n' } },
      // a linha tem de ser a linha: no meio de outra linha nao vale
      { tool_input: { command: 'cat c.txt' }, tool_response: { stdout: 'veja o resumo: [master 4377f01] x\n' } }
    ];
    casos.forEach(function (extra, i) {
      marcar(dir, 'n1', Object.assign({ tool_name: 'Bash' }, extra));
      assert.strictEqual(commits(dir, 'n1'), 0, 'caso ' + i + ' contou sem dever: ' + JSON.stringify(extra));
    });
    assert.strictEqual(sessao(dir, 'n1').trabalhoReal, true, 'controle: o Bash segue sendo trabalho real');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-7: o stdout so vale em Bash e PowerShell - Grep, Read e Write com a linha no texto nao contam', () => {
  const dir = temp('outras-ferramentas');
  try {
    for (const f of ['Grep', 'Read', 'Glob', 'Write', 'Edit']) {
      marcar(dir, 'o-' + f, { tool_name: f, tool_input: { file_path: 'a.txt' }, tool_response: { stdout: SAIDA_NORMAL } });
      assert.strictEqual(commits(dir, 'o-' + f), 0, f + ' contou commit pelo stdout');
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-7: stdout ausente, nulo ou que nao e texto nao lanca e nao conta', () => {
  const dir = temp('stdout-estranho');
  try {
    const respostas = [
      undefined, null, 'texto solto', 7, {}, { stdout: null }, { stdout: 7 }, { stdout: ['[master 4377f01] x'] },
      { stdout: { linha: '[master 4377f01] x' } }, { stderr: SAIDA_NORMAL }
    ];
    respostas.forEach(function (resp) {
      const entrada = { tool_name: 'Bash', tool_input: { command: 'git commit -m x' } };
      if (resp !== undefined) entrada.tool_response = resp;
      marcar(dir, 'x1', entrada);
    });
    assert.strictEqual(commits(dir, 'x1'), 0, JSON.stringify(sessao(dir, 'x1')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-7: a contagem pela linha chega ao gatilho de saude - 3 commits sem gitOperation disparam o aviso', () => {
  const dir = temp('gatilho');
  try {
    // Plano 091 (#9): modoContinuo false - o padrao ligado cala o gatilho de commits
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify({ modoContinuo: false }), 'utf8');
    for (let i = 0; i < 3; i++) {
      marcar(dir, 'g1', { tool_name: 'PowerShell', tool_response: { stdout: '[master 43' + i + '7f01] x\n' } });
    }
    assert.strictEqual(commits(dir, 'g1'), 3);
    marcar(dir, 'g1', { tool_name: 'Write', tool_input: { file_path: 'a.js' } });
    const f = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'portao-fecho.js')], {
      cwd: dir, encoding: 'utf8',
      input: JSON.stringify({ session_id: 'g1', cwd: dir, hook_event_name: 'Stop', last_assistant_message: 'Anotado.' }),
      env: Object.assign({}, process.env, { SWORN_TMP: path.join(dir, '_sessoes') })
    });
    assert.strictEqual(f.status, 0, f.stderr);
    assert.ok(f.stdout.indexOf('3 commits nesta sessao (limiar 3)') !== -1, f.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T11-7: o README diz as duas fontes do commit, que o -q nao conta, e que o formato das decisoes foi provado', () => {
  const readme = fs.readFileSync(path.join(RAIZ, 'GUIA.md'), 'utf8');
  const i = readme.indexOf('**Do que o gatilho de commit depende:**');
  assert.ok(i !== -1, 'sumiu o paragrafo "Do que o gatilho de commit depende"');
  const paragrafo = readme.slice(i).split(/\r?\n\s*\r?\n/)[0].replace(/\s+/g, ' ');
  assert.ok(paragrafo.indexOf('gitOperation.commit.sha') !== -1, 'falta o gitOperation.commit.sha: ' + paragrafo);
  assert.ok(/\[branch sha\]/.test(paragrafo), 'falta a linha [branch sha] como segunda fonte: ' + paragrafo);
  assert.ok(/git commit -q/.test(paragrafo) && /n[aã]o conta/.test(paragrafo), 'falta dizer que o -q nao conta: ' + paragrafo);
  assert.ok(paragrafo.indexOf('2.1.258') !== -1, 'a versao em que o gitOperation foi medido tem de seguir no texto');
  assert.ok(!/ainda n[aã]o foi provado/.test(paragrafo), 'a frase antiga sobre o formato das decisoes ficou: ' + paragrafo);
  assert.ok(/painel do VS Code/.test(paragrafo), 'falta dizer onde o formato das decisoes foi provado (D363): ' + paragrafo);
});
