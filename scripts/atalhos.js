#!/usr/bin/env node
'use strict';
const atalhos = require('./lib/atalhos.js');
const config = require('./lib/config.js');

/**
 * Plano 090 Tarefa 5 (skill /sworn:shortcuts): lista os comentarios de atalho do repositorio da pasta atual.
 *   node atalhos.js
 * Varre os arquivos que o git rastreia e os novos que ele nao ignora (fora `.git`, `node_modules` e o que o
 * .gitignore cobre), sem tocar em nada. Saida: o painel em texto; fora de repositorio git, o motivo e exit 1.
 */
const cwd = process.cwd();
const r = atalhos.doRepositorio(cwd, config.carregarProjeto(config.raizDoProjeto(cwd)));
process.stdout.write((r.erro || atalhos.painel(r.achados, r.total, r.marcas)) + '\n');
process.exit(r.erro ? 1 : 0);
