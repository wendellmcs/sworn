'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ambiente = require('./ambiente.js');
const injetado = require('./injetado.js');
const instrucoes = require('./instrucoes.js');
const regraLib = require('./regra.js');
const rubrica = require('./rubrica.js');
const textoLib = require('./texto.js');
const varredura = require('./varredura.js');

const VAZIAS = new Set([
  'use', 'quando', 'para', 'com', 'sem', 'que', 'uma', 'um', 'o', 'a', 'os', 'as', 'de', 'do', 'da',
  'em', 'no', 'na', 'ao', 'e', 'ou', 'se', 'por', 'the', 'when', 'for', 'and', 'usuario', 'projeto',
  'coisa', 'precisar', 'pedir', 'fazer', 'ver', 'outra', 'no', 'antes', 'depois'
]);

function normalizar(t) {
  return String(t == null ? '' : t).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter(Boolean);
}

function termos(descricao) {
  return new Set(normalizar(descricao).filter(function (p) { return p.length > 3 && !VAZIAS.has(p); }));
}

// D396/D398 (#10a): 1 termo em comum acusava 40 de 80 pares, 39 deles sem sobreposicao. Agora so com
// 2 termos em comum ou mais E a fracao de termos comuns (Jaccard: comuns / todos os termos do par) de
// 0,20 ou mais - medido 80/80 na bateria da 2b-1 (plano da 0.5.2, secao 7). O "nao" mais perto teve 0,111.
const MIN_TERMOS_COMUNS = 2;
const MIN_JACCARD = 0.20;

function sobreposicoes(skills) {
  const achados = [];
  const lista = (skills || []).map(function (s) { return { nome: s.nome, t: termos(s.descricao) }; });
  for (let i = 0; i < lista.length; i++) {
    for (let j = i + 1; j < lista.length; j++) {
      const comuns = Array.from(lista[i].t).filter(function (x) { return lista[j].t.has(x); });
      const todos = lista[i].t.size + lista[j].t.size - comuns.length;
      if (comuns.length >= MIN_TERMOS_COMUNS && comuns.length / todos >= MIN_JACCARD) {
        achados.push({ a: lista[i].nome, b: lista[j].nome, termos: comuns });
      }
    }
  }
  return achados;
}

function contradicoes(regras) {
  const porGatilho = new Map();
  for (const r of (regras || [])) {
    const chave = normalizar(r.gatilho).join(' ');
    if (!chave) continue;
    if (!porGatilho.has(chave)) porGatilho.set(chave, new Set());
    porGatilho.get(chave).add(String(r.acao).trim());
  }
  const achados = [];
  for (const [gatilho, acoes] of porGatilho) {
    if (acoes.size > 1) achados.push({ gatilho: gatilho, acoes: Array.from(acoes) });
  }
  return achados;
}

function lerSkills(cwd) {
  const nomes = ambiente.detectar(cwd).skills;
  return nomes.map(function (nome) {
    let descricao = '';
    let texto = '';
    try {
      texto = fs.readFileSync(path.join(cwd, '.claude', 'skills', nome, 'SKILL.md'), 'utf8');
      const m = texto.match(/^description:\s*(.+)$/im);
      if (m) descricao = m[1];
    } catch (e) { /* skill sem SKILL.md legivel */ }
    return { nome: nome, descricao: descricao, texto: texto };
  });
}

// D615 (L10 do censo da D612): as skills do proprio plugin, com o nome como o ambiente as lista (sworn:<nome>).
// Entram so no cruzamento com as do projeto: o corpo delas carrega so quando chamadas, entao o peso nao as soma.
const PASTA_DO_PLUGIN = path.join(__dirname, '..', '..', 'skills');

function lerSkillsDoPlugin() {
  let nomes = [];
  try { nomes = fs.readdirSync(PASTA_DO_PLUGIN); } catch (e) { return []; }
  const saida = [];
  for (const nome of nomes) {
    try {
      const texto = fs.readFileSync(path.join(PASTA_DO_PLUGIN, nome, 'SKILL.md'), 'utf8');
      const m = texto.match(/^description:\s*(.+)$/im);
      saida.push({ nome: 'sworn:' + nome, descricao: m ? m[1] : '' });
    } catch (e) { /* pasta sem SKILL.md */ }
  }
  return saida;
}

/** Os pares projeto x plugin (a = do projeto, b = do plugin); par entre duas do mesmo lado fica de fora. */
function cruzarComPlugin(doProjeto, doPlugin) {
  const doLado = new Set(doPlugin.map(function (s) { return s.nome; }));
  return sobreposicoes(doProjeto.concat(doPlugin)).filter(function (p) {
    return !doLado.has(p.a) && doLado.has(p.b);
  });
}

// Limite de CARGA do MEMORY.md, da documentacao oficial do Claude Code (memory.md): so as
// primeiras 200 linhas ou 25 KB entram na sessao, o que vier primeiro. NAO e o teto de
// instrucao do limites.json (esse e medido por nos, e nao soma o MEMORY.md): e o da doc.
// "25 KB": a doc nao diz se sao 25.000 ou 25.600 bytes. Usamos 25.000, o menor, que avisa antes.
const CARGA_LINHAS = 200;
const CARGA_BYTES = 25000;
const CARGA_FONTE = 'documentacao oficial do Claude Code, memory.md: carrega as primeiras 200 linhas ou 25 KB do MEMORY.md, o que vier primeiro';
const CARGA_NOTA = '"25 KB" lido como 25.000 bytes; a doc nao diz se sao 25.000 ou 25.600 (o menor avisa antes)';
const METODO_MEMORIA = 'linha = trecho terminado em \\n (o \\n final nao abre linha nova; \\r do fim nao conta no tamanho da linha); bytes em UTF-8, do arquivo inteiro; ' +
  'fora da carga: linhas e bytes saem do mesmo corte, o que vier primeiro. ' +
  'Cortou por linhas: linhas de fora = as depois da 200a, bytes de fora = os do inicio da linha 201 em diante. ' +
  'Cortou por bytes: bytes de fora = os depois dos 25.000, linhas de fora = as que nao cabem inteiras nos 25.000 (a linha cortada no meio conta como de fora)';

function naoMedida(causa, motivo, caminho) {
  const m = { medida: false, causa: causa, motivo: motivo };
  if (caminho) m.caminho = caminho;
  return m;
}

// A dica do erro de leitura depende do codigo: "confira o caminho" so serve a quem errou o caminho.
function dicaDeLeitura(codigo) {
  if (codigo === 'ENOENT' || codigo === 'ENOTDIR') return 'confira o caminho passado em --memoria';
  if (codigo === 'EISDIR') return 'o caminho passado em --memoria e uma pasta, passe o arquivo MEMORY.md';
  if (codigo === 'EACCES' || codigo === 'EPERM') return 'confira a permissao de leitura do arquivo passado em --memoria';
  return 'confira o arquivo passado em --memoria';
}

// Mede o MEMORY.md contra o limite de carga. Nunca some calada: sem caminho ou sem leitura
// devolve "nao medida" com a causa. O caminho vem de quem chama (a skill), nunca adivinhado.
function medirMemoria(caminho) {
  if (!caminho) {
    return naoMedida('sem-caminho', 'nao medida: nenhum caminho do MEMORY.md foi passado (argumento --memoria <caminho>)');
  }
  let buf;
  try {
    buf = fs.readFileSync(caminho);
  } catch (e) {
    const codigo = (e && e.code) || 'ERRO';
    return naoMedida(codigo, 'nao medida: nao consegui ler ' + caminho + ' (' + textoLib.causaDoErro(e) + '); ' + dicaDeLeitura(codigo), caminho);
  }

  const bytes = buf.length;
  // inicios[i] = posicao do primeiro byte da linha i+1. O \n final nao abre linha nova.
  const inicios = bytes > 0 ? [0] : [];
  for (let i = 0; i < bytes - 1; i++) {
    if (buf[i] === 10) inicios.push(i + 1);
  }
  const linhas = inicios.length;

  let maior = { numero: 0, bytes: 0 };
  for (let i = 0; i < linhas; i++) {
    let fim = i + 1 < linhas ? inicios[i + 1] : bytes;
    if (fim > inicios[i] && buf[fim - 1] === 10) fim--;
    if (fim > inicios[i] && buf[fim - 1] === 13) fim--;
    const tam = fim - inicios[i];
    if (tam > maior.bytes) maior = { numero: i + 1, bytes: tam };
  }

  const estouraLinhas = linhas > CARGA_LINHAS;
  const estouraBytes = bytes > CARGA_BYTES;
  let primeiro = null;
  if (estouraLinhas && estouraBytes) primeiro = inicios[CARGA_LINHAS] < CARGA_BYTES ? 'linhas' : 'bytes';
  else if (estouraLinhas) primeiro = 'linhas';
  else if (estouraBytes) primeiro = 'bytes';

  // As duas medidas de "fora" saem do MESMO corte, o que vier primeiro (`primeiro`).
  let fora = { linhas: 0, bytes: 0 };
  if (primeiro === 'linhas') {
    fora = { linhas: linhas - CARGA_LINHAS, bytes: bytes - inicios[CARGA_LINHAS] };
  } else if (primeiro === 'bytes') {
    // Linha dentro = comeca antes do byte 25.000 e o texto dela (sem o \n) termina ate ele. A cortada no meio conta como fora.
    let dentro = 0;
    while (dentro < linhas) {
      const fim = dentro + 1 < linhas ? inicios[dentro + 1] : bytes;
      let texto = fim > inicios[dentro] && buf[fim - 1] === 10 ? fim - 1 : fim;
      if (texto > inicios[dentro] && buf[texto - 1] === 13) texto--; // F3-19: o CR do CRLF tambem nao e texto
      if (inicios[dentro] >= CARGA_BYTES || texto > CARGA_BYTES) break;
      dentro++;
    }
    fora = { linhas: linhas - dentro, bytes: bytes - CARGA_BYTES };
  }

  return {
    medida: true,
    caminho: caminho,
    linhas: linhas,
    bytes: bytes,
    maiorLinha: maior,
    limite: { linhas: CARGA_LINHAS, bytes: CARGA_BYTES, fonte: CARGA_FONTE, nota: CARGA_NOTA },
    cabe: !estouraLinhas && !estouraBytes,
    primeiro: primeiro,
    foraDaCarga: fora,
    metodo: METODO_MEMORIA
  };
}

// Le o regras.md do projeto. Nunca cala: devolve a lista e o estado da leitura (chave `regras`, no
// molde da `memoria`). Sem o arquivo (ENOENT) e "nao lidas", mas nao e erro: o projeto pode nao ter regras.
function lerRegras(cwd) {
  const relativo = '.claude/sworn/regras.md';
  try {
    const lista = regraLib.parseRegras(fs.readFileSync(path.join(cwd, '.claude', 'sworn', 'regras.md'), 'utf8'));
    return { lista: lista, estado: { lidas: true, total: lista.length } };
  } catch (e) {
    const codigo = (e && e.code) || 'ERRO';
    const motivo = codigo === 'ENOENT'
      ? 'regras nao lidas: o projeto nao tem ' + relativo + '; as contradicoes entre regras nao foram conferidas (o /sworn:init cria esse arquivo)'
      : (e && e.code
        ? 'regras nao lidas: nao consegui ler ' + relativo + ' (' + textoLib.causaDoErro(e) + ')'
        // F3-18: sem `code` o arquivo abriu; o que falhou foi o parseRegras, e "(ERRO)" escondia isso
        : 'regras nao lidas: regras.md ilegivel: ' + textoLib.causaDoErro(e)) +
        '; as contradicoes entre regras nao foram conferidas. Confira o arquivo e rode /sworn:audit de novo';
    return { lista: [], estado: { lidas: false, causa: codigo, motivo: motivo } };
  }
}

// `opcoes.memoria`: caminho do MEMORY.md, passado pela skill. A medida sai a parte, na chave
// `memoria`; o teto de instrucao (`peso`) nao a soma (D288). Valor que nao e texto (so pela API: o
// auditar.js ja filtra) nao vira caminho: vira "nao medida" com a causa `caminho-invalido`.
function auditar(cwd, projeto, opcoes) {
  const skills = lerSkills(cwd);
  const pedida = opcoes ? opcoes.memoria : null;
  const memoria = pedida && typeof pedida !== 'string'
    ? naoMedida('caminho-invalido', 'nao medida: --memoria precisa de um caminho em texto (recebi ' + (Array.isArray(pedida) ? 'lista' : typeof pedida) + ')')
    : medirMemoria(pedida ? path.resolve(cwd, pedida) : null);
  const lidas = lerRegras(cwd);
  const regras = lidas.lista;

  const foraDaRubrica = [];
  for (const s of skills) {
    if (!s.texto) continue;
    const r = rubrica.conferir(s.texto);
    if (!r.ok) foraDaRubrica.push({ skill: s.nome, erros: r.erros });
  }

  // T11-3/D370: sem projeto.json (projeto falsy) o peso usa os candidatos a fonte canonica da
  // varredura, como o init; com projeto, o que ele declara manda (D368) e nao se varre nada.
  let candidatos;
  if (!projeto) {
    const r = varredura.listar(cwd);
    candidatos = varredura.inferir(r.arquivos, cwd, r).candidatosCanonicos;
  }

  return {
    peso: instrucoes.contar(cwd, projeto || {}, candidatos),
    skills: skills.map(function (s) { return s.nome; }),
    sobreposicoes: sobreposicoes(skills),
    doPlugin: (function () {
      const plugin = lerSkillsDoPlugin();
      return { skills: plugin.map(function (s) { return s.nome; }), sobreposicoes: cruzarComPlugin(skills, plugin) };
    })(),
    contradicoes: contradicoes(regras),
    regras: lidas.estado,
    foraDaRubrica: foraDaRubrica,
    delegaveis: ambiente.detectar(cwd).delegaveis,
    memoria: memoria,
    // plano 0.9.1 (D568): o injetado pelos ganchos, a parte do peso como a memoria; quem acha a transcricao e o auditar.js
    injetado: injetado.medir(opcoes ? opcoes.transcricao : null)
  };
}

module.exports = {
  VAZIAS, CARGA_LINHAS, CARGA_BYTES, normalizar, termos, sobreposicoes, contradicoes, medirMemoria, auditar
};
