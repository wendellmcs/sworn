'use strict';
// D449/D451 (0.6.2): o workflow pronto /sworn:parallel. O runtime do Claude Code roda o script com
// agent/parallel/phase/log/args globais; aqui o corpo roda com dubles deles, para provar o freio de custo
// (teto, modelo barato, isolamento de quem edita) sem gastar um agente.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ARQ = path.join(__dirname, '..', 'workflows', 'parallel.js');
const texto = () => fs.readFileSync(ARQ, 'utf8');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// Roda o corpo do script como o runtime: `export const meta` vira `const meta`, `return` no topo vale.
async function rodar(args, responde) {
  const chamadas = [];
  const logs = [];
  const fases = [];
  const corpo = texto().replace(/^export const meta =/m, 'const meta =');
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', corpo);
  const agent = async (prompt, opts) => {
    chamadas.push({ prompt, opts });
    return responde ? responde(prompt, opts, chamadas.length) : { feito: true, resumo: 'ok', evidencia: 'x' };
  };
  const parallel = async (thunks) => Promise.all(thunks.map((t) => t().catch(() => null)));
  const r = await fn(agent, parallel, null, (f) => fases.push(f), (m) => logs.push(m), args,
    { total: null, spent: () => 0, remaining: () => Infinity });
  return { r, chamadas, logs, fases };
}

test('paralelo: meta e literal puro com name, description e a fase que o corpo usa', () => {
  const t = texto();
  assert.ok(t.startsWith('export const meta = {'), 'o script tem de comecar pelo meta');
  const meta = t.slice(0, t.indexOf('\n}\n') + 2);
  assert.ok(!/\$\{|\.\.\.|\b[a-z]+\(/i.test(meta.replace(/'[^']*'/g, "''")), 'meta tem de ser literal puro: ' + meta);
  assert.ok(/^  name: 'parallel',$/m.test(meta), 'name parallel -> /sworn:parallel');
  assert.ok(/^  description: '[^']+',$/m.test(meta));
  const titulos = Array.from(meta.matchAll(/title: '([^']+)'/g)).map((m) => m[1]);
  const usados = Array.from(t.matchAll(/\bphase\('([^']+)'\)/g)).map((m) => m[1]);
  assert.deepStrictEqual(usados.filter((u) => titulos.indexOf(u) === -1), [], 'phase() sem entrada no meta');
});

test('paralelo: o script nao usa o que o runtime proibe (relogio, acaso, modulo, disco)', () => {
  const t = texto();
  for (const re of [/Date\.now\(/, /Math\.random\(/, /new Date\(\)/, /\bimport\s*\(/, /\brequire\(/, /\bprocess\./, /\bfs\./]) {
    assert.ok(!re.test(t), 'o script usa ' + re);
  }
});

test('paralelo: sem tarefas, para antes de gastar agente e diz como chamar', async () => {
  for (const a of [undefined, [], {}, { tarefas: [] }, 'texto solto']) {
    await assert.rejects(rodar(a), /passe args como lista de tarefas/, JSON.stringify(a));
  }
  await assert.rejects(rodar([{ tarefa: '  ' }]), /tarefa 1 sem texto/);
  await assert.rejects(rodar([{ tarefa: 'a', modelo: 'fable' }]), /modelo "fable" fora de haiku\/sonnet\/opus/);
  await assert.rejects(rodar([{ tarefa: 'a', esforco: 'max' }]), /esforco "max" fora/);
  await assert.rejects(rodar({ tarefas: ['a'], teto: 0 }), /teto tem de ser inteiro/);
  // revisao cega da 0.6.2: "true" em texto rodava como leitura, em haiku e sem copia isolada, calado
  for (const v of ['true', 1, 'sim', null]) {
    await assert.rejects(rodar([{ tarefa: 'a', edita: v }]), /tarefa 1: edita .* tem de ser true ou false/, JSON.stringify(v));
  }
  // ronda 2: chave com nome errado era ignorada calada ("edit": true rodava sem copia isolada)
  await assert.rejects(rodar([{ tarefa: 'a', edit: true }]), /tarefa 1: chave "edit" desconhecida/);
  await assert.rejects(rodar([{ tarefa: 'a', model: 'opus' }]), /chave "model" desconhecida; as chaves sao tarefa, edita, modelo, esforco/);
  const ok = await rodar([{ tarefa: 'a', edita: false }]);
  assert.strictEqual(ok.chamadas[0].opts.model, 'haiku');
});

test('paralelo: modelo barato por padrao (haiku le, sonnet edita) e worktree so para quem edita', async () => {
  const { chamadas } = await rodar([
    'ler o modulo A',
    { tarefa: 'corrigir B', edita: true },
    { tarefa: 'ler C com mais fundo', modelo: 'opus', esforco: 'high' },
  ]);
  assert.strictEqual(chamadas.length, 3);
  assert.deepStrictEqual(chamadas.map((c) => c.opts.model), ['haiku', 'sonnet', 'opus']);
  assert.deepStrictEqual(chamadas.map((c) => c.opts.effort), ['medium', 'medium', 'high']);
  assert.deepStrictEqual(chamadas.map((c) => c.opts.isolation), [undefined, 'worktree', undefined]);
  assert.ok(chamadas.every((c) => c.opts.schema && c.opts.schema.required.indexOf('evidencia') !== -1), 'todo agente devolve evidencia');
  assert.ok(/ondeFicou/.test(chamadas[1].prompt) && !/ondeFicou/.test(chamadas[0].prompt), 'so quem edita diz onde ficou a copia');
  assert.ok(chamadas.every((c) => /Nao faca commit/.test(c.prompt)), 'nenhum agente commita');
  // D452: tarefa de leitura (texto solto ou edita false) nao pode editar a arvore viva, que nao tem copia isolada
  const leitura = /so de leitura: nao crie, edite nem apague arquivo/;
  assert.ok(leitura.test(chamadas[0].prompt) && leitura.test(chamadas[2].prompt), 'quem le e proibido de editar');
  assert.ok(!leitura.test(chamadas[1].prompt), 'quem edita nao recebe a proibicao');
  assert.ok(/"edita": true/.test(chamadas[0].prompt), 'diz como pedir a edicao: ' + chamadas[0].prompt);
});

// D455 (0.6.4): tres leituras triviais custaram 169.098 tokens (~56 mil por agente), porque o agente padrao do
// workflow abre com CLAUDE.md, MEMORY.md e lista de skills. Quem so le abre leve, no agente do plugin; quem edita
// segue no agente padrao, com as regras do projeto.
test('paralelo: leitura abre no agente leve do plugin; quem edita segue no agente padrao (D455)', async () => {
  const { chamadas } = await rodar([
    'ler o modulo A',
    { tarefa: 'corrigir B', edita: true },
    { tarefa: 'ler C', edita: false, modelo: 'sonnet' },
  ]);
  assert.deepStrictEqual(chamadas.map((c) => c.opts.agentType), ['sworn:reader', undefined, 'sworn:reader']);
  assert.ok(!('agentType' in chamadas[1].opts), 'quem edita nao recebe agentType nenhum');
  assert.strictEqual(chamadas[2].opts.model, 'sonnet', 'o modelo pedido continua valendo no agente leve');
});

test('paralelo: o agente leve existe, abre sem CLAUDE.md, nao edita e nao fixa modelo (D455)', () => {
  const t = fs.readFileSync(path.join(__dirname, '..', 'agents', 'reader.md'), 'utf8');
  const cab = t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(cab, 'o agente nao tem frontmatter');
  assert.ok(/^name: reader$/m.test(cab[1]), 'name reader -> sworn:reader');
  assert.ok(/^omitClaudeMd: true$/m.test(cab[1]), 'falta omitClaudeMd: true');
  // lista fechada: sem Skill a lista de skills e as ferramentas adiadas saem da abertura (D447, medido na s78).
  // Os dois shells: no Windows o `claude -p` so tem PowerShell (medido na s81); o que faltar e ignorado.
  assert.ok(/^tools: Read, Grep, Glob, Bash, PowerShell$/m.test(cab[1]), 'tools tem de ser Read, Grep, Glob, Bash, PowerShell');
  assert.ok(!/^disallowedTools:/m.test(cab[1]), 'disallowedTools herda a lista inteira; use tools');
  // o modelo e o esforco vem de cada tarefa (haiku por padrao); fixar aqui desmentiria o README
  assert.ok(!/^(model|effort):/m.test(cab[1]), 'o leitor nao declara model nem effort');
});

// D457 (0.6.5): na medicao da s84 o leitor contou 110 linhas num arquivo de 121 com
// `(Get-Content | Measure-Object -Line).Lines`, que pula linha vazia, e disse que era o mesmo que `wc -l`.
test('paralelo: o agente leve avisa que Measure-Object -Line pula linha vazia (D457)', () => {
  const t = fs.readFileSync(path.join(__dirname, '..', 'agents', 'reader.md'), 'utf8');
  const corpo = t.replace(/^---\r?\n[\s\S]*?\r?\n---/, '');
  const linha = corpo.split(/\r?\n/).find((l) => /Measure-Object -Line/.test(l)) || '';
  assert.ok(linha, 'o corpo do leitor nao cita Measure-Object -Line');
  assert.ok(/pula linha vazia/.test(linha), 'a linha nao diz que pula linha vazia: ' + linha);
  assert.ok(/wc -l/.test(corpo) && /\(Get-Content -LiteralPath [^)]*\)\.Count/.test(corpo),
    'o leitor nao diz como contar certo nos dois shells');
  // revisao cega da 0.6.5, ronda 2: sem quebra de linha no fim, `wc -l` da 1 e `.Count` da 2 (medido em 'a\nb')
  const fim = corpo.split(/\r?\n/).find((l) => /quebra de linha/.test(l)) || '';
  assert.ok(/wc -l/.test(fim) && /uma a menos/.test(fim) && /qual comando usou/.test(fim),
    'o leitor nao avisa que wc -l e .Count divergem sem quebra de linha no fim: ' + fim);
});

test('paralelo: teto de 8 por padrao, 16 no maximo, e o que ficou de fora e dito (nada cortado calado)', async () => {
  const dez = Array.from({ length: 10 }, (_, i) => 'tarefa ' + (i + 1));
  const a = await rodar(dez);
  assert.strictEqual(a.chamadas.length, 8);
  assert.deepStrictEqual(a.r.naoRodaram.map((t) => t.n), [9, 10]);
  assert.ok(a.logs.some((l) => /NAO rodaram: 9, 10/.test(l)), JSON.stringify(a.logs));
  const vinte = Array.from({ length: 20 }, (_, i) => 'tarefa ' + (i + 1));
  const b = await rodar({ tarefas: vinte, teto: 50 });
  assert.strictEqual(b.chamadas.length, 16, 'teto acima de 16 vira 16');
  const c = await rodar({ tarefas: dez, teto: 2 });
  assert.strictEqual(c.chamadas.length, 2);
  const d = await rodar(['so uma']);
  assert.deepStrictEqual(d.logs, [], 'sem corte, sem aviso');
});

test('paralelo: agente que morre vira respondeu false, e o resultado volta como alegacao', async () => {
  const { r } = await rodar(['a', 'b'], (p, o, n) => (n === 2 ? null : { feito: true, resumo: 'feito a', evidencia: 'tests 1 | pass 1' }));
  assert.strictEqual(r.rodaram, 2);
  assert.strictEqual(r.resultados[0].respondeu, true);
  assert.strictEqual(r.resultados[0].resumo, 'feito a');
  assert.strictEqual(r.resultados[1].respondeu, false);
  assert.ok(/pulado|morreu/.test(r.resultados[1].motivo), 'null diz o porque: ' + r.resultados[1].motivo);
  assert.strictEqual(r.resultados[0].motivo, undefined, 'quem respondeu nao ganha motivo');
  assert.ok(/alegacao/.test(r.aviso) && /confira/.test(r.aviso), r.aviso);
});

test('paralelo: agente que lanca erro vira respondeu false COM a mensagem do erro (revisao cega da 0.6.2)', async () => {
  const { r } = await rodar(['a', 'b'], (p, o, n) => {
    if (n === 1) throw new Error('orcamento esgotado');
    return undefined;
  });
  assert.strictEqual(r.resultados[0].respondeu, false);
  assert.ok(/orcamento esgotado/.test(r.resultados[0].motivo), JSON.stringify(r.resultados[0]));
  assert.strictEqual(r.resultados[1].respondeu, false, 'undefined tambem e nao respondeu');
});
