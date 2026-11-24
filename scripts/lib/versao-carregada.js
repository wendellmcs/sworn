'use strict';
// H12a (D913, ideia do ChromeDevTools/chrome-devtools-mcp, reescrita aqui): o Claude Code carrega o plugin quando o
// chat abre, e o /clear nao recarrega. Instalada a versao nova, a sessao aberta segue com as travas velhas sem
// ninguem notar; a abertura compara a versao que roda com a mais nova instalada e diz em uma linha.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/** `[maior, menor, correcao]` de uma versao `a.b.c` (texto), ou null. */
function numeros(v) {
  const m = typeof v === 'string' ? /^(\d+)\.(\d+)\.(\d+)/.exec(v) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function maisNova(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/**
 * O aviso, ou null. `opcoes.raiz`: a raiz do plugin que roda (padrao, a deste arquivo); `opcoes.env`: o ambiente
 * (padrao, o do processo), de onde sai CLAUDE_CONFIG_DIR. Manifesto ilegivel lanca (a abertura diz que nao rodou);
 * installed_plugins.json ausente ou torto e silencio.
 * atalho: toda entrada `<nome>@*` conta, de qualquer escopo. limite: vale enquanto o sworn e instalado so no escopo do
 * usuario. trocar quando: uma instalacao no escopo de projeto mais nova, noutro projeto, der aviso falso.
 */
function aviso(opcoes) {
  const o = opcoes || {};
  const raiz = o.raiz || path.join(__dirname, '..', '..');
  const env = o.env || process.env;
  const manifesto = JSON.parse(fs.readFileSync(path.join(raiz, '.claude-plugin', 'plugin.json'), 'utf8'));
  const rodando = numeros(manifesto && manifesto.version);
  if (!rodando || typeof manifesto.name !== 'string') return null;
  const config = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  let instalados;
  try {
    instalados = JSON.parse(fs.readFileSync(path.join(config, 'plugins', 'installed_plugins.json'), 'utf8'));
  } catch (e) {
    return null;
  }
  const mapa = instalados && typeof instalados.plugins === 'object' && instalados.plugins ? instalados.plugins : {};
  let nova = null;
  Object.keys(mapa).forEach(function (chave) {
    if (chave.split('@')[0] !== manifesto.name || !Array.isArray(mapa[chave])) return;
    mapa[chave].forEach(function (entrada) {
      const v = numeros(entrada && entrada.version);
      if (v && maisNova(v, rodando) && (!nova || maisNova(v, nova))) nova = v;
    });
  });
  if (!nova) return null;
  return 'sworn: esta sessao roda a ' + rodando.join('.') + ', e a ' + nova.join('.') + ' ja esta instalada. So um ' +
    'chat novo carrega a nova (o /clear nao recarrega): abra um quando puder.';
}

module.exports = { aviso: aviso };
