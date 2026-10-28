#!/usr/bin/env node
'use strict';
const auditoria = require('./lib/auditoria.js');
const config = require('./lib/config.js');
const injetado = require('./lib/injetado.js');

// --memoria <caminho do MEMORY.md>: quem chama (a skill) passa o caminho; o script nao o adivinha.
// Sem o argumento, ou sem valor depois dele, a chave `memoria` diz "nao medida" e a causa.
function valor(nome) {
  const i = process.argv.indexOf(nome);
  const v = i !== -1 ? process.argv[i + 1] : null;
  return v && !v.startsWith('--') ? v : null;
}

const cwd = process.cwd();

// Colheita 10-20, item 17 + V7: --seguranca <pasta> varre a pasta de um plugin ou skill antes de instalar, sem IA.
if (process.argv.indexOf('--seguranca') !== -1) {
  const pasta = valor('--seguranca');
  const fs = require('node:fs');
  const path = require('node:path');
  if (!pasta) {
    process.stdout.write('ERRO: falta a pasta. Uso: node auditar.js --seguranca <pasta> (a pasta do plugin ou da skill, ' +
      'baixada e ainda nao instalada).\n');
    process.exit(1);
  }
  const abs = path.resolve(cwd, pasta);
  let ehPasta = false;
  try { ehPasta = fs.statSync(abs).isDirectory(); } catch (e) { ehPasta = false; }
  if (!ehPasta) {
    process.stdout.write('ERRO: ' + abs + ' nao e uma pasta. Passe a pasta do plugin ou da skill baixada e rode de novo.\n');
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(require('./lib/seguranca.js').varrer(abs), null, 2) + '\n');
  process.exit(0);
}
// T11-3/D370: sem projeto.json o carregarProjeto devolve null, e a auditoria precisa saber disso
// (sem projeto, as fontes canonicas candidatas entram no peso); por isso nao ha `|| {}` aqui.
// --transcricao <caminho>: opcional. Sem ele, a transcricao e a da sessao do ambiente (lib/injetado.js, localizar).
// D706: o efetivo (as transcricoes de subagente da pasta dela) so se mede aqui, nunca na rodada automatica.
const r = auditoria.auditar(cwd, config.carregarProjeto(cwd), {
  memoria: valor('--memoria'),
  transcricao: injetado.localizar(valor('--transcricao'), process.env),
  efetivo: true
});
process.stdout.write(JSON.stringify(r, null, 2) + '\n');
process.exit(0);
