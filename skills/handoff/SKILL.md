---
name: handoff
description: Gera o texto de continuacao para um chat novo, com tudo que o proximo precisa para continuar exatamente de onde parou. Use quando um gatilho contavel de saude de contexto disparar, quando fechar uma etapa de plano longo, ou quando o usuario pedir.
argument-hint: "[nome curto do trabalho]"
---

# `/sworn:handoff` — a ponte entre chats

O desvio começa quando o plano passa a ser executado de memória. **Handoff é ponte entre chats, não
substituto do plano.**

**Chat novo que partiu de um resumo** (`handoff/AAAA-MM-DD-retomar-<id>.md`, gravado pelo aviso de volta a chat
parado): o resumo é um retrato mecânico do registro do chat antigo, não este handoff. Leia-o, confira no disco o que
ele diz (passo 1) e, se o trabalho pede ponte completa, escreva o handoff aqui, no chat novo — nunca no chat parado,
que regravaria a conversa inteira.

## Passo 1 — conferir os fatos no disco, não na memória

Rode, e cole a saída:

    git -C . rev-parse HEAD
    git -C . rev-parse --abbrev-ref HEAD
    git -C . status --short
    node "${CLAUDE_PLUGIN_ROOT}/scripts/uso.js"

**Número que vai para o handoff se lê do disco.** Nunca do handoff anterior, e nunca de memória.

## Passo 2 — escrever o arquivo

Em `.claude/sworn/handoff/AAAA-MM-DD-<slug>.md`, com **todas** estas seções:

1. **Ordem de leitura** — caminho absoluto do plano, do ledger e do handoff anterior, na ordem.
2. **Topologia** — cada repositório envolvido, com branch e **SHA do HEAD**, colados do passo 1.
3. **Onde estamos** — em que etapa do plano, e qual é a próxima, **com o texto da etapa conferido no
   arquivo**, não parafraseado. Com estudo em andamento, o caminho de cada ficha: a do radar
   (`.claude/sworn/radar/<AAAA-MM-DD>.md`) e a de referência (`.claude/sworn/referencias/`), e se ela
   já entrou em `referencias` ou espera o sim do dono — senão o chat novo estuda tudo de novo.
4. **Decisões humanas já tomadas** — na forma "não perguntar de novo", com a data.
5. **Pendências e bloqueios que NÃO são achado desta sessão** — falha pré-existente é isto, e sem
   esta seção o próximo chat vai "descobrir" e perder tempo. **Pendência não fica arrastada de handoff
   em handoff**: lista que só cresce não tem dono. Antes do prompt, leve cada pendência nova ao dono,
   juntas e em 3 opções, e escreva aqui só o que já foi decidido ou o que tem dono e lugar declarados.
6. **Erros de método que custaram tempo** — para não se repetirem.
7. **Arquivos de terceiros deixados intocados** — do `git status` do passo 1.
8. **Prompt pronto para colar**, em bloco de código.

**Nunca inclua segredo, credencial ou dado de cliente.**

Se a sessão trabalha num plano, deixe o painel do plano (`/sworn-plan`) achá-lo no chat novo:

- no fim do **Objetivo** do escopo em vigor (o arquivo da frente em `.claude/sworn/escopos/`, ou
  `.claude/sworn/escopo.md` sem frente), a linha `Plano: <caminho do plano>`, com o caminho entre
  crases se tiver espaço. Plano novo: troque o `Plano:` antigo, não acrescente outro;
- em cada caixa que esta sessão marcar no plano, a marca dela: `- [x] passo (sN: o que foi feito)`. Caixa
  marcada por sessão anterior não recebe o N desta. As sessões gastas e a estimativa do painel saem dessas
  marcas. **O N da sessão:** se ela já gravou a sua nota `(sessao N, ...)` no Objetivo, é o N dessa nota. Se
  ainda não gravou, leia o disco: o maior número já usado entre as notas do Objetivo do escopo em vigor e as
  marcas `(sN` do plano, mais 1 (1 se não há nenhum); grave a nota com ele antes de marcar caixas ou linhas
  de tabela. A nota e todas as marcas da sessão, em caixa ou em linha de tabela, levam esse N.
  Duas sessões abertas ao mesmo tempo podem chegar ao mesmo N: ao gravar a nota, se o N já está na nota
  de outra sessão, use o seguinte. O painel conta os N distintos: número pulado não muda a conta, e
  sessão que não deixou marca não entra nela;
- plano com as etapas numa tabela (1ª coluna `Etapa`, `Fase`, `Item`...): na etapa que a sessão fechou,
  `[FEITO]` na 1ª célula, depois do id copiado da tabela (`| **P2 motor** [FEITO] | ...`), e a marca da
  sessão `(sN: o que foi feito)` na última célula da mesma linha. Sem nenhuma marca na tabela, o painel
  deduz pela `ETAPA <id>` do Objetivo (as anteriores feitas, ela em curso) e avisa que deduziu; a 1ª marca
  `[FEITO]` encerra a dedução, então, ao pôr a primeira, ponha `[FEITO]` também em cada etapa anterior já
  feita, senão o painel passa a dá-las como não feitas. Nessas anteriores, quando as notas do Objetivo
  dizem qual sessão as fechou, ponha também a marca dela, com o N dela (`(s3: o que foi feito)`); sem
  marca, a etapa conta como feita, mas a sessão que a fechou fica fora das sessões gastas.

## Passo 3 — oferecer a troca, na mesma resposta

Não basta gerar o arquivo. Na **mesma resposta**:

1. diga com todas as letras que é hora de abrir chat novo, **citando qual gatilho disparou**;
2. **cole o prompt pronto no chat, em bloco de código** — o usuário tem de copiar sem abrir nada;
3. **não pergunte "sigo?" antes de oferecer a troca.** A troca vem primeiro; se ele preferir
   continuar, ele diz.
