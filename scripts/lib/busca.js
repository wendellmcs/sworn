'use strict';

/**
 * C9 - "Eu prefiro criar arquivo novo a entender o que ja existe."
 *
 * A autoavaliacao exigiu: "buscar antes de criar, com resultado da busca citado".
 * Verificavel por: "busca citada antes de arquivo novo". Nunca virou mecanismo -
 * virou a regra de texto `antes de criar arquivo novo -> ...` em modelos/regras.md,
 * que e exatamente a forma que a propria autoavaliacao declarou insuficiente
 * ("regra que depende de eu lembrar dela e a falha A1 esperando acontecer").
 *
 * O portao e assimetrico de proposito: EDITAR arquivo existente nunca exige busca,
 * porque quem edita ja achou. So a CRIACAO exige, e so na marcha que ja exige
 * escopo - em marcha rapida (README, .md, config) criar arquivo e barato e
 * cobrar busca seria burocracia onde nao ha risco.
 */

/** Ferramentas que contam como ter procurado. */
const FERRAMENTAS = ['grep', 'glob', 'read'];

/**
 * Comandos de shell que contam como ter procurado.
 *
 * `sed` e `awk` ficaram DE FORA de proposito: `sed -i` escreve. Um comando que
 * altera arquivo nao pode ser o passe que libera criar arquivo - seria o portao
 * se abrindo com a propria chave. Na duvida entre incluir e excluir, exclui-se:
 * o custo de excluir e uma busca a mais; o de incluir e o portao virar enfeite.
 */
const COMANDOS = /(^|[\s|;&(])(grep|rg|ag|ack|find|fd|ls|dir|cat|head|tail|tree|git\s+grep|git\s+ls-files)\b/;

/**
 * Uma chamada de ferramenta conta como busca?
 * Bash conta pelo COMANDO, nao pelo nome da ferramenta: `Bash` sozinho nao diz
 * nada, e `rm -rf` nao e busca.
 */
function ehBusca(toolName, toolInput) {
  const nome = String(toolName || '').toLowerCase();
  if (FERRAMENTAS.indexOf(nome) !== -1) return true;
  if (nome === 'bash' || nome === 'powershell') {
    const cmd = (toolInput || {}).command;
    return typeof cmd === 'string' && COMANDOS.test(cmd);
  }
  return false;
}

/**
 * O alvo foi NOMEADO no escopo, ou so caiu nele por padrao?
 *
 * Escrever `- src/novo.js` no escopo.md JA E a deliberacao que o C9 quer: alguem
 * parou, decidiu que aquele arquivo precisa existir, e escreveu o nome dele.
 * Cobrar busca em cima disso e burocracia, e portao que cobra burocracia e
 * portao que o dono desliga na primeira semana.
 *
 * Entrada com coringa NAO conta: `src/**` cobre mil arquivos que ninguem pensou
 * um a um, e e exatamente ai que "criar em vez de entender" acontece.
 */
function nomeadoNoEscopo(alvo, esc) {
  if (!esc || !Array.isArray(esc.dentro)) return false;
  const a = String(alvo == null ? '' : alvo).toLowerCase().replace(/\\/g, '/');
  return esc.dentro.some(function (d) {
    const p = String(d == null ? '' : d).toLowerCase().trim().replace(/\\/g, '/');
    if (!p) return false;
    if (p.indexOf('*') !== -1 || p.indexOf('?') !== -1) return false;
    return p === a;
  });
}

function motivo(alvo) {
  return [
    'sworn: NEGADO - arquivo novo sem ter procurado o que ja existe.',
    '',
    'Alvo: ' + alvo + '  (nao existe ainda: isto e criacao, nao edicao)',
    '',
    'A falha de origem: criar arquivo novo em vez de entender o que ja existe.',
    'Antes de criar, procure - Grep, Glob, ou um grep/find pelo Bash - e diga na',
    'resposta o que a busca devolveu. Se mesmo assim nao houver onde encaixar,',
    'criar passa a ser a resposta certa, e o portao nao atrapalha de novo neste turno.',
    '',
    'Editar arquivo que ja existe nunca exige isso: quem edita ja achou.'
  ].join('\n');
}

module.exports = { FERRAMENTAS, COMANDOS, ehBusca, nomeadoNoEscopo, motivo };
