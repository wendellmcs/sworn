'use strict';
// Plano do radar, T3b (D611): o radar do usuario se oferece sozinho quando o pedido e de melhoria, sugestao ou
// funcao nova. Molde: correcao.test.js. O detector e conservador de proposito: perder uma oferta e so nao oferecer
// (o dono ainda roda /sworn:radar); oferecer em relato de bug ou em pedido de commit e ruido. A fiacao no gancho
// (1 vez por sessao, chave, repo do plugin, subagente) esta em fiacao.test.js.
const test = require('node:test');
const assert = require('node:assert');
const oferta = require('../scripts/lib/radar-oferta.js');

const POSITIVOS = [
  // PT
  'quero adicionar uma função de exportar relatório em CSV', 'Quero adicionar uma funcao de busca', 'gostaria de criar uma nova funcionalidade de login',
  'preciso implementar um recurso de notificações', 'queria incluir uma ferramenta de backup no app',
  'como posso melhorar este projeto?', 'como posso melhorar o app', 'como podemos aprimorar a interface?',
  'sugere melhorias', 'Sugira melhorias para o projeto', 'me sugira algumas funcionalidades', 'sugere umas ideias',
  'nova feature: exportar para PDF', 'quero uma nova feature de filtros', 'tenho ideias de novas funcionalidades',
  'adicione uma funcionalidade de modo escuro', 'crie uma feature de favoritos',
  'o que mais posso adicionar ao projeto?', 'quero melhorar o projeto', 'melhore o projeto', 'quero aprimorar a extensão',
  // EN
  'I want to add a function that exports reports', 'add a feature to export CSV', 'Add a new feature for dark mode',
  'how can I improve this project?', 'how could we improve the app', 'how can I improve the codebase',
  'suggest improvements', 'Suggest some features for this tool', 'can you recommend improvements',
  'new feature: favorites', 'I need a new feature for search', 'ideas for new features', 'improve the project',
  "i'd like to build a new integration with slack"
];

const NEGATIVOS = [
  // relato de bug
  'o botão parou de funcionar', 'o botao para de funcionar quando clico duas vezes', 'o login nunca mais funcionou',
  'a nova feature quebrou o login', 'a função nova retorna undefined', 'corrija o bug na função de login',
  // pergunta de codigo
  'onde está a função calcularTotal?', 'onde esta a funcao X', 'explique a função de login', 'what does this function do?',
  'where is the add function defined?',
  // "melhorar" sobre o proprio agente ou a resposta
  'melhore sua resposta', 'melhore a resposta', 'como posso melhorar sua resposta?', 'como posso melhorar o meu prompt',
  'improve your answer', 'how can I improve your answer?', 'how can i improve my prompt', 'faça uma resposta melhor',
  // pedido de commit e rotina
  'faça o commit', 'commit as mudanças', 'faça o commit das melhorias', 'sugira uma mensagem de commit com as melhorias',
  'commit the changes', 'rode os testes', 'adicione um teste', 'adicione o next.js ao projeto', 'crie uma função que soma dois números',
  'add a unit test', 'push the branch',
  '', '   ', 'segue'
];

test('radar-oferta: detecta pedido de melhoria, sugestao ou funcao nova (PT e EN)', () => {
  const erros = POSITIVOS.filter((p) => !oferta.parecePedidoDeMelhoria(p));
  assert.deepStrictEqual(erros, [], 'nao reconheceu: ' + erros.join(' | '));
});

test('radar-oferta: relato de bug, pergunta de codigo, melhorar o proprio agente e commit nao sao pedido de melhoria', () => {
  const erros = NEGATIVOS.filter((p) => oferta.parecePedidoDeMelhoria(p));
  assert.deepStrictEqual(erros, [], 'reconheceu a mais: ' + erros.join(' | '));
});

test('radar-oferta: entrada que nao e texto nunca dispara, e o relatorio de subagente tambem nao', () => {
  for (const v of [undefined, null, 42, {}, [], true]) assert.strictEqual(oferta.parecePedidoDeMelhoria(v), false);
  // D477/D484: o prompt que veio de subagente (relatorio citando um pedido) nao e o dono pedindo.
  const texto = require('../scripts/lib/texto.js');
  const relatorio = '<task-notification>\n<result>o dono disse: quero adicionar uma funcao de exportar</result>\n</task-notification>';
  assert.strictEqual(texto.veioDeSubagente(relatorio), true, 'controle: o filtro de texto.js reconhece o relatorio');
  assert.strictEqual(oferta.parecePedidoDeMelhoria(relatorio), false);
});

test('radar-oferta: ligada por padrao; so false desliga (como sugerirAprender)', () => {
  assert.strictEqual(oferta.CHAVE, 'oferecerRadar');
  assert.strictEqual(oferta.ligada(undefined), true);
  assert.strictEqual(oferta.ligada(null), true);
  assert.strictEqual(oferta.ligada({}), true);
  assert.strictEqual(oferta.ligada({ oferecerRadar: true }), true);
  assert.strictEqual(oferta.ligada({ oferecerRadar: 'false' }), true, '"false" entre aspas nao desliga (D388, D415)');
  assert.strictEqual(oferta.ligada({ oferecerRadar: 0 }), true);
  assert.strictEqual(oferta.ligada({ oferecerRadar: false }), false);
  assert.strictEqual(oferta.ligada([]), true);
});

test('radar-oferta: a instrucao e ASCII puro (sai por hook) e traz o combinado', () => {
  const t = oferta.INSTRUCAO_DA_OFERTA;
  assert.match(t, /^[\x00-\x7f]*$/, 'additionalContext tem de ser ASCII: ' + JSON.stringify(t));
  assert.match(t, /AskUserQuestion, em 3 opcoes/);
  assert.ok(t.indexOf('recomendada') !== -1, 'a recomendada marcada');
  // s116: o custo da busca por tema medido no -p (US$ 1,17, 352 s, 11 lidos e 4 a fundo), nao o da lista de 2.
  assert.ok(t.indexOf('US$ 1,20') !== -1 && /Sonnet/.test(t) && /11 projetos lidos e 4 a fundo/.test(t) &&
    t.indexOf('0,30 a 0,60') === -1, 'o custo medido da busca por tema');
  assert.ok(t.indexOf('agora nao') !== -1, 'a opcao de adiar');
  assert.ok(t.indexOf('"oferecerRadar": false') !== -1, 'a opcao de nunca mais, com a chave');
  assert.ok(t.indexOf('/sworn:radar') !== -1, 'qual comando roda com o sim');
  assert.match(t, /busca por tema|tema deste pedido/, 'projetos parecidos com o tema do pedido');
  assert.match(t, /Nada roda sem o sim/);
  assert.match(t, /ignore/, 'quando nao e pedido de melhoria, ignora');
});
