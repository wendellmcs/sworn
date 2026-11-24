'use strict';
const varredura = require('./varredura.js');

/**
 * H6j (15.5, D906): o kit da linguagem que o `init` e o relatorio de cobertura recomendam. O sworn nunca embute nem
 * instala nenhum deles: mostra o que viu no projeto e o comando (ou a pagina de instalacao) de cada um, e quem instala
 * e o dono. A lista e metodo,
 * nao resultado (o `depcheck`, que estaria nela, foi arquivado): `CONFERIDO` diz quando os nomes e os comandos foram
 * conferidos nas paginas de cada ferramenta. Sem rede: so le a raiz do projeto e o que o chamador ja detectou.
 */
const CONFERIDO = '2026-11-24';
const MARKETPLACE = 'claude-plugins-official';

// A tabela "Language | Plugin | Binary" de https://code.claude.com/docs/en/plugins/code-intelligence, nas linguagens
// que o `detectarLinguagem` da varredura reconhece. O plugin so configura o servidor: o binario tem de estar no PATH,
// e o sworn nao confere o PATH (o texto diz isso tambem no visto).
const PAGINA_LSP = 'https://code.claude.com/docs/en/plugins/code-intelligence';
const LSP = {
  node: { plugin: 'typescript-lsp', binario: 'typescript-language-server' },
  python: { plugin: 'pyright-lsp', binario: 'pyright-langserver' },
  go: { plugin: 'gopls-lsp', binario: 'gopls' },
  rust: { plugin: 'rust-analyzer-lsp', binario: 'rust-analyzer' },
  jvm: { plugin: 'jdtls-lsp', binario: 'jdtls' },
  ruby: { plugin: 'ruby-lsp', binario: 'ruby-lsp' },
  php: { plugin: 'php-lsp', binario: 'intelephense' }
};

// Os arquivos de configuracao na raiz, em caixa baixa (o `indiceDoTopo` devolve assim). Instalado so na maquina ou
// no CI nao deixa arquivo aqui: o nao visto diz isso.
const SINAIS = {
  gitleaks: ['.gitleaks.toml', '.gitleaksignore'],
  semgrep: ['.semgrep.yml', '.semgrep.yaml', '.semgrep', '.semgrepignore'],
  knip: ['knip.json', 'knip.jsonc', '.knip.json', '.knip.jsonc', 'knip.js', 'knip.ts', 'knip.config.js', 'knip.config.ts']
};

const NAO_LIDO = 'o settings pessoal (~/.claude/settings.json) nao e lido: confira com claude plugin list';
const SO_NA_MAQUINA = '(instalado so na maquina ou no CI nao aparece aqui)';

function lista(v) { return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string'; }) : []; }
function objeto(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

// Os arquivos de configuracao da ferramenta achados na raiz (lista vazia = nenhum).
function achados(nomes, chave) { return SINAIS[chave].filter(function (n) { return nomes.has(n); }); }

function porArquivo(nomes, chave) {
  const achado = achados(nomes, chave);
  return achado.length
    ? { visto: true, onde: 'achei ' + achado.join(', ') + ' na raiz' }
    : { visto: false, onde: 'nao achei ' + SINAIS[chave].join(', ') + ' na raiz ' + SO_NA_MAQUINA };
}

function knipNoPacote(pacote) {
  if (!objeto(pacote)) return false;
  if (Object.prototype.hasOwnProperty.call(pacote, 'knip')) return true;
  return ['dependencies', 'devDependencies'].some(function (campo) {
    return objeto(pacote[campo]) && Object.prototype.hasOwnProperty.call(pacote[campo], 'knip');
  });
}

/**
 * `fatos`: `linguagem` (a da varredura, ou null), `nomes` (Set dos nomes da raiz, em caixa baixa), `pacote` (o
 * package.json lido, ou null), `plugins` (as chaves "nome@marketplace" ligadas nos settings do projeto) e `mcp` (os
 * nomes de servidor MCP lidos). Devolve { conferido, linguagem, itens: [{ chave, nome, para, visto, onde, como }] }.
 */
function recomendar(fatos) {
  const f = fatos || {};
  const linguagem = Object.prototype.hasOwnProperty.call(LSP, f.linguagem) ? f.linguagem : null;
  const nomes = f.nomes instanceof Set ? f.nomes : new Set();
  const plugins = lista(f.plugins);
  const mcp = lista(f.mcp);
  const nomeDoPlugin = function (p) { return p.split('@')[0]; };
  // context7: o plugin pelo comeco do nome (o do marketplace e "context7"); o servidor MCP em qualquer parte, porque o
  // nome do servidor e livre ("upstash-context7-mcp"). Os dois sem caixa: o dono escolhe a caixa do nome.
  const posicaoDoContext7 = function (n) { return n.toLowerCase().indexOf('context7'); };
  const itens = [];

  if (linguagem) {
    const l = LSP[linguagem];
    const ligado = plugins.some(function (p) { return nomeDoPlugin(p) === l.plugin; });
    itens.push({
      chave: 'lsp', nome: l.plugin,
      para: 'o Claude navega o codigo pelo servidor de linguagem (definicao, referencias, erro de tipo) em vez de grep',
      visto: ligado,
      // o visto so diz que o plugin esta ligado: o binario no PATH segue por conferir, e o texto diz isso
      onde: ligado ? 'ligado nos settings do projeto; confira o ' + l.binario + ' no PATH (o sworn nao confere)'
        : 'nao vi ligado nos settings do projeto (' + NAO_LIDO + ')',
      como: '/plugin install ' + l.plugin + '@' + MARKETPLACE + ' e instale o ' + l.binario + ' no PATH (' + PAGINA_LSP + ')'
    });
  }

  const c7 = plugins.some(function (p) { return posicaoDoContext7(nomeDoPlugin(p)) === 0; }) ||
    mcp.some(function (m) { return posicaoDoContext7(m) !== -1; });
  itens.push({
    chave: 'context7', nome: 'context7',
    para: 'a documentacao atual da biblioteca, em vez da que o modelo decorou',
    visto: c7,
    onde: c7 ? 'achei nos plugins do projeto ou num servidor MCP lido (do projeto ou do ~/.claude.json)'
      : 'nao vi nos plugins do projeto nem nos servidores MCP lidos (' + NAO_LIDO + ')',
    como: 'npx ctx7 setup (https://github.com/upstash/context7)'
  });

  itens.push(Object.assign({ chave: 'gitleaks', nome: 'gitleaks', para: 'segredo no commit, antes de sair da maquina' },
    porArquivo(nomes, 'gitleaks'), { como: 'instale pela pagina https://github.com/gitleaks/gitleaks' }));
  itens.push(Object.assign({ chave: 'semgrep', nome: 'semgrep', para: 'padrao inseguro no codigo, por regra' },
    porArquivo(nomes, 'semgrep'), { como: 'instale pela pagina https://github.com/semgrep/semgrep' }));

  if (linguagem === 'node') {
    const arquivos = achados(nomes, 'knip');
    const k = arquivos.length ? { visto: true, onde: 'achei ' + arquivos.join(', ') + ' na raiz' }
      : knipNoPacote(f.pacote) ? { visto: true, onde: 'achei o knip no package.json' }
        : { visto: false, onde: 'nao achei o knip no package.json nem ' + SINAIS.knip.join(', ') + ' na raiz ' + SO_NA_MAQUINA };
    itens.push(Object.assign({ chave: 'knip', nome: 'knip', para: 'arquivo, export e dependencia que ninguem usa' }, k,
      { como: 'npm install -D knip (https://knip.dev)' }));
  }

  return { conferido: CONFERIDO, linguagem: linguagem, itens: itens };
}

/**
 * O kit desta pasta: a raiz e o package.json lidos aqui; plugins e MCP vem do `ambiente.detectar` que o chamador ja
 * rodou (`amb`), com os servidores do `~/.claude.json` quando ele os leu.
 */
function daPasta(cwd, amb) {
  const a = amb || {};
  const nomes = varredura.indiceDoTopo(cwd);
  const linguagem = varredura.detectarLinguagem(function (n) { return nomes.has(n.toLowerCase()); });
  const fora = objeto(a.mcpForaDoProjeto) ? a.mcpForaDoProjeto : {};
  return recomendar({
    linguagem: linguagem,
    nomes: nomes,
    pacote: linguagem === 'node' ? varredura.lerPacote(cwd) : null,
    plugins: a.plugins,
    mcp: lista(a.mcp).concat(lista(fora.usuario), lista(fora.local))
  });
}

/** A secao do kit no texto do relatorio de cobertura. */
function linhas(k) {
  const qual = k.linguagem ||
    ('linguagem nao reconhecida, entao sem servidor de linguagem: o sworn reconhece ' + Object.keys(LSP).join(', '));
  const saida = ['Kit da linguagem (' + qual + '): recomendado; o sworn nunca instala nem embute. Lista conferida em ' +
    k.conferido + '.'];
  for (const i of k.itens) {
    const titulo = i.chave === 'lsp' ? 'Servidor de linguagem (' + i.nome + ')' : i.nome;
    saida.push('  ' + (i.visto ? '[x] ' : '[ ] ') + titulo + ' - ' + i.para + ' - ' + i.onde +
      (i.visto ? '' : '. Como: ' + i.como));
  }
  return saida;
}

module.exports = { CONFERIDO, MARKETPLACE, LSP, SINAIS, recomendar, daPasta, linhas };
