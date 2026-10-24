'use strict';
const fs = require('node:fs');
const path = require('node:path');
const texto = require('./texto.js');

const PASTA = ['.claude', 'agents'];
const CERCA = /^---\s*$/;

/**
 * H-5: valor entre aspas desfaz o escape do YAML (`\"` e `\\` nas duplas, `''` nas simples).
 * So quando o valor inteiro e uma citacao bem formada; fora disso so tira as aspas das pontas,
 * como sempre fez. Valor sem aspas segue cru.
 */
function desfazerCitacao(v) {
  if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') {
    const dentro = v.slice(1, -1);
    if (/^(?:[^"\\]|\\.)*$/.test(dentro)) return dentro.replace(/\\(["\\])/g, '$1');
  }
  if (v.length >= 2 && v[0] === "'" && v[v.length - 1] === "'") {
    const dentro = v.slice(1, -1);
    if (/^(?:[^']|'')*$/.test(dentro)) return dentro.replace(/''/g, "'");
  }
  return v.replace(/^['"]/, '').replace(/['"]$/, '');
}

/**
 * Le o frontmatter de um agente. NAO e um parser de YAML e nao pretende ser:
 * le `chave: valor` de primeiro nivel, que e a unica forma que este plugin
 * escreve e a unica que o gatilho 3 precisa ler. Lista, bloco e aninhamento
 * viram valor cru, e quem chama decide o que fazer com isso.
 *
 * Tres entradas que existem de verdade e que um parser ingenuo erra: BOM no
 * inicio (arquivo gravado no Windows), CRLF, e `model:` vazio.
 *
 * `model:` AUSENTE e `model:` VAZIO nao sao a mesma coisa para quem le, mas sao
 * a mesma RESPOSTA - nao declarado - e nenhuma das duas e divergencia. Quem
 * trata disso e o gatilho 3; aqui so nao se inventa valor (foco de revisao 4).
 *
 * Cerca que abre e nunca fecha devolve `ok: false` e campos VAZIOS: metade de
 * um frontmatter lido como se fosse inteiro e pior do que nao ter lido nada.
 */
function frontmatter(bruto) {
  const linhas = texto.semBom(String(bruto == null ? '' : bruto)).split(/\r?\n/);
  if (linhas.length === 0 || !CERCA.test(linhas[0])) return { ok: false, campos: {} };
  const campos = {};
  for (let i = 1; i < linhas.length; i++) {
    if (CERCA.test(linhas[i])) return { ok: true, campos: campos };
    const m = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(linhas[i]);
    if (!m) continue;
    const valor = desfazerCitacao(m[2].trim()).trim();
    campos[m[1]] = valor === '' ? null : valor;
  }
  return { ok: false, campos: {} };
}

/** path.join sempre, nunca concatenacao: a raiz tem espaco e acento nesta maquina. */
function caminho(raiz, nome) {
  return path.join(String(raiz), PASTA[0], PASTA[1], String(nome) + '.md');
}

/**
 * Todos os agentes do projeto, com o `model:` que cada um declara.
 *
 * `existe` separa duas respostas que um array vazio confunde: "este projeto nao
 * tem agentes" e "nao consegui olhar". O gatilho 3 precisa das duas separadas
 * para declarar "nao verificavel aqui" em vez de passar verde (foco 1).
 */
function listar(raiz) {
  const dir = path.join(String(raiz), PASTA[0], PASTA[1]);
  let arquivos;
  try {
    arquivos = fs.readdirSync(dir, { withFileTypes: true })
      .filter(function (e) { return e.isFile() && e.name.endsWith('.md'); })
      .map(function (e) { return e.name; });
  } catch (e) {
    return { existe: false, agentes: [] };
  }
  arquivos.sort();
  const lista = arquivos.map(function (arquivo) {
    let bruto = '';
    try { bruto = fs.readFileSync(path.join(dir, arquivo), 'utf8'); } catch (e) { bruto = ''; }
    const f = frontmatter(bruto);
    return {
      arquivo: arquivo,
      nome: f.campos.name || arquivo.replace(/\.md$/, ''),
      model: f.campos.model === undefined ? null : f.campos.model,
      temFrontmatter: f.ok
    };
  });
  return { existe: true, agentes: lista };
}

const ESFORCOS = ['low', 'medium', 'high', 'xhigh', 'max'];
const FERRAMENTA = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * As tres fatias do molde que tem formato proprio. Devolve a lista de erros -
 * vazia quando vale - e cada erro diz o valor ACEITO, para quem le saber o que
 * escrever. Aceita numero no JSON de respostas (`"maxTurns": 8`): a entrevista e
 * conversa, e quem digita 8 nao errou.
 */
function validarFatias(valores) {
  const v = valores || {};
  const erros = [];
  function str(x) { return (typeof x === 'string' || typeof x === 'number') ? String(x).trim() : ''; }
  // Nome do tipo para a mensagem: lista e nulo em vez de "object".
  function tipo(x) { return Array.isArray(x) ? 'lista' : (x === null ? 'nulo' : typeof x); }
  function tipoAceito(x) { return typeof x === 'string' || typeof x === 'number'; }

  if (v.esforco !== undefined && !tipoAceito(v.esforco)) {
    erros.push('esforco tem de ser texto (veio ' + tipo(v.esforco) + '): use um de ' + ESFORCOS.join('|'));
  }
  const esforco = str(v.esforco);
  if (esforco !== '' && ESFORCOS.indexOf(esforco) === -1) {
    erros.push('esforco "' + esforco + '" invalido: use um de ' + ESFORCOS.join('|'));
  }
  if (v.maxTurns !== undefined && !tipoAceito(v.maxTurns)) {
    erros.push('maxTurns tem de ser um inteiro (veio ' + tipo(v.maxTurns) + ')');
  }
  const maxTurns = str(v.maxTurns);
  if (maxTurns !== '' && !/^[1-9][0-9]*$/.test(maxTurns)) {
    erros.push('maxTurns "' + maxTurns + '" invalido: use um inteiro maior ou igual a 1');
  }
  if (typeof v.ferramentas === 'string' && v.ferramentas.trim() !== '') {
    const itens = v.ferramentas.split(',').map(function (x) { return x.trim(); });
    const ruins = itens.filter(function (x) { return !FERRAMENTA.test(x); });
    if (ruins.length > 0) {
      erros.push('ferramentas invalidas (' + ruins.map(function (x) { return '"' + x + '"'; }).join(', ') +
        '): separe por virgula nomes no formato [A-Za-z][A-Za-z0-9_-]*');
    }
  } else if (v.ferramentas !== undefined && typeof v.ferramentas !== 'string') {
    erros.push('ferramentas tem de ser texto, nao ' + tipo(v.ferramentas) +
      ': liste, separadas por virgula, so as que o papel precisa (formato [A-Za-z][A-Za-z0-9_-]*)');
  } else if (v.ferramentas !== undefined) {
    erros.push('ferramentas vazia: liste, separadas por virgula, so as que o papel precisa (formato [A-Za-z][A-Za-z0-9_-]*)');
  }
  return erros;
}

/**
 * Para quem o agente do degrau `i` devolve o que passa do papel dele: o agente
 * do degrau de cima; no ultimo degrau, quem decide neste projeto. O valor de
 * `quemDecide` NAO se imprime (D10, molde.js): o texto aponta o campo.
 */
function escalaPara(degraus, i) {
  const proximo = degraus[i + 1];
  if (proximo && proximo.agente) return '`' + proximo.agente + '`';
  return 'quem decide neste projeto (veja `quemDecide` em `.claude/sworn/projeto.json`)';
}

module.exports = { PASTA, CERCA, ESFORCOS, frontmatter, caminho, listar, validarFatias, escalaPara };
