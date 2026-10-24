'use strict';

/**
 * D553/D554 (0.9.0): o bloco "menos codigo" que a abertura injeta em toda sessao, depois do de qualidade de
 * resposta, no molde do de paralelismo (paralelismo.js). A ideia vem do ponytail (a escada antes de escrever
 * codigo); o texto e nosso. ASCII puro: sai por hook. O formato do comentario de atalho e o da D554 (rotulos, nao
 * virgula) e e o que o /sworn:shortcuts le.
 */
const CHAVE = 'menosCodigo';
const TETO = 800;

const BLOCO = [
  '# sworn - menos codigo (antes de escrever codigo)',
  '',
  'Suba a escada e pare no primeiro degrau que resolve:',
  '1. Precisa existir? O pedido nao exige: nao escreva.',
  '2. Ja existe no projeto? Reuse e cite arquivo:linha.',
  '3. A linguagem ja faz (biblioteca padrao)?',
  '4. A plataforma ja faz (Node, navegador, framework)?',
  '5. Uma dependencia ja instalada faz?',
  '6. Cabe em uma linha?',
  '7. So entao, o minimo que funciona.',
  '',
  'Nunca se corta: validacao na fronteira, perda de dados, seguranca, acessibilidade.',
  'Atalho de proposito leva comentario: atalho: <o que>. limite: <ate onde vale>. trocar quando: <gatilho>.',
  'Vale para codigo; texto de documento fica fora.',
  'Desligar neste projeto: "' + CHAVE + '": false em .claude/sworn/projeto.json.'
].join('\n') + '\n';

/** O bloco, ou null quando o projeto desligou. So o booleano `false` desliga (D388/D415). */
function bloco(projeto) {
  const objeto = !!projeto && typeof projeto === 'object' && !Array.isArray(projeto);
  return objeto && projeto[CHAVE] === false ? null : BLOCO;
}

module.exports = { CHAVE, TETO, BLOCO, bloco };
