#!/usr/bin/env node
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const harnessLib = require('./lib/harness.js');
const ponte = require('./ponte.js');

/**
 * Pedido 6, Etapa 3 (D752: "os hooks precisam ir ligados ou pedir pra ligar no init"). `node instalar.js <harness>`
 * grava os ganchos do sworn onde o harness le, a partir do hooks/hooks.json (fonte unica), cada um chamando a
 * ponte.js; `node instalar.js --conferir <harness>` diz o que ja rodou (a marca que a ponte deixa em
 * `.claude/sworn/ligado/<harness>/`) e o passo que falta. Grava no projeto da pasta atual:
 * - codex: `.codex/hooks.json`. O usuario aprova no /hooks (desenho do Codex, D751); o --conferir conta a aprovacao no
 *   `~/.codex/config.toml`.
 * - qwen: `.qwen/settings.json`, chave hooks.
 * - agy: `.agents/hooks.json`, grupo "sworn".
 * - dsh: `.dsh/sworn-hooks.json`, lido pela ponte oficial do dsh no perfil "sworn" da pasta pessoal (a sonda lia o
 *   `.claude/settings.json`, que no projeto real e o do Claude Code).
 * - opencode: `.opencode/plugins/sworn.js`, que reexporta o `opencode/sworn.mjs`.
 * No arquivo de instrucoes que o harness carrega sem aprovacao vai um bloco: sem o "sworn - regras" na abertura, os
 * ganchos estao desligados e o modelo roda o --conferir. As skills ganham a raiz no lugar de ${CLAUDE_PLUGIN_ROOT}
 * (skillsComRaiz), e os agentes de agents/*.md, a forma de cada harness que nomeia agente (gravarAgentes).
 */
const RAIZ = path.join(__dirname, '..');
const NOMES = { codex: 'Codex', qwen: 'Qwen Code', agy: 'agy', dsh: 'dsh', opencode: 'OpenCode' };
// QWEN.md e AGENTS.md do Codex e do OpenCode pela documentacao deles; o do agy e o do dsh por inferencia (Etapa 5).
const INSTRUCOES = { codex: 'AGENTS.md', qwen: 'QWEN.md', agy: 'AGENTS.md', dsh: 'AGENTS.md', opencode: 'AGENTS.md' };
// Segundos a mais no timeout do harness: o node da ponte vem antes do portao, que roda com o timeout do hooks.json.
const FOLGA = 5;
const DSH_PERFIL = 'sworn';
const DSH_VERSAO = '0.2.1-rc.5';
const DSH_ENTRADA = [
  '- insert:',
  '    - id: hooks-claude-code',
  "      name: '@deepseek-ai/dsh-hooks-claude-code'",
  '      config:',
  '        configPath: ./.dsh/sworn-hooks.json',
  '        projectDir: .',
  ''
].join('\n');

const VARIAVEL = '${CLAUDE_PLUGIN_ROOT}';
// Os que leem as skills da copia do plugin que eles instalaram (pelos manifestos .codex-plugin, qwen-extension.json e
// .antigravity-plugin); o dsh e o OpenCode leem as do projeto, em .agents/skills.
const NA_COPIA = ['codex', 'qwen', 'agy'];

const barra = (p) => String(p).replace(/\\/g, '/');

// s283 (Etapa 5): o agy 1.4.12 parte o comando do gancho em cada espaco e nao tira as aspas (o node recebia o caminho
// com elas, lido a partir de .agents/, e nenhum gancho rodava): no agy, sem aspas; espaco no caminho vira passo.
function comando(harness, raiz, script, evento) {
  const p = barra(path.join(raiz, 'scripts', 'ponte.js'));
  const c = 'node ' + (harness === 'agy' ? p : '"' + p + '"') + ' ' + harness + ' ' + script;
  return evento ? c + ' ' + evento : c;
}

function comandoDoInstalar(raiz, resto) {
  return 'node "' + barra(path.join(raiz, 'scripts', 'instalar.js')) + '" ' + resto;
}

/** Os grupos de um evento do hooks.json na forma do harness; `evento` vai no 3o argumento (o agy nao o manda). */
function gruposDe(harness, raiz, grupos, evento) {
  return (grupos || []).map((g) => {
    const novo = {};
    const m = harnessLib.matcherDoHarness(harness, g.matcher);
    if (m !== undefined) novo.matcher = m;
    novo.hooks = ((g && g.hooks) || []).map((h) => ({ type: 'command',
      command: comando(harness, raiz, ponte.scriptDoGancho(h), evento), timeout: (Number(h.timeout) || 10) + FOLGA }));
    return novo;
  });
}

/** Os ganchos do sworn na forma do harness: { evento: grupos }. No agy, os eventos dele, com PreInvocation e Stop
 * soltos (sem matcher). */
function ganchosDoHarness(harness, raiz, ganchos) {
  const r = {};
  if (harness === 'agy') {
    for (const [ev, cobre] of Object.entries(harnessLib.EVENTOS.agy)) {
      const grupos = [].concat(...cobre.map((c) => ganchos[c] || []));
      if (!grupos.length) continue;
      const g = gruposDe(harness, raiz, grupos, ev);
      r[ev] = ev === 'PreToolUse' || ev === 'PostToolUse' ? g : [].concat(...g.map((x) => x.hooks));
    }
    return r;
  }
  for (const ev of harnessLib.eventosQueDispara(harness)) if (ganchos[ev]) r[ev] = gruposDe(harness, raiz, ganchos[ev]);
  return r;
}

const ehNosso = (h, harness) => !!h && typeof h.command === 'string' &&
  h.command.includes('/scripts/ponte.js" ' + harness + ' ');

/** Tira os ganchos do sworn de antes e poe os de agora; o que nao e do sworn fica onde estava. */
function juntarGanchos(atual, nossos, harness) {
  const r = {};
  for (const [ev, grupos] of Object.entries(atual && typeof atual === 'object' ? atual : {})) {
    if (!Array.isArray(grupos)) { r[ev] = grupos; continue; }
    const fica = grupos.map((g) => (g && Array.isArray(g.hooks)
      ? Object.assign({}, g, { hooks: g.hooks.filter((h) => !ehNosso(h, harness)) }) : g))
      .filter((g) => !(g && Array.isArray(g.hooks) && g.hooks.length === 0));
    if (fica.length) r[ev] = fica;
  }
  for (const [ev, grupos] of Object.entries(nossos)) r[ev] = (Array.isArray(r[ev]) ? r[ev] : []).concat(grupos);
  return r;
}

/** JSON de configuracao: ausente = {}; ilegivel ou que nao e objeto = null (nao se sobrescreve). */
function lerConfig(arq) {
  let texto;
  try { texto = fs.readFileSync(arq, 'utf8'); } catch (e) { return {}; }
  try {
    const v = JSON.parse(texto);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch (e) {
    return null;
  }
}

function gravar(arq, texto, gravados) {
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, texto, 'utf8');
  gravados.push(arq);
}

function bloco(harness, raiz) {
  return '<!-- sworn:ligar ' + harness + ' (gravado pelo instalar.js do sworn, que refaz este bloco) -->\n' +
    '## sworn no ' + NOMES[harness] + '\n\n' +
    'Se o bloco "sworn - regras" não apareceu no começo da sessão, os ganchos do sworn estão desligados e os\n' +
    'portões não rodam. Rode `' + comandoDoInstalar(raiz, '--conferir ' + harness) + '`, peça ao usuário o passo\n' +
    'que ele mostrar e não dê nada por pronto antes de ele dizer "ligados".\n' +
    '<!-- /sworn:ligar ' + harness + ' -->\n';
}

function comBloco(texto, harness, novo) {
  const ini = '<!-- sworn:ligar ' + harness + ' ';
  const fim = '<!-- /sworn:ligar ' + harness + ' -->\n';
  const a = texto.indexOf(ini);
  const b = a === -1 ? -1 : texto.indexOf(fim, a);
  if (b !== -1) return texto.slice(0, a) + novo + texto.slice(b + fim.length);
  if (!texto) return novo;
  return texto + (texto.endsWith('\n') ? '\n' : '\n\n') + novo;
}

/** A ponte oficial do dsh le um hooks.json do Claude Code por processo, configurado na camada do perfil. */
function perfilDoDsh(home, gravados, passos) {
  const perfil = path.join(home, '.dsh', 'profiles', DSH_PERFIL);
  if (!fs.existsSync(path.join(perfil, 'node_modules', '@deepseek-ai', 'dsh-hooks-claude-code'))) {
    passos.push('ponha a ponte oficial do dsh no perfil ' + DSH_PERFIL + ' (precisa do pnpm): dsh plugin --profile ' +
      DSH_PERFIL + ' add @deepseek-ai/dsh-hooks-claude-code@' + DSH_VERSAO + ' @deepseek-ai/dsh-hook-protocol@' +
      DSH_VERSAO + '; depois rode o instalador de novo');
    return;
  }
  const arq = path.join(perfil, 'cordis.patch.yml');
  let atual = '';
  try { atual = fs.readFileSync(arq, 'utf8'); } catch (e) { /* o perfil ainda sem camada */ }
  // atalho: acrescenta a entrada no fim do YAML, que e uma lista no topo. limite: camada so com comentarios, a lista
  // vazia `[]` que o `dsh plugin add` grava (sai: a entrada depois dela nao e YAML, s283) ou ja uma lista. trocar
  // quando: o perfil do sworn precisar de outra entrada alem desta.
  if (!atual.includes('sworn-hooks.json')) {
    atual = atual.replace(/^[ \t]*\[\][ \t]*\r?\n?/m, '');
    gravar(arq, (atual && !atual.endsWith('\n') ? atual + '\n' : atual) + DSH_ENTRADA, gravados);
  }
  passos.push('abra o dsh nesta pasta com o perfil do sworn: dsh --profile ' + DSH_PERFIL);
}

/** Os arquivos de skills/<nome>/ da raiz: [{ nome, rel, arq }]. */
function arquivosDasSkills(raiz) {
  const base = path.join(raiz, 'skills');
  let pastas = [];
  try {
    pastas = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch (e) {
    return [];
  }
  const r = [];
  for (const d of pastas) {
    for (const rel of fs.readdirSync(path.join(base, d.name), { recursive: true })) {
      const arq = path.join(base, d.name, rel);
      if (fs.statSync(arq).isFile()) r.push({ nome: d.name, rel, arq });
    }
  }
  return r;
}

// Etapa 4b (D756): as skills de esforco mudam o `effort:` do Claude Code, que os outros nao tem: ficam fora da copia.
const SO_NO_CLAUDE = ['effort-high', 'effort-low'];

/**
 * Fora do Claude Code ninguem troca ${CLAUDE_PLUGIN_ROOT} nas skills (sondas s270 e s271): o instalador troca pela
 * raiz. No Codex, no Qwen e no agy, na copia que o harness instalou; num repositorio git (a fonte), nada muda e o
 * passo diz a raiz. No dsh e no OpenCode, numa copia em .agents/skills/sworn-<nome>/ do projeto, com o nome da skill
 * igual ao da pasta.
 */
function skillsComRaiz(harness, projeto, raiz, gravados, passos) {
  const real = barra(path.resolve(raiz));
  const trocar = (t) => t.split(VARIAVEL).join(real);
  const arquivos = arquivosDasSkills(raiz);
  if (NA_COPIA.includes(harness)) {
    if (fs.existsSync(path.join(raiz, '.git'))) {
      passos.push('esta cópia do sworn é um repositório git, a fonte: as skills ficam com ' + VARIAVEL + ', que é ' +
        real + '; instale o plugin pelo ' + NOMES[harness] + ' e rode o instalador da cópia que ele instalar');
      return;
    }
    for (const a of arquivos) {
      if (!a.rel.endsWith('.md')) continue;
      const t = fs.readFileSync(a.arq, 'utf8');
      if (t.includes(VARIAVEL)) gravar(a.arq, trocar(t), gravados);
    }
    return;
  }
  for (const a of arquivos) {
    if (SO_NO_CLAUDE.includes(a.nome)) continue;
    const destino = path.join(projeto, '.agents', 'skills', 'sworn-' + a.nome, a.rel);
    if (!a.rel.endsWith('.md')) {
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.copyFileSync(a.arq, destino);
      gravados.push(destino);
      continue;
    }
    let t = trocar(fs.readFileSync(a.arq, 'utf8'));
    if (a.rel === 'SKILL.md') t = t.replace(/^(---\r?\nname:[ \t]*)/, '$1sworn-');
    gravar(destino, t, gravados);
  }
}

// O `tools:` do agents/*.md (nomes do Claude Code) -> os do Qwen 0.26.5 (constantes do pacote dele; read_file rodou na
// s278). O OpenCode nega por ferramenta: o agente sem Write, Edit ou shell ganha o false de cada uma.
const FERRAMENTAS_DO_QWEN = { Read: 'read_file', Grep: 'grep_search', Glob: 'glob', Bash: 'run_shell_command',
  PowerShell: 'run_shell_command' };
const NEGADAS_NO_OPENCODE = [['write', ['Write']], ['edit', ['Edit']], ['bash', ['Bash', 'PowerShell']]];
// D760 (sonda s290): o model_reasoning_effort do .toml muda o esforco do fio do subagente no Codex 0.162 (o rollout
// do fio disse low). Os niveis do effort: do Claude Code tem o mesmo nome la (lidos no binario); outro fica fora.
const ESFORCOS_DO_CODEX = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Os agentes de agents/*.md da raiz: [{ nome, descricao, ferramentas, corpo }]. Sem a pasta: nenhum. Ficam fora, com
 * um passo cada: a pasta ou o .md que nao se le; o .md sem o cabecalho (---); e o .md cujo tools: traz a lista nas
 * linhas de baixo, porque o campo so le a mesma linha e a lista vazia liberaria todas as ferramentas.
 */
function agentesDaRaiz(raiz, passos) {
  let nomes = [];
  try {
    nomes = fs.readdirSync(path.join(raiz, 'agents')).filter((n) => n.endsWith('.md'));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      passos.push('a pasta agents/ não pôde ser lida (' + e.code + '), e nenhum agente foi gravado: confira a ' +
        'permissão dela e rode o instalador de novo');
    }
    return [];
  }
  const r = [];
  for (const n of nomes) {
    let t;
    try {
      t = fs.readFileSync(path.join(raiz, 'agents', n), 'utf8');
    } catch (e) {
      passos.push('agents/' + n + ' não pôde ser lido (' + e.code + ') e ficou fora: confira o arquivo e rode o ' +
        'instalador de novo');
      continue;
    }
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(t);
    if (!m) {
      passos.push('agents/' + n + ' não tem o cabeçalho entre --- e ficou fora: conserte e rode o instalador de novo');
      continue;
    }
    const campo = (k) => {
      const c = new RegExp('^' + k + ':[ \\t]*(.*)$', 'm').exec(m[1]);
      return c ? c[1].trim() : '';
    };
    const ferramentas = campo('tools').split(',').map((f) => f.trim()).filter(Boolean);
    if (!ferramentas.length && /^tools:/m.test(m[1])) {
      passos.push('agents/' + n + ' tem tools: sem a lista na mesma linha e ficou fora: escreva tools: Read, Grep');
      continue;
    }
    r.push({ nome: path.basename(n, '.md'), descricao: campo('description'), ferramentas, esforco: campo('effort'),
      corpo: t.slice(m[0].length) });
  }
  return r;
}

/**
 * Etapa 4b (D756, sondas s278-s279): os agentes de agents/*.md (fonte unica) na forma de cada harness que nomeia
 * agente, como sworn-<papel> (o lib/harness.js devolve sworn:<papel> aos portoes). Codex: .codex/agents/<nome>.toml
 * (name, description, developer_instructions e, com o effort:, model_reasoning_effort); Qwen: .qwen/agents/<nome>.md
 * com as ferramentas dele; OpenCode: .opencode/agent/<nome>.md, subagente, com as de escrita negadas. O agy e o dsh so
 * tem o agente padrao: o papel vai no briefing (D756). Modelo e voltas sao do Claude Code e ficam fora (o subagente
 * usa o modelo da sessao); o esforco, fora do Codex.
 * O agente com tools: sem nenhuma que o Qwen tenha fica fora do Qwen: o tools: vazio liberaria todas.
 * atalho: a string do TOML pelo JSON.stringify. limite: texto sem caractere de controle alem de tab e quebra de linha
 * (o JSON deixa o DEL cru, e o TOML o recusa). trocar quando: um agents/*.md trouxer um.
 */
function gravarAgentes(harness, projeto, raiz, gravados, passos) {
  if (!['codex', 'qwen', 'opencode'].includes(harness)) return;
  for (const a of agentesDaRaiz(raiz, passos)) {
    const nome = 'sworn-' + a.nome;
    const desc = JSON.stringify(a.descricao);
    if (harness === 'codex') {
      const esforco = ESFORCOS_DO_CODEX.includes(a.esforco) ? 'model_reasoning_effort = "' + a.esforco + '"\n' : '';
      if (a.esforco && !esforco) {
        passos.push('agents/' + a.nome + '.md tem effort: ' + a.esforco + ', que o Codex não tem: o agente ficou no ' +
          'esforço padrão dele (escreva um destes, sem aspas: ' + ESFORCOS_DO_CODEX.join(', ') + ')');
      }
      gravar(path.join(projeto, '.codex', 'agents', nome + '.toml'), 'name = ' + JSON.stringify(nome) +
        '\ndescription = ' + desc + '\ndeveloper_instructions = ' + JSON.stringify(a.corpo) + '\n' + esforco,
      gravados);
    }
    if (harness === 'qwen') {
      const lista = Array.from(new Set(a.ferramentas.map((f) => FERRAMENTAS_DO_QWEN[f]).filter(Boolean)));
      if (a.ferramentas.length && !lista.length) {
        passos.push('agents/' + a.nome + '.md só usa ferramentas que o Qwen não tem (' + a.ferramentas.join(', ') +
          '): o agente ficou fora do Qwen');
        continue;
      }
      const tools = a.ferramentas.length ? 'tools:\n' + lista.map((f) => '  - ' + f + '\n').join('') : '';
      gravar(path.join(projeto, '.qwen', 'agents', nome + '.md'), '---\nname: ' + nome + '\ndescription: ' + desc +
        '\n' + tools + '---\n' + a.corpo, gravados);
    }
    if (harness === 'opencode') {
      const negadas = a.ferramentas.length
        ? NEGADAS_NO_OPENCODE.filter((par) => !par[1].some((f) => a.ferramentas.includes(f))) : [];
      const tools = negadas.length ? 'tools:\n' + negadas.map((par) => '  ' + par[0] + ': false\n').join('') : '';
      gravar(path.join(projeto, '.opencode', 'agent', nome + '.md'), '---\ndescription: ' + desc +
        '\nmode: subagent\n' + tools + '---\n' + a.corpo, gravados);
    }
  }
}

function pastaDoLigado(projeto, harness) {
  return path.join(projeto, '.claude', 'sworn', 'ligado', harness);
}

function contarGanchos(nossos) {
  let n = 0;
  for (const grupos of Object.values(nossos)) for (const g of grupos) n += Array.isArray(g.hooks) ? g.hooks.length : 1;
  return n;
}

function opcoesDe(opcoes) {
  const o = opcoes || {};
  return { projeto: o.projeto || process.cwd(), home: o.home || os.homedir(), raiz: o.raiz || RAIZ,
    ganchos: o.ganchos };
}

/** Grava os ganchos do harness, o bloco de instrucoes e a pasta de ligado. Devolve { gravados, passos }. */
function instalar(harness, opcoes) {
  const o = opcoesDe(opcoes);
  const { projeto, home, raiz } = o;
  const ganchos = o.ganchos || ponte.lerGanchos();
  const gravados = [];
  const passos = [];
  const nossos = ganchosDoHarness(harness, raiz, ganchos);
  const emJson = (arq, mudar) => {
    const atual = lerConfig(arq);
    if (atual === null) {
      passos.push('o ' + arq + ' não é um JSON que dê para ler: conserte e rode o instalador de novo');
      return false;
    }
    gravar(arq, JSON.stringify(mudar(atual), null, 2) + '\n', gravados);
    return true;
  };
  const comHooks = (v) => Object.assign(v, { hooks: juntarGanchos(v.hooks, nossos, harness) });
  let ok = true;
  if (harness === 'codex') ok = emJson(path.join(projeto, '.codex', 'hooks.json'), comHooks);
  if (harness === 'qwen') ok = emJson(path.join(projeto, '.qwen', 'settings.json'), comHooks);
  if (harness === 'agy') {
    ok = emJson(path.join(projeto, '.agents', 'hooks.json'), (v) => Object.assign(v, { sworn: nossos }));
    if (/\s/.test(raiz)) {
      passos.push('o agy parte o comando do gancho em cada espaço e não lê aspas: com o sworn em ' + barra(raiz) +
        ' os ganchos não rodam. Instale o sworn numa pasta sem espaço e rode o instalador de lá');
    }
  }
  if (harness === 'dsh') {
    gravar(path.join(projeto, '.dsh', 'sworn-hooks.json'), JSON.stringify({ hooks: nossos }, null, 2) + '\n', gravados);
    perfilDoDsh(home, gravados, passos);
  }
  if (harness === 'opencode') {
    gravar(path.join(projeto, '.opencode', 'plugins', 'sworn.js'),
      '// Gravado pelo instalar.js do sworn: o plugin do sworn no OpenCode. Para atualizar, rode o instalador.\n' +
      "export { SwornPlugin } from '" + pathToFileURL(path.join(raiz, 'opencode', 'sworn.mjs')).href + "'\n", gravados);
  }
  if (!ok) return { gravados, passos };
  skillsComRaiz(harness, projeto, raiz, gravados, passos);
  gravarAgentes(harness, projeto, raiz, gravados, passos);

  const instrucoes = path.join(projeto, INSTRUCOES[harness]);
  let texto = '';
  try { texto = fs.readFileSync(instrucoes, 'utf8'); } catch (e) { /* o harness ainda sem instrucoes */ }
  gravar(instrucoes, comBloco(texto, harness, bloco(harness, raiz)), gravados);

  const ligado = pastaDoLigado(projeto, harness);
  gravar(path.join(ligado, '.gitignore'), '*\n', gravados);
  const eventos = harnessLib.eventosQueDispara(harness).filter((ev) => ponte.scriptsDe(ganchos, ev).length);
  const instalado = { raiz: path.resolve(raiz), quando: new Date().toISOString(), eventos,
    ganchos: contarGanchos(nossos) };
  gravar(path.join(ligado, 'instalado.json'), JSON.stringify(instalado) + '\n', gravados);
  if (harness === 'codex') {
    const { aprovados } = aprovacaoNoCodex(projeto, home);
    if (aprovados < contarGanchos(nossos)) passos.push(passoDoCodex(aprovados, contarGanchos(nossos)));
  }
  return { gravados, passos };
}

const snake = (evento) => evento.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
const ordenado = (v) => Array.isArray(v) ? v.map(ordenado) : v && typeof v === 'object'
  ? Object.keys(v).sort().reduce((o, k) => { o[k] = ordenado(v[k]); return o; }, {}) : v;

/**
 * O hash com que o /hooks do Codex aprova um gancho (codex-rs: hook_hash em hooks/src/engine/discovery.rs e
 * version_for_toml em config/src/fingerprint.rs): evento, matcher e o gancho normalizado, chaves em ordem, JSON
 * compacto. O Codex nao roda o gancho cujo hash mudou desde a aprovacao.
 */
function hashDoCodex(evento, grupo, gancho) {
  const ev = snake(evento);
  const fim = ev === 'session_end';
  const t = Number.isInteger(gancho.timeout) ? gancho.timeout : (fim ? 1 : 600);
  // Sem o commandWindows, que o Codex no Windows poria no lugar do command: o sworn nao grava esse campo.
  const h = { type: 'command', command: gancho.command,
    timeout: fim ? Math.min(Math.max(t, 1), 3) : Math.max(t, 1), async: gancho.async === true };
  if (typeof gancho.statusMessage === 'string') h.statusMessage = gancho.statusMessage;
  const id = { event_name: ev, hooks: [h] };
  if (ev !== 'user_prompt_submit' && ev !== 'stop' && typeof grupo.matcher === 'string') id.matcher = grupo.matcher;
  return 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(ordenado(id))).digest('hex');
}

/**
 * Os ganchos do sworn no .codex/hooks.json do projeto: { nossos, aprovados }. Aprovado = o /hooks aprovou como esta
 * hoje: o trusted_hash do [hooks.state."<arquivo>:<evento>:i:j"] igual ao hashDoCodex e sem enabled = false.
 * hooks.json ausente ou ilegivel = nenhum nosso.
 */
function aprovacaoNoCodex(projeto, home) {
  const arq = path.join(projeto, '.codex', 'hooks.json');
  const atual = lerConfig(arq);
  const hooks = atual && atual.hooks && typeof atual.hooks === 'object' ? atual.hooks : {};
  let toml = '';
  try { toml = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8'); } catch (e) { /* nada aprovado */ }
  const estado = {};
  let chave = null;
  for (const linha of toml.split(/\r?\n/)) {
    const m = /^\s*\[hooks\.state\.(?:'([^']*)'|"((?:[^"\\]|\\.)*)")\]/.exec(linha);
    if (m) {
      chave = barra(m[1] !== undefined ? m[1] : m[2].replace(/\\\\/g, '\\')).toLowerCase();
      estado[chave] = estado[chave] || {};
      continue;
    }
    if (/^\s*\[/.test(linha)) chave = null;
    if (!chave) continue;
    const t = /^\s*trusted_hash\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(linha);
    if (t) estado[chave].hash = t[1] !== undefined ? t[1] : t[2];
    if (/^\s*enabled\s*=\s*false\b/.test(linha)) estado[chave].desligado = true;
  }
  const alvo = barra(arq).toLowerCase();
  const r = { nossos: 0, aprovados: 0 };
  for (const [evento, grupos] of Object.entries(hooks)) {
    if (!Array.isArray(grupos)) continue;
    grupos.forEach((grupo, i) => (grupo && Array.isArray(grupo.hooks) ? grupo.hooks : []).forEach((g, j) => {
      if (!ehNosso(g, 'codex')) return;
      r.nossos += 1;
      const e = estado[alvo + ':' + snake(evento) + ':' + i + ':' + j];
      if (e && !e.desligado && e.hash === hashDoCodex(evento, grupo, g)) r.aprovados += 1;
    }));
  }
  return r;
}

function passoDoCodex(aprovados, total) {
  return 'abra o Codex nesta pasta, rode /hooks e aprove os ganchos do sworn (aprovados: ' + aprovados + ' de ' +
    total + '); o Codex pede essa aprovação por segurança e não roda o gancho que mudou desde a última aprovação';
}

/** Le a marca de ligado: { verde, ligados, naoVistos, passos }. Verde = algum gancho rodou depois de instalar. */
function conferir(harness, opcoes) {
  const { projeto, home, raiz } = opcoesDe(opcoes);
  const pasta = pastaDoLigado(projeto, harness);
  const nada = (passo) => ({ verde: false, ligados: [], naoVistos: [], passos: [passo] });
  let inst = null;
  try {
    inst = JSON.parse(fs.readFileSync(path.join(pasta, 'instalado.json'), 'utf8'));
  } catch (e) { /* sem instalar */ }
  if (!inst || typeof inst !== 'object') {
    return nada('os ganchos do sworn não estão no ' + NOMES[harness] + ' deste projeto: rode ' +
      comandoDoInstalar(raiz, harness));
  }
  if (path.resolve(String(inst.raiz)) !== path.resolve(raiz)) {
    return nada('os ganchos apontam para outra pasta do sworn (' + inst.raiz + '): rode ' +
      comandoDoInstalar(raiz, harness) + ' de novo');
  }
  const desde = Date.parse(inst.quando);
  const vistos = {};
  let nomes = [];
  try { nomes = fs.readdirSync(pasta); } catch (e) { /* pasta sumiu */ }
  for (const nome of nomes) {
    const m = /^(\w+)--[\w-]+$/.exec(nome);
    if (!m) continue;
    let quando = NaN;
    try { quando = Date.parse(fs.readFileSync(path.join(pasta, nome), 'utf8').trim()); } catch (e) { /* sumiu */ }
    if (quando >= desde) vistos[m[1]] = true;
  }
  const esperados = Array.isArray(inst.eventos) ? inst.eventos : [];
  const ligados = esperados.filter((e) => vistos[e]);
  const naoVistos = esperados.filter((e) => !vistos[e]);
  // No Codex, o gancho que rodou nao prova os outros: o mudado desde a aprovacao do /hooks nao roda.
  const total = Number(inst.ganchos) || 0;
  const codex = harness === 'codex' ? aprovacaoNoCodex(projeto, home) : null;
  const semAprovar = codex !== null && codex.aprovados < total;
  if (ligados.length && !semAprovar) return { verde: true, ligados, naoVistos, passos: [] };
  const passos = [];
  if (codex && codex.nossos < total) {
    passos.push('o .codex/hooks.json deste projeto não tem os ganchos do sworn ou não dá para ler: rode ' +
      comandoDoInstalar(raiz, harness) + ' de novo');
  } else if (semAprovar) {
    passos.push(passoDoCodex(codex.aprovados, total));
  }
  if (harness === 'dsh') perfilDoDsh(home, [], passos);
  if (harness !== 'dsh' && !ligados.length) {
    passos.push('abra o ' + NOMES[harness] + ' nesta pasta e mande qualquer pedido');
  }
  passos.push('depois rode ' + comandoDoInstalar(raiz, '--conferir ' + harness));
  return { verde: false, ligados, naoVistos, passos };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const conf = args[0] === '--conferir';
  const harness = conf ? args[1] : args[0];
  if (!harnessLib.HARNESSES.includes(harness)) {
    process.stderr.write('uso: node instalar.js <' + harnessLib.HARNESSES.join('|') + '>\n' +
      '     node instalar.js --conferir <harness>\n');
    process.exit(2);
  }
  const linhas = [];
  if (conf) {
    const r = conferir(harness);
    if (r.verde) {
      linhas.push('sworn no ' + NOMES[harness] + ': ligados (' + r.ligados.join(', ') + ').');
      if (r.naoVistos.length) {
        linhas.push('ainda não vistos (rodam quando o evento acontecer): ' + r.naoVistos.join(', '));
      }
    } else {
      linhas.push('sworn no ' + NOMES[harness] + ': faltam os ganchos. Faça:');
      for (const p of r.passos) linhas.push('- ' + p);
    }
    process.stdout.write(linhas.join('\n') + '\n');
    process.exit(r.verde ? 0 : 1);
  }
  const r = instalar(harness);
  linhas.push('sworn no ' + NOMES[harness] + ': gravados');
  for (const g of r.gravados) linhas.push('- ' + g);
  if (r.passos.length) linhas.push('falta:');
  for (const p of r.passos) linhas.push('- ' + p);
  linhas.push('confira com: ' + comandoDoInstalar(RAIZ, '--conferir ' + harness));
  process.stdout.write(linhas.join('\n') + '\n');
}

module.exports = { instalar, conferir, ganchosDoHarness, comando, comandoDoInstalar, hashDoCodex };
