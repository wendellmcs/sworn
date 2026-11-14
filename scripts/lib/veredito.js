'use strict';

const diffLinhas = require('./diff-linhas.js');

// Dez LENTES, nao dez copias do mesmo revisor.
// Dez copias acham o mesmo problema dez vezes; dez lentes acham dez classes de problema.
const LENTES = [
  { chave: 'correcao', titulo: 'Correcao e regressao',
    pergunta: 'Qual dos dois quebra? Entrada concreta que produz resultado errado, com arquivo:linha.' },
  // D824 (D3, do mattpocock/skills, code-review/SKILL.md:72): a lente julga contra o pedido da tarefa (pedido.md)
  { chave: 'escopo', titulo: 'Fidelidade ao pedido',
    pergunta: 'Leia o pedido.md (o objetivo e o Dentro da tarefa) e responda: (a) o que o pedido pede e falta ou ' +
      'esta parcial; (b) o que mudou e nao foi pedido (renomeacao, extracao, formatacao junto de correcao funcional); ' +
      '(c) o que parece feito, mas esta errado. Em (a) e (c), cite a linha do pedido.md. Sem pedido.md, so (b).' },
  { chave: 'estados', titulo: 'Estados obrigatorios (codigo)',
    pergunta: 'Erro, vazio, carregando, limite e timeout estao tratados, ou so o caso feliz?' },
  { chave: 'borda', titulo: 'Entrada e borda',
    pergunta: 'null, string vazia, lista vazia, numero negativo, unicode, caminho com espaco, arquivo enorme.' },
  { chave: 'seguranca', titulo: 'Seguranca e dado sensivel',
    pergunta: 'Segredo em texto, log com dado do usuario, entrada nao validada que vira comando ou caminho. ' +
      'Antes de P0, tres conferencias: (1) os chamadores reais, nao o caminho hipotetico; ' +
      '(2) leitura nao e mutacao; (3) desenho deliberado, padrao repetido e coerente no modulo, nao e falha. ' +
      'Sem confirmar a intencao, o achado nasce P2 com pergunta, nunca P0. ' +
      // D820 (D1, da cloudflare/security-audit-skill): a fronteira e a regua; o validarVeredito confere os campos
      'O P0/P1 confirmado traz "fronteira": { "entrada" (a entrada de menor confianca e por onde ela chega), ' +
      '"controle" (o controle que ela atravessa), "efeito" (o dano concreto) }; sem os tres, o veredito volta. ' +
      'A gravidade nao passa do dano que voce mostra: P0 derrota o controle por inteiro com dano concreto; ' +
      'P1 o enfraquece; sem dano dito, P2. O que depende de fato fora do arquivo (proxy, configuracao, implantacao) ' +
      'e pendente, com o "falta" e o "plano" (como verificar sem risco); o pendente sem plano tambem faz o veredito voltar.' },
  { chave: 'manutencao', titulo: 'Legibilidade e manutencao',
    pergunta: 'O que um leitor novo entende errado? Nome que mente, funcao que faz duas coisas, erro engolido.' },
  { chave: 'microcopy', titulo: 'Texto que o usuario le',
    pergunta: 'Mensagem que nao diz o que fazer a seguir, jargao, ingles solto, tom que culpa o usuario.' },
  { chave: 'medidor', titulo: 'Mexeram no medidor',
    pergunta: 'Teste, baseline, threshold, skip ou mock mudaram junto com o codigo que eles cobrem?' },
  { chave: 'design', titulo: 'Fidelidade ao design system (codigo)',
    pergunta: 'Cite o token literal ou a tela irmã de referência. Valor cru, gradiente, sombra larga, card aninhado ou tipografia fluida onde o sistema nao os tem. Sem citar token ou coordenada, o veredito nao conta.' },
  // D553/D554 (0.9.0): a ideia do /ponytail-review, texto nosso. Regra de saida no revisar/SKILL.md (como `escopo`).
  { chave: 'enxuto', titulo: 'Codigo que nao precisava existir',
    pergunta: 'O que dava para nao escrever, e o que o substitui? Cite arquivo:linha do que sobra e do que ja faz o ' +
      'mesmo (funcao da linguagem, da plataforma, dependencia ja instalada, codigo do projeto). Validacao na ' +
      'fronteira, perda de dados, seguranca e acessibilidade nunca sao excesso.' }
];

// D121 mediu: 3 exatas, 1 parcial, 4 contra 4 sem contraparte. A causa nao e
// descuido - a familia de cima e de CODIGO, esta e de TELA. Decisao 8 (2026-09-23):
// convivem declaradas, nao se fundem. Chaves com sufixo para nunca colidir. F6-01 (D335): o titulo tambem
// nao se repete - o inspetor grava o titulo no campo lente, e o apurar casa a refutacao por esse texto -,
// entao os dois que as familias dividiam levam "(codigo)" e "(tela)".
const LENTES_UI = [
  { chave: 'ui-design', titulo: 'Fidelidade ao design system (tela)', pergunta: 'Cite o token literal ou a tela irma de referencia. Valor cru, gradiente, sombra larga, card aninhado ou tipografia fluida onde o sistema nao os tem.' },
  { chave: 'ui-estados', titulo: 'Estados obrigatorios (tela)', pergunta: 'Carregando, vazio, erro e limite estao desenhados, ou so o caso cheio?' },
  { chave: 'ui-responsivo', titulo: 'Responsividade e overflow', pergunta: 'Em qual largura o conteudo vaza, corta ou empilha errado? Diga a largura e o elemento.' },
  { chave: 'ui-a11y', titulo: 'Acessibilidade', pergunta: 'Contraste, alvo de toque, foco visivel, ordem de tabulacao, rotulo de campo e de botao de icone.' },
  { chave: 'ui-microcopy', titulo: 'Microcopy', pergunta: 'Texto que nao diz o que fazer a seguir, jargao, ingles solto, tom que culpa quem le.' },
  { chave: 'ui-antiref', titulo: 'Anti-referencias visuais', pergunta: 'O que parece template generico em vez do produto? Cite o elemento e a tela irma que faz melhor.' },
  { chave: 'ui-correcao', titulo: 'Correcao visual e regressao', pergunta: 'O que funcionava e parou de aparecer, ou aparece em lugar errado? Cite viewport e coordenada.' },
  { chave: 'ui-governanca', titulo: 'Governanca e permissao', pergunta: 'Superficie restrita renderizada sem a permissao que a habilita, ou dado sensivel visivel no print.' }
];

const FAMILIAS = { codigo: LENTES, ui: LENTES_UI };

// D825 (D3b): a lente do pedido (D824) e a `escopo` da familia de codigo. A revisao so de tela a leva tambem: a
// familia de tela segue com 8, e a mudanca so de tela e conferida contra o pedido.md como a de codigo.
const LENTE_DO_PEDIDO = 'escopo';

/** As chaves que a revisao so de tela despacha: as de tela e a do pedido (lista nova a cada chamada). */
function lentesSoTela() {
  return LENTES_UI.map(function (l) { return l.chave; }).concat(LENTE_DO_PEDIDO);
}

// Arquivo so de logica (nao e de estilo e nao monta tela): estas saem da ronda 1. `design` pela decisao do dono de
// 2026-09-29; `medidor` e `escopo` pela D448 (ronda 1 de 41 revisoes: 11 de 13 e 5 de 6 achados refutados na fonte).
// D824: a lente escopo volta ao arquivo so de logica - agora ela julga contra o pedido.md, e o "feito errado" contra o
// pedido vale em qualquer arquivo (antes saia: 5 de 6 achados refutados, sem pedido para citar).
const SAEM_SO_LOGICA = ['design', 'medidor'];

// L2-ver-1 (S7, D426): sem acento e sem diferenca entre a forma composta e a decomposta (NFD separa as marcas, e
// elas saem): o inspetor escreve "Correção e regressão" e o titulo canonico e "Correcao e regressao".
function grafiaSolta(s) { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(); }

/**
 * A chave da lente a partir do que o inspetor escreveu. Em ordem: a chave exata, o titulo exato (so os espacos
 * das pontas saem) e, por fim, a grafia solta (caixa e acento nao contam) quando ela aponta uma lente so, entre
 * as duas familias. null quando nao e nenhuma lente conhecida ou quando a grafia solta serve a duas.
 * L2-ver-4 (S7, D426): "Microcopy" e o titulo da lente de tela e "microcopy" e a chave da de codigo; as formas
 * exatas separam as familias, e "MICROCOPY" nao se adivinha.
 * (Era do gravar-veredito.js; o apurar tambem precisa, RV-02 da D422.)
 */
function chaveDaLente(nome) {
  if (typeof nome !== 'string') return null;
  const todas = LENTES.concat(LENTES_UI);
  const exato = nome.trim();
  const chaveExata = todas.filter(function (l) { return l.chave === exato; });
  if (chaveExata.length === 1) return chaveExata[0].chave;
  const tituloExato = todas.filter(function (l) { return l.titulo === exato; });
  if (tituloExato.length === 1) return tituloExato[0].chave;
  const solta = new Set();
  todas.forEach(function (l) {
    if (grafiaSolta(l.chave) === grafiaSolta(nome) || grafiaSolta(l.titulo) === grafiaSolta(nome)) solta.add(l.chave);
  });
  return solta.size === 1 ? solta.values().next().value : null;
}

/** RV-02: a lente que entra na chave de repeticao e na comparacao da refutacao: a chave canonica, ou o texto normalizado. */
function lenteCanonica(nome) {
  return chaveDaLente(nome) || grafiaSolta(nome);
}

/**
 * A regra de despacho da spec (decisao 8), a mesma da tabela do /sworn:review: so codigo,
 * as 10; so tela, as 8 (e a lente do pedido, lentesSoTela, D825); os dois, as 18. Nada declarado e duvida, e na
 * duvida vao as duas familias - nunca nenhuma, que seria uma revisao sem voto.
 */
function familiasPara(tocaCodigo, tocaTela) {
  if (tocaCodigo && !tocaTela) return ['codigo'];
  if (tocaTela && !tocaCodigo) return ['ui'];
  return ['codigo', 'ui'];
}

// D485 (s106): revisao proporcional ao diff. A faixa vem antes das familias: so comentario, numero ou frase curta
// = 1 inspetor; logica pequena com teste vermelho e mutacao = 2; texto = correcao + microcopy; arquivo novo ou
// logica grande = a tabela de familias (familiasPara). Os cortes 3 e 40 e a dupla correcao + borda sao escolha
// tecnica da s108, nao da D485. Sem medida, identico ao HEAD (nao ha diff para medir) ou estilo: a completa.
const FAIXA_UMA_ATE = 3;
const FAIXA_DUAS_ATE = 40;
const LENTES_DA_FAIXA = { uma: ['correcao'], duas: ['correcao', 'borda'], texto: ['correcao', 'microcopy'] };

function faixaDaMudanca(m) {
  const o = m || {};
  const n = o.linhasMudadas;
  if (o.novo || o.identico || o.estilo || !Number.isInteger(n) || n < 0) return 'completa';
  if (n <= FAIXA_UMA_ATE) return 'uma';
  if (o.texto) return 'texto';
  return n <= FAIXA_DUAS_ATE ? 'duas' : 'completa';
}

/** As chaves das lentes da faixa (copia), ou null na completa: ai vale a tabela de familias. */
function lentesDaFaixa(faixa) {
  return Object.prototype.hasOwnProperty.call(LENTES_DA_FAIXA, faixa) ? LENTES_DA_FAIXA[faixa].slice() : null;
}

// F2d parte c (D828; medido em 2026-11-12 nas revisoes fechadas): na faixa completa, as lentes por risco. Em todo o
// historico, `seguranca` (235 achados) e `enxuto` (516) acharam so 4 P0/P1 cada que nenhuma outra lente achou: a
// `seguranca` sai quando as linhas mudadas, dos dois lados, nao tocam em nada de risco; a `enxuto`, quando a mudanca
// e pequena. As lentes de tela (LENTES_UI) so entram com a foto. `estados` e `borda` seguem separadas (dono,
// 2026-11-12: so 32% dos achados da `estados` a `borda` tambem achava, e 193 P0/P1 foram so dela).
// Na duvida, a lente fica: o padrao e largo de proposito (o falso positivo so custa um inspetor).
const RISCO = /child_process|\bexec(?:Sync|File|FileSync)?\s*\(|\bspawn(?:Sync)?\s*\(|\bfork\s*\(|\beval\s*\(|new\s+Function|\bvm\.|\bfs\.|readFile|writeFile|appendFile|unlink|\brm(?:Sync|dir)?\s*\(|\brename|mkdir|create(?:Read|Write)Stream|\bpath\.|JSON\.parse|process\.(?:env|argv|stdin|cwd)|require\s*\(\s*[^'"\s)]|import\s*\(|\bfetch\s*\(|https?[:.]|\bnet\.|\bdns\.|innerHTML|outerHTML|dangerouslySetInnerHTML|document\.|window\.|localStorage|sessionStorage|cookie|token|secret|senha|password|credencia|credential|\bauth|permiss|sudo|chmod|\bshell\b|powershell|\bbash\b|\bcmd\b/i;
// o arquivo que ja e de risco pelo lugar: gancho, manifesto, configuracao, script de shell
const RISCO_PELO_CAMINHO = /(^|\/)(hooks?|\.claude-plugin|\.codex-plugin|\.github)\/|settings|manifest|package\.json$|\.(sh|ps1|bat|cmd|ya?ml)$/i;

/** F2d (c): as linhas mudadas (os dois lados) ou o caminho tocam em algo de risco para a lente `seguranca`. */
function temRisco(texto, rel) {
  return RISCO.test(String(texto || '')) || RISCO_PELO_CAMINHO.test(String(rel || '').replace(/\\/g, '/'));
}

/**
 * F2d (c): as chaves das lentes da faixa completa. `o.estilo` (arquivo de estilo: entram `design` e `medidor`),
 * `o.risco` (false tira a `seguranca`), `o.grande` (false tira a `enxuto`), `o.fotos` (com foto, entram as de tela).
 * Em `risco` e `grande`, valor ausente conta como "nao sei", e a lente fica. O `estilo` o preparar sempre sabe
 * (design.ehArquivoDeEstilo): so com `true` entram `design` e `medidor`.
 */
function lentesDaCompleta(o) {
  const x = o || {};
  let lista = LENTES.map(function (l) { return l.chave; });
  if (!x.estilo) lista = lista.filter(function (c) { return SAEM_SO_LOGICA.indexOf(c) === -1; });
  if (x.risco === false) lista = lista.filter(function (c) { return c !== 'seguranca'; });
  if (x.grande === false) lista = lista.filter(function (c) { return c !== 'enxuto'; });
  if (x.fotos) lista = lista.concat(LENTES_UI.map(function (l) { return l.chave; }));
  return lista;
}

const SEVERIDADES = ['P0', 'P1', 'P2'];
// Colheita 10-20, lote 3 (vereditos tipados) + 4a (LIDO/INFERIDO): confirmado = LIDO, com severidade e o trecho
// copiado do arquivo citado (o apurar-ronda.js confere no A.txt/B.txt); pendente = INFERIDO, com o fato exato que falta
// e sem severidade, e nao molha a ronda. Rejeitado e o refutados.json, com a prova de quem orquestra.
const ESTADOS = ['confirmado', 'pendente'];

// L3 (A3-03): a faixa completa nao tem lista fixa (a tabela de familias e do orquestrador); o menor numero dela e o do
// arquivo so de logica, as LENTES sem as de SAEM_SO_LOGICA.
const MINIMO_DA_COMPLETA = LENTES.length - SAEM_SO_LOGICA.length;

/** L3 (A3-03): o voto que falta para a apuracao (como a ronda vazia); o codigo deixa o CLI dizer so o que fazer. */
function votoQueFalta(texto) {
  const e = new Error(texto);
  e.codigo = 'VOTO_QUE_FALTA';
  return e;
}

// Ronda 1 do 8c.5: a lente entra na chave. Dois defeitos de lentes diferentes na mesma
// linha sao dois achados; a mesma lente repetindo o mesmo lugar segue sendo um. A
// severidade continua primeiro: o motivo do teto conta os abertos pelo prefixo P0| e P1|.
function chaveAchado(a, lente) {
  return [a.severidade, a.arquivo, a.linha, lente].join('|');
}

// D503/D508 (plano d503, E5): com referencia (R.txt no pacote), cada lado e julgado contra ela. O inspetor segue cego
// a qual lado e o novo; o apurar le o do trabalho pelo mapa.
const RESULTADOS_REFERENCIA = ['vence', 'empata', 'perde'];

// D820 (D1, de cloudflare/security-audit-skill, SKILL.md:138-140 e validate-findings.cjs:561-573): na lente de
// seguranca, o P0/P1 confirmado nomeia a fronteira e o pendente traz o plano de como verificar. Sem eles o veredito
// inteiro e regravado (errosDoVeredito), e o achado tambem sai dos validos (validarVeredito), como o sem trecho.
const LENTE_SEGURANCA = 'seguranca';
const CAMPOS_FRONTEIRA = ['entrada', 'controle', 'efeito'];
const temTexto = function (x) { return typeof x === 'string' && x.trim() !== ''; };
function fronteiraInteira(f) {
  // texto solto ou lista no lugar do objeto nao tem os campos: o temTexto de cada um ja os recusa
  return !!f && CAMPOS_FRONTEIRA.every(function (c) { return temTexto(f[c]); });
}
// F2b (D828): todo P2 confirmado diz o tipo. Sem ele (ou com outro valor) o veredito inteiro e regravado
// (errosDoVeredito): contar o P2 sem tipo como erro, como antes, fazia a melhoria segurar a ronda.
const TIPOS_DO_P2 = ['erro', 'melhoria'];
/** O `tipo` do achado sem espaco nas pontas e em minuscula, como a severidade; null quando nao e erro nem melhoria. */
function tipoDoP2(a) {
  const t = a && typeof a.tipo === 'string' ? a.tipo.trim().toLowerCase() : '';
  return TIPOS_DO_P2.indexOf(t) === -1 ? null : t;
}
/** D823: o P2 que o inspetor marcou `tipo: "melhoria"`; o de `tipo: "erro"` segura a ronda. */
function ehMelhoria(a) { return !!a && a.severidade === 'P2' && tipoDoP2(a) === 'melhoria'; }

/** A severidade do achado confirmado, em maiuscula e sem espaco nas pontas; '' no pendente e no que nao tem. */
function severidadeDoConfirmado(a) {
  return a && a.estado === 'confirmado' && typeof a.severidade === 'string' ? a.severidade.trim().toUpperCase() : '';
}

/** O confirmado P0/P1 (em qualquer grafia de caixa e espaco) e o que precisa da fronteira. */
function precisaFronteira(a) {
  const s = severidadeDoConfirmado(a);
  return s === 'P0' || s === 'P1';
}

// D223 e D228 (ronda 2 do 8c.10): o que invalida o veredito inteiro, e nao so um achado. O
// apurar-ronda.js para nestes, como no ilegivel, e o apurar os recusa; o validarVeredito os
// devolve junto dos erros de achado, que so descartam o achado.
// opcoes (opcional): { comReferencia } - true quando o pacote tem R.txt; ai vsReferencia e lacunas sao exigidos.
// Sem opcoes (ou com comReferencia falso), os dois campos nao se olham: e a regra da revisao sem referencia.
function errosDoVeredito(vd, opcoes) {
  if (!vd || typeof vd !== 'object') return ['veredito nao e objeto'];
  const erros = [];
  // D822 (P2 da D820): a lente que nao e texto (um numero, uma lista) virava texto por String() e escapava das
  // regras da lente de seguranca; e o mesmo erro da lente ausente
  if (typeof vd.lente !== 'string' || vd.lente.trim() === '') erros.push('veredito sem lente');
  if (['A', 'B', 'empate'].indexOf(vd.melhor) === -1) erros.push('melhor tem de ser A, B ou empate');
  if (!Array.isArray(vd.achados)) erros.push('achados tem de ser lista, vazia quando nao ha achado');
  // Lote 3/4a: sem estado o veredito e do formato de antes, e para a apuracao (descartar o achado secaria a ronda).
  const semEstado = Array.isArray(vd.achados) ? vd.achados.filter(function (a) {
    return !a || ESTADOS.indexOf(a.estado) === -1;
  }).length : 0;
  if (semEstado) {
    erros.push(semEstado + ' achado(s) sem estado: cada achado e "confirmado" (com severidade e o trecho copiado do ' +
      'arquivo citado) ou "pendente" (com o fato que falta em "falta", sem severidade); regrave o veredito');
  }
  // R3 do lote 3/4a (D672): o confirmado sem trecho tambem para a apuracao, pelo mesmo motivo.
  const semTrecho = Array.isArray(vd.achados) ? vd.achados.filter(function (a) {
    return a && a.estado === 'confirmado' && (typeof a.trecho !== 'string' || a.trecho.trim() === '');
  }).length : 0;
  if (semTrecho) {
    erros.push(semTrecho + ' achado(s) confirmado(s) sem trecho: copie do arquivo citado o texto da linha que mostra ' +
      'o defeito, ou marque o achado como "pendente"; regrave o veredito');
  }
  // F2b (D828): o P2 sem tipo tambem para a apuracao. Quem orquestra e o autor do que esta em revisao: so pode
  // completar com "erro", o valor que segura a ronda; "melhoria" e marca do inspetor.
  const semTipo = Array.isArray(vd.achados) ? vd.achados.filter(function (a) {
    return severidadeDoConfirmado(a) === 'P2' && tipoDoP2(a) === null;
  }).length : 0;
  if (semTipo) {
    erros.push(semTipo + ' achado(s) P2 sem "tipo": cada P2 confirmado diz "tipo": "erro" (muda um resultado, ' +
      'enfraquece a seguranca, mostra ao usuario algo errado ou confuso, ou pode perder dado) ou "tipo": "melhoria" ' +
      '(nenhum desses efeitos). Chame a lente de novo ou complete com "erro"; "melhoria" so o inspetor marca; ' +
      'regrave o veredito');
  }
  // D820 (dono, como a D672): na lente de seguranca, o P0/P1 sem a fronteira e o pendente sem o plano tambem param a
  // apuracao - descartar secaria a ronda, e o inspetor que nao conhece os campos aprovaria o furo calado.
  if (Array.isArray(vd.achados) && lenteCanonica(vd.lente) === LENTE_SEGURANCA) {
    const semFronteira = vd.achados.filter(function (a) { return precisaFronteira(a) && !fronteiraInteira(a.fronteira); });
    if (semFronteira.length) {
      erros.push(semFronteira.length + ' achado(s) P0/P1 de seguranca sem a fronteira inteira: de "fronteira" com ' +
        '"entrada", "controle" e "efeito", ou rebaixe a P2 quando nao ha dano a mostrar; regrave o veredito');
    }
    const semPlano = vd.achados.filter(function (a) { return a && a.estado === 'pendente' && !temTexto(a.plano); });
    if (semPlano.length) {
      erros.push(semPlano.length + ' achado(s) pendente(s) de seguranca sem plano: de "plano" com como verificar o fato ' +
        'que falta, sem risco; regrave o veredito');
    }
  }
  if (opcoes && opcoes.comReferencia) {
    const vs = vd.vsReferencia;
    if (!vs || typeof vs !== 'object' || Array.isArray(vs) || RESULTADOS_REFERENCIA.indexOf(vs.A) === -1 ||
        RESULTADOS_REFERENCIA.indexOf(vs.B) === -1) {
      // Plano 082, Tarefa 5 (p2-16): a lente diz qual veredito regravar.
      erros.push('vsReferencia' + (vd.lente ? ' da lente "' + String(vd.lente) + '"' : '') + ' tem de ser { "A": ..., ' +
        '"B": ... }, cada um vence, empata ou perde contra a referencia (o pacote tem R.txt)');
    }
    if (!Array.isArray(vd.lacunas)) erros.push('lacunas tem de ser lista, vazia quando nada separa os lados da referencia');
  }
  return erros;
}

/**
 * RV-03: a linha como inteiro >= 1, ou null. Aceita inteiro, texto "42" e intervalo "40-45" / "40-45 com travessao".
 * L2-ver-2 (S7, D426): o intervalo vale pelo MENOR numero, escrito em qualquer ordem ("45-40" tambem e 40); o
 * menor tem de ser linha valida, entao "0-5" e descartado em vez de virar 5 calado.
 */
function linhaDoAchado(linha) {
  if (Number.isInteger(linha)) return linha >= 1 ? linha : null;
  if (typeof linha !== 'string') return null;
  const m = /^\s*(\d+)(?:\s*[-\u2013\u2014]\s*(\d+))?\s*$/.exec(linha);
  const n = m ? Math.min(parseInt(m[1], 10), m[2] === undefined ? Infinity : parseInt(m[2], 10)) : 0;
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/** L3 (A3-05): o achado (ou lacuna) com a severidade sem espaco nas pontas e em maiuscula; o resto como veio. */
function severidadeCanonica(x) {
  if (!x || typeof x.severidade !== 'string') return x;
  const s = x.severidade.trim().toUpperCase();
  return s === x.severidade ? x : Object.assign({}, x, { severidade: s });
}

/** O comeco da descricao do achado descartado, para a mensagem; sem descricao, diz isso (e nao "undefined"). */
function trechoDaDescricao(d) {
  // A3-01: 60 caracteres por ponto de codigo; o slice de String parte o emoji (par UTF-16) no meio.
  return d === undefined || d === null || String(d).trim() === '' ? '(sem descricao)'
    : [...String(d)].slice(0, 60).join('');
}


/**
 * Os erros do veredito e os achados (e lacunas) que valem. opcoes: as do errosDoVeredito - com comReferencia, as
 * lacunas sao conferidas e sobem em lacunasValidas; sem ela, lacunasValidas sai vazia mesmo que o veredito traga
 * lacunas (sem R.txt nao ha contra o que comparar).
 */
function validarVeredito(vd, opcoes) {
  const erros = errosDoVeredito(vd, opcoes);
  const validos = [];
  const lacunas = [];
  const pendentes = [];
  if (!vd || typeof vd !== 'object') {
    return { ok: false, erros: erros, achadosValidos: [], lacunasValidas: [], pendentesValidos: [] };
  }
  const deSeguranca = lenteCanonica(vd.lente) === LENTE_SEGURANCA;

  for (const bruto of (vd.achados || [])) {
    if (bruto && bruto.estado === 'pendente') {
      const linhaP = linhaDoAchado(bruto.linha);
      if (bruto.severidade !== undefined && bruto.severidade !== null && bruto.severidade !== '') {
        erros.push('achado pendente com severidade (o pendente nao tem severidade: confirme com o trecho, ou tire a ' +
          'severidade), descartado: ' + trechoDaDescricao(bruto.descricao));
      } else if (!bruto.arquivo || linhaP === null) {
        erros.push('achado pendente sem arquivo:linha valido, descartado: ' + trechoDaDescricao(bruto.descricao));
      } else if (!bruto.descricao || String(bruto.descricao).trim() === '') {
        erros.push('achado pendente sem descricao, descartado');
      } else if (typeof bruto.falta !== 'string' || bruto.falta.trim() === '') {
        erros.push('achado pendente sem falta (o fato exato que confirmaria o achado), descartado: ' +
          trechoDaDescricao(bruto.descricao));
      } else if (deSeguranca && !temTexto(bruto.plano)) {
        erros.push('achado pendente de seguranca sem plano (como verificar o fato que falta, sem risco), descartado: ' +
          trechoDaDescricao(bruto.descricao));
      } else {
        pendentes.push(linhaP === bruto.linha ? bruto : Object.assign({}, bruto, { linha: linhaP }));
      }
      continue;
    }
    // L3 (A3-05): "p1" e " P1 " sao P1; antes o achado saia descartado e a ronda seca.
    const a = severidadeCanonica(bruto);
    if (SEVERIDADES.indexOf(a && a.severidade) === -1) {
      erros.push('achado com severidade invalida: ' + (a && a.severidade));
      continue;
    }
    // Anti-teatro: sem arquivo:linha, o voto nao conta. D396 n. 37/38: linha a partir de 1, como a da
    // refutacao (conferirRefutados); o achado de linha 0 molhava a ronda e nao tinha como ser refutado.
    // RV-03 (D422): "42" e "40-45" tambem sao arquivo:linha - viram 42 e 40 (o menor do intervalo). Sem numero, segue descartado.
    const linha = linhaDoAchado(a.linha);
    if (!a.arquivo || linha === null) {
      erros.push('achado sem arquivo:linha valido (a linha e um numero inteiro a partir de 1; "42" e "40-45" tambem valem; sem numero nenhum, nao conta), descartado: ' + trechoDaDescricao(a.descricao));
      continue;
    }
    if (!a.descricao || String(a.descricao).trim() === '') {
      erros.push('achado sem descricao, descartado');
      continue;
    }
    if (typeof a.trecho !== 'string' || a.trecho.trim() === '') {
      erros.push('achado confirmado sem trecho (copie do arquivo citado o texto da linha que mostra o defeito), ' +
        'descartado: ' + trechoDaDescricao(a.descricao));
      continue;
    }
    if (deSeguranca && precisaFronteira(a) && !fronteiraInteira(a.fronteira)) {
      erros.push('achado ' + a.severidade + ' de seguranca sem a fronteira inteira (entrada, controle e efeito, cada um ' +
        'com texto), descartado: ' + trechoDaDescricao(a.descricao));
      continue;
    }
    validos.push(linha === a.linha ? a : Object.assign({}, a, { linha: linha }));
  }
  // D503 (E5): a lacuna para a referencia segue o anti-teatro do achado, e cita o lado que fica atras (A ou B).
  if (opcoes && opcoes.comReferencia && Array.isArray(vd.lacunas)) {
    for (const brutaL of vd.lacunas) {
      const l = severidadeCanonica(brutaL);
      if (SEVERIDADES.indexOf(l && l.severidade) === -1) {
        erros.push('lacuna com severidade invalida: ' + (l && l.severidade));
        continue;
      }
      const linha = linhaDoAchado(l.linha);
      if (rotuloDoArquivo(l.arquivo) === null || linha === null) {
        erros.push('lacuna sem arquivo:linha valido (o arquivo e A.txt ou B.txt, o lado que fica atras da referencia), ' +
          'descartada: ' + trechoDaDescricao(l.descricao));
        continue;
      }
      if (!l.descricao || String(l.descricao).trim() === '') {
        erros.push('lacuna sem descricao, descartada');
        continue;
      }
      lacunas.push(linha === l.linha ? l : Object.assign({}, l, { linha: linha }));
    }
  }
  return { ok: erros.length === 0, erros: erros, achadosValidos: validos, lacunasValidas: lacunas,
    pendentesValidos: pendentes };
}

const TETO = 3;

/**
 * D244/defeito 3: `A.txt`, `B.txt` ou um caminho que termina neles -> 'A' | 'B' | null.
 * T14: o que vem depois do nome (`A.txt:120`, `A.txt linha 45`, `A.txt#L12`) nao tira o lado; sem
 * isso o achado do lado antigo voltava a contar. Os dois rotulos na mesma citacao: sem lado.
 * D246: antes do nome, qualquer nao-palavra e fronteira - `A.txt,B.txt` dava `A`.
 */
function rotuloDoArquivo(arquivo) {
  const re = /(?<![\w.])([AB])\.txt(?![\w.])/gi;
  const achados = new Set();
  let m;
  while ((m = re.exec(String(arquivo == null ? '' : arquivo))) !== null) achados.add(m[1].toUpperCase());
  return achados.size === 1 ? achados.values().next().value : null;
}

function mesmaLente(a, b) {
  return lenteCanonica(a) === lenteCanonica(b);
}

// D821 (D2, do google/elephant-goldfish-model, skills/egm-resolve/SKILL.md:56-82): a contestacao vale com o que o
// revisor leria. Cada `caminho:linha` (ou `caminho:a-b`, pela 1a) citado na prova; o caminho tem extensao.
const CITACAO_NA_PROVA = /([^\s:()"'`,;\[\]]+\.[A-Za-z0-9]+):(\d+)(?:-\d+)?/g;
function citacoesDaProva(prova) {
  const lista = [];
  let m;
  // o exec que chega ao null ja zera o lastIndex da regex global: a chamada seguinte comeca do inicio
  while ((m = CITACAO_NA_PROVA.exec(prova)) !== null) lista.push({ caminho: m[1], linha: parseInt(m[2], 10) });
  return lista;
}

/** D821: com `provaNoRepo(caminho, linha, simbolo)` (o apurar-ronda.js le o disco), a refutacao traz o `comando`
 *  rodado, ou o `simbolo` que o script acha numa citacao `arquivo:linha` da prova; sem nada disso, para. */
function provaConfere(r, provaNoRepo) {
  if (temTexto(r.comando)) return true;
  // D822/D823: o P2 tambem sai marcado fora do pedido, com o motivo; o P0 e o P1, so com prova
  if (r.severidade === 'P2' && temTexto(r.foraDoPedido)) return true;
  if (!temTexto(r.simbolo)) return false;
  return citacoesDaProva(r.prova).some(function (c) { return provaNoRepo(c.caminho, c.linha, r.simbolo) === true; });
}

/** D244/defeito 3: refutar tambem exige citar. Refutacao sem prova derruba a apuracao. D821: com `provaNoRepo`, a
 *  prova tambem e conferida (provaConfere); sem ele (quem chama a lib pura), so a forma. */
function conferirRefutados(refutados, provaNoRepo) {
  const lista = Array.isArray(refutados) ? refutados : [];
  for (let i = 0; i < lista.length; i++) {
    const r = lista[i];
    // F6-03: o que nao e objeto (null, numero, texto, lista) nao e uma refutacao sem prova: e a forma errada.
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      throw new Error('entrada invalida no refutados.json (posicao ' + (i + 1) + '): cada refutacao e um objeto ' +
        '{ ronda, lente, arquivo, linha, severidade, prova }');
    }
    if (typeof r.prova !== 'string' || r.prova.trim() === '') {
      throw new Error('refutacao sem prova (ronda ' + (r && r.ronda) + ', lente ' + (r && r.lente) + ', linha ' +
        (r && r.linha) + '): cite a fonte primaria - arquivo:linha ou o comando - em "prova"');
    }
    const onde = ' (ronda ' + r.ronda + ', lente ' + r.lente + ', linha ' + r.linha + '): ';
    // T14: sem o lado, a refutacao casava por null === null com achado que tambem nao citava A nem B.
    if (rotuloDoArquivo(r.arquivo) === null) {
      throw new Error('refutacao sem arquivo' + onde + '"arquivo" tem de ser A.txt ou B.txt, como o achado que ela refuta');
    }
    // T14 ronda 2: `linha: true` virava 1 por coercao e derrubava o achado da linha 1.
    if (!Number.isInteger(r.ronda) || r.ronda < 1) {
      throw new Error('refutacao com ronda invalida' + onde + '"ronda" tem de ser o numero inteiro da ronda, a partir de 1');
    }
    if (!Number.isInteger(r.linha) || r.linha < 1) {
      throw new Error('refutacao com linha invalida' + onde + '"linha" tem de ser o numero inteiro da linha do achado');
    }
    if (typeof r.lente !== 'string' || r.lente.trim() === '') {
      throw new Error('refutacao sem lente' + onde + '"lente" tem de ser o texto da lente, como no veredito');
    }
    // D246: sem a severidade, refutar o P1 de uma linha apagava o P0 da mesma lente e linha.
    if (SEVERIDADES.indexOf(r.severidade) === -1) {
      throw new Error('refutacao sem severidade' + onde + '"severidade" tem de ser P0, P1 ou P2, a do achado que ela refuta');
    }
    // D503 (E7): o A.txt da 2a passada (invertida/) e outro arquivo que o da 1a; a refutacao diz de qual passada e.
    if (r.passada !== undefined && r.passada !== 1 && r.passada !== 2) {
      throw new Error('refutacao com passada invalida' + onde + '"passada" e 2 para achado da 2a passada (invertida/), ' +
        'ou fica fora do objeto');
    }
    if (typeof provaNoRepo === 'function' && !provaConfere(r, provaNoRepo)) {
      throw new Error('refutacao com prova que nao confere' + onde + 'cite em "prova" um arquivo:linha do repositorio ' +
        'e ponha em "simbolo" o texto que esta nessa linha (ou ate 2 vizinhas), ou ponha em "comando" o comando que ' +
        'rodou e mostrou o achado errado');
    }
  }
  return lista;
}

function refutado(lista, ronda, lente, a, passada) {
  return lista.some(function (r) {
    return r.ronda === ronda && mesmaLente(r.lente, lente) && r.linha === a.linha && r.severidade === a.severidade &&
      rotuloDoArquivo(r.arquivo) === rotuloDoArquivo(a.arquivo) && (r.passada || 1) === passada;
  });
}

// O peso de cada resultado contra a referencia: quanto maior, pior. O pior entre lados e vereditos e o que vale.
const PESO_REFERENCIA = { vence: 0, empata: 1, perde: 2 };

/**
 * D503 (E6): o resultado do lado trabalho contra a referencia numa passada: o pior dos lados que o mapa diz trabalho
 * (os dois, quando o arquivo e identico ao HEAD). null quando nenhum lado e trabalho. O mapa chega sempre conferido:
 * o apurar recusa a ronda com referencia cujo mapa nao passa no mapaDoTrabalho antes de chamar esta funcao.
 */
function vsDoTrabalho(vs, mapa) {
  let pior = null;
  for (const rot of ['A', 'B']) {
    if (mapa[rot] !== 'trabalho') continue;
    if (pior === null || PESO_REFERENCIA[vs[rot]] > PESO_REFERENCIA[pior]) pior = vs[rot];
  }
  return pior;
}

/**
 * Plano 082 (p2-6, p2-7): com referencia, o mapa de cada passada tem de dizer o lado dos dois rotulos ("trabalho" ou
 * "HEAD") e ter ao menos um trabalho. Sem isso o resultado contra a referencia ficava "incompleta" calado (nunca
 * aprovava) e o achado de um rotulo sem lado caia na chave por arquivo, igual nas duas passadas.
 */
function mapaDoTrabalho(mapa) {
  if (!mapa || typeof mapa !== 'object' || Array.isArray(mapa)) return false;
  const lado = function (v) { return v === 'trabalho' || v === 'HEAD'; };
  return lado(mapa.A) && lado(mapa.B) && (mapa.A === 'trabalho' || mapa.B === 'trabalho');
}

/** D503 (E6): as duas ordens viram um resultado: perde em alguma = perde; vence nas duas = vence; o resto, empata. */
function resultadoDasDuasOrdens(o1, o2) {
  if (o1 === null || o2 === null) return 'incompleta';
  if (o1 === 'perde' || o2 === 'perde') return 'perde';
  return o1 === 'vence' && o2 === 'vence' ? 'vence' : 'empata';
}

// D387 (#11c): dois achados do mesmo arquivo a ate 10 linhas um do outro viram "par candidato" para o
// juiz de mesmo defeito. Distancia 10 entra; 11 fica fora.
const DISTANCIA_PAR = 10;
// F2a (D828.5): nas rondas 2 e 3, o achado segura a ronda a ate estas linhas de uma linha tocada ou ja citada.
const VIZINHAS_DA_VERIFICADA = 2;
const RESPOSTAS_MESMO = ['sim', 'nao', 'nao-sei'];

/**
 * D387 (#11c): o mesmos.json e a resposta do juiz-mesmo: [{ novo, outro, resposta }], com as chaves de
 * achado que o apurar usa. Molde do conferirRefutados: o que nao tem a forma certa para, com a posicao.
 * `chavesExistentes` e o conjunto de chaves dos achados apurados (Set ou lista).
 */
function conferirMesmos(lista, chavesExistentes) {
  if (!Array.isArray(lista)) {
    throw new Error('mesmos.json nao e uma lista (veio ' + (lista === null ? 'null' : typeof lista) + '): a forma e ' +
      'uma lista de { novo, outro, resposta }, e [] quando o juiz nao achou par');
  }
  const existentes = chavesExistentes instanceof Set ? chavesExistentes : new Set(chavesExistentes || []);
  for (let i = 0; i < lista.length; i++) {
    const m = lista[i];
    const onde = 'entrada invalida no mesmos.json (posicao ' + (i + 1) + '): ';
    if (!m || typeof m !== 'object' || Array.isArray(m)) {
      throw new Error(onde + 'cada item e um objeto { "novo": "<chave>", "outro": "<chave>", "resposta": "sim" | "nao" | "nao-sei" }');
    }
    for (const campo of ['novo', 'outro']) {
      if (typeof m[campo] !== 'string' || m[campo].trim() === '') {
        throw new Error(onde + '"' + campo + '" tem de ser o texto da chave do achado, copiada de paresCandidatos');
      }
      if (!existentes.has(m[campo])) {
        throw new Error(onde + '"' + campo + '" (' + m[campo] + ') nao e a chave de nenhum achado apurado; copie a chave ' +
          'exatamente como veio em paresCandidatos');
      }
    }
    // D396 n. 41: a forma (a resposta) antes do sentido (a mesma chave), como os campos acima.
    if (RESPOSTAS_MESMO.indexOf(m.resposta) === -1) {
      throw new Error(onde + '"resposta" tem de ser "sim", "nao" ou "nao-sei" (veio ' + JSON.stringify(m.resposta) + ')');
    }
    // D391: um achado nao e par dele mesmo (paresCandidatos nunca o lista); sem isto saia o aviso
    // "provavel mesmo defeito que" a propria chave.
    if (m.novo === m.outro) {
      throw new Error(onde + '"novo" e "outro" sao a mesma chave (' + m.novo + '); copie o par exatamente como veio em ' +
        'paresCandidatos');
    }
  }
  return lista;
}

/**
 * D475 (s99): a chave de repeticao de um achado, olhando o texto da linha citada.
 * variantesDaChave: Map kBase -> [{ texto, chave }], um item por texto ja visto naquela chave (o primeiro leva
 * a propria kBase). Devolve a chave a usar:
 *   - primeira vez da kBase: kBase;
 *   - texto igual a um ja visto: a chave daquele texto (repeticao);
 *   - texto diferente de todos: kBase + "|r<ronda>" (linha reescrita = achado novo);
 *   - sem texto (bruto que nao e string), agora ou em alguma vez anterior: kBase, a conta de antes da D475.
 */
function chavePeloTexto(kBase, bruto, variantesDaChave, ronda) {
  const texto = typeof bruto === 'string' ? bruto.replace(/\s+/g, ' ').trim() : null;
  const variantes = variantesDaChave.get(kBase);
  if (!variantes) {
    variantesDaChave.set(kBase, [{ texto: texto, chave: kBase }]);
    return kBase;
  }
  const igual = variantes.find(function (x) { return x.texto === texto; });
  if (igual) return igual.chave;
  if (texto === null || variantes.some(function (x) { return x.texto === null; })) return kBase;
  const chave = kBase + '|r' + ronda;
  variantes.push({ texto: texto, chave: chave });
  return chave;
}

function descricaoNormal(d) {
  return String(d).replace(/\s+/g, ' ').trim();
}

/**
 * rondas: lista de rondas; cada ronda e uma lista de vereditos.
 * Ronda seca = zero achado NOVO que segura a ronda: P0, P1 ou P2 de erro (D823; o P2 sem `tipo` invalida o veredito).
 * F2a (D828.2/.5): o que nao segura sai em `registros` (lista, sempre; de todas as rondas, com ronda, lente e
 * `registro`): 'melhoria' e o P2 de melhoria; 'linha nova' e o achado da ronda 2 ou 3 longe (mais de
 * VIZINHAS_DA_VERIFICADA linhas) de toda linha que o conserto tocou ou que uma ronda anterior citou. O registro nao
 * entra em novos, nos abertos do teto, nos pares do juiz nem obriga a lente a voltar.
 * D244/defeito 3 - opcoes (opcional; sem ela a conta e a de antes):
 *   mapas[i]   = { A: 'trabalho'|'HEAD', B: ... } da ronda i (o mapa.json). Com ele, so P0/P1 do
 *                lado 'trabalho' molha; os do lado 'HEAD' saem em achadosDoLadoAntigo. A chave
 *                passa a ser pelo LADO: o rotulo A/B e sorteado a cada ronda.
 *   refutados  = [{ ronda, lente, arquivo, linha, severidade, prova, passada? }]: achado refutado na fonte
 *                primaria nao molha. Sem `prova` ou sem `severidade`, lanca erro. `passada` e 2 para o achado
 *                da ordem trocada (invertida/); sem ela, vale a 1a.
 *   mesmos     = [{ novo, outro, resposta }] (D387, #11c): so ALIMENTA provaveisMesmos; nao entra em
 *                secas, encerrar, motivo, novos, abertos nem no teto. A palavra do juiz e aviso, nao prova.
 *   textoDaLinha(indiceDaRonda, rotulo, linha, passada) -> texto ou null (D475): com ele, a mesma chave sobre um
 *                texto diferente do ja visto vira achado novo (chave + "|r<ronda>"); texto igual segue repeticao.
 *   invertidas[i] = { mapa, vereditos } (D503, E6-E8): a 2a passada (A/B trocados) da ronda i com referencia. Os
 *                vereditos das duas passadas exigem vsReferencia e lacunas, e os mapas das duas passadas exigem o
 *                lado de A e de B (mapaDoTrabalho); os achados da 2a contam pelo mapa dela e saem com passada 2. Sai `referencia` (null sem ela): { pronta, lentes, lacunas, lentesAtras };
 *                com a ultima ronda fora da referencia, duas secas nao aprovam.
 *   faixas[i]  = a faixa do mapa.json da ronda i (L3, A3-03). Com a da ronda 1: a ronda 1 sem as lentes da faixa (na
 *                completa, menos de MINIMO_DA_COMPLETA lentes conhecidas) e a ronda sem a lente que achou P0/P1 do lado
 *                novo na anterior lancam erro com codigo VOTO_QUE_FALTA.
 *   trechoNoArquivo(indiceDaRonda, rotulo, linha, trecho, passada) -> true | false | null (lote 3/4a): false tira o
 *                confirmado da conta e o poe em trechoNaoConfere; true ou null (sem como ler o arquivo) conta como antes.
 *                Sem a funcao, nada se confere: o erro de quem chama cai do lado de molhar a ronda, nunca de seca-la.
 *   mudancas[i] = (F2a, i >= 1) os blocos do diff-linhas.js entre o lado novo da ronda i-1 e o da ronda i; a posicao
 *                0 nao se le. Sem a lista numa ronda, ou com uma ronda sem o mapa dos dois lados (mapaDoTrabalho),
 *                a medida cai e nao volta: dali em diante nada e 'linha nova' e tudo molha como antes.
 * pendentes e trechoNaoConfere saem sempre (listas, vazias quando nao ha), de todas as rondas, com ronda e lente.
 * paresCandidatos sai sempre: achado P0/P1 novo da ultima ronda x outro achado do lado novo, mesmo
 * arquivo (o lado, com mapa; o rotulo, sem), a ate DISTANCIA_PAR linhas, chave diferente.
 * paresFortes (F2d parte b) sai sempre: os paresCandidatos na mesma linha (distancia 0), os unicos que vao ao juiz.
 */
function apurar(rondas, opcoes) {
  // F2-14: sem nenhuma ronda nao ha o que apurar (antes saia "ronda 1 chama so as lentes..." sem ronda nenhuma).
  if (!Array.isArray(rondas) || rondas.length === 0) throw new Error('nenhuma ronda para apurar');
  const op = opcoes || {};
  const mapas = Array.isArray(op.mapas) ? op.mapas : [];
  const refutados = conferirRefutados(op.refutados, op.provaNoRepo);
  const vistos = new Set();
  const variantesDaChave = new Map();
  // D602: chave sem ordinal -> as descricoes ja vistas nela, na ordem do ordinal (a 1a e a base)
  const historicoDaChave = new Map();
  const abertos = new Set();
  let secas = 0;
  let novosDaUltima = [];
  let novosChavesDaUltima = [];
  let antigosDaUltima = [];
  // D387: todo achado valido visto (chave -> o que o juiz le) e, a parte, os do lado novo em ordem.
  const metas = new Map();
  const doLadoNovo = [];
  const placar = { A: 0, B: 0, empate: 0 };
  // D503 (E6/E8): invertidas[i] = { mapa, vereditos } da 2a passada (ordem A/B trocada) da ronda com referencia.
  const invertidas = Array.isArray(op.invertidas) ? op.invertidas : [];
  // lente -> o resultado contra a referencia na ultima ronda que a chamou
  const refLentes = new Map();
  let ultimaComReferencia = false;
  // Lote 3/4a: os pendentes (nao molham) e os confirmados cujo trecho nao esta no arquivo citado (nao contam), de
  // todas as rondas, para quem orquestra ler.
  const pendentes = [];
  const trechoNaoConfere = [];
  // F2a (D828.2/.5): o que nao segura a ronda, e as linhas do lado novo que a ronda corrente verifica (as tocadas pelo
  // conserto e as citadas antes, levadas de ronda em ronda pelos blocos de `mudancas`).
  const registros = [];
  let medido = true;
  let verificaveis = new Set();
  // F2b (D828): a ronda 1 em que nenhum veredito traz achado nenhum (nem pendente, nem melhoria, nem do lado antigo,
  // nem fora do formato; com referencia, nem lacuna) aprova sozinha, se as lentes da faixa foram conferidas.
  let ronda1SemAchado = true;

  // L3 (A3-03): com a faixa da ronda 1 (o mapa.json do preparar-revisao.js a grava), o script confere as lentes; sem
  // ela (base de antes), a conta de antes.
  const faixa1 = Array.isArray(op.faixas) && typeof op.faixas[0] === 'string' ? op.faixas[0] : null;
  // F2d (c): a lista de lentes que o preparar gravou no mapa.json da ronda 1 (faixa completa); sem ela, vazia ou com
  // algo que nao e texto, o minimo de antes (a lista vazia nao pode desligar a conferencia)
  const lentes1 = Array.isArray(op.lentesDoMapa) && Array.isArray(op.lentesDoMapa[0]) && op.lentesDoMapa[0].length > 0 &&
    op.lentesDoMapa[0].every(function (l) { return typeof l === 'string'; }) ? op.lentesDoMapa[0] : null;
  let lentesComNovosAntes = new Set();
  function conferirLentes(indice, ronda, comNovosAntes) {
    const presentes = new Set(ronda.map(function (vd) { return vd && lenteCanonica(vd.lente); }));
    const conhecidas = Array.from(presentes).filter(function (l) { return l && chaveDaLente(l) !== null; });
    const grave = 'grave o veredito de cada uma na pasta vereditos da ronda ' + (indice + 1) +
      ' (Passo 2 do /sworn:review) e rode de novo';
    if (indice === 0) {
      const esperadas = lentesDaFaixa(faixa1) || (faixa1 === 'completa' ? lentes1 : null);
      const faltam = esperadas ? esperadas.filter(function (l) { return !presentes.has(l); }) : [];
      if (faltam.length) {
        throw votoQueFalta('ronda 1 da faixa ' + faixa1 + ' sem o voto da(s) lente(s) ' + faltam.join(', ') +
          ': a ronda 1 chama todas as lentes da faixa; ' + grave);
      }
      if (!esperadas && conhecidas.length < MINIMO_DA_COMPLETA) {
        throw votoQueFalta('ronda 1 da faixa ' + faixa1 + ' com ' + conhecidas.length + ' lente(s) conhecida(s) (' +
          (conhecidas.join(', ') || 'nenhuma') + '): o minimo e ' + MINIMO_DA_COMPLETA + ' (a tabela de familias do ' +
          'Passo 2 do /sworn:review); chame as que faltam, ' + grave);
      }
      return;
    }
    const naoVoltaram = Array.from(comNovosAntes).filter(function (l) { return !presentes.has(l); });
    if (naoVoltaram.length) {
      throw votoQueFalta('ronda ' + (indice + 1) + ' sem o voto da(s) lente(s) que acharam P0, P1 ou P2 de erro do lado novo na ronda ' +
        indice + ': ' + naoVoltaram.join(', ') + '. A ronda seguinte confere o proprio achado (Passo 4 do ' +
        '/sworn:review): ' + grave + '. Achado refutado na fonte vai em refutados.json e nao obriga a lente a voltar');
    }
  }

  rondas.forEach(function (ronda, indice) {
    const novos = [];
    const novosChaves = [];
    const antigos = [];
    const lentesComNovos = new Set();
    const mapa = mapas[indice] && typeof mapas[indice] === 'object' ? mapas[indice] : null;
    const inv = invertidas[indice] && typeof invertidas[indice] === 'object' ? invertidas[indice] : null;
    const comReferencia = inv !== null;
    // 0.3.3, item 1: ronda sem nenhum veredito nao e ronda seca - e voto que falta. Sem isto,
    // `apurar([[], []])` fechava aprovado. Diz qual ronda; o apurar-ronda.js confere a pasta antes.
    if (!Array.isArray(ronda) || ronda.length === 0) {
      throw new Error('ronda ' + (indice + 1) + ' sem nenhum veredito: ronda sem voto nao e ronda seca, e nao se apura; ' +
        'grave os vereditos da ronda ' + (indice + 1) + ' na pasta vereditos dela e rode de novo');
    }
    if (comReferencia && (!Array.isArray(inv.vereditos) || inv.vereditos.length === 0)) {
      throw new Error('ronda ' + (indice + 1) + ' com referencia sem nenhum veredito da 2a passada (invertida/vereditos): ' +
        'a ordem trocada e metade do voto; grave os vereditos da 2a passada e rode de novo');
    }
    if (comReferencia) {
      for (const [mapaDaPassada, ordem] of [[mapa, ''], [inv.mapa, ' (com A e B trocados)']]) {
        if (mapaDoTrabalho(mapaDaPassada)) continue;
        throw new Error('ronda ' + (indice + 1) + ordem + ' sem o mapa que diz qual lado e o trabalho ({ "A": "trabalho" ' +
          'ou "HEAD", "B": ... }, com ao menos um trabalho): sem ele a comparacao com a referencia nunca fecha. Prepare ' +
          'a ronda de novo (Passo 1 do /sworn:review) e rode de novo');
      }
    }
    const mapaInv = comReferencia ? inv.mapa : null;
    const mudanca = Array.isArray(op.mudancas) ? op.mudancas[indice] : null;
    if (!mapaDoTrabalho(mapa) || (indice > 0 && !Array.isArray(mudanca))) medido = false;
    const soVerifica = medido && indice > 0;
    if (soVerifica) {
      const levadas = new Set(diffLinhas.tocadas(mudanca));
      verificaveis.forEach(function (linha) {
        const nova = diffLinhas.levar(linha, mudanca);
        if (nova !== null) levadas.add(nova);
      });
      verificaveis = levadas;
    }
    const emLinhaNova = function (linha) {
      for (let n = linha - VIZINHAS_DA_VERIFICADA; n <= linha + VIZINHAS_DA_VERIFICADA; n++) {
        if (verificaveis.has(n)) return false;
      }
      return true;
    };
    // as linhas que esta ronda cita so entram nas verificaveis no fim dela: o achado nao verifica a si mesmo
    const citadas = [];
    const daRonda = new Map();
    const passadas = comReferencia ? [[ronda, mapa, 1], [inv.vereditos, mapaInv, 2]] : [[ronda, mapa, 1]];
    for (const [lista, mapaP, passada] of passadas) {
      for (const vd of lista) {
        // D230: o que nao e veredito nao e voto sem achado - seria ronda seca por falta de voto. O
        // apurar-ronda.js para antes de chegar aqui; quem chamar direto recebe o erro, com o motivo.
        const invalido = errosDoVeredito(vd, { comReferencia: comReferencia });
        if (invalido.length) {
          // Plano 082, Tarefa 5 (p2-16): a ronda, a ordem dos lados sem giria e a lente - qual veredito regravar.
          throw new Error('veredito que nao e veredito na ronda ' + (indice + 1) + (passada === 2 ? ' (com A e B trocados)' : '') +
            (vd && vd.lente ? ', lente "' + String(vd.lente) + '"' : '') + ': ' + invalido.join('; '));
        }
        const r = validarVeredito(vd, { comReferencia: comReferencia });
        if (indice === 0 && (vd.achados.length > 0 || (comReferencia && vd.lacunas.length > 0))) ronda1SemAchado = false;
        // O placar (qual rotulo saiu melhor) conta so a ordem normal: a ordem trocada julga os mesmos dois arquivos
        // com os rotulos invertidos, e somar as duas contaria cada lente duas vezes, uma em cada rotulo.
        if (passada === 1 && indice === rondas.length - 1 && placar[vd.melhor] !== undefined) placar[vd.melhor] += 1;
        // RV-02 (D422): a chave leva a lente CANONICA; "Correcao e regressao" e "correcao" sao a mesma lente.
        const lenteChave = lenteCanonica(vd.lente);
        if (comReferencia) {
          if (!daRonda.has(lenteChave)) daRonda.set(lenteChave, { ordem1: null, ordem2: null, lacunas: [] });
          const daLente = daRonda.get(lenteChave);
          const campo = passada === 1 ? 'ordem1' : 'ordem2';
          const resultado = vsDoTrabalho(vd.vsReferencia, mapaP);
          if (resultado !== null && (daLente[campo] === null || PESO_REFERENCIA[resultado] > PESO_REFERENCIA[daLente[campo]])) {
            daLente[campo] = resultado;
          }
          for (const lacuna of r.lacunasValidas) {
            // so a lacuna do trabalho barra a referencia: a do lado HEAD e o que ja estava atras antes da mudanca
            if (mapaP[rotuloDoArquivo(lacuna.arquivo)] !== 'trabalho') continue;
            daLente.lacunas.push({ lente: lenteChave, ronda: indice + 1, passada: passada, severidade: lacuna.severidade,
              arquivo: lacuna.arquivo, linha: lacuna.linha, descricao: lacuna.descricao });
          }
        }
        // L3 (A3-01): no MESMO veredito, a mesma chave com outra descricao e outro defeito, nao repeticao: leva o
        // ordinal (|n2, |n3...). A mesma descricao repetida segue um achado so (D387/pares).
        // D602 (revisao L3 R3): o ordinal sai do historico da chave entre rondas, nao da ordem do veredito. A descricao
        // ja vista fica com o ordinal dela; com 2 ou mais descricoes na chave no veredito, a que nao bate ganha ordinal
        // novo (ali nenhum defeito some; 2 repetidos reescritos molham - custo aceito). Uma descricao so, que nao bate,
        // fica na base e conta como reescrita: um defeito novo SOZINHO na linha de um ja visto some (desenho D475).
        const ladoDe = function (a) {
          const rotulo = rotuloDoArquivo(a.arquivo);
          return mapaP && rotulo ? mapaP[rotulo] : null;
        };
        const semOrdem = function (a) {
          const lado = ladoDe(a);
          return lado ? [a.severidade, lado, a.linha, lenteChave].join('|') : chaveAchado(a, lenteChave);
        };
        const marca = function (x) {
          return Object.assign({ ronda: indice + 1, lente: lenteChave }, passada === 2 ? { passada: 2 } : {}, x);
        };
        for (const p of r.pendentesValidos) pendentes.push(marca(p));
        // F2a: citou a linha do lado novo, achado ou pendente, contando ou nao: a linha fica verificavel
        for (const x of r.achadosValidos.concat(r.pendentesValidos)) if (ladoDe(x) === 'trabalho') citadas.push(x.linha);
        // Lote 3/4a: o confirmado cujo trecho nao esta no arquivo citado nao conta (nem para o ordinal); sem como ler o
        // arquivo (null), conta como antes.
        const achados = r.achadosValidos.filter(function (a) {
          const rotulo = rotuloDoArquivo(a.arquivo);
          if (typeof op.trechoNoArquivo !== 'function' || !rotulo ||
              op.trechoNoArquivo(indice, rotulo, a.linha, a.trecho, passada) !== false) return true;
          trechoNaoConfere.push(marca({ severidade: a.severidade, arquivo: a.arquivo, linha: a.linha, trecho: a.trecho,
            descricao: a.descricao }));
          return false;
        });
        const grupos = new Map();
        for (const a of achados) {
          const k = semOrdem(a);
          if (!grupos.has(k)) grupos.set(k, []);
          const g = grupos.get(k);
          const d = descricaoNormal(a.descricao);
          if (g.indexOf(d) === -1) g.push(d);
        }
        const vezDaDescricao = new Map();
        grupos.forEach(function (descricoes, k) {
          const historico = historicoDaChave.get(k);
          if (!historico) historicoDaChave.set(k, descricoes.slice());
          descricoes.forEach(function (d, i) {
            let vez = historico ? historico.indexOf(d) : i;
            if (vez === -1 && descricoes.length === 1) vez = 0;
            else if (vez === -1) vez = historico.push(d) - 1;
            vezDaDescricao.set(k + '\n' + d, vez + 1);
          });
        });
        for (const a of achados) {
          const rotulo = rotuloDoArquivo(a.arquivo);
          const lado = mapaP && rotulo ? mapaP[rotulo] : null;
          const kSemOrdem = semOrdem(a);
          const vez = vezDaDescricao.get(kSemOrdem + '\n' + descricaoNormal(a.descricao));
          const kBase = vez === 1 ? kSemOrdem : kSemOrdem + '|n' + vez;
          // D475 (s99): a mesma chave sobre uma linha REESCRITA entre rondas e evidencia nova, nao repeticao.
          const bruto = typeof op.textoDaLinha === 'function' && rotulo ? op.textoDaLinha(indice, rotulo, a.linha, passada) : null;
          const k = chavePeloTexto(kBase, bruto, variantesDaChave, indice + 1);
          if (vistos.has(k)) continue;
          vistos.add(k);
          // L2-ver-3 (S7, D426): o que o juiz le leva a lente canonica, a mesma da chave, e nao a grafia do inspetor.
          const meta = { chave: k, ronda: indice + 1, lente: lenteChave, severidade: a.severidade, linha: a.linha,
            descricao: a.descricao };
          metas.set(k, meta);
          // Achado do lado HEAD tem linha do arquivo antigo: nao faz par. Sem lado e sem rotulo, nao ha como
          // dizer que dois achados sao do mesmo arquivo: tambem nao faz par.
          const grupo = lado || rotulo;
          // D503 (E7): o achado da 2a passada sai marcado; o A.txt dela e outro arquivo que o da 1a.
          const marcado = passada === 2 ? Object.assign({}, a, { passada: 2 }) : a;
          if (lado === 'HEAD') { antigos.push(marcado); continue; }
          const foiRefutado = refutado(refutados, indice + 1, vd.lente, a, passada);
          // D823 (R1, dono): o P2 tambem molha a ronda, como o P0 e o P1. F2a (D828.2/.5): menos o P2 de melhoria e,
          // nas rondas 2 e 3 com a mudanca medida, o achado do lado novo longe das linhas verificaveis; os dois vao a
          // `registros`. O refutado nao e registro: a refutacao ja o tirou.
          const registro = foiRefutado ? null : ehMelhoria(a) ? 'melhoria'
            : soVerifica && lado === 'trabalho' && emLinhaNova(a.linha) ? 'linha nova' : null;
          if (registro !== null) {
            // o registro de linha nova nao fica entre os vistos: a linha dele passa a citada, e o mesmo achado que
            // voltar na ronda seguinte e verificacao e segura. A melhoria fica: repetida, e um registro so.
            if (registro === 'linha nova') vistos.delete(k);
            registros.push(marca(Object.assign({}, a, { registro: registro })));
            continue;
          }
          if (grupo) doLadoNovo.push({ meta: meta, grupo: grupo });
          if (foiRefutado) continue;
          abertos.add(k);
          novos.push(marcado);
          novosChaves.push(k);
          lentesComNovos.add(lenteChave);
        }
      }
    }
    citadas.forEach(function (linha) { verificaveis.add(linha); });
    if (faixa1 !== null) conferirLentes(indice, ronda, lentesComNovosAntes);
    lentesComNovosAntes = lentesComNovos;
    daRonda.forEach(function (e, lente) {
      refLentes.set(lente, { lente: lente, ronda: indice + 1, ordem1: e.ordem1, ordem2: e.ordem2,
        resultado: resultadoDasDuasOrdens(e.ordem1, e.ordem2), lacunas: e.lacunas });
    });
    if (novos.length === 0) secas += 1; else secas = 0;
    if (indice === rondas.length - 1) {
      novosDaUltima = novos; novosChavesDaUltima = novosChaves; antigosDaUltima = antigos;
      ultimaComReferencia = comReferencia;
    }
  });

  // D503 (E6): pronto contra a referencia = toda lente empata ou vence nas duas ordens, sem lacuna P0/P1 do trabalho.
  // Vale quando a ultima ronda tem referencia; sem ela, null e a regra de hoje.
  let referencia = null;
  if (ultimaComReferencia) {
    const lentes = [];
    const lacunas = [];
    refLentes.forEach(function (e) {
      lentes.push({ lente: e.lente, ronda: e.ronda, ordem1: e.ordem1, ordem2: e.ordem2, resultado: e.resultado });
      e.lacunas.forEach(function (l) { lacunas.push(l); });
    });
    const faltam = new Set();
    lentes.forEach(function (l) { if (l.resultado !== 'vence' && l.resultado !== 'empata') faltam.add(l.lente); });
    lacunas.forEach(function (l) { if (l.severidade === 'P0' || l.severidade === 'P1') faltam.add(l.lente); });
    referencia = { pronta: lentes.length > 0 && faltam.size === 0, lentes: lentes, lacunas: lacunas,
      lentesAtras: Array.from(faltam) };
  }

  // D387 (#11c): pares para o juiz. Nada aqui entra na contagem acima.
  // D396 n. 23: cada grupo em ordem de linha, e so os vizinhos a ate DISTANCIA_PAR linhas se comparam (antes,
  // todos com todos, sem teto). A saida segue na ordem de antes: a de doLadoNovo.
  const ehNovoDaUltima = new Set(novosChavesDaUltima);
  const porGrupo = new Map();
  doLadoNovo.forEach(function (x, i) {
    if (!porGrupo.has(x.grupo)) porGrupo.set(x.grupo, []);
    porGrupo.get(x.grupo).push({ y: x, j: i });
  });
  porGrupo.forEach(function (lista) {
    lista.sort(function (p, q) { return p.y.meta.linha - q.y.meta.linha || p.j - q.j; });
  });
  const paresCandidatos = [];
  doLadoNovo.forEach(function (x, i) {
    if (!ehNovoDaUltima.has(x.meta.chave)) return;
    const lista = porGrupo.get(x.grupo);
    let ini = 0;
    let fim = lista.length;
    while (ini < fim) {
      const meio = (ini + fim) >> 1;
      if (lista[meio].y.meta.linha < x.meta.linha - DISTANCIA_PAR) ini = meio + 1; else fim = meio;
    }
    const perto = [];
    for (let k = ini; k < lista.length && lista[k].y.meta.linha <= x.meta.linha + DISTANCIA_PAR; k++) perto.push(lista[k]);
    perto.sort(function (p, q) { return p.j - q.j; });
    perto.forEach(function (p) {
      const y = p.y;
      if (x.meta.chave === y.meta.chave) return;
      // Os dois novos da ultima ronda: o par sai uma vez so, na ordem em que apareceram.
      if (ehNovoDaUltima.has(y.meta.chave) && p.j < i) return;
      paresCandidatos.push({ novo: x.meta, outro: y.meta, distancia: Math.abs(x.meta.linha - y.meta.linha) });
    });
  });
  // F2d parte b (D828): o juiz so ve o par na mesma linha. Medido nas 79 revisoes fechadas com mesmos.json (365 pares
  // com resposta): a mesma linha guarda 49 dos 58 "sim" e corta 271 dos 307 "nao" (85 pares em vez de 365); mesma
  // severidade com palavra em comum, a proposta do diagnostico, guardava so 6 dos 58.
  const paresFortes = paresCandidatos.filter(function (p) { return p.distancia === 0; });

  const provaveisMesmos = [];
  // D396 n. 24: null pela API e o mesmo que ausente (sem juiz); a CLI ja barra o mesmos.json com null.
  if (op.mesmos !== undefined && op.mesmos !== null) {
    const mesmos = conferirMesmos(op.mesmos, vistos);
    const vistosPares = new Set();
    for (const m of mesmos) {
      if (m.resposta !== 'sim') continue;
      for (const [chave, outra] of [[m.novo, m.outro], [m.outro, m.novo]]) {
        if (!ehNovoDaUltima.has(chave) || vistosPares.has(chave + '\u0000' + outra)) continue;
        vistosPares.add(chave + '\u0000' + outra);
        const o = metas.get(outra);
        provaveisMesmos.push({ chave: chave, mesmoQue: outra, lente: o.lente, ronda: o.ronda,
          texto: 'provavel mesmo defeito que ' + outra + ' (lente ' + o.lente + ', ronda ' + o.ronda + ')' });
      }
    }
  }

  const ronda = rondas.length;
  // D824 (D3, mattpocock/skills code-review/SKILL.md:76-80): os novos da ultima ronda em dois eixos, padrao e pedido
  // (a lente escopo), cada um com a conta e o pior; sem placar unico, para um eixo limpo nao esconder o outro.
  const eixos = { padrao: { novos: 0, pior: null }, pedido: { novos: 0, pior: null } };
  novosDaUltima.forEach(function (a, i) {
    const eixo = metas.has(novosChavesDaUltima[i]) && metas.get(novosChavesDaUltima[i]).lente === LENTE_DO_PEDIDO
      ? eixos.pedido : eixos.padrao;
    eixo.novos += 1;
    if (eixo.pior === null || SEVERIDADES.indexOf(a.severidade) < SEVERIDADES.indexOf(eixo.pior)) eixo.pior = a.severidade;
  });
  const extra = { achadosDoLadoAntigo: antigosDaUltima, refutados: refutados, paresCandidatos: paresCandidatos,
    paresFortes: paresFortes, provaveisMesmos: provaveisMesmos, referencia: referencia, pendentes: pendentes, trechoNaoConfere: trechoNaoConfere,
    eixos: eixos, registros: registros };
  // A ultima ronda tem referencia e ela ainda nao foi alcancada: barra a aprovacao. Sem referencia (null), nao barra.
  const atrasDaReferencia = referencia !== null && !referencia.pronta;
  // Plano 082, Tarefa 5 (p2-15): lista vazia aqui nao acontece (ronda sem veredito lanca antes, e lente julgada que nao
  // empata nem vence entra em lentesAtras); se acontecer, diz a causa e o que fazer, e nao "nenhuma lente julgada".
  const quaisAtras = atrasDaReferencia ? ' (' + (referencia.lentesAtras.join(', ') ||
    'nenhuma lente julgou contra a referencia: grave os vereditos desta ronda com vsReferencia e apure de novo') + ')' : '';

  if (secas >= 2 && !atrasDaReferencia) {
    return Object.assign({ ronda: ronda, secas: secas, encerrar: true,
      motivo: 'duas rondas secas seguidas: aprovado', novos: novosDaUltima, placar: placar }, extra);
  }
  // F2b (D828): sem a faixa (base de antes) ninguem conferiu quais lentes votaram, e a ronda 1 nao aprova sozinha. O
  // motivo leva "aprovado": e a palavra que o apurar-ronda.js le para marcar o arquivo como revisado.
  if (ronda === 1 && faixa1 !== null && ronda1SemAchado && !atrasDaReferencia) {
    return Object.assign({ ronda: ronda, secas: secas, encerrar: true,
      motivo: 'ronda 1 completa sem achado nenhum: aprovado', novos: novosDaUltima, placar: placar }, extra);
  }
  if (ronda >= TETO) {
    return Object.assign({ ronda: ronda, secas: secas, encerrar: true,
      motivo: 'teto de ' + TETO + ' rondas com ' + abertos.size + ' achado(s) aberto(s) (P0, P1 ou P2 de erro)' +
        (atrasDaReferencia ? ' e a referencia nao alcancada' + quaisAtras : '') +
        // D785 item 5 (s369, 2.5): o teto nao vai ao dono. D828.3 (F2a): nem abre revisao nova; o conserto sai com
        // teste e mutacao, e o commit com a marca que o portao de commit pede (commit.MARCA). O texto nao pode dizer
        // "aprovado": o apurar-ronda.js le essa palavra para marcar o arquivo como revisado.
        ': conserte o que e erro, cada conserto com um teste que reprova quando o codigo e estragado de proposito; ' +
        'com a suite inteira verde, o commit sai com "# sworn: sem-revisao" no fim do comando, sem perguntar; o que ' +
        'sobrar vira registro no plano',
      novos: novosDaUltima, placar: placar }, extra);
  }
  return Object.assign({ ronda: ronda, secas: secas, encerrar: false,
    motivo: 'ronda ' + (ronda + 1) + ' chama so as lentes que acharam P0, P1 ou P2 de erro' +
      (atrasDaReferencia ? ' e as que nao empatam com a referencia ou tem lacuna P0/P1' + quaisAtras : ''),
    novos: novosDaUltima, placar: placar }, extra);
}

module.exports = {
  LENTES, LENTES_UI, FAMILIAS, LENTE_DO_PEDIDO, lentesSoTela, SAEM_SO_LOGICA, familiasPara, FAIXA_UMA_ATE,
  FAIXA_DUAS_ATE, faixaDaMudanca, lentesDaFaixa, temRisco, lentesDaCompleta, TETO, chaveDaLente, errosDoVeredito,
  validarVeredito, apurar, conferirMesmos, DISTANCIA_PAR, mapaDoTrabalho
};
