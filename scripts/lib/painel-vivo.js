'use strict';
// Painel de sessoes, fase 3: a traducao da entrada do gancho do Claude Code nos eventos que a tela entende. Sem efeito
// colateral: o gancho enxuga a entrada (`enxugar`) e manda a nota ao painel; o servidor traduz a nota (`traduzir`)
// contra a sessao que ja conhece e aplica os eventos no estado (painel/prototipo/estado.js). O servidor tambem tira
// daqui o retrato do estado que a aba le (`retrato`) e a saida do gancho com a decisao do dono (`saidaDaDecisao`). As
// formas da entrada sao as que a sonda P0 da fase 3 gravou num `claude -p` de verdade (s377).

// O que a nota leva de cada campo: a nota viaja do gancho ao painel, e a tela so mostra um pedaco.
const LIMITES = { texto: 500, comando: 2000, descricao: 300, resumo: 2000, caminho: 1000, trecho: 80, linha: 400,
  opcoes: 10, opcao: 200, nome: 60, tarefa: 300, curto: 40 };
const EVENTOS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop', 'SessionEnd'];
const ID_DA_SESSAO = /^[A-Za-z0-9_-]{1,128}$/;
const NOME_DA_FERRAMENTA = /^[A-Za-z0-9_.:-]{1,100}$/;
const SHELL = ['Bash', 'PowerShell'];
const MUDA_ARQUIVO = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'];
const MINUTO = 60000;
// O motivo que o agente le: sem o que fazer depois, ele tenta o mesmo pedido de novo.
const NEGADO = 'Negado pelo dono no painel de sessões. Não repita o mesmo pedido: pergunte ao dono o que ele quer ' +
  'ou siga por outro caminho.';
const { ehObjeto } = require('./texto.js');

function ehTexto(x) { return typeof x === 'string' && x.trim() !== ''; }
function ehContagem(n) { return Number.isInteger(n) && n >= 0; }
function textos(x) { return Array.isArray(x) ? x.filter(function (l) { return typeof l === 'string'; }) : []; }
// O corte para no limite em unidades UTF-16; se ele cai entre as duas metades de um emoji, a 1a metade sai tambem.
function cortar(texto, n) {
  if (texto.length <= n) return texto;
  const c = texto.charCodeAt(n - 1);
  return texto.slice(0, c >= 0xd800 && c <= 0xdbff ? n - 1 : n) + '…';
}
function barras(p) { return p.replace(/\\/g, '/'); }

// ---------------------------------------------------------------- do gancho a nota

function linhasDe(conteudo) {
  if (conteudo === '') return [];
  const linhas = conteudo.split(/\r?\n/);
  if (linhas[linhas.length - 1] === '') linhas.pop();
  return linhas;
}

// As linhas a mais e a menos de uma mudanca de arquivo, e o trecho no formato do `git diff` a partir do '@@', ate o
// teto da tela. O Edit traz o structuredPatch; o Write de arquivo novo, so o conteudo.
function mudancaDe(resposta, entrada) {
  const r = ehObjeto(resposta) ? resposta : {};
  const patch = Array.isArray(r.structuredPatch) ? r.structuredPatch.filter(ehObjeto) : [];
  const m = { mais: 0, menos: 0, trecho: [] };
  function guardar(l) { if (m.trecho.length < LIMITES.trecho) m.trecho.push(cortar(l, LIMITES.linha)); }
  const n = function (x) { return ehContagem(x) ? x : 0; };
  if (patch.length) {
    for (const h of patch) {
      guardar('@@ -' + n(h.oldStart) + ',' + n(h.oldLines) + ' +' + n(h.newStart) + ',' + n(h.newLines) + ' @@');
      for (const l of textos(h.lines)) {
        if (l.charAt(0) === '+') m.mais += 1;
        else if (l.charAt(0) === '-') m.menos += 1;
        guardar(l);
      }
    }
    return m;
  }
  const conteudo = typeof r.content === 'string' ? r.content : (typeof entrada.content === 'string' ? entrada.content : null);
  if (r.type === 'create' && conteudo !== null) {
    for (const l of linhasDe(conteudo)) { m.mais += 1; guardar('+' + l); }
    return m;
  }
  // O Edit que nao mudou nada traz o structuredPatch vazio: a mudanca de zero linhas. Sem ele, nao ha mudanca a contar.
  return Array.isArray(r.structuredPatch) ? m : null;
}

function perguntaDe(entrada) {
  const q = Array.isArray(entrada.questions) ? entrada.questions.find(ehObjeto) : null;
  if (!q) return null;
  const opcoes = Array.isArray(q.options) ? q.options : [];
  return {
    texto: ehTexto(q.question) ? cortar(q.question, LIMITES.texto) : '',
    opcoes: opcoes.map(function (o) { return ehObjeto(o) && ehTexto(o.label) ? cortar(o.label, LIMITES.opcao) : null; })
      .filter(function (o) { return o !== null; }).slice(0, LIMITES.opcoes),
  };
}

// O que cada ferramenta poe na nota: o comando do shell, o arquivo que muda, a pergunta, ou o resumo da entrada. O
// resumo de uma ferramenta de fora (MCP, WebFetch...) so viaja no pedido de permissao, o unico evento que o mostra.
function daFerramenta(nota, ferramenta, entrada, resposta) {
  if (SHELL.includes(ferramenta)) {
    if (typeof entrada.command === 'string') nota.comando = cortar(entrada.command, LIMITES.comando);
    if (ehTexto(entrada.description)) nota.descricao = cortar(entrada.description, LIMITES.descricao);
  } else if (MUDA_ARQUIVO.includes(ferramenta)) {
    const arquivo = ehTexto(entrada.file_path) ? entrada.file_path : entrada.notebook_path;
    if (ehTexto(arquivo)) nota.arquivo = cortar(arquivo, LIMITES.caminho);
    if (nota.evento === 'PostToolUse') {
      const m = mudancaDe(resposta, entrada);
      if (m) nota.mudanca = m;
    }
  } else if (ferramenta === 'AskUserQuestion') {
    const p = perguntaDe(entrada);
    if (p) nota.pergunta = p;
  } else if (nota.evento === 'PermissionRequest') {
    nota.resumo = cortar(JSON.stringify(entrada), LIMITES.resumo);
  }
}

// A entrada do gancho vira a nota: so o que a tela usa, cortado. Sem sessao ou evento valido, null.
function enxugar(entrada) {
  if (!ehObjeto(entrada)) return null;
  const sessao = entrada.session_id;
  const evento = entrada.hook_event_name;
  if (typeof sessao !== 'string' || !ID_DA_SESSAO.test(sessao) || !EVENTOS.includes(evento)) return null;
  const nota = { sessao, evento };
  // A pasta cortada seria outra pasta, e a mesa diria um projeto que nao existe: a longa demais fica de fora.
  if (ehTexto(entrada.cwd) && entrada.cwd.length <= LIMITES.caminho) nota.cwd = entrada.cwd;
  if (ehTexto(entrada.source)) nota.fonte = cortar(entrada.source, LIMITES.curto);
  if (ehTexto(entrada.reason)) nota.motivo = cortar(entrada.reason, LIMITES.curto);
  const fala = evento === 'UserPromptSubmit' ? entrada.prompt : evento === 'Stop' ? entrada.last_assistant_message : null;
  if (typeof fala === 'string') nota.texto = cortar(fala, LIMITES.texto);
  const ferramenta = entrada.tool_name;
  if (typeof ferramenta === 'string' && NOME_DA_FERRAMENTA.test(ferramenta)) {
    nota.ferramenta = ferramenta;
    daFerramenta(nota, ferramenta, ehObjeto(entrada.tool_input) ? entrada.tool_input : {}, entrada.tool_response);
  }
  return nota;
}

// ---------------------------------------------------------------- da nota aos eventos

// A pasta do projeto com barra normal e sem a barra do fim; o nome e o ultimo pedaco.
function pastaDoProjeto(cwd) {
  const p = barras(cwd).replace(/(.)\/+$/, '$1');
  return { projeto: p, projetoNome: p.split('/').filter(Boolean).pop() || p };
}

// O arquivo como a mesa mostra: relativo a pasta da sessao quando esta dentro dela, senao o caminho inteiro, sempre
// com barra normal. Caminho do Windows (com letra de unidade) compara sem caixa. A raiz ('/' ou 'C:/') ja termina na
// barra, e o arquivo dela fica relativo a ela como o de qualquer outra pasta.
function caminhoNaTela(arquivo, cwd) {
  const a = barras(arquivo);
  if (!ehTexto(cwd)) return a;
  const base = pastaDoProjeto(cwd).projeto;
  const semCaixa = /^[A-Za-z]:\//.test(a);
  const comparavel = function (x) { return semCaixa ? x.toLowerCase() : x; };
  const prefixo = base.endsWith('/') ? base : base + '/';
  return comparavel(a).startsWith(comparavel(prefixo)) && a.length > prefixo.length ? a.slice(prefixo.length) : a;
}

// O nome da mesa: a 1a linha com texto do 1o prompt, sem espaco repetido.
function nomeDaMesa(texto) {
  const linha = texto.split(/\r?\n/).map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).find(Boolean) || '';
  return cortar(linha, LIMITES.nome);
}

// A tarefa da mesa: o 1o prompt inteiro numa linha. Sem ela, a tela diz "sem tarefa escrita" de uma sessao que tem.
function tarefaDaMesa(texto) { return cortar(texto.replace(/\s+/g, ' ').trim(), LIMITES.tarefa); }

function mesaNova(nota) {
  const ev = { tipo: 'sessao', sessao: nota.sessao, nome: 'Sessão ' + nota.sessao.slice(0, 4) };
  if (ehTexto(nota.cwd)) Object.assign(ev, pastaDoProjeto(nota.cwd));
  return Object.assign(ev, { maquina: 'local', origem: 'terminal', estado: 'parada' });
}

function pedidoDePermissao(nota) {
  const f = nota.ferramenta;
  const p = { tipo: 'permissao' };
  if (SHELL.includes(f)) {
    p.texto = ehTexto(nota.descricao) ? nota.descricao : 'Quer rodar um comando.';
    if (ehTexto(nota.comando)) p.comando = nota.comando;
  } else if (MUDA_ARQUIVO.includes(f)) {
    p.texto = 'Quer mudar um arquivo.';
    if (ehTexto(nota.arquivo)) p.arquivo = caminhoNaTela(nota.arquivo, nota.cwd);
  } else {
    p.texto = ehTexto(f) ? 'Quer usar a ferramenta ' + f + '.' : 'Pede uma permissão.';
    if (ehTexto(nota.resumo)) p.comando = nota.resumo;
  }
  p.urgencia = 'alta';
  return p;
}

function pedidoDePergunta(pergunta) {
  return { tipo: 'pergunta', texto: ehTexto(pergunta.texto) ? pergunta.texto : 'Tem uma pergunta para você.',
    opcoes: textos(pergunta.opcoes), urgencia: 'alta' };
}

// As linhas do arquivo somam na sessao, e o trecho junta os pedacos de cada edicao.
// atalho: o trecho junta e o estado corta no teto, e o `cortadas` do evento anterior se perde. limite: a mesa mostra
// as primeiras 80 linhas e o "mais N" so do ultimo corte. trocar quando: a tela mostrar o diff por edicao.
function eventoDoArquivo(nota, conhecida) {
  const caminho = caminhoNaTela(nota.arquivo, nota.cwd);
  const antes = conhecida && Array.isArray(conhecida.arquivos)
    ? conhecida.arquivos.find(function (a) { return ehObjeto(a) && a.caminho === caminho; })
    : null;
  const m = ehObjeto(nota.mudanca) ? nota.mudanca : {};
  const soma = function (campo) {
    return (antes && ehContagem(antes[campo]) ? antes[campo] : 0) + (ehContagem(m[campo]) ? m[campo] : 0);
  };
  return { tipo: 'arquivo', sessao: nota.sessao, caminho, mais: soma('mais'), menos: soma('menos'),
    trecho: textos(antes && antes.trecho).concat(textos(m.trecho).slice(0, LIMITES.trecho)) };
}

// A nota vira os eventos da tela, contra a sessao que o estado ja tem (`conhecida`, ou null). A 1a nota de uma sessao
// desconhecida cria a mesa; a que acaba sem nunca ter aparecido nao cria.
function traduzir(nota, conhecida) {
  if (!ehObjeto(nota) || typeof nota.sessao !== 'string' || !ID_DA_SESSAO.test(nota.sessao) ||
      !EVENTOS.includes(nota.evento)) return [];
  const s = ehObjeto(conhecida) ? conhecida : null;
  if (!s && nota.evento === 'SessionEnd') return [];
  const id = nota.sessao;
  const eventos = s ? [] : [mesaNova(nota)];
  const estado = s ? s.estado : 'parada';
  const texto = typeof nota.texto === 'string' ? nota.texto : '';
  function para(novo, pedido) {
    const ev = { tipo: 'estado', sessao: id, estado: novo };
    if (pedido) ev.pedido = pedido;
    eventos.push(ev);
  }
  if (nota.evento === 'UserPromptSubmit') {
    const jaFalou = s && Array.isArray(s.conversa) && s.conversa.some(function (f) { return ehObjeto(f) && f.quem === 'dono'; });
    if (!jaFalou && ehTexto(texto)) {
      eventos.push({ tipo: 'sessao', sessao: id, nome: nomeDaMesa(texto), tarefa: tarefaDaMesa(texto) });
    }
    if (estado !== 'trabalhando') para('trabalhando');
    if (ehTexto(texto)) eventos.push({ tipo: 'mensagem', sessao: id, quem: 'dono', texto });
  } else if (nota.evento === 'PreToolUse') {
    if (nota.ferramenta === 'AskUserQuestion' && ehObjeto(nota.pergunta)) para('precisa', pedidoDePergunta(nota.pergunta));
  } else if (nota.evento === 'PermissionRequest') {
    para('precisa', pedidoDePermissao(nota));
  } else if (nota.evento === 'PostToolUse') {
    if (estado !== 'trabalhando') para('trabalhando');
    if (MUDA_ARQUIVO.includes(nota.ferramenta) && ehTexto(nota.arquivo)) eventos.push(eventoDoArquivo(nota, s));
  } else if (nota.evento === 'Stop') {
    para('parada');
    if (ehTexto(texto)) eventos.push({ tipo: 'mensagem', sessao: id, quem: 'agente', texto });
  } else if (nota.evento === 'SessionEnd') {
    para('concluida');
  }
  return eventos;
}

// ---------------------------------------------------------------- o retrato e a decisao

// O estado ao vivo como os dados que o criar do estado.js le: o tempo no estado em minutos (com fracao, para o
// relogio da tela nao voltar ao recarregar), sem o instante absoluto. `seq` e o ultimo evento que o retrato ja tem.
function retrato(st, agora, seq) {
  const copia = JSON.parse(JSON.stringify(st));
  for (const s of copia.sessoes) {
    s.minutosNoEstado = Math.max(0, (agora - s.desde) / MINUTO);
    delete s.desde;
    delete s.atividade;
  }
  return Object.assign(copia, { modo: 'ao-vivo', seq });
}

// A decisao do dono vira a saida do gancho PermissionRequest; o que nao e aprovar nem negar nao decide nada.
function saidaDaDecisao(escolha) {
  const decision = escolha === 'aprovar' ? { behavior: 'allow' }
    : escolha === 'negar' ? { behavior: 'deny', message: NEGADO } : null;
  return decision ? { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } } : null;
}

module.exports = { LIMITES, enxugar, traduzir, retrato, saidaDaDecisao };
