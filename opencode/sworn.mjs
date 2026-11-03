// Pedido 6, Etapa 3 (D755): o sworn no OpenCode. O OpenCode nao roda gancho por comando, so plugin no processo dele.
// Este plugin leva cada gancho a ponte.js (o lib/harness.js normaliza; o portao de hoje roda num node a parte) e
// aplica a decisao do jeito do OpenCode, como a sonda da s271 mostrou:
// - negar (PreToolUse): throw com o motivo, que o modelo recebe como erro da ferramenta;
// - contexto da abertura e do turno: no sistema (experimental.chat.system.transform), a cada chamada ao modelo; a
//   abertura roda uma vez por sessao e fica guardada aqui;
// - contexto do pos-ferramenta: no fim da saida da ferramenta;
// - segurar (prompt): throw no chat.message (a provar na Etapa 5);
// - bloquear (Stop): o OpenCode nao tem fim de turno que segure; no session.idle da sessao de topo o motivo volta
//   como prompt novo (com o servidor vivo; no `opencode run` sozinho o reenvio nao chega);
// - aviso (systemMessage): sem canal ao usuario aqui (vai a matriz).
// Falha da ponte ou do client do OpenCode libera (R6) e fica dita no stderr, como no ponte.js. O .opencode/plugins/sworn.js do projeto,
// gravado pelo instalar.js, so reexporta o SwornPlugin: o OpenCode chama como plugin cada funcao que o arquivo
// carregado exporta.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ponte = require('../scripts/ponte.js');
const harnessLib = require('../scripts/lib/harness.js');
const { comandoDoInstalar } = require('../scripts/instalar.js');

// R1 s294: a falha calada some uma sessao inteira (o EPERM do dsh na s283); dita, o usuario ve o portao que nao rodou.
// s296 (D763): diz o que fazer, e o erro sem message (texto lancado, objeto do SDK) sai inteiro, nunca "(undefined)".
const SEM_PORTAO = 'o gancho seguiu sem o portao. Para ver o que roda: ' +
  comandoDoInstalar(fileURLToPath(new URL('..', import.meta.url)), '--conferir opencode');
function motivo(e) {
  if (e && e.message) return e.message;
  try { return (e && typeof e === 'object' && JSON.stringify(e)) || String(e); } catch (x) { return 'erro sem texto'; }
}
const dizer = (onde, e, efeito = SEM_PORTAO) => process.stderr.write('sworn: ' + onde + ' falhou (' + motivo(e) +
  '); ' + efeito + '\n');

/**
 * O plugin com a ponte dada (`rodar(harness, script, entrada)` -> stdout da ponte); o teste troca a ponte e a leitura
 * do hooks.json.
 */
export function criar(rodar, lerGanchos = ponte.lerGanchos) {
  return async function ({ client, directory }) {
    let ganchos = {};
    try { ganchos = lerGanchos(); } catch (e) { dizer('o hooks/hooks.json do sworn', e); }
    const scripts = {};
    for (const [gancho, eventos] of Object.entries(harnessLib.EVENTOS.opencode)) {
      scripts[gancho] = [];
      for (const ev of eventos) {
        for (const s of ponte.scriptsDe(ganchos, ev)) if (!scripts[gancho].includes(s)) scripts[gancho].push(s);
      }
    }
    // A decisao junta; `falhou` diz se algum script falhou (a abertura nao guarda o resultado da falha).
    const decidir = (gancho, bruta) => {
      const decisoes = [];
      let falhou = false;
      for (const script of scripts[gancho] || []) {
        try {
          const saida = rodar('opencode', script, Object.assign({ hook_event_name: gancho, cwd: directory }, bruta));
          if (saida) decisoes.push(JSON.parse(saida));
        } catch (e) { falhou = true; dizer('a ponte no ' + script, e); }
      }
      return Object.assign(decisoes.length ? harnessLib.juntar(decisoes) : {}, falhou ? { falhou } : {});
    };
    const abertura = new Map();
    const turno = new Map();

    return {
      'experimental.chat.system.transform': async (input, output) => {
        const id = input && input.sessionID;
        // s296 (D763): sem sessao (o Agent.generate do OpenCode 1.18.15, fora da conversa) nada roda nem se guarda.
        if (!id) return;
        let inicio = abertura.get(id);
        if (!abertura.has(id)) {
          const d = decidir('experimental.chat.system.transform', { input });
          inicio = d.contexto;
          // s296 (D763): a abertura que falhou nao se guarda: a chamada seguinte ao modelo tenta de novo.
          if (!d.falhou) abertura.set(id, inicio);
        }
        if (!output || !Array.isArray(output.system)) return;
        for (const t of [inicio, turno.get(id)]) if (t) output.system.push(t);
      },
      'chat.message': async (input, output) => {
        const d = decidir('chat.message', { input, output });
        turno.set(input && input.sessionID, d.contexto);
        if (d.segurar !== undefined) throw new Error(d.segurar);
      },
      'tool.execute.before': async (input, output) => {
        const d = decidir('tool.execute.before', { tool_name: input && input.tool, input, output });
        if (d.negar !== undefined) throw new Error(d.negar);
      },
      'tool.execute.after': async (input, output) => {
        const d = decidir('tool.execute.after', { tool_name: input && input.tool, input, output });
        if (!d.contexto || !output) return;
        // R1 s294: ferramenta sem saida recebe so o contexto (o String() punha "undefined" na frente).
        output.output = output.output == null ? d.contexto : String(output.output) + '\n\n' + d.contexto;
      },
      event: async ({ event }) => {
        if (event && event.type === 'session.deleted') {
          const apagada = event.properties && event.properties.info && event.properties.info.id;
          abertura.delete(apagada);
          turno.delete(apagada);
          return;
        }
        if (!event || event.type !== 'session.idle') return;
        const id = event.properties && event.properties.sessionID;
        let s;
        try {
          s = await client.session.get({ path: { id } });
          // O SDK devolve o erro HTTP em `error`, sem lancar.
          if (!s || !s.data) throw new Error(s && s.error ? JSON.stringify(s.error) : 'sem resposta');
        } catch (e) { dizer('a consulta da sessao (session.get)', e); return; }
        if (s.data.parentID) return;
        const d = decidir('session.idle', { properties: event.properties });
        if (d.bloquear === undefined) return;
        try {
          await client.session.prompt({ path: { id }, body: { parts: [{ type: 'text', text: d.bloquear }] } });
        } catch (e) {
          dizer('o reenvio do motivo do fecho', e, 'o portao de fecho barrou, mas o motivo nao chegou ao modelo. ' +
            'Mande-o na conversa: ' + d.bloquear);
        }
      }
    };
  };
}

export const SwornPlugin = criar(ponte.rodar);
