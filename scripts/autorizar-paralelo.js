#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * D451: a autorizacao do /sworn:parallel, dada UMA vez no /sworn:init. Grava a regra de permissao
 * `Workflow(sworn:parallel)` em `permissions.allow` do `.claude/settings.local.json` da pasta atual (o
 * arquivo pessoal do projeto, fora do git por padrao do Claude Code). Com `--conferir`, so le.
 *
 * Por script e nao por Write: o arquivo pode ter outras permissoes do dono, e mexer em JSON por texto e o
 * jeito fragil. Arquivo ilegivel ou com forma inesperada NAO e sobrescrito: sai 1 e diz por que.
 * Medido no `claude -p` (2.1.296): com a regra o workflow roda; sem ela, a ferramenta recusa. Na sessao
 * interativa a documentacao so garante o "Yes, and don't ask again" da primeira execucao.
 *
 * Saida: JSON { autorizado, gravou, arquivo } e, na falha, `erro`. Le e grava na raiz do repositorio git que
 * contem a pasta atual (de uma subpasta, nao cria um .claude ali); fora de repositorio, na pasta atual.
 * Regra igual (ou `Workflow` inteiro) em `permissions.deny` vence a allow: sai 1, nunca "autorizado".
 */
const REGRA = 'Workflow(sworn:parallel)';
const RELATIVO = '.claude/settings.local.json';

// A pasta pessoal nao e projeto: um .git nela (dotfiles) faria gravar em ~/.claude, que vale para todo projeto.
const mesma = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
  : path.resolve(a) === path.resolve(b);
function raizDoProjeto(inicio) {
  for (let d = inicio; ; d = path.dirname(d)) {
    if (mesma(d, os.homedir())) return inicio;
    if (fs.existsSync(path.join(d, '.git'))) return d;
    if (path.dirname(d) === d) return inicio;
  }
}
const arquivo = path.join(raizDoProjeto(process.cwd()), '.claude', 'settings.local.json');
const conferir = process.argv.indexOf('--conferir') !== -1;

function sair(codigo, dados) {
  process.stdout.write(JSON.stringify(Object.assign(dados, { arquivo: RELATIVO })) + '\n');
  process.exit(codigo);
}

let obj = {};
if (fs.existsSync(arquivo)) {
  // D460: o Set-Content/Out-File do PowerShell 5.1 grava BOM; arquivo vazio vale como {}
  try { const bruto = fs.readFileSync(arquivo, 'utf8').replace(/^\uFEFF/, ''); obj = bruto.trim() ? JSON.parse(bruto) : {}; } catch (e) {
    sair(1, { autorizado: false, gravou: false, erro: RELATIVO + ' nao e JSON valido (' + e.message + '); corrija e rode de novo' });
  }
}
const objeto = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
if (!objeto(obj)) {
  sair(1, { autorizado: false, gravou: false, erro: RELATIVO + ' nao e um objeto JSON; o esperado e { ... }, com as chaves dentro; corrija e rode de novo' });
}
if (obj.permissions !== undefined && !objeto(obj.permissions)) {
  sair(1, { autorizado: false, gravou: false, erro: 'permissions em ' + RELATIVO + ' nao e objeto; o esperado e "permissions": { "allow": [ ... ] }; corrija e rode de novo' });
}
const allow = obj.permissions && obj.permissions.allow;
if (allow !== undefined && !Array.isArray(allow)) {
  sair(1, { autorizado: false, gravou: false, erro: 'permissions.allow em ' + RELATIVO + ' nao e lista; o esperado e "allow": [ "regra 1", "regra 2" ]; corrija e rode de novo' });
}
const deny = obj.permissions && obj.permissions.deny;
// `Workflow` inteiro, ou `Workflow(<padrao>)` cujo padrao (com * de curinga) casa com sworn:parallel
function negaEste(r) {
  if (r === 'Workflow') return true;
  const m = typeof r === 'string' && r.match(/^Workflow\((.*)\)$/);
  if (!m) return false;
  const re = new RegExp('^' + m[1].split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test('sworn:parallel');
}
const negada = Array.isArray(deny) ? deny.filter(negaEste)[0] : undefined;
if (negada) {
  sair(1, { autorizado: false, gravou: false, erro: '"' + negada + '" esta em permissions.deny de ' + RELATIVO + ', e o deny vence o allow; tire de la e rode de novo' });
}
const ja = Array.isArray(allow) && allow.indexOf(REGRA) !== -1;
if (conferir || ja) sair(0, { autorizado: ja, gravou: false });

obj.permissions = obj.permissions || {};
obj.permissions.allow = (obj.permissions.allow || []).concat([REGRA]);
try {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, JSON.stringify(obj, null, 2) + '\n');
} catch (e) {
  sair(1, { autorizado: false, gravou: false, erro: 'nao consegui gravar ' + RELATIVO + ' (' + e.message + '); confira se a pasta .claude aceita gravacao e rode de novo' });
}
sair(0, { autorizado: true, gravou: true });
