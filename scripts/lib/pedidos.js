'use strict';
const fs = require('node:fs');
const path = require('node:path');
const retomar = require('./retomar.js');

// Colheita 10-20, item 10 (D674): cada pedido do dono vira uma linha numerada na lista da frente, gravada pelo gancho de
// entrada (abrir-turno.js), sem o Claude. O /sworn:handoff le a lista, e nada do que o dono pediu depende de o agente
// lembrar. Texto limpo e mascarado como o resumo da volta (retomar.js); nada sai da maquina.

const CHAVE = 'pedidos';
const PASTA = '.claude/sworn/pedidos';
const SEM_FRENTE = 'sem-frente';
const CORTE = 600;
const NUMERADA = /^\d+\. /;

/** Ligado por padrao. So o booleano `false` desliga (D388, D415). */
function ligada(projeto) {
  return !(projeto && typeof projeto === 'object' && projeto[CHAVE] === false);
}

function doisDigitos(n) { return (n < 10 ? '0' : '') + n; }

function carimbo(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + doisDigitos(d.getMonth() + 1) + '-' + doisDigitos(d.getDate()) + ' ' +
    doisDigitos(d.getHours()) + ':' + doisDigitos(d.getMinutes());
}

/** Nome do arquivo da lista: a frente, se o nome serve de arquivo (a classe das frentes); senao sem-frente. */
function nomeDaLista(frente) {
  return typeof frente === 'string' && /^[A-Za-z0-9_-]+$/.test(frente) ? frente : SEM_FRENTE;
}

function caminho(raiz, frente) { return PASTA + '/' + nomeDaLista(frente) + '.md'; }

/** O texto da lista da frente, ou null quando nao existe ou nao se le. */
function ler(raiz, frente) {
  try { return fs.readFileSync(path.join(raiz, caminho(raiz, frente)), 'utf8'); } catch (e) { return null; }
}

/**
 * Acrescenta o pedido na lista da frente e devolve o caminho relativo, ou null quando nao grava: projeto sem
 * .claude/sworn/ (nao e poluido) ou texto vazio depois de limpo. Erro de disco lanca: quem chama decide (o gancho cala).
 */
function registrar(raiz, frente, prompt, agora) {
  if (typeof prompt !== 'string' || !fs.existsSync(path.join(raiz, '.claude', 'sworn'))) return null;
  const texto = retomar.limpar(prompt);
  if (!texto) return null;
  const rel = caminho(raiz, frente);
  // So o arquivo que nao existe e lista nova: outra falha de leitura lanca, e a numeracao e o cabecalho nao recomecam.
  let atual = null;
  try { atual = fs.readFileSync(path.join(raiz, rel), 'utf8'); } catch (e) { if (!e || e.code !== 'ENOENT') throw e; }
  const n = atual === null ? 1 : atual.split('\n').filter(function (l) { return NUMERADA.test(l); }).length + 1;
  const linha = n + '. ' + carimbo(agora) + ' - ' + retomar.cortar(retomar.mascarar(texto), CORTE) + '\n';
  fs.mkdirSync(path.join(raiz, PASTA), { recursive: true });
  fs.appendFileSync(path.join(raiz, rel), (atual === null ? '# Pedidos do dono - ' + nomeDaLista(frente) + '\n\n' : '') + linha);
  return rel;
}

module.exports = { CHAVE, PASTA, ligada, registrar, ler };
