'use strict';
// Plano 0.9.1 (D560/D568), Tarefa 4: quanto texto os ganchos de cada plugin poem na conversa, lido da transcricao
// da sessao. Ideia do context-mode (licenca ELv2): texto e codigo nossos, nada do dele.
//
// Forma dos registros, vista na transcricao real da s84 (o Claude Code nao documenta o formato):
//   {type:"attachment", attachment:{type:"hook_additional_context", content:[texto, ...], hookEvent, hookName, toolUseID}}
//   {type:"attachment", attachment:{type:"hook_success", hookEvent, hookName, toolUseID, command, stdout, content}}
// O anexo nao diz o plugin: ele sai do hook_success irmao (mesmo evento e o texto igual ao additionalContext do
// stdout; no PreToolUse tambem o mesmo toolUseID, no SessionStart o toolUseID e outro). Texto puro no stdout do
// SessionStart e do UserPromptSubmit tambem entra no contexto, e vem no `content` do hook_success.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const textoLib = require('./texto.js');

const VOLTA_MAIS_DE = 5;     // mock aprovado (D568): "volta mais de 5 vezes"
const CORTE_DO_TEXTO = 70;   // a 1a linha do texto que volta, cortada em fronteira de palavra
const NAO_IDENTIFICADO = 'nao identificado';
const GANCHOS_DE_FERRAMENTA = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest']);
const NOTA = 'o formato da transcricao nao e documentado pelo Claude Code e pode mudar entre versoes';
const METODO = 'caracteres = tamanho do texto injetado (String.length); vezes = textos injetados; linhas de subagente ' +
  '(isSidechain) ficam de fora; plugin pelo comando do gancho: caminho do cache de plugins, nome do script no hooks.json ' +
  'de um plugin so, statusMessage, ou CLAUDE_PROJECT_DIR (settings do projeto)';

function naoMedido(causa, motivo, caminho) {
  const m = { medido: false, causa: causa, motivo: motivo, nota: NOTA };
  if (caminho) m.caminho = caminho;
  return m;
}

function pastaDeConfig(env) {
  return (env && env.CLAUDE_CONFIG_DIR) || path.join(os.homedir(), '.claude');
}

/**
 * Onde esta a transcricao: o caminho passado vence; sem ele, a da sessao do ambiente (CLAUDE_CODE_SESSION_ID, que o
 * Claude Code poe no shell da sessao e o scripts/plano.js ja le), procurada como o medir-qualidade.js procura.
 * Devolve { caminho, plugins } ou { causa, motivo }.
 */
function localizar(passado, env) {
  const e = env || process.env;
  const plugins = path.join(pastaDeConfig(e), 'plugins', 'cache');
  if (typeof passado === 'string' && passado) return { caminho: path.resolve(passado), plugins: plugins };
  const sessao = e.CLAUDE_CODE_SESSION_ID;
  if (!sessao) {
    return { causa: 'sem-sessao', motivo: 'nao medido: sem --transcricao e sem CLAUDE_CODE_SESSION_ID no ambiente (rode o auditar.js de dentro da sessao)' };
  }
  // reuso (degrau 2): a busca de <config>/projects/*/<sessao>.jsonl ja existe no medir-qualidade.js
  const caminho = require('../medir-qualidade.js').acharTranscricao(sessao, e);
  if (!caminho) {
    return { causa: 'nao-achada', motivo: 'nao medido: a transcricao da sessao ' + sessao + ' nao esta em ' + path.join(pastaDeConfig(e), 'projects') +
      '; passe o caminho do .jsonl em --transcricao' };
  }
  return { caminho: caminho, plugins: plugins };
}

/**
 * Plano 092 (D573): a conversa anterior a atual, para a auditoria de 7 dias - o .jsonl mais recente (mtime) da pasta da
 * transcricao `atual` que nao e o dela. A atual pode ainda nao existir na abertura (o Claude Code a escreve de forma
 * assincrona). Devolve o alvo do localizar() com `id` (8 primeiros caracteres do nome) e `quando` (mtime, ms), ou null.
 */
function anterior(atual, sessionId, env) {
  if (typeof atual !== 'string' || !atual) return null;
  const pasta = path.dirname(atual);
  const fora = new Set([path.basename(atual).toLowerCase()]);
  if (typeof sessionId === 'string' && sessionId) fora.add((sessionId + '.jsonl').toLowerCase());
  let melhor = null;
  try {
    for (const nome of fs.readdirSync(pasta)) {
      if (!/\.jsonl$/i.test(nome) || fora.has(nome.toLowerCase())) continue;
      let st;
      try { st = fs.statSync(path.join(pasta, nome)); } catch (e) { continue; }
      // vazio (sessao que nem escreveu) nao conta: esconderia a anterior de verdade (revisao 092, borda)
      if (st.isFile() && st.size > 0 && (!melhor || st.mtimeMs > melhor.quando)) melhor = { nome: nome, quando: st.mtimeMs };
    }
  } catch (e) {
    return null;
  }
  if (!melhor) return null;
  const alvo = localizar(path.join(pasta, melhor.nome), env);
  alvo.id = melhor.nome.slice(0, 8);
  alvo.quando = melhor.quando;
  return alvo;
}

/** nome -> Set de plugins, de cada <cache>/<mercado>/<plugin>/<versao>/hooks/hooks.json. Pasta ilegivel: mapa vazio. */
function lerPlugins(cache) {
  const scripts = new Map();
  const mensagens = new Map();
  const por = function (mapa, chave, plugin) {
    if (!mapa.has(chave)) mapa.set(chave, new Set());
    mapa.get(chave).add(plugin);
  };
  const filhos = function (dir) {
    try { return fs.readdirSync(dir, { withFileTypes: true }).filter(function (d) { return d.isDirectory(); }).map(function (d) { return d.name; }); } catch (e) { return []; }
  };
  for (const mercado of filhos(cache)) {
    for (const plugin of filhos(path.join(cache, mercado))) {
      for (const versao of filhos(path.join(cache, mercado, plugin))) {
        let hooks;
        try { hooks = JSON.parse(fs.readFileSync(path.join(cache, mercado, plugin, versao, 'hooks', 'hooks.json'), 'utf8')).hooks; } catch (e) { continue; }
        for (const evento of Object.keys(hooks || {})) {
          for (const grupo of (Array.isArray(hooks[evento]) ? hooks[evento] : [])) {
            // hooks.json de outro plugin com forma torta: pula o item, sem derrubar a medicao inteira
            for (const h of (grupo && Array.isArray(grupo.hooks) ? grupo.hooks : [])) {
              if (!h || typeof h !== 'object') continue;
              const linha = [h.command].concat(Array.isArray(h.args) ? h.args : []).join(' ');
              for (const s of linha.match(/[\w.-]+\.(?:js|mjs|cjs|py|sh|ps1)\b/g) || []) por(scripts, s, plugin);
              if (typeof h.statusMessage === 'string' && h.statusMessage) por(mensagens, h.statusMessage, plugin);
            }
          }
        }
      }
    }
  }
  return { scripts: scripts, mensagens: mensagens };
}

function unico(mapa, chave) {
  const s = mapa.get(chave);
  return s && s.size === 1 ? Array.from(s)[0] : null;
}

function pluginDoComando(comando, mapa) {
  const c = String(comando || '').replace(/\\/g, '/');
  const cache = c.match(/plugins\/cache\/[^/]+\/([^/]+)\//);
  if (cache) return cache[1];
  const script = c.match(/\$\{CLAUDE_PLUGIN_ROOT\}[^\s"']*?\/([\w.-]+\.(?:js|mjs|cjs|py|sh|ps1))\b/);
  if (script) return unico(mapa.scripts, script[1]) || NAO_IDENTIFICADO;
  if (/CLAUDE_PROJECT_DIR/.test(c)) return 'projeto (settings.json)';
  // O comando inteiro contra o mapa de statusMessage, de proposito: o gancho com statusMessage chega a transcricao com
  // o statusMessage no campo `command` (visto na s84 no SessionStart do sworn, hooks/hooks.json:12).
  return unico(mapa.mensagens, String(comando || '')) || NAO_IDENTIFICADO;
}

function ganchoDe(a) {
  return GANCHOS_DE_FERRAMENTA.has(a.hookEvent) && typeof a.hookName === 'string' && a.hookName ? a.hookName : String(a.hookEvent);
}

/** O additionalContext do stdout em JSON; `undefined` quando o stdout nao e JSON (texto puro). */
function contextoDoStdout(stdout) {
  let j;
  try { j = JSON.parse(stdout); } catch (e) { return undefined; }
  return j && typeof j === 'object' ? ((j.hookSpecificOutput && j.hookSpecificOutput.additionalContext) || null) : undefined;
}

/**
 * 1a linha nao vazia, cortada na ultima palavra inteira ate o CORTE_DO_TEXTO, sem pontuacao no fim. O caractere logo
 * depois do corte conta: se ele ja e espaco ou pontuacao, a palavra antes dele esta inteira.
 */
function cabeca(texto) {
  const linha = (String(texto).split('\n').map(function (l) { return l.trim(); }).filter(Boolean)[0]) || '';
  if (linha.length <= CORTE_DO_TEXTO) return linha;
  let i = CORTE_DO_TEXTO;
  while (i > 0 && !/[\s,.;:(]/.test(linha[i])) i--;
  return (i > 0 ? linha.slice(0, i) : linha.slice(0, CORTE_DO_TEXTO)).replace(/[\s,.;:(]+$/, '') + '...';
}

/**
 * Mede o injetado. `alvo` vem do localizar(): { caminho, plugins } ou { causa, motivo }. Falha de leitura nunca vira
 * zero: e "nao medido" com a causa. Zero so quando a transcricao se leu e nenhum gancho injetou nada.
 */
function medir(alvo) {
  if (!alvo) return naoMedido('sem-transcricao', 'nao medido: nenhuma transcricao foi passada');
  if (alvo.causa) return naoMedido(alvo.causa, alvo.motivo);
  let texto;
  try {
    texto = fs.readFileSync(alvo.caminho, 'utf8');
  } catch (e) {
    return naoMedido((e && e.code) || 'ERRO', 'nao medido: nao consegui ler a transcricao ' + alvo.caminho + ' (' + textoLib.causaDoErro(e) +
      '); confira o caminho e a permissao de leitura, ou passe outro .jsonl em --transcricao', alvo.caminho);
  }
  const registros = [];
  let lidas = 0;
  for (const l of texto.split('\n')) {
    if (!l.trim()) continue;
    let o;
    try { o = JSON.parse(l); } catch (e) { continue; }
    lidas++;
    if (o && o.isSidechain !== true && o.attachment && typeof o.attachment === 'object') registros.push(o.attachment);
  }
  if (lidas === 0) {
    return naoMedido('formato', 'nao medido: nenhuma linha da transcricao ' + alvo.caminho + ' e JSON; confira se o arquivo e o .jsonl ' +
      'da sessao (em <config>/projects/), ou o formato da transcricao mudou nesta versao do Claude Code', alvo.caminho);
  }

  const mapa = lerPlugins(alvo.plugins);
  const sucessos = registros.filter(function (a) { return a.type === 'hook_success'; });
  // indice: evento + texto -> comandos; com o toolUseID primeiro, e so pelo evento quando o id nao casa (SessionStart)
  const porId = new Map();
  const porEvento = new Map();
  for (const s of sucessos) {
    const ac = contextoDoStdout(s.stdout);
    if (typeof ac !== 'string' || !ac) continue;
    const k = s.hookEvent + '\u0000' + ac;
    if (!porId.has(s.toolUseID + '\u0000' + k)) porId.set(s.toolUseID + '\u0000' + k, s.command);
    if (!porEvento.has(k)) porEvento.set(k, s.command);
  }

  const grupos = new Map();
  const repetidos = new Map();
  const somar = function (plugin, gancho, t) {
    const k = plugin + '\u0000' + gancho;
    const g = grupos.get(k) || { plugin: plugin, gancho: gancho, vezes: 0, caracteres: 0 };
    g.vezes++; g.caracteres += t.length;
    grupos.set(k, g);
    const c = cabeca(t);
    const kr = k + '\u0000' + c;
    const r = repetidos.get(kr) || { texto: c, plugin: plugin, gancho: gancho, vezes: 0, caracteres: 0 };
    r.vezes++; r.caracteres += t.length;
    repetidos.set(kr, r);
  };

  for (const a of registros) {
    if (a.type !== 'hook_additional_context' || !Array.isArray(a.content)) continue;
    for (const t of a.content) {
      if (typeof t !== 'string' || !t) continue;
      const k = a.hookEvent + '\u0000' + t;
      const comando = porId.has(a.toolUseID + '\u0000' + k) ? porId.get(a.toolUseID + '\u0000' + k) : porEvento.get(k);
      somar(comando === undefined ? NAO_IDENTIFICADO : pluginDoComando(comando, mapa), ganchoDe(a), t);
    }
  }
  for (const s of sucessos) {
    if ((s.hookEvent === 'SessionStart' || s.hookEvent === 'UserPromptSubmit') && contextoDoStdout(s.stdout) === undefined &&
        typeof s.content === 'string' && s.content) {
      somar(pluginDoComando(s.command, mapa), s.hookEvent + ' (texto puro)', s.content);
    }
  }

  const porGancho = Array.from(grupos.values()).sort(function (x, y) {
    return y.caracteres - x.caracteres || (x.plugin + x.gancho).localeCompare(y.plugin + y.gancho);
  });
  const total = porGancho.reduce(function (s, g) { return { vezes: s.vezes + g.vezes, caracteres: s.caracteres + g.caracteres }; }, { vezes: 0, caracteres: 0 });
  const r = {
    medido: true,
    caminho: alvo.caminho,
    total: total,
    porGancho: porGancho,
    repetidos: Array.from(repetidos.values()).filter(function (x) { return x.vezes > VOLTA_MAIS_DE; })
      .sort(function (x, y) { return y.vezes - x.vezes || y.caracteres - x.caracteres; }),
    metodo: METODO,
    nota: NOTA
  };
  if (registros.filter(function (a) { return a.type === 'hook_success' || a.type === 'hook_additional_context'; }).length === 0) {
    r.aviso = 'nenhum registro de gancho na transcricao: se havia gancho ligado, o formato pode ter mudado';
  }
  return r;
}

module.exports = { VOLTA_MAIS_DE, CORTE_DO_TEXTO, localizar, anterior, medir, cabeca, pluginDoComando };
