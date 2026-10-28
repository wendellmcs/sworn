#!/usr/bin/env node
'use strict';
const io = require('./lib/io.js');
const estado = require('./lib/estado.js');
const busca = require('./lib/busca.js');
const saude = require('./lib/saude.js');

/**
 * T10-2: quantas respostas nao vazias o AskUserQuestion devolveu. Fica fora do `alterar` porque
 * o teste do fecho le o corpo dele procurando gravacao no estado, e um `return` de filtro la dentro
 * parece o `alterar` devolvendo outra coisa que nao o proprio estado.
 */
function contarRespostas(resp) {
  if (!resp || typeof resp !== 'object') return 0;
  const respostas = resp.answers;
  if (!respostas || typeof respostas !== 'object' || Array.isArray(respostas)) return 0;
  return Object.keys(respostas).filter(function (k) {
    const v = respostas[k];
    return v !== null && v !== undefined && String(v).trim() !== '';
  }).length;
}

// T11-7 (D365 secao 3): o resumo que o `git commit` imprime, `[<branch> <sha>] <mensagem>`. A branch
// pode ter espaco e parenteses (`master (root-commit)`, `detached HEAD`); o sha tem de 7 a 40 digitos
// hexadecimais. Tem de ser a linha inteira de saida: texto citado no meio de outra linha nao conta.
// Aceito pela D365 secao 3 (D396 n. 15): um `cat`/`echo` que imprime uma linha nesse formato tambem
// conta como commit; e o preco de nao adivinhar pelo texto do comando.
const LINHA_DO_COMMIT = /^\[[^\]\r\n]+ [0-9a-f]{7,40}\] \S/;

/**
 * T11-7: o Claude Code so preenche `gitOperation` quando a saida do git traz essa linha E o `git -C`
 * aponta para caminho sem espaco (medido na 2.1.292). Sem o campo, a propria linha do `stdout` prova o
 * commit. `git commit -q` nao imprime a linha e continua sem contar: o texto do comando nunca decide.
 * Fica fora do `alterar` pelo mesmo motivo do `contarRespostas`.
 */
function commitNaSaida(resp) {
  if (!resp || typeof resp !== 'object' || typeof resp.stdout !== 'string') return false;
  return resp.stdout.split(/\r?\n/).some(function (linha) { return LINHA_DO_COMMIT.test(linha); });
}

// PostToolUse em Write|Edit|Bash|PowerShell|Grep|Glob|Read|AskUserQuestion: houve trabalho real
// neste turno (o AskUserQuestion so conta a decisao do dono; perguntar nao e trabalho).
io.blindar(function () {
  io.lerEntrada(function (e) {
    estado.alterar(e.session_id, function (s) {
      // A caixa do nome nao decide (ronda 2 do Passo 8b): normalizado uma vez, vale para tudo abaixo.
      const nome = String(e.tool_name || '').toLowerCase();

      // T10-2 (D357): decisao do dono = resposta do AskUserQuestion. Cada chave de `answers` com
      // valor nao vazio e uma decisao. Perguntar NAO e trabalho a provar: sai antes de ligar
      // trabalhoReal, turnosComTrabalho e buscouNesteTurno. `tool_response` ausente ou sem
      // `answers` conta zero (o formato do gancho nao foi provado em sessao interativa).
      if (nome === 'askuserquestion') {
        const n = contarRespostas(e.tool_response);
        if (n) s.decisoesDoDono = (s.decisoesDoDono || 0) + n;
        return s;
      }

      // Plano 091 (#6, D559): o manual carregado libera o portao do manual (portao-escopo.js, passo 5b). Mesma regra
      // do mod (mods.tsx, botao do padrao): skill do agente principal que e o manual (ordens.MANUAL). Carregar skill nao e
      // trabalho a provar: sai antes de ligar trabalhoReal.
      if (nome === 'skill') {
        const skill = (e.tool_input || {}).skill;
        if (!e.agent_id && typeof skill === 'string' && require('./lib/ordens.js').MANUAL.test(skill)) s.manualCarregado = true;
        // Plano 091 T6: a skill do agente principal cumpre a ordem pendente dela (lib/ordens.js).
        if (!e.agent_id) s.ordensPendentes = require('./lib/ordens.js').marcarCumprida(s, skill);
        return s;
      }

      // C9: quem procurou pode criar arquivo novo neste turno.
      if (busca.ehBusca(e.tool_name, e.tool_input)) s.buscouNesteTurno = true;

      // Grep, Glob e Read entraram no matcher POR CAUSA do C9, e sao somente-leitura:
      // nao podem ligar `trabalhoReal`, senao um turno que so procurou passaria a
      // dever a evidencia que o portao de fecho cobra. Bash segue contando como
      // antes, inclusive quando o comando e um grep - ele pode ter feito qualquer
      // outra coisa junto. O Read entrou depois (ronda 1 do Passo 8b): a busca ja o
      // contava, e sem ele no matcher quem leu o vizinho era negado ao criar.
      // A caixa do nome nao decide, como na busca: com `read`, a busca ligava e o
      // turno ainda virava trabalho a provar (ronda 2 do Passo 8b).
      const soLeitura = nome === 'grep' || nome === 'glob' || nome === 'read';
      if (!soLeitura) {
        if (!s.trabalhoReal) s.turnosComTrabalho = (s.turnosComTrabalho || 0) + 1;
        s.trabalhoReal = true;
        // T10-3 (D357): commit que PASSOU, pelo que o proprio Claude Code informa em
        // tool_response.gitOperation.commit.sha (medido na 2.1.258) - sem regex no comando, que
        // daria falso positivo com `echo "git commit"`. O commit que falha nem chega ao PostToolUse.
        // T11-7 (D365): sem o gitOperation, vale a linha `[branch sha]` do stdout. +1 por chamada,
        // nunca a soma das duas fontes.
        if (nome === 'bash' || nome === 'powershell') {
          const resp = e.tool_response;
          const op = resp && typeof resp === 'object' ? resp.gitOperation : null;
          if ((op && op.commit && op.commit.sha) || commitNaSaida(resp)) s.commitsFeitos = (s.commitsFeitos || 0) + 1;
        }
        const arquivo = (e.tool_input || {}).file_path;
        if (arquivo) {
          s.arquivosTocados = s.arquivosTocados || [];
          if (s.arquivosTocados.indexOf(arquivo) === -1) s.arquivosTocados.push(arquivo);
          // Plano 091 (#1): editado depois de aprovado volta para a lista do portao do commit (lib/commit.js).
          if (Array.isArray(s.revisadosAprovados)) s.revisadosAprovados = require('./lib/commit.js').semAprovado(s.revisadosAprovados, arquivo);
          // D412: marca do TURNO (arquivosTocados e da sessao): o fecho cobra o prompt no chat.
          // Hoje so Write e Edit chegam aqui com file_path: e o matcher do hooks.json que garante
          // (o Read saiu acima, como so leitura). Ferramenta nova no matcher com file_path tambem marca.
          if (saude.ehArquivoDeHandoff(arquivo)) s.gravouHandoff = true;
        }
      }
      return s;
    });
    // Item 13 (D674): o agente principal que le um handoff vira o dono dele (retomar.reclamar); se outra sessao o pegou
    // ha menos de 24 h, o aviso entra no contexto. Falha cala: a leitura ja aconteceu e o turno segue.
    let aviso = null;
    try {
      const lido = (e.tool_input || {}).file_path;
      if (String(e.tool_name || '').toLowerCase() === 'read' && !e.agent_id && saude.ehArquivoDeHandoff(lido)) {
        const raiz = require('./lib/config.js').raizDoProjeto(e.cwd || process.cwd());
        aviso = require('./lib/retomar.js').reclamar(raiz, require('node:path').resolve(raiz, lido), e.session_id, Date.now());
      }
    } catch (err) { aviso = null; }
    if (aviso) return io.permitir({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: aviso } });
    io.permitir();
  });
});
