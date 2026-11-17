#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const gitLib = require('./lib/git.js');
const sanit = require('./lib/sanitacao.js');
const texto = require('./lib/texto.js');
const flags = require('./lib/flags.js');

/**
 * Monta a pasta que vai para o repositorio publico.
 *
 * POR QUE ISTO E SCRIPT E NAO PASSO MANUAL. Ja foi passo manual uma vez: em
 * 2026-09-02 o export saiu com 92 arquivos em vez de 95, e os que faltavam eram
 * o proprio detector de sanitacao e o teste dele. Quem pegou o erro foi o
 * CONTADOR DE TESTES da suite - 374 em vez de 389 -, nao a leitura da lista.
 * Montagem a mao erra em silencio, e este ato e o ultimo antes do irreversivel.
 *
 * A LISTA VEM DE UM LUGAR SO. `superficiePublicavel` e a mesma funcao que o
 * `sanitar.js` audita. Se o montador tivesse a lista dele, os dois poderiam
 * discordar - e discordariam calados, com o auditor dando limpo sobre um
 * conjunto e o montador copiando outro.
 *
 * O QUE ELE NAO FAZ, de proposito: nao commita, nao cria remoto, nao empurra.
 * Ele deixa a pasta pronta e com `git add` feito, para que a auditoria rode
 * ANTES do primeiro commit - que e a unica hora em que ela ainda evita alguma
 * coisa. Commit, identidade e push sao o ato irreversivel, e tem dono proprio.
 */

const USO = 'uso: node scripts/exportar.js --destino <pasta> [--raiz <pasta>] [--gravar]';
const FLAGS_DO_USO = ['--raiz', '--destino', '--gravar'];

// A4-exp-1 (pedido 12), borda: flag sem valor (ultima da linha, vazia ou seguida de outra flag do USO) caia calada -
// `--destino --gravar` montava o export na pasta "--gravar". O molde e o argumento() do plataforma.js.
function argumento(argv, nome) {
  return flags.valor(argv, nome, FLAGS_DO_USO, function (msg) {
    console.error('ERRO: ' + msg);
    console.error(USO);
    process.exit(2);
  });
}

// A4-exp-2 (pedido 12), estados: so ENOENT e destino vazio. O resto (destino que e arquivo, sem permissao) chegava
// ao mkdir como "vazio" e saia em excecao crua; agora sobe ao main, que diz a causa (o mkdir do destino tambem).
function vazia(dir) {
  try { return fs.readdirSync(dir).length === 0; } catch (e) {
    if (e && e.code === 'ENOENT') return true;
    throw e;
  }
}

function naoDeuParaMontar(causa) {
  console.error('NAO DEU PARA MONTAR: ' + causa);
  console.error('Escolha outro --destino: uma pasta que nao existe, ou uma vazia.');
  process.exit(2);
}

/**
 * Teto de tempo e retorno conferido, como os irmaos em `lib/git.js` e
 * `lib/sanitacao.js`. Sem os dois, um git travado pendurava o script, e um que
 * falhava deixava a saida dizer "feitos" com saida 0 (ronda 1 do Passo 8b).
 * Devolve null quando deu certo, ou a frase do que falhou. A4-05 (pedido 12): a frase e em portugues, e o texto
 * cru do git vem entre aspas e marcado como dele, nunca solto.
 */
function git(dir, args) {
  const passo = 'o `git ' + args[0] + '`';
  // o rodar nunca lanca: o spawn que lancaria volta em r.error, com a mesma frase
  const r = gitLib.rodar(dir, args);
  if (r.error) {
    if (r.error.code === 'ETIMEDOUT') return passo + ' passou de 20 s sem responder';
    return passo + ' nao rodou (' + texto.causaDoErro(r.error) + ')';
  }
  if (r.status !== 0) {
    const primeira = String(r.stderr || '').trim().split(/\r?\n/)[0];
    // R1 (s227): morto por sinal o status e null; stderr vazio nao deixa a frase terminar em ": ".
    const saida = r.status === null ? 'parou pelo sinal ' + r.signal : 'saiu ' + r.status;
    return passo + ' ' + saida + (primeira ? '; o git disse: "' + primeira + '"' : ', sem mensagem do git');
  }
  return null;
}

function montar(raiz, destino) {
  const arquivos = sanit.superficiePublicavel(raiz);
  if (arquivos === null) return { erro: 'o git nao respondeu na origem' };

  const copiados = [];
  const faltaram = [];
  arquivos.forEach(function (rel) {
    const de = path.join(raiz, rel);
    const para = path.join(destino, rel);
    try {
      fs.mkdirSync(path.dirname(para), { recursive: true });
      fs.copyFileSync(de, para);
      copiados.push(rel);
    } catch (e) {
      // Arquivo apagado no disco mas ainda no indice cai aqui. Some da lista
      // silenciosamente seria o erro de 2026-09-02 outra vez, de outro jeito.
      faltaram.push(rel + ' (' + texto.causaDoErro(e) + ')');
    }
  });

  // o add so roda se o init deu certo; o primeiro que falhar e o que se conta
  const falhaGit = git(destino, ['init', '-q']) || git(destino, ['add', '-A']);
  return { copiados: copiados, faltaram: faltaram, previstos: arquivos.length, falhaGit: falhaGit };
}

/**
 * R1 (pedido do dono, 2026-11-12: limpar o que sobra depois do push): o export entra no registro das pastas do sworn
 * (scripts/lib/pastas.js) e sai sozinho depois de publicado; a origem que e um worktree ligado (o --git-dir difere do
 * --git-common-dir) entra junto e sai com ele. So pasta da temporaria do sistema entra; a frase diz o que ficou.
 */
function registrarNaLimpeza(raiz, destino) {
  try {
    const pastas = require('./lib/pastas.js');
    const sessao = process.env.CLAUDE_CODE_SESSION_ID || '';
    const dirs = gitLib.rodar(raiz, ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir']);
    const [gitDir, gitComum] = gitLib.ok(dirs) ? dirs.stdout.trim().split(/\r?\n/) : [];
    let wt = null;
    if (gitDir && gitComum && path.resolve(gitDir) !== path.resolve(gitComum)) {
      // o repositorio de que o worktree saiu: a pasta acima do .git, ou o proprio, quando e um repositorio bare
      const repo = path.basename(gitComum) === '.git' ? path.dirname(gitComum) : gitComum;
      wt = pastas.registrar(raiz, 'worktree', { sessao: sessao, repo: repo });
    }
    const exp = pastas.registrar(destino, 'export', { sessao: sessao, origem: wt && wt.ok ? raiz : undefined });
    if (!exp.ok) return 'O export NAO entrou na limpeza do sworn (' + exp.erro + '): apague-o voce depois do push.';
    return 'O export entrou na limpeza do sworn: sai sozinho depois do push publicado' +
      (wt !== null ? (wt.ok ? ', e o worktree de origem com ele.' :
        '; o worktree de origem nao entrou (' + wt.erro + '): tire-o com git worktree remove depois.') :
        dirs.status === 0 ? '.' : '; o git nao disse se a origem e um worktree (' +
          String(dirs.stderr || (dirs.error && dirs.error.message) || '').trim().slice(0, 200) + '): se for, tire-o com ' +
          'git worktree remove depois.');
  } catch (e) {
    return 'O export NAO entrou na limpeza do sworn (' + ((e && e.message) || e) + '): apague-o voce depois do push.';
  }
}

function main() {
  const argv = process.argv.slice(2);
  const raizPedida = argumento(argv, '--raiz') || '.';
  const raiz = path.resolve(raizPedida);
  const destinoPedido = argumento(argv, '--destino');
  const gravar = argv.indexOf('--gravar') !== -1;

  if (!destinoPedido) {
    console.error(USO);
    console.error('Sem --gravar ele so mostra o que copiaria. Nada e escrito.');
    process.exit(2);
  }
  const destino = path.resolve(destinoPedido);

  const arquivos = sanit.superficiePublicavel(raiz);
  if (arquivos === null) {
    console.error('NAO DEU PARA MEDIR: o git nao respondeu em ' + raizPedida + '.');
    process.exit(2);
  }

  console.log('Origem: ' + raizPedida + '   Destino: ' + destinoPedido);
  console.log('Fora da superficie: ' + sanit.FORA_DO_PUBLICO.join(', ') +
              ', mais tudo que o .gitignore cobre.');
  console.log(arquivos.length + ' arquivos entram no export.');
  console.log('');

  if (!gravar) {
    arquivos.forEach(function (a) { console.log('  ' + a); });
    console.log('');
    console.log('PROPOSTA - nada foi escrito. Repita com --gravar para montar.');
    process.exit(0);
  }

  if (arquivos.length === 0) {
    console.error('ERRO: superficie vazia: nada a exportar. Montar "0 de 0" parece sucesso e nao e.');
    process.exit(1);
  }

  let livre;
  try { livre = vazia(destino); } catch (e) {
    naoDeuParaMontar('o destino nao se le (' + texto.causaDoErro(e) + '): ' + destinoPedido);
  }
  if (!livre) {
    console.error('O destino nao esta vazio: ' + destinoPedido);
    console.error('Montar por cima misturaria export novo com sobra do anterior,');
    console.error('e a sobra nao aparece em lista nenhuma. Apague ou escolha outro.');
    process.exit(2);
  }
  try { fs.mkdirSync(destino, { recursive: true }); } catch (e) {
    naoDeuParaMontar('o destino nao pode ser criado (' + texto.causaDoErro(e) + '): ' + destinoPedido);
  }

  const r = montar(raiz, destino);
  if (r.erro) { console.error('NAO DEU PARA MONTAR: ' + r.erro); process.exit(2); }

  console.log('Copiados: ' + r.copiados.length + ' de ' + r.previstos);
  if (r.faltaram.length > 0) {
    console.error('NAO COPIADOS (' + r.faltaram.length + '):');
    r.faltaram.forEach(function (a) { console.error('  ' + a); });
    console.error('Export incompleto nao vai a lugar nenhum.');
    process.exit(1);
  }
  if (r.falhaGit) {
    console.error('O GIT NAO PREPAROU O EXPORT: ' + r.falhaGit);
    console.error('Os arquivos foram copiados, mas sem o `git add` o commit seguinte sairia incompleto.');
    console.error('Corrija a causa (a linha acima), apague o destino e rode de novo.');
    process.exit(1);
  }
  console.log('`git init` e `git add` feitos. NENHUM commit - isso e o ato irreversivel.');
  console.log(registrarNaLimpeza(raiz, destino));
  console.log('');
  // R3f: a sanitacao confere a identidade que vai assinar o commit (sem nada configurado, o git inventa uma com o
  // nome completo da conta do sistema). Por isso a identidade publica vem PRIMEIRO, e a sanitacao roda de novo depois
  // do commit, quando ve tambem quem assinou de fato: o push so vem com as duas rodadas limpas.
  console.log('1. Ponha a identidade publica (o apelido e o e-mail noreply do GitHub, nunca o seu nome):');
  console.log('  git -C "' + destinoPedido + '" config user.name "<apelido>"');
  console.log('  git -C "' + destinoPedido + '" config user.email "<numero>+<apelido>@users.noreply.github.com"');
  console.log('  (as variaveis GIT_AUTHOR_* e GIT_COMMITTER_* do ambiente vencem esta config: tire-as antes)');
  console.log('2. Confira ANTES de commitar:');
  console.log('  node "' + path.join(destinoPedido, 'scripts', 'sanitar.js') + '" --raiz "' + destinoPedido + '"');
  console.log('  npm --prefix "' + destinoPedido + '" test');
  console.log('3. Depois do commit e ANTES do push, rode a sanitacao de novo.');
  process.exit(0);
}

main();
