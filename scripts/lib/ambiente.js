'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const texto = require('./texto.js');
const jsonio = require('./jsonio.js');

const LIMITES = (function () {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'modelos', 'limites.json'), 'utf8')); }
  catch (e) { return { delegaveisConhecidos: [] }; }
})();

// A4-01: sem o semBom, o settings.json gravado com BOM (PowerShell 5.1) voltava null e o ambiente saia vazio, calado.
// A4-amb-2 (pedido 12), estados: so ENOENT e ausente; quebrado, ilegivel ou que nao e objeto entra em `naoLidos`
// (`rel (causa)`) - antes era ausente, calado, e o init dizia "nada" de um projeto que configura.
function lerObjeto(cwd, rel, naoLidos) {
  const r = jsonio.ler(path.join(cwd, rel), { objeto: true });
  if (r.erro) naoLidos.push(rel + ' (' + texto.causaDoErro(r.erro) + ')');
  else if (r.etapa === 'forma') naoLidos.push(rel + ' (nao e um objeto JSON)');
  return r.valor;
}

// A4-75: o campo que tem de ser um mapa de nomes; lista ou texto virava nomes de indice ("0") ou letras e, calado,
// plugins e servidores que nao existem. Fora da forma: {} e o motivo em `naoLidos`.
function mapa(obj, campo, rel, naoLidos) {
  const v = obj[campo];
  if (v === undefined || v === null) return {};
  if (typeof v === 'object' && !Array.isArray(v)) return v;
  naoLidos.push(rel + ' (' + campo + ' nao e um objeto de nomes)');
  return {};
}

function subpastas(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(function (e) { return e.isDirectory(); })
      .map(function (e) { return e.name; });
  } catch (e) { return []; }
}

function arquivosMd(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(function (e) { return e.isFile() && e.name.endsWith('.md'); })
      .map(function (e) { return e.name.replace(/\.md$/, ''); });
  } catch (e) { return []; }
}

/**
 * H9-3 (D881, curso Introduction to MCP): os servidores MCP de fora do .mcp.json, do `~/.claude.json` que o Claude
 * Code grava: os do usuario (`mcpServers` no topo, valem em todo projeto) e os locais (`projects[<raiz>].mcpServers`,
 * so neste). So os NOMES: o arquivo guarda configuracao e credencial de servidor, e nenhum valor sai daqui. A chave do
 * projeto vem com barra normal e, no Windows, sem caixa fixa ("c:/..."): compara pela barra normal, sem caixa no
 * Windows. Ausente = nada; ilegivel ou fora da forma entra em `naoLidos` pelo nome do arquivo (fail-open: e inventario,
 * nao trava).
 */
function mcpForaDoProjeto(cwd, claudeJson, rotulo, naoLidos) {
  const vazio = { usuario: [], local: [] };
  const r = jsonio.ler(claudeJson, { objeto: true });
  // o jsonio.ler ja devolve o ausente (ENOENT) sem erro e sem valor, como no lerObjeto. O erro de JSON do V8 copia um
  // trecho do texto ("Unexpected token ..., "<texto>" is not valid JSON"): no arquivo de credencial, so o codigo do
  // erro de leitura sai, nunca a mensagem do parser.
  if (r.erro) {
    naoLidos.push(rotulo + ' (' + (r.erro.code ? texto.causaDoErro(r.erro) : 'nao e JSON valido') + ')');
    return vazio;
  }
  if (r.etapa === 'forma') { naoLidos.push(rotulo + ' (nao e um objeto JSON)'); return vazio; }
  if (!r.valor) return vazio;
  const usuario = Object.keys(mapa(r.valor, 'mcpServers', rotulo, naoLidos));
  const projetos = mapa(r.valor, 'projects', rotulo, naoLidos);
  const semCaixa = process.platform === 'win32';
  const chave = function (p) { const n = String(p).replace(/\\/g, '/').replace(/\/+$/, ''); return semCaixa ? n.toLowerCase() : n; };
  const alvo = chave(path.resolve(cwd));
  // a mesma pasta pode estar em mais de uma chave (caixa ou barra diferentes): os servidores de todas contam
  const local = [];
  Object.keys(projetos).filter(function (p) { return chave(p) === alvo; }).forEach(function (p) {
    const doProjeto = projetos[p];
    if (!doProjeto || typeof doProjeto !== 'object' || Array.isArray(doProjeto)) {
      naoLidos.push(rotulo + ' (projects deste projeto nao e um objeto)');
      return;
    }
    for (const n of Object.keys(mapa(doProjeto, 'mcpServers', rotulo + ', projects deste projeto', naoLidos))) {
      if (local.indexOf(n) === -1) local.push(n);
    }
  });
  return { usuario: usuario, local: local };
}

/** O `.claude.json` mora na pasta de config quando CLAUDE_CONFIG_DIR a muda; senao, na pasta pessoal. */
function caminhoDoClaudeJson(env) {
  return env && env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(os.homedir(), '.claude.json');
}

/** O nome do arquivo nos avisos, o mesmo que o caminhoDoClaudeJson escolhe (sem a pasta pessoal por extenso). */
function rotuloDoClaudeJson(env) {
  return env && env.CLAUDE_CONFIG_DIR ? '$CLAUDE_CONFIG_DIR/.claude.json' : '~/.claude.json';
}

/** O rotulo que o chamador passou em `opcoes.rotuloClaudeJson`; sem ele, o da pasta pessoal. */
function rotuloDe(opcoes) {
  return opcoes && typeof opcoes.rotuloClaudeJson === 'string' && opcoes.rotuloClaudeJson ? opcoes.rotuloClaudeJson : '~/.claude.json';
}

/**
 * Decisao 3 de pre-sessao: nucleo proprio + DETECCAO.
 * O que ja existe no projeto nao se duplica: delega-se, ou deixa-se em paz.
 * `opcoes.claudeJson`: o caminho do `~/.claude.json`, que so quem roda pela linha de comando passa (o teste de
 * biblioteca nao le o arquivo da maquina); sem ele, `mcpForaDoProjeto` sai vazio. `opcoes.rotuloClaudeJson`: o
 * nome dele nos avisos (o `rotuloDoClaudeJson`); sem ele, `~/.claude.json`.
 */
function detectar(cwd, opcoes) {
  const base = path.join(cwd, '.claude');
  const naoLidos = [];
  const settings = lerObjeto(cwd, '.claude/settings.json', naoLidos) || {};
  const local = lerObjeto(cwd, '.claude/settings.local.json', naoLidos) || {};

  // A4-amb-1 (pedido 12), borda: `false` e plugin desligado - e o local, que vale por cima do settings, desliga.
  const ligados = Object.assign({}, mapa(settings, 'enabledPlugins', '.claude/settings.json', naoLidos),
    mapa(local, 'enabledPlugins', '.claude/settings.local.json', naoLidos));
  const plugins = Object.keys(ligados).filter(function (p) { return ligados[p] !== false; });

  const hooks = Object.keys(Object.assign({}, mapa(settings, 'hooks', '.claude/settings.json', naoLidos),
    mapa(local, 'hooks', '.claude/settings.local.json', naoLidos)));

  // A4-36: o .mcp.json vale nas duas formas, { "mcpServers": { nome: {...} } } (a do Claude Code) ou os servidores
  // direto na raiz, { nome: {...} }; com a chave mcpServers presente, so ela conta
  const mcpArquivo = lerObjeto(cwd, '.mcp.json', naoLidos) || {};
  const mcp = Object.keys(Object.prototype.hasOwnProperty.call(mcpArquivo, 'mcpServers')
    ? mapa(mcpArquivo, 'mcpServers', '.mcp.json', naoLidos) : mcpArquivo);

  const fora = opcoes && typeof opcoes.claudeJson === 'string' && opcoes.claudeJson
    ? mcpForaDoProjeto(cwd, opcoes.claudeJson, rotuloDe(opcoes), naoLidos) : { usuario: [], local: [] };
  const todosMcp = mcp.concat(fora.usuario, fora.local);

  const delegaveis = [];
  for (const d of (LIMITES.delegaveisConhecidos || [])) {
    const achou = plugins.some(function (p) { return p.indexOf(d.nome) === 0; }) ||
                  todosMcp.some(function (m) { return m.indexOf(d.nome) !== -1; });
    if (achou) delegaveis.push(d.nome + ': ' + d.delega);
  }

  return {
    plugins: plugins,
    skills: subpastas(path.join(base, 'skills')),
    agentes: arquivosMd(path.join(base, 'agents')),
    hooks: hooks,
    mcp: mcp,
    mcpForaDoProjeto: fora,
    delegaveis: delegaveis,
    naoLidos: naoLidos
  };
}

module.exports = { LIMITES, caminhoDoClaudeJson, rotuloDoClaudeJson, rotuloDe, detectar };
