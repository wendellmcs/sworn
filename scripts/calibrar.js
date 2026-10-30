#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const calibracao = require('./lib/calibracao.js');
const config = require('./lib/config.js');
const texto = require('./lib/texto.js');
const continuo = require('./lib/continuo.js');
const { LIMIARES_PADRAO, limiaresValidos } = require('./lib/saude.js');

/**
 * Item 2 da 0.7 (D466/D467): o calibrador por projeto (skill /sworn:calibrate).
 *   node calibrar.js [--pasta <transcricoes>]  le e imprime o relatorio (so numeros), nao grava nada
 *   node calibrar.js --gravar <tokens>          poe limiares.tokensDeContexto no projeto.json (so com o sim do dono)
 *   node calibrar.js --manter                   grava o limiar em vigor, o "manter" do dono (D539; so com o sim dele)
 * Sem --pasta, procura as transcricoes do projeto em <CLAUDE_CONFIG_DIR ou ~/.claude>/projects/.
 * Saida: JSON; na falha, `erro` e exit 1.
 */
const RELATIVO = '.claude/sworn/projeto.json';
const MINIMO = 50000;

function valor(nome) {
  const i = process.argv.indexOf(nome);
  const v = i !== -1 ? process.argv[i + 1] : null;
  return v && !v.startsWith('--') ? v : null;
}

function sair(codigo, dados) {
  process.stdout.write(JSON.stringify(dados, null, 2) + '\n');
  process.exit(codigo);
}

const raiz = config.raizDoProjeto(process.cwd());
const projeto = config.carregarProjeto(raiz);
const limiares = (projeto && projeto.limiares) || {};
// D495: o alarme gravado so vale se for numero positivo, como no medidor (saude.limiaresValidos).
const alarme = Object.assign({}, LIMIARES_PADRAO, limiaresValidos(limiares)).tokensAlarme;
// Sobra 5 da 0.8.3 (D538): o limiar que vale hoje, como o medidor (saude.medir): o gravado, se numero positivo; senao o
// do modo continuo, quando ligado; senao o padrao do plugin. Antes o relatorio dizia 175 mil com o aviso a 250 mil.
const gravado = limiaresValidos(limiares);
const emVigor = 'tokensDeContexto' in gravado
  ? { n: gravado.tokensDeContexto, de: 'projeto.json' }
  : continuo.ativo(projeto) ? { n: continuo.TOKENS_CONTEXTO, de: 'modo continuo' }
    : { n: LIMIARES_PADRAO.tokensDeContexto, de: 'padrao do plugin' };

const manter = process.argv.indexOf('--manter') !== -1;
if (process.argv.indexOf('--gravar') !== -1 || manter) {
  const bruto = manter ? String(emVigor.n) : valor('--gravar');
  const n = Number(bruto);
  if (!bruto || !/^\d+$/.test(bruto) || n < MINIMO || n >= alarme) {
    // A6 (s220, R1 :51): no --manter ninguem digitou o valor; a recusa diz o limiar em vigor, de onde veio e o passo.
    sair(1, { gravou: false, erro: manter
      ? '--manter: o limiar em vigor (' + bruto + ', do ' + emVigor.de + ') esta fora da faixa que se grava ' +
        '(inteiro de ' + MINIMO + ' ate abaixo do alarme, ' + alarme + '); grave um valor nessa faixa com --gravar <tokens>'
      : '--gravar pede um numero inteiro de tokens, de ' + MINIMO + ' ate abaixo do alarme (' + alarme + '); veio "' +
        bruto + '"' });
  }
  const arquivo = config.caminhoEmSworn(raiz, 'projeto.json');
  if (!fs.existsSync(arquivo)) sair(1, { gravou: false, erro: 'sem ' + RELATIVO + ' neste projeto: rode /sworn:init antes' });
  let obj;
  try { obj = JSON.parse(texto.semBom(fs.readFileSync(arquivo, 'utf8'))); } catch (e) {
    sair(1, { gravou: false, erro: RELATIVO + ' nao e JSON valido (' + e.message + '); corrija e rode de novo' });
  }
  // A6-21 (D735): a forma com exemplo e o passo, sem "objeto JSON".
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    sair(1, { gravou: false, erro: RELATIVO + ' tem de ter os campos do projeto entre { e }, como ' +
      '{ "shell": "bash" }; corrija e rode de novo' });
  }
  if ('limiares' in obj && (!obj.limiares || typeof obj.limiares !== 'object' || Array.isArray(obj.limiares))) {
    sair(1, { gravou: false, erro: 'limiares em ' + RELATIVO + ' nao e objeto; corrija e rode de novo' });
  }
  obj.limiares = Object.assign({}, obj.limiares, { tokensDeContexto: n });
  try { fs.writeFileSync(arquivo, JSON.stringify(obj, null, 2) + '\n'); } catch (e) {
    sair(1, { gravou: false, erro: 'nao consegui gravar ' + RELATIVO + ' (' + e.message + ')' });
  }
  sair(0, manter ? { gravou: true, manteve: true, tokensDeContexto: n, arquivo: RELATIVO }
    : { gravou: true, tokensDeContexto: n, arquivo: RELATIVO });
}

const pasta = valor('--pasta') ? path.resolve(valor('--pasta')) : calibracao.pastaDasTranscricoes(raiz);
if (!pasta || !fs.existsSync(pasta)) {
  sair(1, { erro: 'nao achei as transcricoes deste projeto (' + calibracao.nomeDaPasta(raiz) + ' em projects/ da pasta de config do Claude Code); passe --pasta <pasta das transcricoes>' });
}
// A6 (s220, pendente :76 medido): pasta que existe e nao se le (arquivo, sem permissao) saia com o stack trace.
let lidas;
try { lidas = calibracao.lerPasta(pasta); } catch (e) {
  // A6-22 e A6-23 (D735): a causa traduzida e a forma da flag.
  sair(1, { erro: '--pasta nao se le como pasta (' + texto.causaDoErro(e) + '); passe --pasta <pasta das ' +
    'transcricoes deste projeto>' });
}
const relatorio = calibracao.calibrar(lidas.sessoes, { limiarAtual: emVigor.n });
relatorio.limiarAtualDe = emVigor.de;
relatorio.amostra.chamadasSemPreco = lidas.semPreco;
relatorio.amostra.transcricoesIlegiveis = lidas.ilegiveis;
sair(0, Object.assign({ pasta: pasta }, relatorio));
