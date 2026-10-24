'use strict';

const { veioDeSubagente } = require('./texto.js');

/**
 * T3b (D611): o radar do usuario (/sworn:radar) se oferece sozinho quando o dono pede melhoria, sugestao ou
 * funcao nova. Aqui mora so o detector e o texto; quem busca e a skill, e so depois do sim dele. O gancho
 * (abrir-turno.js) nunca roda o radar.
 *
 * Molde: correcao.js. Conservador de proposito: perder uma oferta e so nao oferecer (o dono ainda roda
 * /sworn:radar); oferecer em relato de bug ou em pedido de commit e ruido. Por isso cada padrao exige a cara
 * de PEDIDO DE MELHORIA DO PROJETO, nao so a palavra:
 * - "funcao"/"ferramenta"/"modulo"... so contam depois de um verbo de vontade ("quero adicionar uma funcao");
 *   sem ele, "crie uma funcao que soma" e tarefa de codigo, e so "funcionalidade"/"feature"/"recurso" bastam.
 * - "nova feature" so vale no comeco da clausula ou depois de vontade; "a nova feature quebrou o login" e bug.
 * - "melhorar" so conta quando o objeto e o projeto; "melhore sua resposta" e sobre o proprio agente.
 * - "sugira" so conta com o objeto logo depois ("sugira melhorias"), nao "sugira uma mensagem de commit".
 * O resto de falso positivo o proprio modelo descarta pela instrucao, e a oferta sai no maximo 1 vez por sessao.
 */
const CHAVE = 'oferecerRadar';

// Inicio de clausula: comeco do texto, depois de pontuacao, ou depois de conjuncao curta.
const INI = '(?:^|[.!?,;:]\\s*|\\b(?:e|mas|ok|entao|ai|and|but|so)\\s+)';

// Vontade do dono, em primeira pessoa ou plural: "quero", "gostaria de", "i want to", "we need to".
const VONTADE_PT = '(?:quero|queria|gostaria\\s+de|preciso|precisamos|vou\\s+querer|vamos|podemos|pensando\\s+em|que\\s+tal|e\\s+se)';
const VONTADE_EN = "(?:i\\s+want(?:\\s+to)?|i\\s+wanna|i\\s+need(?:\\s+to)?|i(?:'d|\\s+would)\\s+like(?:\\s+to)?|we\\s+(?:want|need)(?:\\s+to)?|let's|can\\s+we|could\\s+we|what\\s+about|how\\s+about)";

const VERBO_NOVO_PT = '(?:adicionar|acrescentar|incluir|criar|implementar|desenvolver|construir|fazer|ter)';
const VERBO_NOVO_EN = '(?:add|build|implement|create|develop|have)';
const IMPERATIVO_PT = '(?:adicione|acrescente|inclua|crie|implemente|desenvolva|construa)';

// O que e "coisa nova do projeto": o nucleo (basta com ou sem vontade) e o amplo (so depois de vontade).
const NUCLEO_PT = '(?:funcionalidades?|features?|recursos?)';
const AMPLO_PT = '(?:funcao|funcoes|ferramentas?|modulos?|telas?|paginas?|opcao|opcoes|integracoes?|integracao|botao|botoes|comandos?|relatorios?)';
const NUCLEO_EN = '(?:features?|functionality|capabilit(?:y|ies))';
const AMPLO_EN = '(?:functions?|tools?|modules?|screens?|pages?|options?|integrations?|commands?|buttons?|reports?)';

// "o proprio agente" ou "a resposta": melhorar isso nao e melhorar o projeto.
const NAO_E_O_AGENTE_PT = '(?!\\s+(?:a\\s+|as\\s+)?(?:sua|suas|seu|seus|tua|teu|resposta|respostas|voce)\\b)(?!\\s+(?:o\\s+)?(?:meu|minha)\\s+(?:prompt|pergunta|texto|resposta)\\b)';
const NAO_E_O_AGENTE_EN = '(?!\\s+(?:your|you|the\\s+(?:answer|response)|this\\s+(?:answer|response)|my\\s+(?:prompt|question|answer))\\b)';

const PROJETO_PT = '(?:projeto|app|aplicativo|sistema|extensao|plugin|produto|interface|site|api|backend|frontend|arquitetura|ferramenta)';
const PROJETO_EN = '(?:project|app|application|codebase|system|extension|plugin|product|interface|site|api|backend|frontend|architecture|tool|ui|ux)';

const PADROES = [
  // PT: "quero adicionar uma funcao/funcionalidade/feature de ..."; vontade libera o amplo
  new RegExp('\\b' + VONTADE_PT + '\\s+(?:de\\s+)?' + VERBO_NOVO_PT + '\\s+(?:uma?\\s+|algumas?\\s+)?(?:nova\\s+|novas\\s+)?(?:' + NUCLEO_PT + '|' + AMPLO_PT + ')\\b'),
  // PT: "quero uma nova feature", "preciso de uma funcionalidade nova"
  new RegExp('\\b' + VONTADE_PT + '\\s+(?:de\\s+)?(?:uma?\\s+)?(?:nova\\s+|novas\\s+)' + NUCLEO_PT + '\\b'),
  // PT: imperativo so com o nucleo: "adicione uma funcionalidade de modo escuro" (nao "adicione um teste")
  new RegExp(INI + IMPERATIVO_PT + '\\s+(?:uma?\\s+|algumas?\\s+)?(?:nova\\s+|novas\\s+)?' + NUCLEO_PT + '\\b'),
  // PT: "nova feature: ..." no comeco da clausula ("a nova feature quebrou" nao)
  new RegExp(INI + 'nov[ao]s?\\s+' + NUCLEO_PT + '\\b'),
  // PT: ideias de novas funcionalidades
  new RegExp('\\bideias?\\s+(?:de|para)\\s+(?:novas?\\s+)?(?:' + NUCLEO_PT + '|melhorias?)\\b'),
  // PT: "como posso/podemos melhorar ..." (menos o proprio agente e a resposta)
  new RegExp('\\bcomo\\s+(?:eu\\s+)?(?:posso|podemos|da\\s+para|daria\\s+para)\\s+(?:melhorar|aprimorar|evoluir)\\b' + NAO_E_O_AGENTE_PT),
  // PT: "o que mais posso adicionar/melhorar"
  /\bo\s+que\s+(?:mais\s+)?(?:posso|podemos|da\s+para|daria\s+para)\s+(?:adicionar|melhorar|acrescentar|incluir)\b/,
  // PT: "sugira melhorias", "sugere funcionalidades", "me sugira algumas ideias"
  /\b(?:me\s+)?(?:sugira|sugere|sugerir|sugiram)\s+(?:me\s+)?(?:algumas?\s+|umas?\s+|novas?\s+)?(?:melhorias?|funcionalidades?|features?|recursos?|ideias?)\b/,
  // PT: "quero melhorar o projeto", "melhore o projeto"
  new RegExp('\\b' + VONTADE_PT + '\\s+(?:de\\s+)?(?:melhorar|aprimorar|evoluir)\\s+(?:o|a|os|as|esse|essa|este|esta|nosso|nossa|meu|minha)\\s+' + PROJETO_PT + '\\b'),
  new RegExp(INI + '(?:melhore|aprimore|evolua)\\s+(?:o|a|esse|essa|este|esta|nosso|nossa)\\s+' + PROJETO_PT + '\\b'),
  // EN: "i want to add a function ...", "add a feature ..."
  new RegExp('\\b' + VONTADE_EN + '\\s+' + VERBO_NOVO_EN + '\\s+(?:a\\s+|an\\s+|some\\s+)?(?:new\\s+)?(?:' + NUCLEO_EN + '|' + AMPLO_EN + ')\\b'),
  new RegExp(INI + '(?:add|build|implement|create)\\s+(?:a\\s+|an\\s+|some\\s+)?(?:new\\s+)?' + NUCLEO_EN + '\\b'),
  // EN: "i need a new feature", "new feature: ..." no comeco da clausula
  new RegExp('\\b' + VONTADE_EN + '\\s+(?:a\\s+|an\\s+)?new\\s+' + NUCLEO_EN + '\\b'),
  new RegExp(INI + 'new\\s+' + NUCLEO_EN + '\\b'),
  /\bideas?\s+for\s+(?:new\s+)?(?:features?|improvements?|enhancements?)\b/,
  // EN: "how can I improve ..." (menos o proprio agente e a resposta)
  new RegExp("\\bhow\\s+(?:can|could|do|should|would)\\s+(?:i|we)\\s+(?:improve|enhance)\\b" + NAO_E_O_AGENTE_EN),
  // EN: "suggest improvements", "recommend some features"
  /\b(?:suggest|recommend)\s+(?:me\s+)?(?:some\s+|any\s+|a\s+few\s+)?(?:improvements?|enhancements?|features?|ideas?)\b/,
  new RegExp(INI + '(?:improve|enhance)\\s+(?:the|this|our|my)\\s+' + PROJETO_EN + '\\b')
];

/**
 * O usuario esta pedindo melhoria, sugestao ou funcao nova para o projeto dele? So o texto do prompt: sem rede,
 * sem disco. Normaliza como a correcao: sem acento, minusculas, espaco unico, apostrofo reto.
 */
function parecePedidoDeMelhoria(prompt) {
  if (typeof prompt !== 'string') return false;
  const t = prompt.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2018\u2019\u00b4`]/g, "'")
    .toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return false;
  // D477/D484: o relatorio que CITA um pedido nao e o dono pedindo (filtro em texto.js).
  if (veioDeSubagente(prompt)) return false;
  return PADROES.some(function (re) { return re.test(t); });
}

function ehObjeto(p) {
  return !!p && typeof p === 'object' && !Array.isArray(p);
}

/** Ligado por padrao, com ou sem projeto.json. So `false` desliga (como sugerirAprender). */
function ligada(projeto) {
  return !(ehObjeto(projeto) && projeto[CHAVE] === false);
}

/** O que o modelo recebe quando o prompt parece pedido de melhoria. ASCII puro: sai por hook. Nada roda sem o sim. */
const INSTRUCAO_DA_OFERTA = [
  'sworn: a mensagem do usuario parece um pedido de MELHORIA, sugestao ou funcao nova para o projeto dele.',
  'Se for, faca nesta mesma resposta:',
  '1. Atenda o pedido.',
  '2. No fim, ofereca o radar pelo AskUserQuestion, em 3 opcoes:',
  '   (a) buscar projetos parecidos com o tema deste pedido (recomendada; custo estimado:',
  '   cerca de US$ 1,20 e 6 minutos numa sessao Sonnet, medido com 11 projetos lidos e 4 a fundo);',
  '   (b) agora nao;',
  '   (c) nao oferecer mais neste projeto (grava "oferecerRadar": false em .claude/sworn/projeto.json).',
  'Nada roda sem o sim: com o (a), rode /sworn:radar com a busca por tema (o tema e o deste pedido);',
  'o (c) so grava a chave depois da escolha dele. Se o pedido nao for de melhoria ou de funcao nova',
  'do projeto (relato de bug, pergunta de codigo, commit), ignore este aviso.'
].join('\n');

module.exports = { CHAVE, parecePedidoDeMelhoria, ligada, INSTRUCAO_DA_OFERTA };
