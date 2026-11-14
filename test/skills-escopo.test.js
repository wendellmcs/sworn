'use strict';
// Lote 2 (D422), IN-08 e DC-05: uma SKILL que manda o agente gravar com Write em
// .claude/sworn/** tem de avisar que, com projeto.json no disco, o portao de escopo
// (trava 4) nega essa gravacao em marcha padrao sem escopo - e o que fazer. Sem o aviso
// o agente trava no meio do roteiro e improvisa. Padrao copiado de init (catalogo.json,
// Passo 7e) e de auditar.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');

function skill(nome) {
  return fs.readFileSync(path.join(RAIZ, 'skills', nome, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
}

/** O texto de uma secao `## <prefixo>...` ate a proxima `## `. */
function secao(texto, prefixo) {
  const partes = texto.split(/^## /m);
  const achada = partes.filter(function (p) { return p.indexOf(prefixo) === 0; })[0];
  assert.ok(achada, 'secao "' + prefixo + '" nao encontrada - o parser quebrou ou a secao mudou de nome');
  return achada;
}

test('init: o re-init manda declarar o escopo antes dos Writes em projeto.json e design.json (IN-08)', () => {
  // F5b (4): as regras do re-init moram em references/reinit.md; o Passo 0b manda le-lo so com o projeto.json no disco
  const s0b = secao(skill('init'), 'Step 0b');
  assert.ok(/read \[`references\/reinit\.md`\]\(references\/reinit\.md\) with the `Read` tool/.test(s0b),
    'Passo 0b nao manda ler o references/reinit.md');
  assert.ok(/Without `projeto\.json`,\s+this is a first init: do not read that file/.test(s0b), 'Passo 0b sem o caso da 1a init');
  const reinit = fs.readFileSync(path.join(RAIZ, 'skills', 'init', 'references', 'reinit.md'), 'utf8').replace(/\r\n/g, '\n');
  for (const [onde, s] of [['o Passo 0b do SKILL.md', s0b], ['o references/reinit.md', reinit]]) {
    assert.ok(/escopo\.md/.test(s), onde + ' nao cita o escopo.md');
    assert.ok(/Dentro/.test(s), onde + ' nao diz que vai em "Dentro"');
    assert.ok(s.includes('.claude/sworn/projeto.json'), onde + ' nao lista o projeto.json no escopo');
    assert.ok(s.includes('.claude/sworn/design.json'), onde + ' nao lista o design.json no escopo');
  }
  assert.ok(/Three rules that apply only in a re-init/.test(reinit) && /In Step 8, before closing, remove again/.test(reinit),
    'o reinit.md sem as regras ou sem o desfazer do Passo 8');
});

test('init: Passo 5b e Passo 7 lembram do escopo no ponto do Write (IN-08)', () => {
  const init = skill('init');
  for (const prefixo of ['Step 5b', 'Step 7 ']) {
    const s = secao(init, prefixo);
    assert.ok(/escopo\.md/.test(s) && /Step 0b/.test(s),
      prefixo + ' manda gravar sem lembrar do escopo do re-init (Passo 0b)');
  }
});

test('revisar: avisa que o portao de escopo pode negar o Write em revisao/** e diz o que fazer (DC-05)', () => {
  const r = skill('review');
  assert.ok(r.includes('.claude/sworn/revisao/**'),
    'o revisar nao diz que o escopo precisa cobrir .claude/sworn/revisao/**');
  assert.ok(/scope gate/.test(r), 'o revisar nao nomeia o portao que nega');
});
