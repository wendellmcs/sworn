---
name: shortcuts
description: Lista os atalhos deliberados do repositório - comentários com a marca atalho: (ou ponytail:, shortcut:) que dizem o que foi simplificado, até onde vale e quando trocar - e aponta os que não têm gatilho de troca. Use quando quiser saber que dívida de simplificação o código carrega, antes de um release ou quando o dono perguntar.
---

# `/sworn:shortcuts` — o que foi simplificado de propósito

Atalho deliberado é bom enquanto alguém lembra dele. O bloco "menos código" pede que todo atalho
leve um comentário com três rótulos, e esta skill junta esses comentários numa lista só, para a
dívida não ficar esquecida no meio do código.

O comentário, numa linha, depois de `//`, `#`, `--`, `/*` ou `<!--`:
`// atalho: <o que foi simplificado>. limite: <até onde vale>. trocar quando: <gatilho>.`

"limite:" e "trocar quando:" são rótulos, não vírgulas: uma vírgula dentro da frase não quebra a
leitura. Sem rótulo nenhum, o texto inteiro vira o "o que" e o atalho sai como `sem-gatilho`.

## Passo 1 — listar

    node "${CLAUDE_PLUGIN_ROOT}/scripts/atalhos.js"

Rode na pasta do repositório. O script só lê: varre os arquivos que o git rastreia e os novos que ele
não ignora (o que o `.gitignore` cobre, `.git` e `node_modules` ficam fora), pula binário e arquivo
acima de 1 MB, e não muda nada. Fora de um repositório git ele diz por que e sai com código 1.

A marca padrão é `atalho`; `ponytail` e `shortcut` também contam, para quem já usa. Outra marca vai
na chave `marcaDeAtalho` do `.claude/sworn/projeto.json` (uma palavra só), e então ela substitui
`atalho`.

## Passo 2 — mostrar

Mostre a saída inteira, como veio: o painel já vem agrupado por arquivo, com a linha de cada atalho,
o resumo e, quando há atalho sem gatilho, o conselho de escrever o "trocar quando:".

- **Atalho sem gatilho** é o que importa apontar: sem gatilho, ninguém sabe quando trocar. Proponha
  o gatilho em uma linha por atalho, lendo o código em volta; **não edite o comentário** sem o dono
  pedir.
- **"Nenhum atalho registrado."** não quer dizer código sem atalho: quer dizer que nenhum foi
  marcado. A linha de baixo diz em quantos arquivos o script procurou.

## Sozinha, a cada 30 dias

Na abertura da sessão, num projeto com `projeto.json`, o sworn mostra a lista completa (com e sem
gatilho) no máximo uma vez a cada 30 dias, com a ordem de conferir se algum "trocar quando" já
aconteceu e, se aconteceu, levar ao dono em 3 opções. Varre a pasta aberta e os repositórios logo
abaixo dela (um workspace que guarda os projetos em repositórios próprios não fica de fora); lista até
10 atalhos, e o resto fica para esta skill. Sem atalho, nada sai. A data fica em
`.claude/sworn/atalhos-revisao.json`; o prazo muda em `limiares.diasEntreAtalhos`, e
`"atalhosNaAbertura": false` desliga. Quando um atalho aparecer ali, rode esta skill para o detalhe.

## O que esta skill NÃO faz

- **Não acha atalho sem marca.** Ela lê comentário, não código: simplificação sem o comentário não
  aparece. Achar código que não precisava existir é trabalho da revisão (`/sworn:review`).
- **Não lê comentário de várias linhas.** O atalho tem de caber na linha da marca.
- **Não julga se o atalho ainda vale.** Ela mostra o gatilho; quem confere se ele já disparou é você,
  lendo o código, e quem decide trocar é o dono.
