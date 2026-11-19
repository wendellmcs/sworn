'use strict';
// D875: a impressao do codigo do repositorio. O lancamento da prova de pronto grava a de agora no estado da sessao, e o
// portao (de commit e de fecho) compara: igual, a edicao feita fora do projeto depois da prova (o script auxiliar do
// scratchpad) nao pede a prova de novo; diferente, ou sem impressao gravada, pede como antes.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const git = require('./git.js');
const estado = require('./estado.js');

// acima disto a impressao custaria demais em todo lancamento da prova: devolve null e a edicao conta como antes
const ARQUIVOS_LIDOS_ATE = 20000;
// quantos lancamentos da prova a sessao guarda (o portao so pergunta pelo ultimo)
const LANCAMENTOS_GUARDADOS = 8;

/**
 * A impressao (sha1 em hex) do caminho, tamanho, mtime e ctime de cada arquivo de codigo (a regua do
 * saude.ehArquivoDeCodigo) que o git lista no repositorio de `raiz`, versionado ou novo e nao ignorado; null sem git,
 * sem resposta ou com mais de ARQUIVOS_LIDOS_ATE arquivos. O commit e o `git add` nao mexem no disco e nao a mudam;
 * editar, apagar, o `sed -i`, o script que grava e o checkout mudam. O ctime entra porque o `touch -r` repoe o mtime e
 * nao ele. Sem ler o conteudo (o custo de todo lancamento da prova), a regravacao de mesmo tamanho dentro do mesmo tique
 * do relogio do disco (2 s no FAT/exFAT) passa igual: o limite aceito.
 */
function impressao(raiz) {
  if (typeof raiz !== 'string' || !raiz) return null;
  const saida = git.correr(raiz, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ':/'],
    { maxBuffer: 64 * 1024 * 1024 });
  if (saida === null) return null;
  // o saude.js (grande) so carrega quando a impressao roda, nao a cada comando de shell que o portao ve
  const ehCodigo = require('./saude.js').ehArquivoDeCodigo;
  const nomes = Array.from(new Set(saida.split('\0').filter(Boolean))).filter(ehCodigo);
  if (nomes.length > ARQUIVOS_LIDOS_ATE) return null;
  const h = crypto.createHash('sha1');
  // o git devolve o caminho relativo a pasta de onde roda: o absoluto da a mesma impressao de qualquer subpasta
  const absolutos = nomes.map(function (rel) { return path.resolve(raiz, rel); }).sort();
  for (const abs of absolutos) {
    let st = null;
    try { st = fs.statSync(abs); } catch (e) { /* fica null */ } // fail-closed: o apagado entra como ausente e muda a impressao
    h.update(abs + '\0' + (st ? st.size + '\0' + st.mtimeMs + '\0' + st.ctimeMs : '-') + '\n');
  }
  return h.digest('hex');
}

/**
 * O PreToolUse do shell: se `e` (a entrada do gancho) roda a prova de pronto `prova` (o comando ou as formas de
 * saude.provasEquivalentes), grava a impressao de `raiz` no estado da sessao, pelo id da chamada e com o comando.
 * Devolve true quando gravou.
 */
function gravarSeForAProva(e, prova, raiz) {
  const comando = e && e.tool_input && e.tool_input.command;
  if (!e || !e.session_id || typeof comando !== 'string') return false;
  const casa = require('./saude.js').casaComAProva(prova);
  if (!casa || !casa(comando)) return false;
  const agora = impressao(raiz);
  if (agora === null) return false;
  const id = typeof e.tool_use_id === 'string' ? e.tool_use_id : null;
  estado.alterar(e.session_id, function (s) {
    const velhos = Array.isArray(s.impressoesDaProva) ? s.impressoesDaProva : [];
    s.impressoesDaProva = velhos.concat([{ id: id, comando: comando, impressao: agora }]).slice(-LANCAMENTOS_GUARDADOS);
    return s;
  });
  return true;
}

/**
 * Fabrica: devolve a funcao que os portoes passam ao saude.testesDoTranscript como a opcao `mesmoCodigoDaProva(id,
 * comando)`. Ela responde true so quando o lancamento da ultima prova (pelo id; sem id gravado, o mais recente com o
 * mesmo comando) tem impressao igual a de `raiz` agora. O registro com id so casa pelo id.
 */
function mesmoCodigoDesde(sessionId, raiz) {
  return function (id, comando) {
    const s = estado.ler(sessionId);
    const lista = s && Array.isArray(s.impressoesDaProva) ? s.impressoesDaProva : [];
    let achou = null;
    for (let i = lista.length - 1; i >= 0 && !achou; i--) {
      const x = lista[i];
      if (!x || typeof x.impressao !== 'string') continue;
      if (id && x.id === id) achou = x;
      else if (!x.id && typeof comando === 'string' && x.comando === comando) achou = x;
    }
    if (!achou) return false;
    const agora = impressao(raiz);
    return agora !== null && agora === achou.impressao;
  };
}

module.exports = { impressao, gravarSeForAProva, mesmoCodigoDesde, ARQUIVOS_LIDOS_ATE, LANCAMENTOS_GUARDADOS };
