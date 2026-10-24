#!/usr/bin/env node
'use strict';
const io = require('./lib/io.js');
const config = require('./lib/config.js');

// D387/D388 (#3): a regra "decisao do dono = exatamente 3 opcoes, a recomendada em primeiro"
// (modelos/regras.md:9) deixa de ser so texto: AskUserQuestion fora do padrao e barrada antes de
// chegar ao dono. Segue o padrao, mas desliga com "portaoDecisao": false no projeto.json.
// Falha do proprio portao libera (R6, io.blindar).

// D389: a marca e exata e entre parenteses: (Recomendado), (Recomendada), (Recommended) ou (Recom.), em
// qualquer caixa. Palavra solta ("Recomendado: x", "Nao recomendado", "Ver recomendacoes") nao e a marca:
// heuristica de linguagem natural virou corrida de bordas na revisao da 0.5.0.
const MARCA_RECOMENDADA = /\((?:recomendad[oa]|recommended|recom\.)\)/i;

// D489 (PD1): pergunta de fato (sintoma, dado que so o dono tem) nao e decisao. A marca (fato), no mesmo
// molde da D389 - exata, entre parenteses, qualquer caixa -, so no titulo curto (header), libera a pergunta
// da regra das 3 opcoes. No texto da pergunta ou num rotulo nao conta.
const MARCA_FATO = /\(fato\)/i;

/**
 * O que ha de errado na pergunta (1-based em `n`) e o que fazer, ou null quando ela segue o padrao.
 * D396 n. 30: cada causa leva o proprio remedio, depois de " - " (antes uma instrucao so servia as tres).
 */
function defeitoDaPergunta(q, n) {
  if (q && typeof q === 'object' && typeof q.header === 'string' && MARCA_FATO.test(q.header)) return null;
  const opcoes = q && typeof q === 'object' ? q.options : null;
  if (!Array.isArray(opcoes)) return 'pergunta ' + n + ' sem a lista de opcoes - mande exatamente 3';
  if (opcoes.length !== 3) {
    return 'pergunta ' + n + ' tem ' + opcoes.length + (opcoes.length === 1 ? ' opcao' : ' opcoes') + ' - deixe exatamente 3';
  }
  // D396 n. 35: toda opcao e um objeto com o rotulo (label) em texto; nula, texto solto ou sem label nao e opcao.
  for (let i = 0; i < opcoes.length; i++) {
    const o = opcoes[i];
    if (!o || typeof o !== 'object' || typeof o.label !== 'string' || o.label.trim() === '') {
      return 'a opcao ' + (i + 1) + ' da pergunta ' + n + ' nao tem rotulo em texto - cada opcao e { label, description }';
    }
  }
  const rotulos = opcoes.map(function (o) { return o.label; });
  const marcada = function (r) { return MARCA_RECOMENDADA.test(r); };
  if (!marcada(rotulos[0])) return 'a 1a opcao da pergunta ' + n + ' nao e a recomendada - ponha (Recomendado) no rotulo dela';
  // D391: a recomendada e uma so. A marca tambem numa outra opcao desfaz a escolha.
  const outras = [];
  for (let i = 1; i < rotulos.length; i++) if (marcada(rotulos[i])) outras.push(i + 1);
  if (outras.length) {
    // D396 n. 39: "a opcao 2"; "as opcoes 2 e 3"
    const quais = outras.length === 1 ? 'a opcao ' + outras[0]
      : 'as opcoes ' + outras.slice(0, -1).join(', ') + ' e ' + outras[outras.length - 1];
    return 'a pergunta ' + n + ' marca como recomendada tambem ' + quais + ' - a marca vai so na 1a opcao';
  }
  return null;
}

io.blindar(function () {
  io.lerEntrada(function (e) {
    const raiz = config.raizDoProjeto(e.cwd || process.cwd());
    const projeto = config.carregarProjeto(raiz);
    // Desliga so com o booleano false: texto "false", ausente ou projeto.json ausente = ligado.
    if (projeto && projeto.portaoDecisao === false) return io.permitir();

    const perguntas = e.tool_input && e.tool_input.questions;
    if (!Array.isArray(perguntas)) return io.permitir();

    // D391: lista vazia nao e pergunta no padrao (antes nenhum defeito = liberava).
    const defeitos = perguntas.length === 0 ? ['nenhuma pergunta na lista'] : [];
    perguntas.forEach(function (q, i) {
      const d = defeitoDaPergunta(q, i + 1);
      if (d) defeitos.push(d);
    });
    if (defeitos.length === 0) return io.permitir();

    return io.negarFerramenta([
      'Pergunta ao dono fora do padrao: ' + defeitos.join('; ') + '.',
      // D396 n. 40: a marca vai numa opcao so
      'Refaca a pergunta: exatamente 3 opcoes, a recomendada em primeiro com (Recomendado) no rotulo, so nela, ' +
        'cada uma com consequencia pratica e custo.',
      // D489: pergunta de fato nao e decisao
      'Se for pergunta de fato (sintoma, dado que so o dono tem), ponha (fato) no titulo curto (header) dela.',
      'Para desligar este portao no projeto: "portaoDecisao": false em .claude/sworn/projeto.json.'
    ].join('\n'));
  });
});
