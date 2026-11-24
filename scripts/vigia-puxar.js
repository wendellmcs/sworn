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
 *                          [--arquivo vigia/novidades.md] [--destino <pasta>] [--espera 30]
 * Destino padrao: a pasta do vigia (SWORN_VIGIA ou ~/.claude/sworn/vigia).
 *
 * Passos: `git fetch` do ramo (sem prompt de credencial, 60 s de limite) e `git show FETCH_HEAD:<arquivo>`. O fetch que
 * falha tenta de novo, 3 tentativas com `--espera` segundos entre elas (padrao 30, de 0 a 600; H11a, D909: o de
 * 2026-11-23 bateu os 60 s uma vez e a semana ficou sem ficha).
 * So grava se o conteudo tiver a linha `semana: AAAA-MM-DD` valida (mesmo parser da abertura): arquivo
 * quebrado nunca sobrescreve a ultima novidade boa. A gravacao e atomica (temporario + rename). Toda
 * tentativa, boa ou ruim, deixa `ultima-busca.json` = { quando, ok, motivo, semana } para a abertura poder
 * dizer por que nada chegou. Exit 0 = gravou; 1 = falhou; 2 = faltou --repo, uma flag veio sem valor ou o --remote
 * ou o --ramo comeca com "-", ou o --espera nao e inteiro de 0 a 600 (nada e gravado).
 */
const fs = require('node:fs');
const path = require('node:path');
const gitLib = require('./lib/git.js');
const vigia = require('./lib/vigia-local.js');
const escopoLib = require('./lib/escopo.js');
const textoLib = require('./lib/texto.js');

const USO = 'uso: node vigia-puxar.js --repo <pasta do clone> [--remote backup] [--ramo claude/vigia] ' +
  '[--arquivo vigia/novidades.md] [--destino <pasta>] [--espera 30]';

function erroDeUso(texto) {
  process.stderr.write('vigia: ' + texto + '\n' + USO + '\n');
  process.exit(2);
}

// A7 (pedido 12, R1 :34): flag presente vazia, no fim da linha ou seguida de outra flag virava o padrao sem aviso
// (`--destino ''` gravava na pasta do vigia). Agora e erro de uso que diz qual, antes de tocar no disco.
// A7-06: o --remote e o --ramo vao como argumento solto ao `git fetch`; com `-` na frente (`-u...`) o git o leria como
// opcao, entao `paraGit` recusa qualquer `-` inicial, nao so o `--`.
function valor(nome, paraGit) {
  const i = process.argv.indexOf(nome);
  if (i === -1) return null;
  const v = process.argv[i + 1];
  if (v === undefined || v === '' || v.startsWith('--')) erroDeUso(nome + ' pede um valor.');
  if (paraGit && v.startsWith('-')) erroDeUso(nome + ' nao pode comecar com "-": o git o leria como opcao.');
  return v;
}

// ASCII em uma linha (R5): o texto de erro do git pode trazer acento, caminho do usuario, quebra de linha (F5a: a
// do escopo.js, a mesma do vigia-local).
const umaLinha = escopoLib.asciiEmUmaLinha;

/** git com shell:false, sem prompt de credencial; { ok, saida, motivo }. */
function git(repo, args, timeout) {
  // o rodar nunca lanca: o spawn que lancaria volta em r.error, com a mesma frase
  const r = gitLib.rodar(null, ['-C', repo].concat(args),
    { timeout: timeout, maxBuffer: 5 * 1024 * 1024, env: { GIT_TERMINAL_PROMPT: '0' } });
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
  // A7 (R1 :78): falhar roda antes do rename ou depois de apagar o .tmp, entao a novidade do disco nao mudou
  process.stderr.write('vigia: busca falhou (' + m + '). A novidade que ja estava no disco nao mudou; ' +
    'corrija a causa e rode de novo.\n');
  process.exit(1);
}

const repo = valor('--repo');
if (!repo) erroDeUso('falta --repo (a pasta do clone).');
const remote = valor('--remote', true) || 'backup';
const ramo = valor('--ramo', true) || 'claude/vigia';
const arquivo = valor('--arquivo') || 'vigia/novidades.md';
const destino = valor('--destino') ? path.resolve(valor('--destino')) : vigia.pasta(process.env);
const esperaTexto = valor('--espera');
if (esperaTexto !== null && !/^[0-9]{1,3}$/.test(esperaTexto)) erroDeUso('--espera pede um inteiro de 0 a 600 (segundos).');
const espera = esperaTexto === null ? 30 : Number(esperaTexto);
if (espera > 600) erroDeUso('--espera pede um inteiro de 0 a 600 (segundos).');

const busca = vigia.tentar(3, espera * 1000, function () { return git(repo, ['fetch', '--quiet', remote, ramo], 60000); });
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
