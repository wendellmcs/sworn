'use strict';
// E3 item 3 (ordem cega): o detector de design roda na preparacao da ronda e o resultado fica num arquivo da ronda que
// nenhum inspetor abre (detector.json, como o mapa.json); so depois dos vereditos o apurar cruza o detector com os
// achados da lente ui-design. Assim a lente julga sem ver o detector, e o cruzamento diz: os dois viram, so o detector
// viu (achado a apurar: a lente deixou passar) ou so a lente viu (o detector nao sabe ler aquilo).
// Camada 1: o fonte do lado do trabalho contra o design.json (design.conferir, com o lado do HEAD descontado: o valor
// que ja estava la nao e da mudanca). Camada 2: o estilo calculado da foto do trabalho (design.conferirComputado), so
// quando a ronda tem --tela-depois e a captura leu o estilo.
// Quem chama: scripts/preparar-revisao.js (montar, ao gravar a ronda) e scripts/apurar-ronda.js (ler e cruzar, ao
// apurar). Quem ajuda: scripts/lib/design.js (as duas camadas) e o formato do veredito (scripts/lib/veredito.js).
const design = require('./design.js');

const ARQUIVO = 'detector.json';
const LENTE = 'ui-design';
// A mesma folga do trecho do achado no apurar (2 linhas acima ou abaixo): a lente cita a linha do valor ou a vizinha.
const PERTO = 2;
// Achados por camada que vao ao arquivo; o resto so conta (`foraDoTeto`), para um CSS gerado nao virar um JSON enorme.
const TETO = 200;

/** A lista cortada no teto, so com os campos que o cruzamento e o fecho usam. */
function cortar(lista, campos) {
  return {
    fora: lista.slice(0, TETO).map(function (a) {
      const o = {};
      for (const c of campos) if (a[c] !== undefined) o[c] = a[c];
      return o;
    }),
    foraDoTeto: Math.max(0, lista.length - TETO)
  };
}

/**
 * O conteudo do detector.json. `trabalho` e `head`: o texto de cada lado como foi gravado na ronda (A.txt/B.txt), de
 * modo que a linha do achado e a mesma que a lente cita; `rotulo`: o rotulo cego do lado do trabalho ('A' ou 'B');
 * `caminho`: o arquivo a partir da raiz do projeto (os desvios dele valem); `estilo`: o estilo calculado da foto do
 * trabalho (evidencia.estilo do capturar-tela.js), ou null sem foto.
 */
function montar(o) {
  // A chave de cada achado (a cor convertida: #fff, #FFFFFF e rgb(255, 255, 255) dao a mesma) e o que casa as camadas.
  const comChave = function (a) { return Object.assign({}, a, { chave: a.chave || design.chaveDoValor(a.valor) }); };
  const fonte = design.conferir(o.trabalho, o.sistema, typeof o.head === 'string' ? o.head : undefined, o.caminho)
    .fora.map(comChave);
  const r = { rotulo: o.rotulo, fonte: cortar(fonte, ['linha', 'valor', 'tipo', 'chave']), tela: null };
  if (o.estilo && typeof o.estilo === 'object') {
    // O valor da tela que a camada 1 ja achou no fonte (a mesma chave, contada na lista inteira, antes do teto) e o
    // mesmo achado visto de novo: conta uma vez so, na camada 1, e aqui fica so a contagem.
    const doFonte = new Set(fonte.map(function (a) { return a.chave; }));
    const daTela = design.conferirComputado(o.estilo, o.sistema, o.caminho);
    const novos = daTela.fora.map(comChave).filter(function (t) { return !doFonte.has(t.chave); });
    r.tela = Object.assign({ feita: !o.estilo.erro }, cortar(novos, ['propriedade', 'valor', 'tipo', 'quantos', 'chave']),
      { tambemNoFonte: daTela.fora.length - novos.length, naoLidos: daTela.naoLidos, conferidos: daTela.conferidos });
  }
  return r;
}

/** A primeira linha do achado da lente ("42", "40-45" ou 42), ou null. */
function linhaDe(v) {
  if (Number.isInteger(v)) return v >= 1 ? v : null;
  const m = /^\s*(\d+)/.exec(typeof v === 'string' ? v : '');
  const n = m ? parseInt(m[1], 10) : 0;
  return n >= 1 ? n : null; // "0" e "0-3" nao sao linha, como o 0 em numero
}

/** O nome da lente sem caixa e sem espaco nas pontas: "UI-Design " e a ui-design. */
function ehDaLente(vd) { return !!vd && typeof vd.lente === 'string' && vd.lente.trim().toLowerCase() === LENTE; }

/**
 * Cruza o detector com os vereditos da ronda (os da ordem normal: os rotulos do detector sao os dela). Um achado da
 * camada 1 casa com um achado da lente no arquivo do trabalho (`<rotulo>.txt`, sem caixa) ate PERTO linhas dele. A
 * camada 2 nao tem linha: o que nela tambem estava no fonte ja saiu no montar, e o resto e so do detector. O achado
 * da lente sem linha que se leia nao casa com nada e vai a `soLente`, com `linha: null`.
 * atalho: casa por linha, nao pelo valor citado no texto da lente. limite: dois valores na mesma linha casam com um
 * achado so da lente. trocar quando: o veredito trouxer o valor citado num campo proprio.
 */
function cruzar(detector, vereditos) {
  const arquivo = String(detector && detector.rotulo) + '.txt';
  const daLente = [];
  for (const vd of vereditos || []) {
    if (!ehDaLente(vd) || !Array.isArray(vd.achados)) continue;
    for (const a of vd.achados) {
      if (!a || typeof a.arquivo !== 'string' || a.arquivo.trim().toLowerCase() !== arquivo.toLowerCase()) continue;
      daLente.push({ linha: linhaDe(a.linha), severidade: a.severidade, descricao: a.descricao, usado: false });
    }
  }
  const lenteEDetector = [];
  const soDetector = [];
  const fonte = detector && detector.fonte && Array.isArray(detector.fonte.fora) ? detector.fonte.fora : [];
  for (const d of fonte) {
    const par = daLente.filter(function (l) {
      return l.linha !== null && Number.isInteger(d.linha) && Math.abs(l.linha - d.linha) <= PERTO;
    });
    if (par.length) {
      par.forEach(function (l) { l.usado = true; });
      lenteEDetector.push({ camada: 'fonte', arquivo: arquivo, linha: d.linha, valor: d.valor, tipo: d.tipo,
        linhasDaLente: par.map(function (l) { return l.linha; }) });
    } else {
      soDetector.push({ camada: 'fonte', arquivo: arquivo, linha: d.linha, valor: d.valor, tipo: d.tipo });
    }
  }
  const tela = detector && detector.tela && Array.isArray(detector.tela.fora) ? detector.tela.fora : [];
  for (const t of tela) soDetector.push({ camada: 'tela', propriedade: t.propriedade, valor: t.valor, tipo: t.tipo });
  const soLente = daLente.filter(function (l) { return !l.usado; }).map(function (l) {
    return { arquivo: arquivo, linha: l.linha, severidade: l.severidade, descricao: l.descricao };
  });
  return { rotulo: detector && detector.rotulo, lenteEDetector, soDetector, soLente,
    foraDoTeto: ((detector && detector.fonte && detector.fonte.foraDoTeto) || 0) +
      ((detector && detector.tela && detector.tela.foraDoTeto) || 0),
    telaFeita: detector && detector.tela ? detector.tela.feita === true : null };
}

module.exports = { ARQUIVO, LENTE, PERTO, TETO, montar, cruzar };
