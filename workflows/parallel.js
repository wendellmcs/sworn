export const meta = {
  name: 'parallel',
  description: 'Roda tarefas independentes em paralelo, com teto de agentes, modelo barato e isolamento para quem edita',
  whenToUse: 'Tres ou mais tarefas que nao dependem umas das outras, depois que o usuario aceitou o custo',
  phases: [{ title: 'Tarefas', detail: 'um agente por tarefa, ate o teto' }],
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
const USO = 'paralelo: passe args como lista de tarefas, por exemplo ' +
  '[{"tarefa": "texto da tarefa", "edita": false}] ou ["tarefa 1", "tarefa 2"]; ' +
  'ou {"tarefas": [...], "teto": 8}.'

const lista = Array.isArray(args) ? args : (args && Array.isArray(args.tarefas) ? args.tarefas : null)
if (!lista || !lista.length) throw new Error(USO)

let teto = TETO_PADRAO
if (args && !Array.isArray(args) && args.teto !== undefined) {
  if (!Number.isInteger(args.teto) || args.teto < 1) throw new Error('paralelo: teto tem de ser inteiro de 1 a ' + TETO_MAXIMO + '. ' + USO)
  teto = Math.min(args.teto, TETO_MAXIMO)
}

const erros = []
const tarefas = lista.map((t, i) => {
  const o = typeof t === 'string' ? { tarefa: t } : (t && typeof t === 'object' ? t : {})
  const texto = typeof o.tarefa === 'string' ? o.tarefa.trim() : ''
  if (!texto) erros.push('tarefa ' + (i + 1) + ' sem texto')
  for (const k of Object.keys(o)) {
    if (CHAVES.indexOf(k) === -1) erros.push('tarefa ' + (i + 1) + ': chave ' + JSON.stringify(k) + ' desconhecida; as chaves sao ' + CHAVES.join(', '))
  }
  if (o.edita !== undefined && typeof o.edita !== 'boolean') {
    erros.push('tarefa ' + (i + 1) + ': edita ' + JSON.stringify(o.edita) + ' tem de ser true ou false, sem aspas')
  }
  const edita = o.edita === true
  const modelo = o.modelo === undefined ? (edita ? 'sonnet' : 'haiku') : o.modelo
  if (MODELOS.indexOf(modelo) === -1) erros.push('tarefa ' + (i + 1) + ': modelo ' + JSON.stringify(modelo) + ' fora de ' + MODELOS.join('/'))
  const esforco = o.esforco === undefined ? 'medium' : o.esforco
  if (ESFORCOS.indexOf(esforco) === -1) erros.push('tarefa ' + (i + 1) + ': esforco ' + JSON.stringify(esforco) + ' fora de ' + ESFORCOS.join('/'))
  return { n: i + 1, tarefa: texto, edita, modelo, esforco }
})
if (erros.length) throw new Error('paralelo: ' + erros.join('; ') + '. ' + USO)

const rodam = tarefas.slice(0, teto)
const fora = tarefas.slice(teto)
if (fora.length) {
  log('paralelo: teto de ' + teto + ' agentes neste disparo; ' + fora.length +
    ' tarefa(s) NAO rodaram: ' + fora.map((t) => t.n).join(', ') + '. Dispare de novo com elas.')
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
    'Faca so esta tarefa, nada alem dela:',
    t.tarefa,
    '',
    'Regras:',
    '- Ela foi separada como independente das outras. Se descobrir que depende de outra tarefa ou de uma decisao humana, pare e diga em `pendente`.',
    '- Nao faca commit, push, publicacao nem comando destrutivo.',
    '- Em `evidencia`, cole o comando que rodou e a linha da saida que prova o resultado. Sem evidencia, `feito` e false.',
    '- Em `arquivos`, liste os caminhos que mudou (vazio se so leu).',
  ]
  if (t.edita) {
    partes.push('- Voce roda numa copia isolada do repositorio (worktree). Ao terminar, ponha em `ondeFicou` o caminho absoluto da copia e a branch, para quem chamou revisar e trazer a mudanca.')
  } else {
    // sem copia isolada: o agente roda na arvore viva, entao leitura nao pode virar edicao
    partes.push('- Esta tarefa e so de leitura: nao crie, edite nem apague arquivo. Se ela pedir mudanca, pare e diga em `pendente` que precisa rodar de novo com "edita": true.')
  }
  return partes.join('\n')
}

// parallel() troca a excecao por null e perde o porque: a excecao e pega aqui, por tarefa, com a mensagem.
// agent() devolve null quando o usuario pula o agente ou ele morre por erro de API depois das tentativas.
const SEM_RESPOSTA = 'o agente foi pulado ou morreu por erro de API, sem resposta'
// Quem so le abre no agente leve do plugin (agents/reader.md: sem CLAUDE.md, sem lista de skills, sem Edit/Write);
// o agente padrao abria com ~56 mil tokens por tarefa. Quem edita segue no padrao, com as regras do projeto.
const LEITOR = 'sworn:reader'
phase('Tarefas')
const saidas = await parallel(rodam.map((t) => () => agent(instrucao(t), Object.assign({
  label: 'tarefa ' + t.n + (t.edita ? ' (edita)' : ''),
  phase: 'Tarefas',
  schema: RESULTADO,
  model: t.modelo,
  effort: t.esforco,
}, t.edita ? { isolation: 'worktree' } : { agentType: LEITOR })).catch((e) => ({ erroDoAgente: String((e && e.message) || e) }))))

function resultado(t, saida) {
  const base = { n: t.n, tarefa: t.tarefa, edita: t.edita, modelo: t.modelo }
  if (!saida) return Object.assign(base, { respondeu: false, motivo: SEM_RESPOSTA })
  if (saida.erroDoAgente !== undefined) return Object.assign(base, { respondeu: false, motivo: 'erro: ' + saida.erroDoAgente })
  return Object.assign(base, { respondeu: true }, saida)
}

return {
  aviso: 'resultado de agente e alegacao: confira o critico na fonte antes de dar por pronto',
  rodaram: rodam.length,
  naoRodaram: fora.map((t) => ({ n: t.n, tarefa: t.tarefa })),
  resultados: rodam.map((t, i) => resultado(t, saidas[i])),
}
