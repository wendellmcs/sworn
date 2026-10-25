export const meta = {
  name: 'parallel',
  description: 'Runs independent tasks in parallel, with an agent cap, a cheap model and isolation for those that edit',
  whenToUse: 'Three or more tasks that do not depend on each other, after the user has accepted the cost',
  phases: [{ title: 'Tasks', detail: 'one agent per task, up to the cap' }],
}

// args: lista de tarefas, ou { tarefas: [...], teto: N }. Cada tarefa e um texto ou
// { tarefa: 'texto', edita: true|false, modelo: 'haiku'|'sonnet'|'opus', esforco: 'low'|'medium'|'high' }.
// Freio de custo: teto de agentes por disparo (padrao 8, maximo 16), modelo mais barato que resolve
// (haiku quando so le, sonnet quando edita), quem edita roda isolado numa copia do repositorio (worktree).
// O resultado de cada agente volta como ALEGACAO: quem chamou confere o critico na fonte.
// Este arquivo chega com fim de linha LF (.gitattributes): com CR o VS Code recusa o script antes da janela.

const TETO_PADRAO = 8
const TETO_MAXIMO = 16
const MODELOS = ['haiku', 'sonnet', 'opus']
const ESFORCOS = ['low', 'medium', 'high']
// Chave com nome errado ("edit", "model") seria ignorada calada e a tarefa rodaria como leitura, sem copia isolada.
const CHAVES = ['tarefa', 'edita', 'modelo', 'esforco']
const USO = 'parallel: pass args as a list of tasks, for example ' +
  '[{"tarefa": "task text", "edita": false}] or ["task 1", "task 2"]; ' +
  'or {"tarefas": [...], "teto": 8}.'

const lista = Array.isArray(args) ? args : (args && Array.isArray(args.tarefas) ? args.tarefas : null)
if (!lista || !lista.length) throw new Error(USO)

let teto = TETO_PADRAO
if (args && !Array.isArray(args) && args.teto !== undefined) {
  if (!Number.isInteger(args.teto) || args.teto < 1) throw new Error('parallel: teto must be an integer from 1 to ' + TETO_MAXIMO + '. ' + USO)
  teto = Math.min(args.teto, TETO_MAXIMO)
}

const erros = []
const tarefas = lista.map((t, i) => {
  const o = typeof t === 'string' ? { tarefa: t } : (t && typeof t === 'object' ? t : {})
  const texto = typeof o.tarefa === 'string' ? o.tarefa.trim() : ''
  if (!texto) erros.push('task ' + (i + 1) + ' has no text')
  for (const k of Object.keys(o)) {
    if (CHAVES.indexOf(k) === -1) erros.push('task ' + (i + 1) + ': unknown key ' + JSON.stringify(k) + '; the keys are ' + CHAVES.join(', '))
  }
  if (o.edita !== undefined && typeof o.edita !== 'boolean') {
    erros.push('task ' + (i + 1) + ': edita ' + JSON.stringify(o.edita) + ' must be true or false, without quotes')
  }
  const edita = o.edita === true
  const modelo = o.modelo === undefined ? (edita ? 'sonnet' : 'haiku') : o.modelo
  if (MODELOS.indexOf(modelo) === -1) erros.push('task ' + (i + 1) + ': modelo ' + JSON.stringify(modelo) + ' not in ' + MODELOS.join('/'))
  const esforco = o.esforco === undefined ? 'medium' : o.esforco
  if (ESFORCOS.indexOf(esforco) === -1) erros.push('task ' + (i + 1) + ': esforco ' + JSON.stringify(esforco) + ' not in ' + ESFORCOS.join('/'))
  return { n: i + 1, tarefa: texto, edita, modelo, esforco }
})
if (erros.length) throw new Error('parallel: ' + erros.join('; ') + '. ' + USO)

const rodam = tarefas.slice(0, teto)
const fora = tarefas.slice(teto)
if (fora.length) {
  log('parallel: cap of ' + teto + ' agents on this run; ' + fora.length +
    ' task(s) did NOT run: ' + fora.map((t) => t.n).join(', ') + '. Run again with them.')
}

const RESULTADO = {
  type: 'object',
  properties: {
    feito: { type: 'boolean' },
    resumo: { type: 'string' },
    arquivos: { type: 'array', items: { type: 'string' } },
    evidencia: { type: 'string' },
    pendente: { type: 'string' },
    ondeFicou: { type: 'string' },
  },
  required: ['feito', 'resumo', 'evidencia'],
}

function instrucao(t) {
  const partes = [
    'Do only this task, nothing beyond it:',
    t.tarefa,
    '',
    'Rules:',
    '- It was split off as independent of the others. If you find out it depends on another task or on a human decision, stop and say so in `pendente`.',
    '- Do not commit, push, publish or run destructive commands.',
    '- In `evidencia`, paste the command you ran and the output line that proves the result. Without evidence, `feito` is false.',
    '- In `arquivos`, list the paths you changed (empty if you only read).',
  ]
  if (t.edita) {
    partes.push('- You run in an isolated copy of the repository (worktree). When done, put in `ondeFicou` the absolute path of the copy and the branch, so whoever called you can review and bring in the change.')
  } else {
    // sem copia isolada: o agente roda na arvore viva, entao leitura nao pode virar edicao
    partes.push('- This task is read-only: do not create, edit or delete files. If it asks for a change, stop and say in `pendente` that it needs to run again with "edita": true.')
  }
  return partes.join('\n')
}

// parallel() troca a excecao por null e perde o porque: a excecao e pega aqui, por tarefa, com a mensagem.
// agent() devolve null quando o usuario pula o agente ou ele morre por erro de API depois das tentativas.
const SEM_RESPOSTA = 'the agent was skipped or died from an API error, with no answer'
// Quem so le abre no agente leve do plugin (agents/reader.md: sem CLAUDE.md, sem lista de skills, sem Edit/Write);
// o agente padrao abria com ~56 mil tokens por tarefa. Quem edita segue no padrao, com as regras do projeto.
const LEITOR = 'sworn:reader'
phase('Tasks')
const saidas = await parallel(rodam.map((t) => () => agent(instrucao(t), Object.assign({
  label: 'task ' + t.n + (t.edita ? ' (edita)' : ''),
  phase: 'Tasks',
  schema: RESULTADO,
  model: t.modelo,
  effort: t.esforco,
}, t.edita ? { isolation: 'worktree' } : { agentType: LEITOR })).catch((e) => ({ erroDoAgente: String((e && e.message) || e) }))))

function resultado(t, saida) {
  const base = { n: t.n, tarefa: t.tarefa, edita: t.edita, modelo: t.modelo }
  if (!saida) return Object.assign(base, { respondeu: false, motivo: SEM_RESPOSTA })
  if (saida.erroDoAgente !== undefined) return Object.assign(base, { respondeu: false, motivo: 'error: ' + saida.erroDoAgente })
  return Object.assign(base, { respondeu: true }, saida)
}

return {
  aviso: 'an agent result is a claim: check the critical part at the source before calling it done',
  rodaram: rodam.length,
  naoRodaram: fora.map((t) => ({ n: t.n, tarefa: t.tarefa })),
  resultados: rodam.map((t, i) => resultado(t, saidas[i])),
}
