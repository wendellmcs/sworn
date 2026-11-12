'use strict';
// C2 (R-EGM, google/elephant-goldfish-model): a conferencia mecanica do plano antes de codar. O original so pede ao
// modelo "Check every one" (agents/codebase_details.md:48); aqui o script le o que o plano cita e confere no disco:
// o caminho entre crases existe (ou a linha diz que ele sera criado), o simbolo citado logo depois do caminho aparece
// no arquivo, o script do comando `node ...`/`npm run ...` existe, e cada caixa aberta traz um comando de prova. O
// achado "nao existe" sai daqui, com a linha; o revisor cego julga o resto.
const fs = require('node:fs');
const path = require('node:path');

const CRASE = /`([^`\n]+)`/g;
// a linha que diz que o arquivo ainda vai nascer
const CRIAR = /\b(?:cri(?:ar|a|ado|ada|ados|adas)|nov[oa]s?|new|create[sd]?)\b/i;
const COMANDO = /^(?:node|npm|npx|pnpm|yarn|git|python3?|pytest|cargo|go|make|bash|sh)(?:\s|$)/;
const SIMBOLO = /^[A-Za-z_$][\w$]*(?:\(\))?$/;
// so separador entre o caminho e o simbolo: `a.js` -> `f`, `a.js`: `f`, `a.js` (`f`)
const ENTRE_CAMINHO_E_SIMBOLO = /^\s*(?:->|\u2192|:|#|\(|\.)?\s*$/;
const CAIXA_ABERTA = /^(\s*)- \[ \]\s/;
const ITEM = /^\s*[-*]\s/;

// a extensao de arquivo de verdade: sem ela, `os.remove` e `x-ai/grok-4.7` nao sao arquivo
const EXTENSAO = new RegExp('\\.(?:[cm]?js|jsx|tsx?|json|md|txt|ya?ml|toml|py|sh|ps1|css|scss|html?|svg|png|jpe?g|' +
  'lock|ini|cfg|xml|csv|sql|go|rs|java|rb|php|vue|astro|c|h|cpp)$', 'i');

/**
 * A linha que abre ou fecha um bloco de codigo: o novo estado da cerca (o marcador aberto, ou null ao fechar), ou
 * undefined se a linha nao mexe nela. Como no CommonMark: 3 ou mais ``` ou ~~~; fecha so o mesmo caractere, com o
 * comprimento igual ou maior e nada depois (a cerca de 4 crases mostra um bloco de 3 dentro dela).
 */
function virarCerca(aberta, l) {
  const c = /^\s*(`{3,}|~{3,})(.*)$/.exec(l);
  if (!c) return undefined;
  // a abertura com crase nao leva crase no resto da linha: `````a` `` e codigo em linha, nao bloco
  if (aberta === null) return c[1][0] === '`' && c[2].indexOf('`') !== -1 ? undefined : c[1];
  return c[1][0] === aberta[0] && c[1].length >= aberta.length && !c[2].trim() ? null : undefined;
}

/**
 * O texto entre crases e um caminho do repositorio: relativo, sem espaco nem curinga, e com a extensao de arquivo ou
 * (com barra) a pasta de cima existindo na raiz.
 */
function ehCaminho(t, raiz) {
  // a letra com acento conta (`ação.md`); espaco, curinga e marcador nao
  if (!/^[\p{L}\p{N}_./-]+$/u.test(t)) return false;
  if (/^(?:-|\.\.?$|\/)/.test(t) || /:\/\//.test(t)) return false;
  // o caminho que sobe ("..") sai da raiz: nao e do repositorio, e nao se le
  if (/(?:^|\/)\.\.(?:\/|$)/.test(t)) return false;
  if (EXTENSAO.test(t)) return true;
  const topo = t.split('/')[0];
  return t.indexOf('/') !== -1 && Boolean(topo) && fs.existsSync(path.join(raiz, topo));
}

/**
 * Onde o caminho citado existe: na raiz, na pasta do proprio plano, ou como sufixo de um arquivo do repositorio (o
 * nome curto); null se em nenhum.
 */
function ondeExiste(t, raiz, opcoes) {
  if (fs.existsSync(path.join(raiz, t))) return path.join(raiz, t);
  if (opcoes.pasta && fs.existsSync(path.join(opcoes.pasta, t))) return path.join(opcoes.pasta, t);
  const f = (opcoes.arquivos || []).filter(function (a) { return a === t || a.endsWith('/' + t); })[0];
  return f ? path.join(raiz, f) : null;
}

function lerOuNull(arquivo) {
  try { return fs.readFileSync(arquivo, 'utf8'); } catch (e) { return null; }
}

/** O comando citado: o script do `node <script>` e o do `npm run <x>`/`npm test` existem; os outros so contam. */
function conferirComando(t, raiz) {
  // marcador (<x>) ou curinga: o comando so conta, nao se confere
  if (/[<>*?]/.test(t)) return null;
  const partes = t.split(/\s+/);
  if (partes[0] === 'node') {
    const script = partes.slice(1).filter(function (p) { return !p.startsWith('-'); })[0];
    if (!script || !/\.[cm]?js$/.test(script)) return null;
    return fs.existsSync(path.join(raiz, script)) ? null : 'o script ' + script + ' nao existe: corrija o comando';
  }
  if (partes[0] === 'npm') {
    const nome = partes[1] === 'run' ? partes[2] : ['test', 'start'].indexOf(partes[1]) !== -1 ? partes[1] : null;
    if (!nome) return null;
    // cada falha do package.json diz a sua causa: "nao tem o script" so quando ele foi lido de verdade
    const arquivo = path.join(raiz, 'package.json');
    if (!fs.existsSync(arquivo)) return 'nao ha package.json na pasta: o npm nao acha o script ' + nome;
    const bruto = lerOuNull(arquivo);
    if (bruto === null) return 'nao consegui ler o package.json (pasta ou sem permissao): confira o arquivo';
    let scripts;
    try {
      scripts = (JSON.parse(bruto) || {}).scripts || {};
    } catch (e) {
      return 'o package.json nao e JSON valido: confira o arquivo';
    }
    return Object.prototype.hasOwnProperty.call(scripts, nome) ? null
      : 'o package.json nao tem o script ' + nome + ': corrija o comando';
  }
  return null;
}

/**
 * Confere o plano contra o disco da raiz. { citados, conferidos, achados: [{ tipo, valor, linha, motivo }] }; tipos:
 * caminho-inexistente, simbolo-ausente, comando-sem-script, caixa-sem-prova. O bloco de codigo (```) fica de fora.
 * opcoes: { pasta } (a do plano: o plano irmao citado so pelo nome) e { arquivos } (os do repositorio, para o nome
 * curto como `saude.js` ou o caminho de fixture como `saida/util.js`).
 */
function conferir(texto, raiz, opcoes) {
  const op = opcoes || {};
  const linhas = String(texto).replace(/\r\n?/g, '\n').split('\n');
  const achados = [];
  let citados = 0;
  let conferidos = 0;
  // o que fica no bloco de codigo nao e citacao nem passo
  let cerca = null;
  const tokens = [];
  const naCerca = [];
  linhas.forEach(function (l, i) {
    const nova = virarCerca(cerca, l);
    if (nova !== undefined) {
      cerca = nova;
      tokens.push([]);
      naCerca.push(true);
      return;
    }
    naCerca.push(cerca !== null);
    if (cerca !== null) { tokens.push([]); return; }
    const daLinha = [];
    let m;
    CRASE.lastIndex = 0;
    while ((m = CRASE.exec(l)) !== null) daLinha.push({ t: m[1], ini: m.index, fim: m.index + m[0].length });
    tokens.push(daLinha);
    const criar = CRIAR.test(l);
    daLinha.forEach(function (k, j) {
      if (COMANDO.test(k.t)) {
        citados++;
        const motivo = conferirComando(k.t, raiz);
        if (motivo) achados.push({ tipo: 'comando-sem-script', valor: k.t, linha: i + 1, motivo: motivo });
        else conferidos++;
        return;
      }
      if (!ehCaminho(k.t, raiz)) return;
      citados++;
      const arquivo = ondeExiste(k.t, raiz, op);
      if (!arquivo && !criar) {
        achados.push({ tipo: 'caminho-inexistente', valor: k.t, linha: i + 1,
          motivo: 'nao existe e a linha nao diz que sera criado: corrija o caminho ou escreva "criar" na linha' });
        return;
      }
      conferidos++;
      const prox = daLinha[j + 1];
      if (!prox || !SIMBOLO.test(prox.t) || !ENTRE_CAMINHO_E_SIMBOLO.test(l.slice(k.fim, prox.ini))) return;
      citados++;
      const nome = prox.t.replace(/\(\)$/, '');
      // o arquivo que vai nascer: o simbolo nasce com ele
      if (!arquivo) { conferidos++; return; }
      const corpo = lerOuNull(arquivo);
      if (corpo === null) {
        // existe e nao se le (uma pasta, sem permissao): o simbolo nao foi conferido, e isso nao passa calado
        achados.push({ tipo: 'simbolo-ausente', valor: nome, linha: i + 1,
          motivo: 'nao consegui ler ' + k.t + ' (pasta ou sem permissao): aponte o arquivo que tem o simbolo' });
        return;
      }
      if (new RegExp('(^|[^\\w$])' + nome.replace(/\$/g, '\\$') + '([^\\w$]|$)').test(corpo)) conferidos++;
      else {
        achados.push({ tipo: 'simbolo-ausente', valor: nome, linha: i + 1,
          motivo: 'nao aparece em ' + k.t + ': corrija o nome no plano ou aponte o arquivo certo' });
      }
    });
  });
  // cada caixa aberta com um comando de prova, na linha ou na continuacao (mais recuada, ate o proximo item)
  linhas.forEach(function (l, i) {
    const m = naCerca[i] ? null : CAIXA_ABERTA.exec(l);
    if (!m) return;
    let prova = tokens[i].some(function (k) { return COMANDO.test(k.t); });
    for (let j = i + 1; !prova && j < linhas.length; j++) {
      const c = linhas[j];
      if (!c.trim() || ITEM.test(c) || c.search(/\S/) <= m[1].length) break;
      prova = tokens[j].some(function (k) { return COMANDO.test(k.t); });
    }
    if (!prova) {
      achados.push({ tipo: 'caixa-sem-prova', valor: l.trim(), linha: i + 1,
        motivo: 'o passo nao traz o comando que o prova: ponha o comando entre crases na linha' });
    }
  });
  achados.sort(function (a, b) { return a.linha - b.linha; });
  return { citados: citados, conferidos: conferidos, achados: achados };
}

module.exports = { conferir, EXTENSAO, virarCerca };
