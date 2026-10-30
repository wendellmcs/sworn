'use strict';

/**
 * Le o JSON que o Claude Code entrega no stdin do hook.
 * Entrada vazia ou invalida vira objeto vazio: o portao decide sozinho o que fazer,
 * e nunca estoura por causa da entrada.
 */
function lerEntrada(callback) {
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
  if (extra) process.stdout.write(JSON.stringify(extra));
  process.exit(0);
}

/** PreToolUse: nega a chamada de ferramenta. O motivo chega ao Claude. */
function negarFerramenta(motivo) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: motivo
    }
  }));
  process.exit(0);
}

/** Stop: impede o fecho do turno. `aviso` vai para o usuario, nao para o Claude. */
function bloquearFecho(motivo, aviso) {
  const saida = { decision: 'block', reason: motivo };
  if (aviso) saida.systemMessage = aviso;
  process.stdout.write(JSON.stringify(saida));
  process.exit(0);
}

/**
 * UserPromptSubmit (plano 084; forma curta da 0.11.0, D587): para o turno antes do Claude. O Claude Code mostra
 * "Operation stopped by hook: " + `motivo` so ao usuario, sem repetir o prompt, e o prompt fica no registro do chat
 * como mensagem do usuario (sonda da D587 com a claude.exe 2.1.306, custo zero). A forma `decision: block` de antes
 * repetia o prompt inteiro depois de "Original prompt:".
 */
function segurarMensagem(motivo) {
  process.stdout.write(JSON.stringify({ continue: false, stopReason: motivo }));
  process.exit(0);
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
  try { causa = require('./texto.js').causaDoErro(e); } catch (x) { causa = 'valor lancado sem texto legivel'; }
  process.stderr.write('sworn: portao falhou e liberou por seguranca: ' + causa + '\n');
  process.exit(0);
}

/**
 * R6: portao que falha, libera. Excecao vira exit 0 silencioso.
 * stderr em exit 0 vai so para o log de debug e o Claude nunca ve.
 * Cobre tanto a excecao sincrona (try/catch em volta de fn()) quanto a
 * excecao lancada dentro de um callback assincrono que fn() registra:
 * por exemplo, dentro do callback de lerEntrada, que roda no evento 'end'
 * do stdin, depois que este try/catch ja saiu de escopo. Sem o
 * uncaughtException, esse caminho vazava com exit 1, violando o R6.
 */
function blindar(fn) {
  process.on('uncaughtException', liberarPorFalha);
  try {
    fn();
  } catch (e) {
    liberarPorFalha(e);
  }
}

module.exports = { lerEntrada, permitir, negarFerramenta, bloquearFecho, segurarMensagem, blindar };
