'use strict';
// R3d (D833, pedidos 21 e 146 do dono: "Você falou tudo em inglês", "me responda em português"): a regra "responda no
// idioma do usuario" sai uma vez, na abertura (qualidade.js); numa sessao longa ela fica longe e a resposta escapa
// para o ingles. A cada mensagem do dono, o gancho de entrada (abrir-turno.js) compara o idioma dela com o da ultima
// resposta e, so quando diferem, lembra numa linha. Heuristica por palavras frequentes: na duvida, nao detecta (null)
// e nao avisa.
const transcricoes = require('./transcricoes.js');

const PALAVRAS = {
  pt: ['que', 'nao', 'não', 'para', 'com', 'uma', 'voce', 'você', 'esta', 'está', 'isso', 'mas', 'por', 'como', 'mais',
    'tem', 'ja', 'já', 'tudo', 'quando', 'agora', 'aqui', 'sao', 'são', 'seu', 'sua', 'pra', 'foi', 'ser', 'ele', 'dos',
    'das', 'nos', 'nas', 'pelo', 'pela', 'entao', 'então', 'tambem', 'também', 'precisa', 'preciso', 'fazer', 'vamos'],
  en: ['the', 'and', 'is', 'to', 'of', 'you', 'that', 'with', 'this', 'for', 'are', 'it', 'was', 'not', 'what', 'have',
    'be', 'on', 'at', 'from', 'by', 'or', 'an', 'will', 'can', 'there', 'which', 'would', 'should', 'into', 'than', 'its']
};
const NOMES = { pt: 'portugues', en: 'ingles' };
// palavras so do espanhol: "que", "para", "por", "como" sao das duas linguas, e o espanhol nao pode virar portugues
const ESPANHOL = new Set(['el', 'los', 'las', 'del', 'muy', 'ahora', 'hay', 'yo', 'usted', 'pero', 'eso', 'esto',
  'tiene', 'tienes', 'puedes', 'puede', 'hacer', 'gracias', 'tambien', 'también', 'donde', 'cuando', 'necesito', 'quiero']);
const LISTAS = { pt: new Set(PALAVRAS.pt), en: new Set(PALAVRAS.en) };
// as palavras da lista do portugues que o espanhol tambem escreve igual: o portugues precisa de 2 que sejam so dele
const DO_ESPANHOL_TAMBEM = new Set(['que', 'para', 'por', 'como', 'mas', 'esta', 'nos', 'dos', 'ser', 'pelo', 'vamos',
  'preciso', 'precisa']);
const SO_DO_PORTUGUES = 2;
// o que nao e prosa: bloco de codigo, codigo em linha, endereco e caminho (e a palavra/palavra, como "e/ou", que conta
// menos e nunca inverte o idioma)
const FORA = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`|https?:\/\/\S+|[A-Za-z]:[\\/]\S+|(?:\.{0,2}\/)?[\w.-]+\/[\w./-]+/g;
const CERCAS = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const MINIMO = 4;
// o idioma se ve nas primeiras linhas; o texto colado enorme (log, dump) nao pode pesar no gancho de entrada
const TETO = 4000;

/** 'pt', 'en' ou null (texto curto demais, misturado, espanhol ou de outro idioma). */
function detectar(texto) {
  if (typeof texto !== 'string') return null;
  // o bloco de codigo que abre antes do teto e fecha depois dele fica sem o fecho no corte: tirados os blocos fechados,
  // a cerca que sobra no comeco de linha (como o Markdown a le) abre um bloco, e o texto vai so ate ela. A cerca solta
  // no meio da frase nao corta nada.
  let corte = texto.slice(0, TETO).replace(CERCAS, ' ');
  const aberta = /^[ \t]*(?:```|~~~)/m.exec(corte);
  if (aberta) corte = corte.slice(0, aberta.index);
  const palavras = corte.replace(FORA, ' ').toLowerCase().match(/[a-zà-ÿ]+/g) || [];
  const conta = { pt: 0, en: 0, es: 0, soPt: 0 };
  for (const p of palavras) {
    if (LISTAS.pt.has(p)) conta.pt++;
    if (LISTAS.pt.has(p) && !DO_ESPANHOL_TAMBEM.has(p)) conta.soPt++;
    if (LISTAS.en.has(p)) conta.en++;
    if (ESPANHOL.has(p)) conta.es++;
  }
  const [a, b] = conta.pt >= conta.en ? ['pt', 'en'] : ['en', 'pt'];
  if (conta[a] < MINIMO || conta[a] < 2 * conta[b]) return null;
  if (a === 'pt' && (conta.es >= 2 || conta.soPt < SO_DO_PORTUGUES)) return null;
  return a;
}

/** O texto da ultima resposta do assistente na transcricao do Claude Code (so a cauda), ou null. */
function ultimaResposta(caminho) {
  const cauda = transcricoes.caudaDoTranscript(caminho);
  if (!cauda) return null;
  const linhas = cauda.split('\n');
  for (let i = linhas.length - 1; i >= 0; i--) {
    let o;
    try { o = JSON.parse(linhas[i]); } catch (e) { continue; }
    if (!o || o.type !== 'assistant' || o.isSidechain || !o.message || !Array.isArray(o.message.content)) continue;
    const texto = o.message.content.filter(function (b) { return b && b.type === 'text' && typeof b.text === 'string'; })
      .map(function (b) { return b.text; }).join('\n').trim();
    if (texto) return texto;
  }
  return null;
}

// pendencia #4: depois da compactacao, o Claude Code manda o resumo (em ingles, escrito por ele) como a mensagem do
// turno; nao e o dono escrevendo, e o aviso dizia "o dono escreve em ingles" com o dono em portugues
const RESUMO_DA_COMPACTACAO = /^\s*This session is being continued from a previous conversation that ran out of context/;
// pendencia #5: o relatorio de subagente (e o aviso de tarefa em segundo plano) chega como a mensagem do turno, com o
// prompt comecando pela marca do Claude Code; e texto de modelo, em ingles, e nao o dono escrevendo
const DE_OUTRO_AGENTE = /^\s*<(?:agent-message from=|task-notification>)/;

/** A linha ao modelo quando o dono escreve num idioma e a ultima resposta saiu em outro; senao null. Em ASCII, como
 *  todo texto de gancho que chega ao modelo (regra R5 do projeto). */
function aviso(prompt, caminho) {
  const texto = String(prompt || '');
  if (RESUMO_DA_COMPACTACAO.test(texto) || DE_OUTRO_AGENTE.test(texto)) return null;
  const dono = detectar(prompt);
  if (!dono) return null;
  const resposta = detectar(ultimaResposta(caminho));
  if (!resposta || resposta === dono) return null;
  return 'sworn - idioma: o dono escreve em ' + NOMES[dono] + ' e a sua ultima resposta saiu em ' + NOMES[resposta] +
    '. Responda em ' + NOMES[dono] + ', inclusive no texto entre as ferramentas.';
}

module.exports = { detectar, ultimaResposta, aviso };
