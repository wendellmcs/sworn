'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { CALADOS, TOKENS_CONTEXTO } = require('./continuo.js');
const { veioDeSubagente, semBom } = require('./texto.js');
const transcricoes = require('./transcricoes.js');
const { caudaDoTranscript } = transcricoes;

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

/**
 * D445: tamanho do contexto da linha principal = input + cache_read + cache_creation do ULTIMO `usage`
 * do transcript (a mesma conta da medicao da s73). Pula linha de subagente (isSidechain), a sintetica
 * (tudo zero) e linha torta. Sem leitura (sem caminho, arquivo ausente, nenhum usage na cauda): null.
 * O transcript e escrito de forma assincrona: a leitura pode vir um turno atrasada.
 * Pedido 6: a transcricao de outro harness entra pelo leitor dela (lib/transcricoes.js).
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
  const t = transcricoes.ler(caminho);
  return t ? t.ultimaChamada : null;
}

// D785 (2.1b): os jeitos de rodar o script `test` do package.json.
const RODAR_SCRIPT_TEST = ['npm test', 'npm run test', 'pnpm test', 'pnpm run test', 'yarn test', 'yarn run test'];

// D634 (7b/8): o que conta como rodar teste (alem da provaDePronto do projeto), o que edita e o que nao e codigo.
const COMANDOS_DE_TESTE = RODAR_SCRIPT_TEST.concat(['node --test', 'pytest', 'go test', 'cargo test', 'dotnet test',
  'mvn test', 'gradle test', 'jest', 'vitest', 'mocha']);
const FERRAMENTAS_DE_COMANDO = ['Bash', 'PowerShell'];
const FERRAMENTAS_DE_EDICAO = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
const NAO_E_CODIGO = /\.(?:md|markdown|txt|rst|adoc)$/i;

/** D785 (2.1): editar este arquivo deixa a prova pendente (texto nao). A mesma regua do transcript e do turno. */
function ehArquivoDeCodigo(arquivo) {
  return typeof arquivo === 'string' && !NAO_E_CODIGO.test(arquivo);
}

function semEspacos(t) { return t.trim().replace(/\s+/g, ' '); }

// D785 (s328): sem a opcao que roda os testes sem processo filho (o laco a manda no sandbox que barra o spawn), dos
// dois lados: o comando com ela e a prova declarada com ela seguem casando.
function semIsolamento(t) { return t.replace(/\s--(?:experimental-)?test-isolation(?:=|\s+)none(?=\s|$)/g, ''); }

/**
 * R1 da revisao s328 (borda): o rodouTeste casa por pedaco de texto, e `npm run test` caberia em `npm run test:unit`.
 * true quando o pedaco e uma forma de RODAR_SCRIPT_TEST e toda vez que aparece no comando o nome do script segue
 * (letra, digito, `:`, `.` ou `-` depois): rodou outro script. O chamador ja sabe pelo rodouTeste que o pedaco aparece.
 */
function soEmOutroScript(comando, pedaco) {
  if (RODAR_SCRIPT_TEST.indexOf(pedaco) === -1) return false;
  const c = semEspacos(String(comando));
  for (let i = c.indexOf(pedaco); i !== -1; i = c.indexOf(pedaco, i + 1)) {
    if (!/[\w:.-]/.test(c.charAt(i + pedaco.length))) return false;
  }
  return true;
}

/**
 * D785 (2.1b, bateria s327): a provaDePronto e as formas que rodam o mesmo, pelo script `test` do package.json da
 * `raiz`: prova igual ao script vale por `npm test` e afins, e a prova `npm test` vale pelo script direto. Sem prova,
 * null; sem package.json legivel, so a prova.
 */
function provasEquivalentes(prova, raiz) {
  if (typeof prova !== 'string' || !prova.trim()) return null;
  let script = null;
  try {
    script = JSON.parse(semBom(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'))).scripts.test;
  } catch (e) { /* sem package.json, ilegivel ou sem scripts: so a prova */ }
  if (typeof script !== 'string' || !script.trim()) return [prova];
  if (semEspacos(semIsolamento(script)) === semEspacos(semIsolamento(prova))) return [prova].concat(RODAR_SCRIPT_TEST);
  if (RODAR_SCRIPT_TEST.indexOf(semEspacos(prova)) !== -1) return [prova, script];
  return [prova];
}

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
 * D785 (2.1b): `prova` tambem pode ser a lista de formas de `provasEquivalentes`; rodar qualquer uma e rodar a prova.
 * D785 (s328): saida com spawn EPERM poe `barradoPeloSandbox: true` no ultimo teste.
 */
function testesDoTranscript(caminho, prova) {
  const t = transcricoes.ler(caminho);
  if (t === null) return null;
  // Tardios de proposito: saude.js carrega em quase todo gancho, e estes dois (com o que puxam) so servem ao fecho.
  const rodouTeste = require('./medicao-travas.js').rodouTeste;
  const { textoMostraFalha, saidaBarradaPeloSandbox } = require('./evidencia.js');
  const formas = [].concat(prova).filter(function (p) { return typeof p === 'string' && p.trim(); });
  // Forma sem pedaco (so separadores) sai: o every da lista vazia casaria com qualquer comando.
  const listas = formas.map(function (f) { return pedacosDaProva(semIsolamento(f)); })
    .filter(function (ps) { return ps.length > 0; });
  const pedacos = listas.length ? listas : null;
  const ehProva = function (comando) {
    const c = semIsolamento(comando);
    return pedacos !== null &&
      pedacos.some(function (ps) {
        return ps.every(function (p) { return rodouTeste([c], p) && !soEmOutroScript(c, p); });
      });
  };
  const pendentes = Object.create(null);
  let ultimoTeste = null;
  let ultimaEdicao = -1;
  let ultimaProva = -1;
  t.eventos.forEach(function (ev) {
    const entrada = ev.entrada || {};
    if (ev.tipo === 'chamada' && FERRAMENTAS_DE_COMANDO.indexOf(ev.nome) !== -1 && typeof entrada.command === 'string') {
      const daProva = ehProva(entrada.command);
      if (daProva) ultimaProva = ev.pos;
      if (ev.id && (daProva || rodouTeste([entrada.command], COMANDOS_DE_TESTE))) pendentes[ev.id] = entrada.command;
    } else if (ev.tipo === 'chamada' && FERRAMENTAS_DE_EDICAO.indexOf(ev.nome) !== -1) {
      const arquivo = entrada.file_path || entrada.notebook_path;
      if (ehArquivoDeCodigo(arquivo)) ultimaEdicao = ev.pos;
    } else if (ev.tipo === 'resultado' && ev.id in pendentes) {
      ultimoTeste = { comando: pendentes[ev.id], falhou: ev.falhou === true || textoMostraFalha(ev.saida) };
      if (saidaBarradaPeloSandbox(ev.saida)) ultimoTeste.barradoPeloSandbox = true;
    }
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
  // D786 passo 5: edicao antes de cumprir a ordem do compact (reler ou gravar o handoff).
  'ordem_do_compact',
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
    // A5-70: cada item diz o que conta, no molde do de bloqueios (A5-14); arquivos e commits ja se explicam.
    item('turnosComTrabalho', 'turnos com trabalho real', turnos, turnos >= L.turnosComTrabalho,
      turnos + ' turnos com trabalho real (respostas em que o Claude leu, buscou, editou ou rodou algo) nesta sessao' +
      ' (limiar ' + L.turnosComTrabalho + ')'),
    item('revisoesFechadas', 'revisoes independentes fechadas', revisoes, revisoes >= L.revisoesFechadas,
      revisoes + ' revisoes independentes fechadas (revisoes as cegas do /sworn:review concluidas) nesta sessao' +
      ' (limiar ' + L.revisoesFechadas + ')'),
    item('bloqueios', 'bloqueios de portao', bloqueios, bloqueios >= L.bloqueios,
      // A5-14 (D735): o que e o bloqueio, para o usuario que le o aviso.
      bloqueios + ' bloqueios de portao (acoes que o sworn negou) nesta sessao (limiar ' + L.bloqueios + ')'),
    item('arquivosTocados', 'arquivos tocados', arquivos, arquivos >= L.arquivosTocados,
      arquivos + ' arquivos tocados (limiar ' + L.arquivosTocados + ')'),
    item('decisoesDoDono', 'decisoes do dono respondidas', decisoes,
      typeof e.decisoesDoDono === 'number' && decisoes >= L.decisoesDoDono,
      decisoes + ' decisoes do dono respondidas (respostas as perguntas de escolha do Claude) nesta sessao' +
      ' (limiar ' + L.decisoesDoDono + ')'),
    item('commits', 'commits nesta sessao', commits,
      typeof e.commitsFeitos === 'number' && commits >= L.commits,
      commits + ' commits nesta sessao (limiar ' + L.commits + ')'),
    item('tokensDeContexto', 'tokens de contexto', contexto,
      typeof e.tokensDeContexto === 'number' && contexto >= L.tokensDeContexto,
      contexto + ' tokens de contexto, o tamanho desta conversa (limiar ' + L.tokensDeContexto + ')')
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

  // D786 passo 3: depois da compactacao que seguiu um aviso (`saudeRearmada`), so o tamanho volta a valer: os outros
  // gatilhos contam a sessao inteira, que a compactacao nao zera, e o aviso deles sai uma vez por sessao.
  let cruzados = e.avisouSaude ? [] : medir(e, limiares, continuo).filter(function (g) {
    return g.cruzou && (e.saudeRearmada !== true || g.chave === 'tokensDeContexto');
  });
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
 * O agente de workflow entra pelo journal do run (agentesDeWorkflow). Sem pasta ou sem leitura: [] - o aviso sai como
 * antes da D704.
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
    if (!escreveAinda(path.join(pasta, 'agent-' + m[1] + '.jsonl'), meta, agora)) continue;
    lista.push({ id: m[1], descricao: typeof dados.description === 'string' ? dados.description : '' });
  }
  return lista.concat(agentesDeWorkflow(path.join(pasta, 'workflows'), agora));
}

/**
 * A5 (fila a, medida na s215): o agente de workflow mora em subagents/workflows/<run>/, com requestShape "foreground"
 * e sem `finished` mesmo depois de terminar. Quem diz se acabou e o journal.jsonl do run: `started` {agentId, label}
 * abre, qualquer linha posterior do mesmo agentId (o `result`) fecha. O aberto passa pelo mesmo silencio e pela mesma
 * interrupcao do agente de fundo (sem o .jsonl dele ainda, vale a data do journal).
 */
function agentesDeWorkflow(pasta, agora) {
  let runs;
  try { runs = fs.readdirSync(pasta).sort(); } catch (e) { return []; }
  const lista = [];
  for (const run of runs) {
    const journal = path.join(pasta, run, 'journal.jsonl');
    let texto;
    try { texto = fs.readFileSync(journal, 'utf8'); } catch (e) { continue; }
    const abertos = new Map();
    for (const linha of texto.split('\n')) {
      let o;
      try { o = JSON.parse(linha); } catch (e) { continue; }
      if (!o || typeof o.agentId !== 'string' || !o.agentId) continue;
      if (o.type === 'started') abertos.set(o.agentId, typeof o.label === 'string' ? o.label : '');
      else abertos.delete(o.agentId);
    }
    for (const [id, rotulo] of abertos) {
      const jsonl = path.join(pasta, run, 'agent-' + id + '.jsonl');
      if (escreveAinda(jsonl, journal, agora)) lista.push({ id: id, descricao: rotulo });
    }
  }
  return lista;
}

/** O agente escreveu ha menos de SILENCIO_DO_AGENTE_MS e nao foi parado; sem o `jsonl` dele, vale a data de `reserva`. */
function escreveAinda(jsonl, reserva, agora) {
  let escrito;
  try { escrito = fs.statSync(jsonl).mtimeMs; } catch (e) {
    try { escrito = fs.statSync(reserva).mtimeMs; } catch (x) { return false; }
  }
  return agora - escrito < SILENCIO_DO_AGENTE_MS && !foiParado(jsonl);
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
 * Plano 082, Tarefa 5 (mock S10): o aviso do gatilho de saude na forma unica dos avisos. Vai ao usuario
 * (systemMessage).
 * D704: com `rodando` (agentesRodando) nao vazio, o handoff espera os agentes.
 * D786 passo 2: o handoff e gravado e o trabalho segue nesta conversa; a compactacao do harness o rele. O alarme da o
 * atalho de baixar o custo ja: compactar a mao.
 */
function avisoDeSaude(gatilhos, alarme, rodando) {
  // p7-21: sem gatilho nao ha aviso, como no avaliar (a lista nula lancava; a vazia saia um alarme sem motivo).
  if (!Array.isArray(gatilhos) || gatilhos.length === 0) return null;
  const lista = gatilhos.map(function (g) { return '  - ' + g; }).join('\n');
  const espera = Array.isArray(rodando) && rodando.length > 0;
  return (alarme ? [
    'sworn - ALARME: esta conversa ficou cara demais.',
    '',
    'Ela passou do tamanho em que cada chamada custa varias vezes a de uma conversa curta:',
    lista
  ] : [
    'sworn - hora do handoff: o trabalho segue nesta conversa.',
    '',
    // A5-13 e A5-14 (D735): o que e o numero e o passo, sem "gatilho contavel" nem giria.
    'O sworn faz contas nesta conversa, e o que esta abaixo chegou ao limite (o numero depois de "limiar"):',
    lista
  ]).concat([''], espera ? linhasDosAgentes(rodando).concat([
    'O handoff espera todos terminarem; nao pare nenhum. O aviso volta quando o ultimo terminar.', ''
  ]) : [], [
    // s335 (revisao, microcopy): "nada" sozinho deixava em duvida se era para agir; o atalho do alarme e opcional.
    alarme ? 'Faca assim: nada e obrigatorio; para baixar o custo ja, compacte a conversa (/compact; no Qwen Code, ' +
      '/compress).' : 'Faca assim: nada, voce nao precisa agir.',
    'O Claude grava o handoff (/sworn:handoff, o texto que continua o trabalho)' +
      (espera ? ' quando o ultimo terminar' : '') + ' e segue nesta conversa.',
    'Quando ela for compactada (resumida sozinha para caber), o sworn manda o Claude reler o handoff.'
  ]).join('\n');
}

/** D704: o que o modelo faz enquanto agentes seguram o handoff (sem a ordem de rodar agora). */
function esperaAoModelo(rodando, porque) {
  return linhasDosAgentes(rodando).concat([
    'Faca agora, nesta mesma resposta:',
    '1. Diga ao usuario numa linha que o handoff sai quando o ultimo agente acima terminar e que o trabalho',
    '   segue nesta conversa, sem chat novo; ' + porque + '.',
    '2. Nao rode /sworn:handoff agora, nao dispare agente novo e nao pare nenhum dos que rodam;',
    '   siga no que nao depende deles.'
  ]);
}

// s353 (D786 passo 5, cx10): fora do Claude Code nao ha "/sworn:handoff"; o Ministral no Codex nao achou a skill e
// tentou gravar em .codex/sworn/, que o sandbox nega. Toda ordem de rodar o handoff (aqui e em reinjecao.js) leva o
// nome da skill nos outros harnesses (instalar.js:220) e a pasta onde o sworn marca o arquivo (D788).
// s363 (F9, qw8): o Qwen sem tela negou a skill e o luna leu "grave direto" como contornar a recusa; o caminho sem a
// skill mora aqui, para valer em toda ordem de gravar, e diz que e o pedido.
// s365 (F10, qw10): com a skill primeiro, o luna leu o "grave direto" que vinha depois da negacao como desvio. Fora
// do Claude Code a gravacao direta vem primeiro e a skill fica de atalho; no Claude Code o "/sworn:handoff" segue
// antes deste parentese.
const ONDE_GRAVAR_O_HANDOFF = '(fora do Claude Code, grave o handoff direto em ' +
  '.sworn/handoff/AAAA-MM-DD-<tema>.md: e o caminho pedido, nao um contorno de recusa; a skill sworn-handoff faz ' +
  'o mesmo, se abrir)';

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
      'sworn: gatilho contavel de saude do contexto disparou. E hora do handoff, mas ainda nao de roda-lo.',
      (gatilhos || []).map(function (g) { return '  - ' + g; }).join('\n')
    ].concat(esperaAoModelo(rodando, 'cite o gatilho acima que disparou'), [
      'O aviso de termino de cada agente chega sozinho; a ordem do handoff vem no primeiro fim de turno sem agente rodando.'
    ]).join('\n');
  }
  // D786 passo 2: gravado o handoff, o trabalho segue nesta conversa; a compactacao do harness o rele.
  if (promptJaColado === true) {
    return [
      'sworn: gatilho contavel de saude do contexto disparou. E hora do handoff, e ele ja foi gravado.',
      (gatilhos || []).map(function (g) { return '  - ' + g; }).join('\n'),
      'O prompt do handoff ja esta no bloco de codigo da sua resposta acima: nao rode o handoff de novo e',
      'nao cole o bloco outra vez. Nesta mesma resposta, diga ao usuario numa linha que o handoff esta gravado',
      '(o bloco acima), cite o gatilho acima que disparou e diga que o trabalho segue nesta conversa, sem chat novo.',
      'Siga com o proximo passo do trabalho, se houver um; nao pergunte "sigo?".'
    ].join('\n');
  }
  return [
    'sworn: gatilho contavel de saude do contexto disparou. E hora do handoff.',
    (gatilhos || []).map(function (g) { return '  - ' + g; }).join('\n'),
    'Faca agora, nesta mesma resposta:',
    '1. Rode /sworn:handoff.',
    '   ' + ONDE_GRAVAR_O_HANDOFF,
    '2. Cole o prompt pronto do handoff no chat, em bloco de codigo (nao basta gravar no arquivo).',
    '3. Diga ao usuario numa linha que o handoff esta gravado, cite o gatilho acima que disparou e diga que o',
    '   trabalho segue nesta conversa, sem chat novo: quando ela for compactada, o sworn manda reler o handoff.',
    '4. Siga com o proximo passo do trabalho, se houver um; nao pergunte "sigo?".'
  ].join('\n');
}

const NOME_DA_SAUDE = '(?:contexto|memoria|context(?: window)?|memory)';
const ESTADO_DA_SAUDE = '(?:bom|boa|ok|okay|cheio|cheia|lotado|lotada|estourando|saudavel|aguenta|aguentando|full|fine|healthy|good|enough)';
const ARTIGO_DO_NOME = '(?:o |a |seu |sua |esse |essa |your |the |this )?';
// s337 (P1 da 2a revisao nova): a frase de estado e uma gramatica fixa, no lugar do meio livre de 0-2 palavras (cada
// caso novo abria um P1): [artigo] nome [da conversa] [ja|ainda] [verbo de estado] [ficando|getting] [muito|quase]
// estado. O verbo de estado diz o estado de agora (o presente, e o "ficou", o estado a que chegou): "vai ficar",
// "estiver", "ficar" e "gets" nao casam, e o tempo separa a pergunta de agora da hipotese. O complemento e fechado de
// proposito: "o contexto do React ta cheio?" nao e a conversa.
const DA_CONVERSA = '(?: (?:da|desta|dessa|of|in) (?:this |the |our |nossa )?(?:conversa|chat|sessao|conversation|' +
  'session))?';
const JA_OU_AINDA = '(?: (?:ja|ainda|already|still))?';
const VERBO_DE_ESTADO = "(?:'s| (?:esta|ta|anda|ficou|is|are))";
const DEPOIS_DO_VERBO = '(?: (?:ficando|getting))?(?: (?:muito|quase|bem|meio|very|almost|nearly|pretty|too))? ' +
  ESTADO_DA_SAUDE;
const FRASE_SEM_VERBO = NOME_DA_SAUDE + DA_CONVERSA + JA_OU_AINDA;
const FRASE_DE_ESTADO = FRASE_SEM_VERBO + VERBO_DE_ESTADO + '?' + DEPOIS_DO_VERBO;
const FRASE_COM_VERBO = FRASE_SEM_VERBO + VERBO_DE_ESTADO + DEPOIS_DO_VERBO;
// na oracao do "?": a frase de estado em qualquer ponto ("e ai, o contexto ta cheio?", "contexto cheio, ne?"; com o
// verbo opcional, ela ja casa a pergunta com o verbo na frente, "is your context getting full?")
const ESTADO_NA_PERGUNTA = new RegExp('\\b' + FRASE_DE_ESTADO + '\\b');
// a pergunta com o verbo na frente, para a oracao sem "?": "is the context window full, or fine?"
const FRASE_INVERTIDA = '(?:is|are|esta|ta) ' + ARTIGO_DO_NOME + FRASE_SEM_VERBO + DEPOIS_DO_VERBO;
// na oracao sem "?": ela inteira e a frase ("Contexto lotado, posso continuar?") ou termina na frase com verbo ("e ai
// o contexto ja ta cheio, ou..."). "o contexto esta cheio de logs inuteis, pode limpar?" nao termina nela.
const ESTADO_NA_ORACAO = new RegExp('(?:^' + ARTIGO_DO_NOME + FRASE_DE_ESTADO + '|\\b' + FRASE_COM_VERBO + '|\\b' +
  FRASE_INVERTIDA + ')$');
// "como esta a memoria?", "how is your context?", "how is the context window doing?"
const COMO_ESTA = new RegExp('\\b(?:como\\s+(?:esta|ta|anda)|how(?:\'s|s| is| are))\\s+(?:\\w+\\s+){0,2}?' +
  NOME_DA_SAUDE + '\\s*(?:doing|going|looking|\\?|$)');

// s335: onde a frase acaba - pontuacao (com dois-pontos e ponto e virgula), linha em branco ou item de lista. A quebra
// de linha simples fica dentro da frase: "o contexto\nesta bom?" e uma pergunta so.
const FIM_DA_FRASE = /(?<=[.!?:;])\s+|\n\s*\n|\n(?=\s*(?:[-*+]|\d+[.)])\s)/;
// s335: a oracao de tempo ou condicao fala do contexto de depois ("quando o contexto estiver cheio?", achado s330),
// nao pergunta pelo de agora. s336 (ronda 2): o conectivo vale em qualquer ponto antes do nome ("o que acontece se
// o contexto ficar cheio?"). s337: "se"/"if" no meio seguem hipoteticos, porque a condicao em ingles vem no presente
// ("what happens if the context is full?"); o tempo do verbo nao os separa. Conservador de proposito: "me diz se o
// contexto ta cheio?" tambem sai; o modelo ainda responde, e o gatilho contavel do contexto segue valendo. "caso" so
// no comeco da oracao: no meio e o substantivo ("nesse caso o contexto ta cheio?").
const CONECTIVO_HIPOTETICO = /\b(?:quando|se|sempre que|assim que|when|whenever|if)\b|^caso\b/;
const NOME_SOLTO = new RegExp('\\b' + NOME_DA_SAUDE + '\\b');
// s335 (revisao, ronda 3): o nome sozinho antes da virgula ("o contexto, esta cheio?") pertence a oracao do "?". s337:
// a cauda ("contexto cheio, ne?") deixou de juntar: a oracao antes dela conta sozinha quando e a frase de estado.
const SO_O_NOME = new RegExp('^' + ARTIGO_DO_NOME + NOME_DA_SAUDE + '$');
// a 1a frase sem "?" com cara de pergunta: o nome seguido do verbo de estado ou do "ainda" ("o contexto ainda aguenta")
const COMECO_COM_NOME = new RegExp('^' + ARTIGO_DO_NOME + FRASE_SEM_VERBO + '(?:' + VERBO_DE_ESTADO +
  '| (?:ainda|still))\\b');
// s336: o que o usuario colou (<pasted_content> do Claude Code) e o que ele cita entre aspas nao e ele perguntando: o
// prompt de handoff colado no chat novo cita a pergunta composta e disparava o handoff no 1o turno. Ronda 2: a
// colagem cortada (sem a tag de fechamento) vai ate o fim da mensagem; a tag e a citacao tem teto, para a regex seguir
// linear numa mensagem enorme (o gancho tem prazo). s337: o corpo termina tambem na abertura seguinte (duas colagens
// abertas em seguida) e na tag de fechamento cortada antes do ">"; as aspas retas so citam quando fecham colada no
// "?" ('"o contexto ta cheio?"'): soltas sao polegadas, e '"ok" e o contexto esta bom? "sim"' nao vira citacao.
const COLAGEM = new RegExp('<pasted_content\\b[^>]{0,200}>(?:(?!</?pasted_content\\b)[\\s\\S])*' +
  '(?:</pasted_content\\b[^>]{0,200}(?:>|$)|(?=<pasted_content\\b)|$)', 'gi');
const CITACAO = /"[^"\n]{0,300}\?"|\u201c[^\u201d\n]{0,300}\u201d/g;

/** A pergunta sem "?" pela forma do comeco: "como esta a memoria", "o contexto esta bom". */
function comecaComoPergunta(t) {
  return /^(?:como|how|is|are|esta|ta|ainda|qual)\b/.test(t) || COMECO_COM_NOME.test(t);
}

/** A oracao com conectivo de tempo ou condicao antes do nome fala do contexto de depois, nao do de agora. */
function oracaoHipotetica(c) {
  const nome = NOME_SOLTO.exec(c);
  return CONECTIVO_HIPOTETICO.test(nome ? c.slice(0, nome.index) : c);
}

/**
 * A oracao fala da saude do contexto de agora: casa `frase` (ESTADO_NA_PERGUNTA na oracao do "?", ESTADO_NA_ORACAO
 * na sem "?") ou o "como esta", e nao e hipotetica.
 */
function oracaoDeSaude(c, frase) {
  return !oracaoHipotetica(c) && (frase.test(c) || COMO_ESTA.test(c));
}

/**
 * T10-4 (D357): o usuario perguntou se o contexto/memoria da conversa esta bom? A pergunta E a resposta (o handoff).
 * Conservador de proposito: o falso negativo e barato (o modelo ainda responde, e o gatilho contavel do contexto segue
 * valendo); o falso positivo dispara o handoff sem pedido. Como decide (D786 passo 2, s335-s337):
 * - a colagem (<pasted_content>) e a citacao entre aspas saem antes; o retorno de subagente nao conta;
 * - a mensagem se parte em frases (FIM_DA_FRASE) e cada frase em oracoes (entre virgulas);
 * - na frase com "?": a oracao do "?" conta com a frase de estado em qualquer ponto (junto do nome sozinho na oracao
 *   de antes: "o contexto, esta cheio?"); as outras oracoes contam so quando SAO a frase de estado ("Contexto
 *   lotado, posso continuar?"), nunca quando ela segue ("o contexto esta cheio de logs, pode limpar?");
 * - sem "?": so a 1a frase da mensagem, com cara de pergunta no comeco e a 1a oracao sendo a frase de estado;
 * - a oracao hipotetica (tempo ou condicao antes do nome) nunca conta.
 */
function perguntaSobreSaude(prompt) {
  if (typeof prompt !== 'string') return false;
  // D475: o inspetor que CITA a pergunta nao e o usuario perguntando (filtro em texto.js, D484).
  if (veioDeSubagente(prompt)) return false;
  const frases = prompt.replace(COLAGEM, ' ').replace(CITACAO, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().split(FIM_DA_FRASE).map(function (f) { return f.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
  return frases.some(function (t, i) {
    const oracoes = t.split(/\s*,\s*/);
    if (t.indexOf('?') !== -1) {
      return oracoes.some(function (c, k) {
        if (c.indexOf('?') === -1) return oracaoDeSaude(c, ESTADO_NA_ORACAO);
        const antes = k > 0 ? oracoes[k - 1] : '';
        const junta = antes && SO_O_NOME.test(antes);
        return oracaoDeSaude(junta ? antes + ' ' + c : c, ESTADO_NA_PERGUNTA);
      });
    }
    return i === 0 && comecaComoPergunta(t) && oracaoDeSaude(oracoes[0], ESTADO_NA_ORACAO);
  });
}

/** T10-4: o que o modelo recebe quando o usuario pergunta pela saude do contexto. D786 passo 2: sem chat novo. */
const INSTRUCAO_DA_PERGUNTA = [
  'sworn: o usuario perguntou se o contexto/memoria desta conversa esta bom. A resposta e o handoff, nesta conversa.',
  'Faca agora, nesta mesma resposta:',
  '1. Rode /sworn:handoff.',
  '   ' + ONDE_GRAVAR_O_HANDOFF,
  '2. Cole o prompt pronto do handoff no chat, em bloco de codigo.',
  '3. Diga ao usuario numa linha que o handoff esta gravado, por que (ele perguntou), e que o trabalho',
  '   segue nesta conversa, sem chat novo: quando ela for compactada, o sworn manda reler o handoff.',
  '4. Siga com o proximo passo do trabalho, se houver um.',
  'Nao responda "esta tudo bem" nem pergunte "sigo?".'
].join('\n');

/**
 * D704: a resposta a pergunta pela saude com os agentes de fundo da sessao (`rodando`, agentesRodando). Sem agente,
 * INSTRUCAO_DA_PERGUNTA. Com agente, esperar; esta ordem diz ela mesma quando rodar o handoff, porque a pergunta
 * nao passa pelo Stop que a daria depois.
 */
function instrucaoDaPergunta(rodando) {
  if (!Array.isArray(rodando) || rodando.length === 0) return INSTRUCAO_DA_PERGUNTA;
  return [
    'sworn: o usuario perguntou se o contexto/memoria desta conversa esta bom. A resposta e o handoff, mas ainda nao',
    'de roda-lo.'
  ].concat(esperaAoModelo(rodando, 'diga por que (ele perguntou)'), [
    '3. Quando o ultimo terminar, rode /sworn:handoff e cole o prompt pronto no chat, em bloco de codigo (o aviso de',
    '   termino de cada agente chega sozinho); depois siga com o proximo passo do trabalho, se houver um.',
    '   ' + ONDE_GRAVAR_O_HANDOFF,
    'Nao responda "esta tudo bem" nem pergunte "sigo?".'
  ]).join('\n');
}

/**
 * D412: arquivo de handoff = `.md` com data AAAA-MM-DD- na frente do nome e terminado em "handoff"
 * (`<data>-<slug>-handoff.md`, o padrao dos planos) ou na pasta (`handoff/<data>-<slug>.md`, onde
 * a skill grava, skills/handoff/SKILL.md:25). A data exclui a propria skill (`handoff/SKILL.md`).
 * s338: "handoff" no meio do nome e o assunto, nao o tipo (o plano `...-d786-handoff-sem-chat-novo-plano.md`).
 */
function ehArquivoDeHandoff(caminho) {
  if (typeof caminho !== 'string' || !caminho) return false;
  // s363 (F8): barras repetidas (o grok no dsh mandou `\\` dobrada, que o Windows aceita) nao abrem pedaco vazio. A
  // troca da barra invertida fica como estava: e o ponto barra_invertida da matriz (plataforma.js:165).
  const partes = caminho.replace(/\\/g, '/').split(/\/+/);
  const nome = partes[partes.length - 1];
  const pasta = partes.length > 1 ? partes[partes.length - 2] : '';
  if (!/^\d{4}-\d{2}-\d{2}-.*\.md$/i.test(nome)) return false;
  return /handoff\.md$/i.test(nome) || /^handoff$/i.test(pasta);
}

// s351: comando que pode gravar arquivo (cmdlet ou utilitario de escrita, redirecionamento, escrita por script). O `>`
// depois de digito (`2>&1`, `2>$null`), de `=` (`=>`) ou de `-` (`->`) nao grava o handoff.
const ESCRITA_NO_SHELL = new RegExp('(^|[\\s|;&(])(set-content|add-content|out-file|new-item|copy-item|move-item|' +
  'tee-object|tee|cp|mv|copy|move)\\b|(^|[^\\d=-])>|writealltext|writefile', 'i');
// s351: trecho do comando que pode ser um caminho: entre aspas (sem quebra de linha) ou solto.
const TRECHO_DO_COMANDO = /'([^'\r\n]+)'|"([^"\r\n]+)"|([^\s'"`;|&<>(){}]+)/g;
const JANELA_DO_SHELL_MS = 120 * 1000;

/**
 * s351 (D786 passo 5): o handoff que um comando de shell acabou de gravar; o Codex, o agy e o dsh nao tem Write (no
 * ao vivo cx6 o handoff foi gravado por Set-Content e nao virou marca). Gravado = o comando escreve
 * (ESCRITA_NO_SHELL), cita um nome de handoff (ehArquivoDeHandoff) e esse arquivo mudou ha no maximo 2 minutos.
 * Devolve o caminho absoluto, resolvido no `cwd`, ou null.
 * atalho: o comando que escreve e a hora do arquivo decidem, nao o destino da escrita. limite: um comando que escreve
 * outra coisa e so le um handoff gravado nos ultimos 2 minutos tambem marca; caminho com espaco fora de aspas ou em
 * variavel nao se acha. trocar quando: uma rodada ao vivo mostrar uma dessas formas.
 */
function handoffGravadoPeloShell(comando, cwd, agora) {
  if (typeof comando !== 'string' || !ESCRITA_NO_SHELL.test(comando)) return null;
  const base = typeof cwd === 'string' && cwd ? cwd : process.cwd();
  const trechos = new RegExp(TRECHO_DO_COMANDO.source, 'g');
  let m;
  while ((m = trechos.exec(comando)) !== null) {
    const trecho = m[1] || m[2] || m[3];
    if (!ehArquivoDeHandoff(trecho)) continue;
    const arquivo = path.resolve(base, trecho);
    try {
      const st = fs.statSync(arquivo);
      if (st.isFile() && agora - st.mtimeMs <= JANELA_DO_SHELL_MS) return arquivo;
    } catch (err) { /* nao existe: o comando so citou o nome */ }
  }
  return null;
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
  // A5-15 (D735): sem "Voce gravou", "tis" nem "portao de fecho".
  'sworn - falta colar no chat o prompt do handoff.',
  '',
  'Um arquivo de handoff foi gravado neste turno, e a resposta final nao tem bloco de codigo.',
  'O prompt pronto tem de chegar ao chat, nao so ao arquivo. Esta trava do fim do turno le so a resposta final:',
  'um bloco numa mensagem anterior deste turno ela nao ve.',
  '',
  'Faca assim: cole o prompt agora num bloco de codigo (entre ``` ou ~~~), nesta resposta final - uma vez so.',
  '',
  'So o dono desliga neste projeto: "portaoHandoff": false em .claude/sworn/projeto.json.'
].join('\n');

module.exports = { LIMIARES_PADRAO, BALDES_DE_BLOQUEIO, contextoDoTranscript, ultimaChamadaDoTranscript, testesDoTranscript, limiaresValidos, medir, acumular, avaliar, avisoDeSaude, instrucaoAoModelo, perguntaSobreSaude,
  INSTRUCAO_DA_PERGUNTA, ONDE_GRAVAR_O_HANDOFF, ehArquivoDeHandoff, handoffGravadoPeloShell,
  ehArquivoDeCodigo, temBlocoDeCodigo, MOTIVO_HANDOFF_SEM_PROMPT,
  SILENCIO_DO_AGENTE_MS, agentesRodando, linhasDosAgentes, instrucaoDaPergunta, provasEquivalentes };
