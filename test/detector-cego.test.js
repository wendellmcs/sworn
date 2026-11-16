'use strict';
// E3 item 3 (ordem cega): o detector de design roda no preparar, fica na ronda fora do que vai ao inspetor e o apurar o
// cruza com a lente ui-design so depois dos vereditos (scripts/lib/detector-cego.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const detectorCego = require('../scripts/lib/detector-cego.js');

const RAIZ = path.join(__dirname, '..');
const SISTEMA = { cores: ['#ff6600', '#ffffff'], raios: ['4px'], espacos: ['8px'] };

test('E3 item 3: montar acha o valor fora no lado do trabalho, desconta o que o HEAD ja tinha e leva a chave', () => {
  const head = '.a { color: #abcdef; }\n';
  const trabalho = '.a { color: #abcdef; }\n.b { color: #ff6600; }\n.c { color: #123456; }\n';
  const d = detectorCego.montar({ trabalho, head, sistema: SISTEMA, caminho: 'src/a.css', rotulo: 'B', estilo: null });
  assert.strictEqual(d.rotulo, 'B');
  assert.deepStrictEqual(d.fonte.fora.map((a) => [a.linha, a.valor]), [[3, '#123456']], 'o #abcdef do HEAD nao e da mudanca');
  assert.strictEqual(d.fonte.fora[0].chave, 'rgba(18,52,86,1)');
  assert.strictEqual(d.fonte.foraDoTeto, 0);
  assert.strictEqual(d.tela, null, 'sem foto, sem camada 2');
  // Arquivo novo (sem HEAD): tudo o que esta fora conta.
  const novo = detectorCego.montar({ trabalho, sistema: SISTEMA, caminho: 'src/a.css', rotulo: 'A' });
  assert.deepStrictEqual(novo.fonte.fora.map((a) => a.valor), ['#abcdef', '#123456']);
});

test('E3 item 3: montar leva a camada 2 com a chave da cor calculada, e o teto corta a lista', () => {
  const estilo = { valores: [{ propriedade: 'color', valor: 'rgb(18, 52, 86)', quantos: 3 },
    { propriedade: 'color', valor: 'rgb(255, 102, 0)', quantos: 1 },
    { propriedade: 'border-radius', valor: '7px', quantos: 2 }] };
  const d = detectorCego.montar({ trabalho: '', sistema: SISTEMA, caminho: 'src/a.css', rotulo: 'A', estilo });
  assert.strictEqual(d.tela.feita, true);
  assert.deepStrictEqual(d.tela.fora.map((t) => [t.propriedade, t.chave]),
    [['color', 'rgba(18,52,86,1)'], ['border-radius', '7px']]);
  assert.strictEqual(d.tela.conferidos, 3);
  assert.strictEqual(detectorCego.montar({ trabalho: '', sistema: SISTEMA, rotulo: 'A', estilo: { erro: 'x', valores: [] } })
    .tela.feita, false, 'a leitura do estilo que falhou nao conta como feita');
  // Uma cor diferente por linha, num texto de CSS (nao num array).
  const muitas = Array.from({ length: detectorCego.TETO + 5 }, (_, i) => '.c' + i + ' { color: #12' +
    String(i).padStart(4, '0') + '; }').join('\n');
  assert.strictEqual(typeof muitas, 'string');
  const cortado = detectorCego.montar({ trabalho: muitas, sistema: SISTEMA, rotulo: 'B' });
  assert.strictEqual(cortado.fonte.fora.length, detectorCego.TETO);
  assert.strictEqual(cortado.fonte.foraDoTeto, 5);
});

test('E3 item 3: montar tira da camada 2 o valor que a camada 1 ja achou, contado na lista inteira, antes do teto', () => {
  const estilo = { valores: [{ propriedade: 'color', valor: 'rgb(18, 52, 86)', quantos: 3 },
    { propriedade: 'border-radius', valor: '7px', quantos: 2 }] };
  const d = detectorCego.montar({ trabalho: '.a { color: #123456; }\n', sistema: SISTEMA, rotulo: 'A', estilo });
  assert.deepStrictEqual(d.tela.fora.map((t) => t.valor), ['7px'], 'a mesma cor vista na tela conta uma vez, na camada 1');
  assert.strictEqual(d.tela.tambemNoFonte, 1);
  // A cor que a camada 1 achou so depois do teto (fora do arquivo) tambem sai da camada 2.
  const linhas = Array.from({ length: detectorCego.TETO }, (_, i) => '.c' + i + ' { color: #00' +
    String(i).padStart(4, '0') + '; }');
  linhas.push('.z { color: #123456; }');
  const cheio = detectorCego.montar({ trabalho: linhas.join('\n'), sistema: SISTEMA, rotulo: 'A', estilo });
  assert.strictEqual(cheio.fonte.foraDoTeto, 1);
  assert.ok(!cheio.fonte.fora.some((a) => a.valor === '#123456'), 'a #123456 ficou fora do teto da camada 1');
  assert.deepStrictEqual(cheio.tela.fora.map((t) => t.valor), ['7px']);
  assert.strictEqual(cheio.tela.tambemNoFonte, 1);
});

test('E3 item 3: cruzar separa lente e detector, so detector e so lente', () => {
  const detector = { rotulo: 'B', fonte: { fora: [
    { linha: 10, valor: '#123456', tipo: 'cor', chave: 'rgba(18,52,86,1)' },
    { linha: 40, valor: '#abcdef', tipo: 'cor', chave: 'rgba(171,205,239,1)' }], foraDoTeto: 1 },
  tela: { feita: true, fora: [
    { propriedade: 'border-radius', valor: '7px', tipo: 'medida', chave: '7px' }], foraDoTeto: 2 } };
  const vereditos = [
    { lente: ' UI-Design ', achados: [
      { arquivo: 'B.txt', linha: '12-14', severidade: 'P1', descricao: 'cor crua' },  // 2 linhas da 10: casa
      { arquivo: 'B.txt', linha: 80, severidade: 'P2', descricao: 'card dentro de card' },
      { arquivo: 'A.txt', linha: 40, severidade: 'P1', descricao: 'lado antigo' },     // outro arquivo: fora
      { arquivo: 'b.txt ', linha: 41, severidade: 'P2', descricao: 'caixa e espaco' },   // o mesmo B.txt: casa
      { arquivo: 'B.txt', linha: 'sem numero', severidade: 'P1', descricao: 'x' }] },  // sem linha: so lente
    { lente: 'correcao', achados: [{ arquivo: 'B.txt', linha: 40, severidade: 'P1', descricao: 'outra lente' }] },
    null];
  const c = detectorCego.cruzar(detector, vereditos);
  assert.deepStrictEqual(c.lenteEDetector.map((x) => [x.camada, x.linha, x.linhasDaLente]),
    [['fonte', 10, [12]], ['fonte', 40, [41]]]);
  assert.deepStrictEqual(c.soDetector.map((x) => [x.camada, x.valor]), [['tela', '7px']], 'a outra lente nao casa');
  assert.deepStrictEqual(c.soLente.map((x) => [x.linha, x.descricao]), [[80, 'card dentro de card'], [null, 'x']],
    'o achado sem linha que se leia nao some');
  assert.strictEqual(c.foraDoTeto, 3);
  assert.strictEqual(c.telaFeita, true);
  // Uma linha alem do PERTO ja nao casa.
  const longe = detectorCego.cruzar(detector, [{ lente: 'ui-design',
    achados: [{ arquivo: 'B.txt', linha: 10 + detectorCego.PERTO + 1, severidade: 'P1' }] }]);
  assert.strictEqual(longe.lenteEDetector.length, 0);
  assert.strictEqual(longe.soLente.length, 1);
  // Detector sem camadas e vereditos ausentes: listas vazias, sem lancar.
  assert.deepStrictEqual(detectorCego.cruzar({ rotulo: 'A' }, undefined),
    { rotulo: 'A', lenteEDetector: [], soDetector: [], soLente: [], foraDoTeto: 0, telaFeita: null });
});

function apurar(cwd, tmp) {
  const env = Object.assign({}, process.env, { SWORN_TMP: tmp });
  delete env.CLAUDE_CODE_SESSION_ID;
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'apurar-ronda.js'), '--sessao', 'detector'],
    { cwd, encoding: 'utf8', env, timeout: 60000 });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (e) { json = null; } // o ERRO sai em texto: o chamador confere
  return { status: r.status, stdout: r.stdout + r.stderr, json };
}

test('E3 item 3: pelo CLI, o apurar cruza o detector da ultima ronda e o fecho diz o que so o detector viu', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-detector-tmp-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-detector-'));
  try {
    const ronda = (n, achados) => {
      const dir = path.join(cwd, '.claude', 'sworn', 'revisao', String(n));
      fs.mkdirSync(path.join(dir, 'vereditos'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'mapa.json'), JSON.stringify({ arquivo: 'src/a.css', mapa: { A: 'HEAD', B: 'trabalho' } }));
      fs.writeFileSync(path.join(dir, 'vereditos', 'ui-design.json'), JSON.stringify({ lente: 'ui-design', melhor: 'B', achados }));
      return dir;
    };
    ronda(1, []);
    const d2 = ronda(2, [{ estado: 'confirmado', tipo: 'melhoria', trecho: 'x', severidade: 'P2', arquivo: 'B.txt', linha: 5,
      descricao: 'melhoria' }]);
    // So a ultima ronda tem detector: o cruzamento e o dela.
    fs.writeFileSync(path.join(d2, 'detector.json'), JSON.stringify({ rotulo: 'B',
      fonte: { fora: [{ linha: 5, valor: '#123456', tipo: 'cor' }, { linha: 30, valor: '#abcdef', tipo: 'cor' }], foraDoTeto: 0 },
      tela: null }));
    const r = apurar(cwd, tmp);
    assert.strictEqual(r.status, 0, r.stdout);
    assert.ok(r.json, r.stdout);
    assert.strictEqual(r.json.encerrar, true, r.stdout);
    assert.deepStrictEqual(r.json.detector.lenteEDetector.map((x) => x.linha), [5]);
    assert.deepStrictEqual(r.json.detector.soDetector.map((x) => x.valor), ['#abcdef']);
    assert.match(r.json.motivo, /^duas rondas secas seguidas: aprovado/);
    assert.match(r.json.motivo, /o detector de design achou 1 valor\(es\) que a lente ui-design nao citou \(detector\.soDetector\)/);
    assert.match(r.json.motivo, /peca ao dono que declare um desvio para esta tela em "desvios" do \.claude\/sworn\/design\.json/);
    // Ilegivel: ERRO com o caminho e o que fazer, nunca o cruzamento calado.
    fs.writeFileSync(path.join(d2, 'detector.json'), '{ quebrado');
    const quebrado = apurar(cwd, tmp);
    assert.strictEqual(quebrado.status, 1, quebrado.stdout);
    assert.match(quebrado.stdout, /^ERRO: \.claude\/sworn\/revisao\/2\/detector\.json ilegivel \(.+\)\. Ele e gravado pelo preparar-revisao\.js/);
    fs.writeFileSync(path.join(d2, 'detector.json'), JSON.stringify({ rotulo: 'C' }));
    const forma = apurar(cwd, tmp);
    assert.strictEqual(forma.status, 1, forma.stdout);
    assert.match(forma.stdout, /nao tem o formato esperado \(um objeto com "rotulo" A ou B\)/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('E3 item 3: pelo CLI, o preparar grava o detector.json do arquivo de estilo, cego para o inspetor', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-detector-preparar-'));
  try {
    const g = (args) => {
      const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', shell: false, timeout: 30000 });
      assert.strictEqual(r.status, 0, 'git ' + args.join(' ') + ': ' + (r.error ? r.error.message : r.stdout + r.stderr));
    };
    g(['init', '-q', '.']); g(['config', 'user.email', 'ensaio@ensaio']); g(['config', 'user.name', 'ensaio']);
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify({ versaoConfig: 1 }));
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'design.json'), JSON.stringify(SISTEMA));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'a.css'), '.a { color: #abcdef; }\n');
    fs.writeFileSync(path.join(dir, 'src', 'b.js'), 'module.exports = 1;\n');
    g(['add', '-A']); g(['commit', '-qm', 'base']);
    fs.writeFileSync(path.join(dir, 'src', 'a.css'), '.a { color: #abcdef; }\n.b { color: #123456; }\n');
    fs.writeFileSync(path.join(dir, 'src', 'b.js'), 'module.exports = 2;\n');
    const preparar = (arquivo) => spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'preparar-revisao.js'),
      '--arquivo', arquivo, '--semente', 'fixa'], { cwd: dir, encoding: 'utf8', shell: false, timeout: 60000 });
    const css = preparar('src/a.css');
    assert.strictEqual(css.status, 0, css.stdout + css.stderr);
    const saida = JSON.parse(css.stdout);
    const pasta = path.dirname(saida.a);
    const det = JSON.parse(fs.readFileSync(path.join(pasta, 'detector.json'), 'utf8'));
    const mapa = JSON.parse(fs.readFileSync(path.join(pasta, 'mapa.json'), 'utf8')).mapa;
    assert.strictEqual(mapa[det.rotulo], 'trabalho', 'o rotulo do detector e o do lado do trabalho');
    assert.deepStrictEqual(det.fonte.fora.map((a) => a.valor), ['#123456'], 'o legado do HEAD nao entra');
    const linha = fs.readFileSync(path.join(pasta, det.rotulo + '.txt'), 'utf8').split('\n')[det.fonte.fora[0].linha - 1];
    assert.match(linha, /#123456/, 'a linha do detector e a do arquivo que a lente cita');
    assert.match(saida.aviso, /detector\.json guarda o que o detector de design achou, para o apurar-ronda\.js cruzar com a lente ui-design depois dos vereditos: nao o abra e nao o mostre a nenhum inspetor/);
    // Nada do detector vai ao que o inspetor le.
    for (const f of fs.readdirSync(pasta).filter((f) => /\.(txt|md)$/.test(f))) {
      assert.ok(!/detector/.test(fs.readFileSync(path.join(pasta, f), 'utf8')), f + ' cita o detector');
    }
    const pb = preparar('src/b.js');
    assert.strictEqual(pb.status, 0, pb.stdout + pb.stderr);
    const js = JSON.parse(pb.stdout);
    assert.ok(!fs.existsSync(path.join(path.dirname(js.a), 'detector.json')), 'arquivo que nao e de estilo nao tem detector');
    assert.ok(!/detector\.json/.test(js.aviso));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
