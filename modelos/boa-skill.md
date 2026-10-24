# O que é uma boa skill de projeto

Referência lida por `/sworn:init` antes de preencher o molde, e por `/sworn:learn` antes de
propor regra. **Critério sem falha de origem é decoração e não entra nesta lista.**

| # | Critério | Falha de origem |
|---|---|---|
| 1 | **`gatilho → ação`, nunca proibição solta.** "Não faça hardening" não tem âncora e só se ativa se eu lembrar dela; "ao encontrar problema de segurança fora do escopo → registrar e avisar" é convocada pela própria ação | aderência que cai com o contexto |
| 2 | **Valor executável mora em arquivo e é citado por nome, nunca copiado.** Comando, versão, flag e preço mudam; nome de campo não | compactação que perde a literalidade; conhecimento com data de corte |
| 3 | **A descrição diz QUANDO usar, não o que a skill faz.** É a única linha que decide se ela é invocada | aderência que cai com o contexto |
| 4 | **Nomeia a referência.** Token literal e tela irmã já aprovada, jamais "deixe bonito" — veredito estético sem referência é infalsificável e sobrevive a qualquer revisão | estética julgada sem referência |
| 5 | **Anti-referência explícita.** Dizer o que a coisa **não** pode parecer é verificável; dizer o que ela deve parecer, não é | estética julgada sem referência |
| 6 | **Seção própria para o que NÃO se promete.** Dito agora, não descoberto no fim | decisão escondida numa muralha de texto |
| 7 | **Declara se é canônico, derivado ou histórico.** Documento velho sem carimbo é obedecido como lei viva | o que se lê vira o que se obedece |
| 8 | **Cada regra traz a dor de origem ao lado.** Regra sem cicatriz é opinião, e opinião não sobrevive à discordância | princípio do projeto |
| 9 | **Verificável.** "Seja claro" não é critério; "formato de fecho fixo com quatro partes" é | decisão escondida numa muralha de texto |
| 10 | **Curta, com teto declarado.** Cada instrução compete por atenção com todas as outras | aderência que cai com o contexto |
| 11 | **Não repete o que um portão já cobra.** Duplicação é peso morto que acelera exatamente a doença que o harness veio curar | aderência que cai com o contexto |
| 12 | **Decisão do dono em 3 opções, a recomendada marcada, com consequência e custo** | decisão escondida numa muralha de texto |

## Como reconhecer uma skill ruim, em cinco segundos

- Começa com "sempre" ou "nunca" e não diz **quando**.
- Repete um número que também está num arquivo de configuração.
- Tem elogio, missão ou valor de marca.
- Diz "use bom senso".
- Cresceu por acumulação: ninguém nunca tirou nada dela.

## O teste final

Leia a skill e pergunte: **o que exatamente eu faria diferente amanhã por causa desta linha?**
Se a resposta for "nada de concreto", a linha sai.
