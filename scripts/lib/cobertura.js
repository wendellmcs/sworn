'use strict';
const fs = require('node:fs');
const path = require('node:path');
const degrausLib = require('./degraus.js');
const agentesLib = require('./agentes.js');
const apelidosLib = require('./apelidos.js');
const catalogoLib = require('./catalogo.js');
const jsonio = require('./jsonio.js');
const ambienteLib = require('./ambiente.js');
const kitLib = require('./kit.js');

/**
 * Entrega F: para ESTE ambiente, o que consigo verificar aqui, o que nao, e por
 * que. "Sem pontos cegos" nao e alcancavel; "todos os pontos cegos conhecidos e
 * declarados nesta maquina" e - e e o que o manual ja exige: o risco nunca foi
 * a ausencia do portao, e o silencio sobre ela.
 *
 * `determinismo` nao e enfeite. So hook e garantido; o que vive em skill e
 * instrucao a um modelo, e instrucao pode ser pulada. Um relatorio que jogasse
 * os dois no mesmo balde prometeria garantia onde nao ha.
 */

const HOOK = 'hook';
const INSTRUCAO = 'instrucao';

// H1 (A6-49, s372): o que existe e nao se le (EACCES, EPERM) conta como presente. O existsSync devolvia false tambem
// para ele, e o design.json ou o .git sem permissao pareciam ausentes. Qualquer outro erro (ENOENT, ENOTDIR, o
// caminho invalido com NUL, o nome longo demais) e "nao existe".
function existe(p) {
  try {
    fs.statSync(p);
    return true;
  } catch (e) {
    return !!(e && (e.code === 'EACCES' || e.code === 'EPERM'));
  }
}

// A6 (s220, R1 :28): so o ausente e "sem valor"; o que existe e nao se le devolve a causa (o codigo do sistema, ou o
// erro do JSON), para o portao dizer, em vez de parecer que nunca se gravou. F5a: a leitura e a do lib/jsonio.js.
// H1 (A6-51, s372): o campo e `causa` (a frase do porque, ou null), nao um sim ou nao.
function lerProva(p) {
  const r = jsonio.ler(p);
  if (r.etapa === 'json') return { valor: null, causa: 'JSON invalido: ' + r.erro.message };
  if (r.etapa === 'leitura') return { valor: null, causa: r.erro.code || r.erro.message };
  return { valor: r.valor, causa: null };
}

/** Os fatos deste ambiente, medidos uma vez e reusados por todos os portoes. */
function ambiente(cwd, projeto) {
  const p = projeto || {};
  const escada = (p.agentes && Array.isArray(p.agentes.escada)) ? p.agentes.escada : [];
  const degraus = degrausLib.normalizar((p.agentes || {}).degraus);
  const lidos = agentesLib.listar(cwd);
  const prova = lerProva(path.join(cwd, '.claude', 'sworn', 'apelidos-vivos.json'));
  const a = {
    temProjeto: !!projeto,
    temMarchas: !!(p.marchas && Object.keys(p.marchas).length > 0),
    temIntocaveis: Array.isArray(p.intocaveis) && p.intocaveis.length > 0,
    temPlataforma: !!(p.plataforma && p.plataforma.so),
    temDesign: existe(path.join(cwd, '.claude', 'sworn', 'design.json')),
    temGit: existe(path.join(cwd, '.git')),
    escada: escada.length,
    degraus: degraus.length,
    agentes: lidos.agentes.length,
    catalogo: catalogoLib.ler(cwd),
    prova: prova.valor,
    provaIlegivel: prova.causa
  };
  // H1 (A6-41 a A6-45, s372): a lista lida fica com o ambiente, para o portao do apelido nao reler a pasta; fora do
  // JSON do --json (nao enumeravel), que mostra as contagens. O temPastaDeAgentes saiu: ninguem o lia.
  Object.defineProperty(a, 'agentesLidos', { value: lidos, enumerable: false });
  return a;
}

// H1 (A6-46, A6-50, s372): a frase do portao dos apelidos vivos, em ifs; era uma cadeia de ternarios de 3 niveis.
function porqueApelidosVivos(a, cob, sondar) {
  if (a.provaIlegivel) return 'apelidos-vivos.json nao se le (' + a.provaIlegivel + '): ' + apelidosLib.REGRAVAR;
  if (cob.provaInvalida) return cob.provaInvalida;
  if (cob.temProva) {
    if (cob.naoProvados.length === 0) return 'todos os ' + cob.provados.length + ' apelidos foram sondados';
    return 'faltam sondar: ' + cob.naoProvados.join(', ') + sondar;
  }
  return 'ainda nao se sondou neste ambiente' +
    (cob.apelidos.length ? ' (a sondar: ' + cob.apelidos.join(', ') + ')' : '') + sondar;
}

function portao(chave, titulo, determinismo, verificavel, porque) {
  return { chave: chave, titulo: titulo, determinismo: determinismo,
           verificavel: verificavel, porque: porque };
}

function portoes(cwd, projeto, a) {
  const lista = [];

  lista.push(portao('escopo', 'Escopo declarado antes de editar', HOOK,
    a.temProjeto && a.temMarchas,
    a.temProjeto ? (a.temMarchas ? 'ha mapa de marchas em projeto.json'
                                 : 'projeto.json nao declara marchas: tudo cai na marcha padrao')
                 : 'sem projeto.json: rode a entrevista'));

  lista.push(portao('intocaveis', 'Arquivos intocaveis', HOOK,
    a.temIntocaveis,
    a.temIntocaveis ? 'ha ' + projeto.intocaveis.length + ' padrao(oes) declarado(s)'
                    : 'nenhum intocavel declarado: o portao nao tem o que proteger'));

  lista.push(portao('outra-frente', 'Arquivo que ja estava modificado na abertura', HOOK,
    a.temGit,
    a.temGit ? 'ha repositorio git para fotografar'
             : 'fora de repositorio git: nao ha foto de abertura para comparar'));

  lista.push(portao('busca-antes-de-criar', 'Procurar antes de criar arquivo', HOOK,
    a.temProjeto, a.temProjeto ? 'depende so do escopo do turno' : 'sem projeto.json: rode a entrevista'));

  lista.push(portao('catraca', 'Nao afrouxar catraca para o teste passar', HOOK,
    true, 'compara o antes e o depois da propria edicao; nao depende de configuracao'));

  lista.push(portao('design', 'Token fora do design system', HOOK,
    a.temDesign,
    a.temDesign ? 'ha design.json neste projeto'
                : 'modulo opcional: sem .claude/sworn/design.json nada dispara'));

  lista.push(portao('destrutivo', 'Comando destrutivo', HOOK,
    true, 'classifica o proprio comando; nao depende de configuracao'));

  lista.push(portao('shell', 'Idioma de shell errado para a plataforma', HOOK,
    a.temPlataforma,
    a.temPlataforma ? 'plataforma declarada em projeto.json'
                    : 'projeto.json nao declara plataforma.so: sem o sistema da maquina, nao da para conferir se o ' +
                      'comando de shell e o certo; rode /sworn:init de novo, que o infere e grava'));

  // Foco de revisao 2. custo.js nao opina com menos de dois nomes, e nao avisa
  // que nao opina - e a falha silenciosa que este relatorio existe para acusar.
  // A6-87 (D735): o efeito e o passo em palavras comuns; o passo vai pelo init, que grava escada e degraus juntos.
  // A6-112: efeito e passo em frases separadas, e a escada explicada na primeira vez. s266 (R1): o plural certo.
  // H1 (A6-118, s372): a marcha glosada no titulo, e a escada tambem no ramo que vale
  lista.push(portao('custo', 'Agente caro em marcha rapida (a tarefa simples)', HOOK,
    a.escada >= degrausLib.MINIMO,
    a.escada >= degrausLib.MINIMO
      ? 'escada com ' + a.escada + ' nomes (a lista dos agentes, do mais barato ao mais caro)'
      : 'escada com ' + a.escada + (a.escada === 1 ? ' nome' : ' nomes') + ' (a escada e a lista dos agentes, ' +
        'do mais barato ao mais caro): com menos de ' + degrausLib.MINIMO + ', a checagem que barra o agente ' +
        'mais caro que a tarefa pede fica ' +
        'parada, e so este relatorio mostra isso. Para ela valer, rode o /sworn:init de novo e ponha ao menos ' +
        degrausLib.MINIMO + ' agentes na escada (agentes.escada do .claude/sworn/projeto.json)'));

  const apel = apelidosLib.conferir(projeto, a.agentesLidos || agentesLib.listar(cwd));
  // A6-52 (s235): os titulos em palavras comuns, sem "Gatilho n", "H4" nem o campo `model:`.
  lista.push(portao('apelido', 'Modelo que cada agente declara x apelido gravado no projeto', HOOK,
    apel.verificavel,
    apel.verificavel
      ? 'ha ' + a.agentes + ' agente(s) e ' + a.degraus + ' apelido(s) para comparar'
      : apel.motivo));

  // Spec 9.6: este vive em skill. Nunca prometer garantia onde ha instrucao.
  lista.push(portao('catalogo', 'Comparacao com o catalogo de modelos', INSTRUCAO,
    false,
    'vive em skill, no agente principal: e instrucao a um modelo, e instrucao pode ' +
    'ser pulada. Nenhum hook enxerga o catalogo de modelos. ' +
    (a.catalogo ? 'ultima consulta a pagina (feita pelo /sworn:init e pelo /sworn:audit): ' + a.catalogo.desfecho
      : 'nunca se consultou aqui')));

  // Decisao 29: o apelido que o proprio plugin publica (o do inspetor) entra na conta.
  // A6 (s220, R1 :28): a prova ilegivel e a fora da forma (provaInvalida, A1) se dizem, com o passo do REGRAVAR.
  const cob = apelidosLib.cobertura(projeto, a.prova, apelidosLib.agentesDoPlugin());
  // A6-47 (s235): os dois ramos sem a prova inteira dizem o comando que sonda.
  // A6-88 (D735): onde a prova vai (provar-apelidos.js, ondeGravar) e o caminho real do script, entre aspas.
  // A6-117: o --plugin diz o que faz, igual ao REGRAVAR do lib/apelidos.js.
  const sondar = ': rode node "' + path.join(__dirname, '..', 'provar-apelidos.js') + '" (no repositorio do proprio ' +
    'plugin, acrescente --plugin: ele sonda so os agentes do plugin) e grave a prova em .claude/sworn/apelidos-vivos.json, ' +
    'no formato que ele mostra';
  lista.push(portao('apelidos-vivos', 'O apelido de modelo ainda e aceito', INSTRUCAO,
    cob.temProva && cob.naoProvados.length === 0,
    porqueApelidosVivos(a, cob, sondar)));

  return lista;
}

/**
 * `opcoes` vai ao `ambiente.detectar` do kit (H6j, D906): `claudeJson` e `rotuloClaudeJson`, que so a linha de comando
 * passa. O kit fica fora de `portoes` e do `resumo`: e recomendacao, nao portao.
 */
function relatorio(cwd, projeto, opcoes) {
  const a = ambiente(cwd, projeto);
  const lista = portoes(cwd, projeto, a);
  const verificaveis = lista.filter(function (p) { return p.verificavel; });
  const garantidos = lista.filter(function (p) { return p.verificavel && p.determinismo === HOOK; });
  return {
    ambiente: a,
    portoes: lista,
    kit: kitLib.daPasta(cwd, ambienteLib.detectar(cwd, opcoes)),
    resumo: {
      total: lista.length,
      verificaveis: verificaveis.length,
      naoVerificaveis: lista.length - verificaveis.length,
      garantidos: garantidos.length
    }
  };
}

/** O relatorio em texto. Declarar o que NAO da e o ponto, nao o rodape. */
function texto(r) {
  // Plano 082, Tarefa 5 (mock S10): a 1a linha diz o que o relatorio responde.
  const linhas = ['sworn - cobertura neste ambiente: o que consigo verificar aqui, e o que nao.', ''];
  linhas.push('Consigo verificar aqui (' + r.resumo.verificaveis + ' de ' + r.resumo.total + '):');
  for (const p of r.portoes) {
    if (p.verificavel) linhas.push('  [x] ' + p.titulo + ' - ' + p.porque);
  }
  linhas.push('');
  linhas.push('NAO consigo verificar aqui (' + r.resumo.naoVerificaveis + '):');
  for (const p of r.portoes) {
    if (!p.verificavel) linhas.push('  [ ] ' + p.titulo + ' - ' + p.porque);
  }
  linhas.push('');
  linhas.push('Garantidos por hook: ' + r.resumo.garantidos + '. O resto vive em instrucao,');
  linhas.push('e instrucao pode ser pulada - isto e desenho declarado, nao defeito a consertar.');
  if (r.kit) linhas.push('', ...kitLib.linhas(r.kit));
  return linhas.join('\n');
}

module.exports = { HOOK, INSTRUCAO, ambiente, portoes, relatorio, texto };
