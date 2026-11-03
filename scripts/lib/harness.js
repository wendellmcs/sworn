'use strict';

/**
 * Pedido 6 (D752, D755): o que cada harness fora do Claude Code manda e entende, numa fonte so. A ponte.js le daqui
 * para levar a entrada de cada um ao formato do Claude Code, rodar o portao de hoje sem mudar e devolver a saida na
 * forma do harness; o instalador (Etapa 3) le daqui os eventos que cada um dispara e o matcher na lingua dele. Tudo o que esta aqui foi visto rodando na
 * sonda das sessoes 269-271 (as fixtures de test/fixtures/harness/), menos o shell do agy no Windows (inferido).
 */

const HARNESSES = ['codex', 'qwen', 'agy', 'dsh', 'opencode'];

// Nome da ferramenta no harness -> nome no Claude Code. SHELL = PowerShell no Windows e Bash fora dele (o Codex chama
// o shell de Bash e roda PowerShell no Windows). Ferramenta sem par segue com o proprio nome: nenhum matcher casa.
const SHELL = 'SHELL';
// Etapa 4b (D756, sonda s279): a pergunta com opcoes de cada um vira o AskUserQuestion, e o wait_agent do Codex, que
// traz o texto do subagente, vira o SubagentHandback (um por subagente terminado, em fimDoWaitAgent). O nome
// multi_agent_v1wait_agent e o que o Codex 0.162 manda no gancho, sem separador entre v1 e wait (sonda s279).
const FERRAMENTAS = {
  codex: { Bash: SHELL, request_user_input: 'AskUserQuestion', spawn_agent: 'Agent',
    multi_agent_v1wait_agent: 'SubagentHandback' },
  qwen: { run_shell_command: SHELL, write_file: 'Write', edit: 'Edit', agent: 'Agent', read_file: 'Read',
    glob: 'Glob', ask_user_question: 'AskUserQuestion' },
  agy: { run_command: SHELL, write_file: 'Write', edit_file: 'Edit', invoke_subagent: 'Agent',
    ask_question: 'AskUserQuestion', send_message: 'SubagentHandback' },
  dsh: { pwsh: 'PowerShell', write: 'Write', edit: 'Edit', subagent: 'Agent', ask_user_question: 'AskUserQuestion',
    send_message: 'SubagentHandback' },
  opencode: { bash: 'Bash', write: 'Write', edit: 'Edit', task: 'Agent', read: 'Read', question: 'AskUserQuestion' }
};

// Evento do harness -> eventos do Claude Code que ele cobre. Codex, Qwen e dsh ja usam os nomes do Claude Code.
// agy: sem abertura e sem evento do prompt; a PreInvocation faz os dois papeis (a ponte roda a abertura uma vez).
// OpenCode: o plugin opencode/sworn.js manda o nome do gancho dele.
const EVENTOS = {
  agy: { PreInvocation: ['SessionStart', 'UserPromptSubmit'], PreToolUse: ['PreToolUse'],
    PostToolUse: ['PostToolUse'], Stop: ['Stop'] },
  opencode: { 'tool.execute.before': ['PreToolUse'], 'tool.execute.after': ['PostToolUse'],
    'experimental.chat.system.transform': ['SessionStart'], 'chat.message': ['UserPromptSubmit'],
    'session.idle': ['Stop'] }
};

// Eventos do Claude Code que Codex, Qwen e dsh disparam, vistos na sonda (o SessionEnd do Qwen nao chegou; o
// SubagentStart/SubagentStop dele, na s278). O agy e o OpenCode, pela tabela EVENTOS. O instalador so grava gancho de
// evento disparado, e o --conferir so espera esses.
const DISPARA = {
  codex: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd'],
  qwen: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStart', 'SubagentStop'],
  dsh: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStart', 'SubagentStop']
};

function eventosQueDispara(harness) {
  if (DISPARA[harness]) return DISPARA[harness].slice();
  const r = [];
  for (const lista of Object.values(EVENTOS[harness] || {})) for (const e of lista) if (!r.includes(e)) r.push(e);
  return r;
}

// O apply_patch do Codex vira Write ou Edit na ponte (arquivosDoPatch), fora da tabela FERRAMENTAS.
const PATCH = { codex: { apply_patch: ['Write', 'Edit'] } };
// Campo com o texto do apply_patch: no Codex, `command`; no OpenCode com modelo GPT, `patchText` (s299, D766: a trava
// 4 nao barrava a edicao por ele). O OpenCode nao le o matcher do PATCH: o plugin chama a ponte para toda ferramenta.
const TEXTO_DO_PATCH = { codex: 'command', opencode: 'patchText' };
// D768 (s300): modelo sem o apply_patch nativo (MiniMax no Codex) o chama de dentro do shell. O comando segue ao portao
// de shell, e cada arquivo do patch vai a trava 4; o resto da escrita pelo shell segue fora (D40).
const SHELLS = ['PowerShell', 'Bash'];

/**
 * O matcher do hooks.json fala os nomes do Claude Code, e o harness casa o nome dele antes de chamar a ponte. A lista
 * ganha o nome do harness de cada ferramenta que vira uma das do matcher; a ponte refaz o filtro com o nome traduzido.
 * Matcher que nao e lista de nomes (o "^sworn:inspector$", do tipo do agente) sai: fora do Claude Code o agente se
 * chama sworn-<papel> (nomeDoAgente), e o harness nao casaria; a ponte refiltra pelo nome do Claude Code.
 */
function matcherDoHarness(harness, matcher) {
  if (typeof matcher !== 'string') return matcher;
  if (!/^\w+(\|\w+)*$/.test(matcher)) return undefined;
  const nomes = matcher.split('|');
  const pares = Object.assign({}, PATCH[harness]);
  for (const [nome, par] of Object.entries(FERRAMENTAS[harness] || {})) {
    const pars = par === SHELL ? SHELLS : [par];
    // D768: o shell pode trazer o apply_patch, e o harness tem de chamar a trava 4 (matcher Write|Edit) para ele.
    pares[nome] = pars.some((p) => SHELLS.includes(p)) ? pars.concat('Write', 'Edit') : pars;
  }
  const extra = Object.keys(pares).filter((n) => !nomes.includes(n) && pares[n].some((c) => nomes.includes(c)));
  return nomes.concat(extra).join('|');
}

// Quem repete o UserPromptSubmit no mesmo pedido: o Qwen a cada volta do laco (com prompt_id), o dsh a cada passo
// (sem prompt_id) e o agy a cada PreInvocation. O valor diz o que identifica o pedido.
const DEDUPLICAR = { qwen: 'prompt_id', dsh: 'prompt', agy: 'prompt' };
// Quem nao manda stop_hook_active de verdade (o dsh manda sempre false): a ponte emula pelo estado.
const EMULA_STOP = ['agy', 'dsh', 'opencode'];
// Quem nao tem abertura propria: a ponte roda a abertura uma vez por sessao.
const ABRE_UMA_VEZ = ['agy', 'opencode'];

// Agente de memoria do Codex (cwd em ~/.codex/memories) e auto-memoria do Qwen (grava em ~/.qwen/memories): o harness
// dispara os ganchos do projeto para eles, mas nao e trabalho do projeto.
const MEMORIA = /[\\/]\.(codex|qwen)[\\/]memories([\\/]|$)/i;

function eventosDoHarness(harness, bruta) {
  if (!HARNESSES.includes(harness) || !bruta || typeof bruta !== 'object') return [];
  const nome = bruta.hook_event_name;
  if (EVENTOS[harness]) return (EVENTOS[harness][nome] || []).slice();
  return typeof nome === 'string' && nome ? [nome] : [];
}

function nomeDaFerramenta(harness, nome, plataforma) {
  const par = (FERRAMENTAS[harness] || {})[nome];
  if (par === SHELL) return plataforma === 'win32' ? 'PowerShell' : 'Bash';
  return par || nome;
}

/**
 * Etapa 4b: o agente do sworn se chama sworn-<papel> fora do Claude Code (o `:` nao e garantido no nome; `sonda-leitor`
 * passou no Codex, no Qwen e no OpenCode, s278-s279) e volta como sworn:<papel>, o nome que os portoes conhecem.
 */
function nomeDoAgente(nome) {
  return typeof nome === 'string' ? nome.replace(/^sworn-/, 'sworn:') : nome;
}

/**
 * Campos do agy, do OpenCode e do spawn_agent do Codex -> os do Claude Code; o resto do Codex, o Qwen e o dsh ja mandam
 * os do Claude Code. No spawn_agent, o modelo e o esforco sao os do Codex e ficam fora (a tabela da escada fala os do
 * Claude Code). A opcao em texto do ask_question do agy vira {label}; a que nao e texto fica como veio.
 */
function camposDaFerramenta(harness, nome, args) {
  const a = args && typeof args === 'object' ? args : {};
  if (harness === 'codex' && nome === 'spawn_agent') return { subagent_type: a.agent_type, prompt: a.message };
  if (harness === 'agy') {
    if (nome === 'ask_question' && Array.isArray(a.questions)) {
      return { questions: a.questions.map((q) => q && typeof q === 'object' && Array.isArray(q.options)
        ? Object.assign({}, q, { options: q.options.map((o) => typeof o === 'string' ? { label: o } : o) }) : q) };
    }
    if (nome === 'write_file') return { file_path: a.Path, content: a.Content };
    if (nome === 'edit_file') return { file_path: a.Path, old_string: a.Target, new_string: a.Replacement };
    if (nome === 'run_command') return { command: a.CommandLine };
    if (nome === 'send_message') return { message: a.Message };
    if (nome === 'invoke_subagent') {
      return { prompt: a.Prompt, description: a.Role, subagent_type: a.TypeName, model: a.Model };
    }
  }
  if (harness === 'opencode') {
    const r = Object.assign({}, a);
    if ('filePath' in a) { r.file_path = a.filePath; delete r.filePath; }
    if ('oldString' in a) { r.old_string = a.oldString; delete r.oldString; }
    if ('newString' in a) { r.new_string = a.newString; delete r.newString; }
    return r;
  }
  return Object.assign({}, a);
}

/**
 * apply_patch do Codex: um chamado mexe em N arquivos, e o portao le um file_path so. Cada arquivo vira um Write
 * (Add, Delete com conteudo vazio, destino do Move) ou um Edit (Update, com as linhas de contexto nos dois lados, que
 * e o que a catraca compara). Caminho como veio: relativo ao cwd.
 */
function arquivosDoPatch(texto) {
  const saida = [];
  let atual = null;
  const escrever = (arquivo, conteudo) =>
    saida.push({ tool_name: 'Write', tool_input: { file_path: arquivo, content: conteudo } });
  const fechar = function () {
    if (!atual) return;
    if (atual.tipo === 'add') escrever(atual.arquivo, atual.novo.join('\n'));
    if (atual.tipo === 'update') {
      saida.push({ tool_name: 'Edit', tool_input: { file_path: atual.arquivo, old_string: atual.velho.join('\n'),
        new_string: atual.novo.join('\n') } });
      if (atual.destino) escrever(atual.destino, atual.novo.join('\n'));
    }
    atual = null;
  };
  for (const linha of String(texto || '').split(/\r?\n/)) {
    let m;
    if ((m = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(linha))) {
      fechar();
      if (m[1] === 'Delete') escrever(m[2].trim(), '');
      else atual = { tipo: m[1].toLowerCase(), arquivo: m[2].trim(), velho: [], novo: [] };
    } else if ((m = /^\*\*\* Move to: (.+)$/.exec(linha))) {
      if (atual) atual.destino = m[1].trim();
    } else if (/^\*\*\* (Begin|End) Patch/.test(linha)) {
      fechar();
    } else if (atual) {
      if (linha.startsWith('+')) atual.novo.push(linha.slice(1));
      else if (linha.startsWith('-')) atual.velho.push(linha.slice(1));
      else if (linha.startsWith(' ')) { atual.velho.push(linha.slice(1)); atual.novo.push(linha.slice(1)); }
    }
  }
  fechar();
  return saida;
}

// D770: o printf numa passada so, para C:\\dev\\n-utils virar C:\dev\n-utils como o printf grava.
const PRINTF = { '\\': '\\', n: '\n', t: '\t', r: '' };

/**
 * D770: a aspa que fecha a string corta o cabecalho ali, com o \ e o espaco antes dela (senao o intocavel sairia com
 * `" && echo ok` no caminho), so quando depois dela vem, entre aspas, \ e espacos, o fim da linha ou um operador do
 * shell: docs/it's.md fica inteiro. Da direita para a esquerda, em tempo linear.
 */
function cortarNaAspa(linha) {
  let corte = -1;
  let livre = true;
  for (let i = linha.length - 1; i >= 4; i--) {
    const c = linha[i];
    if ('|&;)>'.includes(c)) livre = true;
    else if (!'\\"\'` \t'.includes(c)) livre = false;
    else if (livre && '"\'`'.includes(c)) corte = i;
  }
  if (corte < 0) return linha;
  while (corte > 4 && '\\ \t'.includes(linha[corte - 1])) corte--;
  return linha.slice(0, corte);
}

/**
 * D768: o patch dentro de um comando de shell. No PowerShell a quebra vem como `n. No Bash, como \n so na linha que e
 * o patch escapado (tem \n antes de um ***): o printf parte todo \n, o do caminho tambem, e a trava ve o que o
 * apply_patch recebe; no patch de quebra real (here-string), o \n de C:\dev\new.js fica.
 */
function patchDoShell(comando) {
  const linhas = comando.replace(/`r`n|`n/g, '\n').split('\n')
    .map((l) => (/\\n\*\*\* /.test(l) ? l.replace(/\\([\\ntr])/g, (m, c) => PRINTF[c]) : l));
  // O printf abre quebras dentro da linha: o cabecalho so aparece depois de partir de novo (o \r do CRLF sai aqui).
  return arquivosDoPatch(linhas.join('\n').split(/\r?\n/).map((l) => (l.startsWith('*** ') ? cortarNaAspa(l) : l))
    .join('\n'));
}

function textoDasPartes(partes) {
  if (!Array.isArray(partes)) return '';
  return partes.filter((p) => p && p.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('\n');
}

/** Entrada crua de um harness agy ou OpenCode -> a base no formato do Claude Code (sem a ferramenta). */
function baseSemPadrao(harness, bruta, evento) {
  if (harness === 'agy') {
    const base = { session_id: bruta.conversationId, transcript_path: bruta.transcriptPath,
      cwd: Array.isArray(bruta.workspacePaths) ? bruta.workspacePaths[0] : undefined, hook_event_name: evento };
    if (bruta.toolCall && typeof bruta.toolCall === 'object') {
      base.tool_name = bruta.toolCall.name;
      base.tool_input = camposDaFerramenta(harness, bruta.toolCall.name, bruta.toolCall.args);
    }
    if (evento === 'SessionStart') base.source = 'startup';
    if (evento === 'UserPromptSubmit') base.prompt = typeof bruta.lastUserInput === 'string' ? bruta.lastUserInput : '';
    return base;
  }
  const entrada = bruta.input && typeof bruta.input === 'object' ? bruta.input : {};
  const saida = bruta.output && typeof bruta.output === 'object' ? bruta.output : {};
  const props = bruta.properties && typeof bruta.properties === 'object' ? bruta.properties : {};
  const base = { session_id: entrada.sessionID || props.sessionID, cwd: bruta.cwd, hook_event_name: evento };
  if (evento === 'PreToolUse' || evento === 'PostToolUse') {
    base.tool_name = entrada.tool || bruta.tool_name;
    const args = evento === 'PreToolUse' ? saida.args : entrada.args;
    base.tool_input = camposDaFerramenta(harness, base.tool_name, args);
    if (evento === 'PostToolUse') base.tool_response = saida.output;
  }
  if (evento === 'SessionStart') base.source = 'startup';
  if (evento === 'UserPromptSubmit') base.prompt = textoDasPartes(saida.parts);
  return base;
}

function lerJson(v) {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (e) { return null; }
}

/**
 * Etapa 4b (sonda s279): a resposta da pergunta com opcoes, na forma de cada harness -> a do AskUserQuestion que o
 * marcar-trabalho.js conta, { answers: { <chave>: '<rotulos>' } }. Codex: texto JSON
 * {answers: {<id>: {answers: [..]}}}; dsh: texto JSON {answers: [{id, selected: [..], custom}]}; Qwen: llmContent com
 * "**<header>**: <rotulo>" por linha;
 * OpenCode: "<pergunta>"="<rotulo>". O que nao se le conta zero decisoes. O agy nao manda resposta no gancho (D756):
 * a ponte a le depois, na transcricao (respostaDoAgy).
 */
function respostaDaPergunta(harness, resp) {
  const answers = {};
  const por = (chave, rotulos) => {
    const t = rotulos.filter((r) => typeof r === 'string' && r.trim() !== '').join(', ');
    if (typeof chave === 'string' && t) answers[chave] = t;
  };
  if (harness === 'codex' || harness === 'dsh') {
    const j = lerJson(resp);
    const a = j && typeof j === 'object' ? j.answers : null;
    if (harness === 'codex' && a && typeof a === 'object' && !Array.isArray(a)) {
      for (const [k, v] of Object.entries(a)) por(k, v && Array.isArray(v.answers) ? v.answers : []);
    }
    if (harness === 'dsh' && Array.isArray(a)) {
      for (const v of a) {
        if (v && typeof v === 'object') por(v.id, (Array.isArray(v.selected) ? v.selected : []).concat(v.custom));
      }
    }
    return { answers };
  }
  let texto = typeof resp === 'string' ? resp : '';
  if (harness === 'qwen') {
    const c = resp && typeof resp === 'object' ? resp.llmContent : null;
    texto = typeof c === 'string' ? c
      : Array.isArray(c) ? c.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('\n') : '';
  }
  const re = harness === 'qwen' ? /^\*\*(.+?)\*\*: (.+)$/gm : /"((?:[^"\\]|\\.)*)"="((?:[^"\\]|\\.)*)"/g;
  const solta = (s) => (harness === 'qwen' ? s : s.replace(/\\(.)/g, '$1'));
  let m;
  while ((m = re.exec(texto)) !== null) por(solta(m[1]), [solta(m[2])]);
  return { answers };
}

/**
 * D760 item 3 (sonda s290): a resposta do ask_question do agy entra na transcricao so depois do PostToolUse, no passo
 * de step_index = stepIdx dele, uma linha "A<n>: <resposta>" por pergunta ("A<n>: User Skipped" sem resposta).
 * `pendentes` = [{passo, perguntas}] que a ponte guardou -> { answers: { '<passo>.A<n>': resposta } }. Linha alem do
 * numero de perguntas fica fora: a resposta em texto livre com quebra de linha nao vira decisao.
 */
function respostaDoAgy(texto, pendentes) {
  const answers = {};
  const lista = Array.isArray(pendentes) ? pendentes : [];
  for (const linha of String(texto || '').split('\n')) {
    const o = lerJson(linha);
    const p = o && typeof o.content === 'string' ? lista.find((x) => x && x.passo === o.step_index) : null;
    if (!p) continue;
    for (const m of o.content.matchAll(/^A(\d+): (.*)$/gm)) {
      if (Number(m[1]) <= p.perguntas && m[2].trim() && m[2] !== 'User Skipped') answers[p.passo + '.A' + m[1]] = m[2];
    }
  }
  return { answers };
}

/**
 * Codex (sonda s279): o texto de cada subagente terminado vem no PostToolUse do wait_agent,
 * {status: {<id>: {completed: '<texto>'}}}, so com o id; cada um vira um SubagentHandback. O tipo do agente, a ponte
 * acha pelo id (o UserPromptSubmit do subagente o disse); o que a entrada traz e o de quem chamou o wait_agent, e sai.
 * Nenhum terminado, ou resposta que nao se le: nenhum.
 */
function fimDoWaitAgent(base) {
  const j = lerJson(base.tool_response);
  const status = j && typeof j === 'object' ? j.status : null;
  if (!status || typeof status !== 'object') return [];
  return Object.keys(status).filter((id) => status[id] && typeof status[id].completed === 'string')
    .map((id) => Object.assign({}, base, { agent_id: id, agent_type: undefined,
      tool_input: { message: status[id].completed } }));
}

// OpenCode (sonda s278): o task devolve <task id="<sessao do filho>" ...><task_result>texto</task_result></task>.
const RESULTADO_DO_TASK = /<task\b[^>]*?\bid="([^"]*)"[^>]*>[\s\S]*?<task_result>\r?\n?([\s\S]*?)\r?\n?<\/task_result>/;

// D760 (registros da s278): no agy e no dsh o filho manda o resultado ao pai pelo send_message, e o gancho do filho
// traz o texto, com o session_id dele. Nenhum dos dois diz o papel do filho; so o JSON do inspetor traz o campo
// vereditos, que o briefing manda copiar. Sem ele, o handback segue sem tipo, e o gravar-veredito nao o le.
const DO_INSPETOR = /"vereditos"\s*:/;

function doFilho(base) {
  const msg = base.tool_input && typeof base.tool_input === 'object' ? base.tool_input.message : undefined;
  return Object.assign(base, { agent_id: base.session_id,
    agent_type: typeof msg === 'string' && DO_INSPETOR.test(msg) ? 'sworn:inspector' : undefined });
}

/**
 * Entrada crua do harness -> lista de entradas no formato do Claude Code para o `evento` pedido (um dos de
 * eventosDoHarness). Quase sempre uma; o apply_patch do Codex da uma por arquivo, e um patch vazio, nenhuma; o shell
 * com patch dentro, a do shell e mais uma por arquivo; o wait_agent do Codex, uma por subagente terminado.
 */
function normalizar(harness, bruta, evento, opcoes) {
  const plataforma = (opcoes && opcoes.plataforma) || process.platform;
  if (!HARNESSES.includes(harness) || !bruta || typeof bruta !== 'object') return [];
  const t = bruta.tool_input;
  const copia = t && typeof t === 'object' ? camposDaFerramenta(harness, bruta.tool_name, t) : t;
  const base = (harness === 'agy' || harness === 'opencode')
    ? baseSemPadrao(harness, bruta, evento)
    : Object.assign({}, bruta, { hook_event_name: evento, tool_input: copia });
  if (base.agent_type !== undefined) base.agent_type = nomeDoAgente(base.agent_type);
  if (TEXTO_DO_PATCH[harness] && base.tool_name === 'apply_patch') {
    const ti = base.tool_input;
    return arquivosDoPatch(ti && ti[TEXTO_DO_PATCH[harness]]).map((f) => Object.assign({}, base, f));
  }
  if (typeof base.tool_name === 'string') base.tool_name = nomeDaFerramenta(harness, base.tool_name, plataforma);
  const ti = base.tool_input;
  if (ti && typeof ti === 'object' && 'subagent_type' in ti) ti.subagent_type = nomeDoAgente(ti.subagent_type);
  const cmd = SHELLS.includes(base.tool_name) && ti && typeof ti === 'object' ? ti.command : undefined;
  if (typeof cmd === 'string' && cmd.includes('*** Begin Patch')) {
    return [base].concat(patchDoShell(cmd).map((f) => Object.assign({}, base, f)));
  }
  if (evento !== 'PostToolUse') return [base];
  if (base.tool_name === 'AskUserQuestion') base.tool_response = respostaDaPergunta(harness, base.tool_response);
  if (harness === 'codex' && base.tool_name === 'SubagentHandback') return fimDoWaitAgent(base);
  if ((harness === 'agy' || harness === 'dsh') && base.tool_name === 'SubagentHandback') return [doFilho(base)];
  const m = harness === 'opencode' && base.tool_name === 'Agent' && typeof base.tool_response === 'string'
    ? RESULTADO_DO_TASK.exec(base.tool_response) : null;
  if (m) {
    Object.assign(base, { tool_name: 'SubagentHandback', agent_id: m[1],
      agent_type: ti && typeof ti === 'object' ? ti.subagent_type : undefined, tool_input: { message: m[2] } });
  }
  return [base];
}

function ehMemoria(entrada) {
  if (!entrada || typeof entrada !== 'object') return false;
  const arquivo = entrada.tool_input && typeof entrada.tool_input === 'object' ? entrada.tool_input.file_path : null;
  return [entrada.cwd, arquivo].some((c) => typeof c === 'string' && MEMORIA.test(c));
}

/** O que identifica o pedido do usuario, para nao rodar o portao do prompt de novo; null = nao deduplica. */
function chaveDoPrompt(harness, entrada) {
  const campo = DEDUPLICAR[harness];
  if (!campo || !entrada) return null;
  const v = entrada[campo];
  return typeof v === 'string' ? v : null;
}

/**
 * stdout do portao -> decisao: negar (PreToolUse), bloquear (Stop), segurar (UserPromptSubmit), contexto (ao modelo),
 * aviso (systemMessage, ao usuario). `bruto` guarda o texto como veio, para o harness que fala o formato do Claude
 * Code receber a saida sem reescrita. Texto que nao e JSON e contexto (a abertura escreve texto puro).
 */
function lerSaida(stdout) {
  const bruto = typeof stdout === 'string' ? stdout : '';
  const d = { bruto: bruto };
  if (bruto.trim() === '') return d;
  let j;
  try { j = JSON.parse(bruto); } catch (e) { j = null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) { d.contexto = bruto; return d; }
  const h = j.hookSpecificOutput && typeof j.hookSpecificOutput === 'object' ? j.hookSpecificOutput : {};
  if (h.permissionDecision === 'deny') d.negar = String(h.permissionDecisionReason || '');
  if (j.decision === 'block') d.bloquear = String(j.reason || '');
  if (j.continue === false) d.segurar = String(j.stopReason || '');
  if (typeof h.additionalContext === 'string' && h.additionalContext) d.contexto = h.additionalContext;
  if (typeof j.systemMessage === 'string' && j.systemMessage) d.aviso = j.systemMessage;
  return d;
}

const CAMPOS = ['negar', 'bloquear', 'segurar', 'contexto', 'aviso'];

/** Varias decisoes do mesmo chamado (o apply_patch) -> uma: cada campo junta os textos, sem repetir. */
function juntar(decisoes) {
  if (decisoes.length === 1) return decisoes[0];
  const r = {};
  for (const k of CAMPOS) {
    const v = decisoes.map((d) => d[k]).filter((x) => typeof x === 'string' && x !== '');
    if (v.length) r[k] = Array.from(new Set(v)).join('\n\n');
  }
  return r;
}

function formaClaude(evento, d) {
  let s = null;
  if (d.negar !== undefined) {
    s = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
      permissionDecisionReason: d.negar } };
  } else if (d.bloquear !== undefined) {
    s = { decision: 'block', reason: d.bloquear };
  } else if (d.segurar !== undefined) {
    s = { continue: false, stopReason: d.segurar };
  } else if (d.contexto !== undefined) {
    s = { hookSpecificOutput: { hookEventName: evento, additionalContext: d.contexto } };
  }
  if (d.aviso !== undefined) s = Object.assign(s || {}, { systemMessage: d.aviso });
  return s ? JSON.stringify(s) : '';
}

/**
 * Decisao -> o stdout que o harness entende.
 * - Codex e Qwen: falam o formato do Claude Code e leem texto puro como contexto; a saida do portao vai como veio.
 * - dsh: texto puro some; vai tudo em JSON do Claude Code.
 * - agy: deny {decision, reason}; Stop segura com decision "continue"; contexto so na PreInvocation (injectSteps);
 *   passar = saida vazia, porque `{}` no PreToolUse nega. Sem canal ao usuario: o aviso nao chega (vai a matriz).
 * - OpenCode: a decisao em JSON simples; o plugin faz o throw, o contexto e o reenvio.
 */
function escreverSaida(harness, evento, decisao) {
  const d = decisao || {};
  if (harness === 'codex' || harness === 'qwen') return d.bruto !== undefined ? d.bruto : formaClaude(evento, d);
  if (harness === 'dsh') return formaClaude(evento, d);
  if (harness === 'agy') {
    if (d.negar !== undefined) return JSON.stringify({ decision: 'deny', reason: d.negar });
    if (d.bloquear !== undefined) return JSON.stringify({ decision: 'continue', reason: d.bloquear });
    const msg = d.segurar !== undefined ? d.segurar : d.contexto;
    if (msg !== undefined && (evento === 'SessionStart' || evento === 'UserPromptSubmit')) {
      return JSON.stringify({ injectSteps: [{ ephemeralMessage: msg }] });
    }
    return '';
  }
  if (harness === 'opencode') {
    const r = {};
    for (const k of CAMPOS) if (d[k] !== undefined) r[k] = d[k];
    return Object.keys(r).length ? JSON.stringify(r) : '';
  }
  return '';
}

module.exports = { HARNESSES, FERRAMENTAS, EVENTOS, EMULA_STOP, ABRE_UMA_VEZ, eventosDoHarness, eventosQueDispara,
  matcherDoHarness, normalizar, nomeDaFerramenta, camposDaFerramenta, ehMemoria, chaveDoPrompt, lerSaida, juntar,
  escreverSaida, respostaDoAgy, arquivosDoPatch, TEXTO_DO_PATCH };
