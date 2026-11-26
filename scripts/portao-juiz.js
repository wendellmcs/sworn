#!/usr/bin/env node
'use strict';
// C3 (D808, D769 (b)): o inspetor da revisao cega um degrau acima do executor. No despacho de `sworn:inspector` (ou
// `sworn-inspector` fora do Claude Code), troca o `model` pelo degrau acima do modelo da sessao (lib/juiz.js), pelo
// `updatedInput` do PreToolUse; nao decide permissao. Sem o modelo da sessao, com o despacho ja num degrau igual ou
// acima, ou com "juizAcima": false no projeto.json, o modelo fica como veio. D829: o briefing das rondas 2 e 3 (pelo
// caminho da pasta de vereditos) vai um degrau abaixo do juiz, com o pedido que vier.
// F4e: todo agente (`sworn:<nome>` ou `sworn-<nome>`, e o de fora do sworn) leva no fim do pedido o guia oficial do
// modelo que vai roda-lo (lib/guias-modelo.js), uma vez so; "guiaDoModelo": false desliga. O modelo sai na ordem da
// doc oficial dos subagentes (familiaDoDespacho): o `model` do despacho, o da definicao, a variavel
// CLAUDE_CODE_SUBAGENT_MODEL, a sessao; com CLAUDE_CODE_SUBAGENT_MODEL_FORCE ligada, a variavel vale antes de tudo.
// A definicao do agente de fora: a do projeto (.claude/agents), depois a do usuario (a pasta agents do
// CLAUDE_CONFIG_DIR, ou da ~/.claude), depois a do embutido conhecido; sem definicao achada, so o pedido ou a variavel
// forcada dizem o modelo. A bifurcacao (fork) e o nome torto passam como vieram. Limite: o agente da politica
// gerenciada, o do --agents da linha de comando e o de outro plugin nao se leem daqui.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const io = require('./lib/io.js');
const config = require('./lib/config.js');
const juiz = require('./lib/juiz.js');
const guias = require('./lib/guias-modelo.js');
const agentes = require('./lib/agentes.js');

const RAIZ_DO_PLUGIN = path.join(__dirname, '..');
const INSPETOR = /^(?:sworn:inspector|sworn-inspector)$/;
const DO_SWORN = /^sworn[:-]([a-z0-9][a-z0-9-]*)$/;
const NOME = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
// os embutidos do Claude Code e o `model` de cada um: null segue a variavel e a sessao; inherit, so a sessao
const EMBUTIDOS = new Map([['general-purpose', null], ['claude', null], ['Explore', 'inherit'], ['Plan', 'inherit'],
  ['claude-code-guide', 'haiku'], ['web-fetch', 'haiku'], ['statusline-setup', 'sonnet']]);

/** O `model` do agents/<nome>.md do plugin, ou null (sem o arquivo, sem a chave). */
function modeloDoAgente(nome) {
  try {
    return agentes.frontmatter(fs.readFileSync(path.join(RAIZ_DO_PLUGIN, 'agents', nome + '.md'), 'utf8')).campos.model || null;
  } catch (e) { // fail-open: sem o arquivo do agente, o guia segue o pedido, a variavel ou a sessao (ele nunca nega)
    return null;
  }
}

/**
 * O `model` da definicao do agente de fora do sworn: o valor, null quando a definicao achada nao o declara, ou
 * undefined sem definicao achada. Uma pasta, ou um arquivo de agente nela, que nao se le pode ter o agente: undefined.
 */
function modeloDeFora(nome, raiz, env) {
  const pastas = [path.join(String(raiz), agentes.PASTA[0], agentes.PASTA[1]),
    path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'agents')];
  for (const dir of pastas) {
    const lida = agentes.listarPasta(dir);
    if (lida.erro || lida.agentes.some(function (a) { return a.erro; })) return undefined;
    const achado = lida.agentes.find(function (a) { return a.nome === nome; });
    if (achado) return achado.model;
  }
  return EMBUTIDOS.has(nome) ? EMBUTIDOS.get(nome) : undefined;
}

io.blindar(function () {
  io.lerEntrada(function (e) {
    const pedido = e.tool_input || {};
    const nome = String(pedido.subagent_type || '') || 'general-purpose';
    if (nome === 'fork' || !NOME.test(nome)) return io.permitir();
    const tipo = DO_SWORN.exec(nome);
    const raiz = config.raizDoProjeto(e.cwd || process.cwd());
    const projeto = config.carregarProjeto(raiz);
    const sessao = juiz.modeloDaSessao(e.transcript_path);
    const novo = Object.assign({}, pedido);
    // D829: a ronda sai do caminho de vereditos do briefing; as rondas 2 e 3 vao um degrau abaixo do juiz
    if (INSPETOR.test(nome) && !(projeto && projeto.juizAcima === false)) {
      const alvo = juiz.alvoDoDespacho(sessao, pedido);
      if (alvo) novo.model = alvo;
    }
    if (!(projeto && projeto.guiaDoModelo === false)) {
      const padrao = tipo ? modeloDoAgente(tipo[1]) : modeloDeFora(nome, raiz, process.env);
      const familia = guias.familiaDoDespacho(novo.model, padrao, sessao,
        { env: process.env, semDefinicao: padrao === undefined });
      const guia = familia ? guias.bloco(RAIZ_DO_PLUGIN, familia) : '';
      if (guia) novo.prompt = guias.comGuia(pedido.prompt, guia);
    }
    if (novo.model === pedido.model && novo.prompt === pedido.prompt) return io.permitir();
    return io.permitir({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: novo } });
  });
});
