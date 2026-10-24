# Marchas e portões

Três marchas de rigor. A marcha é escolhida no Passo 0, antes de ler código, e é **declarada na
resposta** ("Marcha Padrão: bugfix delimitado").

Lembrete do `SKILL.md` §2: **a marcha que você classifica é piso, nunca teto.** Se o projeto declarou
o mapa `caminho → marcha` (`{{campo:marchas}}`), ele vence, e vence sempre para cima.

---

## Passo -1 — quem mais está mexendo aqui

**Antes de editar qualquer arquivo, em qualquer marcha**, rodar no repositório alvo:

```
git status --short
```

Todo arquivo já modificado e não commitado **pertence a outra frente de trabalho** até prova em
contrário. Não é rascunho abandonado, e não é convite.

- **Não editar arquivo que já aparece modificado**, mesmo que a mudança seja "pequena" ou "óbvia".
- Se o objetivo **exige** tocar num deles: parar e levar a `{{campo:quemDecide}}` no formato de 3
  opções (`SKILL.md` §7). Isso é decisão dele, não julgamento técnico do agente.
- **Reconferir no fecho.** O conjunto muda durante a tarefa: outra sessão abre arquivo novo enquanto
  esta trabalha. O `git status` do começo não vale como evidência no fim.
- **Listar na resposta** os arquivos de terceiros que foram deixados intocados. Isso prova que a
  verificação aconteceu, e protege quem vier depois de achar que o diff é todo seu.

**Um workspace pode ter vários repositórios.** `git status` na raiz **não enxerga** repositório
aninhado que tenha o próprio `.git`. Rodar em cada repo que a tarefa toca, e listar os três estados
separadamente. Confiar no status da raiz e editar dentro de um repo filho é como se edita, sem saber,
54 linhas não commitadas de outra sessão.

**Sinais de que há sessão concorrente**, mesmo sem ninguém avisar: arquivo de baseline modificado;
teste de contrato modificado sem código correspondente; folha de estilo modificada sem tarefa de UI
aberta; documento de log de decisões crescendo.

### Documento append-only com numeração sequencial

Log de decisões, changelog, registro de achados: **ler o último número no disco antes de escrever**,
nunca no handoff nem na memória.

```
grep -n "^[0-9]\+\. " <arquivo> | tail -3
```

Handoff é uma foto do passado; com sessão concorrente, ele mente sobre o presente — e duas sessões
que leem o mesmo handoff gravam **o mesmo número** para decisões diferentes. Se a colisão já
aconteceu: renumerar **a sua** (a posterior no arquivo) e **nunca tocar no texto da outra sessão**.
Provar com `git diff --numstat`: remoções = 0.

**`git add` nominal, sempre.** Nunca `git add .` nem `-A` — a árvore tem arquivo de outra frente o
tempo todo, e commitar arquivo compartilhado leva o trabalho da outra sessão junto. Isso é decisão de
`{{campo:quemDecide}}`, não julgamento do agente.

**Nunca subir baseline de catraca** para fazer um teste passar. Além de mascarar dívida, arquivo de
baseline é justamente o que uma frente de limpeza está editando — mexer nele é colisão quase
garantida. A saída correta é remover a causa.

---

## Marcha 1 — Rápida

**Gatilho:** typo, texto de interface sem mudança de significado, comentário, docstring, rename
local, formatação, config pontual. **Até 2 arquivos.** Zero lógica nova. Nada visível ao usuário muda
de comportamento.

**Agente:** o mais barato que resolve — camada de edição mecânica.

**Portões:**
- Menor diff possível; estilo do arquivo preservado.
- `git diff --check` limpo.
- Arquivos alterados listados na resposta.

**Evidência mínima:** o diff e a lista de arquivos.

**Não usar Rápida quando:** o texto alterado é um dos rótulos canônicos do produto
(`{{texto:rotulosCanonicos}}`), ou a config tocada governa permissão, build, publicação ou endpoint.
Isso é AAA. **Rótulo canônico não é detectável por caminho de arquivo** — é o agente que tem de
reconhecer, e por isso está escrito aqui.

---

## Marcha 2 — Padrão

**Gatilho:** correção de bug de causa conhecida, feature de escopo claro, refactor delimitado a um
módulo, teste novo, documentação técnica.

**Agente:** camada de desenvolvimento. Escala para raciocínio profundo se aparecer decisão
arquitetural, bug de causa não isolada ou risco de segurança.

**Portões:**
- Contexto real lido antes de editar — código, não suposição.
- Menor diff seguro; nomes, IDs, chaves de armazenamento e ordem de carga preservados.
- **Uma revisão independente**: outro agente, sem herdar as conclusões do primeiro, olhando o diff.
  **Nenhum mecanismo determinístico força isto** — é o portão da marcha Padrão que mais depende de
  disciplina, e o primeiro a sumir quando a pressa aperta.
- A prova de pronto da área afetada — `{{campo:provaDePronto}}`.
- `git diff --check` limpo.

**Evidência mínima:** saída da prova de pronto colada, veredito do revisor, lista de arquivos.

**Sobe para AAA quando:** durante a execução aparecer qualquer gatilho da marcha 3. A marcha pode
subir no meio do caminho; nunca desce.

---

## Marcha 3 — AAA

**Gatilho — qualquer um destes:**

- mudança visível ao usuário (UI, layout, texto de estado, ícone);
- release ou bump de versão;
- mudança de contrato entre sistemas (verbo, auth, campo obrigatório, formato de resposta);
- permissões, perfis, papéis, telas administrativas;
- segurança, dados sensíveis, revogação, replay;
- refactor amplo ou que cruze módulos;
- **bug intermitente, ou que já resistiu a uma tentativa**;
- execução de etapa de plano longo;
- qualquer caminho que `{{campo:marchas}}` marque como AAA.

Note que **os três em destaque não são inferíveis do caminho do arquivo** — "já resistiu a uma
tentativa", "é release", "é etapa de plano longo" são fatos da conversa, não do disco. Mecanismo
nenhum os pega; o agente tem de declarar.

**Agente:** camada de raciocínio profundo. A camada máxima no gate crítico — segurança, readiness de
release, decisão de difícil reversão.

**Portões — todos obrigatórios:**

1. **Plano escrito antes de editar**: objetivo, fora de escopo, arquivos prováveis, riscos, critério
   de aceite. Para plano longo, **reler o trecho do plano no arquivo**, nunca de memória nem do
   handoff.
2. **Contagem antes do brief**: grepar o repositório inteiro, não só os arquivos que já se pretende
   tocar, e colocar a contagem por arquivo no brief. Brief com número errado gera escopo errado.
3. **Loop de inspeção cega** — as lentes da mudança (dez de código, oito de tela), teto de 3
   rondas, parada em 2 rondas secas. Ver [03-inspecao-cega.md](03-inspecao-cega.md).
4. **A prova de pronto completa** — `{{campo:provaDePronto}}`, sem parar no primeiro erro, para ver
   todas as falhas de uma vez. **Separar falha nova de falha pré-existente com evidência** — rodar
   antes de editar, ou mostrar que os arquivos lidos pelo teste que falhou não estão no diff. "Já
   falhava" sem prova é suposição, e é assim que uma regressão entra despercebida.
5. **Um punhado de testes citados não é aprovação.** Se a suíte do projeto for grande, passar em três
   contratos rápidos dá sinal cedo e **não** prova nada: classes inteiras de erro ficam fora deles.
   Só a prova de pronto completa fecha o portão.
6. **Evidência visual quando houver mudança visual — se o projeto tiver como gerá-la.**
   **Passo 0 do portão, nesta ordem:** (a) existe gerador para esta área? (b) o ambiente responde?
   Se qualquer resposta for não, **declarar no plano, antes de executar**, que a lente 3 vai rodar por
   leitura de código e estilo. Descobrir isso no fecho já é tarde — o plano prometeu evidência que
   não existia. Com gerador, a regressão de tela se prova por **comparação automática de print antes
   × depois** das mesmas telas e viewports, apontando o que mudou fora do pedido; sem o instrumento,
   declarar que a comparação foi a olho.
7. **Gate de release** se o artefato publicável mudou.
8. **Documentação no mesmo conjunto de mudanças**: toda função visível nova atualiza permissões,
   telas administrativas, ajuda, testes e docs juntos. O par "tocou X, tem de ter tocado Y" está em
   [05-governanca.md](05-governanca.md).
9. **Decisão humana no fecho** quando houver risco aberto, escolha de produto, ou release.

**Evidência mínima:** saída de cada comando colada, vereditos das rondas com contagem de agentes,
caminho dos artefatos gerados, e a lista do que **não** rodou com o motivo.

**Entrega do fecho que não bloqueia — roteiro de teste de uso, em função visível nova.** Não é
portão: o fecho sai sem ele esperar resposta, mas o roteiro vai ao dono junto. A tarefa que o usuário
vai fazer, em uma frase; 5 usuários reais, um de cada vez, fazendo sem ajuda enquanto alguém observa
calado; anotar onde cada um travou. Cinco acham a maior parte dos problemas de uso (cerca de 85%, pela
curva de Nielsen e Landauer); mais que isso repete o já visto.

---

## Regra de dúvida — os dois eixos

| Eixo | Regra |
|---|---|
| Qual **modelo** usar | Na dúvida, o mais barato. Os agentes escalam sozinhos. |
| Qual **marcha** aplicar | Na dúvida, a mais rigorosa. |

Não são a mesma decisão. Um agente barato executando um texto de estado de erro numa tela visível é
modelo barato em marcha AAA — portão completo. Isso é o desenho correto, não uma contradição.

---

## Delegação

- Perguntas conversacionais ou que já se sabe responder: responder direto, sem delegar.
- **Busca e leitura vão para a camada mais barata que sabe ler** — localizar arquivo, achar função,
  responder "onde está X", mapear estrutura. É a delegação mais fácil de esquecer, e a mais barata.
- **Agente que edita por casamento exato de texto não vai para o degrau mais barato**, e sim para o do
  meio. A edição que falha vira escalada, e escalada refaz a tarefa inteira: um único retrabalho anula
  a diferença de preço entre os dois degraus. Busca e leitura, que não editam, seguem no mais barato.
- **Subagente que cai com limite de uso (erro 429) não espera o reset: relance o mesmo brief em outro
  modelo.** O limite é por modelo, e trocar destrava na hora. Registre que a ronda mudou de modelo e
  **conte o agente caído** no total declarado — custo é informação. Modelo mais barato serve para ronda
  de verificação, com pergunta específica e fatos já provados no brief; não para a primeira ronda, que
  é a que descobre.
- Tarefas independentes podem ir em paralelo para agentes diferentes, num único disparo.
- Após delegar, **repassar ao usuário o resultado relevante** — o relatório do subagente não aparece
  para ele. Nenhum mecanismo garante isso; é regra de texto e some se não for lembrada.
- **Relatório de subagente é alegação, não fato.** Conferir antes de agir sobre ele — sobretudo
  quando o parecer contradiz uma medição sua. Ver a regra do medidor em
  [04-verificacao.md](04-verificacao.md).
- Se subagentes estiverem indisponíveis, aplicar o mesmo ciclo no agente controlador — tarefa
  isolada, auto-revisão explícita, verificação — e **registrar a limitação**.
