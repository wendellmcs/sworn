#!/usr/bin/env node
'use strict';
/**
 * H14 (pedido 247): monta a apresentacao do sworn, que o GitHub Pages serve em apresentacao/index.html.
 *
 * Entradas, todas publicas: apresentacao/fonte/ (deck.json com a ordem, as secoes e o `versao`; deck.css; slides/,
 * um <section> por arquivo, com as notas do apresentador num <aside>), o CHANGELOG.md (o slide `novidades` sai da
 * secao do topo) e o .claude-plugin/plugin.json (a versao da capa). Marcas que a montagem troca nos slides:
 * {{versao}} e {{versoes}} (quantas versoes o CHANGELOG traz); no slide de novidades, tambem {{titulo}}, {{itens}}
 * e {{mais}}. Marca que sobra para tras e erro.
 *
 * Uso, da raiz do repositorio (quem chama: o mantenedor a cada versao, pela regra de apresentacao/LEIA-ME.md; quem
 * confere: test/apresentacao.test.js, que reprova a pagina velha e o `versao` do deck fora do plugin.json):
 *   node scripts/apresentacao.js            confere: sai 0 com a pagina em dia, 1 com ela velha (ou faltando)
 *   node scripts/apresentacao.js --gravar   grava apresentacao/index.html
 *   node scripts/apresentacao.js --slides <pasta>   grava a fonte com as marcas trocadas (para publicar o deck
 *                                                   no tipo Slides do claude.ai)
 *   --raiz <pasta> troca a raiz (o teste usa uma copia temporaria).
 * Em qualquer modo, sai 2 com a fonte quebrada ou uma opcao errada, e a mensagem diz o arquivo e o que falta.
 */
const fs = require('node:fs');
const path = require('node:path');
const jsonio = require('./lib/jsonio.js');

const FONTE = path.join('apresentacao', 'fonte');
const FONTE_ROTULO = 'apresentacao/fonte';
const PAGINA = path.join('apresentacao', 'index.html');
const ROTULO = 'apresentacao/index.html';
const MAXIMO_DE_ITENS = 6;
// O que entra no slide de novidades, nesta ordem; o resto do CHANGELOG (o "Medido e nao adotado", os "Textos")
// fica de fora, porque a apresentacao so mostra ganho.
const GRUPOS = [
  ['Novo', ['Novo']],
  ['Melhorado', ['Melhorado']],
  ['Mudado', ['Mudado', 'Muda']],
  ['Corrigido', ['Corrigido', 'Corrige']]
];

const lerTexto = (arq) => fs.readFileSync(arq, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
// A secao de uma versao no CHANGELOG: "## X.Y.Z" (com ou sem sufixo como -rc.1) seguido de espaco ou do fim da linha.
const VERSAO = '\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?';
const SECAO = new RegExp('^## ' + VERSAO + '(?:\\s|$)');
const CABECALHO = new RegExp('^## (' + VERSAO + ')\\s+(?:—|-)\\s+(.*)$');

/** O JSON de `arq`, pela leitura unica do jsonio; ausente, ilegivel ou quebrado, o erro diz qual arquivo (`rotulo`) e o motivo. */
function jsonDe(arq, rotulo) {
  const r = jsonio.ler(arq);
  if (r.ausente) throw new Error(rotulo + ': arquivo nao encontrado');
  if (r.etapa) throw new Error(rotulo + ': ' + (r.etapa === 'json' ? 'JSON invalido' : 'nao se leu') + ' (' + r.erro.message + ')');
  return r.valor;
}

function escapar(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // a chave escapada: texto do CHANGELOG com {{...}} nunca vira marca da montagem
    .replace(/\{/g, '&#123;');
}

/** Tira as crases e a pontuacao do fim (. : ;) de um titulo do CHANGELOG. */
function limpar(t) {
  return t.replace(/`/g, '').trim().replace(/[.:;]+$/, '').trim();
}

/** A secao do topo do CHANGELOG: a versao, o titulo e os itens em negrito do que e ganho, ate MAXIMO_DE_ITENS. */
function novidades(changelog) {
  const linhas = String(changelog).replace(/\r\n/g, '\n').split('\n');
  const ini = linhas.findIndex((l) => SECAO.test(l));
  if (ini === -1) throw new Error('CHANGELOG.md sem secao "## X.Y.Z — titulo"');
  const cab = linhas[ini].match(CABECALHO);
  if (!cab) throw new Error('CHANGELOG.md: titulo da secao fora do formato "## X.Y.Z — titulo": ' + linhas[ini]);
  const titulo = limpar(cab[2]);
  let grupo = null;
  const achados = [];
  for (let i = ini + 1; i < linhas.length && !/^## /.test(linhas[i]); i++) {
    const l = linhas[i];
    const sub = l.match(/^\*\*([^*]+)\*\*\s*$/);
    if (sub) {
      const g = GRUPOS.findIndex(([, nomes]) => nomes.includes(sub[1].trim().replace(/:$/, '')));
      grupo = g === -1 ? null : g;
      continue;
    }
    const item = l.match(/^- \*\*(.+?)\*\*/);
    if (item && grupo !== null) achados.push({ grupo, tipo: GRUPOS[grupo][0], texto: limpar(item[1]) });
  }
  if (!achados.length) {
    throw new Error('CHANGELOG.md, secao ' + cab[1] + ': nenhum item "- **...**" em Novo, Melhorado, Mudado ou Corrigido;'
      + ' o slide de novidades sairia vazio');
  }
  const ordenados = achados.sort((a, b) => a.grupo - b.grupo);
  return {
    versao: cab[1],
    titulo: titulo.charAt(0).toUpperCase() + titulo.slice(1),
    itens: ordenados.slice(0, MAXIMO_DE_ITENS).map((a) => ({ tipo: a.tipo, texto: a.texto })),
    mais: Math.max(0, ordenados.length - MAXIMO_DE_ITENS)
  };
}

/** Troca cada {{nome}} de `valores` em `html`; o valor entra como veio (quem chama ja escapou). */
function trocar(html, valores) {
  return html.replace(/\{\{([a-z]+)\}\}/g, (marca, nome) => (Object.hasOwn(valores, nome) ? String(valores[nome]) : marca));
}

/** O slide de novidades a partir do modelo (slides/novidades.html) e do que novidades() leu. */
function slideDeNovidades(modelo, n) {
  const itens = n.itens.map((it, i) => '    <div class="card tight rise" style="--i:' + i + '"><p class="k">'
    + escapar(it.tipo) + '</p><p style="font-size:28px; line-height:1.3; color:#F3F4F6">' + escapar(it.texto)
    + '</p></div>').join('\n');
  const mais = n.mais > 0 ? 'E mais ' + n.mais + (n.mais === 1 ? ' mudança' : ' mudanças') + ' nesta versão. ' : '';
  return trocar(modelo, { versao: escapar(n.versao), titulo: escapar(n.titulo), itens, mais });
}

/** Le a fonte e devolve o deck, o css e cada slide com as marcas trocadas. */
function lerFonte(raiz) {
  const fonte = path.join(raiz, FONTE);
  const deck = jsonDe(path.join(fonte, 'deck.json'), FONTE_ROTULO + '/deck.json');
  const css = lerTexto(path.join(fonte, 'deck.css'));
  const versao = jsonDe(path.join(raiz, '.claude-plugin', 'plugin.json'), '.claude-plugin/plugin.json').version;
  if (typeof versao !== 'string' || !versao) throw new Error('.claude-plugin/plugin.json sem "version"');
  if (!Array.isArray(deck.order) || !deck.order.length) throw new Error('deck.json sem "order": nenhum slide');
  const ruim = deck.order.find((id) => typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id));
  if (ruim !== undefined) throw new Error('deck.json: id de slide fora de [a-z0-9-]: ' + JSON.stringify(ruim));
  if (typeof deck.title !== 'string' || !deck.title.trim()) throw new Error('deck.json sem "title": o titulo da pagina');
  if (!deck.sections || typeof deck.sections !== 'object' || Array.isArray(deck.sections)
    || Object.values(deck.sections).some((s) => !s || typeof s.start !== 'string' || typeof s.description !== 'string')) {
    throw new Error('deck.json: "sections" tem de ser um objeto de { "start": <id do slide>, "description": <nome> }');
  }
  // uma secao que comeca num slide fora de "order" sumiria da barra em silencio
  const solta = Object.entries(deck.sections).find(([, s]) => !deck.order.includes(s.start));
  if (solta) throw new Error('deck.json: a secao "' + solta[0] + '" comeca em "' + solta[1].start + '", que nao esta em "order"');
  if (Object.values(deck.faces || {}).some((x) => !x || typeof x.href !== 'string')) {
    throw new Error('deck.json: cada item de "faces" precisa de "href"');
  }
  const changelog = lerTexto(path.join(raiz, 'CHANGELOG.md'));
  const versoes = changelog.split('\n').filter((l) => SECAO.test(l)).length;
  const slides = deck.order.map((id) => {
    const arq = path.join(fonte, 'slides', id + '.html');
    if (!fs.existsSync(arq)) throw new Error('deck.json lista "' + id + '" em "order", mas falta ' + FONTE_ROTULO + '/slides/' + id + '.html');
    let html = lerTexto(arq);
    if (id === 'novidades') html = slideDeNovidades(html, novidades(changelog));
    html = trocar(html, { versao: escapar(versao), versoes });
    const sobra = html.match(/\{\{[a-z]+\}\}/);
    if (sobra) {
      throw new Error('slides/' + id + '.html: marca sem valor ' + sobra[0] + ' (valem {{versao}} e {{versoes}} em qualquer slide;'
        + ' {{titulo}}, {{itens}} e {{mais}} so em novidades.html)');
    }
    return { id, html: html.trim() };
  });
  return { deck, css, slides };
}

/** Para cada slide, o nome da secao em que ele esta (a ultima secao cujo inicio vem antes dele). */
function secoesPorSlide(deck) {
  const inicios = Object.values(deck.sections).map((s) => ({ i: deck.order.indexOf(s.start), d: s.description }))
    .filter((s) => s.i !== -1).sort((a, b) => a.i - b.i);
  return deck.order.map((_, i) => {
    let d = '';
    for (const s of inicios) if (s.i <= i) d = s.description;
    return d;
  });
}

const CSS_DO_VISOR = `
html, body { margin: 0; height: 100%; background: #0D1117; }
body { display: flex; flex-direction: column; height: 100vh; height: 100dvh; overflow: hidden; }
#visor { position: relative; flex: 1; min-height: 0; overflow: hidden; cursor: pointer; }
#palco { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; transform-origin: 0 0; font: 32px/1.2 sans-serif; }
#palco * { margin: 0; }
#palco h3 { font-size: 44px; font-weight: 600; }
#palco p, #palco li, #palco h3 { overflow-wrap: break-word; text-wrap: pretty; }
#palco > section { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; box-sizing: border-box; overflow: hidden; }
#palco > section:not(.on) { display: none; }
#palco aside { display: none; }
#notas { flex: none; max-height: 34vh; overflow-y: auto; box-sizing: border-box; padding: 14px 16px; background: #161B22; color: #E5E7EB; border-top: 1px solid #30363D; font: 17px/1.5 'DM Sans', Arial, sans-serif; }
#notas[hidden] { display: none; }
#barra { flex: none; display: flex; align-items: center; gap: 8px; box-sizing: border-box; padding: 6px 12px; background: #0D1117; color: #F3F4F6; border-top: 1px solid #30363D; font: 15px/1.2 'DM Sans', Arial, sans-serif; }
#barra button { min-width: 44px; min-height: 44px; padding: 0 12px; border: 1px solid #30363D; border-radius: 10px; background: #161B22; color: #F3F4F6; font: inherit; cursor: pointer; }
#barra button:hover { border-color: #F59E0B; }
#barra button:focus-visible { outline: 3px solid #F59E0B; outline-offset: 2px; }
#barra button[aria-pressed="true"] { background: #F59E0B; border-color: #F59E0B; color: #0D1117; }
#contador { min-width: 64px; text-align: center; font-variant-numeric: tabular-nums; }
#secao { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: #B8C0CC; }
@media (max-width: 480px) { #secao { visibility: hidden; } #b-tela { display: none; } }
@media (prefers-reduced-motion: reduce) { #palco * { animation: none !important; } }
@media print {
  @page { size: 1920px 1080px; margin: 0; }
  html, body { height: auto; overflow: visible; display: block; background: none; }
  #barra, #notas { display: none !important; }
  #visor { overflow: visible; }
  #palco { position: static; transform: none !important; height: auto; }
  #palco > section { display: flex !important; position: relative; break-after: page; }
  #palco * { animation: none !important; }
}`;

const JS_DO_VISOR = `
(function () {
  var slides = Array.prototype.slice.call(document.querySelectorAll('#palco > section'));
  var total = slides.length, atual = 0;
  var visor = document.getElementById('visor'), palco = document.getElementById('palco');
  var contador = document.getElementById('contador'), secao = document.getElementById('secao');
  var notas = document.getElementById('notas'), bNotas = document.getElementById('b-notas');
  var bTela = document.getElementById('b-tela');
  var secoes = JSON.parse(document.getElementById('secoes').textContent);
  slides.forEach(function (s, i) {
    s.setAttribute('role', 'group');
    s.setAttribute('aria-roledescription', 'slide');
    s.setAttribute('aria-label', 'Slide ' + (i + 1) + ' de ' + total);
  });
  function escala() {
    var r = visor.getBoundingClientRect();
    var e = Math.min(r.width / 1920, r.height / 1080);
    palco.style.transform = 'translate(' + (r.width - 1920 * e) / 2 + 'px,' + (r.height - 1080 * e) / 2 + 'px) scale(' + e + ')';
  }
  function ir(n, semHash) {
    n = Math.max(0, Math.min(total - 1, n));
    slides[atual].classList.remove('on');
    slides[atual].setAttribute('aria-hidden', 'true');
    atual = n;
    slides[n].classList.add('on');
    slides[n].removeAttribute('aria-hidden');
    contador.textContent = (n + 1) + ' / ' + total;
    secao.textContent = secoes[n] || '';
    var nota = slides[n].querySelector('aside');
    notas.textContent = nota ? nota.textContent.trim() : '';
    if (!semHash && history.replaceState) history.replaceState(null, '', '#' + (n + 1));
  }
  function doEndereco() {
    var h = location.hash.slice(1);
    try { h = decodeURIComponent(h); } catch (e) { return 0; }
    if (/^\\d+$/.test(h)) return parseInt(h, 10) - 1;
    for (var i = 0; i < total; i++) if (slides[i].id === h) return i;
    return 0;
  }
  function alternarTela() {
    var p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    // o navegador que recusa (iframe sem allowfullscreen, politica de permissao) esconde o botao que nao funciona
    if (p && p.catch) p.catch(function () { bTela.hidden = true; });
  }
  function alternarNotas(abrir) {
    notas.hidden = !abrir;
    bNotas.setAttribute('aria-pressed', abrir ? 'true' : 'false');
    escala();
  }
  document.getElementById('b-ant').addEventListener('click', function () { ir(atual - 1); });
  document.getElementById('b-prox').addEventListener('click', function () { ir(atual + 1); });
  bNotas.addEventListener('click', function () { alternarNotas(notas.hidden); });
  if (document.fullscreenEnabled && document.documentElement.requestFullscreen) {
    bTela.addEventListener('click', alternarTela);
  } else {
    bTela.hidden = true;
  }
  visor.addEventListener('click', function (ev) {
    if (ev.target.closest('a')) return;
    var r = visor.getBoundingClientRect();
    ir(ev.clientX - r.left < r.width / 3 ? atual - 1 : atual + 1);
  });
  var toque = null;
  visor.addEventListener('touchstart', function (ev) {
    toque = ev.touches.length === 1 ? { x: ev.touches[0].clientX, y: ev.touches[0].clientY } : null;
  }, { passive: true });
  visor.addEventListener('touchend', function (ev) {
    if (!toque) return;
    var dx = ev.changedTouches[0].clientX - toque.x, dy = ev.changedTouches[0].clientY - toque.y;
    toque = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { ev.preventDefault(); ir(dx < 0 ? atual + 1 : atual - 1); }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    var k = ev.key;
    if ((k === ' ' || k === 'Enter') && ev.target.closest && ev.target.closest('button, a')) return;
    if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') ir(atual + 1);
    else if (k === 'ArrowLeft' || k === 'PageUp') ir(atual - 1);
    else if (k === 'Home') ir(0);
    else if (k === 'End') ir(total - 1);
    else if (k === 'n' || k === 'N') alternarNotas(notas.hidden);
    else return;
    ev.preventDefault();
  });
  window.addEventListener('hashchange', function () { ir(doEndereco(), true); });
  if (window.ResizeObserver) new ResizeObserver(escala).observe(visor); else window.addEventListener('resize', escala);
  slides.forEach(function (s) { s.setAttribute('aria-hidden', 'true'); });
  alternarNotas(window.matchMedia('(max-width: 700px)').matches);
  ir(doEndereco(), true);
})();`;

/** A pagina inteira: os slides num palco de 1920x1080 escalado para a janela, com a barra de navegacao. */
function montar(raiz) {
  const { deck, css, slides } = lerFonte(raiz);
  const fontes = Object.values(deck.faces || {}).map((f) => '<link rel="stylesheet" href="' + escapar(f.href) + '">');
  const secoes = JSON.stringify(secoesPorSlide(deck)).replace(/</g, '\\u003c');
  return [
    '<!doctype html>',
    '<!-- Gerado por scripts/apresentacao.js a partir de apresentacao/fonte/: nao edite aqui, edite a fonte e rode --gravar. -->',
    '<html lang="pt-BR">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>' + escapar(deck.title) + '</title>',
    '<meta name="description" content="Tudo o que o plugin sworn faz, explicado sem jargão: as travas, o automático, a revisão cega, os ganhos medidos e como usar no seu projeto.">',
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    ...fontes,
    '<style>',
    css.trim(),
    CSS_DO_VISOR.trim(),
    '</style>',
    '</head>',
    '<body>',
    '<main id="visor" aria-label="Apresentação: use as setas ou deslize para trocar de slide; um toque no terço esquerdo volta, no resto avança">',
    '<div id="palco">',
    ...slides.map((s) => s.html),
    '</div>',
    '</main>',
    '<div id="notas" aria-live="polite" hidden></div>',
    '<nav id="barra" aria-label="Navegação da apresentação">',
    '<button id="b-ant" type="button" aria-label="Slide anterior">‹</button>',
    '<span id="contador" aria-live="polite"></span>',
    '<button id="b-prox" type="button" aria-label="Próximo slide">›</button>',
    '<span id="secao"></span>',
    '<button id="b-notas" type="button" aria-pressed="false">Notas</button>',
    '<button id="b-tela" type="button">Tela cheia</button>',
    '</nav>',
    '<script type="application/json" id="secoes">' + secoes + '</script>',
    '<script>' + JS_DO_VISOR.trim() + '</script>',
    '</body>',
    '</html>',
    ''
  ].join('\n');
}

/** Grava a fonte com as marcas trocadas em `destino` (deck.json, deck.css e slides/). */
function gravarSlides(raiz, destino) {
  const { deck, css, slides } = lerFonte(raiz);
  fs.mkdirSync(path.join(destino, 'slides'), { recursive: true });
  fs.writeFileSync(path.join(destino, 'deck.json'), JSON.stringify(deck, null, 2) + '\n');
  fs.writeFileSync(path.join(destino, 'deck.css'), css);
  for (const s of slides) fs.writeFileSync(path.join(destino, 'slides', s.id + '.html'), s.html + '\n');
  return slides.length;
}

/**
 * Se `a` e `b` sao a mesma pasta, pelo caminho real: o link resolvido e, no Windows, a caixa que esta no disco
 * (APRESENTACAO/Fonte e apresentacao/fonte saem iguais). Pasta que nao existe compara pelo caminho absoluto.
 */
function mesmaPasta(a, b) {
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
  return real(a) === real(b);
}

function principal(argv) {
  const valor = (nome) => {
    const i = argv.indexOf(nome);
    const v = i === -1 ? undefined : argv[i + 1];
    return v === undefined || v.startsWith('--') ? null : v;
  };
  try {
    if (argv.includes('--raiz') && !valor('--raiz')) throw new Error('--raiz pede a pasta');
    const raiz = path.resolve(valor('--raiz') || path.join(__dirname, '..'));
    const pagina = path.join(raiz, PAGINA);
    if (argv.includes('--slides')) {
      const destino = valor('--slides');
      if (!destino) throw new Error('--slides pede a pasta de destino');
      if (mesmaPasta(destino, path.join(raiz, FONTE))) throw new Error('--slides gravaria por cima da fonte: escolha outra pasta');
      console.log('gravados: ' + gravarSlides(raiz, path.resolve(destino)) + ' slides em ' + destino);
      return 0;
    }
    const nova = montar(raiz);
    if (argv.includes('--gravar')) {
      fs.writeFileSync(pagina, nova);
      console.log('gravada: ' + ROTULO);
      return 0;
    }
    const atual = fs.existsSync(pagina) ? lerTexto(pagina) : null;
    if (atual === nova) {
      console.log('em dia: ' + ROTULO);
      return 0;
    }
    console.log((atual === null ? 'falta ' : 'desatualizada: ') + ROTULO
      + ' - rode node scripts/apresentacao.js --gravar');
    return 1;
  } catch (e) {
    console.error('ERRO: ' + e.message);
    return 2;
  }
}

if (require.main === module) process.exitCode = principal(process.argv.slice(2));

module.exports = { novidades, slideDeNovidades, lerFonte, montar, gravarSlides, secoesPorSlide, principal };
