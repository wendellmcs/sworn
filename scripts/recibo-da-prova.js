#!/usr/bin/env node
'use strict';
// H6a (15.1, D891): o recibo de cada rodada de teste e a saida enxuta. No PostToolUse do shell (dentro do
// depois-do-shell.js), o comando de teste que saiu com 0 vira um recibo no estado da sessao; o verde de um executor da
// tabela (lib/saida-enxuta.js), grande e sem pipe, chega ao modelo so com o resumo e o caminho do log inteiro, que fica
// em .sworn/provas/ (o transcript guarda so a saida trocada: medido no Claude Code 2.1.328). No PostToolUseFailure, que
// e o unico que o codigo diferente de 0 dispara, o recibo da falha, sem tocar no erro. Sem projeto.json do sworn, nada;
// com `"saidaEnxuta": false`, o recibo sem o corte. Pela ponte (Codex, Qwen, dsh, agy, OpenCode) so o recibo: a troca
// da saida e do Claude Code.
const fs = require('node:fs');
const path = require('node:path');
const io = require('./lib/io.js');
const config = require('./lib/config.js');
const estado = require('./lib/estado.js');
const saude = require('./lib/saude.js');
const enxuta = require('./lib/saida-enxuta.js');
const retomar = require('./lib/retomar.js');
const { semSegredo } = require('./lib/captura.js');

const PASTA = path.join('.sworn', 'provas');
const TETO_DE_LOGS = 20;
const TETO_DE_RECIBOS = 50;
// O nome que o sworn da ao log (a hora ISO com - no lugar de : e ., e o pid): so este a poda apaga.
const LOG_DO_SWORN = /^\d{4}-\d{2}-\d{2}T[\d-]+Z?(?:-\d+)?\.log$/;

/** A saida do shell na forma do Claude Code, a unica que se troca. */
function formaDoShell(r) {
  return Boolean(r) && typeof r === 'object' && typeof r.stdout === 'string' && typeof r.stderr === 'string';
}

function codigoDoErro(erro) {
  const m = /^Exit code (\d+)/.exec(String(erro || ''));
  return m ? Number(m[1]) : null;
}

/** Grava o recibo. H6f (15.9): o vermelho de verdade (`vermelho` true) tira de `testesSemVermelho` o que o comando
 *  cobre, resolvido no `cwd` (lib/vermelho-antes.js). H6g (15.6): a saida cortada (`poupado`, os bytes que o modelo
 *  deixou de ler) soma em `saidaCortada`, que o custo da sessao grava no fim (lib/custo-da-sessao.js). */
function registrar(sessao, recibo, vermelho, comando, cwd, poupado) {
  estado.alterar(sessao, function (s) {
    s.recibos = (Array.isArray(s.recibos) ? s.recibos : []).concat([recibo]).slice(-TETO_DE_RECIBOS);
    if (poupado !== undefined) s.saidaCortada = require('./lib/custo-da-sessao.js').comCorte(s.saidaCortada, poupado);
    if (vermelho && s.testesSemVermelho !== undefined) {
      s.testesSemVermelho = require('./lib/vermelho-antes.js').semOsCobertos(s.testesSemVermelho, comando, cwd);
    }
    return s;
  });
}

/** Os logs do sworn alem dos TETO_DE_LOGS mais novos saem; o que tem outro nome na pasta fica. */
function podar(pasta) {
  try {
    const logs = fs.readdirSync(pasta).filter(function (n) { return LOG_DO_SWORN.test(n); }).sort();
    for (const n of logs.slice(0, Math.max(0, logs.length - TETO_DE_LOGS))) fs.rmSync(path.join(pasta, n), { force: true });
  } catch (e) { /* a poda falha sozinha: a proxima gravacao tenta de novo */ }
}

/** Grava a saida inteira e devolve o caminho; o disco que nao grava (erro com `code`, do fs), null, e a saida nao se
 *  corta. O erro de programa (sem `code`) sobe ao io.blindar, que o escreve no stderr: nao some como falha de disco. */
function gravarLog(raiz, comando, r, hora) {
  try {
    const pasta = path.join(raiz, PASTA);
    fs.mkdirSync(pasta, { recursive: true });
    retomar.protegerPasta(pasta);
    const arquivo = path.join(pasta, hora.replace(/[:.]/g, '-') + '-' + process.pid + '.log');
    fs.writeFileSync(arquivo, ['sworn - a saida inteira de um comando de teste (saida enxuta)', 'comando: ' + semSegredo(comando),
      'hora: ' + hora, '--- stdout ---', semSegredo(r.stdout), '--- stderr ---', semSegredo(r.stderr), ''].join('\n'),
      { flag: 'wx' });
    podar(pasta);
    return arquivo;
  } catch (e) {
    if (!e || typeof e.code !== 'string') throw e;
    return null;
  }
}

function tratar(e) {
  if (e.tool_name !== 'Bash' && e.tool_name !== 'PowerShell') return io.permitir();
  const ti = e.tool_input && typeof e.tool_input === 'object' ? e.tool_input : {};
  const comando = typeof ti.command === 'string' ? ti.command : '';
  if (!comando || ti.run_in_background === true) return io.permitir();
  const raiz = config.raizDoProjeto(e.cwd || process.cwd());
  const projeto = config.carregarProjeto(raiz);
  if (!projeto) return io.permitir();
  const provas = saude.provasEquivalentes(projeto.provaDePronto, raiz);
  const hora = new Date().toISOString();
  const recibo = { hora: hora, comando: semSegredo(comando).slice(0, 300) };
  if (e.hook_event_name === 'PostToolUseFailure') {
    if (!enxuta.ehComandoDeTeste(comando, provas)) return io.permitir();
    // codigo null com interrompido false: o erro nao trouxe o codigo (o tempo do shell que acabou, por exemplo).
    Object.assign(recibo, { verde: false, interrompido: e.is_interrupt === true,
      codigo: e.is_interrupt === true ? null : codigoDoErro(e.error), cortado: false, log: null });
    // H6f: so a falha com o codigo do executor e vermelho; a interrompida e a sem codigo (o tempo que acabou) nao.
    registrar(e.session_id, recibo, recibo.codigo !== null, comando, e.cwd || process.cwd());
    return io.permitir();
  }
  const r = e.tool_response;
  // A saida em texto (a ponte do OpenCode, harness.js) nao diz o codigo, e nao se troca: so o recibo, com codigo null.
  const emTexto = typeof r === 'string';
  if (!emTexto && (!formaDoShell(r) || r.interrupted === true || r.backgroundTaskId !== undefined)) return io.permitir();
  const saida = emTexto ? r : r.stdout + (r.stdout && r.stderr ? '\n' : '') + r.stderr;
  const a = enxuta.resumir(comando, saida, provas);
  if (!a.teste) return io.permitir();
  const tamanho = { linhas: saida.split('\n').length, bytes: Buffer.byteLength(saida) };
  Object.assign(recibo, { verde: a.verde, codigo: emTexto ? null : 0, cortado: false, log: null }, tamanho);
  let trocada = null;
  let poupado;
  if (!emTexto && a.resumo && projeto.saidaEnxuta !== false && !process.env.SWORN_PONTE) {
    const log = gravarLog(raiz, comando, r, hora);
    if (log) {
      const caminho = log.replace(/\\/g, '/');
      Object.assign(recibo, { cortado: true, log: caminho, resumo: a.resumo });
      trocada = Object.assign({}, r, { stdout: enxuta.textoAoModelo(a.resumo, tamanho, caminho), stderr: '' });
      poupado = Math.max(0, tamanho.bytes - Buffer.byteLength(trocada.stdout));
    }
  }
  // H6f: a saida que mostra falha (o pipe que zerou o codigo, por exemplo) tambem e vermelho.
  registrar(e.session_id, recibo, a.verde === false, comando, e.cwd || process.cwd(), poupado);
  return io.permitir(trocada ? { hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: trocada } }
    : undefined);
}

// Roda sozinho no PostToolUseFailure e carregado pelo depois-do-shell.js (io.rodarJuntos) no PostToolUse.
if (require.main === module || io.embutidoAtivo()) {
  io.blindar(function () { io.lerEntrada(tratar); });
}

module.exports = { gravarLog, LOG_DO_SWORN, TETO_DE_LOGS, TETO_DE_RECIBOS };
