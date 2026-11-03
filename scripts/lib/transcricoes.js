'use strict';

const fs = require('node:fs');
const { nomeDaFerramenta, camposDaFerramenta, arquivosDoPatch, TEXTO_DO_PATCH } = require('./harness.js');

/**
 * Pedido 6, Etapa 4: a transcricao de cada harness numa forma so, para o saude.js (contexto e cobranca 7b/8) e para a
 * ponte (ultima mensagem no Stop). O formato sai do conteudo, porque a ponte nao diz o harness ao portao: `.zstd` =
 * dsh; `<banco .db>#<sessao>` = OpenCode; senao a 1a linha com assinatura (`step_index` = agy, `payload` = Codex,
 * `message.parts` = Qwen) e, sem nenhuma, Claude Code. Formatos lidos nas transcricoes reais da s275
 * (test/fixtures/harness/transcricoes/).
 *
 * `ler` devolve { formato, ultimaChamada: {contexto, horario, modelo} | null, eventos, ultimaMensagem } ou null sem
 * leitura. Evento: { pos, tipo: 'chamada', id, nome, entrada } com o nome e os campos do Claude Code, ou
 * { pos, tipo: 'resultado', id, falhou, saida }. `pos` e a linha (ou a mensagem) de origem: chamadas da mesma resposta
 * tem a mesma, como na regra de hoje do Claude Code.
 */

// D445: so a cauda (passa de MB numa sessao longa); o ultimo uso esta no fim.
const CAUDA_DO_TRANSCRIPT = 256 * 1024;
const BANCO = /^(.+\.db)#([^#]+)$/i;
const MAGICO_ZSTD = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** A cauda do transcript como texto; sem caminho ou sem leitura, null. */
function caudaDoTranscript(caminho) {
  if (typeof caminho !== 'string' || !caminho) return null;
  try {
    const fd = fs.openSync(caminho, 'r');
    try {
      const tamanho = fs.fstatSync(fd).size;
      const n = Math.min(tamanho, CAUDA_DO_TRANSCRIPT);
      const buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, tamanho - n);
      return buf.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch (e) { return null; }
}

function ler(caminho) {
  if (typeof caminho !== 'string' || !caminho) return null;
  const banco = BANCO.exec(caminho);
  if (banco) return doOpencode(banco[1], banco[2]);
  if (/\.zstd$/i.test(caminho)) return porLinhas('dsh', textoDoDsh(caminho));
  const texto = caudaDoTranscript(caminho);
  return texto === null ? null : porLinhas(formatoDe(texto), texto);
}

function formatoDe(texto) {
  for (const linha of texto.split('\n')) {
    const o = json(linha);
    if (!o) continue;
    if ('step_index' in o) return 'agy';
    if (o.payload && typeof o.type === 'string') return 'codex';
    if (o.message && Array.isArray(o.message.parts)) return 'qwen';
    if ('isSidechain' in o || (o.message && Array.isArray(o.message.content))) return 'claude';
  }
  return 'claude';
}

function json(texto) {
  if (typeof texto !== 'string') return null;
  try {
    const o = JSON.parse(texto);
    return o && typeof o === 'object' ? o : null;
  } catch (e) { return null; }
}

function porLinhas(formato, texto) {
  if (texto === null) return null;
  const r = { formato: formato, ultimaChamada: null, eventos: [], ultimaMensagem: null };
  const estado = {};
  // a primeira linha da cauda pode vir cortada no meio: o JSON.parse a recusa e ela fica de fora
  texto.split('\n').forEach(function (linha, i) {
    const o = json(linha);
    if (o) LEITORES[formato](o, i, r, estado);
  });
  return r;
}

/** Uso de contexto com total > 0 (a linha sintetica vem zerada); `horario` em texto ISO ou ms. */
function uso(r, total, horario, modelo) {
  if (!(total > 0)) return;
  const h = typeof horario === 'string' ? Date.parse(horario) : horario;
  r.ultimaChamada = { contexto: total, horario: Number.isFinite(h) ? h : null,
    modelo: typeof modelo === 'string' && modelo ? modelo : null };
}

// Sem a plataforma, o shell de cada harness vira Bash: aqui so importa que e comando, nao qual shell.
function chamada(r, pos, harness, id, nome, args) {
  r.eventos.push({ pos: pos, tipo: 'chamada', id: id, nome: harness ? nomeDaFerramenta(harness, nome) : nome,
    entrada: harness ? camposDaFerramenta(harness, nome, args) : args });
}

function resultado(r, pos, id, falhou, saida) {
  r.eventos.push({ pos: pos, tipo: 'resultado', id: id, falhou: falhou, saida: saida });
}

function textos(lista) {
  return lista.filter(function (t) { return typeof t === 'string' && t; }).join('\n') || null;
}

function textoDosBlocos(conteudo) {
  return Array.isArray(conteudo)
    ? conteudo.map(function (x) { return x && typeof x.text === 'string' ? x.text : ''; }).join('\n') : conteudo;
}

const LEITORES = {
  // Claude Code: pula a linha de subagente (isSidechain), como sempre.
  claude: function (o, i, r) {
    if (o.isSidechain === true || !o.message) return;
    const u = o.message.usage;
    if (u) {
      uso(r, (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
        o.timestamp, o.message.model);
    }
    if (!Array.isArray(o.message.content)) return;
    for (const b of o.message.content) {
      if (b && b.type === 'tool_use') chamada(r, i, null, b.id, b.name, b.input);
      else if (b && b.type === 'tool_result') {
        resultado(r, i, b.tool_use_id, b.is_error === true, textoDosBlocos(b.content));
      }
    }
  },

  // Codex: o item_completed (o JS do `exec` nao diz o comando); o comando e o ultimo argumento do shell.
  codex: function (o, i, r) {
    const p = o.payload;
    if (o.type !== 'event_msg' || !p) return;
    if (p.type === 'token_count' && p.info && p.info.last_token_usage) {
      uso(r, p.info.last_token_usage.input_tokens || 0, o.timestamp, null);
    }
    const it = p.type === 'item_completed' ? p.item : null;
    if (!it) return;
    if (it.type === 'CommandExecution') {
      const comando = Array.isArray(it.command) ? it.command[it.command.length - 1] : it.command;
      chamada(r, i, 'codex', it.id, 'Bash', { command: comando });
      resultado(r, i, it.id, it.status === 'failed', it.aggregated_output || it.stdout);
    } else if (it.type === 'FileChange' && it.changes && typeof it.changes === 'object') {
      for (const arquivo of Object.keys(it.changes)) chamada(r, i, 'codex', it.id, 'Edit', { file_path: arquivo });
    } else if (it.type === 'AgentMessage') {
      r.ultimaMensagem = textoDosBlocos(it.content) || r.ultimaMensagem;
    }
  },

  qwen: function (o, i, r) {
    const partes = o.message && Array.isArray(o.message.parts) ? o.message.parts : [];
    if (o.type === 'assistant') {
      if (o.usageMetadata) uso(r, o.usageMetadata.promptTokenCount || 0, o.timestamp, o.model);
      const texto = textos(partes.map(function (p) { return p && p.text; }));
      if (texto) r.ultimaMensagem = texto;
    }
    for (const p of partes) {
      const f = p && p.functionCall;
      if (f) chamada(r, i, 'qwen', f.id, f.name, f.args);
      const g = p && p.functionResponse;
      if (!g) continue;
      resultado(r, i, g.id, !!o.toolCallResult && o.toolCallResult.status === 'error', (g.response || {}).output);
    }
  },

  // agy: a chamada vem sem id e o resultado e o passo GENERIC seguinte, na ordem das chamadas. O "Command exited
  // with code N." do texto, o saude.js ja le (textoMostraFalha), como o `[exit code: N]` do dsh.
  agy: function (o, i, r, estado) {
    if (o.type === 'PLANNER_RESPONSE') {
      uso(r, (o.input_tokens || 0) + (o.cache_read_tokens || 0), o.created_at, null);
      const lista = Array.isArray(o.tool_calls) ? o.tool_calls : [];
      estado.fila = lista.map(function (t, k) {
        const id = o.step_index + '.' + k;
        chamada(r, i, 'agy', id, t && t.name, t && t.args);
        return id;
      });
      if (typeof o.content === 'string' && o.content) r.ultimaMensagem = o.content;
    } else if (o.type === 'GENERIC' && estado.fila && estado.fila.length) {
      resultado(r, i, estado.fila.shift(), o.status === 'ERROR', o.content);
    }
  },

  // dsh: o isError vem false com saida diferente de 0 (o `[exit code: N]` do fim do texto diz) e true no negado.
  dsh: function (o, i, r, estado) {
    const d = o.data || {};
    if (o.type === 'request/context' && typeof d.model === 'string') estado.modelo = d.model;
    if (o.type === 'assistant/message') {
      const u = d.usage;
      if (u) uso(r, (u.inputTokens || 0) + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0), o.time, estado.modelo);
      const conteudo = d.message && Array.isArray(d.message.content) ? d.message.content : [];
      for (const b of conteudo) if (b && b.type === 'tool-call') chamada(r, i, 'dsh', b.id, b.name, json(b.arguments));
      const texto = textos(conteudo.map(function (b) { return b && b.type === 'text' ? b.text : null; }));
      if (texto) r.ultimaMensagem = texto;
    } else if (o.type === 'tool/result' && d.message) {
      resultado(r, i, d.message.toolCallId, d.message.isError === true, textoDosBlocos(d.message.content));
    }
  }
};

/**
 * O tamanho do quadro zstd que comeca em `de`, pelo cabecalho e pelos blocos (RFC 8878, 3.1.1); null se o quadro passa
 * do fim do buffer. s296: cortar no numero magico partia o quadro que o traz cru nos dados, e o pedaco truncado nao
 * lanca no zstd do Node: os quadros seguintes sumiam calados.
 */
function tamanhoDoQuadro(buf, de) {
  if (de + 5 > buf.length) return null;
  const fhd = buf[de + 4];
  const unico = (fhd >> 5) & 1;
  let k = de + 5 + (unico ? 0 : 1) + [0, 1, 2, 4][fhd & 3] + [unico, 2, 4, 8][fhd >> 6];
  for (let ultimo = 0; !ultimo; ) {
    if (k + 3 > buf.length) return null;
    const h = buf[k] | (buf[k + 1] << 8) | (buf[k + 2] << 16);
    ultimo = h & 1;
    k += 3 + (((h >> 1) & 3) === 1 ? 1 : h >> 3);
  }
  k += (fhd >> 2) & 1 ? 4 : 0;
  return k <= buf.length ? k - de : null;
}

/**
 * O session.v4.jsonl.zstd do dsh: um quadro zstd por escrita, encadeados (o zstdDecompressSync le so o 1o), cada um
 * pelo tamanho dele. O ultimo truncado (o dsh no meio da escrita) da os blocos inteiros, sem lancar. Fora de quadro,
 * pula ate o proximo numero magico. O arquivo inteiro, nao a cauda: o quadro nao se le pelo meio. Sem zstd no zlib
 * (Node antigo), null.
 */
function textoDoDsh(caminho) {
  const zlib = require('node:zlib');
  let buf;
  try { buf = fs.readFileSync(caminho); } catch (e) { return null; }
  if (typeof zlib.zstdDecompressSync !== 'function') return null;
  const partes = [];
  for (let de = buf.indexOf(MAGICO_ZSTD); de !== -1; ) {
    const n = tamanhoDoQuadro(buf, de);
    try {
      partes.push(zlib.zstdDecompressSync(buf.subarray(de, n === null ? buf.length : de + n)));
    } catch (e) { /* corrompido: fica fora */ }
    de = n === null ? -1 : buf.indexOf(MAGICO_ZSTD, de + n);
  }
  return Buffer.concat(partes).toString('utf8');
}

/** node:sqlite sem o ExperimentalWarning, que sairia no stderr do gancho. */
function sqlite() {
  const emitir = process.emitWarning;
  process.emitWarning = function (aviso) {
    if (/SQLite/.test(String(aviso && aviso.message ? aviso.message : aviso))) return;
    return emitir.apply(process, arguments);
  };
  try { return require('node:sqlite'); } finally { process.emitWarning = emitir; }
}

/** Este Node le a transcricao do harness? O dsh pede zstd no zlib; o OpenCode, node:sqlite. */
function legivel(harness) {
  if (harness === 'dsh') return typeof require('node:zlib').zstdDecompressSync === 'function';
  if (harness !== 'opencode') return true;
  try { return typeof sqlite().DatabaseSync === 'function'; } catch (e) { return false; }
}

/** OpenCode: o banco so leitura, mensagens e partes da sessao na ordem; `pos` = a mensagem. Sem a sessao, null. */
function doOpencode(banco, sessao) {
  let db;
  try { db = new (sqlite().DatabaseSync)(banco, { readOnly: true }); } catch (e) { return null; }
  try {
    const mensagens = db.prepare('select id, data from message where session_id = ? order by time_created, id')
      .all(sessao);
    if (!mensagens.length) return null;
    const partes = {};
    for (const p of db.prepare('select message_id, data from part where session_id = ? order by time_created, id')
      .all(sessao)) {
      (partes[p.message_id] = partes[p.message_id] || []).push(json(p.data));
    }
    const r = { formato: 'opencode', ultimaChamada: null, eventos: [], ultimaMensagem: null };
    mensagens.forEach(function (m, i) {
      const info = json(m.data);
      if (!info || info.role !== 'assistant') return;
      const t = info.tokens || {};
      const cache = t.cache || {};
      uso(r, (t.input || 0) + (cache.read || 0) + (cache.write || 0), info.time && info.time.created, info.modelID);
      const lista = (partes[m.id] || []).filter(Boolean);
      for (const p of lista) {
        const s = p.type === 'tool' && p.state ? p.state : null;
        if (!s) continue;
        // s306: o apply_patch (modelo GPT) vira um Edit ou Write por arquivo, como na ponte; cru, a edicao ficava fora
        // da cobranca 7b/8.
        if (p.tool === 'apply_patch') {
          for (const f of arquivosDoPatch((s.input || {})[TEXTO_DO_PATCH.opencode])) {
            chamada(r, i, null, p.callID, f.tool_name, f.tool_input);
          }
        } else chamada(r, i, 'opencode', p.callID, p.tool, s.input);
        if (s.status !== 'completed' && s.status !== 'error') continue;
        const saida = (s.metadata || {}).exit;
        resultado(r, i, p.callID, s.status === 'error' || (typeof saida === 'number' && saida !== 0), s.output);
      }
      const texto = textos(lista.map(function (p) { return p.type === 'text' ? p.text : null; }));
      if (texto) r.ultimaMensagem = texto;
    });
    return r;
  } catch (e) {
    return null;
  } finally { db.close(); }
}

module.exports = { ler, legivel, caudaDoTranscript };
