'use strict';
// R2b: a conferencia da tela contra a referencia, largura por largura. Sem nota de parecenca (a do original, o
// craft-anything, e generosa com o layout: website.rs:704): a lista do que difere e do que nao se comparou. O que falta
// de um lado nunca conta como igual ("Missing evidence never counts as alike", workspace.rs:271). As medidas sao as do
// `layout` que a captura grava no evidencia.json (captura.resumirLayout).

const design = require('./design.js');
const captura = require('./captura.js');

// As larguras do original (engine/src/settings.rs:164): a tela larga, o tablet e o celular.
const LARGURAS = [1440, 768, 390];
// A folga de cada medida, em px, a do original (website.rs:554-663): o tipo difere alem de 2 px, a coluna alem de 8.
const FOLGA_DO_TIPO = 2;
const FOLGA_DA_COLUNA = 8;
const TIPOS = ['h1', 'h2', 'corpo'];

// Por que um lado nao entra na comparacao, ou null quando a medicao dele tem a forma inteira.
function motivoDoLado(nome, m) {
  if (!m) return nome + ' nao foi medida';
  if (m.erro) return nome + ': ' + m.erro;
  if (m.semCorpo) return nome + ': a pagina nao e um documento HTML com corpo';
  if (m.ilegivel || !m.tipos || !Array.isArray(m.blocos)) {
    return nome + ': a leitura do layout voltou sem a forma esperada (faltou o tipo ou os blocos): capture de novo; se ' +
      'repetir, confira o layout na foto';
  }
  return null;
}

// O tamanho do sistema de design mais perto do valor da referencia: { valor (como o design.json escreve), px, igual },
// ou null sem `tamanhos` que virem px. No empate, o primeiro declarado.
function tokenDoTamanho(px, sistema) {
  let melhor = null;
  for (const v of [].concat((sistema && sistema.tamanhos) || [])) {
    const p = design.medidaEmPx(v);
    if (p === null) continue;
    if (!melhor || Math.abs(p - px) < Math.abs(melhor.px - px)) melhor = { valor: v, px: p, igual: p === px };
  }
  return melhor;
}

// Uma largura: { largura, comparada, diferencas, naoComparado }. Cada diferenca e { medida, tela, referencia } (com
// `tag` e `ordem` nos blocos, e `token` no tipo, com o design.json); cada nao comparado, o motivo em uma frase.
function compararLargura(largura, tela, referencia, sistema) {
  const diferencas = [];
  const naoComparado = [];
  const motivos = [motivoDoLado('a tela', tela), motivoDoLado('a referencia', referencia)].filter(Boolean);
  if (motivos.length) return { largura, comparada: false, diferencas, naoComparado: motivos };
  if (tela.rolagemLateral !== referencia.rolagemLateral) {
    diferencas.push({ medida: 'rolagem lateral', tela: tela.rolagemLateral, referencia: referencia.rolagemLateral });
  }
  // Uma medida que pode faltar de um lado: a que falta so e diferenca se aquele lado leu tudo; com a leitura cortada,
  // pode so nao ter chegado nela.
  const medir = function (medida, a, b, folga, extra) {
    if (a === null && b === null) return;
    if (a === null || b === null) {
      const cortou = a === null ? (tela.cortado && 'da tela') : (referencia.cortado && 'da referencia');
      if (cortou) {
        naoComparado.push(medida + ': a leitura ' + cortou + ' parou antes de achar essa medida (a pagina passou do teto de ' +
          'elementos lidos): confira na foto');
        return;
      }
    } else if (Math.abs(a - b) <= folga) {
      return;
    }
    diferencas.push(Object.assign({ medida, tela: a, referencia: b }, extra && extra(b)));
  };
  for (const t of TIPOS) {
    medir(t, tela.tipos[t], referencia.tipos[t], FOLGA_DO_TIPO, function (b) {
      const token = b === null ? null : tokenDoTamanho(b, sistema);
      return token ? { token } : null;
    });
  }
  medir('coluna', tela.coluna, referencia.coluna, FOLGA_DA_COLUNA);
  // Os blocos se pareiam pela tag, na ordem da pagina (o original pareia tambem pelo titulo, que o sworn nao guarda: o
  // texto da pagina nao vai para o disco). Com a leitura cortada de um lado, a lista dele pode estar incompleta.
  const cortados = [['da tela', tela], ['da referencia', referencia]].filter(function (x) { return x[1].cortado; });
  if (cortados.length) {
    for (const c of cortados) naoComparado.push('blocos: a leitura ' + c[0] + ' parou antes do fim (a pagina passou do teto de elementos lidos): ' +
      'confira na foto');
  } else {
    const tags = [];
    for (const b of referencia.blocos.concat(tela.blocos)) if (tags.indexOf(b.tag) === -1) tags.push(b.tag);
    for (const tag of tags) {
      const daTag = function (lista) { return lista.filter(function (b) { return b.tag === tag; }); };
      const a = daTag(tela.blocos);
      const b = daTag(referencia.blocos);
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        if (a[i].porLinha !== b[i].porLinha) {
          diferencas.push({ medida: 'blocos lado a lado', tag, ordem: i + 1, tela: a[i].porLinha, referencia: b[i].porLinha });
        }
      }
      if (a.length !== b.length) diferencas.push({ medida: 'quantos blocos', tag, tela: a.length, referencia: b.length });
    }
  }
  return { largura, comparada: naoComparado.length === 0, diferencas, naoComparado };
}

// As medicoes de cada largura ([{ largura, tela, referencia }]) -> { larguras, diferencas, naoComparado,
// tudoComparado }. Sem nenhuma largura medida, nada foi comparado.
function conferir(medicoes, sistema) {
  const larguras = medicoes.map(function (m) { return compararLargura(m.largura, m.tela, m.referencia, sistema); });
  const soma = function (campo) { return larguras.reduce(function (n, l) { return n + l[campo].length; }, 0); };
  const naoComparado = soma('naoComparado');
  return { larguras, diferencas: soma('diferencas'), naoComparado, tudoComparado: larguras.length > 0 && naoComparado === 0 };
}

const USO = 'uso: node scripts/conferir-tela.js --url <a tela> --referencia <a tela de referencia> --saida <pasta> ' +
  '[--larguras 1440,768,390] [--tempo-max 30000]';
// Quantas larguras uma chamada aceita: cada uma abre o navegador duas vezes (a tela e a referencia).
const LARGURAS_NA_CHAMADA = 6;
const NOMES = { '--url': 'url', '--referencia': 'referencia', '--saida': 'saida', '--larguras': 'larguras',
  '--tempo-max': 'tempoMax' };

// Le os argumentos. Devolve { erro } com o que consertar na chamada, ou { opcoes }. Os enderecos passam pela mesma
// regra da captura (http, https ou file), com a mensagem dela, que mostra o endereco limpo de segredo.
function lerArgs(argv) {
  const opcoes = { url: null, referencia: null, saida: null, larguras: LARGURAS.slice(), tempoMax: captura.PADRAO.tempoMax };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const chave = Object.hasOwn(NOMES, flag) ? NOMES[flag] : null;
    if (!chave) return { erro: 'argumento desconhecido "' + captura.semSegredo(String(flag)) + '". ' + USO };
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) return { erro: flag + ' veio sem valor. ' + USO };
    if (chave === 'larguras') {
      const partes = v.split(',').map(function (p) { return p.trim(); });
      const numeros = partes.map(Number);
      const valida = partes.length <= LARGURAS_NA_CHAMADA && partes.every(function (p, j) {
        return /^\d+$/.test(p) && numeros[j] >= 1 && numeros[j] <= captura.TETO_DA_LARGURA && numeros.indexOf(numeros[j]) === j;
      });
      if (!valida) {
        return { erro: '--larguras precisa ser uma lista de 1 a ' + LARGURAS_NA_CHAMADA + ' larguras em px, de 1 a ' +
          captura.TETO_DA_LARGURA + ', sem repetir, separadas por virgula (exemplo: 1440,768,390), e veio "' +
          captura.semSegredo(v) + '"' };
      }
      opcoes.larguras = numeros;
    } else if (chave === 'tempoMax') {
      if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > captura.TETO_DO_TEMPO) {
        return { erro: '--tempo-max precisa ser um inteiro de 1 a ' + captura.TETO_DO_TEMPO + ' ms, por captura, e veio "' +
          captura.semSegredo(v) + '"' };
      }
      opcoes.tempoMax = Number(v);
    } else {
      opcoes[chave] = v;
    }
  }
  if (!opcoes.url) return { erro: 'falta --url (a tela a conferir). ' + USO };
  if (!opcoes.referencia) return { erro: 'falta --referencia (a tela de referencia). ' + USO };
  if (!opcoes.saida) return { erro: 'falta --saida (a pasta onde gravar as capturas e a conferencia). ' + USO };
  for (const flag of ['--url', '--referencia']) {
    const c = captura.lerArgs(['--url', opcoes[NOMES[flag]], '--saida', opcoes.saida]);
    if (c.erro) return { erro: c.erro.replace(/^--url/, flag) };
  }
  return { opcoes };
}

// O aviso da saida: o que fazer com o que nao se comparou (barra o "pronto") e com o que difere. Cada item de
// naoComparado e um motivo: uma largura inteira que nao se mediu, ou uma medida que a leitura cortada nao alcancou.
function avisoDaConferencia(r) {
  const avisos = [];
  if (!r.larguras || !r.larguras.length) {
    avisos.push('nenhuma largura foi medida: passe ao menos uma em --larguras');
  } else if (r.naoComparado) {
    avisos.push(r.naoComparado + ' motivo(s) do que ficou sem comparar, listados em naoComparado de cada largura do ' +
      'conferencia.json: a tela nao fica pronta com o que nao se comparou; resolva o motivo (a pagina que nao abriu) e ' +
      'rode de novo, ou, quando ele nao se resolve (a leitura de uma pagina grande que parou no teto), confira na foto ' +
      'o que ficou de fora e diga ao dono o que segue sem comparar');
  }
  if (r.diferencas) {
    avisos.push(r.diferencas + ' diferenca(s) com a referencia, listadas em diferencas de cada largura: ajuste a tela, ou ' +
      'diga ao dono por que cada uma e de proposito');
  }
  return avisos.join('; ');
}

module.exports = { LARGURAS, FOLGA_DO_TIPO, FOLGA_DA_COLUNA, USO, compararLargura, conferir, tokenDoTamanho, lerArgs,
  avisoDaConferencia };
