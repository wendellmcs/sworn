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

/** C9: o alvo ja existe? Se nao existe, isto e criacao, e criacao exige busca. */
function existe(cwd, alvo) {
  try { return fs.existsSync(path.join(cwd, alvo)); } catch (err) { return true; }
}

/*
 * D420/PT-03: o contador e SECUNDARIO - a negacao nunca pode depender dele. Com o diretorio
 * de estado nao gravavel o `incrementar` lanca (mkdir ENOTDIR), o `blindar` libera, e o
 * Write em arquivo intocavel passava. Por isso cada `estado.incrementar` que vem antes de um
 * `negarFerramenta` esta num try/catch proprio, com a chamada LITERAL (o auxiliar-baldes.js
 * descobre os baldes por esse texto): falhar em contar so perde o numero.
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
const AVISO_CONTADOR = 'sworn: o contador desta ocorrencia nao foi gravado (estado da sessao nao gravavel); ' +
  'os totais do turno podem sair menores que o real. A decisao do portao nao mudou.';
let contadorFalhou = false;

function contadorNaoGravou() { contadorFalhou = true; }

/** Nega, anexando o rastro do contador quando ele falhou antes. */
function negar(motivo) {
  return io.negarFerramenta(contadorFalhou ? motivo + '\n\n' + AVISO_CONTADOR : motivo);
}

/**
 * D420/PT-04: o projeto.json existe no disco? `config.carregarProjeto` devolve `null` para
 * AUSENTE e para PRESENTE-e-ilegivel (JSON quebrado, nao e objeto, pasta, sem permissao); so o
 * arquivo no disco separa os dois. Ausente e o normal antes do /sworn:init; presente e
 * ilegivel e um projeto configurado com os portoes de escopo e intocaveis DESLIGADOS.
 * (A falha segue aberta de proposito: so a mensagem muda, nunca vira negacao.)
 *
 * O que ela mede: so se o ARQUIVO existe no disco (`existsSync`), nao se esta quebrado. O nome diz
 * "e ilegivel" porque o unico chamador (passo 3 do portao) so a consulta depois que
 * `carregarProjeto` ja devolveu null: ai "existe" ja significa "existe e nao se le". Fora desse
 * contexto ela diria apenas "existe" - nao reuse sem repetir essa pre-condicao.
 */
function projetoPresenteEIlegivel(cwd) {
  try { return fs.existsSync(config.caminhoEmSworn(cwd, 'projeto.json')); } catch (err) { return false; }
}

const AVISO_PROJETO_ILEGIVEL = 'sworn: .claude/sworn/projeto.json existe mas nao se le: ' +
  'os portoes de escopo e de intocaveis estao DESLIGADOS ate corrigir. ' +
  'Corrija o JSON (virgula sobrando, aspas). Rodar /sworn:init de novo so serve se voce aceitar ' +
  'refazer a configuracao: o init preserva o que consegue ler do projeto.json, e um arquivo que nao se le nao tem o que preservar.';

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
      try { estado.incrementar(e.session_id, 'frente_invalida'); } catch (err) { contadorNaoGravou(); }
      return negar(escopoLib.motivoNomeDeFrente(alvo));
    }

    // D35: o passe livre e do ARQUIVO de escopo, nao da pasta. Sem ele nao ha
    // como declarar escopo; com ele largo demais, projeto.json e contadores.json
    // ficariam gravaveis sem portao e sem contagem.
    // D38: comparacao sem diferenciar caixa - o sistema de arquivos nao diferencia,
    // e "Escopo.md" nao pode escapar do passe livre so por causa da letra.
    if (alvo.toLowerCase() === escopoLib.ARQUIVO || frenteAlvo) {
      // D34: conta a ampliacao tambem na CRIACAO, e so quando a lista "Dentro" cresce.
      let atual = '';
      try { atual = fs.readFileSync(path.join(cwd, alvo), 'utf8'); } catch (err) { atual = ''; }
      const depoisTexto = escopoLib.conteudoDepois(atual, entrada);
      const depois = depoisTexto === null ? null : escopoLib.parse(depoisTexto);
      if (escopoLib.ampliou(escopoLib.parse(atual), depois)) {
        try { estado.incrementar(e.session_id, 'escopo_ampliado'); } catch (err) { contadorNaoGravou(); }
      }
      // Ultima frente escrita vence: uma sessao so tem um vinculo por vez.
      // S2/L1-7: a edicao do arquivo da frente segue LIBERADA se o vinculo nao grava (nao fura
      // negacao), mas o silencio fazia a sessao achar que estava vinculada sem estar: avisa.
      const avisosDaFrente = [];
      if (frenteAlvo) {
        try { estado.alterar(e.session_id, function (x) { x.frente = frenteAlvo.nome; return x; }); } catch (err) {
          avisosDaFrente.push('sworn: o vinculo desta sessao a frente "' + frenteAlvo.nome + '" nao foi gravado ' +
            '(estado da sessao nao gravavel): a sessao segue regida pelo escopo.md, nao por esta frente.');
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

    // 1. Intocaveis: nega sempre, e o escopo nao libera.
    if (projeto && glob.casaAlgum(projeto.intocaveis, alvo)) {
      try { estado.incrementar(e.session_id, 'intocavel'); } catch (err) { contadorNaoGravou(); }
      return negar(escopoLib.motivoIntocavel(alvo));
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
      try { estado.incrementar(e.session_id, 'outra_frente'); } catch (err) { contadorNaoGravou(); }
      return negar(escopoLib.motivoOutraFrente(alvo, arquivoEmVigor));
    }

    // 3. Sem projeto.json o portao de escopo nao roda. Avisa uma vez por sessao.
    if (!projeto) {
      if (!s.avisouSemConfig) {
        marcar(e.session_id, function (x) { x.avisouSemConfig = true; return x; });
        // D420/PT-04: ausente e presente-e-ilegivel dizem coisas diferentes.
        return io.permitir({
          systemMessage: projetoPresenteEIlegivel(cwd)
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
      try { estado.incrementar(e.session_id, 'fora_declarado'); } catch (err) { contadorNaoGravou(); }
      return negar(escopoLib.motivoDeclaradoFora(alvo, foraDeclarado, arquivoEmVigor));
    }

    // 4. Marcha rapida nao exige escopo. Sem burocracia onde nao ha risco.
    const marcha = marchaLib.resolverMarcha(alvo, projeto);
    if (!marchaLib.exigeEscopo(marcha)) return permitirComAviso(e, s, avisos);

    // 5. Marcha padrao ou AAA: escopo declarado, e o arquivo dentro dele.
    if (!esc) {
      try { estado.incrementar(e.session_id, 'sem_escopo'); } catch (err) { contadorNaoGravou(); }
      return negar(escopoLib.motivoSemEscopo(alvo, marcha, arquivoEmVigor));
    }
    if (!escopoLib.dentro(alvo, esc)) {
      try { estado.incrementar(e.session_id, 'fora_do_escopo'); } catch (err) { contadorNaoGravou(); }
      return negar(escopoLib.motivoFora(alvo, marcha, esc, arquivoEmVigor));
    }

    // 5b. Plano 091 (#6, D559): arquivo AAA so com o manual carregado na sessao (marcar-trabalho.js marca pela
    // ferramenta Skill). Depois do escopo: "fora do escopo" e a resposta mais especifica. So `false` desliga.
    if (marcha === 'aaa' && projeto.portaoManual !== false && s.manualCarregado !== true) {
      try { estado.incrementar(e.session_id, 'sem_manual'); } catch (err) { contadorNaoGravou(); }
      const ordens = require('./lib/ordens.js');
      // Plano 091 T6: a negacao e a ordem de carregar o manual (dada uma vez por pendencia).
      try { estado.alterar(e.session_id, function (st) { st.ordensPendentes = ordens.marcarDada(st, 'manual'); return st; }); } catch (err) { /* nega igual */ }
      return negar(ordens.motivoSemManual(alvo));
    }

    // 6. C9: arquivo NOVO exige ter procurado antes. Editar o que ja existe nao,
    // porque quem edita ja achou. Vem depois do escopo de proposito: "fora do
    // escopo" e a resposta mais especifica, e tem de ganhar quando as duas valem.
    if (!existe(cwd, alvo) && !s.buscouNesteTurno && !buscaLib.nomeadoNoEscopo(alvo, esc)) {
      try { estado.incrementar(e.session_id, 'criou_sem_buscar'); } catch (err) { contadorNaoGravou(); }
      return negar(buscaLib.motivo(alvo));
    }

    // 7. B7: subir a catraca e decisao humana, nunca efeito colateral de uma
    // correcao. So vale para Edit, que e onde ha um "antes" para comparar - em
    // Write de arquivo novo nao existe catraca anterior para afrouxar.
    // A2-02: o fragmento do Edit nao basta (Edit so do numero nao leva a palavra; Write por cima nao tem fragmento):
    // compara tambem o arquivo inteiro, o antes do disco com o depois calculado (D34).
    let frouxo = (typeof entrada.old_string === 'string' && typeof entrada.new_string === 'string')
      ? catraca.afrouxou(entrada.old_string, entrada.new_string) : [];
    if (!frouxo.length && existe(cwd, alvo)) {
      let atual = null;
      try { atual = fs.readFileSync(path.join(cwd, alvo), 'utf8'); } catch (err) { atual = null; }
      const depoisTexto = atual === null ? null : escopoLib.conteudoDepois(atual, entrada);
      if (depoisTexto !== null) frouxo = catraca.afrouxou(atual, depoisTexto);
    }
    if (frouxo.length) {
      try { estado.incrementar(e.session_id, 'catraca_afrouxada'); } catch (err) { contadorNaoGravou(); }
      return negar(catraca.motivo(alvo, frouxo));
    }
    // Modulo opcional: sem .claude/sworn/design.json, nada dispara.
    if (design.ehArquivoDeEstilo(alvo, projeto)) {
      const sistema = config.carregarDesign(cwd);
      const conteudo = (entrada.content !== undefined) ? entrada.content : entrada.new_string;
      if (sistema && typeof conteudo === 'string') {
        const r = design.conferir(conteudo, sistema, entrada.content !== undefined ? undefined : entrada.old_string);
        if (!r.ok) {
          try { estado.incrementar(e.session_id, 'token_fora_do_sistema'); } catch (err) { contadorNaoGravou(); }
          return negar(design.motivo(alvo, r.fora, sistema));
        }
      }
    }
    permitirComAviso(e, s, avisos);
  });
});
