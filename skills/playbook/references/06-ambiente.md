# Ambiente — as armadilhas que custam sessão inteira

Nada aqui é teoria. São modos de falha que **já consumiram rodadas de trabalho**, e todos têm a mesma
assinatura: o comando parece ter funcionado, e o estrago aparece depois.

A plataforma deste projeto está em `{{campo:plataforma}}`.

---

## 1. Script vai por arquivo, não por heredoc

**A barra invertida e a crase somem no heredoc de ferramenta de shell.** Escrever um script inline com
`<<'EOF'` corrompe silenciosamente toda regex com `\d`, `\s`, `\.`, todo caminho do Windows, e toda
crase. A quebra de linha também se perde.

**Regra:** script de sonda, de medição ou de conserto é **escrito com a ferramenta de escrita de
arquivo** e rodado por interpretador (`node arquivo.js`, `python arquivo.py`). Nunca colado inline.

Isto aconteceu duas vezes no mesmo dia antes de virar regra. O sintoma é cruel: o script roda, não dá
erro, e devolve um número errado — que é exatamente o caso que a regra do medidor em
[04-verificacao.md](04-verificacao.md) existe para pegar.

**Ferramentas chamadas no mesmo turno rodam em paralelo.** Enviar ou anexar um arquivo e regenerar a
pasta de onde ele sai no mesmo turno falha **em silêncio** — o envio não acha o arquivo, e a pergunta
que saiu junto já afirmava a entrega. Envie num turno, pergunte no seguinte, depois de ver a
confirmação; se precisar regenerar, escreva em outra pasta e mantenha a original até o envio confirmar.

---

## 2. Encoding em hook e em saída de processo

**Saída de PowerShell num pipe não é UTF-8 por padrão** em Windows localizado — sai na página de
código do sistema (CP850 em pt-BR), e todo acento chega ao consumidor como byte inválido.

Todo hook ou comando que imprima texto acentuado precisa forçar antes:

```
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
```

E, ao ler arquivo, passar o encoding explicitamente em vez de confiar no default:
`Get-Content -Raw -Encoding utf8`.

**`Set-Content` e `Add-Content` gravam na página ANSI do sistema por padrão.** Ao escrever arquivo que
outra ferramenta vai ler, passar `-Encoding utf8` sempre.

---

## 3. Script executável em ASCII puro

Arquivo `.ps1`, `.bat` e `.cmd`: **só ASCII**. Acento em script executável é a classe de bug mais
chata de diagnosticar, porque o erro aparece longe da causa e às vezes só numa máquina.

Mensagem para humano vai em arquivo de dados (`.md`, `.json`) lido pelo script — não embutida nele.

---

## 4. Shell tem gramática, e o comando não é o que parece

Ao decidir alguma coisa lendo uma linha de comando (portão, filtro, log):

- **variável de ambiente não distingue caixa** no Windows;
- caminho com espaço precisa de aspas, e URI de caminho com espaço precisa de escape;
- o mesmo comando tem apelidos, formas longas e curtas, e introdutores que mudam o resto da linha;
- **comando citado dentro de uma string não é comando executado** — `git commit -m "removi o rm -rf"`
  não apaga nada.

Se o objetivo for barrar comando perigoso, aceitar que a leitura é aproximada, **declarar o falso
positivo** que ela produz, e preferir errar barrando.

**Comando que lista o ambiente vaza segredo.** `export`, `env`, `set` e `printenv` sem argumento
imprimem toda variável — inclusive o token que o ambiente carrega — na transcrição. Para tirar uma
variável, `unset NOME`; para passá-la só a um comando, `VAR=x comando`. **Se vazar, diga na mesma
resposta e recomende revogar o token.**

**O código de saída de um comando encanado é o do último elo.** `suite | tail -40` devolve 0 com a
suíte reprovada: a prova é o exit code do comando sozinho, ou o resumo que ele imprime. A ordem do
redirecionamento também conta: `cmd 2>&1 > arquivo` manda o erro para o terminal, e
`cmd > arquivo 2>&1` manda para o arquivo.

**O shell do Git para Windows falha de vez em quando antes de o comando rodar** (erro de `fork`, exit
5). Não é erro do comando nem da sintaxe: **repetir o mesmo comando resolve**. Reescrevê-lo achando que
a sintaxe está errada é tempo perdido.

**O `bash` do `PATH` do PowerShell pode ser o do WSL, não o Git Bash.** Provar que "o bash executa isto"
exige o mesmo bash que a ferramenta usa: conferir que o caminho existe, olhar o `error` e o `status` do
processo, e incluir um caso que **tem de** executar (controle positivo) — sem ele, "nenhum caso rodou"
parece resultado e é só o instrumento. O código do plugin já trata isso (`scripts/lib/shell.js`); aqui
está o porquê.

**Caminho curto do Windows (`NOME~1`, formato 8.3) quebra o que o nega.** Diretório temporário ou de
usuário pode vir nessa forma; `import.meta.url` a devolve com o til codificado, e derivar o diretório
do script pelo `pathname` dessa URL dá `ENOENT` num lugar que existe. Ferramentas de agente também
negam a leitura de um caminho assim por suspeita. **Resolva o caminho real** (`fs.realpathSync.native`)
antes de usá-lo.

---

## 5. Índice do git, CRLF e arquivo fantasma

Com `core.autocrlf=true`, o índice pode divergir do disco sem nenhuma edição real: `git status`
mostra arquivo modificado cujo diff é vazio.

- `git update-index --refresh` e `--really-refresh` **não** consertam.
- `git add --renormalize .` conserta, mas **põe todos os arquivos reais em staged** — e numa árvore
  com trabalho de outra sessão isso é exatamente a colisão que o Passo -1 proíbe.
- **A saída correta é cirúrgica:**

```
git add --renormalize -- <apenas os arquivos fantasma>
```

Mexe no índice, não no disco, e nada fica staged.

**Ferramenta de escrita e `sed -i` mexem no arquivo além do que você pediu.** O `sed -i` regrava o
arquivo inteiro em LF, destruindo o CRLF de um arquivo CRLF, e lê barra-u na substituição como
"maiúscula no próximo caractere". Write e Edit **convertem o escape de acento digitado em caractere
real** (e, em arquivo que já usa escapes, o inverso). Para arquivo com escapes ou com CRLF, edite por
script Node com `replace` exato e confira depois. **Conte o CR por Node** (os bytes 13 do `Buffer`),
antes e depois: o `grep -c` de CR mentiu, dando 0 num arquivo com centenas.

---

## 6. Repositórios aninhados

`git status` de um diretório **não enxerga** repositório aninhado que tenha o próprio `.git`. Um
workspace pode ter três repos independentes e um status limpo na raiz enquanto dois deles têm trabalho
não commitado.

Rodar em cada repo que a tarefa toca. Listar os três estados separadamente, no começo e no fecho.

---

## 7. Skills e configuração não sobem de diretório

Um `settings.json` pode ler um arquivo do diretório pai por caminho relativo. **Uma skill não.** Ela é
resolvida no diretório do projeto ou no diretório do usuário — e em mais lugar nenhum.

Consequência prática: um lembrete injetado por hook pode mandar carregar uma skill que, naquele
diretório, **não existe** — e o agente obedece a instrução, não acha o arquivo, e segue sem dizer.
Skill que precisa valer em vários projetos mora no **diretório do usuário**.

O mesmo vale para output style.

**O campo `skills:` no frontmatter de um agente injeta só o corpo do `SKILL.md`.** Os arquivos de
`references/` não vêm junto: o agente que depende de rubrica, tabela de valores ou checklist longo
continua precisando de uma ferramenta de leitura. E agente ou skill criado ou editado agora **só
existe em sessão nova** — o registro é lido na abertura, e a conversa em curso não o enxerga.

---

## 8. Provar hook sem terminal interativo

O modo não interativo (`-p` / print) **executa os hooks normalmente**, inclusive os de abertura e
fecho de sessão. Dá para provar um hook por agente, sem a mão do dono.

```
( cd <pasta descartavel, fora de qualquer repositorio>
  mkdir -p <pasta de estado que o hook usa>
  claude -p "<pedido>" --plugin-dir "<caminho>" --permission-mode acceptEdits
  cat <pasta de estado>/<arquivo de contador> )
```

`--permission-mode acceptEdits` é necessário: sem ele o pedido que cria arquivo trava pedindo
permissão e a rodada nunca chega ao fecho.

**A prova é o rastro em disco, nunca a prosa do modelo.** O modelo dizer "o portão me barrou" é
relato; o contador gravado no arquivo é evidência. **Criar a pasta de estado antes da rodada** é o que
transforma um no outro.

---

## 9. Rede que reassina o HTTPS

Rede corporativa com inspeção de TLS entrega todo HTTPS assinado por uma raiz da própria empresa. O
sistema operacional confia nela; **programa que traz a sua própria lista de certificados, não** — e a
falha parece de rede (`Transport error`, `unable to verify the first certificate`), não de certificado.

**No Node, `node --use-system-ca` usa a lista do sistema**; a alternativa é apontar
`NODE_EXTRA_CA_CERTS` para um `.pem` da raiz, que serve também a ferramentas de linha de comando
empacotadas em Node. A variável só vale no processo em que foi definida: janela nova a perde. O
`curl` do Windows pode falhar na checagem de revogação com a raiz reassinada, e `--ssl-no-revoke` passa.

Para confirmar a causa, conecte com a verificação desligada **só para imprimir o emissor da cadeia**:
se não for uma autoridade pública, é reassinatura. **Desligar a verificação não é o conserto.** E passo
do dono que depende de variável de ambiente vira script que mostra o estado (imprime que a variável
existe) antes de seguir.
