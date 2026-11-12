'use strict';
// E1 (D827): a captura de tela do proprio sworn, pelo protocolo de depuracao do Chrome (CDP), sem pacote de terceiro.
// Esta lib e a parte pura: argumentos, onde achar o navegador, a porta do arquivo DevToolsActivePort, o resumo do
// console, dos erros e da arvore de acessibilidade, e a limpeza de segredo do que vai para o disco. O processo, o
// socket e o disco ficam em scripts/capturar-tela.js.

// Acima de ~16 mil px de altura o Chrome nao grava a imagem (limite de textura, medido no Windows em 2026-09-28).
const ALTURA_MAXIMA = 16000;
const TEXTO_MAXIMO = 500;
// O que a pagina disse fica inteiro ate 64 KB por texto, so para nao crescer sem limite na memoria; o corte em
// TEXTO_MAXIMO vem depois da limpeza de segredo (textoParaODisco).
const TEXTO_BRUTO = 65536;
const ITENS_MAXIMOS = 500;
// Tetos dos argumentos: 8000 px de largura cobre as telas largas comuns com folga, e 600000 ms (10 minutos) e o
// maximo que uma captura espera antes de desistir.
const TETO_DA_LARGURA = 8000;
const TETO_DO_TEMPO = 600000;
const PADRAO = { largura: 1280, altura: 800, tempoMax: 30000 };
// Os argumentos numericos: o teto e a unidade de cada um.
const NUMERICOS = { largura: { teto: TETO_DA_LARGURA, unidade: 'px' }, altura: { teto: ALTURA_MAXIMA, unidade: 'px' },
  tempoMax: { teto: TETO_DO_TEMPO, unidade: 'ms' } };
const PROTOCOLOS = ['http:', 'https:', 'file:'];
// Papeis sem significado proprio: a arvore resumida so guarda o que alguem le ou usa.
const PAPEIS_VAZIOS = new Set(['generic', 'none', 'presentation', 'InlineTextBox', 'LineBreak', 'StaticText',
  'RootWebArea', 'GenericContainer']);

const USO = 'uso: node capturar-tela.js --url <http(s)://... ou file:///...> --saida <pasta> ' +
  '[--largura 1280] [--altura 800] [--esperar <seletor CSS>] [--tempo-max 30000]';

function inteiroNoIntervalo(flag, v, teto, unidade) {
  if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > teto) {
    return { erro: flag + ' precisa ser um inteiro de 1 a ' + teto + ' ' + unidade + ', veio "' + v + '"' };
  }
  return { valor: Number(v) };
}

// Le os argumentos. Devolve { erro } com o que consertar na chamada, ou { opcoes }.
function lerArgs(argv) {
  const opcoes = Object.assign({ url: null, saida: null, esperar: null }, PADRAO);
  const nomes = { '--url': 'url', '--saida': 'saida', '--esperar': 'esperar', '--largura': 'largura',
    '--altura': 'altura', '--tempo-max': 'tempoMax' };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const chave = Object.hasOwn(nomes, flag) ? nomes[flag] : null; // "constructor" nao e argumento
    if (!chave) return { erro: 'argumento desconhecido "' + flag + '". ' + USO };
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) return { erro: flag + ' veio sem valor. ' + USO };
    if (Object.hasOwn(NUMERICOS, chave)) {
      const n = inteiroNoIntervalo(flag, v, NUMERICOS[chave].teto, NUMERICOS[chave].unidade);
      if (n.erro) {
        const nota = { altura: ' (acima disso o Chrome nao grava a imagem)',
          tempoMax: ' (o padrao e 30000, meio minuto; o maximo, 10 minutos)' };
        return { erro: n.erro + (nota[chave] || '') };
      }
      opcoes[chave] = n.valor;
    } else {
      opcoes[chave] = v;
    }
  }
  if (!opcoes.url) return { erro: 'falta --url. ' + USO };
  if (!opcoes.saida) return { erro: 'falta --saida (a pasta onde gravar a imagem e a evidencia). ' + USO };
  let u;
  // A mensagem mostra a URL limpa de segredo, como a evidencia.
  try { u = new URL(opcoes.url); } catch (e) {
    return { erro: '--url nao e um endereco valido: "' + semSegredo(opcoes.url) + '" (exemplo: http://localhost:3000)' };
  }
  if (!PROTOCOLOS.includes(u.protocol)) {
    return { erro: '--url precisa comecar com http://, https:// ou file:///, e veio "' + semSegredo(opcoes.url) + '"' };
  }
  return { opcoes };
}

// Onde procurar o navegador, na ordem. SWORN_NAVEGADOR, quando existe, e o unico candidato: quem apontou um navegador
// nao quer outro em silencio. Os caminhos do Windows sao montados com a barra do Windows de proposito: a plataforma
// entra por parametro, entao os tres sistemas se exercitam daqui.
function candidatosDoNavegador(plataforma, env) {
  if (env.SWORN_NAVEGADOR) return [env.SWORN_NAVEGADOR];
  const lista = [];
  if (plataforma === 'win32') {
    const bases = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    for (const b of bases) lista.push(b + '\\Google\\Chrome\\Application\\chrome.exe');
    for (const b of bases) lista.push(b + '\\Microsoft\\Edge\\Application\\msedge.exe');
  } else if (plataforma === 'darwin') {
    lista.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    lista.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
      '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium');
  }
  return lista;
}

function acharNavegador(candidatos, existe) {
  return candidatos.find(existe) || null;
}

// O arquivo DevToolsActivePort tem a porta na 1a linha e o caminho do socket do navegador na 2a. Devolve o endereco,
// sempre em 127.0.0.1 (a captura nunca fala com outra maquina), ou null enquanto o arquivo esta incompleto.
function enderecoDoArquivo(texto) {
  const linhas = String(texto).split(/\r?\n/);
  const porta = (linhas[0] || '').trim();
  const caminho = (linhas[1] || '').trim();
  if (!/^\d{1,5}$/.test(porta) || Number(porta) < 1 || Number(porta) > 65535) return null;
  if (!/^\/devtools\/browser\/[\w-]+$/.test(caminho)) return null;
  return 'ws://127.0.0.1:' + porta + caminho;
}

// Corta no teto sem partir um caractere de dois pedacos (emoji): se o corte cai entre os dois, recua um.
function cortar(s, teto) {
  const t = String(s);
  if (t.length <= teto) return t;
  const ultimo = t.charCodeAt(teto - 1);
  const fim = ultimo >= 0xd800 && ultimo <= 0xdbff ? teto - 1 : teto;
  return t.slice(0, fim) + '...';
}

// O texto que vai para o disco: primeiro a limpeza de segredo, depois o corte em TEXTO_MAXIMO. Na ordem contraria, um
// segredo partido pelo corte perde o fechamento e o comeco dele escapa da limpeza.
function textoParaODisco(t) {
  return cortar(semSegredo(t), TEXTO_MAXIMO);
}

// Um argumento do console.log vira texto: o valor, se veio; senao a descricao (objeto, erro); senao o tipo.
function textoDoArgumento(a) {
  if (!a || typeof a !== 'object') return '';
  if (a.value !== undefined) return typeof a.value === 'string' ? a.value : JSON.stringify(a.value);
  if (a.description !== undefined) return a.description;
  if (a.unserializableValue !== undefined) return a.unserializableValue;
  return a.type || '';
}

// Runtime.consoleAPICalled -> { tipo, texto }.
function entradaDeConsole(params) {
  const args = Array.isArray(params && params.args) ? params.args : [];
  return { tipo: (params && params.type) || 'log', texto: cortar(args.map(textoDoArgumento).join(' '), TEXTO_BRUTO) };
}

// Runtime.exceptionThrown -> { texto, url, linha, coluna } (linha e coluna contadas a partir de 1).
function erroDaPagina(params) {
  const d = (params && params.exceptionDetails) || {};
  const texto = (d.exception && d.exception.description) || d.text || 'erro sem texto';
  return { texto: cortar(texto, TEXTO_BRUTO), url: d.url || '', linha: Number.isInteger(d.lineNumber) ? d.lineNumber + 1 : null,
    coluna: Number.isInteger(d.columnNumber) ? d.columnNumber + 1 : null };
}

// Log.entryAdded com nivel de erro (recurso que nao carregou, bloqueio de seguranca) -> o mesmo formato do erro.
function erroDoLog(params) {
  const e = (params && params.entry) || {};
  return { texto: cortar(e.text || 'erro sem texto', TEXTO_BRUTO), url: e.url || '', linha: Number.isInteger(e.lineNumber) ? e.lineNumber + 1 : null,
    coluna: null };
}

// Accessibility.getFullAXTree -> [{ papel, nome }] do que alguem le ou usa, na ordem da arvore, ate ITENS_MAXIMOS.
function resumirAcessibilidade(nos) {
  const itens = [];
  let cortada = false;
  for (const n of Array.isArray(nos) ? nos : []) {
    if (!n || n.ignored) continue;
    const papel = n.role && n.role.value;
    if (!papel || PAPEIS_VAZIOS.has(papel)) continue;
    const nome = n.name && typeof n.name.value === 'string' ? n.name.value.trim() : '';
    if (itens.length === ITENS_MAXIMOS) { cortada = true; break; } // um item util alem do teto: a lista ficou cortada
    itens.push({ papel, nome: cortar(nome, TEXTO_BRUTO) });
  }
  return { itens, cortada };
}

// Limpeza de segredo do que vai para o disco (a evidencia pode ser mostrada). Um parametro e secreto pelo nome: o nome
// inteiro, ou um pedaco dele separado por _ - ou ., esta na lista (access_token, api_key, X-Auth), ou o nome termina
// em token, secret ou password (accesstoken). Por pedaco, e nao por trecho, para nao apagar keyword, design ou encoded.
const NOMES_SECRETOS = new Set(['token', 'secret', 'segredo', 'senha', 'password', 'passwd', 'pass', 'pwd', 'key',
  'apikey', 'chave', 'auth', 'authorization', 'session', 'sessionid', 'sessao', 'sid', 'sig', 'signature', 'code',
  'cookie', 'credential', 'credentials', 'jwt', 'otp']);
// O nome em camelCase se separa na troca de caixa (secretKey -> secret, key), entao keyword e monkey ficam.
function nomeSecreto(nome) {
  const n = nome.toLowerCase();
  const pedacos = nome.replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase().split(/[_.-]/);
  return NOMES_SECRETOS.has(n) || pedacos.some(function (p) { return NOMES_SECRETOS.has(p); }) ||
    /(?:token|secret|password)$/.test(n);
}
// O valor que fica mesmo com nome secreto: code de tres digitos e codigo de status HTTP (code=404). Um code de quatro
// digitos ou mais pode ser PIN ou codigo de autorizacao, e sai.
function deveApagarValor(nome, valor) {
  return !(nome.toLowerCase() === 'code' && /^\d{3}$/.test(valor));
}
// Depois de Bearer ou Basic, so o que parece credencial: 8 ou mais caracteres com digito ou simbolo, ou com maiuscula
// no meio (base64). "Basic authentication" fica.
function pareceCredencial(t) {
  return t.length >= 8 && (/[\d.~+/=_-]/.test(t) || (/[a-z]/.test(t) && /[A-Z]/.test(t.slice(1))));
}
// Em qualquer texto (endereco, console, pilha de erro, nome na arvore): usuario:senha@ sai; o valor de nome=valor
// secreto (no comeco, depois de espaco ou de ? & # ;) vira [segredo]; o "nome": "valor" secreto de um JSON tambem; e
// o que vem depois de Bearer ou Basic. Na pilha de um erro o endereco vem seguido de :linha:coluna, que nao faz parte
// do valor e fica.
function semSegredo(texto) {
  return String(texto)
    .replace(/(\/\/)[^\s/?#@:]+:[^\s/?#@]*@/g, '$1')
    // Os cabecalhos Cookie e Set-Cookie levam pares nome=valor de sessao: a linha inteira depois deles sai.
    .replace(/(\b(?:Set-)?Cookie\s*:\s*)[^\r\n]*/gi, '$1[segredo]')
    // Depois do cabecalho Authorization, o valor sai sempre, qualquer que seja a forma dele.
    .replace(/(\bAuthorization\s*[:=]\s*)(?:(Bearer|Basic)\s+)?[^\s,;"']+/gi, function (m, cabecalho, tipo) {
      return cabecalho + (tipo ? tipo + ' ' : '') + '[segredo]';
    })
    .replace(/\b(Bearer|Basic)\s+([\w.~+/=-]+)/gi, function (m, tipo, valor) {
      return pareceCredencial(valor) ? tipo + ' [segredo]' : m;
    })
    // "nome": "valor" (com aspa escapada dentro) ou "nome": 123 de um JSON.
    // A aspa de fechamento pode faltar no fim do texto (um JSON que veio cortado): o valor ate o fim tambem e segredo.
    .replace(/(["'])([\w.-]+)\1(\s*:\s*)(?:(["'])((?:\\.|(?!\4)[^\\])*)(?:\4|$)|(-?\d[\d.]*))/g,
      function (m, aspa, nome, meio, aspa2, texto, numero) {
        const valor = aspa2 ? texto : numero;
        if (!nomeSecreto(nome) || !deveApagarValor(nome, valor)) return m;
        return aspa + nome + aspa + meio + (aspa2 ? aspa2 + '[segredo]' + aspa2 : '"[segredo]"');
      })
    .replace(/(^|[?&#;\s])([\w.-]+)=([^&#;\s"'<>]*?)(?=:\d+:\d+(?![\w.])|[&#;\s"'<>]|$)/g, function (m, sep, nome, valor) {
      return nomeSecreto(nome) && deveApagarValor(nome, valor) ? sep + nome + '=[segredo]' : m;
    });
}

// O console e os erros da pagina, limpos para o disco.
function consoleEErrosSemSegredo(consoleLista, erros) {
  return {
    console: (Array.isArray(consoleLista) ? consoleLista : []).filter(Boolean).map(function (c) {
      return { tipo: c.tipo || 'log', texto: textoParaODisco(c.texto || '') };
    }),
    erros: (Array.isArray(erros) ? erros : []).filter(Boolean).map(function (e) {
      return Object.assign({}, e, { texto: textoParaODisco(e.texto || ''), url: textoParaODisco(e.url || '') });
    }),
  };
}

// A altura que se fotografa: a da pagina, ate o limite em que o Chrome ainda grava, nunca menos que a janela.
function alturaDaFoto(alturaDaPagina, alturaDaJanela) {
  const h = Math.ceil(Number(alturaDaPagina) || 0);
  const base = Math.max(h, Number(alturaDaJanela) || PADRAO.altura);
  return { altura: Math.min(base, ALTURA_MAXIMA), cortada: base > ALTURA_MAXIMA };
}

// Um aviso novo soma ao que ja houver (o do servidor que respondeu erro e o da pasta temporaria presa), sem apagar.
function juntarAvisos(atual, novo) {
  return atual ? atual + '; ' + novo : novo;
}

// O que o script imprime e com que codigo sai: o JSON (0), ou "ERRO: ..." e, se houver, o aviso na linha seguinte (1).
function saidaDoScript(resultado) {
  const r = resultado || { erro: 'a captura parou sem resultado: rode de novo, e se repetir confira o navegador (SWORN_NAVEGADOR)' };
  if (r.erro) return { texto: 'ERRO: ' + r.erro + '\n' + (r.aviso ? 'aviso: ' + r.aviso + '\n' : ''), codigo: 1 };
  return { texto: JSON.stringify(r) + '\n', codigo: 0 };
}

module.exports = {
  saidaDoScript, juntarAvisos,
  ALTURA_MAXIMA, TETO_DA_LARGURA, TETO_DO_TEMPO, ITENS_MAXIMOS, TEXTO_MAXIMO, PADRAO, USO,
  lerArgs, candidatosDoNavegador, acharNavegador, enderecoDoArquivo, entradaDeConsole, erroDaPagina, erroDoLog,
  resumirAcessibilidade, alturaDaFoto, semSegredo, textoParaODisco, consoleEErrosSemSegredo, TEXTO_BRUTO,
};
