'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const agentes = require('../scripts/lib/agentes.js');

function pastaTemporaria(t) {
  // Espaco E acento no caminho: e o caso normal desta maquina, e e o foco de
  // revisao 5. path.join nunca vira concatenacao de string por causa disto.
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn projecao-'));
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  return p;
}

function escrever(raiz, nome, conteudo) {
  const alvo = agentes.caminho(raiz, nome);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, conteudo, 'utf8');
  return alvo;
}

test('agentes: le chave e valor de primeiro nivel', () => {
  const r = agentes.frontmatter('---\nname: busca\nmodel: barato\n---\n\ncorpo\n');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.campos.name, 'busca');
  assert.strictEqual(r.campos.model, 'barato');
});

test('agentes: BOM e CRLF nao quebram a leitura', () => {
  const r = agentes.frontmatter('\uFEFF---\r\nname: busca\r\nmodel: barato\r\n---\r\n');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.campos.model, 'barato');
});

test('agentes: aspas em volta do valor saem', () => {
  const r = agentes.frontmatter('---\nmodel: "barato"\n---\n');
  assert.strictEqual(r.campos.model, 'barato');
});

// Foco de revisao 4: ausente e vazio sao a MESMA resposta - nao declarado.
test('agentes: model ausente fica undefined, nao string vazia', () => {
  const r = agentes.frontmatter('---\nname: busca\n---\n');
  assert.strictEqual(r.campos.model, undefined);
});

test('agentes: model vazio vira null', () => {
  const r = agentes.frontmatter('---\nname: busca\nmodel:\n---\n');
  assert.strictEqual(r.campos.model, null);
});

test('agentes: arquivo sem cerca nao e frontmatter', () => {
  assert.strictEqual(agentes.frontmatter('# so um titulo\n').ok, false);
});

test('agentes: cerca que abre e nunca fecha nao vale como lida', () => {
  const r = agentes.frontmatter('---\nname: busca\nmodel: barato\n');
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.campos, {});
});

test('agentes: pasta ausente devolve existe:false, nao lista vazia', (t) => {
  const raiz = pastaTemporaria(t);
  const r = agentes.listar(raiz);
  assert.strictEqual(r.existe, false);
  assert.deepStrictEqual(r.agentes, []);
});

test('agentes: pasta vazia devolve existe:true com lista vazia', (t) => {
  const raiz = pastaTemporaria(t);
  fs.mkdirSync(path.join(raiz, '.claude', 'agents'), { recursive: true });
  const r = agentes.listar(raiz);
  assert.strictEqual(r.existe, true);
  assert.deepStrictEqual(r.agentes, []);
});

test('agentes: le os agentes de uma raiz com espaco e acento no caminho', (t) => {
  const raiz = pastaTemporaria(t);
  assert.ok(/ /.test(raiz), 'a raiz de teste precisa ter espaco: ' + raiz);
  escrever(raiz, 'busca', '---\nname: busca\nmodel: barato\n---\n');
  escrever(raiz, 'arquiteto', '---\nname: arquiteto\nmodel: caro\n---\n');
  const r = agentes.listar(raiz);
  assert.strictEqual(r.existe, true);
  assert.deepStrictEqual(r.agentes.map((a) => a.nome), ['arquiteto', 'busca']);
  assert.deepStrictEqual(r.agentes.map((a) => a.model), ['caro', 'barato']);
});

test('agentes: agente sem model: aparece com model null, e nao some da lista', (t) => {
  const raiz = pastaTemporaria(t);
  escrever(raiz, 'solto', '---\nname: solto\n---\n');
  const r = agentes.listar(raiz);
  assert.strictEqual(r.agentes.length, 1);
  assert.strictEqual(r.agentes[0].model, null);
  assert.strictEqual(r.agentes[0].temFrontmatter, true);
});

test('agentes: arquivo sem frontmatter entra na lista marcado como tal', (t) => {
  const raiz = pastaTemporaria(t);
  escrever(raiz, 'rascunho', '# anotacao qualquer\n');
  const r = agentes.listar(raiz);
  assert.strictEqual(r.agentes[0].temFrontmatter, false);
  assert.strictEqual(r.agentes[0].nome, 'rascunho');
});

const molde = require('../scripts/lib/molde.js');

const PROJETO_ENSAIO = {
  versaoConfig: 1, quemDecide: 'dono', provaDePronto: 'npm test',
  modeloDeAmeaca: 'interno', marchas: {}, intocaveis: [], fontesCanonicas: [],
  marchaPadrao: 'padrao', limiares: {}, agentes: { escada: [] }
};

function moldeDoAgente() {
  return fs.readFileSync(path.join(__dirname, '..', 'modelos', 'agente.md'), 'utf8');
}

test('agentes: o molde do agente preenche e valida', () => {
  const texto = moldeDoAgente();
  const valores = {};
  for (const s of molde.slots(texto)) {
    if (s.tipo === 'texto') valores[s.nome] = 'conteudo de ensaio para ' + s.nome;
  }
  const cheio = molde.preencher(texto, valores, PROJETO_ENSAIO);
  const r = molde.validar(cheio);
  assert.strictEqual(r.ok, true, r.erros.join(' | '));
});

test('agentes: o molde produz frontmatter que o proprio leitor consegue ler', () => {
  const texto = moldeDoAgente();
  const valores = {};
  for (const s of molde.slots(texto)) {
    if (s.tipo === 'texto') valores[s.nome] = 'ensaio';
  }
  valores.nome = 'busca';
  valores.apelido = 'barato';
  const cheio = molde.preencher(texto, valores, PROJETO_ENSAIO);
  const f = agentes.frontmatter(cheio);
  assert.strictEqual(f.ok, true, 'o molde tem de gerar frontmatter valido');
  assert.strictEqual(f.campos.name, 'busca');
  assert.strictEqual(f.campos.model, 'barato');
});

// Decisao 12, pela segunda vez e de proposito: a T33 recusa o id na entrevista,
// e o molde recusa de novo na geracao. Duas guardas porque o arquivo gerado sai
// da mao do agente e vai direto para a pasta de configuracao da pessoa.
test('agentes: id de modelo no apelido faz a GERACAO ser recusada', () => {
  const texto = moldeDoAgente();
  const valores = {};
  for (const s of molde.slots(texto)) {
    if (s.tipo === 'texto') valores[s.nome] = 'ensaio';
  }
  valores.apelido = 'claude-haiku-4-5';
  const cheio = molde.preencher(texto, valores, PROJETO_ENSAIO);
  const r = molde.validar(cheio);
  assert.strictEqual(r.ok, false);
  assert.ok(r.erros.some((e) => e.includes('volatil')), r.erros.join(' | '));
});

const { spawnSync } = require('node:child_process');

const GERADOR = path.join(__dirname, '..', 'scripts', 'gerar-agentes.js');

function semearProjeto(raiz, degraus) {
  const dir = path.join(raiz, '.claude', 'sworn');
  fs.mkdirSync(dir, { recursive: true });
  const cfg = Object.assign({}, PROJETO_ENSAIO, {
    geradoEm: '2026-09-23',
    plataforma: { so: process.platform, shell: 'bash' },
    comandosBloqueados: [], comandosLiberados: [],
    travas: { fecho: true, escopo: true, destrutivo: true, outraFrente: true },
    agentes: require('../scripts/lib/degraus.js').paraProjeto(degraus)
  });
  fs.writeFileSync(path.join(dir, 'projeto.json'), JSON.stringify(cfg, null, 2), 'utf8');
}

const FATIAS_VALIDAS = { esforco: 'medium', ferramentas: 'Read, Grep, mcp__x__y', maxTurns: '20' };

/** As fatias de texto do molde, uma copia por degrau. O nome e o apelido NAO
 *  entram aqui: saem do projeto.json, e o gerador os injeta. */
function respostasEmArquivo(raiz, nomes) {
  const texto = moldeDoAgente();
  const porAgente = {};
  for (const nome of nomes) {
    porAgente[nome] = {};
    for (const s of molde.slots(texto)) {
      if (s.tipo === 'texto') porAgente[nome][s.nome] = 'conteudo de ensaio para ' + s.nome;
    }
    // As tres fatias com formato proprio (esforco, ferramentas, maxTurns) recusam
    // texto de ensaio; recebem valor valido, e a prova das recusas fica nos testes abaixo.
    Object.assign(porAgente[nome], FATIAS_VALIDAS);
  }
  const alvo = path.join(raiz, 'respostas.json');
  fs.writeFileSync(alvo, JSON.stringify(porAgente), 'utf8');
  return alvo;
}

function rodar(raiz, args) {
  return spawnSync(process.execPath, [GERADOR].concat(args || []), { cwd: raiz, encoding: 'utf8' });
}

const DOIS = [{ agente: 'busca', apelido: 'barato' }, { agente: 'arquiteto', apelido: 'caro' }];

test('agentes: sem --gravar o gerador propoe e NAO escreve arquivo nenhum', (t) => {
  const raiz = pastaTemporaria(t);
  semearProjeto(raiz, DOIS);
  const r = rodar(raiz, ['--respostas', respostasEmArquivo(raiz, ['busca', 'arquiteto'])]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes('PROPOSTA'), r.stdout);
  assert.strictEqual(fs.existsSync(agentes.caminho(raiz, 'busca')), false, 'proposta nao grava');
});

test('agentes: com --gravar escreve um arquivo por degrau, na pasta certa', (t) => {
  const raiz = pastaTemporaria(t);
  semearProjeto(raiz, DOIS);
  const r = rodar(raiz, ['--respostas', respostasEmArquivo(raiz, ['busca', 'arquiteto']), '--gravar']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(agentes.caminho(raiz, 'busca')), r.stdout);
  assert.ok(fs.existsSync(agentes.caminho(raiz, 'arquiteto')), r.stdout);
  const lido = agentes.listar(raiz);
  assert.deepStrictEqual(lido.agentes.map((a) => a.model), ['caro', 'barato']);
});

test('agentes: agente que ja existe e PULADO, e o gerador diz que pulou', (t) => {
  const raiz = pastaTemporaria(t);
  semearProjeto(raiz, DOIS);
  escrever(raiz, 'busca', '---\nname: busca\nmodel: nao-mexa\n---\ntrabalho de alguem\n');
  const r = rodar(raiz, ['--respostas', respostasEmArquivo(raiz, ['busca', 'arquiteto']), '--gravar']);
  assert.ok(r.stdout.includes('PULADO'), r.stdout);
  const lido = fs.readFileSync(agentes.caminho(raiz, 'busca'), 'utf8');
  assert.ok(lido.includes('trabalho de alguem'), 'o arquivo de alguem foi sobrescrito');
});

test('agentes: escada desalinhada faz o gerador parar antes de escrever', (t) => {
  const raiz = pastaTemporaria(t);
  semearProjeto(raiz, DOIS);
  const cfgPath = path.join(raiz, '.claude', 'sworn', 'projeto.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.agentes.escada = ['arquiteto', 'busca'];   // ordem trocada de proposito
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
  const r = rodar(raiz, ['--respostas', respostasEmArquivo(raiz, ['busca', 'arquiteto']), '--gravar']);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.strictEqual(fs.existsSync(agentes.caminho(raiz, 'busca')), false, 'nao pode escrever com escada torta');
});

test('agentes: projeto sem projeto.json para com erro legivel', (t) => {
  const raiz = pastaTemporaria(t);
  const r = rodar(raiz, ['--gravar']);
  assert.strictEqual(r.status, 1);
  assert.ok(r.stdout.includes('init'), r.stdout);
});

// O gerador recusa ANTES de propor quando falta resposta, e diz o que falta.
// Mesmo desenho do scripts/gerar-skill.js, que ja existia - e foi um ensaio em
// sandbox que mostrou que a versao anterior deste teste media a coisa errada.
test('agentes: sem respostas o gerador recusa e nomeia a fatia que falta', (t) => {
  const raiz = pastaTemporaria(t);
  semearProjeto(raiz, DOIS);
  const r = rodar(raiz, []);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.ok(r.stdout.includes('RECUSADO'), r.stdout);
  assert.ok(r.stdout.includes('papel'), 'tem de dizer QUAL fatia falta: ' + r.stdout);
  assert.strictEqual(fs.existsSync(agentes.caminho(raiz, 'busca')), false);
  // A4-09 (pedido 12, microcopy): o RECUSADO diz onde corrigir
  assert.ok(r.stdout.includes('  Passe as respostas com --respostas <arquivo.json>, uma chave por agente' +
    ' (os nomes das fatias saem com --fatias).\n'), r.stdout);
});

test('A4-09: com --respostas, o RECUSADO diz a chave e o arquivo a corrigir', (t) => {
  const raiz = pastaTemporaria(t);
  semearProjeto(raiz, DOIS);
  const arq = respostasAjustadas(raiz, ['busca', 'arquiteto'],
    (nome, f) => { if (nome === 'busca') f.maxTurns = 'x'; });
  const r = rodar(raiz, ['--respostas', arq]);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.ok(r.stdout.includes('RECUSADO busca:\n'), r.stdout);
  assert.ok(r.stdout.includes('  Corrija a chave "busca" de ' + arq + ' e rode de novo.\n'), r.stdout);
  assert.ok(!r.stdout.includes('chave "arquiteto"'), 'o agente aceito nao entra na dica: ' + r.stdout);
});

test('A4-42: sem degraus, o erro manda rodar o /sworn:init', (t) => {
  const raiz = pastaTemporaria(t);
  semearProjeto(raiz, []);
  const r = rodar(raiz, []);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.ok(r.stdout.startsWith('ERRO: este projeto nao tem degraus gravados.\n' +
    'Rode /sworn:init: a entrevista pergunta os degraus, e sem eles nao ha o que gerar\n'), r.stdout);
});

// A4-84 (pedido 12, microcopy): sem "frontmatter" solto no erro; o nome do lugar em portugues.
test('A4-84: sem degraus, o erro diz o cabecalho do arquivo do agente, sem "frontmatter"', (t) => {
  const raiz = pastaTemporaria(t);
  semearProjeto(raiz, []);
  const r = rodar(raiz, []);
  assert.ok(r.stdout.includes('\n(nem nome de agente, nem apelido para escrever no cabecalho do arquivo do agente).\n'),
    r.stdout);
  assert.ok(!r.stdout.includes('frontmatter'), r.stdout);
});

// ---- T10-8: effort, tools, maxTurns e a escalada (nº 2 e 4 do inventario) ----

const TRES = [
  { agente: 'busca', apelido: 'barato' },
  { agente: 'dev', apelido: 'medio' },
  { agente: 'arquiteto', apelido: 'caro' }
];

/** Respostas validas para todos, com `ajuste(nome, fatias)` mexendo numa so. */
function respostasAjustadas(raiz, nomes, ajuste) {
  const alvo = respostasEmArquivo(raiz, nomes);
  const porAgente = JSON.parse(fs.readFileSync(alvo, 'utf8'));
  for (const nome of nomes) ajuste(nome, porAgente[nome]);
  fs.writeFileSync(alvo, JSON.stringify(porAgente), 'utf8');
  return alvo;
}

function gerar(t, degraus, ajuste) {
  const raiz = pastaTemporaria(t);
  semearProjeto(raiz, degraus);
  const nomes = degraus.map((d) => d.agente);
  const arq = respostasAjustadas(raiz, nomes, ajuste || function () {});
  const r = rodar(raiz, ['--respostas', arq, '--gravar']);
  return { raiz, r };
}

test('agentes: o molde cheio traz effort, tools, maxTurns e a secao de escalada', (t) => {
  const { raiz, r } = gerar(t, DOIS);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const bruto = fs.readFileSync(agentes.caminho(raiz, 'busca'), 'utf8');
  const f = agentes.frontmatter(bruto);
  assert.strictEqual(f.ok, true);
  assert.strictEqual(f.campos.effort, 'medium');
  assert.strictEqual(f.campos.tools, 'Read, Grep, mcp__x__y');
  assert.strictEqual(f.campos.maxTurns, '20');
  assert.ok(bruto.includes('## When to stop and escalate'), bruto);
});

test('agentes: escalaPara do degrau do meio e o proximo; a do ultimo aponta quem decide', (t) => {
  const { raiz, r } = gerar(t, TRES);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const secao = (nome) => {
    const bruto = fs.readFileSync(agentes.caminho(raiz, nome), 'utf8');
    const i = bruto.indexOf('## When to stop and escalate');
    assert.ok(i !== -1, nome + ' sem a secao');
    return bruto.slice(i, bruto.indexOf('\n## ', i + 5) === -1 ? undefined : bruto.indexOf('\n## ', i + 5));
  };
  assert.ok(secao('busca').includes('`dev`'), secao('busca'));
  assert.ok(secao('dev').includes('`arquiteto`'), secao('dev'));
  const topo = secao('arquiteto');
  assert.ok(topo.includes('quemDecide'), topo);
  assert.ok(topo.includes('.claude/sworn/projeto.json'), topo);
  assert.ok(!topo.includes('`dev`') && !topo.includes('`busca`'), 'o ultimo degrau nao escala para agente: ' + topo);
  assert.ok(!topo.includes('dono'), 'D10: o valor de quemDecide nao e impresso: ' + topo);
});

test('agentes: resposta que tenta sobrescrever escalaPara e ignorada', (t) => {
  const { raiz, r } = gerar(t, TRES, (nome, fatias) => { fatias.escalaPara = 'o estagiario'; });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const bruto = fs.readFileSync(agentes.caminho(raiz, 'busca'), 'utf8');
  assert.ok(!bruto.includes('estagiario'), bruto);
  assert.ok(bruto.includes('`dev`'), bruto);
});

test('agentes: --fatias cita escalaPara junto de nome e apelido como fatias do gerador', (t) => {
  const raiz = pastaTemporaria(t);
  semearProjeto(raiz, DOIS);
  const r = rodar(raiz, ['--fatias']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const j = JSON.parse(r.stdout);
  assert.ok(j.observacao.includes('escalaPara'), j.observacao);
  // O esforco gravado no degrau vence o do arquivo de respostas: a observacao tem de dizer isso.
  assert.ok(j.observacao.includes('esforco'), j.observacao);
  for (const f of ['esforco', 'ferramentas', 'maxTurns', 'escalaPara']) {
    assert.ok(j.fatias.indexOf(f) !== -1, 'falta a fatia ' + f + ': ' + j.fatias.join(','));
  }
});

// D678 T1: a tabela e a fonte do esforco, como e do apelido; a resposta por agente so vale sem ele na tabela.
test('D678 T1: o esforco gravado no degrau vai para o effort: e vence a resposta', (t) => {
  const tabela = [{ agente: 'busca', apelido: 'barato', esforco: 'low' }, { agente: 'arquiteto', apelido: 'caro' }];
  const { raiz, r } = gerar(t, tabela);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(agentes.frontmatter(fs.readFileSync(agentes.caminho(raiz, 'busca'), 'utf8')).campos.effort, 'low');
  assert.strictEqual(agentes.frontmatter(fs.readFileSync(agentes.caminho(raiz, 'arquiteto'), 'utf8')).campos.effort,
    'medium', 'degrau sem esforco na tabela usa a resposta');
});

test('D678 T1: listar devolve o effort: de cada agente (null quando nao declara)', (t) => {
  const raiz = pastaTemporaria(t);
  escrever(raiz, 'busca', '---\nname: busca\nmodel: haiku\neffort: low\n---\n');
  escrever(raiz, 'solto', '---\nname: solto\nmodel: opus\n---\n');
  const l = agentes.listar(raiz);
  assert.deepStrictEqual(l.agentes.map((a) => [a.nome, a.effort]), [['busca', 'low'], ['solto', null]]);
});

test('agentes: esforco fora de low|medium|high|xhigh|max e RECUSADO, dizendo o aceito', (t) => {
  const { raiz, r } = gerar(t, DOIS, (nome, f) => { f.esforco = 'altissimo'; });
  assert.strictEqual(r.status, 1, r.stdout);
  assert.ok(r.stdout.includes('RECUSADO'), r.stdout);
  assert.ok(r.stdout.includes('esforco'), r.stdout);
  assert.ok(r.stdout.includes('low|medium|high|xhigh|max'), r.stdout);
  assert.strictEqual(fs.existsSync(agentes.caminho(raiz, 'busca')), false, 'recusado nao grava');
});

test('agentes: maxTurns que nao e inteiro >= 1 e RECUSADO, dizendo o aceito', (t) => {
  for (const ruim of ['0', '-3', '2.5', 'muitos', '']) {
    const { raiz, r } = gerar(t, DOIS, (nome, f) => { f.maxTurns = ruim; });
    assert.strictEqual(r.status, 1, 'maxTurns "' + ruim + '" devia ser recusado: ' + r.stdout);
    assert.ok(r.stdout.includes('RECUSADO'), r.stdout);
    assert.ok(r.stdout.includes('maxTurns'), r.stdout);
    if (ruim !== '') assert.ok(r.stdout.includes('inteiro'), 'tem de dizer o valor aceito: ' + r.stdout);
    assert.strictEqual(fs.existsSync(agentes.caminho(raiz, 'busca')), false);
  }
});

const FORMATO_DITO = 'nomes que comecam com letra e levam so letras, numeros, _ ou - (como Read, Grep)';

test('agentes: ferramentas vazia ou com item fora de [A-Za-z][A-Za-z0-9_-]* e RECUSADA', (t) => {
  for (const ruim of ['', ' , ', 'Read, Gre p', 'Read, 9x', 'Read; Grep', 'Read, Bash(rm *)']) {
    const { raiz, r } = gerar(t, DOIS, (nome, f) => { f.ferramentas = ruim; });
    assert.strictEqual(r.status, 1, 'ferramentas "' + ruim + '" devia ser recusada: ' + r.stdout);
    assert.ok(r.stdout.includes('RECUSADO'), r.stdout);
    assert.ok(r.stdout.includes('ferramentas'), r.stdout);
    // Vale tambem para a vazia: o POR PREENCHER do molde recusa, mas nao diz o formato aceito.
    // A4-08 (pedido 12, microcopy): o formato em frase, sem a regex crua.
    assert.ok(r.stdout.includes(FORMATO_DITO), 'tem de dizer o valor aceito: ' + r.stdout);
    assert.ok(!r.stdout.includes('[A-Za-z]'), 'regex crua na mensagem: ' + r.stdout);
    assert.strictEqual(fs.existsSync(agentes.caminho(raiz, 'busca')), false);
  }
});

test('agentes: caso valido com maxTurns numerico no JSON grava', (t) => {
  const { raiz, r } = gerar(t, DOIS, (nome, f) => { f.maxTurns = 8; f.esforco = 'xhigh'; });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const f = agentes.frontmatter(fs.readFileSync(agentes.caminho(raiz, 'arquiteto'), 'utf8'));
  assert.strictEqual(f.campos.maxTurns, '8');
  assert.strictEqual(f.campos.effort, 'xhigh');
});

test('agentes: validarFatias aceita o caso bom e nao devolve erro', () => {
  assert.deepStrictEqual(agentes.validarFatias({ esforco: 'low', ferramentas: 'Read,Grep', maxTurns: '1' }), []);
});

test('agentes: validarFatias aceita nome de ferramenta MCP com hifen', () => {
  assert.deepStrictEqual(agentes.validarFatias({ ferramentas: 'Read, mcp__claude-in-chrome__navigate' }), []);
  assert.deepStrictEqual(agentes.validarFatias({ ferramentas: 'mcp__plugin_context-mode_context-mode__ctx_search' }), []);
});

test('agentes: validarFatias segue recusando parenteses e hifen no comeco', () => {
  assert.strictEqual(agentes.validarFatias({ ferramentas: 'Bash(rm *)' }).length, 1);
  assert.strictEqual(agentes.validarFatias({ ferramentas: '-Read' }).length, 1);
});

test('agentes: validarFatias recusa ferramentas que nao e texto, dizendo o formato e sem chamar de vazia', () => {
  for (const ruim of [['Read', 'Grep'], 5, null, true]) {
    const erros = agentes.validarFatias({ ferramentas: ruim });
    assert.strictEqual(erros.length, 1, JSON.stringify(ruim) + ' -> ' + JSON.stringify(erros));
    assert.ok(!/vazia/.test(erros[0]), 'nao pode mentir que esta vazia: ' + erros[0]);
    assert.ok(/separadas por virgula/.test(erros[0]), erros[0]);
    assert.ok(erros[0].includes(FORMATO_DITO) && !erros[0].includes('[A-Za-z]'), erros[0]);
  }
  const lista = agentes.validarFatias({ ferramentas: ['Read', 'Grep'] });
  assert.ok(/lista/.test(lista[0]), lista[0]);
});

test('agentes: validarFatias: ferramentas em string vazia segue "vazia"', () => {
  for (const vazia of ['', '   ']) {
    const erros = agentes.validarFatias({ ferramentas: vazia });
    assert.strictEqual(erros.length, 1, JSON.stringify(erros));
    assert.ok(/vazia/.test(erros[0]), erros[0]);
    assert.ok(/separadas por virgula/.test(erros[0]), erros[0]);
    assert.ok(erros[0].includes(FORMATO_DITO) && !erros[0].includes('[A-Za-z]'), erros[0]);
  }
});

test('agentes: validarFatias recusa esforco e maxTurns de tipo errado, citando o campo', () => {
  const casos = [['maxTurns', true], ['maxTurns', ['8']], ['maxTurns', null], ['esforco', ['high']], ['esforco', null], ['esforco', false]];
  for (const [campo, valor] of casos) {
    const erros = agentes.validarFatias({ [campo]: valor });
    assert.strictEqual(erros.length, 1, campo + '=' + JSON.stringify(valor) + ' -> ' + JSON.stringify(erros));
    assert.ok(erros[0].startsWith(campo), erros[0]);
  }
});

test('H-5: frontmatter desfaz o escape do valor citado (aspas duplas e simples); sem aspas segue cru', () => {
  const B = String.fromCharCode(92); // a barra invertida, sem depender de escape no fonte
  const f = agentes.frontmatter('---\nname: busca\n' +
    'description: "Use quando: o gatilho for ' + B + '"busca' + B + '" ou C:' + B + B + 'x"\n' +
    "a: 'Use quando: it''s ok'\n" +
    'b: Use quando: cru\n' +
    'c: "meio' + B + '"\n---\n');
  assert.strictEqual(f.ok, true);
  assert.strictEqual(f.campos.description, 'Use quando: o gatilho for "busca" ou C:' + B + 'x');
  assert.strictEqual(f.campos.a, "Use quando: it's ok");
  assert.strictEqual(f.campos.b, 'Use quando: cru');
  assert.strictEqual(f.campos.c, 'meio' + B, 'aspa que fecha escapada nao e valor citado: so tira as pontas, como antes');
});

// A4-age-1 (pedido 12, estados): todo erro do readdir virava existe:false, e o gatilho 3 dizia "nao tem a pasta
// .claude/agents" de uma pasta que existe e nao se le. So ENOENT e "nao tem"; o resto leva a causa ate o motivo.
test('A4-age-1: pasta de agentes que nao se le diz a causa, nunca "nao tem a pasta"', (t) => {
  const apelidos = require('../scripts/lib/apelidos.js');
  const raiz = pastaTemporaria(t);
  fs.mkdirSync(path.join(raiz, '.claude'));
  fs.writeFileSync(path.join(raiz, '.claude', 'agents'), 'sou arquivo\n', 'utf8');
  const r = agentes.listar(raiz);
  assert.strictEqual(r.existe, false);
  assert.ok(/\(ENOTDIR\)/.test(r.erro), 'sem a causa: ' + r.erro);
  const c = apelidos.conferir({ agentes: { degraus: [{ agente: 'busca', apelido: 'barato' }] } }, r);
  assert.strictEqual(c.verificavel, false);
  assert.ok(/\.claude\/agents nao se le \(.*ENOTDIR\)/.test(c.motivo), c.motivo);
  assert.strictEqual(c.motivo.indexOf('nao tem a pasta'), -1, c.motivo);
  assert.strictEqual(agentes.listar(pastaTemporaria(t)).erro, undefined, 'pasta ausente nao e erro de leitura');
});

// A4-age-2 (pedido 12, estados+manutencao): agente que nao se le virava texto vazio e caia em naoDeclarados - "o
// arquivo nao diz model:" de um arquivo que ninguem leu. Agora sai com a causa, num balde proprio.
test('A4-age-2: agente ilegivel vai para ilegiveis com a causa, nunca para naoDeclarados', (t) => {
  const apelidos = require('../scripts/lib/apelidos.js');
  const raiz = pastaTemporaria(t);
  const alvo = escrever(raiz, 'busca', '---\nname: busca\nmodel: barato\n---\n');
  escrever(raiz, 'arquiteto', '---\nname: arquiteto\nmodel: caro\n---\n');
  const ler = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', function (p) {
    if (path.resolve(String(p)) === path.resolve(alvo)) {
      const e = new Error('negado'); e.code = 'EACCES'; throw e;
    }
    return ler.apply(fs, arguments);
  });
  const r = agentes.listar(raiz);
  const busca = r.agentes.filter((a) => a.arquivo === 'busca.md')[0];
  assert.ok(/sem permissao \(EACCES\)/.test(busca.erro), 'sem a causa: ' + busca.erro);
  assert.strictEqual(r.agentes.filter((a) => a.arquivo === 'arquiteto.md')[0].erro, undefined);
  const mapa = { agentes: { degraus: [{ agente: 'busca', apelido: 'barato' }, { agente: 'arquiteto', apelido: 'caro' }] } };
  const c = apelidos.conferir(mapa, r);
  assert.deepStrictEqual(c.naoDeclarados, [], 'arquivo nao lido nao "deixa de declarar"');
  assert.deepStrictEqual(c.ilegiveis, [{ agente: 'busca', arquivo: 'busca.md', causa: busca.erro }]);
  assert.deepStrictEqual(c.semArquivo, [], 'o arquivo existe: nao e semArquivo');
});

function rodarComTeto(raiz, args) {
  return spawnSync(process.execPath, [GERADOR].concat(args || []), { cwd: raiz, encoding: 'utf8', timeout: 60000 });
}

// A4-gag-1 (pedido 12, borda): `--respostas` sem valor caia calado - ultima da linha virava "sem respostas", e
// `--respostas --gravar` lia um arquivo chamado "--gravar". Agora e erro de uso que nomeia a flag (molde:
// preparar-revisao.js), e nada se grava.
test('A4-gag-1: --respostas sem valor e erro de uso, e nada e gravado', (t) => {
  const raiz = pastaTemporaria(t);
  semearProjeto(raiz, DOIS);
  [['--respostas'], ['--respostas', ''], ['--respostas', '--gravar']].forEach((args) => {
    const r = rodarComTeto(raiz, args);
    assert.strictEqual(r.status, 1, args.join(' ') + ': ' + r.stdout + r.stderr);
    assert.ok(/--respostas pede um valor/.test(r.stdout) && /uso: gerar-agentes\.js/.test(r.stdout), r.stdout);
    assert.strictEqual(fs.existsSync(path.join(raiz, '.claude', 'agents')), false, args.join(' ') + ': gravou');
  });
});

// A4-gag-2 (pedido 12, borda+microcopy): respostas `null` estourava em TypeError cru; JSON quebrado saia como "nao
// consegui ler". Agora as duas frases do lerRespostas do molde.js.
test('A4-gag-2: respostas null ou JSON quebrado sai com a frase certa, sem excecao crua', (t) => {
  const raiz = pastaTemporaria(t);
  semearProjeto(raiz, DOIS);
  fs.writeFileSync(path.join(raiz, 'nulo.json'), 'null', 'utf8');
  fs.writeFileSync(path.join(raiz, 'quebrado.json'), '{"busca": ', 'utf8');
  let r = rodarComTeto(raiz, ['--respostas', 'nulo.json']);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(/ERRO: nulo\.json tem de ser um objeto JSON/.test(r.stdout), r.stdout);
  assert.strictEqual(/TypeError/.test(r.stderr), false, r.stderr);
  r = rodarComTeto(raiz, ['--respostas', 'quebrado.json']);
  assert.ok(/ERRO: quebrado\.json nao e JSON valido/.test(r.stdout), r.stdout);
  assert.strictEqual(r.stdout.indexOf('nao consegui ler'), -1, r.stdout);
});

// A4-gag-3 (pedido 12, seguranca): o nome do degrau vira o nome do arquivo (agentes.caminho), e fora da regra NOME
// (degraus.js:12) - com `..` - o agente ia parar fora de .claude/agents. Agora e RECUSADO antes de montar o caminho.
test('A4-gag-3: degrau com nome fora da regra NOME e recusado, e nada se grava fora da pasta', (t) => {
  const raiz = pastaTemporaria(t);
  semearProjeto(raiz, [{ agente: '../fora', apelido: 'barato' }, { agente: 'arquiteto', apelido: 'caro' }]);
  const r = rodarComTeto(raiz, ['--respostas', respostasEmArquivo(raiz, ['../fora', 'arquiteto']), '--gravar']);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(/RECUSADO "\.\.\/fora":\n\s+- nome de agente invalido/.test(r.stdout), r.stdout);
  assert.strictEqual(fs.existsSync(path.join(raiz, '.claude', 'fora.md')), false, 'gravou fora de .claude/agents');
  assert.ok(fs.existsSync(agentes.caminho(raiz, 'arquiteto')), 'o degrau valido segue gravado: ' + r.stdout);
});

// A4-gag-4 (pedido 12, estados): mkdir e write sem try - a pasta que nao se cria saia em excecao crua, sem GRAVADO
// nem ERRO. Agora cada agente nao gravado sai com a causa, e a saida e 1.
test('A4-gag-4: agente que nao se grava sai com a causa e saida 1, sem excecao crua', (t) => {
  const raiz = pastaTemporaria(t);
  semearProjeto(raiz, DOIS);
  fs.writeFileSync(path.join(raiz, '.claude', 'agents'), 'sou arquivo\n', 'utf8');
  const r = rodarComTeto(raiz, ['--respostas', respostasEmArquivo(raiz, ['busca', 'arquiteto']), '--gravar']);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(/NAO GRAVADO: .*busca\.md \(.*\)/.test(r.stdout), r.stdout);
  assert.ok(/GRAVADOS: 0 .* NAO GRAVADOS: 2/.test(r.stdout), r.stdout);
  assert.strictEqual(/\n\s+at /.test(r.stderr), false, 'excecao crua: ' + r.stderr);
});

// A4-gag-5 (pedido 12, R2 da A4, estados - a classe do A4-gsk-3): o agente que aparece entre o existsSync e o write
// era sobrescrito (flag 'w'). O --require faz o existsSync nao ver o busca.md que ja esta la.
test('A4-gag-5: agente que aparece entre a conferencia e a escrita nao e sobrescrito', (t) => {
  const raiz = pastaTemporaria(t);
  semearProjeto(raiz, DOIS);
  const alvo = agentes.caminho(raiz, 'busca');
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, 'agente do dono\n', 'utf8');
  const cego = path.join(raiz, 'cego.js');
  fs.writeFileSync(cego, "const fs = require('fs'); const e = fs.existsSync;\n" +
    "fs.existsSync = function (p) {\n  return /busca\.md$/.test(String(p)) ? false : e.apply(fs, arguments);\n};\n",
    'utf8');
  const r = spawnSync(process.execPath, ['--require', cego, GERADOR, '--respostas',
    respostasEmArquivo(raiz, ['busca', 'arquiteto']), '--gravar'], { cwd: raiz, encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(/NAO GRAVADO: .*busca\.md \(ja existe \(EEXIST\)\)/.test(r.stdout), r.stdout);
  assert.strictEqual(fs.readFileSync(alvo, 'utf8'), 'agente do dono\n', 'sobrescreveu');
});
