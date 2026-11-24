'use strict';
/**
 * H12c (s376, D914; ideia de Donchitos no radar de 2026-11-23): o briefing que pede ao subagente um arquivo com caminho
 * explicito e o subagente que termina sem ele. Quem chama: o conferir-entrega.js no SubagentStop (le o briefing,
 * confere o disco e guarda o que falta em `s.entregaFaltando`) e o portao-fecho.js no Stop (cobra uma vez, o lugar em
 * que o texto chega a quem despachou; a saida do SubagentStop nao chega a ele). Quem ajuda: estado.js guarda a sessao.
 */
const fs = require('fs');
const path = require('path');
const { StringDecoder } = require('string_decoder');

// Medido na s376 em 11660 briefings deste projeto: o pedido de arquivo e um verbo no imperativo no comeco da frase,
// da linha ou do item, com o caminho entre crases na mesma frase (17 briefings, nenhum de inspetor). O trecho entre o
// verbo e o caminho tem teto, e a leitura fica linear.
// atalho: o caminho entre crases nao tem espaco. limite: o pedido de `minha pasta/a.md` nao e conferido (passa calado).
// trocar quando: um briefing medido pedir caminho com espaco; entre crases, espaco hoje e comando (`git commit -F a.txt`).
const PEDIDO = /(?:^|[.!?:][ \t\r\n]+|\n[ \t]*(?:[-*][ \t]+|\d{1,3}[.)][ \t]+)?)(?:grave|escreva|salve|crie|write|save|create)\b[^.\n`]{0,80}`([^`\s]{1,400}\.[A-Za-z0-9]{1,6})`/gi;
// Molde (`<caminho>`), curinga ou variavel nao e um arquivo de verdade; o `~` do comeco (a pasta pessoal) fica de fora
// sem expandir: nenhum briefing medido o usa, e sem conferir nao ha aviso falso. O caminho de rede (`\\host\x`,
// `//host/x`) tambem: conferir que ele existe abre conexao SMB e pode mandar a credencial do Windows ao host. Endereco
// com esquema (`https://`, `file:///`) nao e arquivo do disco; o esquema tem 2 letras ou mais, e `C:` segue caminho.
const NAO_E_CAMINHO = /[<>*?{}$%]|^~|^[\\/]{2}|^[a-z][a-z0-9+.-]+:/i;
const MAX_CAMINHOS = 10;
const MAX_PENDENTES = 10;
// O briefing e a 1a mensagem do usuario da transcricao: le em blocos ate a linha dela, sem cortar a linha.
const BLOCO = 256 * 1024;
// atalho: teto da leitura. limite: briefing que passa de 16 MB nao e conferido (passa calado). trocar quando: o
// Claude Code gravar briefing desse tamanho.
const TETO = 16 * 1024 * 1024;

/** Os caminhos que o briefing pede para gravar, sem repetir, ate MAX_CAMINHOS. */
function caminhosPedidos(briefing) {
  if (typeof briefing !== 'string') return [];
  const vistos = [];
  const re = new RegExp(PEDIDO.source, PEDIDO.flags);
  let m;
  while ((m = re.exec(briefing)) && vistos.length < MAX_CAMINHOS) {
    if (!NAO_E_CAMINHO.test(m[1]) && vistos.indexOf(m[1]) === -1) vistos.push(m[1]);
  }
  return vistos;
}

function textoDe(conteudo) {
  if (typeof conteudo === 'string') return conteudo;
  if (!Array.isArray(conteudo)) return null;
  return conteudo.filter(function (b) { return b && b.type === 'text' && typeof b.text === 'string'; })
    .map(function (b) { return b.text; }).join('\n');
}

/** O texto da linha que e a mensagem do usuario; undefined quando a linha e outra coisa. */
function doUsuario(linha) {
  let j;
  try { j = JSON.parse(linha); } catch (e) { return undefined; }
  return j && j.type === 'user' && j.message && j.message.role === 'user' ? textoDe(j.message.content) : undefined;
}

/** O briefing: o texto da 1a mensagem do usuario na transcricao do subagente; null quando nao se le. */
function briefingDaTranscricao(arquivo) {
  if (typeof arquivo !== 'string' || !arquivo) return null;
  let fd;
  try {
    fd = fs.openSync(arquivo, 'r');
    const buf = Buffer.alloc(BLOCO);
    const decodificador = new StringDecoder('utf8');
    let resto = '';
    for (let pos = 0; pos < TETO;) {
      const lidos = fs.readSync(fd, buf, 0, BLOCO, pos);
      pos += lidos;
      const acabou = lidos === 0;
      const novo = acabou ? decodificador.end() : decodificador.write(buf.subarray(0, lidos));
      resto += novo;
      // so divide quando o bloco novo fecha uma linha: a linha enorme se le em tempo linear
      if (!acabou && novo.indexOf('\n') === -1) continue;
      const linhas = resto.split('\n');
      resto = acabou ? '' : linhas.pop();
      for (const linha of linhas) {
        const texto = doUsuario(linha);
        if (texto !== undefined) return texto;
      }
      if (acabou) return null;
    }
    return null;
  } catch (e) {
    // transcricao ausente ou sem permissao: sem briefing, sem aviso (o gancho nunca decide)
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (e) { /* nada a fazer */ }
  }
}

/** O caminho no disco: no Windows, `/c/...` do Git Bash e `C:/...`; relativo, contra o cwd. */
function noDisco(caminho, cwd) {
  const c = process.platform === 'win32' && /^\/[a-zA-Z]\//.test(caminho) ? caminho[1] + ':' + caminho.slice(2) : caminho;
  return path.resolve(cwd, c);
}

/** Os caminhos pedidos que nao existem no disco. */
function faltando(caminhos, cwd) {
  return caminhos.filter(function (c) { return !fs.existsSync(noDisco(c, cwd)); });
}

/** No fim do subagente: a lista da sessao com mais um que nao gravou; as ultimas MAX_PENDENTES. */
function anotarFaltando(s, tipo, faltam) {
  const lista = Array.isArray(s.entregaFaltando) ? s.entregaFaltando.slice() : [];
  lista.push({ agente: typeof tipo === 'string' && tipo ? tipo : 'sem tipo', caminhos: faltam.slice(0, MAX_CAMINHOS) });
  return lista.slice(-MAX_PENDENTES);
}

/** O nome do agente em ASCII (R5): o acento cai sem levar a letra, o resto fora de nome some; vazio vira 'sem tipo'. */
function nomeDoAgente(agente) {
  return String(agente).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w :.-]/g, '').trim() || 'sem tipo';
}

/** O motivo do fecho do turno, ou null. Texto ao modelo em ASCII (R5), em portugues (D665); o caminho vai como veio. */
function motivoDoFecho(s) {
  const lista = (Array.isArray(s.entregaFaltando) ? s.entregaFaltando : []).filter(function (p) {
    return p && Array.isArray(p.caminhos) && p.caminhos.length;
  });
  if (!lista.length) return null;
  const linhas = [lista.length === 1 ? 'sworn - um subagente terminou sem gravar o que o briefing pediu.'
    : 'sworn - ' + lista.length + ' subagentes terminaram sem gravar o que o briefing pediu.', ''];
  for (const p of lista) {
    linhas.push('O agente "' + nomeDoAgente(p.agente) + '" nao gravou:');
    for (const c of p.caminhos) linhas.push('  - ' + String(c));
  }
  linhas.push('', 'Confira antes de usar o resultado: grave cada arquivo da lista com o que o agente devolveu, ou',
    'despache o agente de novo pedindo so o arquivo. Se o caminho mudou de proposito, siga e diga ao usuario onde ficou.');
  return linhas.join('\n');
}

module.exports = { caminhosPedidos, briefingDaTranscricao, faltando, anotarFaltando, motivoDoFecho };
