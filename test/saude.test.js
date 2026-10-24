'use strict';
const test = require('node:test');
const assert = require('node:assert');
const saude = require('../scripts/lib/saude.js');

test('saude: sessao nova nao dispara nada', () => {
  const r = saude.avaliar({});
  assert.strictEqual(r.disparou, false);
  assert.deepStrictEqual(r.gatilhos, []);
  assert.strictEqual(r.aviso, null);
});

test('saude: basta UM gatilho, nao a soma', () => {
  const r = saude.avaliar({ contadores: { revisao_fechada: 2 } });
  assert.strictEqual(r.disparou, true);
  assert.strictEqual(r.gatilhos.length, 1);
});

test('saude: 2 revisoes independentes fechadas disparam', () => {
  assert.strictEqual(saude.avaliar({ contadores: { revisao_fechada: 2 } }).disparou, true);
  assert.strictEqual(saude.avaliar({ contadores: { revisao_fechada: 1 } }).disparou, false);
});

test('saude: turnos com trabalho real disparam no limiar', () => {
  const limiares = { turnosComTrabalho: 12 };
  assert.strictEqual(saude.avaliar({ turnosComTrabalho: 11 }, limiares).disparou, false);
  assert.strictEqual(saude.avaliar({ turnosComTrabalho: 12 }, limiares).disparou, true);
});

test('saude: soma de bloqueios de portao dispara', () => {
  const e = { contadores: { fora_do_escopo: 3, comando_destrutivo: 2, fecho_sem_evidencia: 1 } };
  const r = saude.avaliar(e, { bloqueios: 5 });
  assert.strictEqual(r.disparou, true);
  assert.ok(r.gatilhos.some((g) => g.includes('bloqueio')));
});

test('saude: nome do gatilho aparece no aviso, para nao virar sensacao', () => {
  const r = saude.avaliar({ contadores: { revisao_fechada: 2 } });
  assert.ok(r.aviso.includes('revis'));
  assert.ok(r.aviso.includes('/sworn:handoff'));
  assert.ok(/^[\x20-\x7E\n]+$/.test(r.aviso), 'aviso tem de ser ASCII (R5)');
});

test('saude: dois gatilhos ao mesmo tempo saem os dois no aviso', () => {
  const r = saude.avaliar({ turnosComTrabalho: 99, contadores: { revisao_fechada: 9 } });
  assert.strictEqual(r.gatilhos.length, 2);
});

test('saude: limiares do projeto sobrescrevem os padroes', () => {
  assert.strictEqual(saude.avaliar({ turnosComTrabalho: 3 }, { turnosComTrabalho: 3 }).disparou, true);
  assert.strictEqual(saude.avaliar({ turnosComTrabalho: 3 }).disparou, false);
});

test('saude: avisa uma vez so por sessao', () => {
  const e = { contadores: { revisao_fechada: 2 }, avisouSaude: true };
  assert.strictEqual(saude.avaliar(e).disparou, false);
});

// ------------------------------- T10-2/T10-3 (D357): decisao do dono e commit contam

test('T10-2: tres decisoes do dono respondidas disparam, e duas nao', () => {
  const dois = saude.avaliar({ decisoesDoDono: 2 });
  assert.strictEqual(dois.disparou, false);
  const tres = saude.avaliar({ decisoesDoDono: 3 });
  assert.strictEqual(tres.disparou, true);
  assert.deepStrictEqual(tres.gatilhos, ['3 decisoes do dono respondidas (limiar 3)']);
  assert.strictEqual(saude.LIMIARES_PADRAO.decisoesDoDono, 3);
});

test('T10-3: tres commits na sessao disparam, e dois nao', () => {
  const dois = saude.avaliar({ commitsFeitos: 2 });
  assert.strictEqual(dois.disparou, false);
  const tres = saude.avaliar({ commitsFeitos: 3 });
  assert.strictEqual(tres.disparou, true);
  assert.deepStrictEqual(tres.gatilhos, ['3 commits nesta sessao (limiar 3)']);
  assert.strictEqual(saude.LIMIARES_PADRAO.commits, 3);
});

test('T10-2/3: o projeto sobrescreve os dois limiares, e o aviso segue ASCII', () => {
  assert.strictEqual(saude.avaliar({ decisoesDoDono: 1 }, { decisoesDoDono: 1 }).disparou, true);
  assert.strictEqual(saude.avaliar({ commitsFeitos: 1 }, { commits: 1 }).disparou, true);
  const r = saude.avaliar({ decisoesDoDono: 5, commitsFeitos: 5 });
  assert.strictEqual(r.gatilhos.length, 2);
  assert.ok(/^[\x20-\x7E\n]+$/.test(r.aviso), 'aviso tem de ser ASCII (R5)');
});

test('T10-2/3: valor que nao e numero no estado nunca dispara (estado corrompido nao vira aviso)', () => {
  assert.strictEqual(saude.avaliar({ decisoesDoDono: { campo: 'x' }, commitsFeitos: 'muitos' }).disparou, false);
});

// ------------------------------- D412: o prompt do handoff vai ao chat

test('D412: arquivo de handoff = .md com data na frente e "handoff" no nome ou na pasta', () => {
  for (const p of [
    '.claude/sworn/handoff/2026-10-10-sworn-decisor-local-bateria-s35.md',
    'C:\\obra\\app\\.context\\plans\\2026-10-10-item4-fechado-handoff.md',
    '/c/proj/sworn/.context/plans/2026-10-08-sworn-pendencias-sequencia-unica-handoff.md',
    'plans/2026-10-10-HANDOFF-x.MD'
  ]) assert.strictEqual(saude.ehArquivoDeHandoff(p), true, p);
  for (const p of [
    'skills/handoff/SKILL.md',              // a skill, nao um handoff
    '.claude/sworn/handoff/notas.md',     // sem data na frente
    'docs/handoff.md',
    '.context/plans/2026-10-10-plano.md',    // data sem "handoff"
    '.context/plans/2026-10-10-x-handoff.txt',
    'handoff/2026-10-10-x.md.bak',
    '', null, undefined, 42, { file_path: 'x' }
  ]) assert.strictEqual(saude.ehArquivoDeHandoff(p), false, String(p));
});

test('D412: bloco de codigo = cerca em linha propria com corpo nao vazio, de qualquer linguagem', () => {
  for (const t of [
    'Prompt:\n```\nRetomando o sworn\n```',
    'Prompt:\n```text\nRetomando\nlinha 2\n```\nfim',
    '  ```md\n# titulo\n  ```',
    '~~~\nRetomando\n~~~',
    // revisao da sessao 41: a cerca sem fecho vai ate o fim do texto (CommonMark) - o prompt esta
    // visivel em bloco; fecho mais longo que a abertura fecha; fecho mais curto nao fecha; CRLF.
    '```\nabre e nunca fecha',
    '````\nRetomando\n`````',
    '```\nRetomando\n``\n',
    '```\r\nRetomando\r\n```\r\n',
    '```\n~~~\n',                     // cerca de outro caractere e corpo, nao fecho
    // ronda 2: cerca dentro de citacao e de item de lista (CommonMark mostra o bloco)
    '> ```\n> Retomando\n> ```',
    '- ```\n  Retomando\n  ```',
    '1. ```\n   Retomando\n   ```'
  ]) assert.strictEqual(saude.temBlocoDeCodigo(t), true, JSON.stringify(t));
  for (const t of [
    'sem bloco nenhum',
    'so `codigo` inline',
    '```\n   \n```',                 // corpo vazio
    'texto ```inline``` no meio',
    '```x``` e inline\nmais uma linha', // crase na info string: nao abre cerca (CommonMark)
    '```\n  \n',                     // sem fecho e corpo vazio
    '````\n\n`````',                 // fecho mais longo fecha: corpo vazio
    '```\r\n\r\n```\r\n',            // CRLF: o fecho fecha, corpo vazio
    '', null, undefined, 7
  ]) assert.strictEqual(saude.temBlocoDeCodigo(t), false, JSON.stringify(t));
});

// D417 (registro da revisao da sessao 41): as bordas do CommonMark que a 0.5.3 nao seguia.
test('D417: recuo da cerca ate 3 colunas (relativo ao item de lista), fim da citacao, linha so ">", NBSP', () => {
  for (const t of [
    '   ```\nRetomando\n   ```',                  // 3 espacos ainda e cerca
    '1. passo\n    ```\n    Retomando\n    ```',  // 4 espacos sob "1. " = 1 coluna dentro do item
    '- passo\n\n  ```\n  Retomando\n  ```',
    '```\n    ```\n',                              // fecho com 4 espacos e corpo, nao fecho
    '> ```\n> Retomando\n\nfim',                   // o corpo veio antes de a citacao acabar
    '> > ```\n> > Retomando\n> > ```',
    '> ```\n> > Retomando\n> ```',                 // `>` a mais dentro da citacao e corpo
    '```\n>\n```',                                 // linha so `>` fora de citacao e corpo
    '```\n> ```\n```',                             // `> ```` fora de citacao e corpo, nao fecho
    '```\n \n```'                             // NBSP e conteudo (CommonMark: branco e so espaco e tab)
  ]) assert.strictEqual(saude.temBlocoDeCodigo(t), true, JSON.stringify(t));
  for (const t of [
    'texto\n    ```\n    Retomando\n    ```',    // 4 espacos fora de lista nao abre cerca
    '    ```\nRetomando',
    '\t```\nRetomando',                           // tab = 4 colunas
    '> ```\n\nTexto qualquer depois',              // a citacao acabou com a cerca vazia
    '> ```\nTexto sem marca\n```',                 // idem; o ``` da ultima linha abre cerca vazia
    '> ```\n>\n> ```',                             // linha so `>` DENTRO da citacao e vazia
    '```\n \t \n```',
    '- item\n\nfora da lista\n\n    ```\n    Retomando\n    ```', // a lista acabou: 4 espacos e bloco recuado
    '1. item\n>     ```\n>     Retomando\n>     ```' // a citacao nao herda a coluna da lista de fora
  ]) assert.strictEqual(saude.temBlocoDeCodigo(t), false, JSON.stringify(t));
});

// Revisao da sessao 44: o tab depois de `>` conta a partir da coluna real (CommonMark), nao da 0.
test('D417: tab depois da marca de citacao - a coluna e a real, e o espaco opcional sai do tab', () => {
  for (const t of [
    '>\t```\n>\tRetomando\n>\t```',   // `>` na coluna 0, tab ate a 4: 3 colunas, 1 e o espaco opcional = recuo 2
    '> \t```\n> \tRetomando',          // espaco opcional, tab da coluna 2 ate a 4 = recuo 2
    '>    ```\n>    Retomando'          // controle: `>` + 4 espacos = espaco opcional + recuo 3 (ja era assim)
  ]) assert.strictEqual(saude.temBlocoDeCodigo(t), true, JSON.stringify(t));
  for (const t of [
    '>\t\t```\n>\t\tRetomando',        // 3 + 4 = 7 colunas, menos o espaco opcional = 6: bloco recuado
    '>     ```\n>     Retomando'        // controle: `>` + 5 espacos = recuo 4 (ja era assim)
  ]) assert.strictEqual(saude.temBlocoDeCodigo(t), false, JSON.stringify(t));
});

test('D417: arquivosTocados que nao e lista nunca dispara (estado corrompido nao vira aviso)', () => {
  assert.strictEqual(saude.avaliar({ arquivosTocados: 'x'.repeat(30) }).disparou, false);
  assert.strictEqual(saude.avaliar({ arquivosTocados: { length: 99 } }).disparou, false);
  const lista = Array.from({ length: 25 }, (_, i) => 'a' + i + '.js');
  assert.strictEqual(saude.avaliar({ arquivosTocados: lista }).disparou, true, 'controle: 25 arquivos disparam');
});

test('D412: com o prompt ja colado, a instrucao da saude nao manda colar de novo', () => {
  const g = ['3 decisoes do dono respondidas (limiar 3)'];
  const normal = saude.instrucaoAoModelo(g);
  assert.ok(normal.indexOf('/sworn:handoff') !== -1 && /Cole o prompt/.test(normal), 'controle: ' + normal);
  for (const t of [saude.instrucaoAoModelo(g, true)]) {
    assert.ok(t.indexOf(g[0]) !== -1, 'tem de citar o gatilho: ' + t);
    assert.ok(/chat novo/.test(t), 'tem de mandar dizer que e hora de abrir chat novo: ' + t);
    assert.ok(!/Cole o prompt/.test(t), 'mandou colar de novo: ' + t);
    assert.ok(!/Rode \/sworn:handoff/.test(t), 'mandou rodar o handoff de novo: ' + t);
    assert.ok(/nao cole/.test(t) && /acima/.test(t), 'tem de mandar apontar para o bloco acima: ' + t);
    assert.ok(/sigo/.test(t), 'tem de proibir o "sigo?": ' + t);
    assert.ok(/^[\x20-\x7E\n]+$/.test(t), 'tem de ser ASCII (R5): ' + JSON.stringify(t));
  }
  // so `true` muda: valor truthy de estado corrompido nao tira a ordem de colar
  assert.strictEqual(saude.instrucaoAoModelo(g, 'sim'), normal);
});

test('D412: o motivo do bloqueio diz o que fazer, como desligar, e e ASCII', () => {
  const m = saude.MOTIVO_HANDOFF_SEM_PROMPT;
  assert.ok(/handoff/.test(m) && /bloco/.test(m), m);
  assert.ok(m.indexOf('"portaoHandoff": false') !== -1, 'tem de dizer como desligar (D415): ' + m);
  assert.ok(/^[\x20-\x7E\n]+$/.test(m), 'tem de ser ASCII (R5): ' + JSON.stringify(m));
  assert.ok(saude.BALDES_DE_BLOQUEIO.indexOf('handoff_sem_prompt') !== -1, 'o balde novo nega: entra na soma');
});

// D445 (0.6.2): 7o gatilho, por tamanho do contexto. O Stop nao recebe o tamanho: recebe o transcript_path.
// Contexto = input + cache_read + cache_creation do ultimo `usage` da linha principal (a conta da medicao da s73).
const fsT = require('node:fs');
const osT = require('node:os');
const pathT = require('node:path');

function transcript(linhas) {
  const dir = fsT.mkdtempSync(pathT.join(osT.tmpdir(), 'sworn-ctx-'));
  const f = pathT.join(dir, 's.jsonl');
  fsT.writeFileSync(f, linhas.map(function (l) { return typeof l === 'string' ? l : JSON.stringify(l); }).join('\n') + '\n');
  return { f: f, fim: function () { fsT.rmSync(dir, { recursive: true, force: true }); } };
}
function uso(i, cr, cw, extra) {
  return Object.assign({ type: 'assistant', message: { usage: { input_tokens: i, cache_read_input_tokens: cr, cache_creation_input_tokens: cw, output_tokens: 9 } } }, extra || {});
}

test('D475: limiar padrao do contexto e 175000 tokens (era 250000, D464), com alarme em 450000', () => {
  assert.strictEqual(saude.LIMIARES_PADRAO.tokensDeContexto, 175000);
  assert.strictEqual(saude.LIMIARES_PADRAO.tokensAlarme, 450000);
});

test('D464: o alarme sai uma vez a partir de 450000, mesmo depois do aviso de saude', () => {
  const abaixo = saude.avaliar({ avisouSaude: true, tokensDeContexto: 449999 });
  assert.strictEqual(abaixo.disparou, false);
  const r = saude.avaliar({ avisouSaude: true, tokensDeContexto: 452000 });
  assert.strictEqual(r.disparou, true);
  assert.strictEqual(r.alarme, true);
  assert.ok(/ALARME/.test(r.aviso), r.aviso);
  assert.ok(r.gatilhos.some(function (g) { return /452000 tokens de contexto \(alarme 450000\)/.test(g); }), JSON.stringify(r.gatilhos));
  assert.ok(/^[\x20-\x7E\n]+$/.test(r.aviso), 'aviso ASCII (R5)');
  // uma vez so: com o alarme dado, nada mais sai
  assert.strictEqual(saude.avaliar({ avisouSaude: true, avisouAlarme: true, tokensDeContexto: 600000 }).disparou, false);
  // valor que nao e numero nunca vira alarme
  assert.strictEqual(saude.avaliar({ avisouSaude: true, tokensDeContexto: '500000' }).disparou, false);
});

test('D464: acima do alarme sem aviso anterior, sai um aviso so - o de alarme, com o gatilho de tamanho', () => {
  const r = saude.avaliar({ tokensDeContexto: 460000 });
  assert.strictEqual(r.disparou, true);
  assert.strictEqual(r.alarme, true);
  assert.ok(/ALARME/.test(r.aviso), r.aviso);
  assert.ok(r.gatilhos.some(function (g) { return /460000 tokens de contexto \(alarme 450000\)/.test(g); }), JSON.stringify(r.gatilhos));
  // abaixo do alarme o aviso e o comum, sem ALARME
  const comum = saude.avaliar({ tokensDeContexto: 300000 });
  assert.strictEqual(comum.disparou, true);
  assert.strictEqual(comum.alarme, false);
  assert.ok(!/ALARME/.test(comum.aviso), comum.aviso);
});

// Plano 083 (p7-21): avisoDeSaude e exportada; sem lista de gatilhos (nula, ausente ou vazia) nao ha aviso, como no
// avaliar - antes a nula lancava TypeError e a vazia saia um ALARME sem motivo.
test('083 T6 (p7-21): avisoDeSaude sem gatilho devolve null, sem lancar; com gatilho segue igual', () => {
  for (const g of [null, undefined, [], 'x']) {
    for (const alarme of [false, true]) assert.strictEqual(saude.avisoDeSaude(g, alarme), null, JSON.stringify(g) + ' ' + alarme);
  }
  assert.match(saude.avisoDeSaude(['3 decisoes'], false), /^sworn - hora de abrir chat novo\.\n/);
});

test('D464: o alarme respeita o limiar do projeto', () => {
  assert.strictEqual(saude.avaliar({ avisouSaude: true, tokensDeContexto: 310000 }, { tokensAlarme: 300000 }).alarme, true);
  assert.strictEqual(saude.avaliar({ avisouSaude: true, tokensDeContexto: 310000 }).disparou, false);
});

test('D445: contextoDoTranscript soma input + cache_read + cache_creation do ULTIMO usage da linha principal', () => {
  const t = transcript([uso(1, 1000, 2000), { type: 'user', message: { content: 'x' } }, uso(2, 140000, 12000),
    uso(5, 1, 1, { isSidechain: true }), uso(0, 0, 0), 'linha torta {', '']);
  try {
    // a do subagente (isSidechain) e a sintetica (tudo zero) e a torta nao contam
    assert.strictEqual(saude.contextoDoTranscript(t.f), 152002);
  } finally { t.fim(); }
});

test('D445: contextoDoTranscript le so a cauda (transcript grande) e devolve null sem leitura', () => {
  const enchimento = 'x'.repeat(2000);
  const linhas = [uso(1, 1, 1)];
  for (let i = 0; i < 600; i++) linhas.push({ type: 'user', message: { content: enchimento } });
  linhas.push(uso(10, 160000, 0));
  const t = transcript(linhas);
  try {
    assert.strictEqual(saude.contextoDoTranscript(t.f), 160010);
  } finally { t.fim(); }
  assert.strictEqual(saude.contextoDoTranscript(null), null);
  assert.strictEqual(saude.contextoDoTranscript(pathT.join(osT.tmpdir(), 'nao-existe-sworn.jsonl')), null);
  const vazio = transcript([{ type: 'user', message: { content: 'oi' } }]);
  try { assert.strictEqual(saude.contextoDoTranscript(vazio.f), null); } finally { vazio.fim(); }
});

test('D445: o gatilho de contexto cruza no limiar, respeita o do projeto e ignora valor que nao e numero', () => {
  const g = function (e, L) { return saude.medir(e, L).find(function (x) { return x.chave === 'tokensDeContexto'; }); };
  assert.strictEqual(g({ tokensDeContexto: 174999 }).cruzou, false);
  assert.strictEqual(g({ tokensDeContexto: 175000 }).cruzou, true);
  assert.strictEqual(g({ tokensDeContexto: 90000 }, { tokensDeContexto: 80000 }).cruzou, true);
  assert.strictEqual(g({ tokensDeContexto: '200000' }).cruzou, false);
  assert.strictEqual(g({ tokensDeContexto: '200000' }).valor, 0);
  const r = saude.avaliar({ tokensDeContexto: 176000 });
  assert.strictEqual(r.disparou, true);
  assert.ok(/176000 tokens de contexto \(limiar 175000\)/.test(r.aviso), r.aviso);
  assert.ok(/^[\x20-\x7E\n]+$/.test(r.aviso), 'aviso ASCII (R5)');
});

// D634 (7b/8): os testes da cauda do transcript - o ultimo rodado e se a prova declarada rodou depois da ultima edicao.
// Forma medida na s129: comando com saida diferente de 0 volta com is_error true e "Exit code N" no conteudo.
function cmd(id, comando, extra) {
  return Object.assign({ type: 'assistant', message: { content: [{ type: 'tool_use', id: id, name: 'Bash', input: { command: comando } }] } }, extra || {});
}
function res(id, conteudo, erro) {
  return { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: conteudo, is_error: erro === true }] } };
}
function edita(id, arquivo, nome) {
  return { type: 'assistant', message: { content: [{ type: 'tool_use', id: id, name: nome || 'Edit', input: { file_path: arquivo } }] } };
}

test('D634: testesDoTranscript acha o ultimo teste rodado e se ele falhou (pelo is_error ou pela saida)', () => {
  const t = transcript([cmd('a', 'npm test'), res('a', 'Exit code 1\n# fail 2', true), cmd('b', 'ls'), res('b', 'x')]);
  try {
    assert.deepStrictEqual(saude.testesDoTranscript(t.f, null).ultimoTeste, { comando: 'npm test', falhou: true });
  } finally { t.fim(); }
  const passou = transcript([cmd('a', 'npm test'), res('a', 'Exit code 1', true), cmd('b', 'node --test test/'), res('b', '# pass 3\n# fail 0')]);
  try {
    assert.deepStrictEqual(saude.testesDoTranscript(passou.f, null).ultimoTeste, { comando: 'node --test test/', falhou: false });
  } finally { passou.fim(); }
  // saida 0 por causa do pipe, mas a saida mostra falha
  const pipe = transcript([cmd('a', 'npm test 2>&1 | tail -5'), res('a', '# pass 1\n# fail 2')]);
  try { assert.strictEqual(saude.testesDoTranscript(pipe.f, null).ultimoTeste.falhou, true); } finally { pipe.fim(); }
  // linha de subagente nao conta; PowerShell conta como Bash
  const sub = transcript([cmd('a', 'pytest -q'), res('a', '3 passed'), cmd('b', 'pytest -q', { isSidechain: true }), res('b', 'Exit code 1', true)]);
  try { assert.strictEqual(saude.testesDoTranscript(sub.f, null).ultimoTeste.falhou, false); } finally { sub.fim(); }
  const ps = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'p', name: 'PowerShell', input: { command: 'npm test' } }] } };
  const tps = transcript([ps, res('p', 'Exit code 1', true)]);
  try { assert.strictEqual(saude.testesDoTranscript(tps.f, null).ultimoTeste.falhou, true); } finally { tps.fim(); }
  // is_error sozinho basta; conteudo em lista de blocos de texto tambem e lido
  const erro = transcript([cmd('a', 'npm test'), res('a', 'algo deu errado', true)]);
  try { assert.strictEqual(saude.testesDoTranscript(erro.f, null).ultimoTeste.falhou, true); } finally { erro.fim(); }
  const lista = transcript([cmd('a', 'npm test'), res('a', [{ type: 'text', text: '# pass 1' }, { type: 'text', text: '# fail 3' }])]);
  try { assert.strictEqual(saude.testesDoTranscript(lista.f, null).ultimoTeste.falhou, true); } finally { lista.fim(); }
});

test('D634: sem teste na cauda, ultimoTeste e null; sem transcript legivel, a funcao devolve null', () => {
  const t = transcript([cmd('a', 'git status'), res('a', 'ok')]);
  try { assert.strictEqual(saude.testesDoTranscript(t.f, null).ultimoTeste, null); } finally { t.fim(); }
  assert.strictEqual(saude.testesDoTranscript(null, null), null);
  assert.strictEqual(saude.testesDoTranscript(pathT.join(osT.tmpdir(), 'nao-existe-sworn.jsonl'), 'npm test'), null);
});

test('D634: provaPendente quando a prova declarada nao rodou depois da ultima edicao de codigo', () => {
  const prova = 'cd "Meu App"; node tools/run.mjs --group=all';
  const rodaProva = '( cd "Meu App" && node tools/run.mjs --group=all )';
  const casos = [
    [[edita('e', 'src/a.js')], true, 'editou e nunca rodou'],
    [[cmd('a', rodaProva), res('a', 'ok'), edita('e', 'src/a.js')], true, 'rodou antes da edicao'],
    [[edita('e', 'src/a.js'), cmd('a', rodaProva), res('a', 'ok')], false, 'rodou depois da edicao'],
    [[cmd('a', rodaProva), res('a', 'ok'), edita('e', 'docs/notas.md')], false, 'so editou documento'],
    [[cmd('a', 'git status'), res('a', 'ok')], false, 'nao editou nada'],
    [[edita('e', 'src/a.js'), cmd('a', 'node tools/outro.mjs'), res('a', 'ok')], true, 'rodou outro comando'],
    [[edita('e', 'src/b.ts', 'Write'), cmd('a', rodaProva), res('a', 'ok'), edita('f', 'src/c.ts', 'MultiEdit')], true, 'MultiEdit tambem edita'],
    [[cmd('a', rodaProva), res('a', 'ok'), edita('e', 'src/b.ts', 'Write')], true, 'Write tambem edita'],
    [[edita('e', 'src/a.js'), cmd('a', 'node tools/run.mjs --group=all'), res('a', 'ok')], false, 'o cd do agente e dele: sem cd tambem e a prova']
  ];
  for (const [linhas, esperado, nome] of casos) {
    const t = transcript(linhas);
    try { assert.strictEqual(saude.testesDoTranscript(t.f, prova).provaPendente, esperado, nome); } finally { t.fim(); }
  }
  // sem prova declarada nao ha pendencia; a prova declarada conta como teste mesmo fora da lista fixa
  const t = transcript([edita('e', 'src/a.js'), cmd('a', rodaProva), res('a', 'Exit code 1', true)]);
  try {
    const r = saude.testesDoTranscript(t.f, prova);
    assert.deepStrictEqual(r.ultimoTeste, { comando: rodaProva, falhou: true });
    assert.strictEqual(saude.testesDoTranscript(t.f, null).provaPendente, false);
  } finally { t.fim(); }
  // prova de dois passos: rodar so um deles nao e rodar a prova
  const meia = transcript([edita('e', 'src/a.js'), cmd('a', 'npm test'), res('a', '# fail 0')]);
  try { assert.strictEqual(saude.testesDoTranscript(meia.f, 'npm run build && npm test').provaPendente, true); } finally { meia.fim(); }
});
