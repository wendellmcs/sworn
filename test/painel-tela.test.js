'use strict';
// A tela do prototipo do painel (painel/prototipo/painel.js) sem navegador: a pagina de verdade (index.html) vira uma
// arvore de mentira, so com o que o painel usa, e as APIs do navegador viram duplas que o teste controla (fetch,
// EventSource, Notification, o relogio). O navegador de verdade fica com o roteiro do capturar-tela; aqui ficam os
// caminhos que ele nao alcanca: a API que falta num navegador velho, o evento quebrado, a reconexao e a recusa rara.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROTOTIPO = path.join(__dirname, '..', 'painel', 'prototipo');
const HTML = fs.readFileSync(path.join(PROTOTIPO, 'index.html'), 'utf8');
const SIMULADO = fs.readFileSync(path.join(PROTOTIPO, 'simulado.json'), 'utf8');
const CODIGO = ['estado.js', 'painel.js'].map(function (nome) {
  return new vm.Script(fs.readFileSync(path.join(PROTOTIPO, nome), 'utf8'), { filename: nome });
});

// ---- a arvore de mentira ----
const VAZIOS = new Set(['meta', 'link', 'br', 'img', 'input', 'hr', 'rect', 'path', 'circle']);
// So os eventos que sobem pela arvore no navegador sobem aqui: 'close' e 'toggle' ficam no elemento.
const SOBEM = new Set(['click', 'input', 'keydown', 'submit']);

function camelo(nome) { return nome.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); }); }

class No {
  constructor(doc, tag, texto) {
    this.ownerDocument = doc;
    this.nodeType = tag === '#text' ? 3 : 1;
    this.tagName = tag.toUpperCase();
    this.dados = texto || '';
    this.childNodes = [];
    this.parentNode = null;
    this.atributos = new Map();
    this.dataset = {};
    this.ouvintes = new Map();
    this.value = '';
    this.open = false;
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.clientHeight = 0;
    this.maxLength = -1;
  }

  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(v) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
  get children() { return this.childNodes.filter(function (n) { return n.nodeType === 1; }); }
  get childElementCount() { return this.children.length; }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n === this.ownerDocument.documentElement;
  }
  get textContent() {
    return this.nodeType === 3 ? this.dados : this.childNodes.map(function (n) { return n.textContent; }).join('');
  }
  set textContent(v) {
    if (this.nodeType === 3) { this.dados = String(v); return; }
    this.soltarFilhos();
    const t = v === null || v === undefined ? '' : String(v);
    if (t) this.appendChild(new No(this.ownerDocument, '#text', t));
  }

  getAttribute(nome) {
    if (nome.startsWith('data-')) {
      const c = camelo(nome.slice(5));
      return Object.prototype.hasOwnProperty.call(this.dataset, c) ? String(this.dataset[c]) : null;
    }
    return this.atributos.has(nome) ? this.atributos.get(nome) : null;
  }
  setAttribute(nome, v) {
    if (nome.startsWith('data-')) this.dataset[camelo(nome.slice(5))] = String(v);
    else this.atributos.set(nome, String(v));
  }
  removeAttribute(nome) {
    if (nome.startsWith('data-')) delete this.dataset[camelo(nome.slice(5))];
    else this.atributos.delete(nome);
  }
  hasAttribute(nome) { return this.getAttribute(nome) !== null; }

  appendChild(n) {
    if (n.parentNode) n.remove();
    n.parentNode = this;
    this.childNodes.push(n);
    return n;
  }
  append() {
    for (const n of arguments) this.appendChild(typeof n === 'string' ? new No(this.ownerDocument, '#text', n) : n);
  }
  replaceChildren() {
    this.soltarFilhos();
    this.append.apply(this, arguments);
  }
  soltarFilhos() {
    for (const n of this.childNodes) n.parentNode = null;
    this.childNodes = [];
  }
  remove() {
    const pai = this.parentNode;
    if (!pai) return;
    const eu = this;
    pai.childNodes = pai.childNodes.filter(function (n) { return n !== eu; });
    this.parentNode = null;
  }

  addEventListener(tipo, fn) {
    if (!this.ouvintes.has(tipo)) this.ouvintes.set(tipo, []);
    this.ouvintes.get(tipo).push(fn);
  }
  removeEventListener(tipo, fn) {
    const lista = this.ouvintes.get(tipo) || [];
    this.ouvintes.set(tipo, lista.filter(function (f) { return f !== fn; }));
  }
  // Os ouvintes rodam como no navegador, menos num ponto: o erro de um ouvinte sobe para o teste, que o ve. Como no
  // navegador, o stopPropagation deixa rodar os outros ouvintes do mesmo elemento e para a subida no seguinte.
  disparar(tipo, extra) {
    let parou = false;
    const e = Object.assign({
      type: tipo, target: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { parou = true; },
    }, extra);
    for (let n = this; n && !parou; n = SOBEM.has(tipo) ? n.parentNode : null) {
      for (const fn of (n.ouvintes.get(tipo) || []).slice()) fn.call(n, e);
    }
    return e;
  }

  focus() { this.ownerDocument.activeElement = this; }
  click() { if (!this.disabled) this.disparar('click'); }
  showModal() { this.open = true; }
  close() {
    if (!this.open) return;
    this.open = false;
    this.disparar('close');
  }
  requestSubmit() { this.disparar('submit'); }
  getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  scrollIntoView() {}

  matches(seletor) { return casa(this, seletor); }
  closest(seletor) {
    for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (casa(n, seletor)) return n;
    return null;
  }
  querySelectorAll(seletor) {
    const achados = [];
    varrer(this, function (n) { if (casa(n, seletor)) achados.push(n); });
    return achados;
  }
  querySelector(seletor) { return this.querySelectorAll(seletor)[0] || null; }
}

function varrer(no, fn) {
  for (const n of no.childNodes) {
    if (n.nodeType !== 1) continue;
    fn(n);
    varrer(n, fn);
  }
}

// So o seletor simples composto (tag, .classe, #id, [atributo], [atributo="v"], [atributo^="v"]): o que o painel usa.
// O resto falha alto, para o teste nao passar por um seletor que a arvore de mentira nao entende.
const PECA = /([a-z][\w-]*)|\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:(\^?=)"([^"]*)")?\]/gy;
function casa(n, seletor) {
  PECA.lastIndex = 0;
  let lido = 0;
  let ok = true;
  let m;
  while ((m = PECA.exec(seletor)) !== null) {
    lido = PECA.lastIndex;
    if (m[1] !== undefined) ok = ok && n.tagName === m[1].toUpperCase();
    else if (m[2] !== undefined) ok = ok && n.className.split(/\s+/).includes(m[2]);
    else if (m[3] !== undefined) ok = ok && n.id === m[3];
    else {
      const v = n.getAttribute(m[4]);
      if (m[5] === undefined) ok = ok && v !== null;
      else if (m[5] === '=') ok = ok && v === m[6];
      else ok = ok && v !== null && v.startsWith(m[6]);
    }
  }
  if (lido !== seletor.length || lido === 0) throw new Error('seletor fora da arvore de mentira: ' + seletor);
  return ok;
}

// A pagina de verdade, sem os scripts (o teste roda os dois arquivos) e sem os comentarios.
function montarArvore(doc) {
  const limpo = HTML.replace(/<!--[\s\S]*?-->/g, '').replace(/<!doctype[^>]*>/i, '')
    .replace(/<(script|noscript)\b[\s\S]*?<\/\1>/gi, '');
  const pilha = [];
  let raiz = null;
  // O valor entre aspas pode ter ">" dentro; o atributo vem com aspas duplas, simples ou sem aspas, como no navegador.
  for (const m of limpo.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g)) {
    const atual = pilha[pilha.length - 1];
    if (m[4] !== undefined) {
      if (atual && m[4].trim()) atual.appendChild(new No(doc, '#text', m[4].replace(/\s+/g, ' ')));
      continue;
    }
    const tag = m[2].toLowerCase();
    if (m[1]) {
      // Fecha ate a tag do mesmo nome, inclusive: a que ficou aberta dentro dela fecha junto. A que fecha sem ter
      // aberto reprova alto, como o seletor desconhecido: esvaziar a pilha calado jogaria fora o resto da pagina.
      if (!pilha.some(function (n) { return n.tagName === tag.toUpperCase(); })) {
        throw new Error('a arvore de mentira achou </' + tag + '> sem a tag que abre');
      }
      let fechada;
      do { fechada = pilha.pop(); } while (fechada.tagName !== tag.toUpperCase());
      continue;
    }
    const n = new No(doc, tag);
    for (const a of m[3].matchAll(/([^\s=/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      const valor = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4];
      n.setAttribute(a[1], valor === undefined ? '' : valor);
    }
    if (!raiz) raiz = n;
    else if (atual) atual.appendChild(n);
    if (!VAZIOS.has(tag) && !m[3].trim().endsWith('/')) pilha.push(n);
  }
  return raiz;
}

function criarDocumento() {
  const doc = { focado: true };
  doc.documentElement = montarArvore(doc);
  doc.body = doc.documentElement.querySelector('body');
  doc.activeElement = doc.body;
  doc.createElement = function (tag) { return new No(doc, tag); };
  doc.createElementNS = function (ns, tag) { return new No(doc, tag); };
  doc.createTextNode = function (t) { return new No(doc, '#text', t); };
  doc.getElementById = function (id) { return doc.documentElement.querySelector('#' + id); };
  doc.querySelector = function (s) { return doc.documentElement.querySelector(s); };
  doc.querySelectorAll = function (s) { return doc.documentElement.querySelectorAll(s); };
  doc.hasFocus = function () { return doc.focado; };
  // A aba visivel ou escondida: o teste troca o visibilityState e dispara o visibilitychange.
  doc.visibilityState = 'visible';
  const ouvintesDoDoc = new Map();
  doc.addEventListener = function (tipo, fn) {
    if (!ouvintesDoDoc.has(tipo)) ouvintesDoDoc.set(tipo, []);
    ouvintesDoDoc.get(tipo).push(fn);
  };
  doc.disparar = function (tipo) { for (const fn of ouvintesDoDoc.get(tipo) || []) fn.call(doc, { type: tipo }); };
  return doc;
}

// A resposta do fetch de mentira, com o codigo e o corpo JSON.
function resposta(status, corpo) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json() { return Promise.resolve(corpo); } });
}

// ---- o navegador de mentira ----
// opcoes.carga: o que o fetch de simulado.json faz (recebe as opcoes do fetch, devolve a promessa); sem ela, entrega o
// simulado de verdade, depois de opcoes.mexer(dados), se houver. opcoes.semAbortTimeout: o navegador sem
// AbortSignal.timeout. opcoes.pedirPermissao(retorno, Notification): troca o Notification.requestPermission e recebe
// a dupla do Notification, para mudar a permissao. opcoes.midia: o que o matchMedia devolve. opcoes.rede(url, o): a
// rede do modo ao vivo, que devolve a promessa da resposta; o que ela devolve undefined segue para a carga ou o simulado.
function abrirPainel(opcoes) {
  opcoes = opcoes || {};
  const doc = criarDocumento();
  const relogio = [];
  const fontes = [];
  const problemas = [];
  const guardado = new Map();
  const pedidos = [];
  const avisos = [];

  class FonteFalsa {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.ouvintes = new Map();
      fontes.push(this);
    }
    addEventListener(tipo, fn) {
      if (!this.ouvintes.has(tipo)) this.ouvintes.set(tipo, []);
      this.ouvintes.get(tipo).push(fn);
    }
    // `id` e o id do evento no SSE, que chega como lastEventId ('' sem id, como no navegador).
    emitir(tipo, dados, id) {
      const e = { type: tipo, data: dados, lastEventId: id === undefined ? '' : String(id) };
      for (const fn of this.ouvintes.get(tipo) || []) fn.call(this, e);
    }
    close() { this.readyState = 2; }
  }
  FonteFalsa.CONNECTING = 0;
  FonteFalsa.OPEN = 1;
  FonteFalsa.CLOSED = 2;

  class AvisoFalso {
    constructor(titulo, o) { this.titulo = titulo; this.o = o; avisos.push(this); }
    addEventListener() {}
    close() {}
  }
  AvisoFalso.permission = 'default';
  AvisoFalso.requestPermission = opcoes.pedirPermissao
    ? function (retorno) { return opcoes.pedirPermissao(retorno, AvisoFalso); }
    : function () {
      AvisoFalso.permission = 'granted';
      return Promise.resolve('granted');
    };

  // A dupla do AbortSignal: o timeout e o do Node, menos no navegador velho que nao o tem.
  function SinalFalso() {}
  if (!opcoes.semAbortTimeout) SinalFalso.timeout = function (ms) { return AbortSignal.timeout(ms); };

  const janela = {
    document: doc,
    console: {
      log() {}, info() {},
      warn() { problemas.push(['warn'].concat(Array.from(arguments).map(String)).join(' ')); },
      error() { problemas.push(['error'].concat(Array.from(arguments).map(String)).join(' ')); },
    },
    localStorage: {
      getItem(k) { return guardado.has(k) ? guardado.get(k) : null; },
      setItem(k, v) { guardado.set(k, String(v)); },
    },
    matchMedia() { return opcoes.midia || { matches: true, addEventListener() {} }; },
    isSecureContext: true,
    Notification: AvisoFalso,
    // O navegador sem EventSource: a propriedade existe e vale undefined, como o typeof da pagina ve.
    EventSource: opcoes.semEventSource ? undefined : FonteFalsa,
    AbortSignal: SinalFalso,
    AbortController,
    fetch(url, o) {
      pedidos.push({ url, o });
      const daRede = opcoes.rede ? opcoes.rede(url, o) : undefined;
      if (daRede) return daRede;
      if (opcoes.carga) return opcoes.carga(o);
      const dados = JSON.parse(SIMULADO);
      if (opcoes.mexer) opcoes.mexer(dados);
      return Promise.resolve({ ok: true, status: 200, json() { return Promise.resolve(dados); } });
    },
    // O numero que volta e a posicao no relogio mais 1: o cancelado fica marcado e o passar() o pula.
    setTimeout(fn, ms) { relogio.push({ fn, ms, repete: false }); return relogio.length; },
    clearTimeout(n) { if (relogio[n - 1]) relogio[n - 1].feito = true; },
    setInterval(fn, ms) { relogio.push({ fn, ms, repete: true }); return relogio.length; },
    clearInterval(n) { if (relogio[n - 1]) relogio[n - 1].feito = true; },
    focus() {},
  };
  janela.window = janela;
  vm.createContext(janela);
  for (const s of CODIGO) s.runInContext(janela);

  return {
    doc, janela, fontes, problemas, pedidos, avisos, Notification: AvisoFalso,
    $(id) { return doc.getElementById(id); },
    sinal() { return doc.getElementById('sinal').dataset.sinal; },
    // Roda, uma vez, os prazos de setTimeout que vencem ate `ms` e que o painel nao cancelou.
    passar(ms) {
      for (const t of relogio.slice()) {
        if (!t.repete && !t.feito && t.ms <= ms) { t.feito = true; t.fn(); }
      }
    },
  };
}

function esvaziar() { return new Promise(function (pronto) { setImmediate(pronto); }); }

// O painel com o simulado ja desenhado; sem nenhum aviso no console, a montagem deu certo.
async function painelCarregado(opcoes) {
  const p = abrirPainel(opcoes);
  await esvaziar();
  assert.deepStrictEqual(p.problemas, [], 'a montagem falhou na arvore de mentira');
  assert.strictEqual(p.fontes.length, 1, 'o painel montado escuta o SSE');
  return p;
}

test('arvore de mentira: o painel monta com o simulado de verdade, desenha a fila e escuta o SSE', async function () {
  const p = abrirPainel();
  assert.ok(p.$('fila-carregando'), 'antes de a carga chegar, a fila diz que esta carregando');
  await esvaziar();
  assert.deepStrictEqual(p.problemas, [], 'a montagem falhou na arvore de mentira');
  assert.ok(p.$('fila-lista').querySelectorAll('[data-foco]').length > 0, 'a fila tem os pedidos');
  assert.ok(p.$('salas').childElementCount > 0, 'o escritorio tem as salas');
  // O no fica fora da comparacao: o assert que falha imprime o valor, e o no de mentira e circular.
  assert.ok(p.$('fila-carregando') === null, 'o "carregando" saiu');
  assert.strictEqual(p.sinal(), 'conectando');
});

test('arvore de mentira: sem nenhuma sessao, a fila e o escritorio dizem que estao vazios', async function () {
  const p = await painelCarregado({ mexer(dados) { dados.sessoes = []; dados.eventos = []; } });
  assert.strictEqual(p.$('fila-lista').querySelectorAll('[data-foco]').length, 0);
  assert.strictEqual(p.$('fila-vazia').hidden, false, 'a fila vazia mostra o aviso de vazia');
  assert.strictEqual(p.$('salas-vazia').hidden, false, 'o escritorio vazio mostra o aviso de vazio');
  assert.match(p.$('salas-vazia').textContent, /Nenhuma sessão aberta/);
});

test('painel.js: a carga que falha diz o motivo certo, e o sinal fica em "sem dados"', async function () {
  const casos = [
    { nome: 'o servidor responde 500',
      carga() { return Promise.resolve({ ok: false, status: 500, json() { return Promise.resolve({}); } }); },
      motivo: /respondeu com o código 500/ },
    { nome: 'o JSON chega quebrado',
      carga() { return Promise.resolve({ ok: true, status: 200, json() { return Promise.reject(new SyntaxError('quebrado')); } }); },
      motivo: /os dados chegaram quebrados/ },
    { nome: 'a rede cai',
      carga() { return Promise.reject(new TypeError('Failed to fetch')); },
      motivo: /o servidor não respondeu\. Confira se o servidor do painel está rodando: no terminal, rode node scripts\/painel\.js \(ou node scripts\/painel\.js --prototipo, para os dados simulados\) e recarregue a página\./ },
    // O painel ao vivo recusa a aba sem o cookie da chave: recarregar nao resolve, abrir pelo endereco com a chave sim.
    { nome: 'a aba sem a chave',
      carga() { return resposta(401, {}); },
      motivo: /não reconheceu esta aba\. Abra o painel pelo endereço com a chave que o terminal mostrou ao iniciar o painel \(node scripts\/painel\.js\)\./ },
  ];
  for (const c of casos) {
    const p = abrirPainel({ carga: c.carga });
    await esvaziar();
    const alerta = p.doc.querySelector('[role="alert"]');
    assert.ok(alerta, c.nome + ': a carga que falhou vira o aviso da pagina');
    assert.match(alerta.textContent, c.motivo, c.nome);
    // Os dados podem ser os de verdade: o aviso nao fala em sessoes simuladas.
    assert.doesNotMatch(alerta.textContent, /sessões simuladas/, c.nome);
    assert.strictEqual(p.sinal(), 'sem', c.nome);
    assert.ok(p.$('fila-carregando') === null, c.nome + ': o aviso toma o lugar do "carregando"');
  }
});

test('painel.js: o navegador sem AbortSignal.timeout ainda da prazo a carga, e o prazo esgotado diz o porque', async function () {
  const p = abrirPainel({
    semAbortTimeout: true,
    carga(o) {
      return new Promise(function (_, falhar) {
        if (o && o.signal) o.signal.addEventListener('abort', function () { falhar(new DOMException('abortado', 'AbortError')); });
      });
    },
  });
  assert.strictEqual(p.pedidos.length, 1, 'o painel pede os dados uma vez');
  const sinalDaCarga = p.pedidos[0].o && p.pedidos[0].o.signal;
  assert.ok(sinalDaCarga, 'sem prazo, o servidor que aceita e nunca responde deixa a pagina carregando para sempre');
  p.passar(10000);
  await esvaziar();
  const alerta = p.doc.querySelector('[role="alert"]');
  assert.ok(alerta, 'a carga que estourou o prazo vira o aviso da pagina');
  assert.match(alerta.textContent, /não respondeu em 10 segundos/);
  assert.strictEqual(p.sinal(), 'sem');
  assert.ok(p.$('fila-carregando') === null, 'o aviso toma o lugar do "carregando"');
});

test('painel.js: depois do evento quebrado, a reconexao nao troca o "recarregue" por "Ao vivo"', async function () {
  const p = await painelCarregado();
  const fonte = p.fontes[0];
  fonte.readyState = 1;
  fonte.emitir('open');
  assert.strictEqual(p.sinal(), 'aovivo');
  fonte.emitir('mensagem', '{quebrado');
  assert.strictEqual(p.sinal(), 'sem');
  // O EventSource reconecta sozinho e manda o Last-Event-ID, que ja passou do evento perdido: a tela segue atrasada.
  fonte.readyState = 0;
  fonte.emitir('error');
  assert.strictEqual(p.sinal(), 'sem', 'o "Reconectando" apagou o "recarregue"');
  fonte.readyState = 1;
  fonte.emitir('open');
  assert.strictEqual(p.sinal(), 'sem', 'o "Ao vivo" apagou o "recarregue" com a tela atrasada');
  assert.match(p.$('sinal-texto').textContent, /recarregue a página/);
});

test('painel.js: a troca do sinal fala no leitor de tela, menos a primeira ligacao', async function () {
  const p = await painelCarregado();
  const fonte = p.fontes[0];
  fonte.readyState = 1;
  fonte.emitir('open');
  assert.strictEqual(p.$('anuncio').textContent, '', 'a primeira ligacao e o esperado: nao fala');
  fonte.readyState = 0;
  fonte.emitir('error');
  assert.strictEqual(p.$('anuncio').textContent, 'Reconectando…');
  fonte.readyState = 1;
  fonte.emitir('open');
  assert.strictEqual(p.$('anuncio').textContent, 'Ao vivo');
});

test('painel.js: o botao de avisos funciona no navegador que so devolve a permissao pela funcao de retorno', async function () {
  const p = await painelCarregado({
    pedirPermissao(retorno, Aviso) {
      Aviso.permission = 'granted';
      if (typeof retorno === 'function') retorno('granted');
      return undefined;
    },
  });
  const botao = p.$('avisos');
  assert.strictEqual(botao.hidden, false);
  assert.doesNotThrow(function () { botao.click(); }, 'o requestPermission antigo nao devolve promessa');
  await esvaziar();
  assert.strictEqual(botao.textContent, 'Avisos ligados');
  assert.strictEqual(botao.disabled, true);
});

test('painel.js: o navegador que so tem o addListener na media query ainda desenha o tema', async function () {
  const ouvintes = [];
  const p = await painelCarregado({ midia: { matches: false, addListener(fn) { ouvintes.push(fn); } } });
  assert.strictEqual(p.$('tema').getAttribute('aria-pressed'), 'true', 'o sistema claro deixa o botao "Tema claro" ligado');
  assert.strictEqual(ouvintes.length, 1, 'a troca de tema do sistema ainda chega ao painel');
});

test('painel.js: a contagem de linhas que nao e contagem vira 0 na tela, nunca "+-3"', async function () {
  const mexida = {};
  const p = await painelCarregado({
    mexer(dados) {
      const s = dados.sessoes.find(function (x) { return Array.isArray(x.arquivos) && x.arquivos.length; });
      assert.ok(s, 'o simulado tem uma sessao com arquivo mudado');
      s.arquivos[0].mais = -3;
      s.arquivos[0].menos = 1.5;
      mexida.id = s.id;
      mexida.caminho = s.arquivos[0].caminho;
    },
  });
  const abrir = p.doc.querySelector('[data-foco="abrir:' + mexida.id + '"]');
  assert.ok(abrir, 'a mesa da sessao mexida tem o botao de abrir');
  abrir.click();
  assert.strictEqual(p.$('lateral').open, true, 'o botao abre o painel lateral');
  const item = p.$('lateral-arquivos').querySelectorAll('li').find(function (li) {
    const c = li.querySelector('.arquivo__caminho');
    return c && c.textContent === mexida.caminho;
  });
  assert.ok(item, 'o arquivo mexido aparece no painel lateral');
  assert.strictEqual(item.querySelector('.arquivo__mais').textContent, '+0');
  assert.strictEqual(item.querySelector('.arquivo__menos').textContent, '−0');
  // O custo vem com virgula (pt-BR): o ponto decimal so sairia da contagem torta.
  assert.doesNotMatch(p.doc.body.textContent, /[+−]-\d|[+−]\d+\.\d|-\d+ linhas?|\d\.\d+ linhas?/,
    'a contagem torta apareceu na tela');
});

test('painel.js: a resposta recusada por motivo raro manda copiar o texto antes de recarregar', async function () {
  const p = await painelCarregado();
  p.$('fila-lista').querySelector('[data-foco^="fila:"]').click();
  assert.strictEqual(p.$('lateral').open, true, 'o pedido da fila abre o painel lateral');
  p.janela.PainelEstado.responder = function () { return { mudou: [], recusa: 'motivo-novo' }; };
  p.$('resposta-texto').value = 'um texto que o dono escreveu';
  p.$('resposta').requestSubmit();
  const erro = p.$('resposta-erro').textContent;
  assert.match(erro, /recarregue/);
  // O rascunho mora so na memoria da pagina: recarregar sem copiar perde o que o dono escreveu.
  assert.match(erro, /[Cc]opie/);
});

// ---- o modo ao vivo ----
// O retrato que o servidor ao vivo serve em /dados.json (o formato do retrato de scripts/lib/painel-vivo.js): duas
// sessoes do terminal, sem custo, uma esperando uma permissao. Ids inventados.
const PEDIDO_A = 'a1'.repeat(16);
const PEDIDO_B = 'b2'.repeat(16);
function dadosAoVivo() {
  return {
    modo: 'ao-vivo', seq: 5,
    maquinas: [{ id: 'local', nome: 'Esta máquina', conexao: 'online' }],
    projetos: [{ id: 'C:/projetos/loja', nome: 'loja' }],
    sessoes: [
      { id: 'sessao-a', nome: 'Rodar a suíte', projeto: 'C:/projetos/loja', maquina: 'local', origem: 'terminal',
        estado: 'precisa', minutosNoEstado: 2, conversa: [], arquivos: [],
        pedido: { id: PEDIDO_A, tipo: 'permissao', texto: 'Rodar os testes', comando: 'npm test', urgencia: 'alta' } },
      { id: 'sessao-b', nome: 'Arrumar o cabeçalho', projeto: 'C:/projetos/loja', maquina: 'local', origem: 'terminal',
        estado: 'trabalhando', minutosNoEstado: 1, conversa: [], arquivos: [] },
    ],
  };
}

// O painel ao vivo ja carregado: /dados.json devolve o retrato (o de o.retrato(), ou o de dadosAoVivo), e o resto da
// rede passa por o.rede(url, op); sem ela, o servidor aceita tudo com 200.
async function painelAoVivo(o) {
  o = o || {};
  const p = abrirPainel({
    rede(url, op) {
      if (url === 'dados.json') return resposta(200, o.retrato ? o.retrato() : dadosAoVivo());
      return o.rede ? o.rede(url, op) : resposta(200, { ok: true });
    },
  });
  await esvaziar();
  assert.deepStrictEqual(p.problemas, [], 'a montagem ao vivo falhou na arvore de mentira');
  assert.strictEqual(p.fontes.length, 1, 'o painel ao vivo escuta o SSE');
  return p;
}

// O SSE liga e a busca do retrato que vem com a ligacao termina.
async function ligar(p) {
  const fonte = p.fontes[0];
  fonte.readyState = 1;
  fonte.emitir('open');
  await esvaziar();
  return fonte;
}

function mesaDe(p, id) {
  const botao = p.doc.querySelector('[data-foco="abrir:' + id + '"]');
  return botao ? botao.closest('article') : null;
}

function chamadas(p, url) { return p.pedidos.filter(function (x) { return x.url === url; }); }

function abrirPedidoDe(p, id) {
  const botao = p.doc.querySelector('[data-foco="fila:' + id + '"]');
  assert.ok(botao, 'o pedido de ' + id + ' esta na fila');
  botao.click();
  assert.strictEqual(p.$('lateral').open, true, 'o pedido da fila abre o painel lateral');
}

test('ao vivo: a tela le dados.json, o selo diz ao vivo e o SSE leva o id da aba e se ela esta visivel', async function () {
  const p = await painelAoVivo();
  assert.strictEqual(p.pedidos[0].url, 'dados.json');
  assert.strictEqual(p.$('selo').textContent, 'Ao vivo · esta máquina');
  assert.strictEqual(p.$('selo').hidden, false);
  assert.strictEqual(p.doc.title, 'Painel de sessões · ao vivo');
  assert.match(p.fontes[0].url, /^eventos\?cliente=[A-Za-z0-9_-]{8,64}&visivel=1$/);
  assert.ok(mesaDe(p, 'sessao-a'), 'a mesa da sessao do retrato aparece');
});

test('prototipo: a tela le dados.json, o selo diz dados simulados e o SSE fica sem id de aba', async function () {
  const p = await painelCarregado();
  assert.strictEqual(p.pedidos[0].url, 'dados.json');
  assert.strictEqual(p.$('selo').textContent, 'Protótipo · dados simulados');
  assert.strictEqual(p.$('selo').hidden, false);
  assert.strictEqual(p.fontes[0].url, 'eventos');
});

test('ao vivo: o evento sessao poe a mesa nova, na sala que ja existe ou numa sala nova', async function () {
  const p = await painelAoVivo();
  const fonte = await ligar(p);
  fonte.emitir('sessao', JSON.stringify({ tipo: 'sessao', sessao: 'sessao-c', nome: 'Sessão nova na loja',
    projeto: 'C:/projetos/loja', projetoNome: 'loja', maquina: 'local', origem: 'terminal', estado: 'parada' }), 6);
  fonte.emitir('sessao', JSON.stringify({ tipo: 'sessao', sessao: 'sessao-d', nome: 'Sessão do blog',
    projeto: 'C:/projetos/blog', projetoNome: 'blog', maquina: 'local', origem: 'terminal', estado: 'parada' }), 7);
  assert.deepStrictEqual(p.problemas, []);
  assert.ok(mesaDe(p, 'sessao-c'), 'a mesa nova da loja apareceu');
  assert.ok(mesaDe(p, 'sessao-d'), 'a mesa nova do blog apareceu');
  const nomes = p.$('salas').querySelectorAll('.sala__nome').map(function (n) { return n.textContent; });
  assert.deepStrictEqual(nomes, ['loja', 'blog'], 'a sala nova entra uma vez, e a da loja nao repete');
  assert.ok(mesaDe(p, 'sessao-a'), 'a mesa que ja estava segue no escritorio');
  assert.strictEqual(p.$('salas').querySelectorAll('article').length, 4);
});

test('ao vivo: ligar busca o retrato de novo, guarda os eventos do meio e pula os que o retrato ja tem', async function () {
  let retrato = dadosAoVivo();
  let segurar = false;
  let soltar = null;
  const p = abrirPainel({
    rede(url) {
      if (url !== 'dados.json') return resposta(200, { ok: true });
      const r = JSON.parse(JSON.stringify(retrato));
      if (!segurar) return resposta(200, r);
      return new Promise(function (pronto) { soltar = function () { pronto({ ok: true, status: 200, json() { return Promise.resolve(r); } }); }; });
    },
  });
  await esvaziar();
  const fonte = await ligar(p);
  assert.strictEqual(chamadas(p, 'dados.json').length, 2, 'a ligacao busca o retrato de novo');
  // O evento que o retrato ja tem (id ate o seq dele) nao se aplica duas vezes.
  fonte.emitir('mensagem', JSON.stringify({ tipo: 'mensagem', sessao: 'sessao-b', quem: 'agente', texto: 'fala repetida' }), 5);
  assert.doesNotMatch(mesaDe(p, 'sessao-b').textContent, /fala repetida/);

  fonte.readyState = 0;
  fonte.emitir('error');
  assert.strictEqual(p.sinal(), 'reconectando');
  // Enquanto a tela estava fora, o servidor seguiu: uma sessao nova e o seq 9.
  retrato = dadosAoVivo();
  retrato.seq = 9;
  retrato.sessoes.push({ id: 'sessao-e', nome: 'Sessão de enquanto isso', projeto: 'C:/projetos/loja', maquina: 'local',
    origem: 'terminal', estado: 'trabalhando', minutosNoEstado: 0, conversa: [], arquivos: [] });
  segurar = true;
  fonte.readyState = 1;
  fonte.emitir('open');
  fonte.emitir('mensagem', JSON.stringify({ tipo: 'mensagem', sessao: 'sessao-b', quem: 'agente', texto: 'fala velha' }), 8);
  fonte.emitir('mensagem', JSON.stringify({ tipo: 'mensagem', sessao: 'sessao-e', quem: 'agente', texto: 'fala nova' }), 10);
  assert.strictEqual(mesaDe(p, 'sessao-e'), null, 'a mesa nova so vem com o retrato');
  assert.ok(soltar, 'a religacao pediu o retrato');
  soltar();
  await esvaziar();
  assert.deepStrictEqual(p.problemas, []);
  assert.ok(mesaDe(p, 'sessao-e'), 'a sessao que nasceu com a tela fora aparece');
  assert.match(mesaDe(p, 'sessao-e').textContent, /fala nova/, 'o evento que chegou durante a busca se aplica depois dela');
  assert.doesNotMatch(mesaDe(p, 'sessao-b').textContent, /fala velha/, 'o evento que o retrato ja tem fica de fora');
  assert.strictEqual(p.sinal(), 'aovivo');
});

test('ao vivo: a busca do retrato que falha ao religar manda recarregar', async function () {
  let falhar = false;
  const p = abrirPainel({
    rede(url) {
      if (url !== 'dados.json') return resposta(200, { ok: true });
      return falhar ? resposta(500, {}) : resposta(200, dadosAoVivo());
    },
  });
  await esvaziar();
  falhar = true;
  await ligar(p);
  assert.strictEqual(p.sinal(), 'sem');
  assert.match(p.$('sinal-texto').textContent, /recarregue a página/);
  assert.ok(p.problemas.some(function (l) { return /retrato/.test(l); }), 'o console guarda o porque');
});

test('ao vivo: a religacao que o servidor recusa pela chave manda abrir pelo endereco com a chave', async function () {
  for (const status of [401, 403]) {
    let falhar = false;
    const p = abrirPainel({
      rede(url) {
        if (url !== 'dados.json') return resposta(200, { ok: true });
        return falhar ? resposta(status, {}) : resposta(200, dadosAoVivo());
      },
    });
    await esvaziar();
    falhar = true;
    await ligar(p);
    assert.strictEqual(p.sinal(), 'sem', status + ': o sinal fica sem conexao');
    assert.match(p.$('sinal-texto').textContent, /O painel não reconheceu esta aba: abra-o de novo pelo endereço com a chave/,
      status + ': o passo e abrir pelo endereco com a chave');
    assert.doesNotMatch(p.$('sinal-texto').textContent, /recarregue a página/, status + ': recarregar nao resolve');
    assert.ok(p.problemas.some(function (l) { return /retrato/.test(l); }), status + ': o console guarda o porque');
  }
});

test('ao vivo: a aba diz ao servidor se esta visivel ao ligar e a cada troca', async function () {
  const p = await painelAoVivo();
  const fonte = await ligar(p);
  const cliente = /cliente=([^&]+)/.exec(fonte.url)[1];
  assert.strictEqual(chamadas(p, 'presenca').length, 1, 'a ligacao diz a presenca (a religacao usa o endereco velho)');
  const primeira = chamadas(p, 'presenca')[0].o;
  assert.strictEqual(primeira.method, 'POST');
  assert.strictEqual(primeira.headers['X-Painel'], '1');
  assert.strictEqual(primeira.headers['Content-Type'], 'application/json');
  assert.deepStrictEqual(JSON.parse(primeira.body), { cliente, visivel: true });
  p.doc.visibilityState = 'hidden';
  p.doc.disparar('visibilitychange');
  assert.strictEqual(chamadas(p, 'presenca').length, 2);
  assert.deepStrictEqual(JSON.parse(chamadas(p, 'presenca')[1].o.body), { cliente, visivel: false });
});

test('ao vivo: a decisao vai ao servidor, a tela espera ocupada e so muda quando ele confirma', async function () {
  let soltar = null;
  const p = await painelAoVivo({
    rede(url) {
      if (url !== 'decidir') return resposta(200, { ok: true });
      return new Promise(function (pronto) { soltar = function () { pronto({ ok: true, status: 200, json() { return Promise.resolve({ ok: true }); } }); }; });
    },
  });
  await ligar(p);
  abrirPedidoDe(p, 'sessao-a');
  p.$('lateral-pedido').querySelector('[data-foco="decidir:aprovar"]').click();
  assert.strictEqual(chamadas(p, 'decidir').length, 1);
  const o = chamadas(p, 'decidir')[0].o;
  assert.strictEqual(o.method, 'POST');
  assert.strictEqual(o.headers['X-Painel'], '1');
  assert.deepStrictEqual(JSON.parse(o.body), { pedido: PEDIDO_A, sessao: 'sessao-a', escolha: 'aprovar' });
  // Esperando o servidor: o grupo ocupado, o botao que ainda recebe foco e nao decide de novo.
  assert.strictEqual(p.$('lateral-pedido').querySelector('.decisao').getAttribute('aria-busy'), 'true');
  const aprovar = p.$('lateral-pedido').querySelector('[data-foco="decidir:aprovar"]');
  assert.strictEqual(aprovar.getAttribute('aria-disabled'), 'true');
  assert.match(p.$('lateral-pedido').textContent, /Enviando a decisão à sessão…/);
  assert.strictEqual(p.$('lateral-anuncio').textContent, 'Enviando a decisão à sessão…', 'o leitor de tela ouve que a decisão saiu');
  aprovar.click();
  assert.strictEqual(chamadas(p, 'decidir').length, 1, 'o 2o clique nao manda outra decisao');
  assert.ok(p.doc.querySelector('[data-foco="fila:sessao-a"]'), 'antes da confirmacao, o pedido segue na fila');
  soltar();
  await esvaziar();
  assert.deepStrictEqual(p.problemas, []);
  assert.strictEqual(p.doc.querySelector('[data-foco="fila:sessao-a"]'), null, 'confirmada, o pedido sai da fila');
  assert.match(p.$('lateral-pedido').textContent, /Nada espera por você/);
  // O evento da decisao que o servidor difunde chega depois e nao muda nada de novo.
  p.fontes[0].emitir('decisao', JSON.stringify({ tipo: 'decisao', sessao: 'sessao-a', pedido: PEDIDO_A, escolha: 'aprovar' }), 6);
  assert.deepStrictEqual(p.problemas, []);
});

test('ao vivo: a decisao recusada pelo servidor diz por que, sem botoes', async function () {
  const casos = [
    { motivo: 'voltou', texto: /Este pedido voltou para o terminal: decida por lá\./ },
    // O 409 nao diz quem decidiu nem o que: a tela manda ver na conversa da sessao.
    { motivo: 'decidido', texto: /Este pedido já foi decidido \(nesta aba ou em outra\): veja na conversa da sessão o que ela fez\./ },
  ];
  for (const c of casos) {
    const p = await painelAoVivo({
      rede(url) { return url === 'decidir' ? resposta(409, { ok: false, motivo: c.motivo }) : resposta(200, { ok: true }); },
    });
    await ligar(p);
    abrirPedidoDe(p, 'sessao-a');
    p.$('lateral-pedido').querySelector('[data-foco="decidir:aprovar"]').click();
    await esvaziar();
    assert.deepStrictEqual(p.problemas, [], c.motivo);
    assert.match(p.$('lateral-pedido').textContent, c.texto, c.motivo);
    assert.strictEqual(p.$('lateral-pedido').querySelectorAll('[data-foco^="decidir:"]').length, 0, c.motivo);
    assert.match(p.$('lateral-anuncio').textContent, c.texto, c.motivo + ': o leitor de tela ouve o porque');
  }
});

test('ao vivo: a decisao que nao chega ao servidor devolve os botoes e diz o que fazer', async function () {
  const p = await painelAoVivo({
    rede(url) { return url === 'decidir' ? Promise.reject(new TypeError('Failed to fetch')) : resposta(200, { ok: true }); },
  });
  await ligar(p);
  abrirPedidoDe(p, 'sessao-a');
  p.$('lateral-pedido').querySelector('[data-foco="decidir:negar"]').click();
  await esvaziar();
  assert.match(p.$('lateral-pedido').textContent, /A decisão não chegou ao servidor do painel: confira no terminal se ele está rodando e tente de novo\./);
  const negar = p.$('lateral-pedido').querySelector('[data-foco="decidir:negar"]');
  assert.ok(negar, 'o botao volta');
  assert.strictEqual(negar.getAttribute('aria-disabled'), null);
  assert.strictEqual(p.$('lateral-pedido').querySelector('.decisao').getAttribute('aria-busy'), null);
  assert.ok(p.doc.querySelector('[data-foco="fila:sessao-a"]'), 'o pedido segue na fila');
  negar.click();
  assert.strictEqual(chamadas(p, 'decidir').length, 2, 'o dono tenta de novo');
});

test('ao vivo: a decisao cujo prazo esgota diz que pode ter chegado e devolve os botoes', async function () {
  // O prazo do POST vence com TimeoutError (AbortSignal.timeout) ou AbortError (o AbortController do navegador velho).
  for (const nomeDoErro of ['TimeoutError', 'AbortError']) {
    const p = await painelAoVivo({
      rede(url) {
        if (url !== 'decidir') return resposta(200, { ok: true });
        const erro = new Error('prazo');
        erro.name = nomeDoErro;
        return Promise.reject(erro);
      },
    });
    await ligar(p);
    abrirPedidoDe(p, 'sessao-a');
    p.$('lateral-pedido').querySelector('[data-foco="decidir:aprovar"]').click();
    await esvaziar();
    const texto = /O servidor do painel demorou a responder, e a decisão pode ter chegado: veja na conversa da sessão; se o pedido seguir aqui, tente de novo\./;
    assert.match(p.$('lateral-pedido').textContent, texto, nomeDoErro);
    assert.doesNotMatch(p.$('lateral-pedido').textContent, /não chegou ao servidor/, nomeDoErro + ': o prazo nao afirma que nao chegou');
    assert.match(p.$('lateral-anuncio').textContent, texto, nomeDoErro + ': o leitor de tela ouve o mesmo');
    assert.ok(p.$('lateral-pedido').querySelector('[data-foco="decidir:aprovar"]'), nomeDoErro + ': os botoes voltam');
    assert.ok(p.doc.querySelector('[data-foco="fila:sessao-a"]'), nomeDoErro + ': o pedido segue na fila');
    assert.strictEqual(p.problemas.length, 1, nomeDoErro + ': o console guarda o erro');
  }
});

test('ao vivo: o pedido sem id fica sem botoes e manda decidir pelo terminal', async function () {
  // O servidor so aceita a decisao pelo id do pedido: sem ele, o botao levaria a um "ja mudou" que nao e verdade.
  const casos = [
    { nome: 'id vazio', mexer(p) { p.id = ''; } },
    { nome: 'sem id', mexer(p) { delete p.id; } },
  ];
  for (const c of casos) {
    const p = await painelAoVivo({
      retrato() { const r = dadosAoVivo(); c.mexer(r.sessoes[0].pedido); return r; },
    });
    await ligar(p);
    abrirPedidoDe(p, 'sessao-a');
    assert.deepStrictEqual(p.problemas, [], c.nome);
    assert.strictEqual(p.$('lateral-pedido').querySelectorAll('[data-foco^="decidir:"]').length, 0, c.nome + ': sem botoes');
    assert.match(p.$('lateral-pedido').textContent, /Este pedido chegou sem identificação, e o painel não consegue decidi-lo: decida pelo terminal\./, c.nome);
    assert.strictEqual(chamadas(p, 'decidir').length, 0, c.nome);
  }
});

test('o navegador sem EventSource diz que nao acompanha ao vivo e onde abrir o painel', async function () {
  const p = abrirPainel({ semEventSource: true });
  await esvaziar();
  assert.deepStrictEqual(p.problemas, []);
  assert.strictEqual(p.fontes.length, 0);
  assert.strictEqual(p.sinal(), 'sem');
  assert.strictEqual(p.$('sinal-texto').textContent, 'Este navegador não acompanha ao vivo: abra o painel no Chrome, no Edge ou no Firefox');
});

test('ao vivo: a decisao que o servidor recusa pela chave ou por erro diz o que fazer e devolve os botoes', async function () {
  const SEM_CHAVE = /O painel não reconheceu esta aba: abra-o de novo pelo endereço com a chave que o terminal mostrou ao iniciar o painel\./;
  const casos = [
    { status: 401, texto: SEM_CHAVE },
    { status: 403, texto: SEM_CHAVE },
    { status: 500, texto: /O servidor do painel recusou a decisão \(código 500\): recarregue a página e tente de novo\./ },
  ];
  for (const c of casos) {
    const nome = 'codigo ' + c.status;
    const p = await painelAoVivo({
      rede(url) { return url === 'decidir' ? resposta(c.status, {}) : resposta(200, { ok: true }); },
    });
    await ligar(p);
    abrirPedidoDe(p, 'sessao-a');
    p.$('lateral-pedido').querySelector('[data-foco="decidir:aprovar"]').click();
    await esvaziar();
    assert.match(p.$('lateral-pedido').textContent, c.texto, nome);
    assert.match(p.$('lateral-anuncio').textContent, c.texto, nome + ': o leitor de tela ouve o que fazer');
    assert.ok(p.$('lateral-pedido').querySelector('[data-foco="decidir:aprovar"]'), nome + ': os botoes voltam');
    assert.ok(p.doc.querySelector('[data-foco="fila:sessao-a"]'), nome + ': o pedido segue na fila');
    assert.deepStrictEqual(p.problemas, ['warn painel: o servidor recusou a decisão, código ' + c.status], nome + ': o console guarda o código');
  }
});

test('ao vivo: a sessao aberta que sai do retrato ao religar fecha o painel lateral e diz por que', async function () {
  let retrato = dadosAoVivo();
  const p = await painelAoVivo({ retrato() { return retrato; } });
  const fonte = await ligar(p);
  abrirPedidoDe(p, 'sessao-a');
  fonte.readyState = 0;
  fonte.emitir('error');
  retrato = dadosAoVivo();
  retrato.seq = 9;
  retrato.sessoes = retrato.sessoes.filter(function (s) { return s.id !== 'sessao-a'; });
  fonte.readyState = 1;
  fonte.emitir('open');
  await esvaziar();
  assert.deepStrictEqual(p.problemas, []);
  assert.strictEqual(p.$('lateral').open, false, 'a sessao saiu do retrato: o painel lateral fecha');
  assert.strictEqual(p.$('anuncio').textContent, 'Esta sessão não está mais no painel: o painel lateral foi fechado.');
});

test('ao vivo: o pedido que voltou para o terminal diz isso na fila e no painel lateral, sem botoes', async function () {
  const p = await painelAoVivo();
  const fonte = await ligar(p);
  fonte.emitir('voltou', JSON.stringify({ tipo: 'voltou', sessao: 'sessao-a', pedido: PEDIDO_A }), 6);
  const item = p.doc.querySelector('[data-foco="fila:sessao-a"]').closest('li');
  assert.match(item.textContent, /voltou para o terminal/);
  // A nota de quem voltou e a mesma do painel lateral, nao a do sem sinal (ambar), que fala da maquina.
  const nota = item.querySelector('.bloco__nota');
  assert.ok(nota, 'a nota da fila usa a classe da nota do painel lateral');
  assert.match(nota.textContent, /Este pedido voltou para o terminal: decida por lá\./);
  assert.strictEqual(item.querySelector('.pedido__semsinal'), null, 'sem o ambar do sem sinal');
  abrirPedidoDe(p, 'sessao-a');
  assert.match(p.$('lateral-pedido').textContent, /Este pedido voltou para o terminal: decida por lá\./);
  assert.strictEqual(p.$('lateral-pedido').querySelectorAll('[data-foco^="decidir:"]').length, 0);
});

test('a pergunta da sessao do terminal manda responder no terminal; a da sessao do painel tem as opcoes', async function () {
  const p = await painelAoVivo({
    retrato() {
      const d = dadosAoVivo();
      d.sessoes[0].pedido = { id: PEDIDO_A, tipo: 'pergunta', texto: 'Qual banco usar?', opcoes: ['Postgres', 'SQLite'] };
      return d;
    },
  });
  abrirPedidoDe(p, 'sessao-a');
  assert.match(p.$('lateral-pedido').textContent, /Responda esta pergunta no terminal\./);
  assert.strictEqual(p.$('lateral-pedido').querySelectorAll('[data-foco^="decidir:"]').length, 0);

  const prototipo = await painelCarregado();
  const s = JSON.parse(SIMULADO).sessoes.find(function (x) { return x.origem === 'painel' && x.pedido && x.pedido.tipo === 'pergunta'; });
  assert.ok(s, 'o simulado tem uma pergunta de sessao do painel');
  abrirPedidoDe(prototipo, s.id);
  assert.ok(prototipo.$('lateral-pedido').querySelector('[data-foco="decidir:0"]'), 'a pergunta do painel tem as opcoes');
  assert.doesNotMatch(prototipo.$('lateral-pedido').textContent, /Responda esta pergunta no terminal/);
});

// "sem custo" leria como "de graca": o texto diz que o custo nao veio, e quantas sessoes ficaram fora do total.
test('ao vivo: a sessao do terminal sem custo diz "custo não informado pelo terminal" na mesa, na sala, no topo e na equipe', async function () {
  const p = await painelAoVivo();
  assert.match(mesaDe(p, 'sessao-a').textContent, /custo não informado pelo terminal/);
  assert.strictEqual(p.$('salas').querySelector('.sala__custo').textContent, 'custo não informado pelo terminal');
  assert.strictEqual(p.$('total').textContent, '2 sessões, custo não informado pelo terminal');
  assert.match(p.$('equipe-projetos-linhas').textContent, /custo não informado pelo terminal/);
  assert.doesNotMatch(p.doc.body.textContent, /US\$|sem custo/, 'nenhum US$ 0,00 inventado, nem "sem custo"');

  // Parte com custo: o valor das que tem, com a ressalva de quantas ficaram fora.
  const misto = await painelAoVivo({
    retrato() { const d = dadosAoVivo(); d.sessoes[1].custoUsd = 1.5; return d; },
  });
  assert.match(misto.$('total').textContent, /^2 sessões, US\$\s1,50 no total, sem o custo de 1 sessão do terminal$/);
  assert.match(misto.$('salas').querySelector('.sala__custo').textContent,
    /^US\$\s1,50 sem o custo de 1 sessão do terminal$/);

  const prototipo = await painelCarregado();
  assert.doesNotMatch(prototipo.doc.body.textContent, /não informado pelo terminal|sessão do terminal|sessões do terminal/,
    'no simulado toda sessao tem custo');
});

test('o aviso do navegador e generico nos dois modos: nem o nome da sessao nem o texto do pedido', async function () {
  const ao = await painelAoVivo();
  ao.Notification.permission = 'granted';
  ao.doc.focado = false;
  const fonte = await ligar(ao);
  fonte.emitir('estado', JSON.stringify({ tipo: 'estado', sessao: 'sessao-b', estado: 'precisa',
    pedido: { id: PEDIDO_B, tipo: 'permissao', texto: 'Apagar a pasta build', comando: 'rm -r build' } }), 6);
  const proto = await painelCarregado();
  proto.Notification.permission = 'granted';
  proto.doc.focado = false;
  const s = JSON.parse(SIMULADO).sessoes.find(function (x) { return x.estado === 'trabalhando'; });
  proto.fontes[0].emitir('estado', JSON.stringify({ tipo: 'estado', sessao: s.id, estado: 'precisa',
    pedido: { tipo: 'permissao', texto: 'Apagar a pasta build', comando: 'rm -r build' } }));
  for (const [nome, p] of [['ao vivo', ao], ['prototipo', proto]]) {
    assert.deepStrictEqual(p.problemas, [], nome);
    assert.strictEqual(p.avisos.length, 1, nome + ': o pedido novo gera um aviso');
    assert.strictEqual(p.avisos[0].titulo, 'Uma decisão espera você', nome);
    assert.strictEqual(p.avisos[0].o.body, 'Abra o painel de sessões para ver.', nome);
  }
});
