---
name: calibrate
description: Mede, nas conversas do proprio projeto, a partir de quantos tokens de contexto trocar de chat ainda compensa, e sugere o limiar de troca. So grava no projeto.json com o sim explicito do dono. Use quando o dono perguntar se o limiar de troca de chat serve para este projeto, ou depois de algumas semanas de uso.
---

# `/sworn:calibrate` — o limiar de troca medido no seu projeto

O aviso de troca de chat por tamanho sai a 175 mil tokens (o padrão). Esse número foi medido nas conversas de
um projeto só (as sessões do autor do plugin). Esta skill mede o **seu**: lê as transcrições que o Claude Code guarda
deste projeto, calcula quanto custa cada faixa de contexto, quanto custa uma troca aqui, e simula a
troca no fim do turno do dono para cada limiar de 150 mil até abaixo do alarme.

**Só números saem do script.** Ele lê o texto das conversas para contar, mas nenhum trecho vai à
saída. Mesmo assim, não cole a saída fora desta conversa sem o dono pedir.

## Passo 1 — medir

    node "${CLAUDE_PLUGIN_ROOT}/scripts/calibrar.js"

Rode da pasta do projeto. O script procura as transcrições em `projects/` da pasta de configuração
do Claude Code. Se não achar, sai com `erro` e pede o caminho: a pasta é a que tem os arquivos
`.jsonl` deste projeto, dentro de `~/.claude/projects/` (ou de `projects/` em `CLAUDE_CONFIG_DIR`, se
ele estiver definido), com o caminho do projeto no nome; diga isso ao dono, pergunte qual é e rode de
novo com `--pasta "<caminho>"`. Se vier `erro` outra vez, ou uma saída que não seja JSON, mostre ao
dono, diga que a calibração não roda sem as transcrições deste projeto e que ele pode conferir o caminho
e chamar `/sworn:calibrate` de novo; e pare. Não leia nem abra os `.jsonl` você mesmo: eles podem ter muitos megabytes.

## Passo 2 — apresentar, nesta ordem

1. **A amostra:** quantas sessões, de que data a que data, e quanto custaram no total.
2. **A sugestão** (`sugestao`): o limiar e o motivo. Se `suficiente` vier `false`, diga com todas as
   letras que a amostra é pequena e que o limiar atual fica; mostre o motivo que o script deu, não
   proponha gravar nada e diga que vale rodar de novo depois de mais algumas semanas de uso.
3. **Por que esse número:** a linha da `simulacao` do limiar sugerido e as duas vizinhas.
   `pctDoCusto` negativo é economia contra nunca trocar; positivo, gasto a mais. A regra da
   sugestão é o menor limiar em que trocar não sai mais caro que não trocar.
4. **Quanto custa trocar aqui** (`troca`): se `medida` vier `false`, o custo é o padrão do plugin,
   medido pelo autor (o projeto ainda não tem trocas suficientes para medir o próprio) — diga isso.
5. **Onde o trabalho para** (`paradas`), só se o dono quiser: a última fala do agente antes de cada
   resposta do dono, por tipo. É o número que o modo contínuo quer baixar.

## Passo 3 — gravar só com o sim do dono

O `limiarAtual` é o que vale hoje, e `limiarAtualDe` diz de onde ele vem: `projeto.json` (gravado),
`modo continuo` (o aviso a 250 mil do modo contínuo ligado) ou `padrao do plugin`; diga a origem junto do
número. Se a sugestão for igual ao `limiarAtual`, diga que o limiar atual já é o medido e que não há o que
gravar. Se for diferente e a amostra for suficiente, leve a decisão ao dono em três opções, a
recomendada primeiro: gravar a sugestão; manter o limiar atual; outro número que ele escolha. Só depois
do sim explícito, grave **pelo comando**, passando só o número inteiro ("200 mil" vira `200000`):

    node "${CLAUDE_PLUGIN_ROOT}/scripts/calibrar.js" --gravar <tokens>

"Manter" também se grava, com `--manter` no lugar de `--gravar <tokens>`: o comando grava o limiar em
vigor (a saída traz `manteve: true`). Sem isso, o projeto segue "nunca calibrado" e o botão de calibrar
volta a cada chat.

O comando aceita de 50000 até abaixo do alarme, mexe só em `limiares.tokensDeContexto` e preserva o
resto do `projeto.json`. Diga que gravou só quando a saída trouxer `gravou: true`. Se o comando
recusar o número, mostre o `erro` ao dono (ele diz a faixa aceita) e peça outro número uma vez; recusado
de novo, diga a faixa, diga que o limiar atual fica, e pare. Se o comando falhar por
outro motivo (sem `projeto.json`, JSON inválido) ou a saída não for JSON, mostre o `erro` e o que ele
manda corrigir, e pare. **Nunca pelo `Write`:** o portão de escopo (a
trava 4) nega gravar em `.claude/sworn/projeto.json` sem escopo declarado, e editar JSON à mão é o
jeito frágil.

## O que esta medição NÃO faz

- **Não mede qualidade.** Ela conta dinheiro. Conversa longa pode desviar do plano sem custar mais.
- **Não vê subagente.** Só a conversa principal entra na conta.
- **Não conhece modelo fora da tabela de preço.** As chamadas desses modelos ficam de fora e aparecem
  em `chamadasSemPreco`.
