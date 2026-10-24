'use strict';
// Plano do REA, Tarefa 3 (D555, D580): /sworn:reference. O alvo do texto e o mock aprovado
// (.context/plans/prints-rea/mock-rea.png, secoes 1-3); a ficha do teste usa os dados do estudo de verdade da D579.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const referencia = require('../scripts/lib/referencia.js');
const projetoLib = require('../scripts/lib/projeto.js');

const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'referencia.js');
const SKILL = path.join(RAIZ, 'skills', 'reference', 'SKILL.md');
const FICHA_REL = '.claude/sworn/referencias/texto-plugins-claude-code.md';

const FICHA = [
  '# Referência de texto: plugins do Claude Code',
  '',
  'Estudo de 2026-10-20 11:17. Tipo do projeto: plugin do Claude Code. Líderes pela busca pública do GitHub',
  '(14:12 UTC, por estrelas): claude-mem `9e4f313`, planning-with-files `de837a9`. Camadas 1 e 3.',
  '',
  '## Achados',
  '',
  '| Camada | Achado | Origem | Grau | Quem agiu |',
  '|---|---|---|---|---|',
  '| 1 o que se vê | planning-with-files abre com a promessa em uma linha e a prova logo abaixo | planning-with-files README.md:10-11 | observado | agente |',
  '| 1 o que se vê | Primeiro comando de instalação: pwf na linha 55, claude-mem na 140 | pwf README.md:55; claude-mem :140 | derivado | agente |',
  '| 3 textos | claude-mem anuncia "4 MCP tools" e lista 3 | claude-mem README.md:282, :299-301 | `observado` | agente |',
  '| 3 textos | Promessa curta + prova com número + o que o número não mede | dos achados acima | inferido | agente |',
  '',
  '## O que ficou sem saber',
  '',
  '| Pergunta | Estado | O que mediria |',
  '|---|---|---|',
  '| Como a primeira tela aparece de fato no GitHub | aberto | Fotografar as duas páginas a 1366 px |',
  '| Como os dois se comportam instalados | bloqueado | Camada 2: instalar numa pasta de teste, com o sim do dono |',
  '| Quantas ferramentas o claude-mem tem de fato | resolvido | Lido o servidor MCP no commit 9e4f313 |',
  '',
  'Não li: as imagens e GIFs, a pasta `docs/` dos dois.',
  ''
].join('\n');

function pasta() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sworn referencia-')); }
function escrever(dir, rel, conteudo) {
  const alvo = path.join(dir, rel);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, conteudo, 'utf8');
}
function rodar(args, cwd) {
  const r = spawnSync(process.execPath, [SCRIPT].concat(args), { cwd: cwd, encoding: 'utf8' });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (e) { /* o assert de quem chama mostra o stdout */ }
  return { status: r.status, json: json, saida: r.stdout + r.stderr };
}
const PROJETO = { versaoConfig: 1, geradoEm: '2026-10-01', modeloDeAmeaca: 'interno', quemDecide: 'o dono' };

// ── a conferencia da ficha ───────────────────────────────────────────────

test('conferir: a ficha do mock passa, com a contagem de achados, do que ficou sem saber e dos abertos', () => {
  const r = referencia.conferir(FICHA);
  assert.deepStrictEqual(r.problemas, []);
  assert.strictEqual(r.achados, 4);
  assert.strictEqual(r.semSaber, 3);
  assert.strictEqual(r.abertos, 1);
  assert.strictEqual(r.bytes, Buffer.byteLength(FICHA, 'utf8'));
});

test('conferir: achado sem origem, com grau fora dos tres ou sem quem agiu vira problema com a linha', () => {
  const casos = [
    ['| 3 textos | algo lido | planning-with-files README.md:510 | observado | agente |', '| 3 textos | algo lido |  | observado | agente |', /origem/],
    ['| 3 textos | algo lido | planning-with-files README.md:510 | observado | agente |', '| 3 textos | algo lido | a.md:1 | visto | agente |', /grau/],
    ['| 3 textos | algo lido | planning-with-files README.md:510 | observado | agente |', '| 3 textos | algo lido | a.md:1 | observado | robo |', /quem agiu/],
    ['| 3 textos | algo lido | planning-with-files README.md:510 | observado | agente |', '| 3 textos | algo lido | a.md:1 | observado |', /colunas/]
  ];
  for (const [boa, torta, re] of casos) {
    const ficha = FICHA.replace('## O que ficou sem saber', boa + '\n\n## O que ficou sem saber');
    assert.deepStrictEqual(referencia.conferir(ficha).problemas, [], 'controle: ' + boa);
    const p = referencia.conferir(FICHA.replace('## O que ficou sem saber', torta + '\n\n## O que ficou sem saber')).problemas;
    assert.strictEqual(p.length, 1, torta + ' -> ' + JSON.stringify(p));
    assert.match(p[0], re);
    assert.match(p[0], /^linha \d+: /, 'o problema diz a linha');
  }
});

test('conferir: o que ficou sem saber exige estado (aberto, bloqueado, resolvido) e o que mediria', () => {
  const linha = '| Como os dois se comportam instalados | bloqueado | Camada 2: instalar numa pasta de teste, com o sim do dono |';
  const semEstado = referencia.conferir(FICHA.replace(linha, '| Como os dois se comportam instalados | talvez | medir instalando |')).problemas;
  assert.strictEqual(semEstado.length, 1, JSON.stringify(semEstado));
  assert.match(semEstado[0], /estado/);
  const semMedida = referencia.conferir(FICHA.replace(linha, '| Como os dois se comportam instalados | aberto |  |')).problemas;
  assert.strictEqual(semMedida.length, 1, JSON.stringify(semMedida));
  assert.match(semMedida[0], /o que mediria/);
});

test('conferir: sem achado, sem a secao do que ficou sem saber ou sem o "Nao li:" a ficha nao passa', () => {
  const semAchado = FICHA.split('\n').filter((l) => !/^\| [13] /.test(l)).join('\n');
  assert.match(referencia.conferir(semAchado).problemas.join(' '), /nenhum achado/);
  const semSecao = FICHA.replace('## O que ficou sem saber', '## Outra coisa');
  assert.match(referencia.conferir(semSecao).problemas.join(' '), /O que ficou sem saber/);
  const semCobertura = FICHA.replace('Não li:', 'Li tudo:');
  assert.match(referencia.conferir(semCobertura).problemas.join(' '), /Não li:/);
  assert.deepStrictEqual(referencia.conferir(FICHA.replace('Não li:', 'Nao li:')).problemas, [], 'sem acento tambem vale');
  // revisao da 0.10.0 (ronda 1, estados): a linha sem nada depois dos dois pontos nao declara cobertura nenhuma
  const vazia = FICHA.replace(/Não li:.*$/m, 'Não li:   ');
  assert.match(referencia.conferir(vazia).problemas.join(' '), /Não li:/);
  // ronda 2: a secao do que ficou sem saber so com o cabecalho nao declara incerteza nenhuma
  const semPergunta = FICHA.split('\n').filter((l) => !/^\| (Como|Quantas) /.test(l)).join('\n');
  assert.match(referencia.conferir(semPergunta).problemas.join(' '), /nenhuma pergunta/);
});

test('conferir: texto livre so de traco, "n/a" ou uma letra conta como vazio; linha sem | inicial nao some (D582)', () => {
  for (const [torta, re] of [['| 3 textos | - | a.md:1 | observado | agente |', /achado vazio/],
    ['| 3 textos | algo lido | n/a | observado | agente |', /origem/],
    ['3 textos | algo lido | a.md:1 | observado | agente |', /barra/]]) {
    const p = referencia.conferir(FICHA.replace('## O que ficou sem saber', torta + '\n\n## O que ficou sem saber')).problemas;
    assert.strictEqual(p.length, 1, torta + ' -> ' + JSON.stringify(p));
    assert.match(p[0], re);
  }
  const pergunta = '| Como os dois se comportam instalados | bloqueado | Camada 2: instalar numa pasta de teste, com o sim do dono |';
  assert.match(referencia.conferir(FICHA.replace(pergunta, '| Como os dois se comportam instalados | aberto | ? |')).problemas.join(' '),
    /o que mediria/);
  assert.match(referencia.conferir(FICHA.replace(/Não li:.*$/m, 'Não li: -')).problemas.join(' '), /Não li:/);
  // conferencia da D582: a linha sem barra na secao do que ficou sem saber derrubava a contagem dos abertos
  const torta = FICHA.replace('| Como os dois se comportam instalados |', 'Como os dois se comportam instalados |');
  const r = referencia.conferir(torta);
  assert.match(r.problemas.join(' '), /barra/);
  assert.strictEqual(r.abertos, 1);
});

test('conferir: linha de tabela em branco ou so de tracos e dado, nao separador (ronda 2)', () => {
  for (const branca of ['| | | | | |', '| - | - | - | - | - |']) {
    const p = referencia.conferir(FICHA.replace('## O que ficou sem saber', branca + '\n\n## O que ficou sem saber')).problemas;
    assert.ok(p.length >= 1 && p.every((x) => /^linha \d+: /.test(x)), branca + ' -> ' + JSON.stringify(p));
  }
  assert.deepStrictEqual(referencia.conferir(FICHA.replace('|---|---|---|---|---|', '| :-- | --- | :-: | --: | - |')).problemas, [],
    'controle: separador com dois-pontos segue separador');
});

test('conferir: acima do teto do R.txt (100 KB) a ficha nao passa; no teto, passa', () => {
  const cegar = require('../scripts/lib/cegar.js');
  const folga = cegar.TETO_DA_REFERENCIA - Buffer.byteLength(FICHA, 'utf8');
  assert.deepStrictEqual(referencia.conferir(FICHA + 'x'.repeat(folga)).problemas, [], 'no teto');
  const p = referencia.conferir(FICHA + 'x'.repeat(folga + 1)).problemas;
  assert.strictEqual(p.length, 1, JSON.stringify(p));
  assert.match(p[0], /100 KB/);
});

test('tipoDaFicha: so <tipo>-<assunto>.md em .claude/sworn/referencias/, um dos tres tipos (D580)', () => {
  assert.strictEqual(referencia.tipoDaFicha(FICHA_REL), 'texto');
  assert.strictEqual(referencia.tipoDaFicha('.claude/sworn/referencias/tela-painel.md'), 'tela');
  assert.strictEqual(referencia.tipoDaFicha('.claude\\sworn\\referencias\\codigo-cli.md'), 'codigo');
  for (const torto of ['.claude/sworn/referencias/telas-painel.md', '.claude/sworn/referencias/texto-.md',
    '.claude/sworn/referencias/texto-x.txt', 'docs/texto-x.md', '.claude/sworn/referencias/sub/texto-x.md',
    '.claude/sworn/referencias/texto-sub/x.md']) {
    assert.strictEqual(referencia.tipoDaFicha(torto), null, torto);
  }
});

test('naReferencia: junta a ficha a lista do tipo, sem repetir, preserva os outros tipos e o geradoEm', () => {
  const antigo = Object.assign({}, PROJETO, { referencias: { texto: ['README.md'], tela: ['p.png'] } });
  const r = referencia.naReferencia(antigo, 'texto', FICHA_REL);
  assert.deepStrictEqual(r.erros, []);
  assert.deepStrictEqual(r.config.referencias, { texto: ['README.md', FICHA_REL], tela: ['p.png'] });
  assert.strictEqual(r.config.geradoEm, '2026-10-01');
  assert.deepStrictEqual(referencia.naReferencia(r.config, 'texto', FICHA_REL).config.referencias.texto,
    ['README.md', FICHA_REL], 'de novo, sem repetir');
  assert.deepStrictEqual(antigo.referencias.texto, ['README.md'], 'nao muda o objeto de entrada');
  // "nunca" gravado ({}) e sem a chave: o sim de agora cria o tipo
  assert.deepStrictEqual(referencia.naReferencia(Object.assign({}, PROJETO, { referencias: {} }), 'texto', FICHA_REL)
    .config.referencias, { texto: [FICHA_REL] });
  assert.deepStrictEqual(referencia.naReferencia(PROJETO, 'tela', 'a.md').config.referencias, { tela: ['a.md'] });
});

test('naReferencia: referencias torta no projeto.json vira erro, sem gravar por cima', () => {
  const r = referencia.naReferencia(Object.assign({}, PROJETO, { referencias: { texto: 'README.md' } }), 'texto', FICHA_REL);
  assert.ok(r.erros.length > 0, JSON.stringify(r));
  // lista no lugar do objeto: sem conferir antes, a fusao trocaria a lista por { texto: [...] } e passaria na validacao
  const lista = referencia.naReferencia(Object.assign({}, PROJETO, { referencias: ['README.md'] }), 'texto', FICHA_REL);
  assert.ok(lista.erros.length > 0, JSON.stringify(lista));
  assert.deepStrictEqual(lista.config.referencias, ['README.md'], 'o que o dono escreveu fica');
  assert.ok(projetoLib.validar(Object.assign({}, PROJETO, { referencias: { texto: [FICHA_REL] } })).erros
    .filter((e) => /^referencias/.test(e)).length === 0, 'controle: a lista certa nao tem erro de referencias');
});

// ── o script ─────────────────────────────────────────────────────────────

test('script: confere sem gravar; com --gravar poe a ficha na referencias do projeto.json', () => {
  const dir = pasta();
  try {
    escrever(dir, '.claude/sworn/projeto.json', JSON.stringify(PROJETO));
    escrever(dir, FICHA_REL, FICHA);
    const so = rodar([FICHA_REL], dir);
    assert.strictEqual(so.status, 0, so.saida);
    assert.strictEqual(so.json.ok, true, so.saida);
    assert.strictEqual(so.json.tipo, 'texto');
    assert.strictEqual(so.json.achados, 4);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, '.claude/sworn/projeto.json'), 'utf8')).referencias,
      undefined, 'sem --gravar nao grava');
    const g = rodar([FICHA_REL, '--gravar'], dir);
    assert.strictEqual(g.status, 0, g.saida);
    assert.strictEqual(g.json.gravou, true, g.saida);
    const lido = JSON.parse(fs.readFileSync(path.join(dir, '.claude/sworn/projeto.json'), 'utf8'));
    assert.deepStrictEqual(lido.referencias, { texto: [FICHA_REL] });
    assert.strictEqual(lido.quemDecide, 'o dono', 'o resto do projeto.json fica');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('script: ficha com problema, fora da pasta ou do nome, ou sem projeto.json nao grava e sai com 1', () => {
  const dir = pasta();
  try {
    escrever(dir, '.claude/sworn/projeto.json', JSON.stringify(PROJETO));
    escrever(dir, FICHA_REL, FICHA.replace('| derivado |', '| chute |'));
    const torta = rodar([FICHA_REL, '--gravar'], dir);
    assert.strictEqual(torta.status, 1, torta.saida);
    assert.strictEqual(torta.json.gravou, false);
    assert.match(torta.json.problemas.join(' '), /grau/);
    escrever(dir, 'docs/texto-x.md', FICHA);
    const fora = rodar(['docs/texto-x.md'], dir);
    assert.strictEqual(fora.status, 1, fora.saida);
    assert.match(fora.json.problemas.join(' '), /referencias/);
    const falta = rodar(['.claude/sworn/referencias/texto-nada.md'], dir);
    assert.strictEqual(falta.status, 1, falta.saida);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, '.claude/sworn/projeto.json'), 'utf8')).referencias,
      undefined, 'nada gravado');
    escrever(dir, FICHA_REL, FICHA);
    const torto = JSON.stringify(Object.assign({}, PROJETO, { referencias: ['README.md'] }));
    escrever(dir, '.claude/sworn/projeto.json', torto);
    const ref = rodar([FICHA_REL, '--gravar'], dir);
    assert.strictEqual(ref.status, 1, ref.saida);
    assert.match(ref.json.erro, /referencias/);
    assert.strictEqual(fs.readFileSync(path.join(dir, '.claude/sworn/projeto.json'), 'utf8'), torto, 'nao grava por cima');
    const sem = pasta();
    try {
      escrever(sem, FICHA_REL, FICHA);
      const r = rodar([FICHA_REL, '--gravar'], sem);
      assert.strictEqual(r.status, 1, r.saida);
      assert.match(r.json.erro, /sworn:init/);
    } finally { fs.rmSync(sem, { recursive: true, force: true }); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── a ficha do radar (plano do radar, T2; D609) ──────────────────────────
// A ficha do radar e a da referencia mais a secao dos candidatos. Mora fora do projeto (o arquivo puxado da nuvem fica
// em ~/.claude/sworn/), por isso o tipo vem de --tipo radar, nao do caminho; e nunca entra na `referencias`.

const CANDIDATOS = [
  '## Candidatos',
  '',
  '| Repo | Licença | Como entra | Como melhora | Esforço | Valor | Veredito |',
  '|---|---|---|---|---|---|---|',
  '| anomalyco/opencode | MIT | regras allow/ask/deny no portão de escopo | determinístico, sem modelo no meio | M | médio | INSPIRAÇÃO |',
  '| cursor/plugins | MIT | gatilho "travado" no portão de fecho | barra em vez de só lembrar | P | alto | adotar |',
  '| NationalSecurityAgency/ghidra | Apache-2.0 | não entra | - | P | baixo | descartar |',
  ''
].join('\n');
const FICHA_RADAR = FICHA.replace('## O que ficou sem saber', CANDIDATOS + '\n## O que ficou sem saber');

test('conferir radar: a ficha com os candidatos passa e conta candidatos e adotados', () => {
  const r = referencia.conferir(FICHA_RADAR, { tipo: 'radar' });
  assert.deepStrictEqual(r.problemas, []);
  assert.strictEqual(r.candidatos, 3);
  assert.strictEqual(r.adotar, 1);
  assert.strictEqual(r.achados, 4, 'os achados seguem contados');
  assert.deepStrictEqual(referencia.conferir(FICHA_RADAR).problemas, [], 'controle: sem tipo, a secao a mais nao atrapalha');
});

test('conferir radar: sem a secao dos candidatos, ou com ela vazia, nao passa', () => {
  assert.match(referencia.conferir(FICHA, { tipo: 'radar' }).problemas.join(' '), /## Candidatos/);
  const vazia = FICHA_RADAR.split('\n').filter((l) => !/^\| (anomalyco|cursor|National)/.test(l)).join('\n');
  assert.match(referencia.conferir(vazia, { tipo: 'radar' }).problemas.join(' '), /nenhum candidato/);
});

test('conferir radar: esforco, valor, veredito fora da lista, licenca vazia ou como entra vazio viram problema com a linha', () => {
  const boa = '| cursor/plugins | MIT | gatilho "travado" no portão de fecho | barra em vez de só lembrar | P | alto | adotar |';
  const casos = [
    ['| cursor/plugins | MIT | gatilho | barra | XL | alto | adotar |', /esforço/],
    ['| cursor/plugins | MIT | gatilho | barra | P | enorme | adotar |', /valor/],
    ['| cursor/plugins | MIT | gatilho | barra | P | alto | talvez |', /veredito/],
    ['| cursor/plugins |  | gatilho | barra | P | alto | adotar |', /licença/],
    ['| cursor/plugins | MIT | - | barra | P | alto | adotar |', /como entra/],
    ['| cursor/plugins | MIT | gatilho | ? | P | alto | inspiracao |', /como melhora/],
    ['| cursor/plugins | MIT | gatilho | barra | P | alto |', /colunas/],
    ['cursor/plugins | MIT | gatilho | barra | P | alto | adotar |', /barra/]
  ];
  for (const [torta, re] of casos) {
    const p = referencia.conferir(FICHA_RADAR.replace(boa, torta), { tipo: 'radar' }).problemas;
    assert.strictEqual(p.length, 1, torta + ' -> ' + JSON.stringify(p));
    assert.match(p[0], re);
    assert.match(p[0], /^linha \d+: /, 'o problema diz a linha');
  }
  // descartado nao entra: "como entra" e "como melhora" podem ficar vazios; sem acento tambem vale
  assert.deepStrictEqual(referencia.conferir(FICHA_RADAR.replace(boa,
    '| cursor/plugins | MIT | - | - | p | medio | Descartar |'), { tipo: 'radar' }).problemas, []);
});

test('script --tipo radar: confere a ficha em qualquer pasta, recusa --gravar e tipo desconhecido', () => {
  const dir = pasta();
  try {
    escrever(dir, '.claude/sworn/projeto.json', JSON.stringify(PROJETO));
    escrever(dir, 'fora/semana.md', FICHA_RADAR);
    const ok = rodar(['fora/semana.md', '--tipo', 'radar'], dir);
    assert.strictEqual(ok.status, 0, ok.saida);
    assert.strictEqual(ok.json.ok, true, ok.saida);
    assert.strictEqual(ok.json.tipo, 'radar');
    assert.strictEqual(ok.json.candidatos, 3);
    assert.strictEqual(ok.json.adotar, 1);
    // s116 (mutacao que escapou): a ficha depois da flag; o valor do --tipo nao e tomado pela ficha.
    const depois = rodar(['--tipo', 'radar', 'fora/semana.md'], dir);
    assert.strictEqual(depois.status, 0, depois.saida);
    assert.match(depois.json.ficha, /semana\.md$/, depois.saida);
    const g = rodar(['fora/semana.md', '--tipo', 'radar', '--gravar'], dir);
    assert.strictEqual(g.status, 1, g.saida);
    assert.strictEqual(g.json.gravou, false);
    assert.match(g.json.erro, /radar nao entra na referencias.*chat/, 'a recusa e a do radar, nao a validacao do projeto.json');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, '.claude/sworn/projeto.json'), 'utf8')).referencias,
      undefined, 'nada gravado');
    const torto = rodar(['fora/semana.md', '--tipo', 'radr'], dir);
    assert.strictEqual(torto.status, 1, torto.saida);
    assert.match(torto.json.erro, /--tipo/);
    const semCand = rodar(['fora/semana.md'], dir);
    assert.strictEqual(semCand.status, 1, 'controle: sem --tipo, fora da pasta das referencias segue recusada');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── a skill: o texto do mock e da D580 ───────────────────────────────────

function lerSkill() { return fs.readFileSync(SKILL, 'utf8').replace(/\r\n/g, '\n'); }

test('skill: como o comando comeca (mock secao 1) - tipo pelo projeto.json, lideres com hora, ja estudado, camadas, so publico', () => {
  const s = lerSkill();
  assert.match(s, /^---\nname: reference\n/);
  assert.ok(s.includes('projeto.json'), 'o tipo sai do projeto.json');
  assert.match(s, /busca pública/);
  assert.match(s, /hora/);
  assert.match(s, /já estudad/, 'produto ja estudado aparece e nao e proposto');
  assert.match(s, /AskUserQuestion/);
  for (const c of ['o que se vê', 'estados e fluxos', 'textos', 'rede e desempenho']) assert.ok(s.includes(c), 'camada: ' + c);
  assert.match(s, /instalar/, 'a camada 2 exige instalar');
  assert.match(s, /sim do dono/);
  assert.match(s, /tela na web/, 'a camada 4 so para quem tem tela na web');
  assert.match(s, /login/);
  assert.match(s, /aba do dono/, 'D580: com login, so a aba do dono');
  assert.match(s, /CDP/, 'foto pelo CDP');
  assert.match(s, /04-verificacao\.md/);
  assert.match(s, /credencial/);
  assert.match(s, /código nem arte/);
});

test('skill: a ficha (mock secao 2) - formato que o script confere, origem, grau, quem agiu, sem saber, Nao li', () => {
  const s = lerSkill();
  assert.ok(s.includes('.claude/sworn/referencias/<tipo>-<assunto>.md'), 'D580: o lugar e o nome da ficha');
  assert.ok(s.includes('| Camada | Achado | Origem | Grau | Quem agiu |'), 'cabecalho da tabela de achados');
  assert.ok(s.includes('| Pergunta | Estado | O que mediria |'), 'cabecalho do que ficou sem saber');
  for (const g of ['observado', 'derivado', 'inferido', 'agente', 'dono', 'aberto', 'bloqueado', 'resolvido']) {
    assert.ok(s.includes('`' + g + '`'), 'valor: ' + g);
  }
  assert.ok(s.includes('## O que ficou sem saber'));
  assert.ok(s.includes('Não li:'));
  assert.match(s, /"não achei"/i);
  assert.ok(s.includes('node "${CLAUDE_PLUGIN_ROOT}/scripts/referencia.js"'), 'o comando do script');
  assert.match(s, /100 KB/);
  assert.ok(s.includes('.claude/sworn/referencias/**'), 'o escopo precisa cobrir a pasta da ficha');
  assert.match(s, /portão de escopo/);
});

test('init: o Passo 4b oferece o /sworn:reference a quem nao tem referencia (Tarefa 4)', () => {
  const init = fs.readFileSync(path.join(RAIZ, 'skills', 'init', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  const i = init.indexOf('**Por último, a referência de topo**');
  const j = init.indexOf('\n## Passo 5', i);
  assert.ok(i !== -1 && j > i, 'sumiu o trecho da referencia de topo no Passo 4b');
  const trecho = init.slice(i, j);
  assert.match(trecho, /sem candidato[^.]*\/sworn:reference/, 'a opcao 1 sem candidato oferece o comando');
  assert.match(trecho, /Para nomear depois[^"]*\/sworn:reference/, 'a opcao 2 diz o comando ao dono');
});

test('skill: o fecho (mock secao 3) - 3 opcoes, a recomendada primeiro, --gravar so com o sim', () => {
  const s = lerSkill();
  const a = s.indexOf('Sim, como referência de');
  const b = s.indexOf('Guardar sem usar ainda');
  const c = s.indexOf('Estudar mais antes');
  assert.ok(a !== -1 && b > a && c > b, 'as 3 opcoes do mock, nesta ordem');
  assert.match(s.slice(a, b), /recomendada/);
  assert.ok(s.includes('--gravar'), 'o sim grava pelo script');
});
