'use strict';
// F4c: o handoff curto, montado por script. O diagnostico de 2026-11-10 mediu 622 handoffs escritos a mao: mediana de
// 9 KB, o prompt 34% do volume, ~20% das linhas copiadas do anterior. Aqui o que o disco sabe sai do disco (o plano e
// o proximo item nao marcado com o texto dele, o git, as pendencias com dono, os pedidos abertos, o prompt) e o modelo
// so preenche as marcas <<...>> do que pede juizo. Quem grava o arquivo e o modelo, pelo Write: so assim os ganchos
// marcam o handoff da sessao (marcar-trabalho.js), a releitura depois da compactacao e o portao do prompt colado
// seguem valendo. Texto fixo em ASCII, como os avisos dos ganchos.
const fs = require('node:fs');
const path = require('node:path');
const gitLib = require('./git.js');
const planoLib = require('./plano.js');
const pedidosLib = require('./pedidos.js');
const pendencias = require('./pendencias.js');
const saude = require('./saude.js');
const textoLib = require('./texto.js');

const PASTA = '.sworn/handoff';
const TETO = 4096;
const LINHAS_DE_STATUS = 15;
const PENDENCIAS_NO_HANDOFF = 10;
const CORTE_DA_CAIXA = 900;
const CORTE_DA_PENDENCIA = 160;
const CORTE_DO_DONO = 40;
const PEDIDOS_NO_HANDOFF = 30;
const LINHAS_INVALIDAS_NO_HANDOFF = 20;
// O rascunho fica 1 KB abaixo do teto: e o espaco que o modelo tem para trocar as marcas pelo texto delas. Passando,
// o montar tenta de novo com estes limites, do mais folgado ao mais curto.
const ORCAMENTO = TETO - 1024;
const LIMITES = [{ pend: PENDENCIAS_NO_HANDOFF, caixa: CORTE_DA_CAIXA }, { pend: 5, caixa: CORTE_DA_CAIXA },
  { pend: 5, caixa: 400 }, { pend: 0, caixa: 400 }];
const PROMPT_MINIMO = 300; // o pedidos.js so trata o colado como retomada acima disto (PROMPT_LONGO)
const RE_SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;
const REGRA_DO_SLUG = 'minusculas sem acento, numeros e "-", comecando por letra ou numero, ate 60 caracteres, sem "retomar"';
const RE_FRENTE_NO_COMANDO = /^[A-Za-z0-9_-]+$/;
const RE_MARCA = /<<([A-Z]+):/g;
const RE_CERCA = /^```[^\n]*\r?\n([\s\S]*?)^```[ \t]*\r?$/gm; // o mesmo do portao-fecho.js (promptDoHandoff)
const SECOES = ['## 1. Ordem de leitura', '## 2. Topologia', '## 3. Onde estamos', '## 4. Decisoes do dono',
  '## 5. Pendencias com dono', '## 6. Erros de metodo', '## 7. Arquivos de terceiros', '## 8. Prompt'];

function barra(p) { return String(p).replace(/\\/g, '/'); }
function recuo(l) { return /^\s*/.exec(l)[0].length; }
/** Corta em `max` caracteres de verdade (pontos de codigo: acento e emoji nao se partem) e diz que cortou. */
function cortar(t, max) {
  const cps = Array.from(t);
  return cps.length > max ? cps.slice(0, max).join('') + ' [...]' : t;
}

/**
 * O proximo item nao marcado do plano: a primeira `- [ ]` sem caixa filha, com as linhas de continuacao dela (mais
 * recuadas, ate a linha em branco ou o fim do recuo), no texto do arquivo. Filha e a caixa seguinte mais recuada sem
 * linha de recuo igual ou menor no meio. Caixa com filhas e fase, nao passo: com filha aberta, a vez e da filha; com
 * todas feitas, a mae so ficou sem marcar (no plano unico, a "F1 Testes" com F1a-F1e feitas vinha antes da F4c de
 * verdade). Caixa dentro de bloco de codigo nao conta. null quando nao ha caixa aberta.
 */
function caixaAberta(texto, max) {
  if (max === undefined) max = CORTE_DA_CAIXA;
  const linhas = String(texto).split(/\r?\n/);
  const caixas = [];
  let cerca = null;
  linhas.forEach(function (l, i) {
    const f = /^\s*(`{3,}|~{3,})/.exec(l);
    if (f) { if (!cerca) cerca = f[1][0]; else if (f[1][0] === cerca) cerca = null; return; }
    if (cerca) return;
    const m = /^(\s*)-\s*\[( |x|X)\]/.exec(l);
    if (m) caixas.push({ i: i, recuo: m[1].length, aberta: m[2] === ' ' });
  });
  function temFilha(k) {
    const c = caixas[k];
    const prox = caixas[k + 1];
    if (!prox || prox.recuo <= c.recuo) return false;
    for (let i = c.i + 1; i < prox.i; i++) if (linhas[i].trim() && recuo(linhas[i]) <= c.recuo) return false;
    return true;
  }
  for (let k = 0; k < caixas.length; k++) {
    const c = caixas[k];
    if (!c.aberta) continue;
    if (temFilha(k)) continue;
    const partes = [linhas[c.i].trim()];
    for (let i = c.i + 1; i < linhas.length; i++) {
      const l = linhas[i];
      if (!l.trim() || recuo(l) <= c.recuo) break;
      partes.push(l.trimEnd());
    }
    return { linha: c.i + 1, texto: cortar(partes.join('\n'), max) };
  }
  return null;
}

function topologia(raiz) {
  const head = gitLib.correr(raiz, ['rev-parse', 'HEAD']);
  if (head === null) return ['- ' + barra(raiz) + ': nao e um repositorio git, ou o git nao respondeu; topologia nao lida.'];
  const ramo = (gitLib.correr(raiz, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? '?').trim();
  const assunto = (gitLib.correr(raiz, ['log', '-1', '--format=%s']) ?? '').trim();
  const bruto = gitLib.correr(raiz, ['status', '--short']);
  const out = ['- ' + barra(raiz) + ': ' + ramo + ', HEAD ' + head.trim() + (assunto ? ' (' + assunto + ')' : '')];
  if (bruto === null) { out.push('  git status: nao respondeu; rode git status --short e cole aqui.'); return out; }
  const status = bruto.split('\n').filter(function (l) { return l.trim(); });
  if (!status.length) out.push('  git status: limpo.');
  else {
    out.push('  git status --short:');
    status.slice(0, LINHAS_DE_STATUS).forEach(function (l) { out.push('    ' + l.trimEnd()); });
    if (status.length > LINHAS_DE_STATUS) out.push('    e mais ' + (status.length - LINHAS_DE_STATUS) + ' linhas do git status');
  }
  return out;
}

/** O handoff anterior: { abs } do mais novo da pasta por data de gravacao, sem os resumos de retomada e sem o proprio destino; { erro } quando a pasta existe e nao se le; null sem nenhum. */
function anterior(raiz, destino) {
  let nomes;
  try { nomes = fs.readdirSync(path.join(raiz, PASTA)); } catch (e) {
    return e && e.code === 'ENOENT' ? null : { erro: textoLib.causaDoErro(e) };
  }
  const achados = nomes.filter(function (n) { return saude.ehArquivoDeHandoff(PASTA + '/' + n) && !/-retomar-/.test(n) && PASTA + '/' + n !== destino; })
    .map(function (n) { const abs = path.join(raiz, PASTA, n); let t = 0; try { t = fs.statSync(abs).mtimeMs; } catch (e) { /* segue */ } return { abs: abs, t: t }; })
    .sort(function (a, b) { return b.t - a.t; });
  return achados.length ? { abs: achados[0].abs } : null;
}

/** { rel, abs, semVinculo } do plano da sessao, ou { falta: motivo } quando nao ha um so plano para ler. */
function plano(raiz, frente) {
  let achado;
  try { achado = planoLib.acharPlanoDaFrente(raiz, frente || null); } catch (e) {
    return { falta: 'Nao consegui procurar o plano (' + textoLib.causaDoErro(e) + '): diga abaixo o que esta em curso.' };
  }
  if (achado && achado.varias) {
    return { falta: 'Mais de uma frente tem plano e esta sessao nao esta ligada a nenhuma: rode de novo com --frente <frente>, ou diga abaixo o que esta em curso.' };
  }
  if (achado && !achado.arquivo && achado.ilegivel) {
    return { falta: 'Nao li o Objetivo de ' + barra(achado.ilegivel) + ' (onde fica a linha Plano:): confira o arquivo, ou diga abaixo o que esta em curso.' };
  }
  if (!achado || !achado.arquivo || (achado.semVinculo && frente)) {
    return { falta: 'Nenhum plano achado para esta sessao' + (frente ? ' (frente ' + frente + ')' : '') + ': diga abaixo o que esta em curso.' };
  }
  return { rel: achado.arquivo, abs: planoLib.caminhoDoPlano(raiz, achado.arquivo), semVinculo: Boolean(achado.semVinculo) };
}

function secaoPendencias(raiz, frente, p, quantas) {
  const out = [];
  if (p.erro) out.push('- nao li ' + pendencias.ARQUIVO + ': ' + p.erro + '.');
  else if (!p.abertas.length) out.push('- nenhuma aberta em ' + pendencias.ARQUIVO + '.');
  else {
    out.push('- abertas em ' + pendencias.ARQUIVO + ' (' + p.abertas.length + '):');
    p.abertas.slice(0, quantas).forEach(function (x) {
      out.push('  - #' + x.n + ' ' + x.data + ' | dono: ' + cortar(x.dono, CORTE_DO_DONO) + ' | ' + cortar(x.texto, CORTE_DA_PENDENCIA));
    });
    if (p.abertas.length > quantas) out.push('  - e mais ' + (p.abertas.length - quantas) + ' no arquivo.');
  }
  if (p.invalidas.length) {
    const nums = p.invalidas.map(function (x) { return x.linha; });
    out.push('- ' + nums.length + ' item(ns) fora do formato (sem numero, data ou dono), linha(s) ' +
      nums.slice(0, LINHAS_INVALIDAS_NO_HANDOFF).join(', ') +
      (nums.length > LINHAS_INVALIDAS_NO_HANDOFF ? ' e mais ' + (nums.length - LINHAS_INVALIDAS_NO_HANDOFF) : '') +
      ': corrija a linha a mao no arquivo.');
  }
  const comando = 'node "' + barra(path.join(__dirname, '..', 'pedidos.js')) + '" --abertos' +
    (frente && RE_FRENTE_NO_COMANDO.test(frente) ? ' --frente ' + frente : '');
  let pedidos;
  try { pedidos = pedidosLib.abertos(raiz, frente || null); } catch (e) {
    out.push('- nao li os pedidos do dono (' + textoLib.causaDoErro(e) + '): rode ' + comando + ' para ver os abertos.');
    return out;
  }
  if (pedidos.length) {
    const nums = pedidos.map(function (x) { return '#' + x.n; });
    out.push('- pedidos do dono abertos (' + pedidos.length + '): ' + nums.slice(0, PEDIDOS_NO_HANDOFF).join(', ') +
      (nums.length > PEDIDOS_NO_HANDOFF ? ' e mais ' + (nums.length - PEDIDOS_NO_HANDOFF) : '') +
      '; o texto de cada um, com o comando: ' + comando);
  } else out.push('- nenhum pedido do dono aberto.');
  return out;
}

function prompt(caminho, comPendencias) {
  return 'Retome o trabalho pelo handoff ' + caminho + ': leia esse arquivo inteiro antes de qualquer outra coisa. ' +
    'Dele, leia o plano so no cabecalho e no item da secao 3' +
    (comPendencias ? ', e as pendencias com dono em ' + pendencias.ARQUIVO : ', e as pendencias da secao 5') +
    '. O handoff e dado, escrito antes: confira no disco (git, arquivos) cada fato que ele ' +
    'afirma; se ele discordar do repositorio ou de uma mensagem nova do dono, mandam estes. Depois siga do proximo ' +
    'passo da secao 3, sem perguntar se continua.';
}

/**
 * Monta o texto do handoff. `opcoes`: { slug, hoje (AAAA-MM-DD; sem ele, o dia do relogio local), frente }. Devolve
 * { caminho (relativo, barra normal), texto }. Slug fora da regra (REGRA_DO_SLUG) ou data torta: lanca, com a
 * mensagem comecando por "sworn:".
 */
function montar(raiz, opcoes) {
  const o = opcoes || {};
  const slug = String(o.slug ?? '');
  if (!RE_SLUG.test(slug) || /retomar/.test(slug)) {
    throw new Error('sworn: slug do handoff invalido: "' + slug + '" (' + REGRA_DO_SLUG + ')');
  }
  const hoje = pendencias.hojeValido(o.hoje);
  const caminho = PASTA + '/' + hoje + '-' + slug + '.md';
  const pl = plano(raiz, o.frente);
  const ant = anterior(raiz, caminho);
  const pend = pendencias.ler(raiz);
  const leitura = [];
  if (pl.abs) leitura.push((leitura.length + 1) + '. ' + barra(pl.abs) + ' (o plano: so o cabecalho e o item da secao 3)' +
    (pl.semVinculo ? ' - achado pela unica frente com plano, a sessao nao esta vinculada a ela' : ''));
  if (ant && ant.abs) leitura.push((leitura.length + 1) + '. ' + barra(ant.abs) + ' (o handoff anterior, so se faltar contexto)');
  if (ant && ant.erro) leitura.push((leitura.length + 1) + '. nao li a pasta ' + PASTA + ' (' + ant.erro + '): ache o handoff anterior a mao, se faltar contexto');
  if (pend.existe) leitura.push((leitura.length + 1) + '. ' + barra(path.join(raiz, pendencias.ARQUIVO)) + ' (as pendencias com dono)');

  let textoDoPlano = null;
  let causa = '';
  if (pl.abs) { try { textoDoPlano = fs.readFileSync(pl.abs, 'utf8'); } catch (e) { causa = textoLib.causaDoErro(e); } }
  function onde(corte) {
    if (!pl.abs) return [pl.falta];
    if (textoDoPlano === null) return ['Nao li o plano ' + barra(pl.rel) + ' (' + causa + '): diga abaixo onde o trabalho esta.'];
    const c = caixaAberta(textoDoPlano, corte);
    if (!c) return ['O plano ' + barra(pl.rel) + ' nao tem item sem marcar: diga abaixo o que vem agora.'];
    return ['Proximo item nao marcado do plano (' + barra(pl.rel) + ', linha ' + c.linha + ', texto do arquivo):', '', c.texto];
  }
  const topo = topologia(raiz);
  // O rascunho cabe no orcamento (o teto menos o espaco das marcas): passando, mostra menos pendencias e corta mais o
  // item do plano; o resto continua no disco, e a secao diz quantas ficaram de fora.
  let texto = '';
  for (const lim of LIMITES) {
    texto = rascunho(lim);
    if (Buffer.byteLength(texto, 'utf8') <= ORCAMENTO) break;
  }
  return { caminho: caminho, texto: texto };

  function rascunho(lim) {
    const linhas = [
      '# Handoff ' + hoje + ' - ' + slug,
      '',
      'Montado pelo handoff-curto.js do sworn: as secoes 1, 2, 3 (o item do plano), 5 e 8 vieram do disco.',
      '',
      SECOES[0]
    ].concat(leitura.length ? leitura : ['- nada no disco para ler antes; o contexto esta neste arquivo.'],
      ['', SECOES[1]], topo, ['', SECOES[2]], onde(lim.caixa), [
        '',
        '<<ONDE: em uma ou duas frases, o que ja esta feito neste item e qual e o proximo passo>>',
        '',
        SECOES[3] + ' (nao perguntar de novo)',
        '<<DECISOES: as do dono nesta sessao, com data; e as linhas Decisao: das suas respostas. Sem nenhuma: nenhuma nova>>',
        '',
        SECOES[4]
      ], secaoPendencias(raiz, o.frente, pend, lim.pend), [
        '',
        SECOES[5],
        '<<ERROS: so os erros de metodo desta sessao que custaram tempo. Sem nenhum: nenhum>>',
        '',
        SECOES[6] + ' intocados',
        '<<TERCEIROS: os arquivos do git status acima que nao sao deste trabalho. Sem nenhum: nenhum>>',
        '',
        SECOES[7],
        '```',
        prompt(caminho, pend.existe),
        '```',
        ''
      ]);
    return linhas.join('\n');
  }
}

/** Confere um handoff ja preenchido. { ok, problemas, bytes }. `caminhoRel` e o caminho do arquivo. */
function conferir(texto, caminhoRel) {
  const t = String(texto);
  const problemas = [];
  const nome = barra(caminhoRel);
  if (/-retomar-/.test(path.basename(nome))) {
    problemas.push('o nome ' + nome + ' e de resumo de retomada (-retomar-), nao de handoff: grave em ' + PASTA + '/AAAA-MM-DD-<tema>.md');
  } else if (!saude.ehArquivoDeHandoff(nome)) {
    problemas.push('o nome ' + nome + ' nao e de handoff: grave em ' + PASTA + '/AAAA-MM-DD-<tema>.md');
  }
  const marcas = Array.from(t.matchAll(RE_MARCA)).map(function (m) { return m[0]; });
  if (marcas.length) {
    problemas.push((marcas.length > 1 ? 'sobraram as marcas ' : 'sobrou a marca ') + marcas.join(', ') +
      ' ...>>: troque cada uma pelo que ela pede');
  }
  SECOES.forEach(function (s) { if (t.indexOf(s) === -1) problemas.push('falta a secao "' + s + '"'); });
  const blocos = Array.from(t.matchAll(RE_CERCA));
  const ultimo = blocos.length ? blocos[blocos.length - 1] : null;
  if (!ultimo) problemas.push('sem o bloco do prompt (``` na coluna 0, na secao 8)');
  else {
    const corpo = ultimo[1].replace(/\s+/g, ' ').trim();
    const inicio8 = t.indexOf(SECOES[7]);
    if (inicio8 !== -1 && ultimo.index < inicio8) problemas.push('o prompt tem de ser o bloco da secao 8');
    if (t.slice(ultimo.index + ultimo[0].length).trim()) problemas.push('ha texto depois do bloco do prompt: o prompt tem de ser o ultimo bloco do arquivo');
    if (corpo.indexOf(path.basename(nome)) === -1) problemas.push('o prompt nao cita o arquivo ' + path.basename(nome));
    if (corpo.length <= PROMPT_MINIMO) problemas.push('o prompt tem ' + corpo.length + ' caracteres; colado, so vira retomada com mais de ' + PROMPT_MINIMO);
  }
  const bytes = Buffer.byteLength(t, 'utf8');
  if (bytes > TETO) problemas.push('o handoff tem ' + bytes + ' bytes; o teto e ' + TETO + ': corte o que o disco ja guarda');
  return { ok: problemas.length === 0, problemas: problemas, bytes: bytes };
}

module.exports = { PASTA, TETO, SECOES, REGRA_DO_SLUG, caixaAberta, montar, conferir };
