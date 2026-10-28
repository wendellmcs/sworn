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

function tem(objeto, chave) { return Object.prototype.hasOwnProperty.call(objeto, chave); }

// aoFechar e aoAbrir devolvem o proprio `s.escalada` (ate undefined) quando nada muda: o escalar.js so grava o estado
// quando muda, e a sessao sem escalada nao ganha o campo.

/**
 * Fim do subagente `tipo` (`id` = agent_id) com a `mensagem` dele: devolve a escalada nova. So age com escada de
 * degraus.MINIMO+ nomes e agente de dentro dela. Destino fora da escada, abaixo ou igual vira o degrau seguinte.
 */
function aoFechar(s, tipo, id, mensagem, projeto) {
  const atual = s ? s.escalada : undefined;
  const e = copia(s);
  const escada = projeto && projeto.agentes && Array.isArray(projeto.agentes.escada) ? projeto.agentes.escada : [];
  const i = escada.indexOf(tipo);
  if (escada.length < degraus.MINIMO || i === -1 || typeof id !== 'string' || e.lidos.indexOf(id) !== -1) return atual;
  // O fim do subagente encerra a cadeia dele, com ou sem pedido: a lista nao cresce na sessao.
  const tinhaCadeia = tem(e.subidas, id);
  const n = (e.subidas[id] || 0) + 1;
  delete e.subidas[id];
  const pedido = marcador(mensagem);
  if (!pedido) return tinhaCadeia ? e : atual;
  const j = escada.indexOf(pedido.agente);
  const para = j > i ? pedido.agente : (escada[i + 1] || null);
  e.pendentes.push({ id: id, de: tipo, para: para, motivo: pedido.motivo, n: n });
  // atalho: a ligacao da cadeia e por destino, nao por pedido. limite: dois pedidos ao mesmo destino ao mesmo tempo
  // dividem uma ligacao (vale o n do ultimo). trocar quando: o SubagentStart trouxer quem pediu o despacho.
  if (para !== null) e.aguardando[para] = n;
  e.lidos = e.lidos.concat([id]).slice(-LIDOS_GUARDADOS);
  return e;
}

/** Comeco do subagente `tipo`: o pedido que o tinha como destino foi despachado; a cadeia segue no `id` dele. */
function aoAbrir(s, tipo, id) {
  const e = copia(s);
  const k = e.pendentes.findIndex(function (p) { return p.para === tipo; });
  if (typeof id !== 'string' || (k === -1 && !tem(e.aguardando, tipo))) return s ? s.escalada : undefined;
  e.subidas[id] = tem(e.aguardando, tipo) ? e.aguardando[tipo] : e.pendentes[k].n;
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
  if (p.para === null) {
    return [quem + ' e o topo da escada e pediu escalada: ' + motivo + '.',
      '  Pare e leve ao usuario o que o agente viu e o motivo, em 3 opcoes.'];
  }
  const para = entreAspas(ascii(p.para));
  if (p.n > TETO_DE_SUBIDAS) {
    return [quem + ' pediu ' + para + ': ' + motivo + '.',
      '  E a subida ' + p.n + ' desta tarefa, acima do teto de ' + TETO_DE_SUBIDAS + ' subidas sozinhas.',
      '  Pare e leve ao usuario em 3 opcoes: subir para ' + para + ' (custo maior), seguir no degrau de agora, ou parar.'];
  }
  return [quem + ' parou e pediu ' + para + ': ' + motivo + '.',
    '  Despache agora: Agent({ subagent_type: ' + para + ', prompt: <a tarefa, o que o agente viu e o motivo> }).'];
}

/** O motivo do fecho do turno com pedido sem despacho, ou null. Texto ao modelo em ASCII (R5), em portugues (D665). */
function motivoDoFecho(s) {
  const pendentes = copia(s).pendentes;
  if (!pendentes.length) return null;
  return ['sworn - escalada pedida e nao despachada.', ''].concat(
    pendentes.flatMap(umPedido), [
      '',
      'Se a tarefa nao precisa mesmo subir, diga ao usuario por que nao despachou.'
    ]).join('\n');
}

module.exports = { TETO_DE_SUBIDAS, marcador, aoFechar, aoAbrir, semPendentes, motivoDoFecho };
