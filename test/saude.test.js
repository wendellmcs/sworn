'use strict';
const test = require('node:test');
const assert = require('node:assert');
const saude = require('../scripts/lib/saude.js');
// O sufixo T (de teste): fsT, osT e pathT montam os arquivos temporarios dos testes de baixo (transcripts,
// package.json, pastas de subagentes); o spawnT, mais abaixo, segue o mesmo nome.
const fsT = require('node:fs');
const osT = require('node:os');
const pathT = require('node:path');

test('saude: sessao nova nao dispara nada', () => {
  const r = saude.avaliar({});
  assert.strictEqual(r.disparou, false);
  assert.deepStrictEqual(r.gatilhos, []);
  assert.strictEqual(r.aviso, null);
});

test('saude: basta UM gatilho, nao a soma (2 revisoes fechadas disparam, 1 nao)', () => {
  const r = saude.avaliar({ contadores: { revisao_fechada: 2 } });
  assert.strictEqual(r.disparou, true);
  assert.strictEqual(r.gatilhos.length, 1);
  assert.strictEqual(saude.avaliar({ contadores: { revisao_fechada: 1 } }).disparou, false, '1 revisao abaixo do limiar');
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
  const t = saude.instrucaoAoModelo(g, true);
  assert.ok(t.indexOf(g[0]) !== -1, 'tem de citar o gatilho: ' + t);
  assert.ok(/segue nesta conversa/.test(t), 'tem de mandar dizer que o trabalho segue (D786): ' + t);
  assert.ok(!/Cole o prompt/.test(t), 'mandou colar de novo: ' + t);
  assert.ok(!/Rode \/sworn:handoff/.test(t), 'mandou rodar o handoff de novo: ' + t);
  assert.ok(/nao cole/.test(t) && /acima/.test(t), 'tem de mandar apontar para o bloco acima: ' + t);
  assert.ok(/sigo/.test(t), 'tem de proibir o "sigo?": ' + t);
  assert.ok(/^[\x20-\x7E\n]+$/.test(t), 'tem de ser ASCII (R5): ' + JSON.stringify(t));
  // so `true` muda: valor truthy de estado corrompido nao tira a ordem de colar
  assert.strictEqual(saude.instrucaoAoModelo(g, 'sim'), normal);
});

// 0.91.0 (A2, defeito a): o gancho (F3b, D828) mostrou o prompt ao dono na mensagem dele, e a resposta do modelo nao tem
// o bloco. A ordem nao pode dizer "sua resposta acima": diz que o sworn mostrou o prompt, sem mandar rodar nem colar.
test('0.91.0: com o prompt mostrado pelo gancho, a instrucao da saude nao diz que ele esta na resposta do modelo', () => {
  const g = ['175500 tokens de contexto, o tamanho desta conversa (limiar 175000)'];
  const t = saude.instrucaoAoModelo(g, saude.PROMPT_PELO_GANCHO);
  assert.ok(t.indexOf(g[0]) !== -1, 'tem de citar o gatilho: ' + t);
  assert.ok(!/sua resposta|bloco acima/.test(t), 'diz que o prompt esta na resposta: ' + t);
  assert.ok(/mensagem do sworn/.test(t), 'tem de dizer onde o prompt esta: ' + t);
  assert.ok(!/Cole o prompt/.test(t) && !/Rode \/sworn:handoff/.test(t), 'mandou rodar ou colar: ' + t);
  assert.ok(/nao cole/.test(t) && /segue nesta conversa/.test(t) && /sigo/.test(t), t);
  assert.ok(/^[\x20-\x7E\n]+$/.test(t), 'tem de ser ASCII (R5): ' + JSON.stringify(t));
  assert.notStrictEqual(t, saude.instrucaoAoModelo(g, true), 'controle: o colado na resposta segue com o seu texto');
  assert.match(saude.instrucaoAoModelo(g, true), /sua resposta acima/, 'controle: o colado aponta o bloco da resposta');
  // com agente rodando, a espera manda, como no colado (D704)
  const rodando = [{ id: 'a1', descricao: 'Inventario' }];
  assert.strictEqual(saude.instrucaoAoModelo(g, saude.PROMPT_PELO_GANCHO, rodando), saude.instrucaoAoModelo(g, false, rodando));
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
function transcript(linhas) {
  const dir = fsT.mkdtempSync(pathT.join(osT.tmpdir(), 'sworn-ctx-'));
  const f = pathT.join(dir, 's.jsonl');
  fsT.writeFileSync(f, linhas.map(function (l) { return typeof l === 'string' ? l : JSON.stringify(l); }).join('\n') + '\n');
  return { f: f, fim: function () { fsT.rmSync(dir, { recursive: true, force: true }); } };
}
/** Grava o transcript, devolve fn(caminho) e apaga o arquivo, mesmo se fn lancar. */
function comTranscript(linhas, fn) {
  const t = transcript(linhas);
  try { return fn(t.f); } finally { t.fim(); }
}
/** Linhas de enchimento que somam mais que a cauda lida do transcript (256 KB, transcricoes.js). */
function enchimentoAlemDaCauda() {
  const linha = { type: 'user', message: { content: 'x'.repeat(2000) } };
  return Array.from({ length: 200 }, function () { return linha; });
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
  // a do subagente (isSidechain) e a sintetica (tudo zero) e a torta nao contam
  comTranscript([uso(1, 1000, 2000), { type: 'user', message: { content: 'x' } }, uso(2, 140000, 12000),
    uso(5, 1, 1, { isSidechain: true }), uso(0, 0, 0), 'linha torta {', ''], (f) => {
    assert.strictEqual(saude.contextoDoTranscript(f), 152002);
  });
});

// A5-04: o uso de antes da fronteira da compactacao e o contexto que saiu; a medida recomeca na chamada seguinte
test('A5-04: depois do compact_boundary vale so o uso seguinte; sem nenhum, a medida e null', () => {
  const fronteira = { type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted' };
  comTranscript([uso(1, 300000, 0), fronteira, uso(2, 40000, 0)],
    (f) => assert.strictEqual(saude.contextoDoTranscript(f), 40002));
  comTranscript([uso(1, 300000, 0), fronteira], (f) => assert.strictEqual(saude.contextoDoTranscript(f), null));
  // depois da fronteira, so linha que a leitura ja pula (a sintetica zerada): segue null, sem voltar ao uso de antes
  comTranscript([uso(1, 300000, 0), fronteira, uso(0, 0, 0)],
    (f) => assert.strictEqual(saude.contextoDoTranscript(f), null));
  // a fronteira de um subagente nao mexe na medida da linha principal
  comTranscript([uso(1, 300000, 0), Object.assign({ isSidechain: true }, fronteira)],
    (f) => assert.strictEqual(saude.contextoDoTranscript(f), 300001));
});

test('D445: contextoDoTranscript le so a cauda (transcript grande) e devolve null sem leitura', () => {
  const linhas = [uso(1, 1, 1)].concat(enchimentoAlemDaCauda(), [uso(10, 160000, 0)]);
  comTranscript(linhas, (f) => assert.strictEqual(saude.contextoDoTranscript(f), 160010));
  assert.strictEqual(saude.contextoDoTranscript(null), null);
  assert.strictEqual(saude.contextoDoTranscript(pathT.join(osT.tmpdir(), 'nao-existe-sworn.jsonl')), null);
  comTranscript([{ type: 'user', message: { content: 'oi' } }],
    (f) => assert.strictEqual(saude.contextoDoTranscript(f), null));
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
  const ps = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'p', name: 'PowerShell', input: { command: 'npm test' } }] } };
  const casos = [
    ['falhou e outro comando depois', [cmd('a', 'npm test'), res('a', 'Exit code 1\n# fail 2', true), cmd('b', 'ls'), res('b', 'x')],
      { comando: 'npm test', falhou: true }],
    ['o ultimo teste passou', [cmd('a', 'npm test'), res('a', 'Exit code 1', true), cmd('b', 'node --test test/'),
      res('b', '# pass 3\n# fail 0')], { comando: 'node --test test/', falhou: false }],
    // saida 0 por causa do pipe, mas a saida mostra falha
    ['pipe com a saida que mostra falha', [cmd('a', 'npm test 2>&1 | tail -5'), res('a', '# pass 1\n# fail 2')],
      { comando: 'npm test 2>&1 | tail -5', falhou: true }],
    ['a linha de subagente nao conta', [cmd('a', 'pytest -q'), res('a', '3 passed'), cmd('b', 'pytest -q', { isSidechain: true }),
      res('b', 'Exit code 1', true)], { comando: 'pytest -q', falhou: false }],
    ['PowerShell conta como Bash', [ps, res('p', 'Exit code 1', true)], { comando: 'npm test', falhou: true }],
    ['is_error sozinho basta', [cmd('a', 'npm test'), res('a', 'algo deu errado', true)], { comando: 'npm test', falhou: true }],
    ['conteudo em lista de blocos de texto', [cmd('a', 'npm test'),
      res('a', [{ type: 'text', text: '# pass 1' }, { type: 'text', text: '# fail 3' }])], { comando: 'npm test', falhou: true }]
  ];
  for (const [nome, linhas, esperado] of casos) {
    comTranscript(linhas, (f) => assert.deepStrictEqual(saude.testesDoTranscript(f, null).ultimoTeste, esperado, nome));
  }
  // a prova declarada conta como teste mesmo fora da lista fixa; sem prova declarada nao ha pendencia
  const rodaProva = '( cd "Meu App" && node tools/run.mjs --group=all )';
  comTranscript([edita('e', 'src/a.js'), cmd('a', rodaProva), res('a', 'Exit code 1', true)], (f) => {
    assert.deepStrictEqual(saude.testesDoTranscript(f, 'cd "Meu App"; node tools/run.mjs --group=all').ultimoTeste,
      { comando: rodaProva, falhou: true }, 'a prova declarada fora da lista fixa');
    assert.strictEqual(saude.testesDoTranscript(f, null).provaPendente, false, 'sem prova declarada');
  });
});

// P17-124: o content do tool_result fora da forma de texto (nulo, objeto, ausente, bloco sem text) nao lanca. Sem
// texto para ler, so o is_error diz se falhou; o bloco com texto ao lado de um sem texto segue lido.
test('P17-124: content nulo, objeto, ausente ou bloco sem texto nao lanca, e o is_error decide', () => {
  const semContent = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a' }] } };
  const casos = [
    ['content nulo', res('a', null), false],
    ['content nulo com is_error', res('a', null, true), true],
    ['content objeto', res('a', {}), false],
    ['content ausente', semContent, false],
    ['blocos sem texto', res('a', [{ type: 'text' }, { type: 'image' }]), false],
    ['bloco sem texto ao lado de um que mostra falha', res('a', [{ type: 'image' }, { type: 'text', text: '# fail 2' }]), true]
  ];
  for (const [nome, resultado, falhou] of casos) {
    comTranscript([cmd('a', 'npm test'), resultado], (f) => {
      assert.deepStrictEqual(saude.testesDoTranscript(f, null).ultimoTeste, { comando: 'npm test', falhou: falhou }, nome);
    });
  }
});

test('D634: sem teste na cauda, ultimoTeste e null; sem transcript legivel, a funcao devolve null', () => {
  comTranscript([cmd('a', 'git status'), res('a', 'ok')],
    (f) => assert.strictEqual(saude.testesDoTranscript(f, null).ultimoTeste, null, 'sem teste'));
  assert.strictEqual(saude.testesDoTranscript(null, null), null, 'sem caminho');
  assert.strictEqual(saude.testesDoTranscript(pathT.join(osT.tmpdir(), 'nao-existe-sworn.jsonl'), 'npm test'), null,
    'arquivo ausente');
});

// P17-125/P17-130: a janela da cauda (o teste que ficou antes dos ultimos 256 KB nao e lido), a linha torta e a prova
// declarada vazia.
test('P17-125: o teste fora da cauda nao conta, a linha torta nao esconde o teste, e a prova vazia nao cobra', () => {
  const ler = (linhas, prova) => comTranscript(linhas, (f) => saude.testesDoTranscript(f, prova));
  const falha = [cmd('a', 'npm test'), res('a', 'Exit code 1\n# fail 2', true)];
  assert.strictEqual(ler(falha.concat(enchimentoAlemDaCauda()), null).ultimoTeste, null, 'o teste ficou fora da cauda');
  assert.deepStrictEqual(ler(falha.concat(enchimentoAlemDaCauda(), [cmd('b', 'npm test'), res('b', '# pass 3\n# fail 0')]), null)
    .ultimoTeste, { comando: 'npm test', falhou: false }, 'vale o teste de dentro da cauda');
  const rodou = [cmd('a', 'npm test'), res('a', '# fail 0')];
  assert.strictEqual(ler(rodou.concat(enchimentoAlemDaCauda(), [edita('e', 'src/a.js')]), 'npm test').provaPendente, true,
    'a prova ficou fora da cauda e a edicao dentro: a prova falta');
  assert.strictEqual(ler([edita('e', 'src/a.js')].concat(rodou, enchimentoAlemDaCauda()), 'npm test').provaPendente, false,
    'a edicao e a prova fora da cauda: nada a cobrar');
  for (const [nome, linhas, falhou] of [
    ['linha torta antes do teste', ['{"type":"assistant","mess', cmd('a', 'npm test'), res('a', 'Exit code 1', true)], true],
    ['linha torta entre a chamada e o resultado', [cmd('a', 'npm test'), '{torta', res('a', 'Exit code 1', true)], true],
    ['linha torta depois do teste', [cmd('a', 'npm test'), res('a', '# fail 0'), 'nao e json'], false]
  ]) assert.deepStrictEqual(ler(linhas, null).ultimoTeste, { comando: 'npm test', falhou: falhou }, nome);
  assert.strictEqual(ler([edita('e', 'src/a.js'), '{x', cmd('a', 'npm test'), res('a', '# fail 0')], 'npm test').provaPendente,
    false, 'linha torta entre a edicao e a prova');
  for (const prova of ['', '   ']) {
    assert.deepStrictEqual(ler([edita('e', 'src/a.js')], prova), ler([edita('e', 'src/a.js')], null),
      'a prova ' + JSON.stringify(prova) + ' vale como nenhuma');
    assert.strictEqual(ler([edita('e', 'src/a.js')], prova).provaPendente, false, 'prova ' + JSON.stringify(prova));
  }
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
    [[cmd('a', rodaProva), res('a', 'ok'), edita('f', 'src/c.ts', 'MultiEdit')], true, 'MultiEdit tambem edita'],
    [[cmd('a', rodaProva), res('a', 'ok'), edita('e', 'src/b.ts', 'Write')], true, 'Write tambem edita'],
    [[edita('e', 'src/a.js'), cmd('a', 'node tools/run.mjs --group=all'), res('a', 'ok')], false, 'o cd do agente e dele: sem cd tambem e a prova']
  ];
  for (const [linhas, esperado, nome] of casos) {
    comTranscript(linhas, (f) => assert.strictEqual(saude.testesDoTranscript(f, prova).provaPendente, esperado, nome));
  }
});

test('D634: a prova de dois passos so vale com os dois; rodar um deles nao e rodar a prova', () => {
  comTranscript([edita('e', 'src/a.js'), cmd('a', 'npm test'), res('a', '# fail 0')], (f) => {
    assert.strictEqual(saude.testesDoTranscript(f, 'npm run build && npm test').provaPendente, true, 'so o npm test');
  });
  comTranscript([edita('e', 'src/a.js'), cmd('a', 'npm run build && npm test'), res('a', '# fail 0')], (f) => {
    assert.strictEqual(saude.testesDoTranscript(f, 'npm run build && npm test').provaPendente, false, 'controle: os dois');
  });
});

// A4 (s369, P2 da s453): a prova lancada em segundo plano. O resultado da chamada so diz que o comando roda (forma
// medida no transcript da s369); o fim chega depois numa mensagem <task-notification> com o tool-use-id, o status, o
// codigo de saida no summary e o arquivo da saida. Antes do fim a prova roda (provaRodando); o fim decide se passou.
function emFundo(id, comando) {
  return { type: 'assistant', message: { content: [{ type: 'tool_use', id: id, name: 'Bash',
    input: { command: comando, run_in_background: true } }] } };
}
function lancado(id) {
  return res(id, 'Command running in background with ID: bx' + id + '. Output is being written to: C:\\tmp\\bx' + id +
    '.output. You will be notified when it completes.');
}
function fimDoFundo(id, status, resumo, arquivo) {
  return { type: 'user', message: { role: 'user', content: '<task-notification>\n<task-id>bx' + id + '</task-id>\n' +
    '<tool-use-id>' + id + '</tool-use-id>\n<output-file>' + arquivo + '</output-file>\n<status>' + status +
    '</status>\n<summary>' + resumo + '</summary>\n</task-notification>' } };
}

test('A4: a prova em segundo plano roda ate o aviso de fim, e o fim (status, codigo e saida) decide se passou', () => {
  // espaco e acento no caminho do <output-file>: ele e lido como veio, sem partir
  const dir = fsT.mkdtempSync(pathT.join(osT.tmpdir(), 'sworn fundo ção-'));
  const saida = function (nome, texto) { const f = pathT.join(dir, nome); fsT.writeFileSync(f, texto); return f; };
  const verde = saida('verde.output', '# tests 3\n# pass 3\n# fail 0\n');
  const vermelha = saida('vermelha.output', '# tests 3\n# pass 1\n# fail 2\n');
  const prova = 'node --test test/*.test.js';
  const ler = (linhas) => comTranscript(linhas, (f) => saude.testesDoTranscript(f, prova));
  const ok = 'Background command "suite" completed (exit code 0)';
  try {
    let r = ler([edita('e', 'src/a.js'), emFundo('a', prova), lancado('a')]);
    assert.strictEqual(r.provaRodando, true, 'lancada, sem aviso de fim: roda');
    assert.strictEqual(r.provaPendente, true, 'sem o fim, a prova ainda nao provou nada');
    assert.strictEqual(r.ultimoTeste, null, 'o aviso de lancamento nao e resultado de teste');

    r = ler([edita('e', 'src/a.js'), emFundo('a', prova), lancado('a'), fimDoFundo('a', 'completed', ok, verde)]);
    assert.deepStrictEqual([r.provaRodando, r.provaPendente, r.ultimoTeste],
      [false, false, { comando: prova, falhou: false }], 'fim verde: passou');

    r = ler([edita('e', 'src/a.js'), emFundo('a', prova), lancado('a'),
      fimDoFundo('a', 'completed', 'Background command "suite" completed (exit code 1)', verde)]);
    assert.strictEqual(r.ultimoTeste.falhou, true, 'codigo diferente de 0 e falha');

    r = ler([edita('e', 'src/a.js'), emFundo('a', prova), lancado('a'), fimDoFundo('a', 'completed', ok, vermelha)]);
    assert.strictEqual(r.ultimoTeste.falhou, true, 'codigo 0 (pipe) com saida que mostra falha e falha');

    r = ler([edita('e', 'src/a.js'), emFundo('a', prova), lancado('a'),
      fimDoFundo('a', 'killed', 'Background command "suite" was stopped', pathT.join(dir, 'nao-existe.output'))]);
    assert.strictEqual(r.ultimoTeste.falhou, true, 'parado antes do fim, sem saida legivel: nao passou');
    assert.strictEqual(r.provaRodando, false, 'parado nao roda mais');

    r = ler([emFundo('a', prova), lancado('a'), edita('e', 'src/a.js')]);
    assert.deepStrictEqual([r.provaRodando, r.provaPendente], [false, true], 'editou depois de lancar: nao prova a edicao');

    r = ler([emFundo('a', prova), lancado('a'), edita('e', 'src/a.js'), fimDoFundo('a', 'completed', ok, verde)]);
    assert.strictEqual(r.provaPendente, true, 'o fim verde de uma prova lancada antes da edicao nao prova a edicao');

    // o aviso de fim repetido nao volta a valer depois de um teste mais novo
    const fimVermelho = fimDoFundo('a', 'completed', 'Background command "suite" completed (exit code 1)', vermelha);
    r = ler([edita('e', 'src/a.js'), emFundo('a', prova), lancado('a'), fimVermelho, cmd('b', prova), res('b', '# fail 0'),
      fimVermelho]);
    assert.deepStrictEqual(r.ultimoTeste, { comando: prova, falhou: false }, 'aviso repetido nao conta de novo');

    // o lancamento que nao chegou a rodar nao tera aviso de fim: vale como o de primeiro plano, e nao fica rodando
    r = ler([edita('e', 'src/a.js'), emFundo('a', prova), res('a', 'Permission to use Bash has been denied.', true)]);
    assert.deepStrictEqual([r.provaRodando, r.provaPendente, r.ultimoTeste],
      [false, true, { comando: prova, falhou: true }], 'lancamento negado');

    r = ler([edita('e', 'src/a.js'), emFundo('a', prova), lancado('a'),
      fimDoFundo('a', 'completed', 'Background command "suite" completed (exit code -1)', verde)]);
    assert.strictEqual(r.ultimoTeste.falhou, true, 'codigo negativo e falha');

    // o aviso de fim colado dentro do resultado de outra ferramenta (um grep, um cat) nao e o aviso do harness
    const colado = res('g', fimDoFundo('a', 'completed', ok, verde).message.content);
    r = ler([edita('e', 'src/a.js'), emFundo('a', prova), lancado('a'), cmd('g', 'grep -r task-notification .'), colado]);
    assert.strictEqual(r.provaRodando, true, 'aviso dentro de tool_result nao fecha a prova');

    // a prova em primeiro plano depois do lancamento vale como sempre
    r = ler([edita('e', 'src/a.js'), emFundo('a', prova), lancado('a'), cmd('b', prova), res('b', '# fail 0')]);
    assert.deepStrictEqual([r.provaRodando, r.provaPendente], [false, false], 'a de primeiro plano depois prova');
  } finally { fsT.rmSync(dir, { recursive: true, force: true }); }
});

test('R2b: testesDoTranscript guarda a ultima conferencia da tela pelo codigo de saida, e outro teste depois nao a apaga', () => {
  const ler = (linhas) => comTranscript(linhas, (f) => saude.testesDoTranscript(f, 'npm test'));
  const conf = 'node scripts/conferir-tela.js --url http://localhost:3000 --referencia https://exemplo.com --saida s';
  const comPasta = 'node "C:/Meus Plugins/sworn/scripts/conferir-tela.js" --url http://a --referencia http://b --saida s';
  const comFlag = 'node --no-warnings scripts\\conferir-tela.js --url http://a --referencia http://b --saida s';
  let r = ler([cmd('a', conf), res('a', '{"ok":false,"naoComparado":1}', true)]);
  assert.deepStrictEqual(r.ultimaConferencia, { comando: conf, falhou: true }, 'saiu 1: falhou');
  assert.strictEqual(r.ultimoTeste, null, 'a conferencia nao conta como o ultimo teste');
  r = ler([cmd('a', conf), res('a', '{"ok":false}', true), cmd('b', 'npm test'), res('b', '# pass 3\n# fail 0')]);
  assert.deepStrictEqual(r.ultimaConferencia, { comando: conf, falhou: true }, 'a suite verde depois nao apaga a conferencia');
  assert.strictEqual(r.ultimoTeste.falhou, false, 'o npm test depois da conferencia passou, e ele e o ultimo teste');
  r = ler([cmd('a', conf), res('a', '{}', true), cmd('b', comPasta), res('b', '{"ok":true,"diferencas":2}')]);
  assert.deepStrictEqual(r.ultimaConferencia, { comando: comPasta, falhou: false }, 'a de agora, com pasta e espaco, saiu 0');
  r = ler([cmd('a', comFlag), res('a', 'ERRO: falta --saida', true)]);
  assert.strictEqual(r.ultimaConferencia.falhou, true, 'com opcao do node antes e barra invertida');
  r = ler([cmd('a', conf), res('a', '{"ok":true,"diferencas":1,"aviso":"1 failed"}')]);
  assert.strictEqual(r.ultimaConferencia.falhou, false, 'decide o codigo de saida, nao o texto da lista');
  // com um pipe depois, o codigo e o do tail: o resumo da conferencia diz que ela nao passou
  r = ler([cmd('a', conf + ' 2>&1 | tail -20'), res('a', '{"ok":false,"naoComparado":1,"tudoComparado":false}')]);
  assert.strictEqual(r.ultimaConferencia.falhou, true, 'pipe depois: o resumo decide');
  r = ler([cmd('a', conf + ' 2>&1 | tail -20'), res('a', '{"ok":true,"diferencas":0,"tudoComparado":true}')]);
  assert.strictEqual(r.ultimaConferencia.falhou, false, 'pipe depois com o resumo verde: passou');
  r = ler([cmd('a', conf + ' || true'), res('a', 'ERRO: falta --saida')]);
  assert.strictEqual(r.ultimaConferencia.falhou, true, 'com || true, o ERRO da chamada na saida diz que falhou');
  // o pipe ou o ; depois esconde a saida: sem o resumo verde, nao passou
  for (const depois of [' | grep -c diferenca', ' > s.json; echo ok', ' | head -3', '; echo ok', ' & echo ok', '\necho ok',
    ' --y "a" | grep -c "b"', ' --y \'a\' ; echo \'b\'']) {
    r = ler([cmd('a', conf + depois), res('a', 'ok')]);
    assert.strictEqual(r.ultimaConferencia.falhou, true, 'o codigo e de outro programa e a saida nao mostra o verde: ' + depois);
  }
  // o 2>&1 e o > sem nada depois nao trocam o codigo, nem o que vem antes dela: ele decide
  for (const [antes, depois] of [['', ' 2>&1'], ['', ' > s.json'], ['', ' &> s.txt'], ['', ' &>> s.txt'],
    ['', ' --larguras "800" --y \'a;b\' --x "a=1&b=2;c|d"'], ['cd x && ', ''], ['echo x | cat; ', '']]) {
    r = ler([cmd('a', antes + conf + depois), res('a', '')]);
    assert.strictEqual(r.ultimaConferencia.falhou, false, 'o codigo ainda e da conferencia: ' + antes + '...' + depois);
  }
  // depois de cd, de variavel de ambiente e do & do PowerShell, e o node como programa
  for (const antes of ['cd x && ', 'SWORN_NAVEGADOR=/x/chrome ', '& ', '(cd x; ', 'echo x\n']) {
    r = ler([cmd('a', antes + conf), res('a', 'Exit code 1', true)]);
    assert.strictEqual(r.ultimaConferencia && r.ultimaConferencia.falhou, true, 'a conferencia depois de "' + antes + '" conta');
  }
  for (const outro of ['cat scripts/conferir-tela.js', 'grep -n x scripts/conferir-tela.js',
    'node --test test/conferencia-tela.test.js', 'node scripts/capturar-tela.js --url http://a --saida s',
    'grep -n "node" scripts/conferir-tela.js', 'node --version\ngrep -n lerArgs scripts/conferir-tela.js',
    'echo node scripts/conferir-tela.js']) {
    assert.strictEqual(ler([cmd('a', outro), res('a', 'Exit code 1', true)]).ultimaConferencia, undefined, outro);
  }
  assert.strictEqual(ler([cmd('a', conf)]).ultimaConferencia, undefined, 'sem resultado na cauda, nao conta');
  // em segundo plano: o lancamento nao e o fim; o fim decide pelo status e pelo codigo
  const ok = 'Background command "c" completed (exit code 0)';
  const semArquivoAntes = pathT.join(osT.tmpdir(), 'sworn-nao-existe-' + process.pid, 'a.output');
  r = ler([emFundo('a', conf), lancado('a')]);
  assert.strictEqual(r.ultimaConferencia, undefined, 'lancada, sem fim');
  // F5 (achado da R2b): a lancada sem fim roda, e isso se diz; a de antes de uma que terminou ja nao decide
  assert.strictEqual(r.conferenciaRodando, true, 'lancada, sem fim: roda');
  assert.strictEqual(ler([cmd('a', conf), res('a', '{"tudoComparado":true}')]).conferenciaRodando, undefined, 'a de primeiro plano terminou');
  assert.strictEqual(ler([emFundo('a', conf), lancado('a'), cmd('b', conf), res('b', '{"tudoComparado":true}')]).conferenciaRodando,
    undefined, 'lancada antes de uma que terminou');
  assert.strictEqual(ler([cmd('b', conf), res('b', '{"tudoComparado":true}'), emFundo('a', conf), lancado('a')]).conferenciaRodando,
    true, 'lancada depois da que terminou');
  assert.strictEqual(ler([emFundo('a', conf), res('a', 'Permission to use Bash has been denied.', true)]).conferenciaRodando,
    undefined, 'lancamento negado nao roda');
  assert.strictEqual(ler([cmd('a', conf)]).conferenciaRodando, undefined, 'a de primeiro plano sem resultado na cauda nao e fundo');
  assert.strictEqual(ler([emFundo('a', conf), lancado('a'), emFundo('b', conf), lancado('b'),
    fimDoFundo('b', 'completed', ok, semArquivoAntes)]).conferenciaRodando, undefined, 'a lancada antes de uma de fundo que terminou');
  r = ler([emFundo('a', conf), lancado('a'), fimDoFundo('a', 'completed', 'Background command "c" completed (exit code 1)', 'x')]);
  assert.strictEqual(r.ultimaConferencia.falhou, true, 'fim com codigo 1');
  const semArquivo = pathT.join(osT.tmpdir(), 'sworn-nao-existe-' + process.pid, 'b.output');
  r = ler([emFundo('a', conf), lancado('a'), fimDoFundo('a', 'completed', ok, semArquivo)]);
  assert.strictEqual(r.ultimaConferencia.falhou, false, 'fim com codigo 0');
  r = ler([emFundo('a', conf), lancado('a'), fimDoFundo('a', 'completed', 'Background command "c" completed', semArquivo)]);
  assert.strictEqual(r.ultimaConferencia.falhou, false, 'completed sem codigo no aviso: o status decide');
  r = ler([emFundo('a', conf), lancado('a'), fimDoFundo('a', 'completed', 'Background command "c" completed (exit code -1)', semArquivo)]);
  assert.strictEqual(r.ultimaConferencia.falhou, true, 'codigo negativo nao passou');
  r = ler([emFundo('a', conf), lancado('a'), fimDoFundo('a', 'killed', 'Background command "c" was stopped', semArquivo)]);
  assert.strictEqual(r.ultimaConferencia.falhou, true, 'parada nao passou');
  r = ler([emFundo('a', conf + ' | tail -5'), lancado('a'), fimDoFundo('a', 'completed', ok, semArquivo)]);
  assert.strictEqual(r.ultimaConferencia.falhou, true, 'fundo com pipe e sem a saida gravada: nada mostra o verde');
  // em segundo plano com pipe: o codigo 0 e o do tail, e a saida gravada diz que nao passou
  const dir = fsT.mkdtempSync(pathT.join(osT.tmpdir(), 'sworn-conf-fundo-'));
  try {
    const saida = pathT.join(dir, 'b.output');
    fsT.writeFileSync(saida, '{"ok":false,"naoComparado":2,"tudoComparado":false}\n');
    r = ler([emFundo('a', conf + ' | tail -5'), lancado('a'), fimDoFundo('a', 'completed', ok, saida)]);
    assert.strictEqual(r.ultimaConferencia.falhou, true, 'fundo com pipe: a saida decide');
    fsT.writeFileSync(saida, '{"ok":true,"diferencas":1,"tudoComparado":true}\n');
    r = ler([emFundo('a', conf + ' | tail -5'), lancado('a'), fimDoFundo('a', 'completed', ok, saida)]);
    assert.strictEqual(r.ultimaConferencia.falhou, false, 'fundo com pipe e o resumo verde gravado: passou');
  } finally { fsT.rmSync(dir, { recursive: true, force: true }); }
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
  comTranscript([edita('e', 'src/a.js'), cmd('a', 'npm test 2>$null | Select-String fail'), res('a', '# fail 0')], (f) => {
    assert.strictEqual(saude.testesDoTranscript(f, ['node --test', 'npm test']).provaPendente, false, 'qualquer forma vale');
    assert.strictEqual(saude.testesDoTranscript(f, ['node --test']).provaPendente, true, 'lista de uma forma e a prova');
    assert.strictEqual(saude.testesDoTranscript(f, []).provaPendente, false, 'lista vazia e sem prova');
  });
  // R1 da revisao s328 (borda): o casamento e por pedaco de texto, e `npm run test` caberia dentro de outro script.
  const formas = ['node --test', 'npm test', 'npm run test', 'pnpm test'];
  for (const [comando, esperado] of [['npm run test:unit', true], ['pnpm test-e2e', true], ['npm run test.x', true],
    ['npm run test:unit && npm run test', false], ['npm test -- --grep x', false], ['npm run test', false]]) {
    comTranscript([edita('e', 'src/a.js'), cmd('a', comando), res('a', '# fail 0')],
      (f) => assert.strictEqual(saude.testesDoTranscript(f, formas).provaPendente, esperado, comando));
  }
  // a fronteira vale so para as formas do script test; a prova declarada segue casando por pedaco, como antes
  comTranscript([edita('e', 'src/a.js'), cmd('a', 'node --test test/a.test.js'), res('a', '# fail 0')],
    (f) => assert.strictEqual(saude.testesDoTranscript(f, ['node --test test/']).provaPendente, false));
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
    comTranscript([edita('e', 'src/a.js'), cmd('a', c), res('a', '# fail 1', true)], (f) => {
      assert.deepStrictEqual(saude.testesDoTranscript(f, 'node --test').ultimoTeste, { comando: c, falhou: true }, c);
    });
  }
});

// D785 (s328): no sandbox do Codex o node --test sai com spawn EPERM. O ultimo teste leva a marca (o sandbox barrou o
// executor, nao o codigo), e a prova rodada sem processo filho (--test-isolation=none) segue sendo a prova.
test('D785: testesDoTranscript marca o teste barrado pelo sandbox e aceita a prova com --test-isolation=none', () => {
  comTranscript([edita('e', 'src/a.js'), cmd('a', 'node --test test/'), res('a', 'Error: spawn EPERM\n# fail 1', true)], (f) => {
    assert.deepStrictEqual(saude.testesDoTranscript(f, 'node --test test/').ultimoTeste,
      { comando: 'node --test test/', falhou: true, barradoPeloSandbox: true });
  });
  for (const c of ['node --test --test-isolation=none test/', 'node --test --experimental-test-isolation=none test/']) {
    comTranscript([edita('e', 'src/a.js'), cmd('a', c), res('a', '# fail 0')],
      (f) => assert.strictEqual(saude.testesDoTranscript(f, 'node --test test/').provaPendente, false, c));
  }
  comTranscript([edita('e', 'src/a.js'), cmd('a', 'node --test --test-isolation=none lib/'), res('a', '# fail 0')], (f) => {
    assert.strictEqual(saude.testesDoTranscript(f, 'node --test test/').provaPendente, true, 'outra pasta segue pendente');
  });
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
    comTranscript(linhas,
      (f) => assert.strictEqual(saude.testesDoTranscript(f, ['node --test', 'npm test']).provaPendente, esperado, nome));
  }
  // P2 da s328: prova feita so de separadores nao tem pedaco, e o every da lista vazia casava com qualquer comando
  comTranscript([edita('e', 'src/a.js'), cmd('a', 'ls'), res('a', 'x')], (f) => {
    for (const p of [';;', ' && ', ['node --test', '||']]) {
      assert.strictEqual(saude.testesDoTranscript(f, p).ultimoTeste, null, 'ls nao e teste: ' + JSON.stringify(p));
    }
    assert.strictEqual(saude.testesDoTranscript(f, ';;').provaPendente, false, 'sem pedaco e sem prova declarada');
    assert.strictEqual(saude.testesDoTranscript(f, ['node --test', ';']).provaPendente, true, 'a forma de verdade fica');
  });
  // R1 da revisao s329 (correcao): a prova declarada com a opcao segue casando, com ou sem ela no comando
  for (const [p, c] of [['node --test --test-isolation=none test/', 'node --test --test-isolation=none test/'],
    ['node --test --test-isolation=none test/', 'node --test test/'], ['node --test test/', 'node --test --test-isolation none test/']]) {
    comTranscript([edita('e', 'src/a.js'), cmd('a', c), res('a', '# fail 0')],
      (f) => assert.strictEqual(saude.testesDoTranscript(f, p).provaPendente, false, p + ' / ' + c));
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

// H1 (A5-08, A5-10, A5-12, A5-16, s372): o journal do workflow. So o `result` fecha; o agentId que sairia da pasta do
// run fica de fora; o journal se le ate um teto, e o `result` depois dele deixa o agente aberto (espera, nunca sai
// antes); o `agora` que nao e numero vale o relogio, em vez de dar o agente por terminado.
test('H1: o journal do workflow fecha so com result, recusa id com barra, tem teto e o agora invalido vale o relogio', () => {
  const s = sessaoComAgentes([]);
  const run = pathT.join(s.sub, 'workflows', 'wf_teste-002');
  fsT.mkdirSync(run, { recursive: true });
  const jornal = pathT.join(run, 'journal.jsonl');
  const linhas = function (ls) { return ls.map(function (l) { return JSON.stringify(l) + '\n'; }).join(''); };
  const agente = function (id) {
    fsT.writeFileSync(pathT.join(run, 'agent-' + id + '.jsonl'), linhas(TRABALHANDO));
  };
  try {
    agente('w3');
    agente('w4');
    const agora = Date.now();
    // uma linha de outro tipo nao fecha o agente; so o result
    fsT.writeFileSync(jornal, linhas([{ type: 'started', agentId: 'w3', label: 'aberto' },
      { type: 'progress', agentId: 'w3' }, { type: 'started', agentId: 'w4', label: 'fechado' },
      { type: 'result', agentId: 'w4', result: 'ok' }]));
    assert.deepStrictEqual(saude.agentesRodando(s.transcricao, agora), [{ id: 'w3', descricao: 'aberto' }]);
    // o agentId com barra ou ponto-ponto nao entra (viraria caminho fora da pasta do run)
    for (const id of ['../w3', 'a/b', 'a\\b', '..', '']) {
      fsT.writeFileSync(jornal, linhas([{ type: 'started', agentId: id, label: 'fora' }]));
      assert.deepStrictEqual(saude.agentesRodando(s.transcricao, agora), [], JSON.stringify(id));
    }
    // o agora que nao e numero finito vale o relogio: o agente que escreveu agora segue rodando
    fsT.writeFileSync(jornal, linhas([{ type: 'started', agentId: 'w3', label: 'aberto' }]));
    for (const a of [NaN, Infinity, '123', undefined, null]) {
      assert.deepStrictEqual(saude.agentesRodando(s.transcricao, a), [{ id: 'w3', descricao: 'aberto' }], String(a));
    }
    // controle do relogio: com o agora valido e longe no futuro, o mesmo agente conta como calado
    assert.deepStrictEqual(saude.agentesRodando(s.transcricao, agora + saude.SILENCIO_DO_AGENTE_MS + 60000), []);
    // e o relogio vale de fato: com o agora invalido, o agente calado ha mais que o silencio nao segue rodando
    const calado = (agora - saude.SILENCIO_DO_AGENTE_MS - 60000) / 1000;
    fsT.utimesSync(pathT.join(run, 'agent-w3.jsonl'), calado, calado);
    for (const a of [NaN, Infinity, '123', undefined, null]) {
      assert.deepStrictEqual(saude.agentesRodando(s.transcricao, a), [], 'calado ' + String(a));
    }
    agente('w3');
    // o teto: o result dentro dele fecha; depois de mais de 4 MB de linhas, nao e lido e o agente segue aberto
    // o teto de saude.js (TETO_DO_JOURNAL) e 4 MB; o assert garante que o enchimento passa dele
    const enchimento = linhas([{ type: 'nota', texto: 'x'.repeat(1000) }]).repeat(4200);
    assert.ok(enchimento.length > 4 * 1024 * 1024, String(enchimento.length));
    fsT.writeFileSync(jornal, linhas([{ type: 'started', agentId: 'w3', label: 'aberto' },
      { type: 'result', agentId: 'w3', result: 'ok' }]) + enchimento);
    assert.deepStrictEqual(saude.agentesRodando(s.transcricao, agora), []);
    fsT.writeFileSync(jornal, linhas([{ type: 'started', agentId: 'w3', label: 'aberto' }]) + enchimento +
      linhas([{ type: 'result', agentId: 'w3', result: 'ok' }]));
    assert.deepStrictEqual(saude.agentesRodando(s.transcricao, agora), [{ id: 'w3', descricao: 'aberto' }]);
  } finally { s.fim(); }
});

// H1 (A5-80, s372): o contador que nao e numero (texto, objeto) nunca vira aviso, como os outros do medirTodos
test('H1: turnos e revisoes que nao sao numero nunca cruzam o limiar', () => {
  const porChave = function (lista, k) { return lista.find(function (g) { return g.chave === k; }); };
  for (const v of ['999', { n: 999 }, [999], true]) {
    const m = saude.medir({ turnosComTrabalho: v, contadores: { revisao_fechada: v } }, { turnosComTrabalho: 1, revisoesFechadas: 1 });
    const turnos = porChave(m, 'turnosComTrabalho');
    const revisoes = porChave(m, 'revisoesFechadas');
    assert.ok(turnos && (turnos.valor === 0 && !turnos.cruzou), JSON.stringify(v) + ' turnos');
    assert.ok(revisoes && (revisoes.valor === 0 && !revisoes.cruzou), JSON.stringify(v) + ' revisoes');
  }
  // controle: o numero cruza, nos dois
  const m = saude.medir({ turnosComTrabalho: 5, contadores: { revisao_fechada: 5 } }, { turnosComTrabalho: 1, revisoesFechadas: 1 });
  for (const k of ['turnosComTrabalho', 'revisoesFechadas']) {
    const g = porChave(m, k);
    assert.ok(g && g.valor === 5 && g.cruzou, k + ' ' + JSON.stringify(m));
  }
});

// H1 (revisao do A5-80, s372): o balde de bloqueio com texto nao soma; antes o "5" virava texto e o total era emendado
test('H1: os bloqueios so somam os baldes que sao numero', () => {
  const m = saude.medir({ contadores: { fora_do_escopo: '5', comando_destrutivo: 1, sem_escopo: { n: 9 } } }, { bloqueios: 6 });
  const b = m.find(function (g) { return g.chave === 'bloqueios'; });
  assert.ok(b, JSON.stringify(m));
  assert.strictEqual(b.valor, 1);
  assert.strictEqual(b.cruzou, false);
  // so o total; o plural de "1 bloqueios" e outro registro do plano, e este teste nao o trava
  assert.ok(/^1 bloqueio/.test(b.texto), b.texto);
});

// H1 (revisao do A5-08, s372): o handoff gravado pelo shell se marca mesmo sem um `agora` valido (vale o relogio)
test('H1: handoffGravadoPeloShell com agora invalido usa o relogio', () => {
  const dir = fsT.mkdtempSync(pathT.join(osT.tmpdir(), 'sworn handoff-shell-'));
  try {
    fsT.mkdirSync(pathT.join(dir, '.sworn', 'handoff'), { recursive: true });
    const arq = pathT.join(dir, '.sworn', 'handoff', '2026-11-16-tema.md');
    fsT.writeFileSync(arq, 'x');
    const comando = 'echo x > .sworn/handoff/2026-11-16-tema.md';
    const invalidos = [NaN, undefined, null, '123', Infinity];
    for (const a of invalidos) {
      assert.strictEqual(saude.handoffGravadoPeloShell(comando, dir, a), arq, String(a));
    }
    // controle: com o agora valido e longe no futuro, o arquivo velho nao conta
    assert.strictEqual(saude.handoffGravadoPeloShell(comando, dir, Date.now() + 60 * 60 * 1000), null);
    // e o relogio vale de fato: com o agora invalido, o handoff de uma hora atras nao conta
    const velho = (Date.now() - 60 * 60 * 1000) / 1000;
    fsT.utimesSync(arq, velho, velho);
    for (const a of invalidos) {
      assert.strictEqual(saude.handoffGravadoPeloShell(comando, dir, a), null, 'velho ' + String(a));
    }
  } finally { fsT.rmSync(dir, { recursive: true, force: true }); }
});

// H1 (A5-09, s372): a lista dos gatilhos sai igual no aviso e nas tres ordens ao modelo, e o que nao e lista, nenhuma
test('H1: os gatilhos saem na mesma forma no aviso e nas ordens; o que nao e lista nao lanca', () => {
  const g = ['a (limiar 1)', 'b (limiar 2)'];
  const lista = '  - a (limiar 1)\n  - b (limiar 2)';
  const rodando = [{ id: 'x1', descricao: 'leva' }];
  for (const texto of [saude.avisoDeSaude(g, false), saude.instrucaoAoModelo(g), saude.instrucaoAoModelo(g, true),
    saude.instrucaoAoModelo(g, saude.PROMPT_PELO_GANCHO), saude.instrucaoAoModelo(g, false, rodando)]) {
    assert.ok(texto.indexOf(lista) !== -1, texto);
  }
  for (const v of ['texto', 42, { a: 1 }, null, undefined, []]) {
    // a chamada lancava com o que nao e lista; aqui ela roda e nao traz item nenhum (o [] e a lista vazia, de controle)
    assert.strictEqual(saude.instrucaoAoModelo(v).indexOf('  - '), -1, JSON.stringify(v));
  }
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
    peloGancho: saude.instrucaoAoModelo(g, saude.PROMPT_PELO_GANCHO),
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
  assert.strictEqual(saude.instrucaoAoModelo(g, saude.PROMPT_PELO_GANCHO).indexOf('sworn-handoff'), -1);
});

// D875: a edicao de codigo fora do projeto depois da prova so a deixa pendente quando o mesmoCodigoDaProva nao diz true.
test('D875: testesDoTranscript perdoa a edicao fora do projeto so com o codigo igual ao do lancamento da prova', () => {
  const raiz = fsT.mkdtempSync(pathT.join(osT.tmpdir(), 'sworn-fora-'));
  const outra = fsT.mkdtempSync(pathT.join(osT.tmpdir(), 'sworn-fora-aux-'));
  try {
    const PROVA = 'node --test test/*.test.js';
    const fora = pathT.join(outra, 'auxiliar.js');
    const dentro = pathT.join(raiz, 'src', 'x.js');
    const chamadas = [];
    const sim = function (id, comando) { chamadas.push([id, comando]); return true; };
    const ver = function (linhas, opcoes) {
      return comTranscript(linhas, (f) => saude.testesDoTranscript(f, PROVA, false, opcoes));
    };
    const suite = [cmd('a', PROVA), res('a', '# pass 3\n# fail 0')];
    // sem a funcao, a edicao de fora conta como antes
    assert.strictEqual(ver(suite.concat([edita('e', fora)]), { raiz: raiz }).provaPendente, true, 'sem a funcao');
    // com o codigo igual, perdoada; a funcao recebe o id e o comando do lancamento
    assert.strictEqual(ver(suite.concat([edita('e', fora, 'Write')]), { raiz: raiz, mesmoCodigoDaProva: sim }).provaPendente,
      false, 'codigo igual');
    assert.deepStrictEqual(chamadas, [['a', PROVA]]);
    // com o codigo mudado, ou com a funcao que lanca, conta
    assert.strictEqual(ver(suite.concat([edita('e', fora)]), { raiz: raiz, mesmoCodigoDaProva: () => false }).provaPendente,
      true, 'codigo mudado');
    assert.strictEqual(ver(suite.concat([edita('e', fora)]), { raiz: raiz, mesmoCodigoDaProva: () => { throw new Error('x'); } })
      .provaPendente, true, 'funcao que lanca');
    // so o true perdoa
    assert.strictEqual(ver(suite.concat([edita('e', fora)]), { raiz: raiz, mesmoCodigoDaProva: () => 1 }).provaPendente,
      true, 'valor que nao e true');
    // a edicao de dentro do projeto conta sempre, mesmo com o codigo igual
    assert.strictEqual(ver(suite.concat([edita('e', fora), edita('d', dentro)]), { raiz: raiz, mesmoCodigoDaProva: sim })
      .provaPendente, true, 'dentro do projeto');
    assert.strictEqual(ver(suite.concat([edita('d', 'src/x.js')]), { raiz: raiz, mesmoCodigoDaProva: sim }).provaPendente,
      true, 'caminho relativo e de dentro');
    // sem a raiz nao ha como separar: conta
    assert.strictEqual(ver(suite.concat([edita('e', fora)]), { mesmoCodigoDaProva: sim }).provaPendente, true, 'sem raiz');
    assert.strictEqual(ver(suite.concat([edita('e', fora)]), { raiz: '', mesmoCodigoDaProva: sim }).provaPendente, true,
      'raiz vazia');
    // a pasta irma com o nome da raiz como prefixo, e o relativo que sobe, ficam fora (a regua e o path.relative)
    assert.strictEqual(ver(suite.concat([edita('e', raiz + '-copia/a.js')]), { raiz: raiz, mesmoCodigoDaProva: sim })
      .provaPendente, false, 'pasta irma com o mesmo prefixo');
    assert.strictEqual(ver(suite.concat([edita('e', '../fora.js')]), { raiz: raiz, mesmoCodigoDaProva: sim }).provaPendente,
      false, 'relativo que sobe');
    // sem prova nenhuma antes, nao ha lancamento para comparar: conta
    assert.strictEqual(ver([edita('e', fora)], { raiz: raiz, mesmoCodigoDaProva: sim }).provaPendente, true, 'sem prova');
    // a edicao de fora ANTES da prova nao pede nada, nem pergunta
    chamadas.length = 0;
    assert.strictEqual(ver([edita('e', fora)].concat(suite), { raiz: raiz, mesmoCodigoDaProva: sim }).provaPendente, false,
      'edicao de fora antes da prova');
    assert.deepStrictEqual(chamadas, [], 'nao pergunta sem edicao de fora depois da prova');
    // a prova em segundo plano: o id do lancamento vai a funcao
    chamadas.length = 0;
    const verde = pathT.join(outra, 'verde.output');
    fsT.writeFileSync(verde, '# tests 3\n# pass 3\n# fail 0\n');
    const fundo = [emFundo('b', PROVA), lancado('b'),
      fimDoFundo('b', 'completed', 'Background command "suite" completed (exit code 0)', verde)];
    assert.strictEqual(ver(fundo.concat([edita('e', fora)]), { raiz: raiz, mesmoCodigoDaProva: sim }).provaPendente, false,
      'segundo plano, codigo igual');
    assert.deepStrictEqual(chamadas, [['b', PROVA]], 'segundo plano: o id e o comando do lancamento');
    assert.strictEqual(ver(fundo.concat([edita('e', fora)]), { raiz: raiz }).provaPendente, true, 'segundo plano, sem funcao');
    // a prova ainda rodando nao e prova: a edicao de fora (de antes ou depois do lancamento) nao e perdoada
    assert.strictEqual(ver([edita('x', dentro), emFundo('b', PROVA), lancado('b'), edita('e', fora)],
      { raiz: raiz, mesmoCodigoDaProva: sim }).provaPendente, true, 'segundo plano ainda rodando');
  } finally {
    fsT.rmSync(raiz, { recursive: true, force: true });
    fsT.rmSync(outra, { recursive: true, force: true });
  }
});

// F1d (D828.4): a prova focada - cada arquivo de codigo editado depois da ultima prova declarada tem, depois da propria
// ultima edicao, um teste verde que o cobre (o teste e o proprio arquivo ou o cita pelo nome); e a prova vermelha.
test('F1d: testesDoTranscript ve a prova focada por arquivo tocado e a ultima prova declarada vermelha', () => {
  const raiz = fsT.mkdtempSync(pathT.join(osT.tmpdir(), 'sworn-focada-'));
  const transcritos = [];
  try {
    fsT.mkdirSync(pathT.join(raiz, 'scripts', 'lib'), { recursive: true });
    fsT.mkdirSync(pathT.join(raiz, 'test'));
    const x = pathT.join(raiz, 'scripts', 'lib', 'x.js');
    const y = pathT.join(raiz, 'scripts', 'lib', 'y.js');
    fsT.writeFileSync(pathT.join(raiz, 'test', 'x.test.js'), "require('../scripts/lib/x.js');\n");
    fsT.writeFileSync(pathT.join(raiz, 'test', 'outro.test.js'), '// nada\n');
    const PROVA = 'node --test test/*.test.js';
    const ver = function (linhas) {
      const t = transcript(linhas);
      transcritos.push(t);
      return saude.testesDoTranscript(t.f, PROVA, false, { raiz: raiz });
    };
    // o teste que cita o arquivo, depois da edicao, verde: focada; a suite inteira continua pendente
    const ok = ver([edita('e1', x), cmd('a', 'node --test test/x.test.js'), res('a', '# pass 3\n# fail 0')]);
    assert.strictEqual(ok.provaPendente, true);
    assert.strictEqual(ok.provaFocada, true);
    // o caminho do Git Bash (/c/...) e o caminho absoluto do teste tambem casam
    const abs = ver([edita('e1', x), cmd('a', 'node --test "' + pathT.join(raiz, 'test', 'x.test.js') + '"'), res('a', '# fail 0')]);
    assert.strictEqual(abs.provaFocada, true);
    if (process.platform === 'win32') {
      const bash = '/' + raiz.charAt(0).toLowerCase() + raiz.slice(2).replace(/\\/g, '/') + '/test/x.test.js';
      assert.strictEqual(ver([edita('e1', x), cmd('a', '( cd /x && node --test ' + bash + ' )'), res('a', '# fail 0')]).provaFocada, true, bash);
    }
    // o nome dentro de outro nome nao cita: a.js nao casa em data.js
    const a = pathT.join(raiz, 'scripts', 'lib', 'a.js');
    fsT.writeFileSync(pathT.join(raiz, 'test', 'data.test.js'), "require('../scripts/lib/data.js');\n");
    assert.strictEqual(ver([edita('e1', a), cmd('a', 'node --test test/data.test.js'), res('a', '# fail 0')]).provaFocada, false);
    // o nome com maiuscula e achado com a caixa de quem editou (o caminho comparavel e minusculo no Windows)
    const maiusculo = pathT.join(raiz, 'scripts', 'lib', 'MeuModulo.js');
    fsT.writeFileSync(pathT.join(raiz, 'test', 'meu.test.js'), "require('../scripts/lib/MeuModulo.js');\n");
    assert.strictEqual(ver([edita('e1', maiusculo), cmd('a', 'node --test test/meu.test.js'), res('a', '# fail 0')]).provaFocada, true);
    // o caminho entre aspas, com espaco, e lido inteiro
    fsT.mkdirSync(pathT.join(raiz, 'com espaco'));
    fsT.writeFileSync(pathT.join(raiz, 'com espaco', 'x.test.js'), "require('../scripts/lib/x.js');\n");
    assert.strictEqual(ver([edita('e1', x), cmd('a', 'node --test "com espaco/x.test.js"'), res('a', '# fail 0')]).provaFocada, true);
    // o teste que nao e arquivo comum (uma pasta com o nome) nao cobre
    fsT.mkdirSync(pathT.join(raiz, 'test', 'pasta.test.js'));
    assert.strictEqual(ver([edita('e1', x), cmd('a', 'node --test test/pasta.test.js'), res('a', '# fail 0')]).provaFocada, false);
    // a borda direita do nome e o ponto literal: x.js nao casa em x.json, e a.js nao casa em aXjs
    fsT.writeFileSync(pathT.join(raiz, 'test', 'borda.test.js'),
      "require('../scripts/lib/x.json');\nrequire('../scripts/lib/aXjs');\n");
    assert.strictEqual(ver([edita('e1', x), cmd('a', 'node --test test/borda.test.js'), res('a', '# fail 0')]).provaFocada,
      false, 'x.js contra x.json');
    assert.strictEqual(ver([edita('e1', a), cmd('a', 'node --test test/borda.test.js'), res('a', '# fail 0')]).provaFocada,
      false, 'a.js contra aXjs');
    // citado com pasta, a pasta tem de ser a do arquivo: o index.js de outra pasta nao cobre o lib/index.js; o caminho
    // relativo que leva a ele e o nome solto cobrem
    const indice = pathT.join(raiz, 'scripts', 'lib', 'index.js');
    const naRaiz = pathT.join(raiz, 'index.js');
    fsT.writeFileSync(pathT.join(raiz, 'test', 'outra.test.js'),
      "require('../outra/index.js');\nrequire('./index.js');\nrequire('../outra/lib/index.js');\nler('outra/lib/index.js');\n");
    fsT.writeFileSync(pathT.join(raiz, 'test', 'fim.test.js'), "ler('scripts/lib/index.js');\n");
    assert.strictEqual(ver([edita('e1', indice), cmd('a', 'node --test test/fim.test.js'), res('a', '# fail 0')]).provaFocada,
      true, 'o caminho sem ponto que e o fim do caminho do arquivo');
    fsT.writeFileSync(pathT.join(raiz, 'test', 'relativo.test.js'), "require('../index.js');\n");
    fsT.writeFileSync(pathT.join(raiz, 'test', 'solto.test.js'), "rodar('index.js');\n");
    assert.strictEqual(ver([edita('e1', indice), cmd('a', 'node --test test/outra.test.js'), res('a', '# fail 0')]).provaFocada,
      false, 'index.js de outra pasta');
    assert.strictEqual(ver([edita('e1', naRaiz), cmd('a', 'node --test test/outra.test.js'), res('a', '# fail 0')]).provaFocada,
      false, './index.js a partir de test/ nao e o index.js da raiz');
    assert.strictEqual(ver([edita('e1', naRaiz), cmd('a', 'node --test test/relativo.test.js'), res('a', '# fail 0')]).provaFocada,
      true, '../index.js a partir de test/');
    assert.strictEqual(ver([edita('e1', indice), cmd('a', 'node --test test/solto.test.js'), res('a', '# fail 0')]).provaFocada,
      true, 'nome solto');
    // o teste em segundo plano conta pelo lancamento: lancado antes da edicao, nao prova a edicao
    const saidaBg = pathT.join(raiz, 'bg.output');
    fsT.writeFileSync(saidaBg, '# pass 1\n# fail 0\n');
    const lanca = emFundo('bg', 'node --test test/x.test.js');
    const fimBg = fimDoFundo('bg', 'completed', 'Background command "x" completed (exit code 0)', saidaBg);
    assert.strictEqual(ver([lanca, lancado('bg'), edita('e1', x), fimBg]).provaFocada, false, 'lancado antes da edicao');
    assert.strictEqual(ver([edita('e1', x), lanca, lancado('bg'), fimBg]).provaFocada, true, 'lancado depois da edicao');
    // o arquivo editado que nenhum teste rodado cita: nao e focada
    assert.strictEqual(ver([edita('e1', x), edita('e2', y), cmd('a', 'node --test test/x.test.js'), res('a', '# fail 0')]).provaFocada, false);
    // o teste que nao cita o arquivo: nao cobre
    assert.strictEqual(ver([edita('e1', x), cmd('a', 'node --test test/outro.test.js'), res('a', '# fail 0')]).provaFocada, false);
    // vermelho nao vale
    assert.strictEqual(ver([edita('e1', x), cmd('a', 'node --test test/x.test.js'), res('a', 'Exit code 1\n# fail 1', true)]).provaFocada, false);
    // o verde seguido de um vermelho do mesmo teste, sem edicao no meio, nao vale
    assert.strictEqual(ver([edita('e1', x), cmd('a', 'node --test test/x.test.js'), res('a', '# fail 0'),
      cmd('b', 'node --test test/x.test.js'), res('b', 'Exit code 1\n# fail 1', true),
      cmd('c', 'node --test test/outro.test.js'), res('c', '# fail 0')]).provaFocada, false);
    // o teste antes da ultima edicao do arquivo nao vale
    assert.strictEqual(ver([cmd('a', 'node --test test/x.test.js'), res('a', '# fail 0'), edita('e1', x)]).provaFocada, false);
    // o teste editado e rodado cobre a si mesmo
    const proprio = pathT.join(raiz, 'test', 'outro.test.js');
    assert.strictEqual(ver([edita('e1', proprio), cmd('a', 'node --test test/outro.test.js'), res('a', '# fail 0')]).provaFocada, true);
    // depois da suite inteira, sem edicao nova, nao ha o que focar
    assert.strictEqual(ver([edita('e1', x), cmd('a', PROVA), res('a', '# fail 0')]).provaFocada, false);
    // a ultima prova declarada que falhou e vermelha; a verde depois dela, nao
    assert.strictEqual(ver([cmd('a', PROVA), res('a', 'Exit code 1\n# fail 2', true)]).provaVermelha, true);
    assert.strictEqual(ver([cmd('a', PROVA), res('a', 'Exit code 1', true), cmd('b', PROVA), res('b', '# fail 0')]).provaVermelha, false);
    // a prova em segundo plano que terminou vermelha tambem e vermelha; sem prova nenhuma, nao
    const saidaVermelha = pathT.join(raiz, 'vermelha.output');
    fsT.writeFileSync(saidaVermelha, '# pass 1\n# fail 2\n');
    assert.strictEqual(ver([emFundo('bv', PROVA), lancado('bv'),
      fimDoFundo('bv', 'failed', 'Background command "x" failed with exit code 1', saidaVermelha)]).provaVermelha,
    true, 'prova em segundo plano vermelha');
    assert.strictEqual(ver([edita('e1', x)]).provaVermelha, false, 'sem prova nenhuma');
    // sem a raiz, os campos novos nao aparecem (quem chama sem pedir nao muda)
    const t = transcript([edita('e1', x), cmd('a', 'node --test test/x.test.js'), res('a', '# fail 0')]);
    transcritos.push(t);
    assert.strictEqual('provaFocada' in saude.testesDoTranscript(t.f, PROVA), false);
    // F1c (D828): com opcoes.coerencia, coerenciaVerde = a ultima rodada do grupo depois da ultima edicao passou
    const G = 'node --test test/plataforma.test.js test/readme.test.js';
    const comGrupo = function (linhas) {
      const tg = transcript(linhas);
      transcritos.push(tg);
      return saude.testesDoTranscript(tg.f, PROVA, false, { raiz: raiz, coerencia: G });
    };
    assert.strictEqual(comGrupo([edita('e1', x), cmd('g', G), res('g', '# fail 0')]).coerenciaVerde, true, 'grupo verde');
    assert.strictEqual(comGrupo([edita('e1', x)]).coerenciaVerde, false, 'grupo nao rodou');
    assert.strictEqual(comGrupo([cmd('g', G), res('g', '# fail 0'), edita('e1', x)]).coerenciaVerde, false,
      'grupo antes da edicao');
    assert.strictEqual(comGrupo([edita('e1', x), cmd('g', G), res('g', 'Exit code 1\n# fail 1', true)]).coerenciaVerde,
      false, 'grupo vermelho');
    assert.strictEqual(comGrupo([edita('e1', x), cmd('g', G), res('g', '# fail 0'), cmd('h', G),
      res('h', 'Exit code 1\n# fail 1', true)]).coerenciaVerde, false, 'verde e depois vermelho');
    assert.strictEqual(comGrupo([edita('e1', x), cmd('g', 'node --test test/plataforma.test.js'), res('g', '# fail 0')])
      .coerenciaVerde, false, 'so uma parte do grupo');
    assert.strictEqual('coerenciaVerde' in ver([edita('e1', x)]), false, 'sem o grupo, o campo nao aparece');
    // o grupo de dois pedacos (a && b) so vale com os dois no comando
    const G2 = 'node --test test/plataforma.test.js && node --test test/readme.test.js';
    const doisPedacos = function (comando) {
      const tg = transcript([edita('e1', x), cmd('g', comando), res('g', '# fail 0')]);
      transcritos.push(tg);
      return saude.testesDoTranscript(tg.f, PROVA, false, { raiz: raiz, coerencia: G2 }).coerenciaVerde;
    };
    assert.strictEqual(doisPedacos(G2), true, 'os dois pedacos');
    assert.strictEqual(doisPedacos('node --test test/plataforma.test.js'), false, 'so o primeiro pedaco');
    assert.strictEqual(doisPedacos('node --test test/readme.test.js'), false, 'so o segundo pedaco');
  } finally {
    transcritos.forEach(function (c) { c.fim(); });
    fsT.rmSync(raiz, { recursive: true, force: true });
  }
});

// F5b r1 (borda): com duas conferencias rodando, o motivo citava a lancada primeiro, nao a mais recente.
test('F5b r1: com duas conferencias da tela rodando, o motivo cita a mais recente', () => {
  const r = comTranscript([emFundo('a', 'node scripts/conferir-tela.js --url http://a --referencia http://b --saida s1'),
    lancado('a'), emFundo('b', 'node scripts/conferir-tela.js --url http://a --referencia http://b --saida s2'), lancado('b')],
  (f) => saude.testesDoTranscript(f, 'npm test'));
  assert.strictEqual(r.conferenciaRodando, true);
  assert.match(r.comandoDaConferenciaRodando, /--saida s2$/);
});
