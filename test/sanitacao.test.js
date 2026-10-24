'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const sanit = require('../scripts/lib/sanitacao.js');

const RAIZ = path.join(__dirname, '..');
const LOCAIS = sanit.classes(RAIZ);

/**
 * D79: a sanitacao e um PORTAO, nao uma revisao. "Maestrosa, nao pode passar
 * nada" nao se garante com leitura manual no fim - se garante com um detector
 * que roda no `npm test` e REPROVA o repositorio.
 *
 * Este arquivo NAO escreve nenhum vazamento por extenso: as iscas vem das
 * proprias classes. Um teste que contivesse o vazamento de mentira se acusaria
 * na propria varredura.
 */

// ── o instrumento, antes do que ele mede ─────────────────────────────────

test('sanitacao: o autoteste passa - controle positivo E negativo por classe', () => {
  const r = sanit.autoteste(RAIZ);
  const detalhe = r.falhas.map((f) => f.classe + '/' + f.tipo + ': ' + f.porQue).join(' | ');
  assert.ok(r.ok, 'o detector nao se provou: ' + detalhe);
  assert.ok(r.genericas >= 7, 'menos classes genericas do que o desenho previa');
});

test('sanitacao: toda classe tem isca e controle - nenhuma entra sem prova', () => {
  LOCAIS.forEach((c) => {
    assert.ok(c.isca, c.chave + ' sem isca: seria classe que nunca se provou');
    assert.ok(c.controle, c.chave + ' sem controle negativo');
    assert.notStrictEqual(c.isca, c.controle, c.chave + ': isca igual ao controle nao testa nada');
  });
  assert.strictEqual(new Set(LOCAIS.map((c) => c.chave)).size, LOCAIS.length, 'chave de classe repetida');
});

test('sanitacao: o detector publicavel NAO carrega vocabulario privado', () => {
  // D133: nome de pessoa, empresa e projeto interno sao do dono. Se morassem no
  // modulo, ele iria ao repo publico levando o que existe para impedir.
  const fonte = require('node:fs').readFileSync(path.join(RAIZ, 'scripts/lib/sanitacao.js'), 'utf8');
  const achados = sanit.varrerTexto(fonte, 'scripts/lib/sanitacao.js', LOCAIS);
  assert.strictEqual(achados.length, 0,
    'o proprio detector vaza: ' + achados.map((a) => a.classe + ' -> ' + a.trecho).join(', '));
});

test('sanitacao: sem o arquivo local o detector ainda roda, e declara que roda assim', () => {
  const soGenericas = sanit.classes(path.join(RAIZ, 'test'));
  assert.strictEqual(soGenericas.length, sanit.CLASSES_GENERICAS.length);
  assert.ok(sanit.autoteste(path.join(RAIZ, 'test')).ok, 'modo degradado tem de continuar valido');
});

// ── controles negativos que a D79 pagou caro para aprender ───────────────

test('sanitacao: "task-completion" NAO e chave - o falso positivo da D79', () => {
  const r = sanit.varrerTexto('const x = "ta' + 'sk-completion";', 'a.js', LOCAIS);
  assert.strictEqual(r.filter((a) => a.classe === 'segredo').length, 0);
});

test('sanitacao: /mingw64/bin NAO e impressao de maquina, o uname e', () => {
  const caminho = sanit.varrerTexto('/ming' + 'w64/bin/git status', 'a.js', LOCAIS);
  assert.strictEqual(caminho.filter((a) => a.classe === 'impressao_de_maquina').length, 0);
  const uname = sanit.varrerTexto('MINGW64_NT-' + '10.0-26200', 'a.js', LOCAIS);
  assert.strictEqual(uname.filter((a) => a.classe === 'impressao_de_maquina').length, 1);
});

test('sanitacao: caminho generico nao e pessoal; pasta de usuario e', () => {
  assert.strictEqual(sanit.varrerTexto('rm -rf /tmp/build', 'a.js', LOCAIS).length, 0);
  const pessoal = sanit.varrerTexto('C:' + '\\Users\\' + 'fulano\\x', 'a.js', LOCAIS);
  assert.strictEqual(pessoal.filter((a) => a.classe === 'caminho_de_maquina').length, 1);
});

test('sanitacao: dominio reservado nao e vazamento, dominio real e', () => {
  assert.strictEqual(sanit.varrerTexto('x = "teste' + '@exemplo.com"', 'a.js', LOCAIS).length, 0);
  assert.strictEqual(sanit.varrerTexto('x = "alguem' + '@empresa.com.br"', 'a.js', LOCAIS).length, 1);
});

test('sanitacao: versao semantica nao e IP privado', () => {
  assert.strictEqual(sanit.varrerTexto('node 10.0.2 minimo', 'a.js', LOCAIS).length, 0);
  assert.strictEqual(sanit.varrerTexto('gw em 192.' + '168.0.1', 'a.js', LOCAIS).length, 1);
});

test('sanitacao: a excecao de atribuicao nao libera segredo no mesmo arquivo', () => {
  const segredo = sanit.CLASSES_GENERICAS.filter((c) => c.chave === 'segredo')[0].isca;
  const r = sanit.varrerTexto(segredo, '.claude-plugin/plugin.json', LOCAIS);
  assert.strictEqual(r.length, 1, 'excecao por arquivo inteiro deixaria um segredo passar');
});

test('sanitacao: todo achado cita arquivo e linha - regra anti-teatro', () => {
  const isca = sanit.CLASSES_GENERICAS[0].isca;
  const r = sanit.varrerTexto('linha 1\nlinha 2\n' + isca, 'x/y.js', LOCAIS);
  assert.ok(r.length >= 1);
  assert.strictEqual(r[0].arquivo, 'x/y.js');
  assert.strictEqual(r[0].linha, 3);
});

// D597 (revisao completa, A10-01): ID de sessao do Claude Code e dado do dono quando a sessao e desta maquina.
test('sanitacao: sessoesLocais le os IDs das transcricoes em <projects>/<projeto>/<id>.jsonl', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn sessoes-'));
  try {
    const id = '0f0f0f0f-' + '1111-4222-8333-444444444444';
    const projetos = path.join(home, '.claude', 'projects');
    fs.mkdirSync(path.join(projetos, 'proj'), { recursive: true });
    fs.writeFileSync(path.join(projetos, 'proj', id + '.jsonl'), '{}\n');
    fs.writeFileSync(path.join(projetos, 'proj', 'notas.txt'), 'x');
    fs.writeFileSync(path.join(projetos, 'solto.txt'), 'arquivo fora de pasta de projeto nao e leitura que falhou');
    const r = sanit.sessoesLocais(projetos);
    assert.deepStrictEqual([...r.ids], [id]);
    assert.deepStrictEqual(r.naoLidas, []);
    const sem = sanit.sessoesLocais(path.join(home, 'nao-existe'));
    assert.strictEqual(sem.ids.size, 0, 'sem a pasta: nenhum ID, sem lancar');
    assert.deepStrictEqual(sem.naoLidas, [], 'pasta que nao existe e "nada a comparar", nao leitura que falhou');
  } finally { require('node:fs').rmSync(home, { recursive: true, force: true }); }
});

// Revisao cega do L1, ronda 1 (estados, manutencao): so a pasta AUSENTE e "nada a comparar". A que existe e nao abre
// (aqui um arquivo no lugar dela: ENOTDIR, portavel) e leitura que falhou - e a classe sessao_local procurou no vazio.
function comConfig(dir, fn) {
  const antes = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try { return fn(); } finally {
    if (antes === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = antes;
  }
}

test('sanitacao: sessoesLocais separa a pasta que nao existe da que nao abre', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn sessoes-ruim-'));
  try {
    const arquivo = path.join(dir, 'projects');
    fs.writeFileSync(arquivo, 'nao sou pasta');
    const r = sanit.sessoesLocais(arquivo);
    assert.strictEqual(r.ids.size, 0);
    assert.strictEqual(r.naoLidas.length, 1, 'pasta que existe e nao abre tem de aparecer como nao lida');
    assert.strictEqual(r.naoLidas[0].pasta, arquivo);
    assert.ok(r.naoLidas[0].porQue, 'sem o motivo o dono nao sabe o que consertar');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('sanitacao: a classe sessao_local le as transcricoes de CLAUDE_CONFIG_DIR, como o resto do plugin', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn cfg-'));
  try {
    const id = '0e0e0e0e-' + '1111-4222-8333-555555555555';
    fs.mkdirSync(path.join(cfg, 'projects', 'proj'), { recursive: true });
    fs.writeFileSync(path.join(cfg, 'projects', 'proj', id + '.jsonl'), '{}\n');
    const achados = comConfig(cfg, () => sanit.varrerTexto('id: ' + id, 'a.js', sanit.CLASSES_GENERICAS));
    assert.strictEqual(achados.filter((a) => a.classe === 'sessao_local').length, 1,
      'com CLAUDE_CONFIG_DIR a transcricao nao mora em ~/.claude: o ID da sessao passava como UUID qualquer');
  } finally { fs.rmSync(cfg, { recursive: true, force: true }); }
});

test('sanitacao: pasta de transcricoes que nao abre reprova o autoteste e tira o limpo do auditar', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn cfg-ruim-'));
  const dir = repo();
  try {
    fs.writeFileSync(path.join(cfg, 'projects'), 'nao sou pasta');
    comConfig(cfg, () => {
      const prova = sanit.autoteste(dir);
      assert.strictEqual(prova.ok, false, 'o autoteste dava ok com a isca sozinha no conjunto');
      assert.ok(prova.falhas.some((f) => f.classe === 'sessao_local'), JSON.stringify(prova.falhas));
      const r = sanit.auditar(dir);
      assert.ok(r !== null, 'git nao respondeu');
      assert.strictEqual(r.achados.length, 0);
      assert.strictEqual(r.limpo, false, 'limpo sobre IDs de sessao que nao foram procurados');
      assert.strictEqual(r.sessoes.naoLidas.length, 1);
    });
    assert.ok(sanit.autoteste(dir).ok, 'sem a sobreposicao o autoteste volta a passar');
  } finally {
    fs.rmSync(cfg, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sanitacao: UUID qualquer nao acusa; o da isca de sessao local acusa', () => {
  const classe = sanit.CLASSES_GENERICAS.filter((c) => c.chave === 'sessao_local')[0];
  assert.ok(classe, 'falta a classe sessao_local');
  assert.strictEqual(sanit.varrerTexto('id: ' + classe.isca, 'a.js', LOCAIS).filter((a) => a.classe === 'sessao_local').length, 1);
  assert.strictEqual(sanit.varrerTexto('id: ' + classe.controle, 'a.js', LOCAIS).filter((a) => a.classe === 'sessao_local').length, 0);
});

// D599 (ronda 3 do L1): o `_` e caractere de palavra, entao o `\b` nao separa o ID de `sessao_<id>`; e a conferencia
// mostrou que borda nenhuma serve - `code<id>` e `<id>7` vazam o ID inteiro. Sem borda, quem filtra e o soSe (so ID
// desta maquina acusa), e por isso UUID qualquer segue sem acusar.
test('sanitacao: ID de sessao colado a qualquer caractere tambem acusa', () => {
  const classe = sanit.CLASSES_GENERICAS.filter((c) => c.chave === 'sessao_local')[0];
  const acusa = (t) => sanit.varrerTexto(t, 'a.js', LOCAIS).filter((a) => a.classe === 'sessao_local').length;
  ['sessao_' + classe.isca, classe.isca + '_copia', 'x' + classe.isca, classe.isca.toUpperCase(),
    'code' + classe.isca, classe.isca + '7', 'a' + classe.isca + 'abc'].forEach((t) => {
    assert.strictEqual(acusa(t), 1, t);
  });
  assert.strictEqual(acusa('a' + classe.controle + '7'), 0, 'UUID que nao e sessao desta maquina, colado ou nao, nao acusa');
});

// ── as TRES superficies do repositorio de verdade ────────────────────────

test('sanitacao: docs/ fica fora da superficie publicavel (D132 §1.3)', () => {
  const s = sanit.superficiePublicavel(RAIZ);
  assert.ok(s !== null, 'git nao respondeu - varredura sem veredito nao vale');
  assert.strictEqual(s.filter((a) => a.indexOf('docs/') === 0).length, 0);
  assert.ok(s.length > 50, 'superficie pequena demais: o ls-files provavelmente falhou');
});

test('superficie 1: o CONTEUDO publicavel nao vaza', () => {
  const arquivos = sanit.superficiePublicavel(RAIZ);
  assert.ok(arquivos !== null, 'git nao respondeu');
  const achados = sanit.varrerArquivos(RAIZ, arquivos, LOCAIS);
  const lista = achados.map((a) => a.classe + ' ' + a.arquivo + ':' + a.linha + ' -> ' + a.trecho);
  assert.strictEqual(achados.length, 0, 'vazamento no conteudo:\n  ' + lista.join('\n  '));
});

/**
 * As superficies 2 e 3 sao do HISTORICO, e historico nao se exporta junto: o
 * repositorio publico nasce com commit inicial proprio (D133 §2). Logo elas
 * valem no repositorio PUBLICADO, nao no de trabalho.
 *
 * Como se distingue um do outro sem marcador novo: o repositorio de trabalho e o
 * unico que tem `.sanitacao-local.json` - o vocabulario privado do dono, que o
 * .gitignore mantem fora do git e que por definicao nunca chega ao publico.
 *
 * Isto NAO e afrouxar a catraca para o teste passar. E medir a superficie certa:
 * no export, sem arquivo local, os dois testes rodam e TEM de passar - foi assim
 * que o commit inicial foi conferido antes de existir remoto.
 */
const REPO_DE_TRABALHO = sanit.termosLocais(RAIZ).length > 0;

test('superficie 2: a AUTORIA do historico nao carrega e-mail pessoal (D132 §3)', (t) => {
  if (REPO_DE_TRABALHO) {
    t.skip('repositorio de trabalho: o historico daqui vai para o repo PRIVADO, nunca para o publico');
    return;
  }
  const autores = sanit.autoresDoHistorico(RAIZ);
  assert.ok(autores !== null, 'git log nao respondeu');
  const achados = sanit.varrerAutores(autores);
  assert.strictEqual(achados.length, 0,
    'e-mail em metadado de commit:\n  ' + achados.map((a) => a.trecho).join('\n  '));
});

test('superficie 3: as MENSAGENS de commit nao vazam (D133)', (t) => {
  if (REPO_DE_TRABALHO) {
    t.skip('repositorio de trabalho: as mensagens daqui vao para o repo PRIVADO');
    return;
  }
  const msgs = sanit.mensagensDoHistorico(RAIZ);
  assert.ok(msgs !== null, 'git log nao respondeu');
  const achados = sanit.varrerMensagens(msgs, LOCAIS);
  const lista = achados.map((a) => a.classe + ' ' + a.arquivo + ' -> ' + a.trecho);
  assert.strictEqual(achados.length, 0, 'vazamento na mensagem:\n  ' + lista.join('\n  '));
});

test('superficie 2 e 3: o detector das duas ainda se prova, mesmo aqui', () => {
  // O skip acima cala a ASSERCAO sobre este repositorio, nunca o instrumento.
  // Sem isto, um detector de historico quebrado passaria despercebido no repo de
  // trabalho e so falharia no export - depois de ja ter dito "limpo".
  assert.strictEqual(sanit.varrerAutores(['F <f' + '@gmail.com>']).length, 1);
  assert.strictEqual(sanit.varrerAutores(['F <1+f' + '@users.noreply.github.com>']).length, 0);
  const isca = [{ sha: 'abc', texto: 'toca ' + 'C:' + '\\Users\\' + 'fulano\\x' }];
  assert.ok(sanit.varrerMensagens(isca, LOCAIS).length >= 1);
});

// == T45 ==================================================================
// O portao das TRES superficies, e o comando que faltava. Ate aqui o modulo
// tinha mais de trezentas linhas e NADA o executava inteiro: so o autoteste e a
// superficie 1 eram chamados. Lib sem comando e codigo que ninguem roda.
const os = require('node:os');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(RAIZ, 'scripts', 'sanitar.js');

function repo(comLeitura) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn sanitar-'));
  const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', shell: false });
  g(['init', '-q']);
  fs.writeFileSync(path.join(dir, 'a.txt'), comLeitura || 'nada aqui\n', 'utf8');
  g(['add', '-A']);
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t' + '@exemplo.com',
    'commit', '-qm', 'inicial'], { cwd: dir, encoding: 'utf8', shell: false });
  return dir;
}

function repoComMensagemSuja() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn msg-'));
  const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', shell: false });
  g(['init', '-q']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'nada aqui\n', 'utf8');
  g(['add', '-A']);
  // Suja nas DUAS superficies do historico - o e-mail do autor e a mensagem -
  // e limpa no conteudo: o --so-conteudo tem de ignorar as duas, nao so uma.
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t' + '@empresa.com.br',
    'commit', '-qm', 'ajusta o que alguem' + '@empresa.com.br pediu'],
    { cwd: dir, encoding: 'utf8', shell: false });
  return dir;
}

function sanitar(raiz, extra) {
  return spawnSync(process.execPath, [SCRIPT, '--raiz', raiz].concat(extra || []),
    { encoding: 'utf8', timeout: 60000 });
}

// ── a correcao que a D133 §7 ja tinha pago, e o codigo nao absorveu ──────

test('sanitacao: a superficie inclui o arquivo NOVO que ainda nao foi adicionado', () => {
  const dir = repo();
  const isca = sanit.CLASSES_GENERICAS.filter((c) => c.chave === 'segredo')[0].isca;
  fs.writeFileSync(path.join(dir, 'recem-escrito.js'), 'const k = "' + isca + '";\n', 'utf8');

  const s = sanit.superficiePublicavel(dir);
  assert.ok(s !== null, 'git nao respondeu');
  assert.ok(s.indexOf('recem-escrito.js') !== -1,
    'com `ls-files` puro o arquivo recem-escrito fica invisivel: foi assim que o ' +
    'export saiu com 92 de 95 arquivos, e os que faltavam eram o proprio detector');

  const achados = sanit.varrerArquivos(dir, s, sanit.CLASSES_GENERICAS);
  assert.strictEqual(achados.length, 1, 'o vazamento no arquivo novo tinha de ser pego');
  assert.strictEqual(achados[0].arquivo, 'recem-escrito.js');
});

test('sanitacao: arquivo ignorado pelo .gitignore fica FORA da superficie', () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, '.gitignore'), 'privado.json\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'privado.json'), '{"x":1}\n', 'utf8');
  const s = sanit.superficiePublicavel(dir);
  assert.strictEqual(s.indexOf('privado.json'), -1,
    'sem --exclude-standard o proprio ' + sanit.ARQUIVO_LOCAL + ' entraria na varredura, ' +
    'e o vocabulario privado se acusaria inteiro');
});

test('sanitacao: todo achado diz de QUE superficie veio', () => {
  const isca = sanit.CLASSES_GENERICAS.filter((c) => c.chave === 'segredo')[0].isca;
  const dir = repo('const k = "' + isca + '";\n');
  const r = sanit.auditar(dir);
  assert.ok(r !== null, 'git nao respondeu');
  r.achados.forEach((a) => {
    assert.ok([1, 2, 3].indexOf(a.superficie) !== -1,
      'achado sem superficie: a decisao 13 depende de separar o conteudo do resto');
  });
  assert.strictEqual(r.porSuperficie[1], 1);
  assert.ok(sanit.varrerAutores(['F <f' + '@empresa.com>'])[0].superficie === 2);
  assert.ok(sanit.varrerMensagens([{ sha: 'a', texto: 'k ' + isca }], sanit.CLASSES_GENERICAS)[0]
    .superficie === 3);
});

// ── o comando, exercido como processo ────────────────────────────────────

test('sanitar: repositorio limpo -> saida 0 e veredito nas tres superficies', () => {
  const r = sanitar(repo());
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(/SUPERFICIE 1 conteudo/.test(r.stdout), r.stdout);
  assert.ok(/SUPERFICIE 2 autoria/.test(r.stdout), r.stdout);
  assert.ok(/SUPERFICIE 3 mensagens/.test(r.stdout), r.stdout);
  assert.ok(/LIMPO nas tres superficies/.test(r.stdout), r.stdout);
  assert.ok(r.stdout.indexOf('Fora da superficie: so o que o .gitignore cobre.') !== -1, r.stdout);
});

test('sanitar: vazamento no conteudo -> saida 1, com arquivo, linha e superficie', () => {
  const isca = sanit.CLASSES_GENERICAS.filter((c) => c.chave === 'segredo')[0].isca;
  const r = sanitar(repo('const k = "' + isca + '";\n'));
  assert.strictEqual(r.status, 1, 'vazou e o comando devolveu ' + r.status);
  assert.ok(/VAZOU - 1 achado/.test(r.stdout), r.stdout);
  assert.ok(/S1\s+segredo\s+a\.txt:1/.test(r.stdout), r.stdout);
});

/**
 * A saida deste comando existe para ser colada em relatorio. Imprimir o trecho
 * mudaria o vazamento de lugar em vez de resolve-lo.
 */
test('sanitar: o comando NAO imprime o trecho vazado', () => {
  const isca = sanit.CLASSES_GENERICAS.filter((c) => c.chave === 'segredo')[0].isca;
  const r = sanitar(repo('const k = "' + isca + '";\n'));
  assert.strictEqual(r.stdout.indexOf(isca), -1, 'o segredo saiu no terminal');
  assert.strictEqual(r.stderr.indexOf(isca), -1, 'o segredo saiu no stderr');
});

/**
 * A saida tambem e evidencia colada. Um comando que caca caminho de maquina nao
 * pode abrir a propria saida com o caminho absoluto desta maquina - defeito
 * pego no ensaio, corrigido na origem.
 */
test('sanitar: a raiz sai COMO FOI PEDIDA, nunca resolvida', () => {
  const dir = repo();
  const r = sanitar(dir);
  assert.ok(r.stdout.indexOf('Sanitacao de ' + dir) !== -1, r.stdout.slice(0, 120));
  const comPonto = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8', timeout: 60000 });
  assert.ok(/^Sanitacao de \.$/m.test(comPonto.stdout),
    'sem --raiz a primeira linha tinha de ser um ponto, nao o caminho absoluto:\n' +
    comPonto.stdout.split('\n')[0]);
});

test('sanitar: sem git NAO devolve 0 - devolve 2, e diz que nao mediu', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn sem git-'));
  const r = sanitar(dir);
  assert.strictEqual(r.status, 2, 'dizer "limpo" sobre o que nao leu e o silencio que isto quebra');
  assert.ok(/NAO DEU PARA MEDIR/.test(r.stderr), r.stderr);
});

test('sanitar: sem o vocabulario local o comando DECLARA que roda assim', () => {
  const r = sanitar(repo());
  assert.ok(r.stdout.indexOf('SEM ' + sanit.ARQUIVO_LOCAL) !== -1, r.stdout);
  assert.ok(/NAO estao sendo procurados/.test(r.stdout),
    'rodar so com as genericas e legitimo; nao dizer que rodou assim, nao');

  // Controle: COM vocabulario, o aviso some e a conta diz quantas classes
  // locais rodaram. Aviso impresso sempre e o mesmo silencio, ao contrario.
  const dir = repo();
  fs.writeFileSync(path.join(dir, '.gitignore'), sanit.ARQUIVO_LOCAL + '\n', 'utf8');
  fs.writeFileSync(path.join(dir, sanit.ARQUIVO_LOCAL), JSON.stringify({
    termos: [{ chave: 'sintetica', nome: 'sintetica', padrao: 'MARCA-INTERNA',
               isca: 'x MARCA-INTERNA y', controle: 'outra coisa' }]
  }), 'utf8');
  const com = sanitar(dir);
  assert.strictEqual(com.stdout.indexOf('SEM ' + sanit.ARQUIVO_LOCAL), -1, com.stdout);
  assert.ok(com.stdout.indexOf(sanit.CLASSES_GENERICAS.length +
    ' classes genericas + 1 do vocabulario local') !== -1, com.stdout);
});

/**
 * Decisao 13: so o CONTEUDO reprova a suite. Este e o teste que a prova - e ele
 * precisa de um repositorio que vaze nas superficies 2 e 3 e NAO no conteudo, senao
 * as duas saidas seriam 0 por coincidencia e o --so-conteudo nao mediria nada.
 */
test('sanitar: --so-conteudo julga a superficie 1 e ignora as outras duas', () => {
  const dir = repoComMensagemSuja();
  const tudo = sanitar(dir);
  assert.strictEqual(tudo.status, 1, 'a mensagem suja tinha de reprovar a rodada inteira');
  assert.ok(/SUPERFICIE 3 mensagens\s+1 commits\s+-> 1/.test(tudo.stdout), tudo.stdout);
  // O placar e a lista sao a leitura do relatorio: cada linha diz a SUA
  // superficie, e o achado do historico nao pode sair rotulado como conteudo.
  assert.ok(/SUPERFICIE 1 conteudo\s+1 arquivos\s+-> 0/.test(tudo.stdout), tudo.stdout);
  assert.ok(/SUPERFICIE 2 autoria\s+historico\s+-> 1/.test(tudo.stdout), tudo.stdout);
  assert.ok(/VAZOU - 2 achado/.test(tudo.stdout), tudo.stdout);
  assert.ok(/^ {2}S2 {2}autoria_do_historico /m.test(tudo.stdout), tudo.stdout);
  assert.ok(/^ {2}S3 {2}email /m.test(tudo.stdout), tudo.stdout);

  const so1 = sanitar(dir, ['--so-conteudo']);
  assert.strictEqual(so1.status, 0,
    'a suite roda em copia SEM historico: mensagem de commit nao pode reprova-la');
  assert.ok(/LIMPO no conteudo/.test(so1.stdout), so1.stdout);
});

/**
 * O instrumento antes do que ele mede. Se o autoteste do detector falha, nao ha
 * veredito nenhum a dar - e dar 'limpo' seria a pior saida possivel, porque e a
 * que ninguem confere.
 */
test('sanitar: detector que nao se prova NAO da veredito - saida 2', () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, sanit.ARQUIVO_LOCAL), JSON.stringify({
    termos: [{ chave: 'quebrada', nome: 'classe quebrada', padrao: 'NUNCA_CASA_ISTO',
               isca: 'uma isca que o padrao nao acha', controle: 'outra coisa' }]
  }), 'utf8');
  const r = sanitar(dir);
  assert.strictEqual(r.status, 2, 'detector sem prova nao pode devolver 0 nem 1');
  assert.ok(/O DETECTOR NAO SE PROVOU/.test(r.stderr), r.stderr);
  assert.ok(/controle positivo/.test(r.stderr), r.stderr);
});

// ── a superficie AUTORIA: nenhuma excecao carregando peso ────────────────

/**
 * Decisao 20 do plano: publica-se sob o usuario, nao sob o nome civil. A
 * consequencia mecanica e esta - com o nome trocado, NENHUMA excecao precisa
 * existir. Excecao que segura um achado de verdade e um buraco declarado, e um
 * buraco declarado que ninguem relê vira um buraco esquecido.
 */
test('sanitacao: nenhuma excecao esta carregando peso', () => {
  const carregando = [];
  LOCAIS.filter((c) => Array.isArray(c.excecaoEm) && c.excecaoEm.length > 0).forEach((c) => {
    const semExcecao = Object.assign({}, c, { excecaoEm: undefined });
    c.excecaoEm.forEach((rel) => {
      let conteudo;
      try { conteudo = fs.readFileSync(path.join(RAIZ, rel), 'utf8'); } catch (e) { return; }
      const achados = sanit.varrerTexto(conteudo, rel, [semExcecao]);
      if (achados.length > 0) carregando.push(c.chave + ' em ' + rel + ' (' + achados.length + ')');
    });
  });
  assert.deepStrictEqual(carregando, [],
    'ha excecao segurando achado de verdade - o arquivo publicado depende dela: ' +
    carregando.join(' | '));
});

/** Controle: o teste acima passa por vacuidade se o instrumento for cego. */
test('sanitacao: o teste acima SABE reconhecer excecao que carrega peso', () => {
  const classe = { chave: 'sintetica', nome: 'sintetica', padrao: /MARCA-INTERNA/g,
                   excecaoEm: ['a/b.txt'] };
  assert.strictEqual(sanit.varrerTexto('x MARCA-INTERNA y', 'a/b.txt', [classe]).length, 0,
    'a excecao tinha de calar o achado');
  const sem = Object.assign({}, classe, { excecaoEm: undefined });
  assert.strictEqual(sanit.varrerTexto('x MARCA-INTERNA y', 'a/b.txt', [sem]).length, 1,
    'sem a excecao tinha de acusar - senao o teste acima nao mede nada');
});

/**
 * O export e auditado ANTES do primeiro commit - e so ali a auditoria ainda
 * serve para alguma coisa, porque depois do push o historico e publico. Um
 * detector que devolvesse 'nao sei' nesse estado empurraria a conferencia para
 * depois do ato irreversivel.
 */
test('sanitar: repositorio SEM commit nenhum e medivel - 0 nao e o mesmo que nao sei', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn sem commit-'));
  spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8', shell: false });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'nada aqui\n', 'utf8');
  spawnSync('git', ['add', '-A'], { cwd: dir, encoding: 'utf8', shell: false });

  assert.strictEqual(sanit.semCommits(dir), true);
  assert.strictEqual(sanit.semCommits(repo()), false,
    'com commit tinha de ser false: um git log que falhasse passaria por historico vazio');
  assert.deepStrictEqual(sanit.autoresDoHistorico(dir), []);
  assert.deepStrictEqual(sanit.mensagensDoHistorico(dir), []);

  const r = sanitar(dir);
  assert.strictEqual(r.status, 0, 'sem historico nao ha o que vazar: ' + r.stdout + r.stderr);
  assert.ok(/SUPERFICIE 3 mensagens\s+0 commits/.test(r.stdout), r.stdout);
});

/** Controle: pasta que NAO e repositorio continua sendo 'nao sei', nao 'limpo'. */
test('sanitar: pasta que nao e repositorio segue sendo NAO SEI, nao vazio', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn nao repo-'));
  assert.strictEqual(sanit.semCommits(dir), false,
    'sem isto, qualquer pasta do disco passaria por repositorio limpo');
  assert.strictEqual(sanit.autoresDoHistorico(dir), null);
});

// == D419/D420: defeitos do detector, achados IN-01 a IN-05 ====================
// Cada isca abaixo e montada por concatenacao: o detector varre este arquivo.

const CAMINHO_PESSOAL = 'C:' + '\\Users\\' + 'fulano\\x';
const MAC = '/Us' + 'ers/';

function lerVocabulario(dir, objeto, comBom) {
  const json = typeof objeto === 'string' ? objeto : JSON.stringify(objeto);
  fs.writeFileSync(path.join(dir, sanit.ARQUIVO_LOCAL), (comBom ? '﻿' : '') + json, 'utf8');
}

const TERMO_SINTETICO = {
  chave: 'sintetica', nome: 'sintetica', padrao: 'MARCA-INTERNA',
  isca: 'x MARCA-INTERNA y', controle: 'outra coisa'
};

// ── IN-01: nome com acento nao pode fazer o arquivo sumir da superficie ──

test('IN-01: arquivo com acento no nome entra na superficie e e lido', () => {
  const dir = repo();
  const nome = 'instala' + 'ção.md';
  fs.writeFileSync(path.join(dir, nome), 'veja ' + CAMINHO_PESSOAL + '\n', 'utf8');
  spawnSync('git', ['add', '-A'], { cwd: dir, encoding: 'utf8', shell: false });

  const s = sanit.superficiePublicavel(dir);
  assert.ok(s !== null && s.indexOf(nome) !== -1,
    'sem `-z` o git devolve o nome entre aspas com escape octal e o arquivo some: ' + JSON.stringify(s));
  const achados = sanit.varrerArquivos(dir, s, sanit.CLASSES_GENERICAS);
  assert.strictEqual(achados.length, 1);
  assert.strictEqual(achados[0].arquivo, nome);

  const r = sanitar(dir);
  assert.strictEqual(r.status, 1, 'o unico arquivo sujo tem acento no nome e o comando disse: ' + r.stdout);
  assert.ok(r.stdout.indexOf(nome) !== -1, r.stdout);
});

// ── IN-01: arquivo da superficie que nao abre nao some calado ────────────

test('IN-01: varrerArquivos DIZ o arquivo que nao conseguiu abrir', () => {
  const dir = repo();
  const ilegiveis = [];
  // caminho com NUL: o Node recusa a abertura em qualquer sistema, sem ENOENT
  const achados = sanit.varrerArquivos(dir, ['a.txt', 'quebrado\0.txt'], sanit.CLASSES_GENERICAS, ilegiveis);
  assert.strictEqual(achados.length, 0);
  assert.strictEqual(ilegiveis.length, 1, 'o arquivo que nao abriu tinha de ser declarado');
  assert.ok(ilegiveis[0].arquivo.indexOf('quebrado') !== -1);
  // arquivo apagado do disco mas ainda no indice nao e "ilegivel": nao ha o que publicar
  const apagado = [];
  sanit.varrerArquivos(dir, ['nao-existe.txt'], sanit.CLASSES_GENERICAS, apagado);
  assert.strictEqual(apagado.length, 0);
});

test('IN-01: sanitar com arquivo que nao abre devolve 2, nunca LIMPO', (t) => {
  const dir = repo();
  const alvo = path.join(dir, 'fechado.txt');
  fs.writeFileSync(alvo, 'nada aqui\n', 'utf8');
  spawnSync('git', ['add', '-A'], { cwd: dir, encoding: 'utf8', shell: false });
  if (process.platform === 'win32') {
    spawnSync('icacls', [alvo, '/deny', '*S-1-1-0:(R)'], { encoding: 'utf8' });
  } else {
    fs.chmodSync(alvo, 0);
  }
  try {
    let abre = true;
    try { fs.readFileSync(alvo); } catch (e) { abre = false; }
    if (abre) { t.skip('este ambiente nao consegue tornar um arquivo ilegivel'); return; }
    const r = sanitar(dir);
    assert.strictEqual(r.status, 2, 'arquivo que nao abriu e "nao deu para medir": ' + r.stdout + r.stderr);
    assert.ok(/NAO DEU PARA MEDIR/.test(r.stdout + r.stderr), r.stdout + r.stderr);
    assert.ok((r.stdout + r.stderr).indexOf('fechado.txt') !== -1, 'tinha de nomear o arquivo');
    assert.ok(!/LIMPO/.test(r.stdout), r.stdout);
  } finally {
    if (process.platform === 'win32') {
      spawnSync('icacls', [alvo, '/remove:d', '*S-1-1-0'], { encoding: 'utf8' });
    } else {
      try { fs.chmodSync(alvo, 0o644); } catch (e) { /* sem permissao para desfazer */ }
    }
  }
});

// ── IN-02: UTF-16 (o que o PowerShell 5.1 grava com `>`) tambem e lido ───

test('IN-02: arquivo UTF-16 com BOM e acusado como o UTF-8', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn utf16-'));
  const corpo = 'veja ' + CAMINHO_PESSOAL + '\r\n';
  const le = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(corpo, 'utf16le')]);
  const be = Buffer.concat([Buffer.from([0xFE, 0xFF]), Buffer.from(corpo, 'utf16le').swap16()]);
  const u8 = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(MAC + 'fulano/x\n', 'utf8')]);
  fs.writeFileSync(path.join(dir, 'le.txt'), le);
  fs.writeFileSync(path.join(dir, 'be.txt'), be);
  fs.writeFileSync(path.join(dir, 'u8.txt'), u8);
  const achados = sanit.varrerArquivos(dir, ['le.txt', 'be.txt', 'u8.txt'], sanit.CLASSES_GENERICAS);
  assert.deepStrictEqual(achados.map((a) => a.arquivo).sort(), ['be.txt', 'le.txt', 'u8.txt']);
  assert.ok(achados.every((a) => a.linha === 1), JSON.stringify(achados));
});

// ── IN-03: flag sem `g` num termo local travava o processo ───────────────

test('IN-03: termo local com flags "i" (sem g) nao pendura a varredura', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn flags-'));
  lerVocabulario(dir, { termos: [Object.assign({}, TERMO_SINTETICO, { flags: 'i' })] });
  const codigo = 'const s = require(' + JSON.stringify(path.join(RAIZ, 'scripts', 'lib', 'sanitacao.js')) + ');' +
    'const c = s.classes(' + JSON.stringify(dir) + ');' +
    'process.stdout.write(String(s.varrerTexto("x marca-interna y", "a.txt", c)' +
    '.filter((a) => a.classe === "sintetica").length));';
  const r = spawnSync(process.execPath, ['-e', codigo], { encoding: 'utf8', timeout: 10000 });
  assert.ifError(r.error);
  assert.strictEqual(r.stdout, '1', 'o termo sem g tinha de achar UMA vez e terminar');
});

// ── IN-04: vocabulario privado nao some calado ───────────────────────────

test('IN-04: vocabulario local gravado com BOM e lido', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn bom-'));
  lerVocabulario(dir, { termos: [TERMO_SINTETICO] }, true);
  assert.strictEqual(sanit.termosLocais(dir).length, 1, 'o BOM do PowerShell zerava o vocabulario');
  assert.strictEqual(sanit.lerVocabularioLocal(dir).estado, 'ok');
});

test('IN-04: ausente, presente e valido, presente e invalido sao tres estados', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn vocab-'));
  assert.strictEqual(sanit.lerVocabularioLocal(dir).estado, 'ausente');
  lerVocabulario(dir, { termos: [TERMO_SINTETICO] });
  assert.strictEqual(sanit.lerVocabularioLocal(dir).estado, 'ok');
  lerVocabulario(dir, '{ isto nao e json');
  assert.strictEqual(sanit.lerVocabularioLocal(dir).estado, 'invalido');
  lerVocabulario(dir, { termos: 'nao e lista' });
  assert.strictEqual(sanit.lerVocabularioLocal(dir).estado, 'invalido');
});

test('IN-04: sanitar com vocabulario local quebrado devolve 2, nunca LIMPO', () => {
  const dir = repo();
  lerVocabulario(dir, '{ isto nao e json');
  const r = sanitar(dir);
  assert.strictEqual(r.status, 2, 'JSON quebrado calava o vocabulario e o veredito saia LIMPO: ' + r.stdout);
  assert.ok(r.stderr.indexOf(sanit.ARQUIVO_LOCAL) !== -1, r.stderr);
  assert.ok(!/LIMPO/.test(r.stdout), r.stdout);
});

test('IN-04: termo descartado por regex invalida e dito, com a chave, e a saida e 2', () => {
  const dir = repo();
  lerVocabulario(dir, { termos: [TERMO_SINTETICO,
    { chave: 'regex_quebrada', nome: 'x', padrao: '(', isca: 'a', controle: 'b' }] });
  const v = sanit.lerVocabularioLocal(dir);
  assert.strictEqual(v.termos.length, 1, 'o termo bom segue valendo');
  assert.strictEqual(v.descartados.length, 1);
  assert.strictEqual(v.descartados[0].chave, 'regex_quebrada');
  const r = sanitar(dir);
  assert.strictEqual(r.status, 2, r.stdout + r.stderr);
  assert.ok(r.stderr.indexOf('regex_quebrada') !== -1, r.stderr);
});

// ── IN-05: /Users/<nome> do macOS no meio de uma linha ───────────────────

test('IN-05: pasta pessoal do macOS e acusada em qualquer contexto, nao so apos espaco', () => {
  const deve = [
    'veja `' + MAC + 'joao/proj` no mac',
    'PATH=' + MAC + 'joao/bin',
    '[' + MAC + 'joao/x]',
    'a,' + MAC + 'joao/x',
    '<code>' + MAC + 'joao/x</code>',
    'cd ' + MAC + 'joao/proj',
    MAC + 'joao/no-comeco'
  ];
  deve.forEach((linha) => {
    const n = sanit.varrerTexto(linha, 'a.md', sanit.CLASSES_GENERICAS)
      .filter((a) => a.classe === 'caminho_de_maquina').length;
    assert.strictEqual(n, 1, 'nao acusou: ' + linha);
  });
});

test('IN-05: rota /Users/ no meio de outro caminho segue sendo permitida', () => {
  ['rota src/api' + MAC + 'listar', 'GET https://exemplo.com/api' + MAC + 'listar'].forEach((linha) => {
    assert.strictEqual(sanit.varrerTexto(linha, 'a.md', sanit.CLASSES_GENERICAS).length, 0,
      'falso positivo: ' + linha);
  });
});

// s62/D430: a letra de unidade nao pode vir colada em outra letra - o `p:` de `http:` nao e disco.
test('D430: URL com users nao e pasta pessoal; caminho do Windows em qualquer caixa segue acusado', () => {
  const U = 'sers';
  ['http://u' + U + '/42', 'veja https://u' + U + '/42 no doc'].forEach((linha) => {
    assert.strictEqual(sanit.varrerTexto(linha, 'a.md', sanit.CLASSES_GENERICAS).length, 0,
      'falso positivo: ' + linha);
  });
  ['C:' + '\\u' + U + '\\fulano', 'em c:' + '/U' + U + '/fulano', 'file:///C:' + '/U' + U + '/fulano',
    '"D:' + '\\U' + U + '\\x"'].forEach((linha) => {
    assert.ok(sanit.varrerTexto(linha, 'a.md', sanit.CLASSES_GENERICAS).length > 0, 'devia acusar: ' + linha);
  });
});

// == D419: sub-bloco S3 do sworn-review-aaa, achados L1-11/12/14/16/17 ======

// ── L1-11: e-mail sem ancora era quadratico em linha longa sem '@' ───────

test('L1-11: linha longa sem arroba nao leva segundos (e-mail sem ancora era O(n^2))', () => {
  const linhas = ['a.'.repeat(50000), 'a'.repeat(100000), 'a@'.repeat(30000)];
  linhas.forEach((linha) => {
    const t0 = Date.now();
    const achados = sanit.varrerTexto(linha, 'a.txt', sanit.CLASSES_GENERICAS);
    const ms = Date.now() - t0;
    assert.ok(ms < 1000, 'varrerTexto levou ' + ms + ' ms numa linha de ' + linha.length + ' caracteres');
    assert.strictEqual(achados.length, 0);
  });
});

test('L1-11: a ancora nao muda o que casa - e-mail no meio, colado e apos falha segue acusado', () => {
  const dominio = '@empresa.com.br';
  const deve = [
    'fala com ana.souza' + dominio + ' ok',
    '<ana' + dominio + '>',
    'a@b ana' + dominio,
    'x@y' + '@zz.com'
  ];
  deve.forEach((linha) => {
    const n = sanit.varrerTexto(linha, 'a.md', sanit.CLASSES_GENERICAS)
      .filter((a) => a.classe === 'email').length;
    assert.strictEqual(n, 1, 'nao acusou: ' + linha);
  });
});

// ── L1-12: saida grande do git nao pode virar "git mudo" ─────────────────

test('L1-12: indice grande (saida do git > 1 MiB) nao vira null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn grande-'));
  const git = (args, entrada) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', shell: false, input: entrada });
  git(['init', '-q']);
  const blob = git(['hash-object', '-w', '--stdin'], '').stdout.trim();
  const linhas = [];
  for (let i = 0; i < 12000; i++) {
    linhas.push('100644 ' + blob + ' 0\tpasta-de-nome-comprido-para-encher-a-saida/' + 'x'.repeat(100) + '-' + i);
  }
  const r = git(['update-index', '--add', '--index-info'], linhas.join('\n') + '\n');
  assert.strictEqual(r.status, 0, r.stderr);
  const s = sanit.superficiePublicavel(dir);
  assert.ok(s !== null, 'a saida do ls-files passou do maxBuffer padrao e a auditoria virou "nao sei"');
  assert.strictEqual(s.length, 12000);
});

// ── L1-14: caminho de maquina nao depende da caixa ───────────────────────

test('L1-14: pasta pessoal do Windows e acusada em qualquer caixa', () => {
  const deve = [
    'c:' + '\\users\\' + 'fulano\\x',
    'C:' + '\\USERS\\' + 'fulano',
    'd:' + '/uSeRs/' + 'fulano/x'
  ];
  deve.forEach((linha) => {
    const n = sanit.varrerTexto(linha, 'a.md', sanit.CLASSES_GENERICAS)
      .filter((a) => a.classe === 'caminho_de_maquina').length;
    assert.strictEqual(n, 1, 'nao acusou: ' + linha);
  });
});

test('L1-14: a caixa solta nao cria falso positivo - rota /users/ e /home de documentacao seguem de fora', () => {
  ['GET /us' + 'ers/42', 'rota /api/us' + 'ers/listar', 'o prefixo /Ho' + 'me/ nao e pasta'].forEach((linha) => {
    const n = sanit.varrerTexto(linha, 'a.md', sanit.CLASSES_GENERICAS)
      .filter((a) => a.classe === 'caminho_de_maquina').length;
    assert.strictEqual(n, 0, 'falso positivo: ' + linha);
  });
});

// ── L1-16: excecaoEm e padrao vazio do vocabulario local ─────────────────

test('L1-16: excecaoEm que nao e lista e rejeitado com mensagem, nao lanca em varrerTexto', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn exc-'));
  lerVocabulario(dir, { termos: [Object.assign({}, TERMO_SINTETICO, { excecaoEm: 'docs/nota.md' })] });
  const v = sanit.lerVocabularioLocal(dir);
  assert.strictEqual(v.termos.length, 0);
  assert.strictEqual(v.descartados.length, 1);
  assert.ok(/excecaoEm/.test(v.descartados[0].porQue), v.descartados[0].porQue);
  assert.doesNotThrow(() => sanit.varrerTexto('x MARCA-INTERNA y', 'a.txt', sanit.classes(dir)));
});

test('L1-16: excecaoEm com item que nao e texto tambem e rejeitado; lista valida segue valendo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn exc2-'));
  lerVocabulario(dir, { termos: [
    Object.assign({}, TERMO_SINTETICO, { chave: 'ruim', excecaoEm: ['ok.md', 7] }),
    Object.assign({}, TERMO_SINTETICO, { chave: 'boa', excecaoEm: ['ok.md'] })
  ] });
  const v = sanit.lerVocabularioLocal(dir);
  assert.deepStrictEqual(v.descartados.map((d) => d.chave), ['ruim']);
  assert.deepStrictEqual(v.termos.map((t) => t.chave), ['boa']);
});

test('L1-16: padrao que casa vazio e rejeitado, nao acusa toda linha', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn vazio-'));
  lerVocabulario(dir, { termos: [Object.assign({}, TERMO_SINTETICO, { chave: 'casa_vazio', padrao: 'x*' })] });
  const v = sanit.lerVocabularioLocal(dir);
  assert.strictEqual(v.termos.length, 0, 'o padrao x* entrou e casa em toda linha');
  assert.deepStrictEqual(v.descartados.map((d) => d.chave), ['casa_vazio']);
  assert.ok(/vazio/.test(v.descartados[0].porQue), v.descartados[0].porQue);
});

test('L1-16: sanitar com excecaoEm invalido devolve 2, nunca LIMPO nem excecao nao tratada', () => {
  const dir = repo();
  lerVocabulario(dir, { termos: [Object.assign({}, TERMO_SINTETICO, { excecaoEm: 'docs/nota.md' })] });
  const r = sanitar(dir);
  assert.strictEqual(r.status, 2, r.stdout + r.stderr);
  assert.ok(r.stderr.indexOf('excecaoEm') !== -1, r.stderr);
});

// ── L1-17: arquivo com NUL que nao decodifica nao passa limpo ────────────

// D429/2: o dono decidiu que binario (NUL) PULA com aviso "nao conferido" em vez de
// travar o sanitizador com saida 2. O que antes ia a `ilegiveis` (L1-17) agora vai
// a `naoConferidos`; `ilegiveis` fica so para o que nao abriu.
test('L1-17/D429-2: UTF-16 sem BOM e UTF-32 (NUL) vao a naoConferidos com motivo, nao a ilegiveis', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn nul-'));
  const corpo = 'veja ' + CAMINHO_PESSOAL + '\r\n';
  fs.writeFileSync(path.join(dir, 'semBom.txt'), Buffer.from(corpo, 'utf16le'));
  const u32 = Buffer.alloc(corpo.length * 4);
  for (let i = 0; i < corpo.length; i++) u32.writeUInt32LE(corpo.charCodeAt(i), i * 4);
  fs.writeFileSync(path.join(dir, 'u32.txt'), Buffer.concat([Buffer.from([0xFF, 0xFE, 0, 0]), u32]));
  fs.writeFileSync(path.join(dir, 'limpo.txt'), 'nada aqui\n', 'utf8');
  const ilegiveis = [];
  const naoConferidos = [];
  const achados = sanit.varrerArquivos(dir, ['semBom.txt', 'u32.txt', 'limpo.txt'], sanit.CLASSES_GENERICAS, ilegiveis, naoConferidos);
  assert.strictEqual(achados.length, 0);
  assert.strictEqual(ilegiveis.length, 0, 'binario nao e mais ilegivel: ' + JSON.stringify(ilegiveis));
  assert.deepStrictEqual(naoConferidos.map((i) => i.arquivo).sort(), ['semBom.txt', 'u32.txt']);
  assert.ok(naoConferidos.every((i) => /NUL/.test(i.porQue)), JSON.stringify(naoConferidos));
});

test('L1-17: UTF-16 com BOM (o que o PowerShell grava) segue lido e nao e declarado ilegivel', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn nul2-'));
  fs.writeFileSync(path.join(dir, 'le.txt'),
    Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('veja ' + CAMINHO_PESSOAL + '\r\n', 'utf16le')]));
  const ilegiveis = [];
  const achados = sanit.varrerArquivos(dir, ['le.txt'], sanit.CLASSES_GENERICAS, ilegiveis);
  assert.strictEqual(achados.length, 1);
  assert.strictEqual(ilegiveis.length, 0);
});

test('L1-17/D429-2: sanitar com UTF-16 sem BOM da LIMPO com o aviso "nao conferido", saida 0', () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'ps.txt'), Buffer.from('veja ' + CAMINHO_PESSOAL + '\r\n', 'utf16le'));
  spawnSync('git', ['add', '-A'], { cwd: dir, encoding: 'utf8', shell: false });
  const r = sanitar(dir);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(/nao conferido/.test(r.stdout), 'o aviso tinha de sair no relatorio: ' + r.stdout);
  assert.ok(r.stdout.indexOf('ps.txt') !== -1, 'tinha de nomear o arquivo');
  assert.ok(!/NAO LI/.test(r.stdout + r.stderr), 'binario nao e mais "NAO LI": ' + r.stdout);
});

// ── D429/2: binario pula com aviso ───────────────────────────────────────

test('D429/2: binario com NUL nao esta em ilegiveis, esta em naoConferidos com o motivo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn bin-'));
  fs.writeFileSync(path.join(dir, 'img.bin'), Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x00, 0x00, 0x1A, 0x0A]));
  const ilegiveis = [];
  const naoConferidos = [];
  sanit.varrerArquivos(dir, ['img.bin'], sanit.CLASSES_GENERICAS, ilegiveis, naoConferidos);
  assert.deepStrictEqual(ilegiveis, []);
  assert.strictEqual(naoConferidos.length, 1);
  assert.strictEqual(naoConferidos[0].arquivo, 'img.bin');
  assert.ok(/binario/.test(naoConferidos[0].porQue), naoConferidos[0].porQue);
});

test('D429/2: erro de leitura continua em ilegiveis, nao em naoConferidos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn bin2-'));
  const ilegiveis = [];
  const naoConferidos = [];
  sanit.varrerArquivos(dir, ['quebrado\0.txt'], sanit.CLASSES_GENERICAS, ilegiveis, naoConferidos);
  assert.strictEqual(ilegiveis.length, 1);
  assert.strictEqual(naoConferidos.length, 0);
});

test('D429/2: auditar devolve naoConferidos e o binario sozinho nao tira o limpo', () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'img.bin'), Buffer.from([0x00, 0x01, 0x02, 0x00]));
  spawnSync('git', ['add', '-A'], { cwd: dir, encoding: 'utf8', shell: false });
  const r = sanit.auditar(dir);
  assert.deepStrictEqual(r.naoConferidos.map((i) => i.arquivo), ['img.bin']);
  assert.strictEqual(r.ilegiveis.length, 0);
  assert.strictEqual(r.limpo, true);
});

test('D429/2: vazamento em outro arquivo ainda da 1 mesmo com binario ao lado', () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'img.bin'), Buffer.from([0x00, 0x01, 0x02, 0x00]));
  fs.writeFileSync(path.join(dir, 'vaza.txt'), 'veja ' + CAMINHO_PESSOAL + '\n', 'utf8');
  spawnSync('git', ['add', '-A'], { cwd: dir, encoding: 'utf8', shell: false });
  const r = sanitar(dir);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(/nao conferido/.test(r.stdout), r.stdout);
});

// ── T-1a (lote1 #13): auditar() direto, sem o autoteste na frente ────────

test('T-1a #13: auditar() direto nao diz LIMPO com vocabulario local quebrado', () => {
  const quebrado = repo();
  lerVocabulario(quebrado, '{ isto nao e json');
  const r = sanit.auditar(quebrado);
  assert.strictEqual(r.vocabulario.estado, 'invalido');
  assert.strictEqual(r.limpo, false, 'o vocabulario privado nao foi procurado e o veredito saiu LIMPO');

  const descartado = repo();
  lerVocabulario(descartado, { termos: [{ chave: 'regex_quebrada', nome: 'x', padrao: '(' }] });
  const d = sanit.auditar(descartado);
  assert.deepStrictEqual(d.vocabulario.descartados.map((x) => x.chave), ['regex_quebrada']);
  assert.strictEqual(d.limpo, false, 'termo descartado nao e procurado: o veredito nao pode ser LIMPO');

  // controle: vocabulario valido (e ausente) segue limpo. O .gitignore tira o arquivo local da
  // superficie, como no repositorio real (senao o vocabulario se acusaria inteiro).
  const bom = repo();
  fs.writeFileSync(path.join(bom, '.gitignore'), sanit.ARQUIVO_LOCAL + '\n', 'utf8');
  lerVocabulario(bom, { termos: [TERMO_SINTETICO] });
  assert.strictEqual(sanit.auditar(bom).limpo, true);
  assert.strictEqual(sanit.auditar(repo()).limpo, true);
});

// ── T-1a (lote1 #15): termo local sem `chave` ────────────────────────────

test('T-1a #15: termo local valido sem chave acusa com a classe "(termo N)", nao "undefined"', () => {
  const dir = repo();
  lerVocabulario(dir, { termos: [Object.assign({}, TERMO_SINTETICO, { chave: undefined, nome: undefined })] });
  const lista = sanit.classes(dir);
  assert.strictEqual(lista[lista.length - 1].chave, '(termo 1)');
  const achados = sanit.varrerTexto('x MARCA-INTERNA y', 'a.txt', lista);
  assert.strictEqual(achados.length, 1);
  assert.strictEqual(achados[0].classe, '(termo 1)');
  assert.strictEqual(achados[0].nome, '(termo 1)');
  assert.ok(sanit.autoteste(dir).ok, 'o termo sem chave tem de se provar com isca e controle como os demais');
});

// ── A4-02 (revisao completa, L4): o NOME do autor e publico como o e-mail ──

test('A4-02: varrerAutores varre o nome do autor pelas classes, nao so o e-mail', () => {
  const caminho = 'C:' + '\\Users\\' + 'fulano';
  const achados = sanit.varrerAutores([caminho + ' <1+f' + '@users.noreply.github.com>']);
  assert.deepStrictEqual(achados.map((a) => [a.superficie, a.classe, a.linha]), [[2, 'caminho_de_maquina', 1]]);
  // controle: nome comum com o noreply segue limpo
  assert.strictEqual(sanit.varrerAutores(['Fulano de Tal <1+f' + '@users.noreply.github.com>']).length, 0);
  // o vocabulario local entra pela lista de classes, como na superficie 3
  const dir = repo();
  lerVocabulario(dir, { termos: [TERMO_SINTETICO] });
  const comLocal = sanit.varrerAutores(['MARCA-INTERNA Silva <1+f' + '@users.noreply.github.com>'], sanit.classes(dir));
  assert.deepStrictEqual(comLocal.map((a) => [a.superficie, a.classe]), [[2, 'sintetica']]);
});

test('A4-02: sanitar acusa o nome do autor do vocabulario local, com e-mail noreply', () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, '.gitignore'), sanit.ARQUIVO_LOCAL + '\n', 'utf8');
  lerVocabulario(dir, { termos: [TERMO_SINTETICO] });
  spawnSync('git', ['add', '-A'], { cwd: dir, encoding: 'utf8', shell: false });
  spawnSync('git', ['-c', 'user.name=MARCA-INTERNA da Silva', '-c', 'user.email=1+x' + '@users.noreply.github.com',
    'commit', '-qm', 'segundo'], { cwd: dir, encoding: 'utf8', shell: false });
  const r = sanitar(dir);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(/SUPERFICIE 2 autoria\s+historico\s+-> [1-9]/.test(r.stdout), r.stdout);
  assert.ok(/S2\s+sintetica\s+\(historico do git\):/.test(r.stdout), r.stdout);
});

// ── A4-03 (revisao completa, L4): `docs/` fora e regra do export do sworn, nao de todo projeto ──

test('A4-03: sanitar num projeto qualquer varre docs/ e nao diz que deixou docs/ de fora', () => {
  const dir = repo();
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'docs', 'guia.md'), 'veja C:' + '\\Users\\' + 'jose\\proj\n', 'utf8');
  const r = sanitar(dir);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(/S1\s+caminho_de_maquina\s+docs\/guia\.md:1/.test(r.stdout), r.stdout);
  assert.ok(r.stdout.indexOf('Fora da superficie: docs/') === -1, r.stdout);
  // o export do sworn segue sem docs/ (D132 §1.3): a superficie publicavel e a do exportar.js
  assert.strictEqual(sanit.superficiePublicavel(dir).indexOf('docs/guia.md'), -1);
  assert.ok(sanit.auditar(dir).achados.some((a) => a.arquivo === 'docs/guia.md'));
});
