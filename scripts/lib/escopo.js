'use strict';
const fs = require('node:fs');
const path = require('node:path');
const glob = require('./glob.js');
const textoLib = require('./texto.js');

const ARQUIVO = '.claude/sworn/escopo.md';

// Escopo por frente: um projeto pode ter varias frentes de trabalho ao mesmo
// tempo, cada uma com o seu arquivo nesta pasta. Editar o arquivo da frente
// vincula a sessao a ela; sem vinculo, vale o escopo.md de sempre.
const PASTA_FRENTES = '.claude/sworn/escopos/';
const NOME_DE_FRENTE = /^[a-zA-Z0-9_-]+$/;

// O nome de frente que de fato vale no disco: o que vem do estado (arquivo em disco)
// e saneado na mesma classe do session_id (lib/estado.js:caminhoSessao).
function nomeSeguro(frente) {
  return String(frente).replace(/[^a-zA-Z0-9_-]/g, '-');
}

// F2-18: regua horizontal do markdown (`---`, `***`, `___`, com ou sem marcador e espacos) separa trechos; nao e caminho.
const REGUA = /^([-*_])(?:\s*\1){2,}$/;

/**
 * D244/defeito 2: o item de lista e o CAMINHO, e o resto da linha e anotacao. Antes a linha
 * inteira virava padrao, e `src/a.js (motivo)` nunca casava arquivo nenhum. Caminho pode ter
 * espaco (`Minha Pasta/**`), entao o corte e pela anotacao, nao pelo primeiro espaco:
 * entre crases vale o que esta entre elas; sem crase, corta em espaco seguido de `(`,
 * travessao, `--`, ` - ` ou `#`.
 */
function caminhoDoItem(t) {
  if (REGUA.test(t)) return '';
  // 0.3.3, item 23: marcador sozinho na linha (`-`, `*`, `+`) nao e item; sem o `$`, o marcador sem
  // texto sobrava como o caminho `-`.
  const s = t.replace(/^[-*+](?:\s+|$)/, '').trim();
  const crase = s.match(/^`+([^`]+)`+/);
  if (crase) return crase[1].trim();
  const corte = s.search(/\s+(?:\(|\u2014|--\s|-\s|#)/);
  return (corte === -1 ? s : s.slice(0, corte)).replace(/`+/g, '').trim();
}

function parse(texto) {
  const esc = { objetivo: '', dentro: [], fora: [] };
  const linhas = String(texto == null ? '' : texto).split(/\r?\n/);
  let secao = null;
  for (const linha of linhas) {
    const t = linha.trim();
    if (t === '') continue;
    const obj = t.match(/^\*\*\s*objetivo\s*:?\s*\*\*\s*(.+)$/i);
    if (obj) { esc.objetivo = obj[1].trim(); continue; }
    if (/^#{1,6}\s*dentro\b/i.test(t)) { secao = 'dentro'; continue; }
    if (/^#{1,6}\s*fora\b/i.test(t)) { secao = 'fora'; continue; }
    if (/^#{1,6}\s/.test(t)) { secao = null; continue; }
    if (!secao) continue;
    const item = caminhoDoItem(t);
    if (item) esc[secao].push(item);
  }
  return esc;
}

/**
 * Reconhece um alvo (caminho relativo ao projeto, com barra normal) como o
 * arquivo de UMA frente: prefixo da pasta e extensao comparados sem diferenciar
 * caixa (mesma razao da comparacao do escopo.md em portao-escopo.js), o nome no
 * meio nao pode ser vazio nem ter barra. Devolve `{ nome, valido }` com o nome
 * na caixa original, ou `null` fora da pasta de frentes.
 */
function frenteDoAlvo(alvoRelativo) {
  const alvo = String(alvoRelativo == null ? '' : alvoRelativo);
  const baixo = alvo.toLowerCase();
  if (baixo.indexOf(PASTA_FRENTES) !== 0 || baixo.slice(-3) !== '.md') return null;
  const nome = alvo.slice(PASTA_FRENTES.length, alvo.length - 3);
  if (!nome || nome.indexOf('/') !== -1) return null;
  return { nome: nome, valido: NOME_DE_FRENTE.test(nome) };
}

/**
 * F2-16 / 0.3.3 item 22: o destino REAL do arquivo fica fora do projeto? `path.relative` do realpath dos dois
 * lados: fora = comeca com `..` (como pasta) ou e absoluto (outro disco). Lanca se o destino nao se resolve.
 */
function destinoForaDoProjeto(cwd, abs) {
  const rel = path.relative(fs.realpathSync(cwd), fs.realpathSync(abs));
  return /^\.\.(?:[\\/]|$)/.test(rel) || path.isAbsolute(rel);
}

/** `destinoForaDoProjeto` que, quando o destino nao se resolve, diz que nao (ai a leitura falha sozinha). */
function ehDeFora(cwd, abs) {
  try { return destinoForaDoProjeto(cwd, abs); } catch (e) { return false; }
}

/**
 * O arquivo de escopo que vale para esta leitura: o da frente, se ela existir
 * no disco; senao o escopo.md de sempre. `frente` vem do estado (arquivo em
 * disco), por isso e saneada de novo aqui, na mesma classe do session_id
 * (lib/estado.js:caminhoSessao).
 */
function arquivoEmVigor(cwd, frente) {
  if (!frente) return ARQUIVO;
  const seguro = nomeSeguro(frente);
  try {
    const rel = PASTA_FRENTES + seguro + '.md';
    // F2-16: a frente cujo destino REAL fica fora do projeto nao vale (como frente que sumiu do disco).
    if (fs.existsSync(path.join(cwd, rel)) && !ehDeFora(cwd, path.join(cwd, rel))) return rel;
  } catch (e) { /* cai no escopo.md */ }
  return ARQUIVO;
}

function carregar(cwd, frente) {
  try {
    const abs = path.join(cwd, arquivoEmVigor(cwd, frente));
    // F2-16: escopo cujo destino real fica fora do projeto nao e lido; `null` vira "sem escopo" no portao (mais estrito).
    if (ehDeFora(cwd, abs)) return null;
    return parse(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    return null;
  }
}

function dentro(caminho, esc) {
  if (!esc) return false;
  return glob.casaAlgum(esc.dentro, caminho);
}

/** D244/defeito 7: o padrao de "Fora" que casa o caminho, ou null. */
function declaradoFora(caminho, esc) {
  if (!esc || !Array.isArray(esc.fora)) return null;
  for (const p of esc.fora) if (glob.casa(p, caminho)) return p;
  return null;
}

/**
 * R5/D36: nada que venha de fora chega cru ao texto do hook. Acento vira letra sem acento; travessao e meia-risca
 * viram hifen (s131 par.5: o painel mostrava "(0.8.0) ? depende" no titulo do plano). Plano 082 (p8-12): os hifens
 * U+2010/2011 e o menos U+2212 tambem; (p8-11) quebra de linha e tab viram espaco, e o que sobra conta por caractere
 * (flag `u`): o emoji, par de surrogates, vira UM "?", nao dois.
 */
function ascii(valor) {
  return String(valor == null ? '' : valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\r\n|[\t\n\v\f\r]/g, ' ')
    .replace(/[^\x20-\x7E]/gu, '?');
}

/**
 * D34: o "depois" de uma escrita, calculado a partir do tool_input, sem tocar no disco.
 * Devolve null quando nao da para saber (e ai o portao conta a ampliacao por precaucao).
 */
function conteudoDepois(atual, toolInput) {
  const ti = toolInput || {};
  if (typeof ti.content === 'string') return ti.content;
  if (typeof ti.old_string !== 'string' || ti.old_string === '') return null;
  const base = String(atual == null ? '' : atual);
  const i = base.indexOf(ti.old_string);
  if (i === -1) return null;
  const novo = typeof ti.new_string === 'string' ? ti.new_string : '';
  if (ti.replace_all) return base.split(ti.old_string).join(novo);
  return base.slice(0, i) + novo + base.slice(i + ti.old_string.length);
}

/**
 * D34: ampliou = a lista "Dentro" ganhou pelo menos um padrao que nao existia antes.
 * Estreitar ou corrigir typo nao conta. `depois` null significa desconhecido -> conta.
 */
function ampliou(antes, depois) {
  if (!depois) return true;
  const velhos = (antes && Array.isArray(antes.dentro)) ? antes.dentro : [];
  const novos = Array.isArray(depois.dentro) ? depois.dentro : [];
  for (const d of novos) {
    if (velhos.indexOf(d) === -1) return true;
  }
  return false;
}

// 0.3.2, item 12: a mensagem e lida num portao, sem a spec do lado. "marcha" e "trava" sao nomes
// da spec, entao cada mensagem diz o que eles guardam. "trava N" fica: e o nome publico (README)
// e os testes o prendem.
const TRAVA_ESCOPO = 'sworn - portao de escopo (trava 4 - o escopo da tarefa).';
// 0.3.3, item 21: a trava 5 tem a sua constante ao lado da 4, com o mesmo texto de antes (os testes o prendem).
const TRAVA_OUTRA_FRENTE = 'sworn - outra frente de trabalho (trava 5 - arquivo de outra frente).';
const O_QUE_E_MARCHA = 'o nivel de rigor que o projeto.json da a este caminho';

// A2-04: o caminho sai por ascii() (R5); com acento ou caractere fora de ASCII, o escrito no aviso nao e o real.
// A linha e um bloco proprio na forma unica: depois de uma linha em branco, com outra depois (ou no `fim` do aviso).
function avisoDeAcento(original, fim) {
  if (ascii(original) === String(original == null ? '' : original)) return [];
  const linha = 'O caminho real tem acento ou caractere especial: copie-o da sua chamada, nao deste texto.';
  return fim ? ['', linha] : [linha, ''];
}

// A2-23: o defeito achado num arquivo fora do escopo vai ao usuario, nao vira edicao.
const NAO_EDITE = '  1. nao edite este arquivo; se achou um defeito nele, conte ao usuario no fecho do turno, sem corrigir;';

// A2-20: o texto que sai no aviso passa por ascii() em variavel propria; o parametro fica com o valor recebido.
function motivoSemEscopo(alvo, marcha, arquivo) {
  const alvoAscii = ascii(alvo);
  const escopoMd = arquivo || ARQUIVO;
  return [
    TRAVA_ESCOPO,
    '',
    'O arquivo ' + alvoAscii + ' esta em marcha ' + ascii(marcha) + ' (' + O_QUE_E_MARCHA + '), e nao ha escopo declarado.',
    '',
    'Antes de editar, escreva ' + escopoMd + ' nesta forma:',
    '',
    '  # Escopo',
    '  **Objetivo:** <uma linha sobre o que esta tarefa resolve>',
    '  ## Dentro',
    // A2-04: entre crases, o parser le o caminho inteiro (sem crase, corta em ` (`, ` - `, ` #`).
    '  - `' + alvoAscii + '`',
    '  ## Fora de escopo',
    '  - <o que esta tarefa NAO vai mexer>',
    ''
  ].concat(avisoDeAcento(alvo), [
    'A secao "Dentro" libera: o que nao estiver listado la e negado.',
    'A secao "Fora de escopo" tambem bloqueia: o que voce declarou que NAO vai tocar e negado,',
    'mesmo que case um padrao de "Dentro". Pode anotar o motivo depois do caminho, entre parenteses.',
    'Depois, grave o escopo e repita a edicao.'
  ]).join('\n');
}

function motivoFora(alvo, marcha, esc, arquivo) {
  const lista = (esc && esc.dentro.length) ? esc.dentro.map(function (d) { return '  - ' + ascii(d); }).join('\n') : '  (vazio)';
  return [
    TRAVA_ESCOPO,
    '',
    'O arquivo ' + ascii(alvo) + ' (marcha ' + ascii(marcha) + ': ' + O_QUE_E_MARCHA + ') NAO esta no escopo declarado em ' +
      (arquivo || ARQUIVO) + '.',
    '',
    'Escopo atual:',
    lista,
    '',
    'Escolha uma:',
    NAO_EDITE,
    '  2. se ele e mesmo parte do pedido, acrescente-o ao escopo e diga por que.',
    ''
  ].concat(avisoDeAcento(alvo), ['Ampliar o escopo e contado e aparece no fecho do turno.']).join('\n');
}

function motivoDeclaradoFora(alvo, padrao, arquivo) {
  return [
    TRAVA_ESCOPO,
    '',
    'O arquivo ' + ascii(alvo) + ' casa "' + ascii(padrao) + '", que o escopo declara FORA desta tarefa.',
    '',
    'Escolha uma:',
    NAO_EDITE,
    '  2. se a tarefa mudou, reescreva ' + (arquivo || ARQUIVO) + ' e diga por que.'
  ].join('\n');
}

/** Nome de frente fora da classe [a-zA-Z0-9_-]: negado sem gravar vinculo nenhum. */
function motivoNomeDeFrente(alvo) {
  return [
    TRAVA_ESCOPO,
    '',
    'O arquivo ' + ascii(alvo) + ' tem nome de frente invalido (frente = uma tarefa em andamento, com o seu arquivo de escopo).',
    '',
    'Nome de frente so pode ter letras sem acento, numeros, "_" e "-".',
    'Renomeie o arquivo e tente de novo.'
  ].join('\n');
}

/**
 * D244/defeito 7: o escopo em disco pode ser de outra sessao. Uma linha na abertura.
 * Escopo por frente: com vinculo a uma frente que ainda existe no disco, a linha
 * passa a citar a frente e o objetivo DELA. Sem vinculo (ou frente aposentada),
 * mantem a linha de sempre sobre o escopo.md. Havendo outras frentes na pasta, um
 * segundo bloco lista cada uma (menos a vinculada) e diz como se vincular - null so
 * quando nao ha nem escopo.md, nem vinculo, nem frente nenhuma na pasta.
 */
function avisoHeranca(cwd, frente) {
  const partes = [];
  const principal = linhaDoVinculo(cwd, frente) || linhaDaHeranca(cwd);
  if (principal) partes.push(principal);
  const lista = blocoDeFrentes(cwd, frente);
  if (lista) partes.push(lista);
  if (!partes.length) return null;
  return partes.join('\n\n');
}

/**
 * 0.3.3, item 24: o objetivo de uma frente, em uma linha. Arquivo que nao se le diz que nao se leu
 * (com a causa, e o que conferir): e outra coisa que a frente que nao declara objetivo, e quem le a
 * lista precisa saber qual das duas e. F2-19 / F3-22: a causa vem traduzida (`texto.causaDoErro`),
 * e `oArquivo` diz de qual arquivo e o proximo passo ("da frente"; o escopo.md herdado passa "do escopo").
 */
function objetivoDaFrente(arquivoAbsoluto, oArquivo, detalhe) {
  try {
    const esc = parse(fs.readFileSync(arquivoAbsoluto, 'utf8'));
    return resumoDoObjetivo(esc.objetivo || '(sem objetivo)', detalhe);
  } catch (e) {
    return 'nao se leu o arquivo (' + ascii(textoLib.causaDoErro(e)) + '); confira a permissao do arquivo ' +
      (oArquivo || 'da frente');
  }
}

// Nota de sessao no Objetivo: `(sessao N, ...)`, com um nivel de parenteses dentro ("(D671)").
const NOTA_DE_SESSAO = /\(sessao \d+(?:[^()]|\([^()]*\))*\)/g;

/**
 * Item 11 (D674): frente que acumula notas de sessao tem o comeco do Objetivo velho e a situacao de hoje no fim. Com
 * `detalhe` (o caminho do arquivo da frente), o resumo e o comeco, a ultima nota, o plano e onde ler o resto; sem notas
 * ou sem `detalhe`, os 200 primeiros caracteres, como antes. `plano.js` importa este arquivo: o require e tardio.
 */
function resumoDoObjetivo(objetivo, detalhe) {
  const notas = objetivo.match(NOTA_DE_SESSAO);
  if (!detalhe || !notas) return ascii(objetivo).slice(0, 200);
  const inicio = objetivo.slice(0, objetivo.search(NOTA_DE_SESSAO)).trim();
  const plano = require('./plano.js').planoDoObjetivo(objetivo);
  return ascii(inicio).slice(0, 100) + (inicio.length > 100 ? '...' : '') + ' | agora: ' +
    ascii(notas[notas.length - 1]).slice(0, 200) + (plano ? ' | plano: ' + ascii(plano) : '') + ' | detalhe em ' + detalhe;
}

/** A linha da frente vinculada, ou null quando nao ha vinculo, ou a frente sumiu do disco. */
function linhaDoVinculo(cwd, frente) {
  if (!frente) return null;
  const arquivo = arquivoEmVigor(cwd, frente);
  if (arquivo === ARQUIVO) return null;
  return 'sworn: esta sessao esta vinculada a frente ' + nomeSeguro(frente) + ' (' + arquivo +
    ') - objetivo: ' + objetivoDaFrente(path.join(cwd, arquivo), null, arquivo) +
    '. Se a tarefa mudou, reescreva ' + arquivo + ' antes de editar.';
}

/** A linha do escopo.md herdado (com a data dele), ou null quando ele nao existe. */
function linhaDaHeranca(cwd) {
  let st;
  try { st = fs.statSync(path.join(cwd, ARQUIVO)); } catch (e) { st = null; }
  if (!st) return null;
  // F2-05: o escopo.md que existe e nao se le diz que nao se leu (como a frente); F2-16: o que resolve para
  // fora do projeto nao e lido, e a linha diz isso em vez de mostrar o objetivo de um arquivo de fora.
  const abs = path.join(cwd, ARQUIVO);
  const objetivo = ehDeFora(cwd, abs)
    ? 'nao se leu o arquivo (o destino fica fora do projeto)'
    : objetivoDaFrente(abs, 'do escopo');
  const d = st.mtime;
  const p2 = function (n) { return String(n).padStart(2, '0'); };
  const quando = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' +
    p2(d.getHours()) + ':' + p2(d.getMinutes());
  return 'sworn: escopo herdado de ' + quando + ' - objetivo: ' + objetivo +
    '. Se a tarefa mudou, reescreva ' + ARQUIVO + ' antes de editar.';
}

/**
 * 0.3.2, item 13: o Dirent de um link simbolico nao e `isFile()`, e um link para arquivo
 * sumia da lista. Link entra se o que ele aponta e arquivo; link quebrado e link para pasta
 * ficam fora, como a pasta chamada x.md.
 */
function ehArquivo(cwd, e) {
  if (e.isFile()) return true;
  if (!e.isSymbolicLink()) return false;
  const caminho = path.join(cwd, PASTA_FRENTES, e.name);
  try {
    if (!fs.statSync(caminho).isFile()) return false;
    // 0.3.3, item 22: o link so vale se o destino REAL fica dentro do projeto; senao a linha do objetivo
    // de um arquivo de fora entraria no texto da abertura (a regra e a de `destinoForaDoProjeto`).
    return !destinoForaDoProjeto(cwd, caminho);
  } catch (x) {
    // 0.3.3, item 19: cai aqui o link quebrado (o destino sumiu), o link sem permissao para ler o destino
    // e o destino que nao se resolve. Fica FORA da lista de proposito: frente que nao se le nao tem
    // objetivo a mostrar, e a lista existe para dizer o que as frentes fazem.
    return false;
  }
}

/**
 * As frentes da pasta, uma por linha, e como se vincular a elas - ou null sem nenhuma.
 * So arquivo entra (uma pasta chamada x.md nao e frente), e a frente ja vinculada fica
 * de fora: a linha do vinculo ja fala dela.
 */
function blocoDeFrentes(cwd, frente) {
  // F2-17: a pasta inteira que e link para fora do projeto: lista vazia, e uma linha diz por que.
  let pastaDeFora = false;
  try {
    const pasta = path.join(cwd, PASTA_FRENTES);
    fs.statSync(pasta);
    pastaDeFora = destinoForaDoProjeto(cwd, pasta);
  } catch (e) { pastaDeFora = false; }
  if (pastaDeFora) {
    return 'sworn: a pasta ' + PASTA_FRENTES + ' aponta para fora do projeto, entao nenhuma frente foi lida.';
  }
  let nomes = [];
  try {
    nomes = fs.readdirSync(path.join(cwd, PASTA_FRENTES), { withFileTypes: true })
      .filter(function (e) { return e.name.toLowerCase().slice(-3) === '.md' && ehArquivo(cwd, e); })
      .map(function (e) { return e.name; });
  } catch (e) { nomes = []; }
  if (frente && arquivoEmVigor(cwd, frente) !== ARQUIVO) {
    // 0.3.2, item 14: sai da lista SO o arquivo vinculado - o de nome exato, se ha; senao o de
    // mesma grafia sem caixa (o existsSync de arquivoEmVigor so o achou porque o disco nao
    // diferencia caixa). Em disco que diferencia, Foo.md e foo.md sao duas frentes.
    const exato = nomeSeguro(frente) + '.md';
    const vinculado = nomes.indexOf(exato) !== -1
      ? exato
      : nomes.filter(function (n) { return n.toLowerCase() === exato.toLowerCase(); })[0];
    // 0.3.3, item 20: `vinculado` fica `undefined` quando nenhum nome casa (o arquivo vinculado nao esta na
    // lista); nenhum `n` e igual a `undefined`, entao nada sai da lista, que e o certo.
    nomes = nomes.filter(function (n) { return n !== vinculado; });
  }
  if (!nomes.length) return null;
  const linhas = ['sworn: frentes de trabalho existentes:'];
  for (const n of nomes) {
    const nome = n.slice(0, n.length - 3);
    linhas.push('  - ' + ascii(nome) + ': ' + objetivoDaFrente(path.join(cwd, PASTA_FRENTES, n), null, PASTA_FRENTES + ascii(n)));
  }
  linhas.push('Editar o arquivo da frente vincula esta sessao a ela; sem vinculo vale ' + ARQUIVO + '.');
  return linhas.join('\n');
}

function motivoIntocavel(alvo) {
  // Plano 082, Tarefa 5 (mock S10): a forma unica dos avisos.
  return [
    'sworn - arquivo intocavel: mexer nele e decisao do dono.',
    '',
    // 0.3.3, item 25: diz onde a lista mora (o nome do campo e `intocaveis`).
    'Este arquivo esta na lista "intocaveis" de .claude/sworn/projeto.json:',
    '  - "' + ascii(alvo) + '"',
    'Nem o escopo declarado libera este caminho.',
    '',
    'Faca uma destas:',
    '  1. siga sem mexer nele; se ele precisar de mudanca, conte ao usuario no fecho do turno;',
    '  2. ou peca ao dono que decida: 3 opcoes, a recomendada primeiro, cada uma com o que muda e o custo.'
  ].join('\n');
}

function motivoOutraFrente(alvo, arquivo) {
  return [
    TRAVA_OUTRA_FRENTE,
    '',
    'O arquivo ' + ascii(alvo) + ' JA aparecia modificado no git status quando esta sessao abriu.',
    'Todo arquivo modificado e nao commitado pertence a outra frente (outra tarefa em andamento neste repositorio) ate prova em contrario.',
    // 0.3.3, item 25: tom neutro; diz o que o arquivo e, sem listar o que ele nao e.
    'Trate-o como trabalho de outra tarefa em andamento: nao o altere por conta propria.',
    '',
    'Se precisar mesmo tocar nele, isso e decisao do dono. Depois de ele autorizar,',
    // 0.3.3, item 25: o que se conta e a ampliacao do escopo (contador escopo_ampliado, em
    // portao-escopo.js), que o portao do fecho mostra no fim do turno (portao-fecho.js).
    'liste o caminho exato em ' + (arquivo || ARQUIVO) + ', na secao "## Dentro". Essa ampliacao do escopo e contada e aparece no fecho do turno.'
  ].concat(avisoDeAcento(alvo, true)).join('\n');
}

module.exports = {
  ARQUIVO, PASTA_FRENTES, parse, carregar, dentro, declaradoFora, ascii, conteudoDepois, ampliou,
  avisoHeranca, frenteDoAlvo, arquivoEmVigor, nomeSeguro,
  motivoSemEscopo, motivoFora, motivoDeclaradoFora, motivoIntocavel, motivoOutraFrente, motivoNomeDeFrente
};
