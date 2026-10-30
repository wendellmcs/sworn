'use strict';
/**
 * O VEREDITO DO EXPERIMENTO DA D83.
 *
 * Decisao 10 do dono: este experimento TEM DE PODER REPROVAR O PLUGIN. Um
 * criterio que so consegue confirmar nao e experimento, e cerimonia.
 *
 * Quem reprova o plugin e a coluna NADA, e ela NAO reprova a suite - a propria
 * D83 avisa que NAO BASTA e o desfecho esperado. Quem reprova a suite e so o
 * INVALIDO: um experimento que nao mede o que diz medir, apresentado como se
 * medisse, e pior do que experimento nenhum.
 *
 * Como na T40, ha duas metades: o INSTRUMENTO, provado com resultados de
 * mentira montados aqui, e a ASSERCAO SOBRE ESTE AMBIENTE, que neste
 * repositorio sempre PULA - o plugin nao guarda experimento de ninguem.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ob = require('../scripts/lib/obrigacoes.js');

const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'experimento.js');
const PROVA = path.join('.claude', 'sworn', 'experimento-d83.json');

const LINHAS = [
  { id: 'marcha-3', familia: 'marcha', titulo: 'AAA' },
  { id: 'lente-1', familia: 'lente', titulo: 'Fidelidade ao design system' },
  { id: 'guarda-1', familia: 'guarda', titulo: 'Sem commit sem pedido' }
];

function resultado(extra) {
  return Object.assign({
    tarefa: { descricao: 'texto de estado de erro numa tela', referencia: 'abc1234' },
    executor: 'sessao de execucao',
    juiz: 'sessao de julgamento',
    semManualAntigo: true,
    linhas: [
      { id: 'marcha-3', mecanismo: 'HOOK', evidencia: 'o portao de marcha exigiu o plano' },
      { id: 'lente-1', mecanismo: 'REGRAS', evidencia: 'regras.md:12 nomeia o token' },
      { id: 'guarda-1', mecanismo: 'HOOK', evidencia: 'o portao de fecho barrou' }
    ]
  }, extra || {});
}
function pasta() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sworn exp ')); }
function rodar(args, cwd) {
  const r = spawnSync(process.execPath, [SCRIPT].concat(args), { cwd: cwd || RAIZ, encoding: 'utf8' });
  return { status: r.status, saida: String(r.stdout) + String(r.stderr), stdout: String(r.stdout) };
}

// ── os cinco desfechos ───────────────────────────────────────────────────

test('experimento: sem resultado gravado o veredito e NAO PROVADO, e isso nao reprova', () => {
  const c = ob.conferirResultado(LINHAS, null);
  assert.strictEqual(c.veredito, 'NAO PROVADO');
  assert.strictEqual(c.temResultado, false);
  assert.deepStrictEqual(c.invalidez, [], 'nao rodar nunca pode ser invalido');
  assert.ok(/continua sem resposta/.test(ob.motivo(c)));
});

// Pedido 12 (A3-29): o NAO PROVADO dizia que nada reprova e parava; agora diz o comando que roda o experimento.
test('experimento: o NAO PROVADO diz como rodar o experimento', () => {
  const m = ob.motivo(ob.conferirResultado(LINHAS, null));
  assert.ok(m.indexOf('node "<plugin>/scripts/experimento.js" --manual <pasta do seu manual>') !== -1, m);
  assert.ok(/mesmo comando com --veredito/.test(m), m);
});

test('experimento: tabela inteira, com mecanismo e evidencia, da BASTA', () => {
  const c = ob.conferirResultado(LINHAS, resultado());
  assert.strictEqual(c.veredito, 'BASTA');
  assert.strictEqual(c.classificadas, 3);
  assert.strictEqual(c.porMecanismo.HOOK, 2);
  assert.strictEqual(c.porMecanismo.REGRAS, 1);
  assert.deepStrictEqual(c.nada, []);
});

test('experimento: uma linha em NADA ja da NAO BASTA, e a nomeia', () => {
  const r = resultado();
  r.linhas[1] = { id: 'lente-1', mecanismo: 'NADA' };
  const c = ob.conferirResultado(LINHAS, r);
  assert.strictEqual(c.veredito, 'NAO BASTA');
  assert.strictEqual(c.nada.length, 1);
  assert.strictEqual(c.nada[0].id, 'lente-1');
  const m = ob.motivo(c);
  assert.ok(/\[NADA\] lente-1/.test(m), m);
  assert.ok(/continua precisando/.test(m), m);
  assert.ok(m.indexOf('NAO BASTA: 1 de 3 obrigacoes') !== -1, m);
  assert.ok(m.indexOf('[NADA] lente-1 - Fidelidade ao design system') !== -1, m);
});

test('experimento: NADA e a UNICA coluna que reprova o plugin - FORA e cobertura', () => {
  const r = resultado();
  r.linhas[2] = { id: 'guarda-1', mecanismo: 'FORA', evidencia: 'D82: contrato de negocio fica no AGENTS.md' };
  r.linhas[0] = { id: 'marcha-3', mecanismo: 'SKILL', evidencia: 'skills/tela/SKILL.md:8 manda a marcha' };
  const c = ob.conferirResultado(LINHAS, r);
  assert.strictEqual(c.veredito, 'BASTA');
  assert.strictEqual(c.porMecanismo.FORA, 1);
  assert.strictEqual(c.porMecanismo.SKILL, 1);
  assert.ok(ob.motivo(c).indexOf('HOOK 0 | REGRAS 1 | SKILL 1 | FORA 1') !== -1, ob.motivo(c));
});

// L3 (s104), A3-20: o comentario do obrigacoes.js e o roteiro mandam o FORA citar a decisao; o codigo so pedia texto.
test('L3 A3-20: FORA sem citar a decisao INVALIDA; com D<numero> ou "decisao <numero>" vale', () => {
  // revisao L3 R2 (correcao, P1): prosa com numero nao e citacao - "decis" solto, d minusculo separado, nome de arquivo
  for (const ev of ['porque sim', 'ja foi decidido', 'D', 'AD82', 'a decisao de 5 minutos', 'decisivo 3', 'tela d 5',
    'veja d3.js', 'decidido em 2026-10-22', 'nr. 82']) {
    const r = resultado();
    r.linhas[2] = { id: 'guarda-1', mecanismo: 'FORA', evidencia: ev };
    const c = ob.conferirResultado(LINHAS, r);
    assert.strictEqual(c.veredito, 'INVALIDO', ev);
    assert.ok(c.invalidez.some((m) => /guarda-1/.test(m) && /cite a decisao/.test(m)), JSON.stringify(c.invalidez));
  }
  // revisao L3 R1 (correcao, P1): plural, espaco e hifen tambem citam a decisao
  for (const ev of ['D82: contrato de negocio fica no AGENTS.md', 'decisão 8 do dono', 'ver d82', 'decisões 82 e 83',
    'D 82', 'D-82', 'decisoes 82', 'decisão nº 82', 'decisão #82', 'decisão 82',
    // R2: numero por extenso, ponto e cerquilha depois do D
    'decisao numero 82', 'decisão número 82', 'decisao nr. 82', 'D.82', 'D#82', '(D82)', 'pela D82.']) {
    const r = resultado();
    r.linhas[2] = { id: 'guarda-1', mecanismo: 'fora', evidencia: ev };
    assert.strictEqual(ob.conferirResultado(LINHAS, r).veredito, 'BASTA', ev);
  }
  // revisao L3 R3 (correcao, P1; D601): texto montado de proposito nao trava a checagem (retrocesso exponencial)
  const r = resultado();
  r.linhas[2] = { id: 'guarda-1', mecanismo: 'FORA', evidencia: 'decisao ' + 'n  '.repeat(40) + 'x' };
  const t0 = Date.now();
  assert.strictEqual(ob.conferirResultado(LINHAS, r).veredito, 'INVALIDO');
  assert.ok(Date.now() - t0 < 500, 'demorou ' + (Date.now() - t0) + ' ms');
});

test('experimento: obrigacao sem classificacao nenhuma da INCONCLUSIVO', () => {
  const r = resultado();
  r.linhas.pop();
  const c = ob.conferirResultado(LINHAS, r);
  assert.strictEqual(c.veredito, 'INCONCLUSIVO');
  assert.deepStrictEqual(c.semClassificacao, ['guarda-1']);
  assert.ok(/nem a favor nem contra/.test(ob.motivo(c)));
  assert.ok(ob.motivo(c).indexOf('INCONCLUSIVO: 1 de 3 obrigacoes') !== -1 &&
    ob.motivo(c).indexOf('contra: guarda-1') !== -1, ob.motivo(c));
});

// Pedido 12 (A3-31): os rotulos do BASTA saiam sem legenda e o INCONCLUSIVO saia sem o proximo passo.
test('experimento: o BASTA explica os rotulos e o INCONCLUSIVO diz o proximo passo', () => {
  const basta = ob.motivo(ob.conferirResultado(LINHAS, resultado()));
  assert.ok(/HOOK = um portao do plugin .+, REGRAS = .+, SKILL = .+, FORA = uma decisao anterior/.test(basta), basta);
  const r = resultado();
  r.linhas.pop();
  const inc = ob.motivo(ob.conferirResultado(LINHAS, r));
  assert.ok(/rode de novo com --veredito/.test(inc), inc);
});

// Pedido 12 (A3-42): o mecanismo que nao existe listava os validos sem dizer o que cada um e; a legenda e a do BASTA,
// com o NADA junto (ele tambem e valido).
test('experimento: o INVALIDO do mecanismo que nao existe diz o que cada valido quer dizer', () => {
  const r = resultado();
  r.linhas[0] = { id: 'marcha-3', mecanismo: 'GANCHO', evidencia: 'o portao exigiu' };
  const m = ob.conferirResultado(LINHAS, r).invalidez.find((x) => /mecanismo que nao existe/.test(x)) || '';
  const basta = ob.motivo(ob.conferirResultado(LINHAS, resultado()));
  const leg = /\((HOOK = .+, FORA = [^)]+)\)/.exec(basta);
  assert.ok(leg, basta);
  assert.ok(m.indexOf(leg[1]) !== -1, 'a legenda do BASTA nao esta no INVALIDO: ' + m);
  assert.match(m, /NADA = valeu apenas porque alguem lembrou/, m);
});

// ── as travas contra cerimonia: cada uma sozinha invalida ────────────────

test('experimento: juiz igual ao executor INVALIDA - e auto-avaliacao (D83, item 5)', () => {
  const c = ob.conferirResultado(LINHAS, resultado({ juiz: 'sessao de execucao' }));
  assert.strictEqual(c.veredito, 'INVALIDO');
  assert.ok(c.invalidez.some((m) => /juiz e executor/.test(m)), JSON.stringify(c.invalidez));
  const caixa = resultado({ executor: 'Sessao de Execucao', juiz: 'sessao de execucao' });
  assert.strictEqual(ob.conferirResultado(LINHAS, caixa).veredito, 'INVALIDO', 'a caixa nao faz duas pessoas');
  assert.ok(ob.motivo(c).indexOf('  - juiz e executor sao o mesmo') !== -1, 'o INVALIDO diz por que');
  for (const [campo, falta] of [['executor', 'QUEM executou'], ['juiz', 'QUEM julgou']]) {
    const r = resultado();
    delete r[campo];
    assert.ok(ob.conferirResultado(LINHAS, r).invalidez.some((m) => m.indexOf(falta) !== -1), campo);
  }
});

test('experimento: sem declarar que o manual antigo estava fora, INVALIDA', () => {
  for (const v of [false, undefined, 'sim', 1]) {
    const c = ob.conferirResultado(LINHAS, resultado({ semManualAntigo: v }));
    assert.strictEqual(c.veredito, 'INVALIDO', String(v));
    assert.ok(c.invalidez.some((m) => /mede memoria/.test(m)));
  }
});

test('experimento: tarefa sem referencia rastreavel INVALIDA - sintetica nao serve', () => {
  for (const t of [{ descricao: 'x' }, { descricao: 'x', referencia: '  ' }, undefined]) {
    const c = ob.conferirResultado(LINHAS, resultado({ tarefa: t }));
    assert.strictEqual(c.veredito, 'INVALIDO');
    assert.ok(c.invalidez.some((m) => /sintetica nao serve/.test(m)));
  }
});

test('experimento: cobertura afirmada SEM evidencia INVALIDA - a tabela nao escapa da regra', () => {
  for (const mec of ['HOOK', 'REGRAS', 'SKILL', 'FORA']) {
    const r = resultado();
    r.linhas[0] = { id: 'marcha-3', mecanismo: mec, evidencia: '   ' };
    const c = ob.conferirResultado(LINHAS, r);
    assert.strictEqual(c.veredito, 'INVALIDO', mec);
    assert.ok(c.invalidez.some((m) => /afirma cobertura por/.test(m)));
  }
});

// Pedido 12 (A3-30): a invalidez da evidencia vazia dava sermao e nao dizia o conserto, que e preencher o campo.
test('experimento: cobertura sem evidencia diz que preencher o campo evidencia conserta, e com o que', () => {
  const r = resultado();
  r.linhas[0] = { id: 'marcha-3', mecanismo: 'HOOK', evidencia: '' };
  const m = ob.conferirResultado(LINHAS, r).invalidez.join('\n');
  assert.ok(/preencha o campo evidencia/.test(m) && /portao que disparou/.test(m), m);
});

test('experimento: NADA e o unico mecanismo que nao precisa de evidencia', () => {
  const r = resultado();
  r.linhas[0] = { id: 'marcha-3', mecanismo: 'NADA' };
  const c = ob.conferirResultado(LINHAS, r);
  assert.strictEqual(c.veredito, 'NAO BASTA', 'exigir prova de que NADA aconteceu e impossivel');
});

test('experimento: mecanismo fora do vocabulario INVALIDA, nomeando o que valeria', () => {
  const r = resultado();
  r.linhas[0] = { id: 'marcha-3', mecanismo: 'TALVEZ', evidencia: 'achei que sim' };
  const c = ob.conferirResultado(LINHAS, r);
  assert.strictEqual(c.veredito, 'INVALIDO');
  assert.ok(c.invalidez.some((m) => /nao existe/.test(m) && /HOOK/.test(m)));
  r.linhas[0] = { id: 'marcha-3', mecanismo: 'hook', evidencia: 'o portao de marcha exigiu' };
  assert.strictEqual(ob.conferirResultado(LINHAS, r).veredito, 'BASTA', 'a caixa nao tira do vocabulario');
});

test('experimento: o motivo do INVALIDO proibe afrouxar o teste', () => {
  const m = ob.motivo(ob.conferirResultado(LINHAS, resultado({ juiz: 'sessao de execucao' })));
  assert.ok(/NAO se conserta afrouxando/i.test(m), m);
});

// ── bordas ───────────────────────────────────────────────────────────────

test('experimento: linha de um inventario velho e ignorada, nao invalida', () => {
  const r = resultado();
  r.linhas.push({ id: 'lente-99', mecanismo: 'HOOK', evidencia: 'de uma versao anterior do manual' });
  const c = ob.conferirResultado(LINHAS, r);
  assert.deepStrictEqual(c.forasteiras, ['lente-99']);
  assert.strictEqual(c.veredito, 'BASTA', 'obrigacao que saiu do manual nao e problema deste projeto');
});

test('experimento: a mesma linha classificada duas vezes conta uma vez', () => {
  const r = resultado();
  r.linhas.push({ id: 'marcha-3', mecanismo: 'NADA' });
  const c = ob.conferirResultado(LINHAS, r);
  assert.strictEqual(c.classificadas, 3);
  assert.strictEqual(c.veredito, 'BASTA', 'a primeira classificacao vale; a repetida nao reabre');
});

test('experimento: resultado malformado nao vira prova nem estoura', () => {
  for (const lixo of [undefined, null, 42, 'texto', {}, { linhas: 'nao e lista' }, { linhas: [] }]) {
    const c = ob.conferirResultado(LINHAS, lixo);
    assert.ok(c.veredito === 'NAO PROVADO' || c.veredito === 'INVALIDO', JSON.stringify(lixo));
    assert.deepStrictEqual(c.nada, []);
  }
});

test('experimento: inventario vazio nao produz veredito nenhum', () => {
  const c = ob.conferirResultado([], resultado());
  assert.strictEqual(c.veredito, 'NAO PROVADO');
  assert.strictEqual(c.total, 0);
});

// ── o comando ────────────────────────────────────────────────────────────

test('experimento: o roteiro sai em JSON, com as linhas e como preenche-las', () => {
  const r = rodar([]);
  assert.strictEqual(r.status, 0, r.saida);
  const j = JSON.parse(r.stdout);
  assert.ok(j.linhas.length >= 55, 'o roteiro saiu com ' + j.linhas.length + ' linhas');
  assert.deepStrictEqual(j.mecanismos, ob.MECANISMOS);
  assert.ok(j.comoExecutar.join(' ').indexOf('NAO pode ser quem executou') !== -1,
    'o roteiro tem de dizer que o juiz nao e o executor - e a trava que a maquina nao consegue provar');
  assert.ok(j.comoExecutar.join(' ').indexOf('O manual antigo tem de estar FORA da sessao') !== -1,
    'o roteiro tem de dizer que o manual antigo fica fora da sessao');
  assert.strictEqual(j.segundoManual, null, 'sem --manual nao ha segundo manual');
  for (const l of j.linhas) assert.ok(/:\d+$/.test(l.fonte), 'linha sem arquivo:linha: ' + l.id);
});

// D244 (P2 da D240 secao 4): o `> roteiro.json` do Passo 7 gerou arquivo que nao era JSON,
// porque a prosa saia no stdout depois do objeto. O stdout e so o JSON; a prosa vai ao stderr.
test('D244/P2 prosa: o stdout do roteiro e JSON puro, e a prosa sai no stderr', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: RAIZ, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotThrow(() => JSON.parse(r.stdout), 'stdout nao e JSON: ' + r.stdout.slice(-200));
  assert.match(r.stderr, /Grave o resultado/);
});

test('experimento: --manual cruza, e marca o que so existe do outro lado', () => {
  const outro = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn outro '));
  fs.writeFileSync(path.join(outro, 'SKILL.md'),
    '# m\n\n## R\n\nSempre:\n\n- **Par atomico de deploy** nunca sai um lado sem o outro\n', 'utf8');
  const r = rodar(['--manual', outro]);
  assert.strictEqual(r.status, 0, r.saida);
  const j = JSON.parse(r.stdout);
  assert.strictEqual(j.segundoManual.obrigacoes, 1);
  const perdidas = j.linhas.filter((l) => l.naoMigrada);
  assert.strictEqual(perdidas.length, 1);
  assert.ok(/Par atomico/.test(perdidas[0].titulo));
  assert.deepStrictEqual(j.segundoManual.arquivos, ['SKILL.md']);
  assert.strictEqual(perdidas[0].aConferir, true);
  assert.deepStrictEqual(j.cruzamento, { comuns: 0, soNoPlugin: j.manualDoPlugin.obrigacoes, soNoOutro: 1 });
  const arq = path.join(outro, 'r.json');
  fs.writeFileSync(arq, JSON.stringify({ tarefa: { descricao: 't', referencia: 'abc1234' }, executor: 'A',
    juiz: 'B', semManualAntigo: true, linhas: j.linhas.map((l) => (l.naoMigrada ? { id: l.id, mecanismo: 'NADA' }
      : { id: l.id, mecanismo: 'HOOK', evidencia: 'portao' })) }), 'utf8');
  const v = rodar(['--manual', outro, '--veredito', '--resultado', arq]);
  assert.strictEqual(v.status, 1, v.saida);
  assert.ok(v.saida.indexOf('so no segundo 1)') !== -1 && v.saida.indexOf('[NADA] ' + perdidas[0].id) !== -1, v.saida);
  fs.rmSync(outro, { recursive: true, force: true });
});

test('experimento: --manual para lugar sem SKILL.md para e diz onde olhou', () => {
  const vazio = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn vazio '));
  const r = rodar(['--manual', vazio]);
  assert.strictEqual(r.status, 1);
  assert.ok(/nao ha SKILL.md/.test(r.saida), r.saida);
  fs.rmSync(vazio, { recursive: true, force: true });
});

// Pedido 12 (A3): o SKILL.md que existe e nao se le nao e "nao ha SKILL.md" - a saida diz a causa.
test('experimento: --manual com SKILL.md que nao se le para e diz a causa', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn ilegivel '));
  fs.mkdirSync(path.join(dir, 'SKILL.md'));
  const r = rodar(['--manual', dir]);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.strictEqual(r.status, 1);
  assert.ok(/nao consegui ler SKILL\.md \(e uma pasta \(EISDIR\)\)/.test(r.saida), r.saida);
  assert.ok(!/nao ha SKILL.md/.test(r.saida), r.saida);
});

test('experimento: --veredito devolve 0 no BASTA, 1 no NAO BASTA e 2 no INVALIDO', () => {
  const dir = pasta();
  const arq = path.join(dir, 'r.json');
  const inv = JSON.parse(rodar([]).stdout);
  const tres = inv.linhas.slice(0, 3).map((l) => l.id);

  const base = (mec) => ({
    tarefa: { descricao: 'tarefa real', referencia: 'abc1234' },
    executor: 'A', juiz: 'B', semManualAntigo: true,
    linhas: inv.linhas.map((l) => ({ id: l.id, mecanismo: mec,
      evidencia: mec === 'NADA' ? '' : 'portao ' + l.id }))
  });

  fs.writeFileSync(arq, JSON.stringify(base('HOOK')), 'utf8');
  let r = rodar(['--veredito', '--resultado', arq]);
  assert.strictEqual(r.status, 0, r.saida);
  assert.ok(/BASTA/.test(r.saida));
  const velha = base('HOOK');
  velha.linhas.push({ id: 'lente-99', mecanismo: 'HOOK', evidencia: 'de outra versao' });
  fs.writeFileSync(arq, JSON.stringify(velha), 'utf8');
  r = rodar(['--veredito', '--resultado', arq]);
  assert.ok(r.status === 0 && r.saida.indexOf('ignoradas: lente-99') !== -1, r.saida);

  const misto = base('HOOK');
  for (const id of tres) {
    misto.linhas.find((x) => x.id === id).mecanismo = 'NADA';
    misto.linhas.find((x) => x.id === id).evidencia = '';
  }
  fs.writeFileSync(arq, JSON.stringify(misto), 'utf8');
  r = rodar(['--veredito', '--resultado', arq]);
  assert.strictEqual(r.status, 1, r.saida);
  assert.ok(/NAO BASTA/.test(r.saida) && /\[NADA\]/.test(r.saida), r.saida);

  fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(dir, PROVA), JSON.stringify(misto), 'utf8');
  r = rodar(['--veredito'], dir);
  assert.ok(r.status === 1 && r.saida.indexOf('resultado lido de: ' + PROVA) !== -1, r.saida);

  const ruim = base('HOOK');
  ruim.juiz = 'A';
  fs.writeFileSync(arq, JSON.stringify(ruim), 'utf8');
  r = rodar(['--veredito', '--resultado', arq]);
  assert.strictEqual(r.status, 2, r.saida);
  assert.ok(/INVALIDO/.test(r.saida), r.saida);

  r = rodar(['--veredito', '--resultado', path.join(dir, 'nao-existe.json')]);
  assert.ok(r.status === 1 && /NAO PROVADO/.test(r.saida), 'sem resultado nao sai 0: ' + r.saida);
  const meia = base('HOOK');
  meia.linhas.pop();
  fs.writeFileSync(arq, JSON.stringify(meia), 'utf8');
  r = rodar(['--veredito', '--resultado', arq]);
  assert.ok(r.status === 1 && /INCONCLUSIVO/.test(r.saida), 'inconclusivo nao sai 0: ' + r.saida);

  fs.rmSync(dir, { recursive: true, force: true });
});

// A6 (s220, borda/estados :51): flag que pede valor e nao tem (a ultima, vazia ou seguida de outra flag) e erro de uso
// que diz qual e o que ela espera; antes `--manual --veredito` lia o manual de uma pasta chamada "--veredito".
test('A6: --manual e --resultado sem valor sao erro de uso que diz qual flag e o que ela espera', () => {
  for (const [args, flag] of [[['--manual'], '--manual'], [['--manual', '--veredito'], '--manual'],
    [['--manual', ''], '--manual'], [['--manual', '--resultado', 'r.json'], '--manual'],
    [['--veredito', '--resultado'], '--resultado'],
    [['--veredito', '--resultado', '--roteiro'], '--resultado']]) {
    const r = rodar(args);
    assert.strictEqual(r.status, 1, args.join(' ') + ': ' + r.saida);
    assert.ok(r.saida.startsWith('ERRO: ' + flag + ' pede um valor ('), args.join(' ') + ': ' + r.saida);
  }
});

// A6 (s220, borda/estados/manutencao/microcopy :79): so o arquivo ausente e "(nenhum)". JSON quebrado e erro de leitura
// saem ERRO com a causa e o passo, exit 2, sem caminho de maquina; o BOM que o Bloco de Notas poe se le.
test('A6: resultado que nao se le sai ERRO com a causa, exit 2; com BOM se le', () => {
  const dir = pasta();
  const arq = path.join(dir, 'r.json');
  try {
    fs.writeFileSync(arq, '{quebrado', 'utf8');
    let r = rodar(['--veredito', '--resultado', arq]);
    assert.strictEqual(r.status, 2, r.saida);
    assert.ok(r.saida.startsWith('ERRO: o resultado r.json nao se le (o texto nao e JSON valido; o Node diz: "'),
      r.saida);
    assert.match(r.saida, /formatoDoResultado do --roteiro/, r.saida);
    assert.ok(!r.saida.includes('(nenhum)') && !r.saida.includes(dir), r.saida);
    const pastaNoLugar = path.join(dir, 'p.json');
    fs.mkdirSync(pastaNoLugar);
    r = rodar(['--veredito', '--resultado', pastaNoLugar]);
    assert.strictEqual(r.status, 2, r.saida);
    assert.ok(r.saida.startsWith('ERRO: o resultado p.json nao se le (e uma pasta (EISDIR))'), r.saida);
    fs.writeFileSync(arq, '﻿' + JSON.stringify(resultado()), 'utf8');
    r = rodar(['--veredito', '--resultado', arq]);
    assert.match(r.saida, /resultado lido de: r\.json/, r.saida);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A6-10 (D735): o roteiro diz em palavras comuns o nivel da tarefa e o que e portao, sem "marcha" nem "O ACHADO".
test('A6-10: o comoExecutar fala sem jargao interno', () => {
  const t = JSON.parse(rodar([]).stdout).comoExecutar.join(' ');
  assert.ok(!/marcha|O ACHADO/.test(t), t);
  assert.match(t, /rigor maximo do playbook: tela que o usuario ve/, t);
  assert.match(t, /HOOK +uma checagem automatica do plugin \(portao\) barrou ou exigiu/, t);
  assert.match(t, /<<< e isto que o experimento procura/, t);
});

// A6 (s220, microcopy :62 e :69): as duas recusas do manual dizem o passo.
test('A6: sem o manual do plugin a recusa manda reinstalar; --manual errado diz para onde apontar', () => {
  const dir = pasta();
  try {
    fs.cpSync(path.join(RAIZ, 'scripts'), path.join(dir, 'scripts'), { recursive: true });
    const r0 = spawnSync(process.execPath, [path.join(dir, 'scripts', 'experimento.js')], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(r0.status, 1, r0.stdout + r0.stderr);
    assert.match(r0.stdout, /instalacao esta incompleta: reinstale o plugin e rode de novo\./, r0.stdout);
    const r = rodar(['--manual', dir]);
    assert.strictEqual(r.status, 1, r.saida);
    assert.match(r.saida, /Aponte --manual para a pasta com os SKILL\.md do manual antigo\./, r.saida);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('experimento: o comando nao imprime caminho de maquina - a saida e para colar', () => {
  // Com resultado LIDO: e so quando ha arquivo que o caminho entra na saida.
  // Arquivo inexistente e primeira linha so provavam o caso que nunca vaza.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn saida '));
  const arq = path.join(dir, 'resultado.json');
  fs.writeFileSync(arq, '{}', 'utf8');
  const r = rodar(['--veredito', '--resultado', arq]);
  for (const linha of r.saida.split('\n')) {
    assert.ok(linha.indexOf(dir) === -1 && !/[A-Za-z]:[\\/]/.test(linha),
      'caminho de maquina na saida: ' + linha);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------------- *
 * A ASSERCAO SOBRE ESTE AMBIENTE. Aqui ela sempre pula: este e o repositorio
 * do PLUGIN, e o plugin nao guarda o experimento de ninguem. Onde ele estiver
 * instalado e alguem tiver rodado, ela roda de verdade.
 * ------------------------------------------------------------------------- */

test('experimento: o experimento gravado neste ambiente nao e invalido (D83)', (t) => {
  let gravado = null;
  try { gravado = JSON.parse(fs.readFileSync(path.join(RAIZ, PROVA), 'utf8')); } catch (e) { gravado = null; }
  if (!gravado) {
    t.skip('nao verificavel aqui: ninguem rodou o experimento neste ambiente (' + PROVA.split(path.sep).join('/') + ')');
    return;
  }
  const linhas = ob.linhasDoExperimento(ob.cruzar(ob.inventario(path.join(RAIZ, 'skills', 'playbook')), null));
  const c = ob.conferirResultado(linhas, gravado);
  assert.notStrictEqual(c.veredito, 'INVALIDO', ob.motivo(c));
});
