#!/usr/bin/env node
'use strict';
// C3 (D808, D769 (b)): o inspetor da revisao cega um degrau acima do executor. No despacho de `sworn:inspector` (ou
// `sworn-inspector` fora do Claude Code), troca o `model` pelo degrau acima do modelo da sessao (lib/juiz.js), pelo
// `updatedInput` do PreToolUse; nao decide permissao. Sem o modelo da sessao, com o despacho ja num degrau igual ou
// acima, ou com "juizAcima": false no projeto.json, o modelo fica como veio. D829: o briefing das rondas 2 e 3 (pelo
// caminho da pasta de vereditos) vai um degrau abaixo do juiz, com o pedido que vier.
// F4e: todo agente do sworn (`sworn:<nome>` ou `sworn-<nome>`) leva no fim do pedido o guia oficial do modelo que vai
// roda-lo (lib/guias-modelo.js), uma vez so; "guiaDoModelo": false desliga. Agente de fora do sworn passa como veio.
const fs = require('node:fs');
const path = require('node:path');
const io = require('./lib/io.js');
const config = require('./lib/config.js');
const juiz = require('./lib/juiz.js');
const guias = require('./lib/guias-modelo.js');
const agentes = require('./lib/agentes.js');

const RAIZ_DO_PLUGIN = path.join(__dirname, '..');
const INSPETOR = /^(?:sworn:inspector|sworn-inspector)$/;
const DO_SWORN = /^sworn[:-]([a-z0-9][a-z0-9-]*)$/;

/** O `model` do agents/<nome>.md do plugin, ou null (sem o arquivo, sem a chave). */
function modeloDoAgente(nome) {
  try {
    return agentes.frontmatter(fs.readFileSync(path.join(RAIZ_DO_PLUGIN, 'agents', nome + '.md'), 'utf8')).campos.model || null;
  } catch (e) {
    return null;
  }
}

io.blindar(function () {
  io.lerEntrada(function (e) {
    const pedido = e.tool_input || {};
    const tipo = DO_SWORN.exec(String(pedido.subagent_type || ''));
    if (!tipo) return io.permitir();
    const projeto = config.carregarProjeto(config.raizDoProjeto(e.cwd || process.cwd()));
    const sessao = juiz.modeloDaSessao(e.transcript_path);
    const novo = Object.assign({}, pedido);
    // D829: a ronda sai do caminho de vereditos do briefing; as rondas 2 e 3 vao um degrau abaixo do juiz
    if (INSPETOR.test(pedido.subagent_type) && !(projeto && projeto.juizAcima === false)) {
      const alvo = juiz.alvoDoDespacho(sessao, pedido);
      if (alvo) novo.model = alvo;
    }
    if (!(projeto && projeto.guiaDoModelo === false)) {
      const familia = guias.familiaDoDespacho(novo.model, modeloDoAgente(tipo[1]), sessao);
      const guia = familia ? guias.bloco(RAIZ_DO_PLUGIN, familia) : '';
      if (guia) novo.prompt = guias.comGuia(pedido.prompt, guia);
    }
    if (novo.model === pedido.model && novo.prompt === pedido.prompt) return io.permitir();
    return io.permitir({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: novo } });
  });
});
