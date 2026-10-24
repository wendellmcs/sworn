'use strict';
const fs = require('node:fs');
const path = require('node:path');

/**
 * H6: comportamento em Windows, Linux e macOS.
 *
 * Nao ha maquina Linux nem macOS aqui, e nao ha CI. Prometer "funciona nos tres"
 * seria a classe de promessa que este plugin existe para impedir. O que da para
 * fazer, e o que a spec pede, e DECLARAR o que nao foi testado - com a lista
 * derivada do codigo, nunca escrita a mao.
 *
 * DUAS CLASSES, e a diferenca entre elas e a unica coisa que interessa:
 *
 *   injetavel      - a plataforma entra por PARAMETRO, entao o comportamento dos
 *                    tres sistemas se exercita de qualquer maquina. Nao e
 *                    simulacao: `shell.conferir(cmd, {so:'win32'})` roda o mesmo
 *                    caminho que rodaria la.
 *   so_no_sistema  - depende da pergunta que o Node faz ao sistema, ou do sistema de arquivos de
 *                    verdade. So se prova rodando naquele sistema. Fora dele, a
 *                    linha diz NAO TESTADO, e dizer isso e a entrega.
 *
 * POR QUE A LISTA E DERIVADA. "Lista escrita a mao envelhece calada" foi o
 * defeito 4 da D134, e quem o achou foi um teste que comparava - nao uma leitura.
 * Aqui o varredor acha as ocorrencias no disco e a matriz tem de cobrir todas:
 * ocorrencia sem ponto declarado e ORFA, e ponto que nao acha mais nada e MORTO.
 * As duas reprovam. Um ponto cego novo nao entra em silencio, e um ponto que
 * deixou de existir nao fica fingindo cobertura.
 */

/**
 * Marcadores de dependencia de plataforma. Marcador sem ocorrencia e legitimo:
 * e arame esticado para codigo que ainda nao existe.
 *
 * OS PADROES SAO MONTADOS POR CONCATENACAO, e a razao foi medida: na primeira
 * rodada do ensaio este modulo ACUSOU A SI MESMO em tres linhas - duas eram as
 * proprias definicoes de marcador escritas por extenso, e a terceira era uma
 * frase de prosa citando a chamada que ele cacava. Nenhuma das tres era
 * dependencia de plataforma. Calar isso com uma excecao para o proprio varredor
 * seria abrir o buraco exato por onde um ponto cego de verdade passaria - e e a
 * mesma regra que `sanitacao.js` ja aplica as iscas dele.
 *
 * Consequencia dura para quem editar este arquivo: **nao escrever aqui, nem em
 * comentario, o texto que um marcador caca.** Se precisar citar, quebre em
 * pedacos como abaixo.
 */
const MARCADORES = [
  {
    chave: 'process_platform',
    re: new RegExp('process' + '\\.platform'),
    oQue: 'o codigo pergunta em que sistema esta rodando'
  },
  {
    chave: 'pasta_temporaria',
    re: new RegExp('os' + '\\.tmpdir\\s*\\('),
    oQue: 'pasta temporaria do sistema, que tem caminho diferente nos tres'
  },
  {
    chave: 'pasta_pessoal',
    re: new RegExp('os' + '\\.homedir\\s*\\('),
    oQue: 'pasta pessoal do usuario'
  },
  {
    chave: 'fim_de_linha',
    re: new RegExp('os' + '\\.EOL'),
    oQue: 'fim de linha do sistema: CRLF no Windows, LF nos outros'
  },
  {
    chave: 'caminho_especifico',
    re: new RegExp('path' + '\\.(?:sep|win32|posix|delimiter)'),
    oQue: 'separador ou dialeto de caminho pedido explicitamente'
  },
  {
    chave: 'processo_externo',
    re: new RegExp('windows' + 'Hide'),
    oQue: 'processo externo: a resolucao do executavel no PATH muda por sistema'
  },
  {
    chave: 'tabela_de_plataforma',
    re: new RegExp('shell' + '-win32'),
    oQue: 'a tabela de idioma de shell, carregada pela plataforma declarada'
  },
  {
    chave: 'barra_invertida',
    re: new RegExp('replace\\(/' + '\\\\\\\\/g'),
    oQue: 'normalizacao de barra invertida para barra normal'
  }
];

const INJETAVEL = 'injetavel';
const SO_NO_SISTEMA = 'so_no_sistema';

/**
 * A matriz. `arquivos` e conferida contra o disco a cada rodada - e por isso que
 * acrescentar modulo novo que mexa com plataforma reprova a suite ate a linha
 * entrar aqui. O custo e uma linha; o silencio custaria um ponto cego.
 */
const PONTOS = [
  {
    chave: 'process_platform',
    classe: SO_NO_SISTEMA,
    titulo: 'Deducao do sistema e do idioma de shell',
    arquivos: ['scripts/autorizar-paralelo.js', 'scripts/lib/glob.js', 'scripts/lib/marcha.js', 'scripts/lib/plataforma.js',
               'scripts/lib/projeto.js', 'scripts/lib/varredura.js', 'scripts/medir-qualidade.js'],
    comoSeProva: 'rodando a suite naquele sistema: quem responde e o proprio Node',
    ressalva: 'a CONSEQUENCIA da deducao e injetavel e esta exercitada - ver tabela_de_plataforma ' +
              'e barra_invertida. O que nao se prova aqui e a deducao em si.'
  },
  {
    chave: 'tabela_de_plataforma',
    classe: INJETAVEL,
    titulo: 'Idioma de shell errado para a plataforma (trava 5)',
    arquivos: ['scripts/lib/shell.js'],
    comoSeProva: 'a plataforma entra por parametro em conferir(comando, plataforma): ' +
                 'o caminho win32 e o caminho nao-win32 rodam os dois daqui',
    ressalva: null
  },
  {
    chave: 'pasta_temporaria',
    classe: INJETAVEL,
    titulo: 'Onde o estado de sessao e gravado',
    arquivos: ['scripts/lib/estado.js'],
    comoSeProva: 'SWORN_TMP sobrepoe a pasta temporaria do sistema, e a suite inteira usa essa porta',
    ressalva: 'o caminho PADRAO, quando ninguem sobrepoe, e diferente nos tres sistemas ' +
              'e so se ve naquele sistema. O que se prova aqui e que a sobreposicao manda.'
  },
  {
    chave: 'pasta_pessoal',
    classe: INJETAVEL,
    titulo: 'Onde o claude grava a transcricao da sessao',
    arquivos: ['scripts/autorizar-paralelo.js', 'scripts/lib/calibracao.js', 'scripts/lib/gasto.js',
               'scripts/lib/injetado.js', 'scripts/lib/migracao.js', 'scripts/lib/vigia-local.js',
               'scripts/medir-qualidade.js'],
    comoSeProva: 'CLAUDE_CONFIG_DIR sobrepoe a pasta pessoal, e a pasta pessoal entra por parametro ' +
                 'em acharTranscricao: os dois caminhos rodam daqui. A pasta do vigia (Bloco V) idem: ' +
                 'SWORN_VIGIA a sobrepoe, e o teste roda por ela. O autorizar-paralelo (para de subir na ' +
                 'pasta pessoal) idem: o teste troca HOME e USERPROFILE. O calibrador idem: a pasta pessoal ' +
                 'entra por parametro em pastaDasTranscricoes, e o comando roda pelo CLAUDE_CONFIG_DIR. O gasto ' +
                 'do mes (pedido 31) idem: pastaDosProjetos recebe a pasta pessoal por parametro, e o sessao.js ' +
                 'roda no teste pelo CLAUDE_CONFIG_DIR. O injetado da auditoria (0.9.1) idem: a transcricao e o ' +
                 'cache de plugins saem do CLAUDE_CONFIG_DIR, e o teste roda por ele. A migracao da pasta antiga ' +
                 '(.claude/esquadro) idem: migrarCasa recebe a pasta pessoal por parametro, e o teste da abertura troca ' +
                 'HOME e USERPROFILE',
    ressalva: 'o nome da pasta de config padrao (.claude na pasta pessoal) so se confere naquele sistema ' +
              'com o claude de verdade; aqui se prova que a busca olha onde mandam.'
  },
  {
    chave: 'processo_externo',
    classe: SO_NO_SISTEMA,
    titulo: 'Chamada do git como processo, sem shell',
    arquivos: ['scripts/exportar.js', 'scripts/lib/git.js', 'scripts/lib/sanitacao.js',
               'scripts/medir-qualidade.js', 'scripts/medir-travas.js', 'scripts/preparar-revisao.js', 'scripts/vigia-puxar.js'],
    comoSeProva: 'rodando naquele sistema com git instalado',
    ressalva: 'com shell:false o Node nao consulta PATHEXT: um git empacotado como .cmd ou .bat ' +
              'nao seria achado no Windows. Aqui ele e .exe e e achado. Fora do Windows o ' +
              'problema nao existe, mas tambem nunca foi rodado la.'
  },
  {
    chave: 'caminho_especifico',
    classe: SO_NO_SISTEMA,
    titulo: 'Caminho relativo remontado pelo separador do sistema',
    arquivos: ['scripts/apurar-ronda.js', 'scripts/lib/cicatriz.js', 'scripts/medir-qualidade.js', 'scripts/medir-travas.js'],
    comoSeProva: 'rodando a suite naquele sistema: o separador e o do proprio Node',
    ressalva: 'no Windows a troca vira barra normal; fora dele e identidade. ' +
              'A suite so exercita o lado do Windows.'
  },
  {
    chave: 'barra_invertida',
    classe: INJETAVEL,
    titulo: 'Caminho do Windows normalizado para barra normal',
    arquivos: [
      'scripts/apurar-ronda.js', 'scripts/lib/busca.js', 'scripts/lib/git.js', 'scripts/lib/glob.js',
      'scripts/lib/injetado.js', 'scripts/lib/instrucoes.js', 'scripts/lib/molde.js', 'scripts/lib/plano.js', 'scripts/lib/plataforma.js',
      'scripts/lib/retomar.js', 'scripts/lib/sanitacao.js', 'scripts/lib/saude.js', 'scripts/preparar-revisao.js'
    ],
    comoSeProva: 'e trabalho de string puro: a entrada com barra invertida se passa de qualquer maquina',
    ressalva: 'no Linux e no macOS a barra invertida e caractere LEGAL em nome de arquivo, ' +
              'e esta normalizacao o corrompe. Limite declarado, nao defeito a consertar aqui.'
  }
];

function jsDe(dir, raiz, acc) {
  acc = acc || [];
  let entradas;
  try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return acc; }
  for (const e of entradas) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) jsDe(p, raiz, acc);
    else if (e.isFile() && e.name.endsWith('.js')) acc.push(path.relative(raiz, p).replace(/\\/g, '/'));
  }
  return acc;
}

/** Acha no disco toda ocorrencia de marcador, com arquivo e linha. */
function varrer(raiz) {
  const achados = [];
  jsDe(path.join(raiz, 'scripts'), raiz).forEach(function (rel) {
    let linhas;
    try { linhas = fs.readFileSync(path.join(raiz, rel), 'utf8').split(/\r?\n/); } catch (e) { return; }
    linhas.forEach(function (linha, i) {
      MARCADORES.forEach(function (m) {
        if (m.re.test(linha)) achados.push({ marcador: m.chave, arquivo: rel, linha: i + 1 });
      });
    });
  });
  return achados;
}

const SISTEMAS = ['win32', 'linux', 'darwin'];

/**
 * A matriz desta rodada. `so` entra por parametro de proposito: sem isso a
 * propria matriz so seria testavel no Windows, que e o defeito que ela existe
 * para denunciar nos outros.
 */
function matriz(raiz, so) {
  const sistema = so || process.platform;
  const achados = varrer(raiz);
  const declarados = Object.create(null);
  PONTOS.forEach(function (p) {
    p.arquivos.forEach(function (a) { declarados[p.chave + '|' + a] = true; });
  });

  const orfas = achados.filter(function (a) {
    return !declarados[a.marcador + '|' + a.arquivo];
  });

  const vivos = Object.create(null);
  achados.forEach(function (a) { vivos[a.marcador + '|' + a.arquivo] = true; });
  const mortos = [];
  PONTOS.forEach(function (p) {
    p.arquivos.forEach(function (a) {
      if (!vivos[p.chave + '|' + a]) mortos.push({ marcador: p.chave, arquivo: a });
    });
  });

  const linhas = PONTOS.map(function (p) {
    const porSistema = Object.create(null);
    SISTEMAS.forEach(function (s) {
      if (p.classe === INJETAVEL) porSistema[s] = 'exercitado por injecao';
      else porSistema[s] = (s === sistema) ? 'exercitado neste sistema' : 'NAO TESTADO';
    });
    return {
      chave: p.chave, titulo: p.titulo, classe: p.classe,
      arquivos: p.arquivos.slice(),
      ocorrencias: achados.filter(function (a) { return a.marcador === p.chave; }).length,
      comoSeProva: p.comoSeProva, ressalva: p.ressalva, porSistema: porSistema
    };
  });

  const naoTestados = [];
  SISTEMAS.forEach(function (s) {
    const n = linhas.filter(function (l) { return l.porSistema[s] === 'NAO TESTADO'; }).length;
    if (n > 0) naoTestados.push({ sistema: s, pontos: n });
  });

  return {
    sistemaDestaRodada: sistema,
    pontos: linhas,
    orfas: orfas,
    mortos: mortos,
    integra: orfas.length === 0 && mortos.length === 0,
    resumo: {
      pontos: linhas.length,
      injetaveis: linhas.filter(function (l) { return l.classe === INJETAVEL; }).length,
      soNoSistema: linhas.filter(function (l) { return l.classe === SO_NO_SISTEMA; }).length,
      ocorrencias: achados.length,
      naoTestados: naoTestados
    }
  };
}

function texto(m) {
  const linhas = [];
  linhas.push('Matriz de plataforma - esta rodada: ' + m.sistemaDestaRodada);
  linhas.push('');
  linhas.push(pad('ponto', 24) + pad('classe', 16) + pad('win32', 26) + pad('linux', 26) + 'darwin');
  m.pontos.forEach(function (p) {
    linhas.push(pad(p.chave, 24) + pad(p.classe, 16) +
      pad(p.porSistema.win32, 26) + pad(p.porSistema.linux, 26) + p.porSistema.darwin);
  });
  linhas.push('');
  m.pontos.forEach(function (p) {
    linhas.push('- ' + p.chave + ': ' + p.titulo);
    linhas.push('    ' + p.ocorrencias + ' ocorrencia(s) em ' + p.arquivos.length + ' arquivo(s)');
    linhas.push('    prova: ' + p.comoSeProva);
    if (p.ressalva) linhas.push('    ressalva: ' + p.ressalva);
  });
  linhas.push('');
  if (m.orfas.length > 0) {
    linhas.push('ORFAS - ocorrencia sem ponto declarado (' + m.orfas.length + '):');
    m.orfas.forEach(function (o) { linhas.push('    ' + o.marcador + '  ' + o.arquivo + ':' + o.linha); });
  }
  if (m.mortos.length > 0) {
    linhas.push('MORTOS - ponto declarado que nao acha mais nada (' + m.mortos.length + '):');
    m.mortos.forEach(function (o) { linhas.push('    ' + o.marcador + '  ' + o.arquivo); });
  }
  if (m.integra) linhas.push('A matriz cobre o disco: nenhuma orfa, nenhum morto.');
  linhas.push('');
  m.resumo.naoTestados.forEach(function (n) {
    linhas.push('NAO TESTADO em ' + n.sistema + ': ' + n.pontos + ' de ' + m.resumo.pontos + ' pontos.');
  });
  linhas.push('Nunca rodou fora de win32. Isto e declaracao, nao medicao - nenhum teste sabe ' +
              'onde a suite ja rodou antes.');
  return linhas.join('\n');
}

function pad(s, n) {
  const t = String(s);
  return t.length >= n ? t + ' ' : t + ' '.repeat(n - t.length);
}

module.exports = { MARCADORES, PONTOS, SISTEMAS, INJETAVEL, SO_NO_SISTEMA, varrer, matriz, texto };
