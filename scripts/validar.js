#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const jsonio = require('./lib/jsonio.js');
const projetoLib = require('./lib/projeto.js');
const regraLib = require('./lib/regra.js');
const designLib = require('./lib/design.js');

const cwd = process.argv[2] || process.cwd();
const pasta = path.join(cwd, '.claude', 'sworn');
const alvo = path.join(pasta, 'projeto.json');

// A4-76: cada arquivo e conferido mesmo que outro tenha falhado; antes o primeiro ERRO saia e o resto (o design.json
// depois de um regras.md invalido, os dois depois de um projeto.json invalido) ficava sem conferir e sem aviso.
let falhou = false;
let doArquivo = false;
let doSworn = false;
function erro(msg, itens) {
  process.stdout.write('ERRO: ' + msg + '\n');
  for (const e of itens || []) process.stdout.write('  - ' + e + '\n');
  falhou = true;
  doArquivo = true;
}
// O validador que lanca e defeito do sworn, nao do arquivo: mandar corrigir o arquivo mandaria procurar no lugar errado.
function defeito(arquivo, e) {
  process.stdout.write('ERRO: o validador do sworn falhou por dentro ao conferir ' + arquivo +
    ' (defeito do sworn, nao do arquivo): ' + (e instanceof Error ? e.message : String(e)) + '\n');
  falhou = true;
  doSworn = true;
}

// Ler e interpretar falham por motivos diferentes. Dizer "nao consegui ler" quando a
// leitura funcionou e o JSON e que estava quebrado manda procurar no lugar errado.
function lerTexto(arquivo) {
  try { return fs.readFileSync(arquivo, 'utf8'); } catch (e) {
    erro('nao consegui ler ' + arquivo + ': ' + e.message);
    return null;
  }
}
// F5a: a leitura do JSON e a unica do lib/jsonio.js (tira o BOM como o leitor vivo dos portoes; dois leitores do
// MESMO arquivo nao podem discordar sobre ele existir); aqui so cada caso vira a sua frase.
function lerObjeto(arquivo, dica) {
  const l = jsonio.ler(arquivo);
  if (l.ausente) {
    erro('nao consegui ler ' + arquivo + (dica || '') + ': o arquivo nao existe');
    return { ok: false };
  }
  if (l.etapa === 'leitura') {
    erro('nao consegui ler ' + arquivo + ': ' + (l.erro instanceof Error ? l.erro.message : String(l.erro)));
    return { ok: false };
  }
  if (l.etapa === 'json') {
    erro(arquivo + ' nao e JSON valido: ' + l.erro.message);
    return { ok: false };
  }
  return { ok: true, valor: l.valor };
}

function conferirProjeto() {
  const lido = lerObjeto(alvo, ' (o /sworn:init cria esse arquivo)');
  if (!lido.ok) return;
  let r;
  try { r = projetoLib.validar(lido.valor); } catch (e) {
    defeito(alvo, e);
    return;
  }
  if (r.ok) process.stdout.write('OK: projeto.json valido (' + alvo + ')\n');
  else erro('projeto.json invalido (' + alvo + ')', r.erros);
}

// A1/D10: o regras.md e opcional - projeto sem regras semeadas continua valido.
// Existindo, ele passa pelo mesmo portao: gatilho -> acao, e nenhum fato volatil.
function conferirRegras() {
  const arquivoRegras = path.join(pasta, 'regras.md');
  if (!fs.existsSync(arquivoRegras)) return;
  // R1 da A4-23: regras.md que existe e nao se le saia em excecao crua, sem ERRO.
  const regras = lerTexto(arquivoRegras);
  if (regras === null) return;
  let vr;
  try { vr = regraLib.validarArquivo(regras); } catch (e) {
    defeito(arquivoRegras, e);
    return;
  }
  if (!vr.ok) erro('regras.md invalido (' + vr.total + ' regras lidas)', vr.erros);
  else process.stdout.write('OK: regras.md valido (' + vr.total + ' regras)\n');
}

// A4-des-2 (pedido 12, fila §5): o design.json tambem e opcional; existindo, passa pelo validar do design.js, com
// ler e interpretar separados como o projeto.json acima.
function conferirDesign() {
  const arquivoDesign = path.join(pasta, 'design.json');
  if (!fs.existsSync(arquivoDesign)) return;
  const lido = lerObjeto(arquivoDesign);
  if (!lido.ok) return;
  let vd;
  try { vd = designLib.validar(lido.valor); } catch (e) {
    defeito(arquivoDesign, e);
    return;
  }
  // A4-50: a chave que o sworn nao le so avisa, nos dois casos (valido ou nao)
  const avisosDoDesign = function () {
    for (const a of vd.avisos || []) process.stdout.write('AVISO: design.json: ' + a + '\n');
  };
  if (!vd.ok) { avisosDoDesign(); erro('design.json invalido (' + arquivoDesign + ')', vd.erros); return; }
  process.stdout.write('OK: design.json valido\n');
  avisosDoDesign();
}

conferirProjeto();
conferirRegras();
conferirDesign();
// A4-23 (pedido 12, microcopy): todo ERRO termina com o passo seguinte, uma vez, no fim.
if (falhou) {
  // os dois passos quando ha os dois tipos: o arquivo errado se corrige, o defeito se avisa; com os dois, o de
  // corrigir diz que as linhas de defeito ficam de fora
  if (doArquivo) {
    process.stdout.write(doSworn ? 'Corrija os arquivos dos ERRO que nao sao "defeito do sworn" e rode a validacao de novo.\n'
      : 'Corrija o que esta acima e rode a validacao de novo.\n');
  }
  if (doSworn) {
    // o mesmo canal do sessao.js e do estilo-shell.js: o passo diz onde avisar, nao so a quem
    process.stdout.write('Registre as linhas "defeito do sworn" acima em https://github.com/wendellmcs/sworn/issues; ' +
      'os arquivos delas nao precisam mudar.\n');
  }
  process.exit(1);
}
process.exit(0);
