#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');
const io = require('./lib/io.js');
const caminho = require('./lib/caminho.js');
const estado = require('./lib/estado.js');
const config = require('./lib/config.js');
const glob = require('./lib/glob.js');
const texto = require('./lib/texto.js');
const veredito = require('./lib/veredito.js');

// 0.3.4, item 1 (D264, D287): o veredito do inspetor e gravado por hook, em vez de a mao.
// Dois pontos de entrada, porque o Claude Code entrega o relatorio do subagente por dois caminhos:
//   - SubagentStop: o relatorio e `last_assistant_message` (payload real medido no claude 2.1.258);
//   - PostToolUse de SubagentHandback: o relatorio e `tool_input.message` (formato da documentacao;
//     a partir da 2.1.271, no modo auto, o `last_assistant_message` traz so o texto de encerramento).
// NUNCA barra: sai sempre com 0 e nunca emite `decision` (no SubagentStop, `block` faria o inspetor
// continuar). NUNCA cala: o que nao foi gravado vira `systemMessage` com a causa. NUNCA sobrescreve.

const AGENTE = 'sworn:inspector';
// revisao/<id>/<n>/vereditos (formato novo) ou revisao/<n>/vereditos (formato da 0.3.0); D503 (E9): ou a 2a passada
// do pacote com referencia, <ronda>/invertida/vereditos.
const PASTA_DE_RONDA = /(?:^|\/)\.claude\/sworn\/revisao\/[^/]+(?:\/[^/]+)?(?:\/invertida)?\/vereditos$/i;

/** O nome do arquivo: a chave da lente. O titulo so vale quando as duas familias nao o dividem. */
// RV-02 (D422): a regra mora no veredito.js, que o apurar tambem usa para a chave de repeticao.
const chaveDaLente = veredito.chaveDaLente;

/** Tira o objeto JSON da mensagem: bloco de codigo, a mensagem inteira, ou do primeiro { ao ultimo }. */
function extrairJson(mensagem) {
  const candidatos = [];
  const cerca = /```[a-z]*\s*([\s\S]*?)```/gi;
  let m;
  while ((m = cerca.exec(mensagem)) !== null) candidatos.push(m[1]);
  candidatos.push(mensagem);
  const i = mensagem.indexOf('{');
  const f = mensagem.lastIndexOf('}');
  if (i !== -1 && f > i) candidatos.push(mensagem.slice(i, f + 1));
  for (const c of candidatos) {
    try {
      const obj = JSON.parse(c.trim());
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
    } catch (e) { /* proximo candidato */ }
  }
  return null;
}

function ehArquivo(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }
function ehPasta(p) { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }

/**
 * D287: a pasta vem do JSON do inspetor; so vale se for a `vereditos` de uma ronda de verdade.
 * F3-21: e de uma ronda DESTE projeto - dentro da raiz, e nao so com o nome certo e A.txt/B.txt ao lado.
 */
function pastaDaRonda(campo, raiz) {
  if (typeof campo !== 'string' || campo.trim() === '') {
    return { erro: 'o veredito nao traz o campo "vereditos" (a pasta da ronda que o briefing passou)' };
  }
  const abs = path.resolve(raiz, campo.trim());
  if (!PASTA_DE_RONDA.test(glob.normalizar(abs))) {
    return { erro: '"' + campo.trim() + '" nao e a pasta vereditos de uma ronda em .claude/sworn/revisao/' };
  }
  const dentro = glob.normalizar(path.relative(raiz, abs));
  if (dentro === '..' || dentro.startsWith('../') || path.isAbsolute(dentro)) {
    return { erro: '"' + campo.trim() + '" fica fora da pasta do projeto (' + raiz + '), entao nao e uma ronda deste projeto' };
  }
  // Pedido 12 (A3-05): a guarda acima e lexica; um link (ou junction) no caminho levaria o veredito para fora.
  if (!caminho.dentroPeloCaminhoReal(abs, raiz)) {
    return { erro: '"' + campo.trim() + '" passa por um link que leva para fora da pasta do projeto (' + raiz +
      '), entao nao gravo la' };
  }
  const ronda = path.dirname(abs);
  if (!ehArquivo(path.join(ronda, 'A.txt')) || !ehArquivo(path.join(ronda, 'B.txt'))) {
    return { erro: 'a pasta da ronda de "' + campo.trim() + '" nao tem A.txt e B.txt ao lado, entao nao parece uma ronda' };
  }
  if (!ehPasta(abs)) return { erro: 'a pasta vereditos da ronda "' + campo.trim() + '" nao existe' };
  // D503 (E9): a invertida/ so existe dentro de uma ronda com referencia; o R.txt diz que o pacote tem referencia, e
  // ai o veredito das duas passadas traz vsReferencia e lacunas.
  const naInvertida = path.basename(ronda).toLowerCase() === 'invertida';
  const daRonda = naInvertida ? path.dirname(ronda) : ronda;
  const comReferencia = ehArquivo(path.join(daRonda, 'R.txt'));
  // Plano 082 (p1-1): a 2a passada mora numa ronda numerada (revisao/<id>/<n>/invertida); "invertida" como ronda do
  // <id> (revisao/<id>/invertida) passava com R.txt no <id>, e o apurar so le rondas numeradas.
  const rondaNumerada = /^\d+$/.test(path.basename(daRonda));
  if (naInvertida && (!rondaNumerada || !comReferencia || !ehArquivo(path.join(daRonda, 'A.txt')) ||
      !ehArquivo(path.join(daRonda, 'B.txt')))) {
    return { erro: 'a pasta invertida de "' + campo.trim() + '" nao fica numa ronda com referencia (a pasta numerada ' +
      'da ronda, com A.txt, B.txt e R.txt), entao nao parece a 2a passada de uma ronda' };
  }
  return { pasta: abs, comReferencia: comReferencia };
}

/** O que fazer quando o hook nao gravou: o arquivo (ou o molde dele), como manda a skill revisar, Passo 2. */
function comoGravar(lente, destino) {
  const chave = lente ? chaveDaLente(lente) : null;
  const arquivo = (chave || '<lente>') + '.json';
  return 'Grave esta lente a mao: salve o JSON do inspetor como ' +
    (destino ? path.join(destino, arquivo) : '<pasta vereditos da ronda>/' + arquivo) + ' (skill revisar, Passo 2).';
}

function aviso(causa, lente, destino) {
  return 'sworn: nao gravei o veredito' + (lente ? ' da lente ' + lente : '') + ': ' + causa + '. ' + comoGravar(lente, destino);
}

/** F3-08: ja existe um veredito diferente na pasta: nao e caso de "gravar a mao", e de conferir qual dos dois vale. */
function avisoOutroConteudo(lente, arquivo) {
  return 'sworn: nao gravei o veredito da lente ' + lente + ': ja existe ' + lente + '.json com outro conteudo; nao sobrescrevi. ' +
    'Compare os dois (o arquivo e o JSON do inspetor) e apague o errado antes de gravar de novo: ' + arquivo + '.';
}

function semPasta(vd) {
  const copia = Object.assign({}, vd);
  delete copia.vereditos;
  return copia;
}

/**
 * Grava o veredito e devolve o aviso (texto), ou null quando gravou ou quando ja estava gravado igual.
 * F3-07: com `gravado` (objeto), o null vem com { lente, arquivo } preenchidos: o veredito esta no disco.
 */
function avisoDaGravacao(mensagem, raiz, gravado) {
  if (typeof mensagem !== 'string' || mensagem.trim() === '') return aviso('a resposta do inspetor veio vazia');
  const vd = extrairJson(mensagem);
  if (!vd) return aviso('nao achei o JSON do veredito na resposta do inspetor');
  const erros = veredito.errosDoVeredito(vd);
  if (erros.length) return aviso('veredito invalido (' + erros.join('; ') + ')', typeof vd.lente === 'string' ? vd.lente : null);
  const lente = chaveDaLente(vd.lente);
  if (!lente) return aviso('lente desconhecida: "' + String(vd.lente).slice(0, 60) + '"');
  const onde = pastaDaRonda(vd.vereditos, raiz);
  if (onde.erro) return aviso(onde.erro, lente);
  if (onde.comReferencia) {
    const daReferencia = veredito.errosDoVeredito(vd, { comReferencia: true });
    if (daReferencia.length) return aviso('veredito invalido (' + daReferencia.join('; ') + ')', lente, onde.pasta);
  }

  const arquivo = path.join(onde.pasta, lente + '.json');
  try {
    // wx: nunca por cima de arquivo que ja esta la, nem se dois inspetores chegarem juntos.
    fs.writeFileSync(arquivo, JSON.stringify(vd, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    if (gravado) { gravado.lente = lente; gravado.arquivo = arquivo; }
    return null;
  } catch (e) {
    if (!e || e.code !== 'EEXIST') return aviso('erro ao escrever ' + arquivo + ' (' + texto.causaDoErro(e) + ')', lente);
  }
  let atual;
  try { atual = JSON.parse(texto.semBom(fs.readFileSync(arquivo, 'utf8'))); } catch (e) {
    return aviso('ja existe ' + lente + '.json e nao consegui le-lo (' + texto.causaDoErro(e) + '); nao sobrescrevi', lente, onde.pasta);
  }
  if (util.isDeepStrictEqual(semPasta(atual), semPasta(vd))) {
    if (gravado) { gravado.lente = lente; gravado.arquivo = arquivo; }
    return null;
  }
  return avisoOutroConteudo(lente, arquivo);
}

/** Marca por inspetor, fora do estado da sessao (que tem lista fechada de campos) e fora de vereditos/. */
function marcaDoInspetor(e) {
  if (typeof e.agent_id !== 'string' || e.agent_id === '') return null;
  const limpo = function (s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, '-'); };
  const base = estado.caminhoSessao(e.session_id);
  return path.join(path.dirname(base), path.basename(base, '.json') + '.veredito-' + limpo(e.agent_id) + '.marca');
}

// Aviso de quando a marca do handback nao se grava: sem ela o SubagentStop nao sabe que o handback ja avisou.
// Pedido 12 (A3-04): quem le e o usuario, sem "marca" nem "subagente", e com o que fazer com a repeticao.
const MARCA_FALHOU = 'Este aviso pode se repetir quando o inspetor terminar (nao consegui guardar que ja avisei): ' +
  'a repeticao e o mesmo aviso, ignore-a.';

/** A lente do JSON da resposta, para o aviso de excecao; null quando a resposta nao se le. Nunca lanca. */
function lenteDaResposta(e) {
  try {
    const mensagem = texto.mensagemDoSubagente(e);
    const vd = typeof mensagem === 'string' ? extrairJson(mensagem) : null;
    return vd && typeof vd.lente === 'string' && vd.lente.trim() ? vd.lente.trim().slice(0, 60) : null;
  } catch (x) { return null; }
}

function tratar(e) {
  if (e.agent_type !== AGENTE) return null;
  if (e.hook_event_name !== 'SubagentStop' && e.hook_event_name !== 'PostToolUse') return null;
  // A2-16: a mesma forma estrita do texto.mensagemDoSubagente (o matcher do hooks.json ja garante o nome).
  if (e.hook_event_name === 'PostToolUse' && e.tool_name !== 'SubagentHandback') return null;
  const mensagem = texto.mensagemDoSubagente(e);

  const marca = marcaDoInspetor(e);
  // O handback vem antes do SubagentStop e ja tratou este inspetor (gravou, ou avisou): o
  // `last_assistant_message` desse caminho e so texto de encerramento, e avisar de novo seria ruido.
  if (e.hook_event_name === 'SubagentStop' && marca && fs.existsSync(marca)) return null;

  const raiz = config.raizDoProjeto(typeof e.cwd === 'string' && e.cwd ? e.cwd : process.cwd());
  const gravado = {};
  const resultado = avisoDaGravacao(mensagem, raiz, gravado);

  if (e.hook_event_name === 'PostToolUse' && marca) {
    try { fs.mkdirSync(path.dirname(marca), { recursive: true }); fs.writeFileSync(marca, '1', 'utf8'); } catch (x) {
      // so perde o silencio: o SubagentStop vai ler de novo. Se ha aviso, diz que ele pode vir duas vezes.
      if (resultado) return resultado + ' ' + MARCA_FALHOU;
      // F3-07 (D335): o handback GRAVOU e a marca nao se gravou: o SubagentStop vai ler o texto de
      // encerramento, nao achar JSON e avisar "nao achei o JSON". Diz agora, sem ler transcricao, que esse
      // aviso pode ser ignorado.
      if (gravado.lente) {
        return 'sworn: gravei o veredito da lente ' + gravado.lente + ' em ' +
          glob.normalizar(path.relative(raiz, gravado.arquivo)) + '. Se, quando o inspetor terminar, vier o ' +
          'aviso de que nao achou o JSON do veredito, ignore esse aviso: o veredito ja esta gravado (nao consegui ' +
          'guardar que este inspetor ja foi tratado).';
      }
    }
  }
  return resultado;
}

io.blindar(function () {
  io.lerEntrada(function (e) {
    let resultado;
    try { resultado = tratar(e); } catch (erro) {
      const lente = lenteDaResposta(e);
      resultado = 'sworn: nao consegui gravar o veredito ' +
        (lente ? 'da lente ' + lente : '(nao soube qual lente: a resposta do inspetor nao trazia um JSON legivel)') +
        ' - erro inesperado (' + (erro && erro.message) + '). ' + comoGravar(lente, null);
    }
    if (resultado) process.stderr.write(resultado + '\n');
    io.permitir(resultado ? { systemMessage: resultado } : undefined);
  });
});
