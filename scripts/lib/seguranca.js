'use strict';
// Colheita 10-20, item 17 + V7: varredura de seguranca, sem IA, de uma pasta de plugin ou skill ANTES de instalar. O
// Claude Code nao tem gancho na instalacao de plugin: o dono roda a varredura na pasta baixada. Ela lista o que pede
// atencao, com arquivo:linha e o trecho, e o que nao leu; nao da atestado de que a pasta e segura.
const fs = require('node:fs');
const path = require('node:path');
const varredura = require('./varredura.js');
const texto = require('./texto.js');

const TAMANHO_MAXIMO = 512 * 1024;
const TRECHO_MAXIMO = 160;
// A1-43: so os primeiros 8000 bytes decidem o binario (o desenho do git); byte 0 depois disso nao tira o arquivo da
// varredura, que le mais e nao menos.
const AMOSTRA_BINARIO = 8000;

// Cada regra: a categoria, o padrao e, opcional, as extensoes onde ela vale (o `exec(` do Python e outra coisa no JS).
const REGRAS = [
  { categoria: 'rede', re: /require\(\s*['"](?:node:)?(?:https?|http2|net|tls|dgram)['"]\s*\)/ },
  { categoria: 'rede', re: /\bfrom\s+['"](?:node:)?(?:https?|http2|net|tls|dgram)['"]/ },
  { categoria: 'rede', re: /\bfetch\s*\(/ },
  { categoria: 'rede', re: /\bnew\s+WebSocket\s*\(|\bXMLHttpRequest\b/ },
  { categoria: 'rede', re: /\b(?:curl|wget)\s+\S|\bInvoke-(?:WebRequest|RestMethod)\b/ },
  { categoria: 'rede', re: /^\s*(?:import|from)\s+(?:requests|urllib\d?|httpx|socket|aiohttp)\b/, ext: ['.py'] },
  { categoria: 'eval', re: /(?<![.\w])eval\s*\(/ },
  { categoria: 'eval', re: /\bnew\s+Function\s*\(/ },
  { categoria: 'eval', re: /\bvm\.(?:runIn\w+|Script)\b/ },
  { categoria: 'eval', re: /^\s*exec\s*\(/, ext: ['.py'] },
  { categoria: 'processo', re: /\bchild_process\b/ },
  { categoria: 'processo', re: /(?<![.\w])(?:exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)\s*\(/, ext: ['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx'] },
  { categoria: 'processo', re: /\bsubprocess\b|\bos\.(?:system|popen)\s*\(/, ext: ['.py'] },
  { categoria: 'processo', re: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/ },
  { categoria: 'credencial', re: /(?:^|[\\/~'"`\s(,])\.(?:ssh|aws|gnupg|kube|docker)(?=[\\/'"`\s),]|$)/ },
  { categoria: 'credencial', re: /\bid_(?:rsa|ed25519|ecdsa|dsa)\b/ },
  { categoria: 'credencial', re: /\.(?:npmrc|netrc|pypirc|git-credentials)\b/ },
  { categoria: 'credencial', re: /\bprocess\.env\.[A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD|PASS|CREDENTIAL)[A-Z0-9_]*\b/ },
  { categoria: 'credencial', re: /\bos\.environ\b.*(?:TOKEN|SECRET|KEY|PASSWORD)/, ext: ['.py'] },
  { categoria: 'credencial', re: /\bLogin Data\b|\bkeychain\b|\bsecurity\s+find-(?:generic|internet)-password\b|\bcmdkey\b/i },
  { categoria: 'fora', re: /\bos\.homedir\s*\(\)|\bprocess\.env\.(?:HOME|USERPROFILE|APPDATA|LOCALAPPDATA)\b|\bos\.path\.expanduser\b/ }
];

// Gancho que escreve fora da pasta do plugin: o comando do hooks.json com operador de escrita e um alvo em casa ou absoluto.
const ESCRITA = /(?:>>?|\btee\b|\bcp\b|\bmv\b|\brm\b|\bSet-Content\b|\bAdd-Content\b|\bOut-File\b|\bNew-Item\b)/;
const FORA = /(?:~[\\/]|\$\{?HOME\}?|%(?:USERPROFILE|APPDATA|LOCALAPPDATA)%|\$env:(?:USERPROFILE|APPDATA)|(?:^|\s)\/(?!dev\/null)\w|[A-Za-z]:\\)/;

const LIMITES = [
  'codigo ofuscado, montado em tempo de execucao ou baixado depois da instalacao nao aparece aqui',
  'binarios e arquivos maiores que ' + (TAMANHO_MAXIMO / 1024) + ' KB nao sao lidos (estao em naoLidos)',
  'as pastas que a varredura do projeto ignora (node_modules, dist, vendor e outras) nao sao lidas; o numero esta em pastasIgnoradas',
  'cada achado e um lugar para ler, nao um veredito: chamada de rede ou processo filho pode ser o que o plugin faz de proposito'
];

function cortar(linha) {
  const t = linha.trim();
  return t.length <= TRECHO_MAXIMO ? t : t.slice(0, TRECHO_MAXIMO - 3) + '...';
}

// O trecho de uma linha longa (minificado) centra no que casou, para o dono ver o que e.
function trechoDe(linha, indice) {
  if (linha.length <= TRECHO_MAXIMO) return cortar(linha);
  const ini = Math.max(0, indice - 60);
  return ('...' + linha.slice(ini, ini + TRECHO_MAXIMO - 6) + '...').slice(0, TRECHO_MAXIMO);
}

function ehGanchos(rel) {
  return /(^|\/)hooks\.json$/i.test(rel);
}

function comandosDosGanchos(json) {
  const comandos = [];
  (function andar(v) {
    if (Array.isArray(v)) { v.forEach(andar); return; }
    if (!v || typeof v !== 'object') return;
    if (typeof v.command === 'string') comandos.push(v.command);
    Object.keys(v).forEach(function (k) { andar(v[k]); });
  })(json);
  return comandos;
}

// A1-47: a linha pelo valor lido, e nao pelo texto escapado (o hooks.json pode escrever a barra com escape unicode).
// So roda depois do JSON.parse do arquivo inteiro (em varrer): ali todo `"` abre ou fecha uma string, e string de JSON
// nao atravessa linha; cada literal casado aqui e string valida, e o JSON.parse dele nao lanca.
function linhaDoValor(linhas, valor) {
  return linhas.findIndex(function (l) {
    return (l.match(/"(?:[^"\\]|\\.)*"/g) || []).some(function (s) { return JSON.parse(s) === valor; });
  });
}

/**
 * Varre a pasta e devolve { pasta, arquivosLidos, achados: [{ categoria, arquivo, linha, trecho }], resumo: { categoria: n },
 * naoLidos: [{ arquivo, motivo }], pastasIgnoradas, incompleta, corte, limites }. Uma ocorrencia por categoria e linha.
 * opcoes.limite: o teto de arquivos (padrao o da varredura do projeto); `corte` diz por que a lista saiu incompleta.
 */
function varrer(pasta, opcoes) {
  const lista = varredura.listar(pasta, opcoes && opcoes.limite);
  const achados = [];
  const naoLidos = [];
  let lidos = 0;
  for (const rel of lista.arquivos) {
    const abs = path.join(pasta, rel);
    let buf;
    try {
      const st = fs.statSync(abs);
      if (st.size > TAMANHO_MAXIMO) {
        naoLidos.push({ arquivo: rel,
          motivo: 'maior que ' + (TAMANHO_MAXIMO / 1024) + ' KB, nao foi varrido: abra e leia a mao' });
        continue;
      }
      buf = fs.readFileSync(abs);
    } catch (e) {
      naoLidos.push({ arquivo: rel, motivo: 'nao abriu (' + texto.causaDoErro(e) + '), nao foi varrido: ' +
        'libere a leitura e rode a varredura de novo' });
      continue;
    }
    if (buf.subarray(0, AMOSTRA_BINARIO).indexOf(0) !== -1) {
      naoLidos.push({ arquivo: rel,
        motivo: 'binario, nao foi varrido: confira de onde veio e para que o plugin o usa' });
      continue;
    }
    lidos++;
    const conteudo = texto.semBom(buf.toString('utf8'));
    // A1-seg-1: CR sozinho tambem e fim de linha (python e JS o aceitam); sem ele, o ^ das regras nao casava.
    const linhas = conteudo.split(/\r\n|\r|\n/);
    const ext = path.extname(rel).toLowerCase();
    linhas.forEach(function (linha, i) {
      const vistas = new Set();
      for (const regra of REGRAS) {
        if (regra.ext && regra.ext.indexOf(ext) === -1) continue;
        if (vistas.has(regra.categoria)) continue;
        const m = regra.re.exec(linha);
        if (!m) continue;
        vistas.add(regra.categoria);
        achados.push({ categoria: regra.categoria, arquivo: rel, linha: i + 1, trecho: trechoDe(linha, m.index) });
      }
    });
    if (ehGanchos(rel)) {
      let json = null;
      try { json = JSON.parse(conteudo); } catch (e) {
        naoLidos.push({ arquivo: rel, motivo: 'JSON invalido, os ganchos nao foram conferidos: abra o arquivo, corrija e ' +
          'rode a varredura de novo (' + String(e.message).slice(0, 80) + ')' });
      }
      for (const cmd of json ? comandosDosGanchos(json) : []) {
        // a pasta do plugin vira um nome sem barra na frente: escrever nela nao e escrever fora
        if (!ESCRITA.test(cmd) || !FORA.test(cmd.split('${CLAUDE_PLUGIN_ROOT}').join('RAIZ_DO_PLUGIN'))) continue;
        const n = linhaDoValor(linhas, cmd);
        achados.push({ categoria: 'gancho-fora', arquivo: rel, linha: n === -1 ? 1 : n + 1, trecho: cortar(cmd) });
      }
    }
  }
  const resumo = {};
  for (const a of achados) resumo[a.categoria] = (resumo[a.categoria] || 0) + 1;
  return { pasta: pasta, arquivosLidos: lidos, achados: achados, resumo: resumo, naoLidos: naoLidos,
    pastasIgnoradas: lista.ignoradas, incompleta: lista.incompleta,
    corte: { truncado: lista.truncado, limite: lista.limite, profundidadeCortada: lista.profundidadeCortada,
      ilegiveis: lista.ilegiveis },
    limites: LIMITES };
}

module.exports = { varrer, REGRAS, TAMANHO_MAXIMO, TRECHO_MAXIMO };
