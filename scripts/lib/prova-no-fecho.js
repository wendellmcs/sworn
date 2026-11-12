'use strict';
// D794 (C1 do plano unico): a prova de pronto rodada pelo proprio gancho do fecho, so no projeto que o dono ligou na
// maquina dele. A chave fica fora do repositorio (<pasta do Claude>/sworn/prova-no-fecho.json, a lista das raizes
// ligadas, cada uma com o comando que o dono ligou): um repositorio clonado nunca roda nada sozinho, e um commit que
// troque a provaDePronto nao troca o que o gancho roda. Sem a chave, segue o laco de hoje (o modelo roda a prova).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ascii } = require('./escopo.js');
const { textoMostraFalha } = require('./evidencia.js');

// O teto da prova cabe no teto do gancho do fecho (hooks/hooks.json, Stop); estourou, volta o laco de hoje.
const TETO_MS = 60000;
const CAUDA_LINHAS = 40;
const LINHA_MAX = 200;

function arquivo(env) {
  const e = env || process.env;
  // D799: a bateria aponta a chave para um arquivo da leva e liga so as pastas das rodadas, sem tocar a do dono (quem
  // lanca o Claude ja controla o ambiente dele: a variavel nao abre nada que ele nao tivesse)
  const daLeva = e.SWORN_PROVA_NO_FECHO_CHAVE;
  if (typeof daLeva === 'string' && daLeva.trim()) return path.resolve(daLeva);
  return path.join(e.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'sworn', 'prova-no-fecho.json');
}

// O mesmo projeto escrito de outro jeito (barra final, ".", nome curto do Windows, maiusculas no Windows) e o mesmo.
function normal(raiz) {
  let r = path.resolve(String(raiz));
  try { r = fs.realpathSync.native(r); } catch (e) { /* pasta que ja nao existe: vale o caminho como veio */ }
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

/** A chave lida: { projetos: [{ raiz, prova }], ilegivel }. Sem a chave, lista vazia; ilegivel (JSON quebrado, tipo
 *  errado), tambem vazia, com a marca: quem le desliga, quem grava recusa (sobrescrever apagaria os outros projetos). */
function lerChave(env) {
  let bruto;
  // so a chave que nao existe e lista vazia; a que existe e nao abre (permissao, trava, pasta) e ilegivel
  try {
    bruto = fs.readFileSync(arquivo(env), 'utf8');
  } catch (e) {
    return { projetos: [], ilegivel: e.code !== 'ENOENT' };
  }
  try {
    // o BOM que editor e PowerShell gravam no Windows nao torna a chave ilegivel; a chave vazia e lista vazia
    const limpo = bruto.replace(/^\uFEFF/, '');
    if (!limpo.trim()) return { projetos: [], ilegivel: false };
    const j = JSON.parse(limpo);
    if (!j || !Array.isArray(j.projetos)) return { projetos: [], ilegivel: true };
    return { projetos: j.projetos.filter(function (p) {
      return p && typeof p.raiz === 'string' && p.raiz && typeof p.prova === 'string' && p.prova.trim();
    }), ilegivel: false };
  } catch (e) {
    return { projetos: [], ilegivel: true };
  }
}

function daRaiz(projetos, raiz) {
  const r = normal(raiz);
  return projetos.filter(function (p) { return normal(p.raiz) === r; })[0] || null;
}

/** O comando que o dono ligou para a raiz, ou null (desligada, caminho vazio, chave ilegivel). */
function provaLigada(raiz, env) {
  if (typeof raiz !== 'string' || !raiz) return null;
  const p = daRaiz(lerChave(env).projetos, raiz);
  return p ? p.prova.trim() : null;
}

/** Ligada para ESTA prova: a que o projeto declara agora tem de ser a que o dono ligou. */
function ligado(raiz, prova, env) {
  return typeof prova === 'string' && Boolean(prova.trim()) && provaLigada(raiz, env) === prova.trim();
}

/** A lista que se vai regravar; recusa caminho vazio e chave ilegivel, com o que fazer. */
function listaParaGravar(raiz, env) {
  if (typeof raiz !== 'string' || !raiz.trim()) throw new Error('falta o caminho do projeto');
  const c = lerChave(env);
  if (c.ilegivel) {
    throw new Error('a chave ' + arquivo(env) + ' esta ilegivel; corrija ou apague o arquivo e rode o comando de novo');
  }
  return c.projetos;
}

// Grava inteira ou nao grava: escreve ao lado e renomeia, para uma queda no meio nao deixar a chave pela metade.
function gravarLista(projetos, env) {
  const f = arquivo(env);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ projetos: projetos }, null, 2) + '\n', 'utf8');
  try {
    fs.renameSync(tmp, f);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (x) { /* ja nao existe */ }
    throw e;
  }
}

/** Liga o projeto para a prova (ou troca a prova ligada); false quando ja estava ligado para ela. Lanca com caminho ou
 *  prova vazios, ou com a chave ilegivel. */
function ligar(raiz, prova, env) {
  if (typeof prova !== 'string' || !prova.trim()) throw new Error('falta o comando da prova');
  const projetos = listaParaGravar(raiz, env);
  const atual = daRaiz(projetos, raiz);
  if (atual && atual.prova.trim() === prova.trim()) return false;
  // todas as entradas da raiz saem (a chave editada a mao pode repetir a raiz, e a de baixo voltaria a valer)
  const r = normal(raiz);
  gravarLista(projetos.filter(function (p) { return normal(p.raiz) !== r; })
    .concat([{ raiz: path.resolve(raiz), prova: prova.trim() }]), env);
  return true;
}

/** Desliga o projeto; false quando nao estava ligado. Lanca com caminho vazio ou chave ilegivel. */
function desligar(raiz, env) {
  const antes = listaParaGravar(raiz, env);
  const r = normal(raiz);
  const depois = antes.filter(function (p) { return normal(p.raiz) !== r; });
  if (depois.length === antes.length) return false;
  gravarLista(depois, env);
  return true;
}

// O embrulho roda a prova no shell e, no teto, mata a arvore inteira: o timeout do spawnSync so mata o shell, e no
// Windows o filho (o node da suite) ficaria orfao, rodando e segurando a pasta. Sai com ESTOUROU no teto.
const ESTOUROU = 124;
const EMBRULHO = [
  'const cp = require("node:child_process");',
  'const win = process.platform === "win32";',
  'const c = cp.spawn(process.argv[1], { shell: true, stdio: "inherit", detached: !win, windowsHide: true });',
  'const t = setTimeout(function () {',
  '  try { if (win) cp.spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { windowsHide: true, timeout: 10000 });',
  '    else process.kill(-c.pid, "SIGKILL"); } catch (e) {}',
  '  process.exit(' + ESTOUROU + ');',
  '}, Number(process.argv[2]));',
  'c.on("exit", function (codigo) { clearTimeout(t); process.exit(codigo === null ? 1 : codigo); });',
  'c.on("error", function (e) { clearTimeout(t); process.stderr.write("sworn: a prova nao rodou: " + e.message + "\\n");',
  '  process.exit(1); });'
].join('\n');

/**
 * Roda a prova na raiz do projeto, com teto. { ok, codigo, estourou, cauda }: passa so com saida 0 e sem falha na
 * saida; a cauda sao as ultimas linhas da saida, em ASCII (vai ao modelo no motivo do fecho).
 */
function rodar(prova, raiz, tetoMs) {
  if (typeof prova !== 'string' || !prova.trim()) {
    return { ok: false, codigo: null, estourou: false, cauda: 'sworn: a prova nao rodou: sem comando' };
  }
  // acima de 2^31-1 ms o setTimeout dispara na hora: o teto fica no padrao
  const teto = Number.isInteger(tetoMs) && tetoMs > 0 && tetoMs <= 2147483647 ? tetoMs : TETO_MS;
  // a folga de fora so pega o embrulho que travou; quem respeita o teto e o embrulho
  // o "--" impede que uma prova comecando com "-" vire opcao do node
  const r = spawnSync(process.execPath, ['-e', EMBRULHO, '--', prova, String(teto)], { cwd: raiz, encoding: 'utf8',
    timeout: teto + 10000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  const estourou = r.status === ESTOUROU || Boolean(r.error && r.error.code === 'ETIMEDOUT');
  // a prova que nao chegou ao fim por outro motivo (pasta que nao existe, saida acima do maxBuffer) diz a causa
  const causa = r.error && !estourou ? '\nsworn: a prova nao rodou ate o fim: ' + (r.error.code || r.error.message) : '';
  const saida = String(r.stdout || '') + String(r.stderr || '') + causa;
  // linha a linha: o ascii() junta as quebras de linha
  const cauda = saida.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n').slice(-CAUDA_LINHAS)
    .map(function (l) { return ascii(l).slice(0, LINHA_MAX); }).join('\n');
  return { ok: !estourou && r.status === 0 && !textoMostraFalha(saida), codigo: r.status, estourou: estourou,
    cauda: cauda };
}

module.exports = { TETO_MS, CAUDA_LINHAS, arquivo, ligado, provaLigada, ligar, desligar, rodar };
