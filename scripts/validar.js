#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const texto = require('./lib/texto.js');
const projetoLib = require('./lib/projeto.js');
const regraLib = require('./lib/regra.js');
const designLib = require('./lib/design.js');

const cwd = process.argv[2] || process.cwd();
const alvo = path.join(cwd, '.claude', 'sworn', 'projeto.json');

// A4-23 (pedido 12, microcopy): todo ERRO termina com o passo seguinte.
function falhar(msg, itens) {
  process.stdout.write('ERRO: ' + msg + '\n');
  for (const e of itens || []) process.stdout.write('  - ' + e + '\n');
  process.stdout.write('Corrija o que esta acima e rode a validacao de novo.\n');
  process.exit(1);
}

// Ler e interpretar falham por motivos diferentes. Dizer "nao consegui ler" quando a
// leitura funcionou e o JSON e que estava quebrado manda procurar no lugar errado.
let bruto;
try {
  bruto = fs.readFileSync(alvo, 'utf8');
} catch (e) {
  falhar('nao consegui ler ' + alvo + (e.code === 'ENOENT' ? ' (o /sworn:init cria esse arquivo)' : '') +
    ': ' + e.message);
}

let obj;
try {
  // semBom pelo mesmo motivo do lib/config.js: o leitor vivo dos portoes tira o BOM,
  // e dois leitores do MESMO arquivo nao podem discordar sobre ele existir.
  obj = JSON.parse(texto.semBom(bruto));
} catch (e) {
  falhar(alvo + ' nao e JSON valido: ' + e.message);
}

let r;
try {
  r = projetoLib.validar(obj);
} catch (e) {
  falhar('a validacao de ' + alvo + ' estourou: ' + e.message);
}

if (r.ok) {
  process.stdout.write('OK: projeto.json valido (' + alvo + ')\n');
  // A1/D10: o regras.md e opcional - projeto sem regras semeadas continua valido.
  // Existindo, ele passa pelo mesmo portao: gatilho -> acao, e nenhum fato volatil.
  const arquivoRegras = path.join(cwd, '.claude', 'sworn', 'regras.md');
  if (fs.existsSync(arquivoRegras)) {
    // R1 da A4-23: regras.md que existe e nao se le saia em excecao crua, sem ERRO.
    let regras;
    try { regras = fs.readFileSync(arquivoRegras, 'utf8'); } catch (e) {
      falhar('nao consegui ler ' + arquivoRegras + ': ' + e.message);
    }
    const vr = regraLib.validarArquivo(regras);
    if (!vr.ok) falhar('regras.md invalido (' + vr.total + ' regras lidas)', vr.erros);
    process.stdout.write('OK: regras.md valido (' + vr.total + ' regras)\n');
  }
  // A4-des-2 (pedido 12, fila §5): o design.json tambem e opcional; existindo, passa pelo validar do design.js, com
  // ler e interpretar separados como o projeto.json acima.
  const arquivoDesign = path.join(cwd, '.claude', 'sworn', 'design.json');
  if (fs.existsSync(arquivoDesign)) {
    let sistema;
    try { bruto = fs.readFileSync(arquivoDesign, 'utf8'); } catch (e) {
      falhar('nao consegui ler ' + arquivoDesign + ': ' + e.message);
    }
    try { sistema = JSON.parse(texto.semBom(bruto)); } catch (e) {
      falhar(arquivoDesign + ' nao e JSON valido: ' + e.message);
    }
    const vd = designLib.validar(sistema);
    if (!vd.ok) falhar('design.json invalido (' + arquivoDesign + ')', vd.erros);
    process.stdout.write('OK: design.json valido\n');
  }
  process.exit(0);
}
falhar('projeto.json invalido (' + alvo + ')', r.erros);
