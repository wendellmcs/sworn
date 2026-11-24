#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const planoLib = require('./lib/plano.js');
const estado = require('./lib/estado.js');
const flags = require('./lib/flags.js');

const USO = 'uso: plano.js [--abrir <caminho do plano>] [--proxima-decisao <arquivo de decisoes>] [--texto] ' +
  '[--sessao <id>] [--fatia [<id do item>] [--plano <caminho do plano>]]\n';
const FLAGS_DO_USO = ['--abrir', '--proxima-decisao', '--texto', '--sessao', '--fatia', '--plano'];

// A7 (pedido 12, R1 :14/:15): flag sem valor (ultima da linha, vazia ou seguida de outra flag do USO) caia calada no
// painel ou no JSON. O molde e o arg() do gerar-skill.js.
function arg(nome) {
  return flags.valor(process.argv, '--' + nome, FLAGS_DO_USO, function (msg) {
    process.stderr.write('ERRO: ' + msg + '\n' + USO);
    process.exit(1);
  });
}

// A6-15/A7-06: da subpasta, a raiz do projeto (a pasta com .claude/sworn/projeto.json), como os outros scripts
const cwd = require('./lib/config.js').raizDoProjeto(process.cwd());
// --abrir e --proxima-decisao sao caminhos de quem roda: relativos a pasta de onde rodou; o --abrir vai gravado
// relativo a raiz, como quando se roda dela
const abrirDado = arg('abrir');
const abrirEm = abrirDado && !path.isAbsolute(abrirDado) && path.resolve(process.cwd()) !== path.resolve(cwd)
  ? path.relative(cwd, path.resolve(process.cwd(), abrirDado)) : abrirDado;
const decisoes = arg('proxima-decisao');
const sessaoDaFlag = arg('sessao');
const planoDado = arg('plano');

// H6d (15.2, D896): --fatia [<id>] imprime so o cabecalho do plano e um item (lib/fatia.js), com as linhas do arquivo;
// sem id, o proximo item sem marcar. O id e opcional, entao nao passa pelo flags.valor (que exige valor).
const iFatia = process.argv.indexOf('--fatia');
// Revisao R1 (correcao, borda, estados, escopo, manutencao): --plano fora do --fatia era aceito e ignorado calado.
if (planoDado && iFatia === -1) {
  process.stderr.write('ERRO: --plano so vale junto de --fatia; o painel e o JSON leem o plano ativo ou o da frente.\n' + USO);
  process.exit(1);
}
if (iFatia !== -1) {
  const sair = function (msg) { process.stderr.write('sworn: ' + msg + '\n'); process.exit(1); };
  if (process.argv.indexOf('--fatia', iFatia + 1) !== -1) sair('--fatia aparece mais de uma vez; passe-a uma vez so.\n' + USO.trimEnd());
  // Revisao R1 (escopo): o --fatia sai antes do --abrir e do --proxima-decisao, que ficavam sem rodar e sem aviso.
  const junto = ['--abrir', '--proxima-decisao', '--texto'].filter(function (fl) { return process.argv.indexOf(fl) !== -1; });
  if (junto.length) sair('--fatia nao se combina com ' + junto.join(' nem ') + '; rode cada um num comando.');
  const prox = process.argv[iFatia + 1];
  if (typeof prox === 'string' && prox.trim() === '') {
    sair('o id depois de --fatia veio vazio; passe o id do item, ou nada (sem id, sai o proximo item sem marcar).');
  }
  const id = typeof prox === 'string' && FLAGS_DO_USO.indexOf(prox) === -1 && prox.charAt(0) !== '-' ? prox.trim() : null;
  // Revisao R1 (correcao, borda, manutencao): o que nao e flag do USO, valor dela nem o id logo apos o --fatia ficava
  // calado ("--fatia --plano p.md 3" largava o 3; "--fatia --sesao x" virava o id "--sesao").
  const COM_VALOR = ['--abrir', '--proxima-decisao', '--sessao', '--plano'];
  for (let i = 2; i < process.argv.length; i++) {
    const tok = process.argv[i];
    if (COM_VALOR.indexOf(tok) !== -1) { i++; continue; }
    if (tok === '--fatia') { if (id !== null) i++; continue; }
    sair(tok + ' sobrou na linha: nao e opcao do plano.js, e o id do item vai logo depois de --fatia (--fatia <id> --plano <caminho>).\n' + USO.trimEnd());
  }
  const alvo = planoDaFatia(sair);
  let textoDoPlano;
  try { textoDoPlano = fs.readFileSync(alvo.abs, 'utf8'); }
  catch (e) {
    sair('nao consegui ler o plano ' + alvo.rel + ': ' + planoLib.causaDoDisco(e) + '. ' + (planoDado
      ? 'Confira o caminho: o --plano e relativo a pasta de onde voce rodou.'
      : 'Confira o arquivo, ou passe outro: --fatia [<id>] --plano <caminho do plano>.'));
  }
  const fatiaLib = require('./lib/fatia.js');
  const f = fatiaLib.fatiar(textoDoPlano, id);
  if (!f.item && id !== null) {
    sair('nenhuma caixa (- [ ] ' + id + '), titulo nem linha de tabela do plano ' + alvo.rel + ' comeca com o id ' + id +
      '. Confira o id no plano (sem id, sai o proximo item sem marcar).');
  }
  process.stdout.write(fatiaLib.texto(alvo.rel, f, id));
  process.exit(0);
}

/** O plano da fatia: o --plano dado (relativo a pasta de onde rodou); senao o plano-ativo.json; senao o da frente da
 *  sessao, como no painel (--texto). O que nao da um plano so sai com o motivo e o --plano que resolve. */
function planoDaFatia(sair) {
  if (planoDado) return { rel: planoDado, abs: path.resolve(process.cwd(), planoDado) };
  const passe = ' Passe o plano: --fatia [<id>] --plano <caminho do plano>.';
  if (fs.existsSync(path.join(cwd, planoLib.ATIVO))) {
    const at = planoLib.lerAtivo(cwd);
    if (!(at && typeof at.arquivo === 'string' && at.arquivo.trim())) sair('.claude/sworn/plano-ativo.json existe mas nao diz o plano (campo "arquivo").' + passe);
    // Revisao R1 (borda): o teste aparava e o caminho nao; o abrir() grava por path.relative, sem espaco nas pontas.
    const arq = at.arquivo.trim();
    if (!planoLib.dentroDoProjeto(cwd, arq)) sair('o plano ativo ' + arq + ' fica fora do projeto e nao foi lido.' + passe);
    return { rel: arq, abs: planoLib.caminhoDoPlano(cwd, arq) };
  }
  const sessao = sessaoDaFlag || process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || null;
  const achado = planoLib.acharPlanoDaFrente(cwd, sessao ? estado.ler(sessao).frente : null);
  // Revisao R1 (microcopy, correcao): a lista das frentes e a causa de cada caso, como o painel (--texto) ja dizia.
  if (achado && achado.varias) {
    sair('mais de uma frente tem plano (' + achado.varias.map(function (v) { return v.arquivo || v.ilegivel + ' (escopo ilegivel)'; }).join(', ') +
      ') e esta sessao nao esta ligada a nenhuma.' + passe);
  }
  if (achado && achado.ilegivel) sair('nao consegui ler o escopo ' + achado.ilegivel + ', onde fica a linha Plano:.' + passe);
  if (achado && !achado.arquivo) {
    sair((achado.frente ? 'a frente ' + achado.frente : 'o escopo ' + achado.escopo) +
      ' nao tem a linha Plano: no Objetivo.' + passe);
  }
  if (!achado) sair('nenhum plano achado na raiz do projeto (nem .claude/sworn/plano-ativo.json, nem a linha Plano: de um escopo).' + passe);
  if (!planoLib.dentroDoProjeto(cwd, achado.arquivo)) sair('o plano ' + achado.arquivo + ' fica fora do projeto e nao foi lido.' + passe);
  return { rel: achado.arquivo, abs: planoLib.caminhoDoPlano(cwd, achado.arquivo) };
}

if (decisoes) {
  // D460: ausente segue dando 1 (projeto sem decisao ainda), mas avisa: caminho errado gravava "D1" calado
  const alvo = path.resolve(process.cwd(), decisoes);
  let st = null;
  try { st = fs.statSync(alvo); } catch (e) { st = null; }
  if (st && !st.isFile()) {
    process.stderr.write('sworn: ' + alvo + ' nao e um arquivo; passe o arquivo de decisoes e rode de novo\n');
    process.exit(1);
  }
  if (!st) {
    process.stderr.write('sworn: ' + alvo + ' nao existe. O 1 so vale se o projeto ainda nao tem decisao registrada; senao, confira o caminho e rode de novo\n');
  }
  process.stdout.write(String(planoLib.proximaDecisao(alvo)) + '\n');
  process.exit(0);
}

if (abrirEm) {
  const sessao = sessaoDaFlag || process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || 'sem-sessao';
  let a;
  // Plano 082 (p7-16): o abrir() diz o arquivo, a causa e o que fazer; aqui sai so a mensagem, sem stack.
  try { a = planoLib.abrir(cwd, abrirEm, sessao); }
  catch (e) { process.stderr.write(e.message + '\n'); process.exit(1); }
  process.stdout.write('plano ativo: ' + a.arquivo + ' (dono: ' + a.sessionId + ')\n');
  process.exit(0);
}

const ativo = planoLib.lerAtivo(cwd);

// Bloco M / M2: o painel em texto, para o comando do mod. Saida 0 sempre: ler mal nao derruba nada.
if (process.argv.indexOf('--texto') !== -1) {
  // D442/3: o painel cita o caminho real deste script no "como abrir".
  const eu = __filename;
  // D442/10: arquivo presente que nao da plano (JSON quebrado, lista, sem "arquivo" texto) nao e "nenhum plano ativo".
  if (!(ativo && typeof ativo.arquivo === 'string' && ativo.arquivo) && fs.existsSync(path.join(cwd, planoLib.ATIVO))) {
    process.stdout.write(planoLib.painelIlegivel(eu) + '\n');
    process.exit(0);
  }
  let alvo = ativo && ativo.arquivo ? ativo : null;
  if (!alvo) {
    // D476: sem plano-ativo.json, o plano vem da frente vinculada a sessao (o mod passa --sessao).
    const sessao = sessaoDaFlag || process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || null;
    const achado = planoLib.acharPlanoDaFrente(cwd, sessao ? estado.ler(sessao).frente : null);
    if (achado && achado.varias) {
      process.stdout.write(planoLib.painelVariasFrentes(achado.varias, eu) + '\n');
      process.exit(0);
    }
    if (achado && achado.ilegivel) {
      process.stdout.write(planoLib.painelFrenteIlegivel(achado.frente, achado.ilegivel) + '\n');
      process.exit(0);
    }
    if (achado && !achado.arquivo) {
      process.stdout.write(planoLib.painelFrenteSemPlano(achado.frente, eu) + '\n');
      process.exit(0);
    }
    if (achado && !planoLib.dentroDoProjeto(cwd, achado.arquivo)) {
      process.stdout.write(planoLib.painelPlanoFora(achado.arquivo, eu) + '\n');
      process.exit(0);
    }
    if (achado) {
      alvo = { arquivo: achado.arquivo, frente: achado.frente, objetivo: achado.objetivo, escopo: achado.escopo,
        semVinculo: achado.semVinculo };
    }
  }
  let tarefasDoPainel = [];
  if (alvo) {
    // D476: o painel le o formato real (Item/Etapa/..., travessao, [FEITO]); o JSON abaixo e o portao seguem no de hoje.
    let textoDoPlano;
    try { textoDoPlano = fs.readFileSync(planoLib.caminhoDoPlano(cwd, alvo.arquivo), 'utf8'); }
    catch (e) {
      // R2 da revisao cega: caminho com espaco, sem crases, chega cortado no primeiro espaco.
      process.stdout.write(planoLib.painelNaoLeu(alvo.arquivo, !!alvo.frente) + '\n');
      process.exit(0);
    }
    // P2 #8 e #15: so a leitura cabe no "nao consegui ler"; erro ao montar a conta de um plano lido e dito como tal.
    try {
      // D509: plano achado pelo escopo (tem Objetivo) e com tabela sem marca -> estado pela "ETAPA <id>" do Objetivo.
      tarefasDoPainel = planoLib.deduzirPeloEscopo(planoLib.parseItens(textoDoPlano), alvo.objetivo);
      // D502: as sessoes gastas sao as marcas do proprio plano (copia: nao grava no objeto lido do plano-ativo.json).
      alvo = Object.assign({}, alvo, { sessoesDoPlano: planoLib.sessoesDoPlano(textoDoPlano) });
    }
    catch (e) {
      process.stdout.write(planoLib.painelQueFalhou(alvo.arquivo, e) + '\n');
      process.exit(0);
    }
  }
  process.stdout.write(planoLib.painelTexto(alvo, tarefasDoPainel, eu) + '\n');
  process.exit(0);
}

if (!ativo) {
  // A7-01 (pedido 12): o comando inteiro de abrir (o caminho real deste script, como no painel) e o que vai no caminho.
  process.stdout.write('Nenhum plano ativo: não há .claude/sworn/plano-ativo.json nesta pasta. Para abrir um, rode ' +
    planoLib.comandoDeAbrir(__filename) + ' (troque <caminho do plano> pelo arquivo do plano, relativo a esta pasta ' +
    'ou absoluto).\n');
  process.exit(0);
}

// Plano 083 (p3-23): leitura e contagem com erro proprio, e a causa dita (era o mesmo "nao consegui ler" para tudo).
let textoDoPlano;
try { textoDoPlano = fs.readFileSync(planoLib.caminhoDoPlano(cwd, ativo.arquivo), 'utf8'); }
catch (e) { process.stdout.write('ERRO: não consegui ler ' + ativo.arquivo + ': ' + planoLib.causaDoDisco(e) + '.\n'); process.exit(1); }
let tarefas = [];
try { tarefas = planoLib.parseTarefas(textoDoPlano); }
catch (e) {
  process.stdout.write('ERRO: li ' + ativo.arquivo + ', mas não consegui contar as tarefas: ' + planoLib.causaDoDisco(e) + '.\n');
  process.exit(1);
}

const abertas = tarefas.filter(function (t) { return t.abertos > 0; });
// D442/9 (M-23/M-24): tarefa sem nenhuma caixa nao e concluida - o painel em texto ja dizia isso (D436).
const semCaixas = tarefas.filter(function (t) { return !(t.total > 0); }).length;
process.stdout.write(JSON.stringify({
  arquivo: ativo.arquivo,
  dono: ativo.sessionId,
  tarefas: tarefas.length,
  concluidas: tarefas.length - abertas.length - semCaixas,
  semCaixas: semCaixas,
  proximaAberta: abertas.length ? { n: abertas[0].n, titulo: abertas[0].titulo, abertos: abertas[0].abertos } : null
}, null, 2) + '\n');
