#!/usr/bin/env node
'use strict';
const config = require('./lib/config.js');
const cobertura = require('./lib/cobertura.js');

// A6-15/A7-06: da subpasta, a raiz do projeto (a pasta com .claude/sworn/projeto.json), como os outros scripts
const cwd = config.raizDoProjeto(process.cwd());
// H6j (D906): o kit le os servidores MCP do ~/.claude.json (so os nomes), como o varrer.js
const ambiente = require('./lib/ambiente.js');
const r = cobertura.relatorio(cwd, config.carregarProjeto(cwd),
  { claudeJson: ambiente.caminhoDoClaudeJson(process.env), rotuloClaudeJson: ambiente.rotuloDoClaudeJson(process.env) });

if (process.argv.indexOf('--json') !== -1) {
  process.stdout.write(JSON.stringify(r, null, 2) + '\n');
} else {
  process.stdout.write(cobertura.texto(r) + '\n');
}
process.exit(0);
