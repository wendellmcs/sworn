'use strict';
const glob = require('./glob.js');
const degrausLib = require('./degraus.js');
const { ehObjeto } = require('./texto.js');

const MARCHAS = ['rapida', 'padrao', 'aaa'];
const AMEACAS = ['interno', 'publico'];

const CHAVES = [
  'versaoConfig', 'geradoEm', 'plataforma', 'modeloDeAmeaca', 'provaDePronto',
  'quemDecide', 'fontesCanonicas', 'intocaveis', 'marchaPadrao', 'marchas',
  'comandosBloqueados', 'comandosLiberados', 'travas', 'limiares', 'agentes'
];

// D503: chave que pode faltar sem erro, mas que validar() confere quando vem. `referencias` e a peca de topo contra a
// qual a revisao compara, por tipo, cada um uma lista de caminho ou URL (por isso fora de conferirCaminhos).
// Plano 090 Tarefa 5: `marcaDeAtalho`, a marca do /sworn:shortcuts (padrao `atalho`), uma palavra.
// D732 (fila D687): `fontesDeConsulta`, as fontes canonicas que saem do peso de instrucao da auditoria.
// C7 (D816): `admissao`, o resultado do teste de admissao do modelo (scripts/admissao.js --gravar).
// F1c (D828): `provaDeCoerencia`, o comando do grupo de coerencia do disco que a prova por arquivo tocado tambem cobra.
// H3 (D877): `perfil`, o perfil de instalacao (PERFIS abaixo).
// H9-14 (D851, D881): `gravidade`, o teto de bagatelas da revisao cega, desligado por padrao (gravidade abaixo).
const CHAVES_OPCIONAIS = ['referencias', 'marcaDeAtalho', 'fontesDeConsulta', 'admissao', 'provaDeCoerencia', 'perfil',
  'gravidade'];
const TIPOS_REFERENCIA = ['tela', 'codigo', 'texto'];

const TRAVAS = ['fecho', 'escopo', 'destrutivo', 'outraFrente'];

// Os objetos que o re-init funde por chave em vez de substituir (F1-C01; D503: referencias, por tipo). A4-11:
// `agentes` tambem, como o skills/init/references/reinit.md promete: o init grava escada e degraus juntos e a
// subchave posta a mao sobrevive.
const FUNDE_POR_CHAVE = ['travas', 'marchas', 'limiares', 'referencias', 'agentes'];

/**
 * Plano 082 (p1-33): a fusao por chave de `a` com `b` (b vence), chave a chave como dado. O Object.assign tratava a
 * chave propria "__proto__" que o JSON.parse cria como o setter: trocava o prototipo e a chave sumia. Lado nulo ou
 * ausente nao tem chave a fundir (p4-4): vale o outro.
 */
function fundir(a, b) {
  const r = {};
  for (const o of [a, b]) {
    if (o === null || o === undefined) continue;
    for (const k of Object.keys(o)) Object.defineProperty(r, k, { value: o[k], enumerable: true, writable: true, configurable: true });
  }
  return r;
}

// Plano 083 (sobra 2): `referencias: {}` e a resposta "nunca" do init; no re-init ela troca a chave inteira. Nos
// outros objetos de FUNDE_POR_CHAVE, `{}` segue sem apagar nada (o que nao se perguntou, preserva).
const VAZIO_SUBSTITUI = ['referencias'];

// As listas que os portoes LEEM de verdade. O aviso de tipo e estreito de
// proposito (D101): so campo que muda decisao de portao, e so quando o TIPO
// esta errado. Chave faltando e assunto de validar(), nunca do aviso.
const LISTAS_LIDAS = ['comandosLiberados', 'comandosBloqueados', 'intocaveis'];
// D442/5 (S-35, S-68): as chaves de liga/desliga do topo (a lista abaixo; D484: sem numero, que envelhece). Quem le testa `=== false` (ou `=== true`, no
// vigia, que e opt-in): so o booleano decide (D388, D415) - `"false"` entre aspas NAO desliga. Por isso o valor
// torto e avisado na abertura (abertura.js), reprovado em validar() e aceito pelo re-init.
// D468 (0.7.0): `modoContinuo` e opt-in como o vigia (so `=== true` liga, continuo.js).
// D503 (0.8.1): `portaoReferencia` liga por padrao (so `=== false` desliga, portao-fecho.js), como o portaoHandoff.
// D549 (0.8.4): `avisoDeVolta` liga por padrao (so `=== false` desliga, volta.js).
// D554 (0.9.0): `menosCodigo` liga por padrao (so `=== false` desliga, enxuto.js).
// D611 (T3b): `oferecerRadar` liga por padrao (so `=== false` desliga, radar-oferta.js).
// D655: `portaoRevisao` liga por padrao (so `=== false` desliga, portao-fecho.js), como o portaoReferencia.
// D674 (item 10): `pedidos` liga por padrao (so `=== false` desliga, pedidos.js).
// F4e: `guiaDoModelo` liga por padrao (so `=== false` desliga; lido por portao-juiz.js e abertura.js).
// Lote 5 item 12 (D846): `avisoDeLeitura` liga por padrao (so `=== false` desliga, aviso-leitura.js).
const CHAVES_LIGA_DESLIGA = ['sugerirAprender', 'oferecerRadar', 'auditarNaAbertura', 'qualidadeDeResposta', 'portaoDecisao', 'portaoHandoff', 'vigia', 'paralelismo', 'modoContinuo', 'portaoReferencia', 'portaoRevisao', 'avisoDeVolta', 'menosCodigo', 'portaoManual', 'portaoCommit', 'atalhosNaAbertura', 'pedidos', 'juizAcima', 'revisaoTodoCodigo', 'aberturaEnxuta', 'provaPorArquivoTocado', 'guiaDoModelo', 'avisoDeLeitura'];

// Padrao que NUNCA casa um alvo relativo: letra de unidade (C: ou C:\) ou esquema
// (file://). O alvo que chega aos portoes e sempre relativo a raiz do projeto
// (caminho.js), e glob.normalizar (glob.js:9-11) troca "\" por "/" e tira TODAS as
// barras da frente. Por isso "/segredos/**", "//segredos/**" e "\\segredos\**"
// normalizam para a MESMA string e CASAM - recusar qualquer uma delas seria dizer
// que nao casa nada quando casa. Fica no registro X4.
const NAO_RELATIVO = /^([A-Za-z]:|[A-Za-z][A-Za-z0-9+.-]*:\/\/)/;

function ehTexto(v) { return typeof v === 'string' && v.trim() !== ''; }

function ehListaDeTexto(v) {
  return Array.isArray(v) && v.every(function (x) { return ehTexto(x); });
}

/** Data AAAA-MM-DD que existe de verdade. O `typeof` vem antes porque RegExp.test
 *  COAGE o argumento, e Object.create(null) estoura na coercao. */
function ehData(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Recusa padrao de caminho que nao tem como casar o alvo, que e sempre relativo. */
function conferirCaminhos(obj, erros) {
  const listas = [['intocaveis', obj.intocaveis]];
  if (obj.marchas && typeof obj.marchas === 'object') {
    for (const m of MARCHAS) listas.push(['marchas.' + m, obj.marchas[m]]);
  }
  for (const par of listas) {
    if (!Array.isArray(par[1])) continue;
    for (const padrao of par[1]) {
      if (typeof padrao === 'string' && NAO_RELATIVO.test(padrao)) {
        erros.push(par[0] + ': "' + padrao + '" nao e caminho relativo e nao casa nada');
      }
    }
  }
}

/** X2b. Guarda de CONTINENTE: projeto.json SEM a chave `travas` e o formato de
 *  TODO projeto.json de hoje - nada as grava ate a T10. Ler `projeto.travas.X`
 *  direto recriaria o proprio defeito que o X1 conserta, um campo a direita.
 *  A guarda de TIPO aqui e defesa em profundidade e nao morre por mutacao
 *  (R-X2b5): todo consumidor faz so `travas.X === false`, e "sim".destrutivo,
 *  [].destrutivo e (null || {}).destrutivo sao todos undefined. Custo zero. */
function travasDe(projeto) {
  const t = projeto && projeto.travas;
  return (t && typeof t === 'object' && !Array.isArray(t)) ? t : {};
}

/**
 * H3 (D877, R-ECC: perfis minimal, standard, strict). O perfil de instalacao da o padrao das chaves que o
 * projeto.json nao escreve; a chave escrita no arquivo vence, tambem dentro de `travas`. `leve` deixa o apagar
 * (trava 5) e a revisao que se pede a mao: desliga os portoes que barram a entrega ou o commit e as ofertas por conta
 * propria; o escopo (que so barra com escopo declarado: `travas.escopo` nao tem leitor, D104), a pergunta ao dono, o
 * handoff e o guia do modelo seguem. `padrao` e o de hoje. `estrito` cobra a revisao de todo arquivo de codigo, de
 * qualquer marcha.
 */
const PERFIS = {
  leve: {
    travas: { fecho: false, outraFrente: false },
    portaoRevisao: false, portaoReferencia: false, portaoManual: false, portaoCommit: false,
    sugerirAprender: false, oferecerRadar: false, auditarNaAbertura: false, atalhosNaAbertura: false
  },
  padrao: {},
  estrito: { revisaoTodoCodigo: true }
};

const MOTIVO_PERFIL = 'perfil tem de ser um de: ' + Object.keys(PERFIS).join(', ');

/** A resposta de perfil que conta: nem ausente, nem texto vazio ou so de espaco (o Enter num prompt). */
function respondeuPerfil(v) {
  return v !== undefined && !(typeof v === 'string' && v.trim() === '');
}

function ehPerfil(nome) {
  return typeof nome === 'string' && Object.prototype.hasOwnProperty.call(PERFIS, nome);
}

/**
 * H9-14 (D851, D881): a chave `gravidade` = { ligada, bagatelasPorRonda }. Ligada, o inspetor devolve no maximo
 * `bagatelasPorRonda` achados de tipo melhoria (a bagatela, que ja nao segura a ronda pela D823) e a apuracao guarda so
 * esses nos registros de cada ronda. Fica desligada ate a leva de medicao da D851 (achados plantados).
 */
const BAGATELAS_POR_RONDA = 3;
const CHAVES_DA_GRAVIDADE = ['ligada', 'bagatelasPorRonda'];
function errosDaGravidade(g) {
  if (!ehObjeto(g)) return ['gravidade tem de ser objeto: { "ligada": false, "bagatelasPorRonda": ' + BAGATELAS_POR_RONDA + ' }'];
  const erros = [];
  if (typeof g.ligada !== 'boolean') erros.push('gravidade.ligada tem de ser true ou false');
  if ('bagatelasPorRonda' in g && !(Number.isInteger(g.bagatelasPorRonda) && g.bagatelasPorRonda >= 1)) {
    erros.push('gravidade.bagatelasPorRonda tem de ser inteiro de 1 para cima');
  }
  // o aviso vai ao texto do gancho (avisosDeTipo): conta as chaves desconhecidas, sem copiar o nome delas, que vem do
  // arquivo e pode trazer acento ou caractere de controle (D64/R5)
  const desconhecidas = Object.keys(g).filter(function (k) { return CHAVES_DA_GRAVIDADE.indexOf(k) === -1; }).length;
  if (desconhecidas) {
    erros.push('gravidade tem ' + desconhecidas + ' chave(s) que nao conhece: as que valem sao ' + CHAVES_DA_GRAVIDADE.join(', '));
  }
  return erros;
}

/** { bagatelasPorRonda } com a chave ligada e na forma; null desligada, ausente ou torta (torta vale como hoje). */
function gravidade(projeto) {
  if (!ehObjeto(projeto) || errosDaGravidade(projeto.gravidade).length || projeto.gravidade.ligada !== true) return null;
  return { bagatelasPorRonda: projeto.gravidade.bagatelasPorRonda || BAGATELAS_POR_RONDA };
}

/** O projeto com o perfil aplicado, num objeto novo; sem perfil conhecido (ou no `padrao`), o mesmo objeto. */
function comPerfil(projeto) {
  if (!ehObjeto(projeto) || !ehPerfil(projeto.perfil) || projeto.perfil === 'padrao') return projeto;
  const p = PERFIS[projeto.perfil];
  const r = fundir(p, projeto);
  // a `travas` torta fica como veio: o aviso de tipo a mostra, e as travas seguem ligadas (fail-closed)
  if (p.travas && (projeto.travas === undefined || ehObjeto(projeto.travas))) {
    r.travas = fundir(p.travas, projeto.travas);
  }
  return r;
}

/** X2a. Aviso de tipo, estreito (D101): recebe o objeto JA CARREGADO - sem um
 *  segundo readFileSync - e devolve so o que muda decisao de portao.
 *  NENHUM valor do arquivo e interpolado, so nomes de campo de lista fixa: nao
 *  ha caminho de vazamento de acento para o texto do hook (D64/R5). */
function avisosDeTipo(projeto) {
  const avisos = [];
  if (!projeto || typeof projeto !== 'object') return avisos;
  for (const lista of LISTAS_LIDAS) {
    if (!(lista in projeto)) continue;
    const valor = projeto[lista];
    if (!Array.isArray(valor)) { avisos.push(lista + ' tem de ser lista'); continue; }
    // o tipo do ELEMENTO, nao so o da lista: new RegExp faz ToString e [".*"]
    // vira ".*". Um aviso por lista, nao um por item.
    for (const item of valor) {
      if (typeof item !== 'string') { avisos.push(lista + ' tem item que nao e texto'); break; }
    }
  }
  if ('marchas' in projeto) {
    if (!ehObjeto(projeto.marchas)) {
      avisos.push('marchas tem de ser objeto');
    } else {
      for (const m of MARCHAS) {
        if (m in projeto.marchas && !Array.isArray(projeto.marchas[m])) avisos.push('marchas.' + m + ' tem de ser lista');
      }
    }
  }
  if ('marchaPadrao' in projeto && MARCHAS.indexOf(projeto.marchaPadrao) === -1) {
    avisos.push('marchaPadrao tem de ser uma de: ' + MARCHAS.join(', '));
  }
  if ('travas' in projeto && !ehObjeto(projeto.travas)) {
    avisos.push('travas tem de ser objeto');
  }
  // PA1-7/A2-2: as chaves de liga/desliga (so booleano decide no portao). "nao" ou 0 nao desliga e o dono
  // nao sabe. D442/5: todas as de CHAVES_LIGA_DESLIGA, menos a qualidadeDeResposta, cujo aviso segue vindo de
  // qualidade.js (um so por chave).
  for (const chave of CHAVES_LIGA_DESLIGA) {
    if (chave === 'qualidadeDeResposta') continue;
    if (chave in projeto && typeof projeto[chave] !== 'boolean') avisos.push(chave + ' tem de ser true ou false');
  }
  if ('marcaDeAtalho' in projeto && !require('./atalhos.js').ehMarca(projeto.marcaDeAtalho)) {
    avisos.push('marcaDeAtalho tem de ser uma palavra (letras, numeros, - ou _)');
  }
  if ('provaDeCoerencia' in projeto && !ehTexto(projeto.provaDeCoerencia)) {
    avisos.push('provaDeCoerencia tem de ser texto nao vazio (o comando do grupo de coerencia)');
  }
  if ('perfil' in projeto && !ehPerfil(projeto.perfil)) avisos.push(MOTIVO_PERFIL);
  if ('gravidade' in projeto) avisos.push.apply(avisos, errosDaGravidade(projeto.gravidade));
  const deQualidade = require('./qualidade.js').avisoDeTipo(projeto);
  if (deQualidade) avisos.push(deQualidade);
  return avisos;
}

function validar(obj) {
  const erros = [];
  if (!obj || typeof obj !== 'object') return { ok: false, erros: ['projeto.json nao e um objeto'] };

  for (const chave of CHAVES) {
    if (!(chave in obj)) erros.push('falta a chave ' + chave);
  }
  if (obj.versaoConfig !== 1) erros.push('versaoConfig tem de ser 1');
  if (!ehData(obj.geradoEm)) erros.push('geradoEm tem de ser uma data AAAA-MM-DD que existe');
  if (AMEACAS.indexOf(obj.modeloDeAmeaca) === -1) {
    erros.push('modeloDeAmeaca tem de ser "interno" ou "publico"');
  }
  if (!ehTexto(obj.quemDecide)) erros.push('quemDecide tem de ser texto nao vazio');
  // null e resposta legitima: a varredura pode nao ter achado prova de pronto, e a
  // entrevista pergunta. O que nao pode e numero, objeto ou texto so de espaco.
  if (obj.provaDePronto !== null && !ehTexto(obj.provaDePronto)) {
    erros.push('provaDePronto tem de ser texto nao vazio ou null');
  }
  if (MARCHAS.indexOf(obj.marchaPadrao) === -1) {
    erros.push('marchaPadrao tem de ser uma de: ' + MARCHAS.join(', '));
  }
  if (!obj.plataforma || !ehTexto(obj.plataforma.so) || !ehTexto(obj.plataforma.shell)) {
    erros.push('plataforma precisa de so e shell, os dois texto nao vazio');
  }
  for (const lista of ['fontesCanonicas', 'intocaveis', 'comandosBloqueados', 'comandosLiberados']) {
    if (lista in obj && !ehListaDeTexto(obj[lista])) erros.push(lista + ' tem de ser lista de texto');
  }
  if (!obj.marchas || typeof obj.marchas !== 'object') {
    erros.push('marchas tem de ser objeto');
  } else {
    for (const m of MARCHAS) {
      if (!(m in obj.marchas)) { erros.push('falta marchas.' + m); continue; }
      if (!ehListaDeTexto(obj.marchas[m])) erros.push('marchas.' + m + ' tem de ser lista de texto');
    }
  }
  // `for..of` sobre {} ou numero ESTOURA, e validador que estoura nao reprova: ele
  // derruba quem o chamou. O tipo errado ja virou erro nomeado no laco acima.
  for (const lista of ['comandosBloqueados', 'comandosLiberados']) {
    if (!Array.isArray(obj[lista])) continue;
    for (const padrao of obj[lista]) {
      if (typeof padrao !== 'string') continue;
      try { new RegExp(padrao); } catch (e) { erros.push(lista + ': regex invalida "' + padrao + '"'); }
    }
  }
  // O portao testa o escape ANTES de classificar (portao-destrutivo.js:31): com o
  // mesmo padrao nos dois lados o liberado vence sempre, e a regra de bloqueio do
  // dono nao vale nada. Pega a grafia identica; a familia larga e o registro X5.
  if (Array.isArray(obj.comandosBloqueados) && Array.isArray(obj.comandosLiberados)) {
    for (const padrao of obj.comandosBloqueados) {
      if (obj.comandosLiberados.indexOf(padrao) !== -1) {
        erros.push('o padrao "' + padrao + '" esta em comandosBloqueados E em comandosLiberados');
      }
    }
    // X5b: UNIAO, nunca substituicao. O laco acima pega a grafia identica; este
    // pega o liberado que CASA o texto do bloqueado ("npm publis" x "npm
    // publish"), que o indexOf perde. Trocar um pelo outro perderia 7 de 10
    // deteccoes de hoje, porque padrao ancorado nao casa a propria grafia:
    // new RegExp("\\bnpm publish\\b").test("\\bnpm publish\\b") = false.
    for (const bloqueado of obj.comandosBloqueados) {
      if (typeof bloqueado !== 'string') continue;
      for (const liberado of obj.comandosLiberados) {
        if (typeof liberado !== 'string' || liberado === bloqueado) continue;
        let casa = false;
        // A4-21: a regex vem do projeto.json do dono (comandosLiberados), sem teto de custo de proposito: quem a
        // escreve e quem roda a validacao e o mesmo dono. O try so pega a regex que nem compila.
        try { casa = new RegExp(liberado, 'i').test(bloqueado); } catch (e) { casa = false; }
        if (casa) erros.push('comandosLiberados: "' + liberado + '" neutraliza o comandosBloqueados "' + bloqueado + '"');
      }
    }
  }
  conferirCaminhos(obj, erros);
  // `obj.travas &&` deixava passar null; e {} nao tem trava nenhuma dentro.
  // H3 (D877): com perfil, a trava que falta vem dele (ou fica ligada, se ele nao a muda); a que vem e booleana.
  const comPerfilValido = ehPerfil(obj.perfil);
  if ('perfil' in obj && !comPerfilValido) erros.push(MOTIVO_PERFIL);
  if (!ehObjeto(obj.travas)) {
    erros.push(comPerfilValido ? 'travas tem de ser objeto: {} ou so as travas que mudam o perfil'
      : 'travas tem de ser objeto com as quatro chaves');
  } else {
    for (const t of TRAVAS) {
      if (comPerfilValido && !(t in obj.travas)) continue;
      if (typeof obj.travas[t] !== 'boolean') erros.push('travas.' + t + ' tem de ser true ou false');
    }
  }

  // D442/5 (S-35): o valor torto passava calado aqui (o aviso so saia no carregamento).
  for (const chave of CHAVES_LIGA_DESLIGA) {
    if (chave in obj && typeof obj[chave] !== 'boolean') erros.push(chave + ' tem de ser true ou false');
  }

  if ('limiares' in obj && (obj.limiares === null || typeof obj.limiares !== 'object')) {
    erros.push('limiares tem de ser objeto');
  }

  // D503: tipo desconhecido e erro, nao silencio - `telas` com typo ficaria inerte, como o intocavel da D104.
  if ('referencias' in obj) {
    if (!ehObjeto(obj.referencias)) {
      erros.push('referencias tem de ser objeto');
    } else {
      for (const tipo of Object.keys(obj.referencias)) {
        if (TIPOS_REFERENCIA.indexOf(tipo) === -1) {
          erros.push('referencias.' + tipo + ' nao e tipo conhecido (' + TIPOS_REFERENCIA.join(', ') + ')');
        } else if (!ehListaDeTexto(obj.referencias[tipo])) {
          erros.push('referencias.' + tipo + ' tem de ser lista de texto');
        }
      }
    }
  }

  if ('marcaDeAtalho' in obj && !require('./atalhos.js').ehMarca(obj.marcaDeAtalho)) {
    erros.push('marcaDeAtalho tem de ser uma palavra (letras, numeros, - ou _)');
  }
  if ('provaDeCoerencia' in obj && !ehTexto(obj.provaDeCoerencia)) {
    erros.push('provaDeCoerencia tem de ser texto nao vazio (o comando do grupo de coerencia)');
  }

  if ('gravidade' in obj) erros.push.apply(erros, errosDaGravidade(obj.gravidade));

  // C7 (D816): o resultado do teste de admissao, com a forma que o scripts/admissao.js grava.
  if ('admissao' in obj) erros.push.apply(erros, require('./admissao.js').errosDaAdmissao(obj.admissao));

  // D732: so fonte canonica sai do peso; o item fora delas ficaria inerte calado (D104, D503).
  if ('fontesDeConsulta' in obj) {
    if (!ehListaDeTexto(obj.fontesDeConsulta)) {
      erros.push('fontesDeConsulta tem de ser lista de texto');
    } else if (!('fontesCanonicas' in obj) || ehListaDeTexto(obj.fontesCanonicas)) {
      // A6-83 (pedido 12): com a fontesCanonicas reprovada acima, o erro dela basta; conferir item por item contra ela
      // somaria um erro por item, com a mesma causa.
      const comoCaminho = function (f) { return require('node:path').posix.normalize(String(f).replace(/\\/g, '/')); };
      const canonicas = (Array.isArray(obj.fontesCanonicas) ? obj.fontesCanonicas : []).map(comoCaminho);
      for (const f of obj.fontesDeConsulta) {
        if (canonicas.indexOf(comoCaminho(f)) === -1) {
          // A6-95 (D735): o efeito em palavras, no lugar de "sai do peso".
          erros.push('fontesDeConsulta: "' + f + '" nao esta em fontesCanonicas, e so fonte canonica pode ficar fora ' +
            'da conta do limite de instrucoes do /sworn:audit; corrija o caminho ou declare-a canonica');
        }
      }
    }
  }

  // A4-12: texto ou lista em `agentes` nao tem escada a conferir e passava calado.
  if ('agentes' in obj && !ehObjeto(obj.agentes)) erros.push('agentes tem de ser objeto');
  if ('agentes' in obj && ehObjeto(obj.agentes)) {
    const esc = obj.agentes.escada;
    if (esc !== undefined && !ehListaDeTexto(esc)) erros.push('agentes.escada tem de ser lista de texto');
    const deg = obj.agentes.degraus;
    if (deg !== undefined) {
      if (!Array.isArray(deg)) {
        erros.push('agentes.degraus tem de ser lista');
      } else {
        for (const e of degrausLib.validar(deg).erros) erros.push('agentes.degraus: ' + e);
        // O acoplamento da spec §7: os dois lados, na mesma ordem. Gravar um sem
        // o outro nao estoura em lugar nenhum - so deixa um portao mudo.
        for (const p of degrausLib.desalinhados(obj.agentes)) erros.push('agentes: ' + p);
      }
    }
  }

  return { ok: erros.length === 0, erros: erros };
}

/** Tres casos, nao dois:
 *  - sem resposta (undefined, ou texto so de espaco - o Enter num prompt devolve "")
 *    -> vale o que a varredura inferiu;
 *  - resposta "nenhuma" (null) -> vence o palpite da varredura e vira vazio;
 *  - qualquer outra resposta -> vale como esta, e validar() a confere.
 *  Cair no inferido porque o dono respondeu null seria descartar a resposta dele. */
function escolher(daEntrevista, doInferido, vazio) {
  const semResposta = daEntrevista === undefined ||
    (typeof daEntrevista === 'string' && daEntrevista.trim() === '');
  if (semResposta) return doInferido === undefined ? vazio : doInferido;
  return daEntrevista === null ? vazio : daEntrevista;
}

/** Junta o que a varredura inferiu com o que a entrevista perguntou. */
function montar(inferido, respostas) {
  const i = inferido || {};
  const r = respostas || {};
  const hoje = new Date().toISOString().slice(0, 10);
  const travas = {};
  for (const t of TRAVAS) {
    // Default LIGADO. A resposta do dono so vale se for booleano de verdade - e se
    // ele desligou, fica desligado: religar calado seria a mentira que este plugin
    // existe para impedir.
    // H3 (D877): com perfil escolhido, so a trava respondida se grava; a que falta vem do perfil ao carregar, ou fica
    // ligada, se ele nao a muda.
    if (r.travas && typeof r.travas[t] === 'boolean') travas[t] = r.travas[t];
    else if (!ehPerfil(r.perfil)) travas[t] = true;
  }
  const montado = {
    versaoConfig: 1,
    geradoEm: hoje,
    plataforma: i.plataforma || { so: process.platform, shell: process.platform === 'win32' ? 'powershell' : 'bash' },
    // `undefined` SOME no JSON.stringify: o objeto passaria em validar() e voltaria
    // invalido do disco. `null` sobrevive a gravacao, e validar() o recusa aqui e agora.
    modeloDeAmeaca: r.modeloDeAmeaca === undefined ? null : r.modeloDeAmeaca,
    provaDePronto: escolher(r.provaDePronto, i.provaDePronto, null),
    quemDecide: r.quemDecide === undefined ? null : r.quemDecide,
    fontesCanonicas: escolher(r.fontesCanonicas, i.candidatosCanonicos, []),
    intocaveis: escolher(r.intocaveis, undefined, []),
    marchaPadrao: r.marchaPadrao || 'padrao',
    marchas: {
      aaa: (r.marchas && r.marchas.aaa) || [],
      padrao: (r.marchas && r.marchas.padrao) || [],
      rapida: (r.marchas && r.marchas.rapida) || []
    },
    comandosBloqueados: escolher(r.comandosBloqueados, undefined, []),
    comandosLiberados: escolher(r.comandosLiberados, undefined, []),
    travas: travas,
    limiares: r.limiares || {},
    // A entrevista responde `degraus`; os dois lados saem daqui juntos, ou nao saem.
    // Sem resposta, preserva-se o que ja vinha: configuracao antiga nao se reescreve sozinha.
    agentes: r.degraus !== undefined ? degrausLib.paraProjeto(r.degraus) : (r.agentes || { escada: [] })
  };
  // a resposta que nao e perfil vai como veio, e o validar() a recusa (o dono ve o erro em vez de cair no padrao)
  if (respondeuPerfil(r.perfil)) montado.perfil = r.perfil;
  return montado;
}

/**
 * H3: nao havia caminho de volta. O `geradoEm` era gravado uma vez e nunca mais,
 * e a pessoa respondia os degraus uma vez na vida.
 *
 * Regra unica e dura: o que a entrevista NAO perguntou de novo, PRESERVA-SE.
 * Um re-init que zera `intocaveis` porque ninguem os mencionou e pior do que nao
 * ter re-init nenhum - o arquivo continua parecendo proteger, e nao protege.
 *
 * `atualizar` NAO valida: quem valida e `validar`, e o roteiro roda os dois. Meia
 * configuracao de entrada sai meia configuracao - inventar o que falta seria
 * gravar palpite com cara de resposta do dono.
 */
function atualizar(antigo, respostas, hoje) {
  const base = (antigo && typeof antigo === 'object' && !Array.isArray(antigo))
    ? JSON.parse(JSON.stringify(antigo)) : {};
  const r = (respostas && typeof respostas === 'object') ? respostas : {};
  const data = ehData(hoje) ? hoje : new Date().toISOString().slice(0, 10);

  // p4-3 (seguranca): copia chave a chave como dado. O Object.assign tratava o "__proto__" proprio do JSON.parse como o
  // setter: o prototipo de `novas` virava o objeto da resposta, e um `degraus` herdado dele gerava `agentes`.
  const novas = fundir({}, r);
  if (novas.degraus !== undefined) {
    novas.agentes = degrausLib.paraProjeto(novas.degraus);
    delete novas.degraus;
  }

  // H3 (D877): o re-init que troca de perfil troca as travas pelas respondidas agora (`{}` sem nenhuma), sem fundir:
  // as do arquivo antigo, que o init gravava todas `true` sem perfil, venceriam o perfil novo.
  // O arquivo sem perfil (ou com um torto) vale o `padrao`: responder `padrao` a ele nao e troca.
  const perfilAtual = ehPerfil(base.perfil) ? base.perfil : 'padrao';
  const trocouPerfil = ehPerfil(novas.perfil) && novas.perfil !== perfilAtual;
  if (trocouPerfil && novas.travas === undefined) novas.travas = {};
  // o Enter vazio nao e resposta de perfil (a convencao do escolher), aqui e no montar
  if (!respondeuPerfil(novas.perfil)) delete novas.perfil;

  const mudou = [];
  const ignoradas = [];
  for (const chave of Object.keys(novas)) {
    // D442/5 (S-35): as chaves de liga/desliga sao do projeto.json, mesmo fora de CHAVES (que sao as obrigatorias).
    // D503: as opcionais tambem.
    if (CHAVES.indexOf(chave) === -1 && CHAVES_LIGA_DESLIGA.indexOf(chave) === -1 &&
        CHAVES_OPCIONAIS.indexOf(chave) === -1) { ignoradas.push(chave); continue; }
    if (chave === 'versaoConfig' || chave === 'geradoEm') continue;
    if (novas[chave] === undefined) continue;
    // F1-C01: resposta parcial de objeto se funde por chave; trocar o objeto inteiro
    // apagava as chaves que a entrevista nao repetiu (regra unica: o que nao se perguntou, preserva).
    let valor = novas[chave];
    const vazioSubstitui = VAZIO_SUBSTITUI.indexOf(chave) !== -1 && ehObjeto(valor) && Object.keys(valor).length === 0;
    if (FUNDE_POR_CHAVE.indexOf(chave) !== -1 && ehObjeto(valor) && ehObjeto(base[chave]) && !vazioSubstitui &&
        !(chave === 'travas' && trocouPerfil)) {
      valor = fundir(base[chave], valor);
    }
    if (JSON.stringify(base[chave]) === JSON.stringify(valor)) continue;
    base[chave] = valor;
    mudou.push(chave);
  }

  base.versaoConfig = 1;
  if (base.geradoEm !== data) { base.geradoEm = data; mudou.push('geradoEm'); }

  return { config: base, mudou: mudou, ignoradas: ignoradas };
}

// L2-s103-22: segmento inteiro de rota do Next.js e afins (`[id]`, `[...slug]`, `[[...slug]]`): pasta de verdade,
// com o colchete no nome, que o glob.js casa como literal.
const SEGMENTO_DE_ROTA = /^\[\[?(\.\.\.)?[\w-]+\]\]?$/;

// A pasta fixa do padrao: os segmentos antes do primeiro caractere de glob ("src/a/**" da "src/a"); sem nenhum, null.
// O segmento de rota e literal, entao entra na pasta fixa.
function pastaFixa(padrao) {
  const fixos = [];
  for (const seg of String(padrao).split('/')) {
    if (seg === '' || (/[*?[\]{}]/.test(seg) && !SEGMENTO_DE_ROTA.test(seg))) break;
    fixos.push(seg);
  }
  return fixos.length ? fixos.join('/') : null;
}

// A2-05: o glob.js so entende `*` e `**`; `?`, `[ ]`, `{a,b}` e a barra no fim ficam literais e nao casam o que o
// dono quis. Padrao nessa forma e inerte pela forma, e a pasta fixa existir no disco nao o salva. O colchete do
// segmento de rota nao conta: ali o literal e o que o dono quis.
const FORA_DO_GLOB = /[?[\]{}]|\/$/;
function foraDoGlob(p) {
  return FORA_DO_GLOB.test(p.split('/').filter(function (seg) { return !SEGMENTO_DE_ROTA.test(seg); }).join('/'));
}

/**
 * Padroes de `intocaveis` que nao casam com NENHUM arquivo do repositorio.
 *
 * O buraco que a D104 mediu e nao fechou: `intocaveis` escrito com typo
 * (`segredo/**` em vez de `segredos/**`) fica INERTE em silencio. Nao e erro de
 * tipo, entao `avisosDeTipo` nao ve; nao e erro de sintaxe, entao `validar` nao
 * ve. A configuracao parece proteger e nao protege - e, como a D104 mostrou, o
 * que segura o segredo nesse caso e o passo 5 do portao, por acidente.
 *
 * Aqui nao se adivinha intencao: so se diz que o padrao nao pegou nada. Um
 * padrao para pasta que ainda nao existe e legitimo, e por isso isto AVISA, nunca
 * nega. Funcao pura sobre duas listas, para poder ser testada sem repositorio.
 *
 * D244/defeito 6: com `cwd`, a pasta fixa do padrao (os segmentos antes do primeiro
 * caractere de glob) que EXISTE no disco tambem salva o padrao - pasta ignorada pelo git
 * de proposito nao e typo. Padrao sem pasta fixa (`**\/*.pem`) nao se salva assim.
 */
function intocaveisInertes(projeto, arquivos, cwd) {
  const padroes = (projeto && Array.isArray(projeto.intocaveis)) ? projeto.intocaveis : [];
  if (!Array.isArray(arquivos) || arquivos.length === 0) return [];
  return padroes.filter(function (p) {
    if (typeof p !== 'string' || !p.trim()) return false;
    if (arquivos.some(function (a) { return glob.casa(p, a, false); })) return false;
    // L2-s103-23: a pasta fixa sai do mesmo texto sem espaco que a forma conferiu.
    const fixa = cwd && !foraDoGlob(p.trim()) ? pastaFixa(p.trim()) : null;
    if (fixa) {
      // o erro ao olhar o disco (permissao, caminho invalido) nao salva o padrao: ele segue avisado como inerte
      try {
        const fs = require('node:fs');
        const path = require('node:path');
        if (fs.existsSync(path.join(cwd, fixa))) return false;
      } catch (e) { /* segue inerte, como diz acima */ }
    }
    return true;
  });
}

function motivoInerte(inertes) {
  return [
    'sworn: ATENCAO - ' + inertes.length + ' padrao(oes) de `intocaveis` nao pegam arquivo nenhum:',
    inertes.map(function (p) { return '  - ' + p; }).join('\n'),
    'Padrao que nao casa nada nao protege nada. Se a pasta ainda nao existe, esta certo;',
    'se e typo, o arquivo que voce quis proteger esta desprotegido AGORA.'
  ].concat(inertes.some(function (p) { return foraDoGlob(String(p).trim()); })
    ? ['O sworn so entende * e **: escreva "pasta/**" em vez de "pasta/", e um padrao para cada extensao em vez de {a,b}.']
    : [], ['Confira em .claude/sworn/projeto.json, chave `intocaveis`.']).join('\n');
}

module.exports = {
  AMEACAS, CHAVES, TRAVAS, CHAVES_LIGA_DESLIGA, CHAVES_OPCIONAIS, TIPOS_REFERENCIA, PERFIS, travasDe, comPerfil, avisosDeTipo,
  BAGATELAS_POR_RONDA, gravidade,
  intocaveisInertes, motivoInerte, validar, montar, atualizar, fundir
};
