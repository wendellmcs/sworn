'use strict';

// Alegacao de sucesso. Testada FORA dos blocos de codigo, para nao pegar string de codigo.
const ALEGACOES = [
  /\bpronto\b/i, /\bconclu[ií]d[oa]s?\b/i, /\bfuncionando\b/i, /\bfunciona\b/i,
  /\bpassou\b/i, /\bpassaram\b/i, /\btestes? ok\b/i, /\btudo ok\b/i,
  /\bcorrigid[oa]s?\b/i, /\bresolvid[oa]s?\b/i, /\bimplementad[oa]s?\b/i,
  /\btudo cert[oa]\b/i, /\bdeu cert[oa]\b/i, /\bsem erros?\b/i, /\bverde\b/i,
  /\ball tests? (pass|passed|passing)/i, /\bworks? now\b/i, /\bfixed\b/i, /\bdone\b/i
];

// Declaracao explicita do que NAO rodou. Vale como evidencia honesta.
const NAO_RODOU = [
  /n[ãa]o rodei/i, /n[ãa]o executei/i, /n[ãa]o rod(ou|aram)/i, /n[ãa]o testei/i,
  /n[ãa]o foi testad/i, /n[ãa]o testad[oa]/i, /falta rodar/i, /falta testar/i,
  /declaro que n[ãa]o/i, /n[ãa]o consegui (rodar|executar|verificar|testar|reproduzir)/i,
  /n[ãa]o verifiqu/i, /not (run|tested|verified)/i
];

// Um bloco so vale como evidencia se parecer saida de comando (desenho §71):
// cerca em linha propria, corpo nao vazio, e linguagem que nao seja de codigo-fonte.
const LINGUAGEM_DE_CODIGO = /^(js|jsx|ts|tsx|mjs|cjs|py|rb|php|java|cs|c|cpp|h|go|rs|swift|kt|html|css|scss|xml|yaml|yml|toml|ini|sql|md|diff|patch)$/i;

function blocosDeSaida(texto) {
  const re = /^[ \t]*```([A-Za-z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;
  const achados = [];
  let m;
  while ((m = re.exec(texto)) !== null) {
    if (LINGUAGEM_DE_CODIGO.test(m[1] || '')) continue;
    if ((m[2] || '').trim() === '') continue;
    achados.push(m[2]);
  }
  return achados;
}

function semBlocos(texto) {
  return String(texto == null ? '' : texto).replace(/```[\s\S]*?```/g, ' ');
}

function analisar(texto) {
  const bruto = String(texto == null ? '' : texto);
  const prosa = semBlocos(bruto);
  return {
    alegaSucesso: ALEGACOES.some(function (r) { return r.test(prosa); }),
    temBloco: blocosDeSaida(bruto).length > 0,
    declaraNaoRodou: NAO_RODOU.some(function (r) { return r.test(prosa); })
  };
}

/** Bloqueia quando ha alegacao de sucesso, nenhum bloco de saida e nenhuma ressalva. */
function deveBloquear(texto) {
  const a = analisar(texto);
  return a.alegaSucesso && !a.temBloco && !a.declaraNaoRodou;
}

// D634 (7a): saida que mostra falha. Contagem so com numero de 1 para cima ("fail 0" e "0 failed" passam);
// a linha "not ok" do tap com # TODO ou # SKIP nao e falha.
const FALHA_NA_SAIDA = [
  /\bfail(?:s|ed|ures?)?[ \t]*[:=]?[ \t]*[1-9]/i, /\b[1-9]\d*[ \t]+(?:tests?[ \t]+)?(?:failed|failing|failures?)\b/i,
  /^[ \t]*not ok\b(?!.*#[ \t]*(?:todo|skip))/im, /\bexit(?:ed with)?[ \t]+(?:code|status)[ \t]*[:=]?[ \t]*[1-9]/i
];
// Palavras soltas: tambem aparecem no nome de um teste que passou. Valem so quando a saida nao traz o resumo que zera.
const FALHA_SOLTA = [/\bERR!/, /\btimed out\b/i, /tempo esgotado/i, /\bETIMEDOUT\b/];
const RESUMO_SEM_FALHA = [/\bfail(?:s|ed|ures?)?[ \t]*[:=]?[ \t]*0\b/i, /\b0[ \t]+(?:tests?[ \t]+)?(?:failed|failing|failures?)\b/i];

// Quem diz que a falha segue nao mente. "o teste falhava; corrigido" nao entra: e a causa contada, nao a falha de agora.
// "nao passa" fica de fora (D639): a regex nao separa "o teste nao passa" de "o GET nao passa pelo filtro nos testes",
// e a frase que libera e a que MOTIVO_FALHA ensina ("diga que ainda falha").
const AINDA_FALHA = [
  /ainda falh(?:a|am|ou|aram|ando)\b/i, /(?:continua|continuam|segue|seguem|est[aá]|est[aã]o) falhando/i,
  /still fail/i, /(?:is|are) (?:still )?failing/i
];

function textoMostraFalha(texto) {
  const t = String(texto == null ? '' : texto);
  if (FALHA_NA_SAIDA.some(function (r) { return r.test(t); })) return true;
  return !RESUMO_SEM_FALHA.some(function (r) { return r.test(t); }) && FALHA_SOLTA.some(function (r) { return r.test(t); });
}

/** D634 (7b/8): a prosa diz o que nao rodou ou que a falha segue - a saida sempre aberta do portao. */
function declaraRessalva(texto) {
  const prosa = semBlocos(texto);
  return NAO_RODOU.concat(AINDA_FALHA).some(function (r) { return r.test(prosa); });
}

/**
 * D634 (7a): a decisao do portao, como deveBloquear (nao um teste do texto): barra quando a prosa alega sucesso, ha
 * bloco de saida, todo bloco mostra falha e a prosa nao traz ressalva. Sem alegacao, false mesmo com bloco vermelho.
 */
function deveBloquearPorFalha(texto) {
  const bruto = String(texto == null ? '' : texto);
  const a = analisar(bruto);
  if (!a.alegaSucesso || !a.temBloco || declaraRessalva(bruto)) return false;
  return blocosDeSaida(bruto).every(textoMostraFalha);
}

const PERGUNTA_FINAL = [
  '',
  'Faca uma destas, e responda de novo:',
  '  1. corrija, rode de novo e cole a saida que passa; ou',
  '  2. diga que ainda falha, ou o que nao rodou, e por que.',
  '',
  'Teste instavel se corrige ou se remove: rodar de novo ate passar nao e prova.'
];

const MOTIVO_FALHA = [
  'sworn - portao de fecho (trava 3).',
  '',
  'Voce afirmou sucesso, mas o bloco que voce colou mostra falha',
  '(teste falho, exit code diferente de 0, not ok, ERR! ou tempo esgotado).'
].concat(PERGUNTA_FINAL).join('\n');

// O comando citado no motivo: ASCII (R5) e curto.
function citado(comando) {
  const c = String(comando).replace(/\s+/g, ' ').trim().replace(/[^\x20-\x7E]/g, '?');
  return c.length > 120 ? c.slice(0, 117) + '...' : c;
}

function motivoTesteVermelho(comando) {
  return [
    'sworn - portao de fecho (trava 3).',
    '',
    'Voce afirmou sucesso, mas o ultimo teste que rodou nesta sessao falhou:',
    '  ' + citado(comando)
  ].concat(PERGUNTA_FINAL).join('\n');
}

function motivoProvaNaoRodou(prova) {
  return [
    'sworn - portao de fecho (trava 3).',
    '',
    'Voce afirmou sucesso, mas a prova de pronto do projeto nao rodou depois',
    'da ultima edicao de codigo:',
    '  ' + citado(prova),
    '',
    'Rode-a e cole a saida, ou declare que nao rodou e por que.'
  ].join('\n');
}

// R5: ASCII puro. Este texto chega ao Claude, e e o ponto de reinjecao da regra (falha A1).
const MOTIVO = [
  'sworn - portao de fecho (trava 3).',
  '',
  'Voce afirmou sucesso e nao colou evidencia desta rodada.',
  'Faca uma destas duas coisas, e responda de novo:',
  '',
  '  1. cole a saida literal do comando que prova o que voce afirmou,',
  '     dentro de um bloco ``` , com o comando e o resultado; ou',
  '  2. declare explicitamente o que NAO rodou, e por que.',
  '',
  'Falha pre-existente so vale com prova: rodada anterior ao diff, ou',
  'demonstracao de que os arquivos lidos pelo teste nao estao no diff.',
  '',
  'Nao reescreva a frase para escapar do portao. Rode, ou declare.'
].join('\n');

module.exports = { ALEGACOES, NAO_RODOU, semBlocos, analisar, deveBloquear, MOTIVO, blocosDeSaida,
  textoMostraFalha, deveBloquearPorFalha, declaraRessalva, MOTIVO_FALHA, motivoTesteVermelho, motivoProvaNaoRodou };
