#!/usr/bin/env node
'use strict';
// D704 (pedido 14): os agentes em segundo plano desta sessao que ainda rodam, para o Passo 1 do /sworn:handoff (o
// handoff so sai com todos terminados). A transcricao vem do --transcricao <arquivo> ou da sessao do ambiente
// (CLAUDE_CODE_SESSION_ID, achada pelo injetado.localizar). Saida 0 sempre: quem espera e a skill.
const fs = require('node:fs');
const saude = require('./lib/saude.js');
const injetado = require('./lib/injetado.js');

const i = process.argv.indexOf('--transcricao');
const passado = i !== -1 ? process.argv[i + 1] : null;
// A5 (R1 :10, R2 :10): --transcricao sem valor (a ultima, vazia ou seguida de outra flag) caia calada na sessao do
// ambiente ou lia uma transcricao chamada "--outra".
if (i !== -1 && (!passado || passado.startsWith('--'))) {
  process.stdout.write('sworn: agentes em segundo plano nao medidos - --transcricao pede um valor ' +
    '(o caminho do .jsonl desta conversa); rode de novo com ele, ou sem a flag para ler a sessao do ambiente.\n');
  process.exit(0);
}
const alvo = injetado.localizar(passado, process.env);
// A5 (R2 :10): a transcricao que nao existe nao tem subagents/, e o agentesRodando dava [] = "pode seguir".
// A5-05 (D735): cada causa com o passo; a nao achada usa o motivo do localizar (a pasta e o passo, injetado.js:51).
const porque = !alvo.caminho
  ? (alvo.causa === 'sem-sessao' ? 'sem --transcricao e sem CLAUDE_CODE_SESSION_ID no ambiente (o Claude Code o poe ' +
      'no shell da sessao); rode de novo com --transcricao e o caminho do .jsonl desta conversa (em ~/.claude/projects)'
    : alvo.motivo.replace(/^nao medido: /, ''))
  : (fs.existsSync(alvo.caminho) ? null
    : 'a transcricao ' + alvo.caminho + ' nao existe; confira o caminho de --transcricao');
if (porque) {
  process.stdout.write('sworn: agentes em segundo plano nao medidos - ' + porque + '.\n' +
    'Sem a medida, confira pelos avisos de termino: agente disparado nesta sessao sem o aviso ainda roda.\n');
  process.exit(0);
}
const rodando = saude.agentesRodando(alvo.caminho, Date.now());
process.stdout.write(rodando.length === 0
  ? 'sworn: nenhum agente em segundo plano rodando nesta sessao; o handoff pode seguir.\n'
  : 'sworn: ' + saude.linhasDosAgentes(rodando).join('\n') + '\n' +
    'Espere todos terminarem e nao pare nenhum; o handoff sai depois do aviso de termino do ultimo.\n');
process.exit(0);
