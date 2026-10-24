#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const planoLib = require('./lib/plano.js');
const estado = require('./lib/estado.js');

function arg(nome) {
  const i = process.argv.indexOf('--' + nome);
  return i !== -1 ? process.argv[i + 1] : null;
}

const cwd = process.cwd();
const abrirEm = arg('abrir');
const decisoes = arg('proxima-decisao');

if (decisoes) {
  // D460: ausente segue dando 1 (projeto sem decisao ainda), mas avisa: caminho errado gravava "D1" calado
  const alvo = path.resolve(cwd, decisoes);
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
  const sessao = arg('sessao') || process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || 'sem-sessao';
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
    const sessao = arg('sessao') || process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || null;
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
  process.stdout.write('nenhum plano ativo. Use --abrir <caminho do plano>\n');
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
