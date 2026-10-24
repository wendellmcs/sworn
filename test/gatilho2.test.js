'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const regra = require('../scripts/lib/regra.js');

const RAIZ = path.join(__dirname, '..');
const SKILL = path.join(RAIZ, 'skills', 'playbook', 'SKILL.md');

function texto() { return fs.readFileSync(SKILL, 'utf8'); }

/** So a secao do gatilho 2, para as assercoes nao passarem por acaso com
 *  texto de outra parte do manual. */
function secao() {
  const t = texto();
  const i = t.indexOf('## 2-ter.');
  assert.ok(i !== -1, 'a secao do gatilho 2 nao esta na skill');
  const j = t.indexOf('\n## ', i + 1);
  return t.slice(i, j === -1 ? t.length : j);
}

test('gatilho 2: a secao existe na skill do padrao', () => {
  assert.ok(texto().includes('## 2-ter.'));
});

/**
 * O achado que fechou o H1, e a razao de esta secao existir: medir num
 * subagente mede outra coisa. Ele recebe a propria identidade, nunca o
 * catalogo. Se a skill nao proibir a delegacao, alguem vai delegar.
 */
test('gatilho 2: a skill manda rodar no agente principal e PROIBE delegar', () => {
  const s = secao();
  assert.ok(/agente principal/i.test(s), 'nao diz onde roda');
  assert.ok(/subagente/i.test(s), 'nao fala de subagente');
  assert.ok(/(nunca|nao) a? ?delegue|nunca delegue/i.test(s), 'nao proibe a delegacao: ' + s.slice(0, 200));
});

test('gatilho 2: a skill avisa do verde falso do subagente', () => {
  assert.ok(/verde falso/i.test(secao()), 'nao diz o que da errado ao delegar');
});

/** A segunda armadilha medida no H1: a sonda colou a tabela do proprio projeto. */
test('gatilho 2: a skill proibe tirar nome de modelo de arquivo do projeto', () => {
  const s = secao();
  assert.ok(/arquivo do projeto/i.test(s), 'nao avisa da contaminacao pelo projeto');
  assert.ok(/mente/i.test(s), 'nao diz que a conferencia mente nesse caso');
});

test('gatilho 2: a skill le o mapa do disco, por comando, e nao de memoria', () => {
  const s = secao();
  assert.ok(s.includes('portao-apelido.js'), 'nao manda rodar o que imprime o mapa');
  assert.ok(/de memoria|de mem[oó]ria/i.test(s), 'nao proibe ler de memoria');
});

test('gatilho 2: o comando que a skill manda rodar existe de verdade', () => {
  // Sem isto a skill pode envelhecer apontando para um script que sumiu, e
  // ninguem percebe ate alguem tentar rodar.
  assert.ok(fs.existsSync(path.join(RAIZ, 'scripts', 'portao-apelido.js')));
});

test('gatilho 2: a skill trata divergencia como sinal, nao como veredito', () => {
  const s = secao();
  assert.ok(/detector de fumaca|detector de fuma[çc]a/i.test(s));
  assert.ok(/dono/i.test(s), 'nao diz quem decide');
});

test('gatilho 2: a skill proibe gravar a conclusao na configuracao sozinha', () => {
  const s = secao();
  assert.ok(/projeto\.json/.test(s), 'nao nomeia o arquivo que nao se escreve sozinho');
  assert.ok(/3 op[çc][õo]es|3 opcoes/i.test(s), 'nao manda levar em 3 opcoes ao dono');
});

/** Spec 9.6: prometer garantia onde ha instrucao e a mentira que o relatorio
 *  de cobertura depois teria de desmentir. */
test('gatilho 2: a skill declara que isto e instrucao e pode ser pulada', () => {
  const s = secao();
  assert.ok(/pode ser pulada/i.test(s));
  assert.ok(/garantid/i.test(s), 'nao diz qual e a guarda garantida');
});

test('gatilho 2: sem catalogo do harness, a skill manda DECLARAR', () => {
  assert.ok(/degradado/i.test(secao()), 'nao preve o caso de nao haver catalogo');
});

/**
 * A secao mais arriscada do plugin inteiro para a regra dos volateis: ela FALA
 * de catalogo de modelos. Um exemplo ilustrativo com nome de modelo dentro
 * dela seria exatamente o fato volatil que o plugin promete nao guardar.
 */
test('gatilho 2: a secao nao crava nome de modelo nenhum', () => {
  const sujas = [];
  for (const linha of secao().split(/\r?\n/)) {
    for (const vol of regra.VOLATEIS) {
      if (vol.tipo === 'nome de modelo' && vol.re.test(linha)) sujas.push(linha.trim());
    }
  }
  assert.deepStrictEqual(sujas, [], 'fato volatil na secao do gatilho 2');
});

/**
 * Os padroes sao MONTADOS por concatenacao, nunca escritos inteiros.
 * `test/` entra na superficie que o detector de sanitacao varre - `FORA_DO_PUBLICO`
 * so exclui `docs/` - entao um padrao escrito por extenso aqui viraria, ele proprio,
 * um vazamento encontrado. Mesma tecnica ja usada em test/sanitacao.test.js.
 */
test('gatilho 2: a secao nao vaza dono, maquina nem projeto de origem', () => {
  const s = secao();
  const padroes = [
    'wen' + 'del', 'smart' + 'space', 'C:' + '\\\\Users', 'App' + 'Data', 'Projeto' + ' KB'
  ];
  for (const p of padroes) {
    assert.ok(!new RegExp(p, 'i').test(s), 'a secao casa ' + p);
  }
});
