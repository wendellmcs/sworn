#!/usr/bin/env node
'use strict';
// Bloco M / M1 (D435): o medidor da sessao, chamado pelo mod (hooks/mods.ts) por $.process.run.
// Entrada no stdin: { uso, amostras, sessao, historico, gastoReal, resposta, padrao } - uso = $.session.usage() sem
// breakdown (D148); historico e gastoReal sao o que o mod guardou no $.store (pedido 31); resposta e a ultima do
// agente principal (sem uso desde o plano 091 #5, que tirou o botao do paralelo) e padrao diz se o mod viu a skill
// do manual carregada (pedido 32, botoes).
// Saida: JSON { curta, longa, cruzou, plano, guardar, botoes } e, se a entrada veio torta, `erro`. Saida 0 sempre:
// o medidor nunca derruba a sessao.
const fs = require('node:fs');
const estado = require('./lib/estado.js');
const config = require('./lib/config.js');
const saude = require('./lib/saude.js');
const medidor = require('./lib/medidor.js');
const gastoLib = require('./lib/gasto.js');
const path = require('node:path');

let entrada = {};
let erro = null;
try {
  const bruto = fs.readFileSync(0, 'utf8');
  entrada = JSON.parse(bruto);
  if (!entrada || typeof entrada !== 'object') { entrada = {}; erro = 'entrada nao e objeto JSON'; }
} catch (e) {
  entrada = {};
  erro = 'entrada nao e JSON: ' + e.message;
}

let resposta;
try {
  const s = entrada.sessao ? estado.ler(String(entrada.sessao)) : {};
  const raiz = config.raizDoProjeto(process.cwd());
  const projeto = config.carregarProjeto(raiz);
  const conta = Object.assign({}, s, { contadores: saude.acumular(s) });
  // D445: o contexto ao vivo do motor vale mais que o gravado no ultimo Stop. Plano 082 (p8-36): so contagem de
  // verdade (finita, nao negativa); o resto deixa valer o gravado.
  const ctx = entrada.uso && entrada.uso.context;
  if (ctx && typeof ctx.tokens === 'number' && isFinite(ctx.tokens) && ctx.tokens >= 0) conta.tokensDeContexto = ctx.tokens;
  // Pedido 31 (D520): o que o mod guarda no $.store (real do mes e historico das janelas) volta em `guardar`; o mes
  // soma o real e a estimativa das transcricoes (cache na pasta do estado, fora dos arquivos de sessao).
  const guardar = gastoLib.guardarSessao({ historico: entrada.historico, gastoReal: entrada.gastoReal,
    sessao: entrada.sessao ? String(entrada.sessao) : '', uso: entrada.uso, agora: Date.now() });
  const pastaDoCache = path.join(path.dirname(estado.caminhoSessao('x')), 'cache');
  const gastoMes = gastoLib.gastoDoMes({ real: guardar.gastoReal, arquivoDoCache: path.join(pastaDoCache, 'gasto-mes.json') });
  // Pedido 30: a linha do plano da sessao, para a faixa do mod ('' sem plano). Mesma pasta do plano.js --texto.
  // Plano 082 (p6-24): a barra nao leva mais o plano; ele fica so na faixa.
  const linhaDoPlano = require('./lib/plano.js').linhaDoPlanoDaSessao(process.cwd(), s.frente);
  resposta = medidor.linhaDaSessao({
    uso: entrada.uso,
    amostras: entrada.amostras,
    medidas: saude.medir(conta, projeto && projeto.limiares, require('./lib/continuo.js').ativo(projeto)),
    avisouSaude: s.avisouSaude === true,
    gasto: gastoMes,
    historico: guardar.historico,
    sessao: entrada.sessao ? String(entrada.sessao) : ''
  });
  resposta.guardar = guardar;
  resposta.plano = linhaDoPlano;
  // Pedido 32 (Tarefa 4 subitem 3): os botoes por comando, na ordem de prioridade; o mod desenha o primeiro.
  resposta.botoes = require('./lib/botoes.js').daSessao({
    cruzou: resposta.cruzou, s: s, projeto: projeto, raiz: raiz,
    temProjeto: fs.existsSync(config.caminhoEmSworn(raiz, 'projeto.json')),
    padraoCarregado: entrada.padrao === true,
    contarConversas: function () {
      return require('./lib/botoes.js').conversasDoProjeto(require('./lib/calibracao.js').pastaDasTranscricoes(raiz),
        path.join(pastaDoCache, 'calibrar.json'), Date.now());
    }
  });
} catch (e) {
  resposta = medidor.linhaDaSessao({});
  erro = (erro ? erro + '; ' : '') + 'falha ao medir: ' + e.message;
}
if (erro) resposta.erro = erro;
process.stdout.write(JSON.stringify(resposta) + '\n');
process.exit(0);
