#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const referencia = require('./lib/referencia.js');
const caminho = require('./lib/caminho.js');
const config = require('./lib/config.js');
const texto = require('./lib/texto.js');

/**
 * Plano do REA, Tarefa 3 (skill /sworn:reference, D580): confere a ficha e, com o sim do dono, a poe na referencia.
 *   node referencia.js <ficha>            confere (formato, tamanho, lugar e nome), nao grava nada
 *   node referencia.js <ficha> --gravar   confere e junta a ficha a lista do tipo em `referencias` do projeto.json
 *   node referencia.js <ficha> --tipo radar   confere a ficha do radar (plano do radar, T2), em qualquer pasta; nao grava
 * A ficha mora em .claude/sworn/referencias/<tipo>-<assunto>.md (caminho a partir da pasta atual). Saida: JSON; com
 * problema na ficha, `problemas` e exit 1; na falha, `erro` e exit 1. Molde da escrita: scripts/calibrar.js.
 */
const RELATIVO = '.claude/sworn/projeto.json';
const USO = 'node referencia.js <ficha> [--gravar | --tipo radar]';

function sair(codigo, dados) {
  process.stdout.write(JSON.stringify(dados, null, 2) + '\n');
  process.exit(codigo);
}

const args = process.argv.slice(2);
const gravar = args.indexOf('--gravar') !== -1;
const iTipo = args.indexOf('--tipo');
const tipoPedido = iTipo === -1 ? null : args[iTipo + 1];
const arg = args.filter(function (a, i) { return !a.startsWith('--') && (iTipo === -1 || i !== iTipo + 1); })[0];
if (!arg) sair(1, { gravou: false, erro: 'falta o caminho da ficha: ' + USO });
if (iTipo !== -1 && tipoPedido !== 'radar') sair(1, { gravou: false, erro: '--tipo so aceita radar; veio ' + (tipoPedido || 'nada') + ': ' + USO });
// O radar so le e propoe: o que entra no sworn sai do chat, com o sim do dono, nao da `referencias`.
if (tipoPedido && gravar) sair(1, { gravou: false, erro: 'a ficha do radar nao entra na referencias (--gravar): o escolhido entra pelo chat, com o sim do dono' });

const raiz = config.raizDoProjeto(process.cwd());
const absoluto = path.resolve(arg);
const rel = caminho.relativoAoProjeto(absoluto, raiz) || absoluto;
const tipo = tipoPedido || referencia.tipoDaFicha(rel);
let conteudo;
try { conteudo = texto.semBom(fs.readFileSync(absoluto, 'utf8')); } catch (e) {
  sair(1, { gravou: false, erro: 'nao consegui ler a ficha ' + rel + ' (' + e.message + ')' });
}
const r = referencia.conferir(conteudo, { tipo: tipo });
if (!tipo) r.problemas.unshift('a ficha mora em .claude/sworn/referencias/<tipo>-<assunto>.md (tipo: tela, codigo ou texto); veio ' + rel);
const relatorio = { ficha: rel, tipo: tipo, achados: r.achados, semSaber: r.semSaber, abertos: r.abertos, bytes: r.bytes };
if (tipo === 'radar') Object.assign(relatorio, { candidatos: r.candidatos, adotar: r.adotar });
if (r.problemas.length) sair(1, Object.assign({ ok: false, gravou: false, problemas: r.problemas }, relatorio));
if (!gravar) sair(0, Object.assign({ ok: true, problemas: [] }, relatorio));

const arquivo = config.caminhoEmSworn(raiz, 'projeto.json');
if (!fs.existsSync(arquivo)) sair(1, { gravou: false, erro: 'sem ' + RELATIVO + ' neste projeto: rode /sworn:init antes' });
let obj;
try { obj = JSON.parse(texto.semBom(fs.readFileSync(arquivo, 'utf8'))); } catch (e) {
  sair(1, { gravou: false, erro: RELATIVO + ' nao e JSON valido (' + e.message + '); corrija e rode de novo' });
}
if (!obj || typeof obj !== 'object' || Array.isArray(obj)) sair(1, { gravou: false, erro: RELATIVO + ' nao e um objeto JSON' });
const n = referencia.naReferencia(obj, tipo, rel);
if (n.erros.length) sair(1, { gravou: false, erro: RELATIVO + ': ' + n.erros.join('; ') + '; corrija e rode de novo' });
try { fs.writeFileSync(arquivo, JSON.stringify(n.config, null, 2) + '\n'); } catch (e) {
  sair(1, { gravou: false, erro: 'nao consegui gravar ' + RELATIVO + ' (' + e.message + ')' });
}
sair(0, Object.assign({ ok: true, gravou: true, arquivo: RELATIVO, referencias: n.config.referencias }, relatorio));
