'use strict';
const regraLib = require('./regra.js');

const RE_SLOT = /\{\{(campo|texto):([A-Za-z][A-Za-z0-9_.]*)\}\}/g;
const MARCA = 'POR PREENCHER';

function slots(texto) {
  const achados = [];
  const re = new RegExp(RE_SLOT.source, 'g');
  let m;
  while ((m = re.exec(String(texto == null ? '' : texto))) !== null) {
    achados.push({ bruto: m[0], tipo: m[1], nome: m[2] });
  }
  return achados;
}

function existeCampo(projeto, nome) {
  let atual = projeto;
  for (const parte of String(nome).split('.')) {
    if (!atual || typeof atual !== 'object' || !(parte in atual)) return false;
    atual = atual[parte];
  }
  return true;
}

/**
 * D10: fatia de campo NUNCA imprime o valor. Imprime o caminho de onde le-lo.
 * Comando, versao e flag mudam; nome de campo nao.
 */
function preencher(moldeTexto, valores, projeto) {
  const v = valores || {};
  const molde = String(moldeTexto == null ? '' : moldeTexto);
  const fimCabecalho = fimDoFrontmatter(molde);
  const cabecalho = molde.slice(0, fimCabecalho);
  const corpo = molde.slice(fimCabecalho);

  // Devolve o texto da fatia e se ele e uma marca de "por preencher" (marca nunca e citada).
  function fatia(tipo, nome, noCabecalho) {
    if (tipo === 'campo') {
      if (!existeCampo(projeto, nome)) return { texto: '(' + MARCA + ': campo ' + nome + ' nao existe em projeto.json)', marca: true };
      return { texto: '`' + nome + '` de `.claude/sworn/projeto.json` (leia de la, nao decore)', marca: false };
    }
    const resposta = v[nome];
    if (typeof resposta !== 'string' || resposta.trim() === '') {
      return { texto: '(' + MARCA + ': ' + nome + ')', marca: true };
    }
    // D420/IN-06: no cabecalho cada fatia mora numa linha so. Quebra de linha
    // fecha o frontmatter antes da hora e joga model/tools/maxTurns para o
    // corpo (agente so-leitura herda TODAS as ferramentas). Vira marca de
    // fatia por preencher, que o validar ja recusa - sem excecao nova.
    if (noCabecalho && /[\r\n]/.test(resposta.trim())) {
      return { texto: '(' + MARCA + ': ' + nome + ' tem quebra de linha e no cabecalho do agente o valor cabe numa linha so)', marca: true };
    }
    return { texto: resposta.trim(), marca: false };
  }

  const re = new RegExp(RE_SLOT.source, 'g');
  const noCorpo = corpo.replace(re, function (bruto, tipo, nome) { return fatia(tipo, nome, false).texto; });

  // H-5b: no frontmatter, linha `chave: valor` com fatia respondida e valor que o YAML
  // leria torto sai com o valor INTEIRO da linha citado (nao so o pedaco da fatia).
  const partes = cabecalho.split(/(\r\n|\n|\r)/);
  for (let i = 0; i < partes.length; i += 2) {
    let marca = false;
    let tocou = false;
    const linha = partes[i].replace(re, function (bruto, tipo, nome) {
      const f = fatia(tipo, nome, true);
      if (f.marca) marca = true; else tocou = true;
      return f.texto;
    });
    const m = /^([ \t]*[A-Za-z][A-Za-z0-9_-]*:[ \t]*)(.*)$/.exec(linha);
    partes[i] = (tocou && !marca && m && precisaCitar(m[2])) ? m[1] + citar(m[2]) : linha;
  }
  return partes.join('') + noCorpo;
}

/** Valor que o YAML leria torto como escalar simples: `: `, ` #`, `:` no fim ou indicador no comeco. */
function precisaCitar(valor) {
  return /^[-?:\[\]{},#&*!|>'"%@`]/.test(valor) || /:(?:\s|$)/.test(valor) || /\s#/.test(valor);
}

/** Aspas duplas com `\\` e `\"` escapados - o formato que agentes.js desfaz ao ler (H-5). */
function citar(valor) {
  return '"' + valor.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/** Posicao onde o frontmatter do molde termina (0 se o molde nao abre com cerca). */
function fimDoFrontmatter(molde) {
  const abre = /^---[ \t]*\r?\n/.exec(molde);
  if (!abre) return 0;
  const fecha = /\r?\n---[ \t]*(?:\r?\n|$)/.exec(molde.slice(abre[0].length));
  return fecha ? abre[0].length + fecha.index : molde.length;
}

function validar(resultado) {
  const texto = String(resultado == null ? '' : resultado);
  const erros = [];

  const restantes = slots(texto);
  for (const s of restantes) erros.push('fatia nao substituida: ' + s.bruto);

  const re = new RegExp('\\(' + MARCA + ':([^)]*)\\)', 'g');
  let m;
  while ((m = re.exec(texto)) !== null) erros.push('fatia por preencher:' + m[1]);

  // D10: nenhum fato volatil no que veio da entrevista.
  for (const linha of texto.split(/\r?\n/)) {
    for (const vol of regraLib.VOLATEIS) {
      if (vol.re.test(linha)) {
        erros.push('fato volatil (' + vol.tipo + ') na linha: ' + linha.trim().slice(0, 70));
        break;
      }
    }
  }

  return { ok: erros.length === 0, erros: erros };
}

module.exports = { RE_SLOT, MARCA, slots, preencher, validar };
