'use strict';
const fs = require('fs');
const path = require('path');

/**
 * C7b (s369, D816): a receita do Codex para o teste de admissao (scripts/admissao.js --harness codex). E a mesma da
 * bateria (docs/bateria/rodar.js, D777 e D778), copiada aqui porque o docs/ nao vai ao publico (D765): o `codex exec
 * --json` sem o config.toml nem os .rules do usuario (o login segue), com o freio nativo (workspace-write + never), a
 * confianca dos ganchos do sworn so nesta chamada (-c hooks.state) e na pasta pessoal falsa que o --conferir le.
 * atalho: copia da receita da bateria. limite: uma mudanca la (a D777/D778) tem de ser repetida aqui. trocar quando:
 * a receita mudar - entao ela vai para esta lib e o rodar.js passa a usa-la.
 */

const snake = function (e) { return e.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase(); };

/** O literal TOML entre aspas simples da receita (sem escape: a barra do Windows passa como esta). O apostrofo o
 *  fecharia antes da hora e a confianca iria para outra chave: lanca, e quem chama diz o passo. */
function literal(s) {
  if (String(s).indexOf("'") !== -1) throw new Error('o caminho tem apostrofo, que o literal TOML do Codex nao aceita: ' + s);
  return "'" + s + "'";
}

/** A confianca de cada gancho do .codex/hooks.json da `pasta` (a chave do [hooks.state] e o hash do instalar.js).
 *  Ausente = nenhum gancho ([]); JSON invalido ou formato errado lancam. */
function confianca(pasta, hashDoCodex) {
  const arq = path.join(pasta, '.codex', 'hooks.json');
  let texto;
  try { texto = fs.readFileSync(arq, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const itens = [];
  for (const [ev, grupos] of Object.entries(JSON.parse(texto).hooks || {})) {
    grupos.forEach(function (g, i) {
      (g.hooks || []).forEach(function (h, j) {
        itens.push({ chave: arq + ':' + snake(ev) + ':' + i + ':' + j, hash: hashDoCodex(ev, g, h) });
      });
    });
  }
  return itens;
}

/** D778: a aprovacao dos ganchos na pasta pessoal falsa (`casa`), onde o --conferir do sworn a le. A chave com
 *  apostrofo lanca antes de gravar. */
function aprovarNaCasa(casa, itens) {
  const blocos = itens.map(function (c) { return '[hooks.state.' + literal(c.chave) + ']\ntrusted_hash = "' + c.hash + '"\n'; });
  fs.mkdirSync(path.join(casa, '.codex'), { recursive: true });
  fs.appendFileSync(path.join(casa, '.codex', 'config.toml'), blocos.join('\n') + '\n');
}

/** A chamada do `codex exec` de um cenario. `pasta` e o caminho longo (o Codex casa o projeto e os ganchos por ele);
 *  a pasta ou a chave com apostrofo lanca. */
function comando({ codex, modelo, pasta, itens, pedido, casa, codexHome, ambiente }) {
  const confiar = itens.map(function (c) { return literal(c.chave) + '={trusted_hash="' + c.hash + '"}'; });
  // --skip-git-repo-check: a pasta do cenario nao e um repositorio git (a da bateria e), e sem ele o Codex recusa
  // ("Not inside a trusted directory", sonda s369)
  const args = ['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '-s', 'workspace-write',
    '-c', 'approval_policy="never"', '-c', 'windows.sandbox="unelevated"',
    '-c', 'projects={' + literal(pasta) + '={trust_level="trusted"}}', '-m', modelo,
    '-c', 'hooks.state={' + confiar.join(',') + '}', pedido];
  const env = Object.assign({}, ambiente, { USERPROFILE: casa, HOME: casa, CODEX_HOME: codexHome });
  return { exe: codex, args: args, env: env };
}

/** O resultado do `codex exec --json`: o texto da ultima `agent_message`, o erro (o `turn.failed`, o `error` do
 *  topo, ou a falta do `turn.completed`) e a sessao (`thread_id`); null sem nenhuma linha que se le. */
function lerResultado(bruto) {
  let texto = '';
  let sessao = null;
  let completo = false;
  let erro = null;
  let msgErro = '';
  let lidas = 0;
  for (const linha of String(bruto || '').split('\n')) {
    if (!linha.trim()) continue;
    let o;
    try { o = JSON.parse(linha); } catch (e) { continue; }
    if (!o || typeof o !== 'object') continue;
    lidas++;
    // o estado do sworn se grava como <thread_id>.json (sonda s369): so o formato do uuid vira nome de arquivo
    if (o.type === 'thread.started' && typeof o.thread_id === 'string' && /^[0-9a-f-]{36}$/.test(o.thread_id)) {
      sessao = o.thread_id;
    }
    else if (o.type === 'item.completed' && o.item && o.item.type === 'agent_message' && typeof o.item.text === 'string') {
      texto = o.item.text;
    } else if (o.type === 'turn.completed') completo = true;
    else if (o.type === 'turn.failed' || o.type === 'error') {
      // o tipo e a mensagem do Codex (o limite de uso, o login, o modelo que nao existe): o ultimo evento de erro da o
      // tipo, e a ultima mensagem que veio fica (o turn.failed sem mensagem nao apaga a do error de antes)
      const msg = o.type === 'error' ? o.message : o.error && o.error.message;
      if (typeof msg === 'string' && msg) msgErro = msg.slice(0, 200);
      erro = o.type;
    }
  }
  if (!lidas) return null;
  if (erro && msgErro) erro += ': ' + msgErro;
  return { erro: erro || (completo ? null : 'sem turn.completed'), texto: texto, sessao: sessao, custo: null };
}

module.exports = { confianca, aprovarNaCasa, comando, lerResultado };
