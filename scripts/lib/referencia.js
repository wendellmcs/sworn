'use strict';
const projeto = require('./projeto.js');
const glob = require('./glob.js');
const { TETO_DA_REFERENCIA } = require('./cegar.js');

/**
 * Plano do REA, Tarefa 3 (D555, D580): a ficha do /sworn:reference. Logica pura: quem le o disco e grava e o
 * scripts/referencia.js. A skill sozinha nao garante o formato (escada do "menos codigo"): o grau e a origem de cada
 * achado, o estado do que ficou sem saber e o tamanho que cabe no R.txt (cegar.js) se conferem aqui, antes de a ficha
 * entrar na `referencias`. Forma (texto do mock, prints-rea/mock-rea.png, secao 2):
 *   ## Achados                  | Camada | Achado | Origem | Grau | Quem agiu |
 *   ## O que ficou sem saber    | Pergunta | Estado | O que mediria |
 *   Não li: <o que ficou de fora da leitura>
 */
const GRAUS = ['observado', 'derivado', 'inferido'];
const QUEM = ['agente', 'dono'];
const ESTADOS = ['aberto', 'bloqueado', 'resolvido'];
const ACHADOS = '## Achados';
const SEM_SABER = '## O que ficou sem saber';
const CAB_ACHADOS = ['camada', 'achado', 'origem', 'grau', 'quem agiu'];
const CAB_SEM_SABER = ['pergunta', 'estado', 'o que mediria'];
const SEM_BARRA = 'linha de tabela sem a barra do começo (|): no markdown ela sai da tabela e some da conta';
// Plano do radar, T2 (D609): a ficha do radar e esta mesma ficha mais a secao dos candidatos. Valor sem acento tambem
// vale, como no "Nao li:".
const CANDIDATOS = '## Candidatos';
const CAB_CANDIDATOS = ['repo', 'licença', 'como entra', 'como melhora', 'esforço', 'valor', 'veredito'];
const ESFORCOS = ['p', 'm', 'g'];
const VALORES = ['baixo', 'médio', 'medio', 'alto'];
const VEREDITOS = ['adotar', 'inspiração', 'inspiracao', 'descartar'];
// D580: uma ficha por tipo de entrega, em .claude/sworn/referencias/<tipo>-<assunto>.md, sem subpasta.
const RE_FICHA = /^\.claude\/sworn\/referencias\/(tela|codigo|texto)-[^/]+\.md$/;

/** As celulas de uma linha de tabela (`| a | b |`), sem as crases de volta do valor; `\|` nao separa. */
function celulas(linha) {
  return linha.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(function (c) { return c.trim(); });
}
function valor(c) { return c.replace(/`/g, '').trim().toLowerCase(); }
// D582: texto livre (achado, origem, o que mediria, o "Não li:") precisa de duas letras ou dígitos seguidos: "-", "x",
// "?" e "n/a" contam como vazio. Nao julga o sentido: a ficha inteira vai ao dono antes do --gravar.
function temTexto(c) { return /[\p{L}\p{N}]{2}/u.test(String(c || '')); }
// O separador do markdown (`|---|:--:|`): so tracos e dois-pontos, com ao menos uma celula de 3 tracos. Linha em branco
// (`| | |`) ou de um traco por celula (`| - | - |`) e dado, e cai na conferencia como achado vazio.
function ehSeparador(c) {
  return c.every(function (x) { return /^:?-+:?$/.test(x); }) && c.some(function (x) { return /-{3}/.test(x); });
}

/**
 * As linhas de dado da tabela da secao `titulo` ({ n, c }), sem o cabecalho e o separador; null se nao ha secao. Linha
 * com `|` que nao comeca por ele vem com `c: null` (D582): fora da tabela no markdown, ela sumiria da conta calada.
 */
function linhasDaSecao(linhas, titulo, cabecalho) {
  const i = linhas.findIndex(function (l) { return l.trim() === titulo; });
  if (i === -1) return null;
  const dados = [];
  for (let k = i + 1; k < linhas.length && !/^## /.test(linhas[k]); k++) {
    const l = linhas[k].trim();
    if (!l.startsWith('|')) { if (l.indexOf('|') !== -1) dados.push({ n: k + 1, c: null }); continue; }
    const c = celulas(l);
    if (ehSeparador(c) || c.map(valor).join('|') === cabecalho.join('|')) continue;
    dados.push({ n: k + 1, c: c });
  }
  return dados;
}

/** Os candidatos do radar: { candidatos, adotar }, com os problemas empurrados em `problemas`. */
function conferirCandidatos(linhas, problemas) {
  const cand = linhasDaSecao(linhas, CANDIDATOS, CAB_CANDIDATOS);
  if (!cand) problemas.push('falta a secao "' + CANDIDATOS + '" (| ' + CAB_CANDIDATOS.join(' | ') + ' |)');
  else if (!cand.length) problemas.push('nenhum candidato na secao "' + CANDIDATOS + '": a semana sem nada diz isso numa linha com veredito descartar');
  let adotar = 0;
  for (const c of cand || []) {
    const p = 'linha ' + c.n + ': ';
    if (!c.c) { problemas.push(p + SEM_BARRA); continue; }
    if (c.c.length !== CAB_CANDIDATOS.length) { problemas.push(p + 'o candidato tem ' + c.c.length + ' colunas, e sao ' + CAB_CANDIDATOS.length); continue; }
    const veredito = valor(c.c[6]);
    if (!temTexto(c.c[0])) problemas.push(p + 'candidato sem o repo');
    if (!temTexto(c.c[1])) problemas.push(p + 'candidato sem licença (o que a fonte diz, ou "sem licença")');
    // descartado nao entra: so ele pode deixar "como entra" e "como melhora" vazios
    if (veredito !== 'descartar' && !temTexto(c.c[2])) problemas.push(p + 'candidato sem como entra');
    if (veredito !== 'descartar' && !temTexto(c.c[3])) problemas.push(p + 'candidato sem como melhora (o que fica melhor que o original)');
    if (ESFORCOS.indexOf(valor(c.c[4])) === -1) problemas.push(p + 'candidato sem esforço (P, M ou G)');
    if (VALORES.indexOf(valor(c.c[5])) === -1) problemas.push(p + 'candidato sem valor (baixo, médio ou alto)');
    if (VEREDITOS.indexOf(veredito) === -1) problemas.push(p + 'candidato sem veredito (adotar, inspiração ou descartar)');
    if (veredito === 'adotar') adotar++;
  }
  return { candidatos: (cand || []).length, adotar: adotar };
}

/**
 * { problemas, achados, semSaber, abertos, bytes }; com `opcoes.tipo === 'radar'`, tambem { candidatos, adotar }.
 * Problema de linha comeca com "linha <n>: ".
 */
function conferir(texto, opcoes) {
  const linhas = String(texto).split(/\r?\n/);
  const problemas = [];
  const radar = opcoes && opcoes.tipo === 'radar' ? conferirCandidatos(linhas, problemas) : null;
  const achados = linhasDaSecao(linhas, ACHADOS, CAB_ACHADOS);
  if (!achados || !achados.length) problemas.push('nenhum achado: falta a tabela da secao "' + ACHADOS + '"');
  for (const a of achados || []) {
    const p = 'linha ' + a.n + ': ';
    if (!a.c) { problemas.push(p + SEM_BARRA); continue; }
    if (a.c.length !== CAB_ACHADOS.length) { problemas.push(p + 'o achado tem ' + a.c.length + ' colunas, e sao ' + CAB_ACHADOS.length); continue; }
    if (!temTexto(a.c[1])) problemas.push(p + 'achado vazio');
    if (!temTexto(a.c[2])) problemas.push(p + 'achado sem origem (arquivo:linha, print, DOM, rede ou busca com hora)');
    if (GRAUS.indexOf(valor(a.c[3])) === -1) problemas.push(p + 'achado sem grau (' + GRAUS.join(', ') + ')');
    if (QUEM.indexOf(valor(a.c[4])) === -1) problemas.push(p + 'achado sem quem agiu (' + QUEM.join(' ou ') + ')');
  }
  const semSaber = linhasDaSecao(linhas, SEM_SABER, CAB_SEM_SABER);
  if (!semSaber) problemas.push('falta a secao "' + SEM_SABER + '"');
  else if (!semSaber.length) problemas.push('nenhuma pergunta na secao "' + SEM_SABER + '": todo estudo deixa alguma (a resolvida fica, com o que se mediu)');
  for (const s of semSaber || []) {
    const p = 'linha ' + s.n + ': ';
    if (!s.c) { problemas.push(p + SEM_BARRA); continue; }
    if (s.c.length !== CAB_SEM_SABER.length) { problemas.push(p + 'a pergunta tem ' + s.c.length + ' colunas, e sao ' + CAB_SEM_SABER.length); continue; }
    if (ESTADOS.indexOf(valor(s.c[1])) === -1) problemas.push(p + 'pergunta sem estado (' + ESTADOS.join(', ') + ')');
    if (!temTexto(s.c[2])) problemas.push(p + 'pergunta sem o que mediria');
  }
  // REA: falta de cobertura e desconhecido. O "nao achei" so vale sobre o que se leu, e a ficha diz o que nao leu.
  if (!linhas.some(function (l) { const m = l.trim().match(/^N[ãa]o li:(.*)$/); return !!m && temTexto(m[1]); })) {
    problemas.push('falta a linha "Não li:" (o que ficou de fora da leitura)');
  }
  const bytes = Buffer.byteLength(String(texto), 'utf8');
  if (bytes > TETO_DA_REFERENCIA) {
    problemas.push('a ficha tem ' + bytes + ' bytes e o /sworn:review le inteira so ate 100 KB (' + TETO_DA_REFERENCIA + ')');
  }
  return Object.assign({
    problemas: problemas,
    achados: (achados || []).length,
    semSaber: (semSaber || []).length,
    abertos: (semSaber || []).filter(function (s) { return !!s.c && valor(s.c[1] || '') === 'aberto'; }).length,
    bytes: bytes
  }, radar);
}

/** O tipo pelo caminho relativo a raiz do projeto (`\` ou `/`), ou null fora de .claude/sworn/referencias/<tipo>-<assunto>.md. */
function tipoDaFicha(rel) {
  const m = glob.normalizar(rel).match(RE_FICHA);
  return m ? m[1] : null;
}

/** Os erros de `referencias` que projeto.validar acha no objeto (as mensagens dela comecam pelo nome da chave). */
function errosDaReferencia(obj) {
  return projeto.validar(obj || {}).erros.filter(function (e) { return /^referencias/.test(e); });
}

/**
 * O projeto.json com a ficha na lista do tipo, sem repetir: o que ja estava ali e os outros tipos ficam (fusao por
 * tipo de projeto.atualizar, FUNDE_POR_CHAVE). O geradoEm fica: isto nao e um re-init. { config, erros }; com erro
 * de `referencias` quem chama nao grava. A `referencias` que ja estava torta e erro tambem: gravar por cima apagaria,
 * sem ninguem ver, o que o dono escreveu.
 */
function naReferencia(antigo, tipo, rel) {
  const antes = errosDaReferencia(antigo);
  if (antes.length) return { config: antigo, erros: antes };
  const atual = (antigo && antigo.referencias && antigo.referencias[tipo]) || [];
  const lista = atual.indexOf(rel) === -1 ? atual.concat([rel]) : atual.slice();
  const resposta = {};
  resposta[tipo] = lista;
  const config = projeto.atualizar(antigo, { referencias: resposta }, antigo && antigo.geradoEm).config;
  return { config: config, erros: errosDaReferencia(config) };
}

module.exports = { GRAUS, QUEM, ESTADOS, ESFORCOS, VALORES, VEREDITOS, conferir, tipoDaFicha, naReferencia };
