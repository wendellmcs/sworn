#!/usr/bin/env node
'use strict';
// C2 (/sworn:drift): o codigo se afastou do plano? Cruza os arquivos mudados desde a base (o commit que criou o plano,
// ou --desde <commit>) com o plano. Uso: node drift.js <plano.md> [--desde <commit>] [--json]. Codigo 0 sem achado, 1
// com achado, 2 sem plano, sem repositorio ou sem base.
const fs = require('node:fs');
const path = require('node:path');
const gitLib = require('./lib/git.js');
const { ascii } = require('./lib/escopo.js');
const { drift } = require('./lib/drift.js');

function git(args, cwd) {
  return gitLib.rodar(cwd, args); // 20 s e 64 MiB, os padroes do rodar (a causa() abaixo cita os dois)
}

/** Por que o git nao respondeu, em palavras: uma falha dele nunca vira "nada mudou". */
function causa(r) {
  const codigo = r.error && r.error.code;
  if (codigo === 'ENOENT') return 'o git nao esta instalado, ou nao esta no PATH';
  if (codigo === 'ETIMEDOUT') return 'o git passou de 20 s sem responder';
  if (codigo === 'ENOBUFS') return 'a resposta do git passou de 64 MB';
  const primeira = String(r.stderr || '').trim().split('\n')[0];
  return 'o git falhou: ' + ascii(primeira || 'codigo ' + r.status);
}

/** Os nomes da saida com -z: o nome com acento ou espaco chega como e, sem aspas nem octal. */
function nomes(r) {
  return String(r.stdout).split('\0').filter(Boolean);
}

function erro(msg) {
  process.stderr.write(msg + '\n');
  return 2;
}

function main(argv, cwd) {
  const i = argv.indexOf('--desde');
  const desde = i !== -1 ? argv[i + 1] : null;
  // o valor do --desde nao e o plano (sem --desde, i e -1 e nenhum indice sai)
  const arquivo = argv.filter(function (a, j) {
    return a !== '--json' && a !== '--desde' && (i === -1 || j !== i + 1);
  })[0];
  // o --desde sem valor, ou seguido de outra opcao (--json), e uso errado: nao vai ao git como opcao
  if (!arquivo || (i !== -1 && (!desde || desde.startsWith('-')))) return erro('uso: node drift.js <plano.md> [--desde <commit>] [--json]');
  let texto;
  try {
    texto = fs.readFileSync(path.resolve(cwd, arquivo), 'utf8');
  } catch (e) {
    return erro('sworn: nao consegui ler o plano ' + ascii(arquivo) + ' (' + e.code + ')');
  }
  const topo = git(['rev-parse', '--show-toplevel'], cwd);
  // fora de um repositorio, ou num que o git recusa (dono duvidoso, .git corrompido): a frase do git diz qual
  if (topo.status !== 0) {
    return erro('sworn: ' + causa(topo) + '; rode o drift na pasta do projeto, que le pelo git o que mudou');
  }
  const raiz = String(topo.stdout).trim();
  // os dois pelo caminho real: o git devolve o nome longo, e a pasta atual pode vir com o curto do Windows (8.3)
  const plano = path.relative(fs.realpathSync.native(raiz), fs.realpathSync.native(path.resolve(cwd, arquivo)))
    .split(path.sep).join('/');
  // com --verify --quiet, o codigo 1 quer dizer "nao ha esse commit" (medido: base inexistente, objeto sumido,
  // repositorio sem commit); outro codigo e falha do proprio git, e diz a sua causa
  const SEM_COMMIT = 1;
  const semPlano = 'sworn: o plano nao tem commit no git; diga a base com --desde <commit>';
  let base;
  if (desde) {
    const r = git(['rev-parse', '--verify', '--quiet', desde + '^{commit}'], raiz);
    if (r.status === SEM_COMMIT) return erro('sworn: a base ' + ascii(desde) + ' nao e um commit deste repositorio');
    if (r.status !== 0) return erro('sworn: ' + causa(r));
    base = String(r.stdout).trim();
  } else {
    const head = git(['rev-parse', '--verify', '--quiet', 'HEAD'], raiz);
    if (head.status === SEM_COMMIT) return erro(semPlano);
    if (head.status !== 0) return erro('sworn: ' + causa(head));
    const r = git(['log', '--diff-filter=A', '--format=%H', '--', plano], raiz);
    if (r.status !== 0) return erro('sworn: nao consegui ler o historico do plano: ' + causa(r));
    // o git log vem do mais novo ao mais antigo: o ultimo e o commit que criou o plano
    const criaram = String(r.stdout).split('\n').map(function (h) { return h.trim(); }).filter(Boolean);
    if (!criaram.length) return erro(semPlano);
    base = criaram[criaram.length - 1];
  }
  // o diff da base contra a arvore (o commitado e o que ainda nao foi) mais o que o git ainda nao conhece
  const diff = git(['diff', '--name-only', '-z', base], raiz);
  if (diff.status !== 0) return erro('sworn: nao consegui ler o que mudou desde a base: ' + causa(diff));
  const novos = git(['ls-files', '--others', '--exclude-standard', '-z'], raiz);
  if (novos.status !== 0) return erro('sworn: nao consegui listar os arquivos novos: ' + causa(novos));
  const mudados = nomes(diff).concat(nomes(novos));
  const r = drift({ texto: texto, plano: plano, mudados: Array.from(new Set(mudados)),
    existe: function (p) { return fs.existsSync(path.join(raiz, p)); } });
  if (argv.indexOf('--json') !== -1) {
    process.stdout.write(JSON.stringify(Object.assign({ base: base }, r), null, 2) + '\n');
    return r.achados.length ? 1 : 0;
  }
  const out = ['sworn: drift de ' + ascii(plano) + ' desde ' + base.slice(0, 7) + ': ' + r.mudados + ' mudados, ' +
    r.noPlano + ' no plano; ' + (r.achados.length ? r.achados.length + ' achado(s):' : 'nenhum achado.')];
  r.achados.forEach(function (a) {
    out.push('  ' + (a.linha ? 'linha ' + a.linha + '  ' : '') + a.tipo + '  ' + ascii(a.valor) + '  (' +
      ascii(a.motivo) + ')');
  });
  if (r.achados.length) out.push('sworn: acerte o plano ou o codigo e rode de novo, ate "nenhum achado".');
  process.stdout.write(out.join('\n') + '\n');
  return r.achados.length ? 1 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2), process.cwd());

module.exports = { main };
