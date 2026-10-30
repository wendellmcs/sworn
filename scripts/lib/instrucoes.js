'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ambiente = require('./ambiente.js');
const texto = require('./texto.js');

// Metodo FIXO: numero sem metodo declarado nao e medida, e opiniao com casas decimais.
const RE_ITEM = /^\s*(?:[-*+]\s+|\d+\.\s+)\S/;
const METODO = 'conta linhas que comecam com marcador de lista ou numero, nas fontes canonicas, em regras.md e nas skills do projeto';
// D396 n. 16: o metodo diz de onde vieram as fontes; candidata nao se passa por canonica.
const METODO_POR_ORIGEM = {
  declaradas: METODO,
  candidatas: 'conta linhas que comecam com marcador de lista ou numero, nas fontes candidatas (achadas pela varredura, nao declaradas), em regras.md e nas skills do projeto',
  nenhuma: 'conta linhas que comecam com marcador de lista ou numero, em regras.md e nas skills do projeto (nenhuma fonte canonica declarada ou candidata)'
};

// A4-ins-1 (pedido 12), estados: so ENOENT conta 0 calado; o arquivo que nao se le (EACCES, EISDIR) devolve a causa
// em `erro`, e o contar a leva a `naoLidos` - antes contava 0 e o peso saia menor sem dizer.
function contarArquivo(arquivo) {
  try {
    return { n: fs.readFileSync(arquivo, 'utf8').split(/\r?\n/).filter(function (l) { return RE_ITEM.test(l); }).length };
  } catch (e) {
    return { n: 0, erro: e && e.code === 'ENOENT' ? null : texto.causaDoErro(e) };
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

function chaveDe(caminho) {
  try { return fs.realpathSync.native(caminho); } catch (e) { return caminho; }
}

function contar(cwd, projeto, candidatos) {
  const alvos = [];
  const fontes = escolherFontes(projeto, candidatos);
  for (const f of fontes.lista) alvos.push(f);
  alvos.push(path.join('.claude', 'sworn', 'regras.md'));
  for (const s of ambiente.detectar(cwd).skills) alvos.push(path.join('.claude', 'skills', s, 'SKILL.md'));
  // D732 (fila D687): a fonte canonica declarada em `fontesDeConsulta` (um registro de decisoes, por exemplo) segue
  // mandando, mas e consultada, nao carregada como instrucao: sai do total e vai para `foraDoPeso`, com a contagem.
  const declaradas = projeto && Array.isArray(projeto.fontesDeConsulta) ? projeto.fontesDeConsulta : [];
  const consulta = new Set(declaradas.filter(function (f) { return typeof f === 'string'; })
    .map(function (f) { return chaveDe(path.resolve(cwd, f)); }));
  const foraDoPeso = [];

  // D396 n. 11: o mesmo arquivo citado duas vezes (fonte declarada que tambem e regras.md ou SKILL.md,
  // `./CLAUDE.md` ao lado de `CLAUDE.md`) contava em dobro. Vale a primeira citacao. O caminho real
  // `native` traz a caixa do disco (`claude.md` e `CLAUDE.md` sao o mesmo arquivo onde o disco ignora
  // caixa); arquivo que nao existe fica no caminho escrito e conta 0 de qualquer jeito. A chave e a
  // leitura saem do mesmo `resolve`: com `join`, fonte em caminho absoluto lia `cwd/C:/...` e contava 0.
  const vistos = new Set();
  const porArquivo = [];
  const naoLidos = [];
  let total = 0;
  for (let i = 0; i < alvos.length; i++) {
    const rel = alvos[i];
    // A6 (pedido 12, R2 :71): o projeto.json editado a mao chega aqui sem o validar (auditoria, init); item de fonte
    // que nao e texto derrubava o path.resolve. Vai a naoLidos, como o arquivo que nao se le.
    if (typeof rel !== 'string') { naoLidos.push('fonte ' + JSON.stringify(rel) + ' (nao e texto)'); continue; }
    const caminho = path.resolve(cwd, rel);
    const chave = chaveDe(caminho);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const c = contarArquivo(caminho);
    if (c.erro) naoLidos.push(rel.replace(/\\/g, '/') + ' (' + c.erro + ')');
    if (i < fontes.lista.length && consulta.has(chave)) {
      foraDoPeso.push({ arquivo: rel.replace(/\\/g, '/'), n: c.n });
      continue;
    }
    if (c.n > 0) { porArquivo.push({ arquivo: rel.replace(/\\/g, '/'), n: c.n }); total += c.n; }
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
    metodo: METODO_POR_ORIGEM[fontes.origem] + (foraDoPeso.length ? '; fora as fontes de consulta declaradas em ' +
      'fontesDeConsulta, contadas a parte em foraDoPeso' : ''),
    naoLidos: naoLidos,
    foraDoPeso: foraDoPeso
  };
}

module.exports = { RE_ITEM, METODO, contar };
