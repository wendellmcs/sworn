'use strict';
// C3 (D808, D769 (b)): o inspetor um degrau acima do executor. O modelo da sessao sai da transcricao; o gancho troca o
// `model` do despacho do sworn:inspector pelo updatedInput, e so dele. F4e: o mesmo gancho reescreve o `prompt` de todo
// agente, do sworn ou de fora dele (G4e parte 5), com o guia do modelo que vai roda-lo no fim.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const comum = require('./lib/comum.js');

const lib = require('../scripts/lib/juiz.js');
const GANCHO = path.join(__dirname, '..', 'scripts', 'portao-juiz.js');

function pasta(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-juiz-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function transcricao(dir, modelos) {
  const linhas = [JSON.stringify({ type: 'user', message: { content: 'oi' } })].concat(modelos.map(function (m) {
    return JSON.stringify({ type: 'assistant', message: { model: m, content: [] } });
  }));
  const arquivo = path.join(dir, 'sessao.jsonl');
  fs.writeFileSync(arquivo, linhas.join('\n') + '\n');
  return arquivo;
}

// F1g (s372): no processo do teste (comum.ganchoComoProcesso), com o ambiente do teste, como o spawnSync herdava; o
// gancho que falha e libera volta com status 1, e o assert o pega. G4e parte 5: sem as variaveis do modelo do subagente
// da maquina, e com a pasta do usuario numa pasta do teste; `env` acrescenta ou tira (undefined) variaveis
function gancho(dir, entrada, env) {
  const isolado = { CLAUDE_CODE_SUBAGENT_MODEL: undefined, CLAUDE_CODE_SUBAGENT_MODEL_FORCE: undefined,
    CLAUDE_CONFIG_DIR: path.join(dir, 'config-do-usuario') };
  const r = comum.ganchoComoProcesso(GANCHO, Object.assign({ cwd: dir }, entrada),
    { cwd: dir, env: Object.assign({}, process.env, isolado, env) });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.json;
}

test('C3 juiz: o degrau acima do executor; o desconhecido fica com o do agente', () => {
  assert.strictEqual(lib.juizDe('haiku'), 'sonnet');
  assert.strictEqual(lib.juizDe('sonnet'), 'opus');
  assert.strictEqual(lib.juizDe('opus'), 'opus');
  assert.strictEqual(lib.juizDe(''), null);
  assert.strictEqual(lib.juizDe('constructor'), null, 'so os degraus, nunca o que o objeto herda');
  assert.strictEqual(lib.jaBasta('opus', 'sonnet'), true);
  assert.strictEqual(lib.jaBasta('sonnet', 'sonnet'), true);
  assert.strictEqual(lib.jaBasta('haiku', 'sonnet'), false);
  assert.strictEqual(lib.jaBasta(undefined, 'sonnet'), false);
  // o pedido vale pelo apelido; o que nao se entende fica como veio (troca-lo podia rebaixar)
  assert.strictEqual(lib.jaBasta('Opus', 'sonnet'), true);
  assert.strictEqual(lib.jaBasta('claude-opus-4-1', 'sonnet'), true);
  assert.strictEqual(lib.jaBasta('claude-haiku-5-5', 'sonnet'), false);
  assert.strictEqual(lib.jaBasta('inherit', 'sonnet'), false, 'inherit e o modelo da sessao: o juiz sobe');
  assert.strictEqual(lib.jaBasta('Inherit', 'sonnet'), false, 'a caixa nao muda o inherit');
  assert.strictEqual(lib.jaBasta('modelo-qualquer', 'sonnet'), true, 'o id sem apelido fica como veio');
});

test('C3 juiz: o modelo da sessao e o da ultima resposta, sem a sintetica; sem arquivo, nao se sabe', () => {
  pasta(function (dir) {
    assert.strictEqual(lib.modeloDaSessao(transcricao(dir, ['claude-opus-5-5', 'claude-haiku-5-5', '<synthetic>'])),
      'haiku');
    assert.strictEqual(lib.modeloDaSessao(path.join(dir, 'nao-existe.jsonl')), '');
    assert.strictEqual(lib.modeloDaSessao(undefined), '');
    fs.writeFileSync(path.join(dir, 'cortada.jsonl'), '{"type":"assistant","message":{"mod\n');
    assert.strictEqual(lib.modeloDaSessao(path.join(dir, 'cortada.jsonl')), '', 'a linha cortada fica de fora');
  });
});

test('C3 juiz: o gancho sobe o inspetor um degrau, so o inspetor, e respeita o pedido mais forte e a chave', () => {
  pasta(function (dir) {
    const haiku = transcricao(dir, ['claude-haiku-5-5']);
    const inspetor = { tool_name: 'Agent', transcript_path: haiku,
      tool_input: { subagent_type: 'sworn:inspector', prompt: 'lente', description: 'x' } };
    const r = gancho(dir, inspetor);
    assert.strictEqual(r.hookSpecificOutput.updatedInput.model, 'sonnet');
    // F4e: o pedido segue, com o guia do modelo que vai rodar no fim
    assert.ok(r.hookSpecificOutput.updatedInput.prompt.startsWith('lente\n\nGuidance for claude-sonnet-5-5 '),
      r.hookSpecificOutput.updatedInput.prompt);
    assert.strictEqual(r.hookSpecificOutput.updatedInput.description, 'x', 'o resto do pedido segue igual');
    assert.strictEqual(r.hookSpecificOutput.permissionDecision, undefined, 'o gancho nao decide permissao');
    // fora do Claude Code o inspetor se chama sworn-inspector
    const fora = gancho(dir, Object.assign({}, inspetor, { tool_input: { subagent_type: 'sworn-inspector' } }));
    assert.strictEqual(fora.hookSpecificOutput.updatedInput.model, 'sonnet');
    assert.match(fora.hookSpecificOutput.updatedInput.prompt, /^Guidance for claude-sonnet-5-5 /, 'sem prompt, so o guia, sem "undefined"');
    assert.ok(!/undefined/.test(fora.hookSpecificOutput.updatedInput.prompt));
    // outro agente nao sobe de modelo (so leva o guia do dele, G4e parte 5)
    const outro = gancho(dir, Object.assign({}, inspetor, { tool_input: { subagent_type: 'general-purpose' } }));
    assert.strictEqual(outro.hookSpecificOutput.updatedInput.model, undefined);
    assert.match(outro.hookSpecificOutput.updatedInput.prompt, /^Guidance for claude-haiku-5-5 /);
    // o pedido que ja e mais forte fica (e leva o guia dele, F4e)
    const forte = gancho(dir, Object.assign({}, inspetor,
      { tool_input: { subagent_type: 'sworn:inspector', model: 'opus', prompt: 'lente' } }));
    assert.strictEqual(forte.hookSpecificOutput.updatedInput.model, 'opus');
    assert.match(forte.hookSpecificOutput.updatedInput.prompt, /^lente\n\nGuidance for claude-opus-5-5 /);
    // a sessao no Sonnet sobe o juiz para o Opus
    const sonnet = gancho(dir, Object.assign({}, inspetor, { transcript_path: transcricao(dir, ['claude-sonnet-5-5']) }));
    assert.strictEqual(sonnet.hookSpecificOutput.updatedInput.model, 'opus');
    // sem saber o modelo da sessao, o modelo fica como veio (o Sonnet do agents/inspector.md, que leva o guia dele)
    const semSessao = gancho(dir, Object.assign({}, inspetor, { transcript_path: path.join(dir, 'x.jsonl') }));
    assert.strictEqual(semSessao.hookSpecificOutput.updatedInput.model, undefined);
    assert.match(semSessao.hookSpecificOutput.updatedInput.prompt, /Guidance for claude-sonnet-5-5 /);
    // a chave desliga o juiz; o guia do modelo que vai rodar segue
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify({ juizAcima: false }));
    const semJuiz = gancho(dir, Object.assign({}, inspetor, { transcript_path: haiku }));
    assert.strictEqual(semJuiz.hookSpecificOutput.updatedInput.model, undefined);
    assert.match(semJuiz.hookSpecificOutput.updatedInput.prompt, /Guidance for claude-sonnet-5-5 /);
    // as duas chaves desligadas: passa como veio
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify({ juizAcima: false, guiaDoModelo: false }));
    assert.strictEqual(gancho(dir, Object.assign({}, inspetor, { transcript_path: haiku })), null);
  });
});

// D829: as rondas 2 e 3 da revisao cega so conferem e rodam um degrau abaixo do juiz da ronda 1
test('D829 juiz: a ronda sai do caminho de vereditos do briefing, com barra de qualquer sistema', () => {
  assert.strictEqual(lib.rondaDoBriefing('Verdicts folder: `C:/p/.claude/sworn/revisao/scripts__a.js/2/vereditos`.'), 2);
  assert.strictEqual(lib.rondaDoBriefing('C:\\p\\.claude\\sworn\\revisao\\GUIA.md\\3\\vereditos'), 3);
  assert.strictEqual(lib.rondaDoBriefing('/p/.claude/sworn/revisao/a.js/2/invertida/vereditos'), 2, 'a 2a passada');
  assert.strictEqual(lib.rondaDoBriefing('/p/.claude/sworn/revisao/a.js/1/vereditos'), 1);
  for (const t of ['', null, undefined, 'lente', '/p/revisao-fechada/a.js/2/vereditos', '/p/revisao/a.js/2/A.txt',
    '/p/revisao/a.js/2/vereditosx', '/p/revisao/a.js/x/vereditos']) {
    assert.strictEqual(lib.rondaDoBriefing(t), 0, JSON.stringify(t));
  }
});

test('D829 juiz: o modelo do despacho - ronda 1 no juiz, rondas 2 e 3 um degrau abaixo dele', () => {
  const r2 = { prompt: 'x /p/.claude/sworn/revisao/a.js/2/vereditos y' };
  assert.deepStrictEqual(['haiku', 'sonnet', 'opus', 'fable'].map(lib.conferenteDe), ['haiku', 'haiku', 'sonnet', 'opus']);
  assert.strictEqual(lib.conferenteDe('constructor'), null);
  // sessao Opus: Opus na ronda 1, Sonnet nas rondas 2 e 3, com qualquer pedido
  assert.strictEqual(lib.alvoDoDespacho('opus', { prompt: 'ronda 1' }), 'opus');
  assert.strictEqual(lib.alvoDoDespacho('opus', r2), 'sonnet');
  assert.strictEqual(lib.alvoDoDespacho('opus', Object.assign({ model: 'haiku' }, r2)), 'sonnet', 'o pedido mais fraco sobe');
  assert.strictEqual(lib.alvoDoDespacho('opus', Object.assign({ model: 'opus' }, r2)), 'sonnet', 'o pedido mais forte desce');
  assert.strictEqual(lib.alvoDoDespacho('opus', Object.assign({ model: 'claude-sonnet-5-5' }, r2)), null, 'ja no alvo, fica');
  // sessao Sonnet: juiz Opus, rondas 2 e 3 no Sonnet; sessao Haiku: juiz Sonnet, rondas 2 e 3 no Haiku
  assert.strictEqual(lib.alvoDoDespacho('sonnet', r2), 'sonnet');
  assert.strictEqual(lib.alvoDoDespacho('haiku', r2), 'haiku');
  // ronda 1 com pedido mais forte fica como veio (C3); sessao desconhecida, nada muda
  assert.strictEqual(lib.alvoDoDespacho('haiku', { model: 'opus', prompt: 'ronda 1' }), null);
  assert.strictEqual(lib.alvoDoDespacho('', r2), null);
});

// pendencia #2: o briefing por arquivo so traz o caminho do .txt no pedido; a ronda esta dentro do arquivo
test('pendencia #2 juiz: a ronda sai tambem do arquivo de briefing que o pedido cita', () => {
  pasta(function (dir) {
    const vereditos = path.join(dir, '.claude', 'sworn', 'revisao', 'a.js', '3', 'vereditos');
    const briefing = path.join(dir, 'b 35r3', '1.txt');
    fs.mkdirSync(path.dirname(briefing), { recursive: true });
    fs.writeFileSync(briefing, 'Lens: correcao\nVerdicts folder: `' + vereditos + '`\n');
    const doisMd = path.join(dir, '2.md');
    fs.writeFileSync(doisMd, 'Verdicts folder: ' + vereditos.replace(/\\/g, '/') + '\n');
    // entre crases (a pasta temporaria pode ter espaco: o caminho solto so se testa abaixo, numa pasta sem espaco)
    const c = (f) => '`' + f + '`';
    assert.strictEqual(lib.rondaDoPedido('Your full briefing is in ' + c(doisMd) + '. Read it first.'), 3);
    assert.strictEqual(lib.rondaDoPedido('briefing: ' + c(doisMd.replace(/\\/g, '/'))), 3, 'barra normal');
    // o caminho do proprio pedido manda: o arquivo nem se abre
    assert.strictEqual(lib.rondaDoPedido('x ' + c(path.join(dir, '.claude', 'sworn', 'revisao', 'a.js', '2', 'vereditos')) +
      ' ' + c(doisMd)), 2);
    // arquivo que nao existe, sem o caminho dentro, ou citado depois do teto de 3: ronda 1 (0)
    const vazio = path.join(dir, 'vazio.txt');
    fs.writeFileSync(vazio, 'Lens: correcao\n');
    assert.strictEqual(lib.rondaDoPedido('briefing ' + c(path.join(dir, 'nao-existe.txt'))), 0);
    assert.strictEqual(lib.rondaDoPedido('briefing ' + c(vazio)), 0);
    assert.strictEqual(lib.rondaDoPedido([vazio, vazio, vazio, doisMd].map(c).join(' ')), 0, 'so os 3 primeiros citados');
    assert.strictEqual(lib.rondaDoPedido([vazio, vazio, doisMd].map(c).join(' ')), 3, 'o terceiro ainda se le');
    assert.strictEqual(lib.rondaDoPedido(undefined), 0);
    // o despacho: sessao Opus, briefing da ronda 3 por arquivo -> Sonnet
    assert.strictEqual(lib.alvoDoDespacho('opus', { prompt: 'Your full briefing is in ' + c(doisMd) + '.' }), 'sonnet');
    // entre crases, o caminho com espaco vale inteiro
    assert.strictEqual(lib.rondaDoPedido('Your full briefing is in ' + c(briefing) + '.'), 3);
  });
  // o caminho solto (absoluto, sem crase) vai ate o primeiro espaco, na ordem em que aparece no pedido; precisa de uma
  // pasta sem espaco: a temporaria, ou a raiz do disco quando a temporaria tem espaco (sem escrita nela, pula)
  let semEspaco = null;
  for (const base of [os.tmpdir(), path.parse(os.tmpdir()).root]) {
    if (/\s/.test(base)) continue;
    try { semEspaco = fs.mkdtempSync(path.join(base, 'sworn-juiz-')); break; } catch (e) { /* sem escrita: a proxima */ }
  }
  if (!semEspaco) return;
  try {
    const vereditos = path.join(semEspaco, 'revisao', 'a.js', '2', 'vereditos');
    const solto = path.join(semEspaco, '4.txt');
    fs.writeFileSync(solto, 'Verdicts folder: ' + vereditos + '\n');
    const vazio = path.join(semEspaco, 'vazio.md');
    fs.writeFileSync(vazio, 'Lens: borda\n');
    assert.strictEqual(lib.rondaDoPedido('briefing ' + solto), 2);
    assert.strictEqual(lib.rondaDoPedido('briefing ' + solto.replace(/\\/g, '/') + '.'), 2, 'barra normal e ponto final');
    // outro arquivo que so comeca igual nao e o 4.txt: nem 4.txt.bak, nem 4.txtx
    assert.strictEqual(lib.rondaDoPedido('briefing ' + solto + '.bak'), 0);
    assert.strictEqual(lib.rondaDoPedido('briefing ' + solto + 'x'), 0);
    // a ordem e a do pedido: o solto citado antes de dois entre crases se le primeiro
    assert.strictEqual(lib.rondaDoPedido('briefing em ' + solto + '; veja `' + vazio + '`, `' + vazio + '`, `' + vazio + '`'), 2);
    // o caminho entre crases nao se le de novo como solto (cada citacao conta uma vez no teto; a repetida conta de
    // novo, como acima com o mesmo vazio tres vezes)
    assert.strictEqual(lib.rondaDoPedido('`' + vazio + '` `' + vazio + '` ' + solto), 2, 'crase contada uma vez');
    const comEspaco = path.join(semEspaco, 'b 1', '5.txt');
    fs.mkdirSync(path.dirname(comEspaco));
    fs.writeFileSync(comEspaco, 'Verdicts folder: ' + vereditos + '\n');
    assert.strictEqual(lib.rondaDoPedido('briefing ' + comEspaco), 0, 'solto, para no espaco e nao se abre');
  } finally {
    fs.rmSync(semEspaco, { recursive: true, force: true });
  }
});

test('D829 juiz: o gancho poe o inspetor da ronda 2 um degrau abaixo do juiz', () => {
  pasta(function (dir) {
    const opus = transcricao(dir, ['claude-opus-5-5']);
    const despacho = function (prompt, model) {
      const entrada = { tool_name: 'Agent', transcript_path: opus,
        tool_input: { subagent_type: 'sworn:inspector', prompt: prompt, description: 'x' } };
      if (model) entrada.tool_input.model = model;
      return gancho(dir, entrada);
    };
    assert.strictEqual(despacho('Verdicts folder: `' + dir + '/.claude/sworn/revisao/a.js/1/vereditos`').hookSpecificOutput
      .updatedInput.model, 'opus');
    const r2 = despacho('Verdicts folder: `' + dir + '/.claude/sworn/revisao/a.js/2/vereditos`', 'opus');
    assert.strictEqual(r2.hookSpecificOutput.updatedInput.model, 'sonnet');
    assert.strictEqual(r2.hookSpecificOutput.permissionDecision, undefined, 'o gancho nao decide permissao');
    const noAlvo = despacho(dir + '/.claude/sworn/revisao/a.js/3/vereditos', 'sonnet');
    assert.strictEqual(noAlvo.hookSpecificOutput.updatedInput.model, 'sonnet', 'ja no alvo, o modelo fica');
    assert.match(noAlvo.hookSpecificOutput.updatedInput.prompt, /\n\nGuidance for claude-sonnet-5-5 /);
  });
});

// F4e: todo agente, do sworn ou de fora dele, leva no fim do pedido o guia oficial do modelo que vai roda-lo
test('F4e juiz: o gancho poe no pedido de cada agente, do sworn ou de fora, o guia do modelo que vai rodar', () => {
  pasta(function (dir) {
    const opus = transcricao(dir, ['claude-opus-5-5']);
    const ag = function (tipo, model) {
      const entrada = { tool_name: 'Agent', transcript_path: opus,
        tool_input: { subagent_type: tipo, prompt: 'tarefa', description: 'x' } };
      if (model) entrada.tool_input.model = model;
      return gancho(dir, entrada);
    };
    const saida = function (r) { return r.hookSpecificOutput.updatedInput; };
    // o inspetor sobe ao juiz (Opus, numa sessao Opus) e leva o guia do Opus
    const i = ag('sworn:inspector');
    assert.strictEqual(saida(i).model, 'opus');
    assert.ok(saida(i).prompt.startsWith('tarefa\n\nGuidance for claude-opus-5-5 '), saida(i).prompt);
    assert.strictEqual(i.hookSpecificOutput.permissionDecision, undefined, 'o gancho nao decide permissao');
    // o leitor pedido no Haiku leva o guia do Haiku, e o modelo fica
    const leitorHaiku = saida(ag('sworn:reader', 'haiku'));
    assert.strictEqual(leitorHaiku.model, 'haiku');
    assert.match(leitorHaiku.prompt, /Guidance for claude-haiku-5-5 /);
    // sem pedido: o modelo do agents/<nome>.md (dedupe-judge: haiku); o reader nao declara, herda a sessao
    const juizDeMesmos = saida(ag('sworn:dedupe-judge'));
    assert.match(juizDeMesmos.prompt, /Guidance for claude-haiku-5-5 /);
    assert.strictEqual(juizDeMesmos.model, undefined, 'o gancho nao poe model onde o pedido nao tinha: o do agents/<nome>.md vale');
    assert.match(saida(ag('sworn:reader')).prompt, /Guidance for claude-opus-5-5 /);
    assert.match(saida(ag('sworn:reader', 'inherit')).prompt, /Guidance for claude-opus-5-5 /);
    // fora do Claude Code o agente se chama sworn-<nome>
    assert.match(saida(ag('sworn-reader', 'sonnet')).prompt, /Guidance for claude-sonnet-5-5 /);
    // agente de fora do sworn tambem leva o guia (G4e parte 5); modelo de fora ou nome torto: passa como veio
    assert.match(saida(ag('general-purpose', 'opus')).prompt, /Guidance for claude-opus-5-5 /);
    assert.strictEqual(ag('sworn:reader', 'gpt-5'), null);
    assert.strictEqual(ag('sworn:../../x', 'opus'), null);
    // o pedido reenviado como o gancho o reescreveu passa como veio: o guia nao entra duas vezes
    assert.strictEqual(gancho(dir, { tool_name: 'Agent', transcript_path: opus, tool_input: saida(i) }), null);
    // "guiaDoModelo": false desliga o guia; o juiz segue
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify({ guiaDoModelo: false }));
    assert.deepStrictEqual(saida(ag('sworn:inspector')), { subagent_type: 'sworn:inspector', prompt: 'tarefa',
      description: 'x', model: 'opus' });
    assert.strictEqual(ag('sworn:reader', 'haiku'), null);
  });
});

// G4e parte 5: o guia tambem no agente de fora do sworn. O modelo que vai roda-lo segue a ordem da doc oficial dos
// subagentes: o `model` do despacho, o da definicao (do projeto, depois do usuario, depois o embutido), a variavel
// CLAUDE_CODE_SUBAGENT_MODEL, a sessao; a variavel forcada vale sobre tudo. Sem definicao achada, so o pedido ou a
// forcada dizem.
test('G4e juiz: o agente de fora do sworn leva o guia do modelo que a ordem oficial escolhe', () => {
  pasta(function (dir) {
    const opus = transcricao(dir, ['claude-opus-5-5']);
    const agente = function (pastaDele, arquivo, frente) {
      fs.mkdirSync(pastaDele, { recursive: true });
      fs.writeFileSync(path.join(pastaDele, arquivo), '---\n' + frente + '\n---\nfaz uma coisa\n');
    };
    const doProjeto = path.join(dir, '.claude', 'agents');
    const doUsuario = path.join(dir, 'config-do-usuario', 'agents');
    const despacho = function (tipo, model, env, cwd) {
      const entrada = { tool_name: 'Agent', transcript_path: opus, tool_input: { prompt: 'tarefa', description: 'x' } };
      if (tipo !== undefined) entrada.tool_input.subagent_type = tipo;
      if (model) entrada.tool_input.model = model;
      if (cwd) entrada.cwd = cwd;
      return gancho(dir, entrada, env);
    };
    // a familia do guia que entrou: null quando o gancho deixa passar como veio
    const ag = function (tipo, model, env, cwd) {
      const r = despacho(tipo, model, env, cwd);
      if (r === null) return null;
      const m = /\n\nGuidance for claude-([a-z]+)-/.exec(r.hookSpecificOutput.updatedInput.prompt);
      return m ? m[1] : 'sem guia';
    };
    const VAR = 'CLAUDE_CODE_SUBAGENT_MODEL';
    const FORCA = 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE';
    const variavel = function (m, f) { const e = {}; e[VAR] = m; if (f) e[FORCA] = f; return e; };
    // os embutidos: o de uso geral segue a variavel e a sessao; Explore e Plan herdam a sessao, so a forcada os muda
    assert.strictEqual(ag('general-purpose'), 'opus');
    assert.strictEqual(ag(undefined), 'opus', 'sem tipo e o de uso geral');
    assert.strictEqual(ag(''), 'opus', 'tipo vazio e o de uso geral');
    assert.strictEqual(ag('claude'), 'opus');
    assert.strictEqual(ag('general-purpose', undefined, variavel('haiku')), 'haiku');
    assert.strictEqual(ag('general-purpose', 'sonnet', variavel('haiku')), 'sonnet', 'o pedido vale sobre a variavel');
    assert.strictEqual(ag('Explore', undefined, variavel('haiku')), 'opus');
    assert.strictEqual(ag('Explore', undefined, variavel('haiku', '1')), 'haiku');
    assert.strictEqual(ag('Explore', 'sonnet'), 'sonnet');
    assert.strictEqual(ag('Plan', undefined, variavel('sonnet')), 'opus');
    assert.strictEqual(ag('claude-code-guide'), 'haiku');
    assert.strictEqual(ag('web-fetch', undefined, variavel('sonnet')), 'haiku');
    assert.strictEqual(ag('statusline-setup'), 'sonnet');
    // o gancho so poe o guia: nao poe model nem troca o tipo
    const geral = despacho('general-purpose').hookSpecificOutput.updatedInput;
    assert.strictEqual(geral.model, undefined);
    assert.strictEqual(geral.subagent_type, 'general-purpose');
    assert.strictEqual(despacho(undefined).hookSpecificOutput.updatedInput.subagent_type, undefined);
    // o agente do projeto, pelo name do frontmatter (nao pelo nome do arquivo)
    agente(doProjeto, 'revisor.md', 'name: revisor-de-texto\nmodel: sonnet');
    agente(doProjeto, 'herdeiro.md', 'name: herdeiro\nmodel: inherit');
    agente(doProjeto, 'solto.md', 'name: solto');
    assert.strictEqual(ag('revisor-de-texto', undefined, variavel('haiku')), 'sonnet');
    assert.strictEqual(ag('revisor'), null, 'o nome do arquivo nao e o do agente');
    assert.strictEqual(ag('herdeiro', undefined, variavel('haiku')), 'opus', 'o inherit da definicao vale sobre a variavel');
    assert.strictEqual(ag('solto'), 'opus');
    assert.strictEqual(ag('solto', undefined, variavel('haiku')), 'haiku');
    assert.strictEqual(ag('revisor-de-texto', undefined, variavel('haiku', 'true')), 'haiku', 'a forcada vale sobre a definicao');
    // o do usuario (CLAUDE_CONFIG_DIR/agents); com o mesmo nome no projeto, vale o do projeto
    agente(doUsuario, 'pessoal.md', 'name: pessoal\nmodel: haiku');
    agente(doUsuario, 'outro-revisor.md', 'name: revisor-de-texto\nmodel: haiku');
    assert.strictEqual(ag('pessoal'), 'haiku');
    assert.strictEqual(ag('revisor-de-texto'), 'sonnet');
    // agente do projeto com o nome de um embutido vale sobre o embutido
    agente(doProjeto, 'meu-plan.md', 'name: Plan\nmodel: haiku');
    assert.strictEqual(ag('Plan'), 'haiku');
    // sem CLAUDE_CONFIG_DIR, a pasta do usuario e a ~/.claude
    const casa = path.join(dir, 'casa');
    agente(path.join(casa, '.claude', 'agents'), 'de-casa.md', 'name: de-casa\nmodel: haiku');
    assert.strictEqual(ag('de-casa', undefined, { CLAUDE_CONFIG_DIR: undefined, HOME: casa, USERPROFILE: casa }), 'haiku');
    assert.strictEqual(ag('de-casa', undefined, { HOME: casa, USERPROFILE: casa }), null,
      'com CLAUDE_CONFIG_DIR, a ~/.claude nao entra');
    // sem definicao achada: so o pedido ou a forcada dizem o modelo
    assert.strictEqual(ag('desconhecido'), null);
    assert.strictEqual(ag('desconhecido', undefined, variavel('haiku')), null);
    assert.strictEqual(ag('desconhecido', 'haiku'), 'haiku');
    assert.strictEqual(ag('desconhecido', undefined, variavel('sonnet', 'on')), 'sonnet');
    assert.strictEqual(ag('outro:agente'), null, 'agente de outro plugin: a definicao nao se le');
    assert.strictEqual(ag('outro:agente', 'sonnet'), 'sonnet');
    // a bifurcacao (fork) roda no modelo e no contexto da sessao, que ja tem o guia: passa como veio
    assert.strictEqual(ag('fork', 'opus'), null);
    // nome torto passa como veio, com modelo ou sem
    assert.strictEqual(ag('../x', 'opus'), null);
    assert.strictEqual(ag('a b', 'opus'), null);
    assert.strictEqual(ag('-x', 'opus'), null);
    // os agentes do sworn tambem seguem a variavel, abaixo da definicao
    assert.strictEqual(ag('sworn:reader', undefined, variavel('haiku')), 'haiku');
    assert.strictEqual(ag('sworn:dedupe-judge', undefined, variavel('sonnet')), 'haiku');
    const inspetor = despacho('sworn:inspector', undefined, variavel('sonnet', '1')).hookSpecificOutput.updatedInput;
    assert.strictEqual(inspetor.model, 'opus', 'o juiz segue trocando o model');
    assert.match(inspetor.prompt, /\n\nGuidance for claude-sonnet-5-5 /, 'mas a forcada e o modelo que roda');
  });
  // pasta de agentes que nao se le: nao se sabe a definicao, e so o pedido diz o modelo
  pasta(function (dir) {
    const opus = transcricao(dir, ['claude-opus-5-5']);
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'agents'), 'nao e pasta');
    const r = function (tipo, model) {
      const entrada = { tool_name: 'Agent', transcript_path: opus, tool_input: { subagent_type: tipo, prompt: 'tarefa' } };
      if (model) entrada.tool_input.model = model;
      return gancho(dir, entrada);
    };
    assert.strictEqual(r('general-purpose'), null);
    assert.match(r('general-purpose', 'sonnet').hookSpecificOutput.updatedInput.prompt, /Guidance for claude-sonnet-5-5 /);
    fs.unlinkSync(path.join(dir, '.claude', 'agents'));
    fs.mkdirSync(path.join(dir, 'config-do-usuario'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config-do-usuario', 'agents'), 'nao e pasta');
    assert.strictEqual(r('general-purpose'), null, 'a pasta do usuario tambem');
    // o arquivo de agente que nao se le pode ser o agente pedido (o name dele nao se sabe): nenhum se sabe
    fs.unlinkSync(path.join(dir, 'config-do-usuario', 'agents'));
    fs.mkdirSync(path.join(dir, '.claude', 'agents'));
    fs.writeFileSync(path.join(dir, '.claude', 'agents', 'travado.md'), '---\nname: travado\nmodel: haiku\n---\n');
    const ler = fs.readFileSync;
    fs.readFileSync = function (p) {
      if (/travado\.md$/.test(String(p))) { const e = new Error('EACCES: travado'); e.code = 'EACCES'; throw e; }
      return ler.apply(fs, arguments);
    };
    try {
      assert.strictEqual(r('travado'), null);
      assert.strictEqual(r('general-purpose'), null);
    } finally { fs.readFileSync = ler; }
    assert.match(r('travado').hookSpecificOutput.updatedInput.prompt, /Guidance for claude-haiku-5-5 /);
    assert.match(r('general-purpose').hookSpecificOutput.updatedInput.prompt, /Guidance for claude-opus-5-5 /);
  });
});
