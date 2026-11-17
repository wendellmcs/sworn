'use strict';
// D678 T5 (plano da escada, par.3 linha 41): o modelo e o esforco que DE FATO responderam, por agente, lidos das
// transcricoes dos subagentes. E a prova de que a tabela (`agentes.degraus`) vale na pratica, e o aviso de quando um
// apelido passa a responder com outro id (o `sonnet` que virou `-6` sem ninguem mudar a tabela).
//
// Forma vista nas transcricoes reais (s173; o Claude Code nao documenta o formato):
//   <projeto>/<sessao>/subagents/agent-<id>.jsonl (e o agente de workflow em subagents/workflows/<run>/, A6), linha
//   {type:"assistant", attributionAgent, effort, timestamp, message:{model}}. `<synthetic>` e o modelo das respostas que o proprio Claude Code escreve: fica de fora.
// Binario sem `effort` na linha (2.1.258) da esforco "nao sei", nunca divergencia.
const fs = require('node:fs');
const path = require('node:path');
const degrausLib = require('./degraus.js');
const gasto = require('./gasto.js');

const DIA_MS = 24 * 60 * 60 * 1000;
const DIAS = 30;
// Os apelidos que o `model:` do agente e o parametro do Agent aceitam (sondas run6-15 da escada).
const APELIDOS = ['opus', 'sonnet', 'haiku', 'fable'];
const NOTA = 'o formato da transcricao nao e documentado pelo Claude Code e pode mudar entre versoes';

/** O apelido de um id de modelo ('claude-sonnet-5-5' -> 'sonnet'); id sem apelido conhecido da ''. */
function apelidoDoId(id) {
  if (typeof id !== 'string') return '';
  return id.toLowerCase().split('-').find(function (p) { return APELIDOS.indexOf(p) !== -1; }) || '';
}

function contar(mapa, chave) {
  mapa.set(chave, (mapa.get(chave) || 0) + 1);
}

// A6-57: a transcricao se le em blocos, linha a linha. Um arquivo de centenas de MB nao vira uma string so (o V8 recusa
// string acima de ~512 MB, e o arquivo inteiro virava ilegivel) nem fica todo na memoria. A linha acima do teto e
// pulada sem juntar o resto dela: uma resposta do modelo tem bem menos que isso.
const BLOCO = 1024 * 1024;
const TETO_DA_LINHA = 64 * 1024 * 1024;

function inteiroPositivo(v, padrao) {
  return Number.isInteger(v) && v > 0 ? v : padrao;
}

/**
 * Chama `fn` com cada linha do arquivo (sem o \n), lendo `bloco` bytes por vez; devolve quantas linhas passaram do
 * `teto` e ficaram de fora. O erro de leitura sobe.
 */
function cadaLinha(arquivo, fn, bloco, teto) {
  const fd = fs.openSync(arquivo, 'r');
  try {
    const buf = Buffer.alloc(bloco);
    let partes = []; // o comeco da linha que ainda nao terminou, copiado dos blocos de antes
    let tamanho = 0;
    let pulando = false;
    let longas = 0;
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      const v = buf.subarray(0, n);
      let ini = 0;
      let fim;
      while ((fim = v.indexOf(10, ini)) !== -1) {
        // o teto vale para a linha inteira, tambem a que comeca e termina no mesmo bloco
        if (!pulando && tamanho + (fim - ini) <= teto) {
          partes.push(v.subarray(ini, fim));
          fn(Buffer.concat(partes).toString('utf8'));
        } else longas++;
        partes = [];
        tamanho = 0;
        pulando = false;
        ini = fim + 1;
      }
      if (ini < n && !pulando) {
        tamanho += n - ini;
        if (tamanho > teto) { pulando = true; partes = []; tamanho = 0; }
        else partes.push(Buffer.from(v.subarray(ini))); // copia: o proximo readSync reescreve o buf
      }
    }
    if (pulando) longas++;
    else if (partes.length) fn(Buffer.concat(partes).toString('utf8'));
    return longas;
  } finally {
    fs.closeSync(fd);
  }
}

/** A resposta de subagente da linha ({ agente, modelo, esforco, quando }), ou null quando a linha nao e uma. */
function respostaDaLinha(l) {
  if (l.indexOf('"assistant"') === -1) return null;
  let r;
  try { r = JSON.parse(l); } catch (e) { return null; }
  const modelo = r && r.type === 'assistant' && r.message ? r.message.model : null;
  if (typeof r.attributionAgent !== 'string' || !r.attributionAgent || typeof modelo !== 'string' || !modelo ||
    modelo === '<synthetic>') return null;
  return { agente: r.attributionAgent, modelo: modelo, quando: Date.parse(r.timestamp),
    esforco: typeof r.effort === 'string' && r.effort ? r.effort : null };
}

/**
 * As respostas dos subagentes da pasta de projeto `dir` (a pasta da transcricao, em <config>/projects/), so dos
 * arquivos mexidos nos ultimos `dias` (30). Devolve { dias, arquivos, ilegiveis, linhasLongas, agentes, ids }:
 * `ilegiveis` = os arquivos que nao se leram (o agente deles pode sair "nao sei"); `linhasLongas` = as linhas acima do
 * teto, puladas nos arquivos que se leram (a resposta que estivesse numa delas ficou fora da conta); `agentes[nome]` = { respostas, modelos: {id: n},
 * esforcos: {nivel: n}, ultimo: {modelo, esforco, quando} }; `ids[id]` = { apelido, desde, ate } (ms).
 * `opcoes.bloco` e `opcoes.tetoDaLinha` (bytes, inteiros positivos) trocam o tamanho da leitura e o teto da linha
 * (os testes os encolhem); sem eles, BLOCO e TETO_DA_LINHA.
 */
function medir(dir, opcoes) {
  const o = opcoes || {};
  const agora = Number.isFinite(o.agora) ? o.agora : Date.now();
  const dias = Number.isFinite(o.dias) && o.dias > 0 ? o.dias : DIAS;
  const desde = agora - dias * DIA_MS;
  const bloco = inteiroPositivo(o.bloco, BLOCO);
  const teto = inteiroPositivo(o.tetoDaLinha, TETO_DA_LINHA);
  const agentes = new Map();
  const ids = new Map();
  let arquivos = 0;
  let ilegiveis = 0;
  let linhasLongas = 0;
  for (const a of gasto.arquivosDoProjeto(dir)) {
    if (!a.subagente) continue;
    // as respostas do arquivo so entram na conta depois que ele se leu inteiro: o erro no meio nao deixa metade dele
    const respostas = [];
    let longas;
    try {
      if (fs.statSync(a.arquivo).mtimeMs < desde) continue;
      longas = cadaLinha(a.arquivo, function (l) {
        const r = respostaDaLinha(l);
        if (r) respostas.push(r);
      }, bloco, teto);
    } catch (e) { ilegiveis++; continue; }
    arquivos++;
    linhasLongas += longas;
    for (const { agente, modelo, quando, esforco } of respostas) {
      let ag = agentes.get(agente);
      if (!ag) agentes.set(agente, ag = { respostas: 0, modelos: new Map(), esforcos: new Map(), ultimo: null });
      ag.respostas++;
      contar(ag.modelos, modelo);
      if (esforco) contar(ag.esforcos, esforco);
      // resposta sem data so vira a ultima se a de antes tambem nao tinha data
      const u = ag.ultimo;
      if (!u || !Number.isFinite(u.ms) || quando >= u.ms) ag.ultimo = { modelo: modelo, esforco: esforco, ms: quando };
      if (!Number.isFinite(quando)) continue;
      const v = ids.get(modelo);
      if (!v) ids.set(modelo, { apelido: apelidoDoId(modelo), desde: quando, ate: quando });
      else { v.desde = Math.min(v.desde, quando); v.ate = Math.max(v.ate, quando); }
    }
  }
  const saida = {};
  for (const [nome, ag] of agentes) {
    const u = ag.ultimo;
    saida[nome] = {
      respostas: ag.respostas,
      modelos: Object.fromEntries(ag.modelos),
      esforcos: Object.fromEntries(ag.esforcos),
      ultimo: { modelo: u.modelo, esforco: u.esforco, quando: Number.isFinite(u.ms) ? new Date(u.ms).toISOString() : null }
    };
  }
  return { dias: dias, arquivos: arquivos, ilegiveis: ilegiveis, linhasLongas: linhasLongas, agentes: saida,
    ids: Object.fromEntries(ids) };
}

// o passo da divergencia: ou o agente roda com outra configuracao, ou a tabela ficou velha
const DIVERGIU = '; confira o arquivo do agente (ele manda no que roda) ou acerte o degrau em agentes.degraus do ' +
  '.claude/sworn/projeto.json';

/**
 * Cada degrau da tabela contra a ultima resposta do agente: `confere` true, false (com o `motivo`: modelo ou esforco)
 * ou null ("nao sei": sem resposta na janela, transcricao sem `effort`, apelido fora dos conhecidos). Degrau sem
 * esforco gravado compara so o modelo: e a configuracao de antes (apelidos.js, conferir).
 */
function cruzar(medida, degraus) {
  const agentes = (medida && medida.agentes) || {};
  const janela = medida && medida.dias ? 'nenhuma resposta deste agente nos ultimos ' + medida.dias + ' dias' : 'nada medido';
  return degrausLib.normalizar(degraus).map(function (d) {
    const linha = { agente: d.agente, apelido: d.apelido, esforco: d.esforco === undefined ? null : d.esforco,
      efetivo: null, confere: null, motivo: null };
    if (!Object.prototype.hasOwnProperty.call(agentes, d.agente)) {
      linha.motivo = janela + ': nao sei se a tabela vale para ele; chame o agente uma vez e rode a auditoria de novo';
      return linha;
    }
    const u = agentes[d.agente].ultimo;
    linha.efetivo = { modelo: u.modelo, esforco: u.esforco };
    const pedido = d.apelido.toLowerCase();
    if (APELIDOS.indexOf(pedido) === -1) {
      linha.motivo = 'o apelido "' + d.apelido + '" nao e nenhum de ' + APELIDOS.join(', ') + ': nao sei comparar o modelo';
    } else if (apelidoDoId(u.modelo) !== pedido) {
      linha.confere = false;
      linha.motivo = 'modelo: a tabela pede ' + d.apelido + ' e respondeu ' + u.modelo + DIVERGIU;
    } else if (d.esforco === undefined) {
      linha.confere = true;
    } else if (!u.esforco) {
      linha.motivo = 'a transcricao nao traz o esforco (o Claude Code que a gravou ainda nao registrava o esforco): ' +
        'nao sei; atualize o Claude Code e chame o agente de novo';
    } else {
      linha.confere = u.esforco === d.esforco;
      if (!linha.confere) linha.motivo = 'esforco: a tabela pede ' + d.esforco + ' e respondeu ' + u.esforco + DIVERGIU;
    }
    return linha;
  });
}

/**
 * O apelido que passou a responder com outro id, do mais velho para o mais novo: dentro de um apelido, os ids pela
 * primeira resposta; ha troca quando o anterior parou de responder antes do seguinte comecar. Dois ids que seguem
 * respondendo juntos (um agente preso a um id antigo) nao sao troca.
 */
function trocas(medida) {
  const porApelido = new Map();
  for (const [id, v] of Object.entries((medida && medida.ids) || {})) {
    if (!v.apelido) continue;
    if (!porApelido.has(v.apelido)) porApelido.set(v.apelido, []);
    porApelido.get(v.apelido).push({ id: id, desde: v.desde, ate: v.ate });
  }
  const saida = [];
  for (const [apelido, lista] of porApelido) {
    lista.sort(function (a, b) { return a.desde - b.desde; });
    for (let i = 1; i < lista.length; i++) {
      if (lista[i - 1].ate > lista[i].desde) continue;
      saida.push({ apelido: apelido, de: lista[i - 1].id, para: lista[i].id, desde: lista[i].desde });
    }
  }
  return saida.sort(function (a, b) { return a.desde - b.desde; })
    .map(function (t) { return { apelido: t.apelido, de: t.de, para: t.para, desde: new Date(t.desde).toISOString() }; });
}

/**
 * A chave `efetivo` da auditoria. `alvo` e o que o injetado.localizar devolve: { caminho } da transcricao (a pasta
 * dela guarda as conversas deste projeto) ou { causa, motivo }. `foraDaTabela`: agentes que responderam e nao estao
 * nos degraus (os do plugin, por exemplo), com a ultima resposta.
 */
function daAuditoria(alvo, projeto, agora) {
  if (!alvo || typeof alvo.caminho !== 'string' || !alvo.caminho) {
    return { medido: false, motivo: (alvo && typeof alvo.motivo === 'string' && alvo.motivo) ||
      'nao medido: sem a transcricao da sessao nao ha como achar a pasta das conversas deste projeto; passe ' +
      '--transcricao com o caminho do .jsonl de uma delas', nota: NOTA };
  }
  const medida = medir(path.dirname(alvo.caminho), { agora: agora });
  const tabela = cruzar(medida, projeto && projeto.agentes && projeto.agentes.degraus);
  const naTabela = new Set(tabela.map(function (l) { return l.agente; }));
  return {
    medido: true,
    pasta: path.dirname(alvo.caminho),
    dias: medida.dias,
    arquivos: medida.arquivos,
    ilegiveis: medida.ilegiveis,
    linhasLongas: medida.linhasLongas,
    tabela: tabela,
    foraDaTabela: Object.keys(medida.agentes).filter(function (n) { return !naTabela.has(n); }).map(function (n) {
      const a = medida.agentes[n];
      return { agente: n, modelo: a.ultimo.modelo, esforco: a.ultimo.esforco, respostas: a.respostas };
    }),
    trocas: trocas(medida),
    nota: NOTA
  };
}

module.exports = { apelidoDoId, medir, cruzar, trocas, daAuditoria };
