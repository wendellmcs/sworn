# Changelog

## 0.17.1 — duas explicações corrigidas: o aviso dos atalhos e o apelido de modelo

**Corrige**

- **A skill `/sworn:shortcuts` dizia que qualquer linha sem rótulo (`limite:` ou `trocar quando:`) logo abaixo de
  um atalho dava o aviso "sem ponto final".** Só a linha de comentário com texto pode dar esse aviso, quando o atalho
  não termina em ponto; uma linha de código, um comentário vazio ou outro atalho logo abaixo encerram a leitura sem
  aviso. A skill agora diz isso, e o conserto segue o mesmo: começar a linha de baixo com um rótulo ou subir o resto
  da frase.
- **O GUIA usava "apelido" sem explicar e dava de exemplo nomes completos de modelo, que mudam com o tempo.** Agora
  explica que o apelido é o nome curto do modelo na tabela `agentes.degraus`, como `sonnet`, e o exemplo não traz
  mais nomes completos.

## 0.17.0 — o bloqueio diz o que fazer, e o que não se lê não passa calado

A primeira de três etapas da revisão completa do plugin passou, arquivo por arquivo, pela revisão cega: a própria
revisão cega, os portões que barram e avisam, e o estado que eles gravam. Os problemas pequenos que ela achou foram
consertados e revisados de novo. Quase toda mensagem de bloqueio ou de aviso passa a dizer o próximo passo, e a
configuração torta, o arquivo que não se lê e a opção sem valor viram aviso ou erro com a causa, em vez de passar
calados.

**Mensagens que dizem o passo**

- **O bloqueio diz o que fazer no lugar.** O portão de escopo, quando o `projeto.json` não se lê ou o estado da
  sessão não se grava, cita a pasta e o passo. O portão de commit explica numa linha própria o que são a faixa de
  revisão e os inspetores que cada arquivo pede. O arquivo intocável traz as respostas possíveis à pergunta ao dono,
  também quando quem barra é a trava 5 (comando destrutivo). O aviso da trava 8, que barra a edição que sobe um teto
  ou desce um piso, diz, sem jargão, como refazer a edição e como levar a decisão ao dono.
- **O aviso de configuração diz o arquivo, o campo e o efeito.** Na escada (`agentes.degraus`), nome inválido ou
  item ausente vem com o conserto; o aviso de custo diz onde mexer e o que muda; o teto de agentes do paralelo vem
  com a unidade. No módulo de design, o aviso diz quais anti-referências foram ignoradas, e o do arquivo de estilo
  gravado por comando de shell diz onde registrar uma leitura errada do sworn, com o pedido de tirar segredo do
  comando antes.
- **O apelido de modelo diz o passo.** No portão de apelido, a escrita negada no `--corrigir` diz o arquivo e a
  causa, e "nada a corrigir" diz a grafia e o `--mapa`. Na prova dos apelidos (`provar-apelidos.js`), o resultado
  que não dá para verificar manda rodar o `/sworn:init`.

**O que não se lê não passa calado**

- **Estado torto sai na leitura.** A sessão gravada que não é objeto volta vazia; o contador ou o valor torto sai, e
  o resto da sessão fica.
- **Padrão de `comandosBloqueados` que não compila avisa.** O portão de comando destrutivo diz, uma vez por sessão,
  que aquela expressão não barra nada, em vez de ignorá-la calado.
- **Permissão torta não é sobrescrita.** Ao autorizar o `/sworn:parallel`, `permissions.allow` ou `permissions.deny`
  do `.claude/settings.local.json` que não é lista de textos faz o script parar com a forma esperada.
- **Opção sem valor é erro de uso.** No `scripts/plataforma.js`, a opção sem valor e o sistema fora da lista saem
  com código 2; a pasta que não se lê entra na lista do que não foi lido, e a tabela não se diz completa.
- **Valor ausente não vira "null".** As mensagens que citam um valor ausente não escrevem mais `null` nem
  `undefined` no lugar dele.

**Revisão cega**

- **O caminho real decide.** O `--arquivo` do `preparar-revisao.js` e a pasta dos vereditos são lidos pelo caminho
  real: um link (ou junction, no Windows) que leva para fora da pasta atual é recusado, sem gravar nada.
- Na mensagem do achado descartado, o começo da descrição (60 caracteres) não parte mais um emoji ao meio.

**Estado e segurança**

- **Duas sessões ao mesmo tempo não disputam o mesmo arquivo temporário.** O temporário da escrita do estado tem
  nome único, e a escrita que falha no meio apaga o dela; antes, a segunda sessão podia cair ao renomear.
- **A trava 8 não quebra com lista enorme.** Com perto de 130 mil números na mesma edição, a conta do maior e do
  menor valor dava erro; agora ela olha um número de cada vez.
- **A varredura de segurança lê arquivo com fim de linha só CR.** No `auditar.js --seguranca`, o CR sozinho também
  separa linhas; antes, num arquivo assim, as regras que olham o começo da linha não casavam, e o achado passava.

**Para quem usa os scripts de skill e de experimento**

- O gerador de skill lê a `description` só no cabeçalho (também em bloco do YAML), entende o critério em inglês e
  diz o que escrever. A prova de obrigações dá erro com a causa em pasta vazia, inexistente ou sem `SKILL.md`, e
  `NAO PROVADO` e `INCONCLUSIVO` dizem o passo seguinte.

**Textos**

- O guia, a skill de atalhos e a descrição do plugin ficaram mais claros: a tabela de ganchos cita o bloqueio do
  `ESCALAR:`, a trava 6 vira lista, a skill de atalhos diz o que acontece com rótulo repetido, e a entrada da 0.16.0
  explica os termos que usava sem glosa.

## 0.16.0 — a escada decide o modelo e o esforço, e o achado da revisão cita o que leu

Cada agente da escada (do mais barato ao mais caro) passa a ter o modelo e o esforço gravados, e a chamada que foge
deles é barrada com a chamada certa escrita. O subagente que vê a tarefa passar do papel dele pede o degrau seguinte,
e o `/sworn:audit` mostra com que modelo e esforço os subagentes rodaram de fato. Na revisão cega, achado só conta
com o trecho copiado do arquivo. Na troca de chat, os seus pedidos seguem numerados, cada frente mostra a última nota,
e o handoff espera os agentes de fundo terminarem.

**Escada de modelo e esforço**

- **O esforço entra na tabela da escada.** Cada degrau de `agentes.degraus` no `projeto.json` pode gravar, além do
  apelido do modelo, o esforço com que o agente pensa (`low` a `max`). O `/sworn:init` pergunta, o `gerar-agentes.js`
  escreve no arquivo do agente, e o aviso de apelido passa a avisar também quando o `effort:` do arquivo difere do
  esforço gravado.
- **Agente da escada chamado fora da tabela é barrado.** Quando o agente principal chama um agente da escada
  (`agentes.degraus` no `projeto.json`) passando `model` ou `effort` diferente do que a tabela diz, o portão de custo
  nega e escreve a chamada certa. O que a chamada passa vence o que o arquivo do agente declara: sem esta conferência,
  a tabela não valeria. Chamada sem esses campos passa, e quem decide é o arquivo do agente.
- **O degrau que pede escalada é atendido.** Quando um agente da escada para e termina a resposta com a linha
  `ESCALAR: <agente> - <motivo>`, o sworn guarda o pedido; se o turno do agente principal termina sem despachar o
  agente pedido, o fim do turno é barrado uma vez, com a chamada certa escrita. Destino fora da escada, ou abaixo de
  quem pediu, vira o degrau seguinte. Duas subidas seguidas na mesma tarefa vão sozinhas; a terceira, e o pedido do
  topo da escada, vão para o usuário decidir. Os agentes gerados pelo `/sworn:init` já ensinam a linha.
- **A conversa principal pensa conforme a marcha.** Duas skills fora do menu, `effort-low` e `effort-high`, que o
  playbook chama pela marcha no começo de cada turno da tarefa, porque o esforço de uma skill dura só até o fim do
  turno (medido no Claude Code 2.1.311): a marcha rápida baixa o esforço, a máxima sobe, e a passagem de rápida para
  padrão chama a alta naquele turno. Só o esforço muda: uma skill não troca o modelo da conversa (medido no Claude
  Code 2.1.310); para isso, o usuário digita `/model`. O agente avisa numa linha, uma vez por conversa, o que mudou.
- **O `/sworn:audit` mostra o modelo e o esforço que rodaram de fato.** Lê as transcrições dos subagentes dos
  últimos 30 dias e compara a última resposta de cada degrau com a tabela. Apelido que passou calado para outro id
  de modelo (por exemplo, `sonnet` de `claude-sonnet-5` para `claude-sonnet-5-5`) vem primeiro, como aviso. A rodada
  automática da abertura não mede: leria todas essas transcrições, 23 s num projeto grande.

**Revisão cega**

- **Achado só conta com o trecho lido.** Cada achado do inspetor diz o estado. `confirmado` traz a severidade e o
  trecho copiado do arquivo citado, que a apuração (a conta que o script faz das respostas dos inspetores) procura
  no lado da rodada (a linha citada e até 2 em volta); trecho que não confere fica fora da conta. `pendente` não tem
  severidade: diz o fato que falta para decidir e também fica fora. Achado sem estado, ou confirmado sem trecho,
  invalida o veredito inteiro (a resposta daquele inspetor), e a apuração para em vez de dar a rodada como limpa.

**Travas e segurança**

- **Commit que pula os ganchos é barrado.** `git commit --no-verify` (ou `-n`, também junto de outras letras, como
  `-anm`) e `--no-gpg-sign` caem na trava 5 (comando destrutivo): pular o gancho de commit pula a revisão e os
  testes que ele roda. O que vem dentro da mensagem não conta (`-m "explica o --no-verify"` passa), e a última
  opção vence, como no git (`-n --verify` passa). Ainda não são lidos dois outros jeitos de pular: o
  `-c core.hooksPath=<pasta>`, que troca a pasta dos ganchos só naquele comando, e o `commit.gpgSign` desligado na
  configuração do git, que tira a assinatura de todo commit sem opção nenhuma no comando.
- **Varredura de segurança antes de instalar um plugin ou uma skill.** `node "<plugin>/scripts/auditar.js"
  --seguranca <pasta>` lista, sem IA, o que pede atenção: rede, `eval`, processo filho, credencial, pasta pessoal e
  gancho que escreve fora da pasta do plugin, cada um com arquivo:linha e o trecho. Diz o que não leu (binário,
  arquivo grande, pasta ignorada, corte) e nunca diz "seguro".

**De um chat ao outro**

- **Os seus pedidos ficam numa lista.** O gancho de entrada grava cada mensagem sua numa lista numerada por frente
  (`.claude/sworn/pedidos/<frente>.md`), com data e hora, o texto limpo, segredo mascarado e corte no tamanho. O
  `/sworn:handoff` leva cada pedido ao chat seguinte com o número e o estado: feito, aberto ou recusado. Só grava num
  projeto com `.claude/sworn/`; `"pedidos": false` desliga.
- **A lista de frentes diz onde cada uma parou.** Na abertura, cada frente aparece com o começo do Objetivo, a última
  nota de sessão, o plano e onde ler o detalhe, no lugar dos 200 primeiros caracteres do arquivo.
- **Handoff com dono.** Ler um arquivo de handoff grava a sessão como dona dele; se outra sessão o leu há menos de
  24 h, sai um aviso, para dois chats não continuarem o mesmo trabalho.
- **O progresso vai para o plano durante a tarefa.** Com um plano na sessão, 5 respostas com trabalho sem o arquivo
  do plano mudar trazem o lembrete de anotar onde a tarefa está: uma troca de chat no meio dela não perde nada.
- **O handoff espera os agentes de fundo.** Enquanto um subagente em segundo plano roda, o fim do turno segura a
  ordem de gerar o handoff e avisa uma vez; o agente parado, ou calado há 30 minutos, não conta. O `/sworn:handoff`
  confere antes com `scripts/agentes-rodando.js`.

**Auditoria e atalhos**

- **Cada memória e cada regra têm idade.** A memória pela data do arquivo, a regra pelo `git blame` (fora do git,
  "não sei"). Mais de 90 dias sem mudar é fria; duas memórias com a mesma descrição são duplicadas. O
  `/sworn:audit` propõe aposentar movendo o arquivo para uma pasta de arquivo, com o seu sim: nada some.
- **A nota de atalho pode continuar nas linhas de baixo.** O `/sworn:shortcuts` junta à nota as linhas logo abaixo
  que abrem com um rótulo ainda não usado (`limite:`, `trocar quando:`), em qualquer ordem; num bloco `/*` ou
  `<!--` aberto, conta toda linha até o fecho. Nota sem ponto final com um comentário sem rótulo logo abaixo sai com
  o aviso de que a linha de baixo ficou de fora.

**Paralelo e página**

- **No `/sworn:parallel`, cada arquivo tem um dono.** A tarefa que edita lista os arquivos dela, e o mesmo arquivo
  em duas tarefas para o workflow antes de gastar agente; o que o agente diz ter mexido fora da lista volta à parte.
- A tabela das oito travas no README cabe na tela do celular: duas colunas em vez de quatro.

**Manutenção**

- Para quem mantém o plugin: são **29 baldes** de contador: 23 que negam, 6 que só contam. Balde é cada contador
  com nome, um por tipo de evento (um bloqueio, um aviso, um despacho), que o sworn soma em
  `.claude/sworn/contadores.json`. Os novos somam as chamadas barradas por fugir da tabela e os fins de turno
  barrados com escalada sem despacho. Um teste novo confere que todo agente tem `name` igual ao nome do arquivo e
  uma `description`, e que todo script de `scripts/` é citado por algum teste.

## 0.15.0 — entrega de rigor máximo só com revisão aprovada, o sworn em inglês e página nova

O agente não dá mais por pronta uma entrega de rigor máximo sem revisão cega aprovada. O sworn passa a entender
inglês além de português e responde no idioma de quem pergunta. A página do repositório mostra tudo que o plugin faz,
com o motivo de cada peça.

**Novo**

- **"Pronto" em arquivo de rigor máximo só com revisão aprovada.** Quando o agente diz que a entrega está pronta e
  mudou na sessão um arquivo de código da lista de rigor máximo (`marchas.aaa` no `projeto.json`) sem revisão cega
  aprovada, a resposta é barrada: o turno não termina, e o agente recebe uma mensagem e continua. Vale com ou sem
  `referencias`. Revisão cega é a do `/sworn:review`: inspetores comparam a versão antiga e a nova sem saber qual é
  qual. Aprovada é a revisão que passou duas rodadas seguidas sem problema grave novo, a mesma que libera o commit.
- A mensagem cita os arquivos e dá ao agente três saídas:
  1. rodar `/sworn:review` até "aprovado";
  2. se 3 rodadas passarem sem aprovação, parar e pedir ao usuário que escolha entre três caminhos: corrigir e mandar
     um inspetor conferir só o conserto; entregar sem revisão, com o motivo; ou começar a revisão de novo;
  3. sem revisar, dizer por conta própria na resposta que a entrega fica "sem revisão", e por quê.
- Texto (`.md`, `.txt`) e arquivo apagado ficam fora; arquivos das listas `marchas.padrao` e `marchas.rapida` não mudam.
  Desliga com `"portaoRevisao": false` no `projeto.json`.
- Para quem mantém o plugin: são **27 baldes** de contador: 21 que negam, 6 que só contam. Balde é uma categoria do
  contador de eventos que o sworn soma no projeto (`.claude/sworn/contadores.json`); os que negam somam as vezes em que uma trava barrou o agente, os
  outros só registram que algo aconteceu. O novo soma as entregas barradas sem revisão.

**Inglês e português**

- **A resposta segue o idioma de quem pergunta.** O bloco de qualidade de resposta, injetado em toda sessão, manda o
  agente responder no idioma do usuário.
- **O fecho entende alegação em inglês.** "all tests pass", "it works", "fixed", "Task 3 is done", "Finished tasks 1
  and 2" contam como dizer que está pronto; "did not run", "couldn't verify", "still fails" contam como declarar o que
  não rodou ou ainda falha. Palavra que só descreve não alega: "completed in 2s", "ready to accept", "how it works".
- **Plano escrito em inglês é contado.** Tarefas e itens marcados com Task, Step, Stage, Wave ou Phase entram na conta
  de subitem aberto; antes, um plano em inglês dava zero tarefas e a trava não via nada.
- **Skills, agentes, modelos e o comando paralelo em inglês.** O texto das skills, dos agentes, dos modelos e do
  workflow saiu do português; os comandos e o que eles fazem não mudam. As mensagens que os ganchos (os scripts que o
  Claude Code roda a cada evento, como abrir a sessão ou encerrar o turno) mostram ao agente e ao usuário seguem em
  português.
- O `/sworn:learn` não recusa mais uma regra em inglês só por ter a palavra "stop". Ele recusa regra que crava nome de
  evento de gancho, e o evento `Stop` agora só casa escrito com maiúscula.

**Página**

- README reescrito como vitrine, em inglês e português: abre com um bloqueio real e mostra, por problema, as oito
  travas com o porquê, os portões que se desligam por uma chave do `projeto.json`, os blocos injetados, a troca de chat, os painéis, a revisão
  cega por dentro, os comandos, os agentes e o workflow.
- Figura nova dos ganchos: cada evento e o script que ele chama, clara e escura, nos dois idiomas.

## 0.14.0 — o esquadro agora se chama sworn, e o fecho olha o resultado da prova

O plugin muda de nome e os comandos passam a ser em inglês; a pasta de configuração migra sozinha. O portão de fecho
deixa de aceitar como prova um bloco que mostra falha. A página do repositório foi refeita, com a medição de antes e
depois feita em público. Cada mudança ganhou antes um teste que falhava e passou pela revisão cega.

**Quem já usa o esquadro: o que fazer uma vez**

O marketplace e o plugin mudaram de nome, então a atualização não chega sozinha. No terminal:

```
claude plugin uninstall esquadro@esquadro-local
claude plugin marketplace remove esquadro-local
claude plugin marketplace add wendellmcs/sworn
claude plugin install sworn@sworn-local
```

- Na primeira sessão depois disso, a abertura renomeia `.claude/esquadro/` para `.claude/sworn/` e diz numa linha;
  o mesmo para `~/.claude/esquadro/`, só com o vigia ligado. Os caminhos de `referencias` do `projeto.json` que
  passavam pela pasta velha são reescritos. Se `.claude/sworn/` já existe, nenhuma das duas é mexida e a abertura
  avisa uma vez: o sworn lê só a nova, e o que ainda servir da antiga você leva à mão. Se a renomeação falhar (outra
  sessão do Claude Code usando a pasta), feche as outras sessões e abra uma nova.
- A variável `ESQUADRO_VIGIA` passa a ser `SWORN_VIGIA`.
- A autorização do comando paralelo gravada com o nome antigo não vale para o nome novo: rode o `/sworn:init` de
  novo, que confere e pergunta.

**Mudou de nome**

- Comandos: `/esquadro:aprender` virou `/sworn:learn`, `/esquadro:atalhos` virou `/sworn:shortcuts`,
  `/esquadro:auditar` virou `/sworn:audit`, `/esquadro:calibrar` virou `/sworn:calibrate`, `/esquadro:padrao` virou
  `/sworn:playbook`, `/esquadro:referencia` virou `/sworn:reference`, `/esquadro:revisar` virou `/sworn:review` e
  `/esquadro:paralelo` virou `/sworn:parallel`. O `/sworn:init`, o `/sworn:handoff` e o `/sworn:radar` só trocam o
  prefixo.
- Agentes `inspector`, `dedupe-judge` e `reader`; painéis `/sworn-session` e `/sworn-plan`.
- O texto dos portões e das skills segue em português; só os nomes mudaram.

**Novo**

- **O fecho olha o resultado da prova.** Um bloco colado que mostra falha (`fail 3`, `2 failed`, `not ok` sem
  TODO/SKIP, `exit code 1`, `ERR!`, tempo esgotado) não prova sucesso; `fail 0` vale. O fecho também volta quando,
  no fim da conversa, o último teste rodado falhou, ou quando a `provaDePronto` do projeto não rodou depois da última
  edição de código. Dizer o que não rodou, ou que algo ainda falha, libera o fecho.
- **Medição de antes e depois** (`scripts/medir-travas.js`): mede, sem o plugin e com ele, quantas vezes o agente diz
  "pronto" com o teste vermelho, ou verde só porque um teste ou um limite mudou. São 20 tarefas em 5 armadilhas
  (correção que quebra outro teste, testes que não rodam, limite para afrouxar, tarefa impossível e controle), cada
  uma num projeto de brinquedo novo; `--gerar`, `--congelar` e `--apurar`. A rodada publicada, com o Claude Sonnet e
  3 repetições, deu **igual**: falsa entrega em 4 de 60 sem o plugin e 3 de 60 com ele, dentro da margem. A saída do
  teste veio colada na resposta final em 0 de 60 sem o plugin e em 17 de 60 com ele. A apuração está em
  `medicao/resultado.txt`.
- **Página nova.** README curto em inglês e em português, com figuras e a medição; o detalhe de cada portão, comando,
  gancho e chave foi para o `GUIA.md`.

**Melhora**

- O manual (`/sworn:playbook`) e os modelos que o init grava ligam cada pedido à checagem que o prova (provado,
  falhou ou não testado); teste instável se corrige ou se remove, nunca se repete até passar.
- O `/sworn:shortcuts` dá 60 s a cada comando `git` da varredura (eram 5 e 15 s, que estouravam com a máquina
  carregada).

## 0.13.0 — radar: projetos públicos parecidos com o seu, cruzados com o seu projeto

Comando novo de estudo, o `/esquadro:radar`, e as peças do plugin passam a se chamar umas às outras na hora em que
ajudam. Cada mudança ganhou antes um teste que falhava e passou pela revisão cega.

**Novo**

- **`/esquadro:radar`.** Busca projetos públicos parecidos com o que você está construindo (até 10, por tema, pela
  busca do GitHub), ou uma lista que você passar. Lê todos por cima, até 5 a fundo, e grava uma ficha em
  `.claude/esquadro/radar/<AAAA-MM-DD>.md` com o que vale trazer, como entra, como fica melhor que o original,
  esforço, valor, licença e veredito (adotar, inspiração ou descartar). Licença fechada, ELv2 ou AGPL: só a ideia,
  reescrita. Na dúvida sobre o encaixe, faz no máximo 3 perguntas. Só lê e propõe: o que você escolher entra com teste
  antes e revisão cega. Medido numa rodada real: cerca de US$ 1,20 e 6 minutos numa sessão Sonnet, com 4 projetos a
  fundo.
- **O radar se oferece sozinho.** Quando você pede melhoria, sugestão ou função nova, o Claude pergunta, uma vez por
  sessão e com o custo, se quer a busca; nada roda sem o seu sim. Nunca no repositório do próprio plugin;
  `"oferecerRadar": false` desliga.
- **`referencia.js --tipo radar`** confere a ficha do radar em qualquer pasta, mais a tabela dos candidatos.
- **Para quem mantém o plugin: o radar da semana.** Toda segunda, uma rotina na nuvem lê os projetos em alta da semana
  no GitHub e grava a ficha num repositório privado; uma tarefa agendada do Windows a traz para
  `~/.claude/esquadro/vigia/radar/`, e o começo de cada sessão mostra uma linha só, com quantos candidatos e quantos
  para adotar. Usa a mesma chave da novidade da semana do vigia (o outro aviso semanal da abertura, que já existia):
  `"vigia": true` em `.claude/esquadro/projeto.json` mostra as duas linhas, `false` tira as duas.

**Melhora: cada peça na hora em que ajuda**

- O manual (`padrao`) indica o `/esquadro:referencia` na marcha AAA e, no ciclo de trabalho, qual comando ajuda em
  cada momento (função nova, antes de publicar, a troca de chat).
- O candidato escolhido no radar é estudado pelo método do `/esquadro:referencia` antes da proposta, e o fecho dele cita
  os atalhos deliberados e a lente de código enxuto. O `/esquadro:referencia` lê a lista do que o radar já estudou e
  divide a leitura com o `/esquadro:paralelo`.
- O `/esquadro:init` termina com os próximos comandos, uma frase cada; o `/esquadro:handoff` leva os estudos em
  andamento; o `/esquadro:revisar` lembra o `/esquadro:atalhos`.
- A abertura avisa ficha de referência guardada fora da lista `referencias`, ou com mais de 180 dias.
- O `/esquadro:auditar` também mede as skills do plugin contra as do seu projeto e aponta as que se sobrepõem.

## 0.12.0 — revisão do plugin inteiro: portões que deixavam passar, revisão cega que aprovava sem voto, init que liga a atualização

Uma revisão de todo o plugin, em 12 áreas, deu 40 consertos, feitos em 6 lotes; dois deles são testes que faltavam.
Abaixo eles vêm agrupados pelo que você nota, então um item pode juntar vários. Cada conserto ganhou antes um teste que
falhava e passou pela revisão cega. Os defeitos menores que sobraram ficaram registrados para uma versão própria.

**Novo**

- **O `/esquadro:init` oferece ligar a atualização automática do plugin.** Marketplace de terceiros vem com ela
  desligada, então quem instalava ficava parado na versão do dia. Agora o init pergunta e, com o seu sim, grava a
  chave em `~/.claude/settings.json` (`scripts/ligar-atualizacao.js`; sem `--gravar` ele só mostra o que faria).

**Corrige: portão de comando destrutivo**

- **Apagar com a opção fora do lugar de costume passava.** `rm dist -rf`, `rm --verbose -rf x`, `rm x -Rf` e
  `sudo rm --verbose -rf x` não eram barrados. Agora a opção vale em qualquer posição.
- **Opção longa abreviada passava.** O git aceita `reset --har`, `checkout --forc` e `push --del`, mas o portão só
  conhecia a forma inteira. Agora conhece as abreviações.
- **Descartar a árvore inteira por outro nome passava.** `git checkout :/`, `./`, `*` e `git restore ./` agora barram
  como `checkout .`; `dd` com `of=` antes de `if=` e `git branch -d -f` (ou `-df`, `--delete --force`) também.
- **Um teste publicado levava um ID de sessão real.** Trocado por um inventado, e o `sanitar` passou a acusar ID de
  sessão que exista nesta máquina.

**Corrige: escopo, commit e agentes**

- **`git -C /outro status && git commit` fazia o portão do commit olhar a pasta errada.** Agora vale o `-C` do próprio
  commit.
- **A catraca só olhava o trecho trocado de um Edit.** Um Write por cima do arquivo inteiro passava sem conferência.
  Agora ela compara o arquivo inteiro, e o portão de estilo não cobra de novo o que já estava fora antes da edição.
- **O aviso de escopo dava um remédio que não funcionava para nome com espaço, parênteses ou `#`.** Agora o item sai
  entre crases.
- **Padrão com barra no fim ou com `{js,ts}` no `projeto.json` não casava nada, e o aviso se calava.** Agora o aviso diz
  a forma certa.
- **Subagente `fork` passava pelo portão de custo como o mais barato.** Agora conta como o topo da escada.
- **O `NotebookEdit` passava sem o portão de escopo.** Agora passa por ele, como o Write e o Edit.
- **Uma falha ao gravar o estado derrubava o portão de agente.** Agora ele segue e decide.

**Corrige: revisão cega**

- **Dois defeitos diferentes na mesma linha contavam como um só.** Agora cada descrição conta.
- **Uma ronda com uma lente só, ou com uma lente inventada, aprovava.** Agora a ronda 1 exige as lentes da faixa, e a
  lente que achou P0 ou P1 tem de votar de novo na ronda seguinte.
- **Severidade escrita "p1" ou linha escrita "L42" sumia da conta.** Agora se lê. Quando a aprovação descarta algum
  veredito fora do formato, ela diz quantos.
- **A skill prometia subir de faixa, e o `preparar-revisao.js` não deixava.** Agora aceita `--completa`.
- **Justificar um arquivo "fora" sem citar decisão passava.** Agora a justificativa tem de citar a decisão.

**Corrige: init, sanitização e regras**

- **Um `settings.json` com BOM (uma marca invisível que alguns editores põem no começo do arquivo) quebrava a leitura
  do ambiente.** Agora a marca é ignorada.
- **O `sanitar` varria o e-mail do autor, mas não o nome.** E num projeto qualquer dizia "LIMPO" deixando `docs/` de
  fora. Agora varre o nome, e diz que só fica de fora o que o `.gitignore` cobre.
- **O `/esquadro:aprender` chamado de uma subpasta gravava a regra no lugar errado**, e um arquivo de regras salvo
  em outra codificação de caracteres (UTF-16) saía estragado. Agora grava na raiz do projeto e recusa o arquivo que não consegue ler, sem mexer nele.

**Corrige: abertura, volta e painel**

- **O resumo do chat parado contava o resumo de compactação como pedido seu.** Agora o ignora.
- **Uma falha ao gravar o estado da sessão apagava a abertura inteira, regras inclusive.** Agora a abertura sai, com
  uma linha dizendo que o estado não gravou.
- **O gasto do mês não dizia quantas linhas ficaram fora da conta** (sem preço ou ilegíveis). Agora diz.
- **O portão de fecho contava as caixas de uma seção "Critérios" como se fossem da tarefa acima dela.** Agora só um
  cabeçalho de nível acima fecha a tarefa, e o que está dentro de bloco de código não conta como cabeçalho.

**Corrige: textos**

- A skill gerada para o projeto mandava rodar `node scripts/uso.js` na pasta do projeto, mas o script mora no plugin.
- O `/esquadro:aprender` dizia que aceita quebra de linha (o script recusa) e que só oferece a regra em uma linha (o
  gancho manda rodar na mesma resposta e perguntar em 3 opções).
- O init dizia que `aaa` e `padrao` barram igual; o `aaa` exige também o manual carregado. E ensinava a escrever
  "Prova de pronto", que o portão de fecho lê como alegação de sucesso.
- O README mostrava saídas de portão de versões antigas. Agora um teste roda os portões e compara.
- O "Como instalar" ganhou o caminho de quem não tem chave SSH no GitHub e o aviso de que a política da empresa pode
  desligar os ganchos de plugin.

## 0.11.1 — o aviso de volta não some com um resumo estranho, e a descrição conta as oito travas

**Corrige**

- **Um resumo com defeito podia calar o aviso de volta naquela pausa.** Se o resumo gravado saísse de um jeito que o
  aviso não conseguisse ler, a mensagem passava sem aviso e ele não voltava até a pausa seguinte. Agora o aviso sai
  assim mesmo, dizendo "Sem resumo".
- **O aviso podia sugerir um handoff chamado "undefined".** Com o handoff em dia mas sem o caminho dele, o prompt
  pronto apontava para um arquivo que não existe. Agora ele aponta só o resumo.
- **A descrição do plugin dizia "Oito" e listava sete.** Agora lista as oito travas, como o README.
- **Menos jargão no README e neste registro** na parte do resumo do chat parado.

## 0.11.0 — o chat parado deixa um resumo pronto, e o aviso de volta fica curto

Desenho do aviso e do resumo aprovado por imagem antes do código.

**Novo**

- **Voltar a um chat grande parado não exige mais pedir o handoff ali.** Antes, se o chat tinha parado sem handoff,
  o único jeito de levar o trabalho para um chat novo era pedir o handoff no chat parado, que regravava a conversa
  inteira (num teste, 461 mil tokens, cerca de US$ 3,69). Agora, quando o aviso de volta para a sua mensagem, o
  esquadro grava na hora, sem chamar o Claude, um resumo do chat em `.claude/esquadro/handoff/` (seus últimos
  pedidos, as últimas respostas, os arquivos mexidos, a frente, o plano e o que está sem commit), e o aviso traz o prompt
  pronto para colar no chat novo, que paga só a abertura.

**Muda**

- **O aviso de volta não repete mais a sua mensagem.** Antes, ele terminava com "Original prompt:" e tudo o que você
  digitou, inclusive o que o navegador injeta, e o próprio aviso sumia do alto da tela. Agora sai na forma curta, depois
  de "Operation stopped by hook:" (o prefixo é do Claude Code), e a sua mensagem fica no chat como mensagem normal.

## 0.10.0 — estudar os melhores do mesmo tipo e trazer a ficha para a referência

Desenho do comando e da ficha aprovado por imagem antes do código.

**Novo**

- **`/esquadro:referencia`: a referência de topo sai de um estudo, não de memória.** Antes, a chave `referencias`
  pedia que você já soubesse qual é a melhor peça do seu tipo de entrega e a apontasse à mão. Agora o comando lê o
  tipo do projeto, acha os líderes do mesmo tipo por uma busca pública (com a hora da medida), propõe 2-3 que ainda
  não foram estudados e os estuda pelo que é público, em camadas: o que se vê, estados e fluxos (só com o seu sim,
  porque exige instalar), textos, e rede e desempenho (só para quem tem tela na web). Página pública ele abre e
  fotografa sozinho; com login, só a aba que você abriu. Sem copiar código nem arte.
- **A ficha diz de onde veio cada achado.** Uma por tipo de entrega, em
  `.claude/esquadro/referencias/<tipo>-<assunto>.md`: cada achado com a origem (`arquivo:linha` do commit lido,
  print, busca com hora), o grau (observado, derivado ou inferido) e quem agiu (o agente ou você), mais o que ficou
  sem saber, com estado (aberto, bloqueado, resolvido) e o que mediria cada dúvida, e o que não foi lido — "não
  achei" só vale sobre o que se leu. O `scripts/referencia.js` confere tudo isso e o tamanho (até 100 KB, o que a
  revisão lê inteiro) antes de a ficha entrar na `referencias`, e só entra com o seu sim.

**Muda**

- **O aviso de que falta a referência aponta o comando novo primeiro.** A abertura da sessão, que avisa uma vez por
  projeto sem `referencias`, agora diz para rodar o `/esquadro:referencia`; o `/esquadro:init` de novo e a chave à
  mão seguem valendo. A pergunta da referência no `/esquadro:init` também oferece o comando a quem não tem exemplo.

## 0.9.2 — a auditoria automática vê os ganchos repetidos, e os atalhos voltam sozinhos

Desenho dos avisos aprovado por imagem antes do código.

**Novo**

- **Os atalhos deliberados voltam sozinhos a cada 30 dias.** Antes, quem não rodava o `/esquadro:atalhos` à mão
  nunca revia um "trocar quando" que já tinha acontecido. Agora a abertura da sessão mostra a lista completa (com e
  sem gatilho), até 10 atalhos, no máximo uma vez a cada 30 dias, com a ordem ao Claude de conferir se algum já
  venceu e levar os vencidos a você em 3 opções. Sem atalho, silêncio. O prazo muda em
  `limiares.diasEntreAtalhos`, e `"atalhosNaAbertura": false` desliga.
- **A auditoria de 7 dias avisa quando um gancho repetiu o mesmo texto na conversa anterior.** Antes, isso só se via
  rodando o `/esquadro:auditar` à mão. Agora, se algum texto de gancho voltou mais de 5 vezes na conversa anterior à
  atual, a auditoria automática diz qual, com o id e a data dessa conversa (pode ser de outra frente de trabalho).
  Sem excesso, silêncio.

**Muda**

- **A busca de atalhos não deixa de fora o workspace com vários repositórios.** Aberta numa pasta que guarda os
  projetos em repositórios próprios, a auditoria achava 0 atalhos. Agora ela varre a pasta aberta e os repositórios
  logo abaixo dela; a lista dos 30 dias também.

**Corrige**

- **A revisão antes do commit cobrava revisão de arquivo que nem estava no repositório.** Quando não dava para
  saber em que repositório o commit acontecia (a pasta numa variável, como em `cd "$D" && git commit`), ela listava como "código sem revisão" os scripts de apoio guardados fora de
  qualquer repositório, como os da pasta temporária da sessão. Agora arquivo fora de repositório nunca entra nessa
  conta.

## 0.9.1 — o trabalho da sessão sobrevive à compactação, e a auditoria mede o que os ganchos injetam

Ideias do [context-mode](https://github.com/mksglu/context-mode), de Mert Koseoğlu: nada do código, que tem licença
ELv2; texto e código próprios. Desenho aprovado por imagem antes do código.

**Novo**

- **Depois de compactar a conversa, o Claude recebe de volta o que já fez na sessão.** Além das regras e do escopo, a
  reinjeção traz os arquivos tocados (quantos, e os 8 primeiros; arquivo fora do projeto só entra na conta), as ordens
  pendentes, as decisões do dono e os commits da sessão (cada linha só quando há o que dizer) e o `HEAD` de cada
  repositório onde houve arquivo tocado. Vale também ao retomar, limpar e bifurcar a sessão.
- **`/esquadro:auditar` mede o que os ganchos põem na conversa.** Item novo no relatório, à parte do peso de
  instrução: lida a transcrição da sessão, quantas vezes e quantos caracteres cada gancho de cada plugin injetou, e o
  texto que volta mais de 5 vezes, com o corte proposto. A transcrição é a da sessão do ambiente, ou a de
  `--transcricao`. O formato dela não é documentado pelo Claude Code: leitura que falha sai "não medido" com a causa,
  nunca zero.

**Muda**

- **A conversa gasta menos espaço com o aviso do `cd` solto.** Quando o esquadro conserta sozinho um `cd` solto (o
  `cd` que mudaria a pasta dos comandos seguintes), ele avisa o Claude. Esse aviso agora sai inteiro só na primeira
  vez da sessão e, nas seguintes, numa linha curta; antes voltava inteiro a cada comando (13 vezes numa sessão medida,
  mais que qualquer dica de outro plugin). O comando segue consertado igual: você não precisa fazer nada.
- **O manual (`esquadro:padrao`) ganha a regra da dica com teto:** aviso ou dica que um gancho põe na conversa sai uma
  vez por sessão, ou a cada N vezes, nunca a cada chamada.

**Corrige**

- **Depois de compactar a conversa, o Claude esquecia o que o esquadro tinha barrado na sessão.** Acontecia em quase
  toda sessão longa: bastava ter havido trabalho antes da compactação. Agora ele recebe de volta os bloqueios da sessão
  inteira, também quando a compactação vem logo depois do aviso para trocar de chat.

## 0.9.0 — menos código: a escada antes de escrever, a lente que acha o que sobra e o registro de atalhos

Ideias do [ponytail](https://github.com/DietrichGebert/ponytail), de Dietrich Gebert (licença MIT), com texto
próprio. Desenho aprovado por imagem antes do código.

**Novo**

- **Toda sessão abre com o bloco "menos código".** Antes de escrever código, o Claude sobe uma escada de 7 degraus e
  para no primeiro que resolve: precisa existir? já existe no projeto? a linguagem já faz? a plataforma já faz? uma
  dependência já instalada faz? cabe em uma linha? só então, o mínimo que funciona. Nunca se corta validação na
  fronteira, perda de dados, segurança nem acessibilidade. Atalho de propósito leva o comentário
  `atalho: <o que>. limite: <até onde vale>. trocar quando: <gatilho>.` São 720 caracteres a mais em toda abertura
  (~200 tokens). Desliga com `"menosCodigo": false` no `projeto.json`. O mesmo bloco chega aos subagentes que podem
  escrever código, pelo gancho `SubagentStart` (o da abertura não chega a eles); os que só leem (`inspetor`,
  `juiz-mesmo`, `leitor`, `Explore`, `Plan`) ficam de fora.
- **`/esquadro:atalhos`: o registro dos atalhos deliberados.** Lista os comentários de atalho do repositório
  (`atalho:`, e também `ponytail:` e `shortcut:` para quem já usa), agrupados por arquivo, com o que foi simplificado,
  o limite e quando trocar; marca `sem-gatilho` o que não diz quando trocar, que é o atalho que vira permanente sem
  ninguém ver. Só lê; pula o que o git ignora, binário e arquivo acima de 1 MB. A marca muda pela chave
  `marcaDeAtalho`. A auditoria automática lista os atalhos sem gatilho, e a revisão antes do commit aponta o atalho
  novo sem gatilho nos arquivos que ela já barrou (só aponta, não nega por isso).
- **Lente nova na revisão cega: `enxuto`, código que não precisava existir.** Ela pede o que dava para não escrever e
  o que substitui, com `arquivo:linha`. O revisar passa a mandar **dez** de código, **oito** de
  tela, e **dezoito** quando a mudança é de código e de tela; **sete** quando é só lógica. As faixas pequenas seguem sem ela. Nasce em
  observação: depois de 10 revisões, se 2 de cada 3 achados dela forem refutados na fonte, ela sai do arquivo só de
  lógica.
- **Arquivo de rigor máximo só com o manual carregado.** Editar arquivo da marcha AAA sem ter carregado o manual de
  execução na sessão (o `esquadro:padrao`, ou a skill do projeto com "padrao" no nome) é negado com o motivo e o que
  fazer; carregado uma vez, vale a sessão inteira. Desliga com `"portaoManual": false` no `projeto.json`.
- **Revisão antes do commit.** O `git commit` com arquivo de código mudado na sessão sem revisão aprovada é negado
  com a lista, a faixa de cada arquivo e quantos inspetores ela pede, e a ordem de rodar o `/esquadro:revisar`. Texto
  fica fora; arquivo editado de novo depois de aprovado volta para a lista. Commit sem revisão só com o seu sim, pela
  marca `# esquadro: sem-revisao` no comando. Desliga com `"portaoCommit": false` no `projeto.json`. São
  **26 baldes** de contador: 20 que negam, 6 que só contam.
- **O que nunca é usado aparece em número.** Cada ordem que o esquadro dá ao Claude (aprender, auditar, calibrar,
  init, revisar antes do commit, carregar o manual) conta como dada, cumprida (a skill rodou depois) ou recusada pelo
  dono (o commit com `sem-revisao` depois de negado). A auditoria automática mostra o que mudou desde a vez anterior,
  e quais nunca dispararam. Esses contadores ficam fora dos baldes e do total do `uso.js`.

**Muda**

- **Os comandos rodam no momento certo, sem você lembrar.** A correção ao jeito do Claude trabalhar faz ele rodar o
  `/esquadro:aprender` na mesma resposta e perguntar em 3 opções (antes, só oferecia). A auditoria de 7 dias que
  passou do limite manda rodar o `/esquadro:auditar` no primeiro turno e levar os cortes em 3 opções. Com 30 conversas
  do projeto e o limiar nunca calibrado, o Claude roda o `/esquadro:calibrar` e pergunta (no máximo uma vez a cada 30
  dias). Sem `projeto.json`, pergunta no primeiro turno se configura com o `/esquadro:init`, depois ou nunca. Gravar
  segue só com o seu sim.
- **O modo contínuo vem ligado.** Sem a chave (e sem `projeto.json`), a troca de chat só é pedida pelo tamanho da
  conversa (aviso a 250 mil tokens) e pelos bloqueios; revisões, decisões, commits, turnos e arquivos não encerram a
  sessão. Desliga com `"modoContinuo": false` no `projeto.json`.
- **O trabalho em paralelo roda direto.** Com 3 ou mais tarefas independentes, o Claude roda o `/esquadro:paralelo`
  sem perguntar e diz numa linha quantos agentes, qual modelo e o custo; o teto de 8 agentes e o modelo mais barato
  seguem. Sai da faixa o botão "o agente ofereceu rodar em paralelo": não há mais oferta.
- **O vigia liga sozinho no repositório do próprio plugin** (a raiz do git com `.claude-plugin/plugin.json` de nome
  `esquadro`), para quem mantém o plugin não precisar lembrar da chave. Nos outros projetos segue desligado sem
  `"vigia": true`; `"vigia": false` desliga em qualquer lugar.

## 0.8.4 — aviso antes de gastar ao voltar a um chat grande parado

**Novo** (pedido do dono; aviso aprovado por imagem antes do código)

- **Voltar a um chat de 200 mil tokens ou mais, parado há mais de 1 hora, mostra a conta antes de gastar.** O cache
  da conversa dura 1 hora; depois disso, continuar regrava a conversa inteira. Nas conversas do autor, 64 de 64 voltas
  com mais de 1 hora parado perderam o cache, e as de 200 mil ou mais custaram US$ 119 em 44 dias, contra uns US$ 23
  se fossem chat novo. Agora a 1ª mensagem depois da pausa é segurada: ela não chega ao Claude, e o aviso diz o tempo
  parado, quanto custa continuar ali e quanto custa abrir um chat novo com o handoff. O texto digitado aparece no fim
  do aviso ("Original prompt:"). Mandada de novo, a mensagem passa; o aviso sai uma vez por pausa. Modelo fora da
  tabela de preços: avisa sem o valor em US$. Se o registro da sessão não puder ser lido, a mensagem passa. Desliga
  com `"avisoDeVolta": false` no `projeto.json`.

**Escolhas técnicas** (feitas dentro do escopo, ditas aqui para você poder discordar)

- A conta mora num arquivo próprio (`scripts/lib/volta.js`), e não no da saúde do contexto, porque a tabela de preços
  já depende dele e o caminho inverso fecharia um ciclo.
- A leitura do registro da sessão passou a trazer também o horário e o modelo da última resposta; a leitura do tamanho
  do contexto usa essa mesma.
- A mensagem segurada não conta como turno: não gasta a espera da sugestão de `/esquadro:aprender`.
- O custo do chat novo usa a 1ª chamada típica de um chat novo (68.723 tokens, a mediana medida): é o piso, porque o
  chat novo ainda relê arquivos depois.

## 0.8.3 — a linha de status diz quanto falta para trocar de chat; faixa vazia em chat sem plano; 51 correções

**Mudado** (pedidos do dono; desenho aprovado por imagem antes do código)

- **A linha de status diz quanto falta para o aviso de troca de chat**, pelo sinal mais perto: `troca de chat em 38
  mil tokens` (ou em N commits, N decisões do dono, N bloqueios de portão, conforme o sinal). Quando um sinal dispara, ela diz `troque de chat →
  /esquadro:handoff`. Sem nenhum sinal medido, não diz nada. Sai o "troca 0 de 2", que nunca mudava enquanto nada
  disparava. No `/esquadro-sessao`, o bloco "Troca de chat" diz "N de M sinais dispararam", com o verbo concordando.
- **A faixa acima do prompt fica vazia num chat que não tem plano.** Antes, um chat sem frente ligada mostrava o plano
  da única frente do projeto, mesmo sendo de outro assunto. O `/esquadro-plano` segue mostrando essa frente, e diz
  que esta sessão não está ligada a ela. Um plano aberto com `--abrir` continua aparecendo: é escolha explícita do
  projeto.
- **Dois pedidos fechados sem mudança**, depois do print: a linha "SessionStart hook" não aparece no chat do VS Code;
  e a faixa e a linha de status, no painel estreito, só quebram de linha, sem cortar nem se sobrepor.

**Corrigido** (os 51 que a revisão da 0.8.2 deixou abertos, conferidos um a um no código: 23 de aparência, 18 de
estilo, 7 falhas, 2 de teste e 1 de segurança)

- **Segurança.** Uma resposta ao `/esquadro:init` com a chave especial `__proto__` conseguia pôr agentes que ninguém
  escolheu na escada do projeto (o teste montou o ataque e viu a lista virar a do atacante). Agora a resposta entra
  por cópia chave a chave e o ataque não passa.
- **Falhas.** Arquivo de conversa que não se consegue medir conta como ilegível, em vez de derrubar a conta do gasto;
  valor que não é número no relatório de uso sai por último como "?" e fica fora da soma; o aviso de saúde sem
  gatilho não sai; caminho terminado em `\` no comando que o botão escreve não quebra mais as aspas; a linha de
  referência que já começava com `\===` não se confunde com a escapada; na apuração, só a pasta que não existe conta
  como "sem veredito" — outra falha de leitura para e diz a causa; o sinal do medidor não lê nome herdado de objeto.
- **Aparência.** O painel do plano não corta o título no meio de um caractere, não mostra Markdown cru no título,
  e o erro de gravação do `--abrir` diz a causa em palavras; o "Ritmo" traz um exemplo concreto; centavos não saem
  como "-0,00"; os avisos da revisão dizem quantas entradas faltam, com o plural certo, sem "cegueira" nem "BOM"
  soltos; achado sem descrição sai "(sem descrição)", e lente repetida aparece uma vez só; os avisos de shell, de
  design e de custo ganharam linha em branco onde a leitura pedia, e nomes com aspas ou quebra de linha não deformam
  mais a mensagem. No README, a cor de destaque não se confunde com a acentuação da escrita, e o defeito do âmbar
  fraco tem endereço (as issues do repositório).
- **Estilo e teste.** Código repetido num lugar só (a lista das faltas da revisão, a forma única do aviso do `cd`
  solto, as janelas do medidor), uma função sem uso tirada, comentários com o motivo no lugar de marcas de plano, e
  testes novos para os botões do painel e para os textos acentuados dele.

**As sobras** (o que a triagem achou fora da lista)

- **Rodar o `/esquadro:init` de novo com "nunca" na referência de topo** agora apaga as referências gravadas antes.
  Nas outras chaves (`travas`, `marchas`, `limiares`), responder vazio segue sem apagar nada. O `/esquadro:init` diz
  isso.
- **O `/esquadro:calibrar` compara com o limiar que vale de verdade**: o gravado no `projeto.json`, senão os 250 mil
  do modo contínuo, senão o padrão do plugin, e diz de onde ele veio. "Manter" agora se grava
  (`node scripts/calibrar.js --manter`, só com o seu sim).
- **O `claude plugin validate` não avisa mais** do gancho sem tratamento de erro no painel: se o gancho falhar, a
  chamada da ferramenta segue normalmente.
- **Este CHANGELOG ganhou acento da 0.7.7 para trás.** Mensagens antigas citadas entre aspas ou crases ficam como
  eram.

**Escolhas técnicas** (feitas dentro do escopo, ditas aqui para você poder discordar)

- O texto do subitem aberto que o portão de fecho mostra ficou sem acento: ele sai num aviso de gancho, e esses
  seguem sem acento.
- No `/esquadro:init` de novo, só `referencias` vazio apaga; vazio nas outras chaves não apaga.
- O calibrar mostra o limiar em vigor e a origem dele; "manter" grava esse mesmo número.
- O gancho do painel, se falhar, deixa a chamada seguir: ele só observa.
- A função de correção de apelido de modelo, sem uso em lugar nenhum, saiu em vez de ganhar um chamador.
- No comando do botão, as barras antes de aspa ou do fim dobram, pela regra padrão de linha de comando.
- Na apuração, só a pasta que não existe vira "sem veredito"; pasta ilegível ou arquivo no lugar dela para com a
  causa.
- O ataque do `__proto__` foi confirmado por teste antes do conserto.

## 0.8.2 — aparência nova na faixa, na linha de status e nos dois painéis; avisos numa forma só; 105 correções

**Mudado: a aparência** (desenhada por imagem e aprovada antes do código)

- **A linha de status em uma linha só**, na ordem contexto · 5h até HH:MM · semana · mês · sessão · troca N de M
  (`contexto 24% · 5h 4% até 13:50 · semana 18% · mês US$ 3.311 · sessão US$ 7,52 · troca 0 de 2`). Sai o
  "esquadro" da frente (o VS Code já escreve "esquadro plugin") e sai o plano, que mora na faixa. O mês vem
  arredondado, com centavos abaixo de US$ 1, e com "+ (somando)" enquanto as conversas do mês ainda estão sendo
  lidas. A previsão saiu da linha e foi para o `/esquadro-sessao`. Com o Node.js parado, a linha diz "medidor
  parado: o Node.js não respondeu. Rode node -v num terminal para conferir."
- **A faixa acima do prompt**: `plano 082 · 2 de 7 tarefas · próxima: Tarefa 3 — ...`, com a unidade do plano
  (tarefa, etapa, fase, onda ou item) e "concluído (6 de 6 tarefas)" quando nada falta, em vez de "nada aberto".
  Embaixo, a frase do que aconteceu e o botão, com rótulo em palavras (gerar handoff, virar regra, ver o que cortar,
  carregar o manual). Todo botão sai no desenho de destaque (`primary`), porque no VS Code o desenho discreto
  (`secondary`) sai igual a ele e não marcaria diferença nenhuma; a ordem fica no texto. Se o clique não consegue
  escrever no prompt, a faixa diz o comando a digitar, em vez de falhar calada.
- **`/esquadro-sessao` em cinco blocos com título**: Contexto e limites, Gasto, Previsão, Troca de chat e O que
  fazer. "Handoffs" virou "trocas de chat" e "turnos" virou "respostas" (troca de chat explicada no README); número
  com ponto de milhar e dinheiro com vírgula. Os sinais que valem vêm do mais perto do limite, com "← disparou" ou
  "← perto do limite" (a partir de 90% do limiar), e os que o modo contínuo desliga vão numa linha só. Sem leitura
  ainda, a linha diz quando ela aparece.
- **`/esquadro-plano` em Markdown**: título com a conta, uma linha com a frente e o caminho do plano, a lista das
  tarefas (`- [x]`, `- [ ]`) e o bloco "Ritmo" (próxima, o que falta, sessões gastas e estimativa). O painel que
  falha diz o que copiar e onde colar.
- **Acento** na linha de status, na faixa e nas respostas dos dois comandos, provado no VS Code antes de mudar o
  código. Os avisos dos ganchos seguem sem acento.
- **Os avisos dos ganchos numa forma só**: a 1ª linha diz o que falta, em palavras de quem usa; caminhos entre
  aspas, um por linha; as saídas numeradas em "Faca uma destas" (ou "Faca assim:", quando há uma só); a linha de
  desligar por último, só no aviso que já tinha chave. No bloqueio de comando destrutivo e no do `cd` solto, a
  última linha é "So o dono libera", sem ensinar a desligar. Os avisos da revisão dizem a lente, o caminho tentado
  e o efeito prático.

**Corrigido** (os P2 que as revisões da 0.8.0 e da 0.8.1 deixaram abertos: 51 de aparência, os de cima e os de
documentação, mais 22 falhas, 27 de estilo, 3 de tamanho e 2 de segurança)

- **Segurança.** Referência de topo fora da pasta do projeto (caminho absoluto, `../` ou link que aponta para fora)
  não é mais lida nem vai ao inspetor: vira falta, com o código `FORA_DA_RAIZ`, pelo caminho real. Linha da
  referência que começa com `===` ganha uma `\` na frente, para o conteúdo não forjar o cabeçalho de outra
  referência no `R.txt`.
- **Tamanho.** Referência acima de 100 KB (em bytes UTF-8) não entra inteira no `R.txt`: vai pelo caminho, como a
  imagem. Plano acima de 1 MB no disco deixa a faixa vazia (o maior plano medido tinha 934.918 bytes), e o
  `/esquadro-plano` o lê igual.
- **Revisão.** Pacote em que nenhuma referência se leu sai como pacote sem referência. Com referência, a apuração
  para se o `mapa.json` não diz qual lado é A, qual é B e qual é o trabalho; e para também com vereditos em
  `invertida/vereditos/` sem a passada invertida no mapa (pasta vazia não). `invertida/` só vale dentro de ronda
  numerada. O inspetor que tem o `R.txt` e responde "não sei" conta como perder dos dois lados (o padrão é
  reprovar).
- **Medidor e gasto.** Sem o id da sessão atual, não há média por sessão; as janelas da média vêm do histórico.
  Gasto cujo total não bate com real mais estimado (diferença acima de meio centavo) fica de fora. Transcrição que
  não se lê conta à parte (`ilegiveis`) e não entra no cache; modelo sem preço entra no cache e no gasto do mês
  (`semPreco`). O medidor ainda não mostra esses dois números.
- **Plano.** O caminho do plano se monta num lugar só, para o painel, para a saída JSON do `scripts/plano.js` e para
  o portão de fecho. O `--abrir` que não consegue gravar sai com a mensagem do arquivo, da causa e do que fazer.
- **Botões.** A ordem vem de uma lista só; caminho com espaço ou aspa vai entre aspas no comando que o botão põe no
  prompt.
- **Windows.** Dois caminhos que só diferem em maiúscula e minúscula contam como o mesmo arquivo na referência de
  topo, como o glob já fazia; fora do Windows, são dois.
- **Rodar o `/esquadro:init` de novo num projeto já configurado.** Um `projeto.json` com a chave especial
  `__proto__` não consegue mais mexer nas outras chaves da configuração: ela fica guardada como uma chave comum. Para
  quem usa, nada muda.

**Documentação.** O README diz o que é troca de chat, mostra a aparência nova, o que fazer quando o âmbar fica fraco
no tema claro, o que é "lado" na revisão e o que o re-init faz com `referencias`. O `/esquadro:init` faz a pergunta
da referência de topo com as 3 opções em palavras do dono, cada uma com o que ele perde. Este CHANGELOG ganhou
acento na 0.7.8 e explica na 1ª vez os termos da 0.8.0 e da 0.8.1.

## 0.8.1 — a entrega AAA cobra a revisão contra a peça de topo; a faixa mostra o plano, o mês e um botão por comando

**Novo**

- **O `/esquadro:init` pergunta a referência de topo**, depois das seis perguntas: nomear agora (grava
  `referencias`), deixar para depois (não grava) ou nunca neste projeto (`"referencias": {}`). Sem a chave, a abertura
  da sessão avisa uma vez por projeto (marca em `.claude/esquadro/referencia-avisada.json`).
- **A linha do plano na faixa acima do prompt** (`plano d503 | 5 de 6 | proxima: ...`), sempre visível com plano; a
  linha de status começa pelo plano curto, logo depois de "esquadro". O travessão do título do plano vira "-", em vez
  de "?".
- **Gasto do mês** ao lado do da sessão (`mes US$ N | sessao US$ x.xx`): o custo real das sessões com o mod carregado,
  guardado entre sessões, mais a estimativa das transcrições do mês de todos os projetos; valor equivalente de API,
  não cobrança. A primeira leitura vai por cache e prazo, e sai "(contando)" até encher.
- **Previsão em handoffs** nas janelas de 5h e da semana (`semana 92% (~4 handoffs)`), pela média das últimas 5
  sessões medidas dentro da mesma janela.
- **Um botão por comando na faixa**, na hora certa: handoff, revisar, aprender, init, auditar, calibrar, paralelo e
  padrao, cada um pelo sinal que já existia (tabela no README, "Ver os números a qualquer hora"). Um por vez, na
  ordem de prioridade; o botão põe o comando no prompt e some até o sinal passar. O do handoff também some depois de
  usado.
- **Identidade visual**: a faixa tem borda e o nome "esquadro" no âmbar dos banners (a cor `warning` do tema no
  terminal e no Desktop; `#F59E0B` no chat do VS Code, onde a cor do tema não pinta). README, "Aparência".
- **Portão da referência de topo.** No fim do turno, a resposta que alega entrega é barrada quando um arquivo mudado
  na sessão é da marcha `aaa`, o tipo dele tem lista em `referencias` e nenhuma revisão contra a referência fechou
  na sessão. A mensagem cita os arquivos e o comando, `/esquadro:revisar <arquivo>`. O `node scripts/apurar-ronda.js`
  conta o fecho da revisão com referência num balde próprio, `revisao_referencia_fechada`, que é o que o portão lê;
  ele não abre arquivo nenhum. Sem `referencias`, nada muda. Desliga com `"portaoReferencia": false` (chave nova);
  `travas.fecho: false` não o desliga.
- São **24 baldes** de contador: 18 que negam, 6 que só contam. Balde é cada tipo de evento que o plugin conta
  na sessão. Os que negam são bloqueios de portão e somam no sinal "bloqueios de portão" da troca de chat; os que
  só contam registram o que aconteceu (uma revisão fechada, um agente despachado) sem barrar nada. O balde novo,
  `revisao_referencia_fechada`, é dos que só contam.

**Corrigido**

- O README dizia que no chat do VS Code os mods só respondiam em texto: lá também aparecem a linha de status e a faixa
  (provado numa sonda durante a 0.8.1).

## 0.8.0 — a revisão compara com a peça de topo, nas duas ordens

**Novo**

- **Chave `referencias` no `projeto.json`.** Opcional, por tipo de entrega (`tela`, `codigo`, `texto`), cada tipo
  uma lista de caminhos ou URLs da melhor peça que existe para ele, no mercado ou no próprio projeto.
  O `node scripts/validar.js` reprova tipo desconhecido e lista com item que não é texto, e a reprovação sai na
  saída dele, com a chave a corrigir. No `/esquadro:init` rodado de novo, o tipo respondido troca a lista dele e o
  tipo não citado fica como estava. Sem a chave, nada muda.
- **A referência entra no pacote da revisão.** Quando o arquivo revisado tem referência do seu tipo (texto pela
  extensão `.md`, `.markdown` ou `.txt`; tela pela regra de estilo; código o resto), o
  `node scripts/preparar-revisao.js` grava o `R.txt` (cada referência com um cabeçalho; texto inteiro, imagem pelo
  caminho para o inspetor abrir) e uma 2ª passada em `invertida/`: a mesma revisão de novo, com A e B trocados, para a
  ordem em que o inspetor lê os dois lados não pesar no voto. O campo `aviso` da saída desse comando
  lista as URLs (aceitas, mas o inspetor não abre a página: para ela contar, salve a página ou um print num arquivo
  dentro do projeto e ponha o caminho dele na mesma lista, no lugar da URL) e
  cada referência que não se leu, com a causa (corrija a entrada em `referencias` de `.claude/esquadro/projeto.json`
  ou dê ao seu usuário permissão de leitura no arquivo). Sem referência, o pacote sai byte a byte como antes. Se a chave estiver em formato errado, o
  pacote sai sem referência, sem parar, e o mesmo `aviso` manda rodar `node scripts/validar.js`, que diz o que
  corrigir.
- **O inspetor julga cada lado contra a referência.** Cada lado é um dos dois arquivos que o inspetor recebe, A e B
  (o antes e o depois da mudança, sem saber qual é qual). Com `R.txt`, o veredito traz o campo `vsReferencia`, o
  placar de cada lado contra a referência (`vence`, `empata` ou `perde`, para A e para B), e o campo `lacunas`, o
  que falta a um lado para chegar à referência, com severidade e `arquivo:linha`, como o achado. O
  `gravar-veredito.js`, o gancho que guarda cada veredito quando o inspetor termina, guarda também os da 2ª
  passada, em `invertida/vereditos/`.
- **A apuração exige as duas ordens.** O `node scripts/apurar-ronda.js` lê as duas passadas e traz `referencia` na saída: por
  lente, o resultado em cada ordem e o final (perder em uma ordem é perder; vencer nas duas é vencer; o resto,
  empatar), as lacunas do lado novo e as lentes que ficaram atrás. Duas rondas secas só aprovam com toda lente
  empatando ou vencendo, sem lacuna P0/P1; o teto de 3 rondas segue. Achado da 2ª passada sai com `passada: 2`, e a
  refutação dele leva o mesmo campo. Sem referência, a apuração é a de antes.
- **O manual pede a referência antes de fazer.** A seção 4.1 do `padrao` manda nomear, na marcha AAA, a referência
  de topo que se abre (arquivo, print, repositório), nunca uma lembrança. Sem ela, o agente escreve "sem
  referência" e compara com a peça irmã já aprovada no próprio projeto.

**Custo:** com referência, cada lente roda duas vezes (o dobro de agentes); a revisão diz isso junto do número de
agentes. Sem a chave `referencias`, a revisão custa o mesmo de antes.

## 0.7.8 — o painel do plano acha o plano certo, conta as sessões dele e lê etapas em tabela

**Corrigido**

- **Plano da sessão sem frente.** A sessão que não está ligada a nenhuma frente lê agora o Objetivo do
  `.claude/esquadro/escopo.md`; antes, ela via o plano de outra frente (a única com plano anotado), sem aviso. Quando
  o `escopo.md` não anota plano e uma só frente anota, o painel mostra o plano dessa frente, diz que a sessão não está
  ligada a ela e qual arquivo editar para ligar; com várias, lista as frentes, como antes.
- **A forma que as sessões já escrevem.** Além de `Plano: <caminho>`, vale `plano` seguido do caminho entre crases ou
  aspas, terminado em `.md`. Com as duas formas no Objetivo, vale a que aponta para um arquivo que existe; se os
  dois existem, vale o `Plano:`; se nenhum existe, também vale o `Plano:`, e o painel diz que não consegue lê-lo.
- **Sessões gastas do plano, não da frente.** As sessões gastas e a estimativa saem agora das marcas de sessão no
  próprio plano. A sessão 12 anota `(s12: feito)` na caixa `- [x]` do plano que ela marca; caixa refeita por duas
  sessões leva as duas, `(s12, s13: refeito)`. Cada número conta uma vez, também no plano aberto por `--abrir`. Antes
  contavam as marcas da frente inteira (41 para um plano de 2 sessões). Plano sem marca: o painel diz como anotar.
- **Plano anotado fora do projeto.** O plano anotado no Objetivo só é lido dentro da pasta do projeto; fora dela, o
  painel diz que não lê e dá as duas saídas: anotar um caminho dentro do projeto ou abrir o plano com `--abrir`. Se
  o plano é lido mas a conta falha, o painel diz isso, e não mais "nao consegui ler", e pede para registrar a
  mensagem como defeito do esquadro.

**Novo**

- **Etapas em tabela.** O painel lê o plano que lista as etapas numa tabela: 1ª coluna `Etapa`, `Fase`, `Item`,
  `Tarefa` ou `Onda`, uma etapa por linha, começando pelo id (como `P0` ou `2b-0`). Para marcar uma etapa como feita,
  ponha `[FEITO]` na 1ª célula dela. Sem nenhum `[FEITO]` na tabela, o painel segue a última `ETAPA <id>` do Objetivo
  do escopo cujo id a tabela tem: as linhas acima dela contam como feitas, e ela como em curso; uma linha "estado
  pelo escopo:" diz isso e como marcar. Sem `ETAPA` com id da tabela, as etapas ficam sem estado (`[?]`). Com um
  `[FEITO]` que seja, só as marcas valem. Vale a 1ª dessas tabelas; linha sem id fica fora da conta, e o painel avisa
  quais e pede o id; plano com caixas de passo segue nas caixas. `\|` dentro da célula é barra, não divisa de coluna,
  e o plano gravado com BOM (a marca invisível que editores do Windows põem no começo do arquivo) lê igual. Antes, o
  plano do APP (etapas P0-P7 numa tabela) dava "o painel nao consegue contar as tarefas".

**Mudado**

- **`/esquadro:handoff`.** O handoff grava a linha `Plano:` no Objetivo do escopo em vigor e pede a marca da sessão
  em cada caixa marcada, para o painel achar o plano e contar as sessões no chat novo; no plano em tabela, pede
  `[FEITO]` na célula da etapa fechada e a marca da sessão na mesma linha, e, na 1ª marca `[FEITO]`, também nas
  etapas anteriores já feitas (a 1ª marca encerra a dedução pelo escopo).

## 0.7.7 — o README conta tudo o que o plugin instala

**Mudado**

- **README completo.** O README passa a cobrir tudo o que o plugin instala e o que esperar de cada coisa: uma
  seção com tudo o que vem instalado (skills, o workflow `esquadro:paralelo`, os agentes, os ganchos por evento e os
  painéis `/esquadro-sessao` e `/esquadro-plano`), os portões fora da tabela das oito travas (decisão, apelido,
  estilo, handoff, qualidade de resposta, vigia), o `projeto.json` chave por chave, a parte visual (lentes de tela, a escolha visual
  na página Artifact, catálogo de estados, alvo de 24 x 24 px, INP, print antes x depois, roteiro de 5 usuários), os
  scripts de linha de comando que faltavam, o que mora em `modelos/` e nas referências da `padrao`, e os
  comportamentos das versões 0.6.0 a 0.7.6 que o README ainda não contava. Nenhuma frase antiga mudou de sentido.
- **Teste.** O teste do README lê do disco as skills, o workflow, os agentes, os eventos de gancho, os painéis, os
  scripts, as chaves do `projeto.json`, as travas, os `modelos/` e as referências da `padrao`: item novo que chega
  sem README reprova sozinho.

## 0.7.6 — a escolha visual numa página Artifact e as lentes de tela mais completas

**Mudado**

- **Escolha visual numa página Artifact.** A `esquadro:padrao` já mandava mostrar a imagem antes de pedir uma
  escolha visual. Agora, quando a sessão tem a ferramenta Artifact (página privada no claude.ai), o meio
  preferido é uma página com antes, proposta e referência lado a lado, em claro e escuro, nas larguras de tela que
  o projeto declara (sem declaração, as que o produto comprovadamente atende: a de notebook, e a de celular só se
  ele roda em celular). O rito é o da imagem: o link primeiro, as 3 opções no turno seguinte. Sem a ferramenta, a
  imagem de sempre. A página sai do computador: só dado fictício; tela com dado de cliente ou credencial troca por
  dado fictício antes de publicar, ou fica na imagem local.
- **Lentes de tela.** A Lente 2 (estados) pede o componente visto sozinho com todos os estados: a página dele no
  catálogo de componentes do projeto, ou uma página de estados montada para a revisão. A Lente 4
  (acessibilidade) pede alvo de pelo menos 24 x 24 px (WCAG 2.2, critério 2.5.8, com as exceções do critério);
  abaixo disso é P1. A Lente 7 (regressão) mede a resposta ao clique pelo INP (Interaction to Next Paint, o
  tempo do clique até a tela responder): bom até 200 ms, ruim acima de 500 ms (web.dev); medido acima de 500 ms
  é P1, entre 200 e 500 ms é P2, sem medição a lente diz que não mediu.
- **Marcha AAA.** Com gerador de print, a regressão de tela se prova por comparação automática de print antes x
  depois; sem ele, a comparação foi a olho, e isso se declara. Em função visível nova, o fecho entrega ao dono um
  roteiro de teste de uso com 5 usuários reais (cerca de 85% dos problemas de uso), que não bloqueia a entrega.

## 0.7.5 — limiar inválido no projeto.json cai no padrão

**Corrigido**

- **Limiar que não é número positivo cai no padrão.** Um valor de `limiares` no `projeto.json` igual a `null`,
  `0`, negativo ou texto entrava cru na conta: `tokensAlarme: null` fazia o alarme de tamanho sair no começo da
  conversa, e `tokensDeContexto: 0` fazia o aviso sair a zero. Agora só número positivo vale; o resto fica com
  o padrão. Vale para o medidor, o alarme, o bloco da abertura (que diz os números que o medidor usa) e o
  `/esquadro:calibrar`. Um número escrito como texto (`"300000"`) também deixa de valer: grave sem aspas
  (`300000`) para o seu limiar continuar mandando.
- **Textos.** O README liga o alarme de 450 mil à faixa acima de 500 mil, onde a chamada custa cerca de 4 vezes
  mais, e diz que limiar inválido cai no padrão. Na 0.7.4, "o bloco da abertura diz os 250 mil" vale para o
  padrão: com limiar gravado no projeto, o bloco diz o número dele.

## 0.7.4 — com o modo contínuo ligado, o aviso de tamanho sai a 250 mil

**Mudado**

- **Modo contínuo: aviso de troca de chat a 250 mil tokens.** Com `modoContinuo` ligado, o aviso de tamanho
  saía no padrão de 175 mil, embora o modo exista para a sessão longa; no teste numa etapa real, o aviso
  apareceu duas vezes e as sessões seguiram. Agora, com a chave, o padrão do aviso é 250 mil (o alarme segue
  em 450 mil). O número que o projeto gravar em `limiares.tokensDeContexto` continua mandando. Sem a chave,
  nada muda: 175 mil. O medidor da sessão mostra o limiar que vale.
- **Modo contínuo, textos.** O bloco da abertura, a `esquadro:padrao` e o README dizem os 250 mil; o README
  passa a nomear as quatro coisas que ainda pedem troca de chat, como a skill (faltava o incidente que exigiu
  cirurgia).

## 0.7.3 — pergunta de fato passa no portão de decisão e o modo contínuo mais claro

**Mudado**

- **Pergunta de fato passa no portão de decisão com `(fato)` no título curto.** Até a 0.7.2 o portão
  barrava toda pergunta ao dono sem exatamente 3 opções e sem a recomendada em primeiro, inclusive a
  pergunta de sintoma ou de dado que só o dono tem, que não é decisão (nas sessões do autor, ela acabou
  saindo em texto, duas vezes). Agora `(fato)`, exata e entre parênteses, em maiúscula ou minúscula, no
  `header` (o título curto) da pergunta, a libera da regra das 3 opções. A marca só conta no `header`: no
  texto da pergunta ou num rótulo, não. A decisão sem a marca segue barrada, e a mensagem de bloqueio
  passa a ensinar a marca.

**Corrigido**

- **Medidor da sessão: o "0 de N" conta só os gatilhos que podem disparar.** Com o modo contínuo ligado,
  os cinco gatilhos que a chave cala entravam no denominador ("troca: 0 de 7"), embora não pudessem
  disparar. Agora a linha curta diz "0 de 2". Sem a chave `modoContinuo`, nada muda.
- **Modo contínuo, textos.** A `esquadro:padrao` diz como saber se o modo está ligado (a abertura da
  sessão diz), nomeia o que deixa de pedir troca de chat em vez de "todo o resto desta secao" (o
  "Disparou?" segue para os gatilhos que ficam e o "Sempre" não muda) e põe credencial, permissão e
  segurança na lista do que ainda vai ao dono; o bloco da abertura e o README dizem o mesmo. No README,
  o item "Ele avisa quando e hora de abrir chat novo" ganha a ressalva do modo contínuo.
- **Teste do Jev pela regra de hoje.** O Jev é um modelo externo; `docs/jev` mede o que ele diz contra a
  regra do `/esquadro:auditar`. O `docs/jev/jev.test.js` ainda dizia que 1 termo em comum bastava para a
  sobreposição de skills; a regra mudou na 0.5.2 (2 termos comuns e fração de 0,20). O teste agora confere
  os dois limites. O código não mudou.

## 0.7.2 — revisão proporcional ao diff, cd solto que se corrige e filtro de subagente num lugar só

**Mudado**

- **`/esquadro:revisar` passa a ser proporcional ao tamanho da mudança.** Até a 0.7.1 toda revisão
  despachava a família inteira de lentes (6 inspetores numa lógica, 9 num código de estilo), inclusive para
  trocar uma palavra. Nas revisões do autor, os diffs pequenos gastaram cerca de 40% dos inspetores e não
  acharam nenhum defeito real; os defeitos vieram de lógica nova ou grande. Agora o `preparar-revisao.js`
  mede o diff contra o HEAD e diz a faixa: até 3 linhas, 1 inspetor (`correcao`); lógica de até 40 linhas
  com teste vermelho e mutação, 2 (`correcao` e `borda`); texto, 2 (`correcao` e `microcopy`); arquivo
  novo, lógica maior, estilo ou o que não der para medir, a tabela de famílias de antes. Quem revisa pode
  subir de faixa, nunca descer. A regra de parada não muda: duas rondas secas, teto de 3.
- **Nas faixas pequenas, o inspetor lê só o trecho mudado.** `A.txt` e `B.txt` levam o trecho com 20
  linhas de margem; o resto fica em branco, com uma linha `[fora do trecho: linhas a-b]` no início de cada
  vão. Os números de linha seguem os do arquivo, então a apuração e a refutação não mudam. O inspetor sabe
  que o vão não é defeito: o que depender dele vira "nao consigo ver". Na faixa completa, o arquivo inteiro,
  como antes.
- **O `cd` solto no Bash se corrige sozinho em vez de ser barrado.** Era o portão que mais parava o trabalho
  (cerca de 435 idas e voltas por semana nas sessões do autor): o comando era negado e o agente tinha de
  escrever de novo. Agora o comando vai inteiro num subshell, `( ... )`, e roda: a pasta volta sozinha, e o
  agente fica sabendo da correção e da forma certa. A permissão continua a de sempre (o portão não aprova
  nada), e a correção não conta como bloqueio para a troca de chat. Seguem negados: o `cd` solto no
  PowerShell (que não tem subshell que devolva a pasta), o comando que termina em barra e o que não se lê
  inteiro.

**Corrigido**

- **O filtro que separa o retorno de subagente da sua fala fica num lugar só.** Até a 0.7.1 ele estava
  copiado em dois ganchos (a pergunta sobre o contexto e a sugestão de `/esquadro:aprender`), preso ao
  texto com que o Claude Code entrega o retorno; quando esse texto mudou no 2.1.296, os dois deixaram
  passar até a 0.7.1 corrigir as duas cópias. Agora os dois usam a mesma função, e a próxima mudança da
  forma se corrige uma vez. O comportamento não muda: nas transcrições do autor (7291 prompts), o filtro
  novo decide igual ao antigo em todos.
- **README: "os outros cinco gatilhos" virou "sete".** No parágrafo do gatilho de commit, o número ficou
  para trás quando a tabela de gatilhos cresceu. Um teste passa a conferir esse número contra os limiares
  do código.

## 0.7.1 — painel do plano completo e três correções

**Mudado**

- **Troca de chat por tamanho: o padrão passa de 250 mil para 175 mil tokens.** A medição da 0.7.0
  contava a leitura do handoff na abertura do chat novo como se fosse a escrita, e a troca saía mais cara
  do que é; por isso ela achou o empate em 250 mil. Medido de novo, só com a escrita: nas sessões do autor
  cada troca custa US$ 1,56, e 175 mil é o menor limiar em que trocar no fim do turno não sai mais caro
  que seguir. O alarme firme continua a 450 mil. Quem gravou `limiares.tokensDeContexto` no `projeto.json`
  fica com o número dele; para voltar ao padrão da 0.7.0, grave `250000` nessa chave. O
  `/esquadro:calibrar` passa a medir a amostra contra o padrão novo: conta as conversas que chegaram a 175
  mil (os mínimos seguem 30 sessões e 10 conversas).
- **`/esquadro-plano` mostra o plano inteiro.** Sem `plano-ativo.json`, o painel acha o plano pelo último
  `Plano: <caminho>` do Objetivo da frente vinculada à sessão (antes dizia "nenhum plano ativo" mesmo com
  plano em curso); lê cabeçalhos `Tarefa`, `Item`, `Etapa`, `Onda` e `Fase` com número (`3a` vale) e
  travessão, e `[FEITO]` no cabeçalho quando não há caixas; e acrescenta o que falta, as sessões gastas
  (marcas `(sessao N` no Objetivo da frente) e a estimativa das que faltam, com a base da conta. O portão
  de "etapa com subitem aberto" segue lendo só o formato de antes.

**Corrigido**

- **"Hora de trocar de chat" por resposta de subagente.** Quando o retorno de um subagente citava "o
  contexto esta bom?", o aviso saía como se a pergunta fosse sua. O retorno de subagente e o aviso de
  tarefa em segundo plano deixam de contar como pergunta, também na forma em que o Claude Code 2.1.296 os
  entrega ("Another Claude session sent a message...", seguido do retorno).
- **Sugestão de `/esquadro:aprender` sem correção sua.** O mesmo retorno de subagente, quando trazia uma
  frase de correção, era lido como correção do dono. Mesmo filtro.
- **Revisão cega que dava ronda seca com P1 novo.** O apurador tratava como repetição um achado na mesma
  linha, lente e severidade da ronda anterior, mesmo quando a linha tinha sido reescrita entre as rondas.
  Agora o apurador lê o texto da linha citada no `A.txt`/`B.txt` de cada ronda: se ele mudou (espaços
  não contam), o achado conta como novo. O `refutados.json` segue valendo como antes.

## 0.7.0 — menos paradas

**Mudado**

- **Troca de chat por tamanho: o padrão passa de 150 mil para 250 mil tokens.** Medido em 435 sessões:
  abrir chat novo custa escrever o handoff (o texto de continuação) mais a rampa (o chat novo só faz a
  primeira edição com ~119 mil tokens de contexto), e trocar no fim do turno a 150 mil saía 9% mais caro
  que não trocar; a 250 mil empata. O aviso continua saindo só no fim do turno, nunca no meio da tarefa.
  Chave: `limiares.tokensDeContexto`. Quem já gravou essa chave no `projeto.json` fica com o número dela;
  para voltar ao antigo, grave `150000` nela.

**Novo**

- **Alarme a 450 mil tokens** (`limiares.tokensAlarme`). Um segundo aviso, mais firme, que sai uma vez
  mesmo depois do primeiro: acima de 500 mil cada chamada custa cerca de 4 vezes a de 200 a 300 mil.
- **Validar antes de pedir.** A abertura de toda sessão injeta, entre o bloco de paralelismo e o de
  qualidade, a regra de o agente validar sozinho (rodar o teste, abrir o navegador pelo Claude in Chrome
  ou pelo protocolo de depuração do Chrome, ler o resultado) antes de pedir ação manual, e pedir só o que
  só você pode, tudo num pedido só. Vale com e sem o modo contínuo, e não tem chave para desligar. A
  skill `padrao` traz a mesma regra.
- **Modo contínuo** (`"modoContinuo": true` em `.claude/esquadro/projeto.json`, desligado por padrão).
  Só o booleano `true` liga. Com ele, só três coisas pedem troca de chat: o tamanho da conversa (aviso e
  alarme), os bloqueios de portão (no limiar `limiares.bloqueios`, 6 por padrão) e a sua pergunta sobre
  o contexto; revisões, decisões, commits, turnos e arquivos não encerram a sessão. Em troca, o agente
  relê o plano antes de cada subitem, decide sozinho a escolha técnica dentro do escopo e lista no fecho;
  a você ele segue perguntando o irreversível, o externo (publicar, push, envio), o de custo e o de produto.
- **`/esquadro:calibrar`.** Lê as transcrições que o Claude Code guarda deste projeto (só a conversa
  principal), mede a partir de quantos tokens trocar de chat ainda compensa e sugere o limiar. Só números
  saem do script, nenhum trecho de conversa. Com menos de 30 sessões, ou menos de 10 conversas que chegaram
  ao limiar padrão, a amostra é pequena e o limiar atual fica. Ele só grava no `projeto.json` com
  `--gravar` (aceita de 50000 até abaixo do alarme), que a skill só roda depois do seu sim.

## 0.6.6 — dois erros calados passam a avisar

**Corrigido**

- **Próxima decisão com caminho errado.** `scripts/plano.js --proxima-decisao` com um caminho que não
  existe respondia `1` sem dizer nada, e a decisão saía com o número 1 num projeto que já tinha outras. O
  `1` continua (projeto novo ainda não tem arquivo de decisões), mas agora vem com um aviso que mostra
  o caminho procurado. Uma pasta no lugar do arquivo para com erro.
- **Autorização do paralelo recusava arquivo válido.** O `settings.local.json` gravado pelo PowerShell
  5.1 começa com uma marca invisível (BOM), e o arquivo vazio era tratado como JSON quebrado: nos dois
  casos a autorização do `/esquadro:paralelo` não era gravada. Agora a marca é ignorada e o arquivo
  vazio vale como sem configuração.

## 0.6.5 — o agente de leitura conta linhas certo

**Corrigido**

- **Contagem de linhas errada no PowerShell.** Pedido para contar as linhas de um arquivo de 121, o agente
  `leitor` do `/esquadro:paralelo` respondeu 110: usou `Measure-Object -Line`, que pula linha vazia, e
  disse que era o mesmo que `wc -l`. O agente agora traz como contar nos dois shells, avisa desse
  comando e de que, sem quebra de linha no fim do arquivo, os dois shells diferem em uma linha. Medido no VS Code com a 0.6.4: três leituras custaram 38.514 tokens, contra 169.098 antes dela.

## 0.6.4 — leitura em paralelo custa menos

**Mudado**

- **Tarefa só de leitura do `/esquadro:paralelo` abre leve.** Cada agente de leitura nascia com as
  instruções do projeto, a memória e a lista de skills, e três leituras simples custaram cerca de 169
  mil tokens. Agora quem só lê roda no agente `leitor` do plugin, que abre sem esse peso e sem
  ferramenta de edição: medido, uma leitura caiu de cerca de 56 mil para 6 mil tokens. Quem edita
  segue como antes, com as regras do projeto e cópia isolada do repositório.

## 0.6.3 — o paralelo roda no VS Code em Windows

**Corrigido**

- **`/esquadro:paralelo` recusado no VS Code em Windows.** O Git para Windows instala o plugin trocando
  o fim de linha de cada arquivo, e o VS Code recusava o workflow antes da janela de aprovação, por ver
  um caractere escondido no script. O repositório agora fixa o fim de linha (`.gitattributes`), e um
  teste reprova se o workflow tiver caractere de controle. Quem já tem a 0.6.2 recebe a correção na
  próxima atualização do plugin.

## 0.6.2 — menos contexto, mais paralelo

Medido nas sessões do autor: as chamadas com conversa acima de 150 mil tokens eram 61% do total e 71%
do custo, e a abertura de cada inspetor carregava listas que ele nunca usa. Esta versão corta os dois e
ensina o Claude a não ficar parado esperando agente.

**Novo**

- **Trabalho em paralelo.** A abertura de toda sessão traz quatro regras curtas: agente em segundo
  plano não é motivo para parar; agentes que editam ao mesmo tempo rodam isolados; relatório de agente
  é alegação; e o freio de custo (modelo mais barato que resolve, no máximo 8 por disparo). Desligar: a
  chave `paralelismo` com `false` em `.claude/esquadro/projeto.json`.
- **Workflow `/esquadro:paralelo`.** Com 3 ou mais tarefas independentes, o Claude oferece o workflow,
  diz quantos agentes, qual modelo e o custo, e só roda depois do seu sim. Ele aplica o freio sozinho:
  8 por disparo (diz quais ficaram de fora), Haiku para quem só lê e Sonnet para quem edita, cópia
  isolada do repositório para quem edita, e cada resultado volta com a evidência que o agente colou.
- **Autorização uma vez só.** O `/esquadro:init` pergunta se o workflow pode rodar sem janela de
  aprovação e, no sim, grava a regra em `.claude/settings.local.json` (arquivo pessoal, fora do git)
  sem tocar nas outras permissões.
- **O tamanho da conversa conta.** Sétimo gatilho de troca de chat: conversa acima de 150 mil tokens
  de contexto. O plugin lê o fim do registro da sessão no fim de cada turno (pode vir um turno
  atrasado); o medidor `/esquadro-sessao` usa o número ao vivo.

**Mudou**

- **Inspetor e juiz mais leves.** Os dois agentes da revisão cega só leem (`Read`, `Grep`, `Glob`) e
  abrem sem a lista de skills e sem as instruções do projeto (pede o Claude Code 2.1.271 ou mais novo).
- **Revisão de arquivo só de lógica: 6 inspetores**, não 8. Saem as lentes de medidor e de escopo, que
  quase nunca acharam defeito real nesse tipo de arquivo.

## 0.6.1 — onze ajustes de uso

Os itens que a revisão da 0.6.0 deixou registrados e que se esbarram no uso normal. Cada um com teste
escrito antes; o portão de fecho também passou por revisão cega.

**Corrigido**

- **Comando destrutivo.** `git restore` com opção que não muda o descarte antes do `.` (`-q`, `--ours`,
  `--theirs`, `--merge`, `--conflict=`, a abreviação `--work` do `--worktree`...) apagava a árvore e
  passava; agora é barrado como o `git restore .`. `restore --staged -q .` (só o índice) e `-p .`
  (interativo) seguem liberados.
- **Portão de fecho.** Intenção não é mais lida como alegação: "vou concluir a tarefa", "antes de fechar
  a etapa", "concluindo a fase". E passam a ser lidas: "Tarefa 3: concluida", "tarefa nº 3", "a tarefa 3
  ja esta concluida", "onda 7b concluida", "tarefa 1.2 concluida". Id que o plano não tem como cabeçalho
  `Tarefa N` (7b, 1.2) é cobrado pela tarefa em andamento, nunca pela Tarefa 7 ou 1 por engano.
- **Medidor da sessão.** A medida que chega enquanto outra mede não se perde mais; se a leitura de uso
  travar, a linha de status diz isso e mede de novo em vez de congelar no último número. Percentual sai
  inteiro; janela sem nome, gatilho incompleto e previsão infinita são omitidos em vez de virar
  "undefined" ou "Infinity". No painel do VS Code, o "o que fazer" não emenda mais no último item.
- **Painel do plano.** `plano-ativo.json` gravado com BOM (comum no Windows) vale de novo, inclusive no
  portão de fecho; o que existe mas não se lê diz isso em vez de "nenhum plano ativo"; sem plano, o
  painel mostra o caminho real do `plano.js` para abrir um. A saída JSON do `plano.js` não conta
  tarefa sem caixa de passo como concluída (`semCaixas`).
- **Chave de liga/desliga com valor torto.** `"sugerirAprender": "false"` (entre aspas) não desliga, e
  agora a abertura da sessão avisa; a conferência final do `/esquadro:init` (`validar.js`) reprova; o
  re-init aceita as
  seis chaves (`sugerirAprender`, `auditarNaAbertura`, `qualidadeDeResposta`, `portaoDecisao`,
  `portaoHandoff`, `vigia`).
- **`/esquadro:aprender`.** Regra que é só o começo de outra já gravada era recusada como "JA EXISTE";
  a duplicata agora é a linha inteira.
- **Novidade da semana do vigia.** Linha longa quebra em até três linhas na tela, sem partir o link;
  antes, cortava em 200 caracteres.
- **README.** O parágrafo dos comandos `/esquadro-sessao` e `/esquadro-plano` diz as três causas de o
  comando não aparecer (inclusive o esquadro antigo, com o comando de atualizar), que a forma com
  dois-pontos não existe, e o que o painel responde sem plano ativo.

## 0.6.0 — os números na tela, e a correção que vira regra

Uma revisão completa do plugin (scripts, ganchos, skills, agentes e testes) e o que ela trouxe de
novo. Cada falha confirmada foi corrigida com teste escrito antes; o comportamento novo vem com teste;
a suíte inteira roda com `npm test`.

**Novo**

- **Medidor da sessão e painel do plano, dentro do Claude Code.** Dois comandos que vêm com o plugin,
  como *mods* (extensões que o próprio Claude Code roda na sessão; exigem o Claude Code 2.1.287 ou mais
  novo). `/esquadro-sessao` mostra o contexto usado, as janelas de limite (5h e semana) com a hora em
  que renovam, o custo, a previsão em turnos e cada gatilho de troca de chat com o valor e o limiar.
  `/esquadro-plano` mostra o plano ativo: tarefas feitas, abertas e a próxima. No terminal e no app
  Desktop o medidor também fica na linha de status, e quando um gatilho cruza aparece uma faixa acima
  do prompt com o botão "gerar handoff". Nada disso abre rede.
- **Correção vira sugestão de regra.** Quando a sua mensagem parece uma correção ao jeito de o Claude
  trabalhar ("eu ja te disse", "da proxima vez..."), ele atende o pedido e oferece, em uma linha, virar
  regra com `/esquadro:aprender`. O gancho nunca grava: quem grava é a skill, depois do seu sim. No
  máximo uma sugestão a cada cinco turnos. Desliga com `"sugerirAprender": false` no `projeto.json`.
- **A auditoria roda sozinha.** Na abertura da sessão, no máximo uma vez a cada 7 dias, o plugin roda
  a auditoria do `/esquadro:auditar` e só fala se algo passou do limite: peso de instrução, skills que
  se sobrepõem, regras que se contradizem, skill do projeto parada há 90 dias ou mais. Os prazos ficam
  em `limiares` (`diasEntreAuditorias`, `diasSkillParada`); desliga com `"auditarNaAbertura": false`.
- **Para quem mantém o plugin: a novidade da semana na abertura.** Com `"vigia": true` no
  `projeto.json` (desligado por padrão), a abertura mostra uma vez o arquivo semanal que o
  `scripts/vigia-puxar.js` trouxe para `~/.claude/esquadro/vigia`, marcado como dado, não instrução.
  Quem busca o arquivo é uma tarefa agendada; gancho nenhum abre rede.
- **Ferramentas de linha de comando:** o README mostra como rodar cada script a partir da pasta do
  plugin instalado (`node "<plugin>/scripts/uso.js"`), e os avisos que mandam rodar um script citam o
  caminho real, nunca uma variável não expandida.

**Corrigido**

- **Comando destrutivo.** Passam a ser barrados: `push` forçado com `-f` agrupado a outras opções,
  `clean` com o `-f` depois de outra opção, `checkout`, `restore` e `switch` que descartam a árvore
  inteira, e escrita direta em disco. Opção global do git com valor entre aspas não escapa mais.
  `checkout -- <arquivo>` e `restore --staged .` seguem liberados. Padrão inválido em
  `comandosLiberados` não libera nada.
- **Estado que não grava não abre portão.** Se a pasta de estado do plugin não aceita escrita, nada
  que estaria barrado passa por isso. Um `projeto.json` inválido é dito como inválido, não como
  ausente, também na abertura.
- **O fecho com plano ativo cobra a etapa certa:** a tarefa citada (todas, quando são várias), a que
  está em andamento quando não há número, nunca uma tarefa futura. Plano ativo que não pode ser lido é
  avisado.
- **Catraca.** `max-width`, `min()`, `maxWidth` e variável local `max`/`min` deixam de ser régua;
  constante em caixa alta, nome com sufixo e número com unidade seguem sendo. Anotação de tipo entre o
  nome e o número não esconde a régua.
- **Token fora do design system.** Seletor de id com letras hexadecimais não é mais cor; cor em valor
  de várias linhas, em argumento de mixin e em fallback de `var()` passa a ser achada; comentários de
  bloco são respeitados.
- **`sanitar` não diz LIMPO sem ter lido.** Arquivo que não abre, vocabulário local quebrado e
  `excecaoEm` inválido saem com 2. Arquivo com acento no nome, UTF-16 com BOM e pasta pessoal do macOS
  e do Windows em qualquer caixa entram na conferência; binário sai como "nao conferido", com o motivo.
- **`/esquadro:init` na reconfiguração** preserva o que a entrevista não perguntou de novo (limiares,
  chaves postas à mão, subchaves de agentes) e declara o escopo antes de gravar a configuração. Valor
  com `: ` no cabeçalho de um agente gerado sai entre aspas, e quebra de linha ali é recusada.
- **`/esquadro:aprender`** recusa gatilho ou ação com quebra de linha: a regra é uma linha só.
- **`cicatriz.js`** aceita um arquivo, e não só uma pasta, em `--manual` e `--corpus`.

## 0.5.4 — o portão do handoff erra menos

Ajustes que a revisão cega da 0.5.3 deixou registrados. O comportamento novo vem com teste; a suíte
inteira roda com `npm test`.

- **O portão do prompt do handoff segue mais de perto o CommonMark ao procurar o bloco de código.**
  Cerca com 4 colunas de recuo ou mais (contadas a partir do conteúdo do item de lista em que está)
  não abre nem fecha bloco: é bloco recuado. O tab conta até a próxima coluna múltipla de 4, também
  logo depois do `>` de uma citação: `>`, tab e a cerca abrem o bloco. A cerca aberta numa citação
  fecha quando a citação acaba, e o texto depois dela não conta como corpo. Dentro da cerca, uma
  linha `>` fora de citação é corpo, e uma linha só de espaço não separável (NBSP) também.
- **Estado corrompido não dispara o aviso de troca de chat pelos arquivos tocados.** Se o registro
  dos arquivos tocados não for uma lista (texto, objeto), ele conta zero, como já acontecia com as
  decisões e os commits.
- **O motivo do portão do prompt do handoff** pede o prompt "num bloco de codigo (tres crases ou tres
  tis)", no lugar da cerca crua seguida de vírgula.
- **README:** a mensagem literal do portão do prompt do handoff entra na lista do que cada portão
  responde quando nega; a tabela de `travas` diz que `fecho: false` não desliga esse portão; o
  parágrafo dele vira frases curtas e diz o que acontece com ele desligado; a descrição do
  `/esquadro:handoff` cita o portão e a exceção do aviso de troca de chat.
- Comentários de `portao-fecho.js`, `marcar-trabalho.js`, `abrir-turno.js` e `lib/saude.js`
  alinhados ao que o código faz.

## 0.5.3 — o prompt do handoff chega ao chat

Gravar o handoff só no arquivo deixava o chat novo sem o texto para colar. O fim de turno passa a
cobrar o prompt na resposta. O comportamento novo vem com teste; a suíte inteira roda com `npm test`.

- **O turno que gravou um handoff sem o prompt em bloco é barrado.** Arquivo de handoff é um `.md`
  com data `AAAA-MM-DD-` na frente do nome e "handoff" no nome (`<data>-<assunto>-handoff.md`) ou
  dentro de uma pasta `handoff/`. Se o turno gravou um desses e a resposta final não tem bloco de
  código (cerca de três crases ou de três tis, com corpo não vazio; cerca sem fecho, dentro de
  citação ou de item de lista também conta), o fim do turno é barrado, uma vez, com o motivo dizendo o que fazer: colar
  o prompt agora, em bloco, nesta resposta final.
- **Um bloqueio só, com todos os motivos.** Se o mesmo turno também tem subitem aberto ou ficou sem
  evidência, os motivos saem juntos no mesmo bloqueio.
- **O aviso de troca de chat não manda colar de novo.** No turno que gravou o handoff e já tem o bloco
  na resposta final, a ordem ao Claude passa a ser apontar para o bloco acima, sem rodar o handoff nem
  colar outra vez.
- **Como desligar:** `"portaoHandoff": false` no `projeto.json`. O `travas.fecho: false` não o
  desliga.
- **Limites:** o portão lê só a resposta final (bloco colado numa mensagem anterior do mesmo turno
  não conta) e confere que há um bloco, não que o bloco é o prompt. Só o arquivo gravado por
  ferramenta de arquivo marca o turno; o gravado por comando de shell, não.
- São **22 baldes** de contador: 17 que negam, 5 que só contam.

## 0.5.2 — o auditar só acusa sobreposição de verdade, e os portões dizem por que barram

A sobreposição de skills do `/esquadro:auditar` passa a pedir mais que uma palavra em comum, e uma
leva de ajustes do que as revisões cegas anteriores deixaram registrado. Os comportamentos novos vêm
com teste; a suíte inteira roda com `npm test`.

- **O `/esquadro:auditar` só acusa sobreposição com 2 termos ou mais em comum.** Antes, 1 termo em
  comum entre as descrições de duas skills bastava. Agora são 2 termos ou mais **e** a fração de
  termos comuns (os comuns sobre todos os termos do par) de 0,20 ou mais. Numa bateria de 80 pares
  marcados, a regra antiga acusava 40, 39 deles sem sobreposição; a nova acusa só o par que se
  sobrepõe. Segue sendo aviso, não bloqueio.
- **O portão de estilo lê mais formas de comando de shell** (só vale com `.claude/esquadro/design.json`):
  - caminho em variável que o próprio comando define antes (`OUT=x; ... > "$OUT/a.css"`,
    `$out = 'x'`) vira o valor dela e passa pela conferência normal: fora do projeto, não conta. A
    variável que vem de fora, ou que é definida dentro de `bash -c`/`eval`, segue sem valor;
  - no PowerShell, `(Join-Path a b)` é lido como o caminho `a/b`, não como o fim do comando;
  - `-InputObject` (`Out-File`, `Tee-Object`) é o conteúdo, não o arquivo escrito;
  - `New-Item -Path pasta -Name arquivo` escreve `pasta/arquivo`, não os dois soltos;
  - cópia para destino sem extensão (`cp a.css src`), `.` ou `..` vai para dentro da pasta. Nome de
    arquivo sem extensão (`cp a.css Makefile`) também vira pasta: é o limite da leitura;
  - `bash`/`sh` sem `-c` lê o roteiro do heredoc (`bash <<EOF`), salvo quando recebe arquivo de roteiro;
  - a negação diz por que: o esquadro não lê o conteúdo que um comando de shell vai gravar.
- **O fim de sessão limpa também as marcas de veredito.** As marcas `<id>.veredito-<agente>.marca`,
  que acumulavam na pasta de estado, saem pela mesma regra dos 7 dias. A pasta se lê entrada a
  entrada, com o prazo conferido antes de cada uma: pasta grande não gasta mais o tempo da limpeza
  antes de começar.
- **O portão de decisão diz o remédio de cada causa.** Opção nula, em texto solto ou sem `label` em
  texto barra, com "cada opcao e { label, description }". Cada causa traz o que fazer: "deixe
  exatamente 3", "ponha (Recomendado) no rotulo dela", "a marca vai so na 1a opcao". A marca repetida
  em duas opções sai como "as opcoes 2 e 3".
- **O peso de instrução não conta o mesmo arquivo duas vezes.** Fonte declarada que também é
  `regras.md` ou `SKILL.md`, `./CLAUDE.md` ao lado de `CLAUDE.md`, ou `claude.md` e `CLAUDE.md` onde o
  disco ignora caixa: vale a primeira citação. Fonte com caminho absoluto passa a ser lida
  (contava 0). O método ao lado do número diz de onde vieram as fontes: declaradas, candidatas
  (achadas pela varredura) ou nenhuma.
- **Apuração da revisão cega.** Achado com linha 0 ou negativa é descartado como sem `arquivo:linha`
  (antes molhava a ronda e não tinha como ser refutado). Os pares para o juiz saem só entre vizinhos
  em ordem de linha, sem comparar todos com todos; a lista sai igual. `mesmos: null` pela API vale
  como sem juiz.
- **Textos:** no init, a pergunta dos lugares de registro é uma por lugar, cada uma com as suas 3
  opções, e a opção de não gravar a skill avisa que a resposta dos lugares de registro não fica gravada
  em lugar nenhum; no init e na skill
  `padrao`, a skill de execução do projeto é a que diz "Gerado por `/esquadro:init`" (com mais de
  uma, pergunta-se ao dono; sem nenhuma, vale a escrita à mão); no `revisar`, "com mais de 50 pares,
  lotes de ate 50"; no README, o `portaoDecisao` em "Como desligar uma trava" e o orçamento de 1,5 s
  do fim de sessão (o `timeout` do `hooks.json` não o aumenta).

## 0.5.1 — a recomendada é uma só, a lista vazia barra e o juiz não aponta um achado para ele mesmo

Três ajustes do que a revisão cega da 0.5.0 deixou registrado. Os comportamentos novos vêm com teste;
a suíte inteira roda com `npm test`.

- **A recomendada é uma só.** O `portao-decisao.js` confere a marca em todas as opções, não só na
  primeira: a marca também na 2a ou na 3a opção barra a pergunta, e a mensagem diz quais opções
  repetiram a marca.
- **Lista de perguntas vazia barra.** `AskUserQuestion` com `questions: []` passava sem conferência;
  agora o portão barra com "nenhuma pergunta na lista".
- **O juiz não aponta um achado para ele mesmo.** Um `mesmos.json` com `novo` igual a `outro` para a
  apuração com erro e a instrução de copiar o par como veio em `paresCandidatos`; antes saía o aviso
  "provavel mesmo defeito que" a própria chave.

## 0.5.0 — o juiz que aponta achado repetido e o portão da pergunta ao dono

Duas peças da frente do decisor local: um modelo pequeno entra na revisão cega só para
avisar, e a regra das 3 opções deixa de ser só texto. Os comportamentos novos vêm com teste; a suíte
inteira roda com `npm test`.

- **O juiz de "mesmo defeito" só avisa.** Agente novo `juiz-mesmo` (`model: haiku`, `effort: low`,
  sem `Write` nem `Edit`). O `apurar-ronda.js` passa a listar `paresCandidatos`: cada achado P0/P1
  novo da última ronda ao lado de outro achado do lado novo, no mesmo arquivo, a até 10 linhas, com
  chave diferente. No Passo 3 do `/esquadro:revisar`, um juiz recebe a lista (lotes de até 50 pares),
  a resposta vai em `mesmos.json` e a saída mostra `provaveisMesmos`. **A contagem não muda:** ronda
  seca, abertos e teto seguem iguais, e o achado novo continua molhando a ronda. Repetição de algo já
  corrigido se prova na fonte, pelo `refutados.json`; a palavra do juiz não é prova. `mesmos.json`
  ilegível ou que não é lista para a apuração com a instrução de corrigir ou apagar.
- **A pergunta ao dono passa por um portão.** Gancho novo antes do `AskUserQuestion`
  (`portao-decisao.js`): barra a pergunta que não tem exatamente 3 opções, ou cuja primeira opção
  não traz a marca entre parênteses — `(Recomendado)`, `(Recomendada)`, `(Recommended)` ou
  `(Recom.)`, em qualquer caixa. Palavra solta ("Recomendado: x") ou negação ("Nao recomendado") não
  é a marca. A mensagem diz o que refazer. Um projeto com outra regra o desliga com
  `"portaoDecisao": false` no `.claude/esquadro/projeto.json` (só o booleano desliga). Falha do
  próprio portão libera a pergunta.
- **README:** tabela de ganchos com o portão novo (dez pontos do ciclo); a seção dos agentes e a
  exceção declarada de modelo passam a nomear o `inspetor` e o `juiz-mesmo`.

## 0.4.4 — o estilo escrito pelo shell passa pelo design, o fim de sessão limpa o estado velho e o commit conta pela linha do git

Três pendências que o usuário sente, do backlog de achados, e ajustes no init, na lente de segurança,
no `/esquadro:auditar` e no README. Os comportamentos novos vêm com teste; a suíte inteira roda com
`npm test`.

- São **21 baldes** de contador: 16 que negam, 5 que só contam.
- **O arquivo de estilo escrito por comando de shell passa pelo design.** Gancho novo na entrada
  `Bash|PowerShell` (`portao-estilo.js`, balde `estilo_por_shell`): com `.claude/esquadro/design.json`,
  o comando que escreve arquivo de estilo é negado, e a mensagem manda usar Write ou Edit, que conferem
  os tokens. Sem o `design.json`, nada muda. O leitor do comando é heurístico: o que ele não pega está
  em "O que o esquadro NAO promete", no README.
- **O fim de sessão limpa o estado velho.** Gancho `SessionEnd` novo (`fim-sessao.js`): apaga os
  arquivos de sessão parados há mais de 7 dias, nunca o da sessão que fecha, para o `--resume` seguir
  funcionando.
- **O commit conta pela linha do git.** Quando o Claude Code não informa o `gitOperation` (ele some com
  `-q` e com `git -C` em caminho com espaço), o contador lê a linha `[branch sha]` que o `git commit`
  imprime. Commit com `-q` não imprime a linha e segue sem contar; o README diz isso.
- **O peso de instrução conta as fontes candidatas.** Sem `projeto.json`, o init e o `/esquadro:auditar`
  somam ao peso os candidatos a fonte canônica que a varredura achou, marcados como candidatos
  (`fontes: 'candidatas'`). Fontes declaradas no `projeto.json` mandam, mesmo vazias.
- **Init: onde cada coisa se registra.** Passo 4b novo: pergunta um arquivo para as decisões do dono,
  um para as dúvidas abertas e um para o progresso do plano. No re-init com a skill do projeto já
  gravada, o 7c não grava por cima: o init mostra o trecho para o dono por na skill e avisa quando a
  resposta não fica gravada.
- **Lente de segurança de código:** três conferências antes de abrir P0 e a regra do P2, como a lente
  de tela.
- **README:** a versão nova chega alguns minutos depois de abrir a sessão e o aviso pode não aparecer
  no painel (`claude plugin list` confere o que está no disco); tabela de ganchos com os dois novos;
  subtítulo e link dos comandos corrigidos.

## 0.4.3 — o aviso de troca de chat que chega ao Claude, mensagens que dizem o que fazer e a doutrina de uso comum

Quem instala o plugin passa a ganhar a troca de chat com handoff, que antes só vinha do `CLAUDE.md`
de quem o escreveu. Nenhum portão novo. Os comportamentos novos vêm com teste; a suíte inteira roda
com `npm test`.

- **O aviso de troca de chat chega ao Claude, não só à tela.** No fim do turno, uma vez por sessão, o
  Claude recebe a ordem de rodar `/esquadro:handoff`, dizer que é hora de abrir chat novo citando o
  gatilho e colar o prompt pronto. Se o fim de turno já for de um laço de continuação, o aviso espera
  o próximo. Funciona sem o `/esquadro:init`, com os limiares padrão.
- **Dois gatilhos novos e uma pergunta que dispara.** Contam as decisões suas respondidas nas
  perguntas de escolha (padrão 3) e os commits que passaram (padrão 3, lidos do
  `gitOperation.commit.sha` que o Claude Code informa; sem o campo, o commit não conta). Perguntar se
  o contexto ou a memória da conversa está bom dispara na hora, a cada vez.
- **README:** o que dispara, o que não (erro de medição e o tamanho da conversa, que gancho não
  enxerga), como conferir que os ganchos rodam, o estilo de resposta (output style) e a atualização
  automática pelo `~/.claude/settings.json` (`autoUpdate: true` na entrada do `esquadro-local`),
  porque o painel do VS Code não tem o botão.
- **Mensagens que dizem o que fazer.** A medição de qualidade diz como julgar os pares que faltam, o
  que conferir quando a abertura do plugin não aparece ou aparece duas vezes, e qual chave do
  `projeto.json` falta quando o bloco aparece onde não devia. A tabela de idioma não mostra mais
  "undefined" quando a regra não tem sugestão, e o subshell sugerido vem explicado.
- **O molde de agente ganha `effort`, `tools`, `maxTurns` e a escalada.** O gerador recusa, dizendo o
  valor aceito, esforço fora da lista, `maxTurns` que não é inteiro positivo, ferramenta com nome
  inválido (nome de ferramenta MCP, com hífen, vale) e valor de tipo errado; o `escalaPara` sai da
  ordem da escada, não da resposta.
- **Doutrina de uso comum na skill `padrao`.** Agente que edita por casamento exato não fica no degrau
  mais barato; subagente que cai por limite de uso é relançado em outro modelo; três conferências antes
  de abrir P0 de segurança; número medido só depois da última edição; as duas provas da mutação;
  decisão anunciada é decisão gravada; hora só depois do `date`; escolha visual mostra a imagem antes
  de perguntar. As armadilhas de ambiente (`06-ambiente.md`) ganham: credencial que não se contorna,
  envio e regeneração no mesmo turno, comando que lista o ambiente é vaza segredo, código de saída de
  comando encanado, falha de `fork` do Git Bash, o `bash` do WSL e o caminho curto do Windows. No
  init, o `AGENTS.md` espelhado é conferido junto do `CLAUDE.md`.

## 0.4.2 — o leitor do `cd` mais fiel ao shell, a medição que não perde execução paga e testes mais firmes

A segunda metade das pendências conferidas contra o código: o leitor do `cd` solto e a tabela de
idioma, a medição de qualidade e a higiene dos testes. Nenhum portão novo. Os comportamentos novos vêm
com teste; a suíte inteira roda com `npm test`.

- **O `cd` solto lido como o shell lê.** Atribuição, `time`, `!` e palavra entre aspas na frente deixam
  o `cd` em posição de comando (`x=1 cd y` nega). Função do PowerShell só roda quando é chamada, e o
  que vem depois do `=` de atribuição é lido como comando (`$x = Set-Location y` nega). Grupo `{ }` em
  cano roda em subshell e não nega. `pushd a && popd` não nega; `popd` dentro de `if`/`while` ou de
  função chamada depois de `&&` pode não rodar e não conta como volta. Comando com mais de 100 níveis
  de aninhamento não é lido inteiro e passa a ser negado, com mensagem própria.
- **A tabela de idioma mais robusta.** Arquivo salvo com BOM se lê; padrão vazio ou só de espaço é
  regra que não se lê (antes casava tudo); regra sem `achado` não derruba a mensagem; o conferir e o
  aviso da tabela usam a mesma plataforma. O aviso diz que o comando seguinte já usa a tabela
  consertada, a frase "troque de idioma" deixou a caixa alta e o eco do comando para em 120
  caracteres, dizendo o tamanho.
- **A medição de qualidade não perde execução paga.** Falha ao ler a saída do claude vira motivo da
  geração, que se grava; a gravação final diz o que ficou sem gravar; "o claude rodou e foi parado"
  se separa de "nao rodou". `--prompt` sem valor é recusado com mensagem própria; arquivo do prompt que
  cairia em `.claude/esquadro/` ou `.git/` do brinquedo é recusado antes da 1a execução; a dica de
  tirar as aspas de `ESQUADRO_CLAUDE`; montagem com mais de 10 minutos é dada como morta mesmo com o pid
  vivo.
- **A régua do voto do juiz mudou (leia antes de comparar rodadas).** Valem como "nao sei" também as
  frases curtas em 1a pessoa ("nao consigo dizer", "nao da para saber", "impossivel decidir"); aspas
  baixas e angulares simples citam; os preenchedores do hangul não escondem o "nao sei"; aspa em número
  ímpar na linha não forma citação; o fecho curvo usado dos dois lados só cita quando é o único par da
  linha. Na dúvida, o voto vira empate. Os votos reais já medidos não mudaram, mas uma rodada nova não
  se compara com uma antiga sem dizer isso.
- **Testes mais firmes.** A catraca de tempo do portão destrutivo mede de novo antes de reprovar (um
  pico isolado sob carga não derruba mais a suíte); os testes de agentes e do `AGENTS.md` apagam a pasta
  temporária que criam; a
  mensagem de teste pulado mostra o caminho com `/`. No init, o molde do `AGENTS.md` sai com acento e
  linhas de até 100 caracteres, e o JSON de respostas é apagado no fim.

## 0.4.1 — erros que dizem a causa em português, o revisar mais firme e o escopo que não se perde em link

A primeira metade das pendências conferidas contra o código (mensagens, portões, escopo e o
instrumento do revisar). Nenhum portão novo. Os comportamentos novos vêm com teste; a suíte inteira
roda com `npm test`.

- **Erro de arquivo dito em português, com o código no fim.** Os avisos que repetiam a mensagem do
  Node em inglês passam a dizer a causa: "nao existe", "sem permissao", "e uma pasta", "parte do
  caminho nao e uma pasta", "em uso", "ja existe", "disco cheio", com o código (`ENOENT`, `EACCES`...)
  entre parênteses. Vale nos scripts do revisar, na reinjeção, no escopo, na auditoria e no exportar.
- **O escopo não se perde em link nem em arquivo ilegível.** Arquivo de frente que existe e não se lê
  diz a causa e o que conferir. Frente que é link para fora do projeto não é lida; pasta `escopos/`
  que é link para fora da lista vazia, com uma linha dizendo por que. Uma linha `---` deixou de virar item. Na
  reinjeção, o plano ativo se confere pelo caminho real, campo que não é texto vira "Plano ativo
  ilegivel" (nunca `undefined`), e o corte da linha longa não parte um emoji ao meio.
- **O revisar mais firme.** As duas lentes que tinham o mesmo nome nas duas famílias agora se
  distinguem: "Fidelidade ao design system" e "Estados obrigatorios" ganham "(codigo)" e "(tela)", e a
  refutação casa a lente certa. O gravador não remapeia veredito antigo com o nome sem sufixo. O
  `apurar` lê valor que começa com `--` como valor, a menos que seja flag do uso; um `mapa.json`
  estragado vira "(mapa ilegivel)" na listagem em vez de derrubar o comando; entrada nula no
  `refutados.json` e "entrada invalida". O `preparar` não deixa pasta vazia quando o arquivamento
  falha, avisa da revisão fechada no formato antigo, segue se outro `preparar` já arquivou, e ignora
  `## ` dentro de bloco de código ao achar a régua. O gravador recusa pasta de ronda fora do projeto e,
  quando grava o veredito mas a marca falha, diz na hora que gravou.
- **Portões e libs menores.** `travas`, `marchas` e `limiares` parciais no `projeto.json` se fundem por
  chave com o padrão, em vez de substituir o bloco inteiro. Catálogo consultado mais de um dia no
  futuro é inválido. Exportar sem nada para copiar é erro. A abertura diz "nao sei" quando o git não
  responde. A auditoria tira o `\r` do CRLF ao medir e diz por que o `regras.md` é ilegível. O portão
  destrutivo avisa mesmo quando gravar o estado falha. Saíram o campo `ultimaFerramenta` do estado, a
  função `extrairTokens` e as ferramentas `search` e `ls` da busca, que nada usava.
- **Dois baldes novos no contador, para o que o portão de escopo barra por motivos diferentes:**
  `frente_invalida` (nome de arquivo de frente fora da classe permitida) e `fora_declarado` (o arquivo
  casa o que o escopo declara "Fora"). Antes os dois somavam em `fora_do_escopo`, e quem lia o contador
  não sabia qual dos três motivos tinha barrado. Os dois entram na soma de bloqueios do gatilho de
  saúde. São **20 baldes** de contador: 15 que negam, 5 que só contam.

## 0.4.0 — o bloco de qualidade de resposta, e a economia que saiu

Um recurso novo, ligado por padrão, e uma skill aposentada. Nenhum portão novo: o recurso não barra
nada. Os comportamentos novos vêm com teste; a suíte inteira roda com `npm test`.

- **Toda sessão abre com um bloco de seis regras de clareza para as respostas ao usuário.** A
  abertura da sessão injeta o bloco: conclusão na primeira linha, sem preâmbulo nem cortesia, termo
  técnico explicado na primeira vez, uma linha entre ferramentas, evidência reduzida a linha que
  prova no bloco de saída, e nada de repetir o que o usuário acabou de ler ou decidir. O "Sai/Fica"
  de cada regra está no próprio bloco. Texto gravado em arquivo (plano, decisão, handoff) fica fora.
  Funciona sem `/esquadro:init`: sem `projeto.json`, o bloco é tudo o que a abertura imprime. O
  custo é um bloco curto por abertura e nenhum por turno, com teto prendido por teste. O README traz
  o bloco literal e o número de caracteres, e um teste prende que ele é igual ao que a abertura injeta.
- **Como desligar:** `"qualidadeDeResposta": false` em `.claude/esquadro/projeto.json`. Só `false`
  desliga; outro tipo segue ligado e o portão de escrita avisa "qualidadeDeResposta tem de ser true ou false",
  como os outros avisos de tipo do `projeto.json`.
  O `init` não pergunta nem grava a chave, e projeto já gravado não precisa mudar.
- **O bloco só entrou porque ganhou uma medição A/B cega.** Doze perguntas congeladas, três
  condições (com o bloco, a resposta padrão e o caveman), cada par julgado nas duas ordens por um
  inspetor que não sabe qual lado é qual. Contra o caveman: 12 vitórias, 0 derrotas, 0 empates.
  Contra a resposta padrão: 4 vitórias, 3 derrotas, 5 empates. Tokens de saída, somados nas 12
  execuções de cada condição: padrão 30462, caveman 12732, com o bloco 22888. Medido no Sonnet; no
  Opus, não medido. A margem contra a resposta padrão é curta, o texto foi ajustado uma vez olhando
  as derrotas destas mesmas perguntas (sobreajuste possível), e sessão longa não foi medida. O
  instrumento vem no plugin: `scripts/medir-qualidade.js`, com as perguntas em
  `modelos/qualidade-prompts.json`; o placar inteiro está no README.
- **A `/esquadro:economia` saiu.** As regras dela foram para dois lugares: a regra do tamanho das
  opções (uma ou duas frases, com a consequência e o custo dentro; mais que isso é duas escolhas) foi
  para a skill `padrao`, e as outras viraram o bloco da abertura. A skill e o teste dela saíram do
  plugin; o instrumento de fecho (a resposta enxuta que ainda traz o bloco de saída passa, e sem o
  bloco é barrada) segue provado, agora com exemplos próprios. A skill `padrao` passa a apontar para
  o bloco da abertura, e o teste de "todo comando que o CHANGELOG anuncia existe" aceita o comando
  que o próprio CHANGELOG diz que saiu, em qualquer entrada.
- **O README ganha o passo a passo para ligar a atualização automática** do marketplace, em "Como
  instalar": plugin de terceiro não se atualiza sozinho até esse botão ser ligado.
- **Os contadores não mudaram:** são **18 baldes** de contador: 13 que negam, 5 que só contam.

## 0.3.5 — o `cd` solto lido de uma vez, a tabela do PowerShell que avisa e a auditoria que não cala

Tudo o que a revisão da 0.3.4 deixou registrado. Nenhum portão novo. Os comportamentos novos vêm com
teste; a suíte inteira roda com `npm test`.

- **O `cd` solto se acha numa leitura só do comando.** O detector era uma pilha de filtros, e cada
  um errava o que o outro já tinha tirado ou ainda não. Agora o comando se lê de uma vez, no idioma
  da ferramenta: aspas (com `$'...'` no Bash), comentário, heredoc e here-string, subshell e cada elo
  de cano no Bash, a subexpressão `$( )` do PowerShell (que roda, mesmo dentro de aspa dupla), chave
  de hashtable, e se a palavra está mesmo em posição de comando. Passam a ser negados: o `cd` depois
  de um `<<EOF` escrito em comentário, `"$(Set-Location X)"`, o `cd` no braço de um `case`,
  `` c`d `` e o `cd` depois de uma aspa `$'...'`. Deixam de ser negados: `@{ cd = 1 }`,
  `Push-Location` sem caminho, `sl\`, `then` e `do` como argumento, `pushd X; ...; popd` no Bash,
  `echo a | cd X` e a definição de uma função com `cd` (chamar a função segue negado). Um `popd`
  depois de `&&` ou `||` não conta como volta garantida.
- **A tabela do PowerShell que não se lê avisa, em vez de calar.** Se `modelos/shell-win32.json` não
  se lê, ou uma regra dela não compila, a trava de idioma se desligava calada. Agora o comando passa
  e sai um aviso, uma vez por sessão, com o arquivo ou a regra e a causa. A tabela também passou a
  ler as aspas como o PowerShell lê. O contador ganhou o balde `shell_tabela_quebrada`, que só conta:
  são **18 baldes** de contador: 13 que negam, 5 que só contam.
- **A auditoria diz quando não leu as regras.** Um `regras.md` que não se lê dava "nenhuma
  contradicao". Agora a saída ganha a chave `regras`: lidas, ou não lidas com a causa e o que fazer.
  A medida do `MEMORY.md` conta linhas e bytes fora da carga a partir do mesmo corte, e a dica de
  erro muda com a causa (caminho, pasta no lugar do arquivo, permissão).
- **Os avisos do gravador de vereditos dizem o que fazer.** O aviso traz a lente quando ela se lê, e
  explica como gravar à mão (salvar o JSON do inspetor como `<pasta>/<lente>.json`), em vez de
  "como antes".
- **`destrutivo: false` no `projeto.json` desliga também o `cd` solto**, como já fazia; agora o
  README e o `init` dizem isso, e um teste prende.

## 0.3.4 — vereditos gravados sozinhos, `cd` solto negado e a memória medida

Três pontos medidos no uso da 0.3.3. Os comportamentos novos vêm com teste; a suíte inteira roda com
`npm test`.

- **Os vereditos da revisão cega se gravam sozinhos.** Um hook novo (`gravar-veredito.js`) lê a
  resposta do inspetor pelos dois caminhos que o Claude Code entrega (`SubagentStop` e o
  `SubagentHandback`) e grava `<lente>.json` na pasta de vereditos da ronda. O inspetor devolve a
  chave da lente e a pasta que o briefing passou; o hook só grava se ela for a `vereditos` de uma
  ronda de verdade, com `A.txt` e `B.txt` ao lado. Nunca sobrescreve, nunca barra o inspetor e nunca
  cala: o que não gravou vira aviso com a causa e a pasta, para gravar à mão como antes.
- **`cd` solto é negado nas ferramentas Bash e PowerShell.** A pasta atual persiste de uma chamada
  para a outra, e o `git` seguinte age no repositório errado. O portão agora nega o `cd` no nível de
  cima do comando e mostra a forma que devolve a pasta: subshell no Bash, `Push-Location` com
  `Pop-Location` no PowerShell, ou `git -C`/`npm --prefix`. Texto entre aspas, comentário e corpo de
  heredoc não contam; o escape é o `comandosLiberados` do `projeto.json`. As três instruções do
  próprio plugin que usavam `cd` solto mudaram para a forma aceita. O contador ganhou o balde
  `cd_solto`: são **17 baldes** de contador: 13 que negam, 4 que só contam.
- **A auditoria mede o `MEMORY.md`.** Com `--memoria <caminho>` (a skill passa o caminho), a saída
  ganha a chave `memoria`: linhas, bytes, maior linha e o que fica fora da carga da sessão, contra o
  limite da documentação (as primeiras 200 linhas ou 25 KB, lido como 25.000 bytes). A medida sai à
  parte e não soma no teto de instrução. Sem caminho, ou arquivo que não se lê, diz "nao medida" e a
  causa.

## 0.3.3 — revisão que não aprova sem voto, e revisão nova que começa do zero

Dois defeitos da revisão cega, e o acabamento dos pontos que a revisão da 0.3.2 deixou registrados.
Nenhum portão novo. Os comportamentos novos vêm com teste; a suíte inteira roda com `npm test`.

- **Ronda sem voto não é ronda seca.** Uma ronda sem nenhum veredito contava como seca, e duas
  assim aprovavam a revisão sem nenhum inspetor lido. Agora o `apurar-ronda.js` para com erro que
  diz qual ronda e o que fazer (gravar os vereditos dela, ou apagar a pasta da ronda preparada por
  engano); a pasta de vereditos que não se lê para com a causa, em vez de contar como vazia. Se
  nenhuma lente achou nada grave, a ronda seguinte chama ao menos uma.
- **Revisão nova de arquivo já revisado começa do zero.** Preparar de novo um arquivo cuja revisão
  já fechou herdava as rondas antigas e o teto gasto. Agora o `preparar-revisao.js` move a revisão
  fechada inteira para `.claude/esquadro/revisao-fechada/<arquivo>/<carimbo>/` (nada se apaga), diz
  para onde ela foi e começa na ronda 1.
- **Apuração da revisão.** `refutados.json` que não é lista e `mapa.json` presente mas corrompido
  param com erro que cita o arquivo; antes viravam lista vazia e ronda sem mapa, calados. O arquivo
  revisado é reconhecido também com `../` no meio do caminho e, quando o disco diz que é o mesmo
  arquivo, com outra caixa. O id de sessão que vem do ambiente só é conferido quando o fecho vai ser
  contado. Erro da apuração diz onde corrigir; fecho contado sem sessão avisa que não entrou no
  contador de nenhuma e como evitar na próxima (`--sessao <id>`).
- **Preparo da revisão.** Git que falha ao ler o `HEAD` (processo morto, objeto que não se lê) não
  passa mais por arquivo novo; repositório sem commit segue tratando tudo como novo. Arquivo maior
  que o limite no `HEAD` tem mensagem própria, sem "rode de novo". A régua do projeto é lida antes
  de criar a pasta e gravada junto com o pacote, e "nenhuma regua declarada" só aparece quando não
  há régua. Arquivo com nome começando por `--` é aceito, e `--semente ''` é erro de uso. O aviso do
  formato antigo procura o id em todas as pastas numeradas, e as mensagens de git ausente e de id
  não achado dizem o próximo passo.
- **Portão de escopo.** Link simbólico em `escopos/` cujo destino fica fora do projeto não entra na
  lista de frentes (antes a linha do objetivo do destino aparecia no aviso). Marcador `-` sozinho
  na linha não é item. Frente que não se lê diz que não se leu, com o código do erro, em vez de
  "(sem objetivo)". As mensagens do intocável e da trava 5 dizem onde a lista mora e o que a
  ampliação do escopo conta, em tom neutro.
- **Reinjeção.** O aviso do `projeto.json` diz a causa (não se lê, com o código do erro; JSON
  quebrado; não é objeto) e que `/esquadro:init` de novo o regrava com as respostas dadas. Regras
  ou plano que não se leem viram uma linha com a causa, em vez de sumir calados. Plano apontado para
  fora do projeto não se lê. Cada valor do `projeto.json` entra numa linha só, com limite de tamanho.

## 0.3.2 — mensagens que dizem o que fazer, e erro que não passa calado

Acabamento dos pontos que a revisão da 0.3.1 deixou registrados. Nenhum portão novo. Os
comportamentos novos vêm com teste; a suíte inteira roda com `npm test`.

- **Apuração da revisão.** `--sessao` sem valor, ou com caractere fora de letras, números, `_` e
  `-`, para com erro antes de contar (vale também para o id que vem do ambiente). Um `fechada.json`
  que se lê mas não é o registro do fecho (ex.: `{}`) para com erro, em vez de contar o fecho de
  novo. O arquivo de uma revisão no formato antigo é comparado sem diferença de grafia (barra
  invertida, `./` na frente). "refutados.json ilegivel" cita a base e diz o que fazer, e a leitura
  das rondas tem um tratamento só, com o próximo passo.
- **Preparo da revisão.** Git que não responde ao ler o `HEAD` (tempo esgotado, falha ao iniciar)
  para com erro e não grava nada; antes o arquivo passava por novo, com o lado antigo vazio. Falha
  ao ler o arquivo ou ao gravar o pacote diz o caminho e o que fazer, sem stack trace; a pasta de
  ronda que ficou pela metade é citada, para ser apagada. `--arquivo` ou `--semente` sem valor é
  erro de uso. O aviso do formato antigo diz para onde mover as pastas: `revisao/<id>/`, com o id.
- **Portão de escopo.** As mensagens dizem o que é a marcha (o nível de rigor que o
  `projeto.json` dá ao caminho), o que a trava 4 e a trava 5 guardam e o que é uma frente. Link
  simbólico para arquivo em `escopos/` é frente; link quebrado e pasta não são. A lista de frentes
  tira só o arquivo vinculado: em disco que diferencia caixa, `Foo.md` e `foo.md` são duas frentes.
- **Reinjeção.** Um `projeto.json` presente e ilegível (JSON quebrado, ou que não é objeto) deixa
  de sumir calado: uma linha diz que ele não se lê e o que fazer. Ausente segue como antes.

## 0.3.1 — revisão por arquivo e acabamento do escopo por frente

Pendências achadas na revisão da 0.3.0 e no uso dela. Nenhum portão novo. Os comportamentos novos
vêm com teste; a suíte inteira roda com `npm test`.

- **Revisão cega, uma base por arquivo.** O `preparar-revisao.js` grava em
  `.claude/esquadro/revisao/<arquivo>/<n>/`, e o `apurar-ronda.js --arquivo <caminho>` apura a base
  daquele arquivo: vários arquivos revisados juntos deixam de se misturar como rondas de uma revisão
  só. Sem `--arquivo`, uma base única é achada sozinha; com mais de uma, o script para e lista os
  arquivos. Revisão em andamento no formato de antes (pasta numerada solta em `revisao/`) segue
  nele até acabar, com aviso.
- **Fecho contado uma vez.** Revisão fechada grava `fechada.json` na base; rodar o apurar de novo não
  conta o fecho outra vez, e a saída diz que já foi contado.
- **Apuração que não cala.** Erro que antes passava em silêncio agora para com o que fazer:
  `--arquivo` sem valor, arquivo sem base quando só há revisão de outro, `fechada.json` ilegível,
  falha ao gravar o fecho, e erro de leitura que não é "nao existe".
- **Arquivo só de lógica.** O `/esquadro:revisar` dispensa a lente `design` em arquivo que não é de
  estilo e não monta tela: as de código sem ela. Na dúvida, todas as de código.
- **Escopo por frente.** O aviso de vínculo diz o que fazer se a tarefa mudou; a lista de frentes da
  abertura não repete a vinculada e some quando fica vazia; uma pasta chamada `x.md` em `escopos/`
  não é frente; a reinjeção cita a frente pelo nome do arquivo que vale.
- **Sessão sem interação.** O README explica que em `claude -p` o Claude Code nega escrever em
  `<projeto>/.claude/**`: o arquivo da frente tem de existir antes, e o agente lê antes de editar.

## 0.3.0 — escopo por frente

Duas frentes de trabalho no mesmo projeto deixam de disputar um `escopo.md` só. Nenhum portão novo:
muda o arquivo que o portão de escopo lê.

- **Escopo por frente.** Cada frente pode ter o seu arquivo em `.claude/esquadro/escopos/<frente>.md`,
  no mesmo formato do `escopo.md`. Editar esse arquivo vincula a sessão à frente, e a partir daí o
  portão de escopo, o de agente caro, a reinjeção das regras e o aviso de abertura leem só ele. Sem
  vínculo, vale o `escopo.md` de sempre: projeto que já usa o plugin não precisa mudar nada.
  Aposentar uma frente é mover o arquivo dela para fora da pasta. Nome de frente com caractere fora
  de letras sem acento, números, `_` e `-` é negado.
- **Abertura.** Havendo frentes na pasta, a sessão abre com a lista delas e o objetivo de cada uma,
  e com o jeito de se vincular. As mensagens de negação citam o arquivo de escopo em vigor.
- **Versão.** O `package.json` passa a ter a versão do manifesto, e um teste reprova se discordarem.

## 0.2.0 — correção dos portões

Doze defeitos achados usando o plugin num projeto real, e um achado da revisão deles. Cada correção
tem teste que reprovava antes e mutação plantada que o teste acusa. Nenhum portão novo: o que muda é
onde os de antes erravam.

- **Raiz do projeto.** Os hooks acham o projeto subindo a partir da pasta da sessão: sessão aberta
  numa subpasta passa a ler o `projeto.json`, as regras e o `escopo.md` da raiz.
- **Escopo.** Caminho com anotação depois dele (`src/** (so o modulo X)`) passa a casar; a seção
  "Fora" nega em qualquer marcha; escopo herdado de outra tarefa ganha aviso.
- **Revisão cega.** Só os achados do lado novo contam para a ronda; os do lado antigo saem listados à
  parte. Achado refutado na fonte primária vai em `refutados.json`, com prova e severidade. Arquivo
  novo vira pacote com um lado vazio. A régua do projeto vai no pacote, e o inspetor a lê.
- **Idioma de shell.** O portão olha a ferramenta: no Windows o Bash é o Git Bash, e `&&` nele não é
  idioma errado. Here-string do PowerShell não é lida como comando.
- **Comando destrutivo.** O corpo de um heredoc só deixa de ser lido quando o comando inteiro é um
  único `cat` ou `tee` com corpo inerte, texto que o bash não executa; qualquer outra coisa no comando,
  lê tudo. `-Confirm:$false` conta como forçado, como o `-f` do `rm`.
- **Contador de agentes.** Trava por sessão e gravação atômica: despachos em paralelo não perdem
  contagem.
- **Aviso de `intocaveis`.** Padrão que aponta para pasta que existe no disco, fora do git, deixa de
  ser dado como padrão que não pega nada.
- **Menores.** `experimento.js`: linha do outro manual com id repetido ganha o prefixo `outro:`, e a
  prosa sai no stderr (o stdout é JSON puro). Módulo de design: `.04em` é lido como medida.

## 0.1.0 — v1

Primeira versão. Oito travas; todo portão é um script determinístico, sem modelo no meio.

Cada trava nasceu de uma falha nomeada — mecanismo sem falha de origem é decoração, e foi por esse
critério que o que não tinha origem ficou de fora.

### Portões de custo zero, sempre ligados

- **Trava 3 — fecho sem evidência.** Bloqueia o fim do turno quando a resposta alega sucesso sem
  colar a saída. Bloqueia também quando há subitem aberto na tarefa do plano ativo.
- **Trava 4 — arquivo fora do escopo.** Bloqueia a escrita fora do `escopo.md` declarado, e o
  arquivo marcado como intocável mesmo quando o escopo o cobriria.
- **Trava 5 — comando destrutivo e sessão concorrente.** Bloqueia o comando que apaga sem volta, o
  idioma de shell errado, e a escrita em arquivo que outra frente já mexeu — contra a foto do
  `git status` tirada na abertura da sessão.
- **Trava 6 — agente caro em marcha rápida.** Bloqueia o despacho do modelo do topo quando o escopo
  só tem caminhos de marcha rápida. Conta todo despacho, inclusive os que permite.
- **Trava 7 — criar sem ter procurado.** Bloqueia arquivo novo quando nada foi buscado no turno.
  Editar existente nunca é barrado, e nomear o arquivo no `escopo.md` libera.
- **Trava 8 — catraca afrouxada.** Bloqueia a edição que sobe um teto ou desce um piso. Apertar a
  régua passa sempre. Única trava sem botão de desligar.

Módulo opcional, só com `design.json`: bloqueia cor ou medida fora do design system. Medida só se
confere em `px`, `rem` e `em`: `%` e as outras unidades passam sem conferência.

### Comandos

- **`/esquadro:init`** — varre o repositório, mostra o que inferiu e faz **seis** perguntas que
  varredura nenhuma responde; a sexta é a escada de agentes do projeto, do mais barato ao mais
  caro, com o apelido de modelo de cada degrau. Grava sempre `projeto.json` e `regras.md`, e
  registra a conferência do catálogo de modelos da instalação em `catalogo.json`. O resto é
  opcional: `design.json`, só quando há design system, e, cada um só com aprovação explícita e sem
  sobrescrever arquivo que já exista, os agentes do projeto em `.claude/agents/`, a `SKILL.md` do
  projeto e o `AGENTS.md` na raiz. Rodado de novo no mesmo projeto, reabre a configuração: pergunta
  só o que faz sentido reperguntar e mostra o que mudou antes de gravar.
- **`/esquadro:revisar`** — revisão cega A/B em lentes distintas: **nove** de código, **oito** de
  tela, e **dezessete** quando a mudança é de código e de tela. Default reprovar, apuração por
  script, teto de três rondas.
- **`/esquadro:aprender`** — correção vira regra proposta no formato `gatilho -> acao`; nada é
  gravado sem aprovação explícita.
- **`/esquadro:handoff`** — texto de continuação para um chat novo, conferido no disco.
- **`/esquadro:auditar`** — mede o peso de instrução contra o teto e aponta o que cortar:
  sobreposições, contradições e itens fora da rubrica.
- **`/esquadro:economia`** — põe o ritual obrigatório no tamanho certo: o preâmbulo sai inteiro, a
  evidência encolhe para o número que prova, e nada do ritual é removido, só reformulado.

A skill `padrao` vem junto e não é comando: é o manual de execução, que o agente carrega no começo
da tarefa. Ela absorve a skill universal que existia em separado, e declara as duas famílias de
lentes e qual delas o `revisar` despacha para cada mudança.

### O mapa de modelos que envelhece

Nenhum nome de modelo mora no plugin: os apelidos nascem no projeto, pela entrevista, e a detecção
de envelhecimento é uma escada de gatilhos. A única exceção é o agente `inspetor`, que o `revisar`
despacha, e ela está declarada no README.

- **Gatilho 1 — na instalação.** Ao terminar, o `init` confere o catálogo de modelos e registra a
  conferência. Atualizar o plugin não confere nada, e isso está dito no README.
- **Gatilho 2 — no agente principal.** A skill `padrao` compara os apelidos gravados no projeto com
  o catálogo que o harness entregou na sessão. Nunca num subagente: ele recebe a própria
  identidade, não o catálogo. O cache e o limite de frequência da consulta ficam num script que
  não abre conexão.
- **Gatilho 3 — hook.** Compara o `model:` de cada agente com o apelido gravado no `projeto.json`,
  arquivo com arquivo, offline. Avisa, deixa passar e mostra o conserto nas duas direções, porque
  não tem como saber qual dos dois lados envelheceu.
- **Apelidos vivos.** `node scripts/provar-apelidos.js` monta o roteiro, o agente principal sonda,
  e a suíte reprova quando um apelido sondado foi recusado. Sem sondagem, fica "nao provado", e
  isso não reprova. `--plugin` sonda o apelido do próprio `inspetor`.

### Ferramentas de linha de comando

- `node scripts/cobertura.js` — quais portões este ambiente verifica, quais não, e por que.
- `node scripts/cicatriz.js` — para cada regra do manual, se existe decisão, incidente ou achado
  atrás dela. Mede e propõe; podar é decisão de quem mantém o manual.
- `node scripts/plataforma.js` — em que sistemas cada trecho dependente de plataforma foi de fato
  exercitado. A matriz é varrida do código, e a suíte reprova ponto novo que ela não declare.
- `node scripts/sanitar.js` — o detector de sanitação como comando, nas três superfícies. A suíte
  reprova só pelo conteúdo; autoria e mensagem exigem o histórico do git, e ficam no comando.
- `node scripts/exportar.js` — monta, numa pasta à parte, exatamente o que iria para um repositório
  público, com a mesma lista que o detector audita, e confere quantos arquivos copiou.
- `node scripts/experimento.js` — monta a tabela de obrigações do seu manual, cruzada com a de
  outro manual passado por `--manual`, e julga o resultado gravado do experimento: o plugin bastou,
  ou ainda falta manual. O veredito sai no código de saída; só o experimento mal feito reprova a
  suíte.

### Medição

- Controle positivo **e** negativo por mecanismo, em toda a suíte. O número de testes não fica
  congelado aqui de propósito: ele muda a cada mudança e ninguém volta a um changelog para
  corrigi-lo. Quem quiser o número roda `npm test` e lê o que saiu.
- **16 baldes** de contador: 12 que negam, 4 que só contam. `node scripts/uso.js` lista os disparos.
- Detector de sanitação embutido: reprova o repositório se dado pessoal vazar, em três superfícies
  — conteúdo dos arquivos, autoria do histórico e mensagem de commit.
