#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const medicao = require('./lib/medicao.js');
const projetoLib = require('./lib/projeto.js');

/**
 * A MEDICAO A/B DO RECURSO DE QUALIDADE DE RESPOSTA (docs/qualidade-de-resposta.md, secao 6).
 *
 * Tres modos, no molde do experimento da D83: a parte mecanica aqui, o julgamento fora.
 *
 *   --gerar --modelo <nome> --destino <pasta> [--prompt <id>]
 *       12 prompts x 3 condicoes (padrao, caveman, recurso), cada execucao num repositorio de
 *       brinquedo NOVO em <destino>/<carimbo>/<prompt>-<condicao>/. Grava o stream bruto e o
 *       geracoes.json em .claude/sworn/medicao-qr/<carimbo>/ da pasta de onde roda. Nada se apaga.
 *   --pares <pasta da rodada>
 *       Monta os pares cegos (A.txt, B.txt, vereditos/) e imprime as instrucoes do juiz. O mapa de quem
 *       e quem fica em <rodada>/mapa.json, FORA de pares/.
 *   --veredito <pasta da rodada>
 *       Le geracoes.json e pares/<par>/vereditos/clareza.json e apura. Exit 0 com veredito; 2 quando
 *       faltam julgamentos - juiz que nao respondeu nunca e empate.
 *
 * O MODELO VEM POR --modelo (D138): o codigo do plugin nunca escolhe modelo. O `claude` e o do PATH, ou
 * o de SWORN_CLAUDE (a porta dos testes, que o trocam por um de mentira). No Windows o PATH tem o
 * atalho `claude.cmd` do npm, que o Node recusa sem shell: o atalho e lido e o executavel de verdade
 * vira o comando, sem shell, para o texto livre e o caminho com espaco nao precisarem de aspas.
 * O ambiente segue inteiro para o processo filho: o claude lancado sem a variavel que aponta o bash do
 * git faz o hook de SessionStart de outro plugin falhar, e o instrumento acusa isso como INVALIDO.
 */

const RAIZ = path.join(__dirname, '..');
const ARQUIVO_DE_PROMPTS = path.join(RAIZ, 'modelos', 'qualidade-prompts.json');
const ARQUIVO_DE_REGRAS = path.join(RAIZ, 'modelos', 'regras.md');
const PASTA_DA_MEDICAO = ['.claude', 'sworn', 'medicao-qr'];
// Uma execucao com ferramentas pode levar minutos; passar disto e execucao presa, nao lenta.
const LIMITE_DA_EXECUCAO_MS = 15 * 60 * 1000;
// A montagem dos pares leva segundos: mais velha que isto esta morta, mesmo com o pid vivo (o Windows reaproveita pid).
const IDADE_DA_MONTAGEM_MORTA_MS = 10 * 60 * 1000;

const USO = [
  'uso:',
  '  node scripts/medir-qualidade.js --gerar --modelo <nome> --destino <pasta> [--prompt <id>]',
  '  node scripts/medir-qualidade.js --pares <pasta da rodada>',
  '  node scripts/medir-qualidade.js --veredito <pasta da rodada>',
  '',
  '--modelo e obrigatorio: o plugin nao escolhe modelo. --prompt roda so um prompt (o ensaio curto).'
].join('\n');

function valorDe(argv, nome) {
  const i = argv.indexOf(nome);
  if (i === -1) return null;
  const v = argv[i + 1];
  return (typeof v === 'string' && v.trim() !== '' && v.indexOf('--') !== 0) ? v : null;
}

function recusar(texto) {
  process.stderr.write(texto + '\n');
  process.exitCode = 1;
}

// ── achar o claude ───────────────────────────────────────────────────────

function ehArquivo(p) {
  try { return fs.statSync(p).isFile(); } catch (e) { return false; }
}

/** O que o atalho .cmd do npm chama de verdade: a ultima referencia a %dp0% que termina em executavel ou script. */
function destinoDoAtalho(atalho) {
  let texto;
  try { texto = fs.readFileSync(atalho, 'utf8'); } catch (e) { return null; }
  const re = /"%(?:~dp0|dp0%)[\\/]*([^"]+\.(?:exe|cjs|mjs|js))"/ig;
  let achado = null;
  let m;
  while ((m = re.exec(texto)) !== null) achado = m[1];
  if (!achado) return null;
  const alvo = path.join(path.dirname(atalho), achado);
  return ehArquivo(alvo) ? alvo : null;
}

function comoRodar(arquivo) {
  const ext = path.extname(arquivo).toLowerCase();
  if (ext === '.js' || ext === '.cjs' || ext === '.mjs') return { exe: process.execPath, prefixo: [arquivo] };
  if (ext === '.cmd' || ext === '.bat') {
    const alvo = destinoDoAtalho(arquivo);
    return alvo ? comoRodar(alvo) : null;
  }
  return { exe: arquivo, prefixo: [] };
}

/**
 * `{ exe, prefixo }` (o comando e os argumentos que vem antes dos do claude; sem shell), ou null. `so` entra por
 * parametro para o caminho do Windows e o dos outros se exercitarem de qualquer maquina.
 */
function resolverClaude(env, so) {
  const e = env || process.env;
  const sistema = so || process.platform;
  if (e.SWORN_CLAUDE) {
    // relativo a pasta de onde roda: o claude roda com a pasta do brinquedo como atual, e la o relativo nao existe
    const apontado = path.resolve(e.SWORN_CLAUDE);
    return ehArquivo(apontado) ? comoRodar(apontado) : null;
  }
  const dirs = String(e.PATH || e.Path || '').split(path.delimiter).filter(Boolean);
  const nomes = sistema === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
  for (const dir of dirs) {
    for (const nome of nomes) {
      const arquivo = path.join(dir, nome);
      if (!ehArquivo(arquivo)) continue;
      const r = comoRodar(arquivo);
      if (r) return r;
    }
  }
  return null;
}

// ── prompts e brinquedo ──────────────────────────────────────────────────

function lerPrompts() {
  const dados = JSON.parse(fs.readFileSync(ARQUIVO_DE_PROMPTS, 'utf8'));
  return Array.isArray(dados.prompts) ? dados.prompts : [];
}

function carimboAgora() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('.', '');
}

/** O projeto.json minimo do brinquedo; so a chave do recurso muda entre as condicoes. */
function projetoDoBrinquedo(condicao) {
  const p = projetoLib.montar({}, {
    modeloDeAmeaca: 'interno', fontesCanonicas: [], provaDePronto: 'node -e 1', intocaveis: [],
    quemDecide: 'dono', marchas: { aaa: [], padrao: [], rapida: [] }
  });
  const v = projetoLib.validar(p);
  if (!v.ok) throw new Error('o projeto.json do brinquedo nao valida: ' + v.erros.join('; '));
  if (condicao !== 'recurso') p.qualidadeDeResposta = false;
  return p;
}

function dentroDoBrinquedo(dir, rel) {
  return path.resolve(dir, rel).indexOf(path.resolve(dir) + path.sep) === 0;
}

/** O arquivo cai em .claude/sworn/ ou .git/ do brinquedo (ou e a propria pasta)? Sem caixa no Windows. */
function caiNoQueAMedicaoGrava(base, rel) {
  const partes = path.relative(path.resolve(base), path.resolve(base, rel)).split(path.sep);
  const p = process.platform === 'win32' ? partes.map(function (x) { return x.toLowerCase(); }) : partes;
  return p[0] === '.git' || (p[0] === '.claude' && p[1] === 'sworn');
}

/**
 * Os `arquivos` de cada prompt, conferidos antes da 1a execucao: o brinquedo do prompt 7 so se monta depois de 18
 * execucoes pagas. `base` e uma pasta de brinquedo de exemplo, no mesmo disco do destino.
 */
function arquivosRuins(prompts, base) {
  const ruins = [];
  prompts.forEach(function (p, i) {
    if (!p || typeof p !== 'object' || p.arquivos === undefined || p.arquivos === null) return;
    const onde = 'prompt ' + (i + 1) + (typeof p.id === 'string' ? ' (' + JSON.stringify(p.id) + ')' : '');
    const arquivos = p.arquivos;
    if (typeof arquivos !== 'object' || Array.isArray(arquivos)) {
      ruins.push(onde + ': arquivos tem de ser um objeto {caminho: texto}');
      return;
    }
    Object.keys(arquivos).forEach(function (rel) {
      if (!dentroDoBrinquedo(base, rel)) ruins.push(onde + ': o arquivo ' + JSON.stringify(rel) + ' cai fora do brinquedo');
      else if (typeof arquivos[rel] !== 'string') ruins.push(onde + ': o arquivo ' + JSON.stringify(rel) + ' nao tem texto');
      else if (caiNoQueAMedicaoGrava(base, rel)) {
        ruins.push(onde + ': o arquivo ' + JSON.stringify(rel) + ' cai em .claude/sworn/ (ou .git/) do brinquedo, que a medicao grava');
      }
    });
  });
  return ruins;
}

function montarBrinquedo(dir, prompt, condicao) {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  fs.mkdirSync(dir); // sem recursive: pasta que ja existe e erro, e nada se apaga nem se reaproveita
  const esq = path.join(dir, '.claude', 'sworn');
  fs.mkdirSync(esq, { recursive: true });
  fs.writeFileSync(path.join(esq, 'projeto.json'), JSON.stringify(projetoDoBrinquedo(condicao), null, 2) + '\n', 'utf8');
  fs.copyFileSync(ARQUIVO_DE_REGRAS, path.join(esq, 'regras.md'));
  // O projeto simulado esta no meio de uma tarefa, com escopo ja declarado: sem isto o portao de escopo
  // barra o Edit, e o claude nao deixa o modelo escrever em .claude/ no modo print (ensaio real).
  fs.writeFileSync(path.join(esq, 'escopo.md'),
    '# Escopo\n**Objetivo:** atender o pedido do usuario nesta sessao\n## Dentro\n- src/**\n', 'utf8');
  const arquivos = prompt.arquivos || {};
  Object.keys(arquivos).forEach(function (rel) {
    const alvo = path.resolve(dir, rel);
    if (!dentroDoBrinquedo(dir, rel)) throw new Error('arquivo do prompt fora do brinquedo: ' + rel);
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, arquivos[rel], 'utf8');
  });
  git(dir, ['init', '-q']);
  // Na config do repositorio, e nao so no -c do helper: vale tambem para o git que o modelo rodar.
  git(dir, ['config', '--local', 'core.longpaths', 'true']);
  // Nasce limpo: arquivo untracked o portao do sworn le como "de outra frente" e barra o Edit do modelo.
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'user.name=medicao', '-c', 'user.email=medicao@exemplo.com', '-c', 'commit.gpgsign=false',
    'commit', '-q', '--no-verify', '-m', 'brinquedo']);
}

// core.longpaths: o brinquedo mora em pasta funda (a temporaria do sistema, com o nome curto ja expandido),
// e o caminho de .git/objects passa do limite antigo do Windows - medido no ensaio real: "Filename too long".
function git(dir, args) {
  const g = spawnSync('git', ['-c', 'core.longpaths=true'].concat(args),
    { cwd: dir, encoding: 'utf8', shell: false, timeout: 30000, windowsHide: true });
  if (g.error || g.status !== 0) throw new Error('git ' + args.join(' ') + ' falhou em ' + dir + (g.stderr ? ': ' + g.stderr.trim() : ''));
}

// ── a transcricao da sessao ─────────────────────────────────────────────

/**
 * O arquivo `<session_id>.jsonl` em `<pasta de config>/projects/<qualquer subpasta>`. O nome da subpasta
 * nao se calcula (e derivado do caminho do projeto, por regra que muda): procura-se o arquivo em todas.
 * A pasta de config e CLAUDE_CONFIG_DIR, ou `.claude` na pasta pessoal (`casa` entra por parametro).
 */
function acharTranscricao(sessionId, env, casa) {
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(sessionId)) return null;
  const e = env || process.env;
  const config = e.CLAUDE_CONFIG_DIR || path.join(casa || os.homedir(), '.claude');
  const projetos = path.join(config, 'projects');
  let subs;
  try { subs = fs.readdirSync(projetos, { withFileTypes: true }); } catch (err) { return null; }
  for (const sub of subs) {
    if (!sub.isDirectory()) continue;
    const arquivo = path.join(projetos, sub.name, sessionId + '.jsonl');
    if (ehArquivo(arquivo)) return arquivo;
  }
  return null;
}

function linhasDoArquivo(arquivo) {
  try { return fs.readFileSync(arquivo, 'utf8').split(/\r?\n/); } catch (e) { return null; }
}

// ── --gerar ──────────────────────────────────────────────────────────────

function executar(claude, modelo, dir, prompt, condicao) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', modelo,
    '--plugin-dir', RAIZ, '--permission-mode', 'acceptEdits'];
  const r = spawnSync(claude.exe, claude.prefixo.concat(args), {
    cwd: dir, input: medicao.perguntaDaCondicao(prompt.texto, condicao), encoding: 'utf8', env: process.env,
    shell: false, windowsHide: true, timeout: LIMITE_DA_EXECUCAO_MS, maxBuffer: 512 * 1024 * 1024
  });
  return r;
}

function gerar(argv) {
  const modelo = valorDe(argv, '--modelo');
  if (!modelo) return recusar('ERRO: falta --modelo. O plugin nao escolhe modelo.\n' + USO);
  const destino = valorDe(argv, '--destino');
  if (!destino) return recusar('ERRO: falta --destino.\n' + USO);

  let prompts = lerPrompts();
  // o id vira nome da pasta do brinquedo: conferido antes da 1a execucao, e nao so no --pares, depois do gasto
  const ruins = promptsRuins(prompts).concat(arquivosRuins(prompts, path.resolve(destino, 'brinquedo')));
  if (ruins.length > 0) return recusar('ERRO: modelos/qualidade-prompts.json tem prompt que nao serve; nao gero nada.\n  ' + ruins.join('\n  '));
  const ids = prompts.map(function (p) { return p.id; }); // o numero do prompt nas mensagens e o do arquivo
  const so = valorDe(argv, '--prompt');
  if (argv.indexOf('--prompt') !== -1) {
    if (!so) return recusar('ERRO: --prompt sem valor. Passe o id: --prompt <id>.');
    prompts = prompts.filter(function (p) { return p.id === so; });
    if (prompts.length === 0) return recusar('ERRO: --prompt "' + so + '" nao esta em modelos/qualidade-prompts.json.');
  }
  if (prompts.length === 0) return recusar('ERRO: nenhum prompt em modelos/qualidade-prompts.json.');

  const claude = resolverClaude(process.env);
  if (!claude) {
    // com a variavel, o PATH nem e olhado: a mensagem diz o que a variavel aponta
    const apontado = process.env.SWORN_CLAUDE;
    if (apontado) {
      const dica = /^["'].*["']$/.test(apontado) ? ' Dica: tire as aspas do valor.' : '';
      return recusar('ERRO: nao achei o claude: SWORN_CLAUDE aponta para ' + apontado + (ehArquivo(apontado)
        ? ', um atalho que nao diz que executavel chama.' : ', que nao existe (ou nao e arquivo).') + dica);
    }
    return recusar('ERRO: nao achei o claude no PATH. Ponha-o no PATH, ou aponte o executavel em SWORN_CLAUDE.');
  }

  const carimbo = carimboAgora();
  const rodada = path.join(process.cwd(), PASTA_DA_MEDICAO[0], PASTA_DA_MEDICAO[1], PASTA_DA_MEDICAO[2], carimbo);
  fs.mkdirSync(path.dirname(rodada), { recursive: true });
  fs.mkdirSync(rodada);

  const envelope = {
    versao: 1, modelo: modelo, carimbo: carimbo, completo: false,
    prompts: prompts.map(function (p) { return { id: p.id, tipo: p.tipo, idioma: p.idioma, texto: p.texto }; }),
    geracoes: []
  };
  const gravar = function () {
    fs.writeFileSync(path.join(rodada, 'geracoes.json'), JSON.stringify(envelope, null, 2) + '\n', 'utf8');
  };
  gravar();

  // O caminho em forma curta do Windows (8.3, com til e numero) faz o claude negar Read e Glob como suspeito.
  // A pasta e criada antes para o caminho real existir; fora do Windows isto e identidade.
  fs.mkdirSync(path.join(path.resolve(destino), carimbo), { recursive: true });
  const base = fs.realpathSync.native(path.join(path.resolve(destino), carimbo));

  // todos os brinquedos antes da 1a execucao: o arquivo do prompt que so o disco recusa (um arquivo e a pasta do
  // outro, nome que o sistema nao aceita) falha aqui, sem execucao paga. Os que sobrarem de uma rodada que parou ficam
  for (const prompt of prompts) {
    for (const condicao of medicao.CONDICOES) {
      try {
        montarBrinquedo(path.join(base, prompt.id + '-' + condicao), prompt, condicao);
      } catch (e) {
        throw new Error('prompt ' + (ids.indexOf(prompt.id) + 1) + ' (' + JSON.stringify(prompt.id) + '), brinquedo ' + condicao +
          ': ' + (e && e.message ? e.message : String(e)));
      }
    }
  }

  const total = prompts.length * medicao.CONDICOES.length;
  let parou = false;
  for (const prompt of prompts) {
    for (const condicao of medicao.CONDICOES) {
      if (parou) break;
      const rotulo = prompt.id + '-' + condicao;
      const dir = path.join(base, rotulo);
      const r = executar(claude, modelo, dir, prompt, condicao);
      const saida = typeof r.stdout === 'string' ? r.stdout : '';
      // a execucao ja foi paga: a evidencia que o disco recusa (cheio, caminho longo) nao leva junto o texto e os
      // tokens, que vao para o geracoes.json (e, se nem ele grava, para a mensagem de erro). Sem a evidencia a
      // geracao nao vale, e a rodada para
      const naoGravou = [];
      const guardar = function (oQue, fazer, conferir) {
        try { fazer(); } catch (e) { naoGravou.push('nao gravei ' + oQue + ' (' + (e.code || e.message) + ')' + (conferir ? ': ' + conferir : '')); }
      };
      guardar('o stream bruto', function () { fs.writeFileSync(path.join(rodada, rotulo + '.stream.jsonl'), saida, 'utf8'); });
      if (r.stderr) guardar('o stderr', function () { fs.writeFileSync(path.join(rodada, rotulo + '.stderr.txt'), r.stderr, 'utf8'); });

      // O caveman pedido por stdin nao deixa rastro no stream: a prova e a transcricao da sessao.
      // Ela e copiada para a rodada, como evidencia.
      // a leitura que lanca nao leva junto a execucao paga: vira motivo, e a geracao se grava como as outras
      const naoLi = [];
      let sessionId = null;
      try { sessionId = medicao.sessionIdDe(saida); } catch (e) { naoLi.push('nao li o session_id da saida do claude (' + (e.code || e.message) + ')'); }
      const arquivoDaTranscricao = acharTranscricao(sessionId, process.env);
      const transcricao = arquivoDaTranscricao ? linhasDoArquivo(arquivoDaTranscricao) : null;
      if (arquivoDaTranscricao) {
        guardar('a copia da transcricao', function () { fs.copyFileSync(arquivoDaTranscricao, path.join(rodada, rotulo + '.transcricao.jsonl')); },
          'a copia e a prova de que o caveman foi aplicado, e sem ela a geracao nao vale; confira o espaco em disco, o caminho longo e a permissao da pasta da rodada');
      }

      let lida = { ok: false, texto: null, aplicou: false, outputTokens: null, motivos: [] };
      try {
        lida = medicao.lerExecucao(saida, { condicao: condicao, marcador: medicao.MARCADOR_DO_BLOCO, transcricao: transcricao });
      } catch (e) { naoLi.push('nao li a saida do claude (' + (e.code || e.message) + ')'); }
      const motivos = lida.motivos.slice();
      let ok = lida.ok;
      if (naoLi.length > 0) { ok = false; naoLi.forEach(function (m) { motivos.push(m); }); }
      if (r.error) {
        ok = false;
        const codigo = r.error.code || r.error.message;
        // o spawnSync tambem preenche error quando para um claude que ja rodou; pid 0 e o que nao chegou a nascer
        const nasceu = r.pid > 0 || r.status !== null || Boolean(r.signal);
        if (codigo === 'ETIMEDOUT') motivos.push('o claude rodou e foi parado ao passar de ' + (LIMITE_DA_EXECUCAO_MS / 60000) + ' min (ETIMEDOUT)');
        else if (codigo === 'ENOBUFS') motivos.push('o claude rodou e foi parado: a saida passou do limite (ENOBUFS)');
        else if (nasceu) motivos.push('o claude rodou e foi parado (' + codigo + ')');
        else motivos.push('o claude nao rodou: ' + codigo);
      }
      else if (r.status !== 0) { ok = false; motivos.push('o claude saiu com codigo ' + r.status + (r.signal ? ' (sinal ' + r.signal + ')' : '')); }
      if (naoGravou.length > 0) { ok = false; naoGravou.forEach(function (m) { motivos.push(m); }); }
      envelope.geracoes.push({
        prompt: prompt.id, condicao: condicao, ok: ok, texto: lida.texto, aplicou: lida.aplicou,
        outputTokens: lida.outputTokens, motivos: motivos
      });
      try { gravar(); } catch (e) {
        throw new Error('nao gravei o geracoes.json depois da execucao paga de ' + rotulo + ' (' + (e.code || e.message) +
          '); a geracao, para nao se perder: ' + JSON.stringify(envelope.geracoes[envelope.geracoes.length - 1]));
      }
      process.stderr.write('[' + envelope.geracoes.length + '/' + total + '] ' + rotulo + ' ok=' + ok +
        ' aplicou=' + lida.aplicou + ' tokens=' + lida.outputTokens + '\n');
      if (!ok || !lida.aplicou) {
        // Continuar gastando sobre uma condicao que nao se aplicou so compra uma rodada INVALIDA.
        parou = true;
        process.stderr.write('PAROU em ' + rotulo + ': ' + motivos.join(' | ') + '\n');
      }
    }
  }
  envelope.completo = !parou && envelope.geracoes.length === total;
  try { gravar(); } catch (e) {
    throw new Error('nao gravei o geracoes.json no fim da rodada (' + (e.code || e.message) +
      '); as geracoes ja estao no arquivo, gravadas uma a uma: so o campo completo ficou sem atualizar');
  }

  const L = [];
  L.push('rodada: ' + rodada);
  L.push('geracoes: ' + envelope.geracoes.length + ' de ' + total + (envelope.completo ? ' (completa)' : ' (INCOMPLETA)'));
  if (envelope.completo) L.push('proximo passo: node scripts/medir-qualidade.js --pares "' + rodada + '"');
  process.stdout.write(L.join('\n') + '\n');
  process.exitCode = envelope.completo ? 0 : 1;
}

// ── a rodada gravada ─────────────────────────────────────────────────────

function lerRodada(pasta) {
  let ger;
  try { ger = JSON.parse(fs.readFileSync(path.join(pasta, 'geracoes.json'), 'utf8')); } catch (e) {
    return { erro: 'nao li ' + path.join(pasta, 'geracoes.json') + ' (' + (e.code || e.message) + ')' };
  }
  if (!ger || !Array.isArray(ger.prompts) || !Array.isArray(ger.geracoes)) {
    return { erro: 'geracoes.json sem a lista de prompts e de geracoes' };
  }
  return { ger: ger };
}

function geracaoDe(ger, prompt, condicao) {
  return ger.geracoes.filter(function (g) { return g.prompt === prompt && g.condicao === condicao; })[0];
}

// ── --pares ──────────────────────────────────────────────────────────────

function artefato(pergunta, texto) {
  return 'PERGUNTA\n' + pergunta.trim() + '\n\nRESPOSTA\n' + texto.trim() + '\n';
}

// o id vira nome de pasta e a pergunta vai ao juiz: os dois se conferem antes de criar qualquer coisa
const ID_DE_PROMPT = /^[A-Za-z0-9_-]{1,64}$/;

function promptsRuins(prompts) {
  const vistos = Object.create(null);
  const ruins = [];
  prompts.forEach(function (p, i) {
    const id = p && typeof p === 'object' ? p.id : undefined;
    const onde = 'prompt ' + (i + 1) + (typeof id === 'string' ? ' (' + JSON.stringify(id) + ')' : '');
    if (typeof id !== 'string' || !ID_DE_PROMPT.test(id)) ruins.push(onde + ': o id vira nome de pasta; so letras, numeros, - e _, ate 64');
    // sem caixa: NTFS e APFS nao distinguem 'Ab' de 'ab', e os dois cairiam na mesma pasta de par
    else if (vistos[id.toLowerCase()]) ruins.push(onde + ': id repetido');
    else vistos[id.toLowerCase()] = true;
    if (!p || typeof p.texto !== 'string' || p.texto.trim() === '') ruins.push(onde + ': sem a pergunta (texto vazio)');
  });
  return ruins;
}

/** Algum par ja tem arquivo em vereditos/? true ou false; null quando a leitura falha (nao se sabe). */
function temVeredito(dirPares) {
  try {
    return fs.readdirSync(dirPares).some(function (nome) {
      const v = path.join(dirPares, nome, 'vereditos');
      return fs.existsSync(v) && fs.readdirSync(v).length > 0;
    });
  } catch (e) {
    return null;
  }
}

function processoVivo(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/**
 * A montagem de um processo que morreu no meio (Ctrl+C, queda) fica na rodada com o mapa.json dentro: sai aqui. A de
 * processo vivo pode ser outra montagem em curso, e fica, salvo se for velha (D339). A que nao sai nao barra nada.
 */
function tirarMontagensMortas(rodada) {
  fs.readdirSync(rodada).forEach(function (nome) {
    const m = /^montagem-(\d+)-(\d+)$/.exec(nome);
    if (!m) return;
    // carimbo no futuro nao e velho: vale so o pid
    const velha = Date.now() - Number(m[2]) > IDADE_DA_MONTAGEM_MORTA_MS;
    if (!velha && processoVivo(Number(m[1]))) return;
    try { fs.rmSync(path.join(rodada, nome), { recursive: true, force: true }); } catch (e) { /* fica para a proxima */ }
  });
}

function pares(argv) {
  const pasta = valorDe(argv, '--pares');
  if (!pasta) return recusar('ERRO: falta a pasta da rodada.\n' + USO);
  const rodada = path.resolve(pasta);
  const lida = lerRodada(rodada);
  if (lida.erro) return recusar('ERRO: ' + lida.erro);
  const ger = lida.ger;

  const antes = medicao.apurar({ prompts: ger.prompts, geracoes: ger.geracoes, julgamentos: [] });
  if (antes.veredito === 'INVALIDO') {
    return recusar('ERRO: a rodada e INVALIDA; nao monto pares (cada par custa um juiz).\n  ' + antes.motivos.join('\n  '));
  }
  const ruins = promptsRuins(ger.prompts);
  if (ruins.length > 0) return recusar('ERRO: geracoes.json tem prompt que nao vira par; nao monto nada.\n  ' + ruins.join('\n  '));
  const temPares = fs.existsSync(path.join(rodada, 'pares'));
  const temMapa = fs.existsSync(path.join(rodada, 'mapa.json'));
  if (temPares || temMapa) {
    // a trava e uma so: pares/ ou mapa.json recusam. A mensagem diz o estado, e so fala de veredito quando ha um
    const ha = temPares ? temVeredito(path.join(rodada, 'pares')) : false;
    if (ha === null) {
      return recusar('ERRO: esta rodada ja tem ' + path.join(rodada, 'pares') + ', e nao consegui ler o que ha dentro (pode ter ' +
        'veredito). Nada se refaz por cima: confira essa pasta a mao.');
    }
    if (ha) {
      return recusar('ERRO: esta rodada ja tem pares/ ou mapa.json. Nada se refaz por cima: ha veredito que se perderia. ' +
        'Para ler o que ja foi julgado, rode --veredito ' + rodada + '; para medir de novo, gere uma rodada nova com --gerar.');
    }
    // pares/ sem mapa.json: a montagem morreu entre os dois renomes, e as instrucoes do juiz so saem depois deles
    if (!temMapa) {
      return recusar('ERRO: a montagem anterior foi interrompida: pares/ ficou sem mapa.json, e nenhum juiz ' +
        'recebeu as instrucoes (a saida do --pares). ' +
        'Para refazer, apague ' + path.join(rodada, 'pares') + ' e rode de novo (as pastas montagem-* desta rodada nao barram nada).');
    }
    if (!temPares) {
      return recusar('ERRO: esta rodada tem mapa.json sem pares/: nao ha veredito a perder, mas nada se refaz por cima. ' +
        'Para refazer, apague ' + path.join(rodada, 'mapa.json') + ' e rode de novo.');
    }
    return recusar('ERRO: esta rodada ja tem pares/ e mapa.json, sem nenhum veredito gravado ainda. Nada se refaz por cima: ' +
      'um juiz pode estar julgando agora. Se nenhum esta (as instrucoes do --pares se perderam), apague ' +
      path.join(rodada, 'pares') + ' e ' + path.join(rodada, 'mapa.json') + ' e rode de novo.');
  }

  // a chave do apurar junta prompt e condicao como texto (7 e "7" casam); o par procura com ===
  const soltas = [];
  ger.prompts.forEach(function (p) {
    medicao.CONDICOES.forEach(function (c) {
      const g = geracaoDe(ger, p.id, c);
      if (!g || typeof g.texto !== 'string') soltas.push(p.id + '/' + c);
    });
  });
  if (soltas.length > 0) {
    return recusar('ERRO: geracoes.json tem geracao que o id do prompt nao acha (prompt ou condicao gravados com outro tipo); ' +
      'nao monto nada.\n  ' + soltas.join('\n  '));
  }
  tirarMontagensMortas(rodada);

  // tudo em memoria antes da 1a pasta, e a gravacao que falha se desfaz: pares/ pela metade barraria a retentativa
  const mapa = { versao: 1, pares: {} };
  const lista = [];
  for (const p of ger.prompts) {
    for (const rival of medicao.RIVAIS) {
      for (const ordem of medicao.ORDENS) {
        const nome = medicao.nomeDoPar(p.id, rival, ordem);
        const ladoA = ordem === 1 ? 'recurso' : rival;
        const ladoB = ordem === 1 ? rival : 'recurso';
        mapa.pares[nome] = { prompt: p.id, rival: rival, ordem: ordem, A: ladoA, B: ladoB };
        lista.push({
          nome: nome,
          dir: path.join(rodada, 'pares', nome), // onde fica depois do renome: e o caminho das instrucoes
          A: artefato(p.texto, geracaoDe(ger, p.id, ladoA).texto),
          B: artefato(p.texto, geracaoDe(ger, p.id, ladoB).texto)
        });
      }
    }
  }
  const dirPares = path.join(rodada, 'pares');
  const arqMapa = path.join(rodada, 'mapa.json');
  // grava numa pasta de montagem ao lado e so no fim renomeia: o processo que morre no meio (Ctrl+C, queda, sem
  // catch nenhum) deixa so a montagem, que a trava acima nao ve, e a retentativa monta. Sobra a janela entre os
  // dois renomes.
  const montagem = path.join(rodada, 'montagem-' + process.pid + '-' + Date.now());
  fs.mkdirSync(montagem);
  const nasceu = [montagem];
  try {
    lista.forEach(function (x) {
      const dir = path.join(montagem, 'pares', x.nome);
      fs.mkdirSync(path.join(dir, 'vereditos'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'A.txt'), x.A, 'utf8');
      fs.writeFileSync(path.join(dir, 'B.txt'), x.B, 'utf8');
    });
    fs.writeFileSync(path.join(montagem, 'mapa.json'), JSON.stringify(mapa, null, 2) + '\n', 'utf8');
    fs.renameSync(path.join(montagem, 'pares'), dirPares);
    nasceu.push(dirPares);
    // fora de pares/: o inspetor nao pode achar a resposta
    fs.renameSync(path.join(montagem, 'mapa.json'), arqMapa);
    nasceu.push(arqMapa);
  } catch (e) {
    // a gravacao falhou no meio (disco, permissao). O que esta em `nasceu` foi criado nesta chamada (a trava acima
    // recusa quando pares/ ou mapa.json ja existiam) e nenhum juiz recebeu as instrucoes: desfaz, para a retentativa
    // nao ser recusada. O desfazer que tambem falha nao engole o erro de origem: diz o que ficou
    const ficou = [];
    nasceu.slice().reverse().forEach(function (alvo) {
      try { fs.rmSync(alvo, { recursive: true, force: true }); } catch (err) { ficou.push(alvo + ' (' + (err.code || err.message) + ')'); }
    });
    if (ficou.length === 0) throw e;
    throw new Error((e && e.message ? e.message : String(e)) + '; e o desfazer falhou, ficou para apagar a mao: ' + ficou.join(', '));
  }
  // vazia depois dos renomes; se nao sair, nao barra nada
  try { fs.rmdirSync(montagem); } catch (e) { /* sobra uma pasta vazia */ }

  const L = [];
  // A6-20 (D735): "instrucoes", sem o ingles solto, aqui e nas recusas do --pares.
  L.push('INSTRUCOES DO JUIZ - medicao de qualidade de resposta');
  L.push('rodada: ' + rodada);
  L.push('pares: ' + lista.length + ' (um inspetor por par, no maximo 20 ao mesmo tempo)');
  L.push('');
  L.push('Lente (' + medicao.LENTE.chave + '): ' + medicao.LENTE.titulo);
  L.push('Pergunta da lente, literal:');
  L.push(medicao.LENTE.pergunta);
  L.push('');
  L.push('Cada inspetor recebe a lente, a pergunta literal, os dois arquivos do seu par e a pasta vereditos.');
  L.push('Nada mais: nao abre outro par, nem a pasta da rodada. Devolve o JSON do inspetor com lente "' +
    medicao.LENTE.chave + '", a pasta vereditos copiada sem mexer, melhor (A, B ou empate) e porQue citando');
  L.push('arquivo:linha de A.txt ou B.txt. O veredito vai para <vereditos>/' + medicao.LENTE.chave + '.json.');
  L.push('');
  L.push('Pares:');
  lista.forEach(function (x) {
    L.push('  ' + x.nome);
    L.push('    A: ' + path.join(x.dir, 'A.txt'));
    L.push('    B: ' + path.join(x.dir, 'B.txt'));
    L.push('    vereditos: ' + path.join(x.dir, 'vereditos'));
  });
  L.push('');
  L.push('Depois dos vereditos: node scripts/medir-qualidade.js --veredito "' + rodada + '"');
  process.stdout.write(L.join('\n') + '\n');
}

// ── --veredito ───────────────────────────────────────────────────────────

function lerVeredito(rodada, nome) {
  const arquivo = path.join(rodada, 'pares', nome, 'vereditos', medicao.LENTE.chave + '.json');
  if (!fs.existsSync(arquivo)) return { falta: true };
  try {
    const vd = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    if (!vd || typeof vd !== 'object') return { falta: true, ilegivel: true };
    // sem o campo melhor nao e voto: e juiz que nao respondeu, e isso nunca e empate. Com melhor e sem citacao e
    // voto, e o votoDoJuiz o conta como empate. A lista do JSON nunca tem melhor
    if (typeof vd.melhor !== 'string') return { falta: true, semVoto: true };
    return { veredito: vd };
  } catch (e) {
    return { falta: true, ilegivel: true };
  }
}

function vereditoDaRodada(argv) {
  const pasta = valorDe(argv, '--veredito');
  if (!pasta) return recusar('ERRO: falta a pasta da rodada.\n' + USO);
  const rodada = path.resolve(pasta);
  const lida = lerRodada(rodada);
  if (lida.erro) return recusar('ERRO: ' + lida.erro);
  const ger = lida.ger;

  const julgamentos = [];
  const ilegiveis = [];
  const semVoto = [];
  for (const p of ger.prompts) {
    for (const rival of medicao.RIVAIS) {
      for (const ordem of medicao.ORDENS) {
        const r = lerVeredito(rodada, medicao.nomeDoPar(p.id, rival, ordem));
        if (r.ilegivel) ilegiveis.push(p.id + '/' + rival + '/' + ordem);
        if (r.semVoto) semVoto.push(p.id + '/' + rival + '/' + ordem);
        if (r.veredito) julgamentos.push({ prompt: p.id, rival: rival, ordem: ordem, veredito: r.veredito });
      }
    }
  }
  const a = medicao.apurar({ prompts: ger.prompts, geracoes: ger.geracoes, julgamentos: julgamentos });

  const L = [];
  L.push('MEDICAO DE QUALIDADE DE RESPOSTA - veredito');
  L.push('rodada: ' + rodada + (ger.modelo ? '  (modelo ' + ger.modelo + ')' : ''));
  L.push('prompts: ' + ger.prompts.length + ' | geracoes: ' + ger.geracoes.length);
  L.push('condicoes: padrao (sem o caveman e sem o recurso), caveman (a skill /caveman, que encurta as respostas) e ' +
    'recurso (a qualidade de resposta do sworn)');
  L.push('');
  if (a.veredito === null) {
    L.push('VEREDITO: nenhum - faltam ' + a.faltam.length + ' julgamento(s). Par sem veredito do juiz NAO vira empate. ' + medicao.ACAO_DE_JULGAR);
    a.faltam.forEach(function (f) { L.push('  falta: ' + f); });
    if (ilegiveis.length > 0) L.push('  (JSON ilegivel, tratado como falta: ' + ilegiveis.join(', ') + ')');
    if (semVoto.length > 0) L.push('  (veredito sem o campo melhor em texto, tratado como falta: ' + semVoto.join(', ') + ')');
  } else {
    L.push('VEREDITO: ' + a.veredito);
    a.motivos.forEach(function (m) { L.push('  ' + m); });
  }
  L.push('');
  medicao.RIVAIS.forEach(function (rival) {
    const p = a.placar[rival];
    L.push('placar contra ' + rival + ': ' + p.vitorias + ' vitorias, ' + p.derrotas + ' derrotas, ' + p.empates + ' empates');
  });
  L.push('');
  L.push('tokens de saida (soma da execucao inteira):');
  medicao.CONDICOES.forEach(function (c) { L.push('  ' + c + '  ' + a.tokens[c]); });
  // A6-17 (D735): a regra do gasto (medicao.apurar, gastaMenos), no lugar da frase que saia sempre e nada dizia.
  L.push('Para GANHA, o recurso precisa vencer os dois placares e gastar menos tokens que o padrao; o gasto do ' +
    'caveman nao entra na conta.');
  process.stdout.write(L.join('\n') + '\n');
  process.exitCode = a.veredito === null ? 2 : 0;
}

// ── a entrada ────────────────────────────────────────────────────────────

function principal(argv) {
  try {
    if (argv.indexOf('--gerar') !== -1) return gerar(argv);
    if (argv.indexOf('--pares') !== -1) return pares(argv);
    if (argv.indexOf('--veredito') !== -1) return vereditoDaRodada(argv);
    return recusar(USO);
  } catch (e) {
    // Pasta que ja existia, git que nao respondeu, arquivo ilegivel: diz o que foi e sai com erro.
    // O que ja estava gravado (geracoes.json, stream bruto) fica como esta.
    return recusar('ERRO: ' + (e && e.message ? e.message : String(e)));
  }
}

if (require.main === module) principal(process.argv.slice(2));

module.exports = { resolverClaude, projetoDoBrinquedo, montarBrinquedo, acharTranscricao, git };
