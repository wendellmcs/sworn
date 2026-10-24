'use strict';
const fs = require('node:fs');
const path = require('node:path');
const degrausLib = require('./degraus.js');
const agentesLib = require('./agentes.js');
const apelidosLib = require('./apelidos.js');
const catalogoLib = require('./catalogo.js');

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

function existe(p) {
  try { return fs.existsSync(p); } catch (e) { return false; }
}

function lerJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

/** Os fatos deste ambiente, medidos uma vez e reusados por todos os portoes. */
function ambiente(cwd, projeto) {
  const p = projeto || {};
  const escada = (p.agentes && Array.isArray(p.agentes.escada)) ? p.agentes.escada : [];
  const degraus = degrausLib.normalizar((p.agentes || {}).degraus);
  const lidos = agentesLib.listar(cwd);
  return {
    temProjeto: !!projeto,
    temMarchas: !!(p.marchas && Object.keys(p.marchas).length > 0),
    temIntocaveis: Array.isArray(p.intocaveis) && p.intocaveis.length > 0,
    temPlataforma: !!(p.plataforma && p.plataforma.so),
    temDesign: existe(path.join(cwd, '.claude', 'sworn', 'design.json')),
    temGit: existe(path.join(cwd, '.git')),
    escada: escada.length,
    degraus: degraus.length,
    temPastaDeAgentes: lidos.existe,
    agentes: lidos.agentes.length,
    catalogo: catalogoLib.ler(cwd),
    prova: lerJson(path.join(cwd, '.claude', 'sworn', 'apelidos-vivos.json'))
  };
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
    a.temProjeto, a.temProjeto ? 'depende so do escopo do turno' : 'sem projeto.json'));

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
                    : 'projeto.json nao declara plataforma: a tabela nao carrega'));

  // Foco de revisao 2. custo.js nao opina com menos de dois nomes, e nao avisa
  // que nao opina - e a falha silenciosa que este relatorio existe para acusar.
  lista.push(portao('custo', 'Agente caro em marcha rapida', HOOK,
    a.escada >= degrausLib.MINIMO,
    a.escada >= degrausLib.MINIMO
      ? 'escada com ' + a.escada + ' nomes'
      : 'escada com ' + a.escada + ' nome(s): com menos de ' + degrausLib.MINIMO +
        ' este portao NAO OPINA, e nao avisa que nao opina'));

  const apel = apelidosLib.conferir(projeto, agentesLib.listar(cwd));
  lista.push(portao('apelido', 'Gatilho 3 - model: do agente x apelido gravado', HOOK,
    apel.verificavel,
    apel.verificavel
      ? 'ha ' + a.agentes + ' agente(s) e ' + a.degraus + ' apelido(s) para comparar'
      : apel.motivo));

  // Spec 9.6: este vive em skill. Nunca prometer garantia onde ha instrucao.
  lista.push(portao('catalogo', 'Gatilho 2 - comparacao com o catalogo do harness', INSTRUCAO,
    false,
    'vive em skill, no agente principal: e instrucao a um modelo, e instrucao pode ' +
    'ser pulada. Nenhum hook enxerga o catalogo do harness. ' +
    (a.catalogo ? 'ultima consulta a pagina (gatilhos 1 e 4): ' + a.catalogo.desfecho : 'nunca se consultou aqui')));

  // Decisao 29: o apelido que o proprio plugin publica (o do inspetor) entra na conta.
  const cob = apelidosLib.cobertura(projeto, a.prova, apelidosLib.agentesDoPlugin());
  lista.push(portao('apelidos-vivos', 'H4 - o apelido ainda e aceito', INSTRUCAO,
    cob.temProva && cob.naoProvados.length === 0,
    cob.temProva
      ? (cob.naoProvados.length === 0
          ? 'todos os ' + cob.provados.length + ' apelidos foram sondados'
          : 'faltam sondar: ' + cob.naoProvados.join(', '))
      : 'ainda nao se sondou neste ambiente' +
        (cob.apelidos.length ? ' (a sondar: ' + cob.apelidos.join(', ') + ')' : '')));

  return lista;
}

function relatorio(cwd, projeto) {
  const a = ambiente(cwd, projeto);
  const lista = portoes(cwd, projeto, a);
  const verificaveis = lista.filter(function (p) { return p.verificavel; });
  const garantidos = lista.filter(function (p) { return p.verificavel && p.determinismo === HOOK; });
  return {
    ambiente: a,
    portoes: lista,
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
  return linhas.join('\n');
}

module.exports = { HOOK, INSTRUCAO, ambiente, portoes, relatorio, texto };
