'use strict';
const fs = require('node:fs');
const path = require('node:path');
const texto = require('./texto.js');
const continuo = require('./continuo.js');
const { LIMIARES_PADRAO, limiaresValidos } = require('./saude.js');
const git = require('./git.js');

/**
 * D786 passo 1: o ponto da compactacao automatica do harness fica logo depois do gatilho de contexto do sworn, para o
 * handoff gravado no gatilho ser relido depois da compactacao e o trabalho seguir na mesma sessao. Um gravador so,
 * chamado pelo calibrar.js (--ponto no /sworn:init; --gravar e --manter, que mudam o limiar), pelo instalar.js codex
 * e, desde a R3g, pela abertura da sessao (gravarNaAbertura, so o do Claude Code, uma vez por projeto).
 * - Claude Code: `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW` no `.claude/settings.local.json` (pessoal; a sonda 3 da s331
 *   mediu que o env de la vale). Faixa da documentacao: 100000 a 1000000. O gravador tambem o poe fora do git
 *   (foraDoGit: uma linha no info/exclude quando o projeto ainda nao o ignora; o resultado traz `exclude`).
 * - Codex: `model_auto_compact_token_limit` no topo do `.codex/config.toml` do projeto (alegacao de agente na s331, a
 *   conferir ao vivo: o Codex so le o do projeto confiavel). So quando o instalar.js gravou os ganchos dele aqui.
 * Qwen (a chave e fracao da janela, que o sworn nao sabe), OpenCode, agy e dsh: sem chave (HARNESSES.md).
 * Arquivo ilegivel ou fora da forma nao se sobrescreve: volta `erro` com o passo.
 */
const FOLGA = 50000;      // inferido: o handoff se grava no fim do turno que passa do limiar, antes de compactar
const RESERVA = 33000;    // o Claude Code compacta ~33 mil abaixo da janela (sonda 2 da s331: 67.154 com 100 mil)
const JANELA = { min: 100000, max: 1000000 };
const VARIAVEL = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW';
const CHAVE_CODEX = 'model_auto_compact_token_limit';
const SETTINGS = '.claude/settings.local.json';
const CONFIG_CODEX = '.codex/config.toml';

const objeto = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** O limiar que vale hoje, como o medidor (saude.medir): o gravado, se numero positivo; senao o do modo continuo,
 *  quando ligado; senao o padrao do plugin (sobra 5 da 0.8.3, D538; antes so no calibrar.js). */
function limiarEmVigor(projeto) {
  const gravado = limiaresValidos(objeto(projeto) ? projeto.limiares : undefined);
  if ('tokensDeContexto' in gravado) return { n: gravado.tokensDeContexto, de: 'projeto.json' };
  return continuo.ativo(projeto) ? { n: continuo.TOKENS_CONTEXTO, de: 'modo continuo' }
    : { n: LIMIARES_PADRAO.tokensDeContexto, de: 'padrao do plugin' };
}

const ponto = (limiar) => limiar + FOLGA;

function gravarNoClaude(raiz, limiar, opcoes) {
  const valor = Math.min(JANELA.max, Math.max(JANELA.min, ponto(limiar) + RESERVA));
  const r = { harness: 'claude', arquivo: SETTINGS, chave: 'env.' + VARIAVEL, valor };
  const falha = (erro) => Object.assign(r, { gravou: false, erro: erro });
  const arq = path.join(raiz, '.claude', 'settings.local.json');
  if (temLink(raiz)) {
    return falha('a pasta .claude ou o ' + SETTINGS + ' e um link (atalho) que leva para fora do projeto, e o sworn nao ' +
      'grava por ele; troque o link por um arquivo comum e rode de novo');
  }
  let obj = {};
  if (fs.existsSync(arq)) {
    // D460: o PowerShell 5.1 grava BOM; arquivo vazio vale como {}
    try {
      const bruto = texto.semBom(fs.readFileSync(arq, 'utf8'));
      obj = bruto.trim() ? JSON.parse(bruto) : {};
    } catch (e) {
      return falha(SETTINGS + ' nao e JSON valido (' + texto.causaDoErro(e) + '); corrija e rode de novo');
    }
  }
  if (!objeto(obj)) {
    return falha(SETTINGS + ' tem de ter as chaves entre { e }, como { "env": { } }; corrija e rode de novo');
  }
  if ('env' in obj && !objeto(obj.env)) {
    return falha('env em ' + SETTINGS + ' tem de ter as variaveis entre { e }, como "env": { "' + VARIAVEL + '": "' +
      valor + '" }; corrija e rode de novo');
  }
  const antes = obj.env && obj.env[VARIAVEL];
  // o arquivo que ja existe tambem sai do git: o gravado antes da R3g nunca passou pelo foraDoGit
  const comExclude = (x) => { const linha = foraDoGit(raiz); return linha ? Object.assign(x, { exclude: linha }) : x; };
  if (antes === String(valor)) return comExclude(Object.assign(r, { gravou: false }));
  // valor vazio nao e decisao do dono: vale como ausente, como a variavel vazia no ambiente
  if (antes !== undefined && String(antes).trim() !== '' && opcoes && opcoes.manter) return comExclude(Object.assign(r, { gravou: false, antes: antes }));
  obj.env = Object.assign({}, obj.env, { [VARIAVEL]: String(valor) });
  try {
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    fs.writeFileSync(arq, JSON.stringify(obj, null, 2) + '\n');
  } catch (e) {
    return falha('nao consegui gravar ' + SETTINGS + ' (' + texto.causaDoErro(e) + '); confira se a pasta .claude ' +
      'aceita gravacao e rode de novo');
  }
  return comExclude(Object.assign(r, { gravou: true }, antes !== undefined ? { antes: antes } : {}));
}

// a saida do git sem a quebra de linha do fim, e so ela: um espaco no comeco ou no fim do nome da pasta e do caminho
const semQuebra = (s) => s.replace(/\r?\n$/, '');

/** R3g: o arquivo pessoal nao entra no git. Ja ignorado (o .gitignore do projeto, o global): nada; senao uma linha no
 *  info/exclude do repositorio, que e local e nao vai em commit, e devolve essa linha. Fora de repositorio, git que
 *  falha ou exclude que nao grava: null (o git status mostra o arquivo e o dono decide). */
function foraDoGit(raiz) {
  const rel = '.claude/settings.local.json';
  if (git.correr(raiz, ['check-ignore', '-q', '--', rel]) !== null) return null;
  const exclude = git.correr(raiz, ['rev-parse', '--git-path', 'info/exclude']);
  const prefixo = git.correr(raiz, ['rev-parse', '--show-prefix']);
  if (exclude === null || prefixo === null) return null;
  // o padrao do gitignore le [ ] * ? e a barra invertida como curinga: o nome da pasta entra escapado
  const linha = '/' + semQuebra(prefixo).replace(/[[\]*?\\]/g, '\\$&') + rel;
  const arq = path.resolve(raiz, semQuebra(exclude));
  try {
    const atual = fs.existsSync(arq) ? fs.readFileSync(arq, 'utf8') : '';
    if (atual.split(/\r?\n/).indexOf(linha) !== -1) return null;
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    fs.appendFileSync(arq, (atual && !/\n$/.test(atual) ? '\n' : '') + linha + '\n');
    return linha;
  } catch (e) { return null; }
}

// atalho: o topo do TOML sao as linhas antes do 1o cabecalho [tabela]; a chave nova entra na 1a linha, que e sempre
// topo. limite: uma string de varias linhas com "[" no comeco de linha antes da chave confunde a busca.
// trocar quando: o plugin tiver um leitor de TOML.
function gravarNoCodex(raiz, limiar, opcoes) {
  const valor = ponto(limiar);
  const r = { harness: 'codex', arquivo: CONFIG_CODEX, chave: CHAVE_CODEX, valor };
  const falha = (erro) => Object.assign(r, { gravou: false, erro: erro });
  const arq = path.join(raiz, '.codex', 'config.toml');
  let bruto = '';
  if (fs.existsSync(arq)) {
    try { bruto = fs.readFileSync(arq, 'utf8'); } catch (e) {
      return falha(CONFIG_CODEX + ' nao se le (' + texto.causaDoErro(e) + '); corrija e rode de novo');
    }
  }
  const bom = bruto.charCodeAt(0) === 0xFEFF ? '\uFEFF' : '';
  const corpo = bruto.slice(bom.length);
  const eol = corpo.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
  const linhas = corpo ? corpo.split(/\r?\n/) : [''];
  const nova = CHAVE_CODEX + ' = ' + valor;
  const re = new RegExp('^\\s*' + CHAVE_CODEX + '\\s*=\\s*([^#]*?)\\s*(#.*)?$');
  let topo = linhas.findIndex((l) => /^\s*\[/.test(l));
  if (topo === -1) topo = linhas.length;
  const i = linhas.slice(0, topo).findIndex((l) => re.test(l));
  const antes = i === -1 ? undefined : linhas[i].match(re)[1];
  if (antes === String(valor)) return Object.assign(r, { gravou: false });
  if (antes !== undefined && opcoes && opcoes.manter) return Object.assign(r, { gravou: false, antes: antes });
  if (i === -1) linhas.unshift(nova); else linhas[i] = nova;
  try {
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    fs.writeFileSync(arq, bom + linhas.join(eol));
  } catch (e) {
    return falha('nao consegui gravar ' + CONFIG_CODEX + ' (' + texto.causaDoErro(e) + '); confira se a pasta .codex ' +
      'aceita gravacao e rode de novo');
  }
  return Object.assign(r, { gravou: true }, antes !== undefined ? { antes: antes } : {});
}

/** O Claude Code sempre; o Codex quando o instalar.js gravou os ganchos dele no projeto. */
function gravarPontos(raiz, limiar, opcoes) {
  const codex = fs.existsSync(path.join(raiz, '.claude', 'sworn', 'ligado', 'codex', 'instalado.json'));
  return [gravarNoClaude(raiz, limiar, opcoes)].concat(codex ? [gravarNoCodex(raiz, limiar, opcoes)] : []);
}

const ARQUIVO_FEITOS = 'compactacao-gravada.json';

/** <CLAUDE_CONFIG_DIR ou ~/.claude>/sworn/compactacao-gravada.json: os projetos em que a abertura ja gravou. */
function arquivoDosFeitos(env) {
  return path.join(path.dirname(require('./gasto.js').pastaDosProjetos(env)), 'sworn', ARQUIVO_FEITOS);
}

// O caminho como o disco o guarda: o realpath do sistema resolve link, nome curto 8.3 do Windows e a caixa das letras,
// entao a mesma pasta da sempre a mesma chave, e duas pastas que so diferem na caixa (Linux) dao duas.
const real = (p) => { try { return fs.realpathSync.native(p); } catch (e) { return null; } };

/** Link simbolico no caminho do arquivo pessoal (um repositorio clonado pode traze-lo): a gravacao sairia do projeto. */
function temLink(raiz) {
  for (const rel of ['.claude', path.join('.claude', 'settings.local.json')]) {
    try { if (fs.lstatSync(path.join(raiz, rel)).isSymbolicLink()) return true; } catch (e) { /* nao existe: segue */ }
  }
  return false;
}

/**
 * R3g (pedido do dono 2026-11-12: automatico, no plugin, para qualquer projeto): a abertura da sessao grava o ponto
 * do Claude Code uma vez por projeto, para o harness compactar logo depois do handoff tambem onde o /sworn:init nao
 * rodou ou rodou antes da D786 (o do Codex fica com o instalar.js). Projeto e a raiz do projeto.json ou, sem ele, a
 * raiz de um repositorio git (subpasta e pasta solta ficam de fora). O que o dono decidiu fica: a variavel no
 * ambiente do processo, um valor proprio no arquivo, e a chave apagada depois da 1a vez (a lista dos feitos fica na
 * pasta de config, fora do projeto, e se grava ANTES do ponto: sem ela, nada se grava). Devolve a linha da abertura,
 * ou null quando nao ha nada a dizer.
 */
function gravarNaAbertura(cwd, projeto, env) {
  const e = env || process.env;
  if (e[VARIAVEL]) return null;
  const chave = real(cwd);
  if (chave === null) return null;
  if (!projeto) {
    const topo = git.correr(cwd, ['rev-parse', '--show-toplevel']);
    if (topo === null || real(semQuebra(topo)) !== chave) return null;
  }
  const arquivo = arquivoDosFeitos(e);
  // duas sessoes que abrem juntas leriam a mesma lista e a ultima a gravar apagaria o projeto da outra: em fila
  const pedidos = require('./pedidos.js');
  const trava = arquivo + '.trava';
  let travou;
  try {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    travou = pedidos.travar(trava);
  } catch (erro) {
    return 'sworn: o ponto da compactacao automatica nao gravou: a trava ' + trava + ' nao se cria (' +
      texto.causaDoErro(erro) + '). A proxima abertura de sessao tenta de novo.';
  }
  if (!travou) return null; // outra sessao esta gravando a lista; a abertura seguinte confere de novo
  try { return naLista(arquivo, chave, cwd, projeto); } finally { pedidos.soltar(trava); }
}

/** Grava num arquivo ao lado e troca pelo nome: uma gravacao que falha no meio (disco cheio) deixa o arquivo como
 *  estava, nunca vazio ou pela metade. O do lado sai no erro, que segue para quem chamou. */
function gravarInteiro(arquivo, conteudo) {
  const novo = arquivo + '.novo';
  try {
    fs.writeFileSync(novo, conteudo, 'utf8');
    fs.renameSync(novo, arquivo);
  } catch (erro) {
    try { fs.rmSync(novo, { force: true }); } catch (x) { /* ja foi */ }
    throw erro;
  }
}

/** O resto da gravarNaAbertura, ja com a lista travada: le, confere, grava a lista e o ponto, restaura no erro. */
function naLista(arquivo, chave, cwd, projeto) {
  // lista que nao se le nao se sobrescreve: apagaria o registro dos outros projetos
  const ilegivel = (causa) => 'sworn: a lista dos projetos com o ponto da compactacao automatica nao se le (' + arquivo +
    (causa ? ': ' + causa : '') + '); corrija o JSON ou apague o arquivo, e a proxima sessao confere de novo.';
  let antes = null;
  try { antes = fs.readFileSync(arquivo, 'utf8'); } catch (erro) {
    if (!erro || erro.code !== 'ENOENT') return ilegivel(texto.causaDoErro(erro));
  }
  let feitos = [];
  if (antes !== null) {
    let l;
    try { l = JSON.parse(texto.semBom(antes)).raizes; } catch (erro) { l = null; }
    if (!Array.isArray(l)) return ilegivel('');
    feitos = l;
  }
  if (feitos.indexOf(chave) !== -1) return null;
  const tenta = ' A proxima abertura de sessao tenta de novo.';
  try {
    gravarInteiro(arquivo, JSON.stringify({ raizes: feitos.concat([chave]) }, null, 2) + '\n');
  } catch (erro) {
    return 'sworn: o ponto da compactacao automatica nao gravou: a lista ' + arquivo + ' nao grava (' +
      texto.causaDoErro(erro) + ').' + tenta;
  }
  // link no caminho do arquivo pessoal (um repositorio clonado pode traze-lo): nao se grava por ele, e o aviso sai uma
  // vez so (o projeto ja entrou na lista), para quem liga a pasta .claude de proposito nao ouvi-lo a cada abertura
  if (temLink(cwd)) {
    return 'sworn: o ponto da compactacao automatica nao foi gravado neste projeto: a pasta .claude ou o ' + SETTINGS +
      ' e um link (atalho) que leva para fora do projeto, e o sworn nao grava por ele. Este aviso sai uma vez: para ' +
      'gravar, troque o link por um arquivo comum e tire ' + chave + ' da lista ' + arquivo + '.';
  }
  const limiar = limiarEmVigor(projeto).n;
  const p = gravarNoClaude(cwd, limiar, { manter: true });
  if (p.erro) {
    let depois = tenta;
    try {
      if (antes === null) fs.rmSync(arquivo, { force: true }); else gravarInteiro(arquivo, antes);
    } catch (erro) {
      // a lista ficou com o projeto: a abertura seguinte nao tenta sozinha, e a linha diz como fazer
      depois = ' A lista ' + arquivo + ' ficou com este projeto (' + texto.causaDoErro(erro) + '): tire ' + chave +
        ' de la para a proxima abertura de sessao tentar de novo.';
    }
    return 'sworn: o ponto da compactacao automatica nao gravou: ' + p.erro.replace(/; corrija e rode de novo$/,
      '; corrija o arquivo') + '.' + depois;
  }
  if (!p.gravou) return null;
  return 'sworn: a compactacao automatica deste projeto agora vem logo depois de o sworn gravar o handoff (o texto ' +
    'de continuacao), em ' + limiar + ' tokens de conversa: ' + VARIAVEL + ' = ' + p.valor + ' no env do ' + p.arquivo +
    (p.exclude ? ' (fora do git pela linha ' + p.exclude + ' do .git/info/exclude)' : '') +
    '. Vale a partir da proxima sessao. Para desfazer, apague a chave ' + VARIAVEL + ' desse arquivo: o sworn nao a ' +
    'grava de novo neste projeto.';
}

module.exports = { FOLGA, RESERVA, limiarEmVigor, gravarNoClaude, gravarNoCodex, gravarPontos, gravarNaAbertura, gravarInteiro };
