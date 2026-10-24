'use strict';

// Pedido 32 (plano dos pedidos 30-32, Tarefa 4): a identidade visual do sworn, que ate aqui so existia desenhada
// nos banners de assets/. Um acento so - o ambar - sobre os neutros do tema; o resto (texto, botao, barra) fica com o
// desenho do motor. Na faixa do mod: a chave de tema `warning`, que segue o tema claro/escuro (D519), e no VS Code a
// cor crua do banner escuro, porque la a chave nao pinta (D522, sonda da s53). O hooks/mods.tsx nao le Node e repete
// as duas cores; test/identidade.test.js confere a copia e confere o acento contra os banners.

const ACENTO = { escuro: '#F59E0B', claro: '#B45309' };
const TEMA = 'warning';

/** Plano 082 (p8-15): a tela do VS Code em qualquer caixa e com espaco ("VS Code") pinta cru; o resto, a chave. */
function corDoAcento(tela) {
  return String(tela === undefined || tela === null ? '' : tela).replace(/\s+/g, '').toLowerCase() === 'vscode'
    ? ACENTO.escuro : TEMA;
}

module.exports = { ACENTO, TEMA, corDoAcento };
