'use strict';
// O leitor de baldes, num lugar so. O `baldes.test.js` confere contra ele a lista
// do saude.js, e o `publicacao.test.js` confere o CHANGELOG. Dois leitores
// poderiam discordar calados - a mesma razao do `superficiePublicavel` unico.
// Nao termina em .test.js de proposito: o `npm test` roda so `test/*.test.js`.
const fs = require('node:fs');
const path = require('node:path');

const SCRIPTS = path.join(__dirname, '..', 'scripts');

/** Todo `estado.incrementar(..., 'balde')` que existe nos scripts. */
function baldesNoCodigo() {
  const achados = new Set();
  const visitar = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { visitar(p); continue; }
      if (!e.name.endsWith('.js')) continue;
      const texto = fs.readFileSync(p, 'utf8');
      const re = /incrementar\([^,]+,\s*'([a-z_]+)'/g;
      let m;
      while ((m = re.exec(texto)) !== null) achados.add(m[1]);
      // o portao de fecho escreve o balde dele direto, sem passar por incrementar
      const direto = /contadores\.([a-z_]+)\s*=/g;
      while ((m = direto.exec(texto)) !== null) achados.add(m[1]);
    }
  };
  visitar(SCRIPTS);
  return achados;
}

/** Baldes que CONTAM sem negar: existem de proposito e nao sao bloqueio. */
const SO_CONTAM = new Set(['agentes_despachados', 'revisao_fechada', 'escopo_ampliado',
  // O gatilho 3 avisa e deixa passar (decisao 15): conta, nunca bloqueia.
  'apelido_divergente',
  // D294: tabela do PowerShell que nao se le avisa e deixa passar: conta, nunca bloqueia.
  'shell_tabela_quebrada',
  // D503 (0.8.1): o fecho de revisao contra a referencia de topo, que o portao de fecho le.
  'revisao_referencia_fechada',
  // B3 (s369, R-dsh): o estado tipado do fecho e as perguntas ao dono por classe da D785 (a fora e a falha medida).
  'fecho_pronto', 'fecho_esperando', 'fecho_bloqueado', 'fecho_falhou',
  'pergunta_regra_de_negocio', 'pergunta_aparencia', 'pergunta_externo', 'pergunta_credencial',
  'pergunta_fora_da_classe',
  // B4 (s369, R-superpowers): a decisao autonoma registrada no fecho, e a registrada sem o custo se errado.
  'decisao_autonoma', 'decisao_sem_custo']);

module.exports = { baldesNoCodigo, SO_CONTAM };
