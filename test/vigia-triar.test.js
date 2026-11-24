'use strict';
// H11b (D909): o comando que grava a marca de triada da ficha do vigia ou do radar. Sem rede, sem git: so a pasta.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'vigia-triar.js');
const vigia = require('../scripts/lib/vigia-local.js');

function rodar(args, env) {
  return spawnSync(process.execPath, [SCRIPT].concat(args),
    { encoding: 'utf8', windowsHide: true, timeout: 30000, env: Object.assign({}, process.env, env || {}) });
}

function base(nome) {
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-triar-' + nome + '-'));
  fs.writeFileSync(path.join(b, 'novidades.md'), 'semana: 2026-11-23\n\n# Novidades\n');
  fs.mkdirSync(path.join(b, 'radar'));
  fs.writeFileSync(path.join(b, 'radar', 'novidades.md'), 'semana: 2026-11-16\n\n# Radar\n');
  return b;
}

function visto(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'visto.json'), 'utf8'));
}

test('vigia-triar: --vigia grava a marca na pasta do vigia, --radar na subpasta radar/ (pela SWORN_VIGIA); saida 0', () => {
  const b = base('ok');
  try {
    // as duas fichas ja vistas e nao triadas: a abertura lembra das duas antes da marca (ronda 1 do teste)
    fs.writeFileSync(path.join(b, 'visto.json'), JSON.stringify({ semana: '2026-11-23' }));
    fs.writeFileSync(path.join(b, 'radar', 'visto.json'), JSON.stringify({ semana: '2026-11-16' }));
    const antes = Date.UTC(2026, 10, 24, 12, 0, 0);
    assert.ok(vigia.avisoDoVigia({ vigia: true }, { pasta: b, agora: antes }).indexOf('nao foi triada') !== -1);
    assert.ok(vigia.avisoDoRadar({ vigia: true }, { pasta: b, agora: antes }).indexOf('nao foi triada') !== -1);

    const r = rodar(['--vigia', '--semana', '2026-11-23', '--como', 'D909: nada a adotar', '--pasta', b]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.indexOf('ficha de 2026-11-23 do vigia marcada como triada') !== -1, r.stdout);
    assert.strictEqual(visto(b).triada.semana, '2026-11-23');
    assert.strictEqual(visto(b).triada.como, 'D909: nada a adotar');
    assert.strictEqual(visto(path.join(b, 'radar')).triada, undefined, 'o --vigia marcou o radar');

    // a pasta pela variavel de ambiente, nao por --pasta: e o unico teste dela
    const s = rodar(['--radar', '--semana', '2026-11-16', '--como', 'D909'], { SWORN_VIGIA: b });
    assert.strictEqual(s.status, 0, s.stderr);
    assert.ok(s.stdout.indexOf('do radar marcada como triada') !== -1, s.stdout);
    assert.strictEqual(visto(path.join(b, 'radar')).triada.semana, '2026-11-16');
    // e a abertura do dia seguinte (o aviso de hoje ja saiu) cala o lembrete das duas
    const depois = antes + 24 * 60 * 60 * 1000;
    assert.strictEqual(vigia.avisoDoVigia({ vigia: true }, { pasta: b, agora: depois }).indexOf('nao foi triada'), -1);
    assert.strictEqual(vigia.avisoDoRadar({ vigia: true }, { pasta: b, agora: depois }).indexOf('nao foi triada'), -1);
  } finally { fs.rmSync(b, { recursive: true, force: true }); }
});

test('vigia-triar: recusa (saida 1) a semana que nao e a do disco, sem gravar', () => {
  const b = base('recusa');
  try {
    const r = rodar(['--radar', '--semana', '2026-11-23', '--como', 'x', '--pasta', b]);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.ok(r.stderr.indexOf('a ficha no disco e a de 2026-11-16') !== -1 && r.stderr.indexOf('Nada foi gravado.') !== -1,
      r.stderr);
    assert.ok(!fs.existsSync(path.join(b, 'radar', 'visto.json')));
    // sem ficha (arquivo ausente, sem a linha semana:, pasta radar/ ausente): recusa, sem gravar
    fs.rmSync(path.join(b, 'novidades.md'));
    const sem = rodar(['--vigia', '--semana', '2026-11-23', '--como', 'x', '--pasta', b]);
    assert.strictEqual(sem.status, 1, sem.stderr);
    assert.ok(sem.stderr.indexOf('nao ha ficha para triar') !== -1, sem.stderr);
    fs.writeFileSync(path.join(b, 'novidades.md'), '# so um titulo\n');
    const torta = rodar(['--vigia', '--semana', '2026-11-23', '--como', 'x', '--pasta', b]);
    assert.strictEqual(torta.status, 1, torta.stderr);
    fs.rmSync(path.join(b, 'radar'), { recursive: true, force: true });
    const semRadar = rodar(['--radar', '--semana', '2026-11-16', '--como', 'x', '--pasta', b]);
    assert.strictEqual(semRadar.status, 1, semRadar.stderr);
    assert.ok(!fs.existsSync(path.join(b, 'visto.json')) && !fs.existsSync(path.join(b, 'radar')), 'a recusa gravou');
  } finally { fs.rmSync(b, { recursive: true, force: true }); }
});

test('vigia-triar: uso errado (saida 2) - nenhum ou os dois de --vigia/--radar, semana torta, flag sem valor', () => {
  const b = base('uso');
  try {
    const casos = [
      ['--semana', '2026-11-23', '--como', 'x'],
      ['--vigia', '--radar', '--semana', '2026-11-23', '--como', 'x'],
      ['--vigia', '--semana', '23/11/2026', '--como', 'x'],
      ['--vigia', '--semana', '--como', 'x'],
      ['--vigia', '--semana', '2026-11-23'],
      ['--vigia', '--semana', '2026-11-23', '--como', ''],
      ['--vigia', '--semana', '2026-11-23', '--como', 'x', '--pasta']
    ];
    for (const args of casos) {
      const r = rodar(args.concat(args.indexOf('--pasta') === -1 ? ['--pasta', b] : []));
      assert.strictEqual(r.status, 2, args.join(' ') + ' -> ' + r.status + ' ' + r.stderr);
      assert.ok(r.stderr.indexOf('uso: node vigia-triar.js') !== -1, r.stderr);
    }
    const nadaGravado = () => !fs.existsSync(path.join(b, 'visto.json')) && !fs.existsSync(path.join(b, 'radar', 'visto.json'));
    assert.ok(nadaGravado(), 'uso errado gravou');
    // a flag do comando no lugar do valor e uso errado; um valor que so comeca com -- e valor
    const f = rodar(['--vigia', '--semana', '2026-11-23', '--como', '--pasta', b]);
    assert.strictEqual(f.status, 2, f.stderr);
    assert.ok(f.stderr.indexOf('--como pede um valor.') !== -1, f.stderr);
    assert.ok(nadaGravado(), 'a flag no lugar do valor gravou');
    const t = rodar(['--vigia', '--semana', '2026-11-23', '--como', '-- nada a adotar', '--pasta', b]);
    assert.strictEqual(t.status, 0, t.stderr);
    assert.strictEqual(visto(b).triada.como, '-- nada a adotar');
  } finally { fs.rmSync(b, { recursive: true, force: true }); }
});
