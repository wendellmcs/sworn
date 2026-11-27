# A apresentação do sworn

A página `index.html` desta pasta é a apresentação do sworn, servida pelo GitHub Pages em
<https://wendellmcs.github.io/sworn/apresentacao/>. Ela é **montada**, nunca editada à mão: o
`scripts/apresentacao.js` junta a fonte (`fonte/deck.json`, `fonte/deck.css` e `fonte/slides/`), a versão do
`.claude-plugin/plugin.json` e as novidades do topo do `CHANGELOG.md`.

## A cada versão publicada (só quem mantém o plugin)

1. Ponha as novidades da versão nos slides certos de `fonte/slides/` (o que é ganho, função ou melhoria; o que foi
   medido e não deu ganho não entra).
2. Em `fonte/deck.json`, suba o `"versao"` para a versão do `plugin.json` e ponha em dia os dois números do slide da
   história: `"pedidos"` (o maior número do registro de pedidos do dono até a data da decisão da versão) e
   `"decisoes"` (a posição dessa decisão no registro de decisões). Os dois registros não vão ao repositório público,
   então o script não conta esses números sozinho; no repositório de quem mantém, o teste diz os dois valores certos.
3. Rode `node scripts/apresentacao.js --gravar`.

O slide "O que há de novo" e o número de versões se refazem sozinhos a partir do CHANGELOG e do `plugin.json`.
O `test/apresentacao.test.js` reprova quando a página não é a que a fonte monta hoje, quando o `"versao"` do deck
ficou para trás do `plugin.json`, ou, onde os registros existem, quando `"pedidos"` e `"decisoes"` não batem com eles:
sem os passos 2 e 3, a suíte não passa e a versão não sai. Nenhum teste confere o passo 1: ele fica com quem publica.

## Outros comandos

- `node scripts/apresentacao.js` só confere: sai 0 com a página em dia e 1 com ela velha.
- `node scripts/apresentacao.js --slides <pasta>` grava cada slide já resolvido numa pasta, para medir ou publicar
  em outro lugar.

O `.nojekyll` da raiz do repositório impede o Jekyll do Pages de ler as marcas `{{...}}` das skills.
