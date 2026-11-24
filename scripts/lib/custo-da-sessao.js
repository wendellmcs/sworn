'use strict';
// H6g (15.6, D903): o custo e o uso de cada sessao, no disco. O SessionEnd (fim-sessao.js) solta o
// custo-das-sessoes.js --gravar, que soma o `usage` do transcript da sessao e dos subagentes dela e grava
// .sworn/custo/<sessao>.json, com a saida verde que o H6a cortou (`saidaCortada`, que o recibo-da-prova.js soma no
// estado da sessao). O custo-das-sessoes.js sem argumento lista. A conta e estimativa pela tabela de preco do
// calibracao.js (valor de API, nao cobranca); a mensagem de modelo fora da tabela conta em `semPreco`, nunca como zero.
// Limites declarados: a sessao retomada (--resume) regrava o mesmo arquivo com o transcript inteiro; o fim que o
// harness mata antes do processo solto terminar nao grava (a proxima sessao nao refaz a conta).
const fs = require('node:fs');
const path = require('node:path');
const { precoDaChamada } = require('./calibracao.js');
const gasto = require('./gasto.js');
const estado = require('./estado.js');
const retomar = require('./retomar.js');

const PASTA = path.join('.sworn', 'custo');
const TETO = 200;
const SESSAO = /^[A-Za-z0-9_-]{1,200}$/;
const ARQUIVO = /^[A-Za-z0-9_-]{1,200}\.json$/;

/** O numero que vale somar: finito e maior que zero; o resto, 0. */
function n(v) {
  return typeof v === 'number' && isFinite(v) && v > 0 ? v : 0;
}

function objeto(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

function zerado() {
  return { mensagens: 0, entrada: 0, saida: 0, cacheLido: 0, cacheEscrito: 0, usd: 0, semPreco: 0 };
}

/** Soma em `t` o `usage` de uma linha do transcript, se for mensagem de modelo ainda nao vista em `vistos` (o id se
 *  repete em varias linhas). */
function somarLinha(linha, t, vistos) {
  if (linha.indexOf('"usage"') === -1) return;
  let o;
  try { o = JSON.parse(linha); } catch (e) { return; }
  // a linha com "usage" nunca e o JSON null: o.type nao quebra
  const m = o.type === 'assistant' ? objeto(o.message) : null;
  if (!m || !objeto(m.usage) || typeof m.model !== 'string' || m.model === '<synthetic>') return;
  const temId = typeof m.id === 'string' && m.id !== '';
  if (temId && vistos.has(m.id)) return;
  if (temId) vistos.add(m.id);
  const u = m.usage;
  const escrita = n(u.cache_creation_input_tokens);
  t.mensagens++;
  t.entrada += n(u.input_tokens);
  t.saida += n(u.output_tokens);
  t.cacheLido += n(u.cache_read_input_tokens);
  t.cacheEscrito += escrita;
  const p = precoDaChamada(m.model, u);
  if (!p) { t.semPreco++; return; }
  const cc = objeto(u.cache_creation) || {};
  const w1 = n(cc.ephemeral_1h_input_tokens);
  const w5 = typeof cc.ephemeral_5m_input_tokens === 'number' ? n(cc.ephemeral_5m_input_tokens) : Math.max(0, escrita - w1);
  t.usd += (n(u.input_tokens) * p[0] + n(u.output_tokens) * p[1] + n(u.cache_read_input_tokens) * p[2] +
    w5 * p[3] + w1 * p[4]) / 1e6;
}

/** Soma em `t` o `usage` das mensagens de modelo de um transcript: uma vez por id. */
function somarTexto(texto, t) {
  const vistos = new Set();
  for (const linha of String(texto).split('\n')) somarLinha(linha, t, vistos);
  return t;
}

/** O mesmo do somarTexto, lendo o arquivo em pedacos de `pedaco` bytes: o transcript passa de 300 MB e uma string
 *  so tem teto (~512 MB no V8). O erro de leitura sobe. */
function somarArquivo(arquivo, t, pedaco) {
  const fd = fs.openSync(arquivo, 'r');
  try {
    const vistos = new Set();
    const buf = Buffer.alloc(pedaco > 0 ? pedaco : 1 << 20);
    let resto = Buffer.alloc(0);
    let lidos;
    while ((lidos = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      const junto = Buffer.concat([resto, buf.subarray(0, lidos)]);
      let ini = 0;
      let fim;
      while ((fim = junto.indexOf(10, ini)) !== -1) {
        somarLinha(junto.toString('utf8', ini, fim), t, vistos);
        ini = fim + 1;
      }
      resto = junto.subarray(ini);
    }
    if (resto.length) somarLinha(resto.toString('utf8'), t, vistos);
  } finally { fs.closeSync(fd); }
  return t;
}

/** O uso da sessao: o transcript principal e os dos subagentes dela (`<sessao>/subagents`, com os de workflow). O que
 *  nao se le conta em `ilegiveis`; o principal ausente, tambem. */
function daSessao(transcript, sessao) {
  const t = Object.assign(zerado(), { subagentes: 0, ilegiveis: 0 });
  const subs = gasto.arquivosDoProjeto(path.dirname(transcript)).filter(function (f) {
    return f.subagente && f.sessao === sessao;
  });
  for (const f of [{ arquivo: transcript }].concat(subs)) {
    // o arquivo que falha no meio da leitura nao soma pela metade
    const parcial = zerado();
    try { somarArquivo(f.arquivo, parcial); } catch (e) { t.ilegiveis++; continue; }
    for (const k of Object.keys(parcial)) t[k] += parcial[k];
    if (f.subagente) t.subagentes++;
  }
  t.usd = Math.round(t.usd * 1e6) / 1e6;
  return t;
}

/** O que o H6a cortou, como o estado da sessao guarda: { vezes, bytes }, ou zero. */
function cortado(s) {
  const c = objeto(s && s.saidaCortada) || {};
  return { vezes: n(c.vezes), bytes: n(c.bytes) };
}

/** A saida cortada somada: o recibo que cortou `poupado` bytes (o tamanho da saida menos o do texto que o modelo viu). */
function comCorte(atual, poupado) {
  const c = cortado({ saidaCortada: atual });
  return { vezes: c.vezes + 1, bytes: c.bytes + n(poupado) };
}

/** Os registros validos da pasta, do mais novo ao mais velho; o torto fica fora. Sem a pasta, nenhum; a pasta que
 *  existe e nao se le (permissao, por exemplo) sobe o erro, para nao passar por "nenhuma sessao gravada". */
function ler(raiz) {
  const pasta = path.join(raiz, PASTA);
  let nomes;
  try { nomes = fs.readdirSync(pasta); } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return [];
    throw e;
  }
  const out = [];
  for (const nome of nomes) {
    if (!ARQUIVO.test(nome)) continue;
    let r;
    try { r = JSON.parse(fs.readFileSync(path.join(pasta, nome), 'utf8')); } catch (e) { continue; }
    if (!objeto(r) || typeof r.sessao !== 'string' || typeof r.fim !== 'string' || !isFinite(Date.parse(r.fim))) continue;
    out.push(r);
  }
  return out.sort(function (a, b) { return Date.parse(b.fim) - Date.parse(a.fim); });
}

/** Os registros alem dos TETO mais novos (pela data do arquivo) saem; o que tem outro nome fica. O arquivo que some
 *  entre a lista e o stat (outra sessao podando junto) sai da conta, sem parar a poda. */
function podar(pasta) {
  try {
    const nomes = [];
    for (const x of fs.readdirSync(pasta)) {
      if (!ARQUIVO.test(x)) continue;
      try { nomes.push({ x: x, t: fs.statSync(path.join(pasta, x)).mtimeMs }); } catch (e) { /* sumiu: fora */ }
    }
    nomes.sort(function (a, b) { return a.t - b.t; });
    for (const v of nomes.slice(0, Math.max(0, nomes.length - TETO))) fs.rmSync(path.join(pasta, v.x), { force: true });
  } catch (e) { /* a poda falha sozinha: a proxima gravacao tenta de novo */ }
}

/** Soma e grava o registro da sessao; devolve o caminho. Sessao com nome torto: null, nada gravado. */
function gravar(raiz, sessao, transcript, agoraMs) {
  if (!SESSAO.test(String(sessao || '')) || typeof transcript !== 'string' || !transcript) return null;
  const uso = daSessao(transcript, sessao);
  // a hora que nao e numero (null seria 1970) ou que o Date nao aceita (NaN, Infinity, alem de 8.64e15) vira a de
  // agora, nunca um RangeError
  const quando = new Date(typeof agoraMs === 'number' ? agoraMs : NaN);
  const fim = isFinite(quando.getTime()) ? quando : new Date();
  const registro = Object.assign({ sessao: sessao, fim: fim.toISOString() }, uso,
    { saidaCortada: cortado(estado.ler(sessao)) });
  const pasta = path.join(raiz, PASTA);
  fs.mkdirSync(pasta, { recursive: true });
  retomar.protegerPasta(pasta);
  const destino = path.join(pasta, sessao + '.json');
  estado.gravarAtomico(destino, JSON.stringify(registro, null, 2) + '\n');
  podar(pasta);
  return destino;
}

module.exports = { somarTexto, somarArquivo, daSessao, comCorte, ler, gravar, zerado, PASTA, TETO };
