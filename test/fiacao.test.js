'use strict';
// Familia A — "a fiacao nao tem prova". Sete achados (R-T15-01, R-T22-05, R-T23-01,
// R-T24-01, R-T25-01, R-T26-01, R-T27-02) diziam a mesma coisa: desfazer a ligacao
// entre o script de entrada e a lib deixa a suite IDENTICA. Aqui cada script de
// entrada e exercido COMO PROCESSO, e cada skill tem o frontmatter conferido —
// que e exatamente o que o `claude plugin validate --strict` NAO ve (R-T15-01).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const auditoria = require('../scripts/lib/auditoria.js');
const shellLib = require('../scripts/lib/shell.js');

function temp(nome) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-fiacao-' + nome + '-'));
}

/** Roda um script de entrada como processo, com estado de sessao isolado. */
function rodar(script, dir, entrada) {
  const sessoes = path.join(dir, '_sessoes');
  return spawnSync(process.execPath, [path.join(RAIZ, 'scripts', script)], {
    cwd: dir,
    encoding: 'utf8',
    input: entrada === undefined ? undefined : JSON.stringify(entrada),
    env: Object.assign({}, process.env, { SWORN_TMP: sessoes })
  });
}

function lerSessao(dir, id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, '_sessoes', 'sworn', id + '.json'), 'utf8'));
  } catch (e) {
    return null;
  }
}

function escrever(dir, rel, conteudo) {
  const alvo = path.join(dir, rel);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, conteudo, 'utf8');
}

// ---------------------------------------------------------------- A1: a fiacao

test('fiacao: auditar.js enxerga uma skill real e devolve exatamente as chaves do relatorio (R-T27-02)', () => {
  const dir = temp('auditar');
  try {
    escrever(dir, path.join('.claude', 'skills', 'zelador', 'SKILL.md'),
      '---\nname: zelador\ndescription: varre a casa\n---\n\n- um item de instrucao\n- outro item\n');

    const r = rodar('auditar.js', dir);
    assert.strictEqual(r.status, 0, r.stderr);

    const saida = JSON.parse(r.stdout);
    // 0.3.5 (D291 §4): o nome dizia "seis" com sete chaves, e o teste so conferia presenca - chave
    // nova ou sumida passava calada. Agora e o conjunto exato.
    assert.deepStrictEqual(Object.keys(saida).sort(),
      // D615 (L10): doPlugin, o cruzamento das skills do projeto com as do plugin.
      // D674 (item 15): idadeDasRegras e memorias, a idade de cada regra e de cada memoria.
      // D706 (escada T5): efetivo, o modelo e o esforco que os subagentes de fato usaram.
      ['contradicoes', 'delegaveis', 'doPlugin', 'efetivo', 'foraDaRubrica', 'idadeDasRegras', 'injetado', 'memoria', 'memorias',
        'peso', 'regras', 'skills', 'sobreposicoes'],
      'as chaves do relatorio mudaram: ' + Object.keys(saida).join(', '));
    // lerSkills() achou a skill, e instrucoes.contar() contou os itens dela.
    assert.deepStrictEqual(saida.skills, ['zelador'], r.stdout);
    assert.strictEqual(saida.peso.total, 2, 'os dois itens de lista da SKILL.md');
    // rubrica.conferir() rodou de verdade: skill de brinquedo nao passa na rubrica.
    assert.strictEqual(saida.foraDaRubrica.length, 1, r.stdout);
    assert.strictEqual(saida.foraDaRubrica[0].skill, 'zelador');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fiacao: normalizar, termos e VAZIAS sao exercidos (R-T27-02)', () => {
  // normalizar: caixa some, acento some, pontuacao vira separador.
  assert.deepStrictEqual(auditoria.normalizar('ao concluir a REVISAO, cedo!'),
    ['ao', 'concluir', 'a', 'revisao', 'cedo']);
  assert.deepStrictEqual(auditoria.normalizar('REVISÃO'), ['revisao'], 'acento tem de cair');

  // termos: descarta palavra de 3 letras ou menos, e descarta as VAZIAS.
  const t = auditoria.termos('quando o usuario pedir revisao do codigo');
  assert.ok(t.has('revisao') && t.has('codigo'), Array.from(t).join(','));
  assert.ok(!t.has('quando'), '"quando" esta em VAZIAS');
  assert.ok(!t.has('usuario'), '"usuario" esta em VAZIAS');
  assert.ok(!t.has('do'), 'palavra curta nao entra');

  assert.ok(auditoria.VAZIAS.has('quando') && auditoria.VAZIAS.has('projeto'));
});

test('fiacao: portao-agente conta todo despacho, mesmo quando permite (R-T24-01)', () => {
  const dir = temp('agente-ok');
  try {
    const r = rodar('portao-agente.js', dir,
      { session_id: 'fa1', cwd: dir, tool_name: 'Task', tool_input: { subagent_type: 'arquiteto' } });
    assert.strictEqual(r.status, 0, r.stderr);

    const s = lerSessao(dir, 'fa1');
    assert.ok(s, 'o portao tinha de ter gravado estado de sessao');
    assert.strictEqual(s.contadores.agentes_despachados, 1, JSON.stringify(s));
    // sem projeto.json nao ha escada, entao nao pode ter negado
    assert.strictEqual(s.contadores.agente_caro_em_marcha_rapida, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fiacao: portao-agente nega o agente do topo em escopo so de marcha rapida (R-T24-01)', () => {
  const dir = temp('agente-nega');
  try {
    escrever(dir, path.join('.claude', 'sworn', 'projeto.json'), JSON.stringify({
      marchaPadrao: 'padrao',
      marchas: { rapida: ['**/*.md'] },
      agentes: { escada: ['busca-rapida', 'tarefas-simples', 'desenvolvedor', 'arquiteto', 'especialista'] }
    }));
    escrever(dir, path.join('.claude', 'sworn', 'escopo.md'),
      '**objetivo:** corrigir um typo\n\n## dentro\n\n- docs/nota.md\n\n## fora\n\n- tudo o mais\n');

    const r = rodar('portao-agente.js', dir,
      { session_id: 'fa2', cwd: dir, tool_name: 'Task', tool_input: { subagent_type: 'especialista' } });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(/agente caro demais para um trabalho simples/i.test(r.stdout), r.stdout);
    assert.ok(r.stdout.includes('especialista'), r.stdout);

    const s = lerSessao(dir, 'fa2');
    assert.strictEqual(s.contadores.agente_caro_em_marcha_rapida, 1, JSON.stringify(s));
    assert.strictEqual(s.contadores.agentes_despachados, 1, 'conta o despacho tambem quando nega');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fiacao: portao-agente nega o degrau chamado com model fora da tabela e conta no balde proprio (D678 T2)', () => {
  const dir = temp('agente-tabela');
  try {
    escrever(dir, path.join('.claude', 'sworn', 'projeto.json'), JSON.stringify({
      marchaPadrao: 'padrao',
      agentes: { degraus: [{ agente: 'tarefas-simples', apelido: 'haiku', esforco: 'low' },
        { agente: 'desenvolvedor', apelido: 'sonnet', esforco: 'medium' }] }
    }));
    const r = rodar('portao-agente.js', dir, { session_id: 'fa10', cwd: dir, tool_name: 'Agent',
      tool_input: { subagent_type: 'desenvolvedor', model: 'opus', prompt: 'p' } });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(/"permissionDecision"\s*:\s*"deny"/.test(r.stdout), r.stdout);
    assert.ok(/chamada fora da tabela da escada/.test(r.stdout), r.stdout);
    const s = lerSessao(dir, 'fa10');
    assert.strictEqual(s.contadores.chamada_fora_da_tabela, 1, JSON.stringify(s));
    assert.strictEqual(s.contadores.agentes_despachados, 1, 'conta o despacho tambem quando nega');

    const certo = rodar('portao-agente.js', dir, { session_id: 'fa11', cwd: dir, tool_name: 'Agent',
      tool_input: { subagent_type: 'desenvolvedor', model: 'sonnet', effort: 'medium', prompt: 'p' } });
    assert.strictEqual(certo.stdout, '', 'a chamada como a tabela passa: ' + certo.stdout);
    assert.strictEqual(lerSessao(dir, 'fa11').contadores.chamada_fora_da_tabela, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fiacao: portao-agente usa o escopo da frente vinculada, nao o escopo.md geral (escopo por frente)', () => {
  const dir = temp('agente-frente');
  try {
    escrever(dir, path.join('.claude', 'sworn', 'projeto.json'), JSON.stringify({
      marchaPadrao: 'padrao',
      marchas: { rapida: ['**/*.md'], padrao: ['src/**'] },
      agentes: { escada: ['busca-rapida', 'tarefas-simples', 'desenvolvedor', 'arquiteto', 'especialista'] }
    }));
    // o escopo.md geral so tem caminho de marcha rapida: despachar 'especialista' seria negado por ele.
    escrever(dir, path.join('.claude', 'sworn', 'escopo.md'),
      '**objetivo:** geral\n\n## dentro\n\n- docs/nota.md\n');
    // a frente vinculada tem um caminho de marcha padrao: o topo da escada passa a ser permitido.
    escrever(dir, path.join('.claude', 'sworn', 'escopos', 'omni.md'),
      '**objetivo:** onda\n\n## dentro\n\n- src/a.js\n');
    const sessoes = path.join(dir, '_sessoes', 'sworn');
    fs.mkdirSync(sessoes, { recursive: true });
    fs.writeFileSync(path.join(sessoes, 'fa9.json'), JSON.stringify({ frente: 'omni' }), 'utf8');

    const r = rodar('portao-agente.js', dir,
      { session_id: 'fa9', cwd: dir, tool_name: 'Task', tool_input: { subagent_type: 'especialista' } });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout, '',
      'a frente vinculada tem caminho de marcha padrao: nao pode negar o topo da escada; stdout: ' + r.stdout);

    const s = lerSessao(dir, 'fa9');
    assert.strictEqual(s.contadores.agente_caro_em_marcha_rapida, undefined,
      'usou o escopo.md geral (so rapida) em vez da frente vinculada (tem padrao)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fiacao: abrir-turno zera as marcas do turno e PRESERVA os contadores (R-T26-01, D123)', () => {
  const dir = temp('abrir-turno');
  try {
    const sessoes = path.join(dir, '_sessoes', 'sworn');
    fs.mkdirSync(sessoes, { recursive: true });
    fs.writeFileSync(path.join(sessoes, 'fa3.json'), JSON.stringify({
      trabalhoReal: true,
      bloqueouNesteTurno: true,
      buscouNesteTurno: true,
      contadores: { comando_destrutivo: 4 },
      gitAbertura: ['src/a.js']
    }), 'utf8');

    const r = rodar('abrir-turno.js', dir, { session_id: 'fa3', cwd: dir });
    assert.strictEqual(r.status, 0, r.stderr);

    const s = lerSessao(dir, 'fa3');
    assert.strictEqual(s.trabalhoReal, undefined, 'a marca do turno tinha de sumir');
    assert.strictEqual(s.bloqueouNesteTurno, undefined, 'a marca do turno tinha de sumir');
    // ronda 1 do 8b: a busca tambem e do turno - senao o turno que so leu libera criar no seguinte
    assert.strictEqual(s.buscouNesteTurno, undefined, 'a marca de busca tinha de sumir');
    // D123: o balde de contador nao pode ser zerado aqui, senao o ledger da D14 perde o dado.
    assert.strictEqual(s.contadores.comando_destrutivo, 4, 'o contador tinha de sobreviver');
    assert.deepStrictEqual(s.gitAbertura, ['src/a.js'], 'a foto do git tinha de sobreviver');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fiacao: gerar-skill sem projeto.json manda rodar o init, em vez de estourar (R-T25-01)', () => {
  const dir = temp('gerar-skill');
  try {
    const r = rodar('gerar-skill.js', dir);
    assert.notStrictEqual(r.status, 0, 'sem configuracao ele tem de recusar');
    const saida = r.stdout + r.stderr;
    assert.ok(/sworn:init/.test(saida), saida);
    assert.ok(/projeto\.json/.test(saida), saida);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------- A2: o que o --strict nao ve

test('fiacao: toda skill do plugin tem frontmatter valido (R-T15-01, R-T22-05)', () => {
  // O `claude plugin validate --strict` passa mesmo com a linha `name:` removida de
  // uma SKILL.md — medido com controle positivo na T15. Esta e a prova que falta.
  const dirSkills = path.join(RAIZ, 'skills');
  const nomes = fs.readdirSync(dirSkills).filter(function (n) {
    return fs.statSync(path.join(dirSkills, n)).isDirectory();
  });
  assert.ok(nomes.length >= 1, 'o plugin tem de ter pelo menos uma skill');

  for (const nome of nomes) {
    const arquivo = path.join(dirSkills, nome, 'SKILL.md');
    assert.ok(fs.existsSync(arquivo), nome + ': falta SKILL.md');

    const texto = fs.readFileSync(arquivo, 'utf8');
    const m = texto.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    assert.ok(m, nome + ': SKILL.md sem frontmatter delimitado por ---');

    const campos = m[1];
    const mNome = campos.match(/^name:\s*(.+)$/m);
    assert.ok(mNome, nome + ': frontmatter sem campo name');
    assert.strictEqual(mNome[1].trim(), nome, nome + ': o name do frontmatter nao bate com a pasta');

    const mDesc = campos.match(/^description:\s*(.+)$/m);
    assert.ok(mDesc, nome + ': frontmatter sem campo description');
    assert.ok(mDesc[1].trim().length > 0, nome + ': description vazia');
  }
});

// Colheita 10-20, item 16: o mesmo para os agentes do plugin. `apelidos-vivos.test.js` le agents/*.md, mas deixa de
// fora o arquivo sem frontmatter - um agente quebrado sumia calado.
test('fiacao: todo agente do plugin tem frontmatter com name igual ao arquivo e description', () => {
  const agentesLib = require('../scripts/lib/agentes.js');
  const dirAgentes = path.join(RAIZ, 'agents');
  const arquivos = fs.readdirSync(dirAgentes).filter(function (n) { return n.endsWith('.md'); });
  assert.ok(arquivos.length >= 1, 'o plugin tem de ter pelo menos um agente');

  for (const arquivo of arquivos) {
    const f = agentesLib.frontmatter(fs.readFileSync(path.join(dirAgentes, arquivo), 'utf8'));
    assert.ok(f.ok, arquivo + ': sem frontmatter delimitado por ---');
    assert.strictEqual(f.campos.name, arquivo.slice(0, -3), arquivo + ': o name do frontmatter nao bate com o arquivo');
    assert.ok(f.campos.description, arquivo + ': frontmatter sem description');
  }
});

// Colheita 10-20, item 16: script novo sem teste reprova sozinho. Parte deles nao tem teste de mesmo nome, porque e
// testada pela lib ou pelo gancho (`portao-destrutivo.js` em destrutivo.test.js), entao a prova e o nome do script
// citado em algum test/*.test.js (require, spawn ou `rodar`).
// atalho: citar o nome. limite: um comentario que cita o nome conta como teste.
// trocar quando: um script passar so por citacao em comentario.
test('fiacao: todo scripts/*.js e citado por algum teste', () => {
  const dirTeste = path.join(RAIZ, 'test');
  const testes = fs.readdirSync(dirTeste).filter(function (n) { return n.endsWith('.test.js'); })
    .map(function (n) { return fs.readFileSync(path.join(dirTeste, n), 'utf8'); }).join('\n');
  const semTeste = fs.readdirSync(path.join(RAIZ, 'scripts'))
    .filter(function (n) { return n.endsWith('.js') && testes.indexOf(n) === -1; });
  assert.deepStrictEqual(semTeste, [], 'script sem nenhum teste que o cite: ' + semTeste.join(', '));
});

// ------------------------- A3: os dois que a medicao da D130 achou ABERTOS
// A D130 secao 3 desmentiu o agrupamento: o rotulo "familia A" cobria sete
// achados, mas dois deles apontavam para codigo que nenhum dos outros toca.
// Desfazer a fiacao destes dois deixava a suite em 369 | 369 | fail 0 —
// identica. Estes cinco testes sao a prova que faltava.
const destrutivoLib = require('../scripts/lib/destrutivo.js');

const PLATAFORMA_WIN = { so: 'win32', shell: 'powershell' };

function comPlataforma(dir, plataforma) {
  escrever(dir, path.join('.claude', 'sworn', 'projeto.json'),
    JSON.stringify({ plataforma: plataforma }));
}

/** O motivo que o portao devolveu ao negar, ou null se ele permitiu. */
function motivoNegado(r) {
  try {
    return JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason;
  } catch (e) {
    return null;
  }
}

test('fiacao: portao-destrutivo nega idioma de shell errado e conta a tentativa (R-T23-01)', () => {
  const dir = temp('shell-nega');
  try {
    // `head` e inofensivo: se ESTE comando e negado, quem negou foi shell.conferir.
    assert.strictEqual(destrutivoLib.classificar('head -5 notas.txt', null).destrutivo, false,
      'o comando de controle nao pode ser destrutivo, senao o teste nao prova nada');

    comPlataforma(dir, PLATAFORMA_WIN);
    const r = rodar('portao-destrutivo.js', dir,
      // D244/defeito 4: a tabela do win32 descreve o PowerShell; a ferramenta Bash e Git Bash.
      { session_id: 'fa4', cwd: dir, tool_name: 'PowerShell', tool_input: { command: 'head -5 notas.txt' } });
    assert.strictEqual(r.status, 0, r.stderr);

    const motivo = motivoNegado(r);
    assert.ok(motivo, 'o portao tinha de ter negado; stdout: ' + JSON.stringify(r.stdout));
    assert.ok(/idioma de shell errado/i.test(motivo), motivo);
    // a sugestao vem da tabela em modelos/shell-win32.json, nao de texto solto
    assert.ok(motivo.includes('Get-Content arq -TotalCount N'), 'faltou a sugestao da tabela: ' + motivo);

    const s = lerSessao(dir, 'fa4');
    assert.ok(s, 'o portao tinha de ter gravado estado de sessao');
    assert.strictEqual(s.contadores.shell_idioma_errado, 1, JSON.stringify(s));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fiacao: o MESMO comando passa quando a plataforma nao e a da tabela (R-T23-01)', () => {
  // Controle: prova que a negacao acima veio da tabela carregada pela plataforma
  // declarada (F16), e nao de alguma outra regra do portao casando `head` por acaso.
  const dir = temp('shell-passa');
  try {
    comPlataforma(dir, { so: 'linux', shell: 'bash' });
    const r = rodar('portao-destrutivo.js', dir,
      { session_id: 'fa5', cwd: dir, tool_name: 'Bash', tool_input: { command: 'head -5 notas.txt' } });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout, '', 'fora da plataforma da tabela o portao tem de permitir calado');
    assert.strictEqual(lerSessao(dir, 'fa5'), null, 'permitir nao enche balde de contador');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fiacao: o portao de shell responde ANTES do de comando destrutivo (R-T23-01)', () => {
  // `rm -rf build` e as DUAS coisas ao mesmo tempo. A ordem dos dois portoes
  // nunca teve cobertura (D130 secao 6): trocar shell.conferir por [] fazia o
  // portao destrutivo responder no lugar, e a suite nao percebia a troca.
  const dir = temp('ordem');
  try {
    assert.strictEqual(destrutivoLib.classificar('rm -rf build', null).destrutivo, true,
      'o comando de controle tem de ser destrutivo, senao este teste nao prova ordem');

    comPlataforma(dir, PLATAFORMA_WIN);
    const r = rodar('portao-destrutivo.js', dir,
      { session_id: 'fa6', cwd: dir, tool_name: 'PowerShell', tool_input: { command: 'rm -rf build' } });
    assert.strictEqual(r.status, 0, r.stderr);

    const motivo = motivoNegado(r);
    assert.ok(motivo, 'o portao tinha de ter negado; stdout: ' + JSON.stringify(r.stdout));
    assert.ok(/idioma de shell errado/i.test(motivo), 'respondeu o portao errado: ' + motivo);
    assert.ok(motivo.includes('Remove-Item -Recurse -Force'), motivo);

    const s = lerSessao(dir, 'fa6');
    assert.strictEqual(s.contadores.shell_idioma_errado, 1, JSON.stringify(s));
    assert.strictEqual(s.contadores.comando_destrutivo, undefined,
      'o balde do destrutivo nao pode encher quando quem negou foi o portao de shell');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- 0.3.4/item 2 (D286): o `cd` solto e negado, com balde proprio e depois das outras conferencias

const PLATAFORMA_LINUX = { so: 'linux', shell: 'bash' };

function chamar(dir, id, ferramenta, comando) {
  const r = rodar('portao-destrutivo.js', dir,
    { session_id: id, cwd: dir, tool_name: ferramenta, tool_input: { command: comando } });
  assert.strictEqual(r.status, 0, r.stderr);
  return r;
}

/** D486 (s108): o que o portao devolveu ao corrigir o comando (updatedInput), ou null. */
function corrigido(r) {
  try {
    const h = JSON.parse(r.stdout).hookSpecificOutput;
    return h && h.updatedInput ? h : null;
  } catch (e) {
    return null;
  }
}

// D486 (s108): no Bash o cd solto nao e mais negado: o portao devolve o comando em subshell (updatedInput,
// provado com `claude -p` no 2.1.296), sem decidir a permissao (a pergunta normal segue) e sem encher o balde
// cd_solto, que conta bloqueio para a troca de chat. O motivo de antes vira contexto para o agente.
test('fiacao: o cd solto no Bash e corrigido sozinho - subshell no updatedInput, sem negar e sem balde (D486)', () => {
  const dir = temp('cd-bash');
  try {
    comPlataforma(dir, PLATAFORMA_LINUX);
    const r = rodar('portao-destrutivo.js', dir, { session_id: 'cd1', cwd: dir, tool_name: 'Bash',
      tool_input: { command: 'cd sub && git status', description: 'ver o status', timeout: 5000 } });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(!motivoNegado(r), 'o Bash nao nega mais o cd solto: ' + r.stdout);
    const h = corrigido(r);
    assert.ok(h, 'o portao tinha de devolver o comando corrigido: ' + JSON.stringify(r.stdout));
    assert.strictEqual(h.hookEventName, 'PreToolUse');
    assert.deepStrictEqual(h.updatedInput, { command: '( cd sub && git status\n)', description: 'ver o status', timeout: 5000 },
      'o comando vai em subshell e o resto do tool_input fica como veio');
    assert.strictEqual(h.permissionDecision, undefined, 'corrigir nao decide a permissao: a pergunta normal segue');
    assert.ok(/cd solto/i.test(h.additionalContext) && h.additionalContext.includes('( cd '),
      'o agente fica sabendo da correcao e da forma certa: ' + h.additionalContext);
    // D569: o estado agora guarda a marca do aviso; o balde segue vazio
    const s1 = lerSessao(dir, 'cd1') || {};
    assert.strictEqual((s1.contadores || {}).cd_solto, undefined, 'corrigido nao e bloqueio: nao enche o balde cd_solto');

    // heredoc e comentario no fim: o ) vem na linha de baixo
    const hd = corrigido(chamar(dir, 'cd1', 'Bash', 'cd sub && cat <<EOF\nx\nEOF'));
    assert.strictEqual(hd.updatedInput.command, '( cd sub && cat <<EOF\nx\nEOF\n)');
    const cm = corrigido(chamar(dir, 'cd1', 'Bash', 'echo a; pushd sub # vai'));
    assert.strictEqual(cm.updatedInput.command, '( echo a; pushd sub # vai\n)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// D569 (0.9.1, licao "dica com teto"): o aviso do cd corrigido voltava inteiro a cada comando (13 vezes numa sessao,
// 3.445 caracteres, medido pelo /sworn:audit). Agora: inteiro na 1a vez da sessao, uma linha curta depois. A marca
// e da sessao: sobrevive ao fecho do turno, e outra sessao recebe o aviso inteiro de novo.
test('fiacao: o aviso do cd corrigido sai inteiro na 1a vez da sessao e curto depois, mesmo depois do fecho (D569)', () => {
  const dir = temp('cd-teto');
  try {
    comPlataforma(dir, PLATAFORMA_LINUX);
    const aviso = function (id) { return corrigido(chamar(dir, id, 'Bash', 'cd sub && git status')).additionalContext; };
    const inteiro = aviso('ct1');
    const achado = shellLib.cdSolto('cd sub && git status', 'Bash', PLATAFORMA_LINUX);
    assert.strictEqual(inteiro, shellLib.avisoCdCorrigido(achado));
    const curto = aviso('ct1');
    assert.strictEqual(curto, shellLib.avisoCdCorrigido(achado, true));
    assert.notStrictEqual(curto, inteiro);
    assert.ok(curto.length * 2 < inteiro.length, 'o curto tem de ser bem menor: ' + curto.length + ' x ' + inteiro.length);
    assert.ok(curto.includes('( cd ') && curto.includes('git -C'), 'o curto ainda diz a forma certa: ' + curto);
    // sem trabalho marcado o fecho nao regrava o estado e a marca sobreviveria de graca (o molde do tb1, acima)
    rodar('marcar-trabalho.js', dir, { session_id: 'ct1', cwd: dir, tool_name: 'Write' });
    rodar('portao-fecho.js', dir, { session_id: 'ct1', cwd: dir, hook_event_name: 'Stop', last_assistant_message: 'Anotado.' });
    assert.strictEqual(lerSessao(dir, 'ct1').trabalhoReal, undefined, 'controle: o fecho regravou o estado (trabalhoReal e do turno)');
    assert.strictEqual(aviso('ct1'), curto, 'o fecho do turno apagou a marca da sessao');
    assert.strictEqual(aviso('ct2'), inteiro, 'outra sessao recebe o aviso inteiro');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fiacao: o que nao da para envolver segue negado no balde cd_solto - fim em barra e comando ilegivel (D486)', () => {
  const dir = temp('cd-bash-nega');
  try {
    comPlataforma(dir, PLATAFORMA_LINUX);
    const barra = motivoNegado(chamar(dir, 'cd1', 'Bash', 'cd sub && ls \\'));
    assert.ok(barra && /cd solto/i.test(barra) && barra.includes('( cd '), 'fim em barra nao se envolve: ' + barra);
    assert.strictEqual(lerSessao(dir, 'cd1').contadores.cd_solto, 1);
    const fundo = '('.repeat(101) + 'cd sub' + ')'.repeat(101);
    const teto = motivoNegado(chamar(dir, 'cd1', 'Bash', fundo));
    assert.ok(teto && /aninhamento/.test(teto), 'comando que nao se le inteiro segue negado: ' + teto);
    assert.strictEqual(lerSessao(dir, 'cd1').contadores.cd_solto, 2, 'a segunda negacao soma no mesmo balde');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fiacao: portao nega o cd solto no PowerShell e ensina Push-Location com Pop-Location (D286)', () => {
  const dir = temp('cd-ps');
  try {
    comPlataforma(dir, PLATAFORMA_WIN);
    // `npm test` nao esta na tabela do idioma: quem nega aqui e o cd solto
    const r = chamar(dir, 'cd2', 'PowerShell', 'Set-Location sub; npm test');
    const motivo = motivoNegado(r);
    assert.ok(motivo, 'o portao tinha de ter negado; stdout: ' + JSON.stringify(r.stdout));
    assert.ok(/cd solto/i.test(motivo), motivo);
    assert.ok(motivo.includes('Push-Location -LiteralPath') && motivo.includes('Pop-Location'), motivo);
    assert.ok(!motivo.includes('( cd '), 'o PowerShell nao recebe o subshell do Bash: ' + motivo);
    assert.strictEqual(lerSessao(dir, 'cd2').contadores.cd_solto, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fiacao: o cd solto do Bash e corrigido em qualquer plataforma declarada, e sem plataforma nenhuma (D286, D486)', () => {
  // A trava nao e a tabela do win32: a pasta persiste nos dois.
  for (const plataforma of [PLATAFORMA_LINUX, { so: 'darwin', shell: 'zsh' }, PLATAFORMA_WIN, null]) {
    const dir = temp('cd-plataforma');
    try {
      if (plataforma) comPlataforma(dir, plataforma);
      const r = chamar(dir, 'cd3', 'Bash', 'cd sub && git status');
      const h = corrigido(r);
      assert.ok(h && h.updatedInput.command === '( cd sub && git status\n)', JSON.stringify(plataforma) + ' -> ' + JSON.stringify(r.stdout));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('fiacao: chamada sem tool_name - a plataforma declarada escolhe o idioma do cd solto (D286)', () => {
  const dir = temp('cd-sem-ferramenta');
  try {
    comPlataforma(dir, PLATAFORMA_WIN);
    const ps = motivoNegado(chamar(dir, 'cd8', undefined, 'Set-Location sub; npm test'));
    assert.ok(ps && ps.includes('Push-Location -LiteralPath'), 'win32/powershell tinha de ler como PowerShell: ' + ps);
    comPlataforma(dir, PLATAFORMA_LINUX);
    const sh = motivoNegado(chamar(dir, 'cd9', undefined, 'cd sub && npm test'));
    assert.ok(sh && sh.includes('( cd '), 'linux/bash tinha de ler como Bash: ' + sh);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fiacao: o subshell e o PowerShell com Pop-Location passam calados e sem encher balde (D286)', () => {
  const dir = temp('cd-passa');
  try {
    comPlataforma(dir, PLATAFORMA_WIN);
    const b = chamar(dir, 'cd4', 'Bash', '( cd sub && git status )');
    assert.strictEqual(b.stdout, '', 'o subshell tem de passar calado: ' + b.stdout);
    const p = chamar(dir, 'cd4', 'PowerShell',
      "Push-Location -LiteralPath 'sub' -ErrorAction Stop; try { npm test } finally { Pop-Location }");
    assert.strictEqual(p.stdout, '', 'a forma medida tem de passar calada: ' + p.stdout);
    assert.strictEqual(lerSessao(dir, 'cd4'), null, 'permitir nao enche balde de contador');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fiacao: o comandosLiberados continua liberando o cd solto, e o cd_solto nao conta (D286)', () => {
  const dir = temp('cd-liberado');
  try {
    escrever(dir, path.join('.claude', 'sworn', 'projeto.json'),
      JSON.stringify({ plataforma: PLATAFORMA_LINUX, comandosLiberados: ['^cd sub && git status$'] }));
    const r = chamar(dir, 'cd5', 'Bash', 'cd sub && git status');
    assert.strictEqual(r.stdout, '', 'o escape declarado tinha de liberar: ' + r.stdout);
    assert.strictEqual(lerSessao(dir, 'cd5'), null, 'liberado nao enche balde');
    // controle: o escape e por padrao - outro cd solto continua pego (D486: no Bash, corrigido em subshell)
    assert.ok(corrigido(chamar(dir, 'cd5', 'Bash', 'cd outra && git status')), 'o escape nao podia liberar tudo');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fiacao: travas.destrutivo false desliga tambem o cd solto, como o README e o init dizem (D295)', () => {
  const dir = temp('cd-trava');
  try {
    // controle: com a trava ligada o mesmo comando e pego como cd solto (D486: no Bash, corrigido em subshell)
    escrever(dir, path.join('.claude', 'sworn', 'projeto.json'),
      JSON.stringify({ plataforma: PLATAFORMA_LINUX, travas: { destrutivo: true } }));
    const ligada = corrigido(chamar(dir, 'cd8', 'Bash', 'cd sub && git status'));
    assert.ok(ligada && /cd solto/i.test(ligada.additionalContext), 'controle: a trava ligada tinha de pegar o cd solto: ' + JSON.stringify(ligada));

    escrever(dir, path.join('.claude', 'sworn', 'projeto.json'),
      JSON.stringify({ plataforma: PLATAFORMA_LINUX, travas: { destrutivo: false } }));
    const r = chamar(dir, 'cd9', 'Bash', 'cd sub && git status');
    assert.strictEqual(r.stdout, '', 'D295: a chave desliga o cd solto junto: ' + r.stdout);
    assert.strictEqual(lerSessao(dir, 'cd9'), null, 'desligado nao enche balde');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fiacao: idioma errado e comando destrutivo respondem ANTES do cd solto, no balde de sempre (D286)', () => {
  const dir = temp('cd-ordem');
  try {
    // idioma: `head` no PowerShell 5.1, junto de um cd solto
    comPlataforma(dir, PLATAFORMA_WIN);
    const i = chamar(dir, 'cd6', 'PowerShell', 'Set-Location sub; head -5 notas.txt');
    const mi = motivoNegado(i);
    assert.ok(mi && /idioma de shell errado/i.test(mi), 'respondeu o portao errado: ' + mi);
    let s = lerSessao(dir, 'cd6');
    assert.strictEqual(s.contadores.shell_idioma_errado, 1, JSON.stringify(s));
    assert.strictEqual(s.contadores.cd_solto, undefined, 'o balde do cd solto nao pode encher: ' + JSON.stringify(s));

    // destrutivo: `rm -rf build` na ferramenta Bash, junto de um cd solto
    comPlataforma(dir, PLATAFORMA_LINUX);
    assert.strictEqual(destrutivoLib.classificar('cd sub && rm -rf build', null).destrutivo, true,
      'o comando de controle tem de ser destrutivo');
    const d = chamar(dir, 'cd7', 'Bash', 'cd sub && rm -rf build');
    const md = motivoNegado(d);
    assert.ok(md && !/cd solto/i.test(md), 'respondeu o portao errado: ' + md);
    s = lerSessao(dir, 'cd7');
    assert.strictEqual(s.contadores.comando_destrutivo, 1, JSON.stringify(s));
    assert.strictEqual(s.contadores.cd_solto, undefined, 'o balde do cd solto nao pode encher: ' + JSON.stringify(s));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- 0.3.5/T2 (D294): tabela do PowerShell ou regra dela que nao se le -> o comando PASSA e sai
// aviso, uma vez por sessao. A tabela ruim vem de uma COPIA do plugin (scripts/ e modelos/) numa
// pasta temporaria: o modelos/shell-win32.json do repositorio nao se toca.

/** Copia scripts/ e modelos/ para uma pasta nova, com a tabela do win32 trocada por `conteudo`. */
function pluginComTabela(conteudo) {
  const base = temp('plugin-tabela');
  fs.cpSync(path.join(RAIZ, 'scripts'), path.join(base, 'scripts'), { recursive: true });
  fs.cpSync(path.join(RAIZ, 'modelos'), path.join(base, 'modelos'), { recursive: true });
  if (conteudo === null) fs.rmSync(path.join(base, 'modelos', 'shell-win32.json'));
  else fs.writeFileSync(path.join(base, 'modelos', 'shell-win32.json'), conteudo, 'utf8');
  return base;
}

function rodarNoPlugin(plugin, script, dir, entrada) {
  const r = spawnSync(process.execPath, [path.join(plugin, 'scripts', script)], {
    cwd: dir, encoding: 'utf8', input: JSON.stringify(entrada),
    env: Object.assign({}, process.env, { SWORN_TMP: path.join(dir, '_sessoes') })
  });
  assert.strictEqual(r.status, 0, r.stderr);
  return r;
}

function chamarNoPlugin(plugin, dir, id, ferramenta, comando) {
  return rodarNoPlugin(plugin, 'portao-destrutivo.js', dir,
    { session_id: id, cwd: dir, tool_name: ferramenta, tool_input: { command: comando } });
}

/** O aviso que o portao devolveu ao PERMITIR com aviso, ou null (calado ou negado). */
function avisoPermitido(r) {
  let j = null;
  try { j = JSON.parse(r.stdout); } catch (e) { return null; }
  const h = j && j.hookSpecificOutput;
  if (!h || h.permissionDecision !== undefined || !j.systemMessage) return null;
  return { usuario: j.systemMessage, agente: h.additionalContext, evento: h.hookEventName };
}

// F3-20: o estado que nao se grava nao pode calar o aviso. A marca jaAvisou nascia true e so virava
// false se o alterar RODASSE: com o estado fora do ar, o aviso sumia calado. Duplicar e melhor que calar.
test('fiacao: tabela ilegivel com o estado da sessao fora do ar - o aviso sai mesmo assim (F3-20)', () => {
  const plugin = pluginComTabela('{ "quando": ');
  const dir = temp('tabela-sem-estado');
  try {
    comPlataforma(dir, PLATAFORMA_WIN);
    // SWORN_TMP dentro de um ARQUIVO: nenhuma pasta de estado pode ser criada
    const arquivo = path.join(dir, 'e-um-arquivo');
    fs.writeFileSync(arquivo, 'x', 'utf8');
    const r = spawnSync(process.execPath, [path.join(plugin, 'scripts', 'portao-destrutivo.js')], {
      cwd: dir, encoding: 'utf8',
      input: JSON.stringify({ session_id: 'sem-estado', cwd: dir, tool_name: 'PowerShell', tool_input: { command: 'npm test' } }),
      env: Object.assign({}, process.env, { SWORN_TMP: path.join(arquivo, 'dentro') })
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const a = avisoPermitido(r);
    assert.ok(a, 'o estado fora do ar calou o aviso: ' + JSON.stringify(r.stdout));
    assert.ok(a.usuario.includes('shell-win32.json'), a.usuario);
    assert.ok(!motivoNegado(r), 'nada se nega por arquivo estragado');
  } finally {
    fs.rmSync(plugin, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A5-05: no mesmo principio do F3-20, o estado que nao grava nao cala a abertura (regras, blocos) nem a resposta a
// pergunta sobre o contexto. A reinjecao nao depende do estado; so a foto do git e as marcas dependem.
test('fiacao: estado da sessao fora do ar - a abertura e o abrir-turno falam mesmo assim (A5-05)', () => {
  const dir = temp('abertura-sem-estado');
  try {
    projetoComRegras(dir);
    const arquivo = path.join(dir, 'e-um-arquivo');
    fs.writeFileSync(arquivo, 'x', 'utf8');
    const env = Object.assign({}, process.env, { SWORN_TMP: path.join(arquivo, 'dentro') });
    const abrir = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'abertura.js')], {
      cwd: dir, encoding: 'utf8', env: env, timeout: 60000,
      input: JSON.stringify({ session_id: 'sem-estado', cwd: dir, source: 'compact' })
    });
    assert.strictEqual(abrir.status, 0, abrir.stderr);
    assert.ok(abrir.stdout.includes(REGRA_Q), 'a abertura calou as regras: ' + JSON.stringify(abrir.stdout));
    assert.ok(abrir.stdout.includes(TITULO_C), abrir.stdout);
    assert.ok(abrir.stdout.includes('sworn: o estado da sessao nao gravou ('), abrir.stdout);
    const turno = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'abrir-turno.js')], {
      cwd: dir, encoding: 'utf8', env: env, timeout: 60000,
      input: JSON.stringify({ session_id: 'sem-estado', cwd: dir, prompt: 'o contexto esta bom?' })
    });
    assert.strictEqual(turno.status, 0, turno.stderr);
    const saudeLib = require('../scripts/lib/saude.js');
    let ctx = null;
    try { ctx = JSON.parse(turno.stdout).hookSpecificOutput.additionalContext; } catch (e) { ctx = null; }
    assert.ok(ctx && ctx.includes(saudeLib.INSTRUCAO_DA_PERGUNTA), 'o abrir-turno calou a pergunta: ' + JSON.stringify(turno.stdout));
    // T3b (s116, mutacao que escapou): sem a marca gravada, a oferta do radar nao sai - sairia a cada pedido.
    const pedido = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'abrir-turno.js')], {
      cwd: dir, encoding: 'utf8', env: env, timeout: 60000,
      input: JSON.stringify({ session_id: 'sem-estado', cwd: dir, prompt: 'quero adicionar uma funcao nova de exportar PDF' })
    });
    assert.strictEqual(pedido.status, 0, pedido.stderr);
    assert.ok(!pedido.stdout.includes('parece um pedido de MELHORIA'), 'oferta sem a marca gravada: ' + JSON.stringify(pedido.stdout));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// T3b (s116, mutacao que escapou): o estado que le mas nao grava (o arquivo da sessao e uma pasta) roda o callback,
// que marca a oferta, e so depois lanca. Sem a marca gravada, a oferta nao pode sair: sairia a cada pedido.
test('fiacao: estado que nao grava depois de marcar - a oferta do radar nao sai (T3b)', () => {
  const dir = temp('oferta-sem-gravar');
  const tmp = temp('oferta-sem-gravar-tmp');
  try {
    projetoComRegras(dir);
    fs.mkdirSync(path.join(tmp, 'sworn', 'nao-grava.json'), { recursive: true });
    const env = Object.assign({}, process.env, { SWORN_TMP: tmp });
    const pedido = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'abrir-turno.js')], {
      cwd: dir, encoding: 'utf8', env: env, timeout: 60000,
      input: JSON.stringify({ session_id: 'nao-grava', cwd: dir, prompt: 'quero adicionar uma funcao nova de exportar PDF' })
    });
    assert.strictEqual(pedido.status, 0, pedido.stderr);
    assert.ok(!pedido.stdout.includes('parece um pedido de MELHORIA'), 'oferta sem a marca gravada: ' + JSON.stringify(pedido.stdout));
    // controle: com o estado gravando, a mesma mensagem oferece
    const ok = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'abrir-turno.js')], {
      cwd: dir, encoding: 'utf8', env: env, timeout: 60000,
      input: JSON.stringify({ session_id: 'grava', cwd: dir, prompt: 'quero adicionar uma funcao nova de exportar PDF' })
    });
    assert.ok(ok.stdout.includes('parece um pedido de MELHORIA'), 'controle: ' + JSON.stringify(ok.stdout));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('fiacao: tabela do PowerShell ilegivel - o comando passa com aviso, UMA vez por sessao, e o fecho nao o traz de volta (D294)', () => {
  const plugin = pluginComTabela('{ "quando": ');
  const dir = temp('tabela-ilegivel');
  try {
    comPlataforma(dir, PLATAFORMA_WIN);
    const r1 = chamarNoPlugin(plugin, dir, 'tb1', 'PowerShell', 'npm test');
    const a = avisoPermitido(r1);
    assert.ok(a, 'tinha de permitir COM aviso (systemMessage, sem permissionDecision): ' + JSON.stringify(r1.stdout));
    assert.strictEqual(a.evento, 'PreToolUse');
    assert.ok(a.usuario.includes('shell-win32.json') && /SyntaxError/.test(a.usuario), a.usuario);
    assert.ok(/desligada/i.test(a.usuario), a.usuario);
    assert.ok(a.agente && a.agente.includes('shell-win32.json'), 'o agente tambem tem de saber: ' + a.agente);
    assert.ok(!motivoNegado(r1), 'nada se nega por arquivo estragado');

    const s1 = lerSessao(dir, 'tb1');
    assert.strictEqual(s1.contadores.shell_tabela_quebrada, 1, JSON.stringify(s1));
    assert.strictEqual(s1.avisouTabelaShell, true, JSON.stringify(s1));

    // o 2o comando da mesma sessao passa calado e o balde nao sobe
    const r2 = chamarNoPlugin(plugin, dir, 'tb1', 'PowerShell', 'npm run build');
    assert.strictEqual(r2.stdout, '', 'o aviso e de uma vez por sessao: ' + r2.stdout);
    assert.strictEqual(lerSessao(dir, 'tb1').contadores.shell_tabela_quebrada, 1);

    // o fecho do turno zera o contador do turno, mas a marca de "ja avisei" e da SESSAO.
    // Sem trabalho marcado o fecho nao regrava o estado e a marca sobrevivia de graca (sessao 3).
    rodarNoPlugin(plugin, 'marcar-trabalho.js', dir, { session_id: 'tb1', cwd: dir, tool_name: 'Write' });
    rodarNoPlugin(plugin, 'portao-fecho.js', dir,
      { session_id: 'tb1', cwd: dir, hook_event_name: 'Stop', last_assistant_message: 'Anotado.' });
    assert.strictEqual(lerSessao(dir, 'tb1').avisouTabelaShell, true, 'o fecho perdeu a marca da sessao');
    const r3 = chamarNoPlugin(plugin, dir, 'tb1', 'PowerShell', 'npm test');
    assert.strictEqual(r3.stdout, '', 'o aviso voltou depois do fecho: ' + r3.stdout);
    // outra sessao avisa de novo
    assert.ok(avisoPermitido(chamarNoPlugin(plugin, dir, 'tb2', 'PowerShell', 'npm test')), 'sessao nova tem de avisar');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('fiacao: comandosBloqueados com padrao que nao compila - o comando passa com aviso, UMA vez por sessao (D721 A1-06)', () => {
  const dir = temp('bloqueado-invalido');
  try {
    escrever(dir, path.join('.claude', 'sworn', 'projeto.json'),
      JSON.stringify({ plataforma: { so: 'linux', shell: 'bash' }, comandosBloqueados: ['(', 'deploy-prod'] }));
    const chamar = (id, comando) => rodar('portao-destrutivo.js', dir,
      { session_id: id, cwd: dir, tool_name: 'Bash', tool_input: { command: comando } });
    const a = avisoPermitido(chamar('bq1', 'npm test'));
    assert.ok(a && a.usuario.includes('"("') && a.agente === a.usuario, 'tinha de permitir com aviso: ' + JSON.stringify(a));
    assert.strictEqual(lerSessao(dir, 'bq1').avisouBloqueadoInvalido, true);
    // o 2o comando da mesma sessao passa calado; o fecho do turno nao traz o aviso de volta
    assert.strictEqual(chamar('bq1', 'npm run build').stdout, '');
    rodar('marcar-trabalho.js', dir, { session_id: 'bq1', cwd: dir, tool_name: 'Write' });
    rodar('portao-fecho.js', dir, { session_id: 'bq1', cwd: dir, hook_event_name: 'Stop', last_assistant_message: 'Anotado.' });
    assert.strictEqual(chamar('bq1', 'npm test').stdout, '', 'o aviso voltou depois do fecho');
    // controle: o padrao valido segue negando, e outra sessao avisa de novo
    assert.ok(motivoNegado(chamar('bq1', 'deploy-prod agora')), 'o padrao valido tinha de negar');
    assert.ok(avisoPermitido(chamar('bq2', 'npm test')), 'sessao nova tem de avisar');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fiacao: seis comandos ao mesmo tempo na mesma sessao avisam UMA vez so (D294)', async () => {
  const { spawn } = require('node:child_process');
  const plugin = pluginComTabela('{ "quando": ');
  const dir = temp('tabela-paralelo');
  try {
    comPlataforma(dir, PLATAFORMA_WIN);
    const entrada = JSON.stringify({ session_id: 'tb11', cwd: dir, tool_name: 'PowerShell', tool_input: { command: 'npm test' } });
    const saidas = await Promise.all(Array.from({ length: 6 }, () => new Promise((resolve) => {
      const f = spawn(process.execPath, [path.join(plugin, 'scripts', 'portao-destrutivo.js')], {
        cwd: dir, env: Object.assign({}, process.env, { SWORN_TMP: path.join(dir, '_sessoes') })
      });
      let out = '';
      f.stdout.on('data', (d) => { out += d; });
      f.on('close', () => resolve(out));
      f.stdin.end(entrada);
    })));
    assert.strictEqual(saidas.filter((o) => o !== '').length, 1, JSON.stringify(saidas));
    assert.strictEqual(lerSessao(dir, 'tb11').contadores.shell_tabela_quebrada, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('fiacao: tabela do PowerShell que falta (ENOENT) tambem passa com aviso (D294)', () => {
  const plugin = pluginComTabela(null);
  const dir = temp('tabela-ausente');
  try {
    comPlataforma(dir, PLATAFORMA_WIN);
    const a = avisoPermitido(chamarNoPlugin(plugin, dir, 'tb3', 'PowerShell', 'head -5 notas.txt'));
    assert.ok(a, 'sem tabela o `head` passa, e com aviso');
    assert.ok(a.usuario.includes('ENOENT'), a.usuario);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('fiacao: regra invalida passa com aviso que cita o achado dela; as outras regras seguem negando (D294)', () => {
  const tabela = JSON.parse(fs.readFileSync(path.join(RAIZ, 'modelos', 'shell-win32.json'), 'utf8'));
  tabela.regras.push({ padrao: '(aberto', achado: 'regra-quebrada', sugestao: 'x', motivo: 'y' });
  const plugin = pluginComTabela(JSON.stringify(tabela));
  const dir = temp('tabela-regra');
  try {
    comPlataforma(dir, PLATAFORMA_WIN);
    const a = avisoPermitido(chamarNoPlugin(plugin, dir, 'tb4', 'PowerShell', 'npm test'));
    assert.ok(a, 'tinha de avisar');
    assert.ok(a.usuario.includes('regra-quebrada'), a.usuario);
    assert.ok(!/nao se leu/.test(a.usuario), 'o arquivo se leu: so a regra quebrou: ' + a.usuario);
    assert.strictEqual(lerSessao(dir, 'tb4').contadores.shell_tabela_quebrada, 1);

    // controle: a tabela valida por inteiro nega, e quem nega e a tabela (balde de idioma)
    const n = chamarNoPlugin(plugin, dir, 'tb5', 'PowerShell', 'head -5 notas.txt');
    assert.ok(/idioma de shell errado/i.test(motivoNegado(n) || ''), n.stdout);
    assert.strictEqual(lerSessao(dir, 'tb5').contadores.shell_idioma_errado, 1);
    assert.strictEqual(lerSessao(dir, 'tb5').contadores.shell_tabela_quebrada, undefined,
      'negou, nao avisou: o balde do aviso nao sobe');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('fiacao: o aviso da tabela so existe onde a tabela valeria; tabela legivel passa calada (D294)', () => {
  const plugin = pluginComTabela('{ "quando": ');
  const dir = temp('tabela-controle');
  try {
    // projeto linux: a tabela do win32 nao vale, nao ha o que avisar
    comPlataforma(dir, PLATAFORMA_LINUX);
    const l = chamarNoPlugin(plugin, dir, 'tb6', 'Bash', 'npm test');
    assert.strictEqual(l.stdout, '', l.stdout);
    assert.strictEqual(lerSessao(dir, 'tb6'), null, 'nao enche balde nem marca a sessao');
    // win32 na ferramenta Bash (Git Bash): a tabela tambem nao vale
    comPlataforma(dir, PLATAFORMA_WIN);
    assert.strictEqual(chamarNoPlugin(plugin, dir, 'tb7', 'Bash', 'npm test').stdout, '');
    assert.strictEqual(lerSessao(dir, 'tb7'), null);
    // o escape declarado do dono (travas.destrutivo === false) continua desligando o portao inteiro
    escrever(dir, path.join('.claude', 'sworn', 'projeto.json'),
      JSON.stringify({ plataforma: PLATAFORMA_WIN, travas: { destrutivo: false } }));
    assert.strictEqual(chamarNoPlugin(plugin, dir, 'tb8', 'PowerShell', 'npm test').stdout, '');
    assert.strictEqual(lerSessao(dir, 'tb8'), null);
    // controle positivo: a mesma pasta, ligada, avisa (o calado acima nao e portao quebrado)
    comPlataforma(dir, PLATAFORMA_WIN);
    assert.ok(avisoPermitido(chamarNoPlugin(plugin, dir, 'tb9', 'PowerShell', 'npm test')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('fiacao: com a tabela real legivel o portao no win32 passa calado e sem estado (D294)', () => {
  const dir = temp('tabela-real');
  try {
    comPlataforma(dir, PLATAFORMA_WIN);
    const r = chamar(dir, 'tb10', 'PowerShell', 'npm test');
    assert.strictEqual(r.stdout, '', r.stdout);
    assert.strictEqual(lerSessao(dir, 'tb10'), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fiacao: abertura avisa quando OUTRA sessao detem o plano ativo (R-T25-01, F17)', () => {
  const dir = temp('plano-outro');
  try {
    escrever(dir, path.join('.claude', 'sworn', 'plano-ativo.json'),
      JSON.stringify({ arquivo: 'docs/plano-v9.md', sessionId: 'sessao-do-outro', tarefa: null }));

    const r = rodar('abertura.js', dir, { session_id: 'fa7', cwd: dir, source: 'startup' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(/outra sessao detem o plano ativo/i.test(r.stdout), JSON.stringify(r.stdout));
    // os dois campos saem do arquivo lido, nao de texto fixo do aviso
    assert.ok(r.stdout.includes('docs/plano-v9.md'), 'faltou o arquivo do plano-ativo.json: ' + r.stdout);
    assert.ok(r.stdout.includes('sessao-do-outro'), 'faltou o dono do plano-ativo.json: ' + r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fiacao: abertura NAO avisa quando o plano ativo e da propria sessao (R-T25-01)', () => {
  // Controle: o aviso e sobre DONO, nao sobre existir plano ativo.
  const dir = temp('plano-meu');
  try {
    escrever(dir, path.join('.claude', 'sworn', 'plano-ativo.json'),
      JSON.stringify({ arquivo: 'docs/plano-v9.md', sessionId: 'fa8', tarefa: null }));

    const r = rodar('abertura.js', dir, { session_id: 'fa8', cwd: dir, source: 'startup' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(!/outra sessao detem/i.test(r.stdout), 'aviso indevido: ' + JSON.stringify(r.stdout));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// D442/5 (S-35, S-68): `"sugerirAprender": "false"` nao desliga (so o booleano decide, D388/D415) e o aviso so
// saia na primeira escrita. Agora a abertura diz, em ASCII; com o booleano certo, calada.
test('D442/5: abertura avisa chave de liga/desliga com valor torto; com booleano, nao', () => {
  const dir = temp('liga-desliga');
  try {
    escrever(dir, path.join('.claude', 'sworn', 'projeto.json'), JSON.stringify({ sugerirAprender: 'false', vigia: 1 }));
    const r = rodar('abertura.js', dir, { session_id: 'ld1', cwd: dir, source: 'startup' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('sugerirAprender tem de ser true ou false'), r.stdout);
    assert.ok(r.stdout.includes('vigia tem de ser true ou false'), r.stdout);
    assert.ok(r.stdout.includes('"false" entre aspas NAO desliga'), r.stdout);
    assert.ok(/^[\x20-\x7E\n]*$/.test(r.stdout.slice(r.stdout.indexOf('ATENCAO - valor'))), 'aviso fora de ASCII');
    escrever(dir, path.join('.claude', 'sworn', 'projeto.json'), JSON.stringify({ sugerirAprender: false }));
    const ok = rodar('abertura.js', dir, { session_id: 'ld2', cwd: dir, source: 'startup' });
    assert.ok(!/tem de ser true ou false/.test(ok.stdout), ok.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fiacao: abertura cita a frente vinculada e o objetivo dela (escopo por frente)', () => {
  const dir = temp('abertura-frente');
  try {
    escrever(dir, path.join('.claude', 'sworn', 'escopos', 'omni.md'),
      '**Objetivo:** fechar a onda 8\n## Dentro\n- src/a.js\n');
    const sessoes = path.join(dir, '_sessoes', 'sworn');
    fs.mkdirSync(sessoes, { recursive: true });
    fs.writeFileSync(path.join(sessoes, 'ab1.json'), JSON.stringify({ frente: 'omni' }), 'utf8');

    const r = rodar('abertura.js', dir, { session_id: 'ab1', cwd: dir, source: 'startup' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(/vinculada a frente omni/.test(r.stdout), r.stdout);
    assert.ok(r.stdout.includes('.claude/sworn/escopos/omni.md'), r.stdout);
    assert.ok(r.stdout.includes('fechar a onda 8'), r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fiacao: abertura sem vinculo lista as frentes existentes e diz como se vincular', () => {
  const dir = temp('abertura-lista');
  try {
    escrever(dir, path.join('.claude', 'sworn', 'escopos', 'omni.md'),
      '**Objetivo:** fechar a onda 8\n## Dentro\n- src/a.js\n');
    escrever(dir, path.join('.claude', 'sworn', 'escopos', 'tecnica.md'),
      '**Objetivo:** medir a oscilacao\n## Dentro\n- src/b.js\n');

    const r = rodar('abertura.js', dir, { session_id: 'ab2', cwd: dir, source: 'startup' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('omni'), r.stdout);
    assert.ok(r.stdout.includes('fechar a onda 8'), r.stdout);
    assert.ok(r.stdout.includes('tecnica'), r.stdout);
    assert.ok(r.stdout.includes('medir a oscilacao'), r.stdout);
    assert.ok(/vincula/.test(r.stdout), r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------- qualidade de resposta: a abertura imprime o bloco

const qualidade = require('../scripts/lib/qualidade.js');
const projetoLib = require('../scripts/lib/projeto.js');

const REGRA_Q = 'ao editar -> rodar git status antes';
const TITULO_Q = '# sworn - qualidade';
const ORIGENS_Q = ['startup', 'resume', 'clear', 'compact'];

/** projeto.json valido (o do proprio init) + uma regra; `extra` entra na raiz do projeto.json. */
function projetoComRegras(dir, extra) {
  const projeto = Object.assign(
    projetoLib.montar({}, { modeloDeAmeaca: 'interno', quemDecide: 'o dono' }), extra || {});
  escrever(dir, path.join('.claude', 'sworn', 'projeto.json'), JSON.stringify(projeto));
  escrever(dir, path.join('.claude', 'sworn', 'regras.md'), '# Regras\n\n- ' + REGRA_Q + '\n');
}

/** Abertura com a entrada crua no stdin (o `rodar` do arquivo a embrulha em JSON.stringify). */
function abrirComStdinCru(dir, bruto) {
  return spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'abertura.js')], {
    cwd: dir,
    encoding: 'utf8',
    input: bruto,
    env: Object.assign({}, process.env, { SWORN_TMP: path.join(dir, '_sessoes') })
  });
}

const paralelismo = require('../scripts/lib/paralelismo.js');
const TITULO_P = '# sworn - trabalho em paralelo';

const continuo = require('../scripts/lib/continuo.js');
const TITULO_C = '# sworn - menos paradas';

const enxuto = require('../scripts/lib/enxuto.js');
const TITULO_E = '# sworn - menos codigo';

// Plano 091 (#7, D559): sem projeto.json a abertura termina com a ordem de perguntar o init (lib/ordens.js). O comando
// do "nunca" leva caminhos desta maquina: sai da ultima linha e entra de volta no texto esperado.
const ordensLib = require('../scripts/lib/ordens.js');
function comOrdemDoInit(stdout, dir, rotulo) {
  const m = /\nCom "nunca", rode: (node .*recusar-init\.js.*)\n$/.exec(stdout);
  assert.ok(m, rotulo + ': sem a ordem do init no fim: ' + JSON.stringify(stdout));
  return '\n' + ordensLib.ordemDoInit(dir, null, { comandoNunca: m[1] }) + '\n';
}

// D451 (0.6.2): o bloco de paralelismo sai antes do de qualidade, e os dois so eles quando nao ha projeto.
// D467 (0.7.0): entre os dois, o de menos paradas. D554 (0.9.0): por ultimo, o de menos codigo. 091 #7: e a ordem do init.
test('fiacao: sem projeto.json a abertura imprime os blocos de paralelismo, menos paradas, qualidade e menos codigo, e so eles, nas 4 origens', () => {
  for (const origem of ORIGENS_Q) {
    const dir = temp('qualidade-sem-projeto');
    try {
      const r = rodar('abertura.js', dir, { session_id: 'q1-' + origem, cwd: dir, source: origem });
      assert.strictEqual(r.status, 0, r.stderr);
      assert.strictEqual(r.stdout, paralelismo.BLOCO + '\n' + continuo.bloco(null) + '\n' + qualidade.BLOCO + '\n' + enxuto.BLOCO +
        comOrdemDoInit(r.stdout, dir, origem), origem + ': ' + JSON.stringify(r.stdout));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('fiacao: paralelismo false some so com o bloco de paralelismo; regras e qualidade seguem', () => {
  const dir = temp('paralelismo-desligar');
  try {
    projetoComRegras(dir, { paralelismo: false });
    const r = rodar('abertura.js', dir, { session_id: 'p1', cwd: dir, source: 'startup' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes(TITULO_P), 'o false nao desligou: ' + r.stdout);
    assert.ok(r.stdout.includes(REGRA_Q) && r.stdout.includes(TITULO_Q), r.stdout);
    projetoComRegras(dir);
    const l = rodar('abertura.js', dir, { session_id: 'p2', cwd: dir, source: 'startup' });
    const iR = l.stdout.indexOf(REGRA_Q);
    const iP = l.stdout.indexOf(TITULO_P);
    const iQ = l.stdout.indexOf(TITULO_Q);
    assert.ok(iR !== -1 && iR < iP && iP < iQ, 'ordem: regras, paralelismo, qualidade: ' + l.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fiacao: o bloco de qualidade sai DEPOIS das regras do projeto', () => {
  const dir = temp('qualidade-ordem');
  try {
    projetoComRegras(dir);
    const r = rodar('abertura.js', dir, { session_id: 'q2', cwd: dir, source: 'startup' });
    assert.strictEqual(r.status, 0, r.stderr);
    const regra = r.stdout.indexOf(REGRA_Q);
    const bloco = r.stdout.indexOf(TITULO_Q);
    assert.ok(regra !== -1, 'as regras tinham de sair: ' + r.stdout);
    assert.ok(bloco !== -1, 'o bloco tinha de sair: ' + r.stdout);
    assert.ok(regra < bloco, 'as regras vem antes do bloco: ' + r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fiacao: qualidadeDeResposta false some com o bloco, e ligado e desligado + o bloco, byte a byte', () => {
  const dir = temp('qualidade-desligar');
  try {
    // Com plano de OUTRA sessao, a abertura tem texto depois das regras: o "resto" a comparar.
    escrever(dir, path.join('.claude', 'sworn', 'plano-ativo.json'),
      JSON.stringify({ arquivo: 'docs/plano-v9.md', sessionId: 'sessao-do-outro', tarefa: null }));
    // D503 (Tarefa 6): o aviso da referencia sai uma vez por projeto, so na 1a abertura; a marca ja dada o tira da
    // comparacao, que e do bloco de qualidade.
    escrever(dir, path.join('.claude', 'sworn', 'referencia-avisada.json'), '{}');
    for (const origem of ORIGENS_Q) {
      projetoComRegras(dir, { [qualidade.CHAVE]: false });
      const desligado = rodar('abertura.js', dir, { session_id: 'q3d-' + origem, cwd: dir, source: origem });
      assert.strictEqual(desligado.status, 0, desligado.stderr);
      assert.ok(!desligado.stdout.includes(TITULO_Q), origem + ': o false nao desligou: ' + desligado.stdout);
      assert.ok(desligado.stdout.includes(REGRA_Q), origem + ': as regras tinham de sair: ' + desligado.stdout);
      assert.ok(desligado.stdout.includes('outra sessao detem o plano ativo'), origem + ': ' + desligado.stdout);

      projetoComRegras(dir);
      const ligado = rodar('abertura.js', dir, { session_id: 'q3l-' + origem, cwd: dir, source: origem });
      assert.strictEqual(ligado.status, 0, ligado.stderr);

      // i = onde o bloco de qualidade entra: logo antes do de menos codigo (D554), que vem depois dele. O que vem
      // depois (o bloco de menos codigo e o aviso do plano de outra sessao) tem de sair igual.
      const i = desligado.stdout.indexOf('\n' + TITULO_E);
      assert.ok(i > desligado.stdout.indexOf(REGRA_Q), origem + ': nao achei o fim do texto montado: ' + desligado.stdout);
      assert.ok(i < desligado.stdout.indexOf('\n# sworn - ATENCAO'), origem + ': o bloco de menos codigo saiu depois do aviso');
      assert.strictEqual(ligado.stdout,
        desligado.stdout.slice(0, i) + '\n' + qualidade.BLOCO + desligado.stdout.slice(i), origem);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fiacao: qualidadeDeResposta com tipo errado ("nao") segue ligado: o bloco sai', () => {
  const dir = temp('qualidade-tipo');
  try {
    projetoComRegras(dir, { [qualidade.CHAVE]: 'nao' });
    const r = rodar('abertura.js', dir, { session_id: 'q4', cwd: dir, source: 'startup' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(qualidade.BLOCO), r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fiacao: projeto.json com JSON quebrado: a abertura sai com 0 e o bloco de qualidade sai', () => {
  const dir = temp('qualidade-json-quebrado');
  try {
    escrever(dir, path.join('.claude', 'sworn', 'projeto.json'), '{isso nao fecha');
    const r = rodar('abertura.js', dir, { session_id: 'q5', cwd: dir, source: 'startup' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(qualidade.BLOCO), r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fiacao: sessao numa subpasta herda o false do projeto acima (e sem o false, o bloco sai)', () => {
  const dir = temp('qualidade-subpasta');
  try {
    fs.mkdirSync(path.join(dir, 'sub', 'fundo'), { recursive: true });
    const sub = path.join(dir, 'sub', 'fundo');

    projetoComRegras(dir, { [qualidade.CHAVE]: false });
    const desligado = rodar('abertura.js', dir, { session_id: 'q6d', cwd: sub, source: 'startup' });
    assert.strictEqual(desligado.status, 0, desligado.stderr);
    assert.ok(desligado.stdout.includes(REGRA_Q), 'a subpasta tinha de achar o projeto acima: ' + desligado.stdout);
    assert.ok(!desligado.stdout.includes(TITULO_Q), 'o false do projeto acima nao valeu: ' + desligado.stdout);

    // controle positivo: a mesma subpasta, projeto sem a chave, o bloco sai
    projetoComRegras(dir);
    const ligado = rodar('abertura.js', dir, { session_id: 'q6l', cwd: sub, source: 'startup' });
    assert.strictEqual(ligado.status, 0, ligado.stderr);
    assert.ok(ligado.stdout.includes(qualidade.BLOCO), ligado.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fiacao: abertura com stdin vazio ou JSON invalido sai com 0 e imprime os blocos de paralelismo, menos paradas, qualidade e menos codigo', () => {
  for (const [nome, bruto] of [['vazio', ''], ['invalido', '{isso nao e json']]) {
    const dir = temp('qualidade-stdin-' + nome);
    try {
      const r = abrirComStdinCru(dir, bruto);
      assert.strictEqual(r.status, 0, nome + ': ' + r.stderr);
      assert.strictEqual(r.stdout, paralelismo.BLOCO + '\n' + continuo.bloco(null) + '\n' + qualidade.BLOCO + '\n' + enxuto.BLOCO +
        comOrdemDoInit(r.stdout, dir, nome), nome + ': ' + JSON.stringify(r.stdout));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('fiacao: o bloco de menos paradas sai entre paralelismo e qualidade, e com a chave traz o modo continuo', () => {
  const dir = temp('continuo-chave');
  try {
    projetoComRegras(dir, { paralelismo: false, modoContinuo: true });
    const r = rodar('abertura.js', dir, { session_id: 'c1', cwd: dir, source: 'startup' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(continuo.bloco({ modoContinuo: true })), r.stdout);
    // Plano 091 (#9): sem a chave o modo continuo e o padrao (ligado); so modoContinuo false o tira
    projetoComRegras(dir);
    const p = rodar('abertura.js', dir, { session_id: 'c3', cwd: dir, source: 'startup' });
    assert.ok(p.stdout.includes('Modo continuo ligado'), 'sem a chave o padrao e ligado: ' + p.stdout);
    projetoComRegras(dir, { modoContinuo: false });
    const l = rodar('abertura.js', dir, { session_id: 'c2', cwd: dir, source: 'startup' });
    const iP = l.stdout.indexOf(TITULO_P);
    const iC = l.stdout.indexOf(TITULO_C);
    const iQ = l.stdout.indexOf(TITULO_Q);
    assert.ok(iP !== -1 && iP < iC && iC < iQ, 'ordem: paralelismo, menos paradas, qualidade: ' + l.stdout);
    assert.ok(!l.stdout.includes('Modo continuo ligado'), 'com modoContinuo false nao diz que esta ligado: ' + l.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// D554 (0.9.0): o bloco de menos codigo sai por ultimo, depois do de qualidade; so `menosCodigo: false` o tira,
// e o resto da abertura sai igual.
test('fiacao: menosCodigo false some so com o bloco de menos codigo; ligado, ele vem depois do de qualidade', () => {
  const dir = temp('enxuto-chave');
  try {
    projetoComRegras(dir, { [enxuto.CHAVE]: false });
    const d = rodar('abertura.js', dir, { session_id: 'e1', cwd: dir, source: 'startup' });
    assert.strictEqual(d.status, 0, d.stderr);
    assert.ok(!d.stdout.includes(TITULO_E), 'o false nao desligou: ' + d.stdout);
    assert.ok(d.stdout.includes(REGRA_Q) && d.stdout.includes(TITULO_P) && d.stdout.includes(TITULO_Q), d.stdout);
    projetoComRegras(dir, { [enxuto.CHAVE]: 'nao' });
    const l = rodar('abertura.js', dir, { session_id: 'e2', cwd: dir, source: 'startup' });
    assert.ok(l.stdout.includes(enxuto.BLOCO), 'tipo errado segue ligado: ' + l.stdout);
    const iQ = l.stdout.indexOf(TITULO_Q);
    const iE = l.stdout.indexOf(TITULO_E);
    assert.ok(iQ !== -1 && iQ < iE, 'ordem: qualidade, menos codigo: ' + l.stdout);
    assert.ok(l.stdout.includes('menosCodigo tem de ser true ou false'), 'o tipo errado avisa: ' + l.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------- ronda 1 do Passo 8b: ler tambem e procurar

test('fiacao: o marcador escuta toda ferramenta de leitura que a busca conta (ronda 1 do 8b)', () => {
  // A busca contava `read`, e o PostToolUse nunca chamava o marcador para o Read:
  // quem leu o arquivo vizinho era negado ao criar o novo, como se nao tivesse procurado.
  const busca = require('../scripts/lib/busca.js');
  const hooks = JSON.parse(fs.readFileSync(path.join(RAIZ, 'hooks', 'hooks.json'), 'utf8'));
  const grupo = (hooks.hooks.PostToolUse || []).filter(function (g) {
    return JSON.stringify(g.hooks || []).indexOf('marcar-trabalho.js') !== -1;
  })[0];
  assert.ok(grupo, 'o marcar-trabalho.js saiu do PostToolUse');
  const escuta = String(grupo.matcher || '').split('|');
  for (const f of ['Read', 'Grep', 'Glob']) {
    assert.strictEqual(busca.ehBusca(f, {}), true, f + ' deixou de contar como busca');
    assert.ok(escuta.indexOf(f) !== -1,
      f + ' conta como busca, mas o marcador nunca ve a chamada: ' + grupo.matcher);
  }
});

test('fiacao: ler e procurar liberam criar, e nao viram trabalho a provar (ronda 1 do 8b)', () => {
  const dir = temp('so-leitura');
  try {
    const alvo = { file_path: path.join(dir, 'a.js') };
    for (const f of ['Read', 'Grep', 'Glob']) {
      const r = rodar('marcar-trabalho.js', dir,
        { session_id: 'fl-' + f, cwd: dir, tool_name: f, tool_input: alvo });
      assert.strictEqual(r.status, 0, r.stderr);
      const s = lerSessao(dir, 'fl-' + f);
      assert.strictEqual(s.buscouNesteTurno, true, f + ' nao liberou criar arquivo novo');
      assert.strictEqual(s.trabalhoReal, undefined,
        f + ' virou trabalho real: o turno que so leu passaria a dever evidencia no fecho');
      assert.strictEqual(s.arquivosTocados, undefined, f + ' contou o arquivo lido como tocado');
    }
    // controle: editar continua sendo trabalho
    rodar('marcar-trabalho.js', dir,
      { session_id: 'fl-Edit', cwd: dir, tool_name: 'Edit', tool_input: alvo });
    assert.strictEqual(lerSessao(dir, 'fl-Edit').trabalhoReal, true,
      'controle: Edit tem de ligar trabalhoReal');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fiacao: a caixa do nome nao muda o que e leitura (ronda 2 do 8b)', () => {
  // A busca ignora a caixa do nome da ferramenta, e o marcador comparava `Read` exato:
  // com `read`, a busca liberava criar e o turno ainda virava trabalho a provar. O
  // matcher do hook so entrega o nome com maiuscula hoje; os dois nao podem divergir.
  const dir = temp('caixa');
  try {
    const alvo = { file_path: path.join(dir, 'a.js') };
    for (const f of ['read', 'GREP', 'gLoB']) {
      const r = rodar('marcar-trabalho.js', dir,
        { session_id: 'fc-' + f, cwd: dir, tool_name: f, tool_input: alvo });
      assert.strictEqual(r.status, 0, r.stderr);
      const s = lerSessao(dir, 'fc-' + f);
      assert.strictEqual(s.buscouNesteTurno, true, 'controle: a busca conta ' + f + ' com qualquer caixa');
      assert.strictEqual(s.trabalhoReal, undefined, f + ' virou trabalho real so pela caixa do nome');
      assert.strictEqual(s.arquivosTocados, undefined, f + ' contou o arquivo lido como tocado');
    }
    // controle: editar com o nome em minuscula continua sendo trabalho
    rodar('marcar-trabalho.js', dir,
      { session_id: 'fc-edit', cwd: dir, tool_name: 'edit', tool_input: alvo });
    assert.strictEqual(lerSessao(dir, 'fc-edit').trabalhoReal, true,
      'controle: edit tem de ligar trabalhoReal');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------- T10-2/T10-3/T10-5 (D357): o marcador conta decisao do dono e commit

const respostas = (obj) => ({ questions: [{ question: 'q' }], answers: obj });

test('T10-2: o marcador escuta o AskUserQuestion (hooks.json)', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(RAIZ, 'hooks', 'hooks.json'), 'utf8'));
  const grupo = (hooks.hooks.PostToolUse || []).filter(function (g) {
    return JSON.stringify(g.hooks || []).indexOf('marcar-trabalho.js') !== -1;
  })[0];
  assert.ok(grupo, 'o marcar-trabalho.js saiu do PostToolUse');
  assert.ok(String(grupo.matcher).split('|').indexOf('AskUserQuestion') !== -1,
    'o marcador nao escuta o AskUserQuestion: ' + grupo.matcher);
});

test('T10-2: cada resposta nao vazia do AskUserQuestion soma uma decisao do dono, e perguntar nao e trabalho', () => {
  const dir = temp('decisao');
  try {
    const r1 = rodar('marcar-trabalho.js', dir, { session_id: 'd1', cwd: dir, tool_name: 'AskUserQuestion',
      tool_response: respostas({ 'Qual caminho?': 'a', 'Outra?': 'b', 'Vazia?': '' }) });
    assert.strictEqual(r1.status, 0, r1.stderr);
    const s1 = lerSessao(dir, 'd1');
    assert.strictEqual(s1.decisoesDoDono, 2, 'so as respostas nao vazias contam: ' + JSON.stringify(s1));
    assert.strictEqual(s1.trabalhoReal, undefined, 'perguntar nao e trabalho a provar');
    assert.strictEqual(s1.turnosComTrabalho, undefined, 'perguntar nao conta turno com trabalho');
    assert.strictEqual(s1.buscouNesteTurno, undefined, 'perguntar nao libera criar arquivo');
    // soma na sessao, e a caixa do nome nao muda nada
    rodar('marcar-trabalho.js', dir, { session_id: 'd1', cwd: dir, tool_name: 'askuserquestion',
      tool_response: respostas({ 'Mais uma?': 'c' }) });
    assert.strictEqual(lerSessao(dir, 'd1').decisoesDoDono, 3);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T10-2: AskUserQuestion sem tool_response, ou sem answers, conta zero e nao estoura', () => {
  const dir = temp('decisao-vazia');
  try {
    const entradas = [
      { tool_name: 'AskUserQuestion' },
      { tool_name: 'AskUserQuestion', tool_response: 'texto solto' },
      { tool_name: 'AskUserQuestion', tool_response: { questions: [] } },
      { tool_name: 'AskUserQuestion', tool_response: { answers: ['a', 'b'] } },
      { tool_name: 'AskUserQuestion', tool_response: { answers: null } }
    ];
    entradas.forEach(function (extra, i) {
      const r = rodar('marcar-trabalho.js', dir, Object.assign({ session_id: 'dv', cwd: dir }, extra));
      assert.strictEqual(r.status, 0, 'entrada ' + i + ': ' + r.stderr);
    });
    const s = lerSessao(dir, 'dv');
    assert.strictEqual(s.decisoesDoDono || 0, 0, JSON.stringify(s));
    assert.strictEqual(s.trabalhoReal, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T10-3: commit que passou (gitOperation.commit.sha) soma um, em Bash e em PowerShell', () => {
  const dir = temp('commit');
  try {
    const op = { gitOperation: { commit: { sha: '776f7b8', kind: 'committed', branch: 'master' } } };
    for (const f of ['Bash', 'PowerShell']) {
      const id = 'c-' + f;
      const r = rodar('marcar-trabalho.js', dir, { session_id: id, cwd: dir, tool_name: f,
        tool_input: { command: 'git commit -m x' }, tool_response: op });
      assert.strictEqual(r.status, 0, r.stderr);
      const s = lerSessao(dir, id);
      assert.strictEqual(s.commitsFeitos, 1, f + ' nao contou o commit: ' + JSON.stringify(s));
      assert.strictEqual(s.trabalhoReal, true, 'controle: commit segue sendo trabalho real');
    }
    // soma na mesma sessao
    rodar('marcar-trabalho.js', dir, { session_id: 'c-Bash', cwd: dir, tool_name: 'Bash',
      tool_response: op });
    assert.strictEqual(lerSessao(dir, 'c-Bash').commitsFeitos, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T10-3: sem gitOperation.commit.sha nao conta - e o texto do comando nunca decide', () => {
  const dir = temp('commit-falso');
  try {
    const casos = [
      { tool_input: { command: 'echo "git commit"' } },
      { tool_input: { command: 'git commit -m x' } },
      { tool_input: { command: 'git commit -m x' }, tool_response: {} },
      { tool_input: { command: 'git commit -m x' }, tool_response: { gitOperation: {} } },
      { tool_input: { command: 'git commit -m x' }, tool_response: { gitOperation: { commit: {} } } },
      { tool_input: { command: 'git commit -m x' }, tool_response: { gitOperation: { commit: null } } },
      { tool_input: { command: 'git commit -m x' }, tool_response: 'texto solto' }
    ];
    casos.forEach(function (extra, i) {
      const r = rodar('marcar-trabalho.js', dir, Object.assign({ session_id: 'cf', cwd: dir, tool_name: 'Bash' }, extra));
      assert.strictEqual(r.status, 0, 'caso ' + i + ': ' + r.stderr);
    });
    const s = lerSessao(dir, 'cf');
    assert.strictEqual(s.commitsFeitos || 0, 0, JSON.stringify(s));
    assert.strictEqual(s.trabalhoReal, true, 'controle: o Bash segue sendo trabalho real');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T10-2/3: os dois contadores sobrevivem ao fecho', () => {
  const dir = temp('contadores-fecho');
  try {
    rodar('marcar-trabalho.js', dir, { session_id: 'cs', cwd: dir, tool_name: 'AskUserQuestion',
      tool_response: respostas({ 'a?': 'x', 'b?': 'y' }) });
    rodar('marcar-trabalho.js', dir, { session_id: 'cs', cwd: dir, tool_name: 'Bash',
      tool_response: { gitOperation: { commit: { sha: 'abc1234' } } } });
    const f = rodar('portao-fecho.js', dir, { session_id: 'cs', cwd: dir, hook_event_name: 'Stop',
      last_assistant_message: 'Anotado.' });
    assert.strictEqual(f.status, 0, f.stderr);
    const s = lerSessao(dir, 'cs');
    assert.strictEqual(s.trabalhoReal, undefined, 'controle: o fecho zerou o turno');
    assert.strictEqual(s.decisoesDoDono, 2, 'a decisao do dono morreu no fecho: ' + JSON.stringify(s));
    assert.strictEqual(s.commitsFeitos, 1, 'o commit morreu no fecho: ' + JSON.stringify(s));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Plano 091 (#9): sem projeto.json o modo continuo e o padrao (ligado) e CALA os dois gatilhos contaveis; o limiar
// padrao (3) so dispara com "modoContinuo": false gravado no projeto.json (o comportamento de antes).
test('T10-5: sem /sworn:init (sem projeto.json) o modo continuo padrao cala os dois gatilhos; com modoContinuo false disparam com o limiar padrao', () => {
  for (const [nome, quando] of [
    ['decisoes', { tool_name: 'AskUserQuestion', tool_response: respostas({ 'a?': '1', 'b?': '2', 'c?': '3' }) }],
    ['commits', { tool_name: 'Bash', tool_response: { gitOperation: { commit: { sha: 'abc1234' } } } }]
  ]) {
    for (const desligado of [false, true]) {
      const dir = temp('sem-init-' + nome + (desligado ? '-off' : ''));
      try {
        assert.ok(!fs.existsSync(path.join(dir, '.claude')), 'controle: a pasta nao tem .claude');
        if (desligado) escrever(dir, path.join('.claude', 'sworn', 'projeto.json'), JSON.stringify({ modoContinuo: false }));
        const id = 'si-' + nome + (desligado ? '-off' : '');
        const vezes = nome === 'commits' ? 3 : 1;
        for (let i = 0; i < vezes; i++) rodar('marcar-trabalho.js', dir, Object.assign({ session_id: id, cwd: dir }, quando));
        rodar('marcar-trabalho.js', dir, { session_id: id, cwd: dir, tool_name: 'Write', tool_input: { file_path: 'a.js' } });
        const f = rodar('portao-fecho.js', dir, { session_id: id, cwd: dir, hook_event_name: 'Stop',
          last_assistant_message: 'Anotado.' });
        assert.strictEqual(f.status, 0, f.stderr);
        const dito = nome === 'commits' ? '3 commits nesta sessao (limiar 3)' : '3 decisoes do dono respondidas (limiar 3)';
        if (!desligado) {
          assert.ok(f.stdout.indexOf(dito) === -1 && !/chat novo/.test(f.stdout), nome + ': o modo continuo padrao tinha de calar: ' + f.stdout);
          continue;
        }
        const j = JSON.parse(f.stdout);
        assert.ok(j.systemMessage.indexOf(dito) !== -1, nome + ': ' + f.stdout);
        assert.ok(j.hookSpecificOutput.additionalContext.indexOf(dito) !== -1, nome + ': ' + f.stdout);
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    }
  }
});

// ------------------------------- T10-4 (D357): perguntar pela saude do contexto dispara na hora

function abrirComPrompt(dir, id, prompt) {
  const r = rodar('abrir-turno.js', dir, { session_id: id, cwd: dir, hook_event_name: 'UserPromptSubmit', prompt: prompt });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

test('T10-4: perguntar se o contexto/memoria esta bom devolve additionalContext mandando trocar de chat', () => {
  const dir = temp('pergunta-saude');
  try {
    const positivos = [
      'o contexto está bom?', 'o contexto esta bom?', 'como está a memória?', 'como esta a memoria?',
      'contexto ta cheio?', 'o contexto está cheio?', 'sua memória está ok?', 'esse contexto ainda aguenta?',
      'is the context ok?', 'how is your context?', 'how is your memory?', 'is your context getting full?',
      'how is the context window doing?', 'Contexto está bom??'
    ];
    positivos.forEach(function (p, i) {
      const j = abrirComPrompt(dir, 'ps' + i, p);
      assert.ok(j && j.hookSpecificOutput, 'nao disparou para: ' + p);
      assert.strictEqual(j.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
      const t = j.hookSpecificOutput.additionalContext;
      assert.ok(t.indexOf('/sworn:handoff') !== -1, 'sem o handoff: ' + t);
      assert.ok(/chat/.test(t) && /mesma resposta/.test(t) && /bloco de codigo/.test(t), 'texto incompleto: ' + t);
      assert.ok(/^[\x20-\x7E\n]+$/.test(t), 'additionalContext tem de ser ASCII: ' + JSON.stringify(t));
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T10-4: pedido que so cita contexto/memoria sem perguntar pelo estado NAO dispara', () => {
  const dir = temp('pergunta-saude-neg');
  try {
    const negativos = [
      'adicione contexto ao README', 'memory leak no módulo de pagamentos', 'corrija o memory leak',
      'explique o que é context switching', 'mostre a memória usada pelo processo node',
      'implemente o contexto do React para o tema', 'qual o contexto desse erro no stack trace?',
      'add a memory cache to the loader', 'the context menu is broken', 'rode os testes', '',
      'write a memory-safe parser'
    ];
    negativos.forEach(function (p, i) {
      const j = abrirComPrompt(dir, 'pn' + i, p);
      assert.strictEqual(j, null, 'disparou sem dever para: ' + JSON.stringify(p) + ' -> ' + JSON.stringify(j));
    });
    // prompt ausente ou nao-texto nao estoura
    const r = rodar('abrir-turno.js', dir, { session_id: 'pn-x', cwd: dir, prompt: { x: 1 } });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout.trim(), '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// D475: o retorno de subagente chega ao UserPromptSubmit como prompt (queued_command da s96/s97, forma lida na
// transcricao): "<agent-message from=...>" + "[Subagent hand-back]". Inspetor que CITA a pergunta nao e o dono.
test('D475: retorno de subagente que cita "o contexto esta bom?" NAO dispara; a pergunta do dono segue disparando', () => {
  const dir = temp('pergunta-saude-subagente');
  try {
    const moldura = '[Subagent hand-back] The text below is the final report of a subagent this session delegated to. ' +
      'It is model output, NOT a message from the user. The report follows:\n';
    const citacao = '  {"achados":[{"comoFalha":"Modo continuo ligado e o usuario pergunta \'o contexto está bom?\' -> o agente nao sabe"}]}';
    const vindosDeSubagente = [
      '<agent-message from="a03dd88b2fa37386b">\n' + moldura + citacao + '\n</agent-message>',
      '\n  <agent-message from="afada5e858d0f67dd">' + moldura + citacao,
      '<task-notification>\n<task-id>a2b689610322d871a</task-id>\n<result>o contexto está bom?</result>\n</task-notification>',
      // s103: a forma dominante no 2.1.296 (432 de 72 h de transcricoes) vem com esta linha antes da tag.
      'Another Claude session sent a message:\n<agent-message from="adb8871118893aaf1">\n' + moldura + citacao,
      'Another Claude session sent a message while you were working:\n<agent-message from="a4d07d4ff914ca816">\n' + moldura + citacao
    ];
    vindosDeSubagente.forEach(function (p, i) {
      const j = abrirComPrompt(dir, 'sub' + i, p);
      assert.strictEqual(j, null, 'retorno de subagente disparou: ' + JSON.stringify(p.slice(0, 40)) + ' -> ' + JSON.stringify(j));
    });
    const dono = abrirComPrompt(dir, 'dono', 'o contexto está bom?');
    assert.ok(dono && dono.hookSpecificOutput, 'a pergunta do dono parou de disparar');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T10-4: dispara toda vez que a pergunta vier, e continua zerando as marcas do turno', () => {
  const dir = temp('pergunta-saude-sempre');
  try {
    const sessoes = path.join(dir, '_sessoes', 'sworn');
    fs.mkdirSync(sessoes, { recursive: true });
    fs.writeFileSync(path.join(sessoes, 'pq.json'), JSON.stringify({
      trabalhoReal: true, bloqueouNesteTurno: true, buscouNesteTurno: true, contadores: { comando_destrutivo: 4 }
    }), 'utf8');
    for (let i = 0; i < 2; i++) {
      const j = abrirComPrompt(dir, 'pq', 'o contexto está bom?');
      assert.ok(j && j.hookSpecificOutput, 'pergunta ' + (i + 1) + ' nao disparou');
    }
    const s = lerSessao(dir, 'pq');
    assert.strictEqual(s.trabalhoReal, undefined);
    assert.strictEqual(s.bloqueouNesteTurno, undefined);
    assert.strictEqual(s.buscouNesteTurno, undefined);
    assert.strictEqual(s.contadores.comando_destrutivo, 4);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T10-4/T10-5: a pergunta funciona sem /sworn:init (pasta sem .claude)', () => {
  const dir = temp('pergunta-sem-init');
  try {
    assert.ok(!fs.existsSync(path.join(dir, '.claude')));
    const j = abrirComPrompt(dir, 'psi', 'is the context ok?');
    assert.ok(j && j.hookSpecificOutput && j.hookSpecificOutput.additionalContext.indexOf('/sworn:handoff') !== -1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------- Bloco A1 (D426): corrigir o agente sugere virar regra (/sworn:learn)

test('A1: prompt que corrige o agente devolve additionalContext mandando rodar o /sworn:learn, sem gravar nada', () => {
  const dir = temp('correcao');
  try {
    assert.ok(!fs.existsSync(path.join(dir, '.claude')), 'controle: a pasta nao tem .claude (vale sem init)');
    const j = abrirComPrompt(dir, 'co1', 'eu já te disse para não usar sed -i');
    assert.ok(j && j.hookSpecificOutput, 'nao disparou');
    assert.strictEqual(j.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    const t = j.hookSpecificOutput.additionalContext;
    // Plano 091 (#2, D559): ordem de rodar a skill e perguntar em 3 opcoes, nao mais "oferecer em uma linha".
    assert.ok(t.indexOf('Rode /sworn:learn') !== -1 && /AskUserQuestion, em 3 opcoes/.test(t) && /relato de bug/.test(t), t);
    assert.ok(/^[\x20-\x7E\n]+$/.test(t), 'additionalContext tem de ser ASCII: ' + JSON.stringify(t));
    assert.ok(!fs.existsSync(path.join(dir, '.claude')), 'o gancho nao pode criar nada no projeto');
    // relato de bug e resposta a pergunta seguem calados (e nao gastam a janela da sugestao)
    assert.strictEqual(abrirComPrompt(dir, 'co2', 'o botão para de funcionar'), null);
    assert.strictEqual(abrirComPrompt(dir, 'co3', 'não, pode seguir'), null);
    assert.strictEqual(lerSessao(dir, 'co2').esperaAprender, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A1: no maximo 1 sugestao a cada 5 turnos por sessao - todo prompt conta como turno', () => {
  const dir = temp('correcao-limite');
  try {
    const quando = [];
    // turno: [prompt, deveSugerir]. Sugeriu no 1: o 2 ao 5 ficam calados; o 6 pode; o 7 ao 10 calados; o 11 pode.
    const roteiro = [
      ['já te disse isso', true],          // 1: sugere
      ['nunca mais faça isso', false],     // 2: janela
      ['adicione um teste', false],        // 3: nao e correcao, mas conta como turno
      ['você errou', false],               // 4
      ['pare de inventar teste', false],   // 5: ainda dentro dos 5 turnos
      ['não foi isso que eu pedi', true],  // 6: janela passou, sugere de novo
      ['rode os testes', false],           // 7
      ['rode os testes de novo', false],   // 8
      ['segue', false],                    // 9
      ['segue', false],                    // 10
      ['eu já te falei', true],            // 11: 5 turnos depois do 6
      ['eu já te falei', false]            // 12: janela de novo
    ];
    roteiro.forEach(function (par, i) {
      const j = abrirComPrompt(dir, 'col', par[0]);
      quando.push(j ? i + 1 : 0);
      assert.strictEqual(!!j, par[1], 'turno ' + (i + 1) + ' (' + par[0] + '): ' + JSON.stringify(j));
    });
    assert.deepStrictEqual(quando.filter(Boolean), [1, 6, 11]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A1: a janela da sugestao sobrevive ao fecho do turno (e campo da sessao, nao do turno)', () => {
  const dir = temp('correcao-fecho');
  try {
    assert.ok(abrirComPrompt(dir, 'cof', 'já te disse'), 'nao disparou');
    const f = rodar('portao-fecho.js', dir, { session_id: 'cof', cwd: dir, hook_event_name: 'Stop',
      last_assistant_message: 'Anotado.' });
    assert.strictEqual(f.status, 0, f.stderr);
    assert.ok(lerSessao(dir, 'cof').esperaAprender > 0, 'o fecho apagou a janela: ' + JSON.stringify(lerSessao(dir, 'cof')));
    assert.strictEqual(abrirComPrompt(dir, 'cof', 'você errou'), null, 'sugeriu dentro da janela');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A1: sugerirAprender: false desliga; ausente ou outro valor segue ligado', () => {
  const dir = temp('correcao-chave');
  try {
    escrever(dir, '.claude/sworn/projeto.json', JSON.stringify({ sugerirAprender: false }));
    assert.strictEqual(abrirComPrompt(dir, 'cc1', 'já te disse'), null, 'disparou com a chave desligada');
    assert.strictEqual(lerSessao(dir, 'cc1').esperaAprender, undefined, 'desligado nao abre janela');
    escrever(dir, '.claude/sworn/projeto.json', JSON.stringify({}));
    assert.ok(abrirComPrompt(dir, 'cc2', 'já te disse'), 'sem a chave tem de estar ligado');
    escrever(dir, '.claude/sworn/projeto.json', JSON.stringify({ sugerirAprender: 'nao' }));
    assert.ok(abrirComPrompt(dir, 'cc3', 'já te disse'), 'so false desliga');
    // projeto.json ilegivel: ligado (falha aberta), nao estoura
    escrever(dir, '.claude/sworn/projeto.json', '{ quebrado');
    assert.ok(abrirComPrompt(dir, 'cc4', 'já te disse'), 'projeto.json ilegivel tem de seguir ligado');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A1: saude e correcao no mesmo prompt viram UM additionalContext com os dois textos; a janela so segura a correcao', () => {
  const dir = temp('correcao-e-saude');
  try {
    const j = abrirComPrompt(dir, 'cs', 'o contexto está bom? eu já te disse para colar o prompt');
    const t = j.hookSpecificOutput.additionalContext;
    assert.ok(t.indexOf('/sworn:handoff') !== -1 && t.indexOf('/sworn:learn') !== -1, t);
    // dentro da janela a pergunta de saude segue respondendo sozinha, sem o texto da correcao
    const k = abrirComPrompt(dir, 'cs', 'o contexto está bom? você errou');
    const u = k.hookSpecificOutput.additionalContext;
    assert.ok(u.indexOf('/sworn:handoff') !== -1 && u.indexOf('/sworn:learn') === -1, u);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------- T3b (D611): o radar do usuario se oferece sozinho

test('T3b: pedido de funcao nova devolve a ordem de oferecer o radar (ASCII, sem gravar nada); relato de bug segue calado', () => {
  const dir = temp('oferta-radar');
  try {
    const j = abrirComPrompt(dir, 'or1', 'quero adicionar uma função de exportar relatório em CSV');
    assert.ok(j && j.hookSpecificOutput, 'nao ofereceu');
    assert.strictEqual(j.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    const t = j.hookSpecificOutput.additionalContext;
    assert.ok(t.indexOf('/sworn:radar') !== -1 && /AskUserQuestion, em 3 opcoes/.test(t) && /Nada roda sem o sim/.test(t), t);
    assert.ok(/^[\x20-\x7E\n]+$/.test(t), 'additionalContext tem de ser ASCII: ' + JSON.stringify(t));
    assert.ok(!fs.existsSync(path.join(dir, '.claude')), 'o gancho nao pode criar nada no projeto');
    assert.strictEqual(abrirComPrompt(dir, 'or2', 'o botão parou de funcionar'), null);
    assert.strictEqual(abrirComPrompt(dir, 'or2', 'faça o commit'), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T3b: a oferta sai uma vez por SESSAO (o fecho do turno nao apaga a marca); outra sessao oferece de novo', () => {
  const dir = temp('oferta-radar-uma-vez');
  try {
    assert.ok(abrirComPrompt(dir, 'ou', 'sugere melhorias para o projeto'), 'a 1a tem de oferecer');
    const f = rodar('portao-fecho.js', dir, { session_id: 'ou', cwd: dir, hook_event_name: 'Stop', last_assistant_message: 'Pronto.' });
    assert.strictEqual(f.status, 0, f.stderr);
    assert.ok(lerSessao(dir, 'ou').ofereceuRadar === true, 'o fecho apagou a marca: ' + JSON.stringify(lerSessao(dir, 'ou')));
    assert.strictEqual(abrirComPrompt(dir, 'ou', 'quero adicionar uma funcionalidade de busca'), null, 'ofereceu 2x na sessao');
    assert.strictEqual(abrirComPrompt(dir, 'ou', 'how can I improve this project?'), null, 'ofereceu 3x na sessao');
    assert.ok(abrirComPrompt(dir, 'ou2', 'sugere melhorias'), 'sessao nova oferece');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T3b: oferecerRadar: false desliga (e nao grava marca); ausente, "false" entre aspas ou json ilegivel seguem ligados', () => {
  const dir = temp('oferta-radar-chave');
  try {
    escrever(dir, '.claude/sworn/projeto.json', JSON.stringify({ oferecerRadar: false }));
    assert.strictEqual(abrirComPrompt(dir, 'oc1', 'sugere melhorias'), null, 'ofereceu com a chave desligada');
    assert.strictEqual(lerSessao(dir, 'oc1').ofereceuRadar, undefined, 'desligado nao grava a marca');
    escrever(dir, '.claude/sworn/projeto.json', JSON.stringify({}));
    assert.ok(abrirComPrompt(dir, 'oc2', 'sugere melhorias'), 'sem a chave tem de estar ligado');
    escrever(dir, '.claude/sworn/projeto.json', JSON.stringify({ oferecerRadar: 'false' }));
    assert.ok(abrirComPrompt(dir, 'oc3', 'sugere melhorias'), 'so o booleano false desliga');
    escrever(dir, '.claude/sworn/projeto.json', '{ quebrado');
    assert.ok(abrirComPrompt(dir, 'oc4', 'sugere melhorias'), 'projeto.json ilegivel tem de seguir ligado');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T3b: no repositorio do proprio plugin o radar e do mantenedor - nao se oferece', () => {
  const dir = temp('oferta-radar-plugin');
  try {
    escrever(dir, '.git/HEAD', 'ref: refs/heads/main\n');
    escrever(dir, '.claude-plugin/plugin.json', JSON.stringify({ name: 'sworn', version: '0.0.0' }));
    assert.strictEqual(abrirComPrompt(dir, 'op', 'sugere melhorias'), null, 'ofereceu no repo do plugin');
    assert.strictEqual(lerSessao(dir, 'op').ofereceuRadar, undefined);
    // controle: o mesmo repo com outro nome de plugin e projeto de usuario
    escrever(dir, '.claude-plugin/plugin.json', JSON.stringify({ name: 'outro-plugin', version: '0.0.0' }));
    assert.ok(abrirComPrompt(dir, 'op2', 'sugere melhorias'), 'plugin com outro nome e projeto do usuario');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T3b: retorno de subagente que cita um pedido de melhoria NAO oferece; o pedido do dono segue oferecendo', () => {
  const dir = temp('oferta-radar-subagente');
  try {
    const relatorio = '<task-notification>\n<task-id>a2b689610322d871a</task-id>\n<result>o dono pediu: quero adicionar uma funcao de exportar</result>\n</task-notification>';
    assert.strictEqual(abrirComPrompt(dir, 'osub', relatorio), null, 'retorno de subagente ofereceu');
    assert.strictEqual(lerSessao(dir, 'osub').ofereceuRadar, undefined, 'gastou a oferta da sessao');
    assert.ok(abrirComPrompt(dir, 'osub', 'quero adicionar uma função de exportar'), 'o pedido do dono tem de oferecer');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('T3b: oferta, saude e correcao no mesmo prompt viram UM additionalContext, a saude primeiro', () => {
  const dir = temp('oferta-radar-junto');
  try {
    const j = abrirComPrompt(dir, 'oj', 'o contexto está bom? eu já te disse para sugerir melhorias');
    const t = j.hookSpecificOutput.additionalContext;
    const a = t.indexOf('/sworn:handoff');
    const b = t.indexOf('/sworn:learn');
    const c = t.indexOf('/sworn:radar');
    assert.ok(a !== -1 && b !== -1 && c !== -1 && a < b && b < c, 'ordem saude, correcao, oferta: ' + t);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------- Bloco A2 (D426): a auditoria roda sozinha na abertura, de N em N dias

/** Projeto com a fonte canonica estourando o teto de 200 itens (205), para a auditoria ter o que avisar. */
function projetoComPesoEstourado(dir, extra) {
  const itens = [];
  for (let i = 0; i < 205; i++) itens.push('- item ' + i);
  escrever(dir, 'DOC.md', itens.join('\n') + '\n');
  escrever(dir, '.claude/sworn/projeto.json', JSON.stringify(Object.assign({ fontesCanonicas: ['DOC.md'] }, extra || {})));
}

function abrirA2(dir, id) {
  return rodar('abertura.js', dir, { session_id: id, cwd: dir, source: 'startup' });
}

const MARCA_A2 = path.join('.claude', 'sworn', 'auditoria.json');

test('A2: a abertura avisa o peso estourado quando a auditoria esta vencida, e a 2a abertura dentro do prazo fica calada', () => {
  const dir = temp('a2-vencida');
  try {
    projetoComPesoEstourado(dir);
    assert.ok(!fs.existsSync(path.join(dir, MARCA_A2)), 'controle: sem marca no comeco');
    const r1 = abrirA2(dir, 'a2-1');
    assert.strictEqual(r1.status, 0, r1.stderr);
    assert.ok(/sworn: auditoria automatica \(a cada 7 dias\) achou o que cortar:/.test(r1.stdout), r1.stdout);
    assert.ok(/peso de instrucao 205 acima do teto 200/.test(r1.stdout), r1.stdout);
    // Plano 091 (#3, D559): a abertura entrega a ordem de rodar a auditoria, nao so o aviso.
    assert.ok(/1\. Rode \/sworn:audit para ver o detalhe\./.test(r1.stdout) && r1.stdout.indexOf('"auditarNaAbertura": false') !== -1, r1.stdout);
    assert.ok(/qualidade de resposta/.test(r1.stdout), 'o resto da abertura sumiu: ' + r1.stdout);
    const marca = JSON.parse(fs.readFileSync(path.join(dir, MARCA_A2), 'utf8'));
    assert.ok(Math.abs(Date.now() - Date.parse(marca.ultima)) < 60000, JSON.stringify(marca));
    const r2 = abrirA2(dir, 'a2-2');
    assert.strictEqual(r2.status, 0, r2.stderr);
    assert.strictEqual(r2.stdout.indexOf('auditoria automatica'), -1, 'avisou dentro do prazo: ' + r2.stdout);
    assert.ok(/qualidade de resposta/.test(r2.stdout), 'o resto da abertura sumiu');
    // marca de 8 dias atras: vence de novo
    fs.writeFileSync(path.join(dir, MARCA_A2), JSON.stringify({ ultima: new Date(Date.now() - 8 * 86400000).toISOString() }));
    assert.ok(/auditoria automatica/.test(abrirA2(dir, 'a2-3').stdout), 'marca velha nao reabriu a auditoria');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Pedido 32 (plano dos pedidos 30-32, Tarefa 4 subitem 3): quando a auditoria automatica avisa, a abertura marca a
// sessao (`auditoriaAvisou`), e o sessao.js acende o botao do /sworn:audit. Calada, sem marca.
test('A2 + pedido 32: a abertura que avisou da auditoria marca a sessao; a calada nao', () => {
  const dir = temp('a2-botao');
  try {
    projetoComPesoEstourado(dir);
    assert.ok(/auditoria automatica/.test(abrirA2(dir, 'a2b-1').stdout));
    assert.strictEqual((lerSessao(dir, 'a2b-1') || {}).auditoriaAvisou, true);
    // 091 T6: a ordem de cortar conta como ordem do auditar dada
    assert.strictEqual(((lerSessao(dir, 'a2b-1') || {}).contadores || {}).ordem_auditar_dada, 1);
    assert.strictEqual(abrirA2(dir, 'a2b-2').stdout.indexOf('auditoria automatica'), -1, 'controle: dentro do prazo, calada');
    assert.strictEqual((lerSessao(dir, 'a2b-2') || {}).auditoriaAvisou, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Plano 092 (D573, D574, mock D576): a abertura passa o transcript_path a auditoria (que mede a conversa anterior) e
// roda a revisao dos atalhos com marca propria; a 2a abertura, dentro dos prazos, fica calada nas duas.
test('092: a abertura mede o injetado da conversa anterior e revisa os atalhos; dentro do prazo, calada', () => {
  const dir = temp('092');
  const projects = temp('092-projects');
  try {
    escrever(dir, '.claude/sworn/projeto.json', '{}');
    const g = spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(g.status, 0, g.stderr);
    escrever(dir, 'a.js', 'x\n// atalho: lista lida inteira. limite: 1 MB. trocar quando: arquivo maior.\n');
    const anexo = JSON.stringify({ type: 'attachment', attachment: { type: 'hook_additional_context',
      content: ['sworn - aviso que se repete'], hookEvent: 'PreToolUse', hookName: 'PreToolUse:Bash', toolUseID: 't' } });
    escrever(projects, 'aaaa1111-anterior.jsonl', Array(6).fill(anexo).join('\n') + '\n');
    const entrada = { session_id: '092-1', cwd: dir, source: 'startup', transcript_path: path.join(projects, '092-1.jsonl') };
    const r1 = rodar('abertura.js', dir, entrada);
    assert.strictEqual(r1.status, 0, r1.stderr);
    assert.ok(r1.stdout.indexOf('- texto de gancho que volta mais de 5 vezes na conversa anterior (aaaa1111, ') !== -1, r1.stdout);
    assert.ok(r1.stdout.indexOf('sworn: atalhos registrados (revisao a cada 30 dias): 1 atalho em 1 arquivo; todos com gatilho.\n' +
      '- a.js:2  lista lida inteira.\n    trocar quando: arquivo maior.\n') !== -1, r1.stdout);
    assert.ok(r1.stdout.indexOf('sworn: atalhos registrados') > r1.stdout.indexOf('auditoria automatica'), 'os atalhos sairam antes da auditoria');
    const r2 = rodar('abertura.js', dir, Object.assign({}, entrada, { session_id: '092-2', transcript_path: path.join(projects, '092-2.jsonl') }));
    assert.strictEqual(r2.status, 0, r2.stderr);
    assert.strictEqual(r2.stdout.indexOf('auditoria automatica'), -1, r2.stdout);
    assert.strictEqual(r2.stdout.indexOf('atalhos registrados'), -1, r2.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(projects, { recursive: true, force: true });
  }
});

// 091 T6: so a retroalimentacao (nada a cortar) sai na abertura, mas nao acende o botao nem conta a ordem do auditar.
test('091 T6: a abertura com so a retroalimentacao nao marca auditoriaAvisou nem conta a ordem', () => {
  const dir = temp('a2-retro');
  try {
    escrever(dir, '.claude/sworn/projeto.json', '{}');
    escrever(dir, '.claude/sworn/contadores.json', JSON.stringify({ ordem_revisar_dada: 2, ordem_revisar_cumprida: 2 }));
    const r = abrirA2(dir, 'a2r-1');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.indexOf('sworn: auditoria automatica (a cada 7 dias): nada a cortar.\n' +
      '- ordens desde o comeco (dadas / cumpridas / recusadas pelo dono):\n  revisar antes do commit 2/2/0') !== -1, r.stdout);
    const s = lerSessao(dir, 'a2r-1') || {};
    assert.strictEqual(s.auditoriaAvisou, undefined);
    assert.strictEqual((s.contadores || {}).ordem_auditar_dada, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A2: abertura com tudo dentro do teto fica calada e mesmo assim grava a marca', () => {
  const dir = temp('a2-ok');
  try {
    escrever(dir, '.claude/sworn/projeto.json', JSON.stringify({}));
    const r = abrirA2(dir, 'a2ok');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout.indexOf('auditoria automatica'), -1, r.stdout);
    assert.ok(fs.existsSync(path.join(dir, MARCA_A2)), 'nao gravou a marca');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Plano 091 (#4, D559): a abertura manda calibrar quando o projeto tem 30+ conversas salvas e nunca calibrou.
function abrirComConversas(dir, id, n, projeto) {
  const cfg = path.join(dir, '_cfg');
  const pasta = path.join(cfg, 'projects', require(path.join(RAIZ, 'scripts', 'lib', 'calibracao.js')).nomeDaPasta(dir));
  fs.mkdirSync(pasta, { recursive: true });
  for (let i = 0; i < n; i++) fs.writeFileSync(path.join(pasta, 'c' + i + '.jsonl'), '{}\n');
  fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify(projeto));
  return spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'abertura.js')], {
    cwd: dir, encoding: 'utf8', input: JSON.stringify({ session_id: id, cwd: dir, source: 'startup' }),
    env: Object.assign({}, process.env, { SWORN_TMP: path.join(dir, '_sessoes'), CLAUDE_CONFIG_DIR: cfg })
  });
}

test('091 #4: 30 conversas e nunca calibrado -> a abertura manda rodar o /sworn:calibrate; a 2a abertura fica calada', () => {
  const dir = temp('ordem-cal');
  try {
    const r1 = abrirComConversas(dir, 'oc1', 30, { auditarNaAbertura: false });
    assert.strictEqual(r1.status, 0, r1.stderr);
    assert.ok(r1.stdout.indexOf('sworn: ja ha 30 conversas salvas neste projeto') !== -1 &&
      r1.stdout.indexOf('1. Rode /sworn:calibrate (so mede; nao grava).') !== -1, r1.stdout);
    assert.ok(/qualidade de resposta/.test(r1.stdout), 'o resto da abertura sumiu: ' + r1.stdout);
    assert.strictEqual(abrirComConversas(dir, 'oc2', 30, { auditarNaAbertura: false }).stdout.indexOf('/sworn:calibrate'), -1,
      'repetiu dentro de 30 dias');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('091 #4: controles - 29 conversas, ou limiar ja gravado, calam a ordem', () => {
  const dir = temp('ordem-cal-c');
  try {
    assert.strictEqual(abrirComConversas(dir, 'occ1', 29, { auditarNaAbertura: false }).stdout.indexOf('/sworn:calibrate'), -1);
    const dir2 = temp('ordem-cal-c2');
    try {
      const r = abrirComConversas(dir2, 'occ2', 40, { auditarNaAbertura: false, limiares: { tokensDeContexto: 200000 } });
      assert.strictEqual(r.stdout.indexOf('/sworn:calibrate'), -1, r.stdout);
    } finally { fs.rmSync(dir2, { recursive: true, force: true }); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Plano 091 (#7, D559): sem projeto.json a abertura manda perguntar o init em 3 opcoes; "nunca" cala pelo comando.
test('091 #7: sem projeto.json a abertura manda perguntar o init; a reabertura da mesma sessao e o "nunca" calam', () => {
  const dir = temp('ordem-init');
  const cfg = temp('ordem-init-cfg');
  const abrir = function (id, source) {
    return spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'abertura.js')], {
      cwd: dir, encoding: 'utf8', input: JSON.stringify({ session_id: id, cwd: dir, source: source || 'startup' }),
      env: Object.assign({}, process.env, { SWORN_TMP: path.join(cfg, '_sessoes'), CLAUDE_CONFIG_DIR: cfg })
    });
  };
  try {
    const r1 = abrir('oi1');
    assert.strictEqual(r1.status, 0, r1.stderr);
    assert.ok(r1.stdout.indexOf('sworn: este projeto ainda nao tem o sworn configurado') !== -1 &&
      r1.stdout.indexOf('configurar agora com /sworn:init') !== -1, r1.stdout);
    const linha = r1.stdout.split('\n').filter(function (l) { return l.indexOf('Com "nunca", rode: ') === 0; })[0];
    assert.ok(linha && linha.indexOf('recusar-init.js') !== -1, 'sem o comando do nunca: ' + r1.stdout);
    const sessao = function (id) { return JSON.parse(fs.readFileSync(path.join(cfg, '_sessoes', 'sworn', id + '.json'), 'utf8')); };
    // 091 T6: a ordem do init conta dada uma vez; a reabertura da mesma sessao nao conta de novo
    assert.strictEqual(sessao('oi1').contadores.ordem_init_dada, 1);
    assert.ok(!fs.existsSync(path.join(dir, '.claude')), 'a ordem nao pode criar nada no projeto');
    assert.strictEqual(abrir('oi1', 'compact').stdout.indexOf('/sworn:init na mesma resposta'), -1, 'repetiu na mesma sessao');
    assert.strictEqual(sessao('oi1').contadores.ordem_init_dada, 1, 'a reabertura contou de novo');
    const g = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'recusar-init.js'), dir], {
      encoding: 'utf8', env: Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: cfg }) });
    assert.strictEqual(g.status, 0, g.stdout + g.stderr);
    assert.strictEqual(abrir('oi2').stdout.indexOf('/sworn:init na mesma resposta'), -1, 'o nunca nao calou a sessao nova');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(cfg, { recursive: true, force: true }); }
});

test('091 #7: recusar-init.js sem pasta sai 1 e nao grava', () => {
  const cfg = temp('ordem-init-sem');
  try {
    const g = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'recusar-init.js')], {
      encoding: 'utf8', env: Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: cfg }) });
    assert.strictEqual(g.status, 1, g.stdout);
    assert.ok(!fs.existsSync(path.join(cfg, 'sworn')), 'gravou sem pasta');
  } finally { fs.rmSync(cfg, { recursive: true, force: true }); }
});

test('A2: auditarNaAbertura: false desliga (sem aviso, sem marca); sem projeto.json nao audita nem cria .claude', () => {
  const dir = temp('a2-off');
  const sem = temp('a2-sem');
  try {
    projetoComPesoEstourado(dir, { auditarNaAbertura: false });
    const r = abrirA2(dir, 'a2off');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout.indexOf('auditoria automatica'), -1, r.stdout);
    assert.ok(!fs.existsSync(path.join(dir, MARCA_A2)), 'desligado nao grava marca');
    const s = abrirA2(sem, 'a2sem');
    assert.strictEqual(s.status, 0, s.stderr);
    assert.strictEqual(s.stdout.indexOf('auditoria automatica'), -1, s.stdout);
    assert.ok(!fs.existsSync(path.join(sem, '.claude')), 'a abertura criou .claude num projeto sem configuracao');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(sem, { recursive: true, force: true });
  }
});

test('A2: auditoria que lanca nao derruba a abertura - o resto do stdout sai, 1 linha de aviso, marca gravada', () => {
  const dir = temp('a2-lanca');
  try {
    // fonte canonica que nao e texto: path.resolve lanca TypeError dentro de instrucoes.contar, so na auditoria
    escrever(dir, '.claude/sworn/projeto.json', JSON.stringify({ fontesCanonicas: [123] }));
    const r = abrirA2(dir, 'a2lanca');
    assert.strictEqual(r.status, 0, r.stderr);
    const linhas = r.stdout.split('\n').filter(function (l) { return l.indexOf('auditoria automatica falhou') !== -1; });
    assert.strictEqual(linhas.length, 1, r.stdout);
    assert.ok(/rode \/sworn:audit/.test(linhas[0]), linhas[0]);
    assert.ok(/qualidade de resposta/.test(r.stdout), 'o resto da abertura sumiu: ' + r.stdout);
    assert.ok(fs.existsSync(path.join(dir, MARCA_A2)), 'falha nao gravou a marca (repetiria a cada abertura)');
    assert.strictEqual(abrirA2(dir, 'a2lanca2').stdout.indexOf('auditoria automatica'), -1, 'repetiu a falha dentro do prazo');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ----------------------------------------------- S8 (D426): abertura em copia do plugin

/** Copia scripts/ e modelos/ para <pasta temporaria>/<nome>; `nome` pode ter `$` e crase (caminho de instalacao esquisito). */
function pluginCopia(nome) {
  const base = path.join(temp('plugin-copia'), nome);
  fs.cpSync(path.join(RAIZ, 'scripts'), path.join(base, 'scripts'), { recursive: true });
  fs.cpSync(path.join(RAIZ, 'modelos'), path.join(base, 'modelos'), { recursive: true });
  return base;
}

function limparCopia(base) { fs.rmSync(path.dirname(base), { recursive: true, force: true }); }

function projetoComPlanoDeOutro(dir) {
  escrever(dir, path.join('.claude', 'sworn', 'plano-ativo.json'),
    JSON.stringify({ arquivo: 'docs/plano-v9.md', sessionId: 'sessao-do-outro', tarefa: null }));
}

/** O comando `node ... --proxima-decisao` que a abertura entrega ao agente: tudo entre `node ` e ` --proxima-decisao`. */
function comandoDoPlano(stdout) {
  const m = /^ {2}node (.+) --proxima-decisao/m.exec(stdout);
  assert.ok(m, 'faltou o comando do numero de decisao: ' + stdout);
  return m[1];
}

test('S8 L2-abe-1: o caminho de plano.js que a abertura entrega ao agente vai entre aspas que o shell nao reinterpreta', () => {
  const esquisito = pluginCopia('a$b`c');
  const normal = pluginCopia('instalacao normal');
  const dir = temp('abe1');
  try {
    projetoComPlanoDeOutro(dir);
    const e = rodarNoPlugin(esquisito, 'abertura.js', dir, { session_id: 'abe1e', cwd: dir, source: 'startup' });
    // `$b` e a crase dentro de aspas duplas o shell expandiria/executaria: aspas simples nao
    assert.strictEqual(comandoDoPlano(e.stdout), "'" + path.join(esquisito, 'scripts', 'plano.js') + "'", e.stdout);
    // controle: caminho comum segue entre aspas duplas, como sempre (o caso normal nao muda)
    const n = rodarNoPlugin(normal, 'abertura.js', dir, { session_id: 'abe1n', cwd: dir, source: 'startup' });
    assert.strictEqual(comandoDoPlano(n.stdout), '"' + path.join(normal, 'scripts', 'plano.js') + '"', n.stdout);
  } finally {
    limparCopia(esquisito); limparCopia(normal);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('S8 A2-3: falha do require da auditoria nao calada: 1 linha diz que nao rodou, e o resto da abertura sai', () => {
  const plugin = pluginCopia('plugin');
  const dir = temp('a23');
  try {
    fs.writeFileSync(path.join(plugin, 'scripts', 'lib', 'auditoria-periodica.js'), 'module.exports = {{ ;\n', 'utf8');
    projetoComRegras(dir);
    projetoComPlanoDeOutro(dir);
    const r = rodarNoPlugin(plugin, 'abertura.js', dir, { session_id: 'a23', cwd: dir, source: 'startup' });
    const linhas = r.stdout.split('\n').filter(function (l) { return l.indexOf('auditoria automatica nao rodou') !== -1; });
    assert.strictEqual(linhas.length, 1, r.stdout);
    assert.ok(/SyntaxError/.test(linhas[0]), 'a linha diz a causa: ' + linhas[0]);
    assert.ok(r.stdout.includes(qualidade.BLOCO), 'o resto da abertura sumiu: ' + r.stdout);
    assert.ok(/outra sessao detem o plano ativo/i.test(r.stdout), 'o plano (depois da auditoria) sumiu: ' + r.stdout);
    // controle: com a auditoria sem defeito (plugin inteiro) essa linha nao sai
    const ok = rodar('abertura.js', dir, { session_id: 'a23ok', cwd: dir, source: 'startup' });
    assert.ok(!/nao rodou/.test(ok.stdout), 'aviso indevido com a auditoria sem defeito: ' + ok.stdout);
  } finally { limparCopia(plugin); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('S8 A2-4: o aviso de projeto.json ilegivel sai uma vez so, mesmo se a reinjecao mudar a frase dela', () => {
  const plugin = pluginCopia('plugin');
  const dir = temp('a24');
  try {
    const arq = path.join(plugin, 'scripts', 'lib', 'reinjecao.js');
    const original = fs.readFileSync(arq, 'utf8');
    const reescrito = original.replace('existe mas nao se le (', 'ficou ilegivel (');
    assert.notStrictEqual(reescrito, original, 'a frase da reinjecao mudou de lugar: ajuste o teste');
    fs.writeFileSync(arq, reescrito, 'utf8');
    const avisos = function (stdout) { return (stdout.match(/projeto\.json (existe mas nao se le|ficou ilegivel)/g) || []).length; };
    escrever(dir, path.join('.claude', 'sworn', 'projeto.json'), '{isso nao fecha');

    // com regras: a reinjecao ja avisou (com a frase reescrita); a abertura nao dobra
    escrever(dir, path.join('.claude', 'sworn', 'regras.md'), '# Regras\n\n- ' + REGRA_Q + '\n');
    const com = rodarNoPlugin(plugin, 'abertura.js', dir, { session_id: 'a24c', cwd: dir, source: 'startup' });
    assert.ok(/ficou ilegivel/.test(com.stdout), 'controle: a reinjecao tinha de avisar: ' + com.stdout);
    assert.strictEqual(avisos(com.stdout), 1, com.stdout);

    // controle positivo: regras.md sem nenhuma regra -> a reinjecao nao avisa, a abertura avisa (nunca calado)
    escrever(dir, path.join('.claude', 'sworn', 'regras.md'), '# Regras\n\nsem itens aqui\n');
    const vazio = rodarNoPlugin(plugin, 'abertura.js', dir, { session_id: 'a24v', cwd: dir, source: 'startup' });
    assert.strictEqual(avisos(vazio.stdout), 1, vazio.stdout);
    assert.ok(/DESLIGADOS/.test(vazio.stdout), vazio.stdout);

    // e sem regras.md nenhum
    fs.rmSync(path.join(dir, '.claude', 'sworn', 'regras.md'));
    const sem = rodarNoPlugin(plugin, 'abertura.js', dir, { session_id: 'a24s', cwd: dir, source: 'startup' });
    assert.strictEqual(avisos(sem.stdout), 1, sem.stdout);
  } finally { limparCopia(plugin); fs.rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------ Bloco V (D426/D437): a novidade do vigia na abertura

/** Abertura com a pasta do vigia injetada por SWORN_VIGIA (o `rodar` comum nao passa env extra). */
function abrirVigia(dir, id, pastaVigia) {
  return spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'abertura.js')], {
    cwd: dir,
    encoding: 'utf8',
    input: JSON.stringify({ session_id: id, cwd: dir, source: 'startup' }),
    env: Object.assign({}, process.env, { SWORN_TMP: path.join(dir, '_sessoes'), SWORN_VIGIA: pastaVigia })
  });
}

test('V: com "vigia": true a abertura mostra a novidade da semana uma vez, e o resto da abertura segue', () => {
  const dir = temp('vigia-liga');
  const pastaVigia = temp('vigia-pasta');
  try {
    escrever(dir, '.claude/sworn/projeto.json', JSON.stringify({ vigia: true }));
    escrever(pastaVigia, 'novidades.md', 'semana: 2026-10-05\n\n- Cart\u00e3o novo da semana\n');
    const r1 = abrirVigia(dir, 'v1', pastaVigia);
    assert.strictEqual(r1.status, 0, r1.stderr);
    assert.ok(r1.stdout.indexOf('novidade da semana de 2026-10-05') !== -1, r1.stdout);
    assert.ok(r1.stdout.indexOf('- Cartao novo da semana') !== -1, r1.stdout);
    assert.ok(/qualidade de resposta/.test(r1.stdout), 'o resto da abertura sumiu: ' + r1.stdout);
    assert.ok(fs.existsSync(path.join(pastaVigia, 'visto.json')), 'nao marcou como vista');
    const r2 = abrirVigia(dir, 'v2', pastaVigia);
    assert.strictEqual(r2.status, 0, r2.stderr);
    assert.strictEqual(r2.stdout.indexOf('novidade da semana de'), -1, 'mostrou a mesma semana duas vezes: ' + r2.stdout);
    assert.ok(/qualidade de resposta/.test(r2.stdout), 'o resto da abertura sumiu');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(pastaVigia, { recursive: true, force: true });
  }
});

// Plano do radar, T4: a ficha da semana puxada para <pasta do vigia>/radar/ vira uma linha com a conta, uma vez.
test('V: com "vigia": true a abertura mostra o radar da semana uma vez, depois do vigia', () => {
  const dir = temp('radar-liga');
  const pastaVigia = temp('radar-pasta');
  try {
    escrever(dir, '.claude/sworn/projeto.json', JSON.stringify({ vigia: true }));
    escrever(pastaVigia, 'novidades.md', 'semana: 2026-10-05\n\n- Novidade\n');
    escrever(pastaVigia, 'radar/novidades.md', 'semana: 2026-10-19\n\n## Candidatos\n\n' +
      '| Repo | Licença | Como entra | Como melhora | Esforço | Valor | Veredito |\n|---|---|---|---|---|---|---|\n' +
      '| a/b | MIT | no fecho | barra | P | alto | adotar |\n');
    const r1 = abrirVigia(dir, 'r1', pastaVigia);
    assert.strictEqual(r1.status, 0, r1.stderr);
    const i = r1.stdout.indexOf('sworn: radar - ficha da semana de 2026-10-19: 1 candidato, 1 para adotar.');
    assert.ok(i !== -1, r1.stdout);
    assert.ok(r1.stdout.indexOf('novidade da semana de 2026-10-05') < i, 'o radar veio antes do vigia');
    const r2 = abrirVigia(dir, 'r2', pastaVigia);
    assert.strictEqual(r2.stdout.indexOf('sworn: radar'), -1, 'mostrou o radar duas vezes: ' + r2.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(pastaVigia, { recursive: true, force: true });
  }
});

test('V: sem a chave (ou com vigia: false) a abertura nao fala do vigia e nao cria a pasta', () => {
  const dir = temp('vigia-desliga');
  const base = temp('vigia-base');
  const pastaVigia = path.join(base, 'ainda-nao-existe');
  try {
    escrever(dir, '.claude/sworn/projeto.json', JSON.stringify({}));
    const r = abrirVigia(dir, 'v-off', pastaVigia);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout.indexOf('vigia'), -1, r.stdout);
    assert.ok(!fs.existsSync(pastaVigia), 'a abertura criou a pasta do vigia sem opt-in');
    escrever(dir, '.claude/sworn/projeto.json', JSON.stringify({ vigia: false }));
    const f = abrirVigia(dir, 'v-false', pastaVigia);
    assert.strictEqual(f.stdout.indexOf('vigia'), -1, f.stdout);
    assert.ok(!fs.existsSync(pastaVigia));
    // sem projeto.json nenhum: o mesmo
    const sem = temp('vigia-sem-projeto');
    try {
      const s = abrirVigia(sem, 'v-sem', pastaVigia);
      // 091 #7: a ordem do init cita a pasta temporaria (que tem "vigia" no nome) no comando do "nunca"; fora ela.
      const semOrdem = s.stdout.split('\n').filter(function (l) { return l.indexOf('Com "nunca", rode: ') !== 0; }).join('\n');
      assert.strictEqual(semOrdem.indexOf('vigia'), -1, s.stdout);
      assert.ok(!fs.existsSync(pastaVigia));
    } finally { fs.rmSync(sem, { recursive: true, force: true }); }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// D503 (plano d503, Tarefa 6, 1o subitem): sem a chave `referencias`, a abertura avisa UMA vez por projeto (marca em
// .claude/sworn/referencia-avisada.json) e diz como declarar e como calar; com a chave, ate `{}`, calada.
const MARCA_REF = path.join('.claude', 'sworn', 'referencia-avisada.json');
const RE_AVISO_REF = /referencia de topo/;

test('D503 T6: abertura avisa uma vez que falta a referencia de topo, em ASCII, com o caminho de declarar e de calar', () => {
  const dir = temp('ref-falta');
  try {
    escrever(dir, path.join('.claude', 'sworn', 'projeto.json'), JSON.stringify({ versaoConfig: 1 }));
    const r = rodar('abertura.js', dir, { session_id: 'rf1', cwd: dir, source: 'startup' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, RE_AVISO_REF, r.stdout);
    const aviso = r.stdout.split('\n').filter((l) => RE_AVISO_REF.test(l))[0];
    assert.match(aviso, /referencias/, 'nomeia a chave');
    assert.match(aviso, /\/sworn:init/, 'diz como declarar');
    // Plano do REA, Tarefa 3 (D580; mock prints-rea/mock-rea.png, secao 4): o comando novo vem primeiro, dizendo o que faz.
    assert.ok(aviso.includes('rode /sworn:reference (estuda 2-3 produtos lideres do mesmo tipo e grava a ficha), ' +
      'rode /sworn:init de novo (Passo 4b) ou ponha a chave a mao'), 'aponta o /sworn:reference: ' + aviso);
    assert.match(aviso, /"referencias": \{\}/, 'diz como calar de vez');
    assert.match(aviso, /uma vez/, 'diz que sai uma vez');
    assert.ok(/^[\x20-\x7E]*$/.test(aviso), 'aviso fora de ASCII: ' + aviso);
    assert.ok(fs.existsSync(path.join(dir, MARCA_REF)), 'a marca do aviso dado');
    const de_novo = rodar('abertura.js', dir, { session_id: 'rf2', cwd: dir, source: 'startup' });
    assert.doesNotMatch(de_novo.stdout, RE_AVISO_REF, 'segunda abertura, calada: ' + de_novo.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D503 T6: controles - com a chave (ate vazia), sem projeto.json ou com projeto.json ilegivel, nada de aviso nem marca', () => {
  const casos = [
    ['ref-vazia', JSON.stringify({ versaoConfig: 1, referencias: {} })],
    ['ref-cheia', JSON.stringify({ versaoConfig: 1, referencias: { codigo: ['ref/topo.js'] } })],
    ['ref-ilegivel', '{ versaoConfig: 1,'],
    ['ref-sem-projeto', null]
  ];
  for (const [nome, conteudo] of casos) {
    const dir = temp(nome);
    try {
      if (conteudo !== null) escrever(dir, path.join('.claude', 'sworn', 'projeto.json'), conteudo);
      const r = rodar('abertura.js', dir, { session_id: nome, cwd: dir, source: 'startup' });
      assert.strictEqual(r.status, 0, nome + ': ' + r.stderr);
      assert.doesNotMatch(r.stdout, RE_AVISO_REF, nome + ': ' + r.stdout);
      assert.ok(!fs.existsSync(path.join(dir, MARCA_REF)), nome + ': marca sem aviso');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

// Revisao completa, L1 (A9-01): a fiacao inteira do hooks.json - evento, matcher, scripts na ordem e timeout. Antes so
// alguns elos eram presos (portao-estilo.test.js, gravar-veredito.test.js...); trocar o script do SessionStart, tirar o
// `Agent` do `Task|Agent` ou o `Skill` do marcador passava pela suite inteira (mutantes da A9).
test('hooks.json: cada evento chama os scripts certos, com o matcher, a ordem e o timeout de hoje', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(RAIZ, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const mapa = {};
  for (const evento of Object.keys(hooks)) {
    mapa[evento] = hooks[evento].map(function (g) {
      return [g.matcher || ''].concat(g.hooks.map(function (h) {
        assert.strictEqual(h.type + ' ' + h.command, 'command node', evento);
        assert.ok(fs.existsSync(h.args[0].replace('${CLAUDE_PLUGIN_ROOT}', RAIZ)), h.args[0]);
        return path.basename(h.args[0]) + ' ' + h.timeout;
      }));
    });
  }
  assert.deepStrictEqual(mapa, {
    SessionStart: [['', 'abertura.js 15']],
    UserPromptSubmit: [['', 'abrir-turno.js 10']],
    PreToolUse: [
      ['Write|Edit|NotebookEdit', 'portao-escopo.js 10'],
      ['Bash|PowerShell', 'portao-destrutivo.js 10', 'portao-estilo.js 10', 'portao-commit.js 30'],
      ['Task|Agent', 'portao-agente.js 10', 'portao-apelido.js 10'],
      ['AskUserQuestion', 'portao-decisao.js 10']
    ],
    PostToolUse: [
      ['Write|Edit|Bash|PowerShell|Grep|Glob|Read|AskUserQuestion|Skill', 'marcar-trabalho.js 10'],
      ['SubagentHandback', 'gravar-veredito.js 10'],
      ['SubagentHandback', 'escalar.js 10']
    ],
    SubagentStart: [['', 'abrir-subagente.js 10', 'escalar.js 10']],
    SubagentStop: [['^sworn:inspector$', 'gravar-veredito.js 10'], ['', 'escalar.js 10']],
    Stop: [['', 'portao-fecho.js 10']],
    SessionEnd: [['', 'fim-sessao.js 10']]
  });
});
