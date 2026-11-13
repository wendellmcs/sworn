#!/usr/bin/env node
'use strict';
// R1 (pedido do dono, 2026-11-12: "sempre limpar o lixo apos os pushs"): depois de um comando com `git push`, a
// limpeza das pastas do sworn roda num processo solto (scripts/lib/pastas.js). Ela mesma confere o que ja saiu: o
// export so se apaga sem mudanca e sem commit por empurrar, entao um push que falhou nao apaga nada. Roda carregado
// pelo depois-do-shell.js (F3a) e sozinho nos outros harnesses.
const io = require('./lib/io.js');
const pastas = require('./lib/pastas.js');

const PUSH = /\bgit\b[^;&|\n]*\spush\b/;
const SESSAO = /^[A-Za-z0-9_-]{1,200}$/;

function depois(entrada) {
  const e = entrada || {};
  const comando = e.tool_input && typeof e.tool_input.command === 'string' ? e.tool_input.command : '';
  if ((e.tool_name === 'Bash' || e.tool_name === 'PowerShell') && PUSH.test(comando)) {
    // --sessao=<id> numa palavra so: o id que comeca por - nao vira opcao
    pastas.emSegundoPlano(['--limpar'].concat(SESSAO.test(String(e.session_id || '')) ? ['--sessao=' + e.session_id] : []));
  }
  io.permitir();
}

if (require.main === module || io.embutidoAtivo()) {
  io.blindar(function () { io.lerEntrada(depois); });
}
