# Verificação e evidência

O comando concreto que prova um pronto neste projeto está em `{{campo:provaDePronto}}`. Este arquivo
trata do que vale como prova, e de como não se enganar com o próprio instrumento.

---

## 1. O que conta como evidência

- **Fresca**: saída da rodada atual, colada na resposta. Memória de uma rodada anterior não é
  evidência.
- **Completa**: se um comando falhou, colar a falha. Silêncio sobre um teste equivale a afirmar que
  passou.
- **Declarada**: o que não rodou é listado como não rodado, com o motivo (ambiente, credencial,
  ferramenta ausente).
- **É saída, não código-fonte.** Colar o trecho do programa não prova que ele rodou. O que prova é o
  que ele imprimiu.
- **É rastro, não prosa.** "O portão me barrou" é relato do modelo. O contador gravado no arquivo, o
  exit code, a linha do log — isso é evidência. Quando der para deixar rastro em disco, preparar o
  rastro **antes** da rodada; é o que transforma relato em prova.
- **Número medido: editar, contar, gravar — nessa ordem.** Número que descreve um arquivo (linhas,
  folga de teto, contagem) se tira **depois da última edição**, nunca junto: a correção que mexe no
  arquivo invalida a medida que a acompanha. **Conte por script**, pelo método do teste, nunca por
  `wc -l` nem por `grep -c` (que conta linhas, não ocorrências). Lista dentro do próprio documento
  também se conta por script, depois de escrita.
- **Foto de página: use o protocolo de depuração (CDP), não o navegador headless pela linha de
  comando.** O headless chamado pelo shell pode devolver exit 0 antes de gravar o arquivo (o `ls`
  seguinte diz "não existe" e parece falha), ignorar a âncora da URL e não gravar página muito alta —
  medido num navegador no Windows; exit 0 não prova a foto, o arquivo aberto prova. O CDP, em
  porta própria e esperando por condição, não por tempo, tira a foto que se pediu.

**Uma linha de saída basta.** Resposta curta não é resposta sem prova: um bloco de uma linha cumpre o
portão, e é mais barato colar a prova do que consertar depois uma afirmação sem ela.

---

## 2. A regra do medidor — mutação plantada

**Todo medidor novo precisa de um controle que acuse uma mutação plantada. Sem isso, o número não
vale.**

Vale para: script de contagem, teste novo, catraca, lente que mede, grep que sustenta uma conclusão,
qualquer coisa que produza um número que vá ser usado para decidir.

O procedimento é curto:

1. Rodar o medidor no estado atual e anotar o número.
2. **Plantar de propósito** o defeito que ele deveria pegar — uma linha, num arquivo, revertida em
   seguida.
3. Rodar de novo. **O número tem de mudar, e mudar na direção certa.**
4. Reverter a mutação e confirmar que o número voltou.

Se o medidor não acusar a mutação plantada, ele não está medindo o que você acha que mede — e todo
número que ele já deu está sob suspeita, inclusive os que confirmaram o que você esperava.

**A mutação tem duas provas.** Apagar **todas** as ocorrências do que o teste vigia prova que ele
*sabe* reprovar; apagar **só a ocorrência que carrega o sentido** (o aviso, a regra, a opção) prova que
ele olha o *lugar certo*. Se a segunda sobrevive, a asserção olha o texto inteiro e se contenta com a
mesma palavra em outro ponto. É onde a sonda de localidade costuma achar a frouxidão: a fixture que dá
a ordem certa por acaso, o controle negativo de um lado só, a frase de sucesso impressa sempre.

**Teste novo escrito vermelho de propósito pode esconder o próprio falso positivo.** Ele fica vermelho
por dois motivos e o protótipo só mostra um: depois de escrever a correção, **rode o teste contra o
texto ou código certo** antes de fechar a lista dos vermelhos. Todo comentário novo que afirma uma
ordem ("X vem antes de Y") ganha uma sonda que inverte X e Y.

**Verificar o instrumento antes de acusar o instrumentado.** Quando a medição contradiz o que o
código parece fazer, o suspeito nº 1 é o medidor, não o código. Essa ordem economiza rodadas
inteiras.

**Comparar estrutura avaliada, nunca substring.** Contar ocorrências de texto para concluir sobre
comportamento é o erro de medição mais comum e mais convincente: o número sai bonito e está errado.
Usar parser, AST, API estruturada — o que o formato oferecer.

**Medição própria vence parecer**, mesmo parecer caro, mesmo marcado P0. Um parecer que afirma um
número é uma alegação sobre uma medição, não a medição.

---

## 3. Catraca não é teste comum

Catraca é um teste com baseline: ele não pergunta "está certo?", pergunta "piorou desde a última
vez?".

Quando uma catraca acusa regressão, a saída correta é **remover a causa**, nunca subir o baseline.
Subir baseline é decisão humana registrada — e o arquivo de baseline costuma estar sob edição de
outra frente, o que faz de mexer nele uma colisão quase garantida.

---

## 4. Declarar o limite antes de executar, não no fecho

Antes de prometer uma evidência no plano, conferir que ela existe:

1. **existe gerador/ferramenta para esta área?**
2. **o ambiente que ela exige está de pé?** (porta, credencial, serviço, navegador)

Se qualquer resposta for não, **dizer no plano, antes de começar**, qual portão vai rodar por leitura
de código em vez de por artefato. Descobrir isso no fecho já é tarde: o plano prometeu uma prova que
não existia, e o que sobra é escolher entre entregar sem prova ou refazer.

**Leitura de código não é consolo.** Uma lente bem instruída soma os paddings da cadeia e verifica as
propriedades relevantes — isso responde "vaza?" com aritmética. O artefato responde melhor, mas a
ausência dele não dispensa a pergunta.

**Cobertura parcial é declarada, nunca implícita.** Se a ferramenta cobre 4 das 12 áreas, dizer quais
4. "Rodei o visual" quando o gerador só existe para um terço das telas é uma afirmação verdadeira que
comunica uma falsidade.

---

## 5. Falha nova contra falha pré-existente

"Já falhava" **exige prova**, e a prova é uma destas duas:

- a saída da suíte **antes** de editar, colada; ou
- a demonstração de que os arquivos lidos pelo teste que falhou **não estão no diff**.

Sem uma das duas, "já falhava" é suposição — e é exatamente assim que uma regressão entra
despercebida, com o agente de boa-fé.

---

## 6. Proporcionalidade

Mudança que possa quebrar o produto exige teste proporcional ao risco. A tabela de portões por marcha
está em [01-marchas-e-gates.md](01-marchas-e-gates.md).

Regra que não tem exceção: **se não rodou teste, declarar explicitamente que não rodou.**
