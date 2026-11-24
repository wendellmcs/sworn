'use strict';
// H6a (15.1, D891): a saida enxuta. A saida verde de um executor de teste conhecido (a tabela em
// modelos/resumidores.json) pode chegar ao modelo so com as linhas do resumo; o resto vai para o log
// (scripts/recibo-da-prova.js). Corta so o que nao esconde erro: o resumo verde do executor na saida, nenhuma linha
// vermelha dele nem a marca de falha que o portao de fecho le (evidencia.textoMostraFalha), o codigo de saida que e o
// do executor (sem pipe) e a saida grande. Executor fora da tabela nao corta nada.
const fs = require('node:fs');
const path = require('node:path');

const TABELA = path.join(__dirname, '..', '..', 'modelos', 'resumidores.json');
// Saida ate este tamanho segue inteira: o corte quase nao poupa, e o modelo ve o nome de cada teste.
const MINIMO_PARA_CORTAR = 2000;
// O resumo maior que isto nao e o de sempre (um go test com centenas de pacotes): a saida segue inteira.
const TETO_DO_RESUMO = 40;
const COR_DO_TERMINAL = /\x1b\[[0-9;]*m/g;

/** Le a tabela de `arquivo`. A tabela que nao le (ausente, JSON quebrado, regex invalida) vira lista vazia: sem
 *  executor, nada se corta, e o comando de teste segue com a saida inteira. */
function lerTabela(arquivo) {
  try {
    const re = function (lista) { return (lista || []).map(function (r) { return new RegExp(r); }); };
    return JSON.parse(fs.readFileSync(arquivo, 'utf8')).executores.map(function (x) {
      return { nome: x.nome, comandos: x.comandos || [], padroes: re(x.padroes), resumo: re(x.resumo),
        verde: re(x.verde), vermelho: re(x.vermelho) };
    });
  } catch (e) { return []; }
}
let executores = null;
function tabela() {
  if (executores === null) executores = lerTabela(TABELA);
  return executores;
}

/** Os executores que a saida deste comando pode trazer: o que o comando nomeia; sem nome, o npm test (e afins) e a
 *  provaDePronto (`provas`, a lista de saude.provasEquivalentes) tentam todos. Comando que nao e teste: null. */
function candidatos(comando, provas) {
  const rodouTeste = require('./medicao-travas.js').rodouTeste;
  const todos = tabela();
  const proprios = todos.filter(function (x) {
    return rodouTeste([comando], x.comandos) || x.padroes.some(function (re) { return re.test(comando); });
  });
  if (proprios.length) return proprios;
  const saude = require('./saude.js');
  const casa = saude.casaComAProva(provas);
  return rodouTeste([comando], saude.RODAR_SCRIPT_TEST) || (casa !== null && casa(comando)) ? todos : null;
}

/** O comando e de teste (um executor da tabela, o npm test e afins, ou a provaDePronto). */
function ehComandoDeTeste(comando, provas) {
  return candidatos(String(comando || ''), provas) !== null;
}

/** O codigo de saida e o do executor: sem pipe, ponto e virgula, ||, & solto, redirecao, crase, $( ) nem quebra de
 *  linha. O && (para no primeiro que falha) e o 2>&1 ficam. Aspas nao contam: o | dentro delas tambem nao corta. */
function comandoSimples(comando) {
  const c = String(comando).replace(/\s2>&1(?=\s|$)/g, ' ').replace(/&&/g, ' ');
  return !/[|;&<>`\r\n]|\$\(/.test(c);
}

/**
 * A saida de `comando` (que saiu com 0) lida pela tabela. Devolve { teste: false } quando o comando nao e de teste, e
 * senao { teste: true, verde, executores, resumo? }: `verde` = nenhuma marca de falha; `executores`, os da tabela cujo
 * resumo verde esta na saida; `resumo`, as linhas que ficam, so quando a saida pode ser cortada.
 */
function resumir(comando, saida, provas) {
  const cmd = String(comando || '');
  const cands = candidatos(cmd, provas);
  if (!cands) return { teste: false };
  const texto = String(saida == null ? '' : saida);
  const linhas = texto.replace(COR_DO_TERMINAL, '').split(/\r?\n/);
  const algumaCasa = function (regs) {
    return linhas.some(function (l) { return regs.some(function (r) { return r.test(l); }); });
  };
  const vermelho = require('./evidencia.js').textoMostraFalha(texto) ||
    cands.some(function (x) { return algumaCasa(x.vermelho); });
  const verdes = vermelho ? [] : cands.filter(function (x) { return algumaCasa(x.verde); });
  const r = { teste: true, verde: !vermelho, executores: verdes.map(function (x) { return x.nome; }) };
  if (!verdes.length || texto.length <= MINIMO_PARA_CORTAR || !comandoSimples(cmd)) return r;
  const resumo = linhas.filter(function (l) {
    return verdes.some(function (x) { return x.resumo.some(function (re) { return re.test(l); }); });
  }).map(function (l) { return l.trimEnd(); });
  if (resumo.length && resumo.length <= TETO_DO_RESUMO) r.resumo = resumo;
  return r;
}

/** O texto que o modelo ve no lugar da saida: o resumo, e numa nota em ASCII o tamanho e o caminho do log inteiro. */
function textoAoModelo(resumo, tamanho, caminho) {
  return resumo.join('\n') + '\n\n' + 'sworn: saida verde cortada, ficou so o resumo acima. A saida inteira (' +
    tamanho.linhas + ' linhas, ' + tamanho.bytes + ' bytes) esta em "' + caminho + '" (procure nela com Grep).';
}

module.exports = { resumir, ehComandoDeTeste, comandoSimples, textoAoModelo, lerTabela, MINIMO_PARA_CORTAR, TETO_DO_RESUMO };
