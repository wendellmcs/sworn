'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { blocos } = require('./diff-linhas.js');

// V6 (D847): o /sworn-replay. O mod (hooks/mods.tsx) chama scripts/replay.js antes e depois de cada edicao das
// ferramentas de edicao do Claude (Edit, Write, MultiEdit, NotebookEdit; tambem as dos subagentes); este modulo
// guarda a copia do arquivo de antes (a 1a do turno) e a de depois (a ultima) na pasta temporaria do sworn, so nesta
// maquina (pedido 7), e escreve o texto do comando: por arquivo, as linhas de antes (-) e as de depois (+).
// Guarda so o ultimo turno do agente principal que editou: o turno novo que edita apaga as copias do anterior.
// O indice.json e lido, mudado e regravado sem trava: o mod chama uma copia por vez por sessao (a fila filaReplay),
// e e ele o unico que chama --guardar. Dois processos guardando ao mesmo tempo na mesma sessao perderiam um item.

/** Arquivo maior que isto nao se copia: o replay diz que ficou grande demais. */
const MAX_BYTES = 1000000;
/** Arquivos guardados por turno; o que passar disso so entra na contagem dos de fora. */
const MAX_ARQUIVOS = 200;
/** Linhas mudadas que o texto mostra por arquivo e no total; a linha longa sai cortada neste tamanho. */
const MAX_LINHAS_ARQUIVO = 80;
const MAX_LINHAS = 300;
const MAX_COLUNAS = 160;
/** A pasta da sessao que ficou sem uso ha mais que isto sai na proxima vez que um turno novo edita. */
const IDADE_MS = 7 * 24 * 60 * 60 * 1000;

function raiz() {
  return path.join(process.env.SWORN_TMP || os.tmpdir(), 'sworn', 'replay');
}

/** A pasta da sessao: o id vira nome seguro, sem '..' nem barra (como o estado.js). */
function pastaDaSessao(sessao) {
  return path.join(raiz(), String(sessao || 'sem-sessao').replace(/[^a-zA-Z0-9_-]/g, '-'));
}

/** O mesmo arquivo com outra grafia (no Windows, maiuscula ou barra) e o mesmo item. */
function chave(caminho) {
  const c = path.resolve(caminho);
  return process.platform === 'win32' ? c.toLowerCase() : c;
}

/** O indice da pasta, so com os itens validos (o torto, editado a mao ou de versao velha, sai); null sem indice. */
function lerIndice(pasta) {
  try {
    const i = JSON.parse(fs.readFileSync(path.join(pasta, 'indice.json'), 'utf8'));
    if (i && typeof i.turno === 'string' && Array.isArray(i.arquivos)) {
      i.arquivos = i.arquivos.filter(function (a) {
        return a && typeof a === 'object' && typeof a.chave === 'string' && typeof a.caminho === 'string' &&
          Number.isInteger(a.n) && a.n >= 0;
      });
      return i;
    }
  } catch (e) {}
  return null;
}

// As copias podem ter segredo (um .env editado): a pasta so o dono le (0700) e cada arquivo tambem (0600). No Windows
// a pasta temporaria ja e do usuario e o modo nao vale.
const MODO_PASTA = 0o700;
const MODO_ARQUIVO = 0o600;

/**
 * Confere as pastas que o sworn cria na temporaria (sworn, sworn/replay e a da sessao): cada uma e pasta de verdade
 * (nunca um link) e, fora do Windows, do mesmo usuario. Outro usuario da maquina pode criar o nome antes: com um link
 * no lugar, a copia iria para onde ele quer e a limpeza das velhas apagaria fora da temporaria. Falha: excecao.
 */
function conferirPasta(pasta) {
  for (const p of [path.dirname(raiz()), raiz(), pasta]) {
    const st = fs.lstatSync(p);
    if (!st.isDirectory()) throw new Error('não é uma pasta: ' + p);
    if (process.platform !== 'win32' && typeof process.getuid === 'function' && st.uid !== process.getuid()) {
      throw new Error('é de outro usuário: ' + p);
    }
  }
}

/** Cria a pasta da sessao so para o dono (0700) e a confere. */
function prepararPasta(pasta) {
  fs.mkdirSync(pasta, { recursive: true, mode: MODO_PASTA });
  conferirPasta(pasta);
  if (process.platform !== 'win32') fs.chmodSync(pasta, MODO_PASTA);
}

function gravarIndice(pasta, indice) {
  const alvo = path.join(pasta, 'indice.json');
  const tmp = alvo + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(indice), { mode: MODO_ARQUIVO });
  fs.renameSync(tmp, alvo);
}

function apagar(arquivo) {
  try { fs.unlinkSync(arquivo); } catch (e) {}
}

/** As copias e o indice pela metade que o sworn grava nesta pasta (o nome, nunca o que o indice diz). */
const DO_REPLAY = /^(\d+\.(antes|depois)|indice\.json\.\d+\.tmp)$/;

/**
 * Apaga as copias do turno anterior: todo arquivo desta pasta com o nome das copias, tambem as que o indice torto ou
 * quebrado nao nomeia mais (o indice e dado; o nome e o que o sworn grava).
 */
function esvaziar(pasta) {
  let nomes = [];
  try { nomes = fs.readdirSync(pasta); } catch (e) { return; }
  for (const f of nomes) if (DO_REPLAY.test(f)) apagar(path.join(pasta, f));
}

/**
 * As pastas de outras sessoes sem uso ha IDADE_MS saem: so os arquivos com o nome dos do replay e, vazia, a pasta
 * (um arquivo de outro nome fica, e a pasta com ele tambem).
 */
function limparVelhas(atual, agora) {
  let nomes = [];
  try { nomes = fs.readdirSync(raiz(), { withFileTypes: true }); } catch (e) { return; }
  for (const d of nomes) {
    if (!d.isDirectory()) continue;
    const pasta = path.join(raiz(), d.name);
    if (pasta === atual) continue;
    try {
      if (agora - fs.statSync(path.join(pasta, 'indice.json')).mtimeMs < IDADE_MS) continue;
    } catch (e) {
      try { if (agora - fs.statSync(pasta).mtimeMs < IDADE_MS) continue; } catch (e2) { continue; }
    }
    esvaziar(pasta);
    apagar(path.join(pasta, 'indice.json'));
    try { fs.rmdirSync(pasta); } catch (e) {}
  }
}

/**
 * Copia `origem` para `destino` e diz o que achou: 'texto', 'ausente', 'outro' (uma pasta ou outra coisa que nao e
 * arquivo), 'grande', 'binario' ou 'falhou' (sem permissao de ler, disco cheio: nunca uma excecao).
 */
function copiar(origem, destino) {
  let st;
  try { st = fs.statSync(origem); } catch (e) { return 'ausente'; }
  if (!st.isFile()) return 'outro';
  if (st.size > MAX_BYTES) return 'grande';
  try {
    const buf = fs.readFileSync(origem);
    if (buf.includes(0)) return 'binario';
    fs.writeFileSync(destino, buf, { mode: MODO_ARQUIVO });
    return 'texto';
  } catch (e) {
    apagar(destino);
    return 'falhou';
  }
}

/**
 * Guarda a copia de `caminho` na fase 'antes' (a 1a deste turno; turno novo apaga o anterior) ou 'depois' (a ultima,
 * so para o arquivo que ja tem o antes deste turno). A fase 'descartar' (a edicao recusada ou com erro) tira o item
 * que ainda nao tem o depois e apaga a copia de antes dele: a edicao que nao rodou nao deixa copia. Devolve o que fez:
 * 'guardou', 'descartou', 'ja-tinha', 'fora' ou 'ignorou'.
 */
function guardar(sessao, turno, fase, caminho, agora) {
  if (typeof turno !== 'string' || !turno || typeof caminho !== 'string' || !caminho) return 'ignorou';
  if (fase !== 'antes' && fase !== 'depois' && fase !== 'descartar') return 'ignorou';
  const t = Number.isFinite(agora) ? agora : Date.now();
  const pasta = pastaDaSessao(sessao);
  let indice = lerIndice(pasta);
  const k = chave(caminho);
  if (fase === 'antes') {
    prepararPasta(pasta);
    if (!indice || indice.turno !== turno) {
      esvaziar(pasta);
      indice = { turno: turno, em: t, arquivos: [], fora: 0 };
      limparVelhas(pasta, t);
    }
    if (indice.arquivos.some(function (a) { return a.chave === k; })) return 'ja-tinha';
    if (indice.arquivos.length >= MAX_ARQUIVOS) {
      indice.fora = (Number.isInteger(indice.fora) ? indice.fora : 0) + 1;
      gravarIndice(pasta, indice);
      return 'fora';
    }
    // o numero novo vem depois do maior que o indice ainda nomeia: o item que o 'descartar' tirou do meio da lista
    // nao faz o seguinte cair no numero de outro
    const n = indice.arquivos.reduce(function (m, a) { return Math.max(m, a.n + 1); }, 0);
    indice.arquivos.push({ chave: k, caminho: path.resolve(caminho), n: n,
      antes: copiar(caminho, path.join(pasta, n + '.antes')), depois: null });
  } else if (fase === 'descartar') {
    if (!indice || indice.turno !== turno) return 'ignorou';
    // so o item sem depois: o arquivo que outra edicao deste turno ja mudou guarda o antes dela
    const i = indice.arquivos.findIndex(function (a) { return a.chave === k && a.depois === null; });
    if (i < 0) return 'ignorou';
    conferirPasta(pasta);
    apagar(path.join(pasta, indice.arquivos[i].n + '.antes'));
    indice.arquivos.splice(i, 1);
    indice.recusadas = (Number.isInteger(indice.recusadas) ? indice.recusadas : 0) + 1;
    indice.em = t;
    gravarIndice(pasta, indice);
    return 'descartou';
  } else {
    if (!indice || indice.turno !== turno) return 'ignorou';
    const item = indice.arquivos.find(function (a) { return a.chave === k; });
    if (!item) return 'ignorou';
    prepararPasta(pasta);
    item.depois = copiar(caminho, path.join(pasta, item.n + '.depois'));
  }
  indice.em = t;
  gravarIndice(pasta, indice);
  return 'guardou';
}

/**
 * O ultimo turno guardado da sessao: { em, fora, recusadas, arquivos: [{ caminho, antes, depois, textoAntes,
 * textoDepois }] }.
 */
function ler(sessao) {
  const pasta = pastaDaSessao(sessao);
  // a pasta de outro usuario (ou um link) nao e lida: o indice dela mostraria o que ele quisesse
  try { conferirPasta(pasta); } catch (e) { return null; }
  const indice = lerIndice(pasta);
  if (!indice) return null;
  const lerTexto = function (n, fase) {
    try { return fs.readFileSync(path.join(pasta, n + '.' + fase), 'utf8'); } catch (e) { return null; }
  };
  return { em: indice.em, fora: Number.isInteger(indice.fora) ? indice.fora : 0,
    recusadas: Number.isInteger(indice.recusadas) ? indice.recusadas : 0,
    arquivos: indice.arquivos.map(function (a) {
      return { caminho: a.caminho, antes: a.antes, depois: a.depois,
        textoAntes: a.antes === 'texto' ? lerTexto(a.n, 'antes') : null,
        textoDepois: a.depois === 'texto' ? lerTexto(a.n, 'depois') : null };
    }) };
}

/**
 * A linha no texto do chat: sem caractere de controle (nada de escape de terminal) nem de direcao do texto (o que
 * vira a linha do avesso na tela, como no "Trojan Source") nem de quebra de linha Unicode; tab como dois espacos;
 * cortada sem partir um caractere em dois (a metade do emoji no ponto do corte sai junto).
 */
function limpa(s) {
  const t = String(s).replace(/\t/g, '  ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, '?');
  if (t.length <= MAX_COLUNAS) return t;
  const cortado = t.slice(0, MAX_COLUNAS - 1);
  return cortado.replace(/[\ud800-\udbff]$/, '') + '…';
}

function nome(caminho, cwd) {
  if (typeof cwd === 'string' && cwd) {
    const rel = path.relative(cwd, caminho);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return limpa(rel.split(path.sep).join('/'));
  }
  return limpa(caminho);
}

function linhas(texto) {
  return texto === '' ? [] : texto.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
}

function plural(n, um, varios) {
  return n + ' ' + (n === 1 ? um : varios);
}

/** O que dizer de um arquivo que nao da para mostrar linha por linha; null quando da. */
function semLinhas(a) {
  if (a.depois === null || a.depois === undefined) return 'a edição não terminou (recusada ou com erro): nada mudou.';
  if (a.antes === 'falhou' || a.depois === 'falhou') {
    return 'o sworn não conseguiu copiar o arquivo (sem permissão de leitura, ou o disco cheio): abra-o para ver ' +
      'como ele ficou.';
  }
  if (a.antes === 'grande' || a.depois === 'grande') {
    return 'grande demais para mostrar (mais de ' + MAX_BYTES / 1000000 + ' MB): abra-o para ver como ele ficou.';
  }
  if (a.antes === 'binario' || a.depois === 'binario') return 'arquivo binário: não tem linhas para mostrar.';
  if (a.antes === 'outro' || a.depois === 'outro') return 'não é um arquivo (é uma pasta): não tem linhas para mostrar.';
  if (a.depois === 'ausente') return 'o arquivo não existe mais depois da edição.';
  // daqui em diante o depois tem de ser texto lido, e o antes, texto lido ou o arquivo novo (o resto e indice torto)
  const antesOk = a.antes === 'ausente' || (a.antes === 'texto' && typeof a.textoAntes === 'string');
  if (!antesOk || a.depois !== 'texto' || typeof a.textoDepois !== 'string') {
    return 'a cópia guardada sumiu da pasta temporária (o sistema pode tê-la limpado): o arquivo segue onde estava; ' +
      'abra-o para ver como ele ficou.';
  }
  return null;
}

/** O texto do /sworn-replay: o ultimo turno que editou, por arquivo, as linhas de antes (-) e de depois (+). */
function texto(lido, agora, cwd) {
  if (lido && !lido.arquivos.length && !lido.fora && lido.recusadas > 0) {
    // o indice sem item porque o 'descartar' tirou cada um: as edicoes do turno foram recusadas ou deram erro
    return 'O último turno com edição não mudou nenhum arquivo: as edições dele foram recusadas ou deram erro.';
  }
  if (!lido || !lido.arquivos.length) {
    return 'Nenhum arquivo editado nesta sessão ainda. O /sworn-replay mostra, linha por linha, o que o último turno ' +
      'com edição mudou em cada arquivo.';
  }
  const ha = Number.isFinite(agora) && Number.isFinite(lido.em) && agora >= lido.em
    ? ' (há ' + (agora - lido.em < 60000 ? 'menos de 1 min' : Math.floor((agora - lido.em) / 60000) + ' min') + ')' : '';
  const total = lido.arquivos.length + lido.fora;
  const saida = ['Edições do último turno que mexeu em arquivos' + ha + ': ' +
    plural(total, 'arquivo', 'arquivos') + '.', ''];
  let mostradas = 0;
  let cortouTotal = false;
  for (const a of lido.arquivos) {
    const n = nome(a.caminho, cwd);
    const aviso = semLinhas(a);
    if (aviso) { saida.push(n + ': ' + aviso, ''); continue; }
    const novo = a.antes === 'ausente';
    const de = linhas(novo ? '' : a.textoAntes);
    const para = linhas(a.textoDepois);
    const bs = blocos(de, para);
    if (!bs.length) {
      // as linhas sao as mesmas; o texto inteiro, nao: mudou so o fim de linha (CRLF e LF) ou a quebra no fim
      const igual = novo ? 'arquivo novo, vazio.'
        : a.textoAntes !== a.textoDepois ? 'mudou só o fim de linha (CRLF e LF, ou a quebra de linha no fim do arquivo).'
          : 'sem mudança no fim do turno (o que foi editado voltou a ser o que era).';
      saida.push(n + ': ' + igual, '');
      continue;
    }
    const mais = bs.reduce(function (s, b) { return s + b.novoQtd; }, 0);
    const menos = bs.reduce(function (s, b) { return s + b.antigoQtd; }, 0);
    saida.push(n + ' (' + (novo ? 'arquivo novo, ' : '') + '+' + mais + (novo ? '' : ' -' + menos) + ')');
    if (cortouTotal) {
      saida.push('  (as linhas ficaram de fora: o texto chegou a ' + MAX_LINHAS + ' linhas; abra o arquivo para ver)', '');
      continue;
    }
    let doArquivo = 0;
    let faltam = mais + menos;
    for (const b of bs) {
      if (doArquivo >= MAX_LINHAS_ARQUIVO || mostradas >= MAX_LINHAS) break;
      // o numero e o da linha de depois; no bloco so de remocao, o da de antes (a linha nao existe mais)
      saida.push(b.novoQtd ? '  linha ' + b.novoIni + ':' : '  linha ' + b.antigoIni + ' de antes:');
      const trecho = [];
      for (let i = 0; i < b.antigoQtd; i++) trecho.push('  - ' + limpa(de[b.antigoIni - 1 + i]));
      for (let i = 0; i < b.novoQtd; i++) trecho.push('  + ' + limpa(para[b.novoIni - 1 + i]));
      for (const l of trecho) {
        if (doArquivo >= MAX_LINHAS_ARQUIVO || mostradas >= MAX_LINHAS) break;
        saida.push(l);
        doArquivo++; mostradas++; faltam--;
      }
    }
    if (faltam > 0) saida.push('  ... mais ' + plural(faltam, 'linha mudada', 'linhas mudadas') + ' neste arquivo: abra-o para ver.');
    if (mostradas >= MAX_LINHAS) cortouTotal = true;
    saida.push('');
  }
  if (lido.fora) {
    saida.push(plural(lido.fora, 'arquivo ficou', 'arquivos ficaram') + ' de fora: o /sworn-replay guarda até ' +
      MAX_ARQUIVOS + ' por turno (no projeto com git, o git diff mostra todos).', '');
  }
  saida.push('Só entram as edições das ferramentas de edição do Claude (Edit, Write, MultiEdit e NotebookEdit), ' +
    'também as dos subagentes; o que o shell mudou não aparece. O antes e o depois ficam só nesta máquina, na pasta ' +
    'temporária do sworn.');
  return saida.join('\n');
}

module.exports = { MAX_BYTES, MAX_ARQUIVOS, MAX_LINHAS_ARQUIVO, MAX_LINHAS, MAX_COLUNAS, IDADE_MS, pastaDaSessao,
  guardar, ler, texto };
