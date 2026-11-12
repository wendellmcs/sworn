'use strict';
const fs = require('node:fs');
const path = require('node:path');
const retomar = require('./retomar.js');

// Colheita 10-20, item 10 (D674): cada pedido do dono vira uma linha numerada na lista da frente, gravada pelo gancho de
// entrada (abrir-turno.js), sem o Claude. O /sworn:handoff le a lista, e nada do que o dono pediu depende de o agente
// lembrar. Texto limpo e mascarado como o resumo da volta (retomar.js); nada sai da maquina.

const CHAVE = 'pedidos';
const PASTA = '.claude/sworn/pedidos';
const SEM_FRENTE = 'sem-frente';
const CORTE = 600;
const NUMERADA = /^\d+\. /;
// R3b (D833): o prompt de handoff colado (a retomada de um chat) cita o arquivo do handoff e e longo; nao e pedido.
// 182 dos 196 itens do sem-frente.md desta frente eram isso. O caminho citado vai inteiro (pasta e nome).
const HANDOFF_CITADO = /[\w./\\:-]*handoff[\w./\\-]*\.md/i;
const PROMPT_LONGO = 300;
// R3c (D833): o estado de cada pedido, na propria linha: `[feito: <evidencia>]`, `[recusado: <decisao>]` ou
// `[respondido: <o que>]` (a pergunta que nao pedia mudanca). Sem marca, o pedido esta aberto: o /sworn:handoff e o
// fecho leem os abertos, e "o que o dono pediu e vale para o plugin" nao depende de o agente lembrar.
const ESTADOS = ['feito', 'recusado', 'respondido'];
const MARCA = new RegExp('\\s\\[(' + ESTADOS.join('|') + '): [^\\]\\n]*\\]$');
// o numero do pedido que cabe numa conta exata (acima de 2^53 o i++ nao anda e o laco nao acaba)
const MAIOR_NUMERO = 1000000;

/** Ligado por padrao. So o booleano `false` desliga (D388, D415). */
function ligada(projeto) {
  return !(projeto && typeof projeto === 'object' && projeto[CHAVE] === false);
}

function doisDigitos(n) { return (n < 10 ? '0' : '') + n; }

function carimbo(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + doisDigitos(d.getMonth() + 1) + '-' + doisDigitos(d.getDate()) + ' ' +
    doisDigitos(d.getHours()) + ':' + doisDigitos(d.getMinutes());
}

/** Nome do arquivo da lista: a frente, se o nome serve de arquivo (a classe das frentes); senao sem-frente. */
function nomeDaLista(frente) {
  return typeof frente === 'string' && /^[A-Za-z0-9_-]+$/.test(frente) ? frente : SEM_FRENTE;
}

function caminho(raiz, frente) { return PASTA + '/' + nomeDaLista(frente) + '.md'; }

/** O texto da lista da frente, ou null quando ainda nao existe. Outra falha de leitura lanca: a lista que existe e
 *  nao se le nao pode passar por lista sem pedido aberto. */
function ler(raiz, frente) {
  try { return fs.readFileSync(path.join(raiz, caminho(raiz, frente)), 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
}

// R3c (D833): o gancho (registrar) e o marcar disputam a mesma lista; a trava de arquivo os poe em fila, e o pedido que
// chega enquanto o marcar reescreve a lista espera a troca em vez de se perder. Mesmo desenho do estado.travar.
const PRAZO_TRAVA_MS = 2000;
const TRAVA_VELHA_MS = 10000;

function dormir(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

/** true = travou; false = nao conseguiu no prazo. Outra falha (sem permissao, disco) lanca, com a causa. */
function travar(trava) {
  const limite = Date.now() + PRAZO_TRAVA_MS;
  for (;;) {
    try { fs.closeSync(fs.openSync(trava, 'wx')); return true; } catch (e) {
      if (e.code !== 'EEXIST' && e.code !== 'EPERM' && e.code !== 'EBUSY') throw e;
      // a trava de um processo que morreu sem soltar: velha demais, e tomada. A que nao se apaga (outro processo a
      // segura, ou e uma pasta) cai no prazo como a nova: o laco nunca gira sem fim.
      // atalho: olhar a idade e apagar sao dois passos. limite: dois processos que acham a mesma trava velha no mesmo
      // instante podem, o segundo, apagar a trava nova do primeiro. trocar quando: houver trava velha de verdade (so
      // depois de um processo morto no meio) com mais de um processo esperando.
      let velha = false;
      try { velha = Date.now() - fs.statSync(trava).mtimeMs > TRAVA_VELHA_MS; } catch (x) { velha = false; }
      if (velha) {
        try { fs.rmSync(trava); continue; } catch (x) { /* nao se apaga: espera o prazo */ }
      }
      if (Date.now() > limite) return false;
      dormir(3 + Math.floor(Math.random() * 7));
    }
  }
}

function soltar(trava) { try { fs.rmSync(trava, { force: true }); } catch (e) { /* ja foi */ } }

/** O numero da linha numerada da lista ("12. ..." -> 12). */
function numeroDaLinha(linha) { return parseInt(linha, 10); }

/** R3b: o arquivo de handoff que a mensagem cita, quando ela e um prompt de handoff colado (retomada); senao null. */
function handoffColado(texto) {
  if (typeof texto !== 'string' || texto.length <= PROMPT_LONGO) return null;
  const m = HANDOFF_CITADO.exec(texto);
  return m ? m[0] : null;
}

function ehPromptDeHandoff(texto) { return handoffColado(texto) !== null; }

/** Grava `conteudo` em `<pasta>/<nome>.md` (relativo a raiz), criando a pasta, e devolve o caminho gravado. Nunca
 *  escreve por cima: com a lista apagada a mao e a pasta ao lado mantida, a numeracao recomeca e o nome ja existe;
 *  entao vai para `<nome>-2.md`, `<nome>-3.md`... */
function gravarAoLado(raiz, pasta, nome, conteudo) {
  fs.mkdirSync(path.join(raiz, pasta), { recursive: true });
  for (let i = 1; ; i++) {
    const rel = pasta + '/' + nome + (i === 1 ? '' : '-' + i) + '.md';
    try { fs.writeFileSync(path.join(raiz, rel), conteudo, { flag: 'wx' }); return rel; } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e;
    }
  }
}

/**
 * Acrescenta o pedido na lista da frente e devolve o caminho relativo, ou null quando nao grava: projeto sem
 * .claude/sworn/ (nao e poluido) ou texto vazio depois de limpo. Erro de disco lanca: quem chama decide (o gancho cala).
 * R3a (D833): o pedido maior que a linha (CORTE) vai inteiro, com as quebras de linha, para `<lista>/<n>.md`, e a linha
 * aponta o arquivo; antes a lista cortava em 600 caracteres e o resto se perdia. R3b: o prompt de handoff colado entra
 * numa linha marcada, sem numero, e nao conta como pedido; o texto dele vai para `<lista>/colado-<k>.md` (se for um
 * pedido de verdade que so cita um handoff, nada se perde).
 */
function registrar(raiz, frente, prompt, agora) {
  if (typeof prompt !== 'string' || !fs.existsSync(path.join(raiz, '.claude', 'sworn'))) return null;
  const texto = retomar.limpar(prompt);
  if (!texto) return null;
  const rel = caminho(raiz, frente);
  fs.mkdirSync(path.join(raiz, PASTA), { recursive: true });
  const trava = path.join(raiz, rel) + '.trava';
  // sem a trava no prazo (ou sem poder cria-la), o gancho grava assim mesmo: o pedido do dono nao se perde.
  // atalho: gravar sem a trava. limite: um marcar que segure a trava por mais de 2 s troca a lista por cima deste
  // pedido. trocar quando: o marcar passar a demorar (lista enorme, disco lento) ou isso for visto acontecer.
  let travou = false;
  try { travou = travar(trava); } catch (e) { travou = false; }
  try {
    return registrarTravado(raiz, rel, nomeDaLista(frente), prompt, texto, agora);
  } finally {
    if (travou) soltar(trava);
  }
}

function registrarTravado(raiz, rel, lista, prompt, texto, agora) {
  // So o arquivo que nao existe e lista nova: outra falha de leitura lanca, e a numeracao e o cabecalho nao recomecam.
  let atual = null;
  try { atual = fs.readFileSync(path.join(raiz, rel), 'utf8'); } catch (e) { if (!e || e.code !== 'ENOENT') throw e; }
  const cabecalho = atual === null ? '# Pedidos do dono - ' + lista + '\n\n' : '';
  const linhas = atual === null ? [] : atual.split('\n');
  const inteiro = retomar.mascarar(retomar.limparLinhas(prompt));
  const citado = handoffColado(texto);
  if (citado) {
    const k = linhas.filter(function (l) { return /^- /.test(l); }).length + 1;
    const guardado = gravarAoLado(raiz, PASTA + '/' + lista, 'colado-' + k,
      '# Prompt colado ' + k + ' - ' + carimbo(agora) + '\n\n' + inteiro + '\n');
    fs.appendFileSync(path.join(raiz, rel), cabecalho + '- ' + carimbo(agora) + ' - [prompt de handoff colado: ' +
      retomar.mascarar(citado) + ', ' + texto.length + ' caracteres; nao conta como pedido; texto em ' + guardado + ']\n');
    return rel;
  }
  const n = linhas.filter(function (l) { return NUMERADA.test(l); }).length + 1;
  const mascarado = retomar.mascarar(texto);
  let resumo = mascarado;
  if (mascarado.length > CORTE) {
    const guardado = gravarAoLado(raiz, PASTA + '/' + lista, String(n),
      '# Pedido ' + n + ' - ' + carimbo(agora) + '\n\n' + inteiro + '\n');
    resumo = retomar.cortar(mascarado, CORTE) + ' (inteiro em ' + guardado + ')';
  }
  // o texto do dono que ja termina como uma marca de estado ("... [feito: x]") nao pode passar por pedido fechado
  // (o espaco da frente e o do separador " - " da linha: o pedido que e so a marca tambem casa)
  if (MARCA.test(' ' + resumo)) resumo += ' (texto do dono)';
  fs.appendFileSync(path.join(raiz, rel), cabecalho + n + '. ' + carimbo(agora) + ' - ' + resumo + '\n');
  return rel;
}

/** Os numeros de "1-3,5" (inteiros de 1 a MAIOR_NUMERO, sem repetir, em ordem), ou null quando o texto nao e assim. */
function numeros(texto) {
  if (typeof texto !== 'string' || !/^\d{1,7}(-\d{1,7})?(,\d{1,7}(-\d{1,7})?)*$/.test(texto)) return null;
  const vistos = new Set();
  for (const parte of texto.split(',')) {
    const [a, b] = parte.split('-').map(Number);
    const fim = b === undefined ? a : b;
    if (a < 1 || fim < a || fim > MAIOR_NUMERO || fim - a > 10000) return null;
    for (let i = a; i <= fim; i++) vistos.add(i);
  }
  return Array.from(vistos).sort(function (x, y) { return x - y; });
}

/** Os pedidos numerados ainda sem estado: [{ n, linha }]. Lista que nao existe: []. */
function abertos(raiz, frente) {
  const texto = ler(raiz, frente);
  if (texto === null) return [];
  return texto.split('\n').filter(function (l) { return NUMERADA.test(l) && !MARCA.test(l); })
    .map(function (l) { return { n: numeroDaLinha(l), linha: l }; });
}

/** As linhas de `texto` com a marca nos numeros de `quer`; anota em `achados` os que existem. */
function comMarcas(texto, quer, marca, achados) {
  return texto.split('\n').map(function (l) {
    if (!NUMERADA.test(l) || !quer.has(numeroDaLinha(l))) return l;
    achados.add(numeroDaLinha(l));
    return l.replace(MARCA, '') + marca;
  }).join('\n');
}

/**
 * Marca os pedidos `lista` ("1-3,5") com `estado` e `evidencia`. Troca a marca que a linha ja tinha. Devolve
 * { marcados, faltaram } (os numeros que nao existem na lista); erro de uso lanca.
 */
function marcar(raiz, frente, lista, estado, evidencia) {
  const ns = numeros(lista);
  if (!ns) throw new Error('os numeros vao como 3, 1-4 ou 1-4,7 (inteiros de 1 a ' + MAIOR_NUMERO + ')');
  if (ESTADOS.indexOf(estado) === -1) throw new Error('o estado e um destes: ' + ESTADOS.join(', '));
  // mascara ANTES de tirar os colchetes: o "[segredo omitido]" da mascara nao pode fechar a marca no meio
  const prova = retomar.mascarar(String(evidencia == null ? '' : evidencia)).replace(/[\][]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!prova) throw new Error('falta a evidencia (o commit, a decisao D### ou o que foi respondido)');
  const arquivo = path.join(raiz, caminho(raiz, frente));
  const marca = ' [' + estado + ': ' + prova + ']';
  const quer = new Set(ns);
  const achados = new Set();
  // a lista que nao existe lanca ENOENT antes de travar (o pedidos.js diz qual frente); a trava poe em fila o gancho,
  // que acrescentaria um pedido entre a leitura e a troca, e o pedido dele se perderia
  fs.accessSync(arquivo);
  const trava = arquivo + '.trava';
  if (!travar(trava)) throw new Error('a lista de pedidos esta ocupada (' + trava + '): tente de novo');
  // escreve num arquivo ao lado e troca de uma vez: quem le a lista nunca a ve pela metade
  const tmp = arquivo + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, comMarcas(fs.readFileSync(arquivo, 'utf8'), quer, marca, achados));
    fs.renameSync(tmp, arquivo);
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { /* ja foi trocado, ou nem chegou a existir */ }
    soltar(trava);
  }
  return { marcados: ns.filter(function (n) { return achados.has(n); }), faltaram: ns.filter(function (n) { return !achados.has(n); }) };
}

module.exports = { CHAVE, PASTA, ESTADOS, ligada, registrar, ler, ehPromptDeHandoff, numeros, abertos, marcar,
  travar, soltar };
