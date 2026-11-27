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
const { ehObjeto } = require('./texto.js');

const DIA_MS = 24 * 60 * 60 * 1000;
const MARCA_CALIBRAR = 'calibrar-ordem.json';
// O "perguntar de novo em 30 dias" do mock: a ordem do calibrar sai no maximo uma vez nesse intervalo.
const DIAS_ENTRE_ORDENS_DO_CALIBRAR = 30;

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

/** O gancho roda pela ponte (scripts/ponte.js poe SWORN_PONTE=1): fora do Claude Code, sem a ferramenta Skill. */
function naPonte() {
  return process.env.SWORN_PONTE === '1';
}

/**
 * Como carregar a skill `nome` do sworn. No Claude Code, pela ferramenta Skill. Pela ponte, lendo o SKILL.md inteiro,
 * que a ponte conta como carregar (harness.js): a copia do dsh e do OpenCode fica em .agents/skills/sworn-<nome>/ do
 * projeto; a do Codex, do Qwen e do agy, em skills/<nome>/ da pasta do sworn. Sem caminho absoluto: o texto e ASCII.
 */
function comoCarregar(nome) {
  if (!naPonte()) return 'carregue pela ferramenta Skill o sworn:' + nome;
  return 'leia inteiro o SKILL.md da skill ' + nome + ' do sworn (.agents/skills/sworn-' + nome +
    '/SKILL.md no projeto, ou skills/' + nome + '/SKILL.md na pasta do sworn)';
}

/** #6: o motivo do portao do manual (portao-escopo.js, passo 5b), no texto do mock. */
function motivoSemManual(alvo) {
  // A5-38 (D735): a skill nomeada, a mesma que o MANUAL aceita.
  const faca = naPonte()
    ? ['Faca agora: ' + comoCarregar('playbook') + ',',
      'ou o SKILL.md da skill do projeto com "padrao" no nome, e tente a edicao de novo.']
    : ['Faca agora: carregue pela ferramenta Skill o sworn:playbook (ou a skill do projeto com "padrao" no nome) e tente',
      'a edicao de novo.'];
  return [
    'sworn - falta carregar o manual de execucao antes de editar este arquivo.',
    '',
    // A5-65: o nivel dito pelo que e, sem o nome da marcha.
    '"' + require('./escopo.js').ascii(alvo) + '" pede neste projeto o nivel de rigor mais alto que o projeto.json' +
      ' da a um caminho,',
    'e nenhum manual de execucao foi carregado nesta sessao.'
  ].concat(faca, [
    'So o dono desliga neste projeto: "portaoManual": false em .claude/sworn/projeto.json.'
  ]).join('\n');
}

/*
 * Tarefa 6 (mock D559, secao 5): a retroalimentacao. Cada ordem conta "dada", "cumprida" (a skill pedida rodou depois,
 * na mesma sessao, pelo agente principal) e "recusada pelo dono" nos contadores do TURNO (`s.contadores`), que o fecho
 * descarrega em .claude/sworn/contadores.json. Familia propria `ordem_<tipo>_<fase>`, fora dos baldes das travas:
 * a chave e montada numa variavel, e o leitor de baldes (test/auxiliar-baldes.js) so ve nome literal.
 * "Dada" conta uma vez por pendencia (`s.ordensPendentes`, campo da sessao): o commit negado de novo e a mesma ordem.
 * Recusa so tem sinal no commit (a marca sem-revisao); nas outras, a auditoria mostra "-".
 */
// G4a (D928): as 7 ultimas sao as rotas do roteador.js (tela, plano, etapa fechada, "por que deu errado", AAA, G4h,
// o defeito, e G4i, o teste).
const TIPOS_DE_ORDEM = ['aprender', 'auditar', 'calibrar', 'init', 'revisar', 'manual',
  'tela', 'plano', 'etapa', 'diagnosticar', 'aaa', 'bug', 'teste'];
// A skill que cumpre cada ordem: o tipo fica em portugues (e a chave guardada no contadores.json), a skill e o
// comando. O manual e qualquer skill com "padrao" no nome (a do projeto) ou o playbook do plugin. A tela pede a design
// (G4c), o roteiro de construir a tela; o manual cumpre so a ordem do manual.
const SKILL_DA_ORDEM = { aprender: 'learn', auditar: 'audit', calibrar: 'calibrate', init: 'init', revisar: 'review',
  tela: 'design', plano: 'review-plan', etapa: 'drift', diagnosticar: 'diagnose', aaa: 'effort-high' };
const MANUAL = /padrao|^(sworn:)?playbook$/i;
const PLAYBOOK = /^(sworn:)?playbook$/i;
const FASES = ['dada', 'cumprida', 'recusada'];
const ROTULO = { revisar: 'revisar antes do commit', tela: 'design da tela', plano: 'revisar o plano',
  etapa: 'conferir a etapa com o plano', diagnosticar: 'diagnosticar a sessao', aaa: 'esforco alto',
  bug: 'reproduzir o defeito', teste: 'teste vermelho primeiro' };
// G4h e G4i: as ordens que nenhuma skill cumpre: so o teste visto vermelho (recibo-da-prova.js), o defeito reproduzido
// ou o teste novo falhando primeiro. Uma skill que as cumprisse as calaria cedo: o playbook entra no comeco da tarefa,
// antes de qualquer teste.
const CUMPRE_O_VERMELHO = ['bug', 'teste'];
const RECUSA_MEDIDA = ['revisar'];
// A5-37 (D735): o que o "-" esconde e o passo.
const NOTA_DA_RECUSA = [
  '  ("-": o sworn so ve a recusa no commit sem revisao; nas outras, a ordem que o Claude nao cumpriu foi ignorada ou',
  '  recusada na conversa. Ordem que se repete sem cumprir: o sworn segue cobrando; o dono decide se ela fica.)'
];

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

/** A skill `nome` cumpre a ordem `tipo`: a de SKILL_DA_ORDEM (com ou sem o "sworn:"); o manual, pelo MANUAL. */
function skillCumpre(tipo, nome) {
  if (typeof nome !== 'string' || CUMPRE_O_VERMELHO.indexOf(tipo) !== -1) return false;
  if (tipo === 'manual') return MANUAL.test(nome);
  const skill = SKILL_DA_ORDEM[tipo];
  return nome === tipo || (!!skill && (nome === skill || nome === 'sworn:' + skill));
}

// Tira das pendentes as que `cumpre(tipo)` aceita, cada uma contada "cumprida".
function cumprirSe(s, cumpre) {
  s.ordensPendentes = pendentes(s).filter(function (tipo) {
    const sim = cumpre(tipo);
    if (sim) somar(s, tipo, 'cumprida');
    return !sim;
  });
  return s.ordensPendentes;
}

/** A skill `nome` rodou: cumpre as ordens pendentes dela (skillCumpre). */
function marcarCumprida(s, nome) {
  if (!ehObjeto(s)) return [];
  if (typeof nome !== 'string') return pendentes(s);
  return cumprirSe(s, function (tipo) { return skillCumpre(tipo, nome); });
}

/** G4h e G4i: um teste rodou e falhou (o vermelho de verdade do recibo-da-prova.js): cumpre as de CUMPRE_O_VERMELHO. */
function vermelhoVisto(s) {
  if (!ehObjeto(s)) return [];
  return cumprirSe(s, function (tipo) { return CUMPRE_O_VERMELHO.indexOf(tipo) !== -1; });
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

/*
 * G4d (D928): o uso de cada skill. Toda skill do sworn que o agente principal carrega conta `uso_skill_<nome>` nos
 * contadores do turno; a skill do projeto com "padrao" no nome (a que faz as vezes do manual) conta
 * `uso_skill_manual_do_projeto`. O resto nao conta: o nome de skill de outro plugin nao e do sworn medir.
 */
const PREFIXO_USO = 'uso_skill_';
const USO_DO_MANUAL = 'manual_do_projeto';
const CHAVE_DE_USO = /^uso_skill_[a-z0-9_-]+$/;
let skillsEmCache = null;

/** As skills do plugin: as pastas de skills/ com SKILL.md, em ordem. Sem a pasta = []. */
function skillsDoPlugin() {
  if (skillsEmCache) return skillsEmCache.slice();
  const pasta = path.join(__dirname, '..', '..', 'skills');
  try {
    skillsEmCache = fs.readdirSync(pasta).filter(function (n) {
      return /^[a-z0-9-]+$/.test(n) && fs.existsSync(path.join(pasta, n, 'SKILL.md'));
    }).sort();
    return skillsEmCache.slice();
  } catch (e) { return []; } // sem a pasta, nada a medir; o erro nao fica em cache, a proxima chamada le de novo
}

function chaveDoUso(nome) {
  if (typeof nome !== 'string') return null;
  const m = /^sworn:([a-z0-9-]+)$/.exec(nome);
  if (m) return skillsDoPlugin().indexOf(m[1]) !== -1 ? m[1] : null;
  // a skill do projeto vem sem prefixo; a de outro plugin ("outro:padrao-x") nao e o manual do projeto
  return nome.indexOf(':') === -1 && MANUAL.test(nome) && !PLAYBOOK.test(nome) ? USO_DO_MANUAL : null;
}

/** A skill `nome` entrou: soma o uso dela e devolve os contadores; o que nao se mede devolve null e nao toca no estado. */
function marcarUso(s, nome) {
  if (!ehObjeto(s)) return null;
  const chave = chaveDoUso(nome);
  if (!chave) return null;
  if (!ehObjeto(s.contadores)) s.contadores = {};
  const k = PREFIXO_USO + chave;
  s.contadores[k] = (s.contadores[k] || 0) + 1;
  return s.contadores;
}

/** As chaves de ordem e de uso (G4d) do contadores.json do projeto, so as numericas. Ausente ou torto = {}. */
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
    for (const chave of Object.keys(dados)) {
      const v = dados[chave];
      if (CHAVE_DE_USO.test(chave) && typeof v === 'number' && isFinite(v)) saida[chave] = v;
    }
  } catch (e) { /* sem contadores: nada disparou ainda */ }
  return saida;
}

// A janela da auditoria: `dias` desde a ultima (null = sem foto, desde o comeco). `de` e a preposicao ("do"/"no").
function janelaDe(dias, de) {
  if (typeof dias !== 'number' || !isFinite(dias)) return 'desde o comeco';
  const n = Math.max(1, Math.floor(dias));
  return n === 1 ? de + ' ultimo dia' : de + 's ultimos ' + n + ' dias';
}

function deltaEntre(antes, agora) {
  const a = ehObjeto(antes) ? antes : {};
  const d = ehObjeto(agora) ? agora : {};
  const num = function (o, k) { return typeof o[k] === 'number' && isFinite(o[k]) && o[k] > 0 ? o[k] : 0; };
  return function (k) { const n = num(d, k); const v = num(a, k); return n >= v ? n - v : n; };
}

/**
 * As linhas da auditoria: o que disparou entre a foto `antes` e os totais `agora`, em `dias` (null = sem foto, desde o
 * comeco). Total menor que a foto (arquivo recomecado) vale o total inteiro. Nada disparado = [] (a auditoria cala).
 */
function linhasDasOrdens(antes, agora, dias) {
  const delta = deltaEntre(antes, agora);
  const usadas = [];
  const nunca = [];
  let semRecusa = false;
  for (const tipo of TIPOS_DE_ORDEM) {
    const dada = delta(chaveDaOrdem(tipo, 'dada'));
    const cumprida = delta(chaveDaOrdem(tipo, 'cumprida'));
    const recusada = delta(chaveDaOrdem(tipo, 'recusada'));
    if (!dada && !cumprida && !recusada) { nunca.push(ROTULO[tipo] || tipo); continue; }
    const mede = RECUSA_MEDIDA.indexOf(tipo) !== -1;
    if (!mede) semRecusa = true;
    usadas.push((ROTULO[tipo] || tipo) + ' ' + dada + '/' + cumprida + '/' + (mede ? recusada : '-'));
  }
  if (!usadas.length) return [];
  const linhas = ['- ordens ' + janelaDe(dias, 'do') + ' que o sworn deu ao Claude (dadas / cumpridas / recusadas pelo dono):',
    '  ' + usadas.join('; ')];
  if (nunca.length) linhas.push('  nunca disparadas: ' + nunca.join(', '));
  return semRecusa ? linhas.concat(NOTA_DA_RECUSA) : linhas;
}

function vezes(n) { return n + (n === 1 ? ' vez' : ' vezes'); }

/**
 * G4d: as linhas do uso das skills na auditoria, entre a foto `antes` e os totais `agora`: as do sworn que o Claude
 * chamou (mais chamada primeiro), as nunca chamadas e a skill do projeto que faz as vezes do manual. Sem contador de
 * uso nenhum, ou nada chamado na janela = [] (a auditoria cala).
 */
function linhasDoUso(antes, agora, dias) {
  const delta = deltaEntre(antes, agora);
  const skills = skillsDoPlugin();
  const chamadas = [];
  const nunca = [];
  for (const nome of skills) {
    const n = delta(PREFIXO_USO + nome);
    if (n) chamadas.push({ nome: nome, n: n }); else nunca.push(nome);
  }
  const manual = delta(PREFIXO_USO + USO_DO_MANUAL);
  if (!chamadas.length && !manual) return [];
  chamadas.sort(function (x, y) { return y.n - x.n || (x.nome < y.nome ? -1 : 1); });
  const linhas = ['- skills do sworn que o Claude chamou ' + janelaDe(dias, 'no') + ': ' +
    (chamadas.length ? chamadas.map(function (c) { return c.nome + ' ' + c.n; }).join(', ') : 'nenhuma')];
  if (nunca.length) linhas.push('  nunca chamadas: ' + nunca.join(', '));
  if (manual) {
    const playbook = delta(PREFIXO_USO + 'playbook');
    linhas.push('  a skill do projeto com "padrao" no nome foi chamada ' + vezes(manual) + '; o sworn:playbook, ' +
      vezes(playbook) + '. A do projeto cumpre so a ordem do manual: na edicao de tela, o sworn ainda pede o sworn:design.');
  }
  if (nunca.length) {
    linhas.push('  Skill do sworn nunca chamada e assunto do sworn, nao deste projeto: ou ele nao a ofereceu na hora ' +
      'certa, ou o projeto nao precisou dela. Diga isso ao dono numa linha, sem pedir decisao.');
  }
  return linhas;
}

module.exports = {
  ARQUIVO_INIT_RECUSADO, ordemDoCalibrar, ordemDoInit, recusarInit, naPonte, comoCarregar, motivoSemManual,
  TIPOS_DE_ORDEM, SKILL_DA_ORDEM, CUMPRE_O_VERMELHO,
  ROTULO, MANUAL, chaveDaOrdem, skillCumpre, marcarDada, marcarCumprida, vermelhoVisto, marcarRecusada, skillsDoPlugin, marcarUso,
  totaisDasOrdens, linhasDasOrdens, linhasDoUso, arquivoDaRecusa
};
