'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const agentesLib = require('../scripts/lib/agentes.js');

const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'portao-apelido.js');

/** Espaco e acento no caminho: e o caso normal desta maquina (foco de revisao 5). */
function projeto(degraus) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn apelido-'));
  fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify({
    versaoConfig: 1,
    agentes: { escada: degraus.map(function (d) { return d.agente; }), degraus: degraus }
  }, null, 2), 'utf8');
  return dir;
}

function agente(dir, nome, corpo) {
  const alvo = agentesLib.caminho(dir, nome);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, corpo, 'utf8');
  return alvo;
}

function hook(dir, tmp, sessaoId) {
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: dir, encoding: 'utf8',
    input: JSON.stringify({
      session_id: sessaoId, cwd: dir, hook_event_name: 'PreToolUse',
      tool_name: 'Task', tool_input: { subagent_type: 'busca' }
    }),
    env: Object.assign({}, process.env, { SWORN_TMP: tmp })
  });
  let json = null;
  if (r.stdout && r.stdout.trim()) { try { json = JSON.parse(r.stdout); } catch (e) { json = null; } }
  return { status: r.status, json: json, stderr: r.stderr, stdout: r.stdout };
}

function cli(dir, args) {
  const r = spawnSync(process.execPath, [SCRIPT].concat(args), { cwd: dir, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function negou(r) {
  return !!(r.json && r.json.hookSpecificOutput && r.json.hookSpecificOutput.permissionDecision === 'deny');
}

function liberou(r) {
  assert.strictEqual(r.status, 0, 'o portao tem de sair com 0 (R6). stderr: ' + r.stderr);
  assert.ok(!/portao falhou/.test(r.stderr || ''),
    'o portao caiu e liberou por inercia, nao por decisao: ' + r.stderr);
  assert.strictEqual(negou(r), false);
}

function sessao(tmp, id) {
  try { return JSON.parse(fs.readFileSync(path.join(tmp, 'sworn', id + '.json'), 'utf8')); }
  catch (e) { return null; }
}

function comTmp(fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-ap-'));
  try { fn(base); } finally { fs.rmSync(base, { recursive: true, force: true }); }
}

const DOIS = [{ agente: 'busca', apelido: 'barato' }, { agente: 'arquiteto', apelido: 'caro' }];

// ------------------------------------------------------------------ o aviso

test('portao-apelido: divergencia AVISA e deixa passar - nunca nega (decisao 15)', () => {
  comTmp((tmp) => {
    const dir = projeto(DOIS);
    agente(dir, 'busca', '---\nname: busca\nmodel: caro\n---\n');
    agente(dir, 'arquiteto', '---\nname: arquiteto\nmodel: caro\n---\n');
    const r = hook(dir, tmp, 'p1');
    liberou(r);
    assert.ok(r.json, 'tinha de ter avisado: ' + r.stdout);
    assert.ok(r.json.systemMessage.includes('busca'), r.json.systemMessage);
    assert.ok(/mapa diz:\s+barato/.test(r.json.systemMessage), r.json.systemMessage);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('portao-apelido: o aviso chega aos DOIS canais, e sem permissionDecision', () => {
  comTmp((tmp) => {
    const dir = projeto(DOIS);
    agente(dir, 'busca', '---\nname: busca\nmodel: caro\n---\n');
    agente(dir, 'arquiteto', '---\nname: arquiteto\nmodel: caro\n---\n');
    const r = hook(dir, tmp, 'p2');
    assert.ok(r.json.systemMessage, 'faltou o canal do usuario');
    assert.ok(r.json.hookSpecificOutput.additionalContext, 'faltou o canal do agente');
    // "allow" pularia a pergunta de permissao normal: este portao nao decide isso.
    assert.strictEqual(r.json.hookSpecificOutput.permissionDecision, undefined,
      'o portao nao pode mandar permissionDecision');
    assert.ok(/--corrigir/.test(r.json.hookSpecificOutput.additionalContext),
      'o agente precisa receber o comando do conserto');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('portao-apelido: avisa uma vez por sessao, e conta TODAS as vezes', () => {
  comTmp((tmp) => {
    const dir = projeto(DOIS);
    agente(dir, 'busca', '---\nname: busca\nmodel: caro\n---\n');
    agente(dir, 'arquiteto', '---\nname: arquiteto\nmodel: caro\n---\n');
    const primeiro = hook(dir, tmp, 'p3');
    const segundo = hook(dir, tmp, 'p3');
    assert.ok(primeiro.json && primeiro.json.systemMessage, 'o primeiro tinha de avisar');
    assert.strictEqual(segundo.json, null, 'o aviso nao pode repetir na mesma sessao');
    assert.strictEqual(sessao(tmp, 'p3').contadores.apelido_divergente, 2,
      'calar o aviso nao pode calar a CONTAGEM');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// A1-24 (pedido 12, estados): o aviso unico lia a marca e gravava depois, em separado: dois despachos que leem
// antes de qualquer um gravar avisavam os dois. O gancho segura cada processo depois da leitura ate o outro ler
// tambem - a corrida sem depender da sorte.
test('A1-24: dois despachos ao mesmo tempo na mesma sessao avisam UMA vez so', async () => {
  const { spawn } = require('node:child_process');
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-barreira-'));
  const barreira = path.join(pasta, 'chegaram');
  fs.mkdirSync(barreira);
  const gancho = path.join(pasta, 'gancho.js');
  fs.writeFileSync(gancho, [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const estado = require(' + JSON.stringify(path.join(RAIZ, 'scripts', 'lib', 'estado.js')) + ');',
    'const ler = estado.ler;',
    'estado.ler = function (id) {',
    '  const s = ler(id);',
    "  fs.writeFileSync(path.join(" + JSON.stringify(barreira) + ", String(process.pid)), '');",
    '  const fim = Date.now() + 5000;',
    '  while (fs.readdirSync(' + JSON.stringify(barreira) + ').length < 2 && Date.now() < fim) {',
    '    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);',
    '  }',
    '  return s;',
    '};'
  ].join('\n'), 'utf8');
  const dir = projeto(DOIS);
  try {
    agente(dir, 'busca', '---\nname: busca\nmodel: caro\n---\n');
    agente(dir, 'arquiteto', '---\nname: arquiteto\nmodel: caro\n---\n');
    const entrada = JSON.stringify({
      session_id: 'p14', cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Task',
      tool_input: { subagent_type: 'busca' }
    });
    const saidas = await Promise.all([1, 2].map(() => new Promise((resolve) => {
      const f = spawn(process.execPath, ['--require', gancho, SCRIPT], {
        cwd: dir, env: Object.assign({}, process.env, { SWORN_TMP: pasta })
      });
      let out = '';
      f.stdout.on('data', (d) => { out += d; });
      f.on('close', (status) => resolve({ status, out }));
      f.stdin.end(entrada);
    })));
    assert.deepStrictEqual(saidas.map((s) => s.status), [0, 0], JSON.stringify(saidas));
    assert.strictEqual(saidas.filter((s) => s.out.trim() !== '').length, 1, 'A1-24: avisou mais de uma vez: ' +
      JSON.stringify(saidas));
    assert.strictEqual(sessao(pasta, 'p14').contadores.apelido_divergente, 2, 'a contagem tem de ver os dois');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});

test('portao-apelido: mapa e arquivos casados passam calados', () => {
  comTmp((tmp) => {
    const dir = projeto(DOIS);
    agente(dir, 'busca', '---\nname: busca\nmodel: barato\n---\n');
    agente(dir, 'arquiteto', '---\nname: arquiteto\nmodel: caro\n---\n');
    const r = hook(dir, tmp, 'p4');
    liberou(r);
    assert.strictEqual(r.json, null, 'nao pode avisar sem divergencia: ' + r.stdout);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// Foco de revisao 4: `model:` ausente nao e divergencia, e nao pode virar aviso.
test('portao-apelido: agente sem model: nao gera aviso falso', () => {
  comTmp((tmp) => {
    const dir = projeto(DOIS);
    agente(dir, 'busca', '---\nname: busca\n---\n');
    agente(dir, 'arquiteto', '---\nname: arquiteto\nmodel: caro\n---\n');
    const r = hook(dir, tmp, 'p5');
    liberou(r);
    assert.strictEqual(r.json, null, 'nao declarado virou aviso: ' + r.stdout);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// Foco de revisao 1: sem agentes nao se avisa, mas tambem NAO se passa em silencio.
test('portao-apelido: projeto sem .claude/agents registra "nao verificavel" no estado', () => {
  comTmp((tmp) => {
    const dir = projeto(DOIS);
    const r = hook(dir, tmp, 'p6');
    liberou(r);
    assert.strictEqual(r.json, null, 'nao pode virar ruido em projeto sem agentes');
    const s = sessao(tmp, 'p6');
    assert.ok(s && s.gatilho3, 'o veredito tinha de ficar registrado');
    assert.strictEqual(s.gatilho3.verificavel, false);
    assert.ok(/agents/.test(s.gatilho3.motivo), s.gatilho3.motivo);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('portao-apelido: com agentes casados o estado registra verificavel:true', () => {
  comTmp((tmp) => {
    const dir = projeto(DOIS);
    agente(dir, 'busca', '---\nname: busca\nmodel: barato\n---\n');
    agente(dir, 'arquiteto', '---\nname: arquiteto\nmodel: caro\n---\n');
    hook(dir, tmp, 'p7');
    const s = sessao(tmp, 'p7');
    assert.strictEqual(s.gatilho3.verificavel, true);
    assert.strictEqual(s.gatilho3.divergentes, 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('portao-apelido: cwd absurdo faz o portao DECIDIR, nao estourar', () => {
  comTmp((tmp) => {
    const r = spawnSync(process.execPath, [SCRIPT], {
      encoding: 'utf8', input: JSON.stringify({ session_id: 'p8', cwd: 42, tool_name: 'Task' }),
      env: Object.assign({}, process.env, { SWORN_TMP: tmp })
    });
    assert.strictEqual(r.status, 0);
    // A diferenca entre "decidiu" e "caiu e liberou por inercia" (D37): se tivesse
    // caido, blindar() teria deixado rastro no stderr e o estado nao existiria.
    assert.ok(!/portao falhou/.test(r.stderr || ''), 'era para decidir, nao cair: ' + r.stderr);
    const s = sessao(tmp, 'p8');
    assert.ok(s && s.gatilho3, 'sem estado gravado nao da para dizer que ele decidiu');
    assert.strictEqual(s.gatilho3.verificavel, false);
  });
});

/**
 * R6 de verdade. A versao anterior deste teste usava `cwd: 42` e passava sem
 * exercitar nada: neste portao um cwd absurdo NAO estoura - `carregarProjeto`
 * ja devolve null no catch dele, e `listar` devolve existe:false. Era um teste
 * verde medindo a coisa errada, achado no ensaio em sandbox.
 * O que estoura de verdade e a gravacao do estado: SWORN_TMP apontando para
 * um ARQUIVO faz o mkdir dar ENOTDIR dentro do callback assincrono, que e
 * exatamente o caminho que blindar() existe para cobrir.
 */
test('portao-apelido R6: quando o portao FALHA mesmo, ele libera e deixa rastro', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-r6-'));
  const naoPasta = path.join(base, 'naoSouPasta');
  fs.writeFileSync(naoPasta, 'sou um arquivo\n', 'utf8');
  try {
    const dir = projeto(DOIS);
    const r = spawnSync(process.execPath, [SCRIPT], {
      cwd: dir, encoding: 'utf8',
      input: JSON.stringify({ session_id: 'p8b', cwd: dir, tool_name: 'Task' }),
      env: Object.assign({}, process.env, { SWORN_TMP: naoPasta })
    });
    assert.strictEqual(r.status, 0, 'R6: portao que falha nao pode travar a sessao');
    assert.strictEqual(r.stdout, '', 'portao que caiu nao opina');
    // Sem isto, se um dia a entrada parar de ser hostil o teste segue verde
    // sem exercitar o R6 nenhuma vez - foi assim que a versao anterior mentiu.
    assert.ok(/portao falhou/.test(r.stderr || ''),
      'a entrada precisa mesmo estourar, senao este teste nao prova o R6: ' + r.stderr);
    fs.rmSync(dir, { recursive: true, force: true });
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------- --mapa

test('portao-apelido --mapa: imprime JSON com os quatro baldes', () => {
  const dir = projeto(DOIS);
  agente(dir, 'busca', '---\nname: busca\nmodel: caro\n---\n');
  const r = cli(dir, ['--mapa']);
  assert.strictEqual(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.strictEqual(j.verificavel, true);
  assert.strictEqual(j.divergencias.length, 1);
  assert.strictEqual(j.divergencias[0].declarado, 'caro');
  assert.strictEqual(j.divergencias[0].gravado, 'barato');
  assert.deepStrictEqual(j.semArquivo.map(function (x) { return x.agente; }), ['arquiteto']);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- --corrigir

test('portao-apelido --corrigir --para arquivo: conserta E a conferencia para de acusar', () => {
  comTmp((tmp) => {
    const dir = projeto(DOIS);
    agente(dir, 'busca', '---\nname: busca\nmodel: caro\ndescription: procura\n---\n\n# busca\ncorpo\n');
    agente(dir, 'arquiteto', '---\nname: arquiteto\nmodel: caro\n---\n');

    const c = cli(dir, ['--corrigir', 'busca', '--para', 'arquivo']);
    assert.strictEqual(c.status, 0, c.stdout + c.stderr);
    assert.ok(/CORRIGIDO/.test(c.stdout), c.stdout);

    const depois = fs.readFileSync(agentesLib.caminho(dir, 'busca'), 'utf8');
    assert.ok(depois.includes('model: barato'), depois);
    assert.ok(depois.includes('description: procura'), 'perdeu o resto do frontmatter');
    assert.ok(depois.includes('corpo'), 'perdeu o corpo do arquivo');

    // a prova de verdade: rodar o hook de novo, e ele calar
    const r = hook(dir, tmp, 'p9');
    liberou(r);
    assert.strictEqual(r.json, null, 'depois de corrigir o aviso tinha de sumir: ' + r.stdout);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// A1-15 (revisao completa, L2): o nome do agente vem do `name:` do frontmatter, e o arquivo pode ter
// outro nome; o --corrigir montava o caminho pelo nome e dava ENOENT no arquivo que o --mapa mostra.
test('A1-15: --corrigir --para arquivo acha o agente cujo arquivo tem outro nome', () => {
  comTmp(() => {
    const dir = projeto(DOIS);
    agente(dir, 'busca-codigo', '---\nname: busca\nmodel: caro\n---\n\n# busca\n');
    agente(dir, 'arquiteto', '---\nname: arquiteto\nmodel: caro\n---\n');
    const c = cli(dir, ['--corrigir', 'busca', '--para', 'arquivo']);
    assert.strictEqual(c.status, 0, c.stdout + c.stderr);
    assert.ok(fs.readFileSync(agentesLib.caminho(dir, 'busca-codigo'), 'utf8').includes('model: barato'));
    assert.ok(!fs.existsSync(agentesLib.caminho(dir, 'busca')), 'criou um arquivo pelo nome em vez de corrigir o real');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('portao-apelido --corrigir --para mapa: conserta o outro lado', () => {
  comTmp((tmp) => {
    const dir = projeto(DOIS);
    agente(dir, 'busca', '---\nname: busca\nmodel: medio\n---\n');
    agente(dir, 'arquiteto', '---\nname: arquiteto\nmodel: caro\n---\n');

    const c = cli(dir, ['--corrigir', 'busca', '--para', 'mapa']);
    assert.strictEqual(c.status, 0, c.stdout + c.stderr);

    const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), 'utf8'));
    assert.strictEqual(cfg.agentes.degraus[0].apelido, 'medio');
    assert.deepStrictEqual(cfg.agentes.escada, ['busca', 'arquiteto'], 'a escada nao pode ter mudado');

    const r = hook(dir, tmp, 'p10');
    liberou(r);
    assert.strictEqual(r.json, null, 'depois de corrigir o aviso tinha de sumir: ' + r.stdout);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// D678 T1: o esforco entra no mesmo aviso e no mesmo conserto que o modelo.
const DOIS_ESFORCO = [{ agente: 'busca', apelido: 'barato', esforco: 'low' }, { agente: 'arquiteto', apelido: 'caro', esforco: 'high' }];

test('D678 T1: effort: divergente avisa (sem negar) e o --mapa traz os baldes do esforco', () => {
  comTmp((tmp) => {
    const dir = projeto(DOIS_ESFORCO);
    agente(dir, 'busca', '---\nname: busca\nmodel: barato\neffort: high\n---\n');
    agente(dir, 'arquiteto', '---\nname: arquiteto\nmodel: caro\n---\n');
    const r = hook(dir, tmp, 'e1');
    liberou(r);
    assert.ok(r.json && /effort: high/.test(r.json.systemMessage), 'tinha de avisar do esforco: ' + r.stdout);
    const j = JSON.parse(cli(dir, ['--mapa']).stdout);
    assert.deepStrictEqual(j.esforcoDivergente.map((x) => x.agente), ['busca']);
    assert.deepStrictEqual(j.esforcoNaoDeclarado.map((x) => x.agente), ['arquiteto']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('D678 T1: --corrigir --para arquivo conserta o effort: e o aviso some', () => {
  comTmp((tmp) => {
    const dir = projeto(DOIS_ESFORCO);
    agente(dir, 'busca', '---\nname: busca\nmodel: caro\neffort: high\n---\ncorpo\n');
    agente(dir, 'arquiteto', '---\nname: arquiteto\nmodel: caro\neffort: high\n---\n');
    const c = cli(dir, ['--corrigir', 'busca', '--para', 'arquivo']);
    assert.strictEqual(c.status, 0, c.stdout + c.stderr);
    const depois = fs.readFileSync(agentesLib.caminho(dir, 'busca'), 'utf8');
    assert.strictEqual(depois, '---\nname: busca\nmodel: barato\neffort: low\n---\ncorpo\n');
    const r = hook(dir, tmp, 'e2');
    liberou(r);
    assert.strictEqual(r.json, null, 'depois de corrigir o aviso tinha de sumir: ' + r.stdout);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('D678 T1: --corrigir --para mapa grava o esforco do arquivo no degrau', () => {
  comTmp((tmp) => {
    const dir = projeto(DOIS_ESFORCO);
    agente(dir, 'busca', '---\nname: busca\nmodel: barato\neffort: medium\n---\n');
    agente(dir, 'arquiteto', '---\nname: arquiteto\nmodel: caro\neffort: high\n---\n');
    const c = cli(dir, ['--corrigir', 'busca', '--para', 'mapa']);
    assert.strictEqual(c.status, 0, c.stdout + c.stderr);
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), 'utf8'));
    assert.deepStrictEqual(cfg.agentes.degraus[0], { agente: 'busca', apelido: 'barato', esforco: 'medium' });
    const r = hook(dir, tmp, 'e3');
    liberou(r);
    assert.strictEqual(r.json, null, r.stdout);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('portao-apelido --corrigir: agente que nao diverge e RECUSADO, nao reescrito', () => {
  const dir = projeto(DOIS);
  agente(dir, 'busca', '---\nname: busca\nmodel: barato\n---\n');
  const antes = fs.readFileSync(agentesLib.caminho(dir, 'busca'), 'utf8');
  const c = cli(dir, ['--corrigir', 'busca', '--para', 'arquivo']);
  assert.strictEqual(c.status, 1, c.stdout);
  assert.ok(/NADA A CORRIGIR/.test(c.stdout), c.stdout);
  // A1-26 (pedido 12, microcopy): a recusa diz o passo seguinte
  assert.ok(/--mapa/.test(c.stdout) && /grafia/.test(c.stdout), 'A1-26: sem o passo seguinte: ' + c.stdout);
  assert.strictEqual(fs.readFileSync(agentesLib.caminho(dir, 'busca'), 'utf8'), antes,
    'recusou e mesmo assim mexeu no arquivo');
  fs.rmSync(dir, { recursive: true, force: true });
});

// A1-27 (pedido 12, microcopy): o degrau escrito com "nome" no lugar de "agente" o mapa le, e o conserto do
// --para mapa nao acha. A mensagem dizia "degraus", sem o passo; agora diz onde esta e o que fazer.
test('A1-27: --para mapa com o agente gravado em outra forma diz o arquivo e o passo, sem jargao', () => {
  const dir = projeto([{ nome: 'busca', apelido: 'barato' }, { agente: 'arquiteto', apelido: 'caro' }]);
  try {
    agente(dir, 'busca', '---\nname: busca\nmodel: caro\n---\n');
    agente(dir, 'arquiteto', '---\nname: arquiteto\nmodel: caro\n---\n');
    const c = cli(dir, ['--corrigir', 'busca', '--para', 'mapa']);
    assert.strictEqual(c.status, 1, c.stdout + c.stderr);
    assert.ok(/^ERRO: /.test(c.stdout), c.stdout);
    assert.ok(!/degrau/i.test(c.stdout), 'A1-27: jargao na mensagem: ' + c.stdout);
    assert.ok(/projeto\.json/.test(c.stdout) && /--para arquivo/.test(c.stdout),
      'A1-27: sem onde e sem o passo: ' + c.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('portao-apelido --corrigir sem direcao para e explica as duas', () => {
  const dir = projeto(DOIS);
  agente(dir, 'busca', '---\nname: busca\nmodel: caro\n---\n');
  const c = cli(dir, ['--corrigir', 'busca']);
  assert.strictEqual(c.status, 1, c.stdout);
  assert.ok(/--para arquivo/.test(c.stdout) && /--para mapa/.test(c.stdout), c.stdout);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('portao-apelido --corrigir: arquivo sem frontmatter e recusado sem ser remendado', () => {
  const dir = projeto(DOIS);
  agente(dir, 'busca', '# so um titulo, sem cerca\n');
  const antes = fs.readFileSync(agentesLib.caminho(dir, 'busca'), 'utf8');
  // sem `model:` ele nem diverge - e "nao declarado". Este e o desfecho certo:
  // recusa porque nao ha divergencia, nunca porque estragou o arquivo.
  const c = cli(dir, ['--corrigir', 'busca', '--para', 'arquivo']);
  assert.strictEqual(c.status, 1, c.stdout);
  assert.strictEqual(fs.readFileSync(agentesLib.caminho(dir, 'busca'), 'utf8'), antes);
  fs.rmSync(dir, { recursive: true, force: true });
});

// A1-ape-1 (pedido 12, estados): a escrita do --corrigir (o arquivo do agente e o projeto.json) estava fora de try -
// a falha saia como pilha de excecao. Agora tem a forma da leitura: "ERRO: nao consegui gravar <arquivo>: <causa>".
function cliComEscritaNegada(dir, args, final) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-gancho-'));
  try {
    const gancho = path.join(pasta, 'gancho.js');
    fs.writeFileSync(gancho, [
      "const fs = require('node:fs');",
      'const orig = fs.writeFileSync;',
      'fs.writeFileSync = function (p) {',
      '  if (String(p).endsWith(' + JSON.stringify(final) + ')) {',
      "    throw Object.assign(new Error('EACCES: permission denied, open ' + p), { code: 'EACCES' });",
      '  }',
      '  return orig.apply(this, arguments);',
      '};'
    ].join('\n'), 'utf8');
    return spawnSync(process.execPath, ['--require', gancho, SCRIPT].concat(args), { cwd: dir, encoding: 'utf8' });
  } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
}

test('A1-ape-1: escrita negada no --corrigir sai com ERRO e a causa, sem pilha de excecao', () => {
  for (const [para, final] of [['arquivo', 'busca.md'], ['mapa', 'projeto.json']]) {
    const dir = projeto(DOIS);
    agente(dir, 'busca', '---\nname: busca\nmodel: caro\n---\n');
    agente(dir, 'arquiteto', '---\nname: arquiteto\nmodel: caro\n---\n');
    const r = cliComEscritaNegada(dir, ['--corrigir', 'busca', '--para', para], final);
    assert.strictEqual(r.status, 1, para + ': ' + r.stdout + r.stderr);
    assert.ok(new RegExp('^ERRO: nao consegui gravar .*' + final.replace('.', '\\.') + ': EACCES').test(r.stdout),
      para + ': ' + r.stdout);
    assert.strictEqual(r.stderr, '', para + ': a falha saiu como excecao: ' + r.stderr);
    assert.ok(!/CORRIGIDO/.test(r.stdout), para + ': nao gravou e disse que corrigiu: ' + r.stdout);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A fiacao tem de ter prova. O repositorio ja pagou por isto uma vez: sete
 * achados da "familia A" diziam que desfazer a ligacao entre script e lib
 * deixava a suite identica. Um portao que existe e nao esta registrado nao
 * roda nunca, e nada acusa.
 */
test('portao-apelido: o portao esta registrado no hooks.json, no evento do despacho', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(RAIZ, 'hooks', 'hooks.json'), 'utf8'));
  const pre = hooks.hooks.PreToolUse || [];
  const doDespacho = pre.filter(function (g) { return /Task|Agent/.test(g.matcher || ''); });
  assert.ok(doDespacho.length > 0, 'nao ha grupo de hook para o despacho de agente');

  const registrado = doDespacho.some(function (g) {
    return (g.hooks || []).some(function (h) {
      return (h.args || []).some(function (a) { return String(a).indexOf('portao-apelido.js') !== -1; });
    });
  });
  assert.ok(registrado, 'portao-apelido.js nao esta registrado no evento do despacho');
});

test('portao-apelido: registrar o portao novo nao desligou o portao de custo', () => {
  // Controle: o gatilho 3 entra AO LADO da trava 6, nunca no lugar dela.
  const hooks = JSON.parse(fs.readFileSync(path.join(RAIZ, 'hooks', 'hooks.json'), 'utf8'));
  const args = JSON.stringify(hooks.hooks.PreToolUse || []);
  assert.ok(args.indexOf('portao-agente.js') !== -1, 'a trava 6 sumiu do hooks.json');
});

// DC-02 (D422): texto emitido por gancho nao passa pela expansao de ${CLAUDE_PLUGIN_ROOT}
// (so SKILL.md e hooks.json passam); no Bash do agente a variavel esta vazia.
test('portao-apelido: o comando do conserto cita caminho REAL, nao a variavel nao expandida (DC-02)', () => {
  comTmp((tmp) => {
    const dir = projeto(DOIS);
    agente(dir, 'busca', '---\nname: busca\nmodel: caro\n---\n');
    agente(dir, 'arquiteto', '---\nname: arquiteto\nmodel: caro\n---\n');
    const r = hook(dir, tmp, 'p11');
    const ctx = r.json.hookSpecificOutput.additionalContext;
    assert.ok(!ctx.includes('${CLAUDE_PLUGIN_ROOT}'), 'variavel nao expandida na saida do gancho: ' + ctx);
    const m = /node "([^"]+portao-apelido\.js)" --corrigir/.exec(ctx);
    assert.ok(m, 'sem caminho entre aspas: ' + ctx);
    assert.ok(path.isAbsolute(m[1]) && fs.existsSync(m[1]), 'o caminho citado nao existe: ' + m[1]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// S8 L2-ape-2 (D426): o caminho do plugin entra no texto que o AGENTE copia para o shell. Com `$` ou
// crase no caminho, aspas duplas deixariam o shell expandir/executar o pedaco: ai vai entre aspas simples.
test('portao-apelido: caminho de instalacao com $ ou crase vai entre aspas simples; o normal segue entre duplas (L2-ape-2)', () => {
  const copias = [];
  function pluginEm(nome) {
    const base = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-ap-copia-')), nome);
    fs.cpSync(path.join(RAIZ, 'scripts'), path.join(base, 'scripts'), { recursive: true });
    fs.cpSync(path.join(RAIZ, 'modelos'), path.join(base, 'modelos'), { recursive: true });
    copias.push(path.dirname(base));
    return base;
  }
  function contexto(plugin, dir, tmp, id) {
    const r = spawnSync(process.execPath, [path.join(plugin, 'scripts', 'portao-apelido.js')], {
      cwd: dir, encoding: 'utf8',
      input: JSON.stringify({ session_id: id, cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Task', tool_input: { subagent_type: 'busca' } }),
      env: Object.assign({}, process.env, { SWORN_TMP: tmp })
    });
    assert.strictEqual(r.status, 0, r.stderr);
    return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  }
  comTmp((tmp) => {
    const dir = projeto(DOIS);
    try {
      agente(dir, 'busca', '---\nname: busca\nmodel: caro\n---\n');
      agente(dir, 'arquiteto', '---\nname: arquiteto\nmodel: caro\n---\n');
      const esquisito = pluginEm('a$b`c');
      const ctx = contexto(esquisito, dir, tmp, 'p12');
      const alvo = path.join(esquisito, 'scripts', 'portao-apelido.js');
      assert.ok(ctx.includes("a) node '" + alvo + "' --corrigir"), ctx);
      assert.ok(ctx.includes("b) node '" + alvo + "' --corrigir"), ctx);
      // controle: caminho comum (com espaco) nao muda
      const normal = pluginEm('instalacao normal');
      const ctxN = contexto(normal, dir, tmp, 'p13');
      assert.ok(ctxN.includes('a) node "' + path.join(normal, 'scripts', 'portao-apelido.js') + '" --corrigir'), ctxN);

      // A1-29 (pedido 12, seguranca): com `'` E `$` no caminho, o escape era so o do Bash (`\$` entre aspas
      // duplas); no PowerShell, entre aspas duplas, o `$` expande e a `\` nao escapa. Agora vai pelo shell
      // declarado: no PowerShell, aspas simples com a `'` dobrada; no Bash ou sem declarar, o de antes.
      const aspa = pluginEm("a'b$c");
      const alvoAspa = path.join(aspa, 'scripts', 'portao-apelido.js');
      const doBash = 'a) node "' + alvoAspa.replace(/([\\$`"])/g, '\\$1') + '" --corrigir';
      assert.ok(contexto(aspa, dir, tmp, 'p15').includes(doBash), 'sem shell declarado, o do Bash');
      const cfg = path.join(dir, '.claude', 'sworn', 'projeto.json');
      const obj = JSON.parse(fs.readFileSync(cfg, 'utf8'));
      obj.plataforma = { so: 'win32', shell: 'powershell' };
      fs.writeFileSync(cfg, JSON.stringify(obj), 'utf8');
      const ctxPs = contexto(aspa, dir, tmp, 'p16');
      assert.ok(ctxPs.includes("a) node '" + alvoAspa.replace(/'/g, "''") + "' --corrigir"), 'A1-29: ' + ctxPs);
      obj.plataforma.shell = 'bash';
      fs.writeFileSync(cfg, JSON.stringify(obj), 'utf8');
      assert.ok(contexto(aspa, dir, tmp, 'p17').includes(doBash), 'Bash declarado, o do Bash');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      for (const c of copias) fs.rmSync(c, { recursive: true, force: true });
    }
  });
});

// A4-age-2 (pedido 12): o agente que nao se le saiu de naoDeclarados para o balde ilegiveis; o --mapa, que a skill le
// no gatilho 2, tem de trazer o balde - sem ele o agente sumiria do mapa calado.
test('A4-age-2: o --mapa traz o balde ilegiveis', () => {
  const dir = projeto(DOIS);
  agente(dir, 'busca', '---\nname: busca\nmodel: barato\n---\n');
  const r = cli(dir, ['--mapa']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout).ilegiveis, []);
  fs.rmSync(dir, { recursive: true, force: true });
});
