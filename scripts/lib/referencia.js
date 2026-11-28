'use strict';
const projeto = require('./projeto.js');
const glob = require('./glob.js');
const { TETO_DA_REFERENCIA } = require('./cegar.js');

/**
 * Plano do REA, Tarefa 3 (D555, D580): a ficha do /sworn:reference. Logica pura: quem le o disco e grava e o
 * scripts/referencia.js. A skill sozinha nao garante o formato (escada do "menos codigo"): o grau e a origem de cada
 * achado, o estado do que ficou sem saber e o tamanho que cabe no R.txt (cegar.js) se conferem aqui, antes de a ficha
 * entrar na `referencias`. Forma (texto do mock, prints-rea/mock-rea.png, secao 2):
 *   ## Cobertura                | Camada | Cobertura | O que se leu |   (R2, D833)
 *   ## Achados                  | Camada | Achado | Origem | Grau | Quem agiu |
 *   ## O que ficou sem saber    | Pergunta | Estado | O que mediria |
 *   Não li: <o que ficou de fora da leitura>
 */
const GRAUS = ['observado', 'derivado', 'inferido'];
const QUEM = ['agente', 'dono'];
const ESTADOS = ['aberto', 'bloqueado', 'resolvido'];
// R2 (D833, do craft-anything: crates/evidence/src/lib.rs:121-173): a cobertura de cada camada, e o padrao e
// desconhecida - o que a ficha nao declara completo nao sustenta um "nao tem".
const COBERTURAS = ['completa', 'parcial', 'desconhecida'];
const COBERTURA = '## Cobertura';
const CAB_COBERTURA = ['camada', 'cobertura', 'o que se leu'];
// A evidencia de uma pergunta resolvida (unknown.rs:86 do original): arquivo:linha, endereco, print ou json, ou o
// achado da ficha que a resolveu. O arquivo:linha pede nome com extensao: "as 10:30" nao e evidencia.
const ARQUIVO_LINHA = /[\w-]\.[a-z]\w*:\d/i;
const EVIDENCIA = new RegExp(ARQUIVO_LINHA.source + '|https?:\\/\\/\\S|[\\w-]\\.(png|jpe?g|json)\\b|achado da linha \\d', 'i');
const ACHADOS = '## Achados';
const SEM_SABER = '## O que ficou sem saber';
const CAB_ACHADOS = ['camada', 'achado', 'origem', 'grau', 'quem agiu'];
const CAB_SEM_SABER = ['pergunta', 'estado', 'o que mediria'];
const SEM_BARRA = 'linha de tabela sem a barra do começo (|): no markdown ela sai da tabela e some da conta';
// Plano do radar, T2 (D609): a ficha do radar e esta mesma ficha mais a secao dos candidatos. Valor sem acento tambem
// vale, como no "Nao li:".
const CANDIDATOS = '## Candidatos';
// D938 (pedido 282, o canivete suico): o candidato diz a quem serve (alcance), o evento que o liga sozinho no projeto
// de quem usa o sworn (gatilho automatico) e o que o projeto ja tem no lugar (equivalente: arquivo:linha, ou
// "nenhum (procurei: ...)"). A peca que so roda quando alguem digita o comando nao conta como gatilho.
const CAB_CANDIDATOS = ['repo', 'licença', 'como entra', 'como melhora', 'alcance', 'gatilho automático',
  'equivalente no projeto', 'esforço', 'valor', 'veredito'];
const CAB_ANTIGO = ['repo', 'licença', 'como entra', 'como melhora', 'esforço', 'valor', 'veredito'];
// O evento que dispara sem ninguem digitar, sempre palavra inteira (o "ci" de "decide", o "teste" de "testemunha" e o
// "cron" de "cronograma" nao contam): o nome de um evento do harness, do CI ou da agenda, ou a palavra generica (hook,
// commit, teste, evento...). A celula se le por trecho (entre ; , . : e parenteses), e basta um trecho que ligue a
// peca: "Sem ação do usuário: SessionStart" e "PreToolUse (também sob demanda)" valem. Nao liga o trecho que comeca
// negando ("nenhum hook", "não roda em CI"), o evento negado logo antes ("sem cron", "nenhum CI"), nem o trecho que diz
// que alguem roda na mao ("o usuário roda o teste", "os usuários digitam /deploy", "sob demanda").
const EVENTO = 'sessionstart|userpromptsubmit|pretooluse|posttooluse|stop|subagentstop|subagentstart|precompact|' +
  'sessionend|notification|ci|pull requests?|cron|ganchos?|hooks?|abertura|commits?|push|testes?|builds?|deploys?|' +
  'agenda|agendad[oa]s?|agendamentos?|eventos?|portão|portao|portões|portoes';
const NEGA = '(?<![\\p{L}])(nenhum|nenhuma|sem|n[ãa]o|nunca)(?![\\p{L}])';
const GATILHO = new RegExp('(?<![\\p{L}\\p{N}])(' + EVENTO + ')(?![\\p{L}\\p{N}])', 'iu');
const EVENTO_NEGADO = new RegExp(NEGA + '\\s+(\\S+\\s+){0,2}?(' + EVENTO + ')(?![\\p{L}\\p{N}])', 'giu');
const NEGA_NO_INICIO = new RegExp('^\\s*`?' + NEGA, 'iu');
const GATILHO_MANUAL = new RegExp('sob demanda|manual(mente)?(?![\\p{L}])|(?<![\\p{L}])[àa] m[ãa]o(?![\\p{L}])|' +
  '(usu[áa]rios?|donos?|algu[ée]m|pessoas?)\\s+(\\S+\\s+)?(digit|rod|cham|execut|ped)\\p{L}*', 'iu');
function temGatilho(celula) {
  return String(celula || '').split(/[;,.:()\n]/).some(function (trecho) {
    if (NEGA_NO_INICIO.test(trecho) || GATILHO_MANUAL.test(trecho)) return false;
    return GATILHO.test(trecho.replace(EVENTO_NEGADO, ' '));
  });
}
const REPO = /^[\w.-]+\/[\w.-]+$/;
// O repo escrito como link do markdown ou endereco do GitHub vira "dono/nome", para a camada de pecas achar o par; do
// endereco so contam o dono e o nome ("github.com/dono/repo/tree/main" e dono/repo).
function repoDaCelula(texto) {
  let r = String(texto).trim();
  const link = r.match(/^\[[^\]]*\]\(([^)]*)\)$/);
  if (link) r = link[1].trim();
  r = r.replace(/^`|`$/g, '');
  const github = /^(https?:\/\/)?(www\.)?github\.com\//i;
  if (github.test(r)) r = r.replace(github, '').split(/[?#]/)[0].split('/').slice(0, 2).join('/');
  r = r.replace(/(\.git)?\/*$/i, '');
  return REPO.test(r) ? r : null;
}
const ESFORCOS = ['p', 'm', 'g'];
const VALORES = ['baixo', 'médio', 'medio', 'alto'];
const VEREDITOS = ['adotar', 'inspiração', 'inspiracao', 'descartar'];
// D580: uma ficha por tipo de entrega, em .claude/sworn/referencias/<tipo>-<assunto>.md, sem subpasta.
const RE_FICHA = /^\.claude\/sworn\/referencias\/(tela|codigo|texto)-[^/]+\.md$/;

/** As celulas de uma linha de tabela (`| a | b |`), sem as crases de volta do valor; `\|` nao separa. */
function celulas(linha) {
  // A4-31: a barra do fim so sai quando e borda da tabela; `\|` no fim e texto da ultima celula
  return linha.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map(function (c) { return c.trim(); });
}
function valor(c) { return c.replace(/`/g, '').trim().toLowerCase(); }
// D582: texto livre (achado, origem, o que mediria, o "Não li:") precisa de duas letras ou dígitos seguidos: "-", "x",
// "?" e "n/a" contam como vazio. Nao julga o sentido: a ficha inteira vai ao dono antes do --gravar.
function temTexto(c) { return /[\p{L}\p{N}]{2}/u.test(String(c || '')); }
// O separador do markdown (`|---|:--:|`): so tracos e dois-pontos, com ao menos uma celula de 3 tracos. Linha em branco
// (`| | |`) ou de um traco por celula (`| - | - |`) e dado, e cai na conferencia como achado vazio.
function ehSeparador(c) {
  return c.every(function (x) { return /^:?-+:?$/.test(x); }) && c.some(function (x) { return /-{3}/.test(x); });
}

/**
 * As linhas de dado da tabela da secao `titulo` ({ n, c }), sem o cabecalho e o separador; null se nao ha secao. Linha
 * com `|` que nao comeca por ele vem com `c: null` (D582): fora da tabela no markdown, ela sumiria da conta calada.
 */
function linhasDaSecao(linhas, titulo, cabecalho) {
  const i = linhas.findIndex(function (l) { return l.trim() === titulo; });
  if (i === -1) return null;
  const dados = [];
  for (let k = i + 1; k < linhas.length && !/^## /.test(linhas[k]); k++) {
    const l = linhas[k].trim();
    if (!l.startsWith('|')) { if (l.indexOf('|') !== -1) dados.push({ n: k + 1, c: null }); continue; }
    const c = celulas(l);
    if (ehSeparador(c) || c.map(valor).join('|') === cabecalho.join('|')) continue;
    dados.push({ n: k + 1, c: c });
  }
  return dados;
}

/**
 * Os candidatos do radar: { candidatos, adotar, repos }, com os problemas empurrados em `problemas`. `repos` (cada
 * "dono/nome", uma vez, com a linha) vai para conferirPecas.
 */
function conferirCandidatos(linhas, problemas) {
  const cand = linhasDaSecao(linhas, CANDIDATOS, CAB_CANDIDATOS);
  if (!cand) problemas.push('falta a secao "' + CANDIDATOS + '" (| ' + CAB_CANDIDATOS.join(' | ') + ' |)');
  else if (!cand.length) problemas.push('nenhum candidato na secao "' + CANDIDATOS + '": a semana sem nada diz isso numa linha com veredito descartar');
  let adotar = 0;
  let candidatos = 0;
  const repos = [];
  for (const c of cand || []) {
    const p = 'linha ' + c.n + ': ';
    if (!c.c) { candidatos++; problemas.push(p + SEM_BARRA); continue; }
    // a ficha de antes da D938: o cabecalho velho e dado aqui (nao e o de agora), e diz o que falta uma vez so
    if (c.c.map(valor).join('|') === CAB_ANTIGO.join('|')) {
      problemas.push(p + 'cabeçalho antigo da ficha (7 colunas): faltam Alcance, Gatilho automático e Equivalente no ' +
        'projeto, entre "Como melhora" e "Esforço"');
      continue;
    }
    candidatos++;
    if (c.c.length !== CAB_CANDIDATOS.length) { problemas.push(p + 'o candidato tem ' + c.c.length + ' colunas, e sao ' + CAB_CANDIDATOS.length); continue; }
    const veredito = valor(c.c[9]);
    const equivalente = c.c[6];
    if (!temTexto(c.c[0])) problemas.push(p + 'candidato sem o repo');
    if (!temTexto(c.c[1])) problemas.push(p + 'candidato sem licença (o que a fonte diz, ou "sem licença")');
    if (veredito === 'descartar') {
      // descartado nao entra: alcance, gatilho e "como melhora" podem ficar vazios, mas o motivo nao - no "como entra"
      // (por que nao entra) ou no equivalente que o projeto ja tem
      if (!temTexto(c.c[2]) && !ARQUIVO_LINHA.test(equivalente)) {
        problemas.push(p + 'descartado sem o motivo: diga no "como entra" por que não entra, ou cite no equivalente o ' +
          'arquivo:linha do que o projeto já tem');
      }
    } else {
      if (!temTexto(c.c[2])) problemas.push(p + 'candidato sem como entra');
      if (!temTexto(c.c[3])) problemas.push(p + 'candidato sem como melhora (o que fica melhor que o original)');
      if (!temTexto(c.c[4])) problemas.push(p + 'candidato sem alcance (a quem serve: qualquer projeto, ou que tipo de projeto)');
      if (!temGatilho(c.c[5])) {
        problemas.push(p + 'candidato sem gatilho automático: diga o evento que liga a peça sozinha no projeto de quem ' +
          'usa (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, PreCompact, commit, CI, teste, agenda); ' +
          'o usuário digitar o comando, ou "sob demanda", não é gatilho');
      }
      // "nenhum", qualquer coisa (o [^] pega tambem a quebra de linha), o primeiro "procurei" e o que se buscou depois
      // dele; o "não" logo antes desse "procurei" e a busca negada ("não procurei em docs/" depois dela nao conta)
      const m = String(equivalente).match(/^\s*`?nenhum\b([^]*?)procurei:?([^]*)$/i);
      const naoProcurou = Boolean(m) && /n[ãa]o\s*$/i.test(m[1]);
      if (!ARQUIVO_LINHA.test(equivalente) && !(m && temTexto(m[2]) && !naoProcurou)) {
        problemas.push(p + 'candidato sem equivalente no projeto: o arquivo:linha do que já faz isso, ou "nenhum ' +
          '(procurei: <o que se buscou e onde>)"');
      }
    }
    if (ESFORCOS.indexOf(valor(c.c[7])) === -1) problemas.push(p + 'candidato sem esforço (P, M ou G)');
    if (VALORES.indexOf(valor(c.c[8])) === -1) problemas.push(p + 'candidato sem valor (baixo, médio ou alto)');
    if (VEREDITOS.indexOf(veredito) === -1) problemas.push(p + 'candidato sem veredito (adotar, inspiração ou descartar)');
    if (veredito === 'adotar') adotar++;
    // a linha da semana vazia ("nenhum novo nesta semana", descartar, sem barra nem github) nao e repositorio e nao
    // pede camada de pecas; o descarte que escreve um repo fora do formato e cobrado como os outros
    const repo = repoDaCelula(valor(c.c[0]));
    const pareceRepo = veredito !== 'descartar' || /\/|github/i.test(c.c[0]);
    if (repo && !repos.some(function (r) { return r.repo === repo; })) repos.push({ n: c.n, repo: repo });
    else if (!repo && temTexto(c.c[0]) && pareceRepo) {
      problemas.push(p + 'o repo "' + c.c[0].trim() + '" não está no formato dono/nome (ou o endereço do GitHub)');
    }
  }
  return { candidatos: candidatos, adotar: adotar, repos: repos };
}

/**
 * D938: cada repositorio da ficha diz, na Cobertura, quantas pecas leu de quantas tem (a camada "<repo> peças").
 * O "ja temos" ou o descarte de uma peca que ninguem leu e o erro que o pedido 282 achou.
 */
function conferirPecas(repos, camadas, problemas) {
  for (const r of repos) {
    const k = (camadas || []).find(function (x) {
      if (!x.c || x.c.length !== CAB_COBERTURA.length) return false;
      const v = valor(x.c[0]);
      return v.indexOf(r.repo + ' ') === 0 && /pe[çc]as/.test(v.slice(r.repo.length));
    });
    if (!k) {
      problemas.push('linha ' + r.n + ': o candidato ' + r.repo + ' sem a camada "' + r.repo + ' peças" na Cobertura ' +
        '(quantas peças do repositório se leram de quantas: skills, agentes, comandos, ganchos, scripts)');
    } else if (valor(k.c[1]) !== 'desconhecida') {
      // completa tambem conta ("40 de 40"); desconhecida e o clone que falhou, e ja diz por que
      const conta = /(\d+)\s+de\s+(\d+)/.exec(k.c[2]);
      if (!conta) {
        problemas.push('linha ' + k.n + ': a camada "' + r.repo + ' peças" não diz quantas de quantas peças se leram ' +
          '("N de M", e o que ficou de fora)');
      } else if (Number(conta[1]) > Number(conta[2])) {
        problemas.push('linha ' + k.n + ': a camada "' + r.repo + ' peças" diz ' + conta[0] + ': mais peças lidas do ' +
          'que o repositório tem');
      }
    }
  }
}

/**
 * { problemas, achados, semSaber, abertos, bytes }; com `opcoes.tipo === 'radar'`, tambem { candidatos, adotar }.
 * Problema de linha comeca com "linha <n>: ".
 */
function conferir(texto, opcoes) {
  const linhas = String(texto).split(/\r?\n/);
  const problemas = [];
  const radar = opcoes && opcoes.tipo === 'radar' ? conferirCandidatos(linhas, problemas) : null;
  const achados = linhasDaSecao(linhas, ACHADOS, CAB_ACHADOS);
  if (!achados || !achados.length) problemas.push('nenhum achado: falta a tabela da secao "' + ACHADOS + '"');
  for (const a of achados || []) {
    const p = 'linha ' + a.n + ': ';
    if (!a.c) { problemas.push(p + SEM_BARRA); continue; }
    if (a.c.length !== CAB_ACHADOS.length) { problemas.push(p + 'o achado tem ' + a.c.length + ' colunas, e sao ' + CAB_ACHADOS.length); continue; }
    if (!temTexto(a.c[1])) problemas.push(p + 'achado vazio');
    if (!temTexto(a.c[2])) problemas.push(p + 'achado sem origem (arquivo:linha, print, DOM, rede ou busca com hora)');
    if (GRAUS.indexOf(valor(a.c[3])) === -1) problemas.push(p + 'achado sem grau (' + GRAUS.join(', ') + ')');
    if (QUEM.indexOf(valor(a.c[4])) === -1) problemas.push(p + 'achado sem quem agiu (' + QUEM.join(' ou ') + ')');
  }
  const semSaber = linhasDaSecao(linhas, SEM_SABER, CAB_SEM_SABER);
  if (!semSaber) problemas.push('falta a secao "' + SEM_SABER + '"');
  else if (!semSaber.length) problemas.push('nenhuma pergunta na secao "' + SEM_SABER + '": todo estudo deixa alguma (a resolvida fica, com o que se mediu)');
  for (const s of semSaber || []) {
    const p = 'linha ' + s.n + ': ';
    if (!s.c) { problemas.push(p + SEM_BARRA); continue; }
    if (s.c.length !== CAB_SEM_SABER.length) { problemas.push(p + 'a pergunta tem ' + s.c.length + ' colunas, e sao ' + CAB_SEM_SABER.length); continue; }
    if (ESTADOS.indexOf(valor(s.c[1])) === -1) problemas.push(p + 'pergunta sem estado (' + ESTADOS.join(', ') + ')');
    if (!temTexto(s.c[2])) problemas.push(p + 'pergunta sem o que mediria');
    // R2: a resolvida cita a evidencia na hora de escrever (o original so confere depois, por ferramenta a parte)
    else if (valor(s.c[1]) === 'resolvido' && !EVIDENCIA.test(s.c[2])) {
      problemas.push(p + 'pergunta resolvida sem a evidencia (arquivo:linha, endereco, print ou json, ou "achado da linha N")');
    } else if (valor(s.c[1]) === 'resolvido') {
      // o "achado da linha N" tem de apontar para um achado: a ficha que cresce desloca as linhas
      const re = /achado da linha (\d+)/gi;
      for (let m = re.exec(s.c[2]); m; m = re.exec(s.c[2])) {
        const n = Number(m[1]);
        if (!(achados || []).some(function (a) { return a.n === n && !!a.c && a.c.length === CAB_ACHADOS.length; })) {
          problemas.push(p + 'a linha ' + n + ' nao e um achado da ficha: cite o numero de uma linha da tabela "' + ACHADOS +
            '", ou outra evidencia');
        }
      }
    }
  }
  const cobertura = { completa: 0, parcial: 0, desconhecida: 0 };
  const camadas = linhasDaSecao(linhas, COBERTURA, CAB_COBERTURA);
  if (!camadas) problemas.push('falta a secao "' + COBERTURA + '" (| ' + CAB_COBERTURA.join(' | ') + ' |): o que nao se declarou e desconhecido');
  else if (!camadas.length) problemas.push('nenhuma camada na secao "' + COBERTURA + '"');
  for (const k of camadas || []) {
    const p = 'linha ' + k.n + ': ';
    if (!k.c) { problemas.push(p + SEM_BARRA); continue; }
    if (k.c.length !== CAB_COBERTURA.length) { problemas.push(p + 'a camada tem ' + k.c.length + ' colunas, e sao ' + CAB_COBERTURA.length); continue; }
    const v = valor(k.c[1]);
    if (COBERTURAS.indexOf(v) === -1) { problemas.push(p + 'camada sem cobertura (' + COBERTURAS.join(', ') + ')'); continue; }
    cobertura[v]++;
    if (v !== 'completa' && !temTexto(k.c[2])) problemas.push(p + 'cobertura ' + v + ' sem o que se leu (quantos de quantos, o que ficou de fora)');
  }
  if (radar) conferirPecas(radar.repos, camadas, problemas);
  // REA: falta de cobertura e desconhecido. O "nao achei" so vale sobre o que se leu, e a ficha diz o que nao leu.
  if (!linhas.some(function (l) { const m = l.trim().match(/^N[ãa]o li:(.*)$/); return !!m && temTexto(m[1]); })) {
    problemas.push('falta a linha "Não li:" (o que ficou de fora da leitura)');
  }
  const bytes = Buffer.byteLength(String(texto), 'utf8');
  if (bytes > TETO_DA_REFERENCIA) {
    problemas.push('a ficha tem ' + bytes + ' bytes e o /sworn:review le inteira so ate 100 KB (' + TETO_DA_REFERENCIA + ')');
  }
  return Object.assign({
    problemas: problemas,
    achados: (achados || []).length,
    semSaber: (semSaber || []).length,
    abertos: (semSaber || []).filter(function (s) { return !!s.c && valor(s.c[1] || '') === 'aberto'; }).length,
    cobertura: cobertura,
    naoCompleta: cobertura.parcial + cobertura.desconhecida,
    bytes: bytes
  }, radar ? { candidatos: radar.candidatos, adotar: radar.adotar } : null);
}

/** O tipo pelo caminho relativo a raiz do projeto (`\` ou `/`), ou null fora de .claude/sworn/referencias/<tipo>-<assunto>.md. */
function tipoDaFicha(rel) {
  const m = glob.normalizar(rel).match(RE_FICHA);
  return m ? m[1] : null;
}

/** Os erros de `referencias` que projeto.validar acha no objeto (as mensagens dela comecam pelo nome da chave). */
function errosDaReferencia(obj) {
  return projeto.validar(obj || {}).erros.filter(function (e) { return /^referencias/.test(e); });
}

/**
 * O projeto.json com a ficha na lista do tipo, sem repetir: o que ja estava ali e os outros tipos ficam (fusao por
 * tipo de projeto.atualizar, FUNDE_POR_CHAVE). O geradoEm fica: isto nao e um re-init. { config, erros }; com erro
 * de `referencias` quem chama nao grava. A `referencias` que ja estava torta e erro tambem: gravar por cima apagaria,
 * sem ninguem ver, o que o dono escreveu.
 */
function naReferencia(antigo, tipo, rel) {
  const antes = errosDaReferencia(antigo);
  if (antes.length) return { config: antigo, erros: antes };
  const atual = (antigo && antigo.referencias && antigo.referencias[tipo]) || [];
  const lista = atual.indexOf(rel) === -1 ? atual.concat([rel]) : atual.slice();
  const resposta = {};
  resposta[tipo] = lista;
  const config = projeto.atualizar(antigo, { referencias: resposta }, antigo && antigo.geradoEm).config;
  return { config: config, erros: errosDaReferencia(config) };
}

module.exports = { QUEM, ESTADOS, ESFORCOS, conferir, tipoDaFicha, naReferencia, celulas };
