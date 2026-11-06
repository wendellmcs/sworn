# O sworn fora do Claude Code

O harness é o programa que roda o modelo e chama os ganchos. Além do Claude Code, o sworn roda em cinco: Codex, Qwen
Code, agy (Antigravity CLI), `dsh` (o harness da DeepSeek) e OpenCode. Os portões são os mesmos scripts: a
`scripts/ponte.js` leva a entrada de cada harness à forma do Claude Code, roda o portão de sempre e devolve a saída na
forma do harness. No Claude Code nada muda: ele segue pelo `hooks/hooks.json`, sem a ponte.

Marcas: **[T]** testado de ponta a ponta nesta máquina (Windows 11, Node 24.12); **[L]** lido na documentação do
harness, sem teste; sem marca, coberto pelos testes do repositório sobre entradas reais colhidas de cada harness, sem
prova de ponta a ponta.

## Como ligar

Na pasta do projeto:

```
node "<plugin>/scripts/instalar.js" <codex|qwen|agy|dsh|opencode>
node "<plugin>/scripts/instalar.js" --conferir <harness>
```

O primeiro grava os ganchos onde o harness lê, cada um chamando a ponte, e um bloco no arquivo de instruções que o
harness carrega sem aprovação (`AGENTS.md`, ou `QWEN.md` no Qwen). O bloco diz ao modelo: sem o "sworn - regras" na
abertura da sessão, os ganchos estão desligados, e ele roda o `--conferir`. O `--conferir` diz quais eventos já
rodaram e o passo que falta; só sai com 0 depois de um gancho rodar. O `/sworn:init` detecta o harness, roda os dois
e não declara pronto sem o `--conferir` verde.

| Harness | Onde o instalador grava | Passo que só o usuário faz |
|---|---|---|
| Codex | `.codex/hooks.json`; agentes em `.codex/agents/*.toml` | aprovar os ganchos no `/hooks`, uma vez por caminho do projeto, e de novo quando uma versão nova do sworn muda um gancho: o Codex não roda o gancho que mudou desde a aprovação, e o `--conferir` diz quantos faltam aprovar (é a segurança do Codex; o sworn não contorna) |
| Qwen Code | `.qwen/settings.json`, chave `hooks`; agentes em `.qwen/agents/` | nenhum |
| agy | `.agents/hooks.json`, grupo `sworn` | nenhum; o plugin precisa estar numa pasta sem espaço (o agy parte o comando em cada espaço e não tira aspas): com espaço, o instalador avisa que os ganchos não vão rodar e manda instalar o sworn numa pasta sem espaço |
| `dsh` | `.dsh/sworn-hooks.json` e o perfil `sworn` na pasta pessoal | pôr a ponte oficial do `dsh` no perfil (precisa do `pnpm`; o instalador dá o comando) e abrir o `dsh` com `dsh --profile sworn` |
| OpenCode | `.opencode/plugins/sworn.js`; agentes em `.opencode/agent/` | nenhum; o modelo fica o que o usuário escolheu |

As skills chegam ao Codex, ao Qwen e ao agy pelos manifestos (`.codex-plugin/plugin.json`, `qwen-extension.json`,
`.antigravity-plugin/plugin.json`); ao `dsh` e ao OpenCode, por uma cópia em `.agents/skills/sworn-<nome>/`. Nenhum dos
cinco troca o `${CLAUDE_PLUGIN_ROOT}` das skills [T]: o instalador põe o caminho real na cópia que o harness lê, nunca
num repositório git.

## Versões testadas

Os quatro testes de cada um: (1) a abertura põe as regras no contexto; (2) a edição fora do escopo é negada com o
motivo; (3) o comando destrutivo é negado; (4) o fecho que diz "verde" sem o bloco da prova colado é barrado.

| Harness | Versão | Modelo | Resultado |
|---|---|---|---|
| Codex | 0.162.0-alpha.2 (o binário do app) | gpt-6-luna e minimax-m3.1-flash, pelo xKiro (API compatível com a da OpenAI) | 4/4 [T] cada |
| Qwen Code | 0.26.5 | DeepSeek, pela API compatível com a da OpenAI; pelo xKiro, gpt-6-luna e devstral-medium | DeepSeek 4/4 [T]; gpt-6-luna 3/4 (no teste 4 ele se recusa a dizer "verde", e não há fecho a barrar); devstral-medium passou no teste 4 [T] |
| agy | 1.4.12 | o do agy; claude-sonnet-4-6 | 4/4 [T] cada |
| `dsh` | 0.2.1-rc.5 | DeepSeek; gpt-6-luna, pelo xKiro | 4/4 [T] cada |
| OpenCode | 1.19.5 | `deepseek/deepseek-flash`; gpt-6-luna, pelo xKiro (com GPT ele edita pelo `apply_patch`) | 4/4 [T] cada |
| Claude Code + DeepSeek | 2.1.314 | DeepSeek, pelo endpoint compatível com a API da Anthropic; claude-haiku-5.5, pelo xKiro | 4/4 [T] cada |

O Qwen solta versão quase todo dia: versão mais nova que a da tabela não foi testada.

## O que roda onde

| Peça | Codex | Qwen Code | agy | `dsh` | OpenCode |
|---|---|---|---|---|---|
| Regras na abertura | sim [T] | sim [T] | sim [T] | sim, como JSON [T] | sim [T] |
| Portões de edição e de comando | sim [T] | sim [T] | sim [T] | sim [T] | sim [T] |
| Portão de fecho (a última resposta) | o Codex manda [T] | o Qwen manda [T] | a ponte lê da transcrição [T] | a ponte lê da transcrição [T] | só com o servidor vivo [T] |
| Contexto e cobrança do teste vermelho (pela transcrição) | sim [T] | sim [T] | sim [T] | sim, com zstd no Node [T] | sim, com `node:sqlite` [T] |
| Catraca (nega a edição que baixa um piso, como a cobertura mínima) | sim [T] | sim [T] | sim [T] | sim [T] | sim [T] |
| Portão do handoff (devolve o turno quando o modelo gravou o arquivo de continuação, mas não colou na resposta o texto que abre o chat seguinte) | sim [T] | sim [T] | sim [T] | sim [T] | só com o servidor vivo [T] |
| Pergunta ao dono em 3 opções | só no modo Plan [T] | só com interface [T] | a ponte lê a resposta da transcrição [T] | só no perfil `web` [T] | só com interface [T] |
| Subagentes do `/sworn:review`, com o veredito gravado pelo gancho | `spawn_agent`, no app-server [T] e na TUI | `agent` [T] | veredito pelo `send_message` [T] | veredito pelo `send_message` [T] | `task` [T] |
| Portão por papel (o subagente só usa o `tools:` do papel) | sim [T] | sim, pela ponte e pela lista nativa do papel [T] | o papel não tem nome | o papel não tem nome | sim, pela ponte e pela lista nativa do papel [T] |
| Handoff sem chat novo (quando o harness compacta a conversa, o sworn manda reler o handoff gravado e seguir) | pelo aviso de compactação do Codex [L]; o instalador regula quando o Codex compacta | pelo aviso de compactação do Qwen [L]; o Qwen compacta no tamanho padrão dele, sem ajuste | depois do handoff gravado, o sworn vê a conversa encolher muito e manda reler antes da próxima resposta do modelo | depois do handoff gravado, o sworn vê a conversa encolher muito e manda reler junto da próxima mensagem do usuário | pelo aviso de compactação do OpenCode [L] |

Os limites, um a um:

- **OpenCode, fecho.** O OpenCode não tem evento de fim de turno. A ponte reenvia o pedido de prova quando a sessão
  fica ociosa, e isso só funciona com o servidor vivo (`opencode serve` com `opencode run --attach`, a forma da
  interface). No `opencode run` sozinho, o portão de fecho não segura [T], e o do handoff, que roda no mesmo fim de turno, também não.
- **Transcrição.** O `dsh` grava em zstd e o OpenCode num SQLite; o Node precisa de `zlib.zstdDecompressSync` e de
  `node:sqlite` (o Node 24.12 tem os dois). Sem eles, a abertura daquele harness avisa que a cobrança do teste vermelho
  não roda ali e manda atualizar o Node para o 22.15, o 23.8 ou mais novo; nunca fica calada.
- **Pergunta em 3 opções.** No Codex a ferramenta só existe no modo Plan; no Default, o modelo pergunta em texto. No
  agy o gancho não recebe a resposta: ela só entra na transcrição depois, e a ponte a lê na chamada seguinte do
  modelo e a conta como decisão do dono. Provado nos dois casos [T]: a pergunta pulada conta zero, e a resposta
  escolhida na interface do agy conta uma. No Qwen e no OpenCode a ferramenta só aparece com interface (no OpenCode,
  a TUI ou o `opencode serve` com `OPENCODE_ENABLE_QUESTION_TOOL=1`). No `dsh` ela só existe no perfil `web`, e o
  perfil `sworn` é o sem interface: para ter as duas coisas, crie um perfil com o pacote `@deepseek-ai/dsh-web-app` e
  a mesma ponte de ganchos do perfil `sworn` [T]. Nos cinco, a resposta escolhida conta uma decisão do dono [T].
- **Subagentes.** No Codex só o app-server (o servidor que o app do Codex usa) e a TUI (a interface no terminal) têm
  a ferramenta de subagente; o `codex exec` não tem [T]. No agy
  e no `dsh` o subagente devolve o resultado pelo `send_message`, e a ponte grava o veredito da revisão cega a partir
  dele [T].
- **Portão por papel.** Vale pela ponte no Codex, no Qwen e no OpenCode. No Codex o `.toml` do agente não impõe só leitura [L], e por isso o
  portão importa: o `sworn-inspector` que tenta editar ou rodar comando volta barrado, e a mensagem diz o papel, as
  ferramentas que ele usa, a que ficou fora e o que fazer ("faça o que o papel permite e devolva o resultado a quem
  chamou"); o `sworn-reader` roda o comando [T]. No Qwen e no OpenCode o instalador já dá ao `sworn-inspector` só
  ferramentas de leitura, e ele nem tenta editar [T]. No agy e no `dsh` o subagente não carrega o nome do papel.
- **Sandbox** (o isolamento que o harness põe nos comandos do modelo). O do `dsh` nega processo filho por pipe; a
  ponte recua para arquivo e guarda o estado do `dsh` em `.claude/sworn/ligado/dsh/tmp` [T]. No Codex com
  `workspace-write` e no `dsh`, o `node --test` do projeto pode falhar com `spawn EPERM` (o Windows negou abrir o
  processo): o executor de testes abre processo filho, e o sandbox nega [T]. Para rodar a suíte: num terminal fora
  do harness (o portão de fecho não vê esse teste, que fica fora da transcrição) ou, no Codex, numa sessão com
  `--sandbox danger-full-access`, sem isolamento nenhum [L].
- **Agente de memória.** O do Codex e o do Qwen disparam os ganchos com a pasta fora do projeto; a ponte deixa passar
  [T].
- **Ganchos em paralelo.** O Codex roda ao mesmo tempo os ganchos do mesmo evento (os quatro do comando de shell, por
  exemplo). A ponte grava o próprio estado trocando o arquivo inteiro de uma vez; se o Windows nega a troca porque
  outro gancho está com o arquivo aberto, a negação do portão vale do mesmo jeito [T]. O usuário não precisa fazer
  nada.
- **Handoff sem chat novo.** Quando a conversa chega ao tamanho em que o sworn pede o handoff, ele grava o handoff
  num arquivo e o trabalho segue na mesma conversa, sem o usuário abrir outra.
  - O harness compacta a conversa quando ela enche (resume o que veio antes, para caber no limite do modelo). O que
    o sworn faz depende de quando isso acontece:
    - depois de o handoff estar gravado: manda o modelo reler o arquivo e seguir dele;
    - depois de o sworn pedir o handoff e antes de ele estar gravado: manda gravá-lo primeiro;
    - antes de o sworn pedir o handoff: não manda nada, e o trabalho segue do resumo do harness.
  - No agy e no `dsh` é diferente (detalhe no item do agy e do `dsh`, abaixo): valem os dois primeiros casos, só
    quando a conversa encolhe muito, e no `dsh` o tamanho só se mede a cada mensagem do usuário.
  - A ordem é cobrada: até o modelo ler o handoff (ou gravar o que faltava), editar outro arquivo é negado, no
    máximo três vezes; depois a edição passa, para a sessão não travar. Editar pelo shell não é cobrado.
  - O handoff em si não pede nada do usuário. Só duas ações continuam com ele, nos itens abaixo: no `dsh`, reenviar
    a mensagem segurada depois de uma pausa, como sempre; e, se quiser, recomeçar com a conversa vazia.
  - Teste de ponta a ponta (rodar o harness de verdade até compactar, reler o handoff e seguir o trabalho): passou no
    Codex, no Qwen Code e no agy, com um modelo em cada; no OpenCode o ciclo rodou inteiro (gravar, compactar e
    reler, seis vezes), mas o teste acabou antes do fim do trabalho; no `dsh`, ainda não. Na tabela, [L] marca o que
    está na documentação do harness; agy e `dsh` ficam sem marca, porque o caminho deles é só do sworn (nenhum
    evento de compactação conhecido).
  - Codex, Qwen e OpenCode avisam a compactação ao sworn, e a ordem (reler ou gravar primeiro) vai junto desse
    aviso; no OpenCode, ela entra no resumo que a compactação escreve. No Codex, o instalador do sworn grava no
    `.codex/config.toml` do projeto o tamanho de conversa em que o Codex compacta, um pouco acima do tamanho em que
    o sworn pede o handoff: assim a compactação vem logo depois de o sworn pedir o handoff. O Qwen compacta no
    tamanho padrão dele (uma fração da janela do modelo, que o sworn não conhece) e não precisa de ajuste; vale o
    caso de quando a compactação acontecer, na lista acima.
  - agy e `dsh` não avisam a compactação, então o sworn guarda o maior tamanho de conversa que viu. Se esse maior
    tamanho passou de 80 mil tokens e a conversa cai para menos de 60% dele, o sworn entende que ela foi compactada:
    com o handoff gravado, manda reler; sem ele, se o maior tamanho tinha chegado ao tamanho em que o sworn pede o
    handoff, manda gravá-lo primeiro. A ordem vai, no agy, antes da próxima resposta do modelo; no `dsh`, junto da
    próxima mensagem do usuário. Uma exceção no `dsh`: se essa mensagem é a primeira depois de uma pausa, o sworn a
    segura para mostrar onde o trabalho estava (como faz sempre depois de uma pausa) e o usuário a manda de novo, como
    já faria sem o handoff; a ordem vai junto da mensagem reenviada. No agy o sworn não segura mensagens.
  - No `dsh` o tamanho só se mede a cada mensagem do usuário: se a conversa passou do tamanho de pedir o handoff e
    compactou no meio de uma resposta longa, sem mensagem nova entre as duas coisas, o sworn não vê o maior tamanho e
    a compactação passa sem a ordem de gravar.
  - Se a conversa não for compactada, o handoff fica gravado e o trabalho segue até o limite do harness. Para
    recomeçar com a conversa vazia, o usuário abre uma conversa nova e cola o bloco de prompt do fim do arquivo do
    handoff (o sworn diz o caminho dele ao gravá-lo).

## O que fica só no Claude Code, e por quê

- **Os painéis da interface** (`hooks/mods.tsx`): nenhum dos cinco tem onde desenhar.
- **O `/sworn:parallel` pela ferramenta Workflow:** ela só existe no Claude Code. Fora dele, o playbook manda
  despachar os subagentes nativos do harness com o mesmo teto de 8.
- **`/sworn:effort-high` e `/sworn:effort-low`:** o campo `effort:` de skill só existe no Claude Code; o instalador
  não leva as duas. O `effort:` de cada papel (`agents/<papel>.md`) vai ao Codex como `model_reasoning_effort` no
  `.toml` do agente [T].
- **A aprovação do `/hooks` do Codex** não é limite do sworn: é a segurança do Codex, uma vez por caminho de projeto
  e de novo para o gancho que uma versão nova do sworn mudar.
