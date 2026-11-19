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
// Criterio 10: as 500 linhas sao as da documentacao de skills do Claude Code; os 500 caracteres da descricao, decisao
// do dono (D881), abaixo dos 1024 que a documentacao aceita, porque a descricao entra em toda sessao.
const LINHAS_DA_SKILL = 500;
const CARACTERES_DA_DESCRICAO = 500;

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

  // Criterio 10 (H9-2, D881, curso Introduction to agent skills): curta, com teto declarado. A descricao pesa em toda
  // sessao (o Claude Code lista nome e descricao de cada skill desde o comeco); o corpo, cada vez que a skill e chamada.
  const linhas = t.split(/\r?\n/);
  const quantasLinhas = linhas.length - (linhas[linhas.length - 1] === '' ? 1 : 0);
  if (quantasLinhas > LINHAS_DA_SKILL) {
    erros.push('criterio 10: a skill tem ' + quantasLinhas + ' linhas, acima de ' + LINHAS_DA_SKILL + '. Leve o que so ' +
      'vale num caso para um arquivo em references/ e diga no corpo quando le-lo. ' + ONDE_MORA);
  }
  if (d && d[1]) {
    // conta o valor, nao a marcacao do YAML: sem o indicador de bloco (>, |, >-, |+) e sem as aspas em volta
    let valor = d[1].replace(/\s+/g, ' ').trim().replace(/^[>|][-+]?\s*/, '');
    if (/^(["']).*\1$/.test(valor) && valor.length >= 2) valor = valor.slice(1, -1);
    const caracteres = Array.from(valor).length;
    if (caracteres > CARACTERES_DA_DESCRICAO) {
      erros.push('criterio 10: a linha description tem ' + caracteres + ' caracteres, acima de ' +
        CARACTERES_DA_DESCRICAO + '. Ela pesa em toda sessao: deixe o que a skill faz e quando usar, e leve o resto ' +
        'para o corpo. ' + ONDE_MORA);
    }
  }

  // Criterio 1: item de lista que parece regra tem de ter gatilho.
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

module.exports = { RE_QUANDO, LINHAS_DA_SKILL, CARACTERES_DA_DESCRICAO, conferir };
