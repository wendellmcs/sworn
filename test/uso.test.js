'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'uso.js');

test('uso: projeto sem contadores diz que ainda nao ha dado', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-uso-'));
  try {
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8', timeout: 30000 });
    assert.strictEqual(r.status, 0);
    assert.ok(r.stdout.toLowerCase().includes('nenhum'));
    // A6 (s220, microcopy :15): o vazio diz o que faz o numero subir.
    assert.match(r.stdout, /sobe quando ela barra ou avisa/, r.stdout);
    // A6-02 (D735): o vazio diz o passo.
    assert.match(r.stdout, /Rode de novo depois de alguns turnos de trabalho\./, r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A6 (s220, borda/estados/manutencao :8 e borda :11): so o arquivo ausente e vazio. JSON quebrado, valor que nao e
// objeto simples e erro de leitura saem "ilegivel" com a causa, exit 1; o BOM que o Bloco de Notas poe se le.
test('A6: contadores.json ilegivel diz a causa e sai 1, nunca "nenhum disparo"', () => {
  // A6-06 e A6-09 (D735): o texto do Node entre aspas e marcado como dele; o efeito sem "guarda" nem "recomeca".
  const casos = [['{quebrado', /\(o texto nao e JSON valido; o Node diz: "[^"]/], ['[3,4]', /nao e um objeto/],
    ['"abc"', /nao e um objeto/], ['null', /nao e um objeto/]];
  for (const [conteudo, causa] of casos) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-uso-'));
    try {
      fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'contadores.json'), conteudo, 'utf8');
      const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8', timeout: 30000 });
      assert.strictEqual(r.status, 1, conteudo + ': ' + r.stdout);
      assert.match(r.stderr, /contadores\.json ilegivel \(/, conteudo);
      assert.match(r.stderr, causa, conteudo + ': ' + r.stderr);
      assert.match(r.stderr, /Corrija o JSON: ele tem de ser um objeto, com o nome de cada trava e quantas vezes ela /,
        conteudo);
      assert.match(r.stderr, /poe o arquivo de lado \(renomeado para contadores\.json\.corrompido, sem apagar\) e /,
        conteudo);
      assert.ok(!/guarda|recomeca/.test(r.stderr), conteudo + ': ' + r.stderr);
      assert.ok(!r.stdout.includes('nenhum disparo'), conteudo + ': ' + r.stdout);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('A6: contadores.json que e pasta sai ilegivel com a causa; com BOM se le', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-uso-'));
  try {
    const alvo = path.join(dir, '.claude', 'sworn', 'contadores.json');
    fs.mkdirSync(alvo, { recursive: true });
    let r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8', timeout: 30000 });
    assert.strictEqual(r.status, 1, r.stdout);
    assert.match(r.stderr, /contadores\.json ilegivel \(e uma pasta \(EISDIR\)\)/, r.stderr);
    fs.rmdirSync(alvo);
    fs.writeFileSync(alvo, '﻿' + JSON.stringify({ fora_do_escopo: 3 }), 'utf8');
    r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8', timeout: 30000 });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /3 \| fora_do_escopo/, r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Plano 083 (p4-30): valor que nao e numero no contadores.json nao entra no sort nem na soma; a linha diz que ele e
// invalido, e o total e o dos numeros.
test('083 T6 (p4-30): valor que nao e numero fica fora da soma e da ordem, e a linha diz por que', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-uso-'));
  try {
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'contadores.json'),
      JSON.stringify({ texto: '3', nulo: null, bom: 5, outro: 2 }), 'utf8');
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8', timeout: 30000 });
    assert.strictEqual(r.status, 0, r.stderr);
    const linhas = r.stdout.split('\n').filter((l) => l.includes('|'));
    assert.deepStrictEqual(linhas.map((l) => l.split('|')[1].trim().split(' ')[0]), ['bom', 'outro', 'texto', 'nulo', 'TOTAL']);
    assert.match(r.stdout, /\| TOTAL\n/);
    assert.ok(linhas[linhas.length - 1].trim().startsWith('7 |'), r.stdout);
    assert.ok(linhas.some((l) => /\? \| texto \(nao e numero: "3"\)$/.test(l)), r.stdout);
    assert.ok(linhas.some((l) => /\? \| nulo \(nao e numero: null\)$/.test(l)), r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('uso: lista os disparos em ordem decrescente', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-uso-'));
  try {
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.claude', 'sworn', 'contadores.json'),
      JSON.stringify({ fora_do_escopo: 40, fecho_sem_evidencia: 7, comando_destrutivo: 2 }),
      'utf8'
    );
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8', timeout: 30000 });
    const linhas = r.stdout.split('\n').filter((l) => l.includes('|'));
    assert.ok(linhas[0].includes('fora_do_escopo'), r.stdout);
    assert.ok(r.stdout.includes('49'), 'devia somar o total');
    // A6-02 (D735): o rodape explica a trava e diz o que fazer com os numeros.
    assert.ok(r.stdout.includes('Trava e cada regra do sworn que barra ou avisa uma acao. Use estes numeros para ' +
      'decidir qual manter ou desligar'), r.stdout);
    // A6-84 (D735): o rodape diz como desligar, conferido trava por trava (projeto.TRAVAS e as linhas
    // "Desligar neste projeto" dos avisos).
    // A6-111: a "escopo" nao tem leitor (D104) e saiu do exemplo; o rodape diz que ela nao desliga nada.
    assert.ok(r.stdout.includes('Para desligar fecho, destrutivo e outraFrente, ponha o nome em "travas" no ' +
      '.claude/sworn/projeto.json, como "travas": { "outraFrente": false }; o contador que cada uma desliga diz o ' +
      'nome dela entre parenteses. A chave "escopo" existe, mas nao desliga nada: o mesmo portao guarda os arquivos ' +
      'intocaveis. As outras travas que se desligam dizem como na ultima linha do aviso delas.\n'), r.stdout);
    // A6-111: cada contador que uma chave desliga diz qual; o que nenhuma desliga sai sem o parentese
    assert.deepStrictEqual(linhas.slice(0, 3).map((l) => l.split('|')[1].trim()),
      ['fora_do_escopo', 'fecho_sem_evidencia (desliga com "fecho")', 'comando_destrutivo (desliga com "destrutivo")']);
    assert.ok(!r.stdout.includes('impressao'), r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Plano 091 T6: os contadores de ordem (ordem_<tipo>_<fase>) moram no mesmo arquivo, mas nao sao disparo de trava:
// ficam fora da lista e do total; uma linha diz onde eles aparecem.
test('091 T6: as chaves de ordem ficam fora da lista e do total das travas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-uso-'));
  try {
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'contadores.json'),
      JSON.stringify({ fora_do_escopo: 4, ordem_revisar_dada: 30, ordem_aprender_cumprida: 2, uso_skill_review: 7 }), 'utf8');
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8', timeout: 30000 });
    assert.strictEqual(r.status, 0, r.stderr);
    const linhas = r.stdout.split('\n').filter((l) => l.includes('|'));
    // G4d: o uso da skill tambem fica fora da lista e do total
    assert.deepStrictEqual(linhas.map((l) => l.split('|')[1].trim()), ['fora_do_escopo', 'TOTAL']);
    assert.ok(linhas[1].trim().startsWith('4 |'), r.stdout);
    assert.ok(r.stdout.includes('As ordens (dadas, cumpridas, recusadas) e o uso das skills saem na auditoria ' +
      'automatica.'), r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A6-01: so com contadores de ordem, o filtro zerava os dados e caia no "nenhum disparo" sem citar as ordens.
test('A6-01: o arquivo so com contadores de ordem diz que eles saem na auditoria automatica', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-uso-'));
  try {
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'contadores.json'),
      JSON.stringify({ ordem_revisar_dada: 3, ordem_aprender_cumprida: 1 }), 'utf8');
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8', timeout: 30000 });
    assert.strictEqual(r.status, 0, r.stderr + (r.error ? ' [' + r.error.code + ']' : ''));
    assert.match(r.stdout, /^sworn: nenhum disparo registrado ainda em /, r.stdout);
    assert.ok(r.stdout.endsWith('trabalho.\nO arquivo so tem contadores de ordem (dadas, cumpridas, recusadas) e de ' +
      'uso das skills, que nao sao disparo de trava; eles saem na auditoria automatica.\n'), r.stdout);
    // G4d: so com o uso de uma skill, a mesma frase
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'contadores.json'), JSON.stringify({ uso_skill_review: 2 }), 'utf8');
    const soUso = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8', timeout: 30000 });
    assert.strictEqual(soUso.status, 0, soUso.stderr);
    assert.ok(soUso.stdout.endsWith('que nao sao disparo de trava; eles saem na auditoria automatica.\n'), soUso.stdout);
    // sem ordem nenhuma, a frase das ordens nao sai
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'contadores.json'), '{}', 'utf8');
    const vazio = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8', timeout: 30000 });
    assert.strictEqual(vazio.status, 0, vazio.stderr);
    assert.match(vazio.stdout, /^sworn: nenhum disparo registrado ainda em /, vazio.stdout);
    // a frase, nao a palavra: o caminho da pasta temporaria pode ter "ordem"
    assert.ok(!vazio.stdout.includes('contadores de ordem'), vazio.stdout);
    assert.ok(vazio.stdout.endsWith('trabalho.\n'), vazio.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A6-111: o par contador -> trava do uso.js tem de ser o que os portoes fazem. Cada incremento do contador (a
// chamada, nunca um comentario que cite o nome) tem uma leitura da chave antes dele, sem funcao de topo no meio: a
// leitura e a do mesmo fluxo, e ela sai antes de contar.
test('A6-111: cada contador que o uso.js liga a uma trava so sobe depois da leitura daquela chave', () => {
  const fonte = fs.readFileSync(SCRIPT, 'utf8');
  const mapa = fonte.match(/const TRAVA_DO_CONTADOR = \{([\s\S]*?)\};/);
  assert.ok(mapa, 'o uso.js tem o TRAVA_DO_CONTADOR');
  const pares = [...mapa[1].matchAll(/(\w+): '(\w+)'/g)].map((m) => [m[1], m[2]]);
  assert.ok(pares.length >= 3, mapa[1]);
  // antes do laco, para sair com esta mensagem: a LEITURA abaixo nao tem a escopo
  assert.ok(!pares.some(([, t]) => t === 'escopo'), 'a "escopo" nao tem leitor (D104)');
  const ler = (n) => fs.readFileSync(path.join(path.dirname(SCRIPT), n), 'utf8');
  // O texto de cada leitura, copiado do portao. Se um portao reescrever a leitura, atualize aqui: o teste falha alto
  // ("sem leitura antes"), nunca passa calado.
  const LEITURA = {
    fecho: [['portao-fecho.js', ['travasDe(projeto).fecho === false) return null;', 'if (travas.fecho === false) {']]],
    destrutivo: [['portao-destrutivo.js', ['if (travas.destrutivo === false) return io.permitir();']],
      ['conferir-depois.js', ['projetoLib.travasDe(projeto).destrutivo === false) return io.permitir();']]],
    // os dois `if` que guardam o outra_frente; o deOutraFrente nasce da chave (conferido abaixo)
    outraFrente: [['portao-escopo.js', ['if (deOutraFrente && !escopoLib.dentro(alvo, esc)) {',
      'if (travas.outraFrente !== false && !deOutraFrente && !escopoLib.dentro(alvo, esc)) {']]]
  };
  assert.ok(ler('portao-escopo.js').includes('const deOutraFrente = travas.outraFrente !== false &&'),
    'o deOutraFrente do portao-escopo.js nasce da chave outraFrente');
  // A leitura que retorna com a chave desligada (`=== false`, com o return na linha ou no bloco) guarda o resto da
  // funcao; o `if (...) {` que so roda com a chave ligada guarda so o bloco que abre: da chave dele ate o incremento a
  // profundidade nunca volta a zero (um bloco irmao ou o else, depois de ele fechar, reprova). O texto nao prova o
  // fluxo (chave dentro de texto ou regex desconta); o efeito de cada chave desligada se prova no teste de cada portao.
  const ehCondicao = (l) => !l.includes('=== false');
  const blocoSegueAberto = (s) => {
    let d = 0;
    for (const ch of s) {
      if (ch === '{') d++;
      else if (ch === '}' && --d <= 0) return false;
    }
    return d > 0;
  };
  // a funcao de topo em qualquer forma: function, async function, a guardada num nome e a posta no module.exports
  const FUNCAO_DE_TOPO = /\n(?:async )?function |\n(?:(?:const|let|var) \w+|module\.exports(?:\.\w+)?|exports\.\w+) = (?:async )?(?:function\b|\([^)]*\) =>|\w+ =>)/;
  pares.forEach(([contador, trava]) => {
    assert.ok(LEITURA[trava], contador + ': a trava ' + trava + ' nao tem leitura conhecida');
    const re =new RegExp("incrementar\\([^,]+, '" + contador + "'\\)|contadores\\." + contador + ' = ', 'g');
    let incrementos = 0;
    for (const [arq, leituras] of LEITURA[trava]) {
      const t = ler(arq);
      for (const m of t.matchAll(re)) {
        incrementos++;
        const antes = t.slice(0, m.index);
        const achadas = leituras.map((l) => [antes.lastIndexOf(l), l]).sort((a, b) => b[0] - a[0]);
        const [i, leitura] = achadas[0];
        assert.ok(i !== -1, arq + ': ' + contador + ' sobe sem leitura de "' + trava + '" antes');
        if (ehCondicao(leitura)) {
          assert.ok(blocoSegueAberto(antes.slice(i)),
            arq + ': ' + contador + ' sobe depois de fechar o bloco da condicao "' + leitura + '"');
        }
        assert.ok(!FUNCAO_DE_TOPO.test(antes.slice(i)),
          arq + ': ' + contador + ' sobe noutra funcao, depois da leitura de "' + trava + '"');
      }
    }
    assert.ok(incrementos > 0, contador + ' -> ' + trava + ': o contador nao sobe em nenhum portao dessa chave');
  });
});

// A6-111 (ronda 1): a chave do contadores.json se edita a mao; o nome herdado do objeto nao vira trava.
test('A6-111: contador com nome herdado do objeto ("constructor", "__proto__") sai sem parentese', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-uso-'));
  try {
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'contadores.json'),
      '{"constructor": 3, "__proto__": 2, "toString": 1}', 'utf8');
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8', timeout: 30000 });
    assert.strictEqual(r.status, 0, r.stderr + (r.error ? ' [' + r.error.code + ']' : ''));
    const linhas = r.stdout.split('\n').filter((l) => l.includes('|'));
    assert.deepStrictEqual(linhas.map((l) => l.split('|')[1].trim()), ['constructor', '__proto__', 'toString', 'TOTAL']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
