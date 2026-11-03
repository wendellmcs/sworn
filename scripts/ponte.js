#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const harnessLib = require('./lib/harness.js');
const agentesLib = require('./lib/agentes.js');
const estado = require('./lib/estado.js');
const transcricoes = require('./lib/transcricoes.js');
const texto = require('./lib/texto.js');

/**
 * Pedido 6 (D752): `node ponte.js <harness> <script>` e o gancho que o instalador grava no Codex, no Qwen Code, no
 * agy, no dsh e no plugin do OpenCode. Le a entrada do harness, leva ao formato do Claude Code (lib/harness.js), roda
 * o portao de hoje sem mudar, com a mesma entrada que ele receberia do Claude Code, e devolve a saida na forma do
 * harness. O matcher e o evento de cada portao vem do hooks/hooks.json (fonte unica): o Claude Code segue lendo o
 * mesmo arquivo, sem a ponte no caminho. Falha da ponte libera (R6, pelo io.blindar). O agy nao diz o evento na
 * entrada (ele vem do arquivo de ganchos): o instalador o passa no 3o argumento, `ponte.js agy <script> <Evento>`.
 *
 * O que o harness nao faz e a ponte emula, com o estado na pasta dos portoes (lib/estado.js):
 * - prompt repetido no mesmo pedido (Qwen, dsh, agy): o portao do prompt roda uma vez por pedido;
 * - stop_hook_active (agy, dsh, OpenCode): o Stop seguinte a um block chega com true, como no Claude Code;
 * - abertura (agy, OpenCode): roda uma vez por sessao;
 * - Stop do subagente do dsh (chega como Stop, com o session_id do filho): nao passa pelo portao do fecho;
 * - transcript_path (o dsh manda vazio, o OpenCode nao manda): achado na casa do usuario (transcricaoDe);
 * - last_assistant_message (agy, dsh e OpenCode nao mandam no Stop): a ultima resposta da transcricao.
 *
 * A prova de ligado (Etapa 3): cada gancho que roda grava a hora em `.claude/sworn/ligado/<harness>/<evento>--<script>`
 * do projeto, se o instalar.js criou a pasta; o `instalar.js --conferir` le.
 */
const GANCHOS = path.join(__dirname, '..', 'hooks', 'hooks.json');
// No plugin do OpenCode a ponte roda dentro do processo dele (Bun), e o execPath nao e o node.
const NODE = /^node(\.exe)?$/i.test(path.basename(process.execPath)) ? process.execPath : 'node';

function lerGanchos() {
  return JSON.parse(fs.readFileSync(GANCHOS, 'utf8')).hooks || {};
}

/** O nome do script de um gancho do hooks.json ("${CLAUDE_PLUGIN_ROOT}/scripts/abertura.js" -> "abertura"). */
function scriptDoGancho(h) {
  const args = h && Array.isArray(h.args) ? h.args : [];
  return path.basename(String(args[0] || ''), '.js');
}

/** Os scripts que o evento chama no hooks.json, na ordem do arquivo, sem repetir. */
function scriptsDe(ganchos, evento) {
  const r = [];
  for (const grupo of ganchos[evento] || []) {
    for (const h of (grupo && grupo.hooks) || []) {
      const s = scriptDoGancho(h);
      if (s && !r.includes(s)) r.push(s);
    }
  }
  return r;
}

/** Onde o script roda no hooks.json: por evento, os grupos ({matcher, timeout}) que o chamam. */
function ondeRoda(ganchos, script) {
  const r = {};
  for (const evento of Object.keys(ganchos)) {
    for (const grupo of ganchos[evento] || []) {
      for (const h of (grupo && grupo.hooks) || []) {
        if (scriptDoGancho(h) !== script) continue;
        (r[evento] = r[evento] || []).push({ matcher: grupo.matcher, timeout: h.timeout });
      }
    }
  }
  return r;
}

/** O matcher do Claude Code: nome da ferramenta no Pre/PostToolUse, tipo do agente no Subagent*. */
function casa(evento, grupo, entrada) {
  if (!grupo.matcher) return true;
  let alvo = null;
  if (evento === 'PreToolUse' || evento === 'PostToolUse') alvo = entrada.tool_name;
  if (evento === 'SubagentStart' || evento === 'SubagentStop') alvo = entrada.agent_type;
  if (alvo === null) return true;
  try { return new RegExp('^(?:' + grupo.matcher + ')$').test(String(alvo || '')); } catch (e) { return false; }
}

/**
 * O estado da ponte num arquivo proprio (`ponte-<harness>-<sessao>`, na pasta do estado, que o limparVelhos ja
 * limpa): nao e o da sessao que o fecho carrega. s303 (Aberto B): o Codex roda os ganchos do PreToolUse ao mesmo
 * tempo, e no Windows o rename dava EPERM depois de o portao negar; o blindar liberava e o deny se perdia (2 em 30
 * rodadas). Le pelo estado.ler e grava pelo gravarAtomico (o molde do descarregar: arquivo que nao e o da sessao),
 * com as novas tentativas; o estado que nao grava fica dito no stderr e a decisao segue.
 */
function lerEstado(chave) {
  return estado.ler(chave);
}

function gravarEstado(chave, dados) {
  try {
    const destino = estado.caminhoSessao(chave);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    estado.gravarAtomico(destino, JSON.stringify(dados));
  } catch (e) {
    // R2 s303: o valor lancado pode nao ser Error (D735); o causaDoErro cobre null e texto.
    process.stderr.write('sworn: o estado da ponte nao gravou: ' + texto.causaDoErro(e) + '; a decisao do portao ' +
      'segue.\n');
  }
}

function pastaExiste(p) {
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

function pastaDoLigado(harness, cwd) {
  return path.join(typeof cwd === 'string' ? cwd : process.cwd(), '.claude', 'sworn', 'ligado', harness);
}

function marcar(harness, evento, script, cwd) {
  const pasta = pastaDoLigado(harness, cwd);
  if (!pastaExiste(pasta)) return;
  try {
    fs.writeFileSync(path.join(pasta, evento + '--' + script), new Date().toISOString());
  } catch (e) { /* a marca nao barra o gancho */ }
}

// s284 (Etapa 5): no dsh cada gancho ganha um temp novo (o sandbox troca TMP e TEMP a cada chamada) e o estado da
// sessao gravado nele sumia. Sem SWORN_TMP, o estado mora na pasta de ligado do projeto (o .gitignore dela e `*`); os
// portoes herdam o env.
function estadoNoProjeto(harness, cwd) {
  if (harness !== 'dsh' || process.env.SWORN_TMP) return;
  const pasta = pastaDoLigado(harness, cwd);
  if (pastaExiste(pasta)) process.env.SWORN_TMP = path.join(pasta, 'tmp');
}

/**
 * Pedido 6, Etapa 4: onde o harness grava a transcricao da sessao, na casa do usuario. dsh:
 * `.dsh/sessions/<cwd>/<sessao>/session.v4.jsonl.zstd` (a pasta com ou sem o prefixo `session-`); OpenCode:
 * `<banco>#<sessao>`, que o lib/transcricoes.js le. Outro harness manda o caminho: undefined. Sessao so com letra,
 * numero, `_` e `-`: vem do harness e entra num caminho.
 */
function transcricaoDe(harness, sessao, casa) {
  if (typeof sessao !== 'string' || !/^[\w-]+$/.test(sessao)) return undefined;
  if (harness === 'opencode') return path.join(casa, '.local', 'share', 'opencode', 'opencode.db') + '#' + sessao;
  if (harness !== 'dsh') return undefined;
  const raiz = path.join(casa, '.dsh', 'sessions');
  let pastas;
  try { pastas = fs.readdirSync(raiz); } catch (e) { return undefined; }
  for (const p of pastas) {
    for (const nome of [sessao, 'session-' + sessao]) {
      const arquivo = path.join(raiz, p, nome, 'session.v4.jsonl.zstd');
      if (fs.existsSync(arquivo)) return arquivo;
    }
  }
  return undefined;
}

/**
 * Roda o portao como o Claude Code roda: node, a entrada no stdin, o cwd do projeto, o timeout do hooks.json.
 * `gerar` troca o spawnSync (teste).
 */
function executar(caminho, entrada, timeout, gerar) {
  const g = gerar || spawnSync;
  const cwd = typeof entrada.cwd === 'string' && pastaExiste(entrada.cwd) ? entrada.cwd : undefined;
  const opcoes = { cwd: cwd, timeout: (Number(timeout) || 10) * 1000, windowsHide: true };
  const r = g(NODE, [caminho], Object.assign({ input: JSON.stringify(entrada), encoding: 'utf8' }, opcoes));
  // s284 (Etapa 5): no sandbox do dsh no Windows o processo filho com stdio por pipe da EPERM (o pipe nomeado do
  // libuv pede uma escrita que o token restrito nao tem, dsh-sandbox-windows-acl/README.md); por arquivo, roda.
  if (r.error && r.error.code === 'EPERM') return porArquivo(g, caminho, entrada, opcoes);
  if (r.stderr) process.stderr.write(r.stderr);
  dizerSeFalhou(caminho, r);
  return typeof r.stdout === 'string' ? r.stdout : '';
}

// R1 s285: o portao que nao rodou (timeout, spawn negado) libera, como a falha da ponte (R6), mas fica dito no stderr:
// o EPERM do dsh passou calado uma sessao inteira (s283).
function dizerSeFalhou(caminho, r) {
  if (!r || !r.error) return;
  process.stderr.write('sworn: o portao ' + path.basename(caminho, '.js') + ' nao rodou (' +
    (r.error.code || r.error.message) + ') e o gancho seguiu sem ele.\n');
}

/** O mesmo portao com a entrada, a saida e o stderr em arquivo, na pasta do estado (sai no fim). */
function porArquivo(gerar, caminho, entrada, opcoes) {
  const raiz = path.dirname(estado.caminhoSessao('portao'));
  fs.mkdirSync(raiz, { recursive: true });
  const pasta = fs.mkdtempSync(path.join(raiz, 'portao-'));
  const arq = (nome) => path.join(pasta, nome);
  try {
    fs.writeFileSync(arq('in'), JSON.stringify(entrada));
    const fds = [fs.openSync(arq('in'), 'r'), fs.openSync(arq('out'), 'w'), fs.openSync(arq('err'), 'w')];
    let r;
    try {
      r = gerar(NODE, [caminho], Object.assign({ stdio: fds }, opcoes));
    } finally {
      fds.forEach((fd) => fs.closeSync(fd));
    }
    const erro = fs.readFileSync(arq('err'), 'utf8');
    if (erro) process.stderr.write(erro);
    dizerSeFalhou(caminho, r);
    return fs.readFileSync(arq('out'), 'utf8');
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
}

/**
 * D758 (sonda s287): o motivo para negar a ferramenta que o subagente do sworn (agent_type sworn:<papel>) chama fora
 * do tools: do agents/<papel>.md; '' = passar. Papel sem arquivo nao e do sworn e passa; sem o campo tools: usa todas,
 * como no Claude Code. O arquivo que existe e nao se le, ou sem cabecalho, nega: papel so de leitura nao ganha escrita.
 */
function foraDoPapel(e, pasta) {
  const m = typeof e.agent_type === 'string' ? /^sworn:([\w-]+)$/.exec(e.agent_type) : null;
  if (!m) return '';
  const rel = 'agents/' + m[1] + '.md';
  let f;
  try {
    f = agentesLib.frontmatter(fs.readFileSync(path.join(pasta, m[1] + '.md'), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    f = { ok: false };
  }
  const barrado = 'sworn - ferramenta fora do papel barrada: ';
  if (!f.ok) return barrado + e.agent_type + ' sem ' + rel + ' legivel, e o papel nao usa ' + e.tool_name + '.';
  if (!Object.prototype.hasOwnProperty.call(f.campos, 'tools')) return '';
  // O tools: sem a lista na mesma linha (vazio ou lista YAML) vem null e nega: o instalar.js deixa esse agente fora.
  if (typeof f.campos.tools !== 'string') {
    return barrado + e.agent_type + ' tem tools: sem a lista na mesma linha (' + rel + '), e ' + e.tool_name +
      ' fica fora.';
  }
  const lista = f.campos.tools.split(',').map((t) => t.trim()).filter(Boolean);
  if (lista.includes(e.tool_name)) return '';
  return barrado + e.agent_type + ' so usa ' + lista.join(', ') + ' (' + rel + '), e ' + e.tool_name +
    ' fica fora. Faca o que o papel permite e devolva o resultado a quem chamou.';
}

/**
 * D760 item 3 (sonda s290): a resposta do ask_question do agy so entra na transcricao depois do PostToolUse, no passo
 * stepIdx dele. O PostToolUse (o do marcar-trabalho, o unico com AskUserQuestion no matcher) guarda o passo; a
 * PreInvocation seguinte le a resposta e a leva ao marcar-trabalho como o PostToolUse do AskUserQuestion do Claude
 * Code. Roda antes da abertura ja feita e do prompt repetido, que saem sem gravar o estado: grava aqui.
 */
function perguntaDoAgy(bruta, e, s, chave, o) {
  if (bruta.hook_event_name === 'PostToolUse') {
    const q = e.tool_input && Array.isArray(e.tool_input.questions) ? e.tool_input.questions : [];
    const antes = Array.isArray(s.perguntas) ? s.perguntas : [];
    if (e.tool_name === 'AskUserQuestion' && Number.isInteger(bruta.stepIdx)) {
      s.perguntas = antes.concat({ passo: bruta.stepIdx, perguntas: q.length });
    }
    return;
  }
  if (bruta.hook_event_name !== 'PreInvocation' || !Array.isArray(s.perguntas)) return;
  const resposta = harnessLib.respostaDoAgy(transcricoes.caudaDoTranscript(e.transcript_path), s.perguntas);
  delete s.perguntas;
  gravarEstado(chave, s);
  if (!Object.keys(resposta.answers).length) return;
  const grupos = ondeRoda(o.ganchos || lerGanchos(), 'marcar-trabalho').PostToolUse || [];
  if (!grupos.length) return;
  (o.executar || executar)(path.join(__dirname, 'marcar-trabalho.js'), { session_id: e.session_id,
    transcript_path: e.transcript_path, cwd: e.cwd, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
    tool_input: {}, tool_response: resposta }, Math.max.apply(null, grupos.map((g) => Number(g.timeout) || 10)));
}

/**
 * O nucleo, sem processo: devolve o texto que vai ao stdout do harness ('' = passar). `opcoes.executar` troca o
 * portao (teste), `opcoes.plataforma` troca o SO do mapa do shell, `opcoes.ganchos` troca o hooks.json, `opcoes.casa`
 * troca a pasta pessoal, `opcoes.agentes` troca a pasta agents/ e `opcoes.legivel` diz se este Node le a transcricao
 * do harness.
 */
function rodar(harness, script, bruta, opcoes) {
  const o = opcoes || {};
  if (typeof script !== 'string') return '';
  // So roda script cujo nome exato esta nos args do hooks.json: nome com caminho ("../x") nao casa com nenhum. Harness
  // desconhecido nao tem evento (eventosDoHarness devolve []).
  const onde = ondeRoda(o.ganchos || lerGanchos(), script);
  const evento = harnessLib.eventosDoHarness(harness, bruta).find((ev) => onde[ev]);
  if (!evento) return '';
  const grupos = onde[evento];
  const todas = harnessLib.normalizar(harness, bruta, evento, { plataforma: o.plataforma })
    .filter((e) => !harnessLib.ehMemoria(e));
  // O gancho rodou, ainda que o matcher nao case: e o que o --conferir quer saber.
  if (todas.length) marcar(harness, evento, script, todas[0].cwd);
  if (todas.length) estadoNoProjeto(harness, todas[0].cwd);
  const entradas = todas.filter((e) => grupos.some((g) => casa(evento, g, e)));
  if (!entradas.length) return '';
  if (evento === 'PreToolUse') {
    const pasta = o.agentes || path.join(__dirname, '..', 'agents');
    const negado = entradas.map((e) => foraDoPapel(e, pasta)).find(Boolean);
    if (negado) return harnessLib.escreverSaida(harness, evento, { negar: negado });
  }

  const chave = 'ponte-' + harness + '-' + entradas[0].session_id;
  const s = lerEstado(chave);
  if (harness === 'agy') perguntaDoAgy(bruta, entradas[0], s, chave, o);
  // Etapa 4b (sonda s279): o subagente do Codex manda o prompt dele no session_id do pai, com agent_id e agent_type.
  // Nao e pedido do usuario (no Claude Code o subagente nao dispara o UserPromptSubmit): a ponte guarda o tipo, que o
  // wait_agent nao traz, e nao roda o portao.
  if (evento === 'UserPromptSubmit' && typeof entradas[0].agent_id === 'string') {
    s.agentes = Object.assign({}, s.agentes, { [entradas[0].agent_id]: entradas[0].agent_type });
    gravarEstado(chave, s);
    return '';
  }
  const agentes = s.agentes && typeof s.agentes === 'object' ? s.agentes : {};
  for (const e of entradas) {
    const guardado = Object.prototype.hasOwnProperty.call(agentes, e.agent_id);
    if (e.tool_name === 'SubagentHandback' && guardado) {
      e.agent_type = agentes[e.agent_id];
    }
  }
  if (evento === 'SubagentStart') s.subagente = true;
  if (evento === 'Stop' && s.subagente === true) return '';
  if (evento === 'SessionStart' && harnessLib.ABRE_UMA_VEZ.includes(harness)) {
    s.abriu = s.abriu || {};
    if (s.abriu[script] === true) return '';
    s.abriu[script] = true;
  }
  if (evento === 'UserPromptSubmit') {
    const pedido = harnessLib.chaveDoPrompt(harness, entradas[0]);
    if (pedido !== null) {
      s.prompt = s.prompt || {};
      if (s.prompt[script] === pedido) return '';
      s.prompt[script] = pedido;
    }
    s.bloqueouStop = false;
  }
  const emula = evento === 'Stop' && harnessLib.EMULA_STOP.includes(harness);
  if (emula) for (const e of entradas) e.stop_hook_active = s.bloqueouStop === true;
  const pessoal = o.casa || os.homedir();
  for (const e of entradas) {
    if (!e.transcript_path) e.transcript_path = transcricaoDe(harness, e.session_id, pessoal) || e.transcript_path;
    if (evento !== 'Stop' || e.last_assistant_message) continue;
    // Inferido, conferir na Etapa 5: a resposta final ja esta na transcricao quando o Stop dispara.
    const lido = transcricoes.ler(e.transcript_path);
    if (lido && lido.ultimaMensagem) e.last_assistant_message = lido.ultimaMensagem;
  }

  const roda = o.executar || executar;
  const caminho = path.join(__dirname, script + '.js');
  const timeout = Math.max.apply(null, grupos.map((g) => Number(g.timeout) || 10));
  const decisao = harnessLib.juntar(entradas.map((e) => harnessLib.lerSaida(roda(caminho, e, timeout))));
  if (emula) s.bloqueouStop = decisao.bloquear !== undefined;
  // Formato que este Node nao le fica dito na abertura, nunca calado (o contexto e a prova do fecho dependem dele).
  if (evento === 'SessionStart' && script === 'abertura' && !(o.legivel || transcricoes.legivel)(harness)) {
    decisao.contexto = [decisao.contexto, 'sworn: o Node ' + process.version + ' nao le a transcricao do ' + harness +
      ' (falta ' + (harness === 'dsh' ? 'zstd no zlib' : 'node:sqlite') + '): a cobranca do teste vermelho nao ' +
      'roda aqui. Para liga-la, atualize o Node para o 22.15, o 23.8 ou mais novo.'].filter(Boolean).join('\n\n');
  }
  gravarEstado(chave, s);
  return harnessLib.escreverSaida(harness, evento, decisao);
}

if (require.main === module) {
  const io = require('./lib/io.js');
  io.blindar(function () {
    io.lerEntrada(function (entrada) {
      if (process.argv[4] && entrada.hook_event_name === undefined) entrada.hook_event_name = process.argv[4];
      const saida = rodar(process.argv[2], process.argv[3], entrada);
      if (saida) process.stdout.write(saida);
      process.exit(0);
    });
  });
}

module.exports = { rodar, executar, ondeRoda, lerGanchos, scriptDoGancho, scriptsDe };
