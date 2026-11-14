'use strict';
// F4c: as pendencias num arquivo so, cada uma com dono e data. O diagnostico de 2026-11-10 achou pendencia arrastada
// de handoff em handoff (a mesma lista copiada por 33 handoffs, sem dono): aqui ela mora num lugar, com numero que
// nao se reusa, e o handoff traz as abertas dela. Fora de .claude/ (caminho protegido do Claude Code), junto do handoff.
// Formato de cada linha (o arquivo e Markdown legivel e editavel a mao):
//   - [ ] #3 2026-11-13 | dono: Ana | o que falta
//   - [x] #3 2026-11-13 | dono: Ana | o que falta | fechada 2026-11-14: como fechou
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const textoLib = require('./texto.js');

const ARQUIVO = '.sworn/PENDENCIAS.md';
const CABECALHO = '# Pendencias\n\nCada item tem dono e data. Adicione e feche com o comando pendencias.js do sworn ' +
  '(--adicionar, --fechar); o numero nao se reusa.\n\n';
const RE_LINHA = /^- \[( |x|X)\] #(\d+) (\d{4}-\d{2}-\d{2}) \| dono: ([^|]+?) \| ([^|]+?)(?: \| fechada (\d{4}-\d{2}-\d{2}): (.+))?\s*$/;
const RE_ITEM = /^\s*- \[[ xX]\]/;
const RE_NUMERO_SOLTO = /^\s*- \[[ xX]\]\s*#(\d+)/; // o numero de um item fora do formato: ele tambem nao se reusa
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

function caminho(raiz) { return path.join(raiz, ARQUIVO); }

/** Erro de quem chamou (campo vazio, numero que nao existe): o comando sai 2. Falha de disco sai 1. */
function erroDeUso(msg) { const e = new Error(msg); e.uso = true; return e; }

/** A data de hoje no relogio local (o dia do dono, nao o de Greenwich). */
function dataLocal(d) {
  const p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function analisar(texto) {
  const r = { existe: true, abertas: [], fechadas: [], invalidas: [], maior: 0 };
  textoLib.semBom(texto).split(/\r?\n/).forEach(function (l, i) {
    const m = RE_LINHA.exec(l);
    if (!m) {
      if (!RE_ITEM.test(l)) return;
      r.invalidas.push({ linha: i + 1, texto: l });
      const solto = RE_NUMERO_SOLTO.exec(l);
      if (solto && Number(solto[1]) > r.maior) r.maior = Number(solto[1]);
      return;
    }
    const p = { n: Number(m[2]), data: m[3], dono: m[4].trim(), texto: m[5].trim(), linha: i + 1 };
    if (p.n > r.maior) r.maior = p.n;
    if (m[1] !== ' ') { p.fechadaEm = m[6] || null; p.como = m[7] ? m[7].trim() : null; r.fechadas.push(p); }
    else r.abertas.push(p);
  });
  return r;
}

/** Le o arquivo: { r, texto }; texto null quando o arquivo nao existe ou nao se le (entao `r.erro` diz a causa). */
function lerComTexto(raiz) {
  let texto;
  try { texto = fs.readFileSync(caminho(raiz), 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return { r: { existe: false, abertas: [], fechadas: [], invalidas: [], maior: 0 }, texto: null };
    return { r: { existe: true, erro: textoLib.causaDoErro(e), abertas: [], fechadas: [], invalidas: [], maior: 0 }, texto: null };
  }
  return { r: analisar(texto), texto: texto };
}

/**
 * { existe, abertas, fechadas, invalidas, maior }. Quando o arquivo existe e nao se le: { existe: true, erro } com a
 * causa e as listas vazias; quem le confere `erro` antes de tratar a lista como vazia. `invalidas` sao os itens de
 * lista fora do formato (linha de 1 em diante); o numero deles entra em `maior`, para nao se dar de novo.
 */
function ler(raiz) { return lerComTexto(raiz).r; }

function campo(nome, valor) {
  const v = String(valor ?? '').trim();
  if (!v) throw erroDeUso('sworn: pendencia sem --' + nome + '; passe --' + nome + ' com o texto');
  // U+2028/U+2029 tambem: o `.` do RE_LINHA nao os casa, e o item gravado sumiria na leitura seguinte
  if (/[\r\n|\u2028\u2029]/.test(v)) throw erroDeUso('sworn: --' + nome + ' com quebra de linha ou "|"; escreva numa linha, sem "|"');
  return v;
}

function hojeValido(hoje) {
  const h = hoje || dataLocal(new Date());
  const d = new Date(h + 'T00:00:00');
  if (!RE_DATA.test(h) || isNaN(d.getTime()) || dataLocal(d) !== h) {
    throw erroDeUso('sworn: --hoje fora do formato AAAA-MM-DD ou data que nao existe: ' + h);
  }
  return h;
}

/**
 * Pendencia #1 (seguranca, D841): um repositorio clonado pode trazer a pasta .sworn ou o PENDENCIAS.md como link
 * simbolico (ou junction); gravar por ele escreveria fora do projeto. Devolve o TEXTO da recusa, ou null quando
 * pode gravar; sem conseguir conferir (lstat falhou por outro motivo que "nao existe"), recusa tambem.
 * atalho: confere o link na hora da leitura, nao no instante da escrita. limite: guarda contra o link que veio no
 * clone, nao contra quem troca o arquivo entre as duas chamadas. trocar quando: o Node tiver O_NOFOLLOW no Windows.
 */
function recusaPorLink(raiz) {
  for (const [rel, nome, deVerdade] of [['.sworn', 'a pasta .sworn', 'uma pasta'], [ARQUIVO, ARQUIVO, 'um arquivo']]) {
    let st;
    try { st = fs.lstatSync(path.join(raiz, rel)); } catch (e) {
      if (e && e.code === 'ENOENT') continue; // nao existe: nada a seguir
      return 'sworn: nao consegui conferir se ' + nome + ' e um link (' + textoLib.causaDoErro(e) + '); nao gravo sem ' +
        'conferir. Confira a permissao do caminho e rode de novo';
    }
    if (st.isSymbolicLink()) {
      return 'sworn: ' + nome + ' e um link (atalho) que pode levar para fora do projeto; nao gravo por ele. ' +
        'Troque o link por ' + deVerdade + ' de verdade e rode de novo';
    }
  }
  return null;
}

function lerParaGravar(raiz) {
  const recusa = recusaPorLink(raiz);
  if (recusa) throw new Error(recusa);
  const lido = lerComTexto(raiz);
  if (lido.r.erro) throw new Error('sworn: nao consegui ler ' + ARQUIVO + ' (' + lido.r.erro + '); confira o arquivo e rode de novo');
  return lido;
}

/** Acrescenta uma pendencia aberta e devolve { n }. Dono e texto vazios, com quebra de linha ou "|": recusa. */
function adicionar(raiz, p) {
  const dono = campo('dono', p && p.dono);
  const texto = campo('texto', p && p.texto);
  const hoje = hojeValido(p && p.hoje);
  const atual = lerParaGravar(raiz);
  const n = atual.r.maior + 1;
  const linha = '- [ ] #' + n + ' ' + hoje + ' | dono: ' + dono + ' | ' + texto;
  fs.mkdirSync(path.dirname(caminho(raiz)), { recursive: true });
  if (atual.texto === null) fs.writeFileSync(caminho(raiz), CABECALHO + linha + '\n');
  else {
    const fim = atual.texto.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
    fs.appendFileSync(caminho(raiz), (atual.texto && !/\n$/.test(atual.texto) ? fim : '') + linha + fim);
  }
  return { n: n };
}

/** Fecha a pendencia `n` com `como` (o que a fechou: commit, decisao, "sem acao" e por que). */
function fechar(raiz, n, como, hoje) {
  const texto = campo('como', como);
  const data = hojeValido(hoje);
  const num = /^\s*\d+\s*$/.test(String(n ?? '')) ? Number(n) : NaN;
  if (!(num >= 1)) {
    throw erroDeUso('sworn: --fechar pede o numero da pendencia (1 ou mais), veio "' + String(n ?? '') + '"; veja os numeros com --listar');
  }
  const atual = lerParaGravar(raiz);
  if (atual.r.fechadas.some(function (p) { return p.n === num; })) {
    throw erroDeUso('sworn: a pendencia #' + num + ' ja esta fechada; nada a fazer (veja com --listar)');
  }
  const alvo = atual.r.abertas.find(function (p) { return p.n === num; });
  if (!alvo) throw erroDeUso('sworn: nao ha pendencia aberta #' + num + ' em ' + ARQUIVO + '; veja os numeros com --listar');
  const fim = atual.texto.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
  const bom = atual.texto.charCodeAt(0) === 0xFEFF ? String.fromCharCode(0xFEFF) : ''; // o BOM volta inteiro, fora da linha 1
  const linhas = textoLib.semBom(atual.texto).split(/\r?\n/);
  const i = alvo.linha - 1;
  linhas[i] = linhas[i].replace(/^- \[ \]/, '- [x]').replace(/\s+$/, '') + ' | fechada ' + data + ': ' + texto;
  // por um temporario na mesma pasta e rename: a falha no meio (disco cheio, processo parado) nao trunca o arquivo.
  // F5b r2: nome com sorteio e flag 'wx' (cria exclusivo): um link ja plantado nesse nome faz a gravacao falhar,
  // nunca escreve por ele; e so se apaga o temporario que esta chamada criou
  const tmp = caminho(raiz) + '.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  let criado = false;
  try {
    const fd = fs.openSync(tmp, 'wx');
    criado = true;
    try { fs.writeFileSync(fd, bom + linhas.join(fim)); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, caminho(raiz));
  } catch (e) {
    if (criado) { try { fs.rmSync(tmp, { force: true }); } catch (e2) { /* o erro que conta e o da gravacao */ } }
    throw e;
  }
  return { n: num };
}

module.exports = { ARQUIVO, ler, adicionar, fechar, dataLocal, hojeValido };
