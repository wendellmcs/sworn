#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const io = require('./lib/io.js');
const estado = require('./lib/estado.js');
const config = require('./lib/config.js');
const escalada = require('./lib/escalada.js');
const { mensagemDoSubagente } = require('./lib/texto.js');

// D694 (T3 da escada, D678): no fim do subagente, guarda o pedido `ESCALAR: <agente> - <motivo>`; no comeco, da baixa
// no pedido que tinha aquele agente como destino (lib/escalada.js). Quem cobra e o fecho do turno (portao-fecho.js).
// NUNCA decide: no SubagentStop, `block` faria o subagente continuar.
// C4 (s369, D769 g): conta as negacoes das travas do sworn na transcricao do subagente; 3 ou mais sobem o degrau.
// H6i (s376, D905): no StopFailure rate_limit de um subagente da escada, o degrau sobe (escalada.aoLimite).

// O fim da transcricao basta: as negacoes que prendem o agente sao as do despacho, e o gancho tem 10 s.
const CAUDA = 4 * 1024 * 1024;

/** A transcricao do subagente: `agent_transcript_path` quando vem; senao `<sessao>/subagents/agent-<id>.jsonl` ao lado
 *  da transcricao da sessao (o lugar em que o Claude Code a grava). null quando o id nao e um nome simples (letras,
 *  digitos, `_` e `-`), mesmo com `agent_transcript_path`: o pedido guardado vai com esse id. */
function transcricaoDoSubagente(e) {
  if (typeof e.agent_id !== 'string' || !/^[\w-]+$/.test(e.agent_id)) return null;
  if (typeof e.agent_transcript_path === 'string' && e.agent_transcript_path) return e.agent_transcript_path;
  const t = e.transcript_path;
  if (typeof t !== 'string' || !t) return null;
  const nome = 'agent-' + e.agent_id + '.jsonl';
  if (path.basename(t) === nome) return t;
  return path.join(path.dirname(t), path.basename(t, '.jsonl'), 'subagents', nome);
}

// atalho: so a transcricao do Claude Code. limite: nas pontes (Codex, Qwen, OpenCode) a negacao nao e lida e o degrau
// preso sobe so pelo B5. trocar quando: a ponte gravar a negacao com o agent_id.
function negacoesDoSubagente(e) {
  const arquivo = transcricaoDoSubagente(e);
  if (!arquivo) return 0;
  let fd;
  try {
    fd = fs.openSync(arquivo, 'r');
    const tamanho = fs.fstatSync(fd).size;
    const n = Math.min(tamanho, CAUDA);
    const buf = Buffer.alloc(n);
    const lidos = fs.readSync(fd, buf, 0, n, tamanho - n);
    // a primeira linha da cauda pode vir cortada: o JSON.parse dela falha e o contarNegacoes a pula
    return escalada.contarNegacoes(buf.toString('utf8', 0, lidos));
  } catch (err) {
    // transcricao ilegivel (ausente, sem permissao) conta zero de proposito: o gancho nunca decide, e o degrau preso
    // ainda sobe pelo B5 (dois retornos sem prova)
    return 0;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (err) { /* nada a fazer */ }
  }
}

io.blindar(function () {
  io.lerEntrada(function (e) {
    let mudar;
    if (e.hook_event_name === 'SubagentStart') {
      mudar = function (s) { return escalada.aoAbrir(s, e.agent_type, e.agent_id); };
    } else if (e.hook_event_name === 'StopFailure') {
      // H6i (s376, D905): o subagente encerrado no limite de uso. Medido no Claude Code 2.1.328: o SubagentStop dele
      // nao dispara, e a saida deste gancho e descartada; quem cobra o despacho e o fecho do turno. So o rate_limit
      // sobe (o server_error e passageiro), e so o subagente: a sessao principal vem sem agent_id, e o aoLimite a recusa.
      if (e.error !== 'rate_limit') return io.permitir();
      const projeto = config.carregarProjeto(config.raizDoProjeto(typeof e.cwd === 'string' && e.cwd ? e.cwd : process.cwd()));
      mudar = function (s) { return escalada.aoLimite(s, e.agent_type, e.agent_id, projeto); };
    } else {
      const mensagem = mensagemDoSubagente(e);
      if (typeof mensagem !== 'string') return io.permitir();
      const projeto = config.carregarProjeto(config.raizDoProjeto(typeof e.cwd === 'string' && e.cwd ? e.cwd : process.cwd()));
      const escada = projeto && projeto.agentes && Array.isArray(projeto.agentes.escada) ? projeto.agentes.escada : [];
      // C4: so o agente da escada paga a leitura da transcricao
      const negacoes = escada.indexOf(e.agent_type) === -1 ? 0 : negacoesDoSubagente(e);
      mudar = function (s) { return escalada.aoFechar(s, e.agent_type, e.agent_id, mensagem, projeto, negacoes); };
    }
    // Sem nada a mudar, nem trava nem gravacao: as levas de inspetores nascem e terminam juntas.
    const antes = estado.ler(e.session_id);
    if (mudar(antes) === antes.escalada) return io.permitir();
    estado.alterar(e.session_id, function (s) { s.escalada = mudar(s); return s; });
    io.permitir();
  });
});
