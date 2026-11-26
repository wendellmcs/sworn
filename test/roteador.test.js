'use strict';
// G4a, G4b e G4d (pedido 262, D928): o roteador diz o tipo da tarefa (a mensagem do dono e a edicao) e da, uma vez por
// sessao e por tipo, a linha com a peca do sworn; a skill local com "padrao" no nome nao toma o lugar da rota de tela;
// e o uso de cada skill do sworn vira contador, que a auditoria mostra. G4c: a rota de tela carrega a skill design, e o
// playbook (o manual) nao a cala mais.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const comum = require('./lib/comum.js');
const roteador = require('../scripts/lib/roteador.js');
const ordens = require('../scripts/lib/ordens.js');

const RAIZ = path.join(__dirname, '..');
const ASCII = /^[\x0a\x20-\x7e]*$/;

test('roteador: os tipos e a skill de cada um', () => {
  assert.deepStrictEqual(roteador.TIPOS, ['tela', 'plano', 'etapa', 'diagnosticar', 'aaa']);
  for (const tipo of roteador.TIPOS) assert.ok(ordens.TIPOS_DE_ORDEM.indexOf(tipo) !== -1, tipo + ' nao e ordem');
  assert.deepStrictEqual(roteador.TIPOS.map(function (t) { return ordens.SKILL_DA_ORDEM[t]; }),
    ['design', 'review-plan', 'drift', 'diagnose', 'effort-high']);
  // cada skill nomeada existe no plugin
  for (const tipo of roteador.TIPOS) {
    assert.ok(fs.existsSync(path.join(RAIZ, 'skills', ordens.SKILL_DA_ORDEM[tipo], 'SKILL.md')), tipo);
  }
});

test('roteador: doPedido acha o "por que deu errado" e o "siga o plano", e so eles', () => {
  for (const [frase, esperado] of [
    ['por que voce ignorou o plano?', ['diagnosticar']],
    ['Por que a sessão demorou tanto ontem?', ['diagnosticar']],
    ['pq o sworn ficou disparando o mesmo portao?', ['diagnosticar']],
    ['o que aconteceu nessa sessao', ['diagnosticar']],
    ['why did the agent fail at this?', ['diagnosticar']],
    ['what went wrong in that session', ['diagnosticar']],
    ['siga o plano em docs/x.md', ['plano']],
    ['Execute este plano, por favor', ['plano']],
    ['please implement the plan below', ['plano']],
    ['leia o PLAN.md e comece', ['plano']],
    ['por que voce nao seguiu o plano? siga o plano agora', ['diagnosticar', 'plano']],
    ['porque voce travou?', ['diagnosticar']],
    ['abra o plano.md e siga', ['plano']]
  ]) {
    assert.deepStrictEqual(roteador.doPedido(frase), esperado, frase);
  }
  // sem o que deu errado, e pergunta comum; e o "por que" vale na frase dele, nao no texto inteiro
  for (const frase of ['por que voce escolheu o node?', 'Voce rodou a suite. Por que o teste falhou?',
    'por que o teste falhou?', 'planeje a tela de login', 'leia a explanation.md',
    'o plano esta bom?', 'why is the sky blue', 'faca o commit', '', '   ',
    // "porque" e "pq" fora da pergunta sao "because"; o plano.md sem verbo de ler ou seguir nao e o pedido de seguir
    'o teste falhou porque o hook travou, corrija o teste', 'falhou pq o gancho travou',
    'crie um plano.md para a migracao', 'nao mexa no plan.md']) {
    assert.deepStrictEqual(roteador.doPedido(frase), [], frase);
  }
  for (const torto of [null, undefined, 5, {}, ['por que voce errou']]) assert.deepStrictEqual(roteador.doPedido(torto), []);
});

// O dono escreve "n" por "nao" ("pq vc n seguiu?"): o "n" sozinho conta como o "nao", so antes dos mesmos verbos.
test('roteador: doPedido le o "n" abreviado como o "nao" do que deu errado', () => {
  for (const frase of ['pq vc n seguiu o plano?', 'por que vc n leu o handoff', 'por que o claude n rodou os testes',
    'por que a sessao n funcionou']) {
    assert.deepStrictEqual(roteador.doPedido(frase), ['diagnosticar'], frase);
  }
  // o presente e pedido de fazer, nao de diagnosticar; e o "n" fora dos verbos e so uma letra
  for (const frase of ['pq vc n faz o push?', 'por que vc escolheu n = 5?', 'por que voce n?']) {
    assert.deepStrictEqual(roteador.doPedido(frase), [], frase);
  }
});

test('roteador: daEdicao acha tela, plano, etapa e AAA pelo arquivo e pela edicao', () => {
  const W = function (texto) { return { content: texto }; };
  const E = function (velho, novo) { return { old_string: velho, new_string: novo }; };
  const aaa = { marchas: { aaa: ['**/auth/**'], rapida: ['docs/**'] } };
  for (const [alvo, entrada, projeto, esperado] of [
    ['src/app.css', W('a{}'), null, ['tela']],
    ['web/Botao.tsx', E('a', 'b'), null, ['tela']],
    ['index.html', W('<p>'), null, ['tela']],
    ['src/App.vue', W('x'), null, ['tela']],
    ['tema/cores.json', W('{}'), { design: { caminhosDeEstilo: ['tema/**'] } }, ['tela']],
    ['src/a.js', W('x'), null, []],
    ['.context/plans/2026-11-25-x.md', W('# plano'), null, ['plano']],
    ['docs/PLAN.md', W('# p'), null, ['plano']],
    ['docs/plano-migracao.md', W('# p'), null, ['plano']],
    ['docs/feature-plan.md', W('# p'), null, ['plano']],
    ['docs/planning.md', W('# p'), null, []],
    ['docs/explanation.md', W('# p'), null, []],
    ['docs/PLAN.md', E('- [ ] a', '- [x] a'), null, ['etapa']],
    ['docs/PLAN.md', E('1. [ ] a', '1. [X] a (feito)'), null, ['etapa']],
    ['plans/fase.md', E('| **P2** | a |', '| **P2** [FEITO] | a |'), null, ['etapa']],
    ['docs/PLAN.md', E('- [ ] a', '- [ ] a\n- [ ] b'), null, []],
    ['docs/PLAN.md', E('- [x] a', '- [ ] a'), null, []],
    ['docs/notas.md', E('- [ ] a', '- [x] a'), null, []],
    ['src/auth/login.js', E('a', 'b'), aaa, ['aaa']],
    ['src/auth/Login.tsx', W('x'), aaa, ['tela', 'aaa']],
    ['src/auth/login.js', E('a', 'b'), null, []],
    ['src\\auth\\Login.tsx', W('x'), aaa, ['tela', 'aaa']]
  ]) {
    assert.deepStrictEqual(roteador.daEdicao(alvo, entrada, projeto), esperado, alvo + ' ' + JSON.stringify(entrada));
  }
  // entrada torta nunca lanca
  assert.deepStrictEqual(roteador.daEdicao(null, null, null), []);
  assert.deepStrictEqual(roteador.daEdicao('', {}, null), []);
  assert.deepStrictEqual(roteador.daEdicao('a.css', 'x', 5), ['tela']);
  assert.deepStrictEqual(roteador.daEdicao('docs/PLAN.md', { old_string: 5, new_string: null }, null), []);
  assert.deepStrictEqual(roteador.daEdicao('src/a.js', {}, { marchas: 'lixo' }), []);
  // MultiEdit: a caixa marcada em qualquer troca conta
  assert.deepStrictEqual(roteador.daEdicao('docs/PLAN.md', { edits: [E('x', 'y'), E('- [ ] b', '- [x] b'), 'lixo'] }, null),
    ['etapa']);
  assert.deepStrictEqual(roteador.daEdicao('docs/PLAN.md', { edits: [E('- [x] b', '- [ ] b'), E('- [ ] c', '- [x] c')] },
    null), []);
});

test('roteador: dar entrega a linha uma vez por sessao e por tipo, conta "dada" e fala ASCII', () => {
  const s = {};
  const r = roteador.dar(s, ['tela'], { alvo: 'web/app.css', temDesign: true });
  assert.strictEqual(r.textos.length, 1);
  const t = r.textos[0];
  for (const pedaco of ['web/app.css', 'sworn:design', 'pressionado', 'pior caso', 'prefers-reduced-motion', '24 x 24 px',
    '.claude/sworn/design.json', '--tela-depois', '"padrao"']) {
    assert.ok(t.indexOf(pedaco) !== -1, 'falta ' + pedaco + ' em: ' + t);
  }
  // a rota de tela nao manda mais carregar o manual: o playbook entra pela ordem do manual, nao por esta
  assert.strictEqual(t.indexOf('sworn:playbook'), -1, t);
  assert.ok(ASCII.test(t), t);
  assert.deepStrictEqual(r.dadas, ['tela']);
  assert.deepStrictEqual(r.pendentes, ['tela']);
  assert.strictEqual(s.contadores.ordem_tela_dada, 1);
  // a segunda vez na mesma sessao cala e nao conta
  s.rotasDadas = r.dadas;
  s.ordensPendentes = r.pendentes;
  const r2 = roteador.dar(s, ['tela'], { alvo: 'web/b.css', temDesign: true });
  assert.deepStrictEqual(r2.textos, []);
  assert.strictEqual(s.contadores.ordem_tela_dada, 1);
  // sem design.json, a linha nao o cita
  assert.strictEqual(roteador.dar({}, ['tela'], { alvo: 'a.css' }).textos[0].indexOf('design.json'), -1);
  // cada tipo nomeia a sua skill, em ASCII, com o arquivo quando ha
  for (const [tipo, skill] of [['plano', 'sworn:review-plan'], ['etapa', 'sworn:drift'],
    ['diagnosticar', 'sworn:diagnose'], ['aaa', 'sworn:effort-high']]) {
    const x = roteador.dar({}, [tipo], { alvo: 'docs/PLAN.md' }).textos;
    assert.strictEqual(x.length, 1, tipo);
    assert.ok(x[0].indexOf(skill) !== -1 && ASCII.test(x[0]), tipo + ': ' + x[0]);
    const semAlvo = roteador.dar({}, [tipo], {}).textos[0];
    assert.ok(semAlvo.indexOf(skill) !== -1 && semAlvo.indexOf('undefined') === -1, tipo + ' sem alvo: ' + semAlvo);
  }
  // o arquivo com caractere fora do ASCII sai em ASCII
  assert.ok(ASCII.test(roteador.dar({}, ['tela'], { alvo: 'web/botão.css' }).textos[0]));
  // o caminho comprido sai cortado em 200 caracteres
  const comprido = 'web/' + 'a'.repeat(400) + '.css';
  const cortado = roteador.dar({}, ['tela'], { alvo: comprido }).textos[0];
  assert.ok(cortado.indexOf('"' + comprido.slice(0, 200) + '..."') !== -1 && cortado.indexOf(comprido) === -1, cortado);
  // a aspa do caminho vira apostrofo: so a do texto abre e fecha o nome
  const aspa = roteador.dar({}, ['tela'], { alvo: 'web/a"b.css' }).textos[0];
  assert.ok(aspa.indexOf('"web/a\'b.css"') !== -1 && aspa.indexOf('a"b') === -1, aspa);
  // dois tipos de uma vez, na ordem dada; tipo repetido ou desconhecido nao entra
  const dois = roteador.dar({}, ['tela', 'aaa', 'tela', 'xpto'], { alvo: 'src/auth/Login.tsx' });
  assert.deepStrictEqual(dois.dadas, ['tela', 'aaa']);
  assert.strictEqual(dois.textos.length, 2);
  // estado torto nunca lanca
  assert.deepStrictEqual(roteador.dar(null, ['tela'], {}), { dadas: [], pendentes: [], textos: [] });
  const torto = { rotasDadas: 'lixo', ordensPendentes: 7 };
  assert.deepStrictEqual(roteador.dar(torto, ['plano'], null).dadas, ['plano']);
  assert.deepStrictEqual(roteador.dar({ rotasDadas: [null, 3, 'plano'] }, ['plano'], {}).textos, []);
  // a lista gravada torta sai limpa: sem repetido e sem tipo desconhecido
  assert.deepStrictEqual(roteador.dar({ rotasDadas: ['tela', 'tela', 'xpto', null] }, ['aaa'], {}).dadas, ['tela', 'aaa']);
  assert.deepStrictEqual(roteador.dar({}, 'tela', {}).textos, []);
});

test('roteador G4b: a skill do sworn que ja entrou cala a rota dela; a local com "padrao" no nome e o playbook, nao', () => {
  for (const [nome, tipo] of [['sworn:design', 'tela'], ['design', 'tela'], ['sworn:review-plan', 'plano'],
    ['sworn:drift', 'etapa'], ['sworn:diagnose', 'diagnosticar'], ['sworn:effort-high', 'aaa']]) {
    const s = {};
    s.rotasDadas = roteador.jaEntrou(s, nome);
    assert.deepStrictEqual(s.rotasDadas, [tipo], nome);
    assert.deepStrictEqual(roteador.dar(s, [tipo], {}).textos, [], nome);
  }
  for (const manual of ['padrao-aaa', 'sworn:playbook', 'playbook']) {
    const s = {};
    s.rotasDadas = roteador.jaEntrou(s, manual);
    assert.deepStrictEqual(s.rotasDadas, [], manual);
    assert.strictEqual(roteador.dar(s, ['tela'], { alvo: 'a.css' }).textos.length, 1, manual);
  }
  // o manual (o do projeto ou o playbook) cumpre a ordem do manual, nunca a da tela; a design cumpre a da tela
  const p = { ordensPendentes: ['manual', 'tela'] };
  assert.deepStrictEqual(ordens.marcarCumprida(p, 'padrao-aaa'), ['tela']);
  assert.deepStrictEqual(ordens.marcarCumprida(p, 'sworn:playbook'), ['tela']);
  assert.strictEqual((p.contadores || {}).ordem_tela_cumprida, undefined);
  assert.deepStrictEqual(ordens.marcarCumprida(p, 'sworn:design'), []);
  assert.strictEqual(p.contadores.ordem_tela_cumprida, 1);
  assert.deepStrictEqual(ordens.marcarCumprida({ ordensPendentes: ['manual', 'tela'] }, 'sworn:playbook'), ['tela']);
  // a skill de cada rota cumpre a ordem dela
  const q = { ordensPendentes: ['plano', 'etapa', 'diagnosticar', 'aaa'] };
  for (const nome of ['sworn:review-plan', 'sworn:drift', 'sworn:diagnose', 'sworn:effort-high']) ordens.marcarCumprida(q, nome);
  assert.deepStrictEqual(q.ordensPendentes, []);
  // nome torto devolve a lista que ja havia
  assert.deepStrictEqual(roteador.jaEntrou({ rotasDadas: ['plano'] }, null), ['plano']);
  assert.deepStrictEqual(roteador.jaEntrou(null, 'sworn:playbook'), []);
});

test('ordens G4d: o uso de cada skill do sworn e do manual do projeto vira contador', () => {
  const s = {};
  assert.strictEqual(ordens.marcarUso(s, 'sworn:review').uso_skill_review, 1);
  ordens.marcarUso(s, 'sworn:review');
  ordens.marcarUso(s, 'padrao-aaa');
  ordens.marcarUso(s, 'sworn:playbook');
  assert.deepStrictEqual(s.contadores, { uso_skill_review: 2, uso_skill_manual_do_projeto: 1, uso_skill_playbook: 1 });
  // o que nao e skill do sworn nem manual do projeto nao conta
  // (o "playbook" sem o prefixo cumpre a ordem do manual, mas nao e o uso do manual do projeto)
  // (a skill de outro plugin com "padrao" no nome tambem nao: o manual do projeto vem sem prefixo)
  for (const nome of ['sworn:nao-existe', 'outro:review', 'review', 'playbook', 'sworn:', 'sworn:../x', 'outro:padrao-x',
    null, 7]) {
    const t = {};
    assert.strictEqual(ordens.marcarUso(t, nome), null, String(nome));
    assert.strictEqual(t.contadores, undefined, String(nome));
  }
  assert.strictEqual(ordens.marcarUso(null, 'sworn:review'), null);
});

test('ordens G4d: as linhas do uso na auditoria - as chamadas, as nunca chamadas e o manual do projeto', () => {
  const skills = ordens.skillsDoPlugin();
  assert.ok(skills.length >= 15 && skills.indexOf('review') !== -1 && skills.indexOf('playbook') !== -1, skills.join());
  const antes = { uso_skill_review: 1 };
  const agora = { uso_skill_review: 4, uso_skill_handoff: 5, uso_skill_manual_do_projeto: 9, ordem_revisar_dada: 3 };
  const l = ordens.linhasDoUso(antes, agora, 7);
  assert.strictEqual(l[0], '- skills do sworn que o Claude chamou nos ultimos 7 dias: handoff 5, review 3');
  const nunca = skills.filter(function (n) { return n !== 'review' && n !== 'handoff'; });
  assert.strictEqual(l[1], '  nunca chamadas: ' + nunca.join(', '));
  assert.ok(/skill do projeto com "padrao" no nome foi chamada 9 vezes; o sworn:playbook, 0 vezes\. A do projeto cumpre so a ordem do manual: na edicao de tela, o sworn ainda pede o sworn:design\.$/.test(l[2]), l[2]);
  assert.strictEqual(l[l.length - 1], '  Skill do sworn nunca chamada e assunto do sworn, nao deste projeto: ou ele nao a ' +
    'ofereceu na hora certa, ou o projeto nao precisou dela. Diga isso ao dono numa linha, sem pedir decisao.');
  l.forEach(function (x) { assert.ok(ASCII.test(x), x); });
  // toda skill chamada: sem a lista das nunca chamadas e sem o pedido de relatar
  const todas = {};
  skills.forEach(function (n) { todas['uso_skill_' + n] = 1; });
  const cheia = ordens.linhasDoUso(null, todas, 7);
  assert.strictEqual(cheia.length, 1, cheia.join('\n'));
  assert.ok(cheia.every(function (x) { return x.indexOf('nunca chamada') === -1; }), cheia.join('\n'));
  // sem nenhum contador de uso (nada medido ainda): silencio
  assert.deepStrictEqual(ordens.linhasDoUso(null, { ordem_revisar_dada: 3 }, 7), []);
  assert.deepStrictEqual(ordens.linhasDoUso(null, null, null), []);
  // sem o manual do projeto, sem a linha dele
  assert.ok(ordens.linhasDoUso(null, { uso_skill_review: 1 }, null).every(function (x) { return x.indexOf('padrao') === -1; }));
  assert.strictEqual(ordens.linhasDoUso(null, { uso_skill_review: 1 }, null)[0],
    '- skills do sworn que o Claude chamou desde o comeco: review 1');
  // os totais do projeto trazem os contadores de uso junto com os de ordem
  const dir = comum.temporaria('sworn-uso-');
  try {
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'contadores.json'),
      JSON.stringify({ uso_skill_review: 2, uso_skill_x: 'lixo', ordem_tela_dada: 1, fecho_sem_evidencia: 4 }), 'utf8');
    assert.deepStrictEqual(ordens.totaisDasOrdens(dir), { uso_skill_review: 2, ordem_tela_dada: 1 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- os ganchos: abrir-turno (a mensagem), portao-escopo (a edicao) e marcar-trabalho (a skill que entrou) ----

function sessoesEm(dir) {
  const sessoes = path.join(dir, '_sessoes');
  fs.mkdirSync(path.join(sessoes, 'sworn'), { recursive: true });
  return sessoes;
}
function lerEstado(dir, id) {
  return JSON.parse(fs.readFileSync(path.join(dir, '_sessoes', 'sworn', id + '.json'), 'utf8'));
}
/** O estado da sessao, ou {} quando o gancho nao gravou nenhum; o arquivo torto lanca e reprova o teste. */
function estadoSeHouver(dir, id) {
  return fs.existsSync(path.join(dir, '_sessoes', 'sworn', id + '.json')) ? lerEstado(dir, id) : {};
}
function processo(dir, script, entrada) {
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', script)], {
    cwd: dir, encoding: 'utf8', input: JSON.stringify(entrada), timeout: comum.PRAZO,
    env: Object.assign({}, process.env, { SWORN_TMP: sessoesEm(dir) })
  });
  assert.strictEqual(r.status, 0, script + ': ' + r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}
function contexto(saida) {
  return saida && saida.hookSpecificOutput ? saida.hookSpecificOutput.additionalContext || '' : '';
}
function editar(dir, id, rel, extra) {
  const alvo = path.join(dir, rel);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  const r = comum.ganchoComoProcesso('scripts/portao-escopo.js', Object.assign({ session_id: id, cwd: dir,
    hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: alvo, content: 'a{}' } }, extra || {}),
    { env: Object.assign({}, process.env, { SWORN_TMP: sessoesEm(dir) }) });
  // o gancho que quebra (ou falha e libera) sai sem o contexto: sem este status, o "sem rota" passaria por acaso
  assert.strictEqual(r.status, 0, rel + ': ' + r.stderr);
  return r;
}
function skill(dir, id, nome) {
  return processo(dir, 'marcar-trabalho.js', { session_id: id, cwd: dir, hook_event_name: 'PostToolUse',
    tool_name: 'Skill', tool_input: { skill: nome } });
}

test('rota no abrir-turno: o "por que deu errado" e o "siga o plano" chegam uma vez por sessao', () => {
  const dir = comum.temporaria('sworn-rota-turno-');
  try {
    const turno = function (id, prompt) {
      return processo(dir, 'abrir-turno.js', { session_id: id, cwd: dir, hook_event_name: 'UserPromptSubmit', prompt: prompt });
    };
    assert.ok(contexto(turno('d1', 'por que voce ignorou o plano?')).indexOf('sworn:diagnose') !== -1);
    assert.deepStrictEqual(lerEstado(dir, 'd1').rotasDadas, ['diagnosticar']);
    assert.strictEqual(lerEstado(dir, 'd1').contadores.ordem_diagnosticar_dada, 1);
    assert.strictEqual(contexto(turno('d1', 'por que voce ignorou o plano de novo?')).indexOf('sworn:diagnose'), -1);
    assert.ok(contexto(turno('d1', 'siga o plano docs/PLAN.md')).indexOf('sworn:review-plan') !== -1);
    assert.strictEqual(contexto(turno('d2', 'faca o commit')).indexOf('sworn:'), -1);
    // o subagente nao recebe rota nem gasta a do principal
    const sub = processo(dir, 'abrir-turno.js', { session_id: 'd3', cwd: dir, agent_id: 'a1',
      hook_event_name: 'UserPromptSubmit', prompt: 'por que voce ignorou o plano?' });
    assert.strictEqual(contexto(sub).indexOf('sworn:diagnose'), -1);
    assert.strictEqual(lerEstado(dir, 'd3').rotasDadas, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('rota no portao-escopo: a 1a edicao de tela da sessao traz a rubrica, sem projeto.json, e so ela', () => {
  const dir = comum.temporaria('sworn-rota-edicao-');
  try {
    const r = editar(dir, 'e1', 'web/app.css');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(contexto(r.json).indexOf('sworn:design') !== -1, JSON.stringify(r.json));
    assert.strictEqual(r.json.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.strictEqual(r.json.hookSpecificOutput.permissionDecision, undefined);
    // o aviso do projeto sem projeto.json segue junto
    assert.ok(/sworn\/init|projeto\.json/.test(r.json.systemMessage || ''), JSON.stringify(r.json));
    assert.deepStrictEqual(lerEstado(dir, 'e1').rotasDadas, ['tela']);
    const r2 = editar(dir, 'e1', 'web/b.css');
    assert.strictEqual(contexto(r2.json), '');
    // a skill da rota cumpre a ordem
    skill(dir, 'e1', 'sworn:design');
    assert.strictEqual(lerEstado(dir, 'e1').contadores.ordem_tela_cumprida, 1);
    // o subagente nao recebe a rota
    assert.strictEqual(contexto(editar(dir, 'e2', 'web/app.css', { agent_id: 'a1' }).json), '');
    // arquivo de logica, sem rota
    assert.strictEqual(contexto(editar(dir, 'e3', 'src/a.js').json), '');
    // o aviso do projeto sem projeto.json ja saiu nesta sessao: a 1a tela leva a rota mesmo assim
    const depoisDoAviso = editar(dir, 'e3', 'web/c.css');
    assert.strictEqual(depoisDoAviso.json.systemMessage, undefined, JSON.stringify(depoisDoAviso.json));
    assert.ok(contexto(depoisDoAviso.json).indexOf('sworn:design') !== -1, JSON.stringify(depoisDoAviso.json));
    // o apagar do Codex (Write com apagar) nao e edicao de tela: sem rota e sem gastar a da sessao
    const apagou = editar(dir, 'e4', 'web/app.css', { tool_input: { file_path: path.join(dir, 'web', 'app.css'), apagar: true } });
    assert.strictEqual(contexto(apagou.json), '');
    assert.strictEqual(estadoSeHouver(dir, 'e4').rotasDadas, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('rota no portao-escopo: a edicao negada nao leva rota', () => {
  const dir = comum.temporaria('sworn-rota-negada-');
  try {
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify({ versaoConfig: 1,
      marchaPadrao: 'padrao', intocaveis: ['segredos/**'], marchas: { rapida: ['docs/**'] } }), 'utf8');
    const r = editar(dir, 'n1', 'segredos/a.css');
    assert.strictEqual(r.json.hookSpecificOutput.permissionDecision, 'deny');
    assert.strictEqual(contexto(r.json).indexOf('sworn:design'), -1);
    assert.strictEqual(estadoSeHouver(dir, 'n1').rotasDadas, undefined);
    // a marcha rapida passa e leva a rota
    const semDesign = contexto(editar(dir, 'n1', 'docs/pagina.html').json);
    assert.ok(semDesign.indexOf('sworn:design') !== -1, semDesign);
    assert.strictEqual(semDesign.indexOf('design.json'), -1, semDesign);
    // com o design.json do projeto, a rota de tela manda usar so os valores dele
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'design.json'), '{}', 'utf8');
    assert.ok(contexto(editar(dir, 'n2', 'docs/b.css').json).indexOf('.claude/sworn/design.json') !== -1);
    // a marcha padrao, com escopo declarado e o arquivo ja no disco, passa pelo fim do portao e leva a rota
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'escopo.md'), '# Escopo\n**Objetivo:** a rota no fim do portao\n' +
      '## Dentro\n- `web/**`\n## Fora de escopo\n- `segredos/**`\n', 'utf8');
    fs.mkdirSync(path.join(dir, 'web'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'web', 'a.css'), 'b{}', 'utf8');
    const padrao = editar(dir, 'n3', 'web/a.css');
    assert.strictEqual((padrao.json.hookSpecificOutput || {}).permissionDecision, undefined, JSON.stringify(padrao.json));
    assert.ok(contexto(padrao.json).indexOf('sworn:design') !== -1, JSON.stringify(padrao.json));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('G4b no gancho: com a skill local "padrao-aaa" ou o playbook carregado, a rota de tela entra; com a design, nao', () => {
  const dir = comum.temporaria('sworn-rota-g4b-');
  try {
    skill(dir, 'b1', 'padrao-aaa');
    assert.strictEqual(lerEstado(dir, 'b1').manualCarregado, true);
    assert.strictEqual(lerEstado(dir, 'b1').contadores.uso_skill_manual_do_projeto, 1);
    assert.ok(contexto(editar(dir, 'b1', 'web/app.css').json).indexOf('sworn:design') !== -1);
    skill(dir, 'b2', 'sworn:design');
    assert.strictEqual(lerEstado(dir, 'b2').contadores.uso_skill_design, 1);
    assert.strictEqual(contexto(editar(dir, 'b2', 'web/app.css').json), '');
    // o playbook e o manual: carregado, ele nao cala a rota de tela
    skill(dir, 'b4', 'sworn:playbook');
    assert.strictEqual(lerEstado(dir, 'b4').contadores.uso_skill_playbook, 1);
    assert.ok(contexto(editar(dir, 'b4', 'web/app.css').json).indexOf('sworn:design') !== -1);
    // o subagente que chama uma skill nao conta uso nem cala a rota do principal
    processo(dir, 'marcar-trabalho.js', { session_id: 'b3', cwd: dir, agent_id: 'a1', hook_event_name: 'PostToolUse',
      tool_name: 'Skill', tool_input: { skill: 'sworn:design' } });
    assert.ok(contexto(editar(dir, 'b3', 'web/app.css').json).indexOf('sworn:design') !== -1);
    assert.strictEqual((lerEstado(dir, 'b3').contadores || {}).uso_skill_design, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('roteador pela ponte: a linha manda ler o SKILL.md inteiro, e a rota AAA nao sai', () => {
  const antes = process.env.SWORN_PONTE;
  try {
    process.env.SWORN_PONTE = '1';
    for (const tipo of ['tela', 'plano', 'etapa', 'diagnosticar']) {
      const nome = ordens.SKILL_DA_ORDEM[tipo];
      const t = roteador.dar({}, [tipo], { alvo: 'docs/PLAN.md' }).textos[0];
      assert.strictEqual(t.indexOf('ferramenta Skill'), -1, tipo + ': ' + t);
      assert.ok(t.indexOf('leia inteiro o SKILL.md') !== -1, tipo + ': ' + t);
      assert.ok(t.indexOf('.agents/skills/sworn-' + nome + '/SKILL.md') !== -1, tipo + ': ' + t);
      assert.ok(t.indexOf(' skills/' + nome + '/SKILL.md') !== -1, tipo + ': ' + t);
      assert.ok(ASCII.test(t), tipo + ': ' + t);
    }
    // o effort-high so existe no Claude Code (o instalador nao o copia): a rota AAA nao sai nem vira ordem
    const s = {};
    const r = roteador.dar(s, ['tela', 'aaa'], { alvo: 'src/auth/Login.tsx' });
    assert.deepStrictEqual(r.dadas, ['tela']);
    assert.deepStrictEqual(r.pendentes, ['tela']);
    assert.strictEqual(r.textos.length, 1);
    assert.strictEqual(r.textos[0].indexOf('effort-high'), -1, r.textos[0]);
    assert.deepStrictEqual(roteador.dar({}, ['aaa'], {}), { dadas: [], pendentes: [], textos: [] });
    // sem a ponte, a rota AAA segue saindo
    process.env.SWORN_PONTE = '0';
    assert.deepStrictEqual(roteador.dar({}, ['aaa'], {}).dadas, ['aaa']);
  } finally {
    if (antes === undefined) delete process.env.SWORN_PONTE; else process.env.SWORN_PONTE = antes;
  }
});
