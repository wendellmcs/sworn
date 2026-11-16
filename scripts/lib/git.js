'use strict';
const cp = require('node:child_process');

const PRAZO_PADRAO_MS = 20000;
const SAIDA_PADRAO_BYTES = 64 * 1024 * 1024;

/**
 * F5a (diagnostico de 2026-11-10, secao F): o UNICO spawn do git no plugin (test/git.test.js barra outro). Sem shell,
 * sem janela, texto utf8; prazo padrao de 20 s e saida de ate 64 MiB, os dois trocaveis em `opcoes` por outro valor
 * positivo. O prazo e sempre finito, de proposito (um gancho nunca espera o git para sempre): `timeout` 0 ou ausente
 * vira o padrao, nunca "sem limite". `opcoes.env` se soma ao do processo. Nunca lanca: o spawn que lanca (argumento invalido) volta como `{ status: null, error }`. O
 * resultado e o do spawnSync, para quem precisa do status, do stderr ou do sinal; `ok(r)` diz se deu certo.
 * `cp.spawnSync` e lido na hora da chamada: os testes trocam a funcao por `node --require` antes do script carregar.
 */
function rodar(cwd, args, opcoes) {
  const o = opcoes || {};
  const config = {
    encoding: 'utf8', shell: false, windowsHide: true,
    timeout: o.timeout || PRAZO_PADRAO_MS, maxBuffer: o.maxBuffer || SAIDA_PADRAO_BYTES
  };
  if (cwd) config.cwd = cwd;
  if (o.env) config.env = Object.assign({}, process.env, o.env);
  try {
    return cp.spawnSync('git', args, config);
  } catch (e) {
    return { status: null, signal: null, stdout: '', stderr: '', error: e };
  }
}

/** O git rodou, saiu 0 e devolveu texto. */
function ok(r) {
  return !!r && !r.error && r.status === 0 && typeof r.stdout === 'string';
}

/**
 * O prazo padrao do `correr`: 5 s, ou o `SWORN_GIT_PRAZO_MS` do ambiente quando e um inteiro positivo (lido na hora
 * da chamada). F1g (s372, 0.39.0): na suite carregada o git passava de 5 s, o `null` do prazo virava "fora do
 * repositorio" e o portao de commit liberava; o repositorio grande, onde o `git status` passa de 5 s, cai no mesmo.
 * Sem teto de proposito: o spawnSync aceita ate o Number.MAX_SAFE_INTEGER, e quem pos o valor escolheu esperar.
 */
function prazoDoCorrer() {
  const texto = process.env.SWORN_GIT_PRAZO_MS;
  const n = /^\s*\d+\s*$/.test(texto || '') ? Number(texto) : 0;
  return n > 0 && Number.isSafeInteger(n) ? n : 5000;
}

/**
 * Foto do git status na abertura da sessao (D17).
 * R3: spawnSync com shell:false. Nada de shell.
 * D49: devolve `null` quando NAO conseguiu fotografar (sem cwd, git ausente, fora
 * de repositorio, timeout) e `[]` quando a arvore esta limpa. Sem essa distincao a
 * guarda da D46 congelaria uma foto que falhou ate o fim da sessao, e a trava 5b
 * ficaria muda pelo resto do dia sem uma linha ao usuario.
 */
function correr(cwd, args, opcoes) {
  // maxBuffer opcional: o padrao daqui (1 MiB, o do spawnSync, mantido) estoura em saida grande e viraria `null`.
  // timeout opcional (ms; padrao: prazoDoCorrer): existe para o teste nao esperar 5 s.
  const r = rodar(cwd, args, {
    timeout: opcoes && opcoes.timeout ? opcoes.timeout : prazoDoCorrer(),
    maxBuffer: opcoes && opcoes.maxBuffer ? opcoes.maxBuffer : 1024 * 1024
  });
  // A2-14: o retorno segue `null` (mesmo contrato), mas quem quiser saber POR QUE passa `opcoes.falha` (um
  // objeto) e le `falha.timeout === true` depois: git lento nao e o mesmo que "fora do repositorio".
  if (r.error && r.error.code === 'ETIMEDOUT' && opcoes && opcoes.falha) opcoes.falha.timeout = true;
  return ok(r) ? r.stdout : null;
}

/**
 * D41: o --porcelain devolve caminho relativo a RAIZ do repositorio, e o portao
 * compara com caminho relativo ao cwd. Sem descontar o prefixo, a trava 5b fica
 * muda sempre que o Claude abre numa subpasta do repositorio.
 * O prefixo vem do proprio git, ja em barra normal, vazio quando cwd e a raiz.
 */
function prefixo(cwd) {
  const bruto = correr(cwd, ['rev-parse', '--show-prefix']);
  if (bruto === null) return null;
  return bruto.replace(/\r?\n/g, '').replace(/\\/g, '/');
}

function modificados(cwd) {
  if (!cwd) return null;
  // D42: sem --untracked-files=all o git colapsa pasta inteiramente nao rastreada
  // numa entrada so ("sub/"), e a trava 5b nao protege nada dentro dela.
  const saida = correr(cwd, ['status', '--porcelain', '--untracked-files=all', '-z']);
  if (saida === null) return null;
  const partes = saida.split('\0').filter(function (p) { return p !== ''; });
  // F1g (s372): arvore limpa nao tem caminho a converter, e o prefixo era um git a mais em toda abertura, todo turno
  // e todo comando destrutivo. A lista vazia sai sem ele.
  if (partes.length === 0) return [];
  const pre = prefixo(cwd);
  if (pre === null) return null;

  // Caminho da raiz do repositorio -> caminho relativo ao cwd. Fora do cwd
  // o portao nunca alcanca (relativoAoProjeto devolve null), entao sai da lista.
  // D49: o nome sai como esta no disco. A dobra de caixa da D45 mora no ponto de
  // comparacao (portao-escopo.js), e nao aqui: esta lista tem outro consumidor -
  // a varredura do /sworn:init - que mostra o nome do arquivo ao dono.
  function aoCwd(caminho) {
    if (pre === '') return caminho;
    return caminho.indexOf(pre) === 0 ? caminho.slice(pre.length) : null;
  }

  const arquivos = [];
  for (let i = 0; i < partes.length; i++) {
    const entrada = partes[i];
    if (entrada.length < 4) continue;
    const xy = entrada.slice(0, 2);
    const caminho = aoCwd(entrada.slice(3).replace(/\\/g, '/'));
    if (caminho) arquivos.push(caminho);
    // Renomeacao e copia trazem a origem no campo seguinte: os dois lados sao de outra frente.
    if (xy[0] === 'R' || xy[0] === 'C') {
      const origem = partes[++i];
      const origemRel = origem ? aoCwd(origem.replace(/\\/g, '/')) : null;
      if (origemRel) arquivos.push(origemRel);
    }
  }
  return arquivos;
}

/**
 * A5e (D793): os arquivos RASTREADOS que mudaram ou sumiram na arvore, relativos ao cwd, sem os nao rastreados.
 * So os que existem no HEAD contam (modificado, apagado, tipo trocado): o adicionado (A) nao tem o que restaurar, e a
 * renomeacao conta pela origem, que sumiu. `null` quando o git nao respondeu.
 */
function rastreadosMudados(cwd) {
  const r = mudancasRastreadas(cwd);
  return r && r.mudados;
}

/**
 * A4 (s369): a mesma leitura, com os arquivos em conflito de merge a parte (UU, AA, DD, AU, UA, DU, UD), que o
 * `rastreadosMudados` deixa de fora: restaurar um deles resolveria o merge. `{ mudados, conflitos }` ou `null`.
 */
function mudancasRastreadas(cwd) {
  if (!cwd) return null;
  const saida = correr(cwd, ['status', '--porcelain', '--untracked-files=no', '-z']);
  if (saida === null) return null;
  const pre = prefixo(cwd);
  if (pre === null) return null;
  const aoCwd = function (c) { return pre === '' ? c : (c.indexOf(pre) === 0 ? c.slice(pre.length) : null); };
  const partes = saida.split('\0').filter(function (p) { return p !== ''; });
  const mudados = [];
  const conflitos = [];
  for (let i = 0; i < partes.length; i++) {
    const entrada = partes[i];
    if (entrada.length < 4) continue;
    const xy = entrada.slice(0, 2);
    if (xy[0] === 'R' || xy[0] === 'C') {
      const origem = partes[++i];
      const o = origem ? aoCwd(origem.replace(/\\/g, '/')) : null;
      if (o && xy[0] === 'R') mudados.push(o);
      continue;
    }
    const c = aoCwd(entrada.slice(3).replace(/\\/g, '/'));
    if (/U/.test(xy) || xy === 'AA' || xy === 'DD') {
      if (c) conflitos.push(c);
      continue;
    }
    // adicionado no indice (A, mesmo mudado depois: AM, AD) nao existe no HEAD
    if (xy[0] === 'A' || !/[MDT]/.test(xy)) continue;
    if (c) mudados.push(c);
  }
  return { mudados: mudados, conflitos: conflitos };
}

// D118: `prefixo` passa a ser publico. O `preparar-revisao.js` (T12) precisa da mesma
// conversao "caminho relativo ao cwd -> caminho relativo a raiz do repositorio" que a
// D41 resolveu aqui: sem ela, `git show HEAD:<caminho>` rodado de uma subpasta nega
// arquivo que esta em HEAD. Exportar e aditivo - `modificados` nao muda.
/**
 * Os arquivos que o repositorio rastreia, relativos a RAIZ do repositorio.
 * `null` quando o git nao respondeu - e quem chama tem de tratar isso como
 * "nao sei", nunca como "nao ha nada".
 */
function rastreados(cwd) {
  if (!cwd) return null;
  const bruto = correr(cwd, ['ls-files']);
  if (bruto === null) return null;
  return bruto.split(/\r?\n/).filter(function (a) { return !!a; });
}

/**
 * A2 (D426): quando cada arquivo de `pasta` mudou pela ultima vez, segundo o HISTORICO (nao o mtime,
 * que um clone ou checkout zera para "agora"). UM processo git so: `git log --name-status` limitado a
 * `pasta`.
 * Devolve Map(caminho relativo ao cwd, em barra normal -> ms do commit), ou `null` quando o git nao
 * respondeu (ausente, fora de repo, timeout): "nao sei", nunca "nada mudou". `pasta` sem nenhum commit
 * (repositorio novo, ou pasta so criada agora num repositorio que tem commits em outros lugares) da Map
 * VAZIO, nao `null` (quem consome cai no mtime nos dois casos). `opcoes.falha` (objeto)
 * recebe `timeout: true` quando o `null` foi timeout (A2-14); `opcoes.timeout`/`opcoes.maxBuffer` vao ao `correr`.
 * Arquivo nao rastreado nao aparece no Map.
 * `-z` (A2-13): o git nao cita nome nenhum (aspas, tab, barra invertida, acento chegam como estao) e as
 * pecas vem separadas por NUL: `\x01<data>`, depois `\n<S>`, `<caminho>`, `<S>`, `<caminho>`... O cabecalho de
 * cada commit e \x01<data> (nao `@<data>`), e o caminho e SEMPRE a peca que segue uma letra de estado: nome
 * `@123` ou com caractere de controle nunca se confunde com cabecalho.
 * A data de um caminho e a MAIOR entre as suas mudancas (A2-15), nao a primeira que o log mostra: ordem
 * topologica, rebase e relogio torto desfazem "primeira = mais nova". Empate: vale a primeira vista.
 * A2-16: se a mudanca mais nova de um caminho e a DELECAO (`D`), ele sai do Map - apagado no git nao tem
 * "ultima mudanca", e o arquivo recriado sem commit leria a data do commit antigo; sem o caminho no Map o
 * consumidor usa o mtime. A delecao nunca da a data (era o que o `--diff-filter=d` garantia); `--no-renames`
 * faz o renomear virar `D` (nome antigo) + `A` (nome novo), sem o par de caminhos do estado `R`.
 * maxBuffer de 32 MiB: historico grande de .claude/skills passa de 1 MiB sem virar `null`.
 */
function ultimasMudancas(cwd, pasta, opcoes) {
  if (!cwd || !pasta) return null;
  const o = opcoes || {};
  const bruto = correr(cwd, ['log', '-z', '--relative', '--name-status', '--no-renames', '--format=%x01%ct', '--', pasta],
    { maxBuffer: o.maxBuffer || 32 * 1024 * 1024, timeout: o.timeout, falha: o.falha });
  if (bruto === null) return null;
  const achados = new Map(); // caminho -> { quando, apagado }
  const partes = bruto.split('\0');
  let quando = null;
  for (let i = 0; i < partes.length; i++) {
    const peca = partes[i].replace(/^\n+/, '');
    if (!peca) continue;
    const cab = /^\x01(\d+)$/.exec(peca);
    if (cab) { quando = Number(cab[1]) * 1000; continue; }
    if (!/^[A-Z]\d*$/.test(peca)) continue; // peca que nao e estado: ignora, sem consumir caminho
    const caminho = partes[++i];
    if (quando === null || !caminho) continue;
    const antes = achados.get(caminho);
    if (!antes || quando > antes.quando) achados.set(caminho, { quando: quando, apagado: peca[0] === 'D' });
  }
  const mapa = new Map();
  for (const [caminho, a] of achados) if (!a.apagado) mapa.set(caminho, a.quando);
  return mapa;
}

/**
 * D485 (s108): o diff do arquivo contra o HEAD, sem contexto (-U0), para medir a faixa da revisao. Devolve
 * { removidas, acrescentadas, blocos: [{ antigoIni, antigoQtd, novoIni, novoQtd }] }, ou null quando nao da para
 * medir (git que falha, binario, saida sem bloco): sem medida, a faixa e a completa. `:(literal)` para que um
 * nome com `*` ou `?` nao vire padrao; --ignore-cr-at-eol porque o identico tambem ignora o CRLF. `rel` e relativo
 * a `cwd`. Plano 091 (#1): saiu do preparar-revisao.js para o portao do commit medir a mesma faixa.
 */
function diffContraHead(cwd, rel) {
  const saida = correr(cwd, ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--ignore-cr-at-eol', '-U0',
    'HEAD', '--', ':(literal)' + rel], { timeout: 10000, maxBuffer: 64 * 1024 * 1024 });
  if (saida === null) return null;
  const blocos = [];
  const re = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;
  let m;
  while ((m = re.exec(saida)) !== null) {
    blocos.push({ antigoIni: Number(m[1]), antigoQtd: m[2] === undefined ? 1 : Number(m[2]),
      novoIni: Number(m[3]), novoQtd: m[4] === undefined ? 1 : Number(m[4]) });
  }
  if (blocos.length === 0 && saida.trim() !== '') return null;
  const soma = function (campo) { return blocos.reduce(function (t, b) { return t + b[campo]; }, 0); };
  return { removidas: soma('antigoQtd'), acrescentadas: soma('novoQtd'), blocos: blocos };
}

module.exports = { rodar, ok, SAIDA_PADRAO_BYTES, modificados, rastreadosMudados, mudancasRastreadas, prefixo, rastreados, ultimasMudancas, correr, prazoDoCorrer, diffContraHead };
