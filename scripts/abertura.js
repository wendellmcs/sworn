#!/usr/bin/env node
'use strict';
const io = require('./lib/io.js');
const estado = require('./lib/estado.js');
const git = require('./lib/git.js');
const fs = require('node:fs');
const path = require('node:path');
const regra = require('./lib/regra.js');
const config = require('./lib/config.js');
const textoLib = require('./lib/texto.js');
const escopoLib = require('./lib/escopo.js');

// A5-06: o gancho da abertura tem 15 s (hooks.json); o git que lista o repositorio inteiro (intocaveis, auditoria,
// atalhos) fica para a proxima sessao quando a abertura ja gastou 8 s. SWORN_ABERTURA_PRAZO_MS troca o prazo no teste.
const INICIO_DA_ABERTURA = Date.now();
const PRAZO_DA_ABERTURA_MS = (function () {
  const texto = process.env.SWORN_ABERTURA_PRAZO_MS;
  const n = /^\s*\d+\s*$/.test(texto || '') ? Number(texto) : 0;
  return n > 0 && Number.isSafeInteger(n) ? n : 8000;
})();
function passouDoPrazo() { return Date.now() - INICIO_DA_ABERTURA > PRAZO_DA_ABERTURA_MS; }
/** O prazo para a frase: abaixo de 1 s em ms, porque "0 s" diria que nao havia prazo. */
function prazoEmTexto() {
  return PRAZO_DA_ABERTURA_MS < 1000 ? PRAZO_DA_ABERTURA_MS + ' ms' : Math.round(PRAZO_DA_ABERTURA_MS / 1000) + ' s';
}

/** A causa de um erro numa linha da abertura: ASCII e curta, porque o texto chega ao Claude. */
function causa(erro) { return escopoLib.ascii(textoLib.causaDoErro(erro)).slice(0, 120); }

/**
 * P16-abertura-r1-10: o molde do aviso que nao derruba a abertura. `fn` devolve o texto (ou nada); se lancar, uma
 * linha diz o que nao rodou, a causa e o passo, e a abertura segue.
 */
function avisoSeguro(oQue, passo, fn) {
  try {
    const t = fn();
    if (t) process.stdout.write('\n' + t + '\n');
  } catch (erro) {
    process.stdout.write('\nsworn: ' + oQue + ' nao rodou (' + causa(erro) + '). ' + (passo ? passo + ' ' : '') +
      'O resto da abertura segue igual.\n');
  }
}

/**
 * S8/A2-4: a reinjecao avisa do projeto.json ilegivel quando ha regras a reinjetar (`nucleo` sai antes sem
 * regras.md ou sem nenhuma regra). Saber isso pela ESTRUTURA, e nao procurando a frase dela no texto, e o que
 * impede o aviso de dobrar se a frase for reescrita.
 */
function reinjecaoJaAvisou(cwd) {
  try {
    return regra.parseRegras(fs.readFileSync(path.join(cwd, '.claude', 'sworn', 'regras.md'), 'utf8')).length > 0;
  } catch (erro) { return false; }
}

const MARCA_REFERENCIA = 'referencia-avisada.json';

/**
 * D503 (plano d503, Tarefa 6): o aviso de que falta a referencia de topo, uma vez por projeto. So com o projeto.json
 * lido e sem a chave; a marca gravada diz que ja avisou. Marca que nao se grava nao derruba nada: a proxima abertura
 * avisa de novo. R5: ASCII, o texto chega ao Claude.
 */
function avisoDaReferencia(cwd, projeto) {
  if (!projeto || 'referencias' in projeto) return null;
  const marca = config.caminhoEmSworn(cwd, MARCA_REFERENCIA);
  if (fs.existsSync(marca)) return null;
  try { fs.writeFileSync(marca, JSON.stringify({ avisadoEm: new Date().toISOString() }) + '\n', 'utf8'); } catch (e) { /* avisa de novo */ }
  return 'sworn: este projeto nao declara a referencia de topo (chave referencias do .claude/sworn/projeto.json): ' +
    'a melhor peca que existe para cada tipo de entrega (tela, codigo, texto), que o /sworn:review poe ao lado do ' +
    'trabalho e contra a qual o fecho da entrega AAA cobra a revisao. Para declarar, rode /sworn:reference (estuda 2-3 ' +
    'produtos lideres do mesmo tipo e grava a ficha), rode /sworn:init de novo (Passo 4b) ou ponha a chave a mao; para ' +
    'nunca usar, grave "referencias": {}. Este aviso sai uma vez so.';
}

const MARCA_FICHAS = 'referencia-fichas-avisadas.json';
const DIAS_FICHA_VELHA = 180;

/** Marca ilegivel ou que nao e objeto (5, "x", lista): vale como vazia; senao a atribuicao do aviso lancava. */
function lerMarcaDasFichas(marca) {
  try {
    const vistos = JSON.parse(fs.readFileSync(marca, 'utf8'));
    return textoLib.ehObjeto(vistos) ? vistos : {};
  } catch (e) { return {}; }
}

/** O motivo de a ficha nao estar trabalhando, ou null. `emUso` tem as chaves do que a chave `referencias` declara. */
function motivoDaFicha(pasta, nome, emUso, chave, agora) {
  const ascii = escopoLib.ascii;
  const rel = '.claude/sworn/referencias/' + nome;
  if (!emUso.has(chave(rel))) return '"' + ascii(rel) + '" guardada fora de "referencias" do projeto.json (o /sworn:review nao a usa)';
  let data = null;
  try { data = (fs.readFileSync(path.join(pasta, nome), 'utf8').match(/Estudo de (\d{4}-\d{2}-\d{2})/) || [])[1]; } catch (e) { data = null; }
  if (!data) return null;
  const quando = Date.parse(data + 'T00:00:00Z');
  // P16-abertura-r1-18: mes ou dia fora da faixa (2026-13-45) da NaN, e o NaN > 180 falso passava como ficha em dia;
  // P16-abertura-r2: o dia que nao existe no mes (2026-02-30) o Date.parse rola para marco, entao a volta tem de bater
  if (Number.isNaN(quando) || new Date(quando).toISOString().slice(0, 10) !== data) return '"' + ascii(rel) + '" com "Estudo de ' + data + '", que nao e uma data (AAAA-MM-DD)';
  if ((agora - quando) / 86400000 > DIAS_FICHA_VELHA) {
    return '"' + ascii(rel) + '" estudada em ' + data + ', ha mais de ' + DIAS_FICHA_VELHA + ' dias';
  }
  return null;
}

/**
 * D615 (L9 do censo da D612): ficha de referencia que nao esta trabalhando - em .claude/sworn/referencias/ sem estar
 * na chave `referencias` (o /sworn:review nao a usa), com "Estudo de AAAA-MM-DD" ha mais de 180 dias (os lideres
 * mudam) ou com uma data que nao existe. So com a chave declarada: sem ela fala o aviso da D503. Cada ficha (e motivo)
 * avisada uma vez, pela marca; marca que nao se grava avisa de novo. R5: ASCII.
 */
function avisoDasFichas(cwd, projeto, agora) {
  if (!projeto || !projeto.referencias || typeof projeto.referencias !== 'object') return null;
  // P16-abertura-r1-1: a lista no lugar do objeto dava indices como tipo, e toda ficha saia guardada fora.
  // P16-abertura-r2-3: "referencias": {} e a escolha "nunca usar" do aviso da D503: nenhuma ficha e cobrada.
  if (Array.isArray(projeto.referencias) || !Object.keys(projeto.referencias).length) return null;
  const pasta = path.join(cwd, '.claude', 'sworn', 'referencias');
  let nomes;
  try { nomes = fs.readdirSync(pasta).filter(function (n) { return /\.md$/i.test(n); }); } catch (e) { return null; }
  // atalho: caminho comparado sem caixa em qualquer sistema.
  // limite: dois nomes so diferentes na caixa contam como um (a skill manda o nome em minusculas).
  // trocar quando: ficha com nome em maiuscula for aceita pela skill.
  // P16-abertura-r1-2: a barra invertida declarada no projeto.json vale como `/` tambem fora do Windows.
  const chave = function (p) { return path.resolve(cwd, p.replace(/\\/g, '/')).toLowerCase(); };
  const emUso = new Set();
  for (const tipo of Object.keys(projeto.referencias)) {
    const lista = projeto.referencias[tipo];
    if (Array.isArray(lista)) for (const p of lista) if (typeof p === 'string') emUso.add(chave(p));
  }
  const marca = config.caminhoEmSworn(cwd, MARCA_FICHAS);
  const vistos = lerMarcaDasFichas(marca);
  const atuais = new Set();
  const partes = [];
  for (const nome of nomes) {
    const motivo = motivoDaFicha(pasta, nome, emUso, chave, agora);
    if (!motivo) continue;
    atuais.add(motivo);
    if (vistos[motivo]) continue;
    vistos[motivo] = new Date(agora).toISOString();
    partes.push(motivo);
  }
  // P16-abertura-r1-7: o motivo que deixou de valer (a ficha entrou em "referencias", foi estudada de novo) sai da
  // marca; se ele voltar, a ficha e avisada de novo.
  let mudou = partes.length > 0;
  for (const k of Object.keys(vistos)) if (!atuais.has(k)) { delete vistos[k]; mudou = true; }
  if (mudou) { try { fs.writeFileSync(marca, JSON.stringify(vistos) + '\n', 'utf8'); } catch (e) { /* avisa de novo */ } }
  if (!partes.length) return null;
  return 'sworn: fichas de referencia sem uso, velhas ou com data errada: ' + partes.join('; ') + '. Para usar a ' +
    'guardada, ponha o caminho em "referencias" (ou rode /sworn:reference, que grava com o seu sim); para a velha, ' +
    'rode /sworn:reference de novo para estudar os lideres de hoje; para a data errada, corrija o "Estudo de ' +
    'AAAA-MM-DD" na ficha. Cada ficha e avisada uma vez.';
}

io.blindar(function () {
  io.lerEntrada(function (e) {
    // T2 do plano nome+pagina (D623): a pasta antiga (.claude/esquadro/) vira .claude/sworn/ antes de tudo, porque o
    // raizDoProjeto abaixo so procura a nova. Mesma segunda rede da auditoria.
    // L5-s107-7: so o cwd que e texto vale (como no abrir-subagente.js); outro valor cai no da pasta do processo.
    const cwdDaEntrada = typeof e.cwd === 'string' && e.cwd ? e.cwd : process.cwd();
    // H6a2 (D892, defeito 1): na compactacao o stdout se junta ate a saida (ou a falha, pelo io.antesDeSair); o que
    // passa do que o harness mostra vai inteiro para .sworn/reabertura/ e sai a previa, com as ordens na frente.
    let raizDaReabertura = cwdDaEntrada;
    let ordensDaReabertura = null;
    if (e.source === 'compact') {
      const curta = require('./lib/reabertura-curta.js');
      curta.juntar();
      io.antesDeSair(function () { curta.soltar(raizDaReabertura, e.session_id, ordensDaReabertura); });
    }
    try {
      const migrou = require('./lib/migracao.js').migrarProjeto(cwdDaEntrada);
      if (migrou) process.stdout.write(migrou + '\n\n');
    } catch (erro) {
      process.stdout.write('sworn: migracao da pasta antiga nao rodou (' + causa(erro) + '). O resto da abertura segue igual.\n\n');
    }
    const cwd = config.raizDoProjeto(cwdDaEntrada);
    raizDaReabertura = cwd;
    // A5-05: o estado que nao grava (pasta que nao se cria, disco cheio) nao cala a abertura - o io.blindar engolia o
    // erro e nada saia. A reinjecao nao depende do estado; uma linha diz o que ficou de fora (molde da auditoria).
    let semEstado = null;
    try {
      estado.alterar(e.session_id, function (s) {
        // D17: a foto e tirada uma vez, na abertura. Arquivo que ja estava
        // modificado aqui pertence a outra frente ate prova em contrario.
        // D46: o SessionStart tambem dispara em `compact` e em `resume`, com o
        // MESMO session_id. Sem esta guarda a foto seria refeita com o git status
        // ATUAL, que ja contem o trabalho do proprio agente - e depois de uma
        // compactacao de contexto o agente ficaria barrado nos proprios arquivos.
        // A guarda olha a foto, nao a origem: origem nova no harness nao deixa
        // a trava muda sem avisar.
        // V3 (D846): a hora da abertura, uma vez por sessao (o compact e o resume mantem a primeira): o arquivo que
        // outra sessao escreve depois dela e de outra frente (lib/toques.js), como o que ja estava na foto.
        if (!Number.isFinite(s.inicioMs)) s.inicioMs = Date.now();
        if (Array.isArray(s.gitAbertura)) return s;
        const foto = git.modificados(cwd);
        // D49: `null` e "nao consegui fotografar" (git ausente, fora de repo,
        // timeout); `[]` e "arvore limpa". Congelar uma foto que falhou deixaria a
        // trava 5b muda pelo resto da sessao, em silencio - e uma reabertura
        // (`compact`, `resume`) e justamente a segunda chance de conseguir.
        if (foto === null) return s;
        s.gitAbertura = foto;
        s.abertoEm = e.source || null;
        return s;
      });
    } catch (erro) {
      semEstado = 'sworn: o estado da sessao nao gravou (' + causa(erro) +
        '): sem a foto do git e sem a hora da abertura, a trava de outra frente (o que ja vinha modificado e o que ' +
        'outra sessao escreve depois) fica desligada ate a proxima abertura. O resto da abertura segue igual.\n';
    }
    // A2: stdout de abertura de sessao entra como contexto que o Claude ve.
    // Roda em toda reabertura de proposito: e depois da compactacao que a regra
    // se perde, e e por isso que ela se reinjeta em vez de so se ler uma vez.
    const projeto = config.carregarProjeto(cwd);
    // P16-abertura-r1-25: o caminho que o agente copia vai entre as aspas do shell declarado (lib/texto.js)
    const caminhoParaShell = function (p) {
      return textoLib.caminhoParaShell(p, ((projeto && projeto.plataforma) || {}).shell);
    };
    // s357 (F2): na compactacao, o limiar de tamanho cruzado sem aviso dado vale como o aviso
    // (reinjecao.cruzouSemAviso), e a ordem "grave o handoff" sai no texto abaixo. Estado que nao grava: sem a ordem,
    // e uma linha depois do texto diz isso (A5-05; o texto tem de comecar pela ordem, por causa do corte de 10 mil).
    let semMarca = null;
    if (e.source === 'compact') {
      try {
        /* s359 (F2b): no agy e no dsh a ponte roda este compact depois da queda, com a transcricao ja baixa, e manda
           o pico de antes dela (sworn_pico, ponte.quedaSemAviso). */
        const contexto = typeof e.sworn_pico === 'number' ? e.sworn_pico
          : require('./lib/saude.js').contextoDoTranscript(e.transcript_path);
        estado.alterar(e.session_id, function (s) {
          if (require('./lib/reinjecao.js').cruzouSemAviso(s, contexto, projeto)) s.avisouSaude = true;
          return s;
        });
      } catch (erro) {
        semMarca = 'sworn: o tamanho desta conversa nao foi conferido na compactacao (' + causa(erro) + '): se ela passou do gatilho sem o aviso de ' +
          'saude, grave o handoff com /sworn:handoff antes de seguir.\n';
      }
    }
    // as ordens se leem antes do montar e da marca zerada abaixo, que as consome
    if (e.source === 'compact') ordensDaReabertura = require('./lib/reinjecao.js').ordensDoCompact(cwd, e.session_id);
    const texto = require('./lib/reinjecao.js').montar(cwd, e.session_id, e.source);
    if (texto) process.stdout.write(texto);
    if (semEstado) process.stdout.write((texto ? '\n' : '') + semEstado);
    if (semMarca) process.stdout.write((texto || semEstado ? '\n' : '') + semMarca);
    // D786 passo 3: a ordem do handoff (se houve) saiu no texto acima e a marca se consome; a conversa compactada cabe
    // de novo, entao o aviso de saude e o alarme rearmam, so pelo tamanho quando ja houve aviso (saude.avaliar).
    if (e.source === 'compact') {
      try {
        estado.alterar(e.session_id, function (s) {
          // D786 passo 5: a ordem dada acima vira cobranca no portao do Write/Edit; sem ordem, a de antes cai.
          const ordem = require('./lib/reinjecao.js').ordemDoCompact(s);
          if (ordem) s.ordemDoCompact = ordem; else delete s.ordemDoCompact;
          if (s.avisouSaude === true) s.saudeRearmada = true;
          s.avisouSaude = false;
          s.avisouAlarme = false;
          s.handoffDaSessao = null;
          return s;
        });
      } catch (erro) {
        process.stdout.write('\nsworn: a marca do handoff nao zerou depois da compactacao (' + causa(erro) + '): a proxima pode repetir a ordem acima, e o ' +
          'aviso de tamanho so volta na sessao seguinte.\n');
      }
    }
    // D420/PT-04: projeto.json PRESENTE e ilegivel (config devolve null igual ao ausente) so era
    // avisado dentro da reinjecao, que sai antes quando nao ha regras.md - e os portoes de
    // escopo/intocaveis ficavam desligados sem ninguem saber. Aqui o aviso sai com ou sem regras;
    // quando a reinjecao ja o disse, nao dobra. Falha aberta de proposito: so a mensagem.
    // A2-19: o mesmo texto do portao do escopo (lib/config.js), com o passo do validar.js.
    if (!projeto && fs.existsSync(config.caminhoEmSworn(cwd, 'projeto.json')) &&
        !reinjecaoJaAvisou(cwd)) {
      process.stdout.write((texto ? '\n' : '') + config.AVISO_PROJETO_ILEGIVEL + '\n');
    }
    // Qualidade de resposta: sai em toda abertura, com ou sem projeto.json, depois das regras;
    // so `qualidadeDeResposta: false` no projeto desliga.
    // D451: a regra de paralelismo, antes da qualidade e no mesmo molde; so `paralelismo: false` desliga.
    // C6 (D815): com "aberturaEnxuta": true, os 4 blocos abaixo saem como uma linha de resumo cada
    const curta = require('./lib/abertura-enxuta.js');
    const paralelo = curta.bloco('paralelo', require('./lib/paralelismo.js').bloco(projeto), projeto);
    if (paralelo) process.stdout.write((texto ? '\n' : '') + paralelo);
    // D467: menos paradas, entre paralelismo e qualidade; sai sempre (com a chave modoContinuo, com o modo continuo).
    const continuoLib = require('./lib/continuo.js');
    const continuo = curta.bloco(continuoLib.ativo(projeto) ? 'continuo' : 'continuoDesligado', continuoLib.bloco(projeto),
      projeto);
    process.stdout.write((texto || paralelo ? '\n' : '') + continuo);
    const qualidade = curta.bloco('qualidade', require('./lib/qualidade.js').bloco(projeto), projeto);
    if (qualidade) process.stdout.write('\n' + qualidade);
    // D554 (0.9.0): menos codigo, por ultimo, no mesmo molde; so `menosCodigo: false` desliga.
    const enxuto = curta.bloco('enxuto', require('./lib/enxuto.js').bloco(projeto), projeto);
    if (enxuto) process.stdout.write('\n' + enxuto);
    if (curta.ativa(projeto)) process.stdout.write('\n' + curta.RODAPE + '\n');
    // F4e: o guia oficial do modelo da propria sessao (o campo model do SessionStart; sem ele, a ultima resposta da
    // transcricao), depois dos blocos fixos; fica fora na abertura enxuta e com "guiaDoModelo": false.
    if (!curta.ativa(projeto) && !(projeto && projeto.guiaDoModelo === false)) {
      const guiasLib = require('./lib/guias-modelo.js');
      const modelo = typeof e.model === 'string' && e.model.trim() ? e.model : '';
      const familia = guiasLib.familiaDoDespacho(modelo, null, modelo ? '' : require('./lib/juiz.js').modeloDaSessao(e.transcript_path));
      const guia = familia ? guiasLib.pronto(path.join(__dirname, '..'), familia) : null;
      if (guia && guia.bloco) {
        process.stdout.write('\n# sworn - guia do modelo da sessao (' + guia.modelo +
          '): o guia oficial da Anthropic para este modelo, resumido; vale onde nao contrariar o dono nem as regras acima.\n' +
          guia.bloco + '\n');
      }
    }
    // F4e3: no repositorio do proprio plugin, o lembrete de conferir os guias quando a ultima conferencia passa de 30 dias
    if (require('./lib/vigia-local.js').ehRepoDoPlugin(cwd)) {
      const guiasLib = require('./lib/guias-modelo.js');
      let estadoDosGuias = null;
      try { estadoDosGuias = JSON.parse(fs.readFileSync(guiasLib.arquivoDoEstado(process.env), 'utf8')); } catch (erro) { /* nunca conferiu */ }
      const lembrete = guiasLib.avisoDeRenovacao(config.raizDoProjeto(cwd), estadoDosGuias, guiasLib.diaLocal(new Date()));
      if (lembrete) process.stdout.write('\n' + lembrete + '\n');
    }
    const heranca = escopoLib.avisoHeranca(cwd, estado.ler(e.session_id).frente);
    if (heranca) process.stdout.write('\n' + heranca + '\n');
    // R3g: o ponto da compactacao automatica, uma vez por projeto, em qualquer projeto (scripts/lib/compactacao.js).
    // Na reabertura da compactacao nao: a conversa ja compactou, e a abertura seguinte grava.
    if (e.source !== 'compact') {
      avisoSeguro('a conferencia do ponto da compactacao automatica', 'A proxima abertura tenta de novo.', function () {
        return require('./lib/compactacao.js').gravarNaAbertura(cwd, projeto);
      });
    }

    // O buraco que a D104 mediu e deixou aberto: `intocaveis` com typo fica
    // INERTE em silencio - nao e erro de tipo nem de sintaxe, entao nenhum
    // validador ve. Confere-se UMA vez por sessao, aqui, porque exige listar o
    // repositorio e os portoes de custo zero nao podem pagar isso a cada escrita.
    const projetoLib = require('./lib/projeto.js');
    // F1g (s372): sem padrao em `intocaveis` nao ha o que conferir, e o `ls-files` era um git a mais em toda abertura.
    const temIntocaveis = Boolean(projeto && Array.isArray(projeto.intocaveis) && projeto.intocaveis.length);
    // A5-06: depois do prazo, o que lista o repositorio inteiro fica para a proxima sessao (uma linha diz o que ficou).
    const intocaveisAdiados = passouDoPrazo();
    const rastreados = temIntocaveis && !intocaveisAdiados ? git.rastreados(cwd) : [];
    const inertes = projetoLib.intocaveisInertes(projeto, rastreados, cwd);
    // P16-abertura-r2: o ls-files pode gastar o resto do prazo; confere de novo antes da auditoria e dos atalhos.
    const adiada = intocaveisAdiados || passouDoPrazo();
    if (adiada) {
      // So cita a conferencia dos `intocaveis` quando ela de fato ficou para tras (havia padrao e o prazo ja tinha passado).
      process.stdout.write('\nsworn: a abertura passou de ' + prazoEmTexto() + '; para nao estourar o tempo do gancho, ' +
        'ficou para a proxima sessao o que lista o repositorio inteiro: ' +
        (temIntocaveis && intocaveisAdiados ? 'a conferencia de que cada padrao de `intocaveis` pega algum arquivo, ' : '') +
        'a auditoria e a revisao dos atalhos, quando vencidas (para nao esperar, rode /sworn:audit e /sworn:shortcuts ' +
        'a mao). Se a demora repetir, rode git status nesta pasta para ver se o git esta lento.\n');
    }
    // F1-C12: `null` e "o git nao respondeu" - e nao e "nenhum inerte". Calar aqui
    // fazia "nao sei" parecer "esta tudo certo". So se diz quando ha o que duvidar.
    if (rastreados === null && temIntocaveis) {
      // A5-02 (D735): sem o jargao "intocavel inerte"; o efeito e o passo, causas do null de git.js:102.
      process.stdout.write('\nsworn: nao deu para conferir se os padroes de `intocaveis` ' +
        '(.claude/sworn/projeto.json)\npegam algum arquivo: o git nao respondeu ' +
        '(git ausente, pasta fora de um repositorio ou demora).\n' +
        'Se algum nao pegar arquivo nenhum, a protecao dele pode estar sem efeito agora.\n' +
        'Rode git status nesta pasta para ver a causa; a conferencia volta na proxima sessao.\n');
    }
    if (inertes.length) {
      process.stdout.write('\n' + projetoLib.motivoInerte(inertes) + '\n');
    }
    // D442/5 (S-35, S-68): o aviso de tipo so saia na primeira escrita (portao-escopo), e o dono que pos
    // `"sugerirAprender": "false"` achava que tinha desligado. So o booleano decide (D388, D415).
    const tipos = projetoLib.avisosDeTipo(projeto);
    if (tipos.length) {
      process.stdout.write('\nsworn: ATENCAO - valor de tipo errado em .claude/sworn/projeto.json: ' + tipos.join('; ') +
        '. Para ligar ou desligar vale so true ou false, sem aspas: "false" entre aspas NAO desliga.\n');
    }
    // D503 (plano d503, Tarefa 6): sem a chave `referencias`, avisa uma vez por projeto; a marca fica em
    // .claude/sworn/ (como a da auditoria, depois da foto do git). Com a chave, ate `{}`, calada.
    const avisoRef = avisoDaReferencia(cwd, projeto);
    if (avisoRef) process.stdout.write('\n' + avisoRef + '\n');
    // D615 (L9): com a chave declarada, a ficha guardada sem uso, velha ou com data errada. Rede propria: nada dela
    // derruba a abertura.
    avisoSeguro('aviso das fichas de referencia', 'As fichas ficam em .claude/sworn/referencias/; confira-as a mao ' +
      'contra a chave "referencias" do projeto.json, ou rode /sworn:reference.', function () {
      return avisoDasFichas(cwd, projeto, Date.now());
    });
    // A2 (D426): auditoria periodica. Depois da foto do git (a marca nao entra nela) e antes do plano
    // ativo, que segue por ultimo. A lib ja nao lanca; o try/catch aqui e a segunda rede, para que
    // nada da auditoria derrube o resto da abertura.
    // F1g (s372): a auditoria e a revisao dos atalhos vencem juntas na primeira abertura do projeto, e cada uma listava
    // o repositorio inteiro (3 git). A lista sai uma vez por abertura e serve as duas; mora aqui, e nao na lib, que
    // vive mais que uma abertura. A busca que lanca nao guarda nada, e a segunda tenta de novo, como antes.
    let atalhosDaAbertura = null;
    const atalhosUmaVez = function (dirAtalhos, projetoAtalhos) {
      if (atalhosDaAbertura === null) atalhosDaAbertura = require('./lib/atalhos.js').daPastaEDeDentro(dirAtalhos, projetoAtalhos);
      return atalhosDaAbertura;
    };
    if (!adiada) {
      try {
        // Plano 092 (D573): a entrada do gancho leva o transcript_path, de onde sai a conversa anterior.
        const auditoriaTexto = require('./lib/auditoria-periodica.js').avisoDaAuditoria(cwd, projeto, { entrada: e, atalhos: atalhosUmaVez });
        if (auditoriaTexto) process.stdout.write('\n' + auditoriaTexto + '\n');
        // Pedido 32 (Tarefa 4 subitem 3): a marca da sessao que acende o botao do /sworn:audit na faixa do mod. Plano
        // 091 T6: so com a ordem de cortar (a retroalimentacao sozinha nao pede nada), e ai conta a ordem dada.
        if (require('./lib/auditoria-periodica.js').pedeCorte(auditoriaTexto)) {
          estado.alterar(e.session_id, function (s) { s.auditoriaAvisou = true; s.ordensPendentes = require('./lib/ordens.js').marcarDada(s, 'auditar'); return s; });
        }
      } catch (erro) {
        // S8/A2-3: aqui chega falha do `require` da lib (ela propria ja nao lanca) ou, desde o plano 091 T6, da marca
        // da sessao depois do aviso impresso. Calar deixava a auditoria morta para sempre sem ninguem saber; uma linha
        // diz que nao rodou inteira e por que. A abertura segue.
        process.stdout.write('\nsworn: auditoria automatica nao rodou inteira (' + causa(erro) + '). Rode /sworn:audit a mao. ' +
          'O resto da abertura segue igual.\n');
      }
    }
    // Plano 092 (D574, mock D576): a revisao dos atalhos, a cada 30 dias, com marca propria, depois da auditoria. A lib
    // nao lanca; aqui so falha do require, e a abertura segue.
    if (!adiada) {
      avisoSeguro('revisao dos atalhos', 'Rode /sworn:shortcuts a mao.', function () {
        return require('./lib/auditoria-periodica.js').avisoDosAtalhos(cwd, projeto, { atalhos: atalhosUmaVez });
      });
    }
    // Plano 091 (#4, D559): ordem de calibrar (30+ conversas, nunca calibrado). A lib nao lanca; a rede e a do vigia.
    try {
      const calibrar = require('./lib/ordens.js').ordemDoCalibrar(cwd, projeto);
      if (calibrar) {
        process.stdout.write('\n' + calibrar + '\n');
        estado.alterar(e.session_id, function (s) { s.ordensPendentes = require('./lib/ordens.js').marcarDada(s, 'calibrar'); return s; });
      }
    } catch (erro) {
      // Como a auditoria (S8/A2-3): calar esconderia a ordem morta. O botao do calibrar segue na faixa.
      process.stdout.write('\nsworn: ordem do calibrar nao rodou inteira (' + causa(erro) + '). Para calibrar agora, rode ' +
        '/sworn:calibrate. O resto da abertura segue igual.\n');
    }
    // Plano 091 (#7, D559): sem projeto.json, ordem de perguntar o init. Uma vez por sessao: a reabertura (compact,
    // resume) nao repete; o "depois" e a sessao seguinte.
    try {
      if (!estado.ler(e.session_id).ordemDoInit) {
        const init = require('./lib/ordens.js').ordemDoInit(cwd, projeto, {
          comandoNunca: 'node ' + caminhoParaShell(path.join(__dirname, 'recusar-init.js')) + ' ' + caminhoParaShell(cwd)
        });
        if (init) {
          process.stdout.write('\n' + init + '\n');
          estado.alterar(e.session_id, function (s) { s.ordemDoInit = true; s.ordensPendentes = require('./lib/ordens.js').marcarDada(s, 'init'); return s; });
        }
      }
    } catch (erro) {
      // Idem; se a marca da sessao nao gravou, a ordem pode sair de novo na reabertura, e esta linha diz por que.
      process.stdout.write('\nsworn: ordem do init nao rodou inteira (' + causa(erro) + '). Se o projeto ainda nao tem ' +
        '.claude/sworn/projeto.json, rode /sworn:init. O resto da abertura segue igual.\n');
    }
    // Bloco V (D426/D437): a novidade da semana do vigia. So le o disco (D148: gancho nenhum abre rede);
    // opt-in por `"vigia": true`; sem a chave so liga no repositorio do plugin (plano 091 #10, pelo cwd cru: a raiz
    // do projeto.json pode ser outra pasta acima). Mesma segunda rede da auditoria.
    // T2 (D623): antes, a pasta antiga do vigia na home, pela mesma chave; depois do vigia gravar, a nova ja existiria.
    avisoSeguro('migracao da pasta antiga do vigia', 'Se ~/.claude/esquadro/ existir, leve a mao para ~/.claude/sworn/ o ' +
      'que ainda servir: o sworn le so a nova.', function () {
      return require('./lib/migracao.js').migrarCasa(null, process.env, projeto, cwdDaEntrada);
    });
    // P16-abertura-r1-22: a linha da falha diz o passo, nos dois avisos que dependem da chave "vigia". P16-abertura-r2:
    // o /sworn:radar le so a ficha do radar; a novidade do vigia se le a mao, no arquivo que a tarefa agendada puxa.
    const desligarVigia = 'ou desligue com "vigia": false no .claude/sworn/projeto.json.';
    avisoSeguro('vigia', 'Leia a novidade a mao em ~/.claude/sworn/vigia/novidades.md, ' + desligarVigia, function () {
      return require('./lib/vigia-local.js').avisoDoVigia(projeto, { cwd: cwdDaEntrada });
    });
    // Plano do radar, T4: a ficha da semana do radar, puxada para <pasta do vigia>/radar/. Mesma chave e mesma rede.
    avisoSeguro('radar', 'Rode /sworn:radar a mao, ' + desligarVigia, function () {
      return require('./lib/vigia-local.js').avisoDoRadar(projeto, { cwd: cwdDaEntrada });
    });
    // H12a (D913): a sessao que roda o sworn velho com o novo ja instalado (o /clear nao recarrega o plugin).
    avisoSeguro('a conferencia da versao carregada', 'Compare a mao a versao do plugin.json com a do /plugin.', function () {
      return require('./lib/versao-carregada.js').aviso();
    });
    const planoLib = require('./lib/plano.js');
    const ativo = planoLib.lerAtivo(cwd);
    if (planoLib.donoOutro(ativo, e.session_id)) {
      process.stdout.write([
        '',
        '# sworn - ATENCAO: outra sessao detem o plano ativo',
        '',
        'Plano: ' + ativo.arquivo,
        'Dono registrado: ' + ativo.sessionId + ' (esta sessao e outra).',
        '',
        'Nao edite esse arquivo nem o log de decisoes sem combinar com o dono.',
        'Numero de decisao se le do disco:',
        '  node ' + caminhoParaShell(path.join(__dirname, 'plano.js')) + ' --proxima-decisao <arquivo>',
        ''
      ].join('\n'));
    }
    // Sem decisao: sozinho, o io.permitir sai com 0 sem escrever nada, como a saida direta de antes; no modo embutido
    // (rodarJuntos) so registra "sem opiniao", e o teste roda a abertura sem abrir um processo (F1g).
    io.permitir();
  });
});
