'use strict';
/**
 * H15(b) (D923): o advisor do Claude Code (a ferramenta que consulta um modelo mais forte no meio da tarefa), lido do
 * disco para o portao-fecho.js. A bateria do H15(a) mediu 0 consultas em 9 rodadas com ele ligado e sem pedido; com
 * o pedido, 1 por rodada e o defeito da T5 em 1 de 3 rodadas, contra 3 de 3 sem ele (docs/bateria/metodo-advisor.md).
 *
 * Limite dito: a flag `--advisor` da linha de comando nao chega ao gancho; so o `advisorModel` das settings se ve.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jsonio = require('./jsonio.js');
const texto = require('./texto.js');

// a regra de verdade das variaveis do Claude Code: 1, true, yes ou on, sem caixa e sem espaco nas pontas
const VERDADE = /^(1|true|yes|on)$/i;
// o nome da ferramenta entre aspas, o pre-filtro das linhas da transcricao
const NOME = '"advisor"';

/** As settings na ordem em que o Claude Code as aplica, da que manda para a que cede: local, projeto, usuario. */
function arquivosDeSettings(cwd, env) {
  const usuario = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const projeto = cwd ? [path.join(cwd, '.claude', 'settings.local.json'), path.join(cwd, '.claude', 'settings.json')] : [];
  return projeto.concat([path.join(usuario, 'settings.json')]);
}

/**
 * O advisor esta ligado: o `advisorModel` da primeira settings que o declara e um texto nao vazio, e a variavel
 * CLAUDE_CODE_DISABLE_ADVISOR_TOOL nao o desliga. A settings que nao se le (rasgada, ilegivel) nao decide.
 */
function ligado(cwd, env) {
  const ambiente = env || process.env;
  // pela ponte (scripts/ponte.js poe SWORN_PONTE=1) o harness nao e o Claude Code: nao ha advisor a consultar
  if (ambiente.SWORN_PONTE === '1') return false;
  if (VERDADE.test(String(ambiente.CLAUDE_CODE_DISABLE_ADVISOR_TOOL || '').trim())) return false;
  for (const arquivo of arquivosDeSettings(cwd, ambiente)) {
    const r = jsonio.ler(arquivo, { objeto: true });
    if (!r.valor || !Object.prototype.hasOwnProperty.call(r.valor, 'advisorModel')) continue;
    const v = r.valor.advisorModel;
    return typeof v === 'string' && v.trim() !== '';
  }
  return false;
}

function ehConsulta(b) { return Boolean(b) && b.type === 'server_tool_use' && b.name === 'advisor'; }

/** A linha do Buffer em volta da posicao `i`, de quebra a quebra, decodificada e sem o BOM; JSON ou null. */
function linhaEm(buf, i) {
  const ini = buf.lastIndexOf(10, i) + 1;
  const quebra = buf.indexOf(10, i);
  const fim = quebra === -1 ? buf.length : quebra;
  let o = null;
  try { o = JSON.parse(texto.semBom(buf.toString('utf8', ini, fim))); } catch (e) { o = null; }
  return { o: o, fim: fim };
}

/**
 * A sessao consultou o advisor: um bloco `server_tool_use` de nome `advisor` numa linha que nao e de subagente
 * (isSidechain). true ou false; null quando nao ha o que ler (sem caminho, arquivo que nao se le - inclusive o acima
 * de 2 GB, o teto do Node para um Buffer -, ou texto que nao e transcricao do Claude Code). O pre-filtro e o nome
 * entre aspas: o usage de toda linha de assistente traz "server_tool_use", entao ele nao separa nada. Le em Buffer e
 * decodifica so as linhas que trazem o nome: a transcricao longa passa do teto de uma string (512 MB) sem virar null.
 * O portao-fecho.js chama uma vez por sessao.
 */
function consultou(caminho) {
  if (typeof caminho !== 'string' || !caminho) return null;
  let buf;
  try { buf = fs.readFileSync(caminho); } catch (e) { return null; }
  if (buf.indexOf('"isSidechain"') === -1) return null;
  for (let i = buf.indexOf(NOME); i !== -1; ) {
    const { o, fim } = linhaEm(buf, i);
    if (o && o.isSidechain !== true && o.message && Array.isArray(o.message.content) &&
      o.message.content.some(ehConsulta)) return true;
    i = buf.indexOf(NOME, fim);
  }
  return false;
}

module.exports = { ligado, consultou };
