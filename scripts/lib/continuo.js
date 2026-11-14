'use strict';

/**
 * D466/D467/D468 (0.7.0): menos paradas. A abertura injeta este bloco em toda sessao, no molde do de
 * paralelismo (paralelismo.js). Ligado por padrao (D467): validar pelo proprio agente antes de pedir acao
 * manual ao dono. Sob a chave `modoContinuo` (ligada por padrao desde a 0.9.0, plano 091; so o booleano false desliga):
 * os gatilhos de CALADOS nao pedem troca de chat (saude.js le a mesma lista) e o agente decide sozinho o
 * tecnico. ASCII puro: sai por hook.
 */
const CHAVE = 'modoContinuo';
const TETO = 1100;

// D468: o que a chave cala. Seguem disparando o tamanho (tokensDeContexto), o alarme e os bloqueios.
const CALADOS = ['revisoesFechadas', 'decisoesDoDono', 'commits', 'turnosComTrabalho', 'arquivosTocados'];

// D493 (0.7.4): com a chave, o aviso de tamanho sai a 250K em vez do padrao de 175K (D475); o limiar que o
// projeto gravou em limiares.tokensDeContexto continua mandando (saude.medir). O alarme nao muda.
const TOKENS_CONTEXTO = 250000;

const TITULO = '# sworn - menos paradas (toda sessao)';
const VALIDAR = '1. Antes de pedir acao manual ao dono, valide voce mesmo: rode o teste, abra o navegador (Claude in Chrome ou CDP), leia o resultado. Peca so o que so ele pode: credencial, publicar ou implantar, tela com dado de cliente no login dele; e junte tudo num pedido so.';

// "250 mil" quando redondo; senao o numero. Number() converte como o >= do medidor (null vira 0, texto
// sem numero vira NaN): o texto sai sempre ASCII.
function mil(n) {
  const v = Number(n);
  return Number.isFinite(v) && v % 1000 === 0 ? (v / 1000) + ' mil' : String(v);
}

// Os numeros que o medidor usa: o aviso como saude.medir (o do projeto, se numero positivo; senao o do modo
// continuo) e o alarme como saude.avaliar (o do projeto, se numero positivo; senao o padrao; D495).
// saude.js requer este arquivo no topo, por isso o require aqui dentro.
function tamanho(projeto) {
  const saude = require('./saude.js');
  const L = saude.limiaresValidos(projeto && typeof projeto === 'object' ? projeto.limiares : undefined);
  const aviso = 'tokensDeContexto' in L ? L.tokensDeContexto : TOKENS_CONTEXTO;
  const alarme = Object.assign({}, saude.LIMIARES_PADRAO, L).tokensAlarme;
  return '(aviso a ' + mil(aviso) + ', alarme a ' + mil(alarme) + ')';
}

const LIGADO = [
  '2. Modo continuo ligado: so o tamanho da conversa %TAMANHO% e os bloqueios de portao pedem troca de chat; revisoes, decisoes, commits, turnos e arquivos nao encerram a sessao.',
  '3. Releia o trecho do plano no arquivo antes de cada subitem.',
  // D785 item 6 (s369, 2.6): a lista do que se pergunta encolhe; o resto o agente faz sozinho.
  '4. Escolha tecnica: decida e registre: "Decisao: <o que> - por que: <motivo> - custo se errado: <o que quebra>". Ao dono so regra de negocio, aparencia (com opcoes), irreversivel (publicar, push, envio) e credencial, permissao ou seguranca; custo dentro do pedido nao se pergunta. Falha e conserto: sem perguntar.',
  // s369 (A6, P1 do dono): a regra que o portao do fecho cobra (paradaSemDono), dita antes, em toda sessao.
  '5. Nao feche o turno anunciando o proximo passo: faca-o ja. Parar so com a linha "Preciso do dono: <o que>" ou "Espero: <o que roda>".'
];

/** A chave ligada? Plano 091 (#9, D556/D559): ligada por padrao, com ou sem projeto.json; so o booleano false
 *  desliga (D388/D415): "false" entre aspas nao desliga. */
function ativo(projeto) {
  const objeto = !!projeto && typeof projeto === 'object' && !Array.isArray(projeto);
  return !(objeto && projeto[CHAVE] === false);
}

/** O bloco da abertura: sempre a regra de validar; com a chave, as do modo continuo. */
function bloco(projeto) {
  const ligado = ativo(projeto);
  return [TITULO, '', VALIDAR]
    .concat(ligado ? [LIGADO[0].replace('%TAMANHO%', tamanho(projeto))].concat(LIGADO.slice(1)) : [])
    .concat(['', ligado
      ? 'Desligar o modo continuo: "' + CHAVE + '": false em .claude/sworn/projeto.json.'
      : 'Modo continuo (troca de chat so por tamanho, decisao tecnica sem parar): "' + CHAVE + '": true em .claude/sworn/projeto.json.'])
    .join('\n') + '\n';
}

/**
 * B3 (s369, R-dsh): as 4 classes da D785 em que o pedido ao dono cabe, na ordem em que se conferem (o pedido que cita
 * a credencial de um envio e da credencial). Fora delas, null: a pergunta que o laco devia ter decidido sozinho.
 */
const CLASSES_DA_PERGUNTA = [
  ['credencial', /\b(?:credencia\w*|senhas?|tokens?|chaves?|api[ -]?key|permiss(?:[aã]o|[oõ]es|ions?)|seguran[cç]a|acesso|credentials?|passwords?|security)\b/i],
  ['externo', /\b(?:publica\w*|push|empurr\w*|envi\w*|e-?mail|deploy\w*|release|irrevers[ií]ve\w*|extern\w*|publish\w*|send\w*)\b/i],
  ['aparencia', /\b(?:apar[eê]ncia|visua\w*|design|cor(?:es)?|layout|appearance|look)\b/i],
  ['regra_de_negocio', /\b(?:regras? de neg[oó]cio|business rules?|decis[aã]o de produto|product decision)\b/i]
];
function classeDaPergunta(texto) {
  const t = String(texto || '');
  const achada = CLASSES_DA_PERGUNTA.filter(function (c) { return c[1].test(t); })[0];
  return achada ? achada[0] : null;
}

/**
 * B3 (s369, R-dsh): o estado tipado do fecho. Pela ordem: o pedido ao dono (bloqueado), a espera declarada ou a prova
 * em segundo plano (esperando), a falha mostrada ou o ultimo teste vermelho (falhou) e o pronto com evidencia e sem
 * prova pendente (pronto: a mesma conta da trava 3). Fora disso, null. `teste` e o que o saude.testesDoTranscript le.
 */
function estadoDoFecho(entrada) {
  const o = entrada || {};
  const t = o.teste || {};
  if (o.pedeDono) return 'bloqueado';
  if (o.espera || t.provaRodando === true) return 'esperando';
  if (o.mostraFalha || (t.ultimoTeste && t.ultimoTeste.falhou === true)) return 'falhou';
  if (o.alegaSucesso && o.comEvidencia && t.provaPendente !== true) return 'pronto';
  return null;
}

/** O texto corrido da resposta: sem bloco de codigo cercado, sem codigo em linha e sem citacao ("> ..."). O que esta
 *  colado ou citado nao e o que a resposta declara. */
function textoCorrido(msg) {
  return String(msg || '').replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\1[ \t]*$|(?![\s\S]))/gm, '')
    .replace(/`[^`\n]*`/g, ' ').replace(/^[ \t]*>.*$/gm, '');
}

/**
 * B4 (s369, R-superpowers): as decisoes autonomas que a resposta registra, uma por linha "Decisao: ..." do texto
 * corrido; cada uma vira true quando traz o "custo se errado: <algo>" (o registro inteiro) e false quando nao.
 */
// o negrito do markdown vale dos dois lados ("**Decisao**:"); o molde copiado sem preencher ("<o que quebra>") nao e o
// custo se errado
const DECISAO = /^[ \t*_-]*decis[aã]o[*_]*[ \t]*:(.*)$/gim;
function decisoesDaResposta(msg) {
  return Array.from(textoCorrido(msg).matchAll(DECISAO), function (m) {
    return /custo se errado[*_]*[ \t]*:[ \t]*[^\s<]/i.test(m[1]);
  });
}

module.exports = {
  CHAVE, TETO, CALADOS, TOKENS_CONTEXTO, ativo, bloco, classeDaPergunta, estadoDoFecho, textoCorrido,
  decisoesDaResposta
};
