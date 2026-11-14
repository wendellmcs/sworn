'use strict';
const fs = require('node:fs');
const texto = require('./texto.js');

/**
 * F5a (diagnostico de 2026-11-10, secao F): a leitura UNICA de arquivo JSON (test/jsonio.test.js barra outra
 * lerJson). Antes eram seis copias: uma sem o semBom (o arquivo gravado pelo PowerShell 5.1 virava null, D96/D98),
 * uma que calava o arquivo quebrado, outra que dizia a causa.
 *
 * Nunca lanca. Devolve { valor, ausente, etapa, erro }:
 *   - lido:            { valor, ausente: false, etapa: null, erro: null }
 *   - nao existe:      { valor: null, ausente: true, etapa: null, erro: null }
 *   - nao se leu:      etapa 'leitura', erro = o do sistema (EISDIR, EACCES...; o caminho que nao e texto tambem)
 *   - JSON quebrado:   etapa 'json', erro = o SyntaxError
 *   - forma errada:    etapa 'forma' (com `opcoes.objeto`, o que nao e objeto: lista, numero, texto, null)
 * Quem le decide o que fazer com cada caso; "ausente" e "ilegivel" nunca sao a mesma coisa.
 */
function ler(caminho, opcoes) {
  let bruto;
  try { bruto = fs.readFileSync(caminho, 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return { valor: null, ausente: true, etapa: null, erro: null };
    return { valor: null, ausente: false, etapa: 'leitura', erro: e };
  }
  let valor;
  try { valor = JSON.parse(texto.semBom(bruto)); } catch (e) {
    return { valor: null, ausente: false, etapa: 'json', erro: e };
  }
  if (opcoes && opcoes.objeto && !(valor && typeof valor === 'object' && !Array.isArray(valor))) {
    return { valor: null, ausente: false, etapa: 'forma', erro: null };
  }
  return { valor: valor, ausente: false, etapa: null, erro: null };
}

module.exports = { ler };
