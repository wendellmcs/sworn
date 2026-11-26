'use strict';
// O mapa do que veio de fora (ORIGENS.md): cada linha liga uma fonte (projeto, curso, skill de terceiro) a uma peca do
// sworn e ao gatilho que a chama. Este teste mantem o mapa verdadeiro: cada peca citada existe e pelo menos uma delas
// ainda leva a marca da fonte, o texto que o comentario de origem da peca cita. A peca renomeada ou apagada, ou a
// linha cujas pecas perderam todas a marca, faz o teste falhar ate a linha do mapa mudar junto.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const COLUNAS = ['Fonte', 'O que veio', 'Peça', 'Gatilho', 'Marca'];
const CRASE = /`([^`]+)`/g;
// a peca e um caminho a partir da raiz, com pasta e extensao: `scripts/lib/x.js`, `skills/design/SKILL.md`
const CAMINHO = /^(?:[\p{L}\p{N} _.-]+\/)+[\p{L}\p{N} _.-]+\.[\p{L}\p{N}]+$/u;

function ehCaminho(p) {
  return CAMINHO.test(p) && p.split('/').every(function (s) { return s !== '.' && s !== '..'; });
}

/** As celulas de uma linha de tabela; a barra escapada (\|) fica dentro da celula, como no GitHub. */
function celulas(linha) {
  const l = linha.trim();
  if (l.length < 2 || l[0] !== '|' || l[l.length - 1] !== '|') return [];
  return l.slice(1, -1).split(/(?<!\\)\|/).map(function (c) { return c.replace(/\\\|/g, '|').trim(); });
}

/**
 * As linhas da tabela do mapa, cada uma com o numero da linha e as celulas; sem o cabecalho de COLUNAS seguido do
 * separador (|---|...), null.
 */
function linhasDoMapa(texto) {
  const linhas = String(texto).split(/\r?\n/);
  const i = linhas.findIndex(function (l) { return celulas(l).join('|') === COLUNAS.join('|'); });
  if (i < 0) return null;
  const sep = celulas(linhas[i + 1] || '');
  if (sep.length !== COLUNAS.length || !sep.every(function (c) { return /^:?-+:?$/.test(c); })) return null;
  const doMapa = [];
  for (let j = i + 2; j < linhas.length && linhas[j].trim()[0] === '|'; j++) doMapa.push({ n: j + 1, c: celulas(linhas[j]) });
  return doMapa;
}

function crases(celula) {
  return Array.from(celula.matchAll(CRASE), function (m) { return m[1]; });
}

/** O que esta errado no mapa, uma frase por defeito, conferindo as pecas a partir de `raiz`; [] quando tudo confere. */
function problemas(texto, raiz) {
  const linhas = linhasDoMapa(texto);
  if (linhas === null) {
    return ['sem a tabela: o cabecalho | ' + COLUNAS.join(' | ') + ' | seguido do separador |' + '---|'.repeat(COLUNAS.length)];
  }
  const fora = [];
  for (const l of linhas) {
    const onde = 'linha ' + l.n;
    if (l.c.length !== COLUNAS.length) {
      fora.push(onde + ': ' + l.c.length + ' colunas, e nao ' + COLUNAS.length);
      continue;
    }
    if (!l.c[0] || !l.c[1] || !l.c[3]) fora.push(onde + ': a fonte, o que veio e o gatilho nao ficam vazios');
    const citadas = crases(l.c[2]);
    if (citadas.length === 0) fora.push(onde + ': sem peca (um caminho entre crases, com pasta e extensao)');
    for (const p of citadas) {
      if (!ehCaminho(p)) fora.push(onde + ': ' + p + ' nao e caminho de peca (a partir da raiz, com pasta e extensao)');
    }
    const pecas = citadas.filter(ehCaminho);
    const marca = crases(l.c[4]);
    if (marca.length !== 1) {
      fora.push(onde + ': a marca e um texto so, entre crases');
      continue;
    }
    let lidas = 0;
    let comMarca = false;
    for (const p of pecas) {
      let conteudo;
      try {
        conteudo = fs.readFileSync(path.join(raiz, p), 'utf8');
      } catch (e) {
        fora.push(onde + ': a peca ' + p + ' nao se le (' + (e.code || e.message) + ')');
        continue;
      }
      lidas++;
      if (conteudo.includes(marca[0])) comMarca = true;
    }
    if (lidas > 0 && !comMarca) fora.push(onde + ': nenhuma peca leva a marca ' + marca[0]);
  }
  return fora;
}

test('origens: cada linha do ORIGENS.md tem peca que existe e leva a marca da fonte', () => {
  const texto = fs.readFileSync(path.join(RAIZ, 'ORIGENS.md'), 'utf8');
  const linhas = linhasDoMapa(texto);
  assert.ok(linhas !== null, 'o ORIGENS.md sem a tabela do mapa');
  assert.ok(linhas.length >= 25, 'o mapa leu so ' + linhas.length + ' linhas');
  // a linha em branco no meio da tabela a partiria, e o que vem depois dela ficaria sem conferir
  const deTabela = texto.split(/\r?\n/).filter(function (l) { return /^\|.*\|$/.test(l.trim()); }).length;
  assert.strictEqual(linhas.length, deTabela - 2, 'linha de tabela fora do mapa: so a tabela do mapa cabe no arquivo');
  assert.deepStrictEqual(problemas(texto, RAIZ), []);
});

test('origens: o conferidor acha a peca que sumiu, a marca que saiu e a linha torta', () => {
  const cab = '| ' + COLUNAS.join(' | ') + ' |\n|---|---|---|---|---|\n';
  const certa = '| `cloudflare/security-audit-skill` | a lente | `scripts/lib/veredito.js` | a revisao | `cloudflare/security-audit-skill` |\n';
  assert.deepStrictEqual(problemas(cab + certa, RAIZ), []);
  // a marca vale se estiver em uma das pecas, nao em todas: o drift.js nao a leva, o veredito.js leva
  assert.ok(!fs.readFileSync(path.join(RAIZ, 'scripts/lib/drift.js'), 'utf8').includes('cloudflare/security-audit-skill'),
    'o drift.js passou a levar a marca: troque a peca sem marca deste caso');
  assert.deepStrictEqual(problemas(cab +
    '| x | y | `scripts/lib/drift.js`, `scripts/lib/veredito.js` | z | `cloudflare/security-audit-skill` |\n', RAIZ), []);
  const semTabela = 'sem a tabela: o cabecalho | ' + COLUNAS.join(' | ') + ' | seguido do separador |---|---|---|---|---|';
  assert.deepStrictEqual(problemas('# sem tabela\n', RAIZ), [semTabela]);
  // o cabecalho sem o separador logo abaixo nao vira tabela no GitHub
  assert.deepStrictEqual(problemas('| ' + COLUNAS.join(' | ') + ' |\n| x | y | `scripts/lib/veredito.js` | z | `a` |\n', RAIZ),
    [semTabela]);
  // a barra escapada (\|) e texto da celula, nao divisa de coluna
  assert.deepStrictEqual(problemas(cab + '| x | y | `scripts/lib/veredito.js` | z | `nao\\|tem` |\n', RAIZ),
    ['linha 3: nenhuma peca leva a marca nao|tem']);
  assert.deepStrictEqual(problemas(cab + '| x | y | `scripts/nao-existe.js` | z | `x` |\n', RAIZ),
    ['linha 3: a peca scripts/nao-existe.js nao se le (ENOENT)']);
  assert.deepStrictEqual(problemas(cab + '| x | y | `scripts/lib/veredito.js` | z | `marca-que-a-peca-nao-tem` |\n', RAIZ),
    ['linha 3: nenhuma peca leva a marca marca-que-a-peca-nao-tem']);
  assert.deepStrictEqual(problemas(cab + '| x | y | `scripts/lib/veredito.js` | z |\n', RAIZ),
    ['linha 3: 4 colunas, e nao 5']);
  assert.deepStrictEqual(problemas(cab + '| x | y | `scripts/lib/veredito.js` | z | `a` `b` |\n', RAIZ),
    ['linha 3: a marca e um texto so, entre crases']);
  assert.deepStrictEqual(problemas(cab + '| x | y | veredito.js | z | `a` |\n', RAIZ),
    ['linha 3: sem peca (um caminho entre crases, com pasta e extensao)']);
  // o texto entre crases na coluna da peca que nao e caminho e apontado, em vez de pulado em silencio
  assert.deepStrictEqual(problemas(cab + '| x | y | `veredito.js` `/sworn:review` | z | `a` |\n', RAIZ), [
    'linha 3: veredito.js nao e caminho de peca (a partir da raiz, com pasta e extensao)',
    'linha 3: /sworn:review nao e caminho de peca (a partir da raiz, com pasta e extensao)'
  ]);
  assert.deepStrictEqual(problemas(cab +
    '| x | y | `scripts/lib/veredito.js`, `scripts/../../fora/x.js` | z | `cloudflare/security-audit-skill` |\n', RAIZ),
    ['linha 3: scripts/../../fora/x.js nao e caminho de peca (a partir da raiz, com pasta e extensao)']);
  // o caminho com acento, espaco ou ponto na frente e caminho: falta o arquivo, nao a forma
  assert.deepStrictEqual(problemas(cab + '| x | y | `.claude/Ação com espaço/x.md` | z | `a` |\n', RAIZ),
    ['linha 3: a peca .claude/Ação com espaço/x.md nao se le (ENOENT)']);
  assert.deepStrictEqual(problemas(cab + '| x | y | `scripts/lib/veredito.js` |  | `cloudflare` |\n', RAIZ),
    ['linha 3: a fonte, o que veio e o gatilho nao ficam vazios']);
  // a tabela acaba na 1a linha que nao comeca por |: o que vem depois nao e linha do mapa
  assert.deepStrictEqual(problemas(cab + certa + '\nfim\n| x | y | `scripts/nao-existe.js` | z | `x` |\n', RAIZ), []);
});
