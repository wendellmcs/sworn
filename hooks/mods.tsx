import type { Register } from 'claude-code'

// Bloco M (D435) - os mods do sworn: M1 medidor da sessao, M2 painel do plano, V2 (D847) o cronometro do cache, V5
// (D847) o andamento da revisao cega, V6 (D847) o replay das edicoes do turno.
// Cola fina: a conta e o texto moram em scripts/sessao.js, scripts/plano.js, scripts/ronda.js e scripts/replay.js
// (fonte unica, testados pela suite node --test). O mod junta o que o motor mede, chama o script e mostra a resposta.
// D148: nada abre rede - $.session.usage() sem breakdown e local; o resto e node na maquina.
// Terminal, Desktop e chat do VS Code (sonda da s53: o VS Code desenha a faixa e o status): linha de status a cada
// medida (uma linha so - o "\n" vira espaco) e faixa acima do prompt com a linha do plano (pedido 30) e, embaixo
// dela, um botao por vez: o de maior prioridade que o sessao.js devolve em `botoes` (pedido 32; o do handoff quando a
// troca de chat cruzou). Os quatro comandos (/sworn-session, /sworn-plan, /sworn-review e /sworn-replay) respondem em
// texto em qualquer tela.
// Desenho: .context/plans/2026-10-11-sworn-bloco-m-desenho.md.

// Pedido 32 (D519, D522): o acento do sworn na faixa - a chave de tema no terminal e no Desktop, a cor crua do
// banner no VS Code (la a chave nao pinta). Copia de scripts/lib/identidade.js, conferida por test/identidade.test.js.
const ACENTO_CRU = '#F59E0B'
const ACENTO_TEMA = 'warning'

const MAX_AMOSTRAS = 20
const PRAZO_MS = 10000
// D442/7 (M-5): medida em curso ha mais que isto esta presa (o PRAZO_MS so cobre o process.run; a leitura de
// uso nao tem prazo). A seguinte nao espera mais por ela.
const PRAZO_PRESA_MS = 3 * PRAZO_MS
// V2 (D847): a linha do cache conta em minutos; o relogio a confere a cada 10 s, para ela sumir no maximo 10 s depois
// de o cache vencer (com o relogio de 1 minuto, "1 min" ficaria na tela ate um minuto depois de vencido).
const MINUTO_MS = 60000
const RELOGIO_MS = 10000

// Pedido 32: so comando do sworn vira botao (o texto vem do script; o mod nao poe outra coisa no prompt).
const COMANDO_DO_SWORN = /^\/sworn:[a-z]+( [^\n]*)?$/
// A ultima resposta vai ao script so pelo fim: o gatilho do paralelo e a oferta, que fecha a resposta.
const MAX_RESPOSTA = 2000

// V5 (D847): o inspetor da revisao cega (o nome do agente do sworn no Claude Code) e o caminho dos vereditos no
// briefing, de onde o ronda.js tira o arquivo e a ronda. O nome do agente vale com ':' (o do Claude Code) ou '-' (a
// mesma grafia sem o separador do plugin). O caminho comeca em "revisao" (o que vem antes nao entra na conta) e
// aceita espaco no nome do arquivo; o trecho tem teto, para a busca nunca travar num briefing longo sem espaco. A
// lista guarda os ultimos MAX_INSPETORES (a entrada do script nao cresce sem fim numa sessao longa).
const INSPETOR = /^sworn[:-]inspector$/
const CAMINHO_VEREDITOS = /revisao[\\/][^`'"\r\n]{1,300}?[\\/]vereditos/
const MAX_BRIEFING = 20000
const MAX_INSPETORES = 400
// Copia de PARADO_MS em scripts/lib/ronda-faixa.js: o inspetor sem fim ha mais que isto nao conta como rodando.
const PARADO_MS = 30 * 60 * 1000
// V6: as ferramentas de edicao do Claude, cujo arquivo o replay copia antes e depois (o campo, conferido nos tipos do
// motor 2.1.323: file_path; o NotebookEdit, notebook_path).
const EDITORES = /^(Edit|Write|MultiEdit|NotebookEdit)$/

type Botao = { nome: string; texto: string; rotulo: string; comando: string }
type Inspetor = { id: string; vereditos: string; modelo: string; inicio: number; fim: number | null; usage: unknown }
type Cache = { ate: number; avisoMs: number; frase: string }
type Medida = { curta: string; longa: string; cruzou: boolean; plano?: string; botoes?: Botao[]; cache?: Cache | null; guardar?: { historico?: unknown; gastoReal?: unknown } }
type Amostra = { tokens?: number; cincoH?: number }

// Variaveis do modulo: a recarga do mod zera a previsao, que volta com 2 turnos, e os botoes usados e o padrao
// carregado (limite conhecido: depois de recarregar, o botao do padrao pode voltar numa sessao que ja o carregou).
const amostras: Amostra[] = []
let linhaDoPlano = ''
let botoes: Botao[] = []
const usados = new Set<string>()
// O botao cujo clique nao preencheu o prompt: a faixa diz o comando a digitar ate o turno seguinte, para a pessoa nao
// ficar sem o passo quando o motor recusa o preenchimento.
let falhou: Botao | null = null
let ultimaResposta = ''
// V2: o fim do ultimo turno do agente principal (o cache conta dele), o que o sessao.js devolveu e a linha na tela.
let ultimaVez: number | null = null
let cache: Cache | null = null
let linhaDoCache = ''
// V2: com o turno do agente principal rodando, as chamadas dele mantem o cache quente; a linha so vale parado.
let emTurno = false
// V2: o relogio liga uma vez por vida do mod (a recarga zera isto e o motor cancela o relogio velho).
let relogioLigado = false
// V5: os inspetores desta vida do mod (a recarga zera: o /sworn-review conta desde que o sworn carregou) e a linha
// da revisao na tela. `rondaGeracao` descarta a resposta velha quando duas contas se cruzam; `revisaoEm`, a hora da
// ultima conta (o relogio refaz a linha na tela a cada minuto); `ultimoAgora`, a ultima hora que o relogio deu (o
// inspetor disparado com o relogio falhando entra com ela).
const inspetores: Inspetor[] = []
let linhaDaRevisao = ''
let rondaGeracao = 0
let revisaoEm = -Infinity
let ultimoAgora: number | null = null
// V6: o turno do agente principal que roda agora (o turnId do turn.start; as edicoes dos subagentes caem nele). Antes
// do 1o turno desta vida do mod, um id proprio desta carga (a recarga no meio do turno nao junta com outra carga).
let turnoReplay = 'carga-' + Math.random().toString(36).slice(2)
let sessaoReplay = ''
let filaReplay: Promise<void> = Promise.resolve()
let turnoDaCopia = ''
let copiaFalhou = false
// V6: a 1a linha do /sworn-replay quando uma copia do ultimo turno com edicao falhou.
const AVISO_COPIA = 'Aviso: uma cópia do último turno com edição falhou; pode faltar arquivo ou linha abaixo. Diga ao ' +
  'Claude "ache por que o /sworn-replay parou": ele procura a causa e o conserto.'
let padraoCarregado = false
let medindo = false
let medindoDesde = 0
let pendente = false
let geracao = 0

async function rodar($: any, script: string, extra: string[], stdin?: string) {
  const argv = ['node', $.plugin.root + '/scripts/' + script, ...extra]
  return $.process.run(argv, { stdin: stdin, timeoutMs: PRAZO_MS })
}

async function medir($: any): Promise<Medida | null> {
  const uso = await $.session.usage()
  const sessao = await $.session.id()
  // Pedido 31 (D520): o historico das janelas e o gasto real do mes vivem no $.store (conta inteira, entre sessoes);
  // o sessao.js faz a conta e devolve em `guardar` o que gravar de volta. Store que falha: segue sem ele.
  let historico: unknown = undefined
  let gastoReal: unknown = undefined
  try { historico = await $.store.get('historico') } catch (err) {}
  try { gastoReal = await $.store.get('gastoReal') } catch (err) {}
  // V2: o modelo vai ao preco da regravacao; sem ele, a frase do cache sai sem o custo.
  let modelo: unknown = undefined
  try { modelo = await $.session.model() } catch (err) {}
  const r = await rodar($, 'sessao.js', [], JSON.stringify({ uso: uso, amostras: amostras, sessao: sessao,
    historico: historico, gastoReal: gastoReal, resposta: ultimaResposta, padrao: padraoCarregado,
    ultimaVez: ultimaVez, modelo: modelo }))
  if (!r || r.exitCode !== 0) return null
  let m: Medida | null = null
  try {
    const lido = JSON.parse(r.stdout)
    m = lido && typeof lido.curta === 'string' ? lido : null
  } catch (e) {
    return null
  }
  if (m && m.guardar) {
    try { await $.store.set('historico', m.guardar.historico) } catch (err) {}
    try { await $.store.set('gastoReal', m.guardar.gastoReal) } catch (err) {}
  }
  return m
}

/** Pedido 32: o botao a desenhar - o primeiro da lista (ordem de prioridade do script) ainda nao usado. */
function botaoDaVez(): Botao | null {
  for (const b of botoes) {
    // Sem texto ou rotulo de verdade o botao sairia sem nome e com "undefined " na frente: fica de fora.
    if (b && typeof b.nome === 'string' && !usados.has(b.nome) && typeof b.comando === 'string' &&
      COMANDO_DO_SWORN.test(b.comando) && typeof b.texto === 'string' && typeof b.rotulo === 'string' &&
      b.rotulo.trim() !== '') return b
  }
  return null
}

// O mesmo botao campo a campo (o que a faixa desenha), sem depender da ordem das chaves: o script pode devolver o mesmo
// botao com as chaves em outra ordem, e isso nao pode redesenhar a faixa.
function mesmoBotao(a: Botao | null, b: Botao | null): boolean {
  if (!a || !b) return a === b
  return a.nome === b.nome && a.texto === b.texto && a.rotulo === b.rotulo && a.comando === b.comando
}

// V2: copia de linha() em scripts/lib/cache-faixa.js; test/cache-faixa.test.js roda o corpo desta funcao contra a de
// la. O corpo fica em JavaScript puro (sem anotacao de tipo) para o teste poder roda-lo.
function linhaDoCacheEm(c: Cache | null, t: number | null): string {
  if (!c || t === null || !Number.isFinite(c.ate) || !Number.isFinite(c.avisoMs) || typeof c.frase !== 'string' ||
    !Number.isFinite(t)) return ''
  const frase = c.frase.replace(/\s+/g, ' ').trim()
  if (!frase) return ''
  const resta = c.ate - t
  if (!(resta > 0) || resta > c.avisoMs) return ''
  return 'cache esfria em ' + Math.ceil(resta / MINUTO_MS) + ' min; ' + frase
}

// V2: a linha que vale agora: nenhuma com o turno do agente principal rodando, nem sem o relogio (sem ele nada
// apagaria a linha no vencimento, e a faixa ficaria com uma contagem velha).
async function linhaDoCacheAgora($: any): Promise<string> {
  return emTurno || !relogioLigado ? '' : linhaDoCacheEm(cache, await agora($))
}

// V2: redesenha a faixa so quando a linha do cache muda (a cada minuto dentro da janela de `avisoMs`, e quando some).
async function passarORelogio($: any) {
  const l = await linhaDoCacheAgora($)
  if (l !== linhaDoCache) {
    linhaDoCache = l
    await $.ui.invalidate('ui.render')
  }
}

// V5: o ronda.js refaz a linha da revisao com a lista toda; a faixa redesenha so quando ela muda. Script que falha:
// a linha sai (nunca fica um andamento velho na tela).
async function passarARevisao($: any) {
  const minha = ++rondaGeracao
  let l = ''
  try {
    const t = await agora($)
    if (t !== null) revisaoEm = t
    const r = await rodar($, 'ronda.js', [], entradaDaRonda(t))
    if (r && r.exitCode === 0) {
      const lido = JSON.parse(r.stdout)
      if (lido && typeof lido.linha === 'string') l = umaLinha(lido.linha)
    }
  } catch (err) {}
  if (minha !== rondaGeracao) return
  if (l !== linhaDaRevisao) {
    linhaDaRevisao = l
    try { await $.ui.invalidate('ui.render') } catch (err) {}
  }
}

// V5: a entrada do ronda.js, a mesma para a linha da faixa e para o /sworn-review.
function entradaDaRonda(t: number | null): string {
  return JSON.stringify({ inspetores: inspetores, agora: t })
}

// V5: algum inspetor sem fim que ainda conta como rodando (a linha da revisao tem o que mostrar ou refazer).
function inspetorRodando(t: number | null): boolean {
  return t !== null && inspetores.some(i => i.fim === null && t - i.inicio < PARADO_MS)
}

// O texto do script numa linha so (a faixa nao quebra linha).
function umaLinha(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

// V6: o id da sessao, lido uma vez (a pasta do replay e por sessao); sem ele, '' (o replay.js usa "sem-sessao").
async function sessaoDoReplay($: any): Promise<string> {
  if (!sessaoReplay) {
    try { const id = await $.session.id(); if (id) sessaoReplay = String(id) } catch (err) {}
  }
  return sessaoReplay
}

// V6: copia o arquivo de uma edicao (fase 'antes' ou 'depois') para a pasta temporaria do sworn. Em fila: duas
// edicoes ao mesmo tempo (subagentes em paralelo) leriam e gravariam o mesmo indice.json, e uma apagaria o que a outra
// gravou; na fila, cada copia comeca depois de a anterior acabar (a que falha nao trava as seguintes). A copia que
// falha (o script saiu com erro, demorou ou nem rodou) marca o turno dela: o /sworn-replay avisa que pode faltar algo.
function guardarReplay($: any, fase: string, sessao: string, turno: string, caminho: string): Promise<void> {
  const vez = filaReplay.then(async () => {
    if (turno !== turnoDaCopia) { turnoDaCopia = turno; copiaFalhou = false }
    let ok = false
    try {
      const r: any = await rodar($, 'replay.js', ['--guardar', fase], JSON.stringify({ sessao: sessao, turno: turno,
        caminho: caminho, agora: await agora($) }))
      ok = !!r && r.exitCode === 0
    } catch (err) {}
    if (!ok) copiaFalhou = true
  })
  filaReplay = vez.catch(() => {})
  return vez
}

async function agora($: any): Promise<number | null> {
  try {
    const n = await $.clock.now()
    if (typeof n === 'number' && isFinite(n)) {
      ultimoAgora = n
      return n
    }
    return null
  } catch (err) {
    return null
  }
}

// Atualiza a linha de status e a faixa. Uma medida por vez: o session.measure dispara a cada resposta.
// D442/7 (M-1): a que chega durante outra fica pendente e roda logo depois (antes era descartada, e o status
// ficava com o numero da anterior). (M-5): a que esta presa alem do PRAZO_PRESA_MS e largada; o resultado
// dela, se um dia chegar, e velho e nao toca o status (a `geracao` mudou).
async function atualizar($: any) {
  const t = await agora($)
  if (medindo) {
    if (t === null || t - medindoDesde <= PRAZO_PRESA_MS) {
      pendente = true
      return
    }
    // A7-25 (pedido 12): um verbo so (a presa demorou e e largada; o prazo vale para a medida inteira) e o passo,
    // que e nenhum: a medida nova comeca logo abaixo. A7-59 e A7-61: "a leitura do uso", palavra de quem le o
    // status, no lugar de "a medida". A7-80: curta, para caber na linha de status; s266 (R1): com o "nada a fazer".
    await $.ui.status('medidor atrasado: a leitura do uso demorou e outra já começou; nada a fazer.')
  }
  medindo = true
  medindoDesde = t === null ? 0 : t
  const minha = ++geracao
  try {
    do {
      pendente = false
      let m: Medida | null = null
      try { m = await medir($) } catch (err) {}
      if (minha !== geracao) return
      // Script que falhou (saida diferente de 0, JSON torto, ou a chamada lancou - prazo estourado): o status diz isso
      // em vez de seguir com o numero velho. A faixa fica como estava; a proxima medida boa a acerta. O texto leva
      // acento (o status desenha acento inteiro: mock aprovado na D532). A7-22 (pedido 12): a causa varia (Node
      // ausente, saida diferente de 0, JSON torto, prazo), entao o status nao culpa o Node: diz que a medida roda de
      // novo e, se seguir, o comando, que traz as causas possiveis e o passo. A7-62: o status diz o que o comando
      // mostra, curto para caber na linha.
      if (!m) {
        await $.ui.status('medidor parado: a leitura do uso falhou e volta na próxima resposta; ' +
          'se seguir, /sworn-session mostra a causa.')
        continue
      }
      await $.ui.status(m.curta)
      // So espacos nao desenha a faixa (sairia uma caixa vazia); quebra de linha e espaco repetido viram um espaco, senao
      // a quebra partiria a linha do plano em duas.
      const plano = typeof m.plano === 'string' ? umaLinha(m.plano) : ''
      const novos = Array.isArray(m.botoes) ? m.botoes : []
      // O de antes e o que esta na tela, entao vem antes da poda dos usados: depois dela, o usado que saiu da lista
      // "voltaria" no calculo e a faixa redesenharia sem nada mudar.
      const antes = botaoDaVez()
      // O usado volta a valer quando o sinal dele passa (o nome some da lista): se acender de novo, aparece.
      const nomes = novos.map(b => b && b.nome)
      for (const nome of Array.from(usados)) if (nomes.indexOf(nome) === -1) usados.delete(nome)
      botoes = novos
      const depois = botaoDaVez()
      // V2: o cache novo vale ja; a linha dele entra na mesma conta do redesenho.
      cache = m.cache && typeof m.cache === 'object' ? m.cache : null
      const doCache = await linhaDoCacheAgora($)
      if (plano !== linhaDoPlano || !mesmoBotao(antes, depois) || doCache !== linhaDoCache) {
        linhaDoPlano = plano
        linhaDoCache = doCache
        await $.ui.invalidate('ui.render')
      }
    } while (pendente)
  } finally {
    if (minha === geracao) medindo = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    // A doc manda: register que lanca (nome tomado) pula o resto do gancho - cada um no seu try.
    // A descricao no menu, sem jargao, fica em ASCII: a sonda que provou o acento na faixa (D532) nao o provou no menu.
    try {
      await $.command.register({ name: 'sworn-session', description: 'sworn: uso da conversa e dos limites de 5 horas e da semana, gasto e quando trocar de chat' })
    } catch (err) {}
    try {
      await $.command.register({ name: 'sworn-plan', description: 'sworn: painel do plano (feitas, a proxima, o que falta, sessoes gastas e estimativa)' })
    } catch (err) {}
    try {
      await $.command.register({ name: 'sworn-review', description: 'sworn: andamento e custo da revisao cega desta sessao, por arquivo e ronda' })
    } catch (err) {}
    try {
      await $.command.register({ name: 'sworn-replay', description: 'sworn: o que o ultimo turno com edicao mudou em cada arquivo, linhas de antes e de depois' })
    } catch (err) {}
    // V2 (D847): o relogio da linha do cache; vive ate o mod recarregar (o motor cancela os timers dele). Um so,
    // mesmo que o session.start volte sem recarga.
    if (!relogioLigado) {
      try {
        $.clock.every(RELOGIO_MS, async () => {
          try { await passarORelogio($) } catch (err) {}
          // V5: com a linha da revisao na tela, o relogio a refaz a cada minuto: o inspetor que parou sem
          // responder sai dela mesmo com a sessao parada.
          try {
            const t = await agora($)
            if (linhaDaRevisao && t !== null && t - revisaoEm >= MINUTO_MS) await passarARevisao($)
          } catch (err) {}
        })
        relogioLigado = true
      } catch (err) {}
    }
    return r
  })

  // V2: o turno do agente principal comecou; a linha do cache sai ate ele terminar.
  on('turn.start', async ($, e: any, next) => {
    try {
      if (!e.agentId) {
        // V6: o turno novo do agente principal; o replay guarda as edicoes dele (e dos subagentes que ele disparar).
        // Sem id do motor, um novo daqui: o turno novo nunca herda as copias do anterior.
        turnoReplay = typeof e.turnId === 'string' && e.turnId ? e.turnId : 'turno-' + Math.random().toString(36).slice(2)
        emTurno = true
        await passarORelogio($)
      }
    } catch (err) {}
    return next(e)
  }).catch(($, e, next) => next(e))

  // V5: o inspetor que o motor disparou entra na lista, com o modelo que o motor resolveu e o id do agente (o mesmo do
  // turn.complete dele). So olha: o next(e) resolve com o inspetor ja partindo, e o gancho que falha nao o segura; a
  // conta da linha atrasa a volta do disparo ao agente principal no maximo o prazo do script. Com o relogio falhando,
  // o inspetor entra com a ultima hora que ele deu; sem hora nenhuma ainda, fica fora (sem inicio, nada o contaria).
  on('agent.spawn', async ($, e: any, next) => {
    const r: any = await next(e)
    try {
      if (INSPETOR.test(String(e.subagentType)) && r && typeof r.agentId === 'string' && r.agentId) {
        const t = (await agora($)) ?? ultimoAgora
        if (t !== null) {
          const achado = CAMINHO_VEREDITOS.exec(String(e.prompt || '').slice(0, MAX_BRIEFING))
          inspetores.push({ id: r.agentId, vereditos: achado ? achado[0] : '', modelo: String(r.model || ''),
            inicio: t, fim: null, usage: null })
          // Passou do teto: sai o mais antigo que ja terminou (o que roda ainda espera o fim dele).
          if (inspetores.length > MAX_INSPETORES) {
            const k = inspetores.findIndex(i => i.fim !== null)
            inspetores.splice(k === -1 ? 0 : k, 1)
          }
          await passarARevisao($)
        }
      }
    } catch (err) {}
    return r
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    try { await atualizar($) } catch (err) {}
    return r
  })

  // Pedido 32: o botao do padrao some quando a skill do manual (sworn:playbook, ou a do projeto com "padrao" no
  // nome) e carregada pelo agente principal. So olha; a chamada segue igual. O `.catch` diz isso ao motor: se o gancho
  // falhar, a chamada segue (next(e) repete o que ja rodou, sem rodar duas vezes) - quem so olha nunca recusa.
  // V6, no mesmo gancho (o motor aceita um tool.call so sem matcher): a edicao das ferramentas do Claude (do agente
  // principal ou de um subagente) copia o arquivo antes de rodar e depois, se rodou sem erro nem recusa. A copia que
  // falha nao para a edicao. Cada copia custa um node, ate o prazo do script, mais a espera da fila: com subagentes
  // editando ao mesmo tempo, a edicao espera as copias que entraram antes dela. A de antes roda antes da decisao de
  // permissao (o motor nao separa as duas): na edicao recusada, com erro ou que lanca, o 'descartar' apaga essa copia
  // logo em seguida (a que ja tinha o depois de outra edicao do turno fica).
  on('tool.call', async ($, e: any, next) => {
    try {
      // O campo, conferido nos tipos do motor (2.1.301, ToolCallEnvelope): os argumentos da ferramenta vem ao lado do
      // `tool`, `e.skill`; nao ha `e.input`. Sem texto, nada (String(undefined) nao entra).
      if (!e.agentId && e.tool === 'Skill' && typeof e.skill === 'string' && /padrao|^(sworn:)?playbook$/i.test(e.skill)) padraoCarregado = true
    } catch (err) {}
    const caminho = !EDITORES.test(String(e.tool)) ? ''
      : typeof e.file_path === 'string' ? e.file_path : typeof e.notebook_path === 'string' ? e.notebook_path : ''
    if (!caminho) return next(e)
    // O turno e a sessao, lidos uma vez: o antes e o depois vao para a mesma pasta e o mesmo turno.
    const turno = turnoReplay
    let sessao = ''
    try { sessao = await sessaoDoReplay($) } catch (err) {}
    try { await guardarReplay($, 'antes', sessao, turno, caminho) } catch (err) {}
    let r: any
    try {
      r = await next(e)
    } catch (err) {
      try { await guardarReplay($, 'descartar', sessao, turno, caminho) } catch (err2) {}
      throw err
    }
    try {
      const rodou = r && !r.deny && !r.isError
      await guardarReplay($, rodou ? 'depois' : 'descartar', sessao, turno, caminho)
    } catch (err) {}
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    try {
      // Pedido 32: a resposta do agente principal vai ao sessao.js (o gatilho do paralelo); a de subagente, nao.
      if (!e.agentId) ultimaResposta = String(e.answer || '').slice(-MAX_RESPOSTA)
      // V2: so o turno do agente principal renova o cache do chat; o de subagente tem cache proprio. O cache velho
      // (contado do turno anterior) cai ja: se a medida a seguir falhar, a faixa fica sem a linha, nunca com uma
      // contagem errada.
      if (!e.agentId) {
        ultimaVez = await agora($)
        emTurno = false
        cache = null
        await passarORelogio($)
      }
      // O aviso do clique que falhou dura ate o turno seguinte do agente principal; o botao volta, se o sinal seguir.
      if (!e.agentId && falhou) { falhou = null; try { await $.ui.invalidate('ui.render') } catch (err) {} }
    } catch (err) {}
    // V5: o fim de um inspetor da lista (com o que ele gastou) refaz a linha da revisao; o fim do agente principal
    // tambem, com ela na tela ou com inspetor rodando (a conta que falhou antes volta aqui): o inspetor que parou sem
    // responder sai da conta de quem roda (30 min, no ronda.js).
    try {
      const insp = e.agentId ? inspetores.find(i => i.id === e.agentId && i.fim === null) : undefined
      if (insp) {
        const t = (await agora($)) ?? ultimoAgora
        insp.fim = t === null ? insp.inicio : t
        insp.usage = (e as any).usage || null
        await passarARevisao($)
      } else if (!e.agentId && (linhaDaRevisao || inspetorRodando((await agora($)) ?? ultimoAgora))) {
        await passarARevisao($)
      }
    } catch (err) {}
    try {
      const uso = await $.session.usage()
      const cinco = (uso.rateLimits || []).find((j: any) => j && j.kind === 'five_hour')
      amostras.push({ tokens: uso.context && uso.context.tokens, cincoH: cinco && cinco.percentUsed })
      if (amostras.length > MAX_AMOSTRAS) amostras.shift()
      await atualizar($)
    } catch (err) {}
    return r
  })

  on('command.run', { command: 'sworn-session' }, async $ => {
    let m: Medida | null = null
    try { m = await medir($) } catch (err) {}
    // Sem "sworn:" na frente: o motor ja escreve o nome do plugin antes da resposta. Com acento (D532: a resposta do
    // comando desenha acento inteiro). A7-22 (pedido 12): as causas possiveis e um passo que serve a qualquer uma
    // para quem nao programa (pedir ao Claude), no lugar do "node -v num terminal"; sem caminho de script (o Claude o
    // acha), e o Node.js so como causa possivel, que e o que a pessoa instala. A7-60 e A7-62: mais curta, sem
    // "medida" nem "script do sworn", com a frase pronta para o Claude e o que ele traz.
    return { text: m ? m.longa : 'Medidor parado: o sworn não leu os números de uso (pode faltar o Node.js, ' +
      'ou o sworn falhou ou demorou). Diga ao Claude "ache por que o medidor do sworn parou": ele procura a ' +
      'causa e o conserto. Depois rode /sworn-session de novo.' }
  })

  on('command.run', { command: 'sworn-plan' }, async $ => {
    try {
      // D476: sem plano-ativo.json o plano vem da frente vinculada a esta sessao; o script acha o vinculo pelo id.
      // Sem id de verdade, nada de --sessao (String(undefined) seria 'undefined'): o script cai no id do ambiente.
      let sessao = ''
      try { const id = await $.session.id(); if (id) sessao = String(id) } catch (err) {}
      const r = await rodar($, 'plano.js', sessao ? ['--texto', '--sessao', sessao] : ['--texto'])
      if (r && r.exitCode === 0 && r.stdout) return { text: String(r.stdout).replace(/\s+$/, '') }
    } catch (err) {}
    // A7-22: o mesmo passo do medidor, com o script e o comando do painel (A7-60 e A7-62 tambem).
    return { text: 'Painel do plano parado: o sworn não leu o plano (pode faltar o Node.js, ou o sworn falhou ' +
      'ou demorou). Diga ao Claude "ache por que o painel do plano do sworn parou": ele procura a causa e o ' +
      'conserto. Depois rode /sworn-plan de novo.' }
  })

  // V5 (D847): o detalhe da revisao cega desta sessao, por arquivo e ronda, com o custo.
  on('command.run', { command: 'sworn-review' }, async $ => {
    try {
      const r = await rodar($, 'ronda.js', ['--texto'], entradaDaRonda(await agora($)))
      // O ronda.js com a conta quebrada sai 0 com o texto vazio: vale como parado.
      const texto = r && r.exitCode === 0 ? String(r.stdout || '').replace(/\s+$/, '') : ''
      if (texto) return { text: texto }
    } catch (err) {}
    return { text: 'Andamento da revisão parado: o sworn não leu a lista dos inspetores (pode faltar o Node.js, ou ' +
      'o sworn falhou ou demorou). Diga ao Claude "ache por que o andamento da revisão do sworn parou": ele procura ' +
      'a causa e o conserto. Depois rode /sworn-review de novo.' }
  })

  on('command.run', { command: 'sworn-replay' }, async $ => {
    try {
      const r = await rodar($, 'replay.js', ['--texto'], JSON.stringify({ sessao: await sessaoDoReplay($),
        agora: await agora($) }))
      const texto = r && r.exitCode === 0 ? String(r.stdout || '').replace(/\s+$/, '') : ''
      if (texto) return { text: copiaFalhou ? AVISO_COPIA + '\n\n' + texto : texto }
    } catch (err) {}
    return { text: 'Comparação das edições parada: o sworn não leu as cópias guardadas (pode faltar o Node.js, ou o ' +
      'sworn falhou ou demorou). Diga ao Claude "ache por que o /sworn-replay parou": ele procura a causa e o ' +
      'conserto. Depois rode /sworn-replay de novo.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const f = falhou
    const b = f ? null : botaoDaVez()
    if ((!b && !f && !linhaDoPlano && !linhaDoCache && !linhaDaRevisao) || e.props.hasSurvey) return next(e)
    // A marca "sworn" vai so na 1a linha da faixa.
    const antesDaRevisao = !!(linhaDoPlano || linhaDoCache)
    const antesDoBotao = antesDaRevisao || !!linhaDaRevisao
    const { Box, Button, Text } = $.ui.resolve(e)
    // Pedido 32: um acento so - a borda e o nome "sworn" na 1a linha; o resto com o desenho do motor.
    const acento = e.surface === 'vscode' ? ACENTO_CRU : ACENTO_TEMA
    const marca = <Text key="sworn-marca" color={acento} bold>sworn </Text>
    return (
      <Box key="sworn-faixa" flexDirection="column" borderStyle="round" borderColor={acento} paddingX={1}>
        {linhaDoPlano ? (
          <Box key="sworn-linha-plano">
            {marca}
            <Text key="sworn-plan">{linhaDoPlano}</Text>
          </Box>
        ) : null}
        {/* V2 (D847): o cache que esfria, so na janela de `avisoMs` antes de vencer; a marca so na 1a linha da faixa. */}
        {linhaDoCache ? (
          <Box key="sworn-linha-cache">
            {linhaDoPlano ? null : marca}
            <Text key="sworn-cache">{linhaDoCache}</Text>
          </Box>
        ) : null}
        {/* V5 (D847): o andamento da revisao cega, so enquanto um inspetor roda. */}
        {linhaDaRevisao ? (
          <Box key="sworn-linha-revisao">
            {antesDaRevisao ? null : marca}
            <Text key="sworn-revisao">{linhaDaRevisao}</Text>
          </Box>
        ) : null}
        {f ? (
          <Box key="sworn-falhou">
            {antesDoBotao ? null : marca}
            {/* A7-26 (pedido 12): sem 1a pessoa e sem "prompt" solto; o campo pelo nome que a pessoa ve. */}
            <Text>{'O botão não preencheu o campo de mensagem. Digite '}</Text>
            <Text key="sworn-falhou-comando" bold>{f.comando}</Text>
            <Text>{' e envie.'}</Text>
          </Box>
        ) : null}
        {b ? (
          <Box key="sworn-botao">
            {antesDoBotao ? null : marca}
            <Text>{b.texto + ' '}</Text>
            {/* Todo botao `primary`: a sonda da D532 viu o `secondary` sair azul igual no VS Code. */}
            <Button
              key={'sworn-' + b.nome}
              label={b.rotulo}
              variant="primary"
              onPress={async () => {
                // So conta como usado depois de preencher. Prompt que falha: a faixa diz o comando a digitar.
                try {
                  await $.prompt.fill({ text: b.comando, mode: 'replace' })
                  usados.add(b.nome)
                } catch (err) { falhou = b }
                try { await $.ui.invalidate('ui.render') } catch (err) {}
              }}
            />
          </Box>
        ) : null}
      </Box>
    )
  })
}
