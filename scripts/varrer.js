#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const varredura = require('./lib/varredura.js');

const cwd = process.argv[2] || process.cwd();
const r = varredura.listar(cwd);
const inferido = varredura.inferir(r.arquivos, cwd, r);
// T11-3: o projeto.json e lido uma vez. Sem ele (init), os candidatos a fonte canonica que a
// varredura achou entram no peso de instrucao, marcados como candidatos (`instrucoes.fontes`).
const projeto = require('./lib/config.js').carregarProjeto(cwd);

// D98 rodada 2: a frase anterior era estatica e afirmava ter lido o package.json ate
// num repositorio que nao tem package.json nenhum. Trocar uma frase falsa por outra
// falsa nao e conserto.
// D98 rodada 3: e `existsSync` responde `true` para um DIRETORIO chamado package.json,
// caso em que o `lerJson` falha com EISDIR e nada e lido - a frase voltava a mentir.
// A frase promete LEITURA; entao quem responde por ela tem de ser a leitura.
function leuArquivo(base, rel) {
  try { fs.readFileSync(path.join(base, rel), 'utf8'); return true; }
  catch (e) { return false; }
}
const leuPackage = leuArquivo(cwd, 'package.json');

// S8/L3-var-1 (D426): a lista de leituras tambem vale so para o que foi lido de fato. Antes saia
// "(se existirem) settings.json, settings.local.json e .mcp.json" sem conferir, e o projeto.json
// (que `carregarProjeto` abre acima) nem constava.
function emLista(itens) {
  return itens.length > 1 ? itens.slice(0, -1).join(', ') + ' e ' + itens[itens.length - 1] : itens[0];
}
const doAmbiente = ['.claude/settings.json', '.claude/settings.local.json', '.mcp.json']
  .filter(function (rel) { return leuArquivo(cwd, rel); });
const leituras = [];
if (leuPackage) leituras.push('o package.json, para achar o script de teste');
if (projeto) leituras.push('o .claude/sworn/projeto.json, para saber o que o projeto declarou');
if (doAmbiente.length) leituras.push(emLista(doAmbiente) + ', para detectar o ambiente');
leituras.push('os arquivos de instrucao do projeto, so para contar linhas');

const saida = {
  teto: {
    arquivosLidos: r.arquivos.length,
    limite: r.limite,
    truncado: r.truncado,
    profundidadeMaxima: varredura.PROFUNDIDADE,
    profundidadeCortada: r.profundidadeCortada,
    pastasIgnoradas: r.ignoradas,
    diretoriosIlegiveis: r.ilegiveis,
    incompleta: r.incompleta,
    tokensEstimados: 0,
    // D98: a frase anterior dizia "nenhum conteudo de arquivo entrou" enquanto o
    // `lerJson` lia o package.json. Era falsa, e falsa e a familia de defeito que
    // este projeto existe para barrar.
    // D423 (DC-04): a frase seguinte ("o unico conteudo lido foi o package.json") tambem era
    // falsa: `ambiente.detectar` le .claude/settings*.json e .mcp.json, e `instrucoes.contar`
    // abre os arquivos de instrucao para contar linhas. A frase nomeia as leituras que houve.
    observacao: 'a varredura lista caminhos; de conteudo, le ' + emLista(leituras)
  },
  ambiente: require('./lib/ambiente.js').detectar(cwd),
  instrucoes: require('./lib/instrucoes.js').contar(cwd, projeto || {}, projeto ? undefined : inferido.candidatosCanonicos),
  inferido: inferido
};

// D98: estima o que ESTE comando imprime. Antes media `r.arquivos.join`, uma lista
// que a saida nunca contem - o numero era 14x maior que o texto real.
saida.teto.tokensEstimados = Math.ceil(JSON.stringify(saida, null, 2).length / 4);
process.stdout.write(JSON.stringify(saida, null, 2) + '\n');
