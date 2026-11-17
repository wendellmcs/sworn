import { expect, mock, test } from 'claude-code/testing'

// Bloco M (D435): o mod do sworn e cola fina. A conta e o texto moram em scripts/sessao.js e
// scripts/plano.js (testados pela suite node --test); aqui se prova a cola: o que o mod pede ao
// motor, o que manda ao script e o que mostra. Roda com `claude plugin test` (2.1.287+).

const USO = {
  startedAt: 0,
  context: { tokens: 46900, window: 1000000, percent: 5 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 49, resetsAt: '2026-10-11T23:20:00.000Z' }],
  cost: { usd: 1 },
}

const BANDA = {
  plugin: 'sworn',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  viewport: { columns: 100, rows: 30 },
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 96, scroll: { offset: 0, bodyRows: 10 } },
} as const

type Chamada = { argv: readonly string[]; stdin?: string }

function medidor(on: any, chamadas: Chamada[], resposta: { curta: string; longa: string; cruzou: boolean }, ...id: unknown[]) {
  // Sem o 4o argumento, 'sess-abc'; com ele (ate undefined), o valor dado - parametro padrao engoliria o undefined.
  on('session.usage', () => ({ value: USO }))
  on('session.id', () => ({ value: id.length ? id[0] : 'sess-abc' }))
  on('process.run', ($: unknown, e: any) => {
    chamadas.push({ argv: e.argv, stdin: e.init && e.init.stdin })
    if (String(e.argv[1]).endsWith('/scripts/plano.js')) {
      return { value: { exitCode: 0, stdout: 'sworn - painel do plano\ntarefas: 1 de 3 concluidas\n', stderr: '' } }
    }
    return { value: { exitCode: 0, stdout: JSON.stringify(resposta) + '\n', stderr: '' } }
  })
}

test('session.start registra /sworn-session e /sworn-plan', async ($, on) => {
  const nomes: string[] = []
  const descricoes: Record<string, string> = {}
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($, e) => {
    nomes.push(e.name)
    descricoes[e.name] = String(e.description)
    return { value: undefined }
  })
  await $.session.start({ surface: 'vscode', isInteractive: true, cwd: '/work' })
  expect(nomes).toContain('sworn-session')
  expect(nomes).toContain('sworn-plan')
  // Plano 082 (p5-19): a descricao no menu sem jargao. ASCII: a sonda da T1 nao provou acento no menu de comandos.
  expect(descricoes['sworn-session']).toBe('sworn: uso da conversa e dos limites de 5 horas e da semana, gasto e quando trocar de chat')
  expect(/^[\x20-\x7E]*$/.test(descricoes['sworn-session'])).toBe(true)
})

test('/sworn-session manda uso e sessao ao sessao.js e responde a linha longa', async ($, on) => {
  const chamadas: Chamada[] = []
  medidor(on, chamadas, { curta: 'sworn | contexto 5%', longa: 'sworn - medidor da sessao\ncontexto: 5%', cruzou: false })
  const r = await $.command.run({ command: 'sworn-session', args: '' })
  expect(r.text).toBe('sworn - medidor da sessao\ncontexto: 5%')
  expect(chamadas.length).toBe(1)
  expect(chamadas[0].argv[0]).toBe('node')
  expect(String(chamadas[0].argv[1]).endsWith('/scripts/sessao.js')).toBe(true)
  const enviado = JSON.parse(String(chamadas[0].stdin))
  expect(enviado.sessao).toBe('sess-abc')
  expect(enviado.uso.context.percent).toBe(5)
  expect(enviado.amostras).toEqual([])
})

test('/sworn-plan responde o painel do plano.js --texto', async ($, on) => {
  const chamadas: Chamada[] = []
  medidor(on, chamadas, { curta: '', longa: '', cruzou: false })
  const r = await $.command.run({ command: 'sworn-plan', args: '' })
  expect(r.text).toMatch(/tarefas: 1 de 3 concluidas/)
  expect(chamadas[0].argv).toContain('--texto')
  // D476: sem plano-ativo.json o plano vem da frente vinculada a sessao; o script precisa do id para achar o vinculo.
  const i = chamadas[0].argv.indexOf('--sessao')
  expect(i).toBeGreaterThan(-1)
  expect(chamadas[0].argv[i + 1]).toBe('sess-abc')
})

// D469 (R1 de hooks/mods.tsx, s103): String(undefined) vira 'undefined', verdadeiro; o mod passava --sessao undefined e
// o plano.js nao caia no CLAUDE_CODE_SESSION_ID do ambiente. Sem id de verdade, nada de --sessao.
for (const vazio of [undefined, null, '']) {
  test('/sworn-plan sem id de sessao (' + String(vazio) + ') nao passa --sessao', async ($, on) => {
    const chamadas: Chamada[] = []
    medidor(on, chamadas, { curta: '', longa: '', cruzou: false }, vazio)
    const r = await $.command.run({ command: 'sworn-plan', args: '' })
    expect(r.text).toMatch(/tarefas: 1 de 3 concluidas/)
    expect(chamadas[0].argv).toContain('--texto')
    expect(chamadas[0].argv).not.toContain('--sessao')
  })
}

// A7-22 (pedido 12): a resposta serve a qualquer falha (Node ausente, saida diferente de 0, JSON torto, prazo
// estourado), que caem todas no mesmo ramo do mods.tsx; o teste simula a saida 1, a saida 0 com stdout que nao
// e JSON ou que e JSON sem a curta em texto (A7-81; esses so no /sworn-session: o plano.js --texto responde texto) e
// o process.run que lanca (A7-72). Ela diz as
// causas possiveis e um passo que serve a qualquer uma (pedir ao Claude), sem mandar quem nao programa ao terminal.
// P2 da R1 (s241): sem o caminho do script nem os passos tecnicos; o Node.js fica so como causa (e o que se instala).
// A7-60 e A7-62: sem "medida" nem "script do sworn" (termos internos); a frase pronta para o Claude e o que ele traz.
const PARADO_SESSAO = 'Medidor parado: o sworn não leu os números de uso (pode faltar o Node.js, ' +
  'ou o sworn falhou ou demorou). Diga ao Claude "ache por que o medidor do sworn parou": ele procura a ' +
  'causa e o conserto. Depois rode /sworn-session de novo.'
const PARADO_PLANO = 'Painel do plano parado: o sworn não leu o plano (pode faltar o Node.js, ou o sworn falhou ' +
  'ou demorou). Diga ao Claude "ache por que o painel do plano do sworn parou": ele procura a causa e o ' +
  'conserto. Depois rode /sworn-plan de novo.'

const FALHAS = [
  { nome: 'saida 1', run: () => ({ value: { exitCode: 1, stdout: '', stderr: 'node nao achado' } }) },
  { nome: 'saida 0 sem JSON', soSessao: true,
    run: () => ({ value: { exitCode: 0, stdout: 'isto nao e JSON', stderr: '' } }) },
  // A7-81: JSON valido sem a curta em texto (o mod so aceita a medida com curta em texto): sem o campo, null e a
  // curta que nao e texto.
  { nome: 'JSON sem os campos', soSessao: true,
    run: () => ({ value: { exitCode: 0, stdout: '{"x":1}', stderr: '' } }) },
  { nome: 'JSON null', soSessao: true, run: () => ({ value: { exitCode: 0, stdout: 'null', stderr: '' } }) },
  { nome: 'curta que nao e texto', soSessao: true,
    run: () => ({ value: { exitCode: 0, stdout: '{"curta":1,"longa":"l","cruzou":false}', stderr: '' } }) },
  { nome: 'run que lanca', run: () => { throw new Error('prazo estourado') } },
]

for (const falha of FALHAS) {
  test('script que falha (' + falha.nome + '): o comando responde o motivo, nao lanca', async ($, on) => {
    on('session.usage', () => ({ value: USO }))
    on('session.id', () => ({ value: 'sess-abc' }))
    on('process.run', falha.run)
    const r = await $.command.run({ command: 'sworn-session', args: '' })
    // Sem "sworn:" na frente: o motor ja escreve o nome do plugin antes da resposta.
    expect(r.text).toBe(PARADO_SESSAO)
    if (falha.soSessao) return
    const p = await $.command.run({ command: 'sworn-plan', args: '' })
    expect(p.text).toBe(PARADO_PLANO)
  })
}

test('fim de turno: guarda a amostra do turno e poe a linha curta no status', async ($, on) => {
  const chamadas: Chamada[] = []
  const status: (string | undefined)[] = []
  medidor(on, chamadas, { curta: 'sworn | contexto 5%', longa: 'x', cruzou: false })
  on('ui.status', ($, e) => {
    status.push(e.text)
    return { value: undefined }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  expect(status).toContain('sworn | contexto 5%')
  await $.command.run({ command: 'sworn-session', args: '' })
  const ultimo = JSON.parse(String(chamadas[chamadas.length - 1].stdin))
  expect(ultimo.amostras).toEqual([{ tokens: 46900, cincoH: 49 }])
})

// A7-22: o status diz que a medida falhou, que ela roda de novo e o passo se seguir (o comando diz a causa possivel).
// A7-59 e A7-62: "a leitura do uso" no lugar de "a medida", e o que o comando mostra.
const MEDIDOR_PARADO = 'medidor parado: a leitura do uso falhou e volta na próxima resposta; ' +
  'se seguir, /sworn-session mostra a causa.'

test('script que falha no fim do turno: o status diz que o medidor nao respondeu, nao fica com o numero velho', async ($, on) => {
  let falha = false
  const status: (string | undefined)[] = []
  on('session.usage', () => ({ value: USO }))
  on('session.id', () => ({ value: 'sess-abc' }))
  on('process.run', () => ({ value: falha
    ? { exitCode: 1, stdout: '', stderr: 'node nao achado' }
    : { exitCode: 0, stdout: JSON.stringify({ curta: 'sworn | contexto 5%', longa: 'l', cruzou: false }), stderr: '' } }))
  on('ui.status', ($, e) => {
    status.push(e.text)
    return { value: undefined }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  expect(status[status.length - 1]).toBe('sworn | contexto 5%')
  falha = true
  await $.turn.complete({ turnId: 't2', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  // Plano 082 (p5-17, mock D532): sem jargao, com o passo concreto; sem "sworn |" na frente, como a barra.
  expect(status[status.length - 1]).toBe(MEDIDOR_PARADO)
})

test('chamada que lanca no fim do turno (ex.: prazo estourado): o status tambem diz que o medidor nao respondeu', async ($, on) => {
  let lanca = false
  const status: (string | undefined)[] = []
  on('session.usage', () => ({ value: USO }))
  on('session.id', () => ({ value: 'sess-abc' }))
  on('process.run', () => {
    if (lanca) throw new Error('timeout')
    return { value: { exitCode: 0, stdout: JSON.stringify({ curta: 'sworn | contexto 5%', longa: 'l', cruzou: false }), stderr: '' } }
  })
  on('ui.status', ($, e) => {
    status.push(e.text)
    return { value: undefined }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  expect(status[status.length - 1]).toBe('sworn | contexto 5%')
  lanca = true
  await $.turn.complete({ turnId: 't2', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  expect(status[status.length - 1]).toBe(MEDIDOR_PARADO)
})

const MEDIDA = { context: USO.context, rateLimits: USO.rateLimits, changed: ['context'] } as any

function resposta(curta: string) {
  return { value: { exitCode: 0, stdout: JSON.stringify({ curta: curta, longa: 'l', cruzou: false }), stderr: '' } }
}

// D442/7 (M-1): a medida que chegava enquanto outra media era descartada (guarda `medindo`); o status ficava
// com o numero da medida anterior ate o proximo evento. Agora ela fica pendente e roda assim que a outra acaba.
test('D442/7: medida que chega durante outra nao se perde - roda logo depois', async ($, on) => {
  const relogio = mock.clock(on, { now: 1000 })
  const status: (string | undefined)[] = []
  let soltar: () => void = () => {}
  const segura = new Promise<void>(r => { soltar = r })
  let n = 0
  on('session.usage', () => ({ value: USO }))
  on('session.id', () => ({ value: 'sess-abc' }))
  on('process.run', async () => {
    n += 1
    if (n === 1) { await segura; return resposta('sworn | medida 1') }
    return resposta('sworn | medida 2')
  })
  on('ui.status', ($, e) => { status.push(e.text); return { value: undefined } })
  on('ui.invalidate', () => ({ value: undefined }))
  on('session.measure', () => ({ changed: [] }))
  const primeira = $.session.measure(MEDIDA)
  await relogio.settle()
  await $.session.measure(MEDIDA)
  soltar()
  await primeira
  await relogio.settle()
  expect(n).toBe(2)
  expect(status[status.length - 1]).toBe('sworn | medida 2')
})

// D442/7 (M-5): o prazo cobria so o process.run; se `$.session.usage()` nunca respondesse, a guarda ficava presa
// e a linha de status congelava no ultimo numero bom, sem sinal. Agora a medida presa alem do prazo e largada.
test('D442/7: leitura de uso que nunca responde nao congela o status - a medida seguinte assume', async ($, on) => {
  const relogio = mock.clock(on, { now: 1000 })
  const status: (string | undefined)[] = []
  let soltarPresa: () => void = () => {}
  const presa = new Promise<void>(r => { soltarPresa = r })
  let usos = 0
  let runs = 0
  on('session.usage', async () => {
    usos += 1
    if (usos === 1) await presa
    return { value: USO }
  })
  on('session.id', () => ({ value: 'sess-abc' }))
  on('process.run', () => {
    runs += 1
    return resposta(runs === 1 ? 'sworn | contexto 5%' : 'sworn | numero velho da medida presa')
  })
  on('ui.status', ($, e) => { status.push(e.text); return { value: undefined } })
  on('ui.invalidate', () => ({ value: undefined }))
  on('session.measure', () => ({ changed: [] }))
  void $.session.measure(MEDIDA).catch(() => {})
  await relogio.settle()
  await relogio.advance(60000)
  await $.session.measure(MEDIDA)
  // A7-25 (pedido 12): um verbo so (a medida demorou; a presa e largada) e o passo, que e nenhum
  // A7-59 e A7-61: "a leitura anterior do uso" no lugar de "a medida anterior" (termo interno)
  // s266 (R1 do A7-80): mais curta e com o "nada a fazer" de volta, que diz que o usuario nao precisa agir
  const atrasado = 'medidor atrasado: a leitura do uso demorou e outra já começou; nada a fazer.'
  expect(status).toContain(atrasado)
  expect(status[status.length - 1]).toBe('sworn | contexto 5%')
  // a presa responde tarde: o resultado dela e velho e nao volta para a tela
  soltarPresa()
  await relogio.settle()
  expect(status[status.length - 1]).toBe('sworn | contexto 5%')
})

// Pedido 32 (Tarefa 4 subitem 3): o botao do handoff vem na lista `botoes` do sessao.js, como os outros.
const HANDOFF = { nome: 'handoff', texto: 'troca de chat - gatilho contavel cruzou.', rotulo: 'gerar handoff', comando: '/sworn:handoff' }

test('faixa acima do prompt: nada sem gatilho; com gatilho, botao que poe /sworn:handoff no prompt e some depois de usado', async ($, on) => {
  let cruzou = false
  const preenchido: string[] = []
  on('session.usage', () => ({ value: USO }))
  on('session.id', () => ({ value: 'sess-abc' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify({ curta: 'c', longa: 'l', cruzou: cruzou,
    botoes: cruzou ? [HANDOFF] : [] }), stderr: '' } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['desenho do motor'] }))
  on('prompt.fill', ($, e) => {
    preenchido.push(e.text)
    return { isFilled: true }
  })

  const quieta = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await quieta.find({ key: 'sworn-handoff' })).toBeUndefined()
  await quieta.unmount()

  cruzou = true
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  const ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /troca de chat/ })).toBeDefined()
  await ui.press({ key: 'sworn-handoff' })
  await ui.unmount()
  expect(preenchido).toEqual(['/sworn:handoff'])
  // usado: some, mesmo com o gatilho ainda aceso
  const depois = await $.ui.mount({ ...BANDA, surface: 'desktop' })
  expect(await depois.find({ key: 'sworn-handoff' })).toBeUndefined()
  await depois.unmount()
})

// Pedido 32 (plano dos pedidos 30-32, Tarefa 4; D519, D522): a faixa na identidade - borda e o nome "sworn" no
// acento, o resto sem cor. O acento e a chave de tema `warning` no terminal e no Desktop, e a cor crua no VS Code,
// onde a chave nao pinta (sonda da s53).
test('faixa na identidade: borda e marca no acento por tela, um acento so', async ($, on) => {
  on('session.usage', () => ({ value: USO }))
  on('session.id', () => ({ value: 'sess-abc' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify({ curta: 'c', longa: 'l', cruzou: true,
    plano: 'plano d503 | 4 de 6 | proxima: Tarefa 6 init', botoes: [HANDOFF] }), stderr: '' } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['desenho do motor'] }))
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  for (const [surface, acento] of [['terminal', 'warning'], ['desktop', 'warning'], ['vscode', '#F59E0B']] as const) {
    const ui = await $.ui.mount({ ...BANDA, surface })
    const faixa = await ui.find({ key: 'sworn-faixa' })
    expect(faixa && faixa.props.borderColor).toBe(acento)
    expect(faixa && faixa.props.borderStyle).toBe('round')
    const textos = await ui.findAll({ type: 'Text' })
    const coloridos = textos.filter((t: any) => t.props.color !== undefined)
    expect(textos.map((t: any) => t.text + '=' + String(t.props.color))).toContain('sworn =' + acento)
    expect(coloridos.length).toBe(1)
    await ui.unmount()
  }
})

// Pedido 31 (plano dos pedidos 30-32, Tarefa 3; D520): o mod le do $.store o historico das janelas e o gasto real do
// mes, manda ao sessao.js e grava de volta o `guardar` que ele devolve. A conta mora no script; o mod so carrega.
test('medida: manda historico e gastoReal do $.store ao sessao.js e grava o `guardar` de volta', async ($, on) => {
  const chamadas: Chamada[] = []
  const memoria: Record<string, unknown> = { historico: { velha: { t: 1, medidas: 3, janelas: {} } }, gastoReal: { '2026-10': { velha: 2 } } }
  const gravados: string[] = []
  on('session.usage', () => ({ value: USO }))
  on('session.id', () => ({ value: 'sess-abc' }))
  on('store.get', ($: unknown, e: any) => ({ value: memoria[e.key] }))
  on('store.set', ($: unknown, e: any) => { memoria[e.key] = e.value; gravados.push(e.key); return { value: undefined } })
  on('process.run', ($: unknown, e: any) => {
    chamadas.push({ argv: e.argv, stdin: e.init && e.init.stdin })
    return { value: { exitCode: 0, stdout: JSON.stringify({ curta: 'c', longa: 'l', cruzou: false,
      guardar: { historico: { nova: { t: 2 } }, gastoReal: { '2026-10': { nova: 3 } } } }), stderr: '' } }
  })
  on('ui.status', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  const enviado = JSON.parse(String(chamadas[0].stdin))
  expect(enviado.historico).toEqual({ velha: { t: 1, medidas: 3, janelas: {} } })
  expect(enviado.gastoReal).toEqual({ '2026-10': { velha: 2 } })
  expect(memoria.historico).toEqual({ nova: { t: 2 } })
  expect(memoria.gastoReal).toEqual({ '2026-10': { nova: 3 } })
  expect(gravados.sort()).toEqual(['gastoReal', 'historico'])
})

test('medida: sem `guardar` na resposta, o $.store fica como estava', async ($, on) => {
  const gravados: string[] = []
  on('session.usage', () => ({ value: USO }))
  on('session.id', () => ({ value: 'sess-abc' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', ($: unknown, e: any) => { gravados.push(e.key); return { value: undefined } })
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify({ curta: 'c', longa: 'l', cruzou: false }), stderr: '' } }))
  on('ui.status', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  expect(gravados).toEqual([])
})

// Pedido 30 (plano dos pedidos 30-32, Tarefa 2): a sonda da s53 provou que o status desenha uma linha so (o "\n" vira
// espaco); a linha do plano vai na faixa, sempre visivel, em cima; a troca de chat entra embaixo dela.
test('faixa acima do prompt: a linha do plano aparece sem gatilho, e em cima da troca quando cruza', async ($, on) => {
  let cruzou = false
  on('session.usage', () => ({ value: USO }))
  on('session.id', () => ({ value: 'sess-abc' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify({ curta: 'c', longa: 'l', cruzou: cruzou,
    plano: 'plano d503 | 4 de 6 | proxima: Tarefa 6 init', botoes: cruzou ? [HANDOFF] : [] }), stderr: '' } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['desenho do motor'] }))

  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...BANDA, surface })
    expect(await ui.find({ type: 'Text', text: /plano d503 \| 4 de 6/ })).toBeDefined()
    expect(await ui.find({ key: 'sworn-handoff' })).toBeUndefined()
    await ui.unmount()
  }

  cruzou = true
  await $.turn.complete({ turnId: 't2', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  const ui = await $.ui.mount({ ...BANDA, surface: 'vscode' })
  const textos = (await ui.findAll({ type: 'Text' })).map((t: any) => String(t.text))
  const iPlano = textos.findIndex(t => /plano d503/.test(t))
  const iTroca = textos.findIndex(t => /troca de chat/.test(t))
  expect(iPlano).toBeGreaterThan(-1)
  expect(iTroca).toBeGreaterThan(iPlano)
  expect(await ui.find({ key: 'sworn-handoff' })).toBeDefined()
  await ui.unmount()
})

// Pedido 32 (plano dos pedidos 30-32, Tarefa 4 subitem 3): um botao por comando. O sessao.js decide quais valem
// (lib/botoes.js) e devolve na ordem de prioridade; o mod desenha o primeiro ainda nao usado, poe o comando no
// prompt e o esconde ate o sinal passar.
const BOTOES = [
  HANDOFF,
  { nome: 'revisar', texto: 'arquivo AAA com referencia mudou.', rotulo: 'revisar', comando: '/sworn:review src/a.js' },
  { nome: 'aprender', texto: 'parece uma correcao.', rotulo: 'aprender', comando: '/sworn:learn' },
  { nome: 'init', texto: 'projeto sem configuracao.', rotulo: 'configurar', comando: '/sworn:init' },
  { nome: 'auditar', texto: 'a auditoria avisou.', rotulo: 'auditar', comando: '/sworn:audit' },
  { nome: 'calibrar', texto: 'ha conversas para medir.', rotulo: 'calibrar', comando: '/sworn:calibrate' },
  { nome: 'paralelo', texto: 'o agente ofereceu paralelo.', rotulo: 'rodar em paralelo', comando: '/sworn:parallel' },
  { nome: 'padrao', texto: 'arquivo AAA sem o manual.', rotulo: 'carregar o padrao', comando: '/sworn:playbook' },
]

/** Motor falso da faixa: o sessao.js devolve `lista()`; guarda o que foi ao prompt e o stdin de cada medida. */
function faixaComBotoes(on: any, lista: () => unknown[], preenchido: string[], stdins: any[] = [], fillFalha = false) {
  const contagem = { invalidou: 0 }
  on('session.usage', () => ({ value: USO }))
  on('session.id', () => ({ value: 'sess-abc' }))
  on('process.run', ($: unknown, e: any) => {
    stdins.push(JSON.parse(String(e.init && e.init.stdin)))
    return { value: { exitCode: 0, stdout: JSON.stringify({ curta: 'c', longa: 'l', cruzou: false, botoes: lista() }), stderr: '' } }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => { contagem.invalidou++; return { value: undefined } })
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['desenho do motor'] }))
  on('prompt.fill', ($: unknown, e: any) => {
    if (fillFalha) throw new Error('prompt indisponivel')
    preenchido.push(e.text)
    return { isFilled: true }
  })
  return contagem
}

for (const b of BOTOES) {
  test(`botao ${b.nome}: desenha "${b.rotulo}", poe ${b.comando} no prompt e some depois de usado`, async ($, on) => {
    const preenchido: string[] = []
    const contagem = faixaComBotoes(on, () => [b], preenchido)
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
    expect(contagem.invalidou).toBe(1)
    const ui = await $.ui.mount({ ...BANDA, surface: 'vscode' })
    const botao = await ui.find({ key: 'sworn-' + b.nome })
    expect(botao && botao.props.label).toBe(b.rotulo)
    expect(await ui.find({ type: 'Text', text: b.texto + ' ' })).toBeDefined()
    await ui.press({ key: 'sworn-' + b.nome })
    await ui.unmount()
    expect(preenchido).toEqual([b.comando])
    expect(contagem.invalidou).toBe(2)
    const depois = await $.ui.mount({ ...BANDA, surface: 'vscode' })
    expect(await depois.find({ key: 'sworn-' + b.nome })).toBeUndefined()
    await depois.unmount()
  })
}

// Plano 082 (p5-25, mock D532 "o clique nao preencheu o prompt"): antes o catch do fill voltava calado. Agora a faixa
// diz o comando a digitar no lugar do botao; o botao nao conta como usado e volta no turno seguinte.
test('botoes: prompt que falha ao preencher - a faixa diz o comando a digitar, e o botao volta no turno seguinte', async ($, on) => {
  const preenchido: string[] = []
  const contagem = faixaComBotoes(on, () => [BOTOES[1]], preenchido, [], true)
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  const ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  await ui.press({ key: 'sworn-revisar' })
  await ui.unmount()
  expect(contagem.invalidou).toBe(2)
  const depois = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await depois.find({ key: 'sworn-revisar' })).toBeUndefined()
  // O kit 2.1.323 junta o desenho do motor de mentira (o `next` do teste) aos textos montados: fica de fora.
  const textos = (await depois.findAll({ type: 'Text' })).map((t: any) => String(t.text)).filter(t => t !== 'desenho do motor')
  // A7-26 (pedido 12): sem 1a pessoa e sem "prompt" solto
  expect(textos.join('')).toBe('sworn O botão não preencheu o campo de mensagem. Digite ' +
    '/sworn:review src/a.js e envie.')
  const comando = await depois.find({ type: 'Text', text: '/sworn:review src/a.js' })
  expect(comando && comando.props.bold).toBe(true)
  await depois.unmount()
  await $.turn.complete({ turnId: 't2', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  const outra = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await outra.find({ key: 'sworn-revisar' })).toBeDefined()
  expect(await outra.find({ type: 'Text', text: /não preencheu/ })).toBeUndefined()
  await outra.unmount()
})

// Plano 082, Tarefa 6 (p5-4): o botao da vez de antes e o que estava na tela; a poda dos usados vem depois dele. Antes,
// o usado que saiu da lista "voltava" no calculo de antes e a faixa redesenhava sem nada mudar.
test('botoes: o usado que sai da lista nao redesenha a faixa vazia de novo (p5-4)', async ($, on) => {
  const preenchido: string[] = []
  let lista: unknown[] = [BOTOES[1]]
  const contagem = faixaComBotoes(on, () => lista, preenchido)
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  const ui = await $.ui.mount({ ...BANDA, surface: 'vscode' })
  await ui.press({ key: 'sworn-revisar' })
  await ui.unmount()
  expect(contagem.invalidou).toBe(2)
  lista = []
  await $.turn.complete({ turnId: 't2', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  expect(contagem.invalidou).toBe(2)
})

// Plano 082, Tarefa 6 (p5-10): o mesmo botao com as chaves em outra ordem e o mesmo botao - nao redesenha.
test('botoes: o mesmo botao com as chaves em outra ordem nao redesenha a faixa (p5-10)', async ($, on) => {
  const preenchido: string[] = []
  const b = BOTOES[1]
  let lista: unknown[] = [b]
  const contagem = faixaComBotoes(on, () => lista, preenchido)
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  expect(contagem.invalidou).toBe(1)
  lista = [{ comando: b.comando, rotulo: b.rotulo, texto: b.texto, nome: b.nome }]
  await $.turn.complete({ turnId: 't2', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  expect(contagem.invalidou).toBe(1)
  lista = [Object.assign({}, b, { texto: 'outro texto.' })]
  await $.turn.complete({ turnId: 't3', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  expect(contagem.invalidou).toBe(2)
})

// Plano 082 (p5-8): botaoDaVez so olhava nome e comando; sem rotulo o botao saia sem nome e o texto "undefined ".
test('botoes: botao sem rotulo ou sem texto nao desenha; o seguinte toma o lugar', async ($, on) => {
  const preenchido: string[] = []
  faixaComBotoes(on, () => [{ nome: 'a', texto: 't', comando: '/sworn:init' }, { nome: 'b', texto: 3, rotulo: 'r',
    comando: '/sworn:init' }, { nome: 'c', texto: 't', rotulo: '', comando: '/sworn:init' }, BOTOES[2]], preenchido)
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  const ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  for (const k of ['a', 'b', 'c']) expect(await ui.find({ key: 'sworn-' + k })).toBeUndefined()
  expect(await ui.find({ key: 'sworn-aprender' })).toBeDefined()
  const textos = (await ui.findAll({ type: 'Text' })).map((t: any) => String(t.text))
  expect(textos.join('|')).not.toMatch(/undefined/)
  await ui.unmount()
})

// Plano 083 (p1-18): o resto do contrato do botaoDaVez - rotulo so com espacos, nome ou comando que nao e texto, e
// item nulo na lista ficam de fora, e o seguinte toma o lugar.
test('botoes: rotulo so com espacos, nome ou comando que nao e texto e item nulo nao desenham (p1-18)', async ($, on) => {
  const preenchido: string[] = []
  faixaComBotoes(on, () => [null, { nome: 'a', texto: 't', rotulo: '   ', comando: '/sworn:init' },
    // o comando em lista passaria na regex (String(['/x']) e '/x'): so o typeof o barra
    { nome: 5, texto: 't', rotulo: 'r', comando: '/sworn:init' }, { nome: 'c', texto: 't', rotulo: 'r', comando: ['/sworn:init'] },
    BOTOES[2]], preenchido)
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  const ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  for (const k of ['a', '5', 'c']) expect(await ui.find({ key: 'sworn-' + k })).toBeUndefined()
  expect(await ui.find({ key: 'sworn-aprender' })).toBeDefined()
  await ui.unmount()
})

// Plano 083 (p1-18): o mesmoBotao com um dos lados nulo - o botao que some da lista sem ser usado redesenha a faixa,
// e a lista vazia que segue vazia nao redesenha.
test('botoes: botao que some da lista sem uso redesenha; vazia seguida de vazia nao (p1-18)', async ($, on) => {
  const preenchido: string[] = []
  let lista: unknown[] = []
  const contagem = faixaComBotoes(on, () => lista, preenchido)
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  expect(contagem.invalidou).toBe(0)
  lista = [BOTOES[2]]
  await $.turn.complete({ turnId: 't2', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  expect(contagem.invalidou).toBe(1)
  lista = []
  await $.turn.complete({ turnId: 't3', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  expect(contagem.invalidou).toBe(2)
  const ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await ui.find({ key: 'sworn-faixa' })).toBeUndefined()
  await ui.unmount()
})

// Plano 083 (p1-18): o aviso do clique que falhou so sai no turno do agente principal; o de subagente nao o apaga.
test('botoes: o aviso do clique que falhou fica no turno de subagente e sai no do agente principal (p1-18)', async ($, on) => {
  const preenchido: string[] = []
  faixaComBotoes(on, () => [BOTOES[1]], preenchido, [], true)
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  const ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  await ui.press({ key: 'sworn-revisar' })
  await ui.unmount()
  await $.turn.complete({ turnId: 't2', answer: 'relatorio', durationMs: 10, isAborted: false, usage: null, agentId: 'ag1' })
  const sub = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await sub.find({ type: 'Text', text: /não preencheu/ })).toBeDefined()
  expect(await sub.find({ key: 'sworn-revisar' })).toBeUndefined()
  await sub.unmount()
  await $.turn.complete({ turnId: 't3', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  const principal = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await principal.find({ type: 'Text', text: /não preencheu/ })).toBeUndefined()
  expect(await principal.find({ key: 'sworn-revisar' })).toBeDefined()
  await principal.unmount()
})

// Plano 083 (sobra 4): o tool.call so olha. Com o .catch, o gancho que falha deixa a chamada seguir com o resultado
// de baixo, igual ao gancho que nao falha.
test('tool.call: a chamada segue com o resultado de baixo (o gancho so olha)', async ($, on) => {
  on('tool.call', () => ({ result: 'de baixo' }))
  const r: any = await $.tool.call({ tool: 'Skill', skill: 'sworn:playbook' })
  expect(r.result).toBe('de baixo')
  const outro: any = await $.tool.call({ tool: 'Read', file_path: '/x' } as any)
  expect(outro.result).toBe('de baixo')
})

// Plano 082 (p5-3): a linha do plano so era checada como string; so espacos desenhava a faixa vazia e a quebra de
// linha partia a faixa. Agora espaco em volta sai e espaco por dentro vira um so.
test('faixa: plano so com espacos nao desenha; quebra de linha vira espaco', async ($, on) => {
  let plano = ' \n\t '
  on('session.usage', () => ({ value: USO }))
  on('session.id', () => ({ value: 'sess-abc' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify({ curta: 'c', longa: 'l', cruzou: false,
    plano: plano, botoes: [] }), stderr: '' } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['desenho do motor'] }))
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  let ui = await $.ui.mount({ ...BANDA, surface: 'vscode' })
  expect(await ui.find({ key: 'sworn-faixa' })).toBeUndefined()
  await ui.unmount()
  plano = '  plano 082 · 2 de 7 tarefas\n· próxima: Tarefa 3  '
  await $.turn.complete({ turnId: 't2', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  ui = await $.ui.mount({ ...BANDA, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: 'plano 082 · 2 de 7 tarefas · próxima: Tarefa 3' })).toBeDefined()
  await ui.unmount()
})

test('botoes: so o de maior prioridade aparece; usado, o seguinte toma o lugar', async ($, on) => {
  const preenchido: string[] = []
  faixaComBotoes(on, () => [BOTOES[1], BOTOES[2]], preenchido)
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  const ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await ui.find({ key: 'sworn-revisar' })).toBeDefined()
  expect(await ui.find({ key: 'sworn-aprender' })).toBeUndefined()
  await ui.press({ key: 'sworn-revisar' })
  await ui.unmount()
  const depois = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await depois.find({ key: 'sworn-revisar' })).toBeUndefined()
  expect(await depois.find({ key: 'sworn-aprender' })).toBeDefined()
  await depois.unmount()
})

test('botoes: o usado volta quando o sinal passa e acende de novo', async ($, on) => {
  const preenchido: string[] = []
  let lista: unknown[] = [BOTOES[2]]
  faixaComBotoes(on, () => lista, preenchido)
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  let ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  await ui.press({ key: 'sworn-aprender' })
  await ui.unmount()
  await $.turn.complete({ turnId: 't2', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await ui.find({ key: 'sworn-aprender' })).toBeUndefined()
  await ui.unmount()
  lista = []
  await $.turn.complete({ turnId: 't3', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  lista = [BOTOES[2]]
  await $.turn.complete({ turnId: 't4', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await ui.find({ key: 'sworn-aprender' })).toBeDefined()
  await ui.unmount()
})

test('botoes: comando que nao e do sworn nao vira botao', async ($, on) => {
  const preenchido: string[] = []
  faixaComBotoes(on, () => [{ nome: 'x', texto: 't', rotulo: 'r', comando: 'rm -rf /' }, BOTOES[3]], preenchido)
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  const ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await ui.find({ key: 'sworn-x' })).toBeUndefined()
  expect(await ui.find({ key: 'sworn-init' })).toBeDefined()
  await ui.unmount()
})

// Plano 082, Tarefa 2 (mock D532, parte 1): os estados da faixa como o dono aprovou, com os textos que o plano.js e o
// botoes.js produzem (conferidos la por igualdade). O clique que falhou tem teste proprio acima; medidor parado e gasto
// somando sao da barra (MEDIDOR_PARADO aqui, "somando" no medidor.test.js).
// A7 (pedido 12): os textos de hoje do handoff e do padrao, copiados do scripts/lib/botoes.js. A7-73: o
// test/botoes.test.js os compara com o botoes.js (o do contexto que disparou e o do src/a.js).
const TEXTO_HANDOFF = 'A conversa chegou a um limite que o sworn conta (tamanho do contexto): ' +
  'gere o handoff (o texto que continua daqui); o trabalho segue nesta conversa.'
const TEXTO_PADRAO = 'O arquivo src/a.js está entre os que o projeto.json marca com o cuidado mais alto: carregue ' +
  'o manual antes de seguir. Para mudar a marca, edite "marchas" em .claude/sworn/projeto.json.'
const ESTADOS_DO_MOCK = [
  { nome: 'plano em curso, titulo longo cortado', plano: 'plano 082 · 2 de 7 tarefas · próxima: Tarefa 3 — barra do medidor em uma linha e o res...',
    botoes: [], linhas: 'sworn plano 082 · 2 de 7 tarefas · próxima: Tarefa 3 — barra do medidor em uma linha e o res...', rotulo: null },
  { nome: 'troca de chat urgente', plano: 'plano 082 · 2 de 7 tarefas · próxima: Tarefa 3',
    botoes: [{ nome: 'handoff', texto: TEXTO_HANDOFF, rotulo: 'gerar handoff', comando: '/sworn:handoff' }],
    linhas: 'sworn plano 082 · 2 de 7 tarefas · próxima: Tarefa 3|' + TEXTO_HANDOFF + ' gerar handoff',
    rotulo: 'gerar handoff' },
  { nome: 'arquivo AAA sem o manual', plano: '',
    botoes: [{ nome: 'padrao', texto: TEXTO_PADRAO, rotulo: 'carregar o manual', comando: '/sworn:playbook' }],
    linhas: 'sworn ' + TEXTO_PADRAO + ' carregar o manual', rotulo: 'carregar o manual' },
]

for (const estado of ESTADOS_DO_MOCK) {
  test('estado do mock 082: ' + estado.nome, async ($, on) => {
    on('session.usage', () => ({ value: USO }))
    on('session.id', () => ({ value: 'sess-abc' }))
    on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify({ curta: 'c', longa: 'l', cruzou: false,
      plano: estado.plano, botoes: estado.botoes }), stderr: '' } }))
    on('ui.status', () => ({ value: undefined }))
    on('ui.invalidate', () => ({ value: undefined }))
    on('turn.complete', () => ({ text: '' }))
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['desenho do motor'] }))
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
    const ui = await $.ui.mount({ ...BANDA, surface: 'vscode' })
    // uma linha da faixa por Box: o plano em cima, o botao embaixo (o "|" separa as duas)
    const linhas: string[] = []
    for (const k of ['sworn-linha-plano', 'sworn-botao']) {
      const box = await ui.find({ key: k })
      if (box) linhas.push(box.text)
    }
    expect(linhas.join('|')).toBe(estado.linhas)
    const botao = estado.botoes.length ? await ui.find({ key: 'sworn-' + estado.botoes[0].nome }) : undefined
    expect(botao ? botao.props.label : null).toBe(estado.rotulo)
    if (botao) expect(botao.props.variant).toBe('primary')
    await ui.unmount()
  })
}

test('medida: manda ao sessao.js a ultima resposta do agente e se o manual (padrao) foi carregado', async ($, on) => {
  const stdins: any[] = []
  faixaComBotoes(on, () => [], [], stdins)
  on('tool.call', () => ({ result: 'ok' }))
  await $.turn.complete({ turnId: 't1', answer: 'ofereco o /sworn:parallel', durationMs: 10, isAborted: false, usage: null })
  expect(stdins[stdins.length - 1].resposta).toBe('ofereco o /sworn:parallel')
  expect(stdins[stdins.length - 1].padrao).toBe(false)
  // turno de subagente nao troca a resposta do agente principal
  await $.turn.complete({ turnId: 't2', answer: 'relatorio do subagente', durationMs: 10, isAborted: false, usage: null, agentId: 'ag1' })
  expect(stdins[stdins.length - 1].resposta).toBe('ofereco o /sworn:parallel')
  // a skill carregada por subagente nao conta; a de outro nome tambem nao
  await $.tool.call({ tool: 'Skill', skill: 'sworn:playbook', agentId: 'ag1' })
  await $.tool.call({ tool: 'Skill', skill: 'sworn:review' })
  await $.turn.complete({ turnId: 't3', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  expect(stdins[stdins.length - 1].padrao).toBe(false)
  // p5-5 (plano 082): o campo e `e.skill`, ao lado do `tool` (tipos do motor 2.1.301, ToolCallEnvelope); sem ele, nada
  await $.tool.call({ tool: 'Skill' } as any)
  await $.tool.call({ tool: 'Skill', input: { skill: 'sworn:playbook' } } as any)
  await $.turn.complete({ turnId: 't3b', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  expect(stdins[stdins.length - 1].padrao).toBe(false)
  await $.tool.call({ tool: 'Skill', skill: 'sworn:playbook' })
  await $.turn.complete({ turnId: 't4', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  expect(stdins[stdins.length - 1].padrao).toBe(true)
  expect(stdins[stdins.length - 1].resposta).toBe('ok')
  // resposta longa vai so pelo fim (a oferta do paralelo fecha a resposta)
  await $.turn.complete({ turnId: 't5', answer: 'x'.repeat(3000) + ' /sworn:parallel', durationMs: 10, isAborted: false, usage: null })
  const ultima = String(stdins[stdins.length - 1].resposta)
  expect(ultima.length).toBe(2000)
  expect(ultima.endsWith(' /sworn:parallel')).toBe(true)
})

// V2 (D847): o sessao.js recebe o fim do ultimo turno do agente principal e o modelo; a linha do cache aparece so na
// janela de `avisoMs` antes de vencer, o relogio do mod (a cada 10 s) a passa e redesenha so quando ela muda, e ela
// some quando vence, com o turno do agente principal rodando, ou quando a medida do turno novo falha.
const MIN = 60000

// A linha da faixa que comeca com `inicio` (V2: o cache; V5: a revisao) e quantas marcas "sworn " a faixa tem.
async function lerFaixa($: any, inicio: RegExp) {
  const ui = await $.ui.mount({ ...BANDA, surface: 'vscode' })
  const t = await ui.find({ type: 'Text', text: inicio })
  const marcas = (await ui.findAll({ type: 'Text', text: 'sworn ' })).length
  await ui.unmount()
  return { texto: t ? String(t.text) : '', marcas }
}

// O motor de mentira da V2: por padrao o sessao.js devolve o cache 1 h depois do `ultimaVez` que o mod manda, com o
// plano dado; `fazCache` troca o cache devolvido e `falha.on` faz a medida falhar. O relogio do mod (session.start em
// 1000) confere a linha em 1000 + k x 10 s; o turno t1 termina em 31000 (T), e as contas abaixo saem de T: o cache
// vence em T + 60 min.
async function motorDoCache($: any, on: any, plano: string,
  fazCache?: (ultimaVez: number) => unknown, falha?: { on: boolean }) {
  const relogio = mock.clock(on, { now: 1000 })
  const enviados: any[] = []
  const contagem = { invalidou: 0 }
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }))
  on('session.usage', () => ({ value: USO }))
  on('session.id', () => ({ value: 'sess-abc' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('process.run', ($: unknown, e: any) => {
    const ent = JSON.parse(e.init.stdin)
    enviados.push(ent)
    if (falha && falha.on) return { value: { exitCode: 1, stdout: '', stderr: 'quebrou' } }
    const cache = typeof ent.ultimaVez !== 'number' ? null
      : fazCache ? fazCache(ent.ultimaVez) : { ate: ent.ultimaVez + 60 * MIN, avisoMs: 10 * MIN, frase: 'frase.' }
    return { value: { exitCode: 0, stdout: JSON.stringify({ curta: 'c', longa: 'l', cruzou: false, plano: plano,
      botoes: [], cache: cache }), stderr: '' } }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => { contagem.invalidou += 1; return { value: undefined } })
  on('turn.start', () => ({ turnId: 'x' }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['desenho do motor'] }))
  await $.session.start({ surface: 'vscode', isInteractive: true, cwd: '/work' })
  await relogio.advance(MIN / 2)
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  const linha = () => lerFaixa($, /^cache esfria/)
  return { relogio, enviados, contagem, linha }
}

test('V2: a linha do cache aparece nos ultimos 10 minutos, o relogio a passa e ela some quando vence', async ($, on) => {
  const { relogio, enviados, contagem, linha } = await motorDoCache($, on, 'plano X')
  expect(enviados[0].ultimaVez).toBe(31000)
  expect(enviados[0].modelo).toBe('claude-opus-5-5')
  expect((await linha()).texto).toBe('')
  // um minuto do relogio com a linha igual (vazia) nao redesenha
  const antes = contagem.invalidou
  await relogio.advance(MIN)
  expect(contagem.invalidou).toBe(antes)
  // T + 49,5 min: faltam 10,5 min, ainda fora da janela
  await relogio.advance(48 * MIN + MIN / 2)
  expect((await linha()).texto).toBe('')
  // T + 50,5 min: faltam 9,5, e o minuto arredonda para cima
  await relogio.advance(MIN)
  expect(await linha()).toEqual({ texto: 'cache esfria em 10 min; frase.', marcas: 1 })
  // o turno de subagente (o comeco e o fim) nao renova o cache do chat nem tira a linha
  await $.turn.start({ text: '', turnId: 's1', agentId: 'a1' })
  await $.turn.complete({ turnId: 's1', agentId: 'a1', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  expect(enviados[enviados.length - 1].ultimaVez).toBe(31000)
  expect((await linha()).texto).toBe('cache esfria em 10 min; frase.')
  // T + 59,5 min: falta meio minuto, "1 min"; aos 10 s do fim ainda "1 min"; 10 s depois de vencer, sumiu
  await relogio.advance(9 * MIN)
  expect((await linha()).texto).toBe('cache esfria em 1 min; frase.')
  await relogio.advance(20000)
  expect((await linha()).texto).toBe('cache esfria em 1 min; frase.')
  await relogio.advance(20000)
  expect((await linha()).texto).toBe('')
  // o turno novo do agente principal renova: T + 60 min + 10 s
  await $.turn.complete({ turnId: 't2', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  expect(enviados[enviados.length - 1].ultimaVez).toBe(31000 + 60 * MIN + 10000)
})

test('V2: sem plano, a faixa sai so com a linha do cache, e a marca vai nela', async ($, on) => {
  const { relogio, linha } = await motorDoCache($, on, '')
  expect((await linha()).marcas).toBe(0)
  // T + 50,5 min: faltam 9,5, "10 min"
  await relogio.advance(50 * MIN + MIN / 2)
  expect(await linha()).toEqual({ texto: 'cache esfria em 10 min; frase.', marcas: 1 })
})

test('V2: o turno do agente principal tira a linha; se a medida do turno novo falha, ela nao volta', async ($, on) => {
  const falha = { on: false }
  const { relogio, linha } = await motorDoCache($, on, 'plano X', undefined, falha)
  await relogio.advance(50 * MIN + MIN / 2)
  expect((await linha()).texto).toBe('cache esfria em 10 min; frase.')
  // o agente principal trabalha: as chamadas dele mantem o cache quente
  await $.turn.start({ text: 'oi', turnId: 't2' })
  expect((await linha()).texto).toBe('')
  await relogio.advance(MIN)
  expect((await linha()).texto).toBe('')
  // o turno acaba e a medida falha: o cache velho (do turno t1) nao volta a contar
  falha.on = true
  await $.turn.complete({ turnId: 't2', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  expect((await linha()).texto).toBe('')
  await relogio.advance(5 * MIN)
  expect((await linha()).texto).toBe('')
})

test('V2: frase do script com quebra de linha vira uma linha so', async ($, on) => {
  const fazCache = (u: number) => ({ ate: u + 60 * MIN, avisoMs: 10 * MIN, frase: 'regrava\n   tudo.' })
  const { relogio, linha } = await motorDoCache($, on, 'plano X', fazCache)
  await relogio.advance(50 * MIN + MIN / 2)
  expect((await linha()).texto).toBe('cache esfria em 10 min; regrava tudo.')
})

test('V2: frase so de espacos ou `ate` que nao e numero: a faixa fica sem a linha do cache', async ($, on) => {
  const casos: Array<(u: number) => unknown> = [
    (u: number) => ({ ate: u + 60 * MIN, avisoMs: 10 * MIN, frase: '  \n ' }),
    (u: number) => ({ ate: String(u + 60 * MIN), avisoMs: 10 * MIN, frase: 'frase.' }),
    (u: number) => ({ ate: u + 60 * MIN, avisoMs: 10 * MIN }),
    (u: number) => ({ ate: u + 60 * MIN, avisoMs: '600000', frase: 'frase.' })
  ]
  let atual = 0
  const fazCache = (u: number) => casos[atual](u)
  const { relogio, linha } = await motorDoCache($, on, 'plano X', fazCache)
  await relogio.advance(50 * MIN + MIN / 2)
  expect((await linha()).texto).toBe('')
  for (atual = 1; atual < casos.length; atual++) {
    await $.turn.complete({ turnId: 'tx', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
    await relogio.advance(50 * MIN + MIN / 2)
    expect((await linha()).texto).toBe('')
  }
})

// V5 (D847): o andamento da revisao cega. O ronda.js de mentira devolve "N de M" pela lista que recebe; a conta de
// verdade (rondas, custo, os parados) e provada em test/ronda-faixa.test.js. `falha.modo` faz o script falhar de um
// dos quatro jeitos: 'codigo' (sai 1), 'lanca' (o process.run lanca, como no prazo estourado), 'torto' (stdout fora
// de JSON, so na linha: o --texto devolve texto) e 'vazio' (sai 0 sem texto, como o ronda.js com a conta quebrada).
// Com `quebrado`, o relogio e este, parado em `quebrado.agora`, e com `quebrado.on` da hora que nao e numero (o
// gancho que lanca o motor pula, e cairia no relogio de verdade).
// O 'quebra' nao e falha: a linha vem com quebra e espacos, e a faixa a mostra numa linha so.
type FalhaDaRonda = { modo: '' | 'codigo' | 'lanca' | 'torto' | 'vazio' | 'quebra' }
async function motorDaRevisao($: any, on: any, plano: string, falha?: FalhaDaRonda,
  quebrado?: { on: boolean, agora: number }) {
  let relogio: any = null
  if (quebrado) {
    on('clock.now', () => ({ value: quebrado.on ? NaN : quebrado.agora }))
    on('clock.every', () => ({ value: undefined }))
  } else relogio = mock.clock(on, { now: 1000 })
  const enviados: any[] = []
  const comandos: string[] = []
  let agente = 0
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($: unknown, e: any) => { comandos.push(e.name); return { value: undefined } })
  on('session.usage', () => ({ value: USO }))
  on('session.id', () => ({ value: 'sess-abc' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('process.run', ($: unknown, e: any) => {
    if (!String(e.argv[1]).endsWith('/scripts/ronda.js')) {
      return { value: { exitCode: 0, stdout: JSON.stringify({ curta: 'c', longa: 'l', cruzou: false, plano: plano,
        botoes: [], cache: null }), stderr: '' } }
    }
    const ent = JSON.parse(e.init.stdin)
    enviados.push({ argv: e.argv, ent: ent })
    const modo = falha ? falha.modo : ''
    if (modo === 'lanca') throw new Error('prazo estourado')
    if (modo === 'codigo') return { value: { exitCode: 1, stdout: '', stderr: 'quebrou' } }
    if (modo === 'torto' && !e.argv.includes('--texto')) return { value: { exitCode: 0, stdout: 'nao e json', stderr: '' } }
    if (modo === 'vazio') return { value: { exitCode: 0, stdout: '\n', stderr: '' } }
    if (e.argv.includes('--texto')) return { value: { exitCode: 0, stdout: 'detalhe de ' + ent.inspetores.length + '\n', stderr: '' } }
    // como o ronda.js: o inspetor sem resposta ha 30 min nao conta como rodando
    const prontos = ent.inspetores.filter((i: any) => i.fim !== null).length
    const rodando = ent.inspetores.filter((i: any) => i.fim === null && ent.agora - i.inicio < 30 * MIN).length
    const l = !rodando ? '' : modo === 'quebra' ? '  revisão cega:\n   ' + prontos + ' de\t' + ent.inspetores.length + '\n'
      : 'revisão cega: ' + prontos + ' de ' + ent.inspetores.length
    return { value: { exitCode: 0, stdout: JSON.stringify({ linha: l }), stderr: '' } }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'ag-' + (++agente) }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['desenho do motor'] }))
  await $.session.start({ surface: 'vscode', isInteractive: true, cwd: '/work' })
  const disparar = (tipo: string, prompt: string) => $.agent.spawn({ tool_use_id: 'tu', prompt: prompt,
    description: 'd', subagentType: tipo, provider: { plugin: 'sworn', tier: 'user' }, parentModel: 'claude-opus-5-5' })
  const fim = (agentId: string, usage: unknown) => $.turn.complete({ turnId: 't-' + agentId, agentId: agentId,
    answer: '{}', durationMs: 10, isAborted: false, usage: usage })
  const linha = () => lerFaixa($, /^revisão cega/)
  return { relogio, enviados, comandos, disparar, fim, linha }
}

const BRIEFING = 'Read A and B. Verdicts folder: `C:\\w\\.claude\\sworn\\revisao\\scripts__a.js\\2\\vereditos`. Don\'t open it.'
const PARADO_REVISAO = 'Andamento da revisão parado: o sworn não leu a lista dos inspetores (pode faltar o Node.js, ou ' +
  'o sworn falhou ou demorou). Diga ao Claude "ache por que o andamento da revisão do sworn parou": ele procura a ' +
  'causa e o conserto. Depois rode /sworn-review de novo.'

test('V5: o inspetor disparado entra na faixa e o fim dele, com o usage e a hora, conta como pronto', async ($, on) => {
  const { relogio, enviados, comandos, disparar, fim, linha } = await motorDaRevisao($, on, '')
  expect(comandos).toContain('sworn-review')
  expect((await linha()).texto).toBe('')
  const r = await disparar('sworn:inspector', BRIEFING)
  expect(r).toEqual({ model: 'claude-sonnet-5-5', agentId: 'ag-1' })
  await disparar('sworn:inspector', BRIEFING)
  const primeira = enviados[0].ent.inspetores[0]
  expect(primeira.vereditos).toBe('revisao\\scripts__a.js\\2\\vereditos')
  expect(primeira.modelo).toBe('claude-sonnet-5-5')
  expect(primeira.inicio).toBe(1000)
  expect(primeira.fim).toBe(null)
  expect(await linha()).toEqual({ texto: 'revisão cega: 0 de 2', marcas: 1 })
  const usage = { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-sonnet-5-5' }
  await relogio.advance(5000)
  await fim('ag-1', usage)
  const ultimo = enviados[enviados.length - 1].ent.inspetores
  expect(ultimo[0].fim).toBe(6000)
  expect(ultimo[0].usage).toEqual(usage)
  expect(ultimo[1].fim).toBe(null)
  expect((await linha()).texto).toBe('revisão cega: 1 de 2')
  // o fim de novo do mesmo agente nao conta outra vez
  const quantos = enviados.length
  await fim('ag-1', usage)
  expect(enviados.length).toBe(quantos)
  await fim('ag-2', null)
  expect((await linha()).texto).toBe('')
})

test('V5: so o inspetor entra, nas duas grafias do nome; o caminho comeca em revisao, com espaco antes', async ($, on) => {
  const { enviados, disparar, linha } = await motorDaRevisao($, on, '')
  await disparar('Explore', BRIEFING)
  await disparar('general-purpose', BRIEFING)
  expect(enviados.length).toBe(0)
  // a grafia com '-' tambem e o inspetor (INSPETOR em hooks/mods.tsx aceita as duas de proposito)
  await disparar('sworn-inspector', 'sem caminho nenhum')
  expect(enviados[0].ent.inspetores[0].vereditos).toBe('')
  expect((await linha()).texto).toBe('revisão cega: 0 de 1')
  await disparar('sworn:inspector', 'Verdicts folder: D:\\Meus Projetos\\proj x\\.claude\\sworn\\revisao\\docs__a.md\\1\\vereditos')
  expect(enviados[1].ent.inspetores[1].vereditos).toBe('revisao\\docs__a.md\\1\\vereditos')
  // o caminho depois do teto do briefing nao e procurado
  await disparar('sworn:inspector', 'x'.repeat(20000) + ' revisao/b.js/1/vereditos')
  expect(enviados[2].ent.inspetores[2].vereditos).toBe('')
})

test('V5: com a linha do plano, a da revisao vem embaixo e a marca fica so na 1a', async ($, on) => {
  const { disparar, linha } = await motorDaRevisao($, on, 'plano X')
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  await disparar('sworn:inspector', BRIEFING)
  expect(await linha()).toEqual({ texto: 'revisão cega: 0 de 1', marcas: 1 })
})

test('V5: a linha que o script manda com quebra e espacos aparece numa linha so', async ($, on) => {
  const { disparar, linha } = await motorDaRevisao($, on, '', { modo: 'quebra' })
  await disparar('sworn:inspector', BRIEFING)
  expect((await linha()).texto).toBe('revisão cega: 0 de 1')
})

test('V5: /sworn-review responde o texto do script, tambem sem inspetor nenhum', async ($, on) => {
  const { enviados, disparar } = await motorDaRevisao($, on, '')
  const vazio = await $.command.run({ command: 'sworn-review', args: '' })
  expect(vazio.text).toBe('detalhe de 0')
  expect(enviados[0].ent.inspetores).toEqual([])
  await disparar('sworn:inspector', BRIEFING)
  const r = await $.command.run({ command: 'sworn-review', args: '' })
  expect(r.text).toBe('detalhe de 1')
  expect(enviados[enviados.length - 1].argv).toContain('--texto')
})

test('V5: o script que falha, de qualquer jeito, tira a linha, deixa o inspetor partir e o comando diz o passo', async ($, on) => {
  const falha: FalhaDaRonda = { modo: '' }
  const { disparar, linha } = await motorDaRevisao($, on, '', falha)
  await disparar('sworn:inspector', BRIEFING)
  expect((await linha()).texto).toBe('revisão cega: 0 de 1')
  for (const modo of ['codigo', 'lanca', 'torto', 'vazio'] as const) {
    falha.modo = ''
    await disparar('sworn:inspector', BRIEFING)
    expect((await linha()).texto).not.toBe('')
    falha.modo = modo
    const r = await disparar('sworn:inspector', BRIEFING)
    expect(r.agentId).toMatch(/^ag-\d+$/)
    expect((await linha()).texto).toBe('')
    const c = await $.command.run({ command: 'sworn-review', args: '' })
    // o 'torto' so quebra a linha: o comando segue com o texto do script
    if (modo === 'torto') expect(c.text).toMatch(/^detalhe de \d+$/)
    else expect(c.text).toBe(PARADO_REVISAO)
  }
})

test('V5: a conta que falhou volta no fim do turno do agente principal, com inspetor rodando', async ($, on) => {
  const falha: FalhaDaRonda = { modo: 'codigo' }
  const { disparar, linha } = await motorDaRevisao($, on, '', falha)
  await disparar('sworn:inspector', BRIEFING)
  expect((await linha()).texto).toBe('')
  falha.modo = ''
  await $.turn.complete({ turnId: 'tm', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  expect((await linha()).texto).toBe('revisão cega: 0 de 1')
})

test('V5: o relogio refaz a linha a cada minuto: o inspetor parado ha 30 min sai da faixa sem turno nenhum', async ($, on) => {
  const { relogio, enviados, disparar, linha } = await motorDaRevisao($, on, '')
  await disparar('sworn:inspector', BRIEFING)
  const depoisDoDisparo = enviados.length
  // dentro do minuto o relogio nao chama o script
  await relogio.advance(MIN / 2)
  expect(enviados.length).toBe(depoisDoDisparo)
  await relogio.advance(MIN)
  expect(enviados.length).toBe(depoisDoDisparo + 1)
  expect((await linha()).texto).toBe('revisão cega: 0 de 1')
  await relogio.advance(30 * MIN)
  expect((await linha()).texto).toBe('')
  // sem a linha na tela e sem inspetor rodando, nem o relogio nem o fim do agente principal chamam o script
  const parado = enviados.length
  await relogio.advance(5 * MIN)
  await $.turn.complete({ turnId: 'tn', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  expect(enviados.length).toBe(parado)
})

test('V5: com o relogio falhando, o inspetor entra com a ultima hora que ele deu', async ($, on) => {
  const quebrado = { on: false, agora: 5000 }
  const { enviados, disparar, fim } = await motorDaRevisao($, on, '', undefined, quebrado)
  await disparar('sworn:inspector', BRIEFING)
  const hora = enviados[0].ent.inspetores[0].inicio
  expect(hora).toBe(5000)
  quebrado.on = true
  await disparar('sworn:inspector', BRIEFING)
  expect(enviados[enviados.length - 1].ent.inspetores[1].inicio).toBe(hora)
  await fim('ag-1', null)
  expect(enviados[enviados.length - 1].ent.inspetores[0].fim).toBe(hora)
})

test('V5: no teto da lista sai o mais antigo que ja terminou, nunca o que ainda roda', async ($, on) => {
  const { enviados, disparar, fim } = await motorDaRevisao($, on, '')
  await disparar('sworn:inspector', BRIEFING)
  for (let n = 2; n <= 401; n++) {
    await disparar('sworn:inspector', BRIEFING)
    await fim('ag-' + n, null)
  }
  const lista = enviados[enviados.length - 1].ent.inspetores
  expect(lista.length).toBe(400)
  expect(lista[0].id).toBe('ag-1')
  expect(lista[0].fim).toBe(null)
  expect(lista[1].id).toBe('ag-3')
})

// V6 (D847): o replay das edicoes. O replay.js de mentira anota cada chamada (o argv e a entrada) e, com --texto,
// responde "replay de N" (N = quantas copias ja vieram); a copia, o diff e o texto de verdade sao provados em
// test/replay.test.js. `abaixo.modo` diz o que a edicao responde: 'ok', 'recusa' ({ deny }) ou 'erro' (isError).
// 'lanca' (o motor de baixo lanca). `falha.modo` faz o script falhar: 'codigo' (sai 1), 'lanca' (o process.run lanca)
// ou 'vazio' (sai 0 sem texto).
type ModoDaEdicao = { modo: 'ok' | 'recusa' | 'erro' | 'lanca' }
type FalhaDoReplay = { modo: '' | 'codigo' | 'lanca' | 'vazio' }
async function motorDoReplay($: any, on: any, abaixo: ModoDaEdicao, falha: FalhaDoReplay) {
  mock.clock(on, { now: 1000 })
  const enviados: any[] = []
  const comandos: string[] = []
  const juntas = { agora: 0, max: 0 }
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($: unknown, e: any) => { comandos.push(e.name); return { value: undefined } })
  on('session.usage', () => ({ value: USO }))
  on('session.id', () => ({ value: 'sess-abc' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('process.run', async ($: unknown, e: any) => {
    if (!String(e.argv[1]).endsWith('/scripts/replay.js')) {
      return { value: { exitCode: 0, stdout: JSON.stringify({ curta: 'c', longa: 'l', cruzou: false, plano: '',
        botoes: [], cache: null }), stderr: '' } }
    }
    enviados.push({ argv: e.argv.slice(2), ent: JSON.parse(e.init.stdin) })
    // quantas copias rodam juntas: o script de mentira cede a vez algumas vezes antes de responder
    juntas.agora++
    juntas.max = Math.max(juntas.max, juntas.agora)
    for (let i = 0; i < 20; i++) await Promise.resolve()
    juntas.agora--
    if (falha.modo === 'lanca') throw new Error('prazo estourado')
    if (falha.modo === 'codigo') return { value: { exitCode: 1, stdout: 'replay pela metade', stderr: 'quebrou' } }
    if (falha.modo === 'vazio') return { value: { exitCode: 0, stdout: '\n', stderr: '' } }
    const guardadas = enviados.filter(x => x.argv[0] === '--guardar').length
    return { value: { exitCode: 0, stdout: e.argv.includes('--texto') ? 'replay de ' + guardadas + '\n' : '', stderr: '' } }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('turn.start', ($: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => {
    if (abaixo.modo === 'lanca') throw new Error('o motor caiu')
    return abaixo.modo === 'recusa' ? { deny: 'o dono recusou' }
      : abaixo.modo === 'erro' ? { result: 'falhou', isError: true } : { result: 'editado' }
  })
  await $.session.start({ surface: 'vscode', isInteractive: true, cwd: '/work' })
  const copias = () => enviados.filter(x => x.argv[0] === '--guardar').map(x => x.argv[1] + ' ' + x.ent.turno + ' ' + x.ent.caminho)
  return { enviados, comandos, copias, juntas }
}

const PARADO_REPLAY = 'Comparação das edições parada: o sworn não leu as cópias guardadas (pode faltar o Node.js, ou o ' +
  'sworn falhou ou demorou). Diga ao Claude "ache por que o /sworn-replay parou": ele procura a causa e o ' +
  'conserto. Depois rode /sworn-replay de novo.'
const AVISO_COPIA = 'Aviso: uma cópia do último turno com edição falhou; pode faltar arquivo ou linha abaixo. Diga ao ' +
  'Claude "ache por que o /sworn-replay parou": ele procura a causa e o conserto.'

test('V6: cada ferramenta de edicao copia o arquivo antes e depois, no turno do agente principal', async ($, on) => {
  const { enviados, comandos, copias } = await motorDoReplay($, on, { modo: 'ok' }, { modo: '' })
  expect(comandos).toContain('sworn-replay')
  await $.turn.start({ text: 'faz', turnId: 'T1' })
  const r: any = await $.tool.call({ tool: 'Edit', file_path: '/work/a.txt', old_string: 'a', new_string: 'b' } as any)
  expect(r.result).toBe('editado')
  expect(enviados[0]).toEqual({ argv: ['--guardar', 'antes'], ent: { sessao: 'sess-abc', turno: 'T1', caminho: '/work/a.txt', agora: 1000 } })
  expect(enviados[1].argv).toEqual(['--guardar', 'depois'])
  await $.tool.call({ tool: 'Write', file_path: '/work/b.md', content: 'x' } as any)
  await $.tool.call({ tool: 'MultiEdit', file_path: '/work/c.ts', edits: [] } as any)
  await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/work/d.ipynb', new_source: 'y' } as any)
  // o subagente que comeca nao muda o turno; a edicao dele cai no do agente principal
  await $.turn.start({ text: 'sub', turnId: 'T-sub', agentId: 'ag-1' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/e.txt', old_string: 'a', new_string: 'b', agentId: 'ag-1' } as any)
  await $.turn.start({ text: 'outro', turnId: 'T2' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/a.txt', old_string: 'b', new_string: 'c' } as any)
  expect(copias()).toEqual([
    'antes T1 /work/a.txt', 'depois T1 /work/a.txt', 'antes T1 /work/b.md', 'depois T1 /work/b.md',
    'antes T1 /work/c.ts', 'depois T1 /work/c.ts', 'antes T1 /work/d.ipynb', 'depois T1 /work/d.ipynb',
    'antes T1 /work/e.txt', 'depois T1 /work/e.txt', 'antes T2 /work/a.txt', 'depois T2 /work/a.txt'])
})

test('V6: antes do 1o turno, o turno desta carga do mod; sem caminho ou outra ferramenta, nada se copia', async ($, on) => {
  const { copias } = await motorDoReplay($, on, { modo: 'ok' }, { modo: '' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/a.txt', old_string: 'a', new_string: 'b' } as any)
  expect(copias()[0]).toMatch(/^antes carga-[a-z0-9]+ \/work\/a\.txt$/)
  await $.tool.call({ tool: 'Read', file_path: '/work/a.txt' } as any)
  await $.tool.call({ tool: 'mcp__fs__Edit_file', file_path: '/work/a.txt' } as any)
  await $.tool.call({ tool: 'Edit', old_string: 'a', new_string: 'b' } as any)
  await $.tool.call({ tool: 'Write', file_path: 7 } as any)
  await $.tool.call({ tool: 'Write', file_path: '', content: 'x' } as any)
  expect(copias().length).toBe(2)
})

test('V6: a edicao recusada, com erro ou que lanca descarta o antes; o resultado de baixo volta igual', async ($, on) => {
  const abaixo: ModoDaEdicao = { modo: 'recusa' }
  const { copias } = await motorDoReplay($, on, abaixo, { modo: '' })
  await $.turn.start({ text: 'faz', turnId: 'T1' })
  const negada: any = await $.tool.call({ tool: 'Edit', file_path: '/work/a.txt', old_string: 'a', new_string: 'b' } as any)
  expect(negada.deny).toBe('o dono recusou')
  abaixo.modo = 'erro'
  const errada: any = await $.tool.call({ tool: 'Write', file_path: '/work/b.txt', content: 'x' } as any)
  expect(errada.isError).toBe(true)
  expect(errada.result).toBe('falhou')
  // o de baixo que lanca (o motor pula o gancho que lanca e responde sem ninguem: o next(e) lanca): o erro sobe, e o
  // antes sai do mesmo jeito
  abaixo.modo = 'lanca'
  let caiu = ''
  try { await $.tool.call({ tool: 'Edit', file_path: '/work/c.txt', old_string: 'a', new_string: 'b' } as any) } catch (err: any) { caiu = String(err && err.message) }
  expect(caiu).toBe('no implementation for tool.call')
  expect(copias()).toEqual(['antes T1 /work/a.txt', 'descartar T1 /work/a.txt', 'antes T1 /work/b.txt',
    'descartar T1 /work/b.txt', 'antes T1 /work/c.txt', 'descartar T1 /work/c.txt'])
})

test('V6: o script que falha, de qualquer jeito, nao para a edicao e o /sworn-replay diz o passo', async ($, on) => {
  const falha: FalhaDoReplay = { modo: '' }
  await motorDoReplay($, on, { modo: 'ok' }, falha)
  await $.turn.start({ text: 'faz', turnId: 'T1' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/a.txt', old_string: 'a', new_string: 'b' } as any)
  expect((await $.command.run({ command: 'sworn-replay', args: '' })).text).toBe('replay de 2')
  for (const modo of ['codigo', 'lanca', 'vazio'] as const) {
    falha.modo = modo
    const r: any = await $.tool.call({ tool: 'Edit', file_path: '/work/a.txt', old_string: 'b', new_string: 'c' } as any)
    expect(r.result).toBe('editado')
    expect((await $.command.run({ command: 'sworn-replay', args: '' })).text).toBe(PARADO_REPLAY)
  }
  // o script voltou: o texto sai, com o aviso da copia que falhou neste turno ('vazio' nao e falha da copia)
  falha.modo = ''
  expect((await $.command.run({ command: 'sworn-replay', args: '' })).text).toBe(AVISO_COPIA + '\n\nreplay de 8')
  // o turno novo que copia sem falha tira o aviso
  await $.turn.start({ text: 'outro', turnId: 'T2' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/a.txt', old_string: 'c', new_string: 'd' } as any)
  expect((await $.command.run({ command: 'sworn-replay', args: '' })).text).toBe('replay de 10')
})

test('V6: a copia que falha liga o aviso so do turno dela; o turno com id vazio ganha um novo', async ($, on) => {
  const falha: FalhaDoReplay = { modo: '' }
  const { copias } = await motorDoReplay($, on, { modo: 'ok' }, falha)
  await $.turn.start({ text: 'faz', turnId: 'T1' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/a.txt', old_string: 'a', new_string: 'b' } as any)
  await $.turn.start({ text: 'sem id', turnId: '' })
  falha.modo = 'codigo'
  await $.tool.call({ tool: 'Edit', file_path: '/work/a.txt', old_string: 'b', new_string: 'c' } as any)
  falha.modo = ''
  expect((await $.command.run({ command: 'sworn-replay', args: '' })).text).toBe(AVISO_COPIA + '\n\nreplay de 4')
  expect(copias()[2]).toMatch(/^antes turno-[a-z0-9]+ \/work\/a\.txt$/)
  await $.turn.start({ text: 'sem id de novo', turnId: '' })
  // o turno vazio seguinte e outro turno: as copias da falha anterior nao entram nele, e o aviso sai
  await $.tool.call({ tool: 'Edit', file_path: '/work/a.txt', old_string: 'c', new_string: 'd' } as any)
  const turnos = copias().map(c => c.split(' ')[1])
  expect(turnos[4]).toMatch(/^turno-/)
  expect(turnos[4]).not.toBe(turnos[2])
  expect((await $.command.run({ command: 'sworn-replay', args: '' })).text).toBe('replay de 6')
})

test('V6: edicoes ao mesmo tempo copiam uma de cada vez, e a copia que falha nao trava a fila', async ($, on) => {
  const falha: FalhaDoReplay = { modo: 'lanca' }
  const { copias, juntas } = await motorDoReplay($, on, { modo: 'ok' }, falha)
  await $.turn.start({ text: 'faz', turnId: 'T1' })
  await Promise.all(['a', 'b', 'c'].map(x =>
    $.tool.call({ tool: 'Edit', file_path: '/work/' + x + '.txt', old_string: 'a', new_string: 'b', agentId: 'ag-' + x } as any)))
  expect(juntas.max).toBe(1)
  expect(copias().length).toBe(6)
  falha.modo = ''
  await $.tool.call({ tool: 'Edit', file_path: '/work/d.txt', old_string: 'a', new_string: 'b' } as any)
  expect(copias().slice(-2)).toEqual(['antes T1 /work/d.txt', 'depois T1 /work/d.txt'])
})

test('V6: /sworn-replay manda a sessao e a hora ao script, tambem sem edicao nenhuma', async ($, on) => {
  const { enviados } = await motorDoReplay($, on, { modo: 'ok' }, { modo: '' })
  expect((await $.command.run({ command: 'sworn-replay', args: '' })).text).toBe('replay de 0')
  expect(enviados[0]).toEqual({ argv: ['--texto'], ent: { sessao: 'sess-abc', agora: 1000 } })
})
