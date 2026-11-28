#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const io = require('./lib/io.js');
const estado = require('./lib/estado.js');

// PreCompact (H6a2, D892, defeito 3): o handoff desta sessao foi escrito antes, as vezes horas antes da compactacao,
// e a releitura depois dela (abertura.js) mandava seguir um HEAD, um git status, um item do plano e pendencias que ja
// eram outros. Aqui, logo antes de compactar, o handoff-curto.js refaz so essas secoes (refazer); as de julgamento
// ficam. So o handoff que esta sessao marcou (marcar-trabalho.js), ou o da ordem de reler da compactacao anterior,
// na pasta de handoff da raiz deste projeto. Nunca bloqueia: qualquer falha deixa o arquivo como estava e a
// compactacao segue. So no Claude Code: os outros harnesses nao tem o evento (harness.js, DISPARA e EVENTOS).
io.blindar(function () {
  io.lerEntrada(function (e) {
    try { refazerOHandoff(e); } catch (erro) {
      // o handoff gravado fica como estava; a causa vai ao log de debug (stderr em exit 0), para a falha que se repete
      // nao se confundir com o "nada mudou"
      process.stderr.write('sworn: nao refiz o handoff antes de compactar, ele fica como estava: ' +
        String(erro && erro.message || erro).split('\n')[0] + '\n');
    }
    io.permitir();
  });
});

function refazerOHandoff(e) {
  // P6 item 2 (s378): o subagente que compacta dispara este gancho com o session_id da conversa; o handoff e dela
  if (typeof e.agent_id === 'string' && e.agent_id) return;
  const s = estado.ler(e.session_id);
  const marcado = require('./lib/reinjecao.js').handoffDaOrdem(s);
  if (!marcado) return;
  const hc = require('./lib/handoff-curto.js');
  const abs = path.resolve(marcado);
  // <raiz>/.sworn/handoff/<nome>.md: a raiz e a de onde o handoff-curto.js rodou, a mesma que ele escreveu na secao 2
  const raiz = path.resolve(abs, '..', '..', '..');
  const rel = path.relative(raiz, abs).replace(/\\/g, '/');
  if (path.posix.dirname(rel) !== hc.PASTA || /-retomar-/.test(rel) || !require('./lib/saude.js').ehArquivoDeHandoff(rel)) return;
  const doCwd = path.resolve(require('./lib/config.js').raizDoProjeto(typeof e.cwd === 'string' && e.cwd ? e.cwd : process.cwd()));
  if (process.platform === 'win32' ? doCwd.toLowerCase() !== raiz.toLowerCase() : doCwd !== raiz) return;
  const r = hc.refazer(raiz, fs.readFileSync(abs, 'utf8'), { frente: s.frente || null });
  if (!r.mudou) return;
  // grava ao lado e troca: um corte no meio nao deixa o handoff pela metade, e o temporario que falhou (na escrita ou
  // na troca) sai
  const temp = abs + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(temp, r.texto, 'utf8');
    fs.renameSync(temp, abs);
  } catch (erro) { try { fs.unlinkSync(temp); } catch (x) { /* fica o temporario */ } throw erro; }
}
