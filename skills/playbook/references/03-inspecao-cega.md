# Protocolo de inspeção cega

O rito que transforma "revisar" em veredito com evidência.

---

## 1. Preparar o material

**Baseline (o padrão de comparação).** Sempre dois elementos, nomeados na resposta:

1. os valores literais da régua declarada — `{{texto:reguaDeComparacao}}`;
2. o artefato irmão de melhor acabamento **já aprovado** — `{{texto:artefatoDeReferencia}}`.

Se o projeto não declarou nenhum dos dois, **dizer isso ao inspetor**. Ele passa a julgar
consistência interna, e o veredito sai marcado como "sem régua externa". Inspetor sem baseline que
não sabe que está sem baseline inventa uma, e a dele nunca é a sua.

**Artefatos.** Para mudança visual, gerar as imagens por viewport antes e depois. Para mudança de
código, o diff e os arquivos tocados.

### Integridade do artefato — verificar ANTES de despachar

Artefato mutilado produz veredito inválido, e o inspetor não tem como saber que foi mutilado. Ele
reporta o corte como se fosse defeito do código, e o voto dele contamina a ronda inteira.

**Regra: entregar o arquivo inteiro.** Comparar duas versões? `git show HEAD:<path>` de um lado, o
arquivo do disco do outro. Sem fatiar. A exceção é o recorte que o `/sworn:review` faz sozinho nas
faixas pequenas: ele marca cada vão, mantém os números de linha e avisa o inspetor.

**Se precisar fatiar** — arquivo grande demais, ou o alvo é um trecho isolado — então, antes de
despachar:

- a fatia começa e termina em **fronteira de função**, nunca no meio de uma;
- a **mesma** fronteira lógica nos dois lados (não a mesma linha: a versão nova é mais longa, e
  cortar as duas em `[224..350]` decapita a nova);
- conferir que toda função citada no brief está **completa** na fatia;
- avisar o inspetor de que é um recorte, e de qual escopo — para ele reportar "não consigo ver" em
  vez de "está ausente".

**Cegar.** Antes de entregar ao inspetor:

- renomear para `A` e `B`, sem "antes"/"depois", sem número de versão, sem data no nome;
- **alternar a ordem** entre inspetores — `A` nem sempre é o mesmo lado;
- remover do brief qualquer menção de autoria ("implementei", "minha mudança", "o novo");
- não dizer qual resultado se espera.

O inspetor que sabe qual lado é o "novo" confirma o trabalho em vez de julgá-lo.

### O que a cegueira não esconde

A cegueira é parcial, e fingir que é total leva a confiar demais no placar:

- **Contagem de linhas.** O lado que ganhou código é maior. 667 contra 631 entrega o jogo a quem
  reparar.
- **Comentário que descreve a correção.** Um `// isso ficava girando para sempre` diz qual lado é o
  depois. Não é motivo para tirar o comentário do código — é motivo para não confiar cegamente no
  voto.
- **Ler o repositório vivo.** Se o inspetor abrir o arquivo em disco, ele vê qual variante está lá.

### A proibição, e a exceção que a torna útil

**Proibir explicitamente:** abrir os arquivos de código do repositório, ler o histórico de commits,
abrir plano, handoff ou log de decisões. Fazer qualquer um desses **invalida o veredito dele**.

**Permitir explicitamente, e mandar usar:** os documentos de referência que definem a régua. O
inspetor precisa deles para julgar contra algo que não seja o próprio gosto. Proibir tudo em bloco
produz inspetor sem critério, que é o mesmo que inspetor inútil.

**Avisar quando a fonte de referência estiver congelada de propósito.** Se a régua está deliberadamente
atrasada em relação ao código — porque uma migração está em curso, por exemplo — e ninguém avisar, o
inspetor reporta a defasagem inteira como achado, e a ronda vira ruído.

Consequência prática: o placar A/B é sinal, **não prova**. O que vale no veredito é o achado com
`arquivo:linha`, que se sustenta sozinho. Um "MELHOR: B" sem achado citado não vale nada — e um
achado bem evidenciado vale mesmo que o inspetor tenha adivinhado os lados.

---

## 2. Despachar as lentes

Uma lente por inspetor, **lentes distintas**, nunca cópias do mesmo revisor. São duas famílias: as
oito lentes de tela, com lista e critérios em [02-rubrica-aaa.md](02-rubrica-aaa.md), e as dez
lentes de código do `/sworn:review`. Só as lentes aplicáveis ao tipo de mudança — tabela no
fim daquele arquivo.

Cada inspetor recebe: os artefatos A/B, a sua lente (uma só), o baseline nomeado, a proibição e a
exceção da §1, e a instrução de **tentar reprovar**. O default do inspetor é encontrar problema, não
aprovar.

---

## 3. Formato do veredito

```
LENTE: <nome>
VEREDITO: APROVADO | APROVADO COM RESSALVA | REPROVADO
MELHOR: A | B | empate  (só quando há comparação lado a lado)
ACHADOS:
  - [P0|P1|P2] <descrição> — evidência: <arquivo:linha> ou <viewport + coordenada do print>
```

**Regra anti-teatro.** Veredito sem achado citado com evidência **não conta no cômputo da ronda**.
Elogio não é resultado. Se o inspetor não encontrou nada, ele diz o que procurou e onde procurou.

---

## 4. Convergência

- **Ronda seca** = nenhum achado novo de severidade **P1 ou acima**.
- **Duas rondas secas consecutivas** → aprovado. Encerra o loop.
- **Teto de 3 rondas.**
- Terceira ronda com **P0 ou P1 aberto** → **parar**. Levar a `{{campo:quemDecide}}` com três opções
  (formato no `SKILL.md` §7) e registrar o que sobrou em `{{texto:ondeRegistrar}}`.
- **P2 nunca reabre ronda.** Vira registro, não vira correção.

Entre rondas: corrigir apenas P0 e P1, e apenas dentro do escopo pedido. Corrigir P2 é o começo do
scope creep que os guarda-corpos proíbem.

### Quando o conserto vira o defeito

Se o achado da ronda N atinge **a correção feita na ronda N-1**, o loop parou de convergir e virou
uma sequência de remendos. Sinal duro: aconteceu duas rondas seguidas.

**A saída não é uma ronda a mais.** É parar de consertar e rodar **uma varredura adversarial única
sobre a causa** — enumerar a classe inteira do defeito antes de escrever a próxima linha de conserto.
Um rito de 3 rondas que vira um de 12 não descobriu mais coisas: descobriu o próprio desenho, tarde.

Se mesmo assim não fechar, isso é decisão de `{{campo:quemDecide}}`, com três opções — e uma delas é
sempre "fechar com o defeito registrado e não corrigido".

### Estreitar as rondas seguintes — a ronda 1 é a cara

A ronda 1 roda **todas** as lentes aplicáveis: é ela que descobre. As seguintes **verificam**, e
verificar é mais barato que descobrir.

**Ronda 2+ chama apenas as lentes que tiveram achado P0/P1 contra o próprio trabalho.** Lente que só
reportou defeito pré-existente, ou que aprovou sem ressalva, não volta.

Ordem de grandeza para uma mudança pequena: 8 na ronda 1, 4 a 5 na ronda 2, 2 a 3 na ronda 3.
Repetir 8 em toda ronda é ~24 agentes para um alvo de 40 linhas — desproporcional, e a evidência não
melhora.

**Reformular o brief da lente que reincidir.** Se a lente 4 achou um atributo de estado preso, a
ronda 2 dela não pede "inspecione acessibilidade" de novo: pede **rastrear o ciclo de vida do
atributo em cada caminho de execução, com os números de linha de cada set e cada reset**. Pergunta
específica devolve resposta verificável; pergunta genérica devolve o mesmo parecer da ronda anterior.

**Declarar o total ao usuário.** Quantos agentes por ronda, e quantos no total.

### Achado repetido não reabre ronda

Uma lente que reafirma na ronda 2 o mesmo achado da ronda 1 — mesma evidência, mesmo `arquivo:linha`
— **não** torna a ronda molhada. Ronda seca é ausência de achado **novo** de P1 ou acima.

Sem essa regra o loop nunca converge: um achado fora de escopo, corretamente registrado e corretamente
não corrigido, reapareceria em toda ronda e consumiria o teto de 3 sozinho.

Achado que **volta com evidência diferente** é novo. Achado que volta idêntico é o mesmo achado.

---

## 5. A lente pode errar a medição, não só o julgamento

Parecer de lente **não vence medição própria** — mesmo lente cara, mesmo achado marcado P0.

Um inspetor que conta ocorrências, mede largura ou afirma cobertura está **medindo**, e medição de
lente tem o mesmo defeito de qualquer medidor: pode estar contando a coisa errada. Antes de aceitar
um número que vem de um parecer, reproduzir o número. Se divergir, **o instrumento é o suspeito
primeiro** — ver a regra do medidor em [04-verificacao.md](04-verificacao.md).

Isto não é desconfiança do modelo: é a mesma regra que se aplica a qualquer ferramenta nova.

---

## 6. O que reportar ao usuário

- quantas rondas rodaram e por que parou (2 secas / teto atingido);
- **quantos agentes rodaram por ronda** — custo é informação;
- achados P0/P1 corrigidos, com o diff;
- achados P2 registrados, com o caminho do registro;
- o que **não** foi inspecionado e por quê.

---

## 7. Script de referência

Modelo para um orquestrador de subagentes. Ajustar as lentes ao tipo de mudança; **não** rodar as
oito quando só quatro se aplicam.

```javascript
export const meta = {
  name: 'inspecao-cega-aaa',
  description: 'Loop de inspecao cega do Padrao AAA - lentes distintas, teto de 3 rondas',
  phases: [{ title: 'Inspecionar' }, { title: 'Consolidar' }],
}

const LENTES = [
  'design-system', 'estados', 'responsividade', 'acessibilidade',
  'microcopy', 'anti-referencias', 'regressao', 'governanca',
]

const VEREDITO = {
  type: 'object',
  required: ['lente', 'veredito', 'achados'],
  properties: {
    lente: { type: 'string' },
    veredito: { enum: ['APROVADO', 'APROVADO_COM_RESSALVA', 'REPROVADO'] },
    melhor: { enum: ['A', 'B', 'empate', 'nao_aplica'] },
    achados: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severidade', 'descricao', 'evidencia'],
        properties: {
          severidade: { enum: ['P0', 'P1', 'P2'] },
          descricao: { type: 'string' },
          evidencia: { type: 'string' },
        },
      },
    },
  },
}

const vistos = new Set()
const historico = []
let secas = 0

for (let ronda = 1; ronda <= 3 && secas < 2; ronda++) {
  phase('Inspecionar')
  const vereditos = (await parallel(LENTES.map((lente, i) => () =>
    agent(
      `Inspecione os artefatos A e B pela lente "${lente}".\n` +
      `Voce NAO sabe qual e o anterior. Ordem embaralhada: ${i % 2 ? 'B primeiro' : 'A primeiro'}.\n` +
      `Baseline: a regua declarada pelo projeto + o artefato de referencia aprovado.\n` +
      `Criterios: a secao da sua lente na rubrica das oito lentes de tela.\n` +
      `PROIBIDO abrir arquivos de codigo do repositorio, historico de commits, plano ou handoff.\n` +
      `PERMITIDO e recomendado ler os documentos de referencia que definem a regua.\n` +
      `Seu default e REPROVAR. Todo achado cita arquivo:linha ou viewport+coordenada.\n` +
      `Achado sem evidencia citada nao conta.`,
      { label: `ronda${ronda}:${lente}`, phase: 'Inspecionar', schema: VEREDITO }
    )
  ))).filter(Boolean)

  const novos = vereditos
    .flatMap(v => v.achados.map(a => ({ ...a, lente: v.lente })))
    .filter(a => !vistos.has(`${a.lente}|${a.evidencia}`))

  novos.forEach(a => vistos.add(`${a.lente}|${a.evidencia}`))
  historico.push({ ronda, vereditos, novos, agentes: vereditos.length })

  const bloqueantes = novos.filter(a => a.severidade !== 'P2')
  secas = bloqueantes.length === 0 ? secas + 1 : 0
  log(`Ronda ${ronda}: ${novos.length} achados novos (${bloqueantes.length} bloqueantes), ${secas} secas seguidas`)
}

phase('Consolidar')
const todos = historico.flatMap(h => h.novos)
return {
  rondas: historico.length,
  agentes: historico.reduce((s, h) => s + h.agentes, 0),
  aprovado: secas >= 2,
  bloqueantes: todos.filter(a => a.severidade !== 'P2'),
  registrar: todos.filter(a => a.severidade === 'P2'),
}
```

O script **não corrige nada**. Ele produz o veredito. A correção de P0/P1 acontece entre rondas, no
fluxo normal, respeitando os guarda-corpos.

---

## 8. Sem orquestrador disponível

O rito não depende da ferramenta. Fallback obrigatório: despachar as lentes como subagentes
individuais em paralelo, num único disparo, aplicar as mesmas regras de cegueira e convergência à
mão, e **registrar que o loop rodou em modo manual**.

Se o harness proibir subagentes sem pedido explícito, isso **não** é a skill proibindo — é o ambiente.
Nesse caso: pedir autorização, ou declarar o loop como **não rodado**. Nunca declarar aprovado um
rito que não aconteceu.
