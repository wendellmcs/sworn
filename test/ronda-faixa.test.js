'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const cp = require('node:child_process');
const rf = require('../scripts/lib/ronda-faixa.js');

// V5 (D847): o andamento da revisao cega na faixa e no /sworn-review.

const MIN = 60 * 1000;
// O caminho dos vereditos como o briefing do Windows o traz (com barra invertida, "\"); o teste de rondaDoCaminho
// prova tambem o de barra normal.
const caminhoWindows = (arquivo, ronda) => 'C:\\w\\.claude\\sworn\\revisao\\' + arquivo + '\\' + ronda + '\\vereditos';
// sonnet 5.5: entrada 2, saida 10, leitura 0,10, escrita de 5 min 2,5 (US$ por milhao)
// 1000 x 2 + 2000 x 10 + 10000 x 0,1 + 20000 x 2,5 = US$ 0,073
const USO = { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 10000, cache_creation_input_tokens: 20000,
  model: 'claude-sonnet-5-5' };
const inspetor = (arquivo, ronda, inicio, fim, extra) => ({ vereditos: caminhoWindows(arquivo, ronda),
  modelo: 'claude-sonnet-5-5', inicio: inicio, fim: fim, usage: fim === null ? null : USO, ...extra });
const custa073 = (valor) => assert.ok(Math.abs(valor - 0.073) < 1e-9, 'custo ' + valor + ', esperado 0.073');

test('os limites: 30 min sem resposta (a linha diz isso) e 10 min de pausa entre lotes da mesma ronda', () => {
  assert.strictEqual(rf.PARADO_MS, 30 * MIN);
  assert.strictEqual(rf.PAUSA_MS, 10 * MIN);
});

test('rondaDoCaminho: o arquivo e a ronda, com barra invertida ou normal e com a pasta "invertida" (a ordem trocada)', () => {
  assert.deepStrictEqual(rf.rondaDoCaminho(caminhoWindows('scripts__lib__a.js', 2)), { arquivo: 'scripts/lib/a.js', ronda: 2 });
  assert.deepStrictEqual(rf.rondaDoCaminho('/w/.claude/sworn/revisao/GUIA.md/3/invertida/vereditos'),
    { arquivo: 'GUIA.md', ronda: 3 });
  // so o trecho desde "revisao" conta: espaco antes dele (na pasta do projeto) nao atrapalha
  assert.deepStrictEqual(rf.rondaDoCaminho('D:\\Meus Projetos\\p\\.claude\\sworn\\revisao\\docs__a.md\\1\\vereditos'),
    { arquivo: 'docs/a.md', ronda: 1 });
  assert.deepStrictEqual(rf.rondaDoCaminho('sem caminho'), { arquivo: null, ronda: null });
  assert.deepStrictEqual(rf.rondaDoCaminho(undefined), { arquivo: null, ronda: null });
  // caractere de controle no id nao e id do cegar.js: nao casa
  assert.deepStrictEqual(rf.rondaDoCaminho('revisao/a\u001b[2Jb/1/vereditos'), { arquivo: null, ronda: null });
  // nem espaco: o id nunca tem
  assert.deepStrictEqual(rf.rondaDoCaminho('revisao/a b/1/vereditos'), { arquivo: null, ronda: null });
});

test('curto: o nome do modelo pelo id; fora dos conhecidos, o id; sem modelo, vazio', () => {
  assert.strictEqual(rf.curto('claude-sonnet-5-5'), 'sonnet');
  assert.strictEqual(rf.curto('claude-opus-5-5[1m]'), 'opus');
  assert.strictEqual(rf.curto('outro-modelo'), 'outro-modelo');
  assert.strictEqual(rf.curto('  outro-modelo  '), 'outro-modelo');
  assert.strictEqual(rf.curto(''), '');
  assert.strictEqual(rf.curto(null), '');
});

test('custoDe: pela tabela do /sworn:calibrate, com o modelo do usage antes do do disparo', () => {
  custa073(rf.custoDe(USO, 'claude-opus-5-5'));
  // sem modelo no usage vale o do disparo; espaco, sufixo de contexto e data saem antes de procurar na tabela
  custa073(rf.custoDe({ ...USO, model: undefined }, 'claude-sonnet-5-5[1m]'));
  custa073(rf.custoDe({ ...USO, model: 'claude-sonnet-5-5-20261001' }, ''));
  custa073(rf.custoDe({ ...USO, model: ' claude-sonnet-5-5[1m] ' }, ''));
  assert.strictEqual(rf.custoDe({ ...USO, model: 'modelo-novo' }, 'claude-sonnet-5-5'), null);
  assert.strictEqual(rf.custoDe(null, 'claude-sonnet-5-5'), null);
  // "constructor" nao e modelo da tabela
  assert.strictEqual(rf.custoDe({ ...USO, model: 'constructor' }, ''), null);
});

test('linha: so com inspetor rodando; a ronda, quantos prontos de quantos, o modelo e o custo ate agora', () => {
  const agora = 10 * MIN;
  const lista = [inspetor('a.js', 2, 1000, 5000), inspetor('b.js', 2, 2000, null)];
  assert.strictEqual(rf.linha(lista, agora),
    'revisão cega, ronda 2: 1 de 2 inspetores prontos (sonnet), US$ 0,07 até agora');
  // todos prontos: nada na faixa
  assert.strictEqual(rf.linha([inspetor('a.js', 2, 1000, 5000)], agora), '');
  // nenhum pronto: custo zero
  assert.strictEqual(rf.linha([inspetor('a.js', 1, 1000, null)], agora),
    'revisão cega, ronda 1: 0 de 1 inspetor pronto (sonnet), US$ 0,00 até agora');
  // sem relogio ou lista torta: nada
  assert.strictEqual(rf.linha(lista, null), '');
  assert.strictEqual(rf.linha('lista', agora), '');
  assert.strictEqual(rf.linha([null, { inicio: 'x' }], agora), '');
  // item torto no meio de validos sai da conta sem levar os validos junto
  assert.strictEqual(rf.linha([null, 7, { inicio: 'x' }].concat(lista), agora), rf.linha(lista, agora));
});

test('linha: duas rondas no mesmo lote, sem caminho, dois modelos e pronto sem custo conhecido', () => {
  const agora = 10 * MIN;
  assert.strictEqual(rf.linha([inspetor('a.js', 1, 1000, null), inspetor('b.js', 2, 2000, null)], agora),
    'revisão cega, rondas 1 e 2: 0 de 2 inspetores prontos (sonnet), US$ 0,00 até agora');
  const sem = [{ vereditos: '', modelo: 'claude-opus-5-5', inicio: 1000, fim: null }];
  assert.strictEqual(rf.linha(sem, agora), 'revisão cega: 0 de 1 inspetor pronto (opus), US$ 0,00 até agora');
  // um sem preco na tabela e um que terminou sem o uso informado: os dois fora do total, contados
  const mistos = [inspetor('a.js', 1, 1000, 3000, { modelo: 'claude-opus-5-5', usage: { ...USO, model: 'x-1' } }),
    inspetor('b.js', 1, 1500, 4000, { usage: null }), inspetor('a.js', 1, 2000, null)];
  assert.strictEqual(rf.linha(mistos, agora),
    'revisão cega, ronda 1: 2 de 3 inspetores prontos (opus e sonnet), US$ 0,00 até agora (2 sem custo conhecido, fora do total)');
});

test('linha: o inspetor sem resposta ha 30 min nao segura a faixa; com outro rodando, aparece e aponta o /sworn-review', () => {
  const agora = 40 * MIN;
  assert.strictEqual(rf.linha([inspetor('a.js', 1, 1000, null)], agora), '');
  // lote 1 em 0: a trava, b responde em 25 min; c chega em 26 min (a ainda conta como vivo): mesmo grupo
  const lote = [inspetor('a.js', 1, 0, null), inspetor('b.js', 1, 0, 25 * MIN), inspetor('c.js', 1, 26 * MIN, null)];
  assert.strictEqual(rf.linha(lote, 31 * MIN),
    'revisão cega, ronda 1: 1 de 3 inspetores prontos (sonnet), 1 sem resposta há 30 min ou mais, US$ 0,07 até agora; ' +
    'veja /sworn-review');
  // um parado velho, sozinho, nao puxa o inspetor novo para o grupo dele
  assert.strictEqual(rf.linha([inspetor('a.js', 1, 1000, null), inspetor('b.js', 1, 35 * MIN, null)], agora),
    'revisão cega, ronda 1: 0 de 1 inspetor pronto (sonnet), US$ 0,00 até agora');
  // 1 ms antes dos 30 min ainda roda
  assert.notStrictEqual(rf.linha([inspetor('a.js', 1, 0, null)], rf.PARADO_MS - 1), '');
  assert.strictEqual(rf.linha([inspetor('a.js', 1, 0, null)], rf.PARADO_MS), '');
});

test('grupoAtual: os lotes da mesma ronda somam, de arquivos diferentes; ronda nova ou pausa longa comeca outro', () => {
  const lote1 = [inspetor('a.js', 1, 0, MIN), inspetor('b.js', 1, 0, MIN)];
  // lote 2 da mesma ronda (outro arquivo, como o /sworn:review despacha), 1 min depois do fim do lote 1: soma
  const lote2 = [inspetor('c.js', 1, 2 * MIN, null)];
  assert.strictEqual(rf.grupoAtual(rf.normalizar(lote1.concat(lote2))).length, 3);
  // ronda 2 depois de todos prontos: so ela
  const r2 = [inspetor('a.js', 2, 2 * MIN, null)];
  assert.strictEqual(rf.grupoAtual(rf.normalizar(lote1.concat(r2))).length, 1);
  // mesma ronda, mas depois da pausa: outro grupo
  const tarde = [inspetor('c.js', 1, MIN + rf.PAUSA_MS + 1, null)];
  assert.strictEqual(rf.grupoAtual(rf.normalizar(lote1.concat(tarde))).length, 1);
  // exatamente na pausa: ainda soma
  const noLimite = [inspetor('c.js', 1, MIN + rf.PAUSA_MS, null)];
  assert.strictEqual(rf.grupoAtual(rf.normalizar(lote1.concat(noLimite))).length, 3);
  // ronda nova com outro ainda rodando: mesmo grupo
  const rodando = [inspetor('a.js', 1, 0, null), inspetor('b.js', 2, MIN, null)];
  assert.strictEqual(rf.grupoAtual(rf.normalizar(rodando)).length, 2);
  // a ordem de chegada nao importa: o grupo segue o inicio
  assert.strictEqual(rf.grupoAtual(rf.normalizar(r2.concat(lote1))).length, 1);
});

test('detalhe: nenhum inspetor diz o que o comando mostra; com inspetores, agora, cada arquivo e ronda e o total', () => {
  assert.match(rf.detalhe([], 0), /^Nenhum inspetor da revisão cega rodou nesta sessão/);
  const lista = [inspetor('scripts__a.js', 1, 0, MIN), inspetor('scripts__a.js', 2, 2 * MIN, 3 * MIN),
    inspetor('GUIA.md', 2, 2 * MIN, null), { vereditos: '', modelo: 'claude-sonnet-5-5', inicio: 2 * MIN, fim: null }];
  assert.strictEqual(rf.detalhe(lista, 5 * MIN), [
    'Revisão cega nesta sessão (desde que o sworn carregou)',
    '',
    'Agora, somando os arquivos: ronda 2, 1 de 3 inspetores prontos (sonnet), US$ 0,07 até agora',
    '',
    'Por arquivo:',
    '- scripts/a.js, ronda 1: 1 de 1 inspetor pronto (sonnet), US$ 0,07',
    '- scripts/a.js, ronda 2: 1 de 1 inspetor pronto (sonnet), US$ 0,07',
    '- GUIA.md, ronda 2: 0 de 1 inspetor pronto (sonnet), US$ 0,00',
    '- arquivo não identificado (o briefing não trazia a pasta dos vereditos): 0 de 1 inspetor pronto (sonnet), US$ 0,00',
    '',
    'Total: 4 inspetores, US$ 0,15.'
  ].join('\n'));
  // nada rodando
  assert.match(rf.detalhe([inspetor('a.js', 1, 0, MIN)], 5 * MIN), /\nAgora, somando os arquivos: nenhuma ronda rodando\.\n/);
});

test('detalhe: o inspetor parado e o sem custo dizem o que fazer; sem a hora de agora, ninguem vira parado', () => {
  const lista = [inspetor('a.js', 1, 0, null), inspetor('b.js', 1, 0, MIN, { usage: null })];
  const texto = rf.detalhe(lista, 40 * MIN);
  assert.match(texto, /- a\.js, ronda 1: 0 de 1 inspetor pronto \(sonnet\), 1 sem resposta há 30 min ou mais, US\$ 0,00\n/);
  assert.match(texto, /\n\nSem resposta há 30 min ou mais: o inspetor parou e não vota\. Diga ao Claude "despache de novo o inspetor que parou": ele manda o mesmo briefing na mesma ronda\./);
  assert.match(texto, /\n\nSem custo conhecido: o inspetor terminou sem o uso informado, ou o modelo dele não está na tabela de preços do \/sworn:calibrate\. O total acima não o inclui\.$/);
  // agora que nao e numero: o que roda nao vira parado, e a linha de agora fica vazia
  const semHora = rf.detalhe([inspetor('a.js', 1, Date.now(), null)], undefined);
  assert.doesNotMatch(semHora, /sem resposta/);
  assert.match(semHora, /Agora, somando os arquivos: nenhuma ronda rodando\./);
  // nem com o comeco la atras: sem a hora de agora, a conta nao vale
  assert.doesNotMatch(rf.detalhe([inspetor('a.js', 1, -40 * MIN, null)], null), /sem resposta/);
  // lista torta: o texto de nenhum inspetor
  assert.match(rf.detalhe(null, 0), /^Nenhum inspetor/);
  assert.match(rf.detalhe('x', null), /^Nenhum inspetor/);
  assert.match(rf.detalhe([null], 5 * MIN), /^Nenhum inspetor/);
  // sem a hora do comeco, o inspetor nao entra
  assert.match(rf.detalhe([{ vereditos: caminhoWindows('a.js', 1), modelo: 'x', fim: null }], 5 * MIN), /^Nenhum inspetor/);
});

test('ronda.js: JSON com a linha; --texto com o detalhe; entrada torta, linha vazia e saida 0', () => {
  const script = path.join(__dirname, '..', 'scripts', 'ronda.js');
  const rodar = (stdin, args) => cp.spawnSync(process.execPath, [script].concat(args || []), { input: stdin, encoding: 'utf8' });
  const ent = JSON.stringify({ agora: 10 * MIN, inspetores: [inspetor('a.js', 2, 1000, null)] });
  const r = rodar(ent);
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(JSON.parse(r.stdout),
    { linha: 'revisão cega, ronda 2: 0 de 1 inspetor pronto (sonnet), US$ 0,00 até agora' });
  const t = rodar(ent, ['--texto']);
  assert.strictEqual(t.status, 0);
  assert.match(t.stdout, /^Revisão cega nesta sessão/);
  const semAgora = JSON.stringify({ inspetores: [inspetor('a.js', 2, 1000, null)] });
  for (const torta of ['', 'nao e json', '[]', 'null', '{"inspetores": "x"}', semAgora]) {
    const x = rodar(torta);
    assert.strictEqual(x.status, 0);
    assert.deepStrictEqual(JSON.parse(x.stdout), { linha: '' });
    const y = rodar(torta, ['--texto']);
    assert.strictEqual(y.status, 0);
    assert.match(y.stdout, torta === semAgora ? /^Revisão cega nesta sessão/ : /^Nenhum inspetor da revisão cega/);
  }
});
