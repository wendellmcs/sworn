'use strict';
// E1 (D827): tira a foto de uma pagina e junta a evidencia - console, erros da pagina e arvore de acessibilidade -
// pelo protocolo de depuracao do Chrome (CDP), com o Chrome ou o Edge que a pessoa ja tem. Sem pacote de terceiro:
// o socket e o WebSocket do proprio Node (22 ou mais novo). O navegador abre num perfil temporario e numa porta
// propria (nunca a 9222 de quem usa), a conexao e so com 127.0.0.1 e a espera e por condicao (o evento de carga, um
// seletor), nunca por tempo. Grava <saida>/tela.png e <saida>/evidencia.json e imprime um JSON com os caminhos e o
// hash da imagem.
//
//   node scripts/capturar-tela.js --url <endereco> --saida <pasta> [--largura 1280] [--altura 800]
//                                 [--esperar <seletor CSS>] [--tempo-max 30000] [--arquivo <arquivo que desenha a tela>]
//                                 [--passos <roteiro.json>]
//
// H10c: com --passos, depois da carga a captura clica, digita, espera e confere pela arvore de acessibilidade (o
// formato do roteiro esta em scripts/lib/roteiro.js) e so entao tira a foto. A evidencia leva o rastro em `roteiro`;
// a saida leva a soma em `passos` e sai 1 (com o JSON) quando o roteiro parou ou uma conferencia falhou.
//
// E3 item 2: a evidencia leva o estilo calculado do que se ve (`estilo`) e, com .claude/sworn/design.json na pasta
// onde roda, o que dele ficou fora do sistema (`estiloForaDoSistema`, os desvios do --arquivo valendo). R2b: leva
// tambem as medidas do layout (`layout`), que o conferir-tela.js compara com a referencia; a leitura que falha sai
// com o motivo em `layout.erro`, repetido na saida em `layoutNaoLido`.
//
// Saida 0 com o JSON; saida 1 com uma linha "ERRO: <o que houve e o que fazer>", ou com o JSON quando o roteiro de
// --passos parou ou uma conferencia dele falhou.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { setTimeout: dormir } = require('node:timers/promises');
const { spawn, spawnSync } = require('node:child_process');
const captura = require('./lib/captura.js');
const config = require('./lib/config.js');
const design = require('./lib/design.js');
const roteiro = require('./lib/roteiro.js');
const { apagarPasta } = require('./lib/caminho.js'); // pendencia #10: o rmSync deixava a pasta com acento

const PRAZO_DA_PORTA = 15000;
const PRAZO_DO_FECHO = 5000;
// Teto de cada comando ao navegador: nenhum passo espera para sempre, nem os que vem depois da carga.
const PRAZO_DO_COMANDO = 60000;
const PASSO = 100;
// H10-3: a rede quieta por 500 ms conta como assentada; o teto da espera e 5 s (os numeros do Playwright MCP).
const QUIETO = 500;
const TETO_DA_REDE = 5000;
// Os dialogos guardados na evidencia; a pagina que abre um atras do outro so soma na contagem.
const TETO_DE_DIALOGOS = 100;
// Os tipos que desenham a tela; WebSocket e EventSource ficam abertos de proposito e nao contam.
const TIPOS_QUE_ASSENTAM = new Set(['Document', 'Script', 'XHR', 'Fetch', 'Stylesheet', 'Font']);
const TENTE_DE_NOVO = 'Rode de novo; se repetir, feche outras janelas do navegador ou aponte SWORN_NAVEGADOR para ' +
  'outro Chrome ou Edge.';
// O fim de todo erro do enviar: as leituras do estilo e do layout o tiram (ali a foto ja esta tirada, e rodar de novo
// nao e o passo).
const DE_NOVO = '. ' + TENTE_DE_NOVO;

function comPrazo(promessa, ms, mensagem) {
  let relogio;
  const estouro = new Promise(function (_, falha) { relogio = setTimeout(function () { falha(new Error(mensagem)); }, ms); });
  return Promise.race([promessa, estouro]).finally(function () { clearTimeout(relogio); });
}

// O navegador escreve DevToolsActivePort no perfil quando a porta abre. Le ate achar o endereco, ate o processo morrer
// ou ate o prazo. "Ainda nao existe" e "o navegador esta escrevendo" (o Windows trava o arquivo durante a escrita:
// EBUSY ou EPERM, medido) sao a espera normal; outra falha de leitura sobe com a causa.
const LEITURA_DE_ESPERA = new Set(['ENOENT', 'EBUSY', 'EPERM']);
async function esperarEndereco(perfil, morreu) {
  const arquivo = path.join(perfil, 'DevToolsActivePort');
  const fim = Date.now() + PRAZO_DA_PORTA;
  while (Date.now() < fim) {
    if (morreu()) throw new Error('o navegador fechou logo ao abrir. ' + TENTE_DE_NOVO);
    let texto = null;
    try { texto = fs.readFileSync(arquivo, 'utf8'); } catch (e) {
      if (!LEITURA_DE_ESPERA.has(e.code)) throw new Error('nao deu para ler ' + arquivo + ' (' + e.code + '). ' + TENTE_DE_NOVO);
    }
    const endereco = texto === null ? null : captura.enderecoDoArquivo(texto);
    if (endereco) return endereco;
    await dormir(PASSO);
  }
  throw new Error('o navegador nao ficou pronto em ' + PRAZO_DA_PORTA / 1000 + ' s. ' + TENTE_DE_NOVO);
}

// Cliente CDP minimo: comandos com id e resposta (cada um com o seu prazo), eventos para quem ouvir. O `passo` e o
// nome do que a pessoa le quando algo falha; o nome do comando do protocolo fica fora da mensagem.
function conectar(endereco) {
  return new Promise(function (pronto, falha) {
    const ws = new WebSocket(endereco);
    const pendentes = new Map();
    const ouvintes = [];
    let proximo = 0;
    // Depois do 'close', o send de um WebSocket descarta o quadro sem lancar: o comando falha na hora, sem o prazo.
    let fechou = false;
    const cliente = {
      enviar: function (metodo, params, sessao, passo) {
        const id = ++proximo;
        const oQue = passo || 'falar com o navegador';
        if (fechou) return Promise.reject(new Error('o navegador fechou antes de ' + oQue + DE_NOVO));
        const resposta = new Promise(function (r, f) {
          pendentes.set(id, { r, f, passo: oQue });
          const msg = { id, method: metodo, params: params || {} };
          if (sessao) msg.sessionId = sessao;
          ws.send(JSON.stringify(msg));
        });
        return comPrazo(resposta, PRAZO_DO_COMANDO, 'o navegador nao respondeu ao ' + oQue + ' em ' +
          PRAZO_DO_COMANDO / 1000 + ' s' + DE_NOVO).finally(function () { pendentes.delete(id); });
      },
      ouvir: function (fn) { ouvintes.push(fn); },
      fechar: function () { try { ws.close(); } catch (e) { /* ja fechado */ } },
    };
    ws.addEventListener('open', function () { pronto(cliente); });
    ws.addEventListener('error', function () { falha(new Error('nao deu para falar com o navegador. ' + TENTE_DE_NOVO)); });
    ws.addEventListener('close', function () {
      fechou = true;
      for (const p of pendentes.values()) p.f(new Error('o navegador fechou no meio de ' + p.passo + DE_NOVO));
      pendentes.clear();
    });
    ws.addEventListener('message', function (ev) {
      let m;
      // O protocolo so manda JSON; um quadro que nao e JSON nao tem id a quem responder, e o comando que esperava
      // por ele sai pelo prazo, com o passo no texto.
      try { m = JSON.parse(String(ev.data)); } catch (e) { return; }
      if (m.id && pendentes.has(m.id)) {
        const p = pendentes.get(m.id);
        pendentes.delete(m.id);
        if (m.error) p.f(new Error('o navegador recusou ' + p.passo + ' (' + m.error.message + ')' + DE_NOVO));
        else p.r(m.result || {});
      } else if (m.method) {
        for (const fn of ouvintes) fn(m);
      }
    });
  });
}

// Abre a pagina, espera a carga (e o seletor, se pedido), roda o roteiro de --passos (que clica e digita na pagina) e
// devolve a foto e o que a pagina disse. Nao grava nada.
async function fotografar(cdp, o) {
  const { targetId } = await cdp.enviar('Target.createTarget', { url: 'about:blank' }, null, 'abrir uma aba');
  const { sessionId: s } = await cdp.enviar('Target.attachToTarget', { targetId, flatten: true }, null, 'abrir uma aba');
  const consoleLista = [];
  const erros = [];
  // A carga so conta depois que a navegacao comeca: um evento da aba em branco nao vale pela pagina.
  let navegando = false;
  let carregou = false;
  let avisarCarga = null;
  let status = null;
  // H10-2 (Playwright MCP, o "modal state" de backend/tool.ts:70-87): o dialogo da pagina segura a carga; ele se fecha
  // sozinho pelo "cancelar" (como o Playwright: a foto so le a pagina, nunca confirma um confirm()) e fica registrado,
  // ate TETO_DE_DIALOGOS; os de alem do teto so se contam.
  const dialogos = [];
  let dialogosForaDoTeto = 0;
  let dialogoPreso = null;
  // H10-3 (Playwright MCP, backend/utils.ts:20-57): as requisicoes em voo que a foto espera terminar.
  const emVoo = new Set();
  let ultimaRede = Date.now();
  cdp.ouvir(function (m) {
    if (m.sessionId !== s) return;
    if (m.method === 'Page.javascriptDialogOpening') {
      const p = m.params || {};
      const tipo = String(p.type || '');
      if (dialogos.length < TETO_DE_DIALOGOS) dialogos.push({ tipo: tipo, mensagem: String(p.message || '') });
      else dialogosForaDoTeto++;
      // o dialogo conta como preso ate o navegador confirmar o fechamento: recusado ou sem resposta, a pagina segue
      // presa e o erro da carga diz o porque
      dialogoPreso = tipo || 'dialogo';
      cdp.enviar('Page.handleJavaScriptDialog', { accept: false }, s, 'fechar o dialogo da pagina')
        .then(function () { dialogoPreso = null; }, function () {});
    } else if (m.method === 'Network.requestWillBeSent' && m.params && TIPOS_QUE_ASSENTAM.has(m.params.type)) {
      emVoo.add(m.params.requestId);
      ultimaRede = Date.now();
    } else if ((m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') && m.params &&
      emVoo.has(m.params.requestId)) {
      emVoo.delete(m.params.requestId);
      ultimaRede = Date.now();
    }
    if (m.method === 'Runtime.consoleAPICalled') consoleLista.push(captura.entradaDeConsole(m.params));
    else if (m.method === 'Runtime.exceptionThrown') erros.push(captura.erroDaPagina(m.params));
    else if (m.method === 'Log.entryAdded' && m.params && m.params.entry && m.params.entry.level === 'error') {
      erros.push(captura.erroDoLog(m.params));
    } else if (m.method === 'Network.responseReceived' && navegando && status === null && m.params &&
      m.params.type === 'Document' && m.params.response) {
      status = m.params.response.status;
    } else if (m.method === 'Page.loadEventFired' && navegando) { carregou = true; if (avisarCarga) avisarCarga(); }
  });
  await cdp.enviar('Page.enable', {}, s, 'preparar a aba');
  await cdp.enviar('Runtime.enable', {}, s, 'preparar a aba');
  await cdp.enviar('Log.enable', {}, s, 'preparar a aba');
  await cdp.enviar('Network.enable', {}, s, 'preparar a aba');
  await cdp.enviar('Emulation.setDeviceMetricsOverride',
    { width: o.largura, height: o.altura, deviceScaleFactor: 1, mobile: false }, s, 'ajustar o tamanho da janela');

  const inicio = Date.now();
  const restante = function () { return Math.max(1, o.tempoMax - (Date.now() - inicio)); };
  const maisTempo = 'aumente --tempo-max (hoje ' + o.tempoMax + ' ms)';
  navegando = true;
  const nav = await comPrazo(cdp.enviar('Page.navigate', { url: o.url }, s, 'abrir a pagina'), restante(),
    'a pagina nao respondeu em ' + o.tempoMax + ' ms: confira se o servidor esta no ar, ou ' + maisTempo);
  if (nav.errorText) throw new Error('a pagina nao abriu (' + nav.errorText + '): confira o endereco e se o servidor esta no ar');
  try {
    await comPrazo(new Promise(function (r) { if (carregou) r(); else avisarCarga = r; }), restante(),
      'a pagina nao terminou de carregar em ' + o.tempoMax + ' ms; ' + maisTempo + ' ou espere um seletor com --esperar');
  } catch (e) {
    // o dialogo que o navegador nao deixou fechar segura a carga: mais tempo nao resolve, e o erro diz isso
    if (dialogoPreso) {
      throw new Error('a pagina abriu um dialogo (' + dialogoPreso + ') que o navegador nao fechou, e a carga ' +
        'parou nele; ' + TENTE_DE_NOVO.charAt(0).toLowerCase() + TENTE_DE_NOVO.slice(1));
    }
    throw e;
  }

  if (o.esperar) {
    const expressao = '!!document.querySelector(' + JSON.stringify(o.esperar) + ')';
    for (;;) {
      const r = await comPrazo(cdp.enviar('Runtime.evaluate', { expression: expressao, returnByValue: true }, s,
        'procurar o seletor'), restante(), 'o seletor "' + o.esperar + '" nao apareceu em ' + o.tempoMax + ' ms: confira se ele ' +
        'existe na pagina pronta, ou ' + maisTempo);
      if (r.exceptionDetails) {
        throw new Error('--esperar nao e um seletor CSS valido: "' + o.esperar + '" (exemplos que valem: #app, .pronto, ' +
          'main h1)');
      }
      if (r.result && r.result.value === true) break;
      if (restante() <= 1) {
        throw new Error('o seletor "' + o.esperar + '" nao apareceu em ' + o.tempoMax + ' ms: confira se ele existe ' +
          'na pagina pronta, ou ' + maisTempo);
      }
      await dormir(Math.min(PASSO, restante()));
    }
  }
  // H10-3: a rede assenta (nada em voo por QUIETO ms) ate `teto` ms; passou dele, segue, e quem chama diz quantas
  // ficaram em voo (nunca corta calado). O silencio conta a partir do comeco da espera: o fetch que a pagina dispara
  // logo depois da carga (ou do clique do roteiro) entra nela. Devolve as pendentes e a espera de fato.
  const esperarRede = async function (teto) {
    const comeco = Date.now();
    ultimaRede = comeco;
    while ((emVoo.size > 0 || Date.now() - ultimaRede < QUIETO) && Date.now() < comeco + teto) await dormir(PASSO);
    return { pendentes: emVoo.size, espera: Date.now() - comeco };
  };
  // o --tempo-max quase no fim encurta a espera: so entao mais --tempo-max ajuda (o teto de 5 s e fixo)
  const redeEncurtada = restante() < TETO_DA_REDE;
  const rede = await esperarRede(Math.min(TETO_DA_REDE, restante()));
  const requisicoesPendentes = rede.pendentes;
  // a espera de fato (o --tempo-max quase no fim a encurta), que o aviso cita
  const esperaDaRede = rede.espera;
  // H10c: o roteiro de passos roda na pagina pronta, antes da foto: a foto e a evidencia sao do ponto onde ele parou.
  const rastro = o.roteiro ? await rodarRoteiro(cdp, s, o, { esperarRede,
    dialogos: function () { return dialogos.length + dialogosForaDoTeto; } }) : null;
  // Dois quadros de desenho depois da carga: o que a pagina pinta no primeiro quadro entra na foto.
  await cdp.enviar('Runtime.evaluate', { expression: 'new Promise(function (r) { requestAnimationFrame(function () { ' +
    'requestAnimationFrame(function () { r(true); }); }); })', awaitPromise: true }, s, 'esperar a pagina desenhar');

  const metricas = await cdp.enviar('Page.getLayoutMetrics', {}, s, 'medir a pagina');
  const tamanho = metricas.cssContentSize || metricas.contentSize || {};
  const foto = captura.alturaDaFoto(tamanho.height, o.altura);
  const imagem = await cdp.enviar('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: o.largura, height: foto.altura, scale: 1 } }, s, 'tirar a foto');
  // Sem foto, a captura para aqui, sem esperar as leituras seguintes.
  if (!imagem || typeof imagem.data !== 'string' || !imagem.data) {
    throw new Error('o navegador nao devolveu a foto: a pagina pode ser grande demais; diminua --largura, ou ' +
      TENTE_DE_NOVO.charAt(0).toLowerCase() + TENTE_DE_NOVO.slice(1));
  }
  const arvore = await cdp.enviar('Accessibility.getFullAXTree', {}, s, 'ler a arvore de acessibilidade');
  // O endereco final e a versao vem antes das leituras do estilo e do layout: se uma delas prender a pagina ate o
  // prazo, o resto ja foi lido.
  const local = await cdp.enviar('Runtime.evaluate', { expression: 'location.href', returnByValue: true }, s, 'ler o endereco final');
  const versao = await cdp.enviar('Browser.getVersion', {}, null, 'ler a versao do navegador');
  const { estilo, layout } = await lerEstiloELayout(cdp, s, o.largura);
  return { bytes: Buffer.from(imagem.data, 'base64'), foto, alturaDaPagina: Math.ceil(Number(tamanho.height) || 0),
    console: consoleLista, erros, acessibilidade: captura.resumirAcessibilidade(arvore.nodes), estilo, layout,
    urlFinal: local.result && local.result.value, navegador: versao.product, duracaoMs: Date.now() - inicio, status,
    dialogos, dialogosForaDoTeto, requisicoesPendentes, esperaDaRede, redeEncurtada, rastro };
}

// ---------------------------------------------------------------- H10c: o roteiro de passos (--passos)

// Os objetos que o roteiro pede a pagina ficam neste grupo, que se solta a cada passo.
const GRUPO_DO_ROTEIRO = 'sworn-roteiro';
// A tentativa de um passo que comeca no fim do prazo dele ainda tem este tempo para o navegador responder.
const TENTATIVA_MINIMA = 1000;

// Rodam na pagina (o navegador recebe o texto da funcao). O elemento do ponto do clique e o alvo ou um filho dele (o
// icone dentro do botao): outro, e algo cobre o alvo. O documento so ve o hospedeiro de um shadow root aberto: o
// elemento de verdade e procurado dentro dele, e o parentesco sobe pelo hospedeiro.
function recebeOClique(x, y) {
  var e = document.elementFromPoint(x, y);
  while (e && e.shadowRoot) {
    var dentro = e.shadowRoot.elementFromPoint(x, y);
    if (!dentro || dentro === e) break;
    e = dentro;
  }
  for (var n = e; n; n = n.parentNode || n.host) if (n === this) return true;
  return false;
}
// Foca o campo e seleciona o que ele tinha: o texto digitado entra no lugar (como o fill do Playwright).
function focarESelecionar() {
  this.focus();
  if (typeof this.select === 'function') {
    this.select();
  } else {
    var r = document.createRange();
    r.selectNodeContents(this);
    var s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }
  var a = document.activeElement;
  while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
  for (var n = a; n; n = n.parentNode || n.host) if (n === this) return true;
  return false;
}
// O texto visivel da pagina (o innerText, sem o escondido) tem o texto, com os espacos juntados nos dois lados.
function temOTexto(t) {
  var b = document.body;
  return !!b && b.innerText.replace(/\s+/g, ' ').indexOf(t) !== -1;
}

function semDeNovo(e) { return String(e && e.message ? e.message : e).replace(DE_NOVO, ''); }

// Tenta ate dar certo ou o prazo do passo acabar: a pagina que ainda desenha, navega ou espera a rede tem esse tempo.
// Devolve o resultado da ultima tentativa: sem `motivo`, deu certo.
async function tentarAte(prazo, tentativa) {
  const fim = Date.now() + prazo;
  for (;;) {
    let r;
    try {
      r = await comPrazo(tentativa(), Math.max(fim - Date.now(), TENTATIVA_MINIMA), 'o navegador nao respondeu ao ' +
        'passo dentro do "tempoMax" dele (' + prazo + ' ms): aumente o "tempoMax" do passo');
    } catch (e) { r = { motivo: semDeNovo(e) }; }
    if (!r.motivo || Date.now() >= fim) return r;
    await dormir(Math.min(PASSO, Math.max(1, fim - Date.now())));
  }
}

// Os nos da arvore de acessibilidade com o papel e o nome do passo (exatos, como o Chrome os calcula), sem os ignorados
// (o escondido por display:none ou visibility:hidden).
async function acharNaArvore(cdp, s, passo) {
  const doc = await cdp.enviar('Runtime.evaluate', { expression: 'document', objectGroup: GRUPO_DO_ROTEIRO }, s,
    'procurar o elemento do passo');
  const id = doc.result && doc.result.objectId;
  if (!id) return { motivo: 'a pagina ainda nao tem documento' };
  const pedido = { objectId: id, role: passo.papel };
  if (passo.nome) pedido.accessibleName = passo.nome;
  const r = await cdp.enviar('Accessibility.queryAXTree', pedido, s, 'procurar o elemento do passo');
  return { nos: (r.nodes || []).filter(function (n) { return n && !n.ignored; }) };
}

// O elemento unico (ou o da ordem) do clique ou da digitacao, habilitado e com no na pagina: { no, objeto } ou { motivo }.
async function acharAlvo(cdp, s, passo) {
  const achado = await acharNaArvore(cdp, s, passo);
  if (achado.motivo) return achado;
  const escolha = roteiro.escolherNo(achado.nos, passo);
  if (escolha.motivo) return escolha;
  if (roteiro.desabilitado(escolha.no)) return { motivo: 'o elemento esta desabilitado' };
  const id = escolha.no.backendDOMNodeId;
  if (!id) return { motivo: 'o elemento da arvore nao tem um no na pagina' };
  const r = await cdp.enviar('DOM.resolveNode', { backendNodeId: id, objectGroup: GRUPO_DO_ROTEIRO }, s, 'achar o elemento');
  if (!r.object || !r.object.objectId) return { motivo: 'o elemento da arvore nao tem um no na pagina' };
  return { no: escolha.no, id, objeto: r.object.objectId };
}

// O clique pronto para sair: o elemento rolado ate a janela, o ponto dentro dele e nada por cima. { ponto } ou { motivo }.
async function prepararClique(cdp, s, passo, o) {
  const alvo = await acharAlvo(cdp, s, passo);
  if (alvo.motivo) return alvo;
  await cdp.enviar('DOM.scrollIntoViewIfNeeded', { backendNodeId: alvo.id }, s, 'rolar ate o elemento');
  const caixa = await cdp.enviar('DOM.getContentQuads', { backendNodeId: alvo.id }, s, 'medir o elemento');
  const ponto = roteiro.pontoDoClique(caixa.quads, o.largura, o.altura);
  if (!ponto) return { motivo: 'o elemento nao aparece na janela (nao tem area para o clique)' };
  const recebe = await cdp.enviar('Runtime.callFunctionOn', { objectId: alvo.objeto, functionDeclaration: recebeOClique.toString(),
    arguments: [{ value: ponto.x }, { value: ponto.y }], returnByValue: true }, s, 'conferir o ponto do clique');
  if (!recebe.result || recebe.result.value !== true) {
    return { motivo: 'outro elemento cobre o ponto do clique (um aviso, um menu ou uma camada por cima)' };
  }
  return { ponto };
}

// O campo pronto para receber o texto: editavel, focado e com o que tinha selecionado. {} ou { motivo }.
async function prepararDigitacao(cdp, s, passo) {
  const alvo = await acharAlvo(cdp, s, passo);
  if (alvo.motivo) return alvo;
  if (!roteiro.editavel(alvo.no)) return { motivo: 'o elemento nao e um campo de texto (a arvore nao o marca como editavel)' };
  if (roteiro.soLeitura(alvo.no)) return { motivo: 'o campo e so de leitura' };
  const focou = await cdp.enviar('Runtime.callFunctionOn', { objectId: alvo.objeto,
    functionDeclaration: focarESelecionar.toString(), returnByValue: true }, s, 'focar o campo');
  if (!focou.result || focou.result.value !== true) return { motivo: 'o campo nao recebeu o foco' };
  return {};
}

// O clique de uma pessoa: o mouse chega, aperta e solta no ponto. Sai uma vez so, depois da tentativa que deu certo.
async function clicarNoPonto(cdp, s, p) {
  await cdp.enviar('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y }, s, 'clicar');
  await cdp.enviar('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1,
    clickCount: 1 }, s, 'clicar');
  await cdp.enviar('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0,
    clickCount: 1 }, s, 'clicar');
}

// esperar e conferir: o texto visivel, a presenca do elemento (o da ordem, se pedida) ou o valor dele. {} ou { motivo,
// obtido? }.
async function conferirNaPagina(cdp, s, passo) {
  if (!passo.papel) {
    const t = passo.texto.replace(/\s+/g, ' ').trim();
    const r = await cdp.enviar('Runtime.evaluate', { expression: '(' + temOTexto.toString() + ')(' + JSON.stringify(t) + ')',
      returnByValue: true }, s, 'procurar o texto');
    return r.result && r.result.value === true ? {} : { motivo: 'o texto nao esta no texto visivel da pagina' };
  }
  const achado = await acharNaArvore(cdp, s, passo);
  if (achado.motivo) return achado;
  if (passo.valor === undefined) {
    return achado.nos.length >= (passo.ordem || 1) ? {} : { motivo: roteiro.escolherNo(achado.nos, passo).motivo };
  }
  const escolha = roteiro.escolherNo(achado.nos, passo);
  if (escolha.motivo) return escolha;
  const obtido = roteiro.valorDoNo(escolha.no);
  return obtido === passo.valor ? {} : { motivo: 'o valor do elemento nao e o esperado', obtido };
}

// Roda os passos na ordem e devolve o rastro, um item por passo que rodou. Clicar, digitar e esperar que falham param
// o roteiro; a conferencia que falha fica no rastro e o roteiro segue. Depois de cada acao, a rede assenta (como depois
// da carga). `ctx`: { esperarRede(teto), dialogos() -> quantos a pagina ja abriu }.
async function rodarRoteiro(cdp, s, o, ctx) {
  const rastro = [];
  for (let i = 0; i < o.roteiro.passos.length; i++) {
    const passo = o.roteiro.passos[i];
    const inicio = Date.now();
    const dialogosAntes = ctx.dialogos();
    let r;
    if (passo.acao === 'clicar' || passo.acao === 'digitar') {
      r = await tentarAte(passo.tempoMax, function () {
        return passo.acao === 'clicar' ? prepararClique(cdp, s, passo, o) : prepararDigitacao(cdp, s, passo);
      });
      if (!r.motivo) {
        try {
          if (passo.acao === 'clicar') await clicarNoPonto(cdp, s, r.ponto);
          else await cdp.enviar('Input.insertText', { text: passo.texto }, s, 'digitar o texto');
          r = {};
          const rede = await ctx.esperarRede(TETO_DA_REDE);
          if (rede.pendentes) r.requisicoesPendentes = rede.pendentes;
        } catch (e) { r = { motivo: semDeNovo(e) }; }
      }
    } else {
      r = await tentarAte(passo.tempoMax, function () { return conferirNaPagina(cdp, s, passo); });
    }
    try { await cdp.enviar('Runtime.releaseObjectGroup', { objectGroup: GRUPO_DO_ROTEIRO }, s, 'soltar os objetos do passo'); }
    catch (e) { /* a pagina que navegou ja soltou os dela */ }
    const item = Object.assign({ n: i + 1 }, passo, { ok: !r.motivo, ms: Date.now() - inicio });
    if (r.motivo) item.motivo = r.motivo;
    if (r.obtido !== undefined) item.obtido = r.obtido;
    if (passo.acao === 'digitar') item.caracteres = Array.from(passo.texto).length;
    if (r.requisicoesPendentes) item.requisicoesPendentes = r.requisicoesPendentes;
    const novos = ctx.dialogos() - dialogosAntes;
    if (novos) item.dialogos = novos;
    rastro.push(item);
    if (r.motivo && passo.acao !== 'conferir') break;
  }
  return rastro;
}

// Roda uma expressao de leitura na pagina: { valor } (o que ela devolveu), ou { motivo } de nao ter lido.
async function lerNaPagina(cdp, s, expressao, passo) {
  try {
    // O enviar sempre resolve com um objeto (o `result` do protocolo, ou {}).
    const lido = await cdp.enviar('Runtime.evaluate', { expression: expressao, returnByValue: true }, s, passo);
    if (lido.exceptionDetails) {
      const d = lido.exceptionDetails;
      const texto = String((d.exception && d.exception.description) || d.text || '').split('\n')[0];
      return { motivo: 'a pagina lancou um erro durante a leitura' + (texto ? ' (' + captura.textoParaODisco(texto) + ')' : '') };
    }
    if (!lido.result) return { motivo: 'o navegador respondeu sem o resultado da leitura' };
    return { valor: lido.result.value };
  } catch (e) {
    // Sem o "rode de novo" (DE_NOVO) que o enviar poe no fim de todo erro dele: ele vale para a captura inteira, e aqui
    // a foto ja esta tirada.
    return { motivo: captura.textoParaODisco(String(e.message).replace(DE_NOVO, '')) };
  }
}

const SEM_CORPO = 'a pagina nao e um documento HTML com corpo (um arquivo SVG aberto direto, por exemplo)';
const ILEGIVEL = 'o navegador devolveu a leitura num formato que a captura nao entende';
// O comeco da mensagem do enviar quando o prazo de um comando passa.
const SEM_RESPOSTA = 'o navegador nao respondeu';

// E3 item 2: o estilo calculado do que se ve (a camada 2 da conferencia de design). Uma pagina que derruba a leitura
// nao derruba a foto: o estilo sai vazio, com o motivo em `erro` (a pagina lancou um erro, o navegador recusou o
// pedido ou nao respondeu no prazo, a resposta veio sem resultado ou num formato que a captura nao entende, ou o
// documento nao tem corpo HTML).
async function lerEstilo(cdp, s) {
  const lido = await lerNaPagina(cdp, s, captura.EXPRESSAO_DO_ESTILO, 'ler o estilo calculado');
  let motivo = lido.motivo || null;
  let estilo = null;
  if (!motivo) {
    estilo = captura.resumirEstilo(lido.valor);
    if (estilo.semCorpo) motivo = SEM_CORPO;
    else if (estilo.ilegivel) motivo = ILEGIVEL;
  }
  if (!motivo) return estilo;
  return { ...(estilo || captura.resumirEstilo(null)), erro: 'nao deu para ler as cores, fontes, tamanhos e cantos ' +
    'arredondados da tela: ' + motivo + '. A foto e o resto da evidencia foram gravados, mas a conferencia desses ' +
    'valores nao aconteceu: confira-os na foto, a olho' };
}

// R2b: as medidas do layout (rolagem lateral, tamanho do h1, do h2 e do corpo, a coluna do conteudo, os blocos lado a
// lado), que a conferencia compara com a referencia largura por largura. Como no estilo, a leitura que falha nao
// derruba a foto: o layout sai com o motivo em `erro`, e a conferencia conta esta largura como nao comparada. Se o
// navegador ja nao respondeu a leitura do estilo, a medida nem e pedida: seria mais um prazo inteiro de espera.
async function lerLayout(cdp, s, largura, estilo) {
  let motivo = null;
  let lido = {};
  if (estilo && typeof estilo.erro === 'string' && estilo.erro.includes(': ' + SEM_RESPOSTA)) {
    motivo = SEM_RESPOSTA + ' a leitura do estilo, e a medida do layout nem foi pedida';
  } else {
    lido = await lerNaPagina(cdp, s, captura.EXPRESSAO_DO_LAYOUT, 'medir o layout');
    motivo = lido.motivo || null;
  }
  let layout = null;
  if (!motivo) {
    layout = captura.resumirLayout(lido.valor);
    if (layout.semCorpo) motivo = SEM_CORPO;
    else if (layout.ilegivel) motivo = ILEGIVEL;
  }
  if (!motivo) return layout;
  return { ...(layout || { ilegivel: true }), erro: 'nao deu para medir o layout: ' + motivo + '. A foto e o ' +
    'resto da evidencia foram gravados, mas a conferencia com a referencia nao compara a largura de ' + largura +
    ' px: confira o layout na foto, a olho, ou resolva o motivo e capture de novo' };
}

// As duas leituras depois da foto, na ordem: o estilo e, com ele, o layout (que nao e pedido se o estilo ficou sem
// resposta).
async function lerEstiloELayout(cdp, s, largura) {
  const estilo = await lerEstilo(cdp, s);
  return { estilo, layout: await lerLayout(cdp, s, largura, estilo) };
}

// Com .claude/sworn/design.json no projeto (a pasta onde a captura roda), a conferencia do estilo calculado contra o
// sistema, que vai para a evidencia no campo `estiloForaDoSistema` (o nome que o GUIA documenta): { ok, fora,
// naoLidos, conferidos, feita, arquivo }; sem o design.json, null. `fora` e a lista do que ficou fora do sistema e
// `conferidos` quantos valores foram comparados. Com o estilo sem ler, `feita: false` e `ok: false` (a lista vazia nao
// quer dizer "tudo dentro do sistema").
// `arquivoDado` (o --arquivo) diz qual arquivo desenha a tela, para os desvios dele valerem; sem ele, ou com a propria
// pasta do projeto, nenhum desvio se aplica (arquivo: null). Relativo ou absoluto, com barra normal ou invertida, ele
// vira o caminho a partir da pasta do projeto, com barras normais, que e como o desvio casa. Um caminho fora do
// projeto (acima dele, em outro disco, ou com letra de disco fora do Windows) nao casa desvio nenhum e nao vai para a
// evidencia: so `arquivoForaDoProjeto: true`, para o caminho pessoal (a pasta do usuario) nao ir para o disco.
function conferenciaDoEstilo(estilo, arquivoDado) {
  const raiz = process.cwd();
  const sistema = config.carregarDesign(raiz);
  if (!sistema) return null;
  let arquivo = null;
  let foraDoProjeto = false;
  if (arquivoDado) {
    const dado = arquivoDado.replace(/\\/g, '/');
    if (path.sep === '/' && /^[A-Za-z]:/.test(dado)) {
      foraDoProjeto = true;
    } else {
      const relativo = path.relative(raiz, path.resolve(raiz, dado));
      const sobe = relativo === '..' || relativo.startsWith('..' + path.sep);
      if (sobe || path.isAbsolute(relativo)) foraDoProjeto = true;
      else if (relativo) arquivo = relativo.split(path.sep).join('/');
    }
  }
  const r = { ...design.conferirComputado(estilo, sistema, arquivo), feita: !estilo.erro, arquivo };
  if (!r.feita) r.ok = false;
  if (foraDoProjeto) r.arquivoForaDoProjeto = true;
  return r;
}

// O aviso da saida sobre a conferencia do estilo: onde esta a lista e o que fazer com ela, e o --arquivo que nao valeu.
function avisoDoEstilo(conferencia, arquivoDado) {
  const avisos = [];
  if (!conferencia) {
    return 'sem .claude/sworn/design.json na pasta onde a captura roda, o estilo foi gravado sem conferir' +
      (arquivoDado ? ' e o --arquivo nao foi usado' : '') + ': rode a captura da raiz do projeto (a pasta do ' +
      '.claude/sworn/design.json), ou crie o sistema de design com o /sworn:init';
  }
  if (conferencia.arquivoForaDoProjeto) {
    avisos.push('o --arquivo fica fora da pasta do projeto, e os desvios dele nao valeram: se o arquivo e do projeto, ' +
      'rode a captura da raiz do projeto e passe o caminho a partir dela; um arquivo fora do projeto nao tem desvio');
  }
  if (conferencia.feita && conferencia.fora.length) {
    avisos.push(conferencia.fora.length + ' valor(es) fora do sistema de design, listados em estiloForaDoSistema.fora ' +
      'do evidencia.json: troque cada um por um valor do .claude/sworn/design.json, ou peca ao dono que declare um ' +
      'desvio para esta tela em "desvios" do design.json' +
      (arquivoDado ? '' : ' e rode de novo com --arquivo <o arquivo que desenha a tela>: sem ele, so o sistema vale'));
  }
  return avisos.join('; ');
}

// Grava tela.png e evidencia.json na pasta de saida e devolve a linha que o script imprime. A evidencia leva sempre o
// estilo e o layout lidos e, se veio, a `conferencia` (a conferenciaDoEstilo, feita antes por quem chama).
function gravarEvidencia(dados, o, saida, conferencia) {
  const caminhoDaImagem = path.join(saida, 'tela.png');
  fs.writeFileSync(caminhoDaImagem, dados.bytes);
  const sha256 = crypto.createHash('sha256').update(dados.bytes).digest('hex');
  // O token de uma URL nao vai para o disco: nem no endereco, nem no console, nem na pilha dos erros, nem nos nomes da
  // arvore de acessibilidade.
  const limpos = captura.consoleEErrosSemSegredo(dados.console, dados.erros);
  const acessibilidade = { itens: dados.acessibilidade.itens.map(function (i) {
    return { papel: i.papel, nome: captura.textoParaODisco(i.nome) };
  }), cortada: dados.acessibilidade.cortada };
  const dialogos = dados.dialogos.map(function (d) {
    return { tipo: d.tipo, mensagem: captura.textoParaODisco(d.mensagem) };
  });
  const evidencia = {
    textoDaPagina: captura.TEXTO_DA_PAGINA, // H10-1: o aviso antes do texto da pagina
    url: captura.semSegredo(o.url), urlFinal: dados.urlFinal ? captura.semSegredo(dados.urlFinal) : null,
    status: dados.status, hora: new Date().toISOString(), navegador: dados.navegador,
    largura: o.largura, altura: dados.foto.altura, alturaDaPagina: dados.alturaDaPagina, cortada: dados.foto.cortada,
    imagem: 'tela.png', sha256, console: limpos.console, erros: limpos.erros, acessibilidade,
    duracaoMs: dados.duracaoMs, estilo: dados.estilo, layout: dados.layout, dialogos,
  };
  if (dados.dialogosForaDoTeto > 0) evidencia.dialogosForaDoTeto = dados.dialogosForaDoTeto;
  if (dados.requisicoesPendentes > 0) evidencia.requisicoesPendentes = dados.requisicoesPendentes;
  // H10c: o rastro do roteiro e a soma dele; o hash diz qual roteiro rodou
  const resumo = dados.rastro ? roteiro.somarPassos(dados.rastro, o.roteiro.passos.length) : null;
  if (resumo) evidencia.roteiro = { sha256: o.roteiro.sha256, resumo, passos: roteiro.rastroParaODisco(dados.rastro) };
  if (conferencia) evidencia.estiloForaDoSistema = conferencia;
  const caminhoDaEvidencia = path.join(saida, 'evidencia.json');
  fs.writeFileSync(caminhoDaEvidencia, JSON.stringify(evidencia, null, 2) + '\n');
  const fim = { ok: true, imagem: caminhoDaImagem, evidencia: caminhoDaEvidencia, sha256, status: dados.status,
    console: dados.console.length, erros: dados.erros.length, cortada: dados.foto.cortada };
  // So a contagem: a lista inteira esta em evidencia.estiloForaDoSistema.fora. Com o estilo sem ler, o zero diria
  // "tudo dentro do sistema": a saida leva o motivo no lugar dele.
  if (dados.estilo.erro) fim.estiloNaoLido = dados.estilo.erro;
  else if (conferencia) fim.valoresForaDoSistema = conferencia.fora.length;
  if (dados.layout.erro) fim.layoutNaoLido = dados.layout.erro;
  const aviso = avisoDoEstilo(conferencia, o.arquivo);
  if (aviso) fim.avisoDoEstilo = aviso;
  if (dados.status >= 400) {
    fim.aviso = 'o servidor respondeu ' + dados.status + ': a foto e da pagina de erro; confira o endereco (ou o login, ' +
      'se a pagina pede um) e capture de novo';
  }
  const quantosDialogos = dialogos.length + (dados.dialogosForaDoTeto || 0);
  if (quantosDialogos) {
    fim.dialogosCancelados = quantosDialogos;
    fim.aviso = captura.juntarAvisos(fim.aviso, 'a pagina abriu ' + quantosDialogos + ' dialogo(s) (alert, confirm, ' +
      'prompt) e a captura respondeu "cancelar" a cada um: a foto mostra a pagina depois disso; o texto deles esta em ' +
      'evidencia.json');
  }
  if (dados.requisicoesPendentes > 0) {
    fim.aviso = captura.juntarAvisos(fim.aviso, 'a pagina ainda carregava ' + dados.requisicoesPendentes +
      ' recurso(s) depois de ' + (Math.round((dados.esperaDaRede || 0) / 100) / 10) + ' s de espera: a foto pode ter ' +
      'saido antes do conteudo; ' + (dados.redeEncurtada
        ? 'o --tempo-max acabou antes da espera da rede: aumente --tempo-max'
        : 'a espera da rede vai ate ' + (TETO_DA_REDE / 1000) + ' s; espere o que falta com --esperar <seletor>'));
  }
  if (resumo) {
    // o roteiro que parou ou a conferencia que falhou: ok false, e a saida sai 1 (saidaDoScript)
    fim.ok = resumo.ok;
    fim.passos = resumo;
    const avisoDosPassos = roteiro.avisoDoRoteiro(resumo, dados.rastro);
    if (avisoDosPassos) fim.aviso = captura.juntarAvisos(fim.aviso, avisoDosPassos);
  }
  return fim;
}

// Fecha o navegador e todos os processos dele. No Windows, a arvore inteira cai pelo taskkill enquanto o navegador
// ainda esta vivo: fechado pelo protocolo, o processo de relatorio de falhas (crashpad) sobrevive ao pai e segura o
// perfil por segundos (medido sob a suite inteira), e child.kill() mataria so o pai. Sob carga o taskkill leva mais
// que 5 s para descer a arvore: o prazo dele e o do comando. Fora do Windows, fecha pelo protocolo e, se nao fechar
// no prazo, mata. Primeiro os filhos listados pelo proprio navegador, depois o navegador (fecharNavegador).
async function matarFilhosEFecharNavegador(cdp, filho, saiu) {
  // Os processos filhos que o proprio navegador diz que sao dele caem primeiro, pelo numero, enquanto ainda sao dele
  // (acabaram de ser listados): o taskkill da arvore deixava orfaos sob a suite inteira (medido). Depois cai o pai.
  if (cdp) {
    try {
      const info = await cdp.enviar('SystemInfo.getProcessInfo', {}, null, 'listar os processos do navegador');
      for (const p of info.processInfo || []) {
        // So numero positivo: 0 ou negativo no kill sinaliza um grupo de processos inteiro.
        if (Number.isInteger(p.id) && p.id > 0 && p.id !== filho.pid) { try { process.kill(p.id); } catch (e) { /* ja saiu */ } }
      }
    } catch (e) { /* sem a lista, fica o taskkill e o kill do pai */ }
  }
  await fecharNavegador(cdp, filho, saiu);
}

// No Windows, a arvore pelo taskkill; fora dele, pelo protocolo e, sem saida no prazo, o kill do pai.
async function fecharNavegador(cdp, filho, saiu) {
  if (process.platform === 'win32' && filho.pid && !saiu()) {
    if (cdp) cdp.fechar();
    spawnSync('taskkill', ['/PID', String(filho.pid), '/T', '/F'],
      { stdio: 'ignore', windowsHide: true, timeout: PRAZO_DO_COMANDO });
  } else if (cdp) {
    try { await cdp.enviar('Browser.close', {}, null, 'fechar o navegador'); } catch (e) { /* segue para o kill */ }
    cdp.fechar();
  }
  await esperarSaida(saiu);
  if (saiu() || !filho.pid) return;
  try { filho.kill('SIGKILL'); } catch (e) { /* ja saiu */ }
  await esperarSaida(saiu);
}

async function esperarSaida(saiu) {
  const fim = Date.now() + PRAZO_DO_FECHO;
  while (!saiu() && Date.now() < fim) await dormir(PASSO);
}

const PRAZO_DO_PERFIL = 30000;
const PRAZO_DA_LIMPEZA = 300000;
// Mata, no Windows, quem cita o perfil na linha de comando. O caminho e o que este script criou; a comparacao e exata
// (Contains), sem curinga, e o PowerShell e o Node que fazem a limpeza ficam de fora.
function matarOrfaosDoPerfil(perfil) {
  if (process.platform !== 'win32') return;
  const exato = perfil.replace(/'/g, "''");
  spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -ne 'powershell.exe' -and $_.Name -ne 'node.exe' -and " +
    "$_.CommandLine -and $_.CommandLine.Contains('" + exato + "') } | " +
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'],
  { stdio: 'ignore', windowsHide: true, timeout: PRAZO_DO_COMANDO });
}

// O perfil temporario e nosso. O rmSync tenta de novo sozinho: no Windows o navegador (e o processo de relatorio de
// falhas dele, que sai um pouco depois) solta os arquivos com atraso. A espera cresce 100 ms a cada tentativa: 10
// tentativas somam 5,5 s. Se ainda assim o perfil estiver preso no Windows, sobrou processo que o cita na linha de
// comando (o de relatorio de falhas, que nao entra na lista do navegador): ele cai, e o apagar tenta de novo a cada
// 1 s, ate o prazo. Devolve null se apagou, ou a causa. A limpeza em segundo plano (--limpar-perfil) usa a mesma
// funcao, com prazo maior.
async function apagarPerfil(perfil, prazo) {
  const fim = Date.now() + prazo;
  let matou = false;
  for (;;) {
    try { apagarPasta(perfil, { maxRetries: 10, retryDelay: 100 }); return null; } catch (e) {
      if (Date.now() >= fim) return e.code || e.message;
    }
    if (!matou) { matarOrfaosDoPerfil(perfil); matou = true; }
    await dormir(1000);
  }
}

// Perfil ainda preso depois de 30 s (sob carga pesada, medido na suite inteira): este mesmo script, solto e sem
// segurar a saida, termina a limpeza em ate 5 minutos. A captura termina na hora.
function agendarLimpeza(perfil) {
  const limpeza = spawn(process.execPath, [__filename, '--limpar-perfil', perfil],
    { detached: true, stdio: 'ignore', windowsHide: true });
  limpeza.unref();
}

// A pasta temporaria, pelo caminho longo: o navegador nao grava num perfil dado pelo nome curto do Windows (o de 8
// letras com til, que a pasta temporaria do usuario costuma ter). SWORN_TMP manda sobre a do sistema.
function pastaTemporaria() {
  const pedida = process.env.SWORN_TMP || os.tmpdir();
  try { return { base: fs.realpathSync.native(pedida) }; } catch (e) {
    return { erro: 'a pasta temporaria "' + pedida + '" nao existe (' + e.code + ')' + (process.env.SWORN_TMP ?
      ': corrija SWORN_TMP ou apague a variavel' : '') };
  }
}

// Modo interno da limpeza em segundo plano (agendarLimpeza): so apaga um perfil desta captura, com nome
// sworn-captura-* direto dentro da pasta temporaria. No Windows o caminho nao diferencia maiuscula.
async function limparPerfilEmSegundoPlano(alvo) {
  const pasta = pastaTemporaria();
  if (pasta.erro) return { erro: pasta.erro };
  const dentro = path.dirname(path.resolve(alvo || '.'));
  const mesmo = process.platform === 'win32' ? dentro.toLowerCase() === pasta.base.toLowerCase() : dentro === pasta.base;
  if (!path.basename(alvo || '').startsWith('sworn-captura-') || !mesmo) {
    return { erro: '--limpar-perfil so apaga um perfil sworn-captura- da pasta temporaria (' + pasta.base + '). E um ' +
      'modo interno, que a propria captura usa: para tirar uma foto, rode com --url e --saida' };
  }
  const causa = await apagarPerfil(alvo, PRAZO_DA_LIMPEZA);
  return causa ? { erro: 'a pasta temporaria ' + alvo + ' segue presa (' + causa + '); feche o navegador que a usa ' +
    'e apague a pasta a mao' } : { ok: true, apagado: alvo };
}

async function main() {
  if (process.argv[2] === '--limpar-perfil') return limparPerfilEmSegundoPlano(process.argv[3]);
  const lido = captura.lerArgs(process.argv.slice(2));
  if (lido.erro) return { erro: lido.erro };
  const o = lido.opcoes;
  // H10c: o roteiro errado para aqui, antes de abrir o navegador
  if (o.passos) {
    const lidoRoteiro = roteiro.lerArquivoDoRoteiro(o.passos);
    if (lidoRoteiro.erro) return { erro: lidoRoteiro.erro };
    o.roteiro = lidoRoteiro;
  }
  if (typeof WebSocket !== 'function') {
    return { erro: 'a captura precisa do Node 22 ou mais novo (este e o ' + process.version + '): atualize o Node' };
  }
  const existe = function (p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };
  const navegador = captura.acharNavegador(captura.candidatosDoNavegador(process.platform, process.env), existe);
  if (!navegador && process.env.SWORN_NAVEGADOR) {
    return { erro: 'SWORN_NAVEGADOR aponta para "' + process.env.SWORN_NAVEGADOR + '", que nao existe. Corrija o ' +
      'caminho ou apague a variavel para o sworn procurar o Chrome ou o Edge.' };
  }
  if (!navegador) {
    return { erro: 'nenhum Chrome ou Edge achado. Instale um deles, ou aponte SWORN_NAVEGADOR para o executavel.' };
  }
  const saida = path.resolve(o.saida);
  try { fs.mkdirSync(saida, { recursive: true }); } catch (e) {
    return { erro: '--saida nao pode ser usada como pasta: "' + saida + '" (' + e.code + '); aponte para uma pasta nova ' +
      'ou que ja exista' };
  }
  const pasta = pastaTemporaria();
  if (pasta.erro) return { erro: pasta.erro };
  const perfil = fs.mkdtempSync(path.join(pasta.base, 'sworn-captura-'));
  const filho = spawn(navegador, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + perfil,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--mute-audio',
    'about:blank'], { stdio: 'ignore', windowsHide: true });
  let saiu = false;
  let erroAoAbrir = null;
  filho.on('exit', function () { saiu = true; });
  filho.on('error', function (e) { erroAoAbrir = e; saiu = true; });
  let cdp = null;
  let resultado = { erro: 'a captura parou sem resultado. ' + TENTE_DE_NOVO };
  try {
    const endereco = await esperarEndereco(perfil, function () { return saiu; });
    cdp = await comPrazo(conectar(endereco), PRAZO_DA_PORTA, 'nao deu para falar com o navegador em ' +
      PRAZO_DA_PORTA / 1000 + ' s. ' + TENTE_DE_NOVO);
    const dados = await fotografar(cdp, o);
    resultado = gravarEvidencia(dados, o, saida, conferenciaDoEstilo(dados.estilo, o.arquivo));
  } catch (e) {
    resultado = { erro: erroAoAbrir ? 'o navegador nao abriu (' + navegador + '): ' + erroAoAbrir.message + '. Confira se ' +
      'ele abre a mao, ou aponte SWORN_NAVEGADOR para outro Chrome ou Edge' : e.message };
  }
  try { await matarFilhosEFecharNavegador(cdp, filho, function () { return saiu; }); } catch (e) {
    resultado.aviso = captura.juntarAvisos(resultado.aviso, 'o navegador pode ter ficado aberto (' + e.message + '); ' +
      'feche-o pelo gerenciador de tarefas se ele aparecer');
  }
  const causa = await apagarPerfil(perfil, PRAZO_DO_PERFIL);
  if (causa) {
    agendarLimpeza(perfil);
    resultado.aviso = captura.juntarAvisos(resultado.aviso, 'a pasta temporaria do navegador em ' + perfil +
      ' ainda estava presa (' + causa + '); ela e apagada em segundo plano nos proximos minutos, sem nada a fazer');
  }
  return resultado;
}

// O teste carrega o arquivo para ler o aviso sem abrir o navegador: so a linha de comando roda o main.
if (require.main === module) {
  main().then(function (r) {
    const saida = captura.saidaDoScript(r);
    process.stdout.write(saida.texto);
    process.exitCode = saida.codigo;
  }, function (e) {
    process.stdout.write('ERRO: ' + (e && e.message ? e.message : String(e)) + '\n');
    process.exitCode = 1;
  });
}

module.exports = { avisoDoEstilo, conferenciaDoEstilo, lerEstiloELayout, conectar };
