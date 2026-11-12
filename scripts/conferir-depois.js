#!/usr/bin/env node
'use strict';
// A5e (D793, leva 15 do luna: barrado no apagar, ampliou o escopo e esvaziou o LICENCAS.txt por
// [System.IO.File]::WriteAllText no shell). Nenhum portao antes do comando ve o que ele faz por dentro, e a lista de
// formas nunca fecha (A5d). Aqui a conferencia e depois: o arquivo versionado que mudou ou sumiu, que estava limpo na
// abertura do turno e fica fora do escopo dela (ou e intocavel), volta pelo git, e o modelo e avisado. O escopo
// ampliado no turno nao vale (como no apagar, A5b): so a proxima mensagem do dono tira a foto nova (abrir-turno.js).
// Sem escopo declarado, sem a foto ou com `travas.destrutivo: false`, nada muda.
const io = require('./lib/io.js');
const estado = require('./lib/estado.js');
const config = require('./lib/config.js');
const projetoLib = require('./lib/projeto.js');
const git = require('./lib/git.js');
const escopoLib = require('./lib/escopo.js');
const glob = require('./lib/glob.js');
const fs = require('node:fs');
const path = require('node:path');

const PASTAS_DA_MAQUINA = /^(?:\.claude|\.sworn|\.git)(?:\/|$)/i;

// Restaura em lotes: milhares de caminhos num comando so estouram a linha de comando do Windows.
const LOTE = 100;

// A4 (s369): a copia de antes de restaurar tem teto, para nao encher o disco; o maior fica sem copia e no lugar.
const TETO_DA_COPIA = 50 * 1024 * 1024;

/** O aviso: os restaurados (e onde ficou a copia do que o comando deixou neles), os que ficaram sem copia (com a causa),
 *  os em conflito de merge, os que o git nao restaurou e os que nao deu para conferir - cada grupo com a sua causa,
 *  porque o que fazer com eles muda. */
function motivo(g) {
  const lista = function (l) { return l.map(function (c) { return '  - "' + escopoLib.ascii(c) + '"'; }); };
  const grupo = function (l, titulo) { return l.length ? [titulo].concat(lista(l)) : []; };
  return ['sworn - o comando mudou arquivo fora do escopo que valia no comeco do turno' +
    (g.restaurados.length ? '; o sworn o restaurou pelo git.' : '.'), '']
    .concat(grupo(g.restaurados, 'Restaurados:'),
      g.copia ? ['Antes de restaurar, o que o comando deixou nos restaurados ficou copiado em "' + escopoLib.ascii(g.copia) + '".'] : [],
      g.semCopia.length ? ['Sem copia, nao restaurados (o que o comando deixou neles segue no lugar; diga ao dono):']
        .concat(g.semCopia.map(function (s) { return '  - "' + escopoLib.ascii(s.caminho) + '" (' + escopoLib.ascii(s.causa) + ')'; }))
        : [],
      grupo(g.conflitos, 'Em conflito de merge, nao restaurados (restaurar resolveria o merge sem o dono; diga ao dono):'),
      grupo(g.recusados, 'O git nao restaurou (o arquivo segue como o comando deixou; diga ao dono):'),
      grupo(g.semConferir, 'O git foi mandado restaurar, mas o git status de depois falhou e nao deu para saber se ' +
        'restaurou (rode git status; o que seguir mudado, diga ao dono):'), [
        '',
        'O escopo ampliado neste turno so vale para o que o shell muda a partir da proxima mensagem do dono.',
        '',
        'Faca uma destas:',
        '  1. siga sem mexer nesses arquivos;',
        '  2. se eles precisam mudar, diga ao dono na resposta final o que ficou para ele liberar.',
        '',
        'So o dono desliga neste projeto: "travas": { "destrutivo": false } em .claude/sworn/projeto.json.'
      ]).join('\n');
}

/** Copia o que o comando deixou em cada arquivo (o que existe) para .sworn/restaurados/<carimbo>/, antes de restaurar:
 *  a mudanca pode ser do dono, editando a mao no meio do turno. Devolve a pasta (null sem nada copiado) e os que
 *  existem e nao se copiaram, com a causa: esses nao sao restaurados, para nao perder o que o comando deixou neles. */
function copiar(raiz, arquivos) {
  const pasta = path.join('.sworn', 'restaurados', new Date().toISOString().replace(/[:.]/g, '-'));
  let copiou = false;
  const semCopia = [];
  for (const c of arquivos) {
    const origem = path.join(raiz, c);
    if (!fs.existsSync(origem)) continue;
    try {
      const tamanho = fs.statSync(origem).size;
      if (tamanho > TETO_DA_COPIA) {
        semCopia.push({ caminho: c, causa: 'grande demais para copiar: ' + Math.round(tamanho / (1024 * 1024)) + ' MB' });
        continue;
      }
      const destino = path.join(raiz, pasta, c);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.copyFileSync(origem, destino);
      copiou = true;
    } catch (err) { semCopia.push({ caminho: c, causa: (err && err.code) || 'erro ao copiar' }); }
  }
  return { pasta: copiou ? pasta.replace(/\\/g, '/') : null, semCopia: semCopia };
}

/** A4 (s369): o resultado do checkout pela releitura. O que ainda aparece mudado, o git nao restaurou; sem a releitura
 *  (`ainda` null), nao da para saber, e dizer "recusou" seria falso. */
function separar(aRestaurar, ainda) {
  if (!Array.isArray(ainda)) return { restaurados: [], recusados: [], semConferir: aRestaurar.slice() };
  return {
    restaurados: aRestaurar.filter(function (c) { return ainda.indexOf(c) === -1; }),
    recusados: aRestaurar.filter(function (c) { return ainda.indexOf(c) !== -1; }),
    semConferir: []
  };
}

function conferir(e) {
  if (e.tool_name !== 'Bash' && e.tool_name !== 'PowerShell') return io.permitir();
  const raiz = config.raizDoProjeto(e.cwd || process.cwd());
  const projeto = config.carregarProjeto(raiz);
  if (!projeto || projetoLib.travasDe(projeto).destrutivo === false) return io.permitir();
  const ab = estado.ler(e.session_id).aberturaDoTurno;
  if (!ab || !Array.isArray(ab.dentro) || !Array.isArray(ab.sujos)) return io.permitir();
  const lidos = git.mudancasRastreadas(raiz);
  if (!lidos) return io.permitir();
  const esc = { dentro: ab.dentro, fora: Array.isArray(ab.fora) ? ab.fora : [] };
  const sujos = ab.sujos.map(function (p) { return String(p).toLowerCase(); });
  const foraDoEscopo = function (c) {
    if (PASTAS_DA_MAQUINA.test(c) || sujos.indexOf(c.toLowerCase()) !== -1) return false;
    return !escopoLib.dentro(c, esc) || !!escopoLib.declaradoFora(c, esc) || glob.casaAlgum(projeto.intocaveis, c);
  };
  const fora = lidos.mudados.filter(foraDoEscopo);
  const conflitos = lidos.conflitos.filter(foraDoEscopo);
  if (!fora.length && !conflitos.length) return io.permitir();
  const copia = copiar(raiz, fora);
  const semCopia = copia.semCopia.map(function (s) { return s.caminho; });
  const aRestaurar = fora.filter(function (c) { return semCopia.indexOf(c) === -1; });
  for (let i = 0; i < aRestaurar.length; i += LOTE) {
    git.correr(raiz, ['checkout', 'HEAD', '--'].concat(aRestaurar.slice(i, i + LOTE)));
  }
  const r = aRestaurar.length ? separar(aRestaurar, git.rastreadosMudados(raiz)) :
    { restaurados: [], recusados: [], semConferir: [] };
  // D420: o contador e acessorio, nunca impede o aviso (como no portao-destrutivo.js)
  try { estado.incrementar(e.session_id, 'restaurou_fora_do_escopo'); } catch (err) { /* o balde vale menos */ }
  const m = motivo({ restaurados: r.restaurados, copia: copia.pasta, semCopia: copia.semCopia, conflitos: conflitos,
    recusados: r.recusados, semConferir: r.semConferir });
  // PostToolUse: a ferramenta ja rodou; o `block` so leva o aviso ao modelo (nao desfaz nem impede nada)
  return io.permitir({ decision: 'block', reason: m,
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: m } });
}

if (require.main === module) {
  io.blindar(function () { io.lerEntrada(conferir); });
}

module.exports = { separar };
