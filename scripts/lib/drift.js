'use strict';
// C2 (R-EGM, /sworn:drift): o codigo se afastou do plano. O original (skills/egm-drift-report) relia o desenho e o
// codigo inteiros pelo modelo, sem diff; aqui o script cruza os arquivos mudados desde a base com os caminhos e as
// caixas do plano: o arquivo mudado que o plano nao cita, a caixa feita cujo arquivo nao mudou, e o arquivo que a caixa
// feita dizia criar e nao existe.
const { EXTENSAO, virarCerca } = require('./plano-conferir.js');

const CRASE = /`([^`\n]+)`/g;
const CAIXA = /^(\s*)- \[([ xX])\]\s/;
const ITEM = /^\s*[-*]\s/;
const CRIAR = /\b(?:cri(?:ar|a|ado|ada|ados|adas)|nov[oa]s?|new|create[sd]?)\b/i;
// o que o sworn e o harness gravam enquanto a tarefa anda nao e desvio do plano
const DO_SWORN = /^(?:\.claude|\.sworn|\.context)\//;

/** Caminho: com a extensao de arquivo, ou com barra e a pasta de cima existindo (o id `openai/gpt-6-luna` nao e). */
function ehCaminho(t, existe) {
  if (!/^[\p{L}\p{N}_./-]+$/u.test(t) || /^(?:-|\/|\.\.?$)/.test(t)) return false;
  return EXTENSAO.test(t) || (t.indexOf('/') !== -1 && existe(t.split('/')[0]));
}

/** O que o plano cita: [{ t, linha, criar, caixa: 'feita' | 'aberta' | null }], fora dos blocos de codigo. */
function citados(texto, existe) {
  const linhas = String(texto).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  // o bloco de codigo pela mesma regra da conferencia do plano
  let cerca = null;
  let caixa = null;
  linhas.forEach(function (l, i) {
    const nova = virarCerca(cerca, l);
    if (nova !== undefined) { cerca = nova; return; }
    if (cerca !== null) return;
    const m = CAIXA.exec(l);
    if (m) caixa = { recuo: m[1].length, estado: m[2] === ' ' ? 'aberta' : 'feita', linha: i + 1 };
    // a continuacao (mais recuada) segue na caixa; outro item ou a volta da margem a fecha
    else if (caixa && (!l.trim() || ITEM.test(l) || l.search(/\S/) <= caixa.recuo)) caixa = null;
    const criar = CRIAR.test(l);
    let k;
    CRASE.lastIndex = 0;
    while ((k = CRASE.exec(l)) !== null) {
      // o "./" do comeco nao muda o arquivo: `./src/a.js` e o `src/a.js` do diff
      const t = k[1].replace(/^(?:\.\/)+/, '');
      if (!ehCaminho(t, existe)) continue;
      out.push({ t: t, linha: caixa ? caixa.linha : i + 1, criar: criar, caixa: caixa ? caixa.estado : null });
    }
  });
  return out;
}

function casa(mudado, citado) {
  return mudado === citado || mudado.endsWith('/' + citado);
}

/**
 * O drift: { mudados, noPlano, achados: [{ tipo, valor, linha, motivo }] }; tipos: fora-do-plano (linha null),
 * feita-sem-mudanca, criar-ausente. entrada: { texto, mudados (caminhos do repositorio), existe(caminho), plano }.
 */
function drift(entrada) {
  // sem a funcao existe, nada existe: a pasta de cima nao confirma caminho e o "criar" sai ausente
  const existe = typeof entrada.existe === 'function' ? entrada.existe : function () { return false; };
  const cit = citados(entrada.texto, existe);
  const mudados = (entrada.mudados || []).filter(function (m) {
    return m !== entrada.plano && !DO_SWORN.test(m);
  });
  const achados = [];
  let noPlano = 0;
  mudados.forEach(function (m) {
    if (cit.some(function (c) { return casa(m, c.t); })) noPlano++;
    else achados.push({ tipo: 'fora-do-plano', valor: m, linha: null, motivo: 'mudou e o plano nao o cita: cite o arquivo na caixa que o mudou, ou desfaca a mudanca' });
  });
  cit.filter(function (c) { return c.caixa === 'feita'; }).forEach(function (c) {
    if (mudados.some(function (m) { return casa(m, c.t); })) return;
    const ausente = c.criar && !existe(c.t);
    achados.push({ tipo: ausente ? 'criar-ausente' : 'feita-sem-mudanca', valor: c.t, linha: c.linha,
      motivo: ausente ? 'a caixa feita dizia criar o arquivo e ele nao existe: crie o arquivo, ou reabra a caixa'
        : 'a caixa esta feita e o arquivo nao mudou desde a base: reabra a caixa, ou corrija o caminho no plano' });
  });
  return { mudados: mudados.length, noPlano: noPlano, achados: achados };
}

module.exports = { drift, citados };
