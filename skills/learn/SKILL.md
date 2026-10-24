---
name: learn
description: Transforma uma correcao do usuario em regra proposta no formato gatilho -> acao, mostra pronta, e so grava depois de aprovacao explicita. Use quando o usuario corrigir o seu comportamento e a correcao valer para as proximas vezes.
argument-hint: "[a correcao, em uma frase]"
---

# `/sworn:learn` — proposta, nunca gravação automática

O plugin **não aprende sozinho.** Ninguém no mercado tem isso, e prometê-lo é promessa que não se
cumpre. O que ele faz é transformar correção em proposta, e esperar o OK.

Motivo do portão, dito sem rodeio: **eu leio correção errado com frequência.** Uma correção mal
entendida gravada sozinha vira lei permanente que passa a me guiar todo dia — e o próprio agente
passaria a escrever o arquivo que o governa.

**Quando esta skill é oferecida sem pedido.** O gancho `abrir-turno.js` (um script que o Claude Code
roda sozinho a cada mensagem do usuário) avisa o agente quando a mensagem parece uma correção ao
comportamento dele. O agente atende o pedido primeiro e, na mesma resposta, roda esta skill e pergunta
em 3 opções (Passo 4): gravar como está, ajustar o texto antes ou não gravar. O gancho nunca grava:
gravar continua exigindo o sim do usuário. No máximo uma oferta a cada 5 turnos; desliga com
`"sugerirAprender": false` em `.claude/sworn/projeto.json`. Se a mensagem era relato de bug ou
resposta a uma pergunta, a oferta se ignora: siga sem rodar a skill, e nada é gravado.

## Passo 1 — separar o que foi corrigido do que eu entendi

Escreva as duas coisas, lado a lado, para o usuário conferir:

- **O que você disse:** <a frase dele, literal>
- **O que eu entendi:** <a sua leitura, em uma frase>

Se as duas não baterem, ele corrige agora e não daqui a um mês.

## Passo 2 — transformar em `gatilho → ação`

Proibição solta decai com contexto longo; gatilho é convocado pela própria ação.

| Ruim | Bom |
|---|---|
| "não faça hardening não solicitado" | "ao encontrar problema de segurança fora do escopo → registrar e avisar, nunca corrigir" |
| "cuidado com Windows" | "ao escrever comando de shell → usar o shell declarado em `projeto.json`" |

Nada de fato volátil: versão, flag, preço, nome de modelo, nome de evento. O validador recusa. Se
recusar, a saída diz o motivo e nada foi gravado: tire o dado volátil do texto (aponte para onde ele
vive, por exemplo o campo do `projeto.json`) e proponha de novo.

## Passo 3 — propor, sem gravar

    node "${CLAUDE_PLUGIN_ROOT}/scripts/propor-regra.js" --gatilho '<quando>' --acao '<o que fazer>'

O texto da regra vai entre **aspas simples**, nos dois shells: com aspas duplas, uma crase ou um
`$(...)` dentro dele executa como comando e a regra sai mutilada (e é gravada assim). Dentro do
texto, cada caso tem o seu cuidado:

- **Apóstrofo** (`'`): escreva `'\''` no bash e `''` no PowerShell.
- **Aspas duplas retas** (`"`), no Windows PowerShell 5.1: não use. Elas somem ao chegar ao `node`
  (medido; crase, `$` e apóstrofo chegam íntegros). Troque por aspas tipográficas “ ” ou reescreva
  sem elas.
- **Apóstrofos tipográficos** (‘ ’), no PowerShell: eles **fecham** a string de aspas simples e o
  comando nem chega a rodar. Troque cada um por `'` dobrado (`''`) ou reescreva sem eles.
- **Barra invertida no fim** (`\`), no Windows PowerShell 5.1: um texto com espaço que acaba assim
  engole o argumento seguinte (medido). Não termine o texto com ela.
- **Quebra de linha:** não ponha. A regra é **uma linha só** (`gatilho -> ação`). O script recusa
  gatilho ou ação com quebra de linha antes de tudo: responde `RECUSADA` e não grava nada. Escreva o
  gatilho e a ação em uma frase cada, sem Enter no meio.

Confira na saída do `propor-regra.js` que o texto saiu igual ao que você quis antes de seguir para o
Passo 4. O `${CLAUDE_PLUGIN_ROOT}` chega já trocado pelo caminho real e fica entre aspas duplas
porque esse caminho pode ter espaço.

Cole a saída. Ela diz, com todas as letras, que **não gravou nada**.

## Passo 4 — pedir a decisão, em 3 opções

Use `AskUserQuestion`, com a recomendada em primeiro lugar e marcada:

- **Gravar como está** — vira regra deste projeto e volta em toda sessão a partir de agora.
- **Ajustar o texto antes** — você reescreve e propõe de novo; nada é gravado nesta rodada.
- **Não gravar** — vale só para esta conversa, e some quando ela fechar.

## Passo 5 — gravar, só depois do OK

    node "${CLAUDE_PLUGIN_ROOT}/scripts/propor-regra.js" --gatilho '…' --acao '…' --gravar

Cole a saída, que traz o total de regras. Se o total não subiu em 1, a
linha não foi lida como regra: abra `.claude/sworn/regras.md` e confira o texto. **Se o número de regras passar de ~40, avise o usuário:**
arquivo de regra grande dilui a atenção e acelera exatamente a doença que veio curar.
