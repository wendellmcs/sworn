'use strict';
/**
 * H14 (pedido 247): a apresentacao do sworn mora em apresentacao/ e o GitHub Pages serve apresentacao/index.html.
 * A pagina e montada por scripts/apresentacao.js a partir de apresentacao/fonte/ (deck.json, deck.css, slides/),
 * do CHANGELOG.md (o slide de novidades) e do plugin.json (a versao). Aqui se prende:
 * - a pagina publicada e a que a fonte monta hoje (quem muda a fonte e nao roda --gravar reprova);
 * - o `versao` do deck.json e o do plugin.json (quem sobe a versao sem rever o deck reprova);
 * - cada slide da ordem existe, e todo arquivo de slide esta na ordem;
 * - os contadores do slide da historia saem do deck.json e, no repositorio privado, batem com o registro no dia da versao;
 * - nem codigo de decisao (D123) nem e-mail na fonte e na pagina, que sao publicas;
 * - os dois READMEs apontam para a pagina, e a raiz tem o .nojekyll.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ap = require('../scripts/apresentacao.js');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');
const FONTE = 'apresentacao/fonte';
const PAGINA = 'apresentacao/index.html';
const URL_DA_PAGINA = 'https://wendellmcs.github.io/sworn/apresentacao/';
const SCRIPT = path.join(RAIZ, 'scripts', 'apresentacao.js');

test('a pagina publicada e a que a fonte monta hoje (rode node scripts/apresentacao.js --gravar)', () => {
  assert.strictEqual(ler(PAGINA), ap.montar(RAIZ));
});

test('o versao do deck.json e o do plugin.json: cada versao nova passa pela apresentacao', () => {
  const deck = JSON.parse(ler(FONTE + '/deck.json'));
  const plugin = JSON.parse(ler('.claude-plugin/plugin.json'));
  assert.strictEqual(deck.versao, plugin.version,
    'deck.json "versao" ' + deck.versao + ' e plugin.json ' + plugin.version + ': ponha as novidades nos slides certos, '
    + 'suba o "versao" e rode node scripts/apresentacao.js --gravar');
});

test('cada slide da ordem existe, e todo arquivo de slide esta na ordem', () => {
  const deck = JSON.parse(ler(FONTE + '/deck.json'));
  const arquivos = fs.readdirSync(path.join(RAIZ, FONTE, 'slides')).filter((a) => a.endsWith('.html'))
    .map((a) => a.slice(0, -5)).sort();
  assert.ok(deck.order.length > 20, 'a ordem do deck veio curta: ' + deck.order.length);
  assert.deepStrictEqual([...deck.order].sort(), arquivos);
  assert.strictEqual(new Set(deck.order).size, deck.order.length, 'slide repetido na ordem');
  for (const [chave, s] of Object.entries(deck.sections)) {
    assert.ok(deck.order.includes(s.start), 'deck.json: a secao "' + chave + '" comeca em "' + s.start + '", que nao esta em "order"');
  }
});

test('nem codigo de decisao nem e-mail na fonte e na pagina, que sao publicas', () => {
  const textos = [PAGINA, FONTE + '/deck.json', FONTE + '/deck.css']
    .concat(fs.readdirSync(path.join(RAIZ, FONTE, 'slides')).map((a) => FONTE + '/slides/' + a));
  for (const rel of textos) {
    const t = ler(rel);
    assert.doesNotMatch(t, /\bD\d{3,4}\b/, rel + ' cita um codigo de decisao');
    assert.doesNotMatch(t, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, rel + ' traz um e-mail');
  }
});

test('nenhuma marca {{...}} sobra na pagina montada', () => {
  // qualquer {{...}}: maiuscula, digito, hifen ou espaco dentro tambem e marca que sobrou
  assert.doesNotMatch(ap.montar(RAIZ), /\{\{[^{}]*\}\}/);
});

test('os dois READMEs apontam para a pagina, e a raiz tem o .nojekyll do Pages', () => {
  for (const rel of ['README.md', 'README.pt-BR.md']) {
    assert.ok(ler(rel).includes(URL_DA_PAGINA), rel + ' sem o link ' + URL_DA_PAGINA);
  }
  assert.ok(fs.existsSync(path.join(RAIZ, '.nojekyll')), 'falta o .nojekyll: o Jekyll leria as skills como Liquid');
});

const CHANGELOG_DE_TESTE = [
  '# Changelog', '',
  '## 9.1.0 — o titulo `com crase` da versao', '',
  '**Novo**', '',
  '- **Primeira <coisa> nova** (`scripts/a.js`). Texto.',
  '  continua aqui.',
  '- **Segunda nova.** Texto.',
  '',
  '**Medido e não adotado**', '',
  '- **Isto nao entra** porque nao teve ganho.',
  '',
  '**Corrigido**', '',
  '- **Um conserto** (`scripts/b.js`).',
  '- **Outro conserto**.',
  '- **Mais um**.',
  '- **E outro**.',
  '- **O setimo**.',
  '',
  '## 9.0.0 — a anterior', '',
  '**Novo**', '',
  '- **Da versao velha**.', ''
].join('\n');

test('novidades: le so a secao do topo, o Novo antes do Corrigido, sem o que nao foi adotado', () => {
  const n = ap.novidades(CHANGELOG_DE_TESTE);
  assert.strictEqual(n.versao, '9.1.0');
  assert.strictEqual(n.titulo, 'O titulo com crase da versao');
  assert.deepStrictEqual(n.itens.map((i) => i.tipo + ': ' + i.texto), [
    'Novo: Primeira <coisa> nova', 'Novo: Segunda nova', 'Corrigido: Um conserto', 'Corrigido: Outro conserto',
    'Corrigido: Mais um', 'Corrigido: E outro'
  ]);
  assert.strictEqual(n.mais, 1);
});

test('o slide de novidades escapa o HTML do CHANGELOG e diz quantas ficaram de fora', () => {
  const html = ap.slideDeNovidades('<p>{{versao}} {{titulo}}</p>{{itens}}<p>{{mais}}</p>', ap.novidades(CHANGELOG_DE_TESTE));
  assert.ok(html.includes('Primeira &lt;coisa&gt; nova'), html);
  assert.ok(!html.includes('<coisa>'));
  assert.ok(html.includes('9.1.0 O titulo com crase da versao'));
  assert.ok(html.includes('E mais 1 mudança nesta versão. '), html);
  assert.ok(!html.includes('Isto nao entra'));
});

/** Roda `fn` numa copia temporaria da fonte, do plugin.json e do CHANGELOG, e apaga a copia no fim. */
function comCopia(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-apresentacao-'));
  try {
    fs.cpSync(path.join(RAIZ, FONTE), path.join(tmp, FONTE), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.claude-plugin'));
    fs.copyFileSync(path.join(RAIZ, '.claude-plugin', 'plugin.json'), path.join(tmp, '.claude-plugin', 'plugin.json'));
    fs.copyFileSync(path.join(RAIZ, 'CHANGELOG.md'), path.join(tmp, 'CHANGELOG.md'));
    return fn(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
// cwd na copia: um mutante que grava na pasta errada nunca suja o repositorio
const rodar = (cwd, args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', timeout: 30000 });
const correrEm = (tmp, ...args) => rodar(tmp, ['--raiz', tmp, ...args]);
// a mensagem de falha diz o timeout ou a falha ao abrir o processo, que o status null sozinho esconde
const relato = (r) => r.stdout + r.stderr + (r.error ? ' [erro: ' + r.error.message + ']' : '') + (r.signal ? ' [sinal: ' + r.signal + ']' : '');
const editarJson = (arq, mudar) => { const j = JSON.parse(fs.readFileSync(arq, 'utf8')); mudar(j); fs.writeFileSync(arq, JSON.stringify(j)); };

test('o visor abre no slide 1 com um endereco #% que nao decodifica, em vez de ficar sem slide', () => {
  const corpo = ap.montar(RAIZ).match(/function doEndereco\(\) \{[\s\S]*?\n {2}\}/);
  assert.ok(corpo, 'doEndereco nao achada no visor');
  const doEndereco = new Function('location', 'total', 'slides', corpo[0] + '\nreturn doEndereco();');
  const slides = [{ id: 'capa' }, { id: 'meio' }, { id: 'fim' }];
  assert.strictEqual(doEndereco({ hash: '#%E0' }, 3, slides), 0);
  assert.strictEqual(doEndereco({ hash: '#%' }, 3, slides), 0);
  assert.strictEqual(doEndereco({ hash: '#2' }, 3, slides), 1);
  assert.strictEqual(doEndereco({ hash: '#f%69m' }, 3, slides), 2);
});

test('texto do CHANGELOG com {{...}} entra como texto, nunca troca nem quebra a montagem', () => {
  comCopia((tmp) => {
    const cl = path.join(tmp, 'CHANGELOG.md');
    fs.writeFileSync(cl, '# Changelog\n\n## 9.1.0 — teste\n\n**Novo:**\n\n- **Usa {{itens}} e {{versao}} no texto**.\n\n'
      + fs.readFileSync(cl, 'utf8').replace(/^# Changelog\n/, ''));
    const pagina = ap.montar(tmp);
    assert.ok(pagina.includes('Usa &#123;&#123;itens}} e &#123;&#123;versao}} no texto'), 'o item com chaves sumiu ou foi trocado');
    assert.ok(pagina.includes('9.1.0'));
  });
});

test('novidades: "## X.Y.Z" sem titulo e erro, nunca a secao seguinte lida no lugar', () => {
  assert.throws(() => ap.novidades('## 9.2.0\n\n**Novo**\n\n- **a**.\n\n## 9.1.0 — velha\n'), /fora do formato/);
});

test('a fonte com defeito para a montagem: marca que nao e de valor, versao faltando, ordem vazia, id com caminho', () => {
  comCopia((tmp) => {
    const capa = path.join(tmp, FONTE, 'slides', 'cover.html');
    const original = fs.readFileSync(capa, 'utf8');
    fs.writeFileSync(capa, original + '{{constructor}}');
    assert.throws(() => ap.lerFonte(tmp), /marca sem valor \{\{constructor\}\}/);
    fs.writeFileSync(capa, original);
    const deck = path.join(tmp, FONTE, 'deck.json');
    const plugin = path.join(tmp, '.claude-plugin', 'plugin.json');
    const versao = JSON.parse(fs.readFileSync(plugin, 'utf8')).version;
    editarJson(plugin, (j) => { delete j.version; });
    assert.throws(() => ap.lerFonte(tmp), /sem "version"/);
    editarJson(plugin, (j) => { j.version = versao; });
    const ordem = JSON.parse(fs.readFileSync(deck, 'utf8')).order;
    editarJson(deck, (j) => { j.order = []; });
    assert.throws(() => ap.lerFonte(tmp), /sem "order"/);
    editarJson(deck, (j) => { j.order = ['../../fora']; });
    assert.throws(() => ap.lerFonte(tmp), /fora de \[a-z0-9-\]/);
    editarJson(deck, (j) => { j.order = ordem; });
    // o BOM do Windows (U+FEFF), escrito por codigo para nao sumir num editor que apaga o caractere invisivel
    const bom = String.fromCharCode(0xfeff);
    fs.writeFileSync(deck, bom + fs.readFileSync(deck, 'utf8'));
    assert.strictEqual(ap.lerFonte(tmp).slides.length, ordem.length, 'o deck.json com BOM do Windows nao abriu');
    // o deck.css salvo com BOM pelo Windows sai sem ele no css que o lerFonte devolve (e o --slides grava)
    const css = path.join(tmp, FONTE, 'deck.css');
    fs.writeFileSync(css, bom + fs.readFileSync(css, 'utf8'));
    assert.ok(!ap.lerFonte(tmp).css.startsWith(bom), 'o BOM do deck.css ficou no css lido');
  });
});

test('--slides nunca grava por cima da fonte, nem toma a opcao seguinte por pasta', () => {
  comCopia((tmp) => {
    const capa = path.join(tmp, FONTE, 'slides', 'cover.html');
    const antes = fs.readFileSync(capa, 'utf8');
    const naFonte = correrEm(tmp, '--slides', path.join(tmp, FONTE));
    assert.strictEqual(naFonte.status, 2, relato(naFonte));
    assert.match(naFonte.stderr, /por cima da fonte/);
    assert.strictEqual(fs.readFileSync(capa, 'utf8'), antes);
    const semPasta = correrEm(tmp, '--slides', '--gravar');
    assert.strictEqual(semPasta.status, 2, relato(semPasta));
    assert.match(semPasta.stderr, /pede a pasta/);
    assert.ok(!fs.existsSync(path.join(tmp, '--gravar')));
    if (process.platform === 'win32') {
      const outraCaixa = correrEm(tmp, '--slides', path.join(tmp, 'APRESENTACAO', 'Fonte'));
      assert.strictEqual(outraCaixa.status, 2, relato(outraCaixa));
      assert.match(outraCaixa.stderr, /por cima da fonte/);
      assert.strictEqual(fs.readFileSync(capa, 'utf8'), antes);
    }
    const semRaiz = rodar(tmp, ['--raiz', '--gravar']);
    assert.strictEqual(semRaiz.status, 2, relato(semRaiz));
    assert.match(semRaiz.stderr, /--raiz pede a pasta/);
  });
});

test('a fonte com defeito diz o arquivo e o campo: JSON quebrado, sem title, sem sections, faces sem href, slide faltando', () => {
  comCopia((tmp) => {
    const deck = path.join(tmp, FONTE, 'deck.json');
    const original = fs.readFileSync(deck, 'utf8');
    fs.writeFileSync(deck, original.replace(/\}\s*$/, ',}'));
    assert.throws(() => ap.lerFonte(tmp), /apresentacao\/fonte\/deck\.json: JSON invalido/);
    const volta = () => fs.writeFileSync(deck, original);
    for (const [mudar, erro] of [
      [(j) => { delete j.title; }, /sem "title"/],
      [(j) => { delete j.sections; }, /"sections" tem de ser/],
      [(j) => { j.sections = null; }, /"sections" tem de ser/],
      [(j) => { j.sections = { a: null }; }, /"sections" tem de ser/],
      [(j) => { j.sections = { ...j.sections, z: { start: 'nao-existe', description: 'Z' } }; }, /a secao "z" comeca em "nao-existe", que nao esta em "order"/],
      [(j) => { j.faces = { x: {} }; }, /"faces" precisa de "href"/],
      [(j) => { j.order = [...j.order, 'extra']; }, /lista "extra" em "order", mas falta apresentacao\/fonte\/slides\/extra\.html/]
    ]) {
      volta();
      editarJson(deck, mudar);
      assert.throws(() => ap.lerFonte(tmp), erro);
    }
    volta();
    const capa = path.join(tmp, FONTE, 'slides', 'cover.html');
    fs.writeFileSync(capa, fs.readFileSync(capa, 'utf8') + '{{titulo}}');
    assert.throws(() => ap.lerFonte(tmp), /\{\{titulo\}\}, \{\{itens\}\} e \{\{mais\}\} so em novidades\.html/);
  });
});

test('os contadores do slide da historia vem do deck.json ("pedidos" e "decisoes"), nunca texto fixo', () => {
  const fonte = ler(FONTE + '/slides/historia.html');
  assert.ok(fonte.includes('{{pedidos}}') && fonte.includes('{{decisoes}}'), 'historia.html sem as marcas {{pedidos}} e {{decisoes}}');
  comCopia((tmp) => {
    editarJson(path.join(tmp, FONTE, 'deck.json'), (j) => { j.pedidos = 4321; j.decisoes = 8765; });
    const historia = ap.lerFonte(tmp).slides.find((s) => s.id === 'historia');
    assert.ok(historia, 'o slide historia sumiu da ordem');
    // o numero do cartao e o da nota do apresentador saem os dois do deck.json
    assert.strictEqual(historia.html.split('>4321</p>').length, 2, 'o cartao dos pedidos nao traz o "pedidos" do deck.json');
    assert.strictEqual(historia.html.split('>8765</p>').length, 2, 'o cartao das decisoes nao traz o "decisoes" do deck.json');
    assert.match(historia.html, /<aside[\s\S]*4321 pedidos[\s\S]*8765 decisões[\s\S]*<\/aside>/);
  });
});

test('o deck.json sem "pedidos" ou "decisoes" inteiro e nao negativo para a montagem, dizendo o campo', () => {
  comCopia((tmp) => {
    const deck = path.join(tmp, FONTE, 'deck.json');
    const original = fs.readFileSync(deck, 'utf8');
    for (const campo of ['pedidos', 'decisoes']) {
      for (const valor of [undefined, -1, 1.5, '10', null]) {
        fs.writeFileSync(deck, original);
        editarJson(deck, (j) => { if (valor === undefined) delete j[campo]; else j[campo] = valor; });
        assert.throws(() => ap.lerFonte(tmp), new RegExp('deck\\.json: "' + campo + '" tem de ser um inteiro'),
          campo + ' = ' + JSON.stringify(valor) + ' passou');
      }
    }
    fs.writeFileSync(deck, original);
    editarJson(deck, (j) => { j.pedidos = 0; j.decisoes = 0; });
    assert.ok(ap.lerFonte(tmp).slides.length, 'zero e um valor valido');
  });
});

test('a marca sem valor num slide diz as quatro que valem em qualquer slide', () => {
  comCopia((tmp) => {
    const capa = path.join(tmp, FONTE, 'slides', 'cover.html');
    fs.writeFileSync(capa, fs.readFileSync(capa, 'utf8') + '{{outra}}');
    assert.throws(() => ap.lerFonte(tmp), /valem \{\{versao\}\}, \{\{versoes\}\}, \{\{pedidos\}\} e \{\{decisoes\}\} em qualquer slide/);
  });
});

// O registro de decisoes (docs/) e o de pedidos (.claude/, fora do git) so existem no repositorio privado do mantenedor:
// no publico e num clone novo este teste pula.
const REGISTRO_DE_DECISOES = path.join(RAIZ, 'docs', 'decisoes.md');
const REGISTRO_DE_PEDIDOS = path.join(RAIZ, '.claude', 'sworn', 'pedidos', 'esquadro-pendencias.md');
const semRegistro = !fs.existsSync(REGISTRO_DE_DECISOES) || !fs.existsSync(REGISTRO_DE_PEDIDOS);

test('os contadores do deck.json batem com o registro no dia da versao', { skip: semRegistro && 'sem os registros privados' }, () => {
  const deck = JSON.parse(ler(FONTE + '/deck.json'));
  const texto = fs.readFileSync(REGISTRO_DE_DECISOES, 'utf8').replace(/\r\n/g, '\n');
  const { decisoes } = require('../scripts/lib/vigentes.js').analisar(texto);
  // a decisao da versao: a 1a cujo titulo abre pela versao, sozinha ou numa lista ("0.91.0, 0.92.0 e 0.93.0 ...")
  const daVersao = new RegExp('^(?:\\d+\\.\\d+\\.\\d+(?:, | e ))*' + deck.versao.replace(/\./g, '\\.') + '(?![\\d.])');
  const i = decisoes.findIndex((d) => daVersao.test(d.titulo));
  assert.ok(i !== -1, 'nenhuma decisao com o titulo aberto por ' + deck.versao + ': registre a da versao antes');
  const id = decisoes[i].id;
  // o cabecalho no formato que o vigentes.js le ("### D933 · titulo"), no comeco da linha
  const cabecalho = new RegExp('^### ' + id + ' · ', 'm').exec(texto);
  assert.ok(cabecalho, 'o cabecalho "### ' + id + ' · " nao esta no registro de decisoes');
  const bloco = texto.slice(cabecalho.index);
  const fim = bloco.indexOf('\n### ', 1);
  const data = (fim === -1 ? bloco : bloco.slice(0, fim)).match(/\*\*Data:\*\* (\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?/);
  assert.ok(data, id + ' sem a linha **Data:**');
  const ate = data[1] + ' ' + (data[2] || '23:59');
  const linhas = fs.readFileSync(REGISTRO_DE_PEDIDOS, 'utf8').replace(/\r\n/g, '\n').split('\n')
    .map((l) => l.match(/^(\d+)\. (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) /)).filter(Boolean);
  // o registro sem nenhuma linha no formato "N. AAAA-MM-DD HH:MM " e ilegivel, nunca "0 pedidos"
  assert.ok(linhas.length, 'nenhuma linha "N. AAAA-MM-DD HH:MM " no registro de pedidos: o formato mudou');
  const pedidos = linhas.filter((m) => m[2] <= ate).map((m) => Number(m[1]));
  const esperado = { pedidos: Math.max(0, ...pedidos), decisoes: i + 1 };
  assert.deepStrictEqual({ pedidos: deck.pedidos, decisoes: deck.decisoes }, esperado,
    'deck.json: ponha "pedidos" ' + esperado.pedidos + ' (o maior numero ate ' + ate + ', a data da ' + id + ') e "decisoes" '
    + esperado.decisoes + ' (a posicao da ' + id + ' no registro), e rode node scripts/apresentacao.js --gravar');
});

test('novidades: versao com sufixo (-rc.1) e a do topo, e secao sem item de ganho e erro, nunca slide vazio', () => {
  const n = ap.novidades('## 0.90.0-rc.1 — teste\n\n**Novo**\n\n- **Coisa nova**.\n\n## 0.89.0 — velha\n\n**Novo**\n\n- **Velha**.\n');
  assert.strictEqual(n.versao, '0.90.0-rc.1');
  assert.deepStrictEqual(n.itens.map((i) => i.texto), ['Coisa nova']);
  assert.throws(() => ap.novidades('## 9.3.0 — so medido\n\n**Medido e nao adotado**\n\n- **Nada**.\n'), /sairia vazio/);
});

test('o botao Tela cheia some quando o navegador recusa, sem erro solto no console', async () => {
  const corpo = ap.montar(RAIZ).match(/function alternarTela\(\) \{[\s\S]*?\n {2}\}/);
  assert.ok(corpo, 'alternarTela nao achada no visor');
  const alternarTela = new Function('document', 'bTela', corpo[0] + '\nreturn alternarTela();');
  const bTela = { hidden: false };
  alternarTela({ fullscreenElement: null, documentElement: { requestFullscreen: () => Promise.reject(new Error('negado')) } }, bTela);
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(bTela.hidden, true);
});

test('o rotulo do visor diz o que o toque faz: o terco esquerdo volta, o resto avanca', () => {
  assert.match(ap.montar(RAIZ), /aria-label="Apresentação: [^"]*terço esquerdo volta, no resto avança"/);
});

test('a linha de comando: sem --gravar sai 1 com a pagina velha, e 0 depois de --gravar', () => {
  comCopia((tmp) => {
    fs.writeFileSync(path.join(tmp, PAGINA), 'velha\n');
    const correr = (...args) => correrEm(tmp, ...args);
    const antes = correr();
    assert.strictEqual(antes.status, 1, relato(antes));
    assert.match(antes.stdout + antes.stderr, /--gravar/);
    const gravar = correr('--gravar');
    assert.strictEqual(gravar.status, 0, relato(gravar));
    const depois = correr();
    assert.strictEqual(depois.status, 0, relato(depois));
    assert.strictEqual(fs.readFileSync(path.join(tmp, PAGINA), 'utf8'), ap.montar(tmp));
  });
});
