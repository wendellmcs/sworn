'use strict';
// A5e (D793): a conferencia depois do comando de shell. O caso real e a leva 15 do luna: barrado no apagar, ampliou o
// escopo e esvaziou o saida/LICENCAS.txt por [System.IO.File]::WriteAllText no shell. Tambem: os casos de borda da A4
// (espaco, acento, subpasta, arquivo grande, conflito de merge, releitura que falha) e o apagar da A5f.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const comum = require('./lib/comum.js');

const RAIZ = path.join(__dirname, '..');
const LICENCAS = 'Licencas de terceiros.\nNao apagar.\n';

function git(dir, args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'git ' + args.join(' ') + ': ' + r.stderr);
  return r.stdout;
}

function montar(extraProjeto) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-a5e-'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-a5e-tmp-'));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'a5e@teste']);
  git(dir, ['config', 'user.name', 'a5e']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  const arquivos = { 'saida/app.js': 'x\n', 'saida/LICENCAS.txt': LICENCAS, 'src/a.js': 'a\n', 'outra/sujo.md': 's\n',
    'docs/intocavel.md': 'i\n' };
  for (const [f, c] of Object.entries(arquivos)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), c, 'utf8');
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'base']);
  const sworn = path.join(dir, '.claude', 'sworn');
  fs.mkdirSync(sworn, { recursive: true });
  fs.writeFileSync(path.join(sworn, 'projeto.json'), JSON.stringify(Object.assign({ versaoConfig: 1,
    marchaPadrao: 'padrao', intocaveis: ['docs/intocavel.md'] }, extraProjeto || {})), 'utf8');
  fs.writeFileSync(path.join(sworn, 'escopo.md'), '# Escopo\n**Objetivo:** A5e\n## Dentro\n- saida/*.js\n- src/**\n' +
    '- docs/**\n', 'utf8');
  const env = Object.assign({}, process.env, { SWORN_TMP: tmp });
  const rodar = (script, entrada) => {
    // F1 (s372): em processo (comum.ganchoComoProcesso)
    const r = comum.ganchoComoProcesso(path.join('scripts', script), Object.assign({ session_id: 'sa5e', cwd: dir }, entrada),
      { env: env });
    // o gancho que quebra sai 0 e calado (io.blindar): sem esta conferencia, o crash passaria por "nada a avisar"
    assert.ok(!/portao falhou/.test(r.stderr || ''), script + ' quebrou: ' + r.stderr);
    return r.json;
  };
  const depois = (ferramenta) => rodar('conferir-depois.js', { hook_event_name: 'PostToolUse',
    tool_name: ferramenta || 'PowerShell', tool_input: { command: 'qualquer' }, tool_response: {} });
  const ler = (f) => fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : null;
  const limpar = () => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(tmp, { recursive: true, force: true }); };
  return { dir, rodar, depois, ler, limpar };
}

test('A5e: o versionado mudado ou apagado fora do escopo da abertura volta pelo git, e o modelo e avisado', () => {
  const m = montar();
  try {
    // ja sujo na abertura, fora do escopo: de outra frente, a conferencia nao toca
    fs.writeFileSync(path.join(m.dir, 'outra/sujo.md'), 'sujo antes\n', 'utf8');
    m.rodar('abrir-turno.js', { hook_event_name: 'UserPromptSubmit', prompt: 'limpe a saida' });
    // o modelo amplia o escopo no turno (nao vale para a conferencia) e o shell esvazia e apaga por dentro
    fs.writeFileSync(path.join(m.dir, '.claude/sworn/escopo.md'), '# Escopo\n**Objetivo:** A5e\n## Dentro\n- saida/**\n' +
      '- src/**\n- docs/**\n', 'utf8');
    fs.writeFileSync(path.join(m.dir, 'saida/LICENCAS.txt'), '', 'utf8'); // o WriteAllText vazio da leva 15
    fs.rmSync(path.join(m.dir, 'docs/intocavel.md')); // intocavel, dentro de docs/**
    fs.rmSync(path.join(m.dir, 'saida/app.js')); // dentro do escopo: fica apagado
    fs.writeFileSync(path.join(m.dir, 'src/a.js'), 'a mudado\n', 'utf8'); // dentro do escopo: fica
    // adicionado no indice e mudado depois (AM), fora do escopo: nao existe no HEAD, nao ha o que restaurar
    fs.writeFileSync(path.join(m.dir, 'outra/novo.md'), 'n\n', 'utf8');
    git(m.dir, ['add', 'outra/novo.md']);
    fs.writeFileSync(path.join(m.dir, 'outra/novo.md'), 'n mudado\n', 'utf8');
    // um Stop que o sworn barra (continuacao sem o dono) no meio nao apaga a foto (o furo da leva 14)
    m.rodar('marcar-trabalho.js', { hook_event_name: 'PostToolUse', tool_name: 'Write',
      tool_input: { file_path: path.join(m.dir, 'src/b.js'), content: 'b' }, tool_response: {} });
    m.rodar('portao-fecho.js', { hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Feito.' });
    const o = m.depois();
    assert.ok(o && o.decision === 'block', 'avisa: ' + JSON.stringify(o));
    assert.match(o.reason, /restaurou pelo git/);
    assert.match(o.reason, /saida\/LICENCAS\.txt/);
    assert.match(o.reason, /docs\/intocavel\.md/);
    assert.ok(/^[\x20-\x7E\n]+$/.test(o.reason), 'ASCII: ' + o.reason);
    assert.strictEqual(m.ler('saida/LICENCAS.txt'), LICENCAS, 'o esvaziado volta');
    assert.strictEqual(m.ler('docs/intocavel.md'), 'i\n', 'o intocavel apagado volta');
    assert.strictEqual(m.ler('saida/app.js'), null, 'dentro do escopo, o apagar fica');
    assert.strictEqual(m.ler('src/a.js'), 'a mudado\n', 'dentro do escopo, a mudanca fica');
    assert.strictEqual(m.ler('outra/sujo.md'), 'sujo antes\n', 'o que ja vinha sujo fica');
    assert.strictEqual(m.ler('outra/novo.md'), 'n mudado\n', 'o adicionado (AM) fica');
    assert.ok(!/outra\/novo\.md/.test(o.reason), 'e nao aparece no aviso: ' + o.reason);
    // antes de restaurar, o que o comando deixou fica copiado (a mudanca pode ser do dono, a mao)
    const copia = (o.reason.match(/copiado em "([^"]+)"/) || [])[1];
    assert.ok(copia && /^\.sworn\/restaurados\//.test(copia), 'diz onde copiou: ' + o.reason);
    assert.strictEqual(m.ler(copia + '/saida/LICENCAS.txt'), '', 'a copia guarda o que o comando deixou');
    // o comando seguinte, sem nada novo fora do escopo, passa calado
    assert.strictEqual(m.depois(), null, 'nada mais a restaurar');
    // a proxima mensagem do dono tira a foto nova: o escopo ampliado passa a valer
    m.rodar('abrir-turno.js', { hook_event_name: 'UserPromptSubmit', prompt: 'pode limpar tudo' });
    fs.writeFileSync(path.join(m.dir, 'saida/LICENCAS.txt'), '', 'utf8');
    assert.strictEqual(m.depois('Bash'), null, 'turno seguinte, dentro do escopo novo');
    assert.strictEqual(m.ler('saida/LICENCAS.txt'), '', 'e a mudanca fica');
  } finally {
    m.limpar();
  }
});

test('A5e: sem a copia do que o comando deixou, o arquivo nao e restaurado, e o aviso diz', () => {
  const m = montar();
  try {
    m.rodar('abrir-turno.js', { hook_event_name: 'UserPromptSubmit', prompt: 'x' });
    fs.writeFileSync(path.join(m.dir, '.sworn'), 'um arquivo onde a pasta da copia iria', 'utf8');
    fs.writeFileSync(path.join(m.dir, 'saida/LICENCAS.txt'), 'escrito a mao pelo dono\n', 'utf8');
    fs.rmSync(path.join(m.dir, 'docs/intocavel.md')); // apagado: nada a perder, restaura sem copia
    const o = m.depois();
    assert.ok(o && o.decision === 'block', JSON.stringify(o));
    assert.strictEqual(m.ler('saida/LICENCAS.txt'), 'escrito a mao pelo dono\n', 'sem copia, nao sobrescreve');
    assert.strictEqual(m.ler('docs/intocavel.md'), 'i\n', 'o apagado volta');
    assert.match(o.reason, /Sem copia, nao restaurados[\s\S]*segue no lugar[\s\S]*saida\/LICENCAS\.txt" \(E[A-Z]+\)/, o.reason);
    assert.ok(!/copiado em/.test(o.reason), 'nao diz que copiou: ' + o.reason);
  } finally {
    m.limpar();
  }
});

// A4 (s369, P2 do s460): caminho com espaco e acento, o comando rodado de uma subpasta, o arquivo grande demais para
// copiar, o arquivo em conflito de merge e a releitura do git que falha.
test('A4: espaco, acento e subpasta restauram; o grande demais e o em conflito ficam no lugar e o aviso diz', () => {
  const m = montar();
  try {
    const estranho = 'outra pasta/licença.txt';
    fs.mkdirSync(path.join(m.dir, 'outra pasta'), { recursive: true });
    fs.writeFileSync(path.join(m.dir, estranho), 'original\n', 'utf8');
    fs.writeFileSync(path.join(m.dir, 'outra/grande.bin'), 'pequeno\n', 'utf8');
    git(m.dir, ['add', '-A']);
    git(m.dir, ['commit', '-q', '-m', 'mais']);
    m.rodar('abrir-turno.js', { hook_event_name: 'UserPromptSubmit', prompt: 'x' });
    fs.writeFileSync(path.join(m.dir, estranho), 'mudado pelo shell\n', 'utf8');
    fs.truncateSync(path.join(m.dir, 'outra/grande.bin'), 51 * 1024 * 1024);
    const o = m.rodar('conferir-depois.js', { cwd: path.join(m.dir, 'src'), hook_event_name: 'PostToolUse',
      tool_name: 'Bash', tool_input: { command: 'qualquer' }, tool_response: {} });
    assert.ok(o && o.decision === 'block', JSON.stringify(o));
    assert.strictEqual(m.ler(estranho), 'original\n', 'espaco e acento, rodado da subpasta: volta');
    // o aviso sai em ASCII (escopo.ascii): o "ç" do nome vira "c"
    assert.match(o.reason, /Restaurados:\n {2}- "outra pasta\/licenca\.txt"/, o.reason);
    assert.strictEqual(fs.statSync(path.join(m.dir, 'outra/grande.bin')).size, 51 * 1024 * 1024, 'o grande fica');
    assert.match(o.reason, /outra\/grande\.bin" \(grande demais para copiar: 51 MB\)/, o.reason);
    assert.ok(/^[\x20-\x7E\n]+$/.test(o.reason), 'ASCII: ' + o.reason);
  } finally {
    m.limpar();
  }
});

test('A4: o arquivo em conflito de merge fora do escopo nao e restaurado (resolveria o merge), e o aviso diz', () => {
  const m = montar();
  try {
    const base = git(m.dir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    git(m.dir, ['checkout', '-q', '-b', 'outro']);
    fs.writeFileSync(path.join(m.dir, 'saida/LICENCAS.txt'), 'deles\n', 'utf8');
    fs.writeFileSync(path.join(m.dir, 'src/a.js'), 'deles\n', 'utf8'); // conflito dentro do escopo: e do turno
    git(m.dir, ['commit', '-q', '-am', 'deles']);
    git(m.dir, ['checkout', '-q', base]);
    fs.writeFileSync(path.join(m.dir, 'saida/LICENCAS.txt'), 'nossas\n', 'utf8');
    fs.writeFileSync(path.join(m.dir, 'src/a.js'), 'nossas\n', 'utf8');
    git(m.dir, ['commit', '-q', '-am', 'nossas']);
    m.rodar('abrir-turno.js', { hook_event_name: 'UserPromptSubmit', prompt: 'x' });
    spawnSync('git', ['merge', 'outro'], { cwd: m.dir, encoding: 'utf8' }); // o shell do turno: conflito
    const emConflito = m.ler('saida/LICENCAS.txt');
    assert.match(emConflito, /<<<<<<</, 'controle: o merge deixou o conflito');
    const o = m.depois();
    assert.ok(o && o.decision === 'block', JSON.stringify(o));
    assert.strictEqual(m.ler('saida/LICENCAS.txt'), emConflito, 'o conflito fica como o merge deixou');
    assert.match(o.reason, /Em conflito de merge, nao restaurados[\s\S]*saida\/LICENCAS\.txt/, o.reason);
    assert.ok(!/src\/a\.js/.test(o.reason), 'o conflito dentro do escopo nao entra: ' + o.reason);
    assert.ok(!/Restaurados:|restaurou/.test(o.reason), 'nada restaurado, nada de "restaurou": ' + o.reason);
  } finally {
    m.limpar();
  }
});

test('A4: a releitura do git que falha nao diz que o git recusou: diz que nao deu para conferir', () => {
  const { separar } = require('../scripts/conferir-depois.js');
  assert.deepStrictEqual(separar(['a.txt', 'b.txt'], ['b.txt']),
    { restaurados: ['a.txt'], recusados: ['b.txt'], semConferir: [] });
  assert.deepStrictEqual(separar(['a.txt', 'b.txt'], null),
    { restaurados: [], recusados: [], semConferir: ['a.txt', 'b.txt'] });
  // a releitura vazia ([]) e "nada segue mudado", nao falha
  assert.deepStrictEqual(separar(['a.txt'], []), { restaurados: ['a.txt'], recusados: [], semConferir: [] });
});

// A5f (leva 16 do luna r1: no turno da ampliacao, o `rm saida/util.js`, ja em `saida/*.js`, foi barrado - D7)
test('A5f: ampliado o escopo, apagar o que ja estava no escopo da abertura passa; o que entrou pela ampliacao espera', () => {
  const m = montar();
  try {
    const barrou = (o) => !!(o && o.hookSpecificOutput && o.hookSpecificOutput.permissionDecision === 'deny');
    const AMPLIADO = /escopo foi ampliado neste turno/;
    const shell = (c) => m.rodar('portao-destrutivo.js', { tool_name: 'Bash', tool_input: { command: c } });
    const editar = (f) => m.rodar('portao-escopo.js', { tool_name: 'Write',
      tool_input: { file_path: path.join(m.dir, f), content: '', apagar: true } });
    m.rodar('abrir-turno.js', { hook_event_name: 'UserPromptSubmit', prompt: 'limpe a saida' });
    const escopo = path.join(m.dir, '.claude/sworn/escopo.md');
    const novo = '# Escopo\n**Objetivo:** A5e\n## Dentro\n- saida/**\n- src/**\n- docs/**\n';
    assert.ok(!barrou(m.rodar('portao-escopo.js', { tool_name: 'Write', tool_input: { file_path: escopo, content: novo } })));
    fs.writeFileSync(escopo, novo, 'utf8');
    // ja estava em saida/*.js na abertura: a ampliacao nao muda nada para ele
    const o1 = shell('rm saida/app.js');
    assert.ok(!barrou(o1), 'no escopo da abertura, pelo shell: ' + JSON.stringify(o1));
    assert.ok(!barrou(editar('src/a.js')), 'no escopo da abertura, pela edicao');
    // entrou pela ampliacao: espera a mensagem do dono
    const o2 = shell('rm saida/LICENCAS.txt');
    assert.ok(barrou(o2) && AMPLIADO.test(o2.hookSpecificOutput.permissionDecisionReason), JSON.stringify(o2));
    const o3 = editar('saida/LICENCAS.txt');
    assert.ok(barrou(o3) && AMPLIADO.test(o3.hookSpecificOutput.permissionDecisionReason), JSON.stringify(o3));
    // misturado (um da abertura e um da ampliacao): espera
    assert.ok(barrou(shell('rm saida/app.js saida/LICENCAS.txt')), 'misturado: app.js na abertura, LICENCAS pela ampliacao');
  } finally {
    m.limpar();
  }
});

test('A5e: sem escopo declarado ou com travas.destrutivo false, nada muda', () => {
  for (const [nome, extra, semEscopo] of [['sem escopo', null, true], ['destrutivo false', { travas: { destrutivo: false } }, false]]) {
    const m = montar(extra);
    try {
      if (semEscopo) fs.rmSync(path.join(m.dir, '.claude/sworn/escopo.md'));
      m.rodar('abrir-turno.js', { hook_event_name: 'UserPromptSubmit', prompt: 'x' });
      fs.writeFileSync(path.join(m.dir, 'saida/LICENCAS.txt'), '', 'utf8');
      assert.strictEqual(m.depois(), null, nome);
      assert.strictEqual(m.ler('saida/LICENCAS.txt'), '', nome + ': fica como o comando deixou');
    } finally {
      m.limpar();
    }
  }
});
