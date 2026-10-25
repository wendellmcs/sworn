'use strict';
// D444/D449/D451 (0.6.2): a regra de trabalho em paralelo sai na abertura de toda sessao (a skill portatil
// sozinha foi carregada em 0 de 221 sessoes medidas), no molde do bloco de qualidade de resposta.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const p = require('../scripts/lib/paralelismo.js');
const projetoLib = require('../scripts/lib/projeto.js');

test('paralelismo: o bloco diz seguir sem esperar, isolar quem edita, relatorio e alegacao, freio e a oferta', () => {
  const b = p.BLOCO;
  assert.ok(/^# sworn - trabalho em paralelo/.test(b), 'titulo');
  assert.ok(/segundo plano/.test(b) && /siga com a proxima tarefa que nao depende/.test(b), 'seguir sem esperar');
  assert.ok(/isolation: worktree/.test(b), 'quem edita roda isolado');
  assert.ok(/alegacao/.test(b) && /na fonte/.test(b), 'relatorio de agente e alegacao');
  assert.ok(/mais barato que resolve/.test(b), 'freio: modelo mais barato');
  // Plano 091 #5 (D557, mock D559): roda direto, sem perguntar e sem condicao de init; diz agentes, modelo e custo.
  assert.ok(b.split('\n').indexOf('4. 3 ou mais tarefas independentes: rode o /sworn:parallel direto, sem perguntar; ' +
    'diga numa linha quantos agentes, qual modelo e o custo. Teto de 8 agentes e o modelo mais barato que resolve ' +
    'seguem valendo.') !== -1, 'item 4 do mock: ' + b);
  assert.ok(!/depois do sim|ofereca|init/.test(b), 'sobrou a oferta ou a condicao de init: ' + b);
});

test('paralelismo: o teto do bloco e o mesmo do workflow (um numero so)', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', 'workflows', 'parallel.js'), 'utf8');
  const m = wf.match(/^const TETO_PADRAO = (\d+)$/m);
  assert.ok(m, 'sumiu o TETO_PADRAO do workflow');
  assert.ok(p.BLOCO.indexOf('no maximo ' + m[1] + ' agentes por disparo') !== -1, 'o bloco cita outro teto: ' + p.BLOCO);
  // 091 #5: o item 4 repete o teto; todo "N agentes" do bloco e o mesmo numero
  const tetos = (p.BLOCO.match(/\d+ agentes/g) || []).map(function (x) { return parseInt(x, 10); });
  assert.ok(tetos.length >= 2 && tetos.every(function (n) { return String(n) === m[1]; }), 'tetos no bloco: ' + tetos);
});

test('paralelismo: ASCII puro (texto de hook) e dentro do teto de tamanho', () => {
  assert.ok(/^[\x20-\x7E\n]+$/.test(p.BLOCO), 'caractere fora de ASCII no bloco');
  assert.ok(p.BLOCO.length <= p.TETO, 'bloco com ' + p.BLOCO.length + ' caracteres, teto ' + p.TETO);
  assert.strictEqual(p.TETO, 700);
});

test('paralelismo: ligado sem projeto, chave ausente, true ou tipo errado; so o booleano false desliga', () => {
  for (const v of [null, undefined, {}, { paralelismo: true }, { paralelismo: 'false' }, { paralelismo: 0 }, [], 'x']) {
    assert.strictEqual(p.bloco(v), p.BLOCO, JSON.stringify(v));
  }
  assert.strictEqual(p.bloco({ paralelismo: false }), null);
  const linha = p.BLOCO.split('\n').filter((l) => /^Desligar/.test(l))[0];
  assert.ok(linha && linha.includes('"' + p.CHAVE + '": false'), 'a linha de desligar cita a chave que o codigo le');
});

test('paralelismo: a chave e de liga/desliga do projeto.json (aviso de tipo, nao ignorada)', () => {
  assert.ok(projetoLib.CHAVES_LIGA_DESLIGA.indexOf('paralelismo') !== -1);
  assert.ok(projetoLib.avisosDeTipo({ paralelismo: 'false' }).indexOf('paralelismo tem de ser true ou false') !== -1);
  assert.deepStrictEqual(projetoLib.avisosDeTipo({ paralelismo: false }), []);
});

// Os tres lugares de texto: a skill portatil (regra inteira), o init (pergunta uma vez e grava) e o README.
const lerT = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('paralelismo: a sworn:playbook traz a regra inteira e a oferta do /sworn:parallel', () => {
  const t = lerT('skills/playbook/SKILL.md');
  const i = t.indexOf('## 6-bis. Parallel work');
  const f = t.indexOf('## 7. ');
  assert.ok(i !== -1 && f > i, 'falta a secao 6-bis antes da 7');
  const s = t.slice(i, f);
  for (const trecho of ['background', 'isolation: worktree', 'claim', 'cheapest', '/sworn:parallel', 'cost', '8 agents']) {
    assert.ok(s.indexOf(trecho) !== -1, 'a secao nao diz: ' + trecho);
  }
});

test('paralelismo: o init confere antes, pergunta uma vez em 3 opcoes e grava pelo script', () => {
  const t = lerT('skills/init/SKILL.md');
  const i = t.indexOf('## Step 5c');
  const f = t.indexOf('## Step 6 ');
  assert.ok(i !== -1 && f > i, 'falta o Passo 5c antes do Passo 6');
  const s = t.slice(i, f);
  assert.ok(s.indexOf('autorizar-paralelo.js" --conferir') !== -1, 'falta conferir antes de perguntar');
  assert.ok(/autorizar-paralelo\.js"\n/.test(s.replace(/\r/g, '')), 'falta o comando que grava');
  assert.ok(s.indexOf('"paralelismo": false') !== -1, 'falta a opcao de desligar');
  assert.ok(s.indexOf('Yes, and don') !== -1, 'falta dizer o que a janela da primeira execucao pede no VS Code');
});

test('paralelismo: o README documenta o workflow, a chave e a autorizacao', () => {
  const t = lerT('GUIA.md');
  for (const trecho of ['/sworn:parallel', '`paralelismo`', 'Workflow(sworn:parallel)', 'settings.local.json']) {
    assert.ok(t.indexOf(trecho) !== -1, 'o README nao cita ' + trecho);
  }
});
