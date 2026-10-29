'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const apelidos = require('../scripts/lib/apelidos.js');
const config = require('../scripts/lib/config.js');

const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'provar-apelidos.js');
const PROVA = path.join('.claude', 'sworn', 'apelidos-vivos.json');

const MAPA = { agentes: {
  escada: ['busca', 'arquiteto'],
  degraus: [{ agente: 'busca', apelido: 'barato' }, { agente: 'arquiteto', apelido: 'caro' }]
} };

function pasta() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sworn vivos-')); }

test('apelidos vivos: sem sondagem, tudo fica NAO PROVADO - e isso nao reprova', () => {
  const c = apelidos.cobertura(MAPA, null);
  assert.strictEqual(c.temProva, false);
  assert.deepStrictEqual(c.naoProvados, ['barato', 'caro']);
  assert.deepStrictEqual(c.reprovados, [], 'nao sondar nunca pode reprovar');
});

test('apelidos vivos: sondagem inteira e aceita zera os dois baldes', () => {
  const c = apelidos.cobertura(MAPA, {
    apelidos: [{ apelido: 'barato', aceito: true }, { apelido: 'caro', aceito: true }],
    campos: [{ campo: 'model', aceito: true }]
  });
  assert.strictEqual(c.temProva, true);
  assert.deepStrictEqual(c.provados, ['barato', 'caro']);
  assert.deepStrictEqual(c.naoProvados, []);
  assert.deepStrictEqual(c.reprovados, []);
});

test('apelidos vivos: apelido sondado e RECUSADO cai no balde que reprova', () => {
  const c = apelidos.cobertura(MAPA, {
    apelidos: [{ apelido: 'barato', aceito: false, evidencia: 'modelo desconhecido' },
               { apelido: 'caro', aceito: true }]
  });
  assert.strictEqual(c.reprovados.length, 1);
  assert.strictEqual(c.reprovados[0].apelido, 'barato');
  assert.ok(c.reprovados[0].evidencia.includes('desconhecido'));
});

// A distincao em que o H4 se fecha: "ninguem sondou" nao e "morreu".
test('apelidos vivos: apelido NOVO no mapa fica nao provado, nao reprovado', () => {
  const mapaMaior = { agentes: { escada: ['busca', 'arquiteto', 'novo'], degraus:
    MAPA.agentes.degraus.concat([{ agente: 'novo', apelido: 'recem-chegado' }]) } };
  const c = apelidos.cobertura(mapaMaior, {
    apelidos: [{ apelido: 'barato', aceito: true }, { apelido: 'caro', aceito: true }]
  });
  assert.deepStrictEqual(c.naoProvados, ['recem-chegado']);
  assert.deepStrictEqual(c.reprovados, [], 'apelido nunca sondado nao pode reprovar a suite');
});

// Nao ha carimbo de validade: a sondagem se compara com o MAPA, nao com a data.
test('apelidos vivos: sondagem de um apelido que saiu do mapa e simplesmente ignorada', () => {
  const c = apelidos.cobertura(MAPA, {
    apelidos: [{ apelido: 'barato', aceito: true }, { apelido: 'caro', aceito: true },
               { apelido: 'aposentado', aceito: false, evidencia: 'nem existe mais' }]
  });
  assert.deepStrictEqual(c.reprovados, [], 'apelido fora do mapa nao e problema deste projeto');
  assert.deepStrictEqual(c.provados, ['barato', 'caro']);
});

test('apelidos vivos: campo de frontmatter recusado tambem reprova', () => {
  const c = apelidos.cobertura(MAPA, {
    apelidos: [{ apelido: 'barato', aceito: true }, { apelido: 'caro', aceito: true }],
    campos: [{ campo: 'model', aceito: true }, { campo: 'effort', aceito: false, evidencia: 'ignorado' }]
  });
  assert.strictEqual(c.camposReprovados.length, 1);
  assert.strictEqual(c.camposReprovados[0].campo, 'effort');
});

test('apelidos vivos: o motivo nomeia o que morreu e proibe afrouxar o teste', () => {
  const c = apelidos.cobertura(MAPA, {
    apelidos: [{ apelido: 'barato', aceito: false, evidencia: 'recusado' }, { apelido: 'caro', aceito: true }],
    campos: [{ campo: 'effort', aceito: false }]
  });
  const m = apelidos.motivoReprovado(c);
  assert.ok(m.includes('barato'), m);
  assert.ok(m.includes('effort'), m);
  assert.ok(/afrouxar o teste so esconderia a falha/i.test(m), 'tem de dizer que afrouxar nao conserta: ' + m);
});

// A1-39/A1-49/A1-50: a 1a linha diz o que deixou de valer, o fim diz o comando, e nada de jargao nem bronca.
test('A1-39: o motivo diz o que deixou de valer e o comando, sem jargao nem bronca', () => {
  const c = apelidos.cobertura(MAPA, { apelidos: [{ apelido: 'barato', aceito: false, evidencia: 'recusado' }] });
  const m = apelidos.motivoReprovado(c);
  assert.ok(/^apelido ou campo que a ferramenta nao aceita mais/.test(m), m);
  assert.ok(!/sondagem|supos|NAO se conserta|entrevista/.test(m), m);
  assert.ok(m.includes('node scripts/provar-apelidos.js'), m);
});

// A1-51: a prova fora da forma diz o comando que a regrava, e nao o nome de um campo interno.
test('A1-51: a prova torta diz o comando que a regrava', () => {
  for (const prova of [{}, { apelidos: [1] }]) {
    const t = apelidos.cobertura(MAPA, prova).provaInvalida;
    assert.ok(t.includes('node scripts/provar-apelidos.js') && !/formatoDoResultado/.test(t), t);
  }
});

test('apelidos vivos: sondagem malformada nao vira prova nem estoura', () => {
  for (const lixo of [undefined, null, 42, 'texto', {}, { apelidos: 'nao e lista' }]) {
    const c = apelidos.cobertura(MAPA, lixo);
    assert.strictEqual(c.temProva, false, JSON.stringify(lixo));
    assert.deepStrictEqual(c.reprovados, []);
  }
});

// Decisao 29: o `inspector` guarda um apelido DENTRO do plugin. Ele entra na
// mesma conta que os apelidos do projeto - e sem repetir.
test('apelidos vivos: o apelido que o PLUGIN declara entra na conta, sem repetir (decisao 29)', () => {
  const c = apelidos.cobertura(MAPA, null,
    [{ agente: 'x', apelido: 'caro' }, { agente: 'y', apelido: 'do-plugin' }]);
  assert.deepStrictEqual(c.apelidos, ['barato', 'caro', 'do-plugin']);
  assert.deepStrictEqual(c.naoProvados, ['barato', 'caro', 'do-plugin']);
});

// No repositorio do plugin nao ha projeto.json - e mesmo assim ha o que sondar.
test('apelidos vivos: sem projeto, o apelido do plugin sondado e RECUSADO reprova', () => {
  const doPlugin = [{ agente: 'inspetor', apelido: 'do-plugin' }];
  assert.deepStrictEqual(apelidos.cobertura(null, null, doPlugin).naoProvados, ['do-plugin']);
  const c = apelidos.cobertura(null, {
    apelidos: [{ apelido: 'do-plugin', aceito: false, evidencia: 'recusado' }]
  }, doPlugin);
  assert.strictEqual(c.reprovados.length, 1);
  assert.strictEqual(c.reprovados[0].apelido, 'do-plugin');
});

// Metodo em vez de resultado: a pasta agents/ do plugin e lida de verdade, e o
// que volta se confere contra o texto de cada arquivo, nao contra uma lista.
test('apelidos vivos: agentesDoPlugin le o que cada agents/*.md do plugin declara', () => {
  const lidos = apelidos.agentesDoPlugin();
  const noDisco = fs.readdirSync(path.join(RAIZ, 'agents')).filter((n) => n.endsWith('.md')).sort();
  assert.deepStrictEqual(lidos.map((a) => a.arquivo), noDisco, 'todo agents/*.md do plugin entra');
  for (const a of lidos) {
    const linhas = fs.readFileSync(path.join(RAIZ, 'agents', a.arquivo), 'utf8').split(/\r?\n/);
    if (a.apelido !== '') {
      assert.ok(linhas.indexOf('model: ' + a.apelido) !== -1, a.arquivo + ': o apelido e o que o arquivo diz');
    }
    for (const campo of a.campos) {
      assert.ok(linhas.some((l) => l.startsWith(campo + ':')), a.arquivo + ': campo ' + campo);
    }
  }
});

test('apelidos vivos: agentesDoPlugin - sem model: nao vira apelido, sem frontmatter fica de fora', () => {
  const dir = pasta();
  fs.writeFileSync(path.join(dir, 'a.md'), '---\nname: a\nmodel: do-plugin\neffort: medio\n---\ncorpo\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'b.md'), '---\nname: b\n---\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'c.md'), 'sem frontmatter\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'd.txt'), '---\nmodel: nao-e-agente\n---\n', 'utf8');
  assert.deepStrictEqual(apelidos.agentesDoPlugin(dir), [
    { agente: 'a', arquivo: 'a.md', apelido: 'do-plugin', campos: ['name', 'model', 'effort'] },
    { agente: 'b', arquivo: 'b.md', apelido: '', campos: ['name'] }
  ]);
  assert.deepStrictEqual(apelidos.agentesDoPlugin(path.join(dir, 'nao-existe')), [],
    'sem pasta de agentes nao ha o que sondar - e isso nao estoura');
  fs.rmSync(dir, { recursive: true, force: true });
});

function semear(dir, mapa) {
  fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'),
    JSON.stringify(Object.assign({ versaoConfig: 1 }, mapa), null, 2), 'utf8');
  return dir;
}

function rodar(dir, args) {
  const r = spawnSync(process.execPath, [SCRIPT].concat(args || []), { cwd: dir, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('apelidos vivos: o roteiro lista os apelidos do projeto, sem repetir', () => {
  const dir = semear(pasta(), { agentes: { escada: ['a', 'b', 'c'], degraus: [
    { agente: 'a', apelido: 'barato' }, { agente: 'b', apelido: 'barato' },
    { agente: 'c', apelido: 'caro' }
  ] } });
  const r = rodar(dir);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const j = JSON.parse(r.stdout.slice(0, r.stdout.indexOf('}\n\n') + 2));
  assert.deepStrictEqual(j.apelidos, ['barato', 'caro'], 'apelido repetido tem de sondar uma vez so');
  fs.rmSync(dir, { recursive: true, force: true });
});

// Metodo em vez de resultado: os campos saem do molde, nao de lista fixa.
test('apelidos vivos: os campos do roteiro saem do frontmatter do MOLDE', () => {
  const dir = semear(pasta(), MAPA);
  const r = rodar(dir);
  const j = JSON.parse(r.stdout.slice(0, r.stdout.indexOf('}\n\n') + 2));
  const molde = fs.readFileSync(path.join(RAIZ, 'modelos', 'agente.md'), 'utf8');
  const doMolde = Object.keys(require('../scripts/lib/agentes.js').frontmatter(molde).campos);
  assert.deepStrictEqual(j.campos, doMolde, 'o roteiro tem de seguir o molde, nao uma lista fixa');
  assert.ok(j.campos.indexOf('model') !== -1, 'o campo que importa tem de estar la');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('apelidos vivos: projeto sem apelidos se DECLARA nao verificavel, nao sonda nada', () => {
  const dir = semear(pasta(), { agentes: { escada: [] } });
  const r = rodar(dir);
  assert.strictEqual(r.status, 1);
  assert.ok(/NAO VERIFICAVEL/.test(r.stdout), r.stdout);
  // A1-34 (pedido 12, microcopy): "a entrevista pergunta" era vago; agora diz o comando e a resposta que falta
  assert.ok(/Rode \/sworn:init e, na pergunta dos agentes, de o apelido/.test(r.stdout), 'A1-34: ' + r.stdout);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('apelidos vivos: projeto sem projeto.json manda rodar o init', () => {
  const dir = pasta();
  const r = rodar(dir);
  assert.strictEqual(r.status, 1);
  assert.ok(/init/.test(r.stdout), r.stdout);
  fs.rmSync(dir, { recursive: true, force: true });
});

// Decisao 29: o roteiro traz tambem os agentes do PROPRIO plugin, com o que
// cada um declara - e os apelidos do projeto continuam separados deles.
test('apelidos vivos: o roteiro traz os agentes do proprio plugin, com os campos que declaram', () => {
  const dir = semear(pasta(), MAPA);
  const r = rodar(dir);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const j = JSON.parse(r.stdout.slice(0, r.stdout.indexOf('}\n\n') + 2));
  assert.deepStrictEqual(j.doPlugin, apelidos.agentesDoPlugin());
  assert.deepStrictEqual(j.apelidos, ['barato', 'caro'], 'os do projeto seguem separados dos do plugin');
  fs.rmSync(dir, { recursive: true, force: true });
});

// No repositorio do plugin nao ha projeto.json, e ha o que sondar: --plugin.
test('apelidos vivos: --plugin monta o roteiro so do plugin, sem pedir projeto.json', () => {
  const dir = pasta();
  const r = rodar(dir, ['--plugin']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const j = JSON.parse(r.stdout.slice(0, r.stdout.indexOf('}\n\n') + 2));
  assert.deepStrictEqual(j.apelidos, [], 'sem projeto nao ha apelido de projeto');
  assert.deepStrictEqual(j.doPlugin, apelidos.agentesDoPlugin());
  fs.rmSync(dir, { recursive: true, force: true });
});

// A1-prova-1 (pedido 12, estados): a leitura do molde nao tinha try - molde que faltava saia como pilha de excecao.
test('A1-prova-1: molde ilegivel para com ERRO e a causa, sem pilha de excecao', () => {
  const dir = semear(pasta(), MAPA);
  const ganchos = pasta();
  const gancho = path.join(ganchos, 'gancho.js');
  fs.writeFileSync(gancho, [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const orig = fs.readFileSync;',
    'fs.readFileSync = function (p) {',
    "  if (String(p).endsWith(path.join('modelos', 'agente.md'))) {",
    "    throw Object.assign(new Error('ENOENT: no such file or directory, open ' + p), { code: 'ENOENT' });",
    '  }',
    '  return orig.apply(this, arguments);',
    '};'
  ].join('\n'), 'utf8');
  const r = spawnSync(process.execPath, ['--require', gancho, SCRIPT], { cwd: dir, encoding: 'utf8' });
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(/^ERRO: nao consegui ler o molde .*agente\.md: ENOENT/.test(r.stdout), r.stdout);
  assert.ok(/reinstale o plugin/.test(r.stdout), 'o erro tem de dizer o passo seguinte: ' + r.stdout);
  assert.strictEqual(r.stderr, '', 'a falha saiu como excecao: ' + r.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(ganchos, { recursive: true, force: true });
});

// A1-prova-2 (pedido 12, microcopy): "reprova a suite" so vale no repositorio do plugin - no projeto quem le a prova
// e o relatorio de cobertura -, e "o caminho acima" nao nomeava o campo. O fim nomeia ondeGravar e o comando seguinte.
test('A1-prova-2: o fim do roteiro nomeia onde gravar e o comando seguinte, no projeto e no plugin', () => {
  const dir = semear(pasta(), MAPA);
  const corte = (s) => s.indexOf('}\n\n') + 2;
  const r = rodar(dir);
  const j = JSON.parse(r.stdout.slice(0, corte(r.stdout)));
  const fim = r.stdout.slice(corte(r.stdout));
  const grave = 'Grave o resultado, no formato de formatoDoResultado, em ondeGravar:\n  ' + j.ondeGravar + '\n';
  assert.ok(fim.includes(grave), fim);
  // A1-32: o caminho e o que o relatorio de cobertura le (lib/cobertura.js, prova)
  assert.ok(j.ondeGravar.endsWith(path.join('.claude', 'sworn', 'apelidos-vivos.json')), j.ondeGravar);
  assert.ok(fim.includes('Depois confira com: node "' + path.join(RAIZ, 'scripts', 'cobertura.js') + '"\n'), fim);
  assert.ok(!/reprova|suite|acima/.test(fim), 'no projeto a suite do plugin nao le a prova: ' + fim);
  // A1-36 (pedido 12, microcopy): "a linha do H4" era codigo interno; a linha se nomeia pelo rotulo inteiro,
  // como o relatorio o imprime (a R2 da s201: so o pedaco depois do "H4" nao era o que a tela mostra)
  assert.ok(fim.includes('na linha "H4 - o apelido ainda e aceito"') && !/linha do H4/.test(fim), 'A1-36: ' + fim);
  assert.ok(fs.readFileSync(path.join(RAIZ, 'scripts', 'lib', 'cobertura.js'), 'utf8')
    .includes("'H4 - o apelido ainda e aceito'"), 'o relatorio de cobertura mudou o nome da linha');

  const p = rodar(dir, ['--plugin']);
  const fimP = p.stdout.slice(corte(p.stdout));
  assert.ok(fimP.includes(grave), fimP);
  const teste = path.join(RAIZ, 'test', 'apelidos-vivos.test.js');
  assert.ok(fimP.includes('Depois rode: node --test "' + teste + '"\n'), fimP);
  assert.ok(/RECUSADO reprova esse teste; apelido que ninguem testou nao reprova\./.test(fimP), fimP);
  fs.rmSync(dir, { recursive: true, force: true });
});

// A1-ape-3 (pedido 12, estados): prova que existe sem a forma (`apelidos` que nao e lista) caia em "sem prova", e o
// teste do H4 pulava calado. Agora a cobertura nomeia em provaInvalida; ausente segue sendo so "sem prova".
test('A1-ape-3: prova malformada nao se confunde com prova ausente', () => {
  for (const prova of [{}, { apelidos: 'barato' }, { apelidos: null }, [], 'texto', 7, false]) {
    const c = apelidos.cobertura(MAPA, prova);
    assert.strictEqual(c.temProva, false, JSON.stringify(prova));
    assert.ok(typeof c.provaInvalida === 'string' && /`apelidos`/.test(c.provaInvalida),
      JSON.stringify(prova) + ': ' + c.provaInvalida);
    assert.deepStrictEqual(c.naoProvados, ['barato', 'caro']);
  }
  for (const ausente of [null, undefined]) {
    assert.strictEqual(apelidos.cobertura(MAPA, ausente).provaInvalida, null, 'ausente nao e invalida');
  }
  assert.strictEqual(apelidos.cobertura(MAPA, { apelidos: [] }).provaInvalida, null);
});

// A1-ape-4 (pedido 12, R2 estados): item da lista fora da forma (nao objeto, ou sem o nome em texto) sumia calado, e
// o apelido virava "nao provado", que o teste do H4 nao reprova. Agora o item torto invalida a prova inteira.
test('A1-ape-4: item fora da forma na prova nao some calado', () => {
  const bom = { apelido: 'caro', aceito: true };
  const tortos = ['barato', null, 7, true, [], { aceito: true }, { apelido: 7, aceito: true }, { apelido: '', aceito: true }];
  for (const item of tortos) {
    const c = apelidos.cobertura(MAPA, { apelidos: [bom, item] });
    assert.strictEqual(c.temProva, false, JSON.stringify(item));
    assert.ok(typeof c.provaInvalida === 'string' && /`apelidos`/.test(c.provaInvalida),
      JSON.stringify(item) + ': ' + c.provaInvalida);
    assert.deepStrictEqual(c.naoProvados, ['barato', 'caro']);
  }
  for (const campos of ['model', ['model'], [null], [{ aceito: true }], [{ campo: '', aceito: true }]]) {
    const c = apelidos.cobertura(MAPA, { apelidos: [bom], campos: campos });
    assert.strictEqual(c.temProva, false, JSON.stringify(campos));
    assert.ok(typeof c.provaInvalida === 'string' && /`campos`/.test(c.provaInvalida),
      JSON.stringify(campos) + ': ' + c.provaInvalida);
  }
  const semCampos = apelidos.cobertura(MAPA, { apelidos: [bom] });
  assert.strictEqual(semCampos.provaInvalida, null, 'prova sem a lista campos segue valida');
  assert.deepStrictEqual(semCampos.provados, ['caro']);
});

/* ------------------------------------------------------------------------- *
 * A ASSERCAO SOBRE ESTE AMBIENTE. E a unica que o skip cala.
 * Este repositorio e o do PLUGIN: nao tem .claude/ e nunca tera apelidos do
 * projeto, porque apelido nasce no projeto da pessoa (decisao 12). Mas o
 * plugin publica um apelido seu - o do `inspector`, decisao 29 - e aqui e
 * ele que se sonda. Onde o plugin estiver instalado, este teste roda de
 * verdade - e reprova alto.
 * ------------------------------------------------------------------------- */

test('apelidos vivos: nenhum apelido deste ambiente deixou de valer (H4)', (t) => {
  const projeto = config.carregarProjeto(RAIZ);
  let prova = null;
  let ilegivel = null;
  try { prova = JSON.parse(fs.readFileSync(path.join(RAIZ, PROVA), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') ilegivel = e.message; }

  const c = apelidos.cobertura(projeto, prova, apelidos.agentesDoPlugin());

  if (c.apelidos.length === 0) {
    t.skip('nao verificavel aqui: nem este ambiente nem os agentes do plugin declaram apelido');
    return;
  }
  // A1-ape-3: prova que existe e nao se le (JSON quebrado, ou sem a lista `apelidos`) reprova; so a ausente pula.
  assert.strictEqual(ilegivel, null, PROVA + ' existe e nao se le: ' + ilegivel);
  assert.strictEqual(c.provaInvalida, null, PROVA + ': ' + c.provaInvalida);
  if (!c.temProva) {
    t.skip('nao verificavel aqui: ainda nao se sondou. Rode scripts/provar-apelidos.js' +
      (projeto ? '' : ' --plugin') + ' e grave ' + PROVA.split(path.sep).join('/'));
    return;
  }
  assert.strictEqual(c.reprovados.length + c.camposReprovados.length, 0, apelidos.motivoReprovado(c));
});
