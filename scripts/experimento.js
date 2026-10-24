#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ob = require('./lib/obrigacoes.js');

/**
 * O EXPERIMENTO DA D83: o manual antigo ainda e preciso, ou o plugin basta?
 *
 * Decisao 10 do dono. E a unica coisa do plano que pode dizer que o resto nao
 * serviu - e por isso vem depois de publicar, nao antes.
 *
 * Este script NAO executa o experimento, e nao pode: o experimento e uma tarefa
 * real, numa sessao real, feita por gente. O que ele faz sao as duas metades
 * mecanizaveis, do mesmo jeito que a sondagem do H4 (decisao 16):
 *
 *   --roteiro    monta a tabela de obrigacoes a partir dos manuais e diz como
 *                preenche-la. Sem isto a tabela sairia escrita a mao, e uma
 *                tabela escrita a mao envelhece calada.
 *   --veredito   le o resultado gravado e julga: NAO PROVADO, INVALIDO,
 *                INCONCLUSIVO, NAO BASTA ou BASTA.
 *
 * O manual do plugin e o daqui. O SEGUNDO manual vem por --manual e nunca esta
 * cravado: o caminho do manual de um projeto e um fato de fora, e fato de fora
 * dentro do codigo e vazamento na superficie publicada.
 */

const MANUAL_DO_PLUGIN = path.join(__dirname, '..', 'skills', 'playbook');
const RESULTADO = ['.claude', 'sworn', 'experimento-d83.json'];

const COMO_EXECUTAR = [
  'A tarefa tem de ser REAL, do projeto de verdade, e das que disparam a marcha',
  'mais rigorosa. Tarefa inventada nao exercita os valores literais, e sao eles',
  'que estao em julgamento.',
  'O manual antigo tem de estar FORA da sessao - nao basta nao invoca-lo: quem',
  'injeta manual em subagente tambem conta.',
  'Para CADA linha, diga o que a fez valer:',
  '  HOOK    um portao do plugin barrou ou exigiu       -> o plugin cobre',
  '  REGRAS  o arquivo de regras do projeto disse, e foi lido',
  '  SKILL   uma skill gerada no projeto disse',
  '  FORA    decisao anterior ja pos isto fora do plugin -> cite a decisao',
  '  NADA    ninguem exigiu; so aconteceu se o agente lembrou   <<< O ACHADO',
  'Evidencia e o que se pode conferir depois - o nome do portao que disparou, a',
  'linha do arquivo de regras, a mensagem que voltou. Nunca a sua impressao.',
  'Quem preenche NAO pode ser quem executou a tarefa: o executor sabe o que',
  'pretendia fazer e le intencao como cobertura.'
];

function arg(nome) {
  const i = process.argv.indexOf(nome);
  return i === -1 ? null : (process.argv[i + 1] || null);
}
function tem(nome) { return process.argv.indexOf(nome) !== -1; }

function sair(texto, codigo) {
  process.stdout.write(texto + '\n');
  process.exit(codigo);
}

const doPlugin = ob.inventario(MANUAL_DO_PLUGIN);
if (!doPlugin.ok) {
  sair('ERRO: nao achei o manual do plugin em skills/playbook. Esta instalacao esta incompleta.', 1);
}

const caminhoOutro = arg('--manual');
const doOutro = caminhoOutro ? ob.inventario(caminhoOutro) : { ok: false, obrigacoes: [] };
if (caminhoOutro && !doOutro.ok) {
  sair('ERRO: --manual aponta para "' + caminhoOutro + '", onde nao ha SKILL.md.', 1);
}
const cruz = ob.cruzar(doPlugin, doOutro);
const linhas = ob.linhasDoExperimento(cruz);

// ── o veredito ───────────────────────────────────────────────────────────

if (tem('--veredito')) {
  const onde = arg('--resultado') || path.join(process.cwd(), RESULTADO[0], RESULTADO[1], RESULTADO[2]);
  let gravado = null;
  try { gravado = JSON.parse(fs.readFileSync(onde, 'utf8')); } catch (e) { gravado = null; }
  const c = ob.conferirResultado(linhas, gravado);

  const L = [];
  L.push('EXPERIMENTO - o manual antigo ainda e preciso?');
  L.push('obrigacoes no inventario: ' + c.total +
    (cruz.cruzou ? ' (plugin ' + doPlugin.obrigacoes.length + ', segundo manual ' +
      doOutro.obrigacoes.length + ', so no segundo ' + cruz.soNoOutro.length + ')' :
      ' (so o manual do plugin; sem --manual nao ha cruzamento)'));
  // A saida e colada como evidencia: caminho de fora da pasta atual sai so pelo nome.
  const relativo = path.relative(process.cwd(), onde);
  const mostrar = (relativo.startsWith('..') || path.isAbsolute(relativo)) ? path.basename(onde) : relativo;
  L.push('resultado lido de: ' + (gravado ? mostrar : '(nenhum)'));
  if (c.forasteiras.length > 0) {
    L.push('linhas do resultado que nao estao no inventario, ignoradas: ' + c.forasteiras.join(', '));
  }
  L.push('');
  L.push(ob.motivo(c));

  const codigo = c.veredito === 'INVALIDO' ? 2 : (c.veredito === 'BASTA' ? 0 : 1);
  sair(L.join('\n'), codigo);
}

// ── o roteiro ────────────────────────────────────────────────────────────

const onde = path.join(process.cwd(), RESULTADO[0], RESULTADO[1], RESULTADO[2]);
process.stdout.write(JSON.stringify({
  manualDoPlugin: { arquivos: doPlugin.arquivos, obrigacoes: doPlugin.obrigacoes.length,
    porFamilia: doPlugin.porFamilia },
  segundoManual: cruz.cruzou ?
    { fonte: caminhoOutro, arquivos: doOutro.arquivos, obrigacoes: doOutro.obrigacoes.length } : null,
  cruzamento: cruz.cruzou ?
    { comuns: cruz.comuns.length, soNoPlugin: cruz.soNoPlugin.length, soNoOutro: cruz.soNoOutro.length } : null,
  mecanismos: ob.MECANISMOS,
  comoExecutar: COMO_EXECUTAR,
  ondeGravar: onde,
  linhas: linhas.map((o) => ({
    id: o.id, familia: o.familia, titulo: o.titulo, fonte: o.arquivo + ':' + o.linha,
    naoMigrada: o.naoMigrada, aConferir: o.aConferir
  })),
  formatoDoResultado: {
    tarefa: { descricao: '<o que foi feito>', referencia: '<commit, arquivo ou chamado>' },
    executor: '<quem executou>',
    juiz: '<quem julgou, e nao pode ser o executor>',
    semManualAntigo: true,
    linhas: [{ id: '<um id da lista acima>', mecanismo: 'HOOK', evidencia: '<o que se confere depois>' }]
  }
}, null, 2) + '\n');

// D244 (P2 da D240 secao 4): o stdout e so o JSON, para `> roteiro.json` gerar JSON. A prosa
// vai ao stderr, que o terminal mostra igual; o mesmo texto tambem esta em `comoExecutar`.
process.stderr.write('\n');
process.stderr.write('Grave o resultado no caminho acima e rode de novo com --veredito.\n');
process.stderr.write('A coluna NADA e o resultado: cada linha dela e o que continua precisando\n');
process.stderr.write('do manual antigo. Vazia, ele pode ser aposentado, se o dono decidir.\n');
process.exit(0);
