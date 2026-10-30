'use strict';
const { PRECOS } = require('./calibracao.js');
const { milhar, centavos } = require('./medidor.js');

// Plano 084 (pedido 73, D547, D549; mock D550): voltar a um chat grande depois de mais de 1 hora parado. O cache
// e de 1 h (D547: 100% da escrita medida e de 1 h; 64 de 64 voltas com mais de 1 h parado perderam o cache), e
// continuar regrava a conversa inteira. O gancho de entrada segura a 1a mensagem da pausa e mostra a conta.
// Mensagem de gancho: ASCII (D532), na forma unica dos avisos (test/forma-aviso.test.js).

const CHAVE = 'avisoDeVolta';
const PARADO_MS = 60 * 60 * 1000;   // mais que isto: o cache de 1 h venceu
const CONTEXTO_MINIMO = 200000;     // D549: 200 mil ou mais
// D547: mediana da 1a chamada de chat novo (68.723 tokens). E o piso: o chat novo ainda rele arquivos depois.
const RECOMECO = 68723;
// indice da escrita de 1 h na tabela de precos (calibracao.js: entrada, saida, leitura, escrita 5 min, escrita 1 h)
const ESCRITA_1H = 4;

/** Ligado por padrao. So o booleano `false` desliga (D388, D415). */
function ligada(projeto) {
  return !(projeto && typeof projeto === 'object' && projeto[CHAVE] === false);
}

/**
 * `chamada` = saude.ultimaChamadaDoTranscript. Devolve null quando nao avisa: sem leitura, sem horario, parado
 * ate 1 h, contexto abaixo de 200 mil, ou a mesma pausa ja avisada (`jaAvisado` = a marca gravada no estado).
 * `marca` = o horario da ultima chamada: a mensagem segurada nao chega ao Claude, entao a marca so muda numa
 * pausa nova.
 */
function avaliar(chamada, agora, jaAvisado) {
  if (!chamada || typeof chamada.contexto !== 'number' || typeof chamada.horario !== 'number') return null;
  const parado = agora - chamada.horario;
  if (!(parado > PARADO_MS) || !(chamada.contexto >= CONTEXTO_MINIMO)) return null;
  if (jaAvisado === chamada.horario) return null;
  // so a chave propria da tabela: "constructor" ou "toString" herdados nao sao preco (dariam US$ NaN)
  const preco = chamada.modelo && Object.prototype.hasOwnProperty.call(PRECOS, chamada.modelo) ? PRECOS[chamada.modelo] : null;
  const porToken = preco && typeof preco[ESCRITA_1H] === 'number' && isFinite(preco[ESCRITA_1H]) ? preco[ESCRITA_1H] / 1e6 : null;
  return {
    marca: chamada.horario, parado: parado, contexto: chamada.contexto, modelo: chamada.modelo,
    continuar: porToken === null ? null : chamada.contexto * porToken,
    novo: porToken === null ? null : RECOMECO * porToken
  };
}

/** "claude-opus-5-5" -> "Opus 5.5". */
function nomeDoModelo(id) {
  const m = /^claude-([a-z]+)-(\d+(?:-\d+)*)$/.exec(id);
  if (!m) return id;
  return m[1].charAt(0).toUpperCase() + m[1].slice(1) + ' ' + m[2].replace(/-/g, '.');
}

function duracao(ms) {
  const min = Math.floor(ms / 60000);
  return Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0') + ' min';
}

/**
 * O texto do aviso (D550; 0.11.0, mock D588). ASCII: o id do modelo que vier torto sai com "?" no lugar.
 * `resumo` = o que o retomar.resumir devolveu ({ caminho, chat, handoff }) ou null: com ele, a opcao 1 traz o prompt
 * pronto do chat novo; o handoff do modelo em dia (gravado depois do ultimo pedido) entra junto, se o caminho for
 * ASCII (o resumo o cita de qualquer jeito). Sem ele, o aviso diz que nao houve resumo e a opcao 1 e a de antes.
 */
function motivo(r, resumo) {
  // A5-26 (D735): o efeito em palavras simples, sem "cache" nem "regrava".
  const linhas = ['sworn - este chat ficou ' + duracao(r.parado) + ' parado: continuar aqui fica mais caro, porque a ' +
    'conversa inteira (' + milhar(Math.floor(r.contexto / 1000)) + ' mil tokens) e cobrada de novo.', ''];
  if (r.continuar !== null) {
    linhas.push('Continuar neste chat: cerca de US$ ' + centavos(r.continuar) + ' (' + nomeDoModelo(r.modelo) + ').');
    linhas.push('Abrir um chat novo: cerca de US$ ' + centavos(r.novo) + '.');
  } else {
    const id = r.modelo ? '"' + String(r.modelo).replace(/[^\x20-\x7E]/g, '?') + '"' : 'deste chat';
    linhas.push('Sem o valor em US$: o modelo ' + id + ' nao esta na tabela de precos do sworn.');
  }
  if (resumo) {
    const h = resumo.handoff;
    const comHandoff = h && h.emDia && typeof h.caminho === 'string' && /^[\x20-\x7E]+$/.test(h.caminho);
    linhas.push('', 'Resumo deste chat gravado em ' + resumo.caminho + ' (sem gastar nada).',
      '', 'Faca uma destas:', '  1. abra um chat novo e cole:',
      '     Retome o chat ' + resumo.chat + (comHandoff ? ' pelo handoff ' + h.caminho + ' e pelo resumo ' + resumo.caminho +
        ': leia os dois' : ' pelo resumo ' + resumo.caminho + ': leia-o') + ' antes de qualquer coisa e siga de onde ele parou.');
  } else {
    linhas.push('', 'Sem resumo: nao consegui montar o resumo deste chat.',
      // A5-59 (D735): onde fica o handoff e como saber se esta em dia.
      '', 'Faca uma destas:', '  1. abra um chat novo e cole o prompt do ultimo handoff (o /sworn:handoff grava em ' +
        '.claude/sworn/handoff/), se ele foi gravado depois do seu ultimo pedido;');
  }
  // A5-25 (D735): o custo (o valor, ou o que encarece quando ele falta) e que a mensagem foi segurada antes do Claude.
  const custo = r.continuar !== null ? ' (cerca de US$ ' + centavos(r.continuar) + ')' :
    ' (a conversa inteira e cobrada outra vez)';
  linhas.push('  2. para seguir neste chat' + custo + ', mande a mensagem de novo: o sworn a segurou antes do ' +
    'Claude e nao segura a proxima nesta pausa.',
    '', 'Desligar neste projeto: "' + CHAVE + '": false em .claude/sworn/projeto.json.');
  return linhas.join('\n');
}

module.exports = { CHAVE, PARADO_MS, CONTEXTO_MINIMO, RECOMECO, ligada, avaliar, motivo, nomeDoModelo, duracao };
