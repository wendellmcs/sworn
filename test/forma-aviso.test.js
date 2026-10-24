'use strict';
// Plano 082, Tarefa 5 (mock parte 3, S10): todo aviso de gancho com cabecalho "sworn - " na mesma forma.
// 1a linha diz o que falta em palavras do dono e fecha com ponto; linha em branco; caminhos entre aspas, um por
// linha; o que fazer em "Faca uma destas:" numerado (ou "Faca assim:", quando so ha um caminho); a linha de
// desligar (ou a de liberar, que e do dono) por ultimo. ASCII (R5): o texto sai de script e chega ao Claude.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const apelidos = require('../scripts/lib/apelidos.js');
const custo = require('../scripts/lib/custo.js');
const design = require('../scripts/lib/design.js');
const destrutivo = require('../scripts/lib/destrutivo.js');
const escopo = require('../scripts/lib/escopo.js');
const saude = require('../scripts/lib/saude.js');
const shell = require('../scripts/lib/shell.js');
const cicatriz = require('../scripts/lib/cicatriz.js');
const cobertura = require('../scripts/lib/cobertura.js');

const ASCII = /^[\n\x20-\x7E]*$/;

/** A forma unica. `o.caminhos`: cada um numa linha "  - "caminho"". `o.acao`: 'destas' ou 'assim'.
 *  `o.ultima`: regex da ultima linha. */
function confereForma(nome, texto, o) {
  assert.ok(ASCII.test(texto), nome + ': fora de ASCII (R5): ' + JSON.stringify(texto));
  const linhas = texto.split('\n');
  assert.match(linhas[0], /^sworn - \S.*\.$/, nome + ': a 1a linha diz o que falta, com ponto: ' + linhas[0]);
  assert.strictEqual(linhas[1], '', nome + ': linha em branco depois da 1a');
  for (const c of (o.caminhos || [])) {
    assert.ok(linhas.some((l) => /^ +- "/.test(l) && l.indexOf('"' + c + '"') !== -1),
      nome + ': o caminho "' + c + '" entre aspas, numa linha "  - ": ' + texto);
  }
  if (o.acao === 'destas') {
    const i = linhas.findIndex((l) => /^Faca uma destas( [^:]+)?:$/.test(l));
    assert.ok(i > 1, nome + ': sem "Faca uma destas:": ' + texto);
    assert.strictEqual(linhas[i - 1], '', nome + ': linha em branco antes do "Faca uma destas:"');
    assert.match(linhas[i + 1], /^ {2}1\. \S/, nome + ': opcao 1 numerada');
    const j = linhas.findIndex((l, k) => k > i + 1 && /^ {2}\d+\. /.test(l));
    assert.ok(j > i + 1 && /^ {2}2\. \S/.test(linhas[j]), nome + ': opcao 2 numerada, depois da 1');
  } else if (o.acao === 'assim') {
    const i = linhas.findIndex((l) => /^Faca assim: \S/.test(l));
    assert.ok(i > 1, nome + ': sem "Faca assim:": ' + texto);
    assert.strictEqual(linhas[i - 1], '', nome + ': linha em branco antes do "Faca assim:"');
  }
  if (o.ultima) {
    assert.match(linhas[linhas.length - 1], o.ultima, nome + ': a ultima linha: ' + texto);
    assert.strictEqual(linhas[linhas.length - 2], '', nome + ': linha em branco antes da ultima');
  }
  assert.ok(!/\n\n\n/.test(texto) && !/\n$/.test(texto), nome + ': sem bloco vazio duplo nem quebra no fim');
}

const DESLIGAR = /^Desligar neste projeto: "[a-zA-Z]+": false em \.claude\/sworn\/projeto\.json\.$/;
const LIBERAR = /^So o dono libera: .*"comandosLiberados".* \.claude\/sworn\/projeto\.json\.$/;

test('T5: gatilho 3 (apelidos) na forma unica, com o arquivo do agente entre aspas', () => {
  const t = apelidos.motivo({ divergencias: [
    { agente: 'busca', arquivo: 'busca.md', declarado: 'haiku', gravado: 'sonnet' },
    { agente: 'dev', arquivo: 'dev.md', declarado: 'opus', gravado: 'sonnet' }
  ] });
  confereForma('apelidos', t, { caminhos: ['.claude/agents/busca.md', '.claude/agents/dev.md'], acao: 'destas' });
  assert.match(t, /projeto\.json/, 'diz onde o mapa mora');
  assert.ok(t.indexOf('gatilho 3') === -1, 'sem o nome interno "gatilho 3" na tela');
});

// A1-08 (revisao completa, L2): o texto do dono (comando, nome e arquivo de agente) entrava cru no aviso; com
// acento a saida saia de ASCII (R5). O nome sem acento nao e o real: o aviso diz para copiar o real.
test('A1-08: comando e agente com acento saem em ASCII nos avisos de shell e de apelidos', () => {
  const p = [{ achado: 'cd relatório', sugestao: 'Set-Location', motivo: 'idioma é bash' }];
  confereForma('idioma acento', shell.motivo('cd relatório && ls', p, 1), { acao: 'destas' });
  confereForma('cd acento', shell.motivoCdSolto('cd relatório; ls', { forma: 'bash', achado: 'cd relatório' }),
    { acao: 'destas', ultima: LIBERAR });
  assert.ok(ASCII.test(shell.avisoCdCorrigido({ forma: 'bash', achado: 'cd relatório' })), 'cd corrigido fora de ASCII');
  const t = apelidos.motivo({ divergencias: [
    { agente: 'revisão', arquivo: 'revisão.md', declarado: 'opus', gravado: 'sonnet' }] });
  confereForma('apelidos acento', t, { caminhos: ['.claude/agents/revisao.md'], acao: 'destas' });
  assert.match(t, /sem acento/, 'tinha de avisar que o nome real tem acento: ' + t);
  assert.ok(apelidos.motivo({ divergencias: [{ agente: 'busca', arquivo: 'busca.md', declarado: 'a', gravado: 'b' }] })
    .indexOf('sem acento') === -1, 'nome sem acento nao leva a linha');
});

test('T5: roteamento por custo na forma unica', () => {
  const r = custo.permitido('caro', 'rapida', { agentes: { escada: ['barato', 'medio', 'caro'] } });
  assert.strictEqual(r.ok, false);
  confereForma('custo', r.motivo, { acao: 'destas' });
  assert.match(r.motivo, /"caro"/);
});

test('T5: fora do design system na forma unica, com o arquivo entre aspas', () => {
  const t = design.motivo('src/a b.css', [{ linha: 3, valor: '#123456', tipo: 'cor' }, { linha: 9, valor: 'gradiente', tipo: 'anti-referencia' }],
    { cores: ['#fff'], raios: ['4px'], espacos: ['8px'] });
  confereForma('design', t, { caminhos: ['src/a b.css'], acao: 'destas' });
  const shellT = design.motivoShell(['src/a.css', 'src/b.scss']);
  confereForma('design-shell', shellT, { caminhos: ['src/a.css', 'src/b.scss'], acao: 'destas' });
});

test('T5: comando destrutivo na forma unica; a liberacao e do dono, por ultimo', () => {
  const t = destrutivo.motivo('rm -rf build', { motivo: 'apaga pasta' });
  confereForma('destrutivo', t, { acao: 'destas', ultima: LIBERAR });
  assert.match(t, /trava 5/, 'o nome publico da trava fica');
});

test('T5: intocavel na forma unica, com o arquivo entre aspas', () => {
  confereForma('intocavel', escopo.motivoIntocavel('docs/segredo.md'), { caminhos: ['docs/segredo.md'], acao: 'destas' });
});

test('T5: os dois avisos de saude e o do handoff na forma unica', () => {
  const g = ['3 decisoes do dono', '2 revisoes independentes fechadas'];
  const aviso = saude.avisoDeSaude(g, false);
  confereForma('saude', aviso, { acao: 'assim' });
  for (const x of g) assert.ok(aviso.indexOf('  - ' + x) !== -1, 'gatilho listado: ' + x);
  const alarme = saude.avisoDeSaude(['500000 tokens de contexto (alarme 450000)'], true);
  confereForma('alarme', alarme, { acao: 'assim' });
  assert.match(alarme.split('\n')[0], /ALARME/);
  confereForma('handoff', saude.MOTIVO_HANDOFF_SEM_PROMPT, { acao: 'assim', ultima: DESLIGAR });
  assert.match(saude.MOTIVO_HANDOFF_SEM_PROMPT, /"portaoHandoff": false/);
});

test('T5: o aviso de saude que sai do avaliar e o do avisoDeSaude', () => {
  for (const tokens of [200000, 500000]) {
    const r = saude.avaliar({ contadores: {}, tokensDeContexto: tokens }, null, false);
    assert.strictEqual(r.disparou, true, 'controle: ' + tokens + ' tokens disparam');
    assert.strictEqual(r.aviso, saude.avisoDeSaude(r.gatilhos, r.alarme));
  }
});

test('T5: os quatro avisos de shell na forma unica', () => {
  const p = [{ achado: 'rm -rf', sugestao: 'Remove-Item', motivo: 'idioma bash' }];
  for (const n of [1, 2]) {
    confereForma('idioma ' + n, shell.motivo('rm -rf x', p, n), { acao: 'destas' });
  }
  assert.match(shell.motivo('rm -rf x', p, 2), /Troque de idioma, nao de variacao\./);
  confereForma('tabela', shell.avisoTabela([{ tipo: 'arquivo', onde: 'tabela/x.json', causa: 'JSON invalido' },
    { tipo: 'regra', achado: 'ls', onde: 'regras[2]', causa: 'regex' }]), { caminhos: ['tabela/x.json'], acao: 'assim' });
  for (const forma of ['bash', 'powershell']) {
    confereForma('cd ' + forma, shell.motivoCdSolto('cd x; git status', { forma: forma, achado: 'cd x' }),
      { acao: 'destas', ultima: LIBERAR });
  }
  confereForma('cd teto', shell.motivoCdSolto('cd x', { forma: 'bash', achado: 'cd', teto: true }), { acao: 'destas', ultima: LIBERAR });
  confereForma('cd corrigido', shell.avisoCdCorrigido({ forma: 'bash', achado: 'cd x' }), {});
  // D569: a linha curta das vezes seguintes e uma linha so (sem o corpo da forma unica), ASCII e com a 1a linha dela
  const curto = shell.avisoCdCorrigido({ forma: 'bash', achado: 'cd x' }, true);
  assert.ok(ASCII.test(curto), curto);
  assert.match(curto, /^sworn - \S.*\.$/);
  assert.strictEqual(curto.split('\n').length, 1, curto);
});

test('T5: os tres relatorios de comando abrem com a 1a linha na forma (o que e o relatorio)', () => {
  const r = { corpusLido: true, passagensComMarca: 1, minimo: 2, fracao: 0.5,
    resumo: { total: 1, comCicatriz: 0, semCicatriz: 1, porTipo: { decisao: 0, incidente: 0, achado: 0 } },
    itens: [{ arquivo: 'regras.md', linha: 4, texto: 'regra', temCicatriz: false }] };
  const tc = cicatriz.texto(r);
  assert.ok(ASCII.test(tc));
  assert.match(tc.split('\n')[0], /^sworn - \S.*\.$/);
  assert.ok(tc.indexOf('  - "regras.md:4"') !== -1, 'arquivo:linha entre aspas: ' + tc);
  const tb = cobertura.texto({ portoes: [], resumo: { total: 0, verificaveis: 0, naoVerificaveis: 0, garantidos: 0 } });
  assert.match(tb.split('\n')[0], /^sworn - \S.*\.$/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-forma-'));
  try {
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'contadores.json'), JSON.stringify({ cd_solto: 2 }), 'utf8');
    const u = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'uso.js')], { cwd: dir, encoding: 'utf8' });
    const linhas = u.stdout.split('\n');
    assert.match(linhas[0], /^sworn - \S.*\.$/, u.stdout);
    assert.ok(linhas.some((l) => /^ +- ".*contadores\.json"$/.test(l)), 'o arquivo lido entre aspas: ' + u.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('084: aviso de volta a chat parado na forma unica, com e sem preco', () => {
  const volta = require('../scripts/lib/volta.js');
  const agora = Date.parse('2026-10-17T12:00:00.000Z');
  for (const modelo of ['claude-opus-5-5', 'claude-novo-9', null]) {
    const r = volta.avaliar({ contexto: 318000, horario: agora - 188 * 60000, modelo: modelo }, agora);
    confereForma('volta ' + modelo, volta.motivo(r), { acao: 'destas', ultima: DESLIGAR });
    // 0.11.0 (D588): com o resumo e com o handoff em dia, a mesma forma
    const resumo = { caminho: '.claude/sworn/handoff/2026-10-22-retomar-d731fc49.md', chat: 'd731fc49', handoff: null };
    confereForma('volta resumo ' + modelo, volta.motivo(r, resumo), { acao: 'destas', ultima: DESLIGAR });
    confereForma('volta handoff ' + modelo, volta.motivo(r, Object.assign({}, resumo,
      { handoff: { caminho: '.context/plans/2026-10-22-x-handoff.md', emDia: true } })), { acao: 'destas', ultima: DESLIGAR });
  }
});
