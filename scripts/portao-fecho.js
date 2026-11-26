#!/usr/bin/env node
'use strict';
const io = require('./lib/io.js');
const estado = require('./lib/estado.js');
const evidencia = require('./lib/evidencia.js');
const config = require('./lib/config.js');
const projetoLib = require('./lib/projeto.js');
const saude = require('./lib/saude.js');
const escaladaLib = require('./lib/escalada.js');
const entregaLib = require('./lib/entrega-pedida.js');
const provaNoFecho = require('./lib/prova-no-fecho.js');

function avisoDeAmpliacao(contadores) {
  const n = (contadores && contadores.escopo_ampliado) || 0;
  if (!n) return null;
  // desenho §5: o escape existe, mas fica visivel. O aviso e para o usuario e diz o que fazer: conferir.
  return 'sworn: o escopo foi ampliado ' + n + 'x neste turno (escopo = a lista do que o agente pode editar). ' +
    'Se voce nao pediu isso, confira o que entrou no escopo.md e mande reverter; se pediu, nao precisa fazer nada.';
}

/**
 * s366 (F11, qw11: depois da compactacao o luna parou na negacao do write_file e o Stop deixou): so os portoes do
 * Write/Edit e do shell liam a ordem do compact, e a conversa compactada fica abaixo do gatilho de saude. Com a ordem
 * pendente, o Stop a leva ao modelo (o texto da compactacao, reinjecao.ordemDoHandoff) e soma uma negacao no mesmo teto
 * dos portoes (reinjecao.cobrarOrdem); no teto a ordem cai e o Stop passa. Em laco fica para o proximo Stop, como o
 * aviso de saude (T10-1 e s359). Muda o `s`, nao grava: quem chama grava (no encerrarTurno, o sessao() carrega a
 * ordemDoCompact pelo camposDaSessao).
 */
function cobrancaDaOrdem(e, s) {
  const ordem = s.ordemDoCompact;
  if (!ordem || typeof ordem !== 'object') return null;
  if (e.stop_hook_active === true && s.bloqueouNesteTurno !== true) return null;
  const reinjecao = require('./lib/reinjecao.js');
  const negadas = Number(ordem.negadas) || 0;
  if (negadas >= reinjecao.NEGACOES_DA_ORDEM) { delete s.ordemDoCompact; return null; }
  const texto = reinjecao.ordemDoHandoff(config.raizDoProjeto(e.cwd), s);
  if (!texto) return null;
  ordem.negadas = negadas + 1;
  return texto;
}

const AVISO_DA_ORDEM = 'sworn: a ordem do handoff dada na compactacao ainda nao foi cumprida; o modelo foi ' +
  'lembrado de cumpri-la antes de parar.';

// B3 (s369, R-dsh): os baldes do estado tipado do fecho e das perguntas ao dono por classe. So contam (nunca barram):
// escritos por extenso, um por nome, para o leitor de baldes (test/auxiliar-baldes.js) achar cada um.
const CONTAR_ESTADO = {
  pronto: function (contadores) { contadores.fecho_pronto = (contadores.fecho_pronto || 0) + 1; },
  esperando: function (contadores) { contadores.fecho_esperando = (contadores.fecho_esperando || 0) + 1; },
  bloqueado: function (contadores) { contadores.fecho_bloqueado = (contadores.fecho_bloqueado || 0) + 1; },
  falhou: function (contadores) { contadores.fecho_falhou = (contadores.fecho_falhou || 0) + 1; }
};
const CONTAR_PERGUNTA = {
  regra_de_negocio: function (contadores) {
    contadores.pergunta_regra_de_negocio = (contadores.pergunta_regra_de_negocio || 0) + 1;
  },
  aparencia: function (contadores) { contadores.pergunta_aparencia = (contadores.pergunta_aparencia || 0) + 1; },
  externo: function (contadores) { contadores.pergunta_externo = (contadores.pergunta_externo || 0) + 1; },
  credencial: function (contadores) { contadores.pergunta_credencial = (contadores.pergunta_credencial || 0) + 1; },
  // a pergunta fora das 4 classes da D785 e a falha medida: o laco devia ter decidido sozinho
  fora: function (contadores) {
    contadores.pergunta_fora_da_classe = (contadores.pergunta_fora_da_classe || 0) + 1;
  }
};
const PEDE_DONO = /^[ \t>*_-]*(?:preciso do dono|need the owner)[ \t]*:(.*)$/gim;
const ESPERA_DECLARADA = /^[ \t>*_-]*(?:espero|waiting on)[ \t]*:/im;

/** B3: conta, no turno que encerra, o estado do fecho (continuo.estadoDoFecho) e cada pedido ao dono pela classe. O
 *  transcript so e lido quando ha alegacao de pronto (a mesma conta da trava 3). Subagente nao conta. */
function contarFecho(e, s, projeto, cwd) {
  if (e.agent_id) return;
  const continuo = require('./lib/continuo.js');
  const msg = String(e.last_assistant_message || '');
  // o pedido de verdade e o do texto corrido (o colado num bloco de codigo ou citado nao conta) e tem texto
  const pedidos = Array.from(continuo.textoCorrido(msg).matchAll(PEDE_DONO), function (m) { return m[1].trim(); })
    .filter(Boolean);
  const alega = evidencia.analisar(msg).alegaSucesso;
  const prova = provaDe(projeto);
  // D794: a mesma leitura do transcript do resto do fecho, vista com a prova que o gancho rodou
  const teste = alega && prova ? comProvaDoGancho(e, s, lerTranscript(e, prova, projeto), prova) : null;
  const estadoDoFecho = continuo.estadoDoFecho({ pedeDono: pedidos.length > 0, espera: ESPERA_DECLARADA.test(msg),
    alegaSucesso: alega, comEvidencia: alega && !evidencia.deveBloquear(msg),
    mostraFalha: evidencia.deveBloquearPorFalha(msg), teste: teste });
  s.contadores = s.contadores || {};
  if (estadoDoFecho) CONTAR_ESTADO[estadoDoFecho](s.contadores);
  for (const p of pedidos) CONTAR_PERGUNTA[continuo.classeDaPergunta(p) || 'fora'](s.contadores);
  // B4 (s369, R-superpowers): cada decisao autonoma registrada; a sem o "custo se errado" e a falha medida
  for (const completa of continuo.decisoesDaResposta(msg)) {
    s.contadores.decisao_autonoma = (s.contadores.decisao_autonoma || 0) + 1;
    if (!completa) s.contadores.decisao_sem_custo = (s.contadores.decisao_sem_custo || 0) + 1;
  }
}

function encerrarTurno(e, s, avisoExtra) {
  const cwd = config.raizDoProjeto(e.cwd);
  const projeto = config.carregarProjeto(cwd);
  // D420: o balde e acessorio e nunca impede o fecho; a falha deixa uma linha no stderr, nao some calada
  try { contarFecho(e, s, projeto, cwd); } catch (err) {
    process.stderr.write('sworn: o estado do fecho deste turno nao foi contado (' +
      require('./lib/escopo.js').ascii(require('./lib/texto.js').causaDoErro(err)).slice(0, 120) + ').\n');
  }
  const contadores = s.contadores || {};
  estado.descarregar(cwd, contadores);

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
  // s359 (F3): menos o laco que o proprio fecho causou (bloqueouNesteTurno): o barrar nao leva a ordem, e o proximo
  // Stop pode nao vir (o turno acaba). Sai uma vez: a ordem marca avisouSaude e o bloqueio do turno morre aqui.
  const avisa = vs.disparou && (e.stop_hook_active !== true || s.bloqueouNesteTurno === true);
  // D704: com agente de fundo rodando na sessao, a ordem do handoff espera. O aviso de espera sai uma vez (avisouEspera)
  // e o de saude fica pendente (avisouSaude nao marca): sai no primeiro Stop sem agente rodando.
  const rodando = avisa ? saude.agentesRodando(e.transcript_path, Date.now()) : [];
  const entrega = avisa && rodando.length === 0;
  const esperaNova = rodando.length > 0 && s.avisouEspera !== true;
  // s366 (F11): a ordem do compact pendente, quando o aviso de saude nao sai agora (ele ja leva a ordem do handoff).
  const daOrdem = entrega || esperaNova ? null : cobrancaDaOrdem(e, s);

  const partes = [];
  const amp = avisoDeAmpliacao(contadores);
  if (amp) partes.push(amp);
  if (avisoExtra) partes.push(avisoExtra);
  if (promptAoDono) partes.push(promptAoDono);
  if (entrega) partes.push(vs.aviso);
  if (esperaNova) partes.push(saude.avisoDeSaude(vs.gatilhos, vs.alarme, rodando));
  if (daOrdem) partes.push(AVISO_DA_ORDEM);
  // F3d (D828): com agente de fundo rodando, a linha de situacao ao dono (so a ele: nao continua a conversa). A espera
  // nova ja diz quais agentes rodam.
  const fundo = rodando.length ? rodando : saude.agentesRodando(e.transcript_path, Date.now());
  if (fundo.length && !esperaNova) {
    let doPlano = '';
    // fail-open: so perde a linha de situacao
    try { doPlano = require('./lib/plano.js').linhaDoPlanoDaSessao(cwd, s.frente); } catch (err) { doPlano = ''; }
    partes.push(saude.linhaDeSituacao(fundo, doPlano));
  }

  // O estado do TURNO morre aqui (trabalhoReal, bloqueouNesteTurno, contadores); o da
  // SESSAO sobrevive. Separar os dois e exatamente o que a T18 existe para fazer.
  // Os campos da SESSAO que os outros portoes gravam - avisos de "uma vez por sessao" e
  // registros - moram em `estado.CAMPOS_DA_SESSAO`: fora dela, morriam a cada turno.
  // A5-02: a foto que falhou (sem gitAbertura) segue sem foto, e a proxima abertura (compact, resume) tenta de novo;
  // o `|| []` a gravava como arvore limpa, e a trava de outra frente ficava muda pelo resto da sessao
  const fotoDaAbertura = Array.isArray(s.gitAbertura) ? s.gitAbertura : undefined;
  const sessao = function (dados) { estado.gravar(e.session_id, Object.assign(dados, estado.camposDaSessao(s))); };
  // D464: o alarme de tamanho tambem sai uma vez por sessao, e em laco fica pendente como o aviso.
  const avisouAlarme = s.avisouAlarme === true || (entrega && vs.alarme === true);
  // D704: esperando, a espera fica marcada; depois da ordem, zera (a espera de um alarme futuro sai de novo).
  const avisouEspera = rodando.length > 0 || (!entrega && s.avisouEspera === true);
  if (entrega) {
    // Zera o turno mas guarda que ja avisou: o aviso sai uma vez por sessao.
    // Plano 0.9.1: os arquivos tocados e a conta dos portoes seguem, como no outro ramo - o compact os reinjeta, e e
    // perto deste aviso que a conversa costuma compactar.
    // D786 passo 3: a ordem do handoff que sai agora torna velho o gravado antes (a compactacao mandaria reler esse);
    // fica so o gravado neste turno, o que a ordem ja encontra pronto (o jaColado abaixo). O ultimo handoff do turno
    // (arquivoDoHandoff, campo do turno) tem de ser o da marca: o de um subagente tambem o grava, sem trocar a marca.
    // s369 (P1 do dono): a continuacao que esta ordem abre segue o trabalho depois do handoff (paradaNoHandoff).
    sessao({ avisouSaude: true, avisouAlarme: avisouAlarme, avisouEspera: avisouEspera,
      turnosComTrabalho: s.turnosComTrabalho || 0, gitAbertura: fotoDaAbertura,
      arquivosTocados: s.arquivosTocados || [], contadoresSessao: acumulados, tokensDeContexto: tokensDeContexto,
      handoffDaSessao: s.handoffDaSessao === s.arquivoDoHandoff ? s.handoffDaSessao || null : null,
      handoffDoGatilho: true });
  } else {
    sessao({ turnosComTrabalho: s.turnosComTrabalho || 0, gitAbertura: fotoDaAbertura,
      arquivosTocados: s.arquivosTocados || [], contadoresSessao: acumulados, avisouSaude: s.avisouSaude || false,
      avisouAlarme: avisouAlarme, avisouEspera: avisouEspera, tokensDeContexto: tokensDeContexto,
      handoffDaSessao: s.handoffDaSessao || null });
  }
  if (!partes.length) return io.permitir();
  const saida = { systemMessage: partes.join('\n\n') };
  // T10-1: o systemMessage so o usuario ve. O additionalContext do Stop e o que chega ao modelo
  // e o faz agir (rodar o handoff e colar o prompt na mesma resposta).
  if (entrega) {
    // D412: o turno que gravou o handoff e ja colou o bloco nao recebe a ordem de colar de novo.
    // Mesma regra do portao (handoffSemPrompt, declarada mais abaixo: `function` sobe ao topo do arquivo), sem o projeto: a ordem nao depende do portaoHandoff.
    // 0.91.0 (A2): o prompt que so o gancho mostrou (F3b) nao esta na resposta: a ordem aponta a mensagem do sworn.
    let jaColado = false;
    if (s.gravouHandoff === true) {
      if (!handoffSemPrompt(e, s, null)) jaColado = true;
      else if (promptAoDono !== null) jaColado = saude.PROMPT_PELO_GANCHO;
    }
    saida.hookSpecificOutput = { hookEventName: 'Stop', additionalContext: saude.instrucaoAoModelo(vs.gatilhos, jaColado) };
  } else if (esperaNova) {
    saida.hookSpecificOutput = { hookEventName: 'Stop', additionalContext: saude.instrucaoAoModelo(vs.gatilhos, false, rodando) };
  } else if (daOrdem) {
    saida.hookSpecificOutput = { hookEventName: 'Stop', additionalContext: daOrdem };
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
  const alvo = function (n) { return tarefas.find(function (t) { return t.n === n; }); };
  const comAberto = function (t) { return t && t.abertos > 0 ? t : undefined; };
  const existentes = citadas.filter(alvo);
  // numero que nao existe no plano nao se confere (ex.: "etapa 7" de outro plano): se NENHUM existe,
  // a alegacao vale como sem numero e segue para as regras abaixo; se algum existe e esta fechado, a
  // alegacao e verdadeira e nao se cobra nada.
  if (existentes.length) return existentes.map(alvo).find(comAberto);
  const atual = ativo && ativo.tarefa !== null && ativo.tarefa !== undefined ? parseInt(ativo.tarefa, 10) : NaN;
  if (!isNaN(atual) && alvo(atual)) return comAberto(alvo(atual));
  const andamento = tarefas.filter(function (t) { return t.total - t.abertos > 0; }).pop();
  if (andamento) return tarefas.find(function (t) { return t.n <= andamento.n && t.abertos > 0; });
  return tarefas.find(function (t) { return t.abertos > 0; });
}

/** D412: handoff gravado neste turno e a resposta final sem bloco de codigo. D415: so
 *  `"portaoHandoff": false` no projeto.json desliga - independente de `travas.fecho`. */
function handoffSemPrompt(e, s, projeto) {
  if (s.gravouHandoff !== true) return false;
  if (projeto && projeto.portaoHandoff === false) return false;
  if (!saude.temBlocoDeCodigo(e.last_assistant_message)) return true;
  // s273: qualquer bloco passava, e a prova da suite em bloco passou por prompt. Com o arquivo legivel e um bloco
  // nele, a resposta tem de trazer o ultimo bloco do arquivo (o prompt), com o espaco normalizado.
  const prompt = promptDoHandoff(s.arquivoDoHandoff);
  if (prompt === null) return false;
  return espacoNormal(e.last_assistant_message).indexOf(espacoNormal(prompt)) === -1;
}

/** s369 (P1 do dono, pedido 70 / D786): o gatilho pediu o handoff, ele foi gravado nesta continuacao e o modelo parou
 *  sem mais nenhuma ferramenta fora do proprio handoff. A conversa segue sozinha (a compactacao vem quando encher):
 *  barra, com a ordem de seguir; uma vez, pela guarda do turno que ja barrou (bloqueouNesteTurno, no Stop abaixo).
 *  Desliga com o mesmo `"portaoHandoff": false` do prompt no chat. */
function paradaNoHandoff(s, projeto) {
  if (s.handoffDoGatilho !== true || s.gravouHandoff !== true) return false;
  if (s.trabalhoDepoisDoHandoff === true) return false;
  return !(projeto && projeto.portaoHandoff === false);
}

// s369 (A6, P1 do dono: "entenda pq nao continuou, isso nao pode acontecer"; vale em todo projeto e harness): o turno
// com trabalho que para com trabalho por fazer - caixa aberta no plano da sessao, ou a resposta anunciando o proximo
// passo em vez de faze-lo - e nada nele precisa do dono. So a linha declarada libera (palavra solta como "publicar" no
// meio do texto nao libera: os fechos a citam de passagem), menos a que so pede chat novo, que barra (linhaDeclarada,
// abaixo); teto contado por turno (D785: laco com teto). Vale tambem
// no Stop que ja barrou (o teto e que segura o laco) e com `travas.fecho: false`: chave propria, como o portaoHandoff
// (D415) - so `"modoContinuo": false` desliga.
const LIBERA_PARADA = /^[ \t>*_-]*(?:preciso do dono|espero|need the owner|waiting on)[ \t]*:/im;
const ANUNCIA_PASSO = new RegExp('\\b(?:pr[oó]xim[oa]s? (?:passos?|etapas?)|em seguida,? (?:vou|sigo|fa[cç]o)|' +
  'depois (?:sigo|vou|fa[cç]o)|sigo (?:com|pel[oa]|para)|vou seguir|next steps?|i(?:\'ll| will) (?:now )?' +
  '(?:continue|proceed|start|move on))\\b', 'i');
const TETO_DA_PARADA = 3;
// O anuncio so conta no texto corrido: bloco de codigo (cercado, ate indentado), codigo em linha e citacao (`>`)
// saem; a frase que nega o passo ("nao ha proximo passo") e a que entrega o passo ao dono ou ao usuario ("o proximo
// passo e do dono", "proximo passo: voce aprova o PR") nao sao anuncio de fazer. A frase se corta em . ! ? ; e na
// quebra de linha, nunca no ":" - o "proximo passo:" e o dono que vem depois dele sao a mesma frase.
// Bordas por letra Unicode, nao \b: sem a flag u o \b do JS nao ve o "e" acentuado de "voce" como letra.
const PASSO_DE_OUTRO = new RegExp('(?<![\\p{L}\\p{N}_])(?:d[oa] dono|da dona|d[oa] usu[aá]ri[oa]|de voc[eê]|' +
  'com voc[eê]|para voc[eê]|voc[eê] (?:aprova|decide|escolhe|revisa|confirma|publica|testa|roda|abre|cola|responde)|' +
  '[eé] (?:seu|sua)(?=\\s*(?:[.!?;:,]|$))|seu (?:ok|sim|aceite)|sua (?:aprova[cç][aã]o|decis[aã]o|escolha|resposta)|' +
  'the owner|owner\'s|yours|for you|your (?:call|approval|decision|review|ok)|' +
  'you (?:approve|decide|choose|review|confirm|publish|run|open))(?![\\p{L}\\p{N}_])', 'iu');
// "no" so no ingles: o "no proximo passo, vou..." do portugues e anuncio
const NEGA_PASSO = new RegExp('\\b(?:(?:n[aã]o (?:h[aá]|tem|resta|sobra)|nenhum[a]?|sem)\\s+(?:mais\\s+|outr[oa]s?\\s+)?' +
  'pr[oó]xim|(?:no|there(?:\'s| is) no|without)\\s+(?:more\\s+|other\\s+|further\\s+)?next)', 'i');
function anunciaOProximoPasso(msg) {
  const corrido = require('./lib/continuo.js').textoCorrido(msg);
  return corrido.split(/(?<=[.!?;])\s+|\n+/).some(function (frase) {
    return ANUNCIA_PASSO.test(frase) && !PASSO_DE_OUTRO.test(frase) && !NEGA_PASSO.test(frase);
  });
}

// s369 (3a vez, dono: "corrija isso de uma vez por todas"): "Preciso do dono: abrir o chat novo e colar o prompt" nao
// libera - a conversa segue sozinha e a compactacao rele o handoff (skill do handoff). A regra e por sobra, nao por
// lista de palavras do dono (essa nunca fecha): a linha declarada, com as linhas nao vazias logo abaixo, e so-chat
// quando pede o chat novo ou colar o prompt e, tiradas essas frases e o para-que-serve, nao sobra nada. Sobrou
// qualquer outra coisa (um pedido de verdade, "a versao nova do sworn so carrega la"), libera: o lado seguro, como era.
const CHAT_NOVO = '(?:(?:chat|conversa|sess[aã]o)\\s+nov[ao]|nov[ao]\\s+(?:chat|conversa|sess[aã]o)|' +
  'new\\s+(?:chat|conversation|session))';
const FRASES_DO_CHAT = [
  new RegExp('\\b(?:abr(?:ir|a|e|o)|inici(?:ar|e|a|o)|come[cç](?:ar|e|a|o)|usar|use|open|start)\\s+' +
    '(?:(?:um|uma|o|a|outro|outra|the|an?)\\s+)?' + CHAT_NOVO + '\\b', 'gi'),
  new RegExp('\\b(?:col(?:ar|e|o)|paste)\\s+(?:(?:o|a|the)\\s+)?prompt\\b(?:\\s+(?:acima|abaixo|above|below|' +
    'do\\s+handoff|of\\s+the\\s+handoff|n[oa]\\s+' + CHAT_NOVO + '|n[oa]\\s+chat|l[aá]|(?:in|into)\\s+(?:it|the\\s+' +
    '(?:new\\s+)?chat)))*', 'gi'),
  new RegExp('\\b(?:com|with)\\s+(?:o|the)\\s+prompt(?:\\s+(?:do\\s+handoff|of\\s+the\\s+handoff|acima|above))?', 'gi')
];
// O para-que-serve sai, mas nao e pedido de chat ("Espero: pra seguir" libera). So sai quando fecha a linha, com no
// maximo artigo e uma palavra ("para comecar a A5e."), e so por espaco e tab: o que vem depois dele, ou na linha de
// baixo, fica e libera (uma lista de conectores nunca fecha).
const PARA_QUE_SERVE = new RegExp('\\b(?:para|pra|to)[ \\t]+(?:come[cç]ar|seguir|continuar|retomar|start|continue|' +
  'resume)(?:[ \\t]+(?:a|o|the))?(?:[ \\t]+[^\\s.;,!?]+)?(?=[ \\t]*(?:[.!][ \\t]*)?(?:\\r?\\n|$))', 'gi');
const SOBRA_VAZIA = /^(?:\s|[.,;:!?()\-–—*_]|\b(?:e|and|ent[aã]o|then|depois)\b)*$/i;
/** A decisao sobre as linhas "Preciso do dono:"/"Espero:" da resposta, cada uma com as linhas nao vazias logo abaixo:
 *  `libera` se alguma pede outra coisa; `pedeChat` se ha alguma e todas so pedem chat novo. Sem linha declarada, os
 *  dois sao false (a parada segue para a caixa e o anuncio). */
function linhaDeclarada(msg) {
  const todas = String(msg).split(/\r?\n/);
  const linhas = [];
  for (let i = 0; i < todas.length; i++) {
    if (!LIBERA_PARADA.test(todas[i])) continue;
    let l = todas[i];
    while (i + 1 < todas.length && todas[i + 1].trim() !== '') l += '\n' + todas[++i];
    linhas.push(l);
  }
  const soChat = function (l) {
    let resto = l.replace(LIBERA_PARADA, '');
    let pediuChat = false;
    for (const re of FRASES_DO_CHAT) resto = resto.replace(re, function () { pediuChat = true; return ' '; });
    resto = resto.replace(PARA_QUE_SERVE, ' ');
    return pediuChat && SOBRA_VAZIA.test(resto);
  };
  return { libera: linhas.some(function (l) { return !soChat(l); }), pedeChat: linhas.length > 0 && linhas.every(soChat) };
}

/** F3b (D828): a resposta para numa linha declarada que libera ("Espero:" ou "Preciso do dono:" com um pedido de
 *  verdade), fora dos blocos de codigo (uma saida colada com "waiting on:" nao e a parada do agente), e nao afirma
 *  sucesso fora dos blocos. */
function paradaSemAlegacao(msg) {
  const texto = String(msg || '');
  // o semBlocos tira as cercas de crase; a de til (~~~) tambem e bloco de codigo no markdown
  const prosa = evidencia.semBlocos(texto).replace(/^[ \t]*~~~[^\n]*\n[\s\S]*?^[ \t]*~~~[ \t]*$/gm, ' ');
  // a linha vazia ("Preciso do dono:" sem nada) nao e parada: tem de pedir ou esperar alguma coisa
  return PARADA_COM_PEDIDO.test(prosa) && linhaDeclarada(prosa).libera && !evidencia.analisar(texto).alegaSucesso;
}
const PARADA_COM_PEDIDO = /^[ \t>*_-]*(?:preciso do dono|espero|need the owner|waiting on)[ \t]*:[ \t]*\S/im;

function paradaSemDono(e, s, projeto, cwd) {
  if (!s.trabalhoReal || e.agent_id) return null;
  if (!require('./lib/continuo.js').ativo(projeto)) return null;
  const msg = String(e.last_assistant_message || '');
  const declarada = linhaDeclarada(msg);
  if (declarada.libera || (s.paradaSemDono || 0) >= TETO_DA_PARADA) return null;
  let caixa = null;
  // fail-open: o plano que nao se le nao prende o turno (o anuncio do proximo passo ainda barra)
  try { caixa = require('./lib/plano.js').caixaAberta(cwd, s.frente); } catch (err) { caixa = null; }
  const anuncia = anunciaOProximoPasso(msg);
  if (!caixa && !anuncia && !declarada.pedeChat) return null;
  s.paradaSemDono = (s.paradaSemDono || 0) + 1;
  s.contadores = s.contadores || {};
  s.contadores.parada_sem_dono = (s.contadores.parada_sem_dono || 0) + 1;
  return saude.motivoParadaSemDono(caixa, anuncia, declarada.pedeChat);
}

/** Encerra o turno, menos quando ele para com trabalho por fazer (paradaSemDono): ai barra. */
function encerrarOuSeguir(e, s, projeto, avisoExtra) {
  const m = paradaSemDono(e, s, projeto, config.raizDoProjeto(e.cwd));
  /* o aviso que ia ao encerrar (o do plano ilegivel) vai junto na barrada, nao se perde */
  return m ? barrar(e, s, avisoExtra ? [m, avisoExtra] : [m], false) : encerrarTurno(e, s, avisoExtra);
}

const espacoNormal = (t) => String(t).replace(/\s+/g, ' ').trim();

// F3b (D828): o handoff gravado e a resposta sem o prompt: com o prompt legivel no arquivo, o proprio gancho o mostra ao
// dono (systemMessage) e o fim do turno nao barra por isso. Vale para este Stop; o barrar e o encerrarTurno o levam.
let promptAoDono = null;

/** F3b: o aviso ao dono com o prompt do handoff, num bloco (a cerca de tres crases do proprio prompt vira aspas). */
function avisoDoPrompt(prompt, arquivo) {
  return 'sworn - o handoff foi gravado (' + require('./lib/escopo.js').ascii(String(arquivo || '')) + '). O prompt ' +
    'pronto, se um dia precisar de um chat novo; o trabalho segue nesta conversa:\n```\n' +
    String(prompt).replace(/```/g, "'''").replace(/\s+$/, '') + '\n```';
}

/** O conteudo do ultimo bloco de codigo do arquivo (cerca no comeco da linha), ou null. */
function promptDoHandoff(arquivo) {
  let texto;
  // fail-open: o handoff que nao se le nao cobra o prompt colado (handoffSemPrompt devolve false)
  try { texto = require('node:fs').readFileSync(arquivo, 'utf8'); } catch (e) { return null; }
  let ultimo = null;
  for (const m of texto.matchAll(/^```[^\n]*\r?\n([\s\S]*?)^```[ \t]*\r?$/gm)) ultimo = m[1];
  return ultimo !== null && ultimo.trim() ? ultimo : null;
}

// D503 (plano d503, Tarefa 5): no maximo tantos arquivos citados no motivo; o resto vira "+N".
const MAX_CITADOS = 5;

/** Os arquivos do motivo, um por linha entre aspas, ate MAX_CITADOS e o resto contado; fora de ASCII vira "?" (R5). */
function citarArquivos(arquivos) {
  const ascii = require('./lib/escopo.js').ascii;
  const citados = arquivos.slice(0, MAX_CITADOS).map(function (a) { return '  - "' + ascii(a) + '"'; });
  if (arquivos.length > MAX_CITADOS) citados.push('  - and ' + (arquivos.length - MAX_CITADOS) + ' more');
  return citados;
}

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
  // "aprovado" e o que o apurar-ronda.js escreve no fecho ("duas rondas secas seguidas: aprovado", ou, desde a F2b,
  // "ronda 1 completa sem achado nenhum: aprovado").
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
    '  2. se chegar a 3 rondas sem fechar, conserte o que e erro, cada conserto com um',
    '     teste que reprova quando o codigo e estragado de proposito, rode a suite inteira',
    '     e entregue sem a comparacao dizendo o que ficou atras, sem perguntar;',
    '  3. ou diga ao usuario por que esta entrega fica sem a comparacao.',
    '',
    'So o dono desliga neste projeto: "portaoReferencia": false em .claude/sworn/projeto.json.'
  ]).join('\n');
}

/** D655 (plano pedidos-aaa-idioma-readme, T1); C3 (D808, D812): o motivo quando a resposta alega entrega e um arquivo
 *  de codigo mudado na sessao nao tem revisao aprovada - da marcha aaa por padrao, de qualquer marcha (o conjunto que
 *  o portao do commit cobra) com "revisaoTodoCodigo": true - com ou sem referencia. `jaCobrados` sao os que o motivo da referencia ja cita no turno: nao saem duas vezes. Declarar a
 *  entrega sem revisao (`evidencia.declaraSemRevisao`) libera. So `"portaoRevisao": false` desliga, como o
 *  portaoReferencia. Texto ao modelo em ingles (D656), ASCII (R5). */
function semRevisaoAprovada(e, s, projeto, cwd, jaCobrados) {
  if (!projeto || projeto.portaoRevisao === false) return null;
  const msg = e.last_assistant_message;
  if (!evidencia.analisar(msg).alegaSucesso || evidencia.declaraSemRevisao(msg)) return null;
  // C3 (D808, D812): a marcha aaa por padrao; todo arquivo de codigo (o conjunto do commit) so com
  // "revisaoTodoCodigo": true - a bateria do C3 mediu o custo do Opus 2,44 vezes com a cobranca ampla, sem ganho
  const marcha = projeto.revisaoTodoCodigo === true ? null : 'aaa';
  const arquivos = require('./lib/marcha.js').semRevisao(s.arquivosTocados, s.revisadosAprovados, projeto, cwd, marcha)
    .filter(function (a) { return jaCobrados.indexOf(a) === -1; });
  if (!arquivos.length) return null;
  const citados = citarArquivos(arquivos);
  return [
    'sworn - the review is missing on a changed code file.',
    '',
    'You said the work is done, and you changed code files with no approved review',
    'in this session:'
  ].concat(citados, [
    '',
    'Do one of these:',
    '  1. run /sworn:review "<file>" for each one, until it says "aprovado";',
    '  2. if 3 rounds pass without approval, fix what is an error, each fix with a',
    '     test that fails when the code is broken on purpose, run the whole suite and',
    '     deliver "without review" naming what stays open, without asking;',
    '  3. or tell the user why this delivery goes "without review" (those words',
    '     in your answer release this check).',
    '',
    'Turn off in this project: "portaoRevisao": false in .claude/sworn/projeto.json.'
  ]).join('\n');
}

// H15(b) (D923): o custo e o ganho medidos na leva da consulta pedida (docs/bateria/metodo-advisor.md, par. 8): a
// rodada e uma execucao de uma tarefa de teste, com e sem o advisor; o motivo cita os arquivos AAA mudados.
function motivoAdvisor(arquivos) {
  return [
    'sworn - the advisor is on, and this session has not consulted it.',
    '',
    'You said the work is done, and you changed files this project checks with',
    'the most care (the AAA gear):'
  ].concat(citarArquivos(arquivos), [
    '',
    'The advisor is on (advisorModel in a Claude Code settings.json: the user,',
    'project or local one), and this session has no advisor call. Before you',
    'call the task delivered, consult the advisor tool once about the work done,',
    'and act on what it finds.',
    '',
    'Measured cost, in sworn\'s own test runs: about US$ 0.22 more per run of a',
    'task, 3.9 times the cost of the same run without the advisor. On the one',
    'test task that failed without it, the consult avoided the defect in 2 of 3',
    'runs.',
    '',
    'If the advisor tool is not in this session, say so in one line and deliver.',
    'This check runs once per session.',
    '',
    'Only the owner turns this off in this project: "portaoAdvisor": false in',
    '.claude/sworn/projeto.json.'
  ]).join('\n');
}

/** H15(b) (D923): o motivo quando a resposta alega entrega, um arquivo de codigo AAA mudou na sessao (aprovado na
 *  revisao ou nao), o advisor esta ligado (lib/advisor.js) e a transcricao nao tem consulta a ele. Uma vez por
 *  sessao: `advisorVisto` marca a cobranca e a consulta achada, e a transcricao nao se le de novo. Sem transcricao
 *  que se leia, calado. So `"portaoAdvisor": false` desliga (a trava 3 desligada nao). */
function semConsultaAoAdvisor(e, s, projeto, cwd) {
  if (!projeto || projeto.portaoAdvisor === false || s.advisorVisto === true) return null;
  if (!evidencia.analisar(e.last_assistant_message).alegaSucesso) return null;
  const aaa = require('./lib/marcha.js').semRevisao(s.arquivosTocados, [], projeto, cwd, 'aaa');
  if (!aaa.length) return null;
  const advisor = require('./lib/advisor.js');
  if (!advisor.ligado(cwd, process.env)) return null;
  const visto = advisor.consultou(e.transcript_path);
  if (visto === null) return null;
  s.advisorVisto = true;
  return visto ? null : motivoAdvisor(aaa);
}

/** B2 (s369, R-impeccable): o pronto com arquivo aprovado por revisao degradada (sem isolamento, sem navegador) tem
 *  de dizer isso numa linha "DEGRADADO: <motivo>". So vale a marca do arquivo ainda aprovado e tocado na sessao (o
 *  editado de novo perde a aprovacao, e quem cobra e a revisao que falta). ASCII (R5). */
function semAvisoDeDegradada(e, s, projeto) {
  const marcadas = s.revisoesDegradadas;
  if (!marcadas || typeof marcadas !== 'object' || Array.isArray(marcadas)) return null;
  if (projeto && projeto.portaoRevisao === false) return null;
  const motivoDe = function (abs) {
    const m = marcadas[abs];
    return typeof m === 'string' && m.trim() ? m.trim() : 'motivo nao gravado';
  };
  const msg = e.last_assistant_message;
  if (!evidencia.analisar(msg).alegaSucesso || /^\s*DEGRADADO: \S/m.test(String(msg || ''))) return null;
  const commit = require('./lib/commit.js');
  const cwd = config.raizDoProjeto(e.cwd);
  const ascii = require('./lib/escopo.js').ascii;
  const relativo = require('./lib/caminho.js').relativoAoProjeto;
  const casos = Object.keys(marcadas).filter(function (abs) {
    return commit.aprovado(s.revisadosAprovados, abs) && commit.aprovado(s.arquivosTocados, abs);
  });
  if (!casos.length) return null;
  const linhas = casos.slice(0, MAX_CITADOS).map(function (abs) {
    return '  - "' + ascii(relativo(abs, cwd) || abs) + '": ' + ascii(motivoDe(abs));
  });
  if (casos.length > MAX_CITADOS) linhas.push('  - e mais ' + (casos.length - MAX_CITADOS));
  return ['sworn - portao de fecho: revisao degradada sem o aviso.', '',
    'Voce afirmou que esta pronto, e a revisao que aprovou estes arquivos foi degradada:'].concat(linhas, ['',
    'Abra a resposta com a linha "DEGRADADO: <motivo>", uma por motivo (aqui:',
    '"DEGRADADO: ' + ascii(motivoDe(casos[0])) + '"), para o dono saber o que a revisao nao viu.',
    'Ou rode /sworn:review "<arquivo>" de novo, com os inspetores isolados, preparando sem --degradado.']).join('\n');
}

/** D634: o motivo quando a prova existe mas o resultado dela nao sustenta a alegacao - o bloco colado mostra falha
 *  (7a), o ultimo teste rodado na sessao falhou (7b) ou a provaDePronto nao rodou depois da ultima edicao de codigo
 *  (8). Declarar o que nao rodou, ou que a falha segue, libera. O transcript so e lido quando ha alegacao. D785: com
 *  provaDePronto e codigo editado no turno, quem cobra antes e o laco da prova (cobrarOuRodarProva), sem a ressalva. */
function motivoDoResultado(e, projeto, s) {
  const msg = e.last_assistant_message;
  if (evidencia.deveBloquearPorFalha(msg)) return evidencia.MOTIVO_FALHA;
  if (!evidencia.analisar(msg).alegaSucesso || evidencia.declaraRessalva(msg)) return null;
  const prova = provaDe(projeto);
  const t = comProvaDoGancho(e, s, lerTranscript(e, prova, projeto), prova);
  if (!t) return null;
  // R2b: a conferencia da tela que saiu 1 barra o pronto ate uma que saia 0, mesmo com outro teste verde depois.
  if (t.ultimaConferencia && t.ultimaConferencia.falhou) return evidencia.motivoConferenciaVermelha(t.ultimaConferencia.comando);
  if (t.ultimoTeste && t.ultimoTeste.falhou) return evidencia.motivoTesteVermelho(t.ultimoTeste.comando);
  if (t.provaRodando) return evidencia.motivoProvaRodando(projeto.provaDePronto);
  if (t.conferenciaRodando) return evidencia.motivoConferenciaRodando(t.comandoDaConferenciaRodando);
  if (t.provaPendente) return evidencia.motivoProvaNaoRodou(projeto.provaDePronto);
  return null;
}

/** D794: o teto da prova rodada pelo gancho; SWORN_PROVA_TETO_MS (inteiro positivo) so para os testes. */
function tetoDaProva() {
  const v = Number(process.env.SWORN_PROVA_TETO_MS);
  return Number.isInteger(v) && v > 0 ? v : provaNoFecho.TETO_MS;
}

/** A provaDePronto declarada, sem espacos nas pontas; '' sem ela. */
function provaDe(projeto) {
  return projeto && typeof projeto.provaDePronto === 'string' ? projeto.provaDePronto.trim() : '';
}

// D794: o transcript lido com as posicoes uma vez por fim de turno (o gancho e um processo por Stop): o laco, o
// resultado e a evidencia olham a mesma leitura, nao tres.
// F1d (D828.4): com `"provaPorArquivoTocado": true` no projeto.json, a prova do turno e a focada - os testes que
// cobrem cada arquivo de codigo editado, depois da ultima edicao dele (saude.testesDoTranscript, provaFocada); ela
// tira a pendencia da suite inteira, que o portao de commit passa a cobrar antes do commit.
const lidos = new Map();
/** F1c (D828): o comando do grupo de coerencia do disco (`provaDeCoerencia`), so com a prova por arquivo tocado. */
function coerenciaDe(projeto) {
  if (!projeto || projeto.provaPorArquivoTocado !== true || typeof projeto.provaDeCoerencia !== 'string') return '';
  return projeto.provaDeCoerencia.trim();
}

/** F1d/F1c: a linha que diz o caminho curto da prova por arquivo tocado (ASCII, R5); sem a chave, ''. */
function caminhoDaProvaFocada(projeto) {
  if (!projeto || projeto.provaPorArquivoTocado !== true) return '';
  const coerencia = coerenciaDe(projeto);
  return '\n\nCom a prova por arquivo tocado, basta o teste de cada arquivo de codigo mexido (o que o cita pelo ' +
    'caminho, ou o proprio arquivo de teste), depois da ultima edicao e verde' +
    (coerencia ? ', e o grupo de coerencia do disco verde depois dela:\n  ' + require('./lib/escopo.js').ascii(coerencia)
      : '.');
}

function lerTranscript(e, prova, projeto) {
  const chave = String(e.transcript_path) + '\0' + prova;
  if (!lidos.has(chave)) {
    const raiz = config.raizDoProjeto(e.cwd);
    const coerencia = coerenciaDe(projeto);
    // D875: a edicao fora do projeto depois da prova so a pede de novo se o codigo do repositorio mudou desde ela
    const mesmo = require('./lib/impressao-codigo.js').mesmoCodigoDesde(e.session_id, raiz);
    const t = saude.testesDoTranscript(e.transcript_path, saude.provasEquivalentes(prova, raiz), true,
      { raiz: raiz, coerencia: coerencia || null, mesmoCodigoDaProva: mesmo });
    // A suite inteira vermelha antes das edicoes de agora nao se apaga com a prova focada delas. F1c: com o grupo de
    // coerencia declarado, ele tambem tem de ter rodado verde depois da ultima edicao.
    const focada = Boolean(t && projeto && projeto.provaPorArquivoTocado === true && t.provaPendente && t.provaFocada &&
      !t.provaVermelha && (!coerencia || t.coerenciaVerde === true));
    lidos.set(chave, focada ? Object.assign({}, t, { provaPendente: false }) : t);
  }
  return lidos.get(chave);
}

/** D794: a prova que o gancho rodou ainda vale - o mesmo transcript, a mesma prova declarada e nenhuma edicao de
 *  codigo depois dela. */
function provaDoGanchoValeEm(e, s, t, prova) {
  const g = s && s.provaDoGancho;
  return Boolean(t && g && g.transcript === e.transcript_path && g.prova === prova && typeof g.pos === 'number' &&
    typeof t.ultimaEdicao === 'number' && t.ultimaEdicao < g.pos);
}

/** D794: o transcript visto com a prova que o gancho rodou (ela nao entra no transcript): valendo, nada fica pendente
 *  e o teste de antes dela ja nao e o ultimo; nao valendo, o transcript como veio. */
function comProvaDoGancho(e, s, t, prova) {
  if (!provaDoGanchoValeEm(e, s, t, prova)) return t;
  const g = s.provaDoGancho;
  const ultimoTeste = t.ultimoTeste && t.ultimoTeste.pos < g.pos
    ? { comando: g.prova, falhou: false, pos: g.pos } : t.ultimoTeste;
  return Object.assign({}, t, { provaPendente: false, ultimoTeste: ultimoTeste });
}

/** H6a (D891): a alegacao com bloco de saida, e nenhuma linha dele em saida de ferramenta da sessao (o transcript e
 *  o resumo dos recibos cortados, que o transcript ja nao tem inteiro). So le o transcript quando ha alegacao com
 *  bloco e sem dizer que nao rodou (o "ainda falha" nao vale o bloco inventado); a prova que o gancho rodou vale
 *  como recibo (ela nao entra no transcript). */
function blocoSemRecibo(e, s, projeto) {
  const msg = e.last_assistant_message;
  const a = evidencia.analisar(msg);
  if (!a.alegaSucesso || !a.temBloco || a.declaraNaoRodou || provaDoGanchoVale(e, s, projeto)) return false;
  const saidas = saude.saidasDoTranscript(e.transcript_path);
  if (!saidas || !saidas.length) return false;
  const dosRecibos = (Array.isArray(s.recibos) ? s.recibos : []).filter(function (r) {
    return r && Array.isArray(r.resumo);
  }).map(function (r) { return r.resumo.join('\n'); });
  return evidencia.deveBloquearSemRecibo(msg, saidas.concat(dosRecibos));
}

/** D794: a alegacao sem bloco tem a prova do gancho por tras. So le o transcript quando ha a marca. */
function provaDoGanchoVale(e, s, projeto) {
  const prova = provaDe(projeto);
  return Boolean(s.provaDoGancho && prova) && provaDoGanchoValeEm(e, s, lerTranscript(e, prova, projeto), prova);
}

/** D794: RODA a prova pendente pelo gancho, so no projeto que o dono ligou na maquina dele e so o comando que ele
 *  ligou (o projeto.json que declara outro, num commit novo por exemplo, nao roda). Devolve null (nada pendente,
 *  desligado, ou ja passou do limite nesta sessao), { passou: true }, { cauda } (falhou) ou { aviso } (comando trocado,
 *  ou passou do limite). Grava em `s` a marca `provaDoGancho` (passou: vale ate a proxima edicao) ou
 *  `provaDoGanchoEstourou` (passou do limite: nao roda de novo na sessao, cada volta gastaria o limite inteiro). */
function rodarProvaNoGancho(e, s, prova, t) {
  if (!t.provaPendente || t.provaRodando) return null;
  const raiz = config.raizDoProjeto(e.cwd);
  const ligada = provaNoFecho.provaLigada(raiz);
  const ascii = require('./lib/escopo.js').ascii;
  if (ligada !== null && ligada !== prova) {
    // o caminho com acento viraria "?" no ascii() e o comando copiado nao rodaria: entao so o nome do script
    const caminho = require('node:path').join(__dirname, 'prova-no-fecho.js');
    const script = /^[\x20-\x7E]*$/.test(caminho) ? caminho : '<pasta do sworn>/scripts/prova-no-fecho.js';
    return { aviso: 'O sworn nao rodou a prova sozinho: o dono ligou "' + ascii(ligada) + '", e o projeto.json ' +
      'declara agora "' + ascii(prova) + '". Rode a prova neste turno, como sempre, e avise o dono da troca. Voce nao ' +
      'roda o comando de ligar: so o dono, depois de conferir o comando novo, roda na pasta do projeto: node "' +
      script + '" ligar' };
  }
  if (ligada === null || s.provaDoGanchoEstourou === prova) return null;
  const r = provaNoFecho.rodar(prova, raiz, tetoDaProva());
  if (r.ok) {
    s.provaDoGancho = { transcript: e.transcript_path, pos: t.fim, prova: prova };
    return { passou: true };
  }
  if (!r.estourou) return { cauda: r.cauda };
  s.provaDoGanchoEstourou = prova;
  return { aviso: 'O sworn tentou rodar a prova no fim do turno, e ela passou do limite de tempo de ' +
    Math.round(tetoDaProva() / 1000) + ' s. Rode voce a prova neste turno (' + ascii(prova) + '); nesta sessao o ' +
    'sworn nao tenta de novo.' };
}

/** D785 (2.1): o laco da prova. Com provaDePronto declarada, o turno que editou codigo (marca do marcar-trabalho.js)
 *  barra enquanto o ultimo teste estiver vermelho ou a prova pendente, com ou sem alegacao e com ou sem ressalva, e
 *  tambem em laco: o contador e o do turno (`lacoDaProva`), nao o stop_hook_active. A volta TETO_DO_LACO + 1 manda
 *  escalar; dali em diante libera (teto contado). Conta a volta em `s` e no balde do fecho sem evidencia; sem barrar,
 *  null. O transcript so e lido no turno que editou codigo.
 *  D794: antes de cobrar, roda a prova pendente pelo gancho no projeto que o dono ligou (rodarProvaNoGancho): passou,
 *  libera; falhou, barra com a cauda da saida; nos outros casos cobra como sempre, com o aviso do gancho. */
function cobrarOuRodarProva(e, s, projeto) {
  if (!s.editouCodigo || projetoLib.travasDe(projeto).fecho === false) return null;
  const prova = provaDe(projeto);
  const n = (s.lacoDaProva || 0) + 1;
  if (!prova || n > evidencia.TETO_DO_LACO + 1) return null;
  const t = comProvaDoGancho(e, s, lerTranscript(e, prova, projeto), prova);
  if (!t) return null;
  // F3b (D828): a parada declarada ("Espero:" ou "Preciso do dono:") que nao afirma sucesso nao paga a prova so
  // pendente: esperando um agente ou o dono, o turno nao diz que o codigo esta pronto (a prova volta a ser cobrada no
  // turno que disser). O teste vermelho conhecido segue cobrado.
  const vermelhoConhecido = t.ultimoTeste !== null && t.ultimoTeste.falhou;
  if (!vermelhoConhecido && paradaSemAlegacao(e.last_assistant_message)) return null;
  const g = rodarProvaNoGancho(e, s, prova, t);
  if (g && g.passou) return null;
  if (g && typeof g.cauda === 'string') {
    s.lacoDaProva = n;
    s.contadores = s.contadores || {};
    s.contadores.fecho_sem_evidencia = (s.contadores.fecho_sem_evidencia || 0) + 1;
    // a cerca de tres crases da propria saida fecharia o bloco antes da hora
    return evidencia.motivoDoLaco('vermelho', prova, n, false) + '\n\nA prova rodou no fim do turno, pelo sworn, ' +
      'e falhou. As ultimas linhas da saida:\n```\n' + g.cauda.replace(/```/g, "'''") + '\n```';
  }
  const aviso = g && g.aviso ? '\n\n' + g.aviso : '';
  const vermelho = t.ultimoTeste !== null && t.ultimoTeste.falhou;
  // A4 (s369): a prova lancada em segundo plano depois da edicao ainda roda; o aviso de fim acorda o modelo, e a volta
  // nao conta, nem com um vermelho de antes dela. O pronto sem o resultado quem barra e o motivoDoResultado.
  if (t.provaRodando || (!vermelho && !t.provaPendente)) return null;
  s.lacoDaProva = n;
  s.contadores = s.contadores || {};
  s.contadores.fecho_sem_evidencia = (s.contadores.fecho_sem_evidencia || 0) + 1;
  return evidencia.motivoDoLaco(vermelho ? 'vermelho' : 'pendente', vermelho ? t.ultimoTeste.comando : prova, n,
    vermelho && t.ultimoTeste.barradoPeloSandbox === true) + (vermelho ? '' : caminhoDaProvaFocada(projeto)) + aviso;
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
  io.bloquearFecho(todos.join('\n\n'), promptAoDono || undefined);
}

io.blindar(function () {
  io.lerEntrada(function (e) {
    const s = estado.ler(e.session_id);

    // Ja bloqueou neste turno, ou o harness avisa que estamos em laco: encerra. D785 (2.1): menos o laco da prova, que
    // barra de novo pelo contador dele; o resto do turno ja foi cobrado.
    if (s.bloqueouNesteTurno || e.stop_hook_active === true) {
      const doLaco = s.editouCodigo
        ? cobrarOuRodarProva(e, s, config.carregarProjeto(config.raizDoProjeto(e.cwd))) : null;
      return doLaco ? barrar(e, s, [doLaco], false)
        : encerrarOuSeguir(e, s, config.carregarProjeto(config.raizDoProjeto(e.cwd)));
    }

    // D694 (T3 da escada): o pedido de escalada sem despacho entra no bloqueio do turno com ou sem trabalho e com a
    // trava 3 desligada (e da escada de agentes, a trava 6). Cobrado uma vez: sai da sessao aqui (lib/escalada.js).
    const daEscalada = escaladaLib.motivoDoFecho(s);
    if (daEscalada) {
      s.escalada = escaladaLib.semPendentes(s);
      s.contadores = s.contadores || {};
      s.contadores.escalada_sem_despacho = (s.contadores.escalada_sem_despacho || 0) + 1;
    }
    // H12c (D914): o arquivo que o briefing pediu e o subagente nao gravou, no mesmo lugar e cobrado uma vez, como a
    // escalada: a saida do SubagentStop nao chega a quem despachou (lib/entrega-pedida.js).
    const daEntrega = entregaLib.motivoDoFecho(s);
    if (daEntrega) s.entregaFaltando = [];
    const motivosDosSubagentes = (daEscalada ? [daEscalada] : []).concat(daEntrega ? [daEntrega] : []);

    // Nao houve trabalho real: conversa passa direto. Custo zero. s366 (F11): menos a ordem do compact pendente (a
    // escrita negada pelo portao nao marca trabalho); a cobranca muda o `s`, gravado aqui como no barrar.
    if (!s.trabalhoReal) {
      if (motivosDosSubagentes.length) return barrar(e, s, motivosDosSubagentes, false);
      if (!s.ordemDoCompact) return io.permitir();
      const daOrdem = cobrancaDaOrdem(e, s);
      estado.gravar(e.session_id, s);
      return daOrdem ? io.permitir({ systemMessage: AVISO_DA_ORDEM,
        hookSpecificOutput: { hookEventName: 'Stop', additionalContext: daOrdem } }) : io.permitir();
    }

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
    let semPrompt = handoffSemPrompt(e, s, projeto);
    // F3b (D828): com o prompt legivel no arquivo, o gancho o mostra ao dono e nao barra por ele.
    const legivel = semPrompt ? promptDoHandoff(s.arquivoDoHandoff) : null;
    if (legivel !== null) {
      promptAoDono = avisoDoPrompt(legivel, s.arquivoDoHandoff);
      semPrompt = false;
    }
    // D503: como o do handoff, calculado antes do retorno da trava 3 desligada; todo caminho abaixo com ele barra.
    const semReferencia = semRevisaoDeReferencia(e, s, projeto, cwd);
    // D655: o da revisao aprovada, calculado aqui pelo mesmo motivo, sem repetir os arquivos que o da referencia ja cita.
    const semRevisao = semRevisaoAprovada(e, s, projeto, cwd,
      semReferencia ? require('./lib/marcha.js').aaaComReferencia(s.arquivosTocados, projeto, cwd) : []);
    // Plano 082 (p7-25) e D655: os motivos de revisao que faltam (o da referencia e, depois dele, o da revisao aprovada)
    // entram so por aqui, e sempre depois dos outros do turno (o do handoff, o barrar soma no fim).
    // B2: a revisao degradada sem a linha DEGRADADO, no mesmo grupo e no mesmo balde da revisao que falta.
    const degradadaSemAviso = semAvisoDeDegradada(e, s, projeto);
    // H15(b) (D923): a consulta ao advisor ligado, no fim do mesmo grupo, com balde proprio.
    const semAdvisor = semConsultaAoAdvisor(e, s, projeto, cwd);
    if (semAdvisor) {
      s.contadores = s.contadores || {};
      s.contadores.fecho_sem_advisor = (s.contadores.fecho_sem_advisor || 0) + 1;
    }
    const daRevisao = (semReferencia ? [semReferencia] : []).concat(semRevisao ? [semRevisao] : [],
      degradadaSemAviso ? [degradadaSemAviso] : [], semAdvisor ? [semAdvisor] : []);
    // um Stop, um ponto no balde: com a revisao que falta, ela ja contou
    if (degradadaSemAviso && !semRevisao) {
      s.contadores = s.contadores || {};
      s.contadores.fecho_sem_revisao = (s.contadores.fecho_sem_revisao || 0) + 1;
    }
    if (semReferencia) {
      s.contadores = s.contadores || {};
      s.contadores.fecho_sem_referencia = (s.contadores.fecho_sem_referencia || 0) + 1;
    }
    if (semRevisao) {
      s.contadores = s.contadores || {};
      s.contadores.fecho_sem_revisao = (s.contadores.fecho_sem_revisao || 0) + 1;
    }
    // s369 (P1 do dono): a parada logo depois do handoff do gatilho; vale com a trava 3 desligada, como o prompt.
    const parouNoHandoff = paradaNoHandoff(s, projeto);
    if (parouNoHandoff) {
      s.contadores = s.contadores || {};
      s.contadores.parada_no_handoff = (s.contadores.parada_no_handoff || 0) + 1;
    }
    // Os dos subagentes (a escalada e a entrega que faltou) antes dos da revisao, que seguem depois dos outros
    // motivos do turno.
    const doTurno = motivosDosSubagentes.concat(parouNoHandoff ? [saude.MOTIVO_PARADA_NO_HANDOFF] : [], daRevisao);
    if (travas.fecho === false) {
      return doTurno.length || semPrompt ? barrar(e, s, doTurno, semPrompt) : encerrarOuSeguir(e, s, projeto);
    }

    const planoLib = require('./lib/plano.js');
    const ativo = planoLib.lerAtivo(cwd);
    let planoIlegivel = null;
    if (ativo && planoLib.alegaEtapaConcluida(e.last_assistant_message)) {
      let tarefas = [];
      // Plano 082 (p7-5): caminhoDoPlano, como a faixa e o painel - o absoluto do --abrir se le.
      try { tarefas = planoLib.parseTarefas(require('node:fs').readFileSync(planoLib.caminhoDoPlano(cwd, ativo.arquivo), 'utf8')); }
      catch (err) {
        // fail-open, com aviso. S52-fec-1: plano ilegivel nao barra, mas tambem nao passa calado. Pedido 12 (A3): com causa e proximo passo.
        tarefas = [];
        // A3-25: sem jargao, e o comando de abrir com o caminho real do plano.js (o do painel).
        planoIlegivel = 'sworn: o plano ativo (' + String(ativo.arquivo) + ') nao pode ser lido (' +
          require('./lib/escopo.js').ascii(require('./lib/texto.js').causaDoErro(err)).slice(0, 120) +
          '); a etapa dada como concluida passou sem conferir as caixas abertas do plano. Confira se o arquivo ' +
          'existe e se abre, ou abra o plano de novo: ' +
          planoLib.comandoDeAbrir(require('node:path').join(__dirname, 'plano.js'));
      }
      const aberta = tarefaACobrar(tarefas, e.last_assistant_message, ativo);
      if (aberta) {
        s.contadores = s.contadores || {};
        s.contadores.subitem_pendente = (s.contadores.subitem_pendente || 0) + 1;
        return barrar(e, s, [planoLib.motivoSubitemAberto(aberta)].concat(doTurno), semPrompt);
      }
    }

    // D785 (2.1): o laco da prova cobra antes, e no lugar, da falta de bloco e do resultado (conta o balde ele mesmo).
    const doLaco = cobrarOuRodarProva(e, s, projeto);
    // D794: a alegacao sem bloco tem a prova que o gancho rodou (sem edicao depois dela): nao falta evidencia.
    const semEvidencia = !doLaco && evidencia.deveBloquear(e.last_assistant_message) && !provaDoGanchoVale(e, s, projeto);
    // P04 (C1): a causa dada por achada sem o defeito reproduzido; mesmo balde da falta de bloco.
    const semReproducao = !doLaco && !semEvidencia && evidencia.deveBloquearPorCausa(e.last_assistant_message);
    // D634: se a falta de bloco nao barrou, o resultado da prova; conta no mesmo balde (a evidencia nao sustenta a alegacao).
    const semResultado = doLaco || semEvidencia || semReproducao ? null : motivoDoResultado(e, projeto, s);
    // H6a (D891): o bloco colado que nao aparece em nenhuma saida de ferramenta da sessao; mesmo balde da falta de
    // bloco. Depois do resultado: o teste vermelho diz mais que o bloco sem recibo.
    const semRecibo = !doLaco && !semEvidencia && !semReproducao && !semResultado && blocoSemRecibo(e, s, projeto);
    // H6f (15.9): o teste editado sem um vermelho depois; balde proprio. A linha "SEM VERMELHO:" libera e limpa a lista.
    const vermelhoAntes = require('./lib/vermelho-antes.js');
    if (vermelhoAntes.declarou(e.last_assistant_message) && s.testesSemVermelho !== undefined) s.testesSemVermelho = [];
    const semVermelho = !doLaco && !semEvidencia && !semReproducao && !semResultado && !semRecibo &&
      vermelhoAntes.motivoDoFecho(s.testesSemVermelho, e.last_assistant_message, projeto, cwd);
    const nada = !doLaco && !semEvidencia && !semRecibo && !semReproducao && !semResultado && !semVermelho &&
      !semPrompt && !doTurno.length;
    if (nada) return encerrarOuSeguir(e, s, projeto, planoIlegivel);

    const motivos = [];
    if (planoIlegivel) motivos.push(planoIlegivel);
    if (doLaco) motivos.push(doLaco);
    else if (semEvidencia || semRecibo || semReproducao || semResultado) {
      s.contadores = s.contadores || {};
      s.contadores.fecho_sem_evidencia = (s.contadores.fecho_sem_evidencia || 0) + 1;
      motivos.push(semEvidencia ? evidencia.MOTIVO : semReproducao ? evidencia.MOTIVO_CAUSA
        : semResultado || evidencia.MOTIVO_SEM_RECIBO);
    } else if (semVermelho) {
      s.contadores = s.contadores || {};
      s.contadores.teste_sem_vermelho = (s.contadores.teste_sem_vermelho || 0) + 1;
      motivos.push(semVermelho);
    }
    barrar(e, s, motivos.concat(doTurno), semPrompt);
  });
});
