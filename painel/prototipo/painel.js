// Painel de sessoes: a tela. Le dados.json (o retrato do servidor ao vivo, com modo 'ao-vivo' e seq, ou o simulado do
// prototipo), desenha a caixa de decisoes, o escritorio (uma sala por projeto, uma mesa por sessao) e a visao de
// equipe, aplica os eventos do SSE em /eventos e abre o painel lateral de cada sessao: o pedido, a conversa, a
// resposta e os arquivos. Ao vivo, a decisao vai ao servidor (/decidir) e a tela so muda quando ele confirma. A logica
// sem tela mora em estado.js (window.PainelEstado). Texto de sessao e dado: entra so por textContent, nunca como HTML.
(function () {
  'use strict';

  const E = window.PainelEstado;
  const SVG = 'http://www.w3.org/2000/svg';
  const RELOGIO_MS = 30000;
  // Prazo de cada busca ao servidor (a carga, o retrato de novo e a decisao): sem ele, um servidor que aceita a conexao
  // e nunca responde deixa a pagina esperando.
  const ESPERA_MS = 10000;
  const TIPOS_DE_EVENTO = ['mensagem', 'custo', 'arquivo', 'estado', 'maquina', 'sessao', 'voltou', 'decisao'];
  // O POST ao servidor ao vivo: o X-Painel e o que ele exige de quem nao e outro site (painel-rotas.js).
  const CABECALHOS = { 'Content-Type': 'application/json', 'X-Painel': '1' };
  const VOLTOU = 'Este pedido voltou para o terminal: decida por lá.';
  const NAO_CHEGOU = 'A decisão não chegou ao servidor do painel: confira no terminal se ele está rodando e tente de novo.';
  const SEM_RESPOSTA = 'O servidor do painel demorou a responder, e a decisão pode ter chegado: veja na conversa da ' +
    'sessão; se o pedido seguir aqui, tente de novo.';
  const SEM_A_CHAVE = 'O painel não reconheceu esta aba: abra-o de novo pelo endereço com a chave que o terminal mostrou ' +
    'ao iniciar o painel.';
  const ENVIANDO = 'Enviando a decisão à sessão…';
  const SELO = { 'ao-vivo': 'Ao vivo · esta máquina', prototipo: 'Protótipo · dados simulados' };
  const ICONES = {
    precisa: ['M12 3.5 2.8 19.5h18.4z', 'M12 10v4', 'M12 16.8h.01'],
    trabalhando: ['M20.5 12a8.5 8.5 0 1 1-5.6-8'],
    parada: ['M9 5.5v13', 'M15 5.5v13'],
    concluida: ['M5 12.5l4.5 4.5L19 7.5'],
    semSinal: ['M3 3l18 18', 'M8.6 16.3a5 5 0 0 1 6.8 0', 'M5.2 12.7a10 10 0 0 1 4-2.3', 'M15.4 10.6a10 10 0 0 1 3.4 2.1',
      'M2 9a15 15 0 0 1 3.9-2.6', 'M10.6 5.6A15 15 0 0 1 22 9', 'M12 20h.01'],
    terminal: ['M4.5 7.5l5 4.5-5 4.5', 'M12 17h7.5'],
    painel: ['M3.5 5h17v14h-17z', 'M3.5 9.5h17'],
  };
  const CHAVE_DO_TEMA = 'painel.tema';
  // O sinal de cada linha do trecho vai como texto: a cor do diff nunca fala sozinha.
  const SINAL_DA_LINHA = { mais: '+', menos: '−', igual: ' ' };
  // A conversa so desce sozinha quando o dono ja esta perto do fim: quem subiu para ler o comeco nao e puxado de volta.
  const PERTO_DO_FIM = 48;
  const ROTULO_DOS_AVISOS = { granted: 'Avisos ligados', denied: 'Avisos bloqueados: libere nas permissões do site', default: 'Ligar avisos' };

  const sistemaEscuro = window.matchMedia('(prefers-color-scheme: dark)');
  // Os avisos do navegador pedem contexto seguro (127.0.0.1 conta); sem a API ou sem ele, o botao nem aparece.
  const temAvisos = 'Notification' in window && window.isSecureContext;
  const mesas = new Map();
  const salas = new Map();
  const chips = new Map();
  // Por sessao: o rascunho da resposta e os trechos de arquivo abertos, para o painel lateral voltar como estava.
  const rascunhos = new Map();
  const trechosAbertos = new Map();
  // Com o filtro ligado, a sala sem mesa naquele estado diz o que falta.
  const NENHUMA_NO_ESTADO = {
    precisa: 'Nenhuma sessão deste projeto precisa de você.',
    trabalhando: 'Nenhuma sessão deste projeto está trabalhando.',
    parada: 'Nenhuma sessão deste projeto está parada.',
    concluida: 'Nenhuma sessão deste projeto está concluída.',
  };
  let st = null;
  let filtro = 'todas';
  let montado = false;
  // As sessoes que estavam na fila no desenho anterior. Depois da carga, so o pedido que nao estava nela ganha o realce;
  // quem continua na fila nao pisca a cada desenho.
  let naFila = new Set();
  // A sessao aberta no painel lateral e a chave de foco de quem o abriu, para o foco voltar la ao fechar.
  let aberta = null;
  let quemAbriu = null;
  // O tema escolhido no botao; null segue o do sistema.
  let temaEscolhido = null;
  // Ao vivo: o seq do ultimo evento aplicado (o retrato traz o dele); enquanto o retrato e buscado de novo, os eventos
  // que chegam esperam em `guardados`. `geracao` descarta a busca que outra mais nova ja substituiu.
  let modo = 'prototipo';
  let ultimoSeq = 0;
  let buscando = false;
  let guardados = [];
  let geracao = 0;
  // Os ids dos pedidos cuja decisao foi ao servidor e ainda nao voltou; e, por sessao, a nota da ultima decisao que nao
  // passou ({ pedido, texto, semBotoes }), que vale enquanto o pedido for o mesmo.
  const decidindo = new Set();
  const notas = new Map();
  // O id desta aba, que o servidor usa para saber se ha painel olhando (POST /presenca).
  const idDaAba = window.crypto && typeof window.crypto.randomUUID === 'function'
    ? window.crypto.randomUUID()
    : 'aba' + Math.random().toString(36).slice(2) + Date.now().toString(36);

  function $(id) { return document.getElementById(id); }

  function el(tag, classe, texto) {
    const n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto !== undefined) n.textContent = texto;
    return n;
  }

  function soLeitor(texto) { return el('span', 'so-leitor', texto); }

  function icone(nome) {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'icone');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    for (const d of ICONES[nome] || []) {
      const p = document.createElementNS(SVG, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    }
    return svg;
  }

  function temTexto(x) { return typeof x === 'string' && x.trim() !== ''; }

  function linhas(n) { return n === 1 ? '1 linha' : n + ' linhas'; }

  function haQuanto(min) {
    const t = E.formatarTempo(min);
    return t === 'agora' ? 'agora' : 'há ' + t;
  }

  // O tempo guarda o instante de inicio em data-desde; o relogio reescreve so esse texto a cada 30 s.
  function tempo(s, classe) {
    const n = el('span', classe + ' num', haQuanto(E.minutos(s, Date.now())));
    n.dataset.desde = String(s.desde);
    return n;
  }

  function atualizarRelogio() {
    const agora = Date.now();
    for (const n of document.querySelectorAll('[data-desde]')) {
      n.textContent = haQuanto(E.minutos({ desde: Number(n.dataset.desde) }, agora));
    }
  }

  function amostra(p) {
    const n = el('span', 'amostra');
    n.setAttribute('aria-hidden', 'true');
    if (p && p.cor) n.dataset.cor = p.cor;
    return n;
  }

  function nomeDaMaquina(s) {
    const m = E.maquina(st, s.maquina);
    return m ? m.nome : s.maquina || 'máquina desconhecida';
  }

  // O foco mora no elemento marcado com data-foco; quando a lista e redesenhada, ele volta para o equivalente.
  function chaveDoFoco() {
    const a = document.activeElement;
    return a && a.dataset ? a.dataset.foco : undefined;
  }

  // Elemento dentro de um [hidden] (a mesa que o filtro escondeu) nao recebe foco: o foco iria para o nada.
  function visivel(n) { return n.isConnected && !n.closest('[hidden]'); }

  // Sem o equivalente: com o painel lateral aberto, o titulo dele; a mesa que o filtro escondeu, o filtro ligado; o
  // pedido que saiu da fila, o primeiro que ficou, ou a caixa vazia.
  function reservaDoFoco(chave) {
    if ($('lateral').open) return $('lateral-titulo');
    if (chave.startsWith('abrir:')) return chips.get(filtro);
    const primeiro = $('fila-lista').querySelector('[data-foco^="fila:"]');
    return primeiro && visivel(primeiro) ? primeiro : $('fila');
  }

  function focarPelaChave(chave) {
    if (chave) {
      for (const n of document.querySelectorAll('[data-foco]')) {
        if (n.dataset.foco === chave && visivel(n) && !n.disabled) { n.focus({ preventScroll: true }); return; }
      }
    }
    const reserva = reservaDoFoco(chave || '');
    if (reserva) reserva.focus({ preventScroll: true });
  }

  function restaurarFoco(chave) {
    if (!chave) return;
    const a = document.activeElement;
    if (a && a !== document.body && visivel(a)) return;
    focarPelaChave(chave);
  }

  // Com o painel lateral aberto, o resto da pagina fica inerte e o leitor de tela nao ouve o anuncio de fora dele.
  function anunciar(texto) { $($('lateral').open ? 'lateral-anuncio' : 'anuncio').textContent = texto; }

  // ---- o tema ----
  // atalho: o tema salvo entra pelo painel.js, que carrega com defer. limite: um quadro com o tema do sistema antes do
  // salvo. trocar quando: o painel tiver um script de cabeca que rode antes do primeiro desenho.
  function lerTema() {
    try {
      const t = window.localStorage.getItem(CHAVE_DO_TEMA);
      return t === 'claro' || t === 'escuro' ? t : null;
    } catch (erro) {
      return null;
    }
  }

  function desenharTema() {
    const raiz = document.documentElement;
    if (temaEscolhido) raiz.dataset.tema = temaEscolhido;
    else delete raiz.dataset.tema;
    const efetivo = temaEscolhido || (sistemaEscuro.matches ? 'escuro' : 'claro');
    $('tema').setAttribute('aria-pressed', String(efetivo === 'claro'));
  }

  function trocarTema() {
    temaEscolhido = $('tema').getAttribute('aria-pressed') === 'true' ? 'escuro' : 'claro';
    // Sem armazenamento (navegacao privada, site bloqueado), a escolha vale ate recarregar a pagina.
    try { window.localStorage.setItem(CHAVE_DO_TEMA, temaEscolhido); } catch (erro) { /* fica so nesta pagina */ }
    desenharTema();
  }

  function montarTema() {
    temaEscolhido = lerTema();
    $('tema').hidden = false;
    $('tema').addEventListener('click', trocarTema);
    // O Safari antes do 14 so tem o addListener na media query.
    if (typeof sistemaEscuro.addEventListener === 'function') sistemaEscuro.addEventListener('change', desenharTema);
    else if (typeof sistemaEscuro.addListener === 'function') sistemaEscuro.addListener(desenharTema);
    desenharTema();
  }

  // ---- os avisos do navegador ----
  function desenharAvisos() {
    const b = $('avisos');
    const permissao = Notification.permission;
    b.textContent = ROTULO_DOS_AVISOS[permissao] || ROTULO_DOS_AVISOS.default;
    b.disabled = permissao !== 'default';
  }

  function montarAvisos() {
    if (!temAvisos) return;
    const b = $('avisos');
    b.hidden = false;
    b.addEventListener('click', function () {
      if (Notification.permission !== 'default') return;
      // O navegador antigo so devolve pela funcao de retorno; o novo, pela promessa. Desenhar duas vezes nao muda nada.
      const pedido = Notification.requestPermission(desenharAvisos);
      if (pedido && typeof pedido.then === 'function') pedido.then(desenharAvisos, desenharAvisos);
    });
    desenharAvisos();
  }

  // O aviso do navegador sai so quando o dono nao esta olhando o painel; o clique traz a aba e abre a sessao. O texto e
  // generico (decisao do dono): o aviso aparece fora da aba, na tela bloqueada e na central do sistema, e nem o nome da
  // sessao nem o texto do pedido saem dela.
  function notificar(id) {
    if (!temAvisos || Notification.permission !== 'granted' || document.hasFocus()) return;
    if (!E.sessao(st, id)) return;
    try {
      const aviso = new Notification('Uma decisão espera você',
        { body: 'Abra o painel de sessões para ver.', tag: 'painel-' + id, icon: 'icone.svg' });
      aviso.addEventListener('click', function () {
        window.focus();
        aviso.close();
        abrir(id, null);
      });
    } catch (erro) {
      // O Chrome do Android so cria aviso por service worker: o anuncio na tela ja saiu, o console guarda o porque.
      console.warn('painel: o aviso do navegador não saiu', erro);
    }
  }

  // ---- topo ----
  function desenharTopo() {
    const lista = $('maquinas');
    lista.replaceChildren();
    for (const m of st.maquinas) {
      const li = el('li', 'maquina');
      const offline = m.conexao === 'offline';
      li.dataset.conexao = offline ? 'offline' : 'online';
      const luz = el('span', 'maquina__luz');
      luz.setAttribute('aria-hidden', 'true');
      const situacao = offline ? 'sem sinal' : 'com sinal';
      li.append(luz, el('span', 'maquina__nome', m.nome), el('span', null, m.sistema ? m.sistema + ' · ' + situacao : situacao));
      lista.appendChild(li);
    }
    const n = st.sessoes.length;
    $('total').textContent = (n === 1 ? '1 sessão' : n + ' sessões') + ', ' + E.custoDoGrupo(E.resumo(st), 'no total');
  }

  // O 'sem' e o fim da linha: todo texto dele manda recarregar, e a reconexao que vem depois (o Last-Event-ID ja passou
  // do evento perdido) nao pode trocar o aviso por "Ao vivo" com a tela atrasada. A troca fala no leitor de tela, menos
  // a primeira ligacao, que e o esperado, e a que o chamador cala porque outro aviso ja fala por ela.
  function sinal(estado, texto, calado) {
    const p = $('sinal');
    const antes = p.dataset.sinal;
    if (antes === 'sem' || antes === estado) return;
    p.dataset.sinal = estado;
    $('sinal-texto').textContent = texto;
    if (!calado && !(antes === 'conectando' && estado === 'aovivo')) anunciar(texto);
  }

  // ---- a caixa de decisoes ----
  // O topo do pedido (urgencia, tipo e espera) e a linha do alvo, iguais na fila e no painel lateral.
  function topoDoPedido(s, pedido) {
    const topo = el('p', 'pedido__topo');
    const urgencia = el('span', 'urgencia', E.rotuloDaUrgencia(pedido));
    urgencia.dataset.urgencia = E.urgencia(pedido);
    topo.append(urgencia, el('span', 'pedido__tipo', E.tipoDoPedido(pedido)), tempo(s, 'pedido__espera'));
    return topo;
  }

  function linhaDoAlvo(pedido) {
    const alvo = E.alvoDoPedido(pedido);
    if (!alvo) return null;
    const linha = el('p', 'pedido__alvo', alvo.rotulo);
    linha.appendChild(el('code', 'codigo', alvo.valor));
    return linha;
  }

  function itemDaFila(s, novo) {
    const p = s.pedido || {};
    const li = el('li', novo ? 'pedido pedido--novo' : 'pedido');
    li.dataset.urgencia = E.urgencia(s.pedido);

    const topo = topoDoPedido(s, s.pedido);

    const onde = el('p', 'pedido__onde');
    onde.append(amostra(E.projeto(st, s.projeto)), el('span', null, E.rotuloDoProjeto(st, s)),
      el('span', null, '·'), el('span', 'pedido__sessao', s.nome));

    const texto = temTexto(p.texto) ? p.texto : 'A sessão não disse o que pede; abra o pedido para ver a conversa.';
    li.append(topo, onde, el('p', 'pedido__texto', texto));
    const alvo = linhaDoAlvo(p);
    if (alvo) li.appendChild(alvo);
    if (Array.isArray(p.opcoes) && p.opcoes.length) {
      const opcoes = el('ul', 'pedido__opcoes');
      opcoes.setAttribute('aria-label', E.resumoDasOpcoes(p.opcoes));
      for (const o of p.opcoes) opcoes.appendChild(el('li', null, E.rotuloDaOpcao(o)));
      li.appendChild(opcoes);
    }
    if (E.semSinal(st, s)) {
      li.appendChild(el('p', 'pedido__semsinal', 'Sem sinal de ' + nomeDaMaquina(s) + ': o pedido pode já ter mudado.'));
    }
    if (p.voltou) li.appendChild(el('p', 'bloco__nota', VOLTOU));
    li.appendChild(el('p', 'pedido__limite', E.limiteDaMesa(s)));

    const acoes = el('div', 'pedido__acoes');
    const botao = el('button', 'botao', 'Abrir o pedido');
    botao.type = 'button';
    botao.setAttribute('aria-haspopup', 'dialog');
    botao.appendChild(soLeitor(' de ' + s.nome));
    botao.dataset.foco = 'fila:' + s.id;
    botao.addEventListener('click', function () { abrir(s.id, 'fila:' + s.id); });
    acoes.appendChild(botao);
    li.appendChild(acoes);
    return li;
  }

  function desenharFila() {
    const lista = E.fila(st);
    $('fila-lista').replaceChildren(...lista.map(function (s) { return itemDaFila(s, montado && !naFila.has(s.id)); }));
    naFila = new Set(lista.map(function (s) { return s.id; }));
    $('fila-lista').hidden = lista.length === 0;
    $('fila-vazia').hidden = lista.length > 0;
    $('fila-conta').hidden = lista.length === 0;
    $('fila-conta').textContent = lista.length === 1 ? '1 esperando' : lista.length + ' esperando';
  }

  // ---- o escritorio ----
  function montarFiltro() {
    const grupo = $('filtro');
    for (const chave of ['todas'].concat(E.ESTADOS)) {
      const b = el('button', 'chip');
      b.type = 'button';
      b.dataset.foco = 'filtro:' + chave;
      if (chave !== 'todas') b.appendChild(icone(chave));
      b.append(el('span', null, chave === 'todas' ? 'Todas' : E.rotuloDoEstado(chave)), el('span', 'chip__num'));
      b.addEventListener('click', function () { escolherFiltro(chave); });
      chips.set(chave, b);
      grupo.appendChild(b);
    }
  }

  function desenharFiltro() {
    const conta = E.contar(st);
    for (const [chave, b] of chips) {
      b.setAttribute('aria-pressed', String(chave === filtro));
      b.querySelector('.chip__num').textContent = String(chave === 'todas' ? st.sessoes.length : conta[chave]);
    }
  }

  function escolherFiltro(chave) {
    filtro = chave;
    desenharFiltro();
    aplicarFiltro();
  }

  // Esconde as mesas fora do filtro; cada sala conta as proprias mesas que sobraram, sem recontar as sessoes.
  function aplicarFiltro() {
    for (const s of st.sessoes) {
      const mesa = mesas.get(s.id);
      if (mesa) mesa.parentElement.hidden = filtro !== 'todas' && s.estado !== filtro;
    }
    for (const sala of salas.values()) {
      const itens = Array.from(sala.lista.children);
      const visiveis = itens.filter(function (li) { return !li.hidden; }).length;
      sala.vazia.hidden = visiveis > 0;
      sala.vazia.textContent = itens.length === 0 || filtro === 'todas'
        ? 'Nenhuma sessão neste projeto.'
        : NENHUMA_NO_ESTADO[filtro];
      sala.lista.hidden = visiveis === 0;
    }
  }

  function montarSalas() {
    const raiz = $('salas');
    // O id do nome de cada mesa vai pela ordem, nao pelo id da sessao: um id com espaco quebraria o aria-labelledby.
    let numeroDaMesa = 0;
    E.todosOsProjetos(st).forEach(function (p, i) {
      const sala = el('section', 'sala');
      const titulo = el('h3', 'sala__nome');
      titulo.id = 'sala-' + i;
      titulo.append(amostra(p), el('span', null, p.nome));
      sala.setAttribute('aria-labelledby', titulo.id);
      const topo = el('div', 'sala__topo');
      const resumo = el('p', 'sala__resumo');
      const custo = el('p', 'sala__custo num');
      topo.append(titulo, resumo, custo);
      const lista = el('ul', 'mesas');
      lista.setAttribute('aria-label', 'Mesas de ' + p.nome);
      for (const s of st.sessoes) {
        if (s.projeto !== p.id) continue;
        const li = el('li');
        const mesa = el('article', 'mesa');
        mesa.setAttribute('aria-labelledby', 'mesa-' + numeroDaMesa++);
        li.appendChild(mesa);
        lista.appendChild(li);
        mesas.set(s.id, mesa);
        preencherMesa(mesa, s);
      }
      const vazia = el('p', 'sala__vazia');
      sala.append(topo, lista, vazia);
      raiz.appendChild(sala);
      salas.set(p.id, { resumo: resumo, custo: custo, lista: lista, vazia: vazia });
    });
    $('salas-vazia').textContent = 'Nenhuma sessão aberta ainda.';
    $('salas-vazia').hidden = st.sessoes.length > 0;
  }

  // A sessao nova ou o retrato novo: o escritorio sai inteiro e volta, com as salas e as mesas que valem agora.
  function reconstruirSalas() {
    $('salas').replaceChildren();
    mesas.clear();
    salas.clear();
    montarSalas();
  }

  function desenharSalas() {
    for (const [id, sala] of salas) {
      sala.resumo.textContent = E.resumoDaContagem(E.contar(st, id));
      sala.custo.textContent = E.custoDoGrupo(E.resumo(st, id));
    }
  }

  function preencherMesa(mesa, s) {
    const semSinal = E.semSinal(st, s);
    mesa.dataset.estado = s.estado;
    mesa.dataset.sinal = semSinal ? 'sem' : 'com';

    const estado = el('p', 'mesa__estado');
    estado.append(icone(s.estado), el('span', null, E.rotuloDoEstado(s.estado)), tempo(s, 'mesa__tempo'));

    // O nome e o botao que abre a sessao; o CSS estica a area de clique dele sobre a mesa inteira.
    const nome = el('h4', 'mesa__nome');
    nome.id = mesa.getAttribute('aria-labelledby');
    const abrirMesa = el('button', 'mesa__abrir', s.nome);
    abrirMesa.type = 'button';
    abrirMesa.setAttribute('aria-haspopup', 'dialog');
    abrirMesa.dataset.foco = 'abrir:' + s.id;
    abrirMesa.addEventListener('click', function () { abrir(s.id, 'abrir:' + s.id); });
    nome.appendChild(abrirMesa);

    const tela = el('div', 'monitor__tela');
    const tarefa = el('p', 'monitor__tarefa');
    tarefa.append(soLeitor('Tarefa: '), document.createTextNode(s.tarefa || 'sem tarefa escrita'));
    // estado.js so guarda fala com texto, de 'dono' ou de 'agente'.
    const ultima = s.conversa[s.conversa.length - 1];
    const fala = el('p', 'monitor__fala');
    if (ultima) {
      fala.append(soLeitor(ultima.quem === 'dono' ? 'Sua última fala: ' : 'Última fala do agente: '),
        document.createTextNode(ultima.texto));
    } else {
      fala.textContent = 'Ainda sem conversa.';
    }
    tela.append(tarefa, fala);
    const monitor = el('div', 'monitor');
    monitor.appendChild(tela);

    const partes = [estado, nome, monitor];

    if (s.estado === 'precisa') {
      const espera = el('div', 'mesa__espera');
      espera.append(el('p', 'mesa__espera-tipo', 'Espera por você: ' + E.tipoDoPedido(s.pedido) + ', ' +
        E.rotuloDaUrgencia(s.pedido).toLowerCase()));
      if (s.pedido && temTexto(s.pedido.texto)) espera.appendChild(el('p', 'mesa__espera-texto', s.pedido.texto));
      partes.push(espera);
    }
    if (semSinal) {
      const aviso = el('p', 'mesa__semsinal');
      aviso.append(icone('semSinal'), el('span', null, 'Sem sinal de ' + nomeDaMaquina(s) +
        ': mostrando o último estado que chegou.'));
      partes.push(aviso);
    }

    const modelo = E.nomeDoModelo(s.modelo);
    const agente = el('div', 'mesa__agente');
    // Array.from separa por caractere, nao por metade de um emoji.
    const avatar = el('span', 'avatar', Array.from(modelo)[0]);
    avatar.setAttribute('aria-hidden', 'true');
    avatar.appendChild(el('span', 'avatar__luz'));
    const quem = el('div', 'mesa__quem');
    quem.append(el('span', 'mesa__modelo', modelo), el('span', 'mesa__maquina', nomeDaMaquina(s)));
    agente.append(avatar, quem);

    const dados = el('p', 'mesa__dados');
    const custo = el('span', 'num');
    custo.append(soLeitor('Custo: '), document.createTextNode(E.custoDaSessao(s)));
    dados.append(custo, el('span', 'num', E.resumoDosArquivos(s.arquivos)));

    const limite = el('p', 'mesa__limite');
    limite.append(icone(E.podeResponder(s) ? 'painel' : 'terminal'), el('span', null, E.limiteDaMesa(s)));

    partes.push(agente, dados, limite);
    mesa.replaceChildren(...partes);
  }

  // ---- a visao de equipe ----
  // Uma linha da tabela; `total` e o custo de todas as sessoes, que da a escala da barra (null na linha do total).
  function linhaDaEquipe(cabeca, g, total) {
    const th = el('th');
    th.scope = 'row';
    const nome = el('span', 'tabela__nome');
    nome.append(...cabeca);
    th.appendChild(nome);
    const precisa = el('td', 'num', String(g.estados.precisa));
    if (g.estados.precisa > 0) precisa.dataset.alerta = 'sim';
    const custo = el('td', 'num tabela__custo');
    custo.appendChild(el('span', null, E.custoDoGrupo(g)));
    if (total !== null) {
      // A barra repete o numero ao lado so para o olho comparar: o leitor de tela fica com o numero.
      const barra = el('meter', 'tabela__barra');
      barra.setAttribute('aria-hidden', 'true');
      barra.min = 0;
      barra.max = total > 0 ? total : 1;
      barra.value = g.custoUsd;
      custo.appendChild(barra);
    }
    const quando = el('td', 'tabela__quando');
    quando.appendChild(g.atividade === null ? el('span', null, 'sem atividade') : tempo({ desde: g.atividade }, 'tabela__tempo'));
    const tr = el('tr');
    tr.append(th, el('td', 'num', String(g.sessoes)), precisa, el('td', 'num', String(g.arquivos)), custo, quando);
    return tr;
  }

  function desenharEquipe() {
    const eq = E.equipe(st);
    const total = eq.total.custoUsd;
    $('equipe-projetos-linhas').replaceChildren(...eq.projetos.map(function (p) {
      return linhaDaEquipe([amostra(p), el('span', null, p.nome)], p, total);
    }));
    $('equipe-maquinas-linhas').replaceChildren(...eq.maquinas.map(function (m) {
      const cabeca = [el('span', null, m.nome)];
      if (m.conexao === 'offline') cabeca.push(el('span', 'tabela__nota', 'sem sinal'));
      return linhaDaEquipe(cabeca, m, total);
    }));
    for (const id of ['equipe-projetos-total', 'equipe-maquinas-total']) {
      $(id).replaceChildren(linhaDaEquipe([el('span', null, 'Total')], eq.total, null));
    }
    document.querySelector('.equipe').hidden = false;
  }

  // ---- o painel lateral ----
  function abrir(id, chave) {
    if (!E.sessao(st, id)) return;
    const lateral = $('lateral');
    if (aberta !== id) {
      aberta = id;
      $('resposta-texto').value = rascunhos.get(id) || '';
      limparErro();
      lateral.querySelector('.lateral__corpo').scrollTop = 0;
    }
    preencherLateral();
    if (!lateral.open) {
      quemAbriu = chave;
      lateral.showModal();
    }
    const conversa = $('lateral-conversa');
    conversa.scrollTop = conversa.scrollHeight;
    $('lateral-titulo').focus();
  }

  function preencherLateral() {
    const s = E.sessao(st, aberta);
    if (!s) return;
    const semSinal = E.semSinal(st, s);
    $('lateral-projeto').replaceChildren(amostra(E.projeto(st, s.projeto)), el('span', null, E.rotuloDoProjeto(st, s)));
    $('lateral-titulo').textContent = s.nome;
    const estado = $('lateral-estado');
    estado.dataset.estado = s.estado;
    estado.replaceChildren(icone(s.estado), el('span', 'lateral__rotulo', E.rotuloDoEstado(s.estado)),
      tempo(s, 'lateral__tempo'),
      el('span', 'lateral__quem', E.nomeDoModelo(s.modelo) + ' · ' + nomeDaMaquina(s) + (semSinal ? ', sem sinal' : '')));
    $('lateral-tarefa').replaceChildren(soLeitor('Tarefa: '), document.createTextNode(s.tarefa || 'sem tarefa escrita'));
    preencherPedido(s, semSinal);
    preencherConversa(s);
    preencherResposta(s, semSinal);
    preencherArquivos(s);
  }

  // Com a decisao no servidor, o botao fica aria-disabled e nao disabled: o foco segue nele enquanto a resposta nao vem,
  // e o clique repetido nao manda nada.
  function botaoDeDecisao(rotulo, escolha, primario, semSinal, ocupado) {
    const b = el('button', primario ? 'botao botao--primario' : 'botao', rotulo);
    b.type = 'button';
    b.dataset.foco = 'decidir:' + escolha;
    b.disabled = semSinal;
    if (ocupado) b.setAttribute('aria-disabled', 'true');
    b.addEventListener('click', function () {
      if (b.getAttribute('aria-disabled') === 'true') return;
      decidirAgora(escolha);
    });
    return b;
  }

  function preencherPedido(s, semSinal) {
    const caixa = $('lateral-pedido');
    if (s.estado !== 'precisa') {
      caixa.replaceChildren(el('p', 'bloco__nada', 'Nada espera por você nesta sessão.'));
      return;
    }
    const p = s.pedido;
    if (!p) {
      caixa.replaceChildren(el('p', 'bloco__nada', E.podeResponder(s)
        ? 'A sessão não disse o que pede: veja a conversa e responda por escrito, abaixo.'
        : 'A sessão não disse o que pede: veja a conversa e responda pelo terminal.'));
      return;
    }
    const partes = [topoDoPedido(s, p), el('p', 'pedido__texto', temTexto(p.texto) ? p.texto : 'A sessão não disse o que pede; veja a conversa.')];
    const alvo = linhaDoAlvo(p);
    if (alvo) partes.push(alvo);
    if (semSinal) {
      partes.push(el('p', 'pedido__semsinal', 'Sem sinal de ' + nomeDaMaquina(s) +
        ': a decisão não chegaria à sessão. Os botões voltam quando a máquina voltar.'));
    }
    // Sem botoes: o pedido que voltou para o terminal e a pergunta da sessao do terminal, que so o terminal responde.
    if (p.voltou) {
      partes.push(el('p', 'bloco__nota', VOLTOU));
      caixa.replaceChildren(...partes);
      return;
    }
    if (p.tipo === 'pergunta' && !E.podeResponder(s)) {
      partes.push(el('p', 'bloco__nota', 'Responda esta pergunta no terminal.'));
      caixa.replaceChildren(...partes);
      return;
    }
    const nota = notas.get(s.id);
    if (nota && nota.pedido === p.id) {
      partes.push(el('p', 'pedido__semsinal', nota.texto));
      if (nota.semBotoes) {
        caixa.replaceChildren(...partes);
        return;
      }
    }
    // Ao vivo, o servidor so aceita a decisao pelo id do pedido: sem ele, o botao levaria a um "ja mudou" falso.
    if (modo === 'ao-vivo' && !temTexto(p.id)) {
      partes.push(el('p', 'bloco__nota', 'Este pedido chegou sem identificação, e o painel não consegue decidi-lo: ' +
        'decida pelo terminal.'));
      caixa.replaceChildren(...partes);
      return;
    }
    const ocupado = temTexto(p.id) && decidindo.has(p.id);
    const acoes = el('div', 'decisao');
    if (ocupado) acoes.setAttribute('aria-busy', 'true');
    if (p.tipo === 'pergunta') {
      // Aqui so chega a pergunta da sessao do painel: a do terminal saiu acima.
      const opcoes = Array.isArray(p.opcoes) ? p.opcoes : [];
      acoes.setAttribute('role', 'group');
      acoes.setAttribute('aria-label', 'Escolha uma opção');
      opcoes.forEach(function (o, i) { acoes.appendChild(botaoDeDecisao(E.rotuloDaOpcao(o), i, false, semSinal, ocupado)); });
      if (!opcoes.length) partes.push(el('p', 'bloco__nota', 'A pergunta veio sem opções: responda por escrito, abaixo.'));
    } else {
      acoes.append(botaoDeDecisao('Aprovar', 'aprovar', true, semSinal, ocupado),
        botaoDeDecisao('Negar', 'negar', false, semSinal, ocupado));
    }
    if (acoes.childElementCount) partes.push(acoes);
    if (ocupado) partes.push(el('p', 'pedido__limite', ENVIANDO));
    caixa.replaceChildren(...partes);
  }

  // O pedido mudou entre o desenho e o clique (a maquina caiu, a sessao seguiu): a tela mostra o que vale agora.
  function pedidoMudou() {
    preencherLateral();
    $('lateral-titulo').focus();
    anunciar('Este pedido já mudou: confira o que a sessão mostra agora.');
  }

  function decidirAgora(escolha) {
    if (modo === 'ao-vivo') { decidirNoServidor(escolha); return; }
    const r = E.decidir(st, aberta, escolha, Date.now());
    if (!r.mudou.length) { pedidoMudou(); return; }
    depois(r);
  }

  // O painel lateral de `id` desenhado de novo, se ainda for o aberto, com o foco onde estava.
  function refazerLateral(id) {
    if (!$('lateral').open || aberta !== id) return;
    const foco = chaveDoFoco();
    preencherLateral();
    restaurarFoco(foco);
  }

  // Ao vivo, quem decide e o servidor: ele entrega a decisao ao gancho que segura o pedido e difunde o evento
  // 'decisao' as outras abas. A tela espera ocupada e so tira o pedido da fila quando ele confirma; a recusa diz o
  // porque (voltou para o terminal, ou ja foi decidido) e a falha de rede, o prazo esgotado, a chave recusada e o erro
  // do servidor devolvem os botoes.
  function decidirNoServidor(escolha) {
    const id = aberta;
    const s = E.sessao(st, id);
    const p = s && s.pedido;
    if (!s || s.estado !== 'precisa' || !p || !temTexto(p.id) || p.voltou || E.semSinal(st, s)) { pedidoMudou(); return; }
    if (decidindo.has(p.id)) return;
    const pedido = p.id;
    notas.delete(id);
    decidindo.add(pedido);
    refazerLateral(id);
    anunciar(ENVIANDO);
    const opcoes = { method: 'POST', headers: CABECALHOS, cache: 'no-store',
      body: JSON.stringify({ pedido: pedido, sessao: id, escolha: escolha }) };
    const prazo = prazoDaCarga();
    if (prazo) opcoes.signal = prazo;
    fetch('decidir', opcoes)
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (corpo) { return { ok: r.ok, status: r.status, corpo: corpo || {} }; });
      })
      .then(function (r) {
        decidindo.delete(pedido);
        if (r.ok && r.corpo.ok === true) {
          depois(E.aplicar(st, { tipo: 'decisao', sessao: id, pedido: pedido, escolha: escolha }, Date.now()));
          refazerLateral(id);
          return;
        }
        if (r.status === 409 && r.corpo.motivo === 'voltou') {
          depois(E.aplicar(st, { tipo: 'voltou', sessao: id, pedido: pedido }, Date.now()));
          refazerLateral(id);
          anunciar(VOLTOU);
          return;
        }
        // O 409 nao diz quem decidiu nem o que: a conversa da sessao mostra o que veio depois.
        if (r.status === 409 && r.corpo.motivo === 'decidido') {
          recusarDecisao(id, pedido, 'Este pedido já foi decidido (nesta aba ou em outra): veja na conversa da sessão o ' +
            'que ela fez.', true);
          return;
        }
        console.warn('painel: o servidor recusou a decisão, código ' + r.status);
        // 401 sem o cookie da chave; 403 sem o cabecalho do painel ou de outra origem (painel-rotas.js).
        if (r.status === 401 || r.status === 403) { recusarDecisao(id, pedido, SEM_A_CHAVE, false); return; }
        recusarDecisao(id, pedido, 'O servidor do painel recusou a decisão (código ' + r.status + '): recarregue a ' +
          'página e tente de novo.', false);
      }, function (erro) {
        decidindo.delete(pedido);
        // O prazo que vence nao diz se o servidor recebeu: a tela nao afirma que a decisao nao chegou. Decidir de novo
        // e seguro, porque o pedido ja decidido volta com o 409 'decidido'.
        if (erro && (erro.name === 'TimeoutError' || erro.name === 'AbortError')) {
          console.warn('painel: o servidor não respondeu à decisão no prazo', erro);
          recusarDecisao(id, pedido, SEM_RESPOSTA, false);
          return;
        }
        console.warn('painel: a decisão não chegou ao servidor', erro);
        recusarDecisao(id, pedido, NAO_CHEGOU, false);
      });
  }

  function recusarDecisao(id, pedido, texto, semBotoes) {
    notas.set(id, { pedido: pedido, texto: texto, semBotoes: semBotoes });
    refazerLateral(id);
    anunciar(texto);
  }

  function preencherConversa(s) {
    const caixa = $('lateral-conversa');
    const noFim = caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight <= PERTO_DO_FIM;
    $('conversa-lista').replaceChildren(...s.conversa.map(function (f) {
      const li = el('li', 'fala');
      li.dataset.quem = f.quem;
      li.append(el('p', 'fala__quem', f.quem === 'dono' ? 'Você' : 'Agente'), el('p', 'fala__texto', f.texto));
      return li;
    }));
    $('conversa-lista').hidden = s.conversa.length === 0;
    $('conversa-vazia').hidden = s.conversa.length > 0;
    if (noFim) caixa.scrollTop = caixa.scrollHeight;
  }

  function preencherResposta(s, semSinal) {
    const pode = E.podeResponder(s);
    $('resposta').hidden = !pode;
    $('resposta-limite').hidden = pode;
    $('resposta-limite').textContent = E.limiteDaMesa(s);
    $('resposta-enviar').disabled = semSinal;
    $('resposta-semsinal').hidden = !semSinal;
    $('resposta-semsinal').textContent = semSinal
      ? 'Sem sinal de ' + nomeDaMaquina(s) + ': a resposta não chegaria. O texto fica aqui até a máquina voltar.'
      : '';
  }

  // Os numeros na tela (+12 −3) e a frase para o leitor de tela, que leria os sinais soltos.
  function contagem(a) {
    // Contagem e inteiro de 0 para cima; o resto vira 0, como na soma da mesa.
    const mais = Number.isInteger(a.mais) && a.mais >= 0 ? a.mais : 0;
    const menos = Number.isInteger(a.menos) && a.menos >= 0 ? a.menos : 0;
    const numeros = el('span', 'arquivo__conta num');
    numeros.setAttribute('aria-hidden', 'true');
    numeros.append(el('span', 'arquivo__mais', '+' + mais), el('span', 'arquivo__menos', '−' + menos));
    return [numeros, soLeitor(': ' + linhas(mais) + ' a mais, ' + linhas(menos) + ' a menos')];
  }

  function trechoDoArquivo(a, trecho) {
    const pre = el('pre', 'diff');
    // O trecho rola de lado nas linhas compridas: com foco, a seta rola.
    pre.tabIndex = 0;
    pre.dataset.foco = 'trecho:' + a.caminho;
    pre.setAttribute('role', 'group');
    pre.setAttribute('aria-label', 'Trecho de ' + a.caminho);
    for (const l of trecho.linhas) {
      const linha = el('span', 'diff__linha');
      linha.dataset.tipo = l.tipo;
      if (l.tipo !== 'lugar') linha.appendChild(el('span', 'diff__sinal', SINAL_DA_LINHA[l.tipo]));
      linha.appendChild(document.createTextNode(l.texto));
      pre.appendChild(linha);
    }
    return pre;
  }

  function preencherArquivos(s) {
    const caixa = $('lateral-arquivos');
    if (!s.arquivos.length) {
      caixa.replaceChildren(el('p', 'bloco__nada', 'Nenhum arquivo mudado.'));
      return;
    }
    if (!trechosAbertos.has(s.id)) trechosAbertos.set(s.id, new Set());
    const abertos = trechosAbertos.get(s.id);
    const lista = el('ul', 'arquivos');
    for (const a of s.arquivos) {
      const li = el('li');
      const trecho = E.linhasDoTrecho(a);
      const caminho = el('code', 'arquivo__caminho', a.caminho);
      if (!trecho.linhas.length) {
        const linha = el('p', 'arquivo arquivo__topo');
        linha.append(caminho, ...contagem(a));
        li.appendChild(linha);
      } else {
        const detalhe = el('details', 'arquivo');
        detalhe.open = abertos.has(a.caminho);
        detalhe.addEventListener('toggle', function () {
          if (detalhe.open) abertos.add(a.caminho);
          else abertos.delete(a.caminho);
        });
        const resumo = el('summary', 'arquivo__topo');
        resumo.dataset.foco = 'arquivo:' + a.caminho;
        resumo.append(caminho, ...contagem(a));
        detalhe.append(resumo, trechoDoArquivo(a, trecho));
        if (trecho.cortadas) {
          detalhe.appendChild(el('p', 'diff__cortadas', 'Mais ' + linhas(trecho.cortadas) + ' que o painel não mostra; o git diff no terminal da sessão mostra todas.'));
        }
        li.appendChild(detalhe);
      }
      lista.appendChild(li);
    }
    caixa.replaceChildren(lista);
  }

  function limparErro() {
    $('resposta-erro').textContent = '';
    $('resposta-texto').removeAttribute('aria-invalid');
  }

  function mostrarErro(texto) {
    $('resposta-erro').textContent = texto;
    $('resposta-texto').setAttribute('aria-invalid', 'true');
    $('resposta-texto').focus();
  }

  function limiteEscrito() { return E.LIMITE_DA_RESPOSTA.toLocaleString('pt-BR'); }

  // O porque da resposta recusada, nas palavras do dono.
  function textoDaRecusa(s, recusa) {
    if (recusa === 'sem-sinal') return 'Sem sinal de ' + nomeDaMaquina(s) + ': a resposta não chegaria. Envie quando a máquina voltar.';
    if (recusa === 'vazia') return 'Escreva a resposta antes de enviar.';
    if (recusa === 'longa') return 'A resposta passa de ' + limiteEscrito() + ' caracteres: encurte e envie de novo.';
    if (recusa === 'terminal') return 'Esta sessão foi aberta no terminal: responda por lá.';
    // O rascunho mora so na memoria da pagina: recarregar sem copiar perde o que o dono escreveu.
    return 'A resposta não foi aceita. Copie o seu texto, recarregue a página e tente de novo.';
  }

  function enviarResposta(e) {
    e.preventDefault();
    const s = E.sessao(st, aberta);
    if (!s) return;
    const campo = $('resposta-texto');
    const r = E.responder(st, aberta, campo.value, Date.now());
    if (!r.mudou.length) {
      mostrarErro(textoDaRecusa(s, r.recusa));
      return;
    }
    campo.value = '';
    rascunhos.delete(aberta);
    limparErro();
    depois(r);
  }

  function montarLateral() {
    const lateral = $('lateral');
    const campo = $('resposta-texto');
    campo.maxLength = E.LIMITE_DA_RESPOSTA;
    $('resposta-dica').textContent = 'Ctrl+Enter (Cmd+Enter no Mac) envia. Até ' + limiteEscrito() + ' caracteres.';
    campo.addEventListener('input', function () {
      if (aberta !== null) rascunhos.set(aberta, campo.value);
      if (campo.hasAttribute('aria-invalid')) limparErro();
    });
    campo.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.isComposing) return;
      e.preventDefault();
      const form = $('resposta');
      if (typeof form.requestSubmit === 'function') form.requestSubmit(); else enviarResposta(e);
    });
    $('resposta').addEventListener('submit', enviarResposta);
    $('lateral-fechar').addEventListener('click', function () { lateral.close(); });
    // O clique no fundo escurecido, fora do painel, fecha como o Esc.
    lateral.addEventListener('click', function (e) {
      if (e.target !== lateral) return;
      const r = lateral.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) lateral.close();
    });
    lateral.addEventListener('close', function () {
      const chave = quemAbriu;
      aberta = null;
      quemAbriu = null;
      limparErro();
      focarPelaChave(chave);
    });
  }

  // O topo, a fila, as salas, o filtro e a equipe, na ordem em que um depende do outro.
  function redesenhar() {
    desenharTopo();
    desenharFila();
    desenharSalas();
    desenharFiltro();
    aplicarFiltro();
    desenharEquipe();
  }

  // O que vem depois de toda mudanca, do SSE ou do dono: redesenha o que mudou, devolve o foco, anuncia e avisa.
  function depois(r) {
    if (!r.mudou.length && !r.aviso) return;
    const foco = chaveDoFoco();
    // A sessao nova pode trazer sala nova: o escritorio volta inteiro, ja com a mesa dela.
    if (r.nova) reconstruirSalas();
    for (const id of r.mudou) {
      const mesa = mesas.get(id);
      const s = E.sessao(st, id);
      if (mesa && s) preencherMesa(mesa, s);
    }
    redesenhar();
    if ($('lateral').open && r.mudou.includes(aberta)) preencherLateral();
    restaurarFoco(foco);
    if (r.aviso) anunciar(r.aviso);
    if (r.chamado) notificar(r.chamado);
  }

  // ---- os eventos ----
  // No prototipo, a reconexao confia no Last-Event-ID: o servidor segue a lista dali, sem repetir nem pular. Ao vivo, o
  // servidor nao repete o que passou: cada ligacao busca o retrato de novo (religar), e o seq de cada evento diz se o
  // retrato ja o tem.
  function urlDosEventos() {
    if (modo !== 'ao-vivo') return 'eventos';
    return 'eventos?cliente=' + encodeURIComponent(idDaAba) + '&visivel=' + (document.visibilityState === 'visible' ? 1 : 0);
  }

  function ouvir() {
    if (typeof EventSource !== 'function') {
      // Recarregar nao da a este navegador o que falta: o passo e outro navegador.
      sinal('sem', 'Este navegador não acompanha ao vivo: abra o painel no Chrome, no Edge ou no Firefox');
      return;
    }
    const fonte = new EventSource(urlDosEventos());
    fonte.addEventListener('open', function () {
      sinal('aovivo', 'Ao vivo');
      if (modo !== 'ao-vivo') return;
      // A reconexao usa o endereco da 1a ligacao, com o visivel daquela hora: a presenca diz o de agora.
      dizerPresenca();
      religar();
    });
    fonte.addEventListener('error', function () {
      if (fonte.readyState === EventSource.CLOSED) sinal('sem', 'Sem conexão: recarregue a página');
      else sinal('reconectando', 'Reconectando…');
    });
    for (const tipo of TIPOS_DE_EVENTO) {
      fonte.addEventListener(tipo, function (e) {
        let ev;
        try {
          ev = JSON.parse(e.data);
        } catch (erro) {
          // O evento perdido deixa a tela atrasada: o sinal diz ao dono que recarregue, e o console guarda o porque.
          console.warn('painel: o evento ' + tipo + ' chegou com JSON quebrado', erro);
          sinal('sem', 'Uma atualização chegou quebrada: recarregue a página');
          return;
        }
        const seq = modo === 'ao-vivo' && /^\d+$/.test(e.lastEventId) ? Number(e.lastEventId) : null;
        if (buscando) guardados.push([seq, ev]);
        else receber(seq, ev);
      });
    }
  }

  // O evento que o retrato ja tem (seq ate o dele) nao se aplica duas vezes.
  function receber(seq, ev) {
    if (seq !== null) {
      if (seq <= ultimoSeq) return;
      ultimoSeq = seq;
    }
    depois(E.aplicar(st, ev, Date.now()));
  }

  // Busca o retrato de novo e, se o servidor seguiu sem a tela, troca o estado por ele; depois aplica os eventos que
  // chegaram durante a busca. A busca que falha deixa a tela atrasada: o sinal manda recarregar, ou abrir pelo
  // endereco com a chave quando o servidor recusou a aba.
  function religar() {
    const minha = ++geracao;
    buscando = true;
    buscarDados().then(function (dados) {
      if (minha !== geracao) return;
      const seq = Number(dados && dados.seq) || 0;
      if (seq !== ultimoSeq) trocarRetrato(dados, seq);
      const fila = guardados;
      guardados = [];
      buscando = false;
      for (const [s, ev] of fila) receber(s, ev);
    }).catch(function (erro) {
      if (minha !== geracao) return;
      guardados = [];
      buscando = false;
      console.warn('painel: falha ao buscar o retrato de novo', erro);
      // A aba que perdeu o cookie da chave: recarregar nao resolve, abrir pelo endereco com ela sim.
      if (erro && (erro.status === 401 || erro.status === 403)) { sinal('sem', SEM_A_CHAVE); return; }
      sinal('sem', 'Não deu para buscar o estado de novo: recarregue a página');
    });
  }

  function trocarRetrato(dados, seq) {
    const foco = chaveDoFoco();
    st = E.criar(dados, Date.now());
    ultimoSeq = seq;
    reconstruirSalas();
    redesenhar();
    if ($('lateral').open) {
      if (E.sessao(st, aberta)) preencherLateral();
      else {
        $('lateral').close();
        anunciar('Esta sessão não está mais no painel: o painel lateral foi fechado.');
      }
    }
    restaurarFoco(foco);
  }

  // Diz ao servidor se esta aba esta a vista: sem aba visivel, o pedido de permissao volta na hora para o terminal.
  function dizerPresenca() {
    fetch('presenca', { method: 'POST', headers: CABECALHOS, cache: 'no-store',
      body: JSON.stringify({ cliente: idDaAba, visivel: document.visibilityState === 'visible' }) })
      .catch(function (erro) { console.warn('painel: a presença não chegou ao servidor', erro); });
  }

  function buscarDados() {
    const opcoes = { cache: 'no-store' };
    const prazo = prazoDaCarga();
    if (prazo) opcoes.signal = prazo;
    return fetch('dados.json', opcoes).then(function (r) {
      if (!r.ok) { const erro = new Error('HTTP ' + r.status); erro.status = r.status; throw erro; }
      return r.json();
    });
  }

  function montar(dados) {
    modo = dados && dados.modo === 'ao-vivo' ? 'ao-vivo' : 'prototipo';
    ultimoSeq = Number(dados && dados.seq) || 0;
    st = E.criar(dados, Date.now());
    const selo = $('selo');
    selo.textContent = SELO[modo];
    selo.hidden = false;
    if (modo === 'ao-vivo') {
      document.title = 'Painel de sessões · ao vivo';
      if (typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', dizerPresenca);
    }
    const carregando = $('fila-carregando');
    if (carregando) carregando.remove();
    montarFiltro();
    montarSalas();
    montarLateral();
    montarAvisos();
    redesenhar();
    montado = true;
    setInterval(atualizarRelogio, RELOGIO_MS);
    ouvir();
  }

  function falhar(texto) {
    // O alerta da pagina ja fala: o sinal muda calado, para o leitor de tela nao ouvir duas vezes.
    sinal('sem', 'Sem dados', true);
    const aviso = el('p', 'erro-geral', texto);
    aviso.setAttribute('role', 'alert');
    $('conteudo').replaceChildren(aviso);
  }

  function falharCarga(causa) {
    falhar('Não deu para carregar as sessões: ' + causa.motivo + '. ' + causa.passo);
  }

  // O motivo e o passo seguinte em portugues para o dono, um par por causa: quando o servidor respondeu, mandar
  // conferir se ele esta rodando leva o dono ao lugar errado. A mensagem tecnica do navegador vai so para o console.
  // A tela nao sabe o modo antes de carregar: o texto serve ao painel ao vivo e ao prototipo.
  const RODAR_O_SERVIDOR = 'Confira se o servidor do painel está rodando: no terminal, rode node scripts/painel.js (ou ' +
    'node scripts/painel.js --prototipo, para os dados simulados) e recarregue a página.';
  function causaDaCarga(erro) {
    // AbortError e o prazo do navegador sem AbortSignal.timeout (prazoDaCarga): nada mais aborta a carga.
    if (erro && (erro.name === 'TimeoutError' || erro.name === 'AbortError')) {
      return { motivo: 'o servidor não respondeu em ' + ESPERA_MS / 1000 + ' segundos', passo: RODAR_O_SERVIDOR };
    }
    if (erro && erro.name === 'SyntaxError') {
      return { motivo: 'os dados chegaram quebrados',
        passo: 'Recarregue a página; no protótipo, confira se painel/prototipo/simulado.json é um JSON válido.' };
    }
    // O servidor ao vivo recusa a aba sem o cookie da chave: recarregar nao resolve, abrir pelo endereco com ela sim.
    if (erro && erro.status === 401) {
      return { motivo: 'o painel não reconheceu esta aba',
        passo: 'Abra o painel pelo endereço com a chave que o terminal mostrou ao iniciar o painel (node scripts/painel.js).' };
    }
    if (erro && erro.status) {
      return { motivo: 'o servidor respondeu com o código ' + erro.status,
        passo: 'Recarregue a página; se continuar, reinicie o servidor (node scripts/painel.js).' };
    }
    return { motivo: 'o servidor não respondeu', passo: RODAR_O_SERVIDOR };
  }

  // O prazo da carga: AbortSignal.timeout onde existe; no navegador que tem o resto e nao ele, um AbortController com o
  // mesmo prazo, que aborta com AbortError. Sem nenhum dos dois, a carga fica sem prazo, como antes de existirem.
  function prazoDaCarga() {
    if (typeof AbortSignal === 'function' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ESPERA_MS);
    if (typeof AbortController !== 'function') return undefined;
    const c = new AbortController();
    setTimeout(function () { c.abort(); }, ESPERA_MS);
    return c.signal;
  }

  // O tema vem antes de tudo: mesmo a pagina que falhou ao carregar segue o tema que o dono escolheu. O tema que falha
  // fica no do sistema e nao derruba a pagina.
  try { montarTema(); } catch (erro) { console.warn('painel: o botão de tema não montou', erro); }
  if (!E) {
    falharCarga({ motivo: 'o arquivo estado.js não carregou',
      passo: 'Confira se painel/prototipo/estado.js existe e recarregue a página; o detalhe está no console do navegador.' });
    return;
  }
  buscarDados()
    .then(function (dados) {
      // A montagem falha por outro motivo que a carga: o dono nao deve ir conferir o servidor por um defeito da tela.
      try {
        montar(dados);
      } catch (erro) {
        console.error('painel: falha ao desenhar as sessões', erro);
        falhar('O painel não conseguiu desenhar as sessões. Recarregue a página; se continuar, o detalhe ' +
          'está no console do navegador.');
      }
    }, function (erro) {
      console.warn('painel: falha ao carregar dados.json', erro);
      falharCarga(causaDaCarga(erro));
    });
})();
