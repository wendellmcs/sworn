---
name: playbook
description: Manual de execução portátil para qualquer projeto. Use no início de toda tarefa que não seja conversa pura — implementar, corrigir bug, planejar, revisar, auditar, mexer em UI, escrever doc, versionar, publicar, executar plano longo. Define a marcha de rigor (Rápida/Padrão/AAA), as lentes de inspeção (dez de código e oito de tela), o loop de julgamento cego com teto de rondas, os gatilhos contáveis de troca de chat, o formato obrigatório de decisão do dono e o que um "pronto" precisa provar. Adapta-se ao projeto por um adaptador declarado; sem ele, roda em modo degradado e declara o que não consegue verificar. Sobrepõe-se ao improviso; nunca ao pedido explícito do usuário.
---

# Padrão AAA Universal

## 1. O que esta skill é, e o que ela não é

É o **procedimento**: diz qual portão de qualidade se aplica a cada tarefa e que evidência prova que
o portão passou. **Não é regra de negócio, e não inventa fato sobre o projeto** — todo valor concreto
(comando, cor, rótulo, caminho) vem do adaptador do Passo 0-bis.

**Precedência, do mais forte ao mais fraco:**

1. Pedido humano explícito e recente
2. As fontes canônicas que o projeto declarou — `{{campo:fontesCanonicas}}`, na ordem em que ele as
   declarou
3. A skill de projeto, se existir (ela conhece o domínio; esta não)
4. Esta skill
5. Comportamento padrão do modelo

**Se o projeto tiver a própria skill de execução, ela vence esta em tudo que for conteúdo.** Esta
skill cede e não duplica.

**Referência por nome, nunca por linha.** Ao citar um documento de governança, citar o arquivo e o
**título da seção** — nunca `arquivo:linha`. Âncora de linha apodrece silenciosamente e passa a
apontar para linha vazia, o que é pior que não citar. Isso vale só para documento de governança:
achado de inspeção continua exigindo `arquivo:linha` do **código**, que é verificável na hora.

## 2. Passo 0 — classificar a marcha, antes de ler código

| Se a tarefa é… | Marcha |
|---|---|
| typo, texto, comentário, rename, formatação, config pontual — 1–2 arquivos, zero lógica nova, nada visível ao usuário | **Rápida** |
| bugfix, feature de escopo claro, refactor delimitado, teste novo, documentação | **Padrão** |
| UI visível ao usuário; release; mudança de contrato entre sistemas; permissões; segurança; refactor amplo; bug intermitente; execução de plano longo; qualquer item de `{{campo:marchas}}` marcado como AAA | **AAA** |

**A marcha que você classifica é um piso, nunca um teto.** Se o projeto declarou um mapa
`caminho → marcha` (`{{campo:marchas}}`), ele **vence** — e vence sempre para cima. Quem está sendo
fiscalizado não escolhe o próprio nível de rigor. Sem mapa declarado, vale `{{campo:marchaPadrao}}`;
sem nenhum dos dois, vale a tabela acima.

Dois eixos que se confundem e não são a mesma coisa:

- **Na dúvida entre dois modelos, desce** — comece pelo mais barato. Os agentes escalam sozinhos.
- **Na dúvida entre duas marchas, sobe** — o portão mais rigoroso.

Um agente barato pode e deve passar por portão AAA. Custo de modelo e rigor de verificação são
independentes.

Detalhe de cada marcha, com portões e evidência mínima: [01-marchas-e-gates.md](references/01-marchas-e-gates.md).

## 2-bis. Passo 0-bis — este projeto tem adaptador?

**Antes de aplicar qualquer portão**, descobrir com o que preencher as fatias.

1. **Procurar**, nesta ordem: `.claude/*/projeto.json` · `.claude/*/adaptador.md` ·
   a skill de execução do próprio projeto (em `.claude/skills/`, a que diz "Gerado por
   `/sworn:init`"; com mais de uma assim, perguntar ao dono qual vale; sem nenhuma assim, a escrita à
   mão que o projeto usa como manual de execução, se houver — a §1 vale para ela do mesmo jeito).
2. **Achou** → usar os valores dele. Se o projeto reinjeta um arquivo de regras curto em toda sessão,
   **não repetir aqui o que ele já diz** — contexto repetido é contexto pago duas vezes.
3. **Não achou** → oferecer criar, com as cinco perguntas que varredura nenhuma responde. Varrer
   antes, perguntar depois; formato de 3 opções da §7; **nunca sobrescrever** adaptador existente.

**As cinco perguntas** (o resto se descobre varrendo, e se descobre melhor que perguntando):

| # | Pergunta | Preenche |
|---|---|---|
| 1 | Este projeto é interno ou público? | `{{campo:modeloDeAmeaca}}` |
| 2 | Quais arquivos mandam de verdade, e em que ordem? | `{{campo:fontesCanonicas}}` |
| 3 | Qual comando prova que está pronto? | `{{campo:provaDePronto}}` |
| 4 | O que não se pode tocar? | `{{campo:intocaveis}}` |
| 5 | Quem decide? | `{{campo:quemDecide}}` |

**A varredura preenche sozinha, sem perguntar:** `{{campo:plataforma}}` (sistema operacional e shell),
`{{campo:marchas}}` (o mapa `caminho → marcha`) e `{{campo:marchaPadrao}}`. Perguntar o que se
descobre olhando é desperdiçar a paciência de quem responde.

**Fatias de julgamento**, que não se inferem de varredura e por isso se perguntam quando forem usadas
pela primeira vez:

| Fatia | O que preenche |
|---|---|
| `{{texto:reguaDeComparacao}}` | os valores literais contra os quais se compara |
| `{{texto:artefatoDeReferencia}}` | a peça de melhor acabamento já aprovada |
| `{{texto:rotulosCanonicos}}` | nomes do produto que não se alteram |
| `{{texto:viewports}}` | as larguras que o produto atende de verdade |
| `{{texto:pontoDeColapso}}` | a largura em que o layout multi-coluna **tem** de colapsar |
| `{{texto:antiReferencias}}` | o que este produto **não** pode parecer |
| `{{texto:guardaCorposDoProjeto}}` | guarda-corpos que só valem aqui, inclusive os que invertem os desta skill |
| `{{texto:sobreBloqueioAceito}}` | o falso positivo que o dono prefere a um falso negativo |
| `{{texto:foraDeEscopo}}` | o que nunca entra, por decisão já tomada |
| `{{texto:ondeRegistrar}}` | onde vai achado fora de escopo e decisão tomada |
| `{{texto:ondeHandoff}}` | onde vai o handoff |

4. **Modo degradado é declarado, nunca silencioso.** Sem adaptador, esta skill ainda roda: as lentes
   funcionam por leitura de código, e a convergência funciona igual. O que ela **não** consegue é
   comparar contra valores que ninguém declarou. **Dizer quais portões não dão para verificar aqui, e
   por quê, antes de executar.** O risco nunca foi a ausência do portão — é o silêncio sobre ela.

## 2-ter. Passo 0-ter — o mapa de modelos deste projeto ainda vale?

**Esta conferência roda no agente principal. Nunca a delegue a um subagente.**
Foi medido: o subagente recebe do harness a **sua própria identidade**, e **não** o catálogo do que
existe. Um subagente que "confere" compara contra o nada e devolve verde falso — que é pior do que
não conferir, porque parece conferido.

1. **Leia o mapa deste projeto do disco, nunca de memória:**

       node "${CLAUDE_PLUGIN_ROOT}/scripts/portao-apelido.js" --mapa

2. **Compare com o catálogo que o harness entregou a você nesta sessão** — a lista que chegou junto
   das suas instruções, não a que você lembra de ter aprendido.

   ⚠️ **Não tire nome de modelo de arquivo do projeto.** Isto já foi medido e deu errado: sondas
   perguntadas "você recebeu a lista?" responderam que sim e colaram a tabela de roteamento de um
   arquivo do próprio projeto. Num projeto cujos arquivos nomeiam modelos, a conferência mente com
   toda a confiança do mundo.

3. **Divergência aqui é detector de fumaça, não veredito.** O catálogo do harness é magro — famílias
   e identificadores, sem preço e sem janela de contexto — e já se mediu um catálogo desatualizado
   **sobre o próprio modelo que o estava lendo**. Quem traz preço e capacidade é a consulta à página
   do fabricante; quem decide o que a divergência significa é o dono.

4. **Nunca grave a conclusão na configuração.** Resultado de conferência se mostra como evidência
   citada, jamais se escreve sozinho em `projeto.json`. Trocar apelido é decisão do dono, e vai em
   3 opções com a recomendada marcada.

5. **Sem catálogo do harness nesta sessão, diga isso** e siga. Ausência declarada é modo degradado;
   ausência silenciosa é o buraco que este manual existe para não ter.

**Esta conferência é instrução, e instrução pode ser pulada.** A guarda garantida da escada é o
portão que compara arquivo com arquivo e roda sozinho a cada despacho. Esta aqui enxerga o que
portão nenhum enxerga — e vale justamente por isso, mesmo não sendo garantida.

## 3. Ciclo PREVC

**Plan** — objetivo, arquivos prováveis, riscos, critério de aceite, o que está fora de escopo.
**Review** — ler o contexto real e as regras *antes* de opinar. Reler o trecho do plano no arquivo,
nunca de memória nem do handoff.
**Execute** — o menor conjunto de arquivos que resolve.
**Verify** — rodar o que o portão da marcha exige, ou declarar explicitamente o que não rodou.
Saída que mostra falha não verifica: corrige-se a causa e roda-se de novo o que ela afeta.
**Complete** — resumo com evidência, riscos restantes e o que precisa de humano.

Tarefa simples usa o mesmo raciocínio de forma compacta. "Rápido" nunca significa improvisado.

**Cada peça na hora em que ajuda.** O sworn tem comandos para momentos certos; ofereça-os ali, nunca
em toda tarefa, e só rode o que custa com o sim do dono:

- pedido de função nova ou de melhoria no projeto → `/sworn:radar` (projetos públicos parecidos);
- marcha AAA sem referência que se abra → `/sworn:reference` (§4.1);
- trabalho escrito, antes de dar por pronto → `/sworn:review`;
- antes de um release, ou ao fechar AAA de código → `/sworn:shortcuts` (atalho sem gatilho de troca);
- skills e regras acumuladas → `/sworn:audit`; dúvida se o limiar de troca de chat serve →
  `/sworn:calibrate`;
- correção do dono que vale para as próximas vezes → `/sworn:learn`.

## 4. O padrão AAA

O rito de qualidade máxima. Quatro mecanismos, nesta ordem.

### 4.1 A referência é nomeada, nunca o gosto do agente

O padrão de comparação é o par declarado no adaptador:

- os **valores literais** do design system ou do contrato do projeto — `{{texto:reguaDeComparacao}}`;
- o **artefato irmão de melhor acabamento já aprovado** — `{{texto:artefatoDeReferencia}}`.

Nenhum inspetor julga por "acho bonito". Julga contra esses dois, citando o valor ou o artefato.
**Se o projeto não declarou nenhum dos dois, dizer isso** — e a lente 1 passa a responder só o que dá
para responder sem régua: consistência interna. Não inventar uma régua.

**A referência de topo, nomeada antes de começar.** Na marcha AAA, antes de fazer, nomeie a melhor peça
que existe para este tipo de entrega, no mercado ou no próprio projeto. Ela tem de ser algo que se abre
(arquivo, print, repositório), nunca uma lembrança. O projeto a declara em `referencias`, no
`projeto.json`, por tipo (`tela`, `codigo`, `texto`), e o `/sworn:review` a põe no pacote cego (as
cópias A e B, sem dizer qual é o novo) como `R.txt`, o arquivo com o texto dela. Cada lente julga duas
vezes: na ordem normal e numa 2ª passada com A e B trocados, e contra a referência só vale o que se repete
nas duas. Pronto, contra ela, é empatar ou vencer em cada lente,
nas duas ordens, sem lacuna P0/P1. Sem referência que se abra, ofereça o `/sworn:reference`: ele
estuda os líderes do mesmo tipo e, com o sim do dono, grava a ficha em `referencias`. Se não couber agora,
diga "sem referência" e use o artefato irmão acima.

### 4.2 Lentes distintas, não inspetores repetidos

Mandar vários inspetores ao mesmo tempo (o *fan-out*) usa **lentes diferentes**, uma por inspetor.
Cópias do mesmo revisor encontram o mesmo problema várias vezes; lentes distintas encontram classes distintas de problema. São duas famílias,
que convivem e não se fundem: as **dez lentes de código**, em `LENTES`, e as **oito lentes de
tela**, abaixo, em `LENTES_UI`, as duas listas em `scripts/lib/veredito.js` do plugin. Quais vão
depende do que a mudança toca: só código, as dez de código; só tela, as oito de tela; código e
tela, as duas famílias; na dúvida, as duas. É a regra do `/sworn:review`, na tabela do Passo 2
de `skills/review/SKILL.md`. Antes da família vem a faixa: mudança pequena vai a menos inspetores, pelo
tamanho do diff, na outra tabela do mesmo Passo 2.

1. Fidelidade ao design system
2. Estados obrigatórios
3. Responsividade e overflow
4. Acessibilidade
5. Microcopy
6. Anti-referências visuais
7. Correção e regressão
8. Governança e segurança

Critérios, corte de severidade e quais lentes se aplicam a cada tipo de mudança:
[02-rubrica-aaa.md](references/02-rubrica-aaa.md).

### 4.3 Julgamento cego

Os artefatos vão ao inspetor rotulados **A** e **B**, sem autoria e sem ordem. Ele não sabe qual é o
"antes", qual é o "depois", nem qual saiu do agente que o despachou.

**Regra anti-teatro:** inspetor que só elogia é inspetor inválido. Todo veredito cita `arquivo:linha`
ou coordenada e viewport do print. Sem evidência citada, o voto não conta.

**Artefato íntegro antes de cegar.** Fatia que corta função no meio faz o inspetor reportar o corte
como defeito, e contamina a ronda. Entregar arquivo inteiro; fatiar só em fronteira de função.

**A cegueira é parcial.** Contagem de linhas e comentário de correção entregam qual lado é o novo.
Por isso o placar A/B é sinal, e o **achado com `arquivo:linha` é a prova**.

**O inspetor não abre o código vivo do repositório — mas PODE e deve ler os documentos de
referência.** Abrir o arquivo em disco revela qual variante está lá e invalida o veredito; ler a
régua declarada é o que torna o veredito verificável. E quando a fonte de referência estiver
congelada de propósito, **avisar**, senão o inspetor reporta a defasagem como defeito.

Montagem do loop, forma de cegar e script de referência:
[03-inspecao-cega.md](references/03-inspecao-cega.md).

### 4.4 Convergência com teto

- **Ronda seca** = zero achado **novo** de severidade P1 ou acima. Achado repetido com a mesma
  evidência não molha a ronda.
- **Duas rondas secas seguidas** → aprovado.
- **Ronda 1 descobre; as seguintes verificam.** Ronda 2+ chama só as lentes que acharam P0/P1 contra
  o próprio trabalho, com brief reformulado em pergunta específica. Ordem de grandeza: 8 → 4 → 2.
- **Teto de 3 rondas.** Chegou na terceira com P0 ou P1 aberto: **para**, leva a `{{campo:quemDecide}}`
  com três opções, e o que sobrou vira registro em `{{texto:ondeRegistrar}}`.
- **Conserto que quebra o conserto anterior é sinal de desenho, não de descuido.** Se o achado da
  ronda N atinge a correção feita na ronda N-1, **parar de remendar**: rodar uma varredura
  adversarial única sobre a causa antes de escrever mais conserto. Remendo em cima de remendo é como
  um rito de 3 rondas vira um de 12.

Severidade:

| Nível | Significado | Efeito |
|---|---|---|
| **P0** | Quebra função, vaza segredo, overflow visível, contraste ilegível, permissão violada | Bloqueia a entrega |
| **P1** | Estado obrigatório ausente, valor fora da régua declarada, microcopy fora do padrão, regressão de contrato | Bloqueia o release |
| **P2** | Melhoria real, fora do escopo do pedido | Vira registro, **não** vira correção |

Declarar sempre quantos agentes rodaram por ronda. Custo é informação, não detalhe.

## 5. Guarda-corpos invioláveis

Esta é a seção que impede o rigor de virar estrago. **Ela vence qualquer impulso de "deixar
perfeito".**

- **AAA é a qualidade do que foi pedido, nunca a ampliação do pedido.** O escopo é do usuário.
- **Achado fora de escopo é registrado, não corrigido** — em `{{texto:ondeRegistrar}}`.
- **Sem refatoração oportunista.** Menor diff seguro. Preservar nomes, IDs, chaves de armazenamento e
  ordem de carga.
- **Não apagar nem reverter trabalho do usuário** sem pedido explícito. Arquivo obsoleto **nunca é
  removido: é aposentado**, com uma linha dizendo data, origem e motivo.
  **Antes de mover, três conferências:** (1) `git status` nos repos envolvidos — arquivo de outra
  frente não se move; (2) o plano em execução não referencia o caminho; (3) contagem de arquivos
  antes e depois, colada na resposta. Pasta fora do git não tem rede de proteção: `mv` sempre, `rm`
  nunca — **exceto a pasta de origem que ficou vazia por causa do próprio `mv`**. Usar `rmdir`, nunca
  `rm -r`: se não estiver vazia o comando falha, e essa falha **é** a rede de proteção. Aposentar
  projeto inteiro ou backup é decisão de `{{campo:quemDecide}}`.
- **Arquivo já modificado no `git status` é de outra frente.** Rodar `git status --short` antes de
  editar, não tocar no que já aparece modificado, e reconferir no fecho. Ver Passo -1 em
  [01-marchas-e-gates.md](references/01-marchas-e-gates.md).
- **Não tocar no que o projeto declarou intocável** — `{{campo:intocaveis}}`.
- **Nunca subir baseline de catraca** para o teste passar. Remover a causa é a saída; subir baseline
  é decisão humana registrada.
- **Sem commit, push ou release sem pedido explícito.**
- **Nenhuma mudança de segurança não solicitada** quando o projeto declarou o risco como aceito
  (`{{campo:modeloDeAmeaca}}`). Em projeto público, ou que **seja** um mecanismo de segurança, esta
  regra se inverte — por isso ela é fatia, não texto fixo: `{{texto:guardaCorposDoProjeto}}`.
- **"Perfeito" jamais justifica diff maior que o necessário.**

Se o rito AAA e um guarda-corpo colidirem, vence o guarda-corpo — e o conflito vira uma decisão no
formato da §7.

**Regra que se descumpre por rotina é defeito da regra.** Se um portão vem sendo quebrado com
registro repetidas vezes, o problema deixou de ser disciplina e passou a ser calibragem: levar a
`{{campo:quemDecide}}` com três opções, em vez de quebrar uma terceira vez.

## 6. Saúde de contexto e troca de chat

Com o modo contínuo ligado (a abertura da sessão diz se está), valem só os gatilhos do parágrafo
"Modo contínuo", mais abaixo.

O desvio começa quando o plano passa a ser executado de memória. Gatilhos **contáveis** — basta
**um**:

- fechou uma etapa ou onda do plano com commit;
- vai abrir etapa nova que dependa de reler o plano;
- 2 ou mais tarefas com revisão independente fechadas nesta conversa;
- 3 ou mais decisões do dono registradas nesta conversa;
- 2 ou mais erros próprios de medição ou instrumento na mesma conversa;
- a conversa passou de 175 mil tokens de contexto (o fim de turno do plugin mede e avisa, só no fim
  de turno, nunca no meio da tarefa; acima de 450 mil sai um alarme firme, uma vez);
- qualquer incidente que exigiu cirurgia (histórico git, ambiente, sessão concorrente);
- você conseguiria responder sobre o plano sem reabri-lo;
- o usuário perguntou se o contexto está bom — a pergunta **é** a resposta.

**Disparou? Na mesma resposta, sem esperar pedido:**

1. dizer com todas as letras que é hora de abrir chat novo, citando qual gatilho disparou;
2. **colar o prompt pronto no chat, em bloco de código** — não basta gravar no arquivo;
3. **não perguntar "sigo?" antes de oferecer a troca.** A troca vem primeiro.

Handoff em `{{texto:ondeHandoff}}`. Conteúdo obrigatório em
[05-governanca.md](references/05-governanca.md).

**Se surgiu a dúvida "já é hora?", já era.**

**Sempre: validar pelo próprio agente antes de pedir ação manual.** Rodar o teste, abrir o navegador
(Claude in Chrome ou CDP), ler o resultado. Pedir a `{{campo:quemDecide}}` só o que só ele pode —
credencial, publicar ou implantar, tela com dado de cliente no login dele — e juntar tudo num pedido só.

**Aviso ou dica que um gancho põe na conversa tem teto:** sai uma vez por sessão, ou só a cada N vezes,
nunca a cada chamada — cada repetição volta inteira ao contexto e disputa atenção com o que importa.
O que já se repete, o `/sworn:audit` mostra (item 1c).

**Modo contínuo (chave `modoContinuo` no `projeto.json`).** Ligado por padrão: só o booleano `false`
desliga; sem a chave, com outro valor ou sem o arquivo, fica ligado. A abertura da sessão diz se está ligado. Ligado, só quatro
coisas pedem troca de chat: o tamanho da conversa (o aviso dos 250 mil, no lugar dos 175 mil, e o
alarme dos 450 mil); o
aviso de bloqueios de portão, que o plugin dá no fim de turno quando a sessão chega ao limiar (6 por
padrão; um bloqueio só não pede); o incidente que exigiu cirurgia; e a pergunta do usuário sobre o
contexto. Deixam de pedir troca de chat os outros gatilhos da lista, a dúvida "já é hora?" e os
contadores do plugin (revisões fechadas, decisões do dono, commits, turnos com trabalho e arquivos
tocados), que nem chegam a avisar. O "Disparou?" segue valendo para os gatilhos que ficam, e o
"Sempre" não muda. Em troca: reler o trecho do plano no arquivo antes de cada subitem; escolha técnica
dentro do escopo se decide, se registra com o motivo e se lista no fecho; ao dono vai só o
irreversível, o externo (publicar, push, envio), credencial, permissão ou segurança, o de custo e o de
produto, no formato da §7.

## 6-bis. Trabalho em paralelo

Agente rodando em segundo plano não é motivo para parar. A versão curta desta regra também sai na
abertura de toda sessão; desligar: `"paralelismo": false` no `projeto.json`.

- **Disparou agente em segundo plano? Siga com a próxima tarefa que não depende dele.** Espere só
  quando a próxima tarefa precisar do resultado. Dependência real é o único motivo para esperar.
- **Dois ou mais agentes editando ao mesmo tempo: cada um isolado** (`isolation: worktree`), senão um
  sobrescreve o outro. Agente que só lê não precisa de isolamento.
- **Relatório de agente é alegação**, não fato: confira o crítico na fonte antes de dar por pronto.
- **Freio de custo:** o modelo mais barato que resolve a tarefa (o mapa de modelos do projeto manda);
  no máximo 8 agentes por disparo. Rigor continua sendo eixo separado do custo.
- **3 ou mais tarefas independentes: rode o `/sworn:parallel` direto**, sem perguntar, e diga numa
  linha quantos agentes, qual modelo e o custo aproximado. O Claude Code só roda workflow com
  pedido: a autorização dada uma vez no `/sworn:init` é esse pedido; se ainda assim a ferramenta
  recusar, diga ao dono em vez de contornar. Chamada: a ferramenta Workflow com `name: "sworn:parallel"` e
  `args` = lista de tarefas (`[{"tarefa": "...", "edita": false}]`). Ele aplica o freio sozinho: 8 por
  disparo (diz quais ficaram de fora), Haiku para quem só lê, Sonnet para quem edita, isolamento para
  quem edita, e devolve cada resultado com a evidência que o agente colou.

## 7. Como pedir decisão ao dono

Toda decisão que é de `{{campo:quemDecide}}`: **exatamente 3 opções (a, b, c)**, via
`AskUserQuestion` quando o harness oferecer.

- Recomendada **em primeiro lugar** e marcada como tal.
- Cada opção diz **o que acontece na prática** — consequência, não descrição.
- Custo declarado quando houver: dinheiro, tempo, risco, retrabalho.
- Linguagem simples. Ele não precisa reconstruir o raciocínio técnico para escolher.
- **Não decidir sozinho** o que é escolha dele, e não esconder a escolha dentro de um parágrafo.

Decisão tomada vai para `{{texto:ondeRegistrar}}` com data, na forma "não perguntar de novo".

**O tamanho de cada opção:** continuam três opções, a recomendada em primeiro lugar e marcada. Cada
opção cabe em uma ou duas frases, com a consequência prática e o custo dentro, nessa ordem — não a
reconstrução do raciocínio técnico que levou até ela. Mais que duas frases é sinal de que a opção
esconde duas escolhas, e elas se separam. Encurtar a forma nunca afrouxa a exigência.

**Escolha visual: mostre a imagem antes de perguntar.** Opção descrita em texto não comunica o que se
vê, e a escolha feita sem ter visto vira retrabalho no dia seguinte. Envie primeiro a imagem (antes ×
proposta × referência, ou um mock fotografado com a folha real), **espere o envio confirmar** e só no
turno seguinte faça as 3 opções, dizendo numa frase o que a recomendada **não** vai mudar. Se a tela
mostra número, declare se a veracidade do dado foi conferida.

**O meio preferido é uma página Artifact** (página privada no claude.ai, que você publica e o dono
abre pelo link), quando a sessão tiver a ferramenta: antes × proposta × referência lado a lado, em
claro e escuro, nas larguras de tela que o projeto declara (sem declaração, as que o produto
comprovadamente atende, ditas na página: a de notebook, e a de celular só se ele roda em celular —
largura que ele não atende gera achado falso), para o dono ver, comentar e pedir ajuste antes de
você mexer no produto. O rito é o da
imagem: publique, espere o link confirmar e só no turno seguinte faça as 3 opções. Sem a
ferramenta, a imagem de sempre. A página sai do computador do dono: só dado fictício. Se a tela tem
dado de cliente ou credencial, troque por dado fictício antes de publicar, ou fique na imagem local.

**Ação manual do dono é passo a passo clique a clique.** Quando a entrega exigir que ele mexa em
console, painel, planilha ou navegador: numerar os passos, dizer **o que ele vai ver em cada tela**
(não só o que fazer), dar o texto exato de botões e campos, dizer o resultado esperado de cada passo
para ele conferir antes de seguir, e avisar quando uma tela de autorização for aparecer. Nunca supor
que ele sabe onde fica algo. Isso é diferente do formato de decisão acima, e os dois valem juntos.

## 8. O que um "pronto" precisa ter

- **Evidência fresca da rodada atual, colada na resposta.** Memória não é evidência.
- **O que não rodou, declarado como não rodado.** Silêncio sobre um teste equivale a mentir que
  passou.
- **Cada pedido ligado à checagem que o prova, com o estado dela:** provado (com a saída), falhou ou
  não testado. Sem evidência o item é "não testado", nunca entregue; comando que falhou, expirou ou
  não rodou não verificou nada.
- **Teste instável se corrige ou se remove, nunca se repete até passar.** Rodar de novo até sair
  verde não é prova.
- Arquivos alterados, listados.
- Riscos remanescentes e o que precisa de humano.
- Se um subitem ficou pendente, a etapa está **aberta** — não "completa com ressalva".

Nunca reportar sucesso sem ter olhado a saída. Se o teste falhou, dizer que falhou, com a saída.

**Conclusão primeiro, detalhe depois.** Cobertura não é clareza: quando tabela, medição e ressalva
saem todas de uma vez, o ponto principal fica do mesmo tamanho que o secundário e o dono tem de
garimpar. Abrir com a resposta direta em uma ou duas frases; a evidência serve para ele **conferir**,
não para ele descobrir a resposta. Isso **não** afrouxa a exigência de evidência colada — muda o
tamanho da prosa em volta dela, não a prova. A forma enxuta disso — conclusão na primeira
linha e bloco de saída reduzido à linha que prova — está no bloco de qualidade de resposta que a abertura
da sessão injeta (regras 1 e 5).

**Relatório de subagente é alegação, não fato.** E medição própria vence parecer de lente, mesmo
parecer caro, mesmo marcado P0 — ver a regra do medidor em
[04-verificacao.md](references/04-verificacao.md).

## 9. Referências

| Arquivo | Quando ler |
|---|---|
| [01-marchas-e-gates.md](references/01-marchas-e-gates.md) | ao classificar a tarefa e montar os portões |
| [02-rubrica-aaa.md](references/02-rubrica-aaa.md) | ao inspecionar qualquer coisa visível ao usuário |
| [03-inspecao-cega.md](references/03-inspecao-cega.md) | ao montar o loop de inspetores |
| [04-verificacao.md](references/04-verificacao.md) | ao rodar teste, medir qualquer coisa, ou provar um pronto |
| [05-governanca.md](references/05-governanca.md) | ao registrar decisão, escrever doc, fazer handoff ou release |
| [06-ambiente.md](references/06-ambiente.md) | ao escrever script, hook, ou mexer no índice do git |
