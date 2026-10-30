'use strict';
// Entrega D. Regra sem cicatriz e opiniao (criterio 8 de modelos/boa-skill.md), e
// manual que cresce por acumulacao cobra contexto de TODA sessao de quem instala.
// O teste que mais importa aqui e o do modo degradado: sem corpus, o relatorio
// TEM de se declarar cego - chamar tudo de "sem cicatriz" seria o mesmo silencio
// que este modulo existe para quebrar.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const cicatriz = require('../scripts/lib/cicatriz.js');

const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'cicatriz.js');
const BARRA = String.fromCharCode(92);

/** Foco de revisao 5: caminho com espaco e acento e o caso normal, nao a borda. */
function pasta() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sworn cicatriz ação-')); }

function escrever(dir, rel, conteudo) {
  const alvo = path.join(dir, rel);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, conteudo, 'utf8');
}

/** Um manual com dois itens: um que o corpus explica, outro que ninguem explica. */
function manualDeTeste(dir) {
  escrever(dir, path.join('manual', 'SKILL.md'),
    '# manual\n\n' +
    '- ao publicar deploy que muda contrato -> publicar o frontend compativel no mesmo ato\n' +
    '- ao escrever texto -> usar linguagem cordata e elegante\n');
  return path.join(dir, 'manual');
}

function corpusDeTeste(dir) {
  escrever(dir, path.join('historico', 'decisoes.md'),
    '### D42 - o deploy de contrato e par atomico\n\n' +
    'Data: uma quarta-feira. Decisao do dono. O deploy assimetrico quebrou as abas,\n' +
    'porque o backend endurecido subiu e o frontend compativel nunca foi publicado.\n');
  return path.join(dir, 'historico');
}

// ------------------------------------------------------------------ as marcas

test('cicatriz: as tres classes de marca sao reconhecidas, e prosa nao e marca', () => {
  assert.deepStrictEqual(cicatriz.marcas('registrado na D42, decisao do dono'), ['decisao']);
  assert.deepStrictEqual(cicatriz.marcas('o achado R-T15-01 continua aberto'), ['achado']);
  assert.deepStrictEqual(cicatriz.marcas('o deploy quebrou as abas naquele mes'), ['incidente']);
  assert.deepStrictEqual(cicatriz.marcas('escreva com clareza e cuidado'), []);
});

test('cicatriz: uma passagem pode carregar mais de uma marca, sem repetir tipo', () => {
  const t = cicatriz.marcas('a D42 nasceu porque o servico quebrou; ver o achado R-T15-01');
  assert.deepStrictEqual(t, ['achado', 'decisao', 'incidente']);
});

test('cicatriz: as passagens sao partidas por cabecalho, com a linha certa', () => {
  const p = cicatriz.passagens('# um\n\ncorpo um\n\n## dois\n\ncorpo dois\n');
  assert.strictEqual(p.length, 2);
  assert.strictEqual(p[0].linha, 1);
  assert.strictEqual(p[1].linha, 5);
  assert.ok(/corpo dois/.test(p[1].texto));
});

test('cicatriz: arquivo sem cabecalho nenhum continua sendo uma passagem', () => {
  assert.strictEqual(cicatriz.passagens('so prosa\nmais prosa\n').length, 1);
});

/**
 * Metade do conserto mora aqui. Sem teto, uma secao de centenas de linhas vira
 * UMA passagem, acumula toda marca que existe e divide termo com qualquer regra
 * - foi assim que 169 de 177 itens sairam "com cicatriz" na primeira medicao.
 */
test('cicatriz: secao mais longa que o teto e partida em pedacos, com linha certa', () => {
  // O teto e PRESO aqui, como o piso de termos. Medir o corte contra a propria
  // constante faria o teste sobreviver a qualquer mudanca dela - foi o que
  // aconteceu na primeira versao deste teste, e a mutacao denunciou.
  assert.strictEqual(cicatriz.MAX_LINHAS_POR_PASSAGEM, 40);

  const corpo = [];
  for (let i = 0; i < 120; i++) corpo.push('linha ' + i);
  const p = cicatriz.passagens('# unica secao\n' + corpo.join('\n'));
  assert.strictEqual(p.length, 4, 'cabecalho + 120 linhas em pedacos de 40 = 4');
  assert.strictEqual(p[0].linha, 1);
  assert.strictEqual(p[1].linha, 41, 'a linha do pedaco tem de andar com o teto');
  assert.ok(p.every(function (x) { return x.texto.split('\n').length <= 40; }),
    'nenhum pedaco pode passar do teto');
});

// ------------------------------------------------------------- itens e indice

test('cicatriz: itensDe le marcador e numero, e ignora linha que nao e item', () => {
  const dir = pasta();
  try {
    escrever(dir, path.join('m', 'a.md'), '# titulo\n\n- primeiro\n2. segundo\n\nprosa solta\n');
    const itens = cicatriz.itensDe(path.join(dir, 'm'));
    assert.strictEqual(itens.length, 2, JSON.stringify(itens));
    assert.strictEqual(itens[0].texto, 'primeiro');
    assert.strictEqual(itens[1].linha, 4);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('cicatriz: so passagem COM marca entra no indice', () => {
  const dir = pasta();
  try {
    escrever(dir, path.join('h', 'x.md'), '# sem marca\n\nprosa cordata\n\n# com marca\n\nvirou a D9\n');
    const ind = cicatriz.indexar(path.join(dir, 'h'));
    assert.strictEqual(ind.length, 1, JSON.stringify(ind));
    assert.deepStrictEqual(ind[0].tipos, ['decisao']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------- conferir

/**
 * Dois botoes, e os DOIS valem. So o piso absoluto nao serve: foi medido que,
 * com ele sozinho, 169 de 177 itens do manual saiam "com cicatriz", todos com
 * os tres tipos ao mesmo tempo - passagem longa divide dois termos com qualquer
 * regra. A fracao e o que faz "aparecer junto" querer dizer alguma coisa.
 */
test('cicatriz: um termo em comum NAO basta - o piso absoluto vale', () => {
  const dir = pasta();
  try {
    escrever(dir, path.join('h', 'd.md'), '# D7\n\ndecisao sobre o deploy daquele dia\n');
    const ind = cicatriz.indexar(path.join(dir, 'h'));
    const item = { texto: 'ao fazer deploy -> avisar alguem' };
    assert.strictEqual(cicatriz.conferir(item, ind).temCicatriz, false);
    assert.strictEqual(cicatriz.MINIMO_DE_TERMOS, 2);
    assert.strictEqual(cicatriz.FRACAO_MINIMA, 0.6);
    // e o inverso: afrouxando SO a fracao, o piso segura sozinho - 1 de 3 termos
    // passa de 0,3 e mesmo assim nao liga. Sem esta linha, apagar o piso do
    // conferir deixava a suite verde: so a constante estava presa, nao o efeito.
    assert.strictEqual(cicatriz.conferir(item, ind, undefined, 0.3).temCicatriz, false,
      'afrouxar so a fracao nao pode abrir a porta; o piso e o primeiro botao');
    // mesmo afrouxando o piso, a fracao continua segurando: 1 de 3 termos nao liga nada
    assert.strictEqual(cicatriz.conferir(item, ind, 1).temCicatriz, false,
      'afrouxar so o piso nao pode abrir a porta; a fracao e o segundo botao');
    assert.strictEqual(cicatriz.conferir(item, ind, 1, 0.3).temCicatriz, true,
      'afrouxando os dois, o mesmo item passa - e e assim que se prova que os dois mandam');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/**
 * Limite declarado, nao defeito a consertar: a ligacao e por palavra EXATA.
 * "publicar" nao casa "publicado". E a razao pela qual o relatorio diz, com
 * todas as letras, que ele e sinal e nao veredito - e a razao de a fracao ser
 * um botao, e nao um numero escondido no codigo.
 */
test('cicatriz: a ligacao e por palavra exata - flexao diferente NAO casa', () => {
  const dir = pasta();
  try {
    escrever(dir, path.join('h', 'd.md'), '# D8\n\na decisao veio depois que o servico foi publicado\n');
    const ind = cicatriz.indexar(path.join(dir, 'h'));
    const r = cicatriz.conferir({ texto: 'ao publicar servico -> avisar antes' }, ind, 1, 0.1);
    assert.strictEqual(r.temCicatriz, true, 'servico deveria casar');
    assert.deepStrictEqual(r.provas[0].termos, ['servico'],
      'se "publicar" casasse "publicado", este limite nao existiria e o teste estaria errado');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('cicatriz: a prova vem com arquivo, linha, tipo e os termos que ligaram', () => {
  const dir = pasta();
  try {
    const corpus = corpusDeTeste(dir);
    const ind = cicatriz.indexar(corpus);
    // 4 dos 6 termos da regra aparecem na passagem: 0,67 - acima do piso padrao
    // de 0,6 ("publicar" nao casa "publicado", por isso nao sao 5). O 0,5 explicito
    // nao e necessario a esta fixture: fica para este teste medir o FORMATO da
    // prova, nao o piso - quem mede o piso e a fracao sao os testes dos dois botoes, acima.
    const r = cicatriz.conferir(
      { texto: 'ao publicar deploy que muda contrato -> publicar o frontend compativel' },
      ind, undefined, 0.5);
    assert.strictEqual(r.temCicatriz, true, JSON.stringify(ind.map(function (i) { return Array.from(i.termos); })));
    const p = r.provas[0];
    assert.strictEqual(p.arquivo, 'decisoes.md');
    assert.strictEqual(typeof p.linha, 'number');
    assert.ok(p.tipos.indexOf('decisao') !== -1, JSON.stringify(p.tipos));
    assert.ok(p.termos.length >= 2, JSON.stringify(p.termos));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --------------------------------------------------------------------- varrer

test('cicatriz: a varredura separa quem tem dor de origem de quem nao tem', () => {
  const dir = pasta();
  try {
    const r = cicatriz.varrer(manualDeTeste(dir), corpusDeTeste(dir), { fracao: 0.5 });
    assert.strictEqual(r.corpusLido, true);
    assert.strictEqual(r.resumo.total, 2);
    assert.strictEqual(r.resumo.comCicatriz, 1, JSON.stringify(r.itens, null, 1));
    assert.strictEqual(r.resumo.semCicatriz, 1);
    const sem = r.itens.filter(function (a) { return !a.temCicatriz; })[0];
    assert.ok(/cordata/.test(sem.texto), 'o item sem cicatriz tinha de ser o da prosa bonita');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/**
 * O teste central. Sem corpus, devolver tudo como "sem cicatriz" produziria uma
 * lista de poda inteiramente falsa - e ela parece exatamente igual a uma lista
 * verdadeira. O relatorio tem de dizer que esta cego.
 */
test('cicatriz: SEM corpus o relatorio se declara cego, em vez de podar tudo', () => {
  const dir = pasta();
  try {
    const r = cicatriz.varrer(manualDeTeste(dir), null);
    assert.strictEqual(r.corpusLido, false);
    assert.strictEqual(r.resumo.total, 2, 'os itens continuam sendo lidos e listados');
    const t = cicatriz.texto(r);
    assert.ok(/CORPUS NAO LIDO/.test(t), t);
    assert.ok(/seria mentir/.test(t), 'tem de dizer POR QUE o silencio seria mentira: ' + t);
    // e SO quando esta cego: com o corpus lido, o mesmo aviso seria alarme falso,
    // e aviso que aparece sempre ensina a nao ler aviso
    const lido = cicatriz.texto(cicatriz.varrer(manualDeTeste(dir), corpusDeTeste(dir)));
    assert.ok(!/CORPUS NAO LIDO/.test(lido),
      'com o corpus lido, o relatorio nao pode se dizer cego: ' + lido);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('cicatriz: corpus apontado para caminho inexistente tambem cai no modo degradado', () => {
  const dir = pasta();
  try {
    const r = cicatriz.varrer(manualDeTeste(dir), path.join(dir, 'nao-existe'));
    assert.strictEqual(r.corpusLido, false);
    assert.doesNotThrow(function () { cicatriz.texto(r); });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/**
 * Medido: contando pela UNIAO das provas, um historico grande dava 166 decisao,
 * 166 incidente e 163 achado - tres numeros praticamente iguais. Numero que nao
 * separa nada e decoracao com casas decimais. Conta-se pela prova mais forte.
 */
test('cicatriz: o resumo por tipo conta a prova MAIS FORTE, nao a uniao delas', () => {
  const dir = pasta();
  try {
    escrever(dir, path.join('manual', 'SKILL.md'),
      '# m\n\n- ao mexer no indice do repositorio -> refazer a foto de abertura\n');
    // forte: 5 termos, so marca de decisao. fraca: 2 termos, marca de incidente.
    // A fraca vem PRIMEIRO na ordem dos arquivos, de proposito: com a forte na
    // frente por acaso do alfabeto, apagar a ordenacao das provas deixava a suite
    // verde - o teste nao via se a primeira prova era a mais forte ou so a primeira.
    escrever(dir, path.join('h', 'b-forte.md'),
      '# D51\n\na decisao sobre mexer no indice do repositorio, e sobre refazer a foto\n');
    escrever(dir, path.join('h', 'a-fraca.md'),
      '# outra\n\no indice do repositorio quebrou naquele dia\n');

    const r = cicatriz.varrer(path.join(dir, 'manual'), path.join(dir, 'h'), { fracao: 0.3 });
    const item = r.itens[0];
    assert.strictEqual(item.temCicatriz, true, JSON.stringify(item, null, 1));
    assert.ok(item.tipos.indexOf('incidente') !== -1, 'a uniao ainda mostra os dois tipos');
    assert.deepStrictEqual(item.provas[0].tipos, ['decisao'], 'a prova mais forte e a decisao');
    assert.strictEqual(r.resumo.porTipo.decisao, 1);
    assert.strictEqual(r.resumo.porTipo.incidente, 0,
      'a prova fraca nao pode entrar na contagem por tipo');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('cicatriz: manual vazio nao estoura e devolve zero, nao devolve lixo', () => {
  const dir = pasta();
  try {
    fs.mkdirSync(path.join(dir, 'vazio'), { recursive: true });
    const r = cicatriz.varrer(path.join(dir, 'vazio'), corpusDeTeste(dir));
    assert.strictEqual(r.resumo.total, 0);
    assert.strictEqual(r.resumo.comCicatriz, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('cicatriz: o texto poe os SEM cicatriz primeiro - e a lista que motiva a poda', () => {
  const dir = pasta();
  try {
    const t = cicatriz.texto(cicatriz.varrer(manualDeTeste(dir), corpusDeTeste(dir), { fracao: 0.5 }));
    // os dois cabecalhos TEM de existir: indexOf da -1 quando falta, e -1 e menor
    // que tudo - sem o cabecalho SEM, a ordem "passava" sem lista nenhuma de poda
    const sem = t.indexOf('SEM cicatriz'), com = t.indexOf('COM cicatriz');
    assert.ok((sem !== -1) && (com !== -1) && (sem < com), t);
    assert.ok(/indicio, nunca veredito/.test(t), 'o limite do metodo tem de estar no relatorio');
    assert.ok(/nada foi alterado/.test(t), 'tem de dizer que nao podou nada');
    // A5-43/44/45 (D735): cicatriz e dor de origem explicadas no cabecalho; o piso diz comum a que, e que valem os
    // dois (conferir: termos >= minimo E fracao >= fracao); o passo antes de podar; sem "SINAL" nem "termos exigidos"
    assert.ok(/\nCicatriz: a decisao, o incidente ou o achado do historico \(o corpus\) que explica por que a regra/
      .test(t), t);
    assert.ok(/\nTrechos do corpus com marca de decisao, incidente ou achado: \d+\n/.test(t), t);
    assert.ok(/um desses trechos divide com ela ao menos 2 palavras-chave\s+e 50% das palavras-chave dela/.test(t), t);
    assert.ok(/procure o motivo dela no corpus\s+com outras palavras/.test(t), t);
    assert.ok(!/SINAL|termos em comum exigidos|Passagens com marca/.test(t), t);
    const um = cicatriz.texto(cicatriz.varrer(manualDeTeste(dir), corpusDeTeste(dir), { minimo: 1, fracao: 0.5 }));
    assert.ok(/ao menos 1 palavra-chave\s+e 50%/.test(um), 'singular com --minimo 1: ' + um);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// -------------------------------------------------------------- o script real

test('cicatriz: o script roda, e o --json sai parseavel', () => {
  const dir = pasta();
  try {
    const manual = manualDeTeste(dir);
    const corpus = corpusDeTeste(dir);
    const txt = spawnSync(process.execPath, [SCRIPT, '--manual', manual, '--corpus', corpus],
      { encoding: 'utf8' });
    assert.strictEqual(txt.status, 0, txt.stderr);
    assert.ok(/auditoria por cicatriz/.test(txt.stdout), txt.stdout);

    const js = spawnSync(process.execPath, [SCRIPT, '--manual', manual, '--corpus', corpus, '--json'],
      { encoding: 'utf8' });
    assert.strictEqual(js.status, 0, js.stderr);
    const r = JSON.parse(js.stdout);
    assert.strictEqual(r.resumo.total, 2);
    assert.strictEqual(r.corpusLido, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('cicatriz: o script SEM --corpus sai com sucesso e avisa que esta cego', () => {
  const dir = pasta();
  try {
    const r = spawnSync(process.execPath, [SCRIPT, '--manual', manualDeTeste(dir)],
      { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(/CORPUS NAO LIDO/.test(r.stdout), r.stdout);
    // A5 (R1 de lib/cicatriz.js :241): o aviso diz COMO apontar o corpus, nao so que falta
    assert.ok(/Aponte o corpus com --corpus <pasta>/.test(r.stdout), r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A5 (R1 :17 e :26): `--corpus --json` lia o corpus de uma pasta "--json", e `--minimo abc` virava NaN, que nenhum `<`
// barra - as regras todas saiam "com cicatriz" e a lista de poda vazia, com saida 0. Agora e erro de uso, saida 1.
test('cicatriz: flag sem valor e numero fora da faixa sao erro de uso que diz a flag, nao relatorio errado', () => {
  const dir = pasta();
  try {
    const manual = manualDeTeste(dir);
    const corpus = corpusDeTeste(dir);
    const casos = [
      [['--corpus'], /--corpus pede um valor/],
      [['--corpus', '--json'], /--corpus pede um valor/],
      [['--corpus', ''], /--corpus pede um valor/],
      [['--corpus', corpus, '--minimo'], /--minimo pede um valor/],
      [['--corpus', corpus, '--minimo', 'abc'], /--minimo fora da faixa \(veio "abc"\)/],
      [['--corpus', corpus, '--minimo', '0'], /--minimo fora da faixa/],
      [['--corpus', corpus, '--minimo', '1.5'], /--minimo fora da faixa/],
      [['--corpus', corpus, '--fracao', '-1'], /--fracao fora da faixa/],
      [['--corpus', corpus, '--fracao', '0'], /--fracao fora da faixa/],
      [['--corpus', corpus, '--fracao', '1.01'], /--fracao fora da faixa/],
      [['--corpus', corpus, '--fracao', 'NaN'], /--fracao fora da faixa/]
    ];
    for (const [args, re] of casos) {
      const r = spawnSync(process.execPath, [SCRIPT, '--manual', manual].concat(args), { encoding: 'utf8' });
      assert.strictEqual(r.status, 1, JSON.stringify(args) + ': ' + r.stdout + r.stderr);
      assert.ok(/^ERRO: /.test(r.stdout) && re.test(r.stdout) && /uso: cicatriz\.js/.test(r.stdout),
        JSON.stringify(args) + ': ' + r.stdout);
    }
    // a borda que vale: minimo 1 e fracao 1 rodam, e o numero chega ao relatorio
    const ok = spawnSync(process.execPath, [SCRIPT, '--manual', manual, '--corpus', corpus, '--minimo', '1', '--fracao', '1',
      '--json'], { encoding: 'utf8' });
    assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
    const j = JSON.parse(ok.stdout);
    assert.strictEqual(j.minimo, 1);
    assert.strictEqual(j.fracao, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------- o que a superficie publica

/**
 * O corpus e argumento, sempre. Um caminho de maquina ou nome de projeto cravado
 * aqui seria o fato volatil que o plugin inteiro se proibe de guardar - e um
 * vazamento na superficie publicada. Os literais abaixo sao montados por
 * concatenacao de proposito: `test/` E varrido pelo detector de sanitacao.
 */
test('cicatriz: nem o modulo nem o script cravam caminho de maquina ou nome de projeto', () => {
  const proibidos = ['Projeto' + ' KB', 'C:' + BARRA + 'Users', 'App' + 'Data', 'smart' + 'space'];
  for (const arq of ['lib/cicatriz.js', 'cicatriz.js']) {
    const fonte = fs.readFileSync(path.join(RAIZ, 'scripts', arq), 'utf8').toLowerCase();
    for (const p of proibidos) {
      assert.strictEqual(fonte.indexOf(p.toLowerCase()), -1, arq + ' crava "' + p + '"');
    }
  }
});

test('cicatriz: nenhum modulo do caminho abre conexao de rede', () => {
  for (const arq of ['lib/cicatriz.js', 'cicatriz.js']) {
    const fonte = fs.readFileSync(path.join(RAIZ, 'scripts', arq), 'utf8');
    for (const proibido of ['node:https', 'node:http', 'fetch(', 'node:net']) {
      assert.strictEqual(fonte.indexOf(proibido), -1, arq + ' abre rede: ' + proibido);
    }
  }
});

// IN-10 (D422): --corpus/--manual apontando um ARQUIVO passava no existsSync, a listagem
// devolvia [] e o relatorio saia "corpus lido, 0 passagens, tudo SEM cicatriz" sem o
// aviso de cego. O historico deste projeto E um arquivo unico.
test('cicatriz: corpus que e um ARQUIVO e lido - nao vira "lido, vazio, tudo sem cicatriz"', () => {
  const dir = pasta();
  try {
    const manual = manualDeTeste(dir);
    const arquivo = path.join(corpusDeTeste(dir), 'decisoes.md');
    assert.ok(fs.statSync(arquivo).isFile());
    const r = cicatriz.varrer(manual, arquivo, { fracao: 0.5 });
    assert.strictEqual(r.corpusLido, true);
    assert.ok(r.passagensComMarca > 0, 'o arquivo do corpus nao foi lido: ' + r.passagensComMarca);
    assert.strictEqual(r.resumo.comCicatriz, 1, JSON.stringify(r.resumo));
    // e igual ao resultado de apontar a pasta que o contem
    const viaPasta = cicatriz.varrer(manual, path.dirname(arquivo), { fracao: 0.5 });
    assert.strictEqual(r.resumo.comCicatriz, viaPasta.resumo.comCicatriz);
    assert.strictEqual(r.passagensComMarca, viaPasta.passagensComMarca);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('cicatriz: manual que e um ARQUIVO tem os itens lidos', () => {
  const dir = pasta();
  try {
    const arquivo = path.join(manualDeTeste(dir), 'SKILL.md');
    const r = cicatriz.varrer(arquivo, corpusDeTeste(dir), { fracao: 0.5 });
    assert.strictEqual(r.resumo.total, 2, 'o manual-arquivo nao foi lido: ' + JSON.stringify(r.resumo));
    assert.strictEqual(r.resumo.comCicatriz, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('cicatriz: o script aceita --corpus apontando um arquivo', () => {
  const dir = pasta();
  try {
    const manual = manualDeTeste(dir);
    const arquivo = path.join(corpusDeTeste(dir), 'decisoes.md');
    const s = spawnSync(process.execPath, [SCRIPT, '--manual', manual, '--corpus', arquivo, '--fracao', '0.5', '--json'], { encoding: 'utf8' });
    assert.strictEqual(s.status, 0, s.stderr);
    const j = JSON.parse(s.stdout);
    assert.strictEqual(j.corpusLido, true);
    assert.strictEqual(j.resumo.comCicatriz, 1, s.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// S8 L2-cic-1 (D426): pasta que existe mas nao tem NENHUM .md nao e corpus lido. Dizer
// `corpusLido: true` com indice vazio e a mentira que o modo degradado existe para evitar:
// a lista de poda sairia inteira, parecendo verdadeira.
test('cicatriz: pasta de corpus sem nenhum .md cai no modo degradado, como pasta inexistente', () => {
  const dir = pasta();
  try {
    const vazia = path.join(dir, 'vazia');
    fs.mkdirSync(vazia, { recursive: true });
    escrever(dir, path.join('so-texto', 'notas.txt'), 'D42 quebrou tudo\n');
    for (const corpus of [vazia, path.join(dir, 'so-texto')]) {
      const r = cicatriz.varrer(manualDeTeste(dir), corpus);
      assert.strictEqual(r.corpusLido, false, corpus);
      assert.strictEqual(r.resumo.comCicatriz, 0);
      assert.ok(/CORPUS NAO LIDO/.test(cicatriz.texto(r)), 'tem de se declarar cego');
    }
    // controle: pasta COM .md, mas sem nenhuma marca, foi lida (zero cicatriz ali e resposta, nao cegueira)
    escrever(dir, path.join('prosa', 'a.md'), '# so prosa\n\nescreva com clareza e cuidado\n');
    const lida = cicatriz.varrer(manualDeTeste(dir), path.join(dir, 'prosa'));
    assert.strictEqual(lida.corpusLido, true);
    assert.strictEqual(lida.passagensComMarca, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
