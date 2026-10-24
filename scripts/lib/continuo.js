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
  '4. Escolha tecnica dentro do escopo: decida, registre o motivo e liste no fecho. Pergunte ao dono so o irreversivel, o externo (publicar, push, envio), credencial, permissao ou seguranca, o de custo e o de produto.'
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

module.exports = { CHAVE, TETO, CALADOS, TOKENS_CONTEXTO, ativo, bloco };
