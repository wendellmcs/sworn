'use strict';
// A6-15/A7-06: os CLIs que olhavam o process.cwd() cru, rodados de uma subpasta, olhavam o lugar errado; agora sobem
// ate a raiz do projeto (config.raizDoProjeto), como os outros scripts.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPTS = path.join(__dirname, '..', 'scripts');

// sem o id da sessao: o auditar.js mediria a transcricao da sessao que roda a suite (dezenas de segundos, e outra a
// cada maquina), e o teste so olha a pasta de onde se roda
const AMBIENTE = Object.assign({}, process.env);
delete AMBIENTE.CLAUDE_CODE_SESSION_ID;

function rodarDe(pasta, script, args) {
  return spawnSync(process.execPath, [path.join(SCRIPTS, script)].concat(args), { cwd: pasta, encoding: 'utf8',
    timeout: 60000, env: AMBIENTE });
}
// o prazo estourado e o spawn que falhou saem com a causa, nao com mensagem vazia
function falha(r) { return [r.error && r.error.message, r.signal, r.stdout, r.stderr].filter(Boolean).join(' | '); }

// projeto com pasta de espaco no nome e uma subpasta funda; devolve { raiz, sub }
function projetoComSub(t) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn raiz-clis-'));
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
  fs.mkdirSync(path.join(raiz, '.claude', 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(raiz, '.claude', 'sworn', 'projeto.json'), '{}', 'utf8');
  const sub = path.join(raiz, 'src', 'meu fundo');
  fs.mkdirSync(sub, { recursive: true });
  return { raiz: raiz, sub: sub };
}

test('A6-15: o uso.js rodado de uma subpasta le os contadores da raiz do projeto', (t) => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-raiz-clis-'));
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
  fs.mkdirSync(path.join(raiz, '.claude', 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(raiz, '.claude', 'sworn', 'projeto.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(raiz, '.claude', 'sworn', 'contadores.json'), JSON.stringify({ fora_do_escopo: 7 }), 'utf8');
  const sub = path.join(raiz, 'src', 'fundo');
  fs.mkdirSync(sub, { recursive: true });
  const r = rodarDe(sub, 'uso.js', []);
  assert.strictEqual(r.status, 0, falha(r));
  assert.match(r.stdout, /fora_do_escopo/, r.stdout);
  assert.doesNotMatch(r.stdout, /nenhum disparo registrado/, r.stdout);
});

// o caminho que a pessoa digita e da pasta de onde ela roda, nao da raiz: so o estado do projeto sobe
test('A6-15: o caminho relativo de --seguranca, --memoria, --proxima-decisao e --abrir vale da pasta de onde se roda', (t) => {
  const { raiz, sub } = projetoComSub(t);
  fs.mkdirSync(path.join(sub, 'plugin-x'));
  fs.writeFileSync(path.join(sub, 'plugin-x', 'README.md'), 'nada\n', 'utf8');
  const seg = rodarDe(sub, 'auditar.js', ['--seguranca', 'plugin-x']);
  assert.strictEqual(seg.status, 0, falha(seg));
  fs.writeFileSync(path.join(sub, 'MEMORY.md'), '- [a](a.md) - b\n', 'utf8');
  const mem = rodarDe(sub, 'auditar.js', ['--memoria', 'MEMORY.md']);
  assert.strictEqual(mem.status, 0, falha(mem));
  assert.strictEqual(JSON.parse(mem.stdout).memoria.caminho, path.join(sub, 'MEMORY.md'), falha(mem));
  fs.writeFileSync(path.join(sub, 'decisoes.md'), '## D12 uma decisao\n', 'utf8');
  const dec = rodarDe(sub, 'plano.js', ['--proxima-decisao', 'decisoes.md']);
  assert.strictEqual(dec.status, 0, falha(dec));
  assert.strictEqual(dec.stdout.trim(), '13', falha(dec));
  fs.writeFileSync(path.join(sub, 'plano.md'), '# Plano\n\n- [ ] passo\n', 'utf8');
  const abr = rodarDe(sub, 'plano.js', ['--abrir', 'plano.md', '--sessao', 'ensaio']);
  assert.strictEqual(abr.status, 0, falha(abr));
  const ativo = JSON.parse(fs.readFileSync(path.join(raiz, '.claude', 'sworn', 'plano-ativo.json'), 'utf8'));
  assert.strictEqual(ativo.arquivo, 'src/meu fundo/plano.md');
});

test('A6-15/A7-06: nenhum dos CLIs consertados usa o process.cwd() cru como pasta do projeto', () => {
  // cada uso aceito sai da linha antes da conferencia, um a um: a raiz do projeto, o caminho mostrado a quem rodou
  // (path.relative), o caminho que a pessoa digitou (path.resolve com o segundo argumento), que e da pasta de onde ela
  // roda, e a comparacao do plano.js entre a pasta de onde se roda e a raiz; path.resolve(process.cwd()) sozinho e o
  // cwd cru e nao passa
  const aceitos = [/raizDoProjeto\(process\.cwd\(\)\)/g, /path\.relative\(process\.cwd\(\),/g,
    /path\.resolve\(process\.cwd\(\),/g, /path\.resolve\(process\.cwd\(\)\) !== path\.resolve\(cwd\)/g];
  for (const nome of ['uso.js', 'cobertura.js', 'auditar.js', 'catalogo.js', 'plano.js', 'sessao.js', 'experimento.js']) {
    const linhas = fs.readFileSync(path.join(SCRIPTS, nome), 'utf8').split(/\r?\n/);
    const cruas = linhas.filter((l) => !/^\s*(?:\/\/|\*)/.test(l) &&
      /process\.cwd\s*\(\)/.test(aceitos.reduce((resto, re) => resto.replace(re, ''), l)));
    assert.deepStrictEqual(cruas, [], nome);
  }
});
