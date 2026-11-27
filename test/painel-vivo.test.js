'use strict';
// Painel de sessoes, fase 3 (pedido 15), passo P1: a ponte entre o painel ao vivo e o gancho (scripts/lib/painel-ponte.js)
// e a traducao da entrada do gancho nos eventos da tela (scripts/lib/painel-vivo.js), mais os eventos novos do estado.js
// (`sessao`, que cria a mesa, e `voltou`, o pedido que voltou para o terminal). As entradas imitam as que a sonda P0
// gravou num `claude -p` de verdade (s377), com pasta e ids de mentira.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ponte = require(path.join(RAIZ, 'scripts', 'lib', 'painel-ponte.js'));
const vivo = require(path.join(RAIZ, 'scripts', 'lib', 'painel-vivo.js'));
const E = require(path.join(RAIZ, 'painel', 'prototipo', 'estado.js'));

const CWD = 'C:\\dev\\loja';
const ID = 'b7e3c1d2-4f5a-4b6c-9d8e-0a1b2c3d4e5f';
const NEGADO = 'Negado pelo dono no painel de sessões. Não repita o mesmo pedido: pergunte ao dono o que ele quer ou ' +
  'siga por outro caminho.';

function base(evento, extra) {
  return Object.assign({ session_id: ID, transcript_path: 'C:\\dev\\x.jsonl', cwd: CWD, hook_event_name: evento,
    permission_mode: 'default' }, extra);
}

const ENTRADAS = {
  inicio: base('SessionStart', { source: 'startup' }),
  prompt: base('UserPromptSubmit', { prompt: 'Arrume o teste do carrinho\nque quebrou ontem' }),
  permissaoShell: base('PermissionRequest', { tool_name: 'PowerShell',
    tool_input: { command: 'echo sonda > feito.txt', description: 'Cria o arquivo feito.txt' },
    permission_suggestions: [{ type: 'addDirectories', directories: [CWD], destination: 'session' }] }),
  permissaoEdit: base('PermissionRequest', { tool_name: 'Edit',
    tool_input: { file_path: CWD + '\\src\\nota.txt', old_string: 'linha a', new_string: 'linha b', replace_all: false },
    permission_suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] }),
  depoisDoShell: base('PostToolUse', { tool_name: 'PowerShell', tool_input: { command: 'echo sonda > feito.txt' },
    tool_response: { stdout: '', stderr: '', interrupted: false, isImage: false }, tool_use_id: 'toolu_1' }),
  depoisDoEdit: base('PostToolUse', { tool_name: 'Edit',
    tool_input: { file_path: CWD + '\\src\\nota.txt', old_string: 'linha a', new_string: 'linha b' },
    tool_response: { filePath: CWD + '\\src\\nota.txt', oldString: 'linha a', newString: 'linha b',
      originalFile: 'linha a\n', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1,
        lines: ['-linha a', '+linha b'] }], userModified: false, replaceAll: false } }),
  pergunta: base('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Qual banco usar?',
    header: 'Banco', multiSelect: false, options: [{ label: 'Postgres', description: 'a' }, { label: 'SQLite', description: 'b' }] }] } }),
  parou: base('Stop', { stop_hook_active: false, last_assistant_message: 'pronto' }),
  fim: base('SessionEnd', { reason: 'other' }),
};

function estadoVazio() {
  return E.criar({ maquinas: [{ id: 'local', nome: 'Esta máquina', conexao: 'online' }], projetos: [], sessoes: [] }, 0);
}

// Aplica a entrada como o servidor ao vivo aplica: enxuga, traduz contra a sessao que o estado ja tem e aplica.
function aplicarEntrada(st, entrada, agora) {
  const nota = vivo.enxugar(entrada);
  const eventos = vivo.traduzir(nota, E.sessao(st, nota && nota.sessao) || null);
  for (const ev of eventos) E.aplicar(st, ev, agora);
  return eventos;
}

// ---------------------------------------------------------------- a ponte

function pastaDeConfig(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-ponte-'));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  return { CLAUDE_CONFIG_DIR: dir };
}

test('ponte: grava porta, token e pid na pasta de config e le de volta so com o pid vivo', (t) => {
  const env = pastaDeConfig(t);
  const token = ponte.novoToken();
  assert.match(token, /^[0-9a-f]{64}$/);
  const arq = ponte.gravar({ porta: 4123, token, pid: process.pid }, env);
  assert.strictEqual(arq, path.join(env.CLAUDE_CONFIG_DIR, 'sworn', 'painel', 'ponte.json'));
  assert.deepStrictEqual(ponte.ler(env), { porta: 4123, token, pid: process.pid });
  assert.strictEqual(ponte.ler(env, function () { return false; }), null, 'pid morto = painel desligado');
});

test('ponte: sem arquivo, JSON quebrado ou campo fora da forma = painel desligado', (t) => {
  const env = pastaDeConfig(t);
  assert.strictEqual(ponte.ler(env), null);
  const arq = ponte.caminho(env);
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, '{ quebrado');
  assert.strictEqual(ponte.ler(env), null);
  const bom = { porta: 4123, token: ponte.novoToken(), pid: process.pid };
  for (const ruim of [{ porta: 0 }, { porta: 70000 }, { porta: '4123' }, { token: 'curto' }, { token: 'G'.repeat(64) },
    { pid: 0 }, { pid: 1.5 }]) {
    fs.writeFileSync(arq, JSON.stringify(Object.assign({}, bom, ruim)));
    assert.strictEqual(ponte.ler(env), null, JSON.stringify(ruim));
  }
});

test('ponte: apagar so tira o arquivo do proprio pid', (t) => {
  const env = pastaDeConfig(t);
  ponte.gravar({ porta: 4123, token: ponte.novoToken(), pid: process.pid }, env);
  ponte.apagar(process.pid + 1, env);
  assert.ok(fs.existsSync(ponte.caminho(env)), 'o arquivo de outro painel fica');
  ponte.apagar(process.pid, env);
  assert.ok(!fs.existsSync(ponte.caminho(env)));
  ponte.apagar(process.pid, env);
});

test('ponte: o token confere so quando e igual, e nunca com texto que nao e token', () => {
  const token = ponte.novoToken();
  assert.strictEqual(ponte.mesmoToken(token, token), true);
  assert.strictEqual(ponte.mesmoToken(token, ponte.novoToken()), false);
  assert.strictEqual(ponte.mesmoToken(token, token.slice(1)), false);
  assert.strictEqual(ponte.mesmoToken(undefined, token), false);
  assert.strictEqual(ponte.mesmoToken(token, ['x']), false);
});

test('ponte: a gravacao que falha no meio nao deixa o temporario na pasta, e cada gravacao usa um nome novo', (t) => {
  const env = pastaDeConfig(t);
  const arq = ponte.caminho(env);
  fs.mkdirSync(arq, { recursive: true });
  assert.throws(function () { ponte.gravar({ porta: 4123, token: ponte.novoToken(), pid: process.pid }, env); },
    'a ponte no lugar de uma pasta nao grava');
  assert.deepStrictEqual(fs.readdirSync(path.dirname(arq)).filter(function (n) { return n.endsWith('.tmp'); }), [],
    'o temporario saiu');
  fs.rmdirSync(arq);
  const sobra = arq + '.' + process.pid + '.tmp';
  fs.writeFileSync(sobra, 'de outra gravacao');
  ponte.gravar({ porta: 4123, token: ponte.novoToken(), pid: process.pid }, env);
  assert.strictEqual(fs.readFileSync(sobra, 'utf8'), 'de outra gravacao', 'o temporario de nome previsivel nao e reusado');
  assert.strictEqual(ponte.ler(env).porta, 4123);
});

// O nome aleatorio fica fixo aqui, para o arquivo de outro programa estar no mesmo nome: a gravacao nao o reusa.
test('ponte: o temporario nasce novo; com o mesmo nome ja na pasta, a gravacao falha em vez de reusar', (t) => {
  const crypto = require('crypto');
  const env = pastaDeConfig(t);
  const arq = ponte.caminho(env);
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  const fixo = Buffer.alloc(8, 0xab);
  t.mock.method(crypto, 'randomBytes', function () { return fixo; });
  fs.writeFileSync(arq + '.' + process.pid + '.' + fixo.toString('hex') + '.tmp', 'de outro programa');
  assert.throws(function () { ponte.gravar({ porta: 4123, token: 'a1'.repeat(32), pid: process.pid }, env); }, /EEXIST/);
  assert.strictEqual(ponte.ler(env), null, 'a ponte nao saiu do arquivo de outro');
});

test('ponte: a prova e o HMAC do token com o numero, e muda com cada um dos dois', () => {
  const token = 'a1'.repeat(32);
  const numero = 'd4'.repeat(32);
  const p = ponte.prova(token, numero);
  assert.match(p, /^[0-9a-f]{64}$/);
  assert.strictEqual(p, require('crypto').createHmac('sha256', token).update(numero).digest('hex'));
  assert.notStrictEqual(p, ponte.prova('c3'.repeat(32), numero));
  assert.notStrictEqual(p, ponte.prova(token, 'e5'.repeat(32)));
});

test('ponte: o pid deste processo esta vivo; um pid que nao existe, nao', () => {
  assert.strictEqual(ponte.pidVivo(process.pid), true);
  assert.strictEqual(ponte.pidVivo(2147483646), false);
  assert.strictEqual(ponte.pidVivo('1'), false);
});

// ---------------------------------------------------------------- enxugar

test('enxugar: so o que a tela usa, cortado; sem sessao ou evento valido, null', () => {
  const n = vivo.enxugar(ENTRADAS.permissaoShell);
  assert.deepStrictEqual(n, { sessao: ID, evento: 'PermissionRequest', cwd: CWD, ferramenta: 'PowerShell',
    comando: 'echo sonda > feito.txt', descricao: 'Cria o arquivo feito.txt' });
  assert.strictEqual(vivo.enxugar(null), null);
  assert.strictEqual(vivo.enxugar({}), null);
  assert.strictEqual(vivo.enxugar(base('SessionStart', { session_id: '../fora' })), null);
  assert.strictEqual(vivo.enxugar(base('Inventado')), null);
  const longo = vivo.enxugar(base('UserPromptSubmit', { prompt: 'x'.repeat(50000) }));
  assert.ok(longo.texto.length <= vivo.LIMITES.texto + 1, 'o prompt chega cortado');
});

test('enxugar: o corte nao parte um emoji ao meio, e a pasta longa demais fica de fora em vez de virar outra pasta', () => {
  const emoji = String.fromCodePoint(0x1F600);
  const n = vivo.enxugar(base('UserPromptSubmit', { prompt: 'a'.repeat(vivo.LIMITES.texto - 1) + emoji + 'fim' }));
  const antesDasReticencias = n.texto.charCodeAt(n.texto.length - 2);
  assert.ok(!(antesDasReticencias >= 0xd800 && antesDasReticencias <= 0xdbff), 'metade de um par sobrou no fim do corte');
  assert.ok(n.texto.endsWith('…'));
  const longa = vivo.enxugar(base('SessionStart', { cwd: 'C:\\' + 'pasta\\'.repeat(400) }));
  assert.ok(!('cwd' in longa), 'a pasta cortada apontaria para outro projeto');
  const ev = vivo.traduzir(longa, null);
  assert.strictEqual(ev[0].projeto, undefined);
});

test('enxugar: o resumo da entrada de ferramenta de fora so viaja no pedido de permissao', () => {
  const depois = vivo.enxugar(base('PostToolUse', { tool_name: 'mcp__busca__procurar', tool_input: { q: 'preco' },
    tool_response: { itens: [] } }));
  assert.strictEqual(depois.ferramenta, 'mcp__busca__procurar');
  assert.ok(!('resumo' in depois), 'o que a tela nao mostra nao viaja');
  const pedido = vivo.enxugar(base('PermissionRequest', { tool_name: 'mcp__busca__procurar', tool_input: { q: 'preco' } }));
  assert.strictEqual(pedido.resumo, '{"q":"preco"}');
});

test('enxugar: o Edit vira as linhas a mais e a menos do structuredPatch, e o Write novo conta as linhas do conteudo', () => {
  assert.deepStrictEqual(vivo.enxugar(ENTRADAS.depoisDoEdit).mudanca,
    { mais: 1, menos: 1, trecho: ['@@ -1,1 +1,1 @@', '-linha a', '+linha b'] });
  const conteudo = Array.from({ length: 300 }, function (_, i) { return 'linha ' + i; }).join('\n');
  const w = vivo.enxugar(base('PostToolUse', { tool_name: 'Write', tool_input: { file_path: CWD + '\\novo.txt', content: conteudo },
    tool_response: { type: 'create', filePath: CWD + '\\novo.txt', content: conteudo, structuredPatch: [] } }));
  assert.strictEqual(w.mudanca.mais, 300);
  assert.strictEqual(w.mudanca.menos, 0);
  assert.ok(w.mudanca.trecho.length <= vivo.LIMITES.trecho, 'o trecho chega no teto da tela');
  assert.strictEqual(w.mudanca.trecho[0], '+linha 0');
  assert.strictEqual(w.arquivo, CWD + '\\novo.txt');
  assert.ok(!('content' in w) && !JSON.stringify(w).includes('linha 299'), 'o conteudo inteiro nao viaja');
});

// ---------------------------------------------------------------- traduzir

test('traduzir: o 1o evento de uma sessao desconhecida cria a mesa, parada, no projeto da pasta', () => {
  const ev = vivo.traduzir(vivo.enxugar(ENTRADAS.inicio), null);
  assert.deepStrictEqual(ev, [{ tipo: 'sessao', sessao: ID, nome: 'Sessão b7e3', projeto: 'C:/dev/loja', projetoNome: 'loja',
    maquina: 'local', origem: 'terminal', estado: 'parada' }]);
  assert.deepStrictEqual(vivo.traduzir(vivo.enxugar(ENTRADAS.fim), null), [], 'sessao desconhecida que acaba nao vira mesa');
});

test('traduzir: a sessao inteira, do inicio ao fim, nos estados da tela', () => {
  const st = estadoVazio();
  aplicarEntrada(st, ENTRADAS.inicio, 1000);
  let s = E.sessao(st, ID);
  assert.strictEqual(s.estado, 'parada');
  assert.strictEqual(E.rotuloDoProjeto(st, s), 'loja');

  aplicarEntrada(st, ENTRADAS.prompt, 2000);
  assert.strictEqual(s.estado, 'trabalhando');
  assert.strictEqual(s.nome, 'Arrume o teste do carrinho', 'a 1a linha do 1o prompt da o nome da mesa');
  assert.strictEqual(s.tarefa, 'Arrume o teste do carrinho que quebrou ontem',
    'o 1o prompt inteiro, numa linha, e a tarefa da mesa: sem ela a tela diz "sem tarefa escrita"');
  assert.deepStrictEqual(s.conversa.at(-1), { quem: 'dono', texto: 'Arrume o teste do carrinho\nque quebrou ontem' });

  const ev = aplicarEntrada(st, ENTRADAS.permissaoShell, 3000);
  assert.strictEqual(s.estado, 'precisa');
  assert.deepStrictEqual(s.pedido, { tipo: 'permissao', texto: 'Cria o arquivo feito.txt', comando: 'echo sonda > feito.txt',
    urgencia: 'alta' });
  assert.strictEqual(ev.length, 1);

  aplicarEntrada(st, ENTRADAS.depoisDoShell, 4000);
  assert.strictEqual(s.estado, 'trabalhando', 'a ferramenta rodou: o pedido saiu');
  assert.strictEqual(s.pedido, undefined);

  aplicarEntrada(st, ENTRADAS.permissaoEdit, 5000);
  assert.deepStrictEqual(s.pedido, { tipo: 'permissao', texto: 'Quer mudar um arquivo.', arquivo: 'src/nota.txt', urgencia: 'alta' });
  aplicarEntrada(st, ENTRADAS.depoisDoEdit, 6000);
  aplicarEntrada(st, ENTRADAS.depoisDoEdit, 6500);
  assert.deepStrictEqual(s.arquivos.map(function (a) { return [a.caminho, a.mais, a.menos]; }), [['src/nota.txt', 2, 2]],
    'as linhas de cada arquivo somam na sessao');
  assert.strictEqual(s.arquivos[0].trecho.length, 6, 'o trecho junta os pedacos de cada edicao');

  aplicarEntrada(st, ENTRADAS.pergunta, 7000);
  assert.strictEqual(s.estado, 'precisa');
  assert.deepStrictEqual(s.pedido, { tipo: 'pergunta', texto: 'Qual banco usar?', opcoes: ['Postgres', 'SQLite'], urgencia: 'alta' });

  aplicarEntrada(st, ENTRADAS.parou, 8000);
  assert.strictEqual(s.estado, 'parada');
  assert.deepStrictEqual(s.conversa.at(-1), { quem: 'agente', texto: 'pronto' });

  aplicarEntrada(st, base('UserPromptSubmit', { prompt: 'Agora o resto' }), 9000);
  assert.strictEqual(s.nome, 'Arrume o teste do carrinho', 'o 2o prompt nao troca o nome');
  assert.strictEqual(s.tarefa, 'Arrume o teste do carrinho que quebrou ontem', 'nem a tarefa');

  aplicarEntrada(st, ENTRADAS.fim, 10000);
  assert.strictEqual(s.estado, 'concluida');
  s = null;
  assert.strictEqual(estadoVazio().sessoes.length, 0);
});

test('traduzir: arquivo fora da pasta do projeto mostra o caminho inteiro, com barra normal', () => {
  const st = estadoVazio();
  aplicarEntrada(st, ENTRADAS.inicio, 0);
  const fora = JSON.parse(JSON.stringify(ENTRADAS.depoisDoEdit));
  fora.tool_input.file_path = 'D:\\outro\\a.txt';
  aplicarEntrada(st, fora, 1);
  assert.strictEqual(E.sessao(st, ID).arquivos[0].caminho, 'D:/outro/a.txt');
});

test('traduzir: na sessao aberta na raiz, o arquivo aparece relativo a ela, como no C:\\', () => {
  const pedidoDoEdit = function (cwd, arquivo) {
    const n = vivo.enxugar(base('PermissionRequest', { cwd, tool_name: 'Edit', tool_input: { file_path: arquivo } }));
    return vivo.traduzir(n, { id: ID, estado: 'trabalhando', arquivos: [], conversa: [] })[0].pedido.arquivo;
  };
  assert.strictEqual(pedidoDoEdit('/', '/etc/hosts'), 'etc/hosts');
  assert.strictEqual(pedidoDoEdit('C:\\', 'C:\\x\\a.txt'), 'x/a.txt');
  assert.strictEqual(pedidoDoEdit('/srv/app', '/srv/app'), '/srv/app', 'a propria pasta nao vira caminho vazio');
  assert.strictEqual(pedidoDoEdit('/', '/'), '/', 'a raiz nao vira caminho vazio');
  assert.strictEqual(pedidoDoEdit('/srv/app', '/srv/apple/a.txt'), '/srv/apple/a.txt', 'pasta com o mesmo comeco fica de fora');
});

test('traduzir: ferramenta de fora (MCP) pede com o nome dela e o resumo da entrada', () => {
  const n = vivo.enxugar(base('PermissionRequest', { tool_name: 'mcp__busca__procurar', tool_input: { q: 'preco' } }));
  const ev = vivo.traduzir(n, { id: ID, estado: 'trabalhando', arquivos: [], conversa: [{ quem: 'dono', texto: 'oi' }] });
  assert.deepStrictEqual(ev, [{ tipo: 'estado', sessao: ID, estado: 'precisa', pedido: { tipo: 'permissao',
    texto: 'Quer usar a ferramenta mcp__busca__procurar.', comando: '{"q":"preco"}', urgencia: 'alta' } }]);
});

test('traduzir: nota que nao e nota nao vira evento', () => {
  assert.deepStrictEqual(vivo.traduzir(null, null), []);
  assert.deepStrictEqual(vivo.traduzir({ sessao: ID }, null), []);
});

// ---------------------------------------------------------------- a decisao e o retrato

test('saidaDaDecisao: aprovar e negar viram o hookSpecificOutput do PermissionRequest; o resto, nada', () => {
  assert.deepStrictEqual(vivo.saidaDaDecisao('aprovar'),
    { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
  assert.deepStrictEqual(vivo.saidaDaDecisao('negar'), { hookSpecificOutput: { hookEventName: 'PermissionRequest',
    decision: { behavior: 'deny', message: NEGADO } } });
  assert.match(NEGADO, /Não repita/, 'o motivo diz ao agente o que fazer em vez de pedir de novo');
  assert.strictEqual(vivo.saidaDaDecisao('talvez'), null);
  assert.strictEqual(vivo.saidaDaDecisao(undefined), null);
});

test('retrato: o estado ao vivo volta como dados que o criar le, com o tempo no estado', () => {
  const st = estadoVazio();
  aplicarEntrada(st, ENTRADAS.inicio, 0);
  aplicarEntrada(st, ENTRADAS.prompt, 60000);
  const r = vivo.retrato(st, 180000, 7);
  assert.strictEqual(r.modo, 'ao-vivo');
  assert.strictEqual(r.seq, 7);
  assert.strictEqual(r.sessoes[0].minutosNoEstado, 2);
  assert.ok(!('desde' in r.sessoes[0]) && !('atividade' in r.sessoes[0]));
  const outra = E.criar(r, 180000);
  assert.strictEqual(E.sessao(outra, ID).estado, 'trabalhando');
  assert.strictEqual(E.minutos(E.sessao(outra, ID), 180000), 2);
  r.sessoes[0].nome = 'mudado';
  assert.notStrictEqual(E.sessao(st, ID).nome, 'mudado', 'o retrato e copia');
});

// ---------------------------------------------------------------- estado.js: sessao e voltou

test('estado: o evento sessao cria a mesa uma vez, poe o projeto na lista e depois so renomeia', () => {
  const st = estadoVazio();
  const ev = { tipo: 'sessao', sessao: 's1', nome: 'Sessão s1', projeto: 'C:/dev/loja', projetoNome: 'loja', maquina: 'local',
    origem: 'terminal', estado: 'parada' };
  const r = E.aplicar(st, ev, 100);
  assert.deepStrictEqual(r.mudou, ['s1']);
  assert.strictEqual(r.nova, true);
  const s = E.sessao(st, 's1');
  assert.deepStrictEqual([s.estado, s.origem, s.maquina, s.desde, s.arquivos.length, s.conversa.length],
    ['parada', 'terminal', 'local', 100, 0, 0]);
  assert.deepStrictEqual(st.projetos, [{ id: 'C:/dev/loja', nome: 'loja' }]);
  assert.deepStrictEqual(E.aplicar(st, ev, 200).mudou, [], 'repetido sem mudanca nao muda nada');
  assert.strictEqual(st.sessoes.length, 1);
  const r2 = E.aplicar(st, { tipo: 'sessao', sessao: 's1', nome: 'Novo nome' }, 300);
  assert.deepStrictEqual(r2.mudou, ['s1']);
  assert.ok(!r2.nova);
  assert.strictEqual(s.nome, 'Novo nome');
  assert.strictEqual(st.projetos.length, 1);
  const r3 = E.aplicar(st, { tipo: 'sessao', sessao: 's1', tarefa: 'Arrumar o carrinho' }, 400);
  assert.deepStrictEqual(r3.mudou, ['s1'], 'a tarefa tambem muda a mesa');
  assert.strictEqual(s.tarefa, 'Arrumar o carrinho');
  E.aplicar(st, { tipo: 'sessao', sessao: 's9', nome: 'Outra', tarefa: 'Escrever o guia' }, 500);
  assert.strictEqual(E.sessao(st, 's9').tarefa, 'Escrever o guia', 'a mesa nova ja nasce com a tarefa');
});

test('traduzir: o prompt longo vira a tarefa cortada no teto, com reticencias', () => {
  const longo = 'palavra '.repeat(200);
  const ev = vivo.traduzir(vivo.enxugar(base('UserPromptSubmit', { prompt: longo })), null);
  const mesa = ev.find(function (e) { return e.tipo === 'sessao' && e.tarefa; });
  assert.ok(mesa, 'o 1o prompt traz a tarefa');
  assert.strictEqual(mesa.tarefa.length, vivo.LIMITES.tarefa + 1);
  assert.ok(mesa.tarefa.endsWith('…'));
});

test('estado: sessao com campo fora da forma cai no padrao, e sem id nao cria nada', () => {
  const st = estadoVazio();
  assert.deepStrictEqual(E.aplicar(st, { tipo: 'sessao' }, 0).mudou, []);
  assert.deepStrictEqual(E.aplicar(st, { tipo: 'sessao', sessao: '  ' }, 0).mudou, []);
  E.aplicar(st, { tipo: 'sessao', sessao: 's2', origem: 'outra', estado: 'inventado', projeto: 7 }, 0);
  const s = E.sessao(st, 's2');
  assert.deepStrictEqual([s.origem, s.estado, s.projeto, s.nome], ['terminal', 'parada', '', 's2']);
});

test('estado: voltou marca o pedido que voltou para o terminal, e o decidir recusa esse pedido', () => {
  const st = estadoVazio();
  E.aplicar(st, { tipo: 'sessao', sessao: 's1', maquina: 'local' }, 0);
  E.aplicar(st, { tipo: 'estado', sessao: 's1', estado: 'precisa', pedido: { id: 'p1', tipo: 'permissao', texto: 'x',
    comando: 'ls' } }, 0);
  assert.deepStrictEqual(E.aplicar(st, { tipo: 'voltou', sessao: 's1', pedido: 'p9' }, 1).mudou, [], 'outro pedido');
  assert.deepStrictEqual(E.aplicar(st, { tipo: 'voltou', sessao: 's1', pedido: 'p1' }, 1).mudou, ['s1']);
  assert.strictEqual(E.sessao(st, 's1').pedido.voltou, true);
  assert.deepStrictEqual(E.aplicar(st, { tipo: 'voltou', sessao: 's1', pedido: 'p1' }, 2).mudou, [], 'ja voltou');
  assert.deepStrictEqual(E.decidir(st, 's1', 'aprovar', 3).mudou, [], 'a decisao nao chegaria a ninguem');
  assert.strictEqual(E.sessao(st, 's1').estado, 'precisa');
});

// P2: o servidor ao vivo aceita a decisao e manda a todas as abas o evento `decisao`, que cada uma aplica igual.
test('estado: decisao decide so o pedido que a sessao tem, como o decidir, e repetida nao muda nada', () => {
  const st = estadoVazio();
  E.aplicar(st, { tipo: 'sessao', sessao: 's1', maquina: 'local' }, 0);
  E.aplicar(st, { tipo: 'estado', sessao: 's1', estado: 'precisa', pedido: { id: 'p1', tipo: 'permissao', texto: 'x',
    comando: 'ls' } }, 0);
  assert.deepStrictEqual(E.aplicar(st, { tipo: 'decisao', sessao: 's1', pedido: 'p9', escolha: 'aprovar' }, 1).mudou, [],
    'outro pedido');
  assert.deepStrictEqual(E.aplicar(st, { tipo: 'decisao', sessao: 's1', escolha: 'aprovar' }, 1).mudou, [], 'sem pedido');
  assert.deepStrictEqual(E.aplicar(st, { tipo: 'decisao', sessao: 's1', pedido: 'p1', escolha: 'talvez' }, 1).mudou, [],
    'escolha que nao existe');
  const r = E.aplicar(st, { tipo: 'decisao', sessao: 's1', pedido: 'p1', escolha: 'negar' }, 2);
  assert.deepStrictEqual(r.mudou, ['s1']);
  assert.match(r.aviso, /voltou a trabalhar\. Negado: ls$/);
  const s = E.sessao(st, 's1');
  assert.deepStrictEqual([s.estado, s.pedido, s.conversa[s.conversa.length - 1].texto], ['trabalhando', undefined,
    'Negado: ls']);
  assert.deepStrictEqual(E.aplicar(st, { tipo: 'decisao', sessao: 's1', pedido: 'p1', escolha: 'negar' }, 3).mudou, [],
    'a mesma decisao de novo');
});

// A sessao chegou pelo servidor, entao a maquina dela tem sinal: sem ela na lista, o semSinal recusaria toda decisao,
// ate a que o servidor ja aceitou.
test('estado: a sessao nova de maquina desconhecida poe a maquina na lista, e a decisao do servidor chega', () => {
  const st = estadoVazio();
  E.aplicar(st, { tipo: 'sessao', sessao: 's1', maquina: 'pc-novo' }, 0);
  assert.deepStrictEqual(E.maquina(st, 'pc-novo'), { id: 'pc-novo', nome: 'pc-novo', conexao: 'online' });
  assert.strictEqual(E.semSinal(st, E.sessao(st, 's1')), false);
  E.aplicar(st, { tipo: 'sessao', sessao: 's2', maquina: 'pc-novo' }, 0);
  E.aplicar(st, { tipo: 'sessao', sessao: 's3' }, 0);
  assert.deepStrictEqual(st.maquinas.map(function (m) { return m.id; }), ['local', 'pc-novo'],
    'a mesma maquina nao repete, e a sessao sem maquina nao inventa uma');
  E.aplicar(st, { tipo: 'estado', sessao: 's1', estado: 'precisa', pedido: { id: 'p1', tipo: 'permissao', texto: 'x',
    comando: 'ls' } }, 0);
  assert.deepStrictEqual(E.aplicar(st, { tipo: 'decisao', sessao: 's1', pedido: 'p1', escolha: 'aprovar' }, 1).mudou,
    ['s1']);
  assert.strictEqual(E.sessao(st, 's1').estado, 'trabalhando');
});

test('estado: a sessao nova que chega como precisa, sem pedido, nasce parada e fica fora da fila', () => {
  const st = estadoVazio();
  E.aplicar(st, { tipo: 'sessao', sessao: 's1', maquina: 'local', estado: 'precisa' }, 0);
  assert.strictEqual(E.sessao(st, 's1').estado, 'parada');
  assert.deepStrictEqual(E.fila(st), []);
  E.aplicar(st, { tipo: 'sessao', sessao: 's2', maquina: 'local', estado: 'trabalhando' }, 0);
  assert.strictEqual(E.sessao(st, 's2').estado, 'trabalhando', 'os outros estados validos seguem valendo');
});

test('estado: a maquina que perde a conexao avisa que aprovar, negar e responder esperam a volta', () => {
  const st = estadoVazio();
  E.aplicar(st, { tipo: 'sessao', sessao: 's1', maquina: 'local' }, 0);
  const r = E.aplicar(st, { tipo: 'maquina', maquina: 'local', conexao: 'offline' }, 1);
  assert.match(r.aviso, /^Esta máquina perdeu a conexão: 1 sessão sem sinal, mostrando o último estado que chegou\. /);
  assert.match(r.aviso, /Aprovar, negar e responder esperam a conexão voltar\.$/);
});
