#!/usr/bin/env node
'use strict';
// F4c: monta o handoff curto (scripts/lib/handoff-curto.js) e confere o preenchido. O /sworn:handoff roda isto no
// Passo 2, na raiz do projeto: imprime o destino e o texto, sem gravar nada; o modelo preenche as marcas <<...>> e
// grava pelo Write (so assim os ganchos marcam o handoff da sessao); depois roda --conferir no arquivo.
//   node handoff-curto.js --slug <tema> [--frente <f>] [--hoje AAAA-MM-DD] [--sessao <id>]
//   node handoff-curto.js --conferir <arquivo>    -> JSON { ok, problemas, bytes }
// Saida 0: montou (ou o arquivo passou). Saida 1: o arquivo nao passou no --conferir, ou falha inesperada (com a pilha).
// Saida 2: erro de uso (sem --slug, slug fora da regra, data torta, --slug/--hoje/--frente/--sessao sem valor) ou
// arquivo do --conferir que nao se le.
const fs = require('node:fs');
const path = require('node:path');
const hc = require('./lib/handoff-curto.js');
const estado = require('./lib/estado.js');
const textoLib = require('./lib/texto.js');

const OPCOES = ['--slug', '--frente', '--hoje', '--sessao', '--conferir'];
const args = process.argv.slice(2);
/** O valor depois de `nome`: undefined sem a opcao; '' quando falta o valor (fim da linha ou outra opcao do comando). */
function valor(nome) {
  const i = args.indexOf(nome);
  if (i === -1) return undefined;
  const v = args[i + 1];
  return v === undefined || OPCOES.indexOf(v) !== -1 ? '' : v;
}
function sair(msg, codigo) { process.stderr.write(msg + '\n'); process.exit(codigo); }

const cwd = process.cwd();
const alvo = valor('--conferir');
if (alvo !== undefined) {
  if (!alvo) sair('sworn: --conferir pede o caminho do handoff gravado', 2);
  const abs = path.resolve(cwd, alvo);
  let texto;
  try { texto = fs.readFileSync(abs, 'utf8'); } catch (e) {
    sair('sworn: nao consegui ler ' + abs.replace(/\\/g, '/') + ' (' + textoLib.causaDoErro(e) + '); confira o caminho e rode na raiz do projeto', 2);
  }
  // R5 (D939): o que o handoff cita se confere a partir da raiz onde o comando roda; sem a lista do git (null), o nome
  // curto nao se confere
  const r = hc.conferir(texto, path.relative(cwd, abs).replace(/\\/g, '/'),
    { raiz: cwd, arquivos: require('./lib/git.js').rastreados(cwd) });
  process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  process.exit(r.ok ? 0 : 1);
}

const slug = valor('--slug');
if (!slug) sair('sworn: passe --slug <tema> (' + hc.REGRA_DO_SLUG + '), ou --conferir <arquivo>', 2);
const hoje = valor('--hoje');
if (hoje === '') sair('sworn: --hoje pede a data AAAA-MM-DD', 2);
let frente = valor('--frente');
if (frente === '') sair('sworn: --frente pede o nome da frente', 2);
if (valor('--sessao') === '') sair('sworn: --sessao pede o id da sessao', 2);
if (!frente) {
  const sessao = valor('--sessao') || process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID;
  if (sessao) {
    try { frente = estado.ler(sessao).frente; } catch (e) {
      process.stderr.write('sworn: nao li o estado da sessao (' + textoLib.causaDoErro(e) + '); sigo sem frente, passe --frente se houver\n');
    }
  }
}
let m;
try { m = hc.montar(cwd, { slug: slug, hoje: hoje, frente: frente || null }); } catch (e) {
  if (e && /^sworn:/.test(e.message)) sair(e.message, 2);
  sair(e && e.stack ? e.stack : String(e), 1);
}
process.stdout.write('arquivo: ' + m.caminho + '\n\n' + m.texto);
const bytes = Buffer.byteLength(m.texto, 'utf8');
if (bytes > hc.TETO * 0.75) {
  process.stderr.write('sworn: o rascunho ja tem ' + bytes + ' de ' + hc.TETO + ' bytes; preencha as marcas com pouco texto\n');
}
