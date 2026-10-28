#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const io = require('./lib/io.js');
const estado = require('./lib/estado.js');
const config = require('./lib/config.js');
const agentesLib = require('./lib/agentes.js');
const apelidos = require('./lib/apelidos.js');

function arg(nome) {
  const i = process.argv.indexOf('--' + nome);
  return i !== -1 ? process.argv[i + 1] : null;
}
function tem(nome) { return process.argv.indexOf('--' + nome) !== -1; }

/**
 * S8/L2-ape-2: caminho que o AGENTE vai copiar para o shell. Aspas duplas servem ao caso normal (espaco,
 * acento, `\` do Windows); com `$`, crase ou `"` o shell reinterpretaria o pedaco, entao vai entre aspas
 * simples (vale no Bash e no PowerShell). Com `'` tambem, so sobra escapar para o Bash.
 * (O mesmo helper existe em abertura.js: os dois sao scripts de entrada e nao dividem lib.)
 */
function caminhoParaShell(p) {
  if (!/[$`"]/.test(p)) return '"' + p + '"';
  if (p.indexOf("'") === -1) return "'" + p + "'";
  return '"' + p.replace(/([\\$`"])/g, '\\$1') + '"';
}

function conferirAqui(cwd) {
  return apelidos.conferir(config.carregarProjeto(cwd), agentesLib.listar(cwd));
}

// ------------------------------------------------------- modo leitura: --mapa
// A T38 (gatilho 2) come daqui. A skill roda no agente principal, que e o unico
// que recebe o catalogo do harness; o que ela NAO tem e o que este projeto
// gravou. Imprimir o mapa evita que ela o leia de memoria.
if (tem('mapa')) {
  const cwd = process.cwd();
  const r = conferirAqui(cwd);
  process.stdout.write(JSON.stringify({
    verificavel: r.verificavel,
    motivo: r.motivo,
    divergencias: r.divergencias,
    naoDeclarados: r.naoDeclarados,
    semArquivo: r.semArquivo,
    foraDoMapa: r.foraDoMapa,
    esforcoDivergente: r.esforcoDivergente,
    esforcoNaoDeclarado: r.esforcoNaoDeclarado
  }, null, 2) + '\n');
  process.exit(0);
}

// -------------------------------------------------- modo conserto: --corrigir
if (tem('corrigir')) {
  const cwd = process.cwd();
  const alvo = arg('corrigir');
  const destino = arg('para');
  if (!alvo || (destino !== 'arquivo' && destino !== 'mapa')) {
    process.stdout.write('ERRO: diga o agente e a direcao.\n');
    process.stdout.write('  --corrigir <agente> --para arquivo   (o arquivo passa a dizer o que o mapa diz)\n');
    process.stdout.write('  --corrigir <agente> --para mapa      (o mapa passa a dizer o que o arquivo diz)\n');
    process.exit(1);
  }
  const r = conferirAqui(cwd);
  const deste = function (x) { return x.agente === alvo; };
  // D678 T1: o modelo e o esforco do mesmo agente se consertam no mesmo ato e na mesma direcao.
  const d = r.divergencias.filter(deste)[0];
  const de = r.esforcoDivergente.filter(deste)[0];
  if (!d && !de) {
    // Recusar aqui nao e preciosismo: sem divergencia nao ha o que consertar, e
    // escrever assim mesmo seria gravar na pasta de alguem sem motivo nenhum.
    process.stdout.write('NADA A CORRIGIR: "' + alvo + '" nao esta divergindo agora.\n');
    process.exit(1);
  }

  if (destino === 'arquivo') {
    // A1-15: pelo arquivo que o --mapa mostra, nao pelo nome - o `name:` do frontmatter pode diferir dele.
    const arquivo = agentesLib.caminho(cwd, String((d || de).arquivo).replace(/\.md$/, ''));
    let bruto;
    try { bruto = fs.readFileSync(arquivo, 'utf8'); }
    catch (e) {
      process.stdout.write('ERRO: nao consegui ler ' + arquivo + ': ' + e.message + '\n');
      process.exit(1);
    }
    let t = { ok: true, texto: bruto, motivo: null };
    if (d) t = apelidos.trocarModel(t.texto, d.gravado);
    if (t.ok && de) t = apelidos.trocarCampo(t.texto, 'effort', de.gravado);
    if (!t.ok) {
      process.stdout.write('RECUSADO: ' + t.motivo + '\n');
      process.stdout.write('Este arquivo e trabalho de alguem; corrija a mao.\n');
      process.exit(1);
    }
    fs.writeFileSync(arquivo, t.texto, 'utf8');
    process.stdout.write('CORRIGIDO ' + arquivo + '\n');
    if (d) {
      process.stdout.write('  antes: model: ' + d.declarado + '\n');
      process.stdout.write('  agora: model: ' + d.gravado + '\n');
    }
    if (de) {
      process.stdout.write('  antes: effort: ' + de.declarado + '\n');
      process.stdout.write('  agora: effort: ' + de.gravado + '\n');
    }
    process.exit(0);
  }

  const cfg = path.join(cwd, '.claude', 'sworn', 'projeto.json');
  const obj = config.carregarProjeto(cwd);
  let achou = false;
  for (const degrau of ((obj.agentes || {}).degraus || [])) {
    if (degrau.agente !== alvo) continue;
    if (d) degrau.apelido = d.declarado;
    if (de) degrau.esforco = de.declarado;
    achou = true;
  }
  if (!achou) {
    process.stdout.write('ERRO: "' + alvo + '" nao esta nos degraus gravados.\n');
    process.exit(1);
  }
  fs.writeFileSync(cfg, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  process.stdout.write('CORRIGIDO ' + cfg + '\n');
  if (d) {
    process.stdout.write('  antes: ' + alvo + ' -> ' + d.gravado + '\n');
    process.stdout.write('  agora: ' + alvo + ' -> ' + d.declarado + '\n');
  }
  if (de) {
    process.stdout.write('  antes: ' + alvo + ' -> esforco ' + de.gravado + '\n');
    process.stdout.write('  agora: ' + alvo + ' -> esforco ' + de.declarado + '\n');
  }
  process.exit(0);
}

// ------------------------------------------------------------- modo hook
io.blindar(function () {
  io.lerEntrada(function (e) {
    const cwd = config.raizDoProjeto(e.cwd || process.cwd());
    const r = conferirAqui(cwd);

    // "Nao verificavel" nao vira aviso: viraria ruido em todo projeto sem
    // agentes. Vira REGISTRO na sessao - que hoje nenhum script le: o relatorio
    // de cobertura (T41) refaz a conferencia por conta propria, e e ele que nao
    // deixa o caso passar calado, o unico desfecho proibido.
    estado.alterar(e.session_id, function (s) {
      s.gatilho3 = {
        verificavel: r.verificavel, motivo: r.motivo, divergentes: r.divergencias.length,
        esforcoDivergentes: r.esforcoDivergente.length
      };
      return s;
    });

    if (!r.verificavel || r.divergencias.length + r.esforcoDivergente.length === 0) return io.permitir();

    estado.incrementar(e.session_id, 'apelido_divergente');
    const s = estado.ler(e.session_id);
    if (s.avisouApelido) return io.permitir();
    estado.alterar(e.session_id, function (x) { x.avisouApelido = true; return x; });

    // Decisao 15 do dono: avisa, deixa passar, e mostra o conserto na hora.
    // Os dois canais de proposito - `systemMessage` chega ao USUARIO (medido em
    // 2026-08-08) e `additionalContext` ao agente, que e quem pode oferecer o
    // conserto em um clique. NAO se manda `permissionDecision`: "allow" pularia
    // a pergunta de permissao que o usuario veria normalmente, e este portao
    // nao foi convidado a decidir isso.
    const texto = apelidos.motivo(r);
    return io.permitir({
      systemMessage: texto,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: texto + '\n\n' + [
          'Ofereca ao dono, em 3 opcoes, e rode a que ele escolher:',
          '  a) node ' + caminhoParaShell(__filename) + ' --corrigir <agente> --para arquivo',
          '  b) node ' + caminhoParaShell(__filename) + ' --corrigir <agente> --para mapa',
          '  c) nao mexer agora - fica registrado no relatorio de cobertura.'
        ].join('\n')
      }
    });
  });
});
