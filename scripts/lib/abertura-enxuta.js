'use strict';

/**
 * C6 (s369, D769 f, D815): a abertura enxuta para modelo de contexto curto. Com "aberturaEnxuta": true no
 * projeto.json, a abertura (abertura.js) deixa as regras do projeto inteiras e troca os 4 blocos fixos - paralelo
 * (paralelismo.js), menos paradas (continuo.js), qualidade de resposta (qualidade.js) e menos codigo (enxuto.js) - por
 * uma linha cada, com o essencial do bloco. Os 4 inteiros somam perto de 3,5 mil caracteres (medido na s369); os
 * resumos, com o rodape, perto de 1,1 mil. So o booleano true liga, como o vigia (`"true"` entre aspas nao liga; a abertura avisa o tipo errado, porque a
 * chave esta em CHAVES_LIGA_DESLIGA). O bloco desligado pela chave dele segue fora: o resumo nao o religa.
 * Texto ao modelo em ASCII (R5), em portugues (D665), como os blocos inteiros.
 */

const CHAVE = 'aberturaEnxuta';

const LINHAS = {
  paralelo: '# sworn - paralelo: siga sem esperar o agente em segundo plano; quem edita junto vai isolado (isolation: worktree, uma copia propria do repositorio); ' +
    'o modelo mais barato que resolve, ate 8 agentes por disparo; 3 ou mais tarefas independentes: /sworn:parallel.',
  continuo: '# sworn - menos paradas: valide voce mesmo antes de pedir ao dono; decisao tecnica, decida e registre ' +
    '("Decisao: <o que> - por que: <motivo> - custo se errado: <o que quebra>"); ao dono so regra de negocio, ' +
    'aparencia, irreversivel e credencial; nao feche anunciando o proximo passo: pare so com "Preciso do dono: <o que>" ' +
    'ou "Espero: <o que roda>".',
  continuoDesligado: '# sworn - menos paradas: valide voce mesmo (teste, navegador) antes de pedir acao manual ao dono; ' +
    'peca so o que so ele pode, num pedido so.',
  qualidade: '# sworn - resposta: conclusao na 1a linha, sem preambulo; termo tecnico explicado na 1a vez; no bloco, ' +
    'so a linha que prova; no idioma do usuario.',
  enxuto: '# sworn - menos codigo: antes de escrever, reuse o que ja existe (projeto, linguagem, plataforma, dependencia ' +
    'instalada); nunca corte validacao na fronteira, perda de dados, seguranca, acessibilidade; atalho de proposito ' +
    'leva "atalho: <o que>. limite: <ate onde vale>. trocar quando: <gatilho>."'
};

const RODAPE = 'Abertura enxuta: os blocos acima sao o resumo. Para o texto inteiro, troque "' + CHAVE + '": true por ' +
  'false (ou tire a chave) em .claude/sworn/projeto.json.';

function ativa(projeto) {
  return projeto !== null && typeof projeto === 'object' && projeto[CHAVE] === true;
}

/** O bloco como vai a abertura: o `inteiro`, ou a linha do resumo `nome` com a chave ligada. O bloco vazio (desligado
 *  pela chave dele) segue vazio. Nome sem resumo e erro de programa: lanca, em vez de sumir com o bloco. */
function bloco(nome, inteiro, projeto) {
  // o nome errado lanca com a chave ligada ou desligada: o erro de programa nao se esconde no caminho padrao
  if (!Object.hasOwn(LINHAS, nome)) throw new Error('bloco sem resumo: ' + nome);
  if (!inteiro || !ativa(projeto)) return inteiro;
  return LINHAS[nome] + '\n';
}

module.exports = { CHAVE, LINHAS, RODAPE, ativa, bloco };
