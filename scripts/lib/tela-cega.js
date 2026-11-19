'use strict';
// E1 parte 2 (D827): a foto de cada lado dentro da revisao cega. O preparar-revisao.js fotografa o antes (a versao do
// HEAD rodando em algum endereco) e o depois (o trabalho) pelo scripts/capturar-tela.js e grava cada foto com o rotulo
// cego do lado: A.png e A.evidencia.json, B.png e B.evidencia.json. O inspetor recebe a foto e a evidencia sem o que
// denuncia o lado (o endereco, a hora, a duracao); isso fica no mapa.json, que o inspetor nao abre, e volta no fecho
// pelo apurar-ronda.js.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fileURLToPath } = require('node:url');
const captura = require('./captura.js');
const textoLib = require('./texto.js');
const { ehObjeto } = textoLib;

const SCRIPT = path.join(__dirname, '..', 'capturar-tela.js');
// O prazo de cada captura: os 30 s padrao do --tempo-max do script, mais abrir e fechar o navegador e esperar o perfil
// temporario sair (ate 30 s), com folga para a maquina carregada.
const PRAZO_DA_CAPTURA = 120000;
// O que entra no lugar do endereco da pagina no texto que o inspetor le.
const NO_LUGAR_DA_PAGINA = '[pagina]';

// Os nomes da propria maquina: a pagina aberta por um aparece pelos outros no console e nos erros.
const MESMA_MAQUINA = ['localhost', '127.0.0.1', '[::1]'];
// A porta que o endereco nao escreve, e que o texto pode escrever por extenso.
const PORTA_PADRAO = { 'http:': '80', 'https:': '443' };

// O mesmo endereco escrito de dois jeitos (barra no fim, host em maiuscula, outro nome da propria maquina) e o
// mesmo: compara a forma do URL, com os nomes da propria maquina trocados por um so.
// Os dois ja passaram pelo ehUrl do conferirTelas.
function mesmoEndereco(a, b) {
  const forma = function (t) {
    const u = new URL(t);
    if (MESMA_MAQUINA.indexOf(u.hostname) !== -1) u.hostname = 'localhost';
    return u.href;
  };
  return forma(a) === forma(b);
}

// Endereco que a captura aceita: URL com http, https ou file (localhost:3000, sem protocolo, o URL le como protocolo
// "localhost:" e nao serve).
const ehUrl = function (t) {
  try { return ['http:', 'https:', 'file:'].indexOf(new URL(t).protocol) !== -1; } catch (e) { return false; }
};

/** Erro de uso das duas flags, ou null. O texto do erro nao leva segredo do endereco. */
function conferirTelas(antes, depois) {
  if (antes && !depois) {
    return '--tela-antes pede --tela-depois: sem a foto do trabalho nao ha o que comparar. Passe o endereco da versao ' +
      'nova em --tela-depois';
  }
  for (const [flag, valor] of [['--tela-antes', antes], ['--tela-depois', depois]]) {
    if (valor && !ehUrl(valor)) {
      return flag + ' nao e um endereco: "' + captura.semSegredo(valor) + '". Passe o endereco inteiro, com http://, ' +
        'https:// ou file:/// (exemplo: http://localhost:3000)';
    }
  }
  if (antes && depois && mesmoEndereco(antes, depois)) {
    return '--tela-antes e --tela-depois sao o mesmo endereco ("' + captura.semSegredo(depois) + '"): as duas fotos ' +
      'seriam da mesma versao. Rode a versao de antes da mudanca em outro endereco (uma copia do projeto sem a ' +
      'mudanca, em outra pasta ou em outra porta) e passe esse endereco em --tela-antes';
  }
  return null;
}

// Os pedacos de endereco que denunciam o lado: a origem (http://localhost:3001, com os outros nomes da propria
// maquina e, sem porta escrita, com a padrao por extenso) ou, num arquivo local, a pasta dele (file:///C:/copia/),
// nas grafias em que ela aparece (%20, o espaco e o caminho do sistema, C:\copia\). O endereco que nao e URL nao da
// prefixo: o capturar-tela.js so aceita http, https e file validos, entao a evidencia dele sempre traz um URL.
function prefixosDoEndereco(url) {
  let u;
  try { u = new URL(String(url)); } catch (e) { return []; }
  if (u.protocol !== 'file:') {
    if (!u.origin || u.origin === 'null') return [];
    const hosts = MESMA_MAQUINA.indexOf(u.hostname) === -1 ? [u.hostname] : MESMA_MAQUINA;
    const portas = u.port ? [':' + u.port] : ['', PORTA_PADRAO[u.protocol] ? ':' + PORTA_PADRAO[u.protocol] : ''];
    const lista = new Set();
    for (const h of hosts) for (const p of portas) lista.add(u.protocol + '//' + h + p);
    return Array.from(lista);
  }
  // A pasta vem do caminho, sem a busca e o fragmento: uma barra neles nao e pasta.
  const semBusca = u.href.split(/[?#]/)[0];
  const pasta = semBusca.slice(0, semBusca.lastIndexOf('/') + 1);
  const lista = new Set([pasta]);
  try { lista.add(decodeURI(pasta)); } catch (e) { /* sequencia % torta: so a grafia original */ }
  try { lista.add(fileURLToPath(pasta)); } catch (e) { /* pasta que o sistema nao escreve como caminho */ }
  return Array.from(lista).filter(Boolean);
}

// O que nao pode vir logo depois do prefixo para ele ser trocado (um lookahead negativo de regex). A origem so e
// trocada inteira: depois de uma porta, um digito continua a porta; depois de um host, continuam letra, digito,
// hifen, ponto seguido de letra (outro dominio) e dois-pontos seguido de digito (outra porta). O ponto final de uma
// frase nao continua nada.
const DEPOIS_DA_PASTA = ''; // a pasta termina na barra: nada a conferir
const DEPOIS_DA_PORTA = '(?!\\d)'; // outro digito seria outra porta
const DEPOIS_DO_HOST = '(?![\\w-]|\\.[\\w-]|:\\d)'; // letra, hifen, outro dominio ou uma porta
function limiteDoPrefixo(p) {
  if (/[\\/]$/.test(p)) return DEPOIS_DA_PASTA;
  return /:\d+$/.test(p) ? DEPOIS_DA_PORTA : DEPOIS_DO_HOST;
}

// Troca cada prefixo por [pagina] sem maiuscula ou minuscula importar (C: e c:, LOCALHOST); a pasta, que termina na
// barra, e trocada onde aparece, e a origem so com o limite do limiteDoPrefixo.
function trocarPrefixos(texto, prefixos) {
  let s = String(texto == null ? '' : texto);
  for (const p of prefixos) {
    const escapado = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pasta = /[\\/]$/.test(p);
    s = s.replace(new RegExp(escapado + limiteDoPrefixo(p), 'gi'), pasta ? NO_LUGAR_DA_PAGINA + p.slice(-1) : NO_LUGAR_DA_PAGINA);
  }
  return s;
}

// O valor quando e um objeto, ou {}.
const objetoOuVazio = function (v) { return ehObjeto(v) ? v : {}; };
// So os itens que sao objeto: um item torto (texto solto, null, lista) fica fora da evidencia do inspetor.
const soObjetos = function (v) { return Array.isArray(v) ? v.filter(ehObjeto) : []; };
// Quantas entradas de console e de erros o inspetor le, no maximo: a pagina que despeja milhares de mensagens nao
// enche o contexto dele. O evidencia.json do capturar-tela.js guarda todas; a evidencia cega diz quantas ficaram fora.
const ENTRADAS_DO_INSPETOR = 100;
// O numero finito e nao negativo, ou null: largura, altura, linha e coluna nao sao negativas.
const numeroOuNulo = function (v) { return Number.isFinite(v) && v >= 0 ? v : null; };
const textoOuNulo = function (v) { return typeof v === 'string' ? v : null; };
// O status HTTP de verdade (100 a 599), ou null.
const statusOuNulo = function (v) { return Number.isInteger(v) && v >= 100 && v <= 599 ? v : null; };

/**
 * A evidencia que o inspetor le: a do capturar-tela.js sem o endereco, a hora, a duracao e o navegador, e com o
 * endereco da pagina trocado por [pagina] no console, nos erros e nos nomes da acessibilidade.
 */
function evidenciaCega(ev, rotulo) {
  const e = objetoOuVazio(ev);
  // O mais comprido primeiro: a pasta de um arquivo pode conter a de outro.
  const prefixos = Array.from(new Set(prefixosDoEndereco(e.url).concat(prefixosDoEndereco(e.urlFinal))))
    .sort(function (a, b) { return b.length - a.length; });
  // O endereco da pagina vira [pagina] e, por garantia, o segredo que a pagina escreveu sai (o capturar-tela.js ja o
  // tira antes de gravar, mas a evidencia cega nao depende disso).
  const tirar = function (t) { return captura.semSegredo(trocarPrefixos(t, prefixos)); };
  const acess = objetoOuVazio(e.acessibilidade);
  const doConsole = soObjetos(e.console);
  const dosErros = soObjetos(e.erros);
  const dosDialogos = soObjetos(e.dialogos);
  const out = {
    textoDaPagina: captura.TEXTO_DA_PAGINA, // H10-1: da constante, nunca da evidencia (a pagina nao troca o aviso)
    imagem: rotulo + '.png',
    sha256: textoOuNulo(e.sha256),
    status: statusOuNulo(e.status),
    largura: numeroOuNulo(e.largura),
    altura: numeroOuNulo(e.altura),
    alturaDaPagina: numeroOuNulo(e.alturaDaPagina),
    cortada: e.cortada === true,
    console: doConsole.slice(0, ENTRADAS_DO_INSPETOR).map(function (c) { return { tipo: tirar(c.tipo || 'log'), texto: tirar(c.texto) }; }),
    erros: dosErros.slice(0, ENTRADAS_DO_INSPETOR).map(function (x) {
      return { texto: tirar(x.texto), url: tirar(x.url), linha: numeroOuNulo(x.linha), coluna: numeroOuNulo(x.coluna) };
    }),
    // Quantas entradas ficaram fora do teto, em cada lista (0 quando cabem todas); nos dialogos, somam os que a
    // captura ja so contou (dialogosForaDoTeto).
    foraDoTeto: { console: Math.max(0, doConsole.length - ENTRADAS_DO_INSPETOR),
      erros: Math.max(0, dosErros.length - ENTRADAS_DO_INSPETOR),
      dialogos: Math.max(0, dosDialogos.length - ENTRADAS_DO_INSPETOR) + (numeroOuNulo(e.dialogosForaDoTeto) || 0) },
    acessibilidade: { itens: soObjetos(acess.itens).map(function (i) { return { papel: tirar(i.papel || ''), nome: tirar(i.nome) }; }),
      cortada: acess.cortada === true },
    // H10-2: o dialogo que a pagina abriu, sem o endereco e sem o segredo
    dialogos: dosDialogos.slice(0, ENTRADAS_DO_INSPETOR).map(function (d) {
      return { tipo: tirar(d.tipo || ''), mensagem: tirar(d.mensagem) };
    }),
  };
  // H10-3: as requisicoes ainda em voo na hora da foto (a tela pode estar pela metade)
  if (numeroOuNulo(e.requisicoesPendentes) > 0) out.requisicoesPendentes = e.requisicoesPendentes;
  return out;
}

/** O que vai para o mapa.json e volta no fecho: de onde e quando veio a foto, e o que ela registrou. */
function resumoDoFecho(ev, rotulo) {
  const e = objetoOuVazio(ev);
  // Conta o que o inspetor ve: so os itens que sao objeto, como a evidenciaCega.
  const conta = function (v) { return soObjetos(v).length; };
  return {
    rotulo: rotulo,
    url: textoOuNulo(e.url),
    urlFinal: textoOuNulo(e.urlFinal),
    status: statusOuNulo(e.status),
    hora: textoOuNulo(e.hora),
    sha256: textoOuNulo(e.sha256),
    console: conta(e.console),
    erros: conta(e.erros),
    acessibilidade: conta(objetoOuVazio(e.acessibilidade).itens),
    cortada: e.cortada === true,
  };
}

/**
 * Roda o capturar-tela.js num endereco, gravando em `pasta`. Devolve { evidencia, imagem, aviso } ou { erro }. O
 * `rodar` existe para o teste trocar o processo.
 */
function capturar(url, pasta, rodar) {
  const r = (rodar || spawnSync)(process.execPath, [SCRIPT, '--url', url, '--saida', pasta],
    { encoding: 'utf8', timeout: PRAZO_DA_CAPTURA, windowsHide: true });
  const onde = captura.semSegredo(url);
  // O proximo passo. O comando sugerido nao leva o endereco: o texto que a pessoa cola no terminal nao carrega nada
  // vindo de fora, e nenhuma aspa, crase ou $(...) do endereco chega ao shell (bash, PowerShell ou outro).
  const deNovo = '. Rode de novo; se repetir, rode a captura sozinha, com o mesmo endereco, que mostra o erro inteiro ' +
    'no terminal: node scripts/capturar-tela.js --url <o endereco> --saida <uma pasta vazia>';
  if (r.error) {
    return { erro: 'a captura de ' + onde + (r.error.code === 'ETIMEDOUT'
      ? ' nao terminou em ' + PRAZO_DA_CAPTURA / 1000 + ' s'
      : ' nao rodou: ' + textoLib.causaDoErro(r.error)) + deNovo };
  }
  const saida = String(r.stdout || '').trim();
  // O que o processo imprimiu, sem segredo e cortado: o script poe o endereco limpo, mas uma pilha no stderr nao.
  const trecho = function (t) { return Array.from(captura.semSegredo(t)).slice(0, 300).join(''); };
  if (r.status !== 0) {
    // O ERRO do script ja diz o que fazer; sem ele, o stderr (uma falha do proprio Node) ou o sinal que o parou.
    const texto = trecho((saida || String(r.stderr || '').trim()).replace(/^ERRO:\s*/, '').replace(/\r?\n/g, '; '));
    const como = r.signal ? 'parou pelo sinal ' + r.signal : r.status === null ? 'parou sem codigo de saida' :
      'saiu com ' + r.status;
    return { erro: 'a captura de ' + onde + ' falhou: ' + (texto || como + ' sem mensagem') + deNovo };
  }
  return lerResultado(saida, { inicio: 'a captura de ' + onde + ' ', deNovo: deNovo, cortar: trecho });
}

// O codigo de erro do sistema em palavras, com o codigo entre parenteses (a traducao e a do projeto, texto.js). Sem
// codigo, o erro e do JSON.parse: o arquivo esta corrompido.
function causaDoErro(e) {
  return e && e.code ? textoLib.causaDoErro(e) : 'o arquivo esta corrompido';
}

// O que o capturar-tela.js imprimiu ao terminar bem: so e sucesso com o caminho da foto e da evidencia, a foto no
// disco e a evidencia legivel como objeto com a marca da foto (o sha256, que o script sempre grava). As mensagens de
// erro vem do `msg` que o capturar monta: `inicio` (o texto), `deNovo` (o texto do proximo passo) e `cortar` (a
// funcao que limpa o segredo e corta o que o processo imprimiu).
function lerResultado(saida, msg) {
  // O que ela imprimiu vai na mensagem; o motivo do JSON.parse, em ingles tecnico, nao acrescenta nada a isso.
  let fim = null;
  try { fim = JSON.parse(saida); } catch (e) { fim = null; }
  if (!fim || typeof fim !== 'object' || typeof fim.evidencia !== 'string' || typeof fim.imagem !== 'string') {
    return { erro: msg.inicio + 'terminou sem dizer onde gravou a foto; ela imprimiu "' + msg.cortar(saida) + '"' +
      msg.deNovo };
  }
  // A causa do stat vai na mensagem: "nao existe" e "sem permissao" se procuram em lugares diferentes.
  let semFoto = '';
  try { if (!fs.statSync(fim.imagem).isFile()) semFoto = 'nao e um arquivo'; } catch (e) {
    semFoto = 'nao se abre: ' + causaDoErro(e);
  }
  if (semFoto) {
    return { erro: msg.inicio + 'disse que gravou a foto em "' + msg.cortar(fim.imagem) + '", mas ela ' + semFoto + msg.deNovo };
  }
  // A evidencia e o arquivo com o que a pagina registrou (as mensagens do console, os erros, a lista do que se le).
  const quebrada = msg.inicio + 'gravou a foto, mas o arquivo com o que a pagina registrou (evidencia.json) ';
  let evidencia;
  try { evidencia = JSON.parse(fs.readFileSync(fim.evidencia, 'utf8')); } catch (e) {
    return { erro: quebrada + 'nao se le: ' + causaDoErro(e) + '; a captura ficou pela metade' + msg.deNovo };
  }
  if (!ehObjeto(evidencia) || typeof evidencia.sha256 !== 'string') {
    return { erro: quebrada + 'veio vazio ou incompleto (sem a marca que identifica a foto): a captura ficou pela ' +
      'metade' + msg.deNovo };
  }
  return { evidencia: evidencia, imagem: fim.imagem, aviso: textoOuNulo(fim.aviso) };
}

module.exports = {
  conferirTelas, prefixosDoEndereco, evidenciaCega, resumoDoFecho, capturar, ENTRADAS_DO_INSPETOR
};
