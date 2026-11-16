'use strict';
// R3d (D833, pedidos 21 e 146): o gancho de entrada lembra o idioma quando o dono escreve num e a ultima resposta saiu
// em outro (scripts/lib/idioma.js, chamado em scripts/abrir-turno.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const idioma = require('../scripts/lib/idioma.js');
const { pasta, rodar } = require('./lib/comum.js');

const PT = 'Preciso que você veja isso agora, porque ainda não está como eu pedi e tem que ficar pronto hoje.';
const EN = 'I fixed the gate and the tests pass; this is what changed in the code, and it should work for you now.';

function transcricao(dir, nome, linhas) {
  const f = path.join(dir, nome + '.jsonl');
  fs.writeFileSync(f, linhas.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return f;
}
const resposta = (texto, extra) => Object.assign({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: texto }] } }, extra || {});
const usoDeFerramenta = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }] } };

test('R3d: detectar diz pt ou en pelas palavras frequentes; curto, misturado ou sem texto da null', () => {
  assert.strictEqual(idioma.detectar(PT), 'pt');
  assert.strictEqual(idioma.detectar(EN), 'en');
  assert.strictEqual(idioma.detectar('siga'), null, 'curto demais');
  assert.strictEqual(idioma.detectar('publique'), null);
  assert.strictEqual(idioma.detectar(PT + ' ' + EN), null, 'misturado meio a meio');
  assert.strictEqual(idioma.detectar(null), null);
  assert.strictEqual(idioma.detectar(42), null);
  // o codigo, o caminho e o endereco nao contam como prosa
  assert.strictEqual(idioma.detectar('Veja `the and is to of you that with` e ```\nthe and is to of\n``` agora'), null);
  assert.strictEqual(idioma.detectar('Rodei https://the.and.is/to/of/you/that e ficou pronto'), null);
  // 5 palavras do portugues e um caminho com 8 do ingles: contado como prosa, o ingles passaria e sairia null
  assert.strictEqual(idioma.detectar('Agora isso já está pronto para você: scripts/the/and/is/to/of/you/that/with.js'), 'pt');
  // os limites: 3 acertos nao bastam, 4 sim; o vencedor precisa do dobro do outro
  assert.strictEqual(idioma.detectar('que para com'), null, '3 acertos');
  assert.strictEqual(idioma.detectar('que para com uma'), 'pt', '4 acertos');
  assert.strictEqual(idioma.detectar('que para com uma the and'), 'pt', '4 contra 2: o dobro');
  assert.strictEqual(idioma.detectar('que para com uma the and you'), null, '4 contra 3: menos que o dobro');
  assert.strictEqual(idioma.detectar(''), null);
  // o espanhol divide palavras com o portugues e nao pode virar portugues
  assert.strictEqual(idioma.detectar('Necesito que el código esté listo ahora, pero no hay tiempo para hacer todo como quiero.'), null);
  // 5 acertos do portugues (que, para, como, por, que) e 4 so do espanhol: sem a regra do espanhol, sairia pt
  assert.strictEqual(idioma.detectar('Necesito que el código esté listo para hoy, pero no hay tiempo; como dije, por favor que funcione.'), null);
  // so palavras que o espanhol tambem escreve (que, para, mas, por) nao bastam: o portugues precisa de 2 so dele
  assert.strictEqual(idioma.detectar('Dime que pasa con eso, para mas tarde, por favor'), null);
  assert.strictEqual(idioma.detectar('que para por como com'), null, '1 so do portugues');
  assert.strictEqual(idioma.detectar('que para por como com uma'), 'pt', '2 so do portugues');
  // o bloco de codigo que abre antes do teto e fecha depois dele nao conta como prosa
  const log = '```\n' + 'the and is to of you that with this for '.repeat(100) + '\n```';
  assert.strictEqual(idioma.detectar(PT + '\n' + log + '\nPronto?'), 'pt');
  // "preciso" e "vamos" o espanhol tambem escreve
  assert.strictEqual(idioma.detectar('Preciso que nos digas por que vamos a retrasarlo para mas tarde.'), null);
  // a cerca solta no meio da frase nao e bloco de codigo e nao corta o texto
  assert.strictEqual(idioma.detectar('Ok~~~ isso não está como eu pedi, você pode ver agora?'), 'pt');
  assert.strictEqual(idioma.detectar('Veja ``` isso não está como eu pedi, você pode ver agora?'), 'pt');
  // uma palavra so do espanhol, citada num texto em portugues, nao muda nada
  assert.strictEqual(idioma.detectar('Você viu que o log diz gracias e não está como eu pedi para hoje?'), 'pt');
  assert.strictEqual(idioma.detectar('Você pode ver isso? Não está como eu pedi, mas já tem quase tudo pronto para hoje.'), 'pt');
  // o texto colado enorme (sem espaco nem barra) nao trava: so o comeco conta
  const inicio = Date.now();
  assert.strictEqual(idioma.detectar(PT + ' ' + 'a'.repeat(300000)), 'pt');
  assert.ok(Date.now() - inicio < 2000, 'demorou ' + (Date.now() - inicio) + ' ms');
});

test('R3d: ultimaResposta acha o ultimo texto do assistente, pulando o uso de ferramenta e o subagente', () => {
  const dir = pasta('idioma-transc');
  const f = transcricao(dir, 't', [resposta('primeira'), { type: 'user', message: { role: 'user', content: 'oi' } },
    resposta('a ultima de verdade'), usoDeFerramenta, resposta('do subagente', { isSidechain: true })]);
  assert.strictEqual(idioma.ultimaResposta(f), 'a ultima de verdade');
  assert.strictEqual(idioma.ultimaResposta(path.join(dir, 'nao-existe.jsonl')), null);
  assert.strictEqual(idioma.ultimaResposta(null), null);
  assert.strictEqual(idioma.ultimaResposta(transcricao(dir, 'vazia', [usoDeFerramenta])), null);
  // a linha truncada no fim (o harness no meio da escrita) e pulada; vale a ultima resposta inteira antes dela
  const truncada = path.join(dir, 'truncada.jsonl');
  fs.writeFileSync(truncada, JSON.stringify(resposta('a resposta inteira')) + '\n{"type":"assistant","message":{"con');
  assert.strictEqual(idioma.ultimaResposta(truncada), 'a resposta inteira');
  fs.writeFileSync(path.join(dir, 'zero.jsonl'), '');
  assert.strictEqual(idioma.ultimaResposta(path.join(dir, 'zero.jsonl')), null);
});

test('R3d: aviso sai so quando o idioma do dono e o da ultima resposta diferem', () => {
  const dir = pasta('idioma-aviso');
  const emIngles = transcricao(dir, 'en', [resposta(EN)]);
  const emPortugues = transcricao(dir, 'pt', [resposta(PT)]);
  assert.strictEqual(idioma.aviso(PT, emIngles), 'sworn - idioma: o dono escreve em portugues e a sua ultima resposta ' +
    'saiu em ingles. Responda em portugues, inclusive no texto entre as ferramentas.');
  assert.match(idioma.aviso(EN, emPortugues), /o dono escreve em ingles e a sua ultima resposta saiu em portugues\. Responda em ingles/);
  assert.strictEqual(idioma.aviso(PT, emPortugues), null, 'mesmo idioma');
  assert.strictEqual(idioma.aviso('siga', emIngles), null, 'o dono curto demais: nao se afirma');
  assert.strictEqual(idioma.aviso(PT, transcricao(dir, 'curta', [resposta('ok')])), null, 'resposta curta demais');
  assert.strictEqual(idioma.aviso(PT, null), null, 'sem transcricao');
  assert.ok(/^[\x20-\x7E]*$/.test(idioma.aviso(PT, emIngles)), 'ASCII (R5)');
  // pendencia #4: o resumo da compactacao chega como a mensagem do turno, em ingles, e nao e o dono escrevendo
  const resumo = 'This session is being continued from a previous conversation that ran out of context. The summary ' +
    'below covers the earlier portion of the conversation.\n\n' + EN;
  assert.strictEqual(idioma.detectar(resumo), 'en', 'sem o pulo, o resumo leria como o dono em ingles');
  assert.strictEqual(idioma.aviso(resumo, emPortugues), null);
  assert.strictEqual(idioma.aviso('\n  ' + resumo, emPortugues), null, 'com espaco antes');
  // a frase citada no meio da mensagem do dono nao e o resumo: o aviso segue
  assert.match(idioma.aviso(EN + ' This session is being continued from a previous conversation that ran out of context.',
    emPortugues), /o dono escreve em ingles/);
  // pendencia #5: o relatorio de subagente e o aviso de tarefa chegam como a mensagem do turno, e nao sao o dono
  const relatorio = '<agent-message from="a82eb7a2d4ef159aa">\n[Subagent hand-back] The text below is the final report ' +
    'of a subagent this session delegated to.\n  ' + EN + '\n</agent-message>';
  assert.strictEqual(idioma.detectar(relatorio), 'en', 'sem o pulo, o relatorio leria como o dono em ingles');
  assert.strictEqual(idioma.aviso(relatorio, emPortugues), null, 'o relatorio de subagente');
  assert.strictEqual(idioma.aviso('\n ' + relatorio, emPortugues), null, 'o relatorio com espaco antes');
  const tarefa = '<task-notification>\n<task-id>boqsghb7n</task-id>\n<summary>' + EN + '</summary>\n</task-notification>';
  assert.strictEqual(idioma.detectar(tarefa), 'en', 'sem o pulo, o aviso de tarefa leria como o dono em ingles');
  assert.strictEqual(idioma.aviso(tarefa, emPortugues), null, 'o aviso de tarefa em segundo plano');
  // a marca citada no meio da mensagem do dono nao e o relatorio: o aviso segue
  assert.match(idioma.aviso(EN + ' <agent-message from="x">', emPortugues), /o dono escreve em ingles/);
});

test('R3d: pelo gancho de entrada, a linha do idioma chega ao modelo; no mesmo idioma, nada', () => {
  const dir = pasta('idioma-gancho');
  const tmp = pasta('idioma-gancho-tmp');
  const chamar = (prompt, f) => rodar('scripts/abrir-turno.js', [], { cwd: dir, env: { SWORN_TMP: tmp },
    entrada: { session_id: 'i1', cwd: dir, hook_event_name: 'UserPromptSubmit', prompt: prompt, transcript_path: f } });
  const r = chamar(PT, transcricao(dir, 'en', [resposta(EN)]));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /sworn - idioma: o dono escreve em portugues/);
  const igual = chamar(PT, transcricao(dir, 'pt', [resposta(PT)]));
  assert.strictEqual(igual.status, 0, igual.stderr);
  assert.ok(!/sworn - idioma/.test(igual.stdout), igual.stdout);
  // a transcricao que nao se le (uma pasta, um caminho que nao existe) cala a linha e o turno segue
  for (const torto of [dir, path.join(dir, 'nao-existe.jsonl')]) {
    const r = chamar(PT, torto);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(!/sworn - idioma/.test(r.stdout), r.stdout);
  }
});
