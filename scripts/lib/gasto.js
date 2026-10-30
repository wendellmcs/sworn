'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PRECOS } = require('./calibracao.js');

// Pedido 31 (plano dos pedidos 30-32, Tarefa 3; D520): o gasto do mes, separado do da sessao. Duas fontes:
// (1) o cost.usd real de cada sessao com o mod carregado, que o mod soma no $.store (conta inteira) e manda ao
// sessao.js; (2) as transcricoes .jsonl do mes, de TODAS as pastas de projeto (a janela semanal tambem e da conta),
// com subagentes, estimadas pela tabela de preco do calibracao.js. Sessao com valor real sai da estimativa.
// Em assinatura e valor equivalente de API, nao cobranca (o cost.usd da sessao ja e isso).
// O mes tem ~2 GB de transcricoes (s53: 2871 arquivos em 1,9 GB): a leitura vai por cache de arquivo (tamanho e
// data) e por prazo; o que nao coube no prazo fica pendente e a proxima medida continua.

const PRAZO_PADRAO_MS = 2000;

function num(v) { return typeof v === 'number' && isFinite(v); }
function dois(n) { return String(n).padStart(2, '0'); }

/** O mes de `agoraMs` na hora local: ms do dia 1 a meia-noite, a chave AAAA-MM e o "desde DD/MM". */
function inicioDoMes(agoraMs) {
  const d = new Date(agoraMs);
  const ini = new Date(d.getFullYear(), d.getMonth(), 1);
  return { ms: ini.getTime(), chave: d.getFullYear() + '-' + dois(d.getMonth() + 1), desde: '01/' + dois(d.getMonth() + 1) };
}

/** Custo estimado de uma transcricao: uma vez por mensagem (o id se repete em varias linhas), so desde `desdeMs`. */
function custoDoTexto(texto, desdeMs) {
  const vistos = new Set();
  let usd = 0, semPreco = 0;
  for (const linha of String(texto).split('\n')) {
    if (linha.indexOf('"usage"') === -1) continue;
    let o;
    try { o = JSON.parse(linha); } catch (e) { continue; }
    const m = o && o.type === 'assistant' && o.message;
    if (!m || !m.usage || !m.model || m.model === '<synthetic>') continue;
    // Plano 082 (p6-1): so o id que existe junta as linhas; sem id, cada linha conta (o undefined no Set descartava
    // todas as mensagens sem id depois da primeira).
    const temId = typeof m.id === 'string' && m.id !== '';
    if (temId && vistos.has(m.id)) continue;
    if (temId) vistos.add(m.id);
    if (!(Date.parse(o.timestamp) >= desdeMs)) continue;
    const p = PRECOS[m.model];
    if (!p) { semPreco++; continue; }
    const u = m.usage;
    const escrita = u.cache_creation_input_tokens || 0;
    const cc = u.cache_creation || {};
    const w1 = cc.ephemeral_1h_input_tokens || 0;
    const w5 = num(cc.ephemeral_5m_input_tokens) ? cc.ephemeral_5m_input_tokens : Math.max(0, escrita - w1);
    usd += ((u.input_tokens || 0) * p[0] + (u.output_tokens || 0) * p[1] + (u.cache_read_input_tokens || 0) * p[2] +
      w5 * p[3] + w1 * p[4]) / 1e6;
  }
  return { usd: usd, semPreco: semPreco };
}

/**
 * Os .jsonl de uma pasta de projeto: `<sessao>.jsonl`, `<sessao>/subagents/*.jsonl` e os agentes de workflow
 * (`<sessao>/subagents/workflows/<run>/agent-*.jsonl`; o journal.jsonl do run nao e transcricao), cada um com a sessao
 * dele; `subagente` true nos dois ultimos.
 */
function arquivosDoProjeto(dir) {
  const lista = [];
  let itens;
  try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return lista; }
  for (const it of itens) {
    if (it.isFile() && /\.jsonl$/i.test(it.name)) lista.push({ arquivo: path.join(dir, it.name), sessao: it.name.replace(/\.jsonl$/i, '') });
    if (!it.isDirectory()) continue;
    const sub = path.join(dir, it.name, 'subagents');
    let ags;
    try { ags = fs.readdirSync(sub); } catch (e) { continue; }
    for (const a of ags) if (/\.jsonl$/i.test(a)) lista.push({ arquivo: path.join(sub, a), sessao: it.name, subagente: true });
    // A6 (pedido 12, lacuna (a) da sonda da s186): o agente de workflow mora um nivel abaixo e ficava fora do gasto do
    // mes e do efetivo.
    let runs;
    try { runs = fs.readdirSync(path.join(sub, 'workflows')); } catch (e) { continue; }
    for (const run of runs) {
      let wf;
      try { wf = fs.readdirSync(path.join(sub, 'workflows', run)); } catch (e) { continue; }
      for (const a of wf) {
        if (/^agent-.+\.jsonl$/i.test(a)) lista.push({ arquivo: path.join(sub, 'workflows', run, a), sessao: it.name, subagente: true });
      }
    }
  }
  return lista;
}

/**
 * Estimativa do mes pelas transcricoes de `raiz` (a pasta projects). `cache`: { [arquivo]: { tamanho, data, mes, usd,
 * semPreco } }; vale a entrada do mesmo mes, tamanho e data. Arquivo com data antes do mes nao e lido. Devolve o total,
 * quantos arquivos ficaram para a proxima medida (`pendentes`), quantos nao se leram (`ilegiveis`: fora do cache, a
 * proxima medida tenta de novo), as mensagens de modelo sem preco (`semPreco`, tambem as do cache) e o cache novo (so
 * os arquivos do mes).
 */
function estimarMes(opcoes) {
  const o = opcoes || {};
  const mes = o.mes || {};
  const fora = new Set(Array.isArray(o.excluir) ? o.excluir : []);
  const velho = o.cache && typeof o.cache === 'object' ? o.cache : {};
  const prazo = num(o.prazoMs) ? o.prazoMs : PRAZO_PADRAO_MS;
  const inicio = Date.now();
  const cache = {};
  let usd = 0, pendentes = 0, semPreco = 0, ilegiveis = 0;
  let projetos;
  // A6 (s220, R1 :89): so a raiz ausente da zero calado; a que existe e nao se le conta em `ilegiveis`.
  try { projetos = fs.readdirSync(o.raiz, { withFileTypes: true }); } catch (e) {
    if (e.code !== 'ENOENT') ilegiveis++;
    projetos = [];
  }
  for (const p of projetos) {
    if (!p.isDirectory()) continue;
    for (const f of arquivosDoProjeto(path.join(o.raiz, p.name))) {
      if (fora.has(f.sessao)) continue;
      let st;
      // p2-7: o arquivo que some entre o readdir e o stat tambem e "nao se leu" (saia calado).
      try { st = fs.statSync(f.arquivo); } catch (e) { ilegiveis++; continue; }
      if (st.mtimeMs < mes.ms) continue;
      const c = velho[f.arquivo];
      if (c && c.mes === mes.chave && c.tamanho === st.size && c.data === st.mtimeMs && num(c.usd)) {
        cache[f.arquivo] = c;
        usd += c.usd;
        // p6-3: o cache guarda o semPreco do arquivo (entrada antiga, sem o campo, conta 0).
        if (num(c.semPreco)) semPreco += c.semPreco;
        continue;
      }
      if (Date.now() - inicio >= prazo) { pendentes++; continue; }
      let texto;
      // p6-2: o que nao se le conta em `ilegiveis` (valia zero calado).
      try { texto = fs.readFileSync(f.arquivo, 'utf8'); } catch (e) { ilegiveis++; continue; }
      const r = custoDoTexto(texto, mes.ms);
      semPreco += r.semPreco;
      cache[f.arquivo] = { tamanho: st.size, data: st.mtimeMs, mes: mes.chave, usd: r.usd, semPreco: r.semPreco };
      usd += r.usd;
    }
  }
  return { usd: usd, pendentes: pendentes, semPreco: semPreco, ilegiveis: ilegiveis, cache: cache };
}

function pastaDosProjetos(env, casa) {
  const e = env || process.env;
  return path.join(e.CLAUDE_CONFIG_DIR || path.join(casa || os.homedir(), '.claude'), 'projects');
}

/**
 * O gasto do mes para o medidor: `real` e o mapa do $.store ({ 'AAAA-MM': { sessao: usd } }); o cache da estimativa
 * fica em `arquivoDoCache` (gravado so quando muda). Nunca lanca: o que nao se le conta zero.
 */
function gastoDoMes(opcoes) {
  const o = opcoes || {};
  const mes = inicioDoMes(num(o.agora) ? o.agora : Date.now());
  const doMes = o.real && typeof o.real === 'object' && o.real[mes.chave] && typeof o.real[mes.chave] === 'object'
    ? o.real[mes.chave] : {};
  const comReal = Object.keys(doMes).filter(function (k) { return num(doMes[k]) && doMes[k] >= 0; });
  const real = comReal.reduce(function (t, k) { return t + doMes[k]; }, 0);
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(o.arquivoDoCache, 'utf8')); } catch (e) { cache = {}; }
  const est = estimarMes({ raiz: o.raiz || pastaDosProjetos(), mes: mes, cache: cache, excluir: comReal, prazoMs: o.prazoMs });
  if (JSON.stringify(est.cache) !== JSON.stringify(cache)) {
    try {
      fs.mkdirSync(path.dirname(o.arquivoDoCache), { recursive: true });
      fs.writeFileSync(o.arquivoDoCache, JSON.stringify(est.cache));
    } catch (e) { /* sem cache a proxima medida rele: so mais lenta */ }
  }
  // Plano 082 (p6-2, p6-3): ilegiveis e semPreco seguem adiante (o estimarMes devolvia, e paravam aqui).
  return { usd: real + est.usd, real: real, estimado: est.usd, pendentes: est.pendentes, semPreco: est.semPreco,
    ilegiveis: est.ilegiveis, desde: mes.desde };
}

const MAX_HISTORICO = 40;
const JANELAS_DO_HISTORICO = ['five_hour', 'seven_day'];

function objeto(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }

/**
 * Pedido 31: o que o mod grava no $.store depois de cada medida (o sessao.js devolve, o mod so grava). `gastoReal`:
 * { 'AAAA-MM': { sessao: cost.usd } }, os 2 ultimos meses. `historico`: por sessao, o % de cada janela (5h e semana)
 * no 1o e no ultimo momento medido, com a renovacao de cada ponta (a sessao que cruza a renovacao nao entra na media)
 * e quantas medidas teve; as 40 mais recentes. Copia: nao muda o que recebeu.
 */
function guardarSessao(opcoes) {
  const o = opcoes || {};
  const historico = Object.assign({}, objeto(o.historico) || {});
  const gastoReal = Object.assign({}, objeto(o.gastoReal) || {});
  const sessao = typeof o.sessao === 'string' ? o.sessao : '';
  if (!sessao) return { historico: historico, gastoReal: gastoReal };
  const uso = objeto(o.uso) || {};
  const agora = num(o.agora) ? o.agora : Date.now();
  if (uso.cost && num(uso.cost.usd)) {
    const chave = inicioDoMes(agora).chave;
    gastoReal[chave] = Object.assign({}, objeto(gastoReal[chave]) || {}, { [sessao]: uso.cost.usd });
    for (const k of Object.keys(gastoReal).sort().slice(0, -2)) delete gastoReal[k];
  }
  const antes = objeto(historico[sessao]) || {};
  const janelas = Object.assign({}, objeto(antes.janelas) || {});
  for (const j of Array.isArray(uso.rateLimits) ? uso.rateLimits : []) {
    if (!j || JANELAS_DO_HISTORICO.indexOf(j.kind) === -1 || !num(j.percentUsed)) continue;
    const reset = j.resetsAt == null ? null : String(j.resetsAt);
    const velha = objeto(janelas[j.kind]);
    janelas[j.kind] = velha
      ? Object.assign({}, velha, { resetFim: reset, fim: j.percentUsed })
      : { resetIni: reset, ini: j.percentUsed, resetFim: reset, fim: j.percentUsed };
  }
  historico[sessao] = { t: agora, medidas: (num(antes.medidas) ? antes.medidas : 0) + 1, janelas: janelas };
  const ordem = Object.keys(historico).sort(function (a, b) {
    return (num(historico[b] && historico[b].t) ? historico[b].t : 0) - (num(historico[a] && historico[a].t) ? historico[a].t : 0);
  });
  for (const k of ordem.slice(MAX_HISTORICO)) delete historico[k];
  return { historico: historico, gastoReal: gastoReal };
}

module.exports = { inicioDoMes, custoDoTexto, arquivosDoProjeto, estimarMes, gastoDoMes, guardarSessao, pastaDosProjetos, PRAZO_PADRAO_MS };
