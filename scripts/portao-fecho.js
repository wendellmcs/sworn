#!/usr/bin/env node
'use strict';
const io = require('./lib/io.js');
const estado = require('./lib/estado.js');
const evidencia = require('./lib/evidencia.js');
const config = require('./lib/config.js');
const projetoLib = require('./lib/projeto.js');
const saude = require('./lib/saude.js');
const escaladaLib = require('./lib/escalada.js');

function avisoDeAmpliacao(contadores) {
  const n = (contadores && contadores.escopo_ampliado) || 0;
  if (!n) return null;
  // desenho §5: o escape existe, mas fica visivel. O aviso e para o usuario e diz o que fazer: conferir.
  return 'sworn: o escopo foi ampliado ' + n + 'x neste turno (escopo = a lista do que o agente pode editar). ' +
    'Se voce nao pediu isso, confira o que entrou no escopo.md e mande reverter; se pediu, nao precisa fazer nada.';
}

function encerrarTurno(e, s, avisoExtra) {
  const contadores = s.contadores || {};
  const cwd = config.raizDoProjeto(e.cwd);
  estado.descarregar(cwd, contadores);
  const projeto = config.carregarProjeto(cwd);

  // D123: dois baldes. `contadores` e do TURNO - descarregado e depois ZERADO, senao o
  // ledger da D14 conta o mesmo disparo de novo a cada turno (medido: 1 -> 2 -> 3).
  // `contadoresSessao` acumula e so alimenta o gatilho de saude; nunca e descarregado.
  // A conta mora em saude.acumular: o medidor da sessao (Bloco M) le a mesma.
  const acumulados = saude.acumular(s);
  // D445: o tamanho do contexto vem do transcript; sem leitura, fica a ultima gravada (o medidor a mostra).
  const lido = saude.contextoDoTranscript(e.transcript_path);
  const tokensDeContexto = lido !== null ? lido : s.tokensDeContexto;
  // D468: com o modo continuo ligado (padrao; "modoContinuo": false desliga), os gatilhos de continuo.CALADOS nao pedem troca.
  const vs = saude.avaliar(Object.assign({}, s, { contadores: acumulados, tokensDeContexto: tokensDeContexto }), projeto && projeto.limiares,
    require('./lib/continuo.js').ativo(projeto));

  // T10-1: em laco (stop_hook_active) nao se continua a conversa nem se marca o aviso como dado:
  // ele fica pendente para o proximo Stop. Continuar dentro do laco e o que a trava de 8 existe para cortar.
  const avisa = vs.disparou && e.stop_hook_active !== true;
  // D704: com agente de fundo rodando na sessao, a ordem do handoff espera. O aviso de espera sai uma vez (avisouEspera)
  // e o de saude fica pendente (avisouSaude nao marca): sai no primeiro Stop sem agente rodando.
  const rodando = avisa ? saude.agentesRodando(e.transcript_path, Date.now()) : [];
  const entrega = avisa && rodando.length === 0;
  const esperaNova = rodando.length > 0 && s.avisouEspera !== true;

  const partes = [];
  const amp = avisoDeAmpliacao(contadores);
  if (amp) partes.push(amp);
  if (avisoExtra) partes.push(avisoExtra);
  if (entrega) partes.push(vs.aviso);
  if (esperaNova) partes.push(saude.avisoDeSaude(vs.gatilhos, vs.alarme, rodando));

  // O estado do TURNO morre aqui (trabalhoReal, bloqueouNesteTurno, contadores); o da
  // SESSAO sobrevive. Separar os dois e exatamente o que a T18 existe para fazer.
  // Os campos da SESSAO que os outros portoes gravam - avisos de "uma vez por sessao" e
  // registros - moram em `estado.CAMPOS_DA_SESSAO`: fora dela, morriam a cada turno.
  const sessao = function (dados) { estado.gravar(e.session_id, Object.assign(dados, estado.camposDaSessao(s))); };
  // D464: o alarme de tamanho tambem sai uma vez por sessao, e em laco fica pendente como o aviso.
  const avisouAlarme = s.avisouAlarme === true || (entrega && vs.alarme === true);
  // D704: esperando, a espera fica marcada; depois da ordem, zera (a espera de um alarme futuro sai de novo).
  const avisouEspera = rodando.length > 0 || (!entrega && s.avisouEspera === true);
  if (entrega) {
    // Zera o turno mas guarda que ja avisou: o aviso sai uma vez por sessao.
    // Plano 0.9.1: os arquivos tocados e a conta dos portoes seguem, como no outro ramo - o compact os reinjeta, e e
    // perto deste aviso que a conversa costuma compactar.
    sessao({ avisouSaude: true, avisouAlarme: avisouAlarme, avisouEspera: avisouEspera, turnosComTrabalho: s.turnosComTrabalho || 0, gitAbertura: s.gitAbertura || [], arquivosTocados: s.arquivosTocados || [], contadoresSessao: acumulados, tokensDeContexto: tokensDeContexto });
  } else {
    sessao({ turnosComTrabalho: s.turnosComTrabalho || 0, gitAbertura: s.gitAbertura || [], arquivosTocados: s.arquivosTocados || [], contadoresSessao: acumulados, avisouSaude: s.avisouSaude || false, avisouAlarme: avisouAlarme, avisouEspera: avisouEspera, tokensDeContexto: tokensDeContexto });
  }
  if (!partes.length) return io.permitir();
  const saida = { systemMessage: partes.join('\n\n') };
  // T10-1: o systemMessage so o usuario ve. O additionalContext do Stop e o que chega ao modelo
  // e o faz agir (rodar o handoff e colar o prompt na mesma resposta).
  if (entrega) {
    // D412: o turno que gravou o handoff e ja colou o bloco nao recebe a ordem de colar de novo.
    // Mesma regra do portao (handoffSemPrompt, declarada mais abaixo: `function` sobe ao topo do arquivo), sem o projeto: a ordem nao depende do portaoHandoff.
    const jaColado = s.gravouHandoff === true && !handoffSemPrompt(e, s, null);
    saida.hookSpecificOutput = { hookEventName: 'Stop', additionalContext: saude.instrucaoAoModelo(vs.gatilhos, jaColado) };
  } else if (esperaNova) {
    saida.hookSpecificOutput = { hookEventName: 'Stop', additionalContext: saude.instrucaoAoModelo(vs.gatilhos, false, rodando) };
  }
  io.permitir(saida);
}

// PT-01: o numero que a alegacao cita ("A Tarefa 1 esta concluida", "Fechei a etapa 3"). Mesmas duas
// formas do plano.alegaEtapaConcluida, com o numero capturado. L2-fec-1: a regex de la nao e exportada;
// o teste de paridade (test/portao-fecho.test.js) confere as duas contra um corpus. L2-fec-2: o grupo
// captura a LISTA ("1 e 2", "1, 2", "1 e tarefa 2") e `tarefaACobrar` separa os numeros. L2-fec-7: sem
// quantificadores de espaco adjacentes (`\s+(?:a|o)?\s*` fazia backtracking quadratico). N2: plural
// (`s?`, "as"/"os") e auxiliares plurais ("estao", "foram"), como no plano.js.
// D442/8 (S-47, S-48): o id aceita "nº 3", "7b" e "1.2"; ":"/"-"/travessao e "ja" antes do participio; verbo da 2a
// forma so no passado ou participio; na 1a, "complet" so como participio/adjetivo ("completar" nao alega). Quem
// tira o numero e numerosDaAlegacao.
const RE_ALEGA_N = [
  /\b(?:tarefa|etapa|onda|fase)s?\s+((?:n[º°.]\s*)?\d+(?:\.\d+)*(?:[a-z](?![a-z]))?(?:\s*(?:,|e)\s*(?:(?:tarefa|etapa|onda|fase)s?\s+)?(?:n[º°.]\s*)?\d+(?:\.\d+)*(?:[a-z](?![a-z]))?)*)\s*(?:[:\-–—]\s*)?(?:j[aá]\s+)?(?:est[aá] |est[aã]o |foi |foram )?(?:conclu[ií]d|fechad|finalizad|pronta|complet(?:[ao]s?|ad[ao]s?)\b)/gi,
  /\b(?:conclu(?:[ií](?:mos|ram|u|d[ao]s?)?)|(?:fech|finaliz|complet)(?:ei|ou|amos|aram|ad[ao]s?))\s+(?:(?:as|os|a|o)\s*)?(?:tarefa|etapa|onda|fase)s?\s+((?:n[º°.]\s*)?\d+(?:\.\d+)*(?:[a-z](?![a-z]))?(?:\s*(?:,|e)\s*(?:(?:tarefa|etapa|onda|fase)s?\s+)?(?:n[º°.]\s*)?\d+(?:\.\d+)*(?:[a-z](?![a-z]))?)*)/gi,
  // D656: as mesmas duas formas em ingles ("Task 3 is done", "Finished tasks 1 and 2"). "finished",
  // "closed" e "complete(d)" seguidos de objeto sao verbo, nao estado ("Task 3: complete tests", "Phase 2 closed the
  // loop"): seguidos de palavra, so alegam com "and", "now", "in" e afins. A 2a forma nao vale depois de "not"/"n't"/"never".
  /\b(?:task|step|stage|wave|phase)s?\s+(\d+(?:\.\d+)*(?:[a-z](?![a-z]))?(?:\s*(?:,|and)\s*(?:(?:task|step|stage|wave|phase)s?\s+)?\d+(?:\.\d+)*(?:[a-z](?![a-z]))?)*)\s*(?:[:\-–—]\s*)?(?:(?:is|are|was|were|has been|have been) )?(?:already )?(?:done|(?:finished|closed|completed?)(?! (?!(?:and|now|too|already|yet|in|on|at|with|by|for)\b)[a-z]))\b/gi,
  /(?<!\bnot |n['’]t |\bnever )\b(?:completed|finished|closed|wrapped up)\s+(?:the\s+)?(?:task|step|stage|wave|phase)s?\s+(\d+(?:\.\d+)*(?:[a-z](?![a-z]))?(?:\s*(?:,|and)\s*(?:(?:task|step|stage|wave|phase)s?\s+)?\d+(?:\.\d+)*(?:[a-z](?![a-z]))?)*)/gi
];

/** D442/8: os numeros de Tarefa N que a alegacao cita. So o inteiro puro: "7b" e "1.2" nao sao cabecalho
 *  `Tarefa N` que o parser do plano entende - viram alegacao sem numero (cai na tarefa em andamento). */
function numerosDaAlegacao(lista) {
  return (lista.match(/\d+(?:\.\d+)*[a-z]?/gi) || []).filter(function (d) { return /^\d+$/.test(d); })
    .map(function (d) { return parseInt(d, 10); });
}

/** A tarefa do plano que o subitem aberto cobra, na ordem: (1) a que a alegacao cita, se o numero existe
 *  no plano (fechada = alegacao verdadeira, nao cobra); numero inexistente vale como sem numero;
 *  (2) a `tarefa` do plano-ativo.json, se existe no plano (fechada = nao cobra); (3) a primeira com caixa aberta ate a ultima com caixa marcada (a em andamento), inclusive; (4) a primeira
 *  aberta, so se nenhuma tem caixa marcada (nada andou). Nunca "a primeira aberta" quando ha sinal de
 *  qual e a atual: uma tarefa futura nao e subitem pendente de quem fechou a anterior. */
function tarefaACobrar(tarefas, mensagem, ativo) {
  const texto = String(mensagem == null ? '' : mensagem);
  const citadas = [];
  for (const re of RE_ALEGA_N) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(texto)) !== null) numerosDaAlegacao(m[1]).forEach(function (n) { citadas.push(n); });
  }
  const alvo = function (n) { return tarefas.filter(function (t) { return t.n === n; })[0]; };
  const comAberto = function (t) { return t && t.abertos > 0 ? t : undefined; };
  const existentes = citadas.filter(alvo);
  // numero que nao existe no plano nao se confere (ex.: "etapa 7" de outro plano): se NENHUM existe,
  // a alegacao vale como sem numero e segue para as regras abaixo; se algum existe e esta fechado, a
  // alegacao e verdadeira e nao se cobra nada.
  if (existentes.length) return existentes.map(alvo).filter(comAberto)[0];
  const atual = ativo && ativo.tarefa !== null && ativo.tarefa !== undefined ? parseInt(ativo.tarefa, 10) : NaN;
  if (!isNaN(atual) && alvo(atual)) return comAberto(alvo(atual));
  const andamento = tarefas.filter(function (t) { return t.total - t.abertos > 0; }).pop();
  if (andamento) return tarefas.filter(function (t) { return t.n <= andamento.n && t.abertos > 0; })[0];
  return tarefas.filter(function (t) { return t.abertos > 0; })[0];
}

/** D412: handoff gravado neste turno e a resposta final sem bloco de codigo. D415: so
 *  `"portaoHandoff": false` no projeto.json desliga - independente de `travas.fecho`. */
function handoffSemPrompt(e, s, projeto) {
  if (s.gravouHandoff !== true) return false;
  if (projeto && projeto.portaoHandoff === false) return false;
  return !saude.temBlocoDeCodigo(e.last_assistant_message);
}

// D503 (plano d503, Tarefa 5): no maximo tantos arquivos citados no motivo; o resto vira "+N".
const MAX_CITADOS = 5;

/** D503 (plano d503, Tarefa 5): o motivo quando a resposta alega entrega, um arquivo mudado na sessao resolve para
 *  `aaa`, o tipo dele tem referencia de topo declarada (`marcha.aaaComReferencia`) e nenhuma revisao contra a
 *  referencia fechou na sessao (o balde que o apurar-ronda.js grava). Sem isso, null. So `"portaoReferencia": false`
 *  desliga: chave propria, como o portaoHandoff (D415), e `travas.fecho` nao a desliga. Custo zero: o estado e o
 *  projeto ja estao lidos, nada vai ao disco. R5: ASCII, o texto chega ao Claude. */
function semRevisaoDeReferencia(e, s, projeto, cwd) {
  if (!projeto || projeto.portaoReferencia === false) return null;
  if (!evidencia.analisar(e.last_assistant_message).alegaSucesso) return null;
  if ((saude.acumular(s).revisao_referencia_fechada || 0) > 0) return null;
  const arquivos = require('./lib/marcha.js').aaaComReferencia(s.arquivosTocados, projeto, cwd);
  if (!arquivos.length) return null;
  // Plano 082, Tarefa 5 (mock S10; p7-18, p7-29, p7-30): o que falta em palavras do dono, um caminho por linha entre
  // aspas (com espaco ficava ambiguo na lista por virgula; fora de ASCII vira "?", R5), e a saida quando nao fecha.
  // "aprovado" e o que o apurar-ronda.js escreve no fecho ("duas rondas secas seguidas: aprovado").
  const ascii = require('./lib/escopo.js').ascii;
  const citados = arquivos.slice(0, MAX_CITADOS).map(function (a) { return '  - "' + ascii(a) + '"'; });
  if (arquivos.length > MAX_CITADOS) citados.push('  - e mais ' + (arquivos.length - MAX_CITADOS));
  return [
    'sworn - falta comparar com a tela de referencia.',
    '',
    'Voce disse que entregou, e mudou arquivo que o projeto manda comparar com uma',
    'tela de referencia (lista "referencias" em .claude/sworn/projeto.json):'
  ].concat(citados, [
    'Nenhuma dessas comparacoes fechou nesta sessao.',
    '',
    'Faca uma destas:',
    '  1. rode /sworn:review "<arquivo>" para cada um, ate sair "aprovado";',
    '  2. se chegar a 3 rondas sem fechar, pare e leve ao usuario 3 opcoes;',
    '  3. ou diga ao usuario por que esta entrega fica sem a comparacao.',
    '',
    'Desligar neste projeto: "portaoReferencia": false em .claude/sworn/projeto.json.'
  ]).join('\n');
}

/** D655 (plano pedidos-aaa-idioma-readme, T1): o motivo quando a resposta alega entrega e um arquivo mudado na sessao
 *  resolve para `aaa` sem revisao aprovada (`marcha.aaaSemRevisao`, o que o portao do commit aceita), com ou sem
 *  referencia. `jaCobrados` sao os que o motivo da referencia ja cita no turno: nao saem duas vezes. Declarar a
 *  entrega sem revisao (`evidencia.declaraSemRevisao`) libera. So `"portaoRevisao": false` desliga, como o
 *  portaoReferencia. Texto ao modelo em ingles (D656), ASCII (R5). */
function semRevisaoAprovada(e, s, projeto, cwd, jaCobrados) {
  if (!projeto || projeto.portaoRevisao === false) return null;
  const msg = e.last_assistant_message;
  if (!evidencia.analisar(msg).alegaSucesso || evidencia.declaraSemRevisao(msg)) return null;
  const arquivos = require('./lib/marcha.js').aaaSemRevisao(s.arquivosTocados, s.revisadosAprovados, projeto, cwd)
    .filter(function (a) { return jaCobrados.indexOf(a) === -1; });
  if (!arquivos.length) return null;
  const ascii = require('./lib/escopo.js').ascii;
  const citados = arquivos.slice(0, MAX_CITADOS).map(function (a) { return '  - "' + ascii(a) + '"'; });
  if (arquivos.length > MAX_CITADOS) citados.push('  - and ' + (arquivos.length - MAX_CITADOS) + ' more');
  return [
    'sworn - the review is missing on a strictest-rigor file.',
    '',
    'You said the work is done, and you changed files that this project puts in the',
    'strictest rigor level (list "marchas.aaa" in .claude/sworn/projeto.json) with no',
    'approved review in this session:'
  ].concat(citados, [
    '',
    'Do one of these:',
    '  1. run /sworn:review "<file>" for each one, until it says "aprovado";',
    '  2. if 3 rounds pass without approval, stop and ask the user to pick one of',
    '     3 options: fix and recheck once, deliver "without review" with the',
    '     reason, or run a new full review;',
    '  3. or tell the user why this delivery goes "without review" (those words',
    '     in your answer release this check).',
    '',
    'Turn off in this project: "portaoRevisao": false in .claude/sworn/projeto.json.'
  ]).join('\n');
}

/** D634: o motivo quando a prova existe mas o resultado dela nao sustenta a alegacao - o bloco colado mostra falha
 *  (7a), o ultimo teste rodado na sessao falhou (7b) ou a provaDePronto nao rodou depois da ultima edicao de codigo
 *  (8). Declarar o que nao rodou, ou que a falha segue, sempre libera. O transcript so e lido quando ha alegacao. */
function motivoDoResultado(e, projeto) {
  const msg = e.last_assistant_message;
  if (evidencia.deveBloquearPorFalha(msg)) return evidencia.MOTIVO_FALHA;
  if (!evidencia.analisar(msg).alegaSucesso || evidencia.declaraRessalva(msg)) return null;
  const t = saude.testesDoTranscript(e.transcript_path, projeto && projeto.provaDePronto);
  if (!t) return null;
  if (t.ultimoTeste && t.ultimoTeste.falhou) return evidencia.motivoTesteVermelho(t.ultimoTeste.comando);
  if (t.provaPendente) return evidencia.motivoProvaNaoRodou(projeto.provaDePronto);
  return null;
}

/** Um bloqueio por turno, com os motivos que o turno juntou - o do subitem aberto OU o da
 *  evidencia (o subitem sai antes de a evidencia ser olhada), mais o do handoff: o segundo Stop
 *  chega com stop_hook_active e libera, e um motivo deixado para depois nunca seria cobrado.
 *  Soma o balde do handoff, marca o bloqueio do turno, grava o estado e barra; nao muda `motivos`. */
function barrar(e, s, motivos, semPrompt) {
  const todos = semPrompt ? motivos.concat([saude.MOTIVO_HANDOFF_SEM_PROMPT]) : motivos;
  s.contadores = s.contadores || {};
  if (semPrompt) s.contadores.handoff_sem_prompt = (s.contadores.handoff_sem_prompt || 0) + 1;
  s.bloqueouNesteTurno = true;
  estado.gravar(e.session_id, s);
  io.bloquearFecho(todos.join('\n\n'));
}

io.blindar(function () {
  io.lerEntrada(function (e) {
    const s = estado.ler(e.session_id);

    // Ja bloqueou neste turno, ou o harness avisa que estamos em laco: encerra.
    if (s.bloqueouNesteTurno || e.stop_hook_active === true) return encerrarTurno(e, s);

    // D694 (T3 da escada): o pedido de escalada sem despacho entra no bloqueio do turno com ou sem trabalho e com a
    // trava 3 desligada (e da escada de agentes, a trava 6). Cobrado uma vez: sai da sessao aqui (lib/escalada.js).
    const daEscalada = escaladaLib.motivoDoFecho(s);
    if (daEscalada) {
      s.escalada = escaladaLib.semPendentes(s);
      s.contadores = s.contadores || {};
      s.contadores.escalada_sem_despacho = (s.contadores.escalada_sem_despacho || 0) + 1;
    }
    const motivosDaEscalada = daEscalada ? [daEscalada] : [];

    // Nao houve trabalho real: conversa passa direto. Custo zero.
    if (!s.trabalhoReal) return motivosDaEscalada.length ? barrar(e, s, motivosDaEscalada, false) : io.permitir();

    // X2b: o dono desligou a cobranca de evidencia - NAO o ledger. encerrarTurno
    // e o UNICO chamador de estado.descarregar (unico escritor de
    // contadores.json) e o unico lugar que zera o estado do TURNO. Um io.permitir()
    // aqui desligaria a medicao do plugin inteiro e congelaria bloqueouNesteTurno.
    // Excecao (D415): `travas.fecho: false` nao desliga o portao do prompt do handoff - so
    // `"portaoHandoff": false` desliga. Por isso o semPrompt e calculado antes do retorno.
    // Custo declarado (P2-38): o Stop le o projeto.json aqui e, quando termina em encerrarTurno,
    // de novo la - duas leituras de disco no mesmo Stop.
    const cwd = config.raizDoProjeto(e.cwd);
    const projeto = config.carregarProjeto(cwd);
    const travas = projetoLib.travasDe(projeto);
    const semPrompt = handoffSemPrompt(e, s, projeto);
    // D503: como o do handoff, calculado antes do retorno da trava 3 desligada; todo caminho abaixo com ele barra.
    const semReferencia = semRevisaoDeReferencia(e, s, projeto, cwd);
    // D655: o da revisao aprovada, calculado aqui pelo mesmo motivo, sem repetir os arquivos que o da referencia ja cita.
    const semRevisao = semRevisaoAprovada(e, s, projeto, cwd,
      semReferencia ? require('./lib/marcha.js').aaaComReferencia(s.arquivosTocados, projeto, cwd) : []);
    // Plano 082 (p7-25) e D655: os motivos de revisao que faltam (o da referencia e, depois dele, o da revisao aprovada)
    // entram so por aqui, e sempre depois dos outros do turno (o do handoff, o barrar soma no fim).
    const daRevisao = (semReferencia ? [semReferencia] : []).concat(semRevisao ? [semRevisao] : []);
    if (semReferencia) {
      s.contadores = s.contadores || {};
      s.contadores.fecho_sem_referencia = (s.contadores.fecho_sem_referencia || 0) + 1;
    }
    if (semRevisao) {
      s.contadores = s.contadores || {};
      s.contadores.fecho_sem_revisao = (s.contadores.fecho_sem_revisao || 0) + 1;
    }
    // A escalada antes dos da revisao, que seguem depois dos outros motivos do turno.
    const doTurno = motivosDaEscalada.concat(daRevisao);
    if (travas.fecho === false) return doTurno.length || semPrompt ? barrar(e, s, doTurno, semPrompt) : encerrarTurno(e, s);

    const planoLib = require('./lib/plano.js');
    const ativo = planoLib.lerAtivo(cwd);
    let planoIlegivel = null;
    if (ativo && planoLib.alegaEtapaConcluida(e.last_assistant_message)) {
      let tarefas = [];
      // Plano 082 (p7-5): caminhoDoPlano, como a faixa e o painel - o absoluto do --abrir se le.
      try { tarefas = planoLib.parseTarefas(require('node:fs').readFileSync(planoLib.caminhoDoPlano(cwd, ativo.arquivo), 'utf8')); }
      catch (err) {
        // S52-fec-1: plano ilegivel nao barra, mas tambem nao passa calado.
        tarefas = [];
        planoIlegivel = 'sworn: o plano ativo (' + String(ativo.arquivo) + ') nao pode ser lido; a alegacao de etapa concluida passou sem conferir os subitens.';
      }
      const aberta = tarefaACobrar(tarefas, e.last_assistant_message, ativo);
      if (aberta) {
        s.contadores = s.contadores || {};
        s.contadores.subitem_pendente = (s.contadores.subitem_pendente || 0) + 1;
        return barrar(e, s, [planoLib.motivoSubitemAberto(aberta)].concat(doTurno), semPrompt);
      }
    }

    const semEvidencia = evidencia.deveBloquear(e.last_assistant_message);
    // D634: se a falta de bloco nao barrou, o resultado da prova; conta no mesmo balde (a evidencia nao sustenta a alegacao).
    const semResultado = semEvidencia ? null : motivoDoResultado(e, projeto);
    if (!semEvidencia && !semResultado && !semPrompt && !doTurno.length) return encerrarTurno(e, s, planoIlegivel);

    const motivos = [];
    if (planoIlegivel) motivos.push(planoIlegivel);
    if (semEvidencia || semResultado) {
      s.contadores = s.contadores || {};
      s.contadores.fecho_sem_evidencia = (s.contadores.fecho_sem_evidencia || 0) + 1;
      motivos.push(semEvidencia ? evidencia.MOTIVO : semResultado);
    }
    barrar(e, s, motivos.concat(doTurno), semPrompt);
  });
});
