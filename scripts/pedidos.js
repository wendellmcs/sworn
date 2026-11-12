#!/usr/bin/env node
'use strict';
// R3c (D833): os pedidos do dono que ainda estao abertos, e a marca de cada um quando fecha. A lista e a que o gancho
// de entrada grava (scripts/lib/pedidos.js, abrir-turno.js); o /sworn:handoff e o fecho de uma tarefa usam isto.
//
//   node pedidos.js --abertos [--frente <frente>]
//   node pedidos.js --marcar <numeros> <feito|recusado|respondido> "<evidencia>" [--frente <frente>]
//
// <numeros>: 3, 1-4 ou 1-4,7. Sem --frente, a lista sem-frente. Roda na raiz do projeto. Saida em JSON; codigo 0 ok,
// 1 quando algum numero nao existe na lista, 2 no erro de uso ou com a lista que ainda nao existe.
const { parseArgs } = require('node:util');
const config = require('./lib/config.js');
const pedidos = require('./lib/pedidos.js');

const USO = 'uso: node pedidos.js --abertos [--frente <frente>] | --marcar <numeros> <' + pedidos.ESTADOS.join('|') +
  '> "<evidencia>" [--frente <frente>]';

function sair(obj, codigo) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
  process.exitCode = codigo;
}

let frente = null;
try {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2), allowPositionals: true, strict: true,
    options: { abertos: { type: 'boolean' }, marcar: { type: 'boolean' }, frente: { type: 'string' } }
  });
  if (values.frente !== undefined && !values.frente.trim()) throw new Error('--frente vazio: diga a frente, ou tire a opcao para a lista sem-frente. ' + USO);
  frente = values.frente || null;
  const raiz = config.raizDoProjeto(process.cwd());
  if (values.abertos && !values.marcar && positionals.length === 0) {
    const lista = pedidos.abertos(raiz, frente);
    sair({ ok: true, frente: frente, abertos: lista.length, pedidos: lista }, 0);
  } else if (values.marcar && !values.abertos && positionals.length === 3) {
    const [numeros, estado, evidencia] = positionals;
    const r = pedidos.marcar(raiz, frente, numeros, estado, evidencia);
    sair({ ok: r.faltaram.length === 0, frente: frente, marcados: r.marcados, faltaram: r.faltaram }, r.faltaram.length ? 1 : 0);
  } else {
    throw new Error(USO);
  }
} catch (e) {
  const erro = e && e.code === 'ENOENT' && /pedidos/.test(String(e.path || ''))
    ? 'a lista de pedidos da frente "' + (frente || 'sem-frente') + '" nao existe ainda: confira --frente e se o comando ' +
      'roda na raiz do projeto (a lista nasce com a primeira mensagem do dono)'
    : (e && e.code && /^ERR_PARSE_ARGS/.test(e.code) ? e.message + '. ' + USO : String(e && e.message || e));
  sair({ ok: false, erro: erro }, 2);
}
