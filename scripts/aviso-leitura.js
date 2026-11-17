#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const io = require('./lib/io.js');
const estado = require('./lib/estado.js');
const config = require('./lib/config.js');
const { ascii } = require('./lib/escopo.js');

/**
 * Colheita lote 5, item 12 (D667, D846): PreToolUse em Read. O arquivo grande lido inteiro (sem offset nem limit) enche o
 * contexto de uma vez; o gancho avisa, nunca nega, que o Grep e o offset/limit trazem so o trecho. Uma vez por arquivo
 * na sessao (a marca e a lista `leiturasAvisadas`). Fica calado: sem projeto.json, com "avisoDeLeitura": false, com
 * imagem, PDF e notebook (o Read os le do jeito dele), com caminho de rede, com arquivo que nao existe, com pasta e com
 * entrada torta. Cada Read paga este processo: so um stat, sem ler o arquivo.
 */
const LIMIAR = 64 * 1024;
const FORA = /\.(png|jpe?g|gif|webp|bmp|ico|pdf|ipynb)$/i;
// Caminho de rede (\\host\share, //host/share): o gancho roda antes da permissao do Read, e o stat num caminho UNC
// ja abre a conexao SMB no Windows (manda o hash NTLM) mesmo que a leitura seja negada depois. Nunca se toca nele.
const REDE = /^[\\/]{2}/;
// Teto da lista da sessao: o estado nao cresce sem fim numa sessao que le muitos arquivos grandes.
const TETO_DA_LISTA = 200;

/** Os itens de texto de `v` (a lista do estado; torta = vazia). */
function soTextos(v) {
  return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string'; }) : [];
}

/** A chave do arquivo na lista: o caminho absoluto ja resolvido, sem caixa no Windows (a mesma pasta escrita de outro jeito). */
function chave(abs) {
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

/** O texto do aviso (ASCII), com o caminho relativo a raiz do projeto quando o arquivo esta dentro dela. */
function aviso(raiz, abs, bytes) {
  const rel = path.relative(raiz, abs);
  const fora = !rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel);
  const nome = fora ? abs : rel.split(path.sep).join('/');
  return [
    'sworn - leitura grande: "' + ascii(nome) + '" tem ' + Math.round(bytes / 1024) + ' KB (cerca de ' +
      Math.round(bytes / 4 / 1000) + ' mil tokens) e vai inteiro para o contexto.',
    'Se basta um trecho, ache a linha com o Grep e leia com offset e limit. A leitura segue.'
  ].join('\n');
}

/**
 * Grava a marca do arquivo nesta sessao e conta o aviso no balde; devolve true se a marca e nova (avisar). A marca e
 * lida dentro do alterar (com a trava): duas leituras ao mesmo tempo nao avisam duas vezes. Nasce true: com o estado
 * fora do ar o alterar nem roda, e avisar duas vezes e melhor que calar; o balde tenta contar do mesmo jeito.
 */
function marcarAvisado(sessao, k) {
  let nova = true;
  try {
    estado.alterar(sessao, function (s) {
      const lista = soTextos(s.leiturasAvisadas);
      if (lista.indexOf(k) !== -1) { nova = false; return s; }
      s.leiturasAvisadas = lista.concat([k]).slice(-TETO_DA_LISTA);
      return s;
    });
  } catch (e) { /* avisa do mesmo jeito */ }
  if (nova) { try { estado.incrementar(sessao, 'leitura_grande'); } catch (e) { /* o aviso sai sem contar */ } }
  return nova;
}

io.blindar(function () {
  io.lerEntrada(function (e) {
    const ti = e && e.tool_input && typeof e.tool_input === 'object' ? e.tool_input : {};
    const alvo = ti.file_path;
    if (typeof alvo !== 'string' || !alvo || FORA.test(alvo) || REDE.test(alvo)) return io.permitir();
    // quem ja pediu o trecho nao precisa do aviso (offset 0 tambem e pedido; null e o mesmo que ausente)
    if (ti.offset != null || ti.limit != null) return io.permitir();
    const cwd = typeof e.cwd === 'string' && e.cwd ? e.cwd : process.cwd();
    const raiz = config.raizDoProjeto(cwd);
    const projeto = config.carregarProjeto(raiz);
    if (!projeto || projeto.avisoDeLeitura === false) return io.permitir();
    const abs = path.resolve(cwd, alvo);
    let st;
    try { st = fs.statSync(abs); } catch (err) { return io.permitir(); }
    // a pasta cai aqui tambem: o tamanho dela no stat fica abaixo do limiar
    if (st.size <= LIMIAR) return io.permitir();
    if (!marcarAvisado(e.session_id, chave(abs))) return io.permitir();
    io.permitir({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: aviso(raiz, abs, st.size) } });
  });
});
