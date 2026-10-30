'use strict';

// Bloco M / M1 (D435): o texto do medidor da sessao. Puro: nao le disco nem rede (D148). A entrada de linhaDaSessao,
// montada pelo scripts/sessao.js:
//   uso         - $.session.usage() sem breakdown: contexto, janelas (rateLimits) e cost.usd da sessao;
//   amostras    - [{ tokens, cincoH }] por resposta, para a previsao em respostas;
//   medidas     - os gatilhos de saude.medir (troca de chat); avisouSaude - o aviso de troca ja foi dado;
//   historico   - por sessao, o % de cada janela no 1o e no ultimo momento (gasto.guardarSessao), para a previsao em
//                 trocas de chat; sessao - o id da sessao atual, que fica fora dessa media;
//   gasto       - o gasto do mes (gasto.gastoDoMes): { usd, real, estimado, pendentes, semPreco, ilegiveis, desde }.
// Devolve a linha de status (curta), a resposta do comando (longa) e se a troca de chat ja cruzou. Texto de gancho
// fica ASCII (R5); a barra e a resposta do comando sao excecao, com acento (D532: a sonda da Tarefa 1 do plano 082 viu
// o acento inteiro nas duas). Campo que o motor nao deu e omitido: numero inventado e pior que numero nenhum.

const NOME_DA_JANELA = { five_hour: '5h', seven_day: 'semana', spend_limit: 'gasto' };
// Plano 082 (mock D532, S4): na resposta do comando, a janela por extenso - [nome, artigo, "usada"/"usado"].
const JANELA_POR_EXTENSO = {
  five_hour: ['janela de 5 horas', 'a', 'usada'],
  seven_day: ['janela da semana', 'a', 'usada'],
  spend_limit: ['limite de gasto', 'o', 'usado']
};
const MINIMO_DE_SUBIDAS = 2;   // previsao so com 2+ turnos que subiram
const JANELA_DA_MEDIA = 5;     // media das ultimas 5 subidas
// A previsao em trocas de chat (mediaPorSessao): o gasto medio de cada janela por sessao anterior.
const SESSOES_DA_MEDIA = 5;    // media das ultimas 5 sessoes medidas
const MINIMO_DE_SESSOES = 2;   // com menos de 2 sessoes medidas, nao ha media e a previsao se omite
// Plano 082 (mock S4): o sinal ganha "perto do limite" a partir de 90% do limiar (o mock mostra 240.283 de 250.000).
const PERTO_DO_LIMITE = 0.9;
// Plano 082 (mock S4; p6-23): o sinal pelo nome que a pessoa entende ("turnos" vira "respostas"); o curto vai na
// linha dos desligados pelo modo continuo. Chave de saude.medirTodos; chave desconhecida usa o nome que veio.
// A6-68 (D735): sem "portao" nem "dono" - o bloqueio e a acao que o sworn negou (saude.js:225), e o dono e quem le.
const SINAL = {
  turnosComTrabalho: ['respostas com trabalho real', 'respostas'],
  revisoesFechadas: ['revisões independentes fechadas', 'revisões'],
  bloqueios: ['ações que o sworn negou', 'bloqueios'],
  arquivosTocados: ['arquivos tocados', 'arquivos'],
  decisoesDoDono: ['decisões que você respondeu', 'decisões'],
  commits: ['commits nesta sessão', 'commits'],
  tokensDeContexto: ['tamanho do contexto', 'contexto']
};
// Pedido 71 (D544, barra A): o que falta para o aviso de troca, na unidade do sinal - [singular, plural]. O contexto
// conta em tokens (quantoFalta); chave desconhecida usa o nome que veio.
const FALTA = {
  turnosComTrabalho: ['resposta com trabalho real', 'respostas com trabalho real'],
  revisoesFechadas: ['revisão independente', 'revisões independentes'],
  bloqueios: ['ação negada pelo sworn', 'ações negadas pelo sworn'],
  arquivosTocados: ['arquivo tocado', 'arquivos tocados'],
  decisoesDoDono: ['decisão sua', 'decisões suas'],
  commits: ['commit', 'commits']
};

// Plano 083 (p2-11): o par de SINAL/FALTA so pela chave propria - "constructor" ou "toString" lia o prototipo.
function daChave(mapa, chave) { return Object.prototype.hasOwnProperty.call(mapa, chave) ? mapa[chave] : null; }

function num(v) { return typeof v === 'number' && isFinite(v); }
function dois(n) { return String(n).padStart(2, '0'); }
// D442/11 (M-22): o motor manda percentual com casas (37.29999); a tela mostra inteiro.
function pct(n) { return Math.round(n) + '%'; }
// D442/11 (M-15, M-18, M-19): gatilho sem nome, valor ou limiar nao entra na conta nem na lista.
function gatilhoInteiro(g) { return !!g && typeof g.nome === 'string' && g.nome !== '' && num(g.valor) && num(g.limiar); }

function hora(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return dois(d.getHours()) + ':' + dois(d.getMinutes());
}

function dia(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return dois(d.getDate()) + '/' + dois(d.getMonth() + 1);
}

function janelas(uso) {
  const lista = uso && Array.isArray(uso.rateLimits) ? uso.rateLimits : [];
  // D442/11 (M-16, M-21): janela sem `kind` virava o nome "undefined"; sem nome, fica de fora.
  return lista.filter(function (j) { return j && num(j.percentUsed) && typeof j.kind === 'string' && j.kind !== ''; }).map(function (j) {
    const nome = NOME_DA_JANELA[j.kind] || String(j.kind);
    // a de 5h renova no mesmo dia (hora basta); as outras, pelo dia e hora. Plano 083 (p2-23): a hora e o dia saem
    // uma vez; a barra diz "13:50" / "22/10 04:00" e a resposta do comando "às 13:50" / "22/10 às 04:00" (mock S4).
    const h = j.resetsAt ? hora(j.resetsAt) : null;
    const d = h && j.kind !== 'five_hour' ? dia(j.resetsAt) : null;
    const quando = h ? (d ? d + ' ' : '') + h : null;
    const renova = h ? (d ? d + ' ' : '') + 'às ' + h : null;
    return { kind: j.kind, nome: nome, pct: j.percentUsed, quando: quando, renova: renova };
  });
}

/** Media das ultimas subidas positivas de `campo` entre amostras seguidas; null sem 2 subidas. */
function subidaMedia(amostras, campo) {
  const subidas = [];
  for (let i = 1; i < amostras.length; i++) {
    const a = amostras[i - 1] && amostras[i - 1][campo];
    const b = amostras[i] && amostras[i][campo];
    if (num(a) && num(b) && b > a) subidas.push(b - a);
  }
  if (subidas.length < MINIMO_DE_SUBIDAS) return null;
  const ultimas = subidas.slice(-JANELA_DA_MEDIA);
  return ultimas.reduce(function (t, v) { return t + v; }, 0) / ultimas.length;
}

// Quantas vezes o gasto de uma vez (uma resposta, ou um chat em trocasAte) cabe no que falta: nunca negativo
// (contexto ou janela ja passados do fim = ~0). Plano 083 (p2-21): era `turnosAte`, mas tambem conta trocas de chat.
// D442/11 (M-20): subida minuscula (ruido de float) dava "~Infinity turnos"; sem conta finita, null (omite).
function vezesAte(falta, porVez) {
  const n = Math.max(0, Math.floor(falta / porVez));
  return isFinite(n) ? n : null;
}

/**
 * As respostas que faltam, pela subida media por resposta: `contexto` ate o fim do contexto e `five_hour` ate o fim
 * da janela de 5h (a chave e o `kind` da janela, que linhasDaPrevisao procura). O objeto vem sempre; cada campo e
 * null sem conta (plano 083, p2-22: o comentario dizia "null sem conta" do objeto inteiro).
 */
function previsao(uso, amostras) {
  const lista = Array.isArray(amostras) ? amostras : [];
  const ctx = uso && uso.context;
  const porResposta = subidaMedia(lista, 'tokens');
  const nCtx = porResposta && ctx && num(ctx.tokens) && num(ctx.window) ? vezesAte(ctx.window - ctx.tokens, porResposta) : null;
  const pct5h = subidaMedia(lista, 'cincoH');
  const j5 = janelas(uso).find(function (j) { return j.kind === 'five_hour'; });
  const n5 = pct5h && j5 ? vezesAte(100 - j5.pct, pct5h) : null;
  return { contexto: nCtx, five_hour: n5 };
}

function texto(v) { return typeof v === 'string' && v !== ''; }

/**
 * Quanto cada sessao anterior gastou de cada janela (o historico de gasto.guardarSessao). Entra a sessao que nao e a
 * atual, teve 2+ medidas e nao cruzou a renovacao; as 5 mais recentes. As janelas sao as que o historico tem.
 * Devolve { kind: { media, k } } so com 2+ sessoes; sem saber qual e a atual, nada (ela entraria na propria media).
 */
function mediaPorSessao(historico, atual) {
  const h = historico && typeof historico === 'object' ? historico : {};
  const r = {};
  if (!texto(atual)) return r;
  const anteriores = Object.keys(h).filter(function (id) { return id !== atual; });
  const kinds = new Set();
  for (const id of anteriores) {
    const s = h[id];
    if (s && s.janelas && typeof s.janelas === 'object') Object.keys(s.janelas).forEach(function (k) { kinds.add(k); });
  }
  for (const kind of kinds) {
    const deltas = anteriores.map(function (id) {
      const s = h[id];
      const j = s && s.janelas && typeof s.janelas === 'object' ? s.janelas[kind] : null;
      if (!j || !num(s.t) || !(s.medidas >= 2) || !num(j.ini) || !num(j.fim) || j.fim < j.ini) return null;
      // renovacao desconhecida numa ponta: nao da para saber se a sessao a cruzou, entao fica fora
      if (!texto(j.resetIni) || j.resetIni !== j.resetFim) return null;
      return { t: s.t, d: j.fim - j.ini };
    }).filter(Boolean).sort(function (a, b) { return b.t - a.t; }).slice(0, SESSOES_DA_MEDIA);
    if (deltas.length < MINIMO_DE_SESSOES) continue;
    // media zero passa: vezesAte da null (nao divide por zero) e a previsao se omite
    r[kind] = { media: deltas.reduce(function (t, x) { return t + x.d; }, 0) / deltas.length, k: deltas.length };
  }
  return r;
}

// O total do mes e a soma das duas fontes; a diferenca tolerada e o meio centavo (a tela mostra centavos).
const TOLERANCIA_DA_SOMA = 0.005;

/** O gasto do mes (gasto.gastoDoMes): partes nao negativas e total igual a real + estimado; torto = sem gasto. */
function gastoValido(g) {
  if (!g || typeof g !== 'object' || !num(g.usd) || !num(g.real) || !num(g.estimado)) return null;
  if (g.real < 0 || g.estimado < 0) return null;
  return Math.abs(g.usd - (g.real + g.estimado)) <= TOLERANCIA_DA_SOMA ? g : null;
}

// Plano 082 (mock D532): dinheiro da barra como se le no Brasil - ponto no milhar, virgula nos centavos.
function milhar(inteiro) { return String(inteiro).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
// Plano 083 (p2-12): negativo que arredonda a zero sai "0,00", nunca "-0,00".
function centavos(v) { const p = (Math.abs(v) < 0.005 ? 0 : v).toFixed(2).split('.'); return milhar(p[0]) + ',' + p[1]; }
// O mes arredonda, mas abaixo de US$ 1 o arredondado diria "US$ 0"; ai vai com centavos.
function mes(v) { return v < 1 ? centavos(v) : milhar(Math.round(v)); }
// Plano 082 (mock S4): contagem com ponto no milhar ("240.283"); numero quebrado sai como veio.
function inteiro(v) { return Number.isInteger(v) ? milhar(v) : String(v); }
function vezes(n, um, varios) { return '~' + n + ' ' + (n === 1 ? um : varios); }

function extenso(j) { return JANELA_POR_EXTENSO[j.kind] || ['janela ' + j.nome, 'a', 'usada']; }

/** O gasto do mes ja conferido, com `desde` e `pendentes` limpos (torto = ausente: o total vale sem eles). */
function gastoDoMes(g) {
  const gasto = gastoValido(g);
  if (!gasto) return null;
  return {
    usd: gasto.usd, real: gasto.real, estimado: gasto.estimado,
    desde: typeof gasto.desde === 'string' && gasto.desde.trim() !== '' ? gasto.desde.trim() : null,
    pendentes: contagem(gasto.pendentes),
    // A6-02: o que ficou fora da conta segue ate a tela (o gasto.js os devolve; antes paravam aqui, calados)
    semPreco: contagem(gasto.semPreco), ilegiveis: contagem(gasto.ilegiveis)
  };
}
function contagem(v) { return num(v) && v > 0 ? Math.ceil(v) : 0; }

/**
 * A previsao em trocas de chat de uma janela: quantas sessoes como as anteriores cabem no que falta dela. A media vem
 * de mediaPorSessao; sem media (ou com media zero), null.
 */
function trocasAte(j, porSessao) {
  const m = porSessao[j.kind];
  const n = m ? vezesAte(100 - j.pct, m.media) : null;
  if (n === null) return null;
  // media abaixo de 1% com uma casa: "0%" diria que a sessao nao gasta nada
  const media = m.media >= 1 ? pct(m.media) : m.media.toFixed(1).replace('.', ',') + '%';
  return vezes(n, 'troca de chat', 'trocas de chat') + ' (média de ' + media + ' por chat, nos últimos ' + m.k +
    ' que deu para medir)';
}

// Os sinais que valem (sem os calados pelo modo continuo, D468), do mais perto do limite ao mais longe; no empate,
// a ordem do saude.medir. A barra e o bloco "Troca de chat" da resposta do comando usam esta ordem.
function valemPorPerto(medidas) {
  const perto = function (g) { return g.limiar > 0 ? g.valor / g.limiar : 0; };
  return medidas.filter(function (g) { return g.calado !== true; })
    .map(function (g, i) { return { g: g, i: i }; })
    .sort(function (a, b) { return perto(b.g) - perto(a.g) || a.i - b.i; })
    .map(function (x) { return x.g; });
}

// Pedido 71 (D544): "180 mil tokens", "12 mil tokens", "500 tokens"; os outros sinais pela unidade de FALTA.
function quantoFalta(g) {
  const n = g.limiar - g.valor;
  if (g.chave === 'tokensDeContexto') return n >= 1000 ? milhar(Math.floor(n / 1000)) + ' mil tokens' : inteiro(n) + ' tokens';
  const u = daChave(FALTA, g.chave) || [g.nome, g.nome];
  return inteiro(n) + ' ' + u[n === 1 ? 0 : 1];
}

// A barra (mock D532, S3): contexto · 5h ate HH:MM · semana · mes · sessao · troca. Sem "sworn" na frente (o VS Code
// ja escreve "sworn plugin") e sem o plano (esta na faixa logo acima). A previsao saiu da barra: sem espaco para
// dizer a unidade, fica so na resposta do comando.
// Pedido 71 (D544, barra A; p2-27): o fim diz quanto falta para o aviso pelo sinal mais perto ("troca 0 de 2" nao
// mudava o chat inteiro); disparou -> "troque de chat"; sem sinal medido, nada (numero inventado e pior que nenhum).
// Plano 083 (p2-24): um objeto com nome no lugar dos 6 posicionais, que se trocavam sem erro.
function barra(b) {
  const uso = b.uso, gasto = b.gasto, js = b.js, medidas = b.medidas;
  const curta = [];
  const ctx = uso && uso.context;
  if (ctx && num(ctx.percent)) curta.push('contexto ' + pct(ctx.percent));
  for (const j of js) curta.push(j.nome + ' ' + pct(j.pct) + (j.quando && j.kind === 'five_hour' ? ' até ' + j.quando : ''));
  // o mes ao lado do semanal, a sessao depois; "+ (somando)" enquanto a leitura das conversas salvas segue (o numero
  // ainda cresce; o quanto falta, a resposta do comando diz)
  if (gasto) curta.push('mês US$ ' + mes(gasto.usd) + (gasto.pendentes > 0 ? '+ (somando)' : ''));
  if (uso && uso.cost && num(uso.cost.usd)) curta.push('sessão US$ ' + centavos(uso.cost.usd));
  if (b.avisou) curta.push('troca já avisada → /sworn:handoff');
  else if (b.cruzados.length) curta.push('troque de chat → /sworn:handoff');
  else {
    const g = valemPorPerto(medidas).filter(function (x) { return x.limiar > x.valor; })[0];
    if (g) curta.push('troca de chat em ' + quantoFalta(g));
  }
  return curta.join(' · ');
}

function linhasDosLimites(uso, js) {
  const limites = [];
  const ctx = uso && uso.context;
  if (ctx && num(ctx.percent)) {
    // token negativo (ou janela zero) desenhava "(-5 de 1000000 tokens)"; sem conta valida, so o %
    const conta = num(ctx.tokens) && num(ctx.window) && ctx.tokens >= 0 && ctx.window > 0;
    limites.push('- contexto: ' + pct(ctx.percent) + (conta ? ' (' + inteiro(ctx.tokens) + ' de ' + inteiro(ctx.window) + ' tokens)' : ''));
  } else {
    limites.push('- contexto: ainda sem leitura — aparece depois da 1ª resposta');
  }
  for (const j of js) {
    const x = extenso(j);
    limites.push('- ' + x[0] + ': ' + pct(j.pct) + ' ' + x[2] + (j.renova ? ', renova ' + j.renova : ''));
  }
  if (!js.length) limites.push('- limites de 5 horas e da semana: ainda sem leitura — aparecem depois da 1ª resposta, só na assinatura');
  return limites;
}

// O gasto sem jargao ("transcricao", "estimado", "valor equivalente de API"), o mes com centavos, e o plural certo
// dizendo que nao ha nada a fazer enquanto soma.
function linhasDoGasto(uso, gasto) {
  const gastos = [];
  if (uso && uso.cost && num(uso.cost.usd)) gastos.push('- esta sessão: US$ ' + centavos(uso.cost.usd));
  if (gasto) {
    gastos.push('- mês' + (gasto.desde ? ' (desde ' + gasto.desde + ')' : '') + ': US$ ' + centavos(gasto.usd) + ' — US$ ' +
      centavos(gasto.real) + ' medidos nas sessões com o sworn + US$ ' + centavos(gasto.estimado) +
      ' calculados pelas conversas salvas');
    if (gasto.pendentes > 0) {
      gastos.push('- ainda somando: ' + (gasto.pendentes === 1 ? 'falta 1 conversa salva' : 'faltam ' + gasto.pendentes + ' conversas salvas') +
        ' para ler; o total se completa sozinho nas próximas respostas, sem você fazer nada');
    }
    // A6-67 (D735): de quem e a tabela (calibracao.js PRECOS, do plugin) e o passo: o preco novo chega com o sworn.
    if (gasto.semPreco > 0) {
      gastos.push('- fora da conta: ' + (gasto.semPreco === 1 ? '1 mensagem' : gasto.semPreco + ' mensagens') +
        ' de um modelo que a tabela de preços do sworn ainda não tem; o mês sai menor do que é até você atualizar o ' +
        'sworn para uma versão com esse preço');
    }
    if (gasto.ilegiveis > 0) {
      gastos.push('- fora da conta: ' + (gasto.ilegiveis === 1 ? '1 conversa salva que não se leu' :
        gasto.ilegiveis + ' conversas salvas que não se leram') + '; a próxima medida tenta de novo');
    }
    gastos.push('- na assinatura é o valor que a API cobraria, não uma cobrança');
  }
  return gastos;
}

// A previsao: em respostas (subida media por turno) e em trocas de chat (trocasAte), na mesma linha da janela. Sem
// nenhuma, a tela diz o que falta: 2 subidas para a de respostas, 2 sessoes anteriores para a de trocas de chat.
function linhasDaPrevisao(prev, js, porSessao) {
  const previsoes = [];
  if (prev.contexto !== null) previsoes.push('- o contexto enche em ' + vezes(prev.contexto, 'resposta', 'respostas'));
  for (const j of js) {
    const respostas = j.kind === 'five_hour' ? prev.five_hour : null;
    const partes = [];
    if (respostas !== null) partes.push(vezes(respostas, 'resposta', 'respostas'));
    const trocas = trocasAte(j, porSessao);
    if (trocas !== null) partes.push(trocas);
    if (!partes.length) continue;
    const x = extenso(j);
    previsoes.push('- ' + x[1] + ' ' + x[0] + ' acaba em ' + partes.join(', ou '));
  }
  if (!previsoes.length) {
    previsoes.push('- aparece depois de ' + MINIMO_DE_SUBIDAS + ' respostas com consumo (em trocas de chat, depois de ' +
      MINIMO_DE_SESSOES + ' chats anteriores medidos)');
  }
  return previsoes;
}

// Os sinais que valem primeiro, do mais perto do limite ao mais longe; os desligados pelo modo continuo (D468) numa
// linha so, no fim, sem "disparou".
function linhasDosSinais(medidas, avisou) {
  const nomeDe = function (g) { return daChave(SINAL, g.chave) || [g.nome, g.nome]; };
  const valem = valemPorPerto(medidas);
  const calados = medidas.filter(function (g) { return g.calado === true; });
  const sinais = valem.map(function (g) {
    const tokens = g.chave === 'tokensDeContexto' ? ' tokens' : '';
    return '- ' + nomeDe(g)[0] + ': ' + inteiro(g.valor) + ' de ' + inteiro(g.limiar) + tokens +
      (g.cruzou ? ' ← disparou' : g.limiar > 0 && g.valor >= g.limiar * PERTO_DO_LIMITE ? ' ← perto do limite' : '');
  });
  if (calados.length) {
    sinais.push('- desligados pelo modo contínuo: ' + calados.map(function (g) {
      return nomeDe(g)[1] + ' ' + inteiro(g.valor) + '/' + inteiro(g.limiar);
    }).join(' · '));
  }
  if (avisou) sinais.push('- o aviso de troca já foi dado nesta sessão; os contadores recomeçam depois dele');
  if (!sinais.length) sinais.push('- nenhum sinal medido ainda');
  return sinais;
}

function linhaDaSessao(entrada) {
  const e = entrada || {};
  const uso = e.uso && typeof e.uso === 'object' ? e.uso : null;
  const medidas = (Array.isArray(e.medidas) ? e.medidas : []).filter(gatilhoInteiro);
  const cruzados = medidas.filter(function (g) { return g.cruzou; });
  const avisou = e.avisouSaude === true;
  const cruzou = avisou || cruzados.length > 0;
  // D468/D490 (M2): o gatilho calado pelo modo continuo nao pode disparar, entao nao entra no "de N".
  const podem = medidas.filter(function (g) { return g.calado !== true; }).length;
  const gasto = gastoDoMes(e.gasto);
  const js = janelas(uso);

  // A resposta do comando em 5 blocos com titulo (mock D532, S4). O painel do VS Code a le como Markdown (D442/2):
  // titulo em negrito, itens em lista e linha em branco entre os blocos - sem ela, o titulo emendava no ultimo item
  // de cima. Bloco sem nada a dizer (o Gasto sem leitura) fica de fora.
  const blocos = [];
  const bloco = function (titulo, linhas) { if (linhas.length) blocos.push(['**' + titulo + '**'].concat(linhas).join('\n')); };
  bloco('Contexto e limites', linhasDosLimites(uso, js));
  bloco('Gasto', linhasDoGasto(uso, gasto));
  bloco('Previsão', linhasDaPrevisao(previsao(uso, e.amostras), js, mediaPorSessao(e.historico, e.sessao)));
  // Plano 083 (p2-26): o verbo concorda - "1 de 7 sinais disparou", "0 de 2 sinais dispararam".
  bloco('Troca de chat — ' + cruzados.length + ' de ' + podem + ' sinais ' + (cruzados.length === 1 ? 'disparou' : 'dispararam') +
    ' (basta 1)', linhasDosSinais(medidas, avisou));
  bloco('O que fazer', [cruzou ? 'Rode /sworn:handoff e cole o prompt pronto num chat novo.' : 'Nada por ora.']);

  const curta = barra({ uso: uso, gasto: gasto, js: js, cruzados: cruzados, medidas: medidas, avisou: avisou });
  return { curta: curta, longa: blocos.join('\n\n'), cruzou: cruzou };
}

module.exports = { linhaDaSessao, milhar, centavos };
