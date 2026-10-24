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
  assert.ok(/afrouxando/i.test(m), 'tem de dizer que nao se conserta afrouxando: ' + m);
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
  try { prova = JSON.parse(fs.readFileSync(path.join(RAIZ, PROVA), 'utf8')); } catch (e) { prova = null; }

  const c = apelidos.cobertura(projeto, prova, apelidos.agentesDoPlugin());

  if (c.apelidos.length === 0) {
    t.skip('nao verificavel aqui: nem este ambiente nem os agentes do plugin declaram apelido');
    return;
  }
  if (!c.temProva) {
    t.skip('nao verificavel aqui: ainda nao se sondou. Rode scripts/provar-apelidos.js' +
      (projeto ? '' : ' --plugin') + ' e grave ' + PROVA.split(path.sep).join('/'));
    return;
  }
  assert.strictEqual(c.reprovados.length + c.camposReprovados.length, 0, apelidos.motivoReprovado(c));
});
