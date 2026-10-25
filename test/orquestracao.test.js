'use strict';
// D612/D613/D615: toda peca do sworn conversa com as outras, na hora certa. Duas partes:
// (1) a regra geral (D613, vale para as adicoes futuras): skill, agente e script de entrada que nenhuma OUTRA peca
//     chama nem cita e peca solta - reprova. Citacao no README, no CHANGELOG, em docs/ ou em test/ nao conta (senao
//     tudo passaria por estar no README). Ferramenta do mantenedor, que roda a mao, vai em AUTONOMAS com o motivo.
// (2) as ligacoes do censo da D612 (ledger s115), uma por teste: cada peca chamada no momento em que ajuda.
// Limite conhecido (censo, item 5): o teste prova a citacao, nao a ajuda; a revisao cega julga se a ligacao serve.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');

// Scripts de entrada que rodam a mao, sem chamador: o motivo e obrigatorio (peca nova sem motivo reprova).
const AUTONOMAS = {
  'experimento.js': 'roda a mao (README, tabela do fim): monta e julga a tabela de obrigacoes do manual do usuario',
  'medir-travas.js': 'roda a mao (README, tabela do fim): a medicao paga de antes/depois das travas, com pre-registro',
  'plataforma.js': 'roda a mao (README): diz em que sistemas cada trecho dependente de plataforma foi exercitado',
  'provar-apelidos.js': 'roda a mao (README): sonda se os apelidos dos agentes do plugin carregam'
};

// lib/plataforma.js lista quase todos os arquivos do plugin (matriz de plataforma): contaria como citacao de tudo.
const FORA_DO_CORPUS = [path.join('scripts', 'lib', 'plataforma.js')];

function ler(rel) { return fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n'); }

function listar(dir, filtro) {
  const saida = [];
  (function andar(rel) {
    const abs = path.join(RAIZ, rel);
    if (!fs.existsSync(abs)) return;
    for (const nome of fs.readdirSync(abs)) {
      const r = path.join(rel, nome);
      if (fs.statSync(path.join(RAIZ, r)).isDirectory()) andar(r);
      else if (filtro(r)) saida.push(r);
    }
  })(dir);
  return saida;
}

/** Os textos que contam como citacao: o codigo e as instrucoes do plugin, fora a documentacao e os testes. */
const CORPUS = ['skills', 'agents', 'scripts', 'hooks', 'workflows', 'modelos']
  .reduce(function (acc, d) { return acc.concat(listar(d, function (r) { return /\.(md|js|json|tsx)$/.test(r); })); }, [])
  .filter(function (r) { return FORA_DO_CORPUS.indexOf(r) === -1; })
  .map(function (r) { return { rel: r, texto: ler(r) }; });

function citantes(alvo, proprios) {
  return CORPUS.filter(function (f) {
    return !proprios(f.rel) && f.texto.indexOf(alvo) !== -1;
  }).map(function (f) { return f.rel; });
}

/** Secao `## <prefixo>...` ate a proxima `## ` fora de bloco de codigo. */
function secao(texto, prefixo) {
  const partes = [];
  let dentro = false;
  let atual = null;
  for (const l of texto.split('\n')) {
    if (/^```/.test(l)) dentro = !dentro;
    if (!dentro && /^## /.test(l)) { atual = { titulo: l.slice(3), linhas: [] }; partes.push(atual); }
    if (atual) atual.linhas.push(l);
  }
  const achada = partes.filter(function (p) { return p.titulo.indexOf(prefixo) === 0; })[0];
  assert.ok(achada, 'secao "' + prefixo + '" nao encontrada');
  return achada.linhas.join('\n');
}

// ---------- (1) a regra geral: nenhuma peca solta ----------

test('orquestracao: toda skill e chamada por outra peca do plugin (fora README, docs e test)', () => {
  const skills = fs.readdirSync(path.join(RAIZ, 'skills')).filter(function (n) {
    return fs.existsSync(path.join(RAIZ, 'skills', n, 'SKILL.md'));
  });
  assert.ok(skills.length >= 10);
  const soltas = skills.filter(function (n) {
    const dela = function (rel) { return rel.indexOf(path.join('skills', n) + path.sep) === 0; };
    return citantes('sworn:' + n, dela).length === 0;
  });
  assert.deepStrictEqual(soltas, [], 'skill sem chamador: ligue-a na peca que precisa dela (D613)');
});

test('orquestracao: toda skill diz quando entra (description com "Use")', () => {
  for (const n of fs.readdirSync(path.join(RAIZ, 'skills'))) {
    const f = path.join('skills', n, 'SKILL.md');
    if (!fs.existsSync(path.join(RAIZ, f))) continue;
    const desc = (ler(f).match(/^description: (.*)$/m) || [])[1] || '';
    assert.match(desc, /\bUse\b/, f + ': a description nao diz quando usar');
  }
});

test('orquestracao: todo agente e chamado por outra peca do plugin', () => {
  for (const a of fs.readdirSync(path.join(RAIZ, 'agents'))) {
    const nome = a.replace(/\.md$/, '');
    const dele = function (rel) { return rel === path.join('agents', a); };
    assert.ok(citantes('sworn:' + nome, dele).length > 0, 'agente sem chamador: ' + nome);
  }
});

test('orquestracao: todo script de entrada roda por gancho, por outra peca ou esta em AUTONOMAS com motivo', () => {
  const hooks = ler(path.join('hooks', 'hooks.json'));
  const scripts = fs.readdirSync(path.join(RAIZ, 'scripts')).filter(function (n) { return /\.js$/.test(n); });
  const soltos = scripts.filter(function (n) {
    if (hooks.indexOf('/scripts/' + n) !== -1) return false;
    if (AUTONOMAS[n]) return false;
    const dele = function (rel) { return rel === path.join('scripts', n); };
    return citantes(n, dele).length === 0;
  });
  assert.deepStrictEqual(soltos, [], 'script sem chamador: ligue-o ou declare em AUTONOMAS com o motivo (D613)');
  for (const n of Object.keys(AUTONOMAS)) {
    assert.ok(scripts.indexOf(n) !== -1, 'AUTONOMAS cita script que nao existe: ' + n);
    assert.ok(String(AUTONOMAS[n]).length >= 20, 'AUTONOMAS sem motivo: ' + n);
  }
});

// ---------- (2) as ligacoes do censo (D615), cada peca na hora certa ----------

// So o manual: o portao-fecho.js so cobra quando a referencia JA existe, e a mensagem dele e a cena S10 do mock
// aprovado (D529) - mudar pede mock novo, sem ganho no caso "falta referencia".
test('ligacao L2: o manual manda rodar o /sworn:reference quando a AAA nao tem referencia', () => {
  const s = ler('skills/playbook/SKILL.md');
  const i = s.indexOf('**The top reference, named before starting.**');
  assert.ok(i !== -1, 'o paragrafo da referencia de topo');
  assert.ok(s.slice(i, i + 1600).includes('/sworn:reference'), 'no paragrafo da referencia de topo');
});

test('ligacao L3 e L5: o candidato escolhido no radar e estudado pelo /sworn:reference e entra com atalho: e a lente enxuto', () => {
  const s = secao(ler('skills/radar/SKILL.md'), 'Step 6');
  assert.ok(s.includes('/sworn:reference'), 'o estudo do candidato escolhido');
  assert.ok(s.includes('atalho:'), 'o formato do atalho deliberado (D554)');
  assert.match(s, /enxuto/, 'a lente enxuto do /sworn:review');
});

test('ligacao L4 e L8: a referencia le o que o radar ja estudou e le os produtos em paralelo', () => {
  const s = ler('skills/reference/SKILL.md');
  assert.ok(s.includes('.claude/sworn/radar/estudados.md'), 'o ja estudado do radar');
  assert.ok(s.includes('/sworn:parallel') && s.includes('sworn:reader'), 'a leitura em paralelo');
});

test('ligacao L6: o manual chama o radar, os atalhos e o calibrar nos momentos deles', () => {
  const s = ler('skills/playbook/SKILL.md');
  for (const c of ['/sworn:radar', '/sworn:shortcuts', '/sworn:calibrate']) assert.ok(s.includes(c), c);
});

test('ligacao L7: o init fecha mostrando os proximos comandos', () => {
  const s = secao(ler('skills/init/SKILL.md'), 'Step 8');
  for (const c of ['/sworn:reference', '/sworn:radar', '/sworn:shortcuts', '/sworn:audit', '/sworn:calibrate']) {
    assert.ok(s.includes(c), c);
  }
});

test('ligacao L11: o handoff leva os estudos em andamento (radar e referencia)', () => {
  const s = ler('skills/handoff/SKILL.md');
  assert.ok(s.includes('.claude/sworn/radar/'), 'a ficha do radar');
  assert.ok(s.includes('.claude/sworn/referencias/'), 'a ficha de referencia');
});

test('ligacao L10: o /sworn:audit mostra a disputa das skills do projeto com as do plugin', () => {
  assert.ok(ler('skills/audit/SKILL.md').includes('`doPlugin`'), 'a skill le a chave que o script devolve');
  assert.ok(ler('scripts/lib/auditoria.js').includes('doPlugin'));
});

test('ligacao L12: o revisar chama o /sworn:shortcuts', () => {
  assert.ok(ler('skills/review/SKILL.md').includes('/sworn:shortcuts'));
});
