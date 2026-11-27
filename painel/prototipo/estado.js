// Painel de sessoes, prototipo da fase 2: a logica sem tela. Guarda as maquinas, os projetos e as sessoes, aplica os
// eventos que chegam pelo SSE, monta a fila do que espera pelo dono e formata tempo e custo. Roda no navegador (vira
// window.PainelEstado) e no Node, onde test/painel.test.js a confere sem navegador.
(function (raiz) {
  'use strict';

  const ESTADOS = ['precisa', 'trabalhando', 'parada', 'concluida'];
  const CONEXOES = ['online', 'offline'];
  const QUEM_FALA = ['dono', 'agente'];
  // A fila vai da urgencia mais alta para a mais baixa; urgencia que nao esta aqui conta como media.
  const PESO_DA_URGENCIA = { alta: 0, media: 1, baixa: 2 };
  // A mesa mostra so a ultima fala; guardar todas faria a conversa crescer sem fim numa aba aberta o dia inteiro.
  const LIMITE_DA_CONVERSA = 200;
  // A resposta escrita pelo painel lateral: o teto da caixa de texto e o que responder aceita.
  const LIMITE_DA_RESPOSTA = 4000;
  // O diff de cada arquivo no painel lateral; o que passa disso vira "mais N linhas" e fica para o terminal.
  const LIMITE_DO_TRECHO = 80;
  const MINUTO = 60000;
  const CUSTO = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' });

  function copiar(valor) { return JSON.parse(JSON.stringify(valor)); }
  function ehNumero(n) { return typeof n === 'number' && Number.isFinite(n); }
  function ehContagem(n) { return Number.isInteger(n) && n >= 0; }
  function ehObjeto(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  function ehTexto(x) { return typeof x === 'string' && x.trim() !== ''; }
  // So os itens que sao objeto: um `null` ou um texto solto na lista quebraria a tela inteira.
  function lista(x) { return Array.isArray(x) ? x.filter(ehObjeto) : []; }
  // Relogio que nao e numero vira o de agora, para o tempo no estado nunca sair NaN.
  function relogio(agora) { return ehNumero(agora) ? agora : Date.now(); }
  function plural(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }

  function comNome(x, reserva) {
    if (!ehTexto(x.nome)) x.nome = ehTexto(x.id) ? x.id : reserva;
    return x;
  }

  function falaValida(f) { return QUEM_FALA.includes(f.quem) && typeof f.texto === 'string'; }

  function falar(s, quem, texto) {
    s.conversa.push({ quem, texto });
    if (s.conversa.length > LIMITE_DA_CONVERSA) s.conversa.splice(0, s.conversa.length - LIMITE_DA_CONVERSA);
  }

  // `agora` em milissegundos: o tempo no estado vira o instante em que o estado comecou, para a tela contar sozinha.
  function criar(dados, agora) {
    const d = ehObjeto(dados) ? copiar(dados) : {};
    const t = relogio(agora);
    return {
      maquinas: lista(d.maquinas).map(function (m) { return comNome(m, 'Máquina sem nome'); }),
      projetos: lista(d.projetos).map(function (p) { return comNome(p, 'Projeto sem nome'); }),
      sessoes: lista(d.sessoes).map(function (s) {
        const min = ehNumero(s.minutosNoEstado) ? Math.max(0, s.minutosNoEstado) : 0;
        delete s.minutosNoEstado;
        s.desde = t - min * MINUTO;
        // O ultimo evento que se sabe da sessao; nos dados de entrada, o inicio do estado.
        s.atividade = s.desde;
        s.arquivos = lista(s.arquivos);
        s.conversa = lista(s.conversa).filter(falaValida).slice(-LIMITE_DA_CONVERSA);
        if (!ehObjeto(s.pedido)) delete s.pedido;
        // Sem projeto vira '' e nao undefined: contar(st, undefined) e a conta de todas as sessoes. A maquina, igual,
        // para a visao de equipe juntar as sessoes sem maquina numa linha so.
        if (typeof s.projeto !== 'string') s.projeto = '';
        if (typeof s.maquina !== 'string') s.maquina = '';
        // Sem origem valida, do terminal, como a mesa nova do painel ao vivo: so o painel abre sessao com resposta.
        if (s.origem !== 'painel') s.origem = 'terminal';
        return comNome(s, 'Sessão sem nome');
      }),
    };
  }

  function sessao(st, id) { return st.sessoes.find(function (s) { return s.id === id; }); }
  function maquina(st, id) { return st.maquinas.find(function (m) { return m.id === id; }); }
  function projeto(st, id) { return st.projetos.find(function (p) { return p.id === id; }); }

  // A maquina que o painel nao conhece conta como sem sinal: nada dela chega, entao o estado mostrado pode estar velho.
  function semSinal(st, s) {
    const m = maquina(st, s.maquina);
    return !m || m.conexao === 'offline';
  }

  function minutos(s, agora) { return Math.max(0, Math.floor((relogio(agora) - s.desde) / MINUTO)); }

  function urgencia(pedido) {
    const u = pedido && pedido.urgencia;
    return Object.hasOwn(PESO_DA_URGENCIA, u) ? u : 'media';
  }

  // O que espera pelo dono, de todas as sessoes: a urgencia mais alta primeiro; empatada, quem espera ha mais tempo.
  function fila(st) {
    return st.sessoes.filter(function (s) { return s.estado === 'precisa'; }).sort(function (a, b) {
      return PESO_DA_URGENCIA[urgencia(a.pedido)] - PESO_DA_URGENCIA[urgencia(b.pedido)] || a.desde - b.desde;
    });
  }

  // A sessao do terminal sem custo: o gancho nao traz custo, e a tela diz isso em vez de inventar US$ 0,00.
  function semCusto(s) { return !podeResponder(s) && !ehNumero(s.custoUsd); }

  // Os numeros de um grupo de sessoes: quantas, quantas em cada estado, o custo em dolares (arredondado ao centavo),
  // quantas estao sem custo (semCusto), os arquivos mudados e o ultimo evento (null no grupo vazio).
  function somar(sessoes) {
    const estados = Object.fromEntries(ESTADOS.map(function (e) { return [e, 0]; }));
    let custo = 0;
    let semCustoNoGrupo = 0;
    let arquivos = 0;
    let atividade = null;
    for (const s of sessoes) {
      if (Object.hasOwn(estados, s.estado)) estados[s.estado] += 1;
      if (ehNumero(s.custoUsd)) custo += s.custoUsd;
      if (semCusto(s)) semCustoNoGrupo += 1;
      arquivos += s.arquivos.length;
      if (atividade === null || s.atividade > atividade) atividade = s.atividade;
    }
    return { sessoes: sessoes.length, estados, custoUsd: Math.round(custo * 100) / 100, semCusto: semCustoNoGrupo,
      arquivos, atividade };
  }

  function sessoesCom(st, campo, id) { return st.sessoes.filter(function (s) { return s[campo] === id; }); }
  function doProjeto(st, idDoProjeto) { return idDoProjeto === undefined ? st.sessoes : sessoesCom(st, 'projeto', idDoProjeto); }

  function resumo(st, idDoProjeto) { return somar(doProjeto(st, idDoProjeto)); }
  function contar(st, idDoProjeto) { return resumo(st, idDoProjeto).estados; }
  function custoTotal(st, idDoProjeto) { return resumo(st, idDoProjeto).custoUsd; }

  // Os itens da lista (projetos ou maquinas) e, depois deles, os que so aparecem no `campo` de uma sessao, montados
  // por `novo`.
  function comOsDasSessoes(st, itens, campo, novo) {
    const todos = itens.slice();
    for (const s of st.sessoes) {
      if (!todos.some(function (x) { return x.id === s[campo]; })) todos.push(novo(s));
    }
    return todos;
  }

  // Todos os projetos: os da lista e os que so aparecem numa sessao, com o id como nome ('Sem projeto' sem id).
  function todosOsProjetos(st) {
    return comOsDasSessoes(st, st.projetos, 'projeto', function (s) { return { id: s.projeto, nome: rotuloDoProjeto(st, s) }; });
  }

  // A visao de equipe: os numeros de cada projeto, de cada maquina e de todas as sessoes. Maquina que so aparece numa
  // sessao entra com o id como nome e sem sinal, como o semSinal a conta.
  function equipe(st) {
    const maquinas = comOsDasSessoes(st, st.maquinas, 'maquina', function (s) {
      return { id: s.maquina, nome: s.maquina || 'Sem máquina', conexao: 'offline' };
    });
    return {
      projetos: todosOsProjetos(st).map(function (p) {
        return Object.assign({ id: p.id, nome: p.nome, cor: p.cor }, somar(sessoesCom(st, 'projeto', p.id)));
      }),
      maquinas: maquinas.map(function (m) {
        return Object.assign({ id: m.id, nome: m.nome, conexao: m.conexao }, somar(sessoesCom(st, 'maquina', m.id)));
      }),
      total: somar(st.sessoes),
    };
  }

  // A resposta de todo evento recusado: congelada, porque e a mesma para todos.
  const NADA = Object.freeze({ mudou: Object.freeze([]) });

  // Todo evento aceito da sessao conta como atividade dela: o instante vai para s.atividade, que a visao de equipe soma.
  // `extra` leva o aviso e o chamado, quando ha.
  function aceito(s, t, extra) {
    s.atividade = t;
    return Object.assign({ mudou: [s.id] }, extra);
  }

  // A mesa de uma sessao que o painel ao vivo viu pela 1a vez, sem arquivos nem conversa. Sem estado ou origem
  // validos, nasce parada e do terminal; "precisa" so chega com o pedido (evento `estado`), entao sem ele nasce parada.
  // O projeto entra na lista com o nome que veio, e a maquina desconhecida entra com sinal: o evento acabou de chegar
  // dela. A mesa que ja existe so troca o nome, o modelo e a tarefa. `nova` diz a tela que ha mesa para montar.
  function aplicarSessao(st, ev, t) {
    if (!ehTexto(ev.sessao)) return NADA;
    const s = sessao(st, ev.sessao);
    if (s) {
      let mudou = false;
      for (const campo of ['nome', 'modelo', 'tarefa']) {
        if (ehTexto(ev[campo]) && ev[campo] !== s[campo]) { s[campo] = ev[campo]; mudou = true; }
      }
      return mudou ? aceito(s, t) : NADA;
    }
    const nova = comNome({
      id: ev.sessao,
      nome: ev.nome,
      projeto: ehTexto(ev.projeto) ? ev.projeto : '',
      maquina: ehTexto(ev.maquina) ? ev.maquina : '',
      origem: ev.origem === 'painel' ? 'painel' : 'terminal',
      estado: ESTADOS.includes(ev.estado) && ev.estado !== 'precisa' ? ev.estado : 'parada',
      desde: t,
      atividade: t,
      arquivos: [],
      conversa: [],
    }, 'Sessão sem nome');
    if (ehTexto(ev.modelo)) nova.modelo = ev.modelo;
    if (ehTexto(ev.tarefa)) nova.tarefa = ev.tarefa;
    st.sessoes.push(nova);
    if (nova.projeto && !projeto(st, nova.projeto)) {
      st.projetos.push(comNome({ id: nova.projeto, nome: ev.projetoNome }, 'Projeto sem nome'));
    }
    if (nova.maquina && !maquina(st, nova.maquina)) {
      st.maquinas.push(comNome({ id: nova.maquina, conexao: 'online' }, 'Máquina sem nome'));
    }
    return aceito(nova, t, { nova: true });
  }

  // Aplica um evento do SSE. Devolve as sessoes que mudaram (`mudou`), o `aviso` que a tela anuncia quando o dono
  // precisa saber e, no pedido novo, o `chamado` (o id da sessao) para a notificacao do navegador. Evento que nao se
  // entende (tipo, sessao, estado ou valor desconhecido ou fora da faixa) nao muda nada.
  function aplicar(st, ev, agora) {
    if (!ehObjeto(ev)) return NADA;
    const t = relogio(agora);
    if (ev.tipo === 'sessao') return aplicarSessao(st, ev, t);
    if (ev.tipo === 'maquina') {
      const m = maquina(st, ev.maquina);
      if (!m || !CONEXOES.includes(ev.conexao) || m.conexao === ev.conexao) return NADA;
      m.conexao = ev.conexao;
      m.desde = t;
      const afetadas = st.sessoes.filter(function (s) { return s.maquina === m.id; }).map(function (s) { return s.id; });
      const quantas = plural(afetadas.length, 'sessão', 'sessões');
      return {
        mudou: afetadas,
        aviso: ev.conexao === 'offline'
          ? m.nome + ' perdeu a conexão: ' + quantas + ' sem sinal, mostrando o último estado que chegou.'
            + ' Aprovar, negar e responder esperam a conexão voltar.'
          : m.nome + ' voltou: ' + quantas + ' com sinal de novo.',
      };
    }
    const s = sessao(st, ev.sessao);
    if (!s) return NADA;
    if (ev.tipo === 'mensagem') {
      if (!falaValida(ev)) return NADA;
      falar(s, ev.quem, ev.texto);
      return aceito(s, t);
    }
    if (ev.tipo === 'custo') {
      if (!ehNumero(ev.custoUsd) || ev.custoUsd < 0) return NADA;
      s.custoUsd = ev.custoUsd;
      return aceito(s, t);
    }
    if (ev.tipo === 'arquivo') {
      if (!ehTexto(ev.caminho) || !ehContagem(ev.mais) || !ehContagem(ev.menos)) return NADA;
      if (ev.trecho != null && !Array.isArray(ev.trecho)) return NADA;
      let a = s.arquivos.find(function (x) { return x.caminho === ev.caminho; });
      if (!a) { a = { caminho: ev.caminho }; s.arquivos.push(a); }
      a.mais = ev.mais;
      a.menos = ev.menos;
      // O trecho velho ja nao bate com as contagens novas: o evento sem trecho tira o que havia. Guarda so as linhas que
      // a tela mostra, e quantas passaram do teto, para a aba aberta o dia inteiro nao crescer sem fim.
      delete a.trecho;
      delete a.cortadas;
      if (Array.isArray(ev.trecho)) {
        const textos = ev.trecho.filter(function (x) { return typeof x === 'string'; });
        a.trecho = textos.slice(0, LIMITE_DO_TRECHO);
        if (textos.length > LIMITE_DO_TRECHO) a.cortadas = textos.length - LIMITE_DO_TRECHO;
      }
      return aceito(s, t);
    }
    if (ev.tipo === 'estado') {
      if (!ESTADOS.includes(ev.estado) || (ev.pedido != null && !ehObjeto(ev.pedido))) return NADA;
      // Pedido novo conta como espera nova, mesmo numa sessao que ja precisava; o mesmo estado repetido sem pedido
      // nao zera o tempo.
      const pedidoNovo = ev.estado === 'precisa' && (s.estado !== 'precisa' || Boolean(ev.pedido));
      if (s.estado !== ev.estado || pedidoNovo) s.desde = t;
      s.estado = ev.estado;
      if (ev.estado === 'precisa') { if (ev.pedido) s.pedido = copiar(ev.pedido); } else delete s.pedido;
      if (!pedidoNovo) return aceito(s, t);
      return aceito(s, t, {
        aviso: nomeComProjeto(st, s) + ' precisa de você: ' + resumoDoPedido(s.pedido),
        chamado: s.id,
      });
    }
    // O pedido que o painel nao segurou mais (sem aba aberta, prazo vencido ou o gancho caiu) voltou para o terminal:
    // a mesa segue mostrando, mas a decisao dali nao chegaria a ninguem.
    if (ev.tipo === 'voltou') {
      const p = s.pedido;
      if (s.estado !== 'precisa' || !ehObjeto(p) || p.voltou || !ehTexto(ev.pedido) || p.id !== ev.pedido) return NADA;
      p.voltou = true;
      return aceito(s, t);
    }
    // A decisao que o servidor ao vivo ja aceitou, para cada aba aplicar igual: so vale para o pedido que a sessao tem.
    // Quem decidiu foi o servidor, entao vale mesmo com a maquina sem sinal nesta aba (o clique daqui segue recusado).
    if (ev.tipo === 'decisao') {
      const p = s.pedido;
      if (!ehObjeto(p) || !ehTexto(ev.pedido) || p.id !== ev.pedido) return NADA;
      return aplicarDecisao(st, s, ev.escolha, t);
    }
    return NADA;
  }

  // A fala da decisao: o indice da opcao numa pergunta; 'aprovar' ou 'negar' no resto. null no que nao cabe no pedido.
  function falaDaDecisao(pedido, escolha) {
    if (pedido.tipo === 'pergunta') {
      const opcoes = Array.isArray(pedido.opcoes) ? pedido.opcoes : [];
      if (!Number.isInteger(escolha) || escolha < 0 || escolha >= opcoes.length) return null;
      return 'Escolhido: ' + rotuloDaOpcao(opcoes[escolha]);
    }
    if (escolha !== 'aprovar' && escolha !== 'negar') return null;
    const verbo = escolha === 'aprovar' ? 'Aprovado' : 'Negado';
    const alvo = alvoDoPedido(pedido);
    return alvo ? verbo + ': ' + alvo.valor : verbo + '.';
  }

  // A decisao do dono no pedido da sessao, pelo painel lateral. Vale nas duas origens: a sessao do terminal so nao
  // recebe resposta escrita (decisao do dono). Sessao sem sinal, ou pedido que ja voltou para o terminal, recusa: a
  // decisao nao chegaria. Aceita, a decisao entra na conversa, o pedido sai da fila e a sessao volta a trabalhar.
  function decidir(st, id, escolha, agora) {
    const s = sessao(st, id);
    if (!s || !ehObjeto(s.pedido) || s.pedido.voltou || semSinal(st, s)) return NADA;
    return aplicarDecisao(st, s, escolha, relogio(agora));
  }

  // A decisao posta na sessao, sem conferir o sinal: o clique passa por `decidir`, o evento do servidor vem direto.
  function aplicarDecisao(st, s, escolha, t) {
    if (s.estado !== 'precisa' || !ehObjeto(s.pedido)) return NADA;
    const fala = falaDaDecisao(s.pedido, escolha);
    if (fala === null) return NADA;
    falar(s, 'dono', fala);
    delete s.pedido;
    s.estado = 'trabalhando';
    s.desde = t;
    return aceito(s, t, { aviso: nomeComProjeto(st, s) + ' voltou a trabalhar. ' + fala });
  }

  // A resposta escrita do dono, so na sessao aberta pelo painel e com sinal. Ela responde o pedido que houver e poe a
  // sessao para trabalhar; a que ja trabalha segue com o mesmo tempo no estado. O pedido que ja voltou para o terminal
  // recusa: a resposta nao chegaria a ninguem.
  // A resposta recusada diz o porque em `recusa`, para a tela dar ao dono a causa certa.
  function recusada(motivo) { return { mudou: [], recusa: motivo }; }

  function responder(st, id, texto, agora) {
    const s = sessao(st, id);
    if (!s) return recusada('sem-sessao');
    if (!podeResponder(s)) return recusada('terminal');
    if (semSinal(st, s)) return recusada('sem-sinal');
    if (ehObjeto(s.pedido) && s.pedido.voltou) return recusada('voltou');
    if (!ehTexto(texto)) return recusada('vazia');
    const limpo = texto.trim();
    if (limpo.length > LIMITE_DA_RESPOSTA) return recusada('longa');
    const t = relogio(agora);
    const naFila = s.estado === 'precisa';
    falar(s, 'dono', limpo);
    delete s.pedido;
    if (s.estado !== 'trabalhando') { s.estado = 'trabalhando'; s.desde = t; }
    return aceito(s, t, { aviso: nomeComProjeto(st, s) + (naFila ? ' recebeu a resposta e saiu da fila.' : ' recebeu a resposta.') });
  }

  // O trecho do diff de um arquivo, como o `git diff` escreve a partir do primeiro '@@' (sem o cabecalho '---'/'+++',
  // que o caminho ja diz): '@@' marca o lugar, '+' e '-' a linha que entra e a que sai, o resto e contexto. So os itens
  // de texto; passado o teto, o que sobra vira `cortadas`, somado ao que o evento ja cortou ao guardar.
  const TIPO_DA_LINHA = { '+': 'mais', '-': 'menos', ' ': 'igual' };
  function linhasDoTrecho(arquivo) {
    const itens = ehObjeto(arquivo) && Array.isArray(arquivo.trecho)
      ? arquivo.trecho.filter(function (x) { return typeof x === 'string'; })
      : [];
    const linhas = itens.slice(0, LIMITE_DO_TRECHO).map(function (l) {
      if (l.startsWith('@@')) return { tipo: 'lugar', texto: l };
      const tipo = TIPO_DA_LINHA[l.charAt(0)];
      return tipo ? { tipo, texto: l.slice(1) } : { tipo: 'igual', texto: l };
    });
    const jaCortadas = ehObjeto(arquivo) && ehContagem(arquivo.cortadas) ? arquivo.cortadas : 0;
    return { linhas, cortadas: itens.length - linhas.length + jaCortadas };
  }

  // O nome do projeto da sessao; projeto que nao esta na lista mostra o id que a sessao traz.
  function rotuloDoProjeto(st, s) {
    const id = s && s.projeto;
    const p = projeto(st, id);
    if (p) return p.nome;
    return ehTexto(id) ? id : 'Sem projeto';
  }

  // A sessao como o aviso a nomeia: 'Nome (Projeto)'.
  function nomeComProjeto(st, s) { return s.nome + ' (' + rotuloDoProjeto(st, s) + ')'; }

  function resumoDoPedido(pedido) {
    if (!pedido || !ehTexto(pedido.texto)) return 'abra a mesa para ver o que ela pede.';
    const texto = pedido.texto.trim();
    return /[.?!…]$/.test(texto) ? texto : texto + '.';
  }

  // O que a permissao vai tocar. Os dados trazem um ou o outro (test/painel.test.js confere no simulado); com os dois,
  // vale o comando, o que roda.
  const ROTULO_DO_ALVO = { comando: 'Comando: ', arquivo: 'Arquivo: ' };
  function campoDoAlvo(pedido) {
    if (!ehObjeto(pedido)) return null;
    for (const campo of ['comando', 'arquivo']) if (ehTexto(pedido[campo])) return campo;
    return null;
  }
  function alvoDoPedido(pedido) {
    const campo = campoDoAlvo(pedido);
    return campo ? { rotulo: ROTULO_DO_ALVO[campo], valor: pedido[campo] } : null;
  }

  // O titulo curto de cada tipo de pedido, na fila e na mesa.
  function tipoDoPedido(pedido) {
    if (!ehObjeto(pedido)) return 'Pede atenção';
    if (pedido.tipo === 'pergunta') return 'Pergunta';
    if (pedido.tipo === 'permissao') return campoDoAlvo(pedido) === 'arquivo' ? 'Permissão para editar' : 'Permissão para rodar';
    return 'Pedido';
  }

  function rotuloDaOpcao(o) {
    if (ehTexto(o)) return o;
    if (ehObjeto(o) && ehTexto(o.rotulo)) return o.rotulo;
    return 'Opção sem rótulo';
  }

  function resumoDasOpcoes(opcoes) { return plural(Array.isArray(opcoes) ? opcoes.length : 0, 'opção', 'opções'); }

  // Sessao aberta pelo painel (pelo SDK) recebe resposta escrita; a do terminal, so aprovar ou negar (decisao do dono).
  function podeResponder(s) { return s.origem === 'painel'; }

  function limiteDaMesa(s) {
    return podeResponder(s)
      ? 'Aberta pelo painel: dá para ver, aprovar e responder daqui.'
      : 'Aberta no terminal: daqui só dá para ver e aprovar ou negar; para responder, use o terminal.';
  }

  const ROTULO_DO_ESTADO = { precisa: 'Precisa de você', trabalhando: 'Trabalhando', parada: 'Parada', concluida: 'Concluída' };
  function rotuloDoEstado(estado) {
    return Object.hasOwn(ROTULO_DO_ESTADO, estado) ? ROTULO_DO_ESTADO[estado] : 'Estado desconhecido';
  }

  const ROTULO_DA_URGENCIA = { alta: 'Urgência alta', media: 'Urgência média', baixa: 'Urgência baixa' };
  function rotuloDaUrgencia(pedido) { return ROTULO_DA_URGENCIA[urgencia(pedido)]; }

  // O resumo de uma sala: so os estados que tem sessao, no singular ou no plural.
  const CONTAGEM = {
    precisa: ['precisa de você', 'precisam de você'],
    trabalhando: ['trabalhando', 'trabalhando'],
    parada: ['parada', 'paradas'],
    concluida: ['concluída', 'concluídas'],
  };
  function resumoDaContagem(conta) {
    const partes = [];
    for (const estado of ESTADOS) {
      const n = conta && ehNumero(conta[estado]) ? conta[estado] : 0;
      if (n > 0) partes.push(plural(n, CONTAGEM[estado][0], CONTAGEM[estado][1]));
    }
    return partes.length ? partes.join(', ') : 'Nenhuma sessão';
  }

  // 'claude-opus-5-5' vira 'Opus 5.5'; nome de outro formato fica como veio.
  function nomeDoModelo(id) {
    if (typeof id !== 'string' || !id) return 'Modelo não informado';
    const m = /^claude-([a-z]+)-(\d+(?:-\d+)*)$/.exec(id);
    if (!m) return id;
    return m[1].charAt(0).toUpperCase() + m[1].slice(1) + ' ' + m[2].split('-').join('.');
  }

  // Exportada e chamada com o que vier: a lista que nao e lista conta como vazia.
  function resumoDosArquivos(arquivos) {
    const itens = lista(arquivos);
    if (!itens.length) return 'Nenhum arquivo mudado';
    let mais = 0;
    let menos = 0;
    for (const a of itens) {
      if (ehContagem(a.mais)) mais += a.mais;
      if (ehContagem(a.menos)) menos += a.menos;
    }
    return plural(itens.length, 'arquivo', 'arquivos') + ', +' + mais + ' −' + menos;
  }

  function formatarTempo(min) {
    if (!ehNumero(min) || min < 1) return 'agora';
    const m = Math.floor(min);
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60);
    const resto = m % 60;
    return resto ? h + ' h ' + resto + ' min' : h + ' h';
  }

  function formatarCusto(usd) { return CUSTO.format(ehNumero(usd) ? usd : 0); }

  // "sem custo" leria como "de graca": o texto diz que o custo nao veio.
  const SEM_CUSTO = 'custo não informado pelo terminal';
  function custoDaSessao(s) { return semCusto(s) ? SEM_CUSTO : formatarCusto(s.custoUsd); }

  // O custo de um grupo (o resumo de somar): todo sem custo diz isso; parte sem custo leva, depois do valor e do
  // `sufixo` ("no total"), quantas sessoes ficaram fora da conta, com virgula so quando ha sufixo.
  function custoDoGrupo(g, sufixo) {
    if (g.sessoes > 0 && g.semCusto === g.sessoes) return SEM_CUSTO;
    const valor = formatarCusto(g.custoUsd) + (sufixo ? ' ' + sufixo : '');
    if (!g.semCusto) return valor;
    return valor + (sufixo ? ', ' : ' ') + 'sem o custo de ' + plural(g.semCusto, 'sessão', 'sessões') + ' do terminal';
  }

  const api = {
    ESTADOS, LIMITE_DA_CONVERSA, LIMITE_DA_RESPOSTA, LIMITE_DO_TRECHO, criar, sessao, maquina, projeto, semSinal,
    minutos, fila, resumo, contar, custoTotal, todosOsProjetos, equipe, aplicar, decidir, responder, linhasDoTrecho,
    rotuloDoProjeto, alvoDoPedido, tipoDoPedido, rotuloDaOpcao, resumoDasOpcoes, podeResponder, limiteDaMesa,
    rotuloDoEstado, urgencia, rotuloDaUrgencia, resumoDaContagem, nomeDoModelo, resumoDosArquivos, formatarTempo,
    formatarCusto, custoDaSessao, custoDoGrupo,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.PainelEstado = api;
})(typeof window !== 'undefined' ? window : globalThis);
