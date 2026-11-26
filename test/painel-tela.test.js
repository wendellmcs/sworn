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
  return doc;
}

// ---- o navegador de mentira ----
// opcoes.carga: o que o fetch de simulado.json faz (recebe as opcoes do fetch, devolve a promessa); sem ela, entrega o
// simulado de verdade, depois de opcoes.mexer(dados), se houver. opcoes.semAbortTimeout: o navegador sem
// AbortSignal.timeout. opcoes.pedirPermissao(retorno, Notification): troca o Notification.requestPermission e recebe
// a dupla do Notification, para mudar a permissao. opcoes.midia: o que o matchMedia devolve.
function abrirPainel(opcoes) {
  opcoes = opcoes || {};
  const doc = criarDocumento();
  const relogio = [];
  const fontes = [];
  const problemas = [];
  const guardado = new Map();
  const pedidos = [];

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
    emitir(tipo, dados) { for (const fn of this.ouvintes.get(tipo) || []) fn.call(this, { type: tipo, data: dados }); }
    close() { this.readyState = 2; }
  }
  FonteFalsa.CONNECTING = 0;
  FonteFalsa.OPEN = 1;
  FonteFalsa.CLOSED = 2;

  class AvisoFalso {
    constructor(titulo, o) { this.titulo = titulo; this.o = o; }
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
    EventSource: FonteFalsa,
    AbortSignal: SinalFalso,
    AbortController,
    fetch(url, o) {
      pedidos.push({ url, o });
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
    doc, janela, fontes, problemas, pedidos, Notification: AvisoFalso,
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
      motivo: /simulado\.json chegou quebrado/ },
    { nome: 'a rede cai',
      carga() { return Promise.reject(new TypeError('Failed to fetch')); },
      motivo: /o servidor não respondeu\. Confira/ },
  ];
  for (const c of casos) {
    const p = abrirPainel({ carga: c.carga });
    await esvaziar();
    const alerta = p.doc.querySelector('[role="alert"]');
    assert.ok(alerta, c.nome + ': a carga que falhou vira o aviso da pagina');
    assert.match(alerta.textContent, c.motivo, c.nome);
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
  assert.strictEqual(p.pedidos.length, 1, 'o painel pede o simulado.json uma vez');
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
