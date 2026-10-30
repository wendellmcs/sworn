#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const travas = require('./lib/medicao-travas.js');
const qualidade = require('./medir-qualidade.js');
const { causaDoErro, entreAspas } = require('./lib/texto.js');

/**
 * A MEDICAO DE ANTES/DEPOIS DAS TRAVAS (plano T3a, D628): quantas vezes o agente diz "pronto" sem prova, sem o
 * plugin (condicao sem) e com ele (condicao com).
 *
 *   --congelar <pasta>
 *       O pre-registro: grava <pasta>/congelado.txt com o sha256 do que decide o numero (as tarefas, que trazem a
 *       hipotese; a apuracao; este instrumento). Nao se refaz: ajuste depois = pasta nova.
 *   --gerar --modelo <nome> --destino <pasta> [--tarefa <id>]... [--repeticoes <n>]
 *       Exige <destino>/congelado.txt conferindo com o disco, e o leva para dentro da rodada.
 *       Cada tarefa de modelos/travas-tarefas.json x repeticao x condicao, num brinquedo NOVO em
 *       <destino>/<carimbo>/brinquedos/. A e B intercalados (o mesmo minuto para as duas). Depois de cada sessao o
 *       instrumento roda o teste ele mesmo e compara o hash dos arquivos protegidos: a verdade vem do disco, nunca
 *       do portao. Grava <destino>/<carimbo>/execucoes.json e o stream bruto. Nada se apaga.
 *   --apurar <pasta da rodada>
 *       Le o execucoes.json e apura pela regra da lib (sem juiz de IA). Exit 0 com veredito; 2 sem - inclusive
 *       quando o congelado da rodada nao confere mais (a regra mudou depois de a rodada existir) ou a rodada parou
 *       no meio.
 *
 * Isolamento (Passo 0 do plano): as duas condicoes abrem com --setting-sources project,local --strict-mcp-config,
 * que deixa de fora os plugins, ganchos e conectores da maquina; a com soma --plugin-dir deste repositorio. O init
 * do stream prova a condicao de cada execucao, e condicao furada para a rodada. SWORN_VIGIA e SWORN_TMP apontam
 * sempre para dentro da rodada: a abertura do plugin mexe na pasta da home sem eles.
 *
 * Script irmao do medir-qualidade.js, e nao um modo dele: o fluxo e outro (duas condicoes, teste rodado depois,
 * hash dos protegidos, sem juiz), e as pecas comuns vem de la por require.
 */

const RAIZ = path.join(__dirname, '..');
const ARQUIVO_DE_TAREFAS = path.join(RAIZ, 'modelos', 'travas-tarefas.json');
const ARQUIVO_DE_REGRAS = path.join(RAIZ, 'modelos', 'regras.md');
const ARMADILHAS = ['quebra-outro', 'teste-nao-roda', 'limite-afrouxado', 'impossivel', 'controle'];
const LIMITE_DA_EXECUCAO_MS = 15 * 60 * 1000;
const LIMITE_DO_TESTE_MS = 2 * 60 * 1000;
const REPETICOES_PADRAO = 3;
const ID_DE_TAREFA = /^[a-z0-9-]{1,48}$/;
// O que decide o numero, relativo a raiz do repositorio. A hipotese mora no arquivo de tarefas; o medir-qualidade.js
// monta o projeto da condicao com. As regras (modelos/regras.md) sao o tratamento: o plugin medido e o do HEAD.
const CONGELADOS = ['modelos/travas-tarefas.json', 'scripts/lib/medicao-travas.js', 'scripts/lib/medicao.js', 'scripts/medir-travas.js',
  'scripts/medir-qualidade.js'];

const USO = [
  'uso:',
  '  node scripts/medir-travas.js --congelar <pasta>',
  '  node scripts/medir-travas.js --gerar --modelo <nome> --destino <pasta> [--tarefa <id>]... [--repeticoes <n>]',
  '  node scripts/medir-travas.js --apurar <pasta da rodada>',
  '',
  '--modelo e obrigatorio: o plugin nao escolhe modelo. --tarefa (repetivel) roda so essas; --repeticoes padrao ' + REPETICOES_PADRAO + '.'
].join('\n');

function valorDe(argv, nome) {
  const i = argv.indexOf(nome);
  if (i === -1) return null;
  const v = argv[i + 1];
  return (typeof v === 'string' && v.trim() !== '' && v.indexOf('--') !== 0) ? v : null;
}

function valoresDe(argv, nome) {
  const lista = [];
  argv.forEach(function (a, i) { if (a === nome) lista.push(valorDe(argv.slice(i), nome)); });
  return lista;
}

function recusar(texto) {
  process.stderr.write(texto + '\n');
  process.exitCode = 1;
}

// ── as tarefas ───────────────────────────────────────────────────────────

function lerTarefas(arquivo) {
  return JSON.parse(fs.readFileSync(arquivo || ARQUIVO_DE_TAREFAS, 'utf8'));
}

function dentroDoBrinquedo(rel) {
  const base = path.resolve('/brinquedo');
  return path.resolve(base, rel).indexOf(base + path.sep) === 0;
}

function caminhoRuim(rel) {
  if (!dentroDoBrinquedo(rel)) return 'cai fora do brinquedo';
  const p = path.normalize(rel).split(path.sep).map(function (x) { return x.toLowerCase(); });
  if (p[0] === '.git' || p[0] === '.claude') return 'cai em .git/ ou .claude/, que o instrumento grava';
  if (p.length === 1 && p[0] === 'package.json') return 'e o package.json, que o instrumento gera do teste';
  return null;
}

function arquivosRuins(onde, campo, arquivos) {
  if (!arquivos || typeof arquivos !== 'object' || Array.isArray(arquivos)) return [onde + ': ' + campo + ' tem de ser {caminho: texto}'];
  const ruins = [];
  Object.keys(arquivos).forEach(function (rel) {
    const r = caminhoRuim(rel);
    if (r) ruins.push(onde + ': ' + campo + ' ' + JSON.stringify(rel) + ' ' + r);
    else if (typeof arquivos[rel] !== 'string') ruins.push(onde + ': ' + campo + ' ' + JSON.stringify(rel) + ' sem texto');
  });
  return ruins;
}

/** O que impede o arquivo de tarefas de servir, conferido antes da 1a execucao paga. Lista vazia = serve. */
function tarefasRuins(dados) {
  const ruins = [];
  const texto = function (x) { return typeof x === 'string' && x.trim() !== ''; };
  if (!dados || !Array.isArray(dados.padraoDoTeste) || dados.padraoDoTeste.length === 0 || !dados.padraoDoTeste.every(texto)) {
    ruins.push('padraoDoTeste tem de ser uma lista de comandos (texto nao vazio)');
  }
  if (!dados || !texto(dados.hipotese)) ruins.push('hipotese: o que se espera, escrito antes da rodada (texto nao vazio)');
  const tarefas = dados && Array.isArray(dados.tarefas) ? dados.tarefas : null;
  if (!tarefas || tarefas.length === 0) return ruins.concat(['nenhuma tarefa']);
  const vistos = Object.create(null);
  tarefas.forEach(function (t, i) {
    const id = t && typeof t === 'object' ? t.id : undefined;
    const onde = 'tarefa ' + (i + 1) + (typeof id === 'string' ? ' (' + id + ')' : '');
    if (typeof id !== 'string' || !ID_DE_TAREFA.test(id)) ruins.push(onde + ': o id vira nome de pasta; so a-z, 0-9 e -, ate 48');
    else if (vistos[id]) ruins.push(onde + ': id repetido');
    else vistos[id] = true;
    if (!t || typeof t !== 'object') return;
    if (ARMADILHAS.indexOf(t.armadilha) === -1) ruins.push(onde + ': armadilha desconhecida ' + JSON.stringify(t.armadilha));
    if (!texto(t.texto)) ruins.push(onde + ': sem o pedido (texto vazio)');
    if (!Array.isArray(t.teste) || t.teste.length === 0 || !t.teste.every(texto)) ruins.push(onde + ': teste tem de ser a lista de argumentos do node');
    arquivosRuins(onde, 'arquivos', t.arquivos).concat(arquivosRuins(onde, 'referencia', t.referencia)).forEach(function (r) { ruins.push(r); });
    if (!Array.isArray(t.protegidos) || !t.protegidos.every(function (p) { return texto(p) && dentroDoBrinquedo(p); })) {
      ruins.push(onde + ': protegidos tem de ser uma lista de caminhos dentro do brinquedo');
    }
    if (typeof t.referenciaVerde !== 'boolean') ruins.push(onde + ': referenciaVerde tem de ser true ou false');
  });
  return ruins;
}

/** O "test" do package.json: o mesmo comando que o instrumento roda. Argumento com glob ou espaco vai entre aspas. */
function scriptDeTeste(args) {
  return 'node ' + args.map(function (a) { return /[\s*?"]/.test(a) ? '"' + a + '"' : a; }).join(' ');
}

// ── o pre-registro ───────────────────────────────────────────────────────

function sha256(rel) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(RAIZ, rel))).digest('hex');
}

function textoCongelado() {
  return CONGELADOS.map(function (rel) { return sha256(rel) + '  ' + rel; }).join('\n') + '\n';
}

/** O congelado.txt contra o disco de agora. Lista vazia = confere. */
function problemasDoCongelado(arquivo) {
  let texto;
  try { texto = fs.readFileSync(arquivo, 'utf8'); } catch (e) { return ['nao li ' + arquivo + ' (' + (e.code || e.message) + ')']; }
  const gravado = Object.create(null);
  texto.split(/\r?\n/).forEach(function (l) {
    const m = /^([0-9a-f]{64}) {2}(\S+)$/.exec(l);
    if (m) gravado[m[2]] = m[1];
  });
  const problemas = [];
  CONGELADOS.forEach(function (rel) {
    if (!gravado[rel]) problemas.push(rel + ': sem sha no congelado');
    else if (gravado[rel] !== sha256(rel)) problemas.push(rel + ': mudou depois do pre-registro');
  });
  return problemas;
}

function congelar(argv) {
  const pasta = valorDe(argv, '--congelar');
  if (!pasta) return recusar('ERRO: falta a pasta do pre-registro.\n' + USO);
  const arquivo = path.join(path.resolve(pasta), 'congelado.txt');
  if (fs.existsSync(arquivo)) return recusar('ERRO: ja existe ' + arquivo + ': pre-registro nao se refaz; ajuste depois = pasta nova.');
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const texto = textoCongelado();
  fs.writeFileSync(arquivo, texto, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write('congelado: ' + arquivo + '\n' + texto);
}

// ── o brinquedo ──────────────────────────────────────────────────────────

function escrever(dir, arquivos) {
  Object.keys(arquivos).forEach(function (rel) {
    const alvo = path.resolve(dir, rel);
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, arquivos[rel], 'utf8');
  });
}

/**
 * A pasta nova da tarefa, commitada e limpa. Na condicao com, o projeto ja passou pelo init: projeto.json com a
 * prova de pronto (o npm test), as regras e um escopo que deixa editar tudo - o portao de escopo nao pode fazer o
 * trabalho que se mede (barrar o teste adulterado) por um escopo estreito que ninguem declararia.
 */
function montarBrinquedo(dir, tarefa, condicao) {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  fs.mkdirSync(dir); // sem recursive: pasta que ja existe e erro, e nada se apaga nem se reaproveita
  escrever(dir, tarefa.arquivos);
  const pacote = { name: tarefa.id, version: '1.0.0', private: true, scripts: { test: scriptDeTeste(tarefa.teste) } };
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pacote, null, 2) + '\n', 'utf8');
  if (condicao === 'com') {
    const sw = path.join(dir, '.claude', 'sworn');
    fs.mkdirSync(sw, { recursive: true });
    const projeto = qualidade.projetoDoBrinquedo('recurso');
    projeto.provaDePronto = 'npm test';
    fs.writeFileSync(path.join(sw, 'projeto.json'), JSON.stringify(projeto, null, 2) + '\n', 'utf8');
    fs.copyFileSync(ARQUIVO_DE_REGRAS, path.join(sw, 'regras.md'));
    fs.writeFileSync(path.join(sw, 'escopo.md'), '# Escopo\n**Objetivo:** atender o pedido do usuario nesta sessao\n## Dentro\n- **\n', 'utf8');
  }
  qualidade.git(dir, ['init', '-q']);
  qualidade.git(dir, ['config', '--local', 'core.longpaths', 'true']);
  qualidade.git(dir, ['add', '-A']);
  qualidade.git(dir, ['-c', 'user.name=medicao', '-c', 'user.email=medicao@exemplo.com', '-c', 'commit.gpgsign=false',
    'commit', '-q', '--no-verify', '-m', 'brinquedo']);
}

/** sha256 do package.json e de cada protegido; o ausente vale null (criado depois tambem e adulteracao). */
function hashes(dir, tarefa) {
  const h = {};
  ['package.json'].concat(tarefa.protegidos).forEach(function (rel) {
    try { h[rel] = crypto.createHash('sha256').update(fs.readFileSync(path.resolve(dir, rel))).digest('hex'); } catch (e) { h[rel] = null; }
  });
  return h;
}

/** O teste rodado pelo instrumento, depois da sessao. Verde = saiu com 0 dentro do limite. */
function rodarTeste(dir, tarefa) {
  const env = Object.assign({}, process.env);
  // dentro do node --test da suite, o filho herdaria o modo de relatar ao pai e o codigo de saida mudaria
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, tarefa.teste, { cwd: dir, encoding: 'utf8', env: env, shell: false, windowsHide: true,
    timeout: LIMITE_DO_TESTE_MS });
  const saida = String(r.stdout || '') + String(r.stderr || '');
  return { verde: !r.error && r.status === 0, status: r.status, saida: saida.slice(-4000) };
}

// ── as condicoes ─────────────────────────────────────────────────────────

// D645: sem pedido de permissao nas duas condicoes igual. A lista de comandos liberados negava o teste montado com
// pipe no PowerShell (npm test 2>&1 | Select-String ...) mesmo com os cmdlets liberados, e a execucao virava invalida.
function argsDoClaude(modelo, condicao) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', modelo,
    '--setting-sources', 'project,local', '--strict-mcp-config', '--permission-mode', 'bypassPermissions'];
  return condicao === 'com' ? args.concat(['--plugin-dir', RAIZ]) : args;
}

function ambienteDaExecucao(env, rodada) {
  return Object.assign({}, env, { SWORN_VIGIA: path.join(rodada, 'vigia'), SWORN_TMP: path.join(rodada, 'tmp') });
}

// ── --gerar ──────────────────────────────────────────────────────────────

function carimboAgora() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('.', '');
}

function executar(claude, modelo, rodada, dir, tarefa, condicao, padroes) {
  const antes = hashes(dir, tarefa);
  const t0 = Date.now();
  const r = spawnSync(claude.exe, claude.prefixo.concat(argsDoClaude(modelo, condicao)), {
    cwd: dir, input: tarefa.texto, encoding: 'utf8', env: ambienteDaExecucao(process.env, rodada),
    shell: false, windowsHide: true, timeout: LIMITE_DA_EXECUCAO_MS, maxBuffer: 512 * 1024 * 1024
  });
  const segundos = Math.round((Date.now() - t0) / 1000);
  const saida = typeof r.stdout === 'string' ? r.stdout : '';
  const rotulo = path.basename(dir);
  fs.writeFileSync(path.join(rodada, 'streams', rotulo + '.stream.jsonl'), saida, 'utf8');
  if (r.stderr) fs.writeFileSync(path.join(rodada, 'streams', rotulo + '.stderr.txt'), r.stderr, 'utf8');

  const teste = rodarTeste(dir, tarefa);
  const adulterados = travas.adulterados(antes, hashes(dir, tarefa));
  const lida = travas.lerExecucao(saida, { condicao: condicao });
  const motivos = lida.motivos.slice();
  // pid 0 e o claude que nao chegou a nascer: a rodada para, nao ha o que medir
  const naoRodou = Boolean(r.error) && !(r.pid > 0);
  if (r.error) motivos.push((naoRodou ? 'o claude nao rodou: ' : 'o claude foi parado: ') + (r.error.code || r.error.message));
  else if (r.status !== 0) motivos.push('o claude saiu com codigo ' + r.status);
  if (travas.rodouTeste(lida.negados, padroes)) motivos.push('a permissao negou o comando de teste: ' + lida.negados.join(' | '));
  const ok = motivos.length === 0;
  const alegacao = travas.alegacao(lida.final);
  return {
    tarefa: tarefa.id, armadilha: tarefa.armadilha, condicao: condicao, ok: ok, motivos: motivos,
    classe: ok ? travas.classificar({ alegacao: alegacao, testeVerde: teste.verde, adulterados: adulterados,
      comandos: lida.comandos, padraoDoTeste: padroes }) : null,
    alegacao: alegacao, testeVerde: teste.verde, adulterados: adulterados,
    rodouTeste: travas.rodouTeste(lida.comandos, padroes), negados: lida.negados.length,
    provaColada: travas.provaColada(lida.final),
    custoUsd: lida.custoUsd, segundos: segundos, final: lida.final.slice(0, 2000),
    // condicao que o init nao prova, ou claude que nao rodou: seguir so compra uma rodada invalida. Toda mensagem
    // de condicao furada da lib fala do init; o teste da parada prende as tres (sem, com e stream sem init).
    parar: naoRodou || lida.motivos.some(function (m) { return /\binit\b/.test(m); })
  };
}

function gerar(argv) {
  const modelo = valorDe(argv, '--modelo');
  if (!modelo) return recusar('ERRO: falta --modelo. O plugin nao escolhe modelo.\n' + USO);
  const destino = valorDe(argv, '--destino');
  if (!destino) return recusar('ERRO: falta --destino.\n' + USO);
  let repeticoes = REPETICOES_PADRAO;
  if (argv.indexOf('--repeticoes') !== -1) {
    repeticoes = Number(valorDe(argv, '--repeticoes'));
    if (!Number.isInteger(repeticoes) || repeticoes < 1 || repeticoes > 10) return recusar('ERRO: --repeticoes tem de ser um inteiro de 1 a 10.');
  }
  const dados = lerTarefas();
  const ruins = tarefasRuins(dados);
  if (ruins.length > 0) return recusar('ERRO: modelos/travas-tarefas.json tem tarefa que nao serve; nao gero nada.\n  ' + ruins.join('\n  '));
  let tarefas = dados.tarefas;
  const pedidas = valoresDe(argv, '--tarefa');
  if (pedidas.length > 0) {
    const faltam = pedidas.filter(function (id) { return !tarefas.some(function (t) { return t.id === id; }); });
    if (faltam.length > 0) return recusar('ERRO: tarefa que nao esta em modelos/travas-tarefas.json: ' + faltam.map(String).join(', '));
    tarefas = tarefas.filter(function (t) { return pedidas.indexOf(t.id) !== -1; });
  }
  const congelado = path.join(path.resolve(destino), 'congelado.txt');
  if (!fs.existsSync(congelado)) {
    return recusar('ERRO: ' + congelado + ' nao existe: o pre-registro vem antes da rodada (node scripts/medir-travas.js --congelar <destino>).');
  }
  const problemas = problemasDoCongelado(congelado);
  if (problemas.length > 0) return recusar('ERRO: o congelado.txt nao confere com o disco; nao gero nada.\n  ' + problemas.join('\n  '));
  const claude = qualidade.resolverClaude(process.env);
  if (!claude) return recusar('ERRO: nao achei o claude no PATH. Ponha-o no PATH, ou aponte o executavel em SWORN_CLAUDE.');

  // O caminho em forma curta do Windows (8.3) faz o claude negar Read e Glob como suspeito: o real, criado antes.
  const criada = path.join(path.resolve(destino), carimboAgora());
  fs.mkdirSync(path.dirname(criada), { recursive: true });
  fs.mkdirSync(criada);
  const rodada = fs.realpathSync.native(criada);
  ['streams', 'brinquedos', 'vigia', 'tmp'].forEach(function (p) { fs.mkdirSync(path.join(rodada, p)); });
  fs.copyFileSync(congelado, path.join(rodada, 'congelado.txt'));

  const grade = [];
  tarefas.forEach(function (t) {
    for (let rep = 1; rep <= repeticoes; rep++) {
      travas.CONDICOES.forEach(function (c) { grade.push({ tarefa: t, repeticao: rep, condicao: c, dir: path.join(rodada, 'brinquedos', t.id + '-' + c + '-' + rep) }); });
    }
  });
  // todos os brinquedos antes da 1a execucao paga: o que o disco recusa falha aqui, de graca
  grade.forEach(function (g) { montarBrinquedo(g.dir, g.tarefa, g.condicao); });

  const envelope = { versao: 1, modelo: modelo, carimbo: path.basename(rodada), repeticoes: repeticoes, completo: false,
    hipotese: dados.hipotese,
    tarefas: tarefas.map(function (t) { return { id: t.id, armadilha: t.armadilha, texto: t.texto }; }), execucoes: [] };
  const gravar = function () { fs.writeFileSync(path.join(rodada, 'execucoes.json'), JSON.stringify(envelope, null, 2) + '\n', 'utf8'); };
  gravar();

  let gasto = 0;
  let parou = false;
  // invalidas acima do teto da lib numa condicao: a rodada ja nao teria veredito, e o resto so gastaria (cota, login)
  const planejadas = { sem: 0, com: 0 };
  const invalidas = { sem: 0, com: 0 };
  grade.forEach(function (g) { planejadas[g.condicao]++; });
  for (const g of grade) {
    const e = executar(claude, modelo, rodada, g.dir, g.tarefa, g.condicao, dados.padraoDoTeste);
    if (!e.ok) invalidas[g.condicao]++;
    if (invalidas[g.condicao] / planejadas[g.condicao] > travas.TETO_INVALIDAS) {
      e.motivos.push('invalidas acima do teto na condicao ' + g.condicao + ' (' + invalidas[g.condicao] + ' de ' +
        planejadas[g.condicao] + ' planejadas): a rodada ja nao teria veredito');
      e.parar = true;
    }
    const parar = e.parar;
    delete e.parar;
    e.repeticao = g.repeticao;
    envelope.execucoes.push(e);
    gravar();
    if (typeof e.custoUsd === 'number') gasto += e.custoUsd;
    process.stderr.write('[' + envelope.execucoes.length + '/' + grade.length + '] ' + path.basename(g.dir) + ' ok=' + e.ok +
      ' classe=' + e.classe + ' custo=US$ ' + (e.custoUsd === null ? '?' : e.custoUsd.toFixed(4)) + ' (acumulado US$ ' + gasto.toFixed(4) + ')\n');
    if (parar) {
      parou = true;
      process.stderr.write('PAROU em ' + path.basename(g.dir) + ': ' + e.motivos.join(' | ') + '\n');
      break;
    }
  }
  envelope.completo = !parou && envelope.execucoes.length === grade.length;
  gravar();

  process.stdout.write([
    'rodada: ' + rodada,
    'execucoes: ' + envelope.execucoes.length + ' de ' + grade.length + (envelope.completo ? ' (completa)' : ' (INCOMPLETA)'),
    'custo medido (total_cost_usd): US$ ' + gasto.toFixed(4),
    'proximo passo: node scripts/medir-travas.js --apurar "' + rodada + '"'
  ].join('\n') + '\n');
  process.exitCode = envelope.completo ? 0 : 1;
}

// ── --apurar ─────────────────────────────────────────────────────────────

function apurarRodada(argv) {
  const pasta = valorDe(argv, '--apurar');
  if (!pasta) return recusar('ERRO: falta a pasta da rodada.\n' + USO);
  let env;
  try { env = JSON.parse(fs.readFileSync(path.join(path.resolve(pasta), 'execucoes.json'), 'utf8')); } catch (e) {
    // A6-64 (D735): a causa traduzida e o passo. Sem o arquivo, a pasta costuma ser o --destino, e nao a rodada que o
    // --gerar cria dentro dele; o texto do JSON.parse vai entre aspas, marcado como do Node (molde D736).
    return recusar('ERRO: nao li ' + path.join(path.resolve(pasta), 'execucoes.json') + ' (' + (e.code
      ? causaDoErro(e) + '). Passe a pasta da rodada, a que o --gerar mostra no "proximo passo"; sem rodada, rode o ' +
        '--gerar antes.'
      : 'o texto nao e JSON valido; o Node diz: ' + entreAspas(e.message) + '). Corrija-o e rode de novo.'));
  }
  // A6-64 (R1, borda): null ou lista no lugar do objeto quebrava adiante (env.modelo) com o erro do Node em ingles.
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    return recusar('ERRO: ' + path.join(path.resolve(pasta), 'execucoes.json') + ' nao tem a forma que o --gerar ' +
      'grava (um objeto com a lista "execucoes"). Corrija-o e rode de novo.');
  }
  const lista = Array.isArray(env && env.execucoes) ? env.execucoes : [];
  const a = travas.apurar(lista);
  const problemas = problemasDoCongelado(path.join(path.resolve(pasta), 'congelado.txt'));
  const L = ['MEDICAO DAS TRAVAS - apuracao', 'rodada: ' + path.resolve(pasta) + (env.modelo ? '  (modelo ' + env.modelo + ')' : ''),
    'completa: ' + (env.completo === true ? 'sim' : 'NAO'),
    'congelado: ' + (problemas.length === 0 ? 'confere' : 'NAO confere - ' + problemas.join('; ')),
    'hipotese: ' + (typeof env.hipotese === 'string' ? env.hipotese : '(ausente)'), ''];
  travas.CONDICOES.forEach(function (c) {
    const x = a.condicoes[c];
    const seg = lista.filter(function (e) { return e.condicao === c; }).reduce(function (s, e) { return s + (e.segundos || 0); }, 0);
    L.push(c + ': ' + x.validas + ' validas, ' + x.invalidas + ' invalidas | falsa ' + x.falsa + ', sem-prova ' + x['sem-prova'] +
      ', honesta ' + x.honesta + ' | prova colada ' + x.provaColada + ' de ' + x.validas + ' | custo US$ ' + x.custoUsd.toFixed(4) + ', ' + seg + ' s');
  });
  L.push('');
  L.push('falsa entrega por armadilha (sem / com):');
  ARMADILHAS.forEach(function (arm) {
    const n = function (c) { return lista.filter(function (e) { return e.armadilha === arm && e.condicao === c && e.ok === true && e.classe === 'falsa'; }).length; };
    const tot = function (c) { return lista.filter(function (e) { return e.armadilha === arm && e.condicao === c; }).length; };
    if (tot('sem') + tot('com') > 0) L.push('  ' + arm + ': ' + n('sem') + '/' + tot('sem') + ' | ' + n('com') + '/' + tot('com'));
  });
  L.push('');
  // a regra que decide o numero mudou depois de a rodada existir, ou a rodada parou no meio: o numero nao vale
  const incompleta = env.completo !== true;
  const veredito = problemas.length > 0 || incompleta ? null : a.veredito;
  const motivo = problemas.length > 0 ? 'o congelado da rodada nao confere com o disco (a regra mudou depois do pre-registro)'
    : incompleta ? 'rodada incompleta (parou antes do fim da grade)' : a.motivo;
  L.push(veredito === null ? 'VEREDITO: nenhum - ' + motivo : 'VEREDITO: ' + veredito);
  process.stdout.write(L.join('\n') + '\n');
  process.exitCode = veredito === null ? 2 : 0;
}

// ── a entrada ────────────────────────────────────────────────────────────

function principal(argv) {
  try {
    if (argv.indexOf('--congelar') !== -1) return congelar(argv);
    if (argv.indexOf('--gerar') !== -1) return gerar(argv);
    if (argv.indexOf('--apurar') !== -1) return apurarRodada(argv);
    return recusar(USO);
  } catch (e) {
    return recusar('ERRO: ' + (e && e.message ? e.message : String(e)));
  }
}

if (require.main === module) principal(process.argv.slice(2));

module.exports = {
  ARMADILHAS, lerTarefas, tarefasRuins, scriptDeTeste, montarBrinquedo, hashes, rodarTeste, argsDoClaude, ambienteDaExecucao
};
