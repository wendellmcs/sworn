'use strict';
// Colheita 10-20, item 10 (D674): o gancho de entrada grava os pedidos do dono numa lista numerada por frente, e o
// /sworn:handoff le a lista. Nada que o dono pediu se perde entre chats; hoje depende de o agente lembrar.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const comum = require('./lib/comum.js');

const pedidos = require('../scripts/lib/pedidos.js');
const retomar = require('../scripts/lib/retomar.js');
const projeto = require('../scripts/lib/projeto.js');

const RAIZ = path.join(__dirname, '..');
// hora local, como o resumo da volta (retomar.js, dia/hora)
const AGORA = new Date(2026, 9, 25, 13, 5).getTime();
const CHAVE = 'sk-' + 'ant-api03-' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4';

function pasta(comSworn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-pedidos-'));
  if (comSworn) fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
  return { dir: dir, fim: function () { fs.rmSync(dir, { recursive: true, force: true }); } };
}
function lista(dir, nome) {
  return fs.readFileSync(path.join(dir, '.claude', 'sworn', 'pedidos', nome + '.md'), 'utf8');
}

test('item 10: registrar numera os pedidos por frente, com data e hora', () => {
  const t = pasta(true);
  try {
    assert.strictEqual(pedidos.registrar(t.dir, 'minha-frente', 'publica a versao', AGORA),
      '.claude/sworn/pedidos/minha-frente.md');
    pedidos.registrar(t.dir, 'minha-frente', 'e manda o resumo', AGORA + 60000);
    const texto = lista(t.dir, 'minha-frente');
    assert.match(texto, /^# Pedidos do dono - minha-frente\n/);
    assert.match(texto, /^1\. 2026-10-25 13:05 - publica a versao$/m);
    assert.match(texto, /^2\. 2026-10-25 13:06 - e manda o resumo$/m);
    assert.strictEqual(pedidos.ler(t.dir, 'minha-frente'), texto);
  } finally { t.fim(); }
});

// Revisao cega do lote 2 (s157): lista que existe e nao se le nao e lista nova.
test('item 10: lista que existe e nao se le lanca, sem recomecar do 1 nem repetir o cabecalho', () => {
  const t = pasta(true);
  const ler = fs.readFileSync;
  try {
    pedidos.registrar(t.dir, 'f', 'primeiro', AGORA);
    const arq = path.join(t.dir, '.claude', 'sworn', 'pedidos', 'f.md');
    fs.readFileSync = function (p) {
      if (path.resolve(String(p)) === path.resolve(arq)) { const e = new Error('ocupado'); e.code = 'EBUSY'; throw e; }
      return ler.apply(fs, arguments);
    };
    assert.throws(function () { pedidos.registrar(t.dir, 'f', 'segundo', AGORA); }, /ocupado/);
    fs.readFileSync = ler;
    assert.strictEqual(lista(t.dir, 'f').split('# Pedidos do dono').length - 1, 1, 'cabecalho uma vez so');
    assert.ok(!/^1\. .* - segundo$/m.test(lista(t.dir, 'f')), 'nada gravado com o numero 1 de novo');
  } finally { fs.readFileSync = ler; t.fim(); }
});

// A5-46: a lista que existe vazia ganha o titulo; A5-47: horario que nao e numero vale o relogio, nunca NaN.
test('H1: lista vazia ganha o titulo e horario invalido vira a hora de agora', () => {
  const t = pasta(true);
  try {
    fs.mkdirSync(path.join(t.dir, '.claude', 'sworn', 'pedidos'), { recursive: true });
    fs.writeFileSync(path.join(t.dir, '.claude', 'sworn', 'pedidos', 'f.md'), '');
    pedidos.registrar(t.dir, 'f', 'primeiro', AGORA);
    assert.strictEqual(lista(t.dir, 'f'), '# Pedidos do dono - f\n\n1. 2026-10-25 13:05 - primeiro\n');
    // o carimbo do relogio, escrito como a lista escreve (hora local), sem converter de volta (o horario de verao
    // repete uma hora, e a conversao de volta erraria por 1 h)
    const carimbo = function (d) {
      const dois = function (n) { return String(n).padStart(2, '0'); };
      return d.getFullYear() + '-' + dois(d.getMonth() + 1) + '-' + dois(d.getDate()) + ' ' + dois(d.getHours()) + ':' +
        dois(d.getMinutes());
    };
    // null e '' tambem: o isFinite global os leria como 0 (1970); 1e17 e finito mas fora da faixa de datas
    for (const [i, agora] of [NaN, undefined, Infinity, 'x', null, '', 1e17, -1e17].entries()) {
      const antes = carimbo(new Date());
      pedidos.registrar(t.dir, 'g', 'pedido ' + i, agora);
      const depois = carimbo(new Date());
      const linha = lista(t.dir, 'g').split('\n').filter(function (l) { return / - pedido /.test(l); }).pop();
      const m = /^\d+\. (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) - pedido (\d+)$/.exec(linha);
      assert.ok(m && m[2] === String(i), linha);
      // o registro que cruza a virada do minuto cai num dos dois
      assert.ok(m[1] === antes || m[1] === depois, JSON.stringify(agora) + ' -> ' + linha);
    }
  } finally { t.fim(); }
});

test('item 10: sem .claude/sworn/ nada se grava (projeto sem sworn nao e poluido)', () => {
  const t = pasta(false);
  try {
    assert.strictEqual(pedidos.registrar(t.dir, 'f', 'oi', AGORA), null);
    assert.strictEqual(fs.existsSync(path.join(t.dir, '.claude')), false);
    assert.strictEqual(pedidos.ler(t.dir, 'f'), null);
  } finally { t.fim(); }
});

test('item 10: o texto sai limpo, mascarado e cortado; vazio nao vira pedido', () => {
  const t = pasta(true);
  try {
    pedidos.registrar(t.dir, 'f', '<system-reminder>lembrete do harness</system-reminder> usa ' + CHAVE + ' aqui', AGORA);
    pedidos.registrar(t.dir, 'f', 'x'.repeat(900), AGORA);
    assert.strictEqual(pedidos.registrar(t.dir, 'f', '<system-reminder>so isto</system-reminder>  ', AGORA), null);
    assert.strictEqual(pedidos.registrar(t.dir, 'f', 42, AGORA), null);
    const texto = lista(t.dir, 'f');
    assert.match(texto, /^1\. 2026-10-25 13:05 - usa \[segredo omitido\] aqui$/m);
    assert.ok(texto.indexOf('lembrete do harness') === -1 && texto.indexOf(CHAVE) === -1);
    const dois = texto.split('\n').filter(function (l) { return /^2\. /.test(l); })[0];
    // R3a: a linha segue cortada em 600 e aponta o arquivo com o texto inteiro
    assert.strictEqual(dois, '2. 2026-10-25 13:05 - ' + 'x'.repeat(597) + '... (inteiro em .claude/sworn/pedidos/f/2.md)');
    assert.strictEqual(texto.split('\n').filter(function (l) { return /^\d+\. /.test(l); }).length, 2);
  } finally { t.fim(); }
});

test('R3a (D833): o pedido longo vai inteiro, com as quebras de linha e mascarado, para <lista>/<n>.md', () => {
  const t = pasta(true);
  try {
    const longo = 'Primeira linha do pedido.\r\n\r\n\r\n- item um com ' + CHAVE + '\n- item dois\n' + 'fim '.repeat(200) +
      '<system-reminder>lembrete</system-reminder> ultima palavra';
    pedidos.registrar(t.dir, 'f', 'curto', AGORA);
    pedidos.registrar(t.dir, 'f', longo, AGORA + 60000);
    const inteiro = fs.readFileSync(path.join(t.dir, '.claude', 'sworn', 'pedidos', 'f', '2.md'), 'utf8');
    assert.match(inteiro, /^# Pedido 2 - 2026-10-25 13:06\n\nPrimeira linha do pedido\.\n\n- item um com \[segredo omitido\]\n- item dois\n/);
    assert.match(inteiro, /ultima palavra\n$/, 'nada se perde no fim');
    assert.ok(inteiro.indexOf(CHAVE) === -1 && inteiro.indexOf('lembrete') === -1);
    assert.ok(!fs.existsSync(path.join(t.dir, '.claude', 'sworn', 'pedidos', 'f', '1.md')), 'o curto nao ganha arquivo');
    assert.match(lista(t.dir, 'f'), /^2\. 2026-10-25 13:06 - Primeira linha .*\.\.\. \(inteiro em \.claude\/sworn\/pedidos\/f\/2\.md\)$/m,
      'a linha aponta o arquivo');
    // exatamente 600 cabe na linha; 601 ja vai inteiro para o arquivo
    pedidos.registrar(t.dir, 'g', 'y'.repeat(600), AGORA);
    pedidos.registrar(t.dir, 'g', 'z'.repeat(601), AGORA);
    assert.match(lista(t.dir, 'g'), /^1\. 2026-10-25 13:05 - y{600}$/m);
    assert.ok(fs.existsSync(path.join(t.dir, '.claude', 'sworn', 'pedidos', 'g', '2.md')));
    assert.ok(!fs.existsSync(path.join(t.dir, '.claude', 'sworn', 'pedidos', 'g', '1.md')));
    // o espaco que nao e o comum (NBSP, tab) tambem se junta, e a linha so de espaco conta como vazia
    const nb = String.fromCharCode(160);
    const tab = String.fromCharCode(9);
    const nl = String.fromCharCode(10);
    pedidos.registrar(t.dir, 'h', 'a' + nb + tab + nb + 'b' + nl + nb + nl + tab + nl + nb + nl + 'c ' + 'w'.repeat(700), AGORA);
    const h = fs.readFileSync(path.join(t.dir, '.claude', 'sworn', 'pedidos', 'h', '1.md'), 'utf8');
    assert.match(h, /^# Pedido 1 - [^\n]+\n\na b\n\nc w{700}\n$/);
  } finally { t.fim(); }
});

test('R3a (D833): o texto do dono que ja termina como marca de estado nao passa por pedido fechado', () => {
  const t = pasta(true);
  try {
    // o pedido que e so a marca: o separador " - " da linha da o espaco que a marca pede, e ele tambem fica aberto
    pedidos.registrar(t.dir, 's', '[feito: nada]', AGORA);
    assert.match(lista(t.dir, 's'), /^1\. 2026-10-25 13:05 - \[feito: nada\] \(texto do dono\)$/m);
    assert.deepStrictEqual(pedidos.abertos(t.dir, 's').map((a) => a.n), [1]);
    pedidos.registrar(t.dir, 'f', 'ajuste o rodape [feito: ontem]', AGORA);
    assert.match(lista(t.dir, 'f'), /^1\. 2026-10-25 13:05 - ajuste o rodape \[feito: ontem\] \(texto do dono\)$/m);
    assert.deepStrictEqual(pedidos.abertos(t.dir, 'f').map((a) => a.n), [1]);
    // os outros dois estados tambem; o que so parece marca (estado desconhecido) fica como o dono escreveu
    pedidos.registrar(t.dir, 'f', 'nao mude [recusado: D1]', AGORA);
    pedidos.registrar(t.dir, 'f', 'por que? [respondido: sim]', AGORA);
    pedidos.registrar(t.dir, 'f', 'veja [pronto: x]', AGORA);
    const texto = lista(t.dir, 'f');
    assert.match(texto, /^2\. .* \[recusado: D1\] \(texto do dono\)$/m);
    assert.match(texto, /^3\. .* \[respondido: sim\] \(texto do dono\)$/m);
    assert.match(texto, /^4\. 2026-10-25 13:05 - veja \[pronto: x\]$/m);
    assert.deepStrictEqual(pedidos.abertos(t.dir, 'f').map((a) => a.n), [1, 2, 3, 4]);
  } finally { t.fim(); }
});

test('R3b (D833): o prompt de handoff colado entra marcado, sem numero, e nao conta como pedido', () => {
  const t = pasta(true);
  try {
    const colado = 'Retomando o projeto. Leia .sworn/handoff/2026-11-10-frente-s485-handoff.md inteiro. ' + 'contexto '.repeat(40);
    pedidos.registrar(t.dir, 'f', 'primeiro pedido', AGORA);
    pedidos.registrar(t.dir, 'f', colado, AGORA + 60000);
    pedidos.registrar(t.dir, 'f', 'segundo pedido', AGORA + 120000);
    const texto = lista(t.dir, 'f');
    assert.match(texto, /^- 2026-10-25 13:06 - \[prompt de handoff colado: \.sworn\/handoff\/2026-11-10-frente-s485-handoff\.md, \d+ caracteres; nao conta como pedido; texto em \.claude\/sworn\/pedidos\/f\/colado-1\.md\]$/m);
    // o tamanho e o do texto limpo que chegou (o espaco do fim sai na limpeza)
    assert.ok(texto.indexOf('.md, ' + retomar.limpar(colado).length + ' caracteres;') !== -1, 'o tamanho certo');
    assert.strictEqual(retomar.limpar(colado).length, colado.length - 1);
    assert.match(texto, /^2\. 2026-10-25 13:07 - segundo pedido$/m, 'a numeracao nao conta o prompt colado');
    assert.ok(texto.indexOf('contexto contexto') === -1, 'o prompt colado nao entra inteiro na lista');
    // o texto colado fica guardado ao lado: se era um pedido de verdade que so citava um handoff, nada se perde
    const guardado = fs.readFileSync(path.join(t.dir, '.claude', 'sworn', 'pedidos', 'f', 'colado-1.md'), 'utf8');
    assert.ok(guardado.startsWith('# Prompt colado 1 - 2026-10-25 13:06\n\nRetomando o projeto.') && /contexto\n$/.test(guardado), guardado);
    // o segundo colado tem o seu arquivo, e o segredo colado sai mascarado no arquivo e na linha
    pedidos.registrar(t.dir, 'f', colado + ' a chave e ' + CHAVE + ' e o handoff/' + CHAVE + '.md', AGORA);
    const segundo = fs.readFileSync(path.join(t.dir, '.claude', 'sworn', 'pedidos', 'f', 'colado-2.md'), 'utf8');
    assert.ok(segundo.indexOf(CHAVE) === -1 && segundo.indexOf('[segredo omitido]') !== -1, segundo);
    assert.ok(lista(t.dir, 'f').indexOf(CHAVE) === -1, 'nem na linha');
    // o segredo no proprio caminho citado (o que vai para a linha) tambem sai mascarado
    pedidos.registrar(t.dir, 'f', 'Leia handoff/' + CHAVE + '.md agora. ' + 'contexto '.repeat(40), AGORA);
    assert.ok(lista(t.dir, 'f').indexOf(CHAVE) === -1, 'o caminho citado com o segredo');
    assert.match(lista(t.dir, 'f'), /\[prompt de handoff colado: handoff\/\[segredo omitido\]\.md, /);
    // o limite e "mais de 300": 300 caracteres que citam um handoff ainda sao pedido; 301 ja e prompt colado
    const base = 'Leia .sworn/handoff/x-handoff.md ';
    assert.strictEqual(pedidos.ehPromptDeHandoff(base + 'a'.repeat(300 - base.length)), false);
    assert.strictEqual(pedidos.ehPromptDeHandoff(base + 'a'.repeat(301 - base.length)), true);
    // curto que cita um handoff, ou longo sem handoff, segue sendo pedido; o que nao e texto, nao e prompt colado
    assert.strictEqual(pedidos.ehPromptDeHandoff('grave o handoff.md agora'), false);
    assert.strictEqual(pedidos.ehPromptDeHandoff('x '.repeat(200)), false);
    assert.strictEqual(pedidos.ehPromptDeHandoff(colado), true);
    assert.strictEqual(pedidos.ehPromptDeHandoff('Leia C:\\proj\\.context\\plans\\2026-11-10-esquadro-s485-handoff.md. ' + 'a'.repeat(300)), true);
    assert.strictEqual(pedidos.ehPromptDeHandoff(undefined), false);
    assert.strictEqual(pedidos.ehPromptDeHandoff(42), false);
  } finally { t.fim(); }
});

test('item 10: sem frente, ou com nome que nao serve de arquivo, vai para sem-frente', () => {
  const t = pasta(true);
  try {
    assert.strictEqual(pedidos.registrar(t.dir, null, 'um', AGORA), '.claude/sworn/pedidos/sem-frente.md');
    assert.strictEqual(pedidos.registrar(t.dir, '../fora', 'dois', AGORA), '.claude/sworn/pedidos/sem-frente.md');
    assert.match(lista(t.dir, 'sem-frente'), /^2\. 2026-10-25 13:05 - dois$/m);
    assert.strictEqual(fs.existsSync(path.join(t.dir, '.claude', 'fora.md')), false);
  } finally { t.fim(); }
});

test('item 10: chave pedidos - ligada por padrao, so o booleano false desliga', () => {
  assert.ok(projeto.CHAVES_LIGA_DESLIGA.indexOf('pedidos') !== -1);
  assert.strictEqual(pedidos.ligada(null), true);
  assert.strictEqual(pedidos.ligada({}), true);
  assert.strictEqual(pedidos.ligada({ pedidos: 'false' }), true, 'texto nao desliga (D388)');
  assert.strictEqual(pedidos.ligada({ pedidos: false }), false);
});

test('item 10: o retomar.js exporta o limpar e o mascarar que a lista reusa', () => {
  assert.strictEqual(typeof retomar.limpar, 'function');
  assert.strictEqual(typeof retomar.mascarar, 'function');
});

function abrir(dir, sessoes, id, prompt) {
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'abrir-turno.js')], {
    cwd: dir, encoding: 'utf8',
    input: JSON.stringify({ session_id: id, cwd: dir, hook_event_name: 'UserPromptSubmit', prompt: prompt }),
    env: Object.assign({}, process.env, { SWORN_TMP: sessoes })
  });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

test('item 10: o abrir-turno grava o pedido na lista da frente vinculada; a chave false desliga', () => {
  const t = pasta(true);
  const sessoes = path.join(t.dir, 'sessoes');
  const antes = process.env.SWORN_TMP;
  try {
    process.env.SWORN_TMP = sessoes;
    require('../scripts/lib/estado.js').gravar('p1', { frente: 'frente-a' });
    const saida = abrir(t.dir, sessoes, 'p1', 'corrige o rodape');
    assert.strictEqual(saida, null, 'a lista nao muda a saida do gancho: ' + JSON.stringify(saida));
    assert.match(lista(t.dir, 'frente-a'), /^1\. \d{4}-\d\d-\d\d \d\d:\d\d - corrige o rodape$/m);
    abrir(t.dir, sessoes, 'p2', 'sem vinculo');
    assert.match(lista(t.dir, 'sem-frente'), /^1\. .* - sem vinculo$/m);
    fs.writeFileSync(path.join(t.dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify({ pedidos: false }));
    abrir(t.dir, sessoes, 'p1', 'nao grava');
    assert.ok(lista(t.dir, 'frente-a').indexOf('nao grava') === -1);
  } finally {
    if (antes === undefined) delete process.env.SWORN_TMP; else process.env.SWORN_TMP = antes;
    t.fim();
  }
});

test('R3c (D833): numeros aceita 3, 1-4 e 1-4,7, sem repetir e em ordem; o resto e null', () => {
  assert.deepStrictEqual(pedidos.numeros('3'), [3]);
  assert.deepStrictEqual(pedidos.numeros('1-3,2,5'), [1, 2, 3, 5]);
  assert.deepStrictEqual(pedidos.numeros('7,1-2'), [1, 2, 7]);
  for (const torto of ['', '0', '3-1', 'a', '1,,2', '-2', '1-', '1 2', null, 5, '1-20000', '1-10002']) {
    assert.strictEqual(pedidos.numeros(torto), null, String(torto));
  }
  // o teto da faixa: 10000 a mais que o comeco ainda passa
  assert.strictEqual(pedidos.numeros('1-10001').length, 10001);
  // o numero gigante (acima de 2^53 o laco nao andaria) e recusado na hora; o teto e 1.000.000
  for (const gigante of ['99999999999999999999', '9007199254740993', '1000001', '999999-1000001']) {
    assert.strictEqual(pedidos.numeros(gigante), null, gigante);
  }
  assert.deepStrictEqual(pedidos.numeros('1000000'), [1000000]);
});

test('R3c (D833): abertos lista os numerados sem marca; marcar poe e troca a marca na linha', () => {
  const t = pasta(true);
  try {
    assert.deepStrictEqual(pedidos.abertos(t.dir, 'f'), [], 'lista que nao existe');
    for (const p of ['algo rodando?', 'grave o pedido inteiro', 'mude o idioma']) pedidos.registrar(t.dir, 'f', p, AGORA);
    pedidos.registrar(t.dir, 'f', 'Leia .sworn/handoff/x-handoff.md. ' + 'a'.repeat(400), AGORA);
    assert.deepStrictEqual(pedidos.abertos(t.dir, 'f').map((a) => a.n), [1, 2, 3], 'o prompt colado nao e pedido aberto');
    const r = pedidos.marcar(t.dir, 'f', '1,3,9', 'respondido', 'pergunta de [estado]\nrespondida');
    assert.deepStrictEqual(r, { marcados: [1, 3], faltaram: [9] });
    assert.match(lista(t.dir, 'f'), /^1\. 2026-10-25 13:05 - algo rodando\? \[respondido: pergunta de estado respondida\]$/m);
    assert.deepStrictEqual(pedidos.abertos(t.dir, 'f').map((a) => a.n), [2]);
    pedidos.marcar(t.dir, 'f', '3', 'feito', 'commit abc1234 com ' + CHAVE);
    const texto = lista(t.dir, 'f');
    assert.match(texto, /^3\. 2026-10-25 13:05 - mude o idioma \[feito: commit abc1234 com segredo omitido\]$/m, 'troca a marca, mascara');
    assert.ok(texto.indexOf(CHAVE) === -1);
    assert.strictEqual(texto.split('[respondido').length - 1, 1, 'a marca antiga do 3 saiu');
    // a marca com o segredo mascarado segue sendo marca: o 3 nao volta a ficar aberto, e marcar de novo troca
    assert.deepStrictEqual(pedidos.abertos(t.dir, 'f').map((a) => a.n), [2]);
    pedidos.marcar(t.dir, 'f', '3', 'recusado', 'D999');
    assert.match(lista(t.dir, 'f'), /^3\. 2026-10-25 13:05 - mude o idioma \[recusado: D999\]$/m);
    const final = lista(t.dir, 'f');
    assert.match(final, /^- 2026-10-25 13:05 - \[prompt de handoff colado/m, 'a linha marcada fica');
    assert.match(final, /^# Pedidos do dono - f\n/);
    assert.throws(() => pedidos.marcar(t.dir, 'f', '2', 'pronto', 'x'), /o estado e um destes/);
    assert.throws(() => pedidos.marcar(t.dir, 'f', '2', 'feito', '  '), /falta a evidencia/);
    // a evidencia so de colchetes vira vazia depois de tirar os colchetes, e lanca tambem
    assert.throws(() => pedidos.marcar(t.dir, 'f', '2', 'feito', '[]'), /falta a evidencia/);
    assert.strictEqual(lista(t.dir, 'f'), final, 'o erro de uso nao mexe na lista');
    assert.throws(() => pedidos.marcar(t.dir, 'f', 'dois', 'feito', 'x'), /os numeros vao como/);
    assert.ok(!fs.readdirSync(path.join(t.dir, '.claude', 'sworn', 'pedidos')).some((n) => /\.tmp$/.test(n)), 'sem sobra do arquivo temporario');
  } finally { t.fim(); }
});

test('R3c (D833): o gancho espera a trava do marcar, e o pedido que chega no meio da troca nao some', async () => {
  const t = pasta(true);
  try {
    pedidos.registrar(t.dir, 'f', 'primeiro', AGORA);
    const arq = path.join(t.dir, '.claude', 'sworn', 'pedidos', 'f.md');
    // este processo faz o papel do marcar: trava, le a lista e so a troca depois que o gancho (outro processo) ja tentou
    // gravar. Sem a trava no gancho, o pedido 2 entraria antes da troca e a troca o apagaria.
    fs.writeFileSync(arq + '.trava', '');
    const lido = lista(t.dir, 'f');
    const codigo = 'require(' + JSON.stringify(path.join(RAIZ, 'scripts', 'lib', 'pedidos.js')) + ').registrar(' +
      JSON.stringify(t.dir) + ", 'f', 'chegou no meio', " + (AGORA + 60000) + ')';
    // o filho avisa logo antes de chamar o registrar; daqui a troca espera mais 300 ms, tempo de sobra para o gancho
    // sem trava gravar antes dela (o vermelho que o teste quer ver), qualquer que seja a demora para o filho subir
    const filho = require('node:child_process').spawn(process.execPath, ['-e', "process.stdout.write('pronto\\n');" + codigo],
      { stdio: ['ignore', 'pipe', 'ignore'] });
    const fim = new Promise((resolve) => filho.on('exit', resolve));
    await new Promise((resolve) => filho.stdout.once('data', resolve));
    await new Promise((resolve) => setTimeout(resolve, 300));
    fs.writeFileSync(arq + '.tmp', lido.replace(/primeiro\n/, 'primeiro [feito: abc]\n'));
    fs.renameSync(arq + '.tmp', arq);
    fs.rmSync(arq + '.trava');
    assert.strictEqual(await fim, 0);
    assert.match(lista(t.dir, 'f'), /^1\. 2026-10-25 13:05 - primeiro \[feito: abc\]\n2\. 2026-10-25 13:06 - chegou no meio\n$/m);
  } finally { t.fim(); }
});

test('R3c (D833): a trava ocupada barra o marcar; a velha e tomada; o gancho grava mesmo sem ela; nada fica para tras', () => {
  const t = pasta(true);
  const trocar = fs.renameSync;
  try {
    pedidos.registrar(t.dir, 'f', 'primeiro', AGORA);
    const arq = path.join(t.dir, '.claude', 'sworn', 'pedidos', 'f.md');
    const sobras = () => fs.readdirSync(path.join(t.dir, '.claude', 'sworn', 'pedidos')).filter((n) => /\.(tmp|trava)$/.test(n));
    // trava de outro processo, nova: o marcar desiste em 2 s e a lista fica como estava
    fs.writeFileSync(arq + '.trava', '');
    const antes = lista(t.dir, 'f');
    assert.throws(() => pedidos.marcar(t.dir, 'f', '1', 'feito', 'abc'), /a lista de pedidos esta ocupada/);
    assert.strictEqual(lista(t.dir, 'f'), antes);
    // o gancho, com a mesma trava nova, espera o prazo e grava assim mesmo: o pedido do dono nao se perde
    pedidos.registrar(t.dir, 'f', 'segundo', AGORA);
    assert.match(lista(t.dir, 'f'), /^2\. .* - segundo$/m);
    assert.ok(fs.existsSync(arq + '.trava'), 'a trava dos outros nao e dele para soltar');
    // a trava velha (processo que morreu sem soltar) e tomada, e o marcar a solta no fim
    const velho = new Date(Date.now() - 60000);
    fs.utimesSync(arq + '.trava', velho, velho);
    assert.deepStrictEqual(pedidos.marcar(t.dir, 'f', '1', 'feito', 'abc'), { marcados: [1], faltaram: [] });
    assert.deepStrictEqual(sobras(), []);
    // a troca que falha lanca, nao deixa .tmp nem .trava, e a lista fica como estava
    const depois = lista(t.dir, 'f');
    fs.renameSync = function () { const e = new Error('ocupado'); e.code = 'EPERM'; throw e; };
    assert.throws(() => pedidos.marcar(t.dir, 'f', '2', 'feito', 'abc'), /ocupado/);
    fs.renameSync = trocar;
    assert.deepStrictEqual(sobras(), []);
    assert.strictEqual(lista(t.dir, 'f'), depois, 'a lista ficou como estava');
  } finally { fs.renameSync = trocar; t.fim(); }
});

test('R3c (D833): a trava velha que nao se apaga cai no prazo, sem girar; a falha de permissao diz a causa', () => {
  const t = pasta(true);
  const abrir = fs.openSync;
  try {
    pedidos.registrar(t.dir, 'f', 'primeiro', AGORA);
    const arq = path.join(t.dir, '.claude', 'sworn', 'pedidos', 'f.md');
    // uma pasta no lugar da trava, velha: o rm sem recursive falha sempre (como a trava que outro processo segura)
    fs.mkdirSync(arq + '.trava');
    const velho = new Date(Date.now() - 60000);
    fs.utimesSync(arq + '.trava', velho, velho);
    const inicio = Date.now();
    pedidos.registrar(t.dir, 'f', 'segundo', AGORA);
    assert.ok(Date.now() - inicio < 6000, 'o gancho voltou em ' + (Date.now() - inicio) + ' ms');
    assert.match(lista(t.dir, 'f'), /^2\. .* - segundo$/m, 'e gravou assim mesmo');
    assert.throws(() => pedidos.marcar(t.dir, 'f', '1', 'feito', 'abc'), /a lista de pedidos esta ocupada/);
    fs.rmdirSync(arq + '.trava');
    // sem permissao para criar a trava: o marcar diz a causa (nao "ocupada"); o gancho grava assim mesmo
    fs.openSync = function (p, flag) {
      if (/\.trava$/.test(String(p))) { const e = new Error('EACCES: sem permissao'); e.code = 'EACCES'; throw e; }
      return abrir.apply(fs, arguments);
    };
    assert.throws(() => pedidos.marcar(t.dir, 'f', '1', 'feito', 'abc'), /EACCES/);
    pedidos.registrar(t.dir, 'f', 'terceiro', AGORA);
    fs.openSync = abrir;
    assert.match(lista(t.dir, 'f'), /^3\. .* - terceiro$/m);
    assert.deepStrictEqual(pedidos.abertos(t.dir, 'f').map((a) => a.n), [1, 2, 3]);
  } finally { fs.openSync = abrir; t.fim(); }
});

test('R3a (D833): o arquivo ao lado nunca e sobrescrito, e a lista que nao se le lanca em vez de parecer vazia', () => {
  const t = pasta(true);
  try {
    const dir = path.join(t.dir, '.claude', 'sworn', 'pedidos');
    pedidos.registrar(t.dir, 'f', 'antigo ' + 'a'.repeat(700), AGORA);
    pedidos.registrar(t.dir, 'f', 'Leia handoff/x-handoff.md. ' + 'velho '.repeat(60), AGORA);
    // a lista apagada a mao, a pasta ao lado mantida: a numeracao recomeca, e os nomes ja existem
    fs.rmSync(path.join(dir, 'f.md'));
    pedidos.registrar(t.dir, 'f', 'novo ' + 'b'.repeat(700), AGORA);
    pedidos.registrar(t.dir, 'f', 'Leia handoff/x-handoff.md. ' + 'novo '.repeat(70), AGORA);
    assert.match(fs.readFileSync(path.join(dir, 'f', '1.md'), 'utf8'), /antigo a+/);
    assert.match(fs.readFileSync(path.join(dir, 'f', '1-2.md'), 'utf8'), /novo b+/);
    assert.match(fs.readFileSync(path.join(dir, 'f', 'colado-1.md'), 'utf8'), /velho/);
    assert.match(fs.readFileSync(path.join(dir, 'f', 'colado-1-2.md'), 'utf8'), /novo novo/);
    assert.match(lista(t.dir, 'f'), /\(inteiro em \.claude\/sworn\/pedidos\/f\/1-2\.md\)$/m);
    assert.match(lista(t.dir, 'f'), /texto em \.claude\/sworn\/pedidos\/f\/colado-1-2\.md\]$/m);
    // a lista que existe e nao se le (aqui, uma pasta no lugar do arquivo) lanca, em vez de "nenhum pedido aberto"
    fs.mkdirSync(path.join(dir, 'g.md'));
    assert.throws(() => pedidos.abertos(t.dir, 'g'));
    assert.deepStrictEqual(pedidos.abertos(t.dir, 'nao-existe'), []);
  } finally { t.fim(); }
});

test('R3c (D833): o script pedidos.js lista os abertos e marca, com saida em JSON e codigo de saida', () => {
  const t = pasta(true);
  // F1g (s372): no processo do teste (comum.scriptComoProcesso), com o ambiente do teste, como o spawnSync herdava
  const rodar = (args) => comum.scriptComoProcesso(path.join(RAIZ, 'scripts', 'pedidos.js'), args,
    { cwd: t.dir, env: Object.assign({}, process.env) });
  try {
    const vazio = rodar(['--marcar', '1', 'feito', 'x', '--frente', 'f']);
    assert.strictEqual(vazio.status, 2);
    assert.match(JSON.parse(vazio.stdout).erro, /a lista de pedidos da frente "f" nao existe ainda: confira --frente/);
    pedidos.registrar(t.dir, 'f', 'um', AGORA);
    pedidos.registrar(t.dir, 'f', 'dois', AGORA);
    const a = rodar(['--abertos', '--frente', 'f']);
    assert.strictEqual(a.status, 0, a.stderr);
    assert.deepStrictEqual(JSON.parse(a.stdout).pedidos.map((p) => p.n), [1, 2]);
    const m = rodar(['--marcar', '1-3', 'feito', 'D833', '--frente', 'f']);
    assert.strictEqual(m.status, 1, 'o 3 nao existe: ' + m.stdout);
    assert.deepStrictEqual(JSON.parse(m.stdout).faltaram, [3]);
    assert.strictEqual(JSON.parse(rodar(['--abertos', '--frente', 'f']).stdout).abertos, 0);
    assert.strictEqual(rodar([]).status, 2, 'sem acao: o uso');
    assert.strictEqual(rodar(['--abertos', '--frente']).status, 2, '--frente sem valor');
    const sem = rodar(['--abertos']);
    assert.strictEqual(JSON.parse(sem.stdout).abertos, 0, 'sem frente: a lista sem-frente, que nao existe');
    // os argumentos tortos sao erro de uso (2) e nao marcam nada: a opcao no lugar da evidencia, as duas acoes, a
    // opcao desconhecida, a frente vazia, argumento a mais
    pedidos.registrar(t.dir, 'g', 'tres', AGORA);
    for (const torto of [['--marcar', '1', 'feito', '--frente', 'g'], ['--marcar', '1', 'feito', '--abertos', '--frente', 'g'],
      ['--abertos', '--frente', 'g', '--x'], ['--abertos', '--frente', ''], ['--abertos', 'demais', '--frente', 'g'],
      ['--marcar', '1', 'feito', 'a', 'b', '--frente', 'g']]) {
      const r = rodar(torto);
      assert.strictEqual(r.status, 2, torto.join(' ') + ' -> ' + r.stdout);
      assert.match(JSON.parse(r.stdout).erro, /uso: node pedidos\.js|--frente vazio/);
    }
    assert.strictEqual(pedidos.abertos(t.dir, 'g').length, 1, 'nada foi marcado');
    assert.match(JSON.parse(rodar(['--abertos', '--frente', ' ']).stdout).erro, /^--frente vazio: diga a frente/);
    // a frente que nao serve de nome de arquivo cai na lista sem-frente, nunca sai da pasta dos pedidos
    pedidos.registrar(t.dir, null, 'quatro', AGORA);
    const fora = rodar(['--abertos', '--frente', '../fora']);
    assert.strictEqual(fora.status, 0, fora.stdout);
    assert.deepStrictEqual(JSON.parse(fora.stdout).pedidos.map((p) => p.linha.replace(/^.* - /, '')), ['quatro']);
  } finally { t.fim(); }
});
