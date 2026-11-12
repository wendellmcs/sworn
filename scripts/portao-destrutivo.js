#!/usr/bin/env node
'use strict';
const io = require('./lib/io.js');
const estado = require('./lib/estado.js');
const config = require('./lib/config.js');
const destrutivo = require('./lib/destrutivo.js');
const projetoLib = require('./lib/projeto.js');

// Os avisos de uma vez por sessao, pelo campo da marca. Marca e balde vao por extenso: o fecho so le
// `s.<campo> =` (test/portao-fecho.test.js:362) e a lista de baldes so `incrementar(..., '<balde>')`
// (test/auxiliar-baldes.js:20). `contar` null nao conta.
const UMA_VEZ = {
  avisouTabelaShell: {
    marcar: function (s) { s.avisouTabelaShell = true; },
    contar: function (sessao) { estado.incrementar(sessao, 'shell_tabela_quebrada'); }
  },
  avisouBloqueadoInvalido: {
    marcar: function (s) { s.avisouBloqueadoInvalido = true; },
    contar: null
  }
};

// O aviso de uma vez por sessao (0.3.5/D294; D721 A1-06 o reusa): na 1a vez permite com o texto, e o io.permitir
// encerra o processo; a sessao ja avisada volta sem fazer nada.
function avisarUmaVez(sessao, marca, texto) {
  if (estado.ler(sessao)[marca]) return;
  // a marca e lida de novo DENTRO do alterar (com a trava): dois comandos ao mesmo tempo nao avisam duas vezes
  // F3-20: `jaAvisou` nasce false. Se o estado estiver fora do ar o alterar nem chega a rodar, e
  // nascendo true o aviso sumia calado: duplicar o aviso e melhor que calar.
  let jaAvisou = false;
  try {
    estado.alterar(sessao, function (s) {
      jaAvisou = !!s[marca];
      UMA_VEZ[marca].marcar(s);
      return s;
    });
  } catch (err) { /* estado fora do ar: avisa mesmo sem poder gravar a marca */ }
  if (jaAvisou) return;
  if (UMA_VEZ[marca].contar) {
    try { UMA_VEZ[marca].contar(sessao); } catch (err) { /* idem: o balde vale menos que o aviso */ }
  }
  const t = texto();
  io.permitir({ systemMessage: t, hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: t } });
}

/**
 * D785 item 4 (s369, 2.4): o `rm`/`Remove-Item` de arquivos nomeados (destrutivo.arquivosNomeados) passa quando CADA
 * arquivo existe como arquivo comum dentro do projeto, fora de `.claude/` e de `.git` (apagar o projeto.json desligaria
 * as travas), fora dos intocaveis e do "Fora", na lista "Dentro" do escopo em vigor (exigido em qualquer marcha), e
 * nao estava modificado quando a sessao abriu (`gitAbertura`: trabalho nao commitado de outra frente). E o
 * portao-escopo.js (:153-226) para gravar, mais estrito em dois pontos de proposito, porque apagar nao tem desfazer: o
 * escopo vale na marcha rapida, e o arquivo de outra frente barra mesmo dentro do escopo. Sem projeto.json, sem escopo
 * ou com padrao do dono em `comandosBloqueados` casando: barra. Qualquer erro aqui = barra.
 */
/**
 * A4 (s369, P2 da s454): os arquivos de outra frente para o `rm`. Sem a foto da abertura (o estado nao gravou, a
 * abertura nao rodou), a trava ficava aberta: vale o git de agora, que inclui o trabalho desta sessao (mais estrito, e
 * o arquivo limpo volta pelo git). Fora de repositorio nao ha outra frente: lista vazia. Repositorio cujo git falha:
 * lanca, e o chamador barra.
 */
function fotoDaAbertura(s, raiz) {
  if (Array.isArray(s.gitAbertura)) return s.gitAbertura;
  const git = require('./lib/git.js');
  const agora = git.modificados(raiz);
  if (agora !== null) return agora;
  if (git.correr(raiz, ['rev-parse', '--is-inside-work-tree']) === null) return [];
  throw new Error('git status falhou e a foto da abertura falta');
}

function apagaSoNoEscopo(e, comando, raiz, projeto) {
  try {
    if (!projeto) return false;
    const nomes = destrutivo.arquivosNomeados(comando, e.tool_name);
    if (!nomes || destrutivo.bloqueadoPeloProjeto(comando, projeto)) return false;
    const fs = require('node:fs');
    const path = require('node:path');
    const caminho = require('./lib/caminho.js');
    const escopoLib = require('./lib/escopo.js');
    const glob = require('./lib/glob.js');
    const s = estado.ler(e.session_id);
    const esc = escopoLib.carregar(raiz, s.frente);
    if (!esc) return false;
    const deOutraFrente = projetoLib.travasDe(projeto).outraFrente !== false
      ? fotoDaAbertura(s, raiz).map(function (p) { return String(p).toLowerCase(); }) : [];
    const base = e.cwd || process.cwd();
    const raizReal = fs.realpathSync.native(raiz);
    const passa = function (alvo) {
      if (!alvo || /^\.claude(\/|$)|(^|\/)\.git(\/|$)/i.test(alvo)) return false;
      if (glob.casaAlgum(projeto.intocaveis, alvo) || escopoLib.declaradoFora(alvo, esc)) return false;
      if (!escopoLib.dentro(alvo, esc)) return false;
      return deOutraFrente.indexOf(alvo.toLowerCase()) === -1;
    };
    return nomes.every(function (nome) {
      const abs = path.resolve(base, nome);
      let st = null;
      try { st = fs.lstatSync(abs); } catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
      /* o que nao existe (ja apagado) nao tem caminho real e o rm nao leva nada: vale o nome escrito, no mesmo escopo
         (o curinga ja foi recusado no arquivosNomeados). Menos o pedaco com ponto ou espaco no fim: o Node nao o
         acha, e o Windows o apara e apaga o outro (`segredo.txt.` leva `segredo.txt`) */
      if (!st) {
        if (String(nome).split(/[\\/]/).some(function (p) { return p !== '.' && p !== '..' && /[. ]$/.test(p); })) {
          return false;
        }
        return passa(caminho.relativoAoProjeto(abs, raiz));
      }
      if (!st.isFile()) return false;
      /* confere o nome REAL, que e o que o shell apaga: o nome curto 8.3 (`SEGRED~1.TXT`) e a juncao numa pasta-mae
         (para fora do projeto, ou para .claude/) dao um texto escrito que nao e o do arquivo */
      return passa(caminho.relativoAoProjeto(fs.realpathSync.native(abs), raizReal));
    });
  } catch (err) { return false; }
}

/**
 * A5a (s369, leva 12 do Codex: `cmd /c del /q saida\LICENCAS.txt` passou e levou o arquivo a preservar): o apagar que a
 * classificacao nao acha destrutivo (sem -f, sem -r, um arquivo so) tambem confere o escopo, quando o projeto declara
 * um (D785 item 4: "fora do escopo seguem barrados"). Sem projeto.json ou sem escopo, segue como antes (passa): o rm
 * simples nunca foi barrado sem escopo, e barrar todo rm seria mais duro que o portao de gravar. Devolve o motivo
 * (texto do REGRAS, comecando por "rm " para o aviso dar a forma que passa) ou null.
 */
function apagarForaDoEscopo(e, comando, raiz, projeto) {
  try {
    if (!projeto) return null;
    const s = estado.ler(e.session_id);
    if (!require('./lib/escopo.js').carregar(raiz, s.frente)) return null;
    // A5d (s369): o apagar por API do sistema nao tem nome que se confira; o motivo diz como apagar pelo nome
    if (destrutivo.apagaPorApi(comando, e.tool_name)) return destrutivo.MOTIVO_APAGA_POR_API;
    if (destrutivo.arquivosNomeados(comando, e.tool_name)) {
      return apagaSoNoEscopo(e, comando, raiz, projeto) ? null : 'rm de arquivo fora do escopo ou dos permitidos';
    }
    return destrutivo.temApagar(comando) ? 'rm dentro de comando composto (apague arquivo por arquivo, num comando so)'
      : null;
  } catch (err) { return null; }
}

/**
 * A5f (leva 16 do luna: no turno da ampliacao, o `rm saida/util.js`, que ja estava em `saida/*.js`, foi barrado e a
 * tarefa ficou pela metade - D7). Todos os arquivos nomeados estao no escopo da ABERTURA do turno (a foto da A5e)?
 * Entao a ampliacao nao muda nada para eles, e o apagar segue para as conferencias de sempre. Sem a foto (sem git, sem
 * escopo na abertura), false: a A5b barra como antes.
 */
function nomeadosNaAbertura(e, comando, raiz, ab) {
  if (!ab || !Array.isArray(ab.dentro)) return false;
  const nomes = destrutivo.arquivosNomeados(comando, e.tool_name);
  if (!nomes || !nomes.length) return false;
  const path = require('node:path');
  const escopoLib = require('./lib/escopo.js');
  const caminho = require('./lib/caminho.js');
  const esc = { dentro: ab.dentro, fora: Array.isArray(ab.fora) ? ab.fora : [] };
  return nomes.every(function (nome) {
    const rel = caminho.relativoAoProjeto(path.resolve(e.cwd || process.cwd(), nome), raiz);
    return !!rel && escopoLib.dentro(rel, esc) && !escopoLib.declaradoFora(rel, esc);
  });
}

io.blindar(function () {
  io.lerEntrada(function (e) {
    const comando = (e.tool_input || {}).command;
    if (!comando) return io.permitir();

    const raiz = config.raizDoProjeto(e.cwd || process.cwd());
    const projeto = config.carregarProjeto(raiz);

    // D786 passo 5 (s348, rodada ccds2: o DeepSeek recebeu "releia" e seguiu por Add-Content no PowerShell): o "releia"
    // do compact tambem e cobrado no shell do agente principal, antes de tudo (o escape e as travas sao do destrutivo).
    // Todo comando salvo o que cita o handoff: ele e a releitura onde nao ha Read (Codex, dsh), e o PostToolUse
    // (marcar-trabalho.js) o conta como cumprida. Uma contagem so com o portao do Write/Edit (reinjecao.cobrarOrdem),
    // mesmo balde e mesmo motivo.
    // atalho: o "grave primeiro" nao e cobrado aqui. limite: a skill do handoff roda comandos (a hora, os agentes
    // rodando), e o shell segue livre ate o handoff novo. trocar quando: uma rodada ao vivo mostrar o modelo seguindo
    // pelo shell sem gravar o handoff pedido.
    // Tudo no try: este bloco roda antes do portao destrutivo, e uma excecao aqui (que o io.blindar viraria permitir)
    // nunca pode deixar passar o comando destrutivo. Falhou: sem cobranca, e o comando segue para os portoes abaixo.
    let motivoDaOrdem = null;
    try {
      const ordem = estado.ler(e.session_id).ordemDoCompact;
      const reinjecao = require('./lib/reinjecao.js');
      if (!e.agent_id && ordem && typeof ordem === 'object' && ordem.tipo === 'reler' &&
          typeof ordem.arquivo === 'string' && require('node:fs').existsSync(ordem.arquivo) &&
          !reinjecao.comandoCitaHandoff(comando, ordem.arquivo) && reinjecao.cobrarOrdem(e.session_id)) {
        try { estado.incrementar(e.session_id, 'ordem_do_compact'); } catch (err) { /* idem: o balde vale menos */ }
        motivoDaOrdem = reinjecao.motivoDaOrdem(ordem, raiz);
      }
    } catch (err) { motivoDaOrdem = null; }
    if (motivoDaOrdem) return io.negarFerramenta(motivoDaOrdem);

    // X2b: o botao honesto de desligar. Substitui o comandosLiberados:[".*"],
    // que desligava o portao por efeito colateral e sem dizer que desligava.
    // So `=== false` literal desliga: "false", 0, null e ausente ficam LIGADOS.
    const travas = projetoLib.travasDe(projeto);
    if (travas.destrutivo === false) return io.permitir();

    // Escape declarado pelo dono, em projeto.json.
    // X1: texto itera letra a letra no for..of e libera quase tudo; objeto e
    // numero ESTOURAM, e io.blindar (io.js:69) vira exit 0 mudo - portao que
    // estoura PERMITE. No lado LIBERADO, "nao entendi o valor" tem de virar
    // NEGO: quem escreveu sem colchetes le o motivo e corrige, e permitir
    // "rm -rf /" calado nao tem desfazer. O lado bloqueado e o contrario, e
    // por isso nao muda nesta rodada (D105).
    const brutos = projeto && projeto.comandosLiberados;
    const liberados = Array.isArray(brutos) ? brutos : [];
    for (const padrao of liberados) {
      // X1 um nivel abaixo: new RegExp faz ToString. [".*"] vira ".*", [] vira
      // "" (universal) e {} vira "[object Object]" - classe de caracteres COM
      // espaco, que casa quase todo comando. E o mesmo idioma que validar() ja
      // usa em projeto.js:143, e que este laco nunca herdou.
      if (typeof padrao !== 'string') continue;
      try { if (new RegExp(padrao, 'i').test(comando)) return io.permitir(); } catch (err) { /* ignora padrao ruim */ }
    }

    const shell = require('./lib/shell.js');
    const problemas = shell.conferir(comando, projeto && projeto.plataforma, e.tool_name);
    if (problemas.length) {
      // D420/SH-02: o contador e acessorio. Estado fora do ar (diretorio nao gravavel) lancava aqui,
      // `io.blindar` liberava e o comando RODAVA: o incrementar nunca pode ficar entre o veredito e a negacao.
      let tentativa = 1;
      try { tentativa = estado.incrementar(e.session_id, 'shell_idioma_errado'); } catch (err) { /* o balde vale menos que a negacao */ }
      return io.negarFerramenta(shell.motivoIdioma(comando, problemas, tentativa));
    }

    const r = destrutivo.classificar(comando, projeto);
    // A5b (s369): o escopo ampliado neste turno nao vale para apagar (o da abertura do turno vale); o turno seguinte,
    // aberto pela mensagem do dono, libera.
    let ampliadoNoTurno = false;
    let naAbertura = false;
    /* o estado que nao se le nao derruba o portao (o io.blindar liberaria o comando inteiro): segue sem a marca */
    let s = {};
    try {
      s = estado.ler(e.session_id);
      ampliadoNoTurno = s.escopoAmpliadoNoTurno === true;
    } catch (err) {
      ampliadoNoTurno = false;
    }
    // revisao (P1): try proprio - a foto torta que fizesse lancar nao pode zerar a marca acima; falhou, a A5b barra
    try { naAbertura = ampliadoNoTurno && nomeadosNaAbertura(e, comando, raiz, s.aberturaDoTurno); } catch (err) {
      naAbertura = false;
    }
    if (ampliadoNoTurno && !naAbertura && (destrutivo.arquivosNomeados(comando, e.tool_name) ||
      destrutivo.temApagar(comando) || destrutivo.apagaPorApi(comando, e.tool_name))) {
      try { estado.incrementar(e.session_id, 'comando_destrutivo'); } catch (err) { /* o balde vale menos */ }
      return io.negarFerramenta(destrutivo.motivo(comando, { motivo: destrutivo.MOTIVO_APAGAR_DEPOIS_DE_AMPLIAR }));
    }
    if (r.destrutivo && apagaSoNoEscopo(e, comando, raiz, projeto)) return io.permitir();
    const fora = r.destrutivo ? null : apagarForaDoEscopo(e, comando, raiz, projeto);
    if (fora) {
      try { estado.incrementar(e.session_id, 'comando_destrutivo'); } catch (err) { /* o balde vale menos */ }
      return io.negarFerramenta(destrutivo.motivo(comando, { motivo: fora }));
    }
    if (r.destrutivo) {
      // D420/SH-02: idem - o contador nunca impede a negacao.
      try { estado.incrementar(e.session_id, 'comando_destrutivo'); } catch (err) { /* idem */ }
      return io.negarFerramenta(destrutivo.motivo(comando, r));
    }

    // 0.3.4/item 2 (D286): por ULTIMO, depois do escape e dos dois portoes acima - o que ja era
    // negado segue negado pelo mesmo motivo e no mesmo balde. O `cd` solto deixa a pasta errada
    // para o comando seguinte; a mensagem mostra a forma certa.
    const solto = shell.cdSolto(comando, e.tool_name, projeto && projeto.plataforma);
    // D486 (s108): na ferramenta Bash, declarada, o comando vai em subshell pelo updatedInput (provado com
    // `claude -p` no 2.1.296) em vez de negado. Sem permissionDecision: a pergunta de permissao normal segue. Nao
    // enche o cd_solto, que e balde de bloqueio. O que nao da para envolver segue negado, abaixo.
    const envolto = solto && e.tool_name === 'Bash' ? shell.envolverEmSubshell(comando, solto) : null;
    if (envolto) {
      // D569: o aviso inteiro sai uma vez por sessao; depois, a linha curta. Estado fora do ar: inteiro (avisar a mais
      // e melhor que calar, como o F3-20 abaixo).
      let jaAvisou = false;
      try {
        estado.alterar(e.session_id, function (s) {
          jaAvisou = !!s.avisouCdCorrigido;
          s.avisouCdCorrigido = true;
          return s;
        });
      } catch (err) { jaAvisou = false; }
      return io.permitir({ hookSpecificOutput: { hookEventName: 'PreToolUse',
        updatedInput: Object.assign({}, e.tool_input, { command: envolto }),
        additionalContext: shell.avisoCdCorrigido(solto, jaAvisou) } });
    }
    if (solto) {
      // D420/SH-02: idem.
      try { estado.incrementar(e.session_id, 'cd_solto'); } catch (err) { /* idem */ }
      return io.negarFerramenta(shell.motivoCdSolto(comando, solto));
    }

    // 0.3.5/D294: tabela do PowerShell (ou regra dela) que nao se le -> o comando PASSA e sai aviso,
    // uma vez por SESSAO. Nada se nega por arquivo estragado. Molde do portao-apelido: `systemMessage`
    // chega ao USUARIO e `additionalContext` ao agente; sem `permissionDecision` (um "allow" pularia
    // a pergunta de permissao que o usuario veria normalmente).
    const quebra = shell.problemasDaTabela(projeto && projeto.plataforma, e.tool_name);
    if (quebra.length) avisarUmaVez(e.session_id, 'avisouTabelaShell', () => shell.avisoTabela(quebra));
    // D721 (A1-06): padrao de comandosBloqueados que nao compila nao barra nada; o mesmo aviso de uma vez por sessao.
    const recusadas = destrutivo.regrasRecusadas(projeto);
    if (recusadas.length) {
      avisarUmaVez(e.session_id, 'avisouBloqueadoInvalido', () => destrutivo.avisoRecusadas(recusadas));
    }

    io.permitir();
  });
});
