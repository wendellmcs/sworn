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
 * Estado: `s.escalada = { pendentes: [{ id, de, para, motivo, n }], aguardando: { <para>: n }, subidas: { <agent_id>: n },
 * lidos: [<agent_id>] }`. `pendentes` e o que o fecho cobra; `aguardando` liga o proximo despacho do destino a cadeia,
 * cobrado ou nao (o despacho costuma vir depois do bloqueio do fecho). `para` null = o topo da escada pediu; `n` = a
 * subida na cadeia, que comeca no agente despachado sem pedido.
 */

// Duas subidas sozinhas por cadeia (do barato ao caro numa escada de 3); a terceira e decisao do usuario, pelo custo.
const TETO_DE_SUBIDAS = 2;
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
    lidos: Array.isArray(e.lidos) ? e.lidos.slice() : []
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
  const pedido = marcador(mensagem);
  if (!pedido) return tinhaCadeia ? e : atual;
  registrar(e, escada, tipo, id, pedido, subida + 1);
  return e;
}

/**
 * A2-68: o pedido entra em `e.pendentes` (o que o fecho cobra) e liga o destino a cadeia, na subida `n`. Destino fora
 * da escada, abaixo ou igual vira o degrau seguinte; o topo pede sem destino (`para` null).
 */
function registrar(e, escada, tipo, id, pedido, n) {
  const i = escada.indexOf(tipo);
  const para = escada.indexOf(pedido.agente) > i ? pedido.agente : (escada[i + 1] || null);
  e.pendentes.push({ id: id, de: tipo, para: para, motivo: pedido.motivo, n: n });
  // atalho: a ligacao da cadeia e por destino, nao por pedido. limite: dois pedidos ao mesmo destino ao mesmo tempo
  // dividem uma ligacao (vale o n do ultimo); e o despacho que nao vem deixa a ligacao para a proxima abertura do
  // destino, mesmo sem relacao (A2-63), que herda o n e chega antes ao teto: pergunta ao usuario mais cedo, nunca
  // sobe sem perguntar. trocar quando: o SubagentStart trouxer quem pediu o despacho.
  if (para !== null) e.aguardando[para] = n;
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
  return e;
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
  // A2-58: as 3 opcoes nomeadas nos dois ramos em que o usuario decide, sem o jargao da escada (degrau, subida, topo).
  if (p.para === null) {
    return [quem + ' e o ultimo da escada de agentes (agentes.escada no projeto.json) e pediu um acima dele: ' +
      motivo + '.',
      '  Pare e leve ao usuario o que o agente viu e o motivo, em 3 opcoes: seguir com este agente e mais contexto,',
      '  dividir ou mudar a tarefa, ou parar.'];
  }
  const para = entreAspas(ascii(p.para));
  if (p.n > TETO_DE_SUBIDAS) {
    return [quem + ' pediu ' + para + ': ' + motivo + '.',
      '  Seria a ' + p.n + 'a troca desta tarefa por um agente mais caro, acima do teto de ' + TETO_DE_SUBIDAS +
        ' trocas que o sworn faz sozinho.',
      '  Pare e leve ao usuario em 3 opcoes: despachar ' + para +
        ' (custo maior), seguir com o agente de agora, ou parar.'];
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
  // A2-59: a saida sem despacho so onde a ordem e despachar (o ramo do fim de umPedido); no topo e acima do teto quem
  // decide e o usuario.
  const despacha = pendentes.some(function (p) { return p.para !== null && !(p.n > TETO_DE_SUBIDAS); });
  return ['sworn - escalada pedida e nao despachada.', ''].concat(
    pendentes.flatMap(umPedido),
    despacha ? ['', 'Se a tarefa nao precisa mesmo do agente pedido, siga sem despachar e conte ao usuario' +
      ' o motivo.'] : []
  ).join('\n');
}

module.exports = { TETO_DE_SUBIDAS, marcador, aoFechar, aoAbrir, semPendentes, motivoDoFecho };
