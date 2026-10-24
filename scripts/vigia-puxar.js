#!/usr/bin/env node
'use strict';

/**
 * Bloco V (D426/D437): traz `vigia/novidades.md` do ramo `claude/vigia` do repo privado para o disco local.
 *
 * Esta e a UNICA peca do vigia que usa rede (via git), e roda pela tarefa agendada do Windows (segunda
 * 10:30), NUNCA por gancho: D148, gancho nenhum abre rede. A abertura da sessao (lib/vigia-local.js) so
 * le o que este script deixou na pasta.
 *
 * Uso: node vigia-puxar.js --repo <pasta do clone> [--remote backup] [--ramo claude/vigia]
 *                          [--arquivo vigia/novidades.md] [--destino <pasta>]
 * Destino padrao: a pasta do vigia (SWORN_VIGIA ou ~/.claude/sworn/vigia).
 *
 * Passos: `git fetch` do ramo (sem prompt de credencial, 60 s de limite) e `git show FETCH_HEAD:<arquivo>`.
 * So grava se o conteudo tiver a linha `semana: AAAA-MM-DD` valida (mesmo parser da abertura): arquivo
 * quebrado nunca sobrescreve a ultima novidade boa. A gravacao e atomica (temporario + rename). Toda
 * tentativa, boa ou ruim, deixa `ultima-busca.json` = { quando, ok, motivo, semana } para a abertura poder
 * dizer por que nada chegou. Exit 0 = gravou; 1 = falhou; 2 = faltou --repo (nada e gravado).
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vigia = require('./lib/vigia-local.js');
const escopoLib = require('./lib/escopo.js');
const textoLib = require('./lib/texto.js');

const USO = 'uso: node vigia-puxar.js --repo <pasta do clone> [--remote backup] [--ramo claude/vigia] ' +
  '[--arquivo vigia/novidades.md] [--destino <pasta>]';

function valor(nome) {
  const i = process.argv.indexOf(nome);
  const v = i !== -1 ? process.argv[i + 1] : null;
  return v && !v.startsWith('--') ? v : null;
}

/** ASCII em uma linha (R5): o texto de erro do git pode trazer acento, caminho do usuario, quebra de linha. */
function umaLinha(texto) {
  return escopoLib.ascii(String(texto == null ? '' : texto).replace(/\s+/g, ' ')).trim();
}

/** git com shell:false, sem prompt de credencial; { ok, saida, motivo }. */
function git(repo, args, timeout) {
  let r;
  try {
    r = spawnSync('git', ['-C', repo].concat(args), {
      encoding: 'utf8', shell: false, windowsHide: true, timeout: timeout,
      maxBuffer: 5 * 1024 * 1024,
      env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' })
    });
  } catch (e) {
    return { ok: false, motivo: 'git nao rodou: ' + umaLinha(textoLib.causaDoErro(e)) };
  }
  if (r.error) {
    const causa = r.error.code === 'ETIMEDOUT' ? 'git demorou mais de ' + Math.round(timeout / 1000) + 's' : textoLib.causaDoErro(r.error);
    return { ok: false, motivo: 'git nao rodou: ' + umaLinha(causa) };
  }
  if (r.status !== 0 || typeof r.stdout !== 'string') {
    const primeira = String(r.stderr || '').split(/\r?\n/).filter(function (l) { return l.trim() !== ''; })[0] || '';
    return { ok: false, motivo: 'git ' + args[0] + ' saiu com ' + r.status + (primeira ? ': ' + umaLinha(primeira) : '') };
  }
  return { ok: true, saida: r.stdout };
}

/** Grava ultima-busca.json; falhar aqui nao muda o resultado da busca. */
function registrar(destino, ok, motivo, semana) {
  try {
    fs.mkdirSync(destino, { recursive: true });
    fs.writeFileSync(path.join(destino, vigia.BUSCA), JSON.stringify({
      quando: new Date().toISOString(), ok: ok, motivo: motivo, semana: semana
    }, null, 2) + '\n', 'utf8');
  } catch (e) { /* sem registro: a abertura so nao saberia explicar a falha */ }
}

function falhar(destino, motivo) {
  const m = umaLinha(motivo).slice(0, 300);
  registrar(destino, false, m, null);
  process.stderr.write('vigia: busca falhou (' + m + ')\n');
  process.exit(1);
}

const repo = valor('--repo');
if (!repo) {
  process.stderr.write(USO + '\n');
  process.exit(2);
}
const remote = valor('--remote') || 'backup';
const ramo = valor('--ramo') || 'claude/vigia';
const arquivo = valor('--arquivo') || 'vigia/novidades.md';
const destino = valor('--destino') ? path.resolve(valor('--destino')) : vigia.pasta(process.env);

const busca = git(repo, ['fetch', '--quiet', remote, ramo], 60000);
if (!busca.ok) falhar(destino, busca.motivo);
const lido = git(repo, ['show', 'FETCH_HEAD:' + arquivo], 60000);
if (!lido.ok) falhar(destino, lido.motivo);
const semana = vigia.semanaDoTexto(lido.saida);
if (!semana) falhar(destino, 'o arquivo ' + arquivo + ' do ramo ' + ramo + ' nao tem a linha "semana: AAAA-MM-DD" valida');

const alvo = path.join(destino, vigia.ARQUIVO);
try {
  fs.mkdirSync(destino, { recursive: true });
  fs.writeFileSync(alvo + '.tmp', lido.saida, 'utf8');
  fs.renameSync(alvo + '.tmp', alvo);
} catch (e) {
  try { fs.rmSync(alvo + '.tmp', { force: true }); } catch (e2) { /* nada a limpar */ }
  falhar(destino, 'nao consegui gravar ' + alvo + ': ' + textoLib.causaDoErro(e));
}
registrar(destino, true, null, semana);
process.stdout.write('vigia: novidade de ' + semana + ' gravada em ' + umaLinha(alvo) + '\n');
process.exit(0);
