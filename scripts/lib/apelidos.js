'use strict';
const degrausLib = require('./degraus.js');
const fs = require('node:fs');
const path = require('node:path');
const agentesLib = require('./agentes.js');
const { ascii } = require('./escopo.js');

/** Cada linha com o terminador que ela tem de verdade. Existe para que a
 *  correcao troque UMA linha e devolva o resto do arquivo byte a byte igual:
 *  normalizar fim de linha aqui reescreveria linhas que ninguem pediu para
 *  mexer, num arquivo que e trabalho de outra pessoa. */
const RE_LINHA = /[^\n]*\n|[^\n]+$/g;
const CERCA = /^---\s*$/;
const RE_MODEL = /^model:/;

function semTerminador(linha) {
  return String(linha).replace(/\r?\n$/, '');
}

function mapaDeDegraus(projeto) {
  const a = (projeto && projeto.agentes) || {};
  const lista = degrausLib.normalizar(a.degraus);
  const porNome = Object.create(null);
  const esforcoPorNome = Object.create(null);
  for (const d of lista) {
    porNome[d.agente] = d.apelido;
    if (d.esforco !== undefined) esforcoPorNome[d.agente] = d.esforco;
  }
  return { lista: lista, porNome: porNome, esforcoPorNome: esforcoPorNome };
}

/**
 * Compara o `model:` que cada agente declara no disco com o apelido que a
 * entrevista gravou. Offline, deterministico, sem tocar a rede e sem nome de
 * modelo nenhum no plugin: os dois lados vem do projeto da pessoa.
 *
 * Quatro baldes, porque tratar tudo como "divergencia" produz achado falso:
 *   divergencia  - os dois lados existem e discordam. E SO este que acusa.
 *   naoDeclarado - o arquivo nao diz `model:`. Ausente e vazio sao a MESMA
 *                  resposta: nao declarado. Nao e divergir (foco de revisao 4).
 *   semArquivo   - ha degrau gravado e nao ha arquivo de agente com esse nome.
 *   foraDoMapa   - ha arquivo de agente que a escada nao menciona.
 *
 * D678 T1: o `effort:` contra o esforco do degrau, com a mesma separacao, em baldes proprios
 * (`esforcoDivergente`, `esforcoNaoDeclarado`) - o conserto do modelo nao pode receber um esforco.
 * Degrau sem esforco gravado nao compara: e a configuracao de antes.
 */
function conferir(projeto, lidos) {
  const vazio = {
    verificavel: false, motivo: null,
    divergencias: [], naoDeclarados: [], semArquivo: [], foraDoMapa: [],
    esforcoDivergente: [], esforcoNaoDeclarado: []
  };
  const mapa = mapaDeDegraus(projeto);

  if (!lidos || lidos.existe !== true) {
    vazio.motivo = 'este projeto nao tem a pasta .claude/agents: nao ha `model:` para conferir';
    return vazio;
  }
  if (mapa.lista.length === 0) {
    vazio.motivo = 'este projeto nao tem apelidos gravados: a conferencia nao tem contra o que comparar';
    return vazio;
  }

  const r = {
    verificavel: true, motivo: null,
    divergencias: [], naoDeclarados: [], semArquivo: [], foraDoMapa: [],
    esforcoDivergente: [], esforcoNaoDeclarado: []
  };
  const vistos = Object.create(null);

  for (const ag of (lidos.agentes || [])) {
    vistos[ag.nome] = true;
    const gravado = mapa.porNome[ag.nome];
    if (gravado === undefined) {
      r.foraDoMapa.push({ agente: ag.nome, arquivo: ag.arquivo, declarado: ag.model });
      continue;
    }
    const esforco = mapa.esforcoPorNome[ag.nome];
    if (esforco !== undefined) {
      if (ag.effort === null || ag.effort === undefined || ag.effort === '') {
        r.esforcoNaoDeclarado.push({ agente: ag.nome, arquivo: ag.arquivo, gravado: esforco });
      } else if (ag.effort !== esforco) {
        r.esforcoDivergente.push({ agente: ag.nome, arquivo: ag.arquivo, declarado: ag.effort, gravado: esforco });
      }
    }
    if (ag.model === null || ag.model === undefined || ag.model === '') {
      r.naoDeclarados.push({ agente: ag.nome, arquivo: ag.arquivo, gravado: gravado });
      continue;
    }
    if (ag.model !== gravado) {
      r.divergencias.push({
        agente: ag.nome, arquivo: ag.arquivo, declarado: ag.model, gravado: gravado
      });
    }
  }
  for (const d of mapa.lista) {
    if (!vistos[d.agente]) r.semArquivo.push({ agente: d.agente, gravado: d.apelido });
  }
  return r;
}

/**
 * Troca um campo do frontmatter (`model` ou, desde a D678, `effort`), preservando o resto do arquivo.
 * Recusa em vez de adivinhar nos tres casos em que adivinhar estragaria o
 * arquivo de alguem: sem cerca, cerca que nunca fecha, e mais de uma linha do campo
 * dentro do frontmatter. Sem a linha, ela e ACRESCENTADA - "nao declarado"
 * tambem se conserta.
 */
function trocarCampo(bruto, campo, valor) {
  // O nome vira RegExp: so o formato de chave que o frontmatter() le (agentes.js:48), sem metacaractere.
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(String(campo))) {
    return { ok: false, texto: null, motivo: 'campo "' + campo + '" fora do formato de chave do frontmatter' };
  }
  const reCampo = new RegExp('^' + campo + ':');
  const texto = String(bruto == null ? '' : bruto);
  const bom = texto.charCodeAt(0) === 0xFEFF ? '\uFEFF' : '';
  const corpo = texto.slice(bom.length);
  const linhas = corpo.match(RE_LINHA) || [];

  if (linhas.length === 0 || !CERCA.test(semTerminador(linhas[0]))) {
    return { ok: false, texto: null, motivo: 'o arquivo nao comeca com frontmatter' };
  }
  let fim = -1;
  const alvos = [];
  for (let i = 1; i < linhas.length; i++) {
    const nua = semTerminador(linhas[i]);
    if (CERCA.test(nua)) { fim = i; break; }
    if (reCampo.test(nua)) alvos.push(i);
  }
  if (fim === -1) {
    return { ok: false, texto: null, motivo: 'a cerca do frontmatter abre e nunca fecha' };
  }
  if (alvos.length > 1) {
    return { ok: false, texto: null, motivo: 'ha ' + alvos.length + ' linhas `' + campo + ':` no frontmatter: nao da para saber qual e a certa' };
  }

  const copia = linhas.slice();
  if (alvos.length === 1) {
    const i = alvos[0];
    const terminador = linhas[i].slice(semTerminador(linhas[i]).length);
    copia[i] = campo + ': ' + valor + terminador;
  } else {
    // Sem a linha do campo: entra como ultima do frontmatter, com o mesmo
    // terminador da linha da cerca de fecho - para nao misturar CRLF com LF.
    const terminador = linhas[fim].slice(semTerminador(linhas[fim]).length) || '\n';
    copia.splice(fim, 0, campo + ': ' + valor + terminador);
  }
  return { ok: true, texto: bom + copia.join(''), motivo: null };
}

function trocarModel(bruto, apelido) { return trocarCampo(bruto, 'model', apelido); }

// Plano 082, Tarefa 5 (mock S10): a forma unica dos avisos. "gatilho 3" e nome interno: a 1a linha diz o que falta.
// As DUAS direcoes possiveis: o hook nao tem como saber qual lado envelheceu; quem sabe e o dono, e por isso a
// correcao se oferece, nunca se aplica so. Plano 083 (p6-4): a correcao() que montava as duas frases nao tinha
// chamador; os valores de cada lado saem por agente, logo abaixo.
function motivo(r) {
  const linhas = [
    'sworn - o modelo ou o esforco de alguns agentes nao bate com o mapa deste projeto.',
    '',
    'Estes agentes declaram um modelo (`model:`) ou um esforco (`effort:`) diferente do que a entrevista',
    'gravou no mapa (campo "agentes" de .claude/sworn/projeto.json):'
  ];
  // A1-08: nome e arquivo vem do dono e podem ter acento; o aviso sai em ASCII (R5), e o nome sem acento nao e o real.
  let mudou = false;
  const a = function (v) { const s = ascii(v); if (s !== String(v)) mudou = true; return s; };
  for (const d of r.divergencias) {
    linhas.push('  - "' + a(d.agente) + '" em ".claude/agents/' + a(d.arquivo) + '"');
    linhas.push('      o arquivo diz: ' + a(d.declarado));
    linhas.push('      o mapa diz:    ' + a(d.gravado));
  }
  for (const d of (r.esforcoDivergente || [])) {
    linhas.push('  - "' + a(d.agente) + '" em ".claude/agents/' + a(d.arquivo) + '"');
    linhas.push('      o arquivo diz: effort: ' + a(d.declarado));
    linhas.push('      o mapa diz:    esforco ' + a(d.gravado));
  }
  if (mudou) linhas.push('Nome com acento ou caractere especial sai aqui sem acento: use o nome real, do arquivo do agente.');
  linhas.push('Nada foi bloqueado: um dos dois lados ficou velho, e so o dono sabe qual.');
  linhas.push('');
  linhas.push('Faca uma destas para cada agente, com a escolha do dono:');
  linhas.push('  1. o arquivo passa a dizer o que o mapa diz;');
  linhas.push('  2. o mapa passa a dizer o que o arquivo diz.');
  return linhas.join('\n');
}

/**
 * Os agentes que o PROPRIO plugin publica em agents/, com o que cada um declara.
 *
 * Decisao 29: o `inspector` guarda um apelido de modelo DENTRO do plugin - a
 * unica excecao declarada a regra de nao guardar nome de modelo. Por isso ele
 * entra na sondagem do H4 como os apelidos do projeto entram; sem isso, o
 * /sworn:review quebraria em silencio no dia em que o apelido mudar.
 *
 * Le a pasta de verdade, nao uma lista: agente novo no plugin entra sozinho, e
 * os campos sao os que o frontmatter de cada um declara. Sem pasta, lista vazia.
 */
function agentesDoPlugin(dir) {
  const pasta = dir || path.join(__dirname, '..', '..', 'agents');
  let nomes;
  try {
    nomes = fs.readdirSync(pasta).filter(function (n) { return n.endsWith('.md'); }).sort();
  } catch (e) {
    return [];
  }
  const lista = [];
  for (const arquivo of nomes) {
    let bruto = '';
    try { bruto = fs.readFileSync(path.join(pasta, arquivo), 'utf8'); } catch (e) { continue; }
    const f = agentesLib.frontmatter(bruto);
    if (!f.ok) continue;
    lista.push({
      agente: f.campos.name || arquivo.replace(/\.md$/, ''),
      arquivo: arquivo,
      apelido: f.campos.model || '',
      campos: Object.keys(f.campos)
    });
  }
  return lista;
}

/**
 * O que a sondagem de apelidos vivos (H4) cobre NESTE projeto, agora.
 *
 * A comparacao e contra o MAPA ATUAL, nunca contra uma data. Carimbo de
 * validade foi recusado, e com razao: data e resultado, e resultado apodrece.
 * Apelido que entrou no mapa depois da ultima sondagem nao esta "vencido" -
 * esta NAO PROVADO, que e outra coisa e se DECLARA em vez de reprovar.
 *
 * Os dois desfechos nao se confundem, e e nisso que o H4 se fecha:
 *   naoProvado - ninguem sondou. Declara-se; nao reprova.
 *   reprovado  - sondou-se e o apelido NAO foi aceito. Reprova alto.
 *
 * `doPlugin` e opcional: o que agentesDoPlugin() devolve. O apelido que o
 * proprio plugin publica (decisao 29) entra na MESMA conta, sem repetir - e,
 * no repositorio do plugin, que nao tem projeto.json, e ele o que se sonda.
 */
function cobertura(projeto, prova, doPlugin) {
  const mapa = mapaDeDegraus(projeto);
  const lista = [];
  for (const d of mapa.lista) {
    if (d.apelido !== '' && lista.indexOf(d.apelido) === -1) lista.push(d.apelido);
  }
  for (const a of (Array.isArray(doPlugin) ? doPlugin : [])) {
    if (a && typeof a.apelido === 'string' && a.apelido !== '' && lista.indexOf(a.apelido) === -1) {
      lista.push(a.apelido);
    }
  }
  const r = {
    temProva: false, apelidos: lista,
    provados: [], naoProvados: lista.slice(), reprovados: [], camposReprovados: []
  };
  if (!prova || typeof prova !== 'object' || !Array.isArray(prova.apelidos)) return r;

  r.temProva = true;
  r.naoProvados = [];
  const porNome = Object.create(null);
  for (const p of prova.apelidos) {
    if (p && typeof p === 'object' && typeof p.apelido === 'string') porNome[p.apelido] = p;
  }
  for (const a of lista) {
    const p = porNome[a];
    if (!p) { r.naoProvados.push(a); continue; }
    if (p.aceito === true) r.provados.push(a);
    else r.reprovados.push({ apelido: a, evidencia: p.evidencia || '(sem evidencia)' });
  }
  for (const c of (Array.isArray(prova.campos) ? prova.campos : [])) {
    if (c && typeof c === 'object' && c.aceito !== true) {
      r.camposReprovados.push({ campo: c.campo, evidencia: c.evidencia || '(sem evidencia)' });
    }
  }
  return r;
}

/** A mensagem que o teste do H4 cospe ao reprovar. Nomeia o que morreu. */
function motivoReprovado(c) {
  const linhas = ['apelido ou campo deixou de valer - a sondagem provou, nao supos:'];
  for (const x of c.reprovados) {
    linhas.push('  - apelido "' + x.apelido + '" nao foi aceito: ' + x.evidencia);
  }
  for (const x of c.camposReprovados) {
    linhas.push('  - campo "' + x.campo + '" nao foi aceito: ' + x.evidencia);
  }
  linhas.push('');
  linhas.push('Isto NAO se conserta afrouxando o teste. Ou o apelido mudou de nome,');
  linhas.push('ou o campo saiu do frontmatter: rode a entrevista e sonde de novo.');
  return linhas.join('\n');
}

module.exports = {
  RE_LINHA, CERCA, RE_MODEL, mapaDeDegraus, conferir, trocarCampo, trocarModel, motivo,
  agentesDoPlugin, cobertura, motivoReprovado
};
