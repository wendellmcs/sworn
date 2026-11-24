'use strict';
// H6b (15.3, docs/etapa15-proposta.md): pacote novo antes de instalar. Quem chama: scripts/portao-pacote.js (o 4o
// portao do portao-shell.js, PreToolUse de Bash|PowerShell|Monitor). Quem ajuda: o leitor de shell do
// scripts/lib/estilo-shell.js (comandosSimples, programa). Modelo inventa nome de pacote (USENIX Security 2025: 19,7%
// das amostras com ao menos um pacote que nao existe; 43% dos nomes inventados se repetem, e viram alvo). O portao nao
// consulta registro nenhum: le o comando, procura o nome no manifesto e no lockfile do projeto e, fora dos dois, avisa
// o agente com o comando de conferencia pronto. Quem consulta e o agente; o comando segue.
const fs = require('node:fs');
const path = require('node:path');
const estiloShell = require('./estilo-shell.js');

// Cada ecossistema: os arquivos onde um pacote ja declarado aparece (o nome exato ou com `*`, so na pasta, sem descer),
// como se le o nome do pacote na palavra do comando, como se compara (`separadores`: `-`, `_` e `.` sao o mesmo
// caractere, como no PEP 503 do pip e nos crates do cargo), o comando que o agente roda para conferir ({p} = o nome) e,
// quando o comando pode falhar sem o pacote faltar, a `nota` que diz o que fazer entao.
const ECOSSISTEMAS = {
  npm: { manifestos: ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock'],
    leitor: 'npm', conferir: 'npm view {p} name version description repository.url' },
  pypi: { manifestos: ['pyproject.toml', 'requirements*.txt', 'setup.py', 'setup.cfg', 'Pipfile', 'Pipfile.lock',
    'poetry.lock', 'uv.lock'], leitor: 'pypi', separadores: true, conferir: 'pip index versions {p}',
  nota: 'sem o pip (uv, poetry), abra https://pypi.org/project/{p}/' },
  crates: { manifestos: ['Cargo.toml', 'Cargo.lock'], leitor: 'crates', separadores: true, conferir: 'cargo info {p}',
    nota: 'o `cargo info` vem no cargo 1.82; antes dele, abra https://crates.io/crates/{p}' },
  go: { manifestos: ['go.mod', 'go.sum'], leitor: 'go', conferir: 'go list -m -versions {p}',
    nota: 'se falhar, o caminho pode ser um pacote dentro de um modulo: confira o modulo (o comeco do caminho)' },
  nuget: { manifestos: ['*.csproj', '*.fsproj', '*.vbproj', 'Directory.Packages.props', 'packages.lock.json',
    'packages.config'], leitor: 'nuget', conferir: 'dotnet package search {p} --exact-match' },
  rubygems: { manifestos: ['Gemfile', 'Gemfile.lock', '*.gemspec'], leitor: 'rubygems',
    conferir: 'gem search --remote --exact {p}' },
  packagist: { manifestos: ['composer.json', 'composer.lock'], leitor: 'packagist', conferir: 'composer show --all {p}' }
};

// Cada gerenciador: o programa, as palavras do subcomando (uma lista por forma aceita; `*` e uma palavra qualquer, como
// o projeto do `dotnet add <projeto> package`), as opcoes que levam valor na palavra seguinte (sem elas, o valor virava
// pacote) e as que mudam a origem para fora do registro (git, pasta: o nome nao e do registro, nada se avisa).
const GERENCIADORES = [
  { programa: 'npm', eco: 'npm', subcomandos: [['install'], ['i'], ['in'], ['ins'], ['inst'], ['insta'], ['instal'],
    ['isnt'], ['isnta'], ['isntal'], ['isntall'], ['add']],
  valor: ['--registry', '--prefix', '--tag', '-w', '--workspace', '--omit', '--include', '--cache', '--userconfig',
    '--globalconfig', '--install-strategy', '--save-prefix', '--loglevel', '--before', '--otp', '--cpu', '--os',
    '--libc', '--script-shell', '--fetch-retries', '--fetch-retry-factor', '--fetch-retry-mintimeout',
    '--fetch-retry-maxtimeout', '--fetch-timeout', '--audit-level', '--scope', '--cafile', '--proxy', '--https-proxy',
    '--noproxy', '--maxsockets', '--depth'] },
  { programa: 'pnpm', eco: 'npm', subcomandos: [['add']],
    valor: ['--registry', '--dir', '-C', '--filter', '-F', '--store-dir', '--config.registry', '--loglevel',
      '--reporter'] },
  { programa: 'yarn', eco: 'npm', subcomandos: [['add'], ['global', 'add']],
    valor: ['--registry', '--cwd', '--modules-folder', '--cache-folder'] },
  { programa: 'bun', eco: 'npm', subcomandos: [['add'], ['a']], valor: ['--registry', '--cwd', '--cache-dir'] },
  { programa: 'pip', eco: 'pypi', subcomandos: [['install']], valor: ['-r', '--requirement', '-c', '--constraint',
    '-e', '--editable', '-i', '--index-url', '--extra-index-url', '-f', '--find-links', '-t', '--target', '--prefix',
    '--root', '--platform', '--python-version', '--implementation', '--abi', '--src', '--upgrade-strategy', '--log',
    '--proxy', '--cert', '--client-cert', '--cache-dir', '--trusted-host', '--only-binary', '--no-binary', '-C',
    '--config-settings', '--progress-bar', '--report', '--python', '--timeout', '--retries', '--resume-retries',
    '--exists-action', '--keyring-provider', '--root-user-action', '--global-option', '--use-feature',
    '--use-deprecated', '--log-file', '--group'] },
  { programa: 'pipx', eco: 'pypi', subcomandos: [['install']], valor: ['--python', '--index-url', '--pip-args',
    '--suffix', '--spec'] },
  { programa: 'uv', eco: 'pypi', subcomandos: [['add'], ['pip', 'install']], valor: ['--group', '--optional',
    '--extra', '--package', '--index', '--default-index', '--index-url', '--extra-index-url', '--rev', '--tag',
    '--branch', '--python', '-p', '--directory', '--project', '-r', '--requirements', '--requirement', '-c',
    '--constraint', '--constraints', '-m', '--marker', '--bounds', '--script', '-e', '--editable', '-t', '--target',
    '--prefix', '--find-links', '-f', '--config-file', '--cache-dir'] },
  { programa: 'poetry', eco: 'pypi', subcomandos: [['add']], valor: ['-G', '--group', '-E', '--extras', '--source',
    '--python', '--platform', '--markers', '-C', '--directory', '-P', '--project'] },
  { programa: 'cargo', eco: 'crates', subcomandos: [['add']], valor: ['-F', '--features', '--rename', '-p',
    '--package', '--registry', '--manifest-path', '--target', '--branch', '--tag', '--rev', '--git', '--path',
    '--lockfile-path', '--config', '-Z', '--color'], foraDoRegistro: ['--git', '--path'] },
  { programa: 'go', eco: 'go', subcomandos: [['get']], valor: ['-modfile', '-C', '-tags', '-mod'] },
  { programa: 'dotnet', eco: 'nuget', subcomandos: [['add', 'package'], ['add', '*', 'package']],
    valor: ['-v', '--version', '-s', '--source', '-f', '--framework', '--package-directory'] },
  { programa: 'gem', eco: 'rubygems', subcomandos: [['install'], ['i']], valor: ['-v', '--version', '-i',
    '--install-dir', '-n', '--bindir', '-s', '--source', '--platform', '-g', '--file'] },
  { programa: 'bundle', eco: 'rubygems', subcomandos: [['add']], valor: ['-v', '--version', '-g', '--group', '-s',
    '--source', '--require', '--git', '--github', '--branch', '--ref', '--path', '--glob'],
  foraDoRegistro: ['--git', '--github', '--path'] },
  { programa: 'composer', eco: 'packagist', subcomandos: [['require'], ['req']], valor: ['-d', '--working-dir'] }
];

// O que prende a atencao antes de ler o shell: sem uma destas palavras, o comando nao instala nada.
const RE_GERENCIADOR = /(?:^|[^A-Za-z0-9_.-])(?:npm|pnpm|yarn|bun|pip[0-9.]*|pipx|uv|poetry|cargo|go|dotnet|gem|bundle|composer|python[0-9.]*|py)(?:\.exe)?(?![A-Za-z0-9_-])/i;
// Teto do que se le de cada manifesto ou lockfile: um lockfile grande chega a dezenas de MB; acima de 64 MB, nao se le
// (e o aviso diz que nao leu).
const TETO_DO_ARQUIVO = 64 * 1024 * 1024;
// Quantos pacotes o aviso lista: um comando com cem pacotes nao vira um aviso de cem linhas.
const TETO_DO_AVISO = 10;

// As opcoes do python que levam valor na palavra seguinte (`-W ignore -m pip`).
const PYTHON_VALOR = ['-W', '-X', '--check-hash-based-pycs'];
// A palavra que chega ao `-m`: as opcoes de uma letra sem valor coladas antes dele (`-Im`) e o modulo colado depois
// (`-mpip`), como o python aceita. O `-c` (codigo em vez de modulo) encerra a busca do mesmo jeito.
const PYTHON_M = /^-[bBdEhiIOPqRsSuvVx]*m(.*)$/;
const PYTHON_C = /^-[bBdEhiIOPqRsSuvVx]*c/;

/**
 * O nome do programa como a tabela o conhece: `pip3.12` e `pip`; `python -m pip`, `python -I -m pip`, `python -mpip`
 * e `py -3.12 -m pip` viram `pip` (devolve { nome, args }).
 */
function programaDaTabela(prog) {
  if (!prog) return null;
  let nome = prog.nome;
  let args = prog.args;
  if (/^(?:python[0-9.]*|py)$/.test(nome)) {
    let i = 0;
    while (i < args.length && !args[i].q && /^-/.test(args[i].t) && !PYTHON_M.test(args[i].t) &&
      !PYTHON_C.test(args[i].t)) {
      i += PYTHON_VALOR.indexOf(args[i].t) !== -1 ? 2 : 1;
    }
    const m = i < args.length && !args[i].q ? PYTHON_M.exec(args[i].t) : null;
    if (m && m[1]) {
      nome = m[1].toLowerCase();
      args = args.slice(i + 1);
    } else if (m && i + 1 < args.length) {
      nome = args[i + 1].t.toLowerCase();
      args = args.slice(i + 2);
    }
  }
  if (/^pip[0-9.]*$/.test(nome)) nome = 'pip';
  return { nome: nome, args: args };
}

/** As palavras soltas (sem as opcoes e seus valores) e se alguma opcao manda para fora do registro. */
function posicionais(args, g) {
  const saida = [];
  let fora = false;
  for (let i = 0; i < args.length; i++) {
    const t = args[i].t;
    if (!args[i].q && /^-/.test(t) && t !== '-') {
      const chave = t.replace(/=.*$/, '');
      if ((g.foraDoRegistro || []).indexOf(chave) !== -1) fora = true;
      if (t.indexOf('=') === -1 && g.valor.indexOf(chave) !== -1) i++;
      continue;
    }
    saida.push(t);
  }
  return { palavras: saida, fora: fora };
}

/** O tamanho do subcomando que casa com o comeco das palavras, ou -1. */
function casarSubcomando(palavras, g) {
  for (const sub of g.subcomandos) {
    if (sub.length > palavras.length) continue;
    const ok = sub.every(function (s, i) { return s === '*' || String(palavras[i]).toLowerCase() === s; });
    if (ok) return sub.length;
  }
  return -1;
}

// Leitores: a palavra do comando vira o nome do pacote no registro, ou null (caminho, endereco, git, variavel, versao).
const RE_NOME_NPM = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i;
const LEITORES = {
  npm: function (w) {
    if (/[:\\$`]/.test(w) || /\.(?:tgz|tar\.gz|tar)$/i.test(w)) return null; // caminho: a barra e o RE_NOME_NPM
    const m = /^(@[^@/]+\/[^@/]+|[^@/]+)(?:@.*)?$/.exec(w); // `user/repo` sem @ e atalho do GitHub: nao casa
    return m && RE_NOME_NPM.test(m[1]) ? m[1] : null;
  },
  pypi: function (w) {
    if (/[/\\:$`]/.test(w) || /^[.~]/.test(w) || /\.(?:whl|zip|tar\.gz|tgz)$/i.test(w)) return null;
    const m = /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)(?=$|[\[=<>!~;@ ,])/.exec(w);
    return m ? m[1] : null;
  },
  crates: function (w) {
    const m = /^([A-Za-z0-9_][A-Za-z0-9_-]*)(?:@[^@]*)?$/.exec(w);
    return m ? m[1] : null;
  },
  go: function (w) {
    const m = /^([A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}(?:\/[A-Za-z0-9._~+-]+)*)(?:@(.*))?$/.exec(w);
    if (!m || m[2] === 'none') return null; // `@none` tira o modulo, nao instala
    return m[1];
  },
  nuget: function (w) {
    return /^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(w) ? w : null;
  },
  rubygems: function (w) {
    if (/\.gem$/i.test(w)) return null;
    const m = /^([A-Za-z0-9_][A-Za-z0-9._-]*)(?::.*)?$/.exec(w); // `gem install rails:7.0`
    return m ? m[1] : null;
  },
  packagist: function (w) {
    const m = /^([a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?\/[a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?)(?:[:= ].*)?$/i.exec(w);
    return m ? m[1] : null; // sem `/` e restricao de versao (`^1.0`) ou pacote de plataforma (`php`, `ext-json`)
  }
};

/** O nome como o registro o compara: sem caixa e, no ecossistema com `separadores`, `-`, `_` e `.` iguais. */
function chaveDoNome(nome, eco) {
  const n = nome.toLowerCase();
  return ECOSSISTEMAS[eco].separadores ? n.replace(/[-_.]+/g, '-') : n;
}

/**
 * Os pacotes que o comando instala, na ordem, sem repetir: [{ nome, eco, programa }]. Le cada comando simples (com os
 * de dentro de `bash -c`, `powershell -Command`...), pelo idioma da ferramenta (`ps` no PowerShell).
 */
function pacotesDoComando(comando, ps) {
  const texto = String(comando || '');
  if (!RE_GERENCIADOR.test(texto)) return [];
  const saida = [];
  const vistos = new Set();
  estiloShell.comandosSimples(texto, !!ps).forEach(function (cmd) {
    const prog = programaDaTabela(estiloShell.programa(cmd));
    if (!prog) return;
    const g = GERENCIADORES.find(function (x) { return x.programa === prog.nome; });
    if (!g) return;
    const pos = posicionais(prog.args, g);
    const n = casarSubcomando(pos.palavras, g);
    if (n === -1 || pos.fora) return;
    const leitor = LEITORES[ECOSSISTEMAS[g.eco].leitor];
    pos.palavras.slice(n).forEach(function (w) {
      const nome = leitor(w);
      const chave = g.eco + ' ' + chaveDoNome(nome || '', g.eco);
      if (!nome || vistos.has(chave)) return;
      vistos.add(chave);
      saida.push({ nome: nome, eco: g.eco, programa: g.programa });
    });
  });
  return saida;
}

function escaparRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * O padrao do nome dentro de um manifesto: o nome inteiro, entre separadores de manifesto, sem caixa.
 * atalho: busca no texto, sem ler o formato de cada manifesto. limite: a palavra solta numa descricao (`"para express"`)
 * conta como declarada e o aviso nao sai (so falta aviso, nunca nega). trocar quando: um falso declarado for visto em
 * projeto real; entao ler as chaves de dependencia de cada formato.
 */
function padraoDoNome(nome, eco) {
  let corpo = escaparRegex(nome);
  if (ECOSSISTEMAS[eco].separadores) corpo = nome.split(/[-_.]+/).map(escaparRegex).join('[-_.]+');
  return new RegExp('(?:^|[\\s"\'=,\\[(<>:])' + corpo + '(?=$|[\\s"\'=,\\])<>:@~^!;\\[])', 'im');
}

/** O go casa tambem o modulo de que o pacote e subpasta (`github.com/a/b/c` esta em `github.com/a/b`). */
function nomesParaProcurar(p) {
  if (p.eco !== 'go') return [p.nome];
  const partes = p.nome.split('/');
  const nomes = [];
  for (let k = partes.length; k >= Math.min(2, partes.length); k--) nomes.push(partes.slice(0, k).join('/'));
  return nomes;
}

/** O nome do arquivo casa o padrao da tabela, sem caixa (`cargo.toml` e `pipfile` tambem se leem). */
function casaPadrao(entrada, padrao) {
  if (padrao.indexOf('*') === -1) return entrada.toLowerCase() === padrao.toLowerCase();
  return new RegExp('^' + padrao.split('*').map(escaparRegex).join('.*') + '$', 'i').test(entrada);
}

/** Os arquivos do ecossistema nas pastas, na ordem da tabela (o manifesto antes do lockfile). */
function arquivosDoEcossistema(eco, pastas) {
  const saida = [];
  pastas.forEach(function (dir) {
    let entradas;
    try { entradas = fs.readdirSync(dir); } catch (e) { return; }
    ECOSSISTEMAS[eco].manifestos.forEach(function (padrao) {
      entradas.filter(function (n) { return casaPadrao(n, padrao); }).sort().forEach(function (n) {
        saida.push(path.join(dir, n));
      });
    });
  });
  return saida;
}

function lerManifesto(arquivo) {
  try {
    const st = fs.statSync(arquivo);
    if (!st.isFile() || st.size > TETO_DO_ARQUIVO) return null;
    return fs.readFileSync(arquivo, 'utf8');
  } catch (e) { return null; }
}

/**
 * Os pacotes do comando que nao aparecem em nenhum manifesto ou lockfile das pastas (a raiz do projeto e a pasta do
 * comando). Cada arquivo se le uma vez por chamada. `naoLidos`, se vier, recebe o caminho de cada arquivo do
 * ecossistema que nao se leu (acima do teto ou ilegivel): o pacote pode estar nele, e o aviso diz isso.
 */
function pacotesNovos(pacotes, pastas, naoLidos) {
  const unicas = pastas.filter(function (p, i) { return p && pastas.indexOf(p) === i; });
  const cache = new Map();
  const texto = function (arq) {
    if (!cache.has(arq)) {
      cache.set(arq, lerManifesto(arq));
      if (cache.get(arq) === null && naoLidos && naoLidos.indexOf(arq) === -1) naoLidos.push(arq);
    }
    return cache.get(arq);
  };
  return pacotes.filter(function (p) {
    const arquivos = arquivosDoEcossistema(p.eco, unicas);
    const padroes = nomesParaProcurar(p).map(function (n) { return padraoDoNome(n, p.eco); });
    return !arquivos.some(function (arq) {
      const t = texto(arq);
      return t !== null && padroes.some(function (re) { return re.test(t); });
    });
  });
}

/**
 * O aviso ao agente: os pacotes fora do manifesto e do lockfile, e o comando que confere cada um. O nome entra cru no
 * comando: os leitores so deixam passar letra, digito e `@ / . _ ~ + -`, nada que o shell leia. Os de depois do teto
 * entram so pelo nome, sem o comando. `naoLidos`: os arquivos que `pacotesNovos` nao leu.
 */
function aviso(novos, naoLidos) {
  const lista = novos.slice(0, TETO_DO_AVISO);
  const resto = novos.slice(TETO_DO_AVISO);
  const linhas = [
    'sworn: pacote fora do manifesto e do lockfile deste projeto: ' +
      lista.map(function (p) { return '`' + p.nome + '` (' + p.programa + ')'; }).join(', ') +
      (resto.length ? ', e mais ' + resto.length + ' sem o comando de conferencia: ' +
        resto.map(function (p) { return '`' + p.nome + '`'; }).join(', ') : '') + '. O comando segue.',
    'Modelo inventa nome de pacote (USENIX Security 2025: 19,7% das amostras citavam ao menos um que nao existe), e ' +
      'quem registra o nome inventado recebe a instalacao. Confira que cada um existe e e o que voce quer:'
  ];
  lista.forEach(function (p) {
    linhas.push('  ' + ECOSSISTEMAS[p.eco].conferir.replace('{p}', p.nome));
  });
  const notas = [];
  lista.forEach(function (p) {
    const nota = ECOSSISTEMAS[p.eco].nota;
    const t = nota ? nota.replace('{p}', p.nome) : null;
    if (t && notas.indexOf(t) === -1) notas.push(t);
  });
  notas.forEach(function (n) { linhas.push('  (' + n + ')'); });
  if (naoLidos && naoLidos.length) {
    linhas.push('Nao li (acima de ' + TETO_DO_ARQUIVO / 1024 / 1024 + ' MB ou ilegivel), e o pacote pode estar nele: ' +
      naoLidos.join(', ') + '.');
  }
  linhas.push('Se nao existir, ou for outro (nome parecido, sem repositorio, publicado ha poucos dias), desinstale e ' +
    'avise o usuario.');
  return linhas.join('\n');
}

module.exports = { ECOSSISTEMAS, GERENCIADORES, TETO_DO_AVISO, pacotesDoComando, pacotesNovos, aviso };
