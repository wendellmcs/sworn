'use strict';
const test = require('node:test');
const assert = require('node:assert');
const glob = require('../scripts/lib/glob.js');

// D420/TS-05: glob.js decide escopo, intocaveis e marchas. As ancoras do regex, a
// normalizacao de './' e a caixa sobreviviam a mutantes porque nao havia teste proprio.

test('glob: ancora no INICIO - o padrao nao casa no meio do caminho', () => {
  assert.strictEqual(glob.casa('src/**', 'src/a.js'), true);
  assert.strictEqual(glob.casa('src/**', 'vendor/src/x.js'), false);
  assert.strictEqual(glob.casa('segredos/**', 'segredos/k.txt'), true);
  assert.strictEqual(glob.casa('segredos/**', 'public/segredos/x'), false);
});

test('glob: ancora no FIM - o padrao nao casa um prefixo do caminho', () => {
  assert.strictEqual(glob.casa('src/a.js', 'src/a.js'), true);
  assert.strictEqual(glob.casa('src/a.js', 'src/a.js.bak'), false);
  assert.strictEqual(glob.casa('*.md', 'nota.md.old'), false);
  assert.strictEqual(glob.casa('src/*', 'src/a/b'), false);
});

test('glob: "**/" aceita zero niveis de diretorio e muitos', () => {
  assert.strictEqual(glob.casa('**/auth/**', 'auth/login.js'), true, 'zero niveis antes');
  assert.strictEqual(glob.casa('**/auth/**', 'src/auth/login.js'), true);
  assert.strictEqual(glob.casa('**/auth/**', 'a/b/c/auth/x/y.js'), true);
  assert.strictEqual(glob.casa('**/*.md', 'README.md'), true, 'zero niveis para um arquivo na raiz');
  assert.strictEqual(glob.casa('**/*.md', 'docs/a/b.md'), true);
  assert.strictEqual(glob.casa('**/auth/**', 'src/author/x.js'), false, 'auth tem de ser um nivel inteiro');
});

test('glob: "*" nao cruza "/" e "**" cruza', () => {
  assert.strictEqual(glob.casa('src/*.js', 'src/a.js'), true);
  assert.strictEqual(glob.casa('src/*.js', 'src/sub/a.js'), false);
  assert.strictEqual(glob.casa('src/**', 'src/sub/fundo/a.js'), true);
  assert.strictEqual(glob.casa('a**b', 'a/x/b'), true);
});

test('glob: caractere especial do regex e literal', () => {
  assert.strictEqual(glob.casa('a.js', 'a.js'), true);
  assert.strictEqual(glob.casa('a.js', 'axjs'), false, '"." nao pode virar "qualquer caractere"');
  assert.strictEqual(glob.casa('a+b(1).js', 'a+b(1).js'), true);
  assert.strictEqual(glob.casa('a?.js', 'ab.js'), false, '"?" e literal, nao curinga');
});

test('glob: "./" da frente e "\\" sao normalizados, no padrao e no caminho', () => {
  assert.strictEqual(glob.casa('./src/a.js', 'src/a.js'), true, './ no padrao');
  assert.strictEqual(glob.casa('src/a.js', './src/a.js'), true, './ no caminho');
  assert.strictEqual(glob.casa('src/**', 'src\\sub\\a.js'), true, 'barra invertida no caminho');
  assert.strictEqual(glob.casa('src\\sub\\*.js', 'src/sub/a.js'), true, 'barra invertida no padrao');
  assert.strictEqual(glob.casa('src/a.js', '/src/a.js'), true, 'barra sobrando no comeco');
  assert.strictEqual(glob.normalizar('./a/b'), 'a/b');
  assert.strictEqual(glob.normalizar('.\\a\\b'), 'a/b');
  assert.strictEqual(glob.normalizar(null), '');
  // so o "./" da FRENTE: um "./" no meio nao e tocado
  assert.strictEqual(glob.normalizar('a/./b'), 'a/./b');
});

test('glob: caixa conforme a opcao explicita (e a plataforma quando omitida)', () => {
  assert.strictEqual(glob.casa('Src/A.js', 'src/a.js', true), true, 'ignorarCaixa=true');
  assert.strictEqual(glob.casa('Src/A.js', 'src/a.js', false), false, 'ignorarCaixa=false');
  assert.strictEqual(glob.casa('src/a.js', 'src/a.js', false), true);
  // omitida: segue a plataforma (win32 ignora caixa)
  assert.strictEqual(glob.casa('Src/A.js', 'src/a.js'), process.platform === 'win32');
  assert.strictEqual(glob.casaAlgum(['x/**', 'Src/**'], 'src/a.js', true), true);
  assert.strictEqual(glob.casaAlgum(['x/**', 'Src/**'], 'src/a.js', false), false);
});

test('glob: padrao vazio ou lista que nao e lista nao casa nada', () => {
  assert.strictEqual(glob.casa('', 'a'), false);
  assert.strictEqual(glob.casa(null, 'a'), false);
  assert.strictEqual(glob.casaAlgum(undefined, 'a'), false);
  assert.strictEqual(glob.casaAlgum('src/**', 'src/a'), false);
  assert.strictEqual(glob.casaAlgum([], 'a'), false);
  assert.strictEqual(glob.casaAlgum(['x', 'src/**'], 'src/a'), true);
});

// A2-27 (pedido 12): o aparo valia tambem no caminho, e 'a ' casava o 'a' declarado. Sao arquivos distintos: o Node
// grava 'a ' e 'a.' com o nome inteiro tambem no Windows (sonda s204). O padrao, escrito a mao, segue aparado.
test('A2-27: o padrao e aparado e o caminho nao', () => {
  assert.strictEqual(glob.casa('a', 'a '), false, 'caminho com espaco no fim e outro arquivo');
  assert.strictEqual(glob.casa('src/a.js', ' src/a.js'), false, 'caminho com espaco na frente e outro arquivo');
  assert.strictEqual(glob.casa(' src/a.js ', 'src/a.js'), true, 'espaco na ponta do padrao');
  assert.strictEqual(glob.casa(' ./src/a.js', 'src/a.js'), true, 'o aparo vem antes de tirar o ./ da frente');
  assert.strictEqual(glob.normalizar(' a '), ' a ', 'normalizar nao apara o caminho');
});

// Glob sem backtracking (dono, 2026-11-10): o padrao virava regex com `(?:.*/)?` e `[^/]*` sem teto, e um padrao
// patologico do escopo.md, do projeto.json ou do design.json travava o portao a cada Write/Edit (passou de 120 s).
// A conta roda num processo filho com prazo: o defeito volta como prazo estourado, sem travar a suite. O prazo do
// filho (10 s, com folga para a maquina carregada) e a unica medida de tempo: um teto em milissegundos oscilaria.
test('glob: o padrao patologico casa em tempo linear, sem travar o portao', () => {
  const { spawnSync } = require('node:child_process');
  const codigo = 'const g = require(' + JSON.stringify(require.resolve('../scripts/lib/glob.js')) + ');' +
    'const caminho = "a/".repeat(20) + "a".repeat(40) + ".css";' +
    // Um caminho de milhares de caracteres: o custo cresce com o caminho, nunca com potencia dele.
    'const longo = "a/".repeat(3000) + "a".repeat(3000) + ".css";' +
    'const r = [g.casa("**/**/**/**/**/**/**/**/a*a*a*a*a*a*b", caminho), g.casa("**/**/**/**/**/**/**/**/a*a*a*a*a*a*.css", caminho),' +
    ' g.casa("**/**/**/**/a*a*a*a*b", longo), g.casa("**/**/**/**/a*a*a*a*.css", longo)];' +
    'process.stdout.write(JSON.stringify(r));';
  const filho = spawnSync(process.execPath, ['-e', codigo], { encoding: 'utf8', timeout: 10000 });
  if (filho.error && filho.error.code === 'ETIMEDOUT') {
    assert.fail('o casamento passou do prazo de 10 s: o glob.js voltou a ter backtracking (veja casa e fecho)');
  }
  assert.strictEqual(filho.status, 0, 'o processo filho do teste caiu antes de casar: ' + (filho.error ? filho.error.message : filho.stderr));
  assert.deepStrictEqual(JSON.parse(filho.stdout), [false, true, false, true], 'o "b" nao existe nos caminhos; o ".css" existe');
});

// O oraculo: o casa que virava regex (copia fiel do glob.js ate o commit e2199a8). Fica so no teste, para
// o glob.js ter um motor so; o automato tem de dar o mesmo resultado dele em todo o corpo, e nunca travar.
const ESPECIAIS_DE_ANTES = new Set(['.', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']);
function casaPelaRegex(padrao, caminho, ignorarCaixa) {
  if (!padrao) return false;
  const p = glob.normalizar(String(padrao == null ? '' : padrao).trim());
  let re = '';
  let i = 0;
  while (i < p.length) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      if (p[i + 2] === '/') { re += '(?:.*/)?'; i += 3; } else { re += '.*'; i += 2; }
    } else if (c === '*') {
      re += '[^/]*'; i += 1;
    } else if (ESPECIAIS_DE_ANTES.has(c)) {
      re += '\\' + c; i += 1;
    } else {
      re += c; i += 1;
    }
  }
  const semCaixa = ignorarCaixa === undefined ? process.platform === 'win32' : Boolean(ignorarCaixa);
  return new RegExp('^' + re + '$', semCaixa ? 'i' : '').test(glob.normalizar(caminho));
}

test('glob: o casamento sem regex da o mesmo resultado que a regex de antes, num corpo de padroes e caminhos', () => {
  const padroes = ['src/**', '**/auth/**', '**/*.md', '*.md', 'src/*', 'src/*.js', 'a**b', '**', '*', '**/*', './**',
    'src/a.js', 'a.b+c', 'x(1).js', '[a].js', 'docs/**/x.md', '**/**/a', 'a/**/b/**/c', 'a*b*c', '*.{css,scss}',
    'src/checkout/**', '**/checkout/*.css', '../**', 'a/', '/abs/**', 'A/B', 'segredos/**',
    // O `**/` no meio com quebra de linha, e letras que a flag `i` nao iguala (Kelvin, s longo,
    // as ligaduras \uFB05 e \uFB06, que viram as duas "ST").
    'a/**/b', 'k.txt', 'segredos/k.txt', 'a.kss', 'strasse.md', 'STRASSE.md', '\u00E9.md', '\uFB05.md', '\u1F80.md'];
  const caminhos = ['src/a.js', 'src/sub/a.js', 'auth/login.js', 'src/auth/x.js', 'src/author/x.js', 'README.md',
    'docs/a/b.md', 'docs/x.md', 'docs/q/w/x.md', 'a/x/b', 'ab', 'a/b/c', 'a/q/b/w/c', 'axbxc', 'a.b+c', 'x(1).js',
    '[a].js', 'a.css', 'a.{css,scss}', 'src/checkout/pagar.css', 'x/checkout/a.css', '', 'a', 'a/b', 'A/B', 'a/B',
    'segredos/k.txt', 'nota.md.old', '../x', 'abs/q', 'src\\win\\a.js',
    // O `**/` so sai depois de uma barra: `xauth/a` nao e `auth/a` em pasta nenhuma.
    'xauth/a', 'src/xauth/login.js', 'xdocs/x.md', 'a/qb', 'a/q/xb/c', 'qa/b',
    // A barra logo na entrada do `**/` (pasta de nome vazio) tambem fecha um nivel, como na regex.
    'a//b', 'docs//x.md', 'a//b//c', 'src//a.js',
    // Quebra de linha: o `.` da regex nao a le e o `[^/]` le; o casamento faz igual.
    'a\nb', 'a\rb', 'a\u2028b', 'src/x\ny.js', 'docs/a\n/b.md', 'a/\n/b', 'x\n.md',
    // Sem caixa, a comparacao e a da flag `i` da regex: o sinal de Kelvin e o s longo nao viram
    // "k" e "s", e o "ss" alemao nao vira "SS".
    'segredos/\u212A.txt', '\u017Fegredos/k.txt', 'a.\u212Ass', 'stra\u00DFe.md', 'STRASSE.md', '\u00E9.md', '\u00C9.MD', 'k.txt', '\u212A.txt', '\uFB06.md', '\uFB05.md',
    // Maiuscula de dois caracteres: \u1F80 e \u1F88 tem a mesma maiuscula de dois caracteres, e a flag `i` nao os iguala.
    '\u1F88.md', '\u1F80.md',
    // Caminho nulo ou ausente vira vazio; o "5" casa o padrao numero 5; o emoji (par substituto) e lido em duas
    // unidades, como a regex sem a flag `u` le.
    '5', String.fromCharCode(0x61, 0xD83D, 0xDE00) + '.md', String.fromCharCode(0xD83D, 0xDE00),
    null, undefined];
  // Padrao vazio, so de espaco, nulo ou numero: a guarda e o aparo do casa os tratam como antes.
  padroes.push('a*.md', '?.md');
  padroes.push('', '  ', null, undefined, 0, 5);
  for (const p of padroes) {
    for (const c of caminhos) {
      for (const caixa of [true, false, undefined, null]) {
        const esperado = casaPelaRegex(p, c, caixa);
        assert.strictEqual(glob.casa(p, c, caixa), esperado, JSON.stringify({ padrao: p, caminho: c, ignorarCaixa: caixa }));
      }
    }
  }
});

// A2-25: so o omitido segue a plataforma; null e false deixam a caixa sensivel.
test('A2-25: ignorarCaixa null ou false deixa a caixa sensivel', () => {
  assert.strictEqual(glob.casa('Src/A.js', 'src/a.js', null), false);
  assert.strictEqual(glob.casa('Src/A.js', 'src/a.js', 0), false);
  assert.strictEqual(glob.casa('Src/A.js', 'src/a.js', 1), true);
});
