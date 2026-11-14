'use strict';
// F4e: o guia de uso de cada familia de modelo Claude (modelos/claude/<familia>.md). Cada guia e destilado das paginas
// oficiais da Anthropic ("Prompting Claude <modelo>", "What's new in <modelo>") e diz de onde veio: a linha `source:`
// com o endereco, o dia da leitura e a impressao digital da pagina (sha256, 16 hex), e cada item com a marca [n] de uma
// citacao literal em "## Citations". A secao "## How to ask" e escrita para o proprio modelo: e o bloco que entra no
// pedido do subagente que roda nele (bloco). O guia so muda com o sim do dono (a conferencia propoe, nao troca).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { apelidoDoId } = require('./efetivo.js');

const FAMILIAS = ['haiku', 'sonnet', 'opus', 'fable'];
const PASTA = 'modelos/claude';
const TETO_DO_GUIA = 6144;
const TETO_DO_PEDIDO = 1200;
const SECOES = ['## What it is for', '## Recommended effort', '## What to ask', '## How to ask', '## What to avoid', '## Citations'];
const RE_SOURCE = /^source: (https:\/\/\S+) \| read (\d{4}-\d{2}-\d{2}) \| fingerprint ([0-9a-f]{16})$/;
const RE_MODEL = /^model: (claude-[a-z0-9-]+)$/;
const RE_CITACAO = /^\[(\d+)\] source (\d+): "(.+)"$/;
const RE_MARCAS_NO_FIM = /\s*\[\d+\](?:\s*\[\d+\])*\s*$/;
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;

/** sha256 do texto da pagina, nos 16 primeiros hex: o que a conferencia compara para saber se a pagina mudou. */
function impressao(texto) {
  return crypto.createHash('sha256').update(String(texto)).digest('hex').slice(0, 16);
}

function linhasDo(texto) {
  return String(texto).split(/\r?\n/);
}

/** O corpo da secao `titulo` (as linhas ate a proxima "## "), ou null sem a secao. */
function secao(linhas, titulo) {
  const i = linhas.indexOf(titulo);
  if (i === -1) return null;
  const out = [];
  for (let k = i + 1; k < linhas.length && !/^## /.test(linhas[k]); k++) out.push(linhas[k]);
  return out;
}

function modeloDo(linhas) {
  for (const l of linhas) {
    const m = RE_MODEL.exec(l);
    if (m) return m[1];
  }
  return '';
}

function fontesDo(linhas) {
  return linhas.filter(function (l) { return /^source: /.test(l); }).map(function (l) {
    const m = RE_SOURCE.exec(l);
    return m ? { url: m[1], lida: m[2], impressao: m[3] } : { torta: l };
  });
}

/** As citacoes de "## Citations": { mapa: {n: {fonte, trecho}}, repetidas: [n], tortas: [linha] }. */
function citacoesDo(linhas) {
  const r = { mapa: {}, repetidas: [], tortas: [] };
  (secao(linhas, '## Citations') || []).forEach(function (l) {
    const t = l.trim();
    if (!t) return;
    const m = RE_CITACAO.exec(t);
    if (!m) { r.tortas.push(t); return; }
    if (r.mapa[m[1]]) r.repetidas.push(m[1]);
    else r.mapa[m[1]] = { fonte: Number(m[2]), trecho: m[3] };
  });
  return r;
}

function diaValido(d) {
  if (typeof d !== 'string' || !RE_DIA.test(d)) return false;
  const t = Date.parse(d + 'T00:00:00Z');
  return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
}

function blocoDoTexto(texto) {
  const linhas = linhasDo(texto);
  const modelo = modeloDo(linhas);
  const itens = (secao(linhas, '## How to ask') || []).filter(function (l) { return /^- /.test(l); })
    .map(function (l) { return l.replace(/\s*\[\d+\]/g, '').trimEnd(); });
  if (!modelo || !itens.length) return '';
  return 'Guidance for ' + modelo + " (from Anthropic's official prompting guide):\n" + itens.join('\n');
}

/** Os problemas de formato do guia (lista vazia: passa). Com `familia`, a linha model tem de ser dessa familia. */
function conferirFormato(texto, familia) {
  const t = String(texto);
  const linhas = linhasDo(t);
  const problemas = [];
  const modelo = modeloDo(linhas);
  if (!modelo) problemas.push('sem linha model: claude-<familia>-<versao>');
  else if (familia && apelidoDoId(modelo) !== familia) {
    problemas.push('a linha model e de ' + modelo + ', e o guia e da familia ' + familia + ': ' + PASTA + '/' + familia +
      '.md leva um modelo dessa familia');
  }
  const fontes = fontesDo(linhas);
  if (!fontes.length) problemas.push('sem linha source: <endereco> | read AAAA-MM-DD | fingerprint <16 hex>');
  fontes.forEach(function (f) {
    if (f.torta) problemas.push('linha source fora do formato: ' + f.torta);
    else if (!diaValido(f.lida)) problemas.push('linha source com um dia que nao existe (' + f.lida + '): ' + f.url);
  });
  SECOES.forEach(function (s) { if (linhas.indexOf(s) === -1) problemas.push('falta a secao "' + s + '"'); });
  const cit = citacoesDo(linhas);
  cit.tortas.forEach(function (l) { problemas.push('linha fora do formato em ## Citations: ' + l + ' (o formato e [n] source K: "trecho")'); });
  cit.repetidas.forEach(function (n) { problemas.push('[' + n + '] aparece mais de uma vez em ## Citations'); });
  const itens = linhas.filter(function (l) { return /^- /.test(l); });
  itens.forEach(function (l) {
    if (!RE_MARCAS_NO_FIM.test(l)) problemas.push('item sem a marca [n] no fim: ' + l.slice(0, 80));
    else if (l.replace(/\s*\[\d+\]/g, '').trim() === '-') problemas.push('item sem texto antes da marca: ' + l.slice(0, 80));
  });
  const marcas = new Set(Array.from(itens.join('\n').matchAll(/\[(\d+)\]/g)).map(function (m) { return m[1]; }));
  marcas.forEach(function (n) { if (!cit.mapa[n]) problemas.push('[' + n + '] sem entrada em ## Citations'); });
  Object.keys(cit.mapa).forEach(function (n) {
    const c = cit.mapa[n];
    if (c.fonte < 1 || c.fonte > fontes.length) problemas.push('[' + n + '] cita a source ' + c.fonte + ', e o guia tem ' + fontes.length);
  });
  const bytes = Buffer.byteLength(t, 'utf8');
  if (bytes > TETO_DO_GUIA) {
    problemas.push('o guia tem ' + bytes + ' bytes; o teto do guia e ' + TETO_DO_GUIA + ': corte ' + (bytes - TETO_DO_GUIA) + ' bytes');
  }
  const pedido = Buffer.byteLength(blocoDoTexto(t), 'utf8');
  if (pedido > TETO_DO_PEDIDO) {
    problemas.push('a secao How to ask vira ' + pedido + ' bytes; o teto do bloco do pedido e ' + TETO_DO_PEDIDO + ': corte ' +
      (pedido - TETO_DO_PEDIDO) + ' bytes dos itens de How to ask');
  }
  return problemas;
}

/** Texto comparavel: sem marcacao de markdown, com aspas, travessoes, reticencias e espacos tipograficos normalizados. */
function plano(t) {
  return String(t).replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '')
    .replace(/[‘’‛′]/g, "'").replace(/[“”″]/g, '"')
    .replace(/[–—]/g, '-').replace(/…/g, '...').replace(/\s+/g, ' ').trim();
}

/** As citacoes do guia que nao sao trecho literal da pagina que citam (`paginas`: o texto de cada source, na ordem). */
function citacoesQueNaoConferem(texto, paginas) {
  const linhas = linhasDo(texto);
  const citacoes = citacoesDo(linhas).mapa;
  const nFontes = fontesDo(linhas).length;
  const lidas = Array.isArray(paginas) ? paginas : [];
  const out = [];
  Object.keys(citacoes).sort(function (a, b) { return a - b; }).forEach(function (n) {
    const c = citacoes[n];
    const pagina = lidas[c.fonte - 1];
    if (!plano(c.trecho)) {
      out.push('[' + n + '] o trecho fica vazio sem a marcacao: cite um trecho com texto da source ' + c.fonte);
    } else if (!nFontes) {
      out.push('[' + n + '] cita a source ' + c.fonte + ', e o guia nao tem linha source: acrescente a linha source da pagina citada');
    } else if (c.fonte < 1 || c.fonte > nFontes) {
      out.push('[' + n + '] cita a source ' + c.fonte + ', e o guia so tem ' + nFontes + (nFontes === 1 ? ' linha source' : ' linhas source') +
        ': troque pelo numero de uma delas');
    } else if (typeof pagina !== 'string') {
      out.push('[' + n + '] cita a source ' + c.fonte + ', e a pagina dela nao veio: passe a pagina de cada source, na ordem das linhas source');
    } else if (plano(pagina).indexOf(plano(c.trecho)) === -1) {
      out.push('[' + n + '] "' + c.trecho + '" nao esta na source ' + c.fonte);
    }
  });
  return out;
}

/** O guia da familia: { texto, modelo, fontes (as do formato) } ou { erro }. */
function ler(raiz, familia) {
  if (FAMILIAS.indexOf(familia) === -1) return { erro: 'familia desconhecida: ' + familia + ' (as familias sao ' + FAMILIAS.join(', ') + ')' };
  const arquivo = PASTA + '/' + familia + '.md';
  let texto;
  try { texto = fs.readFileSync(path.join(raiz, PASTA, familia + '.md'), 'utf8'); } catch (e) {
    return { erro: e && e.code === 'ENOENT' ? 'falta o guia ' + arquivo + ': escreva-o no formato dos outros guias da pasta' :
      'nao consegui ler ' + arquivo + ' (' + (e && e.code ? e.code : String(e)) + '): confira se o arquivo existe e pode ser lido, e rode de novo' };
  }
  const linhas = linhasDo(texto);
  return { texto: texto, modelo: modeloDo(linhas), fontes: fontesDo(linhas).filter(function (f) { return !f.torta; }) };
}

/** O guia pronto para entrar: { modelo, bloco }, ou null quando a familia ou o guia nao existe, ou nao passa no formato. */
function pronto(raiz, familia) {
  const g = ler(raiz, familia);
  if (g.erro || conferirFormato(g.texto, familia).length) return null;
  return { modelo: g.modelo, bloco: blocoDoTexto(g.texto) };
}

/** O bloco que entra no pedido do subagente da familia; '' sem guia pronto. */
function bloco(raiz, familia) {
  const p = pronto(raiz, familia);
  return p ? p.bloco : '';
}

/**
 * A familia do modelo que vai rodar o despacho: a do `pedido` (o `model` do Agent, apelido ou id), sem pedido a do
 * `padrao` (o `model` do agents/<nome>.md); `inherit`, ou nenhum dos dois, e a `sessao` (ja o apelido, como o de
 * juiz.modeloDaSessao). '' quando nao e Claude ou nao se sabe. Limite: a variavel CLAUDE_CODE_SUBAGENT_MODEL, que troca o
 * padrao do subagente, nao entra.
 */
function familiaDoDespacho(pedido, padrao, sessao) {
  const p = String(pedido || '').trim() || String(padrao || '').trim();
  const f = !p || p.toLowerCase() === 'inherit' ? String(sessao || '') : apelidoDoId(p);
  return FAMILIAS.indexOf(f) === -1 ? '' : f;
}

const A_TAREFA_VALE_MAIS = 'Where this guidance conflicts with the task above, the task wins.';

/** O `prompt` com o `guia` no fim; sem guia, ou ja terminando no guia (o pedido reenviado como o gancho o reescreveu), fica. */
function comGuia(prompt, guia) {
  const p = String(prompt || '');
  if (!guia || p.trimEnd().endsWith(A_TAREFA_VALE_MAIS)) return p;
  return (p ? p + '\n\n' : '') + guia + '\n' + A_TAREFA_VALE_MAIS;
}

// F4e3: a renovacao. O "Models overview" oficial lista os modelos de hoje; a pagina de cada guia, relida, diz se mudou.
const OVERVIEW = 'https://platform.claude.com/docs/en/about-claude/models/overview.md';
const DIAS_PARA_CONFERIR = 30;
const RE_ID = /claude-(haiku|sonnet|opus|fable)((?:-\d{1,2})+)(?!\d)/g;

/** A versao do id em numeros (claude-opus-5-5 -> [5, 5]); o pedaco de 3 digitos ou mais (a data do id) nao entra. */
function versao(id) {
  return String(id).split('-').slice(2).filter(function (p) { return /^\d{1,2}$/.test(p); }).map(Number);
}

function acima(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** Os ids do `texto` com versao acima da do guia da familia (`atuais[familia]`; familia sem modelo fica fora), sem repetir. */
function modelosNovos(texto, atuais) {
  const vistos = new Set();
  const out = [];
  for (const m of String(texto).matchAll(RE_ID)) {
    const id = 'claude-' + m[1] + m[2];
    if (vistos.has(id) || !atuais[m[1]]) continue;
    vistos.add(id);
    if (acima(versao(id), versao(atuais[m[1]]))) out.push({ familia: m[1], id: id, atual: atuais[m[1]] });
  }
  return out;
}

function mensagemDe(e) {
  return e && e.message ? e.message : String(e);
}

async function lerPagina(buscar, url) {
  const texto = await buscar(url);
  if (typeof texto !== 'string' || !texto.trim()) throw new Error('a pagina veio vazia');
  return texto;
}

/**
 * Rele as paginas de cada guia e o "Models overview" por `buscar(url)` (Promise do texto; rejeita quando a pagina nao
 * abre; texto vazio conta como pagina que nao abriu). Devolve { mudaram: [{familia, url, antes, agora}], novos:
 * [{familia, id, atual}], erros: [{familia, url?, erro}], paginas: [{familia, url, texto}] (so as que mudaram) }. O guia
 * que falta ou nao passa no formato e erro. Nada se grava aqui: o guia so muda com o sim do dono.
 */
async function conferir(raiz, buscar) {
  const r = { mudaram: [], novos: [], erros: [], paginas: [] };
  const atuais = {};
  for (const f of FAMILIAS) {
    const g = ler(raiz, f);
    if (g.erro) { r.erros.push({ familia: f, erro: g.erro }); continue; }
    const problemas = conferirFormato(g.texto, f);
    if (problemas.length) {
      r.erros.push({ familia: f, erro: 'o guia nao passa no formato (' + problemas.join('; ') + '); confira-o com modelos.js --citacoes' });
    }
    if (apelidoDoId(g.modelo) === f) atuais[f] = g.modelo;
    for (const fonte of g.fontes) {
      let texto;
      try { texto = await lerPagina(buscar, fonte.url); } catch (e) {
        r.erros.push({ familia: f, url: fonte.url, erro: mensagemDe(e) });
        continue;
      }
      const agora = impressao(texto);
      if (agora !== fonte.impressao) {
        r.mudaram.push({ familia: f, url: fonte.url, antes: fonte.impressao, agora: agora });
        r.paginas.push({ familia: f, url: fonte.url, texto: texto });
      }
    }
  }
  try { r.novos = modelosNovos(await lerPagina(buscar, OVERVIEW), atuais); } catch (e) {
    r.erros.push({ familia: '', url: OVERVIEW, erro: mensagemDe(e) });
  }
  return r;
}

/** <CLAUDE_CONFIG_DIR ou ~/.claude>/sworn/modelos-conferidos.json: { conferido: AAAA-MM-DD } da ultima conferencia limpa. */
function arquivoDoEstado(env) {
  return path.join(path.dirname(require('./gasto.js').pastaDosProjetos(env)), 'sworn', 'modelos-conferidos.json');
}

/** O dia AAAA-MM-DD de `d` no fuso de quem roda (o dia em que a pessoa conferiu, nao o de Greenwich). */
function diaLocal(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** O dia da ultima conferencia: o mais novo entre as leituras dos guias e o `estado` gravado, sem os dias depois de `hoje`; '' sem nenhum. */
function ultimaConferencia(raiz, estado, hoje) {
  const dias = [];
  FAMILIAS.forEach(function (f) {
    const g = ler(raiz, f);
    if (!g.erro) g.fontes.forEach(function (s) { if (diaValido(s.lida)) dias.push(s.lida); });
  });
  if (estado && diaValido(estado.conferido)) dias.push(estado.conferido);
  return dias.filter(function (d) { return !hoje || d <= hoje; }).sort().pop() || '';
}

/** A linha do lembrete quando a ultima conferencia chega a 30 dias (ou nunca houve, ou nenhum guia abre); '' antes, ou com `hoje` torto. */
function avisoDeRenovacao(raiz, estado, hoje) {
  if (!diaValido(hoje)) return '';
  const comando = 'rode `node "' + path.join(raiz, 'scripts', 'modelos.js').replace(/\\/g, '/') + '" --conferir`';
  if (FAMILIAS.every(function (f) { return ler(raiz, f).erro; })) {
    return '# sworn - guias dos modelos: nenhum guia de ' + PASTA + '/ abriu; ' + comando + ' (ele diz o erro de cada um).';
  }
  const ultima = ultimaConferencia(raiz, estado, hoje);
  if (!ultima) return '# sworn - guias dos modelos: a conferencia nunca foi feita; ' + comando + '.';
  const dias = Math.round((Date.parse(hoje) - Date.parse(ultima)) / 86400000);
  if (dias < DIAS_PARA_CONFERIR) return '';
  return '# sworn - guias dos modelos: a ultima conferencia foi em ' + ultima + ', ha ' + dias + ' dias; ' + comando +
    ' (ele diz se saiu modelo novo ou se a pagina oficial de algum guia mudou).';
}

module.exports = {
  FAMILIAS, PASTA, TETO_DO_GUIA, TETO_DO_PEDIDO, SECOES, OVERVIEW, impressao, conferirFormato, blocoDoTexto,
  citacoesQueNaoConferem, ler, pronto, bloco, familiaDoDespacho, comGuia, modelosNovos, conferir, arquivoDoEstado,
  diaLocal, ultimaConferencia, avisoDeRenovacao
};
