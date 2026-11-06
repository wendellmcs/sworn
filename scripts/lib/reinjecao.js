'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config.js');
const regraLib = require('./regra.js');
const escopoLib = require('./escopo.js');
const planoLib = require('./plano.js');
const estado = require('./estado.js');
const caminhoLib = require('./caminho.js');
const textoLib = require('./texto.js');
const saude = require('./saude.js');
const git = require('./git.js');
const ordensLib = require('./ordens.js');

// A2: compactacao preserva o sentido e destroi a literalidade.
// Depois dela eu sei que existe uma regra de escopo, e nao sei mais QUAL e o escopo.
const ORIGENS_COM_ESTADO = ['compact', 'resume', 'clear', 'fork'];

function bloco(titulo, linhas) {
  return ['', '## ' + titulo, ''].concat(linhas).join('\n');
}

const NAO_DECLARADO = 'nao declarado';

// 0.3.3, item 30: o valor vem de um arquivo que o dono edita a mao. Numa linha so (uma quebra de linha
// dentro dele injetaria linhas no texto reinjetado) e com teto de tamanho.
const LIMITE_DO_VALOR = 200;

function umaLinha(v) {
  const t = String(v).replace(/[\r\n]+/g, ' ').trim();
  if (t.length <= LIMITE_DO_VALOR) return t;
  let corte = LIMITE_DO_VALOR - 3;
  // F2-23: o corte nao parte um par substituto (emoji): se o ultimo caractere que ficaria e a 1a metade, recua um.
  const ultimo = t.charCodeAt(corte - 1);
  if (ultimo >= 0xD800 && ultimo <= 0xDBFF) corte -= 1;
  return t.slice(0, corte) + '...';
}

/** Texto nao vazio, ou a confissao de que o campo nao foi declarado. Nunca `null`
 *  cru: reinjetar "quem decide: null" seria pior que reinjetar nada - o agente le
 *  `null` como se fosse um valor. */
function declarado(v) {
  return typeof v === 'string' && v.trim() ? umaLinha(v) : NAO_DECLARADO;
}

/** 0.3.3, itens 26/28: a causa do erro. F3-22: o codigo do Node vem traduzido ("e uma pasta (EISDIR)"), de `texto.causaDoErro`. So ASCII. */
function causaDoErro(e) {
  return escopoLib.ascii(textoLib.causaDoErro(e));
}

/**
 * 0.3.3, itens 26 e 31: por que o projeto.json que existe nao se le, e o que fazer. `null` quando ele
 * nao existe (o normal antes do /sworn:init) ou quando, olhando de novo, ele se le.
 */
function causaDoProjetoIlegivel(cwd) {
  let bruto;
  try {
    bruto = fs.readFileSync(config.caminhoEmSworn(cwd, 'projeto.json'), 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    return {
      causa: 'erro de leitura: ' + causaDoErro(e),
      fazer: 'Confira a permissao do arquivo (ou se ele e uma pasta). ' +
        'Se o arquivo aceitar escrita, /sworn:init de novo o regrava com as respostas dadas.'
    };
  }
  const corrija = 'Corrija o JSON ou rode /sworn:init de novo (o init regrava o projeto.json com as respostas dadas).';
  let obj;
  try { obj = JSON.parse(textoLib.semBom(bruto)); } catch (e) { return { causa: 'JSON quebrado', fazer: corrija }; }
  // H-3/H-4: concorda com config.lerJson, que tambem recusa lista; senao o config devolve null e o aviso calava.
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { causa: 'nao e um objeto JSON', fazer: corrija };
  return null;
}

/**
 * D116 / R-T10-22: as quatro respostas da entrevista do `/sworn:init`
 * (`modeloDeAmeaca`, `quemDecide`, `provaDePronto`, `fontesCanonicas`) eram
 * gravadas, validadas na forma e lidas por NINGUEM - nem portao, nem reinjecao.
 * Duas das dez regras semeadas mandam consultar justamente esses valores ("a menos
 * que esteja em fontesCanonicas", E15; "o shell declarado em projeto.json", F16),
 * o que obrigava o agente a ABRIR ARQUIVO para obedecer a regra - o oposto do que
 * a reinjecao existe para fazer. Por isso o `plataforma.shell` vem junto.
 *
 * A fonte e o `projeto.json`, nao o `regras.md`: o criterio de fecho escrito no
 * ledger da T10 ("se o regras.md passar a carregar as quatro respostas") ficou
 * impossivel depois da D115 - prosa acrescentada ao `regras.md` e descartada em
 * silencio pelo `parseRegras`, medido. Duplicar as respostas no `regras.md` daria
 * duas fontes para o mesmo fato, e a que o dono edita a mao dessincronizaria calada.
 */
function contexto(cwd) {
  const p = config.carregarProjeto(cwd);
  if (!p) return null;

  const alcance = p.modeloDeAmeaca === 'interno' || p.modeloDeAmeaca === 'publico'
    ? 'projeto ' + p.modeloDeAmeaca
    : 'alcance ' + NAO_DECLARADO;

  const fontes = (Array.isArray(p.fontesCanonicas) ? p.fontesCanonicas : [])
    .filter(function (f) { return typeof f === 'string' && f.trim(); })
    .map(umaLinha);

  const plat = p.plataforma && typeof p.plataforma === 'object' ? p.plataforma : {};
  const shell = declarado(plat.shell);
  const so = declarado(plat.so);

  return [
    'Contexto declarado: ' + alcance +
      ' | quem decide: ' + declarado(p.quemDecide) +
      ' | prova de pronto: ' + declarado(p.provaDePronto),
    'Fontes canonicas (mandam de verdade, nesta ordem): ' +
      (fontes.length ? fontes.join(', ') : 'nenhuma declarada'),
    'Shell declarado: ' + shell +
      (shell !== NAO_DECLARADO && so !== NAO_DECLARADO ? ' (' + so + ')' : '')
  ];
}

/** Texto curto que o SessionStart reinjeta. A2: reinjecao depois da compactacao. */
function nucleo(cwd) {
  try {
    const texto = fs.readFileSync(path.join(cwd, '.claude', 'sworn', 'regras.md'), 'utf8');
    const regras = regraLib.parseRegras(texto);
    if (!regras.length) return null;
    const linhas = ['# sworn - regras deste projeto (reinjetadas nesta sessao)', ''];
    // D116: o contexto e cabecalho, nao substituto - a regra segue sendo o corpo.
    // Sem projeto.json nao ha contexto a declarar, e a reinjecao das regras nao pode
    // morrer por isso: e a ausencia normal de todo projeto antes do /sworn:init.
    const ctx = contexto(cwd);
    if (ctx) linhas.push(ctx.join('\n'), '');
    // 0.3.2, item 16: projeto.json PRESENTE e ilegivel (JSON quebrado, ou nao e objeto) faz o
    // config devolver null, igual ao ausente - e a reinjecao saia calada, sem o contexto.
    // Ausente segue como sempre (o normal antes do /sworn:init); ilegivel avisa e diz o que fazer.
    // 0.3.3, itens 26 e 31: o aviso diz a causa de verdade (nao se le, JSON quebrado ou nao e um objeto) e
    // o que fazer, inclusive o que o init faz com o arquivo.
    const ilegivel = ctx ? null : causaDoProjetoIlegivel(cwd);
    if (ilegivel) {
      linhas.push(
        'ATENCAO: .claude/sworn/projeto.json existe mas nao se le (' + ilegivel.causa + '), ' +
        'entao o contexto declarado nao entra aqui. ' + ilegivel.fazer,
        ''
      );
    }
    for (const r of regras) linhas.push('- ' + r.gatilho + ' -> ' + r.acao);
    linhas.push('');
    linhas.push(
      ctx
        ? 'Fonte das regras: .claude/sworn/regras.md; do contexto: ' +
          '.claude/sworn/projeto.json. Regra numerica se cita com arquivo:linha.'
        : 'Fonte: .claude/sworn/regras.md. Regra numerica se cita com arquivo:linha.'
    );
    return linhas.join('\n') + '\n';
  } catch (e) {
    // 0.3.3, item 28: regras.md ausente segue calado (nada a reinjetar, o normal antes do init). Qualquer outra
    // falha vira uma linha curta com a causa e o que fazer - a abertura nao pode lancar, mas tambem nao pode
    // deixar o agente sem regra achando que nao ha regra.
    if (e && e.code === 'ENOENT') return null;
    return 'sworn: as regras deste projeto nao se leram (' + causaDoErro(e) + '), entao nada delas entra nesta sessao. ' +
      'Confira .claude/sworn/regras.md (permissao, ou se e uma pasta) e abra a sessao de novo.\n';
  }
}

// Plano 0.9.1 (D560, D568): o que a sessao fez, para o compact nao apagar. Os arquivos listados tem teto; o resto vira conta.
const TETO_DE_ARQUIVOS = 8;

/** A pasta do repositorio de `abs` (a mais perto com `.git`), subindo pelo disco; null fora de repositorio. Pelo
 *  disco, e nao por `git rev-parse` por arquivo: a sessao pode ter tocado dezenas, e isto roda em toda compactacao. */
function repositorioDe(abs) {
  let pasta = path.dirname(abs);
  for (;;) {
    if (fs.existsSync(path.join(pasta, '.git'))) return pasta;
    const pai = path.dirname(pasta);
    if (pai === pasta) return null;
    pasta = pai;
  }
}

/** D568: o HEAD de cada repositorio onde houve arquivo tocado, na ordem em que apareceram. O que contem a pasta
 *  aberta se chama "raiz"; repositorio sem commit (ou git que nao responde) fica de fora. */
function linhaDoHead(cwd, relativos) {
  const vistos = [];
  const partes = [];
  for (const rel of relativos) {
    const repo = repositorioDe(path.resolve(cwd, rel));
    if (!repo || vistos.indexOf(repo.toLowerCase()) !== -1) continue;
    vistos.push(repo.toLowerCase());
    const sha = git.correr(repo, ['rev-parse', '--short', 'HEAD']);
    if (sha === null) continue;
    const ramo = (git.correr(repo, ['rev-parse', '--abbrev-ref', 'HEAD']) || '').trim();
    partes.push((caminhoLib.relativoAoProjeto(repo, cwd) || 'raiz') + ' ' + sha.trim() +
      (ramo && ramo !== 'HEAD' ? ' (' + ramo + ')' : ''));
  }
  return partes.length ? 'HEAD: ' + partes.join(' | ') : null;
}

/** As linhas do bloco "trabalho desta sessao"; so as que tem o que dizer (sessao sem nada = lista vazia). */
function linhasDoTrabalho(cwd, s) {
  const linhas = [];
  const tocados = Array.isArray(s.arquivosTocados)
    ? s.arquivosTocados.filter(function (a) { return typeof a === 'string' && a !== ''; }) : [];
  const dentro = [];
  for (const a of tocados) {
    const rel = caminhoLib.relativoAoProjeto(a, cwd);
    if (rel) dentro.push(rel);
  }
  if (tocados.length) {
    const fora = tocados.length - dentro.length;
    linhas.push('Arquivos tocados: ' + dentro.length + ' no projeto' + (fora ? ' (+' + fora + ' fora dele)' : '') +
      (dentro.length > TETO_DE_ARQUIVOS ? ' (os ' + TETO_DE_ARQUIVOS + ' primeiros)' : ''));
    for (const rel of dentro.slice(0, TETO_DE_ARQUIVOS)) linhas.push('  - ' + umaLinha(rel));
    if (dentro.length > TETO_DE_ARQUIVOS) linhas.push('  (+' + (dentro.length - TETO_DE_ARQUIVOS) + ' nao listados)');
  }
  const ordens = Array.isArray(s.ordensPendentes)
    ? s.ordensPendentes.filter(function (o) { return typeof o === 'string'; }) : [];
  if (ordens.length) {
    linhas.push('Ordens pendentes: ' + umaLinha(ordens.map(function (o) { return ordensLib.ROTULO[o] || o; }).join(', ')));
  }
  if (typeof s.decisoesDoDono === 'number' && s.decisoesDoDono > 0) linhas.push('Decisoes do dono nesta sessao: ' + s.decisoesDoDono);
  if (typeof s.commitsFeitos === 'number' && s.commitsFeitos > 0) linhas.push('Commits nesta sessao: ' + s.commitsFeitos);
  const head = linhaDoHead(cwd, dentro);
  if (head) linhas.push(umaLinha(head));
  return linhas;
}

/**
 * D786 passo 3: qual ordem segue o trabalho depois da compactacao, sem chat novo. Com handoff marcado nesta sessao
 * (marcar-trabalho.js) e o arquivo no disco: 'reler' pelo caminho (o texto inteiro nao cabe no corte de 10 mil). Com a
 * ordem do handoff dada e nada gravado depois dela (portao-fecho.js apaga a marca velha), ou com o arquivo sumido:
 * 'gravar' primeiro. Senao null. O caminho (mostrarCaminho) sai sem quebra nem controle, mas sem passar a ASCII: tem
 * de abrir. s355 (qw4: o Qwen compactou 42 vezes): a compactacao zera o handoff e o aviso (abertura.js), entao a
 * ordem ainda nao cumprida (s.ordemDoCompact) tambem vale; senao a 2a compactacao seguida a apagava sem repetir.
 */
function handoffDaOrdem(s) {
  if (typeof s.handoffDaSessao === 'string' && s.handoffDaSessao) return s.handoffDaSessao;
  const p = s.ordemDoCompact;
  return p && typeof p === 'object' && p.tipo === 'reler' && typeof p.arquivo === 'string' ? p.arquivo : '';
}

function tipoDaOrdem(s) {
  const arquivo = handoffDaOrdem(s);
  if (arquivo && fs.existsSync(arquivo)) return 'reler';
  const p = s.ordemDoCompact;
  if (!arquivo && s.avisouSaude !== true && !(p && typeof p === 'object' && p.tipo === 'gravar')) return null;
  return 'gravar';
}

/**
 * s357 (oc4, F2): o gatilho de tamanho so mede no fecho, e o turno longo que cruza o limiar e compacta antes de um fim
 * de turno nunca recebe o aviso: sem ele, a compactacao nao pedia o handoff. Aqui, na compactacao, sem aviso dado e sem
 * handoff da ordem, o tamanho da transcricao (`contexto`, a leitura de antes de compactar) no limiar vale como o aviso.
 * A regua e a do fecho (saude.medir com os limiares do projeto e o modo continuo; sem leitura, null, nao cruza). Com
 * handoff da ordem a compactacao ja manda reler, e o estado fica como antes (sem a saudeRearmada do aviso).
 */
function cruzouSemAviso(s, contexto, projeto) {
  if (s.avisouSaude === true || handoffDaOrdem(s)) return false;
  const gatilho = saude.medir({ tokensDeContexto: contexto }, projeto && projeto.limiares,
    require('./continuo.js').ativo(projeto)).find((g) => g.chave === 'tokensDeContexto');
  return Boolean(gatilho && gatilho.cruzou);
}

function mostrarCaminho(arquivo, cwd) {
  return (caminhoLib.relativoAoProjeto(arquivo, cwd) || arquivo).replace(/[\x00-\x1f\x7f]+/g, ' ');
}

/**
 * D786 passo 5 (rodada cc4: o Haiku recebeu "releia o handoff" e editou o trabalho sem ler): a ordem do compact vira
 * cobranca no portao do Write/Edit (portao-escopo.js, 1b) ate o Read do handoff ou a gravacao de um novo
 * (marcar-trabalho.js). Rodada ccds2 (s348: o DeepSeek seguiu por Add-Content no PowerShell): o "releia" e cobrado
 * tambem no portao do shell (portao-destrutivo.js). Teto de negacoes: um Read que nao marca (estado sem escrita,
 * ferramenta com outro nome) nao pode travar a sessao para sempre.
 */
const NEGACOES_DA_ORDEM = 3;

function ordemDoCompact(s) {
  const tipo = tipoDaOrdem(s);
  if (!tipo) return null;
  // s355: a contagem segue de uma compactacao a outra, e o teto continua valendo (sem trava eterna).
  const p = s.ordemDoCompact;
  const negadas = p && typeof p === 'object' && p.tipo === tipo ? Number(p.negadas) || 0 : 0;
  return { tipo: tipo, arquivo: tipo === 'reler' ? handoffDaOrdem(s) : null, negadas: negadas };
}

/**
 * Uma contagem so para os dois portoes: soma uma negacao a ordem pendente da sessao e diz se cobra; no teto a ordem
 * cai e a ferramenta passa. Estado sem escrita: nao cobra (sem trava eterna).
 */
function cobrarOrdem(sessao) {
  let cobrar = false;
  try {
    estado.alterar(sessao, function (x) {
      const atual = x.ordemDoCompact;
      if (!atual || typeof atual !== 'object') return x;
      const negadas = Number(atual.negadas) || 0;
      if (negadas < NEGACOES_DA_ORDEM) { atual.negadas = negadas + 1; cobrar = true; } else delete x.ordemDoCompact;
      return x;
    });
  } catch (err) { cobrar = false; }
  return cobrar;
}

/**
 * s348: o comando de shell que cita o nome do handoff da ordem (cat, Get-Content, type) conta como a releitura: o
 * Codex, o agy e o dsh nao tem Read e leem pelo shell. Pelo nome do arquivo e sem a caixa (o caminho vem relativo e com
 * barra de qualquer lado; nome de handoff que so muda a caixa nao existe na pratica).
 * atalho: citar o nome basta. limite: o comando que cita o handoff e faz outra coisa junto passa e cumpre a ordem.
 * trocar quando: uma rodada ao vivo mostrar o modelo citando o handoff sem le-lo.
 */
function comandoCitaHandoff(comando, arquivo) {
  if (typeof comando !== 'string' || typeof arquivo !== 'string') return false;
  const nome = path.basename(arquivo).toLowerCase();
  return nome !== '' && comando.toLowerCase().indexOf(nome) !== -1;
}

function motivoDaOrdem(ordem, cwd) {
  /* s366 (F11): o fim da resposta (portao-fecho.js) tambem lembra a ordem e soma neste teto. */
  const teto = 'Esta negacao se repete no maximo ' + NEGACOES_DA_ORDEM + ' vezes, somando edicoes, comandos e fins ' +
    'de resposta; ' +
    'depois tudo passa mesmo assim.';
  // s361 (F4): "Antes de editar outro arquivo, rode..." soou como proibicao (o luna no Qwen parou dizendo que nao
  // contornou a recusa). O texto diz que nao e para parar, o que fazer agora e que depois se repete o que foi negado.
  if (ordem.tipo === 'reler') {
    return 'sworn: depois da compactacao, o handoff desta conversa ainda nao foi relido. Nao e para parar: faca ' +
      'agora, leia ' + mostrarCaminho(ordem.arquivo, cwd) + ' inteiro (pelo Read; onde nao houver Read, pelo ' +
      'shell), depois repita o que foi negado e siga o bloco do prompt dele, sem perguntar. ' + teto;
  }
  // s361 (F7): no Qwen sem tela a skill foi negada (qw7); sem ela, o arquivo gravado direto cumpre a ordem. s363 (F9):
  // esse caminho mora no ONDE_GRAVAR_O_HANDOFF (saude.js), que tambem vai no aviso do Stop.
  return 'sworn: depois da compactacao, o handoff que o sworn pediu ainda nao foi gravado. Nao e para parar: faca ' +
    'agora, rode /sworn:handoff ' + saude.ONDE_GRAVAR_O_HANDOFF + '. Esta cobranca nao vale para o arquivo do ' +
    'handoff; depois repita esta edicao e siga pelo bloco do prompt dele, sem perguntar. ' + teto;
}

function ordemDoHandoff(cwd, s) {
  const tipo = tipoDaOrdem(s);
  if (tipo === 'reler') {
    const mostrar = mostrarCaminho(handoffDaOrdem(s), cwd);
    return [
      '# sworn - depois da compactacao: releia o handoff',
      '',
      'Esta conversa foi compactada depois do handoff gravado nela: ' + mostrar,
      'Faca agora, antes de qualquer outra coisa: leia esse arquivo inteiro e siga o bloco do prompt dele como se',
      'fosse um chat novo, sem esperar mensagem do usuario e sem perguntar "sigo?".'
    ].join('\n');
  }
  if (!tipo) return null;
  return [
    '# sworn - depois da compactacao: grave o handoff primeiro',
    '',
    'O sworn pediu o handoff nesta conversa, ou ela passou do gatilho de tamanho, e foi compactada sem ele gravado',
    '(ou o arquivo dele sumiu).',
    'Faca agora, antes de qualquer outra coisa: rode /sworn:handoff a partir do resumo da compactacao, do plano e do',
    'ledger; depois siga o trabalho nesta conversa pelo bloco do prompt dele, sem perguntar "sigo?".',
    saude.ONDE_GRAVAR_O_HANDOFF
  ].join('\n');
}

function montar(cwd, sessionId, origem) {
  const partes = [];

  // D786 passo 3: a ordem do handoff abre o texto. Acima de 10 mil caracteres o harness guarda o resto em arquivo e
  // mostra so o comeco.
  const ordem = String(origem) === 'compact' ? ordemDoHandoff(cwd, estado.ler(sessionId)) : null;
  if (ordem) partes.push(ordem);

  const regras = nucleo(cwd);
  if (regras) partes.push(regras.replace(/\s*$/, ''));

  if (ORIGENS_COM_ESTADO.indexOf(String(origem)) === -1) {
    return partes.length ? partes.join('\n') + '\n' : null;
  }

  const estadoPartes = [];

  const s = estado.ler(sessionId);
  const frente = s.frente;
  const esc = escopoLib.carregar(cwd, frente);
  if (esc && (esc.dentro.length || esc.objetivo)) {
    const linhas = [];
    // Com vinculo a uma frente que ainda existe, a primeira linha diz qual e -
    // sem isto, depois de uma compactacao o agente le "Dentro do escopo" e nao
    // tem como saber que o arquivo que manda e o da frente, nao o escopo.md.
    const arquivo = escopoLib.arquivoEmVigor(cwd, frente);
    if (frente && arquivo !== escopoLib.ARQUIVO) linhas.push('Frente: ' + escopoLib.nomeSeguro(frente) + ' (' + arquivo + ')');
    // F2-20: objetivo e itens vem de um arquivo que o dono edita a mao: passam por `umaLinha` (teto de tamanho).
    if (esc.objetivo) linhas.push('Objetivo: ' + umaLinha(esc.objetivo));
    linhas.push('Dentro do escopo:');
    for (const d of esc.dentro) linhas.push('  - ' + umaLinha(d));
    if (esc.fora.length) {
      linhas.push('Fora de escopo (a parte que funciona):');
      for (const f of esc.fora) linhas.push('  - ' + umaLinha(f));
    }
    estadoPartes.push(bloco('ESTADO - escopo declarado', linhas));
  }

  const ativo = planoLib.lerAtivo(cwd);
  // 0.3.3, item 29: plano fora do projeto nao se le (o titulo de tarefa de um arquivo de fora nao entra no
  // contexto); uma linha diz que foi ignorado.
  if (ativo && (typeof ativo.arquivo !== 'string' || ativo.arquivo.trim() === '')) {
    // F2-22: "arquivo" que nao e texto (numero, objeto, ausente) nao e caminho: diz que o plano ativo nao se
    // le, e por que, em vez de imprimir `undefined` ou `[object Object]`.
    const tipo = typeof ativo.arquivo === 'string' || ativo.arquivo === undefined || ativo.arquivo === null
      ? 'esta vazio ou ausente'
      : 'nao e um texto (e ' + (Array.isArray(ativo.arquivo) ? 'uma lista' : typeof ativo.arquivo) + ')';
    estadoPartes.push(bloco('ESTADO - plano em execucao', [
      'Plano ativo ilegivel: o campo "arquivo" de .claude/sworn/plano-ativo.json ' + tipo +
      '. Abra o plano de novo (ou apague esse arquivo).'
    ]));
  } else if (ativo && !caminhoLib.dentroPeloCaminhoReal(ativo.arquivo, cwd)) {
    // F2-21 (D334): "dentro" pelo caminho REAL - um link dentro do projeto que aponta para fora tambem e fora.
    estadoPartes.push(bloco('ESTADO - plano em execucao',
      ['Plano ativo ignorado: ' + umaLinha(ativo.arquivo) + ' fica fora do projeto e nao foi lido.']));
  } else if (ativo) {
    try {
      const tarefas = planoLib.parseTarefas(fs.readFileSync(path.join(cwd, ativo.arquivo), 'utf8'));
      const aberta = tarefas.filter(function (t) { return t.abertos > 0; })[0];
      // F2-20: os dois valores vem de um arquivo editavel a mao: uma linha so, com teto.
      const linhas = ['Plano: ' + umaLinha(ativo.arquivo), 'Dono: ' + declarado(ativo.sessionId)];
      if (aberta) {
        linhas.push('Tarefa aberta: Tarefa ' + aberta.n + ' - ' + aberta.titulo);
        linhas.push('Passos por marcar: ' + aberta.abertos + ' de ' + aberta.total);
        linhas.push('RELEIA o texto dessa tarefa NO ARQUIVO antes de continuar. Nao de memoria.');
      } else {
        linhas.push('Todas as tarefas com os passos marcados.');
      }
      estadoPartes.push(bloco('ESTADO - plano em execucao', linhas));
    } catch (e) {
      // 0.3.3, item 28: plano que nao se le nao derruba a abertura, mas diz que nao se leu (e por que).
      estadoPartes.push(bloco('ESTADO - plano em execucao', [
        'Plano: ' + umaLinha(ativo.arquivo),
        'O plano nao se leu (' + causaDoErro(e) + '): confira se o arquivo existe e se le, ou abra o plano de novo.'
      ]));
    }
  }

  // Plano 0.9.1 (Tarefa 1): `s.contadores` e do turno e morre no fecho; a conta da sessao e o turno somado ao balde
  // da sessao, a mesma que o gatilho de saude le.
  const c = saude.acumular(s);
  const chaves = Object.keys(c);
  if (chaves.length) {
    estadoPartes.push(bloco('ESTADO - portoes que dispararam nesta sessao',
      chaves.map(function (k) { return '  ' + c[k] + 'x ' + k; })));
  }

  const trabalho = linhasDoTrabalho(cwd, s);
  if (trabalho.length) estadoPartes.push(bloco('ESTADO - trabalho desta sessao', trabalho));

  if (!estadoPartes.length) return partes.length ? partes.join('\n') + '\n' : null;
  return partes.concat(estadoPartes).join('\n') + '\n';
}

module.exports = { ORIGENS_COM_ESTADO, contexto, nucleo, ordemDoHandoff, NEGACOES_DA_ORDEM, ordemDoCompact,
  cruzouSemAviso, cobrarOrdem, comandoCitaHandoff, motivoDaOrdem, montar };
