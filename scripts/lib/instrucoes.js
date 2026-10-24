'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ambiente = require('./ambiente.js');

// Metodo FIXO: numero sem metodo declarado nao e medida, e opiniao com casas decimais.
const RE_ITEM = /^\s*(?:[-*+]\s+|\d+\.\s+)\S/;
const METODO = 'conta linhas que comecam com marcador de lista ou numero, nas fontes canonicas, em regras.md e nas skills do projeto';
// D396 n. 16: o metodo diz de onde vieram as fontes; candidata nao se passa por canonica.
const METODO_POR_ORIGEM = {
  declaradas: METODO,
  candidatas: 'conta linhas que comecam com marcador de lista ou numero, nas fontes candidatas (achadas pela varredura, nao declaradas), em regras.md e nas skills do projeto',
  nenhuma: 'conta linhas que comecam com marcador de lista ou numero, em regras.md e nas skills do projeto (nenhuma fonte canonica declarada ou candidata)'
};

function contarArquivo(arquivo) {
  try {
    return fs.readFileSync(arquivo, 'utf8').split(/\r?\n/).filter(function (l) { return RE_ITEM.test(l); }).length;
  } catch (e) {
    return 0;
  }
}

// Ronda 1 do 8c.5: o `||` engolia o zero, o defeito que a D98 corrigiu na varredura.js.
// Teto e inteiro nao negativo, zero inclusive; so o ausente ou invalido cai no padrao.
function limite(v, padrao) {
  return Number.isInteger(v) && v >= 0 ? v : padrao;
}

// T11-3: no init o projeto.json ainda nao existe, e as fontes canonicas (as que mais pesam)
// ficavam de fora. Regra: fontesCanonicas declaradas (array, mesmo vazio: o dono declarou) mandam;
// sem isso, valem os candidatos que a varredura achou, se vierem como array; senao, nenhuma.
// `fontes` diz de onde veio, para o numero nao se passar por confirmado.
function escolherFontes(projeto, candidatos) {
  if (projeto && Array.isArray(projeto.fontesCanonicas)) return { lista: projeto.fontesCanonicas, origem: 'declaradas' };
  if (Array.isArray(candidatos)) return { lista: candidatos, origem: 'candidatas' };
  return { lista: [], origem: 'nenhuma' };
}

function contar(cwd, projeto, candidatos) {
  const alvos = [];
  const fontes = escolherFontes(projeto, candidatos);
  for (const f of fontes.lista) alvos.push(f);
  alvos.push(path.join('.claude', 'sworn', 'regras.md'));
  for (const s of ambiente.detectar(cwd).skills) alvos.push(path.join('.claude', 'skills', s, 'SKILL.md'));

  // D396 n. 11: o mesmo arquivo citado duas vezes (fonte declarada que tambem e regras.md ou SKILL.md,
  // `./CLAUDE.md` ao lado de `CLAUDE.md`) contava em dobro. Vale a primeira citacao. O caminho real
  // `native` traz a caixa do disco (`claude.md` e `CLAUDE.md` sao o mesmo arquivo onde o disco ignora
  // caixa); arquivo que nao existe fica no caminho escrito e conta 0 de qualquer jeito. A chave e a
  // leitura saem do mesmo `resolve`: com `join`, fonte em caminho absoluto lia `cwd/C:/...` e contava 0.
  const vistos = new Set();
  const porArquivo = [];
  let total = 0;
  for (const rel of alvos) {
    const caminho = path.resolve(cwd, rel);
    let chave;
    try { chave = fs.realpathSync.native(caminho); } catch (e) { chave = caminho; }
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const n = contarArquivo(caminho);
    if (n > 0) { porArquivo.push({ arquivo: rel.replace(/\\/g, '/'), n: n }); total += n; }
  }
  porArquivo.sort(function (a, b) { return b.n - a.n; });

  const teto = limite(ambiente.LIMITES.tetoDeInstrucoes, 200);
  return {
    total: total,
    porArquivo: porArquivo,
    teto: teto,
    avisarA: limite(ambiente.LIMITES.avisarA, 150),
    estourou: total > teto,
    fontes: fontes.origem,
    metodo: METODO_POR_ORIGEM[fontes.origem]
  };
}

module.exports = { RE_ITEM, METODO, contar };
