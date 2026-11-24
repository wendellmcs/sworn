'use strict';
// O roteiro do /sworn:init (skills/init/SKILL.md) cita comandos, numeros e chaves do codigo. Cada teste aqui pega a
// prosa que se afasta do que o codigo faz. O nome de cada teste e o codigo do achado que ele fecha, na lista de
// achados antigos (.superpowers/sdd/esquadro-pendencias/h1/triagem-antigos.tsv).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const shell = require('../scripts/lib/shell.js');
const projetoLib = require('../scripts/lib/projeto.js');
const custo = require('../scripts/lib/custo.js');

const RAIZ = path.join(__dirname, '..');
// Lido sob demanda, dentro de cada teste: um SKILL.md que suma reprova estes testes, nao derruba o carregamento.
function skillInit() {
  return fs.readFileSync(path.join(RAIZ, 'skills', 'init', 'SKILL.md'), 'utf8');
}

/**
 * O passo inteiro, do seu titulo ao proximo "## ". O titulo e casado com o espaco depois do numero quando o passo
 * tem irmaos com letra: 'Step 7 ' e o Passo 7, 'Step 7' casaria antes no 'Step 7b'.
 */
function passo(titulo) {
  const t = skillInit();
  const ini = t.indexOf('\n## ' + titulo);
  assert.ok(ini !== -1, 'sumiu o passo "' + titulo + '" do init: se ele mudou de nome, acerte o titulo neste teste');
  const fim = t.indexOf('\n## ', ini + 1);
  return t.slice(ini, fim === -1 ? undefined : fim);
}

/** O trecho entre duas frases do passo; cada marca tem de existir, senao o teste diz qual sumiu. */
function entre(texto, de, ate) {
  const ini = texto.indexOf(de);
  assert.ok(ini !== -1, 'sumiu a frase "' + de + '" do init: acerte a marca deste teste');
  const fim = texto.indexOf(ate, ini);
  assert.ok(fim !== -1, 'sumiu a frase "' + ate + '" do init: acerte a marca deste teste');
  return texto.slice(ini, fim);
}

test('A4-29: o Passo 0 resolve a raiz no bash com cd + pwd -P, sem realpath, numa forma que a trava aceita', () => {
  const p0 = passo('Step 0 ');
  // comando e a linha recuada (espaco ou tab) ou dentro de cerca ```; a prosa, que cita o realpath para dizer por
  // que ele saiu, comeca na coluna 0
  let naCerca = false;
  const comandos = p0.split(/\r?\n/).filter((l) => {
    if (/^\s*```/.test(l)) { naCerca = !naCerca; return false; }
    return naCerca || /^[ \t]+\S/.test(l);
  }).map((l) => l.trim());
  assert.ok(!comandos.some((c) => /\brealpath\b/.test(c)), 'um comando do Passo 0 ainda usa realpath: ' + comandos.join(' | '));
  const bash = comandos.find((c) => /pwd -P/.test(c));
  assert.ok(bash, 'nenhum comando do Passo 0 traz o cd + pwd -P');
  assert.strictEqual(shell.cdSolto(bash, 'Bash'), null, 'a trava nega o Passo 0 do init: ' + bash);
});

test('R-T10-19/20/21: o Passo 3b lista a raiz com a barra no fim, avisa do ponto ou espaco no fim e confere a marca', () => {
  const p = passo('Step 3b');
  assert.ok(/^ {4}ls -A1F '<raiz>\/'\s*$/m.test(p), 'o ls do Passo 3b nao leva a barra depois da raiz');
  assert.ok(/junction/.test(p) && /one line/.test(p), 'o Passo 3b nao explica a barra (link/juncao)');
  assert.ok(/ends in a dot or a space/.test(p), 'o Passo 3b nao avisa da raiz terminada em ponto ou espaco');
  assert.ok(/test -e '<raiz>\/<name without the mark>'/.test(p), 'o Passo 3b tira a marca sem conferir o nome');
});

test('A4-35/A11-05: o Passo 0 confere a pasta de cima (raizDoProjeto) e avisa dos pedidos de permissao e do .gitignore', () => {
  const p0 = passo('Step 0 ');
  assert.ok(/they climb from it to the first folder with `\.claude\/sworn\/projeto\.json` \(`raizDoProjeto` in\s+`scripts\/lib\/config\.js`\)/
    .test(p0), 'o Passo 0 nao explica a subida ate o projeto.json');
  assert.ok(/permission prompts/.test(p0), 'sem o aviso dos pedidos de permissao');
  assert.ok(/\.gitignore/.test(p0), 'sem o aviso do .gitignore');
});

test('A4-35: o comando da pasta de cima e o esperado e, rodado, acha o projeto configurado acima', () => {
  const linha = passo('Step 0 ').split(/\r?\n/).find((l) => /^\s*node -e ".*raizDoProjeto/.test(l));
  assert.ok(linha, 'o Passo 0 nao traz o comando da pasta de cima');
  // o codigo do -e e conferido por inteiro ANTES de rodar: o teste nao executa texto qualquer da skill
  const CODIGO = "const p = require('path'), r = require(process.argv[1]).raizDoProjeto(process.argv[2]); " +
    "console.log(p.resolve(r) === p.resolve(process.argv[2]) ? 'ESTA' : r)";
  const m = /^\s*node -e "([^"]+)" "\$\{CLAUDE_PLUGIN_ROOT\}\/(scripts\/lib\/config\.js)" '<raiz>'\s*$/.exec(linha);
  assert.ok(m && m[1] === CODIGO, 'o comando do Passo 0 mudou: ' + linha);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-init-cima-'));
  try {
    fs.mkdirSync(path.join(dir, 'cfg', '.claude', 'sworn'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'cfg', '.claude', 'sworn', 'projeto.json'), '{}');
    fs.mkdirSync(path.join(dir, 'cfg', 'sub'));
    fs.mkdirSync(path.join(dir, 'solta'));
    // cada chamada confere que o node rodou e saiu 0; senao diz por que (erro do spawn, timeout com sinal, stderr)
    const rodar = (pasta) => {
      const x = spawnSync(process.execPath, ['-e', CODIGO, path.join(RAIZ, m[2]), pasta], { encoding: 'utf8', timeout: 20000 });
      assert.strictEqual(x.status, 0, pasta + ': o comando nao rodou: ' + (x.error ? x.error.message : '') +
        (x.signal ? ' sinal ' + x.signal : '') + ' ' + (x.stderr || ''));
      return x;
    };
    const r = rodar(path.join(dir, 'cfg', 'sub'));
    // raizDoProjeto usa path.resolve (sem realpath): o nome curto 8.3 do tmpdir sai igual dos dois lados
    assert.strictEqual(r.stdout.trim(), path.resolve(dir, 'cfg'), 'o comando nao achou a pasta de cima');
    // a propria raiz configurada e a mesma escrita com ".." dizem ESTA
    for (const pasta of [path.join(dir, 'cfg'), path.join(dir, 'cfg', 'sub') + path.sep + '..']) {
      const s = rodar(pasta);
      assert.strictEqual(s.stdout.trim(), 'ESTA', pasta + ': ' + s.stdout + s.stderr);
    }
    // a pasta sem configuracao: ESTA, salvo se uma pasta acima do tmpdir desta maquina ja tiver projeto.json
    // (a subida e feita aqui pelo disco, sem raizDoProjeto: um defeito nela nao some do esperado)
    let acimaDoTmp = null;
    for (let a = path.resolve(dir); acimaDoTmp === null; a = path.dirname(a)) {
      if (fs.existsSync(path.join(a, '.claude', 'sworn', 'projeto.json'))) acimaDoTmp = a;
      else if (path.dirname(a) === a) break;
    }
    const esperado = acimaDoTmp === null ? 'ESTA' : acimaDoTmp;
    const s = rodar(path.join(dir, 'solta'));
    assert.strictEqual(s.stdout.trim(), esperado, 'solta: ' + s.stdout + s.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A8-10: cada chave de CHAVES e citada nas perguntas, no mapa de marchas ou na lista do Passo 7, e a conta bate', () => {
  const p7 = passo('Step 7 ');
  const lista = entre(p7, 'come from no question at all', 'Outside `CHAVES`');
  const daLista = [];
  for (const m of lista.matchAll(/^- `([A-Za-z]+)`(?: and `([A-Za-z]+)`)?/gm)) daLista.push(...m.slice(1).filter(Boolean));
  const NUMEROS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const dito = /\b(\w+) values required there/i.exec(p7);
  assert.ok(dito, 'o Passo 7 nao diz quantos valores nao vem de pergunta');
  const n = NUMEROS[dito[1].toLowerCase()];
  assert.ok(n !== undefined, 'o Passo 7 diz "' + dito[1] + '" values: ponha a palavra em NUMEROS deste teste');
  assert.strictEqual(n, daLista.length, 'o Passo 7 diz "' + dito[1] + '" e a lista tem ' + daLista.length + ': ' + daLista);
  assert.ok(daLista.indexOf('limiares') !== -1, 'o Passo 7 nao traz limiares');
  // as perguntas (Passo 4) e o mapa de marchas (Passo 5: marchaPadrao e o JSON de marchas) preenchem o resto;
  // `agentes` vem da pergunta 6, que grava `agentes.escada` e `agentes.degraus`
  const perguntasEMarchas = passo('Step 4 ') + passo('Step 5 ');
  const origem = (c) => c === 'agentes'
    ? perguntasEMarchas.includes('`agentes.escada`') && perguntasEMarchas.includes('`agentes.degraus`')
    : perguntasEMarchas.includes('`' + c + '`') || perguntasEMarchas.includes('"' + c + '": ');
  assert.ok(Array.isArray(projetoLib.CHAVES) && projetoLib.CHAVES.length > 0,
    'projeto.js nao exporta CHAVES, ou a lista veio vazia: o teste nao conferiria nada');
  const semOrigem = projetoLib.CHAVES.filter((c) => daLista.indexOf(c) === -1 && !origem(c));
  assert.deepStrictEqual(semOrigem, [], 'chave obrigatoria que nenhuma pergunta, nem o mapa, nem a lista do Passo 7 preenche');
});

test('A8-23: o Passo 7 conta as chaves de travas, que sao as de TRAVAS, e nao as oito travas do guia', () => {
  assert.strictEqual(projetoLib.TRAVAS.length, 4, 'TRAVAS mudou: acerte "its four keys" no Passo 7 do init');
  assert.ok(/- `travas`: its four keys \(`TRAVAS`\)/.test(passo('Step 7 ')), 'o Passo 7 nao diz que sao as quatro chaves');
  assert.ok(!/four (protections|locks on)|`travas`: all four/.test(skillInit()), 'sobrou a conta de quatro travas sem dizer que sao chaves');
});

test('A8-12: o corte da escada que o init explica bate com custo.permitido (metade cara, arredondada para baixo)', () => {
  const p8 = passo('Step 8 ');
  assert.ok(/rounded down/.test(p8) && !/upper half of the ladder, rounded up/.test(p8),
    'o Passo 8 tem de dizer "rounded down": custo.permitido barra a metade cara arredondada para baixo');
  const NOMES = ['a', 'b', 'c', 'd', 'e'];
  const barrados = (n) => {
    const projeto = { agentes: { escada: NOMES.slice(0, n) } };
    // 'rapida' e a unica marcha em que custo.permitido corta a escada (custo.js: marchaMax !== 'rapida' libera tudo)
    return NOMES.slice(0, n).filter((nome) => !custo.permitido(nome, 'rapida', projeto).ok).length;
  };
  assert.deepStrictEqual([barrados(5), barrados(4), barrados(3)], [2, 2, 1],
    'o corte de custo.permitido mudou: acerte o "rounded down" e o exemplo do Passo 8 do init');
  assert.ok(/ladder of five, the\s+last two; on one of four, also the last two; on one of three, the last one/.test(p8),
    'o exemplo do Passo 8 mudou: confira com custo.permitido');
});

test('A11-06: o Passo 7b diz para pular quando a pergunta 6 ficou sem agentes, com a mensagem do gerar-agentes', () => {
  const p = passo('Step 7b');
  const ERRO = 'ERRO: este projeto nao tem degraus gravados';
  assert.ok(/skip 7b/.test(p) && p.includes(ERRO), 'o Passo 7b nao diz para pular sem agentes');
  const gerar = fs.readFileSync(path.join(RAIZ, 'scripts', 'gerar-agentes.js'), 'utf8');
  assert.ok(gerar.includes(ERRO), 'a mensagem do gerar-agentes mudou: acerte a citacao no Passo 7b do init');
});

test('L4-s106-13/14, L6-s108-5: o Passo 7f diz onde grava, glosa marketplace e diz que "a mao" pergunta de novo', () => {
  const p = passo('Step 7f');
  const pergunta = entre(p, '**2. Ask through', '**3. Only with a yes');
  assert.ok(/`settings\.json` of this computer/.test(pergunta), 'a pergunta nao diz o arquivo que o sim grava');
  assert.ok(/update by hand[\s\S]*the answer is not saved, so the next init asks again/.test(pergunta),
    'a opcao "a mao" nao diz que o proximo init pergunta de novo');
  assert.ok(/A marketplace is the catalog/.test(p) && /CLAUDE_CONFIG_DIR/.test(p), 'sem a glosa de marketplace/settings');
});

test('A8-16: o Passo 6 copia o regras.md como esta (quem decide e a prova moram no projeto.json)', () => {
  assert.ok(!/Adjust only what is specific to the project \(who/.test(passo('Step 6 ')), 'o Passo 6 voltou a mandar ajustar no regras.md o que mora no projeto.json: tire essa frase do Passo 6');
  const modelo = fs.readFileSync(path.join(RAIZ, 'modelos', 'regras.md'), 'utf8');
  assert.ok(!/threat model|who decides|proof of done/i.test(modelo), 'o modelo de regras ganhou um desses campos: reveja o Passo 6');
});

test('L6-s108-4: o Passo 5 diz que portaoManual e portaoReferencia moram no projeto.json', () => {
  const p = passo('Step 5 ');
  assert.ok(/`"portaoManual": false` in `projeto\.json`/.test(p), 'portaoManual sem dizer onde mora');
  assert.ok(/`"portaoReferencia": false`, also in `projeto\.json`/.test(p), 'portaoReferencia sem dizer onde mora');
});

test('L6-s109-1: a tabela que o Passo 3 mostra ao dono nao traz o nome do campo', () => {
  const tabela = passo('Step 3 ').split(/\r?\n/).filter((l) => /^\|/.test(l));
  assert.ok(tabela.length > 2, 'sumiu a tabela do Passo 3');
  assert.deepStrictEqual(tabela.filter((l) => /provaDePronto/.test(l)), [], 'a tabela ao dono traz o nome do campo');
});

// R-T20-05: o `caminhosDeEstilo` e lido pelo design.js e nao tinha quem o explicasse. O Passo 5b o explica com a chave
// e as extensoes que o codigo usa, e o exemplo do texto liga o caminho como estilo.
test('R-T20-05: o Passo 5b explica o caminhosDeEstilo com a chave, as extensoes e um exemplo que funciona', () => {
  const design = require('../scripts/lib/design.js');
  const texto = passo('Step 5b');
  assert.ok(/`\.claude\/sworn\/projeto\.json`/.test(texto), 'o Passo 5b nao diz em que arquivo a chave mora');
  assert.ok(design.EXTENSOES_ESTILO.length > 0, 'a lista de extensoes de estilo veio vazia');
  for (const ext of design.EXTENSOES_ESTILO) {
    assert.ok(texto.indexOf('`' + ext + '`') !== -1, 'o Passo 5b nao cita a extensao ' + ext);
  }
  const m = /`("design": \{ "caminhosDeEstilo": \[[^\]]*\] \})`/.exec(texto);
  assert.ok(m, 'sumiu o exemplo da chave no Passo 5b');
  const projeto = JSON.parse('{' + m[1] + '}');
  assert.strictEqual(design.ehArquivoDeEstilo('src/theme/cores.ts', projeto), true, 'o exemplo nao liga a pasta');
  assert.strictEqual(design.ehArquivoDeEstilo('tokens.ts', projeto), true, 'o exemplo nao liga o arquivo');
  assert.strictEqual(design.ehArquivoDeEstilo('src/app.ts', projeto), false, 'controle: o resto nao e estilo');
});

test('H6j (D906): o paragrafo do kit cita os campos que o kit devolve e diz ao dono o proximo passo', () => {
  const t = skillInit();
  const ini = t.indexOf('**The language kit.**');
  assert.ok(ini !== -1, 'sumiu o paragrafo do kit da linguagem do init');
  const fim = t.indexOf('\n\n', ini);
  const texto = t.slice(ini, fim === -1 ? undefined : fim);
  const k = require('../scripts/lib/kit.js').recomendar({ linguagem: null });
  for (const campo of ['para', 'visto', 'onde', 'como']) {
    assert.ok(texto.indexOf('`' + campo + '`') !== -1, 'o paragrafo nao cita o campo ' + campo);
    assert.ok(Object.prototype.hasOwnProperty.call(k.itens[0], campo), 'o kit nao devolve o campo ' + campo);
  }
  for (const campo of ['conferido', 'linguagem']) {
    assert.ok(texto.indexOf('`kit.' + campo + '`') !== -1, 'o paragrafo nao cita kit.' + campo);
    assert.ok(Object.prototype.hasOwnProperty.call(k, campo), 'o kit nao devolve ' + campo);
  }
  assert.ok(/tell the owner to run `claude plugin list` before installing/.test(texto),
    'o paragrafo nao manda o dono conferir o plugin pessoal antes de instalar');
  assert.ok(k.itens.length > 0 && /the other rows of the table stay/.test(texto),
    'sem linguagem o kit segue com linhas, e o paragrafo tem de dizer isso');
});
