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

// A4-bus-1 (pedido 12), seguranca: `find` com -delete/-exec/-execdir/-ok/-okdir, e `fd` com -x/-X/--exec, apagam ou
// rodam comando por si - pelo mesmo motivo do `sed -i` acima, o comando inteiro deixa de contar como busca.
const ALTERA = /(^|[\s|;&(])(find\b[^|;&]*\s-(delete|exec|execdir|ok|okdir)|fd\b[^|;&]*\s(-x|-X|--exec|--exec-batch))\b/;

// s351 (D786 passo 5, ao vivo cx6): o Codex no Windows procura pelo PowerShell, e o cmdlet nao diferencia caixa. O
// `gc` (Get-Content) fica de fora: casaria com `git gc`.
const COMANDOS_DO_POWERSHELL = /(^|[\s|;&({])(get-childitem|gci|select-string|sls|get-content)(?![\w-])/i;
// s351: pelo mesmo motivo do ALTERA, o comando (cmdlet ou alias, do PowerShell ou do Bash) que apaga, move ou escreve
// tira o comando inteiro da busca. So na posicao de comando (no comeco, depois de | ; & ( { ou de quebra de linha): a
// mesma palavra como argumento (`grep -rn del src`, `sls erase x.js`) e o que se procura. s352: tambem depois de
// xargs, sudo, then e do (`ls | xargs rm`). O `>` grava (`1>`, `&>`, `2>arquivo`, `2>nul.txt`); o
// `>&2`, o `2>&1`, o `2>` para /dev/null, $null ou nul, o `=>` e o `->`, nao. E o metodo .NET que apaga, move ou grava
// (`$_.Delete()`, `[IO.File]::WriteAllText(`). Testado sobre o comando SEM o que esta entre aspas (ehBusca).
const ALTERA_POR_COMANDO = new RegExp('(^|[|;&({\\r\\n])\\s*' +
  '(?:(?:xargs|sudo|then|do)(?:\\s+(?:-\\S+|\\{\\}|\\d+))*\\s+)*' +
  '(remove-item|ri|rm|del|erase|rd|rmdir|unlink|set-content|sc|add-content|ac|out-file|new-item|ni|touch|mkdir|' +
  'copy-item|cpi|cp|copy|move-item|mi|mv|move|rename-item|rni|ren|clear-content|clc|set-item|tee-object|tee)' +
  '(?![\\w-])|(^|[^2=-])>(?!&\\d)|2>(?!&\\d|\\s*(?:/dev/null|\\$null|nul)(?![\\w.]))' +
  '|\\.(delete|moveto|copyto)\\s*\\(|::\\s*(write\\w*|append\\w*|delete|move|copy|create\\w*)\\s*\\(', 'i');
// s352: o que esta entre aspas e o padrao procurado (`grep -rn "Array<string>" src`), nao comando nem redirecionamento.
// atalho: as aspas saem inteiras antes do ALTERA_POR_COMANDO. limite: `bash -c "rm x"` e `"$(rm x)"` passam como
// busca. trocar quando: uma rodada ao vivo mostrar o comando que altera escondido entre aspas.
const ENTRE_ASPAS = /'[^'\r\n]*'|"[^"\r\n]*"/g;

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
    return typeof cmd === 'string' && (COMANDOS.test(cmd) || COMANDOS_DO_POWERSHELL.test(cmd)) && !ALTERA.test(cmd) &&
      !ALTERA_POR_COMANDO.test(cmd.replace(ENTRE_ASPAS, '""'));
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
    // A4-104 (pedido 12, microcopy): a 1a linha na forma unica dos avisos, com o passo. A4-124: com "barrado" e o
    // numero da trava, como as travas 5 e 8.
    'sworn - arquivo novo barrado (trava 7): sem ter procurado o que ja existe; procure antes e diga o que achou.',
    '',
    'Alvo: ' + alvo + '  (nao existe ainda: isto e criacao, nao edicao)',
    '',
    // A4-30 (pedido 12, microcopy): o motivo e o passo sem "falha de origem" nem "portao".
    'Por que: o risco e criar arquivo novo em vez de entender o que ja existe.',
    'Antes de criar, procure - Grep, Glob, ou um grep/find pelo Bash - e diga na',
    'resposta o que a busca devolveu. Se mesmo assim nao houver onde encaixar,',
    'crie: depois de uma busca neste turno, criar arquivo novo fica liberado.',
    '',
    'Editar arquivo que ja existe nunca exige isso: quem edita ja achou.'
  ].join('\n');
}

module.exports = { FERRAMENTAS, COMANDOS, ehBusca, nomeadoNoEscopo, motivo };
