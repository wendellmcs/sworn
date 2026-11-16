'use strict';
const fs = require('node:fs');
const path = require('node:path');
const glob = require('./glob.js');

/**
 * Caminho absoluto (ou relativo) do tool_input -> caminho relativo ao projeto, com barra normal.
 * Devolve null quando o arquivo esta fora do projeto ou quando nao ha caminho.
 */
function relativoAoProjeto(arquivo, cwd) {
  if (!arquivo || !cwd) return null;
  const abs = path.resolve(cwd, String(arquivo));
  const rel = path.relative(cwd, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return glob.normalizar(rel);
}

/**
 * F2-21 (D334): o arquivo esta dentro do projeto pelo caminho REAL? Resolve o link dos dois lados
 * (`realpath` do arquivo e do cwd) quando o arquivo existe: um link dentro do projeto que aponta para
 * fora da falso, e o projeto aberto por link com o arquivo pelo caminho real da verdadeiro. Arquivo que
 * ainda nao existe nao tem caminho real, e vale o caminho escrito. Vazio, nao-texto e o proprio projeto
 * dao falso.
 *
 * E uma funcao a parte de proposito: o portao de escopo depende do `relativoAoProjeto`, que fica lexico
 * (resolver link ali deixaria passar sem portao o arquivo que ja existe atras de um link). Esta serve so
 * a quem LE o arquivo e precisa saber se o conteudo e de dentro: a reinjecao do plano ativo.
 */
function dentroPeloCaminhoReal(arquivo, cwd) {
  if (typeof arquivo !== 'string' || arquivo === '' || !cwd) return false;
  const abs = path.resolve(cwd, arquivo);
  let rel;
  try {
    rel = path.relative(fs.realpathSync(cwd), fs.realpathSync(abs));
  } catch (e) {
    return relativoAoProjeto(arquivo, cwd) !== null;
  }
  return !(rel === '' || /^\.\.(?:[\\/]|$)/.test(rel) || path.isAbsolute(rel));
}

/**
 * Pendencia #10 (s372, 0.40.0): apaga a pasta `dir` inteira. No Windows (Node 24) o `fs.rmSync` recursivo volta SEM
 * erro e deixa a pasta quando o caminho tem acento ("sworn cicatriz ação-" ficava a cada rodada da suite). O
 * `rmSync` roda como antes, com `recursive` e `force` e o que vier em `opcoes` (maxRetries, retryDelay), e o erro
 * dele sobe igual (quem chama ja trata o EBUSY). Se ele voltou e a pasta ficou, o resto sai item por item: o link e a
 * juncao saem sem seguir o alvo, e o item que sumiu no meio (outro processo o apagou) conta como apagado, como no
 * `force`. O outro erro desse passo tambem sobe. Caminho vazio ou que nao e texto e recusado antes de tocar o disco:
 * o '' viraria a pasta atual. `fs.rmSync` e lido na hora da chamada: o teste o troca.
 */
function apagarPasta(dir, opcoes) {
  if (typeof dir !== 'string' || dir.trim() === '') throw new TypeError('apagarPasta: caminho vazio ou invalido');
  fs.rmSync(dir, Object.assign({}, opcoes, { recursive: true, force: true }));
  if (fs.existsSync(dir)) apagarItemPorItem(dir);
}

function apagarItemPorItem(alvo) {
  try {
    // lstat: o link e a juncao nao contam como pasta, e o unlink tira so o link (no Windows o do node tambem tira a
    // juncao e o arquivo somente-leitura, medido)
    if (fs.lstatSync(alvo).isDirectory()) {
      fs.readdirSync(alvo).forEach(function (nome) { apagarItemPorItem(path.join(alvo, nome)); });
      fs.rmdirSync(alvo);
    } else {
      fs.unlinkSync(alvo);
    }
  } catch (e) {
    if (!e || e.code !== 'ENOENT') throw e;
  }
}

module.exports = { relativoAoProjeto, dentroPeloCaminhoReal, apagarPasta };
