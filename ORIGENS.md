# Origens: o que veio de fora

O sworn aprende com projetos, skills e cursos de outras pessoas. Nenhum deles é dependência: cada ideia foi reescrita
dentro do plugin, sem código copiado, e o `test/sem-terceiros.test.js` confere que nenhum pacote de terceiro entra (o
`package.json` não declara dependência e o código só importa os módulos do Node e os arquivos do próprio sworn). Este
mapa liga cada ideia à peça que a carrega e ao momento em que essa peça entra em ação, e é também o crédito a quem teve
a ideia primeiro.

- **Fonte**: o projeto, a skill ou o curso de onde a ideia veio.
- **O que veio**: a ideia, como o sworn a usa.
- **Peça**: o arquivo do sworn que a carrega (mais de um, quando a ideia se divide).
- **Gatilho**: quando a peça roda: o comando, o gancho ou a revisão.
- **Marca**: o texto que o comentário de origem da peça cita (a que começa por `R-` é a etiqueta que o radar deu à
  fonte). O `test/origens.test.js` confere que cada peça existe e que pelo menos uma delas ainda leva a marca; a peça
  renomeada, apagada ou sem a marca reprova a suíte até o mapa mudar junto.

| Fonte | O que veio | Peça | Gatilho | Marca |
|---|---|---|---|---|
| cloudflare/security-audit-skill | O achado grave de segurança só vale com a fronteira que o ataque atravessa e o plano dele; sem os dois, é reescrito e não derruba os outros achados | `scripts/lib/veredito.js` | `/sworn:review`, na contagem da lente de segurança | `cloudflare/security-audit-skill` |
| google/elephant-goldfish-model | A contestação de um achado só conta com o caminho e a linha citados e conferidos | `scripts/lib/veredito.js` | `/sworn:review`, quando um achado é contestado | `google/elephant-goldfish-model` |
| google/elephant-goldfish-model | A conferência mecânica do plano antes de codar: caminhos, símbolos e comandos que existem | `scripts/lib/plano-conferir.js` | `/sworn:review-plan`, e a rota de plano quando um plano é aberto | `google/elephant-goldfish-model` |
| google/elephant-goldfish-model (egm-drift-report) | Onde o código se afastou do plano, cruzado por script em vez de relido | `scripts/lib/drift.js` | `/sworn:drift`, e a rota de etapa ao fechar uma etapa | `egm-drift-report` |
| mattpocock/skills | A lente que julga a mudança contra o pedido da tarefa, num eixo separado do padrão de código | `scripts/lib/veredito.js`, `scripts/preparar-revisao.js` | `/sworn:review`, a lente `escopo` | `mattpocock/skills` |
| mattpocock/skills | "Achei a causa" só com o defeito reproduzido | `scripts/lib/evidencia.js` | Fim do turno, no portão de fecho | `R-mattpocock` |
| mattpocock/skills | O segredo no texto do handoff nega a gravação, antes de qualquer passe livre | `scripts/portao-escopo.js` | Antes de gravar em `.sworn/handoff/` | `mattpocock/skills` |
| obra/superpowers | O diagnóstico de sessão com um analista por dimensão, e só o achado de citação conferida | `scripts/lib/diagnostico.js`, `skills/diagnose/SKILL.md` | `/sworn:diagnose`, e a rota de diagnóstico | `obra/superpowers` |
| obra/superpowers | Cada decisão autônoma numa linha, com o custo se errado, contada no fim do turno | `scripts/lib/continuo.js`, `scripts/portao-fecho.js` | Fim do turno | `R-superpowers` |
| pbakaus/impeccable | A revisão sem isolamento leva a marca DEGRADADO até a resposta que diz pronto | `scripts/preparar-revisao.js`, `scripts/apurar-ronda.js`, `scripts/portao-fecho.js` | `/sworn:review --degradado`, e o fim do turno | `R-impeccable` |
| pbakaus/impeccable | A cor comparada já convertida: a mesma cor escrita de jeitos diferentes é a mesma | `scripts/lib/design.js` | Edição de estilo e foto da tela | `impeccable` |
| akitaonrails/ai-memory | O handoff relido depois da compactação é dado escrito antes, não ganha da instrução de agora | `scripts/lib/reinjecao.js` | Abertura depois da compactação | `R-ai-memory` |
| deepseek-ai/dsh-superagent-prototype | As quatro classes em que cabe parar e perguntar ao dono do projeto, conferidas nesta ordem: credencial ou segurança, publicar ou enviar para fora, aparência, regra de negócio | `scripts/lib/continuo.js` | Fim do turno que para e pede ao dono do projeto | `R-dsh` |
| nextlevelbuilder/ui-ux-pro-max-skill | O `design.json` como sistema mestre, e o desvio declarado por tela | `scripts/lib/design.js` | Edição de estilo, e as lentes de tela na revisão | `ui-ux-pro-max-skill` |
| Nutlope/hallmark | O inventário do que a tela liga, antes e depois da mudança | `scripts/lib/inventario-tela.js` | `/sworn:review` de uma tela que já existia | `R-hallmark` |
| affaan-m/ECC | Os perfis de instalação: mínimo, padrão e estrito | `scripts/lib/projeto.js` | Leitura do `projeto.json`, e o `/sworn:init` | `R-ECC` |
| vercel-labs/agent-browser | Só termo de comparação: a captura de tela do sworn é própria, pelo protocolo de depuração do Chrome | `scripts/lib/captura.js`, `test/sem-terceiros.test.js` | Foto da tela na revisão, e a suíte | `agent-browser` |
| storytold/craft-anything | A tela conferida contra a referência, largura por largura, com o que não se comparou listado à parte | `scripts/lib/conferencia-tela.js` | `scripts/conferir-tela.js`; o fim do turno trava a última conferência que não comparou tudo | `craft-anything` |
| storytold/craft-anything | A cobertura de cada camada da referência estudada, desconhecida até prova em contrário | `scripts/lib/referencia.js` | `/sworn:reference` | `craft-anything` |
| storytold/craft-anything | Os blocos do layout lidos na página | `scripts/lib/captura.js` | Foto da tela | `craft-anything` |
| Playwright MCP | O texto da página marcado como dado, o diálogo fechado e a rede assentada antes da foto | `scripts/lib/captura.js`, `scripts/capturar-tela.js` | Foto da tela | `Playwright MCP` |
| Playwright MCP | As ações por passos antes da foto | `scripts/lib/roteiro.js` | `scripts/capturar-tela.js --passos` | `Playwright MCP` |
| Playwright MCP | A árvore de acessibilidade comparada por largura | `scripts/lib/conferencia-tela.js` | `scripts/conferir-tela.js` | `Playwright MCP` |
| ChromeDevTools/chrome-devtools-mcp | O aviso de que a sessão roda uma versão do plugin diferente da instalada | `scripts/lib/versao-carregada.js` | Abertura da sessão | `ChromeDevTools/chrome-devtools-mcp` |
| Donchitos (radar de 2026-11-23) | O arquivo que o briefing pediu ao subagente e não existe vira cobrança | `scripts/lib/entrega-pedida.js` | Fim do subagente, e o fim do turno de quem o despachou | `Donchitos` |
| nizos/tdd-guard | O teste visto vermelho antes do verde, sem modelo | `scripts/lib/vermelho-antes.js` | Edição de teste, e o fim do turno | `nizos/tdd-guard` |
| emilkowalski/skills (MIT) | O roteiro de construção de tela: estados, foco, movimento | `skills/design/SKILL.md` | A rota de tela, na primeira edição de marcação ou estilo | `emilkowalski` |
| Cursos Claude Code 101 e Claude Code in action | Perguntas das lentes da revisão: o teste afrouxado para passar e a regressão que não se testou | `scripts/lib/veredito.js` | `/sworn:review` | `Claude Code 101` |
| Curso Introduction to agent skills | A descrição de skill curta, com teto declarado, na rubrica | `scripts/lib/rubrica.js` | `/sworn:audit` e `/sworn:init` | `Introduction to agent skills` |
| Curso Introduction to MCP | Os servidores MCP de fora do `.mcp.json` no inventário do ambiente | `scripts/lib/ambiente.js` | `/sworn:init` e `/sworn:audit` | `Introduction to MCP` |
| Curso AI-native SDLC | Os requisitos numerados do plano, cada um com a sua prova | `scripts/lib/plano-conferir.js` | `/sworn:review-plan` | `AI-native SDLC` |

## Estudado e recusado

- **anthropics/claude-code-security-review**: as exclusões fixas da revisão de segurança (o que ela nunca reporta)
  foram medidas contra os achados da lente de segurança do sworn e ficaram de fora. Elas descartam a negação de serviço
  e o laço ou a leitura sem teto, e num plugin de ganchos o que trava o turno é dano: dos 723 achados da lente, 135
  caíam nessas exclusões e 62 deles se confirmaram, alguns graves.

O radar guarda, fora do repositório público, o resto do que estudou e descartou. Uma peça nova que vier de fora ganha
a sua linha aqui, com a marca no comentário de origem dela.
