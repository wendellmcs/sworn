#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const texto = require('./lib/texto.js');
const projetoLib = require('./lib/projeto.js');
const regraLib = require('./lib/regra.js');

const cwd = process.argv[2] || process.cwd();
const alvo = path.join(cwd, '.claude', 'sworn', 'projeto.json');

// Ler e interpretar falham por motivos diferentes. Dizer "nao consegui ler" quando a
// leitura funcionou e o JSON e que estava quebrado manda procurar no lugar errado.
let bruto;
try {
  bruto = fs.readFileSync(alvo, 'utf8');
} catch (e) {
  process.stdout.write('ERRO: nao consegui ler ' + alvo + ': ' + e.message + '\n');
  process.exit(1);
}

let obj;
try {
  // semBom pelo mesmo motivo do lib/config.js: o leitor vivo dos portoes tira o BOM,
  // e dois leitores do MESMO arquivo nao podem discordar sobre ele existir.
  obj = JSON.parse(texto.semBom(bruto));
} catch (e) {
  process.stdout.write('ERRO: ' + alvo + ' nao e JSON valido: ' + e.message + '\n');
  process.exit(1);
}

let r;
try {
  r = projetoLib.validar(obj);
} catch (e) {
  process.stdout.write('ERRO: a validacao de ' + alvo + ' estourou: ' + e.message + '\n');
  process.exit(1);
}

if (r.ok) {
  process.stdout.write('OK: projeto.json valido (' + alvo + ')\n');
  // A1/D10: o regras.md e opcional - projeto sem regras semeadas continua valido.
  // Existindo, ele passa pelo mesmo portao: gatilho -> acao, e nenhum fato volatil.
  const arquivoRegras = path.join(cwd, '.claude', 'sworn', 'regras.md');
  if (fs.existsSync(arquivoRegras)) {
    const vr = regraLib.validarArquivo(fs.readFileSync(arquivoRegras, 'utf8'));
    if (!vr.ok) {
      process.stdout.write('ERRO: regras.md invalido (' + vr.total + ' regras lidas)\n');
      for (const e of vr.erros) process.stdout.write('  - ' + e + '\n');
      process.exit(1);
    }
    process.stdout.write('OK: regras.md valido (' + vr.total + ' regras)\n');
  }
  process.exit(0);
}
process.stdout.write('ERRO: projeto.json invalido (' + alvo + ')\n');
for (const e of r.erros) process.stdout.write('  - ' + e + '\n');
process.exit(1);
