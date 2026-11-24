'use strict';
// H6g (15.6, D903): o SessionEnd grava o custo e o uso da sessao em .sworn/custo/<sessao>.json (lib/custo-da-sessao.js,
// pelo processo solto do custo-das-sessoes.js --gravar), com a saida verde que o H6a cortou; o custo-das-sessoes.js
// sem argumento lista.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pasta, rodar, ganchoComoProcesso } = require('./lib/comum.js');
const custo = require('../scripts/lib/custo-da-sessao.js');

/** Uma linha de transcript do modelo. */
function msg(id, model, usage, tipo) {
  return JSON.stringify({ type: tipo || 'assistant', message: { id: id, model: model, usage: usage } });
}
const U = { input_tokens: 1000, output_tokens: 1000 };

test('custo: soma o usage uma vez por id, fora o <synthetic>, o usuario e a linha torta', () => {
  const texto = [
    msg('a', 'claude-opus-5-5', U),
    msg('a', 'claude-opus-5-5', U), // o mesmo id em outra linha (a mensagem com varios blocos)
    msg('b', '<synthetic>', U),
    msg('c', 'claude-opus-5-5', U, 'user'),
    '{"usage": quebrado',
    'null',
    JSON.stringify({ type: 'assistant', message: { id: 'd', model: 'claude-opus-5-5', usage: [1] } }),
    msg('e', 'claude-opus-5-5', { input_tokens: -5, output_tokens: 'x' }),
    // o 1e999 do JSON e Infinity: nao soma
    '{"type":"assistant","message":{"id":"f","model":"claude-opus-5-5","usage":{"cache_read_input_tokens":1e999}}}',
    '"usage"',
  ].join('\n');
  const t = custo.somarTexto(texto, custo.zerado());
  assert.deepStrictEqual(t, { mensagens: 3, entrada: 1000, saida: 1000, cacheLido: 0, cacheEscrito: 0, usd: 0.024,
    semPreco: 0 });
});

test('custo: o id que falta conta cada linha; o modelo com data usa o preco do apelido', () => {
  const sem = custo.somarTexto([msg(undefined, 'claude-opus-5-5', U), msg('', 'claude-opus-5-5', U)].join('\n'),
    custo.zerado());
  assert.strictEqual(sem.mensagens, 2);
  const datado = custo.somarTexto(msg('a', 'claude-haiku-4-5-20251001', U), custo.zerado());
  assert.strictEqual(Math.round(datado.usd * 1e6), 6000, 'haiku 4.5: 1 + 5 por milhao');
});

test('custo: o modelo fora da tabela conta os tokens e vai para semPreco, nunca como preco zero', () => {
  const t = custo.somarTexto(msg('a', 'modelo-novo-9', U), custo.zerado());
  assert.deepStrictEqual([t.mensagens, t.entrada, t.usd, t.semPreco], [1, 1000, 0, 1]);
});

test('custo: a escrita do cache separa 5 min de 1 h; sem a separacao, toda ela e de 5 min', () => {
  const comSeparacao = custo.somarTexto(msg('a', 'claude-opus-5-5', { input_tokens: 0, output_tokens: 0,
    cache_read_input_tokens: 1e6, cache_creation_input_tokens: 3e6,
    cache_creation: { ephemeral_5m_input_tokens: 1e6, ephemeral_1h_input_tokens: 2e6 } }), custo.zerado());
  // opus 5.5: lido 0,20, escrita 5 min 5, escrita 1 h 8 por milhao
  assert.strictEqual(Math.round(comSeparacao.usd * 100), Math.round((0.2 + 5 + 16) * 100));
  assert.deepStrictEqual([comSeparacao.cacheLido, comSeparacao.cacheEscrito], [1e6, 3e6]);
  const semSeparacao = custo.somarTexto(msg('a', 'claude-opus-5-5', { cache_creation_input_tokens: 2e6 }),
    custo.zerado());
  assert.strictEqual(Math.round(semSeparacao.usd * 100), 1000);
  // 3 milhoes escritos, 2 de 1 h e sem o campo de 5 min: o milhao que sobra e de 5 min (16 + 5)
  const so1h = custo.somarTexto(msg('a', 'claude-opus-5-5', { cache_creation_input_tokens: 3e6,
    cache_creation: { ephemeral_1h_input_tokens: 2e6 } }), custo.zerado());
  assert.strictEqual(Math.round(so1h.usd * 100), 2100, 'sem o campo de 5 min, o resto da escrita e de 5 min');
});

test('custo: o haiku 5.5 acima de 100 mil de prompt usa a faixa de cima', () => {
  const baixo = custo.somarTexto(msg('a', 'claude-haiku-5-5', { input_tokens: 100000 }), custo.zerado());
  const alto = custo.somarTexto(msg('a', 'claude-haiku-5-5', { input_tokens: 100001 }), custo.zerado());
  assert.strictEqual(Math.round(baixo.usd * 1e6), 10000);
  assert.strictEqual(Math.round(alto.usd * 1e6), 50001);
});

test('custo: o arquivo lido em pedacos soma o mesmo que o texto inteiro (linha cortada, acento partido, CRLF, sem \\n no fim)', () => {
  const texto = [
    msg('a', 'claude-opus-5-5', U),
    JSON.stringify({ type: 'assistant', message: { id: 'b', model: 'claude-sonnet-5-5', usage: U, content: 'ação é' } }),
    msg('a', 'claude-opus-5-5', U),
    msg('c', 'claude-haiku-5-5', U) + '\r',
    msg('d', 'modelo-novo-9', U),
  ].join('\n');
  const f = path.join(pasta('custo-pedacos'), 't.jsonl');
  fs.writeFileSync(f, texto);
  const inteiro = custo.somarTexto(texto, custo.zerado());
  assert.strictEqual(inteiro.mensagens, 4);
  for (const tamanho of [1, 2, 7, 64, undefined]) {
    let leituras = 0;
    const t = comFsTrocado('readSync', function (original, fd, buf, a, b, c) {
      leituras++;
      return original(fd, buf, a, b, c);
    }, () => custo.somarArquivo(f, custo.zerado(), tamanho));
    assert.deepStrictEqual(t, inteiro, 'pedaco ' + tamanho);
    // o pedaco pedido vale: 7 bytes leem o arquivo em varias vezes; o padrao (1 MB), numa so e a do fim
    assert.strictEqual(leituras, Math.ceil(Buffer.byteLength(texto) / (tamanho || 1 << 20)) + 1, 'leituras ' + tamanho);
  }
  assert.throws(() => custo.somarArquivo(path.join(path.dirname(f), 'nao-existe.jsonl'), custo.zerado()), /ENOENT/);
});

/** Troca `fs[nome]` por `falso` durante `fn` (o lib usa o mesmo objeto fs). */
function comFsTrocado(nome, falso, fn) {
  const original = fs[nome];
  fs[nome] = function () { return falso.apply(null, [original].concat(Array.from(arguments))); };
  try { return fn(); } finally { fs[nome] = original; }
}

function erro(code) {
  return Object.assign(new Error(code + ': de ensaio'), { code: code });
}

/** A pasta de projetos do harness: o transcript da sessao, os subagentes dela e os de outra sessao. */
function transcripts(nome) {
  const dir = pasta('custo-' + nome);
  fs.writeFileSync(path.join(dir, 's1.jsonl'), msg('a', 'claude-opus-5-5', U) + '\n');
  const sub = path.join(dir, 's1', 'subagents');
  fs.mkdirSync(path.join(sub, 'workflows', 'run1'), { recursive: true });
  // o mesmo id em outro transcript conta: cada arquivo e uma conversa
  fs.writeFileSync(path.join(sub, 'agent-x.jsonl'), msg('a', 'claude-sonnet-5-5', U) + '\n');
  fs.writeFileSync(path.join(sub, 'workflows', 'run1', 'agent-y.jsonl'), msg('w', 'claude-haiku-5-5', U) + '\n');
  fs.mkdirSync(path.join(dir, 's2', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(dir, 's2', 'subagents', 'agent-z.jsonl'), msg('z', 'claude-opus-5-5', U) + '\n');
  return dir;
}

test('custo: a sessao soma o transcript e os subagentes dela (com os de workflow), nunca os de outra', () => {
  const dir = transcripts('soma');
  const t = custo.daSessao(path.join(dir, 's1.jsonl'), 's1');
  assert.strictEqual(t.mensagens, 3);
  assert.strictEqual(t.subagentes, 2);
  assert.strictEqual(t.ilegiveis, 0);
  // opus 0,024 + sonnet 5.5 0,012 + haiku 5.5 0,0006
  assert.strictEqual(t.usd, 0.0366);
  const sem = custo.daSessao(path.join(dir, 'nao-existe.jsonl'), 'nao-existe');
  assert.deepStrictEqual([sem.mensagens, sem.ilegiveis], [0, 1]);
});

test('custo: o corte soma vezes e bytes; o valor torto do estado vira zero', () => {
  assert.deepStrictEqual(custo.comCorte(undefined, 500), { vezes: 1, bytes: 500 });
  assert.deepStrictEqual(custo.comCorte({ vezes: 2, bytes: 100 }, 50), { vezes: 3, bytes: 150 });
  assert.deepStrictEqual(custo.comCorte({ vezes: 'x', bytes: -1 }, NaN), { vezes: 1, bytes: 0 });
  assert.deepStrictEqual(custo.comCorte([], 7), { vezes: 1, bytes: 7 });
});

/** Roda `fn` com o estado das sessoes numa pasta nova (o estado.js le SWORN_TMP a cada chamada). */
function comEstado(fn) {
  const tmp = pasta('custo-estado');
  const antes = process.env.SWORN_TMP;
  process.env.SWORN_TMP = tmp;
  try { return fn(tmp); } finally {
    if (antes === undefined) delete process.env.SWORN_TMP; else process.env.SWORN_TMP = antes;
  }
}

test('custo: gravar escreve o registro com a saida cortada do estado, na pasta que o git ignora', () => {
  comEstado(function (tmp) {
    fs.mkdirSync(path.join(tmp, 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'sworn', 's1.json'), JSON.stringify({ saidaCortada: { vezes: 2, bytes: 9000 } }));
    const dir = transcripts('gravar');
    const raiz = pasta('custo-gravar-raiz');
    const destino = custo.gravar(raiz, 's1', path.join(dir, 's1.jsonl'), Date.parse('2026-11-23T10:00:00Z'));
    assert.strictEqual(destino, path.join(raiz, '.sworn', 'custo', 's1.json'));
    const r = JSON.parse(fs.readFileSync(destino, 'utf8'));
    assert.deepStrictEqual([r.sessao, r.fim, r.mensagens, r.subagentes, r.usd], ['s1', '2026-11-23T10:00:00.000Z', 3, 2,
      0.0366]);
    assert.deepStrictEqual(r.saidaCortada, { vezes: 2, bytes: 9000 });
    assert.strictEqual(fs.readFileSync(path.join(raiz, '.sworn', 'custo', '.gitignore'), 'utf8'), '*\n');
    // a sessao sem estado: o corte zero; o nome torto nao grava
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(custo.gravar(raiz, 's2', path.join(dir, 's1.jsonl'), 0), 'utf8'))
      .saidaCortada, { vezes: 0, bytes: 0 });
    assert.strictEqual(custo.gravar(raiz, '../fora', path.join(dir, 's1.jsonl'), 0), null);
    assert.strictEqual(custo.gravar(raiz, 's3', '', 0), null);
    assert.ok(!fs.existsSync(path.join(raiz, '.sworn', 'fora.json')));
    // a hora que o Date nao aceita vira a de agora, sem RangeError
    for (const torta of [NaN, Infinity, 9e15, undefined, null, '0', true]) {
      const antes = Date.now();
      const fim = Date.parse(JSON.parse(fs.readFileSync(custo.gravar(raiz, 's4', path.join(dir, 's1.jsonl'), torta),
        'utf8')).fim);
      assert.ok(fim >= antes - 1000 && fim <= Date.now() + 1000, String(torta));
    }
  });
});

test('custo: o transcript que falha no meio nao soma pela metade; o que falta conta em ilegiveis', () => {
  const dir = transcripts('meio');
  const principal = path.join(dir, 's1.jsonl');
  fs.writeFileSync(principal, msg('a', 'claude-opus-5-5', U) + '\n' + msg('b', 'claude-opus-5-5', U) + '\n');
  let leituras = 0;
  const t = comFsTrocado('readSync', function (original, fd, buf, a, b, c) {
    // a 2a leitura do principal (pedaco de 1 MB: a 1a ja traz tudo; a 2a so confirmaria o fim) quebra
    if (++leituras === 2) throw erro('EIO');
    return original(fd, buf, a, b, c);
  }, () => custo.daSessao(principal, 's1'));
  assert.deepStrictEqual([t.mensagens, t.subagentes, t.ilegiveis], [2, 2, 1], 'so os 2 subagentes somam');
});

test('custo: ler devolve os registros do mais novo ao mais velho, sem o torto; a poda deixa os 200 mais novos', () => {
  comEstado(function () {
    const raiz = pasta('custo-poda');
    const p = path.join(raiz, '.sworn', 'custo');
    fs.mkdirSync(p, { recursive: true });
    for (let i = 0; i < custo.TETO; i++) {
      fs.writeFileSync(path.join(p, 'v' + i + '.json'), JSON.stringify({ sessao: 'v' + i, fim: new Date(i * 1000).toISOString() }));
      fs.utimesSync(path.join(p, 'v' + i + '.json'), new Date(i * 1000), new Date(i * 1000));
    }
    fs.writeFileSync(path.join(p, 'torto.json'), '{');
    fs.writeFileSync(path.join(p, 'sem-fim.json'), JSON.stringify({ sessao: 'x' }));
    fs.writeFileSync(path.join(p, 'fim-torto.json'), JSON.stringify({ sessao: 'x', fim: 'ontem' }));
    fs.writeFileSync(path.join(p, 'notas.txt'), 'do dono');
    const t = path.join(pasta('custo-poda-t'), 'n.jsonl');
    fs.writeFileSync(t, '');
    custo.gravar(raiz, 'nova', t, Date.parse('2030-01-01T00:00:00Z'));
    const nomes = fs.readdirSync(p);
    // 200 mais novos pela data do arquivo: a nova e os de nome valido mais novos; o outro nome fica
    assert.ok(nomes.indexOf('nova.json') !== -1);
    assert.ok(nomes.indexOf('notas.txt') !== -1);
    assert.strictEqual(nomes.filter((n) => /\.json$/.test(n)).length, custo.TETO);
    assert.ok(nomes.indexOf('v0.json') === -1 && nomes.indexOf('v1.json') === -1 && nomes.indexOf('v2.json') === -1);
    const lidos = custo.ler(raiz);
    assert.strictEqual(lidos[0].sessao, 'nova');
    assert.strictEqual(lidos[1].sessao, 'v199');
    assert.ok(lidos.every((r) => r.sessao !== 'x'));
    assert.deepStrictEqual(custo.ler(pasta('custo-vazio')), []);
  });
});

test('custo: a pasta que existe e nao se le sobe o erro; sem pasta, ou com arquivo no lugar dela, nenhum registro', () => {
  const raiz = pasta('custo-ler-erro');
  fs.mkdirSync(path.join(raiz, '.sworn'));
  fs.writeFileSync(path.join(raiz, '.sworn', 'custo'), 'arquivo, nao pasta');
  assert.deepStrictEqual(custo.ler(raiz), [], 'ENOTDIR');
  assert.throws(() => comFsTrocado('readdirSync', function () { throw erro('EACCES'); }, () => custo.ler(raiz)),
    /EACCES/);
});

test('custo: o registro que some entre a lista e o stat sai da poda, sem parar o resto', () => {
  comEstado(function () {
    const raiz = pasta('custo-poda-some');
    const p = path.join(raiz, '.sworn', 'custo');
    fs.mkdirSync(p, { recursive: true });
    for (let i = 0; i < custo.TETO + 2; i++) {
      fs.writeFileSync(path.join(p, 'v' + i + '.json'), '{}');
      fs.utimesSync(path.join(p, 'v' + i + '.json'), new Date(i * 1000), new Date(i * 1000));
    }
    const t = path.join(pasta('custo-poda-some-t'), 'n.jsonl');
    fs.writeFileSync(t, '');
    comFsTrocado('statSync', function (original, alvo, o) {
      if (path.basename(String(alvo)) === 'v100.json') throw erro('ENOENT');
      return original(alvo, o);
    }, () => custo.gravar(raiz, 'nova', t, Date.parse('2030-01-01T00:00:00Z')));
    const nomes = fs.readdirSync(p);
    // 203 de nome valido, 1 fora da conta: dos 202 contados saem os 2 mais velhos
    assert.ok(nomes.indexOf('v0.json') === -1 && nomes.indexOf('v1.json') === -1, 'a poda parou');
    assert.ok(nomes.indexOf('v2.json') !== -1 && nomes.indexOf('v100.json') !== -1 && nomes.indexOf('nova.json') !== -1);
  });
});

test('custo-das-sessoes.js: --gravar grava; sem argumento lista as ultimas e o total, dizendo que e estimativa', () => {
  const dir = transcripts('cli');
  const raiz = pasta('custo-cli');
  const env = Object.assign({}, process.env, { SWORN_TMP: pasta('custo-cli-tmp') });
  const g = rodar('scripts/custo-das-sessoes.js', ['--gravar', '--sessao=s1',
    '--transcript=' + path.join(dir, 's1.jsonl'), '--raiz=' + raiz], { env: env });
  assert.strictEqual(g.status, 0, g.stderr);
  assert.ok(fs.existsSync(path.join(raiz, '.sworn', 'custo', 's1.json')));
  const torto = rodar('scripts/custo-das-sessoes.js', ['--gravar', '--sessao=a/b',
    '--transcript=x', '--raiz=' + raiz], { env: env });
  assert.strictEqual(torto.status, 2);
  const l = rodar('scripts/custo-das-sessoes.js', [], { cwd: raiz, env: env });
  assert.strictEqual(l.status, 0, l.stderr);
  assert.match(l.stdout, /estimativa pela tabela de preco, valor de API, nao cobranca/);
  assert.match(l.stdout, /- \d{4}-\d{2}-\d{2} \d{2}:\d{2} \| s1 \| US\$ 0\.04 \| entrada 3\.000 /);
  assert.match(l.stdout, /Total da ultima \(de 1 gravada\): US\$ 0\.04/);
  const j = rodar('scripts/custo-das-sessoes.js', ['--json'],
    { cwd: raiz, env: env });
  assert.strictEqual(j.status, 0, j.stderr);
  const o = JSON.parse(j.stdout);
  assert.deepStrictEqual([o.sessoes.length, o.totalDasUltimas, o.gravadas], [1, 0.0366, 1]);
  // a sessao com corte, modelo sem preco e transcript ilegivel diz cada um; --limite corta a lista e o total
  fs.writeFileSync(path.join(raiz, '.sworn', 'custo', 's9.json'), JSON.stringify({ sessao: 's9',
    fim: '2099-01-01T12:30:00.000Z', usd: 1.5, entrada: 0, saida: 0, cacheLido: 0, cacheEscrito: 0, subagentes: 0,
    semPreco: 2, ilegiveis: 1, saidaCortada: { vezes: 3, bytes: 4096 } }));
  const dois = rodar('scripts/custo-das-sessoes.js', [], { cwd: raiz, env: env }).stdout;
  // a hora sai no relogio local de quem le; o registro guarda UTC
  const d = new Date('2099-01-01T12:30:00.000Z');
  const p2 = (v) => String(v).padStart(2, '0');
  const local = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' +
    p2(d.getMinutes());
  assert.ok(dois.indexOf('- ' + local + ' | s9 | US$ 1.50 | ') !== -1, dois);
  assert.match(dois, / \| saida da prova encurtada 3x, 4 KB que o modelo nao leu \| 2 mensagens de modelo fora da tabela de preco do sworn \(fora do total: atualize o sworn para conta-las\) \| 1 arquivo da conversa ilegivel \(fora do total\)\n- /);
  assert.match(dois, /Total das 2 ultimas \(de 2 gravadas\): US\$ 1\.54/);
  const linhaS1 = dois.split('\n').find((x) => / s1 /.test(x));
  assert.ok(linhaS1, dois);
  assert.ok(!/encurtada|fora do total/.test(linhaS1), 'sem corte nem conta de fora, sem a parte');
  const um = rodar('scripts/custo-das-sessoes.js', ['--limite=1'], { cwd: raiz, env: env }).stdout;
  assert.match(um, /Total da ultima \(de 2 gravadas\): US\$ 1\.50/);
  assert.ok(!/ s1 /.test(um), um);
  // a forma com espaco vale o mesmo; o --limite sem numero, o padrao (10: as 2 gravadas)
  assert.strictEqual(rodar('scripts/custo-das-sessoes.js', ['--limite', '1'], { cwd: raiz, env: env }).stdout, um);
  const semNumero = rodar('scripts/custo-das-sessoes.js', ['--limite', '--json'], { cwd: raiz, env: env });
  assert.strictEqual(semNumero.status, 0, semNumero.stderr);
  assert.deepStrictEqual([JSON.parse(semNumero.stdout).sessoes.length, JSON.parse(semNumero.stdout).gravadas], [2, 2]);
  const vazio = rodar('scripts/custo-das-sessoes.js', [], { cwd: pasta('custo-cli-vazio'), env: env });
  assert.strictEqual(vazio.status, 0, vazio.stderr);
  assert.match(vazio.stdout, /Nenhuma sessao gravada em \.sworn[\\/]custo ainda: cada sessao entra aqui quando fecha\. Feche esta e rode de novo\./);
  // a pasta que nao se le: uma linha que diz qual, codigo 1, sem pilha
  const quebra = path.join(pasta('custo-cli-quebra'), 'quebra.js');
  fs.writeFileSync(quebra, "const fs = require('fs'); const r = fs.readdirSync; fs.readdirSync = function (p) {" +
    " if (/custo$/.test(String(p))) throw Object.assign(new Error('EACCES: negado'), { code: 'EACCES' });" +
    ' return r.apply(fs, arguments); };\n');
  const negado = rodar('scripts/custo-das-sessoes.js', [], { cwd: raiz,
    env: Object.assign({}, env, { NODE_OPTIONS: '--require "' + quebra.replace(/\\/g, '/') + '"' }) });
  assert.strictEqual(negado.status, 1, negado.stderr);
  assert.match(negado.stderr, /^sworn: nao consegui ler \.sworn[\\/]custo: EACCES: negado\. Confira se este usuario pode ler essa pasta e rode de novo\.\n$/);
});

/** Espera o arquivo aparecer (o processo solto), ate 15 s. */
function esperar(arquivo) {
  const ate = Date.now() + 15000;
  while (!fs.existsSync(arquivo) && Date.now() < ate) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  return fs.existsSync(arquivo);
}

test('fim-sessao.js: no projeto com o sworn, o fim solta a conta e o registro aparece; sem projeto ou sem transcript, nada', () => {
  const dir = transcripts('fim');
  const projeto = pasta('custo-fim-projeto');
  fs.mkdirSync(path.join(projeto, '.claude', 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(projeto, '.claude', 'sworn', 'projeto.json'), JSON.stringify({ provaDePronto: 'node --test' }));
  const sub = path.join(projeto, 'pacote');
  fs.mkdirSync(sub);
  const env = Object.assign({}, process.env, { SWORN_TMP: pasta('custo-fim-tmp') });
  // o gancho roda neste processo: o spawn espiado diz, sem depender da ordem dos processos soltos, que sessao o fim
  // soltou (o negativo que soltasse a conta apareceria aqui mesmo que gravasse depois do controle positivo)
  const cp = require('node:child_process');
  const spawnDeVerdade = cp.spawn;
  const soltas = [];
  cp.spawn = function (cmd, args) {
    const a = Array.isArray(args) ? args : [];
    const s = a.find(function (x) { return /^--sessao=/.test(x); });
    if (s && a.some(function (x) { return /custo-das-sessoes\.js$/.test(x); })) soltas.push(s.slice('--sessao='.length));
    return spawnDeVerdade.apply(this, arguments);
  };
  const fim = (cwd, e) => {
    const r = ganchoComoProcesso('scripts/fim-sessao.js', Object.assign({ hook_event_name: 'SessionEnd', reason: 'other',
      cwd: cwd }, e), { cwd: cwd, env: env });
    assert.strictEqual(r.status, 0, r.stderr);
  };
  // de uma subpasta do projeto: o registro vai para a raiz dele
  fim(sub, { session_id: 's1', transcript_path: path.join(dir, 's1.jsonl') });
  const gravado = path.join(projeto, '.sworn', 'custo', 's1.json');
  assert.ok(esperar(gravado), 'o processo solto nao gravou o custo');
  assert.strictEqual(JSON.parse(fs.readFileSync(gravado, 'utf8')).mensagens, 3);
  // o transcript relativo vale a partir do cwd do evento (a subpasta), nao da raiz onde o filho roda
  fim(sub, { session_id: 's7', transcript_path: path.relative(sub, path.join(dir, 's1.jsonl')) });
  const relativo = path.join(projeto, '.sworn', 'custo', 's7.json');
  assert.ok(esperar(relativo), 'o transcript relativo nao foi achado');
  // 1: os subagentes ao lado do s1.jsonl sao da sessao s1, nao da s7
  assert.strictEqual(JSON.parse(fs.readFileSync(relativo, 'utf8')).mensagens, 1);
  // sem transcript: nada
  fim(projeto, { session_id: 's2' });
  fim(projeto, { session_id: 's3', transcript_path: 7 });
  // o vazio nao vira o cwd do evento (path.resolve(cwd, '') e a propria pasta). Da subpasta: o filho que o defeito
  // soltasse leria so a pasta do projeto, pequena (da raiz do projeto, leria o tmp inteiro e seguiria vivo apos o teste)
  fim(sub, { session_id: 's8', transcript_path: '' });
  // sem projeto do sworn: nada
  const solto = pasta('custo-fim-solto');
  fim(solto, { session_id: 's4', transcript_path: path.join(dir, 's1.jsonl') });
  // o id torto: nada
  fim(projeto, { session_id: '../s5', transcript_path: path.join(dir, 's1.jsonl') });
  // controle positivo depois dos negativos: quando o s6 aparece, o processo que um negativo tivesse soltado antes dele
  // ja teve o mesmo tempo para gravar
  fim(projeto, { session_id: 's6', transcript_path: path.join(dir, 's1.jsonl') });
  assert.ok(esperar(path.join(projeto, '.sworn', 'custo', 's6.json')), 'o controle positivo nao gravou');
  cp.spawn = spawnDeVerdade;
  assert.deepStrictEqual(soltas, ['s1', 's7', 's6'], 'so as sessoes com transcript e projeto soltam a conta');
  assert.deepStrictEqual(fs.readdirSync(path.join(projeto, '.sworn', 'custo')).sort(), ['.gitignore', 's1.json', 's6.json', 's7.json']);
  assert.ok(!fs.existsSync(path.join(solto, '.sworn')));
});

// A saida do node --test (spec) verde com `n` testes, grande o bastante para o H6a cortar.
function verde(n) {
  const linhas = [];
  for (let i = 0; i < n; i++) linhas.push('✔ o caso ' + i + ' da regra confere o valor (1.2ms)');
  return linhas.concat(['ℹ tests ' + n, 'ℹ suites 0', 'ℹ pass ' + n, 'ℹ fail 0', 'ℹ cancelled 0', 'ℹ skipped 0',
    'ℹ todo 0', 'ℹ duration_ms 812.5']).join('\n');
}

test('recibo-da-prova.js: cada saida que o H6a corta soma em saidaCortada os bytes que o modelo nao leu', () => {
  const projeto = pasta('custo-recibo');
  fs.mkdirSync(path.join(projeto, '.claude', 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(projeto, '.claude', 'sworn', 'projeto.json'), JSON.stringify({ provaDePronto: 'node --test' }));
  const tmp = pasta('custo-recibo-tmp');
  const rodada = (saida) => {
    const r = ganchoComoProcesso('scripts/recibo-da-prova.js', { session_id: 'r1', cwd: projeto,
      hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'node --test' },
      tool_response: { stdout: saida, stderr: '', interrupted: false, isImage: false } },
    { cwd: projeto, env: Object.assign({}, process.env, { SWORN_TMP: tmp, SWORN_PONTE: '' }) });
    assert.strictEqual(r.status, 0, r.stderr);
    return r.json;
  };
  const estado = () => JSON.parse(fs.readFileSync(path.join(tmp, 'sworn', 'r1.json'), 'utf8'));
  const grande = verde(120);
  const r = rodada(grande);
  const visto = Buffer.byteLength(r.hookSpecificOutput.updatedToolOutput.stdout);
  assert.deepStrictEqual(estado().saidaCortada, { vezes: 1, bytes: Buffer.byteLength(grande) - visto });
  // a saida pequena nao corta: o campo fica como estava
  assert.strictEqual(rodada(verde(2)), null);
  assert.strictEqual(estado().saidaCortada.vezes, 1);
  rodada(grande);
  assert.deepStrictEqual(estado().saidaCortada, { vezes: 2, bytes: 2 * (Buffer.byteLength(grande) - visto) });
});

test('estado.js: a saidaCortada vale a sessao inteira (o fecho a carrega de turno em turno)', () => {
  assert.ok(require('../scripts/lib/estado.js').CAMPOS_DA_SESSAO.indexOf('saidaCortada') !== -1);
});
