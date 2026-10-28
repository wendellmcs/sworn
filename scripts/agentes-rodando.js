#!/usr/bin/env node
'use strict';
// D704 (pedido 14): os agentes em segundo plano desta sessao que ainda rodam, para o Passo 1 do /sworn:handoff (o
// handoff so sai com todos terminados). A transcricao vem do --transcricao <arquivo> ou da sessao do ambiente
// (CLAUDE_CODE_SESSION_ID, achada pelo injetado.localizar). Saida 0 sempre: quem espera e a skill.
const saude = require('./lib/saude.js');
const injetado = require('./lib/injetado.js');

const i = process.argv.indexOf('--transcricao');
const alvo = injetado.localizar(i !== -1 ? process.argv[i + 1] : null, process.env);
if (!alvo.caminho) {
  const porque = alvo.causa === 'sem-sessao' ? 'sem --transcricao e sem CLAUDE_CODE_SESSION_ID no ambiente'
    : 'a transcricao da sessao do CLAUDE_CODE_SESSION_ID nao esta na pasta projects';
  process.stdout.write('sworn: agentes em segundo plano nao medido - ' + porque + '.\n' +
    'Sem a medida, confira pelos avisos de termino: agente disparado nesta sessao sem o aviso ainda roda.\n');
  process.exit(0);
}
const rodando = saude.agentesRodando(alvo.caminho, Date.now());
process.stdout.write(rodando.length === 0
  ? 'sworn: nenhum agente em segundo plano rodando nesta sessao; o handoff pode seguir.\n'
  : 'sworn: ' + saude.linhasDosAgentes(rodando).join('\n') + '\n' +
    'Espere todos terminarem e nao pare nenhum; o handoff sai depois do aviso de termino do ultimo.\n');
process.exit(0);
