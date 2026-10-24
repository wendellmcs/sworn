'use strict';
// D244/defeito 1 (D241 secao 2.1): com a sessao aberta numa SUBPASTA do projeto, os portoes
// liam o projeto.json so em `cwd/.claude/sworn/` e liberavam tudo. Estes testes abrem a
// sessao numa subpasta e exigem que o portao ache o projeto de cima.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const config = require('../scripts/lib/config.js');

function rodar(script, entrada, tmp) {
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', script)], {
    input: JSON.stringify(entrada),
    encoding: 'utf8',
    env: Object.assign({}, process.env, { SWORN_TMP: tmp })
  });
  let json = null;
  if (r.stdout && r.stdout.trim()) { try { json = JSON.parse(r.stdout); } catch (e) { json = null; } }
  return { status: r.status, json: json, stdout: r.stdout, stderr: r.stderr };
}

function negou(r) {
  return !!(r.json && r.json.hookSpecificOutput && r.json.hookSpecificOutput.permissionDecision === 'deny');
}

function liberou(r) {
  assert.strictEqual(r.status, 0, 'o portao tem de sair com 0. stderr: ' + r.stderr);
  assert.ok(!/portao falhou/.test(r.stderr || ''), 'o portao caiu e liberou por inercia: ' + r.stderr);
  assert.strictEqual(negou(r), false, 'negou: ' + r.stdout);
}

function montarProjeto(extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-raiz-'));
  fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
  const projeto = Object.assign({
    versaoConfig: 1,
    marchaPadrao: 'padrao',
    intocaveis: ['segredos/**'],
    marchas: { aaa: [], padrao: ['src/**'], rapida: ['docs/**'] }
  }, extra || {});
  fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify(projeto), 'utf8');
  fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'escopo.md'),
    '# Escopo\n**Objetivo:** x\n## Dentro\n- src/a.js\n', 'utf8');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  return dir;
}

function comTmp(fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-raiz-tmp-'));
  try { fn(base); } finally { fs.rmSync(base, { recursive: true, force: true }); }
}

function escrita(cwd, arquivo) {
  return { session_id: 's1', cwd: cwd, hook_event_name: 'PreToolUse', tool_name: 'Write',
    tool_input: { file_path: arquivo, content: 'x' } };
}

test('raizDoProjeto: sobe ate a pasta que tem .claude/sworn/projeto.json', () => {
  const dir = montarProjeto();
  const fundo = path.join(dir, 'src', 'a', 'b');
  fs.mkdirSync(fundo, { recursive: true });
  // pasta .claude/sworn SEM projeto.json no meio do caminho: tem de ser atravessada
  fs.mkdirSync(path.join(dir, 'src', '.claude', 'sworn'), { recursive: true });
  assert.strictEqual(path.resolve(config.raizDoProjeto(fundo)), path.resolve(dir));
  assert.strictEqual(path.resolve(config.raizDoProjeto(dir)), path.resolve(dir));
});

test('raizDoProjeto: sem projeto em lugar nenhum acima, devolve o proprio cwd', () => {
  const solto = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-solto-'));
  assert.strictEqual(config.raizDoProjeto(solto), solto);
});

test('raizDoProjeto: projeto dentro de projeto, vale o mais proximo', () => {
  const fora = montarProjeto();
  const dentro = path.join(fora, 'src', 'irmao');
  fs.mkdirSync(path.join(dentro, '.claude', 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(dentro, '.claude', 'sworn', 'projeto.json'), '{"versaoConfig":1}', 'utf8');
  const sub = path.join(dentro, 'lib');
  fs.mkdirSync(sub, { recursive: true });
  assert.strictEqual(path.resolve(config.raizDoProjeto(sub)), path.resolve(dentro));
});

test('D244/defeito 1: sessao numa subpasta continua sob o portao de escopo do projeto de cima', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    const sub = path.join(dir, 'src');
    const r = rodar('portao-escopo.js', escrita(sub, path.join(sub, 'b.js')), tmp);
    assert.ok(negou(r), 'src/b.js esta fora do escopo e a sessao em src/ o deixou passar: ' + r.stdout);
  });
});

test('D244/defeito 1: sessao numa subpasta, arquivo dentro do escopo passa', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    const sub = path.join(dir, 'src');
    fs.writeFileSync(path.join(sub, 'a.js'), 'velho', 'utf8');
    liberou(rodar('portao-escopo.js', escrita(sub, path.join(sub, 'a.js')), tmp));
  });
});

test('D244/defeito 1: sessao numa subpasta, intocavel do projeto de cima continua negado', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    const sub = path.join(dir, 'src');
    const r = rodar('portao-escopo.js', escrita(sub, path.join(dir, 'segredos', 'k.txt')), tmp);
    assert.ok(negou(r), 'intocavel liberado com a sessao em subpasta: ' + r.stdout);
  });
});

test('D244/defeito 1: arquivo fora de qualquer projeto segue liberado com a sessao numa subpasta', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    const sub = path.join(dir, 'src');
    const solto = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-solto-'));
    liberou(rodar('portao-escopo.js', escrita(sub, path.join(solto, 'nota.md')), tmp));
  });
});

test('D244/defeito 1: portao destrutivo le a plataforma do projeto de cima', () => {
  comTmp((tmp) => {
    const dir = montarProjeto({ plataforma: { so: 'win32', shell: 'powershell' } });
    const sub = path.join(dir, 'src');
    const r = rodar('portao-destrutivo.js', { session_id: 's1', cwd: sub, hook_event_name: 'PreToolUse',
      tool_name: 'PowerShell', tool_input: { command: 'git status && git log -1' } }, tmp);
    if (process.platform === 'win32') {
      assert.ok(negou(r), 'a regra de PowerShell 5.1 nao valeu com a sessao em subpasta: ' + r.stdout);
    } else {
      liberou(r); // a tabela de shell so vale quando o so da maquina e o declarado
    }
  });
});

test('D244/defeito 1: o fecho descarrega os contadores no projeto, nao na subpasta', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    const sub = path.join(dir, 'src');
    fs.mkdirSync(path.join(sub, '.claude', 'sworn'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'sworn', 's1.json'),
      JSON.stringify({ contadores: { agentes_despachados: 2 } }), 'utf8');
    const r = rodar('portao-fecho.js', { session_id: 's1', cwd: sub, hook_event_name: 'Stop',
      stop_hook_active: true }, tmp);
    assert.strictEqual(r.status, 0, r.stderr);
    const noProjeto = path.join(dir, '.claude', 'sworn', 'contadores.json');
    const naSub = path.join(sub, '.claude', 'sworn', 'contadores.json');
    assert.ok(fs.existsSync(noProjeto), 'contadores.json nao foi para o projeto');
    assert.strictEqual(JSON.parse(fs.readFileSync(noProjeto, 'utf8')).agentes_despachados, 2);
    assert.ok(!fs.existsSync(naSub), 'contadores.json foi parar na subpasta');
  });
});
