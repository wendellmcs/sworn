'use strict';
// Bloco V (D426/D437): a novidade da semana do vigia na abertura. Aqui a unidade, com `agora` e a pasta
// injetados: nada espera dias e nada toca o disco real. A fiacao com a abertura (processo de verdade)
// esta em fiacao.test.js; a tarefa agendada que traz o arquivo esta em vigia-puxar.test.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vigia = require('../scripts/lib/vigia-local.js');

const DIA = 24 * 60 * 60 * 1000;
const AGORA = Date.UTC(2026, 9, 11, 12, 0, 0); // 2026-10-11
const LIGADO = { vigia: true };

function temp(nome) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-vigia-' + nome + '-'));
}

function novidades(dir, texto) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'novidades.md'), texto, 'utf8');
}

function lerJson(dir, nome) {
  return JSON.parse(fs.readFileSync(path.join(dir, nome), 'utf8'));
}

// H11b: grava a marca de triada da ficha do disco (o teste que quer silencio de ficha vista a usa)
function triar(dir, semana) {
  assert.deepStrictEqual(vigia.marcarTriada(dir, semana, 'teste', AGORA), { ok: true, semana: semana });
}

function aviso(dir, agora, projeto) {
  return vigia.avisoDoVigia(projeto === undefined ? LIGADO : projeto, { pasta: dir, agora: agora });
}

const RELATORIO = 'semana: 2026-10-05\n\n# Novidades da semana\n\n- Cartão novo: ação rápida\n- Segunda linha\n';

test('desligado (sem a chave, vigia:false, outro valor, sem projeto) devolve vazio e nao toca o disco', () => {
  const base = temp('desligado');
  try {
    for (const projeto of [{}, { vigia: false }, { vigia: 'sim' }, { vigia: 1 }, null, undefined, 'x', []]) {
      const dir = path.join(base, 'nao-existe');
      assert.strictEqual(vigia.avisoDoVigia(projeto, { pasta: dir, agora: AGORA }), '', JSON.stringify(projeto));
      assert.ok(!fs.existsSync(dir), 'criou a pasta com o vigia desligado: ' + JSON.stringify(projeto));
    }
    // pasta com novidade real: desligado nao le nem marca como vista
    const dir = path.join(base, 'com-arquivo');
    novidades(dir, RELATORIO);
    assert.strictEqual(vigia.avisoDoVigia({}, { pasta: dir, agora: AGORA }), '');
    assert.ok(!fs.existsSync(path.join(dir, 'visto.json')), 'marcou como visto com o vigia desligado');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('ligado() sem cwd so aceita vigia === true', () => {
  assert.strictEqual(vigia.ligado({ vigia: true }), true);
  for (const p of [{ vigia: false }, { vigia: 'true' }, {}, null, [], 'x']) assert.strictEqual(vigia.ligado(p), false);
});

// Plano 091 #10 (D559): sem a chave, o vigia liga sozinho no repositorio do proprio plugin, reconhecido pelo
// `.claude-plugin/plugin.json` com nome `sworn` na raiz do git (a 1a pasta com `.git` subindo do cwd).
function repoDoPlugin(base, nome, comoArquivo) {
  const repo = path.join(base, 'repo');
  fs.mkdirSync(path.join(repo, 'scripts', 'lib'), { recursive: true });
  if (comoArquivo) fs.writeFileSync(path.join(repo, '.git'), 'gitdir: ../outro/.git/worktrees/repo\n', 'utf8');
  else fs.mkdirSync(path.join(repo, '.git'));
  if (nome !== undefined) {
    fs.mkdirSync(path.join(repo, '.claude-plugin'));
    fs.writeFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), nome, 'utf8');
  }
  return repo;
}

test('091 #10: sem a chave, liga sozinho na raiz git do repositorio do plugin; a chave decide quando existe', () => {
  const base = temp('plugin');
  try {
    const repo = repoDoPlugin(base, '{ "name": "sworn", "version": "0.9.0" }');
    const sub = path.join(repo, 'scripts', 'lib');
    for (const projeto of [{}, null, undefined]) {
      assert.strictEqual(vigia.ligado(projeto, repo), true, 'raiz: ' + JSON.stringify(projeto));
      assert.strictEqual(vigia.ligado(projeto, sub), true, 'subpasta: ' + JSON.stringify(projeto));
    }
    // a chave declarada manda: false desliga, e valor de tipo errado segue desligado (como hoje)
    for (const p of [{ vigia: false }, { vigia: 'true' }, { vigia: 1 }]) {
      assert.strictEqual(vigia.ligado(p, repo), false, JSON.stringify(p));
    }
    assert.strictEqual(vigia.ligado({ vigia: true }, repo), true);
    // a abertura passa o cwd: a novidade aparece sem a chave
    const dir = path.join(base, 'vigia');
    novidades(dir, RELATORIO);
    const t = vigia.avisoDoVigia({}, { pasta: dir, agora: AGORA, cwd: sub });
    assert.ok(t.indexOf('sworn: vigia - novidade da semana de 2026-10-05') === 0, t);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('091 #10: fora do repositorio do plugin segue desligado sem a chave, e nao toca o disco; a worktree liga', () => {
  // [rotulo, plugin.json, .git como arquivo, liga]
  const casos = [
    ['outro nome', '{ "name": "outro-plugin" }', false, false],
    ['sem plugin.json', undefined, false, false],
    ['plugin.json invalido', '{ name: sworn', false, false],
    ['nome que nao e texto', '{ "name": ["sworn"] }', false, false],
    ['.git como arquivo (worktree)', '{ "name": "sworn" }', true, true]
  ];
  for (const [rotulo, nome, comoArquivo, esperado] of casos) {
    const base = temp('fora');
    try {
      const repo = repoDoPlugin(base, nome, comoArquivo);
      assert.strictEqual(vigia.ligado({}, repo), esperado, rotulo);
      const dir = path.join(base, 'nao-existe');
      if (!esperado) {
        assert.strictEqual(vigia.avisoDoVigia({}, { pasta: dir, agora: AGORA, cwd: repo }), '', rotulo);
        assert.ok(!fs.existsSync(dir), 'criou a pasta: ' + rotulo);
      }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  }
  // o plugin.json ACIMA da raiz git nao conta: a busca para na 1a pasta com .git
  const base = temp('acima');
  try {
    fs.mkdirSync(path.join(base, '.claude-plugin'));
    fs.writeFileSync(path.join(base, '.claude-plugin', 'plugin.json'), '{ "name": "sworn" }', 'utf8');
    const filho = path.join(base, 'filho');
    fs.mkdirSync(path.join(filho, '.git'), { recursive: true });
    assert.strictEqual(vigia.ligado({}, filho), false);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
  // cwd que nao e texto nao lanca
  for (const c of [null, 42, {}, '']) assert.strictEqual(vigia.ligado({}, c), false, JSON.stringify(c));
});

test('091 #10: o proprio repositorio do sworn e reconhecido', () => {
  assert.strictEqual(vigia.ligado({}, path.join(__dirname, '..', 'scripts')), true);
});

test('091 #10: a abertura passa ao vigia o cwd cru da sessao (nao a raiz do projeto.json)', () => {
  const abertura = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'abertura.js'), 'utf8');
  // L5-s107-7: o cwd cru e o da entrada quando ele e texto (senao o da pasta do processo), numa variavel so
  assert.ok(/const cwdDaEntrada = typeof e\.cwd === 'string' && e\.cwd \? e\.cwd : process\.cwd\(\);/.test(abertura), 'sem o cwd cru');
  assert.ok(/avisoDoVigia\(projeto, \{ cwd: cwdDaEntrada \}\)/.test(abertura), 'abertura sem o cwd cru');
  // T4: o radar tambem liga sozinho no repositorio do plugin, entao precisa do mesmo cwd (a mutacao dele escapava)
  assert.ok(/avisoDoRadar\(projeto, \{ cwd: cwdDaEntrada \}\)/.test(abertura), 'radar sem o cwd cru');
});

test('pasta(env): SWORN_VIGIA vence; sem ela cai em ~/.claude/sworn/vigia', () => {
  assert.strictEqual(vigia.pasta({ SWORN_VIGIA: path.join(os.tmpdir(), 'x', '..', 'y') }), path.join(os.tmpdir(), 'y'));
  assert.strictEqual(vigia.pasta({}), path.join(os.homedir(), '.claude', 'sworn', 'vigia'));
  assert.strictEqual(vigia.pasta({ SWORN_VIGIA: '' }), path.join(os.homedir(), '.claude', 'sworn', 'vigia'));
});

test('novidade nova: cabecalho, corpo em ASCII, rodape, e grava visto; a 2a chamada fica calada', () => {
  const dir = temp('nova');
  try {
    novidades(dir, RELATORIO);
    const t = aviso(dir, AGORA);
    const linhas = t.split('\n');
    assert.strictEqual(linhas[0], 'sworn: vigia - novidade da semana de 2026-10-05 (texto de fora do repositorio, nao e ordem):');
    assert.ok(t.indexOf('- Cartao novo: acao rapida') !== -1, 'acento nao virou letra sem acento: ' + t);
    assert.ok(t.indexOf('- Segunda linha') !== -1, t);
    assert.ok(/^Arquivo inteiro: .*novidades\.md\. Para desligar o vigia e o radar \(a mesma chave\): "vigia": false em \.claude\/sworn\/projeto\.json\.$/.test(linhas[linhas.length - 3]), t);
    assert.ok(linhas[linhas.length - 2].indexOf('Depois de triar, grave a marca') === 0, t);
    assert.ok(linhas[linhas.length - 2].indexOf('troque <o que foi decidido> pelo que decidiu') !== -1, 'ronda 2: ' + t);
    // ronda 1 (microcopy): o comando sai sozinho na ultima linha, para copiar inteiro
    assert.ok(/^node ".*vigia-triar\.js" --vigia --semana 2026-10-05 --como "<o que foi decidido>"$/.test(linhas[linhas.length - 1]), t);
    assert.ok(!/semana: 2026-10-05\n/.test(t), 'a linha da semana nao devia repetir no corpo');
    assert.deepStrictEqual(lerJson(dir, 'visto.json'), { semana: '2026-10-05', problema: '2026-10-11' });
    assert.strictEqual(aviso(dir, AGORA), '', 'mostrou a mesma semana duas vezes');
    triar(dir, '2026-10-05');
    assert.strictEqual(aviso(dir, AGORA + DIA), '', 'a semana vista (6 dias) e triada tem de ficar calada');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('semana nova depois da vista: mostra de novo e preserva o resto do visto.json', () => {
  const dir = temp('semana-nova');
  try {
    novidades(dir, RELATORIO);
    assert.ok(aviso(dir, AGORA));
    fs.writeFileSync(path.join(dir, 'visto.json'),
      JSON.stringify({ semana: '2026-10-05', problema: '2026-10-01', outro: 'fica' }));
    novidades(dir, 'semana: 2026-10-12\n\nOutra novidade\n');
    const t = aviso(dir, AGORA + 2 * DIA);
    assert.ok(t.indexOf('novidade da semana de 2026-10-12') !== -1, t);
    assert.ok(t.indexOf('Outra novidade') !== -1, t);
    // H11b: a chegada conta como o aviso do dia (o lembrete de triagem so sai a partir de amanha); o campo que a
    // abertura nao conhece fica (ronda 1: sem ele, "preserva o resto" nao era provado)
    assert.deepStrictEqual(lerJson(dir, 'visto.json'), { semana: '2026-10-12', problema: '2026-10-13', outro: 'fica' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('mais de 12 linhas de corpo: corta em 12 e diz quantas ficaram', () => {
  const dir = temp('corte');
  try {
    const corpo = [];
    for (let i = 1; i <= 20; i++) corpo.push('linha ' + i);
    corpo[5] = ''; // branca no meio: mantida como linha vazia
    novidades(dir, 'semana: 2026-10-05\n\n\n' + corpo.join('\n') + '\n\n');
    const linhas = aviso(dir, AGORA).split('\n');
    // cabecalho + 12 + corte + rodape + como triar + o comando (H11b)
    assert.strictEqual(linhas.length, 1 + 12 + 1 + 1 + 2, linhas.join('|'));
    assert.strictEqual(linhas[1], 'linha 1');
    assert.strictEqual(linhas[6], '', 'a branca do meio sumiu');
    assert.strictEqual(linhas[12], 'linha 12');
    assert.strictEqual(linhas[13], '... (+8 linhas no arquivo)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// D443 (item 4 da D442, V-9): o corte era em 200 e, na 1a novidade real (linhas de ate 359), 3 itens perderam o
// link e o "Pode mexer em". Agora a linha longa quebra no espaco em ate 3 linhas de 200 (continuacao recuada em 2);
// o que passar disso termina em ` [...]`. Nenhuma linha passa de 200.
test('D443: linha longa quebra em ate 3 linhas de 200 sem partir o link; alem disso, marca de corte', () => {
  const dir = temp('quebra');
  try {
    const url = 'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#2-1-296-novidade';
    // o link comeca na coluna 193 e atravessa a 200: o corte seco o partiria
    const real = '- **Item novo!** ' + 'palavra '.repeat(22) + url + ' Pode mexer em: hooks/mods.tsx e scripts/lib/medidor.js';
    assert.ok(real.indexOf(url) < 200 && real.indexOf(url) + url.length > 200);
    const enorme = 'x'.repeat(1000);
    novidades(dir, 'semana: 2026-10-05\n\n' + real + '\nmeio\n' + enorme + '\nfim\n');
    const linhas = aviso(dir, AGORA).split('\n');
    // so o corpo: as 3 ultimas sao o rodape (traz o caminho da pasta), o "Depois de triar" e o comando (H11b)
    for (const l of linhas.slice(1, -3)) assert.ok(l.length <= 200, l.length + ': ' + l);
    const i = linhas.indexOf('meio');
    assert.ok(i > 2, linhas.join('|'));
    const pedacos = linhas.slice(1, i);
    assert.ok(pedacos.length === 2 && pedacos[1].indexOf('  ') === 0, pedacos.join('|'));
    assert.strictEqual(pedacos.map(function (p) { return p.trim(); }).join(' '), real, 'perdeu texto ao quebrar');
    assert.ok(pedacos.some(function (p) { return p.indexOf(url) !== -1; }), 'o link foi partido: ' + pedacos.join('|'));
    const x = linhas.slice(i + 1, linhas.indexOf('fim'));
    assert.strictEqual(x.length, 3, x.join('|'));
    assert.strictEqual(x[0], 'x'.repeat(200));
    assert.strictEqual(x[2], '  ' + 'x'.repeat(192) + ' [...]');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('arquivo ausente: avisa 1 vez por dia (2a no mesmo dia calada, dia seguinte de novo)', () => {
  const base = temp('ausente');
  const dir = path.join(base, 'vigia');
  try {
    const t = aviso(dir, AGORA);
    assert.ok(t.indexOf('sworn: vigia ligado, mas nenhuma novidade chegou ainda em ') === 0, t);
    assert.ok(/ \(a tarefa agendada do vigia puxa toda segunda; se ela nunca rodou, rode-a a mao no Agendador de Tarefas do Windows\)\.$/.test(t), t);
    assert.deepStrictEqual(lerJson(dir, 'visto.json'), { problema: '2026-10-11' });
    assert.strictEqual(aviso(dir, AGORA + 3600000), '', 'repetiu no mesmo dia');
    assert.ok(aviso(dir, AGORA + DIA).indexOf('nenhuma novidade chegou') !== -1, 'dia seguinte tem de avisar de novo');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('arquivo sem a linha semana: (ou vazio) avisa que nao leu, 1 vez por dia', () => {
  for (const [nome, texto] of [['sem-semana', '# so um titulo\n\ntexto\n'], ['vazio', ''], ['data-falsa', 'semana: 2026-13-45\n\nx\n']]) {
    const dir = temp(nome);
    try {
      novidades(dir, texto);
      const t = aviso(dir, AGORA);
      // A7 (pedido 12, R1 :246 microcopy): o aviso diz o passo, como os irmaos (ausente e velha)
      assert.ok(/^sworn: vigia - nao consegui ler .*novidades\.md \(sem a linha "semana: AAAA-MM-DD" no inicio\): confira o arquivo; a tarefa agendada do vigia o regrava na proxima busca boa\.$/
        .test(t), nome + ': ' + t);
      assert.strictEqual(aviso(dir, AGORA), '', nome + ': repetiu no mesmo dia');
      assert.ok(!('semana' in lerJson(dir, 'visto.json')), nome + ': marcou semana como vista');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('novidades.md que nao e arquivo (pasta) cai no aviso de ilegivel, sem lancar', () => {
  const dir = temp('pasta-no-lugar');
  try {
    fs.mkdirSync(path.join(dir, 'novidades.md'));
    const t = aviso(dir, AGORA);
    assert.ok(/^sworn: vigia - nao consegui ler .*novidades\.md \(.+\): confira o arquivo; a tarefa agendada do vigia o regrava na proxima busca boa\.$/
      .test(t), t);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('semana ja vista e velha: 14 dias ou mais avisa (1 vez por dia); 13 dias fica calada', () => {
  const dir = temp('velha');
  try {
    novidades(dir, RELATORIO);
    assert.ok(aviso(dir, AGORA)); // marca como vista (2026-10-05)
    triar(dir, '2026-10-05'); // H11b: sem a marca, o lembrete de triagem avisaria todo dia
    const dia13 = Date.UTC(2026, 9, 18, 0, 0, 0); // 13 dias depois de 2026-10-05
    const dia14 = Date.UTC(2026, 9, 19, 0, 0, 0);
    assert.strictEqual(aviso(dir, dia13), '', '13 dias nao pode avisar');
    const t = aviso(dir, dia14);
    assert.strictEqual(t, 'sworn: vigia sem novidade desde 2026-10-05: confira a rotina na nuvem que grava o ramo ' +
      'claude/vigia e, no Agendador de Tarefas do Windows, a tarefa agendada do vigia (a que chama o vigia-puxar.js).');
    assert.strictEqual(aviso(dir, dia14 + 3600000), '', 'repetiu no mesmo dia');
    assert.ok(aviso(dir, dia14 + DIA), 'dia seguinte tem de avisar de novo');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ultima-busca com ok:false acrescenta a frase nos tres casos de problema; ok:true nao acrescenta', () => {
  const base = temp('busca');
  try {
    const busca = (dir, obj) => fs.writeFileSync(path.join(dir, 'ultima-busca.json'), JSON.stringify(obj));
    const ruim = { ok: false, quando: '2026-10-10T10:30:00.000Z', motivo: 'git fetch falhou: atenção ' + 'z'.repeat(300) };

    const a = path.join(base, 'a'); // ausente
    fs.mkdirSync(a);
    busca(a, ruim);
    const ta = aviso(a, AGORA);
    assert.ok(ta.indexOf(' Ultima busca falhou em 2026-10-10T10:30:00.000Z: git fetch falhou: atencao zzz') !== -1, ta);
    // A7-16 (pedido 12): a frase da busca que falhou termina no passo seguinte
    // A7-51: o passo diz onde ver a tarefa (o Agendador de Tarefas)
    const passo = new RegExp('z\\. Corrija a causa e rode de novo, no Agendador de Tarefas do Windows, a tarefa ' +
      'que chama o vigia-puxar\\.js\\.$');
    // F1g (s372): o corte se mede no motivo, nao no aviso inteiro, que traz o caminho da pasta (TEMP longa reprovava)
    const cortado = /: (git fetch falhou: .*?)\. Corrija a causa/.exec(ta);
    assert.ok(passo.test(ta) && cortado && cortado[1].length === 120,
      'motivo nao foi cortado em 120, ou falta o passo: ' + ta);

    const b = path.join(base, 'b'); // ilegivel
    novidades(b, 'nada\n');
    busca(b, ruim);
    assert.ok(aviso(b, AGORA).indexOf('Ultima busca falhou em') !== -1);

    const c = path.join(base, 'c'); // velha
    novidades(c, RELATORIO);
    fs.writeFileSync(path.join(c, 'visto.json'), JSON.stringify({ semana: '2026-10-05' }));
    busca(c, ruim);
    assert.ok(aviso(c, Date.UTC(2026, 9, 20)).indexOf('Ultima busca falhou em') !== -1);

    const d = path.join(base, 'd'); // ok:true: nada a acrescentar
    fs.mkdirSync(d);
    busca(d, { ok: true, quando: '2026-10-10T10:30:00.000Z', motivo: null, semana: '2026-10-05' });
    assert.ok(aviso(d, AGORA).indexOf('Ultima busca') === -1);

    // ultima-busca corrompida: o teste P16-vigia-local-r2-7, mais abaixo

    // A7-51: registro sem quando nem motivo diz que faltam, no lugar do '?'
    const f = path.join(base, 'f');
    fs.mkdirSync(f);
    busca(f, { ok: false });
    const tf = aviso(f, AGORA);
    assert.ok(tf.indexOf('?') === -1, tf);
    // A7-77: sem motivo, "Corrija a causa" ficava sem objeto; o passo e rodar a tarefa a mao para ver o erro.
    // s266 (R1): o passo diz onde achar o comando (aba Acoes da tarefa).
    assert.ok(tf.indexOf(' Ultima busca falhou (sem data registrada): sem motivo registrado. Para ver o erro, abra ' +
      'no Agendador de Tarefas do Windows a tarefa que chama o vigia-puxar.js, copie o comando da aba Acoes e ' +
      'rode-o no terminal.') !== -1, tf);
    assert.ok(tf.indexOf('Corrija') === -1, tf);
    // P2 da R1: campos vazios ou so com espaco contam como ausentes
    const g = path.join(base, 'g');
    fs.mkdirSync(g);
    busca(g, { ok: false, quando: '', motivo: '  ' });
    assert.ok(aviso(g, AGORA).indexOf(' Ultima busca falhou (sem data registrada): sem motivo registrado.') !== -1);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('visto.json corrompido (ou de outra forma) nao lanca: trata como nunca visto', () => {
  const dir = temp('corrompido');
  try {
    novidades(dir, RELATORIO);
    for (const lixo of ['{ quebrado', '[1,2]', 'null', '"x"', '']) {
      fs.writeFileSync(path.join(dir, 'visto.json'), lixo);
      const t = aviso(dir, AGORA);
      assert.ok(t.indexOf('novidade da semana de 2026-10-05') !== -1, JSON.stringify(lixo) + ' -> ' + t);
    }
    assert.deepStrictEqual(lerJson(dir, 'visto.json'), { semana: '2026-10-05', problema: '2026-10-11' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('agora invalido (NaN, Date invalido, texto) cai no relogio e nao lanca', () => {
  const dir = temp('agora-ruim');
  try {
    novidades(dir, RELATORIO);
    for (const agora of [NaN, new Date('lixo'), 'ontem', undefined, null]) {
      fs.rmSync(path.join(dir, 'visto.json'), { force: true });
      let t;
      assert.doesNotThrow(() => { t = aviso(dir, agora); });
      // ronda 1: a 1a abertura com o relogio mostra a ficha (o teste antigo aceitava qualquer texto)
      assert.ok(t.indexOf('novidade da semana de 2026-10-05') !== -1, String(agora) + ': ' + t);
    }
    fs.rmSync(path.join(dir, 'visto.json'), { force: true });
    assert.ok(aviso(dir, new Date('lixo')).indexOf('novidade da semana') !== -1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('BOM e CRLF no arquivo: a semana ainda e lida', () => {
  const dir = temp('bom');
  try {
    novidades(dir, '﻿semana: 2026-10-05\r\n\r\nLinha com CR\r\n');
    const t = aviso(dir, AGORA);
    assert.ok(t.indexOf('novidade da semana de 2026-10-05') !== -1, t);
    assert.ok(t.indexOf('\r') === -1, 'CR vazou para a saida');
    assert.ok(t.indexOf('Linha com CR') !== -1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('toda saida e ASCII imprimivel mais quebra de linha, mesmo com acento, emoji e controle no texto', () => {
  const dir = temp('ascii');
  try {
    novidades(dir, 'semana: 2026-10-05\n\nÁéîõü ç \u{1F600} “aspas”\ttab\u0007 sino\n中文\n');
    const t = aviso(dir, AGORA);
    assert.ok(t.length > 0);
    assert.ok(/^[\x20-\x7E\n]*$/.test(t), JSON.stringify(t));
    assert.ok(t.indexOf('Aeiou c') !== -1, t);
    // o mesmo vale para os avisos de problema, com caminho acentuado
    const acentuada = path.join(dir, 'pasta-ção');
    assert.ok(/^[\x20-\x7E\n]*$/.test(aviso(acentuada, AGORA)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D148: a lib do vigia e a abertura nao abrem rede', () => {
  const raiz = path.join(__dirname, '..', 'scripts');
  const lib = fs.readFileSync(path.join(raiz, 'lib', 'vigia-local.js'), 'utf8');
  const abertura = fs.readFileSync(path.join(raiz, 'abertura.js'), 'utf8');
  const rede = ['node:https', 'node:http', 'fetch(', 'XMLHttpRequest', 'node:net'];
  for (const proibido of rede.concat(['child_process'])) {
    assert.strictEqual(lib.indexOf(proibido), -1, 'lib/vigia-local.js contem ' + proibido);
  }
  for (const proibido of rede.concat(['vigia-puxar'])) {
    assert.strictEqual(abertura.indexOf(proibido), -1, 'abertura.js contem ' + proibido);
  }
  assert.ok(abertura.indexOf('vigia-local.js') !== -1, 'a abertura nao liga o vigia');
});

// ------------------------------------------------ Plano do radar, T4: o bloco do radar na abertura
// A tarefa agendada roda o vigia-puxar.js de novo com --destino <pasta do vigia>/radar, que grava ali o mesmo
// novidades.md (a ficha da semana, 1a linha `semana:`). A abertura so conta: candidatos e quantos para adotar; o
// texto da ficha (de terceiros) nao entra, quem mostra e o /sworn:radar.

const FICHA_RADAR = [
  'semana: 2026-10-19',
  '',
  '# Radar da semana',
  '',
  '## Cobertura',
  '',
  '| Camada | Cobertura | O que se leu |',
  '|---|---|---|',
  '| triagem | completa | os 3 da semana |',
  '',
  '## Achados',
  '',
  '| Camada | Achado | Origem | Grau | Quem agiu |',
  '|---|---|---|---|---|',
  '| 1 o que se vê | opencode separa allow/ask/deny | opencode README.md:10 | observado | agente |',
  '',
  '## Candidatos',
  '',
  '| Repo | Licença | Como entra | Como melhora | Esforço | Valor | Veredito |',
  '|---|---|---|---|---|---|---|',
  '| anomalyco/opencode | MIT | regras no portão de escopo | determinístico | M | médio | INSPIRAÇÃO |',
  '| cursor/plugins | MIT | gatilho no portão de fecho | barra em vez de lembrar | P | alto | adotar |',
  '| NationalSecurityAgency/ghidra | Apache-2.0 | não entra | - | P | baixo | descartar |',
  '',
  '## O que ficou sem saber',
  '',
  '| Pergunta | Estado | O que mediria |',
  '|---|---|---|',
  '| Como o opencode roda instalado | aberto | Instalar numa pasta de teste |',
  '',
  'Não li: as imagens.',
  ''
].join('\n');

function avisoRadar(base, agora, projeto) {
  return vigia.avisoDoRadar(projeto === undefined ? LIGADO : projeto, { pasta: base, agora: agora });
}

test('radar desligado (sem a chave fora do plugin, vigia:false, sem projeto) devolve vazio e nao toca o disco', () => {
  const base = temp('radar-off');
  const dir = path.join(base, 'nao-existe');
  // R1: com a pasta radar/ e ficha nova, para o portao da chave ser o que cala (sem a pasta o radar ja se cala)
  const cheia = path.join(base, 'cheia');
  try {
    novidades(path.join(cheia, 'radar'), FICHA_RADAR);
    assert.ok(avisoRadar(cheia, AGORA) !== '', 'controle: ligado, a ficha fala');
    fs.rmSync(path.join(cheia, 'radar', 'visto.json'));
    for (const p of [{}, { vigia: false }, { vigia: 'true' }, null, 'lixo']) {
      assert.strictEqual(vigia.avisoDoRadar(p, { pasta: dir, agora: AGORA, cwd: base }), '', JSON.stringify(p));
      assert.strictEqual(vigia.avisoDoRadar(p, { pasta: cheia, agora: AGORA, cwd: base }), '', JSON.stringify(p));
    }
    assert.ok(!fs.existsSync(dir), 'tocou o disco desligado');
    assert.ok(!fs.existsSync(path.join(cheia, 'radar', 'visto.json')), 'marcou a ficha desligado');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('radar: ficha nova mostra a semana e a conta, sem o texto da ficha; grava visto na pasta do radar; 2a calada', () => {
  const base = temp('radar-nova');
  const dir = path.join(base, 'radar');
  try {
    novidades(dir, FICHA_RADAR);
    const t = avisoRadar(base, AGORA + 9 * DIA);
    const linhas = t.split('\n');
    assert.strictEqual(linhas.length, 4, t);
    assert.strictEqual(linhas[0], 'sworn: radar - ficha da semana de 2026-10-19: 3 candidatos, 1 para adotar. Para ver e escolher: /sworn:radar.');
    assert.ok(/^Arquivo inteiro: .*radar[\\/]novidades\.md\. Para desligar o vigia e o radar \(a mesma chave\): "vigia": false em \.claude\/sworn\/projeto\.json\.$/.test(linhas[1]), t);
    assert.ok(linhas[2].indexOf('Depois de triar, grave a marca') === 0, t);
    assert.ok(linhas[3].indexOf('node "') === 0 && linhas[3].indexOf('--radar --semana 2026-10-19') !== -1, t);
    assert.strictEqual(t.indexOf('opencode'), -1, 'o texto de terceiros entrou na abertura: ' + t);
    assert.deepStrictEqual(lerJson(dir, 'visto.json'), { semana: '2026-10-19', problema: '2026-10-20' });
    assert.ok(!fs.existsSync(path.join(base, 'visto.json')), 'marcou a visto do vigia');
    assert.strictEqual(avisoRadar(base, AGORA + 9 * DIA), '', 'mostrou a mesma ficha duas vezes');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('radar: 1 candidato no singular; ficha fora do formato diz quantos problemas', () => {
  const base = temp('radar-formato');
  const dir = path.join(base, 'radar');
  try {
    const um = FICHA_RADAR.split('\n').filter((l) => !/^\| (anomalyco|cursor)/.test(l)).join('\n');
    novidades(dir, um);
    assert.strictEqual(avisoRadar(base, AGORA).split('\n')[0],
      'sworn: radar - ficha da semana de 2026-10-19: 1 candidato, 0 para adotar. Para ver e escolher: /sworn:radar.');
    novidades(dir, 'semana: 2026-10-26\n\n## Candidatos\n\n| Repo | Licença |\n|---|---|\n| x/y | MIT |\n');
    const t = avisoRadar(base, AGORA).split('\n')[0];
    // o cabecalho de 2 colunas nao e o do radar e conta como linha (lib/referencia.js): a conta aqui e o de menos
    assert.ok(/^sworn: radar - ficha da semana de 2026-10-26: \d+ candidatos?, 0 para adotar\. Ficha fora do formato \(\d+ problemas\)\. Para ver os problemas e escolher: \/sworn:radar\.$/.test(t), t);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// Revisao da T5, R1: 1 problema saia "1 problemas"; e a conta que lanca deixava o radar mudo para sempre (o catch
// devolvia '' antes de gravar a semana). A lib de referencia e a mesma instancia em cache: o teste troca a conta.
test('radar: 1 problema no singular; a conta que falha nao cala a ficha e marca a semana', () => {
  const referencia = require('../scripts/lib/referencia.js');
  const original = referencia.conferir;
  const base = temp('radar-conta');
  const dir = path.join(base, 'radar');
  try {
    novidades(dir, FICHA_RADAR);
    referencia.conferir = () => ({ problemas: ['x'], candidatos: 2, adotar: 0 });
    assert.ok(avisoRadar(base, AGORA).indexOf('Ficha fora do formato (1 problema). ') !== -1, 'plural fixo');
    novidades(dir, FICHA_RADAR.replace('semana: 2026-10-19', 'semana: 2026-10-26'));
    referencia.conferir = () => { throw new Error('conta quebrada'); };
    const t = avisoRadar(base, AGORA);
    assert.ok(t.indexOf('sworn: radar - ficha da semana de 2026-10-26: nao consegui contar os candidatos (Error: conta quebrada): abra a ficha no arquivo da linha de baixo. Para ver e escolher: /sworn:radar.') === 0, t);
    assert.deepStrictEqual(lerJson(dir, 'visto.json'), { semana: '2026-10-26', problema: '2026-10-11' });
    // R2: a conta que devolve fora da forma (sem problemas, null) lancava fora do try e calava a ficha do mesmo jeito
    // R3: e a que devolve lista sem as contas, ou problemas que nao e lista, saia "undefined candidatos" ou "3 problemas"
    // P16-r3-4: e a conta negativa, ou com mais adotados que candidatos, saia "-1 candidatos, 5 para adotar"
    [['2026-11-02', () => ({})], ['2026-11-09', () => null], ['2026-11-16', () => ({ problemas: [] })],
      ['2026-11-23', () => ({ problemas: 'xyz', candidatos: 1, adotar: 0 })],
      ['2026-11-30', () => ({ problemas: [], candidatos: -1, adotar: 0 })],
      ['2026-12-07', () => ({ problemas: [], candidatos: 2, adotar: -1 })],
      ['2026-12-14', () => ({ problemas: [], candidatos: 2, adotar: 3 })]].forEach(function (c) {
      novidades(dir, FICHA_RADAR.replace('semana: 2026-10-19', 'semana: ' + c[0]));
      referencia.conferir = c[1];
      const s = avisoRadar(base, AGORA);
      assert.ok(s.indexOf('sworn: radar - ficha da semana de ' + c[0] + ': nao consegui contar os candidatos (') === 0, s);
      assert.deepStrictEqual(lerJson(dir, 'visto.json'), { semana: c[0], problema: '2026-10-11' });
    });
  } finally {
    referencia.conferir = original;
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('radar: problemas (ausente, ilegivel, velha) avisam 1 vez por dia, com a ultima busca, sem calar o vigia', () => {
  const base = temp('radar-problema');
  const dir = path.join(base, 'radar');
  try {
    novidades(base, RELATORIO);
    // P16-vigia-local-r1-1: sem a pasta radar/ a tarefa do radar nunca rodou: quem so quer o vigia nao ouve o radar
    assert.strictEqual(avisoRadar(base, AGORA), '', 'o radar sem pasta falou');
    assert.ok(!fs.existsSync(dir), 'o radar sem pasta criou a pasta');
    fs.mkdirSync(dir);
    const t = avisoRadar(base, AGORA);
    assert.ok(t.indexOf('sworn: radar ligado, mas nenhuma ficha chegou ainda em ') === 0, t);
    assert.ok(/radar \(a tarefa agendada do radar puxa toda segunda; se ela nunca rodou, rode-a a mao no Agendador de Tarefas do Windows\)\.$/.test(t), t);
    assert.strictEqual(avisoRadar(base, AGORA + 3600000), '', 'repetiu no mesmo dia');
    assert.ok(aviso(base, AGORA).indexOf('novidade da semana de 2026-10-05') !== -1, 'o radar calou o vigia');

    novidades(dir, 'sem a linha\n');
    fs.writeFileSync(path.join(dir, 'ultima-busca.json'), JSON.stringify({ ok: false, quando: '2026-10-12T10:30:00.000Z', motivo: 'git fetch saiu com 128' }));
    const i = avisoRadar(base, AGORA + DIA);
    assert.ok(i.indexOf('sworn: radar - nao consegui ler ') === 0 && i.indexOf('sem a linha "semana: AAAA-MM-DD"') !== -1, i);
    assert.ok(i.indexOf(' Ultima busca falhou em 2026-10-12T10:30:00.000Z: git fetch saiu com 128.') !== -1, i);

    novidades(dir, FICHA_RADAR);
    fs.rmSync(path.join(dir, 'ultima-busca.json'));
    assert.ok(avisoRadar(base, AGORA + 2 * DIA).indexOf('ficha da semana de 2026-10-19') !== -1);
    triar(dir, '2026-10-19'); // H11b: sem a marca, o aviso de velha leva o lembrete de triagem junto
    const dia14 = Date.UTC(2026, 10, 2);
    assert.strictEqual(avisoRadar(base, dia14), 'sworn: radar sem ficha nova desde 2026-10-19: confira a rotina na nuvem ' +
      'que grava o ramo claude/radar e, no Agendador de Tarefas do Windows, a tarefa agendada do radar (a que chama o ' +
      'vigia-puxar.js).');
    assert.strictEqual(avisoRadar(base, dia14 + 3600000), '');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('radar: toda saida e ASCII, mesmo com acento no caminho; nunca lanca', () => {
  const base = path.join(temp('radar-ascii'), 'pasta-ção');
  try {
    // R1: a pasta radar/ vazia, para o aviso de ausente falar (sem ela o radar se cala e a regex veria '')
    fs.mkdirSync(path.join(base, 'radar'), { recursive: true });
    const ausente = avisoRadar(base, AGORA);
    assert.ok(ausente && /^[\x20-\x7E\n]*$/.test(ausente), JSON.stringify(ausente));
    novidades(path.join(base, 'radar'), FICHA_RADAR);
    const t = avisoRadar(base, AGORA);
    assert.ok(t && /^[\x20-\x7E\n]*$/.test(t), JSON.stringify(t));
    assert.doesNotThrow(() => vigia.avisoDoRadar(LIGADO, { pasta: base, agora: NaN }));
    assert.strictEqual(vigia.avisoDoRadar(LIGADO, { pasta: { toString() { throw new Error('x'); } } }), '');
  } finally { fs.rmSync(path.dirname(base), { recursive: true, force: true }); }
});

// P16-vigia-local-r1-3/r1-17 e P16-r3-5: o arquivo de fora era lido inteiro, e a ficha inteira ia a conta.
test('P16-vigia-local-r1-3: le no maximo MAX_BYTES; o vigia diz que o resto esta no arquivo e o radar nao conta', () => {
  const base = temp('teto');
  const dir = path.join(base, 'radar');
  try {
    assert.strictEqual(vigia.MAX_BYTES, 256 * 1024);
    const enchimento = ('x'.repeat(99) + '\n').repeat(Math.ceil(vigia.MAX_BYTES / 100) + 10);
    novidades(base, RELATORIO + enchimento);
    const t = aviso(base, AGORA);
    assert.ok(t.indexOf('sworn: vigia - novidade da semana de 2026-10-05') === 0, t);
    assert.ok(t.indexOf('... (o arquivo passa de 256 KB; o resto esta so nele)') !== -1, t);
    assert.strictEqual(t.indexOf('linhas no arquivo)'), -1, 'contou linhas do arquivo cortado: ' + t);
    // controle: o arquivo do tamanho exato do teto nao e cortado
    const exato = RELATORIO + 'y'.repeat(vigia.MAX_BYTES - Buffer.byteLength(RELATORIO));
    novidades(base, exato.replace('semana: 2026-10-05', 'semana: 2026-10-06'));
    const te = aviso(base, AGORA);
    assert.ok(te.indexOf('sworn: vigia - novidade da semana de 2026-10-06') === 0, te);
    assert.strictEqual(te.indexOf('passa de 256 KB'), -1, 'cortou o arquivo do tamanho do teto');
    // e um byte a mais ja corta
    novidades(base, (exato + 'y').replace('semana: 2026-10-05', 'semana: 2026-10-07'));
    const tm = aviso(base, AGORA);
    assert.ok(tm.indexOf('sworn: vigia - novidade da semana de 2026-10-07') === 0, tm);
    assert.ok(tm.indexOf('... (o arquivo passa de 256 KB; o resto esta so nele)') !== -1, tm);
    // R2: 11 linhas enormes e a 12a curta, com o 'ç' (2 bytes) partido no teto: a 12a aparece ate o corte ('fim: a'),
    // sem o '?' do caractere partido (o mutante com decoder.end() poe o U+FFFD, que a abertura escreve como '?')
    const cab = 'semana: 2026-10-08\n';
    const prefixo = 'fim: a';
    const resto = vigia.MAX_BYTES - 1 - Buffer.byteLength(cab) - prefixo.length - 11;
    const enormes = ['z'.repeat(resto - 10 * 20000)].concat(Array(10).fill('z'.repeat(20000))).join('\n') + '\n';
    const partido = cab + enormes + prefixo + 'ção\n';
    assert.strictEqual(Buffer.byteLength(cab + enormes + prefixo), vigia.MAX_BYTES - 1, 'o ç nao cai no teto');
    novidades(base, partido);
    const tp = aviso(base, AGORA).split('\n');
    assert.ok(tp.indexOf('fim: a') !== -1, tp.slice(-3).join('\n'));
    assert.strictEqual(tp.indexOf('fim: a?'), -1, 'o caractere partido virou ?');

    const referencia = require('../scripts/lib/referencia.js');
    const original = referencia.conferir;
    let chamou = false;
    referencia.conferir = function () { chamou = true; return original.apply(this, arguments); };
    try {
      novidades(dir, FICHA_RADAR + '\n' + enchimento);
      const r = avisoRadar(base, AGORA);
      assert.ok(r.indexOf('sworn: radar - ficha da semana de 2026-10-19: a ficha passa de 256 KB e nao foi contada: abra-a ' +
        'no arquivo da linha de baixo. Para ver e escolher: /sworn:radar.') === 0, r);
      assert.strictEqual(chamou, false, 'a ficha cortada foi a conta');
      assert.deepStrictEqual(lerJson(dir, 'visto.json'), { semana: '2026-10-19', problema: '2026-10-11' });
    } finally { referencia.conferir = original; }
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// P16-vigia-local-r1-2 (A7-13): a semana do futuro nunca ficava velha, e o aviso de parado nunca saia.
test('P16-vigia-local-r1-2: a semana vista que esta mais de um dia no futuro avisa (1 vez por dia)', () => {
  const dir = temp('futura');
  try {
    novidades(dir, RELATORIO.replace('semana: 2026-10-05', 'semana: 2026-10-26'));
    assert.ok(aviso(dir, AGORA).indexOf('novidade da semana de 2026-10-26') !== -1); // mostra e marca
    triar(dir, '2026-10-26'); // H11b: sem a marca, o aviso leva o lembrete de triagem junto
    const t = aviso(dir, AGORA + DIA);
    assert.ok(/^sworn: vigia - a semana 2026-10-26 de .*novidades\.md ainda nao chegou: confira a data no arquivo e o relogio do computador\.$/.test(t), t);
    assert.strictEqual(aviso(dir, AGORA + DIA + 3600000), '', 'repetiu no mesmo dia');
    // controle: a semana de amanha (menos de um dia a frente, o fuso) fica calada, e a vista no dia seguinte tambem
    novidades(dir, RELATORIO.replace('semana: 2026-10-05', 'semana: 2026-10-12'));
    assert.ok(aviso(dir, AGORA)); // mostra e marca
    triar(dir, '2026-10-12');
    assert.strictEqual(aviso(dir, AGORA + 3600000), '', 'a semana de menos de 1 dia a frente avisou');
    assert.strictEqual(aviso(dir, AGORA + 2 * DIA), '', 'a semana vista de ontem avisou');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// P16-vigia-local-r2-7: o ultima-busca.json corrompido sumia em silencio; o que nao existe segue calado.
test('P16-vigia-local-r2-7: o registro da ultima busca que nao se le e dito no aviso de problema', () => {
  const dir = temp('busca-torta');
  try {
    fs.writeFileSync(path.join(dir, 'ultima-busca.json'), '{ ok: false', 'utf8');
    const t = aviso(dir, AGORA);
    assert.ok(t.indexOf('nenhuma novidade chegou ainda') !== -1, t);
    assert.ok(/ O registro da ultima busca \(.*ultima-busca\.json\) nao se le \(JSON invalido\); a proxima busca o regrava\.$/.test(t), t);
    // R1: a mensagem do JSON.parse traz um pedaco do arquivo; nao entra na abertura
    assert.strictEqual(t.indexOf('ok: false'), -1, t);
    // controle: sem o registro, nada a mais
    fs.renameSync(path.join(dir, 'ultima-busca.json'), path.join(dir, 'outro.json'));
    const s = aviso(dir, AGORA + DIA);
    assert.strictEqual(s.indexOf('registro da ultima busca'), -1, s);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// H11b: a ficha destes testes ja foi triada (o lembrete de triagem tem os testes dele, no fim do arquivo)
const TRIADA = { semana: '2026-10-05', como: 'teste', quando: '2026-10-06T12:00:00.000Z' };

// H11a (D909, pedido do dono 2026-11-24): a busca de 2026-11-23 falhou (git passou de 60 s) com a ficha de 8 dias no
// disco, e a abertura calou: a frase da falha so saia junto do aviso de ficha velha, que espera DIAS_VELHO (14).
test('H11a: busca que falhou avisa no mesmo dia, sem esperar a ficha ficar velha; uma vez por dia', () => {
  const dir = temp('h11a');
  try {
    novidades(dir, RELATORIO); // semana 2026-10-05
    fs.writeFileSync(path.join(dir, 'visto.json'), JSON.stringify({ semana: '2026-10-05', triada: TRIADA }));
    fs.writeFileSync(path.join(dir, 'ultima-busca.json'),
      JSON.stringify({ ok: false, quando: '2026-10-12T10:35:00.000Z', motivo: 'git nao rodou: git demorou mais de 60s' }));
    const oito = Date.UTC(2026, 9, 13, 12, 0, 0); // 8 dias depois da semana: ainda nao velha
    const t = aviso(dir, oito);
    assert.ok(t.indexOf('sworn: vigia') === 0, t);
    assert.ok(t.indexOf('sworn: vigia - a novidade no disco segue a de 2026-10-05.') === 0, 'ronda 2: a palavra do vigia: ' + t);
    assert.ok(t.indexOf(' Ultima busca falhou em 2026-10-12T10:35:00.000Z: git nao rodou: git demorou mais de 60s.') !== -1, t);
    assert.strictEqual(aviso(dir, oito + 3600000), '', 'repetiu no mesmo dia');
    assert.ok(aviso(dir, oito + DIA).indexOf('Ultima busca falhou') !== -1, 'dia seguinte avisa de novo');
    // a busca seguinte deu certo: silencio
    fs.writeFileSync(path.join(dir, 'ultima-busca.json'),
      JSON.stringify({ ok: true, quando: '2026-10-14T10:35:00.000Z', motivo: null, semana: '2026-10-05' }));
    assert.strictEqual(aviso(dir, oito + 2 * DIA), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('H11a: o radar diz a falha da busca do mesmo jeito', () => {
  const dir = temp('h11a-radar');
  try {
    const sub = path.join(dir, 'radar');
    novidades(sub, 'semana: 2026-10-05\n\n# Radar - semana de 2026-10-05\n\n## Candidatos\n\n| Repo | Licenca |\n|---|---|\n| a/b | MIT |\n');
    fs.writeFileSync(path.join(sub, 'visto.json'), JSON.stringify({ semana: '2026-10-05', triada: TRIADA }));
    fs.writeFileSync(path.join(sub, 'ultima-busca.json'),
      JSON.stringify({ ok: false, quando: '2026-10-12T10:35:00.000Z', motivo: 'git nao rodou: git demorou mais de 60s' }));
    const oito = Date.UTC(2026, 9, 13, 12, 0, 0);
    const t = vigia.avisoDoRadar(LIGADO, { pasta: dir, agora: oito });
    assert.ok(t.indexOf('sworn: radar - a ficha no disco segue a de 2026-10-05.') === 0 && t.indexOf('Ultima busca falhou') !== -1, t);
    assert.strictEqual(vigia.avisoDoRadar(LIGADO, { pasta: dir, agora: oito + 3600000 }), '', 'repetiu no mesmo dia');
    assert.ok(vigia.avisoDoRadar(LIGADO, { pasta: dir, agora: oito + DIA }).indexOf('Ultima busca falhou') !== -1,
      'dia seguinte avisa de novo');
    fs.writeFileSync(path.join(sub, 'ultima-busca.json'),
      JSON.stringify({ ok: true, quando: '2026-10-14T10:35:00.000Z', motivo: null, semana: '2026-10-05' }));
    assert.strictEqual(vigia.avisoDoRadar(LIGADO, { pasta: dir, agora: oito + 2 * DIA }), '', 'a busca boa cala');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// H11a (D909): o fetch das 10:35 de 2026-11-23 passou de 60 s; o mesmo comando, a mao, levou 2,4 s. Tentar de novo.
test('H11a: tentar repete o que falhou ate 3 vezes, dorme entre elas e para no primeiro ok', () => {
  const sonos = [];
  let n = 0;
  const r = vigia.tentar(3, 30000, () => (++n < 3 ? { ok: false, motivo: 'falha ' + n } : { ok: true, saida: 'x' }),
    (ms) => sonos.push(ms));
  assert.deepStrictEqual(r, { ok: true, saida: 'x' });
  assert.strictEqual(n, 3);
  assert.deepStrictEqual(sonos, [30000, 30000]);

  // primeira deu certo: nao dorme
  const s2 = [];
  assert.strictEqual(vigia.tentar(3, 30000, () => ({ ok: true }), (ms) => s2.push(ms)).ok, true);
  assert.deepStrictEqual(s2, []);

  // as 3 falham: o motivo da ultima, com quantas tentativas, e nenhum sono depois da ultima
  const s3 = [];
  let m = 0;
  const f = vigia.tentar(3, 5, () => ({ ok: false, motivo: 'falha da vez ' + (++m) }), (ms) => s3.push(ms));
  assert.strictEqual(f.ok, false);
  assert.strictEqual(f.motivo, 'falha da vez 3 (3 tentativas)');
  assert.deepStrictEqual(s3, [5, 5]);

  // ronda 1 (borda): vezes que nao e inteiro positivo tenta 1 vez, e o motivo diz no singular
  for (const v of [0, -2, 1.5, NaN, undefined]) {
    let k = 0;
    const g = vigia.tentar(v, 5, () => { k++; return { ok: false, motivo: 'x' }; }, () => {});
    assert.strictEqual(k, 1, String(v));
    assert.strictEqual(g.motivo, 'x (1 tentativa)', String(v));
  }
  // ronda 1 (borda): o motivo longo e cortado antes da conta, e a conta cabe nos 300 do vigia-puxar
  const longo = vigia.tentar(3, 0, () => ({ ok: false, motivo: 'y'.repeat(400) }), () => {});
  assert.ok(/ \(3 tentativas\)$/.test(longo.motivo) && longo.motivo.length <= 300, longo.motivo.length);
});

test('H11b: a ficha vista e nao triada avisa no dia seguinte, uma vez por dia; triada cala ate a proxima', () => {
  const dir = temp('h11b');
  try {
    novidades(dir, RELATORIO);
    const chegou = Date.UTC(2026, 9, 6, 9, 0, 0);
    const t0 = aviso(dir, chegou);
    assert.ok(t0.indexOf('novidade da semana de 2026-10-05') !== -1, t0);
    assert.ok(t0.indexOf('vigia-triar.js') !== -1 && t0.indexOf('--vigia --semana 2026-10-05') !== -1, 'a chegada diz como triar: ' + t0);
    assert.strictEqual(aviso(dir, chegou + 3600000), '', 'a chegada ja avisou hoje');
    const t1 = aviso(dir, chegou + DIA);
    assert.ok(t1.indexOf('sworn: vigia - a novidade de 2026-10-05 do vigia chegou e nao foi triada') === 0, t1);
    assert.ok(t1.indexOf('troque <o que foi decidido> pelo que decidiu') !== -1, 'ronda 2: o lembrete manda trocar o marcador: ' + t1);
    const l1 = t1.split('\n');
    assert.ok(/^node ".*vigia-triar\.js" --vigia --semana 2026-10-05 --como "<o que foi decidido>"$/.test(l1[l1.length - 1]), t1);
    assert.strictEqual(aviso(dir, chegou + DIA + 3600000), '', 'repetiu no mesmo dia');
    assert.ok(aviso(dir, chegou + 2 * DIA).indexOf('nao foi triada') !== -1, 'dia seguinte avisa de novo');

    const m = vigia.marcarTriada(dir, '2026-10-05', 'D1: nada a adotar', chegou + 2 * DIA);
    assert.deepStrictEqual(m, { ok: true, semana: '2026-10-05' });
    const v = lerJson(dir, 'visto.json');
    assert.strictEqual(v.semana, '2026-10-05', 'preserva o resto do visto');
    assert.deepStrictEqual(v.triada, { semana: '2026-10-05', como: 'D1: nada a adotar', quando: new Date(chegou + 2 * DIA).toISOString() });
    assert.strictEqual(aviso(dir, chegou + 3 * DIA), '', 'triada cala');

    // a ficha seguinte chega: a marca da anterior nao vale para ela
    novidades(dir, RELATORIO.replace('2026-10-05', '2026-10-12'));
    assert.ok(aviso(dir, chegou + 7 * DIA).indexOf('novidade da semana de 2026-10-12') !== -1);
    assert.ok(aviso(dir, chegou + 8 * DIA).indexOf('a novidade de 2026-10-12 do vigia chegou e nao foi triada') !== -1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('H11b: a ficha nao triada vai junto do outro problema do dia (busca que falhou), num aviso so', () => {
  const dir = temp('h11b-busca');
  try {
    novidades(dir, RELATORIO);
    fs.writeFileSync(path.join(dir, 'visto.json'), JSON.stringify({ semana: '2026-10-05' }));
    fs.writeFileSync(path.join(dir, 'ultima-busca.json'),
      JSON.stringify({ ok: false, quando: '2026-10-12T10:35:00.000Z', motivo: 'git nao rodou: git demorou mais de 60s' }));
    const t = aviso(dir, Date.UTC(2026, 9, 13, 12, 0, 0));
    assert.ok(t.indexOf('Ultima busca falhou') !== -1 && t.indexOf('a novidade de 2026-10-05 do vigia chegou e nao foi triada') !== -1, t);
    // o comando continua na ultima linha, depois da frase da busca
    assert.ok(/^node ".*vigia-triar\.js" --vigia --semana 2026-10-05 --como "<o que foi decidido>"$/.test(t.split('\n').pop()), t);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('H11b ronda 1: a chegada ja triada nao gasta o aviso do dia; a chegada diz a busca que falhou', () => {
  const dir = temp('h11b-chegada');
  try {
    novidades(dir, RELATORIO);
    fs.writeFileSync(path.join(dir, 'visto.json'), JSON.stringify({ triada: { semana: '2026-10-05', como: 'x', quando: 'y' } }));
    const t = aviso(dir, AGORA);
    assert.ok(t.indexOf('novidade da semana de 2026-10-05') !== -1 && t.indexOf('vigia-triar.js') === -1, t);
    assert.strictEqual(lerJson(dir, 'visto.json').problema, undefined, 'a chegada ja triada gastou o aviso do dia');
    // a busca falha depois, no mesmo dia: a 2a abertura diz
    fs.writeFileSync(path.join(dir, 'ultima-busca.json'),
      JSON.stringify({ ok: false, quando: '2026-10-11T08:00:00.000Z', motivo: 'm' }));
    assert.ok(aviso(dir, AGORA + 3600000).indexOf('Ultima busca falhou') !== -1, 'calou a falha do mesmo dia');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const dir2 = temp('h11b-chegada-busca');
  try {
    novidades(dir2, RELATORIO);
    // ja triada e com a busca falhada: a chegada diz a falha e gasta o aviso do dia
    fs.writeFileSync(path.join(dir2, 'visto.json'), JSON.stringify({ triada: { semana: '2026-10-05', como: 'x', quando: 'y' } }));
    // ronda 1: o quando como a vigia-puxar grava (toISOString), nao um texto solto
    fs.writeFileSync(path.join(dir2, 'ultima-busca.json'),
      JSON.stringify({ ok: false, quando: '2026-10-11T08:00:00.000Z', motivo: 'm' }));
    const t = aviso(dir2, AGORA);
    assert.ok(t.indexOf('novidade da semana de 2026-10-05') !== -1 &&
      t.indexOf('Ultima busca falhou em 2026-10-11T08:00:00.000Z: m.') !== -1, t);
    assert.strictEqual(lerJson(dir2, 'visto.json').problema, '2026-10-11');
  } finally { fs.rmSync(dir2, { recursive: true, force: true }); }
});

test('H11b ronda 1: o comando leva o caminho real do script (acento fica), sem quebra de linha', () => {
  const c = vigia.comandoDeTriar('vigia', '2026-10-05', '/c/proj/João\n/scripts/vigia-triar.js');
  assert.strictEqual(c, 'node "/c/proj/João/scripts/vigia-triar.js" --vigia --semana 2026-10-05 --como "<o que foi decidido>"');
});

test('H11b: o radar tambem lembra a ficha nao triada, com --radar no comando', () => {
  const dir = temp('h11b-radar');
  try {
    const sub = path.join(dir, 'radar');
    novidades(sub, 'semana: 2026-10-05\n\n# Radar - semana de 2026-10-05\n');
    fs.writeFileSync(path.join(sub, 'visto.json'), JSON.stringify({ semana: '2026-10-05' }));
    const t = vigia.avisoDoRadar(LIGADO, { pasta: dir, agora: Date.UTC(2026, 9, 7, 12, 0, 0) });
    assert.ok(t.indexOf('sworn: radar - a ficha de 2026-10-05 do radar chegou e nao foi triada') === 0, t);
    assert.ok(t.indexOf('--radar --semana 2026-10-05 --como') !== -1, t);
    assert.deepStrictEqual(vigia.marcarTriada(sub, '2026-10-05', 'D909', Date.UTC(2026, 9, 7, 13, 0, 0)).ok, true);
    assert.strictEqual(vigia.avisoDoRadar(LIGADO, { pasta: dir, agora: Date.UTC(2026, 9, 8, 12, 0, 0) }), '');

    // ronda 1 (borda): a ficha do radar que chega ja triada mostra a ficha sem o comando e nao gasta o aviso do dia
    novidades(sub, 'semana: 2026-10-12\n\n# Radar - semana de 2026-10-12\n');
    fs.writeFileSync(path.join(sub, 'visto.json'),
      JSON.stringify({ semana: '2026-10-05', triada: { semana: '2026-10-12', como: 'x', quando: '2026-10-12T09:00:00.000Z' } }));
    const c = vigia.avisoDoRadar(LIGADO, { pasta: dir, agora: Date.UTC(2026, 9, 13, 12, 0, 0) });
    assert.ok(c.indexOf('2026-10-12') !== -1 && c.indexOf('vigia-triar.js') === -1, c);
    assert.strictEqual(lerJson(sub, 'visto.json').problema, undefined, 'a chegada ja triada gastou o aviso do dia');

    // ronda 1 (estados): a marca torta (texto no lugar do objeto) nao vale como triada: o lembrete segue
    fs.writeFileSync(path.join(sub, 'visto.json'), JSON.stringify({ semana: '2026-10-12', triada: '2026-10-12' }));
    const torta = vigia.avisoDoRadar(LIGADO, { pasta: dir, agora: Date.UTC(2026, 9, 14, 12, 0, 0) });
    assert.ok(torta.indexOf('sworn: radar - a ficha de 2026-10-12 do radar chegou e nao foi triada') === 0, torta);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('H11b: marcarTriada recusa a semana que nao e a do disco, a ficha que falta e o como vazio', () => {
  const dir = temp('h11b-marca');
  try {
    const sem = vigia.marcarTriada(dir, '2026-10-05', 'x', AGORA);
    assert.strictEqual(sem.ok, false, 'sem ficha');
    assert.ok(sem.motivo.indexOf('Agendador de Tarefas') !== -1, 'ronda 1: a recusa diz o passo: ' + sem.motivo);
    // ronda 1 (estados): a ficha sem a linha semana: tambem nao e ficha para triar
    novidades(dir, '# so um titulo\n');
    const torta = vigia.marcarTriada(dir, '2026-10-05', 'x', AGORA);
    assert.strictEqual(torta.ok, false);
    assert.ok(torta.motivo.indexOf('nao ha ficha para triar') !== -1, torta.motivo);
    assert.ok(!fs.existsSync(path.join(dir, 'visto.json')), 'a ficha torta gravou');
    novidades(dir, RELATORIO);
    // ronda 1 (borda): so simbolo que o ASCII apaga nao e o que foi decidido
    assert.strictEqual(vigia.marcarTriada(dir, '2026-10-05', '✅', AGORA).ok, false, 'emoji sozinho');
    // ronda 2 (microcopy): o marcador do comando copiado sem troca nao e o que foi decidido
    for (const como of ['<o que foi decidido>', ' <o que foi decidido> ', 'ok <o que foi decidido>']) {
      const r = vigia.marcarTriada(dir, '2026-10-05', como, AGORA);
      assert.strictEqual(r.ok, false, como);
      assert.ok(r.motivo.indexOf('troque <o que foi decidido>') !== -1, r.motivo);
    }
    const errada = vigia.marcarTriada(dir, '2026-10-12', 'x', AGORA);
    assert.strictEqual(errada.ok, false);
    assert.ok(errada.motivo.indexOf('2026-10-05') !== -1, 'diz a semana do disco: ' + errada.motivo);
    for (const como of ['', '   ', null, undefined]) {
      assert.strictEqual(vigia.marcarTriada(dir, '2026-10-05', como, AGORA).ok, false, String(como));
    }
    assert.ok(!fs.existsSync(path.join(dir, 'visto.json')), 'recusa nao grava');
    // o como vira uma linha ASCII de ate 200
    assert.strictEqual(vigia.marcarTriada(dir, '2026-10-05', 'linha\nduas ' + 'z'.repeat(300), AGORA).ok, true);
    const como = lerJson(dir, 'visto.json').triada.como;
    assert.ok(como.length <= 200 && como.indexOf('\n') === -1 && como.indexOf('linha duas') === 0, como);
    // ronda 1 (borda): o limite exato - 200 fica inteiro, 201 perde o ultimo
    assert.strictEqual(vigia.marcarTriada(dir, '2026-10-05', 'a'.repeat(200), AGORA).ok, true);
    assert.strictEqual(lerJson(dir, 'visto.json').triada.como, 'a'.repeat(200));
    assert.strictEqual(vigia.marcarTriada(dir, '2026-10-05', 'b'.repeat(201), AGORA).ok, true);
    assert.strictEqual(lerJson(dir, 'visto.json').triada.como, 'b'.repeat(200));
    // ronda 1 (estados): agora invalido cai no relogio; a marca leva uma data ISO valida
    const antes = Date.now();
    assert.strictEqual(vigia.marcarTriada(dir, '2026-10-05', 'relogio', NaN).ok, true);
    const q = Date.parse(lerJson(dir, 'visto.json').triada.quando);
    assert.ok(q >= antes - 1000 && q <= Date.now() + 1000, lerJson(dir, 'visto.json').triada.quando);
    // ronda 1 (estados): o visto.json ilegivel nao impede a marca; ela o regrava inteiro
    fs.writeFileSync(path.join(dir, 'visto.json'), '{ quebrado');
    assert.strictEqual(vigia.marcarTriada(dir, '2026-10-05', 'depois do quebrado', AGORA).ok, true);
    assert.deepStrictEqual(lerJson(dir, 'visto.json'),
      { triada: { semana: '2026-10-05', como: 'depois do quebrado', quando: new Date(AGORA).toISOString() } });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
