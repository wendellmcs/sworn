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
// estourado), que caem todas no mesmo ramo do mods.tsx; este teste simula so a saida 1. Ela diz as causas possiveis e
// um passo que serve a qualquer uma (pedir ao Claude), sem mandar quem nao programa ao terminal.
// P2 da R1 (s241): sem o caminho do script nem os passos tecnicos; o Node.js fica so como causa (e o que se instala).
const PARADO_SESSAO = 'Medidor parado: a medida falhou (pode faltar o Node.js, ou o script do sworn ' +
  'deu erro ou demorou demais). Peça ao Claude para achar por que o medidor do sworn parou; depois rode ' +
  '/sworn-session de novo.'
const PARADO_PLANO = 'Painel do plano parado: a leitura do plano falhou (pode faltar o Node.js, ou o script do sworn ' +
  'deu erro ou demorou demais). Peça ao Claude para achar por que o painel do plano do sworn parou; depois ' +
  'rode /sworn-plan de novo.'

test('script que falha: o comando responde o motivo, nao lanca', async ($, on) => {
  on('session.usage', () => ({ value: USO }))
  on('session.id', () => ({ value: 'sess-abc' }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'node nao achado' } }))
  const r = await $.command.run({ command: 'sworn-session', args: '' })
  // Sem "sworn:" na frente: o motor ja escreve o nome do plugin antes da resposta.
  expect(r.text).toBe(PARADO_SESSAO)
  const p = await $.command.run({ command: 'sworn-plan', args: '' })
  expect(p.text).toBe(PARADO_PLANO)
})

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
const MEDIDOR_PARADO = 'medidor parado: a medida falhou e roda de novo na próxima resposta; se seguir assim, ' +
  'rode /sworn-session.'

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
  expect(status).toContain('medidor atrasado: a medida anterior demorou demais; uma nova já começou, nada a fazer.')
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
  const textos = (await depois.findAll({ type: 'Text' })).map((t: any) => String(t.text))
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
// A7 (pedido 12): os textos de hoje do handoff e do padrao, copiados do scripts/lib/botoes.js.
const TEXTO_HANDOFF = 'A conversa chegou a um limite que o sworn conta (tamanho, bloqueios ou trabalho feito): ' +
  'gere o handoff (o texto que continua daqui) e cole num chat novo.'
const TEXTO_PADRAO = 'Um arquivo mudado nesta sessão pede o cuidado mais alto do projeto: carregue o manual ' +
  'antes de seguir.'
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
