#!/usr/bin/env node
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseArgs } = require('util');
const adm = require('./lib/admissao.js');
const codexLib = require('./lib/admissao-codex.js');
const instalador = require('./instalar.js');

/**
 * C7 (s369, D769 a, D816): o teste de admissao do modelo, que o /sworn:init oferece e so roda com o sim do usuario.
 *   node scripts/admissao.js --modelo <id> [--harness claude|codex] [--claude <exe>] [--codex <exe>] [--gravar]
 *     [--teto-ms <n>]
 * Roda os 4 cenarios de lib/admissao.js, cada um numa pasta temporaria propria e com o estado do sworn numa pasta so
 * dele (SWORN_TMP). No Claude Code (o padrao): `claude -p` com o sworn deste plugin ligado (--plugin-dir), sem a
 * configuracao do usuario (--setting-sources project, --strict-mcp-config). No Codex (C7b): o `instalar.js codex` na
 * pasta e a receita da bateria (lib/admissao-codex.js): `codex exec --json` sem o config.toml do usuario, com a
 * confianca dos ganchos do sworn so nesta chamada e numa pasta pessoal falsa. Com --gravar, grava o resultado em
 * `admissao` no .claude/sworn/projeto.json da pasta atual. Sai 0 quando os 4 rodaram (com ou sem falha), 1 quando
 * nada rodou (a pasta temporaria nao se criou) ou o --gravar nao gravou, 2 no erro de uso. O modelo roda sem pedir
 * confirmacao dentro das pastas temporarias: o que o limita sao as travas do sworn, que sao o que o teste mede (o
 * /sworn:init diz isso antes de pedir o sim).
 */

const PLUGIN = path.resolve(__dirname, '..');
const AMBIENTE_FORA = ['CLAUDE_EFFORT', 'CLAUDE_CODE_CHILD_SESSION'];
const TETO_TURNOS = '15';
const HARNESSES = ['claude', 'codex'];

function uso(msg) {
  process.stderr.write('admissao: ' + msg + '\nuso: node scripts/admissao.js --modelo <id> [--harness claude|codex] ' +
    '[--claude <exe>] [--codex <exe>] [--gravar] [--teto-ms <n>]\n');
  process.exit(2);
}

/** Abre o harness; { s } ou { causa } quando ele nao abriu ou passou do limite. */
function executar(exe, args, env, cwd, opcoes) {
  const s = spawnSync(exe, args, { cwd: cwd, env: env, encoding: 'utf8', timeout: opcoes.tetoMs,
    maxBuffer: 64 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  if (!s.error) return { s: s };
  const codigo = s.error.code;
  return { causa: codigo === 'ETIMEDOUT' ? 'passou do limite de ' + opcoes.tetoMs + ' ms (aumente com --teto-ms)'
    : codigo === 'ENOBUFS' ? 'a saida do ' + opcoes.harness + ' passou de 64 MB'
      : 'o ' + opcoes.harness + ' nao abriu (' + (codigo || s.error.message) + '): confira o caminho em --' + opcoes.harness };
}

function semResposta(s, harness) {
  return s.status === null ? 'o ' + harness + ' foi encerrado (' + (s.signal || 'sinal') + ') sem responder'
    : 'o ' + harness + ' saiu com o codigo ' + s.status + ' sem responder';
}

/** Roda o `claude -p` de um cenario na `pasta`, com o estado do sworn em `swornTmp` (a pasta so deste cenario);
 *  devolve { r, causa } (r = lerResultado, null quando nao rodou). */
function rodarClaude(cenario, pasta, swornTmp, opcoes) {
  const env = Object.assign({}, process.env, { SWORN_TMP: swornTmp });
  for (const k of AMBIENTE_FORA) delete env[k];
  const args = ['-p', cenario.pedido, '--model', opcoes.modelo, '--setting-sources', 'project', '--strict-mcp-config',
    '--output-format', 'stream-json', '--verbose', '--max-turns', TETO_TURNOS, '--permission-mode', 'bypassPermissions',
    '--plugin-dir', PLUGIN];
  const x = executar(opcoes.claude, args, env, pasta, opcoes);
  if (x.causa) return { r: null, causa: x.causa };
  const r = adm.lerResultado(x.s.stdout);
  if (!r) return { r: null, causa: semResposta(x.s, 'claude') };
  r.estado = adm.lerEstado(swornTmp, r.sessao);
  return { r: r, causa: null };
}

/** C7b: roda o `codex exec` de um cenario na `pasta` (o instalar.js codex ja rodou nela), com o estado em `swornTmp`. */
function rodarCodex(cenario, pasta, swornTmp, opcoes) {
  const real = fs.realpathSync.native(pasta);
  // a confianca vai em literais TOML entre aspas simples (a receita da bateria): o caminho com apostrofo os quebraria
  if (real.indexOf("'") !== -1) {
    return { r: null, causa: 'o caminho da pasta temporaria tem apostrofo (' + real + '), que a configuracao do Codex ' +
      'nao aceita: aponte a variavel TMP para uma pasta sem apostrofo e rode de novo' };
  }
  const itens = codexLib.confianca(real, instalador.hashDoCodex);
  if (!itens.length) {
    return { r: null, causa: 'o sworn nao ficou instalado no Codex desta pasta (falta ' +
      path.join(real, '.codex', 'hooks.json') + '): rode node <sworn>/scripts/instalar.js codex num projeto de teste ' +
      'para ver o erro, e rode este teste de novo' };
  }
  const casa = path.join(path.dirname(pasta), cenario.id + '-casa');
  codexLib.aprovarNaCasa(casa, itens);
  const ambiente = Object.assign({}, process.env, { SWORN_TMP: swornTmp });
  for (const k of AMBIENTE_FORA) delete ambiente[k];
  const cmd = codexLib.comando({ codex: opcoes.codex, modelo: opcoes.modelo, pasta: real, itens: itens,
    pedido: cenario.pedido, casa: casa, codexHome: opcoes.codexHome, ambiente: ambiente });
  const x = executar(cmd.exe, cmd.args, cmd.env, real, opcoes);
  if (x.causa) return { r: null, causa: x.causa };
  const r = codexLib.lerResultado(x.s.stdout);
  if (!r) return { r: null, causa: semResposta(x.s, 'codex') };
  // o estado do sworn no Codex se grava pelo thread_id (ao lado fica o ponte-codex-<id>.json da ponte)
  r.estado = adm.lerEstado(swornTmp, r.sessao);
  return { r: r, causa: null };
}

/** Grava `admissao` no projeto.json da `cwd`; { ok, msg }. Ausente, JSON quebrado e escrita negada dizem cada um a
 *  sua causa e o passo. */
function gravar(cwd, admissao) {
  const arq = path.join(cwd, '.claude', 'sworn', 'projeto.json');
  let texto;
  try { texto = fs.readFileSync(arq, 'utf8'); } catch (e) {
    return { ok: false, msg: e && e.code === 'ENOENT' ? 'nao gravei: nao ha ' + arq + '; rode o /sworn:init antes'
      : 'nao gravei: ' + arq + ' nao se le (' + ((e && e.code) || e) + ')' };
  }
  let projeto;
  try { projeto = JSON.parse(texto); } catch (e) {
    return { ok: false, msg: 'nao gravei: ' + arq + ' nao e JSON valido (' + e.message + '); conserte o arquivo e rode ' +
      'de novo com --gravar' };
  }
  if (projeto === null || typeof projeto !== 'object' || Array.isArray(projeto)) {
    return { ok: false, msg: 'nao gravei: ' + arq + ' nao e um objeto JSON' };
  }
  projeto.admissao = admissao;
  // grava num temporario ao lado e troca: a escrita que falha no meio (disco cheio) nao deixa o projeto.json cortado
  const tmp = arq + '.admissao-' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(projeto, null, 2) + '\n');
    fs.renameSync(tmp, arq);
  } catch (e) {
    let sobrou = '';
    try { fs.rmSync(tmp, { force: true }); } catch (x) { sobrou = '; apague tambem ' + tmp; }
    return { ok: false, msg: 'nao gravei: a escrita em ' + arq + ' falhou (' + ((e && e.code) || e) + '); o arquivo ' +
      'segue como estava' + sobrou };
  }
  return { ok: true, msg: 'gravado em ' + arq + ' (chave admissao)' };
}

function main() {
  let o;
  try {
    o = parseArgs({ options: { modelo: { type: 'string' }, harness: { type: 'string' }, claude: { type: 'string' },
      codex: { type: 'string' }, gravar: { type: 'boolean' }, 'teto-ms': { type: 'string' } },
    allowPositionals: false }).values;
  } catch (e) {
    return uso(e.message);
  }
  if (!o.modelo) return uso('falta --modelo');
  const harness = o.harness || 'claude';
  if (HARNESSES.indexOf(harness) === -1) return uso('--harness tem de ser claude ou codex');
  if (o['teto-ms'] !== undefined && !/^[1-9]\d*$/.test(o['teto-ms'])) return uso('--teto-ms tem de ser inteiro positivo');
  const opcoes = { modelo: o.modelo, harness: harness, claude: o.claude || process.env.CLAUDE_CODE_EXECPATH || 'claude',
    codex: o.codex || 'codex', codexHome: path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex')),
    tetoMs: o['teto-ms'] ? Number(o['teto-ms']) : 240000 };
  let base;
  try { base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-admissao-')); } catch (e) {
    process.stderr.write('admissao: nao deu para criar a pasta temporaria em ' + os.tmpdir() + ' (' +
      ((e && e.code) || e) + '); nada rodou\n');
    return 1;
  }
  const resultados = [];
  let custo = 0;
  let algumCusto = false;
  try {
    for (const c of adm.CENARIOS) {
      // o cenario que lanca (pasta que nao se grava, estado ilegivel) vira `nao rodou` com a causa; os outros seguem
      try {
        const pasta = path.join(base, c.id);
        const swornTmp = path.join(base, c.id + '-estado');
        if (harness === 'codex') {
          // o AGENTS.md e os ganchos do Codex antes do projeto do cenario, que regrava o .claude/sworn por cima
          fs.mkdirSync(pasta, { recursive: true });
          instalador.instalar('codex', { projeto: pasta });
        }
        adm.montar(pasta);
        const { r, causa } = harness === 'codex' ? rodarCodex(c, pasta, swornTmp, opcoes)
          : rodarClaude(c, pasta, swornTmp, opcoes);
        if (r && typeof r.custo === 'number') { custo += r.custo; algumCusto = true; }
        resultados.push(adm.conferir(c, pasta, r, causa));
      } catch (e) {
        resultados.push(adm.conferir(c, null, null, 'o cenario quebrou (' + ((e && e.code) || (e && e.message) || e) + ')'));
      }
    }
  } finally {
    // no Windows um processo filho ainda pode segurar a pasta: a limpeza que falha avisa, nao derruba o relatorio
    try { fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) {
      process.stderr.write('admissao: a pasta temporaria ' + base + ' ficou (' + ((e && e.code) || e) + '); apague-a ' +
        'depois\n');
    }
  }
  process.stdout.write(adm.relatorio(resultados, opcoes.modelo, algumCusto ? custo : null) + '\n');
  if (o.gravar) {
    const dados = adm.paraGravar(resultados, opcoes.modelo, harness, new Date().toISOString().slice(0, 10));
    const g = gravar(process.cwd(), dados);
    process.stdout.write(g.msg + '\n');
    if (!g.ok) return 1;
  }
  return 0;
}

if (require.main === module) process.exitCode = main();
module.exports = { rodarClaude, rodarCodex, gravar };
