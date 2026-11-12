'use strict';
// C6 (s369, D769 f, D815): a abertura enxuta para modelo de contexto curto. Com "aberturaEnxuta": true no
// projeto.json, a abertura deixa as regras do projeto inteiras e troca os 4 blocos fixos (paralelo, menos paradas,
// qualidade de resposta, menos codigo) por uma linha cada, com o essencial de cada um. So o booleano true liga.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ae = require('../scripts/lib/abertura-enxuta.js');
const projetoLib = require('../scripts/lib/projeto.js');

const ABERTURA = path.join(__dirname, '..', 'scripts', 'abertura.js');

test('C6: o bloco fica inteiro sem a chave, vira a linha do resumo com true, e o vazio segue vazio', () => {
  const inteiro = '# sworn - qualidade de resposta (toda resposta no chat ao usuario)\n\n1. Conclusao na 1a linha.\n';
  assert.strictEqual(ae.bloco('qualidade', inteiro, {}), inteiro, 'sem a chave');
  assert.strictEqual(ae.bloco('qualidade', inteiro, null), inteiro, 'sem projeto');
  assert.strictEqual(ae.bloco('qualidade', inteiro, { aberturaEnxuta: false }), inteiro, 'false');
  for (const torto of ['true', 1, {}, [true]]) {
    assert.strictEqual(ae.bloco('qualidade', inteiro, { aberturaEnxuta: torto }), inteiro, 'so o booleano liga: ' + torto);
  }
  assert.strictEqual(ae.bloco('qualidade', inteiro, { aberturaEnxuta: true }), ae.LINHAS.qualidade + '\n');
  assert.strictEqual(ae.bloco('qualidade', '', { aberturaEnxuta: true }), '', 'o bloco desligado segue desligado');
  assert.strictEqual(ae.bloco('qualidade', null, { aberturaEnxuta: true }), null);
  for (const p of [{ aberturaEnxuta: true }, {}]) {
    assert.throws(() => ae.bloco('outro', inteiro, p), /bloco sem resumo: outro/,
      'nome sem linha de resumo e erro de programa, com a chave ligada ou nao: ' + JSON.stringify(p));
  }
  assert.throws(() => ae.bloco('toString', inteiro, { aberturaEnxuta: true }), /bloco sem resumo/, 'so as chaves proprias');
});

test('C6: cada linha do resumo guarda o essencial do bloco, em ASCII e numa linha so', () => {
  const L = ae.LINHAS;
  assert.deepStrictEqual(Object.keys(L).sort(), ['continuo', 'continuoDesligado', 'enxuto', 'paralelo', 'qualidade']);
  for (const [nome, linha] of Object.entries(L)) {
    assert.ok(/^# sworn - /.test(linha), nome + ': titulo');
    assert.ok(/^[\x20-\x7E]+$/.test(linha), nome + ': ASCII e sem quebra de linha: ' + linha);
  }
  for (const t of ['worktree', '8 agentes', '/sworn:parallel']) assert.ok(L.paralelo.includes(t), 'paralelo sem ' + t);
  for (const t of ['valide voce mesmo', 'Decisao: <o que>', 'custo se errado', 'Preciso do dono: <o que>',
    'Espero: <o que roda>', 'regra de negocio', 'credencial']) {
    assert.ok(L.continuo.includes(t), 'menos paradas sem ' + t);
  }
  assert.ok(L.continuoDesligado.includes('valide voce mesmo') && !L.continuoDesligado.includes('Espero:'),
    'com o modo continuo desligado, so a validacao');
  for (const t of ['1a linha', 'sem preambulo', 'linha que prova', 'idioma do usuario']) {
    assert.ok(L.qualidade.includes(t), 'qualidade sem ' + t);
  }
  for (const t of ['reuse', 'validacao na fronteira', 'seguranca', 'acessibilidade', 'atalho: <o que>',
    'trocar quando: <gatilho>']) {
    assert.ok(L.enxuto.includes(t), 'menos codigo sem ' + t);
  }
  assert.ok(projetoLib.CHAVES_LIGA_DESLIGA.indexOf(ae.CHAVE) !== -1, 'a chave e de liga/desliga (o tipo errado avisa)');
});

function abrir(tmp, nome, projeto, semRegras) {
  const dir = path.join(tmp, nome);
  fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'),
    JSON.stringify(Object.assign({ versaoConfig: 1, provaDePronto: 'node --test' }, projeto)), 'utf8');
  // uma regra no formato do regras.md (gatilho -> acao, com a falha de origem)
  if (!semRegras) {
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'regras.md'), '# Regras\n\n- ao afirmar qualquer fato -> ' +
      'marcar como verificado nesta sessao, inferido ou nao sei (falha de origem: a confianca acompanha a fluencia)\n',
      'utf8');
  }
  const r = spawnSync(process.execPath, [ABERTURA], {
    input: JSON.stringify({ session_id: 'c6-' + nome, cwd: dir, source: 'startup' }),
    encoding: 'utf8', env: Object.assign({}, process.env, { SWORN_TMP: path.join(tmp, '_sessoes') }), timeout: 30000
  });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout;
}

test('C6: abertura.js com a chave traz as regras inteiras e os 4 resumos, e encolhe mais de 2 mil caracteres', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-c6-'));
  try {
    const cheia = abrir(tmp, 'cheia', {});
    const enxuta = abrir(tmp, 'enxuta', { aberturaEnxuta: true });
    assert.ok(/# sworn - regras deste projeto/.test(cheia) && /# sworn - regras deste projeto/.test(enxuta),
      'as regras do projeto ficam nas duas');
    const regras = (t) => t.slice(t.indexOf('# sworn - regras deste projeto'), t.indexOf('# sworn - trabalho em paralelo'));
    assert.ok(regras(cheia).length > 100, 'o bloco de regras foi achado: ' + regras(cheia).length);
    assert.ok(enxuta.includes(regras(cheia)), 'as regras ficam inteiras, iguais as da abertura cheia');
    for (const nome of ['paralelo', 'continuo', 'qualidade', 'enxuto']) {
      assert.ok(enxuta.includes(ae.LINHAS[nome] + '\n'), 'falta o resumo ' + nome);
      assert.ok(!cheia.includes(ae.LINHAS[nome]), 'a cheia nao traz o resumo ' + nome);
    }
    assert.ok(enxuta.includes(ae.RODAPE), 'o rodape diz como voltar a abertura inteira');
    for (const inteiro of ['Suba a escada e pare no primeiro degrau', '1. Conclusao na 1a linha',
      '1. Agente em segundo plano', '2. Modo continuo ligado']) {
      assert.ok(cheia.includes(inteiro), 'a cheia traz: ' + inteiro);
      assert.ok(!enxuta.includes(inteiro), 'a enxuta nao traz: ' + inteiro);
    }
    assert.ok(cheia.length - enxuta.length > 2000, 'encolheu ' + (cheia.length - enxuta.length) + ' caracteres');
    // com o modo continuo desligado, a linha e a da validacao so
    const semContinuo = abrir(tmp, 'sem-continuo', { aberturaEnxuta: true, modoContinuo: false });
    assert.ok(semContinuo.includes(ae.LINHAS.continuoDesligado) && !semContinuo.includes(ae.LINHAS.continuo));
    // bloco desligado pela chave dele segue fora, sem linha de resumo
    const semParalelo = abrir(tmp, 'sem-paralelo', { aberturaEnxuta: true, paralelismo: false });
    assert.ok(!semParalelo.includes(ae.LINHAS.paralelo) && semParalelo.includes(ae.LINHAS.qualidade));
    // "true" entre aspas nao liga
    const aspas = abrir(tmp, 'aspas', { aberturaEnxuta: 'true' });
    assert.ok(!aspas.includes(ae.RODAPE) && aspas.includes('Suba a escada e pare no primeiro degrau') &&
      !aspas.includes(ae.LINHAS.enxuto), '"true" entre aspas nao liga: a abertura sai inteira');
    // sem regras.md (projeto antes do /sworn:init escrever as regras), a enxuta abre sem o bloco de regras e com os
    // 4 resumos e o rodape, sem quebrar
    const semRegras = abrir(tmp, 'sem-regras', { aberturaEnxuta: true }, true);
    assert.ok(!/# sworn - regras deste projeto/.test(semRegras), 'sem regras.md, sem o bloco de regras');
    for (const nome of ['paralelo', 'continuo', 'qualidade', 'enxuto']) {
      assert.ok(semRegras.includes(ae.LINHAS[nome] + '\n'), 'sem regras.md, falta o resumo ' + nome);
    }
    assert.ok(semRegras.includes(ae.RODAPE), 'sem regras.md, o rodape');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
