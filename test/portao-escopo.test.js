'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');

function rodar(entrada, tmp) {
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'portao-escopo.js')], {
    input: JSON.stringify(entrada),
    encoding: 'utf8',
    env: Object.assign({}, process.env, { SWORN_TMP: tmp })
  });
  let json = null;
  if (r.stdout && r.stdout.trim()) { try { json = JSON.parse(r.stdout); } catch (e) { json = null; } }
  return { status: r.status, json: json, stderr: r.stderr };
}

function negou(r) {
  return !!(r.json && r.json.hookSpecificOutput && r.json.hookSpecificOutput.permissionDecision === 'deny');
}

/**
 * D37: liberacao POR DECISAO, nao por inercia. Um portao que estourou tambem
 * devolve "nao negou" - a diferenca esta no exit code e no rastro que blindar()
 * deixa no stderr.
 */
function liberou(r) {
  assert.strictEqual(r.status, 0, 'o portao tem de sair com 0 (R6). stderr: ' + r.stderr);
  assert.ok(!/portao falhou/.test(r.stderr || ''),
    'o portao caiu e liberou por inercia, nao por decisao: ' + r.stderr);
  assert.strictEqual(negou(r), false);
}

function montarProjeto(extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-proj-'));
  fs.mkdirSync(path.join(dir, '.claude', 'sworn'), { recursive: true });
  const projeto = Object.assign({
    versaoConfig: 1,
    marchaPadrao: 'padrao',
    intocaveis: ['segredos/**'],
    marchas: { aaa: ['**/auth/**'], padrao: ['src/**'], rapida: ['docs/**', '**/*.md'] }
  }, extra || {});
  fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify(projeto), 'utf8');
  return dir;
}

function escrever(dir, rel, conteudo) {
  const alvo = path.join(dir, rel);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, conteudo, 'utf8');
  return alvo;
}

function entrada(dir, arquivo, tmpSessao) {
  return {
    session_id: 's1', cwd: dir, hook_event_name: 'PreToolUse',
    tool_name: 'Write', tool_input: { file_path: path.join(dir, arquivo) }
  };
}

function comTmp(fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-esc-'));
  try { fn(base); } finally { fs.rmSync(base, { recursive: true, force: true }); }
}

test('portao-escopo: marcha rapida nao exige escopo', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    const r = rodar(entrada(dir, 'docs/nota.md'), tmp);
    liberou(r);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('portao-escopo: marcha padrao sem escopo.md e negada', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    const r = rodar(entrada(dir, 'src/a.js'), tmp);
    assert.strictEqual(negou(r), true);
    assert.ok(r.json.hookSpecificOutput.permissionDecisionReason.includes('escopo.md'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('portao-escopo: arquivo dentro do escopo declarado passa', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    escrever(dir, '.claude/sworn/escopo.md', '## Dentro\n- src/a.js\n## Fora de escopo\n- o resto');
    const r = rodar(entrada(dir, 'src/a.js'), tmp);
    liberou(r);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('portao-escopo: arquivo FORA do escopo declarado e negado (C8)', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    escrever(dir, '.claude/sworn/escopo.md', '## Dentro\n- src/a.js\n## Fora de escopo\n- o resto');
    const r = rodar(entrada(dir, 'src/b.js'), tmp);
    assert.strictEqual(negou(r), true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('portao-escopo: intocavel e negado mesmo estando no escopo (C10)', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    escrever(dir, '.claude/sworn/escopo.md', '## Dentro\n- segredos/**\n');
    const r = rodar(entrada(dir, 'segredos/chave.env'), tmp);
    assert.strictEqual(negou(r), true);
    assert.ok(r.json.hookSpecificOutput.permissionDecisionReason.includes('intocavel'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('portao-escopo D35: o escopo.md passa pelo passe livre (fixture que discrimina)', () => {
  comTmp((tmp) => {
    // Fixture em que SO o passe livre pode liberar o escopo.md: marcha padrao
    // exige escopo ('**' casa tudo) e nao ha 'rapida' nem passe livre de sobra
    // para o teste passar por outro caminho que nao o que ele diz cobrir.
    const dir = montarProjeto({ marchas: { aaa: [], padrao: ['**'], rapida: [] } });
    const r = rodar(entrada(dir, '.claude/sworn/escopo.md'), tmp);
    liberou(r);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('portao-escopo D35: projeto.json NAO tem passe livre - cai na regra normal', () => {
  comTmp((tmp) => {
    const dir = montarProjeto({ marchas: { aaa: [], padrao: ['**'], rapida: [] } });
    const r = rodar(entrada(dir, '.claude/sworn/projeto.json'), tmp);
    assert.strictEqual(negou(r), true);
    // F9: 'escopo.md' aparece em QUALQUER motivoSemEscopo, para qualquer alvo - nao
    // discrimina nada. 'projeto.json' e o alvo de verdade interpolado na mensagem.
    assert.ok(r.json.hookSpecificOutput.permissionDecisionReason.includes('projeto.json'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('portao-escopo D35: contadores.json NAO tem passe livre', () => {
  comTmp((tmp) => {
    const dir = montarProjeto({ marchas: { aaa: [], padrao: ['**'], rapida: [] } });
    escrever(dir, '.claude/sworn/escopo.md', '## Dentro\n- src/a.js\n');
    const r = rodar(entrada(dir, '.claude/sworn/contadores.json'), tmp);
    assert.strictEqual(negou(r), true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('portao-escopo: reescrever escopo.md que ja existe conta ampliacao (desenho §5)', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    escrever(dir, '.claude/sworn/escopo.md', '## Dentro\n- src/a.js\n');
    rodar(entrada(dir, '.claude/sworn/escopo.md'), tmp);
    process.env.SWORN_TMP = tmp;
    delete require.cache[require.resolve('../scripts/lib/estado.js')];
    const estado = require('../scripts/lib/estado.js');
    assert.strictEqual(estado.ler('s1').contadores.escopo_ampliado, 1);
    delete process.env.SWORN_TMP;
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('portao-escopo D34: criar escopo.md do zero ja conta ampliacao', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    // sem escopo.md no disco: a CRIACAO e que tem de ser contada, nao so a reescrita.
    const r = rodar({
      session_id: 's1', cwd: dir, tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.claude', 'sworn', 'escopo.md'), content: '## Dentro\n- **\n' }
    }, tmp);
    liberou(r);
    process.env.SWORN_TMP = tmp;
    delete require.cache[require.resolve('../scripts/lib/estado.js')];
    const estado = require('../scripts/lib/estado.js');
    assert.strictEqual(estado.ler('s1').contadores.escopo_ampliado, 1);
    delete process.env.SWORN_TMP;
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('portao-escopo D34: encolher o escopo NAO conta ampliacao', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    escrever(dir, '.claude/sworn/escopo.md', '## Dentro\n- src/**\n- test/**\n');

    // F10: semeia um contador de outra trava ANTES do cenario, para o estado da
    // sessao existir de verdade. Sem isto, "contadores ausente" podia significar
    // tanto "nao ampliou" quanto "o estado nunca foi escrito" - a asserção provava
    // a coisa errada por acidente.
    process.env.SWORN_TMP = tmp;
    delete require.cache[require.resolve('../scripts/lib/estado.js')];
    require('../scripts/lib/estado.js').incrementar('s1', 'sem_escopo');
    delete process.env.SWORN_TMP;

    const r = rodar({
      session_id: 's1', cwd: dir, tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.claude', 'sworn', 'escopo.md'), content: '## Dentro\n- src/**\n' }
    }, tmp);
    liberou(r);
    process.env.SWORN_TMP = tmp;
    delete require.cache[require.resolve('../scripts/lib/estado.js')];
    const estado = require('../scripts/lib/estado.js');
    const s = estado.ler('s1');
    assert.ok(s.contadores, 'o estado precisa existir de verdade (foi semeado antes do cenario)');
    assert.strictEqual(s.contadores.escopo_ampliado, undefined, 'encolher nao pode contar como ampliacao');
    delete process.env.SWORN_TMP;
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('portao-escopo D38: escopo.md com caixa trocada nao escapa do passe livre', () => {
  comTmp((tmp) => {
    // config canonica do plano (default de montarProjeto): rapida inclui '**/*.md',
    // que e onde a burla de 1 caractere funciona (Escopo.md cairia em marcha rapida
    // e sairia sem negacao, sem aviso e sem contagem, se a comparacao fosse sensivel a caixa).
    const dir = montarProjeto();
    const r = rodar({
      session_id: 's1', cwd: dir, tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.claude', 'sworn', 'Escopo.md'), content: '## Dentro\n- **\n' }
    }, tmp);
    liberou(r);
    process.env.SWORN_TMP = tmp;
    delete require.cache[require.resolve('../scripts/lib/estado.js')];
    const estado = require('../scripts/lib/estado.js');
    assert.strictEqual(estado.ler('s1').contadores.escopo_ampliado, 1,
      'a burla de caixa tem de ser contada, nunca invisivel');
    delete process.env.SWORN_TMP;
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('portao-escopo: projeto sem projeto.json libera e avisa uma vez so', () => {
  comTmp((tmp) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-cru-'));
    const primeiro = rodar(entrada(dir, 'src/a.js'), tmp);
    const segundo = rodar(entrada(dir, 'src/b.js'), tmp);
    assert.strictEqual(negou(primeiro), false);
    assert.ok(primeiro.json && primeiro.json.systemMessage.includes('/sworn:init'));
    assert.strictEqual(segundo.json, null, 'nao repete o aviso');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('portao-escopo: arquivo fora do projeto nao e assunto do portao', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    const r = rodar({
      session_id: 's1', cwd: dir, tool_name: 'Write',
      tool_input: { file_path: path.join(os.tmpdir(), 'longe.txt') }
    }, tmp);
    liberou(r);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('portao-escopo D37: entrada hostil faz o portao LIBERAR, nunca travar (R6)', () => {
  comTmp((tmp) => {
    // cwd numerico faz path.resolve estourar dentro do callback assincrono:
    // e exatamente o caminho que blindar() precisa cobrir.
    const hostil = rodar({
      session_id: 's1', cwd: 42, tool_name: 'Write',
      tool_input: { file_path: 'src/a.js' }
    }, tmp);
    assert.strictEqual(hostil.status, 0, 'R6: portao que falha nao pode travar a sessao');
    assert.strictEqual(negou(hostil), false, 'R6: portao que falha tem de LIBERAR');
    // F7: prova que a entrada REALMENTE estourou (nao so que o resultado parece "liberou").
    // Sem isto, se a entrada um dia parar de ser hostil, o teste continua verde sem
    // exercitar o caminho de falha nenhuma vez - exatamente o que este projeto existe para pegar.
    assert.ok(/portao falhou/.test(hostil.stderr || ''),
      'a entrada precisa ser mesmo hostil: sem estouro, este teste nao prova o R6');
  });
});

// D244/defeito 7 (D241 secao 2.7): a secao "Fora" era lida e nenhum portao a consultava.
test('D244/defeito 7: arquivo declarado Fora e negado mesmo casando Dentro', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    escrever(dir, '.claude/sworn/escopo.md',
      '# Escopo\r\n**Objetivo:** x\r\n## Dentro\r\n- src/**\r\n## Fora de escopo\r\n- src/legado/** (nao mexer)\r\n');
    escrever(dir, 'src/legado/x.js', 'velho');
    escrever(dir, 'src/novo.js', 'velho');
    const r = rodar(entrada(dir, 'src/legado/x.js'), tmp);
    assert.ok(negou(r), 'src/legado/x.js foi declarado Fora e passou');
    assert.ok(r.json.hookSpecificOutput.permissionDecisionReason.includes('src/legado/**'));
    liberou(rodar(entrada(dir, 'src/novo.js'), tmp));
  });
});

test('D244/defeito 7: Fora vale tambem em marcha rapida', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    escrever(dir, '.claude/sworn/escopo.md', '## Dentro\n- src/a.js\n## Fora de escopo\n- docs/ata.md\n');
    escrever(dir, 'docs/ata.md', 'velho');
    assert.ok(negou(rodar(entrada(dir, 'docs/ata.md'), tmp)));
  });
});

test('D244/defeito 7: a abertura avisa que o escopo e herdado, com objetivo e data', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    escrever(dir, '.claude/sworn/escopo.md', '# Escopo\n**Objetivo:** fechar a tarefa antiga\n## Dentro\n- src/a.js\n');
    const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'abertura.js')], {
      input: JSON.stringify({ session_id: 'her', cwd: dir, source: 'startup' }),
      encoding: 'utf8', env: Object.assign({}, process.env, { SWORN_TMP: tmp })
    });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /escopo herdado/);
    assert.match(r.stdout, /fechar a tarefa antiga/);
    assert.match(r.stdout, /\d{4}-\d{2}-\d{2}/);
  });
});

test('D244/defeito 7: sem escopo.md, a abertura nao fala de heranca', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'abertura.js')], {
      input: JSON.stringify({ session_id: 'her2', cwd: dir, source: 'startup' }),
      encoding: 'utf8', env: Object.assign({}, process.env, { SWORN_TMP: tmp })
    });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /escopo herdado/);
  });
});

// ---------------------------------------------------- escopo por frente

function lerEstado(tmp, sessionId) {
  process.env.SWORN_TMP = tmp;
  delete require.cache[require.resolve('../scripts/lib/estado.js')];
  const estado = require('../scripts/lib/estado.js');
  const s = estado.ler(sessionId);
  delete process.env.SWORN_TMP;
  return s;
}

test('escopo por frente: Write em escopos/omni.md libera sem escopo previo e grava a frente no estado', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    const r = rodar({
      session_id: 's1', cwd: dir, tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.claude', 'sworn', 'escopos', 'omni.md'), content: '## Dentro\n- src/a.js\n' }
    }, tmp);
    liberou(r);
    assert.strictEqual(lerEstado(tmp, 's1').frente, 'omni');

    escrever(dir, '.claude/sworn/escopos/omni.md', '## Dentro\n- src/a.js\n');
    liberou(rodar(entrada(dir, 'src/a.js'), tmp));
    const fora = rodar(entrada(dir, 'src/b.js'), tmp);
    assert.strictEqual(negou(fora), true);
    assert.ok(fora.json.hookSpecificOutput.permissionDecisionReason.includes('.claude/sworn/escopos/omni.md'),
      fora.json.hookSpecificOutput.permissionDecisionReason);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('escopo por frente: ampliar o Dentro do arquivo da frente conta escopo_ampliado, encolher nao', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    escrever(dir, '.claude/sworn/escopos/omni.md', '## Dentro\n- src/a.js\n');
    liberou(rodar({
      session_id: 's1', cwd: dir, tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.claude', 'sworn', 'escopos', 'omni.md'), content: '## Dentro\n- src/a.js\n- src/b.js\n' }
    }, tmp));
    assert.strictEqual(lerEstado(tmp, 's1').contadores.escopo_ampliado, 1);

    // controle: encolher o Dentro nao pode contar como ampliacao (mesmo desenho do escopo.md)
    process.env.SWORN_TMP = tmp;
    delete require.cache[require.resolve('../scripts/lib/estado.js')];
    require('../scripts/lib/estado.js').incrementar('s2', 'sem_escopo');
    delete process.env.SWORN_TMP;
    escrever(dir, '.claude/sworn/escopos/outra.md', '## Dentro\n- src/c.js\n- src/d.js\n');
    liberou(rodar({
      session_id: 's2', cwd: dir, tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.claude', 'sworn', 'escopos', 'outra.md'), content: '## Dentro\n- src/c.js\n' }
    }, tmp));
    const s2 = lerEstado(tmp, 's2');
    assert.ok(s2.contadores, 'o estado precisa existir de verdade');
    assert.strictEqual(s2.contadores.escopo_ampliado, undefined, 'encolher nao pode contar como ampliacao');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('escopo por frente: sessao sem vinculo continua regida pelo escopo.md de hoje', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    escrever(dir, '.claude/sworn/escopo.md', '## Dentro\n- src/geral.js\n');
    escrever(dir, '.claude/sworn/escopos/omni.md', '## Dentro\n- src/a.js\n');
    const semVinculo = rodar({
      session_id: 'sv1', cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'a.js') }
    }, tmp);
    assert.strictEqual(negou(semVinculo), true, 'arquivo so listado na frente nao pode passar sem vinculo');
    liberou(rodar({
      session_id: 'sv1', cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'geral.js') }
    }, tmp));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('escopo por frente: duas frentes simultaneas nao se liberam uma a outra', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    // os arquivos das duas frentes precisam existir DE VERDADE no disco: o
    // portao so simula a escrita que esta acontecendo agora (a do proprio
    // arquivo de frente), nao o resultado dela - por isso escreve-se antes.
    escrever(dir, '.claude/sworn/escopos/a.md', '## Dentro\n- src/so-a.js\n');
    escrever(dir, '.claude/sworn/escopos/b.md', '## Dentro\n- src/so-b.js\n');
    liberou(rodar({
      session_id: 'sA', cwd: dir, tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.claude', 'sworn', 'escopos', 'a.md'), content: '## Dentro\n- src/so-a.js\n' }
    }, tmp));
    liberou(rodar({
      session_id: 'sB', cwd: dir, tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.claude', 'sworn', 'escopos', 'b.md'), content: '## Dentro\n- src/so-b.js\n' }
    }, tmp));
    assert.strictEqual(lerEstado(tmp, 'sA').frente, 'a');
    assert.strictEqual(lerEstado(tmp, 'sB').frente, 'b');

    const aTentaB = rodar({
      session_id: 'sA', cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'so-b.js') }
    }, tmp);
    assert.strictEqual(negou(aTentaB), true, 'a sessao A nao pode gravar o que so a frente B libera');
    assert.ok(aTentaB.json.hookSpecificOutput.permissionDecisionReason.includes('.claude/sworn/escopos/a.md'),
      aTentaB.json.hookSpecificOutput.permissionDecisionReason);
    const bTentaA = rodar({
      session_id: 'sB', cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'so-a.js') }
    }, tmp);
    assert.strictEqual(negou(bTentaA), true, 'a sessao B nao pode gravar o que so a frente A libera');

    liberou(rodar({
      session_id: 'sA', cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'so-a.js') }
    }, tmp));
    liberou(rodar({
      session_id: 'sB', cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'so-b.js') }
    }, tmp));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('escopo por frente: frente aposentada (arquivo movido para fora de escopos/) volta a valer o escopo.md', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    escrever(dir, '.claude/sworn/escopo.md', '## Dentro\n- src/geral.js\n');
    const arquivoFrente = escrever(dir, '.claude/sworn/escopos/omni.md', '## Dentro\n- src/a.js\n');
    liberou(rodar({
      session_id: 's1', cwd: dir, tool_name: 'Write', tool_input: { file_path: arquivoFrente, content: '## Dentro\n- src/a.js\n' }
    }, tmp));

    assert.strictEqual(negou(rodar(entrada(dir, 'src/geral.js'), tmp)), true, 'a frente vinculada ainda existe');

    fs.rmSync(arquivoFrente);
    liberou(rodar(entrada(dir, 'src/geral.js'), tmp));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('escopo por frente: nome de frente invalido e negado sem gravar vinculo, e conta no balde frente_invalida (F6-04)', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    const r = rodar({
      session_id: 's1', cwd: dir, tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.claude', 'sworn', 'escopos', 'onda 8.md'), content: '## Dentro\n- src/a.js\n' }
    }, tmp);
    assert.strictEqual(negou(r), true);
    assert.ok(r.json.hookSpecificOutput.permissionDecisionReason.includes('nome de frente invalido'),
      r.json.hookSpecificOutput.permissionDecisionReason);
    const s = lerEstado(tmp, 's1');
    assert.strictEqual(s.frente, undefined, 'nome invalido nao pode gravar vinculo');
    assert.strictEqual(s.contadores.frente_invalida, 1, 'F6-04: balde proprio, para o contador dizer o que barrou');
    assert.strictEqual(s.contadores.fora_do_escopo, undefined, 'F6-04: nome invalido nao conta mais como fora do escopo');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('F6-04: o que o escopo declara "Fora" conta em fora_declarado; o que so nao esta no "Dentro" segue em fora_do_escopo', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    escrever(dir, '.claude/sworn/escopo.md', '## Dentro\n- src/**\n## Fora de escopo\n- src/proibido.js\n');
    const declarado = rodar({
      session_id: 'sd', cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'proibido.js') }
    }, tmp);
    assert.strictEqual(negou(declarado), true);
    const sd = lerEstado(tmp, 'sd');
    assert.strictEqual(sd.contadores.fora_declarado, 1, 'declarado Fora: balde proprio');
    assert.strictEqual(sd.contadores.fora_do_escopo, undefined, 'declarado Fora nao conta mais em fora_do_escopo');

    // Controle do lado oposto: arquivo que so nao esta no "Dentro" (marcha padrao) segue no balde de sempre.
    escrever(dir, '.claude/sworn/escopo.md', '## Dentro\n- src/a.js\n');
    const naoListado = rodar({
      session_id: 'sf', cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'b.js') }
    }, tmp);
    assert.strictEqual(negou(naoListado), true);
    const sf = lerEstado(tmp, 'sf');
    assert.strictEqual(sf.contadores.fora_do_escopo, 1, 'fora do Dentro: o balde existente');
    assert.strictEqual(sf.contadores.fora_declarado, undefined, 'fora do Dentro nao e "declarado Fora"');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// F2-16: o escopo de uma frente cujo arquivo fica FORA do projeto (pasta escopos/ que e link) nao libera nada.
test('F2-16: frente vinculada cuja pasta e link para FORA do projeto nao libera o escopo (junction de verdade)', (t) => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    const fora = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-esc-fora-'));
    try {
      fs.writeFileSync(path.join(fora, 'x.md'), '## Dentro\n- src/a.js\n', 'utf8');
      try {
        fs.symlinkSync(fora, path.join(dir, '.claude', 'sworn', 'escopos'), 'junction');
      } catch (e) {
        t.skip('nao deu para criar link neste disco/usuario (' + (e && e.code) + ')');
        return;
      }
      // Vincula a sessao a frente x (escrever o arquivo da frente tem o passe livre).
      liberou(rodar({
        session_id: 'sl', cwd: dir, tool_name: 'Write',
        tool_input: { file_path: path.join(dir, '.claude', 'sworn', 'escopos', 'x.md'), content: '## Dentro\n- src/a.js\n' }
      }, tmp));
      assert.strictEqual(lerEstado(tmp, 'sl').frente, 'x');
      // O escopo "de fora" lista src/a.js, mas nao pode ser lido: sem escopo valido, a marcha padrao nega.
      const r = rodar({
        session_id: 'sl', cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'a.js') }
      }, tmp);
      assert.strictEqual(negou(r), true, 'o escopo lido de fora do projeto liberou a escrita');
      assert.strictEqual(lerEstado(tmp, 'sl').contadores.sem_escopo, 1, 'conta como sem escopo (mais estrito)');
    } finally { fs.rmSync(fora, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

test('escopo por frente: a mesma pasta em caixa alta continua liberando e vinculando (D38)', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    liberou(rodar({
      session_id: 's1', cwd: dir, tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.claude', 'Sworn', 'Escopos', 'omni.md'), content: '## Dentro\n- src/a.js\n' }
    }, tmp));
    assert.strictEqual(lerEstado(tmp, 's1').frente, 'omni');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------- D420/PT-03: o contador nunca decide

// O diretorio de estado vira um ARQUIVO: mkdir/rename do estado lancam ENOTDIR. O contador
// e secundario - a negacao nao pode depender dele (antes, o incrementar lancava, o blindar
// liberava e o Write em arquivo intocavel passava).
function comEstadoIngravavel(fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-inop-'));
  const arquivo = path.join(base, 'e-um-arquivo');
  fs.writeFileSync(arquivo, 'x', 'utf8');
  try { fn(arquivo); } finally { fs.rmSync(base, { recursive: true, force: true }); }
}

test('D420/PT-03: estado inalteravel nao libera Write em intocavel', () => {
  comEstadoIngravavel((tmp) => {
    const dir = montarProjeto();
    try {
      const r = rodar(entrada(dir, 'segredos/k.txt'), tmp);
      assert.ok(negou(r), 'intocavel passou com o estado inalteravel. stderr: ' + r.stderr);
      assert.ok(r.json.hookSpecificOutput.permissionDecisionReason.includes('segredos/k.txt'));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

test('D420/PT-03: estado inalteravel nao libera sem_escopo, fora_do_escopo, fora_declarado nem criou_sem_buscar', () => {
  comEstadoIngravavel((tmp) => {
    const dir = montarProjeto();
    try {
      // padrao sem escopo.md
      assert.ok(negou(rodar(entrada(dir, 'src/a.js'), tmp)), 'sem_escopo passou');
      escrever(dir, '.claude/sworn/escopo.md',
        '## Dentro\n- src/a.js\n- src/novo/**\n## Fora de escopo\n- docs/ata.md\n');
      escrever(dir, 'src/b.js', 'velho');
      assert.ok(negou(rodar(entrada(dir, 'src/b.js'), tmp)), 'fora_do_escopo passou');
      escrever(dir, 'docs/ata.md', 'velho');
      assert.ok(negou(rodar(entrada(dir, 'docs/ata.md'), tmp)), 'fora_declarado passou');
      assert.ok(negou(rodar(entrada(dir, 'src/novo/x.js'), tmp)), 'criou_sem_buscar passou');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

test('D420/PT-03: estado inalteravel nao libera Edit que afrouxa catraca', () => {
  comEstadoIngravavel((tmp) => {
    const dir = montarProjeto();
    try {
      escrever(dir, '.claude/sworn/escopo.md', '## Dentro\n- src/a.js\n');
      escrever(dir, 'src/a.js', 'velho');
      const base = rodar({
        session_id: 's1', cwd: dir, tool_name: 'Edit',
        tool_input: { file_path: path.join(dir, 'src/a.js'), old_string: 'x', new_string: 'y' }
      }, tmp);
      liberou(base);
      const r = rodar({
        session_id: 's1', cwd: dir, tool_name: 'Edit',
        tool_input: { file_path: path.join(dir, 'src/a.js'), old_string: 'max: 10', new_string: 'max: 20' }
      }, tmp);
      assert.ok(negou(r), 'catraca afrouxada passou com o estado inalteravel. stderr: ' + r.stderr);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

// ---------------------------------------------------- S2/L1-7 e L1-8: falha de estado nao fica calada

const ARQ_FRENTE = '.claude/sworn/escopos/omni.md';

function escreverFrente(dir, tmp) {
  return rodar({
    session_id: 's1', cwd: dir, tool_name: 'Write',
    tool_input: { file_path: path.join(dir, ARQ_FRENTE), content: '## Dentro\n- src/a.js\n' }
  }, tmp);
}

test('S2/L1-7: estado ingravavel - Write do arquivo da frente LIBERA, mas avisa que o vinculo nao foi gravado', () => {
  comEstadoIngravavel((tmp) => {
    const dir = montarProjeto();
    try {
      const r = escreverFrente(dir, tmp);
      liberou(r);
      assert.ok(r.json && typeof r.json.systemMessage === 'string',
        'o vinculo nao gravou e nada avisou. stdout json: ' + JSON.stringify(r.json));
      assert.ok(r.json.systemMessage.includes('vinculo') && r.json.systemMessage.includes('omni'),
        r.json.systemMessage);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

test('S2/L1-7: estado gravavel - o vinculo grava e nenhum aviso sai (controle)', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    try {
      const r = escreverFrente(dir, tmp);
      liberou(r);
      assert.strictEqual(r.json, null, 'saiu aviso sem falha: ' + JSON.stringify(r.json));
      assert.strictEqual(lerEstado(tmp, 's1').frente, 'omni');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

test('S2/L1-8: contador que nao grava deixa rastro - na negacao (motivo) e na liberacao (systemMessage), sem mudar a decisao', () => {
  comEstadoIngravavel((tmp) => {
    const dir = montarProjeto();
    try {
      // negacao: o intocavel segue negado, e o motivo diz que o contador nao gravou
      const n = rodar(entrada(dir, 'segredos/k.txt'), tmp);
      assert.ok(negou(n), 'a falha do contador nao pode soltar o intocavel');
      const motivo = n.json.hookSpecificOutput.permissionDecisionReason;
      assert.ok(motivo.includes('segredos/k.txt') && motivo.includes('contador'), motivo);
      // liberacao: ampliar o escopo.md conta escopo_ampliado; segue liberado, com aviso
      const l = rodar({
        session_id: 's1', cwd: dir, tool_name: 'Write',
        tool_input: { file_path: path.join(dir, '.claude/sworn/escopo.md'), content: '## Dentro\n- src/a.js\n' }
      }, tmp);
      liberou(l);
      assert.ok(l.json && typeof l.json.systemMessage === 'string' && l.json.systemMessage.includes('contador'),
        'o balde escopo_ampliado nao gravou e nada avisou: ' + JSON.stringify(l.json));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

test('S2/L1-8: contador gravavel - negacao e liberacao saem sem rastro de falha (controle)', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    try {
      const n = rodar(entrada(dir, 'segredos/k.txt'), tmp);
      assert.ok(negou(n));
      assert.ok(!n.json.hookSpecificOutput.permissionDecisionReason.includes('contador'),
        n.json.hookSpecificOutput.permissionDecisionReason);
      const l = rodar({
        session_id: 's1', cwd: dir, tool_name: 'Write',
        tool_input: { file_path: path.join(dir, '.claude/sworn/escopo.md'), content: '## Dentro\n- src/a.js\n' }
      }, tmp);
      liberou(l);
      assert.strictEqual(l.json, null, JSON.stringify(l.json));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

// ---------------------------------------------------- D420/PT-04: projeto.json ilegivel

const JSON_COM_VIRGULA_SOBRANDO = '{"marchaPadrao":"padrao","intocaveis":["segredos/**"],}';

test('D420/PT-04: projeto.json invalido nao e "sem projeto": a mensagem diz a causa real', () => {
  comTmp((tmp) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-ileg-'));
    try {
      escrever(dir, '.claude/sworn/projeto.json', JSON_COM_VIRGULA_SOBRANDO);
      const primeiro = rodar(entrada(dir, 'src/a.js'), tmp);
      liberou(primeiro);
      assert.ok(primeiro.json && primeiro.json.systemMessage, 'sem aviso algum');
      assert.match(primeiro.json.systemMessage, /projeto\.json existe mas nao se le/);
      assert.match(primeiro.json.systemMessage, /DESLIGADOS/);
      assert.doesNotMatch(primeiro.json.systemMessage, /nao tem \.claude/);
      const segundo = rodar(entrada(dir, 'src/b.js'), tmp);
      assert.strictEqual(segundo.json, null, 'repetiu o aviso na mesma sessao');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

test('D420/PT-04: projeto.json que nao e objeto tambem e ilegivel, e ausente continua "nao tem"', () => {
  comTmp((tmp) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-ileg2-'));
    try {
      escrever(dir, '.claude/sworn/projeto.json', '5');
      const r = rodar(entrada(dir, 'src/a.js'), tmp);
      assert.match(r.json.systemMessage, /existe mas nao se le/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

test('D420/PT-04: a abertura avisa projeto.json ilegivel mesmo sem regras.md', () => {
  comTmp((tmp) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-ileg3-'));
    try {
      escrever(dir, '.claude/sworn/projeto.json', JSON_COM_VIRGULA_SOBRANDO);
      const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'abertura.js')], {
        input: JSON.stringify({ session_id: 'ab-ileg', cwd: dir, source: 'startup' }),
        encoding: 'utf8', env: Object.assign({}, process.env, { SWORN_TMP: tmp })
      });
      assert.strictEqual(r.status, 0, r.stderr);
      assert.match(r.stdout, /projeto\.json existe mas nao se le/);
      assert.match(r.stdout, /DESLIGADOS/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

test('D420/PT-04: a abertura sem projeto.json NAO fala de ilegivel; com regras.md o aviso nao dobra', () => {
  comTmp((tmp) => {
    const vazio = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-ileg4-'));
    const comRegras = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-ileg5-'));
    try {
      const abrir = (d, id) => spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'abertura.js')], {
        input: JSON.stringify({ session_id: id, cwd: d, source: 'startup' }),
        encoding: 'utf8', env: Object.assign({}, process.env, { SWORN_TMP: tmp })
      });
      assert.doesNotMatch(abrir(vazio, 'ab-aus').stdout, /existe mas nao se le/);
      escrever(comRegras, '.claude/sworn/projeto.json', JSON_COM_VIRGULA_SOBRANDO);
      escrever(comRegras, '.claude/sworn/regras.md', '- ao editar -> rodar git status\n');
      const r = abrir(comRegras, 'ab-dup');
      assert.strictEqual((r.stdout.match(/existe mas nao se le/g) || []).length, 1, r.stdout);
    } finally {
      fs.rmSync(vazio, { recursive: true, force: true });
      fs.rmSync(comRegras, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------- TS-01..03 (lote 3, D423): ramos de negacao do GANCHO

function motivoDeNegacao(r) {
  return (r.json && r.json.hookSpecificOutput && r.json.hookSpecificOutput.permissionDecisionReason) || '';
}

function comSessao(ent, id) { return Object.assign({}, ent, { session_id: id }); }

function editar(dir, arquivo, antes, depois, id) {
  return {
    session_id: id || 's1', cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Edit',
    tool_input: { file_path: path.join(dir, arquivo), old_string: antes, new_string: depois }
  };
}

// O PostToolUse real (marcar-trabalho.js) e quem liga `buscouNesteTurno`: o teste usa o gancho de verdade.
function registrarBusca(dir, tmp, id, ferramenta) {
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'marcar-trabalho.js')], {
    input: JSON.stringify({ session_id: id, cwd: dir, tool_name: ferramenta, tool_input: { file_path: path.join(dir, 'src/novo/x.js') } }),
    encoding: 'utf8', env: Object.assign({}, process.env, { SWORN_TMP: tmp })
  });
  assert.strictEqual(r.status, 0, r.stderr);
}

test('TS-01 (lote 3, D423): trava 7 - arquivo NOVO no escopo sem busca nega; Grep/Glob/Read no turno libera; nomeado no escopo libera', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    try {
      escrever(dir, '.claude/sworn/escopo.md', '## Dentro\n- src/**\n- src/nomeado.js\n');
      escrever(dir, 'src/velho.js', 'velho');
      // sem busca: nega, e pelo motivo da trava 7 (nao por outra via)
      const sem = rodar(comSessao(entrada(dir, 'src/novo/x.js'), 'ts01-sem'), tmp);
      assert.ok(negou(sem), 'arquivo novo sem busca tinha de negar');
      assert.match(motivoDeNegacao(sem), /sem ter procurado/);
      // a busca do turno alivia - cada ferramenta de busca, na sua sessao (a negacao acima nao vaza)
      for (const f of ['Grep', 'Glob', 'Read']) {
        const id = 'ts01-' + f;
        assert.ok(negou(rodar(comSessao(entrada(dir, 'src/novo/x.js'), id), tmp)), 'controle: ' + f + ' antes da busca ainda nega');
        registrarBusca(dir, tmp, id, f);
        liberou(rodar(comSessao(entrada(dir, 'src/novo/x.js'), id), tmp));
      }
      // nomeado (sem coringa) no escopo: a deliberacao ja foi feita, sem busca
      liberou(rodar(comSessao(entrada(dir, 'src/nomeado.js'), 'ts01-nome'), tmp));
      // editar o que ja existe nunca exige busca
      liberou(rodar(comSessao(entrada(dir, 'src/velho.js'), 'ts01-edit'), tmp));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

test('TS-02 (lote 3, D423): trava 8 - Edit que SOBE teto ou DESCE piso nega; mesmo numero e apertar passam; Write nao tem "antes"', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    try {
      escrever(dir, '.claude/sworn/escopo.md', '## Dentro\n- src/a.js\n');
      escrever(dir, 'src/a.js', 'velho');
      const sobe = rodar(editar(dir, 'src/a.js', '"teto": 3', '"teto": 8'), tmp);
      assert.ok(negou(sobe), 'subir teto de 3 para 8 tinha de negar');
      assert.match(motivoDeNegacao(sobe), /sobe a catraca/);
      assert.match(motivoDeNegacao(sobe), /3 -> 8/);
      const desce = rodar(editar(dir, 'src/a.js', '"minimo": 80', '"minimo": 40'), tmp);
      assert.ok(negou(desce), 'descer piso de 80 para 40 tinha de negar');
      assert.match(motivoDeNegacao(desce), /80 -> 40/);
      // controles: o mesmo numero (K01/K02 trocariam > por >=), apertar o teto e apertar o piso nao negam
      liberou(rodar(editar(dir, 'src/a.js', '"teto": 3', '"teto": 3'), tmp));
      liberou(rodar(editar(dir, 'src/a.js', '"minimo": 80', '"minimo": 80'), tmp));
      liberou(rodar(editar(dir, 'src/a.js', '"teto": 8', '"teto": 3'), tmp));
      liberou(rodar(editar(dir, 'src/a.js', '"minimo": 40', '"minimo": 80'), tmp));
      // Write nao tem "antes": criar/gravar uma catraca nao e afrouxar
      const w = entrada(dir, 'src/a.js');
      w.tool_input.content = '{ "teto": 8 }';
      liberou(rodar(w, tmp));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

// A2-02 / A9-04 (revisao completa, L2): a trava 8 so comparava os fragmentos do Edit. Write por cima de arquivo que
// JA tem a catraca, Edit so do numero (sem a palavra no fragmento) e o numero escrito como 2_000 ou 1e3 passavam.
test('A2-02: trava 8 compara o arquivo inteiro - Write por cima, Edit so do numero, 2_000 e 1e3 negam', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    try {
      escrever(dir, '.claude/sworn/escopo.md', '## Dentro\n- src/a.js\n');
      escrever(dir, 'src/a.js', '{ "teto": 200, "nome": "a" }\n');
      const w = entrada(dir, 'src/a.js');
      w.tool_input.content = '{ "teto": 800, "nome": "a" }\n';
      const porCima = rodar(w, tmp);
      assert.ok(negou(porCima), 'Write por cima subindo o teto de 200 para 800 tinha de negar');
      assert.match(motivoDeNegacao(porCima), /200 -> 800/);
      assert.ok(negou(rodar(editar(dir, 'src/a.js', '200', '300'), tmp)), 'Edit so do numero tinha de negar');
      assert.ok(negou(rodar(editar(dir, 'src/a.js', '"teto": 200', '"teto": 2_000'), tmp)), '2_000 tinha de negar');
      assert.ok(negou(rodar(editar(dir, 'src/a.js', '"teto": 200', '"teto": 1e3'), tmp)), '1e3 tinha de negar');
      // controles: mexer em outra coisa do arquivo, regravar igual e apertar passam
      liberou(rodar(editar(dir, 'src/a.js', '"a"', '"b"'), tmp));
      liberou(rodar(editar(dir, 'src/a.js', '200', '100'), tmp));
      const igual = entrada(dir, 'src/a.js');
      igual.tool_input.content = '{ "teto": 200, "nome": "b" }\n';
      liberou(rodar(igual, tmp));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

// A12-02 (revisao completa, L2): o NotebookEdit escreve arquivo (.ipynb), mas o matcher era Write|Edit e o portao so
// lia `file_path`; o do NotebookEdit e `notebook_path` (esquema da ferramenta, conferido na s103).
test('A12-02: NotebookEdit passa pelo portao de escopo - fora do escopo e intocavel negam, dentro libera', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(RAIZ, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const g = hooks.PreToolUse.filter(function (x) { return x.hooks.some(function (h) { return /portao-escopo\.js$/.test(h.args[0]); }); })[0];
  assert.ok(g && g.matcher.split('|').indexOf('NotebookEdit') !== -1, 'o NotebookEdit nao esta no matcher do portao de escopo');
  comTmp((tmp) => {
    const dir = montarProjeto();
    try {
      escrever(dir, '.claude/sworn/escopo.md', '## Dentro\n- src/a.ipynb\n');
      escrever(dir, 'src/a.ipynb', '{}');
      escrever(dir, 'src/b.ipynb', '{}');
      const nb = (rel) => ({ session_id: 'a1202', cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'NotebookEdit',
        tool_input: { notebook_path: path.join(dir, rel), new_source: 'x' } });
      assert.ok(negou(rodar(nb('src/b.ipynb'), tmp)), 'notebook fora do escopo tinha de negar');
      assert.ok(negou(rodar(nb('segredos/c.ipynb'), tmp)), 'notebook intocavel tinha de negar');
      liberou(rodar(nb('src/a.ipynb'), tmp));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

// A2-03 (revisao completa, L2): o portao de design conferia o new_string inteiro; o valor legado que o Edit so leva de
// contexto (o mesmo no old_string) barrava a edicao e mandava trocar o que o pedido nao tocava.
test('A2-03: valor fora do sistema que ja estava no old_string nao barra o Edit; o acrescentado barra', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    try {
      escrever(dir, '.claude/sworn/escopo.md', '## Dentro\n- src/a.css\n');
      escrever(dir, '.claude/sworn/design.json',
        JSON.stringify({ cores: ['#ffffff'], raios: ['4px'], espacos: ['8px'], sombras: [], antiReferencias: [] }));
      escrever(dir, 'src/a.css', '.a { padding: 13px; color: red }\n');
      liberou(rodar(editar(dir, 'src/a.css', '.a { padding: 13px; color: red }', '.a { padding: 13px; color: #ffffff }', 'a203-ctx'), tmp));
      const novo = rodar(editar(dir, 'src/a.css', '.a { padding: 13px; color: red }', '.a { padding: 13px; margin: 13px; color: #ffffff }', 'a203-mais'), tmp);
      assert.ok(negou(novo), 'o segundo 13px e acrescentado e tinha de negar');
      assert.match(motivoDeNegacao(novo), /13px/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

test('TS-03 (lote 3, D423): token_fora_do_sistema - Write (content) e Edit (new_string) em .css com cor fora do design.json negam; token dentro libera', () => {
  comTmp((tmp) => {
    const dir = montarProjeto();
    try {
      escrever(dir, '.claude/sworn/escopo.md', '## Dentro\n- src/app.css\n');
      escrever(dir, '.claude/sworn/design.json',
        JSON.stringify({ cores: ['#ff6600', '#ffffff'], raios: ['4px'], espacos: ['4px', '8px'], sombras: [], antiReferencias: [] }));
      escrever(dir, 'src/app.css', '.a { color: #ff6600; }\n');
      const escrita = (conteudo, id) => {
        const w = comSessao(entrada(dir, 'src/app.css'), id);
        w.tool_input.content = conteudo;
        return w;
      };
      const wFora = rodar(escrita('.a { color: #ff0000; }\n', 'ts03-w'), tmp);
      assert.ok(negou(wFora), 'Write com cor fora do sistema tinha de negar');
      assert.match(motivoDeNegacao(wFora), /fora do design system/);
      assert.match(motivoDeNegacao(wFora), /#ff0000/);
      liberou(rodar(escrita('.a { color: #ff6600; }\n', 'ts03-w2'), tmp));
      // Edit: o conteudo novo vem em new_string (nao ha `content`) - E26 so lia `content`
      const eFora = rodar(editar(dir, 'src/app.css', 'color: #ff6600;', 'color: #ff0000;', 'ts03-e'), tmp);
      assert.ok(negou(eFora), 'Edit com new_string fora do sistema tinha de negar');
      assert.match(motivoDeNegacao(eFora), /fora do design system/);
      assert.match(motivoDeNegacao(eFora), /#ff0000/);
      liberou(rodar(editar(dir, 'src/app.css', 'color: #ff6600;', 'color: #ffffff;', 'ts03-e2'), tmp));
      // o modulo e opcional: a mesma cor, sem design.json, nao nega
      fs.rmSync(path.join(dir, '.claude', 'sworn', 'design.json'));
      liberou(rodar(editar(dir, 'src/app.css', 'color: #ff6600;', 'color: #ff0000;', 'ts03-sem'), tmp));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

// ------------------------------- Plano 091 (#6, D559): o manual antes de arquivo AAA
// O motivo e o texto do mock aprovado (prints-091); o manual conta pelo PostToolUse da ferramenta Skill
// (marcar-trabalho.js), com a mesma regra do mod: skill do agente principal com "padrao" no nome.
function carregarSkill(dir, tmp, skill, extra) {
  return spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'marcar-trabalho.js')], {
    input: JSON.stringify(Object.assign({ session_id: 's1', cwd: dir, hook_event_name: 'PostToolUse',
      tool_name: 'Skill', tool_input: { skill: skill } }, extra || {})),
    encoding: 'utf8', env: Object.assign({}, process.env, { SWORN_TMP: tmp })
  });
}

function projetoAaa(extra) {
  const dir = montarProjeto(extra);
  escrever(dir, '.claude/sworn/escopo.md', '## Dentro\n- src/**\n');
  escrever(dir, 'src/auth/login.js', 'x');
  escrever(dir, 'src/app.js', 'x');
  return dir;
}

test('091 #6: arquivo AAA sem o manual carregado e negado com o motivo do mock; carregar o manual libera', () => {
  comTmp(function (tmp) {
    const dir = projetoAaa();
    try {
      const r = rodar(entrada(dir, 'src/auth/login.js'), tmp);
      assert.ok(negou(r), 'AAA sem manual passou');
      assert.strictEqual(r.json.hookSpecificOutput.permissionDecisionReason, [
        'sworn - falta carregar o manual antes de editar arquivo de rigor maximo.',
        '',
        '"src/auth/login.js" e de marcha AAA neste projeto, e nenhum manual',
        'de execucao (sworn:playbook, ou o manual do projeto) foi carregado nesta sessao.',
        'Faca agora: carregue a skill pela ferramenta Skill e tente a edicao de novo.',
        'Desligar neste projeto: "portaoManual": false em .claude/sworn/projeto.json.'
      ].join('\n'));
      assert.strictEqual(carregarSkill(dir, tmp, 'sworn:review').status, 0);
      assert.ok(negou(rodar(entrada(dir, 'src/auth/login.js'), tmp)), 'skill que nao e manual liberou');
      const sessao = function () { return JSON.parse(fs.readFileSync(path.join(tmp, 'sworn', 's1.json'), 'utf8')); };
      // 091 T6: duas negacoes = uma ordem dada (a mesma pendencia)
      assert.strictEqual(sessao().contadores.ordem_manual_dada, 1);
      assert.strictEqual(carregarSkill(dir, tmp, 'padrao-aaa', { agent_id: 'sub-1' }).status, 0);
      assert.ok(negou(rodar(entrada(dir, 'src/auth/login.js'), tmp)), 'o manual carregado por subagente liberou');
      assert.strictEqual(carregarSkill(dir, tmp, 'padrao-aaa').status, 0);
      liberou(rodar(entrada(dir, 'src/auth/login.js'), tmp));
      assert.strictEqual(sessao().contadores.ordem_manual_cumprida, 1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

test('091 #6: controles - arquivo de marcha padrao passa sem manual; "portaoManual": false desliga; sworn:playbook libera', () => {
  comTmp(function (tmp) {
    const dir = projetoAaa();
    try {
      liberou(rodar(entrada(dir, 'src/app.js'), tmp));
      fs.writeFileSync(path.join(dir, '.claude', 'sworn', 'projeto.json'), JSON.stringify({ versaoConfig: 1,
        marchaPadrao: 'padrao', marchas: { aaa: ['**/auth/**'], padrao: ['src/**'], rapida: [] }, portaoManual: false }));
      liberou(rodar(entrada(dir, 'src/auth/login.js'), tmp));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  comTmp(function (tmp) {
    const dir = projetoAaa();
    try {
      assert.strictEqual(carregarSkill(dir, tmp, 'sworn:playbook').status, 0);
      liberou(rodar(entrada(dir, 'src/auth/login.js'), tmp));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
