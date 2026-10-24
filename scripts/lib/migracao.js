'use strict';

/**
 * T2 do plano nome+pagina (D623): o plugin se chamava esquadro ate a 0.13.0 e a pasta dele era .claude/esquadro/.
 * A abertura chama isto e leva a pasta antiga para .claude/sworn/ uma vez so:
 * - a do projeto: achada subindo pastas como o config.raizDoProjeto (sessao aberta em subpasta), pela 1a pasta com
 *   projeto.json na antiga ou na nova; sem projeto em lugar nenhum acima, a da propria pasta da sessao;
 * - a da home (~/.claude/esquadro/, que so guarda a pasta do vigia): so com o vigia ligado e sem SWORN_VIGIA, como o
 *   vigia-local.js. Desligado nao olha: os testes que rodam a abertura sem isolar a home nao a movem.
 * Destino ja existente: nao mexe em nenhuma e avisa uma vez (marca na pasta nova). Os caminhos de `referencias` do
 * projeto.json que passavam pela pasta antiga passam pela nova; o resto do arquivo nao muda.
 * Este arquivo cita o nome antigo de proposito. Devolve a linha a mostrar ou null. R5: ASCII.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const textoLib = require('./texto.js');
const escopoLib = require('./escopo.js');
const vigia = require('./vigia-local.js');

const VELHA = 'esquadro';
const NOVA = 'sworn';
const MARCA = 'migracao-avisada.json';
const RE_SEGMENTO = /(\.claude[\\/])esquadro(?=[\\/])/g;

function ehPasta(p) {
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

/** A pasta do projeto pela regra do raizDoProjeto, olhando a pasta antiga e a nova. */
function baseDoProjeto(cwd) {
  let atual = path.resolve(cwd);
  for (;;) {
    for (const nome of [NOVA, VELHA]) {
      if (fs.existsSync(path.join(atual, '.claude', nome, 'projeto.json'))) return atual;
    }
    const pai = path.dirname(atual);
    if (pai === atual) return path.resolve(cwd);
    atual = pai;
  }
}

/**
 * Troca .claude/esquadro/ por .claude/sworn/ nos caminhos de `referencias`. Devolve quantos trocou (0 sem
 * projeto.json ou sem o que trocar) ou null (existe e nao se le, nao e JSON, ou a troca mexeria em outra coisa). A
 * troca e no texto, para nao reformatar o arquivo do dono; o parser confere que o resultado e so o esperado antes de
 * gravar.
 */
function trocarReferencias(arquivo) {
  let bruto;
  try { bruto = fs.readFileSync(arquivo, 'utf8'); } catch (e) { return e && e.code === 'ENOENT' ? 0 : null; }
  let obj;
  try { obj = JSON.parse(textoLib.semBom(bruto)); } catch (e) { return null; }
  const refs = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj.referencias : null;
  if (!refs || typeof refs !== 'object' || Array.isArray(refs)) return 0;
  let novo = bruto;
  let n = 0;
  for (const tipo of Object.keys(refs)) {
    if (!Array.isArray(refs[tipo])) continue;
    refs[tipo] = refs[tipo].map(function (p) {
      if (typeof p !== 'string') return p;
      const q = p.replace(RE_SEGMENTO, '$1' + NOVA);
      if (q !== p) { n++; novo = novo.split(JSON.stringify(p)).join(JSON.stringify(q)); }
      return q;
    });
  }
  if (!n) return 0;
  try {
    if (JSON.stringify(JSON.parse(textoLib.semBom(novo))) !== JSON.stringify(obj)) return null;
    fs.writeFileSync(arquivo, novo, 'utf8');
  } catch (e) { return null; }
  return n;
}

/**
 * Leva <base>/.claude/esquadro/ para <base>/.claude/sworn/. `rotulo` e como a pasta aparece na mensagem ('.claude/'
 * ou '~/.claude/'), `onde` completa a frase. `depois(nova)` roda so se moveu e devolve o complemento da mensagem.
 */
function mover(base, rotulo, onde, depois) {
  const velha = path.join(base, '.claude', VELHA);
  const nova = path.join(base, '.claude', NOVA);
  if (!ehPasta(velha)) return null;
  const de = rotulo + VELHA + '/';
  const para = rotulo + NOVA + '/';
  if (fs.existsSync(nova)) {
    const marca = path.join(nova, MARCA);
    if (fs.existsSync(marca)) return null;
    try { fs.writeFileSync(marca, JSON.stringify({ avisadoEm: new Date().toISOString() }) + '\n', 'utf8'); } catch (e) { /* avisa de novo */ }
    return 'sworn: achei a pasta antiga ' + de + ' e a nova ' + para + ' juntas' + onde + ': nao mexi em nenhuma. ' +
      'O sworn le so a nova; leve a mao o que ainda servir da antiga. Este aviso sai uma vez so.';
  }
  try {
    fs.renameSync(velha, nova);
  } catch (e) {
    return 'sworn: nao consegui levar ' + de + ' para ' + para + onde + ' (' +
      escopoLib.ascii(textoLib.causaDoErro(e)).slice(0, 120) + '): nesta sessao o sworn segue sem a configuracao ' +
      'antiga. Feche as outras sessoes do Claude Code que usam esta pasta e abra uma nova.';
  }
  return 'sworn: o plugin se chamava esquadro; a pasta ' + de + onde + ' passou a ' + para +
    ' (uma vez so, nada apagado).' + (depois ? depois(nova) : '');
}

/** A pasta antiga do projeto da sessao aberta em `cwd`. */
function migrarProjeto(cwd) {
  if (!cwd || typeof cwd !== 'string') return null;
  const base = baseDoProjeto(cwd);
  return mover(base, '.claude/', ' em "' + escopoLib.ascii(base) + '"', function (nova) {
    const n = trocarReferencias(path.join(nova, 'projeto.json'));
    if (n === null) {
      return ' Os caminhos de "referencias" ficaram como estavam: nao consegui ler nem atualizar o projeto.json; ' +
        'confira-os a mao.';
    }
    return n ? ' Atualizei ' + n + (n === 1 ? ' caminho' : ' caminhos') + ' de "referencias" do projeto.json.' : '';
  });
}

/** A pasta antiga da home (`casa`; null = a do usuario), so com o vigia ligado em `cwd` e sem SWORN_VIGIA. */
function migrarCasa(casa, env, projeto, cwd) {
  const e = env && typeof env === 'object' ? env : process.env;
  if (typeof e.SWORN_VIGIA === 'string' && e.SWORN_VIGIA !== '') return null;
  if (!vigia.ligado(projeto, cwd)) return null;
  return mover(casa || os.homedir(), '~/.claude/', ' (a do vigia)', null);
}

module.exports = { VELHA, NOVA, MARCA, baseDoProjeto, trocarReferencias, migrarProjeto, migrarCasa };
