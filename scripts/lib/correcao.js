'use strict';

const { veioDeSubagente } = require('./texto.js');

/**
 * Bloco A1 (D426): o dono CORRIGIU o comportamento do agente -> o plugin sugere transformar a correcao
 * em regra com /sworn:learn. Aqui mora so o detector e o texto; quem grava e a skill, e so depois
 * da aprovacao dele. O gancho (abrir-turno.js) nunca grava regra.
 *
 * Molde: saude.perguntaSobreSaude. Conservador de proposito, porque o erro dos dois lados custa
 * diferente: perder uma correcao e so nao sugerir (ele ainda pode rodar /sworn:learn); sugerir em
 * relato de bug e ruido a cada pedido. Por isso cada padrao abaixo exige a cara de CORRECAO, nao so a
 * palavra: "o botao para de funcionar" e "o login nunca mais funcionou" sao relato de bug.
 * "pare de <verbo>" e imperativo; "para de" (sem o e) fica de fora de proposito, e o verbo do relato.
 * "da proxima vez" e "next time" so valem no comeco da frase ou depois de virgula: no meio da frase
 * ("o job roda da proxima vez que o cron rodar") descrevem o sistema, nao o agente. Depois de virgula,
 * "da proxima vez que ..." tambem descreve o sistema (PA1-4); "nunca mais" so vale seco ou com imperativo (PA1-1).
 * D429/4: "da proxima vez" / "next time" seguidos do proprio usuario ("vejo o log", "I will check") ou do sistema
 * ("o job usa", "it runs") tambem nao sao ordem; "nunca mais <imperativo>" exige comeco de clausula (sem sujeito antes).
 * "nao, pode seguir" tambem nao conta: "nao," e resposta a pergunta do agente, a menos que venha
 * um imperativo que mude o rumo ("nao, use o Edit").
 * O resto de falso positivo (ex.: "pare de usar a API antiga" como pedido de migracao) o proprio modelo
 * descarta pela instrucao, e a janela de 1 sugestao a cada 5 turnos limita o ruido.
 */
const CHAVE = 'sugerirAprender';

// A sugestao sai no maximo 1 vez a cada 5 turnos por sessao: ao sugerir, os 4 prompts seguintes esperam.
const ESPERA_ENTRE_SUGESTOES = 4;

// Inicio de clausula: comeco do texto, depois de pontuacao, ou depois de conjuncao curta.
const INI = '(?:^|[.!?,;:]\\s*|\\b(?:e|mas|ok|entao|ai|and|but|so)\\s+)';

// Inicio de clausula SEM a virgula: depois de virgula, "da proxima vez que ..." so conta fora das oracoes relativas.
const INI_SEM_VIRGULA = '(?:^|[.!?;:]\\s*|\\b(?:e|mas|ok|entao|ai|and|but|so)\\s+)';

// Comeco de frase: comeco do texto ou depois de ponto final, exclamacao, interrogacao.
const FRASE = '(?:^|[.!?]\\s*)';

// D429/4: depois de "da proxima vez" / "next time" quem fala NAO e uma ordem ao agente quando vem (a) o proprio
// usuario ("eu", "vou", "a gente" ou um verbo na 1a pessoa do singular, que em portugues termina em -o:
// "vejo", "mando") ou (b) o sistema ("o job roda", "a tela mostra", "it runs"). Lookahead: nao consome nada.
// Palavras em -o que NAO sao verbo e abrem ordem ("nao faca", "primeiro pergunte") ficam de fora do veto.
const DEPOIS_NAO_E_ORDEM_PT = '(?!,?\\s+(?:(?:eu|vou|irei|vamos|a\\s+gente|o|a|os|as|um|uma|ele|ela|isso|esse|essa|este|esta|meu|minha|nosso|nossa)\\b|(?!(?:nao|primeiro|outro|cuidado|mesmo)\\b)[a-z]{2,}o\\b))';
const DEPOIS_NAO_E_ORDEM_EN = '(?!,?\\s+(?:i|we|it|he|she|they|the|this|that|there|a|an|my|our|its|their)\\b)';

// "nunca mais <imperativo>" so vale no comeco da clausula, com no maximo duas frases de cortesia/vontade antes
// ("por favor", "quero que", "voce"). Com sujeito antes ("o botao nunca mais usa", "espero que o job nunca mais use")
// e descricao do sistema, nao ordem.
const LEAD_NUNCA_MAIS = '(?:(?:por\\s+favor|pf|pfv|please|agora|a\\s+partir\\s+de\\s+agora|voce|quero\\s+que|preciso\\s+que|peco\\s+que)[\\s,]+){0,2}';

const PADROES = [
  // "eu (ja) (te) disse/falei/pedi" - "ja pedi" e "ja te disse" sao em primeira pessoa; "o gestor ja disse" nao.
  /\bja\s+(?:te\s+|lhe\s+)?(?:falei|pedi|avisei)\b/,
  /\beu\s+ja\s+(?:te\s+|lhe\s+)?(?:disse|falei|pedi|avisei)\b/,
  /\b(?:eu\s+(?:ja\s+)?|ja\s+)(?:te|lhe)\s+(?:disse|falei|pedi|avisei)\b/,
  // "nao foi isso que (eu) pedi", "nao e assim", "nao era isso"
  /\bnao\s+foi\s+(?:isso|isto)\s+que\s+(?:eu\s+)?(?:te\s+)?(?:pedi|quis|falei|disse|mandei)\b/,
  /\bnao\s+e\s+assim\b/,
  /\bnao\s+era\s+(?:isso|assim)\b/,
  // "de novo isso / esse erro", "outra vez isso" - reclamacao no comeco da frase ("rode de novo esse teste" nao)
  new RegExp(INI + '(?:de novo|outra vez)\\s+(?:isso|(?:esse|essa|este|esta)\\s+(?:erro|problema|bug|falha)|o mesmo erro)\\b'),
  // "pare de <verbo>" (nao "para de")
  /\bpare\s+de\s+\w+(?:ar|er|ir|or)\b/,
  // "nunca mais": so o pedido seco ("Nunca mais.", "nunca mais!", "nunca mais, por favor": nada depois alem de
  // pontuacao) ou seguido de imperativo dirigido ao agente. "nunca mais <verbo no passado>" descreve o sistema
  // ("o botao nunca mais mostrou o aviso") e nenhuma lista de verbos o cobre, por isso nao ha mais lista de excecao.
  new RegExp(INI + 'nunca\\s+mais\\s*(?:$|[.!?,;:])'),
  new RegExp(INI + LEAD_NUNCA_MAIS + 'nunca\\s+mais\\s+(?:me\\s+)?(?:faca|fazer|use|usar|usa|escreva|escrever|rode|rodar|crie|criar|apague|apagar|mexa|mexer|toque|tocar|repita|repetir|invente|inventar|ignore|ignorar|esqueca|esquecer|suba|subir|diga|dizer|pergunte|perguntar|responda|responder)\\b'),
  // "da proxima vez"; depois de virgula, "da proxima vez que ..." descreve o sistema ("falhou, da proxima vez que rodar vejo o log")
  new RegExp('(?:' + INI_SEM_VIRGULA + 'da\\s+proxima\\s+vez\\b|,\\s*da\\s+proxima\\s+vez\\b(?!\\s+que\\b))' + DEPOIS_NAO_E_ORDEM_PT),
  // "quantas vezes" so com verbo de falar/pedir ("quantas vezes o job roda por dia?" e pergunta de codigo)
  /\bquantas\s+vezes\b.{0,30}\b(?:dizer|falar|pedir|repetir|avisar|explicar|mandar|disse|falei|pedi|avisei)\b/,
  // "voce errou"
  /\bvoce\s+(?:ja\s+)?(?:errou|esqueceu|ignorou)\b/,
  // "nao," + imperativo no comeco da frase: "nao, use X". Fora: "nao, pode seguir", "nao, obrigado", "nao, deixa assim".
  new RegExp(FRASE + 'nao,\\s+(?:use|usa|faca|faz|coloque|ponha|troque|mude|remova|tire|apague|crie|escreva|volte|desfaca|nao|leia|rode|corrija|olhe|veja|era\\s+para|e\\s+para)\\b'),
  // EN
  // "asked you" + palavra interrogativa e pergunta ("i asked you earlier which branch we use"), nao cobranca
  /\bi(?:'ve| have)?\s+(?:already\s+)?(?:told\s+you\b|asked\s+you\b(?!\s+(?:\w+\s+)?(?:which|what|where|when|who|whom|how|why|if|whether)\b))/,
  /\bi(?:'ve| have)?\s+already\s+(?:said|told|asked|mentioned)\b/,
  /\bstop\s+doing\b/,
  /\bdo(?:n't| not)\s+(?:ever\s+)?(?:do|make|use|add|write|touch|change|say)\s+(?:that|this|it)\s+again\b/,
  new RegExp(INI + 'next\\s+time\\b' + DEPOIS_NAO_E_ORDEM_EN),
  // "no, do you/we/I ...?" e pergunta do agente respondida com "no,"; "no, do it again" segue sendo correcao
  new RegExp(FRASE + 'no,\\s+(?:use|do(?!\\s+(?:you|we|i|they|he|she)\\b)|don\'t|do not|revert|undo|put|stop)\\b')
];

/**
 * O usuario esta corrigindo o jeito como o agente se comporta? So o texto do prompt: sem rede, sem disco.
 * Normaliza como a saude: sem acento, minusculas, espaco unico, apostrofo reto.
 */
function pareceCorrecao(prompt) {
  if (typeof prompt !== 'string') return false;
  const t = prompt.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2018\u2019\u00b4`]/g, "'")
    .toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return false;
  // D477: o relatorio que CITA uma correcao nao e o dono corrigindo (filtro em texto.js, D484).
  if (veioDeSubagente(prompt)) return false;
  return PADROES.some(function (re) { return re.test(t); });
}

function ehObjeto(p) {
  return !!p && typeof p === 'object' && !Array.isArray(p);
}

/** Ligado por padrao, com ou sem projeto.json. So `false` desliga (como qualidadeDeResposta). */
function ligada(projeto) {
  return !(ehObjeto(projeto) && projeto[CHAVE] === false);
}

/** O que o modelo recebe quando o prompt parece uma correcao. ASCII puro: sai por hook. Plano 091 (#2, D559): ordem
 *  de rodar a skill na mesma resposta e perguntar em 3 opcoes; gravar segue so com o sim. */
const INSTRUCAO_DA_CORRECAO = [
  'sworn: a mensagem do usuario parece uma CORRECAO ao seu comportamento.',
  'Se for, e valer tambem para as proximas vezes, faca nesta mesma resposta:',
  '1. Atenda o pedido.',
  '2. Rode /sworn:learn: ele monta a regra (gatilho -> acao).',
  '3. Pergunte pelo AskUserQuestion, em 3 opcoes: gravar como esta (recomendada),',
  '   ajustar o texto antes, nao gravar.',
  'So grave com o sim. Se nao for correcao do seu comportamento (relato de bug,',
  'resposta a uma pergunta sua), ignore este aviso.'
].join('\n');

module.exports = { CHAVE, ESPERA_ENTRE_SUGESTOES, pareceCorrecao, ligada, INSTRUCAO_DA_CORRECAO };
