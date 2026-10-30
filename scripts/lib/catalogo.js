'use strict';
const fs = require('node:fs');
const path = require('node:path');
const texto = require('./texto.js');

/**
 * O cache da consulta ao catalogo de modelos, e o limite de frequencia dela.
 *
 * ESTE MODULO NAO ABRE CONEXAO. Decisao 14 do dono: quem vai a internet e a
 * SKILL, no agente principal; o plugin nunca abre rede em hook nenhum. Aqui so
 * se decide SE e hora de consultar, e se guarda o que a skill trouxe.
 *
 * Nao confundir com `scripts/lib/busca.js`, que e outra coisa por completo: o
 * portao C9, "procurar antes de criar arquivo".
 *
 * O arquivo mora em `.claude/sworn/catalogo.json`, no projeto da pessoa -
 * nomes de modelo e preco sao RESULTADO, e resultado nasce no projeto, nunca no
 * plugin (spec 3 e 4).
 */

const ARQUIVO = ['.claude', 'sworn', 'catalogo.json'];

/** Debounce: sem isto, o detector acusando a cada despacho mandaria consultar
 *  a cada despacho - lento, caro, e o dono desliga em uma semana (spec 6). */
const JANELA_DIAS = 7;
const DIA = 24 * 60 * 60 * 1000;

/** Os tres desfechos possiveis de uma consulta. So `ok` consome a janela. */
const DESFECHOS = ['ok', 'semRede', 'falhou'];

/** Quem mandou consultar. Os dois deliberados ignoram a janela: quando o dono
 *  pede, ou quando o plugin acabou de mudar, esperar dias seria absurdo. */
const DELIBERADOS = ['pedido', 'instalacao'];

function caminho(cwd) {
  return path.join(String(cwd), ARQUIVO[0], ARQUIVO[1], ARQUIVO[2]);
}

function ler(cwd) {
  try {
    const obj = JSON.parse(texto.semBom(fs.readFileSync(caminho(cwd), 'utf8')));
    return valido(obj) ? obj : null;
  } catch (e) {
    return null;
  }
}

/**
 * Arquivo no disco e arquivo que pode estar corrompido, truncado ou editado a
 * mao. Cache invalido vale o mesmo que cache ausente - e consultar de novo e
 * barato perto de decidir por dado estragado.
 */
function valido(c, agora) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
  if (typeof c.consultadoEm !== 'number' || !isFinite(c.consultadoEm)) return false;
  // F1-C02: data no futuro daria idade negativa e seguraria a janela para sempre. Ate 1 dia
  // de folga cobre relogio desencontrado; alem disso o cache nao merece confianca.
  const ref = agora === undefined ? Date.now() : Number(agora);
  if (c.consultadoEm > ref + DIA) return false;
  if (DESFECHOS.indexOf(c.desfecho) === -1) return false;
  if (!Array.isArray(c.fontes)) return false;
  return true;
}

function gravar(cwd, cache) {
  const alvo = caminho(cwd);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, JSON.stringify(cache, null, 2) + '\n', 'utf8');
  return alvo;
}

/**
 * Monta o registro de uma consulta que a SKILL acabou de fazer.
 * `achados` e dado bruto do que ela leu - nunca configuracao. Regra 2 da spec:
 * resultado de consulta se mostra ao dono como evidencia citada, jamais se
 * grava direto na configuracao. Por isso isto vai para catalogo.json, que
 * ninguem le para decidir nada, e nunca para projeto.json.
 */
function registrar(desfecho, achados, fontes, agora) {
  return {
    consultadoEm: Number(agora),
    desfecho: DESFECHOS.indexOf(desfecho) === -1 ? 'falhou' : desfecho,
    fontes: Array.isArray(fontes) ? fontes.slice() : [],
    achados: Array.isArray(achados) ? achados.slice() : []
  };
}

function idadeEmDias(cache, agora) {
  if (!valido(cache, agora)) return null;
  return (Number(agora) - cache.consultadoEm) / DIA;
}

/**
 * E hora de consultar?
 *
 * A regra que custou pensar: consulta que FALHOU nao consome a janela. Se
 * consumisse, uma queda de rede de um minuto calaria a conferencia por uma
 * semana inteira - e calaria em silencio, que e a falha que este plugin existe
 * para nao ter. So `ok` faz o relogio comecar a contar.
 */
function deveConsultar(cache, motivo, agora) {
  if (DELIBERADOS.indexOf(motivo) !== -1) {
    return { sim: true, porque: 'consulta deliberada (' + motivo + '): a janela nao se aplica' };
  }
  if (!valido(cache, agora)) {
    return { sim: true, porque: 'nao ha cache valido neste projeto' };
  }
  if (cache.desfecho !== 'ok') {
    return { sim: true, porque: 'a ultima consulta terminou em "' + cache.desfecho +
      '": tentativa que falhou nao consome a janela' };
  }
  const idade = idadeEmDias(cache, agora);
  if (idade >= JANELA_DIAS) {
    return { sim: true, porque: 'a ultima consulta boa tem ' + Math.floor(idade) + ' dia(s)' };
  }
  return { sim: false, porque: 'ja se consultou ha ' + Math.floor(idade) +
    ' dia(s); a janela e de ' + JANELA_DIAS };
}

/**
 * Sem rede e caminho previsto, nao falha (spec 6, regra 4). O texto existe para
 * que o agente NAO invente a lista de memoria: a pagina vence a memoria, e sem
 * pagina a resposta certa e perguntar, nao adivinhar.
 */
function motivoDegradado() {
  return [
    'sworn: nao deu para consultar o catalogo de modelos agora.',
    '',
    'Isto nao e falha do plugin nem motivo para parar: o sworn segue sem a lista',
    'atualizada e avisa disso de proposito, em vez de ficar calado.',
    '',
    'O que NAO fazer: completar a lista de memoria. A pagina vence a memoria -',
    'ja se mediu catalogo desatualizado sobre o proprio modelo que o estava lendo.',
    '',
    'O que fazer: dizer ao dono o que nao deu para conferir, e perguntar direto',
    'o que so ele sabe - qual modelo para qual papel, e quanto ele aceita pagar.'
  ].join('\n');
}

module.exports = {
  ARQUIVO, JANELA_DIAS, DIA, DESFECHOS, DELIBERADOS,
  caminho, ler, valido, gravar, registrar, idadeEmDias, deveConsultar, motivoDegradado
};
