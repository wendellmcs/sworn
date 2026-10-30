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
// Os dois rotulos da nota depois do "o que"; a fonte unica do nome deles.
const ROTULO = { limite: 'limite', gatilho: 'trocar quando' };
const ROTULO_NO_INICIO = new RegExp('^(' + ROTULO.limite + '|' + ROTULO.gatilho + '):', 'i');
const FRASE_FECHADA = /[.!?]$/;
const FIM_DE_BLOCO = /(\*\/|-->)\s*$/;

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

function semFecho(t) { return t.replace(/\s*(\*\/|-->)\s*$/, ''); }

// A marca diferencia caixa: "Atalho:" com maiuscula e palavra comum num comentario, nao a convencao.
function reMarca(listaDeMarcas) { return new RegExp('^\\s*(?:' + listaDeMarcas.join('|') + '):(.*)$'); }

/** Onde o rotulo `nome` aparece em `texto` (palavra inteira, sem diferenciar caixa), ou null. */
function rotuloEm(texto, nome) { return new RegExp('\\b' + nome + ':', 'i').exec(texto); }

/**
 * A linha com a marca num comentario, lida uma vez so, ou null. `corpo`: o texto depois da marca. `nota`: o comentario
 * inteiro, aparado e sem fecho. `emBloco`: o comentario abriu `/*` ou `<!--`. `fechou`: a linha termina em `*\/` ou `-->`.
 */
function linhaDaMarca(linha, listaDeMarcas) {
  const crua = String(linha);
  const resto = comentario(crua);
  if (resto === null) return null;
  const m = reMarca(listaDeMarcas).exec(semFecho(resto));
  if (!m) return null;
  return {
    corpo: m[1],
    nota: semFecho(resto).trim(),
    // D690: o que vem antes do texto do comentario termina no prefixo que abre bloco
    emBloco: /(\/\*|<!--)$/.test(crua.slice(0, crua.length - resto.length)),
    fechou: FIM_DE_BLOCO.test(crua)
  };
}

/** { oque, limite, gatilho } do texto depois da marca. Rotulo que falta vem null. */
function rotulos(corpo) {
  const lidos = { limite: null, gatilho: null };
  // D690: o rotulo que aparece por ultimo sai primeiro, para que nenhum leve o texto do outro, em qualquer ordem
  const presentes = Object.keys(ROTULO)
    .map(function (campo) { return { campo: campo, achado: rotuloEm(corpo, ROTULO[campo]) }; })
    .filter(function (r) { return r.achado; })
    .sort(function (a, b) { return b.achado.index - a.achado.index; });
  for (const r of presentes) {
    lidos[r.campo] = limpo(corpo.slice(r.achado.index + r.achado[0].length));
    corpo = corpo.slice(0, r.achado.index);
  }
  return { oque: limpo(corpo) || '', limite: lidos.limite, gatilho: lidos.gatilho };
}

/** { oque, limite, gatilho } da linha com a marca num comentario, ou null. So a linha: a de baixo fica com o `varrer`. */
function lerLinha(linha, listaDeMarcas) {
  const marca = linhaDaMarca(linha, listaDeMarcas);
  return marca && rotulos(marca.corpo);
}

/**
 * O texto da linha que e so comentario (aparado, sem `*\/` ou `-->` no fim), ou null se ela comeca com codigo. Com
 * `emBloco` (o comentario de cima abriu `/*` ou `<!--` sem fechar), a linha inteira e comentario, com ou sem ` * ` na
 * frente, e so a que abre com o fecho volta null.
 */
function soComentario(crua, emBloco) {
  const inicio = crua.trimStart();
  if (emBloco) return /^(\*\/|-->)/.test(inicio) ? null : semFecho(inicio.replace(/^\*\s?/, '')).trim();
  if (!PREFIXOS.some(function (p) { return inicio.startsWith(p); })) return null;
  return semFecho(comentario(crua) || '').trim();
}

/**
 * D687/D689: as linhas logo abaixo da `marca` (a de `linhaDaMarca`, na linha `i`) que abrem com rotulo ainda nao usado
 * (`limite:`, `trocar quando:`), em `aceitas`, e a `nota` com elas no fim. So conta a linha que e so comentario (a que
 * e codigo com comentario no fim nao conta; dentro de bloco `/*` ou `<!--` aberto, toda linha ate o fecho), nao vazia
 * e sem marca, depois de linha sem `*\/` ou `-->` no fim; rotulo repetido abre outra nota.
 * A linha sem rotulo nao entra: nenhuma regra de texto separa a quebra da frase de cima de um comentario alheio
 * (D689). `paraEmSemRotulo` diz que a leitura parou numa linha dessas.
 */
function continuacao(linhas, i, marca, listaDeMarcas) {
  const outraMarca = reMarca(listaDeMarcas);
  const aceitas = [];
  let nota = marca.nota;
  let fechou = marca.fechou;
  let paraEmSemRotulo = false;
  for (let j = i + 1; j < linhas.length && !fechou; j++) {
    const crua = linhas[j];
    const texto = soComentario(crua, marca.emBloco);
    if (!texto || outraMarca.test(texto)) break; // codigo, comentario vazio ou outra marca
    const rotulo = ROTULO_NO_INICIO.exec(texto);
    if (!rotulo) { paraEmSemRotulo = true; break; }
    if (rotuloEm(nota, rotulo[1])) break; // rotulo repetido abre outra nota
    aceitas.push(texto);
    nota += ' ' + texto;
    fechou = FIM_DE_BLOCO.test(crua);
  }
  return { aceitas: aceitas, nota: nota, paraEmSemRotulo: paraEmSemRotulo };
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
    // A6 (s220, R1 :148): CR puro tambem quebra linha (antes o arquivo inteiro virava uma).
    const linhas = texto.split(/\r\n|\r|\n/);
    for (let i = 0; i < linhas.length; i++) {
      const marca = linhaDaMarca(linhas[i], listaDeMarcas);
      if (!marca) continue;
      const c = continuacao(linhas, i, marca, listaDeMarcas);
      const a = rotulos([marca.corpo].concat(c.aceitas).join(' '));
      const achado = { arquivo: arquivo, linha: i + 1, oque: a.oque, limite: a.limite, gatilho: a.gatilho };
      // D689: a nota acabou sem . ! ? e logo abaixo vem comentario sem rotulo, que pode ser o resto da frase
      if (c.paraEmSemRotulo && !FRASE_FECHADA.test(c.nota)) achado.talvezCortado = true;
      achados.push(achado);
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
  let semPonto = 0;
  for (const a of ordem) {
    if (a.arquivo !== atual) { linhas.push(a.arquivo); atual = a.arquivo; }
    linhas.push('  ' + (':' + a.linha).padEnd(largura) + ' ' + a.oque);
    if (a.limite) linhas.push(recuo + ROTULO.limite + ': ' + a.limite);
    if (a.gatilho) linhas.push(recuo + ROTULO.gatilho + ': ' + a.gatilho);
    else { linhas.push(recuo + 'sem-gatilho'); semGatilho++; }
    if (a.talvezCortado) { linhas.push(recuo + 'sem ponto final: a linha de baixo ficou de fora'); semPonto++; }
  }
  const arquivos = new Set(ordem.map(function (a) { return a.arquivo; })).size;
  linhas.push('', plural(ordem.length, 'atalho', 'atalhos') + ' em ' + plural(arquivos, 'arquivo', 'arquivos') + '; ' +
    (semGatilho === 0 ? 'todos com gatilho.' : semGatilho + ' sem gatilho.'));
  if (semGatilho > 0) {
    linhas.push('Atalho sem gatilho vira dívida esquecida: escreva "' + ROTULO.gatilho + ': ..." no comentário.');
  }
  if (semPonto > 0) {
    linhas.push('Sem ponto final: só entra a linha de baixo que começa com "' + ROTULO.limite + ':" ou "' +
      ROTULO.gatilho + ':". Termine a frase na mesma linha ou comece a de baixo com o rótulo.');
  }
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
