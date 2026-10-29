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

io.blindar(function () {
  io.lerEntrada(function (e) {
    const comando = (e.tool_input || {}).command;
    if (!comando) return io.permitir();

    const projeto = config.carregarProjeto(config.raizDoProjeto(e.cwd || process.cwd()));

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
