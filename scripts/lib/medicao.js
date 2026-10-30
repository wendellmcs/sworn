'use strict';

/**
 * A medicao A/B do recurso de qualidade de resposta (docs/qualidade-de-resposta.md, secao 6): a
 * apuracao pura. Sem disco, sem relogio, sem processo: resultado de geracao e de juiz entram por
 * parametro, e o veredito sai por regra escrita aqui. E por isso que o teste consegue dar cada um
 * dos 4 vereditos com dado de mentira - inclusive os que reprovam o recurso.
 *
 * Duas regras que existem por defeito ja visto na revisao cega (0.3.3):
 *   - juiz que NAO respondeu nunca e empate: sem veredito o resultado e `null`, com a lista do que falta;
 *   - campo ausente parece zero: `output_tokens` que nao e numero finito >= 0 invalida a rodada.
 */

const qualidade = require('./qualidade.js');
const { entreAspas } = require('./texto.js');

const CONDICOES = ['padrao', 'caveman', 'recurso'];
const RIVAIS = ['caveman', 'padrao'];
const ORDENS = [1, 2];

/**
 * A lente do juiz. Vive so aqui, de proposito: nao entra em `veredito.LENTES` e nao cita as 6 regras
 * do bloco - julgar pelas regras do proprio recurso seria circular. O texto e o do desenho, sem acento
 * (string de script e ASCII).
 */
const LENTE = {
  chave: 'clareza',
  titulo: 'clareza para quem perguntou',
  pergunta: 'Qual das duas respostas a pessoa que fez a pergunta entende mais rapido e com menos ' +
    'releitura, sabendo o que aconteceu e o que fazer a seguir? A resposta que omite o que ela ' +
    'precisava para agir perde, mesmo sendo mais curta. Quem pergunta le no idioma da pergunta.'
};

/** O que fazer quando faltam julgamentos: a mesma frase no motivo do apurar e na tela do --veredito. */
const ACAO_DE_JULGAR = 'Julgue os pares que faltam (as instrucoes do juiz saem de: ' +
  'node scripts/medir-qualidade.js --pares <pasta da rodada>; cada veredito vai em pares/<par>/vereditos/' +
  LENTE.chave + '.json) e rode --veredito <pasta da rodada> de novo.';

/** O comando que liga o caveman no modo print. Quem julga nunca o ve: `perguntaDaCondicao` so o poe no envio. */
const COMANDO_CAVEMAN = '/caveman ';

/** A 1a linha do bloco da qualidade: a marca que prova que o recurso chegou a sessao. */
const MARCADOR_DO_BLOCO = qualidade.BLOCO.split('\n')[0];

/** A 1a linha do que a abertura do sworn escreve quando ha regras do projeto. */
const CABECALHO_DA_ABERTURA = /^# sworn - regras/m;

function perguntaDaCondicao(pergunta, condicao) {
  return condicao === 'caveman' ? COMANDO_CAVEMAN + pergunta : pergunta;
}

// ── o juiz e o par ───────────────────────────────────────────────────────

// trecho entre aspas (retas, crase, curvas, baixas ou angulares), numa linha so: e citacao do texto julgado, nao o
// juiz falando. O miolo nao aceita o proprio abridor: abridor solto para no seguinte, e o custo fica linear.
// A aspa reta nao abre colada em letra: users' e plural, nao citacao. O fecho curvo usado como abridor (u2019 e
// u201d dos dois lados) tambem so abre fora de letra, pelo mesmo motivo, e so quando e o unico par daquele sinal
// na linha (D341): com 4 na linha, o 1o e o 2o casariam por cima do "nao sei" do juiz. ENTRE_ASPAS[n]: o bit 1
// liga o u2019, o bit 2 o u201d.
const ENTRE_ASPAS_BASE = /(?<!\p{L})'[^'\n]*'|"[^"\n]*"|`[^`\n]*`|\u2018[^\u2018\u2019\n]*\u2019|\u201c[^\u201c\u201d\n]*\u201d|\u00ab[^\u00ab\u00bb\n]*\u00bb|\u201e[^\u201e\u201c\u201d\n]*[\u201c\u201d]|\u201a[^\u201a\u2018\u2019\n]*[\u2018\u2019]|\u2039[^\u2039\u203a\n]*\u203a/u.source;
const FECHO_QUE_ABRE = ['(?<!\\p{L})\\u2019[^\\u2019\\n]*\\u2019', '\\u201d[^\\u201d\\n]*\\u201d'];
const ENTRE_ASPAS = [0, 1, 2, 3].map(function (n) {
  return new RegExp(ENTRE_ASPAS_BASE + (n & 1 ? '|' + FECHO_QUE_ABRE[0] : '') + (n & 2 ? '|' + FECHO_QUE_ABRE[1] : ''), 'gu');
});

// apostrofo entre letras (don't, it's, d'agua) e da palavra, nao aspa: vira espaco antes de procurar aspas.
// Colado em numero e aspa: A.txt:3'nao sei' cita o texto julgado.
const APOSTROFO = /(\p{L})['\u2019](?=\p{L})/gu;

// marcas (til, acento, seletor de variante) e caracteres de formato (largura zero, hifen suave, marca de
// direcao) nao separam nem escondem o "nao sei": somem depois do NFD. Os 4 preenchedores do hangul (Lo, nao Cf)
// parecem espaco e tambem escondem.
const MARCAS_E_FORMATO = /[\p{M}\p{Cf}\u115f\u1160\u3164\uffa0]/gu;

// o juiz que diz que nao sabe, na 1a pessoa: "nao sei" e as frases curtas de abstencao. "nao tenho certeza" e
// ressalva, nao abstencao: fica de fora
const NAO_SABE = '(?:nao\\s*(?:sei|consigo\\s*(?:dizer|saber|decidir|escolher|julgar)|da\\s*para\\s*(?:dizer|saber|decidir)|' +
  'tenho\\s*como\\s*(?:dizer|saber|decidir))|impossivel\\s*(?:dizer|saber|decidir))\\b';
const NAO_SABE_NO_INICIO = new RegExp('^\\W*' + NAO_SABE, 'i');
const NAO_SABE_NO_MEIO = new RegExp('\\b' + NAO_SABE, 'i');

// aspas que pareiam entre si numa linha: reta, reta simples, curvas simples (abre u2018/u201a, fecha u2018/u2019) e
// curvas duplas (u201c/u201d/u201e). Em numero impar na linha nao fecham: ali nao abrem citacao nenhuma.
const GRUPOS_DE_ASPAS = [/"/g, /'/g, /[\u2018\u2019\u201a]/g, /[\u201c\u201d\u201e]/g];

/**
 * 'A' | 'B' | 'empate'. Vira empate quando o veredito nao existe, nao aponta A ou B, nao cita
 * `A.txt:<n>` ou `B.txt:<n>` no porQue (achado sem citacao nao conta) ou o inspetor disse que nao
 * sabe: o porQue abre com "nao sei" (com ou sem aspas, a forma que o contrato do juiz pede) ou tem
 * "nao sei" fora de aspas. O "nao sei" entre aspas no meio e citacao do texto julgado e conta voto. Valem como
 * "nao sei" tambem as frases curtas em 1a pessoa (nao consigo dizer, nao da para saber, impossivel decidir...),
 * com a mesma regra de aspas; "nao tenho certeza" e ressalva e conta voto. Aspa em numero impar na linha nao
 * forma citacao nenhuma naquela linha; o fecho curvo usado dos dois lados so cita quando e o unico par (D341).
 * A citacao reta que fecha colada em letra ('nao sei'ou) tem a mesma forma da contracao do juiz (nao sei, don't):
 * na duvida vale empate (D340).
 */
function votoDoJuiz(vd) {
  if (!vd || typeof vd !== 'object') return 'empate';
  if (vd.melhor !== 'A' && vd.melhor !== 'B') return 'empate';
  const porQue = typeof vd.porQue === 'string' ? vd.porQue : '';
  // a citacao e de um dos dois textos julgados: "12:30" ou "C.txt:3" nao contam
  if (!/\b[AB]\.txt:\d+/.test(porQue)) return 'empate';
  // com ou sem til, decomposto ou nao, com qualquer espaco ou nenhum: o juiz escreve em portugues
  const texto = porQue.normalize('NFD').replace(MARCAS_E_FORMATO, '');
  if (NAO_SABE_NO_INICIO.test(texto)) return 'empate';
  if (NAO_SABE_NO_MEIO.test(foraDeAspas(texto))) return 'empate';
  return vd.melhor;
}

/** O texto sem as citacoes, linha a linha; as aspas sem par na linha (GRUPOS_DE_ASPAS) saem antes de pesquisar. */
function foraDeAspas(texto) {
  const linhas = texto.split('\n').map(function (linha) {
    let l = linha.replace(APOSTROFO, '$1 ');
    GRUPOS_DE_ASPAS.forEach(function (g) {
      if (((l.match(g) || []).length) % 2 === 1) l = l.replace(g, ' ');
    });
    const fecho1 = (l.match(/\u2019/g) || []).length === 2 ? 1 : 0;
    const fecho2 = (l.match(/\u201d/g) || []).length === 2 ? 2 : 0;
    return l.replace(ENTRE_ASPAS[fecho1 + fecho2], ' ');
  });
  return linhas.join('\n');
}

/**
 * Ordem 1: o recurso e o A. Ordem 2: o recurso e o B. So conta quando as duas ordens apontam o mesmo
 * lado - discordar e vies de posicao, e vira empate.
 */
function resultadoDoPar(votoOrdem1, votoOrdem2) {
  if (votoOrdem1 === 'A' && votoOrdem2 === 'B') return 'recurso';
  if (votoOrdem1 === 'B' && votoOrdem2 === 'A') return 'rival';
  return 'empate';
}

function nomeDoPar(prompt, rival, ordem) {
  return prompt + '-' + rival + '-' + ordem;
}

// ── a apuracao ───────────────────────────────────────────────────────────

function tokensValidos(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

function idsDe(prompts) {
  return (Array.isArray(prompts) ? prompts : []).map(function (p) {
    return p && typeof p === 'object' ? p.id : p;
  });
}

/**
 * `geracoes`:   [{ prompt, condicao, ok, texto, aplicou, outputTokens }]
 * `julgamentos`: [{ prompt, rival, ordem, veredito }]
 *
 * Na ordem da tabela do desenho, o primeiro que casa vale:
 *   INVALIDO -> (par sem veredito: null) -> INCONCLUSIVO -> GANHA -> NAO GANHA.
 * O INVALIDO vem antes do `null` porque rodada com geracao ruim nao merece juiz.
 */
function apurar(entrada) {
  const e = entrada || {};
  const ids = idsDe(e.prompts);
  const geracoes = Array.isArray(e.geracoes) ? e.geracoes : [];
  const julgamentos = Array.isArray(e.julgamentos) ? e.julgamentos : [];

  const motivos = [];
  const invalidos = [];
  const tokens = { padrao: 0, caveman: 0, recurso: 0 };

  if (ids.length === 0) invalidos.push('nenhum prompt para medir');

  // as geracoes: cada prompt x condicao exatamente uma vez, valida
  const porChave = Object.create(null);
  geracoes.forEach(function (g) {
    const k = g && g.prompt + '/' + g.condicao;
    (porChave[k] = porChave[k] || []).push(g);
  });
  ids.forEach(function (id) {
    CONDICOES.forEach(function (c) {
      const onde = id + '/' + c;
      const achadas = porChave[onde] || [];
      if (achadas.length === 0) { invalidos.push(onde + ': geracao ausente'); return; }
      if (achadas.length > 1) { invalidos.push(onde + ': geracao repetida (' + achadas.length + ')'); return; }
      const g = achadas[0];
      if (g.ok !== true) invalidos.push(onde + ': a geracao falhou (ok falso)');
      if (typeof g.texto !== 'string' || g.texto.trim() === '') invalidos.push(onde + ': texto vazio');
      if (g.aplicou !== true) invalidos.push(onde + ': a condicao nao se aplicou (aplicou falso)');
      if (!tokensValidos(g.outputTokens)) invalidos.push(onde + ': output_tokens ausente ou invalido');
      else tokens[c] += g.outputTokens;
    });
  });

  // os julgamentos: o ultimo de cada par vale; sem veredito e sem entrada, e a mesma coisa: FALTA
  const julgados = Object.create(null);
  julgamentos.forEach(function (j) {
    if (!j || !j.veredito || typeof j.veredito !== 'object') return;
    julgados[nomeDoPar(j.prompt, j.rival, Number(j.ordem))] = j.veredito;
  });
  const faltam = [];
  ids.forEach(function (id) {
    RIVAIS.forEach(function (rival) {
      ORDENS.forEach(function (ordem) {
        if (!julgados[nomeDoPar(id, rival, ordem)]) faltam.push(id + '/' + rival + '/' + ordem);
      });
    });
  });

  // o placar, so com o que foi julgado
  const placar = {};
  RIVAIS.forEach(function (rival) {
    const p = { vitorias: 0, derrotas: 0, empates: 0 };
    ids.forEach(function (id) {
      const v1 = julgados[nomeDoPar(id, rival, 1)];
      const v2 = julgados[nomeDoPar(id, rival, 2)];
      if (!v1 || !v2) return;
      const r = resultadoDoPar(votoDoJuiz(v1), votoDoJuiz(v2));
      if (r === 'recurso') p.vitorias++;
      else if (r === 'rival') p.derrotas++;
      else p.empates++;
    });
    placar[rival] = p;
  });

  const saida = { veredito: null, faltam: faltam, motivos: motivos, placar: placar, tokens: tokens };

  if (invalidos.length > 0) {
    saida.veredito = 'INVALIDO';
    invalidos.forEach(function (m) { motivos.push(m); });
    return saida;
  }
  if (faltam.length > 0) {
    motivos.push('faltam ' + faltam.length + ' julgamento(s): sem veredito do juiz o par nao vira empate. ' + ACAO_DE_JULGAR);
    return saida;
  }

  const inconclusivos = RIVAIS.filter(function (rival) { return placar[rival].empates > ids.length / 2; });
  if (inconclusivos.length > 0) {
    saida.veredito = 'INCONCLUSIVO';
    inconclusivos.forEach(function (rival) {
      motivos.push('contra ' + rival + ': ' + placar[rival].empates + ' empates em ' + ids.length + ' pares');
    });
    return saida;
  }

  const vencePlacar = RIVAIS.every(function (rival) { return placar[rival].vitorias > placar[rival].derrotas; });
  const gastaMenos = tokens.recurso < tokens.padrao;
  if (vencePlacar && gastaMenos) {
    saida.veredito = 'GANHA';
    return saida;
  }

  saida.veredito = 'NAO GANHA';
  RIVAIS.forEach(function (rival) {
    const p = placar[rival];
    if (p.vitorias <= p.derrotas) {
      motivos.push('contra ' + rival + ': ' + p.vitorias + ' vitorias e ' + p.derrotas + ' derrotas (precisa de mais vitorias que derrotas)');
    }
  });
  if (!gastaMenos) {
    motivos.push('tokens de saida: recurso ' + tokens.recurso + ' nao ficou abaixo do padrao ' + tokens.padrao);
  }
  return saida;
}

// ── a transcricao da sessao ──────────────────────────────────────────────

/** O comando caveman expandido, como a transcricao o grava. O nome e exato: caveman-commit nao e este. */
const COMANDO_CAVEMAN_EXPANDIDO = /<command-name>\/caveman<\/command-name>/;

function textosDoUsuario(ev) {
  const c = ev && ev.message && ev.message.content;
  if (typeof c === 'string') return [c];
  if (!Array.isArray(c)) return [];
  return c.filter(function (b) { return b && typeof b.text === 'string'; }).map(function (b) { return b.text; });
}

/**
 * Le as linhas da transcricao que o claude grava da sessao (o stream do modo print NAO mostra a
 * expansao de um comando pedido por stdin: so a transcricao mostra). `legivel`: ha ao menos um evento
 * JSON; sem isso o arquivo nao serve de prova de nada, nem da ausencia.
 */
function lerTranscricao(linhas) {
  const eventos = eventosDe(linhas);
  let cavemanExpandido = false;
  eventos.forEach(function (ev) {
    if (ev.type !== 'user') return;
    textosDoUsuario(ev).forEach(function (t) { if (COMANDO_CAVEMAN_EXPANDIDO.test(t)) cavemanExpandido = true; });
  });
  return { legivel: eventos.length > 0, cavemanExpandido: cavemanExpandido };
}

function cavemanNaTranscricao(linhas) {
  return lerTranscricao(linhas).cavemanExpandido;
}

/** O session_id do stream (o 1o evento que o traz): com ele se acha a transcricao. */
function sessionIdDe(linhas) {
  const achado = eventosDe(linhas).filter(function (ev) { return typeof ev.session_id === 'string' && ev.session_id !== ''; })[0];
  return achado ? achado.session_id : null;
}

// ── a leitura de UMA execucao ────────────────────────────────────────────

function eventosDe(linhas) {
  const lista = typeof linhas === 'string' ? linhas.split(/\r?\n/) : (Array.isArray(linhas) ? linhas : []);
  const eventos = [];
  lista.forEach(function (l) {
    if (typeof l !== 'string' || l.trim() === '') return;
    try {
      const o = JSON.parse(l);
      if (o && typeof o === 'object') eventos.push(o);
    } catch (e) { /* linha que nao e JSON: ignorada */ }
  });
  return eventos;
}

function blocosDe(ev) {
  const c = ev && ev.message && ev.message.content;
  return Array.isArray(c) ? c : [];
}

const SKILL_CAVEMAN = /(?:^|:)caveman$/i;

/**
 * Le as linhas do stream (`claude -p --output-format stream-json --verbose`) de UMA execucao.
 * Devolve `{ ok, texto, aplicou, outputTokens, motivos }`.
 *
 * `aplicou` exige, todos:
 *   - a abertura do sworn exatamente uma vez (cabecalho em UM hook_response de SessionStart): prova
 *     que o plugin carregou, e uma vez so. Sem isto a ausencia do bloco no padrao nao provaria nada;
 *   - o bloco presente SO no recurso;
 *   - o caveman ligado SO no caveman (a prova e a transcricao da sessao ou o resultado da skill);
 *   - todo hook_response de SessionStart com exit_code 0.
 * O `hook_progress` repete o stdout parcial: nao se conta. Os tokens saem so do `result`: o `usage`
 * dos eventos `assistant` e retrato parcial do streaming. O caveman pedido por stdin nao deixa nada no
 * stream: a prova e a transcricao da sessao (`opcoes.transcricao`, as linhas dela), ou, se houver, o
 * resultado de sucesso da skill no stream. Texto visivel = blocos `text` de `assistant`
 * sem pai; o de subagente o usuario nao ve, e o `result.result` perde as atualizacoes entre ferramentas.
 */
function lerExecucao(linhas, opcoes) {
  const o = opcoes || {};
  const condicao = o.condicao;
  const marcador = typeof o.marcador === 'string' && o.marcador ? o.marcador : MARCADOR_DO_BLOCO;
  const eventos = eventosDe(linhas);
  const motivos = [];

  // a abertura, o bloco e a saida dos hooks de SessionStart
  let aberturas = 0;
  let comBloco = 0;
  const falhas = [];
  eventos.forEach(function (ev) {
    if (ev.type !== 'system' || ev.subtype !== 'hook_response' || ev.hook_event !== 'SessionStart') return;
    const saida = typeof ev.stdout === 'string' ? ev.stdout : '';
    if (CABECALHO_DA_ABERTURA.test(saida)) aberturas++;
    if (saida.indexOf(marcador) !== -1) comBloco++;
    if (ev.exit_code !== 0) falhas.push(String(ev.hook_name || 'sem nome') + ' exit_code ' + String(ev.exit_code));
  });

  // o caveman: acionado (a skill foi pedida) e ligado (a skill respondeu com sucesso)
  const transcricao = lerTranscricao(o.transcricao);
  let cavemanPedido = transcricao.cavemanExpandido;
  let cavemanLigou = transcricao.cavemanExpandido;
  eventos.forEach(function (ev) {
    blocosDe(ev).forEach(function (b) {
      if (b && b.type === 'tool_use' && b.name === 'Skill' && b.input && /caveman/i.test(String(b.input.skill))) {
        cavemanPedido = true;
      }
    });
    const r = ev.tool_use_result;
    if (ev.type === 'user' && r && typeof r === 'object' && /caveman/i.test(String(r.commandName))) {
      cavemanPedido = true;
      if (r.success === true && SKILL_CAVEMAN.test(String(r.commandName))) cavemanLigou = true;
    }
  });

  if (aberturas === 0) {
    motivos.push('a abertura do sworn nao apareceu nos hooks de SessionStart: o gancho de abertura nao rodou. ' +
      'Confira se o plugin foi carregado na sessao medida (a medicao o carrega com --plugin-dir) e se o node esta no PATH.');
  } else if (aberturas > 1) {
    motivos.push('a abertura do sworn apareceu ' + aberturas + ' vezes nos hooks de SessionStart: o plugin foi carregado duas vezes ' +
      '(por exemplo a copia local, de --plugin-dir, mais a instalada pelo marketplace). Desligue uma das duas e rode de novo.');
  }
  if (falhas.length > 0) motivos.push('hook de SessionStart falhou: ' + falhas.join('; '));
  const querBloco = condicao === 'recurso';
  if (querBloco && comBloco === 0) motivos.push('o bloco de qualidade nao chegou a sessao do recurso: sem ele a ' +
    'condicao recurso mede o mesmo que o padrao. Confira o .claude/sworn/projeto.json da pasta medida: a condicao ' +
    'recurso nao pode ter "qualidadeDeResposta": false. Rode de novo.');
  if (!querBloco && comBloco > 0) motivos.push('o bloco de qualidade apareceu na condicao ' + condicao +
    ': ela tem de rodar sem o bloco. Confira o .claude/sworn/projeto.json da pasta medida: a condicao ' + condicao +
    ' precisa de "qualidadeDeResposta": false.');
  if (condicao === 'caveman') {
    if (!cavemanLigou) {
      // A6 (s220, R1 :388/:389): como os motivos da abertura (:373/:377), diz o passo.
      motivos.push((transcricao.legivel
        ? 'o caveman nao ligou na condicao caveman (a transcricao nao mostra o comando e o stream nao mostra a skill)'
        : 'o caveman nao ligou na condicao caveman: transcricao da sessao nao achada, e o stream nao mostra a skill') +
        '. Confira se o plugin caveman esta instalado e ligado no claude que a medicao chama (o de SWORN_CLAUDE, ou o ' +
        'do PATH), e rode de novo.');
    }
  } else if (cavemanPedido) {
    // A6-29: como o motivo do bloco que vazou (:386-388), diz o passo.
    motivos.push('o caveman foi acionado na condicao ' + condicao + ': ela tem de rodar sem o caveman. Confira se o ' +
      'plugin caveman liga sozinho no claude que a medicao chama (o de SWORN_CLAUDE, ou o do PATH) e rode de novo.');
  }
  const aplicou = motivos.length === 0;

  // o texto que o usuario veria
  const partes = [];
  const vistos = Object.create(null);
  eventos.forEach(function (ev) {
    if (ev.type !== 'assistant' || (ev.parent_tool_use_id !== null && ev.parent_tool_use_id !== undefined)) return;
    const id = ev.message && ev.message.id;
    blocosDe(ev).forEach(function (b) {
      if (!b || b.type !== 'text' || typeof b.text !== 'string' || b.text.trim() === '') return;
      const chave = id ? id + '|' + b.text : null;
      if (chave && vistos[chave]) return;
      if (chave) vistos[chave] = true;
      partes.push(b.text.trim());
    });
  });
  const texto = partes.join('\n\n');

  // o fim da execucao: so o `result` fala por ela
  let resultado = null;
  eventos.forEach(function (ev) { if (ev.type === 'result') resultado = ev; });
  let outputTokens = null;
  let ok = true;
  if (!resultado) {
    ok = false;
    motivos.push('o stream nao tem o evento result: a execucao parou antes do fim; o .stderr.txt desta geracao na ' +
      'rodada, quando existe, diz por que. Rode de novo.');
  } else {
    if (resultado.is_error === true || resultado.subtype !== 'success') {
      ok = false;
      // A6-28: sem o jargao "subtype"; a marca de fim e do claude, entre aspas (molde D736), e o passo e o do :428.
      const marca = resultado.subtype;
      const fim = marca === 'success' ? 'o claude marcou o fim como erro'
        : marca !== undefined && marca !== null && marca !== ''
          ? 'o claude fechou com ' + entreAspas(marca) + ', e nao com "success"'
          : 'o claude fechou sem a marca "success"';
      motivos.push('a execucao terminou com erro (' + fim + '); o .stderr.txt desta geracao na rodada, ' +
        'quando existe, diz por que. Rode de novo.');
    }
    const usage = resultado.usage;
    const bruto = usage && typeof usage === 'object' ? usage.output_tokens : undefined;
    if (bruto !== undefined && bruto !== null) outputTokens = bruto;
    if (!tokensValidos(bruto)) {
      ok = false;
      // A6-30: diz o que e o output_tokens e o passo.
      motivos.push('o evento result nao traz a contagem de tokens da resposta (o campo output_tokens), ou ela ' +
        'nao e um numero de 0 para cima: sem ela o gasto desta geracao nao se mede. Rode de novo; se repetir, ' +
        'confira a versao do claude que a medicao chama (o de SWORN_CLAUDE, ou o do PATH).');
    }
  }
  if (texto === '') {
    ok = false;
    motivos.push('a execucao nao deixou texto que o usuario veria (so ferramenta, subagente ou pensamento): sem ele ' +
      'nao ha o que julgar. Rode de novo.');
  }

  return { ok: ok, texto: texto, aplicou: aplicou, outputTokens: outputTokens, motivos: motivos };
}

module.exports = {
  ACAO_DE_JULGAR, CONDICOES, RIVAIS, ORDENS, LENTE, COMANDO_CAVEMAN, MARCADOR_DO_BLOCO,
  perguntaDaCondicao, votoDoJuiz, resultadoDoPar, nomeDoPar, apurar, lerExecucao,
  lerTranscricao, cavemanNaTranscricao, sessionIdDe, eventosDe, blocosDe
};
