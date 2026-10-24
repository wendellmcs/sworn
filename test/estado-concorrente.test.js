'use strict';
// D244/defeito 11 (D242 secao 3.11): a onda 7 despachou 28 inspetores e o contador disse 11. Os
// hooks de um disparo paralelo rodam ao mesmo tempo, e o estado da sessao era ler-mudar-gravar sem
// trava: um gravava por cima do outro, e uma leitura no meio de uma gravacao lia JSON pela metade
// e zerava o estado INTEIRO (medido antes da correcao: 20 disparos -> 3, 2, 15, 15, 17).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'portao-agente.js');

function disparo(tmp, cwd) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [SCRIPT], { env: Object.assign({}, process.env, { SWORN_TMP: tmp }) });
    p.on('close', ok);
    p.stdin.end(JSON.stringify({ session_id: 'corr', cwd: cwd, hook_event_name: 'PreToolUse', tool_name: 'Agent',
      tool_input: { subagent_type: 'x', prompt: 'p' } }));
  });
}

test('D244/defeito 11: 20 disparos paralelos contam 20, e o resto do estado sobrevive', async () => {
  for (let rodada = 0; rodada < 3; rodada++) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-corrida-'));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-corrida-proj-'));
    try {
      fs.mkdirSync(path.join(tmp, 'sworn'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'sworn', 'corr.json'), JSON.stringify({ gitAbertura: ['a.js'] }), 'utf8');
      await Promise.all(Array.from({ length: 20 }, () => disparo(tmp, cwd)));
      const s = JSON.parse(fs.readFileSync(path.join(tmp, 'sworn', 'corr.json'), 'utf8'));
      assert.strictEqual(s.contadores.agentes_despachados, 20, 'rodada ' + (rodada + 1) + ': ' + JSON.stringify(s));
      assert.deepStrictEqual(s.gitAbertura, ['a.js'], 'a foto da abertura se perdeu no meio da corrida');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }
});

// Quem le sem trava (`estado.ler` direto, como o portao-escopo) nao pode ver arquivo pela metade.
test('D244/defeito 11: leitor sem trava nunca ve o estado vazio enquanto outro grava', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-leitor-'));
  const lib = JSON.stringify(path.join(__dirname, '..', 'scripts', 'lib', 'estado.js'));
  const env = Object.assign({}, process.env, { SWORN_TMP: tmp });
  const escritor = 'const e=require(' + lib + ');const g="x".repeat(200000);' +
    'for(let i=0;i<150;i++)e.gravar("leit",{gitAbertura:["a.js"],p:g+i});';
  const leitor = 'const e=require(' + lib + ');let v=0;for(let i=0;i<3000;i++){const s=e.ler("leit");' +
    'if(!s.gitAbertura)v++;}process.stdout.write(String(v));';
  try {
    const estado = require('../scripts/lib/estado.js');
    const antes = process.env.SWORN_TMP;
    process.env.SWORN_TMP = tmp;
    try { estado.gravar('leit', { gitAbertura: ['a.js'] }); } finally {
      if (antes === undefined) delete process.env.SWORN_TMP; else process.env.SWORN_TMP = antes;
    }
    const rodar = (codigo) => new Promise((ok) => {
      let saida = '';
      const p = spawn(process.execPath, ['-e', codigo], { env: env });
      p.stdout.on('data', (d) => { saida += d; });
      p.on('close', () => ok(saida));
    });
    const [, vazias] = await Promise.all([rodar(escritor), rodar(leitor)]);
    assert.strictEqual(vazias, '0', 'o leitor viu o estado vazio ' + vazias + ' vezes');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('D244/defeito 11: trava abandonada por processo morto nao prende a sessao', () => {
  const estado = require('../scripts/lib/estado.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-trava-'));
  const antes = process.env.SWORN_TMP;
  process.env.SWORN_TMP = tmp;
  try {
    fs.mkdirSync(path.join(tmp, 'sworn'), { recursive: true });
    const trava = estado.caminhoTrava('velha');
    fs.writeFileSync(trava, 'morto', 'utf8');
    const velho = new Date(Date.now() - 60 * 1000);
    fs.utimesSync(trava, velho, velho);
    const t0 = Date.now();
    assert.strictEqual(estado.incrementar('velha', 'x'), 1);
    assert.ok(Date.now() - t0 < 1500, 'esperou a trava velha em vez de a tomar');
    assert.strictEqual(fs.existsSync(trava), false, 'a trava tem de ser solta no fim');
  } finally {
    if (antes === undefined) delete process.env.SWORN_TMP; else process.env.SWORN_TMP = antes;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
