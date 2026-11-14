'use strict';
const fs = require('node:fs');
const path = require('node:path');
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
 * Decisao 3 de pre-sessao: nucleo proprio + DETECCAO.
 * O que ja existe no projeto nao se duplica: delega-se, ou deixa-se em paz.
 */
function detectar(cwd) {
  const base = path.join(cwd, '.claude');
  const naoLidos = [];
  const settings = lerObjeto(cwd, '.claude/settings.json', naoLidos) || {};
  const local = lerObjeto(cwd, '.claude/settings.local.json', naoLidos) || {};

  // A4-amb-1 (pedido 12), borda: `false` e plugin desligado - e o local, que vale por cima do settings, desliga.
  const ligados = Object.assign({}, settings.enabledPlugins || {}, local.enabledPlugins || {});
  const plugins = Object.keys(ligados).filter(function (p) { return ligados[p] !== false; });

  const hooks = Object.keys(
    Object.assign({}, (settings.hooks || {}), (local.hooks || {}))
  );

  const mcpArquivo = lerObjeto(cwd, '.mcp.json', naoLidos) || {};
  const mcp = Object.keys(mcpArquivo.mcpServers || mcpArquivo || {}).filter(function (k) { return k !== 'mcpServers'; });

  const delegaveis = [];
  for (const d of (LIMITES.delegaveisConhecidos || [])) {
    const achou = plugins.some(function (p) { return p.indexOf(d.nome) === 0; }) ||
                  mcp.some(function (m) { return m.indexOf(d.nome) !== -1; });
    if (achou) delegaveis.push(d.nome + ': ' + d.delega);
  }

  return {
    plugins: plugins,
    skills: subpastas(path.join(base, 'skills')),
    agentes: arquivosMd(path.join(base, 'agents')),
    hooks: hooks,
    mcp: mcp,
    delegaveis: delegaveis,
    naoLidos: naoLidos
  };
}

module.exports = { LIMITES, detectar };
