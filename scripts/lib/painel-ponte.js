'use strict';
// Painel de sessoes, fase 3: a ponte entre o painel ao vivo e o gancho das sessoes. O painel grava, ao subir, a porta,
// o token e o pid dele em <pasta de config do Claude Code>/sworn/painel/ponte.json, e apaga ao sair; o gancho so le.
// Sem o arquivo, com ele fora da forma ou com o pid morto, o painel esta desligado e o gancho sai na hora.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A mesma pasta de config que o Claude Code usa: CLAUDE_CONFIG_DIR, ou .claude na pasta pessoal.
function pasta(env) {
  const e = env || process.env;
  const config = typeof e.CLAUDE_CONFIG_DIR === 'string' && e.CLAUDE_CONFIG_DIR.trim() !== ''
    ? e.CLAUDE_CONFIG_DIR
    : path.join(os.homedir(), '.claude');
  return path.join(config, 'sworn', 'painel');
}

function caminho(env) { return path.join(pasta(env), 'ponte.json'); }

function novoToken() { return crypto.randomBytes(32).toString('hex'); }

// O sinal 0 so pergunta se o processo existe. EPERM: existe, mas e de outro usuario.
function pidVivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function valida(d) {
  return d !== null && typeof d === 'object' &&
    Number.isInteger(d.porta) && d.porta >= 1 && d.porta <= 65535 &&
    typeof d.token === 'string' && /^[0-9a-f]{64}$/.test(d.token) &&
    Number.isInteger(d.pid) && d.pid > 0;
}

// Grava por um arquivo temporario e troca de nome: o gancho nunca le a ponte pela metade. O temporario tem nome
// aleatorio e nasce novo (`wx`: nao segue um link nem reusa o arquivo que ja esta la), com 0600; no Windows o modo nao
// vale, e o arquivo herda a permissao da pasta de config. A gravacao que falha tira o temporario e repassa o erro.
function gravar(dados, env) {
  if (!valida(dados)) throw new Error('ponte do painel fora da forma');
  const arq = caminho(env);
  fs.mkdirSync(path.dirname(arq), { recursive: true, mode: 0o700 });
  const tmp = arq + '.' + process.pid + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify({ porta: dados.porta, token: dados.token, pid: dados.pid }),
      { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, arq);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (x) { /* o temporario nem chegou a existir */ }
    throw e;
  }
  return arq;
}

// A ponte do painel que esta de pe, ou null. `vivo` troca a pergunta do pid, para o teste.
function ler(env, vivo) {
  let d;
  try {
    d = JSON.parse(fs.readFileSync(caminho(env), 'utf8'));
  } catch (e) {
    return null;
  }
  if (!valida(d)) return null;
  if (!(vivo || pidVivo)(d.pid)) return null;
  return { porta: d.porta, token: d.token, pid: d.pid };
}

// So apaga a ponte do proprio painel: a de outro painel que subiu depois fica.
function apagar(pid, env) {
  const arq = caminho(env);
  let d;
  try {
    d = JSON.parse(fs.readFileSync(arq, 'utf8'));
  } catch (e) {
    return false;
  }
  if (!d || d.pid !== pid) return false;
  try {
    fs.unlinkSync(arq);
    return true;
  } catch (e) {
    return false;
  }
}

// Compara o token em tempo constante: o resumo de cada lado tem sempre 32 bytes.
function mesmoToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = crypto.createHash('sha256').update(a).digest();
  const y = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x, y);
}

// A prova de que o painel da porta tem o token: o HMAC do numero que o gancho sorteou. A ponte velha de um painel que
// caiu pode apontar para uma porta que outro processo ocupou, e esse processo nao sabe calcular a prova.
function prova(token, numero) { return crypto.createHmac('sha256', token).update(numero).digest('hex'); }

module.exports = { pasta, caminho, novoToken, pidVivo, valida, gravar, ler, apagar, mesmoToken, prova };
