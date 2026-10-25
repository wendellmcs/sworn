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
  const s0b = secao(skill('init'), 'Step 0b');
  assert.ok(/escopo\.md/.test(s0b), 'Passo 0b nao cita o escopo.md');
  assert.ok(/Dentro/.test(s0b), 'Passo 0b nao diz que vai em "Dentro"');
  assert.ok(s0b.includes('.claude/sworn/projeto.json'), 'Passo 0b nao lista o projeto.json no escopo');
  assert.ok(s0b.includes('.claude/sworn/design.json'), 'Passo 0b nao lista o design.json no escopo');
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
