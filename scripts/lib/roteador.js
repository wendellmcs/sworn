'use strict';
/*
 * G4a (pedido 262, D928): o momento certo. O roteador diz o tipo da tarefa - pela mensagem do dono (abrir-turno.js) e
 * pela edicao (portao-escopo.js) - e da, uma vez por sessao e por tipo, a linha com a peca do sworn que serve a ele.
 * Cada linha dada e uma ordem do ordens.js (dada / cumprida pela skill da rota), e a auditoria mostra a contagem.
 * G4b: a skill do sworn que ja entrou na sessao cala a rota dela (jaEntrou); a skill local com "padrao" no nome cumpre
 * so a ordem do manual, e a rota de tela segue entrando junto.
 * Nada aqui lanca: entrada torta devolve lista vazia, e o gancho segue como antes.
 */
const ordens = require('./ordens.js');
const escopo = require('./escopo.js');
const design = require('./design.js');
const marcha = require('./marcha.js');
const glob = require('./glob.js');
const { ehObjeto } = require('./texto.js');

const TIPOS = ['tela', 'plano', 'etapa', 'diagnosticar', 'aaa'];
const TETO_DO_PEDIDO = 20000;
const TETO_DO_ALVO = 200;

// "por que" + quem (o Claude, a sessao, o sworn) + o que deu errado, na mesma frase. "por que o teste falhou?" nao
// entra: sem quem, e pergunta sobre o codigo, nao sobre a sessao. "porque" e "pq" tambem sao "because": so contam
// na frase que termina em "?" ("o teste falhou porque o hook travou" nao e pergunta).
const POR_QUE = /\b(?:por\s+que|why)\b/;
const POR_QUE_SO_NA_PERGUNTA = /\b(?:porque|pq)\b/;
const SUJEITO = new RegExp('\\b(?:voce|vc|claude|modelo|agente|ia|sessao|chat|conversa|sworn|plugin|portao|gancho|' +
  'trava|you|model|agent|session|conversation|hook|gate)\\b');
const FALHA = new RegExp('\\b(?:deu errado|falh\\w*|demor\\w*|travou|travaram|travando|quebr\\w*|repet\\w*|ignor\\w*|' +
  'errou|esquec\\w*|dispar\\w*|nao (?:seguiu|fez|leu|rodou|funcion\\w*|obedec\\w*)|fail\\w*|went wrong|go wrong|' +
  'broke|break\\w*|slow|took so long|loop\\w*|stuck|forgot|kept firing)\\b');
const O_QUE_HOUVE = /\bo que (?:aconteceu|houve|deu errado)\b.*\b(?:sessao|chat|conversa)\b|\bwhat (?:happened|went wrong)\b.*\b(?:session|chat|conversation)\b/;
const SIGA_O_PLANO = [
  /\b(?:siga|sigam|seguir|segue|execute|executar|executa|implemente|implementar|implementa|cumpra|cumprir|rode|rodar)\s+(?:(?:o|este|esse|nosso|meu)\s+)?plano\b/,
  /\b(?:follow|execute|implement|carry out|run)\s+(?:(?:the|this|my|our)\s+)?plan\b/,
  // o arquivo do plano conta com um verbo de ler ou seguir na mesma frase ("crie um plano.md", "nao mexa no plan.md": nao)
  /\b(?:siga|seguir|segue|execute|executar|implemente|implementar|cumpra|rode|leia|ler|abra|use|follow|implement|run|read|open)\b[^.?!\n]*\bplano?\.md\b/
];

// Tela: a marcacao que o projeto desenha, e o estilo (design.ehArquivoDeEstilo, com os caminhosDeEstilo do projeto).
const MARCACAO = /\.(?:html?|jsx|tsx|vue|svelte|astro)$/i;
// Plano: um .md numa pasta plans/planos, ou com plan/plano no nome inteiro ou entre separadores (PLAN.md,
// plano-migracao.md, feature-plan.md; planning.md e explanation.md, nao).
const PLANO_NA_PASTA = /(?:^|\/)(?:plans?|planos?)\/(?:[^/]+\/)*[^/]+\.md$/i;
const PLANO_NO_NOME = /(?:^|[/_.-])(?:plan|plano)(?:[-_.][^/]*)?\.md$/i;
// Etapa: a caixa marcada (- [x], 1. [X]) e a linha de tabela com [FEITO], a forma que o painel do plano le.
const CAIXA_MARCADA = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[[xX]\]/gm;
const FEITO = /\[FEITO\]/g;

function semAcento(texto) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Os tipos que a mensagem do dono pede: diagnosticar, depois plano. Nao texto = []. */
function doPedido(prompt) {
  if (typeof prompt !== 'string') return [];
  const t = semAcento(prompt.slice(0, TETO_DO_PEDIDO));
  const tipos = [];
  // cada frase com a pontuacao do fim, para saber se ela e pergunta
  const frases = t.match(/[^.?!\n]+[.?!\n]*/g) || [];
  const diagnostica = frases.some(function (f) {
    const porQue = POR_QUE.test(f) || (POR_QUE_SO_NA_PERGUNTA.test(f) && f.indexOf('?') !== -1);
    return (porQue && SUJEITO.test(f) && FALHA.test(f)) || O_QUE_HOUVE.test(f);
  });
  if (diagnostica) tipos.push('diagnosticar');
  if (SIGA_O_PLANO.some(function (re) { return re.test(t); })) tipos.push('plano');
  return tipos;
}

function contar(re, texto) {
  if (typeof texto !== 'string') return 0;
  const achados = texto.match(re);
  return achados ? achados.length : 0;
}

function marcadas(texto) {
  return contar(CAIXA_MARCADA, texto) + contar(FEITO, texto);
}

// A edicao marca passo feito: o texto novo tem mais marcas que o velho (Edit, ou cada troca do MultiEdit).
function marcaPasso(entrada) {
  const trocas = Array.isArray(entrada.edits) ? entrada.edits.filter(ehObjeto) : [entrada];
  let antes = 0;
  let depois = 0;
  for (const troca of trocas) {
    antes += marcadas(troca.old_string);
    depois += marcadas(troca.new_string);
  }
  return depois > antes;
}

/** Os tipos que a edicao de `alvo` (relativo ao projeto) traz, na ordem: tela, plano ou etapa, aaa. */
function daEdicao(alvo, entrada, projeto) {
  if (typeof alvo !== 'string' || !alvo) return [];
  const caminho = glob.normalizar(alvo);
  const ent = ehObjeto(entrada) ? entrada : {};
  const proj = ehObjeto(projeto) ? projeto : null;
  const tipos = [];
  try {
    if (MARCACAO.test(caminho) || design.ehArquivoDeEstilo(caminho, proj)) tipos.push('tela');
  } catch (e) { /* caminhosDeEstilo torto: sem a rota de tela */ }
  if (PLANO_NA_PASTA.test(caminho) || PLANO_NO_NOME.test(caminho)) {
    if (typeof ent.content === 'string') tipos.push('plano');
    else if (marcaPasso(ent)) tipos.push('etapa');
  }
  try {
    if (proj && marcha.resolverMarcha(caminho, proj) === 'aaa') tipos.push('aaa');
  } catch (e) { /* marchas torto: sem a rota AAA */ }
  return tipos;
}

function rotasValidas(s) {
  const lista = Array.isArray(s.rotasDadas) ? s.rotasDadas : [];
  const saida = [];
  for (const t of lista) if (TIPOS.indexOf(t) !== -1 && saida.indexOf(t) === -1) saida.push(t);
  return saida;
}

function alvoEmTexto(contexto) {
  const alvo = ehObjeto(contexto) && typeof contexto.alvo === 'string' ? contexto.alvo : '';
  if (!alvo) return '';
  // a aspa do caminho vira apostrofo: so a do texto fecha o nome
  const a = escopo.ascii(alvo).replace(/"/g, "'");
  return '"' + (a.length > TETO_DO_ALVO ? a.slice(0, TETO_DO_ALVO) + '...' : a) + '"';
}

function textoDa(tipo, contexto) {
  const alvo = alvoEmTexto(contexto);
  const temDesign = ehObjeto(contexto) && contexto.temDesign === true;
  const carregue = ordens.comoCarregar;
  if (tipo === 'tela') {
    return 'sworn: ' + (alvo || 'este arquivo') + ' e tela. Agora, ' + carregue('playbook') + ' e siga a ' +
      'references/02-rubrica-aaa.md dele: os estados obrigatorios, o foco visivel, o contraste legivel, o movimento ' +
      'curto que respeita prefers-reduced-motion e o alvo de pelo menos 24 x 24 px.' +
      (temDesign ? ' Use so os valores de .claude/sworn/design.json; valor que falta nele e desvio: pergunte ao dono antes de usa-lo.' : '') +
      ' Com a tela pronta, rode /sworn:review com --tela-depois <endereco da pagina>. A skill do projeto com "padrao" ' +
      'no nome, se houver, vale junto: as duas se somam.';
  }
  if (tipo === 'plano') {
    return 'sworn: ' + (alvo ? alvo + ' e um plano.' : 'o pedido e seguir um plano.') + ' Antes da 1a edicao de codigo, ' +
      carregue('review-plan') + ': um script confere cada caminho, simbolo e comando que o plano cita, e se cada passo ' +
      'aberto traz o comando que o prova.';
  }
  if (tipo === 'etapa') {
    return 'sworn: esta edicao marca passo feito ' + (alvo ? 'em ' + alvo : 'no plano') + '. Antes de fechar a etapa, ' +
      carregue('drift') + ': um script cruza os arquivos mudados com os caminhos e as caixas do plano.';
  }
  if (tipo === 'diagnosticar') {
    return 'sworn: o dono pergunta por que a sessao deu errado. Agora, ' + carregue('diagnose') +
      ': ele le as transcricoes no disco e relata so o que um script confirma.';
  }
  return 'sworn: ' + (alvo || 'a tarefa') + ' esta na marcha AAA do projeto. No inicio de cada turno desta tarefa, ' +
    carregue('effort-high') + '.';
}

/**
 * Da as rotas de `tipos` que a sessao ainda nao recebeu. Recebe o estado de dentro de um estado.alterar; o script
 * grava `s.rotasDadas = r.dadas` e `s.ordensPendentes = r.pendentes` (o leitor de campos do portao-fecho.test ve quem
 * grava). Cada rota nova conta "dada" no ordens.js. Estado que nao e objeto = tudo vazio.
 */
function dar(s, tipos, contexto) {
  if (!ehObjeto(s)) return { dadas: [], pendentes: [], textos: [] };
  const dadas = rotasValidas(s);
  let pendentes = Array.isArray(s.ordensPendentes) ? s.ordensPendentes : [];
  const textos = [];
  for (const tipo of Array.isArray(tipos) ? tipos : []) {
    if (TIPOS.indexOf(tipo) === -1 || dadas.indexOf(tipo) !== -1) continue;
    // o effort-high so existe no Claude Code (instalar.js, SO_NO_CLAUDE): pela ponte a rota AAA nao tem o que pedir
    if (tipo === 'aaa' && ordens.naPonte()) continue;
    dadas.push(tipo);
    pendentes = ordens.marcarDada(s, tipo);
    textos.push(textoDa(tipo, contexto));
  }
  return { dadas: dadas, pendentes: pendentes, textos: textos };
}

/** G4b: as rotas que ja valem na sessao, mais as que a skill `nome` cumpre (a do sworn; a local "padrao", nenhuma). */
function jaEntrou(s, nome) {
  if (!ehObjeto(s)) return [];
  const dadas = rotasValidas(s);
  if (typeof nome !== 'string') return dadas;
  for (const tipo of TIPOS) if (dadas.indexOf(tipo) === -1 && ordens.skillCumpre(tipo, nome)) dadas.push(tipo);
  return dadas;
}

module.exports = { TIPOS, doPedido, daEdicao, dar, jaEntrou };
