'use strict';

/**
 * B7 - "Quando o teste me atrapalha, eu tenho vontade de mexer no medidor."
 *
 * A autoavaliacao nomeou esta falha e exigiu o mecanismo: "detectar teste+baseline
 * no mesmo diff do codigo; subir baseline e decisao humana". O desenho da v1 §12
 * adiou o item, marcando-o como "primeiro candidato a entrar se sobrar folego".
 * Ficou 25 dias sem entrar. Entra aqui.
 *
 * O QUE ESTE MODULO NAO FAZ, e por que: nao acusa "teste e codigo mudaram no mesmo
 * turno". TDD faz exatamente isso, sempre, e um portao que nega TDD seria negado
 * de volta no primeiro dia. O sinal verdadeiro nao e tocar nos dois - e AFROUXAR
 * a regua. E isso que se detecta: o numero da catraca andando para o lado que
 * deixa passar mais.
 *
 * As duas familias, porque a direcao do afrouxamento e oposta:
 *   TETO  (teto, limite, maximo, tolerancia...)  afrouxa quando SOBE
 *   PISO  (minimo, piso, cobertura, exigido...)  afrouxa quando DESCE
 */

const TETO = ['teto', 'limite', 'limiar', 'baseline', 'threshold', 'maximo', 'max', 'tolerancia', 'maxwarnings', 'maxerrors'];
const PISO = ['minimo', 'min', 'piso', 'cobertura', 'coverage', 'exigido', 'aprovacao'];

/** Tira acento para o padrao pegar "máximo" e "maximo" do mesmo jeito. */
function semAcento(t) {
  return String(t == null ? '' : t)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// (PT-02 = item 2 da triagem do lote 2, D422 em docs/decisoes.md.)
// `max` e `min` sao palavras de uso geral, nao de medidor. O mesmo texto que era regua
// (`max: 10`, `--max-warnings 0`, `max-lines: 300`) tambem e CSS (`max-width: 600px`) e variavel de
// codigo (`const max = 10`), e o portao negava a edicao honesta. Para elas, e preciso que a linha
// pareca regua; as demais palavras (teto, limite, baseline...) ja dizem o que sao.
const GENERICAS = ['max', 'min'];
// S4: casa o sufixo INTEIRO (`max-width-budget` e regua) e aceita `_` como separador (`max_width`).
const PROPRIEDADE_CSS = /^[-_]?(?:width|height|inline[-_]?size|block[-_]?size)$/; // max-width, maxwidth, max_width
const DECLARACAO = /(?:^|[^\w$.])(?:const|let|var|int|long|short|float|double|final|val|static|auto)\s+$/;

const DECLARACAO_ACHA = new RegExp(DECLARACAO.source.slice(0, -1), 'g'); // a mesma, sem o `$`: acha a ULTIMA palavra de declaracao

/**
 * D429/3 (L2-cat-5): o 2o declarador da linha (`const a = 1, max = 10`) tem a regra do 1o.
 * Uma passada pela linha devolve o conjunto de posicoes de virgula que ABREM declarador: a virgula
 * esta no nivel zero desde a ultima palavra de declaracao (nenhum ([{ aberto, nenhum `;`, nenhuma
 * string aberta). Virgula de chamada, objeto ou array (`f(1, max = 10)`) fica de fora.
 */
function virgulasDeDeclaracao(linha) {
  const virgulas = new Set();
  const fins = new Set();
  let k;
  DECLARACAO_ACHA.lastIndex = 0;
  while ((k = DECLARACAO_ACHA.exec(linha)) !== null) fins.add(DECLARACAO_ACHA.lastIndex);
  let dentro = false; // ja passou por uma palavra de declaracao
  let quebrada = false; // nivel negativo ou `;` no nivel zero desde ela
  let nivel = 0;
  let aspas = '';
  for (let i = 0; i < linha.length; i++) {
    if (fins.has(i) && !aspas) { dentro = true; quebrada = false; nivel = 0; }
    const c = linha[i];
    if (aspas) {
      if (c === '\\') i++;
      else if (c === aspas) aspas = '';
    } else if (c === '"' || c === "'" || c === '`') aspas = c;
    else if (c === '(' || c === '[' || c === '{') nivel++;
    else if (c === ')' || c === ']' || c === '}') { if (--nivel < 0) quebrada = true; }
    else if (c === ';' && nivel === 0) quebrada = true;
    else if (c === ',' && dentro && !quebrada && nivel === 0) virgulas.add(i);
  }
  return virgulas;
}

/** A palavra comeca em `indice` logo depois de uma virgula de declaracao (espacos no meio nao contam)? */
function declaradorSeguinte(linha, indice, cache) {
  let i = indice;
  while (i > 0 && /\s/.test(linha[i - 1])) i--;
  if (i === 0 || linha[i - 1] !== ',') return false;
  if (!cache.virgulas) cache.virgulas = virgulasDeDeclaracao(linha);
  return cache.virgulas.has(i - 1);
}

/**
 * Devolve true quando a ocorrencia NAO e regua (o nome e negativo de proposito: true = pode ignorar).
 * `m` = o casamento de `pares` (m[1] = o sufixo da palavra, m[2] = o numero). Os indices m[1] e m[2]
 * vem do regex montado em `pares`: se aquele regex mudar de formato, esta funcao tem de mudar junto.
 * Unidade (`min: 80%`, `max: 300ms`) NAO isenta: e piso/teto real. A medida de CSS sai pelo sufixo.
 * A declaracao so isenta o identificador PURO minusculo (`const max = 10`); `const MAX_WARNINGS = 0`
 * e a constante em CAIXA ALTA (MAX, MIN - lida na linha ORIGINAL) seguem regua.
 */
function naoEhRegua(linha, m, orig, palavra, cache) {
  if (PROPRIEDADE_CSS.test(m[1])) return true;            // max-width, maxWidth, min-height...
  const antes = linha.slice(0, m.index);
  if (m[1] !== '' || !(DECLARACAO.test(antes) || declaradorSeguinte(linha, m.index, cache))) return false;
  const lido = orig.slice(m.index, m.index + palavra.length); // a linha original, antes do lowercase
  return lido !== palavra.toUpperCase(); // minusculo puro isento; MAX/MIN em caixa alta e constante = regua
}

/**
 * Acha pares "<palavra de catraca> <numero>" - com ate 12 caracteres de
 * separador entre os dois, o que cobre `teto: 200`, `"teto" = 200`,
 * `tetoDeInstrucoes: 200` e `--max-warnings 0`, sem atravessar a linha.
 */
function pares(texto) {
  const achados = Object.create(null);
  const originais = semAcento(texto).split(/\r?\n/);
  const linhas = originais.map(function (l) { return l.toLowerCase(); });
  // Da mais longa para a mais curta: "maximo" reivindica a posicao antes de
  // "max", e a mesma ocorrencia nao e contada duas vezes com nomes diferentes.
  const todas = TETO.concat(PISO).slice().sort(function (a, b) { return b.length - a.length; });
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    const orig = originais[i].length === linha.length ? originais[i] : linha; // lowercase que muda o tamanho: sem a caixa
    const tomadas = [];
    const cache = {}; // por linha: as virgulas de declaracao, calculadas so se algum max/min precisar
    for (const palavra of todas) {
      // A borda inicial e o que separa "max" de "climax". Sem ela qualquer palavra que
      // CONTENHA uma palavra de catraca vira catraca, e o portao passa a negar
      // edicao honesta - que e o jeito mais rapido de um portao ser desligado.
      // Nao e \b porque \b falha depois de `_` (`ESLINT_MAX_WARNINGS`): letra/digito antes
      // segue barrando, `_` antes deixa passar. O grupo opcional e a anotacao de tipo do TS
      // (`maxWarnings: number = 0`), so quando o tipo vem seguido de `=`.
      // Aviso: `max` e `min` casam em QUALQUER uso (CSS, variavel de codigo) e geram falso positivo;
      // por isso `naoEhRegua` (abaixo, no laco) descarta esses casos so para as palavras GENERICAS.
      const re = new RegExp('(?<![a-z0-9])' + palavra + '([a-z_-]*)(?::\\s*[a-z_$.]+(?=\\s*=))?["\'\\s:=>_-]{0,12}?(-?(?:infinity|\\d[\\d_]*(?:\\.\\d+)?(?:e\\+?\\d+)?))', 'g');
      let m;
      while ((m = re.exec(linha)) !== null) {
        // A2-02: `2_000`, `1e3` e `Infinity` eram lidos so pelo 1o digito (2, 1) ou nem lidos.
        const valor = /infinity$/.test(m[2]) ? (m[2][0] === '-' ? -Infinity : Infinity) : Number(m[2].replace(/_/g, ''));
        if (isNaN(valor)) continue;
        if (GENERICAS.indexOf(palavra) !== -1 && naoEhRegua(linha, m, orig, palavra, cache)) continue;
        // Sobreposicao, nao so o mesmo inicio: com `_` aceito antes da palavra, `min_coverage = 80`
        // casa "coverage" e "min" no mesmo trecho - e e um numero so, nao dois.
        const ini = m.index;
        const fim = m.index + m[0].length;
        if (tomadas.some(function (t) { return ini < t[1] && t[0] < fim; })) continue;
        tomadas.push([ini, fim]);
        if (!achados[palavra]) achados[palavra] = [];
        achados[palavra].push(valor);
      }
    }
  }
  return achados;
}

function familia(palavra) {
  return TETO.indexOf(palavra) !== -1 ? 'teto' : 'piso';
}

/**
 * Compara o antes e o depois de uma edicao. Devolve os afrouxamentos.
 *
 * Conservador de proposito: so acusa quando a MESMA palavra de catraca aparece
 * nos dois lados e o numero andou para o lado que deixa passar mais. Palavra que
 * so existe depois e criacao, nao afrouxamento - e criar catraca nova e o
 * contrario do que esta falha descreve.
 */
function afrouxou(antes, depois) {
  const a = pares(antes);
  const d = pares(depois);
  const achados = [];
  for (const palavra of Object.keys(d)) {
    if (!a[palavra]) continue;
    const fam = familia(palavra);
    // O extremo de cada lado e o que manda: subir o maior teto e afrouxar,
    // mesmo que outro teto na mesma edicao tenha descido.
    const antesV = fam === 'teto' ? Math.max.apply(null, a[palavra]) : Math.min.apply(null, a[palavra]);
    const depoisV = fam === 'teto' ? Math.max.apply(null, d[palavra]) : Math.min.apply(null, d[palavra]);
    if (fam === 'teto' ? depoisV > antesV : depoisV < antesV) {
      achados.push({ palavra: palavra, familia: fam, de: antesV, para: depoisV });
    }
  }
  return achados;
}

function motivo(alvo, achados) {
  const linhas = [
    'sworn: NEGADO - isto sobe a catraca (o limite fixo que segura um indicador), e subir catraca e decisao humana.',
    '',
    'Arquivo: ' + alvo
  ];
  for (const a of achados) {
    linhas.push('  ' + a.palavra + ': ' + a.de + ' -> ' + a.para +
      (a.familia === 'teto' ? '  (o teto, o maximo permitido, subiu: agora aceita mais que antes)' : '  (o piso, o minimo exigido, desceu: agora exige menos que antes)'));
  }
  linhas.push('');
  linhas.push('Por que barra: quando um teste ou checagem atrapalha, e tentador afrouxar o numero que o mede.');
  linhas.push('O que fazer: desfaca a mudanca deste numero (volte ao numero da esquerda do "->" acima) e corrija a causa da falha.');
  linhas.push('Se o numero estiver mesmo errado, peca ao dono a decisao e registre-a antes de mexer nele:');
  linhas.push('subir catraca no meio de uma correcao nao e permitido.');
  return linhas.join('\n');
}

module.exports = { TETO, PISO, semAcento, pares, familia, afrouxou, motivo };
