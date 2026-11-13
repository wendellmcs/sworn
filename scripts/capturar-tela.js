'use strict';
// E1 (D827): tira a foto de uma pagina e junta a evidencia - console, erros da pagina e arvore de acessibilidade -
// pelo protocolo de depuracao do Chrome (CDP), com o Chrome ou o Edge que a pessoa ja tem. Sem pacote de terceiro:
// o socket e o WebSocket do proprio Node (22 ou mais novo). O navegador abre num perfil temporario e numa porta
// propria (nunca a 9222 de quem usa), a conexao e so com 127.0.0.1 e a espera e por condicao (o evento de carga, um
// seletor), nunca por tempo. Grava <saida>/tela.png e <saida>/evidencia.json e imprime um JSON com os caminhos e o
// hash da imagem.
//
//   node scripts/capturar-tela.js --url <endereco> --saida <pasta> [--largura 1280] [--altura 800]
//                                 [--esperar <seletor CSS>] [--tempo-max 30000] [--arquivo <arquivo que desenha a tela>]
//
// E3 item 2: a evidencia leva o estilo calculado do que se ve (`estilo`) e, com .claude/sworn/design.json na pasta
// onde roda, o que dele ficou fora do sistema (`estiloForaDoSistema`, os desvios do --arquivo valendo).
//
// Saida 0 com o JSON; saida 1 com uma linha "ERRO: <o que houve e o que fazer>".
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { setTimeout: dormir } = require('node:timers/promises');
const { spawn, spawnSync } = require('node:child_process');
const captura = require('./lib/captura.js');
const config = require('./lib/config.js');
const design = require('./lib/design.js');

const PRAZO_DA_PORTA = 15000;
const PRAZO_DO_FECHO = 5000;
// Teto de cada comando ao navegador: nenhum passo espera para sempre, nem os que vem depois da carga.
const PRAZO_DO_COMANDO = 60000;
const PASSO = 100;
const TENTE_DE_NOVO = 'Rode de novo; se repetir, feche outras janelas do navegador ou aponte SWORN_NAVEGADOR para ' +
  'outro Chrome ou Edge.';
// O fim de todo erro do enviar: a leitura do estilo o tira (ali a foto ja esta tirada, e rodar de novo nao e o passo).
const DE_NOVO = '. ' + TENTE_DE_NOVO;

function comPrazo(promessa, ms, mensagem) {
  let relogio;
  const estouro = new Promise(function (_, falha) { relogio = setTimeout(function () { falha(new Error(mensagem)); }, ms); });
  return Promise.race([promessa, estouro]).finally(function () { clearTimeout(relogio); });
}

// O navegador escreve DevToolsActivePort no perfil quando a porta abre. Le ate achar o endereco, ate o processo morrer
// ou ate o prazo. "Ainda nao existe" e "o navegador esta escrevendo" (o Windows trava o arquivo durante a escrita:
// EBUSY ou EPERM, medido) sao a espera normal; outra falha de leitura sobe com a causa.
const LEITURA_DE_ESPERA = new Set(['ENOENT', 'EBUSY', 'EPERM']);
async function esperarEndereco(perfil, morreu) {
  const arquivo = path.join(perfil, 'DevToolsActivePort');
  const fim = Date.now() + PRAZO_DA_PORTA;
  while (Date.now() < fim) {
    if (morreu()) throw new Error('o navegador fechou logo ao abrir. ' + TENTE_DE_NOVO);
    let texto = null;
    try { texto = fs.readFileSync(arquivo, 'utf8'); } catch (e) {
      if (!LEITURA_DE_ESPERA.has(e.code)) throw new Error('nao deu para ler ' + arquivo + ' (' + e.code + '). ' + TENTE_DE_NOVO);
    }
    const endereco = texto === null ? null : captura.enderecoDoArquivo(texto);
    if (endereco) return endereco;
    await dormir(PASSO);
  }
  throw new Error('o navegador nao ficou pronto em ' + PRAZO_DA_PORTA / 1000 + ' s. ' + TENTE_DE_NOVO);
}

// Cliente CDP minimo: comandos com id e resposta (cada um com o seu prazo), eventos para quem ouvir. O `passo` e o
// nome do que a pessoa le quando algo falha; o nome do comando do protocolo fica fora da mensagem.
function conectar(endereco) {
  return new Promise(function (pronto, falha) {
    const ws = new WebSocket(endereco);
    const pendentes = new Map();
    const ouvintes = [];
    let proximo = 0;
    const cliente = {
      enviar: function (metodo, params, sessao, passo) {
        const id = ++proximo;
        const oQue = passo || 'falar com o navegador';
        const resposta = new Promise(function (r, f) {
          pendentes.set(id, { r, f, passo: oQue });
          const msg = { id, method: metodo, params: params || {} };
          if (sessao) msg.sessionId = sessao;
          ws.send(JSON.stringify(msg));
        });
        return comPrazo(resposta, PRAZO_DO_COMANDO, 'o navegador nao respondeu ao ' + oQue + ' em ' +
          PRAZO_DO_COMANDO / 1000 + ' s' + DE_NOVO).finally(function () { pendentes.delete(id); });
      },
      ouvir: function (fn) { ouvintes.push(fn); },
      fechar: function () { try { ws.close(); } catch (e) { /* ja fechado */ } },
    };
    ws.addEventListener('open', function () { pronto(cliente); });
    ws.addEventListener('error', function () { falha(new Error('nao deu para falar com o navegador. ' + TENTE_DE_NOVO)); });
    ws.addEventListener('close', function () {
      for (const p of pendentes.values()) p.f(new Error('o navegador fechou no meio de ' + p.passo + DE_NOVO));
      pendentes.clear();
    });
    ws.addEventListener('message', function (ev) {
      let m;
      // O protocolo so manda JSON; um quadro que nao e JSON nao tem id a quem responder, e o comando que esperava
      // por ele sai pelo prazo, com o passo no texto.
      try { m = JSON.parse(String(ev.data)); } catch (e) { return; }
      if (m.id && pendentes.has(m.id)) {
        const p = pendentes.get(m.id);
        pendentes.delete(m.id);
        if (m.error) p.f(new Error('o navegador recusou ' + p.passo + ' (' + m.error.message + ')' + DE_NOVO));
        else p.r(m.result || {});
      } else if (m.method) {
        for (const fn of ouvintes) fn(m);
      }
    });
  });
}

// Abre a pagina, espera a carga (e o seletor, se pedido) e devolve a foto e o que a pagina disse. Nao grava nada.
async function fotografar(cdp, o) {
  const { targetId } = await cdp.enviar('Target.createTarget', { url: 'about:blank' }, null, 'abrir uma aba');
  const { sessionId: s } = await cdp.enviar('Target.attachToTarget', { targetId, flatten: true }, null, 'abrir uma aba');
  const consoleLista = [];
  const erros = [];
  // A carga so conta depois que a navegacao comeca: um evento da aba em branco nao vale pela pagina.
  let navegando = false;
  let carregou = false;
  let avisarCarga = null;
  let status = null;
  cdp.ouvir(function (m) {
    if (m.sessionId !== s) return;
    if (m.method === 'Runtime.consoleAPICalled') consoleLista.push(captura.entradaDeConsole(m.params));
    else if (m.method === 'Runtime.exceptionThrown') erros.push(captura.erroDaPagina(m.params));
    else if (m.method === 'Log.entryAdded' && m.params && m.params.entry && m.params.entry.level === 'error') {
      erros.push(captura.erroDoLog(m.params));
    } else if (m.method === 'Network.responseReceived' && navegando && status === null && m.params &&
      m.params.type === 'Document' && m.params.response) {
      status = m.params.response.status;
    } else if (m.method === 'Page.loadEventFired' && navegando) { carregou = true; if (avisarCarga) avisarCarga(); }
  });
  await cdp.enviar('Page.enable', {}, s, 'preparar a aba');
  await cdp.enviar('Runtime.enable', {}, s, 'preparar a aba');
  await cdp.enviar('Log.enable', {}, s, 'preparar a aba');
  await cdp.enviar('Network.enable', {}, s, 'preparar a aba');
  await cdp.enviar('Emulation.setDeviceMetricsOverride',
    { width: o.largura, height: o.altura, deviceScaleFactor: 1, mobile: false }, s, 'ajustar o tamanho da janela');

  const inicio = Date.now();
  const restante = function () { return Math.max(1, o.tempoMax - (Date.now() - inicio)); };
  const maisTempo = 'aumente --tempo-max (hoje ' + o.tempoMax + ' ms)';
  navegando = true;
  const nav = await comPrazo(cdp.enviar('Page.navigate', { url: o.url }, s, 'abrir a pagina'), restante(),
    'a pagina nao respondeu em ' + o.tempoMax + ' ms: confira se o servidor esta no ar, ou ' + maisTempo);
  if (nav.errorText) throw new Error('a pagina nao abriu (' + nav.errorText + '): confira o endereco e se o servidor esta no ar');
  await comPrazo(new Promise(function (r) { if (carregou) r(); else avisarCarga = r; }), restante(),
    'a pagina nao terminou de carregar em ' + o.tempoMax + ' ms; ' + maisTempo + ' ou espere um seletor com --esperar');

  if (o.esperar) {
    const expressao = '!!document.querySelector(' + JSON.stringify(o.esperar) + ')';
    for (;;) {
      const r = await comPrazo(cdp.enviar('Runtime.evaluate', { expression: expressao, returnByValue: true }, s,
        'procurar o seletor'), restante(), 'o seletor "' + o.esperar + '" nao apareceu em ' + o.tempoMax + ' ms: confira se ele ' +
        'existe na pagina pronta, ou ' + maisTempo);
      if (r.exceptionDetails) {
        throw new Error('--esperar nao e um seletor CSS valido: "' + o.esperar + '" (exemplos que valem: #app, .pronto, ' +
          'main h1)');
      }
      if (r.result && r.result.value === true) break;
      if (restante() <= 1) {
        throw new Error('o seletor "' + o.esperar + '" nao apareceu em ' + o.tempoMax + ' ms: confira se ele existe ' +
          'na pagina pronta, ou ' + maisTempo);
      }
      await dormir(Math.min(PASSO, restante()));
    }
  }
  // Dois quadros de desenho depois da carga: o que a pagina pinta no primeiro quadro entra na foto.
  await cdp.enviar('Runtime.evaluate', { expression: 'new Promise(function (r) { requestAnimationFrame(function () { ' +
    'requestAnimationFrame(function () { r(true); }); }); })', awaitPromise: true }, s, 'esperar a pagina desenhar');

  const metricas = await cdp.enviar('Page.getLayoutMetrics', {}, s, 'medir a pagina');
  const tamanho = metricas.cssContentSize || metricas.contentSize || {};
  const foto = captura.alturaDaFoto(tamanho.height, o.altura);
  const imagem = await cdp.enviar('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: o.largura, height: foto.altura, scale: 1 } }, s, 'tirar a foto');
  // Sem foto, a captura para aqui, sem esperar as leituras seguintes.
  if (!imagem || typeof imagem.data !== 'string' || !imagem.data) {
    throw new Error('o navegador nao devolveu a foto: a pagina pode ser grande demais; diminua --largura, ou ' +
      TENTE_DE_NOVO.charAt(0).toLowerCase() + TENTE_DE_NOVO.slice(1));
  }
  const arvore = await cdp.enviar('Accessibility.getFullAXTree', {}, s, 'ler a arvore de acessibilidade');
  // O endereco final e a versao vem antes da leitura do estilo: se ela prender a pagina ate o prazo, o resto ja foi lido.
  const local = await cdp.enviar('Runtime.evaluate', { expression: 'location.href', returnByValue: true }, s, 'ler o endereco final');
  const versao = await cdp.enviar('Browser.getVersion', {}, null, 'ler a versao do navegador');
  const estilo = await lerEstilo(cdp, s);
  return { bytes: Buffer.from(imagem.data, 'base64'), foto, alturaDaPagina: Math.ceil(Number(tamanho.height) || 0),
    console: consoleLista, erros, acessibilidade: captura.resumirAcessibilidade(arvore.nodes), estilo,
    urlFinal: local.result && local.result.value, navegador: versao.product, duracaoMs: Date.now() - inicio, status };
}

// E3 item 2: o estilo calculado do que se ve (a camada 2 da conferencia de design). Uma pagina que derruba a leitura
// nao derruba a foto: o estilo sai vazio, com o motivo em `erro` (a pagina lancou um erro, o navegador recusou o
// pedido ou nao respondeu no prazo, a resposta veio sem resultado ou num formato que a captura nao entende, ou o
// documento nao tem corpo HTML).
async function lerEstilo(cdp, s) {
  let motivo = null;
  let estilo = null;
  try {
    // O enviar sempre resolve com um objeto (o `result` do protocolo, ou {}).
    const lido = await cdp.enviar('Runtime.evaluate', { expression: captura.EXPRESSAO_DO_ESTILO, returnByValue: true },
      s, 'ler o estilo calculado');
    if (lido.exceptionDetails) {
      const d = lido.exceptionDetails;
      const texto = String((d.exception && d.exception.description) || d.text || '').split('\n')[0];
      motivo = 'a pagina lancou um erro durante a leitura' + (texto ? ' (' + captura.textoParaODisco(texto) + ')' : '');
    } else if (!lido.result) {
      motivo = 'o navegador respondeu sem o resultado da leitura';
    } else {
      estilo = captura.resumirEstilo(lido.result.value);
      if (estilo.semCorpo) motivo = 'a pagina nao e um documento HTML com corpo (um arquivo SVG aberto direto, por exemplo)';
      else if (estilo.ilegivel) motivo = 'o navegador devolveu a leitura num formato que a captura nao entende';
    }
  } catch (e) {
    // Sem o "rode de novo" (DE_NOVO) que o enviar poe no fim de todo erro dele: ele vale para a captura inteira, e aqui
    // a foto ja esta tirada.
    motivo = captura.textoParaODisco(String(e.message).replace(DE_NOVO, ''));
  }
  if (!motivo) return estilo;
  return { ...(estilo || captura.resumirEstilo(null)), erro: 'nao deu para ler as cores, fontes, tamanhos e cantos ' +
    'arredondados da tela: ' + motivo + '. A foto e o resto da evidencia foram gravados, mas a conferencia desses ' +
    'valores nao aconteceu: confira-os na foto, a olho' };
}

// Com .claude/sworn/design.json no projeto (a pasta onde a captura roda), a conferencia do estilo calculado contra o
// sistema, que vai para a evidencia no campo `estiloForaDoSistema` (o nome que o GUIA documenta): { ok, fora,
// naoLidos, conferidos, feita, arquivo }; sem o design.json, null. `fora` e a lista do que ficou fora do sistema e
// `conferidos` quantos valores foram comparados. Com o estilo sem ler, `feita: false` e `ok: false` (a lista vazia nao
// quer dizer "tudo dentro do sistema").
// `arquivoDado` (o --arquivo) diz qual arquivo desenha a tela, para os desvios dele valerem; sem ele, ou com a propria
// pasta do projeto, nenhum desvio se aplica (arquivo: null). Relativo ou absoluto, com barra normal ou invertida, ele
// vira o caminho a partir da pasta do projeto, com barras normais, que e como o desvio casa. Um caminho fora do
// projeto (acima dele, em outro disco, ou com letra de disco fora do Windows) nao casa desvio nenhum e nao vai para a
// evidencia: so `arquivoForaDoProjeto: true`, para o caminho pessoal (a pasta do usuario) nao ir para o disco.
function conferenciaDoEstilo(estilo, arquivoDado) {
  const raiz = process.cwd();
  const sistema = config.carregarDesign(raiz);
  if (!sistema) return null;
  let arquivo = null;
  let foraDoProjeto = false;
  if (arquivoDado) {
    const dado = arquivoDado.replace(/\\/g, '/');
    if (path.sep === '/' && /^[A-Za-z]:/.test(dado)) {
      foraDoProjeto = true;
    } else {
      const relativo = path.relative(raiz, path.resolve(raiz, dado));
      const sobe = relativo === '..' || relativo.startsWith('..' + path.sep);
      if (sobe || path.isAbsolute(relativo)) foraDoProjeto = true;
      else if (relativo) arquivo = relativo.split(path.sep).join('/');
    }
  }
  const r = { ...design.conferirComputado(estilo, sistema, arquivo), feita: !estilo.erro, arquivo };
  if (!r.feita) r.ok = false;
  if (foraDoProjeto) r.arquivoForaDoProjeto = true;
  return r;
}

// O aviso da saida sobre a conferencia do estilo: onde esta a lista e o que fazer com ela, e o --arquivo que nao valeu.
function avisoDoEstilo(conferencia, arquivoDado) {
  const avisos = [];
  if (!conferencia) {
    return 'sem .claude/sworn/design.json na pasta onde a captura roda, o estilo foi gravado sem conferir' +
      (arquivoDado ? ' e o --arquivo nao foi usado' : '') + ': rode a captura da raiz do projeto (a pasta do ' +
      '.claude/sworn/design.json), ou crie o sistema de design com o /sworn:init';
  }
  if (conferencia.arquivoForaDoProjeto) {
    avisos.push('o --arquivo fica fora da pasta do projeto, e os desvios dele nao valeram: se o arquivo e do projeto, ' +
      'rode a captura da raiz do projeto e passe o caminho a partir dela; um arquivo fora do projeto nao tem desvio');
  }
  if (conferencia.feita && conferencia.fora.length) {
    avisos.push(conferencia.fora.length + ' valor(es) fora do sistema de design, listados em estiloForaDoSistema.fora ' +
      'do evidencia.json: troque cada um por um valor do .claude/sworn/design.json, ou peca ao dono que declare um ' +
      'desvio para esta tela em "desvios" do design.json' +
      (arquivoDado ? '' : ' e rode de novo com --arquivo <o arquivo que desenha a tela>: sem ele, so o sistema vale'));
  }
  return avisos.join('; ');
}

// Grava tela.png e evidencia.json na pasta de saida e devolve a linha que o script imprime. A evidencia leva sempre o
// estilo lido e, se veio, a `conferencia` (a conferenciaDoEstilo, feita antes por quem chama).
function gravarEvidencia(dados, o, saida, conferencia) {
  const caminhoDaImagem = path.join(saida, 'tela.png');
  fs.writeFileSync(caminhoDaImagem, dados.bytes);
  const sha256 = crypto.createHash('sha256').update(dados.bytes).digest('hex');
  // O token de uma URL nao vai para o disco: nem no endereco, nem no console, nem na pilha dos erros, nem nos nomes da
  // arvore de acessibilidade.
  const limpos = captura.consoleEErrosSemSegredo(dados.console, dados.erros);
  const acessibilidade = { itens: dados.acessibilidade.itens.map(function (i) {
    return { papel: i.papel, nome: captura.textoParaODisco(i.nome) };
  }), cortada: dados.acessibilidade.cortada };
  const evidencia = {
    url: captura.semSegredo(o.url), urlFinal: dados.urlFinal ? captura.semSegredo(dados.urlFinal) : null,
    status: dados.status, hora: new Date().toISOString(), navegador: dados.navegador,
    largura: o.largura, altura: dados.foto.altura, alturaDaPagina: dados.alturaDaPagina, cortada: dados.foto.cortada,
    imagem: 'tela.png', sha256, console: limpos.console, erros: limpos.erros, acessibilidade,
    duracaoMs: dados.duracaoMs, estilo: dados.estilo,
  };
  if (conferencia) evidencia.estiloForaDoSistema = conferencia;
  const caminhoDaEvidencia = path.join(saida, 'evidencia.json');
  fs.writeFileSync(caminhoDaEvidencia, JSON.stringify(evidencia, null, 2) + '\n');
  const fim = { ok: true, imagem: caminhoDaImagem, evidencia: caminhoDaEvidencia, sha256, status: dados.status,
    console: dados.console.length, erros: dados.erros.length, cortada: dados.foto.cortada };
  // So a contagem: a lista inteira esta em evidencia.estiloForaDoSistema.fora. Com o estilo sem ler, o zero diria
  // "tudo dentro do sistema": a saida leva o motivo no lugar dele.
  if (dados.estilo.erro) fim.estiloNaoLido = dados.estilo.erro;
  else if (conferencia) fim.valoresForaDoSistema = conferencia.fora.length;
  const aviso = avisoDoEstilo(conferencia, o.arquivo);
  if (aviso) fim.avisoDoEstilo = aviso;
  if (dados.status >= 400) {
    fim.aviso = 'o servidor respondeu ' + dados.status + ': a foto e da pagina de erro; confira o endereco (ou o login, ' +
      'se a pagina pede um) e capture de novo';
  }
  return fim;
}

// Fecha o navegador e todos os processos dele. No Windows, a arvore inteira cai pelo taskkill enquanto o navegador
// ainda esta vivo: fechado pelo protocolo, o processo de relatorio de falhas (crashpad) sobrevive ao pai e segura o
// perfil por segundos (medido sob a suite inteira), e child.kill() mataria so o pai. Sob carga o taskkill leva mais
// que 5 s para descer a arvore: o prazo dele e o do comando. Fora do Windows, fecha pelo protocolo e, se nao fechar
// no prazo, mata. Primeiro os filhos listados pelo proprio navegador, depois o navegador (fecharNavegador).
async function matarFilhosEFecharNavegador(cdp, filho, saiu) {
  // Os processos filhos que o proprio navegador diz que sao dele caem primeiro, pelo numero, enquanto ainda sao dele
  // (acabaram de ser listados): o taskkill da arvore deixava orfaos sob a suite inteira (medido). Depois cai o pai.
  if (cdp) {
    try {
      const info = await cdp.enviar('SystemInfo.getProcessInfo', {}, null, 'listar os processos do navegador');
      for (const p of info.processInfo || []) {
        // So numero positivo: 0 ou negativo no kill sinaliza um grupo de processos inteiro.
        if (Number.isInteger(p.id) && p.id > 0 && p.id !== filho.pid) { try { process.kill(p.id); } catch (e) { /* ja saiu */ } }
      }
    } catch (e) { /* sem a lista, fica o taskkill e o kill do pai */ }
  }
  await fecharNavegador(cdp, filho, saiu);
}

// No Windows, a arvore pelo taskkill; fora dele, pelo protocolo e, sem saida no prazo, o kill do pai.
async function fecharNavegador(cdp, filho, saiu) {
  if (process.platform === 'win32' && filho.pid && !saiu()) {
    if (cdp) cdp.fechar();
    spawnSync('taskkill', ['/PID', String(filho.pid), '/T', '/F'],
      { stdio: 'ignore', windowsHide: true, timeout: PRAZO_DO_COMANDO });
  } else if (cdp) {
    try { await cdp.enviar('Browser.close', {}, null, 'fechar o navegador'); } catch (e) { /* segue para o kill */ }
    cdp.fechar();
  }
  await esperarSaida(saiu);
  if (saiu() || !filho.pid) return;
  try { filho.kill('SIGKILL'); } catch (e) { /* ja saiu */ }
  await esperarSaida(saiu);
}

async function esperarSaida(saiu) {
  const fim = Date.now() + PRAZO_DO_FECHO;
  while (!saiu() && Date.now() < fim) await dormir(PASSO);
}

const PRAZO_DO_PERFIL = 30000;
const PRAZO_DA_LIMPEZA = 300000;
// Mata, no Windows, quem cita o perfil na linha de comando. O caminho e o que este script criou; a comparacao e exata
// (Contains), sem curinga, e o PowerShell e o Node que fazem a limpeza ficam de fora.
function matarOrfaosDoPerfil(perfil) {
  if (process.platform !== 'win32') return;
  const exato = perfil.replace(/'/g, "''");
  spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -ne 'powershell.exe' -and $_.Name -ne 'node.exe' -and " +
    "$_.CommandLine -and $_.CommandLine.Contains('" + exato + "') } | " +
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'],
  { stdio: 'ignore', windowsHide: true, timeout: PRAZO_DO_COMANDO });
}

// O perfil temporario e nosso. O rmSync tenta de novo sozinho: no Windows o navegador (e o processo de relatorio de
// falhas dele, que sai um pouco depois) solta os arquivos com atraso. A espera cresce 100 ms a cada tentativa: 10
// tentativas somam 5,5 s. Se ainda assim o perfil estiver preso no Windows, sobrou processo que o cita na linha de
// comando (o de relatorio de falhas, que nao entra na lista do navegador): ele cai, e o apagar tenta de novo a cada
// 1 s, ate o prazo. Devolve null se apagou, ou a causa. A limpeza em segundo plano (--limpar-perfil) usa a mesma
// funcao, com prazo maior.
async function apagarPerfil(perfil, prazo) {
  const fim = Date.now() + prazo;
  let matou = false;
  for (;;) {
    try { fs.rmSync(perfil, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); return null; } catch (e) {
      if (Date.now() >= fim) return e.code || e.message;
    }
    if (!matou) { matarOrfaosDoPerfil(perfil); matou = true; }
    await dormir(1000);
  }
}

// Perfil ainda preso depois de 30 s (sob carga pesada, medido na suite inteira): este mesmo script, solto e sem
// segurar a saida, termina a limpeza em ate 5 minutos. A captura termina na hora.
function agendarLimpeza(perfil) {
  const limpeza = spawn(process.execPath, [__filename, '--limpar-perfil', perfil],
    { detached: true, stdio: 'ignore', windowsHide: true });
  limpeza.unref();
}

// A pasta temporaria, pelo caminho longo: o navegador nao grava num perfil dado pelo nome curto do Windows (o de 8
// letras com til, que a pasta temporaria do usuario costuma ter). SWORN_TMP manda sobre a do sistema.
function pastaTemporaria() {
  const pedida = process.env.SWORN_TMP || os.tmpdir();
  try { return { base: fs.realpathSync.native(pedida) }; } catch (e) {
    return { erro: 'a pasta temporaria "' + pedida + '" nao existe (' + e.code + ')' + (process.env.SWORN_TMP ?
      ': corrija SWORN_TMP ou apague a variavel' : '') };
  }
}

// Modo interno da limpeza em segundo plano (agendarLimpeza): so apaga um perfil desta captura, com nome
// sworn-captura-* direto dentro da pasta temporaria. No Windows o caminho nao diferencia maiuscula.
async function limparPerfilEmSegundoPlano(alvo) {
  const pasta = pastaTemporaria();
  if (pasta.erro) return { erro: pasta.erro };
  const dentro = path.dirname(path.resolve(alvo || '.'));
  const mesmo = process.platform === 'win32' ? dentro.toLowerCase() === pasta.base.toLowerCase() : dentro === pasta.base;
  if (!path.basename(alvo || '').startsWith('sworn-captura-') || !mesmo) {
    return { erro: '--limpar-perfil so apaga um perfil sworn-captura- da pasta temporaria (' + pasta.base + '). E um ' +
      'modo interno, que a propria captura usa: para tirar uma foto, rode com --url e --saida' };
  }
  const causa = await apagarPerfil(alvo, PRAZO_DA_LIMPEZA);
  return causa ? { erro: 'a pasta temporaria ' + alvo + ' segue presa (' + causa + '); feche o navegador que a usa ' +
    'e apague a pasta a mao' } : { ok: true, apagado: alvo };
}

async function main() {
  if (process.argv[2] === '--limpar-perfil') return limparPerfilEmSegundoPlano(process.argv[3]);
  const lido = captura.lerArgs(process.argv.slice(2));
  if (lido.erro) return { erro: lido.erro };
  const o = lido.opcoes;
  if (typeof WebSocket !== 'function') {
    return { erro: 'a captura precisa do Node 22 ou mais novo (este e o ' + process.version + '): atualize o Node' };
  }
  const existe = function (p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };
  const navegador = captura.acharNavegador(captura.candidatosDoNavegador(process.platform, process.env), existe);
  if (!navegador && process.env.SWORN_NAVEGADOR) {
    return { erro: 'SWORN_NAVEGADOR aponta para "' + process.env.SWORN_NAVEGADOR + '", que nao existe. Corrija o ' +
      'caminho ou apague a variavel para o sworn procurar o Chrome ou o Edge.' };
  }
  if (!navegador) {
    return { erro: 'nenhum Chrome ou Edge achado. Instale um deles, ou aponte SWORN_NAVEGADOR para o executavel.' };
  }
  const saida = path.resolve(o.saida);
  try { fs.mkdirSync(saida, { recursive: true }); } catch (e) {
    return { erro: '--saida nao pode ser usada como pasta: "' + saida + '" (' + e.code + '); aponte para uma pasta nova ' +
      'ou que ja exista' };
  }
  const pasta = pastaTemporaria();
  if (pasta.erro) return { erro: pasta.erro };
  const perfil = fs.mkdtempSync(path.join(pasta.base, 'sworn-captura-'));
  const filho = spawn(navegador, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + perfil,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--mute-audio',
    'about:blank'], { stdio: 'ignore', windowsHide: true });
  let saiu = false;
  let erroAoAbrir = null;
  filho.on('exit', function () { saiu = true; });
  filho.on('error', function (e) { erroAoAbrir = e; saiu = true; });
  let cdp = null;
  let resultado = { erro: 'a captura parou sem resultado. ' + TENTE_DE_NOVO };
  try {
    const endereco = await esperarEndereco(perfil, function () { return saiu; });
    cdp = await comPrazo(conectar(endereco), PRAZO_DA_PORTA, 'nao deu para falar com o navegador em ' +
      PRAZO_DA_PORTA / 1000 + ' s. ' + TENTE_DE_NOVO);
    const dados = await fotografar(cdp, o);
    resultado = gravarEvidencia(dados, o, saida, conferenciaDoEstilo(dados.estilo, o.arquivo));
  } catch (e) {
    resultado = { erro: erroAoAbrir ? 'o navegador nao abriu (' + navegador + '): ' + erroAoAbrir.message + '. Confira se ' +
      'ele abre a mao, ou aponte SWORN_NAVEGADOR para outro Chrome ou Edge' : e.message };
  }
  try { await matarFilhosEFecharNavegador(cdp, filho, function () { return saiu; }); } catch (e) {
    resultado.aviso = captura.juntarAvisos(resultado.aviso, 'o navegador pode ter ficado aberto (' + e.message + '); ' +
      'feche-o pelo gerenciador de tarefas se ele aparecer');
  }
  const causa = await apagarPerfil(perfil, PRAZO_DO_PERFIL);
  if (causa) {
    agendarLimpeza(perfil);
    resultado.aviso = captura.juntarAvisos(resultado.aviso, 'a pasta temporaria do navegador em ' + perfil +
      ' ainda estava presa (' + causa + '); ela e apagada em segundo plano nos proximos minutos, sem nada a fazer');
  }
  return resultado;
}

// O teste carrega o arquivo para ler o aviso sem abrir o navegador: so a linha de comando roda o main.
if (require.main === module) {
  main().then(function (r) {
    const saida = captura.saidaDoScript(r);
    process.stdout.write(saida.texto);
    process.exitCode = saida.codigo;
  }, function (e) {
    process.stdout.write('ERRO: ' + (e && e.message ? e.message : String(e)) + '\n');
    process.exitCode = 1;
  });
}

module.exports = { avisoDoEstilo, conferenciaDoEstilo };
