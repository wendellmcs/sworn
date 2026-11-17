'use strict';
const fs = require('node:fs');
const path = require('node:path');

/**
 * Colheita lote 5, V1 (D846): o que um apagar barrado pela trava 5 apagaria, em linhas para o aviso. O dono decide
 * vendo o alvo, nao so o padrao do comando. So le (lstat e readdir), nunca segue atalho, para numa contagem fixa e
 * nunca toca caminho de rede. Quem chama poe tudo num try: a lista e acessoria, a negacao nunca depende dela.
 * O que nao se leu nunca sai como contado: "nao existe" so no ENOENT, a pasta sem leitura diz que nao foi conferida,
 * e a contagem que parou diz "ate ali".
 */
const TETO_DE_ITENS = 2000;   // entradas lidas no total, somando todos os alvos
const ARQUIVOS_LISTADOS = 10; // nomes de arquivo mostrados, somando todos os alvos
// \\host\share ou //host/share: o lstat num caminho UNC ja abre a conexao SMB no Windows (o mesmo do aviso-leitura.js)
const REDE = /^[\\/]{2}/;
// nome vindo do disco e dado de fora: controle e quebra (ASCII e Unicode) viram `?`, para nao abrir linha no aviso
const CONTROLE = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/g;
// o que o shell expande (curinga, til, variavel, chave): o nome escrito nao e o caminho que sai. O alvosDoApagar ja
// recusa esses comandos; a guarda aqui deixa o descrever certo para quem o chamar sem ele.
const EXPANDE = /[*?[\]{}$`]|^~/;

/** O tamanho legivel, com a virgula decimal do portugues: bytes, KB ou MB. */
function tamanho(bytes) {
  if (bytes === 1) return '1 byte';
  if (bytes < 1024) return bytes + ' bytes';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return String(Math.round(bytes / (1024 * 1024) * 10) / 10).replace('.', ',') + ' MB';
}

/** O nome mostrado: relativo a raiz quando esta dentro dela, senao o absoluto; sempre com `/` e sem controle. */
function nomeDe(raiz, abs) {
  const rel = path.relative(raiz, abs);
  const foraDaRaiz = !rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel);
  return (foraDaRaiz ? abs : rel).replace(/\\/g, '/').replace(CONTROLE, '?');
}

/**
 * Percorre a pasta sem seguir atalho, em ordem de nome. `conta` e compartilhado entre os alvos: { itens, listados }.
 * Devolve { arquivos, pastas, atalhos, bytes, nomes, parou, ilegiveis, semLeitura } - `semLeitura` quando a propria
 * pasta do alvo nao abriu (o que tem dentro nao foi visto).
 */
function percorrer(raiz, abs, conta) {
  const r = { arquivos: 0, pastas: 0, atalhos: 0, bytes: 0, nomes: [], parou: false, ilegiveis: 0, semLeitura: false };
  const pilha = [abs];
  while (pilha.length) {
    const dir = pilha.pop();
    let entradas;
    try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch {
      if (dir === abs) r.semLeitura = true; else r.ilegiveis++;
      continue;
    }
    entradas.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    const subpastas = [];
    for (const ent of entradas) {
      if (conta.itens >= TETO_DE_ITENS) { r.parou = true; return r; }
      conta.itens++;
      const filho = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) { r.atalhos++; continue; } // so o atalho sai: nao desce nem soma o destino
      if (ent.isDirectory()) { r.pastas++; subpastas.push(filho); continue; }
      r.arquivos++;
      try { r.bytes += fs.lstatSync(filho).size; } catch { r.ilegiveis++; }
      if (conta.listados < ARQUIVOS_LISTADOS) { conta.listados++; r.nomes.push(nomeDe(raiz, filho)); }
    }
    // a pilha tira do fim: as subpastas entram ao contrario para a primeira em ordem de nome sair primeiro
    for (let i = subpastas.length - 1; i >= 0; i--) pilha.push(subpastas[i]);
  }
  return r;
}

/** A linha da pasta percorrida. `antes`: os itens que os alvos de cima ja gastaram do teto somado. */
function linhaDaPasta(nome, r, antes) {
  if (r.semLeitura) return 'pasta "' + nome + '": sem leitura, o conteudo nao foi conferido';
  if (!r.arquivos && !r.pastas && !r.atalhos && !r.parou && !r.ilegiveis) return 'pasta "' + nome + '": vazia';
  const corpo = r.arquivos + ' arquivo(s) em ' + (r.pastas + 1) + ' pasta(s), ' + tamanho(r.bytes) +
    (r.atalhos ? ', ' + r.atalhos + ' atalho(s) (so o atalho sai)' : '') +
    (r.ilegiveis ? ', ' + r.ilegiveis + ' item(ns) sem leitura' : '');
  const parou = 'a contagem' + (antes ? ', somada com os alvos acima,' : '') + ' parou em ' + TETO_DE_ITENS +
    ' itens; ate ali, ';
  return 'pasta "' + nome + '": ' + (r.parou ? parou : '') + corpo;
}

/**
 * As linhas do que `alvos` (os nomes do comando, como escritos) apagariam, resolvidos contra `cwd` (o do comando,
 * absoluto; sem ele, nenhuma linha: resolver contra outra pasta mostraria o alvo errado).
 */
function descrever(alvos, cwd, raiz) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || REDE.test(cwd)) return [];
  const linhas = [];
  const conta = { itens: 0, listados: 0 };
  for (const alvo of alvos) {
    const escrito = String(alvo).replace(CONTROLE, '?');
    if (!escrito) { linhas.push('"": nome vazio, nao conferido'); continue; }
    // o nome cru: o `?` do escrito pode ser um controle trocado
    if (EXPANDE.test(String(alvo))) { linhas.push('"' + escrito + '": o shell expande o nome, nao conferido'); continue; }
    // o cwd ja e local (conferido acima): so o nome escrito leva a rede
    if (REDE.test(escrito)) { linhas.push('"' + escrito + '": caminho de rede, nao conferido'); continue; }
    const abs = path.resolve(cwd, String(alvo));
    const nome = nomeDe(raiz, abs);
    let st;
    try { st = fs.lstatSync(abs); } catch (err) {
      const codigo = err && err.code;
      linhas.push('"' + nome + '": ' + (codigo === 'ENOENT' || codigo === 'ENOTDIR' ? 'nao existe'
        : 'sem leitura' + (codigo ? ' (' + codigo + ')' : '') + ', nao conferido'));
      continue;
    }
    if (st.isSymbolicLink()) { linhas.push('atalho "' + nome + '": so o atalho sai, o destino fica'); continue; }
    if (!st.isDirectory()) { linhas.push('arquivo "' + nome + '": ' + tamanho(st.size)); continue; }
    if (conta.itens >= TETO_DE_ITENS) {
      linhas.push('pasta "' + nome + '": nao contada (a contagem ja parou em ' + TETO_DE_ITENS + ' itens)');
      continue;
    }
    const antes = conta.itens;
    const r = percorrer(raiz, abs, conta);
    linhas.push(linhaDaPasta(nome, r, antes));
    for (const n of r.nomes) linhas.push('  ' + n);
    const faltam = r.arquivos - r.nomes.length;
    if (faltam > 0 && r.nomes.length) linhas.push('  ... e mais ' + (r.parou ? 'pelo menos ' : '') + faltam + ' arquivo(s)');
    else if (faltam > 0) linhas.push('  (sem nomes: os ' + ARQUIVOS_LISTADOS + ' da lista ja sairam nos alvos acima)');
  }
  return linhas;
}

module.exports = { descrever, TETO_DE_ITENS, ARQUIVOS_LISTADOS };
