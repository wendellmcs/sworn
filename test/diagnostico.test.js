'use strict';
// D826 (D4): o /sworn:diagnose so mostra o achado cuja citacao confere: o script le os achados dos analistas e
// descarta, com o motivo, o que nao tem dimensao conhecida, texto, evidencia ou trecho que esteja na linha citada.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const diag = require('../scripts/lib/diagnostico.js');

const CLI = path.join(__dirname, '..', 'scripts', 'conferir-diagnostico.js');
delete process.env.CLAUDE_CODE_SESSION_ID;

function cenario() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-diag-'));
  const transcricoes = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-diag-tr-'));
  fs.writeFileSync(path.join(raiz, 'plano.md'), '# Plano\n- [ ] passo 1\n- [ ] passo 2\n', 'utf8');
  const sessao = path.join(transcricoes, 'sessao.jsonl');
  fs.writeFileSync(sessao, '{"type":"user","message":{"content":"faca o passo 1"}}\n' +
    '{"type":"assistant","message":{"content":"pulei para o passo 2"}}\n', 'utf8');
  return { raiz, transcricoes, sessao };
}
function limpar(c) { for (const p of [c.raiz, c.transcricoes]) fs.rmSync(p, { recursive: true, force: true }); }
function achado(dimensao, caminho, linha, trecho) {
  return { dimensao: dimensao, achado: 'o passo 1 ficou para tras', evidencia: { caminho: caminho, linha: linha, trecho: trecho } };
}

test('D826: as sete dimensoes do diagnostico', () => {
  assert.deepStrictEqual(diag.DIMENSOES, ['custo-e-tempo', 'plano', 'repetido', 'tropecos', 'evidencia', 'pedidos', 'travas']);
  assert.strictEqual(diag.TETO_DO_TRECHO, 200);
});

test('D826: o achado com citacao que confere passa; o resto sai com o motivo', () => {
  const c = cenario();
  try {
    const raizes = [c.raiz, c.transcricoes];
    const bons = [achado('plano', 'plano.md', 2, '- [ ] passo 1'), achado('plano', c.sessao, 2, 'pulei para o passo 2')];
    const ruins = [
      [achado('humor', 'plano.md', 2, 'passo 1'), /dimensao/],
      [Object.assign(achado('plano', 'plano.md', 2, 'passo 1'), { achado: '  ' }), /sem o texto do achado/],
      [{ dimensao: 'plano', achado: 'x' }, /sem evidencia/],
      [achado('plano', 'plano.md', 2, ''), /sem trecho/],
      [achado('plano', 'plano.md', 2, 'p'.repeat(201)), /mais de 200/],
      [achado('plano', 'plano.md', 3, '- [ ] passo 1'), /nao confere/],
      [achado('plano', '../fora.md', 1, 'x'), /nao confere/],
      [null, /nao e um objeto/],
      ['plano', /nao e um objeto/],
      [[achado('plano', 'plano.md', 2, 'passo 1')], /nao e um objeto/]
    ];
    const r = diag.conferirAchados(bons.concat(ruins.map((x) => x[0])), raizes);
    assert.deepStrictEqual(r.confirmados, bons);
    assert.strictEqual(r.descartados.length, ruins.length);
    r.descartados.forEach((d, i) => {
      assert.strictEqual(d.indice, bons.length + i);
      assert.match(d.motivo, ruins[i][1], 'descartado ' + i + ': ' + d.motivo);
    });
    // o teto: com a linha longa de verdade, 200 caracteres confirmam e 201 saem pelo tamanho
    fs.writeFileSync(path.join(c.raiz, 'longo.md'), 'a'.repeat(300) + '\n', 'utf8');
    const noTeto = diag.conferirAchados([achado('plano', 'longo.md', 1, 'a'.repeat(diag.TETO_DO_TRECHO))], raizes);
    assert.strictEqual(noTeto.confirmados.length, 1, '200 caracteres que estao na linha confirmam');
    const acima = diag.conferirAchados([achado('plano', 'longo.md', 1, 'a'.repeat(diag.TETO_DO_TRECHO + 1))], raizes);
    assert.match(acima.descartados[0].motivo, /mais de 200/);
    assert.deepStrictEqual(diag.conferirAchados([], raizes), { confirmados: [], descartados: [] }, 'lista vazia');
    assert.throws(() => diag.conferirAchados({}, raizes), /lista/);
  } finally { limpar(c); }
});

test('D826: o CLI le o arquivo dos achados e responde JSON; sem arquivo, ERRO com o passo', () => {
  const c = cenario();
  try {
    const arq = path.join(c.raiz, 'achados.json');
    fs.writeFileSync(arq, JSON.stringify([achado('plano', 'plano.md', 2, 'passo 1'), achado('plano', 'plano.md', 9, 'x')]), 'utf8');
    const r = spawnSync(process.execPath, [CLI, '--achados', arq, '--transcricoes', c.transcricoes],
      { cwd: c.raiz, encoding: 'utf8', shell: false });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const saida = JSON.parse(r.stdout);
    assert.strictEqual(saida.confirmados.length, 1);
    assert.strictEqual(saida.descartados.length, 1);
    assert.strictEqual(saida.raizes.length, 2);
    assert.strictEqual(saida.raizes[1], path.resolve(c.transcricoes), 'a pasta das transcricoes passada no --transcricoes');
    assert.strictEqual(saida.aviso, undefined);
    // sem --transcricoes e sem a pasta do projeto em projects/: so o projeto vale, e o aviso diz o passo
    const semPasta = spawnSync(process.execPath, [CLI, '--achados', arq],
      { cwd: c.raiz, encoding: 'utf8', shell: false, env: Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: c.transcricoes }) });
    assert.strictEqual(semPasta.status, 0, semPasta.stdout + semPasta.stderr);
    const s2 = JSON.parse(semPasta.stdout);
    assert.strictEqual(s2.raizes.length, 1);
    assert.match(s2.aviso, /^nao achei a pasta das transcricoes deste projeto: .*passe --transcricoes <pasta>/);
    const sem = spawnSync(process.execPath, [CLI, '--achados', path.join(c.raiz, 'nada.json')],
      { cwd: c.raiz, encoding: 'utf8', shell: false });
    assert.strictEqual(sem.status, 1);
    assert.match(sem.stdout, /^ERRO: nao li os achados em .*nada\.json \(causa: .*\)\. Grave a lista dos analistas nesse arquivo e rode de novo\.\n$/);
    const rodar = (args) => spawnSync(process.execPath, [CLI].concat(args), { cwd: c.raiz, encoding: 'utf8', shell: false });
    const semValor = rodar(['--achados', arq, '--transcricoes']);
    assert.strictEqual(semValor.status, 1);
    assert.match(semValor.stdout, /^ERRO: --transcricoes pede um valor/);
    assert.match(rodar(['--transcricoes', '--achados', arq]).stdout, /^ERRO: --transcricoes pede um valor/);
    const errada = rodar(['--achados', arq, '--transcricoes', path.join(c.raiz, 'nao-existe')]);
    assert.strictEqual(errada.status, 1);
    assert.match(errada.stdout, /^ERRO: a pasta de --transcricoes nao existe: .*nao-existe\. Passe a pasta/);
    assert.match(rodar(['--achados', arq, '--transcricoes', arq]).stdout, /^ERRO: a pasta de --transcricoes nao existe/,
      'um arquivo nao e a pasta');
    const truncado = path.join(c.raiz, 'truncado.json');
    fs.writeFileSync(truncado, '[{"dimensao": "plano"', 'utf8');
    const tr = rodar(['--achados', truncado]);
    assert.strictEqual(tr.status, 1);
    assert.match(tr.stdout, /^ERRO: nao li os achados em .*truncado\.json \(causa: .*\)\. Grave a lista/);
    const torto = path.join(c.raiz, 'torto.json');
    fs.writeFileSync(torto, '{"nao": "lista"}', 'utf8');
    const t = spawnSync(process.execPath, [CLI, '--achados', torto], { cwd: c.raiz, encoding: 'utf8', shell: false });
    assert.strictEqual(t.status, 1);
    assert.match(t.stdout, /^ERRO: .*lista/);
  } finally { limpar(c); }
});
