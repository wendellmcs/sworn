#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const io = require('./lib/io.js');
const estado = require('./lib/estado.js');
const config = require('./lib/config.js');
const caminhoLib = require('./lib/caminho.js');
const marchaLib = require('./lib/marcha.js');
const escopoLib = require('./lib/escopo.js');
const glob = require('./lib/glob.js');
const projetoLib = require('./lib/projeto.js');
const design = require('./lib/design.js');
const buscaLib = require('./lib/busca.js');
const catraca = require('./lib/catraca.js');

/** C9: o alvo ja existe? Se nao existe, isto e criacao, e criacao exige busca. F3c (D828): no erro (entrada torta), conta
 *  como criacao, o lado que exige a busca; antes contava como "existe" e liberava a trava 7. */
function existe(cwd, alvo) {
  try { return fs.existsSync(path.join(cwd, alvo)); } catch (err) { return false; } // fail-closed: criacao, exige a busca
}

/*
 * D420/PT-03: o contador e SECUNDARIO - a negacao nunca pode depender dele. Com o diretorio
 * de estado nao gravavel o `estado.incrementar` lanca (mkdir ENOTDIR), o `blindar` libera, e o
 * Write em arquivo intocavel passava. Por isso cada contagem que vem antes de um
 * `negarFerramenta` passa pelo `incrementar` daqui, que engole a falha (A2-20: antes era um
 * try/catch copiado em cada uma), com o balde LITERAL na chamada (o auxiliar-baldes.js descobre
 * os baldes pelo texto `incrementar(<sessao>, '<balde>'`, com ou sem o `estado.` na frente):
 * falhar em contar so perde o numero.
 */
/**
 * D420/PT-03: o marcador de "avisou uma vez" tambem e so estado. Se nao grava, o aviso sai
 * mesmo assim (pode repetir) - perder o aviso por causa do estado seria pior que repeti-lo.
 */
function marcar(sessionId, fn) {
  try { estado.alterar(sessionId, fn); } catch (err) { /* idem */ }
}

/**
 * S2/L1-8: o contador que nao grava deixa UM rastro por disparo (cada hook e um processo; um
 * `estado` ingravavel nao guarda "ja avisei", entao nao ha como deduplicar entre disparos sem
 * o proprio estado). O rastro pega CARONA na saida que o portao ja ia dar - o motivo da
 * negacao ou o `systemMessage` da liberacao - e nunca muda a decisao.
 */
// A2-04/05 (D721): os avisos dizem a pasta que recusou a escrita, para o passo ter onde agir.
const PASTA_DO_ESTADO = path.dirname(estado.caminhoSessao('x'));
const AVISO_CONTADOR = 'sworn: o contador desta edicao nao foi gravado (a pasta de estado do sworn, ' +
  PASTA_DO_ESTADO + ', nao aceita escrita): os totais do fim do turno podem sair menores que o real. ' +
  'A decisao sobre esta edicao nao mudou; para voltar a contar, libere a escrita nessa pasta.';
let contadorFalhou = false;

/** Conta o `balde` da sessao; o estado que nao grava so marca o rastro (`contadorFalhou`), nunca lanca. */
function incrementar(sessionId, balde) {
  try { estado.incrementar(sessionId, balde); } catch (err) { contadorFalhou = true; } // fail-open: so perde o numero; a decisao do portao nao depende dele
}

/** Nega, anexando o rastro do contador quando ele falhou antes. */
function negar(motivo) {
  return io.negarFerramenta(contadorFalhou ? motivo + '\n\n' + AVISO_CONTADOR : motivo);
}

/** A2-21 (H1): o projeto.json existe no disco? So o arquivo, nao se ele se le (o chamador diz o resto). */
function projetoNoDisco(cwd) {
  // fail-open: so escolhe a mensagem do aviso, nao a decisao
  try { return fs.existsSync(config.caminhoEmSworn(cwd, 'projeto.json')); } catch (err) { return false; }
}

// A2-19: o texto (com o passo e o caminho do validar.js) mora no lib/config.js, o mesmo da abertura.
const AVISO_PROJETO_ILEGIVEL = config.AVISO_PROJETO_ILEGIVEL;

// L2-s103-07: o portao nao le sem medida. O arquivo de escopo vai ate 1 MB (acima, conta vazio: fail-closed, abaixo).
// O alvo que a catraca e o design comparam inteiro vai ate 32 MB; acima, `GRANDE`, e a catraca nega (ler so o trecho
// deixava o arquivo inchado de proposito afrouxar a regua por um Edit so do numero ou por um Write).
const BYTES_DO_ESCOPO = 1024 * 1024;
const BYTES_COMPARADOS = 32 * 1024 * 1024;
const GRANDE = { grande: true };
/** O texto do arquivo; `null` se nao existe ou nao se le; `GRANDE` se passa de `bytes`. */
function lerMedido(abs, bytes) {
  try {
    if (fs.statSync(abs).size > bytes) return GRANDE;
    return fs.readFileSync(abs, 'utf8');
  } catch (err) { return null; } // fail-open na catraca (so o trecho do Edit), fail-closed no escopo (conta vazio)
}

function motivoGrande(alvo, bytes) {
  return [
    'sworn: NEGADO - este arquivo passa de ' + Math.round(bytes / (1024 * 1024)) + ' MB, e o portao nao o le inteiro',
    'para conferir se a edicao afrouxa um limite de qualidade (o numero que um teste ou checagem usa como regua).',
    '',
    'Arquivo: ' + alvo,
    '',
    'Proximo passo: divida o arquivo em partes menores, ou peca ao dono que faca esta edicao fora do agente.'
  ].join('\n');
}

/** L2-s103-05: o "antes" do NotebookEdit e a celula do mesmo `cell_id` no notebook do disco; inserir uma celula (ou
 *  nao achar a do id) compara com o notebook inteiro, porque a celula nova pode redefinir o que outra ja dizia. */
function antesDaCelula(atual, entrada) {
  if (entrada.edit_mode !== 'insert' && typeof entrada.cell_id === 'string') {
    try {
      const nb = JSON.parse(atual);
      const cel = (Array.isArray(nb && nb.cells) ? nb.cells : []).find(function (c) { return c && c.id === entrada.cell_id; });
      if (cel) return Array.isArray(cel.source) ? cel.source.join('') : String(cel.source == null ? '' : cel.source);
    } catch (err) { /* fail-open: nao e JSON, o antes vira o arquivo inteiro, abaixo */ }
  }
  return atual;
}

/**
 * X2a: o aviso pega CARONA num `permitir` que ja ia acontecer. Um
 * `io.permitir({systemMessage})` novo na "posicao natural" - antes do passo 1 -
 * derrubava a protecao de `intocaveis`, porque `permitir` sai do portao.
 * Uma vez por sessao, como o `avisouSemConfig` do passo 3, abaixo.
 */
function permitirComAviso(e, s, avisos) {
  if (avisos.length && !s.avisouTipoErrado) {
    marcar(e.session_id, function (x) { x.avisouTipoErrado = true; return x; });
    return io.permitir({ systemMessage: 'sworn: projeto.json com campo de tipo errado: ' + avisos.join('; ') });
  }
  return io.permitir();
}

io.blindar(function () {
  io.lerEntrada(function (e) {
    const cwd = config.raizDoProjeto(e.cwd || process.cwd());
    const entrada = e.tool_input || {};
    // A12-02: o NotebookEdit traz o arquivo em `notebook_path`, nao em `file_path`.
    const alvo = caminhoLib.relativoAoProjeto(entrada.file_path || entrada.notebook_path, cwd);
    if (!alvo) return io.permitir();

    // Escopo por frente: o arquivo de UMA frente tem o mesmo passe livre do
    // escopo.md (logo abaixo) e vincula a sessao a ela. Nome fora da classe
    // [a-zA-Z0-9_-] e negado sem gravar nada: sem isto o arquivo seria escrito
    // com um nome e o leitor procuraria outro, e a sessao acharia que esta
    // vinculada sem estar.
    const frenteAlvo = escopoLib.frenteDoAlvo(alvo);
    if (frenteAlvo && !frenteAlvo.valido) {
      incrementar(e.session_id, 'frente_invalida');
      return negar(escopoLib.motivoNomeDeFrente(alvo));
    }

    // D35: o passe livre e do ARQUIVO de escopo, nao da pasta. Sem ele nao ha
    // como declarar escopo; com ele largo demais, projeto.json e contadores.json
    // ficariam gravaveis sem portao e sem contagem.
    // D38: comparacao sem diferenciar caixa - o sistema de arquivos nao diferencia,
    // e "Escopo.md" nao pode escapar do passe livre so por causa da letra.
    if (alvo.toLowerCase() === escopoLib.ARQUIVO || frenteAlvo) {
      // D34: conta a ampliacao tambem na CRIACAO, e so quando a lista "Dentro" cresce.
      // fail-closed: o escopo que nao se le (ou passa de 1 MB) conta vazio, e todo o Dentro novo conta como ampliacao
      const lido = lerMedido(path.join(cwd, alvo), BYTES_DO_ESCOPO);
      const atual = typeof lido === 'string' ? lido : '';
      const depoisTexto = escopoLib.conteudoDepois(atual, entrada);
      const depois = depoisTexto === null ? null : escopoLib.parse(depoisTexto);
      if (escopoLib.ampliou(escopoLib.parse(atual), depois)) {
        incrementar(e.session_id, 'escopo_ampliado');
        // A5b (s369): o apagar confere o escopo da abertura do turno; o ampliado agora so vale no turno seguinte
        marcar(e.session_id, function (x) { x.escopoAmpliadoNoTurno = true; return x; });
      }
      // Ultima frente escrita vence: uma sessao so tem um vinculo por vez.
      // S2/L1-7: a edicao do arquivo da frente segue LIBERADA se o vinculo nao grava (nao fura
      // negacao), mas o silencio fazia a sessao achar que estava vinculada sem estar: avisa.
      const avisosDaFrente = [];
      if (frenteAlvo) {
        try { estado.alterar(e.session_id, function (x) { x.frente = frenteAlvo.nome; return x; }); } catch (err) {
          avisosDaFrente.push('sworn: o vinculo desta sessao a frente "' + frenteAlvo.nome + '" nao foi gravado ' +
            '(a pasta de estado do sworn, ' + PASTA_DO_ESTADO + ', nao aceita escrita): as edicoes seguem pelo ' +
            'escopo.md, nao por esta frente. Para vincular, libere a escrita nessa pasta e edite de novo ' +
            'o arquivo da frente.');
        }
      }
      if (contadorFalhou) avisosDaFrente.push(AVISO_CONTADOR);
      return avisosDaFrente.length ? io.permitir({ systemMessage: avisosDaFrente.join(' ') }) : io.permitir();
    }

    const projeto = config.carregarProjeto(cwd);
    const s = estado.ler(e.session_id);
    const esc = escopoLib.carregar(cwd, s.frente);
    const arquivoEmVigor = escopoLib.arquivoEmVigor(cwd, s.frente);
    // X2a e X2b sao calculados AQUI, antes de qualquer decisao: nenhuma saida
    // de portao nova e inserida acima do canal de aviso.
    const travas = projetoLib.travasDe(projeto);
    const avisos = projetoLib.avisosDeTipo(projeto);

    // A catraca (passo 7) e o design moram aqui porque tres passos as chamam: o 3 (sem projeto.json, so o design), o
    // 4 (marcha rapida, A2-13) e o 7. Cada uma devolve o motivo da negacao, ou null, e CONTA a negacao no seu balde:
    // chamar uma vez por decisao, e o `||` entre as duas so roda a segunda quando a primeira libera.

    // B7: subir a catraca e decisao humana, nunca efeito colateral de uma correcao. A2-02: o fragmento do Edit nao
    // basta (Edit so do numero nao leva a palavra; Write por cima nao tem fragmento): compara tambem o arquivo
    // inteiro, o antes do disco com o depois calculado (D34). Write de arquivo novo nao tem catraca anterior.
    function motivoDaCatraca() {
      let frouxo = (typeof entrada.old_string === 'string' && typeof entrada.new_string === 'string')
        ? catraca.afrouxou(entrada.old_string, entrada.new_string) : [];
      if (!frouxo.length) {
        // fail-open: o arquivo que nao existe ou nao se le nao se compara inteiro (so o trecho do Edit, acima)
        const atual = lerMedido(path.join(cwd, alvo), BYTES_COMPARADOS);
        if (atual === GRANDE) {
          // fail-closed: acima da medida o arquivo inteiro nao se compara, e o trecho sozinho nao basta (A2-02)
          incrementar(e.session_id, 'catraca_afrouxada');
          return motivoGrande(alvo, BYTES_COMPARADOS);
        }
        if (atual !== null && typeof entrada.new_source === 'string') {
          frouxo = catraca.afrouxou(antesDaCelula(atual, entrada), entrada.new_source);
        } else if (atual !== null) {
          const depoisTexto = escopoLib.conteudoDepois(atual, entrada);
          if (depoisTexto !== null) frouxo = catraca.afrouxou(atual, depoisTexto);
        }
      }
      if (!frouxo.length) return null;
      incrementar(e.session_id, 'catraca_afrouxada');
      return catraca.motivo(alvo, frouxo);
    }

    // Modulo opcional: sem .claude/sworn/design.json, nada dispara. R-T20-07: o design.json vale sem o projeto.json.
    function motivoDoDesign() {
      if (!design.ehArquivoDeEstilo(alvo, projeto)) return null;
      const sistema = config.carregarDesign(cwd);
      // L2-s103-05: o NotebookEdit traz o texto novo em `new_source`
      const conteudo = typeof entrada.content === 'string' ? entrada.content
        : typeof entrada.new_string === 'string' ? entrada.new_string
          : typeof entrada.new_source === 'string' ? entrada.new_source : null;
      if (!sistema || conteudo === null) return null;
      // L2-s103-04: o "antes" e o que a edicao substitui - o old_string no Edit; no Write por cima, o arquivo do
      // disco; no NotebookEdit, a celula. O valor que ja estava ali nao e do pedido (A2-03). Sem ler (ou acima da
      // medida), nada desconta: o lado estrito.
      let antes;
      if (typeof entrada.content === 'string' || typeof entrada.new_source === 'string') {
        const atual = lerMedido(path.join(cwd, alvo), BYTES_COMPARADOS);
        if (typeof atual === 'string') antes = typeof entrada.new_source === 'string' ? antesDaCelula(atual, entrada) : atual;
      } else if (typeof entrada.old_string === 'string') {
        antes = entrada.old_string;
      }
      // E2: o caminho leva os desvios declarados para esta tela.
      const r = design.conferir(conteudo, sistema, antes, alvo);
      if (r.ok) return null;
      incrementar(e.session_id, 'token_fora_do_sistema');
      return design.motivo(alvo, r.fora, sistema);
    }

    // 1. Intocaveis: nega sempre, e o escopo nao libera.
    if (projeto && glob.casaAlgum(projeto.intocaveis, alvo)) {
      incrementar(e.session_id, 'intocavel');
      return negar(escopoLib.motivoIntocavel(alvo));
    }

    // 1a. A5b (s369): a edicao que apaga (o Delete File do Codex chega como Write vazio com `apagar`) no mesmo turno em
    // que o escopo foi ampliado barra: o escopo que vale para apagar e o da abertura do turno.
    // A5f (leva 16): o arquivo que ja estava no escopo da abertura do turno (a foto da A5e) apaga como sempre.
    // revisao (P1): a foto torta que fizesse lancar cai no false (a A5b barra), nunca no io.blindar (que liberaria)
    let naAbertura = false;
    try {
      const ab = s.aberturaDoTurno;
      const escAb = ab && Array.isArray(ab.dentro) ? { dentro: ab.dentro, fora: Array.isArray(ab.fora) ? ab.fora : [] } : null;
      naAbertura = !!escAb && !!alvo && escopoLib.dentro(alvo, escAb) && !escopoLib.declaradoFora(alvo, escAb);
    } catch (err) { naAbertura = false; } // fail-closed: fora da foto da abertura, a A5b nega
    if (entrada.apagar === true && s.escopoAmpliadoNoTurno === true && !naAbertura) {
      incrementar(e.session_id, 'fora_do_escopo');
      return negar(require('./lib/destrutivo.js').motivo('apagar ' + alvo,
        { motivo: require('./lib/destrutivo.js').MOTIVO_APAGAR_DEPOIS_DE_AMPLIAR }));
    }

    // 1b. D786 passo 5: a ordem do compact (abertura.js) cobrada ate o Read do handoff ou um handoff novo
    // (marcar-trabalho.js). So o agente principal: o subagente nao continua esta conversa. O handoff passa sempre (e ele
    // que cumpre o "grave primeiro"). Teto de NEGACOES_DA_ORDEM, uma contagem so com o portao do shell
    // (reinjecao.cobrarOrdem; o "releia" tambem e cobrado em portao-destrutivo.js); se a contagem nao grava, passa.
    const ordem = s.ordemDoCompact;
    if (!e.agent_id && ordem && typeof ordem === 'object' && !require('./lib/saude.js').ehArquivoDeHandoff(alvo) &&
        (ordem.tipo === 'gravar' ||
          (ordem.tipo === 'reler' && typeof ordem.arquivo === 'string' && fs.existsSync(ordem.arquivo)))) {
      const reinjecao = require('./lib/reinjecao.js');
      if (reinjecao.cobrarOrdem(e.session_id)) {
        incrementar(e.session_id, 'ordem_do_compact');
        return negar(reinjecao.motivoDaOrdem(ordem, cwd));
      }
    }

    // 2. Trava 5b: arquivo que ja estava modificado quando a sessao abriu (D17).
    // D45: a comparacao ignora a caixa. Mesma razao da D38: o sistema de arquivos
    // do Windows nao diferencia, e sem isto "GUIA.md" escapava da 5b por 1
    // caractere - decisivo em caminho de marcha rapida, onde o passo 5 nem chega
    // a ser avaliado. D49: a dobra acontece AQUI, e nao no git.js, porque a foto
    // tem outro consumidor (a varredura do /sworn:init) que mostra o nome do
    // arquivo ao dono - e la o nome tem de ser o que esta no disco.
    // X2b: com a trava desligada a 5b nao dispara, e o fluxo SEGUE para os
    // passos 3-5 - nao vira `permitir`. Trava nenhuma pode virar bypass.
    const alvoBaixo = alvo.toLowerCase();
    const deOutraFrente = travas.outraFrente !== false &&
      Array.isArray(s.gitAbertura) && s.gitAbertura.some(function (p) {
      return String(p).toLowerCase() === alvoBaixo;
    });
    if (deOutraFrente && !escopoLib.dentro(alvo, esc)) {
      incrementar(e.session_id, 'outra_frente');
      return negar(escopoLib.motivoOutraFrente(alvo, arquivoEmVigor));
    }
    // V3 (D846): o arquivo que OUTRA sessao do sworn escreveu depois que esta abriu (lib/toques.js) tambem e de outra
    // frente, enquanto segue sem commit: so com um toque achado o git status roda, e o que ele nao lista (commitado,
    // revertido) passa; o git que nao responde deixa o toque valer.
    if (travas.outraFrente !== false && !deOutraFrente && !escopoLib.dentro(alvo, esc)) {
      let toque = null;
      try {
        toque = require('./lib/toques.js').deOutraSessao(cwd, path.resolve(cwd, alvo), e.session_id, s.inicioMs);
      } catch (err) { toque = null; } // fail-open: o registro que nao se le so tira este aviso; a foto da abertura vale
      if (toque) {
        let sujos = null;
        try { sujos = require('./lib/git.js').modificados(cwd); } catch (err) { sujos = null; } // fail-closed: sem o git status o toque vale
        const segueSujo = !Array.isArray(sujos) || sujos.some(function (p) { return String(p).toLowerCase() === alvoBaixo; });
        if (segueSujo) {
          incrementar(e.session_id, 'outra_frente');
          return negar(escopoLib.motivoOutraSessao(alvo, arquivoEmVigor, Date.now() - toque.em));
        }
      }
    }

    // 3. Sem projeto.json o portao de escopo nao roda. Avisa uma vez por sessao. O design.json que existe vale.
    if (!projeto) {
      const semProjetoDesign = motivoDoDesign();
      if (semProjetoDesign) return negar(semProjetoDesign);
      if (!s.avisouSemConfig) {
        marcar(e.session_id, function (x) { x.avisouSemConfig = true; return x; });
        // D420/PT-04: `carregarProjeto` devolve null para AUSENTE e para PRESENTE-e-ilegivel (JSON quebrado, nao e
        // objeto, pasta, sem permissao); so o arquivo no disco separa os dois. Aqui, com o null ja lido, existir quer
        // dizer existir e nao se ler: um projeto configurado com os portoes de escopo e intocaveis DESLIGADOS. Ausente
        // e o normal antes do /sworn:init. A falha segue aberta de proposito: so a mensagem muda, nunca vira negacao.
        return io.permitir({
          systemMessage: projetoNoDisco(cwd)
            ? AVISO_PROJETO_ILEGIVEL
            : 'sworn: este projeto nao tem .claude/sworn/projeto.json. Rode /sworn:init para ligar o portao de escopo.'
        });
      }
      return io.permitir();
    }

    // 3b. D244/defeito 7: o que o escopo declara FORA e negado em qualquer marcha, e ganha
    // do "Dentro": a declaracao do "nao vou tocar" e a mais especifica das duas.
    const foraDeclarado = escopoLib.declaradoFora(alvo, esc);
    if (foraDeclarado) {
      incrementar(e.session_id, 'fora_declarado');
      return negar(escopoLib.motivoDeclaradoFora(alvo, foraDeclarado, arquivoEmVigor));
    }

    // 4. Marcha rapida nao exige escopo. Sem burocracia onde nao ha risco. A catraca e o design valem nela (A2-13).
    const marcha = marchaLib.resolverMarcha(alvo, projeto);
    if (!marchaLib.exigeEscopo(marcha)) {
      const naRapida = motivoDaCatraca() || motivoDoDesign();
      return naRapida ? negar(naRapida) : permitirComAviso(e, s, avisos);
    }

    // 5. Marcha padrao ou AAA: escopo declarado, e o arquivo dentro dele.
    if (!esc) {
      incrementar(e.session_id, 'sem_escopo');
      return negar(escopoLib.motivoSemEscopo(alvo, marcha, arquivoEmVigor));
    }
    if (!escopoLib.dentro(alvo, esc)) {
      incrementar(e.session_id, 'fora_do_escopo');
      return negar(escopoLib.motivoFora(alvo, marcha, esc, arquivoEmVigor));
    }

    // 5b. Plano 091 (#6, D559): arquivo AAA so com o manual carregado na sessao (marcar-trabalho.js marca pela
    // ferramenta Skill). Depois do escopo: "fora do escopo" e a resposta mais especifica. So `false` desliga.
    if (marcha === 'aaa' && projeto.portaoManual !== false && s.manualCarregado !== true) {
      incrementar(e.session_id, 'sem_manual');
      const ordens = require('./lib/ordens.js');
      // Plano 091 T6: a negacao e a ordem de carregar o manual (dada uma vez por pendencia).
      try { estado.alterar(e.session_id, function (st) { st.ordensPendentes = ordens.marcarDada(st, 'manual'); return st; }); } catch (err) { /* nega igual */ }
      return negar(ordens.motivoSemManual(alvo));
    }

    // 6. C9: arquivo NOVO exige ter procurado antes. Editar o que ja existe nao,
    // porque quem edita ja achou. Vem depois do escopo de proposito: "fora do
    // escopo" e a resposta mais especifica, e tem de ganhar quando as duas valem.
    if (!existe(cwd, alvo) && !s.buscouNesteTurno && !buscaLib.nomeadoNoEscopo(alvo, esc)) {
      // F3c (D828): a trava procura sozinha os arquivos de mesmo nome; sem nenhum, a criacao segue. Achou algum, ou a
      // busca falhou (sem git): nega como antes, com a lista do que achou.
      const achados = buscaLib.parecidos(cwd, alvo);
      if (!achados || achados.length) {
        incrementar(e.session_id, 'criou_sem_buscar');
        return negar(buscaLib.motivo(alvo, achados));
      }
    }

    // 7. A catraca e o design (as duas funcoes la em cima).
    const noFim = motivoDaCatraca() || motivoDoDesign();
    if (noFim) return negar(noFim);
    permitirComAviso(e, s, avisos);
  });
});
