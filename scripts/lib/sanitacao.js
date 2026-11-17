'use strict';
const fs = require('node:fs');
const path = require('node:path');
const gitLib = require('./git.js');
const texto = require('./texto.js');

/**
 * Detector de sanitacao para repositorio publico (D79, ampliado pelas D132 e D133).
 *
 * A D79 exigiu um detector por regra fixa (sem modelo de linguagem: o mesmo repositorio da sempre o mesmo
 * veredito) que rode no `npm test` e REPROVE o repositorio se qualquer classe vazar - com controle negativo
 * obrigatorio, porque "revisao manual no fim" nao garante "nao pode passar nada". A unica entrada que muda
 * de maquina para maquina e a lista de IDs de sessao do Claude Code (classe `sessao_local`), lida do disco.
 *
 * TRES superficies, e cada uma foi descoberta depois da anterior:
 *   1. conteudo e nome dos arquivos versionados  (a D79 so olhou o conteudo)
 *   2. autoria do historico                      (D132 §3: 12 commits com e-mail pessoal)
 *   3. mensagem de commit e nome de ramo ou tag  (D133: o nome de um projeto interno)
 *
 * DUAS REGRAS DE CONSTRUCAO, e as duas nascem do mesmo raciocinio:
 *
 * (a) AS ISCAS SAO MONTADAS POR CONCATENACAO. Se este arquivo tivesse o
 *     vazamento de mentira escrito por extenso, ele se acusaria a si mesmo, e o
 *     unico jeito de calar isso seria uma excecao para o proprio detector - o
 *     buraco exato por onde um vazamento de verdade passaria.
 *
 * (b) O VOCABULARIO PRIVADO NAO MORA AQUI. Nome de pessoa, de empresa e de
 *     projeto interno sao do dono, nao do detector. Se estivessem escritos neste
 *     arquivo, o detector iria para o repositorio publico levando exatamente o
 *     que existe para impedir. Eles vivem em `.sanitacao-local.json`, que o
 *     .gitignore mantem fora do git. Sem esse arquivo o detector roda so com as
 *     classes genericas - e DIZ que esta rodando assim.
 */

/** Dominios reservados por RFC 2606 / uso do GitHub: nunca sao vazamento. */
const DOMINIOS_RESERVADOS = [
  'exemplo.com', 'example.com', 'example.org', 'example.net',
  'users.noreply.github.com'
];

const ARQUIVO_LOCAL = '.sanitacao-local.json';

// O formato do ID de sessao do Claude Code, escrito uma vez: o leitor do disco e a classe sessao_local usam o mesmo.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const NOME_DE_SESSAO = new RegExp('^(' + UUID + ')\\.jsonl$', 'i');

/**
 * D597 (revisao completa, A10-01): os IDs de sessao do Claude Code desta maquina - o nome de cada transcricao em
 * <projects>/<projeto>/<id>.jsonl. Tres estados, como o vocabulario local (IN-04): pasta AUSENTE = nada a comparar;
 * pasta que existe e NAO ABRE vai para `naoLidas`, e quem chama nao pode dar limpo sobre ela.
 * Desce so um nivel abaixo de cada projeto, de proposito: e ali que o Claude Code grava a transcricao da sessao. O
 * que mora mais fundo (`<id>/subagents/agent-*.jsonl`) e de subagente, com nome que nao e ID de sessao. So conta o
 * nome com a forma de UUID: `notas.jsonl` ou um log qualquer com essa extensao nao e sessao de ninguem.
 * Devolve { ids: Set, naoLidas: [{ pasta, porQue }] }.
 */
function sessoesLocais(projetos) {
  const r = { ids: new Set(), naoLidas: [] };
  let nomes = [];
  try { nomes = fs.readdirSync(projetos); } catch (e) {
    if (!e || e.code !== 'ENOENT') r.naoLidas.push({ pasta: projetos, porQue: texto.causaDoErro(e) });
    return r;
  }
  for (const p of nomes) {
    const pasta = path.join(projetos, p);
    let arquivos = [];
    try { arquivos = fs.readdirSync(pasta); } catch (e) {
      // ENOTDIR: arquivo solto entre as pastas de projeto; ENOENT: sumiu entre as duas leituras. Nenhum e transcricao.
      if (e && e.code !== 'ENOTDIR' && e.code !== 'ENOENT') r.naoLidas.push({ pasta: pasta, porQue: texto.causaDoErro(e) });
      continue;
    }
    for (const n of arquivos) {
      const m = NOME_DE_SESSAO.exec(n);
      if (m) r.ids.add(m[1].toLowerCase());
    }
  }
  return r;
}

// Depois de ler o disco, a isca da classe `sessao_local` entra junto na lista de IDs: e assim que o autoteste prova
// o filtro sem depender de haver sessao nesta maquina. A leitura do disco se prova a parte: `naoLidas` reprova o
// autoteste e o limpo. A pasta e a do resto do plugin (CLAUDE_CONFIG_DIR ou ~/.claude).
// O cache poupa reler a pasta a cada trecho com forma de UUID, e so vale enquanto a pasta e a mesma e a leitura tem
// menos de um minuto (processo longo, como o vigia ou uma suite, ve a sessao aberta depois da primeira leitura). A
// leitura que falhou (`naoLidas`) vale so 5 segundos: a falha pode ter sido passageira, e reler a cada UUID numa
// pasta que segue falhando faria a varredura reler o disco centenas de vezes. A pasta que nem se descobre (excecao do
// pastaDosProjetos) nao entra no cache: cada consulta tenta de novo, porque nao ha pasta para guardar.
// `auditar` zera o cache ao comecar (cada auditoria parte de uma leitura fresca) e liga `falhasDaAuditoria`: toda
// leitura que falhar enquanto ele varre entra no veredito, e nao so a primeira.
// `avisos` nao trava o veredito: e o CLAUDE_CONFIG_DIR que aponta para onde nao ha `projects/`, quase sempre um
// erro de digitacao que faria a classe procurar no vazio sem ninguem saber.
const ISCA_SESSAO = '5e55a0d5-' + '9597-4000-8000-00000000d597';
const VALIDADE_DO_CACHE_MS = 60 * 1000;
const VALIDADE_DA_FALHA_MS = 5 * 1000;
let sessoesEmCache = null;
let falhasDaAuditoria = null;
function anotarFalhas(naoLidas) {
  if (falhasDaAuditoria) naoLidas.forEach(function (n) { falhasDaAuditoria.push(n); });
}
function sessoesDaMaquina() {
  let pasta;
  try { pasta = require('./gasto.js').pastaDosProjetos(); } catch (e) {
    const r = { ids: new Set([ISCA_SESSAO]), avisos: [], naoLidas: [{ pasta: 'a pasta das transcricoes do Claude Code',
      porQue: 'nao consegui descobrir onde ela fica: ' + texto.causaDoErro(e) + '; confira CLAUDE_CONFIG_DIR e a pasta pessoal' }] };
    sessoesEmCache = null;
    anotarFalhas(r.naoLidas);
    return r;
  }
  const agora = Date.now();
  const limpa = sessoesEmCache && sessoesEmCache.naoLidas.length === 0;
  const valido = sessoesEmCache && sessoesEmCache.pasta === pasta && agora >= sessoesEmCache.lidoEm &&
    agora - sessoesEmCache.lidoEm < (limpa ? VALIDADE_DO_CACHE_MS : VALIDADE_DA_FALHA_MS);
  if (!valido) {
    const avisos = [];
    if (process.env.CLAUDE_CONFIG_DIR && !fs.existsSync(pasta)) {
      // sem o valor da variavel: ele e um caminho desta maquina, e a saida do sanitar e colada como evidencia
      avisos.push('CLAUDE_CONFIG_DIR aponta para uma pasta onde nao ha a pasta projects: ' +
        'nenhum ID de sessao desta maquina foi procurado. Corrija a variavel se o nome esta errado; numa instalacao ' +
        'que ainda nao abriu sessao nenhuma, o aviso pode ser ignorado');
    }
    sessoesEmCache = Object.assign({ pasta: pasta, avisos: avisos, lidoEm: agora }, sessoesLocais(pasta));
    sessoesEmCache.ids.add(ISCA_SESSAO);
    anotarFalhas(sessoesEmCache.naoLidas);
  }
  return sessoesEmCache;
}

/**
 * Classes genericas: nao carregam vocabulario de ninguem. Valem em qualquer
 * repositorio, e e por isso que podem ser publicadas. A `sessao_local` e a unica
 * que consulta o disco (os IDs de sessao desta maquina, acima); o padrao dela
 * segue generico.
 */
const CLASSES_GENERICAS = [
  {
    chave: 'caminho_de_maquina',
    nome: 'caminho absoluto de pasta pessoal',
    // Pasta pessoal nas quatro formas: unidade + Users + <nome> no Windows, a
    // mesma sob /<letra>/Users/<nome> no Git Bash, /home/<nome> no Linux e
    // /Users/<nome> no macOS (D420/IN-05: em qualquer contexto, menos colado a
    // um nome de pasta - assim `api/Users/` de rota segue de fora). Caminho generico como /tmp ou a pasta do sistema
    // NAO entra: nao identifica ninguem, e a suite de comandos destrutivos e
    // cheia deles.
    // L1-14: so a forma do Windows ignora a caixa (o sistema de arquivos ignora:
    // c:/users e C:/USERS sao a mesma pasta). As outras seguem sensiveis, senao
    // a rota /users/42 de documentacao viraria falso positivo. D430: a letra de
    // unidade nao vem colada em outra letra (o `p:` de `http://users/42` nao e disco).
    // A4-23: o /home/ tem a mesma borda do /Users/ - `api/home/fulano` de rota nao e pasta pessoal -, menos
    // depois de /var e /usr, onde ele e a pasta pessoal do Fedora Silverblue e do FreeBSD.
    padrao: /(?:(?<![A-Za-z0-9])[A-Za-z]:[\\/]+[Uu][Ss][Ee][Rr][Ss][\\/]+|\/[a-z]\/Users\/|(?:(?<![A-Za-z0-9_.-])|(?<=\/(?:var|usr)))\/home\/|(?<![A-Za-z0-9_.-])\/Users\/)[A-Za-z0-9._-]+/g,
    isca: 'C:' + '\\Users\\' + 'fulano\\Desktop',
    controle: 'rm -rf /tmp/build && del C:' + '\\Windows\\temp'
  },
  {
    chave: 'email',
    nome: 'endereco de e-mail',
    // L1-11: o lookbehind so deixa a busca comecar na borda da corrida. Sem ele,
    // linha longa de [a-z.] sem '@' era O(n^2): cada posicao varria a corrida inteira.
    padrao: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    reservados: DOMINIOS_RESERVADOS,
    isca: 'fulano' + '@empresa.com.br',
    controle: 'teste' + '@exemplo.com'
  },
  {
    chave: 'segredo',
    nome: 'segredo, chave ou token',
    // O \b antes de sk- e o que separa uma chave de verdade de "task-completion",
    // o falso positivo que a D79 pegou no proprio instrumento dela.
    // A4-27: tambem os outros tokens do GitHub (gho_, ghs_, ghu_), a chave do Google (AIza), o token do npm, o JWT
    // (tres partes, as duas primeiras comecando em eyJ, o `{"` em base64) e o cabecalho Bearer com valor. O valor de
    // exemplo da documentacao (`Bearer SEU_TOKEN_AQUI`: palavras em maiusculas ligadas por _) nao conta; o token real em
    // hexadecimal maiusculo, sem _, conta. Cada forma tem a propria isca em `iscasExtras`: o autoteste prova todas,
    // nao so a do sk-.
    padrao: /\bsk-[A-Za-z0-9_-]{20,}|\bgh[opsu]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bAKIA[0-9A-Z]{16}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}|\bAIza[0-9A-Za-z_-]{35}|\bnpm_[A-Za-z0-9]{36}\b|\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|\bBearer\s+(?![A-Z0-9]*_[A-Z0-9_]*(?![A-Za-z0-9_]))[A-Za-z0-9._~+/-]{20,}=*|-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
    isca: 'sk-' + 'ant-api03-' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4',
    iscasExtras: [
      'gh' + 'o_' + 'a1B2c3D4e5a1B2c3D4e5', 'AI' + 'za' + 'a1B2c3D4e5a1B2c3D4e5a1B2c3D4e5f6G7h',
      'np' + 'm_' + 'a1B2c3D4e5a1B2c3D4e5a1B2c3D4e5f6G7h8',
      'ey' + 'JhbGciOiJIUzI1NiJ9.' + 'ey' + 'JzdWIiOiIxMjM0In0.' + 'abcdefghijKLMNOP', 'Bea' + 'rer ' + 'abcDEF123456ghiJKL789',
      'Bea' + 'rer ' + '9F86D081884C7D65' + '9A2FEAE0C55AD015'
    ],
    controle: 'ta' + 'sk-completion e ta' + 'sk-complexity',
    controlesExtras: ['Bea' + 'rer SEU_TOKEN_DE_ACESSO_AQUI_123', 'envie Bea' + 'rer SEU_TOKEN_DE_ACESSO_AQUI_123.', 'Bearer token', 'npm_config_cache=x', 'ghost_town']
  },
  {
    chave: 'impressao_de_maquina',
    nome: 'impressao digital da maquina',
    // A D79 declarou o proprio falso positivo; aqui ele e resolvido NA ORIGEM,
    // com padrao mais preciso, em vez de virar excecao. "/mingw64/bin/git" existe
    // em toda instalacao de Git for Windows - nao identifica ninguem. O que
    // identifica e a saida do `uname` com o numero de build.
    padrao: /MINGW64_NT-[0-9][0-9.]*|CYGWIN_NT-[0-9][0-9.]*|\b10\.0\.2[0-9]{4}\b/g,
    isca: 'MINGW64_NT-' + '10.0-26200',
    controle: '/ming' + 'w64/bin/git push origin main'
  },
  {
    chave: 'ip_privado',
    nome: 'endereco IP de rede interna',
    padrao: /\b(?:10\.(?:[0-9]{1,3}\.){2}[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3}|172\.(?:1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3})\b/g,
    isca: '192.' + '168.0.42',
    // versao semantica nao e IP: 10.0.2 tem tres campos, nao quatro
    controle: 'node 10.0.2 e a versao minima'
  },
  {
    chave: 'mac_address',
    nome: 'endereco MAC de placa de rede',
    padrao: /\b(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\b/g,
    isca: '00:' + '1A:2B:3C:4D:5E',
    controle: 'as 12:30:45 de ontem'
  },
  {
    chave: 'sid_windows',
    nome: 'identificador de usuario do Windows',
    padrao: /\bS-1-5-21-[0-9-]{10,}/g,
    isca: 'S-1-5-21-' + '1234567890-987654321-1122334455-1001',
    controle: 'S-1-5-18 e a conta de sistema'
  },
  {
    chave: 'sessao_local',
    nome: 'ID de sessao do Claude Code desta maquina',
    // D597 (revisao completa, A10-01): UUID qualquer (de exemplo, de biblioteca) nao identifica ninguem; o de uma
    // sessao com transcricao nesta maquina e do dono - um ficou na fixture publica de 0.3.4 a 0.11.1.
    // D599: sem borda de proposito. O `\b` deixava passar `sessao_<id>` (o `_` e caractere de palavra), e borda nao
    // hexadecimal deixava passar `code<id>`. Quem separa o ID do dono de UUID qualquer e o soSe, nao a borda.
    padrao: new RegExp(UUID, 'gi'),
    soSe: function (trecho) { return sessoesDaMaquina().ids.has(trecho.toLowerCase()); },
    isca: ISCA_SESSAO,
    controle: '1b4e28ba-' + '2fa1-11d2-883f-0016d3cca427'
  }
];

/** Pastas que nunca entram no repositorio publico (D132 §1.3). */
const FORA_DO_PUBLICO = ['docs/'];

function ehReservado(endereco, reservados) {
  const alvo = String(endereco).toLowerCase();
  return (reservados || []).some(function (d) {
    return alvo.endsWith('@' + d) || alvo.endsWith('.' + d);
  });
}

function excecaoVale(classe, arquivo) {
  if (!classe.excecaoEm) return false;
  const norm = String(arquivo || '').replace(/\\/g, '/');
  return classe.excecaoEm.some(function (a) { return norm === a || norm.endsWith('/' + a); });
}

// A causa do erro sem o texto do vocabulario: a mensagem do V8 copia o padrao inteiro (RegExp) ou um pedaco do
// arquivo (JSON.parse do Node 20 em diante), e o termo do dono nao sai do vocabulario nem no terminal. Do padrao fica
// o motivo; do JSON, a linha onde ele quebra, achada pela posicao ou pelo pedaco que o V8 citou (sem imprimir o pedaco).
function causaSemTermo(e, bruto) {
  if (!(e instanceof SyntaxError)) return texto.causaDoErro(e);
  const m = typeof e.message === 'string' ? e.message : '';
  if (m.indexOf('Invalid regular expression: ') === 0) return 'SyntaxError: ' + m.slice(m.lastIndexOf(': ') + 2);
  const linha = linhaDoErroDeJson(m, typeof bruto === 'string' ? bruto : '');
  if (linha) return 'SyntaxError: o JSON quebra perto da linha ' + linha + '; corrija essa linha';
  return 'SyntaxError: o JSON termina antes da hora ou tem um caractere fora do lugar';
}

// Node 20+: `... in JSON at position N (line L column C)` ou `Unexpected token 'x', ..."<pedaco>..." is not valid JSON`;
// Node 18: `Unexpected token x in JSON at position N`.
function linhaDoErroDeJson(m, bruto) {
  const linhaDe = function (i) { return bruto.slice(0, i).split('\n').length; };
  const pos = /at position (\d+)/.exec(m);
  if (pos && Number(pos[1]) <= bruto.length) return linhaDe(Number(pos[1]));
  const pedaco = /, (?:\.\.\.)?"([\s\S]*?)(?:\.\.\.)?" is not valid JSON$/.exec(m);
  if (pedaco && pedaco[1] && bruto.indexOf(pedaco[1]) !== -1) return linhaDe(bruto.indexOf(pedaco[1]));
  return null;
}

/**
 * Le o vocabulario privado, se existir. Formato:
 *   { "termos": [ { "chave":"...", "nome":"...", "padrao":"...", "flags":"gi",
 *                   "isca":"...", "controle":"...", "excecaoEm":[...] } ] }
 *
 * D420/IN-04: tres estados, e nao dois. AUSENTE e legitimo (roda so com as
 * genericas, e quem chama DIZ isso). PRESENTE E INVALIDO - JSON quebrado, sem
 * lista de termos, regex que nao compila - NAO e legitimo: o dono escreveu um
 * vocabulario e ele nao esta sendo procurado, e devolver [] calado fazia o
 * veredito sair LIMPO sobre o que nunca foi procurado. O autoteste reprova isso.
 *
 * Devolve { estado: 'ausente'|'ok'|'invalido', motivo, termos, descartados }.
 */
function lerVocabularioLocal(raiz) {
  const vazio = { termos: [], descartados: [] };
  let bruto;
  // A4-20: decodificado como os arquivos da superficie. O vocabulario gravado pelo `>` do PowerShell 5.1 sai em
  // UTF-16 com marca de inicio, e lido como utf8 ele virava "JSON invalido" sem dizer por que.
  try { bruto = decodificar(fs.readFileSync(path.join(raiz, ARQUIVO_LOCAL))); } catch (e) {
    if (e && e.code === 'ENOENT') return Object.assign({ estado: 'ausente', motivo: '' }, vazio);
    return Object.assign({ estado: 'invalido', motivo: 'nao consegui ler: ' + texto.causaDoErro(e) }, vazio);
  }
  let dados;
  try { dados = JSON.parse(texto.semBom(bruto)); } catch (e) {
    return Object.assign({ estado: 'invalido', motivo: 'o arquivo nao e JSON valido (' + causaSemTermo(e, texto.semBom(bruto)) + ')' }, vazio);
  }
  if (!dados || !Array.isArray(dados.termos)) {
    return Object.assign({ estado: 'invalido', motivo: 'falta a lista "termos"' }, vazio);
  }
  const termos = [];
  const descartados = [];
  dados.termos.forEach(function (t, i) {
    const chave = t && typeof t === 'object' && t.chave ? String(t.chave) : '(termo ' + (i + 1) + ')';
    if (!t || typeof t !== 'object' || typeof t.padrao !== 'string' || t.padrao === '') {
      descartados.push({ chave: chave, porQue: 'sem "padrao"' });
      return;
    }
    // D420/IN-03: sem o g o laco de varrerTexto nunca termina - exec() devolve
    // sempre o mesmo primeiro achado. O g nao e opcao do termo: e do instrumento.
    let flags = typeof t.flags === 'string' && t.flags !== '' ? t.flags : 'gi';
    if (flags.indexOf('g') === -1) flags += 'g';
    let re;
    // A4-22: o padrao e o texto varrido passam pela mesma forma Unicode (NFC). Sem isso, "José" escrito com o
    // acento separado da letra (como o macOS grava nome de arquivo) nao casava com o termo escrito junto.
    try { re = new RegExp(t.padrao.normalize('NFC'), flags); } catch (e) {
      descartados.push({ chave: chave, porQue: 'o "padrao" nao e uma expressao regular valida (' + causaSemTermo(e) + ')' });
      return;
    }
    // L1-16: padrao que casa texto vazio acusaria toda linha do repositorio (e
    // o laco de varrerTexto avancaria um caractere por vez). Testado em '' e em
    // um texto qualquer, para pegar tambem x* e (?=a).
    if (['', 'a b'].some(function (s) { re.lastIndex = 0; const m = re.exec(s); return m !== null && m[0] === ''; })) {
      descartados.push({ chave: chave, porQue: 'padrao casa texto vazio' });
      return;
    }
    re.lastIndex = 0;
    // L1-16: excecaoEm tem de ser lista de caminhos; string solta quebrava
    // excecaoVale (some nao e funcao de string) em toda varredura.
    if (t.excecaoEm != null && (!Array.isArray(t.excecaoEm) ||
        t.excecaoEm.some(function (e) { return typeof e !== 'string' || e === ''; }))) {
      descartados.push({ chave: chave, porQue: '"excecaoEm" precisa ser uma lista de caminhos (texto nao vazio)' });
      return;
    }
    // T-1a/#15: `chave` (do topo da funcao) ja traz o "(termo N)" quando o termo nao tem chave; usar
    // `t.chave` aqui deixava a classe `undefined` nos achados e no placar por classe.
    termos.push({
      chave: chave, nome: t.nome || chave, padrao: re,
      isca: t.isca, controle: t.controle, excecaoEm: t.excecaoEm || undefined, local: true
    });
  });
  return { estado: 'ok', motivo: '', termos: termos, descartados: descartados };
}

/** Os termos validos do vocabulario local. Quem precisa saber do resto usa lerVocabularioLocal. */
function termosLocais(raiz) {
  return lerVocabularioLocal(raiz).termos;
}

function classes(raiz) {
  return CLASSES_GENERICAS.concat(raiz ? termosLocais(raiz) : []);
}

/**
 * Varre UM texto e devolve os achados, com linha. Achado sem `arquivo:linha` nao
 * serve para conferir, e a regra anti-teatro do projeto vale aqui tambem.
 *
 * L1-s102-4: o mesmo contrato do `ilegiveis` de `varrerArquivos`. A classe `sessao_local` compara com os IDs
 * lidos do disco, e quando essa leitura falha esta funcao NAO avisa: devolve so o que achou. Quem garante
 * veredito sobre a leitura que falhou sao o `auditar` (tira o limpo) e o `autoteste` (reprova), que olham o
 * `naoLidas`; quem chama esta funcao direto e quer saber disso usa um dos dois.
 */
function varrerTexto(conteudo, arquivo, listaClasses) {
  const lista = listaClasses || CLASSES_GENERICAS;
  const achados = [];
  const linhas = String(conteudo == null ? '' : conteudo).normalize('NFC').split(/\r?\n/);
  for (let i = 0; i < linhas.length; i++) {
    for (let c = 0; c < lista.length; c++) {
      const classe = lista[c];
      if (excecaoVale(classe, arquivo)) continue;
      const re = new RegExp(classe.padrao.source, classe.padrao.flags);
      let m;
      while ((m = re.exec(linhas[i])) !== null) {
        if (classe.reservados && ehReservado(m[0], classe.reservados)) continue;
        if (classe.soSe && !classe.soSe(m[0])) continue;
        achados.push({
          classe: classe.chave, nome: classe.nome,
          arquivo: arquivo || '(texto)', linha: i + 1, trecho: m[0]
        });
        if (m[0] === '') re.lastIndex++;
      }
    }
  }
  return achados;
}

// L1-12: a saida de 1 MiB estourava em historico grande e a auditoria virava null ("o git nao respondeu"); o
// rodar do lib/git.js aceita ate 64 MiB.
function correrGit(raiz, args) {
  const r = gitLib.rodar(raiz, args);
  return gitLib.ok(r) ? r.stdout : null;
}

/**
 * A superficie que VAI para o publico: tudo que o git rastreia, menos o que a
 * D132 §1.3 tirou. Deriva do git, nunca de uma lista escrita a mao - lista a mao
 * envelhece calada e o arquivo novo entra sem ninguem olhar.
 *
 * `--cached --others --exclude-standard`, e nao `ls-files` puro, porque
 * `ls-files` puro lista SO o que ja esta rastreado. A D133 pagou por isso: a
 * primeira montagem do export saiu com 92 arquivos em vez de 95, e os que
 * faltavam eram o proprio detector e o teste dele - arquivos novos, ainda nao
 * adicionados. Detector cego justamente no arquivo recem-escrito da 'limpo'
 * sobre o que nunca leu. O --exclude-standard mantem o .gitignore valendo, e e
 * o que preserva o .sanitacao-local.json fora da varredura: o vocabulario
 * privado se acusaria inteiro.
 *
 * A4-03: `fora` omitido = FORA_DO_PUBLICO, que e regra do export do PROPRIO sworn (D132 §1.3). O `auditar` de
 * um projeto qualquer passa [], porque ali `docs/` vai a publico como o resto; `null` vale o mesmo que [].
 */
function superficiePublicavel(raiz, fora) {
  const tirar = fora === undefined ? FORA_DO_PUBLICO : (fora || []);
  // D420/IN-01: `-z`. Sem ele o git devolve nome com acento entre aspas e com
  // escape octal, o arquivo nao abre e some da varredura sem ninguem saber.
  const bruto = correrGit(raiz, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  if (bruto === null) return null;
  return bruto.split('\0').filter(function (a) {
    if (!a) return false;
    return !tirar.some(function (p) {
      return a === p.replace(/\/$/, '') || a.indexOf(p) === 0;
    });
  });
}

/**
 * Decodifica o arquivo pelo BOM. D420/IN-02: o PowerShell 5.1 grava `>` em
 * UTF-16LE com BOM, e ler isso como utf8 deixa cada letra separada por um NUL -
 * nenhum padrao casa e o arquivo passa limpo sem ter sido lido.
 */
function decodificar(buf) {
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return buf.toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
    const par = Buffer.from(buf.length % 2 === 0 ? buf : buf.subarray(0, buf.length - 1));
    return par.swap16().toString('utf16le');
  }
  return buf.toString('utf8');
}

/**
 * T-1a/#20: as duas listas sao opcionais, mas SEM `ilegiveis` o arquivo que nao abriu e pulado
 * sem nenhum aviso (e sem `naoConferidos` o binario e varrido como texto). So o `auditar` passa
 * as duas e por isso so ele garante veredito; quem chama `varrerArquivos` direto e quer saber o que
 * ficou sem leitura tem de passar as listas.
 *
 * `ilegiveis` (opcional) recebe { arquivo, porQue } de cada arquivo da superficie
 * que NAO abriu (D420/IN-01): pular calado e dizer LIMPO sobre o que nao foi lido.
 * ENOENT e EISDIR nao contam - arquivo apagado do disco mas ainda no indice, ou
 * subrepositorio, nao tem conteudo a publicar.
 * `naoConferidos` (opcional, D429/2) recebe { arquivo, porQue } dos que abriram mas
 * tem NUL (binario): sao pulados, nao varridos, e nao travam o veredito.
 */
function varrerArquivos(raiz, arquivos, listaClasses, ilegiveis, naoConferidos) {
  const achados = [];
  (arquivos || []).forEach(function (rel) {
    let conteudo;
    try { conteudo = texto.semBom(decodificar(fs.readFileSync(path.join(raiz, rel)))); } catch (e) {
      const codigo = e && e.code;
      if (ilegiveis && codigo !== 'ENOENT' && codigo !== 'EISDIR') {
        ilegiveis.push({ arquivo: rel, porQue: texto.causaDoErro(e) });
      }
      return;
    }
    // L1-17: so o BOM e reconhecido. UTF-16 sem BOM e UTF-32 decodificam como
    // utf8 com um NUL entre as letras - nenhum padrao casa e o arquivo sairia
    // limpo sem ter sido lido. Nao e detector de encoding: so nao deixa passar calado.
    // D429/2: o dono decidiu que binario PULA com aviso "nao conferido" em vez de
    // travar o veredito (antes ia a `ilegiveis`, saida 2). So pula quem pediu a lista.
    if (naoConferidos && conteudo.indexOf('\0') !== -1) {
      naoConferidos.push({ arquivo: rel, porQue: 'nao e texto que o detector saiba ler (arquivo binario, ou texto em UTF-16 sem marca de inicio ou em UTF-32); ' +
        'se for texto, salve de novo em UTF-8 para ele ser conferido' });
      return;
    }
    varrerTexto(conteudo, rel, listaClasses).forEach(function (a) {
      a.superficie = 1;
      achados.push(a);
    });
  });
  return achados;
}

/**
 * A4-26: o NOME do arquivo tambem vai a publico, e nenhum detector de conteudo o le (`relatorio-<cliente>.md`,
 * `C:\Users\<nome>` gravado como pasta por engano). Achado da superficie 1, no proprio arquivo, linha 0.
 */
function varrerNomes(arquivos, listaClasses) {
  const achados = [];
  (arquivos || []).forEach(function (rel) {
    varrerTexto(rel, rel, listaClasses).forEach(function (a) {
      achados.push(Object.assign(a, { superficie: 1, linha: 0, nome: a.nome + ' (no nome do arquivo)' }));
    });
  });
  return achados;
}

/**
 * A4-26: nome de ramo e de tag sobe no push como a mensagem de commit (`cliente-fulano`, `fix-<projeto interno>`).
 * Superficie 3, a do historico, linha 0 como o nome de arquivo (o achado esta no nome). Devolve null quando o git
 * nao responde.
 */
function refsDoRepositorio(raiz) {
  const bruto = correrGit(raiz, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/tags']);
  if (bruto === null) return null;
  return bruto.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
}

function varrerRefs(refs, listaClasses) {
  const achados = [];
  (refs || []).forEach(function (ref) {
    varrerTexto(ref, null, listaClasses).forEach(function (a) {
      achados.push({ superficie: 3, classe: a.classe, nome: a.nome, arquivo: '(nome de ramo ou tag ' + ref + ')', linha: 0, trecho: a.trecho });
    });
  });
  return achados;
}

/**
 * Superficie 2 (D132 §3): autoria do historico. Recebe as linhas ja lidas, para
 * poder ser testada sem repositorio - funcao pura em cima de string.
 *
 * A4-02: o NOME (o que vem antes do `<`) e publico no GitHub como o e-mail, e passa pelas mesmas classes da
 * superficie 3 (`listaClasses`; omitida = as genericas). Sem isso, nome do dono com e-mail noreply saia limpo.
 */
function varrerAutores(linhas, listaClasses) {
  const achados = [];
  (linhas || []).forEach(function (linha, i) {
    const m = String(linha).match(/<([^>]+)>/);
    const antesDoEmail = m ? String(linha).slice(0, m.index) : String(linha);
    varrerTexto(antesDoEmail, null, listaClasses).forEach(function (a) {
      achados.push({
        superficie: 2,
        classe: a.classe, nome: a.nome,
        arquivo: '(historico do git)', linha: i + 1, trecho: a.trecho
      });
    });
    if (!m) return;
    if (ehReservado(m[1], DOMINIOS_RESERVADOS)) return;
    achados.push({
      superficie: 2,
      classe: 'autoria_do_historico', nome: 'e-mail no metadado de commit',
      arquivo: '(historico do git)', linha: i + 1, trecho: m[1]
    });
  });
  return achados;
}

/**
 * Superficie 3 (D133): a mensagem de commit. Fica no repositorio publico para
 * sempre e nenhum detector de CONTEUDO a le - foi assim que o nome de um projeto
 * interno do dono quase saiu junto, escrito numa mensagem de commit.
 */
function varrerMensagens(mensagens, listaClasses) {
  const achados = [];
  (mensagens || []).forEach(function (msg, i) {
    varrerTexto(msg.texto == null ? msg : msg.texto, null, listaClasses).forEach(function (a) {
      achados.push({
        superficie: 3,
        classe: a.classe, nome: a.nome,
        arquivo: '(mensagem de commit ' + (msg.sha || i + 1) + ')',
        linha: a.linha, trecho: a.trecho
      });
    });
  });
  return achados;
}

/**
 * Repositorio que EXISTE mas ainda nao tem commit nenhum. `git log` sai com 128
 * ali, e tratar isso como 'o git nao respondeu' conflacionaria duas coisas
 * opostas: NAO SEI (que tem de virar saida 2) e NAO HA NADA (que e limpo, e
 * verdade). O export recem-montado e exatamente esse caso - ele e auditado
 * ANTES do primeiro commit, que e quando a auditoria ainda serve para alguma
 * coisa. `rev-list -n 1 --all` responde 0 com saida vazia nesse estado.
 */
function semCommits(raiz) {
  const bruto = correrGit(raiz, ['rev-list', '-n', '1', '--all']);
  return bruto !== null && String(bruto).trim() === '';
}

// A4-25: `--all` nas duas leituras do historico. Sem ele so o ramo atual era lido, e o ramo ou tag que sobe no
// push junto (ou que o dono troca depois) levava autoria e mensagem que ninguem conferiu.
function autoresDoHistorico(raiz) {
  const bruto = correrGit(raiz, ['log', '--all', '--format=%an <%ae>%n%cn <%ce>']);
  if (bruto === null) return semCommits(raiz) ? [] : null;
  const vistos = Object.create(null);
  bruto.split(/\r?\n/).forEach(function (l) { if (l.trim()) vistos[l.trim()] = true; });
  return Object.keys(vistos);
}

/**
 * R3f (pedido do dono): a identidade que assinaria o proximo commit em `raiz`, como `nome <email>` (autor e
 * committer, sem repetir). O export e auditado ANTES do primeiro commit, e o historico nao mostra quem vai assinar:
 * foi assim que a 0.24.0 saiu com o nome do dono. `git var` resolve como o commit resolve (variavel de ambiente,
 * config local, global). Sem nada configurado o git NAO falha: inventa a identidade com o nome completo da conta do
 * sistema e o nome da maquina (medido no Windows, git 2.53), e ela passa pela conferencia como qualquer outra.
 * Devolve null (NAO SEI, saida 2) quando o git nao responde ou responde fora do formato; [] so quando o git recusa
 * por identidade desconhecida (`user.useConfigOnly`), caso em que o commit tambem nao sai.
 */
function identidadeDoProximoCommit(raiz) {
  const vistos = Object.create(null);
  for (const v of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']) {
    // LC_ALL=C: a recusa por identidade desconhecida e reconhecida pelo texto, e o git traduzido (pt_BR) a mudaria
    const r = gitLib.rodar(raiz, ['var', v], { env: { LC_ALL: 'C', LANGUAGE: '' } });
    if (!r || r.error || typeof r.stdout !== 'string') return null;
    if (r.status !== 0) {
      if (/identity unknown|no (email|name) was given|empty ident name/i.test(String(r.stderr || ''))) continue;
      return null;
    }
    // "Nome <email> 1731400000 -0300": tira a data e o fuso do fim
    const m = r.stdout.trim().match(/^(.*>)\s+\d+\s+[+-]\d{4}$/);
    if (!m) return null;
    vistos[m[1]] = true;
  }
  return Object.keys(vistos);
}

const SEP = '\u0001SWORN\u0001';

function mensagensDoHistorico(raiz) {
  const bruto = correrGit(raiz, ['log', '--all', '--format=%H%n%B' + SEP]);
  if (bruto === null) return semCommits(raiz) ? [] : null;
  return bruto.split(SEP).map(function (bloco) {
    const linhas = bloco.replace(/^\r?\n/, '').split(/\r?\n/);
    const sha = (linhas.shift() || '').trim();
    return sha ? { sha: sha.slice(0, 7), texto: linhas.join('\n') } : null;
  }).filter(Boolean);
}

/**
 * AUTOTESTE - controle positivo E negativo, por classe.
 *
 * "Passar nao e prova. O controle negativo e." (D130 §5.2). Um detector que nunca
 * acusa nada devolve "limpo" para qualquer repositorio, e essa e a unica saida
 * que ninguem confere. Por isso: cada classe planta o proprio vazamento de
 * mentira e TEM de pega-lo, e recebe um quase-acerto que NAO pode acusar.
 * Falhou um dos dois: aborta sem veredito.
 */
function autoteste(raiz) {
  const lista = classes(raiz);
  const falhas = [];
  // D420/IN-04: vocabulario presente e quebrado nao pode terminar em veredito.
  const vocab = raiz ? lerVocabularioLocal(raiz) : { estado: 'ausente', descartados: [] };
  if (vocab.estado === 'invalido') {
    falhas.push({ classe: 'vocabulario_local', tipo: 'arquivo local', porQue: ARQUIVO_LOCAL + ' presente mas invalido (' + vocab.motivo + '): o vocabulario privado NAO esta sendo procurado' });
  }
  vocab.descartados.forEach(function (d) {
    falhas.push({ classe: d.chave, tipo: 'termo descartado', porQue: d.porQue + ' em ' + ARQUIVO_LOCAL + ': esse termo NAO esta sendo procurado' });
  });
  sessoesDaMaquina().naoLidas.forEach(function (n) {
    falhas.push({ classe: 'sessao_local', tipo: 'leitura do disco', porQue: 'nao consegui ler ' + n.pasta + ' (' + n.porQue + '): os IDs de sessao dela NAO estao sendo procurados' });
  });
  lista.forEach(function (classe) {
    if (!classe.isca || !classe.controle) {
      falhas.push({ classe: classe.chave, tipo: 'estrutura', porQue: 'classe sem isca ou sem controle' });
      return;
    }
    const iscas = [classe.isca].concat(classe.iscasExtras || []);
    iscas.forEach(function (isca, i) {
      const pegou = varrerTexto(isca, 'isca.txt', lista)
        .filter(function (a) { return a.classe === classe.chave; });
      if (pegou.length === 0) {
        // a posicao, nao o texto: a isca de um termo local e o proprio termo do dono
        falhas.push({ classe: classe.chave, tipo: 'controle positivo', porQue: 'a isca plantada NAO foi acusada' +
          (iscas.length > 1 ? ' (a ' + (i + 1) + 'a das ' + iscas.length + ' iscas da classe)' : '') });
      }
    });
    [classe.controle].concat(classe.controlesExtras || []).forEach(function (controle) {
      const fp = varrerTexto(controle, 'controle.txt', lista)
        .filter(function (a) { return a.classe === classe.chave; });
      if (fp.length > 0) {
        falhas.push({ classe: classe.chave, tipo: 'controle negativo', porQue: 'acusou o quase-acerto: ' + fp[0].trecho });
      }
    });
  });

  if (varrerAutores(['Fulano <fulano' + '@gmail.com>']).length === 0) {
    falhas.push({ classe: 'autoria_do_historico', tipo: 'controle positivo', porQue: 'e-mail de autor nao foi acusado' });
  }
  if (varrerAutores(['Fulano <1234+fulano' + '@users.noreply.github.com>']).length > 0) {
    falhas.push({ classe: 'autoria_do_historico', tipo: 'controle negativo', porQue: 'acusou o noreply do GitHub' });
  }
  if (varrerAutores(['C:' + '\\Users\\' + 'fulano <1234+fulano' + '@users.noreply.github.com>'], lista).length === 0) {
    falhas.push({ classe: 'autoria_do_historico', tipo: 'controle positivo', porQue: 'nome de autor nao foi acusado' });
  }
  const iscaMsg = varrerMensagens([{ sha: 'abc', texto: 'ajusta ' + 'C:' + '\\Users\\' + 'fulano\\x' }], lista);
  if (iscaMsg.length === 0) {
    falhas.push({ classe: 'mensagem_de_commit', tipo: 'controle positivo', porQue: 'vazamento na mensagem nao foi acusado' });
  }
  if (varrerNomes(['relatorio-fulano' + '@empresa.com.br.md'], lista).length === 0) {
    falhas.push({ classe: 'nome_de_arquivo', tipo: 'controle positivo', porQue: 'vazamento no nome do arquivo nao foi acusado' });
  }
  if (varrerNomes(['docs/relatorio-mensal.md'], lista).length > 0) {
    falhas.push({ classe: 'nome_de_arquivo', tipo: 'controle negativo', porQue: 'acusou um nome de arquivo sem vazamento' });
  }
  if (varrerRefs(['cliente-fulano' + '@empresa.com.br'], lista).length === 0) {
    falhas.push({ classe: 'nome_de_ramo_ou_tag', tipo: 'controle positivo', porQue: 'vazamento no nome do ramo nao foi acusado' });
  }
  if (varrerRefs(['main', 'v1.0.0'], lista).length > 0) {
    falhas.push({ classe: 'nome_de_ramo_ou_tag', tipo: 'controle negativo', porQue: 'acusou um nome de ramo ou tag sem vazamento' });
  }
  if (vocabularioNaSuperficie(['README.md', ARQUIVO_LOCAL, 'pacote/' + ARQUIVO_LOCAL]).length !== 2) {
    falhas.push({ classe: 'vocabulario_local_publico', tipo: 'controle positivo', porQue: ARQUIVO_LOCAL + ' na superficie nao foi acusado' });
  }
  if (vocabularioNaSuperficie(['README.md', 'docs/' + ARQUIVO_LOCAL + '.exemplo']).length > 0) {
    falhas.push({ classe: 'vocabulario_local_publico', tipo: 'controle negativo', porQue: 'acusou um arquivo que nao e o vocabulario local' });
  }

  return {
    ok: falhas.length === 0,
    // T-1a/#18: `testadas` = as classes (genericas + locais, cada uma com isca e controle) MAIS as quatro
    // superficies fora de classe: a autoria do historico, a mensagem de commit, o nome de arquivo e o nome de ramo. Por
    // isso o numero passa de `genericas + locais` em 4 (conferido em `sanitar.js`, que imprime os tres). O controle
    // do vocabulario na superficie publica e uma guarda do proprio vocabulario e nao entra na conta. As
    // checagens do vocabulario local (arquivo invalido, termo descartado) nao entram na conta: so
    // geram falha, nao tem isca nem controle proprios.
    testadas: lista.length + 4,
    genericas: CLASSES_GENERICAS.length,
    locais: lista.length - CLASSES_GENERICAS.length,
    falhas: falhas
  };
}

// A4-30: o vocabulario privado na superficie e o vazamento inteiro de uma vez (ele lista os termos do dono). Fica
// fora so pelo .gitignore; num projeto que nao o ignora, ele e achado, nunca tirado da lista calado - tirar
// esconderia justamente o arquivo que mais vaza. Vale em qualquer pasta (a copia num subpacote vaza igual). Linha 0
// como o nome de arquivo, mas o conserto e o .gitignore.
function vocabularioNaSuperficie(arquivos) {
  return arquivos.filter(function (a) { return a === ARQUIVO_LOCAL || a.endsWith('/' + ARQUIVO_LOCAL); })
    .map(function (a) {
      return {
        superficie: 1, classe: 'vocabulario_local_publico', nome: 'vocabulario privado do detector na superficie publica',
        arquivo: a, linha: 0, trecho: a + ' (ponha no .gitignore)'
      };
    });
}

/** Varredura completa das TRES superficies. Devolve null se o git nao respondeu. */
function auditar(raiz) {
  // T-1a/#13: o vocabulario local invalido (ou com termo descartado) NAO foi procurado, entao o
  // veredito nao pode sair limpo mesmo quando quem chama nao rodou o `autoteste` antes (o `sanitar.js`
  // roda; API e teste direto nao).
  const vocab = lerVocabularioLocal(raiz);
  // cada auditoria parte de uma leitura fresca da pasta das sessoes: o cache so poupa a releitura dentro dela. Sem
  // isso, a sessao aberta entre duas auditorias do mesmo processo ficava fora por ate um minuto.
  sessoesEmCache = null;
  falhasDaAuditoria = [];
  try { return auditarComFalhas(raiz, vocab); } finally { falhasDaAuditoria = null; }
}

function auditarComFalhas(raiz, vocab) {
  const vocabularioOk = vocab.estado !== 'invalido' && vocab.descartados.length === 0;
  const sessoes = sessoesDaMaquina(); // leitura fresca (o auditar zerou o cache), que anota a propria falha
  const lista = CLASSES_GENERICAS.concat(vocab.termos);
  const arquivos = superficiePublicavel(raiz, []);
  if (arquivos === null) return null;
  const autores = autoresDoHistorico(raiz);
  if (autores === null) return null;
  const mensagens = mensagensDoHistorico(raiz);
  if (mensagens === null) return null;
  const identidade = identidadeDoProximoCommit(raiz);
  if (identidade === null) return null;
  const refs = refsDoRepositorio(raiz);
  if (refs === null) return null;

  const ilegiveis = [];
  const naoConferidos = [];
  const achados = vocabularioNaSuperficie(arquivos)
    .concat(varrerArquivos(raiz, arquivos, lista, ilegiveis, naoConferidos))
    .concat(varrerNomes(arquivos, lista))
    .concat(varrerAutores(autores, lista))
    .concat(varrerAutores(identidade, lista).map(function (a) {
      return Object.assign(a, { arquivo: '(identidade do proximo commit)' });
    }))
    .concat(varrerMensagens(mensagens, lista))
    .concat(varrerRefs(refs, lista));

  // a leitura dos IDs de sessao pode ter sido refeita no meio da varredura: vale toda falha que houve, sem repetir
  const vistas = Object.create(null);
  const naoLidas = falhasDaAuditoria.filter(function (n) {
    const k = n.pasta + '\0' + n.porQue;
    if (vistas[k]) return false;
    vistas[k] = true;
    return true;
  });

  const porClasse = Object.create(null);
  achados.forEach(function (a) { porClasse[a.classe] = (porClasse[a.classe] || 0) + 1; });

  // O placar por superficie nao e enfeite: a decisao 13 do plano so faz sentido
  // se der para separar o CONTEUDO - que reprova a suite - da autoria e das
  // mensagens, que so existem no historico e por isso saem por comando.
  const porSuperficie = { 1: 0, 2: 0, 3: 0 };
  achados.forEach(function (a) { porSuperficie[a.superficie] = (porSuperficie[a.superficie] || 0) + 1; });

  return {
    arquivos: arquivos.length,
    commits: mensagens.length,
    classesGenericas: CLASSES_GENERICAS.length,
    classesLocais: lista.length - CLASSES_GENERICAS.length,
    comVocabularioLocal: lista.length > CLASSES_GENERICAS.length,
    ilegiveis: ilegiveis,
    naoConferidos: naoConferidos,
    achados: achados, porClasse: porClasse, porSuperficie: porSuperficie,
    vocabulario: { estado: vocab.estado, motivo: vocab.motivo, descartados: vocab.descartados },
    sessoes: { naoLidas: naoLidas, avisos: sessoes.avisos },
    limpo: achados.length === 0 && ilegiveis.length === 0 && vocabularioOk && naoLidas.length === 0
  };
}

module.exports = {
  CLASSES_GENERICAS, FORA_DO_PUBLICO, ARQUIVO_LOCAL, termosLocais, lerVocabularioLocal, sessoesLocais, classes,
  varrerTexto, varrerArquivos, varrerNomes, varrerAutores, varrerMensagens, varrerRefs, superficiePublicavel, semCommits,
  autoresDoHistorico, identidadeDoProximoCommit, mensagensDoHistorico, refsDoRepositorio, auditar, autoteste
};
