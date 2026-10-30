'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LIMIARES_PADRAO } = require('./saude.js');

// Item 2 da 0.7 (D466/D467): o calibrador por projeto. Os scripts da medicao da D464 (extrai, analise e
// paradas, sessao 90) viram modulo: le as transcricoes principais do proprio projeto (subagente fora),
// mede o custo por faixa de contexto e simula a troca de chat no fim de turno do dono para cada limiar
// candidato. So numeros saem daqui: nenhum texto de conversa entra no resultado.

// US$ por milhao: entrada, saida, leitura de cache, escrita de 5 min, escrita de 1 h (skill claude-api, tabela
// de 2026-10-06, a mesma da D464). Modelo fora da tabela nao entra na conta e aparece em `semPreco`.
const PRECOS = {
  'claude-opus-5-5': [4, 20, 0.20, 5, 8],
  'claude-opus-5': [5, 25, 0.50, 6.25, 10],
  'claude-sonnet-5-5': [2, 10, 0.20, 2.5, 4],
  'claude-sonnet-5': [2, 10, 0.20, 2.5, 4],
  'claude-fable-5-1': [10, 50, 0.25, 12.5, 20],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125, 0.2]
};

const K = 1000;
// a ultima faixa e aberta (500K ou mais)
const FAIXAS = [0, 50, 100, 150, 200, 300, 500].map(function (x) { return x * K; });
// de 25K em 25K, de 150K ate abaixo do alarme: acima dele a troca ja e ordem, nao limiar
const CANDIDATOS = [];
for (let t = 150 * K; t < LIMIARES_PADRAO.tokensAlarme; t += 25 * K) CANDIDATOS.push(t);
// abaixo disto a simulacao nao diz nada sobre o projeto, e fica o padrao da D464
const AMOSTRA_MINIMA = { sessoes: 30, conversasNoPadrao: 10, trocasMedidas: 10 };
// D464: medido em 435 sessoes (US$ 3,40 por troca; o chat novo comeca a trabalhar com 119K)
const TROCA_PADRAO = { custo: 3.40, recomeco: 119 * K };
// a compactacao derruba o contexto: queda para menos de 60% vindo de mais de 80K abre conversa nova
const QUEDA_DE_COMPACTACAO = 0.6;
// escrever o handoff so conta perto do fim da sessao (as ultimas 60 chamadas), como na D464
const JANELA_DO_HANDOFF = 60;

const NAO_E_DO_DONO = /^\s*(<system-reminder>|<command-|<local-command|Caveat:|\[Request interrupted|<task-notification>|<user-prompt-submit-hook>)/;
const PROMPT_DE_HANDOFF = /handoff|prompt (pronto|de continua)|continua(r|ção)? (exatamente|de onde)/i;
const COMMIT = /git\b[^\n|;]*\bcommit\b/;
const ARQUIVO_DE_RASCUNHO = /Temp|scratchpad|\.claude[\\/]projects/i;

// paradas.mjs da s90: a ultima fala do agente antes de o dono responder. A primeira classe que casa vence.
const CLASSES_DE_PARADA = [
  ['pede acao manual ao dono', /\b(abra|abre|clique|recarregue|recarregar a extens|tire (um |uma )?(print|foto)|me (mande|envie|mostre)|cole aqui|no seu (navegador|chrome)|voc[eê] (precisa|pode|consegue) (abrir|rodar|clicar|recarregar|conferir|testar|olhar)|rode (no|este|esse) |passo a passo)/i],
  ['pede licenca para seguir', /(sigo\?|posso seguir|quer que eu|devo seguir|prossigo\?|posso (fazer|come[cç]ar|rodar|aplicar)\?|autoriza)/i],
  ['handoff / troca de chat', /(handoff|chat novo|prompt pronto|cole (o prompt|no chat novo))/i],
  ['bloqueado / travado', /(travad|bloquead|parar|parei|n[aã]o consigo|sem acesso)/i]
];
const OUTRA = 'outra';

function textoDoDono(conteudo) {
  if (typeof conteudo === 'string') return conteudo;
  if (!Array.isArray(conteudo) || conteudo.some(function (b) { return b && b.type === 'tool_result'; })) return null;
  return conteudo.filter(function (b) { return b && b.type === 'text'; }).map(function (b) { return b.text; }).join('\n');
}

function falaDoDono(t) {
  return typeof t === 'string' && t.trim() !== '' && !NAO_E_DO_DONO.test(t);
}

function classificar(fala) {
  const fim = String(fala || '').slice(-1500);
  const achada = CLASSES_DE_PARADA.filter(function (c) { return c[1].test(fim); })[0];
  return achada ? achada[0] : OUTRA;
}

function novaChamada(u, preco, t) {
  const leitura = u.cache_read_input_tokens || 0;
  const escrita = u.cache_creation_input_tokens || 0;
  const cc = u.cache_creation || {};
  const w1 = cc.ephemeral_1h_input_tokens || 0;
  const w5 = typeof cc.ephemeral_5m_input_tokens === 'number' ? cc.ephemeral_5m_input_tokens : Math.max(0, escrita - w1);
  const partes = {
    entrada: (u.input_tokens || 0) * preco[0] / 1e6,
    saida: (u.output_tokens || 0) * preco[1] / 1e6,
    leitura: leitura * preco[2] / 1e6,
    escrita5m: w5 * preco[3] / 1e6,
    escrita1h: w1 * preco[4] / 1e6
  };
  return {
    t: t, C: (u.input_tokens || 0) + leitura + escrita, leitura: leitura, escrita: escrita, preco: preco, partes: partes,
    custo: partes.entrada + partes.saida + partes.leitura + partes.escrita5m + partes.escrita1h,
    commit: false, edicao: false, handoff: false
  };
}

/**
 * Uma transcricao `.jsonl` da linha principal. Devolve as chamadas pagas (uma por mensagem, mesmo que a
 * mensagem venha em varias linhas), os fins de turno do dono (`prompts`: o indice da ultima chamada antes de
 * cada fala real dele; -1 antes da primeira chamada), as paradas classificadas e se a sessao abriu de handoff.
 */
function lerSessao(texto) {
  const chamadas = [];
  const porId = new Map();
  const prompts = [];
  const paradas = [];
  let semPreco = 0, perguntas = 0, primeira = null, ultimaFala = '', tUltima = null;
  for (const linha of String(texto).split('\n')) {
    if (!linha.trim()) continue;
    let o;
    try { o = JSON.parse(linha); } catch (e) { continue; }
    if (!o || o.isSidechain === true) continue;
    const m = o.message || {};
    const t = Date.parse(o.timestamp);
    if (o.type === 'assistant') {
      let k = -1;
      if (m.usage && m.model && m.model !== '<synthetic>') {
        k = porId.has(m.id) ? porId.get(m.id) : -2;
        if (k === -2) {
          const preco = PRECOS[m.model];
          if (preco) { k = chamadas.length; chamadas.push(novaChamada(m.usage, preco, t)); } else { k = -1; semPreco++; }
          porId.set(m.id, k);
        }
      }
      for (const b of Array.isArray(m.content) ? m.content : []) {
        if (b && b.type === 'text' && typeof b.text === 'string' && b.text.trim()) ultimaFala = b.text;
        if (!b || b.type !== 'tool_use') continue;
        if (b.name === 'AskUserQuestion') perguntas++;
        if (k < 0) continue;
        const entrada = b.input || {};
        const comando = String(entrada.command || '');
        const arquivo = String(entrada.file_path || '');
        if (COMMIT.test(comando) && !/--dry-run/.test(comando)) chamadas[k].commit = true;
        if (/^(Edit|Write|NotebookEdit)$/.test(b.name) && arquivo && !ARQUIVO_DE_RASCUNHO.test(arquivo)) chamadas[k].edicao = true;
        // D471: so gravar conta; ler o handoff na abertura marcava 302 de 444 sessoes nas 5 primeiras chamadas
        if (/^(Edit|Write|NotebookEdit)$/.test(b.name) && /handoff/i.test(arquivo)) chamadas[k].handoff = true;
      }
      if (Array.isArray(m.content) && m.content.length) tUltima = t;
    }
    if (o.type === 'user' && !o.isMeta && !o.isCompactSummary) {
      const fala = textoDoDono(m.content);
      if (!falaDoDono(fala)) continue;
      if (primeira === null) {
        primeira = PROMPT_DE_HANDOFF.test(fala.slice(0, 4000));
      } else if (tUltima !== null) {
        paradas.push({ classe: classificar(ultimaFala), espera: (t - tUltima) / 60000 });
      }
      prompts.push(chamadas.length - 1);
    }
  }
  return { chamadas: chamadas, prompts: prompts, paradas: paradas, perguntas: perguntas, semPreco: semPreco, deHandoff: primeira === true };
}

/** As transcricoes do topo da pasta (as de subagente ficam em subpasta e nao entram). Sessao com menos de 3 chamadas fica de fora. */
function lerPasta(dir) {
  const sessoes = [];
  let semPreco = 0;
  let ilegiveis = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile() || !/\.jsonl$/i.test(e.name)) continue;
    let texto;
    // A6 (s220, R1 :152): a que nao se le saia calada da amostra; conta em `ilegiveis`, como no gasto (082 p6-2).
    try { texto = fs.readFileSync(path.join(dir, e.name), 'utf8'); } catch (x) { ilegiveis++; continue; }
    const s = lerSessao(texto);
    semPreco += s.semPreco;
    if (s.chamadas.length >= 3) sessoes.push(s);
  }
  return { sessoes: sessoes, semPreco: semPreco, ilegiveis: ilegiveis };
}

/** Conversas: a compactacao corta a sessao. `turnos` guarda, por conversa, os indices de fim de turno do dono. */
function segmentar(sessoes) {
  const segs = [];
  for (const s of sessoes) {
    let atual = { chamadas: [], turnos: new Set() };
    const onde = [];
    s.chamadas.forEach(function (c, i) {
      const ant = atual.chamadas[atual.chamadas.length - 1];
      if (ant && c.C < QUEDA_DE_COMPACTACAO * ant.C && ant.C > 80 * K) {
        segs.push(atual);
        atual = { chamadas: [], turnos: new Set() };
      }
      onde[i] = [atual, atual.chamadas.length];
      atual.chamadas.push(c);
    });
    segs.push(atual);
    for (const i of s.prompts) if (i >= 0 && onde[i]) onde[i][0].turnos.add(onde[i][1]);
  }
  return segs;
}

function mediana(a) {
  const b = a.slice().sort(function (x, y) { return x - y; });
  return b.length ? b[Math.floor(b.length / 2)] : NaN;
}

function soma(lista) {
  return lista.reduce(function (t, c) { return t + c.custo; }, 0);
}

/**
 * Quanto custa uma troca neste projeto: a rampa do chat novo (sessao aberta de handoff, ate a 1a edicao real
 * ou commit) mais escrever o handoff (da 1a chamada que grava arquivo de handoff ate o fim da sessao). Com
 * menos de `AMOSTRA_MINIMA.trocasMedidas` de cada, vale o medido na D464.
 */
function custoDaTroca(sessoes) {
  const rampas = [], recomecos = [], escritas = [];
  for (const s of sessoes) {
    if (s.deHandoff) {
      const fim = s.chamadas.findIndex(function (c) { return c.edicao || c.commit; });
      if (fim >= 1) { rampas.push(soma(s.chamadas.slice(0, fim))); recomecos.push(s.chamadas[fim].C); }
    }
    const i = s.chamadas.findIndex(function (c) { return c.handoff; });
    if (i >= 0 && i > s.chamadas.length - JANELA_DO_HANDOFF) escritas.push(soma(s.chamadas.slice(i)));
  }
  const n = { aberturasMedidas: rampas.length, handoffsMedidos: escritas.length };
  if (rampas.length < AMOSTRA_MINIMA.trocasMedidas || escritas.length < AMOSTRA_MINIMA.trocasMedidas) {
    return Object.assign({ custo: TROCA_PADRAO.custo, recomeco: TROCA_PADRAO.recomeco, medida: false }, n);
  }
  return Object.assign({ custo: mediana(rampas) + mediana(escritas), recomeco: mediana(recomecos), medida: true }, n);
}

/**
 * analise.mjs da s90, politica "turno" (a da D464): cruzado o limiar `T`, a troca so acontece no proximo fim
 * de turno do dono. Depois dela, cada chamada le do cache `recomeco` em vez do contexto inteiro: a diferenca e
 * a economia. `delta` em US$ (negativo = economia), contra nao trocar nunca.
 */
function simular(segs, T, custoTroca, recomeco) {
  let delta = 0, trocas = 0;
  for (const g of segs) {
    let corte = 0, armado = false;
    for (let j = 0; j < g.chamadas.length; j++) {
      const c = g.chamadas[j];
      if (corte > 0) {
        let d = corte;
        const lidos = Math.min(c.leitura, d);
        d -= lidos;
        const escritos = Math.min(c.escrita, d);
        const precoEscrita = c.escrita ? (c.partes.escrita5m + c.partes.escrita1h) / c.escrita : 0;
        delta -= lidos * c.preco[2] / 1e6 + escritos * precoEscrita;
      }
      if (c.C - corte >= T) armado = true;
      const prox = g.chamadas[j + 1];
      if (armado && g.turnos.has(j) && prox && prox.C - recomeco > corte + 1000) {
        corte = prox.C - recomeco;
        armado = false;
        trocas++;
        delta += custoTroca;
      }
    }
  }
  return { delta: delta, trocas: trocas };
}

/**
 * O menor limiar em que trocar no fim de turno do dono nao sai mais caro que nao trocar: trocar mais cedo
 * custa so o que se pagaria de qualquer jeito, e a conversa menor e a que segue o plano. Com os numeros da
 * D464 da 250K (200K +1,3%, 250K -0,5%). Se nenhum empata, o que menos encarece.
 */
function escolher(linhas) {
  const empata = linhas.filter(function (l) { return l.delta <= 0; })[0];
  if (empata) {
    return { tokensDeContexto: empata.T, motivo: 'o menor limiar em que trocar no fim de turno do dono nao sai mais caro que nao trocar' };
  }
  const melhor = linhas.reduce(function (a, b) { return b.delta < a.delta ? b : a; });
  return { tokensDeContexto: melhor.T, motivo: 'nenhum limiar empata com nao trocar neste projeto; este e o que menos encarece' };
}

const r1 = function (x) { return Math.round(x * 10) / 10; };
const r3 = function (x) { return Math.round(x * 1000) / 1000; };

function nomeDaFaixa(i) {
  return FAIXAS[i] / K + '-' + (i + 1 < FAIXAS.length ? FAIXAS[i + 1] / K : '+') + 'K';
}

function resumoDasParadas(sessoes) {
  const todas = [];
  let perguntas = 0;
  for (const s of sessoes) { perguntas += s.perguntas; for (const p of s.paradas) todas.push(p); }
  const classes = CLASSES_DE_PARADA.map(function (c) { return c[0]; }).concat([OUTRA]);
  return {
    total: todas.length,
    perguntasDeMultiplaEscolha: perguntas,
    porClasse: classes.map(function (classe) {
      const estas = todas.filter(function (p) { return p.classe === classe; });
      const esperas = estas.map(function (p) { return p.espera; }).filter(function (m) { return m >= 0 && m < 24 * 60; });
      return { classe: classe, paradas: estas.length, pct: todas.length ? Math.round(100 * estas.length / todas.length) : 0,
        esperaMedianaMin: esperas.length ? r1(mediana(esperas)) : null };
    })
  };
}

/** O relatorio inteiro. `opcoes.limiarAtual`: o que o projeto.json do projeto usa hoje (padrao, sem ele). */
function calibrar(sessoes, opcoes) {
  const o = opcoes || {};
  const segs = segmentar(sessoes);
  const todas = [];
  for (const g of segs) for (const c of g.chamadas) todas.push(c);
  const total = soma(todas);
  const datas = sessoes.map(function (s) { return s.chamadas[0] && s.chamadas[0].t; }).filter(function (t) { return t > 0; }).sort();
  const dia = function (t) { return t ? new Date(t).toISOString().slice(0, 10) : null; };
  const alcance = function (T) { return segs.filter(function (g) { return g.chamadas.some(function (c) { return c.C >= T; }); }).length; };

  const faixas = FAIXAS.map(function (de, i) {
    const ate = i + 1 < FAIXAS.length ? FAIXAS[i + 1] : Infinity;
    const estas = todas.filter(function (c) { return c.C >= de && c.C < ate; });
    const custo = soma(estas);
    return { faixa: nomeDaFaixa(i), chamadas: estas.length, pctCusto: total ? r1(100 * custo / total) : 0,
      custoPorChamada: estas.length ? r3(custo / estas.length) : null };
  });

  const troca = custoDaTroca(sessoes);
  const linhas = CANDIDATOS.map(function (T) {
    const x = simular(segs, T, troca.custo, troca.recomeco);
    return { T: T, conversasQueAlcancam: alcance(T), trocas: x.trocas, delta: x.delta };
  });

  const padrao = LIMIARES_PADRAO.tokensDeContexto;
  const noPadrao = alcance(padrao);
  let sugestao;
  if (sessoes.length < AMOSTRA_MINIMA.sessoes || noPadrao < AMOSTRA_MINIMA.conversasNoPadrao || !(total > 0)) {
    sugestao = { tokensDeContexto: padrao, suficiente: false,
      motivo: 'amostra pequena: ' + sessoes.length + ' sessoes (minimo ' + AMOSTRA_MINIMA.sessoes + ') e ' + noPadrao +
        ' conversas chegaram a ' + padrao + ' (minimo ' + AMOSTRA_MINIMA.conversasNoPadrao + '); fica o padrao do plugin' };
  } else {
    sugestao = Object.assign({ suficiente: true }, escolher(linhas));
  }

  return {
    amostra: { sessoes: sessoes.length, chamadas: todas.length, de: dia(datas[0]), ate: dia(datas[datas.length - 1]),
      custoTotalUS$: Math.round(total * 100) / 100 },
    custoPorFaixa: faixas,
    troca: { custoUS$: Math.round(troca.custo * 100) / 100, recomeco: Math.round(troca.recomeco), medida: troca.medida,
      aberturasMedidas: troca.aberturasMedidas, handoffsMedidos: troca.handoffsMedidos },
    simulacao: linhas.map(function (l) {
      return { limiar: l.T, conversasQueAlcancam: l.conversasQueAlcancam, trocas: l.trocas,
        pctDoCusto: total ? r1(100 * l.delta / total) : 0 };
    }),
    limiarAtual: typeof o.limiarAtual === 'number' ? o.limiarAtual : padrao,
    sugestao: sugestao,
    paradas: resumoDasParadas(sessoes)
  };
}

/** A regra do Claude Code para a pasta do projeto em `projects/`: todo caractere fora de letra e numero vira hifen. */
function nomeDaPasta(raiz) {
  return path.resolve(raiz).replace(/[^A-Za-z0-9]/g, '-');
}

/**
 * `<CLAUDE_CONFIG_DIR ou ~/.claude>/projects/<nomeDaPasta(raiz)>`, sem diferenciar maiuscula (o VS Code manda a
 * letra da unidade minuscula). Sem a pasta: null, e quem chama pede `--pasta`.
 */
function pastaDasTranscricoes(raiz, env, casa) {
  const e = env || process.env;
  const projetos = path.join(e.CLAUDE_CONFIG_DIR || path.join(casa || os.homedir(), '.claude'), 'projects');
  const nome = nomeDaPasta(raiz).toLowerCase();
  let subs;
  try { subs = fs.readdirSync(projetos, { withFileTypes: true }); } catch (x) { return null; }
  const achada = subs.filter(function (s) { return s.isDirectory() && s.name.toLowerCase() === nome; })[0];
  return achada ? path.join(projetos, achada.name) : null;
}

module.exports = { PRECOS, FAIXAS, CANDIDATOS, AMOSTRA_MINIMA, TROCA_PADRAO, lerSessao, lerPasta, segmentar, custoDaTroca,
  simular, escolher, calibrar, nomeDaPasta, pastaDasTranscricoes };
