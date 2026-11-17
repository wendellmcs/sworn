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
    // R1 do H1v: sem mensagem, so o nome (antes saia "AbortError: undefined").
    causa = e && e.name ? (e.message ? e.name + ': ' + e.message : String(e.name)) : String(e);
  }
  // R1 do H1v: o corte conta caractere, nao metade de um emoji (o par substituto partido saia quebrado).
  // 400 unidades ja cobrem 200 caracteres: o Array.from nao percorre a mensagem inteira (stdout grande).
  return Array.from(causa.replace(/\s+/g, ' ').slice(0, 400)).slice(0, 200).join('');
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
 * nome que traz uma ou outra nao deformar a mensagem. A barra fica como esta (o caminho do Windows se le igual),
 * menos a que vem logo antes de uma aspa ou do fim: essa dobra, para nao comer a aspa (R2 do H1v: `C:\pasta\`).
 */
function entreAspas(valor) {
  return '"' + String(valor).replace(/[\r\n]+/g, ' ').replace(/(\\+)(?="|$)/g, '$1$1').replace(/"/g, '\\"') + '"';
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

/**
 * A7-32: o objeto JSON de verdade (nem null, nem lista, nem valor solto). Fonte unica: os modulos que o copiavam
 * o pegam daqui.
 */
function ehObjeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * S8/L2-abe-1 e L2-ape-2: caminho que o AGENTE vai copiar para o shell, entre aspas do shell declarado no projeto
 * (`plataforma.shell`; A1-29 e P16-abertura-r1-25). Caminho que nao e texto lanca: virar '"undefined"' daria ao
 * agente um caminho que nao existe.
 * - 'powershell' (ou 'pwsh', em qualquer caixa): aspas duplas no caso normal; com `$`, crase ou aspa dupla (a reta e
 *   as tipograficas, que o PowerShell tambem le como aspa) vai entre aspas simples, e cada aspa simples (a reta e as
 *   tipograficas) dobra. A barra do Windows fica como esta: no PowerShell ela nao escapa nada.
 * - sem declarar (P16-abertura-r2: a ordem do init sai justo quando nao ha projeto.json), aspas que nao executam
 *   nada em nenhum dos dois: aspas duplas sem `$`, crase, aspa dupla (reta ou tipografica), barra no fim nem barra
 *   dobrada; senao aspas simples; com aspa simples tambem, a aspa simples dobra como no PowerShell, e no Bash o
 *   caminho perde a aspa, mas nada nele roda. Declare o shell para o caminho sair exato.
 * - qualquer outro valor, o do Bash: aspas duplas so quando nada nelas se reinterpreta, isto e, sem `$`, crase,
 *   `"`, barra no fim nem barra dobrada (o UNC `\\srv`); senao aspas simples; com `'` tambem, aspas duplas com `\`
 *   antes de `\`, `$`, crase e `"`.
 */
function caminhoParaShell(p, shell) {
  if (typeof p !== 'string') throw new TypeError('caminhoParaShell: o caminho tem de ser texto, veio ' + typeof p);
  const declarado = String(shell || '');
  if (/^(powershell|pwsh)$/i.test(declarado)) {
    if (!/[$`"\u201C\u201D\u201E]/.test(p)) return '"' + p + '"';
    return "'" + p.replace(/['\u2018\u2019\u201A\u201B]/g, '$&$&') + "'";
  }
  if (!declarado) {
    if (!/[$`"\u201C\u201D\u201E]|\\\\|\\$/.test(p)) return '"' + p + '"';
    if (!/['\u2018\u2019\u201A\u201B]/.test(p)) return "'" + p + "'";
    return "'" + p.replace(/['\u2018\u2019\u201A\u201B]/g, '$&$&') + "'";
  }
  if (!/[$`"]|\\\\|\\$/.test(p)) return '"' + p + '"';
  if (p.indexOf("'") === -1) return "'" + p + "'";
  return '"' + p.replace(/([\\$`"])/g, '\\$1') + '"';
}

module.exports = { semBom, causaDoErro, veioDeSubagente, entreAspas, mensagemDoSubagente, ehObjeto, caminhoParaShell };
