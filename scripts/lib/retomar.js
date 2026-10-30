'use strict';
const fs = require('node:fs');
const path = require('node:path');
const saude = require('./saude.js');
const volta = require('./volta.js');
const { milhar } = require('./medidor.js');
const { CLASSES_GENERICAS } = require('./sanitacao.js');

// Plano volta-resumo (D586, mock D588): ao segurar a volta a chat parado, o gancho monta um resumo do registro do
// chat (o transcript, uma linha JSON por entrada) por script, sem o Claude: custo zero no chat parado. O resumo NAO e
// o handoff do modelo (skills/handoff/SKILL.md): e a ponte barata para o chat novo, que o le e, se precisar, roda o
// /sworn:handoff ali. Texto fixo em ASCII, como os avisos de gancho (D532); o que veio do chat sai como veio.

const PEDIDOS = 5;
const RESPOSTAS = 3;
const ARQUIVOS = 20;
const CORTE_PEDIDO = 600;
const CORTE_RESPOSTA = 800;
const TETO = 10 * 1024;
// A cauda se le em blocos, de tras para frente, ate juntar o que o resumo mostra. O limite poe teto no tempo do
// gancho (timeout 10 s, hooks/hooks.json). Medido na T2 (s93) nos 637 transcripts da raiz: lidos inteiros, o mais
// lento levou 100 ms (13,6 MB); com este limite, o resumo inteiro (git e plano juntos) levou 71-87 ms nos de 7 a 19 MB.
const BLOCO = 1024 * 1024;
const LIMITE_DE_LEITURA = 8 * 1024 * 1024;
const PASTA = '.claude/sworn/handoff';
const OMITIDO = '[segredo omitido]';

// Blocos que o harness injeta na mensagem do dono: saem com o conteudo. O <pasted_content> e o que o dono colou:
// sai so a marca. O comando de barra fica pelo nome e pelos argumentos.
const INJETADOS = /<(system-reminder|browser_instruction|ide_selection|ide_opened_file|ide_diagnostics|command-message|local-command-stdout|local-command-stderr|local-command-caveat|task-notification|agent-message)\b[^>]*>[\s\S]*?<\/\1\s*[^>]*>/g;
const COLADO = /<\/?pasted_content\b[^>]*>/g;
const COMANDO = /<(command-name|command-args)>([\s\S]*?)<\/\1>/g;
const SEGREDO = new RegExp(CLASSES_GENERICAS.filter(function (c) { return c.chave === 'segredo'; })[0].padrao.source, 'g');
const RESUMO_DO_SWORN = /(^|[\\/])\d{4}-\d{2}-\d{2}-retomar-[^\\/]*\.md$/i;

function textoDoConteudo(c) {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter(function (b) { return b && b.type === 'text' && typeof b.text === 'string'; })
    .map(function (b) { return b.text; }).join('\n');
}

function limpar(texto) {
  return String(texto).replace(INJETADOS, ' ').replace(COLADO, ' ').replace(COMANDO, ' $2 ').replace(/\s+/g, ' ').trim();
}

/** Texto do dono nesta linha do registro, ou null. Mensagem direta ou digitada na fila com o Claude trabalhando. */
function pedidoDaLinha(o) {
  if (o.isSidechain === true) return null;
  let origem, bruto, horario = o.timestamp;
  if (o.type === 'user') {
    // A5-01: o resumo da compactacao e do harness (o mesmo filtro do calibracao.js), nao pedido do dono
    if (o.isMeta || o.isCompactSummary) return null;
    origem = o.origin;
    bruto = textoDoConteudo(o.message && o.message.content);
  } else if (o.type === 'attachment' && o.attachment && o.attachment.type === 'queued_command') {
    const a = o.attachment;
    if (a.isMeta || (a.commandMode && a.commandMode !== 'prompt')) return null;
    origem = a.origin;
    bruto = textoDoConteudo(a.prompt);
    horario = horario || a.timestamp;
  } else {
    return null;
  }
  // sem origem = registro antigo; com origem, so a humana (task-notification e peer sao do harness)
  if (origem && origem.kind !== 'human') return null;
  const texto = limpar(bruto);
  return texto ? { horario: Date.parse(horario), texto: texto } : null;
}

function cheio(acc) {
  return acc.pedidos.length >= PEDIDOS && acc.respostas.length >= RESPOSTAS && acc.arquivos.length >= ARQUIVOS;
}

// Uma linha, do mais novo para o mais velho. A resposta de um turno e o ultimo texto dele: o 1o que aparece de tras
// para frente depois de um pedido (acc.temResposta volta a false a cada pedido).
function processar(linha, acc) {
  if (!linha) return;
  let o;
  try { o = JSON.parse(linha); } catch (e) { return; }
  if (!o || typeof o !== 'object') return;
  const p = pedidoDaLinha(o);
  if (p) {
    if (acc.pedidos.length < PEDIDOS) acc.pedidos.push(p);
    acc.temResposta = false;
    return;
  }
  if (o.type !== 'assistant' || o.isSidechain === true || !o.message || !Array.isArray(o.message.content)) return;
  const blocos = o.message.content;
  for (let i = blocos.length - 1; i >= 0; i--) {
    const b = blocos[i];
    if (!b) continue;
    if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
      if (!acc.temResposta && acc.respostas.length < RESPOSTAS) {
        acc.respostas.push({ horario: Date.parse(o.timestamp), texto: b.text.replace(/\s+/g, ' ').trim() });
      }
      acc.temResposta = true;
    } else if (b.type === 'tool_use' && /^(Edit|Write|NotebookEdit|MultiEdit)$/.test(b.name) && b.input) {
      const alvo = b.input.file_path || b.input.notebook_path;
      if (typeof alvo !== 'string' || !alvo) continue;
      if (acc.arquivos.length < ARQUIVOS && acc.arquivos.indexOf(alvo) === -1) acc.arquivos.push(alvo);
      if (!acc.handoff && saude.ehArquivoDeHandoff(alvo) && !RESUMO_DO_SWORN.test(alvo)) {
        acc.handoff = { caminho: alvo, horario: Date.parse(o.timestamp) };
      }
    }
  }
}

/**
 * Le o registro do chat de tras para frente, em blocos, ate juntar 5 pedidos, 3 respostas e 20 arquivos, ou ate o
 * limite de leitura. A fronteira do bloco cai em qualquer byte: so linha inteira e decodificada (o \n nunca aparece
 * dentro de um caractere UTF-8), e o pedaco de cima vai junto com o bloco anterior. Sem leitura: null.
 * `opcoes.bloco` e `opcoes.limite` existem para o teste.
 */
function lerRegistro(caminho, opcoes) {
  if (typeof caminho !== 'string' || !caminho) return null;
  const bloco = (opcoes && opcoes.bloco) || BLOCO;
  const limite = (opcoes && opcoes.limite) || LIMITE_DE_LEITURA;
  const acc = { pedidos: [], respostas: [], arquivos: [], handoff: null, temResposta: false };
  let fd;
  try { fd = fs.openSync(caminho, 'r'); } catch (e) { return null; }
  try {
    let pos = fs.fstatSync(fd).size;
    let lido = 0;
    let resto = Buffer.alloc(0);
    while (pos > 0 && lido < limite && !cheio(acc)) {
      const n = Math.min(bloco, pos, limite - lido);
      pos -= n;
      lido += n;
      const buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, pos);
      const junto = Buffer.concat([buf, resto]);
      let inicio = 0;
      if (pos > 0) {
        const nl = junto.indexOf(10);
        if (nl === -1) { resto = junto; continue; }
        resto = junto.subarray(0, nl);
        inicio = nl + 1;
      }
      const linhas = junto.subarray(inicio).toString('utf8').split('\n');
      for (let i = linhas.length - 1; i >= 0 && !cheio(acc); i--) processar(linhas[i], acc);
    }
  } catch (e) {
    return null;
  } finally {
    fs.closeSync(fd);
  }
  return { pedidos: acc.pedidos, respostas: acc.respostas, arquivos: acc.arquivos, handoff: acc.handoff };
}

function doisDigitos(n) { return String(n).padStart(2, '0'); }
function dia(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + doisDigitos(d.getMonth() + 1) + '-' + doisDigitos(d.getDate());
}
function hora(ms) {
  if (!isFinite(ms)) return '--:--';
  const d = new Date(ms);
  return doisDigitos(d.getHours()) + ':' + doisDigitos(d.getMinutes());
}

function mascarar(texto) { return String(texto).replace(SEGREDO, OMITIDO); }

/** Corta em `max` caracteres com "..." no fim, sem partir um emoji (par substituto) ao meio. */
function cortar(texto, max) {
  if (texto.length <= max) return texto;
  let corte = max - 3;
  if (/[\uD800-\uDBFF]/.test(texto.charAt(corte - 1))) corte--;
  return texto.slice(0, corte) + '...';
}

/** Dentro da raiz, relativo e com barra normal; fora (ou ilegivel), como veio. */
function relativo(raiz, caminho) {
  try {
    const rel = path.relative(raiz, caminho);
    if (!rel || rel.split(/[\\/]/)[0] === '..' || path.isAbsolute(rel)) return caminho;
    return rel.replace(/\\/g, '/');
  } catch (e) { return caminho; }
}

function lista(itens, max, vazio) {
  if (!itens.length) return [vazio];
  return itens.map(function (it, i) { return (i + 1) + '. (' + hora(it.horario) + ') ' + cortar(mascarar(it.texto), max); });
}

function ondeParou(d) {
  const reg = d.registro;
  const linhas = [];
  if (d.frente) {
    // Objetivo longo (nota de sessao a cada chat): a parte nova fica no fim.
    const obj = d.objetivo ? String(d.objetivo).replace(/\s+/g, ' ').trim() : '';
    linhas.push('Frente: ' + d.frente + '.' + (obj ? ' Objetivo: ' + (obj.length > 400 ? '...' + obj.slice(-397) : obj) : ''));
  } else {
    linhas.push('Frente: nenhuma vinculada a este chat.');
  }
  linhas.push(d.plano ? 'Plano: ' + d.plano : 'Plano: nenhum lido.');
  linhas.push(reg.handoff ? 'Ultimo handoff do modelo: ' + relativo(d.raiz, reg.handoff.caminho) + ' (' + hora(reg.handoff.horario) + ').'
    : 'Ultimo handoff do modelo: nenhum neste chat.');
  if (d.git && d.git.head) {
    const mod = d.git.modificados || [];
    const mostra = mod.slice(0, 10).join(', ') + (mod.length > 10 ? ' e mais ' + (mod.length - 10) : '');
    linhas.push('Raiz: ' + (d.git.ramo ? d.git.ramo + ' ' : '') + d.git.head + '; ' +
      (mod.length ? 'modificados: ' + mostra + '.' : 'nada modificado.'));
  } else {
    linhas.push('Raiz: git nao lido.');
  }
  return linhas;
}

function juntar(d, arquivos) {
  const v = d.volta || {};
  const conta = [];
  if (typeof v.parado === 'number') conta.push('parado ' + volta.duracao(v.parado));
  if (typeof v.contexto === 'number') conta.push(milhar(Math.floor(v.contexto / 1000)) + ' mil tokens');
  if (v.modelo) conta.push(String(volta.nomeDoModelo(v.modelo)));
  const reg = d.registro;
  return [
    '# Resumo para retomar o chat ' + String(d.sessao).slice(0, 8),
    '',
    'Gerado pelo sworn em ' + dia(d.agora) + ' ' + hora(d.agora) + ', ao segurar a volta' +
      (conta.length ? ' (' + conta.join('; ') + ')' : '') +
      '. Montado por script a partir do registro do chat: nao e o handoff do modelo.',
    '',
    '## Onde parou'
  ].concat(ondeParou(d), [
    '',
    '## Seus ultimos pedidos (do mais novo)'
  ], lista(reg.pedidos, CORTE_PEDIDO, '(nenhum pedido no trecho lido)'), [
    '',
    '## Ultimas respostas do Claude (do mais novo)'
  ], lista(reg.respostas, CORTE_RESPOSTA, '(nenhuma resposta de texto no trecho lido)'), [
    '',
    '## Arquivos mexidos (os ultimos)'
  ], arquivos.length ? arquivos.map(function (a) { return relativo(d.raiz, a); }) : ['(nenhum arquivo mexido no trecho lido)'], [
    '',
    '## Para o chat novo',
    // A5-22 (D735): o que abrir e como comparar.
    'Antes de agir, confira se isto ainda vale: abra o plano e o ultimo handoff citados em "Onde parou" (se houver)',
    'e compare a lista de modificados com a de agora (git status). Este resumo copia a conversa; ele nao confere nada.',
    'Se precisar de handoff completo, rode /sworn:handoff.',
    ''
  ]).join('\n');
}

/**
 * O texto do resumo (mock D588). Acima do teto de 10 KB, os arquivos mais velhos saem primeiro; se ainda nao couber,
 * corta no fim e diz.
 */
function montar(d) {
  const arquivos = (d.registro.arquivos || []).slice();
  let texto = mascarar(juntar(d, arquivos));
  while (Buffer.byteLength(texto, 'utf8') > TETO && arquivos.length) {
    arquivos.pop();
    texto = mascarar(juntar(d, arquivos));
  }
  if (Buffer.byteLength(texto, 'utf8') > TETO) {
    const aviso = '\n... (cortado no teto de 10 KB)\n';
    texto = Buffer.from(texto, 'utf8').subarray(0, TETO - Buffer.byteLength(aviso)).toString('utf8').replace(/�$/, '') + aviso;
  }
  return texto;
}

/** Grava em .claude/sworn/handoff/AAAA-MM-DD-retomar-<8 do id>.md: o mesmo chat no mesmo dia regrava o mesmo arquivo. */
function gravar(raiz, sessao, agora, texto) {
  const id = String(sessao == null ? '' : sessao).slice(0, 8);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('id de sessao invalido para nome de arquivo');
  const rel = PASTA + '/' + dia(agora) + '-retomar-' + id + '.md';
  fs.mkdirSync(path.join(raiz, PASTA), { recursive: true });
  fs.writeFileSync(path.join(raiz, rel), texto);
  return rel;
}

function gitDaRaiz(raiz) {
  const git = require('./git.js');
  const op = { timeout: 2000 };
  const head = git.correr(raiz, ['rev-parse', '--short', 'HEAD'], op);
  if (head === null) return null;
  const ramo = git.correr(raiz, ['rev-parse', '--abbrev-ref', 'HEAD'], op);
  const status = git.correr(raiz, ['status', '--short'], op);
  return {
    head: head.trim(), ramo: ramo === null ? '' : ramo.trim(),
    modificados: status === null ? [] : status.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean)
  };
}

/**
 * Le o registro, monta e grava. `o` = { raiz, sessao, transcript, frente, agora, volta } (volta = o que o
 * volta.avaliar devolveu). Devolve { caminho, chat (8 do id), handoff } (handoff = { caminho, emDia } ou null; em dia = gravado
 * depois do ultimo pedido do dono) ou null quando nao da: registro ilegivel, sem pedido, ou falha ao gravar.
 */
function resumir(o) {
  try {
    const reg = lerRegistro(o.transcript);
    if (!reg || !reg.pedidos.length) return null;
    let objetivo = '';
    if (o.frente) {
      const esc = require('./escopo.js').carregar(o.raiz, o.frente);
      objetivo = esc && esc.objetivo ? esc.objetivo : '';
    }
    const plano = require('./plano.js').linhaDoPlanoDaSessao(o.raiz, o.frente || null);
    const texto = montar({ sessao: o.sessao, agora: o.agora, raiz: o.raiz, volta: o.volta, registro: reg,
      frente: o.frente || null, objetivo: objetivo, plano: plano, git: gitDaRaiz(o.raiz) });
    const caminho = gravar(o.raiz, o.sessao, o.agora, texto);
    const h = reg.handoff;
    return { caminho: caminho, chat: String(o.sessao).slice(0, 8),
      handoff: h ? { caminho: relativo(o.raiz, h.caminho), emDia: h.horario > reg.pedidos[0].horario } : null };
  } catch (e) {
    return null;
  }
}

// Colheita 10-20, item 13 (D674): quem leu cada handoff por ultimo, por projeto. A posse vence em 24 h: depois disso o
// handoff velho volta a ser de quem o pegar, sem aviso.
const DONOS = '.claude/sworn/handoff-donos.json';
const POSSE_MS = 24 * 60 * 60 * 1000;

/**
 * Marca a sessao (8 primeiros do id) como dona do handoff que ela leu e devolve o aviso quando outra sessao o leu ha
 * menos de 24 h; senao null. A posse passa a quem leu por ultimo: a outra, se ler de novo, tambem e avisada. Projeto
 * sem .claude/sworn/ = null, sem gravar. Arquivo de donos torto recomeca vazio. Erro de disco lanca (o gancho cala).
 */
function reclamar(raiz, arquivo, sessao, agora) {
  if (!fs.existsSync(path.join(raiz, '.claude', 'sworn'))) return null;
  const rel = relativo(raiz, arquivo);
  const id = String(sessao == null ? '' : sessao).slice(0, 8);
  let donos = {};
  try { donos = JSON.parse(fs.readFileSync(path.join(raiz, DONOS), 'utf8')); } catch (e) { donos = {}; }
  if (!donos || typeof donos !== 'object' || Array.isArray(donos)) donos = {};
  const antes = donos[rel];
  donos[rel] = { sessao: id, em: agora };
  fs.writeFileSync(path.join(raiz, DONOS), JSON.stringify(donos, null, 2) + '\n');
  if (!antes || typeof antes !== 'object' || antes.sessao === id || typeof antes.em !== 'number' ||
      agora - antes.em >= POSSE_MS) return null;
  const min = Math.max(0, Math.round((agora - antes.em) / 60000));
  // A5-21 (D735): sem "posse" nem "sessao"; quem confirma e o usuario.
  return 'sworn: o handoff ' + rel + ' (o arquivo de continuacao) ja foi lido por outro chat (id ' +
    String(antes.sessao).replace(/[^A-Za-z0-9_-]/g, '') + ') as ' + hora(antes.em) + ' (ha ' + min + ' min). ' +
    'Dois chats no mesmo handoff fazem o trabalho duas vezes: antes de agir, pergunte ao usuario qual dos dois chats ' +
    'segue. O sworn marca este chat como o ultimo a ler; o outro recebe este mesmo aviso se ler o arquivo de novo.';
}

module.exports = { PASTA, lerRegistro, montar, gravar, resumir, limpar, mascarar, cortar, reclamar };
