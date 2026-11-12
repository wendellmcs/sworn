'use strict';
// D794 (C1 do plano unico): a prova rodada pelo gancho do fecho, so no projeto que o dono ligou na maquina dele.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const lib = require('../scripts/lib/prova-no-fecho.js');

function comTmp(fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-pnf-'));
  try { fn(base); } finally { fs.rmSync(base, { recursive: true, force: true }); }
}

test('D794: a chave mora fora do repositorio, por projeto; ligar, ver e desligar', () => {
  comTmp((tmp) => {
    const env = { CLAUDE_CONFIG_DIR: path.join(tmp, 'claude') };
    const proj = fs.mkdtempSync(path.join(tmp, 'proj-'));
    const outro = fs.mkdtempSync(path.join(tmp, 'outro-'));
    assert.strictEqual(lib.arquivo(env), path.join(tmp, 'claude', 'sworn', 'prova-no-fecho.json'));
    // D799: a bateria aponta a chave para um arquivo da leva; vazia ou so espacos, vale a da pasta do Claude
    const daLeva = path.join(tmp, 'leva', 'chave.json');
    assert.strictEqual(lib.arquivo(Object.assign({ SWORN_PROVA_NO_FECHO_CHAVE: daLeva }, env)), daLeva);
    assert.strictEqual(lib.arquivo(Object.assign({ SWORN_PROVA_NO_FECHO_CHAVE: '  ' }, env)), lib.arquivo(env));
    const P = 'node --test';
    assert.strictEqual(lib.ligado(proj, P, env), false, 'sem a chave, desligado');
    assert.strictEqual(lib.provaLigada(proj, env), null);
    assert.strictEqual(lib.ligar(proj, P, env), true);
    assert.strictEqual(lib.ligar(proj, ' ' + P + ' ', env), false, 'ligar de novo nao duplica');
    assert.strictEqual(lib.ligado(proj, P, env), true);
    assert.strictEqual(lib.ligado(proj + path.sep + '.', P, env), true, 'o mesmo caminho escrito de outro jeito');
    assert.strictEqual(lib.ligado(outro, P, env), false, 'so o projeto ligado');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(lib.arquivo(env), 'utf8')).projetos.length, 1);
    // o dono ligou um comando; o projeto.json que declara outro (um commit novo) nao roda sem ligar de novo
    assert.strictEqual(lib.ligado(proj, 'node mal.js', env), false, 'outra prova: desligada');
    assert.strictEqual(lib.ligado(proj, '', env), false);
    assert.strictEqual(lib.provaLigada(proj, env), P);
    assert.strictEqual(lib.ligar(proj, 'node mal.js', env), true, 'ligar troca a prova ligada');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(lib.arquivo(env), 'utf8')).projetos.map((p) => p.prova),
      ['node mal.js'], 'troca, sem duplicar a raiz');
    assert.throws(() => lib.ligar(proj, '  ', env), /comando da prova/);
    lib.ligar(proj, P, env);
    assert.strictEqual(lib.desligar(proj, env), true);
    assert.strictEqual(lib.desligar(proj, env), false, 'desligar o que nao esta ligado nao muda nada');
    assert.strictEqual(lib.ligado(proj, P, env), false);
    // a chave editada a mao com a raiz repetida: ligar troca todas, e a de baixo nao volta a valer
    fs.writeFileSync(lib.arquivo(env), JSON.stringify({ projetos: [{ raiz: proj, prova: 'p1' }, { raiz: proj, prova: 'p2' }] }));
    assert.strictEqual(lib.ligar(proj, 'p3', env), true);
    assert.strictEqual(lib.ligado(proj, 'p3', env), true, 'a prova ligada agora vale');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(lib.arquivo(env), 'utf8')).projetos.map((p) => p.prova), ['p3']);
    // a chave vazia (uma queda no meio da gravacao de outro programa) e lista vazia, nao ilegivel
    fs.writeFileSync(lib.arquivo(env), ' \n');
    assert.strictEqual(lib.ligar(proj, P, env), true, 'chave vazia: ligar grava');
    // a chave gravada com BOM (editor ou PowerShell no Windows) segue legivel
    fs.writeFileSync(lib.arquivo(env), '\uFEFF' + JSON.stringify({ projetos: [{ raiz: proj, prova: P }] }));
    assert.strictEqual(lib.ligado(proj, P, env), true, 'BOM nao torna a chave ilegivel');
    // chave ilegivel ou com tipo errado vale como desligada; ilegivel, ligar e desligar recusam em vez de sobrescrever
    // (apagariam os outros projetos ligados)
    fs.writeFileSync(lib.arquivo(env), '{ quebrado');
    assert.strictEqual(lib.ligado(proj, P, env), false);
    assert.throws(() => lib.ligar(proj, P, env), /ilegivel/);
    assert.throws(() => lib.desligar(proj, env), /ilegivel/);
    assert.strictEqual(fs.readFileSync(lib.arquivo(env), 'utf8'), '{ quebrado', 'a chave ilegivel fica como estava');
    // a chave que existe e nao abre (aqui, uma pasta no lugar do arquivo) tambem e ilegivel, nao "sem chave"
    const envPasta = { CLAUDE_CONFIG_DIR: path.join(tmp, 'claude-pasta') };
    fs.mkdirSync(lib.arquivo(envPasta), { recursive: true });
    assert.strictEqual(lib.ligado(proj, P, envPasta), false);
    assert.throws(() => lib.ligar(proj, P, envPasta), /ilegivel/);
    fs.writeFileSync(lib.arquivo(env), JSON.stringify({ projetos: 'x' }));
    assert.strictEqual(lib.ligado(proj, P, env), false);
    assert.throws(() => lib.ligar(proj, P, env), /ilegivel/, 'tipo errado tambem e chave ilegivel');
    // caminho vazio nao e a pasta atual, mesmo com ela ligada; e ligar/desligar sem caminho nao grava nada
    assert.throws(() => lib.ligar('', P, env), /caminho/);
    assert.throws(() => lib.ligar(null, P, env), /caminho/);
    assert.throws(() => lib.desligar(undefined, env), /caminho/);
    fs.writeFileSync(lib.arquivo(env), JSON.stringify({ projetos: [] }));
    lib.ligar(process.cwd(), P, env);
    assert.strictEqual(lib.ligado('', P, env), false);
    assert.strictEqual(lib.ligado(null, P, env), false);
    // o que nao e entrada valida ({ raiz, prova } com texto nos dois) sai na proxima gravacao
    fs.writeFileSync(lib.arquivo(env), JSON.stringify({ projetos: [null, 7, proj, { raiz: proj }, { raiz: proj, prova: ' ' },
      { raiz: proj, prova: P }, { raiz: outro, prova: P }] }));
    assert.strictEqual(lib.desligar(outro, env), true);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(lib.arquivo(env), 'utf8')).projetos, [{ raiz: proj, prova: P }]);
  });
});

test('D794: rodar a prova devolve passou, falhou com a cauda da saida, ou estourou o teto', () => {
  comTmp((tmp) => {
    fs.writeFileSync(path.join(tmp, 'passa.js'), 'console.log("# pass 2"); console.log("# fail 0");');
    fs.writeFileSync(path.join(tmp, 'falha.js'), 'for (let i = 0; i < 60; i++) console.log("linha " + i);' +
      'console.log("boom-falhou"); process.exit(1);');
    fs.writeFileSync(path.join(tmp, 'mente.js'), 'console.log("# fail 3");');
    fs.writeFileSync(path.join(tmp, 'demora.js'), 'setTimeout(function () {}, 5000);');
    const ok = lib.rodar('node passa.js', tmp, 20000);
    assert.deepStrictEqual([ok.ok, ok.estourou, ok.codigo], [true, false, 0], JSON.stringify(ok));
    assert.strictEqual(lib.rodar('node passa.js', tmp, -5).ok, true, 'teto invalido usa o padrao, nao mata a prova');
    assert.strictEqual(lib.rodar('node passa.js', tmp, 3e9).ok, true, 'teto acima do maximo do setTimeout tambem');
    const f = lib.rodar('node falha.js', tmp, 20000);
    assert.deepStrictEqual([f.ok, f.estourou, f.codigo], [false, false, 1], JSON.stringify(f));
    assert.ok(/boom-falhou/.test(f.cauda), 'a cauda traz o fim da saida');
    assert.ok(!/linha 0\n/.test(f.cauda) && f.cauda.split('\n').length <= lib.CAUDA_LINHAS, 'so as ultimas linhas');
    const m = lib.rodar('node mente.js', tmp, 20000);
    assert.strictEqual(m.ok, false, 'saida com falha conta mesmo saindo com 0');
    const d = lib.rodar('node demora.js', tmp, 300);
    assert.deepStrictEqual([d.ok, d.estourou], [false, true], JSON.stringify(d));
    const nada = lib.rodar('', tmp, 1000);
    assert.strictEqual(nada.ok, false, 'sem comando nao passa');
    assert.match(nada.cauda, /sem comando/, 'e diz por que');
    // a prova que comeca com "-" chega ao shell, nao vira opcao do node (que imprimiria a versao e sairia com 0)
    const traco = lib.rodar('--version', tmp, 20000);
    assert.strictEqual(traco.ok, false, JSON.stringify(traco));
    assert.ok(!/^v\d+\.\d+\.\d+$/.test(traco.cauda), 'nao e a versao do node: ' + traco.cauda);
    // a prova que nao chega a rodar (pasta que nao existe) diz a causa na cauda
    const semPasta = lib.rodar('node passa.js', path.join(tmp, 'nao-existe'), 5000);
    assert.strictEqual(semPasta.ok, false);
    assert.match(semPasta.cauda, /nao rodou/, JSON.stringify(semPasta));
    assert.ok(/^[\n\x20-\x7E]*$/.test(f.cauda), 'cauda em ASCII (R5)');
  });
});

test('D794: o comando ligar/desligar/ver age na raiz do projeto da pasta atual', () => {
  comTmp((tmp) => {
    const proj = fs.mkdtempSync(path.join(tmp, 'p-'));
    fs.mkdirSync(path.join(proj, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(proj, '.claude', 'sworn', 'projeto.json'),
      JSON.stringify({ versaoConfig: 1, provaDePronto: 'node --test' }));
    fs.mkdirSync(path.join(proj, 'sub'));
    const env = Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: path.join(tmp, 'claude') });
    const cli = (arg, cwd) => spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'prova-no-fecho.js')].concat(arg),
      { cwd: cwd || proj, env, encoding: 'utf8' });
    const ver0 = cli(['ver']);
    assert.strictEqual(ver0.status, 0);
    assert.match(ver0.stdout, /prova no fecho desligada/);
    const l = cli(['ligar'], path.join(proj, 'sub'));
    assert.strictEqual(l.status, 0, l.stderr);
    assert.match(l.stdout, /node --test/, 'diz qual prova o gancho vai rodar');
    assert.strictEqual(lib.ligado(proj, 'node --test', { CLAUDE_CONFIG_DIR: path.join(tmp, 'claude') }), true,
      'a raiz, nao a subpasta, e a prova declarada');
    assert.match(cli(['ver']).stdout, /prova no fecho ligada/, '"desligada" nao pode passar aqui');
    // o projeto.json troca a prova depois de ligada: ver diz que parou e o que fazer
    fs.writeFileSync(path.join(proj, '.claude', 'sworn', 'projeto.json'),
      JSON.stringify({ versaoConfig: 1, provaDePronto: 'node mal.js' }));
    const parada = cli(['ver']).stdout;
    assert.match(parada, /parada em .*"node --test".*"node mal\.js".*ligar/, parada);
    assert.strictEqual(cli(['ligar']).status, 0);
    assert.match(cli(['ver']).stdout, /prova no fecho ligada .*node mal\.js/);
    fs.writeFileSync(path.join(proj, '.claude', 'sworn', 'projeto.json'),
      JSON.stringify({ versaoConfig: 1, provaDePronto: 'node --test' }));
    assert.strictEqual(cli(['desligar']).status, 0);
    assert.strictEqual(lib.provaLigada(proj, { CLAUDE_CONFIG_DIR: path.join(tmp, 'claude') }), null);
    // chave ilegivel: ligar e desligar dizem o que fazer, sem estourar e sem sobrescrever
    const chave = lib.arquivo({ CLAUDE_CONFIG_DIR: path.join(tmp, 'claude') });
    fs.writeFileSync(chave, '{ quebrado');
    for (const acao of ['ligar', 'desligar']) {
      const q = cli([acao]);
      assert.strictEqual(q.status, 1, acao + ': ' + q.stderr);
      // a mensagem diz qual arquivo e o que fazer, nao so que falhou
      assert.match(q.stderr, /prova-no-fecho\.json esta ilegivel; corrija ou apague o arquivo e rode o comando de novo/,
        q.stderr);
    }
    fs.writeFileSync(chave, JSON.stringify({ projetos: [] }));
    const errado = cli(['xyz']);
    assert.strictEqual(errado.status, 2);
    assert.match(errado.stderr, /^uso: node prova-no-fecho\.js ligar \| desligar \| ver/);
    // projeto sem provaDePronto: ligar recusa e diz por que
    const semProva = fs.mkdtempSync(path.join(tmp, 'sp-'));
    fs.mkdirSync(path.join(semProva, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(semProva, '.claude', 'sworn', 'projeto.json'), JSON.stringify({ versaoConfig: 1 }));
    const r = cli(['ligar'], semProva);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /nao declara provaDePronto no \.claude\/sworn\/projeto\.json; declare o comando da prova/,
      'diz onde e como declarar: ' + r.stderr);
  });
});
