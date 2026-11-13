#!/usr/bin/env node
'use strict';
// F4c: as pendencias com dono e data (scripts/lib/pendencias.js), em .sworn/PENDENCIAS.md.
//   node pendencias.js --listar                                   -> JSON { existe, abertas, fechadas, invalidas, maior }
//   node pendencias.js --adicionar --dono <quem> --texto <o que> [--hoje AAAA-MM-DD]
//   node pendencias.js --fechar <n> --como <o que a fechou> [--hoje AAAA-MM-DD]
// Saida 2: erro de uso (dono, texto ou "como" faltando, numero que nao esta aberto, data torta, dois modos juntos).
// Saida 1: o arquivo nao se le ou nao se grava (no --listar, o JSON traz `erro` com a causa).
const pend = require('./lib/pendencias.js');

const OPCOES = ['--listar', '--adicionar', '--fechar', '--dono', '--texto', '--como', '--hoje'];
const args = process.argv.slice(2);
/** O valor depois de `nome`: undefined sem a opcao; '' quando falta o valor (fim da linha ou outra opcao do comando). */
function valor(nome) {
  const i = args.indexOf(nome);
  if (i === -1) return undefined;
  const v = args[i + 1];
  return v === undefined || OPCOES.indexOf(v) !== -1 ? '' : v;
}
function sair(msg, codigo) { process.stderr.write(msg + '\n'); process.exit(codigo); }

const USO = 'sworn: use --listar, --adicionar --dono <quem> --texto <o que>, ou --fechar <n> --como <o que a fechou>';
const modos = ['--listar', '--adicionar', '--fechar'].filter(function (m) { return args.indexOf(m) !== -1; });
if (modos.length !== 1) sair(modos.length ? 'sworn: um modo por vez (' + modos.join(', ') + ')' : USO, 2);
const hoje = valor('--hoje');
if (hoje === '') sair('sworn: --hoje pede a data AAAA-MM-DD', 2);

const cwd = process.cwd();
try {
  if (modos[0] === '--listar') {
    const r = pend.ler(cwd);
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    if (r.erro) process.stderr.write('sworn: nao consegui ler ' + pend.ARQUIVO + ' (' + r.erro + '); confira o arquivo\n');
    process.exitCode = r.erro ? 1 : 0;
  } else if (modos[0] === '--adicionar') {
    const r = pend.adicionar(cwd, { dono: valor('--dono'), texto: valor('--texto'), hoje: hoje });
    process.stdout.write('pendencia #' + r.n + ' gravada em ' + pend.ARQUIVO + '\n');
  } else {
    const n = valor('--fechar');
    if (!/^\d+$/.test(n)) sair('sworn: --fechar pede o numero da pendencia; veja os numeros com --listar', 2);
    const r = pend.fechar(cwd, Number(n), valor('--como'), hoje);
    process.stdout.write('pendencia #' + r.n + ' fechada em ' + pend.ARQUIVO + '\n');
  }
} catch (e) { sair(e && e.message ? e.message : String(e), e && e.uso ? 2 : 1); }
