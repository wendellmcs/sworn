'use strict';
// F2c (D828): o contrato do que o trecho usa entra no pacote da revisao cega. Nas faixas com recorte, 66% dos
// pendentes eram "fora do trecho" (diagnostico de 2026-11-10): o inspetor nao via o require do topo, o ajudante
// definido mais acima ou o que a funcao de outro modulo devolve. Dois pedacos:
//   - do proprio arquivo: as linhas do require e da definicao de nivel de topo de cada nome que o trecho usa ficam a
//     mostra nos dois lados (extras do recorte, no numero de linha de cada lado);
//   - de outro modulo do projeto (require relativo): o comentario e a assinatura, ou a definicao inteira quando e curta,
//     vao para o contrato.txt, que e nomeado (nao e A nem B) e nao esta em revisao.
// Os nomes sao a uniao dos dois lados, para que a escolha do que fica a mostra nao revele qual lado e o novo.
// So arquivo de codigo JavaScript; o resto segue o recorte de antes. O texto que este script escreve ao modelo e ASCII;
// o codigo copiado de outro arquivo vai como esta no disco (com acento, se tiver), como o A.txt e o B.txt.
const fs = require('node:fs');
const path = require('node:path');
const cegar = require('./cegar.js');

const EXTENSOES = /\.(c|m)?js$/i;
// Definicao de ate 15 linhas vai inteira; maior, so o comentario de cima e a assinatura.
const TETO_DEF = 15;
// O comentario de cima de uma definicao: no maximo as 12 linhas logo acima dela.
const TETO_COMENTARIO = 12;
// Linhas a mais por lado no recorte, e entradas e bytes no contrato.txt: o pacote nao pode virar o arquivo inteiro.
const TETO_EXTRAS = 120;
const TETO_ENTRADAS = 30;
const TETO_BYTES = 60000;

const RESERVADAS = new Set(('break case catch class const continue debugger default delete do else export extends ' +
  'finally for function if import in instanceof let new return super switch this throw try typeof var void while with ' +
  'yield async await of null true false undefined').split(' '));

function ehCodigo(rel) {
  return EXTENSOES.test(String(rel || ''));
}

// A linha sem o que esta entre aspas e sem o comentario de fim de linha; a linha de comentario de bloco sai vazia.
function limpar(linha) {
  const t = linha.trim();
  if (t.startsWith('*') || t.startsWith('/*')) return '';
  return linha.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\\n]|\\.)*`/g, '""').replace(/\/\/.*$/, '');
}

const recuo = function (l) { return l.length - l.replace(/^\s+/, '').length; };

// Os nomes e os acessos `obj.membro` das linhas marcadas, na ordem em que aparecem.
function usados(linhas, fica) {
  const nomes = [];
  const membros = [];
  const viuNome = new Set();
  const viuMembro = new Set();
  for (let i = 0; i < linhas.length; i++) {
    if (!fica[i]) continue;
    const l = limpar(linhas[i]);
    let m;
    const reNome = /(^|[^\w$.])([A-Za-z_$][\w$]*)/g;
    while ((m = reNome.exec(l))) {
      const n = m[2];
      if (!RESERVADAS.has(n) && !viuNome.has(n)) { viuNome.add(n); nomes.push(n); }
    }
    const reMembro = /(^|[^\w$.])([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)/g;
    while ((m = reMembro.exec(l))) {
      const k = m[2] + '.' + m[3];
      if (!viuMembro.has(k)) { viuMembro.add(k); membros.push({ obj: m[2], membro: m[3] }); }
    }
  }
  return { nomes: nomes, membros: membros };
}

// As definicoes de nivel de topo (recuo 0): nome -> [indice da linha]. `comExports` tambem conta `exports.x =` e
// `module.exports.x =` (para o modulo de outro arquivo), so quando o nome nao tem `function`/`const`/`class`: o
// `function x` seguido de `exports.x = x` e uma definicao so, a da funcao.
function definicoesDoTopo(linhas, comExports) {
  const defs = new Map();
  const exportados = new Map();
  const por = function (mapa, nome, i) {
    if (!mapa.has(nome)) mapa.set(nome, []);
    mapa.get(nome).push(i);
  };
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (recuo(l) !== 0) continue;
    const m = /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/.exec(l) ||
      /^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/.exec(l) ||
      /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(l);
    if (m) { por(defs, m[1], i); continue; }
    const e = comExports ? /^(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/.exec(l) : null;
    if (e) por(exportados, e[1], i);
  }
  for (const [nome, lista] of exportados) if (!defs.has(nome)) defs.set(nome, lista);
  return defs;
}

// Os requires de nivel de topo: nome local -> { modulo, membro (o nome exportado, ou null para o modulo inteiro), linha }.
function requisicoes(linhas) {
  const req = new Map();
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (recuo(l) !== 0) continue;
    let m = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*(['"])([^'"]+)\2\s*\)\s*(?:\.\s*([A-Za-z_$][\w$]*))?/.exec(l);
    if (m) { req.set(m[1], { modulo: m[3], membro: m[4] || null, linha: i }); continue; }
    m = /^(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*(['"])([^'"]+)\2\s*\)/.exec(l);
    if (!m) continue;
    for (const parte of m[1].split(',')) {
      const p = /^\s*([A-Za-z_$][\w$]*)\s*(?::\s*([A-Za-z_$][\w$]*))?\s*$/.exec(parte);
      if (p) req.set(p[2] || p[1], { modulo: m[3], membro: p[1], linha: i });
    }
  }
  return req;
}

// Quantos `{`, `(` e `[` a linha abre a mais do que fecha (fora de aspas e de comentario).
function saldo(linha) {
  let n = 0;
  for (const ch of limpar(linha)) {
    if (ch === '{' || ch === '(' || ch === '[') n++;
    else if (ch === '}' || ch === ')' || ch === ']') n--;
  }
  return n;
}

// A faixa [ini, fim] (indices de 0) da definicao que comeca na linha `s`: o comentario logo acima e, quando ela fecha em
// ate TETO_DEF linhas, o corpo inteiro; senao so a assinatura. O fecho e a 1a linha em que o saldo de `{`, `(` e `[`
// somado desde `s` volta a zero (a assinatura em varias linhas, `function f(` ... `) {`, nao fecha no `) {`). A linha
// que ja fecha o que abre, e nao termina em `=>`, `=` ou `,` (o valor vem na linha de baixo), e uma definicao so.
function faixaDaDefinicao(linhas, s) {
  let c = s;
  while (c - 1 >= 0 && s - (c - 1) <= TETO_COMENTARIO && /^\s*(\/\/|\/\*|\*)/.test(linhas[c - 1])) c--;
  let total = saldo(linhas[s]);
  if (total <= 0 && !/(=>|=|,)\s*$/.test(limpar(linhas[s]).trim())) return { ini: c, fim: s };
  for (let j = s + 1; j < linhas.length && j - s < TETO_DEF; j++) {
    total += saldo(linhas[j]);
    if (total <= 0) return { ini: c, fim: j };
  }
  return { ini: c, fim: s };
}

const separar = function (texto) {
  const linhas = String(texto).replace(/\r$/gm, '').split('\n');
  if (linhas.length && linhas[linhas.length - 1] === '') linhas.pop();
  return linhas;
};

// `alvo` esta dentro de `raiz` (a propria raiz nao conta). `..x` e nome de pasta, nao subida.
const estaDentro = function (raiz, alvo) {
  const d = path.relative(raiz, alvo);
  return d !== '' && d !== '..' && !d.startsWith('..' + path.sep) && !path.isAbsolute(d);
};

// O arquivo do require relativo, dentro da raiz; null quando nao e relativo, sai da raiz (tambem por link simbolico:
// confere o caminho real) ou nao existe.
function resolverModulo(raiz, rel, modulo) {
  if (!/^\.\.?\//.test(modulo)) return null;
  const base = path.resolve(raiz, path.dirname(rel), modulo);
  if (!estaDentro(raiz, base)) return null;
  for (const f of [base, base + '.js', base + '.cjs', base + '.mjs', path.join(base, 'index.js')]) {
    try {
      if (!fs.statSync(f).isFile()) continue;
      return estaDentro(fs.realpathSync(raiz), fs.realpathSync(f)) ? f : null;
    } catch (e) { /* tenta o proximo */ }
  }
  return null;
}

/**
 * F2c: o contrato do trecho. Entrada: `lados` = [{ texto, blocos }] (os dois lados, com os blocos do recorte de cada
 * um), `margem`, `rel` (o arquivo revisado, relativo a `raiz`) e `raiz`. Devolve:
 *   - `extras`: para cada lado, a lista [{ ini, fim }] (linhas de 1) do proprio arquivo que tambem ficam a mostra;
 *   - `texto`: o contrato.txt (ou null, sem nada a dizer de outro arquivo: nem entrada, nem o que nao se achou);
 *   - `nomes`: quantos nomes de outro arquivo entraram;
 *   - `cortados`: o que o teto do contrato.txt deixou de fora; `cortadosDoProprio`: os nomes do proprio arquivo que o
 *     teto de linhas a mais deixou de fora (vao no aviso do preparar, nao no contrato.txt, que e de outro arquivo).
 * Arquivo que nao e de codigo, `lados` que nao sao dois, ou bloco invalido, devolve tudo vazio: o recorte segue o de antes.
 */
function doTrecho(entrada) {
  const vazio = { extras: [[], []], texto: null, nomes: 0, cortados: [], cortadosDoProprio: [] };
  if (!ehCodigo(entrada.rel) || !Array.isArray(entrada.lados) || entrada.lados.length !== 2) return vazio;
  const lados = entrada.lados.map(function (lado) {
    const linhas = separar(lado.texto);
    const fica = cegar.linhasDoTrecho(linhas.length, lado.blocos, entrada.margem);
    return { linhas: linhas, fica: fica, req: requisicoes(linhas) };
  });
  if (lados.some(function (l) { return !l.fica; })) return vazio;
  // A uniao dos nomes e dos acessos dos dois lados, na ordem em que aparecem.
  const nomes = [];
  const membros = [];
  const viu = new Set();
  for (const l of lados) {
    const u = usados(l.linhas, l.fica);
    for (const n of u.nomes) if (!viu.has('n:' + n)) { viu.add('n:' + n); nomes.push(n); }
    for (const m of u.membros) {
      const k = 'm:' + m.obj + '.' + m.membro;
      if (!viu.has(k)) { viu.add(k); membros.push(m); }
    }
  }
  const cortados = [];
  const cortadosDoProprio = [];
  // Do proprio arquivo: a linha do require e a definicao unica de topo de cada nome usado. `vista` marca o que ja fica
  // a mostra, para dois nomes do mesmo require nao pedirem (nem contarem) a mesma linha duas vezes.
  const extras = lados.map(function (l) {
    const defs = definicoesDoTopo(l.linhas, false);
    const req = l.req;
    const vista = l.fica.slice();
    const lista = [];
    let usadas = 0;
    for (const n of nomes) {
      let faixa = null;
      if (req.has(n)) faixa = { ini: req.get(n).linha, fim: req.get(n).linha };
      else if (defs.has(n) && defs.get(n).length === 1) faixa = faixaDaDefinicao(l.linhas, defs.get(n)[0]);
      if (!faixa) continue;
      let falta = 0;
      for (let i = faixa.ini; i <= faixa.fim; i++) if (!vista[i]) falta++;
      if (falta === 0) continue;
      if (usadas + falta > TETO_EXTRAS) {
        if (cortadosDoProprio.indexOf(n) === -1) cortadosDoProprio.push(n);
        continue;
      }
      usadas += falta;
      for (let i = faixa.ini; i <= faixa.fim; i++) vista[i] = true;
      lista.push({ ini: faixa.ini + 1, fim: faixa.fim + 1 });
    }
    return lista;
  });
  // De outro modulo do projeto: o que o trecho usa de cada require relativo.
  const pedidos = [];
  const viuPedido = new Set();
  const pedir = function (local, exportado) {
    for (const l of lados) {
      const r = l.req.get(local);
      if (!r) continue;
      const membro = r.membro || exportado;
      if (!membro) return;
      const k = r.modulo + '#' + membro;
      if (!viuPedido.has(k)) { viuPedido.add(k); pedidos.push({ modulo: r.modulo, membro: membro, uso: r.membro ? local : local + '.' + exportado }); }
      return;
    }
  };
  for (const n of nomes) pedir(n, null);
  for (const m of membros) pedir(m.obj, m.membro);
  const entradas = [];
  const naoAchados = [];
  const cache = new Map();
  let bytes = 0;
  for (const p of pedidos) {
    const arq = resolverModulo(entrada.raiz, entrada.rel, p.modulo);
    if (!arq) {
      // modulo de pacote (`node:fs`) nao e do projeto; o relativo que nao resolve dentro dele, sim, se diz
      if (/^\.\.?\//.test(p.modulo)) naoAchados.push(p.uso + ' (module ' + p.modulo + ' not found inside the project)');
      continue;
    }
    if (!cache.has(arq)) {
      let linhas = null;
      try { linhas = separar(fs.readFileSync(arq, 'utf8')); } catch (e) { linhas = null; }
      cache.set(arq, linhas ? { linhas: linhas, defs: definicoesDoTopo(linhas, true) } : null);
    }
    const mod = cache.get(arq);
    const relMod = path.relative(entrada.raiz, arq).split(path.sep).join('/');
    if (!mod || !mod.defs.has(p.membro) || mod.defs.get(p.membro).length !== 1) {
      naoAchados.push(p.uso + ' (' + relMod + ')');
      continue;
    }
    const f = faixaDaDefinicao(mod.linhas, mod.defs.get(p.membro)[0]);
    const corpo = mod.linhas.slice(f.ini, f.fim + 1).join('\n');
    const bloco = '== ' + relMod + ':' + (f.ini + 1) + '-' + (f.fim + 1) + '  ' + p.membro + ' (used as `' + p.uso + '`)\n' +
      corpo + '\n';
    const tamanho = Buffer.byteLength(bloco, 'utf8');
    if (entradas.length >= TETO_ENTRADAS || bytes + tamanho > TETO_BYTES) { cortados.push(p.uso); continue; }
    bytes += tamanho;
    entradas.push(bloco);
  }
  let texto = null;
  if (entradas.length || naoAchados.length || cortados.length) {
    texto = 'Contract of what the excerpt uses from other files of the project: the leading comment and the signature, ' +
      'or the whole definition when it has up to ' + TETO_DEF + ' lines. Taken from the files on disk, the same for A and B. ' +
      'This file is context, not under review: never cite contrato.txt in a finding.\n\n' + entradas.join('\n');
    if (naoAchados.length) texto += '\nNot found as a single top-level definition: ' + naoAchados.join(', ') + '.\n';
    if (cortados.length) texto += '\nLeft out of this file by its size cap: ' + cortados.join(', ') + '.\n';
  }
  return { extras: extras, texto: texto, nomes: entradas.length, cortados: cortados, cortadosDoProprio: cortadosDoProprio };
}

module.exports = {
  TETO_DEF, TETO_COMENTARIO, TETO_EXTRAS, TETO_ENTRADAS, TETO_BYTES, ehCodigo, limpar, saldo, usados,
  faixaDaDefinicao, doTrecho
};
