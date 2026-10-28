'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { CALADOS, TOKENS_CONTEXTO } = require('./continuo.js');
const { veioDeSubagente } = require('./texto.js');

// Gatilhos CONTAVEIS, do arquivo de regras do projeto. Basta UM; nao e preciso somar.
// O que nao da para contar nao vira gatilho fingido: fica de fora. O tamanho do contexto conta desde a
// D445: o Stop nao o recebe, mas recebe o transcript_path, e o ultimo `usage` dele da o numero.
const LIMIARES_PADRAO = {
  turnosComTrabalho: 15,   // conversa longa com edicao a cada turno
  revisoesFechadas: 2,     // 2+ tarefas com revisao independente fechadas
  bloqueios: 6,            // soma dos disparos de portao: sinal de desgaste
  arquivosTocados: 25,     // diff largo demais para caber na cabeca
  decisoesDoDono: 3,       // T10-2: respostas do dono a AskUserQuestion
  commits: 3,              // T10-3: git commit que passou (3, nao 1: o aviso sai uma vez por sessao)
  // D475 (revoga o 250000 da D464): a D464 contou o Read da abertura como gravacao do handoff. Medido corrigido
  // (so a escrita), a troca custa US$ 1,56 e 175K e o menor limiar em que trocar no fim de turno do dono nao
  // encarece (-1,6%; 250K -3,2%). Quem gravou o proprio limiar no projeto.json fica com ele (medirTodos).
  tokensDeContexto: 175000,
  // D464: re-aviso firme, uma vez, mesmo depois do aviso de saude: acima de 500K a chamada custa 4x a de 200-300K.
  tokensAlarme: 450000
};

// D445: so a cauda do transcript (ele passa de MB numa sessao longa); o ultimo `usage` esta no fim.
const CAUDA_DO_TRANSCRIPT = 256 * 1024;

/**
 * D445: tamanho do contexto da linha principal = input + cache_read + cache_creation do ULTIMO `usage`
 * do transcript (a mesma conta da medicao da s73). Pula linha de subagente (isSidechain), a sintetica
 * (tudo zero) e linha torta. Sem leitura (sem caminho, arquivo ausente, nenhum usage na cauda): null.
 * O transcript e escrito de forma assincrona: a leitura pode vir um turno atrasada.
 */
function contextoDoTranscript(caminho) {
  const c = ultimaChamadaDoTranscript(caminho);
  return c ? c.contexto : null;
}

/**
 * Plano 084 (D549): a mesma leitura do contextoDoTranscript, com o horario (ms, do `timestamp` da linha) e o
 * `model` da ultima chamada. Horario ilegivel ou modelo ausente vem null; o contexto vem igual.
 */
function ultimaChamadaDoTranscript(caminho) {
  const texto = caudaDoTranscript(caminho);
  if (texto === null) return null;
  const linhas = texto.split('\n');
  // a primeira linha da cauda pode vir cortada no meio: o JSON.parse a recusa e ela fica de fora
  for (let i = linhas.length - 1; i >= 0; i--) {
    if (!linhas[i]) continue;
    let o;
    try { o = JSON.parse(linhas[i]); } catch (e) { continue; }
    if (!o || o.isSidechain === true) continue;
    const u = o.message && o.message.usage;
    if (!u) continue;
    const total = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    if (total > 0) {
      const horario = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
      const modelo = o.message.model;
      return { contexto: total, horario: isFinite(horario) ? horario : null,
        modelo: typeof modelo === 'string' && modelo ? modelo : null };
    }
  }
  return null;
}

/** A cauda do transcript como texto; sem caminho ou sem leitura, null. */
function caudaDoTranscript(caminho) {
  if (typeof caminho !== 'string' || !caminho) return null;
  try {
    const fd = fs.openSync(caminho, 'r');
    try {
      const tamanho = fs.fstatSync(fd).size;
      const n = Math.min(tamanho, CAUDA_DO_TRANSCRIPT);
      const buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, tamanho - n);
      return buf.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch (e) { return null; }
}

// D634 (7b/8): o que conta como rodar teste (alem da provaDePronto do projeto), o que edita e o que nao e codigo.
const COMANDOS_DE_TESTE = ['npm test', 'npm run test', 'pnpm test', 'yarn test', 'node --test', 'pytest', 'go test',
  'cargo test', 'dotnet test', 'mvn test', 'gradle test', 'jest', 'vitest', 'mocha'];
const FERRAMENTAS_DE_COMANDO = ['Bash', 'PowerShell'];
const FERRAMENTAS_DE_EDICAO = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
const NAO_E_CODIGO = /\.(?:md|markdown|txt|rst|adoc)$/i;

/** Os pedacos da provaDePronto que o comando tem de conter: sem o `cd` (o agente o escreve do seu jeito). */
function pedacosDaProva(prova) {
  const pedacos = String(prova).split(/;|&&|\|\|/).map(function (p) { return p.trim(); }).filter(Boolean);
  const sem = pedacos.filter(function (p) { return !/^(?:cd|pushd|Set-Location)\b/i.test(p); });
  return sem.length ? sem : pedacos;
}

/**
 * D634 (7b/8): na cauda do transcript, o ultimo teste que rodou (`{ comando, falhou }` ou null) e se a provaDePronto
 * nao rodou depois da ultima edicao de codigo (`provaPendente`; sem prova declarada, false). Falhou = saida diferente
 * de 0 (is_error, medido na s129) ou saida que mostra falha (o pipe zera o codigo). Teste sem resultado na cauda nao
 * conta. Pula linha de subagente. Sem leitura, null. Limite: edicao feita por comando de shell nao se ve aqui.
 */
function testesDoTranscript(caminho, prova) {
  const texto = caudaDoTranscript(caminho);
  if (texto === null) return null;
  // Tardios de proposito: saude.js carrega em quase todo gancho, e estes dois (com o que puxam) so servem ao fecho.
  const rodouTeste = require('./medicao-travas.js').rodouTeste;
  const textoMostraFalha = require('./evidencia.js').textoMostraFalha;
  const pedacos = typeof prova === 'string' && prova.trim() ? pedacosDaProva(prova) : null;
  const ehProva = function (c) { return pedacos !== null && pedacos.every(function (p) { return rodouTeste([c], p); }); };
  const pendentes = Object.create(null);
  let ultimoTeste = null;
  let ultimaEdicao = -1;
  let ultimaProva = -1;
  texto.split('\n').forEach(function (linha, i) {
    let o;
    try { o = JSON.parse(linha); } catch (e) { return; }
    if (!o || o.isSidechain === true || !o.message || !Array.isArray(o.message.content)) return;
    o.message.content.forEach(function (b) {
      if (!b) return;
      const entrada = b.input || {};
      if (b.type === 'tool_use' && FERRAMENTAS_DE_COMANDO.indexOf(b.name) !== -1 && typeof entrada.command === 'string') {
        const daProva = ehProva(entrada.command);
        if (daProva) ultimaProva = i;
        if (b.id && (daProva || rodouTeste([entrada.command], COMANDOS_DE_TESTE))) pendentes[b.id] = entrada.command;
      } else if (b.type === 'tool_use' && FERRAMENTAS_DE_EDICAO.indexOf(b.name) !== -1) {
        const arquivo = entrada.file_path || entrada.notebook_path;
        if (typeof arquivo === 'string' && !NAO_E_CODIGO.test(arquivo)) ultimaEdicao = i;
      } else if (b.type === 'tool_result' && b.tool_use_id in pendentes) {
        const saida = Array.isArray(b.content)
          ? b.content.map(function (x) { return x && typeof x.text === 'string' ? x.text : ''; }).join('\n') : b.content;
        ultimoTeste = { comando: pendentes[b.tool_use_id], falhou: b.is_error === true || textoMostraFalha(saida) };
      }
    });
  });
  return { ultimoTeste: ultimoTeste, provaPendente: pedacos !== null && ultimaEdicao > ultimaProva };
}

/**
 * Todo balde de trava que NEGA. Balde novo que fique de fora daqui some do
 * gatilho de saude em silencio: o portao continua negando, e o sinal de "esta
 * sessao ja bateu demais na trave" para de contar aquela trave.
 *
 * Aconteceu de verdade quando as travas 7 e 8 entraram - por isso a lista virou
 * constante exportada, e ha um teste que a confere contra o que os portoes
 * realmente incrementam (test/baldes.test.js). Lista escrita a mao envelhece calada.
 */
const BALDES_DE_BLOQUEIO = [
  'fora_do_escopo', 'sem_escopo', 'comando_destrutivo', 'shell_idioma_errado',
  'fecho_sem_evidencia', 'subitem_pendente', 'outra_frente', 'intocavel',
  'token_fora_do_sistema', 'agente_caro_em_marcha_rapida',
  'criou_sem_buscar', 'catraca_afrouxada', 'cd_solto', 'sem_manual', 'commit_sem_revisao',
  // T11-1: estilo escrito por comando de shell (modulo de design, como o token_fora_do_sistema).
  'estilo_por_shell',
  // F6-04: nome de frente invalido e "Fora" declarado tinham o balde fora_do_escopo; agora cada um tem o seu.
  'frente_invalida', 'fora_declarado',
  // D412: handoff gravado no turno sem o prompt no chat.
  'handoff_sem_prompt',
  // D503 (0.8.1): entrega AAA sem revisao contra a referencia de topo na sessao.
  'fecho_sem_referencia',
  // D655: entrega com arquivo AAA mudado sem revisao aprovada na sessao.
  'fecho_sem_revisao',
  // D678 T2: agente dos degraus chamado com model ou effort fora da tabela.
  'chamada_fora_da_tabela',
  // D694 (T3 da escada): fim do turno com pedido de escalada sem despacho.
  'escalada_sem_despacho'
];

/**
 * D495: so o limiar gravado que e numero positivo vale; o resto (null, 0, negativo, texto) cai no padrao.
 * Sem isso, `>= null` cruzava com zero: `tokensAlarme: null` dava o alarme no comeco da conversa.
 */
function limiaresValidos(limiares) {
  const L = {};
  for (const k of Object.keys(LIMIARES_PADRAO)) {
    const v = limiares && limiares[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) L[k] = v;
  }
  return L;
}

function soma(contadores, chaves) {
  return chaves.reduce(function (t, k) { return t + ((contadores && contadores[k]) || 0); }, 0);
}

/**
 * Bloco M / M1 (D435): os gatilhos contaveis (7 desde a D445), cruzados ou nao, com valor e limiar - o que o
 * medidor da sessao mostra. Fonte unica da regra: `avaliar` monta os gatilhos daqui.
 * Diferente do `avaliar`, nao se cala com `avisouSaude`: o aviso ja dado nao zera o painel.
 */
function medir(estado, limiares, continuo) {
  // D493: com o modo continuo, o padrao do tamanho e o do continuo.js; o numero gravado pelo projeto manda.
  const validos = limiaresValidos(limiares);
  const proprio = 'tokensDeContexto' in validos;
  const L = continuo === true && !proprio
    ? Object.assign({}, validos, { tokensDeContexto: TOKENS_CONTEXTO }) : validos;
  return medirTodos(estado, L).map(function (g) {
    // D468: com o modo continuo (so o booleano true), os gatilhos da lista do continuo.js nao cruzam.
    return continuo === true && CALADOS.indexOf(g.chave) !== -1 ? Object.assign(g, { cruzou: false, calado: true }) : g;
  });
}

function medirTodos(estado, limiares) {
  const e = estado || {};
  const L = Object.assign({}, LIMIARES_PADRAO, limiares || {});
  const c = e.contadores || {};
  const item = function (chave, nome, valor, cruzou, texto) {
    return { chave: chave, nome: nome, valor: valor, limiar: L[chave], cruzou: cruzou, texto: texto };
  };
  const turnos = e.turnosComTrabalho || 0;
  const revisoes = c.revisao_fechada || 0;
  const bloqueios = soma(c, BALDES_DE_BLOQUEIO);
  // Array.isArray, como o typeof abaixo: texto ou objeto no estado corrompido nunca vira aviso.
  const arquivos = Array.isArray(e.arquivosTocados) ? e.arquivosTocados.length : 0;
  // typeof: estado corrompido (objeto, texto) nunca vira aviso.
  const decisoes = typeof e.decisoesDoDono === 'number' ? e.decisoesDoDono : 0;
  const commits = typeof e.commitsFeitos === 'number' ? e.commitsFeitos : 0;
  const contexto = typeof e.tokensDeContexto === 'number' ? e.tokensDeContexto : 0;
  return [
    item('turnosComTrabalho', 'turnos com trabalho real', turnos, turnos >= L.turnosComTrabalho,
      turnos + ' turnos com trabalho real (limiar ' + L.turnosComTrabalho + ')'),
    item('revisoesFechadas', 'revisoes independentes fechadas', revisoes, revisoes >= L.revisoesFechadas,
      revisoes + ' revisoes independentes fechadas (limiar ' + L.revisoesFechadas + ')'),
    item('bloqueios', 'bloqueios de portao', bloqueios, bloqueios >= L.bloqueios,
      bloqueios + ' bloqueios de portao nesta sessao (limiar ' + L.bloqueios + ')'),
    item('arquivosTocados', 'arquivos tocados', arquivos, arquivos >= L.arquivosTocados,
      arquivos + ' arquivos tocados (limiar ' + L.arquivosTocados + ')'),
    item('decisoesDoDono', 'decisoes do dono respondidas', decisoes,
      typeof e.decisoesDoDono === 'number' && decisoes >= L.decisoesDoDono,
      decisoes + ' decisoes do dono respondidas (limiar ' + L.decisoesDoDono + ')'),
    item('commits', 'commits nesta sessao', commits,
      typeof e.commitsFeitos === 'number' && commits >= L.commits,
      commits + ' commits nesta sessao (limiar ' + L.commits + ')'),
    item('tokensDeContexto', 'tokens de contexto', contexto,
      typeof e.tokensDeContexto === 'number' && contexto >= L.tokensDeContexto,
      contexto + ' tokens de contexto (limiar ' + L.tokensDeContexto + ')')
  ];
}

/** D123: o balde do TURNO somado ao da SESSAO - a conta que o gatilho de saude le. Nao muda a entrada. */
function acumular(estado) {
  const s = estado || {};
  const acumulados = Object.assign({}, s.contadoresSessao || {});
  const turno = s.contadores || {};
  for (const chave of Object.keys(turno)) {
    acumulados[chave] = (acumulados[chave] || 0) + turno[chave];
  }
  return acumulados;
}

/**
 * O aviso de saude sai uma vez por sessao (`avisouSaude`). D464: o alarme de tamanho (`tokensAlarme`) e
 * um segundo aviso, firme, que sai uma vez (`avisouAlarme`) mesmo depois do primeiro; acima dele sem
 * aviso anterior, sai um aviso so, o de alarme, com o gatilho de tamanho trocado pelo do alarme.
 */
function avaliar(estado, limiares, continuo) {
  const e = estado || {};
  const L = Object.assign({}, LIMIARES_PADRAO, limiaresValidos(limiares));
  // typeof, como no medir: estado corrompido nunca vira alarme.
  const alarme = typeof e.tokensDeContexto === 'number' && e.avisouAlarme !== true &&
    e.tokensDeContexto >= L.tokensAlarme;
  if (e.avisouSaude && !alarme) return { disparou: false, alarme: false, gatilhos: [], aviso: null };

  let cruzados = e.avisouSaude ? [] : medir(e, limiares, continuo).filter(function (g) { return g.cruzou; });
  if (alarme) {
    cruzados = cruzados.filter(function (g) { return g.chave !== 'tokensDeContexto'; });
    cruzados.push({ texto: e.tokensDeContexto + ' tokens de contexto (alarme ' + L.tokensAlarme + ')' });
  }
  const gatilhos = cruzados.map(function (g) { return g.texto; });

  if (!gatilhos.length) return { disparou: false, alarme: false, gatilhos: [], aviso: null };

  return { disparou: true, alarme: alarme, gatilhos: gatilhos, aviso: avisoDeSaude(gatilhos, alarme) };
}

// D704 (pedido 14): o handoff so depois que os agentes em segundo plano da sessao terminarem. Sinal medido (sondas
// s173/s174): o subagente grava <pasta da transcricao>/<sessao>/subagents/agent-<id>.meta.json ao nascer sem `finished`
// e ganha "finished": true ao terminar. O parado por TaskStop nao ganha: a ultima linha do .jsonl dele e a interrupcao.
// O que morre sem marca sai pelo silencio: em 1523 agentes de fundo terminados (2026-10-20 a 10-27), p99 de 156 s sem
// escrever e 2 acima de 15 min (o maior, 49 min, ja tinha entregue o relatorio e esperava um aviso).
const SILENCIO_DO_AGENTE_MS = 30 * 60 * 1000;
const RE_INTERROMPIDO = /^\[Request interrupted by user/;

/**
 * D704: os agentes de fundo da sessao da transcricao `caminho` que ainda rodam em `agora` (ms), [{ id, descricao }].
 * Fica de fora o que tem "finished": true, o de primeiro plano (o turno ja esperou por ele), o parado (ultima linha do
 * .jsonl e a interrupcao) e o que nao escreve ha SILENCIO_DO_AGENTE_MS (sem .jsonl ainda, vale a data do meta.json).
 * Sem pasta ou sem leitura: [] - o aviso sai como antes da D704.
 */
function agentesRodando(caminho, agora) {
  if (typeof caminho !== 'string' || !caminho) return [];
  const pasta = path.join(path.dirname(caminho), path.basename(caminho).replace(/\.jsonl$/i, ''), 'subagents');
  let nomes;
  try { nomes = fs.readdirSync(pasta).sort(); } catch (e) { return []; }
  const lista = [];
  for (const nome of nomes) {
    const m = /^agent-(.+)\.meta\.json$/i.exec(nome);
    if (!m) continue;
    const meta = path.join(pasta, nome);
    let dados;
    try { dados = JSON.parse(fs.readFileSync(meta, 'utf8')); } catch (e) { continue; }
    if (!dados || dados.finished === true || dados.requestShape !== 'background') continue;
    const jsonl = path.join(pasta, 'agent-' + m[1] + '.jsonl');
    let escrito;
    try { escrito = fs.statSync(jsonl).mtimeMs; } catch (e) {
      try { escrito = fs.statSync(meta).mtimeMs; } catch (x) { continue; }
    }
    if (agora - escrito >= SILENCIO_DO_AGENTE_MS || foiParado(jsonl)) continue;
    lista.push({ id: m[1], descricao: typeof dados.description === 'string' ? dados.description : '' });
  }
  return lista;
}

/** D704: a ultima linha legivel do .jsonl do agente e a interrupcao do TaskStop (medida na s174). */
function foiParado(jsonl) {
  const texto = caudaDoTranscript(jsonl);
  if (texto === null) return false;
  const linhas = texto.split('\n');
  for (let i = linhas.length - 1; i >= 0; i--) {
    let o;
    try { o = JSON.parse(linhas[i]); } catch (e) { continue; }
    if (!o || typeof o !== 'object') continue;
    const c = o.message && o.message.content;
    const t = typeof c === 'string' ? c : (Array.isArray(c) && c[0] ? c[0].text : null);
    return o.type === 'user' && typeof t === 'string' && RE_INTERROMPIDO.test(t);
  }
  return false;
}

/** D704: quantos agentes seguram o handoff e quais, um por linha, em ASCII (o texto chega ao modelo, R5). */
function linhasDosAgentes(rodando) {
  const ascii = require('./escopo.js').ascii;
  return [rodando.length + (rodando.length === 1 ? ' agente em segundo plano desta sessao ainda roda:' :
    ' agentes em segundo plano desta sessao ainda rodam:')].concat(rodando.map(function (a) {
    return '  - ' + (a.descricao ? ascii(a.descricao).slice(0, 80) + ' ' : '') + '(agent-' + ascii(a.id) + ')';
  }));
}

/**
 * Plano 082, Tarefa 5 (mock S10): o aviso de troca de chat na forma unica dos avisos. Vai ao usuario (systemMessage).
 * D704: com `rodando` (agentesRodando) nao vazio, o "faca assim" manda esperar os agentes antes do handoff.
 */
function avisoDeSaude(gatilhos, alarme, rodando) {
  // p7-21: sem gatilho nao ha aviso, como no avaliar (a lista nula lancava; a vazia saia um alarme sem motivo).
  if (!Array.isArray(gatilhos) || gatilhos.length === 0) return null;
  const lista = gatilhos.map(function (g) { return '  - ' + g; }).join('\n');
  const espera = Array.isArray(rodando) && rodando.length > 0;
  return (alarme ? [
    'sworn - ALARME: troque de chat agora; esta conversa ficou cara demais.',
    '',
    'Ela passou do tamanho em que cada chamada custa varias vezes a de um chat novo:',
    lista
  ] : [
    'sworn - hora de abrir chat novo.',
    '',
    'Gatilho contavel disparou:',
    lista,
    'Se surgiu a duvida "ja e hora?", ja era.'
  ]).concat([''], espera ? linhasDosAgentes(rodando).concat([
    'Faca assim: espere todos terminarem e nao pare nenhum; o aviso volta quando o ultimo terminar.',
    'Ai rode /sworn:handoff, cole o prompt pronto num chat novo e continue de la.'
  ]) : [
    'Faca assim: rode /sworn:handoff, cole o prompt pronto num chat novo e continue de la.'
  ]).join('\n');
}

/** D704: o que o modelo faz enquanto agentes seguram o handoff (sem a ordem de rodar agora). */
function esperaAoModelo(rodando, porque) {
  return linhasDosAgentes(rodando).concat([
    'Faca agora, nesta mesma resposta:',
    '1. Diga ao usuario, com todas as letras, que e hora de abrir chat novo, ' + porque + ', e que o handoff sai',
    '   quando o ultimo agente acima terminar.',
    '2. Nao rode /sworn:handoff agora, nao dispare agente novo e nao pare nenhum dos que rodam.'
  ]);
}

/**
 * T10-1 (D357): o texto que vai ao MODELO quando a saude dispara (additionalContext do Stop).
 * O aviso de `avaliar` e para o usuario; este e a ordem para o Claude agir na mesma resposta.
 * D412: com `promptJaColado === true` (o turno gravou o handoff e a resposta final ja tem o bloco)
 * a ordem nao manda rodar nem colar de novo - mandar colar sem olhar a resposta era a duplicacao
 * que a decisao 650 da extensao tentou evitar tirando a ordem de colar.
 * So o booleano `true` muda a ordem, de proposito: um valor truthy qualquer (estado corrompido) cai
 * na ordem de colar. Na duvida, colar duas vezes custa menos que o prompt nao chegar ao chat.
 * D704: com `rodando` nao vazio, a ordem e esperar, mesmo com o prompt ja colado: o handoff de antes do fim dos
 * agentes e o que sai velho.
 */
function instrucaoAoModelo(gatilhos, promptJaColado, rodando) {
  if (Array.isArray(rodando) && rodando.length > 0) {
    return [
      'sworn: gatilho contavel de saude do contexto disparou. E hora de abrir chat novo, mas ainda nao de rodar o handoff.',
      (gatilhos || []).map(function (g) { return '  - ' + g; }).join('\n')
    ].concat(esperaAoModelo(rodando, 'cite o gatilho acima que disparou'), [
      'O aviso de termino de cada agente chega sozinho; a ordem do handoff vem no primeiro fim de turno sem agente rodando.'
    ]).join('\n');
  }
  if (promptJaColado === true) {
    return [
      'sworn: gatilho contavel de saude do contexto disparou. E hora de abrir chat novo.',
      (gatilhos || []).map(function (g) { return '  - ' + g; }).join('\n'),
      'O prompt do handoff ja esta no bloco de codigo da sua resposta acima: nao rode o handoff de novo e',
      'nao cole o bloco outra vez. Nesta mesma resposta, diga ao usuario, com todas as letras, que e hora',
      'de abrir chat novo, cite o gatilho acima que disparou e aponte para o bloco acima.',
      'Nao pergunte "sigo?" antes de oferecer a troca: a troca vem primeiro.'
    ].join('\n');
  }
  return [
    'sworn: gatilho contavel de saude do contexto disparou. E hora de abrir chat novo.',
    (gatilhos || []).map(function (g) { return '  - ' + g; }).join('\n'),
    'Faca agora, nesta mesma resposta:',
    '1. Rode /sworn:handoff.',
    '2. Diga ao usuario, com todas as letras, que e hora de abrir chat novo, e cite o gatilho acima que disparou.',
    '3. Cole o prompt pronto do handoff no chat, em bloco de codigo (nao basta gravar no arquivo).',
    'Nao pergunte "sigo?" antes de oferecer a troca: a troca vem primeiro.'
  ].join('\n');
}

const NOME_DA_SAUDE = '(?:contexto|memoria|context(?: window)?|memory)';
const ESTADO_DA_SAUDE = '(?:bom|boa|ok|okay|cheio|cheia|lotado|lotada|estourando|saudavel|aguenta|aguentando|full|fine|healthy|good|enough)';
const PERGUNTAS_DE_SAUDE = [
  // "o contexto esta bom?", "contexto ta cheio?", "sua memoria esta ok?", "is your context getting full?"
  new RegExp('\\b' + NOME_DA_SAUDE + '\\s+(?:\\w+\\s+){0,2}?' + ESTADO_DA_SAUDE + '\\b'),
  // "como esta a memoria?", "how is your context?", "how is the context window doing?"
  new RegExp('\\b(?:como\\s+(?:esta|ta|anda)|how(?:\'s|s| is| are))\\s+(?:\\w+\\s+){0,2}?' + NOME_DA_SAUDE +
    '\\s*(?:doing|going|looking|\\?|$)')
];

/**
 * T10-4 (D357): o usuario perguntou se o contexto/memoria da conversa esta bom? Conservador de
 * proposito: precisa do substantivo E de um termo de estado, E de cara de pergunta - "adicione
 * contexto ao README" e "memory leak no modulo" nao disparam. A pergunta E a resposta.
 */
function perguntaSobreSaude(prompt) {
  if (typeof prompt !== 'string') return false;
  const t = prompt.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return false;
  // D475: o inspetor que CITA a pergunta nao e o usuario perguntando (filtro em texto.js, D484).
  if (veioDeSubagente(prompt)) return false;
  const temCaraDePergunta = t.indexOf('?') !== -1 ||
    /^(?:como|how|is|are|esta|ta|ainda|qual)\b/.test(t) ||
    new RegExp('^(?:o |a |seu |sua |esse |essa |your |the |this )?' + NOME_DA_SAUDE + ' (?:esta|ta|ainda)\\b').test(t);
  if (!temCaraDePergunta) return false;
  return PERGUNTAS_DE_SAUDE.some(function (re) { return re.test(t); });
}

/** T10-4: o que o modelo recebe quando o usuario pergunta pela saude do contexto. */
const INSTRUCAO_DA_PERGUNTA = [
  'sworn: o usuario perguntou se o contexto/memoria desta conversa esta bom. A pergunta E a resposta:',
  'e hora de trocar de chat. Faca agora, nesta mesma resposta:',
  '1. Rode /sworn:handoff.',
  '2. Diga ao usuario, com todas as letras, que e hora de abrir chat novo, e por que (ele perguntou).',
  '3. Cole o prompt pronto do handoff no chat, em bloco de codigo.',
  'Nao responda "esta tudo bem" nem pergunte "sigo?" antes de oferecer a troca.'
].join('\n');

/**
 * D704: a resposta a pergunta pela saude com os agentes de fundo da sessao (`rodando`, agentesRodando). Sem agente,
 * INSTRUCAO_DA_PERGUNTA. Com agente, esperar; esta ordem diz ela mesma quando rodar o handoff, porque a pergunta
 * nao passa pelo Stop que a daria depois.
 */
function instrucaoDaPergunta(rodando) {
  if (!Array.isArray(rodando) || rodando.length === 0) return INSTRUCAO_DA_PERGUNTA;
  return [
    'sworn: o usuario perguntou se o contexto/memoria desta conversa esta bom. A pergunta E a resposta:',
    'e hora de trocar de chat, mas ainda nao de rodar o handoff.'
  ].concat(esperaAoModelo(rodando, 'e por que (ele perguntou)'), [
    '3. Quando o ultimo terminar, rode /sworn:handoff e cole o prompt pronto no chat, em bloco de codigo (o aviso de',
    '   termino de cada agente chega sozinho).',
    'Nao responda "esta tudo bem" nem pergunte "sigo?" antes de oferecer a troca.'
  ]).join('\n');
}

/**
 * D412: arquivo de handoff = `.md` com data AAAA-MM-DD- na frente do nome e "handoff" no nome
 * (`<data>-<slug>-handoff.md`, o padrao dos planos) ou na pasta (`handoff/<data>-<slug>.md`, onde
 * a skill grava, skills/handoff/SKILL.md:25). A data exclui a propria skill (`handoff/SKILL.md`).
 */
function ehArquivoDeHandoff(caminho) {
  if (typeof caminho !== 'string' || !caminho) return false;
  const partes = caminho.replace(/\\/g, '/').split('/');
  const nome = partes[partes.length - 1];
  const pasta = partes.length > 1 ? partes[partes.length - 2] : '';
  if (!/^\d{4}-\d{2}-\d{2}-.*\.md$/i.test(nome)) return false;
  return /handoff/i.test(nome) || /^handoff$/i.test(pasta);
}

/**
 * D412: a resposta tem bloco de codigo? Cerca de ``` ou ~~~ em linha propria, de qualquer
 * linguagem, com corpo nao vazio. Nao confere que o bloco e o prompt: o portao le texto, nao
 * intencao (a D412 fala em "nao tem bloco de codigo").
 * Fecho como no CommonMark: mesmo caractere, comprimento >= o da abertura, so espaco depois; sem
 * fecho, o bloco vai ate o fim do texto (o prompt aparece em bloco do mesmo jeito). Uma passada
 * por linha: sem regex com retrorreferencia, que custava o texto inteiro por cerca aberta.
 * A cerca pode vir dentro de citacao (`> `) ou de item de lista (`- `, `1. `); cerca de crases com
 * crase no resto da linha de abertura nao abre (e codigo inline, CommonMark).
 * Bordas do CommonMark (D417): a cerca tem no maximo 3 colunas de recuo, contadas a partir do
 * conteudo do item de lista em que esta (4 ou mais e bloco recuado, nao cerca); a cerca aberta
 * numa citacao fecha quando a citacao acaba; dentro da cerca, so os `>` da citacao dela saem da
 * linha (os outros sao corpo); e linha em branco e so espaco e tab (NBSP e conteudo).
 */
function temBlocoDeCodigo(texto) {
  if (typeof texto !== 'string') return false;
  let cerca = null;   // { marca, nivel, base }: a cerca aberta, o nivel de citacao e a coluna da lista dela
  let corpo = false;
  let lista = 0;      // coluna do conteudo do ultimo item de lista fora de cerca (0 = fora de lista)
  let nivelDaLista = 0;
  for (const bruta of texto.split(/\r?\n/)) {
    if (cerca !== null) {
      const d = tirarCitacao(bruta, cerca.nivel);
      if (d.nivel === cerca.nivel) {
        const f = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(d.resto);
        if (f && largura(recuoDe(d.resto)) - cerca.base <= 3 &&
            f[1][0] === cerca.marca[0] && f[1].length >= cerca.marca.length) {
          if (corpo) return true;
          cerca = null;
        } else if (/[^ \t]/.test(d.resto)) {
          corpo = true;
        }
        continue;
      }
      // a citacao acabou: a cerca fecha com ela, e a linha segue como texto de fora
      if (corpo) return true;
      cerca = null;
    }
    const c = tirarCitacao(bruta, Infinity);
    if (c.nivel !== nivelDaLista) { lista = 0; nivelDaLista = c.nivel; }
    if (!/[^ \t]/.test(c.resto)) continue;
    const recuo = largura(recuoDe(c.resto));
    if (lista && recuo < lista) lista = 0;
    let base = lista;
    let resto = c.resto;
    const item = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/.exec(resto);
    if (item && recuo - base <= 3) {
      lista = largura(item[0]);
      base = lista;
      resto = ' '.repeat(base) + resto.slice(item[0].length);
    }
    const a = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(resto);
    if (a && largura(recuoDe(resto)) - base <= 3 && !(a[1][0] === '`' && a[2].indexOf('`') !== -1)) {
      cerca = { marca: a[1], nivel: c.nivel, base: base };
      corpo = false;
    }
  }
  return cerca !== null && corpo;
}

function recuoDe(linha) { return /^[ \t]*/.exec(linha)[0]; }

/** Colunas que o texto ocupa, com o tab ate a proxima parada de 4 (CommonMark). */
function largura(texto) {
  let col = 0;
  for (const ch of texto) col = ch === '\t' ? col + 4 - (col % 4) : col + 1;
  return col;
}

/**
 * Tira ate `max` marcas de citacao (`>` com ate 3 espacos antes e 1 opcional depois). O tab do
 * prefixo vira espacos pela coluna real antes (CommonMark): `>\t` deixa 3 colunas, e o espaco
 * opcional sai de uma delas.
 */
function tirarCitacao(linha, max) {
  let resto = expandirPrefixo(linha);
  let nivel = 0;
  while (nivel < max) {
    const m = /^ {0,3}> ?/.exec(resto);
    if (!m) break;
    resto = resto.slice(m[0].length);
    nivel++;
  }
  return { resto: resto, nivel: nivel };
}

/** Troca cada tab do prefixo de espaco, tab e `>` por espacos ate a proxima parada de 4. */
function expandirPrefixo(linha) {
  let saida = '';
  let col = 0;
  let i = 0;
  for (; i < linha.length; i++) {
    const ch = linha[i];
    if (ch === '\t') { saida += ' '.repeat(4 - (col % 4)); col += 4 - (col % 4); }
    else if (ch === ' ' || ch === '>') { saida += ch; col++; }
    else break;
  }
  return saida + linha.slice(i);
}

// D412/D415. R5: ASCII puro - chega ao Claude como motivo do bloqueio.
// Plano 082, Tarefa 5 (mock S10): a forma unica dos avisos.
const MOTIVO_HANDOFF_SEM_PROMPT = [
  'sworn - falta colar no chat o prompt do handoff (portao de fecho).',
  '',
  'Voce gravou um arquivo de handoff neste turno, e a sua resposta final nao tem bloco de codigo.',
  'O prompt pronto tem de chegar ao chat, nao so ao arquivo. O portao le so a resposta final:',
  'um bloco numa mensagem anterior deste turno ele nao ve.',
  '',
  'Faca assim: cole o prompt agora num bloco de codigo (tres crases ou tres tis), nesta resposta final - uma vez so.',
  '',
  'Desligar neste projeto: "portaoHandoff": false em .claude/sworn/projeto.json.'
].join('\n');

module.exports = { LIMIARES_PADRAO, BALDES_DE_BLOQUEIO, contextoDoTranscript, ultimaChamadaDoTranscript, testesDoTranscript, limiaresValidos, medir, acumular, avaliar, avisoDeSaude, instrucaoAoModelo, perguntaSobreSaude,
  INSTRUCAO_DA_PERGUNTA, ehArquivoDeHandoff, temBlocoDeCodigo, MOTIVO_HANDOFF_SEM_PROMPT,
  SILENCIO_DO_AGENTE_MS, agentesRodando, linhasDosAgentes, instrucaoDaPergunta };
