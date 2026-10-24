'use strict';
const fs = require('node:fs');
const path = require('node:path');
// Plano 082 (p5-35): os require no topo (estavam dentro das funcoes): erro de carga aparece ao carregar, nao no meio.
const caminho = require('./caminho.js');
const marcha = require('./marcha.js');
const saude = require('./saude.js');
const correcao = require('./correcao.js');
const calibracao = require('./calibracao.js');

// Pedido 32 (plano dos pedidos 30-32, Tarefa 4 subitem 3): um botao por comando na faixa do mod, na hora certa.
// Cada gatilho usa um sinal que ja existe (tabela do §2 do plano); nenhum processo novo por turno. O sessao.js
// devolve a lista na ordem de prioridade e o mod desenha o primeiro que a pessoa ainda nao usou.
// R5 tinha texto e rotulo em ASCII; a faixa e excecao desde a D532 (a sonda da Tarefa 1 do plano 082 viu o acento
// inteiro). Plano 082 (p5-36): frase inteira, sem jargao, dizendo o que fazer.

// Plano 091 #5 (D557): o paralelo roda direto, entao o botao "o agente ofereceu" saiu.
const ORDEM = ['handoff', 'revisar', 'aprender', 'init', 'auditar', 'calibrar', 'padrao'];

function botao(nome, texto, rotulo, comando) {
  return { nome: nome, texto: texto, rotulo: rotulo, comando: comando || '/sworn:' + nome };
}

/** Algum arquivo da sessao, relativo a raiz, resolve para `aaa`? Lista torta = nenhum. */
function temArquivoAaa(arquivos, projeto, raiz) {
  if (!Array.isArray(arquivos)) return false;
  return arquivos.some(function (a) {
    const rel = caminho.relativoAoProjeto(a, raiz);
    return Boolean(rel) && marcha.resolverMarcha(rel, projeto) === 'aaa';
  });
}

/**
 * Os botoes que valem agora, na ordem de ORDEM. Entrada (o que o sessao.js ja tem):
 * - `cruzou`: o gatilho contavel da troca de chat (medidor);
 * - `s`: o estado da sessao (arquivosTocados, contadores, esperaAprender, auditoriaAvisou);
 * - `projeto`, `raiz`, `temProjeto` (existe .claude/sworn/projeto.json);
 * - `padraoCarregado`: o mod viu a skill carregada;
 * - `contarConversas()`: as conversas do projeto, chamada so quando o resto do calibrar ja vale (custa um readdir).
 */
function daSessao(entrada) {
  const e = entrada || {};
  const s = e.s && typeof e.s === 'object' ? e.s : {};
  const projeto = e.projeto && typeof e.projeto === 'object' ? e.projeto : null;
  const lista = [];

  if (e.cruzou === true) lista.push(botao('handoff', 'Um gatilho de troca de chat cruzou: gere o handoff e siga num chat novo.', 'gerar handoff'));

  // A condicao do portao da referencia (D503, Tarefa 5): arquivo AAA com referencia de topo e nenhuma revisao contra
  // ela fechada na sessao. O comando ja leva o primeiro arquivo.
  const fechadas = saude.acumular(s).revisao_referencia_fechada;
  if (projeto && !(fechadas > 0)) {
    const comRef = marcha.aaaComReferencia(s.arquivosTocados, projeto, e.raiz);
    if (comRef.length) {
      lista.push(botao('revisar', 'Você mudou arquivo de rigor máximo e nenhuma revisão contra a referência do projeto fechou.', 'revisar',
        '/sworn:review ' + argumento(comRef[0])));
    }
  }

  // O abrir-turno.js poe a espera cheia no prompt em que sugere o aprender; o prompt seguinte ja a desce.
  if (s.esperaAprender === correcao.ESPERA_ENTRE_SUGESTOES) {
    lista.push(botao('aprender', 'Isso pareceu uma correção sua: dá para virar regra das próximas vezes.', 'virar regra', '/sworn:learn'));
  }

  if (e.temProjeto === false) lista.push(botao('init', 'Este projeto ainda não tem o sworn configurado.', 'configurar'));

  if (s.auditoriaAvisou === true) lista.push(botao('auditar', 'A auditoria automática achou regras ou skills para cortar.', 'ver o que cortar', '/sworn:audit'));

  // O calibrar grava no projeto.json: so com ele carregado. "Nunca calibrado" = sem limiares.tokensDeContexto (o init
  // nao grava).
  const limiares = projeto && projeto.limiares;
  const calibrado = limiares && typeof limiares === 'object' && limiares.tokensDeContexto !== undefined;
  if (projeto && !calibrado && typeof e.contarConversas === 'function') {
    // Plano 082 (p5-31): contar que lanca tira so este botao; a lista inteira caia junto.
    let n = 0;
    try { n = e.contarConversas(); } catch (err) { n = 0; }
    if (n >= calibracao.AMOSTRA_MINIMA.sessoes) {
      lista.push(botao('calibrar', 'Já há ' + n + ' conversas salvas: dá para calibrar quando trocar de chat.', 'calibrar', '/sworn:calibrate'));
    }
  }

  if (e.padraoCarregado !== true && temArquivoAaa(s.arquivosTocados, projeto, e.raiz)) {
    lista.push(botao('padrao', 'Você mudou arquivo de rigor máximo sem carregar o manual.', 'carregar o manual', '/sworn:playbook'));
  }

  // Plano 082 (p5-33): a ordem e a de ORDEM, nao a dos if acima (as duas podiam divergir sem aviso).
  return lista.sort(function (a, b) { return ORDEM.indexOf(a.nome) - ORDEM.indexOf(b.nome); });
}

/**
 * p5-37: caminho com espaco ou aspa vai entre aspas no comando; sem isso, viraria dois argumentos. p1-32: pela regra
 * padrao de linha de comando, as barras logo antes de uma aspa (ou do fim, onde entra a aspa que fecha) dobram, e a
 * aspa do caminho vira \"; sem isso, "C:\a b\" leria a aspa final como escapada.
 */
function argumento(p) {
  const s = String(p);
  if (!/[\s"]/.test(s)) return s;
  return '"' + s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
}

/** Dia local AAAA-MM-DD de `agoraMs`. */
function dia(agoraMs) {
  const d = new Date(agoraMs);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * As conversas (.jsonl) da pasta de transcricoes do projeto, contadas uma vez por dia: a marca no `arquivoDoCache`
 * guarda { dia, pasta, n }. Sem pasta, ou pasta que nao se le: 0, e sem marca (a pasta pode nascer no mesmo dia).
 */
function conversasDoProjeto(pasta, arquivoDoCache, agoraMs) {
  const hoje = dia(agoraMs);
  try {
    const marca = JSON.parse(fs.readFileSync(arquivoDoCache, 'utf8'));
    if (marca && marca.dia === hoje && marca.pasta === pasta && typeof marca.n === 'number') return marca.n;
  } catch (err) { /* sem marca ou ilegivel: conta */ }
  let n;
  try {
    n = fs.readdirSync(pasta).filter(function (nome) { return /\.jsonl$/i.test(nome); }).length;
  } catch (err) {
    return 0;
  }
  try {
    fs.mkdirSync(path.dirname(arquivoDoCache), { recursive: true });
    fs.writeFileSync(arquivoDoCache, JSON.stringify({ dia: hoje, pasta: pasta, n: n }) + '\n', 'utf8');
  } catch (err) { /* sem marca: a proxima medida conta de novo */ }
  return n;
}

module.exports = { ORDEM, daSessao, argumento, conversasDoProjeto };
