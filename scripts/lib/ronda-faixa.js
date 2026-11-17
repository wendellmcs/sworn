'use strict';
const { PRECOS, novaChamada } = require('./calibracao.js');
const { centavos } = require('./medidor.js');

// V5 (D847): o andamento da revisao cega na faixa. O mod (hooks/mods.tsx) anota cada inspetor que o motor dispara
// (agent.spawn do sworn:inspector) e o fim dele (turn.complete com o agentId, com o usage); este modulo agrupa a
// ronda que esta rodando, escreve a linha da faixa e o detalhe do /sworn-review. O custo sai da tabela de precos do
// /sworn:calibrate (calibracao.js), pela mesma conta das chamadas da calibracao.

// Inspetor sem fim ha mais que isto parou sem responder: nao conta como rodando (a faixa nao fica presa nele).
const PARADO_MS = 30 * 60 * 1000;
// Depois de todos prontos, um inspetor novo com o mesmo numero de ronda ainda entra no mesmo grupo se vier ate este
// tempo depois: uma ronda do /sworn:review cobre varios arquivos, despachados em lotes de ate 8 (o numero da ronda e
// a chave, nao o arquivo). Passou disso, ou mudou o numero, e outra ronda.
const PAUSA_MS = 10 * 60 * 1000;
// O caminho dos vereditos que o briefing leva: .claude/sworn/revisao/<id>/<ronda>/[invertida/]vereditos. O id e o de
// scripts/lib/cegar.js (o caminho do arquivo com "/" trocado por "__" e todo caractere fora de [a-zA-Z0-9._-] por
// "_"), entao nunca tem espaco, aspa nem caractere de controle: com eles nao e id, e nao casa (nada de escape de
// terminal no texto do /sworn-review).
const CAMINHO = /revisao[\\/]+([^\\/\s`'"\u0000-\u001f\u007f]+)[\\/]+(\d+)[\\/]+(?:invertida[\\/]+)?vereditos/;
const NOMES = ['opus', 'sonnet', 'haiku', 'fable'];
const PARADO_MIN = Math.round(PARADO_MS / 60000);

/**
 * O arquivo e a ronda do caminho dos vereditos, ou nulls. O arquivo e o id com "__" de volta a "/": so o rotulo do
 * /sworn-review (o id do cegar.js perde o "__" proprio de um nome e o acento, que viram "/" e "_" aqui).
 */
function rondaDoCaminho(texto) {
  const m = typeof texto === 'string' ? CAMINHO.exec(texto) : null;
  if (!m) return { arquivo: null, ronda: null };
  return { arquivo: m[1].split('__').join('/'), ronda: Number(m[2]) };
}

/** O nome curto do modelo ("opus", "sonnet"...), ou o id como veio; '' sem modelo. */
function curto(modelo) {
  if (typeof modelo !== 'string' || !modelo.trim()) return '';
  const baixo = modelo.toLowerCase();
  return NOMES.find(function (n) { return baixo.includes(n); }) || modelo.trim();
}

/** O id na tabela de precos: sem o sufixo de contexto ("[1m]") nem a data ("-20261001"). */
function idDoPreco(modelo) {
  if (typeof modelo !== 'string') return null;
  const id = modelo.trim().replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '');
  return Object.hasOwn(PRECOS, id) ? id : null;
}

/** O custo em US$ de um usage, ou null (sem usage, ou modelo fora da tabela). */
function custoDe(usage, modelo) {
  if (!usage || typeof usage !== 'object') return null;
  const id = idDoPreco(typeof usage.model === 'string' ? usage.model : modelo);
  if (!id) return null;
  const c = novaChamada(usage, PRECOS[id], 0).custo;
  return Number.isFinite(c) ? c : null;
}

/** Os inspetores validos, em ordem de inicio. */
function normalizar(lista) {
  if (!Array.isArray(lista)) return [];
  return lista.filter(function (i) { return i && typeof i === 'object' && Number.isFinite(i.inicio); })
    .map(function (i) {
      const r = rondaDoCaminho(i.vereditos);
      return { arquivo: r.arquivo, ronda: r.ronda, modelo: typeof i.modelo === 'string' ? i.modelo : '',
        inicio: i.inicio, fim: Number.isFinite(i.fim) ? i.fim : null,
        usage: i.usage && typeof i.usage === 'object' ? i.usage : null };
    })
    .sort(function (a, b) { return a.inicio - b.inicio; });
}

/** O grupo da ronda mais recente: os inspetores desde o ultimo comeco de ronda (ver PAUSA_MS). */
function grupoAtual(insp) {
  let grupo = [];
  for (const i of insp) {
    const vivos = grupo.filter(function (g) { return g.fim === null && i.inicio - g.inicio < PARADO_MS; });
    const ultimoFim = grupo.reduce(function (m, g) { return g.fim !== null && g.fim > m ? g.fim : m; }, -Infinity);
    const mesmoNumero = grupo.some(function (g) { return g.ronda === i.ronda; });
    if (grupo.length && !vivos.length && (!mesmoNumero || i.inicio - ultimoFim > PAUSA_MS)) grupo = [];
    grupo.push(i);
  }
  return grupo;
}

function lista(itens) {
  if (itens.length <= 1) return itens.join('');
  return itens.slice(0, -1).join(', ') + ' e ' + itens[itens.length - 1];
}

function rondas(grupo) {
  const ns = Array.from(new Set(grupo.map(function (g) { return g.ronda; }).filter(Number.isFinite)))
    .sort(function (a, b) { return a - b; });
  if (!ns.length) return '';
  return (ns.length === 1 ? 'ronda ' : 'rondas ') + lista(ns.map(String));
}

function modelos(grupo) {
  return lista(Array.from(new Set(grupo.map(function (g) { return curto(g.modelo); }).filter(Boolean))));
}

/** A soma do custo dos prontos e quantos prontos ficaram sem custo conhecido (sem uso informado ou sem preco). */
function custo(grupo) {
  let usd = 0, semCusto = 0;
  for (const g of grupo) {
    if (g.fim === null) continue;
    const c = custoDe(g.usage, g.modelo);
    if (c === null) semCusto++; else usd += c;
  }
  return { usd: usd, semCusto: semCusto };
}

function textoDoCusto(c, fim) {
  return 'US$ ' + centavos(c.usd) + fim + (c.semCusto ? ' (' + c.semCusto + ' sem custo conhecido, fora do total)' : '');
}

function parados(grupo, agora) {
  if (!Number.isFinite(agora)) return 0;
  return grupo.filter(function (g) { return g.fim === null && agora - g.inicio >= PARADO_MS; }).length;
}

/** "N de M inspetores prontos (modelo)", com os que pararam sem responder (so com a hora de agora). */
function andamento(grupo, agora) {
  const prontos = grupo.filter(function (g) { return g.fim !== null; }).length;
  const p = parados(grupo, agora);
  const m = modelos(grupo);
  return prontos + ' de ' + grupo.length + (grupo.length === 1 ? ' inspetor pronto' : ' inspetores prontos') +
    (m ? ' (' + m + ')' : '') + (p ? ', ' + p + ' sem resposta há ' + PARADO_MIN + ' min ou mais' : '');
}

/** A ronda que roda agora ({ rondas, texto }), ou null: so com inspetor rodando no grupo mais recente. */
function rodandoAgora(insp, agora) {
  if (!Number.isFinite(agora)) return null;
  const grupo = grupoAtual(insp);
  if (!grupo.some(function (g) { return g.fim === null && agora - g.inicio < PARADO_MS; })) return null;
  return { rondas: rondas(grupo), texto: andamento(grupo, agora) + ', ' + textoDoCusto(custo(grupo), ' até agora'),
    parados: parados(grupo, agora) };
}

/**
 * A linha da faixa: so com inspetor rodando no grupo da ronda mais recente; '' fora disso ou com entrada ruim. Com
 * inspetor sem resposta, aponta o /sworn-review (o que fazer com ele esta la; a faixa e uma linha so).
 */
function linha(listaCrua, agora) {
  const r = rodandoAgora(normalizar(listaCrua), agora);
  if (!r) return '';
  return 'revisão cega' + (r.rondas ? ', ' + r.rondas : '') + ': ' + r.texto + (r.parados ? '; veja /sworn-review' : '');
}

/** O texto do /sworn-review: o que roda agora e cada arquivo e ronda desta sessao, com o custo e o que fazer. */
function detalhe(listaCrua, agora) {
  const insp = normalizar(listaCrua);
  if (!insp.length) {
    return 'Nenhum inspetor da revisão cega rodou nesta sessão desde que o sworn carregou. Quando o /sworn:review ' +
      'despachar os inspetores, a faixa mostra o andamento da ronda, e este comando, o detalhe por arquivo.';
  }
  const t = Number.isFinite(agora) ? agora : null;
  const r = rodandoAgora(insp, t);
  const grupos = new Map();
  for (const i of insp) {
    const chave = (i.arquivo || '') + '\u0000' + (i.ronda === null ? '' : i.ronda);
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(i);
  }
  const linhas = ['Revisão cega nesta sessão (desde que o sworn carregou)', '',
    'Agora, somando os arquivos: ' + (r ? (r.rondas ? r.rondas + ', ' : '') + r.texto : 'nenhuma ronda rodando.'),
    '', 'Por arquivo:'];
  for (const g of grupos.values()) {
    const nome = g[0].arquivo || 'arquivo não identificado (o briefing não trazia a pasta dos vereditos)';
    const n = g[0].ronda === null ? '' : ', ronda ' + g[0].ronda;
    linhas.push('- ' + nome + n + ': ' + andamento(g, t) + ', ' + textoDoCusto(custo(g), ''));
  }
  const total = custo(insp);
  linhas.push('', 'Total: ' + insp.length + (insp.length === 1 ? ' inspetor, ' : ' inspetores, ') + textoDoCusto(total, '') + '.');
  if (parados(insp, t)) {
    linhas.push('', 'Sem resposta há ' + PARADO_MIN + ' min ou mais: o inspetor parou e não vota. Diga ao Claude ' +
      '"despache de novo o inspetor que parou": ele manda o mesmo briefing na mesma ronda.');
  }
  if (total.semCusto) {
    linhas.push('', 'Sem custo conhecido: o inspetor terminou sem o uso informado, ou o modelo dele não está na ' +
      'tabela de preços do /sworn:calibrate. O total acima não o inclui.');
  }
  return linhas.join('\n');
}

module.exports = { PARADO_MS, PAUSA_MS, rondaDoCaminho, curto, custoDe, grupoAtual, normalizar, linha, detalhe };
