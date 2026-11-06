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

// A5-70: cada item do aviso diz o que conta, sem termo solto (o de bloqueios ja dizia, desde o A5-14).
test('A5-70: turnos, revisoes, decisoes e tokens dizem o que contam', () => {
  const r = saude.avaliar({ turnosComTrabalho: 15, contadores: { revisao_fechada: 2 }, decisoesDoDono: 3,
    tokensDeContexto: 120000 }, { tokensDeContexto: 100000 });
  assert.deepStrictEqual(r.gatilhos, [
    '15 turnos com trabalho real (respostas em que o Claude leu, buscou, editou ou rodou algo) nesta sessao' +
      ' (limiar 15)',
    '2 revisoes independentes fechadas (revisoes as cegas do /sworn:review concluidas) nesta sessao (limiar 2)',
    '3 decisoes do dono respondidas (respostas as perguntas de escolha do Claude) nesta sessao (limiar 3)',
    '120000 tokens de contexto, o tamanho desta conversa (limiar 100000)']);
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
  assert.deepStrictEqual(tres.gatilhos,
    ['3 decisoes do dono respondidas (respostas as perguntas de escolha do Claude) nesta sessao (limiar 3)']);
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
    '.claude/sworn/handoff/2026-10-10-sworn-decisor-local-bateria-s35.md',   // a pasta antiga segue valendo
    '.sworn/handoff/2026-11-05-frente.md',                                    // D788: a pasta nova
    'C:\\obra\\app\\.context\\plans\\2026-10-10-item4-fechado-handoff.md',
    '/c/proj/sworn/.context/plans/2026-10-08-sworn-pendencias-sequencia-unica-handoff.md',
    'plans/2026-10-10-x-HANDOFF.MD'
  ]) assert.strictEqual(saude.ehArquivoDeHandoff(p), true, p);
  for (const p of [
    // s338 (achado retomar.js:338): "handoff" no meio do nome e o assunto, nao o tipo: o plano da D786 virava handoff
    '.context/plans/2026-11-04-esquadro-pendencias-d786-handoff-sem-chat-novo-plano.md',
    'plans/2026-10-10-HANDOFF-x.MD',
    'skills/handoff/SKILL.md',              // a skill, nao um handoff
    '.claude/sworn/handoff/notas.md',     // sem data na frente
    'docs/handoff.md',
    '.context/plans/2026-10-10-plano.md',    // data sem "handoff"
    '.context/plans/2026-10-10-x-handoff.txt',
    'handoff/2026-10-10-x.md.bak',
    '', null, undefined, 42, { file_path: 'x' }
  ]) assert.strictEqual(saude.ehArquivoDeHandoff(p), false, String(p));
});

// s363 (F8, dshg3: o grok no dsh gravou o handoff com as barras invertidas dobradas, que o Windows aceita; sem
// reconhecer o arquivo, a sessao ficava sem a marca do handoff e a compactacao nao mandava rele-lo).
test('s363: barras repetidas no caminho nao escondem o arquivo de handoff', () => {
  for (const p of [
    'C:\\\\proj\\\\.sworn\\\\handoff\\\\2025-06-06-d786-vivo.md',
    'C:\\proj\\.sworn\\handoff\\\\2026-11-06-x.md',
    '/c/proj//.sworn//handoff//2026-11-06-x.md',
    'C:\\\\proj\\\\.context\\\\plans\\\\2026-11-06-x-handoff.md'
  ]) assert.strictEqual(saude.ehArquivoDeHandoff(p), true, p);
  assert.strictEqual(saude.ehArquivoDeHandoff('C:\\\\proj\\\\skills\\\\handoff\\\\SKILL.md'), false);
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
    assert.ok(/segue nesta conversa/.test(t), 'tem de mandar dizer que o trabalho segue (D786): ' + t);
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

// A5-13, A5-14 e A5-15 (D735): o aviso de troca diz o que e o numero e o passo, sem giria; o bloqueio diz o que e;
// o motivo do handoff sem "Voce gravou", "tis" nem "portao de fecho".
test('A5-13/14/15: aviso de troca e motivo do handoff em palavras claras', () => {
  const linhas = saude.avisoDeSaude(['3 decisoes do dono respondidas (limiar 3)'], false).split('\n');
  assert.strictEqual(linhas[2],
    'O sworn faz contas nesta conversa, e o que esta abaixo chegou ao limite (o numero depois de "limiar"):');
  // D786 passo 2: sem o "troque agora"; depois da lista vem direto o passo
  assert.strictEqual(linhas[4], '');
  assert.strictEqual(linhas[5], 'Faca assim: nada, voce nao precisa agir.');
  assert.ok(!/harness/.test(linhas.join('\n')), 'jargao no aviso ao usuario');
  // s335 (revisao, microcopy): no alarme, compactar e o atalho opcional, nao uma contradicao com o "nada".
  assert.ok(saude.avisoDeSaude(['x (limiar 1)'], true).split('\n').indexOf('Faca assim: nada e obrigatorio; para ' +
    'baixar o custo ja, compacte a conversa (/compact; no Qwen Code, /compress).') !== -1);
  const r = saude.avaliar({ contadores: { fora_do_escopo: 6 } }, { bloqueios: 6 });
  assert.ok(r.gatilhos.indexOf('6 bloqueios de portao (acoes que o sworn negou) nesta sessao (limiar 6)') !== -1,
    r.gatilhos.join(' | '));
  const m = saude.MOTIVO_HANDOFF_SEM_PROMPT;
  assert.ok(!/Voce gravou|tis\)|portao de fecho|O portao/.test(m), m);
  assert.ok(m.indexOf('Um arquivo de handoff foi gravado neste turno, ' +
    'e a resposta final nao tem bloco de codigo.') !== -1, m);
  assert.ok(m.indexOf('Esta trava do fim do turno le so a resposta final:') !== -1, m);
  assert.ok(m.indexOf('Faca assim: cole o prompt agora num bloco de codigo (entre ``` ou ~~~), nesta resposta ' +
    'final - uma vez so.') !== -1, m);
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
  assert.match(saude.avisoDeSaude(['3 decisoes'], false),
    /^sworn - hora do handoff: o trabalho segue nesta conversa\.\n/);
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
  assert.ok(/176000 tokens de contexto, o tamanho desta conversa \(limiar 175000\)/.test(r.aviso), r.aviso);
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

// D785 (2.1b, bateria s327): o Opus rodou `npm test` depois de editar, o package.json da fixture diz que o `test` e o
// `node --test` declarado, e o laco da prova barrou 9 de 12 rodadas a toa (um turno e ~US$ 0,02 cada).
test('D785 (2.1b): provasEquivalentes - o script test do package.json vale como a provaDePronto, nos dois sentidos', () => {
  const dir = fsT.mkdtempSync(pathT.join(osT.tmpdir(), 'sworn-prova-'));
  const pacote = (test) => fsT.writeFileSync(pathT.join(dir, 'package.json'), JSON.stringify({ scripts: { test } }));
  try {
    assert.deepStrictEqual(saude.provasEquivalentes('node --test', dir), ['node --test'], 'sem package.json, so a prova');
    pacote('node  --test ');
    const prova = saude.provasEquivalentes('node --test', dir);
    for (const forma of ['npm test', 'npm run test', 'pnpm test', 'yarn test']) {
      assert.ok(prova.includes(forma), forma + ': ' + JSON.stringify(prova));
    }
    assert.deepStrictEqual(saude.provasEquivalentes(' npm  test', dir), [' npm  test', 'node  --test '],
      'a prova pelo npm vale rodando o script direto');
    pacote('eslint .');
    assert.deepStrictEqual(saude.provasEquivalentes('node --test', dir), ['node --test'], 'script diferente nao vale');
    fsT.writeFileSync(pathT.join(dir, 'package.json'), '{ quebrado');
    assert.deepStrictEqual(saude.provasEquivalentes('npm test', dir), ['npm test'], 'package.json quebrado nao lanca');
    fsT.writeFileSync(pathT.join(dir, 'package.json'), '﻿' + JSON.stringify({ scripts: { test: 'node --test' } }));
    assert.ok(saude.provasEquivalentes('node --test', dir).includes('npm test'), 'package.json com BOM vale');
    for (const v of [null, undefined, '', '  ', 7]) assert.strictEqual(saude.provasEquivalentes(v, dir), null, String(v));
    assert.deepStrictEqual(saude.provasEquivalentes('npm test', null), ['npm test'], 'sem raiz, so a prova');
  } finally { fsT.rmSync(dir, { recursive: true, force: true }); }
  const t = transcript([edita('e', 'src/a.js'), cmd('a', 'npm test 2>$null | Select-String fail'), res('a', '# fail 0')]);
  try {
    assert.strictEqual(saude.testesDoTranscript(t.f, ['node --test', 'npm test']).provaPendente, false, 'qualquer forma vale');
    assert.strictEqual(saude.testesDoTranscript(t.f, ['node --test']).provaPendente, true, 'lista de uma forma e a prova');
    assert.strictEqual(saude.testesDoTranscript(t.f, []).provaPendente, false, 'lista vazia e sem prova');
  } finally { t.fim(); }
  // R1 da revisao s328 (borda): o casamento e por pedaco de texto, e `npm run test` caberia dentro de outro script.
  const formas = ['node --test', 'npm test', 'npm run test', 'pnpm test'];
  for (const [comando, esperado] of [['npm run test:unit', true], ['pnpm test-e2e', true], ['npm run test.x', true],
    ['npm run test:unit && npm run test', false], ['npm test -- --grep x', false], ['npm run test', false]]) {
    const u = transcript([edita('e', 'src/a.js'), cmd('a', comando), res('a', '# fail 0')]);
    try { assert.strictEqual(saude.testesDoTranscript(u.f, formas).provaPendente, esperado, comando); } finally { u.fim(); }
  }
  // a fronteira vale so para as formas do script test; a prova declarada segue casando por pedaco, como antes
  const dir2 = transcript([edita('e', 'src/a.js'), cmd('a', 'node --test test/a.test.js'), res('a', '# fail 0')]);
  try { assert.strictEqual(saude.testesDoTranscript(dir2.f, ['node --test test/']).provaPendente, false); } finally { dir2.fim(); }
});

// P2 da s329: o script test do package.json e a prova se comparam sem a opcao do sandbox, como no testesDoTranscript;
// P2 da s328: `pnpm run test` e `yarn run test` rodam teste (o ultimo teste da sessao os ve).
test('D785 (s330): provasEquivalentes ignora --test-isolation=none dos dois lados; pnpm/yarn run test contam como teste', () => {
  const dir = fsT.mkdtempSync(pathT.join(osT.tmpdir(), 'sworn-prova-'));
  const pacote = (test) => fsT.writeFileSync(pathT.join(dir, 'package.json'), JSON.stringify({ scripts: { test } }));
  try {
    pacote('node --test --test-isolation=none');
    assert.ok(saude.provasEquivalentes('node --test', dir).includes('npm test'), 'script com a opcao, prova sem');
    pacote('node --test');
    assert.ok(saude.provasEquivalentes('node --test --experimental-test-isolation none', dir).includes('yarn test'),
      'prova com a opcao, script sem');
    pacote('node --test test/');
    assert.deepStrictEqual(saude.provasEquivalentes('node --test', dir), ['node --test'], 'script diferente segue nao valendo');
  } finally { fsT.rmSync(dir, { recursive: true, force: true }); }
  for (const c of ['pnpm run test', 'yarn run test']) {
    const t = transcript([edita('e', 'src/a.js'), cmd('a', c), res('a', '# fail 1', true)]);
    try {
      assert.deepStrictEqual(saude.testesDoTranscript(t.f, 'node --test').ultimoTeste, { comando: c, falhou: true }, c);
    } finally { t.fim(); }
  }
});

// D785 (s328): no sandbox do Codex o node --test sai com spawn EPERM. O ultimo teste leva a marca (o sandbox barrou o
// executor, nao o codigo), e a prova rodada sem processo filho (--test-isolation=none) segue sendo a prova.
test('D785: testesDoTranscript marca o teste barrado pelo sandbox e aceita a prova com --test-isolation=none', () => {
  const t = transcript([edita('e', 'src/a.js'), cmd('a', 'node --test test/'), res('a', 'Error: spawn EPERM\n# fail 1', true)]);
  try {
    assert.deepStrictEqual(saude.testesDoTranscript(t.f, 'node --test test/').ultimoTeste,
      { comando: 'node --test test/', falhou: true, barradoPeloSandbox: true });
  } finally { t.fim(); }
  for (const c of ['node --test --test-isolation=none test/', 'node --test --experimental-test-isolation=none test/']) {
    const u = transcript([edita('e', 'src/a.js'), cmd('a', c), res('a', '# fail 0')]);
    try { assert.strictEqual(saude.testesDoTranscript(u.f, 'node --test test/').provaPendente, false, c); } finally { u.fim(); }
  }
  const outra = transcript([edita('e', 'src/a.js'), cmd('a', 'node --test --test-isolation=none lib/'), res('a', '# fail 0')]);
  try {
    assert.strictEqual(saude.testesDoTranscript(outra.f, 'node --test test/').provaPendente, true, 'outra pasta segue pendente');
  } finally { outra.fim(); }
  // P2 de seguranca da s328 (refutado na s329): editar o script test (echo ok), rodar npm test e voltar o script nao
  // vale pela prova, porque o package.json conta como codigo (NAO_E_CODIGO) e a volta deixa a prova pendente; sem a
  // volta, o script lido no fim ja nao e a prova. Limite de sempre: edicao feita por comando de shell nao se ve.
  const pacote = (id, nome) => edita(id, 'C:/app/' + nome, 'Write');
  for (const [linhas, esperado, nome] of [
    [[edita('e', 'src/a.js'), pacote('p', 'package.json'), cmd('a', 'npm test'), res('a', 'ok'), pacote('q', 'package.json')],
      true, 'editou o package.json e rodou o npm test'],
    [[edita('e', 'src/a.js'), pacote('p', 'package.json'), cmd('a', 'node --test'), res('a', '# fail 0')], false,
      'a prova declarada segue valendo'],
    [[edita('e', 'src/a.js'), pacote('p', 'package.jsonc'), cmd('a', 'npm test'), res('a', 'ok')], false, 'outro arquivo']]) {
    const w = transcript(linhas);
    try { assert.strictEqual(saude.testesDoTranscript(w.f, ['node --test', 'npm test']).provaPendente, esperado, nome); }
    finally { w.fim(); }
  }
  // P2 da s328: prova feita so de separadores nao tem pedaco, e o every da lista vazia casava com qualquer comando
  const sep = transcript([edita('e', 'src/a.js'), cmd('a', 'ls'), res('a', 'x')]);
  try {
    for (const p of [';;', ' && ', ['node --test', '||']]) {
      assert.strictEqual(saude.testesDoTranscript(sep.f, p).ultimoTeste, null, 'ls nao e teste: ' + JSON.stringify(p));
    }
    assert.strictEqual(saude.testesDoTranscript(sep.f, ';;').provaPendente, false, 'sem pedaco e sem prova declarada');
    assert.strictEqual(saude.testesDoTranscript(sep.f, ['node --test', ';']).provaPendente, true, 'a forma de verdade fica');
  } finally { sep.fim(); }
  // R1 da revisao s329 (correcao): a prova declarada com a opcao segue casando, com ou sem ela no comando
  for (const [p, c] of [['node --test --test-isolation=none test/', 'node --test --test-isolation=none test/'],
    ['node --test --test-isolation=none test/', 'node --test test/'], ['node --test test/', 'node --test --test-isolation none test/']]) {
    const v = transcript([edita('e', 'src/a.js'), cmd('a', c), res('a', '# fail 0')]);
    try { assert.strictEqual(saude.testesDoTranscript(v.f, p).provaPendente, false, p + ' / ' + c); } finally { v.fim(); }
  }
});

// D704 (pedido 14): o handoff so depois que os agentes em segundo plano da sessao terminarem. Sinal medido nas sondas
// s173/s174: <sessao>/subagents/agent-<id>.meta.json nasce sem `finished` e ganha "finished": true ao terminar; o
// parado por TaskStop nao ganha, e a ultima linha do .jsonl dele e "[Request interrupted by user for tool use]".
const { spawnSync: spawnT } = require('node:child_process');
const TRABALHANDO = [
  { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'tarefa' }] } },
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'node x.js' } }] } }
];
const INTERROMPIDO = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } };
const fundo = function (descricao, extra) {
  return Object.assign({ agentType: 'sworn:reader', description: descricao, requestShape: 'background' }, extra || {});
};
// <config>/projects/p/sessao-x.jsonl e a pasta da sessao ao lado, como o Claude Code grava; espaco no caminho de proposito.
function sessaoComAgentes(agentes) {
  const base = fsT.mkdtempSync(pathT.join(osT.tmpdir(), 'sworn agentes-'));
  const dir = pathT.join(base, 'projects', 'p');
  const sub = pathT.join(dir, 'sessao-x', 'subagents');
  fsT.mkdirSync(sub, { recursive: true });
  fsT.writeFileSync(pathT.join(dir, 'sessao-x.jsonl'), '');
  for (const a of agentes) {
    if (a.meta !== undefined) {
      fsT.writeFileSync(pathT.join(sub, 'agent-' + a.id + '.meta.json'), typeof a.meta === 'string' ? a.meta : JSON.stringify(a.meta));
    }
    if (!a.linhas) continue;
    const f = pathT.join(sub, 'agent-' + a.id + '.jsonl');
    fsT.writeFileSync(f, a.linhas.map(function (l) { return JSON.stringify(l) + '\n'; }).join(''));
    if (a.mtime) fsT.utimesSync(f, a.mtime / 1000, a.mtime / 1000);
  }
  return { base: base, transcricao: pathT.join(dir, 'sessao-x.jsonl'), sub: sub,
    fim: function () { fsT.rmSync(base, { recursive: true, force: true }); } };
}

test('D704: agentesRodando conta so o de fundo sem finished, nao parado e com escrita recente', () => {
  const agora = Date.now();
  const s = sessaoComAgentes([
    { id: 'a1', meta: fundo('Inspetor R1 correcao'), linhas: TRABALHANDO },
    { id: 'a2', meta: fundo('Ja terminou', { finished: true }), linhas: TRABALHANDO },
    { id: 'a3', meta: fundo('Parado pelo TaskStop'), linhas: TRABALHANDO.concat([INTERROMPIDO]) },
    { id: 'a4', meta: fundo('Morto sem marca'), linhas: TRABALHANDO, mtime: agora - saude.SILENCIO_DO_AGENTE_MS - 60000 },
    { id: 'a5', meta: { agentType: 'Explore', description: 'Primeiro plano', requestShape: 'foreground' }, linhas: TRABALHANDO },
    { id: 'a6', meta: '{torto', linhas: TRABALHANDO },
    { id: 'a7', meta: fundo('Recem-nascido, sem .jsonl ainda') },
    { id: 'a8', meta: fundo('Inventário só leitura'), linhas: TRABALHANDO },
    { id: 'a9', meta: fundo('Interrompido e retomado'), linhas: TRABALHANDO.concat([INTERROMPIDO]).concat(TRABALHANDO) }
  ]);
  try {
    fsT.writeFileSync(pathT.join(s.sub, 'agent-a1.txt'), 'nao e meta');
    assert.deepStrictEqual(saude.agentesRodando(s.transcricao, agora), [
      { id: 'a1', descricao: 'Inspetor R1 correcao' },
      { id: 'a7', descricao: 'Recem-nascido, sem .jsonl ainda' },
      { id: 'a8', descricao: 'Inventário só leitura' },
      { id: 'a9', descricao: 'Interrompido e retomado' }
    ]);
  } finally { s.fim(); }
  // sem pasta da sessao, sem caminho ou caminho que nao e texto: lista vazia, nunca lanca
  const vazia = sessaoComAgentes([]);
  try {
    fsT.rmSync(pathT.join(vazia.sub, '..'), { recursive: true, force: true });
    assert.deepStrictEqual(saude.agentesRodando(vazia.transcricao, agora), []);
  } finally { vazia.fim(); }
  for (const c of [undefined, null, '', 42, {}]) assert.deepStrictEqual(saude.agentesRodando(c, agora), [], JSON.stringify(c));
});

test('D704: o limite de silencio do agente e de 30 min (medido: p99 de 156 s em 1523 agentes terminados)', () => {
  assert.strictEqual(saude.SILENCIO_DO_AGENTE_MS, 30 * 60 * 1000);
  const s = sessaoComAgentes([{ id: 'b1', meta: fundo('Calado'), linhas: TRABALHANDO, mtime: Date.parse('2026-10-27T13:00:00Z') }]);
  try {
    const escrito = fsT.statSync(pathT.join(s.sub, 'agent-b1.jsonl')).mtimeMs;
    assert.strictEqual(saude.agentesRodando(s.transcricao, escrito + saude.SILENCIO_DO_AGENTE_MS - 1).length, 1, 'antes do limite ainda roda');
    assert.strictEqual(saude.agentesRodando(s.transcricao, escrito + saude.SILENCIO_DO_AGENTE_MS).length, 0, 'no limite conta como morto');
  } finally { s.fim(); }
});

// A5 (fila a, medida na s215): o agente de workflow mora em subagents/workflows/<run>/, o meta.json dele diz
// requestShape "foreground" e nunca ganha `finished`; quem diz que acabou e o journal.jsonl do run (`started` abre, a
// linha posterior do mesmo agentId fecha). Antes o agentesRodando nao via nenhum e o handoff saia com a leva rodando.
test('A5: agentesRodando ve o agente de workflow aberto no journal do run, com o mesmo silencio e a mesma interrupcao', () => {
  const s = sessaoComAgentes([]);
  const run = pathT.join(s.sub, 'workflows', 'wf_teste-001');
  fsT.mkdirSync(run, { recursive: true });
  const journal = function (linhas) {
    fsT.writeFileSync(pathT.join(run, 'journal.jsonl'), linhas.map(function (l) {
      return typeof l === 'string' ? l + '\n' : JSON.stringify(l) + '\n';
    }).join(''));
  };
  const agente = function (id, linhas) {
    fsT.writeFileSync(pathT.join(run, 'agent-' + id + '.meta.json'), JSON.stringify({ agentType: 'sworn:inspector',
      description: id, requestShape: 'foreground', requestNonInteractive: true }));
    fsT.writeFileSync(pathT.join(run, 'agent-' + id + '.jsonl'), linhas.map(function (l) { return JSON.stringify(l) + '\n'; }).join(''));
  };
  try {
    agente('w1', TRABALHANDO);
    agente('w2', TRABALHANDO);
    journal([{ type: 'launched' }, { type: 'started', key: 'v2:1', agentId: 'w1', label: 'base:1:borda', phase: 'Leva' },
      { type: 'started', key: 'v2:2', agentId: 'w2', label: 'base:1:estados', phase: 'Leva' },
      'linha torta', { type: 'started', label: 'sem agentId' },
      { type: 'result', agentId: 'w1', result: 'ok', toolsUsed: 3 }]);
    const agora = Date.now();
    assert.deepStrictEqual(saude.agentesRodando(s.transcricao, agora), [{ id: 'w2', descricao: 'base:1:estados' }]);
    // o mesmo silencio de 30 min do agente de fundo
    const escrito = fsT.statSync(pathT.join(run, 'agent-w2.jsonl')).mtimeMs;
    assert.strictEqual(saude.agentesRodando(s.transcricao, escrito + saude.SILENCIO_DO_AGENTE_MS - 1).length, 1);
    assert.strictEqual(saude.agentesRodando(s.transcricao, escrito + saude.SILENCIO_DO_AGENTE_MS).length, 0);
    // o parado por TaskStop (a ultima linha e a interrupcao) nao conta
    agente('w2', TRABALHANDO.concat([INTERROMPIDO]));
    assert.deepStrictEqual(saude.agentesRodando(s.transcricao, agora), []);
    // sem o .jsonl do agente ainda: vale a data do journal
    fsT.renameSync(pathT.join(run, 'agent-w2.jsonl'), pathT.join(run, 'outro.txt'));
    assert.deepStrictEqual(saude.agentesRodando(s.transcricao, agora), [{ id: 'w2', descricao: 'base:1:estados' }]);
    // o `result` do w2 fecha: nenhum rodando, e o script diz que o handoff pode seguir
    journal([{ type: 'started', agentId: 'w2', label: 'base:1:estados' }, { type: 'result', agentId: 'w2', result: 'ok' }]);
    assert.deepStrictEqual(saude.agentesRodando(s.transcricao, agora), []);
    journal([{ type: 'started', agentId: 'w2', label: 'base:1:estados' }]);
    const r = spawnT(process.execPath, [SCRIPT_AGENTES, '--transcricao', s.transcricao], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.indexOf('  - base:1:estados (agent-w2)') !== -1, r.stdout);
  } finally { s.fim(); }
});

test('D704: com agente rodando, os 3 textos do handoff mandam esperar; sem agente, ficam como eram', () => {
  const g = ['3 decisoes do dono respondidas (limiar 3)'];
  // sem agente (lista vazia ou ausente): identico ao de antes da D704
  assert.strictEqual(saude.avisoDeSaude(g, false, []), saude.avisoDeSaude(g, false));
  assert.strictEqual(saude.instrucaoAoModelo(g, false, []), saude.instrucaoAoModelo(g, false));
  assert.strictEqual(saude.instrucaoDaPergunta([]), saude.INSTRUCAO_DA_PERGUNTA);
  assert.strictEqual(saude.instrucaoDaPergunta(), saude.INSTRUCAO_DA_PERGUNTA);
  assert.ok(saude.instrucaoAoModelo(g).indexOf('1. Rode /sworn:handoff.') !== -1, 'controle: a ordem normal manda rodar');
  const rodando = [{ id: 'a1', descricao: 'Inventário só leitura' }, { id: 'a2', descricao: '' }];
  const textos = {
    aviso: saude.avisoDeSaude(g, false, rodando),
    alarme: saude.avisoDeSaude(g, true, rodando),
    modelo: saude.instrucaoAoModelo(g, false, rodando),
    jaColado: saude.instrucaoAoModelo(g, true, rodando),
    pergunta: saude.instrucaoDaPergunta(rodando)
  };
  for (const [nome, t] of Object.entries(textos)) {
    assert.ok(/2 agentes em segundo plano/.test(t), nome + ': tem de contar os agentes: ' + t);
    assert.ok(t.indexOf('  - Inventario so leitura (agent-a1)\n') !== -1 && t.indexOf('  - (agent-a2)\n') !== -1,
      nome + ': tem de nomear cada agente, em ASCII: ' + t);
    assert.ok(/^[\x20-\x7E\n]+$/.test(t), nome + ': tem de ser ASCII: ' + JSON.stringify(t));
    assert.ok(/nao pare nenhum/i.test(t), nome + ': tem de proibir parar agente: ' + t);
    assert.ok(!/(?:^|\n)(?:\d\. Rode|Faca assim: rode) \/sworn:handoff/.test(t), nome + ': mandou rodar o handoff com agente rodando: ' + t);
  }
  // o modelo: nao rodar agora, nao disparar agente novo, dizer ao usuario que o trabalho segue (D786)
  for (const nome of ['modelo', 'jaColado', 'pergunta']) {
    assert.ok(/Nao rode \/sworn:handoff agora/.test(textos[nome]), nome + ': ' + textos[nome]);
    assert.ok(/nao dispare agente novo/.test(textos[nome]), nome + ': ' + textos[nome]);
    assert.ok(/segue nesta conversa/.test(textos[nome]), nome + ': tem de dizer que o trabalho segue: ' + textos[nome]);
  }
  assert.ok(/3 decisoes do dono respondidas \(limiar 3\)/.test(textos.modelo), 'o modelo tem de citar o gatilho: ' + textos.modelo);
  // a pergunta nao tem Stop que de a ordem depois: ela mesma diz quando rodar
  assert.ok(/ultimo terminar, rode \/sworn:handoff/.test(textos.pergunta), textos.pergunta);
  assert.strictEqual(textos.jaColado, textos.modelo, 'com agente rodando, a espera vale mesmo com o prompt ja colado');
  assert.ok(/1 agente em segundo plano/.test(saude.instrucaoAoModelo(g, false, [rodando[0]])), 'singular com 1 agente');
});

// D786 passo 2 (pedido 70): o gatilho grava o handoff e o trabalho segue na mesma conversa; a compactacao relê o
// handoff. Nenhum texto do gatilho manda abrir chat novo nem colar o prompt num chat novo.
test('D786 passo 2: os textos do gatilho de saude mandam gravar o handoff e seguir, sem chat novo', () => {
  const g = ['175500 tokens de contexto, o tamanho desta conversa (limiar 175000)'];
  const rodando = [{ id: 'a1', descricao: 'Inventario' }];
  const ORDEM_DE_TROCA = /\babr\w* (?:um )?chat novo|num chat novo|\btroque\b|\btrocar de chat|hora de abrir/i;
  const textos = {
    aviso: saude.avisoDeSaude(g, false), avisoEspera: saude.avisoDeSaude(g, false, rodando),
    alarme: saude.avisoDeSaude(g, true), alarmeEspera: saude.avisoDeSaude(g, true, rodando),
    modelo: saude.instrucaoAoModelo(g), jaColado: saude.instrucaoAoModelo(g, true),
    espera: saude.instrucaoAoModelo(g, false, rodando),
    pergunta: saude.instrucaoDaPergunta(), perguntaEspera: saude.instrucaoDaPergunta(rodando)
  };
  for (const [nome, t] of Object.entries(textos)) {
    assert.ok(!ORDEM_DE_TROCA.test(t), nome + ': ainda manda trocar de chat: ' + t);
    assert.ok(/segue nesta conversa/.test(t), nome + ': tem de dizer que o trabalho segue: ' + t);
    assert.ok(/^[\x20-\x7E\n]+$/.test(t), nome + ': tem de ser ASCII: ' + JSON.stringify(t));
  }
  assert.match(textos.aviso, /^sworn - hora do handoff: o trabalho segue nesta conversa\.\n/);
  assert.match(textos.avisoEspera, /^sworn - hora do handoff: o trabalho segue nesta conversa\.\n/);
  assert.match(textos.alarme, /^sworn - ALARME: esta conversa ficou cara demais\.\n/);
  // o alarme da o atalho de baixar o custo ja; o aviso comum, nao
  assert.ok(/\/compact/.test(textos.alarme) && /\/compact/.test(textos.alarmeEspera), textos.alarme);
  assert.ok(!/\/compact/.test(textos.aviso), textos.aviso);
  // o modelo grava, cola o bloco (o portao do handoff segue cobrando) e segue sem perguntar
  for (const nome of ['modelo', 'pergunta']) {
    const t = textos[nome];
    assert.ok(t.indexOf('1. Rode /sworn:handoff.') !== -1 && /bloco de codigo/.test(t), nome + ': ' + t);
    assert.ok(/Siga com o proximo passo do trabalho, se houver um/.test(t) && /sigo/.test(t), nome + ': ' + t);
  }
  assert.ok(/Siga com o proximo passo do trabalho, se houver um/.test(textos.jaColado), textos.jaColado);
  // com agente rodando: o handoff espera, o trabalho que nao depende deles segue
  for (const nome of ['espera', 'perguntaEspera']) {
    assert.ok(/siga no que nao depende deles/.test(textos[nome]), nome + ': ' + textos[nome]);
  }
  // a pergunta nao tem Stop que de a ordem depois: ela mesma diz para seguir depois do handoff
  assert.ok(/rode \/sworn:handoff[\s\S]*depois siga com o proximo passo do trabalho/.test(textos.perguntaEspera),
    textos.perguntaEspera);
});

// D786 passo 2 (achado s330): "contexto cheio" de passagem numa mensagem longa, com "?" em outra frase, disparava a
// ordem do handoff. A pergunta pela saude e a frase que e pergunta e que fala do contexto logo no comeco.
test('D786 passo 2: perguntaSobreSaude so casa a frase que pergunta pelo contexto, nao a mencao de passagem', () => {
  const negativos = [
    'Podemos pensar em como melhorar o nosso handoff? Por exemplo, quando o contexto estiver cheio, voce grava o ' +
      'handoff e segue.',
    'Como podemos otimizar isso, por exemplo, depois de gravar o handoff e de todos os agentes terminarem, quando o ' +
      'contexto estiver cheio?',
    'Rode os testes de novo?\nO contexto cheio do React quebra o tema.',
    '- o contexto cheio do React quebra o tema\n- rode os testes de novo?',
    // s335 (revisao, ronda 2): o termo numa oracao que nao e a do "?", e a forma do comeco fora da 1a frase.
    'O contexto cheio de logs atrapalha o build, pode corrigir o teste?',
    'Rode os testes. Como o contexto esta cheio, pule o lint.',
    'Uma coisa: o contexto cheio de logs atrapalha o build; pode corrigir o teste?',
    'Como combinamos, o contexto cheio de logs fica fora do build.',
    // s335 (revisao, ronda 3): a cauda curta que nao e uma das fechadas nao junta; a hipotetica com cauda segue fora.
    'O contexto cheio de logs atrapalha o build, pode corrigir?', 'quando o contexto estiver cheio, certo?'
  ];
  for (const p of negativos) assert.strictEqual(saude.perguntaSobreSaude(p), false, JSON.stringify(p));
  const positivos = [
    'Terminei a etapa 2. O contexto ainda aguenta?', 'Antes de seguir: o contexto esta bom?',
    'o contexto esta bom?', 'is your context getting full?', 'Rode os testes.\nComo esta a memoria?',
    // s335 (revisao, borda): a pergunta quebrada em duas linhas e o preambulo longo, com ou sem dois-pontos.
    'o contexto\nesta bom?',
    'Oi Claude, antes de continuarmos com a refatoracao do modulo de pagamentos eu queria saber: o contexto ' +
      'esta cheio?',
    'depois de tanto tempo trabalhando nesse modulo aqui, o contexto esta bom?',
    'oi, tudo bem, eu estava aqui pensando em como a gente trabalhou hoje e queria saber, o contexto esta cheio?',
    'o contexto esta bom, posso seguir',
    'o contexto está cheio, né?', 'Oi, tudo bem? Antes de continuar, o contexto esta cheio, certo?',
    'o contexto, esta cheio?', 'is your context full, right?'
  ];
  for (const p of positivos) assert.strictEqual(saude.perguntaSobreSaude(p), true, JSON.stringify(p));
});

// s336 (P1 da revisao nova da s335): a pergunta composta poe o termo na oracao antes da do "?". E o prompt de handoff
// colado no chat novo cita essa pergunta entre aspas: a citacao e a colagem nao sao o usuario perguntando (a 0.21.1
// disparou o handoff no 1o turno do chat s336 por isso).
test('s336: perguntaSobreSaude casa a pergunta composta e ignora a citacao e o texto colado', () => {
  const positivos = [
    'o contexto ta cheio, ou da pra continuar?', 'Is the context window full, or fine?',
    'e ai, o contexto ta cheio, ou da pra seguir?', 'your context is getting full, or not?',
    // sem verbo, a oracao antes da cauda fechada so conta pela cauda (a composta nao a cobre)
    'contexto cheio, ne?', 'context window full, right?',
    // a pergunta digitada fora da colagem segue valendo
    'o contexto esta bom?\n<pasted_content id="7">\nlog do build: 3 testes falharam\n</pasted_content id="7">'
  ];
  for (const p of positivos) assert.strictEqual(saude.perguntaSobreSaude(p), true, JSON.stringify(p));
  const negativos = [
    'saude.js com P1 aberto da pergunta composta ("o contexto ta cheio, ou da pra continuar?" = false). SEM suite.',
    'O inspetor citou “o contexto esta bom?” como exemplo, pode conferir?',
    '<pasted_content id="7">\no contexto ta cheio, ou da pra continuar?\n</pasted_content id="7">',
    'Segue o log:\n<pasted_content id="8">\nIs the context window full, or fine?\n</pasted_content id="8">\n' +
      'pode olhar?',
    // o adjetivo solto fora da oracao do "?" e a condicional seguem fora
    'adicione contexto cheio de logs, pode ser?', 'se o contexto ta cheio, o que a gente faz com o log?'
  ];
  for (const p of negativos) assert.strictEqual(saude.perguntaSobreSaude(p), false, JSON.stringify(p));
});

// s336 (revisao nova, ronda 2): o advérbio entre o nome e o verbo, o conectivo de tempo ou condicao no meio da oracao,
// a colagem cortada sem a tag de fechamento e o tempo das regex numa mensagem enorme.
test('s336 ronda 2: adverbio, conectivo no meio da oracao, colagem sem fechamento e mensagem enorme', () => {
  const positivos = ['o contexto ja ta cheio, ou da pra continuar?', 'o contexto ja esta bom, posso seguir',
    // a oracao que nao comeca pelo nome so conta pelo verbo de estado (o comeco nao a cobre)
    'e ai o contexto ja ta cheio, ou da pra continuar?', 'so your context is full, or not?',
    'e ai o contexto esta ficando cheio, ou da pra seguir?'];
  for (const p of positivos) assert.strictEqual(saude.perguntaSobreSaude(p), true, JSON.stringify(p));
  const negativos = [
    'o que acontece se o contexto ficar cheio?', 'me avisa quando o contexto estiver cheio?',
    'what happens if the context gets full?', 'Esse bug acontece quando o contexto ta cheio, certo?',
    'continue daqui:\n<pasted_content id="9">\no contexto ta cheio, ou da pra continuar?',
    '<PASTED_CONTENT id="9">\no contexto ta cheio, ou da pra continuar?\n</PASTED_CONTENT>'
  ];
  for (const p of negativos) assert.strictEqual(saude.perguntaSobreSaude(p), false, JSON.stringify(p));
  const enormes = ['<pasted_content id="1">x '.repeat(20000) + 'o contexto esta bom?',
    '<pasted_content'.repeat(20000) + ' o contexto esta bom?', '“'.repeat(100000) + ' o contexto esta bom?'];
  for (const p of enormes) {
    const inicio = Date.now();
    saude.perguntaSobreSaude(p);
    assert.ok(Date.now() - inicio < 1000, 'demorou ' + (Date.now() - inicio) + ' ms em ' + p.length + ' caracteres');
  }
});

// s337 (P1 da 2a revisao nova): a frase de estado e uma gramatica fixa - [artigo] nome [da conversa] [ja|ainda]
// [verbo no PRESENTE] [ficando|getting] estado - no lugar do meio livre de palavras. O tempo do verbo separa a pergunta
// de agora da hipotese ("vai ficar", "estiver", "gets"); a oracao antes da do "?" conta quando ela E a frase de estado
// (inteira, ou com verbo no fim dela).
test('s337: frase de estado com verbo no presente, oracao anterior inteira, colagens seguidas e aspas retas', () => {
  const positivos = [
    'Contexto lotado, posso continuar?', 'Nesse caso o contexto ta cheio?',
    'o contexto desta conversa ta cheio?', 'is the context of this chat full?', 'context still fine?',
    'comprei um monitor de 27" e o contexto esta bom? o outro tem 32"', 'a memoria ja ficou cheia, ou da pra seguir?',
    'o contexto desta conversa esta bom, posso seguir', "context's getting full?",
    'como esta a memoria, posso seguir', 'e ai, como esta o contexto, da pra continuar?'
  ];
  for (const p of positivos) assert.strictEqual(saude.perguntaSobreSaude(p), true, JSON.stringify(p));
  const negativos = [
    'se eu mandar mais um arquivo, o contexto vai ficar cheio?', 'o contexto vai ficar cheio?',
    'o contexto esta cheio de logs inuteis, pode limpar?', 'o contexto esta cheio de logs, limpe',
    'o contexto do React ta cheio de providers, pode ver?', 'o contexto do React ta cheio?',
    'what happens if the context is full?', 'o que acontece se o contexto ta cheio?',
    'caso o contexto ta cheio, o que eu faco?', 'o teste "o contexto ta cheio" falha, pode ver?',
    'o contexto da aplicacao ta cheio?', 'o contexto estava cheio quando travou?', 'limpe o contexto cheio, pode ser?',
    '<pasted_content id="1">\no contexto ta cheio, ou da pra continuar?\n<pasted_content id="2">\nlog\n' +
      '</pasted_content id="2">\npode olhar?'
  ];
  for (const p of negativos) assert.strictEqual(saude.perguntaSobreSaude(p), false, JSON.stringify(p));
});

// s337 (revisao nova, ronda 1, P2): a intensidade entre o verbo e o estado, a tag de fechamento cortada antes do ">"
// e as aspas retas que casavam do fecho de um par ate a abertura do seguinte.
test('s337 ronda 1: intensidade, fechamento cortado e aspas retas entre dois pares', () => {
  const positivos = ['o contexto esta quase cheio?', 'a memoria ta muito cheia, ou da pra seguir?',
    'is your context almost full?', 'Voce falou "ok" e o contexto esta bom? "sim"',
    'o contexto ainda aguenta, posso seguir'];
  for (const p of positivos) assert.strictEqual(saude.perguntaSobreSaude(p), true, JSON.stringify(p));
  const negativos = ['<pasted_content id="3">\no contexto ta cheio, ou da pra continuar?\n</pasted_content',
    'o contexto vai ficar quase cheio?'];
  for (const p of negativos) assert.strictEqual(saude.perguntaSobreSaude(p), false, JSON.stringify(p));
});

const SCRIPT_AGENTES = pathT.join(__dirname, '..', 'scripts', 'agentes-rodando.js');
test('D704: scripts/agentes-rodando.js lista os agentes de fundo da sessao; sem nenhum, diz que pode seguir', () => {
  const s = sessaoComAgentes([{ id: 'c1', meta: fundo('Inspetor R1'), linhas: TRABALHANDO }]);
  const roda = function (args, env) {
    return spawnT(process.execPath, [SCRIPT_AGENTES].concat(args), { encoding: 'utf8',
      env: Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: s.base }, env || {}) });
  };
  try {
    const r = roda(['--transcricao', s.transcricao]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(/1 agente em segundo plano/.test(r.stdout) && r.stdout.indexOf('  - Inspetor R1 (agent-c1)') !== -1, r.stdout);
    assert.ok(/nao pare nenhum/i.test(r.stdout), r.stdout);
    // sem --transcricao: a da sessao do ambiente, procurada em <CLAUDE_CONFIG_DIR>/projects/*
    const r2 = roda([], { CLAUDE_CODE_SESSION_ID: 'sessao-x' });
    assert.strictEqual(r2.status, 0, r2.stderr);
    assert.ok(r2.stdout.indexOf('(agent-c1)') !== -1, r2.stdout);
    fsT.writeFileSync(pathT.join(s.sub, 'agent-c1.meta.json'), JSON.stringify(fundo('Inspetor R1', { finished: true })));
    const r3 = roda(['--transcricao', s.transcricao]);
    assert.strictEqual(r3.status, 0, r3.stderr);
    assert.ok(/nenhum agente em segundo plano rodando/.test(r3.stdout) && r3.stdout.indexOf('agent-c1') === -1, r3.stdout);
    // sem sessao no ambiente: nao medido, e diz por que; saida 0 (o handoff decide)
    const r4 = roda([], { CLAUDE_CODE_SESSION_ID: '' });
    assert.strictEqual(r4.status, 0, r4.stderr);
    // A5-05 (D735): "nao medidos" concorda com "agentes", e cada causa diz o passo
    assert.ok(/nao medidos - sem --transcricao e sem CLAUDE_CODE_SESSION_ID/.test(r4.stdout) &&
      /rode de novo com --transcricao e o caminho do \.jsonl desta conversa/.test(r4.stdout), r4.stdout);
    const r5 = roda([], { CLAUDE_CODE_SESSION_ID: 'sessao-que-nao-existe' });
    assert.strictEqual(r5.status, 0, r5.stderr);
    assert.ok(/nao medidos - a transcricao da sessao sessao-que-nao-existe nao esta em /.test(r5.stdout) &&
      /passe o caminho do \.jsonl em --transcricao/.test(r5.stdout), r5.stdout);
    // A5 (R1 :10): --transcricao sem valor (ultima ou vazia) nao cai calada na sessao do ambiente; saida 0 do mesmo jeito
    for (const args of [['--transcricao'], ['--transcricao', ''], ['--transcricao', '--outra']]) {
      const r6 = roda(args, { CLAUDE_CODE_SESSION_ID: 'sessao-x' });
      assert.strictEqual(r6.status, 0, r6.stderr);
      assert.ok(/nao medidos - --transcricao pede um valor/.test(r6.stdout) && /rode de novo com ele/.test(r6.stdout) &&
        r6.stdout.indexOf('agent-c1') === -1,
        JSON.stringify(args) + ': ' + r6.stdout);
    }
    // A5 (R2 :10): transcricao que nao existe e "nao medido", nunca "nenhum rodando, o handoff pode seguir"
    const r7 = roda(['--transcricao', pathT.join(s.base, 'nao-existe.jsonl')]);
    assert.strictEqual(r7.status, 0, r7.stderr);
    assert.ok(/nao medidos - a transcricao .*nao-existe\.jsonl nao existe; confira o caminho de --transcricao/
      .test(r7.stdout) &&
      !/pode seguir/.test(r7.stdout), r7.stdout);
  } finally { s.fim(); }
});

test('D704: o Passo 1 do /sworn:handoff roda o agentes-rodando.js antes dos fatos e para com agente rodando', () => {
  const s = fsT.readFileSync(pathT.join(__dirname, '..', 'skills', 'handoff', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  const inicio = s.indexOf('## Step 1');
  const fim = s.indexOf('## Step 2');
  assert.ok(inicio !== -1 && fim > inicio, 'a skill perdeu os Passos 1 e 2');
  const passo1 = s.slice(inicio, fim);
  const agentes = passo1.indexOf('node "${CLAUDE_PLUGIN_ROOT}/scripts/agentes-rodando.js"');
  assert.ok(agentes !== -1, 'o Passo 1 nao roda o agentes-rodando.js: ' + passo1);
  assert.ok(agentes < passo1.indexOf('git -C . rev-parse HEAD'), 'os agentes vem antes dos fatos do handoff');
  // D786 passo 2: para a skill, nao o trabalho; e sem mandar abrir chat novo
  assert.ok(passo1.indexOf('If it lists an agent, stop this skill here') !== -1 &&
    passo1.indexOf('do not stop any of them') !== -1, passo1);
  assert.ok(/the work goes on in this conversation/.test(passo1) && !/open a new chat/.test(passo1), passo1);
  const passo3 = s.slice(s.indexOf('## Step 3'));
  assert.ok(/go on with the next step of the work/.test(passo3) && /code block/.test(passo3), passo3);
  // a unica troca que fica: versao nova do sworn instalada (o /clear nao recarrega o plugin)
  assert.ok(/new version of sworn was installed/.test(passo3), passo3);
});

test('D704: o abrir-turno passa a transcricao: a pergunta pela saude com agente rodando manda esperar', () => {
  const s = sessaoComAgentes([{ id: 'd1', meta: fundo('Inspetor R2'), linhas: TRABALHANDO }]);
  try {
    const turno = function (transcricao) {
      const r = spawnT(process.execPath, [pathT.join(__dirname, '..', 'scripts', 'abrir-turno.js')], { cwd: s.base, encoding: 'utf8',
        env: Object.assign({}, process.env, { SWORN_TMP: pathT.join(s.base, 'estado') }),
        input: JSON.stringify({ session_id: 'd704-pergunta', cwd: s.base, prompt: 'o contexto esta bom?', transcript_path: transcricao }) });
      assert.strictEqual(r.status, 0, r.stderr);
      try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch (e) { return r.stdout; }
    };
    const ctx = turno(s.transcricao);
    assert.ok(ctx.indexOf(saude.instrucaoDaPergunta([{ id: 'd1', descricao: 'Inspetor R2' }])) !== -1, 'nao mandou esperar: ' + ctx);
    assert.ok(turno(pathT.join(s.base, 'outra.jsonl')).indexOf(saude.INSTRUCAO_DA_PERGUNTA) !== -1, 'controle: sem agente, a ordem de antes');
  } finally { s.fim(); }
});

test('D786 passo 3: compactacao depois de um aviso rearma so o tamanho; os outros gatilhos ja avisados calam', () => {
  const L = { turnosComTrabalho: 1, bloqueios: 1, tokensDeContexto: 250000 };
  const base = { turnosComTrabalho: 9, contadores: { escopo: 3 }, avisouSaude: false, saudeRearmada: true };
  const calado = saude.avaliar(Object.assign({ tokensDeContexto: 1000 }, base), L, false);
  assert.strictEqual(calado.disparou, false,
    'turnos e bloqueios ja avisados dispararam de novo: ' + JSON.stringify(calado.gatilhos));
  const r = saude.avaliar(Object.assign({ tokensDeContexto: 260000 }, base), L, false);
  assert.strictEqual(r.disparou, true, 'o tamanho nao rearmou');
  assert.deepStrictEqual(r.gatilhos.length, 1, JSON.stringify(r.gatilhos));
  assert.ok(/tokens de contexto/.test(r.gatilhos[0]), r.gatilhos[0]);
  // controle: sem a marca, os mesmos contadores disparam (o aviso de antes da compactacao)
  const antes = saude.avaliar({ turnosComTrabalho: 9, contadores: { escopo: 3 }, tokensDeContexto: 1000 }, L, false);
  assert.strictEqual(antes.disparou, true, 'controle: sem a marca tinha de disparar');
  // o alarme rearma tambem: a compactacao zera o avisouAlarme e o alarme sai de novo acima dele
  const alarme = saude.avaliar(Object.assign({ tokensDeContexto: 460000, avisouAlarme: false }, base), L, false);
  assert.strictEqual(alarme.alarme, true, 'o alarme nao rearmou');
});

// s353 (D786 passo 5, cx10): no Codex o Ministral nao achou "/sworn:handoff" e tentou gravar em .codex/sworn/, que o
// sandbox nega; nenhum handoff saiu. Toda ordem de rodar o handoff diz o nome da skill fora do Claude Code e a pasta
// onde o sworn marca o arquivo (D788).
test('s353: a ordem de rodar o handoff diz a skill fora do Claude Code e a pasta .sworn/handoff/', () => {
  const g = ['29722 tokens de contexto, o tamanho desta conversa (limiar 28000)'];
  const textos = { modelo: saude.instrucaoAoModelo(g), pergunta: saude.instrucaoDaPergunta(),
    perguntaEspera: saude.instrucaoDaPergunta([{ id: 'a1', descricao: 'Inventario' }]) };
  for (const [nome, t] of Object.entries(textos)) {
    assert.ok(t.indexOf('a skill sworn-handoff') !== -1, nome + ': sem o nome da skill fora do Claude Code: ' + t);
    assert.ok(t.indexOf('.sworn/handoff/AAAA-MM-DD-<tema>.md') !== -1, nome + ': sem a pasta do handoff: ' + t);
    assert.ok(/^[\x20-\x7E\n]+$/.test(t), nome + ': tem de ser ASCII: ' + JSON.stringify(t));
  }
  // o handoff ja colado nao manda gravar de novo: sem a linha
  assert.strictEqual(saude.instrucaoAoModelo(g, true).indexOf('sworn-handoff'), -1);
});
