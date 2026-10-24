'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const escopo = require('../scripts/lib/escopo.js');

function projetoTmp(arquivos) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-escopo-frente-'));
  for (const [rel, txt] of Object.entries(arquivos || {})) {
    const alvo = path.join(dir, rel);
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, txt, 'utf8');
  }
  return dir;
}

const TEXTO = [
  '# Escopo',
  '',
  '**Objetivo:** ligar a trava de escopo',
  '',
  '## Dentro',
  '- scripts/portao-escopo.js',
  '- `test/portao-escopo.test.js`',
  '- scripts/lib/**',
  '',
  '## Fora de escopo',
  '- refatorar io.js',
  '- qualquer coisa em Projeto Vizinho/'
].join('\n');

test('escopo: parse le objetivo, dentro e fora', () => {
  const e = escopo.parse(TEXTO);
  assert.strictEqual(e.objetivo, 'ligar a trava de escopo');
  assert.deepStrictEqual(e.dentro, ['scripts/portao-escopo.js', 'test/portao-escopo.test.js', 'scripts/lib/**']);
  assert.strictEqual(e.fora.length, 2);
});

test('escopo: marcador de lista e crase sao removidos', () => {
  const e = escopo.parse(TEXTO);
  assert.ok(!e.dentro.some((d) => d.includes('`')));
  assert.ok(!e.dentro.some((d) => d.startsWith('-')));
});

test('escopo: dentro casa caminho exato e glob', () => {
  const e = escopo.parse(TEXTO);
  assert.strictEqual(escopo.dentro('scripts/portao-escopo.js', e), true);
  assert.strictEqual(escopo.dentro('scripts/lib/glob.js', e), true);
  assert.strictEqual(escopo.dentro('scripts/outro.js', e), false);
});

test('escopo: texto vazio da escopo vazio, e escopo vazio nao autoriza nada', () => {
  const e = escopo.parse('');
  assert.deepStrictEqual(e.dentro, []);
  assert.strictEqual(escopo.dentro('qualquer.js', e), false);
});

test('escopo: secao nova encerra a anterior', () => {
  const e = escopo.parse('## Dentro\n- a.js\n## Notas\n- b.js');
  assert.deepStrictEqual(e.dentro, ['a.js']);
});

test('escopo: todos os motivos sao ASCII puro (R5)', () => {
  const esc = escopo.parse(TEXTO);
  const motivos = [
    escopo.motivoSemEscopo('src/a.js', 'padrao'),
    escopo.motivoFora('src/a.js', 'aaa', esc),
    escopo.motivoIntocavel('segredo.env'),
    escopo.motivoOutraFrente('src/a.js')
  ];
  for (const m of motivos) {
    assert.ok(/^[\x20-\x7E\n]+$/.test(m), 'motivo fora de ASCII: ' + m.slice(0, 40));
  }
});

test('escopo: motivoSemEscopo ensina o formato e cita o arquivo', () => {
  const m = escopo.motivoSemEscopo('src/a.js', 'padrao');
  assert.ok(m.includes('src/a.js'));
  assert.ok(m.includes('Fora de escopo'));
  assert.ok(m.includes('.claude/sworn/escopo.md'));
});

test('escopo D34: conteudoDepois entende Write e Edit, e devolve null no desconhecido', () => {
  // Write: tool_input.content e o "depois" inteiro, direto.
  assert.strictEqual(escopo.conteudoDepois('velho', { content: 'novo' }), 'novo');
  // Edit: simula a substituicao de old_string por new_string sobre o atual.
  assert.strictEqual(
    escopo.conteudoDepois('abc def abc', { old_string: 'abc', new_string: 'XYZ' }),
    'XYZ def abc'
  );
  // Edit com replace_all: true troca todas as ocorrencias.
  assert.strictEqual(
    escopo.conteudoDepois('abc def abc', { old_string: 'abc', new_string: 'XYZ', replace_all: true }),
    'XYZ def XYZ'
  );
  // old_string que nao casa no texto atual: desconhecido.
  assert.strictEqual(escopo.conteudoDepois('abc', { old_string: 'nao existe', new_string: 'X' }), null);
  // nem content, nem old_string: desconhecido.
  assert.strictEqual(escopo.conteudoDepois('abc', {}), null);
  // old_string vazio: desconhecido (evita "casar" com indexOf('') === 0 sempre).
  assert.strictEqual(escopo.conteudoDepois('abc', { old_string: '' }), null);
});

test('escopo D34: ampliou distingue crescer de encolher', () => {
  const antes = escopo.parse('## Dentro\n- src/**\n- test/**\n');
  const cresceu = escopo.parse('## Dentro\n- src/**\n- test/**\n- docs/**\n');
  const encolheu = escopo.parse('## Dentro\n- src/**\n');
  const mesmaLista = escopo.parse('## Dentro\n- test/**\n- src/**\n');
  assert.strictEqual(escopo.ampliou(antes, cresceu), true);
  assert.strictEqual(escopo.ampliou(antes, encolheu), false);
  assert.strictEqual(escopo.ampliou(antes, mesmaLista), false);
  // "depois" desconhecido (null) conta como ampliacao - a favor da visibilidade.
  assert.strictEqual(escopo.ampliou(antes, null), true);
  assert.strictEqual(escopo.ampliou(null, cresceu), true);
});

test('escopo D36: a SAIDA e ASCII pura mesmo com entrada acentuada', () => {
  const esc = escopo.parse('## Dentro\n- src/** (só os módulos novos)\n');
  const motivos = [
    escopo.motivoSemEscopo('docs/relatório.md', 'padrao'),
    escopo.motivoFora('docs/relatório.md', 'padrao', esc),
    escopo.motivoIntocavel('docs/relatório.md'),
    escopo.motivoOutraFrente('docs/relatório.md'),
    // F8: marcha tambem vem de fora (resolverMarcha devolve o nome da chave que
    // casou no projeto.json) e tambem precisa ser sanitizada, nao so alvo/dentro.
    escopo.motivoSemEscopo('src/a.js', 'padrão'),
    escopo.motivoFora('src/a.js', 'padrão', esc)
  ];
  for (const m of motivos) {
    assert.ok(/^[\x20-\x7E\n]*$/.test(m), 'motivo fora de ASCII: ' + m);
  }
});

// A2-04 (revisao completa, L2): o remedio "escreva `- <alvo>` em Dentro" tinha de casar o arquivo negado. Com ` (`,
// ` - ` ou ` #` no nome o parser cortava a linha; com acento o ascii() trocava a letra e o caminho escrito era outro.
test('A2-04: a linha que o motivo manda escrever casa o arquivo; com acento, o motivo diz para copiar o real', () => {
  const casaPeloRemedio = (alvo) => {
    const item = escopo.motivoSemEscopo(alvo, 'padrao').split('\n').filter((l) => /^ {2}- /.test(l))[0];
    return escopo.dentro(alvo, escopo.parse('## Dentro\n' + item.trim() + '\n'));
  };
  for (const alvo of ['docs/Manual (v2).md', 'docs/Relatorio - final.md', 'docs/notas #1.md', 'src/a b.js', 'src/a.js']) {
    assert.strictEqual(casaPeloRemedio(alvo), true, alvo);
  }
  const ACENTO = /acento ou caractere especial: copie-o da sua chamada/;
  for (const m of [escopo.motivoSemEscopo('docs/Relatório.md', 'padrao'), escopo.motivoOutraFrente('docs/Relatório.md'),
    escopo.motivoFora('docs/Relatório.md', 'padrao', escopo.parse('## Dentro\n- src/**\n'))]) {
    assert.match(m, ACENTO, m);
    assert.ok(/^[\x20-\x7E\n]*$/.test(m), 'fora de ASCII: ' + m);
    // revisao cega do L2 (ronda 2): a linha e um bloco proprio na forma unica - em branco antes e depois (ou e a ultima)
    const l = m.split('\n');
    const i = l.findIndex((x) => ACENTO.test(x));
    assert.strictEqual(l[i - 1], '', 'linha em branco antes do aviso de acento: ' + m);
    assert.ok(i === l.length - 1 || l[i + 1] === '', 'linha em branco depois do aviso de acento: ' + m);
    assert.ok(!/\n\n\n/.test(m), 'bloco vazio duplo: ' + m);
  }
  assert.doesNotMatch(escopo.motivoSemEscopo('src/a.js', 'padrao'), ACENTO, 'caminho sem acento nao leva a linha');
});

// D36 dizia "Fora nao bloqueia", e era verdade entao. D244/defeito 7: agora bloqueia, e a
// mensagem tem de dizer o que o portao faz - nem mais, nem menos.
test('escopo D36/D244: a mensagem diz que "Fora de escopo" bloqueia, porque agora bloqueia', () => {
  const m = escopo.motivoSemEscopo('src/a.js', 'padrao');
  assert.ok(!m.includes('e a parte que funciona'));
  assert.ok(!m.includes('nao bloqueia'));
  assert.ok(m.includes('tambem bloqueia'));
});

test('D244/defeito 2: item com anotacao depois do caminho casa pelo caminho', () => {
  const esc = escopo.parse('## Dentro\n- src/a.js (o motivo)\n- `src/b/**` — outro motivo\n- src/c.js\n' +
    '- src/d.js -- motivo\n- src/e.js # motivo\n- src/f.js - motivo\n');
  assert.deepStrictEqual(esc.dentro, ['src/a.js', 'src/b/**', 'src/c.js', 'src/d.js', 'src/e.js', 'src/f.js']);
  assert.ok(escopo.dentro('src/a.js', esc));
  assert.ok(escopo.dentro('src/b/x.js', esc));
});

test('D244/defeito 2: caminho com espaco e hifen no nome continua inteiro', () => {
  const esc = escopo.parse('## Dentro\r\n- Minha Pasta/extension/**\r\n- src/meu-arquivo.js\r\n- `Pasta X/a b.md` (motivo)\r\n');
  assert.deepStrictEqual(esc.dentro, ['Minha Pasta/extension/**', 'src/meu-arquivo.js', 'Pasta X/a b.md']);
});

// ---------------------------------------------------- escopo por frente

test('escopo: frenteDoAlvo reconhece um arquivo de frente valido', () => {
  const f = escopo.frenteDoAlvo('.claude/sworn/escopos/omni.md');
  assert.deepStrictEqual(f, { nome: 'omni', valido: true });
});

test('escopo: frenteDoAlvo aceita prefixo e extensao sem diferenciar caixa (D38)', () => {
  const f = escopo.frenteDoAlvo('.claude/Sworn/Escopos/omni.MD');
  assert.deepStrictEqual(f, { nome: 'omni', valido: true });
});

test('escopo: frenteDoAlvo marca invalido quando o nome tem caractere fora da classe', () => {
  const f = escopo.frenteDoAlvo('.claude/sworn/escopos/onda 8.md');
  assert.deepStrictEqual(f, { nome: 'onda 8', valido: false });
});

test('escopo: frenteDoAlvo devolve null fora da pasta de frentes, sem nome ou com barra', () => {
  assert.strictEqual(escopo.frenteDoAlvo('.claude/sworn/escopo.md'), null);
  assert.strictEqual(escopo.frenteDoAlvo('src/a.js'), null);
  assert.strictEqual(escopo.frenteDoAlvo('.claude/sworn/escopos/.md'), null);
  assert.strictEqual(escopo.frenteDoAlvo('.claude/sworn/escopos/sub/omni.md'), null);
});

test('escopo: arquivoEmVigor usa o arquivo da frente quando ele existe no disco', () => {
  const dir = projetoTmp({ '.claude/sworn/escopos/omni.md': '## Dentro\n- src/a.js\n' });
  try {
    assert.strictEqual(escopo.arquivoEmVigor(dir, 'omni'), '.claude/sworn/escopos/omni.md');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('escopo: arquivoEmVigor cai no escopo.md sem frente, ou com frente aposentada', () => {
  const dir = projetoTmp({});
  try {
    assert.strictEqual(escopo.arquivoEmVigor(dir, null), escopo.ARQUIVO);
    assert.strictEqual(escopo.arquivoEmVigor(dir, ''), escopo.ARQUIVO);
    assert.strictEqual(escopo.arquivoEmVigor(dir, 'omni'), escopo.ARQUIVO, 'frente sem arquivo no disco');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('escopo: arquivoEmVigor saneia a frente antes de montar o caminho', () => {
  const dir = projetoTmp({ '.claude/sworn/escopos/onda-8.md': '## Dentro\n- a.js\n' });
  try {
    assert.strictEqual(escopo.arquivoEmVigor(dir, 'onda 8'), '.claude/sworn/escopos/onda-8.md');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('escopo: carregar(cwd, frente) le o arquivo da frente vinculada', () => {
  const dir = projetoTmp({
    '.claude/sworn/escopo.md': '## Dentro\n- geral.js\n',
    '.claude/sworn/escopos/omni.md': '## Dentro\n- src/a.js\n'
  });
  try {
    assert.deepStrictEqual(escopo.carregar(dir, 'omni').dentro, ['src/a.js']);
    assert.deepStrictEqual(escopo.carregar(dir, null).dentro, ['geral.js']);
    assert.deepStrictEqual(escopo.carregar(dir).dentro, ['geral.js'], 'compat: sem frente e como hoje');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('escopo: as 4 mensagens citam o arquivo passado, no lugar do escopo.md padrao', () => {
  const esc = escopo.parse('## Dentro\n- src/a.js\n');
  const arquivo = '.claude/sworn/escopos/omni.md';
  assert.ok(escopo.motivoSemEscopo('src/a.js', 'padrao', arquivo).includes(arquivo));
  assert.ok(!escopo.motivoSemEscopo('src/a.js', 'padrao', arquivo).includes(escopo.ARQUIVO));
  assert.ok(escopo.motivoFora('src/a.js', 'padrao', esc, arquivo).includes(arquivo));
  assert.ok(escopo.motivoDeclaradoFora('src/a.js', 'src/**', arquivo).includes(arquivo));
  assert.ok(escopo.motivoOutraFrente('src/a.js', arquivo).includes(arquivo));
});

test('escopo: as 4 mensagens citam o escopo.md quando o arquivo nao e passado (compat)', () => {
  const esc = escopo.parse('## Dentro\n- src/a.js\n');
  assert.ok(escopo.motivoSemEscopo('src/a.js', 'padrao').includes(escopo.ARQUIVO));
  assert.ok(escopo.motivoDeclaradoFora('src/a.js', 'src/**').includes(escopo.ARQUIVO));
  assert.ok(escopo.motivoOutraFrente('src/a.js').includes(escopo.ARQUIVO));
});

test('escopo: motivoNomeDeFrente e curto, ASCII e cita o alvo', () => {
  const m = escopo.motivoNomeDeFrente('.claude/sworn/escopos/onda 8.md');
  assert.ok(m.includes('.claude/sworn/escopos/onda 8.md'));
  assert.ok(/^[\x20-\x7E\n]+$/.test(m), 'motivo fora de ASCII: ' + m);
  assert.ok(/letras sem acento/.test(m));
});

test('escopo: avisoHeranca sem escopo.md e sem frente nenhuma devolve null', () => {
  const dir = projetoTmp({});
  try {
    assert.strictEqual(escopo.avisoHeranca(dir, null), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('escopo: avisoHeranca com vinculo a frente existente cita nome, arquivo e objetivo', () => {
  const dir = projetoTmp({
    '.claude/sworn/escopos/omni.md': '**Objetivo:** fechar a onda 8\n## Dentro\n- src/a.js\n'
  });
  try {
    const a = escopo.avisoHeranca(dir, 'omni');
    assert.ok(a.includes('omni'), a);
    assert.ok(a.includes('.claude/sworn/escopos/omni.md'), a);
    assert.ok(a.includes('fechar a onda 8'), a);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('escopo: avisoHeranca com vinculo a frente aposentada volta a valer o escopo.md', () => {
  const dir = projetoTmp({
    '.claude/sworn/escopo.md': '**Objetivo:** tarefa antiga\n## Dentro\n- src/a.js\n'
  });
  try {
    const a = escopo.avisoHeranca(dir, 'omni');
    assert.ok(a.includes('escopo herdado'), a);
    assert.ok(a.includes('tarefa antiga'), a);
    assert.ok(!a.includes('vinculada'), a);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('escopo: avisoHeranca lista as frentes existentes e diz como se vincular', () => {
  const dir = projetoTmp({
    '.claude/sworn/escopos/omni.md': '**Objetivo:** fechar a onda 8\n## Dentro\n- src/a.js\n',
    '.claude/sworn/escopos/tecnica.md': '**Objetivo:** medir a oscilacao\n## Dentro\n- src/b.js\n'
  });
  try {
    const a = escopo.avisoHeranca(dir, null);
    assert.ok(a.includes('omni'), a);
    assert.ok(a.includes('fechar a onda 8'), a);
    assert.ok(a.includes('tecnica'), a);
    assert.ok(a.includes('medir a oscilacao'), a);
    assert.ok(/vincula/.test(a), a);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('escopo: avisoHeranca sem pasta escopos/ nem frentes e identico ao de hoje', () => {
  const dir = projetoTmp({
    '.claude/sworn/escopo.md': '**Objetivo:** tarefa unica\n## Dentro\n- src/a.js\n'
  });
  try {
    const a = escopo.avisoHeranca(dir, null);
    assert.ok(a.includes('escopo herdado'), a);
    assert.ok(!/frentes de trabalho/.test(a), a);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('escopo: a linha do vinculo fecha com o aviso de reescrever o arquivo da frente', () => {
  const dir = projetoTmp({
    '.claude/sworn/escopos/omni.md': '**Objetivo:** fechar a onda 8\n## Dentro\n- src/a.js\n'
  });
  try {
    const a = escopo.avisoHeranca(dir, 'omni');
    assert.ok(a.includes('Se a tarefa mudou, reescreva .claude/sworn/escopos/omni.md antes de editar.'), a);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('escopo: com vinculo, a lista de frentes nao repete a frente vinculada', () => {
  const dir = projetoTmp({
    '.claude/sworn/escopos/omni.md': '**Objetivo:** fechar a onda 8\n## Dentro\n- src/a.js\n',
    '.claude/sworn/escopos/tecnica.md': '**Objetivo:** medir a oscilacao\n## Dentro\n- src/b.js\n'
  });
  try {
    const a = escopo.avisoHeranca(dir, 'omni');
    assert.ok(a.includes('  - tecnica: medir a oscilacao'), a);
    assert.ok(!a.includes('  - omni:'), 'a frente vinculada nao entra na lista: ' + a);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('escopo: com vinculo e sem outra frente, o bloco da lista nao sai', () => {
  const dir = projetoTmp({
    '.claude/sworn/escopos/omni.md': '**Objetivo:** fechar a onda 8\n## Dentro\n- src/a.js\n'
  });
  try {
    const a = escopo.avisoHeranca(dir, 'omni');
    assert.ok(a.includes('vinculada a frente omni'), a);
    assert.ok(!/frentes de trabalho/.test(a), a);
    assert.ok(!/Editar o arquivo da frente vincula/.test(a), a);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('escopo: pasta chamada x.md dentro de escopos/ nao entra na lista de frentes', () => {
  const dir = projetoTmp({
    '.claude/sworn/escopos/tecnica.md': '**Objetivo:** medir a oscilacao\n## Dentro\n- src/b.js\n'
  });
  try {
    fs.mkdirSync(path.join(dir, '.claude', 'sworn', 'escopos', 'pasta.md'));
    const a = escopo.avisoHeranca(dir, null);
    assert.ok(a.includes('  - tecnica:'), a);
    assert.ok(!a.includes('pasta'), 'pasta nao e frente: ' + a);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('escopo: a linha do vinculo cita o nome saneado da frente, nunca o valor cru do estado', () => {
  const dir = projetoTmp({
    '.claude/sworn/escopos/om-ni.md': '**Objetivo:** fechar a onda 8\n## Dentro\n- src/a.js\n'
  });
  try {
    const a = escopo.avisoHeranca(dir, 'om ni');
    assert.ok(a.includes('vinculada a frente om-ni (.claude/sworn/escopos/om-ni.md)'), a);
    assert.ok(!a.includes('om ni'), 'valor cru do estado nao pode chegar ao texto: ' + a);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('escopo: nomeSeguro troca o que esta fora da classe de frente por hifen', () => {
  assert.strictEqual(escopo.nomeSeguro('om ni/x'), 'om-ni-x');
  assert.strictEqual(escopo.nomeSeguro('onda_8-a'), 'onda_8-a');
  // 0.3.2, item 15: as bordas que importam a reinjecao, que monta caminho e linha de texto com o nome.
  // Quebra de linha: nao pode sobrar no nome, senao a linha "Frente: ..." quebra em duas.
  assert.strictEqual(escopo.nomeSeguro('a\nb'), 'a-b', 'quebra de linha');
  assert.strictEqual(escopo.nomeSeguro('a\r\nb'), 'a--b', 'CR e LF sao dois caracteres, dois hifens');
  // Acento: cada caractere fora da classe vira UM hifen (nao some, nao vira a letra sem acento).
  assert.strictEqual(escopo.nomeSeguro('ação'), 'a--o', 'acento');
  // Numero e o valor `null` chegam do estado em disco: viram texto, nao explodem.
  assert.strictEqual(escopo.nomeSeguro(8), '8', 'numero');
  assert.strictEqual(escopo.nomeSeguro(null), 'null', 'null vira a palavra, sem excecao');
  // Subida de pasta: ponto e barra saem, entao o nome nunca escapa da pasta de frentes.
  assert.strictEqual(escopo.nomeSeguro('../x'), '---x', 'subida de pasta');
});

// ---------------------------------------------------- 0.3.2 (T3: itens 12 a 14)

// Troca metodos de `fs` por uns instantes. O escopo.js chama `fs.metodo(...)` na hora de usar,
// entao o remendo vale. Serve para provar o que o disco desta maquina nao deixa criar
// (link simbolico sem privilegio no Windows; dois nomes que so diferem na caixa).
function comFsRemendado(remendos, fn) {
  const originais = {};
  for (const nome of Object.keys(remendos)) {
    originais[nome] = fs[nome];
    fs[nome] = remendos[nome](originais[nome]);
  }
  try { return fn(); } finally {
    for (const nome of Object.keys(originais)) fs[nome] = originais[nome];
  }
}
const noPosix = (p) => String(p).replace(/\\/g, '/').replace(/\/$/, '');
const entrada = (name, tipo) => ({
  name: name,
  isFile: () => tipo === 'arquivo',
  isSymbolicLink: () => tipo === 'link',
  isDirectory: () => tipo === 'pasta'
});

test('0.3.2/item 12: a mensagem que cita a marcha diz o que ela e', () => {
  const esc = escopo.parse('## Dentro\n- src/a.js\n');
  const oQueE = /nivel de rigor que o projeto\.json da a este caminho/;
  const semEscopo = escopo.motivoSemEscopo('src/a.js', 'padrao');
  const fora = escopo.motivoFora('src/a.js', 'aaa', esc);
  assert.ok(semEscopo.includes('marcha padrao'), semEscopo);
  assert.ok(oQueE.test(semEscopo), 'sem escopo: marcha sem explicar: ' + semEscopo);
  assert.ok(fora.includes('marcha aaa'), fora);
  assert.ok(oQueE.test(fora), 'fora do escopo: marcha sem explicar: ' + fora);
});

test('0.3.2/item 12: "trava N" fica, com a palavra do que a trava guarda ao lado', () => {
  const esc = escopo.parse('## Dentro\n- src/a.js\n');
  const doEscopo = [
    escopo.motivoSemEscopo('src/a.js', 'padrao'),
    escopo.motivoFora('src/a.js', 'padrao', esc),
    escopo.motivoDeclaradoFora('src/a.js', 'src/**'),
    escopo.motivoNomeDeFrente('.claude/sworn/escopos/onda 8.md')
  ];
  for (const m of doEscopo) {
    assert.ok(/trava 4 - o escopo da tarefa/.test(m), 'trava 4 sem dizer o que guarda: ' + m);
  }
  const outra = escopo.motivoOutraFrente('src/a.js');
  assert.ok(/trava 5 - arquivo de outra frente/.test(outra), 'trava 5 sem dizer o que guarda: ' + outra);
  assert.ok(/outra frente/.test(outra) && /outra tarefa em andamento/.test(outra),
    '"frente" tem de se explicar: ' + outra);
});

test('0.3.2/item 13: link simbolico que aponta para arquivo entra na lista de frentes; link quebrado e pasta ficam fora', () => {
  const dir = projetoTmp({});
  const remendos = {
    readdirSync: (orig) => function (p, opcoes) {
      if (noPosix(p).endsWith('/.claude/sworn/escopos')) {
        return [
          entrada('real.md', 'arquivo'),
          entrada('link-arquivo.md', 'link'),
          entrada('link-quebrado.md', 'link'),
          entrada('link-pasta.md', 'link'),
          entrada('pasta.md', 'pasta')
        ];
      }
      return orig.call(fs, p, opcoes);
    },
    statSync: (orig) => function (p, opcoes) {
      const q = noPosix(p);
      if (q.endsWith('/escopos/link-arquivo.md')) return { isFile: () => true };
      if (q.endsWith('/escopos/link-pasta.md')) return { isFile: () => false };
      if (q.endsWith('/escopos/link-quebrado.md')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return orig.call(fs, p, opcoes);
    },
    // 0.3.3, item 22: o link para arquivo entra so se o destino real fica dentro do projeto.
    realpathSync: (orig) => function (p, opcoes) {
      if (noPosix(p).endsWith('/escopos/link-arquivo.md')) return path.join(orig.call(fs, dir), 'alvo', 'x.md');
      return orig.call(fs, p, opcoes);
    }
  };
  try {
    const a = comFsRemendado(remendos, () => escopo.avisoHeranca(dir, null));
    assert.ok(a.includes('  - real:'), a);
    assert.ok(a.includes('  - link-arquivo:'), 'link para arquivo tem de entrar: ' + a);
    assert.ok(!a.includes('link-quebrado'), 'link quebrado fica fora: ' + a);
    assert.ok(!a.includes('link-pasta'), 'link para pasta fica fora: ' + a);
    assert.ok(!a.includes('  - pasta:'), 'pasta fica fora: ' + a);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('0.3.2/item 13: link simbolico de verdade no disco (pula sem privilegio para criar link)', (t) => {
  const dir = projetoTmp({ 'alvo/frente-real.md': '**Objetivo:** vinda de um link\n## Dentro\n- src/a.js\n' });
  try {
    const pasta = path.join(dir, '.claude', 'sworn', 'escopos');
    fs.mkdirSync(pasta, { recursive: true });
    try {
      fs.symlinkSync(path.join(dir, 'alvo', 'frente-real.md'), path.join(pasta, 'link.md'), 'file');
      fs.symlinkSync(path.join(dir, 'alvo', 'nao-existe.md'), path.join(pasta, 'quebrado.md'), 'file');
      fs.symlinkSync(path.join(dir, 'alvo'), path.join(pasta, 'pasta-link.md'), 'dir');
    } catch (e) {
      t.skip('nao deu para criar link simbolico neste disco/usuario (' + (e && e.code) + ')');
      return;
    }
    const a = escopo.avisoHeranca(dir, null);
    assert.ok(a.includes('  - link: vinda de um link'), a);
    assert.ok(!a.includes('quebrado'), a);
    assert.ok(!a.includes('pasta-link'), a);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('0.3.2/item 14: em disco que diferencia caixa, vincular-se a Foo tira so o Foo.md da lista (nao o foo.md)', () => {
  const dir = projetoTmp({});
  const remendos = {
    // Disco que diferencia caixa: so o nome EXATO existe.
    existsSync: (orig) => function (p) {
      if (noPosix(p).endsWith('/escopos/Foo.md')) return true;
      if (noPosix(p).endsWith('/escopos/foo.md')) return true;
      return orig.call(fs, p);
    },
    readdirSync: (orig) => function (p, opcoes) {
      if (noPosix(p).endsWith('/.claude/sworn/escopos')) return [entrada('Foo.md', 'arquivo'), entrada('foo.md', 'arquivo')];
      return orig.call(fs, p, opcoes);
    }
  };
  try {
    const a = comFsRemendado(remendos, () => escopo.avisoHeranca(dir, 'Foo'));
    assert.ok(a.includes('vinculada a frente Foo'), a);
    assert.ok(a.includes('  - foo:'), 'foo.md e outra frente e tem de continuar na lista: ' + a);
    assert.ok(!a.includes('  - Foo:'), 'Foo.md e a vinculada e sai da lista: ' + a);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('0.3.2/item 14: em disco que NAO diferencia caixa, so foo.md e frente Foo: o recuo tira o foo.md da lista', (t) => {
  const dir = projetoTmp({
    '.claude/sworn/escopos/foo.md': '**Objetivo:** unica\n## Dentro\n- a.js\n',
    '.claude/sworn/escopos/bar.md': '**Objetivo:** outra\n## Dentro\n- b.js\n'
  });
  try {
    if (!fs.existsSync(path.join(dir, '.claude', 'sworn', 'escopos', 'FOO.md'))) {
      t.skip('este disco diferencia caixa; o recuo so vale onde Foo.md e foo.md sao o mesmo arquivo');
      return;
    }
    const a = escopo.avisoHeranca(dir, 'Foo');
    assert.ok(a.includes('vinculada a frente Foo'), a);
    assert.ok(a.includes('  - bar:'), a);
    assert.ok(!a.includes('  - foo:'), 'o foo.md e o arquivo vinculado, sai da lista: ' + a);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('0.3.2/item 14: em disco que diferencia caixa de verdade, Foo.md e foo.md ficam separados (pula onde nao ha esse disco)', (t) => {
  const dir = projetoTmp({});
  try {
    const pasta = path.join(dir, '.claude', 'sworn', 'escopos');
    fs.mkdirSync(pasta, { recursive: true });
    fs.writeFileSync(path.join(pasta, 'Foo.md'), '**Objetivo:** grande\n## Dentro\n- a.js\n', 'utf8');
    if (fs.existsSync(path.join(pasta, 'foo.md'))) {
      t.skip('este disco nao diferencia caixa (Foo.md e foo.md sao o mesmo arquivo)');
      return;
    }
    fs.writeFileSync(path.join(pasta, 'foo.md'), '**Objetivo:** pequena\n## Dentro\n- b.js\n', 'utf8');
    const a = escopo.avisoHeranca(dir, 'Foo');
    assert.ok(a.includes('vinculada a frente Foo'), a);
    assert.ok(a.includes('  - foo: pequena'), 'foo.md e outra frente: ' + a);
    assert.ok(!a.includes('  - Foo:'), a);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------- 0.3.3 (T3: itens 19 a 25)
// 19 e 20 sao so comentario (o catch de ehArquivo e o `vinculado` que pode ser undefined): nao ha
// comportamento novo para prender, o motivo esta escrito no proprio comentario.

test('0.3.3/item 21: a linha de abertura da trava 5 e exatamente a de sempre (a constante nao mudou o texto)', () => {
  const linhas = escopo.motivoOutraFrente('src/a.js').split('\n');
  assert.strictEqual(linhas[0], 'sworn - outra frente de trabalho (trava 5 - arquivo de outra frente).');
  const trava4 = escopo.motivoDeclaradoFora('src/a.js', 'src/**').split('\n')[0];
  assert.strictEqual(trava4, 'sworn - portao de escopo (trava 4 - o escopo da tarefa).');
});

test('0.3.3/item 22: link simbolico cujo destino real fica FORA do projeto nao entra na lista, e o objetivo do destino nao vaza', () => {
  const dir = projetoTmp({});
  const raiz = fs.realpathSync(dir);
  const dentroDoProjeto = path.join(raiz, 'alvo', 'x.md');
  const foraDoProjeto = path.join(path.dirname(raiz), 'fora-do-projeto-sworn', 'x.md');
  const remendos = {
    readdirSync: (orig) => function (p, opcoes) {
      if (noPosix(p).endsWith('/.claude/sworn/escopos')) {
        return [entrada('link-dentro.md', 'link'), entrada('link-fora.md', 'link')];
      }
      return orig.call(fs, p, opcoes);
    },
    statSync: (orig) => function (p, opcoes) {
      if (/\/escopos\/link-(dentro|fora)\.md$/.test(noPosix(p))) return { isFile: () => true };
      return orig.call(fs, p, opcoes);
    },
    realpathSync: (orig) => function (p, opcoes) {
      const q = noPosix(p);
      if (q.endsWith('/escopos/link-dentro.md')) return dentroDoProjeto;
      if (q.endsWith('/escopos/link-fora.md')) return foraDoProjeto;
      return orig.call(fs, p, opcoes);
    },
    readFileSync: (orig) => function (p, opcoes) {
      const q = noPosix(p);
      if (q.endsWith('/escopos/link-dentro.md')) return '**Objetivo:** objetivo de dentro\n## Dentro\n- a.js\n';
      if (q.endsWith('/escopos/link-fora.md')) return '**Objetivo:** SEGREDO-DO-DESTINO\n## Dentro\n- b.js\n';
      return orig.call(fs, p, opcoes);
    }
  };
  try {
    const a = comFsRemendado(remendos, () => escopo.avisoHeranca(dir, null));
    assert.ok(a.includes('  - link-dentro: objetivo de dentro'), 'link para destino dentro do projeto entra: ' + a);
    assert.ok(!a.includes('link-fora'), 'link para fora do projeto fica fora da lista: ' + a);
    assert.ok(!a.includes('SEGREDO-DO-DESTINO'), 'o objetivo do destino nao pode vazar: ' + a);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('0.3.3/item 22: destino real que nao se resolve (realpath falha) tambem fica fora da lista', () => {
  const dir = projetoTmp({});
  const remendos = {
    readdirSync: (orig) => function (p, opcoes) {
      if (noPosix(p).endsWith('/.claude/sworn/escopos')) return [entrada('link-sem-real.md', 'link')];
      return orig.call(fs, p, opcoes);
    },
    statSync: (orig) => function (p, opcoes) {
      if (noPosix(p).endsWith('/escopos/link-sem-real.md')) return { isFile: () => true };
      return orig.call(fs, p, opcoes);
    },
    realpathSync: (orig) => function (p, opcoes) {
      if (noPosix(p).endsWith('/escopos/link-sem-real.md')) throw Object.assign(new Error('ELOOP'), { code: 'ELOOP' });
      return orig.call(fs, p, opcoes);
    }
  };
  try {
    const a = comFsRemendado(remendos, () => escopo.avisoHeranca(dir, null));
    assert.strictEqual(a, null, 'sem frente que se resolva, sem bloco: ' + a);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('0.3.3/item 22: link simbolico de verdade para fora do projeto (pula sem privilegio para criar link)', (t) => {
  const dir = projetoTmp({});
  const fora = projetoTmp({ 'x.md': '**Objetivo:** SEGREDO-REAL\n## Dentro\n- a.js\n' });
  try {
    const pasta = path.join(dir, '.claude', 'sworn', 'escopos');
    fs.mkdirSync(pasta, { recursive: true });
    try {
      fs.symlinkSync(path.join(fora, 'x.md'), path.join(pasta, 'link-fora.md'), 'file');
    } catch (e) {
      t.skip('nao deu para criar link simbolico neste disco/usuario (' + (e && e.code) + ')');
      return;
    }
    const a = escopo.avisoHeranca(dir, null);
    assert.ok(!a || !a.includes('SEGREDO-REAL'), 'objetivo do destino vazou: ' + a);
    assert.ok(!a || !a.includes('link-fora'), a);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(fora, { recursive: true, force: true });
  }
});

test('0.3.3/item 23: marcador de lista sozinho (sem texto) nao vira caminho', () => {
  const e = escopo.parse([
    '## Dentro',
    '-',
    '- src/a.js',
    '*',
    '+',
    '- ',
    '## Fora de escopo',
    '-',
    '- src/b.js'
  ].join('\n'));
  assert.deepStrictEqual(e.dentro, ['src/a.js']);
  assert.deepStrictEqual(e.fora, ['src/b.js']);
  // Controle: `-` com texto segue sendo item, e caminho que comeca com hifen nao perde o hifen.
  assert.deepStrictEqual(escopo.parse('## Dentro\n- -x.js\n').dentro, ['-x.js']);
});

test('0.3.3/item 24: frente vinculada que nao se le diz que nao se leu (com o codigo), e nao "(sem objetivo)"', () => {
  const dir = projetoTmp({});
  try {
    // Uma PASTA chamada foo.md: existe (o vinculo a enxerga), mas ler da EISDIR.
    fs.mkdirSync(path.join(dir, '.claude', 'sworn', 'escopos', 'foo.md'), { recursive: true });
    const a = escopo.avisoHeranca(dir, 'foo');
    assert.ok(a.includes('vinculada a frente foo'), a);
    assert.ok(/nao se leu o arquivo \(e uma pasta \(EISDIR\)\)/.test(a), 'tem de dizer a causa: ' + a);
    assert.ok(a.includes('confira a permissao do arquivo da frente'), 'tem de dizer o proximo passo (F2-19): ' + a);
    assert.ok(!a.includes('(sem objetivo)'), 'ilegivel nao e "sem objetivo": ' + a);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('0.3.3/item 24: frente da lista que nao se le diz que nao se leu; a que nao declara objetivo segue "(sem objetivo)"', () => {
  const dir = projetoTmp({
    '.claude/sworn/escopos/boa.md': '**Objetivo:** fechar a onda\n## Dentro\n- a.js\n',
    '.claude/sworn/escopos/muda.md': '## Dentro\n- b.js\n',
    '.claude/sworn/escopos/ruim.md': '**Objetivo:** nao importa\n'
  });
  const remendos = {
    readFileSync: (orig) => function (p, opcoes) {
      if (noPosix(p).endsWith('/escopos/ruim.md')) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      return orig.call(fs, p, opcoes);
    }
  };
  try {
    const a = comFsRemendado(remendos, () => escopo.avisoHeranca(dir, null));
    assert.ok(a.includes('  - boa: fechar a onda'), a);
    assert.ok(a.includes('  - muda: (sem objetivo)'), 'sem objetivo declarado segue igual: ' + a);
    assert.ok(/  - ruim: nao se leu o arquivo \(sem permissao \(EACCES\)\)/.test(a), 'ilegivel tem de dizer a causa: ' + a);
    assert.ok(/  - ruim: .*confira a permissao do arquivo da frente/.test(a), 'tem de dizer o proximo passo (F2-19): ' + a);
    assert.ok(!/  - ruim: \(sem objetivo\)/.test(a), a);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('0.3.3/item 25: as mensagens dos portoes dizem o que guardam, sem jargao nem tom de bronca', () => {
  const intocavel = escopo.motivoIntocavel('.env');
  assert.ok(intocavel.includes('lista "intocaveis" de .claude/sworn/projeto.json'), intocavel);
  assert.ok(!intocavel.includes('intocaveis de projeto.json'), intocavel);
  // Plano 082, Tarefa 5: a 1a linha diz o que falta (era "sworn - intocavel.").
  assert.ok(intocavel.startsWith('sworn - arquivo intocavel: mexer nele e decisao do dono.'), 'o cabecalho: ' + intocavel);

  const outra = escopo.motivoOutraFrente('src/a.js', '.claude/sworn/escopo.md');
  assert.ok(!/rascunho abandonado/.test(outra) && !/convite/.test(outra), 'tom: ' + outra);
  assert.ok(/trabalho de outra tarefa em andamento/.test(outra), 'tem de dizer de quem e o arquivo: ' + outra);
  assert.ok(!/a passagem e contada/.test(outra), 'jargao: ' + outra);
  // O que a passagem conta de verdade: a ampliacao do escopo (contador escopo_ampliado), que o
  // portao do fecho mostra como "o escopo foi ampliado Nx neste turno".
  assert.ok(/ampliacao do escopo e contada e aparece no fecho do turno/.test(outra), outra);
});

// ---------------------------------------------------- T3 do plano dos 82 (F2-05, F2-16 a F2-18)

// Link de pasta (junction no Windows, sem privilegio; em POSIX o tipo e ignorado). Devolve o codigo do erro, ou null.
function ligarPasta(alvo, link) {
  try { fs.symlinkSync(alvo, link, 'junction'); return null; } catch (e) { return (e && e.code) || 'erro'; }
}

test('F2-05: escopo.md que existe e nao se le diz que nao se leu (e por que), e nao "(sem objetivo)"', () => {
  const dir = projetoTmp({});
  try {
    // Uma PASTA chamada escopo.md: existe (o statSync a enxerga), mas ler da EISDIR.
    fs.mkdirSync(path.join(dir, '.claude', 'sworn', 'escopo.md'), { recursive: true });
    const a = escopo.avisoHeranca(dir, null);
    assert.ok(/escopo herdado de .* - objetivo: nao se leu o arquivo \(e uma pasta \(EISDIR\)\);/.test(a), a);
    assert.ok(a.includes('confira a permissao do arquivo do escopo'), 'tem de dizer o proximo passo: ' + a);
    assert.ok(!a.includes('(sem objetivo)'), 'ilegivel nao e "sem objetivo": ' + a);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('F2-05: escopo.md legivel segue igual - com objetivo mostra o objetivo, sem objetivo diz "(sem objetivo)"', () => {
  const comObjetivo = projetoTmp({ '.claude/sworn/escopo.md': '**Objetivo:** fechar a onda\n## Dentro\n- a.js\n' });
  const semObjetivo = projetoTmp({ '.claude/sworn/escopo.md': '## Dentro\n- a.js\n' });
  try {
    assert.ok(escopo.avisoHeranca(comObjetivo, null).includes('objetivo: fechar a onda.'), escopo.avisoHeranca(comObjetivo, null));
    const a = escopo.avisoHeranca(semObjetivo, null);
    assert.ok(a.includes('objetivo: (sem objetivo).'), a);
    assert.ok(!a.includes('nao se leu'), a);
  } finally {
    fs.rmSync(comObjetivo, { recursive: true, force: true });
    fs.rmSync(semObjetivo, { recursive: true, force: true });
  }
});

test('F2-16: frente cujo arquivo resolve para FORA do projeto nao e lida (vale o escopo.md, como frente aposentada)', () => {
  const dir = projetoTmp({
    '.claude/sworn/escopos/omni.md': '**Objetivo:** SEGREDO\n## Dentro\n- src/de-fora.js\n',
    '.claude/sworn/escopo.md': '## Dentro\n- src/geral.js\n'
  });
  const fora = path.join(path.dirname(fs.realpathSync(dir)), 'fora-do-projeto-sworn', 'omni.md');
  const remendos = {
    realpathSync: (orig) => function (p, opcoes) {
      if (noPosix(p).endsWith('/escopos/omni.md')) return fora;
      return orig.call(fs, p, opcoes);
    }
  };
  try {
    // Controle: o destino real fica dentro do projeto, a frente e lida como sempre.
    assert.strictEqual(escopo.arquivoEmVigor(dir, 'omni'), '.claude/sworn/escopos/omni.md');
    assert.deepStrictEqual(escopo.carregar(dir, 'omni').dentro, ['src/de-fora.js']);
    comFsRemendado(remendos, () => {
      assert.strictEqual(escopo.arquivoEmVigor(dir, 'omni'), escopo.ARQUIVO, 'frente de fora nao e a que vale');
      assert.deepStrictEqual(escopo.carregar(dir, 'omni').dentro, ['src/geral.js'], 'o escopo de fora nao pode ser lido');
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('F2-16: escopo.md que resolve para FORA do projeto nao e lido: carregar devolve null (mais estrito, nao mais frouxo)', () => {
  const dir = projetoTmp({ '.claude/sworn/escopo.md': '**Objetivo:** SEGREDO\n## Dentro\n- src/de-fora.js\n' });
  const fora = path.join(path.dirname(fs.realpathSync(dir)), 'fora-do-projeto-sworn', 'escopo.md');
  const remendos = {
    realpathSync: (orig) => function (p, opcoes) {
      if (noPosix(p).endsWith('/.claude/sworn/escopo.md')) return fora;
      return orig.call(fs, p, opcoes);
    }
  };
  try {
    assert.deepStrictEqual(escopo.carregar(dir, null).dentro, ['src/de-fora.js'], 'controle: dentro do projeto e lido');
    comFsRemendado(remendos, () => {
      assert.strictEqual(escopo.carregar(dir, null), null);
      const a = escopo.avisoHeranca(dir, null);
      assert.ok(!a.includes('SEGREDO'), 'o objetivo do destino nao pode vazar: ' + a);
      assert.ok(/objetivo: nao se leu o arquivo \(o destino fica fora do projeto\)/.test(a), a);
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('F2-17: pasta escopos/ que e link para FORA do projeto: lista vazia e uma linha diz por que (junction de verdade)', (t) => {
  const dir = projetoTmp({});
  const fora = projetoTmp({ 'x.md': '**Objetivo:** SEGREDO-REAL\n## Dentro\n- src/de-fora.js\n' });
  try {
    fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
    const erro = ligarPasta(fora, path.join(dir, '.claude', 'sworn', 'escopos'));
    if (erro) { t.skip('nao deu para criar link neste disco/usuario (' + erro + ')'); return; }
    const a = escopo.avisoHeranca(dir, null);
    assert.ok(a && a.includes('.claude/sworn/escopos/ aponta para fora do projeto'), 'falta a linha que diz por que: ' + a);
    assert.ok(!a.includes('SEGREDO-REAL') && !a.includes('  - x:'), 'a frente de fora nao pode entrar na lista: ' + a);
    // Vinculada a uma frente dessa pasta: o arquivo (de fora) tambem nao vale.
    assert.strictEqual(escopo.arquivoEmVigor(dir, 'x'), escopo.ARQUIVO);
    assert.strictEqual(escopo.carregar(dir, 'x'), null);
    const v = escopo.avisoHeranca(dir, 'x');
    assert.ok(!v.includes('SEGREDO-REAL') && !v.includes('vinculada a frente x'), v);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(fora, { recursive: true, force: true });
  }
});

test('F2-17: pasta escopos/ de verdade (controle) segue listando as frentes, sem a linha de "fora"', () => {
  const dir = projetoTmp({ '.claude/sworn/escopos/boa.md': '**Objetivo:** fechar a onda\n## Dentro\n- a.js\n' });
  try {
    const a = escopo.avisoHeranca(dir, null);
    assert.ok(a.includes('  - boa: fechar a onda'), a);
    assert.ok(!a.includes('aponta para fora'), a);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('F2-18: linha de regua horizontal (--- e - ---) nao vira item de Dentro/Fora', () => {
  const e = escopo.parse([
    '## Dentro',
    '---',
    '- ---',
    '- src/a.js',
    '***',
    '- - -',
    '___',
    '## Fora de escopo',
    '---',
    '- src/b.js'
  ].join('\n'));
  assert.deepStrictEqual(e.dentro, ['src/a.js']);
  assert.deepStrictEqual(e.fora, ['src/b.js']);
  // Controle: hifen em caminho de verdade continua sendo item, e `--` com texto tambem.
  assert.deepStrictEqual(escopo.parse('## Dentro\n- -x.js\n- a---b.js\n- --flag.js\n').dentro, ['-x.js', 'a---b.js', '--flag.js']);
});

// Plano 082, Tarefa 2 (p8-11, p8-12): o filtro ASCII (R5) trocava quebra de linha e tab por "?", cada metade de um
// emoji por um "?" (dois por emoji), e so U+2012-2015 viravam hifen.
test('ascii: hifens e menos viram hifen; quebra e tab viram espaco; emoji vira UM "?"', () => {
  assert.strictEqual(escopo.ascii('a‐b‑c−d‒e–f—g―h'), 'a-b-c-d-e-f-g-h');
  assert.strictEqual(escopo.ascii('linha 1\nlinha 2\r\nlinha 3\tfim'), 'linha 1 linha 2 linha 3 fim');
  assert.strictEqual(escopo.ascii('ok 🚀 foi'), 'ok ? foi');
  // controle: acento sai sem acento, ASCII fica igual, e o que nao tem troca segue "?"
  assert.strictEqual(escopo.ascii('sessão próxima'), 'sessao proxima');
  assert.strictEqual(escopo.ascii('a-b c'), 'a-b c');
  assert.strictEqual(escopo.ascii('中'), '?');
});
