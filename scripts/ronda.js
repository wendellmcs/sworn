#!/usr/bin/env node
'use strict';
// V5 (D847): o andamento da revisao cega, chamado pelo mod (hooks/mods.tsx) por $.process.run.
// Entrada no stdin: { inspetores: [{ vereditos, modelo, inicio, fim, usage }], agora } - um item por inspetor que o
// motor disparou nesta sessao (vereditos = o caminho dos vereditos que o briefing leva, so lido como texto: nada aqui
// abre arquivo; inicio e fim em ms; usage = o do turn.complete dele). Saida: JSON { linha } (a linha da faixa, '' sem
// ronda rodando); com --texto, o texto do /sworn-review. Entrada torta: linha vazia (ou o texto de nenhum inspetor).
// Saida 0 sempre: a faixa nunca derruba a sessao. Um erro na conta sai vazio (o mod mostra a linha vazia e, no
// /sworn-review, o aviso de parado).
const fs = require('node:fs');

const texto = process.argv.includes('--texto');
let saida = texto ? '' : JSON.stringify({ linha: '' });
try {
  const ronda = require('./lib/ronda-faixa.js');
  let entrada = {};
  try {
    const lido = JSON.parse(fs.readFileSync(0, 'utf8'));
    if (lido && typeof lido === 'object' && !Array.isArray(lido)) entrada = lido;
  } catch (e) {
    // stdin vazio ou fora de JSON: segue com a entrada vazia (a linha sai vazia).
  }
  const inspetores = Array.isArray(entrada.inspetores) ? entrada.inspetores : [];
  saida = texto ? ronda.detalhe(inspetores, entrada.agora) : JSON.stringify({ linha: ronda.linha(inspetores, entrada.agora) });
} catch (e) {
  // A conta quebrou: fica a saida vazia de cima.
}
process.stdout.write(saida + '\n');
