'use strict';
// H6e4 (15.0, docs/revisao-automatica.md §5.6): o aproveitamento de cada lente, medido nos fechos da revisao cega.
// O apurar-ronda.js grava no fechada.json, em `porLente`, o que cada lente achou e virou conserto (corrigidos), o que foi
// refutado na fonte (refutados), o descartado com motivo numa revisao anterior (descartados) e o que ficou aberto no
// teto (abertos). O /sworn:audit soma os fechos e mostra corrigidos / (corrigidos + descartados + refutados): lente com
// aproveitamento baixo e ruido medido; podar e decisao do dono.

const fs = require('fs');
const path = require('path');
const veredito = require('./veredito.js');
const textoLib = require('./texto.js');

const CAMPOS = ['corrigidos', 'refutados', 'descartados', 'abertos'];

function chave(lente) {
  return veredito.chaveDaLente(lente) || (typeof lente === 'string' && lente.trim() ? lente.trim() : 'sem-lente');
}

// A chave da lente pode vir crua do inspetor ou do fecho ('constructor', '__proto__'): so a propriedade propria conta,
// e ela nasce por defineProperty, para nunca ler nem gravar no Object.prototype.
function proprio(obj, k, inicial) {
  if (!Object.prototype.hasOwnProperty.call(obj, k)) {
    Object.defineProperty(obj, k, { value: inicial(), enumerable: true, writable: true, configurable: true });
  }
  return obj[k];
}

function somarUm(obj, lente) {
  const k = chave(lente);
  proprio(obj, k, function () { return 0; });
  obj[k] += 1;
}

function contar(porLente, lente, campo, n) {
  const c = proprio(porLente, chave(lente), function () {
    const z = {};
    CAMPOS.forEach(function (f) { z[f] = 0; });
    return z;
  });
  c[campo] += n === undefined ? 1 : n;
}

function contagem(obj, k) { return Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : 0; }

// so os itens que sao objeto: um null ou numero na lista nao derruba o fecho
function lista(x) { return Array.isArray(x) ? x.filter(function (e) { return !!e && typeof e === 'object'; }) : []; }

/**
 * A contagem por lente de uma apuracao que fechou. `r` e a saida do veredito.apurar (com `r.conferencia` na ronda de
 * conferencia depois do teto). O que segurou ronda e corrigido quando a revisao aprova; no teto sem aprovar, o achado
 * novo da ultima ronda e o que voltou igual nela (achadosAindaAbertos) seguem abertos e o resto foi corrigido; na
 * conferencia, os que seguem (`conferencia.seguem`) ficam abertos. A lacuna refutada nao conta: e da referencia.
 */
function daApuracao(r, aprovou) {
  const porLente = {};
  const seguraram = lista(r && r.seguraram);
  const abertos = {};
  if (r && r.conferencia) {
    for (const a of lista(r.conferencia.seguem)) somarUm(abertos, a.lente);
  } else if (!aprovou) {
    // as duas listas nao se cruzam: o achadosAindaAbertos e o repetido, que esta em `seguraram` com a ronda em que
    // nasceu (veredito.apurar, A3-06); o novo da ultima ronda esta em `seguraram` com ela
    const ronda = r && r.ronda;
    for (const a of seguraram) if (a.ronda === ronda) somarUm(abertos, a.lente);
    for (const a of lista(r && r.achadosAindaAbertos)) somarUm(abertos, a.lente);
  }
  const doLente = {};
  for (const a of seguraram) somarUm(doLente, a.lente);
  // o aberto e um dos que seguraram; se as listas divergirem, o aberto conta e o corrigido nunca fica negativo
  new Set(Object.keys(doLente).concat(Object.keys(abertos))).forEach(function (k) {
    contar(porLente, k, 'corrigidos', Math.max(0, contagem(doLente, k) - contagem(abertos, k)));
    contar(porLente, k, 'abertos', contagem(abertos, k));
  });
  for (const f of lista(r && r.refutados)) if (f.lacuna !== true) contar(porLente, f.lente, 'refutados');
  for (const g of lista(r && r.registros)) if (g.registro === 'descartado antes') contar(porLente, g.lente, 'descartados');
  return porLente;
}

function lerFecho(arquivo) {
  try { return JSON.parse(textoLib.semBom(fs.readFileSync(arquivo, 'utf8'))); } catch (e) { return undefined; }
}

// A pasta que nao existe e vazia; a que existe e nao se le (permissao, disco) devolve null: quem chama a conta em
// `ilegiveis`, nunca como zero revisoes.
function pastas(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(function (d) { return d.isDirectory(); })
      .map(function (d) { return path.join(dir, d.name); });
  } catch (e) { return e && e.code === 'ENOENT' ? [] : null; }
}

function ehContagem(c) {
  return !!c && typeof c === 'object' && !Array.isArray(c) &&
    CAMPOS.every(function (k) { return Number.isInteger(c[k]) && c[k] >= 0; });
}

/**
 * Soma o `porLente` dos fechos de `<raiz>/.claude/sworn/revisao/<id>/fechada.json` (a revisao em curso ou fechada) e
 * de `<raiz>/.claude/sworn/revisao-fechada/<id>/<carimbo>/fechada.json` (as arquivadas). O fecho anterior ao H6e4 nao
 * tem `porLente` e entra em `semMedida`; o ilegivel ou fora da forma entra em `ilegiveis`, nunca como zero.
 */
function somar(raiz) {
  const base = path.join(raiz, '.claude', 'sworn');
  let ilegiveis = 0;
  function lidas(dir) {
    const l = pastas(dir);
    if (l === null) { ilegiveis += 1; return []; }
    return l;
  }
  const arquivos = lidas(path.join(base, 'revisao')).map(function (p) { return path.join(p, 'fechada.json'); });
  lidas(path.join(base, 'revisao-fechada')).forEach(function (p) {
    lidas(p).forEach(function (q) { arquivos.push(path.join(q, 'fechada.json')); });
  });
  const total = {};
  let revisoes = 0;
  let semMedida = 0;
  for (const arq of arquivos) {
    if (!fs.existsSync(arq)) continue;
    const f = lerFecho(arq);
    if (!f || typeof f !== 'object' || Array.isArray(f)) { ilegiveis += 1; continue; }
    if (f.porLente === undefined) { semMedida += 1; continue; }
    const pl = f.porLente;
    if (!pl || typeof pl !== 'object' || Array.isArray(pl) || !Object.keys(pl).every(function (k) { return ehContagem(pl[k]); })) {
      ilegiveis += 1;
      continue;
    }
    revisoes += 1;
    Object.keys(pl).forEach(function (k) {
      CAMPOS.forEach(function (c) { contar(total, k, c, pl[k][c]); });
    });
  }
  const porLente = {};
  Object.keys(total).forEach(function (k) {
    const t = total[k];
    const den = t.corrigidos + t.descartados + t.refutados;
    proprio(porLente, k, function () {
      return Object.assign({}, t, { aproveitamento: den ? Math.round(t.corrigidos / den * 100) / 100 : null });
    });
  });
  return { revisoes: revisoes, semMedida: semMedida, ilegiveis: ilegiveis, porLente: porLente };
}

module.exports = { daApuracao, somar };
