#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const veredito = require('./lib/veredito.js');
const estado = require('./lib/estado.js');
const cegar = require('./lib/cegar.js');
const caminho = require('./lib/caminho.js');
const textoLib = require('./lib/texto.js');

// F2-01: so e "valor que falta" quando o proximo argumento e outra flag do USO deste script (como o
// FLAGS_DO_USO do preparar-revisao.js): um arquivo chamado `--x.js` vale como caminho.
const FLAGS_DO_USO = ['--sessao', '--arquivo'];

function arg(nome) {
  const i = process.argv.indexOf('--' + nome);
  return i !== -1 ? process.argv[i + 1] : null;
}

const cwd = process.cwd();
const revisao = path.join(cwd, '.claude', 'sworn', 'revisao');

/** As pastas numeradas (as rondas) de uma base, em ordem. */
function rondasDe(base) {
  try {
    return fs.readdirSync(base, { withFileTypes: true })
      .filter(function (e) { return e.isDirectory() && /^\d+$/.test(e.name); })
      .sort(function (a, b) { return parseInt(a.name, 10) - parseInt(b.name, 10); });
  } catch (err) {
    // Ronda 2 da T4: so a pasta ausente e "nenhuma ronda"; outro erro sobe, com a causa.
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
}

/** Os caminhos das mensagens: relativos ao cwd, com barra normal. */
function relDoCwd(p) {
  return path.relative(cwd, p).split(path.sep).join('/');
}

/**
 * O mapa.json de uma ronda, ou null quando nao ha (pacote antigo, sem mapa). 0.3.3, item 6: o que
 * existe e nao se le como o objeto que o preparar-revisao.js grava ({ arquivo, mapa: {...} }) para
 * aqui - antes virava "ronda sem mapa" calado e a ronda contava pelos dois lados.
 * F2-06: na listagem "ha N revisoes" (naListagem) o mapa ruim nao para o comando: lanca MAPA_ILEGIVEL, e a
 * listagem poe "(mapa ilegivel)" na linha da base.
 */
const MAPA_ILEGIVEL = new Error('mapa ilegivel');
function lerMapaJson(base, ronda, naListagem) {
  const arq = path.join(base, ronda, 'mapa.json');
  const corrompido = function (motivo) {
    if (naListagem) throw MAPA_ILEGIVEL;
    falhar('ERRO: ' + relDoCwd(arq) + ' esta corrompido (' + motivo + '). Ele diz qual arquivo a ronda revisou e ' +
      'qual rotulo e o lado novo; sem ele legivel os achados nao se separam por lado. Apague a pasta ' +
      relDoCwd(path.dirname(arq)) + '/ e prepare a ronda de novo (Passo 1 do /sworn:review), regrave os ' +
      'vereditos dela e rode este comando de novo.\n');
  };
  let texto;
  try { texto = fs.readFileSync(arq, 'utf8'); } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    corrompido(textoLib.causaDoErro(err));
  }
  let mj;
  // RV-04 (D422): o PowerShell 5.1 grava JSON com BOM; todo JSON lido daqui passa por semBom.
  try { mj = JSON.parse(textoLib.semBom(texto)); } catch (err) { corrompido(err.message); }
  if (!mj || typeof mj !== 'object' || Array.isArray(mj)) corrompido('nao e um objeto');
  if (!mj.mapa || typeof mj.mapa !== 'object' || Array.isArray(mj.mapa)) corrompido('"mapa" nao e um objeto');
  // D503 (revisao s49): `invertida` torta viraria ronda sem referencia, calada, e a 2a passada sumiria do voto.
  if ('invertida' in mj && (!mj.invertida || typeof mj.invertida !== 'object' || Array.isArray(mj.invertida))) {
    corrompido('"invertida" nao e um objeto');
  }
  // Plano 082 (p2-34): `invertida {}` (ou sem o lado de A e de B) passava aqui e virava excecao do apurar, sem o arquivo.
  if ('invertida' in mj && !veredito.mapaDoTrabalho(mj.invertida)) {
    corrompido('"invertida" nao diz o lado de A e de B: cada um "trabalho" ou "HEAD", e ao menos um "trabalho"');
  }
  return mj;
}

/** O arquivo revisado por uma base: o do mapa.json da ultima ronda dela. */
function arquivoDaBase(base, pastas, naListagem) {
  const rs = pastas || rondasDe(base);
  if (!rs.length) return null;
  const m = lerMapaJson(base, rs[rs.length - 1].name, naListagem);
  return m && typeof m.arquivo === 'string' ? m.arquivo : null;
}

function falhar(texto) {
  process.stdout.write(texto);
  process.exit(1);
}

/**
 * 0.3.2, item 7: o mesmo arquivo em grafias diferentes (barra invertida, "./" na frente) e o mesmo.
 * 0.3.3, item 5: e o "../" no meio do caminho (a/../b) tambem.
 */
function grafiaUnica(p) {
  return path.posix.normalize(String(p).replace(/\\/g, '/')).replace(/^(\.\/)+/, '');
}

/**
 * 0.3.3, item 5: as duas grafias sao o mesmo arquivo. Iguais depois de grafiaUnica, sim. Diferindo so
 * na caixa, quem diz e o disco: os dois existem e tem o mesmo dev+ino (sistema de arquivos que nao
 * distingue a caixa); num que distingue, sao dois nomes e nao se juntam. Sem olhar a plataforma.
 */
function mesmoArquivo(a, b) {
  const x = grafiaUnica(a);
  const y = grafiaUnica(b);
  if (x === y) return true;
  if (x.toLowerCase() !== y.toLowerCase()) return false;
  try {
    const sx = fs.statSync(path.resolve(cwd, x), { bigint: true });
    const sy = fs.statSync(path.resolve(cwd, y), { bigint: true });
    // F2-13: dev ou ino 0 e campo que o sistema de arquivos nao preenche: dois zeros nao confirmam nada.
    if (sx.dev === 0n || sx.ino === 0n) return false;
    return sx.dev === sy.dev && sx.ino === sy.ino;
  } catch (err) {
    // Um dos dois nao existe (ou nao se le): o disco nao confirma que sejam o mesmo arquivo.
    return false;
  }
}

/** A classe do estado.js: letras, numeros, "_" e "-". */
function validarSessao(valor, origem) {
  if (!/^[a-zA-Z0-9_-]+$/.test(valor)) {
    falhar('ERRO: o valor de ' + origem + ' (' + valor + ') nao serve de id de sessao. Use so letras, numeros, ' +
      '"_" e "-" (exemplo: --sessao minha-sessao) e rode de novo.\n');
  }
}

/**
 * 0.3.2, itens 2 e 3: a sessao vem de --sessao ou do ambiente, e vai crua para o fechada.json e para o
 * contador. 0.3.3, item 4: o --sessao e entrada de quem roda - sem valor, ou fora da classe, para aqui,
 * antes de escolher a base, fechando a revisao ou nao. O valor do AMBIENTE so se valida onde vai ser
 * usado (a revisao fecha e o fecho nao foi contado): ambiente ruim nao para uma ronda que nao fecha.
 * Devolve { valor, origem }; valor null = nenhuma sessao.
 */
function sessaoDoUso() {
  const i = process.argv.indexOf('--sessao');
  if (i !== -1) {
    const valor = process.argv[i + 1];
    if (!valor || FLAGS_DO_USO.indexOf(valor) !== -1) {
      falhar('ERRO: --sessao sem valor. Passe o id da sessao: --sessao <id>, ou tire a flag para usar ' +
        'CLAUDE_CODE_SESSION_ID.\n');
    }
    validarSessao(valor, '--sessao');
    return { valor: valor, origem: '--sessao' };
  }
  if (process.env.CLAUDE_CODE_SESSION_ID) {
    return { valor: process.env.CLAUDE_CODE_SESSION_ID, origem: 'CLAUDE_CODE_SESSION_ID' };
  }
  return { valor: null, origem: '' };
}

/**
 * D257 secao 11, item 11: qual base apurar. Uma base por arquivo (revisao/<id>/<n>/); a pasta
 * numerada solta em revisao/ e o formato da 0.3.0, e mantem o comportamento de antes.
 */
function escolherBase() {
  const antigo = cegar.temPastaNumeradaSolta(revisao);
  const alvo = arg('arquivo');
  if (process.argv.indexOf('--arquivo') !== -1 && (!alvo || FLAGS_DO_USO.indexOf(alvo) !== -1)) {
    falhar('ERRO: --arquivo sem caminho. Passe o arquivo revisado: --arquivo <caminho>.\n');
  }
  if (alvo) {
    const rel = caminho.relativoAoProjeto(alvo.replace(/\\/g, '/'), cwd);
    if (rel === null) {
      falhar('ERRO: ' + alvo + ' fica fora da pasta atual. Rode de uma pasta que o contenha, ' +
        'com o caminho relativo a ela.\n');
    }
    const daqui = cegar.baseDoArquivo(revisao, rel);
    if (rondasDe(daqui).length) return daqui;
    if (antigo) {
      // Rondas 1 e 2 da T4: a plana e a revisao de um arquivo (o do mapa.json); a de outro, ou a sem
      // mapa que diga de qual, nao se apura calada.
      const doAntigo = arquivoDaBase(revisao);
      if (doAntigo && mesmoArquivo(doAntigo, rel)) return revisao;
      falhar('ERRO: a revisao no formato antigo (pastas numeradas soltas em revisao/) ' +
        (doAntigo ? 'e de ' + doAntigo + ', nao de ' + rel : 'nao diz de qual arquivo e') +
        '. Apure-a sem --arquivo.\n');
    }
    falhar('ERRO: nao ha revisao de ' + rel + '. Prepare-a antes com preparar-revisao.js --arquivo ' + rel +
      ' (Passo 1 do /sworn:review).\n');
  }
  if (antigo) return revisao;
  let bases = [];
  try {
    bases = fs.readdirSync(revisao, { withFileTypes: true })
      .filter(function (e) { return e.isDirectory() && rondasDe(path.join(revisao, e.name)).length > 0; })
      .map(function (e) { return path.join(revisao, e.name); });
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
    bases = [];
  }
  if (bases.length === 0) {
    falhar('ERRO: nao ha revisao em .claude/sworn/revisao/. Prepare uma com preparar-revisao.js --arquivo ' +
      '<caminho> (Passo 1 do /sworn:review).\n');
  }
  if (bases.length > 1) {
    falhar('ERRO: ha ' + bases.length + ' revisoes em ' + revisao + ' e nao sei qual apurar. Passe --arquivo ' +
      '<caminho> com um destes:\n' + bases.map(function (b) {
        try {
          return '  ' + (arquivoDaBase(b, null, true) || path.basename(b));
        } catch (err) {
          if (err !== MAPA_ILEGIVEL) throw err;
          return '  ' + path.basename(b) + ' (mapa ilegivel)';
        }
      }).join('\n') + '\n');
  }
  return bases[0];
}

const sessaoPedida = sessaoDoUso();

let base;
let pastas;
// 0.3.2, item 1: as pastas de ronda da base escolhida se leem uma vez, aqui, sob este tratamento so
// (causa e proximo passo). Antes havia uma leitura fora de qualquer try e um catch mais abaixo que
// nada alcancava: as rondas ja tinham sido lidas. Cobre tambem o item 5 (mensagem sem proximo passo).
try {
  base = escolherBase();
  pastas = rondasDe(base);
} catch (err) {
  falhar('ERRO: nao consegui ler as revisoes (' + textoLib.causaDoErro(err) + '). Confira a pasta citada e rode de novo.\n');
}
// Os caminhos das mensagens, os da base escolhida.
const baseRel = relDoCwd(base);
const arquivoRevisado = arquivoDaBase(base, pastas);
const mapas = [];
const faixas = [];
const semMapa = [];
const semVeredito = [];
const ilegiveis = [];
const invalidos = [];
// D503 (E8): a 2a passada (ordem A/B trocada) de cada ronda com referencia; null na ronda sem ela.
const invertidas = [];

/**
 * Os vereditos de uma pasta da ronda: `partes` e o caminho dela a partir da base (['1', 'vereditos'] ou
 * ['1', 'invertida', 'vereditos']). O que falta, nao se le ou nao e veredito vai para as listas de erro.
 */
function lerVereditos(nomeRonda, partes, comReferencia, lentesDaOrdemNormal) {
  const dir = path.join.apply(path, [base].concat(partes));
  // 0.3.3, item 1: ronda sem nenhum veredito (pasta ausente, ou sem .json) nao e ronda seca, e voto
  // que falta - e o readdir nao zera mais em qualquer erro: a causa vai na mensagem.
  const dirRel = [baseRel].concat(partes).join('/') + '/';
  let arquivos = null;
  try { arquivos = fs.readdirSync(dir).filter(function (f) { return f.endsWith('.json'); }); } catch (err) {
    if (err && err.code === 'ENOENT') arquivos = [];
    else semVeredito.push('ERRO: nao consegui ler ' + dirRel + ' (' + textoLib.causaDoErro(err) + '). Confira essa pasta e ' +
      'rode este comando de novo.');
  }
  if (arquivos === null) return [];
  if (arquivos.length === 0) {
    // Plano 082, Tarefa 5 (p2-32): sem giria; diz o que e a ordem trocada, o pacote, as lentes que faltam e o efeito.
    // p5-2: cada lente uma vez; o veredito da ordem normal que nao se leu (null) nao tem lente para dizer, e e contado.
    const daOrdemNormal = lentesDaOrdemNormal || [];
    const comLente = daOrdemNormal.filter(function (l) { return typeof l === 'string' && l; });
    const lentes = comLente.filter(function (l, i) { return comLente.indexOf(l) === i; });
    const semLente = daOrdemNormal.length - comLente.length;
    const pacote = [baseRel, nomeRonda].join('/') + '/';
    // p2-29: as duas pastas que se leem aqui sao ['N', 'vereditos'] e ['N', 'invertida', 'vereditos'] (A e B trocados).
    const daOrdemTrocada = partes[1] === 'invertida';
    semVeredito.push(daOrdemTrocada
      ? 'ERRO: a ronda ' + Number(nomeRonda) + ' nao tem nenhum veredito com A e B trocados: ' + dirRel + ' nao existe ou ' +
        'nao tem nenhum .json. Esta ronda tem referencia (R.txt), e cada lente julga duas vezes: na ordem normal e com os ' +
        'lados trocados (o pacote ' + pacote + 'invertida/A.txt e invertida/B.txt). Sem os dois julgamentos, esta ronda ' +
        'nao se apura.' + (lentes.length ? ' Lentes que faltam com os lados trocados: ' + lentes.join(', ') + '.' : '') +
        (semLente ? ' Falta tambem a lente de ' + (semLente === 1 ? '1 veredito' : semLente + ' vereditos') + ' da ordem ' +
          'normal que nao se ' + (semLente === 1 ? 'leu' : 'leram') + ' (o ERRO de veredito ilegivel ou invalido, abaixo, ' +
          'diz qual).' : '') +
        ' Grave o veredito de cada uma em ' + dirRel + ' (Passo 2 do /sworn:review) e rode este comando de novo.'
      : 'ERRO: a ronda ' + Number(nomeRonda) + ' nao tem nenhum veredito: ' + dirRel + ' nao existe ou ' +
        'nao tem nenhum .json. Grave os vereditos dela (Passo 2 do /sworn:review) ou, se a ronda foi preparada ' +
        'por engano, apague a pasta ' + [baseRel, nomeRonda].join('/') + '/, e rode este comando de novo.');
    return [];
  }
  return arquivos.map(function (f) {
    const nome = [baseRel].concat(partes, [f]).join('/');
    let vd;
    try { vd = JSON.parse(textoLib.semBom(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch (err) {
      ilegiveis.push(nome + ': ' + err.message);
      return null;
    }
    const erros = veredito.errosDoVeredito(vd, { comReferencia: comReferencia });
    if (erros.length) { invalidos.push(nome + ': ' + erros.join('; ')); return null; }
    return vd;
  });
}

/**
 * p2-28: a pasta tem ao menos um .json. So a pasta que nao existe (ENOENT) nao tem; a que nao se le por outra causa
 * vai para os erros com a causa (p5-5), senao o voto dela sumiria calado, que e o que o p2-28 existe para evitar.
 */
function temVeredito(dir, dirRel) {
  try { return fs.readdirSync(dir).some(function (f) { return f.endsWith('.json'); }); } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    semVeredito.push('ERRO: nao consegui ler ' + dirRel + ' (' + textoLib.causaDoErro(err) + '). Confira essa pasta e ' +
      'rode este comando de novo.');
    return false;
  }
}

const rondas = pastas
  .map(function (e) {
    // D244/defeito 3: o mapa diz qual rotulo e o lado novo. Sem ele (pacote antigo), a ronda
    // e contada como antes, pelos dois lados, e a saida diz que foi assim.
    const mj = lerMapaJson(base, e.name);
    let mapa = (mj && mj.mapa) || null;
    // D503 (E8): o pacote com referencia grava `invertida` (o mapa da ordem trocada) no mapa.json.
    let mapaInv = mj && mj.invertida && typeof mj.invertida === 'object' && !Array.isArray(mj.invertida) ? mj.invertida : null;
    // RV-01 (D422): arquivo igual ao HEAD (mapa.json com identico:true) nao tem lado antigo: o inspetor cita A
    // ou B ao acaso, e os dois rotulos sao o trabalho. Mapa sem o campo conta como sempre.
    if (mapa && mj.identico === true) mapa = { A: 'trabalho', B: 'trabalho' };
    if (mapaInv && mj.identico === true) mapaInv = { A: 'trabalho', B: 'trabalho' };
    if (!mapa) semMapa.push(Number(e.name));
    // Plano 082 (p2-28): sem `invertida` no mapa.json a pasta invertida/vereditos/ nunca se le; o voto dela nao some calado.
    if (!mapaInv && temVeredito(path.join(base, e.name, 'invertida', 'vereditos'),
      [baseRel, e.name, 'invertida', 'vereditos'].join('/') + '/')) {
      const ronda = [baseRel, e.name].join('/') + '/';
      semVeredito.push('ERRO: a ronda ' + Number(e.name) + ' tem vereditos com A e B trocados em ' + ronda +
        'invertida/vereditos/, mas o mapa.json dela nao tem "invertida": eles nao entrariam na conta. Se a ronda tem ' +
        'referencia (R.txt), o mapa.json perdeu a chave: apague a pasta ' + ronda + ', prepare a ronda de novo (Passo 1 ' +
        'do /sworn:review) e regrave os vereditos. Se nao tem, apague a pasta ' + ronda + 'invertida/. Depois rode ' +
        'este comando de novo.');
    }
    mapas.push(mapa);
    // L3 (A3-03): a faixa que o preparar-revisao.js gravou; com a da ronda 1, o apurar confere as lentes.
    faixas.push(mj && typeof mj.faixa === 'string' ? mj.faixa : null);
    const pass1 =lerVereditos(e.name, [e.name, 'vereditos'], mapaInv !== null);
    invertidas.push(mapaInv ? { mapa: mapaInv, vereditos: lerVereditos(e.name, [e.name, 'invertida', 'vereditos'], true,
      pass1.map(function (v) { return v && v.lente; })) } : null);
    return pass1;
  });

// D218 (ronda 1 do 8c.5): o veredito que nao se lia virava empate sem achados e contava a
// ronda como seca. Um voto que falta nao e voto a favor: para aqui, antes de apurar e de
// contar a revisao como fechada. D223 e D228 (ronda 2 do 8c.10): o que se le mas nao e
// veredito tambem e voto que falta, e para do mesmo jeito.
if (semVeredito.length || ilegiveis.length || invalidos.length) {
  for (const i of semVeredito) process.stdout.write(i + '\n');
  for (const i of ilegiveis) process.stdout.write('ERRO: veredito ilegivel em ' + i + '\n');
  for (const i of invalidos) process.stdout.write('ERRO: veredito invalido em ' + i + '\n');
  if (ilegiveis.length || invalidos.length) {
    process.stdout.write('Regrave cada um como o JSON do veredito - lente, melhor (A, B ou empate) e a ' +
      'lista de achados - e rode este comando de novo.\n');
  }
  process.exit(1);
}

// D244/defeito 3: achado refutado na fonte primaria, com a prova. Arquivo que nao se le e
// erro, como veredito ilegivel: refutacao que falta nao pode virar ronda molhada calada.
let refutados = [];
const arqRefutados = path.join(base, 'refutados.json');
if (fs.existsSync(arqRefutados)) {
  try { refutados = JSON.parse(textoLib.semBom(fs.readFileSync(arqRefutados, 'utf8'))); } catch (err) {
    // 0.3.2, item 4: o erro cita o arquivo (cada base tem o seu) e diz o que fazer.
    process.stdout.write('ERRO: ' + baseRel + '/refutados.json ilegivel (' + err.message + '). Corrija o JSON ' +
      'ou apague o arquivo se nao ha refutacao, e rode este comando de novo.\n');
    process.exit(1);
  }
  // 0.3.3, item 3: o que se le mas nao e lista virava [] calado no apurar, e a refutacao sumia.
  if (!Array.isArray(refutados)) {
    process.stdout.write('ERRO: ' + baseRel + '/refutados.json nao e uma lista (veio ' +
      (refutados === null ? 'null' : typeof refutados) + '). A forma e uma lista de refutacoes, e [] quando nao ' +
      'ha refutacao. Corrija o arquivo e rode este comando de novo.\n');
    process.exit(1);
  }
}

// D387 (#11c): a resposta do juiz-mesmo. Mesmo tratamento do refutados.json: ausente = nada muda;
// ilegivel ou fora da forma = erro. Ela so alimenta provaveisMesmos: nao entra em nenhuma conta.
let mesmos;
const arqMesmos = path.join(base, 'mesmos.json');
if (fs.existsSync(arqMesmos)) {
  try { mesmos = JSON.parse(textoLib.semBom(fs.readFileSync(arqMesmos, 'utf8'))); } catch (err) {
    process.stdout.write('ERRO: ' + baseRel + '/mesmos.json ilegivel (' + err.message + '). Corrija o JSON ' +
      'ou apague o arquivo se o juiz nao respondeu, e rode este comando de novo.\n');
    process.exit(1);
  }
  if (!Array.isArray(mesmos)) {
    process.stdout.write('ERRO: ' + baseRel + '/mesmos.json nao e uma lista (veio ' +
      (mesmos === null ? 'null' : typeof mesmos) + '). A forma e uma lista de { novo, outro, resposta }, e [] ' +
      'quando o juiz nao achou par. Corrija o arquivo ou apague-o, e rode este comando de novo.\n');
    process.exit(1);
  }
}

// D475 (s99): o texto da linha citada, do A.txt/B.txt da propria ronda. Linha reescrita entre rondas com a mesma
// chave e evidencia nova. Arquivo que falta ou linha fora dele = null, e a conta fica a de antes. Arquivo que existe e
// nao se le (permissao, pasta no lugar) para com a causa, como o resto deste script (s104).
const linhasDe = new Map();
function textoDaLinha(indice, rotulo, linha, passada) {
  // D503 (E7): o achado da 2a passada cita o A.txt/B.txt de invertida/, que sao os lados trocados.
  const partes = [pastas[indice].name].concat(passada === 2 ? ['invertida'] : [], [rotulo + '.txt']);
  const arq = path.join.apply(path, [base].concat(partes));
  if (!linhasDe.has(arq)) {
    let linhas = null;
    try { linhas = textoLib.semBom(fs.readFileSync(arq, 'utf8')).split(/\r?\n/); } catch (err) {
      if (!err || err.code !== 'ENOENT') {
        process.stdout.write('ERRO: nao consegui ler ' + [baseRel].concat(partes).join('/') + ' (' +
          textoLib.causaDoErro(err) + '). Confira esse arquivo e rode este comando de novo.\n');
        process.exit(1);
      }
    }
    linhasDe.set(arq, linhas);
  }
  const linhas = linhasDe.get(arq);
  const n = Number.isInteger(linha) ? linha : parseInt(linha, 10);
  return linhas && n >= 1 && n <= linhas.length ? linhas[n - 1] : null;
}

// Colheita 10-20, lote 3/4a: o trecho do achado confirmado tem de estar na linha citada ou ate 2 acima ou abaixo
// (o inspetor erra a linha por pouco), com os espacos normalizados. Arquivo que falta = null: conta como antes.
const VIZINHAS = 2;
function semEspaco(s) { return String(s).replace(/\s+/g, ' ').trim(); }
function trechoNoArquivo(indice, rotulo, linha, trecho, passada) {
  const n = Number.isInteger(linha) ? linha : parseInt(linha, 10);
  if (textoDaLinha(indice, rotulo, 1, passada) === null) return null;
  const perto = [];
  for (let k = n - VIZINHAS; k <= n + VIZINHAS; k++) {
    const t = textoDaLinha(indice, rotulo, k, passada);
    if (t !== null) perto.push(t);
  }
  return semEspaco(perto.join('\n')).indexOf(semEspaco(trecho)) !== -1;
}

let r;
try {
  r = veredito.apurar(rondas, { mapas: mapas, refutados: refutados, mesmos: mesmos, textoDaLinha: textoDaLinha,
    trechoNoArquivo: trechoNoArquivo, invertidas: invertidas, faixas: faixas });
} catch (err) {
  // 0.3.3, item 7: o erro diz o defeito; a linha seguinte diz onde corrigir e o que fazer depois.
  // L3 (A3-03): o voto que falta ja diz o que fazer; a linha da refutacao nao e com ele.
  if (err.codigo === 'VOTO_QUE_FALTA') falhar('ERRO: ' + err.message + '.\n');
  const doMesmos = err.message.indexOf('mesmos.json') !== -1;
  process.stdout.write('ERRO: ' + err.message + '\n' + (doMesmos
    ? 'Corrija ' + baseRel + '/mesmos.json (ou apague o arquivo) e rode este comando de novo.\n'
    : 'Corrija a refutacao em ' + baseRel + '/refutados.json (ou o veredito que o erro cita) e rode este comando de novo.\n'));
  process.exit(1);
}
const descartados = [];
rondas.forEach(function (ronda, i) {
  const comReferencia = invertidas[i] !== null;
  const todos = comReferencia ? ronda.concat(invertidas[i].vereditos) : ronda;
  for (const vd of todos) {
    for (const e of veredito.validarVeredito(vd, { comReferencia: comReferencia }).erros) descartados.push(e);
  }
});
for (const t of r.trechoNaoConfere) {
  descartados.push('achado confirmado cujo trecho nao esta em ' + t.arquivo + ':' + t.linha + ' (nem 2 linhas acima ou ' +
    'abaixo), descartado (ronda ' + t.ronda + ', lente ' + t.lente + '): "' + String(t.trecho).slice(0, 60) + '"');
}
// L3 (A3-05): o achado fora do formato segue descartado sem travar a ronda (D422), mas a aprovacao diz que houve.
if (r.encerrar && r.motivo === 'duas rondas secas seguidas: aprovado' && descartados.length) {
  r.motivo += ', com ' + descartados.length + ' achado(s) descartado(s) por estar fora do formato: leia ' +
    'vereditosDescartados antes de dar por aprovado';
}

/**
 * D21/D120: "2+ revisoes independentes fechadas" e gatilho contavel de troca de chat, e ate aqui
 * ninguem incrementava a chave que o saude.js le. So conta quando a revisao FECHA — contador
 * inflado e D14 sem base. Este script e CLI, nao hook: a sessao vem de --sessao ou do ambiente.
 */
let contada = null;
if (r.encerrar) {
  // D257 secao 11, item 12: o fecho fica registrado na base (fechada.json). Apurar de novo a mesma
  // ronda ja fechada nao conta outra vez; ronda nova e outro fecho, e conta.
  const arqFechada = path.join(base, 'fechada.json');
  let previa = null;
  // Ronda 1 da T4: ilegivel e erro, como o refutados.json - recontar calado inflava o gatilho.
  if (fs.existsSync(arqFechada)) {
    try { previa = JSON.parse(textoLib.semBom(fs.readFileSync(arqFechada, 'utf8'))); } catch (err) {
      falhar('ERRO: ' + baseRel + '/fechada.json ilegivel (' + err.message + '). Ele registra o fecho ja ' +
        'contado desta revisao. Apague-o e rode de novo: o fecho sera contado outra vez.\n');
    }
    // 0.3.2, item 6: o que se le mas nao e o registro do fecho ({}, 5, [], null, "ronda" que nao e
    // inteira) tambem nao diz se o fecho foi contado; recontar calado inflava o gatilho.
    if (!previa || typeof previa !== 'object' || Array.isArray(previa) || !Number.isInteger(previa.ronda)) {
      falhar('ERRO: ' + baseRel + '/fechada.json nao tem o formato esperado (um objeto com "ronda" inteira). ' +
        'Ele registra o fecho ja contado desta revisao. Apague-o e rode de novo: o fecho sera contado outra vez.\n');
    }
  }
  if (previa && previa.ronda === r.ronda) {
    contada = { jaContada: true, sessao: previa.sessao };
  } else {
    // 0.3.3, item 4: o valor do ambiente so se valida aqui, onde vai ser usado - antes de contar e de gravar.
    if (sessaoPedida.origem === 'CLAUDE_CODE_SESSION_ID') validarSessao(sessaoPedida.valor, sessaoPedida.origem);
    const sessao = sessaoPedida.valor || 'sem-sessao';
    // Conta antes de gravar: fechada.json existir quer dizer que o fecho foi contado.
    let n;
    try {
      // D503 (plano d503, Tarefa 5): com referencia, o fecho conta tambem em revisao_referencia_fechada, que o portao
      // de fecho le para saber se a entrega AAA ja foi revisada contra a referencia de topo nesta sessao. As duas
      // contagens numa gravacao so: se falhar, nenhuma entrou, e rodar de novo nao reconta a primeira.
      // A5-57 (D735): `contadores` e do turno e zera no Stop (portao-fecho.js:25-29); a saida, ao lado da `sessao`,
      // da o total da sessao pelo saude.acumular, a mesma conta que o gatilho de saude le.
      n = require('./lib/saude.js').acumular(estado.alterar(sessao, function (s) {
        s.contadores = s.contadores || {};
        s.contadores.revisao_fechada = (s.contadores.revisao_fechada || 0) + 1;
        if (r.referencia) s.contadores.revisao_referencia_fechada = (s.contadores.revisao_referencia_fechada || 0) + 1;
        // Plano 091 (#1, D559): so o "aprovado" (nao o teto) libera o arquivo no portao do commit; o marcar-trabalho.js
        // o tira da lista quando ele e editado de novo.
        if (arquivoRevisado && /aprovado/.test(String(r.motivo))) {
          s.revisadosAprovados = require('./lib/commit.js').comAprovado(s.revisadosAprovados,
            path.resolve(process.cwd(), arquivoRevisado));
        }
        return s;
      })).revisao_fechada;
    } catch (err) {
      falhar('ERRO: a revisao fechou, mas o fecho nao foi contado (' + err.message + '). Rode este comando de novo.\n');
    }
    try {
      fs.writeFileSync(arqFechada, JSON.stringify({ ronda: r.ronda, sessao: sessao, motivo: r.motivo }, null, 2),
        'utf8');
    } catch (err) {
      falhar('ERRO: o fecho foi contado, mas ' + baseRel + '/fechada.json nao foi gravado (' + err.message + '). ' +
        'Corrija a gravacao nessa pasta antes de rodar de novo: rodar agora conta o fecho outra vez.\n');
    }
    contada = { sessao: sessao, revisao_fechada: n };
    // 0.3.3, item 8: sem sessao o fecho cai em "sem-sessao", que nenhuma sessao le. O aviso nao manda rodar
    // de novo: o fechada.json ja registra o fecho e rodar de novo nao o recontaria.
    // Plano 082, Tarefa 5 (p2-2, p2-33): o efeito pratico, e a comparacao com a referencia quando houve.
    if (!sessaoPedida.valor) {
      contada.aviso = 'esta revisao fechou, mas o fecho nao entrou no contador de nenhuma sessao: sem --sessao e sem ' +
        'CLAUDE_CODE_SESSION_ID, ele foi contado em "sem-sessao", que nenhuma sessao le. ' +
        (r.referencia ? 'A comparacao com a referencia tambem nao entrou: o portao de fecho desta sessao segue cobrando ' +
          'essa comparacao; se ele cobrar, diga ao usuario que ela fechou aqui. ' : '') +
        'Ela ja esta registrada em ' + baseRel + '/fechada.json e nao precisa ser refeita; na proxima revisao, passe ' +
        '--sessao <id>.';
    }
  }
}

process.stdout.write(JSON.stringify({
  arquivo: arquivoRevisado,
  ronda: r.ronda,
  rondasSecas: r.secas,
  encerrar: r.encerrar,
  motivo: r.motivo,
  placarDaUltimaRonda: r.placar,
  achadosNovosP0P1: r.novos,
  achadosDoLadoAntigo: r.achadosDoLadoAntigo,
  refutados: r.refutados,
  paresCandidatos: r.paresCandidatos,
  provaveisMesmos: r.provaveisMesmos,
  referencia: r.referencia,
  pendentes: r.pendentes,
  trechoNaoConfere: r.trechoNaoConfere,
  rondasSemMapa: semMapa,
  vereditosDescartados: descartados,
  revisaoFechadaContada: contada,
  lembrete: 'placar A/B e sinal; o achado com arquivo:linha e a prova'
}, null, 2) + '\n');
process.exit(0);
