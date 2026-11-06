'use strict';
const fs = require('node:fs');
const path = require('node:path');
const texto = require('./texto.js');
const continuo = require('./continuo.js');
const { LIMIARES_PADRAO, limiaresValidos } = require('./saude.js');

/**
 * D786 passo 1: o ponto da compactacao automatica do harness fica logo depois do gatilho de contexto do sworn, para o
 * handoff gravado no gatilho ser relido depois da compactacao e o trabalho seguir na mesma sessao. Um gravador so,
 * chamado pelo calibrar.js (--ponto no /sworn:init; --gravar e --manter, que mudam o limiar) e pelo instalar.js codex.
 * - Claude Code: `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW` no `.claude/settings.local.json` (pessoal, fora do git; a sonda
 *   3 da s331 mediu que o env de la vale). Faixa da documentacao: 100000 a 1000000.
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

function gravarNoClaude(raiz, limiar) {
  const valor = Math.min(JANELA.max, Math.max(JANELA.min, ponto(limiar) + RESERVA));
  const r = { harness: 'claude', arquivo: SETTINGS, chave: 'env.' + VARIAVEL, valor };
  const falha = (erro) => Object.assign(r, { gravou: false, erro: erro });
  const arq = path.join(raiz, '.claude', 'settings.local.json');
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
  if (antes === String(valor)) return Object.assign(r, { gravou: false });
  obj.env = Object.assign({}, obj.env, { [VARIAVEL]: String(valor) });
  try {
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    fs.writeFileSync(arq, JSON.stringify(obj, null, 2) + '\n');
  } catch (e) {
    return falha('nao consegui gravar ' + SETTINGS + ' (' + texto.causaDoErro(e) + '); confira se a pasta .claude ' +
      'aceita gravacao e rode de novo');
  }
  return Object.assign(r, { gravou: true }, antes !== undefined ? { antes: antes } : {});
}

// atalho: o topo do TOML sao as linhas antes do 1o cabecalho [tabela]; a chave nova entra na 1a linha, que e sempre
// topo. limite: uma string de varias linhas com "[" no comeco de linha antes da chave confunde a busca.
// trocar quando: o plugin tiver um leitor de TOML.
function gravarNoCodex(raiz, limiar) {
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
function gravarPontos(raiz, limiar) {
  const codex = fs.existsSync(path.join(raiz, '.claude', 'sworn', 'ligado', 'codex', 'instalado.json'));
  return [gravarNoClaude(raiz, limiar)].concat(codex ? [gravarNoCodex(raiz, limiar)] : []);
}

module.exports = { FOLGA, RESERVA, limiarEmVigor, gravarNoClaude, gravarNoCodex, gravarPontos };
