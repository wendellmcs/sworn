'use strict';
const fs = require('node:fs');
const path = require('node:path');
const jsonio = require('./jsonio.js');

/** 0.3.3, item 27: o caminho de um arquivo de <projeto>/.claude/sworn/. Uma montagem so, para quem le e para quem diagnostica. */
function caminhoEmSworn(cwd, nome) {
  return path.join(cwd, '.claude', 'sworn', nome);
}

/**
 * Le <projeto>/.claude/sworn/<nome>. Ausente ou corrompido -> null. JSON escrito no
 * Windows costuma vir com BOM, e sem semBom o JSON.parse estoura e o modulo se desliga EM
 * SILENCIO. D124. Uma funcao so para os dois arquivos (ronda 1 do 8c.5): duas copias da
 * mesma leitura ja divergiram uma vez. F5a: a leitura e a do lib/jsonio.js.
 * H-3: lista JSON e valida e `typeof [] === 'object'`, mas nao e o objeto que os dois arquivos sao (objeto: true).
 */
function lerObjeto(cwd, nome) {
  if (typeof cwd !== 'string' || cwd === '') return null;
  return jsonio.ler(caminhoEmSworn(cwd, nome), { objeto: true }).valor;
}

/** Le <projeto>/.claude/sworn/projeto.json. H3 (D877): com o perfil de instalacao aplicado (a chave escrita vence);
 *  o require fica aqui dentro para o config.js nao carregar o projeto.js de quem so le o design. */
function carregarProjeto(cwd) {
  return require('./projeto.js').comPerfil(lerObjeto(cwd, 'projeto.json'));
}

/** Le <projeto>/.claude/sworn/design.json. */
function carregarDesign(cwd) {
  return lerObjeto(cwd, 'design.json');
}

/**
 * D244/defeito 1: a pasta do projeto, que nao e sempre o cwd da sessao. Sobe de `cwd` ate a
 * primeira pasta com `.claude/sworn/projeto.json` - o ARQUIVO, nao a pasta: uma
 * `.claude/sworn/` sem projeto.json no meio do caminho (contadores, revisao) e atravessada.
 * Sem projeto em lugar nenhum acima, devolve o proprio cwd: e o "sem projeto" de antes.
 * Os hooks usam isto no lugar do cwd cru; os CLIs rodam na pasta que a pessoa escolhe.
 */
function raizDoProjeto(cwd) {
  // cwd que nao e texto (entrada absurda do harness) volta como veio: quem decide o que fazer
  // com ele e o chamador, como antes; estourar aqui derrubaria o portao (portao-apelido.test).
  if (!cwd || typeof cwd !== 'string') return cwd;
  let atual = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(atual, '.claude', 'sworn', 'projeto.json'))) return atual;
    const pai = path.dirname(atual);
    if (pai === atual) return cwd;
    atual = pai;
  }
}

// A2-03 (D721): o passo primeiro, com o caminho real do validar.js (ele diz a linha e a coluna do erro).
// A2-77: o init preserva so o que le do arquivo atual (skills/init/references/reinit.md:9-19), dai o "pode perder".
// A2-19: uma fonte so para o portao do escopo e para a abertura, que tinham dois textos. O caminho vai pelo
// caminhoParaShell sem shell: com o projeto.json ilegivel, o shell declarado nele tambem nao se le.
const AVISO_PROJETO_ILEGIVEL = 'sworn: .claude/sworn/projeto.json existe mas nao se le: ' +
  'os portoes de escopo e de intocaveis estao DESLIGADOS ate corrigir. ' +
  'Para achar o erro: node ' + require('./texto.js').caminhoParaShell(path.join(__dirname, '..', 'validar.js')) + '. ' +
  'Rodar /sworn:init de novo tambem resolve, mas pode perder o que voce ajustou a mao nesse arquivo.';

module.exports = { carregarProjeto, carregarDesign, raizDoProjeto, caminhoEmSworn, AVISO_PROJETO_ILEGIVEL };
