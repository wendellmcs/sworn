'use strict';
// H6a2 (D892, defeito 3): o handoff sai escrito horas antes da compactacao; quando ela chega, o HEAD, o git status, o
// item do plano e as pendencias dele ja sao outros. O gancho PreCompact refaz so essas secoes mecanicas pelo
// handoff-curto.js, logo antes da compactacao, e nao toca nas de julgamento (o que o modelo escreveu).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const comum = require('./lib/comum.js');
const pend = require('../scripts/lib/pendencias.js');
const hc = require('../scripts/lib/handoff-curto.js');

const HOJE = '2026-11-13';
const AGORA = new Date(2026, 10, 13, 14, 5, 0);
const JUIZO = ['JUIZO-ONDE metade do T2 feita', 'JUIZO-DECISOES do dono', 'JUIZO-ERROS nenhum', 'JUIZO-TERCEIROS nenhum'];
// linhas do modelo que comecam como as mecanicas da secao 5, sem o resto da forma delas
const MODELO_PARECIDO = ['  - #7 decidido com o dono: adiar', '- abertas em revisao: o PR 12', '- nenhuma aberta em outro repo, conferido',
  '- pedidos do dono abertos ate ontem: so o #9, respondido de boca'];

/** Um repo com a frente, o plano (T2 aberto), uma pendencia e o handoff ja preenchido, gravado no disco. */
function cenario() {
  comum.identidadeDeEnsaio();
  const dir = comum.repo(comum.pasta('pc'), {
    '.claude/sworn/escopos/frente-x.md': '# Escopo\n**Objetivo:** fazer x. Plano: `docs/plano.md`\n## Dentro\n- `a.js`\n',
    'docs/plano.md': '# Plano\n- [x] T1 feito\n- [ ] T2 o passo de agora\n  com a segunda linha.\n- [ ] T3 depois\n',
    'a.js': '1\n'
  });
  pend.adicionar(dir, { dono: 'Ana', texto: 'publicar a 0.32.0', hoje: HOJE });
  const m = hc.montar(dir, { slug: 't2', hoje: HOJE, frente: 'frente-x' });
  let i = 0;
  let texto = m.texto.replace(/<<[A-Z]+:[^>]*>>/g, function () { return JUIZO[i++]; });
  assert.strictEqual(i, JUIZO.length, 'controle: o montar tem uma marca para cada texto de julgamento');
  // o modelo pode juntar outro repo na topologia e uma linha sua nas pendencias: as duas ficam
  texto = texto.replace('\n\n## 3. Onde estamos', '\n- C:/outro-repo: main, HEAD abc123 (o repo vizinho)\n\n## 3. Onde estamos');
  texto = texto.replace('\n\n## 6. Erros de metodo', '\n- JUIZO-PEND combinado com o dono em 2026-11-13\n' + MODELO_PARECIDO.join('\n') +
    '\n\n## 6. Erros de metodo');
  const abs = path.join(dir, m.caminho);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, texto, 'utf8');
  return { dir: dir, abs: abs, rel: m.caminho, texto: texto, headAntes: comum.git(dir, ['rev-parse', 'HEAD']) };
}

/** O disco anda depois do handoff: um commit, um arquivo novo, o T2 marcado e outra pendencia. */
function andar(c) {
  fs.writeFileSync(path.join(c.dir, 'a.js'), '2\n');
  comum.git(c.dir, ['add', 'a.js']);
  comum.git(c.dir, ['commit', '-q', '-m', 'feat: T2 pela metade']);
  fs.writeFileSync(path.join(c.dir, 'b.js'), 'novo\n');
  const plano = path.join(c.dir, 'docs', 'plano.md');
  fs.writeFileSync(plano, fs.readFileSync(plano, 'utf8').replace('- [ ] T2 o passo de agora', '- [x] T2 o passo de agora (s1: feito)'));
  pend.adicionar(c.dir, { dono: 'Bia', texto: 'medir a suite de novo', hoje: HOJE });
}

function secao(t, n) {
  const ini = t.indexOf('## ' + n + '.');
  if (ini === -1) throw new Error('o texto nao tem a secao ' + n);
  const fim = t.indexOf('## ' + (n + 1) + '.');
  return t.slice(ini, fim === -1 ? undefined : fim);
}

test('H6a2 (3): refazer - HEAD, git status, o item do plano e as pendencias saem do disco de novo', () => {
  const c = cenario();
  andar(c);
  const r = hc.refazer(c.dir, c.texto, { frente: 'frente-x', agora: AGORA });
  assert.strictEqual(r.mudou, true);
  const t = r.texto;
  const head = comum.git(c.dir, ['rev-parse', 'HEAD']);
  assert.ok(secao(t, 2).includes(head), 'o HEAD novo: ' + secao(t, 2));
  assert.ok(!t.includes(c.headAntes), 'o HEAD velho sai');
  assert.match(secao(t, 2), /\?\? b\.js/, 'o git status de agora');
  assert.match(secao(t, 2), /feat: T2 pela metade/);
  assert.ok(secao(t, 3).includes('- [ ] T3 depois'), 'o proximo item aberto agora: ' + secao(t, 3));
  assert.ok(!secao(t, 3).includes('- [ ] T2 o passo de agora'), 'o item ja marcado sai');
  assert.match(secao(t, 3), /linha 5, texto do arquivo/);
  assert.match(secao(t, 5), /#2 2026-11-13 \| dono: Bia \| medir a suite de novo/, 'a pendencia nova');
  assert.match(secao(t, 5), /abertas em \.sworn\/PENDENCIAS\.md \(2\)/);
  assert.strictEqual(hc.conferir(t, c.rel).ok, true, JSON.stringify(hc.conferir(t, c.rel).problemas));
  assert.match(t, /^Refeito pelo gancho PreCompact do sworn em 2026-11-13 14:05: as secoes 2, 3 \(o item do plano\) e 5/m);
});

test('H6a2 (3): refazer - as secoes de julgamento, o outro repo e a linha do modelo nas pendencias ficam como estavam', () => {
  const c = cenario();
  andar(c);
  const t = hc.refazer(c.dir, c.texto, { frente: 'frente-x', agora: AGORA }).texto;
  for (const j of JUIZO) assert.ok(t.includes(j), 'sumiu o texto de julgamento: ' + j);
  assert.ok(secao(t, 3).includes(JUIZO[0]), 'o paragrafo do ONDE segue na secao 3');
  assert.ok(secao(t, 2).includes('- C:/outro-repo: main, HEAD abc123 (o repo vizinho)'), 'o repo que o modelo juntou fica');
  assert.ok(secao(t, 5).includes('- JUIZO-PEND combinado com o dono em 2026-11-13'), 'a linha do modelo nas pendencias fica');
  for (const l of MODELO_PARECIDO) assert.ok(secao(t, 5).includes(l + '\n'), 'a linha do modelo parecida com a mecanica fica: ' + l);
  for (const n of [1, 4, 6, 7, 8]) assert.strictEqual(secao(t, n), secao(c.texto, n), 'a secao ' + n + ' mudou');
  const parado = hc.refazer(c.dir, t, { frente: 'frente-x', agora: new Date(2026, 10, 13, 15, 0, 0) });
  assert.deepStrictEqual(parado, { texto: t, mudou: false }, 'disco parado: nem a hora se regrava');
  fs.writeFileSync(path.join(c.dir, 'd.js'), 'outro\n');
  const deNovo = hc.refazer(c.dir, t, { frente: 'frente-x', agora: new Date(2026, 10, 13, 15, 0, 0) }).texto;
  assert.strictEqual((deNovo.match(/^Refeito pelo gancho PreCompact/gm) || []).length, 1, 'a linha do refeito se troca, nao se soma');
  assert.match(deNovo, /em 2026-11-13 15:00:/);
  assert.match(secao(deNovo, 2), /\?\? d\.js/);
});

test('H6a2 (3): refazer - plano com todas as caixas marcadas: a secao 3 diz que nao ha mais item', () => {
  const c = cenario();
  andar(c);
  const plano = path.join(c.dir, 'docs', 'plano.md');
  fs.writeFileSync(plano, fs.readFileSync(plano, 'utf8').replace('- [ ] T3 depois', '- [x] T3 depois (s1: feito)'));
  const t = hc.refazer(c.dir, c.texto, { frente: 'frente-x', agora: AGORA }).texto;
  assert.match(secao(t, 3), /^O plano docs\/plano\.md nao tem mais item sem marcar \(lido antes da compactacao\): diga abaixo o que vem agora\.$/m);
  assert.ok(!secao(t, 3).includes('- [ ] T2'), 'o item velho sai');
  assert.ok(secao(t, 3).includes(JUIZO[0]), 'o julgamento fica');
});

test('H6a2 (3): refazer - secao 3 reescrita pelo modelo ou plano que nao se le agora: o item fica como estava', () => {
  const c = cenario();
  andar(c);
  const reescrita = c.texto.replace(/Proximo item nao marcado do plano \([^\n]*\n/, 'Estamos no T2, conferido a mao.\n');
  assert.ok(secao(hc.refazer(c.dir, reescrita, { frente: 'frente-x', agora: AGORA }).texto, 3).includes('- [ ] T2 o passo de agora'));
  fs.renameSync(path.join(c.dir, 'docs', 'plano.md'), path.join(c.dir, 'docs', 'plano-sumiu.md'));
  const t = hc.refazer(c.dir, c.texto, { frente: 'frente-x', agora: AGORA }).texto;
  assert.ok(secao(t, 3).includes('- [ ] T2 o passo de agora'), 'sem plano legivel, o item gravado fica: ' + secao(t, 3));
});

test('H6a2 (3): refazer - o que passaria do teto de 4 KB, ou o texto sem as secoes, volta como veio', () => {
  const c = cenario();
  andar(c);
  const encher = function (folga) {
    assert.ok(Buffer.byteLength(c.texto, 'utf8') < hc.TETO - folga, 'controle: o handoff do cenario cabe com a folga ' + folga);
    return c.texto.replace(JUIZO[1], JUIZO[1] + ' ' + 'x'.repeat(hc.TETO - Buffer.byteLength(c.texto, 'utf8') - folga));
  };
  // 40 bytes de folga: so a linha do "Refeito pelo gancho" ja passa disso, entao nenhum dos LIMITES cabe
  const cheio = encher(40);
  assert.deepStrictEqual(hc.refazer(c.dir, cheio, { frente: 'frente-x', agora: AGORA }), { texto: cheio, mudou: false });
  // 400 de folga: cabe refeito, sem cortar nada do julgamento
  const quase = encher(400);
  const r = hc.refazer(c.dir, quase, { frente: 'frente-x', agora: AGORA });
  assert.strictEqual(r.mudou, true);
  assert.ok(Buffer.byteLength(r.texto, 'utf8') <= hc.TETO, 'passou do teto: ' + Buffer.byteLength(r.texto, 'utf8'));
  assert.ok(secao(r.texto, 3).includes('- [ ] T3 depois'));
  for (const j of JUIZO) assert.ok(r.texto.includes(j), 'sumiu o texto de julgamento: ' + j);
  assert.ok(r.texto.includes(JUIZO[1] + ' ' + 'x'.repeat(hc.TETO - Buffer.byteLength(c.texto, 'utf8') - 400) + '\n'), 'o enchimento fica inteiro');
  for (const n of [1, 4, 6, 7, 8]) assert.strictEqual(secao(r.texto, n), secao(quase, n), 'a secao ' + n + ' mudou');
  const torto = '# so um titulo\n\nsem secao nenhuma\n';
  assert.deepStrictEqual(hc.refazer(c.dir, torto, { agora: AGORA }), { texto: torto, mudou: false });
});

test('H6a2 (3): refazer - secao 2 sem este repo ganha o bloco; pendencias ilegiveis e secoes fora de ordem ficam', () => {
  const c = cenario();
  andar(c);
  // o modelo tirou o bloco deste repo da topologia: ele volta, no topo, e o outro repo fica
  const semEste = c.texto.replace(secao(c.texto, 2), '## 2. Topologia\n- C:/outro-repo: main, HEAD abc123 (o repo vizinho)\n\n');
  const s2 = secao(hc.refazer(c.dir, semEste, { frente: 'frente-x', agora: AGORA }).texto, 2);
  const head = comum.git(c.dir, ['rev-parse', 'HEAD']);
  assert.ok(s2.includes(head) && s2.indexOf(head) < s2.indexOf('C:/outro-repo'), 'o bloco deste repo volta no topo: ' + s2);
  // fora de ordem: o texto volta como veio
  const torto = c.texto.replace(secao(c.texto, 6) + secao(c.texto, 7), secao(c.texto, 7) + secao(c.texto, 6));
  assert.notStrictEqual(torto, c.texto, 'controle: a troca das secoes 6 e 7 aconteceu');
  assert.deepStrictEqual(hc.refazer(c.dir, torto, { frente: 'frente-x', agora: AGORA }), { texto: torto, mudou: false });
  // PENDENCIAS.md que nao se le agora (uma pasta no lugar): a secao 5 gravada fica
  const arq = path.join(c.dir, '.sworn', 'PENDENCIAS.md');
  fs.renameSync(arq, arq + '.fora');
  fs.mkdirSync(arq);
  const t = hc.refazer(c.dir, c.texto, { frente: 'frente-x', agora: AGORA }).texto;
  assert.strictEqual(secao(t, 5), secao(c.texto, 5), 'sem PENDENCIAS legivel, a secao 5 fica');
});

test('H6a2 (3): refazer - so o git status falha (o HEAD responde): o git status gravado fica', () => {
  const c = cenario();
  andar(c);
  const gravado = secao(c.texto, 2);
  assert.match(gravado, /git status --short:/, 'controle: o handoff gravou a lista do status');
  // o indice ilegivel derruba o git status; o rev-parse HEAD nao le o indice
  fs.writeFileSync(path.join(c.dir, '.git', 'index'), 'lixo');
  const t = hc.refazer(c.dir, c.texto, { frente: 'frente-x', agora: AGORA }).texto;
  assert.strictEqual(secao(t, 2), gravado, 'a secao 2 gravada fica: ' + secao(t, 2));
  assert.ok(!t.includes('git status: nao respondeu'));
});

test('H6a2 (3): refazer - os pedidos do dono nao se leem agora: a linha gravada deles fica, e a do modelo com "- nao li " tambem', () => {
  const c = cenario();
  andar(c);
  const comPedidos = c.texto.replace('- JUIZO-PEND', '- pedidos do dono abertos (3): #4, #7, #9; o texto de cada um, com o comando: x\n- nao li o log do CI, falta acesso\n- JUIZO-PEND');
  const lista = path.join(c.dir, '.claude', 'sworn', 'pedidos', 'frente-x.md');
  fs.mkdirSync(lista, { recursive: true }); // uma pasta no lugar da lista: o pedidos.js lanca
  const s5 = secao(hc.refazer(c.dir, comPedidos, { frente: 'frente-x', agora: AGORA }).texto, 5);
  assert.ok(s5.includes('- pedidos do dono abertos (3): #4, #7, #9'), 'a linha gravada dos pedidos fica: ' + s5);
  assert.ok(!s5.includes('nao li os pedidos do dono'), 'sem o aviso no lugar dela');
  assert.ok(s5.includes('- nao li o log do CI, falta acesso'), 'a linha do modelo fica');
  assert.match(s5, /#2 2026-11-13 \| dono: Bia/, 'as pendencias, que se leem, saem do disco');
});

test('H6a2 (3): refazer - a secao 3 sem item aberto volta a ter item quando o plano ganha outro', () => {
  const c = cenario();
  andar(c);
  const plano = path.join(c.dir, 'docs', 'plano.md');
  fs.writeFileSync(plano, fs.readFileSync(plano, 'utf8').replace('- [ ] T3 depois', '- [x] T3 depois (s1: feito)'));
  const vazio = hc.refazer(c.dir, c.texto, { frente: 'frente-x', agora: AGORA }).texto;
  assert.match(secao(vazio, 3), /nao tem mais item sem marcar/, 'controle: a secao 3 ficou sem item');
  fs.appendFileSync(plano, '- [ ] T4 o novo\n');
  const t = hc.refazer(c.dir, vazio, { frente: 'frente-x', agora: AGORA }).texto;
  assert.ok(secao(t, 3).includes('- [ ] T4 o novo'), 'o item novo entra: ' + secao(t, 3));
  assert.ok(!/nao tem mais item/.test(secao(t, 3)));
  assert.ok(secao(t, 3).includes(JUIZO[0]), 'o julgamento fica');
  // o vazio que o montar escreve tambem se troca
  const doMontar = c.texto.replace(/Proximo item nao marcado do plano \([^\n]*\n\n[^\n]*\n[^\n]*\n/, 'O plano docs/plano.md nao tem item sem marcar: diga abaixo o que vem agora.\n');
  assert.match(secao(doMontar, 3), /diga abaixo o que vem agora/, 'controle: o vazio do montar entrou');
  assert.ok(secao(hc.refazer(c.dir, doMontar, { frente: 'frente-x', agora: AGORA }).texto, 3).includes('- [ ] T4 o novo'));
});

function estadoCom(sessao, dados) {
  const tmp = comum.pasta('pc-tmp');
  fs.mkdirSync(path.join(tmp, 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'sworn', sessao + '.json'), JSON.stringify(dados), 'utf8');
  return { SWORN_TMP: tmp };
}

function gancho(c, sessao, env) {
  return comum.rodar('scripts/antes-do-compact.js', [], {
    cwd: c.dir, env: env, entrada: { session_id: sessao, cwd: c.dir, hook_event_name: 'PreCompact', trigger: 'auto' }
  });
}

test('H6a2 (3): o gancho PreCompact refaz o handoff marcado nesta sessao, e o da ordem do compact anterior', () => {
  const c = cenario();
  andar(c);
  const r = gancho(c, 'p1', estadoCom('p1', { handoffDaSessao: c.abs, frente: 'frente-x' }));
  assert.strictEqual(r.status, 0, r.stderr);
  const t = fs.readFileSync(c.abs, 'utf8');
  assert.ok(t.includes(comum.git(c.dir, ['rev-parse', 'HEAD'])), 'o arquivo saiu com o HEAD novo');
  assert.ok(secao(t, 3).includes('- [ ] T3 depois'));
  for (const j of JUIZO) assert.ok(t.includes(j));
  // 2a compactacao: a abertura zerou o handoffDaSessao, e a ordem de reler guarda o caminho
  fs.writeFileSync(path.join(c.dir, 'c.js'), 'mais\n');
  const r2 = gancho(c, 'p2', estadoCom('p2', { handoffDaSessao: null, frente: 'frente-x', ordemDoCompact: { tipo: 'reler', arquivo: c.abs } }));
  assert.strictEqual(r2.status, 0, r2.stderr);
  assert.match(fs.readFileSync(c.abs, 'utf8'), /\?\? c\.js/);
});

test('H6a2 (3): o gancho sem handoff na sessao, ou com caminho fora de .sworn/handoff, nao grava nada', () => {
  const c = cenario();
  andar(c);
  const sem = gancho(c, 'p3', estadoCom('p3', { frente: 'frente-x' }));
  assert.strictEqual(sem.status, 0, sem.stderr);
  assert.strictEqual(fs.readFileSync(c.abs, 'utf8'), c.texto, 'sem marca na sessao, o handoff fica');
  const alvo = path.join(c.dir, 'a.js');
  const fora = gancho(c, 'p4', estadoCom('p4', { handoffDaSessao: alvo }));
  assert.strictEqual(fora.status, 0, fora.stderr);
  assert.strictEqual(fs.readFileSync(alvo, 'utf8'), '2\n', 'caminho que nao e de handoff nao se reescreve');
  // outro repo, com o disco andado (o refazer mudaria o handoff dele): o cwd desta sessao nao e a raiz dele
  const c2 = cenario();
  andar(c2);
  const longe = gancho(c, 'p5', estadoCom('p5', { handoffDaSessao: c2.abs, frente: 'frente-x' }));
  assert.strictEqual(longe.status, 0, longe.stderr);
  assert.strictEqual(fs.readFileSync(c2.abs, 'utf8'), c2.texto, 'handoff de outra raiz nao se reescreve');
  // nome de handoff numa pasta handoff que nao e a .sworn/handoff da raiz
  const lado = path.join(c.dir, 'docs', 'handoff', '2026-11-13-t2.md');
  fs.mkdirSync(path.dirname(lado), { recursive: true });
  fs.writeFileSync(lado, c.texto, 'utf8');
  const doLado = gancho(c, 'p7', estadoCom('p7', { handoffDaSessao: lado, frente: 'frente-x' }));
  assert.strictEqual(doLado.status, 0, doLado.stderr);
  assert.strictEqual(fs.readFileSync(lado, 'utf8'), c.texto, 'so a .sworn/handoff da raiz se reescreve');
  // o resumo de um chat parado (-retomar-) e foto do log antigo, nao o handoff desta sessao
  const retomar = path.join(path.dirname(c.abs), '2026-11-13-retomar-abc123.md');
  fs.writeFileSync(retomar, c.texto, 'utf8');
  const doResumo = gancho(c, 'p8', estadoCom('p8', { handoffDaSessao: retomar, frente: 'frente-x' }));
  assert.strictEqual(doResumo.status, 0, doResumo.stderr);
  assert.strictEqual(fs.readFileSync(retomar, 'utf8'), c.texto, 'o resumo -retomar- nao se reescreve');
  const quebrado = comum.rodar('scripts/antes-do-compact.js', [], { cwd: c.dir, entrada: 'nao e json', env: estadoCom('p6', {}) });
  assert.strictEqual(quebrado.status, 0, 'entrada torta nao derruba a compactacao: ' + quebrado.stderr);
  const vazia = comum.rodar('scripts/antes-do-compact.js', [], { cwd: c.dir, entrada: '', env: estadoCom('p10', {}) });
  assert.strictEqual(vazia.status, 0, 'entrada vazia nao derruba a compactacao: ' + vazia.stderr);
});

test('H6a2 (3): o gancho com o handoff marcado ja apagado do disco - nada se recria e a causa vai ao stderr', () => {
  const c = cenario();
  andar(c);
  fs.renameSync(c.abs, c.abs + '.fora');
  const r = gancho(c, 'p11', estadoCom('p11', { handoffDaSessao: c.abs, frente: 'frente-x' }));
  assert.strictEqual(r.status, 0, 'o arquivo sumido nao derruba a compactacao: ' + r.stderr);
  assert.ok(!fs.existsSync(c.abs), 'o handoff apagado nao se recria');
  assert.deepStrictEqual(fs.readdirSync(path.dirname(c.abs)).filter(function (n) { return n.endsWith('.tmp'); }), []);
  assert.match(r.stderr, /sworn: nao refiz o handoff antes de compactar, ele fica como estava: ENOENT/);
});

test('H6a2 (3): o gancho com a escrita do temporario falhando no meio - o temporario sai, o handoff fica e a causa vai ao stderr', () => {
  const c = cenario();
  andar(c);
  // o disco que enche no meio: o writeFileSync do .tmp grava metade e lanca
  const pre = path.join(comum.pasta('pc-pre'), 'disco-cheio.js');
  fs.writeFileSync(pre, "const fs = require('node:fs'); const orig = fs.writeFileSync;\n" +
    "fs.writeFileSync = function (p, d, o) { if (String(p).endsWith('.tmp')) { orig(p, String(d).slice(0, 40), o);" +
    " throw new Error('ENOSPC: disco cheio de ensaio'); } return orig.apply(this, arguments); };\n", 'utf8');
  const env = estadoCom('p9', { handoffDaSessao: c.abs, frente: 'frente-x' });
  // o NODE_OPTIONS come a barra invertida entre aspas: a barra normal serve nos dois sistemas
  env.NODE_OPTIONS = '--require "' + pre.replace(/\\/g, '/') + '"';
  const r = gancho(c, 'p9', env);
  assert.strictEqual(r.status, 0, 'a falha nao derruba a compactacao: ' + r.stderr);
  assert.strictEqual(fs.readFileSync(c.abs, 'utf8'), c.texto, 'o handoff fica como estava');
  const sobras = fs.readdirSync(path.dirname(c.abs)).filter(function (n) { return n.endsWith('.tmp'); });
  assert.deepStrictEqual(sobras, [], 'o temporario pela metade sai');
  assert.match(r.stderr, /sworn: nao refiz o handoff antes de compactar, ele fica como estava: ENOSPC: disco cheio de ensaio/);
});
