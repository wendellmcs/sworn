'use strict';

/**
 * Plano 090 Tarefa 5: /sworn:shortcuts, a lista do que foi simplificado de proposito. Logica pura: quem le o disco e
 * pergunta ao git e o scripts/atalhos.js. Formato do comentario (D554), em rotulos para que uma virgula na frase nao
 * quebre a leitura:
 *   <prefixo de comentario> <marca>: <o que>. limite: <ate onde vale>. trocar quando: <gatilho>.
 */
const MARCA_PADRAO = 'atalho';
// Quem ja usa o ponytail (ou a grafia inglesa dele) nao precisa reescrever os comentarios.
const MARCAS_ACEITAS = ['ponytail', 'shortcut'];
const PALAVRA = /^[A-Za-z][A-Za-z0-9_-]*$/;
const PREFIXOS = ['<!--', '//', '/*', '--', '#'];
const ASPAS = ['"', "'", '`'];

function ehMarca(v) { return typeof v === 'string' && PALAVRA.test(v); }

/** As marcas que contam: a do projeto (`marcaDeAtalho`, ou `atalho`) e as duas aceitas, sem repetir. */
function marcas(projeto) {
  const propria = projeto && ehMarca(projeto.marcaDeAtalho) ? projeto.marcaDeAtalho : MARCA_PADRAO;
  return [propria].concat(MARCAS_ACEITAS.filter(function (m) { return m !== propria; }));
}

// Aspa de algum tipo aberta antes da posicao: a "marca" esta dentro de uma string (fixture de teste, texto de ajuda).
function dentroDeString(linha, ate) {
  return ASPAS.some(function (a) { return linha.slice(0, ate).split(a).length % 2 === 0; });
}

/** O comentario que comeca na linha (no inicio ou depois de espaco), ou null. Devolve o texto depois do prefixo. */
function comentario(linha) {
  for (let i = 0; i < linha.length; i++) {
    if (i > 0 && linha[i - 1] !== ' ' && linha[i - 1] !== '\t') continue;
    const prefixo = PREFIXOS.find(function (p) { return linha.startsWith(p, i); });
    if (!prefixo) continue;
    if (dentroDeString(linha, i)) return null;
    return linha.slice(i + prefixo.length);
  }
  return null;
}

function limpo(t) {
  const s = t.trim();
  return s === '' ? null : s;
}

/** { oque, limite, gatilho } da linha com a marca num comentario, ou null. Rotulo que falta vem null. */
function lerLinha(linha, listaDeMarcas) {
  const resto = comentario(String(linha));
  if (resto === null) return null;
  // A marca diferencia caixa: "Atalho:" com maiuscula e palavra comum num comentario, nao a convencao.
  const re = new RegExp('^\\s*(?:' + listaDeMarcas.join('|') + '):(.*)$');
  const m = re.exec(resto.replace(/\s*(\*\/|-->)\s*$/, ''));
  if (!m) return null;
  let corpo = m[1];
  let gatilho = null;
  let limite = null;
  const t = /\btrocar quando:/i.exec(corpo);
  if (t) { gatilho = limpo(corpo.slice(t.index + t[0].length)); corpo = corpo.slice(0, t.index); }
  const l = /\blimite:/i.exec(corpo);
  if (l) { limite = limpo(corpo.slice(l.index + l[0].length)); corpo = corpo.slice(0, l.index); }
  return { oque: limpo(corpo) || '', limite: limite, gatilho: gatilho };
}

/**
 * Os atalhos dos `arquivos`, na ordem em que vieram. `ler(arquivo)` devolve o texto ou null (nao leu, grande demais);
 * texto com byte 0 e binario e fica fora.
 */
function varrer(arquivos, ler, listaDeMarcas) {
  const achados = [];
  for (const arquivo of arquivos) {
    const texto = ler(arquivo);
    if (typeof texto !== 'string' || texto.indexOf('\u0000') !== -1) continue;
    const linhas = texto.split('\n');
    for (let i = 0; i < linhas.length; i++) {
      const a = lerLinha(linhas[i].replace(/\r$/, ''), listaDeMarcas);
      if (a) achados.push({ arquivo: arquivo, linha: i + 1, oque: a.oque, limite: a.limite, gatilho: a.gatilho });
    }
  }
  return achados;
}

function plural(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }

function listaFalada(lista) {
  return lista.length === 1 ? lista[0] : lista.slice(0, -1).join(', ') + ' ou ' + lista[lista.length - 1];
}

/** O painel do mock (D554): agrupado por arquivo em ordem alfabetica, `:linha` alinhado, resumo e conselho. */
function painel(achados, totalDeArquivos, listaDeMarcas) {
  if (achados.length === 0) {
    return ['Nenhum atalho registrado.', '',
      'Procurei comentários com ' + listaFalada(listaDeMarcas.map(function (m) { return m + ':'; })) + ' em ' +
      plural(totalDeArquivos, 'arquivo', 'arquivos') + ' (os rastreados pelo git e os novos que ele não ignora).'
    ].join('\n');
  }
  const ordem = achados.slice().sort(function (a, b) {
    return a.arquivo < b.arquivo ? -1 : a.arquivo > b.arquivo ? 1 : a.linha - b.linha;
  });
  const largura = Math.max(4, ...ordem.map(function (a) { return String(a.linha).length + 1; }));
  const recuo = ' '.repeat(2 + largura + 1);
  const linhas = ['Atalhos registrados (marca: ' + listaDeMarcas.join(', ') + ')', ''];
  let atual = null;
  let semGatilho = 0;
  for (const a of ordem) {
    if (a.arquivo !== atual) { linhas.push(a.arquivo); atual = a.arquivo; }
    linhas.push('  ' + (':' + a.linha).padEnd(largura) + ' ' + a.oque);
    if (a.limite) linhas.push(recuo + 'limite: ' + a.limite);
    if (a.gatilho) linhas.push(recuo + 'trocar quando: ' + a.gatilho);
    else { linhas.push(recuo + 'sem-gatilho'); semGatilho++; }
  }
  const arquivos = new Set(ordem.map(function (a) { return a.arquivo; })).size;
  linhas.push('', plural(ordem.length, 'atalho', 'atalhos') + ' em ' + plural(arquivos, 'arquivo', 'arquivos') + '; ' +
    (semGatilho === 0 ? 'todos com gatilho.' : semGatilho + ' sem gatilho.'));
  if (semGatilho > 0) linhas.push('Atalho sem gatilho vira dívida esquecida: escreva "trocar quando: ..." no comentário.');
  return linhas.join('\n');
}

const MAIOR_ARQUIVO = 1024 * 1024; // texto acima disso nao e codigo escrito a mao: nao abre
// 60 s em todo git da varredura (o rev-parse inclusive): com a maquina carregada, 5 s e 15 s estouravam e o repositorio
// de dentro saia da contagem (medido na suite inteira da s129).
const OPCOES_GIT = { maxBuffer: 64 * 1024 * 1024, timeout: 60000 };

/** O texto de `abs`, ou null (nao e arquivo, passa de 1 MB, apagado sem commit, link quebrado, submodulo). */
function lerArquivo(abs) {
  const fs = require('node:fs');
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > MAIOR_ARQUIVO) return null;
    return fs.readFileSync(abs, 'utf8');
  } catch (e) {
    return null;
  }
}

/**
 * Os atalhos do repositorio git de `cwd`: os arquivos que o git rastreia e os novos que ele nao ignora (fora `.git`,
 * `node_modules` e o .gitignore), caminhos relativos a raiz do repositorio. Devolve { achados, total, marcas, raiz }, ou
 * { erro } fora de repositorio ou com o git mudo (`foraDeRepositorio: true` quando nem o rev-parse respondeu). So le.
 */
function doRepositorio(cwd, projeto) {
  const git = require('./git.js');
  const path = require('node:path');
  const topo = git.correr(cwd, ['rev-parse', '--show-toplevel'], OPCOES_GIT);
  if (topo === null) {
    return { erro: 'Esta pasta não é repositório git, ou o git não respondeu: não sei quais arquivos varrer. Rode de ' +
      'dentro da pasta do repositório; se já estiver nela, confira se o git está instalado.', foraDeRepositorio: true };
  }
  const raiz = topo.trim();
  // -z: sem ele o git cita entre aspas o nome com acento.
  const rastreados = git.correr(raiz, ['ls-files', '-z'], OPCOES_GIT);
  const novos = git.correr(raiz, ['ls-files', '--others', '--exclude-standard', '-z'], OPCOES_GIT);
  if (rastreados === null || novos === null) {
    return { erro: 'O git não respondeu à lista de arquivos (falhou ou passou de 60 s): nada foi varrido. Rode de novo; se repetir, ' +
      'confira se `git ls-files` responde nesta pasta.' };
  }
  const arquivos = Array.from(new Set((rastreados + novos).split('\0').filter(function (a) { return a !== ''; })));
  const lista = marcas(projeto);
  return {
    achados: varrer(arquivos, function (rel) { return lerArquivo(path.join(raiz, rel)); }, lista),
    total: arquivos.length,
    marcas: lista,
    raiz: raiz
  };
}

/**
 * Plano 092 (D576): os atalhos da pasta aberta e dos repositorios logo abaixo dela (um nivel), com o caminho a partir da
 * pasta. Num workspace cuja raiz guarda os projetos em repositorios proprios, so a raiz nao acharia nada. Devolve
 * { achados, total, marcas, falhas } (falhas = as pastas que o git nao leu; a propria pasta fora de git nao e falha), ou
 * o { erro } do primeiro quando nenhum repositorio respondeu e nada falhou. So le.
 */
function daPastaEDeDentro(cwd, projeto) {
  const fs = require('node:fs');
  const path = require('node:path');
  const glob = require('./glob.js');
  // o git devolve o caminho longo; o %TEMP% do Windows pode vir no nome curto (8.3): compara pelo caminho real
  const real = function (p) { try { return fs.realpathSync.native(p); } catch (e) { return path.resolve(p); } };
  const pastas = [cwd];
  try {
    for (const e of fs.readdirSync(cwd, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== '.git' && e.name !== 'node_modules' && fs.existsSync(path.join(cwd, e.name, '.git'))) {
        pastas.push(path.join(cwd, e.name));
      }
    }
  } catch (e) { /* pasta ilegivel: so a propria */ }
  const base = real(cwd);
  const vistos = new Set();
  const achados = [];
  let total = 0;
  let primeiroErro = null;
  const falhas = [];
  for (const p of pastas) {
    const r = doRepositorio(p, projeto);
    if (r.erro) {
      if (!primeiroErro) primeiroErro = r;
      // revisao 092: o erro de um repositorio nao some calado quando outro responde
      if (!(p === cwd && r.foraDeRepositorio)) falhas.push(p === cwd ? '.' : glob.normalizar(path.relative(cwd, p)));
      continue;
    }
    const raiz = real(r.raiz);
    if (vistos.has(raiz.toLowerCase())) continue;
    vistos.add(raiz.toLowerCase());
    const rel = glob.normalizar(path.relative(base, raiz));
    // repositorio de dentro: o caminho ganha a pasta dele; o da propria pasta (ou acima dela) fica como o git devolve
    const prefixo = rel && !rel.startsWith('..') ? rel + '/' : '';
    for (const a of r.achados) achados.push(Object.assign({}, a, { arquivo: prefixo + a.arquivo }));
    total += r.total;
  }
  if (!vistos.size && !falhas.length) return primeiroErro;
  return { achados: achados, total: total, marcas: marcas(projeto), falhas: falhas };
}

module.exports = { MARCA_PADRAO, MARCAS_ACEITAS, ehMarca, marcas, lerLinha, varrer, painel, lerArquivo, doRepositorio,
  daPastaEDeDentro };
