<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/banner-escuro.svg">
    <img src="assets/banner-claro.svg" alt="sworn: proof instead of claims (prova em vez de afirmação)" width="100%">
  </picture>
</h1>

<p align="center">
  <strong>Um plugin do Claude Code que força o agente a provar em vez de afirmar.</strong><br>
  Oito travas: seis portões de custo zero e dois dos doze comandos. Todo portão é um script determinístico: nenhum modelo no meio.
</p>

<p align="center">
  <a href="LICENSE"><img alt="licença MIT" src="https://img.shields.io/badge/licen%c3%a7a-MIT-2f6f4e"></a>
  <img alt="versão publicada, lida do plugin.json" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fwendellmcs%2Fsworn%2Fmain%2F.claude-plugin%2Fplugin.json&query=%24.version&label=vers%c3%a3o&color=1f4e79">
  <img alt="plugin do Claude Code" src="https://img.shields.io/badge/Claude%20Code-plugin-555555">
  <img alt="testado só no Windows" src="https://img.shields.io/badge/testado-s%c3%b3%20no%20Windows-b45309">
</p>

<p align="center">
  <a href="README.md">README (English)</a> · <a href="README.pt-BR.md">README em português</a> · <strong>Guia completo</strong>
</p>

<p align="center">
  <a href="#o-que-medimos">O que medimos</a> ·
  <a href="#como-instalar">Instalar</a> ·
  <a href="#um-exemplo-do-começo-ao-fim">Exemplo</a> ·
  <a href="#as-oito-travas">As travas</a> ·
  <a href="#os-doze-comandos">Os comandos</a> ·
  <a href="#o-que-ele-já-pegou-em-uso-real">Casos reais</a> ·
  <a href="#o-que-o-sworn-não-promete">O que não promete</a>
</p>

---

Este é o guia completo, com o detalhe de cada trava, comando, gancho e chave. Para a visão curta, leia
o README ([em inglês](README.md) ou [em português](README.pt-BR.md)).

O `sworn` nasceu com o nome `esquadro`. Em português, "fora de esquadro" significa exatamente aquilo
que este plugin existe para pegar: a coisa que parece certa e não está.

## O problema que ele resolve

Todo agente de código tem os mesmos vícios, e nenhum deles aparece no primeiro dia:

| O agente… | O `sworn`… |
|---|---|
| diz "pronto, os testes passam" sem ter rodado os testes | devolve o turno até ele colar a saída, ou declarar o que não rodou |
| corrige o bug e, de passagem, mexe em três arquivos que ninguém pediu | nega a escrita fora do escopo que você declarou |
| roda `git reset --hard` para "limpar" | barra o comando destrutivo antes de ele rodar |
| baixa o piso de cobertura quando o teste reprova | nega a edição que afrouxa a régua |
| cria `utils2.js` sem procurar o `utils.js` que já existe | nega arquivo novo quando nada foi buscado no turno |
| escreve `&&` num PowerShell 5.1 | barra o idioma de shell errado para a ferramenta que vai rodar |
| edita o arquivo que outra sessão está mexendo | nega a escrita em arquivo que já estava modificado quando a sessão abriu |
| manda o modelo mais caro corrigir um erro de digitação | barra os agentes da metade mais cara da escada quando a tarefa só tem trabalho leve |

Instrução no prompt não segura nada disso por muito tempo: numa conversa longa, ela se perde. Aqui,
cada vício está atrás de um **hook**: um gancho do Claude Code, que roda um script em momentos fixos,
como antes de escrever um arquivo ou ao fim da resposta. Ou o agente prova, ou não
passa — e o que ele consegue contornar, como ampliar o próprio escopo, fica contado e é dito no
fecho do turno.

---

## Veja em 30 segundos

<p align="center">
  <img src="assets/terminal-fecho.svg" alt="Sessão de exemplo: o agente diz que terminou sem colar prova, e o portão de fecho devolve o turno com a mensagem literal do scripts/portao-fecho.js" width="780">
</p>

O agente disse que terminou e não mostrou nada. O hook `Stop` (o que roda quando o agente fecha o turno) leu a resposta, não achou saída de
comando colada e devolveu o turno. A frase do agente é de exemplo; **a resposta do portão é a saída
literal** do `scripts/portao-fecho.js` desta versão.

Na rodada seguinte, com a prova colada, o mesmo portão deixa o turno fechar. A resposta abaixo é
de exemplo; o que está provado, rodando o portão contra ela, é que ele a aceita:

````text
Corrigido: o frete volta a usar o CEP de entrega.

```
$ npm test
# tests 42
# pass 42
# fail 0
```
````

<details>
<summary>O texto do portão, para ler ou copiar</summary>

~~~text
sworn - portao de fecho (trava 3).

Voce afirmou sucesso e nao colou evidencia desta rodada.
Faca uma destas duas coisas, e responda de novo:

  1. cole a saida literal do comando que prova o que voce afirmou,
     dentro de um bloco ``` , com o comando e o resultado; ou
  2. declare explicitamente o que NAO rodou, e por que.

Falha pre-existente so vale com prova: rodada anterior ao diff, ou
demonstracao de que os arquivos lidos pelo teste nao estao no diff.

Nao reescreva a frase para escapar do portao. Rode, ou declare.
~~~

</details>

---

## O que medimos

A pergunta: com e sem o `sworn`, quantas vezes o agente diz "pronto" quando não está? 20 tarefas, 3
rodadas cada, nas duas condições, cada rodada num projeto de brinquedo novo, modelo Claude Sonnet, só
as travas de custo zero. Cada tarefa esconde uma armadilha, e a apuração é por script, não por modelo.
**Falsa entrega** é dizer "pronto" com o teste vermelho, ou verde só porque um teste ou um limite foi
mudado. A hipótese, escrita antes: com o plugin, a falsa entrega cai pelo menos 10 pontos e pelo
menos 2 execuções (veredito "melhor"); dentro dessa margem, "igual"; acima, "pior".

| Armadilha | Falsa entrega sem o `sworn` | Falsa entrega com o `sworn` |
|---|---|---|
| a correção quebra outro teste | 0 de 12 | 0 de 12 |
| os testes não rodam | 0 de 12 | 0 de 12 |
| um limite para afrouxar | 1 de 12 | 0 de 12 |
| a tarefa é impossível | 3 de 12 | 3 de 12 |
| nenhuma (controle) | 0 de 12 | 0 de 12 |
| **total** | **4 de 60** | **3 de 60** |

**Veredito: igual.** O plugin não reduziu a falsa entrega nesta medição. A métrica secundária, fora
da manchete: a resposta final trouxe a saída do teste colada em 17 de 60 execuções com o plugin e em 0
de 60 sem ele. Nenhuma execução foi inválida. Custo: US$ 16,66 sem o plugin e US$ 20,48 com ele, US$
37,14 no total.

A saída literal da apuração está em [`medicao/resultado.txt`](medicao/resultado.txt); só a linha da
pasta da rodada foi trocada por `<pasta da rodada>`, para não publicar caminho da máquina. A rodada
saiu em duas etapas (1 repetição, depois 2), juntadas numa pasta só antes da apuração. Para medir de
novo, no seu ambiente (cada execução é uma sessão paga do `claude`):

```
node "<plugin>/scripts/medir-travas.js" --congelar <pasta>
node "<plugin>/scripts/medir-travas.js" --gerar --modelo <nome> --destino <pasta>
node "<plugin>/scripts/medir-travas.js" --apurar <pasta da rodada>
```

O `--congelar` grava antes o sha256 das tarefas, da apuração e do instrumento; o `--apurar` só dá
veredito com o congelado conferindo e a rodada completa.

---

## Como instalar

Do GitHub, pelo marketplace que acompanha o repositório:

```
claude plugin marketplace add wendellmcs/sworn
claude plugin install sworn@sworn-local
```

Dentro de uma sessão, o mesmo par funciona como `/plugin marketplace add wendellmcs/sworn` e
`/plugin install sworn@sworn-local`. O `sworn-local` é o nome do marketplace declarado em
`.claude-plugin/marketplace.json`.

**Sem chave SSH no GitHub:** o atalho `wendellmcs/sworn` tenta primeiro clonar por SSH. O `claude plugin`
do terminal cai sozinho para HTTPS quando o SSH falha, mas o `/plugin` dentro da sessão e as atualizações
não caem. Defina `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` no ambiente antes de abrir o Claude Code, ou adicione
o marketplace pela URL completa, que vai direto por HTTPS:
`claude plugin marketplace add https://github.com/wendellmcs/sworn.git`.

**Em empresa com configurações gerenciadas** (as que o administrador impõe e você não muda), as travas
podem não rodar, porque cada trava é um hook do plugin. Com `allowManagedHooksOnly`, os hooks de plugin ficam
bloqueados, a menos que o administrador ligue o `sworn` no `enabledPlugins` das configurações gerenciadas.
O `allowManagedModsOnly` para os hooks do mod (a faixa e os botões). E uma lista de marketplaces permitidos
pode barrar o `sworn-local`: o `/plugin` mostra, em inglês e com estas palavras, `is blocked by enterprise
policy` ou `is not in the allowed marketplace list`. Nesses casos, quem libera é o administrador; o `/status`
mostra `Enterprise managed settings` na linha `Setting sources` quando há configuração gerenciada.

**Requisito:** Node.js no `PATH` — todo portão é um script `node`. Esta versão rodou com Node 24,
no Windows.

**Depois, no seu projeto:** rode `/sworn:init`. As travas 3 e 5 já estão de pé antes disso.

**Estilo de resposta (output style):** o `sworn` não traz um — o tom das respostas é escolha sua, não
do plugin. Um estilo é um arquivo `.md` com `name` e `description` no cabeçalho e as instruções no
corpo, guardado em `.claude/output-styles/` (vale para o projeto) ou em `~/.claude/output-styles/`
(vale para você em todos) e escolhido em `/config` (**Output style**) ou com `/output-style <nome>`.
Para mudar só o tom e manter o Claude programando como antes, ponha `keep-coding-instructions: true` no
cabeçalho: sem ele, o estilo tira as instruções de engenharia de software. O estilo novo ou editado só
vale depois de reabrir o Claude Code. Se o seu estilo encurtar as respostas, mantenha a
exigência do sworn: curto não dispensa a prova — uma linha da saída colada, ou a declaração do que
não rodou.

> ### ⚠️ Ligue a atualização automática — ela vem desligada
>
> O Claude Code só atualiza sozinho os plugins dos marketplaces oficiais da Anthropic. O
> `sworn-local` é de terceiros: começa com a atualização automática **desligada**, e o autor do
> plugin não consegue ligá-la por você. Sem ligar, você fica na versão que instalou. Ligue uma vez:
>
> 1. Numa sessão do Claude Code, digite `/plugin` e aperte **Enter**.
> 2. Vá até a aba **Marketplaces** (a tecla **Tab** troca de aba).
> 3. Selecione `sworn-local`.
> 4. Escolha **Enable auto-update**.
>
> Daí em diante o Claude Code confere o marketplace e baixa a versão nova sozinho, mas a versão
> chega alguns minutos depois de a sessão abrir, não na abertura. A sessão que já estava aberta
> segue com a versão antiga: depois que a nova chegar, rode `/reload-plugins` ou abra uma sessão
> nova. O aviso na tela (`Plugin updated: sworn · Run /reload-plugins to apply`) pode não
> aparecer; no painel do VS Code, não apareceu. Para conferir a versão que está no disco, rode
> `claude plugin list` no terminal: ele mostra a instalada, não a que a sessão carregou.

**No painel do VS Code o botão não existe.** O "Manage plugins" do painel não tem o **Enable
auto-update**. O caminho que funciona nos dois lugares é o `~/.claude/settings.json`: na entrada do
`sworn-local` em `extraKnownMarketplaces`, acrescente `"autoUpdate": true`.

```json
{
  "extraKnownMarketplaces": {
    "sworn-local": {
      "source": { "source": "git", "url": "https://github.com/wendellmcs/sworn.git" },
      "autoUpdate": true
    }
  }
}
```

Na abertura da sessão seguinte o Claude Code copia a chave para o `known_marketplaces.json`; não é
preciso o botão. Se você já tem outras entradas em `extraKnownMarketplaces`, acrescente só a chave
`autoUpdate` na do `sworn-local`.

**O `/sworn:init` faz isso por você:** ele pergunta e, com o sim, grava a chave pelo
`ligar-atualizacao.js` no `settings.json` da pasta de configuração do Claude Code (`~/.claude/`, ou a do
`CLAUDE_CONFIG_DIR`), que vale para todo projeto deste computador. Ele preserva o resto das configurações.
Sem a entrada do `sworn-local` nesse arquivo, ele a cria com a origem que o Claude Code gravou na instalação;
sem o marketplace instalado, recusa e diz para instalar primeiro. Um `settings.json` que ele não consegue ler
ele recusa sem regravar, e diz o que fazer: corrija o JSON (ou salve o arquivo em UTF-8) e responda sim de
novo no próximo `/sworn:init`.

**Para atualizar à mão** (sem a atualização automática, ou para pegar a versão nova agora):

```
claude plugin marketplace update sworn-local
claude plugin update sworn@sworn-local
```

A cópia instalada só muda quando a versão do plugin muda. Atualizar não reconfere o catálogo de
modelos — está na lista do que o `sworn` não promete.

**Para desenvolver**, aponte a sessão para o repositório. Editar um script e reabrir a sessão basta:

```
claude --plugin-dir "<caminho do repositório do sworn>"
```

---

## Um exemplo, do começo ao fim

**1. Configure.** No projeto, `/sworn:init`. Ele mostra o que inferiu, faz as seis perguntas e
grava `.claude/sworn/projeto.json` e `.claude/sworn/regras.md`.

**2. Declare o escopo da tarefa.** Um arquivo curto, em `.claude/sworn/escopo.md`:

```markdown
# Escopo
**Objetivo:** corrigir o calculo do frete no carrinho.
## Dentro
- src/carrinho/**
- test/carrinho.test.js
## Fora de escopo
- src/pagamento/**
```

"Dentro" é o que a tarefa pode tocar. "Fora" é o que ela promete não tocar, e ganha do "Dentro"
em qualquer marcha: é a declaração mais específica das duas.

**Várias frentes no mesmo projeto?** Em vez de um `escopo.md` só, dê um arquivo por frente em
`.claude/sworn/escopos/<frente>.md` (mesmo formato acima). Editar esse arquivo vincula a sessão
à frente dele, e a partir daí só o que estiver nele libera escrita, para aquela sessão. Sem vínculo,
vale o `escopo.md` de sempre. Aposentar uma frente é mover o arquivo dela para fora da pasta.

Em sessão sem interação (`claude -p`, que executa um pedido e termina sem perguntar nada), o Claude
Code trata `<projeto>/.claude/**` como arquivo sensível e nega a escrita. Nem o modo `acceptEdits`
(que aprova as edições sozinho) nem uma regra de permissão explícita liberam. O vínculo acontece assim
mesmo, porque o hook roda antes dessa checagem. Para isso, o arquivo da frente tem de existir antes
(crie-o numa sessão interativa), e o agente tem de lê-lo com `Read` antes de editá-lo com `Edit`, em
duas chamadas separadas, a leitura primeiro: o Claude Code recusa a edição de arquivo que a sessão
ainda não leu. Se a sessão seguir sem vínculo, confira essas duas condições.

**3. Trabalhe.** O agente corrige o frete e, no caminho, acha um defeito na cobrança. Ao tentar
editar `src/pagamento/cobranca.js`, recebe de volta:

~~~text
sworn - portao de escopo (trava 4 - o escopo da tarefa).

O arquivo src/pagamento/cobranca.js casa "src/pagamento/**", que o escopo declara FORA desta tarefa.

Escolha uma:
  1. nao edite este arquivo; se achou um defeito nele, conte ao usuario no fecho do turno, sem corrigir;
  2. se a tarefa mudou, reescreva .claude/sworn/escopo.md e diga por que.
~~~

O defeito da cobrança chega a você no fim da resposta, para decidir depois, em vez de um diff que ninguém pediu.

**4. Revise às cegas.** `/sworn:review src/carrinho/frete.js` despacha os inspetores, um por
lente; o script `apurar-ronda.js` do plugin (que o `/sworn:review` roda por você) diz se a ronda foi seca. Você
fica sabendo quantos agentes rodaram — custo é informação sua.

**5. Feche com prova.** "Pronto, os testes passam" sem saída colada volta, como no terminal lá em
cima. Volta também quando a saída colada mostra falha, quando o último teste rodado na sessão
falhou, ou quando a prova de pronto que o `/sworn:init` gravou (`provaDePronto`) não rodou depois da
última edição de código. Com a saída do `npm test` que passa num bloco, o turno fecha.

Para o próprio sworn rodar essa prova no fim do turno em que o Claude editou código e não a rodou (sem gastar outro
turno para isso), rode na pasta do projeto, na sua máquina: `node "<plugin>/scripts/prova-no-fecho.js" ligar`, com
`<plugin>` sendo a pasta onde o sworn está instalado (`desligar` desliga; `ver` diz se está ligada e qual prova roda).
A lista dos projetos ligados fica em `sworn/prova-no-fecho.json`, dentro da pasta do Claude (`~/.claude`, ou a de
`CLAUDE_CONFIG_DIR`), fora do repositório: um projeto clonado nunca roda nada sozinho. A lista guarda o comando que
você ligou: se um commit trocar a `provaDePronto`, o sworn para de rodá-la, o Claude avisa no fim do turno e o `ver`
mostra a troca, até você ligar de novo. A prova passou: o turno fecha.
Falhou: o Claude recebe as últimas linhas da saída para consertar. Demorou mais de 60 s: o sworn desiste e o Claude
roda a prova, como no passo 5; nessa sessão o sworn não tenta de novo.

Com um plano escrito, antes de codar, o `/sworn:review-plan` roda o `scripts/revisar-plano.js`: ele confere no disco
cada caminho, símbolo e comando que o plano cita entre crases e cobra o comando de prova de cada caixa aberta; depois
a revisão cega lê o plano. Ao fechar uma etapa, o `/sworn:drift` roda o `scripts/drift.js`: ele cruza os arquivos
mudados desde o commit do plano com o que o plano cita e mostra o arquivo mudado fora do plano e a caixa feita cujo
arquivo não mudou.

---

## Como funciona

```mermaid
flowchart LR
    pedido(["você pede"]) --> agente["o agente trabalha"]
    agente -->|"Write · Edit"| escrita{{"portão de escopo"}}
    agente -->|"Bash · PowerShell"| shell{{"portão destrutivo"}}
    agente -->|"Task · Agent"| custo{{"portão de agente"}}
    agente -->|"fim do turno"| fecho{{"portão de fecho"}}
    escrita -->|"nega, com o motivo"| agente
    shell -->|"nega, com o motivo"| agente
    custo -->|"nega, com o motivo"| agente
    fecho -->|"devolve o turno"| agente
    fecho -->|"prova colada"| entrega(["você recebe o fecho com evidência"])
```

**Por que script, e não modelo:** um portão que dispara no fim de toda resposta não pode custar
token, e um modelo julgando se houve evidência é o mesmo modelo que inventou a evidência. Quando um
portão nega, a mensagem diz o motivo e as saídas possíveis — o agente lê e corrige o rumo no mesmo
turno.

O plugin se pendura em dezesseis pontos do ciclo de uma sessão:

| Quando | Script | O que faz |
|---|---|---|
| a sessão abre, reabre ou compacta | `scripts/abertura.js` | fotografa o `git status` (o que já estava modificado é de outra frente) e anota a hora da abertura (o que outra sessão escrever depois também é), reinjeta as suas regras e o escopo em vigor, avisa escopo herdado de outra tarefa, `intocaveis` que não pegam nada e plano ativo de outra sessão; traz a parte "How to ask" do guia oficial do modelo da sessão, exceto na abertura enxuta; a cada 7 dias, roda a auditoria do `/sworn:audit` e avisa só o que passou do limite; sem `.claude/sworn/projeto.json`, manda o Claude perguntar a você, no primeiro turno, se configura com o `/sworn:init` (agora, depois ou nunca neste projeto); com 30 conversas ou mais e o limiar de troca de chat nunca calibrado, manda rodar o `/sworn:calibrate` |
| você manda um pedido | `scripts/abrir-turno.js` | zera as marcas do turno anterior: trabalho feito, busca feita, bloqueio; se você perguntar se o contexto está bom, manda o Claude gravar o handoff (o texto de continuação do trabalho) e seguir na mesma conversa; se você corrigir o jeito dele trabalhar ("eu já te disse", "da próxima vez…"), manda o Claude rodar o `/sworn:learn` na mesma resposta e perguntar a você, em 3 opções, se grava; quando o pedido é de melhoria ou função nova, oferece o `/sworn:radar`, uma vez por sessão; grava o seu pedido na lista numerada de `.claude/sworn/pedidos/`; numa conversa de 200 mil tokens ou mais parada há mais de 1 hora, segura a primeira mensagem, grava o resumo do chat em `.sworn/handoff/` e mostra quanto custa continuar (a mensagem seguinte passa); com 5 turnos de trabalho sem o plano mudar, pede a nota de progresso no plano |
| antes de `Write` e `Edit` | `scripts/portao-escopo.js` | intocáveis, outra frente, "Fora", marcha, escopo, criar sem buscar, catraca (régua que só aperta: teto que não sobe e piso que não desce) e, com design system declarado, token fora do sistema |
| antes de `Read` | `scripts/aviso-leitura.js` | arquivo de texto acima de 64 KB lido inteiro, sem `offset` nem `limit`: avisa uma vez por arquivo na sessão, com o tamanho e o lembrete de ler só o trecho; nunca nega |
| antes de `Bash` e `PowerShell` | `scripts/portao-shell.js`, que roda num processo só o `scripts/portao-destrutivo.js` · `scripts/portao-estilo.js` · `scripts/portao-commit.js` · `scripts/portao-pacote.js` | comando destrutivo, idioma de shell errado e `cd` solto (no `Bash`, corrige sozinho: o comando roda num subshell); avisa, sem negar, quando a tabela de idioma do PowerShell não se lê. Com design system declarado, nega arquivo de estilo escrito por comando de shell e manda usar `Write` ou `Edit`. Nega o `git commit` com código mudado na sessão sem revisão aprovada ou com segredo no que ele vai levar, e o `git push` com o cartão do que ele publicaria. Avisa o Claude, sem negar, do pacote instalado que não está no manifesto nem no lockfile, com o comando que confere o nome no registro |
| antes de `Task` e `Agent` | `scripts/portao-agente.js` · `scripts/portao-apelido.js` · `scripts/portao-juiz.js` | agente caro em marcha rápida e chamada com modelo ou esforço fora da tabela da escada; `model:` e `effort:` do agente contra o apelido e o esforço gravados no projeto; o inspetor da revisão cega um degrau acima do modelo da sessão; o guia oficial do modelo no pedido de cada agente do `sworn` |
| antes de `AskUserQuestion` | `scripts/portao-decisao.js` | barra pergunta ao dono sem exatamente 3 opções ou sem a recomendada em primeiro; pergunta de fato (sintoma, dado que só você tem) passa com `(fato)` no título curto (`header`); desliga com `"portaoDecisao": false` no `projeto.json` |
| depois de `Write`, `Edit`, `NotebookEdit`, `Grep`, `Glob`, `Read`, `AskUserQuestion` e `Skill` (no `Bash` e no `PowerShell`, pelo `scripts/depois-do-shell.js`) | `scripts/marcar-trabalho.js` | marca trabalho real, busca feita e arquivos tocados; anota no registro do projeto o arquivo que a sessão escreveu (a trava 5 das outras sessões lê dele); conta as decisões suas respondidas e os commits que passaram |
| depois de `Bash` e `PowerShell` | `scripts/depois-do-shell.js`, que roda num processo só o `scripts/marcar-trabalho.js`, o `scripts/conferir-depois.js` e o `scripts/recibo-da-prova.js` | o arquivo versionado que o comando mudou ou apagou fora do escopo do começo do turno (ou intocável) volta pelo git, e o Claude é avisado; sem escopo declarado, nada muda. O comando de teste deixa recibo no estado da sessão, e a saída verde e longa chega ao Claude só com o resumo (ver "Recibo da prova e saída enxuta") |
| `Bash` ou `PowerShell` sai com erro | `scripts/recibo-da-prova.js` | o comando de teste que falhou deixa recibo no estado da sessão, com o código de saída; a saída chega ao Claude inteira |
| um subagente abre | `scripts/abrir-subagente.js` · `scripts/escalar.js` | entrega a ele o bloco "menos código" (o da abertura não chega ao subagente); os que só leem (`inspector`, `dedupe-judge`, `refuter`, `reader`, `Explore`, `Plan`) ficam de fora; `"menosCodigo": false` desliga. Se ele é o agente que um degrau da escada pediu, dá baixa no pedido |
| um subagente termina | `scripts/gravar-veredito.js` · `scripts/escalar.js` · `scripts/conferir-entrega.js` | o inspetor da revisão cega: grava o veredito dele em `vereditos/<lente>.json` da ronda; o refutador: grava a resposta dele em `refutacoes/` na base do arquivo; não barra nada, não sobrescreve, e avisa o que não gravou (esse arquivo volta a ser gravado à mão). Um agente da escada que termina com a linha `ESCALAR: <agente> - <motivo>`: guarda o pedido do degrau de cima. Sem a linha, o pedido sai sozinho quando o agente volta pela segunda vez seguida dizendo que terminou sem a saída do teste que passa, ou quando as travas do sworn o barraram 3 vezes ou mais no mesmo despacho e ele voltou sem essa saída (lido na transcrição do subagente; só no Claude Code). O briefing que manda gravar um arquivo com caminho entre crases e o subagente que termina sem ele: o caminho fica na sessão, e o fim do turno de quem despachou avisa uma vez (só no Claude Code) |
| a conversa vai ser compactada (só no Claude Code) | `scripts/antes-do-compact.js` | no handoff que esta sessão gravou, refaz do disco o `HEAD`, o `git status`, o próximo item do plano e as pendências; o que o Claude escreveu de julgamento fica como estava; nunca barra a compactação |
| um subagente para no limite de uso da API (só no Claude Code) | `scripts/escalar.js` | o agente da escada que o Claude Code encerrou no limite de uso (erro `rate_limit`): o pedido sai sozinho para o agente seguinte; o último da escada não é despachado de novo, porque bateria no mesmo limite, e o fim do turno manda dizer o que ficou por fazer. Outro erro da API e a sessão principal no limite ficam de fora |
| o turno termina | `scripts/portao-fecho.js` | cobra evidência, barra etapa com subitem aberto, barra o turno que gravou um handoff sem colar o prompt em bloco de código na resposta final, barra uma vez o turno que deixou sem despacho o degrau que um agente pediu, grava os contadores, avisa quando é hora do handoff |
| a sessão fecha | `scripts/fim-sessao.js` | apaga os arquivos de sessão parados há mais de 7 dias, nunca o da sessão que está fechando; o orçamento é de 1,5 s (o `timeout` do `hooks.json` não o aumenta), e a limpeza para antes disso: o que sobrar sai na próxima. Solta também, fora desse orçamento, a conta do custo e do uso da sessão, gravada em `.sworn/custo/` (ver "Custo de cada sessão") |

Cinco coisas acontecem sem você pedir:

- **As suas regras voltam em toda sessão.** O `regras.md` do projeto e o escopo em vigor são
  reinjetados também ao retomar e depois de compactar o contexto — que é justamente quando a regra
  se perde. Desde a 0.9.1 volta junto o que já foi feito na sessão: os arquivos tocados (quantos, e os 8
  primeiros), as ordens pendentes, as suas decisões e os commits, quando há, o `HEAD` de cada repositório
  onde houve arquivo tocado, e os portões que negaram alguma coisa no turno e antes dele. Se o texto passar
  de 9 mil caracteres, a lista do escopo encolhe e diz em que arquivo está a lista inteira, para o harness
  não cortar o fim.
- **Ele avisa quando é hora do handoff, e o trabalho segue.** Por gatilho contável, não por palpite. Com o modo
  contínuo, ligado por padrão desde a 0.9.0, avisam o tamanho da conversa e 6 bloqueios de portão
  ([a seção da chave](#menos-paradas-e-modo-contínuo)). Com `"modoContinuo": false`, avisam também 15 turnos
  com trabalho, 2 revisões independentes fechadas, 25 arquivos tocados, 3 decisões suas respondidas ou
  3 commits. Basta um, e os limiares se ajustam em `limiares`, no `projeto.json`. O aviso não fica só na
  tela: chega também ao Claude, que roda o handoff, cola o prompt pronto na mesma resposta e segue o
  trabalho na mesma conversa; quando ela for compactada, o sworn manda reler o handoff (detalhe abaixo).
  Você não abre chat novo nem cola nada. Funciona sem o `/sworn:init`.
- **Etapa com subitem aberto não fecha.** Com um plano ativo, dizer que a etapa terminou enquanto ela
  ainda tem caixa aberta é barrado pelo fecho. Para ativar um plano, rode na pasta do projeto:
  `node "<plugin>/scripts/plano.js" --abrir <caminho do plano>`. O `<plugin>` é a pasta onde o plugin
  está instalado; [a seção das ferramentas de linha de comando](#as-ferramentas-de-linha-de-comando),
  no fim deste README, mostra como achá-la. Caminho que não existe, ou que é uma pasta, não abre plano: o
  comando diz qual caminho conferir e sai com erro.

  O plano fica em nome da sessão que o abriu, e outra sessão aberta no mesmo projeto recebe um aviso
  de que o plano é alheio. Dentro do Claude Code o id da sessão é lido sozinho. Fora dele (num
  terminal comum), acrescente `--sessao <id>` com o id da sessão que vai executar o plano: o
  `session_id` que os hooks recebem, igual ao nome do arquivo `<id>.jsonl` da conversa, na pasta
  `.claude/projects/` da sua pasta pessoal. Sem a flag, o plano fica registrado como `sem-sessao`, e
  toda sessão recebe o aviso.
- **Plano longo se lê por fatia.** `node "<plugin>/scripts/plano.js" --fatia [<id>] [--plano <caminho>]` imprime
  só o cabeçalho do plano (o que vem antes da seção da 1ª caixa: decisões, restrições, mapa) e um item, com as
  linhas do arquivo. Sem id, sai o próximo item sem marcar; com id, a caixa que começa por ele (`- [ ] H6d`, com ou
  sem negrito), senão o título que o tem como palavra (a seção inteira), senão a linha de tabela cuja 1ª célula
  começa por ele. Cada pedaço tem teto de 16 mil caracteres, e o corte diz quais linhas ficaram de fora e o
  `offset` para lê-las com Read; uma linha que sozinha passa do teto sai cortada nele, com aviso. Id que abre mais
  de uma caixa (ou título, ou linha de tabela) traz a primeira e diz em que linhas estão as outras. Caixa dentro de
  bloco de código (``` ou ~~~, pela regra do CommonMark) não conta, nem aqui nem no próximo item do handoff. Sem
  `--plano`, vale o `plano-ativo.json`, senão a linha `Plano:` do escopo da sessão. O handoff e a reabertura depois
  da compactação já trazem esse comando, em vez de mandar ler o plano inteiro; plano todo marcado sai dito assim, e
  um caminho com caractere que o shell expande (`$`, crase, aspas, `!`) fica fora do comando (passe `--plano` à
  mão); com um deles na pasta onde o sworn está instalado, o comando inteiro fica de fora (a reabertura diz por quê). Id
  que o plano não tem e plano que não se acha saem com erro e o motivo.
- **Correção vira regra proposta.** Quando você corrige o jeito de o Claude trabalhar, ele atende o pedido,
  roda o `/sworn:learn` na mesma resposta e pergunta em 3 opções: gravar, ajustar o texto ou não gravar.
  Só grava com o seu sim.
- **A auditoria roda sozinha.** A cada 7 dias, na abertura, o plugin confere peso de instrução,
  skills repetidas, regras que se contradizem, skills paradas e atalhos sem gatilho, e só fala se algo passou
  do limite; aí o Claude roda o `/sworn:audit` no primeiro turno e leva os cortes a você em 3 opções
  (detalhe abaixo).

**Como o fecho lê o que o agente diz.** Intenção não é alegação: "vou concluir a tarefa", "antes de fechar a etapa"
e "concluindo a fase" não disparam a cobrança; "Tarefa 3: concluída", "tarefa nº 3", "a tarefa 3 já está concluída",
"onda 7b concluída" e "tarefa 1.2 concluída" disparam. Com plano ativo, o fecho cobra a tarefa citada (todas, quando
são várias) ou, sem número, a que está em andamento — nunca uma tarefa futura. Um id que o plano não tem como
cabeçalho `Tarefa N` (como `7b` ou `1.2`) é cobrado pela tarefa em andamento, nunca pela Tarefa 7 ou pela 1 por
engano. O plano ativo que não pode ser lido é avisado, e não tratado como ausente; o `plano-ativo.json` gravado com
BOM (comum no Windows) vale. O portão da "etapa com subitem aberto" lê só o formato de cabeçalho de antes do painel
`/sworn-plan`, que entende mais (ver "Ver os números a qualquer hora", abaixo).

<details>
<summary>O aviso do handoff, literal</summary>

~~~text
sworn - hora do handoff: o trabalho segue nesta conversa.

O sworn faz contas nesta conversa, e o que esta abaixo chegou ao limite (o numero depois de "limiar"):
  - 7 bloqueios de portao (acoes que o sworn negou) nesta sessao (limiar 6)

Faca assim: nada, voce nao precisa agir.
O Claude grava o handoff (/sworn:handoff, o texto que continua o trabalho) e segue nesta conversa.
Quando ela for compactada (resumida sozinha para caber), o sworn manda o Claude reler o handoff.
~~~

</details>

### O aviso de troca de chat: o que dispara, o que não, e como conferir

**Troca de chat**, o nome que o medidor usa, é o ponto em que a conversa passa o trabalho adiante: o `/sworn:handoff`
grava o texto de continuação (o *handoff*) e cola na resposta um prompt pronto. O trabalho segue na mesma conversa:
quando o harness a compacta (o resumo automático, que o `/sworn:calibrate` explica abaixo), o sworn manda reler o
handoff, e você não abre chat novo. Enquanto o Claude não relê o handoff (ou não grava o que faltava), a edição de
outro arquivo é recusada e o Claude recebe o caminho do handoff; enquanto o Claude não relê, o comando de shell
também é recusado, salvo o que lê o próprio handoff. Se o Claude encerra a resposta sem reler (ou gravar) o handoff,
o sworn o pede de novo no fim da resposta. As recusas e esses pedidos valem no máximo três vezes, somados; depois
tudo passa. Essa parte o Claude faz sozinho.
O prompt pronto serve se você mesmo quiser seguir num chat novo.
A exceção é a versão nova do sworn instalada: ela só carrega num chat novo (o `/clear` não recarrega o plugin). O
medidor usa a mesma unidade na previsão das janelas de limite: "~19 trocas de chat" quer dizer que cabem cerca de 19
trechos de conversa, cada um até o seu handoff, no ritmo de gasto dos seus últimos, antes de a janela acabar.

O aviso sai **uma vez por sessão** (mais o alarme de tamanho, abaixo), no fim do turno, e vai para dois lugares: para você (a mensagem
acima) e para o Claude, que recebe a ordem de rodar `/sworn:handoff`, colar o prompt pronto em bloco de código,
dizer numa linha que o handoff está gravado, citando o gatilho, e seguir com o próximo passo do trabalho, sem
perguntar "sigo?". Se o turno já gravou o handoff e a resposta final já tem um bloco de código
(qualquer um: o plugin não confere que é o prompt), a ordem muda: apontar para o bloco acima e seguir, sem
rodar o handoff nem colar de novo. Se o fim de turno já for de um laço de continuação, o aviso não
se soma ao laço: espera o próximo fim de turno com trabalho.

| O que conta | Chave em `limiares` | Padrão |
|---|---|---|
| turnos com trabalho real | `turnosComTrabalho` | 15 |
| revisões independentes fechadas | `revisoesFechadas` | 2 |
| bloqueios de portão (soma de todas as travas que negam) | `bloqueios` | 6 |
| arquivos tocados | `arquivosTocados` | 25 |
| decisões suas respondidas (as perguntas de escolha do Claude) | `decisoesDoDono` | 3 |
| commits que passaram | `commits` | 3 |
| tamanho da conversa, em tokens de contexto | `tokensDeContexto` | 175000 |
| alarme de tamanho: segundo aviso, firme, mesmo depois do primeiro | `tokensAlarme` | 450000 |

Basta um (com o modo contínuo ligado, só o tamanho, o alarme, os bloqueios e a sua pergunta sobre o
contexto: ver "Menos paradas e modo contínuo"). Sem `projeto.json`, valem os padrões da tabela; com ele, só as chaves que você escreve
mudam, e só com número positivo (desde a 0.7.5, `0`, negativo, texto ou `null` caem no padrão). O commit entra com 3, e não 1, porque o aviso sai uma vez só: com 1, todo mundo que commita
receberia o aviso no primeiro commit. A auditoria automática usa mais duas chaves de `limiares`, que
não são gatilho de troca de chat: `diasEntreAuditorias` e `diasSkillParada` (ver `/sworn:audit`); a lista
automática dos atalhos usa `diasEntreAtalhos` (ver `/sworn:shortcuts`).

**Perguntar também dispara.** Se você perguntar se o contexto ou a memória da conversa está bom
("o contexto está bom?", "contexto tá cheio?", "is the context ok?"), a pergunta é a resposta: o
Claude recebe a ordem de gravar o handoff e seguir na mesma conversa, e isso vale a cada vez que perguntar, não só
a primeira. Pedido que apenas cita contexto ou memória ("adicione contexto ao README", "memory leak
no módulo") não dispara. Conta só a frase que é pergunta e que fala do contexto ou da memória logo nas primeiras
palavras: "quando o contexto estiver cheio" no meio de uma mensagem longa, com a interrogação em outra frase, não
dispara. O retorno de um subagente que cita "o contexto está bom?" também não conta como pergunta
sua, nem a frase de correção que ele traz vira sugestão de `/sworn:learn`: o filtro vale também na forma como
o Claude Code 2.1.296 entrega o retorno ("Another Claude session sent a message…", seguido do retorno), e mora numa
função só, usada pelos dois ganchos.

**O tamanho da conversa conta** (desde a 0.6.2). O fim de turno não recebe esse número, mas recebe o
caminho do registro da sessão que o Claude Code grava; o plugin lê o fim desse registro e soma o
contexto da última resposta. Como o registro é gravado com atraso, a leitura pode vir um turno
atrasada. Por que 175 mil (desde a 0.7.1; na 0.7.0 era 250 mil, antes 150 mil): abrir chat novo custa o
handoff mais a rampa — o chat novo só faz a primeira edição com ~119 mil tokens. A 0.7.0 contava também a
leitura do handoff na abertura como se fosse a escrita, e a troca saía mais cara do que é. Contando só a
escrita, nas 444 sessões do autor (414 trocas medidas) cada troca custa US$ 1,56. Entre os limiares testados de 25 em 25 mil (150,
175, 200 mil...), 175 mil é o menor em que trocar no fim de turno não sai mais caro que não trocar (a 150 mil
sai mais caro): o custo total fica 1,6% abaixo do de não trocar. Mais alto, a economia cresce devagar: 200 mil,
2,6% abaixo; 250 mil, 3,2%; 350 mil, 3,5%. O padrão sem o modo contínuo é o menor limiar que não encarece, não o que mais
economiza: a conversa troca mais cedo sem pagar mais por isso (escolha do autor). Quem prefere economizar mais
grava um limiar maior, abaixo do alarme (por exemplo `250000`), em `limiares.tokensDeContexto`. Com o modo
contínuo, ligado por padrão desde a 0.9.0, o aviso sai a 250 mil: a sessão longa é o objetivo dele; o número que
você gravar continua mandando. Para medir no
seu projeto, rode `/sworn:calibrate`. O erro de ferramenta não subiu com o contexto até 500 mil. O aviso sai só no fim de turno, nunca no meio da
tarefa. **O alarme** (`tokensAlarme`) é o segundo aviso, mais firme, que sai uma vez mesmo depois do
primeiro: o Claude grava o handoff de novo, e o aviso sugere compactar a conversa à mão para baixar o custo já
(`/compact`; no Qwen Code, `/compress`). Ele sai a 450 mil, antes da faixa acima de 500 mil, onde cada chamada custa cerca de 4 vezes a de
200–300 mil. O medidor
(`/sworn-session`) usa o número ao vivo.

**Os números na tela são os que valem no seu projeto.** Com o modo contínuo ligado, o bloco que a abertura injeta
diz o aviso e o alarme com os números em vigor: o `limiares.tokensDeContexto` gravado (se for número positivo) ou
250 mil, e o `limiares.tokensAlarme`. O medidor `/sworn-session` mostra o mesmo limiar que vale, e a linha curta
(por exemplo "troca de chat em 180 mil tokens") diz quanto falta pelo gatilho mais perto entre os que podem
disparar, sem os cinco que a chave cala. Com `"modoContinuo": false`, nada disso muda.

**Voltar a um chat grande parado** (desde a 0.8.4). O Claude Code guarda a conversa em cache por 1 hora; depois disso,
a mensagem seguinte regrava a conversa inteira, a preço de escrita de cache (o dobro da entrada). Nas conversas do
autor, 64 de 64 voltas com mais de 1 hora parado perderam o cache; nas de 200 mil tokens ou mais, a volta custou US$
119 em 44 dias, contra uns US$ 23 se cada uma tivesse sido um chat novo. Por isso, quando você manda mensagem num
chat de **200 mil tokens ou mais** que ficou **mais de 1 hora parado**, o sworn para essa mensagem antes do
Claude, e você vê quanto custa continuar ali contra abrir um chat novo. O aviso sai depois de "Operation stopped by
hook:" (o prefixo é do Claude Code) e não repete o que você digitou: a sua mensagem fica no chat como mensagem normal.
Para seguir no mesmo chat, mande de novo: o aviso sai uma vez por pausa.

Na mesma hora, sem chamar o Claude, o sworn grava um **resumo do chat** em
`.sworn/handoff/AAAA-MM-DD-retomar-<8 primeiros do id do chat>.md` (desde a 0.11.0; até a 0.21.1, em
`.claude/sworn/handoff/`): os seus últimos 5 pedidos e as últimas 3 respostas do Claude, com a hora, sem os blocos que
o Claude Code injeta (lembretes, instruções do navegador) e cortados em ~600 e ~800 caracteres; os últimos 20 arquivos
mexidos; a frente, o plano, o último handoff do modelo e o que está modificado sem commit na raiz (`git status`). Teto
de 10 KB; chave de API reconhecida sai como "[segredo omitido]". O aviso traz o prompt pronto para colar no chat novo,
apontando o resumo (e o handoff do modelo, se ele foi gravado depois do seu último pedido). O resumo é um retrato do
registro do chat, não o handoff do modelo: o chat novo confere no disco e, se precisar, roda o `/sworn:handoff` ali,
pagando só a abertura. Se o resumo não sair (registro do chat ilegível, disco cheio), o aviso diz "Sem resumo" e
sugere colar no chat novo o prompt do último handoff. A pasta `.sworn/handoff/` é a mesma do handoff do modelo. Ela
fica fora da `.claude/` porque lá o Claude Code para e pede a sua permissão antes de o modelo gravar; aqui o handoff
grava sem você aprovar nada. Os handoffs antigos, em `.claude/sworn/handoff/`, seguem valendo onde estão: não é
preciso movê-los. Para o resumo e o handoff não aparecerem entre os arquivos novos sem commit, acrescente `.sworn/` ao
`.gitignore` do projeto: uma linha que ignora a `.claude/` não cobre a pasta nova. O custo de continuar é o contexto
vezes a escrita de 1 hora do modelo; o do chat novo, a primeira chamada típica de um chat novo (68.723 tokens, a
mediana medida), que é o piso, porque o chat novo ainda relê arquivos depois. Os valores são preço de API (a tabela do
plugin); no plano por assinatura, viram consumo do limite. Modelo fora da tabela: o aviso sai sem o valor em US$. Se o
plugin não conseguir ler o registro da sessão, a mensagem passa. Desliga com `"avisoDeVolta": false` no
`projeto.json`.

**O que não dispara:** erro de medição (contagem errada, número lido do lugar errado). Hook não o
enxerga — ele dispara em ferramenta —, então o plugin não finge contá-lo. Para esse, vale a sua
pergunta acima.

**Como conferir que os ganchos rodam:** ao abrir a sessão aparece a linha
"sworn: lendo o estado do repositorio". Se ela não aparece, o `node` não está no `PATH` — todo
gancho é um script `node` — ou o plugin não está ativo; `claude plugin list` mostra o segundo caso.

**Ver os números a qualquer hora:** quatro comandos que vêm com o plugin, sem instalar nada à parte. Eles
são *mods* (extensões que o próprio Claude Code roda dentro da sessão) e só existem no Claude Code 2.1.287
ou mais novo. Se `/sworn-session` não aparecer, há três causas: o Claude Code antigo (rode
`claude --version` e atualize); o sworn antigo, de antes da 0.6.0, que não traz os mods (rode
`claude plugin update sworn@sworn-local`, ver "Para atualizar à mão" acima; o `/sworn-review` só vem a partir
da 0.54.0, e o `/sworn-replay`, da 0.55.0); ou a sessão aberta antes da atualização (abra uma sessão nova, porque os comandos são registrados
quando a sessão começa). O nome leva hífen,
e não os dois-pontos dos outros comandos do sworn, porque comando de mod não leva o prefixo do plugin: com
dois-pontos no lugar do hífen, o Claude Code responde que o comando não existe. `/sworn-session` responde o
medidor da sessão em cinco blocos com título: **Contexto e limites** (o contexto usado e as janelas de 5 horas e da
semana, com a hora em que renovam), **Gasto** (desta sessão e do mês), **Previsão** (em quantas respostas o
contexto enche e em quantas trocas de chat cada janela acaba), **Troca de chat** (os sinais da tabela acima que
valem, com o valor e o limiar, o mais perto do limite primeiro, e numa linha só os que o modo contínuo desliga) e
**O que fazer**. A previsão em respostas só sai depois de 2 respostas com consumo; antes disso, o bloco diz quando
ela aparece. O gasto do mês soma duas fontes: o custo real de cada sessão em que
o mod estava carregado, guardado pelo próprio Claude Code entre sessões, e, para as outras, uma estimativa pelas
transcrições do mês de todos os projetos, com a tabela de preço do `/sworn:calibrate`. Em assinatura, os dois são
valor equivalente de API, não cobrança. A primeira leitura do mês leva algumas medidas, e até lá o número sai com
"+ (somando)". A previsão das janelas em trocas de chat (o que é uma troca de chat está no começo desta seção) vem
da média das últimas 5 sessões medidas dentro da mesma janela; com menos de 2 sessões medidas, ela não aparece.
`/sworn-plan` responde o painel do plano:
tarefas feitas e abertas, a próxima, o que falta, as sessões gastas e a estimativa das que faltam, com a base da
conta (como o painel encontra o plano e faz a conta, logo abaixo). Sem plano nenhum (nenhum plano ativo, nenhuma frente
ligada à sessão e nenhum plano anotado no escopo ou nas frentes), ele responde "Nenhum plano ativo" e o comando
`--abrir` com o caminho do script na sua máquina. No terminal, no app Desktop e no chat da extensão do VS Code, o
medidor também fica na linha de status, em uma linha só
(`contexto 24% · 5h 4% até 13:50 · semana 18% · mês US$ 3.311 · sessão US$ 7,52 · troca de chat em 180 mil tokens`).
O fim da linha diz quanto falta para o aviso de troca de chat, na unidade do sinal mais perto (tokens, ou "1 decisão
do dono" sem o modo contínuo); quando um sinal dispara, vira `troque de chat → /sworn:handoff`, e depois do aviso,
`troca já avisada → /sworn:handoff`. O detalhe de cada sinal fica no bloco **Troca de chat** do
`/sworn-session`. Uma faixa acima do prompt mostra o plano da sessão (`plano 082 · 2 de 7 tarefas · próxima:
Tarefa 3 — barra do medidor...`, ou `concluído (6 de 6 tarefas)` quando nada falta): o plano ativo, o da frente
ligada à sessão ou o do `escopo.md`; chat sem plano não mostra plano de outra frente. O cache do chat dura 1 hora
depois do fim da última resposta do agente principal; vencido, a próxima mensagem regrava a conversa inteira no
cache, bem mais caro que reaproveitá-la. Nos últimos 10 minutos, com 50 mil tokens de contexto ou mais e nenhum
turno rodando, a faixa ganha a linha `cache esfria em 8 min; depois disso a próxima mensagem regrava 180 mil tokens
(≈ US$ 1,44). Mande uma mensagem antes disso para poupar.`, que passa de minuto em minuto e some quando o cache
vence. O custo é o da regravação pelo preço do modelo da sessão na tabela de preços do `/sworn:calibrate` (a coluna
da escrita de 1 hora); modelo fora da tabela, a linha sai sem o custo. Enquanto uma ronda da revisão cega roda (o
`/sworn:review` despachou inspetores e ao menos um não respondeu), a faixa ganha a linha `revisão cega, ronda 2: 5
de 8 inspetores prontos (sonnet), US$ 0,42 até agora`, que muda a cada inspetor que começa ou termina e some quando
o último responde. A ronda e o arquivo saem do caminho dos vereditos que cada inspetor recebe; os lotes da mesma
ronda somam (até 10 minutos depois de o lote anterior terminar), e a ronda seguinte recomeça a conta. O custo é o
que cada inspetor gastou, pelo preço do modelo dele na tabela do `/sworn:calibrate`; o inspetor com o modelo fora
da tabela, ou que terminou sem o uso informado, entra como "sem custo conhecido", fora da soma. Um inspetor sem
resposta há 30 minutos ou mais deixa de contar como rodando, e a linha diz quantos estão "sem resposta" e aponta o
`/sworn-review`; ele parou e não vota, e o passo é pedir ao Claude que o despache de novo na mesma ronda. Parada a
sessão, a faixa se refaz a cada minuto, então o inspetor parado sai dela sozinho. `/sworn-review` (com hífen; ele só
mostra, quem começa a revisão é o `/sworn:review`) responde o detalhe: o que roda agora, somando os arquivos; cada
arquivo e ronda da sessão com os inspetores prontos e o custo; o total; e, quando há, o que fazer com o inspetor sem
resposta e o que quer dizer "sem custo conhecido". Ele conta desde que o sworn carregou (recarregar os mods zera a
conta). Embaixo da faixa, uma frase e um botão por vez, o do comando do sworn que está na hora:

| Comando | Rótulo do botão | Aparece quando |
|---|---|---|
| `/sworn:handoff` | gerar handoff | um gatilho contável da troca de chat cruzou |
| `/sworn:review <arquivo>` | revisar | um arquivo mudado na sessão é da marcha AAA com `referencias` declarada e nenhuma revisão contra ela fechou (a mesma condição do portão da referência de topo) |
| `/sworn:learn` | virar regra | o seu último prompt pareceu uma correção (a mesma conta da sugestão, no máximo 1 a cada 5 prompts) |
| `/sworn:init` | configurar | o projeto não tem `.claude/sworn/projeto.json` |
| `/sworn:audit` | ver o que cortar | a auditoria automática da abertura achou o que cortar nesta sessão |
| `/sworn:calibrate` | calibrar | o limiar de contexto nunca foi calibrado e já há 30 conversas do projeto (contadas uma vez por dia) |
| `/sworn:playbook` | carregar o manual | um arquivo da marcha AAA mudou e o agente não carregou o manual (skill com "padrao" no nome) |

Com mais de um aceso, vale a ordem da tabela. O botão põe o comando no prompt, sem enviar, e some; volta se o sinal
dele passar e acender de novo. Se o Claude Code não deixar o botão preencher o campo de mensagem, a faixa troca o
botão por "O botão não preencheu o campo de mensagem. Digite **/sworn:handoff** e envie." (com o comando daquele
botão) até a próxima resposta. Depois de recarregar os mods, o botão do padrão pode voltar numa sessão que já
carregou o manual: o mod recomeça sem lembrar que viu o manual carregado. Não é erro; ignore o botão, ou clique, e o
manual carrega de novo (só gasta a leitura dele). Se a leitura falhar, a linha de status diz "medidor parado: a
leitura do uso falhou e volta na próxima resposta; se seguir, /sworn-session mostra a causa.", e os comandos
dizem as causas possíveis (falta o Node.js, ou o sworn falhou ou demorou) e a frase pronta para dizer ao Claude, que
procura a causa e o conserto: "ache por que o medidor do sworn parou" no `/sworn-session`, "ache por que o painel do
plano do sworn parou" no `/sworn-plan`, "ache por que o andamento da revisão do sworn parou" no `/sworn-review`
(com essa falha, a linha da revisão sai da faixa) e "ache por que o /sworn-replay parou" no `/sworn-replay`;
depois, rodar o comando de novo. Nada disso abre rede: os números vêm do
próprio Claude Code e dos arquivos na sua máquina.

**O que o último turno mudou: `/sworn-replay`.** Com hífen, como os outros comandos do painel. Ele responde no
chat, arquivo por arquivo, o que o último turno que editou arquivos mudou: o nome (relativo à pasta do projeto, ou
o caminho inteiro quando o arquivo está fora dela), quantas linhas entraram e saíram, e cada trecho mudado com a
linha onde ele está, as linhas de antes com `-` e as de depois com `+`. Linha com mais de 160 caracteres sai
cortada com `…`, e tabulação e caractere de controle saem trocados, para o texto não bagunçar o chat. Por arquivo
saem até 80 linhas mudadas e, no total, até 300; o resto fica dito ("abra-o para ver"). Só entram as edições das
ferramentas de edição do Claude (Edit, Write, MultiEdit e NotebookEdit), também as dos subagentes, que contam no
turno do agente principal; o que um comando de shell mudou não aparece. Para mostrar o antes e o depois, o sworn
copia o arquivo, antes da primeira edição dele no turno e depois de cada edição que deu certo, para a pasta
temporária do sistema (`sworn/replay/<sessão>`): as cópias ficam só nesta máquina, numa pasta que só o seu usuário
lê, nada vai para a rede, e um turno novo com edição apaga as do anterior; as pastas de sessões paradas há mais de 7
dias saem sozinhas. Ficam de fora da cópia o arquivo com mais de 1 MB, o binário e, num turno, o que passar de 200
arquivos; o `/sworn-replay` diz quando foi o caso. A edição que só trocou o fim de linha (CRLF e LF) é dita assim.
O sworn copia antes de o Claude Code pedir a permissão; na edição recusada ou que deu erro, ele apaga essa cópia
logo depois, e o arquivo não aparece (o turno em que todas foram recusadas diz isso). Se uma cópia falhar, a edição
segue igual e o `/sworn-replay` abre com um aviso de que pode faltar arquivo ou linha. Quem copia e escreve o texto é
o `scripts/replay.js`, chamado pelo painel.

**Como o painel do plano acha o plano e conta.**

- **Qual plano.** O plano ativo, se houver (o que é um plano ativo está em "Etapa com subitem aberto não fecha",
  acima). Sem ele, o plano anotado no Objetivo (o parágrafo `**Objetivo:**` do escopo): na sessão ligada a uma
  frente, o arquivo dela em `.claude/sworn/escopos/`; na sessão sem frente, o `.claude/sworn/escopo.md`. Se o
  `escopo.md` não anota plano e só uma frente anota, o painel mostra o plano dessa frente, avisa que a sessão não
  está ligada a ela e diz qual arquivo editar para ligar; com várias, lista as frentes. A faixa acima do prompt não
  faz isso: sem plano ativo, sem frente ligada e sem plano no `escopo.md`, ela não mostra plano. O `/sworn:handoff` anota o
  plano para o chat novo.
- **Como anotar.** `Plano: <caminho>`, ou `plano` seguido do caminho entre crases (`` plano `docs/x.md` ``). Com as
  duas formas no Objetivo, vale a que aponta para um arquivo que existe; se os dois arquivos existem, vale o
  `Plano:`; se nenhum existe, também vale o `Plano:`, e o painel diz que não consegue lê-lo. O caminho é relativo
  à pasta do projeto, e plano anotado fora dela não é lido (para um plano de fora, use `--abrir`).
- **Sessões gastas.** Cada sessão tem um número e o anota na caixa que marca: `- [x] passo (s12: feito)`; caixa
  feita por duas sessões leva as duas, `(s12, s13: refeito)`. As sessões gastas são os números distintos dessas
  marcas no plano (também vale por extenso, `(sessão 12: feito)`; marca entre crases é exemplo e não conta). A
  estimativa é a média de sessões por tarefa feita vezes as que faltam; sem tarefa feita, ou com o plano sem marca,
  o painel diz por quê e como anotar.
- **Tarefas.** Cabeçalhos `Tarefa`, `Item`, `Etapa`, `Onda` ou `Fase` com número. As caixas de passo mandam; sem
  elas, `[FEITO]` no cabeçalho marca a tarefa como feita. Caixa, cabeçalho e tabela dentro de um bloco de código
  (entre `` ``` `` ou `~~~`) são exemplo e não contam; o bloco que não fecha não é bloco, e o que vem depois dele conta.
- **Etapas em tabela.** Plano sem caixas de passo pode listar as etapas numa tabela cuja 1ª coluna se chama `Etapa`
  (ou `Fase`, `Item`, `Tarefa`, `Onda`), uma etapa por linha começando pelo id (`P0`, `P1`, `2b-0`; em negrito
  também vale). Linha de tabela com o mesmo tipo e número de um cabeçalho (`| 1 |` numa tabela `| Item |`, com
  `### Item 1` no plano) é resumo dele: conta uma vez só, pelo cabeçalho, e o `[FEITO]` posto nessa linha marca a
  tarefa como feita quando o cabeçalho não tem caixas, sem você editar o cabeçalho. Fora esse caso, cabeçalhos e
  linhas da tabela somam: `### Etapa 1: ...` e `### Etapa 2: ...` com uma tabela de linhas `P0`, `P1` e `2` dão
  quatro tarefas (a `2` é o resumo da Etapa 2). Vale a 1ª tabela que sobra
  depois de tirar essas linhas; linha sem id fica fora da conta, e o painel avisa quais e pede o id no
  começo da 1ª célula. Para marcar uma etapa como feita, ponha `[FEITO]` na 1ª célula dela. Ao pôr o primeiro
  `[FEITO]`, marque também as etapas anteriores já feitas: com uma marca na tabela, o painel passa a seguir só as
  marcas. Sem nenhuma marca, ele segue a última `ETAPA <id>` do Objetivo cujo id a tabela tem (as linhas acima dela
  feitas, ela em curso) e diz isso numa linha "estado pelo escopo"; sem `ETAPA` com id da tabela, as etapas ficam
  com `[?]`. A marca da sessão vai na linha da etapa, numa célula depois da 1ª
  (`| **P2** [FEITO] | ... | (s12: feito) |`).

**O medidor e o painel, nos detalhes.** A medida que chega enquanto outra mede não se perde; se a leitura de uso
travar, a linha de status diz isso e mede de novo, em vez de congelar no último número. O percentual sai inteiro, e
janela sem nome, gatilho incompleto e previsão infinita são omitidos, em vez de virar "undefined" ou "Infinity". No
painel do VS Code, o texto de "o que fazer" não emenda mais no último item. No painel do plano, o
`plano-ativo.json` e o plano gravados com BOM (a marca invisível que editores do Windows põem no começo do arquivo)
valem; o plano que existe mas não se lê é dito, em vez de "nenhum plano ativo"; e a saída JSON do
`scripts/plano.js` não conta como concluída a tarefa sem caixa de passo (ela vai no campo `semCaixas`). Com a
`--proxima-decisao` e um caminho que não existe, o `plano.js` responde `1` (projeto novo ainda sem arquivo de
decisões) **com um aviso** que mostra o caminho procurado; uma pasta no lugar do arquivo para com erro.

**Do que o gatilho de commit depende:** de o plugin ver que o `git commit` passou. Ele conta o commit
pelo `gitOperation.commit.sha` que o Claude Code informa na resposta (medido no Claude Code 2.1.258)
**ou** pela linha `[branch sha] mensagem` que o próprio `git commit` imprime — o Claude Code deixa de
preencher o `gitOperation` quando o `git -C` aponta para caminho com espaço. O `git commit -q` não
imprime a linha e **não conta**. O plugin não adivinha pelo texto do comando, que daria falso positivo
com um `echo "git commit"`, e os outros sete gatilhos seguem valendo. O gatilho de decisões depende de
o gancho receber a resposta das perguntas de escolha; esse formato foi provado no painel do VS Code
(a pergunta respondida contou).

### Aparência

O sworn tem um acento só, o âmbar dos banners: `#F59E0B` no tema escuro e `#B45309` no claro, sobre os
neutros do tema. Na faixa acima do prompt, o acento pinta a borda e o nome "sworn"; o resto do texto, os botões e
a linha de status ficam com o desenho do Claude Code (botão e linha de status não aceitam cor). No terminal e no app
Desktop a faixa usa a cor `warning` do tema do Claude Code, que acompanha o tema claro ou escuro sozinha. No chat do
VS Code essa cor não pinta, e a faixa usa `#F59E0B` direto; com o VS Code em tema claro, esse âmbar fica fraco de ler.
Só a borda e o nome "sworn" ficam fracos: a linha do plano, a frase e o botão seguem a cor do tema e se leem
normalmente, então não há nada a fazer para usar o plugin. Não há chave para trocar essa cor; se o nome fraco
atrapalhar, abra um defeito em https://github.com/wendellmcs/sworn/issues com o tema do VS Code e um print da faixa.

Todo botão sai no desenho `primary` (no VS Code, o `secondary` sai igual), e a hierarquia fica no texto: um botão
por vez, com a frase do que aconteceu antes dele. Na escrita (til, cedilha e acento agudo, não a cor), a linha de
status e as respostas de `/sworn-session` e `/sworn-plan` saem acentuadas; os avisos dos ganchos seguem sem
acentuação (o console do Windows os estraga) e têm
uma forma só: a 1ª linha diz o que falta, os caminhos vêm entre aspas, um por linha, as saídas vêm numeradas em
"Faca uma destas", e a linha de desligar, quando o aviso tem chave, vem por último.

---

## As oito travas

Cada caminho do projeto tem uma **marcha**, o nível de rigor que o `projeto.json` declara para ele:
`rapida` (texto, documentação, config), `padrao` ou `aaa`. Marcha rápida não exige escopo — sem
burocracia onde não há risco.

| # | Trava | O que bloqueia | Custo em execução |
|---|---|---|---|
| 1 | Entrevista → configuração sob medida | Nada. Gera a configuração do projeto pelo comando `/sworn:init`. | tokens 1× por projeto, com teto declarado |
| 2 | Revisão cega A/B por lentes distintas | Nada. Apura por script, pelo comando `/sworn:review`. | tokens só quando invocado |
| 3 | Fecho sem evidência | O fim do turno, quando a resposta alega sucesso sem colar a saída, ou colando só saída que mostra falha, ou um bloco que não confere com nenhuma saída de ferramenta da sessão; quando o último teste rodado na sessão falhou; ou quando a prova de pronto do projeto (`provaDePronto`) não rodou depois da última edição de código. Declarar o que não rodou, ou que a falha segue, sempre libera. Hook `Stop`. | zero |
| 4 | Arquivo fora do escopo declarado | A escrita, quando o alvo não está no `.claude/sworn/escopo.md` (ou, com a sessão vinculada a uma frente, em `.claude/sworn/escopos/<frente>.md`). Hook `PreToolUse` em `Write` e `Edit`. | zero |
| 5 | Comando destrutivo e sessão concorrente | O comando que apaga, o `cd` solto (a pasta muda para o comando seguinte; no `Bash` o comando é corrigido para rodar num subshell, no `PowerShell` é negado), a armadilha do shell no `Bash` (o comando que faria outra coisa do que parece) e a escrita em arquivo que outra frente já mexeu: o que já vinha modificado na foto do `git status` da abertura, ou o que outra sessão do sworn escreveu depois que esta abriu e segue sem commit (a edição feita à mão, fora do chat, não conta). Hook `PreToolUse` em `Bash` e em `Write`/`Edit`. `travas.destrutivo: false` desliga o comando que apaga, o `cd` solto e a armadilha do shell juntos. | zero |
| 6 | Agente caro, modelo ou esforço trocado, pedido de subida esquecido | • O despacho de um agente da metade mais cara da escada, arredondada para baixo (com 2 ou 3 agentes, o topo; com 4 ou 5, os dois de cima), quando o escopo declarado só tem caminhos de marcha `rapida`.<br>• A chamada de um agente da escada com `model` ou `effort` diferente do que `agentes.degraus` grava, negada com a chamada certa escrita.<br>• Uma vez por pedido, o fim do turno com um pedido `ESCALAR:` de subagente ainda não despachado.<br>Os dois primeiros pelo hook `PreToolUse` em `Task`/`Agent`; o terceiro pelo hook `Stop`. Conta **todo** despacho, inclusive os que permite. | zero |
| 7 | Criar sem ter procurado | A criação de arquivo **novo** quando nada foi buscado antes no turno. O próprio sworn procura os arquivos de mesmo nome (os versionados e os da pasta do alvo): sem nenhum, a criação passa; com algum, nega e os lista; fora de um repositório git, nega como sempre. Editar arquivo existente nunca é barrado — quem edita já achou —, e nomear o arquivo no `escopo.md` também libera: declarar já é deliberar. | zero |
| 8 | Catraca afrouxada | A edição que **sobe um teto** ou **desce um piso** (`teto`, `limite`, `maximo`, `tolerancia`; `minimo`, `piso`, `cobertura`). Apertar a régua passa sempre; afrouxar é decisão humana, não efeito colateral de uma correção. | zero |

As travas 3 a 8 são portões de custo zero. **Sem `/sworn:init`, só as travas 3 e 5 funcionam** — e a 3
sem a parte da prova de pronto, que vem do `projeto.json` que o init grava.
As travas 4, 7 e 8 moram no portão de escrita, que sem `.claude/sworn/projeto.json` só avisa, uma
vez por sessão, e libera. O módulo de design mora no mesmo portão, mas vale sempre que existir o
`.claude/sworn/design.json`, com ou sem o `projeto.json`. Com o `projeto.json`, a
trava 4 liga: escrita em caminho de marcha `padrao` ou `aaa` exige um `.claude/sworn/escopo.md`
declarado, e sem ele a primeira escrita é negada com a instrução de declarar. A marcha `rapida` não
pede escopo nem a busca da trava 7, mas a trava 8 e o módulo de design valem nela também. A trava 6 precisa,
além do `projeto.json`, da escada de agentes gravada nele: sem a escada, ela conta o despacho e não
opina.

Quantas vezes cada trava disparou neste projeto. Rode na pasta do projeto, trocando `<plugin>` pela
pasta onde o plugin está instalado ([como achá-la](#as-ferramentas-de-linha-de-comando)):

```
node "<plugin>/scripts/uso.js"
```

Ele lê `.claude/sworn/contadores.json` e lista os disparos em ordem decrescente, com o total.
É daí que sai o que entra na v2 — não da matriz da pesquisa.

O que os portões leem, além do que a tabela diz:

- **Comando destrutivo.** O portão barra também o `git push` forçado com `-f` agrupado a outras opções, o `git clean`
  com o `-f` depois de outra opção, o `git checkout`, o `git restore` e o `git switch` que descartam a árvore
  inteira (inclusive o `git restore` com opção antes do `.`, como `-q`, `--ours`, `--theirs`, `--merge`,
  `--conflict=` ou a abreviação `--work` de `--worktree`) e a escrita direta em disco (`mkfs`, `dd if=`). Barra
  também o `git commit` que pula a checagem do projeto: `--no-verify` (ou `-n`, sozinho ou agrupado, como `-anm`)
  pula os ganchos do commit, e `--no-gpg-sign` pula a assinatura. Só a opção do commit conta: a mensagem que cita
  `--no-verify`, o argumento do `-m` (`-mnovo` é a mensagem "novo") e o que vem depois do `--` passam, e vale a última
  opção, como no git (`-n --verify` volta a rodar os ganchos). Opção global do `git` com valor entre aspas não escapa. Seguem liberados `git checkout -- <arquivo>`,
  `git restore --staged .`, `git restore --staged -q .` (só o índice) e `git restore -p .` (interativo). Padrão
  inválido em `comandosLiberados` não libera nada.
- **`cd` solto no `Bash`.** O comando corrigido para rodar num subshell não conta como bloqueio para o aviso de
  troca de chat. O aviso ao Claude sai inteiro na primeira correção da sessão (desde a
  0.9.1). Nas seguintes, até a 0.23.x saía uma linha curta; desde a 0.24.0, o comando é corrigido sem aviso. Seguem negados o `cd` solto no `PowerShell`, o comando que termina em barra e o que o portão não
  consegue ler inteiro.
- **Armadilha do shell no `Bash`** (desde a 0.24.0). O comando não roda, e o aviso traz o conserto, em três casos:
  o heredoc com o delimitador sem aspas (`<<EOF`) e barra invertida dupla, ou barra no fim de linha, no corpo (o
  bash come a barra; com aspas, `<<'EOF'`, o corpo vai como está); o `grep -c` logo antes de `&&` (quando conta 0, o
  grep sai com erro e o resto da cadeia não roda; troque o `&&` por `;`); e o `grep -P` (não o `git grep -P`, que não depende disso) num projeto com a
  plataforma `win32` declarada no `projeto.json` (o grep do Git Bash sai com erro sem a configuração de idioma
  UTF-8; escreva `LC_ALL=C.UTF-8 grep -P ...`, ou use `grep -E`). Na procura do `grep`, o texto entre aspas, como a
  mensagem de um commit, e o corpo de um heredoc não contam. Desde a 0.87.0, mais quatro casos:
  - a crase dentro das aspas duplas do código de `node -e`/`-p`, em qualquer sistema. O bash roda o que está entre as
    crases antes do node; use aspas simples em volta do código, ou barra antes da crase. A crase solta passa, porque
    aí a substituição é de propósito.
  - com `win32` declarada, o `sed -i` sem `-b`, que regrava o arquivo sem o `\r`; use `sed -b -i`.
  - com `win32`, o caminho do Git Bash (`/c/...`) numa string do código do node, que o node não entende; escreva
    `C:/...`.
  - com `win32`, o `/tmp` numa string do código do node, que vira `\tmp` na raiz do drive (`C:\tmp`); use
    `require('os').tmpdir()`.

  Conta no balde `armadilha_shell`.
- **Recibo da prova e saída enxuta** (desde a 0.87.0). Cada comando de teste rodado no `Bash` ou no `PowerShell`
  deixa um recibo no estado da sessão: o comando, se saiu verde, o código de saída e, quando houve corte, onde está a
  saída inteira. Os executores conhecidos estão em `modelos/resumidores.json`: `node --test`, jest, vitest, pytest,
  `go test`, `cargo test`, `dotnet test`, maven, gradle e mocha. O teste que falha chega ao Claude inteiro, sempre. No
  Claude Code, a saída verde de mais de 2 mil caracteres, de um comando simples (sem `|`, `;`, `||`, redirecionamento
  nem segundo plano), chega ao Claude só com as linhas do resumo do executor (até 40) e o caminho da saída inteira,
  gravada em `.sworn/provas/`. A pasta tem um `.gitignore` próprio, que a deixa fora do git, e guarda os 20 logs mais
  novos. Na trava 3, o bloco colado com a alegação de sucesso só vale se uma mesma saída de ferramenta da sessão (ou o
  resumo de um recibo) traz uma linha dele, copiada como saiu, e cada linha de contagem dele (`tests 12`, `1 failed`).
  A linha resumida em pedaços (`tests 12 | pass 12 | fail 0`) vale quando cada pedaço aparece nessa saída. Sem o
  transcript legível, ou com o bloco só de pedaços curtos, vale a regra de antes.
  `"saidaEnxuta": false` desliga o corte; o recibo e a conferência do bloco seguem.
- **Custo de cada sessão** (desde a 0.87.0). Ao fechar a sessão, num projeto com o sworn configurado, um processo à
  parte soma o uso do transcript e dos subagentes dela (os de workflow também), uma vez por mensagem, e grava
  `.sworn/custo/<sessao>.json`: entrada, saída, cache lido e escrito, a estimativa em dólares pela tabela de preço do
  plugin (o valor de API, não a cobrança do plano) e quantas vezes a saída enxuta cortou um verde, com os bytes que o
  Claude deixou de ler. A mensagem de um modelo fora da tabela conta à parte, nunca como zero. A pasta tem um
  `.gitignore` próprio e guarda os 200 registros mais novos. A sessão retomada regrava o mesmo arquivo; a que o
  harness fecha antes do processo terminar fica sem registro. Para ler, `node "<plugin>/scripts/custo-das-sessoes.js"`
  (na tabela das ferramentas de linha de comando).
- **Vermelho antes de verde** (desde a 0.87.0, trava 3). O arquivo de teste que o Claude edita (pelo nome:
  `*.test.js`, `*.spec.ts`, `test_*.py`, `*_test.go`, `*_spec.rb` e afins; o ajudante e a fixture da pasta de teste não
  contam) precisa aparecer falhando depois da edição. O recibo de um comando de teste que falha com o código do
  executor, ou cuja saída mostra falha, tira da lista os testes que ele cobre: os que ele cita, pelo caminho ou por glob
  (`test/*.test.js`), ou todos, quando não cita nenhum arquivo de teste (a suíte, a pasta, o filtro por nome). A falha
  interrompida, ou sem código (o tempo do shell que acabou), não conta. A alegação de pronto com teste editado sem esse
  vermelho barra uma vez no fecho; editar o teste de novo pede outro vermelho. O teste que já falhou antes, ou que só
  mudou texto, passa com uma linha da resposta que abre com `SEM VERMELHO: <motivo>`, que também limpa a lista. A edição
  de um subagente não entra. Conta no balde `teste_sem_vermelho`. `"vermelhoAntes": false` desliga. É a ideia do
  `nizos/tdd-guard` (MIT), feita sem modelo.
- **Estado.** Se a pasta onde o plugin guarda o estado não aceita escrita, nada que estaria barrado passa por causa
  disso. E o `projeto.json` que existe mas não é um JSON válido é dito como inválido, e não como ausente, também
  na abertura.
- **Catraca.** `max-width`, `min()`, `maxWidth` e a variável local `max` ou `min` deixam de ser régua; a constante
  em caixa alta, o nome com sufixo e o número com unidade seguem sendo. A anotação de tipo entre o nome e o número
  não esconde a régua.
- **Token fora do design system.** O seletor de id com letras hexadecimais (como `#add-btn`) não é cor; cor em
  valor de várias linhas, em argumento de mixin e em fallback de `var()` é achada; comentário de bloco é respeitado.

<details>
<summary>O que cada portão responde quando nega — saída literal desta versão</summary>

Rodado contra um projeto de exemplo com este escopo:

```markdown
# Escopo
**Objetivo:** corrigir o calculo do frete no carrinho.
## Dentro
- src/carrinho/**
- test/carrinho.test.js
- test/cobertura.json
## Fora de escopo
- src/pagamento/**
```

**Trava 4 — arquivo fora do escopo** (`Edit` em `src/usuarios/perfil.js`):

~~~text
sworn - portao de escopo (trava 4 - o escopo da tarefa).

O arquivo src/usuarios/perfil.js (marcha padrao: o nivel de rigor que o projeto.json da a este caminho) NAO esta no escopo declarado em .claude/sworn/escopo.md.

Escopo atual:
  - src/carrinho/**
  - test/carrinho.test.js
  - test/cobertura.json

Escolha uma:
  1. nao edite este arquivo; se achou um defeito nele, conte ao usuario no fecho do turno, sem corrigir;
  2. se ele e mesmo parte do pedido, acrescente-o ao escopo e diga por que.

Ampliar o escopo e contado e aparece no fecho do turno.
~~~

**Trava 4 — o que o escopo declara "Fora"** (`Edit` em `src/pagamento/cobranca.js`):

~~~text
sworn - portao de escopo (trava 4 - o escopo da tarefa).

O arquivo src/pagamento/cobranca.js casa "src/pagamento/**", que o escopo declara FORA desta tarefa.

Escolha uma:
  1. nao edite este arquivo; se achou um defeito nele, conte ao usuario no fecho do turno, sem corrigir;
  2. se a tarefa mudou, reescreva .claude/sworn/escopo.md e diga por que.
~~~

**Trava 4 — intocável** (`Write` em `.env`, que o `projeto.json` lista em `intocaveis`):

~~~text
sworn - arquivo intocavel: mexer nele e decisao do dono.

Este arquivo esta na lista "intocaveis" de .claude/sworn/projeto.json:
  - ".env"
Nem o escopo declarado libera este caminho.

Faca uma destas:
  1. siga sem mexer nele; se ele precisar de mudanca, conte ao usuario no fecho do turno;
  2. ou peca ao dono que decida: 3 opcoes, a recomendada primeiro, cada uma com o que muda e o custo.
~~~

**Trava 5 — comando destrutivo** (`git reset --hard origin/main` pelo `Bash`):

~~~text
sworn - comando destrutivo barrado (trava 5): siga por outro caminho, sem parar o trabalho.

Comando: git reset --hard origin/main
Por que barrou: git reset --hard descarta trabalho nao commitado.

Faca uma destas:
  1. siga sem ele, por outro caminho que nao destroi, nao descarta e nao publica nada;
  2. ou termine o resto e diga ao dono, na resposta final, que este comando ficou para ele rodar.

So o dono libera: ele mesmo roda o comando, ou acrescenta o padrao em "comandosLiberados" de .claude/sworn/projeto.json.
~~~

Quando o comando é um apagar simples, com o nome escrito por inteiro (`rm -rf build`, `Remove-Item -Recurse build`,
`cmd /c rd /s /q build`), o aviso mostra logo depois do porquê o que ele apagaria, para o dono decidir vendo o alvo.
Cada alvo sai com a contagem de arquivos e pastas e o tamanho, mais os dez primeiros arquivos pelo nome. O que não
existe também aparece, o atalho sai como só o atalho, e a pasta sem leitura diz que não foi conferida. O nome com
acento sai pelo código (`ação`), nunca como `acao`, que seria outra pasta. O caminho de
rede não é conferido. A contagem para em 2000 itens e diz até onde chegou. O comando é lido como o shell que o roda
lê: flag que o sworn não conhece (o `-Filter` do PowerShell, o `/s` do `del`), curinga, variável ou mais de um
comando na linha deixam o alvo incerto, e o aviso sai sem a lista:

~~~text
O que ele apagaria:
  pasta "build": 132 arquivo(s) em 9 pasta(s), 4,1 MB
    build/app.js
    build/app.js.map
    ...
    ... e mais 122 arquivo(s)
~~~

Ler como o shell lê vale para as aspas, os separadores e as opções. A trava 5 não vê o nome do comando que o shell
só monta na hora de rodar, e por isso estes **passam** (cada um conferido em teste): o nome do comando montado
(`rm${IFS}-rf${IFS}x`, `r\m -rf x`, o nome do comando numa variável, `$X -rf x`, ou vindo de uma crase, `` `echo rm` -rf x ``), o
apagar por outro interpretador (`python -c` com `shutil.rmtree`, `perl -e`, `node -e` com `fs.rmSync`) e o
`find -delete`. O apagar no fim do cano (`Get-ChildItem -Recurse | Remove-Item`, `ls | xargs rm`,
`gci | % { rm $_ }`) e o `del /f` do cmd, mesmo sem `/s`, **barram**: o primeiro apaga cada item que o comando
anterior lista, e o segundo força o apagar, até do arquivo somente leitura. Depois do cano, o apagar só com nomes
escritos e sem `xargs` (`echo y | rm -i a.txt`) passa: ele apaga o nome, não o que o cano lista. A exceção é o
projeto com escopo declarado: ali, o apagar por código dentro do shell (`fs.rmSync`, `os.remove`, `[IO.File]::Delete`)
é barrado, porque não tem nome de arquivo para conferir. Para barrar o que passa, acrescente o padrão em
`comandosBloqueados` do `projeto.json`. Dois casos barram sem apagar nada, e ficam assim porque a leitura é por
texto: o `echo` que cita `dd if=... of=...` e o `rm -f 2>&1` sem alvo (o `&` parte a linha, e o alvo poderia vir
depois dele). Para esses, o dono roda o comando, ou acrescenta o padrão em `comandosLiberados`. O redirecionamento não
conta como alvo do `rm` (`rm -f >/dev/null` passa), e o `git checkout main *` barra: ele sobrescreve os arquivos com
a versão do `main`.

**Trava 7 — criar sem ter procurado** (`Write` de `src/carrinho/frete-novo.js`, sem busca no turno, com um
`src/legado/frete-novo.js` no projeto; sem arquivo de mesmo nome, o próprio sworn procura e a criação passa):

~~~text
sworn - arquivo novo barrado (trava 7): ja existe arquivo com o mesmo nome; leia antes de criar.

Alvo: src/carrinho/frete-novo.js  (nao existe ainda: isto e criacao, nao edicao)

O sworn procurou por voce e achou arquivo(s) com o mesmo nome (ate 10):
  - src/legado/frete-novo.js

Por que: o risco e criar uma copia ao lado do que ja existe.
Leia esses arquivos e diga na resposta o que achou. Se nenhum serve, procure
mais (a busca de texto Grep, a de nome Glob, ou um grep/find pelo shell) e crie:
depois de uma busca neste turno, criar arquivo novo fica liberado.
~~~

**Trava 8 — catraca afrouxada** (`Edit` que troca `"minimo": 80` por `"minimo": 60`):

~~~text
sworn: NEGADO - esta edicao afrouxa um limite de qualidade (o numero que um teste ou checagem
usa como regua), e afrouxar esse limite e decisao do dono, nao do agente.

Arquivo: test/cobertura.json
  minimo: 80 -> 60  (o piso, o minimo exigido, desceu: agora exige menos que antes)

Por que barra: quando um teste ou checagem atrapalha, e tentador afrouxar o numero que o mede.
O que fazer: refaca a edicao com o numero da esquerda do "->" acima (o de antes) e corrija
a causa da falha, nao a regua.
Se o numero estiver mesmo errado: leve ao dono o numero de agora, o proposto e o motivo. A
mudanca e dele, feita a mao por ele: este portao nega a edicao ao agente mesmo com a decisao
registrada. A decisao fica onde o projeto registra as decisoes.
~~~

A trava 8 compara o arquivo inteiro, o de antes com o de depois, até 32 MB. Num arquivo maior, ela
nega qualquer edição com uma mensagem própria, que diz que o arquivo não se lê inteiro e que o
passo seguinte é dividi-lo ou pedir ao dono que faça a edição fora do agente.

**Portão do prompt do handoff** (o turno gravou `.sworn/handoff/2026-10-10-frete.md`, a
resposta final não tem bloco de código e o arquivo não tem um prompt legível; com o prompt no arquivo, o próprio
sworn o mostra a você no fim do turno e não barra):

~~~text
sworn - falta colar no chat o prompt do handoff.

Um arquivo de handoff foi gravado neste turno, e a resposta final nao tem bloco de codigo.
O prompt pronto tem de chegar ao chat, nao so ao arquivo. Esta trava do fim do turno le so a resposta final:
um bloco numa mensagem anterior deste turno ela nao ve.

Faca assim: cole o prompt agora num bloco de codigo (entre ``` ou ~~~), nesta resposta final - uma vez so.

So o dono desliga neste projeto: "portaoHandoff": false em .claude/sworn/projeto.json.
~~~

</details>

---

## Os portões que não são travas

Além das oito travas, o plugin traz portões e avisos que não entram na conta delas: ou só avisam, ou dependem de
um módulo opcional, ou têm a própria chave. Cada um abaixo diz o que faz e como desligar.

| Portão | O que faz | Como desligar |
|---|---|---|
| Decisão (`scripts/portao-decisao.js`, antes de `AskUserQuestion`) | barra a pergunta ao dono que não tem exatamente 3 opções, ou cuja primeira não traz a marca `(Recomendado)` (valem também `(Recomendada)`, `(Recommended)` e `(Recom.)`, em qualquer caixa), ou que marca a recomendada em mais de uma opção | `"portaoDecisao": false` |
| Apelido (`scripts/portao-apelido.js`, antes de `Task` e `Agent`) | confere o `model:` e o `effort:` de cada agente do projeto contra o apelido e o esforço gravados em `agentes.degraus`; se divergir, **avisa e deixa passar**, uma vez por sessão, a você e ao Claude, com o conserto em três opções (corrigir o arquivo do agente, corrigir o mapa do `projeto.json`, ou não mexer agora) | não há chave: sem a pasta `.claude/agents` ou sem `agentes.degraus` gravados ele não tem com o que comparar e fica calado |
| Estilo (`scripts/portao-estilo.js`, antes de `Bash` e `PowerShell`) | com `.claude/sworn/design.json` declarado, nega o arquivo de estilo escrito por comando de shell e manda usar `Write` ou `Edit`, que o portão de escopo confere | não ter o `design.json` (módulo opcional, sem trava) |
| Pacote novo (`scripts/portao-pacote.js`, antes de `Bash` e `PowerShell`) | no comando que instala pacote (`npm i`, `pnpm add`, `yarn add`, `bun add`, `pip install`, `pipx install`, `uv add`, `uv pip install`, `poetry add`, `cargo add`, `go get`, `dotnet add package`, `gem install`, `bundle add`, `composer require`), procura cada nome no manifesto e no lockfile da raiz do projeto e da pasta do comando; o que não está em nenhum chega ao Claude com o comando que confere o nome no registro (`npm view`, `pip index versions`...), contra o pacote inventado. Não consulta a rede e não nega: o comando segue, e quem confere é o Claude | não desliga: só avisa, e só no comando de instalação |
| Prompt do handoff (`scripts/portao-fecho.js`, no fim do turno) | no turno que gravou um arquivo de handoff e não colou o prompt na resposta final, mostra a você o prompt do arquivo; barra só quando o arquivo não tem um prompt legível | `"portaoHandoff": false` (ver "Como desligar uma trava") |
| Referência de topo (`scripts/portao-fecho.js`, no fim do turno) | barra a resposta que alega entrega quando um arquivo mudado na sessão é da marcha AAA, o tipo dele tem `referencias` declarada e nenhuma revisão contra ela fechou na sessão; a mensagem diz o comando, `/sworn:review <arquivo>` | `"portaoReferencia": false` (ver "Como desligar uma trava") |
| Revisão aprovada (`scripts/portao-fecho.js`, no fim do turno) | barra a resposta que alega entrega quando um arquivo de código mudado na sessão é da marcha AAA (de qualquer marcha, com `"revisaoTodoCodigo": true`) e não tem revisão aprovada (a mesma que libera o commit), com ou sem `referencias`; a mensagem cita os arquivos e o comando, `/sworn:review <arquivo>` | `"portaoRevisao": false` (ver "Como desligar uma trava") |
| Consulta ao advisor (`scripts/portao-fecho.js`, no fim do turno) | com o advisor do Claude Code ligado (`advisorModel` nas settings), barra uma vez por sessão a resposta que alega entrega quando um arquivo de código mudado na sessão é da marcha AAA e a sessão não chamou o advisor; a mensagem pede a consulta e diz o custo medido. Sem o advisor ligado, nada muda | `"portaoAdvisor": false` (ver "Como desligar uma trava") |
| Qualidade de resposta (a abertura) | injeta as seis regras de clareza das respostas no chat; não barra nada | `"qualidadeDeResposta": false` (ver "Qualidade de resposta") |
| Vigia (a abertura) | mostra uma vez a "novidade da semana" do plugin e, do radar da semana, quantos projetos são candidatos e quantos a ficha propõe adotar; até cada uma ser triada, lembra uma vez por dia; só para quem mantém o plugin | **desligado por padrão**, menos no repositório do próprio plugin; `"vigia": true` liga, `false` desliga |

**A pergunta de fato passa.** O portão de decisão existe para a decisão. A pergunta de sintoma, ou de um dado que só
você tem, não é decisão: ponha `(fato)` (exata, entre parênteses, em maiúscula ou minúscula) no `header`, o título curto da
pergunta, e ela passa sem a regra das 3 opções. A marca só vale no `header`: no texto da pergunta ou num rótulo, não.
A decisão sem a marca segue barrada, e a mensagem de bloqueio ensina a marca.

**O vigia, por inteiro.** É opt-in: `"vigia": true` no `projeto.json`. Sem a chave, liga sozinho só no
repositório do próprio plugin (a raiz do git com `.claude-plugin/plugin.json` de nome `sworn`). A abertura mostra o arquivo `novidades.md`
que o `scripts/vigia-puxar.js` trouxe para `~/.claude/sworn/vigia` (ou para a pasta da variável
`SWORN_VIGIA`), marcado como dado, não como instrução. Quem busca o arquivo é uma tarefa agendada, rodando o
`vigia-puxar.js`, que traz `vigia/novidades.md` do ramo `claude/vigia` de um repositório privado pelo `git`;
gancho nenhum abre rede. O arquivo só é gravado se a primeira linha for `semana: AAAA-MM-DD` válida, então um
arquivo quebrado nunca sobrescreve a última novidade boa; o script sai com 0 quando grava, 1 quando falha e 2
quando o uso vem errado (falta `--repo`, uma opção veio sem valor ou o `--espera` não é inteiro de 0 a 600). A busca que falha tenta de novo: 3 tentativas, com `--espera` segundos entre elas (30 por
padrão, de 0 a 600). Na abertura: semana nova, mostra e marca como vista. Depois, até a ficha ser triada, a abertura
lembra uma vez por dia que "a novidade de <semana> do vigia chegou e nao foi triada" (no radar, "a ficha de <semana>
do radar"), e a última linha do aviso é o comando que grava a marca:
`node "<plugin>/scripts/vigia-triar.js" --vigia --semana <semana> --como "<o que foi decidido>"` (`--radar` para a
ficha do radar), trocando `<o que foi decidido>` pelo que se decidiu (o marcador copiado sem troca é recusado).
Triada, a mesma semana fica em silêncio. A novidade sai em
até 12 linhas, e a linha longa quebra em até três, sem partir o link. Se o arquivo sumiu, não se lê, não traz a
linha `semana:`, a semana vista já tem 14 dias ou mais ou ainda está no futuro, a abertura avisa no máximo uma vez por
dia, e o aviso diz o que conferir (a tarefa agendada, o ramo da rotina na nuvem ou a data do arquivo); quando a última
busca falhou, o aviso diz quando e por quê. A abertura lê só os primeiros 256 KB do arquivo: quando ele passa disso, a
última linha da novidade avisa que o resto está só em `novidades.md`.

**O radar da semana, na mesma abertura.** Uma segunda tarefa agendada roda o mesmo `vigia-puxar.js` com
`--ramo claude/radar --arquivo radar/semana.md --destino <pasta do vigia>/radar`, e traz a ficha da semana do
`/sworn:radar`. A abertura não mostra a ficha, que é texto de terceiros: mostra uma linha só, com quantos
candidatos ela tem e quantos para adotar, e manda ao `/sworn:radar` para ver e escolher. A ficha fora do formato
diz quantos problemas tem e manda ao `/sworn:radar`, que confere a ficha e mostra cada problema. A ficha maior que
256 KB não é contada: a linha diz isso e manda abrir o arquivo da ficha, cujo caminho vem na linha de baixo (no
disco, a ficha sempre se chama `<pasta do vigia>/radar/novidades.md`, seja qual for o `--arquivo`). Vale a mesma chave `vigia` (`"vigia": false` desliga os dois) e as mesmas
regras: uma vez por semana nova, e no máximo uma vez por dia o aviso de problema e o lembrete da ficha não triada
(o comando com `--radar`). Enquanto a pasta `radar/` não existe (a
tarefa do radar nunca rodou), o radar fica calado.

**Valor entre aspas não desliga.** Todas as chaves de liga/desliga só aceitam o booleano `true` ou `false`, sem
aspas. `"portaoDecisao": "false"` não desliga nada: o portão segue ligado. Você não precisa descobrir isso sozinho. A
abertura da sessão avisa, para qualquer uma das chaves:

~~~text
sworn: ATENCAO - valor de tipo errado em .claude/sworn/projeto.json: portaoDecisao tem de ser true ou false. Para ligar ou desligar vale so true ou false, sem aspas: "false" entre aspas NAO desliga.
~~~

E a conferência final do `/sworn:init` (`scripts/validar.js`) reprova o arquivo com a mesma frase, `<chave> tem
de ser true ou false`. O `vigia`, o `revisaoTodoCodigo`, o `aberturaEnxuta` e o `provaPorArquivoTocado` são o contrário (só `true` liga), e `"true"` entre aspas também não liga. A lista das vinte e sete chaves, com o padrão de cada uma, está em "O `projeto.json` chave por chave".

---

## Qualidade de resposta

Toda sessão abre com um bloco de seis regras de clareza para as respostas que o agente escreve para você no chat:
conclusão na primeira linha, sem preâmbulo, termo técnico explicado na primeira vez, uma linha entre
ferramentas, evidência reduzida à linha que prova, e nada de repetir o que você acabou de ler. É texto
injetado pela abertura da sessão, **ligado por padrão**. O bloco, literal:

```
# sworn - qualidade de resposta (toda resposta no chat ao usuario)

1. Conclusao na 1a linha. Sai: "Vou analisar o modulo". Fica: "A suite passou; falta teste em X". Em decisao, o que muda a escolha vem antes das opcoes.
2. Sem preambulo nem cortesia. Sai: "Otima pergunta!". Bastidor da sessao (sandbox, permissao) so se o usuario tiver de agir.
3. Termo tecnico explicado na 1a vez. Sai: "quebrou no CI". Fica: "quebrou no CI (a checagem automatica)".
4. Entre ferramentas, uma linha: so fato novo. Sai: "Vou ler o arquivo". Fica: "Erro em a.js:12".
5. Evidencia: no bloco, so a linha que prova. Sai: o log inteiro. Fica: "tests 12 | pass 12 | fail 0".
6. Nao repetir o que o usuario acabou de ler ou decidir: citar onde esta. A resposta final fecha sozinha: o que mudou e o que falta, mesmo bloqueada.

Reply in the user's language; the rules hold in any. Files you write (plan, decision, handoff) are out.
Desligar neste projeto: "qualidadeDeResposta": false em .claude/sworn/projeto.json.
```

O "Sai/Fica" de cada regra está no próprio bloco: o que cortar e o que escrever no lugar.

- **Como desligar:** `"qualidadeDeResposta": false` em `.claude/sworn/projeto.json`. Outro valor que não seja
  verdadeiro ou falso segue ligado e gera o aviso "qualidadeDeResposta tem de ser true ou false".
- **Não barra nada.** Não é uma trava: nenhuma resposta é negada por causa dele. É instrução, e instrução pode ser
  pulada — por isso o recurso não entra na conta das oito travas.
- **Funciona sem `/sworn:init`.** Sem `projeto.json`, o bloco é tudo o que a abertura imprime.
- **Subagente não recebe.** Inferido, não medido: a abertura roda na sessão principal, e o bloco chega a ela.
- **Custo:** 994 caracteres por abertura, e nenhum por turno.

### O placar da medição

O bloco só entrou porque ganhou uma medição A/B cega. Doze perguntas congeladas em
`modelos/qualidade-prompts.json` (explicar, diagnosticar, usar ferramentas e decidir, três de cada; dez em português,
duas em inglês) foram respondidas em três condições: com o bloco, sem nada (a resposta padrão) e com o caveman. Cada
par foi julgado por um inspetor que não sabe qual lado é qual, nas duas ordens. O voto só conta quando as duas ordens
concordam e o inspetor cita a linha que prova; sem isso, é empate.

| O bloco contra | Vitórias | Derrotas | Empates |
|---|---|---|---|
| caveman | 12 | 0 | 0 |
| resposta padrão | 4 | 3 | 5 |

Tokens de saída, somados nas 12 execuções de cada condição: resposta padrão **30462**, caveman **12732**, com o bloco
**22888**. O bloco gasta cerca de um quarto a menos que a resposta padrão; o caveman gasta menos que os dois.

- **Medido no Sonnet; no Opus, não medido.**
- **A margem contra a resposta padrão é curta:** uma derrota a mais dava empate no placar, e empate não aprova.
- **Sobreajuste possível:** o texto do bloco foi ajustado uma vez depois da primeira rodada, olhando as derrotas destas
  mesmas doze perguntas, que não mudaram. A medição que aprovou é a mesma que orientou o ajuste.
- **Sessão longa não foi medida:** cada pergunta é uma sessão nova. O efeito pode enfraquecer depois de muitos turnos;
  a abertura reinjeta o bloco a cada compactação.
- **O instrumento vem no plugin:** `node "<plugin>/scripts/medir-qualidade.js" --gerar --modelo <nome> --destino <pasta>`, depois
  `--pares` e `--veredito` na pasta da rodada (`<plugin>` é a pasta do plugin instalado; ver "As ferramentas de linha
  de comando", no fim deste README). O julgamento de cada par fica com o inspetor do plugin, o mesmo da revisão cega.

---

## Menos paradas e modo contínuo

Desde a 0.7.0, a abertura de toda sessão injeta, entre o bloco de paralelismo e o de qualidade, a regra de
**validar pelo próprio agente antes de pedir ação manual**: rodar o teste, abrir o navegador (Claude in Chrome ou
CDP), ler o resultado, e pedir a você só o que só você pode — credencial, publicar ou implantar, tela com dado de
cliente no seu login —, tudo num pedido só.

Desde a 0.23.0, a foto de uma página sai do `scripts/capturar-tela.js`, que usa o Chrome ou o Edge que você já tem,
numa janela escondida e separada da sua, e guarda a imagem da página inteira com o que ela escreveu no console, os
erros dela e a lista do que dá para ler e clicar. No texto que vai para o disco (o endereço, o console, os erros, a
lista), os segredos que ele reconhece pela forma (um `token=`, uma senha, um cabeçalho de login, um cookie) são
trocados por `[segredo]`; um segredo escrito de outro jeito pode passar, e a imagem guarda o que estava na tela, sem
limpeza. O Claude roda o script sozinho
quando precisa; para rodar à mão: `node scripts/capturar-tela.js --url <endereço> --saida <pasta>`, que grava
`tela.png` e `evidencia.json` nessa pasta.

Desde a 0.86.0, a captura também segue um roteiro antes da foto: `--passos roteiro.json`, com
`{ "passos": [ { "acao": "digitar", "papel": "textbox", "nome": "E-mail", "texto": "ana@exemplo.com" },
{ "acao": "clicar", "papel": "button", "nome": "Entrar" }, { "acao": "conferir", "texto": "Bem-vindo" } ] }`. O
papel e o nome são os da lista do `evidencia.json` (`acessibilidade`), escritos iguais; com dois elementos iguais,
`"ordem": 2` diz qual. As ações são `clicar`, `digitar` (troca o que o campo tinha), `esperar` e `conferir` (o texto
visível da página, a presença do elemento, ou o `valor` dele: o texto do campo, ou `true`/`false` numa caixa de
marcar; um número vai entre aspas, como o campo o mostra: `"1.50"`). Para provar o caminho pelo teclado,
`{ "acao": "tecla", "tecla": "Tab" }` aperta a tecla no elemento que está com o foco (`Enter`, `Escape`, `Tab`,
`Shift+Tab`, `Space`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`), e o rastro diz onde o foco caiu depois
(`"foco": "button \"Entrar\""`). Cada passo espera até 5 s
(`"tempoMax"`, em milissegundos, muda: `10000` são 10 s; a tecla não espera). Clicar, digitar, tecla ou esperar que não dão certo param o roteiro, e
a foto mostra a página nesse ponto; a conferência que falha só fica anotada e o roteiro segue. O `evidencia.json` leva
o rastro em `roteiro`, sem o texto digitado (só quantos caracteres); a saída soma os passos e termina com o código 1
quando o roteiro parou ou alguma conferência falhou. Um clique que abre outra aba, um `confirm()` que precisa de "sim"
(a captura responde "cancelar") e o que está dentro de uma página embutida (iframe) ficam fora.

O `evidencia.json` também traz o estilo que a tela mostra de fato, do jeito que o navegador o calculou (já com as
variáveis de estilo e as regras herdadas resolvidas): a cor do texto, do fundo e da borda, o arredondamento dos
cantos, a fonte e o tamanho dela, de até 3000 elementos visíveis. Com o `.claude/sworn/design.json` na pasta onde a
captura roda, ela confere esse estilo contra o sistema e lista, no campo `estiloForaDoSistema` do mesmo arquivo, o
que ficou fora: a cor sempre; o arredondamento, o tamanho e a fonte só quando o sistema declara `raios`, `tamanhos`
e `fontes`. Uma medida em `rem` no sistema vale 16 px.

Se a tela tem um desvio declarado, diga qual arquivo a desenha: `--arquivo src/checkout/tela.css`. Sem a opção, a
conferência usa só o sistema, e um valor que o desvio liberaria aparece na lista como fora. Cada item da lista é um
valor a trocar por um do sistema, ou a pedir ao dono (no sistema ou num desvio da tela). A leitura é da página
principal: o que está dentro de uma página embutida (iframe) ou de um componente isolado (shadow DOM) não é lido;
confira esses pedaços na foto.

Desde a 0.31.0, dá para medir a tela contra uma tela de referência (a página que a ficha de referência fotografou, cujo
endereço fica na origem dos achados, ou uma página que você aponta), largura por largura:
`node "<plugin>/scripts/conferir-tela.js" --url <a tela> --referencia <a página de referência> --saida <pasta>`,
rodado da raiz do projeto. Ele fotografa as duas páginas em 1440, 768 e 390 px (`--larguras 1280,375` troca a lista) e grava o
`conferencia.json`, que diz, em cada largura, o que difere: a rolagem para o lado, o tamanho do título (h1), do
subtítulo (h2) e do texto quando passa de 2 px, a largura da coluna principal quando passa de 8 px e quantos blocos
ficam lado a lado. Desde a 0.85.0, diz também o elemento da árvore de acessibilidade (papel e nome, como "botão
Menu") que a referência tem naquela largura e a tela perde, embora o tenha em outra largura; o que só um lado tem é
conteúdo diferente e não entra. Com o `design.json`, a diferença de tamanho de texto diz também o tamanho do sistema mais perto do
da referência. O que não deu para medir de um lado (a página que não abriu, a leitura cortada numa página enorme)
entra como não comparado, nunca como igual. O comando termina com o código 0 quando tudo se comparou, e com o código 1
(falha) quando algo ficou de fora ou a chamada errou (`ERRO: ...`); as diferenças sozinhas não fazem falhar, elas se
listam. Enquanto a última conferência falhou, o portão de fecho não aceita "pronto": resolva o motivo (o endereço, o
servidor fora do ar, a chamada) e rode de novo; quando ele não se resolve (a leitura cortada numa página enorme), diga
o que ficou sem comparar e por quê, e o portão libera. Rodada com um pipe ou outro comando depois (`| tail`,
`; echo`), ela só conta como passou quando a saída mostra o resumo com tudo comparado. Cada diferença é um ajuste a fazer, ou um motivo a dizer a você. A medida não é pixel a pixel: a foto de cada largura fica na pasta, para olhar.

Na revisão cega de uma tela, o `scripts/preparar-revisao.js` faz essa foto dos dois lados: `--tela-depois <endereço>`
é a página com o trabalho, e `--tela-antes <endereço>` é a mesma página na versão anterior, rodando em outro lugar
(uma cópia do repositório em outra pasta ou em outra porta). Cada foto ganha a letra do seu lado (`A.png`,
`B.png`), a mesma do texto daquela versão, e o endereço da página some da evidência que o revisor lê: assim ele não
sabe qual foto é a nova. O endereço, a hora e a impressão digital de cada foto (o sha256, que prova que ela não foi
trocada) ficam no `mapa.json`, que o revisor não abre. Quando a revisão fecha, eles aparecem na saída do
`scripts/apurar-ronda.js`, no campo `telas`, com o antes e o depois.
Só com `--tela-depois`, o lado sem foto é o antigo, então o revisor sabe qual é o novo; para ele comparar sem saber,
passe também `--tela-antes`.

O **modo contínuo** fica numa chave, `modoContinuo`, ligada por padrão desde a 0.9.0, com ou sem `projeto.json` (só o
booleano `false` desliga). Ligado, só quatro coisas pedem troca de chat: o tamanho da conversa (aviso a 250 mil no lugar dos 175 mil, alarme a
450 mil), os bloqueios de portão (quando chegam ao limiar `bloqueios`, 6 por padrão), o incidente que exigiu
cirurgia e a sua pergunta sobre o contexto; revisões, decisões, commits, turnos e arquivos não encerram a sessão (o medidor os mostra com "modo
contínuo: não dispara"). Em troca, o Claude relê o trecho do plano antes de cada subitem, decide sozinho a escolha
técnica dentro do escopo (registra o motivo e lista no fecho) e só pergunta regra de negócio, aparência (com opções),
o irreversível ou externo e credencial, permissão ou segurança; custo dentro do pedido não se pergunta, e falha,
teste, navegador e conserto
ele faz sozinho. Desligar: `"modoContinuo": false` em `.claude/sworn/projeto.json`.

---

## Trabalho em paralelo

Desde a 0.6.2, a abertura de toda sessão injeta, antes do bloco de qualidade, quatro regras curtas: agente rodando em
segundo plano não é motivo para parar (siga com a próxima tarefa que não depende dele); agentes que editam ao mesmo
tempo rodam isolados (`isolation: worktree`); relatório de agente é alegação; e o freio de custo (o modelo mais barato
que resolve, no máximo 8 agentes por disparo). A versão completa está na skill `playbook`. Desligar neste projeto: a
chave `paralelismo` com `false` em `.claude/sworn/projeto.json` (só o booleano `false` desliga).

Com 3 ou mais tarefas independentes, o Claude **roda direto** o workflow `/sworn:parallel`, sem perguntar, e diz
numa linha quantos agentes, qual modelo e o custo (desde a 0.9.0; antes, oferecia e esperava o sim). O Claude Code só
roda workflow com pedido: a autorização dada uma vez no `/sworn:init` (abaixo) é esse pedido. O workflow
recebe a lista de tarefas (`[{"tarefa": "...", "edita": false}]`) e aplica o freio sozinho: 8 agentes por disparo
(diz quais ficaram de fora), Haiku para quem só lê e Sonnet para quem edita (cada tarefa pode pedir outro), cópia
isolada do repositório para quem edita, e cada resultado volta com a evidência que o agente colou, como alegação a
conferir.

Desde a 0.6.4, quem só lê roda no agente `reader` do plugin: abre sem as instruções do projeto e sem a lista de
skills (`omitClaudeMd` e lista fechada: `Read`, `Grep`, `Glob` e o shell, sem `Edit` nem `Write`). Medido no
`claude -p` 2.1.296: uma leitura custou 6.347 tokens, contra cerca de 56 mil no agente padrão. Quem edita segue no
agente padrão, com as regras do projeto.

**A autorização é dada uma vez, no `/sworn:init`.** Ele pergunta, e na resposta "autorizar" grava a regra
`Workflow(sworn:parallel)` em `permissions.allow` do `.claude/settings.local.json` (o arquivo pessoal do projeto,
fora do git), por script, sem tocar nas outras permissões. Medido no `claude -p` 2.1.296: com a regra o workflow roda
sem janela; sem ela, a ferramenta recusa. Na sessão interativa (terminal ou VS Code) isso não foi medido: se a janela
de aprovação aparecer na primeira execução, escolha "Yes, and don't ask again" uma vez e ela não volta neste projeto.

**O que o paralelo garante, além do teto.** O 8 é o padrão: quem chama pode pedir outro teto, inteiro de 1 a 16, em
`{"tarefas": [...], "teto": N}`. Chave de tarefa com nome errado (`edit`, `model`) é recusada com a lista das certas,
em vez de rodar calada como leitura sem cópia isolada. O `reader` traz como contar linhas nos dois shells e avisa que
o `Measure-Object -Line` do PowerShell pula linha vazia (um arquivo de 121 linhas saiu com 110), e que, sem quebra de
linha no fim do arquivo, os dois shells diferem em uma linha; medido no VS Code com a 0.6.4, três leituras custaram
38.514 tokens, contra 169.098 antes dela. A autorização do `scripts/autorizar-paralelo.js` ignora a marca invisível
(BOM) que o PowerShell 5.1 põe no `settings.local.json` e trata o arquivo vazio como sem configuração; arquivo
ilegível ou de forma inesperada **não** é sobrescrito (sai 1 e diz por quê), e uma regra igual em `permissions.deny`
vence a de `allow`. No Windows, o repositório fixa o fim de linha (`.gitattributes`), porque o Git para Windows
trocava o fim de linha de cada arquivo e o VS Code recusava o workflow antes da janela de aprovação; um teste
reprova se o workflow tiver caractere de controle.

**Papel e dono de arquivo, declarados antes.** Cada tarefa pode dizer o `papel` do agente (texto curto, que vai na
instrução e no rótulo do agente) e, se edita, em `donoDe` os arquivos que são dela:
`[{"tarefa": "...", "edita": true, "papel": "corrige o parser", "donoDe": ["src/a.js"]}]`. O mesmo arquivo em duas
tarefas para o workflow antes de gastar agente (a comparação ignora maiúscula, `\` e o `./` do começo); `donoDe` em
tarefa que só lê é recusado. O agente recebe a lista e a ordem de não editar outro arquivo, e o que ele disser em
`arquivos` (o que mudou) fora dela volta em `foraDoDono`, para quem chamou conferir antes de trazer a mudança. Tarefa
que edita sem `donoDe` roda como antes, sem essa conferência.

---

## Menos código

Desde a 0.9.0, a abertura de toda sessão injeta, por último, o bloco "menos código": antes de escrever código, o
Claude sobe uma escada de 7 degraus e para no primeiro que resolve — precisa existir? já existe no projeto (citar
`arquivo:linha`)? a linguagem já faz? a plataforma já faz? uma dependência já instalada faz? cabe em uma linha? só
então, o mínimo que funciona. Nunca se corta validação na fronteira, perda de dados, segurança nem acessibilidade.
Vale para código; texto de documento fica fora. São 714 caracteres em toda abertura.

O mesmo bloco chega aos subagentes que podem escrever código, pelo gancho `SubagentStart` (o texto da abertura fica
só na conversa principal). Os que só leem não recebem: `inspector`, `dedupe-judge`, `refuter` e `reader` do sworn, `Explore` e
`Plan` do Claude Code.

Atalho de propósito leva o comentário `atalho: <o que>. limite: <até onde vale>. trocar quando: <gatilho>.`, e o
`/sworn:shortcuts` lista todos. A nota pode continuar nas linhas logo abaixo, um rótulo por linha: `limite:` ou
`trocar quando:`, em qualquer ordem. Comentário sem rótulo na linha de baixo não entra. Se a nota não tem ponto
final, a lista avisa, embaixo do atalho, que essa linha ficou de fora. Para ela entrar, comece-a com um dos rótulos, ou
leve o resto da frase para a linha de cima. Na revisão cega, a lente `enxuto` pergunta o que dava para não escrever.
Não há número de redução medido aqui: a 0.9.0 não promete um. Desligar neste projeto: a chave `menosCodigo` com `false`
em `.claude/sworn/projeto.json` (só o booleano `false` desliga; vale para a abertura e para os subagentes).

As ideias vêm do [ponytail](https://github.com/DietrichGebert/ponytail), de Dietrich Gebert (licença MIT); o texto
é próprio.

---

## A parte visual

Quando o projeto tem interface, o visual é tratado como o resto: com referência nomeada e prova, nunca por gosto. Há
duas camadas, e a diferença importa. O script só confere o `design.json`. O resto vive na skill `playbook` e na
rubrica, e é instrução: o agente e os inspetores a seguem, e uma instrução pode ser pulada (a mesma ressalva dos
limites mais abaixo).

**A régua: `design.json` e `DESIGN.md`.** O `/sworn:init` procura sinal de design system (um `DESIGN.md`, arquivos
como `tokens.*` ou `theme.css`, uma pasta `design-system`), confirma com você que são mesmo os tokens do projeto e, só então,
grava `.claude/sworn/design.json` com `cores`, `raios`, `espacos`, `sombras` e `antiReferencias` (o que a
interface não pode parecer). O arquivo é opcional: sem ele, o módulo não existe e nada dispara. Com ele, a escrita
de arquivo de estilo (`.css`, `.scss`, `.sass`, `.less`, `.styl`) com cor ou medida em `px`, `rem` ou `em` que o
sistema não tem é negada, com a lista dos valores e o que existe no sistema; e o estilo escrito por comando de shell
é negado (portão de estilo). Medida em `%` e em outras unidades não é conferida (está na lista do que o `sworn`
não promete). A unidade vale em qualquer caixa: `13PX` é lido como `13px`. A medida de dentro de um `@media` (a largura
da tela em que o layout muda) é conferida como as outras: ela também precisa estar no sistema, ou num desvio declarado
da tela (abaixo). O estilo que mora fora dessas extensões (um `theme.ts`, CSS-in-JS) entra pela chave
`design.caminhosDeEstilo` do `projeto.json`, que o `/sworn:init` explica.

Desde a 0.23.0, a cor é comparada pelo valor, não pela grafia: `#fff`, `#FFFFFF`, `rgb(255 255 255)` e
`hsl(0, 0%, 100%)` são a mesma cor, e nenhuma delas é barrada se o sistema tem o branco (a transparência também:
`#00000080` e `rgba(0, 0, 0, .5)` são a mesma).

Na mesma versão, o `design.json` ganhou duas chaves opcionais: `tamanhos` (os tamanhos de fonte, como `"13px"`) e
`fontes` (as famílias, como `"Inter"` ou a pilha `"Inter, sans-serif"`). Sem elas, nada muda. `tamanhos` soma às
medidas aceitas: um tamanho que não está em lista nenhuma segue negado (troque por um tamanho do sistema, ou peça ao
dono o tamanho novo em `tamanhos` ou num desvio da tela). Com `fontes`, a escrita com uma família que o sistema não tem
é negada; para seguir, troque por uma das `fontes` ou por uma genérica, ou peça ao dono a família nova no sistema ou
num desvio da tela (abaixo).

Ficam fora da conferência de fonte (sempre passam):

- as famílias genéricas (`sans-serif`, `system-ui` e outras) e a fonte do sistema operacional (`-apple-system`,
  `BlinkMacSystemFont`);
- o atalho `font:`, a variável de pré-processador (`$corpo`, `@corpo`) e a função (`theme(...)`);
- o comentário `//` no fim da linha e o `font-family` de dentro do `@font-face`, que dá nome à família carregada.

Também desde a 0.23.0, uma tela que precisa de um valor que o sistema não tem ganha um **desvio declarado**: um item da lista
`desvios`, no mesmo `design.json`. Cada desvio diz em quais arquivos vale (`arquivos`), por que (`motivo`, obrigatório)
e, se quiser, até quando (`ate`, no formato AAAA-MM-DD), com os valores a mais (`cores`, `raios`, `espacos`,
`sombras`, `tamanhos`, `fontes`). Por exemplo, para o botão de pagar seguir a cor do banco até o fim do ano:

~~~json
"desvios": [
  { "arquivos": ["src/checkout/**"], "motivo": "o botão de pagar segue a marca do banco",
    "ate": "2026-12-31", "cores": ["#0050aa"] }
]
~~~

O caminho em `arquivos` tem uma pasta escrita, como `src/checkout/**`. Um padrão como `**` ou `**/*.css` pega todas as
telas e não vale: se o valor serve a todas, ele entra em `cores` (ou na chave dele) do próprio sistema. O portão aceita
os valores do desvio só naqueles arquivos, até a data; quando a escrita é negada, o aviso diz se a tela tem desvio e
como declarar um. O desvio sem motivo, mal formado ou vencido não vale, e o `scripts/validar.js` diz qual é e por
quê. Na revisão cega de um arquivo de
estilo, o pacote leva um `design.md` com o sistema e os desvios daquele arquivo, e a lente de tela reprova o valor
que não está em nenhum dos dois. Quando ela reprova, a saída é a mesma do portão: trocar o valor por um do sistema ou
declarar o desvio. Declarar um desvio é decisão sua: o Claude propõe, com o motivo, e não grava sozinho.

**As lentes de tela.** Quando a mudança é visível, o `/sworn:review` despacha as lentes de tela, uma por
inspetor (a lista está em "Por dentro de cada comando"). A rubrica completa, com a pergunta e o corte de severidade
de cada uma, está em `skills/playbook/references/02-rubrica-aaa.md`. Três delas pedem mais do que a tabela diz:

- **Estados (Lente 2): o catálogo de estados.** O componente é visto sozinho, com todos os estados lado a lado
  (padrão, hover, foco visível, desabilitado, carregando, erro, vazio e selecionado): a página dele no catálogo de
  componentes do projeto, se houver um, ou uma página de estados montada para a revisão (pode ser a página
  Artifact da escolha visual). Estado que só aparece navegando o fluxo inteiro passa despercebido. Estado ausente é P1.
- **Acessibilidade (Lente 4): contraste e alvo de toque.** O contraste tem de atingir o AA e o foco tem de ser
  visível. O alvo mede no mínimo 24 × 24 px (WCAG 2.2, critério 2.5.8, nível AA), com as exceções do próprio critério
  (alvo menor cujo círculo de 24 px, centrado nele, não cruza outro alvo; link dentro de frase; a mesma função em outro
  controle que cumpre os 24 px; tamanho decidido pelo navegador; tamanho essencial para a informação). Abaixo disso, fora das
  exceções, é P1. Status só por cor é P0.
- **Regressão (Lente 7): INP.** Em tela web, a resposta ao clique se mede pelo INP (Interaction to Next Paint, o
  tempo do clique até a tela responder): bom até 200 ms, ruim acima de 500 ms (web.dev, percentil 75). Medido acima
  de 500 ms é P1; entre 200 e 500 ms, P2. Sem medição, a lente diz que não mediu, e não presume.

**A escolha visual: mostrar antes de perguntar.** Opção descrita em texto não comunica o que se vê, e a escolha feita
sem ter visto vira retrabalho no dia seguinte. Por isso, quando a decisão que o Claude leva a você é uma escolha
visual, ele mostra primeiro e só depois pergunta:

1. **O meio preferido é uma página Artifact**, quando a sessão tem a ferramenta: uma página privada no claude.ai,
   que o Claude publica e você abre pelo link. Ela traz o antes × a proposta × a referência lado a lado, em claro e escuro,
   nas larguras de tela que o projeto declara. Sem declaração, só as que o produto comprovadamente atende: a de
   notebook, e a de celular apenas se ele roda em celular (largura que ele não atende gera achado falso).
2. **O link vai primeiro, as 3 opções no turno seguinte.** O Claude publica, espera o link confirmar e só então faz as
   3 opções, a recomendada em primeiro, dizendo numa frase o que ela **não** vai mudar.
3. **A página leva só dado fictício**, porque sai do seu computador. Tela com dado de cliente ou credencial troca
   por dado fictício antes de publicar, ou fica na imagem local.
4. **Sem a ferramenta, a imagem de sempre:** antes × proposta × referência (ou um mock fotografado com a folha
   real), enviada e confirmada antes das opções. Se a tela mostra número, o Claude declara se a veracidade do dado
   foi conferida.

**Na Marcha AAA: print antes × depois e o roteiro de 5 usuários.** Com gerador de print no projeto, a regressão de
tela se prova por comparação automática de print antes × depois, das mesmas telas e viewports, apontando o que mudou
fora do pedido. Isso se decide no começo: se não há gerador ou o ambiente não responde, o plano declara, antes de
executar, que a lente de responsividade vai por leitura de código e estilo; e, sem o instrumento, a comparação foi a
olho, e isso se declara. Em função visível nova, o fecho entrega a você um roteiro de teste de uso: a tarefa em uma
frase; 5 usuários reais, um de cada vez, fazendo sem ajuda enquanto alguém observa calado; anotar onde cada um
travou. Cinco acham a maior parte dos problemas de uso (cerca de 85%, pela curva de Nielsen e Landauer); mais que
isso repete o já visto. O roteiro não bloqueia o fecho: sai junto, sem esperar resposta.

---

## Os doze comandos

| Comando | O que faz |
|---|---|
| `/sworn:init` | A entrevista. Varre o repositório, mostra o que inferiu — marcado como inferência — e faz seis perguntas que varredura nenhuma responde. Grava sempre `.claude/sworn/projeto.json` e `.claude/sworn/regras.md`, e registra a conferência do catálogo de modelos da instalação em `.claude/sworn/catalogo.json`. O resto é opcional: `.claude/sworn/design.json` (só quando há design system) e, cada um só com aprovação explícita e sem sobrescrever arquivo que já exista, os agentes do projeto em `.claude/agents/`, a skill do projeto em `.claude/skills/<slug>/SKILL.md` e o `AGENTS.md` na raiz. |
| `/sworn:review` | Revisão cega A/B de um arquivo mudado: rotula os dois lados sem autoria, despacha um inspetor por lente, **dez** de código, **oito** de tela, e **dezoito** quando a mudança é de código e de tela, e **oito** quando é só lógica (as de código sem `design` e `medidor`; na dúvida, as dez), e **nove** quando é só de tela (as oito de tela e a do pedido, `escopo`); antes disso, a mudança pequena vai a menos inspetores (até 3 linhas, um; lógica de até 40 linhas com teste vermelho e mutação, ou texto, dois; a faixa sai do `preparar-revisao.js`, e só sobe), com default reprovar, e apura por script com teto de 3 rondas; com `referencias` declarada, compara também com a peça de topo, nas duas ordens. |
| `/sworn:learn` | Transforma uma correção sua em regra proposta no formato `gatilho -> ação`, mostra pronta, e **só grava depois de aprovação explícita**. |
| `/sworn:handoff` | Gera o texto de continuação do trabalho, que a conversa relê depois de compactada (ou um chat novo lê): caminhos, `HEAD`, em que etapa o trabalho está, decisões já tomadas, pendências e erros de método que custaram tempo. Confere os fatos no disco, não na memória. |
| `/sworn:audit` | Mede o peso de instrução do projeto contra um teto e aponta o que cortar: skills que se sobrepõem (entre si e com as do próprio sworn, como uma `padrao` do projeto repetindo o `/sworn:playbook`), regras que se contradizem e itens fora da rubrica. Não acrescenta — poda. |
| `/sworn:calibrate` | Mede, nas conversas do seu projeto, a partir de quantos tokens de contexto trocar de chat ainda compensa, e sugere o limiar de troca. **Só grava no `projeto.json` com o seu sim.** |
| `/sworn:shortcuts` | Lista os atalhos deliberados do repositório: os comentários `atalho: <o que>. limite: <até onde vale>. trocar quando: <gatilho>.` (também `ponytail:` e `shortcut:`), agrupados por arquivo, e marca `sem-gatilho` o que não diz quando trocar. Só lê; a marca muda pela chave `marcaDeAtalho`. |
| `/sworn:review-plan` | Antes de codar, confere o plano contra o disco: o `scripts/revisar-plano.js` lê cada caminho, símbolo e comando que o plano cita entre crases e diz, com a linha, o que não existe, e cobra o comando de prova de cada caixa `- [ ]` aberta. Depois, a revisão cega (`/sworn:review`) lê o plano. Só aponta; quem corrige o plano é você. |
| `/sworn:drift` | Ao fechar uma etapa, confere o código contra o plano: o `scripts/drift.js` cruza os arquivos mudados desde o commit que criou o plano (ou desde `--desde <commit>`) com o que o plano cita, e mostra o arquivo mudado que o plano não cita, a caixa feita cujo arquivo não mudou e o arquivo que a caixa feita dizia criar e não existe. Cada achado diz o próximo passo: citar no plano, desfazer, reabrir a caixa. |
| `/sworn:diagnose` | Quando uma sessão deu errado (demorou, repetiu trabalho, ignorou o plano, o sworn barrou a mesma coisa várias vezes), pergunta o que você esperava, lê as transcrições da sessão no disco, sem mexer nelas, e despacha um analista por dimensão: custo e tempo, plano, trabalho repetido, tropeços, evidência, pedidos e travas. Cada achado cita a linha da transcrição, e o `scripts/conferir-diagnostico.js` descarta o que não está lá. O relatório diz o que aconteceu, e fica em `.claude/sworn/diagnose/`; o que mudar, você decide depois, em 3 opções. |
| `/sworn:reference` | Estuda 2-3 produtos líderes do mesmo tipo do projeto, pelo que é público e em camadas (o que se vê, estados e fluxos, textos, rede e desempenho), e grava uma ficha em `.claude/sworn/referencias/<tipo>-<assunto>.md` em que cada achado diz de onde veio, com que grau (observado, derivado, inferido) e quem agiu, mais o que ficou sem saber (cada pergunta resolvida com a sua evidência). A ficha também diz quanto de cada camada se leu: completa, parcial ou desconhecida, e o que não se declarou conta como desconhecido. Página com login, só a aba que você abriu. **Só põe a ficha na `referencias` com o seu sim.** |
| `/sworn:radar` | Busca projetos públicos parecidos com o que você está construindo (até 10, por tema, pela busca do GitHub), ou uma lista que você passar, e cruza cada um com o seu projeto: triagem de todos, até 5 lidos a fundo, e uma ficha em `.claude/sworn/radar/<AAAA-MM-DD>.md` com o que vale trazer, como entra, como fica melhor que o original, esforço, valor e licença. De projeto com licença que limita o uso (ELv2, que proíbe oferecer o software como serviço; AGPL, que obriga a abrir o código de quem o usa em rede), fechado ou sem licença, só a ideia entra, nunca o código. Na dúvida sobre o encaixe, faz no máximo 3 perguntas. **Só lê e propõe: o escolhido entra com teste vermelho e revisão cega, com o seu sim.**<br>Se oferece sozinho quando você pede melhoria ou função nova (uma vez por sessão, só com o seu sim; `"oferecerRadar": false` desliga). A lista dos projetos em alta da semana (`github.com/trending?since=weekly`) é só do mantenedor do plugin, para melhorar o sworn. |

Quatro das dezesseis skills instaladas **não são comando**. A `playbook` é o manual de execução, que o agente carrega
no começo da tarefa e que traz junto a conferência do mapa de modelos deste projeto. A `design` é o roteiro de construir
uma tela (os estados de cada controle, o movimento que se justifica, o texto e o número no formato do usuário, a tela
testada com o dado do pior caso), que o sworn carrega na 1ª edição de tela da sessão. A `sworn:effort-low` e a
`sworn:effort-high` o agente chama sozinho pela marcha que classificou (Passo 0 do manual), no começo de cada turno da
tarefa, porque o esforço de uma skill dura só até o fim do turno (medido pelo sworn no Claude Code 2.1.311): a Rápida
baixa o esforço da conversa principal, a AAA sobe, a Padrão fica no esforço da sessão. Só o esforço muda: skill chamada pelo
agente não troca o modelo da conversa principal (medido pelo sworn no Claude Code 2.1.310), e a skill avisa, uma vez por
conversa, que o modelo muda pelo `/model` digitado.

Dos doze comandos, só os dois primeiros são travas — a 1 e a 2. Os outros dez **não são travas**: `learn` é o
autoaprimoramento mínimo — o plugin **não aprende sozinho**, ele transforma correção em proposta e
espera o OK; `handoff`, `audit`, `calibrate` e `shortcuts` são ferramentas de manutenção, `review-plan` e `drift`
conferem o plano contra o disco e o código contra o plano (só apontam), `diagnose` conta, com prova, o que aconteceu
numa sessão, `reference` e `radar` são as de estudo, e nenhum deles bloqueia nada.

---

## Tudo o que vem instalado

O que o `claude plugin install` coloca na sua máquina, por tipo. Nada daqui roda fora do que o Claude Code
chama: a skill é carregada quando a tarefa pede, o agente e o workflow só rodam despachados, e cada gancho
dispara no evento dele.

| Tipo | Nome | O que é |
|---|---|---|
| Skills dos comandos | `sworn:init`, `sworn:review`, `sworn:learn`, `sworn:handoff`, `sworn:audit`, `sworn:calibrate`, `sworn:shortcuts`, `sworn:review-plan`, `sworn:drift`, `sworn:diagnose`, `sworn:reference`, `sworn:radar` | os comandos da tabela acima; cada um é uma skill que você chama pelo nome |
| Skill-manual | `playbook` | não é comando: o manual de execução que o agente carrega no começo da tarefa (marchas, lentes, loop de revisão, decisão em três opções, o que um "pronto" precisa provar). Traz as seis referências listadas mais abaixo |
| Skill de tela | `design` | não é comando: o roteiro de construir uma tela (estados, foco, contraste, alvo de 24 x 24 px, movimento, texto e número, o dado do pior caso), que a rota de tela carrega na 1ª edição de marcação ou estilo da sessão. Traz o catálogo do pior caso e o aviso da licença MIT da parte adaptada das skills de Emil Kowalski |
| Skills de esforço | `sworn:effort-low`, `sworn:effort-high` | não são comando: o agente chama sozinho pela marcha, no começo de cada turno da tarefa (a Rápida baixa o esforço da conversa principal naquele turno, a AAA sobe); só o esforço muda, o modelo não (ver o parágrafo depois da tabela de comandos) |
| Workflow | `sworn:parallel` | tarefas independentes em paralelo, com teto de agentes, modelo barato e cópia isolada para quem edita; o Claude roda direto com 3 ou mais tarefas independentes (ver "Trabalho em paralelo") |
| Agentes | `inspector`, `dedupe-judge`, `refuter`, `reader` | `inspector`, `dedupe-judge` e `refuter` são da revisão cega; `reader` é o agente de leitura leve do paralelo (ver "Por dentro de cada comando" e "Trabalho em paralelo") |
| Ganchos | um script por evento | scripts `node` que o Claude Code roda em momentos fixos; a tabela seguinte lista evento por evento |
| Painéis | `/sworn-session`, `/sworn-plan`, `/sworn-review`, `/sworn-replay` | o medidor da sessão, o painel do plano, o andamento da revisão cega e o que o último turno mudou (ver "Ver os números a qualquer hora", na seção "Como funciona") |

Os ganchos, um por evento, com o que cada um deixa na sua tela:

| Evento | Script | O que faz | O que você vê |
|---|---|---|---|
| `SessionStart` (a sessão abre, reabre ou compacta) | `scripts/abertura.js` | fotografa o `git status`, reinjeta as suas regras e o escopo, injeta os blocos de paralelismo, menos paradas, qualidade de resposta e menos código e a parte "How to ask" do guia do modelo da sessão, e avisa o que está torto na configuração; sem `projeto.json`, manda perguntar se configura com o `/sworn:init`; com 30 conversas ou mais sem calibrar, manda rodar o `/sworn:calibrate` | a linha "sworn: lendo o estado do repositorio" enquanto roda; o resto vai ao contexto do Claude |
| `UserPromptSubmit` | `scripts/abrir-turno.js` | zera as marcas do turno; reconhece a sua pergunta sobre o contexto e a correção do jeito de ele trabalhar; oferece o `/sworn:radar` ao pedido de melhoria; grava o pedido em `.claude/sworn/pedidos/`; segura a primeira mensagem depois de mais de 1 hora parado numa conversa de 200 mil tokens ou mais, e grava o resumo do chat em `.sworn/handoff/` | a conta da volta, quando segura a mensagem; fora isso, nada na tela: o Claude recebe a ordem de gravar o handoff e seguir, de rodar o `/sworn:learn` ou de oferecer o radar |
| `PreToolUse` em `Write` e `Edit` | `scripts/portao-escopo.js` | escopo, intocáveis, outra frente, "Fora", criar sem buscar, catraca e design | a escrita volta negada, com o motivo e as saídas |
| `PreToolUse` em `Read` | `scripts/aviso-leitura.js` | a leitura inteira de um arquivo de texto acima de 64 KB, uma vez por arquivo na sessão | a leitura segue; o Claude recebe o tamanho e o lembrete de achar a linha com o Grep e ler com `offset` e `limit` |
| `PreToolUse` em `Bash` e `PowerShell` | `scripts/portao-shell.js`, que roda num processo só o `scripts/portao-destrutivo.js`, o `scripts/portao-estilo.js`, o `scripts/portao-commit.js` e o `scripts/portao-pacote.js` | comando destrutivo, idioma de shell, `cd` solto, estilo escrito por shell, commit sem revisão ou com segredo, push sem o cartão visto e pacote fora do manifesto e do lockfile | o comando volta negado com o motivo; o `cd` solto no `Bash` roda corrigido, e o Claude fica sabendo; o pacote novo passa, com o aviso ao Claude |
| `PreToolUse` em `Task` e `Agent` | `scripts/portao-agente.js`, `scripts/portao-apelido.js`, `scripts/portao-juiz.js` | agente caro em marcha rápida e chamada fora da tabela da escada; `model:` e `effort:` do agente contra o gravado; o modelo do inspetor da revisão cega; o guia do modelo no pedido de cada agente do sworn | o primeiro nega com o motivo e, na chamada fora da tabela, com a chamada certa; o segundo só avisa, uma vez por sessão, a você e ao Claude; o terceiro troca o modelo do inspetor da revisão cega pelo degrau acima do modelo da sessão (Haiku vira Sonnet, Sonnet vira Opus) na ronda 1 e, nas rondas 2 e 3, pelo degrau abaixo desse (a ronda sai do caminho de vereditos do briefing), põe no fim do pedido de cada agente do `sworn` a parte "How to ask" do guia oficial do modelo que vai rodá-lo, e não decide permissão |
| `PreToolUse` em `AskUserQuestion` | `scripts/portao-decisao.js` | a pergunta ao dono: 3 opções, a recomendada em primeiro | a pergunta volta negada, e a mensagem diz o que refazer |
| `PostToolUse` em `Write`, `Edit`, `NotebookEdit`, `Grep`, `Glob`, `Read`, `AskUserQuestion` e `Skill` (no `Bash` e no `PowerShell`, pelo `scripts/depois-do-shell.js`) | `scripts/marcar-trabalho.js` | marca trabalho real, busca feita e arquivos tocados; anota no registro do projeto o arquivo que a sessão escreveu (a trava 5 das outras sessões lê dele); conta as decisões suas respondidas e os commits que passaram | nada na tela: alimenta os contadores do aviso de troca de chat |
| `PostToolUse` em `Bash` e `PowerShell` | `scripts/depois-do-shell.js`, que roda num processo só o `scripts/marcar-trabalho.js`, o `scripts/conferir-depois.js` e o `scripts/recibo-da-prova.js` | o versionado que o comando mudou ou apagou fora do escopo do começo do turno (ou intocável); a saída de um comando de teste | volta pelo git, e o Claude recebe a lista do que foi restaurado; o recibo da prova no estado da sessão e, na saída verde e longa, só o resumo com o caminho do log inteiro |
| `PostToolUseFailure` em `Bash` e `PowerShell` | `scripts/recibo-da-prova.js` | o comando de teste que saiu com erro | nada na tela: o recibo da falha, com o código, no estado da sessão |
| `SubagentStart` (menos os que só leem) | `scripts/abrir-subagente.js` | injeta o bloco "menos código" no subagente que pode escrever código | nada na tela; o subagente recebe o bloco antes do primeiro pedido |
| `SubagentStop` (só dos agentes `inspector` e `refuter`) e `PostToolUse` em `SubagentHandback` | `scripts/gravar-veredito.js` | grava o veredito do inspetor em `vereditos/<lente>.json` da ronda e a resposta do refutador em `refutacoes/` na base do arquivo | nada quando grava; se algo não foi gravado, uma mensagem diz o quê e por quê |
| `PreCompact` (só no Claude Code) | `scripts/antes-do-compact.js` | refaz no handoff desta sessão as seções que vêm do disco (topologia, item do plano, pendências) | nada na tela; depois da compactação, o Claude relê o handoff com o disco de agora |
| `StopFailure` com o erro `rate_limit` (só no Claude Code) | `scripts/escalar.js` | o subagente da escada encerrado no limite de uso da API (o `SubagentStop` dele não chega) | nada na tela: o pedido de subida no estado da sessão, que o fim do turno cobra |
| `Stop` | `scripts/portao-fecho.js` | cobra evidência, etapa com subitem aberto e o prompt do handoff; barra uma vez o fim do turno com pedido `ESCALAR:` de subagente ainda não despachado (trava 6); grava os contadores | o turno volta com o motivo, ou fecha, com o aviso do handoff quando um gatilho cruzou |
| `SessionEnd` | `scripts/fim-sessao.js` | apaga os arquivos de sessão parados há mais de 7 dias; solta a conta do custo e do uso da sessão (`scripts/custo-das-sessoes.js --gravar`) | nada na tela: o registro em `.sworn/custo/<sessao>.json` |

Os portões que nomeiam uma chave de liga/desliga estão em "Os portões que não são travas"; as chaves, em "O
`projeto.json` chave por chave".

### O que mora em `modelos/` e nas referências do `playbook`

| Arquivo | O que é |
|---|---|
| `modelos/agente.md` | o molde do agente do projeto, que o `scripts/gerar-agentes.js` preenche, um por degrau da escada |
| `modelos/agents-md.md` | o molde do `AGENTS.md` (o resumo que viaja), que o `scripts/gerar-agents-md.js` preenche |
| `modelos/skill-projeto.md` | o molde da skill de manual do projeto, que o `scripts/gerar-skill.js` preenche |
| `modelos/boa-skill.md` | os critérios de uma boa skill de projeto, cada um com a falha de origem; lido pelo `/sworn:init` antes de preencher o molde, pelo `/sworn:learn` antes de propor regra e pelo `/sworn:audit` para apontar item fora da rubrica |
| `modelos/regras.md` | as regras semeadas em `gatilho -> ação`, que o `/sworn:init` copia para `.claude/sworn/regras.md` do projeto |
| `modelos/limites.json` | o teto de instrução que o `/sworn:audit` mede, o ponto em que ele começa a avisar e os plugins conhecidos que já cobrem parte do trabalho, para o init não duplicar |
| `modelos/shell-win32.json` | a tabela de idioma de shell do Windows (o que o portão de shell nega e o que sugere no lugar), com as regras que só valem para o PowerShell 5.1 |
| `modelos/volateis.json` | os padrões de fato volátil (versão, nome de modelo, preço, nome de evento de hook, flag de linha de comando) que o `/sworn:learn` recusa gravar como regra |
| `modelos/qualidade-prompts.json` | as perguntas congeladas da medição A/B de "Qualidade de resposta" |
| `modelos/travas-tarefas.json` | as tarefas da medição de antes/depois das travas (o brinquedo, o pedido, o teste e a armadilha de cada uma) e a hipótese, escrita antes da rodada |

| Referência do `playbook` | O que é |
|---|---|
| `skills/playbook/references/01-marchas-e-gates.md` | as três marchas, os portões de cada uma, a regra de dúvida entre modelo e marcha, e a delegação |
| `skills/playbook/references/02-rubrica-aaa.md` | as lentes de tela: a pergunta, a evidência e o corte de severidade (P0, P1, P2) de cada uma |
| `skills/playbook/references/03-inspecao-cega.md` | o protocolo da revisão cega: preparar o material, despachar as lentes, o formato do veredito e a convergência |
| `skills/playbook/references/04-verificacao.md` | o que vale como evidência, a regra da mutação plantada e como não se enganar com o próprio instrumento |
| `skills/playbook/references/05-governanca.md` | a ordem de leitura das fontes, o registro de decisão humana, o conjunto de mudanças e o handoff |
| `skills/playbook/references/06-ambiente.md` | as armadilhas de ambiente que já custaram sessão inteira: script por arquivo, encoding, gramática de shell, índice do git e CRLF |

---

## Por dentro de cada comando

A tabela acima diz o que cada um faz. Aqui está o que cada um garante, e como — pule para o que
interessar.

### `/sworn:init` — a configuração que só você sabe dar

O teto da varredura é declarado **antes** de ela começar, e ela mostra quanto leu e quanto custou.
Lista o que já está instalado — plugins, skills, agentes, hooks e servidores MCP — e **não duplica**
o que outro plugin já faz. Mede o peso de instrução que o projeto já carrega e, acima do teto, para
e leva a decisão a você. O que ela infere vem marcado como **inferência**. O que varredura nenhuma
acha vira pergunta:

1. Este projeto é interno ou público?
2. Quais arquivos mandam de verdade?
3. Qual comando prova que está pronto?
4. O que não se pode tocar?
5. Quem decide?
6. Quais agentes existem aqui, do mais barato ao mais caro — e com que apelido e que esforço cada um roda?

Cada resposta vira um campo do `projeto.json`. Rodado de novo no mesmo projeto, ele reabre a
configuração: pergunta só o que faz sentido reperguntar e mostra o que mudou antes de gravar. O que a entrevista não
perguntou de novo fica como está: os `limiares`, as chaves postas à mão (as de liga/desliga inclusive) e as subchaves
de `agentes` não são zeradas, e o escopo é declarado antes de gravar a configuração. Num agente gerado, valor com
`: ` no cabeçalho sai entre aspas, e quebra de linha ali é recusada. Ao fim, o `scripts/validar.js` confere o
arquivo gravado.

Depois das seis, uma pergunta opcional: a **referência de topo**, a melhor peça que existe para cada tipo de entrega
(`tela`, `codigo`, `texto`), que o `/sworn:review` põe ao lado do trabalho. Três respostas: nomear agora, por
tipo (grava `referencias`); deixar para depois (não grava a chave); ou nunca neste projeto (grava `"referencias": {}`).
Sem a chave, a abertura da sessão avisa uma vez por projeto que ela falta e como declarar — o primeiro caminho que ela
aponta é o `/sworn:reference`, que estuda os líderes do mesmo tipo e grava a ficha —; a marca do aviso fica em
`.claude/sworn/referencia-avisada.json`. Com a chave, até vazia, o aviso não sai. Com a chave declarada, a abertura
avisa, uma vez por ficha, a ficha de `.claude/sworn/referencias/` que está parada: guardada fora de `referencias`
(a revisão não a usa) ou estudada há mais de 180 dias (os líderes mudam); a marca fica em
`.claude/sworn/referencia-fichas-avisadas.json`.

### `/sworn:review` — quem escreveu não julga

A falha que ele ataca: **o agente é otimista ao julgar o próprio código**. Quando revisa o que
escreveu, ele não lê o código — ele re-deriva o raciocínio que o produziu, e o raciocínio que
produziu o bug reproduz o bug.

- **Pacote cego.** O `preparar-revisao.js` do plugin escreve o antes e o depois como `A.txt` e
  `B.txt`, sem dizer qual é qual, numa base por arquivo (`.claude/sworn/revisao/<arquivo>/<n>/`);
  o `apurar-ronda.js` apura a base de cada arquivo. O `mapa.json` que desfaz a cegueira só
  o script de apuração lê.
- **Lentes distintas, não inspetores repetidos.** Dez cópias do mesmo revisor acham o mesmo
  problema dez vezes; dez lentes acham dez classes de problema. Cada lente é um inspetor
  somente leitura, com **default reprovar**, que devolve JSON citando `arquivo:linha` e dá a cada
  achado uma severidade: **P0** quebra função ou vaza segredo, **P1** quebra contrato ou deixa um
  estado obrigatório de fora, **P2** é o que fica abaixo disso e diz o `tipo`: o de `erro` (muda um resultado,
  enfraquece a segurança, mostra ao usuário algo errado ou confuso, ou pode perder dado) segura a ronda; o de
  `melhoria` vira registro, não correção.
- **Cada achado diz se foi lido ou deduzido.** O `confirmado` traz a severidade e o `trecho` copiado do arquivo
  citado; o `apurar-ronda.js` procura esse texto no `A.txt` ou no `B.txt` da ronda, na linha citada ou em até 2
  linhas em volta, e o que não está lá sai em `trechoNaoConfere`, sem molhar a ronda. O `pendente` não tem severidade:
  diz em `falta` o fato exato que o confirmaria, sai em `pendentes` e também não molha. Achado sem estado invalida o
  veredito inteiro, para que um veredito no formato antigo nunca aprove calado. O P2 confirmado sem `tipo` (`erro` ou
  `melhoria`) também invalida o veredito: a lente é chamada de novo, ou quem orquestra completa o campo com `erro`
  (nunca com `melhoria`). O rejeitado é o `refutados.json`.
- **Proporcional ao tamanho da mudança.** O `preparar-revisao.js` mede o diff contra o HEAD e diz a
  faixa: até 3 linhas, um inspetor; lógica de até 40 linhas com teste vermelho e mutação, dois; texto,
  dois; arquivo novo, lógica maior ou estilo, a faixa completa, com as lentes da família escolhidas pelo
  risco (abaixo). Quem revisa pode subir de
  faixa, nunca descer. Na faixa completa, o próprio script escolhe as lentes pelo risco e diz a lista em `lentes`
  (que vai também no `mapa.json`, e o apurar confere que todas votaram): a de segurança só entra quando as linhas
  mudadas, dos dois lados, mexem em algo de risco (processo, arquivo ou caminho, leitura de entrada de fora,
  ambiente, rede, a página, segredo) ou o arquivo é gancho, manifesto, configuração ou script de shell; a `enxuto`
  só em arquivo novo ou mudança de mais de 40 linhas; as de tela só com a foto. Nas revisões passadas, a de
  segurança e a `enxuto` acharam só 4 problemas graves cada que nenhuma outra lente achou. A `estados` e a `borda`
  seguem separadas: só 32% do que a `estados` achou a `borda` também achou.
- **Nas faixas pequenas, o inspetor lê só o trecho mudado.** O `A.txt` e o `B.txt` levam o trecho com 20 linhas de
  margem; o resto fica em branco, com uma linha `[fora do trecho: linhas a-b]` no início de cada vão. Os números de
  linha seguem os do arquivo, então a apuração e a refutação não mudam, e o inspetor sabe que o vão não é defeito: o
  que depender dele vira "não consigo ver", e o achado sai `pendente`. Na faixa completa, o arquivo inteiro.
  Em arquivo JavaScript, o recorte também deixa à mostra, nos dois lados, a linha do `require` e a definição de topo
  de cada nome que o trecho usa (inteira até 15 linhas; maior, o comentário de cima e a assinatura), e o que ele usa
  de outro arquivo do projeto vai num `contrato.txt`, que não está em revisão e nunca é citado em achado. É o que o
  inspetor mais pedia: dois terços dos pendentes das faixas pequenas eram "fora do trecho".
- **A régua do projeto vai junto.** A seção "Régua" do `regras.md` entra no pacote, e o inspetor
  cita o valor dela — não o gosto dele. Sem régua declarada, a revisão diz que rodou sem régua.
- **Contra a peça de topo, nas duas ordens.** Com `referencias` declarada no `projeto.json` para o tipo do
  arquivo (`tela`, `codigo` ou `texto`), o pacote leva também o `R.txt` — a referência de topo, nomeada, não cega —
  e uma 2ª passada com A e B trocados, em `invertida/`. Cada inspetor diz, para cada lado (A e B, o arquivo antes e
  depois da mudança, sem saber qual é qual), se ele `vence`, `empata` ou `perde` da referência, e lista as `lacunas` citando `arquivo:linha`. O `apurar-ronda.js` só aprova com toda
  lente empatando ou vencendo nas duas ordens, sem lacuna P0/P1 do lado novo. **O custo em inspetores dobra.** A
  referência em texto vai inteira; imagem vai pelo caminho, para o inspetor abrir; URL fica escrita, e o inspetor
  não a abre.
- **Quem decide é o script.** O `apurar-ronda.js` conta só os achados do lado novo; o que
  aponta para o lado antigo é informação, não bloqueio. Achado refutado na fonte primária entra
  em `refutados.json` **com a prova**, ou o script para com erro. Achado na mesma linha, lente e severidade da
  ronda anterior só é repetição se o texto da linha citada não mudou: o script lê a linha no `A.txt` e no `B.txt` de
  cada ronda, e a linha reescrita entre as rondas (espaços não contam) faz o achado contar como novo.
- **Convergência com teto.** Duas rondas secas seguidas aprovam. A ronda 1 em que todas as lentes da faixa votaram
  e nenhuma trouxe achado nenhum (nem pendente, nem melhoria) aprova sozinha, sem a ronda 2; com referência de topo,
  só quando também nenhuma trouxe lacuna, em nenhuma das duas ordens, e a referência foi alcançada
  (`referencia.pronta`). A ronda 1 descobre; as seguintes
  só chamam as lentes que acharam P0, P1 ou P2 de erro, com a pergunta reformulada sobre o próprio achado, um
  degrau abaixo do modelo da ronda 1 (com a sessão no Opus: Opus na ronda 1, Sonnet nas rondas 2 e 3; conferir um
  defeito já nomeado não pede o modelo que descobre), e nelas só segura a ronda o
  achado numa linha que o conserto mudou ou que já foi citada antes (ou a até 2 linhas de uma delas). O P2 de
  melhoria, em qualquer ronda, e o achado em outro ponto do arquivo, nas rondas 2 e 3, não seguram: saem em
  `registros`, e vão para o registro do plano no fecho. No teto de 3 rondas com achado aberto, conserta o que é
  erro, cada conserto com um teste que reprova quando o código é estragado de propósito, roda a suíte inteira e faz
  o commit com `# sworn: sem-revisao` no fim do comando, sem perguntar e sem abrir revisão nova; o que sobrou vai
  para o registro do plano.

<details>
<summary>As dezoito lentes e a pergunta de cada uma</summary>

**Código**

| Lente | O que o inspetor procura |
|---|---|
| Correção e regressão | Qual dos dois quebra? Entrada concreta que produz resultado errado, com `arquivo:linha`. |
| Fidelidade ao pedido | O que mudou além do necessário: renomeação, extração, formatação junto de correção funcional. |
| Estados obrigatórios (código) | Erro, vazio, carregando, limite e timeout tratados — ou só o caso feliz. |
| Entrada e borda | `null`, string vazia, lista vazia, número negativo, unicode, caminho com espaço, arquivo enorme. |
| Segurança e dado sensível | Segredo em texto, log com dado do usuário, entrada não validada que vira comando ou caminho. Antes de P0, três conferências: os chamadores reais, não o caminho hipotético; leitura não é mutação; padrão repetido e coerente no módulo é desenho, não falha. Sem confirmar a intenção, o achado nasce P2 com pergunta. |
| Legibilidade e manutenção | O que um leitor novo entende errado: nome que mente, função que faz duas coisas, erro engolido. |
| Texto que o usuário lê | Mensagem que não diz o que fazer a seguir, jargão, inglês solto, tom que culpa o usuário. |
| Mexeram no medidor | Teste, baseline, threshold, skip ou mock que mudou junto com o código que ele cobre. |
| Fidelidade ao design system (código) | Valor cru, gradiente, sombra larga, card aninhado ou tipografia fluida onde o sistema não os tem — citando o token ou a tela irmã. |
| Código que não precisava existir | O que dava para não escrever, e o que o substitui, com `arquivo:linha` do que sobra e do que já faz o mesmo (função da linguagem, da plataforma, dependência já instalada, código do projeto). Validação na fronteira, perda de dados, segurança e acessibilidade nunca são excesso. |

**Tela**

| Lente | O que o inspetor procura |
|---|---|
| Fidelidade ao design system (tela) | O token literal ou a tela irmã de referência, e o que foge deles. |
| Estados obrigatórios (tela) | Carregando, vazio, erro e limite desenhados — ou só o caso cheio. |
| Responsividade e overflow | Em qual largura o conteúdo vaza, corta ou empilha errado, com a largura e o elemento. |
| Acessibilidade | Contraste, alvo de toque, foco visível, ordem de tabulação, rótulo de campo e de botão de ícone. |
| Microcopy | Texto que não diz o que fazer a seguir, jargão, inglês solto, tom que culpa quem lê. |
| Anti-referências visuais | O que parece template genérico em vez do produto, com o elemento e a tela irmã que faz melhor. |
| Correção visual e regressão | O que funcionava e parou de aparecer, ou aparece no lugar errado, com viewport e coordenada. |
| Governança e permissão | Superfície restrita renderizada sem a permissão que a habilita, ou dado sensível visível no print. |

</details>

### `/sworn:learn` — correção vira regra, mas só com o seu OK

Ele escreve lado a lado **o que você disse** e **o que ele entendeu**, para o mal-entendido aparecer
agora e não daqui a um mês. Depois transforma a correção em `gatilho -> ação` — proibição solta
decai em conversa longa; gatilho é convocado pela própria ação —, recusa fato volátil (versão,
preço, nome de modelo), propõe com o `propor-regra.js` do plugin (que a skill roda por você) **sem gravar**, e pergunta em três
opções. Só grava depois do sim, e avisa quando o arquivo de regras passa de umas 40, porque regra
demais dilui a atenção que ela devia concentrar. A regra é uma linha só: gatilho ou ação com quebra de linha é
recusado. E a duplicata é a linha inteira: a regra que é só o começo de outra já gravada não é mais recusada como
"JA EXISTE".

**Você não precisa lembrar do comando.** Quando a sua mensagem parece uma correção ao comportamento
do Claude ("eu já te disse", "não foi isso que pedi", "pare de…", "da próxima vez…"), o `abrir-turno.js`
avisa o Claude, que atende o pedido primeiro, roda o `/sworn:learn` na mesma resposta e pergunta em 3
opções (gravar, ajustar o texto, não gravar). O gancho
nunca grava nada: quem grava é a skill, depois do seu sim. No máximo uma sugestão a cada cinco turnos;
relato de bug ("o botão para de funcionar") e resposta a pergunta ("não, pode seguir") não contam.
Desliga com `"sugerirAprender": false` no `projeto.json`; sem a chave, fica ligado.

### `/sworn:handoff` — a ponte sobre a compactação

Lê do disco o que vai no texto — `HEAD`, branch, `git status`, disparos das travas — e nunca do
handoff anterior. O arquivo sai com oito seções fixas, da ordem de leitura aos erros de método que
custaram tempo, e termina num prompt pronto. Na mesma resposta, ele diz numa linha que o handoff está
gravado e por quê, e o trabalho segue na mesma conversa, sem perguntar se pode seguir: quando ela for
compactada, o sworn manda reler o handoff. Chat novo, só depois de instalar uma versão nova do sworn (ela só
carrega num chat novo). O prompt vai ao chat em bloco de
código: o turno que grava um handoff sem isso é barrado no fim (o portão do prompt do handoff, em
"Como desligar uma trava"). E se o turno já gravou o handoff e colou o bloco, o aviso do handoff
não manda rodar nem colar de novo: só apontar para o bloco acima.

O handoff pode ter sido gravado horas antes da compactação. Logo antes dela (o evento `PreCompact`, só no Claude
Code), o `scripts/antes-do-compact.js` refaz no handoff desta sessão as seções que vêm do disco: a topologia com o
`HEAD` e o `git status`, o item do plano (se a seção 3 ainda abre com o bloco que o script copiou) e as pendências.
As de julgamento ficam como estavam, e uma linha no topo diz quando foi refeito. Depois da compactação, a reabertura
que passa do que o harness mostra (acima de 10 mil caracteres ele guarda a saída num arquivo e mostra só o começo)
vai inteira para `.sworn/reabertura/<sessão>.md`, e a resposta leva primeiro a ordem de reler o handoff, depois o
caminho desse arquivo e o que couber.

**O que passa de um chat ao outro sem depender de memória:**

- **A lista dos seus pedidos.** Cada mensagem sua que chega ao Claude vira uma linha numerada, com data e hora, em
  `.claude/sworn/pedidos/<frente>.md` (`sem-frente.md` sem frente vinculada), gravada pelo gancho, sem o Claude: sem
  os blocos que o Claude Code injeta, e a chave de API reconhecida sai como "[segredo omitido]". Nada sai da máquina.
  Desde a 0.25.0, o pedido maior que a linha (~600 caracteres) fica inteiro, com as quebras de linha, em
  `pedidos/<frente>/<número>.md`, e a linha aponta o arquivo; o prompt de handoff colado (a mensagem longa que cita um
  arquivo de handoff, a retomada de um chat) entra numa linha marcada, sem número, e não conta como pedido. Cada pedido
  ganha o estado no fim da linha, `[feito: <evidência>]`, `[recusado: <decisão>]` ou `[respondido: <o quê>]` (a
  pergunta que não pedia mudança); sem marca, está aberto. Quem marca é o Claude, ao fechar o pedido, com
  `node scripts/pedidos.js --marcar 1-4,7 feito "<commit>"` (e `--abertos` lista os que faltam); o handoff traz os
  abertos. A mensagem parada pelo aviso de volta não
  entra: ela volta a ser mandada. Só grava em projeto que já tem `.claude/sworn/`; desliga com `"pedidos": false`.
- **O idioma da resposta** (desde a 0.25.0). Quando você escreve num idioma e a última resposta do Claude saiu em
  outro (português e inglês, pelas palavras mais comuns da mensagem), o gancho de entrada lembra o Claude numa linha
  de responder no seu idioma. Mensagem curta, ou misturada, não deixa saber o idioma e não gera o aviso. O aviso não
  tem chave para desligar: ele só sai quando os dois idiomas diferem.
- **O resumo da frente na abertura.** Frente que acumula notas de sessão no Objetivo aparece pelo começo do Objetivo,
  pela última nota `(sessao N, ...)`, pelo plano e pelo caminho do arquivo da frente, onde está o resto.
- **O dono do handoff.** O chat que lê um arquivo de handoff vira o dono dele (`.claude/sworn/handoff-donos.json`).
  Outro chat que lê o mesmo handoff em menos de 24 horas recebe o aviso de que dois chats estão no mesmo trabalho, e a
  posse passa a ele; o primeiro, se ler de novo, também é avisado.
- **A nota viva.** Com plano na sessão, 5 respostas com trabalho sem o arquivo do plano mudar trazem o lembrete de
  gravar nele o que já foi feito, para a troca de chat no meio da tarefa não perder o feito.

### `/sworn:audit` — o que cortar

Ninguém tira nada de um arquivo de instrução. Em seis meses há skill que se sobrepõe, regra que
se contradiz e item que ninguém invoca, e cada um disputa atenção com os que importam. A auditoria
mede o peso contra o teto (com o método ao lado do número), aponta sobreposições, contradições,
itens fora da rubrica e regra sem cicatriz, e confere se o catálogo de modelos ainda é o que o
projeto supõe — consultado no agente principal, porque hook nenhum do plugin abre conexão. Ela
propõe cortar, fundir ou manter com motivo. **Não apaga, não move, não edita.**

**Cada memória e cada regra têm idade.** As memórias (os `.md` ao lado do `MEMORY.md`) pela data da última mudança do
arquivo; as regras do `regras.md` pelo `git blame` (fora do git, a idade fica "não sei"). Mais de 90 dias sem mudar é
**fria**; duas memórias com a mesma descrição são **duplicadas**. A auditoria propõe aposentar a fria, a duplicada e a
contraditória movendo o arquivo para uma pasta de arquivo, com o seu sim: dá para voltar atrás, e nada some.

**Ela diz com que modelo e esforço os subagentes rodaram de fato** (desde a 0.16.0). Lê as transcrições dos
subagentes dos últimos 30 dias e compara a última resposta de cada degrau com a tabela `agentes.degraus`. O apelido
(o nome curto do modelo na tabela, como `sonnet`) que passou a apontar para outro modelo sem ninguém mudar a tabela
vem primeiro, como aviso. Sem como medir, o relatório diz "não medido" e o motivo. A rodada automática da abertura
não mede: leria todas essas transcrições.

**Ela mede também o que os ganchos põem na conversa** (desde a 0.9.1): lida a transcrição da sessão, quantas vezes e
quantos caracteres cada gancho de cada plugin injetou, e o texto que volta mais de 5 vezes, com o corte proposto (a
dica com teto). Fica à parte do peso, como a memória: não é instrução escrita no projeto. O plugin sai do registro do
gancho na transcrição; o que não dá para ligar a um plugin sai como "nao identificado". O formato da transcrição não é
documentado pelo Claude Code: quando a leitura falha, o relatório diz "não medido" e a causa, nunca zero. Ideia do
[context-mode](https://github.com/mksglu/context-mode), de Mert Koseoğlu, com texto e código nossos.

**Você também não precisa lembrar de rodá-la.** Na abertura da sessão, num projeto com `projeto.json`, o
`abertura.js` roda a auditoria no máximo uma vez a cada 7 dias, sem a medida do modelo e do esforço que rodaram, e
**só fala se algo passou do teto**:
peso de instrução acima do teto, skills que se sobrepõem, regras que se contradizem, ou skill do projeto
cujo `SKILL.md` não muda há 90 dias ou mais (pela data do último commit que o tocou; sem git, ou com o
arquivo fora do git, pela data do arquivo), ou texto de gancho que voltou mais de 5 vezes na conversa anterior
(desde a 0.9.2: a transcrição mais recente do projeto que não é a atual, com o id e a data dela na linha, porque
pode ser de outra frente), ou atalho deliberado sem "trocar quando:" (a mesma varredura do
`/sworn:shortcuts`, que dá o detalhe, na pasta aberta e nos repositórios logo abaixo dela). Tudo em ordem =
silêncio. O aviso sai em uma lista curta, com no máximo cinco nomes por item, e termina com a ordem ao Claude:
no primeiro turno, depois de atender o pedido, rodar o `/sworn:audit` e levar os cortes a você em 3 opções. A data da última auditoria fica em `.claude/sworn/auditoria.json`
(apagar o arquivo faz a próxima abertura auditar de novo); se a auditoria falhar, sai uma linha com a causa
mandando rodar `/sworn:audit`, que mostra o relatório inteiro; a data é gravada mesmo assim, para o
aviso não se repetir a cada sessão. Os prazos se ajustam em
`limiares`, no `projeto.json`: `diasEntreAuditorias` (padrão 7) e `diasSkillParada` (padrão 90). Desliga com
`"auditarNaAbertura": false`; sem a chave, fica ligado. Sem `projeto.json` ela não roda.

**Os atalhos também voltam sozinhos.** Desde a 0.9.2, a abertura mostra a lista completa dos atalhos deliberados
(com e sem gatilho) no máximo uma vez a cada 30 dias, com a ordem de conferir se algum "trocar quando" já
aconteceu e levar os vencidos a você em 3 opções. Varre a pasta aberta e os repositórios logo abaixo dela, lista
até 10 e deixa o resto para o `/sworn:shortcuts`; sem atalho, silêncio. A data fica em
`.claude/sworn/atalhos-revisao.json`, o prazo em `limiares.diasEntreAtalhos`, e `"atalhosNaAbertura": false`
desliga.

**A skill certa na hora certa.** Desde a 0.92.0, cinco rotas dizem a skill do sworn que a tarefa pede, uma vez por
sessão e por tipo:

- a 1ª edição de marcação ou estilo leva ao `sworn:design`, o roteiro de construir a tela (desde a 0.94.0; antes, ao
  `sworn:playbook`), com o `design.json` quando o projeto tem um e o `/sworn:review --tela-depois` no fim;
- o pedido de seguir um plano, ou a escrita de um `.md` de plano, leva ao `sworn:review-plan`;
- a edição que marca caixa ou `[FEITO]` num plano leva ao `sworn:drift`;
- o seu "por que a sessão deu errado?" leva ao `sworn:diagnose`;
- a edição de um arquivo `aaa` leva ao `sworn:effort-high`.

A linha entra com a sua mensagem (no `abrir-turno.js`) ou com a edição que o portão de escopo já permite (no
`portao-escopo.js`). Nunca entra numa negação, num subagente ou num apagar, e a falha dela nunca muda a decisão do
portão. A skill do sworn que já entrou na sessão cala a rota dela. A skill do projeto com "padrao" no nome segue fazendo
as vezes do manual, e a rota de tela entra junto; o `sworn:playbook` também é o manual e também não cala a rota de tela. Cada rota é uma ordem, contada como as do parágrafo abaixo.

**O que nunca é usado aparece em número.** Desde a 0.9.0, cada ordem que o sworn dá ao Claude (rodar o
`/sworn:learn`, o `/sworn:audit`, o `/sworn:calibrate`, o `/sworn:init`, revisar antes do commit,
carregar o manual e, desde a 0.92.0, as cinco rotas da skill certa: a rubrica de tela, revisar o plano, conferir a
etapa com o plano, diagnosticar a sessão e o esforço alto) conta em `.claude/sworn/contadores.json` como **dada** (uma vez enquanto está pendente),
**cumprida** (a skill pedida rodou depois, na mesma sessão, pelo agente principal) ou **recusada pelo dono** (só onde
há sinal: o commit com `# sworn: sem-revisao` depois de negado; nas outras sai `-`). A auditoria automática
guarda a foto desses números em `auditoria.json` e mostra o que mudou desde a vez anterior:

~~~text
- ordens dos ultimos 7 dias que o sworn deu ao Claude (dadas / cumpridas / recusadas pelo dono):
  aprender 4/3/-; revisar antes do commit 6/5/1; manual 2/2/-
  nunca disparadas: auditar, calibrar, init
  ("-": o sworn so ve a recusa no commit sem revisao; nas outras, a ordem que o Claude nao cumpriu foi ignorada ou
  recusada na conversa. Ordem que se repete sem cumprir: o sworn segue cobrando; o dono decide se ela fica.)
~~~

**O uso de cada skill também.** Desde a 0.92.0, cada skill do sworn que o agente principal carrega conta
`uso_skill_<nome>` nos mesmos contadores, e a skill do projeto com "padrao" no nome conta
`uso_skill_manual_do_projeto`. A auditoria automática mostra, no mesmo intervalo, as chamadas, as nunca chamadas e
quantas vezes a do projeto entrou no lugar do `sworn:playbook`:

~~~text
- skills do sworn que o Claude chamou nos ultimos 7 dias: playbook 5, review 3, handoff 2
  nunca chamadas: calibrate, diagnose, radar, reference, shortcuts
  Skill do sworn nunca chamada e assunto do sworn, nao deste projeto: ...
~~~

Sem nenhuma skill chamada no intervalo, a linha não sai.

Sem nada a cortar, essa parte sai sozinha, sem a ordem de auditar; nada disparado e nada a cortar segue em
silêncio. O `uso.js` não soma essas chaves no total das travas. Limite conhecido: num projeto sem
`.claude/sworn/`, o "nunca" do init não chega ao arquivo.

### `/sworn:calibrate` — o limiar de troca medido no seu projeto

Os 175 mil tokens do aviso de troca de chat (o padrão sem o modo contínuo) foram medidos nas conversas de um projeto só. O
`scripts/calibrar.js` mede o seu: lê as transcrições que o Claude Code guarda do projeto (só a
conversa principal; subagente fica de fora), calcula o custo de cada faixa de contexto e quanto custa
uma troca aqui — escrever o handoff mais a rampa do chat novo —, e simula a troca no fim do seu turno
para cada limiar de 150 mil até abaixo do alarme. Sugere o menor limiar em que trocar não sai mais
caro que não trocar. Com menos de 30 sessões, ou menos de 10 conversas que chegaram ao padrão (175 mil), a
amostra é pequena: fica o padrão, e ele diz por quê. Só números saem do script; nenhum trecho de
conversa. O limiar atual que ele mostra é o que vale hoje: o gravado no `projeto.json`, senão os 250 mil
do modo contínuo, quando ligado, senão o padrão — e ele diz qual dos três. Ele grava
`limiares.tokensDeContexto` no `projeto.json` só com `--gravar <tokens>`, ou com `--manter` (grava o limiar
atual, para o botão de calibrar não voltar), que a skill só roda depois do seu sim. Mede dinheiro, não qualidade.
Junto com o limiar muda também o momento em que o harness (o programa que roda o agente, como o Claude Code ou
o Codex) resume a conversa sozinho, a chamada compactação automática: 50 mil tokens depois do limiar. Assim,
quando a conversa enche, o handoff (o texto de continuação) já está gravado, o harness resume a conversa, o agente
relê o handoff e segue na mesma sessão. Você não precisa fazer nada nem abrir chat novo. No Claude Code isso fica na
variável `CLAUDE_CODE_AUTO_COMPACT_WINDOW` do `.claude/settings.local.json` (o seu arquivo pessoal do projeto, fora
do git); no Codex, com os ganchos do sworn instalados, na chave `model_auto_compact_token_limit` do
`.codex/config.toml`. O `/sworn:init` grava o mesmo ponto (com `--ponto`, que não mexe no `projeto.json`). Vale a
partir da próxima sessão; para desfazer, apague a linha nesses arquivos.

Desde a 0.27.0, a abertura da sessão também grava esse ponto, uma vez por projeto, mesmo sem o `/sworn:init`: basta
o Claude Code aberto na raiz de um repositório git (ou de um projeto com `projeto.json`). Se o projeto ainda não
ignora o `.claude/settings.local.json`, o sworn põe uma linha no `.git/info/exclude`, que é local e não vai em
commit; a abertura diz a linha, e o `calibrar.js` a mostra no campo `exclude`. Ele não mexe no que você já decidiu:
um valor seu no arquivo, a variável no seu ambiente ou a chave `CLAUDE_CODE_AUTO_COMPACT_WINDOW` que você apagou
depois da primeira vez. A lista dos projetos já gravados fica em `sworn/compactacao-gravada.json`, dentro da pasta de
configuração do Claude Code (`~/.claude`, ou a que a variável `CLAUDE_CONFIG_DIR` apontar). Um projeto aberto numa
subpasta do repositório, ou numa pasta sem git e sem `projeto.json`, não ganha o ponto: abra o Claude Code na pasta
principal do projeto, ou rode `/sworn:init`.

### `playbook` — o manual que o agente carrega

O procedimento que amarra tudo: a marcha de rigor (Rápida, Padrão, AAA) classificada **antes** de
ler código; na dúvida entre dois modelos, desce, e na dúvida entre duas marchas, sobe — custo e
rigor são eixos diferentes; as lentes e o loop de julgamento cego; os gatilhos contáveis de troca de
chat; decisão do dono sempre em exatamente três opções, a recomendada marcada; e o que um "pronto"
precisa provar. Sem adaptador do projeto, ele roda em modo degradado e **declara** o que não
consegue verificar.

### Os agentes `inspector`, `dedupe-judge` e `refuter`

O `inspector` é quem o `review` despacha, um por lente. Só lê (`Read`, `Grep`, `Glob`: sem `Write`, `Edit`,
comando ou skill), recebe só os dois artefatos e a régua, e devolve veredito em JSON. Desde a 0.6.2 o `inspector` e
o `dedupe-judge` (e o `refuter`, desde a 0.87.0) abrem sem a lista de skills e sem as instruções do projeto (`omitClaudeMd`, que pede o Claude Code 2.1.271 ou mais
novo): abertura menor, custo menor por inspetor. O `dedupe-judge` entra no Passo 3 do `review`,
quando a apuração lista pares de achados vizinhos: lê só as descrições e diz se cada par é o mesmo
defeito. É aviso: a contagem da ronda não muda. O `inspector` e o `dedupe-judge` são os dois únicos arquivos do plugin que declaram
modelo e esforço — para que toda revisão não saia no modelo mais caro da sessão —, e essa exceção
está declarada nos limites, mais abaixo.

O `refuter` (desde a 0.87.0) entra no Passo 3 do `review` quando se quer refutar um P0/P1 do lado do trabalho: um
por achado, com o arquivo real e a linha. Só lê, como os outros dois, mas abre o código vivo, e responde
`confirmado`, `refutado` ou `inconclusivo`, citando `arquivo:linha`. O `apurar-ronda.js` só aceita a refutação desse
P0/P1 no `refutados.json` quando a resposta, que o gancho grava em `refutacoes/` na base do arquivo, diz
`refutado`; na dúvida o achado fica. Ele não declara modelo: herda o da sessão.

---

## O que ele já pegou, em uso real

Os números abaixo são de uso real, num projeto de uso interno — uma extensão de navegador —, medidos
e registrados no log de decisões do projeto. O log é diário de trabalho e não é publicado (ver o fim
desta página); o que dá para conferir daqui está nos testes e no `CHANGELOG.md`. Usar o plugin achou **doze defeitos do próprio
plugin**, e a revisão deles achou mais um. Os treze foram corrigidos na 0.2.0, cada um com teste que
reprovava antes e mutação plantada que o teste acusa, e a correção passou pela própria revisão
cega, com 27 inspetores.

### O plugin mediu a si mesmo — e disse que não basta

A pergunta era se o manual escrito à mão podia ser aposentado. O manual foi desligado numa branch,
uma mudança de interface foi feita só com o plugin, e uma sessão que **não** fez o trabalho julgou,
obrigação por obrigação, o que segurou cada uma: hook, skill, regra reinjetada — ou nada. O
`experimento.js` do plugin (que se roda à mão, como mostra a tabela no fim) deu o veredito
(as linhas omitidas, marcadas com `…`, citam o projeto):

~~~text
EXPERIMENTO - o manual antigo ainda e preciso?
obrigacoes no inventario: 84 (plugin 64, segundo manual 66, so no segundo 20)
…
NAO BASTA: 14 de 84 obrigacoes valeram apenas
porque alguem lembrou. Cada linha abaixo e o que continua precisando do manual:
…
codigo de saida: 1
~~~

O manual ficou. O maior buraco apontado — a régua de design do projeto não chegava ao inspetor da
revisão cega — foi atacado na 0.2.0: a régua vai no pacote, e o inspetor a lê. O experimento não
foi refeito depois disso, então o `NAO BASTA` continua sendo o último veredito. E o próprio
experimento tinha defeito: ids repetidos entre os dois manuais faziam 84 linhas caberem em 72
julgamentos. Na 0.2.0, o id repetido ganha o prefixo `outro:`.

### Sessão aberta numa subpasta desligava os portões de escrita

O pior dos doze. Com a sessão aberta numa subpasta do repositório, os portões de escrita procuravam
a configuração só na pasta da sessão, não achavam, e liberavam tudo — escopo, intocáveis, catraca —
em silêncio. A pista foi um contador criado dentro da subpasta, onde nenhum deveria existir. Na
0.2.0 os hooks sobem de pasta até achar o projeto. A prova, com o plugin instalado e uma sessão real
(`claude -p`) aberta na subpasta: o `Write` fora do escopo voltou negado com a mensagem da trava 4, e
o arquivo não foi criado.

### O contador que perdia despachos

Numa revisão de 28 inspetores, o contador de agentes registrou 11. A corrida entre despachos
paralelos foi reproduzida: com 20 despachos em paralelo, cinco rodadas contaram 3, 2, 15, 15 e 17.
Na 0.2.0, com trava por sessão e gravação atômica, as cinco contam 20.

### O comando que só citava um `rm`

Um `cat >> notas.md <<'EOF'` que só **citava** um `rm -f` no texto foi barrado como destrutivo. Na
0.2.0, o corpo de um heredoc deixa de ser lido só quando o comando inteiro é um único `cat` ou `tee`
com corpo inerte; qualquer outra coisa no comando, lê tudo. O `test/destrutivo.test.js` prova as
duas metades: os textos citados passam, e os heredocs que executam — `bash <<EOF`, `cat <<EOF |
bash`, `ssh host <<EOF`, um `rm` depois do fechamento — continuam barrados.

### O `&&` que era certo

O portão de shell aplicava as regras do PowerShell 5.1 à ferramenta `Bash`, que no Windows é o Git
Bash, e barrou `&&`, `head` e `tail` onde eles eram corretos. Na 0.2.0, o portão olha a ferramenta:
`&&` no `Bash` passa, `&&` no `PowerShell` continua negado.

### O export que esqueceu o detector

A primeira publicação, montada à mão, saiu com 92 arquivos de 95 — e os que faltavam eram
justamente o detector de vazamento e o teste dele. Quem pegou o erro foi o contador de testes, não
a leitura da lista. Desde então o `exportar.js` do plugin (que se roda à mão, como mostra a tabela
no fim) monta o que vai a público com a mesma lista que o detector audita, e confere quantos
arquivos copiou.

---

## As ferramentas de linha de comando

Não são travas nem comandos do agente: são scripts que você roda quando quer o número.

Os scripts moram na pasta do **plugin**, não na do seu projeto. Rode cada comando **da pasta do seu
projeto**, trocando `<plugin>` pelo caminho completo da pasta do plugin:

- **Plugin instalado:** a cópia que o Claude Code guarda na sua pasta pessoal, em
  `$HOME/.claude/plugins/cache/sworn-local/sworn/<versão>/` (use a versão mais recente). O
  `$HOME` é trocado pela sua pasta pessoal dentro das aspas, tanto no bash quanto no PowerShell. Não
  escreva `~` no lugar: entre aspas o bash não o troca, e o PowerShell também não o troca num
  argumento do `node`.
- **Plugin carregado de um clone** com `claude --plugin-dir`: a pasta desse clone.

Exemplo: `node "<plugin>/scripts/uso.js"`. Rodar `node scripts/uso.js` direto do seu projeto dá
`Cannot find module`. Todo comando deste README que começa por `node "<plugin>/scripts/` segue essa
regra, e `--raiz <pasta>` (nos scripts que aceitam) troca a pasta que o script examina; sem ele vale
a pasta atual.

**A exceção é o `exportar.js`**, que é de quem publica o próprio plugin. Ele não examina o seu
projeto: monta a lista de arquivos com o `git` do **clone do código-fonte** do plugin, e por isso o
`--raiz` dele tem de ser esse clone. A cópia instalada no cache não traz a pasta `.git` e não serve
de `--raiz`: o script para com "NAO DEU PARA MEDIR" (saída 2) e não escreve nada. Use o clone nos
dois lugares, como na tabela.

| Rodar | O que devolve |
|---|---|
| `node "<plugin>/scripts/uso.js"` | quantas vezes cada trava disparou neste projeto |
| `node "<plugin>/scripts/custo-das-sessoes.js" [--limite N] [--json]` | o custo e o uso das últimas sessões deste projeto (10 sem `--limite`), das gravadas em `.sworn/custo/`, e o total: estimativa pela tabela de preço, valor de API, não cobrança. Sem registro, diz que o `SessionEnd` grava cada sessão ao fechar |
| `node "<plugin>/scripts/agentes-rodando.js" [--transcricao <caminho do .jsonl>]` | os agentes em segundo plano desta sessão que ainda rodam, um por linha: o `/sworn:handoff` roda antes de escrever o handoff, que só sai com todos terminados. Lê a transcrição da sessão do ambiente (`CLAUDE_CODE_SESSION_ID`), ou a de `--transcricao`; sem as duas, diz "nao medidos", a causa e o passo. Saída 0 sempre |
| `node "<plugin>/scripts/cobertura.js"` | quais portões este ambiente consegue verificar, quais não, e por quê; no fim, o kit da linguagem (servidor de linguagem, context7, gitleaks, semgrep e, em projeto Node, knip), com o que se viu no projeto e o comando de instalar cada um. O sworn não instala nenhum deles |
| `node "<plugin>/scripts/cicatriz.js" --manual <pasta ou arquivo do seu manual> --corpus <pasta com o seu histórico em .md>` | para cada regra do seu manual: existe decisão, incidente ou achado atrás dela? Sem `--corpus` o script avisa que não leu histórico e não separa nada; sem `--manual` mede as skills do próprio plugin |
| `node "<plugin>/scripts/plataforma.js" --raiz "<plugin>"` | em que sistemas cada trecho dependente de plataforma foi de fato exercitado |
| `node "<plugin>/scripts/medir-travas.js" --congelar <pasta>`, depois `--gerar --modelo <nome> --destino <pasta>` e `--apurar <pasta da rodada>` | a medição de antes/depois das travas: quantas vezes o agente diz "pronto" com o teste vermelho, sem o plugin e com ele, cada tarefa num projeto de brinquedo novo. O `--congelar` grava antes o sha256 das tarefas, da apuração e do instrumento; o `--apurar` só dá veredito (saída 0) com o congelado conferindo e a rodada completa, e sai 2 sem ele. Cada execução é uma sessão paga do `claude` |
| `node "<plugin>/scripts/sanitar.js"` | se algum dado seu vazou, nas três superfícies: conteúdo e nome dos arquivos, autoria do histórico (em todos os ramos) e mensagem de commit com o nome de ramo e tag; age sobre a pasta atual, ou sobre outra com `--raiz <pasta>` |
| `node "<plugin>/scripts/auditar.js" --memoria <caminho do MEMORY.md>` | o relatório do `/sworn:audit`, em JSON (o peso de instrução em itens de lista, contra o teto; o peso em tokens estimados, que soma os arquivos do projeto, a linha de cada skill do plugin e o texto que os ganchos injetaram, sem teto; sobreposições, contradições, itens fora da rubrica, regras sem cicatriz); a skill roda por você. Sem `--memoria`, ou sem valor depois dela, a chave `memoria` diz "nao medida" e a causa. A chave `injetado` lê a transcrição da sessão do ambiente (`CLAUDE_CODE_SESSION_ID`), ou a de `--transcricao <caminho do .jsonl>`; sem as duas, diz "nao medido" e a causa |
| `node "<plugin>/scripts/auditar.js" --seguranca <pasta>` | a varredura de segurança, sem IA, da pasta de um plugin ou skill baixado, antes de instalar: cada lugar com chamada de rede, `eval`, processo filho, credencial, pasta pessoal ou gancho que escreve fora da pasta do plugin, com `arquivo:linha` e o trecho; diz o que não leu (binário, arquivo grande, pastas ignoradas, corte do teto). Não é atestado de segurança; saída 0, ou 1 sem pasta |
| `node "<plugin>/scripts/atalhos.js"` | o painel do `/sworn:shortcuts`: os comentários de atalho dos arquivos que o git rastreia e dos novos que ele não ignora, sem mudar nada; saída 0, ou 1 fora de repositório git |
| `node "<plugin>/scripts/vigentes.js" [--gravar \| --conferir] [--decisoes <registro>] [--saida <arquivo>]` | o que vale entre as decisões do seu registro (`docs/decisoes.md`, uma decisão por cabeçalho `### D<n> · <título>`): com `--gravar`, escreve o `docs/vigentes.md` com as revogadas e quem as revogou, as revogadas ou alteradas em parte e as que valem, da mais nova para a mais antiga; com `--conferir`, só lê e sai 1 se o arquivo falta ou difere do que o registro gera (o conserto é rodar `--gravar`) ou se o registro ainda copia o rodapé "Continua valendo" (esse se apaga à mão no registro: o `--gravar` não o tira); sem nada, só as contagens. A resposta sai em JSON nos três casos. Saída 2, com a causa, quando o registro não se lê, não tem decisão, repete um número ou tem cabeçalho fora do formato, quando a gravação falha e no uso errado (opção sem caminho, opção desconhecida, `--gravar` junto de `--conferir`) |
| `node "<plugin>/scripts/handoff-curto.js" --slug <tema> [--frente <frente>] [--hoje AAAA-MM-DD]` | o rascunho do handoff do `/sworn:handoff`, rodado na raiz do projeto. Só imprime, não grava nada: a primeira linha diz o destino (`.sworn/handoff/AAAA-MM-DD-<tema>.md`) e o resto é o texto, com as oito seções, o que se lê do disco já preenchido (o plano, o handoff anterior, o commit e o `git status`, o próximo item não marcado do plano, as pendências e os pedidos em aberto, o prompt) e marcas `<<...>>` no que pede juízo. Quem preenche as marcas e grava o arquivo pelo Write é o modelo; depois ele roda o `--conferir`. O tema leva só minúsculas sem acento, números e `-`, começa por letra ou número, tem até 60 caracteres e não pode ter `retomar`. Sem `--frente`, vale a frente da sessão; sem `--hoje`, o dia do relógio local. Saída 2 (erro de uso), com a causa: sem o tema, com tema fora da regra, opção sem valor, data fora do formato AAAA-MM-DD ou que não existe |
| `node "<plugin>/scripts/handoff-curto.js" --conferir <arquivo>` | a conferência do handoff preenchido, em JSON (`ok`, `problemas`, `bytes`): o nome do arquivo, nenhuma marca sobrando, as oito seções, o prompt como último bloco de código, dentro da seção 8, citando o arquivo e com mais de 300 caracteres, e o tamanho até 4 KB. Saída 1 quando não passa; 2 quando o arquivo não se lê |
| `node "<plugin>/scripts/pendencias.js" --listar \| --adicionar --dono <quem> --texto <o que> \| --fechar <n> --como <o que fechou>` | as pendências do projeto em `.sworn/PENDENCIAS.md`, cada uma com número, data e dono: `--listar` devolve em JSON as abertas, as fechadas e as linhas fora do formato; `--adicionar` grava uma nova com o próximo número (o número não se reusa); `--fechar` marca a feita com a data e o que a fechou. Aceita `--hoje AAAA-MM-DD`. Um modo por vez. Saída 2 (erro de uso), com a causa: sem dono, texto ou "como", com quebra de linha ou `\|` neles, número que não está aberto, opção sem valor, data fora do formato AAAA-MM-DD ou que não existe, ou dois modos juntos. Saída 1 quando o arquivo não se lê ou não se grava |
| `node "<plugin>/scripts/referencia.js" <ficha> [--gravar \| --tipo radar]` | a conferência da ficha do `/sworn:reference`, em JSON: todo achado com origem, grau e quem agiu, toda pergunta do que ficou sem saber com estado e o que mediria (a resolvida cita a evidência: `arquivo:linha`, endereço, foto da tela, arquivo `.json` ou "achado da linha N", que precisa apontar para uma linha da tabela dos achados), a seção `## Cobertura` com cada camada completa, parcial ou desconhecida (a parcial diz o que se leu, e a desconhecida diz por quê; a saída conta em `naoCompleta` as que não são completas), a linha `Não li:`, o lugar e o nome (`.claude/sworn/referencias/<tipo>-<assunto>.md`) e até 100 KB; com `--gravar`, junta a ficha à lista do tipo em `referencias` (a skill só roda depois do seu sim); com `--tipo radar`, confere a ficha do `/sworn:radar` em qualquer pasta, mais a tabela dos candidatos (licença, como entra, como melhora, esforço, valor, veredito), e recusa o `--gravar`; saída 0, ou 1 com `problemas` ou `erro` |
| `node "<plugin>/scripts/conferir-tela.js" --url <a tela> --referencia <a página de referência> --saida <pasta> [--larguras 1440,768,390] [--tempo-max 30000]` | a conferência da tela contra a página de referência, largura por largura, rodada da raiz do projeto: fotografa as duas páginas em cada largura e grava `conferencia.json` com o que difere (rolagem para o lado, h1, h2 e texto além de 2 px, coluna principal além de 8 px, blocos lado a lado, o elemento da árvore de acessibilidade da referência que some da tela naquela largura; com o `design.json`, o tamanho do sistema mais perto do da referência) e o que ficou sem comparar; saída 0 com tudo comparado, ou 1 com algo sem comparar ou com a chamada errada (`ERRO: ...`), e enquanto a última saiu 1 o portão de fecho não aceita "pronto" |
| `node "<plugin>/scripts/pastas.js" --estudar https://github.com/<dono>/<repo>`, `--listar`, `--limpar [--fim-da-sessao]` e `--registrar <pasta> --tipo <estudo|worktree|export|carga>` | as pastas que o sworn cria fora do projeto, em JSON. `--estudar` baixa a referência para o `/sworn:radar` e o `/sworn:reference` lerem (uma cópia rasa, só https, numa pasta nova da temporária do sistema) e devolve a pasta e o commit lido; nada dela roda, e a trava 5 nega o comando que rodaria código dela. `--limpar` apaga do registro só o que já não se usa: o export publicado e o worktree de que ele saiu; com `--fim-da-sessao`, também a cópia de estudo e a carga da sessão; o resto, 7 dias depois, quando a sessão nunca fechou. Só pasta da temporária do sistema entra no registro, e só sai a mesma pasta que entrou (o número e a criação no disco conferem); a que tem mudança sem commit, commit sem push ou a pasta de trabalho dentro fica. A limpeza também roda sozinha, num processo à parte, depois de um comando com `git push` (`limpar-depois-do-push.js`) e no fim da sessão; o `exportar.js` registra o export e o worktree de origem. O registro fica em `sworn/pastas.json` da pasta de configuração do Claude |
| `node "<plugin>/scripts/varrer.js" <pasta>` | a varredura do `/sworn:init`, em JSON: o teto (quantos arquivos leu, se cortou, quanto custou), o ambiente detectado, o peso de instrução e o que ela inferiu, marcado como inferência; sem `<pasta>`, a atual |
| `node "<plugin>/scripts/catalogo.js" --motivo <motivo> \| --registrar <ok\|semRede\|falhou> [fonte...] \| --degradado` | a consulta ao catálogo de modelos que o `/sworn:init` faz ao terminar e o `/sworn:audit` no Passo 1b: `--motivo` diz em JSON se é hora de consultar; `--registrar` grava o desfecho e as fontes em `.claude/sworn/catalogo.json`; `--degradado` imprime o texto do modo sem rede. Não abre conexão: quem consulta é a skill |
| `node "<plugin>/scripts/validar.js" <pasta>` | confere o `.claude/sworn/projeto.json` e, se existir, o `regras.md`: `OK` e saída 0, ou a lista do que está errado e saída 1; sem `<pasta>`, a atual |
| `node "<plugin>/scripts/gerar-agentes.js" [--fatias] [--respostas <arquivo.json>] [--gravar]` | os agentes do projeto, um por degrau da escada, a partir de `modelos/agente.md`. Sem `--gravar` só propõe e não escreve nada; com ele, escreve em `.claude/agents/` e **pula** o que já existe. `--fatias` lista o que o molde pergunta. Para com erro (saída 1) sem degraus gravados ou com a escada torta |
| `node "<plugin>/scripts/gerar-skill.js" [--fatias] [--respostas <arquivo.json>] [--gravar]` | a skill de manual do projeto, em `.claude/skills/<slug>/SKILL.md`, a partir de `modelos/skill-projeto.md`. Recusa a que não passa no validador e na rubrica de boa skill, e não sobrescreve a que já existe |
| `node "<plugin>/scripts/gerar-agents-md.js" [--fatias] [--respostas <arquivo.json>] [--gravar]` | o `AGENTS.md` da raiz, a partir de `modelos/agents-md.md`. Sem `--gravar` só mostra; com ele, recusa sobrescrever um `AGENTS.md` que já existe |
| `node "<plugin>/scripts/autorizar-paralelo.js" [--conferir]` | grava a regra `Workflow(sworn:parallel)` em `permissions.allow` do `.claude/settings.local.json`; com `--conferir`, só lê e diz se já está autorizado. Saída em JSON (`autorizado`, `gravou`, `arquivo`) |
| `node "<plugin>/scripts/ponte.js" <harness> <script> [<evento>]` | o gancho dos outros harnesses (`codex`, `qwen`, `agy`, `dsh`, `opencode`), que leva a entrada deles ao formato do Claude Code, roda o portão de sempre e devolve a saída na forma do harness. No `agy` o caminho vai sem aspas (ele parte o comando em cada espaço e não tira aspas): ali o `sworn` precisa estar numa pasta sem espaço. Não se roda à mão; no Claude Code não entra |
| `node "<plugin>/scripts/instalar.js" <harness>` e `--conferir <harness>` | grava os ganchos do `sworn` onde o harness lê (`.codex/hooks.json`, `.qwen/settings.json`, `.agents/hooks.json`, `.dsh/sworn-hooks.json` com o perfil `sworn` do `dsh`, `.opencode/plugins/sworn.js`), cada um pela `ponte.js`, e um bloco no `AGENTS.md` ou `QWEN.md`. Com `--conferir`, diz quais eventos já rodaram desde a instalação e o passo que falta (no Codex, a aprovação no `/hooks`); saída 0 só depois de um gancho rodar. O que roda em cada harness está em [HARNESSES.md](HARNESSES.md) |
| `node "<plugin>/scripts/recusar-init.js" <pasta>` | grava o "nunca neste projeto" da pergunta do init, fora do projeto (em `sworn/init-recusado.json` da pasta de configuração do Claude), e a abertura não pergunta mais ali. O Claude roda quando você escolhe "nunca"; saída 0 se gravou, 1 sem pasta ou sem conseguir gravar |
| `node "<plugin>/scripts/vigia-puxar.js" --repo <pasta do clone> [--remote backup] [--ramo claude/vigia] [--arquivo vigia/novidades.md] [--destino <pasta>] [--espera 30]` | só para quem mantém o plugin: traz a novidade da semana do ramo `claude/vigia` para a pasta do vigia (ver "Os portões que não são travas"); com `--ramo claude/radar --arquivo radar/semana.md --destino <pasta do vigia>/radar`, traz a ficha do radar da semana. A busca que falha tenta 3 vezes, com `--espera` segundos (0 a 600) entre elas. Roda por tarefa agendada, nunca por gancho. Saída 0 se gravou, 1 se falhou, 2 se faltou `--repo`, se uma opção veio sem valor ou se o `--espera` não é inteiro de 0 a 600 (nada é gravado) |
| `node "<plugin>/scripts/vigia-triar.js" (--vigia \| --radar) --semana AAAA-MM-DD --como "<o que foi decidido>" [--pasta <dir>]` | só para quem mantém o plugin: grava no `visto.json` a marca de que a ficha da semana (a do vigia, ou com `--radar` a do radar) foi triada, e a abertura para de lembrar dela. Recusa a semana que não é a da ficha no disco. Saída 0 se gravou, 1 se recusou (sem ficha, semana errada, `--como` sem letras ou com o marcador `<o que foi decidido>` copiado sem troca, falha ao gravar), 2 se o uso veio errado (flag faltando, flag sem valor ou `--como ""`); com 1 ou 2 nada é gravado |
| `node "<clone do plugin>/scripts/modelos.js" --conferir [--salvar <pasta>]` e `--citacoes <guia> <página> [<página>...]` | só para quem mantém o plugin: relê as páginas oficiais de cada guia de modelo (`modelos/claude/`) e o "Models overview" e diz, em JSON, o que mudou pela impressão digital e se saiu modelo novo, com os passos para propor o guia novo (sai 0 sem mudança, 1 com mudança, 2 quando alguma página não abriu); o `--citacoes` confere o formato do rascunho e se cada citação é trecho literal da página. O guia novo só entra com o seu sim. No repositório do plugin, a abertura lembra a conferência quando a última passa de 30 dias |
| `node "<clone do plugin>/scripts/painel.js" --prototipo [--porta N]` | só para quem mantém o plugin: sobe o protótipo do painel de sessões em `http://127.0.0.1:<porta>/`, com dados inventados (`painel/prototipo/simulado.json`) que chegam aos poucos, como chegariam de sessões de verdade. Escuta só em 127.0.0.1 e recusa outro `--endereco`; `--porta 0` (o padrão) pega uma porta livre. Sai 2 com opção errada e 1 quando o servidor não sobe (a porta ocupada diz como escolher outra) |
| `node "<clone do plugin>/scripts/exportar.js" --raiz "<clone do plugin>" --destino <pasta>` | só para quem publica o próprio plugin: monta, numa pasta à parte, exatamente o que iria para um repositório público (sem `--gravar` só mostra o que copiaria) |
| `node "<clone do plugin>/scripts/apresentacao.js" [--gravar] [--slides <pasta>]` | só para quem publica o próprio plugin: monta a apresentação (`apresentacao/index.html`, a página do GitHub Pages) a partir de `apresentacao/fonte/`, da seção do topo do `CHANGELOG.md` (o slide de novidades) e da versão do `plugin.json`; sem nada, só confere e sai 1 com a página velha; `--slides` grava a fonte com as marcas trocadas, para publicar o deck em outro lugar |
| `node "<plugin>/scripts/experimento.js" --manual <pasta do seu manual>` | monta a tabela de obrigações do seu manual e do plugin; depois de preenchida (o script diz onde), rode de novo com `--veredito` para julgar: o plugin bastou, ou ainda falta manual? Sem `--manual` a tabela traz só as obrigações do plugin |

Os dois últimos existem porque este repositório foi publicado e porque o plugin foi posto à prova
contra um manual de verdade — os dois casos estão contados acima.

Das linhas acima, `varrer.js`, `validar.js`, `gerar-agentes.js`, `gerar-skill.js`, `gerar-agents-md.js` e
`autorizar-paralelo.js` são ferramentas do `/sworn:init`, o `auditar.js` é do `/sworn:audit`, e o
`catalogo.js` é dos dois: as skills os rodam por você, e rodá-los à mão serve para conferir o que a skill viu.

O `sanitar.js` não diz LIMPO sem ter lido: arquivo que não abre, vocabulário local quebrado e `excecaoEm` inválido
saem com 2. Arquivo com acento no nome, UTF-16 com BOM e pasta pessoal do macOS e do Windows, em qualquer caixa,
entram na conferência; binário sai como "não conferido", com o motivo. O próprio `.sanitacao-local.json` fora do
`.gitignore` é acusado: ele lista exatamente o que não pode vazar. O `cicatriz.js` aceita um arquivo, e não só
uma pasta, em `--manual` e em `--corpus`.

Desde a 0.26.0, a autoria confere também quem **vai** assinar o próximo commit: o nome e o e-mail que o git usaria
(pela variável de ambiente ou pela configuração) passam pelo que a sanitação já procura (e-mail pessoal, caminho da
sua máquina, chave) e pelos nomes do seu vocabulário local (`.sanitacao-local.json`). Antes, a pasta recém-exportada,
ainda sem commit, saía limpa mesmo com o seu nome configurado como autor. Sem nada configurado, o git inventa um autor
com o nome completo da sua conta do computador, e a sanitação também o barra. Antes do commit, na pasta exportada:
`git -C <pasta> config user.name "<apelido>"` e `git -C <pasta> config user.email
"<número>+<apelido>@users.noreply.github.com"` (o `exportar.js` imprime os dois); depois do commit, e antes de
enviar ao GitHub, rode o `sanitar.js` de novo.

---

## O que o `sworn` NÃO promete

Dito agora para não virar promessa quebrada depois:

- **Sessões concorrentes no caso geral.**
- **Autoaprimoramento automático.**
- **Julgar se a interface ficou bonita.**
- **Regressão silenciosa do provedor.**
- **Impedir que o agente amplie o próprio escopo.**
- **Barrar escrita de arquivo feita por comando de shell.** A exceção é o arquivo de estilo com
  design system declarado: o portão de estilo lê o comando e nega o que reconhece, sem cobrir toda
  forma de escrever.
- **Distinguir citação de execução num comando.**
- **Tratar caixa de letra igual em todo sistema de arquivos.**
- **Interpretar o comando como um shell interpreta.**
- **Partir o introdutor do `cmd` quando ele vem colado ao comando.**
- **Ler comando embrulhado em base64.**
- **Cobrir toda forma de apagar que existe.**
- **Reconferir o catálogo de modelos quando o plugin é atualizado.**
- **Conferir, no portão de design, medida em `%` ou em unidade que não seja `px`, `rem` ou `em`.** Nem a cor
  escrita em `oklch()` ou `lab()`, com qualquer valor, nem a cor dada por nome dentro de `color-mix()`: as duas
  passam sem conferência (o `#hex` dentro do `color-mix()` é conferido).

Cada uma dessas quatorze tem o **limite medido** por trás — quantas formas passam, quais falsos
positivos são aceitos e por quê, e qual decisão fechou o assunto. Limites **declarados**, não
descobertos depois.

Boa parte desse limite está exercitada nos testes, que **vão junto**: `test/destrutivo.test.js`
percorre as formas de apagar uma a uma, e cada teste que acusa vem com o par que **não** pode
acusar. É lá que se confere o que está escrito acima.

---

## Os seis limites que não fecham

As quatorze acima são promessas que este plugin **escolheu não fazer**. Estas seis são outra coisa:
propriedades do mundo, que trabalho nenhum resolve. Estão escritas aqui porque limite declarado
não é buraco — buraco é o que ninguém disse.

- **O julgamento custo × capacidade.** Qual modelo vale o preço depende do seu bolso e da sua
  tarefa. O plugin pergunta, registra a sua resposta e confere depois se ela ainda vale; escolher
  por você seria chutar com o seu dinheiro.
- **A janela entre um modelo novo sair e a próxima conferência.** Não há calendário nem aviso: a
  conferência acontece quando você instala e quando pede — atualizar não confere nada, e isso
  está na lista acima. A janela tem o tamanho do intervalo entre os seus próprios usos — quem usa
  muito é conferido muito, e quem quase não usa também quase não despacha agente. O buraco é
  maior onde custa menos.
- **O ambiente da outra pessoa.** Busca desligada por política da empresa, máquina sem rede, conta
  sem acesso a um modelo. Dá para degradar com elegância e dizer o que não deu; não dá para fazer
  funcionar.
- **Campo de configuração que ninguém documentou.** Alguns campos de frontmatter de agente
  funcionam hoje e podem sumir sem aviso, porque nunca foram prometidos. O teste de apelidos vivos
  detecta quando um deles deixa de valer; impedir, não impede.
- **O harness muda.** O harness é o programa que roda o modelo e chama os ganchos, aqui o Claude Code.
  Podem mudar o evento de hook, o formato de plugin e os campos de configuração. Guardar o método
  em vez do resultado reduz o estrago — não o elimina.
- **Conferência que vive em instrução não é determinística.** Só hook é garantido. A comparação
  com o catálogo de modelos do harness precisa rodar no agente principal, e instrução a um modelo
  pode ser pulada. É por isso que a guarda que precisa ser garantida — comparar arquivo com
  arquivo — é hook, e não skill.

Há um sétimo, menor, que vale dizer junto porque surpreende: **a auditoria de instruções liga
regra e histórico por palavra exata.** `publicar` não casa `publicado`. A lista de "sem cicatriz"
que ela devolve é pergunta, não sentença.

**E duas exceções, declaradas.** O plugin não guarda nome de modelo, com duas exceções. Dois dos agentes
que o `/sworn:review` despacha — o `inspector` e o `dedupe-judge` — declaram no próprio arquivo um
apelido de modelo e um esforço, para que toda revisão não saia no modelo mais caro da sessão. E o
`workflows/parallel.js`, o roteiro do `/sworn:parallel`, aceita os apelidos `haiku`, `sonnet` e `opus`
por tarefa e escolhe `haiku` para a que só lê e `sonnet` para a que edita, quando a tarefa não diz. São
os únicos lugares. Se o apelido deixar de valer, o teste de apelidos vivos acusa e diz qual — rode
`node "<plugin>/scripts/provar-apelidos.js" --plugin` e sonde de novo.

---

## Em que sistemas isto rodou

**Windows, e só.** Linux e macOS **não foram testados** — nem aqui nem em integração contínua,
que este projeto não tem.

Isso não quer dizer a mesma coisa em todo ponto do código, e a diferença está medida. Boa parte
do que depende de sistema entra por **parâmetro**, e aí o comportamento dos três se exercita de
qualquer máquina: a tabela de idioma de shell recebe a plataforma de quem chama, não a adivinha.
O que sobra depende do sistema de verdade, e sobre esse trecho ninguém mediu nada fora do Windows.

```
node "<plugin>/scripts/plataforma.js" --raiz "<plugin>"
```

Ele imprime a matriz ponto a ponto e termina dizendo quantos deles seguem sem teste em cada
sistema. A lista **não é escrita à mão**: é varrida do código a cada rodada da suíte, e a suíte
reprova se aparecer no código um ponto dependente de sistema que a matriz não declara. Lista
escrita à mão envelhece calada; esta não tem como.

---

## Como desligar uma trava

Em `.claude/sworn/projeto.json`, na chave `travas`:

```json
{
  "travas": {
    "fecho": false,
    "destrutivo": true,
    "outraFrente": true,
    "escopo": true
  }
}
```

As quatro chaves são obrigatórias e booleanas. **Três desligam de verdade:**

| Chave | `false` desliga |
|---|---|
| `fecho` | a cobrança de evidência no fim do turno (trava 3). O ledger de contadores continua sendo escrito. O portão do prompt do handoff **não** desliga com ela (abaixo). |
| `destrutivo` | o bloqueio de comando destrutivo **e** o do `cd` solto, juntos (trava 5). |
| `outraFrente` | o bloqueio por arquivo de outra frente (trava 5). |

**`escopo` é a exceção, e está dito aqui para não enganar ninguém:** a chave é obrigatória no
schema, mas **nenhum portão a lê**. Pôr `"escopo": false` não desliga a trava 4 — a decisão do
portão é idêntica com ela ligada ou desligada. Ficou assim de propósito: uma trava que devolvesse
"permitir" antes da verificação de intocáveis faria uma configuração que hoje **nega** passar a
**permitir** um segredo. Nada piora; uma coisa deixa de melhorar.

Trava que você desligou fica desligada. Religar calado seria a mentira que este plugin existe para
impedir.

As travas 1 e 2 são comandos: desliga-se não invocando.

**As travas 6, 7 e 8 também não têm botão**, e está dito aqui pelo mesmo critério de honestidade da
`escopo` acima: nenhuma delas lê a chave `travas`. O que as desliga:

| Trava | O que a desliga |
|---|---|
| 6 · agente caro | não declarar `agentes.escada` no `projeto.json` — sem escada, o portão não opina e só conta |
| 7 · criar sem procurar | nomear o arquivo no `escopo.md`, ou fazer uma busca antes. Não há como desligar de vez |
| 8 · catraca afrouxada | nada. É a única sem saída, e de propósito: uma catraca que se desliga sozinha não é catraca |

**O portão de decisão** (barra pergunta ao dono sem exatamente 3 opções ou sem a recomendada em
primeiro) também não lê a chave `travas`: desliga com `"portaoDecisao": false` no `projeto.json`.

**O portão do prompt do handoff** também não lê a chave `travas`. No fim do turno que gravou um
arquivo de handoff, quando a resposta final não traz o prompt, ele mostra a você o prompt do arquivo (o último bloco
de código dele); só barra o fim do turno quando o arquivo não tem um prompt legível. Arquivo de handoff é
um `.md` com data `AAAA-MM-DD-` na frente e "handoff" no nome ou na pasta. Desliga com
`"portaoHandoff": false` no `projeto.json`; `travas.fecho: false` não o desliga.

Ele lê só a resposta final do turno e confere que ela traz o prompt do arquivo (um bloco qualquer, como a saída
dos testes, não conta). No turno que gravou o handoff e já trouxe o prompt, ou em que o sworn o mostrou a você, o
aviso do handoff não manda colar o prompt de novo. Com o portão desligado e a resposta sem bloco, nada barra, e o
aviso do handoff, se disparar, continua mandando colar.

**O portão da referência de topo** também não lê a chave `travas`. Ele barra o fim do turno cuja resposta alega
entrega (as mesmas palavras da trava 3: "pronto", "passou", "corrigido"...) quando três coisas valem juntas: um
arquivo mudado na sessão resolve para a marcha `aaa`; o tipo dele (`texto` para `.md`/`.txt`, `tela` para estilo,
`codigo` o resto) tem lista em `referencias`; e nenhuma revisão contra a referência fechou na sessão (o
`apurar-ronda.js` conta esse fecho). A mensagem cita os arquivos e o comando, `/sworn:review <arquivo>`. Sem
`referencias`, nada muda. Desliga com `"portaoReferencia": false` no `projeto.json`; `travas.fecho: false` não o
desliga.

**O portão da revisão aprovada** vale para todo arquivo da marcha `aaa`, com ou sem `referencias`. Com
`"revisaoTodoCodigo": true` no `projeto.json`, vale para todo arquivo de código, de qualquer marcha: o mesmo conjunto
que o portão do commit cobra. A chave vem desligada porque, na bateria, com ela e o juiz um degrau acima ligados, o Opus
custou 2,44 vezes mais por tarefa, sem ganho medido em tarefas entregues sem defeito. Ele barra o fim do turno cuja resposta alega entrega
quando um arquivo de código mudado na sessão, da marcha que ele cobra, não tem revisão aprovada: a revisão cega que terminou em "aprovado" (duas rondas secas, ou a ronda 1 sem achado nenhum), a mesma que libera o commit. Texto
(`.md`, `.txt`) e arquivo apagado ficam fora, como no commit; arquivo editado de novo depois de aprovado volta a
cobrar. A mensagem dá três saídas: rodar `/sworn:review <arquivo>` até "aprovado"; no teto de 3 rondas, consertar o que
é erro, cada conserto com um teste que reprova quando o código é estragado de propósito, rodar a suíte inteira e
entregar sem revisão dizendo o que segue aberto;
ou dizer ao usuário que a entrega fica sem revisão, e por quê ("sem revisão", "without review"
na resposta liberam). O arquivo que o portão da referência já cita no turno não sai de novo. Desliga com `"portaoRevisao": false` no `projeto.json`; `travas.fecho: false` não o desliga.

**O portão da consulta ao advisor** também não lê a chave `travas`. Ele só cobra com o advisor do Claude Code (um
modelo mais forte que o agente consulta no meio da tarefa) ligado: o `advisorModel` da primeira settings que o declara
(a `.claude/settings.local.json` do projeto, depois a `.claude/settings.json`, depois a do usuário) é um texto não
vazio, e a variável `CLAUDE_CODE_DISABLE_ADVISOR_TOOL` não o desliga (`1`, `true`, `yes` ou `on`). Com ele ligado, barra
uma vez por sessão o fim do turno cuja resposta alega entrega quando um arquivo de código da marcha `aaa` mudou na
sessão e a transcrição da sessão não traz nenhuma chamada ao advisor; a chamada feita só por um subagente não conta. A
mensagem pede uma consulta antes da entrega e diz o custo medido na bateria do sworn: perto de US$ 0,22 a mais por
rodada, 3,9 vezes o custo da rodada sem ele; na única tarefa que falhava sem ele, a consulta evitou o defeito em 2 de 3
rodadas. Sem a ferramenta do advisor na sessão, basta dizer isso numa linha e entregar. Sem transcrição legível, fica
calado. A flag `--advisor` da linha de comando não chega ao gancho: só o `advisorModel` das settings se vê. Desliga com
`"portaoAdvisor": false` no `projeto.json`; `travas.fecho: false` não o desliga.

---

## O `projeto.json` chave por chave

O `.claude/sworn/projeto.json` é gravado pelo `/sworn:init` e lido pelos portões. Você pode editá-lo à mão:
a abertura da sessão avisa o que está torto, e o `scripts/validar.js` confere o arquivo inteiro. As chaves
obrigatórias faltando reprovam com `falta a chave <nome>`; as de liga/desliga ficam de fora das obrigatórias de
propósito, para não invalidar o `projeto.json` de quem já tem um.

**As obrigatórias.**

| Chave | O que muda | Padrão que o init grava |
|---|---|---|
| `versaoConfig` | a versão do formato do arquivo; tem de ser `1` | `1` |
| `geradoEm` | a data (AAAA-MM-DD) da última gravação pelo init; o re-init a atualiza | a data de hoje |
| `plataforma` | `so` e `shell`, os dois em texto; o shell decide a tabela de idioma que o portão de shell aplica, e a regra do PowerShell 5.1 (sem `&&` e sem `\|\|`) só vale com o shell `powershell` | o que a varredura inferiu |
| `modeloDeAmeaca` | `interno` ou `publico`; entra no cabeçalho que a abertura reinjeta e orienta a lente de governança (onde o projeto declarou o risco como aceito, propor hardening que ninguém pediu é achado dela) | sem padrão: é resposta da entrevista |
| `provaDePronto` | o comando cuja saída o agente cola para provar o pronto; texto, ou `null` quando ainda não existe | o que a varredura achou, ou `null` |
| `quemDecide` | a quem se leva a decisão, em três opções; reinjetado na abertura | sem padrão: é resposta da entrevista |
| `fontesCanonicas` | os arquivos que mandam de verdade, em ordem; o resto é dado, não instrução; também entram no peso de instrução da auditoria, menos as que estiverem em `fontesDeConsulta` | os candidatos que a varredura achou, ou `[]` |
| `intocaveis` | padrões de caminho que nem o escopo declarado libera; o padrão que não pega arquivo nenhum é avisado na abertura | `[]` |
| `marchaPadrao` | a marcha (`rapida`, `padrao` ou `aaa`) do caminho que não está em nenhuma lista de `marchas`; valor desconhecido cai em `padrao` | `padrao` |
| `marchas` | três listas de padrões de caminho (`aaa`, `padrao`, `rapida`); o caminho que casa em duas listas fica na mais rigorosa; caminho absoluto ou com esquema (`C:`, `file://`) é recusado | a proposta que o `/sworn:init` faz a partir da listagem do repositório, confirmada por você |
| `comandosBloqueados` | expressões regulares (sem distinção de caixa) que o portão destrutivo trata como destrutivas, além das que já conhece; regex inválida reprova no validar, e o portão avisa uma vez por sessão que ela não barra nada | `[]` |
| `comandosLiberados` | expressões regulares dos comandos que o portão de shell deixa passar sem conferir; o validar reprova padrão que está nas duas listas e o que neutraliza um bloqueado | `[]` |
| `travas` | as quatro chaves de liga/desliga das travas (tabela abaixo) | todas `true` |
| `limiares` | os números dos gatilhos de troca de chat e dos prazos da auditoria (tabela abaixo) | `{}`: valem os padrões |
| `agentes` | `escada` (os nomes dos agentes, do mais barato ao mais caro) e `degraus` (cada agente com o apelido do modelo dele e, opcional, o esforço: `low`, `medium`, `high`, `xhigh` ou `max`, escrito assim), na mesma ordem; sem escada de pelo menos dois nomes, a trava 6 só conta | `{ "escada": [] }` |

**As de liga/desliga.** Só o booleano decide, sem aspas (ver "Os portões que não são travas").

| Chave | O que liga ou desliga | Padrão |
|---|---|---|
| `sugerirAprender` | a ordem de rodar o `/sworn:learn` quando você corrige o jeito de o Claude trabalhar (no máximo uma a cada cinco turnos) | ligado; `false` desliga |
| `oferecerRadar` | a oferta do `/sworn:radar` quando você pede melhoria, sugestão ou função nova (uma vez por sessão, só com o seu sim; nunca no repositório do próprio plugin) | ligado; `false` desliga |
| `auditarNaAbertura` | a auditoria automática da abertura, a cada `diasEntreAuditorias` dias | ligado; `false` desliga |
| `atalhosNaAbertura` | a lista dos atalhos deliberados na abertura, a cada `diasEntreAtalhos` dias | ligado; `false` desliga |
| `qualidadeDeResposta` | o bloco de seis regras de clareza das respostas | ligado; `false` desliga |
| `portaoDecisao` | o portão da pergunta ao dono (3 opções, a recomendada em primeiro) | ligado; `false` desliga |
| `portaoHandoff` | o portão do prompt do handoff no chat | ligado; `false` desliga |
| `portaoReferencia` | o portão da referência de topo: barra a entrega AAA sem revisão contra a `referencias` na sessão | ligado; `false` desliga |
| `portaoRevisao` | o portão da revisão aprovada: barra a entrega com arquivo de código da marcha AAA mudado na sessão sem revisão aprovada | ligado; `false` desliga |
| `portaoAdvisor` | o portão da consulta ao advisor: com o advisor do Claude Code ligado, barra uma vez por sessão a entrega com arquivo de código da marcha AAA mudado na sessão sem chamada ao advisor | ligado (só cobra com o advisor ligado); `false` desliga |
| `revisaoTodoCodigo` | o portão da revisão aprovada cobra todo arquivo de código mudado na sessão, de qualquer marcha, como o portão do commit | desligado; `true` liga |
| `portaoManual` | o portão do manual: nega editar arquivo da marcha AAA enquanto o manual de execução (skill com "padrao" no nome) não foi carregado na sessão | ligado; `false` desliga |
| `portaoCommit` | o portão do commit (`scripts/portao-commit.js`): nega o `git commit` enquanto um arquivo de código mudado na sessão não tem revisão aprovada; diz a faixa e quantos inspetores cada um pede, e aponta o atalho novo sem "trocar quando:". Do arquivo cuja revisão fechou no teto de 3 rondas ele não pede revisão nova: pede o commit com `# sworn: sem-revisao`, depois dos consertos com teste e da suíte inteira verde. Antes do `git push`, nega com o cartão do que ele publicaria: o destino (o endereço sai sem usuário nem senha), os commits que o remoto não tem pelo que este repositório sabe dele (um `git fetch` antes atualiza a conta), os arquivos, os autores, a sanitação de autores, mensagens e conteúdo dos arquivos (a classe e o lugar de cada achado, nunca o texto achado), e o aviso do `--force`, do `--delete` e do `--all`. Com o sim do dono, o mesmo push com `# sworn: push-visto` no fim do comando passa | ligado; `false` desliga, o cartão do push e o segredo no commit (`segredoNoCommit`) junto |
| `paralelismo` | as regras de trabalho em paralelo que a abertura injeta | ligado; `false` desliga |
| `avisoDeVolta` | o aviso antes de gastar: a 1ª mensagem num chat de 200 mil tokens ou mais, parado há mais de 1 hora, é parada com a conta de continuar contra abrir um chat novo e o resumo do chat gravado para o chat novo; mandada de novo, passa | ligado; `false` desliga |
| `avisoDeLeitura` | o aviso de leitura grande: antes do Read de um arquivo de texto acima de 64 KB sem `offset` nem `limit`, o Claude recebe o tamanho e o lembrete de ler só o trecho (Grep, depois `offset` e `limit`); avisa uma vez por arquivo na sessão e nunca nega | ligado; `false` desliga |
| `pedidos` | a lista dos seus pedidos: cada mensagem que chega ao Claude vira uma linha numerada, com data e hora, em `.claude/sworn/pedidos/<frente>.md`, e o `/sworn:handoff` a lê | ligado; `false` desliga |
| `juizAcima` | o inspetor da ronda 1 da revisão cega roda um degrau acima do modelo da sessão (Haiku vira Sonnet, Sonnet vira Opus; Opus fica), e o das rondas 2 e 3, que só conferem, um degrau abaixo desse (sessão Opus: Sonnet); sem saber o modelo da sessão, fica o do agente | ligado; `false` desliga |
| `guiaDoModelo` | o guia oficial do modelo (em `modelos/claude/`): a parte "How to ask" entra no fim do pedido de cada agente do sworn, a do modelo que vai rodá-lo, e a abertura traz a do modelo da sessão, exceto na abertura enxuta | ligado; `false` desliga |
| `menosCodigo` | o bloco "menos código" que a abertura injeta: a escada de 7 degraus antes de escrever código e o formato do comentário de atalho | ligado; `false` desliga |
| `aberturaEnxuta` | a abertura enxuta, para modelo de contexto curto: as regras do projeto inteiras e os blocos de paralelo, menos paradas, qualidade de resposta e menos código numa linha de resumo cada (perto de 2,3 mil caracteres a menos), e sem o guia do modelo da sessão | desligado; `true` liga |
| `segredoNoCommit` | o segredo no commit (`scripts/lib/segredo-commit.js`, pelo portão do commit): antes do `git commit`, a classe "segredo, chave ou token" da sanitação (`sk-`, `ghp_`, `gho_`, `ghs_`, `ghu_`, `github_pat_`, `AKIA`, `xox`, `AIza`, `npm_`, JWT, `Bearer` com valor, chave privada) varre as linhas acrescentadas do que está no índice; com `git add` no mesmo comando, ou com `git commit -a`, `--all`, `-p` ou caminho, também as dos arquivos rastreados mudados fora do índice; com `git add`, também os arquivos não rastreados fora do `.gitignore` (sem binário, sem link, sem arquivo acima de 1 MB e até 32 MB lidos no total); o git que passa de 15 s somados deixa o resto sem varrer. Nega com o arquivo, a linha e a classe, nunca o texto achado. Falso positivo (exemplo, isca de teste) passa com `# sworn: segredo-visto` no comando; a marca `# sworn: sem-revisao` não dispensa isto. O cartão do push segue varrendo de novo antes de publicar | ligado; `false` desliga; `"portaoCommit": false` desliga junto |
| `provaPorArquivoTocado` | a prova de cada turno passa a ser a dos arquivos de código mexidos: o teste que cita o arquivo pelo nome (ou é o próprio arquivo), rodado depois da última edição dele e verde. A suíte inteira (a `provaDePronto`) passa a ser cobrada pelo portão do commit, antes de cada commit; com `"portaoCommit": false`, essa cobrança sai junto | desligado; `true` liga |
| `vigia` | a novidade da semana e, do radar da semana, quantos candidatos e quantos para adotar, na abertura (só para quem mantém o plugin) | desligado, menos no repositório do próprio plugin; `true` liga, `false` desliga |
| `modoContinuo` | o modo contínuo: troca de chat só por tamanho (aviso a 250 mil), decisão técnica sem parar | ligado, com ou sem `projeto.json`; `false` desliga |
| `saidaEnxuta` | a saída enxuta: no Claude Code, a saída verde e longa de um comando de teste chega ao Claude só com o resumo do executor e o caminho da saída inteira, em `.sworn/provas/` (ver "Recibo da prova e saída enxuta"); o recibo e a conferência do bloco na trava 3 seguem com ela desligada | ligado; `false` desliga |
| `vermelhoAntes` | o vermelho antes de verde: o pronto com arquivo de teste editado na sessão, sem um comando de teste que o cobre ter falhado depois, barra no fecho (ver "Vermelho antes de verde") | ligado; `false` desliga |

**As opcionais.** Podem faltar sem erro; quando vêm, o validar as confere.

| Chave | O que muda | Padrão |
|---|---|---|
| `referencias` | a peça de topo contra a qual o `/sworn:review` compara (o `R.txt` no pacote e uma 2ª passada com A e B trocados, que dobra os inspetores), por tipo (`tela`, `codigo`, `texto`), cada tipo uma lista de caminhos ou URLs; tipo desconhecido (`telas`) e lista que tem item que não é texto reprovam no `node scripts/validar.js`, que diz a chave a corrigir; no `/sworn:init` rodado de novo, o tipo que você responder troca a lista dele e o tipo que você não citar fica como estava (lista vazia, `[]`, tira um tipo; `{}` não apaga nada); o `/sworn:reference` junta a ficha dele à lista do tipo, com o seu sim | sem a chave: nada muda |
| `marcaDeAtalho` | a marca que o `/sworn:shortcuts` procura nos comentários, no lugar de `atalho` (`ponytail` e `shortcut` seguem valendo); uma palavra só (letras, números, `-` ou `_`), senão reprova no validar | `atalho` |
| `fontesDeConsulta` | as fontes canônicas que se consultam, mas não se carregam como instrução (um registro de decisões, por exemplo): seguem mandando, mas saem do peso de instrução do `/sworn:audit`, que as mostra à parte com a contagem de cada uma; cada item tem de estar em `fontesCanonicas`, senão reprova no validar | sem a chave: todas as canônicas pesam |
| `admissao` | o resultado do teste de admissão do modelo, que o `/sworn:init` oferece e só roda com o seu sim (`node scripts/admissao.js --modelo <id> --gravar`): os 4 testes ao vivo (a abertura põe as regras, a edição fora do escopo é negada, o apagar é negado, o "passou" sem a saída do teste é barrado), cada um numa pasta temporária, com o modelo e a data; cada resultado é `ok`, `falhou`, `inconclusivo` ou `nao rodou`, e o que falhou é o que, com aquele modelo, não vale. No Claude Code e no Codex (com `--harness codex --codex <codex.exe>`, que gasta da cota do seu login do Codex) | sem a chave: o teste não rodou |
| `provaDeCoerencia` | o comando dos testes que conferem o disco inteiro de uma vez (a lista dos arquivos por sistema, a documentação de cada chave, o que não pode ir a público), que costumam reprovar por uma edição esquecida em outro arquivo. Com `provaPorArquivoTocado` ligada, a prova de cada turno também cobra esse comando verde depois da última edição de código, e o erro aparece no turno, não só na suíte inteira antes do commit. É um comando de terminal, como `"node --test test/plataforma.test.js test/readme.test.js"`; sem a `provaPorArquivoTocado`, não muda nada. Texto não vazio, senão reprova no validar | sem a chave: só os testes dos arquivos mexidos |
| `perfil` | o perfil de instalação, que dá o padrão de cada chave que o arquivo não escreve; a chave escrita no arquivo vence, também dentro de `travas`. `leve` deixa a trava do comando destrutivo e a revisão que você pede à mão, e desliga `travas.fecho`, `travas.outraFrente`, `portaoRevisao`, `portaoReferencia`, `portaoManual`, `portaoCommit`, `portaoAdvisor`, `sugerirAprender`, `oferecerRadar`, `auditarNaAbertura` e `atalhosNaAbertura`; `padrao` não muda nada; `estrito` liga `revisaoTodoCodigo`. Com perfil, `travas` pode vir em parte: para o `leve` valer numa trava que o arquivo já escreve, tire-a de `travas` (o `/sworn:init` que troca de perfil já troca as travas pelas que você responde na hora). Outro nome reprova no validar | sem a chave: tudo como no `padrao` |
| `gravidade` | o teto de bagatelas da revisão cega: `{ "ligada": true, "bagatelasPorRonda": 3 }` põe no briefing de cada inspetor que devolva no máximo esse número de achados `melhoria` (a bagatela, que já não segura a ronda), e o `apurar-ronda.js` guarda só esses nos `registros` de cada ronda, contando o resto em `bagatelasCortadas`. Fica desligada até uma leva de medição com achados plantados mostrar que as rondas e os tokens caem sem perder achado importante. `ligada` booleana e `bagatelasPorRonda` inteira de 1 para cima, senão reprova no validar | sem a chave, ou com `"ligada": false`: nada muda |

**As quatro travas**, dentro de `travas`. As quatro são obrigatórias e booleanas; com `perfil`, a que falta vem dele.

| Chave | O que `false` faz | Padrão |
|---|---|---|
| `travas.fecho` | desliga a cobrança de evidência no fim do turno (trava 3); o portão do prompt do handoff, o da referência de topo, o da revisão aprovada e o da consulta ao advisor não desligam com ela | `true` |
| `travas.destrutivo` | desliga o bloqueio de comando destrutivo e o do `cd` solto, juntos (trava 5) | `true` |
| `travas.outraFrente` | desliga o bloqueio de escrita em arquivo que outra frente já mexeu (trava 5) | `true` |
| `travas.escopo` | nada: a chave é exigida pelo schema, mas nenhum portão a lê (ver "Como desligar uma trava") | `true` |

**Os números**, dentro de `limiares`. Só número positivo vale: `0`, negativo, texto e `null` caem no padrão, e
`"300000"` entre aspas também não vale (grave `300000`).

| Chave | O que muda | Padrão |
|---|---|---|
| `limiares.turnosComTrabalho` | turnos com trabalho real que disparam o aviso de troca de chat | 15 |
| `limiares.revisoesFechadas` | revisões independentes fechadas | 2 |
| `limiares.bloqueios` | bloqueios de portão, somados | 6 |
| `limiares.arquivosTocados` | arquivos tocados | 25 |
| `limiares.decisoesDoDono` | decisões suas respondidas | 3 |
| `limiares.commits` | commits que passaram | 3 |
| `limiares.tokensDeContexto` | tamanho da conversa, em tokens de contexto, que dispara o aviso | 175000 (250000 com o modo contínuo) |
| `limiares.tokensAlarme` | o segundo aviso, firme | 450000 |
| `limiares.diasEntreAuditorias` | dias entre as auditorias automáticas | 7 |
| `limiares.diasSkillParada` | dias sem mudar para a skill do projeto contar como parada | 90 |
| `limiares.diasEntreAtalhos` | dias entre as listas automáticas dos atalhos | 30 |

---

## Para entender por quê

Cada trava nasceu de uma falha **nomeada** — mecanismo sem falha de origem é decoração, e foi por
esse critério que o que não tinha origem ficou de fora. A falha aparece no comentário de cabeçalho
do módulo que a resolve, e na mensagem que o portão devolve quando nega:

| Falha | Onde ela virou mecanismo |
|---|---|
| "declaro pronto sem ter olhado a saída" | `scripts/portao-fecho.js` · `scripts/lib/evidencia.js` |
| "sou otimista ao julgar o meu próprio código" | `skills/review/SKILL.md` · `scripts/lib/veredito.js` |
| "invento escopo que ninguém pediu" | `scripts/portao-escopo.js` · `scripts/lib/escopo.js` |
| "prefiro criar arquivo novo a entender o que já existe" | `scripts/lib/busca.js` |
| "quando o teste me atrapalha, tenho vontade de mexer no medidor" | `scripts/lib/catraca.js` |
| "escrevo o comando do mundo médio, que é Linux" | `scripts/lib/shell.js` |
| "não enxergo outra sessão trabalhando no mesmo lugar" | `scripts/lib/git.js` |
| "custo não me dói" | `scripts/portao-agente.js` · `scripts/lib/custo.js` |
| "julgo mal estética quando não há referência nomeada" | `scripts/lib/design.js` |

O registro completo — a autoavaliação de origem, a pesquisa, o desenho e o log de decisões — **não
é publicado**, por escolha de quem escreveu: é diário de trabalho, não documentação de produto.
O que a ferramenta faz está aqui e nos testes; por que ela faz assim está no código, ao lado da
linha que decide.

---

## Licença

[MIT](LICENSE).
