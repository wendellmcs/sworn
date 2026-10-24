# Governança, fontes e handoff

---

## 1. Ordem de leitura, antes de alterar qualquer coisa

As fontes concretas e a ordem entre elas são do projeto — `{{campo:fontesCanonicas}}`. O que é
universal é a **forma**:

1. A fonte que o projeto declarou canônica, na ordem em que ele a declarou.
2. Produto e design, quando a tarefa for de UI, UX ou crítica visual.
3. Regra de negócio consolidada.
4. Log de decisões humanas já tomadas.
5. Código atual — que é o último elo, não o primeiro: código mostra o que é, não o que deveria ser.

Confirmar fato com busca no repositório. **Inferência deve ser marcada como inferência**, e afirmação
verificada deve ser marcada como verificada. Um relatório em que as duas se parecem obriga quem lê a
reconferir tudo.

---

## 2. Registro de decisão humana

Confirmada uma decisão com `{{campo:quemDecide}}`, ela vai para `{{texto:ondeRegistrar}}` com:

- **data**;
- o que se perguntou, em uma frase;
- as opções apresentadas e **qual foi escolhida**;
- a consequência aceita, quando houver custo;
- a forma "não perguntar de novo".

**Decisão que quebra uma regra fica registrada como quebra**, não como exceção silenciosa. Quebra
registrada é governança; quebra silenciosa é dívida que ninguém sabe que existe.

**Se a mesma regra vem sendo quebrada por rotina, o defeito é da regra.** Duas quebras registradas da
mesma regra não pedem uma terceira quebra: pedem uma decisão sobre recalibrá-la.

**Ao registrar em documento append-only numerado, ler o último número no disco** — nunca do handoff.
Ver a seção do Passo -1 em [01-marchas-e-gates.md](01-marchas-e-gates.md).

**Decisão anunciada é decisão gravada, na mesma resposta.** Dizer "registrada" sem ter gravado é
perder a decisão: outra frente toma o número, e o chat seguinte conclui que nada aconteceu. O
**ledger é um arquivo só** — fragmento ao lado, em outro formato, é invisível para quem retoma. Ao
retomar, antes de crer em "não rodou", liste a pasta de material por data e procure a prova.

**Toda hora escrita em arquivo vem depois do `date`, e em outro turno.** Rode o `date` sozinho e só na
resposta seguinte escreva o texto com a hora lida. Hora digitada no mesmo comando (ou no mesmo Write)
do `date` é palpite, e palpite de hora erra para frente. Se a hora tiver de entrar num texto grande
escrito antes, deixe um marcador e troque por script depois do `date`.

**Espelho:** se o projeto mantém duas cópias da mesma regra em arquivos diferentes, alterar as duas
no mesmo conjunto de mudanças, e conferir qual das duas é a fonte.

---

## 3. Conjunto de mudanças — "tocou X, tem de ter tocado Y"

A falha mais cara de qualquer projeto com mais de um artefato é a **publicação assimétrica**: um lado
do par sobe e o outro não, e o contrato quebra em produção.

Antes de fechar, conferir os pares que o projeto declarou. As formas mais comuns:

| Forma | Exemplo |
|---|---|
| par atômico entre camadas | tocou o backend → tem de ter tocado o cliente compatível |
| espelho de documento | tocou a fonte → tem de ter tocado a cópia |
| função visível nova | tocou a feature → tem de ter tocado permissões, ajuda, testes e docs |
| ferramenta nova recorrente | tocou a ferramenta → tem de ter documentado onde ela vive |

**Antes de qualquer ação irreversível** (publicar, promover, apagar remoto): salvar a versão anterior
e **registrar o caminho de rollback por escrito**. O gesto é o que costuma faltar, não a intenção.

---

## 4. Higiene documental

- Procurar doc existente **antes** de criar novo. Linkar, não duplicar. E dizer o que se procurou.
- Doc novo declara: objetivo, status, fonte de verdade, relação com os docs existentes, e se é
  canônico / derivado / adaptador / histórico.
- Planos concluídos, auditorias antigas e specs superadas vão para área de arquivo.
- **Não versionar lixo:** log, HAR, screenshot, relatório, zip, cache, temporário, dump, credencial,
  saída de ferramenta.
- Arquivo obsoleto, duplicado ou mal localizado: **não apagar por conta própria.** Registrar em
  `{{texto:ondeRegistrar}}`.
- Ao fechar mudança documental, conferir coerência de índices e links.
- **Regra que aponta para o que não existe mais está mentindo.** Ao mover ou renomear, grepar as
  referências ao caminho antigo. Referência morta é pior que ausência: ela dá confiança falsa.

---

## 5. Planos e handoff

**Plano local:** objetivo, fora de escopo, contexto lido, arquivos prováveis, passos, critérios de
aceite, testes recomendados, riscos e perguntas bloqueantes.

**Handoff** em `{{texto:ondeHandoff}}`. Gatilhos contáveis e a obrigação de oferecer a troca de chat
estão no `SKILL.md` §6. Conteúdo obrigatório:

- caminho absoluto do plano, do ledger e do handoff anterior, **na ordem de leitura**;
- topologia dos repositórios, branch e **SHA do HEAD** de cada um;
- em que etapa do plano estamos e qual é a próxima, com o texto da etapa **conferido no arquivo**;
- decisões humanas já tomadas ("não perguntar de novo");
- pendências, bloqueios e falhas pré-existentes que **não** são achado desta sessão;
- erros de método que custaram tempo, para não se repetirem;
- **prompt pronto para colar, em bloco de código.**

Nunca incluir segredo, credencial ou dado de cliente no handoff.

**Regra dura de plano longo:** reler o trecho do plano **no arquivo** antes de escrever qualquer
brief. Handoff é ponte entre chats, não substitui o plano. Achado no meio do caminho é desvio
temporário: registrar, resolver e **voltar explicitamente ao plano**, dizendo em qual etapa se está
retomando. Adição ao plano não é mudança de plano — não reescrever nem reordenar por causa dela.
Desvio deliberado do texto do plano exige decisão humana registrada. **Etapa só é completa quando
todos os subitens estão feitos** — subitem pendente = etapa aberta.

---

## 6. Ferramentas e dependências

- Skill só quando a tarefa corresponde claramente ao gatilho.
- Biblioteca ou ferramenta adotada: com versão, tag ou commit **fixado**. Sem referência
  reprodutível, não adotar.
- **Nunca `latest`**, nem faixa aberta em manifesto, nem upgrade automático, nem atualização
  silenciosa.
- Atualização revisada por fonte primária (doc oficial, changelog, release, aviso de segurança).
  "Mais recente" não significa "melhor".
- Testar atualização em fase isolada, com testes e rollback, antes de promover.
- Ferramenta recorrente nova: documentar onde o projeto guarda isso, e nos docs de verificação se ela
  afeta como se prova um pronto.

---

## 7. Ambiente

As armadilhas de shell, encoding e índice do git — as que custam sessão inteira quando pegam — estão
em [06-ambiente.md](06-ambiente.md). Ler antes de escrever script, hook, ou mexer no índice.

**Credencial que o classificador de permissão barra não se contorna.** Medição que exige token vivo
(do perfil do navegador, da sessão de quem decide) vira **script pronto, com passo a passo clique a
clique para o dono rodar** — o script imprime o estado (existe ou não) e, no máximo, um prefixo de
hash, **nunca o segredo**. Registre no ledger que a medição ficou com o dono e o que ela decide.
