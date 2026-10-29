'use strict';
const regraLib = require('./regra.js');

// Criterio 3: a descricao tem de dizer QUANDO usar. Em portugues e em ingles: os moldes do plugin sao em ingles (D656).
// O \b fecha o grupo inteiro: "use noite" nao e "use no".
const RE_QUANDO = /\b(use quando|use no|use ao|use antes|use depois|quando (voce|o agente|a tarefa)|use (when|at|before|after|inside|on)|when (you|the agent|the task))\b/i;
// O frontmatter e o bloco entre as duas linhas --- do topo: description no corpo ou num bloco de codigo nao vale.
const RE_FRONTMATTER = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
// O valor e o resto da linha mais as linhas indentadas de baixo (o bloco `>`/`|` do YAML). [ \t], e nao \s: a
// description vazia nao pega a linha seguinte.
const RE_DESCRICAO = /^description:[ \t]*(.*(?:\r?\n[ \t]+\S.*)*)/im;
// Criterio 6: titulo "o que ... nao promete/garante/faz" ou "what ... does not promise/guarantee/do". Termina no verbo,
// em outro verbo da lista ("nem garante") ou num parentese curto ("(yet)"): "## O que nao faz parte" nao vale.
const RE_SECAO_CRITERIO_6 = /^#{1,6}\s.*\b(o[ \t]+que|what)\b.*(n[aã]o\s+(promete|garante|faz)([ \t]*(,|e|nem|ou)[ \t]+(promete|garante|faz))*|(does\s+not|doesn't|will\s+not|won't)\s+(promise|guarantee|do)([ \t]*(,|and|or|nor)[ \t]+(promise|guarantee|do))*)([ \t]*\([^)\r\n]{1,30}\))?[ \t.:]*$/im;
// Criterio 1: item de lista que comeca proibindo ou obrigando, em portugues ou em ingles. O apostrofo tambem o
// tipografico (U+2019), que o editor poe sozinho.
const RE_PROIBICAO = /^(nunca|sempre|proibido|n[aã]o\s+fa[cç]a|jamais|never|always|forbidden|do\s+not|must\s+not|don['\u2019]t)\b/i;
const ONDE_MORA = 'O numero e o do criterio na rubrica de modelos/boa-skill.md.';

function conferir(texto) {
  const t = String(texto == null ? '' : texto);
  const erros = [];

  const fm = RE_FRONTMATTER.exec(t);
  const d = fm ? fm[1].match(RE_DESCRICAO) : null;
  // A3-40: o numero do criterio e o da rubrica; cada mensagem diz onde ela mora, porque sai sozinha na tela.
  if (!d || !d[1]) {
    erros.push('criterio 3: falta a linha description no cabecalho da skill (o frontmatter, entre as duas linhas ' +
      '--- do topo). Escreva ali uma linha "description: Use quando <situacao>." dizendo quando ela deve ser usada. ' +
      ONDE_MORA);
  } else if (!RE_QUANDO.test(d[1])) {
    erros.push('criterio 3: a linha description do cabecalho diz o que a skill faz, e nao quando usar. Comece por ' +
      '"Use quando ...", "Use antes de ..." ou, em skill escrita em ingles, "Use when ...": e a unica linha que ' +
      'decide se ela e invocada. ' + ONDE_MORA);
  }

  if (!RE_SECAO_CRITERIO_6.test(t)) {
    erros.push('criterio 6: falta a secao do que a skill nao promete. Abra uma com um titulo como ' +
      '"## O que NAO promete" ou "## What this skill does NOT do": dito agora, e nao descoberto no fim. ' + ONDE_MORA);
  }

  // Criterio 1: item de lista que parece regra tem de ter gatilho.
  const linhas = t.split(/\r?\n/);
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i].trim();
    if (!/^[-*+]\s+/.test(l)) continue;
    const corpo = l.replace(/^[-*+]\s+/, '');
    if (!RE_PROIBICAO.test(corpo)) continue;
    if (regraLib.SETA.test(corpo)) continue;
    erros.push('criterio 1, linha ' + (i + 1) + ': proibicao solta sem gatilho. Reescreva como "<gatilho> -> <acao>": ' + corpo.slice(0, 60));
  }

  return { ok: erros.length === 0, erros: erros };
}

module.exports = { RE_QUANDO, conferir };
