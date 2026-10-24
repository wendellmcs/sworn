# Rubrica AAA — as oito lentes de tela

Uma lente por inspetor. Cada inspetor responde **a pergunta da sua lente**, cita **evidência
obrigatória**, e classifica cada achado em P0 / P1 / P2.

**Regra que vale para as oito:** achado que não cita `arquivo:linha` ou `viewport + coordenada do
print` não é achado. É opinião, e não conta no veredito.

**Como este arquivo funciona.** A *pergunta* e o *corte de severidade* de cada lente são universais e
estão escritos aqui. Os *valores* contra os quais se compara são do projeto e entram por fatia. Lente
cuja fatia está vazia **diz que está vazia** e julga só consistência interna — nunca inventa a régua.

---

## Lente 1 — Fidelidade ao design system

**Pergunta:** todo valor visual usado existe na régua declarada, ou foi inventado?

**Régua:** `{{texto:reguaDeComparacao}}`. Para ser utilizável, ela precisa enumerar, com valores
literais: **cores** (ação, neutros, semânticos) · **raios** · **espaçamentos** · **escalas
tipográficas** (família, tamanho, peso, altura de linha) · **sombras nomeadas** · **medidas fixas**
recorrentes. Qualquer valor fora dessas listas é achado.

**Princípios que costumam acompanhar uma régua** — confirmar quais valem aqui, não presumir:

- **cor de ação tem significado**: a cor primária marca ação, estado ativo, foco ou seleção; em
  decoração, ela se remove;
- **contraste antes de elegância**: texto e placeholder legíveis antes de sutis;
- **estado semântico é só estado**: as cores de sucesso/aviso/erro/informação nunca viram categoria
  nem decoração;
- **escala de produto**: tipografia fixa, não fluida por viewport, quando o produto é denso;
- **elevação tem vocabulário fechado**: sombra só onde a régua manda (modal, dropdown, foco, hover
  real); superfície em repouso usa borda ou tom.

**P0:** contraste ilegível. **P1:** valor inventado, sombra fora do vocabulário, cor de ação usada
como decoração. **P2:** valor válido porém inconsistente com o artefato de referência.

---

## Lente 2 — Estados obrigatórios

**Pergunta:** todo controle e toda região com dados tem os estados que precisa, ou só o caminho feliz?

**Checklist (universal):** default · hover · focus-visible · disabled (opacidade reduzida mas ainda
legível) · loading/busy (marcado semanticamente, cliques repetidos bloqueados) · error · empty ·
selected.

**Regras de conteúdo dos estados:**

- **Erro** declara a fonte, a categoria da causa e a **próxima ação segura**. Erro genérico é achado.
- **Vazio** explica qual fonte ou filtro está faltando. Vazio silencioso é achado.
- **Loading** usa skeleton ou progresso local quando o conteúdo tem forma conhecida.
- **Sucesso parcial é estado de primeira classe** — quando o dado vem de várias fontes e uma falha,
  isso nunca colapsa em erro genérico.

**Evidência dos estados:** o componente visto sozinho, com todos os estados da checklist lado a lado
— a página dele no catálogo de componentes do projeto, se houver um; sem catálogo, uma página de
estados montada para a revisão (pode ser a página Artifact da escolha visual). Estado que só aparece
navegando o fluxo inteiro passa despercebido.

**P0:** ação assíncrona sem loading que permite clique duplo destrutivo. **P1:** qualquer estado da
checklist ausente, ou erro/vazio sem a informação exigida. **P2:** estado presente mas com microcopy
melhorável.

---

## Lente 3 — Responsividade e overflow

**Pergunta:** algum valor operacional vaza, ou algum layout quebra, em algum dos viewports?

**Viewports obrigatórios:** `{{texto:viewports}}`. Sem essa fatia, testar os que o projeto
comprovadamente suporta — e **dizer quais foram testados**. Inventar um viewport que o produto não
atende gera achado falso; omitir um que ele atende deixa passar bug real.

**Verificar:** `min-width: 0` nos filhos de flex/grid; wrap, truncate ou scroll **intencional** para
e-mail, domínio, protocolo, JSON, comando, nome longo, chip e botão; layout multi-coluna colapsando
estruturalmente no **ponto de colapso declarado** — `{{texto:pontoDeColapso}}`; dropdown fora de
contexto com overflow clipado (ou `fixed`/portal/nativo).

**Sem ponto de colapso declarado, a lente não se cala: cobra colapso abaixo de tablet
(`max-width: 768px`) e diz no parecer que usou o padrão.** Fatia vazia autoriza declarar a ausência;
nunca autoriza abandonar a verificação. Medido em 2026-08-17: com o critério escrito como *"no ponto
declarado"* e nenhum ponto declarado no adaptador, o inspetor deixou passar um cabeçalho de duas
colunas que não colapsa nem no menor viewport suportado — a régua que trazia o critério concreto pegou
o mesmo defeito. **Critério sem valor não é critério.**

**Overflow de valor operacional é bug de design, não detalhe.**

**P0:** overflow visível ou conteúdo inacessível em qualquer viewport da lista. **P1:** scroll
horizontal no body, colapso que esconde controle. **P2:** densidade fora do padrão do artefato de
referência.

---

## Lente 4 — Acessibilidade

**Pergunta:** funciona por teclado e é percebível sem depender de cor?

**Checklist (universal):** WCAG AA prático no contraste · foco **visível** (nunca apenas remover o
outline nativo; se a régua nomeia um anel de foco, é ele) · todo controle alcançável e operável por
teclado · rótulo acessível ou semântica nativa onde o elemento não é autoexplicativo · status
**nunca** só por cor (ícone, texto ou forma junto) · movimento curto, guiado por estado, respeitando
`prefers-reduced-motion` · alvos dimensionados para uso repetido, e no mínimo **24 × 24 px** (WCAG
2.2, critério 2.5.8, nível AA), salvo as exceções do critério: alvo menor cujo círculo de 24 px de
diâmetro, centrado nele, não cruza outro alvo nem o círculo de outro alvo menor; link dentro de
frase; a mesma função em outro controle da página que cumpre os 24 px; tamanho decidido pelo
navegador, sem estilo do autor; ou tamanho essencial para a informação.

**"Status só por cor" tem exemplo literal, e ele é P0.** Um badge, ponto, bolinha, barra ou célula
**sem texto e sem rótulo acessível**, distinguido apenas pela cor de fundo, **é** status só por cor.
Isso é **P0** — não é P1 de "rótulo acessível ausente". A pergunta que decide: *se a cor for removida,
sobra alguma informação?* Se não sobra, é P0.

> Medido em 2026-08-17: sem esse exemplo escrito, **dois inspetores independentes** acharam os dois
> badges vazios coloridos e classificaram os dois como P1 de rótulo ausente. As duas réguas já
> mandavam P0 para "status nunca só por cor" — e as duas foram rebaixadas na aplicação. Regra sem
> exemplo é regra que se aplica errado.

**"Seleção só por classe" também é achado, e a pergunta que decide é a mesma.** Aba, chip, item de
lista ou botão de segmento cujo estado *selecionado* existe apenas como classe de estilo (`.active`,
`.selected`), sem nada que exponha esse estado à camada de acessibilidade, **é P1** — quem usa leitor
de tela ouve o item selecionado exatamente igual aos outros. Vira **P0** quando, tirando a cor, nada
distingue o selecionado do não selecionado. **Não vale** quando o controle nativo já carrega o
estado; aí exigir atributo extra é falso positivo.

> Medido em 2026-08-17: num projeto real, a aba ativa de um modal marcava seleção só pela classe
> `active`, e o estilo dessa classe mudava apenas fundo, cor e borda. **14 inspetores cegos**
> passaram por essa aba e nenhum abriu achado — nenhuma das duas réguas medidas nomeava o caso.
> Seleção é o estado mais comum de toda interface de abas, e era o único que a lente não citava.

**P0:** foco removido sem substituto, controle inalcançável por teclado, status só por cor.
**P1:** contraste abaixo de AA, rótulo acessível ausente onde a semântica não basta, estado de
seleção só em classe de estilo, alvo abaixo de 24 × 24 px fora das exceções. **P2:** alvo que cumpre
o mínimo mas é pequeno para uso repetido.

---

## Lente 5 — Microcopy

**Pergunta:** o texto é a linguagem que o usuário-alvo deste produto já conhece?

**Checklist:** **rótulos canônicos preservados exatamente** — `{{texto:rotulosCanonicos}}` · tom
consistente com o resto do produto · placeholder descreve o valor esperado · sem jargão de marketing,
sem exclamação, sem tratamento infantilizado · mensagem de erro nomeia a fonte · idioma da interface
uniforme.

**P0:** rótulo canônico alterado. **P1:** idioma trocado no meio da UI, tom fora do padrão,
placeholder decorativo. **P2:** frase melhorável.

---

## Lente 6 — Anti-referências visuais

**Pergunta:** isso parece o que este produto é, ou parece outra categoria de produto?

**O que este produto não pode parecer:** `{{texto:antiReferencias}}`.

Sem essa fatia, a lente pergunta a versão fraca — *"há aqui um sistema visual paralelo ao que já
existe no produto?"* — e **declara que está sem lista**. A lista importa porque ela inverte por
projeto: o que é defeito num painel operacional é requisito numa página de marketing.

Lista de partida para **produto operacional denso**, a confirmar com o dono: decoração card-heavy ·
card aninhado · glassmorphism · gradiente gratuito · movimento ornamental · cantos exagerados · texto
com gradiente · grid de fundo decorativo · ilustração "sketchy" · fundo listrado · template de
hero-metric · borda lateral grossa como decoração genérica de card · layout de landing page.

**P1** para qualquer item da lista declarada. **P2** para deriva sutil de densidade.

---

## Lente 7 — Correção e regressão

**Pergunta:** o que já funcionava continua funcionando?

**Checklist:** a prova de pronto da área passa (`{{campo:provaDePronto}}`) · nomes, IDs e chaves de
armazenamento intactos · ordem de carga e pontos de entrada preservados · dados estruturados
manipulados por parser/API, não por texto frágil · sem refatoração oportunista no diff · nenhuma
mudança em arquivo não relacionado ao objetivo · nada tocado em `{{campo:intocaveis}}` · resposta ao
clique: em tela web, o **INP** (Interaction to Next Paint, o tempo do clique até a tela responder) é
bom até **200 ms** e ruim acima de **500 ms** (web.dev, percentil 75); sem medição, a lente diz que
não mediu, e não presume.

**P0:** regressão funcional, ordem de carga alterada, chave de armazenamento renomeada, intocável
tocado. **P1:** teste falhando, teste removido, INP medido acima de 500 ms. **P2:** dívida técnica
observada, INP medido entre 200 e 500 ms.

---

## Lente 8 — Governança e segurança

**Pergunta:** a permissão e o sigilo continuam corretos?

**Checklist:** a fonte de verdade de permissão do projeto é respeitada · UI restrita **não renderiza**
antes de o acesso efetivo estar confirmado · desligar a permissão esconde a UI **e** bloqueia o
caminho de serviço por trás dela · toda mutação destrutiva passa por confirmação explícita · nenhum
segredo em log, screenshot, captura de rede, relatório, contexto de prompt ou documentação derivada ·
função visível nova atualiza permissões, telas administrativas, ajuda, testes e docs **no mesmo
conjunto de mudanças**.

**P0:** segredo exposto, UI restrita renderizada antes da confirmação, mutação destrutiva sem
confirmação. **P1:** permissão sem espelho nos lugares que a declaram. **P2:** observação de
governança.

**O modelo de ameaça é do projeto, não da lente** — `{{campo:modeloDeAmeaca}}` e
`{{texto:guardaCorposDoProjeto}}`. Em projeto que declarou o risco como aceito, **propor hardening
não solicitado é achado da lente, não mérito dela**. Em projeto público, ou que seja ele próprio um
mecanismo de segurança, a regra se inverte. Ler a fatia antes de julgar.

**Antes de abrir P0 de segurança, três conferências obrigatórias.** Primeiro, os **chamadores reais**,
não o caminho hipotético: se nenhum chega ao estado que você supôs, não há achado. Segundo, **leitura
não é mutação**: o portão de mutação não barrar uma leitura é o desenho, não o defeito. Terceiro,
**desenho deliberado não é falha**: padrão repetido e coerente em todo o módulo é intenção até prova em
contrário. **Sem conseguir confirmar a intenção, o achado nasce P2 com pergunta, nunca P0** — P0
bloqueia a entrega, e bloquear por desenho aprovado é o dano que a lente existe para evitar.

---

## Aplicação por tipo de mudança

| Mudança | Lentes obrigatórias |
|---|---|
| Estilo / layout / componente visual | 1, 2, 3, 4, 6, 7 |
| Texto de UI | 1, 5 |
| Função visível nova | as 8 de tela e as 10 de código |
| Lógica sem UI | as 10 de código |
| Contrato entre sistemas | as 10 de código |
| Release | as 8 de tela e as 10 de código |

Os números 1 a 8 são as lentes de tela desta rubrica. As de código são as do `/sworn:review`,
com a pergunta de cada uma em `LENTES`, em `scripts/lib/veredito.js` do plugin.

**Não rodar as oito quando só quatro se aplicam.** Lente sem objeto devolve parecer vazio, e parecer
vazio contamina o cômputo da ronda.
