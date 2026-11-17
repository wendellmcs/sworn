'use strict';

// A5-63: calculado no carregamento, para o tratador de falha (liberarPorFalha) nao chamar nada que possa lancar.
const TEXTO_JS = require('path').join(__dirname, 'texto.js');

// F3a (D828): varios ganchos num processo so (portao-shell.js, depois-do-shell.js). No modo embutido o gancho le a
// entrada guardada, e a decisao (permitir, negar, bloquear) fica registrada em vez de ir ao stdout com process.exit;
// a PARADA desenrola o gancho ate o rodarJuntos. Fora dele, nada muda: cada gancho segue rodando sozinho.
let embutido = null;
const PARADA = { swornParada: true };

/** Escreve a decisao e sai; no modo embutido, so a registra. */
function sair(saida) {
  if (embutido) {
    // a 1a decisao vale, como o process.exit do gancho sozinho: um catch do gancho que engula a PARADA nao a troca
    if (!embutido.decidiu) { embutido.saida = saida || null; embutido.decidiu = true; }
    throw PARADA;
  }
  if (saida) process.stdout.write(JSON.stringify(saida));
  process.exit(0);
}

/**
 * Le o JSON que o Claude Code entrega no stdin do hook.
 * Entrada vazia ou invalida vira objeto vazio: o portao decide sozinho o que fazer,
 * e nunca estoura por causa da entrada.
 */
function lerEntrada(callback) {
  if (embutido) { callback(embutido.entrada); return; }
  let bruto = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (pedaco) { bruto += pedaco; });
  process.stdin.on('end', function () {
    let entrada;
    try {
      entrada = bruto.trim() === '' ? {} : JSON.parse(bruto);
    } catch (e) {
      entrada = {};
    }
    if (entrada === null || typeof entrada !== 'object') entrada = {};
    callback(entrada);
  });
}

/** Sai sem opiniao. `extra` permite anexar systemMessage sem tomar decisao. */
function permitir(extra) {
  sair(extra);
}

/** PreToolUse: nega a chamada de ferramenta. O motivo chega ao Claude. */
function negarFerramenta(motivo) {
  sair({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: motivo
    }
  });
}

/** Stop: impede o fecho do turno. `aviso` vai para o usuario, nao para o Claude. */
function bloquearFecho(motivo, aviso) {
  const saida = { decision: 'block', reason: motivo };
  if (aviso) saida.systemMessage = aviso;
  sair(saida);
}

/**
 * UserPromptSubmit (plano 084; forma curta da 0.11.0, D587): para o turno antes do Claude. O Claude Code mostra
 * "Operation stopped by hook: " + `motivo` so ao usuario, sem repetir o prompt, e o prompt fica no registro do chat
 * como mensagem do usuario (sonda da D587 com a claude.exe 2.1.306, custo zero). A forma `decision: block` de antes
 * repetia o prompt inteiro depois de "Original prompt:".
 */
function segurarMensagem(motivo) {
  sair({ continue: false, stopReason: motivo });
}

/**
 * Corpo comum da recuperacao: mesma mensagem, mesma saida, para o caminho
 * sincrono (catch) e o caminho assincrono (uncaughtException). Existe para
 * nao duplicar o bloco entre os dois pontos de captura de blindar().
 */
function liberarPorFalha(e) {
  // A5-27/A5-29 (D735): o valor lancado pode nao ser Error (texto, null); o causaDoErro cobre os dois. Quebra final.
  // O tratador de falha nao pode falhar: objeto sem prototipo faz o String() lancar.
  let causa;
  // A5-63: a reserva tambem cobre o texto.js que nao carrega; diz as duas causas e o passo. A5-76: curta, para uma
  // linha de stderr. s266 (R2): diz o que o texto.js faz e o passo se o comando der erro.
  try {
    causa = require('./texto.js').causaDoErro(e);
  } catch (x) {
    // A5-82: sem o jargao "valor lancado" e sem o "ou ... ou"; duas frases, a causa e o passo
    causa = 'nao deu para ler o erro: o erro nao vira texto ou o texto.js do plugin, que o converte, nao carregou. ' +
      'Se node "' + TEXTO_JS + '" der erro, reinstale o plugin';
  }
  process.stderr.write('sworn: portao falhou e liberou por seguranca: ' + causa + '\n');
  // F3a: no modo embutido, o gancho que falha libera sem opiniao e os outros do mesmo processo seguem rodando.
  if (embutido) { if (!embutido.decidiu) { embutido.saida = null; embutido.decidiu = true; } return; }
  process.exit(0);
}

/**
 * R6: portao que falha, libera. Excecao vira exit 0, com uma linha da causa em stderr (liberarPorFalha).
 * stderr em exit 0 vai so para o log de debug e o Claude nunca ve. (A5-28)
 * Cobre tanto a excecao sincrona (try/catch em volta de fn()) quanto a
 * excecao lancada dentro de um callback assincrono que fn() registra:
 * por exemplo, dentro do callback de lerEntrada, que roda no evento 'end'
 * do stdin, depois que este try/catch ja saiu de escopo. Sem o
 * uncaughtException, esse caminho vazava com exit 1, violando o R6.
 * No modo embutido (rodarJuntos) a excecao libera so o gancho que falhou, sem sair do processo, e a PARADA (a decisao
 * ja registrada) nao conta como falha.
 */
function blindar(fn) {
  if (!embutido) process.on('uncaughtException', liberarPorFalha);
  try {
    fn();
  } catch (e) {
    if (e === PARADA) return;
    liberarPorFalha(e);
  }
}

/**
 * F3a (D828): roda os ganchos `scripts` (caminhos absolutos) um depois do outro, no mesmo processo, todos com a mesma
 * `entrada` (uma copia para cada um, como quando o Claude Code os roda em paralelo), e devolve a saida de cada um
 * (null = sem opiniao). Cada gancho e um script que roda no require: este processo carrega cada um uma vez so.
 */
function rodarJuntos(entrada, scripts) {
  const saidas = [];
  for (const script of scripts) {
    embutido = { entrada: JSON.parse(JSON.stringify(entrada || {})), saida: null, decidiu: false };
    try {
      require(script);
    } catch (e) {
      if (e !== PARADA) liberarPorFalha(e);
    }
    saidas.push(embutido.saida);
    embutido = null;
  }
  return saidas;
}

/**
 * F3a: junta as saidas de varios ganchos do mesmo evento numa so, como o Claude Code junta as de ganchos paralelos: a
 * primeira negacao (`permissionDecision: deny`) volta sozinha; sem negacao, havendo um `decision: block`, a saida
 * bloqueia com os motivos de todos os bloqueios somados; `systemMessage` e `additionalContext` se somam; o
 * `updatedInput` e o do primeiro que o traz. Outros campos (nenhum dos ganchos juntados os usa) nao passam. Sem nada a
 * dizer, null.
 */
function juntarSaidas(saidas, evento) {
  const validas = saidas.filter(function (s) { return s && typeof s === 'object'; });
  const negacao = validas.find(function (s) {
    return s.hookSpecificOutput && s.hookSpecificOutput.permissionDecision === 'deny';
  });
  if (negacao) return negacao;
  const junta = {};
  const somar = function (alvo, chave, valor) {
    if (typeof valor !== 'string' || !valor) return;
    alvo[chave] = alvo[chave] ? alvo[chave] + '\n\n' + valor : valor;
  };
  const especifico = {};
  for (const s of validas) {
    if (s.decision === 'block') {
      junta.decision = 'block';
      somar(junta, 'reason', s.reason);
    }
    somar(junta, 'systemMessage', s.systemMessage);
    const h = s.hookSpecificOutput || {};
    somar(especifico, 'additionalContext', h.additionalContext);
    if (h.updatedInput && !especifico.updatedInput) especifico.updatedInput = h.updatedInput;
  }
  if (Object.keys(especifico).length) junta.hookSpecificOutput = Object.assign({ hookEventName: evento }, especifico);
  return Object.keys(junta).length ? junta : null;
}

/** F3a: o gancho esta rodando dentro do rodarJuntos (para o que so roda como processo principal saber que e a vez). */
function embutidoAtivo() {
  return embutido !== null;
}

module.exports = { lerEntrada, permitir, negarFerramenta, bloquearFecho, segurarMensagem, blindar, rodarJuntos,
  juntarSaidas, embutidoAtivo };
