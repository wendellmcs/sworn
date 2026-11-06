'use strict';
const degraus = require('./degraus.js');
const { ascii } = require('./escopo.js');
const { entreAspas } = require('./texto.js');

/**
 * D694 (T3 da escada, D678): a escalada despachada. O agente de um degrau que passa do papel dele termina a resposta
 * com a linha `ESCALAR: <agente> - <motivo>`, e o <agente> e o DESTINO.
 * O escalar.js guarda o pedido na sessao no fim do subagente (`aoFechar`) e da baixa quando o destino nasce
 * (`aoAbrir`); o portao-fecho.js barra o fim do turno com pedido sem despacho (`motivoDoFecho`) e limpa
 * (`semPendentes`). Sonda s167 (claude 2.1.310): o Agent roda em segundo plano, o PostToolUse dele so traz o agentId e
 * o texto do subagente chega no SubagentStop (ou no SubagentHandback, no modo auto).
 * Estado: `s.escalada = { pendentes: [{ id, de, para, motivo, n, deNovo? }], aguardando: { <para>: n },
 * subidas: { <agent_id>: n }, lidos: [<agent_id>], refazer: { <topo>: true }, refeitos: [<agent_id>] }`. `pendentes` e
 * o que o fecho cobra; `aguardando` liga o proximo despacho do destino a cadeia, cobrado ou nao (o despacho costuma vir
 * depois do bloqueio do fecho). `n` = a subida na cadeia, que comeca no agente despachado sem pedido.
 * D785 (2.2, revoga em parte a D694): nenhum ramo para no usuario. Subir e sempre para um agente acima, entao a cadeia
 * tem o teto da escada; o topo que pede e despachado de novo, uma vez (`deNovo`, `refazer` ate o despacho, `refeitos`
 * ate o fim dele); o re-despachado que pede outra vez esgotou a escada (`para` null): o fecho diz o que segue falhando.
 */

// Os ultimos subagentes lidos: o handback e o fim do mesmo subagente dao um pedido so.
const LIDOS_GUARDADOS = 20;
// A linha inteira, que pode vir em crase, negrito ou citacao (o modelo de agente a mostra entre crases); ESCALATE e a
// grafia em ingles (D656, detector nos dois idiomas). O nome pode vir entre aspas.
// Leitura linear (s168: a de antes era quadratica, 100 mil espacos = 14,5 s, e o gancho tem 10 s): nenhum trecho
// repetido aceita o mesmo caractere que o seguinte (o nome nao comeca com `_`, que degraus.NOME ja recusa), e a
// moldura do fim sai do motivo depois do teto, em `aparar`.
const LINHA = /^[ \t>*_`]*(?:ESCALAR|ESCALATE):[ \t*_]*["'`]?([^\s"'`*_][^\s"'`*]*)["'`]?[ \t]+[-–—][ \t]+(\S.*)$/gm;
const MOTIVO_MAX = 300;

function aparar(motivo) { return motivo.slice(0, MOTIVO_MAX).replace(/[ \t*_`]+$/, ''); }

/** O pedido da ultima linha de marcador com nome de agente valido, ou null. Nunca lanca. */
function marcador(texto) {
  if (typeof texto !== 'string') return null;
  let achado = null;
  let m;
  LINHA.lastIndex = 0;
  while ((m = LINHA.exec(texto)) !== null) {
    if (degraus.NOME.test(m[1])) achado = { agente: m[1], motivo: aparar(m[2]) };
  }
  return achado;
}

function mapa(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? Object.assign({}, v) : {};
}

// Pedido que nao e objeto (estado editado a mao ou corrompido) sai na copia: com ele o fecho lancava e o io.blindar
// liberava todo Stop da sessao (s168).
function ehPedido(p) { return p !== null && typeof p === 'object'; }

function copia(s) {
  const e = s && s.escalada && typeof s.escalada === 'object' ? s.escalada : {};
  return {
    pendentes: Array.isArray(e.pendentes) ? e.pendentes.filter(ehPedido) : [],
    aguardando: mapa(e.aguardando),
    subidas: mapa(e.subidas),
    lidos: Array.isArray(e.lidos) ? e.lidos.slice() : [],
    refazer: mapa(e.refazer),
    refeitos: Array.isArray(e.refeitos) ? e.refeitos.slice() : []
  };
}

// aoFechar e aoAbrir devolvem o proprio `s.escalada` (ate undefined) quando nada muda: o escalar.js so grava o estado
// quando muda, e a sessao sem escalada nao ganha o campo.

/**
 * Fim do subagente `tipo` (`id` = agent_id) com a `mensagem` dele: devolve a escalada nova, ou o proprio `s.escalada`
 * quando nada muda. So age com escada de degraus.MINIMO+ nomes e agente de dentro dela.
 */
function aoFechar(s, tipo, id, mensagem, projeto) {
  const atual = s ? s.escalada : undefined;
  const e = copia(s);
  const escada = projeto && projeto.agentes && Array.isArray(projeto.agentes.escada) ? projeto.agentes.escada : [];
  if (escada.length < degraus.MINIMO || escada.indexOf(tipo) === -1 || typeof id !== 'string' ||
    e.lidos.indexOf(id) !== -1) return atual;
  // O fim do subagente encerra a cadeia dele, com ou sem pedido: a lista nao cresce na sessao.
  const tinhaCadeia = Object.hasOwn(e.subidas, id);
  const subida = e.subidas[id] || 0;
  delete e.subidas[id];
  const refeito = e.refeitos.indexOf(id) !== -1;
  e.refeitos = e.refeitos.filter(function (r) { return r !== id; });
  const pedido = marcador(mensagem);
  if (!pedido) return tinhaCadeia ? e : atual;
  registrar(e, escada, tipo, id, pedido, subida + 1, refeito);
  return e;
}

/**
 * A2-68: o pedido entra em `e.pendentes` (o que o fecho cobra) e liga o destino a cadeia, na subida `n`. Destino fora
 * da escada, abaixo ou igual vira o degrau seguinte; o topo pede o proprio topo de novo (`deNovo`), e o topo ja
 * re-despachado (`refeito`) pede sem destino (`para` null).
 */
function registrar(e, escada, tipo, id, pedido, n, refeito) {
  const i = escada.indexOf(tipo);
  const acima = escada.indexOf(pedido.agente) > i ? pedido.agente : (escada[i + 1] || null);
  const deNovo = acima === null && !refeito;
  const para = deNovo ? tipo : acima;
  e.pendentes.push(Object.assign({ id: id, de: tipo, para: para, motivo: pedido.motivo, n: n },
    deNovo ? { deNovo: true } : {}));
  // atalho: a ligacao da cadeia e por destino, nao por pedido. limite: dois pedidos ao mesmo destino ao mesmo tempo
  // dividem uma ligacao (vale o n do ultimo); e o despacho que nao vem deixa a ligacao (e a marca `refazer`) para a
  // proxima abertura do destino, mesmo sem relacao (A2-63): o n so conta, e a marca gasta o re-despacho do topo
  // daquela abertura. trocar quando: o SubagentStart trouxer quem pediu o despacho.
  if (para !== null) e.aguardando[para] = n;
  if (deNovo) e.refazer[tipo] = true;
  e.lidos = e.lidos.concat([id]).slice(-LIDOS_GUARDADOS);
}

/** Comeco do subagente `tipo`: o pedido que o tinha como destino foi despachado; a cadeia segue no `id` dele. */
function aoAbrir(s, tipo, id) {
  const e = copia(s);
  const k = e.pendentes.findIndex(function (p) { return p.para === tipo; });
  if (typeof id !== 'string' || (k === -1 && !Object.hasOwn(e.aguardando, tipo))) return s ? s.escalada : undefined;
  e.subidas[id] = Object.hasOwn(e.aguardando, tipo) ? e.aguardando[tipo] : e.pendentes[k].n;
  delete e.aguardando[tipo];
  if (k !== -1) e.pendentes.splice(k, 1);
  if (e.refazer[tipo] === true) {
    delete e.refazer[tipo];
    e.refeitos = e.refeitos.concat([id]).slice(-LIDOS_GUARDADOS);
  }
  return e;
}

/** D785 (2.2): o despacho de `tipo` agora e o re-despacho do topo (o portao-agente.js libera o esforco dele). */
function deNovo(s, tipo) {
  return copia(s).refazer[tipo] === true;
}

/** A escalada sem os pedidos (cobrados no fecho); a cadeia e os lidos ficam. */
function semPendentes(s) {
  const e = copia(s);
  e.pendentes = [];
  return e;
}

function umPedido(p) {
  const motivo = entreAspas(ascii(p.motivo).slice(0, MOTIVO_MAX));
  const quem = 'O agente ' + entreAspas(ascii(p.de));
  // D785 (2.2): nenhum ramo para no usuario; sem o jargao da escada (degrau, subida, topo), como no A2-58.
  if (p.para === null) {
    return [quem + ' e o ultimo da escada de agentes (agentes.escada no projeto.json), ja foi despachado de novo',
      '  e pediu um acima outra vez: ' + motivo + '.',
      '  Sem perguntar ao usuario: feche dizendo o que segue falhando e o que o agente viu, com',
      '  a saida do teste ou do comando que falha num bloco ``` . Nao pergunte ao usuario o que fazer.'];
  }
  const para = entreAspas(ascii(p.para));
  if (p.deNovo === true) {
    return [quem + ' e o ultimo da escada de agentes (agentes.escada no projeto.json) e pediu um acima dele: ' +
      motivo + '.',
      '  Sem perguntar ao usuario, despache-o de novo com esforco maximo:',
      '  Agent({ subagent_type: ' + para + ', effort: "max", ... }),',
      '  com a tarefa, o que ele viu e o motivo no prompt.'];
  }
  // A2-57: o que vai no prompt fica em texto, fora da chamada (o molde do custo.js), e nada sai para copiar literal.
  return [quem + ' parou e pediu ' + para + ': ' + motivo + '.',
    '  Despache agora: Agent({ subagent_type: ' + para +
      ', ... }), com a tarefa, o que o agente viu e o motivo no prompt.'];
}

/** O motivo do fecho do turno com pedido sem despacho, ou null. Texto ao modelo em ASCII (R5), em portugues (D665). */
function motivoDoFecho(s) {
  const pendentes = copia(s).pendentes;
  if (!pendentes.length) return null;
  // A2-59: a saida sem despacho so onde a ordem e despachar; na escada esgotada a ordem e o fecho honesto, e o topo
  // de novo (D785) despacha sem saida.
  const despacha = pendentes.some(function (p) { return p.para !== null && p.deNovo !== true; });
  // R2 da revisao s330: a saida e uma linha so, no fim; junto de um pedido comum, ela diz que o topo nao a tem.
  const deNovo = pendentes.filter(function (p) { return p.deNovo === true; }).map(function (p) {
    return 'O re-despacho do ' + entreAspas(ascii(p.para)) + ' nao tem essa saida.';
  });
  return ['sworn - escalada pedida e nao despachada.', ''].concat(
    pendentes.flatMap(umPedido),
    despacha ? ['', 'Se a tarefa nao precisa mesmo do agente pedido, siga sem despachar e conte ao usuario' +
      ' o motivo.'].concat(deNovo) : []
  ).join('\n');
}

module.exports = { marcador, aoFechar, aoAbrir, deNovo, semPendentes, motivoDoFecho };
