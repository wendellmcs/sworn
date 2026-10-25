'use strict';

/**
 * Recurso de qualidade de resposta: o bloco que a abertura injeta em toda sessao e a chave que o desliga.
 * O texto nasceu do desenho (docs/qualidade-de-resposta.md, secao 4.1) e so muda pela ronda de ajuste da
 * medicao A/B (D304); mudar uma letra e mudar o que todo usuario recebe. ASCII puro: sai por hook. A chave fica fora de CHAVES de proposito: entrar la
 * invalidaria todo projeto.json ja gravado.
 */
const CHAVE = 'qualidadeDeResposta';
const TETO = 1000;

const BLOCO = [
  '# sworn - qualidade de resposta (toda resposta no chat ao usuario)',
  '',
  '1. Conclusao na 1a linha. Sai: "Vou analisar o modulo". Fica: "A suite passou; falta teste em X". Em decisao, o que muda a escolha vem antes das opcoes.',
  '2. Sem preambulo nem cortesia. Sai: "Otima pergunta!". Bastidor da sessao (sandbox, permissao) so se o usuario tiver de agir.',
  '3. Termo tecnico explicado na 1a vez. Sai: "quebrou no CI". Fica: "quebrou no CI (a checagem automatica)".',
  '4. Entre ferramentas, uma linha: so fato novo. Sai: "Vou ler o arquivo". Fica: "Erro em a.js:12".',
  '5. Evidencia: no bloco, so a linha que prova. Sai: o log inteiro. Fica: "tests 12 | pass 12 | fail 0".',
  '6. Nao repetir o que o usuario acabou de ler ou decidir: citar onde esta. A resposta final fecha sozinha: o que mudou e o que falta, mesmo bloqueada.',
  '',
  // D656 (camada 1): a linha de idioma vira regra de resposta; texto novo ao modelo nasce em ingles.
  "Reply in the user's language; the rules hold in any. Files you write (plan, decision, handoff) are out.",
  'Desligar neste projeto: "' + CHAVE + '": false em .claude/sworn/projeto.json.'
].join('\n') + '\n';

function ehObjeto(p) {
  return !!p && typeof p === 'object' && !Array.isArray(p);
}

/** O bloco, ou null quando o projeto desligou. So `false` desliga: tipo errado segue ligado e avisa. */
function bloco(projeto) {
  return ehObjeto(projeto) && projeto[CHAVE] === false ? null : BLOCO;
}

/** Aviso de tipo da chave, no formato de projeto.avisosDeTipo; null quando esta certa ou ausente. */
function avisoDeTipo(projeto) {
  if (!ehObjeto(projeto) || !(CHAVE in projeto) || typeof projeto[CHAVE] === 'boolean') return null;
  return CHAVE + ' tem de ser true ou false';
}

module.exports = { CHAVE, TETO, BLOCO, bloco, avisoDeTipo };
