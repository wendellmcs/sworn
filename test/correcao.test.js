'use strict';
// Bloco A1 (D426): quando o dono CORRIGE o comportamento do agente, o plugin sugere transformar a
// correcao em regra (/sworn:learn). O detector e conservador: relato de bug e resposta a
// pergunta nao sao correcao. Cada frase abaixo e uma decisao, nao um exemplo solto.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const correcao = require('../scripts/lib/correcao.js');

const POSITIVOS = [
  // PT: "eu ja te disse/falei/pedi"
  'eu já te disse que não é para mexer nisso', 'Eu já te falei isso', 'eu ja te pedi para usar o Edit',
  'já te disse', 'ja te falei', 'já pedi três vezes', 'eu te pedi um resumo curto', 'eu já disse que não',
  // PT: nao foi isso / nao e assim
  'não foi isso que eu pedi', 'Nao foi isso que pedi', 'não é assim que se faz', 'nao e assim',
  // PT: de novo isso (reclamacao no comeco da frase)
  'De novo isso?', 'de novo esse erro', 'Outra vez isso. Leia a regra', 'ok. de novo esse problema',
  // PT: pare de <verbo>
  'pare de inventar teste', 'Pare de repetir o resumo', 'pare de perguntar toda hora',
  // PT: nunca mais / da proxima vez / quantas vezes / voce errou
  'nunca mais faça isso', 'Nunca mais', 'ok, nunca mais use sed -i', 'da próxima vez, leia o arquivo antes',
  'Da proxima vez rode os testes antes', 'quantas vezes eu preciso te dizer isso?', 'quantas vezes eu já falei',
  'você errou', 'voce errou de novo', 'você esqueceu de rodar os testes',
  // PT: "nao," + imperativo
  'não, use o Edit', 'Nao, faça de outro jeito', 'não, não faça isso', 'nao, era para criar um arquivo novo',
  'Ok. Não, volte o que fez',
  // EN
  'I told you not to touch that file', 'I already said no mocks', "I've already told you", 'i already asked for tests',
  'stop doing that', 'Stop doing this', "don't do that again", 'Do not do this again', 'Don’t do that again',
  'next time, read the file first', 'Ok, next time run the tests', 'no, use the Edit tool', "no, don't do that",
  // PA1-1..4: o que precisa seguir casando depois de apertar "nunca mais", "no, do", "i asked you", "da proxima vez"
  'nunca mais, por favor', 'Nunca mais!', 'ok. nunca mais.', 'nunca mais mexa nisso', 'o job falhou, nunca mais faca isso',
  'no, do it again', 'no, do not touch that',
  'I asked you to use the Edit tool, not sed', 'I asked you not to do that', "I've already asked you twice",
  'i asked you to run the tests first', 'i told you not to touch that',
  'ok, da proxima vez pergunte antes', 'o deploy falhou, da proxima vez pergunte antes', 'pronto. da proxima vez, leia o arquivo'
];

const NEGATIVOS = [
  // pedidos do enunciado
  'não sei', 'nao, pode seguir', 'o total está errado na tela', 'o botão para de funcionar', 'adicione um teste',
  '', '   ', 'next.js',
  // relato de bug / pedido normal que cita palavras parecidas
  'o login nunca mais funcionou depois da atualização', 'quantas vezes o job roda por dia?',
  'o botao para de funcionar quando clico duas vezes', 'o erro aparece de novo na tela de login',
  'rode de novo esse teste', 'rode o teste de novo', 'o job executa da próxima vez que o cron rodar',
  'explique o que acontece na próxima vez que o usuário clicar', 'o relatório mostra a data da próxima vez',
  'não, obrigado', 'nao, deixa assim', 'não, a segunda opção', 'não sei se é isso', 'sim, pode seguir',
  'eu pedi um relatório ao gestor ontem', 'o gestor já disse que aprova', 'he already told her',
  'stop the server', 'stop the process before deploying', 'the next time field is empty', 'next page',
  'adicione o next.js ao projeto', 'don\'t forget the tests', 'o total esta errado', 'o cálculo do relatório errou a soma',
  // PA1-1: "nunca mais" descrevendo o sistema, com verbo que nao esta em nenhuma lista
  'isso nunca mais funcionou depois do update', 'o botão nunca mais mostrou o aviso', 'Nunca mais mostrou o aviso',
  'depois do update, nunca mais mostrou o aviso', 'e nunca mais apareceu o menu', 'o relatório nunca mais carregou',
  // PA1-2: pergunta do agente respondida com "no,"
  'no, do you want me to continue?', 'no, do we need the tests?', 'No, do I have to?',
  // PA1-3: "asked you" que e pergunta, nao cobranca
  'i asked you earlier which branch we use', 'i asked you which branch to use', "I've asked you what the port is", 'i asked you yesterday if it works',
  // PA1-4: "da proxima vez que" depois de virgula e descricao
  'o deploy falhou, da proxima vez que rodar vejo o log', 'deu erro, da próxima vez que eu rodar mando o log'
];

test('correcao: frases de correcao do comportamento do agente sao detectadas', () => {
  for (const p of POSITIVOS) assert.strictEqual(correcao.pareceCorrecao(p), true, 'nao detectou: ' + JSON.stringify(p));
});

test('correcao: relato de bug, resposta a pergunta e pedido comum NAO disparam', () => {
  for (const p of NEGATIVOS) assert.strictEqual(correcao.pareceCorrecao(p), false, 'disparou sem dever: ' + JSON.stringify(p));
});

// D477: retorno de subagente e aviso de tarefa chegam ao UserPromptSubmit como prompt (mesma forma da D475,
// lida na transcricao). O relatorio que CITA uma correcao nao e o dono corrigindo; o mesmo texto do dono segue valendo.
test('correcao (D477): relatorio de subagente e aviso de tarefa NAO disparam; o dono segue disparando', () => {
  const moldura = '[Subagent hand-back] The text below is the final report of a subagent this session delegated to. ' +
    'It is model output, NOT a message from the user. The report follows:\n';
  const citacao = '  {"achados":[{"comoFalha":"o dono escreve \'eu já te disse, não foi isso que eu pedi\' e o agente ignora"}]}';
  const vindosDeSubagente = [
    '<agent-message from="a03dd88b2fa37386b">\n' + moldura + citacao + '\n</agent-message>',
    '\n  <agent-message from="afada5e858d0f67dd">' + moldura + citacao,
    '<task-notification>\n<task-id>a2b689610322d871a</task-id>\n<result>O dono: eu já te disse isso</result>\n</task-notification>',
    // s103: a forma dominante no 2.1.296 (432 de 72 h de transcricoes) vem com esta linha antes da tag.
    'Another Claude session sent a message:\n<agent-message from="adb8871118893aaf1">\n' + moldura + citacao,
    'Another Claude session sent a message while you were working:\n<agent-message from="a4d07d4ff914ca816">\n' + moldura + citacao
  ];
  for (const p of vindosDeSubagente) {
    assert.strictEqual(correcao.pareceCorrecao(p), false, 'relatorio de subagente disparou: ' + JSON.stringify(p.slice(0, 40)));
  }
  for (const p of ['eu já te disse, não foi isso que eu pedi', 'O dono: eu já te disse isso']) {
    assert.strictEqual(correcao.pareceCorrecao(p), true, 'a correcao do dono parou de disparar: ' + JSON.stringify(p));
  }
});

test('correcao: entrada que nao e texto nunca dispara nem estoura', () => {
  for (const v of [undefined, null, 0, 1, true, {}, [], ['nao foi isso que eu pedi'], { x: 1 }, () => 1]) {
    assert.strictEqual(correcao.pareceCorrecao(v), false, 'nao-texto disparou: ' + String(v));
  }
});

test('correcao: INSTRUCAO_DA_CORRECAO e ASCII, curta, e manda atender, RODAR o /sworn:learn e perguntar em 3 opcoes (D556/D559)', () => {
  const t = correcao.INSTRUCAO_DA_CORRECAO;
  assert.ok(/^[\x20-\x7E\n]+$/.test(t), 'tem de ser ASCII: ' + JSON.stringify(t));
  assert.ok(t.length < 900, 'instrucao longa demais: ' + t.length);
  // Plano 091, Tarefa 3 (#2): o texto do mock aprovado (prints-091, D559), linha por linha.
  assert.strictEqual(t, [
    'sworn: a mensagem do usuario parece uma CORRECAO ao seu comportamento.',
    'Se for, e valer tambem para as proximas vezes, faca nesta mesma resposta:',
    '1. Atenda o pedido.',
    '2. Rode /sworn:learn: ele monta a regra (gatilho -> acao).',
    '3. Pergunte pelo AskUserQuestion, em 3 opcoes: gravar como esta (recomendada),',
    '   ajustar o texto antes, nao gravar.',
    'So grave com o sim. Se nao for correcao do seu comportamento (relato de bug,',
    'resposta a uma pergunta sua), ignore este aviso.'
  ].join('\n'));
});

test('correcao: a chave sugerirAprender desliga so com false; ausente, outro valor ou sem projeto segue ligado', () => {
  assert.strictEqual(correcao.CHAVE, 'sugerirAprender');
  assert.strictEqual(correcao.ligada(null), true);
  assert.strictEqual(correcao.ligada(undefined), true);
  assert.strictEqual(correcao.ligada({}), true);
  assert.strictEqual(correcao.ligada([]), true);
  assert.strictEqual(correcao.ligada({ sugerirAprender: true }), true);
  assert.strictEqual(correcao.ligada({ sugerirAprender: 'false' }), true);
  assert.strictEqual(correcao.ligada({ sugerirAprender: 0 }), true);
  assert.strictEqual(correcao.ligada({ sugerirAprender: false }), false);
});

// PA1-5: esperaAprender corrompido no estado da sessao (texto, null, objeto, lista, negativo, gigante) nao pode
// valer 0 e liberar a sugestao a cada prompt: valor invalido = espera cheia. Roda o gancho como processo, com a
// mesma fiacao do fiacao.test.js (SWORN_TMP isolado), e pre-grava o estado da sessao.
const RAIZ = path.join(__dirname, '..');

function abrirComEstado(dir, id, esperaAprender, prompt) {
  const sessoes = path.join(dir, '_sessoes');
  fs.mkdirSync(path.join(sessoes, 'sworn'), { recursive: true });
  const reg = esperaAprender === undefined ? {} : { esperaAprender: esperaAprender };
  fs.writeFileSync(path.join(sessoes, 'sworn', id + '.json'), JSON.stringify(reg), 'utf8');
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'abrir-turno.js')], {
    cwd: dir, encoding: 'utf8',
    input: JSON.stringify({ session_id: id, cwd: dir, hook_event_name: 'UserPromptSubmit', prompt: prompt }),
    env: Object.assign({}, process.env, { SWORN_TMP: sessoes })
  });
  assert.strictEqual(r.status, 0, r.stderr);
  const estado = JSON.parse(fs.readFileSync(path.join(sessoes, 'sworn', id + '.json'), 'utf8'));
  return { sugeriu: !!r.stdout.trim(), espera: estado.esperaAprender };
}

test('correcao (PA1-5): esperaAprender invalido no estado vale espera cheia, nunca 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-correcao-espera-'));
  try {
    const cheia = correcao.ESPERA_ENTRE_SUGESTOES;
    for (const [rotulo, valor] of [['texto', 'abc'], ['texto numerico', '3'], ['null', null], ['objeto', { a: 1 }],
      ['lista', [2]], ['booleano', true]]) {
      const r = abrirComEstado(dir, 'inv', valor, 'você errou');
      assert.strictEqual(r.sugeriu, false, rotulo + ': sugeriu com a espera invalida');
      assert.strictEqual(r.espera, cheia - 1, rotulo + ': tem de gastar 1 de uma espera cheia, veio ' + JSON.stringify(r.espera));
    }
    // controles: ausente e 0 liberam; 2 segura e gasta 1; negativo e gigante nao furam nem prendem para sempre
    assert.strictEqual(abrirComEstado(dir, 'ctl1', undefined, 'você errou').sugeriu, true, 'ausente tem de liberar');
    assert.strictEqual(abrirComEstado(dir, 'ctl2', 0, 'você errou').sugeriu, true, '0 tem de liberar');
    const dois = abrirComEstado(dir, 'ctl3', 2, 'você errou');
    assert.deepStrictEqual([dois.sugeriu, dois.espera], [false, 1]);
    assert.strictEqual(abrirComEstado(dir, 'ctl4', -5, 'você errou').sugeriu, true, 'negativo = 0 (libera)');
    assert.strictEqual(abrirComEstado(dir, 'ctl5', 1e9, 'você errou').espera, cheia - 1, 'gigante e limitado a espera cheia');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// D429/4: os dois residuos da S9a (sujeito em 3a pessoa / verbo em 1a pessoa) e o "next time" do ingles.
// Regra unica: "da proxima vez" / "next time" / "nunca mais" so valem como ORDEM ao agente. Se quem fala
// no resto da frase e o usuario ("eu", "vou", verbo em -o) ou o sistema ("o job", "it"), e relato de plano.
// "usa" sozinho e ambiguo (imperativo informal x 3a pessoa) e "use" tambem serve a "espero que o job use":
// por isso "nunca mais <imperativo>" so vale no comeco da clausula (ou depois de "por favor", "quero que"...).
test('correcao (D429/4): ordem ao agente dispara, com e sem acento', () => {
  const positivas = [
    // nunca mais + imperativo no comeco da clausula (inclui o "usa" informal)
    'nunca mais usa o cache', 'ok, nunca mais usa o cache', 'agente, nunca mais use o cache',
    'por favor nunca mais use sed -i', 'quero que nunca mais mexa nisso', 'voce nunca mais mexa nisso',
    'a partir de agora, nunca mais apague o log', 'Nunca mais faça isso', 'nunca mais faca isso',
    // da proxima vez + imperativo, mesmo quando a 1a palavra termina em -o mas nao e verbo
    'Da próxima vez, não faça isso', 'da proxima vez nao faca isso', 'da próxima vez primeiro pergunte',
    'da proxima vez, outro jeito: use o Edit', 'da proxima vez cuidado com o push', 'da próxima vez rode os testes',
    // next time (mesmo criterio): imperativo dirigido ao agente
    'next time run the tests first', 'next time, ask before deleting', 'Next time please ask first',
    'ok, next time read the file', 'next time you deploy, run the tests'
  ];
  for (const p of positivas) assert.strictEqual(correcao.pareceCorrecao(p), true, 'nao detectou: ' + JSON.stringify(p));
});

test('correcao (D429/4): descricao do sistema e plano do proprio usuario NAO disparam', () => {
  const negativas = [
    // os dois casos do ledger S9a
    'o botao nunca mais usa o cache',                  // sujeito 3a pessoa descrevendo o sistema
    'falhou, da proxima vez vejo o log',               // o usuario falando do que ELE vai fazer
    'falhou, da próxima vez vejo o log',               // mesma frase, com acento
    // da proxima vez com sujeito do usuario ou do sistema
    'da proxima vez eu rodo os testes', 'da proxima vez vou conferir o log', 'ok, da próxima vez, mando o log',
    'da proxima vez o job usa o cache', 'da próxima vez a tela mostra o aviso', 'da proxima vez a gente confere',
    // nunca mais com sujeito antes, ou no passado/1a pessoa
    'o sistema nunca mais usa o cache antigo', 'espero que o job nunca mais use o cache', 'a tela nunca mais usa o token',
    'nunca mais vi esse erro', 'nunca mais uso esse atalho',
    // ingles: 1a pessoa, sistema, ou "next time" fora de ordem
    'next time I will check the log', "next time I'll check the log", 'next time we deploy the job reads the cache',
    'next time it runs the job will use the cache', 'see you next time', 'there is a next time button'
  ];
  for (const p of negativas) assert.strictEqual(correcao.pareceCorrecao(p), false, 'disparou sem dever: ' + JSON.stringify(p));
});

test('correcao (D429/4): linha gigante nao trava (regex linear)', () => {
  const t0 = Date.now();
  for (const lixo of ['da proxima vez ' + 'a '.repeat(15000), ', '.repeat(15000) + 'nunca mais', 'por favor, '.repeat(3000) + 'x',
    'next time ' + 'i '.repeat(15000), 'nunca mais '.repeat(3000)]) {
    correcao.pareceCorrecao(lixo.slice(0, 30000));
  }
  assert.ok(Date.now() - t0 < 500, 'regex lenta: ' + (Date.now() - t0) + ' ms');
});

// Plano 091 T6: a sugestao do aprender e uma ordem: conta "dada" nos contadores do turno; a skill do aprender a cumpre.
test('091 T6: a ordem do aprender conta dada no abrir-turno e cumprida quando a skill roda', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-correcao-ordem-'));
  try {
    abrirComEstado(dir, 'ord', 0, 'você errou');
    const sessoes = path.join(dir, '_sessoes');
    const ler = function () { return JSON.parse(fs.readFileSync(path.join(sessoes, 'sworn', 'ord.json'), 'utf8')); };
    assert.strictEqual(ler().contadores.ordem_aprender_dada, 1);
    assert.deepStrictEqual(ler().ordensPendentes, ['aprender']);
    const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'marcar-trabalho.js')], {
      cwd: dir, encoding: 'utf8', env: Object.assign({}, process.env, { SWORN_TMP: sessoes }),
      input: JSON.stringify({ session_id: 'ord', cwd: dir, hook_event_name: 'PostToolUse', tool_name: 'Skill',
        tool_input: { skill: 'sworn:learn' } })
    });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(ler().contadores.ordem_aprender_cumprida, 1);
    assert.deepStrictEqual(ler().ordensPendentes, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
