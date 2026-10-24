'use strict';
/**
 * T4 do plano nome+pagina (D624, D650): a pagina publica e um README curto em ingles, um espelho em portugues e o
 * guia completo (GUIA.md, o README antigo). O guia segue preso ao codigo por readme.test.js e publicacao.test.js;
 * aqui se prende a vitrine: a lista de comandos as pastas de skills/, os numeros da medicao ao medicao/resultado.txt
 * (saida literal do medir-travas.js --apurar), as travas ao guia, e os dois idiomas um ao outro.
 *
 * Cada trecho conferido fica entre <!-- pagina:<nome> --> e <!-- /pagina:<nome> -->, que o GitHub nao mostra: o
 * marcador e o mesmo nos dois idiomas, o titulo da secao nao.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { MANUAL } = require('../scripts/lib/ordens.js');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');
const LEIAME = { en: 'README.md', pt: 'README.pt-BR.md' };
const GUIA = 'GUIA.md';
const TETO_DE_LINHAS = 200;

/** O texto entre os marcadores do trecho `nome`. */
function trecho(texto, nome, rel) {
  const ini = '<!-- pagina:' + nome + ' -->';
  const fim = '<!-- /pagina:' + nome + ' -->';
  const i = texto.indexOf(ini);
  const j = texto.indexOf(fim);
  assert.ok(i !== -1 && j > i, rel + ': sumiu o trecho ' + nome + ' (marcadores ' + ini + ' ... ' + fim + ')');
  return texto.slice(i + ini.length, j);
}

/** Linhas de dados de uma tabela markdown: fora o cabecalho e o separador. */
function linhasDeTabela(texto) {
  const linhas = texto.split('\n').filter((l) => /^\|/.test(l.trim()));
  return linhas.filter((l) => !/^\|[\s:|-]+\|$/.test(l.trim())).slice(1);
}

function cada(fn) {
  for (const lingua of Object.keys(LEIAME)) fn(LEIAME[lingua], ler(LEIAME[lingua]), lingua);
}

test('pagina: os dois READMEs e o guia existem, e o README e curto', () => {
  assert.ok(fs.existsSync(path.join(RAIZ, GUIA)), 'falta o ' + GUIA);
  cada((rel, t) => {
    const n = t.split('\n').length;
    assert.ok(n <= TETO_DE_LINHAS, rel + ' tem ' + n + ' linhas: o detalhe vai para o ' + GUIA);
  });
});

test('pagina: a tabela de comandos e a das skills do disco, nos dois idiomas', () => {
  const doDisco = fs.readdirSync(path.join(RAIZ, 'skills'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !MANUAL.test(e.name)).map((e) => e.name).sort();
  assert.ok(doDisco.length > 0, 'nenhuma skill no disco: o leitor quebrou');
  cada((rel, t) => {
    const linhas = linhasDeTabela(trecho(t, 'comandos', rel));
    const citados = linhas.map((l) => (l.match(/^\|\s*`\/sworn:([a-z-]+)`/) || [])[1]);
    assert.ok(citados.every(Boolean), rel + ': linha da tabela de comandos sem `/sworn:<nome>` na 1a coluna');
    assert.deepStrictEqual(citados.slice().sort(), doDisco, rel + ': a tabela de comandos difere das pastas de skills/');
  });
});

/** As duas condicoes e o veredito, lidos do medicao/resultado.txt. */
function resultado() {
  const r = ler('medicao/resultado.txt');
  const cond = (c) => {
    const m = r.match(new RegExp('^' + c + ': (\\d+) validas, \\d+ invalidas \\| falsa (\\d+),.*\\| prova colada (\\d+) de (\\d+)', 'm'));
    assert.ok(m, 'o resultado.txt nao tem a linha da condicao ' + c);
    return { validas: Number(m[1]), falsa: Number(m[2]), colada: Number(m[3]), de: Number(m[4]) };
  };
  return { r: r, sem: cond('sem'), com: cond('com'), veredito: (r.match(/^VEREDITO: (\S+)$/m) || [])[1] };
}

test('pagina: os numeros da medicao sao os do medicao/resultado.txt, nos dois idiomas', () => {
  const { r, sem, com, veredito } = resultado();
  assert.ok(veredito, 'o resultado.txt nao tem o veredito');
  assert.ok(/^completa: sim$/m.test(r) && /^congelado: confere$/m.test(r), 'o resultado.txt nao e de rodada completa e conferida');
  assert.ok(!/[A-Za-z]:\\|Users[\\/]/.test(r), 'o resultado.txt leva caminho da maquina');
  cada((rel, t) => {
    const s = trecho(t, 'medicao', rel);
    const linhas = linhasDeTabela(s).map((l) => {
      const m = l.match(/\|\s*(\d+) \/ (\d+)\s*\|\s*(\d+) \/ (\d+)\s*\|\s*$/);
      assert.ok(m, rel + ': linha da tabela da medicao fora da forma "| ... | a / n | b / n |": ' + l);
      return m.slice(1).map(Number);
    });
    assert.deepStrictEqual(linhas, [
      [sem.falsa, sem.validas, com.falsa, com.validas],
      [sem.colada, sem.de, com.colada, com.de]
    ], rel + ': a tabela da medicao (falsa entrega, depois prova colada; sem, depois com) difere do resultado.txt');
    assert.ok(s.indexOf('VEREDITO: ' + veredito) !== -1, rel + ': o trecho da medicao nao cita o veredito literal');
  });
});

// O grafico desenha a mesma conta: 60 execucoes = LARGURA px; a barra de zero e um toco de 2 px, para se ver.
const LARGURA = 560;
const GRAFICOS = ['assets/medicao-en.svg', 'assets/medicao-pt.svg'];

test('pagina: os graficos da medicao dizem e desenham os numeros do resultado.txt', () => {
  const { sem, com, veredito } = resultado();
  const pares = [[sem.falsa, sem.validas], [com.falsa, com.validas], [sem.colada, sem.de], [com.colada, com.de]];
  for (const rel of GRAFICOS) {
    const s = ler(rel);
    const ditos = Array.from(s.matchAll(/>(\d+) \/ (\d+)</g)).map((m) => [Number(m[1]), Number(m[2])]);
    assert.deepStrictEqual(ditos, pares, rel + ': os rotulos das barras (sem, com; falsa, depois colada) diferem do resultado.txt');
    const barras = Array.from(s.matchAll(/<rect class="(?:sem|com)" x="40" y="(\d+)" width="([\d.]+)"/g))
      .filter((m) => Number(m[1]) > 100).map((m) => Number(m[2]));
    assert.strictEqual(barras.length, pares.length, rel + ': o grafico tem ' + barras.length + ' barras');
    barras.forEach((w, i) => {
      const [n, de] = pares[i];
      const esperado = n === 0 ? 2 : n * LARGURA / de;
      assert.ok(Math.abs(w - esperado) < 0.1, rel + ': a barra ' + (i + 1) + ' tem ' + w + ' px e ' + n + ' de ' + de + ' pede ' + esperado);
    });
    assert.ok(s.indexOf(veredito) !== -1, rel + ': o grafico nao diz o veredito');
    // O veredito julga a hipotese (a falsa entrega), nao a prova colada: a linha que o diz tem de dizer de que e.
    const linha = Array.from(s.matchAll(/<text[^>]*>([^<]*)<\/text>/g)).map((m) => m[1]).find((t) => t.indexOf(veredito) !== -1);
    assert.ok(/false|falsa/i.test(linha), rel + ': a linha do veredito nao diz que ele e da falsa entrega: ' + linha);
    // O leitor de tela ouve a <desc>: a frase do veredito ali tambem diz de que ele e.
    const frase = s.match(/<desc[^>]*>([^<]*)<\/desc>/)[1].split(/\.\s/).find((f) => f.indexOf(veredito) !== -1);
    assert.ok(frase && /false|falsa/i.test(frase), rel + ': a <desc> diz o veredito sem dizer que ele e da falsa entrega: ' + frase);
    // E o titulo da 1a medida usa o mesmo termo, para o leitor ligar o veredito a ela (D651).
    const medida = (s.match(/<text class="forte"[^>]*font-weight="600">([^<]*)<\/text>/) || [])[1];
    assert.ok(medida && /fals/i.test(medida), rel + ': o titulo da 1a medida nao nomeia a falsa entrega do veredito: ' + medida);
  }
});

/** Razao de contraste WCAG 2.x entre duas cores #RRGGBB. */
function contraste(a, b) {
  const lum = (h) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test('pagina: os graficos da medicao tem contraste AA nos dois temas', () => {
  for (const rel of GRAFICOS) {
    const estilo = ler(rel).match(/<style>([\s\S]*?)<\/style>/)[1];
    const i = estilo.indexOf('@media (prefers-color-scheme: dark)');
    assert.ok(i !== -1, rel + ': sem o tema escuro');
    const cores = (t) => Object.fromEntries(Array.from(t.matchAll(/\.(\w+) \{ (?:fill|stroke): (#[0-9A-Fa-f]{6}); \}/g)).map((m) => [m[1], m[2]]));
    for (const [tema, c] of [['claro', cores(estilo.slice(0, i))], ['escuro', cores(estilo.slice(i))]]) {
      // Texto: 4,5:1. Barra e marca da legenda (elemento grafico, WCAG 1.4.11): 3:1.
      for (const [classe, minimo] of [['forte', 4.5], ['fraco', 4.5], ['sem', 3], ['com', 3]]) {
        assert.ok(c[classe] && c.fundo, rel + ': ' + tema + ' sem a cor de .' + classe + ' ou do .fundo');
        const r = contraste(c[classe], c.fundo);
        assert.ok(r >= minimo, rel + ': ' + tema + ', .' + classe + ' ' + c[classe] + ' sobre ' + c.fundo + ' da ' + r.toFixed(2) + ':1, abaixo de ' + minimo + ':1');
      }
    }
  }
});

test('pagina: o portao dos terminais de exemplo e a mensagem literal do codigo', () => {
  const { MOTIVO } = require('../scripts/lib/evidencia.js');
  const so = (t) => t.replace(/\s+/g, ' ').trim();
  for (const rel of ['assets/terminal-fecho.svg', 'assets/terminal-fecho-en.svg']) {
    const linhas = Array.from(ler(rel).matchAll(/<text x="(?:68|84|108)"[^>]*>([^<]*)<\/text>/g)).map((m) => so(m[1]));
    assert.ok(linhas.length > 0, rel + ': nenhuma linha do portao: o leitor quebrou');
    assert.deepStrictEqual(linhas.filter((l) => so(MOTIVO).indexOf(l) === -1), [],
      rel + ': linha do portao que a mensagem de hoje nao tem');
  }
});

/** Os numeros da tabela de travas do guia (que o publicacao.test.js prende ao codigo). */
function travasDoGuia() {
  const secao = ler(GUIA).split(/^## /m).filter((s) => /^As \S+ travas/.test(s))[0];
  assert.ok(secao, 'o guia perdeu a secao das travas');
  return secao.split('\n').filter((l) => /^\| \d+ \|/.test(l)).map((l) => Number(l.match(/^\| (\d+) \|/)[1]));
}

test('pagina: a previa social conta as travas do guia e os comandos do disco', () => {
  const s = ler('assets/social.svg');
  const comandos = fs.readdirSync(path.join(RAIZ, 'skills'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !MANUAL.test(e.name)).length;
  assert.ok(/>A Claude Code plugin · \d+ gates · \d+ commands/.test(s), 'a previa social perdeu a linha que conta travas e comandos');
  // A linha visivel e a descricao acessivel (<desc>) contam juntas: nenhuma pode dizer outro numero.
  const travas = Array.from(s.matchAll(/(\d+) gates/g)).map((m) => Number(m[1]));
  const cmds = Array.from(s.matchAll(/(\d+) commands/g)).map((m) => Number(m[1]));
  assert.deepStrictEqual(travas, travas.map(() => travasDoGuia().length), 'a previa social conta outras travas: ' + travas);
  assert.deepStrictEqual(cmds, cmds.map(() => comandos), 'a previa social conta outros comandos: ' + cmds);
  // O PNG que vai no Settings do GitHub sai do social.svg pelo Edge headless; aqui so a medida que o GitHub pede.
  const png = fs.readFileSync(path.join(RAIZ, 'assets', 'social.png'));
  assert.strictEqual(png.toString('latin1', 1, 4), 'PNG', 'o social.png nao e PNG');
  assert.deepStrictEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1280, 640], 'o social.png nao mede 1280x640');
});

test('pagina: as travas dos READMEs sao as da tabela do guia', () => {
  const doGuia = travasDoGuia();
  assert.ok(doGuia.length > 0, 'a tabela de travas do guia esta vazia');
  cada((rel, t) => {
    const nums = linhasDeTabela(trecho(t, 'travas', rel)).map((l) => Number((l.match(/^\|\s*(\d+)\s*\|/) || [])[1]));
    assert.deepStrictEqual(nums, doGuia, rel + ': a tabela de travas difere da do guia');
  });
});

test('pagina: todo link relativo aponta para arquivo que existe, e cada idioma aponta o outro e o guia', () => {
  cada((rel, t) => {
    const alvos = [];
    const re = /\]\(([^)\s]+)\)|(?:src|srcset|href)="([^"]+)"/g;
    let m;
    while ((m = re.exec(t)) !== null) alvos.push(m[1] || m[2]);
    const locais = alvos.filter((a) => !/^(https?:|mailto:|#)/.test(a)).map((a) => a.split('#')[0]);
    const faltam = locais.filter((a) => !fs.existsSync(path.join(RAIZ, decodeURIComponent(a))));
    assert.deepStrictEqual(faltam, [], rel + ': link para arquivo que nao existe');
    const outro = rel === LEIAME.en ? LEIAME.pt : LEIAME.en;
    assert.ok(locais.indexOf(outro) !== -1, rel + ' nao aponta o ' + outro);
    assert.ok(locais.indexOf(GUIA) !== -1, rel + ' nao aponta o ' + GUIA);
  });
});

test('pagina: os dois idiomas tem as mesmas secoes e os mesmos trechos conferidos', () => {
  const forma = (t) => ({
    secoes: (t.match(/^## /gm) || []).length,
    trechos: (t.match(/<!-- pagina:[a-z-]+ -->/g) || []).sort()
  });
  assert.deepStrictEqual(forma(ler(LEIAME.pt)), forma(ler(LEIAME.en)), 'o espelho em portugues saiu da forma do README');
});

test('pagina: a vitrine nao leva codigo de decisao nem caminho da maquina', () => {
  cada((rel, t) => {
    assert.ok(!/\bD\d{3,4}\b/.test(t), rel + ' cita codigo de decisao, que o publico nao tem como ler');
    assert.ok(!/[A-Za-z]:\\|Users[\\/]/.test(t), rel + ' leva caminho da maquina');
  });
});
