'use strict';

// Alegacao de sucesso. Testada FORA dos blocos de codigo, para nao pegar string de codigo.
const ALEGACOES = [
  /\bpronto\b/i, /\bconclu[ií]d[oa]s?\b/i, /\bfuncionando\b/i, /\bfunciona\b/i,
  /\bpassou\b/i, /\bpassaram\b/i, /\btestes? ok\b/i, /\btudo ok\b/i,
  /\bcorrigid[oa]s?\b/i, /\bresolvid[oa]s?\b/i, /\bimplementad[oa]s?\b/i,
  /\btudo cert[oa]\b/i, /\bdeu cert[oa]\b/i, /\bsem erros?\b/i, /\bverde\b/i,
  /\ball tests? (pass|passed|passing)/i, /\bworks? now\b/i, /\bfixed\b/i, /\bdone\b/i,
  // D656: os equivalentes em ingles. Palavra que tambem descreve sem alegar ("passed to", "how it works", "green
  // button") so com o sujeito ou a forma que alega; o corpus de falso positivo esta no teste.
  /\b(?:tests?|suite|checks?|build|ci|specs?|everything) (?:now |all )?(?:pass|passes|passed)\b/i,
  /(?<!\bhow )\bit works\b/i, /\b(?:is|are|it['’]s) (?:now )?working\b/i,
  // D659: "implemented", "resolved" e "completed" so alegam abrindo a frase (ou depois de I/we) ou fechando-a; "is
  // ready" so fechando. Seguindo a descrever ("completed in 2s", "ready to accept") nao alegam. Abrir a frase inclui
  // item de lista ("- ", "1. ") e negrito; depois de I/we cabe um advérbio em -ly ("I successfully implemented").
  /(?<=(?:^|[.!?;:\n])\s*(?:(?:[-*+•]|\d+[.)])\s+)?(?:\*\*|__)?|\b(?:I|we)(?:['’]ve| have)? (?:[a-z]+ly )?)\b(?:implemented|resolved|completed)\b/i,
  /\b(?:implemented|resolved|completed)(?=[ \t]*(?:[.,;:!?)\r\n]|$)|\s+(?:and|now|too|already|successfully)\b)/i,
  /\ball (?:set|good)\b/i, /\b(?:it|that|this) worked\b/i, /\b(?:without|zero) errors?\b/i,
  /\bno (?:more )?errors? (?:left|now|remain)/i, /\b(?:is|are|all|now|back to) green\b/i,
  /\b(?:is|are|it['’]s) ready(?=[ \t]*(?:[.,;:!?)\r\n]|$)|\s+(?:and|now|too|already)\b)/i
];

// s311: a frase negada nao alega quando o que ela nega vem entre aspas ("nao afirmo que 'tudo verde'"): e mencao,
// nao uso. Sai so a citacao, que nao atravessa fim de frase; o resto segue testado. Sem aspas a frase segue alegando,
// do lado seguro: o fim do complemento sem aspas dependia de uma lista de conectivos que sempre deixava um de fora.
// A aspa seguida de letra e apostrofo ("it's", "it’s"): fica dentro da citacao e nunca a fecha.
const LETRA = '[A-Za-zÀ-ÿ]';
function citacao(abre, fecha) {
  return abre + '(?:[^' + fecha + '\\n.!?]|[.!?](?!\\s)|' + fecha + '(?=' + LETRA + '))*' + fecha + '(?!' + LETRA + ')';
}
const COMPLEMENTO = '\\s+(?:' + [citacao('"', '"'), citacao('“', '”'), citacao("'", "'"), citacao('‘', '’')].join('|') +
  ')';
const NEGADAS = [
  new RegExp('\\bn[ãa]o (?:afirmo|digo|garanto|(?:posso|vou|consigo) (?:afirmar|dizer|garantir)) que' + COMPLEMENTO,
    'gi'),
  new RegExp('\\b(?:can(?:not|[\'’]t)|won[\'’]t|will not|do(?: not|n[\'’]t)) (?:claim|say|confirm|guarantee)' +
    '(?: that)?' + COMPLEMENTO, 'gi')
];

function semNegadas(prosa) {
  return NEGADAS.reduce(function (t, r) { return t.replace(r, ' '); }, prosa);
}

// s287 (D759): a ressalva nova so vale fechando a frase. Depois da virgula ou dos dois-pontos pode vir a alegacao
// ("nenhum teste executado, todos passaram"), e o participio solto e adjetivo em "nenhum teste rodado reprovou".
const FECHA_FRASE = '(?: (?:ainda|at[eé] agora|n?esta sess[aã]o))?[\\s)*"”\']*(?:[.!?\\n]|$)';

// Declaracao explicita do que NAO rodou. Vale como evidencia honesta.
const NAO_RODOU = [
  /n[ãa]o rodei/i, /n[ãa]o executei/i, /n[ãa]o rod(ou|aram)/i, /n[ãa]o testei/i,
  /n[ãa]o foi testad/i, /n[ãa]o testad[oa]/i, /falta rodar/i, /falta testar/i,
  /declaro que n[ãa]o/i, /n[ãa]o consegui (rodar|executar|verificar|testar|reproduzir)/i,
  /n[ãa]o verifiqu/i, /not (run|tested|verified)/i,
  // s286 (Etapa 5): "nenhum teste rodou" barrava a resposta honesta. So com o verbo de rodar: "nenhum teste
  // falhou" alega.
  new RegExp('\\bnenhum (?:dos )?testes? (?:rodou|rodaram|(?:foi |foram )?(?:rodad|executad)[oa]s?)' + FECHA_FRASE,
    'i'),
  new RegExp('n[ãa]o (?:foi|foram) (?:rodad|executad)[oa]s?' + FECHA_FRASE, 'i'),
  // D656: os equivalentes em ingles. "you need to run" e instrucao ao usuario, nao ressalva: so "still need".
  /\b(?:did|have|has|was|were)(?: not|n['’]t) (?:yet )?(?:been )?(?:run|ran|execut|test|verif)/i, /\buntested\b/i,
  /\b(?:could not|couldn['’]t|(?:was|were)(?: not|n['’]t) able to|unable to) (?:run|execute|verify|test|reproduce)/i,
  /\bstill (?:needs?|has|have) to (?:be )?(?:run|test|verif)/i, /\byet to be (?:run|tested|verified)/i
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

// A entrada vira texto: null e undefined dao '' (String(null) daria "null").
function comoTexto(v) {
  return String(v == null ? '' : v);
}

function semBlocos(texto) {
  return comoTexto(texto).replace(/```[\s\S]*?```/g, ' ');
}

function analisar(texto) {
  const bruto = comoTexto(texto);
  const prosa = semBlocos(bruto);
  const alegavel = semNegadas(prosa);
  return {
    alegaSucesso: ALEGACOES.some(function (r) { return r.test(alegavel); }),
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
  // D656: "was still failing" e a causa contada, como "ainda falhava"; "keeps failing", "continues to fail" e "still red"
  // sao o "continua falhando".
  /(?<!\b(?:was|were) )\bstill fail/i, /(?:is|are) (?:still )?failing/i, /\bkeeps? failing\b/i, /\bcontinues? to fail\b/i,
  /\bstill (?:broken|red)\b/i
];

function textoMostraFalha(texto) {
  const t = comoTexto(texto);
  if (FALHA_NA_SAIDA.some(function (r) { return r.test(t); })) return true;
  return !RESUMO_SEM_FALHA.some(function (r) { return r.test(t); }) && FALHA_SOLTA.some(function (r) { return r.test(t); });
}

/** D634 (7b/8): a prosa diz o que nao rodou ou que a falha segue - a saida sempre aberta do portao. */
function declaraRessalva(texto) {
  const prosa = semBlocos(texto);
  return NAO_RODOU.concat(AINDA_FALHA).some(function (r) { return r.test(prosa); });
}

// D655: a prosa declara que a entrega fica sem revisao - a saida aberta do portao da revisao na marcha AAA (fecho).
const SEM_REVISAO = [
  /\bsem (?:a |uma )?revis[aã]o\b/i, /n[aã]o (?:rodei|fiz|passei por|passou por) (?:a |uma )?revis[aã]o/i,
  /\bwithout (?:a |the |any )?(?:blind )?review/i, /\bskipp(?:ed|ing) (?:the )?(?:blind )?review/i,
  /\breview (?:was |is )?(?:not run|not done|skipped)/i,
  /\bno (?:blind )?review\b(?!\s+(?:finding|issue|comment|note)s?\b)/i
];

/** D655: a declaracao de entrega sem revisao, fora dos blocos de codigo, em portugues ou ingles. */
function declaraSemRevisao(texto) {
  const prosa = semBlocos(texto);
  return SEM_REVISAO.some(function (r) { return r.test(prosa); });
}

/**
 * D634 (7a): a decisao do portao, como deveBloquear (nao um teste do texto): barra quando a prosa alega sucesso, ha
 * bloco de saida, todo bloco mostra falha e a prosa nao traz ressalva. Sem alegacao, false mesmo com bloco vermelho.
 */
function deveBloquearPorFalha(texto) {
  const bruto = comoTexto(texto);
  const a = analisar(bruto);
  if (!a.alegaSucesso || !a.temBloco || declaraRessalva(bruto)) return false;
  return blocosDeSaida(bruto).every(textoMostraFalha);
}

const PERGUNTA_FINAL = [
  '',
  'Faca uma destas, e responda de novo:',
  '  1. corrija, rode de novo e cole a saida que passa; ou',
  '  2. diga que ainda falha, ou o que nao rodou, e por que.',
  '     In English: say it "still fails", or what you "did not run", and why.',
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
  const c = comoTexto(comando).replace(/\s+/g, ' ').trim().replace(/[^\x20-\x7E]/g, '?');
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

// D785 (2.1): as voltas do laco da prova que mandam consertar; a seguinte manda escalar, e dali em diante o portao
// libera.
const TETO_DO_LACO = 3;

/** D785 (s328): a saida do teste mostra `spawn EPERM`: o sandbox (o do Codex, medido na leva 7) barrou o processo
 *  filho que o executor de testes abre, e nao o codigo. */
function saidaBarradaPeloSandbox(texto) {
  return /\bspawn EPERM\b/.test(comoTexto(texto));
}

/** D785 (2.1): o motivo da volta `n` do laco da prova (`tipo` 'vermelho' ou 'pendente'). A ressalva nao e saida: ate o
 *  teto, rodar e consertar; na volta seguinte, escalar e, se seguir falhando, fechar com o que falha. Com `sandbox`
 *  (a saida mostrou spawn EPERM), manda a prova sem processo filho. ASCII (R5). */
function motivoDoLaco(tipo, comando, n, sandbox) {
  const oQue = [tipo === 'vermelho' ? 'O ultimo teste que rodou nesta sessao falhou:'
    : 'A prova de pronto do projeto nao rodou depois da ultima edicao de codigo:', '  ' + citado(comando), ''];
  if (sandbox === true) {
    oQue.push('A saida mostra spawn EPERM: o sandbox barrou o processo filho que o executor de testes',
      'abre, nao o codigo. Rode a prova com node --test --test-isolation=none no lugar de node --test',
      '(os arquivos de teste no mesmo processo; se o node recusar a opcao, --experimental-test-isolation=none)',
      'e conserte o que falhar depois disso.', '');
  }
  if (n <= TETO_DO_LACO) {
    return ['sworn - portao de fecho (trava 3), laco da prova (' + n + ' de ' + TETO_DO_LACO + ').', ''].concat(oQue, [
      'Sem perguntar ao usuario: rode a prova, conserte o que falhar e rode de novo,',
      'ate passar. Depois cole a saida que passa, dentro de um bloco ``` .',
      'Teste instavel se corrige ou se remove: rodar de novo ate passar nao e prova.'
    ]).join('\n');
  }
  const titulo = 'sworn - portao de fecho (trava 3), laco da prova: ' + TETO_DO_LACO + ' voltas sem passar.';
  return [titulo, ''].concat(oQue, [
    'Sem perguntar ao usuario: escale. Despache o agente acima na escada',
    '(agentes.escada em .claude/sworn/projeto.json; sem escada, o modelo mais forte',
    'que houver) com esforco alto, com a tarefa, a saida da prova e o que ja tentou.',
    'Depois rode a prova de novo.',
    'Se mesmo assim ela segue falhando, feche dizendo o que segue falhando, com a',
    'saida da prova num bloco ``` . Nao pergunte ao usuario o que fazer.'
  ]).join('\n');
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
  textoMostraFalha, deveBloquearPorFalha, declaraRessalva, declaraSemRevisao, MOTIVO_FALHA, motivoTesteVermelho,
  motivoProvaNaoRodou, TETO_DO_LACO, motivoDoLaco, saidaBarradaPeloSandbox };
