'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const varredura = require('../scripts/lib/varredura.js');

const BOM = String.fromCharCode(65279);

function montar(arquivos) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-varre-'));
  for (const [rel, conteudo] of Object.entries(arquivos)) {
    const alvo = path.join(dir, rel);
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, conteudo, 'utf8');
  }
  return dir;
}

// Oraculo independente do modulo: o teste calcula sozinho se ha .git acima, em vez
// de supor que a pasta temporaria esta fora de repositorio. Sem isto, `temGit` fixo
// em true ou em false passaria dependendo da maquina de quem roda.
function achaGitAcima(inicio) {
  let dir = path.resolve(inicio);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return true;
    const acima = path.dirname(dir);
    if (acima === dir) return false;
    dir = acima;
  }
}

test('varredura: ignora node_modules, .git e dist', () => {
  const dir = montar({
    'a.js': '1',
    'node_modules/pacote/index.js': '1',
    'dist/bundle.js': '1',
    '.git/config': '1'
  });
  try {
    const r = varredura.listar(dir);
    assert.ok(r.arquivos.includes('a.js'));
    assert.ok(!r.arquivos.some((f) => f.startsWith('node_modules/')));
    assert.ok(!r.arquivos.some((f) => f.startsWith('dist/')));
    assert.ok(!r.arquivos.some((f) => f.startsWith('.git/')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('varredura: respeita o teto e marca truncado', () => {
  const arquivos = {};
  for (let i = 0; i < 30; i++) arquivos['f' + i + '.txt'] = 'x';
  const dir = montar(arquivos);
  try {
    const r = varredura.listar(dir, 10);
    assert.strictEqual(r.arquivos.length, 10);
    assert.strictEqual(r.truncado, true);
    assert.strictEqual(r.limite, 10);
    assert.strictEqual(r.incompleta, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('varredura: teto zero e respeitado, nao vira o padrao', () => {
  const dir = montar({ 'a.js': '1', 'b.js': '1' });
  try {
    const r = varredura.listar(dir, 0);
    assert.strictEqual(r.limite, 0, 'zero e um teto declarado, nao ausencia de teto');
    assert.deepStrictEqual(r.arquivos, []);
    assert.strictEqual(r.truncado, true);
    assert.strictEqual(r.incompleta, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('varredura: sem limite, o teto e o LIMITE_PADRAO declarado', () => {
  const dir = montar({ 'a.js': '1' });
  try {
    assert.strictEqual(varredura.listar(dir).limite, varredura.LIMITE_PADRAO);
    assert.strictEqual(varredura.LIMITE_PADRAO, 4000);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('varredura: profundidade corta ramo e a lista CONFESSA o corte', () => {
  let fundo = 'n1';
  for (let n = 2; n <= 12; n++) fundo += '/n' + n;
  const arquivos = { 'a.js': '1' };
  arquivos[fundo + '/fundo.js'] = '1';
  const dir = montar(arquivos);
  try {
    assert.strictEqual(varredura.PROFUNDIDADE, 8);
    const r = varredura.listar(dir);
    assert.ok(r.arquivos.includes('a.js'));
    assert.ok(!r.arquivos.some((f) => f.endsWith('fundo.js')), 'a fixture so vale se o fundo ficou fora');
    assert.strictEqual(r.truncado, false, 'nao foi o teto que cortou');
    assert.strictEqual(r.profundidadeCortada, true);
    assert.strictEqual(r.incompleta, true, 'corte mudo e o defeito que a D98 fechou');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('varredura: diretorio ilegivel entra em ilegiveis e a lista confessa', () => {
  const inexistente = path.join(os.tmpdir(), 'sworn-nao-existe-' + process.pid);
  assert.strictEqual(fs.existsSync(inexistente), false, 'a fixture so vale se o caminho nao existir');
  const r = varredura.listar(inexistente);
  assert.deepStrictEqual(r.arquivos, []);
  assert.deepStrictEqual(r.ilegiveis, ['.']);
  assert.strictEqual(r.incompleta, true);
});

test('varredura: pasta ignorada e corte DECLARADO, nao lista incompleta', () => {
  const dir = montar({ 'a.js': '1', 'node_modules/x/i.js': '1' });
  try {
    const r = varredura.listar(dir);
    assert.deepStrictEqual(r.arquivos, ['a.js']);
    assert.strictEqual(r.ignoradas, 1);
    assert.strictEqual(r.incompleta, false, 'IGNORAR e anunciado ao dono; nao e cegueira');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('varredura: inferir diz "nao sei" quando nao recebe o sinal da varredura', () => {
  const dir = montar({ 'a.js': '1' });
  try {
    const r = varredura.listar(dir);
    assert.strictEqual(varredura.inferir(r.arquivos, dir).listaIncompleta, null);
    const comSinal = varredura.inferir(r.arquivos, dir, r);
    assert.strictEqual(comSinal.listaIncompleta, false);
    assert.deepStrictEqual(comSinal.motivosIncompleta, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('varredura: teto baixo nao esconde o marcador de linguagem', () => {
  const arquivos = { 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }) };
  for (let i = 0; i < 20; i++) arquivos['assets/f' + i + '.bin'] = 'x';
  const dir = montar(arquivos);
  try {
    const r = varredura.listar(dir, 5);
    assert.strictEqual(r.truncado, true);
    assert.ok(!r.arquivos.includes('package.json'), 'a fixture so vale se o package.json ficou fora da lista');
    const i = varredura.inferir(r.arquivos, dir, r);
    assert.strictEqual(i.linguagem, 'node', 'o marcador se confere no disco, nao na lista cortada');
    assert.strictEqual(i.provaDePronto, 'npm test');
    assert.strictEqual(i.listaIncompleta, true);
    assert.ok(i.motivosIncompleta.length > 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('varredura: infere node + npm + script de teste', () => {
  const dir = montar({
    'package.json': JSON.stringify({ scripts: { test: 'node --test' } }),
    'package-lock.json': '{}',
    'src/a.js': '1'
  });
  try {
    const i = varredura.inferir(varredura.listar(dir).arquivos, dir);
    assert.strictEqual(i.linguagem, 'node');
    assert.strictEqual(i.gerenciador, 'npm');
    assert.strictEqual(i.provaDePronto, 'npm test');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('varredura: infere python e pytest', () => {
  const dir = montar({ 'pyproject.toml': '', 'tests/test_a.py': '' });
  try {
    const i = varredura.inferir(varredura.listar(dir).arquivos, dir);
    assert.strictEqual(i.linguagem, 'python');
    assert.strictEqual(i.provaDePronto, 'pytest');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('varredura: nao inventa prova de pronto quando nao ha', () => {
  const dir = montar({ 'leiame.txt': 'nada' });
  try {
    const i = varredura.inferir(varredura.listar(dir).arquivos, dir);
    assert.strictEqual(i.provaDePronto, null, 'sem sinal, e null e a entrevista pergunta');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('varredura: acha candidatos a fonte canonica', () => {
  const dir = montar({ 'CLAUDE.md': '', 'AGENTS.md': '', 'README.md': '', 'src/a.js': '' });
  try {
    const i = varredura.inferir(varredura.listar(dir).arquivos, dir);
    assert.ok(i.candidatosCanonicos.includes('CLAUDE.md'));
    assert.ok(i.candidatosCanonicos.includes('AGENTS.md'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('varredura: detecta indicio de design system', () => {
  const semDS = montar({ 'a.js': '' });
  const comDS = montar({ 'DESIGN.md': '', 'src/tokens.css': '' });
  try {
    assert.strictEqual(varredura.inferir(varredura.listar(semDS).arquivos, semDS).temDesignSystem, false);
    assert.strictEqual(varredura.inferir(varredura.listar(comDS).arquivos, comDS).temDesignSystem, true);
  } finally {
    fs.rmSync(semDS, { recursive: true, force: true });
    fs.rmSync(comDS, { recursive: true, force: true });
  }
});

test('varredura: plataforma sai do processo, nao de palpite', () => {
  const dir = montar({ 'a.js': '' });
  try {
    const i = varredura.inferir(varredura.listar(dir).arquivos, dir);
    assert.strictEqual(i.plataforma.so, process.platform);
    // Valor exato, nao pertinencia a um conjunto: `['powershell','bash'].includes(...)`
    // aceitava 'bash' fixo rodando no Windows.
    assert.strictEqual(i.plataforma.shell, process.platform === 'win32' ? 'powershell' : 'bash');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('varredura: BOM no package.json nao cega a prova de pronto', () => {
  const corpo = JSON.stringify({ scripts: { test: 'node --test' } });
  const dir = montar({ 'package.json': BOM + corpo, 'package-lock.json': '{}' });
  try {
    const bytes = fs.readFileSync(path.join(dir, 'package.json'));
    assert.strictEqual(bytes[0], 0xef, 'a fixture so vale se o BOM estiver mesmo la');
    const i = varredura.inferir(varredura.listar(dir).arquivos, dir);
    assert.strictEqual(i.provaDePronto, 'npm test');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('varredura: recusa o script de mentira do npm init -y', () => {
  const dir = montar({
    'package.json': JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } })
  });
  try {
    const i = varredura.inferir(varredura.listar(dir).arquivos, dir);
    assert.strictEqual(i.provaDePronto, null, 'comando que sempre sai 1 nao prova nada');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('varredura: acha o canonico com caixa diferente e devolve o nome do disco', () => {
  const dir = montar({ 'Claude.md': '', 'Readme.md': '', 'a.js': '1' });
  try {
    const i = varredura.inferir(varredura.listar(dir).arquivos, dir);
    assert.ok(i.candidatosCanonicos.includes('Claude.md'), JSON.stringify(i.candidatosCanonicos));
    assert.ok(i.candidatosCanonicos.includes('Readme.md'));
    assert.ok(!i.candidatosCanonicos.includes('CLAUDE.md'), 'devolve o nome como esta no disco');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('varredura: canonico ausente nao entra na lista', () => {
  const dir = montar({ 'CLAUDE.md': '', 'a.js': '1' });
  try {
    const i = varredura.inferir(varredura.listar(dir).arquivos, dir);
    assert.deepStrictEqual(i.candidatosCanonicos, ['CLAUDE.md']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('varredura: temGit acha o .git de uma pasta acima do cwd', () => {
  const dir = montar({ 'sub/a.js': '1' });
  try {
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    const sub = path.join(dir, 'sub');
    const i = varredura.inferir(varredura.listar(sub).arquivos, sub);
    assert.strictEqual(i.temGit, true, 'rodar numa subpasta nao tira o projeto do git');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('varredura: temGit nao depende de sobrar arquivo depois do IGNORAR', () => {
  const dir = montar({ 'dist/bundle.js': '1', 'node_modules/x/i.js': '1' });
  try {
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    const r = varredura.listar(dir);
    assert.deepStrictEqual(r.arquivos, [], 'a fixture so vale se a lista sair vazia');
    assert.strictEqual(varredura.inferir(r.arquivos, dir, r).temGit, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('varredura: modificados preserva a distincao null x lista vazia (D49)', () => {
  const dir = montar({ 'a.js': '1' });
  try {
    const dentroDeRepo = achaGitAcima(dir);
    const i = varredura.inferir(varredura.listar(dir).arquivos, dir);
    assert.strictEqual(i.temGit, dentroDeRepo);
    assert.strictEqual(
      i.modificados === null, !dentroDeRepo,
      'fora de repo git `modificados` e null, nunca []; dentro, e lista'
    );
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('varredura: package.json vence pyproject.toml na ordem da linguagem', () => {
  const dir = montar({ 'package.json': '{}', 'pyproject.toml': '' });
  try {
    assert.strictEqual(varredura.inferir(varredura.listar(dir).arquivos, dir).linguagem, 'node');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('varredura: pnpm-lock vence package-lock na ordem do gerenciador', () => {
  const dir = montar({ 'package.json': '{}', 'pnpm-lock.yaml': '', 'package-lock.json': '{}' });
  try {
    assert.strictEqual(varredura.inferir(varredura.listar(dir).arquivos, dir).gerenciador, 'pnpm');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('varredura: reconhece as linguagens secundarias e a prova de cada uma', () => {
  const casos = [
    ['go.mod', 'go', 'go test ./...'],
    ['Cargo.toml', 'rust', 'cargo test'],
    ['pom.xml', 'jvm', 'mvn test'],
    ['Gemfile', 'ruby', null],
    ['composer.json', 'php', null]
  ];
  for (const [arquivo, linguagem, prova] of casos) {
    const dir = montar({ [arquivo]: '' });
    try {
      const i = varredura.inferir(varredura.listar(dir).arquivos, dir);
      assert.strictEqual(i.linguagem, linguagem, arquivo);
      assert.strictEqual(i.provaDePronto, prova, arquivo);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('varredura: reconhece os gerenciadores secundarios', () => {
  const casos = [['yarn.lock', 'yarn'], ['bun.lockb', 'bun'], ['poetry.lock', 'poetry'], ['uv.lock', 'uv']];
  for (const [arquivo, gerenciador] of casos) {
    const dir = montar({ [arquivo]: '' });
    try {
      assert.strictEqual(varredura.inferir(varredura.listar(dir).arquivos, dir).gerenciador, gerenciador, arquivo);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('varredura: design system NAO dispara com sinal fraco', () => {
  const fracos = [
    'src/auth/token.js',
    'docs/por-que-nao-adotamos-design-system.md',
    'test/cand-fix22-V2-token.js'
  ];
  for (const rel of fracos) {
    const dir = montar({ [rel]: '' });
    try {
      assert.strictEqual(varredura.inferir(varredura.listar(dir).arquivos, dir).temDesignSystem, false, rel);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('varredura: design system dispara com sinal de verdade', () => {
  const fortes = [
    'DESIGN.md', 'src/tokens.css', 'src/design-tokens.json',
    'src/design-system/Botao.tsx', 'src/theme.ts', 'styles/variables.scss', 'design-system.css'
  ];
  for (const rel of fortes) {
    const dir = montar({ [rel]: '' });
    try {
      assert.strictEqual(varredura.inferir(varredura.listar(dir).arquivos, dir).temDesignSystem, true, rel);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('varrer.js: a CLI nao mente na observacao e estima o que imprime', () => {
  const dir = montar({
    'package.json': JSON.stringify({ scripts: { test: 'node --test' } }),
    '.claude/settings.json': '{}',
    '.mcp.json': '{}'
  });
  try {
    const cli = path.join(__dirname, '..', 'scripts', 'varrer.js');
    // R3: spawnSync com shell:false, tambem no teste.
    const r = spawnSync(process.execPath, [cli, dir], { encoding: 'utf8', shell: false });
    assert.strictEqual(r.status, 0, r.stderr);
    const saida = JSON.parse(r.stdout);
    assert.ok(
      !/nenhum conteudo de arquivo/i.test(saida.teto.observacao),
      'a observacao nao pode negar uma leitura que houve'
    );
    assert.ok(/package\.json/.test(saida.teto.observacao), 'a observacao nomeia o package.json lido');
    // D423 (DC-04): o package.json NAO e o unico conteudo lido; ambiente.js e instrucoes.js tambem leem.
    assert.ok(!/unico conteudo/i.test(saida.teto.observacao), 'nao pode dizer que o package.json e o unico: ' + saida.teto.observacao);
    assert.ok(/settings/.test(saida.teto.observacao) && /\.mcp\.json/.test(saida.teto.observacao), 'nomeia as leituras do ambiente: ' + saida.teto.observacao);
    assert.ok(/instru/.test(saida.teto.observacao) && /contar linhas/.test(saida.teto.observacao), 'nomeia a leitura das instrucoes: ' + saida.teto.observacao);
    const tokensReais = Math.ceil(r.stdout.length / 4);
    const desvio = Math.abs(saida.teto.tokensEstimados - tokensReais) / tokensReais;
    assert.ok(desvio < 0.05, 'estimado ' + saida.teto.tokensEstimados + ' x real ' + tokensReais);
    assert.strictEqual(saida.teto.incompleta, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- D98, rodada 2: os quatro defeitos que o PROPRIO conserto introduziu ---

test('varredura: limite invalido cai no padrao, nunca em teto nenhum', () => {
  const dir = montar({ 'a.js': '1', 'b.js': '1' });
  try {
    // NaN era o pior: `arquivos.length >= NaN` e sempre falso, entao a varredura
    // perdia o teto inteiro E devolvia `truncado: false`. Medido antes do conserto:
    // 8610 arquivos, `incompleta: false`.
    for (const ruim of [NaN, false, true, -1, 3.5, '10', {}, [], undefined, null]) {
      const r = varredura.listar(dir, ruim);
      assert.strictEqual(r.limite, varredura.LIMITE_PADRAO, 'limite ' + String(ruim));
      assert.strictEqual(typeof r.limite, 'number');
    }
    assert.strictEqual(varredura.listar(dir, 0).limite, 0, 'zero continua sendo teto declarado');
    assert.strictEqual(varredura.listar(dir, 1).limite, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('varredura: inferir com cwd invalido devolve objeto, nao estoura', () => {
  for (const ruim of [null, undefined, 123, {}, '']) {
    const i = varredura.inferir([], ruim);
    assert.strictEqual(typeof i, 'object', String(ruim));
    assert.strictEqual(i.temGit, false, String(ruim));
    assert.strictEqual(i.modificados, null, String(ruim));
    assert.deepStrictEqual(i.candidatosCanonicos, [], String(ruim));
    assert.strictEqual(i.linguagem, null, String(ruim));
  }
});

test('varredura: canonico so no disco, e com outra caixa, ainda e achado', () => {
  // So passa se `candidatosCanonicos` ler o DISCO **e** dobrar a caixa. Prende as duas
  // metades de uma vez: cada uma sozinha era redundante com a outra e nao morria.
  //
  // A lista vai VAZIA de proposito. A primeira versao deste teste truncava a varredura
  // para deixar o canonico de fora, e com isso dependia da ordem do `readdirSync` - que
  // o codigo nunca ordena, e que no NTFS calha de por `Claude.md` no fim mas no ext4
  // nao. Lista vazia prova a mesma coisa sem depender de plataforma nenhuma.
  const dir = montar({ 'Claude.md': '', 'a.js': '1' });
  try {
    const i = varredura.inferir([], dir);
    assert.deepStrictEqual(i.candidatosCanonicos, ['Claude.md']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('varredura: partial de Sass e formato DTCG contam como design system', () => {
  for (const rel of ['styles/_tokens.scss', 'src/design.tokens.json']) {
    const dir = montar({ [rel]: '' });
    try {
      assert.strictEqual(varredura.inferir(varredura.listar(dir).arquivos, dir).temDesignSystem, true, rel);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('varrer.js: sem package.json a CLI nao diz que leu package.json', () => {
  const dir = montar({ 'a.js': '1' });
  try {
    const cli = path.join(__dirname, '..', 'scripts', 'varrer.js');
    const r = spawnSync(process.execPath, [cli, dir], { encoding: 'utf8', shell: false });
    assert.strictEqual(r.status, 0, r.stderr);
    const obs = JSON.parse(r.stdout).teto.observacao;
    assert.ok(!/package\.json/.test(obs), 'nao pode nomear um arquivo que nao existe: ' + obs);
    // D423 (DC-04): sem package.json ainda ha leitura (instrucoes); a frase nao pode negar.
    assert.ok(!/nenhum conteudo de arquivo/i.test(obs), 'nao pode negar a leitura das instrucoes: ' + obs);
    assert.ok(/contar linhas/.test(obs), obs);
    // S8 L3-var-1: settings e .mcp.json NAO existem aqui, entao a frase nao os nomeia (nada de "se existirem")
    assert.ok(!/settings|\.mcp\.json|se existirem/.test(obs), 'nomeou leitura que nao houve: ' + obs);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// S8 L3-var-1 (D426): a frase lista o que a CLI leu DE FATO, arquivo a arquivo (inclusive o projeto.json,
// que `carregarProjeto` abre), em vez de "(se existirem)" sem conferir.
test('varrer.js: a observacao nomeia so as leituras que houve, projeto.json incluido', () => {
  const todos = montar({
    'package.json': JSON.stringify({ scripts: { test: 'node --test' } }),
    '.claude/settings.json': '{}', '.claude/settings.local.json': '{}', '.mcp.json': '{}',
    '.claude/sworn/projeto.json': JSON.stringify({ fontesCanonicas: [] })
  });
  const so = montar({ '.mcp.json': '{}', 'a.js': '1' });
  const ilegivel = montar({ '.claude/sworn/projeto.json': '{isso nao fecha' });
  try {
    const t = rodarVarrer(todos).teto.observacao;
    for (const nome of ['package.json', 'projeto.json', 'settings.json', 'settings.local.json', '.mcp.json', 'contar linhas']) {
      assert.ok(t.includes(nome), nome + ' faltou: ' + t);
    }
    assert.ok(!/se existirem/.test(t), t);
    const u = rodarVarrer(so).teto.observacao;
    assert.ok(u.includes('.mcp.json'), u);
    assert.ok(!/settings|projeto\.json|package\.json/.test(u), 'nomeou leitura que nao houve: ' + u);
    // projeto.json que existe mas nao se le: nao houve leitura util, a frase nao o nomeia
    assert.ok(!/projeto\.json/.test(rodarVarrer(ilegivel).teto.observacao));
  } finally {
    for (const d of [todos, so, ilegivel]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('varrer.js: package.json que e DIRETORIO nao vira "li o package.json"', () => {
  // Existir nao e ter sido lido. `existsSync` diz true para o diretorio, o `readFileSync`
  // falha com EISDIR, e a frase afirmava leitura que nao houve.
  const dir = montar({ 'a.js': '1' });
  try {
    fs.mkdirSync(path.join(dir, 'package.json'), { recursive: true });
    const cli = path.join(__dirname, '..', 'scripts', 'varrer.js');
    const r = spawnSync(process.execPath, [cli, dir], { encoding: 'utf8', shell: false });
    assert.strictEqual(r.status, 0, r.stderr);
    const saida = JSON.parse(r.stdout);
    assert.ok(!/package\.json/.test(saida.teto.observacao),
      'existir nao e ter sido lido: ' + saida.teto.observacao);
    assert.strictEqual(saida.inferido.provaDePronto, null, 'nada foi lido, entao nao ha prova');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// T11-3 (R-T24-02): no init o projeto.json ainda nao existe. O peso de instrucao tem de
// contar os candidatos que a varredura achou, e dizer que sao candidatos; com projeto.json
// declarado, o que o dono declarou manda.
function rodarVarrer(dir) {
  const cli = path.join(__dirname, '..', 'scripts', 'varrer.js');
  const r = spawnSync(process.execPath, [cli, dir], { encoding: 'utf8', shell: false });
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('varrer.js: sem projeto.json, o CLAUDE.md da raiz entra no peso e vem marcado como candidato', () => {
  const dir = montar({ 'CLAUDE.md': '- regra um\n- regra dois\n- regra tres\n' });
  try {
    const saida = rodarVarrer(dir);
    assert.strictEqual(saida.instrucoes.fontes, 'candidatas');
    assert.strictEqual(saida.instrucoes.total, 3);
    assert.deepStrictEqual(saida.instrucoes.porArquivo.map((p) => p.arquivo), ['CLAUDE.md']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('varrer.js: projeto.json com fontesCanonicas vazio nao deixa o CLAUDE.md entrar', () => {
  const dir = montar({
    'CLAUDE.md': '- regra um\n- regra dois\n',
    '.claude/sworn/projeto.json': JSON.stringify({ fontesCanonicas: [] })
  });
  try {
    const saida = rodarVarrer(dir);
    assert.strictEqual(saida.instrucoes.fontes, 'declaradas');
    assert.strictEqual(saida.instrucoes.total, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('varrer.js: projeto.json que declara outro arquivo conta so o declarado', () => {
  const dir = montar({
    'CLAUDE.md': '- a\n- b\n- c\n',
    'AGENTS.md': '- d\n',
    '.claude/sworn/projeto.json': JSON.stringify({ fontesCanonicas: ['AGENTS.md'] })
  });
  try {
    const saida = rodarVarrer(dir);
    assert.strictEqual(saida.instrucoes.fontes, 'declaradas');
    assert.strictEqual(saida.instrucoes.total, 1);
    assert.deepStrictEqual(saida.instrucoes.porArquivo.map((p) => p.arquivo), ['AGENTS.md']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
