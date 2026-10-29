'use strict';

/** Devolve String(valor) sem o U+FEFF (BOM) inicial, se houver. */
function semBom(valor) {
  const s = String(valor);
  return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
}

const TRADUCOES = {
  ENOENT: 'nao existe',
  EACCES: 'sem permissao',
  EPERM: 'sem permissao',
  EISDIR: 'e uma pasta',
  ENOTDIR: 'parte do caminho nao e uma pasta',
  EBUSY: 'em uso',
  EEXIST: 'ja existe',
  ENOSPC: 'disco cheio',
};

/** Causa de um erro em uma linha (max. 200), com o codigo do Node traduzido: "nao existe (ENOENT)". Origem: F3-22 (D297 secao 4); o shell.js passa a usar esta na T1. */
function causaDoErro(e) {
  let causa;
  if (e && e.code) {
    const codigo = String(e.code);
    const traducao = Object.prototype.hasOwnProperty.call(TRADUCOES, codigo) ? TRADUCOES[codigo] : null;
    causa = traducao ? traducao + ' (' + codigo + ')' : codigo;
  } else {
    causa = e && e.name ? e.name + ': ' + e.message : String(e);
  }
  return causa.replace(/\s+/g, ' ').slice(0, 200);
}

/**
 * O prompt que chegou ao UserPromptSubmit e retorno de subagente ou aviso de tarefa, e nao fala do dono?
 * D475/D477: o relatorio que CITA "o contexto esta bom?" ou uma correcao nao e o dono falando.
 * s103: no 2.1.296 o retorno vem como "Another Claude session sent a message[ while you were working]:" + a tag.
 * D484: um lugar so (saude.perguntaSobreSaude e correcao.pareceCorrecao); se a CLI mudar a forma, muda aqui.
 */
function veioDeSubagente(prompt) {
  if (typeof prompt !== 'string') return false;
  const t = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
  return /^(?:another claude session sent a message[a-z ]*: )?<(?:agent-message|task-notification)\b/.test(t);
}

/**
 * O valor entre aspas, numa linha so, para um aviso: a aspa de dentro vira \" e a quebra de linha vira espaco, para o
 * nome que traz uma ou outra nao deformar a mensagem. A barra fica como esta (o caminho do Windows se le igual).
 */
function entreAspas(valor) {
  return '"' + String(valor).replace(/[\r\n]+/g, ' ').replace(/"/g, '\\"') + '"';
}

/**
 * A resposta do subagente no evento do gancho: o `last_assistant_message` do SubagentStop ou o `tool_input.message` do
 * handback (PostToolUse do SubagentHandback, no modo auto). Outro evento, outra ferramenta, entrada que nao e objeto
 * ou resposta que nao e texto: undefined. Nunca lanca.
 * A2-16: uma fonte so para o gravar-veredito.js e o escalar.js (as copias ja divergiam no PostToolUse sem tool_name).
 */
function mensagemDoSubagente(e) {
  if (!e || typeof e !== 'object') return undefined;
  let m;
  if (e.hook_event_name === 'SubagentStop') m = e.last_assistant_message;
  else if (e.hook_event_name === 'PostToolUse' && e.tool_name === 'SubagentHandback' && e.tool_input) {
    m = e.tool_input.message;
  }
  return typeof m === 'string' ? m : undefined;
}

module.exports = { semBom, causaDoErro, veioDeSubagente, entreAspas, mensagemDoSubagente };
