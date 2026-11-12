'use strict';
const degraus = require('./degraus.js');
const evidencia = require('./evidencia.js');
const { ascii } = require('./escopo.js');
const { entreAspas } = require('./texto.js');

/**
 * D694 (T3 da escada, D678): a escalada despachada. O agente de um degrau que passa do papel dele termina a resposta
 * com a linha `ESCALAR: <agente> - <motivo>`, e o <agente> e o DESTINO.
 * O escalar.js guarda o pedido na sessao no fim do subagente (`aoFechar`) e da baixa quando o destino nasce
 * (`aoAbrir`); o portao-fecho.js barra o fim do turno com pedido sem despacho (`motivoDoFecho`) e limpa
 * (`semPendentes`). Sonda s167 (claude 2.1.310): o Agent roda em segundo plano, o PostToolUse dele so traz o agentId e
 * o texto do subagente chega no SubagentStop (ou no SubagentHandback, no modo auto).
 * Estado: `s.escalada = { pendentes: [{ id, de, para, motivo, n, deNovo?, automatico?, causa? }], aguardando: { <para>: n },
 * subidas: { <agent_id>: n }, lidos: [<agent_id>], refazer: { <topo>: true }, refeitos: [<agent_id>],
 * semProva: { <tipo>: n } }`. `pendentes` e
 * o que o fecho cobra; `aguardando` liga o proximo despacho do destino a cadeia, cobrado ou nao (o despacho costuma vir
 * depois do bloqueio do fecho). `n` = a subida na cadeia, que comeca no agente despachado sem pedido.
 * D785 (2.2, revoga em parte a D694): nenhum ramo para no usuario. Subir e sempre para um agente acima, entao a cadeia
 * tem o teto da escada; o topo que pede e despachado de novo, uma vez (`deNovo`, `refazer` ate o despacho, `refeitos`
 * ate o fim dele); o re-despachado que pede outra vez esgotou a escada (`para` null): o fecho diz o que segue falhando.
 * B5 (s369, D748 T6): `semProva: { <tipo>: n }` conta os retornos seguidos sem prova de cada degrau; no
 * RETORNOS_SEM_PROVA-esimo ele sobe sozinho, como se pedisse (o pedido leva `automatico: true`), e
 * `paraReinjetar` leva a escalada sem despacho ao texto da compactacao.
 * C4 (s369, D769 g): o segundo gatilho da subida automatica - o degrau que as travas do sworn barraram NEGACOES_PRESO
 * vezes ou mais no despacho (`contarNegacoes`, na transcricao do subagente que o escalar.js le) e voltou sem a prova
 * verde sobe ja nesse retorno; o pedido leva `automatico: true` e `causa: 'negacoes'` (CAUSA_NEGACOES), que escolhe o
 * texto fixo dele. Sem `causa`, o texto e o do B5.
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
// B5 (s369, D748 T6, P20): quantos retornos seguidos sem prova sobem a tarefa sozinhos, e o que o texto diz deles. O
// texto e sempre um fixo (este, ou o MOTIVO_NEGACOES do C4, pela `causa`), nunca o motivo lido do estado: o estado
// editado com `automatico: true` nao injeta texto cru.
const RETORNOS_SEM_PROVA = 2;
const MOTIVO_AUTOMATICO = 'voltou ' + RETORNOS_SEM_PROVA + ' vezes seguidas dizendo que terminou, sem a saida do ' +
  'teste que passa (ou com ela mostrando falha)';
// C4 (s369, D769 g): o degrau preso em negativas - as travas do sworn o barraram NEGACOES_PRESO vezes ou mais no mesmo
// despacho e ele voltou sem a prova verde - sobe ja nesse retorno. O texto tambem e fixo (`causa: 'negacoes'`).
const NEGACOES_PRESO = 3;
const CAUSA_NEGACOES = 'negacoes';
const MOTIVO_NEGACOES = 'foi barrado ' + NEGACOES_PRESO + ' vezes ou mais pelas travas do sworn no mesmo despacho, ' +
  'sem a saida do teste que passa';
// O tool_result que o Claude Code grava quando um gancho PreToolUse do sworn nega a chamada (transcricao conferida).
const NEGACAO = /^PreToolUse:[\w.-]+ hook error: sworn\b/;

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
    refeitos: Array.isArray(e.refeitos) ? e.refeitos.slice() : [],
    semProva: mapa(e.semProva)
  };
}

/** B5: o retorno sem prova e o da trava 3 - alega pronto sem bloco de saida e sem ressalva, ou o bloco mostra falha.
 *  O que nao alega pronto (leitura, pesquisa) e o que nao e texto nao sao retorno sem prova. */
function retornoSemProva(mensagem) {
  return typeof mensagem === 'string' &&
    (evidencia.deveBloquear(mensagem) || evidencia.deveBloquearPorFalha(mensagem));
}

/** C4: a prova verde - alega pronto, com o bloco de saida, e o bloco nao mostra falha. */
function comProvaVerde(mensagem) {
  if (typeof mensagem !== 'string') return false;
  const a = evidencia.analisar(mensagem);
  return a.alegaSucesso && a.temBloco && !retornoSemProva(mensagem);
}

/** C4: quantas chamadas as travas do sworn negaram na transcricao (JSONL) do subagente, uma por tool_use_id. */
function contarNegacoes(texto) {
  if (typeof texto !== 'string') return 0;
  const ids = new Set();
  for (const linha of texto.split('\n')) {
    if (linha.indexOf('hook error: sworn') === -1) continue;
    let o;
    try { o = JSON.parse(linha); } catch (e) { continue; }
    const conteudo = o && o.type === 'user' && o.message && Array.isArray(o.message.content) ? o.message.content : [];
    for (const b of conteudo) {
      if (!b || b.type !== 'tool_result' || b.is_error !== true) continue;
      const t = typeof b.content === 'string' ? b.content : Array.isArray(b.content)
        ? b.content.map(function (x) { return x && typeof x.text === 'string' ? x.text : ''; }).join('') : '';
      if (NEGACAO.test(t)) ids.add(typeof b.tool_use_id === 'string' ? b.tool_use_id : 'sem-id-' + ids.size);
    }
  }
  return ids.size;
}

/** O texto fixo de uma subida automatica, pela causa (nunca o motivo lido do estado). */
function oQueHouve(p) {
  return p.causa === CAUSA_NEGACOES ? MOTIVO_NEGACOES : MOTIVO_AUTOMATICO;
}

// aoFechar e aoAbrir devolvem o proprio `s.escalada` (ate undefined) quando nada muda: o escalar.js so grava o estado
// quando muda, e a sessao sem escalada nao ganha o campo.

/**
 * Fim do subagente `tipo` (`id` = agent_id) com a `mensagem` dele: devolve a escalada nova, ou o proprio `s.escalada`
 * quando nada muda. So age com escada de degraus.MINIMO+ nomes e agente de dentro dela. `negacoes` (C4) = quantas
 * chamadas as travas do sworn negaram nesse despacho (`contarNegacoes`); o que nao e inteiro positivo vale zero.
 */
function aoFechar(s, tipo, id, mensagem, projeto, negacoes) {
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
  if (pedido) {
    delete e.semProva[tipo];
    registrar(e, escada, tipo, id, pedido, subida + 1, refeito);
    return e;
  }
  // C4: preso em negativas sobe ja, sem esperar o segundo retorno do B5; a conta do B5 recomeca
  if (Number.isInteger(negacoes) && negacoes >= NEGACOES_PRESO && !comProvaVerde(mensagem)) {
    delete e.semProva[tipo];
    registrar(e, escada, tipo, id, { agente: tipo, automatico: true, causa: CAUSA_NEGACOES, motivo: MOTIVO_NEGACOES },
      subida + 1, refeito);
    return e;
  }
  // B5 (P20): sem o pedido, o degrau que volta RETORNOS_SEM_PROVA vezes seguidas sem prova sobe como se pedisse; o
  // retorno com prova zera a conta dele. O contador corrompido no estado (texto, objeto) vale zero.
  const lido = e.semProva[tipo];
  const antes = Number.isInteger(lido) && lido > 0 ? lido : 0;
  if (!retornoSemProva(mensagem)) {
    // com prova e sem conta a zerar, o id nao entra em `lidos`: o unico efeito e o fim da cadeia (o `delete
    // e.subidas[id]` acima). O segundo aviso do mesmo retorno (handback e fim) ja nao acha a cadeia e devolve o
    // estado como esta: nada se conta duas vezes
    if (!antes) return tinhaCadeia ? e : atual;
    delete e.semProva[tipo];
    e.lidos = e.lidos.concat([id]).slice(-LIDOS_GUARDADOS);
    return e;
  }
  if (antes + 1 < RETORNOS_SEM_PROVA) {
    e.semProva[tipo] = antes + 1;
    e.lidos = e.lidos.concat([id]).slice(-LIDOS_GUARDADOS);
    return e;
  }
  delete e.semProva[tipo];
  // o pedido sintetico pede o proprio degrau: o registrar o leva ao seguinte ("abaixo ou igual vira o degrau seguinte")
  registrar(e, escada, tipo, id, { agente: tipo, automatico: true, motivo: MOTIVO_AUTOMATICO },
    subida + 1, refeito);
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
    deNovo ? { deNovo: true } : {}, pedido.automatico === true ? { automatico: true } : {},
    pedido.causa === CAUSA_NEGACOES ? { causa: CAUSA_NEGACOES } : {}));
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
  // B5: a subida automatica nao foi pedida; o texto diz o que houve
  const auto = p.automatico === true;
  const houve = oQueHouve(p);
  // D785 (2.2): nenhum ramo para no usuario; sem o jargao da escada (degrau, subida, topo), como no A2-58.
  if (p.para === null) {
    return [quem + ' e o ultimo da escada de agentes (agentes.escada no projeto.json), ja foi despachado de novo',
      auto ? '  e ' + houve + '.' : '  e pediu um acima outra vez: ' + motivo + '.',
      '  Sem perguntar ao usuario: feche dizendo o que segue falhando e o que o agente viu, com',
      '  a saida do teste ou do comando que falha num bloco ``` . Nao pergunte ao usuario o que fazer.'];
  }
  const para = entreAspas(ascii(p.para));
  if (p.deNovo === true) {
    return (auto ? [quem + ' e o ultimo da escada de agentes (agentes.escada no projeto.json) e',
      '  ' + houve + '.']
      : [quem + ' e o ultimo da escada de agentes (agentes.escada no projeto.json) e pediu um acima dele: ' +
        motivo + '.']).concat([
      '  Sem perguntar ao usuario, despache-o de novo com esforco maximo:',
      '  Agent({ subagent_type: ' + para + ', effort: "max", ... }),',
      '  com a tarefa, o que ele viu e o motivo no prompt.']);
  }
  // A2-57: o que vai no prompt fica em texto, fora da chamada (o molde do custo.js), e nada sai para copiar literal.
  // B5: a subida automatica nao foi pedida pelo agente; o texto diz o que houve, em linha propria (a linha do
  // fecho tem ate 120 caracteres).
  return (auto ? [quem + (p.causa === CAUSA_NEGACOES ? ' ficou preso nas travas' : ' voltou sem prova') +
      ' e o sworn sobe a tarefa para ' + para + ':', '  ' + houve + '.']
    : [quem + ' parou e pediu ' + para + ': ' + motivo + '.']).concat([
    '  Despache agora: Agent({ subagent_type: ' + para +
      ', ... }), com a tarefa, o que o agente viu e o motivo no prompt.']);
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
  // B5: so subida automatica, ninguem pediu; o titulo nao diz que pediu
  const titulo = pendentes.every(function (p) { return p.automatico === true; })
    ? 'sworn - escalada automatica e nao despachada.' : 'sworn - escalada pedida e nao despachada.';
  return [titulo, ''].concat(
    pendentes.flatMap(umPedido),
    despacha ? ['', 'Se a tarefa nao precisa mesmo do agente indicado, siga sem despachar e conte ao usuario' +
      ' o motivo.'].concat(deNovo) : []
  ).join('\n');
}

/**
 * B5 (s369, D748 T6, P21): o lembrete da escalada sem despacho para a reinjecao depois da compactacao - os pedidos
 * ainda nao cobrados, os destinos cobrados que ainda aguardam o despacho e a escada esgotada (a ordem de fechar dizendo
 * o que segue falhando). null quando nao ha. ASCII (R5).
 */
function paraReinjetar(s) {
  const e = copia(s);
  // o ultimo da escada despachado de novo vai com esforco maximo, como no umPedido (D785)
  const despache = function (para, deNovo) {
    return '- despache ' + (deNovo ? 'de novo, com effort "max", ' : '') + entreAspas(ascii(para));
  };
  const despachar = [];
  const fechar = [];
  for (const p of e.pendentes) {
    const de = entreAspas(ascii(p.de));
    if (typeof p.para === 'string') {
      despachar.push(despache(p.para, p.deNovo === true) + ': ' + (p.automatico === true
        ? entreAspas(oQueHouve(p)) + ' (o sworn subiu a tarefa de ' + de + ')'
        : entreAspas(ascii(p.motivo).slice(0, MOTIVO_MAX)) + ' (pedido por ' + de + ')'));
    } else if (p.para === null) {
      // a escada esgotada nao despacha: a ordem e o fecho honesto, como no motivoDoFecho
      fechar.push('- o agente ' + de + ' e o ultimo da escada de agentes e ja foi despachado de novo: feche dizendo' +
        ' o que segue falhando, com a saida do teste ou do comando que falha num bloco ``` .');
    }
  }
  const jaListados = new Set(e.pendentes.map(function (p) { return p.para; }));
  for (const para of Object.keys(e.aguardando)) {
    if (!jaListados.has(para)) {
      despachar.push(despache(para, e.refazer[para] === true) + ': escalada desta sessao, ainda sem despacho');
    }
  }
  if (!despachar.length && !fechar.length) return null;
  return ['# sworn - escalada em aberto', ''].concat(despachar, fechar, despachar.length ? ['',
    'Sem perguntar ao usuario: despache cada um com Agent, com a tarefa, o que ja se viu e o motivo no prompt.'] : [])
    .join('\n');
}

module.exports = { marcador, contarNegacoes, aoFechar, aoAbrir, deNovo, semPendentes, motivoDoFecho, paraReinjetar };
