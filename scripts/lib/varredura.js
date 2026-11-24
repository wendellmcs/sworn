'use strict';
const fs = require('node:fs');
const path = require('node:path');
const git = require('./git.js');
const jsonio = require('./jsonio.js');

const IGNORAR = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'coverage', 'vendor',
  '.next', '.nuxt', '.venv', 'venv', '__pycache__', 'target', '.gradle',
  '.idea', '.vscode', 'tmp', 'temp'
]);

const LIMITE_PADRAO = 4000;
const PROFUNDIDADE = 8;

/**
 * Anda a arvore com teto duro. Teto e profundidade sao declarados, nunca implicitos.
 *
 * D98: a lista pode sair INCOMPLETA por quatro motivos, e tres deles eram MUDOS.
 * Agora os quatro sao contados e confessados: teto (`truncado`), profundidade
 * (`profundidadeCortada`), diretorio que nao abriu (`ilegiveis`) e as pastas de
 * IGNORAR (`ignoradas`). So os tres primeiros entram em `incompleta` - IGNORAR e
 * corte ANUNCIADO ao dono no passo 1 da entrevista, e se entrasse aqui `incompleta`
 * seria true em todo repositorio real, o que destruiria o sinal.
 */
function listar(cwd, limite) {
  // A4-27: sem pasta em texto o readdirSync lancava e a raiz saia em ilegiveis, como se fosse permissao
  if (typeof cwd !== 'string' || cwd === '') {
    throw new TypeError('varredura.listar: a pasta tem de ser um caminho em texto (veio ' +
      (cwd === '' ? 'texto vazio' : cwd === null ? 'null' : typeof cwd) + ')');
  }
  // D98: `limite || LIMITE_PADRAO` engolia o zero e devolvia 4000 calado.
  // D98 rodada 2: e o teste de `undefined || null` deixava passar `NaN`, `false` e
  // negativo. Com `NaN`, `arquivos.length >= teto` e sempre falso: a varredura perdia
  // o teto INTEIRO e ainda devolvia `truncado: false` (medido: 8610 arquivos, zero
  // confissao). Era a mentira que esta tarefa existe para nao contar, criada pelo
  // proprio conserto. Inteiro nao-negativo, ou o padrao declarado.
  const teto = (typeof limite === 'number' && Number.isInteger(limite) && limite >= 0)
    ? limite : LIMITE_PADRAO;
  const arquivos = [];
  const ilegiveis = [];
  let truncado = false;
  let profundidadeCortada = false;
  let ignoradas = 0;

  function andar(dir, rel, nivel) {
    if (truncado) return;
    if (nivel > PROFUNDIDADE) { profundidadeCortada = true; return; }
    let entradas;
    try { entradas = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { ilegiveis.push(rel || '.'); return; }
    for (const entrada of entradas) {
      if (truncado) return;
      const nome = entrada.name;
      if (IGNORAR.has(nome)) { if (entrada.isDirectory()) ignoradas++; continue; }
      const proximoRel = rel ? rel + '/' + nome : nome;
      if (entrada.isDirectory()) {
        andar(path.join(dir, nome), proximoRel, nivel + 1);
      } else if (entrada.isFile()) {
        if (arquivos.length >= teto) { truncado = true; return; }
        arquivos.push(proximoRel);
      }
    }
  }

  andar(cwd, '', 0);
  return {
    arquivos: arquivos,
    truncado: truncado,
    limite: teto,
    profundidadeCortada: profundidadeCortada,
    ilegiveis: ilegiveis,
    ignoradas: ignoradas,
    incompleta: truncado || profundidadeCortada || ilegiveis.length > 0
  };
}

// D98: passa pelo semBom da D96. Um BOM de UTF-8 no package.json fazia o JSON.parse
// estourar e a prova de pronto sumir calada - a mesma familia do D-A, num quinto leitor. F5a: pelo lib/jsonio.js.
function lerPacote(cwd) {
  // cwd vazio nao le o package.json da pasta do processo (path.join('', ...) e relativo), como indiceDoTopo e acharGit.
  return typeof cwd === 'string' && cwd ? jsonio.ler(path.join(cwd, 'package.json')).valor : null;
}

/**
 * Indice do primeiro nivel do cwd, em caixa baixa. Serve ao `tem()` e resolve duas
 * coisas de uma vez (D98 rodada 2): nao depender da lista varrida, que o teto pode ter
 * cortado, e nao depender da caixa do sistema de arquivos - `existsSync` acha `Gemfile`
 * por `gemfile` no Windows e nao no Linux, e marcador de projeto nao pode mudar de
 * resposta por plataforma. Uma leitura de diretorio no lugar de dezenove `existsSync`.
 */
function indiceDoTopo(cwd) {
  const nomes = new Set();
  if (typeof cwd !== 'string' || cwd === '') return nomes;
  let entradas = [];
  try { entradas = fs.readdirSync(cwd, { withFileTypes: true }); } catch (e) { return nomes; }
  for (const entrada of entradas) nomes.add(entrada.name.toLowerCase());
  return nomes;
}

/** Sobe do cwd ate a raiz procurando `.git`. Vale arquivo (worktree) e diretorio. */
function acharGit(cwd) {
  // D98 rodada 2: `path.resolve` de nao-string estoura, e `inferir` inteira estourava
  // junto - uma funcao exportada que antes devolvia objeto passou a jogar TypeError.
  if (typeof cwd !== 'string' || cwd === '') return false;
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return true;
    const acima = path.dirname(dir);
    if (acima === dir) return false;
    dir = acima;
  }
}

function detectarLinguagem(tem) {
  if (tem('package.json')) return 'node';
  if (tem('pyproject.toml') || tem('requirements.txt') || tem('setup.py')) return 'python';
  if (tem('go.mod')) return 'go';
  if (tem('Cargo.toml')) return 'rust';
  if (tem('pom.xml') || tem('build.gradle') || tem('build.gradle.kts')) return 'jvm';
  if (tem('Gemfile')) return 'ruby';
  if (tem('composer.json')) return 'php';
  return null;
}

function detectarGerenciador(tem) {
  if (tem('pnpm-lock.yaml')) return 'pnpm';
  if (tem('yarn.lock')) return 'yarn';
  // A4-09: o Bun 1.2+ grava o bun.lock de texto; o bun.lockb e o binario de antes
  if (tem('bun.lockb') || tem('bun.lock')) return 'bun';
  if (tem('package-lock.json')) return 'npm';
  if (tem('package.json')) return 'npm';
  if (tem('poetry.lock')) return 'poetry';
  if (tem('uv.lock')) return 'uv';
  return null;
}

// D98: o `npm init -y` escreve um script de teste que sempre sai 1. O campo que
// promete PROVAR que esta pronto nao pode devolver um comando que nunca prova nada.
const STUB_NPM_INIT = /no test specified/i;

function detectarProva(cwd, tem, linguagem, gerenciador) {
  const pkg = lerPacote(cwd);
  const script = pkg && pkg.scripts && typeof pkg.scripts.test === 'string' ? pkg.scripts.test : null;
  // A4-09: `bun test` e o executor de testes do Bun, que ignora o scripts.test; `bun run test` roda o script
  if (script && !STUB_NPM_INIT.test(script)) {
    return gerenciador === 'bun' ? 'bun run test' : (gerenciador || 'npm') + ' test';
  }
  if (linguagem === 'python' && (tem('pytest.ini') || tem('pyproject.toml') || tem('tests'))) return 'pytest';
  if (linguagem === 'go') return 'go test ./...';
  if (linguagem === 'rust') return 'cargo test';
  if (linguagem === 'jvm' && tem('pom.xml')) return 'mvn test';
  return null;
}

const CANONICOS = [
  'CLAUDE.md', 'AGENTS.md', 'GEMINI.md', 'README.md', 'CONTRIBUTING.md',
  'ARCHITECTURE.md', 'PRODUCT.md', 'DESIGN.md', 'SPEC.md'
];

// D98: ancorados no NOME do arquivo, nao soltos no caminho inteiro. Antes,
// `src/auth/token.js` (um JWT) e ate `docs/por-que-nao-adotamos-design-system.md`
// - um documento que NEGA ter design system - ligavam a flag.
const SINAIS_DESIGN = [
  /^DESIGN\.md$/i,
  // D98 rodada 2: o `_` do partial de Sass e o `design.tokens.json` do formato DTCG
  // eram sinais legitimos, e a ancoragem os tinha derrubado junto com os falsos.
  /^_?(design[.-])?tokens\.(css|scss|json|ts|js)$/i,
  /^design-system[.-]/i,
  /^theme\.(css|ts|js)$/i,
  /^variables\.(css|scss)$/i
];
// E o diretorio chamado design-system, como SEGMENTO do caminho.
const PASTA_DESIGN = /(^|\/)design-system(\/|$)/i;

/** Motivos, em ASCII, do porque a lista pode nao representar o repositorio. */
function motivosDoCorte(sinal) {
  const lista = [];
  if (!sinal) return lista;
  if (sinal.truncado) lista.push('teto de ' + sinal.limite + ' arquivos atingido');
  if (sinal.profundidadeCortada) lista.push('profundidade maxima de ' + PROFUNDIDADE + ' niveis atingida');
  if (sinal.ilegiveis && sinal.ilegiveis.length) {
    lista.push(sinal.ilegiveis.length + ' diretorio(s) sem leitura: ' + sinal.ilegiveis.slice(0, 5).join(', '));
  }
  return lista;
}

/**
 * D98: os canonicos se conferem NO DISCO e SEM CAIXA. Comparar caixa exata contra a
 * lista varrida perdia `Claude.md` num sistema de arquivos que nao distingue caixa -
 * e essa lista e justamente o que a entrevista oferece na pergunta 2. O nome devolvido
 * e o que esta no disco, para o dono reconhecer o proprio arquivo.
 */
function canonicosNoDisco(cwd, arquivos) {
  const vistos = new Map();
  for (const f of arquivos) if (f.indexOf('/') === -1) vistos.set(f.toLowerCase(), f);
  let entradas = [];
  try { entradas = fs.readdirSync(cwd, { withFileTypes: true }); } catch (e) { entradas = []; }
  for (const entrada of entradas) if (entrada.isFile()) vistos.set(entrada.name.toLowerCase(), entrada.name);
  const achados = [];
  for (const c of CANONICOS) {
    const real = vistos.get(c.toLowerCase());
    if (real) achados.push(real);
  }
  return achados;
}

/**
 * `sinal` e o objeto devolvido por `listar`. Sem ele, `listaIncompleta` sai `null`
 * ("nao sei"), nunca `false` - dizer "a lista esta completa" sem ter como saber e a
 * afirmacao mais forte que a evidencia que este projeto persegue.
 */
function inferir(arquivos, cwd, sinal) {
  const conjunto = new Set(arquivos);
  const primeiroNivel = new Set(arquivos.map(function (f) { return f.split('/')[0]; }));
  // D98: o marcador tambem se confere no disco. Preso so a lista, um teto atingido
  // fazia um projeto Node responder `linguagem: null` com o package.json no disco.
  const topo = indiceDoTopo(cwd);
  const tem = function (nome) {
    return conjunto.has(nome) || primeiroNivel.has(nome) || topo.has(nome.toLowerCase());
  };

  const linguagem = detectarLinguagem(tem);
  const gerenciador = detectarGerenciador(tem);
  const temSinal = !!(sinal && typeof sinal.incompleta === 'boolean');

  return {
    linguagem: linguagem,
    gerenciador: gerenciador,
    provaDePronto: detectarProva(cwd, tem, linguagem, gerenciador),
    plataforma: {
      so: process.platform,
      shell: process.platform === 'win32' ? 'powershell' : 'bash'
    },
    candidatosCanonicos: canonicosNoDisco(cwd, arquivos),
    // D98: nao depende de ter sobrado arquivo na lista, e sobe ate a raiz. Antes dava
    // `false` numa subpasta de repositorio git, ao lado de `modificados` com 19 itens.
    temGit: acharGit(cwd),
    // D49: `null` chega como `null`. Colapsar em `[]` e que era proibido.
    modificados: git.modificados(cwd),
    temDesignSystem: arquivos.some(function (f) {
      const base = path.basename(f);
      return PASTA_DESIGN.test(f) || SINAIS_DESIGN.some(function (r) { return r.test(base); });
    }),
    listaIncompleta: temSinal ? sinal.incompleta : null,
    motivosIncompleta: temSinal ? motivosDoCorte(sinal) : []
  };
}

// H6j (D906): o indiceDoTopo, o detectarLinguagem e o lerPacote servem tambem ao lib/kit.js.
module.exports = { IGNORAR, LIMITE_PADRAO, PROFUNDIDADE, listar, inferir, indiceDoTopo, detectarLinguagem, lerPacote };
