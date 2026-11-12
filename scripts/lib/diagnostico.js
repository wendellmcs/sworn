'use strict';
// D826 (D4, do obra/superpowers 22f0b46, skills/diagnosing-superpowers): o /sworn:diagnose despacha um analista por
// dimensao, e so mostra o achado cuja citacao confere. Esta lib e a regua dessa conferencia.
const citacao = require('./citacao.js');

// as dimensoes que o dono escolheu (D826); o texto de cada uma esta em skills/diagnose/references/analistas.md
const DIMENSOES = ['custo-e-tempo', 'plano', 'repetido', 'tropecos', 'evidencia', 'pedidos', 'travas'];
// a citacao e um trecho da linha, nao a linha inteira: a linha da transcricao passa de 1 MB
const TETO_DO_TRECHO = 200;
// o trecho tem de estar na propria linha citada: na transcricao, a linha vizinha e outro evento
const SO_A_LINHA_CITADA = 0;

function temTexto(v) { return typeof v === 'string' && v.trim() !== ''; }

/** Por que o achado sai, ou null quando a citacao confere. */
function motivoDoDescarte(a, raizes) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return 'o achado nao e um objeto';
  if (DIMENSOES.indexOf(a.dimensao) === -1) return 'dimensao desconhecida: ' + JSON.stringify(a.dimensao);
  if (!temTexto(a.achado)) return 'sem o texto do achado';
  const ev = a.evidencia;
  if (!ev || typeof ev !== 'object' || !temTexto(ev.caminho) || !Number.isInteger(ev.linha)) {
    return 'sem evidencia (caminho e linha inteira)';
  }
  if (!temTexto(ev.trecho)) return 'sem trecho copiado da linha';
  if (Array.from(ev.trecho).length > TETO_DO_TRECHO) return 'trecho com mais de ' + TETO_DO_TRECHO + ' caracteres';
  if (!citacao.citacaoConfere(raizes, ev.caminho, ev.linha, ev.trecho, SO_A_LINHA_CITADA)) {
    return 'a citacao nao confere: o trecho nao esta em ' + ev.caminho + ':' + ev.linha +
      ' (ou o arquivo fica fora do projeto e da pasta das transcricoes)';
  }
  return null;
}

/** Separa os achados em confirmados (a citacao confere) e descartados ({ indice, motivo }). */
function conferirAchados(achados, raizes) {
  if (!Array.isArray(achados)) throw new Error('os achados tem de ser uma lista');
  const confirmados = [];
  const descartados = [];
  achados.forEach(function (a, i) {
    const motivo = motivoDoDescarte(a, raizes);
    if (motivo) descartados.push({ indice: i, motivo: motivo });
    else confirmados.push(a);
  });
  return { confirmados: confirmados, descartados: descartados };
}

module.exports = { DIMENSOES, TETO_DO_TRECHO, conferirAchados };
