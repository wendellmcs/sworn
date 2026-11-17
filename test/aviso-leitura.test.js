'use strict';
// Colheita lote 5, item 12 (D667, D846): antes do Read de um arquivo de texto grande sem offset nem limit, o gancho avisa
// (nunca nega) que ler so o trecho poupa contexto. Uma vez por arquivo na sessao; imagem, PDF, notebook e caminho de rede
// ficam de fora; sem projeto.json ou com "avisoDeLeitura": false, nada; entrada torta ou arquivo que nao existe, nada.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const comum = require('./lib/comum.js');
const RAIZ = path.join(__dirname, '..');
// o limiar do gancho (scripts/aviso-leitura.js); GRANDE fica acima dele
const LIMIAR = 64 * 1024;
const GRANDE = 70 * 1024;

/** Projeto com projeto.json (espaco e acento no caminho, o caso desta maquina) e a pasta de estado da sessao. */
function comProjeto(projeto, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn leitura ação-'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-leitura-tmp-'));
  if (projeto !== null) {
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'),
      typeof projeto === 'string' ? projeto : JSON.stringify(projeto));
  }
  try { fn(dir, tmp); } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function arquivo(dir, rel, bytes) {
  const alvo = path.join(dir, rel);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, 'x'.repeat(bytes - 1) + '\n');
  return alvo;
}

/**
 * Roda o gancho como o Claude Code o chama; devolve { status, json, stderr, contexto, decisao }. A saida que nao e
 * JSON reprova aqui: calado e sem saida nenhuma, nunca saida torta. O gancho que caiu no io.blindar volta com status 1.
 */
function ler(dir, tmp, entrada, sessao, cwdDoProcesso) {
  const r = comum.ganchoComoProcesso(path.join('scripts', 'aviso-leitura.js'),
    typeof entrada === 'string' ? entrada
      : Object.assign({ session_id: sessao || 'l1', cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Read' }, entrada),
    { cwd: cwdDoProcesso || dir, env: comum.ambiente({ SWORN_TMP: tmp }) });
  const texto = String(r.stdout || '').trim();
  let json = r.json === undefined ? null : r.json;
  if (texto && json === null) {
    try { json = JSON.parse(texto); } catch (e) { assert.fail('a saida do gancho nao e JSON: ' + texto.slice(0, 200)); }
  }
  const hso = json && json.hookSpecificOutput;
  return { status: r.status, json: json, stderr: r.stderr, contexto: hso ? hso.additionalContext : undefined,
    decisao: hso ? hso.permissionDecision : undefined };
}

const calado = function (r, porque) {
  assert.strictEqual(r.status, 0, porque + ': ' + r.stderr);
  assert.strictEqual(r.contexto, undefined, porque + ': ' + JSON.stringify(r.json));
  assert.strictEqual(r.decisao, undefined, 'o aviso de leitura nunca decide a ferramenta');
};

test('12: o Read de arquivo grande sem offset nem limit avisa, sem negar, com o tamanho e o caminho do trecho', () => {
  comProjeto({}, function (dir, tmp) {
    const alvo = arquivo(dir, 'src/grande.js', GRANDE);
    const r = ler(dir, tmp, { tool_input: { file_path: alvo } });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.json && r.json.hookSpecificOutput, 'o arquivo grande tem de avisar: ' + JSON.stringify(r.json));
    assert.strictEqual(r.decisao, undefined, 'avisar, nunca negar: ' + JSON.stringify(r.json));
    assert.strictEqual(r.json.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.strictEqual(r.contexto, [
      'sworn - leitura grande: "src/grande.js" tem 70 KB (cerca de 18 mil tokens) e vai inteiro para o contexto.',
      'Se basta um trecho, ache a linha com o Grep e leia com offset e limit. A leitura segue.'
    ].join('\n'));
  });
});

test('12: o mesmo arquivo avisa uma vez por sessao; outro arquivo e outra sessao avisam de novo', () => {
  comProjeto({}, function (dir, tmp) {
    const a = arquivo(dir, 'a.js', GRANDE);
    const b = arquivo(dir, 'b.js', GRANDE);
    assert.ok(ler(dir, tmp, { tool_input: { file_path: a } }).contexto, 'a 1a leitura avisa');
    calado(ler(dir, tmp, { tool_input: { file_path: a } }), 'a 2a leitura do mesmo arquivo na sessao');
    // a mesma pasta escrita de outro jeito (caixa e barra no Windows) e o mesmo arquivo
    if (process.platform === 'win32') calado(ler(dir, tmp, { tool_input: { file_path: a.toUpperCase().replace(/\\/g, '/') } }), 'a grafia');
    assert.ok(ler(dir, tmp, { tool_input: { file_path: b } }).contexto, 'outro arquivo avisa');
    assert.ok(ler(dir, tmp, { tool_input: { file_path: a } }, 'l2').contexto, 'outra sessao avisa');
    const s = JSON.parse(fs.readFileSync(path.join(tmp, 'sworn', 'l1.json'), 'utf8'));
    assert.strictEqual(s.contadores.leitura_grande, 2, 'cada aviso conta no balde, as leituras caladas nao');
  });
});

test('12: offset ou limit calam; o limiar e exato (64 KB calado, 1 byte acima avisa); o relativo vale contra o cwd da entrada', () => {
  comProjeto({}, function (dir, tmp) {
    const alvo = arquivo(dir, 'grande.txt', GRANDE);
    calado(ler(dir, tmp, { tool_input: { file_path: alvo, limit: 200 } }), 'quem ja pediu o trecho com limit');
    calado(ler(dir, tmp, { tool_input: { file_path: alvo, offset: 10 } }), 'quem ja pediu o trecho com offset');
    calado(ler(dir, tmp, { tool_input: { file_path: alvo, offset: 0 } }), 'offset 0 tambem e pedir o trecho');
    calado(ler(dir, tmp, { tool_input: { file_path: arquivo(dir, 'limiar.js', LIMIAR) } }), 'exatamente 64 KB');
    assert.ok(ler(dir, tmp, { tool_input: { file_path: arquivo(dir, 'passou.js', LIMIAR + 1) } }).contexto, '1 byte acima avisa');
    calado(ler(dir, tmp, { tool_input: { file_path: arquivo(dir, 'pequeno.js', 1000) } }), 'arquivo pequeno');
    // as leituras caladas acima nao marcam o arquivo: o relativo vale contra o cwd da entrada, nao o do processo
    const r = ler(dir, tmp, { tool_input: { file_path: 'grande.txt' } }, 'l1', tmp);
    assert.match(r.contexto || '', /^sworn - leitura grande: "grande\.txt" tem 70 KB /, 'o caminho relativo vale contra o cwd');
  });
});

test('12: offset e limit nulos sao o mesmo que ausentes; nome que comeca com dois pontos segue relativo', () => {
  comProjeto({}, function (dir, tmp) {
    const nulo = ler(dir, tmp, { tool_input: { file_path: arquivo(dir, 'nulo.js', GRANDE), offset: null, limit: null } });
    assert.match(nulo.contexto || '', /"nulo\.js" tem 70 KB/, 'null nao e pedir o trecho: ' + JSON.stringify(nulo.json));
    const pontos = ler(dir, tmp, { tool_input: { file_path: arquivo(dir, path.join('..cache', 'g.json'), GRANDE) } });
    assert.match(pontos.contexto || '', /"\.\.cache\/g\.json" tem 70 KB/, 'dentro da raiz, mesmo com ".." no nome');
  });
});

test('12: o arquivo fora da raiz do projeto aparece pelo caminho absoluto', () => {
  comProjeto({}, function (dir, tmp) {
    const fora = arquivo(tmp, 'fora.log', GRANDE);
    const r = ler(dir, tmp, { tool_input: { file_path: fora } });
    // a pasta temporaria (sworn-leitura-tmp-) e ASCII: o absoluto sai como esta
    assert.ok((r.contexto || '').indexOf('"' + fora + '" tem 70 KB') !== -1, 'o absoluto, sem "../": ' + r.contexto);
  });
});

test('12: imagem, PDF, notebook e caminho de rede ficam de fora', () => {
  comProjeto({}, function (dir, tmp) {
    for (const rel of ['foto.PNG', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp', 'doc.pdf', 'nota.ipynb']) {
      calado(ler(dir, tmp, { tool_input: { file_path: arquivo(dir, rel, GRANDE) } }), rel);
    }
    // O caminho de rede nunca chega ao stat (o stat de \\host\share no Windows ja manda o hash NTLM). Aqui o caminho
    // de duas barras aponta para um arquivo local que existe (\\?\C:\... no Windows, //tmp/... no resto): sem o
    // filtro, o stat acharia o arquivo e o aviso sairia.
    const local = arquivo(dir, 'rede.js', GRANDE);
    const duasBarras = process.platform === 'win32' ? '\\\\?\\' + local : '/' + local;
    calado(ler(dir, tmp, { tool_input: { file_path: duasBarras } }), 'caminho de duas barras: ' + duasBarras);
    assert.ok(ler(dir, tmp, { tool_input: { file_path: local } }).contexto, 'o mesmo arquivo pelo caminho local avisa');
  });
});

test('12: sem projeto.json, com "avisoDeLeitura": false ou com o arquivo que nao existe, nada', () => {
  comProjeto(null, function (dir, tmp) {
    calado(ler(dir, tmp, { tool_input: { file_path: arquivo(dir, 'g.js', GRANDE) } }), 'sem projeto.json o sworn nao fala');
  });
  comProjeto({ avisoDeLeitura: false }, function (dir, tmp) {
    calado(ler(dir, tmp, { tool_input: { file_path: arquivo(dir, 'g.js', GRANDE) } }), 'desligado pelo projeto');
  });
  comProjeto('{ torto', function (dir, tmp) {
    calado(ler(dir, tmp, { tool_input: { file_path: arquivo(dir, 'g.js', GRANDE) } }), 'projeto.json torto');
  });
  comProjeto({ avisoDeLeitura: true }, function (dir, tmp) {
    assert.ok(ler(dir, tmp, { tool_input: { file_path: arquivo(dir, 'g.js', GRANDE) } }).contexto, 'true segue ligado');
    calado(ler(dir, tmp, { tool_input: { file_path: path.join(dir, 'nao-existe.js') } }), 'arquivo que nao existe');
    fs.mkdirSync(path.join(dir, 'pasta'));
    calado(ler(dir, tmp, { tool_input: { file_path: path.join(dir, 'pasta') } }), 'pasta');
    for (const torta of [{}, { tool_input: null }, { tool_input: { file_path: 7 } }, { tool_input: { file_path: '' } }, { cwd: 7 }]) {
      calado(ler(dir, tmp, torta), 'entrada torta ' + JSON.stringify(torta));
    }
    calado(ler(dir, tmp, 'isto nao e json'), 'stdin que nao e JSON');
    // cwd torto com um arquivo de verdade: o gancho nao cai, usa o cwd do processo (aqui, o projeto) e avisa
    const cwdTorto = ler(dir, tmp, { cwd: 7, tool_input: { file_path: arquivo(dir, 'h.js', GRANDE) } });
    assert.strictEqual(cwdTorto.status, 0, cwdTorto.stderr);
    assert.ok(cwdTorto.contexto, 'cwd torto: ' + JSON.stringify(cwdTorto.json));
  });
});

test('12: o estado da sessao torto nao cala o aviso nem derruba o gancho', () => {
  comProjeto({}, function (dir, tmp) {
    fs.mkdirSync(path.join(tmp, 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'sworn', 'l1.json'), '{ "leiturasAvisadas": [ trunc');
    const r = ler(dir, tmp, { tool_input: { file_path: arquivo(dir, 'g.js', GRANDE) } });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.contexto, 'o estado torto avisa assim mesmo: ' + JSON.stringify(r.json));
  });
});

test('12: o gancho esta ligado no PreToolUse do Read, sozinho no grupo, com prazo curto', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(RAIZ, 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse;
  const grupo = hooks.filter(function (g) { return g.matcher === 'Read'; });
  assert.strictEqual(grupo.length, 1, JSON.stringify(hooks.map(function (g) { return g.matcher; })));
  assert.deepStrictEqual(grupo[0].hooks.map(function (h) { return (h.args || [])[0]; }), ['${CLAUDE_PLUGIN_ROOT}/scripts/aviso-leitura.js']);
  assert.ok(grupo[0].hooks[0].timeout <= 5, 'cada Read paga este gancho: prazo curto');
});
