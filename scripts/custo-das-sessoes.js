#!/usr/bin/env node
'use strict';
// H6g (15.6, D903): o custo e o uso das sessoes deste projeto. Com --gravar, o processo solto que o SessionEnd
// (fim-sessao.js) dispara soma o transcript da sessao e grava .sworn/custo/<sessao>.json (lib/custo-da-sessao.js); sem
// argumento, lista as ultimas sessoes gravadas e o total. A conta e estimativa pela tabela de preco do sworn, valor de
// API: nao e a cobranca de quem assina um plano.
//   node scripts/custo-das-sessoes.js [--limite=N | --limite N] [--json]
//   node scripts/custo-das-sessoes.js --gravar --sessao=<id> --transcript=<caminho> --raiz=<projeto>
// Saida do --gravar: 0 gravou; 2 sessao ou transcript torto, nada gravado; 1 erro ao somar ou gravar.
const config = require('./lib/config.js');
const custo = require('./lib/custo-da-sessao.js');

/** O valor de `--nome=v` ou de `--nome v`; ausente, null. */
function valor(args, nome) {
  const a = args.find(function (x) { return x.indexOf('--' + nome + '=') === 0; });
  if (a !== undefined) return a.slice(nome.length + 3);
  const i = args.indexOf('--' + nome);
  return i !== -1 && i + 1 < args.length && args[i + 1].indexOf('--') !== 0 ? args[i + 1] : null;
}

function dinheiro(v) {
  return 'US$ ' + (typeof v === 'number' && isFinite(v) ? v : 0).toFixed(2);
}

function mil(v) {
  return (typeof v === 'number' && isFinite(v) ? v : 0).toLocaleString('pt-BR');
}

/** `1 coisa` ou `2 coisas`. */
function plural(n, um, varios) {
  return mil(n) + ' ' + (n === 1 ? um : varios);
}

/** A hora do fim no relogio de quem le (o registro guarda UTC). */
function hora(iso) {
  const d = new Date(iso);
  const p = function (v) { return String(v).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function linha(r) {
  const c = r.saidaCortada && typeof r.saidaCortada === 'object' ? r.saidaCortada : {};
  const partes = [hora(r.fim), String(r.sessao).slice(0, 8), dinheiro(r.usd),
    'entrada ' + mil(r.entrada), 'saida ' + mil(r.saida), 'cache lido ' + mil(r.cacheLido),
    'cache escrito ' + mil(r.cacheEscrito), 'subagentes ' + mil(r.subagentes)];
  if (c.vezes > 0) {
    partes.push('saida da prova encurtada ' + mil(c.vezes) + 'x, ' + mil(Math.round(c.bytes / 1024)) + ' KB que o modelo nao leu');
  }
  if (r.semPreco > 0) {
    partes.push(plural(r.semPreco, 'mensagem', 'mensagens') + ' de modelo fora da tabela de preco do sworn (fora do total: atualize o sworn para conta-las)');
  }
  if (r.ilegiveis > 0) {
    partes.push(plural(r.ilegiveis, 'arquivo da conversa ilegivel', 'arquivos da conversa ilegiveis') + ' (fora do total)');
  }
  return '- ' + partes.join(' | ');
}

function listar(args) {
  const n = Number(valor(args, 'limite'));
  const limite = Number.isInteger(n) && n > 0 ? n : 10;
  let todos;
  try { todos = custo.ler(config.raizDoProjeto(process.cwd())); } catch (e) {
    process.stderr.write('sworn: nao consegui ler ' + custo.PASTA + ': ' + (e && e.message ? e.message : String(e)) +
      '. Confira se este usuario pode ler essa pasta e rode de novo.\n');
    process.exitCode = 1;
    return;
  }
  const ultimas = todos.slice(0, limite);
  const total = ultimas.reduce(function (s, r) { return s + (typeof r.usd === 'number' && isFinite(r.usd) ? r.usd : 0); }, 0);
  if (args.indexOf('--json') !== -1) {
    process.stdout.write(JSON.stringify({ sessoes: ultimas, totalDasUltimas: Math.round(total * 1e6) / 1e6,
      gravadas: todos.length }) + '\n');
    return;
  }
  const out = ['sworn - custo das sessoes (estimativa pela tabela de preco, valor de API, nao cobranca)'];
  if (!ultimas.length) {
    out.push('Nenhuma sessao gravada em ' + custo.PASTA + ' ainda: cada sessao entra aqui quando fecha. Feche esta e rode de novo.');
  } else {
    for (const r of ultimas) out.push(linha(r));
    out.push((ultimas.length === 1 ? 'Total da ultima' : 'Total das ' + ultimas.length + ' ultimas') + ' (de ' +
      plural(todos.length, 'gravada', 'gravadas') + '): ' + dinheiro(total));
  }
  process.stdout.write(out.join('\n') + '\n');
}

const args = process.argv.slice(2);
if (args.indexOf('--gravar') !== -1) {
  // Processo solto, sem quem leia a saida: o erro so muda o codigo de saida.
  try {
    const feito = custo.gravar(valor(args, 'raiz') || process.cwd(), valor(args, 'sessao'), valor(args, 'transcript'), Date.now());
    process.exitCode = feito ? 0 : 2;
  } catch (e) { process.exitCode = 1; }
} else {
  listar(args);
}
