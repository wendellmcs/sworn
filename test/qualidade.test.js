'use strict';
const test = require('node:test');
const assert = require('node:assert');
const q = require('../scripts/lib/qualidade.js');

const REGRAS = ['1. Conclusao na 1a linha.', '2. Sem preambulo nem cortesia.', '3. Termo tecnico explicado na 1a vez.',
  '4. Entre ferramentas, uma linha:', '5. Evidencia: no bloco, so a linha que prova.',
  '6. Nao repetir o que o usuario acabou de ler ou decidir:'];

test('qualidade: as 6 regras na ordem, a linha de idioma e a de desligar', () => {
  let ultimo = -1;
  for (const r of REGRAS) {
    const i = q.BLOCO.indexOf(r);
    assert.ok(i > ultimo, 'regra fora do bloco ou fora de ordem: ' + r);
    ultimo = i;
  }
  // D656 (camada 1): a linha de idioma manda responder no idioma do usuario, nao so diz onde as regras valem
  assert.ok(/^Reply in the user's language; the rules hold in any\. /m.test(q.BLOCO), 'sumiu a linha de idioma');
  assert.ok(/^Desligar neste projeto: /m.test(q.BLOCO), 'sumiu a linha de desligar');
});

test('qualidade: o bloco e ASCII puro (texto de hook)', () => {
  assert.ok(/^[\x20-\x7E\n]+$/.test(q.BLOCO), 'caractere fora de ASCII no bloco');
});

test('qualidade: o bloco cabe no teto; crescer e decisao do dono', () => {
  assert.ok(q.BLOCO.length <= q.TETO, 'bloco com ' + q.BLOCO.length + ' caracteres, teto ' + q.TETO);
  assert.strictEqual(q.TETO, 1000);
});

test('qualidade: a linha de desligar cita a mesma chave que o codigo le', () => {
  const linha = q.BLOCO.split('\n').filter((l) => /^Desligar/.test(l))[0];
  assert.ok(linha.includes('"' + q.CHAVE + '": false'), linha);
  assert.strictEqual(q.bloco({ [q.CHAVE]: false }), null);
});

test('qualidade: ligado sem projeto, com chave ausente, true ou tipo errado; desligado so com false', () => {
  for (const p of [null, undefined, {}, { [q.CHAVE]: true }, { [q.CHAVE]: 'nao' }, { [q.CHAVE]: 0 },
    { [q.CHAVE]: null }, { [q.CHAVE]: [] }, [], 'texto']) {
    assert.strictEqual(q.bloco(p), q.BLOCO, 'devia sair com ' + JSON.stringify(p));
  }
  assert.strictEqual(q.bloco({ [q.CHAVE]: false }), null);
});

test('qualidade: aviso so para tipo errado', () => {
  for (const p of [null, {}, { [q.CHAVE]: true }, { [q.CHAVE]: false }]) assert.strictEqual(q.avisoDeTipo(p), null);
  for (const v of ['nao', 0, null, []]) {
    assert.strictEqual(q.avisoDeTipo({ [q.CHAVE]: v }), 'qualidadeDeResposta tem de ser true ou false');
  }
});

// -- o instrumento de fecho: a resposta que segue o bloco passa na trava --
//
// Eram os testes da skill `economia`, que saiu na 0.4.0: la os exemplos vinham do texto da skill. Agora o
// bloco da abertura (regras 1 e 5) e que ensina, e os exemplos sao fixtures daqui. O que se prova e a
// colisao: "evidencia vira o numero que prova", lido ao pe da letra, da resposta curta SEM bloco de saida,
// e a trava de fecho barra exatamente isso.
const evidencia = require('../scripts/lib/evidencia.js');

const FENCE = '```';
const FIXTURES = {
  // conclusao na 1a linha, uma linha de evidencia dentro do bloco, o resumo que prova
  fecho: [
    'Passou. O modulo novo tem 20 testes e a suite nao regrediu.',
    '',
    FENCE,
    'tests 12 | pass 12 | fail 0',
    FENCE,
    '',
    'Fora do escopo, registrado e nao corrigido: o mesmo caminho existe em outro modulo.'
  ].join('\n'),
  // entrega com parte nao rodada, que segue honesta sendo curta
  naoRodou: [
    'Implementado e testado no Windows. Nao rodei em Linux nem em macOS - declaro como nao testado.',
    '',
    FENCE,
    'tests 12 | pass 12 | fail 0',
    FENCE
  ].join('\n')
};

test('qualidade: as fixtures de fecho existem e abrem pela conclusao, sem preambulo', () => {
  const todas = Object.values(FIXTURES);
  assert.ok(todas.length >= 2, 'esperava ao menos 2 fixtures de fecho');
  for (const f of todas) {
    const primeira = f.split('\n')[0];
    assert.ok(primeira.trim().length > 0, 'a 1a linha da fixture esta vazia');
    assert.ok(!/^(vou|otima|espero|conforme|segue)\b/i.test(primeira), 'preambulo na 1a linha: ' + primeira);
  }
});

/**
 * O teste central. Se algum dia a fixture perder o bloco de saida, a suite reprova aqui - e nao em
 * producao, uma rodada por vez.
 */
test('qualidade: NENHUMA fixture que segue o bloco e barrada pela trava de fecho', () => {
  for (const [nome, f] of Object.entries(FIXTURES)) {
    assert.strictEqual(evidencia.deveBloquear(f), false, 'a fixture "' + nome + '" seria bloqueada:\n' + f);
  }
});

/**
 * Um teste verde que nao exercita nada e pior do que teste nenhum: se nenhuma fixture afirmasse sucesso,
 * o teste acima passaria por vacuidade para sempre.
 */
test('qualidade: ao menos uma fixture alega sucesso E carrega bloco, e uma declara o que nao rodou', () => {
  const analises = Object.values(FIXTURES).map((f) => evidencia.analisar(f));
  assert.ok(analises.some((a) => a.alegaSucesso && a.temBloco),
    'nenhuma fixture exercita o caminho que a trava de fecho vigia');
  assert.ok(analises.some((a) => a.declaraNaoRodou), 'falta a fixture que declara o que NAO rodou');
});

/** Controle negativo: prova que o instrumento acima sabe reprovar. */
test('qualidade: a mesma fixture de sucesso sem o bloco de codigo SERIA barrada - o instrumento nao e cego', () => {
  const semBloco = FIXTURES.fecho.replace(/```[\s\S]*?```/g, '');
  assert.ok(evidencia.analisar(semBloco).alegaSucesso, 'a fixture sem bloco tem de seguir alegando sucesso');
  assert.strictEqual(evidencia.deveBloquear(semBloco), true,
    'tirar o bloco tinha de bloquear; se nao bloqueia, o teste central nao prova nada');
});
