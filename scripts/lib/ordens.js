'use strict';

/**
 * Plano 091 (D556, D559): as ordens da abertura que fazem um comando do sworn acontecer sozinho, no momento certo.
 * Ordem = texto que o modelo recebe e cumpre no turno (molde saude.instrucaoAoModelo); o que grava algo do dono segue
 * com o sim dele, e a ordem manda perguntar em 3 opcoes. Cada funcao devolve '' quando nao e hora e nunca lanca:
 * nada daqui derruba a abertura. Textos em ASCII (D532): saem por gancho.
 */
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config.js');

const DIA_MS = 24 * 60 * 60 * 1000;
const MARCA_CALIBRAR = 'calibrar-ordem.json';
// O "perguntar de novo em 30 dias" do mock: a ordem do calibrar sai no maximo uma vez nesse intervalo.
const DIAS_ENTRE_ORDENS_DO_CALIBRAR = 30;

function ehObjeto(p) {
  return !!p && typeof p === 'object' && !Array.isArray(p);
}

/** 250000 -> "250 mil". */
function emMil(n) {
  return Math.round(n / 1000) + ' mil';
}

/** A marca ainda vale? Ausente, ilegivel ou no futuro (relogio voltou) = vencida, como a da auditoria. */
function marcaValendo(arquivo, agora, dias) {
  try {
    const t = Date.parse(JSON.parse(fs.readFileSync(arquivo, 'utf8')).ultima);
    return isFinite(t) && t <= agora && agora - t < dias * DIA_MS;
  } catch (e) {
    return false;
  }
}

/** As conversas do projeto, com o mesmo cache diario do botao do calibrar (sessao.js). */
function contarConversas(cwd, agora) {
  const estado = require('./estado.js');
  const pasta = require('./calibracao.js').pastaDasTranscricoes(cwd);
  if (!pasta) return 0;
  return require('./botoes.js').conversasDoProjeto(pasta,
    path.join(path.dirname(estado.caminhoSessao('x')), 'cache', 'calibrar.json'), agora);
}

/**
 * #4: o projeto tem 30+ conversas e nunca calibrou (sem `limiares.tokensDeContexto`): ordem de medir e perguntar.
 * O padrao citado e o que vale hoje: o do modo continuo quando ligado (continuo.js), senao o do saude.js.
 * Efeito no disco: ao devolver a ordem, grava a marca dos 30 dias (MARCA_CALIBRAR), antes de quem chama a imprimir;
 * se a gravacao falhar, o erro e engolido e a ordem sai de novo na abertura seguinte.
 * `opcoes.agora` (ms) e `opcoes.contarConversas` (funcao) existem para o teste.
 */
function ordemDoCalibrar(cwd, projeto, opcoes) {
  try {
    const o = opcoes || {};
    if (!cwd || !ehObjeto(projeto)) return '';
    if (ehObjeto(projeto.limiares) && projeto.limiares.tokensDeContexto !== undefined) return '';
    const agora = typeof o.agora === 'number' && isFinite(o.agora) ? o.agora : Date.now();
    const marca = config.caminhoEmSworn(cwd, MARCA_CALIBRAR);
    if (marcaValendo(marca, agora, DIAS_ENTRE_ORDENS_DO_CALIBRAR)) return '';
    const n = typeof o.contarConversas === 'function' ? o.contarConversas() : contarConversas(cwd, agora);
    if (!(n >= require('./calibracao.js').AMOSTRA_MINIMA.sessoes)) return '';
    const continuo = require('./continuo.js');
    const padrao = continuo.ativo(projeto) ? continuo.TOKENS_CONTEXTO : require('./saude.js').LIMIARES_PADRAO.tokensDeContexto;
    try { fs.writeFileSync(marca, JSON.stringify({ ultima: new Date(agora).toISOString() }) + '\n', 'utf8'); } catch (e) { /* sai de novo na proxima */ }
    return [
      'sworn: ja ha ' + n + ' conversas salvas neste projeto e o limiar de troca de chat',
      'nunca foi calibrado (vale o padrao, ' + emMil(padrao) + ' tokens).',
      'Faca no seu primeiro turno, depois de atender o pedido:',
      '1. Rode /sworn:calibrate (so mede; nao grava).',
      '2. Mostre o limiar sugerido e pergunte pelo AskUserQuestion, em 3 opcoes:',
      '   gravar o sugerido (recomendada), manter o padrao, perguntar de novo em 30 dias.',
      'So grave com o sim.'
    ].join('\n');
  } catch (e) {
    return '';
  }
}

// #7: o "nunca neste projeto" mora fora do projeto (que nao tem .claude/sworn/), na pasta de config do Claude.
const ARQUIVO_INIT_RECUSADO = 'init-recusado.json';

/** <CLAUDE_CONFIG_DIR ou ~/.claude>/sworn/init-recusado.json; a pasta de config vem do gasto.js. */
function arquivoDaRecusa(env) {
  return path.join(path.dirname(require('./gasto.js').pastaDosProjetos(env)), 'sworn', ARQUIVO_INIT_RECUSADO);
}

// atalho: raiz comparada sem maiuscula em todo sistema. limite: pastas que so diferem na caixa (Linux) contam como uma. trocar quando: aparecer projeto no Linux com duas pastas que so diferem na caixa.
// trocar quando: alguem usar o sworn em Linux com duas pastas assim.
function chaveDaRaiz(raiz) {
  return path.resolve(String(raiz)).toLowerCase();
}

/** As raizes recusadas; lista ilegivel ou ausente = nenhuma (fala de novo, nunca cala por engano). */
function recusadas(env) {
  try {
    const l = JSON.parse(fs.readFileSync(arquivoDaRecusa(env), 'utf8')).raizes;
    return Array.isArray(l) ? l.map(chaveDaRaiz) : [];
  } catch (e) {
    return [];
  }
}

/** Grava o "nunca" de `raiz`. Devolve true se ficou gravado (ja estar na lista conta). */
function recusarInit(raiz, env) {
  try {
    const lista = recusadas(env);
    const chave = chaveDaRaiz(raiz);
    if (lista.indexOf(chave) !== -1) return true;
    const arquivo = arquivoDaRecusa(env);
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(arquivo, JSON.stringify({ raizes: lista.concat([chave]) }, null, 2) + '\n', 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * #7: projeto sem .claude/sworn/projeto.json e sem o "nunca" gravado: ordem de perguntar em 3 opcoes e, com o sim,
 * rodar o init. Presente e ilegivel fica calado: a abertura ja tem aviso proprio para isso. `opcoes.comandoNunca` e o
 * comando pronto de gravar o "nunca" (a abertura monta, com o caminho do plugin); `opcoes.env` existe para o teste.
 */
function ordemDoInit(cwd, projeto, opcoes) {
  try {
    const o = opcoes || {};
    if (!cwd || projeto) return '';
    if (fs.existsSync(config.caminhoEmSworn(cwd, 'projeto.json'))) return '';
    if (recusadas(o.env).indexOf(chaveDaRaiz(cwd)) !== -1) return '';
    return [
      'sworn: este projeto ainda nao tem o sworn configurado',
      '(.claude/sworn/projeto.json). Sem ele, os portoes de escopo e de',
      'intocaveis ficam desligados.',
      'No seu primeiro turno, antes de editar qualquer arquivo, pergunte pelo',
      'AskUserQuestion, em 3 opcoes: configurar agora com /sworn:init',
      '(recomendada; 6 perguntas), depois (pergunto na proxima sessao), nunca',
      'neste projeto. Com "agora", rode o /sworn:init na mesma resposta.',
      'Com "nunca", rode: ' + (typeof o.comandoNunca === 'string' && o.comandoNunca
        ? o.comandoNunca : 'node <plugin>/scripts/recusar-init.js <pasta do projeto>')
    ].join('\n');
  } catch (e) {
    return '';
  }
}

/** #6: o motivo do portao do manual (portao-escopo.js, passo 5b), no texto do mock. */
function motivoSemManual(alvo) {
  return [
    'sworn - falta carregar o manual antes de editar arquivo de rigor maximo.',
    '',
    '"' + require('./escopo.js').ascii(alvo) + '" e de marcha AAA neste projeto, e nenhum manual',
    'de execucao (sworn:playbook, ou o manual do projeto) foi carregado nesta sessao.',
    'Faca agora: carregue a skill pela ferramenta Skill e tente a edicao de novo.',
    'Desligar neste projeto: "portaoManual": false em .claude/sworn/projeto.json.'
  ].join('\n');
}

/*
 * Tarefa 6 (mock D559, secao 5): a retroalimentacao. Cada ordem conta "dada", "cumprida" (a skill pedida rodou depois,
 * na mesma sessao, pelo agente principal) e "recusada pelo dono" nos contadores do TURNO (`s.contadores`), que o fecho
 * descarrega em .claude/sworn/contadores.json. Familia propria `ordem_<tipo>_<fase>`, fora dos baldes das travas:
 * a chave e montada numa variavel, e o leitor de baldes (test/auxiliar-baldes.js) so ve nome literal.
 * "Dada" conta uma vez por pendencia (`s.ordensPendentes`, campo da sessao): o commit negado de novo e a mesma ordem.
 * Recusa so tem sinal no commit (a marca sem-revisao); nas outras, a auditoria mostra "-".
 */
const TIPOS_DE_ORDEM = ['aprender', 'auditar', 'calibrar', 'init', 'revisar', 'manual'];
// A skill que cumpre cada ordem: o tipo fica em portugues (e a chave guardada no contadores.json), a skill e o
// comando. O manual e qualquer skill com "padrao" no nome (a do projeto) ou o playbook do plugin.
const SKILL_DA_ORDEM = { aprender: 'learn', auditar: 'audit', calibrar: 'calibrate', init: 'init', revisar: 'review' };
const MANUAL = /padrao|^(sworn:)?playbook$/i;
const FASES = ['dada', 'cumprida', 'recusada'];
const ROTULO = { revisar: 'revisar antes do commit' };
const RECUSA_MEDIDA = ['revisar'];
const NOTA_DA_RECUSA = '  (-: o sworn nao ve essa recusa; dada e nao cumprida foi ignorada ou recusada na conversa)';

function chaveDaOrdem(tipo, fase) {
  return 'ordem_' + tipo + '_' + fase;
}

function somar(s, tipo, fase) {
  if (!ehObjeto(s.contadores)) s.contadores = {};
  const chave = chaveDaOrdem(tipo, fase);
  s.contadores[chave] = (s.contadores[chave] || 0) + 1;
}

function pendentes(s) {
  if (!Array.isArray(s.ordensPendentes)) s.ordensPendentes = [];
  return s.ordensPendentes;
}

// As tres funcoes recebem o estado de dentro de um estado.alterar, somam em `s.contadores` e devolvem a lista pendente
// nova; o script a grava (`s.ordensPendentes = ordens.marcarDada(s, ...)`), para o leitor de campos do estado
// (portao-fecho.test) ver quem grava o campo, como no `revisadosAprovados`.

/** A ordem `tipo` foi dada. Conta so se ela ainda nao estava pendente. */
function marcarDada(s, tipo) {
  if (!ehObjeto(s)) return [];
  const lista = pendentes(s);
  if (TIPOS_DE_ORDEM.indexOf(tipo) === -1 || lista.indexOf(tipo) !== -1) return lista;
  lista.push(tipo);
  somar(s, tipo, 'dada');
  return lista;
}

/** A skill `nome` rodou: cumpre as ordens pendentes dela (SKILL_DA_ORDEM; o manual pelo MANUAL). */
function marcarCumprida(s, nome) {
  if (!ehObjeto(s)) return [];
  if (typeof nome !== 'string') return pendentes(s);
  s.ordensPendentes = pendentes(s).filter(function (tipo) {
    const skill = SKILL_DA_ORDEM[tipo];
    const cumpre = tipo === 'manual' ? MANUAL.test(nome) : (nome === tipo || nome === skill || nome === 'sworn:' + skill);
    if (cumpre) somar(s, tipo, 'cumprida');
    return !cumpre;
  });
  return s.ordensPendentes;
}

/** O dono recusou a ordem `tipo` pendente. Sem ordem pendente nao conta. */
function marcarRecusada(s, tipo) {
  if (!ehObjeto(s)) return [];
  const lista = pendentes(s);
  if (lista.indexOf(tipo) === -1) return lista;
  s.ordensPendentes = lista.filter(function (t) { return t !== tipo; });
  somar(s, tipo, 'recusada');
  return s.ordensPendentes;
}

/** As chaves de ordem do contadores.json do projeto, so as numericas. Ausente ou torto = {}. */
function totaisDasOrdens(cwd) {
  const saida = {};
  try {
    const dados = JSON.parse(require('./texto.js').semBom(fs.readFileSync(config.caminhoEmSworn(cwd, 'contadores.json'), 'utf8')));
    if (!ehObjeto(dados)) return saida;
    for (const tipo of TIPOS_DE_ORDEM) {
      for (const fase of FASES) {
        const v = dados[chaveDaOrdem(tipo, fase)];
        if (typeof v === 'number' && isFinite(v)) saida[chaveDaOrdem(tipo, fase)] = v;
      }
    }
  } catch (e) { /* sem contadores: nada disparou ainda */ }
  return saida;
}

/**
 * As linhas da auditoria: o que disparou entre a foto `antes` e os totais `agora`, em `dias` (null = sem foto, desde o
 * comeco). Total menor que a foto (arquivo recomecado) vale o total inteiro. Nada disparado = [] (a auditoria cala).
 */
function linhasDasOrdens(antes, agora, dias) {
  const a = ehObjeto(antes) ? antes : {};
  const d = ehObjeto(agora) ? agora : {};
  const num = function (o, k) { return typeof o[k] === 'number' && isFinite(o[k]) && o[k] > 0 ? o[k] : 0; };
  const delta = function (k) { const n = num(d, k); const v = num(a, k); return n >= v ? n - v : n; };
  const usadas = [];
  const nunca = [];
  let semRecusa = false;
  for (const tipo of TIPOS_DE_ORDEM) {
    const dada = delta(chaveDaOrdem(tipo, 'dada'));
    const cumprida = delta(chaveDaOrdem(tipo, 'cumprida'));
    const recusada = delta(chaveDaOrdem(tipo, 'recusada'));
    if (!dada && !cumprida && !recusada) { nunca.push(tipo); continue; }
    const mede = RECUSA_MEDIDA.indexOf(tipo) !== -1;
    if (!mede) semRecusa = true;
    usadas.push((ROTULO[tipo] || tipo) + ' ' + dada + '/' + cumprida + '/' + (mede ? recusada : '-'));
  }
  if (!usadas.length) return [];
  const janela = typeof dias === 'number' && isFinite(dias)
    ? (Math.max(1, Math.floor(dias)) === 1 ? 'do ultimo dia' : 'dos ultimos ' + Math.floor(dias) + ' dias')
    : 'desde o comeco';
  const linhas = ['- ordens ' + janela + ' (dadas / cumpridas / recusadas pelo dono):', '  ' + usadas.join('; ')];
  if (nunca.length) linhas.push('  nunca disparadas: ' + nunca.join(', '));
  if (semRecusa) linhas.push(NOTA_DA_RECUSA);
  return linhas;
}

module.exports = { MARCA_CALIBRAR, DIAS_ENTRE_ORDENS_DO_CALIBRAR, ARQUIVO_INIT_RECUSADO, ordemDoCalibrar, ordemDoInit,
  recusarInit, motivoSemManual, TIPOS_DE_ORDEM, ROTULO, MANUAL, chaveDaOrdem, marcarDada, marcarCumprida, marcarRecusada,
  totaisDasOrdens, linhasDasOrdens };
