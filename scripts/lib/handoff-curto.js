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
  // a mesma regra de cerca do plano por fatia (fatia.js): o ```js dentro de um ```` nao fecha o bloco
  const dentro = require('./fatia.js').dentroDeCerca(linhas);
  linhas.forEach(function (l, i) {
    if (dentro[i]) return;
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

const STATUS_NAO_RESPONDEU = '  git status: nao respondeu; rode git status --short e cole aqui.';
function topologia(raiz) {
  const head = gitLib.correr(raiz, ['rev-parse', 'HEAD']);
  if (head === null) return ['- ' + barra(raiz) + ': nao e um repositorio git, ou o git nao respondeu; topologia nao lida.'];
  const ramo = (gitLib.correr(raiz, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? '?').trim();
  const assunto = (gitLib.correr(raiz, ['log', '-1', '--format=%s']) ?? '').trim();
  const bruto = gitLib.correr(raiz, ['status', '--short']);
  const out = ['- ' + barra(raiz) + ': ' + ramo + ', HEAD ' + head.trim() + (assunto ? ' (' + assunto + ')' : '')];
  if (bruto === null) { out.push(STATUS_NAO_RESPONDEU); return out; }
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
  return { rel: achado.arquivo, abs: planoLib.caminhoDoPlano(raiz, achado.arquivo), semVinculo: Boolean(achado.semVinculo),
    frente: achado.frente || null };
}

/**
 * 0.91.0 (A2, defeito c): a frente dos pedidos da secao 5. Vinculada, a da sessao. Sem vinculo, com o plano achado
 * pela unica frente com plano, a dessa frente (a do trabalho que a secao 3 aponta), e os sem frente so com a conta:
 * no sem-frente.md desta frente, 203 abertos eram quase todos sondas "responda so: ok" do claude -p.
 */
function frenteDosPedidos(frente, pl) {
  if (!frente && pl.semVinculo && RE_FRENTE_NO_COMANDO.test(pl.frente || '')) return { frente: pl.frente, semFrenteTambem: true };
  return { frente: frente || null, semFrenteTambem: false };
}

const PEDIDOS_NAO_LIDOS = '- nao li os pedidos do dono (';
function secaoPendencias(raiz, fp, p, quantas) {
  const frente = fp.frente;
  const out = [];
  if (p.erro) out.push('- nao li ' + pendencias.ARQUIVO + ': ' + p.erro + '.');
  else if (!p.abertas.length) out.push('- nenhuma aberta em ' + pendencias.ARQUIVO + '.');
  // 0.91.0 (A2, defeito b): no ultimo limite nenhuma cabe; "(N):" seguido so de "e mais N" parecia lista vazia
  else if (quantas === 0) out.push('- abertas em ' + pendencias.ARQUIVO + ' (' + p.abertas.length + '): o texto delas nao coube aqui; leia no arquivo.');
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
  let pedidos = null;
  try { pedidos = pedidosLib.abertos(raiz, frente || null); } catch (e) {
    out.push(PEDIDOS_NAO_LIDOS + textoLib.causaDoErro(e) + '): rode ' + comando + ' para ver os abertos.');
  }
  if (pedidos && pedidos.length) {
    const nums = pedidos.map(function (x) { return '#' + x.n; });
    out.push('- pedidos do dono abertos (' + pedidos.length + '): ' + nums.slice(0, PEDIDOS_NO_HANDOFF).join(', ') +
      (nums.length > PEDIDOS_NO_HANDOFF ? ' e mais ' + (nums.length - PEDIDOS_NO_HANDOFF) : '') +
      '; o texto de cada um, com o comando: ' + comando);
  } else if (pedidos) out.push('- nenhum pedido do dono aberto.');
  if (fp.semFrenteTambem) {
    const semFrente = 'node "' + barra(path.join(__dirname, '..', 'pedidos.js')) + '" --abertos';
    try {
      const soltos = pedidosLib.abertos(raiz, null);
      if (soltos.length) out.push('- pedidos sem frente abertos (' + soltos.length + '): o texto, com o comando: ' + semFrente);
    } catch (e) { out.push('- nao li os pedidos sem frente (' + textoLib.causaDoErro(e) + '): rode ' + semFrente + '.'); }
  }
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
  // H6d (D896): o comando da fatia imprime o cabecalho e o proximo item sem marcar, com as linhas do arquivo. O caminho
  // com caractere que o shell expande entre aspas ($, crase, aspas, !) fica fora: sem --plano, o plano.js acha o mesmo.
  // A pasta do sworn com um desses caracteres deixa o comando inteiro de fora (fatia.comandoDaFatia, revisao R2, borda).
  const cmd = require('./fatia.js').comandoDaFatia(path.join(__dirname, '..', 'plano.js'), barra(pl.rel));
  if (pl.abs) leitura.push((leitura.length + 1) + '. ' + barra(pl.abs) + ' (o plano: so o cabecalho e o item da secao 3' +
    (cmd ? ', pelo ' + cmd : '') + ')' +
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
      ], secaoPendencias(raiz, frenteDosPedidos(o.frente, pl), pend, lim.pend), [
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

// H6a2 (D892, defeito 3): as linhas que o secaoPendencias escreve; o resto da secao 5 e do modelo e fica.
// O "- nao li " vai com o que vem depois dele no secaoPendencias: uma linha do modelo que abre por "- nao li " fica.
// Cada forma vai inteira, como o secaoPendencias escreve: uma linha do modelo que so comeca igual ("  - #7 decidido...")
// fica.
// 0.91.0 (A2): mais tres formas, a linha unica das pendencias sem espaco e as duas dos pedidos sem frente. Elas ficam
// fora do RE_PEDIDOS_GRAVADOS: com os pedidos da frente ilegiveis, o refazer repoe as gravadas e a dos sem frente
// sairia duas vezes.
const RE_PEDIDOS_GRAVADOS = /^(- pedidos do dono abertos \(\d+\): .*; o texto de cada um, com o comando: |- nenhum pedido do dono aberto\.$)/;
const RE_PENDENCIA_MECANICA = new RegExp('^(- abertas em \\.sworn/PENDENCIAS\\.md \\(\\d+\\):$|  - #\\d+ \\d{4}-\\d{2}-\\d{2} \\| dono: |' +
  '  - e mais \\d+ no arquivo\\.$|- abertas em \\.sworn/PENDENCIAS\\.md \\(\\d+\\): o texto delas nao coube aqui; leia no arquivo\\.$|' +
  '- pedidos sem frente abertos \\(\\d+\\): o texto, com o comando: node ".*pedidos\\.js" --abertos$|' +
  '- nao li os pedidos sem frente \\(.*\\): rode node ".*pedidos\\.js" --abertos\\.$|- nenhuma aberta em \\.sworn/PENDENCIAS\\.md\\.$|- nao li \\.sworn/PENDENCIAS\\.md: |' +
  '- nao li os pedidos do dono \\(.*\\): rode .* para ver os abertos\\.$|' +
  '- \\d+ item\\(ns\\) fora do formato \\(sem numero, data ou dono\\), linha\\(s\\) )|' + RE_PEDIDOS_GRAVADOS.source);
const CABECA_DO_ITEM = 'Proximo item nao marcado do plano (';
// a secao 3 sem item aberto, como o montar e o refazer a escrevem: uma linha so, que o refazer tambem troca
const RE_SEM_ITEM = /^O plano .+ nao tem (mais )?item sem marcar( \(lido antes da compactacao\))?: diga abaixo o que vem agora\.$/;
const RE_REFEITO = /^Refeito pelo gancho PreCompact do sworn em /;
function dois(n) { return String(n).padStart(2, '0'); }
function mesmaRaiz(a, b) { return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b; }

/**
 * H6a2 (D892, defeito 3): refaz, num handoff ja preenchido, so o que o disco sabe, para o gancho PreCompact
 * (antes-do-compact.js): na secao 2, o bloco deste repo (HEAD, assunto, git status); na 3, o item do plano, quando a
 * secao ainda abre pelo bloco que o montar escreveu; na 5, as linhas do secaoPendencias. Os outros repos da secao 2,
 * o paragrafo de julgamento da 3, as linhas do modelo na 5 e as secoes 1, 4, 6, 7 e 8 ficam como estavam. O que o
 * disco nao responde agora (git, plano, pendencias) deixa o trecho gravado. Passando do TETO com todos os LIMITES, ou
 * sem as 8 secoes em ordem, volta o texto como veio. `opcoes`: { frente, agora (Date) }. Devolve { texto, mudou }.
 */
function refazer(raiz, texto, opcoes) {
  const o = opcoes || {};
  const t = String(texto);
  const igual = { texto: t, mudou: false };
  const nl = /\r\n/.test(t) ? '\r\n' : '\n';
  const linhas = t.split(/\r?\n/);
  const ini = SECOES.map(function (s) { return linhas.findIndex(function (l) { return l.startsWith(s); }); });
  if (ini.some(function (v, k) { return v === -1 || (k > 0 && v <= ini[k - 1]); })) return igual;
  const corpo = function (k) { return linhas.slice(ini[k] + 1, k + 1 < ini.length ? ini[k + 1] : linhas.length); };

  const topo = topologia(raiz);
  // so o HEAD respondeu (o status nao): a secao 2 gravada fica, como quando o git nao responde nada
  const comGit = topo.length > 1 && topo.indexOf(STATUS_NAO_RESPONDEU) === -1;
  const pl = plano(raiz, o.frente);
  let textoDoPlano = null;
  if (pl.abs) { try { textoDoPlano = fs.readFileSync(pl.abs, 'utf8'); } catch (e) { /* o item gravado fica */ } }
  const pend = pendencias.ler(raiz);

  function secao2() {
    const b = corpo(1);
    if (!comGit) return b;
    const cabeca = '- ' + barra(raiz) + ':';
    const i = b.findIndex(function (l) { return mesmaRaiz(l.slice(0, cabeca.length), cabeca); });
    if (i === -1) return topo.concat(b);
    let f = i + 1;
    while (f < b.length && /^ {2}/.test(b[f])) f++; // o "  git status" e as linhas "    " dele
    return b.slice(0, i).concat(topo, b.slice(f));
  }
  function secao3(corte) {
    const b = corpo(2);
    let i = 0;
    while (i < b.length && !b[i].trim()) i++;
    const semItem = i < b.length && RE_SEM_ITEM.test(b[i]);
    if (i >= b.length || !(semItem || b[i].startsWith(CABECA_DO_ITEM)) || textoDoPlano === null) return b;
    let f = i + 1;
    if (!semItem) {
      while (f < b.length && !b[f].trim()) f++;
      while (f < b.length && b[f].trim()) f++;
    }
    const c = caixaAberta(textoDoPlano, corte);
    const novo = c ? [CABECA_DO_ITEM + barra(pl.rel) + ', linha ' + c.linha + ', texto do arquivo):', ''].concat(c.texto.split('\n'))
      : ['O plano ' + barra(pl.rel) + ' nao tem mais item sem marcar (lido antes da compactacao): diga abaixo o que vem agora.'];
    return b.slice(0, i).concat(novo, b.slice(f));
  }
  function secao5(quantas) {
    const b = corpo(4);
    if (pend.erro) return b;
    const novo = secaoPendencias(raiz, frenteDosPedidos(o.frente, pl), pend, quantas);
    // os pedidos nao se leem agora: a linha deles que ja estava gravada fica no lugar do aviso
    const gravados = b.filter(function (l) { return RE_PEDIDOS_GRAVADOS.test(l); });
    const k = novo.findIndex(function (l) { return l.startsWith(PEDIDOS_NAO_LIDOS); });
    if (k !== -1 && gravados.length) novo.splice(k, 1, ...gravados);
    return novo.concat(b.filter(function (l) { return !RE_PENDENCIA_MECANICA.test(l); }));
  }
  const agora = o.agora instanceof Date && !isNaN(o.agora) ? o.agora : new Date();
  const refeito = 'Refeito pelo gancho PreCompact do sworn em ' + agora.getFullYear() + '-' + dois(agora.getMonth() + 1) + '-' +
    dois(agora.getDate()) + ' ' + dois(agora.getHours()) + ':' + dois(agora.getMinutes()) +
    ': as secoes 2, 3 (o item do plano) e 5 sairam do disco de novo; as de julgamento ficaram como estavam.';
  function montarCom(lim) {
    const cabeca = linhas.slice(0, ini[0]).filter(function (l) { return !RE_REFEITO.test(l); });
    const montado = cabeca.findIndex(function (l) { return l.startsWith('Montado pelo handoff-curto.js'); });
    if (montado !== -1) cabeca.splice(montado + 1, 0, refeito);
    else cabeca.splice(cabeca.length && !cabeca[cabeca.length - 1].trim() ? cabeca.length - 1 : cabeca.length, 0, refeito);
    const partes = cabeca;
    for (let k = 0; k < SECOES.length; k++) {
      partes.push(linhas[ini[k]]);
      const b = k === 1 ? secao2() : k === 2 ? secao3(lim.caixa) : k === 4 ? secao5(lim.pend) : corpo(k);
      for (const l of b) partes.push(l);
    }
    return partes.join(nl);
  }
  const semRefeito = function (x) { return x.split(/\r?\n/).filter(function (l) { return !RE_REFEITO.test(l); }).join('\n'); };
  for (const lim of LIMITES) {
    const novo = montarCom(lim);
    if (Buffer.byteLength(novo, 'utf8') > TETO) continue;
    return semRefeito(novo) === semRefeito(t) ? igual : { texto: novo, mudou: true };
  }
  return igual;
}

// R5 (D939, do reversa: o meta-harness confere o que a passagem cita): o handoff que cita entre crases um caminho, um
// simbolo ou o script de um comando que nao existe manda o chat novo atras do que nao ha. A conferencia e a do plano
// (plano-conferir.js), sem as regras de caixa e de requisito, que sao do plano e nao da passagem.
const CITACAO_AUSENTE = ['caminho-inexistente', 'simbolo-ausente', 'comando-sem-script'];

/**
 * Confere um handoff ja preenchido. { ok, problemas, bytes }. `caminhoRel` e o caminho do arquivo. Com
 * `opcoes.raiz`, confere tambem no disco o que ele cita entre crases (`opcoes.arquivos`: os do repositorio, para o
 * nome curto); sem a raiz, so a forma.
 */
function conferir(texto, caminhoRel, opcoes) {
  const t = String(texto);
  const problemas = [];
  const op = opcoes || {};
  if (op.raiz) {
    // arquivos null = o git nao respondeu ("nao sei"): o nome curto, sem pasta, so se acharia pela lista, e nao reprova
    const semLista = !Array.isArray(op.arquivos);
    require('./plano-conferir.js').conferir(t, op.raiz, { arquivos: op.arquivos || [] }).achados
      .filter(function (a) { return CITACAO_AUSENTE.indexOf(a.tipo) !== -1; })
      .filter(function (a) { return !(semLista && a.tipo === 'caminho-inexistente' && String(a.valor).indexOf('/') === -1); })
      .forEach(function (a) { problemas.push('a linha ' + a.linha + ' cita `' + a.valor + '`: ' + a.motivo); });
  }
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

/**
 * R5 (D939): o aviso do gancho que ve o handoff gravado: as citacoes que nao existem no disco, numa linha, ou null.
 * Liga sozinho no Write (marcar-trabalho.js), sem esperar o --conferir da skill.
 */
function avisoDeCitacao(raiz, abs) {
  let texto;
  try { texto = fs.readFileSync(abs, 'utf8'); } catch (e) { return null; }
  const p = conferir(texto, barra(path.relative(raiz, abs)), { raiz: raiz, arquivos: gitLib.rastreados(raiz) })
    .problemas.filter(function (x) { return /^a linha \d+ cita /.test(x); });
  if (!p.length) return null;
  return 'sworn: o handoff ' + path.basename(abs) + ' cita o que nao existe no disco: ' + p.slice(0, 3).join('; ') +
    (p.length > 3 ? ' (e mais ' + (p.length - 3) + ')' : '') + '. Corrija com Edit antes de seguir.';
}

module.exports = { PASTA, TETO, SECOES, REGRA_DO_SLUG, caixaAberta, montar, refazer, conferir, avisoDeCitacao };
