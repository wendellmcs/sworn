#!/usr/bin/env node
'use strict';
const io = require('./lib/io.js');
const estado = require('./lib/estado.js');
const saude = require('./lib/saude.js');
const correcao = require('./lib/correcao.js');
const radarOferta = require('./lib/radar-oferta.js');
const config = require('./lib/config.js');
const volta = require('./lib/volta.js');

// UserPromptSubmit: zera as marcas do turno anterior (trabalhoReal, bloqueouNesteTurno,
// buscouNesteTurno, gravouHandoff) e preserva todo o resto do estado da sessao (contadores, e as chaves
// que a T18 usa). A busca e marca do TURNO: um turno que so leu nao chega ao fecho que a
// apagaria, e sem ela aqui o turno seguinte criava arquivo sem procurar (ronda 1 do 8b).
io.blindar(function () {
  io.lerEntrada(function (e) {
    // Plano 084 (D549): volta a chat de 200 mil ou mais depois de mais de 1 h parado segura a 1a mensagem da
    // pausa com a conta (volta.js). A marca da pausa fica no estado; a mensagem seguinte passa. Falha de leitura
    // nunca segura: o turno segue como antes.
    // 0.11.0 (D586): antes de parar, grava o resumo do chat (retomar.js), fora da trava do estado; resumo que falha
    // nao impede o aviso, que diz isso.
    let aviso = null;
    try {
      const raiz = config.raizDoProjeto(e.cwd || process.cwd());
      if (volta.ligada(config.carregarProjeto(raiz))) {
        const chamada = saude.ultimaChamadaDoTranscript(e.transcript_path);
        if (chamada) {
          const agora = Date.now();
          let r = null;
          let frente = null;
          estado.alterar(e.session_id, function (s) {
            r = volta.avaliar(chamada, agora, s.avisouVolta);
            if (r) { s.avisouVolta = r.marca; frente = s.frente || null; }
            return s;
          });
          if (r) {
            // try proprio: a marca da pausa ja esta gravada; se o require lancasse no try de fora, a pausa passava
            // calada e o aviso nao voltava (ronda 1 da 0.11.0). Sem resumo, o aviso sai e diz isso. O motivo com o
            // resumo fica no mesmo try: resumo torto que o faca lancar tambem sai sem resumo (0.11.1).
            try {
              const resumo = require('./lib/retomar.js').resumir({ raiz: raiz, sessao: e.session_id,
                transcript: e.transcript_path, frente: frente, agora: agora, volta: r });
              aviso = volta.motivo(r, resumo);
            } catch (err) { aviso = volta.motivo(r, null); }
          }
        }
      }
    } catch (err) { aviso = null; }
    if (aviso) return io.segurarMensagem(aviso);
    // A1 (D426): a chave sugerirAprender (padrao ligado) vem do projeto.json; ilegivel ou ausente = ligado.
    // O projeto.json e lido aqui so quando algum detector bateu; a lista dos pedidos (abaixo) o le nos outros.
    const candidataCorrecao = correcao.pareceCorrecao(e.prompt);
    const candidataOferta = radarOferta.parecePedidoDeMelhoria(e.prompt);
    const projetoDoTurno = candidataCorrecao || candidataOferta
      ? config.carregarProjeto(config.raizDoProjeto(e.cwd || process.cwd())) : null;
    const parece = candidataCorrecao && correcao.ligada(projetoDoTurno);
    // T3b (D611): pedido de melhoria/funcao nova oferece o radar do usuario, 1 vez por sessao. Nunca no repositorio
    // do proprio plugin (la o radar e do mantenedor). Qualquer falha ao decidir = sem oferta.
    let ofertar = false;
    try {
      ofertar = candidataOferta && radarOferta.ligada(projetoDoTurno) &&
        !require('./lib/vigia-local.js').ehRepoDoPlugin(e.cwd || process.cwd());
    } catch (err) { ofertar = false; }
    let oferecer = false;
    let sugerir = false;
    let frenteDoTurno = null;
    // A5-05: o estado que nao grava nao cala a resposta a pergunta sobre o contexto; sem a espera gravada, nada de
    // sugestao (sairia a cada prompt).
    try {
      estado.alterar(e.session_id, function (s) {
        frenteDoTurno = s.frente || null;
        delete s.trabalhoReal;
        delete s.bloqueouNesteTurno;
        delete s.buscouNesteTurno;
        // D412 (o prompt do handoff vai ao chat): o marcar-trabalho.js liga gravouHandoff quando o turno
        // grava um arquivo de handoff, e o portao-fecho.js cobra o bloco na resposta final. O turno
        // interrompido antes do Stop nao deixa a marca para o seguinte.
        delete s.gravouHandoff;
        // A1: no maximo 1 sugestao a cada 5 turnos. Todo prompt gasta 1 da espera; ao sugerir, ela volta a 4.
        // Campo da SESSAO (estado.CAMPOS_DA_SESSAO): o fecho o carrega, senao a janela morria a cada turno.
        // PA1-5: ausente = 0 (primeira vez, libera). Valor que nao e numero finito (texto, null, objeto, lista)
        // e estado corrompido: vale a espera cheia, nunca 0 - senao a sugestao sairia a cada prompt. Numero fica
        // entre 0 e a espera cheia (negativo = 0; gigante nao prende a sessao para sempre).
        const bruto = s.esperaAprender;
        const espera = bruto === undefined ? 0
          : (typeof bruto === 'number' && isFinite(bruto) ? Math.min(Math.max(bruto, 0), correcao.ESPERA_ENTRE_SUGESTOES)
            : correcao.ESPERA_ENTRE_SUGESTOES);
        // T3b: campo da SESSAO (estado.CAMPOS_DA_SESSAO). Ofereceu uma vez, nao oferece mais nesta sessao.
        if (ofertar && s.ofereceuRadar !== true) {
          oferecer = true;
          s.ofereceuRadar = true;
        }
        if (parece && espera === 0) {
          sugerir = true;
          s.esperaAprender = correcao.ESPERA_ENTRE_SUGESTOES;
          // Plano 091 T6: a ordem de rodar o /sworn:learn foi dada (lib/ordens.js).
          s.ordensPendentes = require('./lib/ordens.js').marcarDada(s, 'aprender');
        } else if (espera > 0) {
          s.esperaAprender = espera - 1;
        }
        return s;
      });
    } catch (err) { sugerir = false; oferecer = false; }
    // Item 10 (D674): o pedido que passou entra na lista numerada da frente (pedidos.js); o segurado pela volta, nao (ele
    // volta a ser mandado). Le o projeto.json a cada prompt, por causa da chave. Falha de disco cala: o turno segue.
    try {
      const pedidos = require('./lib/pedidos.js');
      const raizDoTurno = config.raizDoProjeto(e.cwd || process.cwd());
      if (pedidos.ligada(projetoDoTurno || config.carregarProjeto(raizDoTurno))) {
        pedidos.registrar(raizDoTurno, frenteDoTurno, e.prompt, Date.now());
      }
    } catch (err) { /* sem a linha da lista; o turno segue */ }
    // Item 14 (D674): com plano na sessao (o da frente vinculada ou o do escopo.md; o de outra frente, nao), 5 turnos com
    // trabalho sem o plano mudar pedem a nota viva (plano.notaViva). Falha cala: sem o aviso.
    let notaAviso = null;
    try {
      const planoLib = require('./lib/plano.js');
      const raizDoTurno = config.raizDoProjeto(e.cwd || process.cwd());
      const achado = planoLib.acharPlanoDaFrente(raizDoTurno, frenteDoTurno);
      if (achado && achado.arquivo && !achado.semVinculo) {
        const mtime = require('node:fs').statSync(planoLib.caminhoDoPlano(raizDoTurno, achado.arquivo)).mtimeMs;
        let r = null;
        let semNota = 0;
        estado.alterar(e.session_id, function (s) {
          const antes = s.notaViva;
          r = planoLib.notaViva(antes, mtime, s.turnosComTrabalho);
          if (r.avisar) semNota = r.marca.turnos - antes.turnos;
          s.notaViva = r.marca;
          return s;
        });
        if (r && r.avisar) notaAviso = planoLib.motivoNotaViva(achado.arquivo, semNota);
      }
    } catch (err) { notaAviso = null; }
    // T10-4 (D357): quem pergunta se o contexto/memoria esta bom ja tem a resposta - dispara toda
    // vez que a pergunta vier (nao e "uma vez por sessao"). Sem projeto.json tambem.
    // A1: as duas podem valer no mesmo prompt ("o contexto esta bom? eu ja te disse isso"): um so
    // additionalContext, com a saude primeiro (e a que manda agir ja).
    const avisos = [];
    // D704: com agente de fundo rodando na sessao, a resposta manda esperar antes do handoff.
    if (saude.perguntaSobreSaude(e.prompt)) avisos.push(saude.instrucaoDaPergunta(saude.agentesRodando(e.transcript_path, Date.now())));
    if (sugerir) avisos.push(correcao.INSTRUCAO_DA_CORRECAO);
    if (oferecer) avisos.push(radarOferta.INSTRUCAO_DA_OFERTA);
    if (notaAviso) avisos.push(notaAviso);
    if (avisos.length) {
      return io.permitir({ hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit', additionalContext: avisos.join('\n\n') } });
    }
    io.permitir();
  });
});
