---
name: review
description: Revisao cega A/B de um arquivo mudado. Rotula os dois lados sem autoria, despacha inspetores de lentes distintas com default reprovar, e apura por script com teto de 3 rondas. Use quando o trabalho estiver escrito e antes de dar por pronto.
argument-hint: "<caminho do arquivo mudado>"
---

# `/sworn:review` — a revisão cega

Falha de origem: **eu sou otimista ao julgar o meu próprio código.** Gerador e avaliador têm os
mesmos pesos; quando eu reviso o que escrevi, eu não leio o código, eu re-derivo o raciocínio que o
produziu — e o raciocínio que produziu o bug reproduz o bug.

## Passo 1 — preparar o pacote cego

    node "${CLAUDE_PLUGIN_ROOT}/scripts/preparar-revisao.js" --arquivo <caminho> [--completa]

O script escreve `A.txt`, `B.txt` e `mapa.json` em `.claude/sworn/revisao/<arquivo>/<n>/`: cada
arquivo tem a sua base, e `<n>` é a ronda dele. O `<arquivo>` é o id do arquivo: cada `/` do caminho
vira `__`, cada caractere fora de letras, números, `.`, `_` e `-` vira `_`, e um id só de dígitos
ganha um `_` na frente (regra da função `idDoArquivo`, em `scripts/lib/cegar.js`). O
caminho exato vem na saída (`a`, `b`, `vereditos` e `base`); use o que a saída diz, não reconstrua.
**Você não abre `mapa.json`, e nenhum inspetor recebe o caminho dele.**

Quando o `projeto.json` declara `referencias` para o tipo do arquivo (texto, tela ou código), a saída traz
também `referencia` (o caminho do `R.txt`, a referência de topo) e `invertida` (`a`, `b` e `vereditos`): o
pacote tem uma 2ª passada, com A e B trocados (Passo 2).

**Vários arquivos = uma base cada.** Prepare, inspecione e apure um arquivo por vez; cada um tem as
suas rondas e o seu teto de 3. Se a saída avisar "formato antigo", há uma revisão da 0.3.0 em
andamento em pastas numeradas soltas: ela segue na base única até acabar.

Não fatie à mão. Fatia que corta função no meio faz o inspetor reportar o corte como defeito e
contamina a ronda. Na faixa `completa` (Passo 2), `A.txt` e `B.txt` são o arquivo inteiro. Nas faixas
pequenas, quando a saída traz `trecho`, o próprio script já recortou: cada lado leva só o trecho mudado,
com a margem de `trecho.margem` linhas, nos números de linha do arquivo; as linhas de fora estão em
branco e a primeira de cada vão diz `[fora do trecho: linhas a-b]`.

## Passo 2 — ronda 1: a faixa da mudança, depois as lentes da família certa

**Primeiro a faixa: a revisão é proporcional ao diff** (decisão do dono, 2026-10-12). A saída do Passo 1 traz
`faixa`, `lentes` e `linhasMudadas` (o lado maior do diff contra o HEAD: linhas removidas ou acrescentadas).
As lentes de cada faixa estão em `scripts/lib/veredito.js` → `lentesDaFaixa`.

| `faixa` | Quando | Quantos inspetores |
|---|---|---|
| `uma` | até 3 linhas mudadas: só comentário, número ou frase curta | **1**: `correcao` |
| `duas` | até 40 linhas de lógica, com teste vermelho e mutação já rodados | **2**: `correcao` e `borda` |
| `texto` | texto (`.md`, `.markdown`, `.txt`) com mais de 3 linhas mudadas | **2**: `correcao` e `microcopy` |
| `completa` | arquivo novo, mais de 40 linhas de lógica, estilo, igual ao HEAD ou sem medida | a tabela de famílias, abaixo |

O script mede linhas, não sentido. **Você pode subir de faixa, nunca descer:** 3 linhas que mudam lógica sobem a
`duas`; `duas` sem teste vermelho e mutação rodados sobe a `completa`; mudança que monta tela sobe a `completa`.
Para subir à `completa`, passe `--completa` no Passo 1: o pacote sai com o arquivo inteiro, sem recorte. Se a ronda já
foi preparada sem ele, apague a pasta dela, que ainda não tem vereditos, e prepare de novo com a flag.
Diga ao usuário a faixa usada e, se subiu, por quê. A regra de parada (Passo 5) é a mesma em toda faixa.

**Duas famílias, por decisão do dono.** Elas divergem **por desenho**:
a de código julga código, a de UI julga tela. Não se fundem.

| O que mudou | Quantos inspetores | Onde estão as lentes |
|---|---|---|
| Só lógica (não é de estilo e não monta tela) | **7** | `scripts/lib/veredito.js` → `LENTES` sem as de `SAEM_SO_LOGICA` (`design`, `medidor`, `escopo`) |
| Só código | **10** | `scripts/lib/veredito.js` → `LENTES` |
| Só tela | **8** | `scripts/lib/veredito.js` → `LENTES_UI` |
| Código e tela | **18** | as duas listas |

**A mudança toca tela** quando o escopo declarado inclui arquivo de estilo
(`scripts/lib/design.js` → `ehArquivoDeEstilo`) ou markup que o projeto renderiza.
Na dúvida, **as duas famílias** — a marcha mais rigorosa ganha.

**Arquivo só de lógica** — que não é de estilo e não monta tela — dispensa a lente `design` (decisão
do dono, 2026-09-29) e, desde 2026-10-11, também `medidor` e `escopo` (na ronda 1 de 41 revisões, 11 de 13 e
5 de 6 achados delas foram refutados na fonte): são 7 inspetores, as de `LENTES` sem as de
`SAEM_SO_LOGICA`. Na dúvida, as 10 — elas só saem quando é claro que o arquivo não é de estilo e não
monta tela.

**Lente `enxuto` (código que não precisava existir, desde a 0.9.0)** — nasce em observação, porque lente
que julga "a mais" já foi refutada na fonte em 5 de 6 achados (`escopo`). **Regra de saída:** depois de 10
revisões com ela, se 2 de cada 3 achados dela tiverem sido refutados na fonte, ela entra em
`SAEM_SO_LOGICA` e sai do arquivo só de lógica, como `escopo`. Validação na fronteira, perda de dados,
segurança e acessibilidade nunca são excesso: achado dela contra isso é refutado. Atalho deliberado,
com o comentário `atalho: <o que>. limite: <até onde vale>. trocar quando: <gatilho>.`, é dívida
declarada, não excesso; o que não traz o gatilho o `/sworn:shortcuts` lista — rode-o antes de um release.

Leia as lentes do arquivo, **não de memória**. Despache todos no mesmo disparo, **um subagente
`sworn:inspector` por lente**.

Briefing de cada um, exatamente nesta forma:

> Sua lente é **<titulo>** (`<chave>`): <pergunta>.
> Leia apenas estes dois arquivos: `<caminho de A.txt>` e `<caminho de B.txt>`.
> Leia também `<caminho de regua.md>`: é a régua do projeto. Achado de valor fora da régua cita o valor dela.
> Pasta de vereditos: `<caminho de vereditos>`. Não a abra: copie o caminho, sem mexer, no campo `vereditos` do JSON, e ponha a chave da lente (`<chave>`) no campo `lente`.
> Não abra o repositório. Não abra `mapa.json`. Devolva só o JSON do seu formato.

Quando a saída do Passo 1 traz `trecho`, acrescente ao briefing, logo depois da linha dos dois arquivos:

> A e B são recortes: só o trecho mudado, com margem. A linha `[fora do trecho: linhas a-b]` marca o que ficou de fora, e as linhas em branco depois dela são esse vão. O vão não é defeito: se a resposta depender do que está fora, diga "não consigo ver", e esse achado é no máximo P2.

A linha da régua só entra quando a saída do Passo 1 traz `regua` com um caminho. Quando traz
`semRegua`, diga ao usuário que a revisão rodou **sem régua do projeto** — o inspetor julgou pelo
bom senso, não pelo sistema declarado.

**Com referência** (a saída do Passo 1 traz `referencia`), acrescente ao briefing, depois da linha da régua:

> Leia também `<caminho de R.txt>`: é a referência de topo, nomeada (não é A nem B). Julgue cada lado contra ela e devolva `vsReferencia` e `lacunas`, como diz o seu formato.

E despache a **2ª passada**: as mesmas lentes de novo, um subagente por lente, com o mesmo briefing trocando
os dois arquivos por `invertida.a` e `invertida.b` e a pasta de vereditos por `invertida.vereditos`
(`<ronda>/invertida/vereditos`). É a ordem A/B trocada: contra a referência, só vale o que se repete nas duas
ordens (decisão do dono, 2026-10-13). As duas passadas podem ir no mesmo disparo. **O custo dobra**: cada lente roda
duas vezes; diga isso ao usuário junto do número de agentes.

**Quem grava é o hook** (`scripts/gravar-veredito.js`, no `SubagentStop` do inspetor e no handback do subagente): ele
tira o JSON da resposta e o grava em `<lente>.json` na pasta `vereditos` que o inspetor devolveu, conferindo que é
a de uma ronda. Ele nunca barra e nunca sobrescreve arquivo que já existe. Antes do Passo 3, **confira que há um
arquivo por lente despachada** em `vereditos/` (lista a pasta e conta), e, com referência, também em
`invertida/vereditos/`. O que o hook avisou que não gravou, ou que
não está lá, grave à mão, como `<lente>.json` (a chave da lente), com o JSON que o inspetor devolveu, no caminho
`vereditos` da saída do Passo 1. **Em projeto configurado, o `Write` em `.claude/sworn/revisao/**.json` pode ser
negado pelo portão de escopo** (a "trava 4": ela só deixa gravar o que o escopo declarado da tarefa cobre). O
escopo declarado fica em `.claude/sworn/escopo.md`; se a sessão trabalha numa frente (uma linha de trabalho
paralela do mesmo projeto), fica em `.claude/sworn/escopos/<frente>.md`, o arquivo da frente. Acrescente
`.claude/sworn/revisao/**` à seção "Dentro" do que estiver em vigor, com `Edit`, sem apagar o resto, e grave
de novo (o portão não barra a edição do próprio arquivo de escopo, mas conta a ampliação e a avisa no fecho do
turno). Se o escopo em vigor é de outra tarefa ou de outra sessão, peça o OK do dono antes de ampliá-lo e tire a
linha de volta quando a revisão fechar. **Se a edição do escopo também for negada, ou o dono não autorizar a
ampliação: pare.** Diga ao dono quais vereditos ficaram sem gravar e deixe a decisão com ele; não grave por
shell nem por outro caminho que contorne o portão. Tudo isto vale também para `refutados.json` e
`mesmos.json` do Passo 3.

**Declare ao usuário quantos agentes rodaram.** Custo é informação dele, não detalhe seu.

## Passo 3 — apurar por script, nunca por julgamento

    node "${CLAUDE_PLUGIN_ROOT}/scripts/apurar-ronda.js" --arquivo <caminho>

O `--arquivo` é o mesmo do Passo 1 e escolhe a base dele. Sem ele, o script acha a base sozinho se
houver uma só; com mais de uma, para com erro que lista os arquivos.

Quem decide se a ronda foi seca é o script, não você. Cole a saída dele na resposta.

- **O script confere as lentes que votaram.** O `mapa.json` leva a faixa: a ronda 1 sem alguma lente da faixa (na
  `completa`, com menos de 7 lentes conhecidas) e a ronda com alguma lente que achou P0 ou P1 e não voltou param com
  `ERRO`, como a ronda sem veredito. Grave o voto que falta e rode de novo.
- **Achado fora do formato** (severidade que não é P0, P1 nem P2; sem `arquivo:linha`) é descartado e não molha a
  ronda. Quando a revisão aprova com algum, o `motivo` diz quantos: leia `vereditosDescartados` antes de dar por
  aprovado. P0 ou P1 descartado que for defeito real se corrige, e o arquivo passa por revisão nova.
- **Só o lado novo molha a ronda.** O script lê o `mapa.json` de cada ronda: P0/P1 citado no lado
  antigo (o que a mudança conserta, ou já existia) sai em `achadosDoLadoAntigo` — informação, não
  bloqueio. Você continua sem abrir o `mapa.json`: quem o lê é o script.
- **Achado refutado na fonte primária** vai em `refutados.json`, na base do arquivo (a pasta `base`
  da saída do Passo 1):
  `[{ "ronda": 2, "lente": "design", "arquivo": "B.txt", "linha": 471, "severidade": "P1", "prova": "<arquivo:linha ou comando>" }]`.
  A `severidade` é a do achado: refutar o P1 de uma linha não derruba o P0 da mesma linha. Sem `prova`
  ou sem `severidade`, o script para com erro. A saída lista os refutados para o dono conferir.
- **Com referência**, a saída traz `referencia` (sem ela, `null`): `lentes`, cada uma com `ordem1`, `ordem2` e
  `resultado` (`vence`, `empata`, `perde` ou `incompleta`, pela última ronda que a chamou); `lacunas` do lado
  novo; `lentesAtras` (as que perdem, estão incompletas ou têm lacuna P0/P1); e `pronta`. Achado da 2ª passada
  sai com `passada: 2`: o `A.txt` dela é outro arquivo, então a refutação dele leva `"passada": 2`.
- **Achados vizinhos podem ser o mesmo defeito.** Se a saída traz `paresCandidatos` não vazio, despache **um**
  subagente `sworn:dedupe-judge` com a lista inteira (com mais de 50 pares, lotes de até 50, um subagente por
  lote, no mesmo disparo). Grave o que ele devolver em `mesmos.json`, na mesma pasta do `refutados.json`, pelo
  Write: `[{ "novo": "<chave>", "outro": "<chave>", "resposta": "sim" }]`, e rode o script de novo. A saída passa
  a trazer `provaveisMesmos`. **Nada na contagem muda:** o achado novo segue molhando a ronda. Se ele for repetição
  de algo já corrigido, prove isso na fonte e use o `refutados.json`; a palavra do juiz não é prova. Juiz que
  falha ou não responde: siga sem `mesmos.json`, e a saída é a de sempre.

Quando a revisão **fecha**, o próprio script conta um `revisao_fechada` — é o gatilho contável de
troca de chat, e nada mais no plugin o incrementa. Ele descobre a sessão sozinho; passe
`--sessao <id>` só se precisar forçar (o id leva só letras, números, `_` e `-`; sem valor ou com outro
caractere, o script para com erro). A saída traz `revisaoFechadaContada` para você conferir.
Rodar o script de novo numa revisão já fechada **não conta outra vez**: o fecho fica registrado na
base (`fechada.json`) e a saída diz que já foi contada. Preparar de novo um arquivo cuja revisão já
fechou começa **revisão nova**: o `preparar-revisao.js` move a base inteira para
`.claude/sworn/revisao-fechada/<arquivo>/<carimbo>/` (nada se apaga; a saída diz o destino em
`arquivada`) e a ronda volta a ser a 1, com o teto de 3 inteiro. O fecho da revisão nova conta de novo.

## Passo 4 — rondas seguintes

- **Ronda 1 descobre; as seguintes verificam.**
- A ronda 2 chama **só as lentes que acharam P0 ou P1**, com o briefing reformulado em pergunta
  específica sobre o próprio achado. Ordem de grandeza, na faixa `completa`: **10 → 4 → 2**.
- Com referência, ela chama também as lentes de `referencia.lentesAtras`, nas duas passadas.
- Se nenhuma lente achou P0 ou P1, a ronda seguinte chama **ao menos uma** (a de correção): ronda sem
  nenhum veredito não é ronda seca, e o `apurar-ronda.js` para com erro.
- Antes de cada nova ronda, corrija o que a anterior achou e rode `preparar-revisao.js` de novo.

## Passo 5 — parar

O `apurar-ronda.js` diz quando parar.

Com referência, duas rondas secas só aprovam quando toda lente empata ou vence a referência nas duas ordens,
sem lacuna P0/P1 do lado novo (`referencia.pronta`). **Referência não alcançada** é o contrário: alguma lente
fica atrás dela numa das ordens, ou sobra lacuna P0/P1. Antes da ronda 3, a revisão não encerrou: o `motivo`
lista as lentes que ficaram atrás, e a próxima ronda as chama. Na ronda 3, é o teto.

Três saídas possíveis:

| `motivo` | O que você faz |
|---|---|
| duas rondas secas (com referência: e `referencia.pronta`) | Aprovado. Feche dizendo quantos agentes rodaram, em quantas rondas |
| teto de 3 rondas com P0/P1 aberto ou a referência não alcançada | **Para.** Leva ao dono com exatamente 3 opções, a recomendada marcada. O que sobrar vira registro |
| ainda não encerrou (inclui a referência não alcançada antes da ronda 3) | Corrige e roda a próxima ronda, com as lentes que o `motivo` lista |

## Passo 6 — o que não foi inspecionado

O fecho lista **todo arquivo mudado no escopo que não passou por esta revisão**, e por quê
(escolha de custo, arquivo gerado, fora da família de lentes). Arquivo novo passa, com um lado
vazio: diga que nele a cegueira não existe. Silêncio sobre o que não foi inspecionado equivale a
dizer que foi.

## O que esta revisão não faz

- **Não julga se a interface ficou bonita.** Sem print, a lente visual responde "vaza?" e não
  responde "está bom?". Dito agora, não descoberto no fim.
- **A cegueira é parcial.** Contagem de linhas e comentário de correção entregam qual lado é o novo.
  Por isso o placar A/B é **sinal**, e o achado com `arquivo:linha` é a **prova** — ele se sustenta
  mesmo que o inspetor tenha adivinhado os lados.
- **P2 não vira correção.** Achado fora do escopo do pedido é registro. Qualidade máxima se aplica ao
  que foi pedido, jamais à ampliação do pedido.
