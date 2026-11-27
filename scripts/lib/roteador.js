'use strict';
/*
 * G4a (pedido 262, D928): o momento certo. O roteador diz o tipo da tarefa - pela mensagem do dono (abrir-turno.js) e
 * pela edicao (portao-escopo.js) - e da, uma vez por sessao e por tipo, a linha com a peca do sworn que serve a ele.
 * Cada linha dada e uma ordem do ordens.js (dada / cumprida pela skill da rota), e a auditoria mostra a contagem.
 * G4b: a skill do sworn que ja entrou na sessao cala a rota dela (jaEntrou); a skill local com "padrao" no nome cumpre
 * so a ordem do manual, e a rota de tela segue entrando junto. G4c: a rota de tela carrega a skill design (o roteiro de
 * construir a tela); o playbook e o manual e tambem nao a cala.
 * G4h (pedido 263): a rota de defeito. A frase que fala de erro, bug ou quebra, ou a pilha de erro colada, traz a ordem
 * de reproduzir o defeito com um teste vermelho antes do conserto, e a depuracao por causa raiz, reescrita em texto
 * proprio do obra/superpowers (MIT). Nenhuma skill a cumpre: so o teste visto vermelho (ordens.vermelhoVisto).
 * G4i: a rota de teste. A 1a edicao de um arquivo com nome de teste (vermelho-antes.ehNomeDeTeste) ou o pedido de
 * escrever testes traz a ordem do teste novo vermelho primeiro e da mutacao antes do pronto, e aponta a secao do
 * playbook que as ensina. O teste de componente (.test.tsx) e teste, nao tela. Como a de defeito, so o vermelho a cumpre.
 * Nada aqui lanca: entrada torta devolve lista vazia, e o gancho segue como antes.
 */
const ordens = require('./ordens.js');
const escopo = require('./escopo.js');
const design = require('./design.js');
const marcha = require('./marcha.js');
const glob = require('./glob.js');
const { ehObjeto } = require('./texto.js');
const { ehNomeDeTeste } = require('./vermelho-antes.js');

const TIPOS = ['tela', 'plano', 'etapa', 'diagnosticar', 'aaa', 'bug', 'teste'];
const TETO_DO_PEDIDO = 20000;
const TETO_DO_ALVO = 200;

// "por que" + quem (o Claude, a sessao, o sworn) + o que deu errado, na mesma frase. "por que o teste falhou?" nao
// entra: sem quem, e pergunta sobre o codigo, nao sobre a sessao. "porque" e "pq" tambem sao "because": so contam
// na frase que termina em "?" ("o teste falhou porque o hook travou" nao e pergunta). O "n" sozinho e o "nao" abreviado
// ("pq vc n seguiu?"), so antes dos mesmos verbos.
const POR_QUE = /\b(?:por\s+que|why)\b/;
const POR_QUE_SO_NA_PERGUNTA = /\b(?:porque|pq)\b/;
const SUJEITO = new RegExp('\\b(?:voce|vc|claude|modelo|agente|ia|sessao|chat|conversa|sworn|plugin|portao|gancho|' +
  'trava|you|model|agent|session|conversation|hook|gate)\\b');
const FALHA = new RegExp('\\b(?:deu errado|falh\\w*|demor\\w*|travou|travaram|travando|quebr\\w*|repet\\w*|ignor\\w*|' +
  'errou|esquec\\w*|dispar\\w*|n(?:ao)? (?:seguiu|fez|leu|rodou|funcion\\w*|obedec\\w*)|fail\\w*|went wrong|go wrong|' +
  'broke|break\\w*|slow|took so long|loop\\w*|stuck|forgot|kept firing)\\b');
const O_QUE_HOUVE = /\bo que (?:aconteceu|houve|deu errado)\b.*\b(?:sessao|chat|conversa)\b|\bwhat (?:happened|went wrong)\b.*\b(?:session|chat|conversation)\b/;
const SIGA_O_PLANO = [
  /\b(?:siga|sigam|seguir|segue|execute|executar|executa|implemente|implementar|implementa|cumpra|cumprir|rode|rodar)\s+(?:(?:o|este|esse|nosso|meu)\s+)?plano\b/,
  /\b(?:follow|execute|implement|carry out|run)\s+(?:(?:the|this|my|our)\s+)?plan\b/,
  // o arquivo do plano conta com um verbo de ler ou seguir na mesma frase ("crie um plano.md", "nao mexa no plan.md": nao)
  /\b(?:siga|seguir|segue|execute|executar|implemente|implementar|cumpra|rode|leia|ler|abra|use|follow|implement|run|read|open)\b[^.?!\n]*\bplano?\.md\b/
];
// G4h: o defeito, por frase. O "sem erro", o "nenhum erro", o "nunca deu erro" e o "erro nenhum" dizem que deu certo;
// o "no" so nega o "errors" e o "bugs" do ingles: o "no erro", o "no bug" e o "no crash" do portugues sao "em o". O
// "no crash" do ingles fica com o falso positivo de uma linha. A "quebra" sozinha fica fora
// ("quebra de linha"), e o "debug" nao e "bug" (o \b). A "mensagem de erro" e o campo "error" em prosa entram: o falso
// positivo custa uma linha, uma vez por sessao.
const DEFEITO = new RegExp(
  '(?<!\\b(?:sem|nenhum|nenhuma|zero|0|without|nao deu|nao houve|nao tem|nao teve|nao ha|n deu|nunca deu|nunca teve|' +
  'nunca houve|nao vi|nunca vi) +)' +
  '\\b(?:erros?(?! +(?:nenhum|algum)\\b)|(?<!\\bno +)(?:errors?|bugs)|bug(?:ou|ad[oa]s?)?|quebr(?:ou|aram|ad[oa]s?|ando)|' +
  'crash\\w*|broken?)\\b' +
  '|\\bn(?:ao)? (?:esta |estao )?funcion(?:a|am|ando)\\b|\\bpar(?:ou|aram) de funcionar\\b' +
  // o apostrofo reto ou o curvo (qualquer sinal que nao e letra nem espaco)
  '|\\b(?:not|isn[^\\w\\s]?t|aren[^\\w\\s]?t|doesn[^\\w\\s]?t|don[^\\w\\s]?t|does not|do not) work(?:s|ing)?\\b');
// A pilha de erro colada, no texto inteiro: a linha "at f (arquivo:linha)" do Node e do Java, o traceback e o File do
// Python, o panic e a goroutine do Go, o "TypeError: " (o nome do erro seguido de dois pontos) e o "Error: " no comeco
// da linha. O "error: " no meio da frase e prosa ("o campo error: string"). O branco do comeco da linha e [ \t], nunca
// \s: com o \s, cada linha em branco reveria todas as seguintes (o quadrado do tamanho). Na linha "at", o ponto ou a barra
// do caminho se confere a frente, num lookahead: duas repeticoes gulosas em volta dele reveriam o token longo a cada corte.
const PILHA = [
  /^[ \t]*at[ \t]+(?:[^\n]*\()?(?=[^\s()]*[./\\])[^\s()]*:\d+(?::\d+)?\)?[ \t]*$/m,
  /traceback \(most recent call last\)/,
  /^[ \t]*file "[^"]+", line \d+/m,
  /^panic: /m,
  /^goroutine \d+ \[/m,
  /\b[a-z]+(?:error|exception):\s/,
  /^(?:error|exception):\s/m
];
// G4i: o pedido de escrever testes: o verbo de escrever, criar, adicionar ou gerar, ate artigos e adjetivos, e o
// "teste" ("escreva os testes", "add unit tests"). Rodar ("rode os testes"), corrigir e o passado ("escrevi") ficam
// fora, e a negacao antes do verbo cala ("nao escreva testes", "don't add tests"), tambem com ate 3 palavras de
// ligacao no meio ("nao quero que voce escreva", "don't ever add"). O \b da frente faz a negacao so se conferir no
// comeco de palavra, nao a cada posicao (num texto so de espacos, o quadrado); o teto de 3 faz cada comeco rever so
// as 3 palavras de tras, nao o texto inteiro. A negacao logo depois do "why" ou do "por que", com o "voce" no meio ou
// nao, e sugestao ("why don't you add tests", "por que voce nao cria os testes"): nao cala.
const ESCREVER_TESTES = new RegExp(
  '\\b' +
  '(?<!(?<!\\b(?:why|por que)(?: +(?:voce|vc))? +)' +
  '\\b(?:nao|n|sem|nunca|nem|never|without|don[^\\w\\s]?t|do not|no need to)' +
  '(?: +(?:quero|queremos|que|voce|vc|precisa|precisamos|de|ever|want|you|to|need)){0,3} +)' +
  '(?:escrev(?:a|am|e|er)|cri(?:e|em|ar|a)|adicion(?:e|em|ar|a)|acrescent(?:e|em|ar|a)|ger(?:e|em|ar|a)|write|add|' +
  'create|generate)' +
  '(?: +(?:o|os|um|uma|uns|umas|mais|novos?|alguns|the|a|an|some|more|new|unit|integration|e2e))*' +
  ' +(?:testes?|tests?)\\b');

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

// A frase do "por que voce falhou": a pergunta sobre a sessao, da rota diagnosticar.
function ehDiagnostico(f) {
  const porQue = POR_QUE.test(f) || (POR_QUE_SO_NA_PERGUNTA.test(f) && f.indexOf('?') !== -1);
  return (porQue && SUJEITO.test(f) && FALHA.test(f)) || O_QUE_HOUVE.test(f);
}

/** Os tipos que a mensagem do dono pede: diagnosticar, bug, teste, depois plano. Nao texto = []. */
function doPedido(prompt) {
  if (typeof prompt !== 'string') return [];
  const t = semAcento(prompt.slice(0, TETO_DO_PEDIDO));
  const tipos = [];
  // cada frase com a pontuacao do fim, para saber se ela e pergunta
  const frases = t.match(/[^.?!\n]+[.?!\n]*/g) || [];
  const diag = frases.map(ehDiagnostico);
  if (diag.indexOf(true) !== -1) tipos.push('diagnosticar');
  // o tipo 'bug' e a rota de defeito. O defeito na frase do "por que voce quebrou o teste?" e da diagnosticar; a pilha
  // colada vale em qualquer lugar
  if (PILHA.some(function (re) { return re.test(t); }) ||
    frases.some(function (f, i) { return !diag[i] && DEFEITO.test(f); })) tipos.push('bug');
  if (ESCREVER_TESTES.test(t)) tipos.push('teste');
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

/** Os tipos que a edicao de `alvo` (relativo ao projeto) traz, na ordem: teste ou tela, plano ou etapa, aaa. */
function daEdicao(alvo, entrada, projeto) {
  if (typeof alvo !== 'string' || !alvo) return [];
  const caminho = glob.normalizar(alvo);
  const ent = ehObjeto(entrada) ? entrada : {};
  const proj = ehObjeto(projeto) ? projeto : null;
  const tipos = [];
  // o arquivo com nome de teste e teste, mesmo o de componente (.test.tsx): o roteiro de tela nao serve a ele
  if (ehNomeDeTeste(caminho)) tipos.push('teste');
  else {
    try {
      if (MARCACAO.test(caminho) || design.ehArquivoDeEstilo(caminho, proj)) tipos.push('tela');
    } catch (e) { /* caminhosDeEstilo torto: sem a rota de tela */ }
  }
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
    return 'sworn: ' + (alvo || 'este arquivo') + ' e tela. Agora, ' + carregue('design') + ' e siga o roteiro ' +
      'dela: os estados de cada controle (o pressionado incluido), o foco visivel, o contraste legivel, o movimento ' +
      'curto que respeita prefers-reduced-motion, o alvo de pelo menos 24 x 24 px e a tela testada com o dado do ' +
      'pior caso.' +
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
  if (tipo === 'bug') {
    return 'sworn: o pedido fala de um defeito; antes do conserto, reproduza-o com um teste que falha pelo mesmo motivo: ' +
      'rode-o e veja-o falhar (o vermelho primeiro). Depois, a causa raiz: leia o erro inteiro (a mensagem, a pilha, o ' +
      'codigo de saida); veja o que mudou (git log, git diff, a versao de uma dependencia); instrumente cada fronteira ' +
      'que o dado atravessa; teste uma hipotese por vez, mudando uma coisa so. Se o conserto falhar, desfaca-o e teste ' +
      'outra hipotese: nao empilhe outro conserto em cima.';
  }
  if (tipo === 'teste') {
    return 'sworn: ' + (alvo ? alvo + ' e um arquivo de teste.' : 'o pedido e escrever testes.') + ' O teste de codigo ' +
      'novo falha primeiro: rode-o antes do codigo e veja-o vermelho pelo motivo certo. Antes de dizer pronto, a mutacao, ' +
      'tambem no teste de codigo que ja existia: quebre de proposito a linha que o teste vigia, veja-o falhar e desfaca ' +
      'a quebra; quebre so a ocorrencia que carrega o sentido, nao todas, para provar que ele vigia o lugar certo. O ' +
      'roteiro inteiro esta na secao 2 de ' + (ordens.naPonte()
      // pela ponte nao ha a ferramenta Skill: o caminho da copia, como no comoCarregar (ordens.js)
      ? '.agents/skills/sworn-playbook/references/04-verificacao.md no projeto, ou skills/playbook/references/' +
        '04-verificacao.md na pasta do sworn.'
      : 'references/04-verificacao.md, na skill playbook do sworn.');
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
