'use strict';
// H10c (D884, D889): o roteiro de passos da captura de tela (`capturar-tela.js --passos <roteiro.json>`). Depois da
// carga, a captura clica, digita, espera e confere pela arvore de acessibilidade - o papel e o nome, os mesmos que o
// evidencia.json lista em `acessibilidade` - e so entao tira a foto. Ideia do Playwright MCP (as acoes por papel e
// nome, `backend/snapshot.ts`; as asserções, `backend/verify.ts`; o codigo gravado, `backend/codegen.ts`), aqui com
// o rastro e as conferencias somados por script, o que la cada asserção so devolve "Done" ou erro.
//
// O roteiro: { "passos": [ { "acao": "clicar" | "digitar" | "esperar" | "conferir", ... } ] }
//   clicar   papel, [nome], [ordem], [tempoMax]
//   digitar  papel, [nome], texto, [ordem], [tempoMax]   (troca o que o campo tinha pelo texto)
//   esperar  papel, [nome], [valor], [ordem]  ou  texto; [tempoMax]   (falhou: o roteiro para)
//   conferir papel, [nome], [valor], [ordem]  ou  texto; [tempoMax]   (falhou: fica no rastro, e o roteiro segue)
// O tempoMax e em milissegundos (o padrao, 5000, e 5 s).
// Aqui so a parte pura: ler e validar, escolher o elemento, o ponto do clique, o valor e a soma. O navegador fica no
// capturar-tela.js.
const fs = require('node:fs');
const crypto = require('node:crypto');
const captura = require('./captura.js');

const ACOES = ['clicar', 'digitar', 'esperar', 'conferir'];
// As chaves de cada acao; o resto e erro (o "nmoe" digitado errado nao vira um passo que ignora o nome).
const CHAVES = {
  clicar: ['acao', 'papel', 'nome', 'ordem', 'tempoMax'],
  digitar: ['acao', 'papel', 'nome', 'texto', 'ordem', 'tempoMax'],
  esperar: ['acao', 'papel', 'nome', 'valor', 'ordem', 'texto', 'tempoMax'],
  conferir: ['acao', 'papel', 'nome', 'valor', 'ordem', 'texto', 'tempoMax'],
};
// Quanto cada passo espera o elemento (ou o texto, ou o valor) aparecer: o padrao das asserções do Playwright.
const PRAZO_DO_PASSO = 5000;
const TETO_DE_PASSOS = 200;
const TETO_DA_ORDEM = 1000;
const TETO_DO_TEXTO = 10000;
const TETO_DO_ARQUIVO = 1024 * 1024;
const EXEMPLO = ' (exemplo: { "passos": [ { "acao": "clicar", "papel": "button", "nome": "Entrar" } ] })';

// `opcional`: a chave que o passo pode deixar de fora (o nome); a que ele precisa so pede o texto.
function texto(numero, chave, v, teto, opcional) {
  if (typeof v !== 'string') return { erro: numero + '"' + chave + '" e um texto' };
  if (!v.trim()) {
    return { erro: numero + '"' + chave + '" vazio: ' + (opcional ? 'tire a chave ou escreva o ' : 'escreva o ') + chave };
  }
  // caracteres, nao unidades UTF-16: o emoji conta um, como no `caracteres` do rastro
  if (Array.from(v).length > teto) return { erro: numero + '"' + chave + '" passa de ' + teto + ' caracteres' };
  return { valor: v };
}

function inteiro(numero, chave, v, teto, unidade) {
  if (!Number.isInteger(v) || v < 1 || v > teto) {
    return { erro: numero + '"' + chave + '" e um numero inteiro de 1 a ' + teto + (unidade ? ' ' + unidade : '') +
      ', e veio ' + JSON.stringify(v) };
  }
  return { valor: v };
}

// Um passo do roteiro, validado: { passo } normalizado, ou { erro } com o numero do passo e o que consertar.
function lerPasso(p, i) {
  const numero = 'passo ' + (i + 1) + ': ';
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { erro: numero + 'cada passo e um objeto' + EXEMPLO };
  const acao = p.acao;
  if (acao === undefined) return { erro: numero + 'falta "acao" (clicar, digitar, esperar ou conferir)' };
  if (!ACOES.includes(acao)) {
    return { erro: numero + '"acao" e clicar, digitar, esperar ou conferir, e veio ' + JSON.stringify(acao) };
  }
  for (const k of Object.keys(p)) {
    if (!CHAVES[acao].includes(k)) {
      return { erro: numero + 'chave desconhecida "' + k + '" (as de ' + acao + ': ' + CHAVES[acao].slice(1).join(', ') + ')' };
    }
  }
  const comPapel = Object.hasOwn(p, 'papel');
  const comTexto = Object.hasOwn(p, 'texto');
  if (acao === 'clicar' || acao === 'digitar') {
    if (!comPapel) return { erro: numero + acao + ' precisa de "papel" (o papel do elemento na arvore, como button ou textbox)' };
    if (acao === 'digitar' && !comTexto) return { erro: numero + 'digitar precisa de "texto" (o que escrever no campo)' };
  } else {
    if (!comPapel && !comTexto) {
      return { erro: numero + acao + ' precisa de "papel" (o elemento) ou de "texto" (o texto visivel da pagina)' };
    }
    if (comPapel && comTexto) return { erro: numero + acao + ' usa "papel" ou "texto", nao os dois: separe em dois passos' };
    const soComPapel = ['nome', 'valor', 'ordem'].filter(function (k) { return Object.hasOwn(p, k); });
    if (comTexto && soComPapel.length) {
      return { erro: numero + '"' + soComPapel.join('", "') + '" so vale(m) com "papel": tire essa(s) chave(s), ou troque ' +
        '"texto" por "papel"' };
    }
  }
  const passo = { acao };
  if (comPapel) {
    const r = texto(numero, 'papel', p.papel, captura.TEXTO_MAXIMO);
    if (r.erro) return r;
    passo.papel = r.valor.trim();
  }
  if (Object.hasOwn(p, 'nome')) {
    const r = texto(numero, 'nome', p.nome, TETO_DO_TEXTO, true);
    if (r.erro) return r;
    // a arvore da o nome sem espaco nas pontas: "Entrar " nunca casaria
    passo.nome = r.valor.trim();
  }
  if (comTexto) {
    const r = texto(numero, 'texto', p.texto, TETO_DO_TEXTO);
    if (r.erro) return r;
    passo.texto = r.valor;
  }
  if (Object.hasOwn(p, 'valor')) {
    const v = p.valor;
    // o numero do JSON perde a forma escrita antes de chegar aqui (1.50 vira 1.5, 1.0 vira 1), e o valor e comparado
    // como o texto do campo: o numero vai entre aspas, como a pagina o mostra
    if (typeof v === 'number') {
      return { erro: numero + '"valor" ' + JSON.stringify(v) + ' vai entre aspas, como o campo o mostra (por exemplo ' +
        '"1.50"): o numero do JSON perde a forma escrita, e o valor e comparado como texto' };
    }
    if (typeof v !== 'string' && typeof v !== 'boolean') {
      return { erro: numero + '"valor" e um texto ou true/false (o valor do campo, entre aspas, ou se a caixa esta marcada)' };
    }
    if (Array.from(String(v)).length > TETO_DO_TEXTO) return { erro: numero + '"valor" passa de ' + TETO_DO_TEXTO + ' caracteres' };
    passo.valor = String(v);
  }
  if (Object.hasOwn(p, 'ordem')) {
    const r = inteiro(numero, 'ordem', p.ordem, TETO_DA_ORDEM);
    if (r.erro) return r;
    passo.ordem = r.valor;
  }
  if (Object.hasOwn(p, 'tempoMax')) {
    const r = inteiro(numero, 'tempoMax', p.tempoMax, captura.TETO_DO_TEMPO, '(em milissegundos: 5000 e 5 s)');
    if (r.erro) return r;
    passo.tempoMax = r.valor;
  } else {
    passo.tempoMax = PRAZO_DO_PASSO;
  }
  return { passo };
}

// Onde o JSON quebrou, como a pessoa procura no editor: a linha e a coluna, contadas da posicao que o motor da, ou o
// fim do arquivo.
function ondeQuebrou(mensagem, t) {
  const m = String(mensagem);
  const pos = /position (\d+)/.exec(m);
  if (pos) {
    const antes = t.slice(0, Number(pos[1])).split('\n');
    return 'perto da linha ' + antes.length + ', coluna ' + (antes[antes.length - 1].length + 1) +
      ': confira virgulas, aspas e chaves ali';
  }
  if (/end of JSON/i.test(m)) return 'o arquivo acaba antes de fechar: confira se falta } ou ] no fim';
  return 'confira virgulas, aspas e chaves';
}

// O texto do roteiro.json -> { passos } validados, ou { erro }.
function lerRoteiro(textoDoArquivo) {
  let o;
  const t = String(textoDoArquivo).replace(/^\uFEFF/, '');
  if (!t.trim()) return { erro: 'o roteiro esta vazio: escreva nele a lista de passos' + EXEMPLO };
  try { o = JSON.parse(t); } catch (e) {
    return { erro: 'o roteiro nao e um JSON valido (' + ondeQuebrou(e.message, t) + ')' + EXEMPLO };
  }
  if (!o || typeof o !== 'object' || Array.isArray(o) || !Array.isArray(o.passos)) {
    return { erro: 'o roteiro e um objeto com a lista "passos"' + EXEMPLO };
  }
  for (const k of Object.keys(o)) {
    if (k !== 'passos') return { erro: 'chave desconhecida no roteiro: "' + k + '" (so "passos")' };
  }
  if (!o.passos.length) return { erro: 'o roteiro nao tem passos' + EXEMPLO };
  if (o.passos.length > TETO_DE_PASSOS) {
    return { erro: 'o roteiro tem ' + o.passos.length + ' passos, e o maximo e ' + TETO_DE_PASSOS + ': divida em mais de uma captura' };
  }
  const passos = [];
  for (let i = 0; i < o.passos.length; i++) {
    const r = lerPasso(o.passos[i], i);
    if (r.erro) return r;
    passos.push(r.passo);
  }
  return { passos };
}

// A mensagem da falha de leitura do roteiro (`nome` ja entre aspas): o que fazer, pelo codigo do sistema.
function falhaAoLer(nome, e) {
  const codigo = e && e.code;
  if (codigo === 'ENOENT' || codigo === 'ENOTDIR') return '--passos: ' + nome + ' nao existe: confira o caminho do roteiro';
  if (codigo === 'EACCES' || codigo === 'EPERM') {
    return '--passos: sem permissao para ler ' + nome + ': libere a leitura do arquivo, ou copie-o para uma pasta sua';
  }
  return '--passos: nao deu para ler ' + nome + ' (' + (codigo || String(e && e.message || e)) + '): feche o programa ' +
    'que estiver com ele aberto e capture de novo';
}

// Os bytes do arquivo como texto: UTF-8, ou UTF-16 com a marca no comeco (o `>` do PowerShell 5 grava assim).
function decodificar(bytes) {
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) return { texto: bytes.toString('utf16le', 2) };
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return { erro: 'o roteiro esta em UTF-16 BE: salve-o em UTF-8 (ou UTF-16 LE) e capture de novo' };
  }
  return { texto: bytes.toString('utf8') };
}

// O --passos: le o arquivo (ate 1 MB), valida e devolve os passos com o hash do arquivo, que vai para a evidencia: o
// mesmo roteiro, o mesmo hash. Erro sempre com o --passos na frente, para a pessoa saber de qual opcao e.
function lerArquivoDoRoteiro(caminho) {
  if (typeof caminho !== 'string' || !caminho) return { erro: '--passos sem caminho: diga o caminho do roteiro.json' };
  const nome = '"' + caminho + '"';
  let st;
  try { st = fs.statSync(caminho); } catch (e) { return { erro: falhaAoLer(nome, e) }; }
  if (st.isDirectory()) return { erro: '--passos: ' + nome + ' e uma pasta, nao um arquivo: aponte para o roteiro.json' };
  if (!st.isFile()) {
    return { erro: '--passos: ' + nome + ' nao e um arquivo comum (e um dispositivo, um pipe ou um socket): aponte para ' +
      'o roteiro.json' };
  }
  if (st.size > TETO_DO_ARQUIVO) return { erro: '--passos: o roteiro passa de 1 MB: divida em mais de uma captura' };
  let bytes;
  try { bytes = fs.readFileSync(caminho); } catch (e) { return { erro: falhaAoLer(nome, e) }; }
  const d = decodificar(bytes);
  if (d.erro) return { erro: '--passos: ' + d.erro };
  const r = lerRoteiro(d.texto);
  if (r.erro) return { erro: '--passos: ' + r.erro };
  return { passos: r.passos, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

// O alvo do passo como a pessoa le: 'button "Entrar"', 'dialog', 'o texto "Painel"'.
function alvo(passo) {
  if (!passo.papel) return 'o texto "' + passo.texto + '"';
  return passo.papel + (passo.nome ? ' "' + passo.nome + '"' : '');
}

function descrever(passo) {
  return passo.acao + ' ' + alvo(passo) + (passo.valor !== undefined ? ' com o valor "' + passo.valor + '"' : '');
}

// O motivo de um passo nunca repete o alvo nem o texto da pagina: eles vao em campos proprios do rastro, cada um limpo
// de segredo sozinho.
function comEsse(passo) { return passo.nome ? 'com esse papel e nome' : 'com esse papel'; }

// Entre os nos achados na arvore (papel e nome exatos, ja sem os ignorados): o do passo. Com "ordem", o de numero
// ordem; sem ela, so vale um (como o modo estrito do Playwright: o clique nunca escolhe sozinho entre dois).
function escolherNo(nos, passo) {
  const lista = Array.isArray(nos) ? nos : [];
  if (!lista.length) {
    return { motivo: 'nenhum elemento ' + comEsse(passo) + ' na arvore de acessibilidade: os papeis e nomes que a ' +
      'pagina tem estao em "acessibilidade" do evidencia.json' };
  }
  if (passo.ordem) {
    if (lista.length < passo.ordem) {
      return { motivo: 'so ' + lista.length + ' elemento(s) ' + comEsse(passo) + ' na pagina, e o passo pede o de ordem ' +
        passo.ordem };
    }
    return { no: lista[passo.ordem - 1] };
  }
  if (lista.length > 1) {
    return { motivo: lista.length + ' elementos ' + comEsse(passo) + ' na pagina: diga qual com "ordem" (de 1 a ' +
      lista.length + ')' };
  }
  return { no: lista[0] };
}

function propriedade(no, nome) {
  const p = (no && Array.isArray(no.properties) ? no.properties : []).find(function (x) { return x && x.name === nome; });
  return p && p.value ? p.value.value : undefined;
}

// O valor que a arvore da ao elemento: a marca da caixa (checked: "true", "false" ou "mixed") quando ele tem uma; senao
// o valor do campo; senao vazio.
function valorDoNo(no) {
  const marcado = propriedade(no, 'checked');
  if (marcado !== undefined) return String(marcado);
  return no && no.value && no.value.value !== undefined && no.value.value !== null ? String(no.value.value) : '';
}

function desabilitado(no) { return propriedade(no, 'disabled') === true; }
function soLeitura(no) { return propriedade(no, 'readonly') === true; }
// O campo de texto: a arvore marca "editable" (plaintext no input e no textarea, richtext no contenteditable). O botao
// tambem recebe o foco, mas o texto digitado nele nao vai a lugar nenhum.
function editavel(no) { return ['plaintext', 'richtext'].includes(propriedade(no, 'editable')); }

// O ponto do clique: o centro da parte dentro da janela do primeiro quadro (DOM.getContentQuads, 4 pontos x,y) que tem
// area ali. Nenhum: null (o elemento nao aparece na janela).
function pontoDoClique(quads, largura, altura) {
  for (const q of Array.isArray(quads) ? quads : []) {
    if (!Array.isArray(q) || q.length !== 8 || !q.every(Number.isFinite)) continue;
    const xs = [q[0], q[2], q[4], q[6]];
    const ys = [q[1], q[3], q[5], q[7]];
    const esquerda = Math.max(0, Math.min(...xs));
    const direita = Math.min(largura, Math.max(...xs));
    const topo = Math.max(0, Math.min(...ys));
    const base = Math.min(altura, Math.max(...ys));
    if (direita - esquerda < 1 || base - topo < 1) continue;
    return { x: (esquerda + direita) / 2, y: (topo + base) / 2 };
  }
  return null;
}

// A conta do roteiro, por script: quantos rodaram, as conferencias e as que falharam, e o passo que parou o roteiro.
// ok so quando todos rodaram, nenhum parou e nenhuma conferencia falhou.
function somarPassos(rastro, total) {
  const conferencias = rastro.filter(function (p) { return p.acao === 'conferir'; });
  const falhas = conferencias.filter(function (p) { return !p.ok; }).map(function (p) { return p.n; });
  const parou = rastro.find(function (p) { return p.acao !== 'conferir' && !p.ok; });
  return { ok: !parou && !falhas.length && rastro.length === total, total, rodados: rastro.length,
    conferencias: conferencias.length, conferenciasOk: conferencias.length - falhas.length, conferenciasFalhas: falhas,
    parouNo: parou ? parou.n : null };
}

// O aviso da saida: o passo que parou (e o que ficou sem rodar) e as conferencias que falharam, com onde ler. Tudo
// certo: vazio. O alvo do passo vem do roteiro (o nome, o valor, o texto): limpo de segredo como no disco.
function avisoDoRoteiro(resumo, rastro) {
  const avisos = [];
  if (resumo.parouNo !== null) {
    const p = rastro.find(function (x) { return x.n === resumo.parouNo; });
    const faltam = resumo.total - resumo.parouNo;
    avisos.push('o roteiro parou no passo ' + p.n + ' (' + captura.textoParaODisco(descrever(p)) + '): ' + p.motivo + '; ' +
      (faltam ? 'os ' + faltam + ' passo(s) seguinte(s) nao rodaram, e ' : '') + 'a foto mostra a pagina nesse ponto; ' +
      'o rastro de cada passo esta em roteiro.passos do evidencia.json');
  }
  if (resumo.conferenciasFalhas.length) {
    avisos.push(resumo.conferenciasFalhas.length + ' de ' + resumo.conferencias + ' conferencia(s) falharam (passo(s) ' +
      resumo.conferenciasFalhas.join(', ') + '): o esperado e o obtido de cada uma estao em roteiro.passos do evidencia.json');
  }
  return avisos.join('; ');
}

// O rastro como vai para o disco: o texto que veio da pagina ou do roteiro, limpo de segredo e cortado; o texto que o
// passo digitou nunca vai (so quantos caracteres), porque costuma ser senha ou dado de alguem.
function rastroParaODisco(rastro) {
  return rastro.map(function (p) {
    const d = {};
    for (const [k, v] of Object.entries(p)) {
      if (k === 'texto' && p.acao === 'digitar') continue;
      d[k] = typeof v === 'string' ? captura.textoParaODisco(v) : v;
    }
    return d;
  });
}

module.exports = {
  PRAZO_DO_PASSO, TETO_DE_PASSOS, TETO_DO_TEXTO, TETO_DO_ARQUIVO,
  lerRoteiro, lerArquivoDoRoteiro, ondeQuebrou, falhaAoLer, escolherNo, valorDoNo, desabilitado, soLeitura, editavel, pontoDoClique, descrever,
  somarPassos, avisoDoRoteiro, rastroParaODisco,
};
