'use strict';

/**
 * O valor de uma flag da linha de comando, com a regra que os scripts copiavam um a um (A4-48).
 *
 * "Falta o valor" quando a flag e a ultima da linha, quando o argumento seguinte e vazio ou so espaco (A4-71: o
 * `--raiz ' '` media a pasta " "), ou quando ele e outra flag do USO do script (`--respostas --gravar` lia um arquivo
 * chamado "--gravar"). Um valor que comeca com `-` e nao e flag do USO vale: um arquivo chamado `--x.js` e caminho
 * (0.3.3, itens 13 e 14 do preparar-revisao.js), e o erro de leitura dele ja nomeia o arquivo.
 *
 * A flag repetida (`--raiz a --raiz b`) tambem e erro de uso: escolher uma das duas calado esconderia o engano.
 *
 * Quem chama passa `recusar`, que escreve o erro de uso do script e sai (cada um tem o seu canal e o seu codigo: o
 * stdout com 1 ou o stderr com 2). Se `recusar` voltar sem sair, o valor e null, como a flag ausente.
 *
 * @param {string[]} argv  a linha de comando (process.argv, ou o pedaco dela que o script le)
 * @param {string} nome  a flag com os tracos ('--raiz')
 * @param {string[]} flagsDoUso  as flags do USO do script
 * @param {(mensagem: string) => void} recusar  recebe '--raiz pede um valor.' ou '--raiz aparece mais de uma vez...'
 * @returns {string|null} o valor; null sem a flag, ou depois de uma recusa que voltou sem sair
 */
function valor(argv, nome, flagsDoUso, recusar) {
  const i = argv.indexOf(nome);
  if (i === -1) return null;
  if (argv.indexOf(nome, i + 1) !== -1) {
    recusar(nome + ' aparece mais de uma vez; passe-a uma vez so.');
    return null;
  }
  const v = argv[i + 1];
  if (typeof v !== 'string' || v.trim() === '' || flagsDoUso.indexOf(v) !== -1) {
    recusar(nome + ' pede um valor.');
    return null;
  }
  return v;
}

module.exports = { valor };
