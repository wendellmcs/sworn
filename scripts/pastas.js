#!/usr/bin/env node
'use strict';
// R1 (pedido do dono, 2026-11-12): as pastas que o sworn cria fora do projeto, e a limpeza delas (scripts/lib/pastas.js).
//
//   node pastas.js --estudar <https://servidor/dono/repo> [--ramo <ramo ou tag>]
//   node pastas.js --registrar <pasta> --tipo <estudo|worktree|export|carga> [--repo <repositorio>] [--origem <pasta>]
//   node pastas.js --limpar [--fim-da-sessao]
//   node pastas.js --listar
//
// --protegida <pasta> e a pasta de trabalho de quem chamou: os ganchos a passam (scripts/lib/pastas.js, emSegundoPlano),
// e a limpeza nunca apaga essa pasta nem a que a contem.
//
// A sessao e a do ambiente (CLAUDE_CODE_SESSION_ID), ou --sessao <id>. --estudar clona para ler, numa pasta nova da
// temporaria do sistema, e a pasta entra no registro; --limpar apaga do registro so o que ja nao se usa (o export
// publicado, e o estudo e a carga desta sessao com --fim-da-sessao). Saida em JSON; codigo 0 ok, 1 quando a acao
// falha, 2 no erro de uso.
const { parseArgs } = require('node:util');
const pastas = require('./lib/pastas.js');

const USO = 'uso: node pastas.js --estudar <https://servidor/dono/repo> [--ramo <ramo>] | --registrar <pasta> --tipo <' +
  pastas.TIPOS.join('|') + '> [--repo <repositorio>] [--origem <pasta>] | --limpar [--fim-da-sessao] | --listar' +
  ' (todas aceitam --sessao <id>)';
const SESSAO = /^[A-Za-z0-9_-]{1,200}$/;

function sair(obj, codigo) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
  process.exitCode = codigo;
}

try {
  const { values } = parseArgs({
    args: process.argv.slice(2), strict: true, allowPositionals: false,
    options: {
      estudar: { type: 'string' }, ramo: { type: 'string' }, registrar: { type: 'string' }, tipo: { type: 'string' },
      repo: { type: 'string' }, origem: { type: 'string' }, limpar: { type: 'boolean' },
      'fim-da-sessao': { type: 'boolean' }, listar: { type: 'boolean' }, sessao: { type: 'string' },
      // a pasta de trabalho de quem chamou (o gancho, pelo emSegundoPlano): a limpeza nunca a toca, nem o que a contem
      protegida: { type: 'string' }
    }
  });
  const acoes = ['estudar', 'registrar', 'limpar', 'listar'].filter(function (a) { return values[a] !== undefined; });
  if (acoes.length !== 1) throw new Error(USO);
  const sessao = values.sessao !== undefined ? values.sessao : (process.env.CLAUDE_CODE_SESSION_ID || '');
  if (sessao && !SESSAO.test(sessao)) throw new Error('--sessao so leva letras, numeros, _ e -. ' + USO);
  if (values.estudar !== undefined) {
    const r = pastas.clonar(values.estudar, { sessao: sessao, ref: values.ramo });
    const leitura = 'so para ler: nao rode nada dela (a trava 5 barra o comando de shell que roda o codigo do clone, ' +
      'mas nao e uma caixa fechada); a pasta sai no fim da sessao (ou com node pastas.js --limpar --fim-da-sessao)';
    sair(r.ok ? Object.assign(r, { aviso: (r.aviso ? r.aviso + '; ' : '') + leitura }) : r, r.ok ? 0 : 1);
  } else if (values.registrar !== undefined) {
    if (!values.tipo) throw new Error('--registrar pede --tipo. ' + USO);
    const r = pastas.registrar(values.registrar, values.tipo, { sessao: sessao, repo: values.repo, origem: values.origem });
    sair(r, r.ok ? 0 : 1);
  } else if (values.limpar) {
    const r = pastas.limpar({ sessao: sessao, fimDaSessao: values['fim-da-sessao'] === true,
      cwd: values.protegida || process.cwd() });
    sair(r, r.ok ? 0 : 1);
  } else {
    sair({ ok: true, pastas: pastas.listar() }, 0);
  }
} catch (e) {
  const erro = e && e.code && /^ERR_PARSE_ARGS/.test(e.code) ? e.message + '. ' + USO : String((e && e.message) || e);
  sair({ ok: false, erro: erro }, erro.indexOf(USO) !== -1 ? 2 : 1);
}
